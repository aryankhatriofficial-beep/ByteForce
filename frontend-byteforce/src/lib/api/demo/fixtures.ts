/**
 * DEMO FIXTURES — fictional packages, fabricated digests.
 *
 * Nothing in this file describes a real PyPI project. Package names, hashes,
 * repositories and commits are invented so the interface can be explored
 * without a backend. Every report built from here carries `source: "demo"`
 * and the UI labels it as such.
 */
import type {
  ArchiveInventory, CheckResult, InventoryEntry, LogLine, PackageRelease, PackageSummary,
  PolicyInput, PolicyReport, ProvenanceReport, VerificationReport, CheckStatus, PublisherIdentity,
} from "../types";
import { deriveOverall } from "@/lib/status";

/** Deterministic pseudo-hex from a seed string (FNV-1a + xorshift). Not a real hash. */
export function fakeHex(seed: string, length = 64): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  let out = "";
  while (out.length < length) {
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, length);
}

interface FileSpec { path: string; size: number; kind: InventoryEntry["kind"]; rev?: number }

interface DemoVersion {
  version: string;
  uploadTime: string;
  files: FileSpec[];
}

interface DemoPackage {
  name: string;
  summary: string;
  requiresPython: string;
  license: string;
  requiresDist: string[];
  classifiers: string[];
  publisher: PublisherIdentity | null;
  /** Attestation predicate when provenance exists. */
  predicate?: "https://docs.pypi.org/attestations/publish/v1" | "https://slsa.dev/provenance/v1";
  versions: DemoVersion[];
  /** Scenario knobs for the latest version. */
  scenario: {
    recordHashMismatch?: string[];
    recordUnexpected?: string[];
    sdistOnly?: string[];
    sdistDiffering?: string[];
    sourceDiffering?: string[];
    commit?: string;
  };
}

const dist = (name: string, v: string) => `${name.replace(/-/g, "_")}-${v}.dist-info`;
const metaFiles = (name: string, v: string): FileSpec[] => [
  { path: `${dist(name, v)}/METADATA`, size: 4120, kind: "metadata" },
  { path: `${dist(name, v)}/WHEEL`, size: 91, kind: "metadata" },
  { path: `${dist(name, v)}/RECORD`, size: 1386, kind: "metadata" },
  { path: `${dist(name, v)}/licenses/LICENSE`, size: 1071, kind: "metadata" },
];

const KESTREL_BASE: FileSpec[] = [
  { path: "kestrel/__init__.py", size: 1204, kind: "python" },
  { path: "kestrel/client.py", size: 18233, kind: "python" },
  { path: "kestrel/pool.py", size: 9412, kind: "python" },
  { path: "kestrel/_compat.py", size: 2210, kind: "python" },
  { path: "kestrel/adapters/__init__.py", size: 310, kind: "python" },
  { path: "kestrel/adapters/h11.py", size: 7720, kind: "python" },
  { path: "kestrel/py.typed", size: 0, kind: "data" },
];

