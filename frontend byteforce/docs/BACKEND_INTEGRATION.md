# Backend integration

Run PyVerify from the repository root using the commands in `BACKEND_INTEGRATION.md`. The frontend defaults to `http://127.0.0.1:8766`; configure `NEXT_PUBLIC_PYVERIFY_API_BASE_URL` in a local `.env.local` to use another backend address.

The live provider calls:

- `GET /api/health` for connection status.
- `GET /api/v1/packages/{project}/{version}/files` for one exact release’s validated file metadata.
- `POST /api/v1/verify` with exact project, version, filename, and optional PEP 740 / expected publisher policy fields.
- `POST /api/v1/source-trace` with exact wheel and `.tar.gz` sdist filenames from that release.

No route accepts browser-supplied download URLs or filesystem paths. Release metadata is version scoped; the UI asks for an exact version instead of implying that all releases can be listed. Verification and source trace remain separate workflows. HTTP success is not a PASS verdict; the frontend shows the backend verdict and evidence stages, retaining unavailable and not-checked states.

See the repository-root `BACKEND_API_CONTRACT.md` for schemas, error codes, limits, and backend evidence semantics.
