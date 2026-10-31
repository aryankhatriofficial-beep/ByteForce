import base64
import csv
import hashlib
import io
import tarfile
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from pyverify.evidence import build_evidence_summary
from pyverify.release_consistency import compare_sdist_and_wheel
from pyverify.sdist import inspect_sdist


def make_sdist(path, source_files=None, *, pkg_info=None, pyproject=None, extras=()):
    source_files = source_files or {"demo.py": b"value = 1\n"}
    members = {
        "PKG-INFO": pkg_info or b"Name: demo\nVersion: 1.0\n\n",
        "pyproject.toml": pyproject or b'[project]\nname = "demo"\nversion = "1.0"\n',
    }
    members.update(source_files)
    with tarfile.open(path, "w:gz") as archive:
        root = tarfile.TarInfo("demo-1.0/")
        root.type = tarfile.DIRTYPE
        archive.addfile(root)
        for name, content in members.items():
            info = tarfile.TarInfo("demo-1.0/" + name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
        for member, fileobj in extras:
            archive.addfile(member, fileobj)
    return members


def make_wheel(path, source_files=None):
    source_files = source_files or {"demo.py": b"value = 1\n"}
    files = {
        "demo-1.0.dist-info/METADATA": b"Name: demo\nVersion: 1.0\n\n",
        "demo-1.0.dist-info/WHEEL": b"Wheel-Version: 1.0\n",
    }
    files.update(source_files)
    record = io.StringIO(newline="")
    writer = csv.writer(record, lineterminator="\n")
    for name, content in files.items():
        digest = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).decode().rstrip("=")
        writer.writerow((name, "sha256=" + digest, str(len(content))))
    writer.writerow(("demo-1.0.dist-info/RECORD", "", ""))
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
        archive.writestr("demo-1.0.dist-info/RECORD", record.getvalue())


def test_sdist_streams_inventory_and_validates_release_identity(tmp_path):
    path = tmp_path / "demo-1.0.tar.gz"
    make_sdist(path)

    result = inspect_sdist(path, "demo", "1.0")

    assert result["status"] == "SDIST_INVENTORY_COMPLETE"
    source = next(entry for entry in result["entries"] if entry["relative_path"] == "demo.py")
    assert source["sha256"] == hashlib.sha256(b"value = 1\n").hexdigest()
    assert result["metadata"]["matches_requested_release"] is True
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.parametrize("kind", ["unsafe", "duplicate", "link", "special", "multiple_roots"])
def test_sdist_rejects_malicious_or_ambiguous_archive_structures(tmp_path, kind):
    path = tmp_path / "demo-1.0.tar.gz"
    if kind == "unsafe":
        extra = [tarfile.TarInfo("../escape")]
        extra[0].size = 1
        make_sdist(path, extras=[(extra[0], io.BytesIO(b"x"))])
    elif kind == "duplicate":
        duplicate = tarfile.TarInfo("demo-1.0/demo.py")
        duplicate.size = 1
        make_sdist(path, extras=[(duplicate, io.BytesIO(b"x"))])
    elif kind == "link":
        link = tarfile.TarInfo("demo-1.0/link.py")
        link.type = tarfile.SYMTYPE
        link.linkname = "demo.py"
        make_sdist(path, extras=[(link, None)])
    elif kind == "special":
        special = tarfile.TarInfo("demo-1.0/device")
        special.type = tarfile.FIFOTYPE
        make_sdist(path, extras=[(special, None)])
    else:
        second_root = tarfile.TarInfo("other-1.0/file.py")
        second_root.size = 1
        make_sdist(path, extras=[(second_root, io.BytesIO(b"x"))])

    result = inspect_sdist(path, "demo", "1.0")
    assert result["status"] == "SDIST_INVENTORY_INCOMPLETE"


