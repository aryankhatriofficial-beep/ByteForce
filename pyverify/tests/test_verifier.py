import asyncio
import hashlib
import time
from threading import Event

import pytest

from pyverify import _http, verifier


CONTENT = b"A temporary PyVerify artifact, streamed in chunks."
SHA256 = hashlib.sha256(CONTENT).hexdigest()
URL = "https://files.pythonhosted.org/packages/example/demo.whl"


def mock_metadata(monkeypatch, sha256=SHA256, size=len(CONTENT), url=URL):
    async def get_metadata(project_name, version, filename, deadline):
        return {
            "project_name": project_name,
            "version": version,
            "filename": filename,
            "sha256": sha256,
            "url": url,
            "packagetype": "bdist_wheel",
            "size": size,
        }

    monkeypatch.setattr(verifier, "_get_pypi_artifact_metadata_with_deadline", get_metadata)


def mock_download(monkeypatch, chunks=None, final_url=URL, error=None, read_error=None):
    recorded = {}

    class Response:
        url = final_url
        status = 200

        def close(self):
            recorded["closed"] = True

        async def iter_bytes(self, chunk_size, max_bytes):
            recorded["chunk_size"] = chunk_size
            recorded["max_bytes"] = max_bytes
            if read_error:
                raise read_error
            for chunk in chunks if chunks is not None else [CONTENT]:
                yield chunk

    async def open_response(url, allowed_host, deadline, headers=None):
        recorded["url"] = url
        recorded["allowed_host"] = allowed_host
        recorded["deadline"] = deadline
        if error:
            raise error
        return Response()

    monkeypatch.setattr(verifier, "open_https_response", open_response)
    return recorded


def test_verify_pypi_artifact_matching_hash(monkeypatch):
    mock_metadata(monkeypatch)
    download = mock_download(monkeypatch, chunks=[CONTENT[:12], CONTENT[12:]])

    result = verifier.verify_pypi_artifact("demo", "1.0", "demo.whl")

    assert result == {
        "project_name": "demo",
        "version": "1.0",
        "filename": "demo.whl",
        "expected_sha256": SHA256,
        "actual_sha256": SHA256,
        "matches": True,
        "downloaded_size": len(CONTENT),
        "download_url": URL,
    }
    assert download["url"] == URL
    assert download["allowed_host"] == "files.pythonhosted.org"
    assert download["closed"] is True


def test_verify_pypi_artifact_mismatching_hash(monkeypatch):
    mock_metadata(monkeypatch, sha256=hashlib.sha256(b"other content").hexdigest())
    mock_download(monkeypatch)

    result = verifier.verify_pypi_artifact("demo", "1.0", "demo.whl")

    assert result["actual_sha256"] == SHA256
    assert result["matches"] is False


def test_verify_pypi_artifact_handles_download_failure(monkeypatch):
    mock_metadata(monkeypatch)
    mock_download(monkeypatch, error=OSError("offline"))

    with pytest.raises(RuntimeError, match="download"):
        verifier.verify_pypi_artifact("demo", "1.0", "demo.whl")


@pytest.mark.parametrize(
    "url",
    [
        "http://files.pythonhosted.org/demo.whl",
        "https://example.com/demo.whl",
        "https://files.pythonhosted.org.example.com/demo.whl",
    ],
)
def test_verify_pypi_artifact_rejects_invalid_initial_url(monkeypatch, url):
    mock_metadata(monkeypatch, url=url)
    download = mock_download(monkeypatch)

    with pytest.raises(ValueError, match="Untrusted artifact download URL"):
        verifier.verify_pypi_artifact("demo", "1.0", "demo.whl")
    assert "url" not in download


def test_verify_pypi_artifact_rejects_untrusted_final_url(monkeypatch):
    mock_metadata(monkeypatch)
    download = mock_download(monkeypatch, final_url="https://example.com/demo.whl")

    with pytest.raises(ValueError, match="Untrusted artifact download URL"):
        verifier.verify_pypi_artifact("demo", "1.0", "demo.whl")
    assert download["closed"] is True


def test_verify_pypi_artifact_rejects_size_mismatch(monkeypatch):
    mock_metadata(monkeypatch, size=len(CONTENT) + 1)
    mock_download(monkeypatch)

    with pytest.raises(ValueError, match="size does not match"):
        verifier.verify_pypi_artifact("demo", "1.0", "demo.whl")


def test_verify_pypi_artifact_rejects_oversized_advertised_file(monkeypatch, tmp_path):
    mock_metadata(monkeypatch)
    download = mock_download(monkeypatch)
    monkeypatch.setattr(verifier.tempfile, "tempdir", str(tmp_path))

    with pytest.raises(ValueError, match="Advertised artifact size"):
        verifier.verify_pypi_artifact(
            "demo", "1.0", "demo.whl", max_download_size=len(CONTENT) - 1
        )

    assert "url" not in download
    assert list(tmp_path.iterdir()) == []


