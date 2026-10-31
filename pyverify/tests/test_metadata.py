from zipfile import ZipFile

import pytest

from pyverify.metadata import inspect_wheel


def make_wheel(path, metadata=None, metadata_path="demo-1.0.dist-info/METADATA"):
    with ZipFile(path, "w") as wheel:
        if metadata is not None:
            wheel.writestr(metadata_path, metadata)


def test_inspect_wheel_reads_metadata(tmp_path):
    wheel_path = tmp_path / "demo-1.0-py3-none-any.whl"
    make_wheel(
        wheel_path,
        "Name: Demo\n"
        "Version: 1.0\n"
        "Requires-Python: >=3.9\n"
        "Requires-Dist: requests>=2\n"
        "Requires-Dist: idna; python_version < '3.12'\n\n",
    )

    assert inspect_wheel(wheel_path) == {
        "name": "Demo",
        "version": "1.0",
        "requires_python": ">=3.9",
        "requires_dist": [
            "requests>=2",
            "idna; python_version < '3.12'",
        ],
    }


def test_inspect_wheel_handles_optional_fields(tmp_path):
    wheel_path = tmp_path / "demo-1.0-py3-none-any.whl"
    make_wheel(wheel_path, "Name: Demo\nVersion: 1.0\n\n")

    assert inspect_wheel(wheel_path) == {
        "name": "Demo",
        "version": "1.0",
        "requires_python": None,
        "requires_dist": [],
    }


def test_inspect_wheel_rejects_non_wheel_path(tmp_path):
    path = tmp_path / "archive.zip"
    path.write_bytes(b"not a wheel")

    with pytest.raises(ValueError, match=".whl"):
        inspect_wheel(path)


def test_inspect_wheel_rejects_invalid_archive(tmp_path):
    wheel_path = tmp_path / "broken.whl"
    wheel_path.write_bytes(b"not a zip archive")

    with pytest.raises(ValueError, match="Invalid wheel archive"):
        inspect_wheel(wheel_path)


def test_inspect_wheel_rejects_missing_metadata(tmp_path):
    wheel_path = tmp_path / "empty-1.0-py3-none-any.whl"
    make_wheel(wheel_path)

    with pytest.raises(ValueError, match="METADATA"):
        inspect_wheel(wheel_path)


def test_inspect_wheel_rejects_required_fields_missing(tmp_path):
    wheel_path = tmp_path / "demo-1.0-py3-none-any.whl"
    make_wheel(wheel_path, "Name: Demo\n\n")

    with pytest.raises(ValueError, match="Name and Version"):
        inspect_wheel(wheel_path)
