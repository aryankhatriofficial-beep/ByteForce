import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProvenanceExplorer } from "@/components/provenance/ProvenanceExplorer";
import { LoadingState } from "@/components/ui/States";

export const metadata: Metadata = { title: "Provenance Explorer" };

export default function ProvenancePage() {
  return (
    <div className="page">
      <PageHeader
        kicker="Provenance explorer"
        title="Follow the chain of custody."
        lead="PyPI release → signed attestation → publisher → repository → commit. Every link shows exactly where verified evidence stops."
        focus={["attestation", "policy", "source"]}
        tone="uv"
      />
      <section className="container" style={{ paddingBottom: "var(--s-9)" }}>
        <Suspense fallback={<LoadingState label="Loading explorer…" />}>
          <ProvenanceExplorer />
        </Suspense>
      </section>
    </div>
  );
}
