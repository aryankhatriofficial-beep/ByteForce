import hashlib
from pathlib import Path


def calculate_sha256(file_path: str) -> str:
    """Calculate the SHA256 hash of a file."""

    sha256 = hashlib.sha256()

    with Path(file_path).open("rb") as file:
        for chunk in iter(lambda: file.read(8192), b""):
            sha256.update(chunk)

    return sha256.hexdigest()