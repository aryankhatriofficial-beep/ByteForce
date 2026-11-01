"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { LogLine } from "@/lib/api/types";
import styles from "./Terminal.module.css";

interface Props {
  title?: string;
  lines: LogLine[];
  /** Number of lines currently visible (for staged replay). Defaults to all. */
  visible?: number;
  footer?: ReactNode;
  tag?: ReactNode;
  live?: boolean;
  className?: string;
  ariaLabel?: string;
}

const LEVEL: Record<LogLine["level"], string> = { info: "··", ok: "OK", warn: "!!", error: "XX" };

/** Terminal-style log. New lines are announced politely to screen readers. */
export function Terminal({ title = "pyverify", lines, visible, footer, tag, live, className = "", ariaLabel }: Props) {
  const body = useRef<HTMLOListElement>(null);
  const shown = lines.slice(0, visible ?? lines.length);

  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  return (
    <section className={`${styles.term} ${className}`} aria-label={ariaLabel ?? `${title} log`}>
      <header className={styles.bar}>
        <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>
        <span className="mono xs muted">{title}</span>
        <span className={styles.tag}>{tag}</span>
      </header>
      <ol ref={body} className={styles.body} aria-live={live ? "polite" : "off"}>
        {shown.map((l, i) => (
          <li key={i} className={styles.line} data-level={l.level}>
            <span className={styles.t}>{(l.t / 1000).toFixed(2).padStart(6, " ")}s</span>
            <span className={styles.lvl}>{LEVEL[l.level]}</span>
            <span className={styles.stage}>{l.stage}</span>
            <span className={styles.msg}>{l.message}</span>
          </li>
        ))}
        {live && <li className={styles.cursor} aria-hidden="true">▍</li>}
      </ol>
      {footer && <footer className={styles.foot}>{footer}</footer>}
    </section>
  );
}
