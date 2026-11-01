"use client";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import styles from "./Toast.module.css";

type Tone = "info" | "pass" | "warn" | "fail";
interface ToastItem { id: number; title: string; body?: string; tone: Tone }

const Ctx = createContext<(t: Omit<ToastItem, "id">) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5200);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <ol className={styles.region} aria-live="polite" aria-label="Notifications">
        {items.map((t) => (
          <li key={t.id} className={styles.toast} data-tone={t.tone}>
            <strong>{t.title}</strong>
            {t.body && <span>{t.body}</span>}
            <button type="button" className={styles.close} aria-label="Dismiss notification" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>×</button>
          </li>
        ))}
      </ol>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
