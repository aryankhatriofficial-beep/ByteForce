"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CheckId, VerificationReport } from "@/lib/api/types";
import { useCachedReport, usePackage, useVersionMeta } from "@/lib/useApi";
import { useDataMode } from "@/lib/DataModeProvider";
import { describeError } from "@/lib/api/errors";
import { formatBytes } from "@/lib/hash";
import { buildStages } from "@/lib/evidence";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import { Tabs } from "@/components/ui/Tabs";
import { StatusPill, DemoTag } from "@/components/ui/StatusPill";
import { EvidenceCard } from "@/components/ui/EvidenceCard";
import { HashText } from "@/components/ui/HashText";
import { CopyButton } from "@/components/ui/CopyButton";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, SkeletonBlock } from "@/components/ui/States";
import { Fingerprint } from "@/components/visuals/Fingerprint";
import { PackageAnatomy } from "@/components/visuals/PackageAnatomy";
import { NodeGlyph } from "@/components/evidence/EvidenceMap";
import { ReleaseTimeline } from "./ReleaseTimeline";
import styles from "./Inspector.module.css";

const TABS = [
  { id: "fingerprint", label: "Digest" }, { id: "record", label: "RECORD" }, { id: "inventory", label: "Inventory" },
  { id: "attestation", label: "Attestation" }, { id: "all", label: "All checks" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const TAB_CHECK: Partial<Record<TabId, CheckId>> = { fingerprint: "digest", record: "record", inventory: "inventory", attestation: "provenance" };

export function Inspector({ name }: { name: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const { mode } = useDataMode();
  const version = params.get("version");
  const pkg = usePackage(name, version);
  const meta = useVersionMeta(name, version);
  const report = useCachedReport(name, version ?? undefined);
  const root = useRef<HTMLDivElement>(null);
  const { reduced } = useMotion();

  const selectVersion = (v: string) => router.replace(`/packages/${name}?version=${v}`, { scroll: false });
  const release = pkg.data?.releases.find((r) => r.version === version);
  const files = meta.data?.files.length ? meta.data.files : release?.files ?? [];
  const recent = useMemo(() => (pkg.data ? pkg.data.releases.slice(-24) : []), [pkg.data]);

  // Dossier opening: sheets unfold in sequence once data lands.
  useGSAP(() => {
    if (reduced || !root.current || !pkg.data) return;
    gsap.from(root.current.querySelectorAll("[data-sheet]"), { y: 30, rotateX: -8, transformOrigin: "50% 0%", autoAlpha: 0, stagger: 0.08, duration: 0.7 });
  }, { scope: root, dependencies: [!!pkg.data, reduced] });

  if (!version) return <VersionPrompt name={name} />;
  if (pkg.status === "error") {
    return (
      <ErrorState title={describeError(pkg.error).title} action={<div className="row" style={{ justifyContent: "center" }}><Button onClick={pkg.retry}>Retry</Button><Button href="/packages" variant="ghost">Open another package</Button></div>}>
        {describeError(pkg.error).body}
      </ErrorState>
    );
  }
  if (!pkg.data) return <div className="stack"><SkeletonBlock lines={1} height={90} /><SkeletonBlock lines={4} height={42} /></div>;

  const first = pkg.data.releases[0]?.uploadTime.slice(0, 10);
  const last = pkg.data.releases.at(-1)?.uploadTime.slice(0, 10);

  return (
    <div ref={root} className={styles.wrap}>
      {/* Identity sheet */}
      <section data-sheet className={styles.identity} aria-label="Package identity">
        <dl className={styles.facts}>
          <div><dt>Project</dt><dd className="mono">{pkg.data.name}</dd></div>
          <div><dt>Selected version</dt><dd className="mono">{version ?? "—"}</dd></div>
          <div><dt>Latest on index</dt><dd className="mono">{pkg.data.latestVersion || "—"}</dd></div>
          <div><dt>Releases</dt><dd>{pkg.data.releases.length}{first && <span className="muted small"> · {first} to {last}</span>}</dd></div>
        </dl>
        <p className={styles.source}>
          {pkg.data.source === "pypi" ? <>Release data read from <span className="mono">pypi.org</span>. Public metadata — not verification evidence.</> : <DemoTag>Demo fixture · fictional</DemoTag>}
        </p>
      </section>

      <section data-sheet className={styles.sheet} aria-label="Release timeline">
        <div className={styles.sheetHead}>
          <h2 className={styles.h}>Releases</h2>
          <label className="field" style={{ minWidth: 180 }}>
            <span className="sr-only">Version</span>
            <select className="input" value={version ?? ""} onChange={(e) => selectVersion(e.target.value)}>
              {[...pkg.data.releases].reverse().map((r) => <option key={r.version} value={r.version}>{r.version}{r.yanked ? " (yanked)" : ""}</option>)}
            </select>
          </label>
        </div>
        {recent.length > 1 && <ReleaseTimeline releases={recent} active={version ?? undefined} onSelect={selectVersion} />}
        {pkg.data.releases.length > recent.length && <p className="xs muted">Timeline shows the latest {recent.length} releases; all {pkg.data.releases.length} are in the selector.</p>}
      </section>

      <div className={styles.split}>
        <section data-sheet className={styles.sheet} aria-label="Release metadata">
          <h2 className={styles.h}>Declared metadata · {version}</h2>
          {meta.status === "loading" && <SkeletonBlock lines={4} />}
          {meta.status === "error" && <p className="small">{describeError(meta.error).body}</p>}
          {meta.data && (
            <dl className={styles.kv}>
              <div><dt>Summary</dt><dd>{meta.data.summary ?? "—"}</dd></div>
              <div><dt>Requires-Python</dt><dd className="mono">{meta.data.requiresPython ?? "—"}</dd></div>
              <div><dt>License</dt><dd>{meta.data.license ?? "—"}</dd></div>
              <div><dt>Requires-Dist ({meta.data.requiresDist.length})</dt><dd>{meta.data.requiresDist.length ? <ul className={styles.deps}>{meta.data.requiresDist.map((d) => <li key={d} className="mono">{d}</li>)}</ul> : "none declared"}</dd></div>
            </dl>
          )}
          <p className="xs muted">Declared by the author. Dependencies are listed, not verified.</p>
        </section>

        <section data-sheet className={styles.sheet} aria-label="Published artifacts">
          <h2 className={styles.h}>Published artifacts</h2>
          {files.length === 0 ? <p className="small muted">No files are published for this version.</p> : (
            <ul className={styles.files}>
              {files.map((f) => (
                <li key={f.filename} className={styles.file}>
                  <div className={styles.fileTop}>
                    <span className={styles.kind} data-kind={f.kind}>{f.kind === "wheel" ? "wheel" : "sdist"}</span>
                    <span className="mono small break">{f.filename}</span>
                  </div>
                  <div className={styles.fileMeta}><span className="xs muted">{formatBytes(f.sizeBytes)} · uploaded {f.uploadTime.slice(0, 10)}</span></div>
                  <div className={styles.hashRow}>
                    <span className="xs muted">SHA-256</span>
                    <span className="mono xs break">{f.sha256 || "not published"}</span>
                    {f.sha256 && <CopyButton value={f.sha256} />}
                  </div>
                  <Button size="sm" variant="ghost" href={`/verify?package=${encodeURIComponent(f.filename)}`}>Verify this file</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section data-sheet className={styles.sheet} aria-label="Verification evidence">
        <div className={styles.sheetHead}>
          <h2 className={styles.h}>Verification evidence</h2>
          {report && <div className="row"><StatusPill status={report.overall.status} size="lg" />{report.source === "demo" && <DemoTag />}</div>}
        </div>
        {report ? <Evidence report={report} /> : (
          <EmptyState title="Not verified in this session" action={files[0] ? <Button href={`/verify?package=${encodeURIComponent(name + "==" + version)}`} variant="primary">Verify {version}</Button> : undefined}>
            Evidence appears here only after the backend has checked a file{mode === "demo" ? " (demo fixtures in this session)" : ""}. PyVerify does not show stored or assumed results.
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function VersionPrompt({ name }: { name: string }) {
  const router = useRouter();
  const [version, setVersion] = useState("");
  return <form className="stack" onSubmit={(e) => { e.preventDefault(); if (version.trim()) router.replace(`/packages/${name}?version=${encodeURIComponent(version.trim())}`); }}>
    <p className="small muted">PyVerify release discovery requires an exact version. Enter one to load its published files.</p>
    <label className="field"><span>Exact version</span><input className="input" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. 2.2.1" /></label>
    <Button type="submit" variant="primary" disabled={!version.trim()}>Load release</Button>
  </form>;
}

function Evidence({ report }: { report: VerificationReport }) {
  const [tab, setTab] = useState<TabId>("fingerprint");
  const stages = buildStages(report, { attestationsRequested: true, policySupplied: !!report.policy?.expected });
  return (
    <div className="stack" style={{ gap: "var(--s-5)" }}>
      <p className="small muted">From the {report.source === "demo" ? "demo" : "backend"} report for <span className="mono">{report.artifact.filename}</span>.</p>
      <ol className={styles.stageStrip} aria-label="Evidence stages">
        {stages.map((s) => (
          <li key={s.id} data-status={s.status}><span className={styles.miniGlyph}><NodeGlyph status={s.status} /></span><span className="xs">{s.short}</span></li>
        ))}
      </ol>
      <Tabs
        label="Evidence sections" idPrefix="insp" active={tab} onChange={(id) => setTab(id as TabId)}
        tabs={TABS.map((t) => {
          const c = TAB_CHECK[t.id] && report.checks.find((x) => x.id === TAB_CHECK[t.id]);
          return { id: t.id, label: t.label, badge: c ? <span className={styles.dot} data-status={c.status} aria-label={c.status} /> : undefined };
        })}
      />
      <div role="tabpanel" id={`insp-panel-${tab}`} aria-labelledby={`insp-tab-${tab}`} className={styles.panel} tabIndex={0}>
        <Panel tab={tab} report={report} />
      </div>
    </div>
  );
}

function Panel({ tab, report }: { tab: TabId; report: VerificationReport }) {
  const check = (id: CheckId) => report.checks.find((c) => c.id === id);
  const card = (id: CheckId, open = true) => { const c = check(id); return c ? <EvidenceCard check={c} defaultOpen={open} /> : null; };
  switch (tab) {
    case "all":
      return <div className={styles.cards}>{report.checks.map((c, i) => <EvidenceCard key={c.id} check={c} index={i} defaultOpen={c.status === "fail"} />)}</div>;
    case "fingerprint":
      return (
        <div className={styles.split}>
          <Fingerprint expected={report.artifact.expectedSha256} observed={report.artifact.observedSha256} label={`SHA-256 fingerprint for ${report.artifact.filename}`} />
          <div className="stack">
            <span className="small muted">PyPI published digest</span>
            <div className="row"><HashText value={report.artifact.expectedSha256} className={styles.hash} /><CopyButton value={report.artifact.expectedSha256} /></div>
            <span className="small muted">Digest computed by the backend</span>
            {report.artifact.observedSha256 ? <div className="row"><HashText value={report.artifact.observedSha256} className={styles.hash} /><CopyButton value={report.artifact.observedSha256} /></div> : <StatusPill status="unavailable" label="NOT DOWNLOADED" />}
            {card("digest", false)}
          </div>
        </div>
      );
    case "record": {
      const r = report.record;
      if (!r) return <EmptyState title="No RECORD result">The backend returned no RECORD validation for this artifact{report.artifact.kind === "sdist" ? " (RECORD exists only in wheels)" : ""}.</EmptyState>;
      const groups = [["Hash mismatches", r.hashMismatches], ["Size mismatches", r.sizeMismatches], ["Missing", r.missing], ["Unexpected", r.unexpected], ["Duplicates", r.duplicates]] as const;
      return (
        <div className="stack">
          <div className={styles.meter}>
            <div className={styles.meterBar}><span style={{ width: `${(r.verifiedEntries / Math.max(1, r.totalEntries)) * 100}%` }} /></div>
            <span className="mono small">{r.verifiedEntries} / {r.totalEntries} entries verified</span>
            <StatusPill status={r.status} />
          </div>
          <div className={styles.recordGrid}>
            {groups.map(([label, items]) => (
              <div key={label} className={styles.recordCell} data-bad={items.length > 0}>
                <span className="small muted">{label}</span>
                <strong className={styles.big}>{items.length}</strong>
                {items.map((it) => (
                  <div key={it.path} className="xs">
                    <div className="mono break">{it.path}</div>
                    {it.expected && <div className="mono muted break">declared {it.expected}</div>}
                    {it.observed && <div className="mono break" style={{ color: "var(--red)" }}>observed {it.observed}</div>}
                    {it.detail && <div className="muted">{it.detail}</div>}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {card("record", false)}
        </div>
      );
    }
    case "inventory":
      return report.inventory ? (
        <div className="stack">
          <PackageAnatomy inventory={report.inventory} />
          {report.inventory.truncated && <p className="small" style={{ color: "var(--amber)" }}>Inventory truncated at backend limits.</p>}
          {card("inventory", false)}
        </div>
      ) : <EmptyState title="No inventory returned">The backend returned no archive inventory for this artifact.</EmptyState>;
    case "attestation": {
      const p = report.provenance;
      if (!p) return <EmptyState title="Attestations not evaluated">The backend returned no provenance result.</EmptyState>;
      if (p.absent) return <EmptyState title="No attestation published" action={<Button href="/docs#provenance" size="sm">Why this is not a failure</Button>}>PyPI exposes no PEP 740 provenance for this file. This is missing evidence, not evidence of malice.</EmptyState>;
      return (
        <div className="stack">
          {p.attestations.map((a, i) => (
            <div key={i} className={`card ${styles.att}`}>
              <div className="row"><StatusPill status={a.verified ? "pass" : "fail"} label={a.verified ? "SIGSTORE VERIFIED" : "VERIFICATION FAILED"} /><span className="mono xs muted break">{a.predicateType}</span></div>
              <dl className={styles.kv}>
                <div><dt>Subject</dt><dd className="mono break">{a.subjectName}</dd></div>
                <div><dt>Subject digest</dt><dd className="row"><HashText value={a.subjectSha256} /><CopyButton value={a.subjectSha256} /></dd></div>
                <div><dt>Certificate identity</dt><dd className="mono break">{a.certificateIdentity}</dd></div>
                <div><dt>Issuer</dt><dd className="mono break">{a.certificateIssuer}</dd></div>
                <div><dt>Transparency log</dt><dd className="mono">{a.transparencyLogIndex !== undefined ? `#${a.transparencyLogIndex}` : "—"}</dd></div>
                {a.failureReason && <div><dt>Failure</dt><dd style={{ color: "var(--red)" }}>{a.failureReason}</dd></div>}
              </dl>
            </div>
          ))}
          {card("provenance", false)}
          {card("publisher_policy", false)}
        </div>
      );
    }
  }
}
