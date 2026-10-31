"""Trace release files to a pinned source commit from verified SLSA provenance."""

import asyncio
import hashlib
import math
import re
import tarfile
import tempfile
import time
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import quote, urlsplit

from pyverify._http import _within_deadline, open_https_response
from pyverify.attestations import (
    AttestationVerificationError,
    NoAttestationsError,
    ProvenanceNotFoundError,
    get_pypi_provenance,
    verify_pypi_provenance,
)
from pyverify.evidence import build_source_trace_verdict
from pyverify.inventory import _limit_is_valid, _normalized_path, inspect_wheel_integrity
from pyverify.main import calculate_sha256
from pyverify.metadata import inspect_distribution_metadata
from pyverify.release_consistency import compare_sdist_and_wheel
from pyverify.sdist import inspect_sdist
from pyverify.pypi import _get_pypi_artifact_metadata_with_deadline, _run_coroutine_sync


_SLSA_V1 = "https://slsa.dev/provenance/v1"
_SOURCE_HOST = "codeload.github.com"
_CHUNK_SIZE = 1024 * 1024
_DEFAULT_MAX_SOURCE_SIZE = 1024 * 1024 * 1024
_DEFAULT_MAX_MEMBERS = 100_000
_DEFAULT_MAX_MEMBER_SIZE = 512 * 1024 * 1024
_DEFAULT_MAX_UNCOMPRESSED_SIZE = 2 * 1024 * 1024 * 1024
_DEFAULT_DURATION = 5 * 60
_OWNER_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")
_REPO_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?$")
_COMMIT_RE = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")


def _valid_repository(owner: str, repository: str) -> bool:
    return (
        bool(_OWNER_RE.fullmatch(owner))
        and bool(_REPO_RE.fullmatch(repository))
        and repository not in (".", "..")
        and not repository.endswith(".git")
    )


def _parse_github_source_uri(uri: Any) -> tuple[str, str, str | None] | None:
    if not isinstance(uri, str) or len(uri) > 4096:
        return None
    try:
        parsed = urlsplit(uri[4:] if uri.startswith("git+") else uri)
        if (
            parsed.scheme != "https"
            or parsed.hostname != "github.com"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in (None, 443)
            or parsed.query
            or parsed.fragment
        ):
            return None
    except ValueError:
        return None
    path = parsed.path.strip("/")
    # SLSA source URIs may include @ref after the repository path.
    if "@" in path:
        path, ref = path.split("@", 1)
    else:
        ref = None
    if path.endswith(".git"):
        path = path[:-4]
    parts = path.split("/")
    if len(parts) != 2:
        return None
    owner, repository = parts
    if not _valid_repository(owner, repository):
        return None
    return owner, repository, ref


def _resolve_verified_source_reference(
    cryptographic_verification: dict[str, Any],
) -> dict[str, Any]:
    """Resolve a GitHub repo and immutable commit from verified SLSA v1 claims."""
    attestations = cryptographic_verification.get("attestations", [])
    candidates = []
    rejected = []
    for item in attestations:
        if item.get("cryptographically_verified") is not True:
            continue
        if item.get("predicate_type") != _SLSA_V1:
            continue
        predicate = item.get("predicate")
        if not isinstance(predicate, dict):
            rejected.append("Verified SLSA predicate is missing or malformed")
            continue
        build_definition = predicate.get("buildDefinition")
        dependencies = (
            build_definition.get("resolvedDependencies")
            if isinstance(build_definition, dict)
            else None
        )
        if not isinstance(dependencies, list):
            rejected.append("SLSA buildDefinition has no resolvedDependencies list")
            continue
        for dependency in dependencies:
            if not isinstance(dependency, dict):
                continue
            dependency_uri = dependency.get("uri")
            parsed = _parse_github_source_uri(dependency_uri)
            if parsed is None:
                if isinstance(dependency_uri, str) and "github.com" in dependency_uri.lower():
                    rejected.append("SLSA provenance contains a malformed GitHub source URI")
                continue
            owner, repository, ref = parsed
            digest = dependency.get("digest")
            commit = digest.get("gitCommit") if isinstance(digest, dict) else None
            if not isinstance(commit, str) or not _COMMIT_RE.fullmatch(commit):
                rejected.append("GitHub source dependency has no valid pinned gitCommit")
                continue
            if ref and _COMMIT_RE.fullmatch(ref) and ref != commit:
                rejected.append("GitHub source URI ref conflicts with its gitCommit digest")
                continue
            candidates.append((owner, repository, commit))

    if rejected:
        return {
            "status": "invalid",
            "repository": None,
            "commit": None,
            "errors": rejected,
        }
    unique = sorted(set((owner.lower(), repo.lower(), commit) for owner, repo, commit in candidates))
    if len(unique) == 1:
        owner, repository, commit = unique[0]
        # Preserve the canonical repository spelling from the verified URI.
        original = next(item for item in candidates if item[0].lower() == owner and item[1].lower() == repository and item[2] == commit)
        return {
            "status": "resolved",
            "repository": "{}/{}".format(original[0], original[1]),
            "owner": original[0],
            "repository_name": original[1],
            "commit": commit,
            "errors": [],
        }
    if len(unique) > 1:
        return {
            "status": "ambiguous",
            "repository": None,
            "commit": None,
            "errors": ["Verified SLSA attestations identify conflicting source repositories or commits"],
        }
    return {
        "status": "invalid" if rejected else "unavailable",
        "repository": None,
        "commit": None,
        "errors": rejected or ["No verified SLSA Provenance v1 GitHub source dependency was found"],
    }


