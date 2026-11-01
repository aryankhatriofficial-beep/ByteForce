# PyVerify Backend Handoff

This document describes the local API currently implemented in
`pyverify/src/pyverify/api.py`. It is intended to let a frontend call the API
without guessing field names or interpreting missing evidence as success.

## Server and shared rules

- Base URL: `http://127.0.0.1:8765`.
- `PYVERIFY_API_PORT` selects a different local port. The server always binds
  to `127.0.0.1`.
- CORS accepts only `http://localhost` and `http://127.0.0.1` origins, with an
  optional valid port. There is no wildcard origin.
- POST requests require `Content-Type: application/json` and `Content-Length`.
  The body cap is 16 KiB; transfer-encoded bodies are rejected.
- JSON responses are capped at 16 MiB.
- Error body: `{"error":{"code":"ERROR_CODE","message":"Readable explanation"}}`.
- Network-bound metadata and artifacts use PyVerify's HTTPS transport, which
  enforces HTTPS, exact trusted hostnames, redirect checks, deadlines and
  bounded streaming.
- Clients supply release names and exact filenames only. They never supply an
  URL or local path. The backend never installs, extracts, or executes an
  artifact.

## Endpoint 1: health

`GET /api/health`

Response 200:

```json
{"status":"ok","service":"pyverify"}
```

## Endpoint 2: release file discovery

`GET /api/v1/packages/{project}/{version}/files`

The route fetches `https://pypi.org/pypi/{project}/{version}/json` using the
shared bounded transport. Path parts are decoded and validated. PyPI response
size is capped at 10 MiB; the metadata request has a 10-second deadline. It
returns only validated artifact metadata; artifact download URLs are never
included.

Example request:

```bash
curl --fail 'http://127.0.0.1:8765/api/v1/packages/urllib3/2.2.1/files'
```

Response shape:

```json
{
  "release": {
    "project_name": "urllib3",
    "version": "2.2.1",
    "files": [
      {
        "filename": "urllib3-2.2.1-py3-none-any.whl",
        "type": "wheel",
        "packagetype": "bdist_wheel",
        "sha256": "<64 lowercase hexadecimal characters>",
        "size": 123456,
        "python_version": "py3",
        "requires_python": ">=3.8",
        "upload_time": "2024-04-05T14:00:00Z",
        "yanked": false
      }
    ],
    "metadata": {
      "summary": "HTTP library",
      "requires_python": ">=3.8",
      "classifiers": []
    }
  }
}
```

Fields:

- `files[].filename`: exact filename to send to verification.
- `files[].type`: `wheel`, `sdist`, or `other`.
- `files[].packagetype`: original PyPI file type (`bdist_wheel`, `sdist`, etc.).
- `files[].sha256`: validated PyPI digest.
- `files[].size`: nonnegative byte count.
- `files[].upload_time`: ISO timestamp or `null`.
- `files[].python_version`, `requires_python`, `yanked`: PyPI-provided release
  information; fields can be `null` where unavailable. `yanked_reason` is
  optional and omitted when missing.
- `metadata`: selected release-level `summary`, `requires_python`, and
  `classifiers` fields returned by PyPI.

Errors: `400 INVALID_REQUEST`, `403 ORIGIN_NOT_ALLOWED`, `404 NOT_FOUND`, `404
RELEASE_NOT_FOUND`, `502 UPSTREAM_INVALID_RESPONSE`, `502 UPSTREAM_ERROR`, and
`504 UPSTREAM_TIMEOUT`.

## Endpoint 3: artifact verification

`POST /api/v1/verify`

Required request fields:

| Name | JSON type | Rule |
| --- | --- | --- |
| `project` | string | Nonempty PyPI project identifier, max 200 characters |
| `version` | string | Nonempty release version, max 200 characters |
| `filename` | string | Exact artifact filename, max 255 characters, no path separator |

Optional fields:

| Name | JSON type | Meaning |
| --- | --- | --- |
| `verify_attestations` | boolean | Defaults to `false`; requests PEP 740 verification |
| `expected_github_repository` | string or null | Expected verified publisher repository `owner/repository` |
| `expected_workflow_filename` | string or null | Expected workflow filename; requires expected repository |

Example:

```bash
curl --fail-with-body 'http://127.0.0.1:8765/api/v1/verify' \
  -H 'Content-Type: application/json' \
  --data '{"project":"urllib3","version":"2.2.1","filename":"urllib3-2.2.1-py3-none-any.whl","verify_attestations":true}'
```

Response shape:

```json
{
  "verification": {
    "project_name": "urllib3",
    "version": "2.2.1",
    "filename": "urllib3-2.2.1-py3-none-any.whl",
    "expected_sha256": "…",
    "actual_sha256": "…",
    "matches": true,
    "evidence_summary": {"…": "full original backend summary"},
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

`verification` is the original return value from
`verify_pypi_artifact(project_name, version, filename, *, max_download_size=..., max_download_duration=..., verify_attestations=False, expected_github_repository=None, expected_workflow_filename=None, max_provenance_size=...)`.
`verdict` is copied from that result; the API does not recalculate it.

The convenience `evidence` map keeps the raw backend `status` and data. Its
`stage_status` is one of `VERIFIED`, `FAILED`, `WARNING`, `UNAVAILABLE`,
`NOT_CHECKED`, `NOT_APPLICABLE`, or `NOT_CONFIGURED`. Source trace is always
`NOT_CHECKED` on this route.

HTTP 200 means the verification call completed, even if the verdict is
`WARNING` or `FAIL`. Other errors: `400 INVALID_REQUEST`, `400 INVALID_JSON`,
`400 INVALID_CONTENT_LENGTH`, `400 UNSUPPORTED_TRANSFER_ENCODING`, `400
INCOMPLETE_REQUEST`, `403 ORIGIN_NOT_ALLOWED`, `404 ARTIFACT_NOT_FOUND`, `411
LENGTH_REQUIRED`, `413 REQUEST_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `502
UPSTREAM_INVALID_RESPONSE`, `502 UPSTREAM_ERROR`, `502
INVALID_VERIFIER_RESPONSE`, `502 RESULT_TOO_LARGE`, `504 UPSTREAM_TIMEOUT`,
`500 INTERNAL_ERROR`.

