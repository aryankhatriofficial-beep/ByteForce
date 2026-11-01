# PyVerify Backend Integration

## Local setup

From the ByteForce repository root, create or reuse a project-local Python
environment and install the package editable:

```bash
cd pyverify
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/python -m pyverify.api
```

The API listens at `http://127.0.0.1:8765`. Set `PYVERIFY_API_PORT` to change
the port; the server remains bound to `127.0.0.1`. Check readiness with:

```bash
curl --fail http://127.0.0.1:8765/api/health
```

The response is `{"status":"ok","service":"pyverify"}`.

## Frontend workflow

1. Call `GET /api/v1/packages/{project}/{version}/files` after the user enters
   a project and version. The response contains exact filenames, package type,
   SHA-256, size, upload time, Python tag, and release metadata. It deliberately
   omits download URLs.
2. Let the user select an exact filename and call `POST /api/v1/verify` with
   `project`, `version`, and `filename`. Optional attestation/publisher policy
   fields are documented in [BACKEND_API_CONTRACT.md](BACKEND_API_CONTRACT.md).
3. Render the original `verdict` and `verification` result. `evidence` is a
   presentation map; `stage_status` summarizes each stage while raw backend
   fields remain available. The normal verification route always reports
   `source_trace` as `NOT_CHECKED`.
4. For source trace, select an exact wheel and `.tar.gz` sdist from the same
   release. Call `POST /api/v1/source-trace` with both filenames and an
   `attested_filename` identifying which artifact's attestation to verify.
   The route obtains the files itself; never send a path or URL from the UI.

## Source trace semantics

The route gets metadata from PyPI's official JSON endpoint, validates the
exact wheel/sdist entries and trusted download host, then streams both files to
a temporary directory. It passes those local files to the existing
`verify_pypi_source_trace()` implementation. The function checks the PEP 740
attestation, source reference, source snapshot and file comparisons. The
temporary directory is removed after the function returns or raises.

The route's artifact acquisition has a five-minute phase deadline and a 1 GiB
per-file size cap. The underlying source trace has its own five-minute
provenance/source-snapshot deadline. Missing, empty, malformed, and unavailable
provenance remain separate evidence states. A partial source trace is not a
PASS. File comparisons do not establish a reproducible build or full
source-to-binary equivalence.

## Browser origins and security

The API accepts explicit CORS origins only for `http://localhost` or
`http://127.0.0.1`, optionally with a port. It does not use wildcard CORS.
No route accepts arbitrary download URLs or filesystem paths. Release and
source-trace downloads use the existing HTTPS transport, exact trusted-host
checks, redirect validation, size limits, and bounded reads. Packages are
never installed, extracted, or executed.

See [BACKEND_API_CONTRACT.md](BACKEND_API_CONTRACT.md) for exact JSON schemas,
evidence field names, error codes, curl examples, and response examples.
