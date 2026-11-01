import type { ReactNode } from "react";
import styles from "./States.module.css";

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className={styles.box} data-kind="empty" role="status">
      <div className={styles.icon} aria-hidden="true">{icon ?? <svg viewBox="0 0 48 48"><rect x="8" y="12" width="32" height="26" rx="3" fill="none" stroke="currentColor" strokeDasharray="3 3" /><path d="M8 18h32" stroke="currentColor" /></svg>}</div>
      <h3 className={styles.title}>{title}</h3>
      {children && <div className={styles.body}>{children}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.box} data-kind="error" role="alert">
      <div className={styles.icon} aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M24 6 44 40H4Z" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M24 19v10M24 33v2" stroke="currentColor" strokeWidth="2" /></svg></div>
      <h3 className={styles.title}>{title}</h3>
      {children && <div className={styles.body}>{children}</div>}
      {action}
    </div>
  );
}

export function SkeletonBlock({ lines = 3, height = 14 }: { lines?: number; height?: number }) {
  return (
    <div className={styles.skel} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ height, width: `${100 - ((i * 17) % 40)}%` }} />)}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.orbit} aria-hidden="true"><i /><i /><i /></span>
      <span className="mono small muted">{label}</span>
    </div>
  );
}