const PACKAGES: DemoPackage[] = [
  {
    name: "kestrel-http",
    summary: "A small, typed HTTP/1.1 and HTTP/2 client (fictional demo package).",
    requiresPython: ">=3.10",
    license: "MIT",
    requiresDist: ["h11>=0.14", "certifi>=2024.2.2", "h2>=4.1 ; extra == 'http2'"],
    classifiers: ["Programming Language :: Python :: 3", "Typing :: Typed", "License :: OSI Approved :: MIT License"],
    publisher: { kind: "GitHub", repository: "kestrel-labs/kestrel-http", workflow: "release.yml", environment: "pypi" },
    predicate: "https://slsa.dev/provenance/v1",
    versions: [
      { version: "2.2.0", uploadTime: "2026-03-04T10:12:00Z", files: [...KESTREL_BASE, { path: "kestrel/adapters/legacy.py", size: 4410, kind: "python" }] },
      { version: "2.3.0", uploadTime: "2026-05-19T15:40:00Z", files: [...KESTREL_BASE.map((f) => (f.path === "kestrel/client.py" ? { ...f, size: 18902, rev: 1 } : f)), { path: "kestrel/adapters/legacy.py", size: 4410, kind: "python" }, { path: "kestrel/adapters/h2.py", size: 8810, kind: "python" }] },
      { version: "2.4.0", uploadTime: "2026-08-02T09:05:00Z", files: [...KESTREL_BASE.map((f) => (f.path === "kestrel/client.py" ? { ...f, size: 19650, rev: 2 } : f)), { path: "kestrel/adapters/h2.py", size: 9124, kind: "python", rev: 1 }, { path: "kestrel/retry.py", size: 3320, kind: "python" }] },
      { version: "2.4.1", uploadTime: "2026-10-11T18:22:00Z", files: [...KESTREL_BASE.map((f) => (f.path === "kestrel/client.py" ? { ...f, size: 19688, rev: 3 } : f.path === "kestrel/pool.py" ? { ...f, size: 9530, rev: 1 } : f)), { path: "kestrel/adapters/h2.py", size: 9124, kind: "python", rev: 1 }, { path: "kestrel/retry.py", size: 3390, kind: "python", rev: 1 }] },
    ],
    scenario: { sdistOnly: ["tests/test_client.py", "tests/test_pool.py", "tests/conftest.py"], commit: fakeHex("kestrel-commit", 40) },
  },
  {
    name: "lumen-cli",
    summary: "Terminal colour and layout helpers (fictional demo package).",
    requiresPython: ">=3.9",
    license: "Apache-2.0",
    requiresDist: ["click>=8.1"],
    classifiers: ["Environment :: Console", "Programming Language :: Python :: 3"],
    publisher: null,
    versions: [
      { version: "0.8.2", uploadTime: "2026-01-21T08:00:00Z", files: [
        { path: "lumen/__init__.py", size: 402, kind: "python" }, { path: "lumen/cli.py", size: 6120, kind: "python" }, { path: "lumen/palette.py", size: 2930, kind: "python" },
      ] },
      { version: "0.9.0", uploadTime: "2026-09-14T12:30:00Z", files: [
        { path: "lumen/__init__.py", size: 402, kind: "python" }, { path: "lumen/cli.py", size: 6544, kind: "python", rev: 1 }, { path: "lumen/palette.py", size: 2930, kind: "python" }, { path: "lumen/layout.py", size: 4402, kind: "python" },
      ] },
    ],
    scenario: { sdistOnly: ["tests/test_cli.py"] },
  },
  {
    name: "quartzite",
    summary: "Geometry kernels with an optional native accelerator (fictional demo package).",
    requiresPython: ">=3.11",
    license: "BSD-3-Clause",
    requiresDist: ["numpy>=2.0"],
    classifiers: ["Programming Language :: Python :: 3.11", "Topic :: Scientific/Engineering"],
    publisher: { kind: "GitHub", repository: "quartzite-dev/quartzite", workflow: "publish.yml" },
    predicate: "https://slsa.dev/provenance/v1",
    versions: [
      { version: "1.1.0", uploadTime: "2026-04-02T07:00:00Z", files: [
        { path: "quartzite/__init__.py", size: 880, kind: "python" }, { path: "quartzite/mesh.py", size: 14020, kind: "python" }, { path: "quartzite/_native.py", size: 3120, kind: "python" },
      ] },
      { version: "1.2.0", uploadTime: "2026-10-28T21:47:00Z", files: [
        { path: "quartzite/__init__.py", size: 880, kind: "python" }, { path: "quartzite/mesh.py", size: 14388, kind: "python", rev: 1 }, { path: "quartzite/_native.py", size: 5276, kind: "python", rev: 1 }, { path: "quartzite/hooks.pth", size: 142, kind: "other" },
      ] },
    ],
    scenario: {
      recordHashMismatch: ["quartzite/_native.py"],
      recordUnexpected: ["quartzite/hooks.pth"],
      sdistDiffering: ["quartzite/_native.py"],
      sourceDiffering: ["quartzite/_native.py"],
      commit: fakeHex("quartzite-commit", 40),
    },
  },
  {
    name: "vellum-schema",
    summary: "Declarative schema validation for config files (fictional demo package).",
    requiresPython: ">=3.10",
    license: "MIT",
    requiresDist: ["pyyaml>=6", "typing-extensions>=4.10 ; python_version < '3.12'"],
    classifiers: ["Programming Language :: Python :: 3", "Typing :: Typed"],
    publisher: { kind: "GitHub", repository: "vellum-org/vellum-schema", workflow: "publish-nightly.yml", environment: "release" },
    predicate: "https://docs.pypi.org/attestations/publish/v1",
    versions: [
      { version: "2.9.1", uploadTime: "2026-02-11T11:11:00Z", files: [
        { path: "vellum/__init__.py", size: 512, kind: "python" }, { path: "vellum/schema.py", size: 22100, kind: "python" }, { path: "vellum/errors.py", size: 2400, kind: "python" },
      ] },
      { version: "3.0.0", uploadTime: "2026-10-02T16:00:00Z", files: [
        { path: "vellum/__init__.py", size: 540, kind: "python", rev: 1 }, { path: "vellum/schema.py", size: 24920, kind: "python", rev: 1 }, { path: "vellum/errors.py", size: 2400, kind: "python" }, { path: "vellum/compat/__init__.py", size: 120, kind: "python" }, { path: "vellum/compat/v2.py", size: 3810, kind: "python" }, { path: "vellum/py.typed", size: 0, kind: "data" },
      ] },
    ],
    scenario: { sdistOnly: ["tests/test_schema.py", "docs/conf.py"] },
  },
];

