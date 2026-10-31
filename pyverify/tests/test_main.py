import hashlib

from pyverify.main import calculate_sha256


def test_calculate_sha256(tmp_path):
    test_file = tmp_path / "sample.txt"
    test_file.write_bytes(b"Hello PyVerify")

    expected = hashlib.sha256(b"Hello PyVerify").hexdigest()

    assert calculate_sha256(str(test_file)) == expected