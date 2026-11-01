"use client";
import { useRef } from "react";
import type { PackageRelease } from "@/lib/api/types";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { Draggable } from "@/lib/motion/gsap-extra";
import { useMotion } from "@/lib/motion/MotionProvider";
import styles from "./ReleaseTimeline.module.css";

interface Props {
  releases: PackageRelease[];
  active?: string;
  /** Second highlighted version (compare mode). */
  secondary?: string;
  onSelect: (version: string) => void;
}

/**
 * Interactive release timeline. Versions are plotted by upload time; the
 * track is draggable with inertia when it overflows. Every node is a button.
 */
export function ReleaseTimeline({ releases, active, secondary, onSelect }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLOListElement>(null);
  const { reduced } = useMotion();
  const sorted = [...releases].sort((a, b) => a.uploadTime.localeCompare(b.uploadTime));
  const t0 = Date.parse(sorted[0]?.uploadTime ?? "") || 0;
  const t1 = Date.parse(sorted.at(-1)?.uploadTime ?? "") || t0 + 1;
  const span = Math.max(1, t1 - t0);

  useGSAP(() => {
    if (!track.current || !viewport.current) return;
    const d = Draggable.create(track.current, { type: "x", bounds: viewport.current, inertia: !reduced, edgeResistance: 0.85, dragClickables: false, cursor: "grab", activeCursor: "grabbing" });
    if (!reduced) gsap.from(track.current.querySelectorAll("[data-node]"), { scale: 0, autoAlpha: 0, stagger: 0.06, duration: 0.7, ease: "back.out(2)" });
    return () => d.forEach((x) => x.kill());
  }, { dependencies: [releases.length, reduced], revertOnUpdate: true });

  return (
    <div ref={viewport} className={styles.viewport}>
      <ol ref={track} className={styles.track} style={{ minWidth: `max(100%, ${sorted.length * 150}px)` }}>
        <span className={styles.line} aria-hidden="true" />
        {sorted.map((r) => {
          const pos = sorted.length === 1 ? 50 : 7 + ((Date.parse(r.uploadTime) - t0) / span) * 86;
          const state = r.version === active ? "active" : r.version === secondary ? "secondary" : "idle";
          const prov = r.files.some((f) => f.hasProvenance);
          return (
            <li key={r.version} data-node className={styles.node} style={{ left: `${pos}%` }} data-state={state}>
              <button type="button" onClick={() => onSelect(r.version)} aria-pressed={state !== "idle"} aria-label={`Version ${r.version}, uploaded ${r.uploadTime.slice(0, 10)}${prov ? ", has provenance" : ""}${r.yanked ? ", yanked" : ""}`}>
                <span className={styles.dot} data-prov={prov} />
                <span className={`mono ${styles.v}`}>{r.version}</span>
                <span className={`mono ${styles.d}`}>{r.uploadTime.slice(0, 10)}</span>
                {r.yanked && <span className={styles.y}>yanked</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
