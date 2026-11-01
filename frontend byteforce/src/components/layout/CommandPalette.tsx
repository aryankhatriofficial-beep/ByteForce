"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ROUTES } from "@/lib/routes";
import { DEMO_PACKAGE_NAMES } from "@/lib/api/demo/fixtures";
import { DOC_SECTIONS } from "@/lib/docsContent";
import { useDataMode } from "@/lib/DataModeProvider";
import { useMotion } from "@/lib/motion/MotionProvider";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { usePageTransition } from "./PageTransition";
import { useToast } from "@/components/ui/Toast";
import styles from "./CommandPalette.module.css";

interface Command { id: string; group: string; label: string; hint?: string; run: () => void; keywords?: string }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const { navigate } = usePageTransition();
  const { mode, setMode, connection, recheck } = useDataMode();
  const { pref, setPref, reduced } = useMotion();
  const toast = useToast();

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => { onClose(); navigate(href); };
    return [
      ...ROUTES.map((r) => ({ id: `nav-${r.href}`, group: "Navigate", label: r.label, run: go(r.href), keywords: r.blurb })),
      { id: "recheck", group: "Backend", label: "Re-check backend connection", hint: connection, run: () => { recheck(); onClose(); } },
      ...DEMO_PACKAGE_NAMES.map((n) => ({ id: `ver-${n}`, group: "Verify (demo fixtures)", label: `Verify ${n}`, hint: "demo", run: go(`/verify?package=${n}`), keywords: "scan check run" })),
      ...DEMO_PACKAGE_NAMES.map((n) => ({ id: `ins-${n}`, group: "Inspect (demo fixtures)", label: `Inspect ${n}`, hint: "demo", run: go(`/packages/${n}`), keywords: "package inspector" })),
      ...DOC_SECTIONS.map((s) => ({ id: `doc-${s.id}`, group: "Docs", label: s.title, run: go(`/docs#${s.id}`), keywords: s.keywords })),
      {
        id: "motion", group: "Preferences",
        label: reduced ? "Enable full motion" : "Reduce motion",
        hint: `now: ${pref}`,
        run: () => { setPref(reduced ? "full" : "reduce"); toast({ tone: "info", title: reduced ? "Full motion enabled" : "Reduced motion enabled" }); onClose(); },
      },
      { id: "motion-sys", group: "Preferences", label: "Follow system motion setting", run: () => { setPref("system"); onClose(); } },
      {
        id: "mode", group: "Preferences",
        label: mode === "live" ? "Switch to demo fixtures (fictional data)" : "Switch back to live backend",
        run: () => {
          setMode(mode === "live" ? "demo" : "live");
          if (mode === "demo") recheck();
          toast({ tone: mode === "live" ? "warn" : "info", title: mode === "live" ? "Demo fixtures on" : "Live backend", body: mode === "live" ? "Results are fictional and labelled DEMO." : undefined });
          onClose();
        },
      },
    ];
  }, [navigate, onClose, mode, setMode, connection, recheck, pref, setPref, reduced, toast]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return commands;
    return commands.filter((c) => `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase().includes(t));
  }, [q, commands]);

  useEffect(() => {
    if (open) {
      lastFocus.current = document.activeElement as HTMLElement;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQ(""); setSel(0);
      requestAnimationFrame(() => input.current?.focus());
    } else lastFocus.current?.focus?.();
  }, [open]);

  useGSAP(() => {
    if (!open || reduced || !panel.current) return;
    gsap.fromTo(panel.current, { y: -16, scale: 0.97, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.45 });
  }, { dependencies: [open] });

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); filtered[sel]?.run(); }
    else if (e.key === "Tab") { e.preventDefault(); input.current?.focus(); }
  };

  let lastGroup = "";
  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className={styles.panel} role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div className={styles.search}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.5" /></svg>
          <input
            ref={input}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            placeholder="Jump to a page, verify a fixture, search docs…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="pv-cmd-list"
            aria-activedescendant={filtered[sel] ? `cmd-${filtered[sel].id}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <ul id="pv-cmd-list" className={styles.list} role="listbox" aria-label="Commands">
          {filtered.length === 0 && <li className={styles.empty}>No command matches “{q}”.</li>}
          {filtered.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header && <div className={styles.group} aria-hidden="true">{header}</div>}
                <div
                  id={`cmd-${c.id}`}
                  role="option"
                  aria-selected={i === sel}
                  className={styles.item}
                  onMouseMove={() => setSel(i)}
                  onClick={c.run}
                >
                  <span>{c.label}</span>
                  {c.hint && <span className={styles.hint}>{c.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <footer className={styles.foot}><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> run</span><span className="muted">Demo commands use fictional fixtures.</span></footer>
      </div>
    </div>
  );
}