def _validate_source_url(url: str) -> None:
    try:
        parsed = urlsplit(url)
        valid = (
            parsed.scheme == "https"
            and parsed.hostname == _SOURCE_HOST
            and parsed.username is None
            and parsed.password is None
            and parsed.port in (None, 443)
            and not parsed.query
            and not parsed.fragment
        )
    except (TypeError, ValueError):
        valid = False
    if not valid:
        raise ValueError("Untrusted source snapshot URL")


def _source_archive_inventory(
    archive_path: Path,
    repository: str,
    commit: str,
    *,
    max_members: int,
    max_member_size: int,
    max_uncompressed_size: int,
) -> dict[str, Any]:
    errors = []
    entries = []
    seen = set()
    roots = set()
    total_size = 0
    member_count = 0
    try:
        with tarfile.open(archive_path, mode="r|gz") as archive:
            for member in archive:
                member_count += 1
                if member_count > max_members:
                    errors.append("Source archive member count exceeds the configured limit")
                    break
                is_directory = member.isdir()
                try:
                    normalized = _normalized_path(member.name, directory=is_directory)
                except ValueError:
                    errors.append("Unsafe source archive path: {!r}".format(member.name))
                    break
                if normalized in seen:
                    errors.append("Duplicate normalized source archive path: {}".format(normalized))
                    break
                seen.add(normalized)
                parts = normalized.split("/")
                roots.add(parts[0])
                if len(parts) == 1 and is_directory:
                    if member.size != 0:
                        errors.append("Source archive directory has an invalid non-zero size")
                        break
                    continue
                if len(parts) < 2:
                    errors.append("Source files must be inside the archive top-level directory")
                    break
                if is_directory:
                    if member.size != 0:
                        errors.append("Source archive directory has an invalid non-zero size")
                        break
                    continue
                if not member.isfile():
                    errors.append("Source archive contains a link or unsupported member: {}".format(normalized))
                    break
                if member.size < 0 or member.size > max_member_size:
                    errors.append("Source archive member exceeds the configured limit: {}".format(normalized))
                    break
                total_size += member.size
                if total_size > max_uncompressed_size:
                    errors.append("Source archive exceeds the uncompressed size limit")
                    break
                member_stream = archive.extractfile(member)
                if member_stream is None:
                    errors.append("Could not read source archive member: {}".format(normalized))
                    break
                digest = hashlib.sha256()
                actual_size = 0
                with member_stream:
                    while True:
                        chunk = member_stream.read(_CHUNK_SIZE)
                        if not chunk:
                            break
                        actual_size += len(chunk)
                        if actual_size > max_member_size or actual_size + total_size - member.size > max_uncompressed_size:
                            errors.append("Actual source archive data exceeds configured limits")
                            break
                        digest.update(chunk)
                if errors:
                    break
                if actual_size != member.size:
                    errors.append("Source member advertised size differs from actual size: {}".format(normalized))
                    break
                entries.append({
                    "path": normalized,
                    "relative_path": "/".join(parts[1:]),
                    "size": actual_size,
                    "sha256": digest.hexdigest(),
                })
    except Exception as exc:
        errors.append("Malformed or unreadable source snapshot archive: {}".format(exc))

    allowed_roots = {
        (repository + "-" + commit[:7]).casefold(),
        (repository + "-" + commit).casefold(),
    }
    if not errors and len(roots) != 1:
        errors.append("Source snapshot must contain exactly one top-level directory")
    if not errors and next(iter(roots)).casefold() not in allowed_roots:
        errors.append("Source snapshot top-level directory does not match repository and commit")
    entries.sort(key=lambda item: item["path"])
    return {
        "status": "SOURCE_INVENTORY_COMPLETE" if not errors else "SOURCE_INVENTORY_INCOMPLETE",
        "complete": not errors,
        "entries": entries,
        "member_count": member_count,
        "total_uncompressed_size": sum(item["size"] for item in entries),
        "errors": errors,
    }


