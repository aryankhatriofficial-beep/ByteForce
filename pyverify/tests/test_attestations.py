import asyncio
import base64
import hashlib
import json
import time
from pathlib import Path
from threading import Event

import pytest
from pypi_attestations import Provenance

from pyverify import _http, attestations, verifier


FIXTURES = Path(__file__).parent / "fixtures"
# Genuine test assets from pypi-attestations 0.0.30's upstream test/assets.
ARTIFACT_NAME = "pypi_attestations-0.0.19.tar.gz"
ARTIFACT = FIXTURES / ARTIFACT_NAME
PROVENANCE_PATH = FIXTURES / (ARTIFACT_NAME + ".provenance")
EXPECTED_REPOSITORY = "trailofbits/pypi-attestations"
EXPECTED_WORKFLOW = "release.yml"


def load_provenance():
    return Provenance.model_validate_json(PROVENANCE_PATH.read_bytes())


def payload_bytes(payload=None):
    if payload is None:
        return PROVENANCE_PATH.read_bytes()
    return json.dumps(payload).encode("utf-8")


def mock_response(monkeypatch, body, *, status=200):
    recorded = {}

    class Response:
        url = "https://pypi.org/integrity/demo/1.0/demo.whl/provenance"

        def __init__(self):
            self.status = status

        def close(self):
            recorded["closed"] = True

        async def iter_bytes(self, chunk_size, max_bytes):
            recorded["chunk_size"] = chunk_size
            recorded["max_bytes"] = max_bytes
            for start in range(0, len(body), chunk_size):
                yield body[start : start + chunk_size]

    async def fake_open(url, allowed_host, deadline, headers=None):
        recorded.update(
            url=url, allowed_host=allowed_host, deadline=deadline, headers=headers
        )
        return Response()

    monkeypatch.setattr(attestations, "open_https_response", fake_open)
    return recorded


def test_fetch_provenance_uses_encoded_path_and_shared_transport(monkeypatch):
    recorded = mock_response(monkeypatch, payload_bytes())
    deadline = time.monotonic() + 10

    provenance = asyncio.run(
        attestations._get_pypi_provenance_with_deadline(
            "demo team", "1/0", "demo file.whl", deadline
        )
    )

    assert provenance.version == 1
    assert recorded["url"] == (
        "https://pypi.org/integrity/demo%20team/1%2F0/demo%20file.whl/provenance"
    )
    assert recorded["allowed_host"] == "pypi.org"
    assert recorded["deadline"] == deadline
    assert recorded["headers"]["Accept"] == "application/vnd.pypi.integrity.v1+json"
    assert recorded["closed"] is True


def test_fetch_provenance_rejects_malformed_json(monkeypatch):
    mock_response(monkeypatch, b"{")

    with pytest.raises(ValueError, match="malformed or unsupported"):
        asyncio.run(
            attestations._get_pypi_provenance_with_deadline(
                "demo", "1.0", "demo.whl", time.monotonic() + 10
            )
        )


def test_fetch_provenance_rejects_unsupported_version(monkeypatch):
    payload = json.loads(payload_bytes())
    payload["version"] = 2
    mock_response(monkeypatch, payload_bytes(payload))

    with pytest.raises(ValueError, match="malformed or unsupported"):
        asyncio.run(
            attestations._get_pypi_provenance_with_deadline(
                "demo", "1.0", "demo.whl", time.monotonic() + 10
            )
        )


def test_fetch_provenance_distinguishes_missing_object(monkeypatch):
    recorded = mock_response(monkeypatch, b"", status=404)

    with pytest.raises(attestations.ProvenanceNotFoundError):
        asyncio.run(
            attestations._get_pypi_provenance_with_deadline(
                "demo", "1.0", "demo.whl", time.monotonic() + 10
            )
        )
    assert recorded["closed"] is True


def test_fetch_provenance_distinguishes_empty_attestations(monkeypatch):
    mock_response(monkeypatch, payload_bytes({"version": 1, "attestation_bundles": []}))

    with pytest.raises(attestations.NoAttestationsError):
        asyncio.run(
            attestations._get_pypi_provenance_with_deadline(
                "demo", "1.0", "demo.whl", time.monotonic() + 10
            )
        )


def test_fetch_provenance_enforces_response_size(monkeypatch):
    mock_response(monkeypatch, payload_bytes())

    with pytest.raises(ValueError, match="exceeds the configured maximum"):
        asyncio.run(
            attestations._get_pypi_provenance_with_deadline(
                "demo", "1.0", "demo.whl", time.monotonic() + 10, 100
            )
        )


def test_fetch_provenance_wraps_network_errors(monkeypatch):
    async def fail_open(*args, **kwargs):
        raise OSError("offline")

    monkeypatch.setattr(attestations, "open_https_response", fail_open)

    with pytest.raises(RuntimeError, match="Could not fetch provenance"):
        attestations.get_pypi_provenance("demo", "1.0", "demo.whl")


