import { describe, expect, it } from "vitest";
import { parseIdentifier, parseArtifactFilename, validatePolicy } from "./validation";
import { deriveOverall, normalizeStatus } from "./status";
import { camelizeKeys, normalizeReport } from "./api/normalize";
import { buildDemoReport } from "./api/demo/fixtures";
import { diffInventories, diffCounts } from "./diff";
import { digestsEqual, chunkHex, sha256Hex } from "./hash";

describe("parseIdentifier", () => {
  it("accepts name and pinned forms", () => {
    expect(parseIdentifier("Kestrel_HTTP")).toEqual({ ok: true, value: { name: "kestrel-http", version: undefined } });
    expect(parseIdentifier("kestrel-http==2.4.1")).toMatchObject({ ok: true, value: { version: "2.4.1" } });
    expect(parseIdentifier("kestrel-http @ 2.4.1")).toMatchObject({ ok: true, value: { version: "2.4.1" } });
    expect(parseIdentifier("https://pypi.org/project/kestrel-http/2.4.1/")).toMatchObject({ ok: true, value: { name: "kestrel-http", version: "2.4.1" } });
  });
  it("rejects ranges and junk", () => {
    expect(parseIdentifier("kestrel>=2").ok).toBe(false);
    expect(parseIdentifier("").ok).toBe(false);
    expect(parseIdentifier("-bad-").ok).toBe(false);
  });
  it("parses wheel filenames", () => {
    expect(parseArtifactFilename("kestrel_http-2.4.1-py3-none-any.whl")).toEqual({ name: "kestrel-http", version: "2.4.1", filename: "kestrel_http-2.4.1-py3-none-any.whl" });
    expect(parseArtifactFilename("quartzite-1.2.0.tar.gz")?.version).toBe("1.2.0");
  });
  it("validates policy inputs", () => {
    expect(validatePolicy("", "")).toBeNull();
    expect(validatePolicy("", "release.yml")).not.toBeNull();
    expect(validatePolicy("owner/repo", "release.yml")).toBeNull();
    expect(validatePolicy("owner/repo", ".github/workflows/release.yml")).not.toBeNull();
  });
});

describe("status semantics", () => {
  it("never maps unknown values to pass", () => {
    expect(normalizeStatus("PASSED")).toBe("pass");
    expect(normalizeStatus("WARNING")).toBe("warn");
    expect(normalizeStatus("something-new")).toBe("unavailable");
    expect(normalizeStatus(undefined)).toBe("unavailable");
  });
  it("derives overall conservatively", () => {
    expect(deriveOverall([{ status: "pass" }, { status: "not_configured" }])).toBe("pass");
    expect(deriveOverall([{ status: "pass" }, { status: "unavailable" }])).toBe("warn");
    expect(deriveOverall([{ status: "warn" }, { status: "fail" }])).toBe("fail");
    expect(deriveOverall([])).toBe("unavailable");
  });
});

describe("normalizeReport", () => {
  it("camelizes snake_case backend payloads", () => {
    expect(camelizeKeys({ expected_sha256: "a", nested: [{ total_entries: 1 }] })).toEqual({ expectedSha256: "a", nested: [{ totalEntries: 1 }] });
  });
  it("maps the PyVerify response envelope and preserves unchecked source trace", () => {
    const r = normalizeReport({
      verification: { project_name: "x", version: "1", filename: "x-1-py3-none-any.whl", expected_sha256: "ab", actual_sha256: "ab", matches: true, downloaded_size: 10, evidence_summary: { limitations: [] } },
      evidence: { artifact_sha256: { status: "MATCH", stage_status: "VERIFIED", matches: true }, source_trace: { status: "NOT_CHECKED", stage_status: "NOT_CHECKED", checked: false } },
      verdict: { status: "WARNING", reasons: ["Provenance unavailable."] },
    });
    expect(r.source).toBe("live");
    expect(r.checks[0].id).toBe("digest");
    expect(r.overall.status).toBe("warn");
    expect(r.provenance).toBeNull();
    expect(r.sourceTrace?.status).toBe("not_checked");
  });
  it("rejects payloads without an artifact", () => {
    expect(() => normalizeReport({ verification: {}, evidence: {}, verdict: {} })).toThrow();
  });
});

