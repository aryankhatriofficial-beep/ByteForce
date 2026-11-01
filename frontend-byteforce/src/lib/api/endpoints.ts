import { config } from "@/lib/config";
import type { SourceTraceRequest, VerifyRequest } from "./types";

export const endpoints = {
  health: () => "/api/health",
  release: (project: string, version: string) => `/api/v1/packages/${encodeURIComponent(project)}/${encodeURIComponent(version)}/files`,
  verify: () => "/api/v1/verify",
  sourceTrace: () => "/api/v1/source-trace",
} as const;

export const absoluteUrl = (path: string) => `${config.apiBaseUrl}${path}`;

export function toVerifyBody(req: VerifyRequest): Record<string, unknown> {
  if (!req.version || !req.filename) throw new Error("An exact version and artifact filename are required.");
  const body: Record<string, unknown> = {
    project: req.package,
    version: req.version,
    filename: req.filename,
    verify_attestations: req.verifyAttestations ?? false,
  };
  if (req.policy?.repository) body.expected_github_repository = req.policy.repository;
  if (req.policy?.workflow) body.expected_workflow_filename = req.policy.workflow;
  return body;
}

export function toSourceTraceBody(req: SourceTraceRequest): Record<string, unknown> {
  return {
    project: req.project,
    version: req.version,
    wheel_filename: req.wheelFilename,
    sdist_filename: req.sdistFilename,
    attested_filename: req.attestedFilename,
    ...(req.expectedSourceRepository ? { expected_source_repository: req.expectedSourceRepository } : {}),
  };
}
