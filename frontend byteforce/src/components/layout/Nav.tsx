"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ROUTES } from "@/lib/routes";
import { useDataMode } from "@/lib/DataModeProvider";
import { ScrollTrigger, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import { TransitionLink } from "./PageTransition";
import { LogoMark } from "./Logo";
import styles from "./Nav.module.css";

export function Nav({ onOpenPalette }: { onOpenPalette: () => void }) {
  const pathname = usePathname();
  const { reduced } = useMotion();
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  // Progress hairline + hide-on-scroll. Writes a style and toggles one attribute only when it changes.
  useGSAP(() => {
    if (!bar.current || !root.current) return;
    let hidden = false;
    const st = ScrollTrigger.create({
      start: 0, end: "max",
      onUpdate: (self) => {
        bar.current!.style.transform = `scaleX(${self.progress})`;
        const next = !reduced && self.direction === 1 && self.scroll() > 240;
        if (next !== hidden) { hidden = next; root.current!.dataset.hidden = String(next); }
      },
    });
    return () => st.kill();
  }, { dependencies: [pathname, reduced], revertOnUpdate: true });

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header ref={root} className={styles.nav} data-open={open} data-hidden="false">
      <div className={styles.inner}>
        <TransitionLink href="/" className={styles.brand} aria-label="PyVerify home">
          <LogoMark />
          <span className={styles.word}>PyVerify</span>
        </TransitionLink>

        <nav aria-label="Primary" className={styles.links} id="primary-nav">
          {ROUTES.slice(1).map((r) => (
            <TransitionLink key={r.href} href={r.href} className={styles.link} aria-current={isActive(r.href) ? "page" : undefined}>
              {r.label}
            </TransitionLink>
          ))}
        </nav>

        <div className={styles.tools}>
          <ConnectionBadge />
          <button type="button" className={styles.cmd} onClick={onOpenPalette} aria-label="Open command palette" aria-keyshortcuts="Meta+K Control+K">
            <span className={styles.cmdText}>Search</span><kbd>⌘K</kbd>
          </button>
          <button type="button" className={styles.burger} aria-expanded={open} aria-controls="primary-nav" onClick={() => setOpen((o) => !o)}>
            <span className="sr-only">{open ? "Close" : "Open"} menu</span>
            <i /><i />
          </button>
        </div>
      </div>
      <div ref={bar} className={styles.progress} aria-hidden="true" />
    </header>
  );
}

function ConnectionBadge() {
  const { mode, connection, apiBaseUrl, backendVersion, recheck, setMode } = useDataMode();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const state = mode === "demo" ? "demo" : connection;
  const label = { demo: "Demo data", checking: "Checking backend", connected: "Backend connected", disconnected: "Backend offline" }[state];

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key); };
  }, [open]);

  return (
    <div ref={wrap} className={styles.connWrap}>
      <button type="button" className={styles.conn} data-state={state} aria-expanded={open} aria-controls="conn-panel" onClick={() => setOpen((o) => !o)}>
        <i aria-hidden="true" /><span className={styles.connText}>{label}</span>
      </button>
      <div id="conn-panel" className={styles.connPanel} data-open={open} role="region" aria-label="Backend connection">
        <p className="small"><strong>{label}</strong></p>
        <p className="xs muted mono break">{apiBaseUrl}/api/health{backendVersion ? ` · v${backendVersion}` : ""}</p>
        {mode === "live" && connection === "disconnected" && (
          <p className="xs">The PyVerify API is not answering. Release discovery, verification, and source trace are unavailable until it is reachable.</p>
        )}
        <div className="row">
          {mode === "live" && <button type="button" className="btn btn--sm" onClick={recheck}>Retry connection</button>}
          {mode === "live"
            ? <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setMode("demo"); setOpen(false); }}>Use demo fixtures</button>
            : <button type="button" className="btn btn--sm" onClick={() => { setMode("live"); recheck(); setOpen(false); }}>Back to live backend</button>}
        </div>
        {mode === "demo" && <p className="xs muted">Demo fixtures are fictional packages with fabricated digests.</p>}
      </div>
    </div>
  );
}
