"""Fetch release file metadata from the official PyPI JSON API."""

import asyncio
import json
import re
import time
from typing import Any
from queue import Queue
from threading import Thread
from urllib.parse import quote, urlparse

from pyverify._http import open_https_response


_API_BASE_URL = "https://pypi.org/pypi"
_ALLOWED_DOWNLOAD_HOST = "files.pythonhosted.org"
_DEFAULT_MAX_RESPONSE_SIZE = 10 * 1024 * 1024
_RESPONSE_CHUNK_SIZE = 64 * 1024
_METADATA_REQUEST_TIMEOUT = 10


def _artifact_metadata_from_payload(
    payload: Any, project_name: str, version: str, filename: str
) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("urls"), list):
        raise ValueError("PyPI response is missing a valid urls list")

    matching_file = None
    for artifact in payload["urls"]:
        if not isinstance(artifact, dict):
            raise ValueError("PyPI response contains an invalid file entry")
        if artifact.get("filename") == filename:
            matching_file = artifact
            break

    if matching_file is None:
        raise FileNotFoundError(
            "File {!r} was not found in release {} {}".format(
                filename, project_name, version
            )
        )

    digests = matching_file.get("digests")
    sha256 = digests.get("sha256") if isinstance(digests, dict) else None
    if not isinstance(sha256, str) or re.fullmatch(r"[0-9a-fA-F]{64}", sha256) is None:
        raise ValueError("PyPI file metadata contains an invalid SHA256 digest")

    url = matching_file.get("url")
    parsed_url = urlparse(url) if isinstance(url, str) else None
    if (
        parsed_url is None
        or parsed_url.scheme != "https"
        or parsed_url.hostname != _ALLOWED_DOWNLOAD_HOST
    ):
        raise ValueError("PyPI file metadata contains an untrusted download URL")

    required_fields = ("packagetype", "size")
    if any(field not in matching_file for field in required_fields):
        raise ValueError("PyPI file metadata is missing required fields")

    return {
        "project_name": project_name,
        "version": version,
        "filename": filename,
        "sha256": sha256,
        "url": url,
        "packagetype": matching_file["packagetype"],
        "size": matching_file["size"],
    }


async def _get_pypi_artifact_metadata_with_deadline(
    project_name: str,
    version: str,
    filename: str,
    deadline: float,
    max_response_size: int = _DEFAULT_MAX_RESPONSE_SIZE,
) -> dict[str, Any]:
    """Fetch metadata using the caller's absolute operation deadline."""
    if isinstance(max_response_size, bool) or not isinstance(max_response_size, int) or max_response_size < 1:
        raise ValueError("max_response_size must be a positive integer")
    api_url = "{}/{}/{}/json".format(
        _API_BASE_URL, quote(project_name, safe=""), quote(version, safe="")
    )
    response = await open_https_response(
        api_url,
        allowed_host="pypi.org",
        deadline=deadline,
        headers={"Accept": "application/json"},
    )
    try:
        if not 200 <= response.status < 300:
            raise RuntimeError("PyPI returned an unsuccessful metadata response")
        body = bytearray()
        async for chunk in response.iter_bytes(_RESPONSE_CHUNK_SIZE, max_response_size):
            if len(body) + len(chunk) > max_response_size:
                raise ValueError("PyPI JSON response exceeds the configured maximum size")
            body.extend(chunk)
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("PyPI returned invalid JSON") from exc
        return _artifact_metadata_from_payload(payload, project_name, version, filename)
    finally:
        response.close()


def _run_coroutine_sync(coroutine):
    """Run an async request while preserving this module's sync API."""
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

    thread = Thread(target=run_in_thread, name="pyverify-pypi-metadata")
    thread.start()
    thread.join()
    succeeded, value = outcome.get()
    if succeeded:
        return value
    raise value


def get_pypi_artifact_metadata(
    project_name: str,
    version: str,
    filename: str,
    *,
    max_response_size: int = _DEFAULT_MAX_RESPONSE_SIZE,
) -> dict[str, Any]:
    """Fetch metadata for one exact release filename from PyPI.

    Raises ``FileNotFoundError`` if that filename is not in the release,
    ``ValueError`` for malformed API data or unsafe file metadata, and
    ``RuntimeError`` for network failures.
    """
    if (
        isinstance(max_response_size, bool)
        or not isinstance(max_response_size, int)
        or max_response_size < 1
    ):
        raise ValueError("max_response_size must be a positive integer")

    try:
        deadline = time.monotonic() + _METADATA_REQUEST_TIMEOUT
        return _run_coroutine_sync(
            _get_pypi_artifact_metadata_with_deadline(
                project_name,
                version,
                filename,
                deadline,
                max_response_size,
            )
        )
    except TimeoutError:
        raise
    except FileNotFoundError:
        raise
    except OSError as exc:
        raise RuntimeError("Could not fetch release metadata from PyPI") from exc