def test_fetch_provenance_rejects_untrusted_redirect_before_connect(monkeypatch):
    calls = []

    class Reader:
        def __init__(self):
            self.lines = iter(
                [
                    b"HTTP/1.1 302 Found\r\n",
                    b"Location: https://attacker.example/provenance\r\n",
                    b"\r\n",
                ]
            )

        async def readline(self):
            return next(self.lines)

    class Writer:
        closed = False

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
        attestations.get_pypi_provenance("demo", "1.0", "demo.whl")
    assert calls == ["pypi.org"]
    assert writer.closed is True


def test_fetch_provenance_deadline_cancels_blocked_open(monkeypatch):
    monkeypatch.setattr(attestations, "_DEFAULT_REQUEST_TIMEOUT", 0.05)
    cancelled = Event()

    async def blocked_open_connection(*args, **kwargs):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(_http.asyncio, "open_connection", blocked_open_connection)
    with pytest.raises(TimeoutError):
        attestations.get_pypi_provenance("demo", "1.0", "demo.whl")
    assert cancelled.is_set()


def test_genuine_upstream_fixture_verifies_cryptographically():
    result = attestations.verify_pypi_provenance(ARTIFACT, load_provenance())

    assert result["cryptographic_verification"]["verified"] is True
    assert result["cryptographic_verification"]["attestation_count"] == 1
    assert result["publisher_policy"] == {
        "configured": False,
        "matches": None,
        "expected_github_repository": None,
        "expected_workflow_filename": None,
        "scope": "repository_and_optional_workflow_filename",
        "not_checked": ["caller_selected_ref", "commit", "workflow_run", "environment"],
    }


def test_requested_project_and_version_match_actual_sdist_metadata():
    matched = verifier._check_distribution_metadata(
        ARTIFACT, "pypi-attestations", "0.0.19"
    )
    mismatched = verifier._check_distribution_metadata(
        ARTIFACT, "another-project", "9.9"
    )

    assert matched["status"] == "matched"
    assert matched["matches"] is True
    assert matched["actual"] == {
        "project_name": "pypi-attestations",
        "version": "0.0.19",
    }
    assert mismatched["status"] == "mismatch"
    assert mismatched["matches"] is False


def test_expected_publisher_policy_is_separate_from_signature_success():
    result = attestations.verify_pypi_provenance(
        ARTIFACT,
        load_provenance(),
        expected_github_repository="another/project",
        expected_workflow_filename=EXPECTED_WORKFLOW,
    )

    assert result["cryptographic_verification"]["verified"] is True
    assert result["publisher_policy"]["configured"] is True
    assert result["publisher_policy"]["matches"] is False


def test_expected_publisher_policy_can_match_verified_identity():
    result = attestations.verify_pypi_provenance(
        ARTIFACT,
        load_provenance(),
        expected_github_repository=EXPECTED_REPOSITORY,
        expected_workflow_filename=EXPECTED_WORKFLOW,
    )

    assert result["cryptographic_verification"]["verified"] is True
    assert result["publisher_policy"]["matches"] is True
    assert result["publisher_policy"]["scope"] == "repository_and_optional_workflow_filename"


def test_wrong_artifact_digest_fails_real_signature_verification(tmp_path):
    wrong_artifact = tmp_path / ARTIFACT_NAME
    wrong_artifact.write_bytes(ARTIFACT.read_bytes() + b"changed")

    with pytest.raises(attestations.AttestationVerificationError):
        attestations.verify_pypi_provenance(wrong_artifact, load_provenance())


def test_wrong_artifact_filename_fails_real_signature_verification(tmp_path):
    wrong_artifact = tmp_path / "different-1.0.tar.gz"
    wrong_artifact.write_bytes(ARTIFACT.read_bytes())

    with pytest.raises(attestations.AttestationVerificationError):
        attestations.verify_pypi_provenance(wrong_artifact, load_provenance())


def test_invalid_signature_is_not_skipped():
    provenance = load_provenance()
    data = json.loads(provenance.model_dump_json())
    signature = base64.b64decode(
        data["attestation_bundles"][0]["attestations"][0]["envelope"]["signature"]
    )
    changed_signature = signature[:-1] + bytes([signature[-1] ^ 1])
    data["attestation_bundles"][0]["attestations"][0]["envelope"]["signature"] = (
        base64.b64encode(changed_signature).decode("ascii")
    )
    invalid = Provenance.model_validate(data)

    with pytest.raises(attestations.AttestationVerificationError):
        attestations.verify_pypi_provenance(ARTIFACT, invalid)


def test_invalid_certificate_is_not_accepted():
    data = json.loads(PROVENANCE_PATH.read_bytes())
    data["attestation_bundles"][0]["attestations"][0]["verification_material"][
        "certificate"
    ] = base64.b64encode(b"not an X.509 certificate").decode("ascii")
    invalid = Provenance.model_validate(data)

    with pytest.raises(attestations.AttestationVerificationError):
        attestations.verify_pypi_provenance(ARTIFACT, invalid)


def test_invalid_transparency_proof_is_not_accepted():
    data = json.loads(PROVENANCE_PATH.read_bytes())
    proof = data["attestation_bundles"][0]["attestations"][0][
        "verification_material"
    ]["transparency_entries"][0]["inclusionProof"]
    proof["rootHash"] = "AAAA"
    invalid = Provenance.model_validate(data)

    with pytest.raises(attestations.AttestationVerificationError):
        attestations.verify_pypi_provenance(ARTIFACT, invalid)