async def _download_source_snapshot(
    owner: str,
    repository: str,
    commit: str,
    destination: Path,
    deadline: float,
    max_source_size: int,
) -> str:
    url = "https://{}/{}/{}/tar.gz/{}".format(
        _SOURCE_HOST, quote(owner, safe=""), quote(repository, safe=""), commit
    )
    _validate_source_url(url)
    response = await _within_deadline(
        open_https_response(url, allowed_host=_SOURCE_HOST, deadline=deadline),
        deadline,
    )
    try:
        _validate_source_url(response.url)
        if not 200 <= response.status < 300:
            raise RuntimeError("GitHub returned an unsuccessful source snapshot response")
        content_length = response.headers.get("content-length")
        if content_length is not None:
            if not content_length.isascii() or not content_length.isdecimal():
                raise ValueError("Invalid source snapshot Content-Length")
            if int(content_length) > max_source_size:
                raise ValueError("Source snapshot exceeds the configured maximum size")
        downloaded = 0
        with destination.open("wb") as target:
            async for chunk in response.iter_bytes(_CHUNK_SIZE, max_source_size):
                downloaded += len(chunk)
                if downloaded > max_source_size:
                    raise ValueError("Source snapshot exceeds the configured maximum size")
                target.write(chunk)
        return response.url
    finally:
        response.close()


def _compare_source_edges(left: dict[str, Any], right: dict[str, Any], *, right_is_wheel: bool = False) -> dict[str, Any]:
    left_files = {
        item["relative_path"]: item
        for item in left.get("entries", [])
        if item["relative_path"].endswith(".py")
    }
    right_files: dict[str, list[dict[str, Any]]] = {}
    for item in right.get("entries", []):
        path = item.get("relative_path", item["path"])
        if right_is_wheel:
            parts = path.split("/")
            if len(parts) >= 3 and parts[0].endswith(".data") and parts[1] in ("purelib", "platlib"):
                path = "/".join(parts[2:])
        if path.endswith(".py"):
            right_files.setdefault(path, []).append(item)

    matching, modified, missing, additional, ambiguous = [], [], [], [], []
    for path, left_item in sorted(left_files.items()):
        candidates = right_files.get(path, [])
        if len(candidates) == 1:
            right_item = candidates[0]
            evidence = {
                "path": path,
                "left_sha256": left_item["sha256"],
                "right_sha256": right_item.get("sha256") or right_item.get("hashes", {}).get("sha256"),
                "left_size": left_item["size"],
                "right_size": right_item["size"],
            }
            (matching if evidence["left_sha256"] == evidence["right_sha256"] else modified).append(evidence)
        elif len(candidates) > 1:
            ambiguous.append({"path": path, "candidate_count": len(candidates)})
        else:
            by_basename = [name for name in right_files if PurePosixPath(name).name == PurePosixPath(path).name]
            if by_basename:
                ambiguous.append({"path": path, "candidate_paths": by_basename})
            else:
                missing.append({"path": path, "sha256": left_item["sha256"], "size": left_item["size"]})
    for path, candidates in sorted(right_files.items()):
        if path not in left_files:
            by_basename = [name for name in left_files if PurePosixPath(name).name == PurePosixPath(path).name]
            for item in candidates:
                if by_basename:
                    ambiguous.append({"path": path, "candidate_paths": by_basename})
                else:
                    additional.append({
                        "path": path,
                        "sha256": item.get("sha256") or item.get("hashes", {}).get("sha256"),
                        "size": item["size"],
                    })
    complete = left.get("complete") is True and right.get("complete") is True
    if not complete or ambiguous or (not matching and not modified):
        status = "PARTIAL"
    elif modified:
        status = "DIFFER"
    elif missing or additional:
        status = "PARTIAL"
    else:
        status = "MATCH"
    return {
        "status": status,
        "complete": complete,
        "matching_files": matching,
        "modified_files": modified,
        "missing_files": missing,
        "additional_files": additional,
        "ambiguous_files": ambiguous,
        "counts": {
            "matching": len(matching),
            "modified": len(modified),
            "missing": len(missing),
            "additional": len(additional),
            "ambiguous": len(ambiguous),
        },
    }


