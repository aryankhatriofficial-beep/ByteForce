"""Verify a local artifact against an expected SHA256 digest."""

import re
from pathlib import Path
from typing import Union

from pyverify.main import calculate_sha256


def verify_artifact_hash(
    file_path: Union[str, Path], expected_sha256: str
) -> dict[str, Union[str, bool]]:
    """Compare a file's SHA256 digest with an expected hexadecimal digest."""
    if not isinstance(expected_sha256, str) or re.fullmatch(
        r"[0-9a-fA-F]{64}", expected_sha256
    ) is None:
        raise ValueError("expected_sha256 must be exactly 64 hexadecimal characters")

    actual_sha256 = calculate_sha256(str(file_path))
    return {
        "expected_sha256": expected_sha256,
        "actual_sha256": actual_sha256,
        "matches": actual_sha256.lower() == expected_sha256.lower(),
    }
