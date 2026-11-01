import asyncio
import json
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from pyverify import api


@pytest.fixture(scope="module")
def api_server():
    server = api.create_server(0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield "http://127.0.0.1:{}".format(server.server_port)
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


def request(url, *, method="GET", body=None, headers=None):
    data = None if body is None else body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
    request_obj = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        response = urllib.request.urlopen(request_obj, timeout=3)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers, exc.read()
    with response:
        return response.status, response.headers, response.read()


def backend_result():
    verdict = {"status": "WARNING", "reasons": ["optional provenance not checked"]}
    evidence = {
        "artifact_hash": {
            "expected_sha256": "a" * 64,
            "actual_sha256": "a" * 64,
            "matches": True,
        },
        "distribution_metadata": {"status": "matched", "matches": True},
        "provenance_availability": {"status": "not_checked", "available": None},
        "cryptographic_verification": {"status": "not_checked", "verified": None},
        "publisher_policy": {"configured": False, "matches": None},
        "wheel_record": {"status": "RECORD_VALID", "valid": True},
        "artifact_inventory": {"status": "INVENTORY_COMPLETE", "complete": True},
        "sdist_inventory": {"status": "NOT_APPLICABLE", "complete": None},
        "release_consistency": {"status": "NOT_CHECKED"},
        "source_trace": {"status": "NOT_CHECKED"},
        "verdict": verdict,
    }
    return {
        "project_name": "demo",
        "version": "1.0",
        "filename": "demo-1.0-py3-none-any.whl",
        "expected_sha256": "a" * 64,
        "actual_sha256": "a" * 64,
        "matches": True,
        "evidence_summary": evidence,
        "verdict": verdict,
    }


def valid_payload(**overrides):
    payload = {
        "project": "demo",
        "version": "1.0",
        "filename": "demo-1.0-py3-none-any.whl",
    }
    payload.update(overrides)
    return payload


def test_health_endpoint_returns_json(api_server):
    status, headers, body = request(api_server + "/api/health")

    assert status == 200
    assert headers.get_content_type() == "application/json"
    assert json.loads(body) == {"status": "ok", "service": "pyverify"}


def test_valid_request_calls_existing_verifier_and_returns_evidence_map(api_server, monkeypatch):
    captured = {}

    def fake_verify(project, version, filename, **kwargs):
        captured.update(project=project, version=version, filename=filename, **kwargs)
        return backend_result()

    monkeypatch.setattr(api, "verify_pypi_artifact", fake_verify)
    payload = valid_payload(
        verify_attestations=True,
        expected_github_repository="octo/demo",
        expected_workflow_filename="release.yml",
    )
    status, _, body = request(
        api_server + "/api/v1/verify",
        method="POST",
        body=payload,
        headers={"Content-Type": "application/json"},
    )
    response = json.loads(body)

    assert status == 200
    assert captured == {
        "project": "demo",
        "version": "1.0",
        "filename": "demo-1.0-py3-none-any.whl",
        "verify_attestations": True,
        "expected_github_repository": "octo/demo",
        "expected_workflow_filename": "release.yml",
    }
    assert response["verdict"] == backend_result()["verdict"]
    assert response["verification"] == backend_result()
    assert response["evidence"]["artifact_sha256"]["status"] == "MATCH"
    assert response["evidence"]["distribution_metadata"]["status"] == "matched"
    assert response["evidence"]["provenance_availability"]["status"] == "not_checked"
    assert response["evidence"]["wheel_record"]["status"] == "RECORD_VALID"
    assert response["evidence"]["wheel_inventory"]["status"] == "INVENTORY_COMPLETE"
    assert response["evidence"]["sdist_inventory"]["status"] == "NOT_APPLICABLE"
    assert response["evidence"]["artifact_sha256"]["stage_status"] == "VERIFIED"
    assert response["evidence"]["publisher_policy"]["stage_status"] == "NOT_CONFIGURED"
    assert response["evidence"]["source_trace"] == {
        "status": "NOT_CHECKED", "checked": False, "stage_status": "NOT_CHECKED"
    }


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {"project": "demo", "version": "1.0"},
        valid_payload(project=2),
        valid_payload(verify_attestations="yes"),
        valid_payload(filename="../demo.whl"),
        valid_payload(unrecognized="x"),
        valid_payload(expected_workflow_filename="release.yml"),
    ],
)
def test_invalid_payloads_return_consistent_json_errors(api_server, payload):
    status, headers, body = request(
        api_server + "/api/v1/verify",
        method="POST",
        body=payload,
        headers={"Content-Type": "application/json"},
    )

    assert status == 400
    assert headers.get_content_type() == "application/json"
    error = json.loads(body)["error"]
    assert error["code"] == "INVALID_REQUEST"
    assert error["message"]


