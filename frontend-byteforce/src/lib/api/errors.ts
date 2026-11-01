/** Normalised error surfaced to the UI. Never swallowed into a fake success. */
export type ApiErrorKind =
  | "not_configured"
  | "network"
  | "timeout"
  | "http"
  | "invalid_response"
  | "not_found"
  | "validation"
  | "aborted";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;

  constructor(kind: ApiErrorKind, message: string, opts: { status?: number; code?: string; detail?: string } = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = opts.status;
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export function describeError(e: unknown): { title: string; body: string } {
  if (!isApiError(e)) return { title: "Unexpected error", body: e instanceof Error ? e.message : String(e) };
  switch (e.kind) {
    case "not_configured":
      return { title: "Backend not configured", body: "Set NEXT_PUBLIC_PYVERIFY_API_BASE_URL, or use demo mode." };
    case "network":
      return { title: "Backend unreachable", body: "The PyVerify backend could not be reached. Nothing was verified." };
    case "timeout":
      return { title: "Verification timed out", body: "The backend did not answer in time. No result is implied." };
    case "not_found":
      return { title: "Not found", body: e.detail ?? e.message };
    case "validation":
      return { title: "Request rejected", body: e.detail ?? e.message };
    case "invalid_response":
      return { title: "Unexpected response shape", body: "The backend answered, but not in the documented contract. See BACKEND_INTEGRATION.md." };
    case "aborted":
      return { title: "Cancelled", body: "The request was cancelled." };
    default:
      return { title: `Backend error${e.status ? ` (${e.status})` : ""}`, body: e.detail ?? e.message };
  }
}
