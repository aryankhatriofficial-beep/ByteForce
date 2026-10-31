"""Download and verify a specific artifact published on PyPI."""

import asyncio
import math
import re
import tempfile
import time
from pathlib import Path
from queue import Queue
from threading import Thread
from typing import Any
from urllib.parse import urlparse

from pyverify._http import _within_deadline, open_https_response
from pyverify.attestations import (
    AttestationVerificationError,
    NoAttestationsError,
    ProvenanceNotFoundError,
    _get_pypi_provenance_with_deadline,
    verify_pypi_provenance,
)
from pyverify.integrity import verify_artifact_hash
from pyverify.evidence import build_evidence_summary
from pyverify.metadata import inspect_distribution_metadata
from pyverify.pypi import _get_pypi_artifact_metadata_with_deadline
from pyverify.inventory import inspect_wheel_integrity
from pyverify.sdist import inspect_sdist


_ALLOWED_DOWNLOAD_HOST = "files.pythonhosted.org"
_CHUNK_SIZE = 1024 * 1024
_DEFAULT_MAX_DOWNLOAD_SIZE = 1024 * 1024 * 1024
_DEFAULT_MAX_DOWNLOAD_DURATION = 5 * 60


def _canonical_project_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _check_distribution_metadata(
    artifact_path: Path, project_name: str, version: str
) -> dict[str, Any]:
    requested = {"project_name": project_name, "version": version}
    try:
        metadata = inspect_distribution_metadata(artifact_path)
    except Exception as exc:
        return {
            "status": "invalid",
            "matches": False,
            "requested": requested,
            "actual": None,
            "detail": str(exc),
        }
    if metadata is None:
        return {
            "status": "unsupported",
            "matches": None,
            "requested": requested,
            "actual": None,
        }

    actual = {"project_name": metadata["name"], "version": metadata["version"]}
    matches = (
        _canonical_project_name(metadata["name"])
        == _canonical_project_name(project_name)
        and metadata["version"] == version
    )
    return {
        "status": "matched" if matches else "mismatch",
        "matches": matches,
        "requested": requested,
        "actual": actual,
    }


