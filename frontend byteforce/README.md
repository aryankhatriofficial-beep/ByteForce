# PyVerify — Frontend (ByteForce · Hackathon PS04)

**Beyond the binary.** A multi-route product frontend for PyVerify, the published-package integrity
tool: PyPI digest verification, wheel metadata and RECORD validation, safe archive inventory,
PEP 740 attestation verification, publisher trust policy, sdist ↔ wheel consistency and verified
source trace.

This project is the frontend for the existing PyVerify backend; backend code is not modified here.
It calls the configurable local API at `http://127.0.0.1:8766` for health, exact-version release
discovery, artifact verification, and source trace. If the backend is offline the UI says so and
offers Retry; fictional demo fixtures are available only when you opt in.

## Run locally

Requirements: Node ≥ 20.9 (tested on Node 26), npm.

```bash
npm install
npm run dev -- --hostname 127.0.0.1 --port 3001  # http://127.0.0.1:3001
```

Production:

```bash
npm run build && npm start
```

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Next.js dev server (Webpack) |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | `next typegen` (generates route types) then `tsc --noEmit` |
| `npm run lint` | ESLint (Next core-web-vitals + TypeScript + jsx-a11y) |
| `npm test` | Vitest unit tests (validation, statuses, normaliser, evidence spine, request mapping, fixtures, diff, hashing) |
| `npm run check` | All of the above, in order |

## Connect the backend

Start the PyVerify backend on `127.0.0.1:8766` and the nav badge turns **Backend connected**.
For another address: `cp .env.example .env.local` and set `NEXT_PUBLIC_PYVERIFY_API_BASE_URL`.
Details: **[docs/API_CONTRACT.md](docs/API_CONTRACT.md)** and **[docs/BACKEND_INTEGRATION.md](docs/BACKEND_INTEGRATION.md)**.
Live release discovery requires an exact version because the backend contract does not expose a
project-wide release list. Supply `project==version`; artifact filenames and published SHA-256 values
come from the backend response. Source trace is a separate workflow and requires a wheel plus a
`.tar.gz` sdist from the same release.

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Cinematic introduction, evidence chapters, capabilities, live interactive shell |
| `/verify` | Verify Studio — run the pipeline for one artifact |
| `/packages`, `/packages/[package]` | Package Inspector — timeline, fingerprint, metadata, RECORD, inventory, attestation, source trace |
| `/compare` | Release comparison — version ↔ version and sdist ↔ wheel |
| `/provenance` | Provenance Explorer — PyPI → attestation → publisher → repository → commit |
| `/architecture` | Pipeline, trust boundaries, frontend integration layers |
| `/docs` | Methodology, status semantics, limitations |

Details: [docs/ROUTE_MAP.md](docs/ROUTE_MAP.md).

## What is real vs demo

| Feature | Source |
|---|---|
| Verification evidence, verdicts, evidence map | **Backend** (`POST /api/v1/verify`) — or opt-in demo fixtures |
| Exact release artifact filenames, sizes, **published** SHA-256 | **PyVerify backend** (`GET /api/v1/packages/{project}/{version}/files`), labelled as public metadata and not verification evidence |
| Source trace | Separate **PyVerify backend** workflow (`POST /api/v1/source-trace`); partial/missing evidence stays distinct from success |
| Local file SHA-256 | Your browser (WebCrypto); the file is never uploaded |
| Validation, status/verdict logic, docs simulator | Client logic, unit-tested |
| Architecture diagram | Documentation of the logical pipeline |
| Demo packages `kestrel-http`, `lumen-cli`, `quartzite`, `vellum-schema` | **Fictional**, opt-in, always labelled DEMO |

## Project structure

```
src/
  app/                 routes, layout, template (route transitions), globals.css (design tokens)
  components/
    layout/            Nav, Footer, PageHeader, CommandPalette, PageTransition, Cursor, BootSequence
    evidence/          EvidenceMap, EvidenceDetail
    ui/                Button, StatusPill, EvidenceCard, Tabs, Terminal, HashText, Toast, States
    visuals/           ArtifactHero (+ artifactScene GLSL), MorphBlob, RadarScanner,
                       Fingerprint, PackageAnatomy, GooeyOrbs
    home/ verify/ inspector/ compare/ provenance/ architecture/ docs/
  lib/
    api/               types, client, endpoints, normalize, provider, pypi, errors, demo/fixtures
    motion/            gsap (core) + gsap-extra (route plugins), tokens, MotionProvider (reduced motion, Lenis)
    config.ts, status.ts, evidence.ts, validation.ts, hash.ts, diff.ts, useApi.ts, docsContent.ts
docs/                  FRONTEND_AUDIT, REFERENCE_AND_SKILL_AUDIT, FRONTEND_REDESIGN_NOTES, MOTION_SYSTEM,
                       API_CONTRACT, BACKEND_INTEGRATION, DESIGN_SYSTEM, MOTION_COVERAGE, ROUTE_MAP, SKILL_AUDIT
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · GSAP 3.15 (+ ScrollTrigger, SplitText,
ScrambleText, MorphSVG, DrawSVG, MotionPath, Flip, Draggable, Inertia — all free in the public
package) · Three.js (one lazily-loaded shader scene) · Lenis · CSS Modules + design tokens · Vitest.
No UI kit, no animation library duplication, no paid services, no API keys.

## Accessibility & motion

Keyboard reachable everywhere (⌘/Ctrl+K palette, tabs with arrow keys, slider with arrows,
timeline nodes are buttons), visible focus, skip link, `aria-live` results, colour-independent
statuses. `prefers-reduced-motion` (or the palette toggle) disables smooth scroll, pinning,
scrubbing, loops and the cursor trail; WebGL renders one static frame; content is identical.
WebGL failure falls back to an SVG liquid blob.

## Security notes

Strict headers in `next.config.ts` (CSP with `connect-src` limited to self + configured backend,
`frame-ancestors 'none'`, nosniff, referrer policy). Requests omit credentials. No secrets belong in
`NEXT_PUBLIC_*` variables. `.env*` files are git-ignored except `.env.example`.

## Transfer as a ZIP

From the folder that **contains** `frontend byteforce` (the Desktop on this machine):

```bash
cd ~/Desktop && rm -f "frontend byteforce.zip" && zip -r "frontend byteforce.zip" "frontend byteforce" -x "*/node_modules/*" "*/.next/*" "*/.env" "*/.env.*local" "*/.DS_Store" "*.tsbuildinfo" "*/next-env.d.ts" "*/.git/*" "*/coverage/*" "*/.vercel/*" "*/.playwright-mcp/*"
```

On the other Mac: unzip, `cd "frontend byteforce"`, `npm install`, `npm run check`.
