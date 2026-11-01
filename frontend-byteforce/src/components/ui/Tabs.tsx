"use client";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useGSAP } from "@/lib/motion/gsap";
import { Flip } from "@/lib/motion/gsap-extra";
import { useMotion } from "@/lib/motion/MotionProvider";
import styles from "./Tabs.module.css";

export interface TabDef { id: string; label: ReactNode; badge?: ReactNode }

interface Props {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  label: string;
  idPrefix: string;
}

/** WAI-ARIA tabs with roving focus; the active indicator moves with GSAP Flip. */
export function Tabs({ tabs, active, onChange, label, idPrefix }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const state = useRef<Flip.FlipState | null>(null);
  const { reduced } = useMotion();

  const select = (id: string) => {
    if (indicator.current) state.current = Flip.getState(indicator.current);
    onChange(id);
  };

  useGSAP(() => {
    if (state.current && !reduced && indicator.current) Flip.from(state.current, { duration: 0.55, ease: "pv.out" });
    state.current = null;
  }, { dependencies: [active] });

  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = tabs.length - 1;
    else return;
    e.preventDefault();
    select(tabs[n].id);
    list.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[n]?.focus();
  };

  return (
    <div ref={list} className={styles.list} role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={on}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={on ? 0 : -1}
            className={styles.tab}
            onClick={() => select(t.id)}
          >
            <span className={styles.label}>{t.label}</span>
            {t.badge}
            {on && <span ref={indicator} className={styles.indicator} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
