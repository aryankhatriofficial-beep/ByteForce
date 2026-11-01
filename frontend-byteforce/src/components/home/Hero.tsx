"use client";
import { useRef } from "react";
import dynamic from "next/dynamic";
import { gsap, SplitText, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import { STAGE_COPY } from "@/lib/evidence";
import { Button } from "@/components/ui/Button";
import styles from "./Hero.module.css";

const ArtifactHero = dynamic(() => import("@/components/visuals/ArtifactHero").then((m) => m.ArtifactHero), { ssr: false });

export function Hero() {
  const root = useRef<HTMLElement>(null);
  const { reduced, finePointer } = useMotion();

  useGSAP((_, contextSafe) => {
    if (!root.current || reduced) return;
    const q = gsap.utils.selector(root.current);
    const title = root.current.querySelector("[data-title]")!;
    const split = SplitText.create(title, { type: "lines,chars", mask: "lines", linesClass: "split-line" });

    // One orchestrated entrance: type, then the artifact, then the evidence spine drawing through it.
    const tl = gsap.timeline({ delay: document.documentElement.classList.contains("pv-booted") ? 0.1 : 1.35 });
    tl.from(split.chars, { yPercent: 115, duration: 1.1, stagger: 0.028, ease: "pv.out" })
      .from(q("[data-sub] > *"), { y: 18, autoAlpha: 0, stagger: 0.08, duration: 0.7 }, 0.55)
      .from(q("[data-orb]"), { autoAlpha: 0, scale: 0.85, duration: 1.4 }, 0.15)
      .fromTo(q("[data-spine]"), { scaleX: 0 }, { scaleX: 1, duration: 1.3, ease: "pv.inOut" }, 0.6)
      .from(q("[data-node]"), { scale: 0, transformOrigin: "50% 50%", stagger: 0.08, duration: 0.5, ease: "back.out(2.4)" }, 0.8)
      .from(q("[data-nlabel]"), { autoAlpha: 0, y: 8, stagger: 0.08, duration: 0.4 }, 0.9);

    // Scroll: headline lifts, floor tilts away, artifact sinks — three depths.
    const st = { trigger: root.current, start: "top top", end: "bottom top", scrub: true } as const;
    gsap.to(title, { yPercent: -28, ease: "none", scrollTrigger: st });
    gsap.to(q("[data-orb]"), { yPercent: 18, ease: "none", scrollTrigger: st });
    gsap.to(q("[data-floor]"), { rotateX: 72, opacity: 0.2, ease: "none", scrollTrigger: st });

    if (!finePointer || !contextSafe) return () => split.revert();
    const layers = [{ el: "[data-title]", k: -10 }, { el: "[data-orb]", k: 18 }].map(({ el, k }) => ({
      x: gsap.quickTo(q(el), "x", { duration: 1.1, ease: "power3" }), y: gsap.quickTo(q(el), "y", { duration: 1.1, ease: "power3" }), k,
    }));
    const move = contextSafe((e: PointerEvent) => {
      const nx = e.clientX / innerWidth - 0.5, ny = e.clientY / innerHeight - 0.5;
      layers.forEach((l) => { l.x(nx * l.k); l.y(ny * l.k); });
    });
    addEventListener("pointermove", move, { passive: true });
    return () => { removeEventListener("pointermove", move); split.revert(); };
  }, { scope: root, dependencies: [reduced, finePointer], revertOnUpdate: true });

  return (
    <section ref={root} className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.floorWrap} aria-hidden="true"><div data-floor className={styles.floor} /></div>
      <div className={styles.orb} data-orb><ArtifactHero /></div>
      <div className={`container ${styles.content}`}>
        <h1 id="hero-title" className={styles.title} data-title>Beyond the binary.</h1>
        <div className={styles.sub} data-sub>
          <p className={styles.prop}>
            Verify the artifact. Verify who published it. Trace the source when cryptographic evidence allows —
            without installing or executing the package.
          </p>
          <div className="row">
            <Button href="/verify" variant="primary" magnetic>Verify an artifact</Button>
            <Button href="/docs" variant="ghost">How the evidence works</Button>
          </div>
        </div>
      </div>
      <figure className={styles.spineFig} aria-label="Evidence spine: PyPI artifact, SHA-256, metadata, attestation, publisher, RECORD, source">
        <div className={styles.spineTrack} aria-hidden="true">
          <span data-spine className={styles.spineLine} />
          {!reduced && <span className={styles.signal} />}
        </div>
        <ol className={styles.nodes} aria-hidden="true">
          {STAGE_COPY.map((s) => <li key={s.id}><span data-node className={styles.node} /><span data-nlabel>{s.short}</span></li>)}
        </ol>
      </figure>
    </section>
  );
}
