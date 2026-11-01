"use client";
import { useRef, useState, type KeyboardEvent } from "react";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/motion/gsap";
import { useMotion } from "@/lib/motion/MotionProvider";
import styles from "./PipelineDiagram.module.css";

type Zone = "client" | "backend" | "separate" | "external";
interface Comp { id: string; label: [string, string?]; zone: Zone; x: number; y: number; input: string; output: string; guarantees: string; failure: string }

/** Components from the documented PyVerify pipeline. Module names in the backend may differ. */
const COMPS: Comp[] = [
  { id: "ui", label: ["PyVerify UI"], zone: "client", x: 40, y: 247, input: "Project, version, filename, options", output: "POST /api/v1/verify", guarantees: "Validates input locally; never installs or runs a package; hashes dropped files on-device only.", failure: "Shows backend errors verbatim. Never substitutes demo data in live mode." },
  { id: "api", label: ["Verify API", "/api/v1/verify"], zone: "backend", x: 255, y: 247, input: "Verification request; GET /api/health for liveness", output: "Verification report (JSON)", guarantees: "Single entry point that orchestrates the stages and returns their results.", failure: "4xx for invalid input, 5xx for internal failure." },
  { id: "meta", label: ["PyPI metadata"], zone: "backend", x: 440, y: 110, input: "project, version", output: "File URL, published SHA-256, size; attestation availability", guarantees: "Reads PyPI's JSON API over HTTPS.", failure: "Unknown project/version → not found." },
  { id: "dl", label: ["Bounded artifact", "retrieval"], zone: "backend", x: 440, y: 247, input: "Artifact URL", output: "Artifact bytes (size-capped)", guarantees: "HTTPS only, hard byte limit.", failure: "Over the limit or network error → digest unavailable." },
  { id: "digest", label: ["Digest", "verification"], zone: "backend", x: 620, y: 247, input: "Bytes + published digest and size", output: "Digest result", guarantees: "SHA-256 and size equality with PyPI.", failure: "Mismatch → FAIL." },
  { id: "inspect", label: ["Metadata", "inspection"], zone: "backend", x: 620, y: 384, input: "Wheel archive", output: "METADATA / WHEEL fields", guarantees: "Parsed from the archive; nothing installed or imported.", failure: "Malformed or inconsistent metadata → reported." },
  { id: "record", label: ["RECORD & archive", "inventory"], zone: "backend", x: 800, y: 384, input: "Archive members (streamed)", output: "RECORD report, bounded inventory", guarantees: "Hash, size, missing, unexpected and duplicate detection; no extraction, no execution.", failure: "Any discrepancy → FAIL; limits exceeded → truncated." },
  { id: "consist", label: ["Release", "consistency"], zone: "backend", x: 985, y: 384, input: "sdist and wheel inventories", output: "Consistency report", guarantees: "Python files compared by content.", failure: "Differing files → FAIL; no sdist → unavailable." },
  { id: "prov", label: ["PEP 740 /", "Sigstore verification"], zone: "backend", x: 800, y: 110, input: "Attestation bundle + digest", output: "Provenance result", guarantees: "Signature, certificate chain, transparency log and subject digest.", failure: "Absent → UNAVAILABLE; invalid → FAIL." },
  { id: "policy", label: ["Publisher policy"], zone: "backend", x: 985, y: 110, input: "Verified identity + expected repository / workflow", output: "Policy result", guarantees: "Repository and optional workflow filename comparison.", failure: "Mismatch → FAIL; not supplied → NOT CONFIGURED." },
  { id: "verdict", label: ["Evidence summary", "& verdict"], zone: "backend", x: 985, y: 247, input: "All stage results", output: "PASS / WARNING / FAIL with reasons", guarantees: "Deterministic: any FAIL fails; missing evidence downgrades to WARNING.", failure: "—" },
  { id: "trace", label: ["Source trace", "(separate workflow)"], zone: "separate", x: 800, y: 247, input: "Verified SLSA v1 predicate", output: "Repository, pinned commit, snapshot comparison", guarantees: "Runs only when cryptographic evidence names a commit.", failure: "No predicate → NOT CHECKED / unavailable." },
  { id: "pypi", label: ["PyPI & files host"], zone: "external", x: 440, y: 540, input: "—", output: "Metadata, artifacts, attestations", guarantees: "Trusted for availability, verified for content.", failure: "Outage → request error." },
  { id: "sigstore", label: ["Sigstore trust root"], zone: "external", x: 800, y: 540, input: "—", output: "Fulcio / Rekor trust material", guarantees: "Anchor for certificate and log verification.", failure: "Unavailable → provenance unavailable." },
  { id: "source", label: ["Source host"], zone: "external", x: 985, y: 540, input: "—", output: "Snapshot at the pinned commit", guarantees: "Fetched by commit hash, never by branch.", failure: "Unreachable → trace unavailable." },
];