export const DEMO_PACKAGE_NAMES = PACKAGES.map((p) => p.name);

export const findDemoPackage = (name: string) =>
  PACKAGES.find((p) => p.name === name.trim().toLowerCase().replace(/[_.]+/g, "-"));

const wheelName = (p: DemoPackage, v: string) => `${p.name.replace(/-/g, "_")}-${v}-py3-none-any.whl`;
const sdistName = (p: DemoPackage, v: string) => `${p.name.replace(/-/g, "_")}-${v}.tar.gz`;
const fileHash = (p: DemoPackage, f: FileSpec) => fakeHex(`${p.name}:${f.path}:${f.rev ?? 0}`);
const artifactSize = (v: DemoVersion) => Math.round(v.files.reduce((a, f) => a + f.size, 0) * 0.38 + 5200);

export function demoPackageSummary(p: DemoPackage): PackageSummary {
  const releases: PackageRelease[] = p.versions.map((v) => ({
    version: v.version,
    uploadTime: v.uploadTime,
    yanked: false,
    files: [
      { filename: wheelName(p, v.version), kind: "wheel", sizeBytes: artifactSize(v), sha256: fakeHex(`${p.name}-${v.version}-whl`), uploadTime: v.uploadTime, hasProvenance: !!p.publisher },
      { filename: sdistName(p, v.version), kind: "sdist", sizeBytes: Math.round(artifactSize(v) * 1.3), sha256: fakeHex(`${p.name}-${v.version}-sdist`), uploadTime: v.uploadTime, hasProvenance: !!p.publisher },
    ],
  }));
  return { name: p.name, summary: p.summary, latestVersion: p.versions.at(-1)!.version, releases, source: "demo" as const };
}

function buildInventory(p: DemoPackage, v: DemoVersion): ArchiveInventory {
  const entries: InventoryEntry[] = [...v.files, ...metaFiles(p.name, v.version)].map((f) => ({
    path: f.path, sizeBytes: f.size, kind: f.kind,
    // RECORD lists itself without a hash; WHEEL and LICENSE do not embed the version.
    sha256: f.path.endsWith("/RECORD") ? undefined : /\/(WHEEL|licenses\/LICENSE)$/.test(f.path) ? fakeHex(`${p.name}:${f.path.split(".dist-info/")[1]}`) : fileHash(p, f),
  }));
  return {
    artifact: wheelName(p, v.version), kind: "wheel", entries,
    totalUncompressedBytes: entries.reduce((a, e) => a + e.sizeBytes, 0),
    truncated: false, limits: { maxEntries: 10_000, maxTotalBytes: 512 * 1024 * 1024 },
  };
}

