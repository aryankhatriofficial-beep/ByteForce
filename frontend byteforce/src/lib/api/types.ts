/**
 * PyVerify frontend data contract.
 *
 * These types describe what the UI consumes. They mirror the KNOWN backend
 * capabilities (see docs/API_CONTRACT.md). The backend's real JSON may differ;
 * `normalize.ts` is the single place where backend payloads are mapped into
 * these shapes, so integration work happens there and nowhere else.
 */

/** Evidence-backed outcome of one check. `unavailable` is NOT a pass. */
export type CheckStatus =
  | "pass" | "warn" | "fail" | "unavailable"
  | "not_checked" | "not_applicable" | "not_configured";

export type ArtifactKind = "wheel" | "sdist" | "other";

export type CheckId =
  | "digest"
  | "metadata"
  | "record"
  | "inventory"
  | "provenance"
  | "publisher_policy"
  | "release_consistency"
  | "source_trace";

export interface EvidenceItem {
  label: string;
  value: string;
  /** Render value in monospace (hashes, paths, identities). */
  mono?: boolean;
  /** Optional per-item status, e.g. expected vs observed digest. */
  status?: CheckStatus;
}

export interface CheckResult {
  id: CheckId;
  title: string;
  status: CheckStatus;
  summary: string;
  evidence: EvidenceItem[];
  /** What this check cannot establish, shown verbatim next to the result. */
  limitations: string[];
  durationMs?: number;
}

export interface ArtifactRef {
  filename: string;
  kind: ArtifactKind;
  url: string;
  sizeBytes: number;
  /** Digest published by PyPI's JSON API. */
  expectedSha256: string;
  /** Digest computed by the backend over the downloaded bytes. Null if not downloaded. */
  observedSha256: string | null;
  observedSizeBytes: number | null;
  uploadTime?: string;
  pythonTag?: string;
}

export interface WheelMetadata {
  metadataVersion?: string;
  name: string;
  version: string;
  summary?: string;
  requiresPython?: string;
  license?: string;
  homepage?: string;
  requiresDist: string[];
  classifiers: string[];
  /** From the WHEEL file. */
  wheelVersion?: string;
  generator?: string;
  rootIsPurelib?: boolean;
  tags: string[];
}

export interface RecordEntryIssue {
  path: string;
  expected?: string;
  observed?: string;
  detail?: string;
}

export interface RecordReport {
  status: CheckStatus;
  totalEntries: number;
  verifiedEntries: number;
  hashMismatches: RecordEntryIssue[];
  sizeMismatches: RecordEntryIssue[];
  missing: RecordEntryIssue[];
  unexpected: RecordEntryIssue[];
  duplicates: RecordEntryIssue[];
}

export interface InventoryEntry {
  path: string;
  sizeBytes: number;
  sha256?: string;
  /** Classified by the backend from the archive listing; no extraction happens. */
  kind: "python" | "metadata" | "data" | "binary" | "other";
}

export interface ArchiveInventory {
  artifact: string;
  kind: ArtifactKind;
  entries: InventoryEntry[];
  totalUncompressedBytes: number;
  truncated: boolean;
  limits: { maxEntries: number; maxTotalBytes: number };
}

export interface Attestation {
  predicateType: string;
  subjectName: string;
  subjectSha256: string;
  certificateIdentity: string;
  certificateIssuer: string;
  transparencyLogIndex?: number;
  integratedTime?: string;
  verified: boolean;
  failureReason?: string;
}

export interface PublisherIdentity {
  kind: string;
  repository?: string;
  workflow?: string;
  environment?: string;
}

export interface ProvenanceReport {
  status: CheckStatus;
  /** True when PyPI exposes no provenance for the file. Absence ≠ malice. */
  absent: boolean;
  attestations: Attestation[];
  publisher?: PublisherIdentity;
}

export interface PolicyInput {
  repository: string;
  workflow?: string;
}

export interface PolicyReport {
  status: CheckStatus;
  expected: PolicyInput | null;
  observed: PublisherIdentity | null;
  repositoryMatch: boolean | null;
  workflowMatch: boolean | null;
  notes: string[];
}

export interface ConsistencyReport {
  status: CheckStatus;
  sdist: string | null;
  wheel: string | null;
  identical: number;
  onlyInSdist: string[];
  onlyInWheel: string[];
  differing: string[];
}

export interface SourceTraceReport {
  status: CheckStatus;
  /** Why the trace is unavailable, e.g. no verified SLSA Provenance v1 predicate. */
  reason?: string;
  predicateType?: string;
  repository?: string;
  ref?: string;
  commit?: string;
  matched: number;
  differing: string[];
  missingInSource: string[];
  extraInSource: string[];
}

export interface SourceTraceRequest {
  project: string;
  version: string;
  wheelFilename: string;
  sdistFilename: string;
  attestedFilename: string;
  expectedSourceRepository?: string;
}

export interface SourceTraceResponse {
  source_trace: Record<string, unknown>;
  artifacts: { filename: string; size: number; sha256: string; matches: boolean }[];
  evidence: Record<string, unknown>;
  verdict: { status: string; reasons: string[] };
}

export interface LogLine {
  /** Milliseconds since the start of verification. */
  t: number;
  level: "info" | "ok" | "warn" | "error";
  stage: CheckId | "fetch" | "download" | "summary";
  message: string;
}

export interface VerificationReport {
  reportId: string;
  generatedAt: string;
  /** `demo` reports come from bundled fixtures and must always be labelled. */
  source: "live" | "demo";
  /** The untouched backend payload (live mode), for the raw-evidence viewer. */
  raw?: unknown;
  package: { name: string; version: string; summary?: string };
  artifact: ArtifactRef;
  overall: { status: CheckStatus; headline: string };
  checks: CheckResult[];
  metadata: WheelMetadata | null;
  record: RecordReport | null;
  inventory: ArchiveInventory | null;
  provenance: ProvenanceReport | null;
  policy: PolicyReport | null;
  consistency: ConsistencyReport | null;
  sourceTrace: SourceTraceReport | null;
  logs: LogLine[];
}

export interface ReleaseFile {
  filename: string;
  kind: ArtifactKind;
  sizeBytes: number;
  sha256: string;
  uploadTime: string;
  hasProvenance?: boolean;
}

export interface PackageRelease {
  version: string;
  uploadTime: string;
  yanked: boolean;
  files: ReleaseFile[];
}

export interface PackageSummary {
  name: string;
  summary?: string;
  latestVersion: string;
  releases: PackageRelease[];
  /** `pypi` = fetched read-only from pypi.org; `demo` = bundled fictional fixture. */
  source: "pypi" | "demo";
}

export interface VerifyRequest {
  /** Sent to the backend as `project`. */
  package: string;
  version?: string;
  /** Exact artifact filename. */
  filename?: string;
  /** Defaults to true; only an explicit `false` is sent. */
  verifyAttestations?: boolean;
  policy?: PolicyInput;
}

/** Release metadata for one exact version (PyVerify release route or demo fixture). */
export interface VersionMetadata {
  name: string;
  version: string;
  summary?: string;
  requiresPython?: string;
  license?: string;
  /** `null` means the release-discovery route does not provide dependency metadata. */
  requiresDist: string[] | null;
  files: ReleaseFile[];
  source: "pypi" | "demo";
}

export interface HealthStatus {
  ok: boolean;
  version?: string;
  source: "live" | "demo";
  /** Raw health payload, shown verbatim in the connection panel. */
  raw?: unknown;
}
