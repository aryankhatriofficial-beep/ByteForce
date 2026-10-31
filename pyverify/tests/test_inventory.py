import base64
import csv
import hashlib
import io
import warnings
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from pyverify.inventory import inspect_wheel_integrity, inventory_zip_artifact


RECORD_PATH = "demo-1.0.dist-info/RECORD"


def record_bytes(files, *, replacements=None, extra_rows=()):
    replacements = replacements or {}
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    for path, content in files.items():
        digest = base64.urlsafe_b64encode(hashlib.sha256(content).digest())
        hash_spec = "sha256=" + digest.decode("ascii").rstrip("=")
        size = str(len(content))
        hash_spec, size = replacements.get(path, (hash_spec, size))
        writer.writerow((path, hash_spec, size))
    writer.writerow((RECORD_PATH, "", ""))
    for row in extra_rows:
        writer.writerow(row)
    return output.getvalue().encode("utf-8")


def create_wheel(path, *, record=None, extra=(), duplicate_record=False):
    files = {
        "demo-1.0.dist-info/METADATA": b"Name: demo\nVersion: 1.0\n\n",
        "demo-1.0.dist-info/WHEEL": b"Wheel-Version: 1.0\n",
        "demo.py": b"value = 1\n",
    }
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
        archive.writestr(RECORD_PATH, record if record is not None else record_bytes(files))
        if duplicate_record:
            archive.writestr(RECORD_PATH, b"duplicate")
        for name, content in extra:
            archive.writestr(name, content)
    return files


def test_valid_wheel_has_complete_inventory_and_valid_record(tmp_path):
    wheel = tmp_path / "demo-1.0-py3-none-any.whl"
    create_wheel(wheel)

    result = inspect_wheel_integrity(wheel)

    assert result["artifact_inventory"]["status"] == "INVENTORY_COMPLETE"
    assert result["record_integrity"]["status"] == "RECORD_VALID"
    assert len(result["artifact_inventory"]["entries"]) == 4
    assert all(len(item["hashes"]["sha256"]) == 64 for item in result["artifact_inventory"]["entries"])


@pytest.mark.parametrize("damage", ["altered", "bad_hash", "bad_size"])
def test_record_detects_changed_or_mismatched_file_data(tmp_path, damage):
    wheel = tmp_path / "demo.whl"
    files = create_wheel(wheel)
    if damage == "altered":
        with ZipFile(wheel, "w", ZIP_DEFLATED) as archive:
            for name, value in files.items():
                archive.writestr(name, b"changed\n" if name == "demo.py" else value)
            archive.writestr(RECORD_PATH, record_bytes(files))
    elif damage == "bad_hash":
        wrong = base64.urlsafe_b64encode(hashlib.sha256(b"wrong").digest()).decode().rstrip("=")
        files = dict(files)
        data = record_bytes(files, replacements={"demo.py": ("sha256=" + wrong, str(len(files["demo.py"])))})
        with ZipFile(wheel, "w", ZIP_DEFLATED) as archive:
            for name, value in files.items():
                archive.writestr(name, value)
            archive.writestr(RECORD_PATH, data)
    else:
        data = record_bytes(
            files,
            replacements={"demo.py": ("sha256=" + base64.urlsafe_b64encode(hashlib.sha256(files["demo.py"]).digest()).decode().rstrip("="), "999")},
        )
        with ZipFile(wheel, "w", ZIP_DEFLATED) as archive:
            for name, value in files.items():
                archive.writestr(name, value)
            archive.writestr(RECORD_PATH, data)

    result = inspect_wheel_integrity(wheel)
    assert result["record_integrity"]["status"] == "RECORD_INVALID"


def test_record_detects_missing_file_and_unexpected_file(tmp_path):
    missing = tmp_path / "missing.whl"
    files = {
        "demo-1.0.dist-info/METADATA": b"metadata",
        "demo.py": b"module",
        "gone.py": b"gone",
    }
    with ZipFile(missing, "w") as archive:
        archive.writestr("demo-1.0.dist-info/METADATA", files["demo-1.0.dist-info/METADATA"])
        archive.writestr("demo.py", files["demo.py"])
        archive.writestr(RECORD_PATH, record_bytes(files))
    assert "missing file" in " ".join(inspect_wheel_integrity(missing)["record_integrity"]["errors"])

    unexpected = tmp_path / "unexpected.whl"
    create_wheel(unexpected, extra=(("surprise.py", b"surprise"),))
    assert "Unexpected archive file" in " ".join(
        inspect_wheel_integrity(unexpected)["record_integrity"]["errors"]
    )


def test_record_detects_malformed_record_and_duplicate_rows(tmp_path):
    malformed = tmp_path / "malformed.whl"
    create_wheel(malformed, record=b"one,two\n")
    assert inspect_wheel_integrity(malformed)["record_integrity"]["status"] == "RECORD_INVALID"

    duplicate = tmp_path / "duplicate-row.whl"
    files = {
        "demo-1.0.dist-info/METADATA": b"metadata",
        "demo.py": b"module",
    }
    row = ("demo.py", "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(files["demo.py"]).digest()).decode().rstrip("="), str(len(files["demo.py"])))
    create_wheel(duplicate, record=record_bytes(files, extra_rows=(row,)))
    assert "Duplicate RECORD entry" in " ".join(
        inspect_wheel_integrity(duplicate)["record_integrity"]["errors"]
    )


def test_inventory_rejects_duplicate_archive_paths_and_unsafe_paths(tmp_path):
    duplicate = tmp_path / "duplicate.zip"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with ZipFile(duplicate, "w") as archive:
            archive.writestr("same", b"one")
            archive.writestr("same", b"two")
    assert inventory_zip_artifact(duplicate)["status"] == "INVENTORY_INCOMPLETE"

    unsafe = tmp_path / "unsafe.zip"
    with ZipFile(unsafe, "w") as archive:
        archive.writestr("../escape", b"no")
    result = inventory_zip_artifact(unsafe)
    assert result["status"] == "INVENTORY_INCOMPLETE"
    assert any("Unsafe archive path" in error for error in result["errors"])


def test_inventory_enforces_archive_member_and_total_size_limits(tmp_path):
    archive_path = tmp_path / "limited.zip"
    with ZipFile(archive_path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("a", b"1234")
        archive.writestr("b", b"5678")

    assert inventory_zip_artifact(archive_path, max_archive_size=1)["status"] == "INVENTORY_INCOMPLETE"
    assert inventory_zip_artifact(archive_path, max_members=1)["status"] == "INVENTORY_INCOMPLETE"
    assert inventory_zip_artifact(archive_path, max_member_size=3)["status"] == "INVENTORY_INCOMPLETE"
    assert inventory_zip_artifact(archive_path, max_uncompressed_size=7)["status"] == "INVENTORY_INCOMPLETE"


def test_inventory_reports_malformed_zip(tmp_path):
    path = tmp_path / "broken.zip"
    path.write_bytes(b"not a zip")

    result = inventory_zip_artifact(path)

    assert result["status"] == "INVENTORY_INCOMPLETE"
    assert any("Malformed" in error for error in result["errors"])