describe("demo fixtures", () => {
  it("are always labelled demo and cover all statuses", () => {
    const pass = buildDemoReport("kestrel-http", undefined)!;
    const warn = buildDemoReport("lumen-cli", undefined)!;
    const fail = buildDemoReport("quartzite", undefined)!;
    expect([pass, warn, fail].every((r) => r.source === "demo")).toBe(true);
    expect(pass.overall.status).toBe("pass");
    expect(warn.overall.status).toBe("warn");
    expect(warn.provenance?.absent).toBe(true);
    expect(fail.overall.status).toBe("fail");
  });
  it("evaluates the supplied policy rather than assuming success", () => {
    const ok = buildDemoReport("vellum-schema", undefined, { repository: "vellum-org/vellum-schema" })!;
    const bad = buildDemoReport("vellum-schema", undefined, { repository: "vellum-org/vellum-schema", workflow: "release.yml" })!;
    expect(ok.policy?.status).toBe("pass");
    expect(bad.policy?.status).toBe("fail");
    expect(bad.policy?.workflowMatch).toBe(false);
  });
  it("returns null for unknown fixtures", () => {
    expect(buildDemoReport("requests", undefined)).toBeNull();
  });
});

describe("diff + hash helpers", () => {
  it("diffs inventories across versions", () => {
    const a = buildDemoReport("kestrel-http", "2.3.0")!.inventory!.entries;
    const b = buildDemoReport("kestrel-http", "2.4.1")!.inventory!.entries;
    const c = diffCounts(diffInventories(a, b));
    expect(c.added).toBeGreaterThan(0);
    expect(c.removed).toBeGreaterThan(0);
    expect(c.changed).toBeGreaterThan(0);
  });
  it("hashes with WebCrypto", async () => {
    const hex = await sha256Hex(new TextEncoder().encode("abc").buffer as ArrayBuffer);
    expect(hex).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(digestsEqual(hex, hex.toUpperCase())).toBe(true);
    expect(chunkHex(hex)).toHaveLength(16);
  });
});

import { buildStages } from "./evidence";
import { toSourceTraceBody, toVerifyBody } from "./api/endpoints";

describe("evidence spine", () => {
  it("keeps source trace NOT_CHECKED when no source-trace result exists", () => {
    const r = buildDemoReport("kestrel-http", undefined)!;
    expect(r.sourceTrace).toBeNull();
    const stages = buildStages(r, { attestationsRequested: true, policySupplied: false });
    expect(stages.find((s) => s.id === "source")!.status).toBe("not_checked");
    expect(stages.find((s) => s.id === "policy")!.status).toBe("not_configured");
    expect(stages).toHaveLength(7);
  });
  it("never upgrades a missing check to pass", () => {
    const r = normalizeReport({ verification: { project_name: "x", version: "1", filename: "x-1.whl" }, evidence: { source_trace: { status: "NOT_CHECKED", stage_status: "NOT_CHECKED", checked: false } }, verdict: { status: "WARNING", reasons: [] } });
    const stages = buildStages(r, { attestationsRequested: true, policySupplied: false });
    expect(stages.every((s) => s.status !== "pass")).toBe(true);
    expect(stages[0].status).toBe("unavailable"); // not downloaded
  });
  it("marks attestation NOT_CHECKED when the user switched it off", () => {
    const r = buildDemoReport("lumen-cli", undefined)!;
    r.checks = r.checks.filter((c) => c.id !== "provenance");
    expect(buildStages(r, { attestationsRequested: false, policySupplied: false })[3].status).toBe("not_checked");
  });
});

describe("backend request mapping", () => {
  it("sends exact request fields from the backend contract", () => {
    expect(toVerifyBody({ package: "p", version: "1", filename: "p-1.whl" })).toEqual({ project: "p", version: "1", filename: "p-1.whl", verify_attestations: false });
    const b = toVerifyBody({ package: "p", version: "1", filename: "f", verifyAttestations: false, policy: { repository: "o/r", workflow: "w.yml" } });
    expect(b).toEqual({ project: "p", version: "1", filename: "f", verify_attestations: false, expected_github_repository: "o/r", expected_workflow_filename: "w.yml" });
  });
  it("maps source-trace request fields", () => {
    expect(toSourceTraceBody({ project: "p", version: "1", wheelFilename: "p-1.whl", sdistFilename: "p-1.tar.gz", attestedFilename: "p-1.whl", expectedSourceRepository: "o/r" })).toEqual({ project: "p", version: "1", wheel_filename: "p-1.whl", sdist_filename: "p-1.tar.gz", attested_filename: "p-1.whl", expected_source_repository: "o/r" });
  });
  it("normalises new status spellings", () => {
    expect(normalizeStatus("NOT_CHECKED")).toBe("not_checked");
    expect(normalizeStatus("not applicable")).toBe("not_applicable");
    expect(normalizeStatus("skipped")).toBe("not_checked");
  });
});