def test_multiple_bundles_are_all_verified():
    provenance = load_provenance()
    provenance = provenance.model_copy(
        update={
            "attestation_bundles": [
                provenance.attestation_bundles[0],
                provenance.attestation_bundles[0],
            ]
        }
    )

    result = attestations.verify_pypi_provenance(ARTIFACT, provenance)
    assert result["cryptographic_verification"]["attestation_count"] == 2


def test_invalid_attestation_in_later_bundle_fails_instead_of_skipping():
    provenance = load_provenance()
    good_bundle = provenance.attestation_bundles[0]
    data = json.loads(good_bundle.model_dump_json())
    signature = base64.b64decode(data["attestations"][0]["envelope"]["signature"])
    data["attestations"][0]["envelope"]["signature"] = base64.b64encode(
        signature[:-1] + bytes([signature[-1] ^ 1])
    ).decode("ascii")
    bad_bundle = type(good_bundle).model_validate(data)
    provenance = provenance.model_copy(
        update={"attestation_bundles": [good_bundle, bad_bundle]}
    )

    with pytest.raises(attestations.AttestationVerificationError):
        attestations.verify_pypi_provenance(ARTIFACT, provenance)


def test_integration_reuses_single_artifact_download(monkeypatch):
    content = ARTIFACT.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    download_count = []

    async def metadata(project_name, version, filename, deadline):
        return {
            "project_name": project_name,
            "version": version,
            "filename": ARTIFACT_NAME,
            "sha256": digest,
            "url": "https://files.pythonhosted.org/packages/example/" + ARTIFACT_NAME,
            "packagetype": "sdist",
            "size": len(content),
        }

    class Response:
        url = "https://files.pythonhosted.org/packages/example/" + ARTIFACT_NAME
        status = 200

        def close(self):
            pass

        async def iter_bytes(self, chunk_size, max_bytes):
            for start in range(0, len(content), chunk_size):
                yield content[start : start + chunk_size]

    async def open_response(*args, **kwargs):
        download_count.append("artifact")
        return Response()

    async def provenance(*args, **kwargs):
        download_count.append("provenance")
        return load_provenance()

    monkeypatch.setattr(verifier, "_get_pypi_artifact_metadata_with_deadline", metadata)
    monkeypatch.setattr(verifier, "open_https_response", open_response)
    monkeypatch.setattr(verifier, "_get_pypi_provenance_with_deadline", provenance)

    result = verifier.verify_pypi_artifact(
        "pypi-attestations",
        "0.0.19",
        ARTIFACT_NAME,
        verify_attestations=True,
        expected_github_repository=EXPECTED_REPOSITORY,
        expected_workflow_filename=EXPECTED_WORKFLOW,
    )

    assert result["matches"] is True
    assert result["attestation_status"] == "verified"
    assert result["cryptographic_verification"]["verified"] is True
    assert result["publisher_policy"]["matches"] is True
    assert result["verdict"]["status"] == "PASS"
    assert result["evidence_summary"]["artifact_hash"]["matches"] is True
    assert result["evidence_summary"]["distribution_metadata"]["matches"] is True
    assert result["evidence_summary"]["provenance_availability"]["status"] == "available"
    assert result["evidence_summary"]["cryptographic_verification"]["verified"] is True
    assert download_count == ["artifact", "provenance"]


def test_integration_reports_missing_provenance_without_claiming_failure(monkeypatch):
    content = ARTIFACT.read_bytes()
    digest = hashlib.sha256(content).hexdigest()

    async def metadata(project_name, version, filename, deadline):
        return {
            "project_name": project_name,
            "version": version,
            "filename": filename,
            "sha256": digest,
            "url": "https://files.pythonhosted.org/packages/example/" + filename,
            "packagetype": "sdist",
            "size": len(content),
        }

    class Response:
        url = "https://files.pythonhosted.org/packages/example/" + ARTIFACT_NAME
        status = 200

        def close(self):
            pass

        async def iter_bytes(self, chunk_size, max_bytes):
            yield content

    async def open_response(*args, **kwargs):
        return Response()

    async def no_provenance(*args, **kwargs):
        raise attestations.ProvenanceNotFoundError("no provenance")

    monkeypatch.setattr(verifier, "_get_pypi_artifact_metadata_with_deadline", metadata)
    monkeypatch.setattr(verifier, "open_https_response", open_response)
    monkeypatch.setattr(verifier, "_get_pypi_provenance_with_deadline", no_provenance)

    result = verifier.verify_pypi_artifact(
        "pypi-attestations", "0.0.19", ARTIFACT_NAME, verify_attestations=True
    )

    assert result["matches"] is True
    assert result["attestation_status"] == "missing"
    assert result["cryptographic_verification"] == {
        "status": "missing",
        "verified": None,
        "attestation_count": 0,
    }
    assert result["publisher_policy"]["matches"] is None
    assert result["verdict"]["status"] == "WARNING"
