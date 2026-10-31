import asyncio
import base64
import csv
import hashlib
import io
import tarfile
from threading import Event
import time
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from pyverify import _http, source_trace


COMMIT = "abcdef0123456789abcdef0123456789abcdef01"
REPO = "octo/demo"


def verified_claim(repository=REPO, commit=COMMIT, *, verified=True, predicate_type="https://slsa.dev/provenance/v1"):
    dependency = {
        "uri": "git+https://github.com/{}/{}@refs/heads/main".format(*repository.split("/")),
        "digest": {"gitCommit": commit},
    }
    return {
        "attestations": [
            {
                "cryptographically_verified": verified,
                "predicate_type": predicate_type,
                "predicate": {"buildDefinition": {"resolvedDependencies": [dependency]}},
            }
        ],
        "verified": True,
        "status": "verified",
    }


def make_snapshot(path, files=None, *, extra_members=()):
    files = files or {"pkg/mod.py": b"same source\n"}
    root = "demo-{}".format(COMMIT[:7])
    with tarfile.open(path, "w:gz") as archive:
        root_info = tarfile.TarInfo(root + "/")
        root_info.type = tarfile.DIRTYPE
        archive.addfile(root_info)
        for name, content in files.items():
            info = tarfile.TarInfo(root + "/" + name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
        for member, fileobj in extra_members:
            archive.addfile(member, fileobj)


def make_sdist(path, files=None):
    files = files or {"pkg/mod.py": b"same source\n"}
    contents = {
        "PKG-INFO": b"Name: demo\nVersion: 1.0\n\n",
        "pyproject.toml": b'[project]\nname = "demo"\nversion = "1.0"\n',
        **files,
    }
    with tarfile.open(path, "w:gz") as archive:
        root = tarfile.TarInfo("demo-1.0/")
        root.type = tarfile.DIRTYPE
        archive.addfile(root)
        for name, content in contents.items():
            info = tarfile.TarInfo("demo-1.0/" + name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))


def make_wheel(path, files=None):
    files = {
        "demo-1.0.dist-info/METADATA": b"Name: demo\nVersion: 1.0\n\n",
        "demo-1.0.dist-info/WHEEL": b"Wheel-Version: 1.0\n",
        **(files or {"pkg/mod.py": b"same source\n"}),
    }
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


def mock_verified(monkeypatch, result=None):
    # This mock starts after the existing PEP 740 verifier. It tests source
    # resolution/transport, not cryptographic validity of a made-up signature.
    monkeypatch.setattr(
        source_trace,
        "verify_pypi_provenance",
        lambda *args, **kwargs: {
            "cryptographic_verification": result or verified_claim()
        },
    )


def mock_source_response(monkeypatch, body, *, headers=None, final_url=None, status=200):
    recorded = {}

    class Response:
        def __init__(self):
            self.url = final_url or "https://codeload.github.com/octo/demo/tar.gz/" + COMMIT
            self.status = status
            self.headers = headers if headers is not None else {"content-length": str(len(body))}

        def close(self):
            recorded["closed"] = True

        async def iter_bytes(self, chunk_size, max_bytes):
            recorded["chunk_size"] = chunk_size
            recorded["max_bytes"] = max_bytes
            yield body

    async def fake_open(url, *, allowed_host, deadline):
        recorded.update(url=url, allowed_host=allowed_host, deadline=deadline)
        return Response()

    monkeypatch.setattr(source_trace, "open_https_response", fake_open)
    return recorded


def run_trace(
    monkeypatch,
    tmp_path,
    *,
    source_files=None,
    sdist_files=None,
    wheel_files=None,
    expected_repository=REPO,
    max_source_size=1024 * 1024,
    max_members=100_000,
    max_member_size=512 * 1024 * 1024,
    max_uncompressed_size=2 * 1024 * 1024 * 1024,
    source_body=None,
):
    source = tmp_path / "snapshot.tar.gz"
    sdist = tmp_path / "demo-1.0.tar.gz"
    wheel = tmp_path / "demo-1.0-py3-none-any.whl"
    if source_body is None:
        make_snapshot(source, source_files)
        source_body = source.read_bytes()
    make_sdist(sdist, sdist_files)
    make_wheel(wheel, wheel_files)
    recorded = mock_source_response(monkeypatch, source_body)
    mock_verified(monkeypatch)
    result = source_trace.verify_source_trace(
        wheel, object(), sdist, wheel, "demo", "1.0",
        expected_source_repository=expected_repository,
        max_source_size=max_source_size,
        max_members=max_members,
        max_member_size=max_member_size,
        max_uncompressed_size=max_uncompressed_size,
    )
    return result, recorded


