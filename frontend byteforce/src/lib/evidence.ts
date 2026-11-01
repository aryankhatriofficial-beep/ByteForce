/**
 * Evidence spine model. Maps a backend VerificationReport onto the seven
 * stages of the PyVerify evidence spine. Rules:
 *  - a stage only shows a result the backend actually returned;
 *  - a missing check is NOT_CHECKED / NOT_CONFIGURED / UNAVAILABLE — never PASS;
 *  - source trace is a separate workflow and stays NOT_CHECKED unless the
 *    report carries a real source-trace result.
 */
import type { CheckResult, CheckStatus, EvidenceItem, VerificationReport } from "@/lib/api/types";

export type StageId = "artifact" | "digest" | "metadata" | "attestation" | "policy" | "record" | "source";

export interface StageCopy { id: StageId; title: string; short: string; checks: string; proves: string; notProves: string }

export interface Stage extends StageCopy {
  status: CheckStatus;
  summary: string;
  evidence: EvidenceItem[];
  limitations: string[];
  /** Backend check objects that fed this stage, for the raw viewer. */
  sources: CheckResult[];
}

export const STAGE_COPY: StageCopy[] = [
  { id: "artifact", title: "PyPI artifact", short: "Artifact",
    checks: "The exact file published on PyPI is located and downloaded over HTTPS within a hard size limit.",
    proves: "PyVerify inspected one specific, named distribution file.",
    notProves: "Anything about its contents — retrieval is only the starting point." },
  { id: "digest", title: "SHA-256 digest", short: "SHA-256",
    checks: "The downloaded bytes are hashed and compared with the SHA-256 and size PyPI publishes.",
    proves: "The bytes analysed are exactly the bytes PyPI serves for that filename.",
    notProves: "That those bytes are benign. A matching hash is integrity, not safety." },
  { id: "metadata", title: "Distribution metadata", short: "Metadata",
    checks: "METADATA and WHEEL are parsed from the archive — nothing is installed or imported.",
    proves: "The declared name, version and tags agree with the file.",
    notProves: "That the author's declarations (dependencies, licence) are truthful." },
  { id: "attestation", title: "PEP 740 attestation", short: "Attestation",
    checks: "Attestations published on PyPI are fetched and verified with Sigstore against the artifact digest.",
    proves: "A specific CI identity signed this exact file, recorded in a transparency log.",
    notProves: "That the CI run's inputs were trustworthy. Missing provenance is not evidence of malice." },
  { id: "policy", title: "Publisher policy", short: "Publisher",
    checks: "The verified signing identity is compared with the repository (and optional workflow file) you expect.",
    proves: "The artifact was signed by the publisher you named.",
    notProves: "Every identity attribute — branch protections, approvals or who triggered the run." },
  { id: "record", title: "RECORD & archive inventory", short: "RECORD",
    checks: "Each archive member is listed within bounds and checked against RECORD hashes and sizes.",
    proves: "The archive agrees with its own manifest: no missing, unexpected or altered files.",
    notProves: "That the build inputs were trustworthy. RECORD is written by the build itself." },
  { id: "source", title: "Source trace", short: "Source",
    checks: "With a verified SLSA v1 predicate, the pinned commit is resolved and compared with the wheel.",
    proves: "The compared Python files correspond to that commit.",
    notProves: "A full source-to-binary guarantee or a reproducible build." },
];

const find = (r: VerificationReport, id: CheckResult["id"]) => r.checks.find((c) => c.id === id);
const RANK: Record<CheckStatus, number> = { fail: 6, warn: 5, unavailable: 4, pass: 3, not_configured: 2, not_checked: 1, not_applicable: 0 };
const worst = (xs: CheckStatus[]) => xs.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));

export interface StageContext {
  /** False when the user switched attestation verification off for this run. */
  attestationsRequested: boolean;
  /** True when the user supplied an expected repository. */
  policySupplied: boolean;
}

