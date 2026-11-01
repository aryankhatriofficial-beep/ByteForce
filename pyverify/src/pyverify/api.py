"""Loopback-only HTTP adapter for local PyVerify development."""

import asyncio
import copy
import ipaddress
import json
import logging
import os
import re
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote_to_bytes, urlsplit

from pyverify._http import open_https_response
from pyverify.pypi import (
    _get_pypi_artifact_metadata_with_deadline,
    _run_coroutine_sync,
    get_pypi_release_files,
)
from pyverify.source_trace import verify_pypi_source_trace
from pyverify.verifier import verify_pypi_artifact


DEFAULT_PORT = 8765
DEFAULT_HOST = "127.0.0.1"
MAX_REQUEST_BYTES = 16 * 1024
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
MAX_SOURCE_ARTIFACT_BYTES = 1024 * 1024 * 1024
SOURCE_DOWNLOAD_TIMEOUT = 5 * 60
_PROJECT_COMPONENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$")
_VERSION_COMPONENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+!-]{0,199}$")
_MAX_FIELD_LENGTHS = {"project": 200, "version": 200, "filename": 255}
_ALLOWED_FIELDS = {
    "project",
    "version",
    "filename",
    "verify_attestations",
    "expected_github_repository",
    "expected_workflow_filename",
}
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


class _RequestError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _local_origin(origin: str | None) -> bool:
    """Allow local HTTP origins by default and exact HTTPS origins when configured."""
    if origin is None:
        return True
    configured = os.environ.get("PYVERIFY_CORS_ORIGINS")
    if configured is None:
        return _valid_local_http_origin(origin)
    allowed = {
        candidate
        for entry in configured.split(",")
        if _valid_configured_origin(candidate := entry.strip())
    }
    return origin in allowed


def _valid_local_http_origin(origin: str) -> bool:
    try:
        parsed = urlsplit(origin)
        port = parsed.port
        return (
            parsed.scheme == "http"
            and parsed.hostname in ("localhost", "127.0.0.1")
            and parsed.username is None
            and parsed.password is None
            and parsed.path == ""
            and not parsed.query
            and not parsed.fragment
            and (port is None or 1 <= port <= 65535)
            and origin == "http://{}{}".format(
                parsed.hostname,
                ":{}".format(port) if port is not None else "",
            )
        )
    except (TypeError, ValueError):
        return False


def _valid_configured_origin(origin: str) -> bool:
    """Validate a serialized origin. Non-local plain HTTP is never accepted."""
    try:
        parsed = urlsplit(origin)
        port = parsed.port
        canonical = (
            parsed.scheme in ("http", "https")
            and bool(parsed.hostname)
            and parsed.username is None
            and parsed.password is None
            and parsed.path == ""
            and not parsed.query
            and not parsed.fragment
            and (port is None or 1 <= port <= 65535)
            and origin == "{}://{}{}".format(
                parsed.scheme,
                parsed.hostname,
                ":{}".format(port) if port is not None else "",
            )
        )
        if not canonical:
            return False
        if parsed.scheme == "https":
            return True
        return parsed.hostname in ("localhost", "127.0.0.1")
    except (TypeError, ValueError):
        return False


