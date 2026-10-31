"use client";
import { useState, type FormEvent } from "react";
import { DEMO_PACKAGE_NAMES, demoSummaryByName } from "@/lib/api/demo/fixtures";
import { parseIdentifier } from "@/lib/validation";
import { useDataMode } from "@/lib/DataModeProvider";
import { usePageTransition } from "@/components/layout/PageTransition";
import { TransitionLink } from "@/components/layout/PageTransition";
import { Button } from "@/components/ui/Button";
import { DemoTag } from "@/components/ui/StatusPill";
import styles from "./PackageIndex.module.css";

export function PackageIndex() {
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const { navigate } = usePageTransition();
  const { mode } = useDataMode();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = parseIdentifier(q);
    if (!p.ok) { setErr(p.error); return; }
    if (mode === "live" && !p.value.version) { setErr("Enter an exact release as project==version; PyVerify does not enumerate all releases."); return; }
    navigate(`/packages/${p.value.name}${p.value.version ? `?version=${p.value.version}` : ""}`);
  };

  return (
    <div className="stack" style={{ gap: "var(--s-7)" }}>
      <form onSubmit={submit} className={styles.search} role="search">
        <label htmlFor="pkg-q" className="sr-only">Package name</label>
        <input id="pkg-q" className="input" value={q} onChange={(e) => { setQ(e.target.value); setErr(null); }} placeholder={mode === "demo" ? "kestrel-http" : "e.g. sampleproject"} aria-invalid={!!err} aria-describedby="pkg-err" />
        <Button type="submit" variant="primary">Open dossier</Button>
        {err && <p id="pkg-err" className="field-error" role="alert">{err}</p>}
      </form>
      {mode === "live" && <p className="small muted">Load one exact project release through PyVerify with a value such as project==2.2.1. Verification evidence appears only after you verify a file.</p>}
      {mode === "demo" && <div>
        <div className="row" style={{ marginBottom: "var(--s-4)" }}>
          <span className="eyebrow">Demo fixtures</span>
          <DemoTag outline>fictional</DemoTag>
        </div>
        <ul className={styles.grid}>
          {DEMO_PACKAGE_NAMES.map((n) => {
            const s = demoSummaryByName(n)!;
            return (
              <li key={n}>
                <TransitionLink href={`/packages/${n}`} className={styles.tile}>
                                    <strong className={styles.name}>{n}</strong>
                  <span className="small muted">{s.summary}</span>
                  <span className={styles.versions}>{s.releases.map((r) => <span key={r.version} className="chip">{r.version}</span>)}</span>
                </TransitionLink>
              </li>
            );
          })}
        </ul>
      </div>}
    </div>
  );
}