def _unavailable_result(reason: str, *, crypto_status: str = "not_checked") -> dict[str, Any]:
    result = {
        "status": "SOURCE_TRACE_PARTIAL",
        "source_reference": {"status": "unavailable", "repository": None, "commit": None, "errors": [reason]},
        "commit_resolution": {"status": "unavailable", "commit": None, "errors": [reason]},
        "repository_policy": {"status": "not_checked", "configured": False, "matches": None},
        "source_inventory": {"status": "SOURCE_INVENTORY_UNAVAILABLE", "complete": False, "entries": [], "errors": [reason]},
        "file_comparison": {"status": "PARTIAL", "counts": {}},
        "sdist_inventory": {"status": "SDIST_INVENTORY_NOT_CHECKED", "complete": None, "entries": []},
        "wheel_inventory": {"status": "INVENTORY_NOT_CHECKED", "complete": None, "entries": []},
        "wheel_record": {"status": "RECORD_NOT_CHECKED", "valid": None},
        "cryptographic_verification": {
            "status": crypto_status,
            "verified": False if crypto_status == "failed" else None,
        },
        "release_artifact_hashes": {"status": "not_checked", "artifacts": []},
        "warnings": [reason],
        "limitations": ["Static file comparison does not prove reproducible builds or complete source-to-binary correspondence."],
    }
    result["verdict"] = build_source_trace_verdict(result)
    return result


