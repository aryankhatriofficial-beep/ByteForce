"use client";
import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import styles from "./Fingerprint.module.css";

interface Props {
  expected: string;
  observed: string | null;
  label: string;
}

/**
 * SHA-256 fingerprint: 64 nibbles as radial bars (length = nibble value).
 * Outer ring = PyPI digest, inner ring = backend-observed digest. Any
 * differing nibble is drawn red and counted, so a mismatch is visible, not
 * just colour-coded.
 */
export function Fingerprint({ expected, observed, label }: Props) {
  const root = useRef<SVGSVGElement>(null);
  const { reduced } = useMotion();
  const exp = expected.toLowerCase().padEnd(64, "0").slice(0, 64);
  const obs = observed?.toLowerCase().padEnd(64, "0").slice(0, 64) ?? null;
  const diffs = obs ? [...exp].filter((c, i) => c !== obs[i]).length : null;

  useGSAP(() => {
    if (reduced || !root.current) return;
    const tl = gsap.timeline({ scrollTrigger: { trigger: root.current, start: "top 80%", once: true } });
    tl.from(root.current.querySelectorAll("[data-outer]"), { scaleY: 0, transformOrigin: "50% 100%", stagger: { each: 0.012, from: "start" }, duration: 0.5 })
      .from(root.current.querySelectorAll("[data-inner]"), { scaleY: 0, transformOrigin: "50% 100%", stagger: { each: 0.012, from: "start" }, duration: 0.5 }, 0.3)
      .from(root.current.querySelector("[data-core]"), { scale: 0, transformOrigin: "50% 50%", duration: 0.8, ease: "back.out(1.7)" }, 0.6);
    gsap.to(root.current.querySelector("[data-spin]"), { rotation: 360, svgOrigin: "200 200", duration: 90, repeat: -1, ease: "none" });
  }, { scope: root, dependencies: [expected, observed, reduced], revertOnUpdate: true });

  const bars = (hex: string, r0: number, len: number, attr: "data-outer" | "data-inner", cmp?: string | null) =>
    [...hex].map((c, i) => {
      const v = parseInt(c, 16);
      const a = (i / 64) * 360;
      const bad = cmp ? cmp[i] !== c : false;
      return (
        <g key={i} transform={`rotate(${a} 200 200)`}>
          <rect {...{ [attr]: "" }} x="198.5" y={200 - r0 - 6 - (v / 15) * len} width="3" height={6 + (v / 15) * len} rx="1.5" className={bad ? styles.bad : attr === "data-outer" ? styles.outer : styles.inner} />
        </g>
      );
    });

  return (
    <figure className={styles.fig}>
      <svg ref={root} viewBox="0 0 400 400" role="img" aria-label={label} className={styles.svg}>
        <defs>
          <radialGradient id="fp-core"><stop offset="0" stopColor="#eef3ff" /><stop offset="0.5" stopColor="#7a5cff" /><stop offset="1" stopColor="#03040a" /></radialGradient>
        </defs>
        <g data-spin>
          {bars(exp, 120, 52, "data-outer")}
          {obs && bars(obs, 70, 38, "data-inner", exp)}
        </g>
        <circle data-core cx="200" cy="200" r="48" fill="url(#fp-core)" opacity="0.9" />
        <text x="200" y="196" textAnchor="middle" className={styles.coreText}>SHA-256</text>
        <text x="200" y="214" textAnchor="middle" className={styles.coreSub}>{obs === null ? "not downloaded" : diffs === 0 ? "64/64 match" : `${diffs} nibbles differ`}</text>
      </svg>
      <figcaption className={styles.legend}>
        <span><i className={styles.lo} /> outer · PyPI published</span>
        <span><i className={styles.li} /> inner · backend observed</span>
        <span><i className={styles.lb} /> mismatch</span>
      </figcaption>
    </figure>
  );
}
