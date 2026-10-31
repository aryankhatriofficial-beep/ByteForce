import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CompareView } from "@/components/compare/CompareView";
import { LoadingState } from "@/components/ui/States";

export const metadata: Metadata = { title: "Release Comparison" };

export default function ComparePage() {
  return (
    <div className="page">
      <PageHeader
        kicker="Release comparison"
        title="What changed between two releases."
        lead="Compare declared metadata straight from PyPI, then diff the archive inventories the backend reports — file by file."
        focus={["metadata", "record"]}
        compact
        tone="steel"
      />
      <section className="container" style={{ paddingBottom: "var(--s-9)" }}>
        <Suspense fallback={<LoadingState label="Loading comparison…" />}>
          <CompareView />
        </Suspense>
      </section>
    </div>
  );
}