export function buildStages(r: VerificationReport, ctx: StageContext): Stage[] {
  const out: Stage[] = [];
  const make = (id: StageId, status: CheckStatus, summary: string, evidence: EvidenceItem[], sources: CheckResult[]) => {
    const copy = STAGE_COPY.find((s) => s.id === id)!;
    out.push({ ...copy, status, summary, evidence, sources, limitations: sources.flatMap((s) => s.limitations) });
  };

  // 1. Artifact — derived only from fields the backend returned.
  const a = r.artifact;
  make("artifact", a.observedSha256 ? "pass" : "unavailable",
    a.observedSha256 ? `Retrieved ${a.filename}.` : "The backend did not report downloading the artifact.",
    [
      { label: "Filename", value: a.filename, mono: true },
      ...(a.url ? [{ label: "URL", value: a.url, mono: true }] : []),
      ...(a.sizeBytes ? [{ label: "Published size", value: `${a.sizeBytes.toLocaleString("en-US")} bytes` }] : []),
      ...(a.uploadTime ? [{ label: "Uploaded", value: a.uploadTime }] : []),
    ], []);

  // 2. Digest
  const dg = find(r, "digest");
  make("digest", dg?.status ?? "not_checked", dg?.summary ?? "The backend returned no digest check.",
    dg?.evidence.length ? dg.evidence : [
      ...(a.expectedSha256 ? [{ label: "PyPI SHA-256", value: a.expectedSha256, mono: true }] : []),
      ...(a.observedSha256 ? [{ label: "Observed SHA-256", value: a.observedSha256, mono: true }] : []),
    ], dg ? [dg] : []);

  // 3. Metadata
  const md = find(r, "metadata");
  const notWheel = a.kind === "sdist";
  make("metadata", md?.status ?? (notWheel ? "not_applicable" : "not_checked"), md?.summary ?? (notWheel ? "Wheel metadata does not apply to an sdist." : "The backend returned no metadata check."),
    md?.evidence ?? [], md ? [md] : []);

  // 4. Attestation
  const pv = find(r, "provenance");
  const pvStatus: CheckStatus = pv?.status ?? (!ctx.attestationsRequested ? "not_checked" : r.provenance?.absent ? "unavailable" : "not_checked");
  make("attestation", pvStatus,
    pv?.summary ?? (!ctx.attestationsRequested ? "Attestation verification was switched off for this run." : r.provenance?.absent ? "PyPI exposes no attestation for this file. Missing evidence — not evidence of malice." : "The backend returned no attestation result."),
    pv?.evidence ?? [], pv ? [pv] : []);

  // 5. Publisher policy
  const pol = find(r, "publisher_policy");
  make("policy", pol?.status ?? (ctx.policySupplied ? "not_checked" : "not_configured"),
    pol?.summary ?? (ctx.policySupplied ? "The backend returned no policy result." : "No expected publisher repository was supplied."),
    pol?.evidence ?? [], pol ? [pol] : []);

  // 6. RECORD + inventory (+ release consistency as supporting detail)
  const rec = find(r, "record"), inv = find(r, "inventory"), con = find(r, "release_consistency");
  const recSources = [rec, inv, con].filter(Boolean) as CheckResult[];
  const recStatus: CheckStatus = recSources.length ? worst(recSources.map((c) => c.status)) : notWheel ? "not_applicable" : "not_checked";
  make("record", recStatus,
    rec?.summary ?? inv?.summary ?? (notWheel ? "RECORD only exists in wheels." : "The backend returned no RECORD or inventory check."),
    recSources.flatMap((c) => c.evidence.map((e) => ({ ...e, label: `${c.title} · ${e.label}` }))), recSources);

  // 7. Source trace — separate workflow; NOT_CHECKED unless it really ran.
  const st = find(r, "source_trace");
  make("source", st?.status ?? "not_checked",
    st?.summary ?? r.sourceTrace?.reason ?? "Source trace is a separate workflow and has not run for this artifact.",
    st?.evidence ?? [], st ? [st] : []);

  return out;
}

/** Index of the last stage in an unbroken run of PASS from the start (for the signal line). */
export const passRun = (stages: Pick<Stage, "status">[]) => {
  let i = -1;
  for (const s of stages) { if (s.status !== "pass") break; i++; }
  return i;
};
