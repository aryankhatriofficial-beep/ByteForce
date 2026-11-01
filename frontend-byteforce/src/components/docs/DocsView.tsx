"use client";
import { useMemo, useRef, useState } from "react";
import { DOC_SECTIONS, type DocBlock } from "@/lib/docsContent";
import type { CheckStatus } from "@/lib/api/types";
import { STATUS, STATUS_ORDER, deriveOverall } from "@/lib/status";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import { StatusPill } from "@/components/ui/StatusPill";
import { EmptyState } from "@/components/ui/States";
import styles from "./DocsView.module.css";

const ALL: CheckStatus[] = STATUS_ORDER;

export function DocsView() {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(DOC_SECTIONS[0].id);
  const root = useRef<HTMLDivElement>(null);
  const { reduced, lenis } = useMotion();

  const term = q.trim().toLowerCase();
  const sections = useMemo(() => DOC_SECTIONS.filter((s) => !term || `${s.title} ${s.keywords} ${s.blocks.map((b) => `${b.text ?? ""} ${(b.items ?? []).join(" ")}`).join(" ")}`.toLowerCase().includes(term)), [term]);
  const groups = Array.from(new Set(sections.map((s) => s.group)));

  useGSAP(() => {
    if (!root.current) return;
    const triggers = gsap.utils.toArray<HTMLElement>("[data-doc]", root.current).map((el) =>
      ScrollTrigger.create({ trigger: el, start: "top 40%", end: "bottom 40%", onToggle: (s) => s.isActive && setActive(el.id) }));
    const bar = root.current.querySelector("[data-read]");
    const article = root.current.querySelector("[data-article]");
    const prog = ScrollTrigger.create({ trigger: article, start: "top 20%", end: "bottom bottom", onUpdate: (s) => gsap.set(bar, { scaleX: s.progress }) });
    if (!reduced) {
      ScrollTrigger.batch(root.current.querySelectorAll("[data-doc]"), { start: "top 85%", once: true, onEnter: (els) => gsap.from(els, { y: 30, autoAlpha: 0, stagger: 0.08, duration: 0.8 }) });
    }
    return () => { triggers.forEach((t) => t.kill()); prog.kill(); };
  }, { scope: root, dependencies: [term, reduced], revertOnUpdate: true });

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { offset: -90 }); else el.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <div ref={root} className={styles.layout}>
      <div className={styles.readBar} aria-hidden="true"><span data-read /></div>
      <aside className={styles.side}>
        <div className="field">
          <label htmlFor="doc-q">Search docs</label>
          <input id="doc-q" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="provenance, RECORD, policy…" />
          <span className="xs muted" aria-live="polite">{term ? `${sections.length} section${sections.length === 1 ? "" : "s"} match` : `${DOC_SECTIONS.length} sections`}</span>
        </div>
        <nav aria-label="Documentation">
          {groups.map((g) => (
            <div key={g} className={styles.group}>
              <span className="eyebrow">{g}</span>
              <ul>
                {sections.filter((s) => s.group === g).map((s) => (
                  <li key={s.id}><a href={`#${s.id}`} aria-current={active === s.id ? "location" : undefined} onClick={(e) => { e.preventDefault(); go(s.id); }}>{s.title}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <article data-article className={styles.article}>
        {sections.length === 0 && <EmptyState title={`Nothing matches “${q}”`}>Try “digest”, “attestation” or “limitations”.</EmptyState>}
        {sections.map((s) => (
          <section key={s.id} id={s.id} data-doc className={styles.section} aria-labelledby={`${s.id}-h`}>
            <span className="eyebrow">{s.group}</span>
            <h2 id={`${s.id}-h`} className={styles.h}><Highlight text={s.title} term={term} /></h2>
            {s.blocks.map((b, i) => <Block key={i} block={b} term={term} />)}
            {s.id === "statuses" && <OverallSimulator />}
          </section>
        ))}
      </article>
    </div>
  );
}

function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const i = text.toLowerCase().indexOf(term);
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className={styles.mark}>{text.slice(i, i + term.length)}</mark>{text.slice(i + term.length)}</>;
}

function Block({ block, term }: { block: DocBlock; term: string }) {
  switch (block.kind) {
    case "p": return <p className={styles.p}><Highlight text={block.text!} term={term} /></p>;
    case "list": return <ul className={styles.list}>{block.items!.map((it) => <li key={it}><Highlight text={it} term={term} /></li>)}</ul>;
    case "callout": return <div className={styles.callout} data-tone={block.tone}><span className="eyebrow">{block.tone === "warn" ? "Important" : "Note"}</span><p><Highlight text={block.text!} term={term} /></p></div>;
    case "code": return <CodeBlock code={block.text!} lang={block.lang} />;
    case "status-table":
      return (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Status meanings</caption>
            <thead><tr><th scope="col">Status</th><th scope="col">Label</th><th scope="col">Meaning</th></tr></thead>
            <tbody>{ALL.map((s) => <tr key={s}><td><StatusPill status={s} /></td><td>{STATUS[s].label}</td><td>{STATUS[s].meaning}</td></tr>)}</tbody>
          </table>
        </div>
      );
  }
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const label = useRef<HTMLSpanElement>(null);
  const { reduced } = useMotion();
  const copy = async () => {
    let ok = true;
    try { await navigator.clipboard.writeText(code); } catch { ok = false; }
    const text = ok ? "Copied" : "Copy failed";
    if (label.current) {
      if (reduced) label.current.textContent = text;
      else gsap.to(label.current, { duration: 0.5, scrambleText: { text, chars: "01" } });
      setTimeout(() => { if (label.current) label.current.textContent = "Copy"; }, 1600);
    }
  };
  return (
    <div className={styles.code}>
      <div className={styles.codeBar}><span className="mono xs muted">{lang ?? "text"}</span><button type="button" className="btn btn--sm btn--ghost" onClick={copy}><span ref={label} aria-live="polite">Copy</span></button></div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

/** Runs the real `deriveOverall` used by the app — not an illustration. */
function OverallSimulator() {
  const [checks, setChecks] = useState<CheckStatus[]>(["pass", "pass", "pass", "pass", "unavailable", "not_configured", "pass", "not_checked"]);
  const names = ["Digest", "Metadata", "RECORD", "Inventory", "Provenance", "Policy", "Consistency", "Source"];
  const overall = deriveOverall(checks.map((status) => ({ status })));
  const cycle = (i: number) => setChecks((xs) => xs.map((s, j) => (j === i ? ALL[(ALL.indexOf(s) + 1) % ALL.length] : s)));
  return (
    <div className={styles.sim}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="eyebrow">Try the verdict logic</span>
        <span className="row"><span className="small muted">Overall</span><StatusPill status={overall} size="lg" /></span>
      </div>
      <p className="xs muted">Click a check to cycle its status. The overall result is computed by the same function the app uses.</p>
      <div className={styles.simGrid}>
        {names.map((n, i) => (
          <button key={n} type="button" className={styles.simBtn} onClick={() => cycle(i)} aria-label={`${n}: ${checks[i]}. Click to change.`}>
            <span className="small">{n}</span><StatusPill status={checks[i]} />
          </button>
        ))}
      </div>
    </div>
  );
}
