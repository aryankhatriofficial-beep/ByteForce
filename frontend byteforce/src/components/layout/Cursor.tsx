"use client";
import { useEffect, useRef } from "react";
import { useMotion } from "@/lib/motion/MotionProvider";
import styles from "./Cursor.module.css";

const INTERACTIVE = "a, button, [role=button], [role=tab], [role=option], [role=slider], [role=radio], summary, label, select, [data-cursor]";
const TEXTUAL = "input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, [contenteditable=true], pre";

/**
 * Precision cursor: a core dot that tracks the pointer exactly and a ring that
 * eases behind it. One rAF loop that sleeps when settled; all writes are
 * transforms; no React state per frame. Enabled only on hover-capable fine
 * pointers without reduced motion — otherwise the native cursor is untouched.
 */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const { reduced, finePointer } = useMotion();

  useEffect(() => {
    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const d = dot.current, r = ring.current, l = label.current;
    if (!d || !r || !l || reduced || !finePointer || !canHover) return;

    const root = document.documentElement;
    root.classList.add("pv-cursor");
    let x = -100, y = -100, rx = -100, ry = -100, raf = 0, state = "", visible = false;

    const setState = (next: string, text = "") => {
      if (next === state && l.textContent === text) return;
      state = next;
      r.dataset.state = next; d.dataset.state = next;
      l.textContent = text;
    };
    const tick = () => {
      rx += (x - rx) * 0.32;
      ry += (y - ry) * 0.32;
      d.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      r.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      raf = Math.abs(x - rx) + Math.abs(y - ry) > 0.2 ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };

    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x = e.clientX; y = e.clientY;
      if (!visible) { visible = true; rx = x; ry = y; root.dataset.cursorVisible = "true"; }
      wake();
    };
    const over = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest) return;
      if (t.closest(TEXTUAL)) return setState("text");
      const hit = t.closest<HTMLElement>(INTERACTIVE);
      if (!hit) return setState("");
      if ((hit as HTMLButtonElement).disabled || hit.getAttribute("aria-disabled") === "true") return setState("disabled");
      setState("hover", hit.dataset.cursor ?? "");
    };
    const down = () => { r.dataset.press = "true"; d.dataset.press = "true"; };
    const up = () => { delete r.dataset.press; delete d.dataset.press; };
    const leave = () => { visible = false; root.dataset.cursorVisible = "false"; };

    addEventListener("pointermove", move, { passive: true });
    addEventListener("pointerover", over, { passive: true });
    addEventListener("pointerdown", down, { passive: true });
    addEventListener("pointerup", up, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      root.classList.remove("pv-cursor");
      delete root.dataset.cursorVisible;
      removeEventListener("pointermove", move);
      removeEventListener("pointerover", over);
      removeEventListener("pointerdown", down);
      removeEventListener("pointerup", up);
      document.removeEventListener("pointerleave", leave);
    };
  }, [reduced, finePointer]);

  return (
    <div className={styles.layer} aria-hidden="true">
      <div ref={ring} className={styles.ring}><span ref={label} className={styles.label} /></div>
      <div ref={dot} className={styles.dot} />
    </div>
  );
}
