# Backend Integration Guide (for the agent on the backend machine)

You are connecting this frontend (`frontend byteforce/`) to the **already-merged** PyVerify backend.
The backend is frozen: do not change its verification logic, weaken limits, or relax security to
make the UI "look" connected. All adaptation should happen in the frontend's two seam files, or in a
thin, additive adapter route if the backend lacks something.

## 0. What is already done in this frontend

| Concern | Where | State |
|---------|-------|-------|
| HTTP client (timeout, abort, error parsing, no credentials) | `src/lib/api/client.ts` | ready |
| Route table + request body mapping | `src/lib/api/endpoints.ts` | routes per owner; optional field names **unconfirmed** |
| Payload → UI types (snake/camel, status spellings, nulls) | `src/lib/api/normalize.ts` | **adapt to real JSON** |
| Live vs demo selection | `src/lib/api/provider.ts`, `src/lib/DataModeProvider.tsx` | ready |
| Data hooks + session cache | `src/lib/useApi.ts` | ready |
| Types (source of truth for the UI) | `src/lib/api/types.ts` | ready |
| Demo fixtures (fictional) | `src/lib/api/demo/fixtures.ts` | isolated, labelled |

Live mode is the default (backend `http://127.0.0.1:8765`). Demo fixtures are **opt-in only** (nav
connection menu or command palette, session-scoped). A failing live request shows an error; it never
falls back to demo data. Release lists and published digests come from pypi.org directly.

## 1. Inspect the real backend first

On the backend machine, find:

1. How it is served (FastAPI/Flask/CLI only?). If it is **CLI-only**, you need a small HTTP wrapper
   (see §5) — do not rewrite the core.
2. The route that runs verification and its exact request/response JSON.
3. Whether a "list releases" route exists.
4. Status spellings used per check (`PASS`, `passed`, `ok`, …) and check identifiers.
5. Error response format.
6. CORS configuration.

Record the findings at the top of `docs/API_CONTRACT.md` under a new "Actual backend" heading.

## 2. Configure

Nothing to configure if the backend runs on `http://127.0.0.1:8765`. Otherwise:

```bash
cp .env.example .env.local
# NEXT_PUBLIC_PYVERIFY_API_BASE_URL=http://127.0.0.1:8765
npm install && npm run dev
```

The nav badge shows **Backend connected** (mint) once `GET /api/health` answers. The CSP in
`next.config.ts` adds the backend origin to `connect-src` automatically.

## 3. Routes and request — `src/lib/api/endpoints.ts`

Routes are `GET /api/health` and `POST /api/v1/verify` with `{ project, version, filename }`.
Confirm the three optional field names in `OPTIONAL_FIELDS` (`verify_attestations`,
`expected_repository`, `expected_workflow`) against the backend; they are only sent when set.

## 4. Map payloads — `src/lib/api/normalize.ts`

`normalizeReport()` already:

- camelises snake_case keys recursively;
- maps check id aliases (`CHECK_ALIASES`) and status spellings (`normalizeStatus` in `src/lib/status.ts`);
- turns missing sections into `null` (rendered as UNAVAILABLE, never PASS);
- derives `overall` if the backend doesn't send it.

Typical adaptations:

| Backend shape | Change |
|---------------|--------|
| Checks are an object keyed by id (`{"digest": {...}}`) | Convert with `Object.entries` before `normalizeChecks`. |
| Digest at `artifact.sha256` | Add to the `expectedSha256` fallback chain. |
| Provenance absent expressed as `status: "missing"` | Already → `unavailable`; also set `absent: true` when that string appears. |
| No `logs` | Leave empty — the UI shows only the request line and still renders results. |
| No `inventory.entries[].sha256` | Compare falls back to size-based change detection automatically. |

Add a unit test in `src/lib/lib.test.ts` with a **real backend response captured on that machine**
(redact nothing sensitive is expected — it's public PyPI data) and assert the normalised output.

## 5. If the backend is a CLI or library only

Add an *additive* wrapper (e.g. `pyverify/http_api.py`) that calls the existing entry point and
serialises its result object. Keep every existing limit (download size cap, archive bounds,
timeouts) — the wrapper must not bypass them. Enable CORS for the frontend origin only.

## 6. Authentication

None is assumed. If the backend requires a token:
- **Do not** add it as `NEXT_PUBLIC_*` (it would ship to every browser).
- Instead add a Next.js route handler (`src/app/api/pyverify/[...path]/route.ts`) that forwards to
  the backend with a server-only env var, and point `NEXT_PUBLIC_PYVERIFY_API_BASE_URL` at the
  frontend's own origin. Update the CSP accordingly.

## 7. Verification states — must stay honest

| Situation | Required UI result |
|-----------|-------------------|
| Digest/size mismatch | `digest` = FAIL |
| No attestation published | `provenance` = UNAVAILABLE, `absent: true` (never FAIL, never PASS) |
| Attestation present but invalid | `provenance` = FAIL with `failure_reason` |
| No policy supplied | `publisher_policy` = NOT CONFIGURED (or omitted) |
| Policy supplied, no verified identity | `publisher_policy` = UNAVAILABLE |
| Source trace not run (normal for `/verify`) | omit `source_trace` → UI shows NOT CHECKED |
| Backend crashed mid-check | that check UNAVAILABLE (or HTTP 5xx for the whole run) — not PASS |

## 8. Acceptance checklist

- [ ] `npm run check` passes (typecheck, lint, tests, production build).
- [ ] Nav shows Backend connected; no amber DEMO tags appear on live results.
- [ ] Verify a package **with** PEP 740 provenance → provenance PASS, chain page shows identity.
- [ ] Verify a package **without** provenance → WARN overall, provenance UNAVAILABLE, copy says "not evidence of malice".
- [ ] Unknown package → readable "Not found" error, no fake report.
- [ ] Stop the backend → nav shows Backend offline; Verify shows the offline panel with Retry.
- [ ] Verify Studio's version/artifact selectors list real releases from pypi.org.
- [ ] Compare shows PyPI metadata diffs immediately and file diffs after "Compare inventories".
- [ ] The source-trace stage stays NOT CHECKED unless the backend returns a source-trace result.
- [ ] Browser devtools: no CORS or CSP errors.

## 9. Unsupported / out of scope

Local file upload to the backend, streaming progress, dependency-tree verification, malware
scanning. The UI does not pretend to do any of these.
