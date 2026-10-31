"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { InventoryEntry, PackageRelease, VersionMetadata } from "@/lib/api/types";
import { useDataMode } from "@/lib/DataModeProvider";
import { useCachedReport, usePackage, useReport, useVersionMeta } from "@/lib/useApi";
import { describeError } from "@/lib/api/errors";
import { diffCounts, diffInventories, type DiffRow, type DiffState } from "@/lib/diff";
import { formatBytes } from "@/lib/hash";
import { DEMO_PACKAGE_NAMES } from "@/lib/api/demo/fixtures";
import { normalizeName } from "@/lib/validation";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { Flip } from "@/lib/motion/gsap-extra";
import { useMotion } from "@/lib/motion/MotionProvider";
import { ReleaseTimeline } from "@/components/inspector/ReleaseTimeline";
import { StatusPill, DemoTag } from "@/components/ui/StatusPill";
import { EmptyState, ErrorState, LoadingState, SkeletonBlock } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import styles from "./CompareView.module.css";

const FILTERS: (DiffState | "all")[] = ["all", "added", "removed", "changed", "unchanged"];
const pickFile = (r?: PackageRelease) => (r?.files.find((f) => f.filename.endsWith("-none-any.whl")) ?? r?.files.find((f) => f.kind === "wheel") ?? r?.files[0])?.filename;

