# Motion & Interaction Coverage Matrix

> v2 update: see `docs/MOTION_SYSTEM.md` for the current architecture. Changes vs the table below: the noise sphere (#5, #8) is now the exploded chrome artifact; the particle network (#11, #12) was **removed for performance** — depth now comes from the perspective lab floor and the travelling spine signal; the cursor trail (#19) is now a precision dot + ring cursor; the radar (#38) on Verify was replaced by the evidence map's indeterminate scan beam (the radar remains only as a component); the before/after mosaic (#30) was replaced by split A/B file trees; Architecture packets (#28) now animate only on the active stage. New: boot sequence, signature route veil with chrome edges, spine strip in every header, verdict wipe, copy-tick morph.

Legend: **Full** = implemented and verified in the browser · **Partial** = implemented with a stated
scope limit · **Omitted** = deliberately not built (reason given).

Global rules that apply to every row:
- All GSAP work runs inside `useGSAP` (scoped, auto-reverted) or `gsap.matchMedia()`; hooks whose
  dependencies change after hydration use `revertOnUpdate: true` (this fixed a real bug where
  `from()` tweens froze at opacity 0).
- **Reduced motion** (`prefers-reduced-motion` or the command-palette toggle, stored in
  `localStorage["pv.motion"]`) disables Lenis, the cursor trail, pinning, scrubbing, loops and
  entrance tweens; CSS forces transition/animation durations to ~0; WebGL renders a single static frame.
- Cursor-dependent effects only run on `(pointer: fine)`; nothing essential depends on hover.

| # | Concept | Where (route → component) | How | Library / technique | Fallback | Status |
|---|---------|---------------------------|-----|---------------------|----------|--------|
| 1 | Kinetic typography | `/` → `home/Hero.tsx` | Per-character masked rise with rotation, pulsing period, letter-spacing widens on scroll | GSAP SplitText + timeline + ScrollTrigger scrub | Static headline | Full |
| 2 | Word-by-word reveals | All routes → `ui/SplitHeading.tsx`, `layout/PageHeader.tsx`; `/` → `home/Manifesto.tsx` (scroll-scrubbed word illumination) | SplitText words in line masks, staggered on enter / scrubbed | SplitText `mask: "lines"`, `autoSplit` | Plain text | Full |
| 3 | SVG morphing | `/` → `home/Chapters.tsx` (glyph morphs per chapter); `/provenance` → node shape = status (circle / diamond / square / cross) | MorphSVG between hand-authored paths | MorphSVGPlugin | Final shape set instantly | Full |
| 4 | Morphing gradient blobs | `/` CTA, `/docs` header, 404, WebGL fallback → `visuals/MorphBlob.tsx` | Blob path morph loop + rotating gradient transform | MorphSVG + attr tween | First shape, static | Full |
| 5 | Liquid / distortion | `/` → `visuals/chromeScene.ts` (simplex-noise vertex displacement); `MorphBlob` (feTurbulence + feDisplacementMap) | GLSL displacement + recomputed normals; SVG turbulence frequency tween | Three.js ShaderMaterial, SVG filters | SVG blob | Full |
| 6 | Ripple effects | Every `ui/Button.tsx` click; `/verify` → `verify/Dropzone.tsx` drop point ring | Spawned span scaled/faded from pointer position | GSAP | No ripple | Full |
| 7 | Selective gooey transitions | `/verify` in-flight indicator, `/` CTA → `visuals/GooeyOrbs.tsx` | Orbs on MotionPath merged by blur + alpha-threshold filter | SVG goo filter + MotionPathPlugin | Static cluster | Partial — used for "in flight" state, not for route transitions (curtain is cleaner there) |
| 8 | Interactive 3D / WebGL | `/` → `visuals/ChromeHero.tsx` | Lazy-loaded Three.js icosphere, pointer-tilted, scroll-scaled, paused off-screen / hidden tab | Three.js r187, custom GLSL | SVG liquid blob if WebGL missing, context lost, or creation throws | Full |
| 9 | Cinematic depth & lighting | `/` chrome shader (procedural studio soft-boxes, UV/plasma rim lights, thin-film iridescence, Reinhard tonemap); global grain + radial light fields | Fragment shader env function | GLSL | CSS gradients | Full |
| 10 | Masked reveals | Every SplitText heading (line masks); `PageHeader` giant index rising from a clip; route curtain | overflow-clip masks | SplitText, CSS clip | Visible text | Full (text masks; the product uses no photography) |
| 11 | Particle fields | `/` hero → `visuals/ParticleNetwork.tsx` | ≤140 drifting nodes, pointer repulsion, IntersectionObserver pause | Canvas 2D | Static frame | Full |
| 12 | Dynamic network background | same as 11 (proximity links) | Distance-faded edges | Canvas 2D | Static frame | Full |
| 13 | Pinned scroll storytelling | `/` Chapters (5 evidence layers); `/provenance` journey; `/architecture` stages | `pin`, scrubbed timelines, snap | ScrollTrigger | Stacked readable blocks (mobile + reduced motion) | Full |
| 14 | Horizontal scroll sequence | `/` → `home/Capabilities.tsx` | Vertical scroll drives horizontal track; per-card `containerAnimation` triggers | ScrollTrigger containerAnimation | Native swipe + scroll-snap | Full |
| 15 | Multi-layer parallax | `/` hero (title / orb / network at different rates); every `PageHeader` (index + motif); `/architecture` → `FrontendLayers.tsx` | Scrubbed `yPercent` per layer | ScrollTrigger scrub | None | Full |
| 16 | Scroll-driven animation | All of the above plus `PackageAnatomy` stage tilt | `scrub: true / number` | ScrollTrigger | — | Full |
| 17 | Scroll progress indicators | Nav hairline (all routes); `/docs` reading bar; `/` chapter progress rail | `ScrollTrigger.create` → `scaleX/scaleY` | ScrollTrigger | Still present (instant) | Full |
| 18 | Chapter navigation | `/` chapter buttons (Lenis scroll to progress); `/docs` scroll-spy sidebar; `/architecture` stage tabs | Buttons compute pinned-range offsets | ScrollTrigger + Lenis | Anchor jumps | Full |
| 19 | Cursor-reactive fluid trail | Global → `layout/CursorTrail.tsx` | 22-point spring chain drawn as tapered gradient ribbon; sleeps when idle | Canvas 2D | Not rendered (touch / reduced) | Full |
| 20 | Magnetic buttons | Primary CTAs → `ui/Button.tsx` `magnetic` | `quickTo` with elastic ease toward pointer | gsap.quickTo | Normal button | Full |
| 21 | Spring physics | Magnetic elastic return; cursor-trail springs; `StatusPill` elastic pop | Elastic eases, damped spring integration | GSAP, custom | — | Full |
| 22 | Inertia | `ReleaseTimeline` drag; `/provenance` evidence-graph node throws | Draggable + InertiaPlugin | GSAP | Drag without momentum | Full |
| 23 | Metaball effects | `GooeyOrbs` | see #7 | SVG filter | Static | Full |
| 24 | Mouse-reactive depth | `/` hero layers + WebGL tilt; `/` route bento 3D tilt with pointer-tracked glow | quickTo rotationX/Y, CSS `--mx/--my` | GSAP | Flat | Full |
| 25 | Interactive terminal | `/` → `home/LivePreview.tsx` | Real commands: `help`, `verify <pkg>`, `limits`, `mode`, `clear`; history ↑/↓; calls the real provider | React + provider | — | Full |
| 26 | Truthful staged scanning | `/verify` → `VerifyStudio.tsx` + `visuals/RadarScanner.tsx` | Sweep spins only while the request is in flight; stage results appear only after the report arrives, then replay the report's own `logs` (labelled "simulated timing" in demo) | GSAP, SVG | Instant results | Full |
| 27 | Expandable evidence cards | `/verify`, `/packages/*` → `ui/EvidenceCard.tsx` | `aria-expanded` disclosure, height auto tween, evidence rows stagger | GSAP | Instant open/close | Full |
| 28 | Interactive architecture diagram | `/architecture` → `PipelineDiagram.tsx` | Clickable components → details panel; links lit per stage; packets along links | DrawSVG, MotionPathPlugin | Static diagram, clickable | Full |
| 29 | Package drop / upload | `/verify` → `Dropzone.tsx` | Drop/choose `.whl`/`.tar.gz`: filename parsed, SHA-256 computed **in browser**, compared to PyPI digest in results | WebCrypto | File input | Partial — **no upload**: the backend verifies PyPI-hosted artifacts and has no upload capability |
| 30 | Before/after release comparison | `/compare` → `BeforeAfter.tsx` | Draggable/keyboard wipe between two inventory mosaics | Draggable (proxy) | Arrow keys | Full |
| 31 | Interactive timeline | `/packages/*`, `/compare` → `ReleaseTimeline.tsx` | Versions positioned by upload time; draggable; nodes are buttons | Draggable + Inertia | Static row | Full |
| 32 | Cmd/Ctrl+K palette | Global → `CommandPalette.tsx` | Navigate, verify/inspect fixtures, search docs, toggle motion / data mode; arrow + Enter | React, GSAP entrance | — | Full |
| 33 | Hover micro-interactions | Cards, tiles (glow + arrow rotate), chips, nav, capability numerals, timeline dots | CSS transitions + GSAP | — | — | Full |
| 34 | Animated package anatomy | `/packages/*` Inventory tab → `PackageAnatomy.tsx` | Layers built from the real inventory (archive / dist-info / modules / data) | GSAP, CSS 3D | Collapsed stack | Full |
| 35 | SHA-256 fingerprint | `/packages/*` Fingerprint tab → `Fingerprint.tsx`; `HashText.tsx` everywhere | 64-nibble radial bars (published vs observed, mismatches red + counted); hex scramble-decode | SVG, ScrambleTextPlugin | Static ring / text | Full |
| 36 | Provenance chain | `/provenance` → `ProvenanceExplorer.tsx` | Scroll-drawn path, nodes light up, failure point called out | DrawSVGPlugin, ScrollTrigger | Fully drawn | Full |
| 37 | Network graph (data-grounded) | `/provenance` → `TrustGraph.tsx` | Entities/edges built only from report fields; broken bindings dashed red; draggable with inertia | SVG + Draggable | Static layout | Partial — evidence graph is Full; a **dependency** graph is omitted: the backend does not verify dependencies, and drawing one would imply it does |
| 38 | Radar / scanner visual | `/verify` → `RadarScanner.tsx`; `PageHeader` radar motif | Sweep + ring pulse; blips = real checks | GSAP SVG | Static | Full |
| 39 | File comparison animation | `/compare` → `CompareView.tsx` | Flip-animated filter transitions, enter/leave, size bars grow, count-up stats | Flip | Instant | Full |
| 40 | Integrity status transitions | `StatusPill` (scramble + elastic on change); provenance node morphs; verify radar blips recolour as logs replay | ScrambleText, MorphSVG | Instant | Full |
| 41 | Progress indicators | `/verify` progress bar (determinate after response, indeterminate while waiting); RECORD meter; nav & docs bars | CSS + GSAP | — | Full |
| 42 | Terminal logs | `/verify`, `/` → `ui/Terminal.tsx` | `aria-live` log with level glyphs | React | — | Full |
| 43 | 3D / exploded package structure | `/packages/*` → `PackageAnatomy.tsx` | CSS 3D plates, scroll-tilted, toggle explode/collapse button | GSAP, CSS preserve-3d | Button toggle only | Full |
| 44 | Route transitions | Global → `PageTransition.tsx` + `app/template.tsx` | Two-layer curtain cover/reveal + staggered `[data-enter]` blocks | GSAP | Instant navigation | Full |
| 45 | Smooth scrolling | Global → `MotionProvider.tsx` | Lenis synced to `gsap.ticker` and `ScrollTrigger.update` | Lenis 1.3 | Native scroll | Full |
| — | Rive / Lottie | — | — | — | — | Omitted — no asset need that GSAP/SVG/Three don't already cover; avoids extra runtimes |
| — | Post-processing (bloom etc.) | — | — | — | — | Omitted — shader tonemapping gives the look at a fraction of the GPU cost |

**Coverage of the requested list (rows 1–43):** 40 Full, 3 Partial (#7 gooey limited to loaders,
#29 no upload by design, #37 evidence graph instead of dependency graph). That is ≈93% fully
implemented, 100% represented, with every partial explained by product truthfulness rather than
effort.
