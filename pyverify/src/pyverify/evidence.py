"""Build deterministic evidence summaries and verification verdicts."""

from typing import Any


_OFFLINE_TRUST_LIMITATION = {
    "code": "sigstore_trust_root_freshness",
    "status": "not_checked",
    "message": (
        "Sigstore production trust material was used offline; trust-root freshness "
        "and updates were not checked during this run."
    ),
}
_PEP740_SCOPE_LIMITATION = {
    "code": "attestation_scope",
    "status": "informational",
    "message": (
        "PEP 740 attests the distribution filename and digest. Project and version "
        "are cross-checked against local archive metadata when that format supports it."
    ),
}
_PUBLISHER_POLICY_LIMITATION = {
    "code": "github_publisher_policy_scope",
    "status": "informational",
    "message": (
        "GitHub publisher policy checks the repository and optional workflow filename; "
        "it does not constrain a caller-selected ref, commit, run, or environment."
    ),
}
_RELEASE_COMPARISON_LIMITATION = {
    "code": "static_release_file_comparison",
    "status": "informational",
    "message": (
        "Static source file comparison does not prove reproducible builds or complete "
        "source-to-binary correspondence."
    ),
}


def build_evidence_summary(
    artifact_hash: dict[str, Any],
    provenance_availability: dict[str, Any],
    cryptographic_verification: dict[str, Any],
    publisher_policy: dict[str, Any],
    distribution_metadata: dict[str, Any],
    wheel_record: dict[str, Any] | None = None,
    artifact_inventory: dict[str, Any] | None = None,
    sdist_inventory: dict[str, Any] | None = None,
    release_consistency: dict[str, Any] | None = None,
    source_trace: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return evidence, warnings, and a PASS/WARNING/FAIL verdict.

    No score is calculated. A failure in a configured integrity, metadata,
    cryptographic, or publisher-policy check takes precedence over warnings.
    """
    failures = []
    warnings = []
    if release_consistency is not None:
        wheel_record = wheel_record or release_consistency.get("wheel_record")
        artifact_inventory = artifact_inventory or release_consistency.get("wheel_inventory")
        sdist_inventory = sdist_inventory or release_consistency.get("sdist_inventory")
    wheel_record = wheel_record or {"status": "NOT_APPLICABLE", "valid": None}
    artifact_inventory = artifact_inventory or {
        "status": "NOT_APPLICABLE",
        "complete": None,
    }
    sdist_inventory = sdist_inventory or {
        "status": "NOT_APPLICABLE",
        "complete": None,
    }
    release_consistency = release_consistency or {"status": "NOT_CHECKED"}
    if source_trace is not None:
        source_verdict = source_trace.get("verdict", {}).get("status")
        if source_verdict == "FAIL":
            failures.extend(source_trace.get("verdict", {}).get("reasons", ["Source trace check failed."]))
        elif source_verdict != "PASS":
            warnings.extend(source_trace.get("verdict", {}).get("reasons", ["Source trace is partial or unavailable."]))

    if artifact_hash.get("matches") is False:
        failures.append("Artifact SHA256 does not match the expected digest.")
    if distribution_metadata.get("matches") is False:
        failures.append("Artifact project/version metadata does not match the request.")
    if distribution_metadata.get("status") == "invalid":
        failures.append("Artifact distribution metadata could not be validated.")
    if wheel_record.get("status") == "RECORD_INVALID":
        failures.append("Wheel RECORD integrity verification failed.")
    if artifact_inventory.get("status") == "INVENTORY_INCOMPLETE":
        failures.append("Artifact inventory is incomplete.")
    if sdist_inventory.get("status") == "SDIST_INVENTORY_INCOMPLETE":
        warnings.append("Source distribution inventory is incomplete.")
    if release_consistency.get("status") in (
        "RELEASE_FILES_DIFFER",
        "RELEASE_FILES_PARTIAL",
    ):
        warnings.append(
            "Source and wheel file comparison is {}.".format(
                release_consistency["status"].replace("RELEASE_FILES_", "").lower()
            )
        )
    if cryptographic_verification.get("status") == "failed":
        failures.append(
            cryptographic_verification.get(
                "detail", "Configured cryptographic attestation verification failed."
            )
        )
    if publisher_policy.get("configured") and publisher_policy.get("matches") is False:
        failures.append("Verified publisher does not match the configured policy.")

    if provenance_availability.get("status") != "available":
        warnings.append(
            "Provenance evidence is {}.".format(
                provenance_availability.get("status", "unavailable")
            )
        )
    if cryptographic_verification.get("status") not in ("verified", "failed"):
        warnings.append("Cryptographic attestation verification was not completed.")
    if not publisher_policy.get("configured"):
        warnings.append(
            "No expected GitHub publisher policy was configured; publisher trust is unconfirmed."
        )
    if distribution_metadata.get("status") == "unsupported":
        warnings.append(
            "This distribution format does not expose metadata supported for project/version checks."
        )

    if failures:
        status = "FAIL"
        reasons = failures + warnings
    elif warnings:
        status = "WARNING"
        reasons = warnings
    else:
        status = "PASS"
        reasons = ["All configured integrity, attestation, and publisher checks passed."]

    return {
        "artifact_hash": artifact_hash,
        "distribution_metadata": distribution_metadata,
        "wheel_record": wheel_record,
        "artifact_inventory": artifact_inventory,
        "sdist_inventory": sdist_inventory,
        "release_consistency": release_consistency,
        "source_trace": source_trace or {"status": "NOT_CHECKED"},
        "provenance_availability": provenance_availability,
        "cryptographic_verification": cryptographic_verification,
        "publisher_policy": publisher_policy,
        "limitations": [
            _OFFLINE_TRUST_LIMITATION,
            _PEP740_SCOPE_LIMITATION,
            _PUBLISHER_POLICY_LIMITATION,
            _RELEASE_COMPARISON_LIMITATION,
        ],
        "warnings": warnings,
        "verdict": {
            "status": status,
            "reasons": reasons,
            "evidence": [
                "artifact_hash",
                "distribution_metadata",
                "wheel_record",
                "artifact_inventory",
                "sdist_inventory",
                "release_consistency",
                "source_trace",
                "provenance_availability",
                "cryptographic_verification",
                "publisher_policy",
            ],
        },
    }


def build_source_trace_verdict(source_trace: dict[str, Any]) -> dict[str, Any]:
    """Create a deterministic verdict from explicit source-trace evidence."""
    failures = []
    warnings = []
    crypto = source_trace.get("cryptographic_verification", {})
    policy = source_trace.get("repository_policy", {})
    record = source_trace.get("wheel_record", {})
    if crypto.get("status") == "failed" or crypto.get("verified") is False:
        failures.append("PEP 740 cryptographic verification failed.")
    if policy.get("configured") and policy.get("matches") is False:
        failures.append("Verified source repository does not match the configured policy.")
    if record.get("status") == "RECORD_INVALID":
        failures.append("Wheel RECORD integrity verification failed.")
    release_hashes = source_trace.get("release_artifact_hashes", {})
    if release_hashes.get("status") == "failed":
        failures.append("A local release artifact does not match PyPI's published SHA256 or size.")
    source_inventory = source_trace.get("source_inventory", {})
    structural_errors = source_inventory.get("errors", [])
    unsafe_markers = (
        "Unsafe source archive path",
        "Duplicate normalized source archive path",
        "contains a link or unsupported member",
        "Malformed or unreadable source snapshot archive",
        "top-level directory does not match repository and commit",
        "must contain exactly one top-level directory",
        "must be inside the archive top-level directory",
        "directory has an invalid non-zero size",
        "advertised size differs from actual size",
        "Actual source archive data exceeds",
    )
    if any(any(marker in error for marker in unsafe_markers) for error in structural_errors):
        failures.append("Source snapshot failed archive structure or content validation.")
    sdist_metadata = source_trace.get("sdist_inventory", {}).get("metadata")
    if isinstance(sdist_metadata, dict) and sdist_metadata.get("matches_requested_release") is False:
        failures.append("Sdist project/version metadata does not match the requested release.")
    wheel_metadata = source_trace.get("wheel_metadata")
    if isinstance(wheel_metadata, dict) and source_trace.get("wheel_metadata_matches") is False:
        failures.append("Wheel project/version metadata does not match the requested release.")

    if crypto.get("verified") is not True:
        warnings.append("Cryptographic verification of the artifact attestation is unavailable.")
    if source_trace.get("source_reference", {}).get("status") != "resolved":
        warnings.append("A verified pinned source reference is unavailable.")
    if source_trace.get("commit_resolution", {}).get("status") != "resolved":
        warnings.append("The source commit could not be resolved.")
    if policy.get("status") == "not_configured":
        warnings.append("No expected source repository policy was configured.")
    if release_hashes.get("status") != "verified":
        warnings.append("Local sdist and wheel files were not both checked against PyPI release metadata.")
    if source_trace.get("source_inventory", {}).get("complete") is not True:
        warnings.append("The source snapshot inventory is incomplete or unavailable.")
    if source_trace.get("sdist_inventory", {}).get("complete") is False:
        warnings.append("The sdist inventory is incomplete.")
    if source_trace.get("wheel_inventory", {}).get("complete") is False:
        warnings.append("The wheel inventory is incomplete.")
    if source_trace.get("file_comparison", {}).get("status") != "RELEASE_FILES_MATCH":
        warnings.append("Source-to-release file comparison is partial or reports differences.")

    if failures:
        status = "FAIL"
        reasons = failures + warnings
    elif warnings:
        status = "WARNING"
        reasons = warnings
    else:
        status = "PASS"
        reasons = ["Pinned source and release file checks passed."]
    return {
        "status": status,
        "reasons": reasons,
        "evidence": [
            "source_reference",
            "commit_resolution",
            "repository_policy",
            "source_inventory",
            "sdist_inventory",
            "wheel_inventory",
            "file_comparison",
            "cryptographic_verification",
            "wheel_record",
        ],
    }