export function CompareView() {
  const params = useSearchParams();
  const router = useRouter();
  const { mode } = useDataMode();
  const [draft, setDraft] = useState(params.get("package") ?? (mode === "demo" ? DEMO_PACKAGE_NAMES[0] : ""));
  const name = normalizeName((params.get("package") ?? "").trim());
  const [slot, setSlot] = useState<"a" | "b">("a");
  const pkg = usePackage(name || null);

  const sorted = pkg.data?.releases ?? [];
  const a = params.get("a") ?? sorted.at(-2)?.version ?? sorted.at(-1)?.version;
  const b = params.get("b") ?? sorted.at(-1)?.version;
  const recent = sorted.slice(-24);

  const setParam = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    Object.entries(patch).forEach(([k, v]) => next.set(k, v));
    router.replace(`/compare?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="stack" style={{ gap: "var(--s-6)" }}>
      <form className={styles.controls} onSubmit={(e) => { e.preventDefault(); if (draft.trim()) router.replace(`/compare?package=${encodeURIComponent(normalizeName(draft.trim()))}`, { scroll: false }); }}>
        <div className="field" style={{ flex: "1 1 260px" }}>
          <label htmlFor="cmp-pkg">Project</label>
          <input id="cmp-pkg" className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={mode === "demo" ? "kestrel-http" : "e.g. sampleproject"} autoComplete="off" spellCheck={false} />
        </div>
        <Button type="submit">Load releases</Button>
        {mode === "demo" && <div className="row">{DEMO_PACKAGE_NAMES.map((n) => <button key={n} type="button" className="chip" aria-pressed={n === name} onClick={() => { setDraft(n); router.replace(`/compare?package=${n}`, { scroll: false }); }}>{n}</button>)}<DemoTag>Demo</DemoTag></div>}
      </form>

      {!name && <EmptyState title="Choose a project">Enter a PyPI project to compare two of its releases.</EmptyState>}
      {name && pkg.status === "loading" && <LoadingState label="Loading releases…" />}
      {pkg.status === "error" && <ErrorState title={describeError(pkg.error).title} action={<Button onClick={pkg.retry}>Retry</Button>}>{describeError(pkg.error).body}</ErrorState>}
      {pkg.data && sorted.length < 2 && <EmptyState title="Only one release">There is nothing to compare yet.</EmptyState>}

      {pkg.data && a && b && sorted.length >= 2 && (
        <>
          <section className={styles.picker}>
            <div className={styles.selects}>
              <div className="field"><label htmlFor="ver-a">Release A (before)</label>
                <select id="ver-a" className="input" value={a} onChange={(e) => setParam({ a: e.target.value })}>{[...sorted].reverse().map((r) => <option key={r.version}>{r.version}</option>)}</select></div>
              <button type="button" className={styles.swap} onClick={() => setParam({ a: b, b: a })} aria-label="Swap A and B" data-cursor="Swap">⇄</button>
              <div className="field"><label htmlFor="ver-b">Release B (after)</label>
                <select id="ver-b" className="input" value={b} onChange={(e) => setParam({ b: e.target.value })}>{[...sorted].reverse().map((r) => <option key={r.version}>{r.version}</option>)}</select></div>
            </div>
            {recent.length > 1 && (
              <>
                <div className="row" role="radiogroup" aria-label="Which side the timeline sets">
                  <span className="xs muted">Timeline sets:</span>
                  <button type="button" role="radio" aria-checked={slot === "a"} className="chip" onClick={() => setSlot("a")}>A · {a}</button>
                  <button type="button" role="radio" aria-checked={slot === "b"} className="chip" onClick={() => setSlot("b")}>B · {b}</button>
                </div>
                <ReleaseTimeline releases={recent} active={b} secondary={a} onSelect={(v) => setParam(slot === "a" ? { a: v } : { b: v })} />
              </>
            )}
          </section>

          <MetadataDiff key={`${a}-${b}`} name={name} a={a} b={b} />
          <InventorySection key={`inv-${a}-${b}`} name={name} a={a} b={b} fileA={pickFile(sorted.find((r) => r.version === a))} fileB={pickFile(sorted.find((r) => r.version === b))} />

          <aside className={styles.scope} role="note">
            <strong>Scope of this comparison.</strong> Declared metadata comes from PyPI. File differences are derived from the backend&apos;s archive inventories
            (RECORD hashes, or sizes when no hash is known). It is a static comparison: it does not rebuild anything and does not verify reproducible builds.
          </aside>
        </>
      )}
    </div>
  );
}

function MetadataDiff({ name, a, b }: { name: string; a: string; b: string }) {
  const ma = useVersionMeta(name, a);
  const mb = useVersionMeta(name, b);
  const root = useRef<HTMLDivElement>(null);
  const { reduced } = useMotion();
  const ready = !!(ma.data && mb.data);

  useGSAP(() => {
    if (!ready || reduced || !root.current) return;
    gsap.from(root.current.querySelectorAll("[data-pane]"), { xPercent: (i: number) => (i ? 6 : -6), autoAlpha: 0, duration: 0.6, ease: "pv.out" });
    gsap.from(root.current.querySelectorAll("[data-mrow] > span"), { autoAlpha: 0, y: 8, stagger: 0.02, duration: 0.4, delay: 0.2 });
  }, { scope: root, dependencies: [ready, reduced] });

  if (ma.status === "error" || mb.status === "error") return <ErrorState title={describeError(ma.error ?? mb.error).title}>{describeError(ma.error ?? mb.error).body}</ErrorState>;
  if (!ma.data || !mb.data) return <SkeletonBlock lines={5} height={34} />;
  const A = ma.data, B = mb.data;
  const deps = setDiff(A.requiresDist, B.requiresDist);
  const files = setDiff(A.files.map((f) => f.filename.replace(A.version, "{v}")), B.files.map((f) => f.filename.replace(B.version, "{v}")));
  const rows: [string, string | undefined, string | undefined][] = [["Requires-Python", A.requiresPython, B.requiresPython], ["License", A.license, B.license], ["Summary", A.summary, B.summary]];

  return (
    <section ref={root} className={styles.section} aria-labelledby="meta-title">
      <h2 id="meta-title" className={styles.h}>Declared metadata</h2>
      <div className={styles.metaGrid}>
        <div data-pane className={styles.pane}><span className={styles.paneTag}>A · {a}</span></div>
        <div data-pane className={styles.pane}><span className={styles.paneTag} data-b>B · {b}</span></div>
        {rows.map(([k, x, y]) => (
          <div key={k} data-mrow className={styles.mrow} data-changed={(x ?? "") !== (y ?? "")}>
            <span className={styles.mkey}>{k}{(x ?? "") !== (y ?? "") && <em> changed</em>}</span>
            <span className="mono small break">{x ?? "—"}</span>
            <span className="mono small break">{y ?? "—"}</span>
          </div>
        ))}
      </div>
      <div className={styles.twoLists}>
        <DiffList title="Dependencies (Requires-Dist)" d={deps} />
        <DiffList title="Artifacts (version-normalised filenames)" d={files} meta={source(A, B)} />
      </div>
    </section>
  );
}

const source = (A: VersionMetadata, B: VersionMetadata) => (A.source === "demo" || B.source === "demo" ? "demo fixture" : "pypi.org");

function setDiff(a: string[], b: string[]) {
  const sa = new Set(a), sb = new Set(b);
  return { added: b.filter((x) => !sa.has(x)), removed: a.filter((x) => !sb.has(x)), same: a.filter((x) => sb.has(x)) };
}

function DiffList({ title, d, meta }: { title: string; d: ReturnType<typeof setDiff>; meta?: string }) {
  return (
    <div className={styles.dlist}>
      <h3 className={styles.h3}>{title}</h3>
      {meta && <p className="xs muted">Source: {meta}</p>}
      <ul>
        {d.added.map((x) => <li key={`+${x}`} data-state="added"><span aria-hidden="true">+</span><span className="mono break">{x}</span><span className="sr-only">added</span></li>)}
        {d.removed.map((x) => <li key={`-${x}`} data-state="removed"><span aria-hidden="true">−</span><span className="mono break">{x}</span><span className="sr-only">removed</span></li>)}
        {d.same.length > 0 && <li data-state="same"><span aria-hidden="true">=</span><span>{d.same.length} unchanged</span></li>}
        {!d.added.length && !d.removed.length && !d.same.length && <li data-state="same"><span aria-hidden="true">∅</span><span>none declared</span></li>}
      </ul>
    </div>
  );
}

function InventorySection({ name, a, b, fileA, fileB }: { name: string; a: string; b: string; fileA?: string; fileB?: string }) {
  const { mode } = useDataMode();
  const cachedA = useCachedReport(name, a), cachedB = useCachedReport(name, b);
  const [run, setRun] = useState(false);
  const ra = useReport(run && !cachedA ? name : null, a, undefined, fileA);
  const rb = useReport(run && !cachedB ? name : null, b, undefined, fileB);
  const repA = cachedA ?? ra.data, repB = cachedB ?? rb.data;
  const needed = (!cachedA ? 1 : 0) + (!cachedB ? 1 : 0);

  return (
    <section className={styles.section} aria-labelledby="inv-title">
      <div className={styles.secHead}>
        <h2 id="inv-title" className={styles.h}>File inventory</h2>
        {repA && repB && <div className="row"><StatusPill status={repA.overall.status} label={`A ${a}`} /><StatusPill status={repB.overall.status} label={`B ${b}`} />{(repA.source === "demo" || repB.source === "demo") && <DemoTag />}</div>}
      </div>
      {!(repA && repB) && !run && (
        <EmptyState title="Inventories need the backend" action={<Button variant="primary" onClick={() => setRun(true)}>Compare inventories</Button>}>
          File-level differences come from the backend&apos;s archive inventory. This runs {needed} verification{needed === 1 ? "" : "s"} {mode === "demo" ? "against demo fixtures" : "on the PyVerify backend"} ({fileA ?? "—"} and {fileB ?? "—"}).
        </EmptyState>
      )}
      {run && !(repA && repB) && (ra.status === "error" || rb.status === "error"
        ? <ErrorState title={describeError(ra.error ?? rb.error).title} action={<Button onClick={() => { ra.retry(); rb.retry(); }}>Retry</Button>}>{describeError(ra.error ?? rb.error).body}</ErrorState>
        : <LoadingState label="Waiting for the backend to inventory both artifacts…" />)}
      {repA && repB && (repA.inventory && repB.inventory
        ? <SplitTree key={`${repA.reportId}-${repB.reportId}`} a={a} b={b} before={repA.inventory.entries} after={repB.inventory.entries} />
        : <EmptyState title="Inventory unavailable">At least one report has no archive inventory, so a file-level comparison is not possible.</EmptyState>)}
      {repB?.consistency && (
        <div className={styles.consist}>
          <StatusPill status={repB.consistency.status} />
          <span className="small">B&apos;s sdist ↔ wheel: {repB.consistency.identical} identical Python files, {repB.consistency.differing.length} differing, {repB.consistency.onlyInSdist.length} only in sdist.</span>
        </div>
      )}
    </section>
  );
}

/** Split A/B file trees aligned row-by-row. Filtering animates with Flip; rows keep their identity. */
function SplitTree({ a, b, before, after }: { a: string; b: string; before: InventoryEntry[]; after: InventoryEntry[] }) {
  const rows = useMemo(() => diffInventories(before, after), [before, after]);
  const counts = diffCounts(rows);
  const [filter, setFilter] = useState<DiffState | "all">("all");
  const list = useRef<HTMLOListElement>(null);
  const flip = useRef<Flip.FlipState | null>(null);
  const { reduced } = useMotion();
  const visible = rows.filter((r) => filter === "all" || r.state === filter);
  const groups = group(visible);

  const choose = (f: DiffState | "all") => {
    if (list.current && !reduced) flip.current = Flip.getState(list.current.querySelectorAll("[data-row]"));
    setFilter(f);
  };
  useGSAP(() => {
    if (flip.current) {
      Flip.from(flip.current, { duration: 0.5, ease: "pv.out", absolute: true, onEnter: (els) => gsap.fromTo(els, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }), onLeave: (els) => gsap.to(els, { autoAlpha: 0, duration: 0.25 }) });
      flip.current = null;
    }
  }, { dependencies: [filter] });
  useGSAP(() => {
    if (reduced || !list.current) return;
    gsap.from(list.current.querySelectorAll("[data-row]"), { autoAlpha: 0, x: -10, stagger: 0.015, duration: 0.35 });
  }, { dependencies: [reduced] });

  return (
    <div className="stack" style={{ gap: "var(--s-4)" }}>
      <div className="row" role="toolbar" aria-label="Filter files">
        {FILTERS.map((f) => <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => choose(f)}>{f}{f !== "all" && ` · ${counts[f]}`}</button>)}
      </div>
      <div className={styles.treeHead} aria-hidden="true"><span>A · {a}</span><span /><span>B · {b}</span></div>
      <ol ref={list} className={styles.tree} aria-label={`File differences between ${a} and ${b}`}>
        {visible.length === 0 && <li className="small muted">No files in this category.</li>}
        {groups.map(([dir, items]) => (
          <li key={dir} className={styles.dir}>
            <span className={styles.dirName}>{dir}/</span>
            <ol>{items.map((r) => <TreeRow key={r.path} r={r} />)}</ol>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TreeRow({ r }: { r: DiffRow }) {
  const base = r.path.split("/").pop();
  const glyph = { added: "+", removed: "−", changed: "Δ", unchanged: "=" }[r.state];
  return (
    <li data-row data-flip-id={r.path} className={styles.row} data-state={r.state}>
      <span className={styles.cell} data-empty={!r.before}>{r.before ? <><span className="mono small break">{base}</span><span className="mono xs muted">{formatBytes(r.before.sizeBytes)}</span></> : <span className="xs muted">absent</span>}</span>
      <span className={styles.badge} title={r.state}>{glyph}<span className="sr-only">{r.state}</span></span>
      <span className={styles.cell} data-empty={!r.after}>{r.after ? <><span className="mono small break">{base}</span><span className="mono xs muted">{formatBytes(r.after.sizeBytes)}</span></> : <span className="xs muted">absent</span>}</span>
    </li>
  );
}

function group(rows: DiffRow[]): [string, DiffRow[]][] {
  const m = new Map<string, DiffRow[]>();
  rows.forEach((r) => { const d = r.path.includes("/") ? r.path.slice(0, r.path.lastIndexOf("/")) : "."; m.set(d, [...(m.get(d) ?? []), r]); });
  return [...m.entries()];
}
