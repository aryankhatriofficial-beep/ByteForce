# PyVerify frontend ↔ backend contract

The source of truth is the repository root `BACKEND_API_CONTRACT.md` and the implementation in `pyverify/src/pyverify/api.py`. The frontend uses those exact routes and fields.

## Base URL and common behavior

- Default: `http://127.0.0.1:8766`; override with `NEXT_PUBLIC_PYVERIFY_API_BASE_URL` (no trailing slash).
- Requests omit credentials. No secrets belong in `NEXT_PUBLIC_*` variables.
- API errors use `{ "error": { "code": "...", "message": "..." } }`.
- HTTP 200 means the request completed, not that verification passed. The returned backend verdict is rendered as provided.
- Live network requests go only to PyVerify. Browser-side release discovery does not call PyPI directly.

## Health

`GET /api/health` → `{ "status": "ok", "service": "pyverify" }`. The frontend requires this exact service response to show connected.

## Exact release discovery

`GET /api/v1/packages/{project}/{version}/files` → `{ "release": { "project_name", "version", "files", "metadata" } }`.

Each file includes exact `filename`, `type` (`wheel`, `sdist`, `other`), `packagetype`, `sha256`, `size`, `python_version`, `requires_python`, `upload_time`, and `yanked`. URLs are not returned. This route is version scoped; the frontend requests an exact version and does not claim to enumerate every release.

## Artifact verification

`POST /api/v1/verify` requires `project`, `version`, and exact `filename`. The frontend sends `verify_attestations` explicitly and, when configured, uses `expected_github_repository` and `expected_workflow_filename`.

The response must contain `verification`, `evidence`, and `verdict`. The normalizer maps original verifier fields and backend evidence stages into the existing result UI. Missing fields remain unavailable or not checked. The top-level backend verdict is not recalculated. Source trace is always `NOT_CHECKED` on this route. A matching digest does not establish that package code is safe.

## Source trace

`POST /api/v1/source-trace` requires `project`, `version`, `wheel_filename`, `sdist_filename`, and `attested_filename`; `expected_source_repository` is optional. The UI selects filenames only from the backend’s exact release response. The backend obtains both files itself; the browser sends no URLs or local paths.

The frontend presents the backend’s original source-trace object, artifact acquisition summaries, evidence map, and verdict. Partial, missing, empty, malformed, and unavailable provenance are not promoted to success. Static source comparison does not prove reproducible builds or complete source-to-binary correspondence.

## Demo mode

Bundled fictional fixtures remain opt-in and are labelled. Demo source trace is not simulated; that workflow requires the live backend.
