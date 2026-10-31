"""Read package metadata from a local wheel archive without extracting it."""

from email import policy
from email.parser import BytesParser
import tarfile
from pathlib import Path, PurePosixPath
from typing import Union
from zipfile import BadZipFile, ZipFile


_MAX_DISTRIBUTION_METADATA_SIZE = 1024 * 1024


def _metadata_from_bytes(metadata_bytes: bytes) -> dict:
    message = BytesParser(policy=policy.default).parsebytes(metadata_bytes)
    names = message.get_all("Name", [])
    versions = message.get_all("Version", [])
    if len(names) != 1 or len(versions) != 1 or not names[0] or not versions[0]:
        raise ValueError("Distribution metadata must include Name and Version")
    return {"name": str(names[0]), "version": str(versions[0])}


def inspect_wheel(wheel_path: Union[str, Path]) -> dict:
    """Return basic distribution metadata from a local ``.whl`` file.

    The wheel is only read as a ZIP archive; its contents are never extracted
    or executed. Raises ``ValueError`` for invalid archives or missing/invalid
    wheel metadata.
    """
    path = Path(wheel_path)
    if path.suffix.lower() != ".whl":
        raise ValueError("Wheel file must have a .whl extension")

    try:
        with ZipFile(path) as archive:
            metadata_paths = [
                name
                for name in archive.namelist()
                if name.endswith(".dist-info/METADATA")
            ]
            if len(metadata_paths) != 1:
                raise ValueError("Wheel must contain exactly one .dist-info/METADATA file")

            metadata_info = archive.getinfo(metadata_paths[0])
            if metadata_info.file_size > _MAX_DISTRIBUTION_METADATA_SIZE:
                raise ValueError("Wheel METADATA exceeds the allowed size")
            with archive.open(metadata_info) as metadata_file:
                metadata_bytes = metadata_file.read(_MAX_DISTRIBUTION_METADATA_SIZE + 1)
            if len(metadata_bytes) > _MAX_DISTRIBUTION_METADATA_SIZE:
                raise ValueError("Wheel METADATA exceeds the allowed size")
            message = BytesParser(policy=policy.default).parsebytes(metadata_bytes)
    except BadZipFile as exc:
        raise ValueError("Invalid wheel archive") from exc

    names = message.get_all("Name", [])
    versions = message.get_all("Version", [])
    if len(names) != 1 or len(versions) != 1 or not names[0] or not versions[0]:
        raise ValueError("Wheel METADATA must include Name and Version")
    name, version = names[0], versions[0]

    requires_dist = message.get_all("Requires-Dist", [])
    return {
        "name": str(name),
        "version": str(version),
        "requires_python": message.get("Requires-Python"),
        "requires_dist": [str(dependency) for dependency in requires_dist],
    }


def inspect_distribution_metadata(distribution_path: Union[str, Path]) -> dict | None:
    """Read Name and Version from a wheel or source archive without extraction.

    Returns ``None`` for formats whose metadata layout is not supported.
    Metadata entries are size-bounded before parsing.
    """
    path = Path(distribution_path)
    suffix = path.name.lower()
    if suffix.endswith(".whl"):
        return inspect_wheel(path)

    if suffix.endswith(".zip"):
        try:
            with ZipFile(path) as archive:
                candidates = [
                    info for info in archive.infolist()
                    if PurePosixPath(info.filename).name == "PKG-INFO"
                ]
                if candidates:
                    depth = min(len(PurePosixPath(info.filename).parts) for info in candidates)
                    candidates = [
                        info for info in candidates
                        if len(PurePosixPath(info.filename).parts) == depth
                    ]
                if len(candidates) != 1:
                    raise ValueError("Source archive must contain exactly one PKG-INFO")
                info = candidates[0]
                if info.file_size > _MAX_DISTRIBUTION_METADATA_SIZE:
                    raise ValueError("PKG-INFO exceeds the allowed size")
                with archive.open(info) as metadata_file:
                    metadata_bytes = metadata_file.read(_MAX_DISTRIBUTION_METADATA_SIZE + 1)
                if len(metadata_bytes) > _MAX_DISTRIBUTION_METADATA_SIZE:
                    raise ValueError("PKG-INFO exceeds the allowed size")
                return _metadata_from_bytes(metadata_bytes)
        except BadZipFile as exc:
            raise ValueError("Invalid source archive") from exc

    if suffix.endswith((".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tar.xz")):
        try:
            with tarfile.open(path, mode="r:*") as archive:
                candidates = [
                    member for member in archive
                    if member.isfile() and PurePosixPath(member.name).name == "PKG-INFO"
                ]
                if candidates:
                    depth = min(len(PurePosixPath(member.name).parts) for member in candidates)
                    candidates = [
                        member for member in candidates
                        if len(PurePosixPath(member.name).parts) == depth
                    ]
                if len(candidates) != 1:
                    raise ValueError("Source archive must contain exactly one PKG-INFO")
                member = candidates[0]
                if member.size > _MAX_DISTRIBUTION_METADATA_SIZE:
                    raise ValueError("PKG-INFO exceeds the allowed size")
                metadata_file = archive.extractfile(member)
                if metadata_file is None:
                    raise ValueError("Could not read source archive PKG-INFO")
                with metadata_file:
                    metadata_bytes = metadata_file.read(_MAX_DISTRIBUTION_METADATA_SIZE + 1)
                if len(metadata_bytes) > _MAX_DISTRIBUTION_METADATA_SIZE:
                    raise ValueError("PKG-INFO exceeds the allowed size")
                return _metadata_from_bytes(metadata_bytes)
        except tarfile.TarError as exc:
            raise ValueError("Invalid source archive") from exc

    return None
