# Reference & Skill Audit

## 1. Inventory — what actually exists in this environment

| Location | Contents | Inspected |
|---|---|---|
| `~/.claude/skills/` | **48** skills (7 GSAP, 38 Firecrawl, find-skills, cc-usage, usage-monitor). Symlinks resolved; 48 unique. | Front-matter of all 48; full text of all GSAP skills, `find-skills`, `firecrawl-website-design-clone` |
| `~/.claude/plugins/**/SKILL.md` | **33** plugin skills (frontend-design, skill-creator, plugin-dev ×7, mcp-server-dev ×3, math-*, discord/telegram/imessage access, etc.) | Full text of `frontend-design`; names/descriptions of the rest |
| `.claude/skills`, `.agents/skills`, `~/.agents/skills` | **Do not exist** | — |
| Session plugin skills (design-skills:*, design:*, superpowers:*, engineering:*, figma:*, etc.) | Listed by the harness; no SKILL.md files on disk to read | Names/descriptions only — **not inspected** |
| Next.js bundled docs `node_modules/next/dist/docs` | Official docs for the installed version | Dynamic routes, template, PageProps |
| MCP | Firecrawl (search/scrape), Playwright, built-in browser, Context7, Vercel, Supabase, Adobe, Slack, Google Drive, Eden… | Playwright + built-in browser used for QA |
| Uploaded references | None in this conversation (no files, no URLs) | — |

Requested by name but **not found**: `web-design-guidelines`, any Lenis-specific skill. `frontend-design` exists only as a marketplace plugin file (read directly).

Total unique skills on disk: **81** (48 user + 33 plugin).

## 2. Classification

**A. Directly relevant (9):** gsap-core, gsap-react, gsap-scrolltrigger, gsap-timeline, gsap-plugins, gsap-performance, gsap-utils, frontend-design, Next.js bundled docs.

**B. Relevant with conditions (3):** firecrawl-search (visual research — only with real reference URLs), firecrawl-website-design-clone (only to study, never to copy a brand), Playwright MCP (QA/perf measurement — used).

**C. Low relevance (4):** find-skills (no install needed), firecrawl-qa / firecrawl-demo-walkthrough (need a public URL; app is local), firecrawl-seo-audit.

**D. Not relevant (65):** remaining Firecrawl data/lead/shop/sports skills, cc-usage, usage-monitor, gsap-frameworks (Vue/Svelte), all plugin-dev / mcp-server-dev / math / messaging / receipts / session-report / skill-creator / claude-md / hookify / cwc-makers / playground / example skills.

## 3. Route map

| Route | Skills / guidance | Technique chosen | Perf risk → mitigation | A11y |
|---|---|---|---|---|
| `/` | frontend-design (one bold moment), gsap-timeline, scrolltrigger | Low-poly chrome hex artifact (Three.js, named imports) + SVG evidence spine; masked chapter story | WebGL → lazy, DPR ≤1.5, paused offscreen | Static frame + same text under reduced motion |
| `/verify` | gsap-react (contextSafe), timeline | SVG Evidence Map, phase choreography | Avoid per-frame React state | Nodes are buttons; live region |
| `/packages/[pkg]` | frontend-design (structure = information) | Dossier layout, copyable hashes, Flip tabs | No auto backend call | Copy feedback announced |
| `/compare` | gsap-plugins (Flip) | Split file trees, metadata diff | Flip only on filter change | Colour + glyph + text |
| `/provenance` | scrolltrigger, plugins (DrawSVG, MorphSVG) | Pinned chain, gap nodes visibly hollow | pinSpacing explicit | Tabs mirror the SVG |
| `/architecture` | gsap-performance | Pure SVG (no foreignObject), CSS packet animation only on the active stage | Removed 15 perpetual tweens | SVG nodes are focusable |
| `/docs` | frontend-design (writing) | Editorial layout, scroll-spy, copy buttons | Batch reveals once | Real tables, headings |

Shared: design tokens (frontend-design), motion tokens + `matchMedia` reduced motion (gsap-core), `useGSAP` cleanup (gsap-react), `quickTo` for cursor (gsap-performance), route transition timeline (gsap-timeline).

## 4. Key judgements (reference → decision)

| Reference says | Fits? | Decision |
|---|---|---|
| gsap-performance: prefer `quickTo` for pointer followers | Yes | Cursor uses one rAF loop writing transforms; no React state |
| frontend-design: avoid all-caps eyebrows, "01/02" on non-sequences, single accent word, `→` in buttons | Yes — they were all present | Removed; numbering kept **only** on the evidence spine (a real sequence) |
| frontend-design: two type families max | Mostly | Archivo (display, incl. italic) + Inter Tight (UI) + JetBrains Mono for hashes only — monospace is functional data here, not decoration. Dropped Instrument Serif |
| gsap-scrolltrigger: pinning in flex parents disables pinSpacing | Yes | Explicit `pinSpacing: true` |
| Owner brief: liquid distortion, shaders | Conditionally | One shader scene (hero) only; liquid effects via static SVG filters, never animated filter parameters |
| Owner brief: Lenis | Conditionally | Kept (already integrated, ticker-synced); disabled under reduced motion and on touch |
| Rive / Lottie / R3F / Framer Motion | No | Not installed — GSAP + SVG + one Three scene cover everything; adding them would duplicate capability |

## 5. Conflicts & redundancy
- Lenis smooth scroll vs native `scroll-behavior` — resolved by Lenis owning wheel scroll only.
- Owner asks for "glass" and frontend-design warns against card kits — glass reserved for overlays (palette, nav) only.
- Owner's "particles" vs performance mandate — particle field cut to ≤60 nodes, desktop only.
- Two animation paths existed for reveals (per-component + template); consolidated into one reveal primitive.

## 6. Recommended stack (unchanged libraries, no new dependencies)
Next.js 16 App Router · React 19 · GSAP 3.15 (+ ScrollTrigger, SplitText, ScrambleText, MorphSVG, DrawSVG, MotionPath, Flip, Draggable, Inertia) · Lenis · Three.js (named imports, one lazy scene) · CSS Modules + tokens · Vitest. PyPI JSON API (CORS-enabled, read-only) for public release metadata.

## 7. Could not inspect
- The PyVerify backend source and its real response schema (other machine).
- Session plugin skills without on-disk SKILL.md files.
- Any Rising Wave material (none provided here) — only the general ambition is borrowed, nothing visual.