const LINKS: { a: string; b: string; dashed?: boolean }[] = [
  { a: "ui", b: "api" }, { a: "api", b: "meta" }, { a: "api", b: "dl" }, { a: "meta", b: "dl" }, { a: "dl", b: "digest" },
  { a: "digest", b: "inspect" }, { a: "inspect", b: "record" }, { a: "record", b: "consist" },
  { a: "meta", b: "prov" }, { a: "prov", b: "policy" }, { a: "policy", b: "verdict" }, { a: "digest", b: "verdict" },
  { a: "consist", b: "verdict" }, { a: "dl", b: "pypi" }, { a: "meta", b: "pypi" }, { a: "prov", b: "sigstore" },
  { a: "prov", b: "trace", dashed: true }, { a: "trace", b: "source", dashed: true },
];

const STAGES = [
  { t: "Request", ids: ["ui", "api"], d: "Project, version and filename cross the first trust boundary. Nothing about the package is trusted yet." },
  { t: "Acquire", ids: ["meta", "dl", "pypi"], d: "PyPI metadata supplies the published digest; the artifact is downloaded over HTTPS within a hard size cap." },
  { t: "Integrity", ids: ["digest", "inspect", "record", "consist"], d: "Bytes are hashed, metadata parsed and every archive member checked against RECORD — never extracted or executed." },
  { t: "Provenance", ids: ["prov", "policy", "sigstore"], d: "Attestations are verified against Sigstore; the verified identity is compared with your expected publisher." },
  { t: "Verdict", ids: ["verdict", "digest", "policy", "consist"], d: "Stage results are combined deterministically into PASS, WARNING or FAIL — with the reasons." },
  { t: "Source (separate)", ids: ["trace", "source", "prov"], d: "Only with a verified SLSA v1 predicate, and as its own workflow: resolve the pinned commit and compare the source snapshot." },
];

const W = 150, H = 58;
const center = (c: Comp) => ({ x: c.x + W / 2, y: c.y + H / 2 });