def test_verify_pypi_artifact_stops_when_stream_exceeds_limit(monkeypatch, tmp_path):
    mock_metadata(monkeypatch, size=8)
    download = mock_download(monkeypatch, chunks=[b"12345", b"67890"])
    monkeypatch.setattr(verifier.tempfile, "tempdir", str(tmp_path))

    with pytest.raises(ValueError, match="exceeds the configured maximum"):
        verifier.verify_pypi_artifact("demo", "1.0", "demo.whl", max_download_size=8)

    assert list(tmp_path.iterdir()) == []
    assert download["closed"] is True


def test_response_read_failure_cleans_temporary_directory(monkeypatch, tmp_path):
    mock_metadata(monkeypatch)
    mock_download(monkeypatch, read_error=OSError("read failed"))
    monkeypatch.setattr(verifier.tempfile, "tempdir", str(tmp_path))

    with pytest.raises(RuntimeError):
        verifier.verify_pypi_artifact("demo", "1.0", "demo.whl")

    assert list(tmp_path.iterdir()) == []


def test_disk_write_failure_cleans_temporary_directory(monkeypatch, tmp_path):
    mock_metadata(monkeypatch)
    mock_download(monkeypatch)
    monkeypatch.setattr(verifier.tempfile, "tempdir", str(tmp_path))

    class FailedFile:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return False

        def write(self, data):
            raise OSError("disk full")

    monkeypatch.setattr(verifier.Path, "open", lambda *args, **kwargs: FailedFile())

    with pytest.raises(OSError, match="disk full"):
        verifier.verify_pypi_artifact("demo", "1.0", "demo.whl")

    assert list(tmp_path.iterdir()) == []


def test_hash_failure_cleans_temporary_directory(monkeypatch, tmp_path):
    mock_metadata(monkeypatch)
    mock_download(monkeypatch)
    monkeypatch.setattr(verifier.tempfile, "tempdir", str(tmp_path))

    def fail_hash(*args):
        raise RuntimeError("hash failure")

    monkeypatch.setattr(verifier, "verify_artifact_hash", fail_hash)

    with pytest.raises(RuntimeError, match="hash failure"):
        verifier.verify_pypi_artifact("demo", "1.0", "demo.whl")

    assert list(tmp_path.iterdir()) == []


def test_deadline_cancels_blocked_open(monkeypatch):
    mock_metadata(monkeypatch)
    cancelled = Event()

    async def blocked_open(url, allowed_host, deadline, headers=None):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(verifier, "open_https_response", blocked_open)
    with pytest.raises(TimeoutError):
        verifier.verify_pypi_artifact(
            "demo", "1.0", "demo.whl", max_download_duration=0.05
        )
    assert cancelled.is_set()


def test_deadline_cancels_blocked_metadata_request(monkeypatch):
    cancelled = Event()

    async def blocked_metadata(project_name, version, filename, deadline):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(
        verifier, "_get_pypi_artifact_metadata_with_deadline", blocked_metadata
    )
    with pytest.raises(TimeoutError):
        verifier.verify_pypi_artifact(
            "demo", "1.0", "demo.whl", max_download_duration=0.05
        )
    assert cancelled.is_set()


def test_deadline_cancels_blocked_body_read():
    cancelled = Event()

    class Reader:
        async def read(self, size):
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise

    async def run():
        response = _http.HTTPSResponse(
            URL,
            200,
            {},
            Reader(),
            type("Writer", (), {"close": lambda self: None})(),
            time.monotonic() + 0.05,
        )
        async for _ in response.iter_bytes(1024, 100):
            pass

    with pytest.raises(TimeoutError):
        asyncio.run(run())
    assert cancelled.is_set()


def test_transport_cancels_blocked_connection_establishment(monkeypatch):
    cancelled = Event()

    async def blocked_connection(*args, **kwargs):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(_http.asyncio, "open_connection", blocked_connection)

    async def run():
        await _http.open_https_response(
            URL,
            allowed_host="files.pythonhosted.org",
            deadline=time.monotonic() + 0.05,
        )

    with pytest.raises(TimeoutError):
        asyncio.run(run())
    assert cancelled.is_set()


def test_redirect_target_is_rejected_before_second_connection(monkeypatch):
    calls = []

    class Reader:
        def __init__(self):
            self.lines = iter(
                [
                    b"HTTP/1.1 302 Found\r\n",
                    b"Location: https://example.com/artifact.whl\r\n",
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

    async def fake_open_connection(*args, **kwargs):
        calls.append(args[0])
        return Reader(), writer

    monkeypatch.setattr(_http.asyncio, "open_connection", fake_open_connection)

    async def run():
        await _http.open_https_response(
            URL,
            allowed_host="files.pythonhosted.org",
            deadline=time.monotonic() + 10,
        )

    with pytest.raises(ValueError, match="Untrusted HTTPS URL"):
        asyncio.run(run())

    assert calls == ["files.pythonhosted.org"]
    assert writer.closed is True