def _validate_request(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise _RequestError(400, "INVALID_REQUEST", "Request body must be a JSON object.")
    unknown = sorted(set(payload) - _ALLOWED_FIELDS)
    if unknown:
        raise _RequestError(
            400,
            "INVALID_REQUEST",
            "Unknown request field(s): {}.".format(", ".join(unknown)),
        )

    validated: dict[str, Any] = {}
    for field, max_length in _MAX_FIELD_LENGTHS.items():
        value = payload.get(field)
        if not isinstance(value, str) or not value or value != value.strip():
            raise _RequestError(
                400,
                "INVALID_REQUEST",
                "Field {!r} must be a non-empty string without surrounding whitespace.".format(field),
            )
        if len(value) > max_length or _CONTROL_CHARS.search(value):
            raise _RequestError(400, "INVALID_REQUEST", "Field {!r} is invalid or too long.".format(field))
        validated[field] = value

    filename = validated["filename"]
    if filename in (".", "..") or any(char in filename for char in ("/", "\\", ":")):
        raise _RequestError(400, "INVALID_REQUEST", "filename must be an exact artifact filename.")

    verify_attestations = payload.get("verify_attestations", False)
    if type(verify_attestations) is not bool:
        raise _RequestError(400, "INVALID_REQUEST", "verify_attestations must be a boolean.")
    validated["verify_attestations"] = verify_attestations

    repository = payload.get("expected_github_repository")
    workflow = payload.get("expected_workflow_filename")
    if repository is not None:
        if (
            not isinstance(repository, str)
            or len(repository) > 255
            or _CONTROL_CHARS.search(repository)
            or repository.strip() != repository
        ):
            raise _RequestError(400, "INVALID_REQUEST", "expected_github_repository must be owner/repository.")
        parts = repository.split("/")
        if len(parts) != 2 or not all(parts):
            raise _RequestError(400, "INVALID_REQUEST", "expected_github_repository must be owner/repository.")
    if workflow is not None:
        if (
            not isinstance(workflow, str)
            or not workflow
            or len(workflow) > 255
            or workflow.strip() != workflow
            or _CONTROL_CHARS.search(workflow)
        ):
            raise _RequestError(400, "INVALID_REQUEST", "expected_workflow_filename must be a non-empty filename.")
        if repository is None:
            raise _RequestError(
                400,
                "INVALID_REQUEST",
                "expected_github_repository is required when expected_workflow_filename is set.",
            )
    validated["expected_github_repository"] = repository
    validated["expected_workflow_filename"] = workflow
    return validated


def _evidence_map(result: dict[str, Any]) -> dict[str, Any]:
    """Expose real verifier evidence while preserving backend statuses."""
    summary = result.get("evidence_summary")
    if not isinstance(summary, dict):
        summary = {}
    artifact_hash = summary.get("artifact_hash")
    if not isinstance(artifact_hash, dict):
        artifact_hash = {
            "expected_sha256": result.get("expected_sha256"),
            "actual_sha256": result.get("actual_sha256"),
            "matches": result.get("matches"),
        }
    matches = artifact_hash.get("matches")
    hash_status = "MATCH" if matches is True else "MISMATCH" if matches is False else "NOT_CHECKED"
    evidence = copy.deepcopy({
        "artifact_sha256": {**artifact_hash, "status": hash_status},
        "distribution_metadata": summary.get(
            "distribution_metadata",
            result.get("distribution_metadata_check", {"status": "NOT_CHECKED"}),
        ),
        "provenance_availability": summary.get(
            "provenance_availability", {"status": "NOT_CHECKED"}
        ),
        "cryptographic_attestation": summary.get(
            "cryptographic_verification",
            result.get("cryptographic_verification", {"status": "NOT_CHECKED"}),
        ),
        "publisher_policy": summary.get(
            "publisher_policy", result.get("publisher_policy", {"status": "NOT_CHECKED"})
        ),
        "wheel_record": summary.get("wheel_record", result.get("wheel_record", {"status": "NOT_CHECKED"})),
        "wheel_inventory": summary.get(
            "artifact_inventory", result.get("artifact_inventory", {"status": "NOT_CHECKED"})
        ),
        "sdist_inventory": summary.get(
            "sdist_inventory", result.get("sdist_inventory", {"status": "NOT_CHECKED"})
        ),
        "release_consistency": summary.get("release_consistency", {"status": "NOT_CHECKED"}),
        # This endpoint never runs the separate source-trace workflow.
        "source_trace": {"status": "NOT_CHECKED", "checked": False},
    })
    evidence["artifact_sha256"]["stage_status"] = (
        "VERIFIED" if matches is True else "FAILED" if matches is False else "NOT_CHECKED"
    )
    for name, value in evidence.items():
        if name == "artifact_sha256" or not isinstance(value, dict):
            continue
        if name == "publisher_policy" and value.get("configured") is False and "status" not in value:
            value["stage_status"] = "NOT_CONFIGURED"
            continue
        value.setdefault("stage_status", _stage_status(value.get("status")))
    return evidence


def _stage_status(raw_status: Any) -> str:
    if not isinstance(raw_status, str):
        return "NOT_CHECKED"
    status = raw_status.upper()
    if status in {"NOT_CHECKED", "NOT_APPLICABLE", "UNAVAILABLE", "WARNING", "FAILED", "VERIFIED", "NOT_CONFIGURED"}:
        return status
    if status in {"MATCHED", "VERIFIED", "RECORD_VALID", "INVENTORY_COMPLETE", "SDIST_INVENTORY_COMPLETE", "RELEASE_FILES_MATCH", "RESOLVED"}:
        return "VERIFIED"
    if status in {"MISMATCH", "INVALID", "MALFORMED", "FAILED", "RECORD_INVALID", "INVENTORY_INCOMPLETE"}:
        return "FAILED"
    if status in {"MISSING", "EMPTY", "UNAVAILABLE"}:
        return "UNAVAILABLE"
    if "UNAVAILABLE" in status:
        return "UNAVAILABLE"
    if status.startswith("SDIST_") and "INCOMPLETE" in status:
        return "WARNING"
    if status in {"DIFFER", "PARTIAL", "SOURCE_TRACE_PARTIAL"} or status.endswith("_DIFFER") or status.endswith("_PARTIAL"):
        return "WARNING"
    if status == "AVAILABLE":
        return "AVAILABLE"
    return "NOT_CHECKED"


def _source_trace_evidence_map(result: dict[str, Any]) -> dict[str, Any]:
    """Expose source-trace stages with raw backend evidence retained."""
    crypto = result.get("cryptographic_verification", {})
    policy = result.get("repository_policy", {})
    hashes = result.get("release_artifact_hashes", {})
    metadata = result.get("sdist_inventory", {}).get("metadata", {})
    trace_verdict = result.get("verdict", {}).get("status")
    trace_stage = {"PASS": "VERIFIED", "FAIL": "FAILED"}.get(trace_verdict, "WARNING")
    provenance = result.get("provenance_availability", {"status": "not_checked"})
    stages = {
        "artifact_sha256": {
            "status": hashes.get("status", "not_checked"),
            "stage_status": _stage_status(hashes.get("status")),
            "artifacts": hashes.get("artifacts", []),
        },
        "distribution_metadata": {
            "status": "matched" if metadata.get("matches_requested_release") is True else "mismatch" if metadata.get("matches_requested_release") is False else "not_checked",
            "stage_status": "VERIFIED" if metadata.get("matches_requested_release") is True else "FAILED" if metadata.get("matches_requested_release") is False else "NOT_CHECKED",
            "sdist": metadata,
            "wheel_metadata": result.get("wheel_metadata"),
            "wheel_metadata_matches": result.get("wheel_metadata_matches"),
        },
        "provenance_availability": {**provenance, "stage_status": _stage_status(provenance.get("status"))},
        "cryptographic_attestation": {**crypto, "stage_status": _stage_status(crypto.get("status"))},
        "publisher_policy": {**policy, "stage_status": _stage_status(policy.get("status"))},
        "wheel_record": {**result.get("wheel_record", {"status": "not_checked"}), "stage_status": _stage_status(result.get("wheel_record", {}).get("status"))},
        "wheel_inventory": {**result.get("wheel_inventory", {"status": "not_checked"}), "stage_status": _stage_status(result.get("wheel_inventory", {}).get("status"))},
        "sdist_inventory": {**result.get("sdist_inventory", {"status": "not_checked"}), "stage_status": _stage_status(result.get("sdist_inventory", {}).get("status"))},
        "release_consistency": {**result.get("release_consistency", {"status": "not_checked"}), "stage_status": _stage_status(result.get("release_consistency", {}).get("status"))},
        "source_reference": {**result.get("source_reference", {"status": "unavailable"}), "stage_status": _stage_status(result.get("source_reference", {}).get("status"))},
        "commit_resolution": {**result.get("commit_resolution", {"status": "unavailable"}), "stage_status": _stage_status(result.get("commit_resolution", {}).get("status"))},
        "source_inventory": {
            **result.get("source_inventory", {"status": "unavailable"}),
            "stage_status": (
                "VERIFIED" if result.get("source_inventory", {}).get("complete") is True
                else "WARNING" if result.get("source_inventory", {}).get("complete") is False
                and "UNAVAILABLE" not in result.get("source_inventory", {}).get("status", "")
                else "UNAVAILABLE"
            ),
        },
        "file_comparison": {**result.get("file_comparison", {"status": "not_checked"}), "stage_status": _stage_status(result.get("file_comparison", {}).get("status"))},
        "source_trace": {"status": result.get("status", "unavailable"), "stage_status": trace_stage, "checked": True},
        "limitations": result.get("limitations", []),
    }
    return stages


def _validate_release_component(value: Any, field: str) -> str:
    pattern = _PROJECT_COMPONENT if field == "project" else _VERSION_COMPONENT
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise _RequestError(400, "INVALID_REQUEST", "{} is invalid.".format(field))
    return value


def _release_route(path: str) -> tuple[str, str] | None:
    parsed = urlsplit(path)
    if parsed.query or parsed.fragment:
        return None
    match = re.fullmatch(r"/api/v1/packages/([^/]+)/([^/]+)/files", parsed.path)
    if not match:
        return None
    components = []
    for raw in match.groups():
        if re.search(r"%(?![0-9A-Fa-f]{2})", raw):
            raise _RequestError(400, "INVALID_REQUEST", "Malformed URL path encoding.")
        try:
            value = unquote_to_bytes(raw).decode("utf-8")
        except UnicodeDecodeError as exc:
            raise _RequestError(400, "INVALID_REQUEST", "Path parameters must be valid UTF-8.") from exc
        components.append(value)
    return (
        _validate_release_component(components[0], "project"),
        _validate_release_component(components[1], "version"),
    )


def _validate_source_trace_request(payload: Any) -> dict[str, Any]:
    allowed = {"project", "version", "wheel_filename", "sdist_filename", "attested_filename", "expected_source_repository"}
    if not isinstance(payload, dict):
        raise _RequestError(400, "INVALID_REQUEST", "Request body must be a JSON object.")
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise _RequestError(400, "INVALID_REQUEST", "Unknown request field(s): {}.".format(", ".join(unknown)))
    project = _validate_release_component(payload.get("project"), "project")
    version = _validate_release_component(payload.get("version"), "version")
    filenames = {}
    for field in ("wheel_filename", "sdist_filename", "attested_filename"):
        filename = payload.get(field)
        if not isinstance(filename, str) or not filename or len(filename) > 255 or filename != filename.strip() or "/" in filename or "\\" in filename or _CONTROL_CHARS.search(filename):
            raise _RequestError(400, "INVALID_REQUEST", "{} must be an exact artifact filename.".format(field))
        filenames[field] = filename
    if not filenames["wheel_filename"].lower().endswith(".whl"):
        raise _RequestError(400, "INVALID_REQUEST", "wheel_filename must end with .whl.")
    if not filenames["sdist_filename"].lower().endswith(".tar.gz"):
        raise _RequestError(400, "INVALID_REQUEST", "sdist_filename must end with .tar.gz.")
    if filenames["attested_filename"] not in (filenames["wheel_filename"], filenames["sdist_filename"]):
        raise _RequestError(400, "INVALID_REQUEST", "attested_filename must equal the wheel or sdist filename.")
    repository = payload.get("expected_source_repository")
    if repository is not None:
        parts = repository.split("/") if isinstance(repository, str) else []
        owner_pattern = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")
        repo_pattern = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?$")
        if (
            not isinstance(repository, str)
            or len(repository) > 200
            or repository != repository.strip()
            or _CONTROL_CHARS.search(repository)
            or len(parts) != 2
            or not owner_pattern.fullmatch(parts[0])
            or not repo_pattern.fullmatch(parts[1])
            or parts[1] in (".", "..")
            or parts[1].endswith(".git")
        ):
            raise _RequestError(400, "INVALID_REQUEST", "expected_source_repository must be owner/repository.")
    return {"project": project, "version": version, **filenames, "expected_source_repository": repository}


def _safe_download_url(url: str) -> bool:
    try:
        parsed = urlsplit(url)
        return parsed.scheme == "https" and parsed.hostname == "files.pythonhosted.org" and parsed.username is None and parsed.password is None and parsed.port in (None, 443)
    except (TypeError, ValueError):
        return False


async def _download_source_trace_artifact(metadata: dict[str, Any], destination: Path, deadline: float) -> dict[str, Any]:
    filename = metadata.get("filename")
    size = metadata.get("size")
    digest = metadata.get("sha256")
    url = metadata.get("url")
    if not isinstance(filename, str) or Path(filename).name != filename or not _safe_download_url(url):
        raise ValueError("PyPI returned unsafe source-trace artifact metadata")
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        raise ValueError("PyPI returned an invalid artifact size")
    if size > MAX_SOURCE_ARTIFACT_BYTES:
        raise ValueError("Advertised source-trace artifact exceeds the configured size limit")
    response = await open_https_response(url, allowed_host="files.pythonhosted.org", deadline=deadline, headers={"Accept-Encoding": "identity"})
    try:
        if not _safe_download_url(response.url):
            raise ValueError("Artifact response redirected to an untrusted URL")
        if not 200 <= response.status < 300:
            raise RuntimeError("PyPI returned an unsuccessful artifact response")
        total = 0
        with destination.open("wb") as target:
            async for chunk in response.iter_bytes(1024 * 1024, MAX_SOURCE_ARTIFACT_BYTES):
                total += len(chunk)
                if total > MAX_SOURCE_ARTIFACT_BYTES:
                    raise ValueError("Source-trace artifact exceeds the configured size limit")
                if total > size:
                    raise ValueError("Downloaded artifact exceeds the PyPI-advertised size")
                target.write(chunk)
                if time.monotonic() >= deadline:
                    raise TimeoutError("Source-trace artifact download exceeded its total deadline")
        if total != size:
            raise ValueError("Downloaded artifact size does not match PyPI metadata")
        from pyverify.main import calculate_sha256
        actual = calculate_sha256(str(destination))
        if not isinstance(digest, str) or actual.lower() != digest.lower():
            raise ValueError("Downloaded artifact SHA256 does not match PyPI metadata")
        return {"filename": filename, "size": total, "sha256": actual, "matches": True}
    finally:
        response.close()


def _port_from_environment() -> int:
    raw_port = os.environ.get("PYVERIFY_API_PORT") or os.environ.get("PORT")
    if raw_port is None:
        return DEFAULT_PORT
    try:
        port = int(raw_port, 10)
    except ValueError as exc:
        raise ValueError("PYVERIFY_API_PORT or PORT must be an integer from 1 to 65535") from exc
    if not 1 <= port <= 65535:
        raise ValueError("PYVERIFY_API_PORT or PORT must be an integer from 1 to 65535")
    return port


def _host_from_environment() -> str:
    raw_host = os.environ.get("PYVERIFY_API_HOST", DEFAULT_HOST)
    try:
        return str(ipaddress.IPv4Address(raw_host))
    except ipaddress.AddressValueError as exc:
        raise ValueError("PYVERIFY_API_HOST must be a valid IPv4 address") from exc


class PyVerifyRequestHandler(BaseHTTPRequestHandler):
    server_version = "PyVerifyAPI/1"
    sys_version = ""

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, format: str, *args: Any) -> None:
        logging.getLogger("pyverify.api").info("%s - %s", self.address_string(), format % args)

    def _send_json(self, status: int, payload: dict[str, Any], *, extra_headers=None) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(body) > MAX_RESPONSE_BYTES:
            status = 502
            body = json.dumps(
                {"error": {"code": "RESULT_TOO_LARGE", "message": "Verification result exceeds the API response limit."}},
                separators=(",", ":"),
            ).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Vary", "Origin")
        origin = self.headers.get("Origin")
        if _local_origin(origin) and origin is not None:
            self.send_header("Access-Control-Allow-Origin", origin)
        if extra_headers:
            for name, value in extra_headers.items():
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, code: str, message: str, *, extra_headers=None) -> None:
        self._send_json(
            status,
            {"error": {"code": code, "message": message}},
            extra_headers=extra_headers,
        )

    def _check_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if not _local_origin(origin):
            self._error(403, "ORIGIN_NOT_ALLOWED", "The request origin is not allowlisted.")
            return False
        return True

    def do_GET(self) -> None:
        if not self._check_origin():
            return
        if self.path == "/api/health":
            self._send_json(200, {"status": "ok", "service": "pyverify"})
            return
        try:
            release = _release_route(self.path)
        except _RequestError as exc:
            self._error(exc.status, exc.code, exc.message)
            return
        if release is None:
            self._error(404, "NOT_FOUND", "Endpoint not found.")
            return
        try:
            result = get_pypi_release_files(*release)
        except FileNotFoundError:
            self._error(404, "RELEASE_NOT_FOUND", "The requested PyPI project or release was not found.")
        except (TimeoutError, asyncio.TimeoutError):
            self._error(504, "UPSTREAM_TIMEOUT", "PyPI release discovery exceeded its time limit.")
        except ValueError:
            self._error(502, "UPSTREAM_INVALID_RESPONSE", "PyPI returned invalid release metadata.")
        except (OSError, RuntimeError):
            self._error(502, "UPSTREAM_ERROR", "PyVerify could not fetch release metadata from PyPI.")
        else:
            self._send_json(200, {"release": result})

    def do_OPTIONS(self) -> None:
        if not self._check_origin():
            return
        try:
            is_release_route = _release_route(self.path) is not None
        except _RequestError as exc:
            self._error(exc.status, exc.code, exc.message)
            return
        if self.path not in ("/api/health", "/api/v1/verify", "/api/v1/source-trace") and not is_release_route:
            self._error(404, "NOT_FOUND", "Endpoint not found.")
            return
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.send_header("Vary", "Origin")
        origin = self.headers.get("Origin")
        if origin is not None:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_POST(self) -> None:
        if not self._check_origin():
            return
        if self.path == "/api/v1/source-trace":
            self._post_source_trace()
            return
        if self.path != "/api/v1/verify":
            self._error(404, "NOT_FOUND", "Endpoint not found.")
            return
        try:
            request = self._read_json()
            validated = _validate_request(request)
        except _RequestError as exc:
            self._error(exc.status, exc.code, exc.message)
            return

        try:
            verification = verify_pypi_artifact(
                validated["project"],
                validated["version"],
                validated["filename"],
                verify_attestations=validated["verify_attestations"],
                expected_github_repository=validated["expected_github_repository"],
                expected_workflow_filename=validated["expected_workflow_filename"],
            )
        except FileNotFoundError:
            self._error(404, "ARTIFACT_NOT_FOUND", "The exact artifact was not found in that PyPI release.")
            return
        except (TimeoutError, asyncio.TimeoutError):
            self._error(504, "UPSTREAM_TIMEOUT", "PyPI verification exceeded its time limit.")
            return
        except ValueError:
            self._error(502, "UPSTREAM_INVALID_RESPONSE", "PyPI returned invalid artifact or verification data.")
            return
        except (OSError, RuntimeError):
            self._error(502, "UPSTREAM_ERROR", "PyVerify could not complete the upstream verification request.")
            return
        except Exception:
            self._error(500, "INTERNAL_ERROR", "PyVerify encountered an internal error.")
            return

        if not isinstance(verification, dict):
            self._error(502, "INVALID_VERIFIER_RESPONSE", "The verification backend returned an invalid result.")
            return
        summary = verification.get("evidence_summary")
        verdict = verification.get("verdict")
        if not isinstance(verdict, dict) and isinstance(summary, dict):
            verdict = summary.get("verdict")
        response = {
            "verification": verification,
            "evidence": _evidence_map(verification),
            # This is the original backend verdict. The adapter does not recalculate it.
            "verdict": verdict,
        }
        try:
            encoded = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except (TypeError, ValueError):
            self._error(502, "INVALID_VERIFIER_RESPONSE", "The verification backend returned non-JSON evidence.")
            return
        if len(encoded) > MAX_RESPONSE_BYTES:
            self._error(502, "RESULT_TOO_LARGE", "Verification result exceeds the API response limit.")
            return
        self._send_json(200, response)

    def _post_source_trace(self) -> None:
        try:
            request = _validate_source_trace_request(self._read_json())
        except _RequestError as exc:
            self._error(exc.status, exc.code, exc.message)
            return

        deadline = time.monotonic() + SOURCE_DOWNLOAD_TIMEOUT
        try:
            async def fetch_metadata():
                return await asyncio.gather(
                    _get_pypi_artifact_metadata_with_deadline(
                        request["project"], request["version"], request["wheel_filename"], deadline
                    ),
                    _get_pypi_artifact_metadata_with_deadline(
                        request["project"], request["version"], request["sdist_filename"], deadline
                    ),
                )

            wheel_metadata, sdist_metadata = _run_coroutine_sync(fetch_metadata())
            if wheel_metadata.get("packagetype") != "bdist_wheel":
                raise ValueError("The selected wheel filename is not a PyPI wheel artifact")
            if sdist_metadata.get("packagetype") != "sdist":
                raise ValueError("The selected source filename is not a PyPI sdist artifact")
            with tempfile.TemporaryDirectory(prefix="pyverify-source-trace-") as temp_dir:
                temp_path = Path(temp_dir)
                wheel_path = temp_path / request["wheel_filename"]
                sdist_path = temp_path / request["sdist_filename"]

                async def download_pair():
                    return await asyncio.gather(
                        _download_source_trace_artifact(wheel_metadata, wheel_path, deadline),
                        _download_source_trace_artifact(sdist_metadata, sdist_path, deadline),
                    )

                downloaded = _run_coroutine_sync(download_pair())
                if time.monotonic() >= deadline:
                    raise TimeoutError("Source-trace artifact acquisition exceeded its total deadline")
                attested_path = wheel_path if request["attested_filename"] == request["wheel_filename"] else sdist_path
                result = verify_pypi_source_trace(
                    attested_path,
                    request["project"],
                    request["version"],
                    request["attested_filename"],
                    sdist_path,
                    wheel_path,
                    expected_source_repository=request["expected_source_repository"],
                )
                if not isinstance(result, dict):
                    raise ValueError("Source-trace backend returned an invalid response")
                response = {
                    "source_trace": result,
                    "artifacts": downloaded,
                    "evidence": _source_trace_evidence_map(result),
                    "verdict": result.get("verdict"),
                }
                encoded = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                if len(encoded) > MAX_RESPONSE_BYTES:
                    self._error(502, "RESULT_TOO_LARGE", "Source-trace result exceeds the API response limit.")
                    return
        except _RequestError as exc:
            self._error(exc.status, exc.code, exc.message)
            return
        except FileNotFoundError:
            self._error(404, "ARTIFACT_NOT_FOUND", "A selected exact artifact was not found in that PyPI release.")
            return
        except (TimeoutError, asyncio.TimeoutError):
            self._error(504, "UPSTREAM_TIMEOUT", "Source-trace acquisition exceeded its time limit.")
            return
        except ValueError:
            self._error(502, "UPSTREAM_INVALID_RESPONSE", "PyPI returned invalid artifact metadata or source-trace data.")
            return
        except (OSError, RuntimeError):
            self._error(502, "UPSTREAM_ERROR", "PyVerify could not acquire or inspect the selected release artifacts.")
            return
        except Exception:
            self._error(500, "INTERNAL_ERROR", "PyVerify encountered an internal source-trace error.")
            return
        self._send_json(200, response)

    def _read_json(self) -> Any:
        if self.headers.get("Transfer-Encoding") is not None:
            raise _RequestError(400, "UNSUPPORTED_TRANSFER_ENCODING", "Transfer-Encoding is not supported.")
        content_type = self.headers.get("Content-Type", "")
        if content_type.split(";", 1)[0].strip().lower() != "application/json":
            raise _RequestError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.")
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise _RequestError(411, "LENGTH_REQUIRED", "Content-Length is required.")
        if not raw_length.isascii() or not raw_length.isdecimal():
            raise _RequestError(400, "INVALID_CONTENT_LENGTH", "Content-Length must be a non-negative integer.")
        if len(raw_length) > 20:
            raise _RequestError(413, "REQUEST_TOO_LARGE", "Request body exceeds the size limit.")
        length = int(raw_length)
        if length > MAX_REQUEST_BYTES:
            raise _RequestError(413, "REQUEST_TOO_LARGE", "Request body exceeds the size limit.")
        if length == 0:
            raise _RequestError(400, "INVALID_JSON", "Request body must contain a JSON object.")
        body = self.rfile.read(length)
        if len(body) != length:
            raise _RequestError(400, "INCOMPLETE_REQUEST", "Request body ended before Content-Length bytes were received.")
        try:
            return json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise _RequestError(400, "INVALID_JSON", "Request body must be valid UTF-8 JSON.") from None

    def do_PUT(self) -> None:
        self._error(405, "METHOD_NOT_ALLOWED", "Method not allowed.", extra_headers={"Allow": "GET, POST, OPTIONS"})

    do_PATCH = do_PUT
    do_DELETE = do_PUT
    do_HEAD = do_PUT


def create_server(port: int | None = None, host: str | None = None) -> ThreadingHTTPServer:
    """Create the API server; binding remains loopback unless explicitly configured."""
    if port is None:
        port = _port_from_environment()
    if host is None:
        host = _host_from_environment()
    if isinstance(port, bool) or not isinstance(port, int) or not 0 <= port <= 65535:
        raise ValueError("port must be an integer from 0 to 65535")
    try:
        host = str(ipaddress.IPv4Address(host))
    except ipaddress.AddressValueError as exc:
        raise ValueError("host must be a valid IPv4 address") from exc
    return ThreadingHTTPServer((host, port), PyVerifyRequestHandler)


def main() -> None:
    port = _port_from_environment()
    host = _host_from_environment()
    server = create_server(port, host)
    log_level = os.environ.get("PYVERIFY_LOG_LEVEL", "INFO").upper()
    if log_level not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}:
        log_level = "INFO"
    logging.basicConfig(
        level=getattr(logging, log_level),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    print("PyVerify API listening at http://{}:{}".format(host, server.server_port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
