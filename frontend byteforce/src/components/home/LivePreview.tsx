"use client";
import { useRef, useState, type FormEvent } from "react";
import type { LogLine, VerificationReport } from "@/lib/api/types";
import { useDataMode } from "@/lib/DataModeProvider";
import { describeError } from "@/lib/api/errors";
import { parseIdentifier } from "@/lib/validation";
import { DEMO_PACKAGE_NAMES } from "@/lib/api/demo/fixtures";
import { statusCounts, STATUS } from "@/lib/status";
import { Terminal } from "@/components/ui/Terminal";
import { StatusPill, DemoTag } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/Button";
import { SplitHeading } from "@/components/ui/SplitHeading";
import styles from "./LivePreview.module.css";

const sys = (message: string, level: LogLine["level"] = "info"): LogLine => ({ t: 0, level, stage: "summary", message });

const HELP = [
  sys("commands:"),
  sys("  verify <name>[==version]   run the pipeline (POST /verify)"),
  sys("  limits                     what a PASS does not mean"),
  sys("  mode                       show data source"),
  sys("  clear                      clear the screen"),
];

/** Interactive terminal wired to the real provider (live backend or labelled demo fixtures). */
export function LivePreview() {
  const { provider, mode } = useDataMode();
  const [lines, setLines] = useState<LogLine[]>([sys("pyverify interactive shell — type `help`"), sys(`try: verify ${DEMO_PACKAGE_NAMES[0]}==2.4.1`, "ok")]);
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const history = useRef<string[]>([]);
  const hIdx = useRef(-1);
  const input = useRef<HTMLInputElement>(null);

  const print = (...l: LogLine[]) => setLines((xs) => [...xs, ...l].slice(-80));

  const run = async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    history.current.unshift(text); hIdx.current = -1;
    print({ t: 0, level: "info", stage: "summary", message: `$ ${text}` });
    const [verb, ...rest] = text.split(/\s+/);
    switch (verb) {
      case "help": print(...HELP); return;
      case "clear": setLines([]); return;
      case "mode": print(sys(mode === "demo" ? "data source: DEMO fixtures (fictional packages, fabricated digests)" : "data source: live backend", mode === "demo" ? "warn" : "ok")); return;
      case "limits":
        print(sys("a valid hash does not prove a package is safe", "warn"), sys("missing provenance is not proof of malice", "warn"), sys("static comparison ≠ reproducible build", "warn"));
        return;
      case "verify": {
        const parsed = parseIdentifier(rest.join(" "));
        if (!parsed.ok) { print(sys(parsed.error, "error")); return; }
        if (!parsed.value.version) { print(sys("include an exact release: verify project==version", "error")); return; }
        setBusy(true);
        print(sys(`→ ${mode === "demo" ? "demo provider" : "POST /api/v1/verify"} ${parsed.value.name}${parsed.value.version ? "==" + parsed.value.version : ""} …`));
        try {
          // The backend needs an exact version and filename: resolve them from release metadata first.
          const version = parsed.value.version;
          const pkg = await provider.getPackage(parsed.value.name, version);
          const files = pkg.releases.find((x) => x.version === version)?.files ?? [];
          const file = parsed.value.filename ?? (files.find((f) => f.filename.endsWith("-none-any.whl")) ?? files.find((f) => f.kind === "wheel") ?? files[0])?.filename;
          if (!version || !file) { print(sys(`no published artifact found for ${parsed.value.name} ${version ?? ""}`, "error")); return; }
          print(sys(`resolved ${file}`));
          const r = await provider.verify({ package: parsed.value.name, version, filename: file });
          setReport(r);
          print(...r.logs);
        } catch (e) {
          const d = describeError(e);
          print(sys(`${d.title}: ${d.body}`, "error"));
        } finally {
          setBusy(false);
          input.current?.focus();
        }
        return;
      }
      default: print(sys(`unknown command: ${verb} — type help`, "warn"));
    }
  };

  const submit = (e: FormEvent) => { e.preventDefault(); const c = cmd; setCmd(""); void run(c); };

  const counts = report ? statusCounts(report.checks) : null;

  return (
    <section className="section" aria-labelledby="preview-title">
      <div className={`container ${styles.grid}`}>
        <div className={styles.copy}>
          <span className="eyebrow">A working shell, not a screenshot</span>
          <SplitHeading id="preview-title" className="h2">Ask the pipeline directly.</SplitHeading>
          <p className="lead">This shell calls the same backend as Verify Studio. {mode === "demo" ? "Demo fixtures are on — results are fictional and labelled." : "If the backend is offline it will say so."}</p>
          <div className={styles.summary} aria-live="polite">
            {report ? (
              <>
                <div className="row">
                  <StatusPill status={report.overall.status} size="lg" />
                  <span className="mono small">{report.package.name}=={report.package.version}</span>
                  {report.source === "demo" && <DemoTag />}
                </div>
                <p className="small muted">{report.overall.headline}</p>
                <ul className={styles.counts}>
                  {(["pass", "warn", "fail", "unavailable", "not_checked"] as const).map((s) => (
                    <li key={s}><StatusPill status={s} label={`${counts![s]}`} /><span className="xs muted">{STATUS[s].label}</span></li>
                  ))}
                </ul>
                <Button href={`/packages/${report.package.name}?version=${report.package.version}`} size="sm">Open the dossier</Button>
              </>
            ) : <p className="small muted">No report yet. Run <code>verify</code> in the shell.</p>}
          </div>
        </div>
        <Terminal
          title="pyverify — interactive"
          lines={lines}
          live
          tag={mode === "demo" ? <DemoTag>Demo</DemoTag> : <span className="mono xs" style={{ color: "var(--mint)" }}>LIVE</span>}
          footer={
            <form onSubmit={submit} className={styles.prompt}>
              <label htmlFor="pv-shell" className="mono small" style={{ color: "var(--uv-300)" }}>$</label>
              <input
                ref={input} id="pv-shell" className={styles.input} value={cmd} disabled={busy} autoComplete="off" spellCheck={false}
                placeholder={busy ? "running…" : "verify kestrel-http==2.4.1"}
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" && history.current.length) { e.preventDefault(); hIdx.current = Math.min(hIdx.current + 1, history.current.length - 1); setCmd(history.current[hIdx.current]); }
                  if (e.key === "ArrowDown") { e.preventDefault(); hIdx.current = Math.max(hIdx.current - 1, -1); setCmd(hIdx.current < 0 ? "" : history.current[hIdx.current]); }
                }}
              />
              <button type="submit" className="btn btn--sm" disabled={busy}>Run</button>
            </form>
          }
        />
      </div>
    </section>
  );
}
