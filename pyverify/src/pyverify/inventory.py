"""Safe, streaming ZIP inventory and wheel RECORD verification."""

import base64
import csv
import hashlib
import io
import posixpath
import stat
import unicodedata
from pathlib import Path, PurePosixPath
from typing import Any
from zipfile import BadZipFile, ZipFile


_CHUNK_SIZE = 1024 * 1024
_DEFAULT_MAX_ARCHIVE_SIZE = 1024 * 1024 * 1024
_DEFAULT_MAX_MEMBERS = 100_000
_DEFAULT_MAX_MEMBER_SIZE = 512 * 1024 * 1024
_DEFAULT_MAX_UNCOMPRESSED_SIZE = 2 * 1024 * 1024 * 1024
_DEFAULT_MAX_COMPRESSION_RATIO = 1000
_DEFAULT_MAX_RECORD_SIZE = 16 * 1024 * 1024
_RECORD_HASHES = ("sha256", "sha384", "sha512")


def _limit_is_valid(value: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _normalized_path(raw_path: str, *, directory: bool = False) -> str:
    if (
        not isinstance(raw_path, str)
        or not raw_path
        or "\x00" in raw_path
        or "\\" in raw_path
        or any(ord(char) < 0x20 or ord(char) == 0x7F for char in raw_path)
        or raw_path.startswith("/")
    ):
        raise ValueError("unsafe archive path")

    path = raw_path[:-1] if directory and raw_path.endswith("/") else raw_path
    parts = path.split("/")
    if not path or any(part == ".." for part in parts):
        raise ValueError("unsafe archive path")
    if parts[0].endswith(":") or ":" in parts[0]:
        raise ValueError("unsafe archive path")

    normalized = posixpath.normpath(path)
    if normalized in ("", ".", "..") or normalized.startswith("../"):
        raise ValueError("unsafe archive path")
    return unicodedata.normalize("NFC", normalized)


def _incomplete_inventory(error: str, *, member_count: int = 0) -> dict[str, Any]:
    return {
        "status": "INVENTORY_INCOMPLETE",
        "complete": False,
        "entries": [],
        "member_count": member_count,
        "total_uncompressed_size": 0,
        "errors": [error],
    }


def inventory_zip_artifact(
    file_path: str | Path,
    *,
    max_archive_size: int = _DEFAULT_MAX_ARCHIVE_SIZE,
    max_members: int = _DEFAULT_MAX_MEMBERS,
    max_member_size: int = _DEFAULT_MAX_MEMBER_SIZE,
    max_uncompressed_size: int = _DEFAULT_MAX_UNCOMPRESSED_SIZE,
    max_compression_ratio: int = _DEFAULT_MAX_COMPRESSION_RATIO,
) -> dict[str, Any]:
    """Hash ZIP members incrementally without extracting any member to disk."""
    limits = (
        max_archive_size,
        max_members,
        max_member_size,
        max_uncompressed_size,
        max_compression_ratio,
    )
    if not all(_limit_is_valid(value) for value in limits):
        raise ValueError("Inventory limits must be positive integers")

    path = Path(file_path)
    try:
        archive_size = path.stat().st_size
    except OSError as exc:
        return _incomplete_inventory("Could not read archive file: {}".format(exc))
    if archive_size > max_archive_size:
        return _incomplete_inventory("Archive exceeds the configured size limit")

    entries = []
    errors = []
    seen_paths = set()
    total_advertised_size = 0
    total_actual_size = 0
    member_count = 0

    try:
        with ZipFile(path) as archive:
            infos = archive.infolist()
            member_count = len(infos)
            if member_count > max_members:
                return _incomplete_inventory(
                    "Archive member count exceeds the configured limit",
                    member_count=member_count,
                )

            file_infos = []
            for info in infos:
                is_directory = info.is_dir()
                try:
                    normalized = _normalized_path(
                        info.filename, directory=is_directory
                    )
                except ValueError:
                    errors.append("Unsafe archive path: {!r}".format(info.filename))
                    continue

                if normalized in seen_paths:
                    errors.append("Duplicate normalized archive path: {}".format(normalized))
                    continue
                seen_paths.add(normalized)

                mode = (info.external_attr >> 16) & 0o170000
                if is_directory:
                    if mode not in (0, stat.S_IFDIR):
                        errors.append("Invalid archive directory entry: {}".format(normalized))
                    continue
                if mode not in (0, stat.S_IFREG):
                    errors.append("Non-regular archive member: {}".format(normalized))
                    continue
                if info.file_size > max_member_size:
                    errors.append("Archive member exceeds size limit: {}".format(normalized))
                    continue
                total_advertised_size += info.file_size
                if total_advertised_size > max_uncompressed_size:
                    errors.append("Archive exceeds the configured uncompressed size limit")
                    break
                if info.file_size and (
                    info.compress_size == 0
                    or info.file_size / info.compress_size > max_compression_ratio
                ):
                    errors.append("Archive member compression ratio exceeds limit: {}".format(normalized))
                    continue
                file_infos.append((info, normalized))

            if errors:
                return {
                    "status": "INVENTORY_INCOMPLETE",
                    "complete": False,
                    "entries": [],
                    "member_count": member_count,
                    "total_uncompressed_size": total_advertised_size,
                    "errors": errors,
                }

            for info, normalized in file_infos:
                digesters = {name: hashlib.new(name) for name in _RECORD_HASHES}
                member_size = 0
                try:
                    with archive.open(info, "r") as member:
                        while True:
                            chunk = member.read(_CHUNK_SIZE)
                            if not chunk:
                                break
                            member_size += len(chunk)
                            total_actual_size += len(chunk)
                            if (
                                member_size > max_member_size
                                or total_actual_size > max_uncompressed_size
                            ):
                                raise ValueError("Actual uncompressed data exceeds configured limits")
                            for digester in digesters.values():
                                digester.update(chunk)
                except Exception as exc:
                    errors.append("Could not safely read {}: {}".format(normalized, exc))
                    break

                if member_size != info.file_size:
                    errors.append("Advertised size does not match actual size: {}".format(normalized))
                    break
                entries.append(
                    {
                        "path": normalized,
                        "size": member_size,
                        "hashes": {
                            name: digester.hexdigest()
                            for name, digester in digesters.items()
                        },
                    }
                )
    except Exception as exc:
        errors.append("Malformed or unreadable ZIP archive: {}".format(exc))

    entries.sort(key=lambda entry: entry["path"])
    return {
        "status": "INVENTORY_COMPLETE" if not errors else "INVENTORY_INCOMPLETE",
        "complete": not errors,
        "entries": entries,
        "member_count": member_count,
        "total_uncompressed_size": total_actual_size,
        "errors": errors,
    }


def _read_record(path: Path, record_path: str, max_record_size: int) -> bytes:
    with ZipFile(path) as archive:
        matches = [
            info
            for info in archive.infolist()
            if _normalized_path(info.filename, directory=info.is_dir()) == record_path
            and not info.is_dir()
        ]
        if len(matches) != 1:
            raise ValueError("Wheel must contain exactly one RECORD file")
        info = matches[0]
        if info.file_size > max_record_size:
            raise ValueError("RECORD exceeds the configured size limit")
        with archive.open(info, "r") as record_file:
            data = record_file.read(max_record_size + 1)
        if len(data) > max_record_size:
            raise ValueError("RECORD exceeds the configured size limit")
        return data


def verify_wheel_record(
    file_path: str | Path,
    inventory: dict[str, Any] | None = None,
    *,
    max_record_size: int = _DEFAULT_MAX_RECORD_SIZE,
) -> dict[str, Any]:
    """Validate wheel RECORD paths, hashes, sizes, and archive membership."""
    if not _limit_is_valid(max_record_size):
        raise ValueError("max_record_size must be a positive integer")
    path = Path(file_path)
    if path.suffix.lower() != ".whl":
        return {
            "status": "RECORD_INVALID",
            "valid": False,
            "record_path": None,
            "file_count": 0,
            "errors": ["RECORD verification requires a .whl file"],
        }

    if inventory is None:
        inventory = inventory_zip_artifact(path)
    errors = []
    if inventory.get("status") != "INVENTORY_COMPLETE":
        errors.append("Inventory is incomplete; RECORD cannot be fully verified")
        errors.extend(inventory.get("errors", []))

    entries = inventory.get("entries", [])
    entry_by_path = {entry["path"]: entry for entry in entries}
    record_paths = [
        entry["path"]
        for entry in entries
        if PurePosixPath(entry["path"]).name == "RECORD"
        and PurePosixPath(entry["path"]).parent.name.endswith(".dist-info")
    ]
    if len(record_paths) != 1:
        errors.append("Wheel must contain exactly one .dist-info/RECORD")
        return {
            "status": "RECORD_INVALID",
            "valid": False,
            "record_path": None,
            "file_count": len(entries),
            "errors": errors,
        }

    record_path = record_paths[0]
    if errors:
        return {
            "status": "RECORD_INVALID",
            "valid": False,
            "record_path": record_path,
            "file_count": len(entries),
            "errors": errors,
        }

    try:
        raw_record = _read_record(path, record_path, max_record_size)
        record_text = raw_record.decode("utf-8")
        rows = list(csv.reader(io.StringIO(record_text, newline=""), strict=True))
    except Exception as exc:
        return {
            "status": "RECORD_INVALID",
            "valid": False,
            "record_path": record_path,
            "file_count": len(entries),
            "errors": ["Malformed RECORD: {}".format(exc)],
        }

    record_entries = {}
    for row_number, row in enumerate(rows, start=1):
        if len(row) != 3:
            errors.append("RECORD row {} must contain exactly three fields".format(row_number))
            continue
        raw_path, hash_spec, size_spec = row
        if raw_path.endswith("/"):
            errors.append("RECORD row {} lists a directory".format(row_number))
            continue
        try:
            normalized = _normalized_path(raw_path)
        except ValueError:
            errors.append("RECORD row {} has an unsafe path".format(row_number))
            continue
        if normalized in record_entries:
            errors.append("Duplicate RECORD entry: {}".format(normalized))
            continue
        record_entries[normalized] = (hash_spec, size_spec, row_number)

    if record_path not in record_entries:
        errors.append("RECORD must include its own empty hash/size entry")
    else:
        own_hash, own_size, own_row = record_entries[record_path]
        if own_hash or own_size:
            errors.append("RECORD row {} must have empty hash and size".format(own_row))

    for recorded_path, (hash_spec, size_spec, row_number) in record_entries.items():
        if recorded_path == record_path:
            continue
        archive_entry = entry_by_path.get(recorded_path)
        if archive_entry is None:
            errors.append("RECORD lists a missing file: {}".format(recorded_path))
            continue

        if not hash_spec:
            errors.append("RECORD row {} is missing a file hash".format(row_number))
        else:
            try:
                algorithm, encoded_digest = hash_spec.split("=", 1)
            except ValueError:
                errors.append("RECORD row {} has a malformed hash".format(row_number))
            else:
                if algorithm not in _RECORD_HASHES:
                    errors.append("RECORD row {} uses an unsupported or weak hash".format(row_number))
                else:
                    expected_digest = base64.urlsafe_b64encode(
                        bytes.fromhex(archive_entry["hashes"][algorithm])
                    ).decode("ascii").rstrip("=")
                    if encoded_digest != expected_digest:
                        errors.append("RECORD hash mismatch: {}".format(recorded_path))

        if size_spec:
            if not size_spec.isascii() or not size_spec.isdecimal():
                errors.append("RECORD row {} has an invalid size".format(row_number))
            elif int(size_spec) != archive_entry["size"]:
                errors.append("RECORD size mismatch: {}".format(recorded_path))

    signature_suffixes = ("RECORD.jws", "RECORD.p7s")
    allowed_unrecorded = {
        entry["path"]
        for entry in entries
        if PurePosixPath(entry["path"]).parent == PurePosixPath(record_path).parent
        and PurePosixPath(entry["path"]).name in signature_suffixes
    }
    for archive_path in entry_by_path:
        if archive_path not in record_entries and archive_path not in allowed_unrecorded:
            errors.append("Unexpected archive file not listed in RECORD: {}".format(archive_path))

    return {
        "status": "RECORD_INVALID" if errors else "RECORD_VALID",
        "valid": not errors,
        "record_path": record_path,
        "file_count": len(entries),
        "errors": errors,
    }


def inspect_wheel_integrity(
    file_path: str | Path,
    *,
    max_archive_size: int = _DEFAULT_MAX_ARCHIVE_SIZE,
    max_members: int = _DEFAULT_MAX_MEMBERS,
    max_member_size: int = _DEFAULT_MAX_MEMBER_SIZE,
    max_uncompressed_size: int = _DEFAULT_MAX_UNCOMPRESSED_SIZE,
    max_compression_ratio: int = _DEFAULT_MAX_COMPRESSION_RATIO,
    max_record_size: int = _DEFAULT_MAX_RECORD_SIZE,
) -> dict[str, Any]:
    """Return RECORD verification and safe ZIP inventory for a wheel."""
    inventory = inventory_zip_artifact(
        file_path,
        max_archive_size=max_archive_size,
        max_members=max_members,
        max_member_size=max_member_size,
        max_uncompressed_size=max_uncompressed_size,
        max_compression_ratio=max_compression_ratio,
    )
    record = verify_wheel_record(
        file_path, inventory=inventory, max_record_size=max_record_size
    )
    return {"record_integrity": record, "artifact_inventory": inventory}
