"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { config } from "@/lib/config";
import { getProvider, liveProvider, type DataMode, type PyVerifyProvider } from "@/lib/api/provider";
import { isApiError } from "@/lib/api/errors";

export type Connection = "checking" | "connected" | "disconnected";

interface DataModeCtx {
  mode: DataMode;
  provider: PyVerifyProvider;
  apiBaseUrl: string;
  connection: Connection;
  backendVersion?: string;
  lastCheckedAt: number | null;
  /** Re-runs `GET /api/health`. */
  recheck: () => void;
  /** Called by views when a live request fails at the network level. */
  reportNetworkFailure: (e: unknown) => void;
  setMode: (m: DataMode) => void;
}

const Ctx = createContext<DataModeCtx | null>(null);
const KEY = "pv.dataMode";

/**
 * Live is the default. Demo fixtures are strictly opt-in (and session-scoped),
 * so a missing backend shows "disconnected", never fabricated data.
 */
export function DataModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DataMode>("live");
  const [connection, setConnection] = useState<Connection>("checking");
  const [backendVersion, setBackendVersion] = useState<string>();
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const recheck = useCallback(() => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setConnection("checking");
    liveProvider.health(ctrl.signal)
      .then((h) => { setConnection(h.ok ? "connected" : "disconnected"); setBackendVersion(h.version); })
      .catch((e) => { if (!ctrl.signal.aborted) setConnection("disconnected"); void e; })
      .finally(() => { if (!ctrl.signal.aborted) setLastCheckedAt(Date.now()); });
  }, []);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (sessionStorage.getItem(KEY) === "demo") setModeState("demo");
    } catch { /* ignore */ }
    recheck();
    return () => inflight.current?.abort();
  }, [recheck]);

  useEffect(() => { document.documentElement.dataset.dataMode = mode; }, [mode]);

  const reportNetworkFailure = useCallback((e: unknown) => {
    if (isApiError(e) && (e.kind === "network" || e.kind === "timeout")) setConnection("disconnected");
  }, []);

  const setMode = useCallback((m: DataMode) => {
    setModeState(m);
    try { sessionStorage.setItem(KEY, m); } catch { /* ignore */ }
  }, []);

  const value = useMemo(
    () => ({ mode, provider: getProvider(mode), apiBaseUrl: config.apiBaseUrl, connection, backendVersion, lastCheckedAt, recheck, reportNetworkFailure, setMode }),
    [mode, connection, backendVersion, lastCheckedAt, recheck, reportNetworkFailure, setMode],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDataMode() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDataMode must be used inside DataModeProvider");
  return c;
}
