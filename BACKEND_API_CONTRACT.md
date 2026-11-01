# PyVerify Local Backend API Contract

The API is a standard-library HTTP adapter around PyVerify's existing backend.
It binds only to IPv4 loopback (`127.0.0.1`), accepts no client-supplied URLs or
filesystem paths, and never installs or executes a package.

## Common behavior

- Default base URL: `http://127.0.0.1:8765`.
- `PYVERIFY_API_HOST` changes the bind address only when explicitly set; its
  default is `127.0.0.1`. Hosted runtimes can use their required IPv4 bind host
  and `PORT` when `PYVERIFY_API_PORT` is unset.
- JSON request limit: 16 KiB. `Content-Type: application/json` and
  `Content-Length` are required for POST requests. Transfer-Encoding bodies are
  rejected.
- JSON response limit: 16 MiB.
- CORS permits only `http://localhost[:port]` and
  `http://127.0.0.1[:port]`; wildcard CORS is not used.
- `PYVERIFY_CORS_ORIGINS` optionally replaces that local CORS policy with a
  comma-separated list of exact origins. Remote origins must use HTTPS.
  CORS does not authenticate callers.
- Errors have the form `{"error":{"code":"...","message":"..."}}`.
- Operational HTTP success means the request ran. It does not mean a package
  passed verification. The returned backend verdict is authoritative.

## `GET /api/health`

Returns 200 when the API process is serving requests:

```json
{"status":"ok","service":"pyverify"}
```

## `GET /api/v1/packages/{project}/{version}/files`

Fetches the official PyPI JSON release document using the bounded HTTPS
transport. Project and version are path components, percent-decoded as UTF-8,
then validated. Every file entry must contain a valid SHA-256, nonnegative
integer size, safe filename, package type, and HTTPS URL on exactly
`files.pythonhosted.org`. URLs are validated but omitted from the response.
The JSON response is limited to 10 MiB and the metadata request has a 10-second
deadline.

Response (fields such as timestamps may be `null`; `yanked_reason` is omitted
when PyPI does not provide it):

```json
{
  "release": {
    "project_name": "demo",
    "version": "1.0",
    "files": [{
      "filename": "demo-1.0-py3-none-any.whl",
      "type": "wheel",
      "packagetype": "bdist_wheel",
      "sha256": "<64 hexadecimal characters>",
      "size": 1234,
      "python_version": "py3",
      "requires_python": ">=3.10",
      "upload_time": "2025-01-01T00:00:00Z",
      "yanked": false
    }],
    "metadata": {
      "summary": "Example package",
      "requires_python": ">=3.10",
      "classifiers": []
    }
  }
}
```

`type` is `wheel`, `sdist`, or `other`, based on PyPI's `packagetype`. A
missing project/version returns `404 RELEASE_NOT_FOUND`; malformed upstream
JSON/fields return `502 UPSTREAM_INVALID_RESPONSE`; upstream timeout returns
`504 UPSTREAM_TIMEOUT`; transport errors return `502 UPSTREAM_ERROR`.

## `POST /api/v1/verify`

Verifies one exact artifact through `verify_pypi_artifact()`.

Required JSON fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `project` | string | PyPI project name |
| `version` | string | Exact release version |
| `filename` | string | Exact release filename; path separators are rejected |

Optional fields:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `verify_attestations` | boolean | `false` | Request PEP 740 verification |
| `expected_github_repository` | string or null | `null` | Expected publisher as `owner/repository` |
| `expected_workflow_filename` | string or null | `null` | Expected workflow filename; requires the repository |

Example:

```json
{
  "project": "demo",
  "version": "1.0",
  "filename": "demo-1.0-py3-none-any.whl",
  "verify_attestations": true,
  "expected_github_repository": "octo/demo",
  "expected_workflow_filename": "release.yml"
}
```

Response contains `verification` (the original, unmodified verifier result),
`evidence` (a UI-oriented view with `stage_status` alongside raw backend
statuses), and `verdict` (the original backend verdict). Ordinary verification
always returns source trace as `NOT_CHECKED`.

Example shape:

```json
{
  "verification": {
    "project_name": "demo",
    "version": "1.0",
    "filename": "demo-1.0-py3-none-any.whl",
    "expected_sha256": "…",
    "actual_sha256": "…",
    "matches": true,
    "evidence_summary": {"…": "original backend evidence"},
    "verdict": {"status": "WARNING", "reasons": ["…"]}
  },
  "evidence": {
    "artifact_sha256": {"status": "MATCH", "stage_status": "VERIFIED", "matches": true},
    "distribution_metadata": {"status": "matched", "stage_status": "VERIFIED"},
    "provenance_availability": {"status": "not_checked", "stage_status": "NOT_CHECKED"},
    "cryptographic_attestation": {"status": "not_checked", "stage_status": "NOT_CHECKED"},
    "publisher_policy": {"configured": false, "stage_status": "NOT_CONFIGURED"},
    "wheel_record": {"status": "RECORD_VALID", "stage_status": "VERIFIED"},
    "wheel_inventory": {"status": "INVENTORY_COMPLETE", "stage_status": "VERIFIED"},
    "sdist_inventory": {"status": "NOT_APPLICABLE", "stage_status": "NOT_APPLICABLE"},
    "release_consistency": {"status": "NOT_CHECKED", "stage_status": "NOT_CHECKED"},
    "source_trace": {"status": "NOT_CHECKED", "checked": false, "stage_status": "NOT_CHECKED"}
  },
  "verdict": {"status": "WARNING", "reasons": ["…"]}
}
```

