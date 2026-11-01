import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { DocsView } from "@/components/docs/DocsView";

export const metadata: Metadata = { title: "Methodology & Docs" };

export default function DocsPage() {
  return (
    <div className="page">
      <PageHeader
        kicker="Methodology & docs"
        title="Read the evidence carefully."
        lead="What PyVerify checks, how, what each verdict means, how to call the API — and what a result does not prove."
        focus={"all"}
        tone="mint"
      />
      <section className="container" style={{ paddingBottom: "var(--s-9)" }}>
        <DocsView />
      </section>
    </div>
  );
}
