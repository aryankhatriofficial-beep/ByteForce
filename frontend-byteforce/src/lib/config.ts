/**
 * Runtime configuration. Every value is a public, non-secret NEXT_PUBLIC_* variable.
 * The backend defaults to the local PyVerify API the project owner runs on 127.0.0.1:8766.
 */
const trimSlash = (v: string) => v.replace(/\/+$/, "");

export const DEFAULT_API_BASE_URL = "http://127.0.0.1:8766";

const rawBase = process.env.NEXT_PUBLIC_PYVERIFY_API_BASE_URL?.trim();
const rawTimeout = Number(process.env.NEXT_PUBLIC_PYVERIFY_TIMEOUT_MS);

export const config = {
  apiBaseUrl: trimSlash(rawBase || DEFAULT_API_BASE_URL),
  timeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 120_000,
} as const;
