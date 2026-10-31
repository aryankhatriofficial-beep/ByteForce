"""Safe, streaming inspection of gzip-compressed source distributions."""

import hashlib
import tarfile
import tomllib
from email import policy
from email.parser import BytesParser
from pathlib import Path
from typing import Any

from pyverify.inventory import _normalized_path, _limit_is_valid


_CHUNK_SIZE = 1024 * 1024
_DEFAULT_MAX_ARCHIVE_SIZE = 1024 * 1024 * 1024
_DEFAULT_MAX_MEMBERS = 100_000
_DEFAULT_MAX_MEMBER_SIZE = 512 * 1024 * 1024
_DEFAULT_MAX_UNCOMPRESSED_SIZE = 2 * 1024 * 1024 * 1024
_MAX_METADATA_SIZE = 1024 * 1024


def _canonical_name(value: str) -> str:
    return "-".join(filter(None, value.lower().replace("_", "-").replace(".", "-").split("-")))


def _incomplete(error: str, member_count: int = 0, entries=None) -> dict[str, Any]:
    return {
        "status": "SDIST_INVENTORY_INCOMPLETE",
        "complete": False,
        "entries": entries or [],
        "member_count": member_count,
        "total_uncompressed_size": sum(item["size"] for item in entries or []),
        "metadata": None,
        "errors": [error],
    }


