"use client";
import { useRef, useState } from "react";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/motion/gsap";
import "@/lib/motion/gsap-extra";
import { useMotion } from "@/lib/motion/MotionProvider";
import styles from "./Chapters.module.css";

const CHAPTERS = [
  { id: "hash", k: "1", title: "A hash alone is not enough", body: "A SHA-256 match says the bytes were not altered after they were published. It says nothing about who published them, how they were built, or from what source.", proves: "Integrity of bytes — and nothing about origin.", shape: "M100 18 171 59v82l-71 41-71-41V59Z" },
  { id: "integrity", k: "2", title: "What artifact integrity proves", body: "PyVerify recomputes the digest, reads METADATA without installing anything, and checks every archive member against RECORD — missing, unexpected and altered files included.", proves: "The file is exactly what PyPI serves, and it agrees with its own manifest.", shape: "M48 22h76l32 32v124H48Z" },
  { id: "attestation", k: "3", title: "What publisher attestations prove", body: "When a project publishes PEP 740 attestations, PyVerify verifies them with Sigstore and compares the signing identity with the repository and workflow you expect.", proves: "A specific CI identity signed this exact file. Missing attestations are missing evidence — not malice.", shape: "M100 14l20 30 35-8-8 35 30 20-30 20 8 35-35-8-20 30-20-30-35 8 8-35-30-20 30-20-8-35 35 8Z" },
  { id: "source", k: "4", title: "What source tracing can establish", body: "Only when a verified SLSA v1 predicate names a repository and commit can the wheel be compared with that source snapshot. It is a separate step, and it is often not possible.", proves: "Correspondence for the compared files — when, and only when, the evidence exists.", shape: "M100 30a70 70 0 1 1 0 140a70 70 0 1 1 0-140Z" },
  { id: "limits", k: "5", title: "What PyVerify cannot prove", body: "That code is safe. That the build was reproducible. That dependencies are trustworthy. That every identity attribute of a publisher was checked. A verdict is evidence, not absolution.", proves: "Honest gaps, shown as gaps.", shape: "M100 16 164 40v58c0 42-28 70-64 86-36-16-64-44-64-86V40Z" },
];

/** Pinned scroll storytelling: five evidence layers with a morphing glyph and chapter navigation. */
export function Chapters() {
  const root = useRef<HTMLElement>(null);
  const st = useRef<ScrollTrigger | null>(null);
  const [active, setActive] = useState(0);
  const { reduced, lenis } = useMotion();

  useGSAP(() => {
    if (!root.current) return;
    const mm = gsap.matchMedia();
    mm.add({ desktop: "(min-width: 900px)", reduce: "(prefers-reduced-motion: reduce)" }, (ctx) => {
      if (!ctx.conditions?.desktop || ctx.conditions?.reduce || reduced) return;
      const panels = gsap.utils.toArray<HTMLElement>("[data-panel]", root.current);
      const glyph = root.current!.querySelector("[data-glyph]");
      const tl = gsap.timeline({ defaults: { ease: "pv.inOut", duration: 1 } });
      panels.forEach((p, i) => {
        if (i === 0) return;
        // Masked hand-off: the next chapter wipes up through a clip while the previous recedes.
        tl.to(panels[i - 1], { autoAlpha: 0, yPercent: -12, duration: 0.6 }, i - 1 + 0.3)
          .fromTo(p, { autoAlpha: 1, clipPath: "inset(100% 0% 0% 0%)", yPercent: 10 }, { clipPath: "inset(0% 0% 0% 0%)", yPercent: 0, duration: 0.8 }, i - 1 + 0.35)
          .to(glyph, { morphSVG: CHAPTERS[i].shape }, i - 1 + 0.3)
          .to("[data-ring]", { rotation: i * 72, svgOrigin: "100 100" }, i - 1 + 0.3);
      });
      st.current = ScrollTrigger.create({
        trigger: root.current, start: "top top", end: `+=${panels.length * 90}%`, pin: true, scrub: 0.8, animation: tl,
        snap: { snapTo: 1 / (panels.length - 1), duration: 0.6, ease: "power2.inOut" },
        onUpdate: (s) => {
          setActive(Math.round(s.progress * (panels.length - 1)));
          gsap.set("[data-progress]", { scaleY: s.progress });
        },
      });
      return () => { st.current = null; };
    }, root);
    return () => mm.revert();
  }, { scope: root, dependencies: [reduced], revertOnUpdate: true });

  const jump = (i: number) => {
    const s = st.current;
    if (!s) { document.getElementById(`chapter-${CHAPTERS[i].id}`)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" }); return; }
    const y = s.start + (s.end - s.start) * (i / (CHAPTERS.length - 1));
    if (lenis) lenis.scrollTo(y, { duration: 1.2 }); else window.scrollTo({ top: y, behavior: "smooth" });
  };

  return (
    <section ref={root} className={styles.ch} aria-labelledby="chapters-title">
      <div className={`container ${styles.grid}`}>
        <div className={styles.left}>
          <span className="eyebrow">The investigation</span>
          <h2 id="chapters-title" className="h2">What each piece of evidence can — and cannot — tell you.</h2>
          <nav className={styles.nav} aria-label="Evidence chapters">
            <span className={styles.track} aria-hidden="true"><span data-progress className={styles.fill} /></span>
            {CHAPTERS.map((c, i) => (
              <button key={c.id} type="button" className={styles.navItem} aria-current={active === i ? "step" : undefined} onClick={() => jump(i)}>
                <span className="mono xs">{c.k}</span>{c.title}
              </button>
            ))}
          </nav>
        </div>
        <div className={styles.visual} aria-hidden="true">
          <svg viewBox="0 0 200 200" className={styles.svg}>
            <defs>
              <linearGradient id="ch-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#eef3ff" /><stop offset=".45" stopColor="#7a5cff" /><stop offset="1" stopColor="#ff4fd8" /></linearGradient>
            </defs>
            <g data-ring>
              <circle cx="100" cy="100" r="94" fill="none" stroke="var(--line-strong)" strokeDasharray="1 7" />
              <circle cx="100" cy="6" r="3" fill="var(--uv-300)" />
            </g>
            <path data-glyph d={CHAPTERS[0].shape} fill="url(#ch-g)" fillOpacity="0.16" stroke="url(#ch-g)" strokeWidth="1.4" />
          </svg>
        </div>
        <div className={styles.panels}>
          {CHAPTERS.map((c) => (
            <article key={c.id} id={`chapter-${c.id}`} data-panel className={styles.panel}>
              <span className={styles.k}>{c.k}</span>
              <h3 className="h3">{c.title}</h3>
              <p className="lead">{c.body}</p>
              <p className={styles.proves}><span className="eyebrow">Proves</span>{c.proves}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