def test_resolves_only_verified_slsa_v1_and_pinned_commit():
    resolved = source_trace._resolve_verified_source_reference(verified_claim())
    assert resolved["status"] == "resolved"
    assert resolved["repository"] == REPO
    assert resolved["commit"] == COMMIT

    unverified = source_trace._resolve_verified_source_reference(verified_claim(verified=False))
    assert unverified["status"] == "unavailable"
    wrong_type = source_trace._resolve_verified_source_reference(
        verified_claim(predicate_type="https://docs.pypi.org/attestations/publish/v1")
    )
    assert wrong_type["status"] == "unavailable"


@pytest.mark.parametrize("commit", ["main", "a" * 39, "g" * 40, "a" * 65])
def test_invalid_commit_does_not_resolve_or_fetch(monkeypatch, tmp_path, commit):
    sdist = tmp_path / "demo-1.0.tar.gz"
    wheel = tmp_path / "demo.whl"
    make_sdist(sdist)
    make_wheel(wheel)
    mock_verified(monkeypatch, verified_claim(commit=commit))
    result = source_trace.verify_source_trace(
        wheel, object(), sdist, wheel,
        "demo", "1.0", expected_source_repository=REPO,
    )
    assert result["commit_resolution"]["status"] == "invalid"
    assert result["verdict"]["status"] == "WARNING"


def test_malformed_github_uri_is_not_used_as_source():
    claim = verified_claim()
    claim["attestations"][0]["predicate"]["buildDefinition"]["resolvedDependencies"][0]["uri"] = (
        "https://github.com.attacker.example/octo/demo@refs/heads/main"
    )
    assert source_trace._resolve_verified_source_reference(claim)["status"] == "invalid"


def test_conflicting_verified_source_claims_are_ambiguous():
    result = verified_claim()
    conflict = verified_claim(repository="another/repo", commit="1" * 40)["attestations"][0]
    result["attestations"].append(conflict)
    assert source_trace._resolve_verified_source_reference(result)["status"] == "ambiguous"


def test_repository_policy_mismatch_stops_before_fetch(monkeypatch, tmp_path):
    sdist = tmp_path / "demo-1.0.tar.gz"
    wheel = tmp_path / "demo.whl"
    make_sdist(sdist)
    make_wheel(wheel)
    mock_verified(monkeypatch)

    async def should_not_fetch(*args, **kwargs):
        raise AssertionError("must not fetch a policy-mismatched source")

    monkeypatch.setattr(source_trace, "open_https_response", should_not_fetch)
    result = source_trace.verify_source_trace(
        wheel, object(), sdist, wheel,
        "demo", "1.0", expected_source_repository="someone/else",
    )
    assert result["repository_policy"]["status"] == "mismatch"
    assert result["verdict"]["status"] == "FAIL"


def test_source_trace_matches_source_sdist_and_wheel(monkeypatch, tmp_path):
    result, recorded = run_trace(monkeypatch, tmp_path)

    assert result["source_reference"]["commit"] == COMMIT
    assert result["source_inventory"]["status"] == "SOURCE_INVENTORY_COMPLETE"
    assert result["file_comparison"]["status"] == "RELEASE_FILES_MATCH"
    assert result["file_comparison"]["comparisons"]["source_to_sdist"]["counts"]["matching"] == 1
    # The local-file API has not fetched PyPI JSON for both archives, so it
    # must not promote a complete static comparison to PASS.
    assert result["verdict"]["status"] == "WARNING"
    assert recorded["allowed_host"] == "codeload.github.com"
    assert recorded["url"].endswith("/octo/demo/tar.gz/" + COMMIT)
    assert recorded["closed"] is True
    assert not list(tmp_path.glob("pyverify-source-*"))


