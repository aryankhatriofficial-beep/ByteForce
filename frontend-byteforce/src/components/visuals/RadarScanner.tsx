"use client";
import { useRef } from "react";
import type { CheckId, CheckStatus } from "@/lib/api/types";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import styles from "./RadarScanner.module.css";

export interface RadarBlip { id: CheckId | string; label: string; status: CheckStatus | "pending" }

interface Props { blips: RadarBlip[]; scanning: boolean; label: string }

/**
 * Scanner visual. The sweep only spins while a request is in flight; each blip
 * is one real check and takes its colour from that check's status.
 */
export function RadarScanner({ blips, scanning, label }: Props) {
  const root = useRef<SVGSVGElement>(null);
  const { reduced } = useMotion();
  const R = 150;

  useGSAP(() => {
    if (!root.current) return;
    const sweep = root.current.querySelector("[data-sweep]");
    if (scanning && !reduced) {
      gsap.to(sweep, { rotation: "+=360", transformOrigin: "50% 50%", svgOrigin: "200 200", duration: 2.4, ease: "none", repeat: -1 });
      gsap.to(root.current.querySelectorAll("[data-ring]"), { attr: { r: (i: number) => 60 + i * 45 + 6 }, duration: 1.2, yoyo: true, repeat: -1, ease: "sine.inOut", stagger: 0.2 });
    } else {
      gsap.to(sweep, { autoAlpha: scanning ? 1 : 0.0, duration: 0.4 });
    }
    gsap.from(root.current.querySelectorAll("[data-blip]"), { scale: 0, transformOrigin: "50% 50%", stagger: 0.06, duration: 0.6, ease: "back.out(2)" });
  }, { scope: root, dependencies: [scanning, reduced, blips.map((b) => b.status).join()], revertOnUpdate: true });

  return (
    <figure className={styles.fig}>
      <svg ref={root} viewBox="0 0 400 400" className={styles.svg} role="img" aria-label={label}>
        <defs>
          <radialGradient id="radar-bg"><stop offset="0" stopColor="#111834" /><stop offset="1" stopColor="#03040a" /></radialGradient>
          <linearGradient id="radar-sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#7a5cff" stopOpacity="0" /><stop offset="1" stopColor="#c3b4ff" stopOpacity="0.55" /></linearGradient>
        </defs>
        <circle cx="200" cy="200" r={R + 40} fill="url(#radar-bg)" stroke="var(--line-strong)" />
        {[0, 1, 2].map((i) => <circle key={i} data-ring cx="200" cy="200" r={60 + i * 45} fill="none" stroke="var(--line)" strokeDasharray={i === 2 ? "2 6" : undefined} />)}
        <path d="M200 10V390M10 200H390" stroke="var(--line)" />
        <g data-sweep><path d={`M200 200 L200 ${200 - R - 40} A${R + 40} ${R + 40} 0 0 1 ${200 + (R + 40) * Math.sin(Math.PI / 4)} ${200 - (R + 40) * Math.cos(Math.PI / 4)} Z`} fill="url(#radar-sweep)" /></g>
        {blips.map((b, i) => {
          const a = (i / blips.length) * Math.PI * 2 - Math.PI / 2;
          const rr = 70 + (i % 3) * 40;
          const x = 200 + Math.cos(a) * rr, y = 200 + Math.sin(a) * rr;
          return (
            <g key={b.id} data-blip className={styles.blip} data-status={b.status}>
              <circle cx={x} cy={y} r="14" className={styles.halo} />
              <circle cx={x} cy={y} r="5" className={styles.dot} />
              <text x={x} y={y + 28} textAnchor="middle" className={styles.text}>{b.label}</text>
            </g>
          );
        })}
        <circle cx="200" cy="200" r="4" fill="var(--ice)" />
      </svg>
    </figure>
  );
}
