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
    payload = await _get_pypi_release_payload_with_deadline(
        project_name, version, deadline, max_response_size
    )
    return _artifact_metadata_from_payload(payload, project_name, version, filename)


async def _get_pypi_release_payload_with_deadline(
    project_name: str,
    version: str,
    deadline: float,
    max_response_size: int = _DEFAULT_MAX_RESPONSE_SIZE,
) -> dict[str, Any]:
    """Fetch one bounded JSON release response from the official PyPI host."""
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
        if response.status == 404:
            raise FileNotFoundError(
                "PyPI release {} {} was not found".format(project_name, version)
            )
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
        if not isinstance(payload, dict) or not isinstance(payload.get("urls"), list):
            raise ValueError("PyPI response is missing a valid urls list")
        return payload
    finally:
        response.close()


def _release_file_from_payload(artifact: Any) -> dict[str, Any]:
    if not isinstance(artifact, dict):
        raise ValueError("PyPI response contains an invalid file entry")
    filename = artifact.get("filename")
    digests = artifact.get("digests")
    sha256 = digests.get("sha256") if isinstance(digests, dict) else None
    size = artifact.get("size")
    packagetype = artifact.get("packagetype")
    url = artifact.get("url")
    if (
        not isinstance(filename, str)
        or not filename
        or filename in (".", "..")
        or "/" in filename
        or "\\" in filename
        or any(ord(char) < 0x20 or ord(char) == 0x7F for char in filename)
    ):
        raise ValueError("PyPI response contains an invalid artifact filename")
    if not isinstance(sha256, str) or re.fullmatch(r"[0-9a-fA-F]{64}", sha256) is None:
        raise ValueError("PyPI file metadata contains an invalid SHA256 digest")
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        raise ValueError("PyPI file metadata contains an invalid size")
    if not isinstance(packagetype, str) or not packagetype:
        raise ValueError("PyPI file metadata is missing packagetype")
    upload_time = artifact.get("upload_time_iso_8601") or artifact.get("upload_time")
    if upload_time is not None and not isinstance(upload_time, str):
        raise ValueError("PyPI file metadata contains an invalid upload timestamp")
    python_version = artifact.get("python_version")
    requires_python = artifact.get("requires_python")
    yanked = artifact.get("yanked", False)
    if python_version is not None and not isinstance(python_version, str):
        raise ValueError("PyPI file metadata contains an invalid Python version tag")
    if requires_python is not None and not isinstance(requires_python, str):
        raise ValueError("PyPI file metadata contains an invalid Requires-Python value")
    if not isinstance(yanked, bool):
        raise ValueError("PyPI file metadata contains an invalid yanked flag")
    if artifact.get("yanked_reason") is not None and not isinstance(artifact.get("yanked_reason"), str):
        raise ValueError("PyPI file metadata contains an invalid yanked reason")
    parsed_url = urlparse(url) if isinstance(url, str) else None
    if (
        parsed_url is None
        or parsed_url.scheme != "https"
        or parsed_url.hostname != _ALLOWED_DOWNLOAD_HOST
        or parsed_url.username is not None
        or parsed_url.password is not None
        or parsed_url.port not in (None, 443)
    ):
        raise ValueError("PyPI file metadata contains an untrusted download URL")
    result = {
        "filename": filename,
        "type": "wheel" if packagetype == "bdist_wheel" else "sdist" if packagetype == "sdist" else "other",
        "packagetype": packagetype,
        "sha256": sha256.lower(),
        "size": size,
        "python_version": python_version,
        "requires_python": requires_python,
        "upload_time": upload_time,
        "yanked": yanked,
    }
    if "yanked_reason" in artifact:
        result["yanked_reason"] = artifact["yanked_reason"]
    return result


def get_pypi_release_files(
    project_name: str,
    version: str,
    *,
    max_response_size: int = _DEFAULT_MAX_RESPONSE_SIZE,
) -> dict[str, Any]:
    """Return bounded, validated metadata for every file in one PyPI release.

    Download URLs are validated against the official file host but are not
    exposed in the response intended for frontend clients.
    """
    for label, value, pattern in (
        ("project", project_name, r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}"),
        ("version", version, r"[A-Za-z0-9][A-Za-z0-9.!+_-]{0,199}"),
    ):
        if not isinstance(value, str) or re.fullmatch(pattern, value) is None:
            raise ValueError("Invalid PyPI {} name".format(label))
    try:
        payload = _run_coroutine_sync(
            _get_pypi_release_payload_with_deadline(
                project_name,
                version,
                time.monotonic() + _METADATA_REQUEST_TIMEOUT,
                max_response_size,
            )
        )
    except (TimeoutError, FileNotFoundError, ValueError, RuntimeError):
        raise
    except OSError as exc:
        raise RuntimeError("Could not fetch release metadata from PyPI") from exc

    info = payload.get("info")
    if info is not None and not isinstance(info, dict):
        raise ValueError("PyPI response contains invalid release information")
    files = [_release_file_from_payload(item) for item in payload["urls"]]
    if len({item["filename"] for item in files}) != len(files):
        raise ValueError("PyPI response contains duplicate artifact filenames")
    release_info = info or {}
    release_name = release_info.get("name")
    release_version = release_info.get("version")
    if release_name is not None:
        normalize = lambda name: re.sub(r"[-_.]+", "-", name).lower()
        if not isinstance(release_name, str) or normalize(release_name) != normalize(project_name):
            raise ValueError("PyPI response project does not match the requested project")
    if release_version is not None and release_version != version:
        raise ValueError("PyPI response version does not match the requested release")
    summary = release_info.get("summary")
    requires_python = release_info.get("requires_python")
    classifiers = release_info.get("classifiers")
    if summary is not None and not isinstance(summary, str):
        raise ValueError("PyPI response contains an invalid project summary")
    if requires_python is not None and not isinstance(requires_python, str):
        raise ValueError("PyPI response contains an invalid Requires-Python value")
    if classifiers is not None and (
        not isinstance(classifiers, list)
        or not all(isinstance(classifier, str) for classifier in classifiers)
    ):
        raise ValueError("PyPI response contains invalid project classifiers")
    return {
        "project_name": project_name,
        "version": version,
        "files": files,
        "metadata": {
            key: release_info[key]
            for key in ("summary", "requires_python", "classifiers")
            if key in release_info
        },
    }


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