export function PipelineDiagram() {
  const root = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState("api");
  const [stage, setStage] = useState(0);
  const { reduced } = useMotion();
  const comp = COMPS.find((c) => c.id === sel)!;
  const byId = new Map(COMPS.map((c) => [c.id, c]));
  const lit = new Set(STAGES[stage].ids);

  useGSAP(() => {
    if (!root.current) return;
    const svg = root.current.querySelector("svg")!;
    if (!reduced) {
      svg.querySelectorAll<SVGPathElement>("[data-link]").forEach((p) => {
        const L = p.getTotalLength();
        gsap.fromTo(p, { strokeDasharray: L, strokeDashoffset: L }, { strokeDashoffset: 0, duration: 1.1, delay: 0.2, ease: "pv.inOut", clearProps: "strokeDasharray,strokeDashoffset", scrollTrigger: { trigger: svg, start: "top 80%", once: true } });
      });
      gsap.from(svg.querySelectorAll("[data-comp]"), { autoAlpha: 0, stagger: 0.035, duration: 0.6, scrollTrigger: { trigger: svg, start: "top 80%", once: true } });
    }
    const mm = gsap.matchMedia();
    mm.add("(min-width: 1000px)", () => {
      ScrollTrigger.create({
        trigger: root.current, start: "top top+=64", end: `+=${STAGES.length * 55}%`, pin: true, pinSpacing: true,
        snap: reduced ? undefined : { snapTo: 1 / (STAGES.length - 1), duration: 0.45 },
        onUpdate: (s) => setStage(Math.round(s.progress * (STAGES.length - 1))),
      });
    });
    return () => mm.revert();
  }, { scope: root, dependencies: [reduced], revertOnUpdate: true });

  const onKey = (id: string) => (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(id); } };

  return (
    <div ref={root} className={styles.wrap}>
      <div className={styles.stageBar} role="tablist" aria-label="Pipeline stages">
        {STAGES.map((s, i) => (
          <button key={s.t} role="tab" type="button" aria-selected={stage === i} className={styles.stageBtn} onClick={() => setStage(i)}>{s.t}</button>
        ))}
      </div>
      <p className={styles.stageText} aria-live="polite">{STAGES[stage].d}</p>
      <div className={styles.grid}>
        <div className={styles.canvas}>
          <svg viewBox="0 0 1180 640" className={styles.svg} role="group" aria-label="PyVerify pipeline diagram. Components are buttons.">
            <rect x="15" y="200" width="205" height="150" rx="16" className={styles.zone} data-zone="client" />
            <text x="32" y="226" className={styles.zoneLabel}>Browser — untrusted input</text>
            <rect x="232" y="68" width="933" height="400" rx="16" className={styles.zone} data-zone="backend" />
            <text x="250" y="94" className={styles.zoneLabel}>PyVerify backend — static analysis only</text>
            <rect x="784" y="232" width="182" height="88" rx="12" className={styles.zone} data-zone="separate" />
            <rect x="232" y="496" width="933" height="128" rx="16" className={styles.zone} data-zone="external" />
            <text x="250" y="522" className={styles.zoneLabel}>External — verified, not trusted</text>
            {LINKS.map((l, i) => {
              const p = center(byId.get(l.a)!), q = center(byId.get(l.b)!);
              const mx = (p.x + q.x) / 2;
              const d = `M${p.x},${p.y} C${mx},${p.y} ${mx},${q.y} ${q.x},${q.y}`;
              const on = lit.has(l.a) && lit.has(l.b);
              return (
                <g key={i}>
                  <path data-link d={d} className={styles.link} data-lit={on} data-dashed={!!l.dashed} />
                  {on && !reduced && <circle r="4" className={styles.pkt}><animateMotion dur="1.8s" repeatCount="indefinite" path={d} /></circle>}
                </g>
              );
            })}
            {COMPS.map((c) => (
              <g
                key={c.id} data-comp role="button" tabIndex={0} aria-pressed={sel === c.id} aria-label={c.label.join(" ")}
                className={styles.comp} data-zone={c.zone} data-lit={lit.has(c.id)} onClick={() => setSel(c.id)} onKeyDown={onKey(c.id)} data-cursor="Inspect"
              >
                <rect x={c.x} y={c.y} width={W} height={H} rx="10" />
                <text x={c.x + W / 2} y={c.y + (c.label[1] ? 25 : 34)} textAnchor="middle">
                  <tspan>{c.label[0]}</tspan>
                  {c.label[1] && <tspan x={c.x + W / 2} dy="17" className={styles.sub}>{c.label[1]}</tspan>}
                </text>
              </g>
            ))}
          </svg>
        </div>
        <aside className={styles.panel} aria-live="polite" aria-label="Component details">
          <span className="eyebrow">{{ client: "Client", backend: "Backend", separate: "Backend · separate workflow", external: "External service" }[comp.zone]}</span>
          <h3 className="h3">{comp.label.join(" ")}</h3>
          <dl className={styles.dl}>
            <div><dt>Takes in</dt><dd>{comp.input}</dd></div>
            <div><dt>Returns</dt><dd>{comp.output}</dd></div>
            <div><dt>Guarantees</dt><dd>{comp.guarantees}</dd></div>
            <div><dt>Failure mode</dt><dd>{comp.failure}</dd></div>
          </dl>
          <p className="xs muted">Logical view of the documented pipeline. Backend module names may differ.</p>
        </aside>
      </div>
    </div>
  );
}
