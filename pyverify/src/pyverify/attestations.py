"""Fetch and verify PEP 740 attestations served by PyPI."""

import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

from pydantic import ValidationError
from pypi_attestations import Distribution, GitHubPublisher, Provenance

from pyverify._http import open_https_response
from pyverify.pypi import _run_coroutine_sync


_INTEGRITY_API_BASE_URL = "https://pypi.org/integrity"
_ALLOWED_API_HOST = "pypi.org"
_DEFAULT_MAX_RESPONSE_SIZE = 10 * 1024 * 1024
_RESPONSE_CHUNK_SIZE = 64 * 1024
_DEFAULT_REQUEST_TIMEOUT = 10


class ProvenanceNotFoundError(FileNotFoundError):
    """PyPI has no provenance object for the requested distribution."""


class NoAttestationsError(ProvenanceNotFoundError):
    """The provenance object exists but contains no attestations."""


class AttestationVerificationError(RuntimeError):
    """One or more PEP 740 attestations failed cryptographic verification."""


def _provenance_url(project_name: str, version: str, filename: str) -> str:
    components = (project_name, version, filename)
    if any(not isinstance(value, str) or not value for value in components):
        raise ValueError("Project, version, and filename must be non-empty strings")
    return "{}/{}/{}/{}/provenance".format(
        _INTEGRITY_API_BASE_URL,
        *(quote(value, safe="") for value in components),
    )


async def _get_pypi_provenance_with_deadline(
    project_name: str,
    version: str,
    filename: str,
    deadline: float,
    max_response_size: int = _DEFAULT_MAX_RESPONSE_SIZE,
) -> Provenance:
    """Retrieve and validate one bounded provenance response from PyPI."""
    if (
        isinstance(max_response_size, bool)
        or not isinstance(max_response_size, int)
        or max_response_size < 1
    ):
        raise ValueError("max_response_size must be a positive integer")

    response = await open_https_response(
        _provenance_url(project_name, version, filename),
        allowed_host=_ALLOWED_API_HOST,
        deadline=deadline,
        headers={"Accept": "application/vnd.pypi.integrity.v1+json"},
    )
    try:
        if response.status == 404:
            raise ProvenanceNotFoundError(
                "PyPI has no provenance for {} {} ({})".format(
                    project_name, version, filename
                )
            )
        if not 200 <= response.status < 300:
            raise RuntimeError("PyPI returned an unsuccessful provenance response")

        body = bytearray()
        async for chunk in response.iter_bytes(
            _RESPONSE_CHUNK_SIZE, max_response_size
        ):
            if len(body) + len(chunk) > max_response_size:
                raise ValueError(
                    "PyPI provenance response exceeds the configured maximum size"
                )
            body.extend(chunk)

        try:
            provenance = Provenance.model_validate_json(bytes(body))
        except (ValidationError, ValueError, TypeError) as exc:
            raise ValueError("PyPI returned malformed or unsupported provenance") from exc

        if provenance.version != 1:
            raise ValueError("Unsupported PyPI provenance version")
        if not any(bundle.attestations for bundle in provenance.attestation_bundles):
            raise NoAttestationsError(
                "PyPI provenance contains no attestations for {}".format(filename)
            )
        return provenance
    finally:
        response.close()


def get_pypi_provenance(
    project_name: str,
    version: str,
    filename: str,
    *,
    deadline: float | None = None,
    max_response_size: int = _DEFAULT_MAX_RESPONSE_SIZE,
) -> Provenance:
    """Fetch a version-1 provenance object from PyPI's Integrity API.

    A missing object raises :class:`ProvenanceNotFoundError`; malformed
    objects raise ``ValueError`` and request failures raise ``RuntimeError``.
    """
    if deadline is None:
        deadline = time.monotonic() + _DEFAULT_REQUEST_TIMEOUT
    try:
        return _run_coroutine_sync(
            _get_pypi_provenance_with_deadline(
                project_name, version, filename, deadline, max_response_size
            )
        )
    except (TimeoutError, ProvenanceNotFoundError, ValueError, RuntimeError):
        raise
    except OSError as exc:
        raise RuntimeError("Could not fetch provenance from PyPI") from exc


def verify_pypi_provenance(
    artifact_path: str | Path,
    provenance: Provenance,
    *,
    expected_github_repository: str | None = None,
    expected_workflow_filename: str | None = None,
    expected_sha256: str | None = None,
) -> dict[str, Any]:
    """Verify attestations and report repository/workflow-filename policy.

    Sigstore's production trust configuration is used. Verification is offline
    so this operation uses the trust material available to the Sigstore client
    without adding separate, unbounded network requests. The GitHub policy does
    not constrain a branch, tag, commit, or individual workflow run.
    """
    path = Path(artifact_path)
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
        not isinstance(expected_workflow_filename, str)
        or not expected_workflow_filename
    ):
        raise ValueError("expected_workflow_filename must be a non-empty string")

    distribution = Distribution.from_file(path)
    if distribution.name != path.name:
        raise ValueError("Artifact filename could not be determined safely")
    if expected_sha256 is not None and distribution.digest != expected_sha256.lower():
        raise AttestationVerificationError(
            "Artifact changed after its SHA256 was calculated"
        )

    verified = []
    for bundle in provenance.attestation_bundles:
        for attestation in bundle.attestations:
            try:
                predicate_type, predicate = attestation.verify(
                    identity=bundle.publisher,
                    dist=distribution,
                    offline=True,
                )
            except Exception as exc:
                raise AttestationVerificationError(
                    "PEP 740 attestation failed cryptographic verification"
                ) from exc

            publisher = bundle.publisher
            identity = {
                "kind": publisher.kind,
            }
            if isinstance(publisher, GitHubPublisher):
                identity.update(
                    {
                        "repository": publisher.repository,
                        "workflow": publisher.workflow,
                        "environment": publisher.environment,
                    }
                )
            verified.append(
                {
                    "predicate_type": predicate_type,
                    "predicate": predicate,
                    "publisher": identity,
                    "cryptographically_verified": True,
                }
            )

    if not verified:
        raise NoAttestationsError("Provenance contains no attestations")

    policy_configured = expected_github_repository is not None
    policy_matches = None
    if policy_configured:
        policy_matches = any(
            item["publisher"].get("kind") == "GitHub"
            and item["publisher"].get("repository") == expected_github_repository
            and (
                expected_workflow_filename is None
                or item["publisher"].get("workflow") == expected_workflow_filename
            )
            for item in verified
        )

    return {
        "cryptographic_verification": {
            "verified": True,
            "attestation_count": len(verified),
            "attestations": verified,
        },
        "publisher_policy": {
            "configured": policy_configured,
            "matches": policy_matches,
            "expected_github_repository": expected_github_repository,
            "expected_workflow_filename": expected_workflow_filename,
            "scope": "repository_and_optional_workflow_filename",
            "not_checked": ["caller_selected_ref", "commit", "workflow_run", "environment"],
        },
    }
