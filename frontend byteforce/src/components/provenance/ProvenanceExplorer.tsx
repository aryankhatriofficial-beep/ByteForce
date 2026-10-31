"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CheckStatus, SourceTraceResponse, VerificationReport } from "@/lib/api/types";
import { useCachedReport, usePackage, useReport } from "@/lib/useApi";
import { useDataMode } from "@/lib/DataModeProvider";
import { describeError } from "@/lib/api/errors";
import { DEMO_PACKAGE_NAMES } from "@/lib/api/demo/fixtures";
import { normalizeName } from "@/lib/validation";
import { STATUS } from "@/lib/status";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/motion/gsap";
import "@/lib/motion/gsap-extra";
import { useMotion } from "@/lib/motion/MotionProvider";
import { StatusPill, DemoTag } from "@/components/ui/StatusPill";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { TrustGraph } from "./TrustGraph";
import styles from "./ProvenanceExplorer.module.css";

interface ChainNode { id: string; title: string; subtitle: string; status: CheckStatus; facts: [string, string][]; note: string }

const SHAPES: Record<CheckStatus, string> = {
  pass: "M0,-22 A22,22 0 1,1 0,22 A22,22 0 1,1 0,-22Z",
  warn: "M0,-24 L24,0 L0,24 L-24,0Z",
  unavailable: "M-20,-20 L20,-20 L20,20 L-20,20Z",
  not_checked: "M0,-20 A20,20 0 1,1 0,20 A20,20 0 1,1 0,-20Z",
  not_applicable: "M-22,-4 L22,-4 L22,4 L-22,4Z",
  not_configured: "M0,-22 L22,0 L0,22 L-22,0Z",
  fail: "M-8,-24 L8,-24 L8,-8 L24,-8 L24,8 L8,8 L8,24 L-8,24 L-8,8 L-24,8 L-24,-8 L-8,-8Z",
};

export function buildChain(r: VerificationReport): ChainNode[] {
  const att = r.provenance?.attestations[0];
  const pub = r.provenance?.publisher;
  const digest = r.checks.find((c) => c.id === "digest");
  const st = r.sourceTrace;
  const pol = r.policy;
  return [
    {
      id: "pypi", title: "PyPI artifact", subtitle: r.artifact.filename, status: digest?.status ?? "unavailable",
      facts: [["SHA-256", r.artifact.expectedSha256.slice(0, 24) + "…"], ["Observed", r.artifact.observedSha256 ? r.artifact.observedSha256.slice(0, 24) + "…" : "not downloaded"]],
      note: "The anchor: every later link is only meaningful if these bytes match PyPI's digest.",
    },
    {
      id: "attestation", title: "PEP 740 attestation", subtitle: att?.predicateType.split("/").slice(-2).join("/") ?? (r.provenance?.absent ? "none published" : "not evaluated"),
      status: r.provenance?.status ?? "unavailable",
      facts: att ? [["Subject digest", att.subjectSha256.slice(0, 24) + "…"], ["Rekor index", att.transparencyLogIndex !== undefined ? `#${att.transparencyLogIndex}` : "—"], ["Sigstore", att.verified ? "verified" : att.failureReason ?? "failed"]] : [["Attestations", "0"]],
      note: r.provenance?.absent ? "No provenance was published. That is missing evidence — not evidence of malice." : "Signature, certificate chain and transparency-log inclusion verified against the artifact digest.",
    },
    {
      id: "publisher", title: "Trusted publisher", subtitle: pub ? `${pub.kind} · ${pub.workflow ?? "workflow unknown"}` : "unknown",
      status: pol && pol.status !== "not_configured" ? pol.status : pub && r.provenance?.status === "pass" ? "pass" : "unavailable",
      facts: [["Identity", att?.certificateIdentity.replace("https://github.com/", "") ?? "—"], ["Issuer", att?.certificateIssuer.replace("https://", "") ?? "—"], ["Policy", pol ? STATUS[pol.status].label : "—"]],
      note: pol?.status === "not_configured" || !pol ? "No trust policy was supplied — add one in Verify Studio to constrain repository and workflow." : pol?.notes[0] ?? "Identity comes from the Fulcio certificate in the verified attestation.",
    },
    {
      id: "repository", title: "Source repository", subtitle: pub?.repository ?? st?.repository?.replace("https://github.com/", "") ?? "unresolved",
      status: pub?.repository && r.provenance?.status === "pass" ? (pol?.repositoryMatch === false ? "fail" : "pass") : "unavailable",
      facts: [["Repository", pub?.repository ?? "—"], ["Expected", pol?.expected?.repository ?? "not constrained"]],
      note: "Repository identity is asserted by the CI provider's OIDC token and bound into the signing certificate.",
    },
    {
      id: "commit", title: "Pinned commit", subtitle: st?.commit ? st.commit.slice(0, 12) : "not resolved",
      status: st?.commit ? st.status : "not_checked",
      facts: st?.commit ? [["Commit", st.commit.slice(0, 20) + "…"], ["Ref", st.ref ?? "—"]] : [["Status", "Source trace has not run"]],
      note: "A commit is only resolved by the separate source-trace workflow, from a verified SLSA Provenance v1 predicate. It is not part of a standard verification.",
    },
    {
      id: "snapshot", title: "Source snapshot", subtitle: st?.commit ? `${st.matched} files compared` : "not compared",
      status: st?.commit ? st.status : "not_checked",
      facts: st?.commit ? [["Matched files", String(st.matched)], ["Differing", String(st.differing.length)], ["Missing in source", String(st.missingInSource.length)]] : [["Status", "Not checked"]],
      note: "A match covers the compared Python files at that commit — not a full source-to-binary guarantee or a reproducible build.",
    },
  ];
}

