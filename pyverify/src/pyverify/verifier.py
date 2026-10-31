"""Download and verify a specific artifact published on PyPI."""

import asyncio
import math
import tempfile
import time
from pathlib import Path
from queue import Queue
from threading import Thread
from typing import Any
from urllib.parse import urlparse

from pyverify._http import _within_deadline, open_https_response
from pyverify.integrity import verify_artifact_hash
from pyverify.pypi import _get_pypi_artifact_metadata_with_deadline


_ALLOWED_DOWNLOAD_HOST = "files.pythonhosted.org"
_CHUNK_SIZE = 1024 * 1024
_DEFAULT_MAX_DOWNLOAD_SIZE = 1024 * 1024 * 1024
_DEFAULT_MAX_DOWNLOAD_DURATION = 5 * 60


def _validate_download_url(url: str) -> None:
    """Reject non-HTTPS or non-PyPI artifact hosts."""
    try:
        parsed = urlparse(url)
        valid = (
            parsed.scheme == "https"
            and parsed.hostname == _ALLOWED_DOWNLOAD_HOST
            and parsed.username is None
            and parsed.password is None
            and parsed.port in (None, 443)
        )
    except (TypeError, ValueError):
        valid = False
    if not valid:
        raise ValueError("Untrusted artifact download URL")


async def _verify_pypi_artifact_async(
    project_name: str,
    version: str,
    filename: str,
    deadline: float,
    max_download_size: int,
) -> dict[str, Any]:
    try:
        metadata = await _within_deadline(
            _get_pypi_artifact_metadata_with_deadline(
                project_name, version, filename, deadline
            ),
            deadline,
        )
    except TimeoutError:
        raise
    except OSError as exc:
        raise RuntimeError("Could not fetch release metadata from PyPI") from exc
    if time.monotonic() >= deadline:
        raise TimeoutError("Artifact download exceeded its total time limit")
    download_url = metadata["url"]
    expected_sha256 = metadata["sha256"]
    expected_size = metadata["size"]

    _validate_download_url(download_url)
    if isinstance(expected_size, bool) or not isinstance(expected_size, int) or expected_size < 0:
        raise ValueError("PyPI artifact metadata contains an invalid file size")
    if expected_size > max_download_size:
        raise ValueError("Advertised artifact size exceeds the configured maximum")

    try:
        response = await _within_deadline(
            open_https_response(
                download_url,
                allowed_host=_ALLOWED_DOWNLOAD_HOST,
                deadline=deadline,
                headers={"Accept-Encoding": "identity"},
            ),
            deadline,
        )
    except TimeoutError:
        raise
    except OSError as exc:
        raise RuntimeError("Could not download artifact from PyPI") from exc
    try:
        _validate_download_url(response.url)
        if not 200 <= response.status < 300:
            raise RuntimeError("PyPI returned an unsuccessful artifact response")

        with tempfile.TemporaryDirectory(prefix="pyverify-") as temp_dir:
            artifact_path = Path(temp_dir) / "artifact"
            downloaded_size = 0
            with artifact_path.open("wb") as artifact_file:
                iterator = response.iter_bytes(_CHUNK_SIZE, max_download_size).__aiter__()
                while True:
                    try:
                        chunk = await iterator.__anext__()
                    except StopAsyncIteration:
                        break
                    except TimeoutError:
                        raise
                    except OSError as exc:
                        raise RuntimeError(
                            "Artifact download failed while reading its response"
                        ) from exc
                    new_size = downloaded_size + len(chunk)
                    if new_size > max_download_size:
                        raise ValueError(
                            "Artifact exceeds the configured maximum download size"
                        )
                    if new_size > expected_size:
                        raise ValueError(
                            "Downloaded artifact exceeds the size reported by PyPI"
                        )
                    artifact_file.write(chunk)
                    downloaded_size = new_size
                    if time.monotonic() >= deadline:
                        raise TimeoutError(
                            "Artifact download exceeded its total time limit"
                        )

            if downloaded_size != expected_size:
                raise ValueError(
                    "Downloaded artifact size does not match the size reported by PyPI"
                )

            hash_result = verify_artifact_hash(artifact_path, expected_sha256)
    finally:
        response.close()

    return {
        "project_name": project_name,
        "version": version,
        "filename": filename,
        "expected_sha256": hash_result["expected_sha256"],
        "actual_sha256": hash_result["actual_sha256"],
        "matches": hash_result["matches"],
        "downloaded_size": downloaded_size,
        "download_url": download_url,
    }


def _run_coroutine(coroutine):
    """Run a private coroutine while keeping the public API synchronous."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coroutine)

    outcome = Queue(maxsize=1)

    def run_in_thread():
        try:
            outcome.put((True, asyncio.run(coroutine)))
        except BaseException as exc:
            outcome.put((False, exc))

    thread = Thread(target=run_in_thread, name="pyverify-download")
    thread.start()
    thread.join()
    succeeded, value = outcome.get()
    if succeeded:
        return value
    raise value


def verify_pypi_artifact(
    project_name: str,
    version: str,
    filename: str,
    *,
    max_download_size: int = _DEFAULT_MAX_DOWNLOAD_SIZE,
    max_download_duration: float = _DEFAULT_MAX_DOWNLOAD_DURATION,
) -> dict[str, Any]:
    """Fetch and verify one PyPI artifact under a total network deadline."""
    if (
        isinstance(max_download_size, bool)
        or not isinstance(max_download_size, int)
        or max_download_size < 0
    ):
        raise ValueError("max_download_size must be a non-negative integer")
    if (
        isinstance(max_download_duration, bool)
        or not isinstance(max_download_duration, (int, float))
        or not math.isfinite(max_download_duration)
        or max_download_duration <= 0
    ):
        raise ValueError("max_download_duration must be a positive finite number")

    deadline = time.monotonic() + max_download_duration
    coroutine = _verify_pypi_artifact_async(
        project_name,
        version,
        filename,
        deadline,
        max_download_size,
    )
    return _run_coroutine(coroutine)
