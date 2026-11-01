# PyVerify deployment path

## Recommended split

- **Frontend:** deploy `frontend byteforce/` as a Next.js project on Vercel (or another Node.js provider with full Next.js support). Set the project's root directory to `frontend byteforce`.
- **Backend:** build `pyverify/Dockerfile` as a separate Python web service on a container-capable provider. Render is one compatible option; no Render or Vercel project is currently configured in this repository.
- **Browser API URL:** configure `NEXT_PUBLIC_PYVERIFY_API_BASE_URL` to the final HTTPS API origin before building the frontend. It is public configuration, not a secret. The Next.js CSP takes its API origin from this same build-time variable.
- **Backend CORS:** set `PYVERIFY_CORS_ORIGINS` to the exact HTTPS frontend origin(s), comma-separated. For example: `https://byteforce.example,https://byteforce-preview.example`.

The API binds to `127.0.0.1` by default. A container web service must explicitly set `PYVERIFY_API_HOST=0.0.0.0`; the application uses the platform's `PORT` unless `PYVERIFY_API_PORT` is set. Do not use `*` for CORS.

## Security gate before public deployment

The API has no authentication, rate limiting, or concurrency quota. Verification requests can download large artifacts and run for several minutes. CORS only controls browser access; it does not stop direct HTTP clients. Keep the backend private until an access and abuse-control boundary has been selected and configured (for example, an authenticated/rate-limited gateway). Do not treat an exact CORS list as that boundary.

This repository contains no deployment project IDs, domains, provider credentials, or gateway configuration. No public deploy was attempted.

## Build and local container smoke check

Run from the repository root:

```bash
docker build -f pyverify/Dockerfile -t pyverify-api:local ./pyverify
docker run --rm --name pyverify-api-local \
  -p 127.0.0.1:8766:8766 \
  -e PYVERIFY_API_HOST=0.0.0.0 \
  -e PYVERIFY_API_PORT=8766 \
  pyverify-api:local
```

In another terminal, check `curl --fail http://127.0.0.1:8766/api/health`. The published Docker port is bound to host loopback in this smoke command. Stop the container with Ctrl+C in the terminal that started it.

## Provider configuration

### Backend web service

1. Create a Docker web service from the repository and set the Dockerfile path to `pyverify/Dockerfile` and Docker context to `pyverify/`.
2. Configure `PYVERIFY_API_HOST=0.0.0.0` and `PYVERIFY_CORS_ORIGINS` with the exact frontend HTTPS origin(s).
3. Let the host set `PORT`; leave `PYVERIFY_API_PORT` unset unless the provider requires a fixed port.
4. Set the provider HTTP health check to `/api/health`.
5. Do not expose the service publicly until the security gate above is resolved.

### Frontend

1. Create a Next.js project using `frontend byteforce/` as the root directory.
2. Set `NEXT_PUBLIC_PYVERIFY_API_BASE_URL` to the HTTPS backend API origin before the production build.
3. Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.
4. Redeploy after changing the public API URL because Next.js embeds `NEXT_PUBLIC_*` values into client bundles at build time.

## Release validation and rollback

Before publishing, verify both HTTPS health endpoints, browser CORS preflight from the exact frontend origin, one release-discovery request, one verification request, timeout/error display, and the production build. Review logs for startup errors and confirm no secret is present in the frontend bundle.

Record the deployed image digest and frontend deployment identifier. To roll back, redeploy the previous backend image digest and restore the previous frontend deployment in the respective provider dashboards. Recheck health and the frontend-to-backend path after rollback.

## Current limits

- A local health response proves process liveness, not PyPI reachability or successful verification.
- The current API uses an in-memory threaded HTTP server; provider concurrency and request-duration limits must be configured and observed.
- The current dependency declaration pins `pypi-attestations` but does not lock every transitive Python dependency.
- Production deployment remains blocked on provider/project selection and an abuse-control design for the unauthenticated API.
