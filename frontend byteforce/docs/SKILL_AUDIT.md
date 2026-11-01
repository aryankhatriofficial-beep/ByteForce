# Skill Audit

Inventory method: listed `~/.claude/skills`, `.claude/skills`, `~/.agents/skills`, `.agents/skills`; resolved symlinks with `readlink -f` and de-duplicated. Only `~/.claude/skills` exists on this machine → **48 unique `SKILL.md` files**. Each skill's front-matter was read; the GSAP skills, find-skills and firecrawl-website-design-clone were read in full.

Directly applied: **8** (7 GSAP + firecrawl-search). Lightly informed the work: find-skills, firecrawl-developer-index (via bundled Next docs instead), firecrawl-seo-audit (basics only). The rest are unrelated to a frontend build and were deliberately not forced in.

| # | Skill | Purpose | Relevance | How it was used / why not |
|---|-------|---------|-----------|---------------------------|
| 1 | `gsap-core` | Tweens, eases, stagger, matchMedia, reduced motion | High | Used everywhere: `gsap.to/from/fromTo`, custom eases, `gsap.matchMedia()` for desktop-only pins and reduced motion (Chapters, Capabilities, Provenance, Architecture). |
| 2 | `gsap-react` | useGSAP, scope, contextSafe, cleanup, SSR | High | Every animated component uses `useGSAP({ scope })`; pointer handlers wrapped in `contextSafe`; GSAP only on client; `revertOnUpdate` added after diagnosing a real hydration bug. |
| 3 | `gsap-scrolltrigger` | Pinning, scrub, batch, containerAnimation, refresh | High | Pinned chapters/provenance/architecture, horizontal containerAnimation sequence, `ScrollTrigger.batch` reveals, scrubbed parallax, progress bars, scroll-spy; explicit `pinSpacing:true` fix for a flex-parent pin. |
| 4 | `gsap-timeline` | Sequencing with position parameter / labels | High | Hero entrance, route curtain, chapter timeline, fingerprint build, provenance draw timelines. |
| 5 | `gsap-plugins` | SplitText, ScrambleText, MorphSVG, DrawSVG, MotionPath, Flip, Draggable, Inertia, Observer, CustomEase | High | All registered once in `src/lib/motion/gsap.ts`; installed from public `gsap` package (no Club token, per the skill). |
| 6 | `gsap-performance` | Transforms only, quickTo, will-change, pause off-screen | High | `quickTo` for magnetic + hero depth; transform/opacity-only tweens; IntersectionObserver pauses for WebGL/canvas; limited particle count. |
| 7 | `gsap-utils` | clamp, mapRange, toArray, random, selector | Medium | `gsap.utils.toArray`, `selector`, `random` used in Chapters, Capabilities, PageHeader motifs. |
| 8 | `gsap-frameworks` | GSAP in Vue/Svelte | Not relevant | Read; project is React/Next.js so gsap-react applies instead. |
| 9 | `find-skills` | Discover installable skills | Low | Read. Installed skills already covered the build; no new skills were installed (avoids unvetted third-party code). |
| 10 | `firecrawl-search` | Web search + tool discovery | Medium | Used via the Firecrawl MCP `firecrawl_search` for Awwwards dark/dev-tool/WebGL storytelling references. Results were thin (gallery listings); extracted principles only, copied nothing. |
| 11 | `firecrawl-website-design-clone` | Extract a reference site's design system | Not applied | No reference URLs were present in this session's messages; cloning another brand is also out of scope for an original identity. |
| 12 | `firecrawl-scrape` | Read a known URL | Not applied | No specific reference page warranted scraping after the search. |
| 13 | `firecrawl-qa` | Test a live public site | Not applied | Targets public URLs reachable by Firecrawl's hosted browser; the app runs on localhost. QA done with the built-in browser instead. |
| 14 | `firecrawl-deep-research` | Long cited reports | Not relevant | Not a research-report task. |
| 15 | `firecrawl-competitive-intel` | Competitor monitoring | Not relevant | — |
| 16 | `firecrawl-developer-index` | Library docs lookup | Low | Next.js 16 conventions were read from the bundled `node_modules/next/dist/docs` (per the scaffold's AGENTS.md), which is the authoritative local source. |
| 17 | `firecrawl` | Umbrella CLI skill | Not applied | MCP tools used directly instead of the CLI. |
| 18 | `firecrawl-agent` | Autonomous multi-page extraction | Not relevant | — |
| 19 | `firecrawl-alexandria` | Structured data providers | Not relevant | — |
| 20 | `firecrawl-build` | Integrate Firecrawl into app code | Not relevant | PyVerify must not depend on Firecrawl. |
| 21 | `firecrawl-build-interact` | App-level /interact | Not relevant | — |
| 22 | `firecrawl-build-onboarding` | API key setup | Not relevant | No credentials created or requested. |
| 23 | `firecrawl-build-scrape` | App-level /scrape | Not relevant | — |
| 24 | `firecrawl-build-search` | App-level /search | Not relevant | — |
| 25 | `firecrawl-business-contacts` | Company contacts | Not relevant | — |
| 26 | `firecrawl-company-directories` | Company lists | Not relevant | — |
| 27 | `firecrawl-crawl` | Bulk site crawl | Not relevant | — |
| 28 | `firecrawl-dashboard-reporting` | Dashboard metrics | Not relevant | — |
| 29 | `firecrawl-demo-walkthrough` | UX walkthrough of a live product | Not applied | Would need a public URL; walkthrough done locally in the built-in browser. |
| 30 | `firecrawl-download` | Save a site offline | Not relevant | — |
| 31 | `firecrawl-fantasy-sports` | Fantasy sports | Not relevant | — |
| 32 | `firecrawl-interact` | Drive a live browser | Not relevant | Built-in browser used for local QA. |
| 33 | `firecrawl-job-postings` | Jobs | Not relevant | — |
| 34 | `firecrawl-knowledge-base` | Build KB from web | Not relevant | — |
| 35 | `firecrawl-knowledge-ingest` | Export docs portals | Not relevant | — |
| 36 | `firecrawl-lead-gen` | Prospects | Not relevant | — |
| 37 | `firecrawl-lead-research` | Enrich people/companies | Not relevant | — |
| 38 | `firecrawl-map` | Site URL discovery | Not relevant | — |
| 39 | `firecrawl-market-research` | Market figures | Not relevant | — |
| 40 | `firecrawl-monitor` | Change alerts | Not relevant | — |
| 41 | `firecrawl-parse` | Local file → markdown | Not relevant | — |
| 42 | `firecrawl-research-index` | Paper index | Not relevant | — |
| 43 | `firecrawl-research-papers` | Literature review | Not relevant | — |
| 44 | `firecrawl-seo-audit` | SEO audit | Low | Not run (localhost). Basics applied: per-route `<title>` via metadata, semantic headings, `lang`, description. |
| 45 | `firecrawl-shop` | Shopping | Not relevant | — |
| 46 | `firecrawl-workflows` | Workflow router | Not relevant | — |
| 47 | `cc-usage` | Claude Code token/cost analytics | Not relevant | — |
| 48 | `usage-monitor` | Subscription quota monitor | Not relevant | — |

## Connectors / MCP servers / tools actually used

| Tool | Used for |
|------|----------|
| Firecrawl MCP (`firecrawl_search`) | One visual-research query (see above). |
| Built-in browser (Claude Browser pane) | All visual QA: desktop 1440/1280, mobile 375, reduced motion, command palette, overflow measurement, console errors. |
| Next.js bundled docs (`node_modules/next/dist/docs`) | Next 16 conventions (async `params`, `PageProps`, `template.tsx`). |

Available but **not** used: Playwright MCP (built-in browser covered the same checks), Context7 docs, Vercel/Supabase/Render/Slack/Google/Adobe/Eden connectors (no need; no deployment, no external data). Figma, Linear, Notion, GitLab, Atlassian, Datadog, ClickUp, Monday, Intercom, Superme required authentication and were not needed. GitHub/Asana/PagerDuty connectors failed to connect. No paid service, API key or credential was created or requested.

Plugin skill packs also present in the session (design-skills, superpowers, engineering, etc.) are outside the four skill directories audited above; their guidance overlapped with the work (accessibility, design systems) but none was invoked as a separate workflow.
