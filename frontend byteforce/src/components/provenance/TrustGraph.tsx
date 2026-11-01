"use client";
import { useMemo, useRef } from "react";
import type { VerificationReport } from "@/lib/api/types";
import { gsap, useGSAP } from "@/lib/motion/gsap";
import { Draggable } from "@/lib/motion/gsap-extra";
import { useMotion } from "@/lib/motion/MotionProvider";
import styles from "./TrustGraph.module.css";

interface GNode { id: string; label: string; kind: "artifact" | "crypto" | "identity" | "source" | "file"; x: number; y: number }
interface GEdge { a: string; b: string; rel: string; ok: boolean }

/** Builds the graph strictly from report fields — no inferred entities. */
function buildGraph(r: VerificationReport): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: Omit<GNode, "x" | "y">[] = [{ id: "artifact", label: r.artifact.filename, kind: "artifact" }];
  const edges: GEdge[] = [];
  nodes.push({ id: "digest", label: `sha256 ${r.artifact.expectedSha256.slice(0, 10)}…`, kind: "crypto" });
  edges.push({ a: "artifact", b: "digest", rel: "hashes to", ok: r.artifact.observedSha256 === r.artifact.expectedSha256 });
  r.provenance?.attestations.forEach((a, i) => {
    const id = `att${i}`;
    nodes.push({ id, label: "attestation", kind: "crypto" });
    edges.push({ a: id, b: "digest", rel: "subject", ok: a.subjectSha256 === r.artifact.expectedSha256 && a.verified });
    nodes.push({ id: `cert${i}`, label: "Fulcio cert", kind: "crypto" });
    edges.push({ a: id, b: `cert${i}`, rel: "signed by", ok: a.verified });
    nodes.push({ id: `iss${i}`, label: a.certificateIssuer.replace("https://", ""), kind: "identity" });
    edges.push({ a: `cert${i}`, b: `iss${i}`, rel: "OIDC issuer", ok: a.verified });
    if (a.transparencyLogIndex !== undefined) {
      nodes.push({ id: `rekor${i}`, label: `rekor #${a.transparencyLogIndex}`, kind: "crypto" });
      edges.push({ a: id, b: `rekor${i}`, rel: "logged in", ok: a.verified });
    }
  });
  const pub = r.provenance?.publisher;
  if (pub?.repository && r.provenance?.attestations.length) {
    nodes.push({ id: "repo", label: pub.repository, kind: "source" });
    edges.push({ a: "cert0", b: "repo", rel: "identity", ok: r.policy?.repositoryMatch !== false });
    if (pub.workflow) {
      nodes.push({ id: "wf", label: pub.workflow, kind: "identity" });
      edges.push({ a: "repo", b: "wf", rel: "workflow", ok: r.policy?.workflowMatch !== false });
    }
  }
  if (r.sourceTrace?.commit) {
    nodes.push({ id: "commit", label: r.sourceTrace.commit.slice(0, 10), kind: "source" });
    edges.push({ a: nodes.some((n) => n.id === "repo") ? "repo" : "artifact", b: "commit", rel: "pinned", ok: r.sourceTrace.status === "pass" });
    r.sourceTrace.differing.forEach((f, i) => {
      nodes.push({ id: `diff${i}`, label: f.split("/").pop()!, kind: "file" });
      edges.push({ a: "commit", b: `diff${i}`, rel: "differs", ok: false });
    });
  }

  // Tiny deterministic force layout (repulsion + springs), run once.
  const W = 900, H = 420;
  const pos = nodes.map((n, i) => ({ ...n, x: W / 2 + Math.cos(i * 2.4) * 160, y: H / 2 + Math.sin(i * 2.4) * 120 }));
  const idx = new Map(pos.map((p, i) => [p.id, i]));
  for (let it = 0; it < 300; it++) {
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      const dx = pos[j].x - pos[i].x, dy = pos[j].y - pos[i].y;
      const d2 = Math.max(100, dx * dx + dy * dy), f = 9000 / d2, d = Math.sqrt(d2);
      pos[i].x -= (dx / d) * f; pos[i].y -= (dy / d) * f; pos[j].x += (dx / d) * f; pos[j].y += (dy / d) * f;
    }
    for (const e of edges) {
      const a = pos[idx.get(e.a)!], b = pos[idx.get(e.b)!];
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1, Math.hypot(dx, dy)), f = (d - 140) * 0.02;
      a.x += (dx / d) * f; a.y += (dy / d) * f; b.x -= (dx / d) * f; b.y -= (dy / d) * f;
    }
    for (const p of pos) { p.x += (W / 2 - p.x) * 0.01; p.y += (H / 2 - p.y) * 0.01; p.x = Math.max(70, Math.min(W - 70, p.x)); p.y = Math.max(30, Math.min(H - 30, p.y)); }
  }
  return { nodes: pos, edges: edges.filter((e) => idx.has(e.a) && idx.has(e.b)) };
}

