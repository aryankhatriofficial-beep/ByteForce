import asyncio
import json
import time

import pytest

from pyverify import _http, pypi


SHA256 = "a" * 64


def file_entry(filename, sha256=SHA256, url=None, packagetype="bdist_wheel", size=123):
    return {
        "filename": filename,
        "digests": {"sha256": sha256},
        "url": url or "https://files.pythonhosted.org/packages/example/" + filename,
        "packagetype": packagetype,
        "size": size,
    }


def mock_response(monkeypatch, payload):
    response_bytes = json.dumps(payload).encode("utf-8")

    class Response:
        status = 200

        def close(self):
            pass

        async def iter_bytes(self, chunk_size, max_bytes):
            for start in range(0, len(response_bytes), chunk_size):
                yield response_bytes[start : start + chunk_size]

    async def fake_open(url, allowed_host, deadline, headers=None):
        assert url == "https://pypi.org/pypi/demo/1.0/json"
        assert allowed_host == "pypi.org"
        return Response()

    monkeypatch.setattr(pypi, "open_https_response", fake_open)


def test_get_pypi_artifact_metadata_selects_exact_filename(monkeypatch):
    requested = file_entry("demo-1.0-py3-none-any.whl")
    other = file_entry("demo-1.0.tar.gz", sha256="b" * 64)
    mock_response(monkeypatch, {"urls": [other, requested]})

    result = pypi.get_pypi_artifact_metadata(
        "demo", "1.0", "demo-1.0-py3-none-any.whl"
    )

    assert result == {
        "project_name": "demo",
        "version": "1.0",
        "filename": "demo-1.0-py3-none-any.whl",
        "sha256": SHA256,
        "url": requested["url"],
        "packagetype": "bdist_wheel",
        "size": 123,
    }


def test_get_pypi_artifact_metadata_raises_for_missing_filename(monkeypatch):
    mock_response(monkeypatch, {"urls": [file_entry("other.whl")]})

    with pytest.raises(FileNotFoundError, match="missing.whl"):
        pypi.get_pypi_artifact_metadata("demo", "1.0", "missing.whl")


@pytest.mark.parametrize("payload", [[], {}, {"urls": "invalid"}])
def test_get_pypi_artifact_metadata_rejects_invalid_response(monkeypatch, payload):
    mock_response(monkeypatch, payload)

    with pytest.raises(ValueError, match="urls list"):
        pypi.get_pypi_artifact_metadata("demo", "1.0", "demo.whl")


@pytest.mark.parametrize("digest", ["", "a" * 63, "a" * 65, "g" * 64])
def test_get_pypi_artifact_metadata_rejects_invalid_digest(monkeypatch, digest):
    mock_response(monkeypatch, {"urls": [file_entry("demo.whl", sha256=digest)]})

    with pytest.raises(ValueError, match="SHA256"):
        pypi.get_pypi_artifact_metadata("demo", "1.0", "demo.whl")


@pytest.mark.parametrize(
    "url",
    [
        "http://files.pythonhosted.org/demo.whl",
        "https://example.com/demo.whl",
        "https://files.pythonhosted.org.example.com/demo.whl",
    ],
)
def test_get_pypi_artifact_metadata_rejects_untrusted_url(monkeypatch, url):
    mock_response(monkeypatch, {"urls": [file_entry("demo.whl", url=url)]})

    with pytest.raises(ValueError, match="untrusted download URL"):
        pypi.get_pypi_artifact_metadata("demo", "1.0", "demo.whl")


def test_get_pypi_artifact_metadata_handles_network_error(monkeypatch):
    async def fail_open(url, allowed_host, deadline, headers=None):
        raise OSError("offline")

    monkeypatch.setattr(pypi, "open_https_response", fail_open)

    with pytest.raises(RuntimeError, match="Could not fetch"):
        pypi.get_pypi_artifact_metadata("demo", "1.0", "demo.whl")


def test_get_pypi_artifact_metadata_rejects_oversized_json(monkeypatch):
    mock_response(monkeypatch, {"padding": "x" * 100, "urls": []})

    with pytest.raises(ValueError, match="exceeds the configured maximum"):
        pypi.get_pypi_artifact_metadata(
            "demo", "1.0", "demo.whl", max_response_size=32
        )


def test_async_metadata_fetch_uses_mocked_deadline_transport(monkeypatch):
    payload = {
        "urls": [
            {
                "filename": "demo.whl",
                "digests": {"sha256": SHA256},
                "url": "https://files.pythonhosted.org/demo.whl",
                "packagetype": "bdist_wheel",
                "size": 123,
            }
        ]
    }

    class Response:
        status = 200

        def close(self):
            pass

        async def iter_bytes(self, chunk_size, max_bytes):
            body = json.dumps(payload).encode("utf-8")
            for start in range(0, len(body), 10):
                yield body[start : start + 10]

    async def fake_open(url, allowed_host, deadline, headers=None):
        assert allowed_host == "pypi.org"
        assert url == "https://pypi.org/pypi/demo/1.0/json"
        return Response()

    monkeypatch.setattr(pypi, "open_https_response", fake_open)
    result = asyncio.run(
        pypi._get_pypi_artifact_metadata_with_deadline(
            "demo", "1.0", "demo.whl", time.monotonic() + 10
        )
    )

    assert result["filename"] == "demo.whl"
    assert result["sha256"] == SHA256


def test_sync_metadata_fetch_rejects_untrusted_redirect(monkeypatch):
    calls = []

    class Reader:
        def __init__(self):
            self.lines = iter(
                [
                    b"HTTP/1.1 302 Found\r\n",
                    b"Location: https://attacker.example/metadata.json\r\n",
                    b"\r\n",
                ]
            )

        async def readline(self):
            return next(self.lines)

    class Writer:
        def __init__(self):
            self.closed = False

        def write(self, data):
            pass

        async def drain(self):
            pass

        def close(self):
            self.closed = True

    writer = Writer()

    async def fake_open_connection(host, *args, **kwargs):
        calls.append(host)
        return Reader(), writer

    monkeypatch.setattr(_http.asyncio, "open_connection", fake_open_connection)

    with pytest.raises(ValueError, match="Untrusted HTTPS URL"):
        pypi.get_pypi_artifact_metadata("demo", "1.0", "demo.whl")

    assert calls == ["pypi.org"]
    assert writer.closed is True


def test_sync_metadata_fetch_enforces_absolute_timeout(monkeypatch):
    monkeypatch.setattr(pypi, "_METADATA_REQUEST_TIMEOUT", 0.05)
    cancelled = asyncio.Event()

    async def blocked_connection(*args, **kwargs):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(_http.asyncio, "open_connection", blocked_connection)

    with pytest.raises(TimeoutError):
        pypi.get_pypi_artifact_metadata("demo", "1.0", "demo.whl")

    assert cancelled.is_set()
