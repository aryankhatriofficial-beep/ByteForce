/** PyVerify-backed discovery for one exact release; never requests PyPI from the browser. */
import { requestJson } from "./client";
import { endpoints } from "./endpoints";
import { ApiError } from "./errors";
import type { PackageSummary, ReleaseFile, VersionMetadata } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" ? v : "";

export async function fetchVersion(name: string, version: string, signal?: AbortSignal): Promise<VersionMetadata> {
  const payload = await requestJson<unknown>(endpoints.release(name, version), { signal });
  if (!isObj(payload) || !isObj(payload.release) || !Array.isArray(payload.release.files)) {
    throw new ApiError("invalid_response", "Release response did not match the PyVerify contract.");
  }
  const release = payload.release as Obj;
  if (typeof release.project_name !== "string" || typeof release.version !== "string" || !isObj(release.metadata)) {
    throw new ApiError("invalid_response", "Release response is missing project, version, or metadata fields.");
  }
  const metadata = release.metadata;
  const releaseFiles = release.files as unknown[];
  const files: ReleaseFile[] = releaseFiles.map((value: unknown) => {
    if (!isObj(value) || typeof value.filename !== "string" || !value.filename || typeof value.sha256 !== "string" || !/^[a-f\d]{64}$/i.test(value.sha256) || typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0 || !["wheel", "sdist", "other"].includes(str(value.type))) {
      throw new ApiError("invalid_response", "Release response contained an invalid artifact entry.");
    }
    const type = str(value.type);
    return {
      filename: value.filename,
      kind: type === "wheel" || type === "sdist" ? type : "other",
      sizeBytes: value.size,
      sha256: value.sha256,
      uploadTime: str(value.upload_time) || "",
    };
  });
  const projectName = str(release.project_name);
  const exactVersion = str(release.version);
  return {
    name: projectName,
    version: exactVersion,
    summary: str(metadata.summary) || undefined,
    requiresPython: str(metadata.requires_python) || undefined,
    requiresDist: null,
    files,
    source: "pypi",
  };
}

export async function fetchProject(name: string, version: string, signal?: AbortSignal): Promise<PackageSummary> {
  const exact = await fetchVersion(name, version, signal);
  const uploadTime = exact.files.map((f) => f.uploadTime).filter(Boolean).sort()[0] ?? "";
  return {
    name: exact.name,
    summary: exact.summary,
    latestVersion: exact.version,
    releases: [{ version: exact.version, uploadTime, yanked: false, files: exact.files }],
    source: "pypi",
  };
}
