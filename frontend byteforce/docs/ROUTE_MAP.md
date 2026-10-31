# Route Map

| Route | Signature moment | Key interactions | Data |
|---|---|---|---|
| `/` | Exploded chrome hex artifact (WebGL, SVG fallback) + kinetic "BEYOND THE BINARY." + drawn evidence spine | Pointer depth, scroll explodes the artifact, pinned five-part investigation story with masked hand-offs and morphing glyph, horizontal pipeline track, working shell, limitations, route cards, CTA | Shell uses the live backend (or opt-in demo) |
| `/verify` | Evidence map (7 stages, status shapes) | Project → PyPI versions/artifacts → attestation switch → publisher policy → local digest compare → Verify → indeterminate scan → stage-by-stage reveal → verdict with reasons; detail panel per stage; backend log + raw response | `POST /api/v1/verify`, pypi.org |
| `/packages` | Compact header | Open any PyPI project; demo fixtures only in demo mode | pypi.org |
| `/packages/[package]` | Dossier sheets unfolding | Identity sheet, release timeline + full selector, declared metadata, published artifacts with copyable digests and "Verify this file", evidence tabs only when this session verified it | pypi.org + session reports |
| `/compare` | Split A/B file trees | A/B selectors + timeline + swap, PyPI metadata diff (Requires-Python, licence, dependencies, artifacts), explicit "Compare inventories", Flip-filtered file diff, sdist↔wheel note, scope warning | pypi.org + 2× `/api/v1/verify` on request |
| `/provenance` | Scroll-drawn chain with status-morphing nodes | Release → attestation → publisher → repository → commit → source snapshot; gaps stay visibly hollow; draggable evidence graph; explicit verify action | session report or `/api/v1/verify` on request |
| `/architecture` | Pinned pipeline diagram, trust zones | Six stages (incl. source trace as a separate workflow), keyboard-focusable components, packets on active links | static |
| `/docs` | Reading progress + verdict simulator | Search with highlight, scroll-spy, copy buttons, API usage, verdicts, security model, formats | static |

Global: nav with connection state, ⌘K palette, route veil transitions, boot sequence (first visit), custom cursor, toasts, footer.