async def _trace_from_verified(
    verified_result: dict[str, Any],
    sdist_path: str | Path,
    wheel_path: str | Path,
    project_name: str,
    version: str,
    deadline: float,
    max_source_size: int,
    max_members: int,
    max_member_size: int,
    max_uncompressed_size: int,
    expected_source_repository: str | None,
) -> dict[str, Any]:
    crypto = verified_result.get("cryptographic_verification", {})
    crypto.setdefault("status", "verified" if crypto.get("verified") is True else "failed")
    reference = _resolve_verified_source_reference(crypto)
    repository_policy = {
        "status": "not_configured",
        "configured": expected_source_repository is not None,
        "expected_repository": expected_source_repository,
        "actual_repository": reference.get("repository"),
        "matches": None,
    }
    if expected_source_repository is not None and reference.get("status") == "resolved":
        repository_policy["matches"] = (
            expected_source_repository.casefold() == reference["repository"].casefold()
        )
        repository_policy["status"] = "matched" if repository_policy["matches"] else "mismatch"

    base = {
        "source_reference": reference,
        "commit_resolution": {
            "status": "resolved" if reference.get("status") == "resolved" else reference.get("status"),
            "commit": reference.get("commit"),
            "errors": reference.get("errors", []),
        },
        "repository_policy": repository_policy,
        "cryptographic_verification": crypto,
        "release_artifact_hashes": {"status": "not_checked", "artifacts": []},
        "limitations": [
            "Static comparison does not prove reproducible builds or complete source-to-binary correspondence.",
            "SLSA resolvedDependencies are best-effort provenance inputs and may not enumerate every build input.",
        ],
    }
    if reference.get("status") != "resolved":
        result = _unavailable_result("A verified pinned GitHub source reference was unavailable")
        result.update(base)
        result["status"] = "SOURCE_TRACE_PARTIAL"
        result["verdict"] = build_source_trace_verdict(result)
        return result
    if repository_policy["status"] == "mismatch":
        result = _unavailable_result("Verified source repository does not match the configured repository policy")
        result.update(base)
        result["repository_policy"] = repository_policy
        result["verdict"] = build_source_trace_verdict(result)
        return result

    owner = reference["owner"]
    repository = reference["repository_name"]
    commit = reference["commit"]
    source_url = None
    with tempfile.TemporaryDirectory(prefix="pyverify-source-") as temp_dir:
        archive_path = Path(temp_dir) / "source.tar.gz"
        try:
            source_url = await _download_source_snapshot(
                owner, repository, commit, archive_path, deadline, max_source_size
            )
            source_inventory = _source_archive_inventory(
                archive_path,
                repository,
                commit,
                max_members=max_members,
                max_member_size=max_member_size,
                max_uncompressed_size=max_uncompressed_size,
            )
        except (OSError, RuntimeError, TimeoutError, ValueError) as exc:
            source_inventory = {
                "status": "SOURCE_INVENTORY_INCOMPLETE",
                "complete": False,
                "entries": [],
                "errors": [str(exc)],
            }

        sdist_inventory = inspect_sdist(sdist_path, project_name, version)
        wheel_integrity = inspect_wheel_integrity(wheel_path)
        wheel_metadata = inspect_distribution_metadata(wheel_path)
        canonical_wheel_name = "-".join(filter(None, wheel_metadata.get("name", "").lower().replace("_", "-").replace(".", "-").split("-"))) if wheel_metadata else ""
        canonical_project_name = "-".join(filter(None, project_name.lower().replace("_", "-").replace(".", "-").split("-")))
        wheel_metadata_matches = bool(
            wheel_metadata
            and canonical_wheel_name == canonical_project_name
            and wheel_metadata.get("version") == version
        )
        if not wheel_metadata_matches:
            wheel_integrity["artifact_inventory"]["complete"] = False
            wheel_integrity["artifact_inventory"]["status"] = "INVENTORY_INCOMPLETE"
            wheel_integrity["artifact_inventory"].setdefault("errors", []).append("Wheel metadata does not match requested project/version")

        source_sdist = _compare_source_edges(source_inventory, sdist_inventory)
        source_wheel = _compare_source_edges(source_inventory, wheel_integrity["artifact_inventory"], right_is_wheel=True)
        release_comparison = compare_sdist_and_wheel(sdist_path, wheel_path, project_name, version)
        comparisons = {
            "source_to_sdist": source_sdist,
            "source_to_wheel": source_wheel,
            "sdist_to_wheel": {
                "status": release_comparison["status"].replace("RELEASE_FILES_", ""),
                "complete": release_comparison["complete"],
                "matching_files": release_comparison["matching_files"],
                "modified_files": release_comparison["mismatched_files"],
                "missing_files": release_comparison["sdist_only_files"],
                "additional_files": release_comparison["wheel_only_files"],
                "ambiguous_files": release_comparison["ambiguous_mappings"],
                "counts": {
                    "matching": release_comparison["counts"]["matching_files"],
                    "modified": release_comparison["counts"]["mismatched_files"],
                    "missing": release_comparison["counts"]["sdist_only_files"],
                    "additional": release_comparison["counts"]["wheel_only_files"],
                    "ambiguous": release_comparison["counts"]["ambiguous_mappings"],
                },
            },
        }
        edge_statuses = [item["status"] for item in comparisons.values()]
        if "DIFFER" in edge_statuses:
            comparison_status = "DIFFER"
        elif all(status == "MATCH" for status in edge_statuses):
            comparison_status = "MATCH"
        else:
            comparison_status = "PARTIAL"
        comparison_status = "RELEASE_FILES_" + comparison_status
        aggregate_counts = {
            key: sum(item["counts"][key] for item in comparisons.values())
            for key in ("matching", "modified", "missing", "additional", "ambiguous")
        }

        warnings = []
        if comparison_status != "MATCH":
            warnings.append("Source-to-release file comparison is {}.".format(comparison_status.lower()))
        if not source_inventory["complete"]:
            warnings.extend(source_inventory.get("errors", []))
        result = {
            **base,
            "status": "SOURCE_TRACE_PARTIAL",
            "source_reference": {**reference, "snapshot_url": source_url},
            "source_inventory": source_inventory,
            "sdist_inventory": sdist_inventory,
            "wheel_inventory": wheel_integrity["artifact_inventory"],
            "wheel_record": wheel_integrity["record_integrity"],
            "wheel_metadata": wheel_metadata,
            "wheel_metadata_matches": wheel_metadata_matches,
            "release_consistency": release_comparison,
            "file_comparison": {
                "status": comparison_status,
                "comparisons": comparisons,
                "counts": aggregate_counts,
            },
            "warnings": warnings,
        }
        result["verdict"] = build_source_trace_verdict(result)
        return result


