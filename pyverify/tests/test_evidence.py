from pyverify.evidence import build_evidence_summary


def make_summary(
    *,
    hash_matches=True,
    metadata_status="matched",
    metadata_matches=True,
    provenance_status="available",
    crypto_status="verified",
    publisher_configured=True,
    publisher_matches=True,
):
    return build_evidence_summary(
        {"expected_sha256": "a" * 64, "actual_sha256": "a" * 64, "matches": hash_matches},
        {"status": provenance_status, "available": provenance_status == "available"},
        {"status": crypto_status, "verified": crypto_status == "verified", "attestation_count": 1},
        {"configured": publisher_configured, "matches": publisher_matches},
        {"status": metadata_status, "matches": metadata_matches},
    )


def test_evidence_verdict_passes_only_when_configured_checks_pass():
    summary = make_summary()

    assert summary["verdict"]["status"] == "PASS"
    assert summary["verdict"]["evidence"]
    assert summary["verdict"]["reasons"]
    assert any(
        item["code"] == "sigstore_trust_root_freshness"
        and item["status"] == "not_checked"
        for item in summary["limitations"]
    )


def test_evidence_verdict_warns_when_optional_evidence_is_unavailable():
    summary = make_summary(
        provenance_status="missing",
        crypto_status="missing",
        publisher_configured=False,
        publisher_matches=None,
    )

    assert summary["verdict"]["status"] == "WARNING"
    assert summary["warnings"]


def test_evidence_verdict_fails_when_configured_check_fails():
    summary = make_summary(hash_matches=False)

    assert summary["verdict"]["status"] == "FAIL"
    assert any("SHA256" in reason for reason in summary["verdict"]["reasons"])


def test_failed_cryptographic_verification_produces_fail_verdict():
    summary = make_summary(crypto_status="failed")

    assert summary["verdict"]["status"] == "FAIL"
    assert any("cryptographic" in reason.lower() for reason in summary["verdict"]["reasons"])


def test_distribution_metadata_mismatch_fails_verdict():
    summary = make_summary(metadata_status="mismatch", metadata_matches=False)

    assert summary["verdict"]["status"] == "FAIL"
    assert any("project/version" in reason for reason in summary["verdict"]["reasons"])


def test_publisher_policy_mismatch_fails_even_if_signature_is_valid():
    summary = make_summary(publisher_matches=False)

    assert summary["cryptographic_verification"]["verified"] is True
    assert summary["verdict"]["status"] == "FAIL"


def test_invalid_wheel_record_fails_verdict_with_evidence():
    summary = build_evidence_summary(
        {"matches": True},
        {"status": "available"},
        {"status": "verified"},
        {"configured": True, "matches": True},
        {"status": "matched", "matches": True},
        {"status": "RECORD_INVALID", "valid": False, "errors": ["bad digest"]},
        {"status": "INVENTORY_COMPLETE", "complete": True},
    )

    assert summary["verdict"]["status"] == "FAIL"
    assert "wheel_record" in summary["verdict"]["evidence"]
    assert summary["wheel_record"]["errors"] == ["bad digest"]


def test_incomplete_inventory_fails_verdict():
    summary = build_evidence_summary(
        {"matches": True},
        {"status": "available"},
        {"status": "verified"},
        {"configured": True, "matches": True},
        {"status": "matched", "matches": True},
        {"status": "RECORD_INVALID", "valid": False},
        {"status": "INVENTORY_INCOMPLETE", "complete": False},
    )

    assert summary["verdict"]["status"] == "FAIL"


def test_source_trace_is_added_to_general_evidence_without_promoting_partial_to_pass():
    trace = {
        "status": "SOURCE_TRACE_PARTIAL",
        "verdict": {"status": "WARNING", "reasons": ["Pinned source unavailable"]},
    }
    summary = build_evidence_summary(
        {"matches": True},
        {"status": "available"},
        {"status": "verified"},
        {"configured": True, "matches": True},
        {"status": "matched", "matches": True},
        source_trace=trace,
    )
    assert summary["source_trace"] == trace
    assert summary["verdict"]["status"] == "WARNING"


def test_source_trace_configured_policy_failure_fails_general_evidence():
    trace = {
        "status": "SOURCE_TRACE_PARTIAL",
        "verdict": {"status": "FAIL", "reasons": ["Repository policy mismatch"]},
    }
    summary = build_evidence_summary(
        {"matches": True},
        {"status": "available"},
        {"status": "verified"},
        {"configured": True, "matches": True},
        {"status": "matched", "matches": True},
        source_trace=trace,
    )
    assert summary["verdict"]["status"] == "FAIL"
