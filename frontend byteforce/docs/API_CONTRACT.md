# PyVerify Frontend ↔ Backend Contract

**Source of truth for routes and request fields: the project owner's description of the running
backend** (2026-11-01). The backend source was not available on this machine, so the response schema
below is what the frontend *accepts*, not a copy of the backend's own definition. Anything the
backend sends is passed through one tolerant normaliser and is also shown raw in Verify Studio.

| | |
|---|---|
| Base URL | `http://127.0.0.1:8765` (override with `NEXT_PUBLIC_PYVERIFY_API_BASE_URL`) |
| Auth | none assumed; requests use `credentials: "omit"` |
| CORS | backend must allow the frontend origin for `GET`/`POST` + `Content-Type` |
| CSP | `connect-src` allows the backend origin and `https://pypi.org` only |

## `GET /api/health`
Called on load, from the nav's "Retry connection", and the palette. Any 2xx JSON with `ok: true` or
`status: "ok" | "healthy" | "pass"` is "connected"; anything else, or a network error, is "offline".
The optional `version` field is shown in the connection panel.

## `POST /api/v1/verify`
```json
{ "project": "sampleproject", "version": "4.0.0", "filename": "sampleproject-4.0.0-py3-none-any.whl" }
```
Optional fields — **names UNCONFIRMED**, defined once in `src/lib/api/endpoints.ts` → `OPTIONAL_FIELDS`
and only sent when the user sets them:

| UI control | Field sent | When |
|---|---|---|
| "Verify PEP 740 attestations" switched **off** | `verify_attestations: false` | only when off (default assumed on) |
| Expected publisher repository | `expected_repository: "owner/name"` | when filled |
| Workflow filename | `expected_workflow: "release.yml"` | when filled (requires repository) |

If the backend rejects these names (e.g. 422), change the three strings in `OPTIONAL_FIELDS`.

### Response — accepted shape
snake_case or camelCase; unknown fields ignored; missing sections → shown as unavailable / not checked.

```jsonc
{
  "report_id": "…", "generated_at": "ISO-8601",
  "package": { "name": "…", "version": "…" },          // `project` is accepted for name
  "artifact": { "filename": "…" /* required */, "url": "…", "size_bytes": 0,
                "expected_sha256": "…" /* or digests.sha256 */, "observed_sha256": "…|null", "upload_time": "…" },
  "overall": { "status": "…", "headline": "…" },       // derived conservatively if absent
  "checks": [ { "id": "digest", "title": "…", "status": "…", "summary": "…",
                "evidence": [ { "label": "…", "value": "…", "mono": true, "status": "…" } ],
                "limitations": ["…"] } ],
  "metadata": {…} | null, "record": {…} | null, "inventory": {…} | null,
  "provenance": { "status": "…", "absent": false, "attestations": [ … ], "publisher": { … } } | null,
  "policy": {…} | null, "consistency": {…} | null,
  "source_trace": {…} | null,                          // normally null: separate workflow
  "logs": [ { "t": 0, "level": "info|ok|warn|error", "stage": "…", "message": "…" } ]
}
```
Field-level shapes for each section: see `src/lib/api/types.ts` and `src/lib/api/normalize.ts`.

Check ids (aliases in `normalize.ts`): `digest` (hash, sha256), `metadata`, `record`, `inventory`,
`provenance` (attestation, pep740), `publisher_policy` (policy), `release_consistency`, `source_trace`.

Status spellings → UI status (anything else → **Unavailable**, never Verified):

| UI | Accepted |
|---|---|
| Verified | pass, passed, ok, success, verified, valid, match |
| Warning | warn, warning, partial |
| Failed | fail, failed, error, invalid, mismatch |
| Not checked | not_checked, skipped, not_run, pending |
| Not applicable | not_applicable, n/a |
| Not configured | not_configured, no_policy |

### How the evidence map uses it (`src/lib/evidence.ts`)
| Stage | From | If missing |
|---|---|---|
| PyPI artifact | `artifact.observed_sha256` present | Unavailable |
| SHA-256 | check `digest` | Not checked |
| Metadata | check `metadata` | Not checked (Not applicable for sdist) |
| Attestation | check `provenance` | Not checked if switched off; Unavailable if `provenance.absent` |
| Publisher | check `publisher_policy` | Not configured if no repository given |
| RECORD | checks `record` + `inventory` + `release_consistency` (worst wins) | Not checked (N/A for sdist) |
| Source | check `source_trace` | **Not checked** (separate workflow) |

### Errors
`{ "error": { "code", "message", "detail" } }`, FastAPI `{ "detail": … }` or `{ "message" }`.
400/422 → "Request rejected", 404 → "Not found", other → "Backend error (code)", network →
"Backend unreachable. Nothing was verified.", timeout (120 s) → "Verification timed out".
A verification *finding* must be a 200 report with a failing status, not an HTTP error.

## Not backend: PyPI JSON API (read-only)
`GET https://pypi.org/pypi/{project}/json` and `/pypi/{project}/{version}/json` supply release lists,
filenames, sizes, upload times and **published** digests for the selectors, Inspector and Compare.
Labelled in the UI as public metadata, not verification evidence.
