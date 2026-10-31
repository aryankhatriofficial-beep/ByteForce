import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyStudio } from "@/components/verify/VerifyStudio";
import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingState } from "@/components/ui/States";

export const metadata: Metadata = { title: "Verify Studio" };

export default function VerifyPage() {
  return (
    <div className="page">
      <PageHeader
        kicker="Verify Studio"
        title="Interrogate one artifact."
        lead="Choose a published file. PyVerify fetches it, verifies it statically and returns every piece of evidence — including the pieces that are missing."
        focus={"all"}
        compact
        tone="uv"
      />
      <section className="container" style={{ paddingBottom: "var(--s-9)" }}>
        <Suspense fallback={<LoadingState label="Loading studio…" />}>
          <VerifyStudio />
        </Suspense>
      </section>
    </div>
  );
}
