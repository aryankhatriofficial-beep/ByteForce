"""Read package metadata from a local wheel archive without extracting it."""

from email import policy
from email.parser import BytesParser
from pathlib import Path
from typing import Union
from zipfile import BadZipFile, ZipFile


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

            message = BytesParser(policy=policy.default).parsebytes(
                archive.read(metadata_paths[0])
            )
    except BadZipFile as exc:
        raise ValueError("Invalid wheel archive") from exc

    name = message.get("Name")
    version = message.get("Version")
    if not name or not version:
        raise ValueError("Wheel METADATA must include Name and Version")

    requires_dist = message.get_all("Requires-Dist", [])
    return {
        "name": str(name),
        "version": str(version),
        "requires_python": message.get("Requires-Python"),
        "requires_dist": [str(dependency) for dependency in requires_dist],
    }