export function TrustGraph({ report }: { report: VerificationReport }) {
  const { nodes, edges } = useMemo(() => buildGraph(report), [report]);
  const root = useRef<SVGSVGElement>(null);
  const { reduced } = useMotion();

  useGSAP(() => {
    const svg = root.current;
    if (!svg) return;
    const pos = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    const redraw = () => {
      edges.forEach((e, i) => {
        const a = pos.get(e.a)!, b = pos.get(e.b)!;
        const line = svg.querySelector<SVGLineElement>(`[data-edge="${i}"]`);
        const lbl = svg.querySelector<SVGTextElement>(`[data-elabel="${i}"]`);
        line?.setAttribute("x1", String(a.x)); line?.setAttribute("y1", String(a.y));
        line?.setAttribute("x2", String(b.x)); line?.setAttribute("y2", String(b.y));
        lbl?.setAttribute("x", String((a.x + b.x) / 2)); lbl?.setAttribute("y", String((a.y + b.y) / 2 - 4));
      });
    };
    const drags = nodes.flatMap((n) => {
      const el = svg.querySelector<SVGGElement>(`[data-gnode="${n.id}"]`);
      if (!el) return [];
      return Draggable.create(el, {
        type: "x,y", inertia: !reduced, bounds: svg,
        onDrag() { pos.set(n.id, { x: n.x + this.x, y: n.y + this.y }); redraw(); },
        onThrowUpdate() { pos.set(n.id, { x: n.x + this.x, y: n.y + this.y }); redraw(); },
      });
    });
    if (!reduced) {
      gsap.from(svg.querySelectorAll("[data-gnode]"), { scale: 0, transformOrigin: "50% 50%", stagger: 0.05, duration: 0.8, ease: "back.out(2)", scrollTrigger: { trigger: svg, start: "top 80%", once: true } });
      gsap.from(svg.querySelectorAll("[data-edge]"), { drawSVG: "0%", stagger: 0.04, duration: 0.8, scrollTrigger: { trigger: svg, start: "top 80%", once: true } });
    }
    return () => drags.forEach((d) => d.kill());
  }, { dependencies: [nodes, reduced], revertOnUpdate: true });

  return (
    <div className={styles.wrap}>
      <svg ref={root} viewBox="0 0 900 420" className={styles.svg} role="img" aria-label={`Evidence graph with ${nodes.length} entities and ${edges.length} bindings`}>
        {edges.map((e, i) => {
          const a = nodes.find((n) => n.id === e.a)!, b = nodes.find((n) => n.id === e.b)!;
          return (
            <g key={i}>
              <line data-edge={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={styles.edge} data-ok={e.ok} />
              <text data-elabel={i} x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle" className={styles.elabel}>{e.rel}</text>
            </g>
          );
        })}
        {nodes.map((n) => (
          <g key={n.id} data-gnode={n.id} className={styles.node} data-kind={n.kind}>
            <circle cx={n.x} cy={n.y} r={n.kind === "artifact" ? 16 : 10} />
            <text x={n.x} y={n.y + (n.kind === "artifact" ? 32 : 26)} textAnchor="middle">{n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label}</text>
          </g>
        ))}
      </svg>
      <ul className={styles.legend}>
        <li data-kind="artifact">artifact</li><li data-kind="crypto">cryptographic</li><li data-kind="identity">identity</li><li data-kind="source">source</li><li data-kind="file">differing file</li>
        <li className={styles.bad}>broken / unverified binding</li>
      </ul>
    </div>
  );
}
