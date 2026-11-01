"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import type { LogLine, PackageSummary, PolicyInput, VerificationReport } from "@/lib/api/types";
import { useDataMode } from "@/lib/DataModeProvider";
import { describeError } from "@/lib/api/errors";
import { normalizeName, parseIdentifier, validatePolicy } from "@/lib/validation";
import { DEMO_PACKAGE_NAMES, demoSummaryByName } from "@/lib/api/demo/fixtures";
import { digestsEqual, formatBytes } from "@/lib/hash";
import { cacheReport } from "@/lib/useApi";
import { buildStages, STAGE_COPY, type StageId } from "@/lib/evidence";
import { STATUS } from "@/lib/status";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import { Button } from "@/components/ui/Button";
import { StatusPill, DemoTag } from "@/components/ui/StatusPill";
import { Terminal } from "@/components/ui/Terminal";
import { CopyButton } from "@/components/ui/CopyButton";
import { ErrorState, SkeletonBlock } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { EvidenceMap, type MapPhase } from "@/components/evidence/EvidenceMap";
import { EvidenceDetail } from "@/components/evidence/EvidenceDetail";
import { Dropzone, type LocalFile } from "./Dropzone";
import styles from "./VerifyStudio.module.css";

type Phase = "idle" | "input" | "scanning" | "revealing" | "verdict" | "error";
const PHASES: { id: Phase; label: string }[] = [
  { id: "idle", label: "Ready" }, { id: "input", label: "Select release" }, { id: "scanning", label: "Request" },
  { id: "revealing", label: "Evidence" }, { id: "verdict", label: "Verdict" },
];