def inspect_sdist(
    file_path: str | Path,
    project_name: str,
    version: str,
    *,
    max_archive_size: int = _DEFAULT_MAX_ARCHIVE_SIZE,
    max_members: int = _DEFAULT_MAX_MEMBERS,
    max_member_size: int = _DEFAULT_MAX_MEMBER_SIZE,
    max_uncompressed_size: int = _DEFAULT_MAX_UNCOMPRESSED_SIZE,
) -> dict[str, Any]:
    """Inventory a ``.tar.gz`` sdist and validate its release identity.

    Members are read sequentially and hashed in memory; nothing is extracted.
    """
    limits = (max_archive_size, max_members, max_member_size, max_uncompressed_size)
    if not all(_limit_is_valid(limit) for limit in limits):
        raise ValueError("Sdist limits must be positive integers")

    path = Path(file_path)
    try:
        if path.stat().st_size > max_archive_size:
            return _incomplete("Compressed archive exceeds the configured size limit")
    except OSError as exc:
        return _incomplete("Could not read archive file: {}".format(exc))

    errors = []
    entries = []
    seen = set()
    roots = set()
    member_count = 0
    total_size = 0
    metadata_bytes = None
    pyproject_bytes = None

    try:
        with tarfile.open(path, mode="r|gz") as archive:
            for member in archive:
                member_count += 1
                if member_count > max_members:
                    return _incomplete("Archive member count exceeds the configured limit", member_count)
                is_directory = member.isdir()
                try:
                    normalized = _normalized_path(member.name, directory=is_directory)
                except ValueError:
                    errors.append("Unsafe sdist path: {!r}".format(member.name))
                    break
                if normalized in seen:
                    errors.append("Duplicate normalized sdist path: {}".format(normalized))
                    break
                seen.add(normalized)
                parts = normalized.split("/")
                roots.add(parts[0])
                if len(parts) == 1 and is_directory:
                    if member.size != 0:
                        errors.append("Sdist directory has an invalid non-zero size")
                        break
                    continue
                if len(parts) < 2:
                    errors.append("Sdist members must be inside one top-level directory")
                    break
                if is_directory:
                    if member.size != 0:
                        errors.append("Sdist directory has an invalid non-zero size")
                        break
                    continue
                if not member.isfile():
                    errors.append("Unsupported or linked sdist member: {}".format(normalized))
                    break
                if member.size < 0 or member.size > max_member_size:
                    errors.append("Sdist member exceeds the configured size limit: {}".format(normalized))
                    break
                total_size += member.size
                if total_size > max_uncompressed_size:
                    errors.append("Sdist exceeds the configured uncompressed size limit")
                    break

                digest = hashlib.sha256()
                actual_size = 0
                member_file = archive.extractfile(member)
                if member_file is None:
                    errors.append("Could not read sdist member: {}".format(normalized))
                    break
                content = bytearray() if normalized.endswith(("/PKG-INFO", "/pyproject.toml")) else None
                with member_file:
                    while True:
                        chunk = member_file.read(_CHUNK_SIZE)
                        if not chunk:
                            break
                        actual_size += len(chunk)
                        if actual_size > max_member_size or actual_size + total_size - member.size > max_uncompressed_size:
                            errors.append("Actual sdist data exceeds configured limits")
                            break
                        digest.update(chunk)
                        if content is not None:
                            if len(content) + len(chunk) > _MAX_METADATA_SIZE:
                                errors.append("Sdist metadata file exceeds the allowed size")
                                break
                            content.extend(chunk)
                if errors:
                    break
                if actual_size != member.size:
                    errors.append("Sdist advertised size does not match actual size: {}".format(normalized))
                    break
                relative = "/".join(parts[1:])
                entries.append({
                    "path": normalized,
                    "relative_path": relative,
                    "size": actual_size,
                    "sha256": digest.hexdigest(),
                })
                if relative == "PKG-INFO":
                    metadata_bytes = bytes(content or b"")
                elif relative == "pyproject.toml":
                    pyproject_bytes = bytes(content or b"")
    except Exception as exc:
        errors.append("Malformed or unreadable gzip tar archive: {}".format(exc))

    if not errors and len(roots) != 1:
        errors.append("Sdist must contain exactly one top-level directory")
    if not errors and (metadata_bytes is None or pyproject_bytes is None):
        errors.append("Sdist must contain root-level pyproject.toml and PKG-INFO")

    metadata = None
    if not errors:
        try:
            message = BytesParser(policy=policy.default).parsebytes(metadata_bytes)
            names = message.get_all("Name", [])
            versions = message.get_all("Version", [])
            if len(names) != 1 or len(versions) != 1 or not names[0] or not versions[0]:
                raise ValueError("PKG-INFO must contain exactly one Name and Version")
            pyproject = tomllib.loads(pyproject_bytes.decode("utf-8"))
            project = pyproject.get("project", {})
            if not isinstance(project, dict):
                raise ValueError("pyproject.toml [project] must be a table")
            declared_name = project.get("name")
            declared_version = project.get("version")
            name_matches = _canonical_name(str(names[0])) == _canonical_name(project_name)
            version_matches = str(versions[0]) == version
            filename = path.name
            suffix = ".tar.gz"
            stem = filename[:-len(suffix)] if filename.lower().endswith(suffix) else ""
            filename_matches = any(
                _canonical_name("-".join(stem.split("-")[:index])) == _canonical_name(project_name)
                and "-".join(stem.split("-")[index:]) == version
                for index in range(1, len(stem.split("-")))
            )
            root_matches = any(
                root.endswith("-" + version)
                and _canonical_name(root[: -(len(version) + 1)]) == _canonical_name(project_name)
                for root in roots
            )
            if declared_name is not None:
                name_matches = name_matches and _canonical_name(str(declared_name)) == _canonical_name(project_name)
            if declared_version is not None:
                version_matches = version_matches and str(declared_version) == version
            metadata = {
                "name": str(names[0]),
                "version": str(versions[0]),
                "pyproject_name": declared_name,
                "pyproject_version": declared_version,
                "filename": filename,
                "top_level_directory": next(iter(roots)) if len(roots) == 1 else None,
                "matches_requested_release": name_matches and version_matches and filename_matches and root_matches,
            }
            if not metadata["matches_requested_release"]:
                errors.append("Sdist filename or metadata does not match the requested project/version")
        except (UnicodeDecodeError, ValueError, tomllib.TOMLDecodeError) as exc:
            errors.append("Invalid sdist project metadata: {}".format(exc))

    entries.sort(key=lambda entry: entry["path"])
    return {
        "status": "SDIST_INVENTORY_COMPLETE" if not errors else "SDIST_INVENTORY_INCOMPLETE",
        "complete": not errors,
        "entries": entries,
        "member_count": member_count,
        "total_uncompressed_size": sum(item["size"] for item in entries),
        "metadata": metadata,
        "errors": errors,
    }
