"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { gsap, ScrollTrigger } from "./gsap";

export type MotionPref = "system" | "reduce" | "full";

interface MotionCtx {
  /** Effective: true when the OS asks for reduced motion or the user chose "reduce". */
  reduced: boolean;
  pref: MotionPref;
  setPref: (p: MotionPref) => void;
  /** True on fine pointers (mouse/trackpad). Cursor effects are decorative only. */
  finePointer: boolean;
  lenis: Lenis | null;
}

const Ctx = createContext<MotionCtx>({ reduced: true, pref: "system", setPref: () => {}, finePointer: false, lenis: null });
const KEY = "pv.motion";

const readPref = (): MotionPref => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "reduce" || v === "full" ? v : "system";
  } catch {
    return "system";
  }
};

export function MotionProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<MotionPref>("system");
  const [systemReduced, setSystemReduced] = useState(false);
  const [finePointer, setFinePointer] = useState(false);
  const [lenis, setLenis] = useState<Lenis | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    // Hydrate client-only preferences after mount (SSR renders the neutral defaults).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefState(readPref());
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fp = window.matchMedia("(pointer: fine)");
    const sync = () => { setSystemReduced(mq.matches); setFinePointer(fp.matches); };
    sync();
    mq.addEventListener("change", sync);
    fp.addEventListener("change", sync);
    return () => { mq.removeEventListener("change", sync); fp.removeEventListener("change", sync); };
  }, []);

  const reduced = pref === "reduce" || (pref === "system" && systemReduced);

  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
  }, [reduced]);

  // Lenis smooth scrolling, synced to GSAP's ticker so ScrollTrigger stays exact.
  useEffect(() => {
    if (reduced) return;
    const l = new Lenis({ lerp: 0.11, smoothWheel: true, syncTouch: false });
    const raf = (time: number) => l.raf(time * 1000);
    l.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLenis(l);
    return () => { gsap.ticker.remove(raf); l.destroy(); setLenis(null); };
  }, [reduced]);

  useEffect(() => {
    lenis?.scrollTo(0, { immediate: true });
    const id = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => cancelAnimationFrame(id);
  }, [pathname, lenis]);

  const setPref = useCallback((p: MotionPref) => {
    setPrefState(p);
    try { localStorage.setItem(KEY, p); } catch { /* storage unavailable: preference lasts for this visit */ }
  }, []);

  const value = useMemo(() => ({ reduced, pref, setPref, finePointer, lenis }), [reduced, pref, setPref, finePointer, lenis]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useMotion = () => useContext(Ctx);
