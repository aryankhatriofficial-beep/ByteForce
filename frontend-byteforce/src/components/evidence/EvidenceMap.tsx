"use client";
import { useEffect, useRef } from "react";
import type { CheckStatus } from "@/lib/api/types";
import { STAGE_COPY, passRun, type Stage, type StageId } from "@/lib/evidence";
import { STATUS } from "@/lib/status";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import { StatusPill } from "@/components/ui/StatusPill";
import styles from "./EvidenceMap.module.css";

export type MapPhase = "idle" | "scanning" | "revealing" | "done";

interface Props {
  stages: Stage[] | null;
  phase: MapPhase;
  /** How many stages have been revealed (revealing phase). */
  revealed: number;
  selected: StageId | null;
  onSelect: (id: StageId) => void;
}

/** Status → distinct node shape. Shape, glyph and label all carry the status — never colour alone. */
export function NodeGlyph({ status }: { status: CheckStatus | "idle" | "pending" }) {
  switch (status) {
    case "pass": return <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" className={styles.gFill} /><path d="M16 24.5l5.5 5.5L32 19" className={styles.gMark} /></svg>;
    case "fail": return <svg viewBox="0 0 48 48"><path d="M17 5h14l12 12v14L31 43H17L5 31V17Z" className={styles.gFill} /><path d="M18 18l12 12M30 18 18 30" className={styles.gMark} /></svg>;
    case "warn": return <svg viewBox="0 0 48 48"><path d="M24 5 44 41H4Z" className={styles.gFill} /><path d="M24 19v10M24 34v1.5" className={styles.gMark} /></svg>;
    case "unavailable": return <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" className={styles.gDashed} /><path d="M14 34 34 14" className={styles.gThin} /></svg>;
    case "not_checked": return <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" className={styles.gDotted} /></svg>;
    case "not_applicable": return <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" className={styles.gThin} /><path d="M12 24h24" className={styles.gThin} /></svg>;
    case "not_configured": return <svg viewBox="0 0 48 48"><path d="M24 5 43 24 24 43 5 24Z" className={styles.gDashed} /><circle cx="24" cy="24" r="3" className={styles.gDot} /></svg>;
    case "pending": return <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" className={styles.gPending} /></svg>;
    default: return <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" className={styles.gIdle} /><circle cx="24" cy="24" r="3" className={styles.gDot} /></svg>;
  }
}

/**
 * The evidence spine: PyPI artifact → SHA-256 → metadata → attestation →
 * publisher policy → RECORD/inventory → source trace. Horizontal on wide
 * screens, a vertical rail on narrow ones. While a request is in flight the
 * beam is indeterminate; stages resolve only from the backend's report.
 */
export function EvidenceMap({ stages, phase, revealed, selected, onSelect }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const { reduced } = useMotion();
  const shown = (i: number) => phase === "done" || (phase === "revealing" && i < revealed);
  // The signal line runs from node 1 through the unbroken run of verified stages.
  const visible = phase === "done" ? 7 : phase === "revealing" ? revealed : 0;
  const run = stages && visible ? passRun(stages.slice(0, visible)) : -1;
  const progress = run > 0 ? run / 6 : 0;

  useEffect(() => { root.current?.style.setProperty("--progress", String(progress)); }, [progress]);

  // Pop each node as its backend result is revealed.
  useGSAP(() => {
    if (reduced || phase !== "revealing" || revealed < 1 || !root.current) return;
    const node = root.current.querySelectorAll("[data-node]")[revealed - 1];
    if (node) gsap.fromTo(node.querySelector("[data-glyph]"), { scale: 0.5, rotate: -30 }, { scale: 1, rotate: 0, duration: 0.6, ease: "back.out(2.2)" });
  }, { dependencies: [revealed, phase, reduced] });

  return (
    <div ref={root} className={styles.map} data-phase={phase}>
      <div className={styles.track} aria-hidden="true">
        <span className={styles.fill} />
        {phase === "scanning" && <span className={styles.beam} />}
      </div>
      <ol className={styles.nodes} aria-label="Evidence spine">
        {STAGE_COPY.map((copy, i) => {
          const stage = stages?.[i];
          const status: CheckStatus | "idle" | "pending" = phase === "idle" || !stage ? (phase === "scanning" ? "pending" : "idle") : shown(i) ? stage.status : "pending";
          const evaluated = stage && shown(i);
          return (
            <li key={copy.id} className={styles.item}>
              <button
                type="button"
                data-node
                className={styles.node}
                data-status={status}
                aria-pressed={selected === copy.id}
                aria-label={`${i + 1}. ${copy.title}: ${evaluated ? STATUS[stage.status].label : phase === "scanning" ? "waiting for backend" : "no result yet"}`}
                onClick={() => onSelect(copy.id)}
                data-cursor="Inspect"
              >
                <span data-glyph className={styles.glyph}><NodeGlyph status={status} /></span>
                <span className={styles.n}>{i + 1}</span>
                <span className={styles.title}>{copy.short}</span>
                <span className={styles.state}>{evaluated ? <StatusPill status={stage.status} /> : <span className={styles.wait}>{phase === "scanning" ? "waiting" : "—"}</span>}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