@pytest.mark.parametrize(
    "source_files,sdist_files,wheel_files,expected",
    [
        ({"pkg/mod.py": b"source"}, {"pkg/mod.py": b"sdist"}, {"pkg/mod.py": b"wheel"}, "DIFFER"),
        ({"pkg/source.py": b"source"}, {"pkg/source.py": b"source"}, {"pkg/extra.py": b"extra"}, "PARTIAL"),
        ({"pkg_a/mod.py": b"source"}, {"pkg_b/mod.py": b"source"}, {"pkg_c/mod.py": b"wheel"}, "PARTIAL"),
    ],
)
def test_source_trace_reports_modified_missing_additional_and_ambiguous_files(
    monkeypatch, tmp_path, source_files, sdist_files, wheel_files, expected
):
    result, _ = run_trace(
        monkeypatch, tmp_path, source_files=source_files,
        sdist_files=sdist_files, wheel_files=wheel_files,
    )
    assert result["file_comparison"]["status"] == "RELEASE_FILES_" + expected
    assert result["verdict"]["status"] == "WARNING"
    if expected == "DIFFER":
        assert result["file_comparison"]["comparisons"]["source_to_sdist"]["modified_files"]
    if expected == "PARTIAL":
        edge = result["file_comparison"]["comparisons"]["source_to_wheel"]
        assert edge["missing_files"] or edge["ambiguous_files"]
        if "pkg/extra.py" in wheel_files:
            assert edge["additional_files"]


def test_source_trace_missing_provenance_is_partial_not_pass(tmp_path):
    result = source_trace.verify_source_trace(
        tmp_path / "artifact.whl", None, tmp_path / "demo.tar.gz", tmp_path / "demo.whl",
        "demo", "1.0",
    )
    assert result["status"] == "SOURCE_TRACE_PARTIAL"
    assert result["source_reference"]["status"] == "unavailable"
    assert result["verdict"]["status"] == "WARNING"


def test_existing_genuine_pypi_fixture_is_verified_but_non_slsa_is_partial(monkeypatch, tmp_path):
    from pypi_attestations import Provenance

    fixture_dir = Path(__file__).parent / "fixtures"
    artifact = fixture_dir / "pypi_attestations-0.0.19.tar.gz"
    provenance = Provenance.model_validate_json(
        (fixture_dir / (artifact.name + ".provenance")).read_bytes()
    )
    monkeypatch.setattr(
        source_trace,
        "open_https_response",
        lambda *args, **kwargs: pytest.fail("non-SLSA provenance must not trigger source fetch"),
    )
    result = source_trace.verify_source_trace(
        artifact, provenance, artifact, artifact,
        "pypi-attestations", "0.0.19",
    )
    assert result["cryptographic_verification"]["verified"] is True
    assert result["source_reference"]["status"] == "unavailable"
    assert result["verdict"]["status"] == "WARNING"


def test_pypi_workflow_reports_missing_provenance_without_pass(monkeypatch, tmp_path):
    sdist = tmp_path / "demo-1.0.tar.gz"
    wheel = tmp_path / "demo-1.0-py3-none-any.whl"
    make_sdist(sdist)
    make_wheel(wheel)

    async def release_metadata(project_name, version, filename, deadline):
        path = sdist if filename == sdist.name else wheel
        return {
            "filename": filename,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "size": path.stat().st_size,
        }

    monkeypatch.setattr(
        source_trace, "_get_pypi_artifact_metadata_with_deadline", release_metadata
    )

    def missing(*args, **kwargs):
        raise source_trace.ProvenanceNotFoundError("no provenance")

    monkeypatch.setattr(source_trace, "get_pypi_provenance", missing)
    result = source_trace.verify_pypi_source_trace(
        wheel, "demo", "1.0", wheel.name, sdist, wheel,
    )
    assert result["source_reference"]["status"] == "unavailable"
    assert result["verdict"]["status"] == "WARNING"