## Endpoint 4: source trace

`POST /api/v1/source-trace`

Required JSON fields:

| Name | JSON type | Rule |
| --- | --- | --- |
| `project` | string | Exact PyPI project name |
| `version` | string | Exact version |
| `wheel_filename` | string | Exact wheel filename from the release |
| `sdist_filename` | string | Exact `.tar.gz` sdist filename from the same release |
| `attested_filename` | string | Must equal one of the selected wheel/sdist names |

Optional field:

| Name | JSON type | Meaning |
| --- | --- | --- |
| `expected_source_repository` | string or null | Expected provenance-derived repository `owner/repository` |

Example:

```bash
curl --fail-with-body 'http://127.0.0.1:8765/api/v1/source-trace' \
  -H 'Content-Type: application/json' \
  --data '{"project":"demo","version":"1.0","wheel_filename":"demo-1.0-py3-none-any.whl","sdist_filename":"demo-1.0.tar.gz","attested_filename":"demo-1.0-py3-none-any.whl","expected_source_repository":"octo/demo"}'
```

The route resolves the exact two files through the existing PyPI metadata
helper. It requires PyPI package types `bdist_wheel` and `sdist`, checks the
advertised size, streams at most 1 GiB per artifact, verifies actual size and
SHA-256, then calls:

`verify_pypi_source_trace(attested_artifact_path, project_name, version, filename, sdist_path, wheel_path, *, expected_source_repository=None, max_source_size=..., max_source_duration=..., max_provenance_size=..., max_members=..., max_member_size=..., max_uncompressed_size=...)`.

Both downloaded artifacts live in a `TemporaryDirectory`; its context ends
after verification or error. The acquisition metadata and downloads share a
five-minute deadline. The invoked source-trace workflow then applies its own
five-minute deadline to its PyPI provenance/source snapshot operations.

Response:

```json
{
  "source_trace": {
    "status": "SOURCE_TRACE_PARTIAL",
    "source_reference": {"status": "resolved", "repository": "octo/demo", "commit": "…"},
    "commit_resolution": {"status": "resolved", "commit": "…"},
    "repository_policy": {"status": "matched", "configured": true, "matches": true},
    "provenance_availability": {"status": "available", "available": true},
    "cryptographic_verification": {"status": "verified", "verified": true},
    "release_artifact_hashes": {"status": "verified", "artifacts": []},
    "source_inventory": {"status": "SOURCE_INVENTORY_COMPLETE", "complete": true},
    "file_comparison": {"status": "RELEASE_FILES_PARTIAL", "counts": {}},
    "verdict": {"status": "WARNING", "reasons": ["…"]}
  },
  "artifacts": [
    {"filename": "demo-1.0-py3-none-any.whl", "size": 123, "sha256": "…", "matches": true},
    {"filename": "demo-1.0.tar.gz", "size": 456, "sha256": "…", "matches": true}
  ],
  "evidence": {"source_trace": {"status": "SOURCE_TRACE_PARTIAL", "stage_status": "WARNING", "checked": true}},
  "verdict": {"status": "WARNING", "reasons": ["…"]}
}
```

The `source_trace` object is the original result returned by
`verify_pypi_source_trace()`. `artifacts` is a safe acquisition summary without
URLs or paths. `evidence` provides stage views (including source reference,
commit resolution, repository policy, provenance, cryptographic verification,
wheel/sdist inventories, RECORD, release consistency, file comparison, and
limitations) while retaining raw statuses. The top-level verdict is copied
from the source-trace result, not independently generated by the API.

Missing provenance is reported as `missing`; an empty provenance object is
`empty`; malformed provenance is `malformed`; network failure is
`unavailable`. These produce partial evidence and must not be shown as a
cryptographic pass. Cryptographic verification is performed by the existing
`pypi-attestations` verification path. No API path installs or executes package
code. Static source/release comparison does not prove reproducible builds or
complete source-to-binary correspondence.

Errors use the common shape. Source-trace can return `400 INVALID_REQUEST`,
`400 INVALID_JSON`, `400 INVALID_CONTENT_LENGTH`,
`400 UNSUPPORTED_TRANSFER_ENCODING`, `400 INCOMPLETE_REQUEST`,
`403 ORIGIN_NOT_ALLOWED`, `404 NOT_FOUND`, `404 ARTIFACT_NOT_FOUND`, `411
LENGTH_REQUIRED`, `413 REQUEST_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `502
UPSTREAM_INVALID_RESPONSE`, `502 UPSTREAM_ERROR`, `502 RESULT_TOO_LARGE`, `504
UPSTREAM_TIMEOUT`, and `500 INTERNAL_ERROR`.

## Local startup

```bash
cd pyverify
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/python -m pyverify.api
```

Health URL: `http://127.0.0.1:8765/api/health`.
