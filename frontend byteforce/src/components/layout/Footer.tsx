import { ROUTES } from "@/lib/routes";
import { TransitionLink } from "./PageTransition";
import { LogoMark } from "./Logo";
import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className="container">
        <div className={styles.big} aria-hidden="true">BEYOND THE BINARY.</div>
        <div className={styles.grid}>
          <div className={styles.brand}>
            <div className="row"><LogoMark size={32} /><strong className={styles.word}>PyVerify</strong></div>
            <p className="small muted">Published-package integrity for Python. Hackathon PS04 · team ByteForce.</p>
            <p className="xs muted">PyVerify reports evidence. A passing report is not a statement that a package is safe to run.</p>
          </div>
          <nav aria-label="Footer" className={styles.links}>
            {ROUTES.map((r) => (
              <TransitionLink key={r.href} href={r.href} className={styles.link}>{r.label}</TransitionLink>
            ))}
          </nav>
          <div className={styles.meta}>
            <span className="eyebrow">Shortcuts</span>
            <p className="small"><kbd>⌘</kbd> <kbd>K</kbd> command palette</p>
            <p className="small"><kbd>Tab</kbd> every control is keyboard reachable</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
