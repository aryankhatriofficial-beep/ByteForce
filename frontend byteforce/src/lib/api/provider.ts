import { requestJson } from "./client";
import { endpoints, toSourceTraceBody, toVerifyBody } from "./endpoints";
import { ApiError } from "./errors";
import { normalizeHealth, normalizeReport } from "./normalize";
import { fetchProject, fetchVersion } from "./pypi";
import { buildDemoReport, DEMO_PACKAGE_NAMES, demoSummaryByName, demoVersionMetadata } from "./demo/fixtures";
import type { HealthStatus, PackageSummary, SourceTraceRequest, SourceTraceResponse, VerificationReport, VerifyRequest, VersionMetadata } from "./types";

export type DataMode = "live" | "demo";

export interface PyVerifyProvider {
  mode: DataMode;
  health(signal?: AbortSignal): Promise<HealthStatus>;
  /** Exact-version release metadata. The backend has no project-wide release-list route. */
  getPackage(name: string, version: string, signal?: AbortSignal): Promise<PackageSummary>;
  getVersion(name: string, version: string, signal?: AbortSignal): Promise<VersionMetadata>;
  verify(req: VerifyRequest, signal?: AbortSignal): Promise<VerificationReport>;
  sourceTrace(req: SourceTraceRequest, signal?: AbortSignal): Promise<SourceTraceResponse>;
}

export const liveProvider: PyVerifyProvider = {
  mode: "live",
  async health(signal) {
    return normalizeHealth(await requestJson(endpoints.health(), { signal, timeoutMs: 5000 }));
  },
  getPackage: (name, version, signal) => fetchProject(name, version, signal),
  getVersion: (name, version, signal) => fetchVersion(name, version, signal),
  async verify(req, signal) {
    return normalizeReport(await requestJson(endpoints.verify(), { method: "POST", body: toVerifyBody(req), signal }));
  },
  async sourceTrace(req, signal) {
    return requestJson(endpoints.sourceTrace(), { method: "POST", body: toSourceTraceBody(req), signal, timeoutMs: 600_000 });
  },
};

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(id); reject(new ApiError("aborted", "Request aborted")); }, { once: true });
  });

const notInDemo = (name: string) =>
  new ApiError("not_found", `“${name}” is not a demo fixture`, {
    detail: `Demo mode only contains fictional fixtures: ${DEMO_PACKAGE_NAMES.join(", ")}. Connect the backend to verify real packages.`,
  });

/** Opt-in demo provider: bundled fictional fixtures. Every result is `source: "demo"`. */
export const demoProvider: PyVerifyProvider = {
  mode: "demo",
  async health() { return { ok: true, version: "demo-fixtures", source: "demo" }; },
  async getPackage(name, version, signal) {
    await wait(200, signal);
    const s = demoSummaryByName(name);
    if (!s) throw notInDemo(name);
    const release = s.releases.find((r) => r.version === version);
    if (!release) throw new ApiError("not_found", `Version ${version} is not in the demo fixture`);
    return { ...s, latestVersion: version, releases: [release] };
  },
  async getVersion(name, version, signal) {
    await wait(120, signal);
    const m = demoVersionMetadata(name, version);
    if (!m) throw notInDemo(name);
    return m;
  },
  async verify(req, signal) {
    await wait(1100, signal);
    const r = buildDemoReport(req.package, req.version, req.policy);
    if (!r) {
      if (demoSummaryByName(req.package)) throw new ApiError("not_found", `Version ${req.version} is not in the demo fixture`);
      throw notInDemo(req.package);
    }
    return r;
  },
  async sourceTrace(_req, _signal) {
    throw new ApiError("not_configured", "Source trace is available only from the live PyVerify backend.");
  },
};

export const getProvider = (mode: DataMode): PyVerifyProvider => (mode === "live" ? liveProvider : demoProvider);