def test_malformed_json_is_rejected(api_server):
    status, _, body = request(
        api_server + "/api/v1/verify",
        method="POST",
        body=b"{invalid",
        headers={"Content-Type": "application/json"},
    )
    assert status == 400
    assert json.loads(body)["error"]["code"] == "INVALID_JSON"


def test_unsupported_content_type_is_rejected(api_server):
    status, _, body = request(
        api_server + "/api/v1/verify",
        method="POST",
        body=valid_payload(),
        headers={"Content-Type": "text/plain"},
    )
    assert status == 415
    assert json.loads(body)["error"]["code"] == "UNSUPPORTED_MEDIA_TYPE"


def test_request_size_limit_is_enforced(api_server, monkeypatch):
    monkeypatch.setattr(api, "MAX_REQUEST_BYTES", 10)
    status, _, body = request(
        api_server + "/api/v1/verify",
        method="POST",
        body=valid_payload(),
        headers={"Content-Type": "application/json"},
    )
    assert status == 413
    assert json.loads(body)["error"]["code"] == "REQUEST_TOO_LARGE"


@pytest.mark.parametrize(
    "origin,allowed",
    [
        ("http://localhost:5173", True),
        ("http://127.0.0.1:3000", True),
        ("http://localhost.evil.example", False),
        ("https://localhost:5173", False),
        ("http://192.168.1.10:5173", False),
        ("null", False),
    ],
)
def test_cors_accepts_only_local_frontend_origins(api_server, origin, allowed):
    status, headers, _ = request(
        api_server + "/api/health",
        headers={"Origin": origin},
    )
    if allowed:
        assert status == 200
        assert headers.get("Access-Control-Allow-Origin") == origin
    else:
        assert status == 403
        assert headers.get("Access-Control-Allow-Origin") is None


