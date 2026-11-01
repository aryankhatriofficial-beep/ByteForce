"use client";
import { useRef } from "react";
import type { Stage } from "@/lib/evidence";
import { STAGE_COPY } from "@/lib/evidence";
import { STATUS } from "@/lib/status";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import { StatusPill } from "@/components/ui/StatusPill";
import { CopyButton } from "@/components/ui/CopyButton";
import styles from "./EvidenceDetail.module.css";

/** Focused inspection of one stage: status, what it checks, evidence received, proves / does not prove, raw backend check. */
export function EvidenceDetail({ stage, index, waiting }: { stage: Stage | null; index: number; waiting: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const prev = useRef(index);
  const { reduced } = useMotion();
  const copy = stage ?? { ...STAGE_COPY[index], status: undefined, summary: "", evidence: [], limitations: [], sources: [] };

  useGSAP(() => {
    if (reduced || !root.current) return;
    const dir = index >= prev.current ? 1 : -1;
    prev.current = index;
    gsap.fromTo(root.current.querySelectorAll("[data-part]"), { x: 24 * dir, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.45, stagger: 0.04, ease: "pv.out" });
  }, { dependencies: [index, stage?.status, reduced] });

  return (
    <section ref={root} className={styles.panel} aria-live="polite" aria-label={`${copy.title} evidence`}>
      <header className={styles.head} data-part>
        <span className={styles.idx}>Stage {index + 1} of 7</span>
        <h3 className={styles.title}>{copy.title}</h3>
        {stage ? <StatusPill status={stage.status} size="lg" label={STATUS[stage.status].label.toUpperCase()} /> : <span className="small muted">{waiting ? "Waiting for the backend report…" : "Run a verification to populate this stage."}</span>}
      </header>
      {stage && <p className={styles.summary} data-part>{stage.summary}</p>}
      <div className={styles.grid}>
        <div data-part><h4>What it checks</h4><p>{copy.checks}</p></div>
        <div data-part className={styles.proves}><h4>What it proves</h4><p>{copy.proves}</p></div>
        <div data-part className={styles.not}><h4>What it does not prove</h4><p>{copy.notProves}</p>{stage?.limitations.map((l) => <p key={l} className="small">{l}</p>)}</div>
      </div>
      {stage && (
        <div data-part>
          <h4 className={styles.h4}>Evidence received</h4>
          {stage.evidence.length ? (
            <dl className={styles.ev}>
              {stage.evidence.map((e, i) => (
                <div key={i} className={styles.evRow}>
                  <dt>{e.label}</dt>
                  <dd className={e.mono ? "mono break" : "break"}>
                    <span>{e.value}</span>
                    {e.mono && e.value.length > 20 && <CopyButton value={e.value} />}
                    {e.status && <StatusPill status={e.status} />}
                  </dd>
                </div>
              ))}
            </dl>
          ) : <p className="small muted">No evidence items were returned for this stage.</p>}
        </div>
      )}
      {stage && stage.sources.length > 0 && (
        <details className={styles.raw} data-part>
          <summary>Backend check object{stage.sources.length > 1 ? "s" : ""} (as normalised)</summary>
          <pre>{JSON.stringify(stage.sources, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
