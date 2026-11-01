"use client";
import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import styles from "./Capabilities.module.css";

const CAPS = [
  { t: "Bounded HTTPS download", d: "Artifact metadata from PyPI's JSON API; download capped by size." , tag: "fetch" },
  { t: "SHA-256 + size", d: "Recomputed over the downloaded bytes and compared with PyPI.", tag: "digest" },
  { t: "Wheel metadata", d: "METADATA and WHEEL parsed from the archive. Nothing installed.", tag: "metadata" },
  { t: "RECORD validation", d: "Hash · size · missing · unexpected · duplicate entries.", tag: "record" },
  { t: "Safe inventory", d: "Wheel and sdist listed within bounds. No extraction, no execution.", tag: "inventory" },
  { t: "PEP 740 attestations", d: "Retrieved from PyPI, verified with Sigstore against the digest.", tag: "provenance" },
  { t: "Publisher policy", d: "Repository and optional workflow filename vs. verified identity.", tag: "policy" },
  { t: "sdist ↔ wheel", d: "Python files compared by content across the two distributions.", tag: "consistency" },
  { t: "Verified source trace", d: "A separate workflow: SLSA v1 predicate → repository → pinned commit → snapshot diff.", tag: "source" },
];

/** Horizontal scroll sequence (pinned, containerAnimation). Native swipe-scroll on touch / reduced motion. */
export function Capabilities() {
  const root = useRef<HTMLElement>(null);
  const { reduced } = useMotion();

  useGSAP(() => {
    if (!root.current) return;
    const mm = gsap.matchMedia();
    mm.add("(min-width: 900px) and (prefers-reduced-motion: no-preference)", () => {
      if (reduced) return;
      const track = root.current!.querySelector<HTMLElement>("[data-track]")!;
      const dist = () => track.scrollWidth - innerWidth + 64;
      const tween = gsap.to(track, {
        x: () => -dist(), ease: "none",
        scrollTrigger: { trigger: root.current, start: "top top", end: () => `+=${dist()}`, pin: true, scrub: 1, invalidateOnRefresh: true },
      });
      gsap.utils.toArray<HTMLElement>("[data-cap]", root.current).forEach((card) => {
        gsap.from(card.querySelector("[data-cap-bar]"), {
          scaleX: 0, transformOrigin: "0 50%", ease: "none",
          scrollTrigger: { trigger: card, containerAnimation: tween, start: "left 90%", end: "left 40%", scrub: true },
        });
        gsap.from(card, { rotateY: -18, z: -120, autoAlpha: 0.3, ease: "none", scrollTrigger: { trigger: card, containerAnimation: tween, start: "left 100%", end: "left 60%", scrub: true } });
      });
    }, root);
    return () => mm.revert();
  }, { scope: root, dependencies: [reduced], revertOnUpdate: true });

  return (
    <section ref={root} className={styles.caps} aria-labelledby="caps-title">
      <div className={styles.head}>
        <div className="container">
          <span className="eyebrow">The pipeline, in order</span>
          <h2 id="caps-title" className="h2">Nine steps. Nothing installed, nothing executed.</h2>
        </div>
      </div>
      <div className={styles.viewport}>
        <ol data-track className={styles.track}>
          {CAPS.map((c, i) => (
            <li key={c.t} data-cap className={styles.card}>
              <span className={styles.num}>{String(i + 1).padStart(2, "0")}</span>
              <span className={`mono xs ${styles.tag}`}>{c.tag}</span>
              <h3 className={styles.t}>{c.t}</h3>
              <p className="small muted">{c.d}</p>
              <span data-cap-bar className={styles.bar} aria-hidden="true" />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
