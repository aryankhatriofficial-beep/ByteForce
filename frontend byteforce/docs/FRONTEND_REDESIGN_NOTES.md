# Frontend Redesign Notes (v2)

## Design decisions
- **The evidence spine is the identity.** PyPI artifact → SHA-256 → metadata → attestation → publisher → RECORD → source appears in the boot sequence, the route veil, the hero, every page header (highlighting the stages that page deals with) and, as a working instrument, the Verify evidence map.
- **One bold moment per page, calm elsewhere** (frontend-design skill). Home: the chrome artifact. Verify: the evidence map. Inspector: the dossier sheets. Compare: split trees. Provenance: the drawn chain. Architecture: the pipeline. Docs: the verdict simulator.
- **Removed template tells**: tracked all-caps eyebrows, decorative "01/02" numerals (numbers remain only on the real 1–7 evidence sequence), italic accent words, `→` in buttons.
- **Type**: Archivo (expanded display), Inter Tight (UI), JetBrains Mono (hashes, filenames, logs). Instrument Serif removed. Minimum text size 13 px (11 px only for diagram labels on phones).
- **Hero object**: an exploded hex "package" (archive shell, metadata, modules) in procedural chrome — ~120 triangles instead of an 82k-triangle noise sphere. Plates separate as you scroll.
- **Honesty is a visual rule**: seven status shapes (verified circle+tick, failed octagon, warning triangle, unavailable dashed circle, not-checked dotted circle, not-applicable bar, not-configured dashed diamond) so missing evidence never looks like a pass.

## What was kept from the owner's existing work
Arctic Steel × Ultraviolet Void palette, "BEYOND THE BINARY.", the seven routes, demo fixtures (now opt-in), the command palette, the evidence cards, fingerprint ring, package anatomy, release timeline, trust graph, docs content and the honest-limitations copy.

## Improved beyond both the owner's brief and v1
- Real public data without the backend: release lists, artifact filenames and published SHA-256 digests come straight from PyPI's CORS-enabled JSON API, labelled as unverified metadata.
- Inspector and Compare no longer fire backend verifications on page load; verification is always an explicit action, and evidence is shown only when this session produced it.
- Raw backend response viewer on Verify, so no field is ever invented.
- Connection state in the nav (connected / offline / checking / demo) with retry; demo data is strictly opt-in.

## New reusable components
`evidence/EvidenceMap`, `evidence/EvidenceDetail`, `NodeGlyph`, `ui/CopyButton`, `layout/Cursor`, `layout/BootSequence`, rewritten `layout/PageTransition`, `layout/PageHeader` (with spine strip and compact mode), `visuals/ArtifactHero` + `artifactScene`, `lib/evidence.ts` (report → stages), `lib/api/pypi.ts`, `lib/motion/tokens.ts`, `lib/motion/gsap-extra.ts`, `useCachedReport` / `useVersionMeta`.

Removed: `ChromeHero`/`chromeScene` (noise sphere), `ParticleNetwork`, `CursorTrail`, `BeforeAfter` mosaic.

## Motion & cursor
See `docs/MOTION_SYSTEM.md`.

## Performance fixes (measured; headless Chromium, 1440×900, scripted scroll, production build)

| Route | Before p95 / janky frames | After p95 / janky frames |
|---|---|---|
| `/` | 233 ms / 9 | 17.6 ms / 0 |
| `/verify` | 17.5 ms / 3 | 17.6 ms / 0 |
| `/packages/[pkg]` | 16.9 ms / 0 | 17.2 ms / 0 |
| `/compare` | 17.4 ms / 1 | 17.5 ms / 0 |
| `/provenance` | 17.7 ms / 0 | 17.6 ms / 0 |
| `/architecture` | 150 ms / 10 | 17.6 ms / 0 |
| `/docs` | 17.7 ms / 0 | 17.7 ms / 0 |

Causes fixed: 82k-tri noise shader → low-poly chrome; animated SVG turbulence and CSS blur removed;
full-screen blended cursor canvas replaced by two transformed dots; O(n²) particle field removed;
per-scroll-frame tween creation in the nav replaced by a single attribute toggle; `foreignObject` and
15 perpetual MotionPath tweens in Architecture replaced by pure SVG with packets only on the active
stage; grain layer moved behind content; GSAP route-specific plugins split out of the shared chunk
(shared GSAP chunk 250 KB → 168 KB raw); fonts 584 KB → 532 KB (one family removed).

Per-route JS after (raw, cold load): home 834 KB (includes the lazily-loaded three.js chunk, 548 KB), verify 172 KB, inspector 297 KB, compare 255 KB, provenance 215 KB, architecture 115 KB, docs 139 KB.

## Remaining limitations
- The backend's response schema and the names of the optional attestation/policy request fields were not available on this machine. Field names live in `src/lib/api/endpoints.ts` (`OPTIONAL_FIELDS`); responses go through a tolerant normaliser and are viewable raw.
- No backend was running on 127.0.0.1:8765 here, so live verification was tested against the demo provider and (in v1) a local mock, not the real backend.
- Measurements come from headless Chromium; real-device GPU behaviour may differ.
- three.js is not tree-shaken much by named imports (548 KB raw); it loads only on the home page, lazily.