def verify_source_trace(
    attested_artifact_path: str | Path,
    provenance,
    sdist_path: str | Path,
    wheel_path: str | Path,
    project_name: str,
    version: str,
    *,
    expected_source_repository: str | None = None,
    deadline: float | None = None,
    max_source_size: int = _DEFAULT_MAX_SOURCE_SIZE,
    max_source_duration: float = _DEFAULT_DURATION,
    max_members: int = _DEFAULT_MAX_MEMBERS,
    max_member_size: int = _DEFAULT_MAX_MEMBER_SIZE,
    max_uncompressed_size: int = _DEFAULT_MAX_UNCOMPRESSED_SIZE,
) -> dict[str, Any]:
    """Verify artifact provenance, fetch its pinned source snapshot, and compare files.

    ``provenance=None`` is reported as unavailable/partial. A supplied provenance
    object is always cryptographically verified here before any of its claims are used.
    """
    if provenance is None:
        return _unavailable_result("SLSA provenance is unavailable")
    if (
        not _limit_is_valid(max_source_size)
        or not _limit_is_valid(max_members)
        or not _limit_is_valid(max_member_size)
        or not _limit_is_valid(max_uncompressed_size)
    ):
        raise ValueError("Source trace limits must be positive integers")
    if (
        isinstance(max_source_duration, bool)
        or not isinstance(max_source_duration, (int, float))
        or not math.isfinite(max_source_duration)
        or max_source_duration <= 0
    ):
        raise ValueError("max_source_duration must be a positive finite number")
    if expected_source_repository is not None:
        parts = expected_source_repository.split("/")
        if len(parts) != 2 or not _valid_repository(*parts):
            raise ValueError("expected_source_repository must be a valid owner/repository")
    try:
        attested_path = Path(attested_artifact_path).resolve(strict=True)
        compared_paths = {Path(sdist_path).resolve(strict=True), Path(wheel_path).resolve(strict=True)}
    except OSError as exc:
        return _unavailable_result("Could not resolve local release artifact paths: {}".format(exc), crypto_status="failed")
    if attested_path not in compared_paths:
        return _unavailable_result(
            "The PEP 740 attested artifact must be the supplied sdist or wheel",
            crypto_status="failed",
        )
    try:
        verified = verify_pypi_provenance(attested_artifact_path, provenance)
    except (AttestationVerificationError, ValueError, OSError) as exc:
        return _unavailable_result("Cryptographic PEP 740 verification failed: {}".format(exc), crypto_status="failed")
    end = deadline if deadline is not None else time.monotonic() + max_source_duration
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(_trace_from_verified(
            verified, sdist_path, wheel_path, project_name, version, end,
            max_source_size, max_members, max_member_size, max_uncompressed_size,
            expected_source_repository,
        ))
    # Keep the sync API usable when called from an existing event loop.
    from pyverify.pypi import _run_coroutine_sync
    return _run_coroutine_sync(_trace_from_verified(
        verified, sdist_path, wheel_path, project_name, version, end,
        max_source_size, max_members, max_member_size, max_uncompressed_size,
        expected_source_repository,
    ))


