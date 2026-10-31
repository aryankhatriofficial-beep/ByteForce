import hashlib

import pytest

from pyverify.integrity import verify_artifact_hash


def test_verify_artifact_hash_matches(tmp_path):
    artifact = tmp_path / "artifact.bin"
    artifact.write_bytes(b"PyVerify artifact")
    expected = hashlib.sha256(b"PyVerify artifact").hexdigest()

    result = verify_artifact_hash(artifact, expected.upper())

    assert result == {
        "expected_sha256": expected.upper(),
        "actual_sha256": expected,
        "matches": True,
    }


def test_verify_artifact_hash_mismatches(tmp_path):
    artifact = tmp_path / "artifact.bin"
    artifact.write_bytes(b"PyVerify artifact")
    expected = hashlib.sha256(b"different content").hexdigest()

    result = verify_artifact_hash(artifact, expected)

    assert result["expected_sha256"] == expected
    assert result["actual_sha256"] == hashlib.sha256(b"PyVerify artifact").hexdigest()
    assert result["matches"] is False


@pytest.mark.parametrize("expected", ["", "a" * 63, "a" * 65, "g" * 64])
def test_verify_artifact_hash_rejects_invalid_expected_hash(tmp_path, expected):
    artifact = tmp_path / "artifact.bin"
    artifact.write_bytes(b"PyVerify artifact")

    with pytest.raises(ValueError, match="64 hexadecimal characters"):
        verify_artifact_hash(artifact, expected)
