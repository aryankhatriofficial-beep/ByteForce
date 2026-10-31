import { config } from "@/lib/config";
import { ApiError } from "./errors";
import { absoluteUrl } from "./endpoints";

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Extracts a human message from common backend error bodies (documented + FastAPI style). */
function readErrorBody(body: unknown): { code?: string; message?: string; detail?: string } {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  if (b.error && typeof b.error === "object") {
    const e = b.error as Record<string, unknown>;
    return {
      code: typeof e.code === "string" ? e.code : undefined,
      message: typeof e.message === "string" ? e.message : undefined,
      detail: typeof e.detail === "string" ? e.detail : undefined,
    };
  }
  if (typeof b.detail === "string") return { message: b.detail, detail: b.detail };
  if (Array.isArray(b.detail)) return { message: "Request validation failed", detail: JSON.stringify(b.detail) };
  if (typeof b.message === "string") return { message: b.message };
  return {};
}

/** Centralised JSON client: timeout, abort propagation, error normalisation. No credentials are sent. */
export async function requestJson<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), opts.timeoutMs ?? config.timeoutMs);
  const onAbort = () => controller.abort("aborted");
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  let res: Response;
  try {
    res = await fetch(absoluteUrl(path), {
      method: opts.method ?? "GET",
      headers: { Accept: "application/json", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
    });
  } catch (err) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      throw reason === "timeout"
        ? new ApiError("timeout", "Request timed out")
        : new ApiError("aborted", "Request aborted");
    }
    throw new ApiError("network", err instanceof Error ? err.message : "Network error");
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", onAbort);
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (res.ok) throw new ApiError("invalid_response", "Response was not JSON");
    }
  }

  if (!res.ok) {
    const info = readErrorBody(parsed);
    const kind = res.status === 404 ? "not_found" : res.status === 400 || res.status === 422 ? "validation" : "http";
    throw new ApiError(kind, info.message ?? `HTTP ${res.status}`, { status: res.status, code: info.code, detail: info.detail ?? info.message });
  }
  return parsed as T;
}
