import type { CheckResult, CheckStatus } from "@/lib/api/types";

export interface StatusMeta {
  label: string;
  short: string;
  glyph: string;
  meaning: string;
  /** Whether this status counts as evidence that was actually evaluated. */
  evaluated: boolean;
}

export const STATUS_ORDER: CheckStatus[] = ["pass", "warn", "fail", "unavailable", "not_checked", "not_applicable", "not_configured"];

export const STATUS: Record<CheckStatus, StatusMeta> = {
  pass: {
    label: "Verified", short: "PASS", glyph: "✓", evaluated: true,
    meaning: "The evidence for this specific check was obtained and matched. It does not mean the package is safe.",
  },
  warn: {
    label: "Warning", short: "WARN", glyph: "!", evaluated: true,
    meaning: "The check ran but found something that needs human judgement.",
  },
  fail: {
    label: "Failed", short: "FAIL", glyph: "×", evaluated: true,
    meaning: "Evidence was obtained and contradicts what was expected — a digest, RECORD entry or policy did not match.",
  },
  unavailable: {
    label: "Unavailable", short: "N/A", glyph: "∅", evaluated: false,
    meaning: "The evidence this check needs does not exist or could not be retrieved. Never a pass.",
  },
  not_checked: {
    label: "Not checked", short: "NOT CHECKED", glyph: "○", evaluated: false,
    meaning: "This check did not run. For source trace this is the default: it is a separate workflow.",
  },
  not_applicable: {
    label: "Not applicable", short: "N/A", glyph: "⌀", evaluated: false,
    meaning: "The check does not apply to this artifact (for example, RECORD on an sdist).",
  },
  not_configured: {
    label: "Not configured", short: "NOT SET", glyph: "◇", evaluated: false,
    meaning: "The check needs input you did not provide, such as an expected publisher repository.",
  },
};

const RANK: Record<CheckStatus, number> = {
  fail: 6, warn: 5, unavailable: 4, pass: 3, not_checked: 1, not_applicable: 1, not_configured: 1,
};

/** Accepts many backend spellings. Unknown values become `unavailable` — never `pass`. */
export function normalizeStatus(raw: unknown): CheckStatus {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["pass", "passed", "ok", "success", "verified", "valid", "true", "match", "matched"].includes(s)) return "pass";
  if (["warn", "warning", "partial"].includes(s)) return "warn";
  if (["fail", "failed", "failure", "error", "invalid", "mismatch", "false"].includes(s)) return "fail";
  if (["not_checked", "skip", "skipped", "not_requested", "not_run", "pending"].includes(s)) return "not_checked";
  if (["not_applicable", "n/a", "na", "inapplicable"].includes(s)) return "not_applicable";
  if (["not_configured", "unconfigured", "no_policy"].includes(s)) return "not_configured";
  return "unavailable";
}

/**
 * Overall verdict: any FAIL fails; any WARN or UNAVAILABLE evidence downgrades
 * to WARN; only evaluated PASSes (ignoring not-checked/not-applicable/not-configured)
 * yield PASS. With nothing evaluated the result is UNAVAILABLE.
 */
export function deriveOverall(checks: Pick<CheckResult, "status">[]): CheckStatus {
  if (checks.length === 0) return "unavailable";
  const worst = checks.reduce<CheckStatus>((acc, c) => (RANK[c.status] > RANK[acc] ? c.status : acc), "not_checked");
  if (worst === "fail") return "fail";
  if (worst === "warn" || worst === "unavailable") return "warn";
  return checks.some((c) => c.status === "pass") ? "pass" : "unavailable";
}

export const statusCounts = (checks: Pick<CheckResult, "status">[]) =>
  checks.reduce(
    (acc, c) => ({ ...acc, [c.status]: acc[c.status] + 1 }),
    Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<CheckStatus, number>,
  );
