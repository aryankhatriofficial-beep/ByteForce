"use client";
import { useRef, useState } from "react";
import styles from "./CopyButton.module.css";

/** Copies `value`; confirms with an icon morph and an announced label. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const t = useRef<number>(0);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setState("done"); } catch { setState("error"); }
    clearTimeout(t.current);
    t.current = window.setTimeout(() => setState("idle"), 1600);
  };
  return (
    <button type="button" className={styles.btn} data-state={state} onClick={copy} aria-label={`${label}: ${value.slice(0, 24)}${value.length > 24 ? "…" : ""}`} data-cursor="Copy">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="6.5" y="6.5" width="9" height="10" rx="2" className={styles.back} />
        <rect x="3.5" y="3.5" width="9" height="10" rx="2" className={styles.front} />
        <path d="M5 10.5l3 3 7-7" className={styles.tick} />
      </svg>
      <span aria-live="polite" className={styles.text}>{state === "done" ? "Copied" : state === "error" ? "Copy failed" : label}</span>
    </button>
  );
}
