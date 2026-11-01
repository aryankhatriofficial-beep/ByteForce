import type { Metadata } from "next";
import { Suspense } from "react";
import { Inspector } from "@/components/inspector/Inspector";
import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingState } from "@/components/ui/States";
import { normalizeName } from "@/lib/validation";

export async function generateMetadata({ params }: PageProps<"/packages/[package]">): Promise<Metadata> {
  const { package: pkg } = await params;
  return { title: `${decodeURIComponent(pkg)} · Inspector` };
}

export default async function PackagePage({ params }: PageProps<"/packages/[package]">) {
  const { package: raw } = await params;
  const name = normalizeName(decodeURIComponent(raw));
  return (
    <div className="page">
      <PageHeader
        kicker="Package dossier"
        title={<span className="break">{name}</span>}
        lead="Releases, published artifacts and their digests come from PyPI. Verification evidence appears only after the backend has actually checked a file."
        focus={["artifact", "digest", "metadata", "record"]}
        compact
        tone="steel"
      />
      <section className="container" style={{ paddingBottom: "var(--s-9)" }}>
        <Suspense fallback={<LoadingState label="Loading inspector…" />}>
          <Inspector name={name} />
        </Suspense>
      </section>
    </div>
  );
}