def test_pypi_workflow_checks_release_hashes_before_source_trace(monkeypatch, tmp_path):
    source = tmp_path / "snapshot.tar.gz"
    sdist = tmp_path / "demo-1.0.tar.gz"
    wheel = tmp_path / "demo-1.0-py3-none-any.whl"
    make_snapshot(source)
    make_sdist(sdist)
    make_wheel(wheel)
    mock_source_response(monkeypatch, source.read_bytes())
    mock_verified(monkeypatch)
    monkeypatch.setattr(source_trace, "get_pypi_provenance", lambda *args, **kwargs: object())

    async def release_metadata(project_name, version, filename, deadline):
        path = sdist if filename == sdist.name else wheel
        return {
            "filename": filename,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "size": path.stat().st_size,
        }

    monkeypatch.setattr(
        source_trace, "_get_pypi_artifact_metadata_with_deadline", release_metadata
    )
    result = source_trace.verify_pypi_source_trace(
        wheel, "demo", "1.0", wheel.name, sdist, wheel,
        expected_source_repository=REPO,
    )

    assert result["release_artifact_hashes"]["status"] == "verified"
    assert result["status"] == "SOURCE_TRACE_COMPLETE"
    assert result["file_comparison"]["status"] == "RELEASE_FILES_MATCH"
    assert result["verdict"]["status"] == "PASS"


def test_pypi_workflow_fails_when_local_release_file_differs_from_pypi(monkeypatch, tmp_path):
    sdist = tmp_path / "demo-1.0.tar.gz"
    wheel = tmp_path / "demo-1.0-py3-none-any.whl"
    make_sdist(sdist)
    make_wheel(wheel)

    async def bad_metadata(project_name, version, filename, deadline):
        path = sdist if filename == sdist.name else wheel
        return {
            "filename": filename,
            "sha256": "0" * 64,
            "size": path.stat().st_size,
        }

    def must_not_fetch_provenance(*args, **kwargs):
        raise AssertionError("mismatched local artifacts must stop before provenance use")

    monkeypatch.setattr(source_trace, "_get_pypi_artifact_metadata_with_deadline", bad_metadata)
    monkeypatch.setattr(source_trace, "get_pypi_provenance", must_not_fetch_provenance)
    result = source_trace.verify_pypi_source_trace(
        wheel, "demo", "1.0", wheel.name, sdist, wheel,
    )
    assert result["release_artifact_hashes"]["status"] == "failed"
    assert result["verdict"]["status"] == "FAIL"


@pytest.mark.parametrize("kind", ["unsafe", "duplicate", "special", "malformed"])
def test_source_snapshot_rejects_hostile_tar_members(monkeypatch, tmp_path, kind):
    snapshot = tmp_path / "snapshot.tar.gz"
    if kind == "malformed":
        body = b"not a gzip tar"
    else:
        name = {
            "unsafe": "../escape.py",
            "duplicate": "demo-abcdef0/pkg/mod.py",
            "special": "demo-abcdef0/device",
        }[kind]
        member = tarfile.TarInfo(name)
        if kind == "special":
            member.type = tarfile.FIFOTYPE
            fileobj = None
        else:
            member.size = 1
            fileobj = io.BytesIO(b"x")
        extras = [(member, fileobj)]
        if kind == "duplicate":
            make_snapshot(snapshot, extra_members=extras)
        else:
            make_snapshot(snapshot, extra_members=extras)
        body = snapshot.read_bytes()
    result, _ = run_trace(monkeypatch, tmp_path, source_body=body)
    assert result["source_inventory"]["status"] == "SOURCE_INVENTORY_INCOMPLETE"


def test_source_snapshot_rejects_unsafe_link_and_oversized_archives(monkeypatch, tmp_path):
    link = tarfile.TarInfo("demo-abcdef0/link.py")
    link.type = tarfile.SYMTYPE
    link.linkname = "../outside"
    buffer = tmp_path / "snapshot.tar.gz"
    make_snapshot(buffer, extra_members=[(link, None)])
    link_result, _ = run_trace(monkeypatch, tmp_path, source_body=buffer.read_bytes())
    assert link_result["source_inventory"]["status"] == "SOURCE_INVENTORY_INCOMPLETE"

    normal = tmp_path / "normal.tar.gz"
    make_snapshot(normal)
    size_result, _ = run_trace(monkeypatch, tmp_path, source_body=normal.read_bytes(), max_source_size=1)
    assert size_result["source_inventory"]["status"] == "SOURCE_INVENTORY_INCOMPLETE"


