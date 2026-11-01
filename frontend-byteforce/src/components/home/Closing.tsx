"use client";
import { useRef } from "react";
import { ROUTES } from "@/lib/routes";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import { TransitionLink } from "@/components/layout/PageTransition";
import { Button } from "@/components/ui/Button";
import { SplitHeading } from "@/components/ui/SplitHeading";
import { GooeyOrbs } from "@/components/visuals/GooeyOrbs";
import styles from "./Closing.module.css";

const LIMITS = [
  ["A valid hash", "does not prove a package is safe."],
  ["Missing provenance", "is not proof of malice."],
  ["Static comparison", "is not a reproducible build."],
  ["Source trace", "needs a verified SLSA v1 predicate."],
  ["Publisher policy", "does not cover every identity attribute."],
];

export function Limits() {
  const root = useRef<HTMLElement>(null);
  const { reduced } = useMotion();
  useGSAP(() => {
    if (reduced) return;
    ScrollTrigger.batch("[data-limit]", {
      start: "top 88%", once: true,
      onEnter: (els) => gsap.from(els, { y: 50, rotate: (i) => (i % 2 ? 2 : -2), autoAlpha: 0, stagger: 0.08, duration: 0.9 }),
    });
  }, { scope: root, dependencies: [reduced], revertOnUpdate: true });
  return (
    <section ref={root} className="section" aria-labelledby="limits-title">
      <div className="container">
        <span className="eyebrow">Read this before trusting a verdict</span>
        <SplitHeading id="limits-title" className="h2">What a <span className="text-uv">PASS</span> does not mean.</SplitHeading>
        <ul className={styles.limits}>
          {LIMITS.map(([a, b]) => (
            <li key={a} data-limit className={`card--brutal ${styles.limit}`}><strong>{a}</strong> {b}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function RouteBento() {
  const root = useRef<HTMLElement>(null);
  const { reduced, finePointer } = useMotion();
  useGSAP((_, contextSafe) => {
    if (reduced || !finePointer || !contextSafe) return;
    // hover tilt toward the pointer
    const cards = gsap.utils.toArray<HTMLElement>("[data-tile]", root.current);
    const offs = cards.map((c) => {
      const rx = gsap.quickTo(c, "rotationX", { duration: 0.6 }), ry = gsap.quickTo(c, "rotationY", { duration: 0.6 });
      const move = contextSafe((e: PointerEvent) => {
        const r = c.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - 0.5) * 8); rx(-((e.clientY - r.top) / r.height - 0.5) * 8);
        c.style.setProperty("--mx", `${e.clientX - r.left}px`); c.style.setProperty("--my", `${e.clientY - r.top}px`);
      });
      const leave = contextSafe(() => { rx(0); ry(0); });
      c.addEventListener("pointermove", move); c.addEventListener("pointerleave", leave);
      return () => { c.removeEventListener("pointermove", move); c.removeEventListener("pointerleave", leave); };
    });
    return () => offs.forEach((f) => f());
  }, { scope: root, dependencies: [reduced, finePointer], revertOnUpdate: true });

  return (
    <section ref={root} className="section" aria-labelledby="bento-title">
      <div className="container">
        <span className="eyebrow">Inside PyVerify</span>
        <SplitHeading id="bento-title" className="h2">Six instruments, one body of evidence.</SplitHeading>
        <div className={styles.bento}>
          {ROUTES.slice(1).map((r, i) => (
            <TransitionLink key={r.href} href={r.href} data-tile className={styles.tile} data-i={i}>
              <h3 className="h3">{r.label}</h3>
              <p className="small muted">{r.blurb}</p>
            </TransitionLink>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className={`section ${styles.cta}`} aria-labelledby="cta-title">
      <div className={`container ${styles.ctaInner}`}>
        <GooeyOrbs active size={110} />
        <SplitHeading id="cta-title" className="display" mode="chars">Verify before you trust.</SplitHeading>
        <p className="lead">One identifier. Every piece of evidence PyPI and Sigstore can give you — and an honest gap where they can’t.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Button href="/verify" variant="primary" magnetic>Verify an artifact</Button>
          <Button href="/architecture" variant="ghost">See the pipeline</Button>
        </div>
      </div>
    </section>
  );
}