export function ProvenanceExplorer() {
  const params = useSearchParams();
  const router = useRouter();
  const { mode } = useDataMode();
  const name = normalizeName(params.get("package") ?? (mode === "demo" ? DEMO_PACKAGE_NAMES[0] : ""));
  const version = params.get("version") ?? undefined;
  const pkg = usePackage(name || null, version);
  const cached = useCachedReport(name, version);
  const [runFor, setRunFor] = useState<string | null>(null);
  const runKey = `${name}@${version}`;
  const release = pkg.data?.releases.find((r) => r.version === version);
  const file = (release?.files.find((f) => f.filename.endsWith("-none-any.whl")) ?? release?.files.find((f) => f.kind === "wheel") ?? release?.files[0])?.filename;
  const rep = useReport(runFor === runKey && !cached ? name : null, version, undefined, file);
  const report = cached ?? rep.data;
  const [draft, setDraft] = useState(name);
  const [versionDraft, setVersionDraft] = useState(version ?? "");
  const [trace, setTrace] = useState<SourceTraceResponse | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceBusy, setTraceBusy] = useState(false);
  const { provider } = useDataMode();
  const wheel = release?.files.find((f) => f.kind === "wheel");
  const sdist = release?.files.find((f) => f.filename.toLowerCase().endsWith(".tar.gz"));
  const runTrace = async () => {
    if (!wheel || !sdist || !version) return;
    setTraceBusy(true); setTrace(null); setTraceError(null);
    try {
      setTrace(await provider.sourceTrace({ project: name, version, wheelFilename: wheel.filename, sdistFilename: sdist.filename, attestedFilename: file ?? wheel.filename }));
    } catch (e) { setTraceError(describeError(e).body); }
    finally { setTraceBusy(false); }
  };

  return (
    <div className="stack" style={{ gap: "var(--s-6)" }}>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (draft.trim() && versionDraft.trim()) { setTrace(null); router.replace(`/provenance?package=${encodeURIComponent(normalizeName(draft.trim()))}&version=${encodeURIComponent(versionDraft.trim())}`, { scroll: false }); } }}>
        <label htmlFor="prov-q" className="sr-only">Project</label>
        <input id="prov-q" className="input" style={{ maxWidth: 360 }} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Project name" autoComplete="off" spellCheck={false} />
        <label className="field"><span className="sr-only">Exact version</span><input className="input" value={versionDraft} onChange={(e) => setVersionDraft(e.target.value)} placeholder="Exact version" /></label>
        <Button type="submit">Load release</Button>
      {mode === "demo" && <>
          <span className="xs muted">Demo scenarios:</span>
          {DEMO_PACKAGE_NAMES.map((n) => (
            <button key={n} type="button" className="chip" aria-pressed={n === name} onClick={() => { const v = "2.4.1"; setDraft(n); setVersionDraft(v); router.replace(`/provenance?package=${n}&version=${v}`, { scroll: false }); }}>{n}</button>
          ))}
          <DemoTag>Demo fixtures</DemoTag>
        </>}
      </form>
      {!name && <EmptyState title="Choose a project">Enter a project and exact version; PyVerify release discovery is version scoped.</EmptyState>}
      {name && !version && <EmptyState title="Enter an exact release">The source-trace workflow needs exact wheel and sdist filenames from one release.</EmptyState>}
      {pkg.status === "error" && <ErrorState title={describeError(pkg.error).title} action={<Button onClick={pkg.retry}>Retry</Button>}>{describeError(pkg.error).body}</ErrorState>}
      {name && pkg.status === "loading" && !report && <LoadingState label="Loading release…" />}
      {pkg.data && !report && runFor !== runKey && (
        <EmptyState title={`No evidence for ${name} ${version ?? ""} yet`} action={file ? <Button variant="primary" onClick={() => setRunFor(runKey)}>Verify {file}</Button> : undefined}>
          The provenance chain is drawn only from a real verification report. Nothing is assumed.
        </EmptyState>
      )}
      {runFor === runKey && !report && (rep.status === "error"
        ? <ErrorState title={describeError(rep.error).title} action={<Button onClick={rep.retry}>Retry</Button>}>{describeError(rep.error).body}</ErrorState>
        : <LoadingState label="Waiting for the backend report…" />)}
      {report && <Journey key={report.reportId} report={report} />}
      {pkg.data && <section className="stack" aria-labelledby="trace-title">
        <h2 id="trace-title">Separate source trace</h2>
        <p className="small muted">Requires an exact wheel and .tar.gz source distribution from this release. Backend comparison is static evidence; it does not prove reproducible builds.</p>
        {(!wheel || !sdist) ? <p className="small muted">This release does not include both a wheel and a .tar.gz sdist, so source trace cannot run.</p> : <Button onClick={runTrace} disabled={traceBusy}>{traceBusy ? "Tracing source…" : "Run source trace"}</Button>}
        {traceError && <ErrorState title="Source trace unavailable">{traceError}</ErrorState>}
        {trace && <div className="stack"><StatusPill status={trace.verdict.status === "PASS" ? "pass" : trace.verdict.status === "FAIL" ? "fail" : "warn"} label={`BACKEND VERDICT · ${trace.verdict.status}`} /><pre className="mono small" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify({ source_trace: trace.source_trace, artifacts: trace.artifacts, evidence: trace.evidence, verdict: trace.verdict }, null, 2)}</pre></div>}
      </section>}
    </div>
  );
}

