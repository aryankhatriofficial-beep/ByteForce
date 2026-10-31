/** Maps the concrete PyVerify response contract into the existing evidence UI. */
import { ApiError } from "./errors";
import { normalizeStatus } from "@/lib/status";
import type { CheckId, CheckResult, HealthStatus, VerificationReport } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, fallback = "") => typeof v === "string" ? v : fallback;
const camel = (key: string) => key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
export function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [camel(k), camelizeKeys(v)]));
  return value;
}
const keys: Record<string, CheckId> = {
  artifact_sha256: "digest", distribution_metadata: "metadata", wheel_record: "record",
  wheel_inventory: "inventory", sdist_inventory: "inventory", provenance_availability: "provenance",
  cryptographic_attestation: "provenance", publisher_policy: "publisher_policy",
  release_consistency: "release_consistency", source_trace: "source_trace",
};
const titles: Record<CheckId, string> = {
  digest: "Artifact SHA-256", metadata: "Distribution metadata", record: "Wheel RECORD",
  inventory: "Archive inventory", provenance: "PEP 740 attestation", publisher_policy: "Publisher policy",
  release_consistency: "Release consistency", source_trace: "Source trace",
};

export function normalizeReport(payload: unknown): VerificationReport {
  if (!isObj(payload) || !isObj(payload.verification) || !isObj(payload.evidence) || !isObj(payload.verdict)) {
    throw new ApiError("invalid_response", "Response is missing verification, evidence, or verdict from the PyVerify contract.");
  }
  const v = payload.verification;
  const verdict = payload.verdict;
  const evidence = payload.evidence;
  if (typeof v.filename !== "string" || typeof v.project_name !== "string" || typeof v.version !== "string") {
    throw new ApiError("invalid_response", "Verification response is missing its project, version, or exact filename.");
  }
  const overall = normalizeStatus(verdict.status);
  const checks: CheckResult[] = [];
  const seen = new Set<CheckId>();
  for (const [key, id] of Object.entries(keys)) {
    const raw = evidence[key];
    if (!isObj(raw) || seen.has(id)) continue;
    seen.add(id);
    const stage = str(raw.stage_status, str(raw.status, "NOT_CHECKED"));
    const detail = Object.entries(raw)
      .filter(([k, value]) => k !== "stage_status" && value !== null && ["string", "number", "boolean"].includes(typeof value))
      .map(([k, value]) => `${k}: ${String(value)}`);
    checks.push({
      id, title: titles[id], status: normalizeStatus(stage),
      summary: detail.length ? detail.join(" · ") : `Backend stage status: ${stage}`,
      evidence: Object.entries(raw).filter(([k, value]) => k !== "stage_status" && value !== null && ["string", "number", "boolean"].includes(typeof value)).map(([label, value]) => ({ label, value: String(value), mono: /sha|filename|repository/i.test(label) })),
      limitations: [],
    });
  }
  if (!checks.length) throw new ApiError("invalid_response", "Verification response contained no recognized evidence stages.");
  const expected = str(v.expected_sha256);
  const observed = str(v.actual_sha256) || null;
  const evidenceSummary = isObj(v.evidence_summary) ? v.evidence_summary : {};
  const limitations = Array.isArray(evidenceSummary.limitations) ? evidenceSummary.limitations : [];
  const reasons = Array.isArray(verdict.reasons) ? verdict.reasons.filter((x): x is string => typeof x === "string") : [];
  return {
    reportId: `live-${Date.now()}`, generatedAt: new Date().toISOString(), source: "live", raw: payload,
    package: { name: v.project_name, version: v.version },
    artifact: { filename: v.filename, kind: v.filename.endsWith(".tar.gz") ? "sdist" : v.filename.endsWith(".whl") ? "wheel" : "other", url: "", sizeBytes: typeof v.downloaded_size === "number" ? v.downloaded_size : 0, expectedSha256: expected, observedSha256: observed, observedSizeBytes: typeof v.downloaded_size === "number" ? v.downloaded_size : null },
    overall: { status: overall, headline: reasons.join(" ") || `Backend verdict: ${str(verdict.status)}` },
    checks, metadata: null, record: null, inventory: null, provenance: null, policy: null, consistency: null,
    sourceTrace: { status: "not_checked", matched: 0, differing: [], missingInSource: [], extraInSource: [] }, logs: [],
  };
}

export function normalizeHealth(payload: unknown): HealthStatus {
  if (!isObj(payload) || payload.status !== "ok" || payload.service !== "pyverify") {
    throw new ApiError("invalid_response", "Health response did not match { status: 'ok', service: 'pyverify' }.");
  }
  return { ok: true, source: "live", raw: payload };
}