def _publisher_policy_result(
    expected_github_repository: str | None,
    expected_workflow_filename: str | None,
    matches: bool | None = None,
) -> dict[str, Any]:
    return {
        "configured": expected_github_repository is not None,
        "matches": matches,
        "expected_github_repository": expected_github_repository,
        "expected_workflow_filename": expected_workflow_filename,
        "scope": "repository_and_optional_workflow_filename",
        "not_checked": ["caller_selected_ref", "commit", "workflow_run", "environment"],
    }


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
    verify_attestations: bool,
    expected_github_repository: str | None,
    expected_workflow_filename: str | None,
    max_provenance_size: int,
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
            if (
                not filename
                or filename in (".", "..")
                or Path(filename).name != filename
                or "/" in filename
                or "\\" in filename
                or any(ord(char) < 0x20 or ord(char) == 0x7F for char in filename)
            ):
                raise ValueError("Artifact filename must be a safe path component")
            artifact_path = Path(temp_dir) / filename
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
            distribution_metadata = _check_distribution_metadata(
                artifact_path, project_name, version
            )
            if filename.lower().endswith(".whl"):
                wheel_integrity = inspect_wheel_integrity(artifact_path)
                wheel_record = wheel_integrity["record_integrity"]
                artifact_inventory = wheel_integrity["artifact_inventory"]
                sdist_inventory = {"status": "NOT_APPLICABLE", "complete": None}
            elif filename.lower().endswith(".tar.gz"):
                sdist_inventory = inspect_sdist(
                    artifact_path, project_name, version
                )
                wheel_record = {"status": "NOT_APPLICABLE", "valid": None}
                artifact_inventory = {"status": "NOT_APPLICABLE", "complete": None}
            else:
                wheel_record = {"status": "NOT_APPLICABLE", "valid": None}
                artifact_inventory = {
                    "status": "NOT_APPLICABLE",
                    "complete": None,
                }
                sdist_inventory = {"status": "NOT_APPLICABLE", "complete": None}
            provenance_availability = {
                "status": "not_checked",
                "available": None,
                "detail": None,
            }
            cryptographic_verification = {
                "status": "not_checked",
                "verified": None,
                "attestation_count": 0,
            }
            publisher_policy = _publisher_policy_result(
                expected_github_repository, expected_workflow_filename
            )
            attestation_status = "not_checked"
            if verify_attestations:
                try:
                    provenance = await _within_deadline(
                        _get_pypi_provenance_with_deadline(
                            project_name,
                            version,
                            filename,
                            deadline,
                            max_provenance_size,
                        ),
                        deadline,
                    )
                except NoAttestationsError as exc:
                    attestation_status = "missing"
                    provenance_availability = {
                        "status": "empty",
                        "available": True,
                        "detail": str(exc),
                    }
                    cryptographic_verification["status"] = "missing"
                except ProvenanceNotFoundError as exc:
                    attestation_status = "missing"
                    provenance_availability = {
                        "status": "missing",
                        "available": False,
                        "detail": str(exc),
                    }
                    cryptographic_verification["status"] = "missing"
                except TimeoutError:
                    attestation_status = "unavailable"
                    provenance_availability = {
                        "status": "unavailable",
                        "available": None,
                        "detail": "Provenance request exceeded the operation deadline.",
                    }
                    cryptographic_verification["status"] = "unavailable"
                except (OSError, RuntimeError) as exc:
                    attestation_status = "unavailable"
                    provenance_availability = {
                        "status": "unavailable",
                        "available": None,
                        "detail": str(exc),
                    }
                    cryptographic_verification["status"] = "unavailable"
                except ValueError as exc:
                    attestation_status = "malformed"
                    provenance_availability = {
                        "status": "malformed",
                        "available": True,
                        "detail": str(exc),
                    }
                    cryptographic_verification = {
                        "status": "failed",
                        "verified": False,
                        "attestation_count": 0,
                        "detail": "Provenance response was malformed or exceeded its size limit.",
                    }
                else:
                    provenance_availability = {
                        "status": "available",
                        "available": True,
                        "detail": None,
                    }
                    try:
                        verified_result = verify_pypi_provenance(
                            artifact_path,
                            provenance,
                            expected_github_repository=expected_github_repository,
                            expected_workflow_filename=expected_workflow_filename,
                            expected_sha256=hash_result["actual_sha256"],
                        )
                    except (AttestationVerificationError, ValueError, OSError) as exc:
                        attestation_status = "invalid"
                        cryptographic_verification = {
                            "status": "failed",
                            "verified": False,
                            "attestation_count": 0,
                            "detail": str(exc),
                        }
                    else:
                        attestation_status = "verified"
                        cryptographic_verification = verified_result[
                            "cryptographic_verification"
                        ]
                        cryptographic_verification["status"] = "verified"
                        publisher_policy = verified_result["publisher_policy"]
    finally:
        response.close()

    result = {
        "project_name": project_name,
        "version": version,
        "filename": filename,
        "expected_sha256": hash_result["expected_sha256"],
        "actual_sha256": hash_result["actual_sha256"],
        "matches": hash_result["matches"],
        "downloaded_size": downloaded_size,
        "download_url": download_url,
    }
    evidence_summary = build_evidence_summary(
        {
            "expected_sha256": hash_result["expected_sha256"],
            "actual_sha256": hash_result["actual_sha256"],
            "matches": hash_result["matches"],
        },
        provenance_availability,
        cryptographic_verification,
        publisher_policy,
        distribution_metadata,
        wheel_record,
        artifact_inventory,
        sdist_inventory,
    )
    result.update(
        {
            "attestation_status": attestation_status,
            "cryptographic_verification": cryptographic_verification,
            "publisher_policy": publisher_policy,
            "distribution_metadata_check": distribution_metadata,
            "wheel_record": wheel_record,
            "artifact_inventory": artifact_inventory,
            "sdist_inventory": sdist_inventory,
            "evidence_summary": evidence_summary,
            "verdict": evidence_summary["verdict"],
        }
    )
    return result


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
    verify_attestations: bool = False,
    expected_github_repository: str | None = None,
    expected_workflow_filename: str | None = None,
    max_provenance_size: int = 10 * 1024 * 1024,
) -> dict[str, Any]:
    """Fetch and verify an artifact, optionally checking PEP 740 provenance.

    Supplying either publisher-policy argument also enables attestation
    verification. Publisher-policy results are separate from signature results.
    """
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
    if not isinstance(verify_attestations, bool):
        raise ValueError("verify_attestations must be a boolean")
    verify_attestations = verify_attestations or (
        expected_github_repository is not None
        or expected_workflow_filename is not None
    )
    if expected_workflow_filename is not None and expected_github_repository is None:
        raise ValueError("An expected GitHub repository is required with a workflow")
    if expected_github_repository is not None and not isinstance(
        expected_github_repository, str
    ):
        raise ValueError("expected_github_repository must be a string")
    if expected_github_repository is not None:
        parts = expected_github_repository.split("/")
        if len(parts) != 2 or not all(parts):
            raise ValueError("expected_github_repository must be 'owner/repository'")
    if expected_workflow_filename is not None and (
        not isinstance(expected_workflow_filename, str) or not expected_workflow_filename
    ):
        raise ValueError("expected_workflow_filename must be a non-empty string")
    if (
        isinstance(max_provenance_size, bool)
        or not isinstance(max_provenance_size, int)
        or max_provenance_size < 1
    ):
        raise ValueError("max_provenance_size must be a positive integer")

    deadline = time.monotonic() + max_download_duration
    coroutine = _verify_pypi_artifact_async(
        project_name,
        version,
        filename,
        deadline,
        max_download_size,
        verify_attestations,
        expected_github_repository,
        expected_workflow_filename,
        max_provenance_size,
    )
    return _run_coroutine(coroutine)
