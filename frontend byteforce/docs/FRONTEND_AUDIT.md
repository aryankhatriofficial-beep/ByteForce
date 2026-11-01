# Frontend Audit (before the redesign)

Audited 2026-11-01 against the code in this folder (Next.js 16.4.3, React 19.3, npm + `package-lock.json`).

## Routes — all seven exist

| Route | File | Verdict before redesign |
|---|---|---|
| `/` | `src/app/page.tsx` | Strong hero type, but the 3D object is a generic noise sphere; story chapters don't follow the owner's five-point narrative; heaviest route (see perf). |
| `/verify` | `src/app/verify/page.tsx` | Works, but the radar is decorative, there is no evidence map, no filename selection from real releases, no attestation toggle, and the request uses `package` instead of the backend's `project`. |
| `/packages/[package]` | `src/app/packages/[package]/page.tsx` | **Auto-runs a full backend verification on page load** (expensive, surprising). No real release-artifact table, no copy-to-clipboard on hashes. |
| `/compare` | `src/app/compare/page.tsx` | Mosaic wipe is clever but not a readable split comparison; no metadata diff; silently fires two verifications. |
| `/provenance` | `src/app/provenance/page.tsx` | Good scroll-drawn chain, but source/commit nodes show the fixture's source-trace result — the owner states source trace is a **separate workflow** and must be NOT_CHECKED unless it actually ran. |
| `/architecture` | `src/app/architecture/page.tsx` | Uses `<foreignObject>` HTML buttons inside SVG + 15 infinite MotionPath packets → janky. Treats source trace as part of `/verify`. No verdict/summary component. |
| `/docs` | `src/app/docs/page.tsx` | Solid structure; missing API usage, security model, supported formats, verdict interpretation as its own section. |

## Backend integration gaps
- Code targets proposed routes (`/api/v1/health`, `/api/v1/verify`, `/api/v1/packages/{name}`) with body field `package`.
- Owner-stated actual contract: base `http://127.0.0.1:8765`, `GET /api/health`, `POST /api/v1/verify` with `project`, `version`, `filename` + optional attestation/publisher-policy fields. **The exact names of the optional fields and the response schema were not available on this machine** (backend not present, port 8765 refused connections).
- No connection state: with no env var the app silently ran demo mode instead of showing "disconnected + retry".
- Status vocabulary lacked NOT_CHECKED / NOT_APPLICABLE / NOT_CONFIGURED.

## Performance (measured, headless Chromium, 1440×900, scripted scroll, prod build)

| Route | avg frame | p95 frame | frames > 33 ms |
|---|---|---|---|
| `/` | 34.3 ms | **233 ms** | 9 |
| `/verify` | 19.5 ms | 17.5 ms | 3 |
| `/packages/kestrel-http` | 16.7 ms | 16.9 ms | 0 |
| `/compare` | 17.6 ms | 17.4 ms | 1 |
| `/provenance` | 16.7 ms | 17.7 ms | 0 |
| `/architecture` | 27.4 ms | **150 ms** | 10 |
| `/docs` | 16.7 ms | 17.7 ms | 0 |

Bundle: 1.67 MB JS raw / 496 KB gzip total. Largest chunks: `three` 542 KB (133 KB gz — `import * as THREE`, nothing tree-shaken), GSAP + all plugins + Lenis 250 KB (94 KB gz, loaded on every route). Fonts: 584 KB across 4 families.

Identified causes:
1. Hero shader: 82k-triangle icosphere, 6 simplex-noise evaluations per vertex, DPR up to 1.75 on a ~1000 px canvas.
2. `MorphBlob` animates `feTurbulence baseFrequency` — forces full filter re-rasterisation every frame; the CTA copy additionally has CSS `filter: blur(30px)` on top.
3. `CursorTrail`: full-viewport canvas with `mix-blend-mode: screen`, redrawn every pointer frame.
4. `ParticleNetwork`: O(n²) link test per frame, up to 140 nodes.
5. Nav scroll handler creates a new `gsap.to` on **every** scroll update.
6. Architecture: `foreignObject` + 15 perpetual MotionPath tweens.
7. `backdrop-filter` on nav, palette, several cards (blur over moving content).
8. Grain overlay is a fixed full-viewport layer **above** content (z-index 90).
9. Inspector/Compare trigger backend calls on load (network + render churn).

## Visual-system inconsistencies
- Template tells flagged by the `frontend-design` skill: tracked all-caps mono eyebrows above nearly every heading, "01/02" numbering on non-sequential content (nav, route cards), single italic accent word in every headline, `→` appended to buttons, `·`-joined meta strings.
- Four font families (Archivo, Inter Tight, JetBrains Mono, Instrument Serif) — one more than needed.
- Radii 4/6/12/14/22/999 used ad hoc; no motion tokens; no elevation scale.

## Motion gaps
- Route transition: one generic curtain; no back/forward treatment; navigation could stall when rAF is throttled (fixed late in v1).
- No initial-boot experience; no cursor system (only a decorative ribbon).
- Per-component one-off entrances with different timings.
