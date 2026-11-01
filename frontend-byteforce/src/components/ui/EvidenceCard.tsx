"use client";
import { useId, useRef, useState, type ReactNode } from "react";
import type { CheckResult } from "@/lib/api/types";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import { StatusPill } from "./StatusPill";
import styles from "./EvidenceCard.module.css";

interface Props {
  check: CheckResult;
  index?: number;
  defaultOpen?: boolean;
  children?: ReactNode;
}

/** Expandable evidence card: summary always visible, evidence + limitations behind a real disclosure button. */
export function EvidenceCard({ check, index, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const body = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const id = useId();
  const { reduced } = useMotion();

  useGSAP(() => {
    const el = body.current;
    if (!el) return;
    if (first.current) { first.current = false; gsap.set(el, { height: open ? "auto" : 0 }); return; }
    if (reduced) { gsap.set(el, { height: open ? "auto" : 0 }); return; }
    if (open) {
      gsap.fromTo(el, { height: 0 }, { height: "auto", duration: 0.6, ease: "pv.out" });
      gsap.from(el.querySelectorAll("[data-ev]"), { x: -12, autoAlpha: 0, stagger: 0.04, duration: 0.5, delay: 0.1 });
    } else {
      gsap.to(el, { height: 0, duration: 0.45, ease: "pv.inOut" });
    }
  }, { dependencies: [open, reduced] });

  return (
    <article className={styles.card} data-status={check.status} data-open={open}>
      <span className={styles.rail} aria-hidden="true" />
      <header className={styles.head}>
        {index !== undefined && <span className={`${styles.idx} mono`}>{String(index + 1).padStart(2, "0")}</span>}
        <div className={styles.titleWrap}>
          <h3 className={styles.title}>{check.title}</h3>
          <p className={styles.summary}>{check.summary}</p>
        </div>
        <StatusPill status={check.status} />
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="sr-only">{open ? "Hide" : "Show"} evidence for {check.title}</span>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h14M12 5v14" stroke="currentColor" strokeWidth="1.6" fill="none" className={styles.plus} /></svg>
        </button>
      </header>
      <div id={id} ref={body} className={styles.body} role="region" aria-label={`${check.title} evidence`} style={{ height: defaultOpen ? "auto" : 0 }}>
        <div className={styles.inner}>
          {check.evidence.length > 0 && (
            <dl className={styles.evidence}>
              {check.evidence.map((e, i) => (
                <div key={i} className={styles.evRow} data-ev data-status={e.status}>
                  <dt>{e.label}</dt>
                  <dd className={`${e.mono ? "mono" : ""} break`}>{e.value}{e.status && <span className={styles.evStatus}><StatusPill status={e.status} /></span>}</dd>
                </div>
              ))}
            </dl>
          )}
          {children}
          {check.limitations.length > 0 && (
            <div className={styles.limits} data-ev>
              <span className="eyebrow">What this does not prove</span>
              <ul>{check.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </div>
          )}
          {check.durationMs !== undefined && <p className="xs muted mono" data-ev>check time · {check.durationMs} ms</p>}
        </div>
      </div>
    </article>
  );
}
