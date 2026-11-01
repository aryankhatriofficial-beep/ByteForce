import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PipelineDiagram } from "@/components/architecture/PipelineDiagram";
import { FrontendLayers } from "@/components/architecture/FrontendLayers";

export const metadata: Metadata = { title: "Architecture" };

const BOUNDARIES = [
  { t: "Browser → backend", d: "The browser sends only an identifier and an optional policy. Dropped files are hashed locally and never sent." },
  { t: "Backend → PyPI", d: "PyPI is trusted for availability, not content: every byte is checked against the published digest." },
  { t: "Backend → Sigstore", d: "Signatures are checked against Sigstore trust roots; an attestation without a valid chain is a FAIL, a missing one is UNAVAILABLE." },
  { t: "Backend → source host", d: "Source is fetched by pinned commit from a verified predicate — never by branch name." },
];

export default function ArchitecturePage() {
  return (
    <div className="page">
      <PageHeader
        kicker="Architecture"
        title="A pipeline with explicit trust boundaries."
        lead="Click any component to see what it takes in, what it returns, what it guarantees and how it fails. Scroll to step through the stages."
        focus={"all"}
        tone="steel"
      />
      <section className="container"><PipelineDiagram /></section>
      <section className="section">
        <div className="container">
          <span className="eyebrow">Trust boundaries</span>
          <h2 className="h2">Where trust is checked, not assumed.</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "var(--s-4)", marginTop: "var(--s-6)" }}>
            {BOUNDARIES.map((b, i) => (
              <article key={b.t} className="card hairline-corners" data-enter>
                <span className="mono xs muted">B{i + 1}</span>
                <h3 className="h3" style={{ fontSize: "var(--fs-lg)", margin: "var(--s-3) 0" }}>{b.t}</h3>
                <p className="small muted">{b.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <FrontendLayers />
    </div>
  );
}
