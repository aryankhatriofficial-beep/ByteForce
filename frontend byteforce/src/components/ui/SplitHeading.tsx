"use client";
import { useRef, type ElementType, type ReactNode } from "react";
import { gsap, SplitText, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";

interface Props {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  /** words: word-by-word rise; chars: kinetic per-character; lines: masked line reveal. */
  mode?: "words" | "chars" | "lines";
  /** Trigger on scroll (default) or immediately on mount. */
  immediate?: boolean;
  delay?: number;
  id?: string;
}

/** Masked SplitText reveal. Text is fully readable without JS and under reduced motion. */
export function SplitHeading({ as: Tag = "h2", children, className, mode = "words", immediate = false, delay = 0, id }: Props) {
  const ref = useRef<HTMLElement>(null);
  const { reduced } = useMotion();

  useGSAP(() => {
    if (reduced || !ref.current) return;
    const split = SplitText.create(ref.current, {
      type: mode === "chars" ? "lines,words,chars" : mode === "words" ? "lines,words" : "lines",
      mask: "lines",
      linesClass: "split-line",
      autoSplit: true,
      onSplit(self) {
        const targets = mode === "chars" ? self.chars : mode === "words" ? self.words : self.lines;
        return gsap.from(targets, {
          yPercent: 110,
          rotate: mode === "chars" ? 6 : 0,
          duration: mode === "chars" ? 1.1 : 1,
          stagger: mode === "chars" ? 0.025 : mode === "words" ? 0.06 : 0.1,
          delay,
          ease: "pv.out",
          scrollTrigger: immediate ? undefined : { trigger: ref.current, start: "top 85%", once: true },
        });
      },
    });
    return () => split.revert();
  }, { scope: ref, dependencies: [reduced, mode], revertOnUpdate: true });

  return <Tag ref={ref} className={className} id={id}>{children}</Tag>;
}
