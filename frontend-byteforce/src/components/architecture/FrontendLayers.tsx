"use client";
import { useRef } from "react";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import styles from "./FrontendLayers.module.css";

const LAYERS = [
  { k: "Routes & components", f: "src/app/*, src/components/*", d: "Seven routes. Components only consume typed data; they never call fetch." },
  { k: "Hooks", f: "src/lib/useApi.ts", d: "useReport / usePackage: loading, error, retry, session cache keyed by data mode." },
  { k: "Provider", f: "src/lib/api/provider.ts", d: "liveProvider ↔ demoProvider. Demo is chosen only when no backend URL is configured or the user switches explicitly." },
  { k: "Normaliser", f: "src/lib/api/normalize.ts", d: "The single mapping point: snake_case → camelCase, status spellings → PASS/WARN/FAIL/UNAVAILABLE/SKIPPED. Unknown never becomes PASS." },
  { k: "HTTP client", f: "src/lib/api/client.ts + endpoints.ts", d: "Timeout, abort, credentials omitted, error-body parsing. Routes defined in one file." },
];

/** Layered parallax stack of the frontend's integration architecture. */
export function FrontendLayers() {
  const root = useRef<HTMLElement>(null);
  const { reduced } = useMotion();
  useGSAP(() => {
    if (reduced) return;
    gsap.utils.toArray<HTMLElement>("[data-layer]", root.current).forEach((el, i) => {
      gsap.fromTo(el, { y: 60 + i * 30, rotateX: 20 }, { y: 0, rotateX: 0, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "top 55%", scrub: true } });
    });
    ScrollTrigger.refresh();
  }, { scope: root, dependencies: [reduced], revertOnUpdate: true });

  return (
    <section ref={root} className="section" aria-labelledby="fe-title">
      <div className="container">
        <span className="eyebrow">Frontend integration architecture</span>
        <h2 id="fe-title" className="h2">One seam for the backend.</h2>
        <p className="lead" style={{ marginTop: "var(--s-4)" }}>Integration work on the other machine touches two files: <code>endpoints.ts</code> and <code>normalize.ts</code>. Everything above them is already wired.</p>
        <ol className={styles.stack}>
          {LAYERS.map((l, i) => (
            <li key={l.k} data-layer className={styles.layer} style={{ zIndex: LAYERS.length - i }}>
              <span className="mono xs muted">L{i + 1}</span>
              <strong>{l.k}</strong>
              <code className="xs">{l.f}</code>
              <p className="small muted">{l.d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