export function VerifyStudio() {
  const params = useSearchParams();
  const { provider, mode, connection, apiBaseUrl, recheck, setMode, reportNetworkFailure } = useDataMode();
  const { reduced } = useMotion();
  const toast = useToast();

  // ── form state ─────────────────────────────────────────────
  const initial = parseIdentifier(params.get("package") ?? "");
  const [project, setProject] = useState(initial.ok ? initial.value.name : "");
  const [version, setVersion] = useState(initial.ok ? initial.value.version ?? "" : "");
  const [filename, setFilename] = useState(initial.ok ? initial.value.filename ?? "" : "");
  const [attest, setAttest] = useState(true);
  const [repo, setRepo] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [local, setLocal] = useState<LocalFile | null>(null);
  const [touched, setTouched] = useState(false);

  // ── release metadata (PyPI or demo) ────────────────────────
  const [pkg, setPkg] = useState<PackageSummary | null>(null);
  const [pkgState, setPkgState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [pkgError, setPkgError] = useState<unknown>(null);

  // ── run state ──────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("idle");
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [runCtx, setRunCtx] = useState({ attestationsRequested: true, policySupplied: false });
  const [error, setError] = useState<unknown>(null);
  const [revealed, setRevealed] = useState(0);
  const [selected, setSelected] = useState<StageId>("artifact");
  const [requestLog, setRequestLog] = useState<LogLine[]>([]);
  const abort = useRef<AbortController | null>(null);
  const revealTween = useRef<gsap.core.Tween | null>(null);
  const verdictRef = useRef<HTMLElement>(null);

  const name = normalizeName(project.trim());
  const nameValid = /^([a-z0-9]|[a-z0-9][a-z0-9._-]*[a-z0-9])$/i.test(name);

  // PyVerify discovery is scoped to one exact release; it does not enumerate projects.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!nameValid || !version.trim()) { setPkg(null); setPkgState("idle"); return; }
    const ctrl = new AbortController();
    const id = window.setTimeout(() => {
      setPkgState("loading");
      provider.getPackage(name, version.trim(), ctrl.signal)
        .then((p) => {
          setPkg(p); setPkgState("ok"); setPkgError(null);
        })
        .catch((e) => { if (!ctrl.signal.aborted) { setPkg(null); setPkgState("error"); setPkgError(e); } });
    }, 380);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [name, nameValid, version, provider]);

  const release = pkg?.releases.find((r) => r.version === version) ?? null;
  const files = useMemo(() => release?.files ?? [], [release]);

  // Default the artifact to a pure-Python wheel, then any wheel, then the sdist.
  useEffect(() => {
    if (!files.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilename((f) => (files.some((x) => x.filename === f) ? f : (files.find((x) => x.filename.endsWith("-none-any.whl")) ?? files.find((x) => x.kind === "wheel") ?? files[0]).filename));
  }, [files]);

  const file = files.find((f) => f.filename === filename) ?? null;
  const policyError = validatePolicy(repo, workflow);
  const offline = mode === "live" && connection === "disconnected";
  const busy = phase === "scanning" || phase === "revealing";
  const canRun = nameValid && !!version && !!filename && !!file && pkgState === "ok" && !policyError && !busy;
  const formPhase: Phase = project.trim() ? "input" : "idle";
  const shownPhase: Phase = phase === "idle" || phase === "input" ? formPhase : phase;

  const run = async (e?: FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    if (!canRun) return;
    abort.current?.abort();
    revealTween.current?.kill();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const policy: PolicyInput | undefined = repo.trim() ? { repository: repo.trim(), workflow: workflow.trim() || undefined } : undefined;
    setRunCtx({ attestationsRequested: attest, policySupplied: !!policy });
    setPhase("scanning"); setError(null); setReport(null); setRevealed(0); setSelected("artifact");
    setRequestLog([{ t: 0, level: "info", stage: "fetch", message: `${mode === "demo" ? "demo provider" : `POST ${apiBaseUrl}/api/v1/verify`} · project=${name} version=${version} filename=${filename}${attest ? "" : " · attestations off"}${policy ? ` · policy ${policy.repository}${policy.workflow ? `/${policy.workflow}` : ""}` : ""}` }]);
    try {
      const r = await provider.verify({ package: name, version, filename, verifyAttestations: attest, policy }, ctrl.signal);
      cacheReport(mode, r, policy);
      setReport(r);
      setPhase("revealing");
      const counter = { n: 0 };
      const finish = () => { setRevealed(7); setPhase("verdict"); };
      if (reduced) finish();
      else revealTween.current = gsap.to(counter, { n: 7, duration: 1.6, ease: "none", onUpdate: () => setRevealed(Math.floor(counter.n)), onComplete: finish });
      toast({ tone: r.overall.status === "pass" ? "pass" : r.overall.status === "fail" ? "fail" : "warn", title: `${r.package.name} ${r.package.version}: ${STATUS[r.overall.status].label}`, body: r.source === "demo" ? "Demo fixture — not a real verification." : undefined });
    } catch (err) {
      if (ctrl.signal.aborted) { setPhase("input"); return; }
      reportNetworkFailure(err);
      setError(err); setPhase("error");
    }
  };

  useEffect(() => () => { abort.current?.abort(); revealTween.current?.kill(); }, []);

  // Verdict: masked wipe + status emphasis, once.
  useGSAP(() => {
    if (phase !== "verdict" || reduced || !verdictRef.current) return;
    gsap.timeline()
      .fromTo(verdictRef.current, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.7, ease: "pv.inOut" })
      .from(verdictRef.current.querySelectorAll("[data-v]"), { y: 18, autoAlpha: 0, stagger: 0.06, duration: 0.5 }, 0.35);
  }, { dependencies: [phase] });

  const stages = useMemo(() => (report ? buildStages(report, runCtx) : null), [report, runCtx]);
  const mapPhase: MapPhase = phase === "scanning" ? "scanning" : phase === "revealing" ? "revealing" : phase === "verdict" ? "done" : "idle";
  const selIndex = STAGE_COPY.findIndex((s) => s.id === selected);
  const selStage = stages && (phase === "verdict" || selIndex < revealed) ? stages[selIndex] : null;
  const reasons = stages?.filter((s) => s.status === "fail" || s.status === "warn" || s.status === "unavailable") ?? [];
  const localMatch = local?.sha256 && file?.sha256 ? digestsEqual(local.sha256, file.sha256) : null;

  return (
    <div className={styles.studio}>
      {/* Phase rail */}
      <ol className={styles.phases} aria-label="Verification phase">
        {PHASES.map((p, i) => {
          const at = PHASES.findIndex((x) => x.id === (shownPhase === "error" ? "scanning" : shownPhase));
          return <li key={p.id} data-state={i < at ? "done" : i === at ? (shownPhase === "error" ? "error" : "current") : "todo"} aria-current={i === at ? "step" : undefined}><span>{p.label}</span></li>;
        })}
      </ol>

      <div className={styles.grid}>
        <form className={styles.form} onSubmit={run} noValidate>
          <div className={styles.formHead}>
            <h2 className={styles.h}>Target artifact</h2>
            {mode === "demo" && <DemoTag>Demo fixtures</DemoTag>}
          </div>

          <div className="field">
            <label htmlFor="project">Project</label>
            <input
              id="project" className={`input ${styles.big}`} value={project} autoComplete="off" spellCheck={false} placeholder={mode === "demo" ? "kestrel-http" : "e.g. sampleproject"}
              aria-invalid={touched && !nameValid} aria-describedby="project-help"
              onChange={(e) => {
                const v = e.target.value;
                const p = parseIdentifier(v);
                if (p.ok && (p.value.version || p.value.filename)) { setProject(p.value.name); setVersion(p.value.version ?? ""); if (p.value.filename) setFilename(p.value.filename); }
                else setProject(v);
              }}
              onBlur={() => setTouched(true)}
            />
            <p id="project-help" className="field-hint">{mode === "demo" ? "Fictional fixtures only in demo mode." : "PyPI project name. Paste name==version or a wheel filename to fill everything."}</p>
            {touched && project && !nameValid && <p className="field-error" role="alert">That is not a valid PyPI project name.</p>}
            {mode === "demo" && (
              <div className={styles.examples}>{DEMO_PACKAGE_NAMES.map((n) => <button key={n} type="button" className="chip" aria-pressed={name === n} onClick={() => { setProject(n); const v = demoSummaryByName(n)?.latestVersion; if (v) setVersion(v); }}>{n}</button>)}</div>
            )}
          </div>

          {mode === "live" && <div className="field">
            <label htmlFor="version">Exact version</label>
            <input id="version" className="input" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. 2.2.1" autoComplete="off" />
            <p className="field-hint">PyVerify lists files for this version; it does not enumerate all project releases.</p>
          </div>}

          <div className={styles.releaseBox} data-state={pkgState}>
            {pkgState === "idle" && <p className="small muted">Enter a project and exact version to load its published files from PyVerify.</p>}
            {pkgState === "loading" && <SkeletonBlock lines={2} height={44} />}
            {pkgState === "error" && <p className="small" role="alert"><strong>{describeError(pkgError).title}.</strong> {describeError(pkgError).body}</p>}
            {pkgState === "ok" && pkg && (
              <>
                <div className={styles.two}>
                  {mode === "demo" && <div className="field"><label htmlFor="version">Version</label><select id="version" className="input" value={version} onChange={(e) => setVersion(e.target.value)}>{pkg.releases.map((r) => <option key={r.version} value={r.version}>{r.version}</option>)}</select></div>}
                  <div className="field">
                    <label htmlFor="filename">Artifact</label>
                    <select id="filename" className="input" value={filename} onChange={(e) => setFilename(e.target.value)} disabled={!files.length}>
                      {files.map((f) => <option key={f.filename} value={f.filename}>{f.filename}</option>)}
                    </select>
                  </div>
                </div>
                {file && (
                  <div className={styles.fileMeta}>
                    <span className="xs muted">{file.kind === "wheel" ? "Wheel" : file.kind === "sdist" ? "Source distribution" : "Other artifact"} · {formatBytes(file.sizeBytes)} · published SHA-256</span>
                    <span className={`mono xs break ${styles.hash}`}>{file.sha256 || "not published"}</span>
                    {file.sha256 && <CopyButton value={file.sha256} />}
                    <span className="xs muted">{pkg.source === "pypi" ? "From PyVerify release metadata — public digest, not yet verified." : "Demo fixture — fictional digest."}</span>
                  </div>
                )}
              </>
            )}
          </div>

          <fieldset className={styles.options}>
            <legend className={styles.legend}>Evidence options</legend>
            <label className="toggle"><input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} /> Verify PEP 740 attestations</label>
            <div className={styles.two}>
              <div className="field">
                <label htmlFor="repo">Expected publisher repository</label>
                <input id="repo" className="input" placeholder="owner/name" value={repo} onChange={(e) => setRepo(e.target.value)} aria-invalid={!!policyError && !!repo} autoComplete="off" spellCheck={false} />
              </div>
              <div className="field">
                <label htmlFor="wf">Workflow filename</label>
                <input id="wf" className="input" placeholder="release.yml" value={workflow} onChange={(e) => setWorkflow(e.target.value)} autoComplete="off" spellCheck={false} />
              </div>
            </div>
            {policyError ? <p className="field-error" role="alert">{policyError}</p> : <p className="field-hint">Optional. Compared with the verified signing identity — repository and workflow filename only.</p>}
          </fieldset>

          <details className={styles.localBox}>
            <summary>Compare a local copy (stays on this device)</summary>
            <Dropzone value={local} onChange={setLocal} />
            {local?.sha256 && file?.sha256 && (
              <p className="small" role="status"><StatusPill status={localMatch ? "pass" : "fail"} label={localMatch ? "MATCHES PYPI" : "DIFFERS FROM PYPI"} /> Local SHA-256 vs the published digest of {file.filename}.</p>
            )}
          </details>

          {offline && (
            <div className={styles.offline} role="alert">
              <p className="small"><strong>Backend offline.</strong> {apiBaseUrl} is not answering, so nothing can be verified right now.</p>
              <div className="row"><Button size="sm" onClick={recheck}>Retry connection</Button><Button size="sm" variant="ghost" onClick={() => setMode("demo")}>Use demo fixtures</Button></div>
            </div>
          )}

          <div className="row">
            <Button type="submit" variant="primary" magnetic disabled={!canRun} aria-disabled={!canRun}>{busy ? "Verifying" : "Verify artifact"}</Button>
            {phase === "scanning" && <Button variant="ghost" onClick={() => abort.current?.abort()}>Cancel</Button>}
          </div>
          <p className="xs muted">Nothing is installed or executed. The backend downloads the published file within a size limit and inspects it statically.</p>
        </form>

        <section className={styles.bench} aria-labelledby="bench-title">
          <header className={styles.benchHead}>
            <h2 id="bench-title" className={styles.h}>Evidence map</h2>
            <p className="small muted" aria-live="polite">
              {shownPhase === "idle" && "Seven stages, from the published file to its source. Choose a target to begin."}
              {shownPhase === "input" && (canRun ? "Ready. Each stage fills in only from the backend's report." : "Pick a version and artifact.")}
              {shownPhase === "scanning" && (mode === "demo" ? "Demo provider — simulated latency. No stage is reported until the response arrives." : "Request sent. Waiting for the backend — stages are not reported until it answers.")}
              {shownPhase === "revealing" && "Response received. Revealing the backend's evidence, stage by stage."}
              {shownPhase === "verdict" && `Verdict: ${report ? STATUS[report.overall.status].label : ""}.`}
              {shownPhase === "error" && "The request failed. Nothing was verified."}
            </p>
          </header>
          <EvidenceMap stages={stages} phase={mapPhase} revealed={revealed} selected={selected} onSelect={setSelected} />
          {phase === "error" ? (
            <ErrorState title={describeError(error).title} action={<div className="row" style={{ justifyContent: "center" }}><Button onClick={() => run()}>Retry</Button>{offline && <Button variant="ghost" onClick={recheck}>Re-check backend</Button>}</div>}>
              {describeError(error).body}
            </ErrorState>
          ) : (
            <EvidenceDetail stage={selStage} index={selIndex} waiting={phase === "scanning" || phase === "revealing"} />
          )}
        </section>
      </div>

      {report && phase === "verdict" && (
        <section ref={verdictRef} className={styles.verdict} data-status={report.overall.status} aria-labelledby="verdict-title">
          <div className={styles.vMain}>
            <div data-v className="row">
              <StatusPill status={report.overall.status} size="lg" label={STATUS[report.overall.status].label.toUpperCase()} />
              {report.source === "demo" && <DemoTag />}
            </div>
            <h2 id="verdict-title" data-v className={styles.vTitle}>{report.package.name} <span className="muted">{report.package.version}</span></h2>
            <p data-v className="lead">{report.overall.headline}</p>
            <p data-v className={styles.disclaim}>A verdict covers integrity and provenance evidence. It is not a statement that the code is safe to run.</p>
          </div>
          <div className={styles.vSide}>
            <h3 data-v className={styles.h}>{reasons.length ? "Why" : "Every evaluated stage verified"}</h3>
            <ul className={styles.reasons}>
              {reasons.map((s) => (
                <li key={s.id} data-v><button type="button" onClick={() => setSelected(s.id)}><StatusPill status={s.status} /> <span><strong>{s.title}.</strong> {s.summary}</span></button></li>
              ))}
              {stages?.filter((s) => !STATUS[s.status].evaluated && s.status !== "unavailable").map((s) => (
                <li key={s.id} data-v className={styles.quiet}><StatusPill status={s.status} /> <span>{s.title}: {STATUS[s.status].label.toLowerCase()}.</span></li>
              ))}
            </ul>
            <div data-v className="row">
              <Button href={`/packages/${report.package.name}?version=${report.package.version}`} size="sm">Open dossier</Button>
              <Button href={`/provenance?package=${report.package.name}&version=${report.package.version}`} size="sm" variant="ghost">Provenance</Button>
            </div>
          </div>
        </section>
      )}

      {(report || requestLog.length > 0) && (
        <details className={styles.logBox} open={phase === "scanning"}>
          <summary>Backend log{report?.raw ? " and raw response" : ""}</summary>
          <Terminal title="verify.log" lines={report ? [...requestLog, ...report.logs] : requestLog} live={busy} tag={mode === "demo" ? <DemoTag>Demo</DemoTag> : null} />
          {report?.raw !== undefined && (
            <details className={styles.raw}><summary>Raw backend response (unmodified)</summary><pre>{JSON.stringify(report.raw, null, 2)}</pre></details>
          )}
        </details>
      )}
    </div>
  );
}
