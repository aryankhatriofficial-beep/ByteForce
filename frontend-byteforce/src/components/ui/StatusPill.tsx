"use client";
import { useRef } from "react";
import type { CheckStatus } from "@/lib/api/types";
import { STATUS } from "@/lib/status";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";

interface Props {
  status: CheckStatus;
  size?: "md" | "lg";
  /** Override label text (glyph + colour still come from status). */
  label?: string;
}

/** Status is always glyph + text + colour — never colour alone. Transitions scramble the label on change. */
export function StatusPill({ status, size = "md", label }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(status);
  const { reduced } = useMotion();
  const meta = STATUS[status];
  const text = label ?? meta.short;

  useGSAP(() => {
    if (reduced || prev.current === status || !ref.current) { prev.current = status; return; }
    prev.current = status;
    const t = ref.current.querySelector("[data-label]");
    gsap.fromTo(ref.current, { scale: 0.86 }, { scale: 1, duration: 0.6, ease: "elastic.out(1, 0.5)" });
    if (t) gsap.to(t, { duration: 0.5, scrambleText: { text, chars: "XO#/\\01", speed: 0.6 } });
  }, { dependencies: [status, reduced] });

  return (
    <span ref={ref} className={`status ${size === "lg" ? "status--lg" : ""}`} data-status={status} title={meta.meaning}>
      <span className="status__glyph" aria-hidden="true">{meta.glyph}</span>
      <span data-label>{text}</span>
      <span className="sr-only">: {meta.label}</span>
    </span>
  );
}

export function DemoTag({ outline = false, children = "Demo data" }: { outline?: boolean; children?: string }) {
  return <span className={`demo-tag ${outline ? "demo-tag--outline" : ""}`} title="Fictional fixture data bundled with the frontend — not a real verification.">{children}</span>;
}
