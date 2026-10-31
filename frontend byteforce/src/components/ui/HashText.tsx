"use client";
import { useRef } from "react";
import { gsap, HEX_CHARS, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";

/** Monospace digest that decodes itself with ScrambleText when it scrolls into view. */
export function HashText({ value, className = "", group = 8 }: { value: string; className?: string; group?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { reduced } = useMotion();
  const pretty = group > 0 ? value.replace(new RegExp(`(.{${group}})`, "g"), "$1 ").trim() : value;

  useGSAP(() => {
    if (reduced || !ref.current) return;
    gsap.from(ref.current, {
      duration: 1.4,
      scrambleText: { text: pretty, chars: HEX_CHARS, revealDelay: 0.2, speed: 0.5 },
      scrollTrigger: { trigger: ref.current, start: "top 92%", once: true },
    });
  }, { dependencies: [value, reduced], revertOnUpdate: true });

  return <span ref={ref} className={`mono break ${className}`} aria-label={value}>{pretty}</span>;
}