`stage_status` distinguishes `VERIFIED`, `FAILED`, `WARNING`, `UNAVAILABLE`,
`NOT_CHECKED`, `NOT_APPLICABLE`, and `NOT_CONFIGURED`. The raw `status` and
original backend objects remain available. A valid hash alone does not prove
that package code is safe.

## `POST /api/v1/source-trace`

Downloads the exact wheel and source distribution in one PyPI release to a
temporary directory, then calls `verify_pypi_source_trace()`. It never extracts
or executes the release artifacts. The attested filename must be one of the two
selected files.

Request fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `project` | string | PyPI project name |
| `version` | string | Exact release version |
| `wheel_filename` | string | Exact wheel filename from release discovery |
| `sdist_filename` | string | Exact `.tar.gz` source distribution filename |
| `attested_filename` | string | Which selected artifact's PEP 740 statement to verify |
| `expected_source_repository` | string or null | Optional expected source repository `owner/repository` |

Example:

```json
{
  "project": "demo",
  "version": "1.0",
  "wheel_filename": "demo-1.0-py3-none-any.whl",
  "sdist_filename": "demo-1.0.tar.gz",
  "attested_filename": "demo-1.0-py3-none-any.whl",
  "expected_source_repository": "octo/demo"
}
```

Response includes the original source-trace object, verified acquisition
summaries for the two downloaded artifacts, an evidence-stage map, and the
original source-trace verdict:

```json
{
  "source_trace": {
    "status": "SOURCE_TRACE_PARTIAL",
    "source_reference": {"status": "resolved", "repository": "octo/demo", "commit": "…"},
    "cryptographic_verification": {"status": "verified", "verified": true},
    "release_artifact_hashes": {"status": "verified", "artifacts": []},
    "file_comparison": {"status": "RELEASE_FILES_PARTIAL", "counts": {}},
    "verdict": {"status": "WARNING", "reasons": ["…"]}
  },
  "artifacts": [
    {"filename": "demo-1.0-py3-none-any.whl", "size": 1234, "sha256": "…", "matches": true},
    {"filename": "demo-1.0.tar.gz", "size": 5678, "sha256": "…", "matches": true}
  ],
  "evidence": {"cryptographic_attestation": {"stage_status": "VERIFIED"}, "…": "…"},
  "verdict": {"status": "WARNING", "reasons": ["…"]}
}
```

The route requires exact PyPI release membership and package types. Each
artifact is limited to 1 GiB, with a shared five-minute acquisition deadline
for metadata and both downloads. The existing source-trace operation applies
its own five-minute provenance/source-snapshot deadline. Downloads use HTTPS
and the bounded transport, which validates each redirect and final URL against
the exact `files.pythonhosted.org` host. The temporary directory is cleaned on
success and failure.

Missing provenance returns a partial source-trace result with provenance
availability `missing`; an empty provenance object is `empty`; malformed data
is `malformed`; transport failure is `unavailable`. None of those states is
reported as a successful source trace. Static comparison does not prove
reproducible builds or complete source-to-binary correspondence.

## Error codes

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Missing, invalid, wrongly typed, or unknown request field/path component |
| 400 | `INVALID_JSON` | Body is not valid UTF-8 JSON |
| 400 | `INVALID_CONTENT_LENGTH` | Invalid Content-Length |
| 400 | `UNSUPPORTED_TRANSFER_ENCODING` | Transfer-Encoding request bodies are not accepted |
| 400 | `INCOMPLETE_REQUEST` | Body ended before Content-Length bytes arrived |
| 403 | `ORIGIN_NOT_ALLOWED` | Explicit browser Origin is outside local loopback origins |
| 404 | `NOT_FOUND` | Route does not exist |
| 404 | `RELEASE_NOT_FOUND` | PyPI project or version does not exist |
| 404 | `ARTIFACT_NOT_FOUND` | Exact selected artifact is absent from that release |
| 411 | `LENGTH_REQUIRED` | POST omitted Content-Length |
| 413 | `REQUEST_TOO_LARGE` | Request body exceeds 16 KiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | POST Content-Type is not JSON |
| 502 | `UPSTREAM_INVALID_RESPONSE` | PyPI metadata/artifact response is malformed, untrusted, or too large |
| 502 | `UPSTREAM_ERROR` | Upstream request or source-trace operation failed |
| 502 | `INVALID_VERIFIER_RESPONSE` | Verifier returned a non-JSON-compatible value |
| 502 | `RESULT_TOO_LARGE` | API response exceeds 16 MiB |
| 504 | `UPSTREAM_TIMEOUT` | An upstream phase exceeded its deadline |
| 500 | `INTERNAL_ERROR` | Unexpected internal API error |

## Start locally

From the repository root:

```bash
cd pyverify
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/python -m pyverify.api
```

Then check `http://127.0.0.1:8765/api/health`.