function buildPolicy(p: DemoPackage, input: PolicyInput | undefined, provenance: ProvenanceReport): PolicyReport {
  if (!input || !input.repository.trim()) {
    return { status: "not_configured", expected: null, observed: p.publisher, repositoryMatch: null, workflowMatch: null, notes: ["No trusted-publisher policy was supplied for this run."] };
  }
  if (!p.publisher || provenance.status !== "pass") {
    return { status: "unavailable", expected: input, observed: null, repositoryMatch: null, workflowMatch: null, notes: ["Policy cannot be evaluated without a verified attestation identity. Missing provenance is not evidence of malice."] };
  }
  const repoMatch = input.repository.trim().toLowerCase() === (p.publisher.repository ?? "").toLowerCase();
  const wf = input.workflow?.trim();
  const wfMatch = wf ? wf === p.publisher.workflow : null;
  const notes: string[] = [];
  if (!wf) notes.push("Workflow filename was not constrained; only the repository was checked.");
  notes.push("The policy checks repository and optional workflow filename only — not every identity or workflow attribute.");
  const status: CheckStatus = !repoMatch || wfMatch === false ? "fail" : "pass";
  return { status, expected: { repository: input.repository.trim(), workflow: wf || undefined }, observed: p.publisher, repositoryMatch: repoMatch, workflowMatch: wfMatch, notes };
}

