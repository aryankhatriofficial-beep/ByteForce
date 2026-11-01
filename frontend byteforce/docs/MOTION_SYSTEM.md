# Motion System

One motion language, four distinct jobs: **boot** (brand, once), **route transitions** (orientation),
**data loading** (stable layout while content arrives) and **verification loading** (honest progress).
They never stand in for each other.

## Tokens
CSS (`src/app/globals.css`) and JS (`src/lib/motion/tokens.ts`) share one scale:

| Token | Value | Used for |
|---|---|---|
| `--dur-instant` / `DUR.instant` | 90 ms | press feedback |
| `--dur-fast` / `DUR.fast` | 180 ms | hover, colour, border |
| `--dur-base` / `DUR.base` | 320 ms | toggles, popovers, cursor ring |
| `--dur-slow` / `DUR.slow` | 560 ms | panel reveals, entrances |
| `pv.out` (`--ease-out`) | cubic-bezier(.16,1,.3,1) | almost everything |
| `pv.inOut` (`--ease-inout`) | cubic-bezier(.76,0,.24,1) | veils, wipes, line draws |
| `--ease-spring` | cubic-bezier(.34,1.56,.64,1) | toggles, swap button |
| `ROUTE` | cover 300 · navigate ≤340 · reveal 460 · safety 2500 (ms) | route transitions |

GSAP is split: `src/lib/motion/gsap.ts` (core + ScrollTrigger + SplitText + ScrambleText, every route)
and `src/lib/motion/gsap-extra.ts` (MorphSVG, DrawSVG, MotionPath, Flip, Draggable, Inertia — only
imported by the components that use them).

## 1. Initial boot — "Forensic initialization" (`layout/BootSequence.tsx`)
Void → a point of light → the hex artifact and fine grid draw in → a UV beam crosses → the six
evidence-spine labels appear → the wordmark resolves → the overlay closes to a horizontal line.
- ~1.5 s, first visit per browser session only (`sessionStorage["pv.booted"]`).
- An inline script in `<head>` hides it **before first paint** for returning sessions and reduced motion.
- Skip button, Esc or any click finishes it instantly. A CSS fallback hides it after 2.4 s even if JS fails.
- The page renders underneath; nothing waits on the animation. The labels are the evidence spine's
  stage names — no "scanning…" claims.

## 2. Route transitions (`layout/PageTransition.tsx` + `app/template.tsx`)
1. **Exit** — current content dims (opacity only; transforms/filters on `<main>` would break fixed/pinned children).
2. **Signature layer** — a void veil with liquid-chrome edges slides in; the evidence spine draws across it and the destination route is named.
3. **Navigate** — `router.push` at the end of cover, and **also** by a 340 ms timer, so navigation never depends on animation frames.
4. **Reveal** — a UV scanning beam crosses, the veil exits the opposite side, `[data-enter]` blocks stagger in.

Direction follows route order (forward slides one way, backward the other). Repeated clicks retarget
the pending navigation (latest wins, no double push). A 2.5 s safety timer clears the veil if a route
never mounts. Browser back/forward and direct loads skip the veil and get a light "arrival" scan
line under the nav. The reveal is triggered from a plain layout effect outside any GSAP context,
so a context revert can't undo it.

## 3. Section transitions
- `[data-reveal]` — masked clip-path reveal on scroll, batched with `ScrollTrigger.batch` (template-level primitive).
- `SplitHeading` / `PageHeader` — masked line/word reveals.
- Home: pinned chapter story with clip-path hand-offs and a morphing glyph; horizontal capability track; three-depth hero parallax.
- Provenance: scroll-drawn chain with status-morphing nodes. Architecture: pinned stage stepper, links drawn once.

## 4. Data loading
Skeletons with a scanning edge (not grey pulses), fixed-height release boxes to avoid layout shift,
inline errors with Retry. Only the component that is loading shows a loading state.

## 5. Verification loading (`verify/VerifyStudio.tsx`, `evidence/EvidenceMap.tsx`)
Phase rail: Ready → Select release → Request → Evidence → Verdict.
- **Request**: an indeterminate beam sweeps the evidence spine; every node shows "waiting". No percentages — the backend reports no progress.
- **Evidence**: only after the response arrives, stages are revealed one by one (1.6 s total) from the report. This is a reveal of returned data, labelled as such.
- **Verdict**: a clip-path wipe opens the verdict panel; reasons link back to their stage.
- Errors (network, timeout, 4xx/5xx) end the run with the backend's message and Retry; nothing is shown as verified.

## Micro-interactions
Buttons: gradient clip wipe on hover, press scale, click ripple, magnetic pull only on primary CTAs.
Copy: icon morphs to a drawn tick with an announced "Copied". Tabs: Flip-animated indicator. Evidence
nodes: lift on hover, glyph pop on reveal, halo on selection. Toggles: spring thumb. Popovers: scale-in
from their anchor. Swap (compare): spring rotation.

## Cursor (`layout/Cursor.tsx`)
A 6 px core that tracks the pointer exactly and a 34 px ring that eases behind it (factor 0.32 per
frame; one rAF loop that sleeps when settled; transforms only; no React state). Contextual states:
hover (ring grows, UV fill, optional label from `data-cursor`, e.g. "Inspect", "Copy"), press
(compresses, plasma), disabled (dashed). Text fields, textareas and code blocks hide the custom
cursor so only the native I-beam shows. Enabled only for `(hover: hover) and (pointer: fine)` without
reduced motion; otherwise the native cursor is untouched. The layer is `pointer-events: none`.

## Reduced motion
`prefers-reduced-motion` or the command-palette toggle (`localStorage["pv.motion"]`): no boot, no
veil (instant navigation), no Lenis, no cursor, no pinning/scrubbing, no loops; WebGL renders a single
frame; CSS durations collapse to ~0. Every piece of content is still rendered and readable.

## Performance rules applied
Transform/opacity only; no animated filter parameters; one modest `backdrop-filter` (nav);
heavy scenes lazy-loaded and paused off-screen/in hidden tabs; SMIL packets only on the active
architecture stage; every `useGSAP` scoped and reverted; listeners and observers removed on unmount.