def test_sdist_enforces_member_file_and_total_size_limits(tmp_path):
    path = tmp_path / "demo-1.0.tar.gz"
    make_sdist(path, {"large.py": b"123456"})

    assert inspect_sdist(path, "demo", "1.0", max_members=2)["status"] == "SDIST_INVENTORY_INCOMPLETE"
    assert inspect_sdist(path, "demo", "1.0", max_member_size=4)["status"] == "SDIST_INVENTORY_INCOMPLETE"
    assert inspect_sdist(path, "demo", "1.0", max_uncompressed_size=5)["status"] == "SDIST_INVENTORY_INCOMPLETE"
    assert inspect_sdist(path, "demo", "1.0", max_archive_size=1)["status"] == "SDIST_INVENTORY_INCOMPLETE"


@pytest.mark.parametrize(
    "pkg_info,pyproject,filename,version",
    [
        (b"Name: other\nVersion: 1.0\n\n", None, "demo-1.0.tar.gz", "1.0"),
        (b"Name: demo\nVersion: 2.0\n\n", None, "demo-1.0.tar.gz", "1.0"),
        (None, b"not = [valid toml", "demo-1.0.tar.gz", "1.0"),
        (None, None, "demo-2.0.tar.gz", "1.0"),
    ],
)
def test_sdist_rejects_invalid_or_mismatched_metadata(tmp_path, pkg_info, pyproject, filename, version):
    path = tmp_path / filename
    make_sdist(path, pkg_info=pkg_info, pyproject=pyproject)

    assert inspect_sdist(path, "demo", version)["status"] == "SDIST_INVENTORY_INCOMPLETE"


@pytest.mark.parametrize(
    "sdist_files,wheel_files,expected",
    [
        ({"pkg/mod.py": b"same"}, {"pkg/mod.py": b"same"}, "RELEASE_FILES_MATCH"),
        ({"pkg/mod.py": b"source"}, {"pkg/mod.py": b"changed"}, "RELEASE_FILES_DIFFER"),
        ({"pkg/mod.py": b"source", "docs.py": b"docs"}, {"pkg/mod.py": b"source"}, "RELEASE_FILES_PARTIAL"),
        ({"pkg_a/mod.py": b"source"}, {"pkg_b/mod.py": b"wheel"}, "RELEASE_FILES_PARTIAL"),
    ],
)
def test_release_consistency_compares_only_unambiguous_python_files(
    tmp_path, sdist_files, wheel_files, expected
):
    sdist = tmp_path / "demo-1.0.tar.gz"
    wheel = tmp_path / "demo-1.0-py3-none-any.whl"
    make_sdist(sdist, sdist_files)
    make_wheel(wheel, wheel_files)

    result = compare_sdist_and_wheel(sdist, wheel, "demo", "1.0")

    assert result["status"] == expected
    has_same_module = (
        "pkg/mod.py" in sdist_files
        and "pkg/mod.py" in wheel_files
        and sdist_files["pkg/mod.py"] == wheel_files["pkg/mod.py"]
    )
    assert result["counts"]["matching_files"] == (1 if has_same_module else 0)
    if expected == "RELEASE_FILES_DIFFER":
        assert result["mismatched_files"][0]["path"] == "pkg/mod.py"
    if expected == "RELEASE_FILES_PARTIAL" and "pkg_a/mod.py" in sdist_files:
        assert result["ambiguous_mappings"]


def test_release_comparison_difference_is_warning_in_evidence(tmp_path):
    sdist = tmp_path / "demo-1.0.tar.gz"
    wheel = tmp_path / "demo-1.0-py3-none-any.whl"
    make_sdist(sdist, {"pkg/mod.py": b"source"})
    make_wheel(wheel, {"pkg/mod.py": b"changed"})
    comparison = compare_sdist_and_wheel(sdist, wheel, "demo", "1.0")
    summary = build_evidence_summary(
        {"matches": True}, {"status": "available"}, {"status": "verified"},
        {"configured": True, "matches": True}, {"status": "matched", "matches": True},
        {"status": "RECORD_VALID"}, {"status": "INVENTORY_COMPLETE"},
        comparison["sdist_inventory"], comparison,
    )

    assert summary["verdict"]["status"] == "WARNING"
    assert any("comparison is differ" in warning for warning in summary["warnings"])