export function buildDemoReport(name: string, version: string | undefined, policy?: PolicyInput): VerificationReport | null {
  const p = findDemoPackage(name);
  if (!p) return null;
  const v = version ? p.versions.find((x) => x.version === version) : p.versions.at(-1);
  if (!v) return null;
  const isLatest = v === p.versions.at(-1);
  const sc = isLatest ? p.scenario : { sdistOnly: p.scenario.sdistOnly, commit: p.scenario.commit };
  const whl = wheelName(p, v.version);
  const expected = fakeHex(`${p.name}-${v.version}-whl`);
  const size = artifactSize(v);
  const inventory = buildInventory(p, v);
  const pyFiles = v.files.filter((f) => f.kind === "python").map((f) => f.path);

  // RECORD
  const hashMismatches = (sc.recordHashMismatch ?? []).map((path) => {
    const f = v.files.find((x) => x.path === path)!;
    return { path, expected: `sha256=${fakeHex(`${p.name}:${path}:declared`, 43)}`, observed: `sha256=${fileHash(p, f).slice(0, 43)}` };
  });
  const unexpected = (sc.recordUnexpected ?? []).map((path) => ({ path, detail: "Present in archive but not listed in RECORD" }));
  const recordTotal = inventory.entries.length - unexpected.length;
  const recordStatus: CheckStatus = hashMismatches.length || unexpected.length ? "fail" : "pass";

  // Provenance
  const provenance: ProvenanceReport = p.publisher && p.predicate
    ? {
        status: "pass", absent: false, publisher: p.publisher,
        attestations: [{
          predicateType: p.predicate, subjectName: whl, subjectSha256: expected,
          certificateIdentity: `https://github.com/${p.publisher.repository}/.github/workflows/${p.publisher.workflow}@refs/tags/v${v.version}`,
          certificateIssuer: "https://token.actions.githubusercontent.com",
          transparencyLogIndex: 140_000_000 + (parseInt(expected.slice(0, 6), 16) % 9_000_000),
          integratedTime: v.uploadTime, verified: true,
        }],
      }
    : { status: "unavailable", absent: true, attestations: [] };

  const policyReport = buildPolicy(p, policy, provenance);

  const consistencyStatus: CheckStatus = sc.sdistDiffering?.length ? "fail" : "pass";
  const consistency = {
    status: consistencyStatus, sdist: sdistName(p, v.version), wheel: whl,
    identical: pyFiles.length - (sc.sdistDiffering?.length ?? 0),
    onlyInSdist: sc.sdistOnly ?? [], onlyInWheel: [], differing: sc.sdistDiffering ?? [],
  };

  const slsa = provenance.status === "pass" && p.predicate === "https://slsa.dev/provenance/v1";
  const sourceTrace = slsa
    ? {
        status: (sc.sourceDiffering?.length ? "fail" : "pass") as CheckStatus,
        predicateType: p.predicate, repository: `https://github.com/${p.publisher!.repository}`,
        ref: `refs/tags/v${v.version}`, commit: sc.commit,
        matched: pyFiles.length - (sc.sourceDiffering?.length ?? 0),
        differing: sc.sourceDiffering ?? [], missingInSource: [], extraInSource: [],
      }
    : {
        status: "unavailable" as CheckStatus,
        reason: provenance.absent
          ? "No attestation was published, so there is no verified SLSA Provenance v1 predicate to resolve a source commit from."
          : `The verified attestation uses ${p.predicate}, not an SLSA Provenance v1 predicate; the pinned commit cannot be resolved.`,
        matched: 0, differing: [], missingInSource: [], extraInSource: [],
      };

  const lim = {
    digest: ["A matching digest proves the bytes are what PyPI serves — not that they are benign."],
    metadata: ["Metadata is read from the archive without installing or executing it; declared values are author-supplied."],
    record: ["RECORD is produced by the build backend; a consistent RECORD does not prove the code is safe."],
    inventory: ["Inventory is a bounded listing; no file is extracted to disk or executed."],
    provenance: ["A verified attestation binds the artifact to a CI identity. It does not audit that CI run's inputs."],
    policy: ["Only repository and optional workflow filename are compared — not every identity or workflow attribute."],
    consistency: ["Static comparison of Python files. It does not prove a reproducible build."],
    trace: ["Snapshot comparison is conditional on a verified SLSA v1 predicate and is not a full source-to-binary guarantee."],
  };

  const checks: CheckResult[] = [
    { id: "digest", title: "Artifact digest", status: "pass", summary: "Downloaded bytes match the SHA-256 and size published by PyPI.", durationMs: 412,
      evidence: [
        { label: "Expected SHA-256", value: expected, mono: true },
        { label: "Observed SHA-256", value: expected, mono: true, status: "pass" },
        { label: "Size", value: `${size.toLocaleString("en-US")} bytes (expected ${size.toLocaleString("en-US")})`, status: "pass" },
      ], limitations: lim.digest },
    { id: "metadata", title: "Wheel metadata", status: "pass", summary: `METADATA and WHEEL parsed for ${p.name} ${v.version}; name and version agree with the filename.`, durationMs: 38,
      evidence: [
        { label: "Name / version", value: `${p.name} ${v.version}` },
        { label: "Requires-Python", value: p.requiresPython },
        { label: "Wheel-Version / Tag", value: "1.0 · py3-none-any", mono: true },
      ], limitations: lim.metadata },
    { id: "record", title: "RECORD integrity", status: recordStatus,
      summary: recordStatus === "pass"
        ? `All ${recordTotal} RECORD entries match their declared hash and size. No missing, unexpected or duplicate entries.`
        : `${hashMismatches.length} hash mismatch(es) and ${unexpected.length} unexpected file(s) found against RECORD.`,
      durationMs: 64,
      evidence: [
        { label: "Entries verified", value: `${recordTotal - hashMismatches.length} / ${recordTotal}`, status: recordStatus },
        ...hashMismatches.map((m) => ({ label: "Hash mismatch", value: m.path, mono: true, status: "fail" as CheckStatus })),
        ...unexpected.map((m) => ({ label: "Unexpected file", value: m.path, mono: true, status: "fail" as CheckStatus })),
      ], limitations: lim.record },
    { id: "inventory", title: "Archive inventory", status: "pass", summary: `${inventory.entries.length} entries listed within bounds (${(inventory.totalUncompressedBytes / 1024).toFixed(1)} KiB uncompressed). Nothing extracted or executed.`, durationMs: 21,
      evidence: [
        { label: "Entries", value: String(inventory.entries.length) },
        { label: "Python modules", value: String(pyFiles.length) },
        { label: "Limits", value: "10,000 entries · 512 MiB" },
      ], limitations: lim.inventory },
    { id: "provenance", title: "PEP 740 provenance", status: provenance.status,
      summary: provenance.status === "pass"
        ? "Attestation retrieved from PyPI and cryptographically verified against the artifact digest via Sigstore."
        : "PyPI exposes no attestation for this file. Absence of provenance is not evidence of malice — it is simply missing evidence.",
      durationMs: provenance.status === "pass" ? 930 : 120,
      evidence: provenance.status === "pass"
        ? [
            { label: "Predicate", value: p.predicate!, mono: true },
            { label: "Identity", value: provenance.attestations[0].certificateIdentity, mono: true, status: "pass" },
            { label: "Issuer", value: provenance.attestations[0].certificateIssuer, mono: true },
            { label: "Transparency log", value: `#${provenance.attestations[0].transparencyLogIndex}`, mono: true },
          ]
        : [{ label: "Attestations", value: "none published", status: "unavailable" }],
      limitations: lim.provenance },
    { id: "publisher_policy", title: "Publisher trust policy", status: policyReport.status,
      summary: policyReport.status === "not_configured" ? "No policy supplied. Add an expected repository (and optional workflow) to evaluate."
        : policyReport.status === "unavailable" ? "No verified publisher identity is available to compare against the policy."
        : policyReport.status === "pass" ? "Verified publisher identity satisfies the supplied policy."
        : "Verified publisher identity does NOT satisfy the supplied policy.",
      durationMs: 3,
      evidence: [
        { label: "Expected repository", value: policyReport.expected?.repository ?? "—", mono: true },
        { label: "Observed repository", value: policyReport.observed?.repository ?? "—", mono: true, status: policyReport.repositoryMatch === null ? undefined : policyReport.repositoryMatch ? "pass" : "fail" },
        { label: "Expected workflow", value: policyReport.expected?.workflow ?? "not constrained", mono: true },
        { label: "Observed workflow", value: policyReport.observed?.workflow ?? "—", mono: true, status: policyReport.workflowMatch === null ? undefined : policyReport.workflowMatch ? "pass" : "fail" },
      ], limitations: lim.policy },
    { id: "release_consistency", title: "sdist ↔ wheel consistency", status: consistencyStatus,
      summary: consistencyStatus === "pass"
        ? `${consistency.identical} Python files identical between sdist and wheel. ${consistency.onlyInSdist.length} file(s) only in sdist (typically tests/docs).`
        : `${consistency.differing.length} Python file(s) differ between the sdist and the wheel.`,
      durationMs: 210,
      evidence: [
        { label: "Identical", value: String(consistency.identical) },
        { label: "Differing", value: consistency.differing.join(", ") || "none", mono: true, status: consistency.differing.length ? "fail" : "pass" },
        { label: "Only in sdist", value: consistency.onlyInSdist.join(", ") || "none", mono: true },
      ], limitations: lim.consistency },
    { id: "source_trace", title: "Verified source trace", status: sourceTrace.status,
      summary: sourceTrace.status === "unavailable" ? sourceTrace.reason!
        : sourceTrace.status === "pass" ? `Pinned commit resolved from the verified SLSA v1 predicate; ${sourceTrace.matched} Python files match the source snapshot.`
        : `${sourceTrace.differing.length} wheel file(s) differ from the source snapshot at the pinned commit.`,
      durationMs: sourceTrace.status === "unavailable" ? 2 : 1680,
      evidence: sourceTrace.status === "unavailable"
        ? [{ label: "Predicate", value: p.predicate ?? "none", mono: true, status: "unavailable" }]
        : [
            { label: "Repository", value: sourceTrace.repository!, mono: true },
            { label: "Pinned commit", value: sourceTrace.commit!, mono: true },
            { label: "Matched files", value: String(sourceTrace.matched) },
            ...sourceTrace.differing.map((d) => ({ label: "Differs from source", value: d, mono: true, status: "fail" as CheckStatus })),
          ],
      limitations: lim.trace },
  ];

  // Source trace is a separate backend workflow and is NOT part of POST /verify.
  // The demo mirrors that: the verify report never carries a source-trace result.
  const verifyChecks = checks.filter((c) => c.id !== "source_trace");
  const overall = deriveOverall(verifyChecks);
  const headline = overall === "pass"
    ? "Every requested check passed. This confirms integrity and provenance evidence — not that the code is safe."
    : overall === "warn"
      ? "Integrity checks passed, but some evidence is missing or needs review."
      : "One or more checks found evidence that contradicts what was expected.";

  let t = 0;
  const log = (level: LogLine["level"], stage: LogLine["stage"], message: string, dt: number): LogLine => { t += dt; return { t, level, stage, message }; };
  const lvl = (s: CheckStatus): LogLine["level"] => (s === "pass" ? "ok" : s === "fail" ? "error" : s === "not_checked" || s === "not_configured" || s === "not_applicable" ? "info" : "warn");
  const logs: LogLine[] = [
    log("info", "fetch", `GET pypi.org/pypi/${p.name}/${v.version}/json`, 80),
    log("info", "fetch", `selected ${whl} (${size.toLocaleString("en-US")} B)`, 40),
    log("info", "download", "bounded HTTPS download · limit 512 MiB", 60),
    log(lvl("pass"), "digest", `sha256 ${expected.slice(0, 16)}… matches PyPI digest`, 412),
    log("ok", "metadata", "METADATA + WHEEL parsed (no install, no execution)", 38),
    ...verifyChecks.slice(2).map((c) => log(lvl(c.status), c.id, `${c.title}: ${c.status.toUpperCase()} — ${c.summary}`, c.durationMs ?? 20)),
    log(lvl(overall), "summary", `overall ${overall.toUpperCase()}`, 10),
  ];

  return {
    reportId: `demo-${p.name}-${v.version}`,
    generatedAt: "2026-11-01T00:00:00Z",
    source: "demo",
    package: { name: p.name, version: v.version, summary: p.summary },
    artifact: {
      filename: whl, kind: "wheel", url: `https://files.example.invalid/${whl}`, sizeBytes: size,
      expectedSha256: expected, observedSha256: expected, observedSizeBytes: size, uploadTime: v.uploadTime, pythonTag: "py3-none-any",
    },
    overall: { status: overall, headline },
    checks: verifyChecks,
    metadata: {
      metadataVersion: "2.4", name: p.name, version: v.version, summary: p.summary, requiresPython: p.requiresPython,
      license: p.license, homepage: p.publisher?.repository ? `https://github.com/${p.publisher.repository}` : undefined,
      requiresDist: p.requiresDist, classifiers: p.classifiers, wheelVersion: "1.0", generator: "hatchling 1.27.0",
      rootIsPurelib: true, tags: ["py3-none-any"],
    },
    record: { status: recordStatus, totalEntries: recordTotal, verifiedEntries: recordTotal - hashMismatches.length, hashMismatches, sizeMismatches: [], missing: [], unexpected, duplicates: [] },
    inventory,
    provenance,
    policy: policyReport,
    consistency,
    sourceTrace: null,
    logs,
  };
}

export const demoSummaryByName = (name: string) => {
  const p = findDemoPackage(name);
  return p ? demoPackageSummary(p) : null;
};

export function demoVersionMetadata(name: string, version: string): import("../types").VersionMetadata | null {
  const p = findDemoPackage(name);
  const s = p && demoPackageSummary(p);
  const r = s?.releases.find((x) => x.version === version);
  if (!p || !r) return null;
  return { name: p.name, version, summary: p.summary, requiresPython: p.requiresPython, license: p.license, requiresDist: p.requiresDist, files: r.files, source: "demo" };
}