def verify_pypi_source_trace(
    attested_artifact_path: str | Path,
    project_name: str,
    version: str,
    filename: str,
    sdist_path: str | Path,
    wheel_path: str | Path,
    *,
    expected_source_repository: str | None = None,
    max_source_size: int = _DEFAULT_MAX_SOURCE_SIZE,
    max_source_duration: float = _DEFAULT_DURATION,
    max_provenance_size: int = 10 * 1024 * 1024,
    max_members: int = _DEFAULT_MAX_MEMBERS,
    max_member_size: int = _DEFAULT_MAX_MEMBER_SIZE,
    max_uncompressed_size: int = _DEFAULT_MAX_UNCOMPRESSED_SIZE,
) -> dict[str, Any]:
    """Fetch PyPI provenance and trace local release files to its pinned source.

    The provenance request and GitHub snapshot share one absolute deadline.
    Missing provenance returns an explicit partial result.
    """
    if (
        isinstance(max_source_duration, bool)
        or not isinstance(max_source_duration, (int, float))
        or not math.isfinite(max_source_duration)
        or max_source_duration <= 0
    ):
        raise ValueError("max_source_duration must be a positive finite number")
    if filename not in (Path(sdist_path).name, Path(wheel_path).name):
        return _unavailable_result(
            "Attested filename must identify the supplied sdist or wheel",
            crypto_status="failed",
        )
    if (
        not _limit_is_valid(max_source_size)
        or not _limit_is_valid(max_members)
        or not _limit_is_valid(max_member_size)
        or not _limit_is_valid(max_uncompressed_size)
        or isinstance(max_provenance_size, bool)
        or not isinstance(max_provenance_size, int)
        or max_provenance_size < 1
    ):
        raise ValueError("Source trace limits must be positive integers")
    if expected_source_repository is not None:
        repository_parts = expected_source_repository.split("/")
        if len(repository_parts) != 2 or not _valid_repository(*repository_parts):
            raise ValueError("expected_source_repository must be a valid owner/repository")
    try:
        attested_path = Path(attested_artifact_path).resolve(strict=True)
        compared_paths = {
            Path(sdist_path).resolve(strict=True),
            Path(wheel_path).resolve(strict=True),
        }
    except OSError as exc:
        return _unavailable_result("Could not resolve local release artifact paths: {}".format(exc), crypto_status="failed")
    if attested_path not in compared_paths:
        return _unavailable_result(
            "The PEP 740 attested artifact must be the supplied sdist or wheel",
            crypto_status="failed",
        )
    end = time.monotonic() + max_source_duration

    async def fetch_release_metadata():
        import asyncio

        sdist_meta, wheel_meta = await asyncio.gather(
            _get_pypi_artifact_metadata_with_deadline(
                project_name, version, Path(sdist_path).name, end
            ),
            _get_pypi_artifact_metadata_with_deadline(
                project_name, version, Path(wheel_path).name, end
            ),
        )
        return sdist_meta, wheel_meta

    try:
        sdist_meta, wheel_meta = _run_coroutine_sync(fetch_release_metadata())
        release_evidence = []
        for artifact_path, metadata in ((sdist_path, sdist_meta), (wheel_path, wheel_meta)):
            path = Path(artifact_path)
            size = path.stat().st_size
            actual = calculate_sha256(str(path))
            matches = (
                isinstance(metadata.get("size"), int)
                and not isinstance(metadata.get("size"), bool)
                and metadata["size"] == size
                and metadata["sha256"].lower() == actual.lower()
            )
            release_evidence.append({
                "filename": path.name,
                "expected_sha256": metadata["sha256"],
                "actual_sha256": actual,
                "expected_size": metadata["size"],
                "actual_size": size,
                "matches": matches,
            })
    except (OSError, RuntimeError, TimeoutError, ValueError, FileNotFoundError) as exc:
        return _unavailable_result("Could not verify local release artifacts against PyPI: {}".format(exc))

    release_hashes = {
        "status": "verified" if all(item["matches"] for item in release_evidence) else "failed",
        "artifacts": release_evidence,
    }
    if release_hashes["status"] == "failed":
        result = _unavailable_result("A local sdist or wheel does not match the file published by PyPI")
        result["release_artifact_hashes"] = release_hashes
        result["verdict"] = build_source_trace_verdict(result)
        return result

    try:
        provenance = get_pypi_provenance(
            project_name,
            version,
            filename,
            deadline=end,
            max_response_size=max_provenance_size,
        )
    except (ProvenanceNotFoundError, NoAttestationsError) as exc:
        result = _unavailable_result("PyPI provenance is unavailable: {}".format(exc))
        result["release_artifact_hashes"] = release_hashes
        result["verdict"] = build_source_trace_verdict(result)
        return result
    except (OSError, RuntimeError, TimeoutError, ValueError) as exc:
        result = _unavailable_result("Could not retrieve PyPI provenance: {}".format(exc))
        result["release_artifact_hashes"] = release_hashes
        result["verdict"] = build_source_trace_verdict(result)
        return result
    result = verify_source_trace(
        attested_artifact_path,
        provenance,
        sdist_path,
        wheel_path,
        project_name,
        version,
        expected_source_repository=expected_source_repository,
        deadline=end,
        max_source_size=max_source_size,
        max_source_duration=max_source_duration,
        max_members=max_members,
        max_member_size=max_member_size,
        max_uncompressed_size=max_uncompressed_size,
    )
    result["release_artifact_hashes"] = release_hashes
    if (
        release_hashes["status"] == "verified"
        and result.get("source_inventory", {}).get("complete") is True
        and result.get("source_reference", {}).get("status") == "resolved"
        and result.get("file_comparison", {}).get("status") == "RELEASE_FILES_MATCH"
    ):
        result["status"] = "SOURCE_TRACE_COMPLETE"
    result["verdict"] = build_source_trace_verdict(result)
    return result
