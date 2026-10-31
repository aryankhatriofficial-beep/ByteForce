"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/motion/gsap";
import { DUR, STAGGER } from "@/lib/motion/tokens";
import { useMotion } from "@/lib/motion/MotionProvider";
import { usePageTransition } from "@/components/layout/PageTransition";

/**
 * Re-mounts on every navigation and owns the two shared motion primitives:
 *  - `[data-enter]`  — staggered entrance of above-the-fold blocks on arrival.
 *  - `[data-reveal]` — masked (clip-path) reveal when a block scrolls into view.
 * After a covered transition it hands off from the veil; on back/forward or a
 * direct load it plays a light "arrival" scan line instead.
 */
export default function Template({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const arrival = useRef<HTMLSpanElement>(null);
  const { reveal } = usePageTransition();
  const { reduced } = useMotion();
  const coveredRef = useRef(false);

  // Hand-off from the route veil happens outside any GSAP context so that a
  // context revert (StrictMode double-mount, dependency change) can't undo it.
  useLayoutEffect(() => {
    if (reveal()) coveredRef.current = true;
  }, [reveal]);

  useGSAP(() => {
    const covered = coveredRef.current;
    if (reduced || !root.current) return;

    const enter = root.current.querySelectorAll("[data-enter]");
    if (enter.length) gsap.from(enter, { y: 28, autoAlpha: 0, duration: DUR.slow, stagger: STAGGER.base, delay: covered ? 0.22 : 0.05, clearProps: "transform,opacity,visibility" });

    if (!covered && arrival.current) {
      gsap.timeline()
        .fromTo(arrival.current, { scaleX: 0, opacity: 1 }, { scaleX: 1, duration: 0.5, ease: "pv.inOut" })
        .to(arrival.current, { opacity: 0, duration: 0.3 });
    }

    const below = gsap.utils.toArray<HTMLElement>("[data-reveal]", root.current).filter((el) => el.getBoundingClientRect().top > innerHeight * 0.92);
    if (below.length) {
      gsap.set(below, { clipPath: "inset(0% 0% 100% 0%)", y: 24 });
      ScrollTrigger.batch(below, {
        start: "top 90%", once: true,
        onEnter: (els) => gsap.to(els, { clipPath: "inset(0% 0% 0% 0%)", y: 0, duration: 0.8, stagger: STAGGER.loose, ease: "pv.out", clearProps: "clipPath,transform" }),
      });
    }
  }, { scope: root, dependencies: [reduced], revertOnUpdate: true });

  return (
    <div ref={root}>
      <span ref={arrival} aria-hidden="true" style={{ position: "fixed", top: "var(--nav-h)", left: 0, right: 0, height: 2, zIndex: 99, transformOrigin: "0 50%", transform: "scaleX(0)", background: "linear-gradient(90deg, transparent, var(--uv-400), #fff, var(--plasma), transparent)", pointerEvents: "none" }} />
      {children}
    </div>
  );
}
