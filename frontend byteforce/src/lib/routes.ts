export interface RouteDef { href: string; label: string; blurb: string }

export const ROUTES: RouteDef[] = [
  { href: "/", label: "Home", blurb: "What PyVerify proves — and what it can't." },
  { href: "/verify", label: "Verify", blurb: "Run the evidence pipeline against one published artifact." },
  { href: "/packages", label: "Inspector", blurb: "A package dossier: releases, artifacts, digests, evidence." },
  { href: "/compare", label: "Compare", blurb: "What changed between two releases, file by file." },
  { href: "/provenance", label: "Provenance", blurb: "From PyPI release to publisher identity — and where evidence stops." },
  { href: "/architecture", label: "Architecture", blurb: "The verification pipeline and its trust boundaries." },
  { href: "/docs", label: "Docs", blurb: "Methodology, verdicts, API usage and limitations." },
];

export const routeFor = (path: string): RouteDef =>
  ROUTES.slice().reverse().find((r) => (r.href === "/" ? path === "/" : path.startsWith(r.href))) ?? ROUTES[0];
