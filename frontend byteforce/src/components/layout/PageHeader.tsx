"use client";
import { useRef, type ReactNode } from "react";
import { gsap, SplitText, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import { STAGE_COPY, type StageId } from "@/lib/evidence";
import styles from "./PageHeader.module.css";

interface Props {
  kicker: string;
  title: ReactNode;
  lead: ReactNode;
  /** Evidence-spine stages this route works with; highlighted in the strip. */
  focus: StageId[] | "all";
  aside?: ReactNode;
  /** Visual variant of the backdrop so routes don't share one look. */
  tone?: "uv" | "steel" | "mint";
  /** Tool pages: shorter header, horizontal spine strip, so the workspace starts above the fold. */
  compact?: boolean;
}

/** Shared route header: kinetic title + an evidence-spine strip locating the route in the pipeline. */
export function PageHeader({ kicker, title, lead, focus, aside, tone = "uv", compact = false }: Props) {
  const root = useRef<HTMLElement>(null);
  const { reduced } = useMotion();
  const on = (id: StageId) => focus === "all" || focus.includes(id);

  useGSAP(() => {
    if (reduced || !root.current) return;
    const h = root.current.querySelector("[data-h]")!;
    const split = SplitText.create(h, { type: "lines,words", mask: "lines", linesClass: "split-line" });
    const q = gsap.utils.selector(root.current);
    const tl = gsap.timeline({ delay: 0.12 });
    tl.from(split.words, { yPercent: 110, stagger: 0.045, duration: 0.85 })
      .from(q("[data-lead]"), { y: 16, autoAlpha: 0, duration: 0.6 }, 0.3);
    tl.from(q("[data-spine-line]"), { scale: 0, duration: 0.9, ease: "pv.inOut" }, 0.1)
      .from(q("[data-stage]"), { scale: 0, stagger: 0.05, duration: 0.45, ease: "back.out(2)" }, 0.3)
      .from(q("[data-stage-label]"), { autoAlpha: 0, stagger: 0.05, duration: 0.35 }, 0.4);
    gsap.to(q("[data-glow]"), { yPercent: 30, ease: "none", scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true } });
    return () => split.revert();
  }, { scope: root, dependencies: [reduced], revertOnUpdate: true });

  return (
    <header ref={root} className={styles.head} data-tone={tone} data-compact={compact}>
      <span data-glow className={styles.glow} aria-hidden="true" />
      <div className={`container ${styles.inner}`}>
        <div className={styles.copy}>
          <span className="eyebrow">{kicker}</span>
          <h1 data-h className={styles.title}>{title}</h1>
          <div data-lead className={styles.leadRow}><p className="lead">{lead}</p>{aside}</div>
        </div>
        <figure className={styles.spine} aria-label={`Evidence stages on this page: ${STAGE_COPY.filter((s) => on(s.id)).map((s) => s.short).join(", ")}`}>
          <span data-spine-line className={styles.line} aria-hidden="true" />
          <ol aria-hidden="true">
            {STAGE_COPY.map((s) => (
              <li key={s.id} data-on={on(s.id)}><span data-stage className={styles.dot} /><span data-stage-label>{s.short}</span></li>
            ))}
          </ol>
        </figure>
      </div>
    </header>
  );
}
