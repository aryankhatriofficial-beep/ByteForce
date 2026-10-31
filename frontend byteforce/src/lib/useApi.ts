"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDataMode } from "@/lib/DataModeProvider";
import type { PackageSummary, PolicyInput, VerificationReport, VersionMetadata } from "@/lib/api/types";

/** Session cache so pages can share a report without refetching. Keyed by data mode. */
const reportCache = new Map<string, VerificationReport>();
const packageCache = new Map<string, PackageSummary>();
const versionCache = new Map<string, VersionMetadata>();

export const reportKey = (mode: string, name: string, version?: string, policy?: PolicyInput) =>
  `${mode}|${name}|${version ?? "latest"}|${policy?.repository ?? ""}|${policy?.workflow ?? ""}`;

/** Latest report per (mode, project, version) regardless of options — what the dossier shows. */
const latestReports = new Map<string, VerificationReport>();
const listeners = new Set<() => void>();

export function cacheReport(mode: string, r: VerificationReport, policy?: PolicyInput) {
  reportCache.set(reportKey(mode, r.package.name, r.package.version, policy), r);
  latestReports.set(`${mode}|${r.package.name}|${r.package.version}`, r);
  listeners.forEach((l) => l());
}

/** Reads a report only if this session already produced one. Never triggers a backend call. */
export function useCachedReport(name: string, version: string | undefined) {
  const { mode } = useDataMode();
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return version ? latestReports.get(`${mode}|${name}|${version}`) ?? null : null;
}

type State<T> = { status: "idle" | "loading" | "success" | "error"; data: T | null; error: unknown };

function useAsync<T>(key: string | null, cache: Map<string, T>, load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<State<T>>(() => {
    const hit = key ? cache.get(key) : undefined;
    return hit ? { status: "success", data: hit, error: null } : { status: key ? "loading" : "idle", data: null, error: null };
  });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });

  useEffect(() => {
    if (!key) return;
    const hit = cache.get(key);
    if (hit && nonce === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ status: "success", data: hit, error: null });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ status: "loading", data: s.data, error: null }));
    loadRef.current(ctrl.signal)
      .then((data) => { cache.set(key, data); setState({ status: "success", data, error: null }); })
      .catch((error) => { if (!ctrl.signal.aborted) setState({ status: "error", data: null, error }); });
    return () => ctrl.abort();
  }, [key, nonce, cache]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, retry };
}

/** Runs a verification when `name` is non-null. Callers must only pass a name after an explicit user action. */
export function useReport(name: string | null, version?: string, policy?: PolicyInput, filename?: string) {
  const { provider, mode } = useDataMode();
  const key = name ? reportKey(mode, name, version, policy) : null;
  return useAsync<VerificationReport>(key, reportCache, (signal) => provider.verify({ package: name!, version, policy, filename }, signal).then((r) => { cacheReport(mode, r, policy); return r; }));
}

export function useVersionMeta(name: string | null, version: string | null) {
  const { provider, mode } = useDataMode();
  return useAsync<VersionMetadata>(name && version ? `${mode}|${name}|${version}` : null, versionCache, (signal) => provider.getVersion(name!, version!, signal));
}

export function usePackage(name: string | null, version?: string | null) {
  const { provider, mode } = useDataMode();
  return useAsync<PackageSummary>(name && version ? `${mode}|${name}|${version}` : null, packageCache, (signal) => provider.getPackage(name!, version!, signal));
}
