"use client";
import { useRef } from "react";
import { gsap, SplitText, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import styles from "./Manifesto.module.css";

/** Scroll-scrubbed word-by-word illumination of the core argument. */
export function Manifesto() {
  const root = useRef<HTMLElement>(null);
  const { reduced } = useMotion();

  useGSAP(() => {
    if (reduced || !root.current) return;
    const split = SplitText.create(root.current.querySelector("[data-text]")!, { type: "words" });
    gsap.fromTo(split.words, { opacity: 0.14 }, {
      opacity: 1, stagger: 0.1, ease: "none",
      scrollTrigger: { trigger: root.current, start: "top 75%", end: "bottom 60%", scrub: true },
    });
    return () => split.revert();
  }, { scope: root, dependencies: [reduced], revertOnUpdate: true });

  return (
    <section ref={root} className={`section ${styles.m}`} aria-label="Why PyVerify">
      <div className="container">
        <span className="eyebrow">The problem</span>
        <p data-text className={styles.text}>
          A hash tells you the bytes arrived intact. It doesn’t tell you who built them, from what source, or whether the
          archive agrees with itself. PyVerify gathers each piece of evidence separately — and tells you plainly when a piece
          is <em>missing</em> rather than pretending it passed.
        </p>
      </div>
    </section>
  );
}
