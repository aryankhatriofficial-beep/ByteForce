"use client";
import { useId, useRef } from "react";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import "@/lib/motion/gsap-extra";
import { useMotion } from "@/lib/motion/MotionProvider";

/**
 * Metaball cluster: circles merged by an SVG "goo" filter (blur + alpha
 * threshold). Used as the in-flight indicator — it only moves while `active`.
 */
export function GooeyOrbs({ active, size = 120, label }: { active: boolean; size?: number; label?: string }) {
  const root = useRef<SVGSVGElement>(null);
  const id = useId().replace(/:/g, "");
  const { reduced } = useMotion();

  useGSAP(() => {
    if (!root.current) return;
    const orbs = root.current.querySelectorAll("[data-orb]");
    if (!active || reduced) { gsap.to(orbs, { x: 0, y: 0, duration: 0.6 }); return; }
    orbs.forEach((o, i) => {
      const a = (i / orbs.length) * Math.PI * 2;
      gsap.to(o, {
        motionPath: { path: [{ x: Math.cos(a) * 26, y: Math.sin(a) * 26 }, { x: Math.cos(a + 2) * 8, y: Math.sin(a + 2) * 8 }, { x: Math.cos(a + 4) * 30, y: Math.sin(a + 4) * 30 }, { x: 0, y: 0 }], curviness: 1.6 },
        duration: 2.2 + i * 0.25, repeat: -1, ease: "sine.inOut",
      });
    });
  }, { scope: root, dependencies: [active, reduced], revertOnUpdate: true });

  return (
    <svg ref={root} width={size} height={size} viewBox="-60 -60 120 120" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        <filter id={`goo${id}`}>
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b" />
          <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" />
        </filter>
        <linearGradient id={`gg${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c3b4ff" /><stop offset="1" stopColor="#ff4fd8" /></linearGradient>
      </defs>
      <g filter={`url(#goo${id})`} fill={`url(#gg${id})`}>
        <circle data-orb r="16" /><circle data-orb r="12" /><circle data-orb r="10" /><circle data-orb r="13" /><circle data-orb r="8" />
      </g>
    </svg>
  );
}