def test_source_snapshot_stream_enforces_limit_without_content_length(monkeypatch, tmp_path):
    snapshot = tmp_path / "snapshot.tar.gz"
    sdist = tmp_path / "demo-1.0.tar.gz"
    wheel = tmp_path / "demo.whl"
    make_snapshot(snapshot)
    make_sdist(sdist)
    make_wheel(wheel)
    mock_verified(monkeypatch)
    mock_source_response(monkeypatch, snapshot.read_bytes(), headers={})

    result = source_trace.verify_source_trace(
        wheel, object(), sdist, wheel, "demo", "1.0",
        expected_source_repository=REPO, max_source_size=1,
    )

    assert result["source_inventory"]["status"] == "SOURCE_INVENTORY_INCOMPLETE"


@pytest.mark.parametrize(
    "limit_name,limit_value",
    [("max_members", 1), ("max_member_size", 2), ("max_uncompressed_size", 2)],
)
def test_source_snapshot_enforces_inventory_limits(monkeypatch, tmp_path, limit_name, limit_value):
    snapshot = tmp_path / "snapshot.tar.gz"
    make_snapshot(snapshot, {"pkg/mod.py": b"this source is larger than two bytes"})
    result, _ = run_trace(
        monkeypatch,
        tmp_path,
        source_body=snapshot.read_bytes(),
        **{limit_name: limit_value},
    )
    assert result["source_inventory"]["status"] == "SOURCE_INVENTORY_INCOMPLETE"


def test_source_snapshot_rejects_untrusted_final_url(monkeypatch, tmp_path):
    body_path = tmp_path / "snapshot.tar.gz"
    make_snapshot(body_path)
    mock_verified(monkeypatch)
    mock_source_response(
        monkeypatch,
        body_path.read_bytes(),
        final_url="https://attacker.example/source.tar.gz",
    )
    sdist = tmp_path / "demo-1.0.tar.gz"
    wheel = tmp_path / "demo.whl"
    make_sdist(sdist)
    make_wheel(wheel)
    result = source_trace.verify_source_trace(wheel, object(), sdist, wheel, "demo", "1.0", expected_source_repository=REPO)
    assert result["source_inventory"]["status"] == "SOURCE_INVENTORY_INCOMPLETE"


def test_source_snapshot_deadline_cancels_a_blocked_open(monkeypatch, tmp_path):
    sdist = tmp_path / "demo-1.0.tar.gz"
    wheel = tmp_path / "demo.whl"
    make_sdist(sdist)
    make_wheel(wheel)
    mock_verified(monkeypatch)
    cancelled = Event()

    async def blocked(*args, **kwargs):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(source_trace, "open_https_response", blocked)
    result = source_trace.verify_source_trace(
        wheel, object(), sdist, wheel, "demo", "1.0",
        expected_source_repository=REPO, max_source_duration=0.05,
    )
    assert cancelled.is_set()
    assert result["source_inventory"]["status"] == "SOURCE_INVENTORY_INCOMPLETE"


def test_shared_transport_rejects_untrusted_redirect_before_connect(monkeypatch):
    calls = []

    class Reader:
        def __init__(self):
            self.lines = iter([b"HTTP/1.1 302 Found\r\n", b"Location: https://attacker.example/file\r\n", b"\r\n"])

        async def readline(self):
            return next(self.lines)

    class Writer:
        def write(self, data):
            pass

        async def drain(self):
            pass

        def close(self):
            pass

    async def fake_connection(host, *args, **kwargs):
        calls.append(host)
        return Reader(), Writer()

    monkeypatch.setattr(_http.asyncio, "open_connection", fake_connection)
    with pytest.raises(ValueError, match="Untrusted HTTPS URL"):
        asyncio.run(_http.open_https_response(
            "https://codeload.github.com/o/r/tar.gz/" + COMMIT,
            allowed_host="codeload.github.com",
            deadline=time.monotonic() + 5,
        ))
    assert calls == ["codeload.github.com"]
