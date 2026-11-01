# Design System — ARCTIC STEEL × ULTRAVIOLET VOID (v2)

v2 changes: surface scale `--bg-0…3`; status tokens for all seven states; elevation `--elev-1…3`; radii reduced to three (`--r-sm` 4 / `--r-md` 10 / `--r-lg` 18); motion tokens; 13 px minimum text; sentence-case kickers instead of tracked caps; Instrument Serif removed.

Source of truth: `src/app/globals.css` (`:root` tokens). Components use tokens only — no raw hex in
component CSS except inside SVG/GLSL where CSS variables are unavailable.

## Language
Cinematic dark + technical/instrumental foundation, Swiss/editorial type and grid discipline,
glass reserved for *depth layers* (scanner card, palette, nav, provenance detail), bento for grouping
(home route grid, compare stats, RECORD grid), and two small neo-brutalist accents (`.card--brutal`
on the "What a PASS does not mean" cards; hard offset shadow) — never mixed at random.

## Colour roles
| Token | Value | Role |
|-------|-------|------|
| `--void`, `--void-2` | #03040a, #060815 | Base canvas |
| `--navy-950…800` | #080b1c → #111834 | Surfaces |
| `--steel-700…300` | #1b2442 → #8a95b6 | Lines, secondary text, inactive |
| `--silver`, `--ice`, `--ice-dim` | #c4cce0, #eef3ff, #b9c3dc | Metallic highlight, primary text, body text |
| `--uv-700…300` | #3a1fb8 → #c3b4ff | Primary creative energy, focus, active |
| `--plasma` | #ff4fd8 | Rare dramatic accent (gradients' end, packets, identity nodes) |
| `--mint` | #5ef2c6 | **PASS only** (and "live backend") |
| `--amber` | #ffb547 | WARN + all DEMO labels |
| `--red` | #ff5a6e | FAIL |

Status is never colour-only: `StatusPill` = glyph + text + colour + border style, and the evidence map adds a distinct shape per status (circle+tick, octagon, triangle, dashed circle, dotted circle, bar, dashed diamond).

## Typography
| Role | Family | Usage |
|------|--------|-------|
| Display | Archivo (variable width, `font-stretch` 112–125%) | Headlines, numerals |
| Body | Inter Tight | Copy, UI |
| Mono | JetBrains Mono | Hashes, paths, labels, eyebrows |

Scale: `--fs-xs` 12px → `--fs-hero` clamp(3.2rem, 11.5vw, 13.5rem). Fonts are self-hosted at build
time by `next/font` (no runtime Google requests).

## Space, radius, layout
4px base (`--s-1`…`--s-10`), radii 6/12/22px, container 1360px with `--gutter` clamp(1rem, 4vw, 3.5rem).
12-col grid helper `.grid-12`; most pages use 2-column asymmetric splits that collapse below ~960px.

## Components (all in `src/components`)
| Component | File | Notes |
|-----------|------|-------|
| Button (magnetic, ripple, link/button) | `ui/Button.tsx` | primary / default / ghost, sm/md |
| StatusPill, DemoTag | `ui/StatusPill.tsx` | animated status transitions |
| EvidenceCard | `ui/EvidenceCard.tsx` | disclosure, evidence `<dl>`, "What this does not prove" |
| Tabs | `ui/Tabs.tsx` | WAI-ARIA tabs, roving focus, Flip indicator |
| Terminal | `ui/Terminal.tsx` | aria-live log |
| HashText | `ui/HashText.tsx` | scramble-decode digest |
| Toasts | `ui/Toast.tsx` | polite live region |
| Empty / Error / Loading / Skeleton | `ui/States.tsx` | every async view uses them |
| Tooltip | native `title` + always-visible text equivalents | no info is hover-only |
| Modal | `layout/CommandPalette.tsx` | `role=dialog aria-modal`, focus return |
| Nav, Footer, PageHeader, PageTransition, CursorTrail | `layout/*` | shared chrome |
| Visuals | `visuals/*` | ChromeHero, MorphBlob, ParticleNetwork, RadarScanner, Fingerprint, PackageAnatomy, GooeyOrbs |

## Accessibility
Skip link, landmark structure, visible `:focus-visible` ring (UV-300), 44px targets, keyboard paths
for every drag interaction (timeline nodes are buttons; wipe slider is `role=slider` with arrows),
`aria-live` for scanner/terminal/results, reduced-motion parity, contrast: ice (#eef3ff) on void ≈ 18.4:1,
ice-dim ≈ 11.6:1, steel-300 ≈ 6.9:1, mint ≈ 14.6:1, amber ≈ 11.7:1, red ≈ 6.8:1 (all measured against `--void`). `--steel-400` (3.8:1) is used only for non-text decoration.

## Animation architecture
- `src/lib/motion/gsap.ts` registers all plugins once and defines eases `pv.out`, `pv.inOut`.
- `MotionProvider` owns reduced-motion state, pointer type and the Lenis instance.
- Components animate only inside `useGSAP({ scope })` / `gsap.matchMedia()`; callbacks wrapped in `contextSafe`.
- Heavy visuals (`three`, canvas) are `next/dynamic` with `ssr:false`, pause off-screen, and dispose GPU resources on unmount.
