import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PackageIndex } from "@/components/inspector/PackageIndex";

export const metadata: Metadata = { title: "Package Inspector" };

export default function PackagesPage() {
  return (
    <div className="page">
      <PageHeader
        kicker="Package inspector"
        title="Open the dossier."
        lead="Any PyPI project: its releases, every published artifact and digest, and the verification evidence gathered in this session."
        focus={["artifact", "digest", "metadata", "record"]}
        compact
        tone="steel"
      />
      <section className="container" style={{ paddingBottom: "var(--s-9)" }}>
        <PackageIndex />
      </section>
    </div>
  );
}