function Journey({ report }: { report: VerificationReport }) {
  const chain = useMemo(() => buildChain(report), [report]);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const { reduced } = useMotion();

  useGSAP(() => {
    if (!root.current) return;
    const path = root.current.querySelector("[data-path]");
    const nodes = gsap.utils.toArray<SVGGElement>("[data-node]", root.current);
    // morph each node into its status shape
    nodes.forEach((n, i) => {
      const shape = n.querySelector("[data-shape]");
      if (reduced) gsap.set(shape, { morphSVG: SHAPES[chain[i].status] });
      else gsap.to(shape, { morphSVG: SHAPES[chain[i].status], duration: 1, delay: 0.3 + i * 0.12, ease: "elastic.out(1, 0.6)" });
    });
    if (reduced) { gsap.set(path, { drawSVG: "100%" }); return; }

    const mm = gsap.matchMedia();
    mm.add("(min-width: 900px)", () => {
      const tl = gsap.timeline();
      tl.fromTo(path, { drawSVG: "0%" }, { drawSVG: "100%", ease: "none", duration: chain.length });
      nodes.forEach((n, i) => tl.fromTo(n, { opacity: 0.25 }, { opacity: 1, duration: 0.3 }, i * 0.95));
      ScrollTrigger.create({
        trigger: root.current, start: "top top", end: `+=${chain.length * 70}%`, pin: true, pinSpacing: true, scrub: 0.6, animation: tl,
        onUpdate: (s) => setActive(Math.min(chain.length - 1, Math.floor(s.progress * chain.length))),
      });
    });
    mm.add("(max-width: 899px)", () => { gsap.fromTo(path, { drawSVG: "0%" }, { drawSVG: "100%", duration: 2 }); });
    return () => mm.revert();
  }, { scope: root, dependencies: [report.reportId, reduced], revertOnUpdate: true });

  const n = chain[active];
  const xs = chain.map((_, i) => 70 + i * 172);
  const ys = [120, 60, 150, 70, 130, 80];
  const d = xs.map((x, i) => (i === 0 ? `M${x},${ys[i]}` : `C${xs[i - 1] + 105},${ys[i - 1]} ${x - 105},${ys[i]} ${x},${ys[i]}`)).join(" ");
  const breakAt = chain.findIndex((c) => c.status !== "pass");

  return (
    <>
      <div ref={root} className={styles.journey}>
        <div className={styles.svgWrap}>
          <svg viewBox="0 0 1000 220" className={styles.svg} role="img" aria-label={`Provenance chain for ${report.package.name} ${report.package.version}: ${chain.map((c) => `${c.title} ${c.status}`).join(", ")}`}>
            <defs>
              <linearGradient id="pv-chain" x1="0" x2="1"><stop offset="0" stopColor="#eef3ff" /><stop offset="0.5" stopColor="#9d85ff" /><stop offset="1" stopColor="#ff4fd8" /></linearGradient>
            </defs>
            <path d={d} fill="none" stroke="var(--line)" strokeWidth="2" strokeDasharray="4 8" />
            <path data-path d={d} fill="none" stroke="url(#pv-chain)" strokeWidth="2.5" strokeLinecap="round" />
            {chain.map((c, i) => (
              <g key={c.id} data-node transform={`translate(${xs[i]} ${ys[i]})`} className={styles.node} data-status={c.status} data-active={i === active}>
                <circle r="38" className={styles.halo} />
                <path data-shape d={SHAPES.pass} className={styles.shape} />
                <text y="62" textAnchor="middle" className={styles.label}>{c.title}</text>
                <text y="78" textAnchor="middle" className={styles.sub}>{STATUS[c.status].short}</text>
              </g>
            ))}
          </svg>
        </div>
        <div className={styles.steps} role="tablist" aria-label="Chain links">
          {chain.map((c, i) => (
            <button key={c.id} role="tab" type="button" aria-selected={i === active} className={styles.step} data-status={c.status} onClick={() => setActive(i)}>
              <span className="mono xs">{String(i + 1).padStart(2, "0")}</span>
              <span>{c.title}</span>
              <StatusPill status={c.status} />
            </button>
          ))}
        </div>
        <article className={`card card--glass hairline-corners ${styles.detail}`} role="tabpanel" aria-live="polite">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 className="h3">{n.title}</h3>
            <StatusPill status={n.status} size="lg" />
          </div>
          <p className="mono small muted break">{n.subtitle}</p>
          <dl className={styles.facts}>{n.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono break">{v}</dd></div>)}</dl>
          <p className="small">{n.note}</p>
          {breakAt >= 0 && <p className={styles.break}>Chain evidence stops being fully verified at link {breakAt + 1} ({chain[breakAt].title}: {STATUS[chain[breakAt].status].label.toLowerCase()}).</p>}
        </article>
      </div>
      <section className="stack" aria-labelledby="graph-title">
        <span className="eyebrow">Evidence graph</span>
        <h2 id="graph-title" className="h3">Every entity in this report, and how it is bound.</h2>
        <p className="small muted">Built only from fields present in the report. Drag nodes to untangle; edges show the binding relation. Missing entities are not drawn.</p>
        <TrustGraph report={report} />
      </section>
    </>
  );
}