def test_cors_preflight_is_restricted(api_server):
    status, headers, _ = request(
        api_server + "/api/v1/verify",
        method="OPTIONS",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert status == 204
    assert headers.get("Access-Control-Allow-Origin") == "http://localhost:5173"
    assert headers.get("Access-Control-Allow-Methods") == "GET, POST, OPTIONS"


@pytest.mark.parametrize(
    "exception,status_code,error_code",
    [
        (FileNotFoundError("missing"), 404, "ARTIFACT_NOT_FOUND"),
        (TimeoutError("timed out"), 504, "UPSTREAM_TIMEOUT"),
        (asyncio.TimeoutError("async timed out"), 504, "UPSTREAM_TIMEOUT"),
        (ValueError("bad upstream data"), 502, "UPSTREAM_INVALID_RESPONSE"),
        (RuntimeError("network"), 502, "UPSTREAM_ERROR"),
    ],
)
def test_verifier_errors_are_mapped_to_json(api_server, monkeypatch, exception, status_code, error_code):
    def fail(*args, **kwargs):
        raise exception

    monkeypatch.setattr(api, "verify_pypi_artifact", fail)
    status, headers, body = request(
        api_server + "/api/v1/verify",
        method="POST",
        body=valid_payload(),
        headers={"Content-Type": "application/json"},
    )
    assert status == status_code
    assert headers.get_content_type() == "application/json"
    assert json.loads(body)["error"]["code"] == error_code


def test_port_configuration_defaults_and_validation(monkeypatch):
    monkeypatch.delenv("PYVERIFY_API_PORT", raising=False)
    assert api._port_from_environment() == 8765
    monkeypatch.setenv("PYVERIFY_API_PORT", "9876")
    assert api._port_from_environment() == 9876
    monkeypatch.setenv("PYVERIFY_API_PORT", "70000")
    with pytest.raises(ValueError, match="PYVERIFY_API_PORT"):
        api._port_from_environment()


def test_server_binds_only_to_ipv4_loopback():
    server = api.create_server(0)
    try:
        assert server.server_address[0] == "127.0.0.1"
    finally:
        server.server_close()


def test_release_discovery_returns_files_and_never_exposes_download_urls(api_server, monkeypatch):
    release = {
        "project_name": "demo",
        "version": "1.0",
        "files": [{"filename": "demo-1.0.tar.gz", "type": "sdist", "sha256": "a" * 64, "size": 12}],
        "metadata": {"summary": "Demo"},
    }
    monkeypatch.setattr(api, "get_pypi_release_files", lambda project, version: release)
    status, _, body = request(api_server + "/api/v1/packages/demo/1.0/files")
    assert status == 200
    assert json.loads(body) == {"release": release}


@pytest.mark.parametrize("path", [
    "/api/v1/packages/../1.0/files",
    "/api/v1/packages/demo/%2e%2e/files",
    "/api/v1/packages/demo%2Fother/1.0/files",
    "/api/v1/packages/demo/1.0/files?url=https://example.com",
])
def test_release_discovery_rejects_unsafe_or_ambiguous_paths(api_server, path, monkeypatch):
    monkeypatch.setattr(api, "get_pypi_release_files", lambda *args: pytest.fail("must not fetch"))
    status, _, body = request(api_server + path)
    assert status in (400, 404)
    assert "error" in json.loads(body)


def test_release_discovery_maps_missing_release(api_server, monkeypatch):
    def missing(*args):
        raise FileNotFoundError("missing")
    monkeypatch.setattr(api, "get_pypi_release_files", missing)
    status, _, body = request(api_server + "/api/v1/packages/demo/9.9/files")
    assert status == 404
    assert json.loads(body)["error"]["code"] == "RELEASE_NOT_FOUND"


@pytest.mark.parametrize(
    "error,expected_status,expected_code",
    [
        (asyncio.TimeoutError("slow"), 504, "UPSTREAM_TIMEOUT"),
        (ValueError("malformed"), 502, "UPSTREAM_INVALID_RESPONSE"),
        (RuntimeError("offline"), 502, "UPSTREAM_ERROR"),
    ],
)
def test_release_discovery_maps_upstream_failures(api_server, monkeypatch, error, expected_status, expected_code):
    def fail(*args):
        raise error
    monkeypatch.setattr(api, "get_pypi_release_files", fail)
    status, _, body = request(api_server + "/api/v1/packages/demo/1.0/files")
    assert status == expected_status
    assert json.loads(body)["error"]["code"] == expected_code


def source_payload(**overrides):
    payload = {
        "project": "demo",
        "version": "1.0",
        "wheel_filename": "demo-1.0-py3-none-any.whl",
        "sdist_filename": "demo-1.0.tar.gz",
        "attested_filename": "demo-1.0-py3-none-any.whl",
    }
    payload.update(overrides)
    return payload


def source_trace_result():
    return {
        "status": "SOURCE_TRACE_COMPLETE",
        "source_reference": {"status": "resolved", "repository": "octo/demo", "commit": "a" * 40},
        "commit_resolution": {"status": "resolved", "commit": "a" * 40},
        "repository_policy": {"status": "matched", "configured": True, "matches": True},
        "provenance_availability": {"status": "available", "available": True},
        "cryptographic_verification": {"status": "verified", "verified": True},
        "release_artifact_hashes": {"status": "verified", "artifacts": []},
        "source_inventory": {"status": "SOURCE_INVENTORY_COMPLETE", "complete": True},
        "sdist_inventory": {"status": "SDIST_INVENTORY_COMPLETE", "complete": True, "metadata": {"matches_requested_release": True}},
        "wheel_inventory": {"status": "INVENTORY_COMPLETE", "complete": True},
        "wheel_record": {"status": "RECORD_VALID", "valid": True},
        "wheel_metadata": {"name": "demo", "version": "1.0"},
        "wheel_metadata_matches": True,
        "release_consistency": {"status": "RELEASE_FILES_MATCH"},
        "file_comparison": {"status": "RELEASE_FILES_MATCH", "counts": {"matching": 1}},
        "limitations": ["Static comparison does not prove reproducible builds."],
        "verdict": {"status": "PASS", "reasons": []},
    }


def mock_source_trace_acquisition(monkeypatch, *, source_result=None, metadata_error=None, download_error=None):
    captured = {"trace_called": False}

    async def metadata(project, version, filename, deadline):
        if metadata_error:
            raise metadata_error
        return {
            "filename": filename,
            "packagetype": "bdist_wheel" if filename.endswith(".whl") else "sdist",
            "url": "https://files.pythonhosted.org/packages/" + filename,
            "sha256": "a" * 64,
            "size": 3,
        }

    async def download(metadata, destination, deadline):
        if download_error:
            raise download_error
        destination.write_bytes(b"abc")
        return {"filename": metadata["filename"], "size": 3, "sha256": "a" * 64, "matches": True}

    def trace(attested_path, project, version, filename, sdist_path, wheel_path, *, expected_source_repository=None):
        captured["trace_called"] = True
        captured.update({
            "attested_path": Path(attested_path),
            "sdist_path": Path(sdist_path),
            "wheel_path": Path(wheel_path),
            "project": project,
            "version": version,
            "filename": filename,
            "expected_source_repository": expected_source_repository,
            "files_exist": Path(attested_path).is_file() and Path(sdist_path).is_file() and Path(wheel_path).is_file(),
        })
        if isinstance(source_result, Exception):
            raise source_result
        return source_result or source_trace_result()

    monkeypatch.setattr(api, "_get_pypi_artifact_metadata_with_deadline", metadata)
    monkeypatch.setattr(api, "_download_source_trace_artifact", download)
    monkeypatch.setattr(api, "verify_pypi_source_trace", trace)
    return captured


def test_source_trace_endpoint_runs_existing_workflow_and_cleans_temporary_files(api_server, monkeypatch):
    captured = mock_source_trace_acquisition(monkeypatch)
    status, _, body = request(
        api_server + "/api/v1/source-trace",
        method="POST",
        body=source_payload(expected_source_repository="octo/demo"),
        headers={"Content-Type": "application/json"},
    )
    response = json.loads(body)
    assert status == 200
    assert captured["files_exist"] is True
    assert captured["expected_source_repository"] == "octo/demo"
    assert captured["filename"] == source_payload()["attested_filename"]
    assert not captured["attested_path"].exists()
    assert not captured["wheel_path"].exists()
    assert not captured["sdist_path"].exists()
    assert response["source_trace"] == source_trace_result()
    assert response["verdict"]["status"] == "PASS"
    assert response["evidence"]["cryptographic_attestation"]["stage_status"] == "VERIFIED"
    assert response["evidence"]["source_reference"]["stage_status"] == "VERIFIED"


@pytest.mark.parametrize("payload", [
    source_payload(wheel_filename="../bad.whl"),
    source_payload(sdist_filename="bad.zip"),
    source_payload(attested_filename="other.whl"),
    source_payload(unknown="field"),
])
def test_source_trace_rejects_invalid_requests(api_server, monkeypatch, payload):
    monkeypatch.setattr(api, "verify_pypi_source_trace", lambda *args, **kwargs: pytest.fail("must not trace"))
    status, _, body = request(
        api_server + "/api/v1/source-trace", method="POST", body=payload,
        headers={"Content-Type": "application/json"},
    )
    assert status == 400
    assert json.loads(body)["error"]["code"] == "INVALID_REQUEST"


def test_source_trace_missing_release_artifact_is_distinct(api_server, monkeypatch):
    mock_source_trace_acquisition(monkeypatch, metadata_error=FileNotFoundError("missing"))
    status, _, body = request(
        api_server + "/api/v1/source-trace", method="POST", body=source_payload(),
        headers={"Content-Type": "application/json"},
    )
    assert status == 404
    assert json.loads(body)["error"]["code"] == "ARTIFACT_NOT_FOUND"


def test_source_trace_timeout_is_mapped(api_server, monkeypatch):
    mock_source_trace_acquisition(monkeypatch, metadata_error=asyncio.TimeoutError("timeout"))
    status, _, body = request(
        api_server + "/api/v1/source-trace", method="POST", body=source_payload(),
        headers={"Content-Type": "application/json"},
    )
    assert status == 504
    assert json.loads(body)["error"]["code"] == "UPSTREAM_TIMEOUT"


def test_source_trace_failure_cleans_temporary_artifacts(api_server, monkeypatch):
    captured = mock_source_trace_acquisition(monkeypatch, source_result=RuntimeError("trace failed"))
    status, _, body = request(
        api_server + "/api/v1/source-trace", method="POST", body=source_payload(),
        headers={"Content-Type": "application/json"},
    )
    assert status == 502
    assert json.loads(body)["error"]["code"] == "UPSTREAM_ERROR"
    assert captured["files_exist"] is True
    assert not captured["wheel_path"].exists()
    assert not captured["sdist_path"].exists()


def test_source_trace_rejects_untrusted_final_redirect(api_server, monkeypatch):
    real_download_helper = api._download_source_trace_artifact
    mock_source_trace_acquisition(monkeypatch)

    class Response:
        url = "https://attacker.example/file.whl"
        status = 200
        def close(self):
            self.closed = True
        async def iter_bytes(self, *args):
            yield b"abc"

    response = Response()
    async def fake_open(*args, **kwargs):
        return response
    monkeypatch.setattr(api, "_download_source_trace_artifact", real_download_helper)
    monkeypatch.setattr(api, "open_https_response", fake_open)
    # Use the real transport-facing helper for the wheel/sdist fetch.
    monkeypatch.setattr(api, "verify_pypi_source_trace", lambda *args, **kwargs: pytest.fail("must not trace"))
    status, _, body = request(
        api_server + "/api/v1/source-trace", method="POST", body=source_payload(),
        headers={"Content-Type": "application/json"},
    )
    assert status == 502
    assert json.loads(body)["error"]["code"] == "UPSTREAM_INVALID_RESPONSE"
    assert response.closed is True


def test_source_trace_rejects_untrusted_initial_url(api_server, monkeypatch):
    real_download_helper = api._download_source_trace_artifact
    mock_source_trace_acquisition(monkeypatch)
    monkeypatch.setattr(api, "_download_source_trace_artifact", real_download_helper)
    original_metadata = api._get_pypi_artifact_metadata_with_deadline

    async def untrusted_metadata(project, version, filename, deadline):
        result = await original_metadata(project, version, filename, deadline)
        result["url"] = "https://attacker.example/" + filename
        return result

    monkeypatch.setattr(api, "_get_pypi_artifact_metadata_with_deadline", untrusted_metadata)
    status, _, body = request(
        api_server + "/api/v1/source-trace", method="POST", body=source_payload(),
        headers={"Content-Type": "application/json"},
    )
    assert status == 502
    assert json.loads(body)["error"]["code"] == "UPSTREAM_INVALID_RESPONSE"


@pytest.mark.parametrize("advertised,actual,limit", [(3, b"abc", 2), (1, b"abc", 2), (4, b"abc", 5)])
def test_source_trace_artifact_download_enforces_advertised_and_streamed_limits(
    monkeypatch, tmp_path, advertised, actual, limit
):
    monkeypatch.setattr(api, "MAX_SOURCE_ARTIFACT_BYTES", limit)

    class Response:
        url = "https://files.pythonhosted.org/packages/demo.whl"
        status = 200
        closed = False
        async def iter_bytes(self, chunk_size, max_bytes):
            yield actual
        def close(self):
            self.closed = True

    response = Response()
    async def fake_open(*args, **kwargs):
        return response
    monkeypatch.setattr(api, "open_https_response", fake_open)
    metadata = {
        "filename": "demo.whl", "url": response.url,
        "size": advertised, "sha256": "a" * 64,
    }
    from pyverify.pypi import _run_coroutine_sync
    with pytest.raises(ValueError):
        _run_coroutine_sync(api._download_source_trace_artifact(metadata, tmp_path / "demo.whl", time.monotonic() + 5))
    assert response.closed is (advertised <= limit)


def test_source_trace_artifact_download_streams_and_checks_sha256(monkeypatch, tmp_path):
    import hashlib
    from pyverify.pypi import _run_coroutine_sync

    body = b"local artifact bytes"

    class Response:
        url = "https://files.pythonhosted.org/packages/demo.whl"
        status = 200
        headers = {"content-length": str(len(body))}
        closed = False
        async def iter_bytes(self, chunk_size, max_bytes):
            for offset in range(0, len(body), 4):
                yield body[offset:offset + 4]
        def close(self):
            self.closed = True

    response = Response()
    async def fake_open(url, *, allowed_host, deadline, headers=None):
        assert allowed_host == "files.pythonhosted.org"
        assert url == response.url
        return response
    monkeypatch.setattr(api, "open_https_response", fake_open)
    destination = tmp_path / "demo.whl"
    metadata = {
        "filename": destination.name,
        "url": response.url,
        "sha256": hashlib.sha256(body).hexdigest(),
        "size": len(body),
    }
    result = _run_coroutine_sync(api._download_source_trace_artifact(metadata, destination, time.monotonic() + 5))
    assert destination.read_bytes() == body
    assert result["matches"] is True
    assert result["sha256"] == metadata["sha256"]
    assert response.closed is True


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("not_checked", "NOT_CHECKED"),
        ("not_applicable", "NOT_APPLICABLE"),
        ("unavailable", "UNAVAILABLE"),
        ("RELEASE_FILES_PARTIAL", "WARNING"),
        ("failed", "FAILED"),
        ("verified", "VERIFIED"),
    ],
)
def test_evidence_stage_statuses_remain_distinct(raw, expected):
    assert api._stage_status(raw) == expected


def test_source_trace_preserves_non_pass_verdict(api_server, monkeypatch):
    warning = source_trace_result()
    warning["verdict"] = {"status": "WARNING", "reasons": ["provenance unavailable"]}
    warning["status"] = "SOURCE_TRACE_PARTIAL"
    mock_source_trace_acquisition(monkeypatch, source_result=warning)
    status, _, body = request(
        api_server + "/api/v1/source-trace", method="POST", body=source_payload(),
        headers={"Content-Type": "application/json"},
    )
    response = json.loads(body)
    assert status == 200
    assert response["verdict"]["status"] == "WARNING"
    assert response["evidence"]["source_trace"]["stage_status"] == "WARNING"
