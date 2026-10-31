"""Conservative static comparison of source and wheel Python files."""

from pathlib import Path, PurePosixPath
from typing import Any

from pyverify.inventory import inspect_wheel_integrity
from pyverify.metadata import inspect_distribution_metadata
from pyverify.sdist import inspect_sdist


def _canonical_name(name: str) -> str:
    return "-".join(filter(None, name.lower().replace("_", "-").replace(".", "-").split("-")))


def _wheel_source_path(path: str) -> str | None:
    if not path.endswith(".py"):
        return None
    parts = path.split("/")
    if len(parts) >= 3 and parts[0].endswith(".data") and parts[1] in ("purelib", "platlib"):
        return "/".join(parts[2:])
    return path


def _counts(result: dict[str, Any]) -> dict[str, int]:
    keys = (
        "matching_files",
        "mismatched_files",
        "sdist_only_files",
        "wheel_only_files",
        "ambiguous_mappings",
    )
    return {key: len(result[key]) for key in keys}


def compare_sdist_and_wheel(
    sdist_path: str | Path,
    wheel_path: str | Path,
    project_name: str,
    version: str,
    *,
    sdist_limits: dict[str, int] | None = None,
    wheel_limits: dict[str, int] | None = None,
) -> dict[str, Any]:
    """Compare same-release archives without extracting or rebuilding them.

    Paths are matched by exact normalized relative path (with the standard
    wheel purelib/platlib relocation removed). Basename guesses are reported as
    ambiguous instead of being treated as correspondence.
    """
    sdist_inventory = inspect_sdist(
        sdist_path, project_name, version, **(sdist_limits or {})
    )
    wheel_integrity = inspect_wheel_integrity(wheel_path, **(wheel_limits or {}))
    wheel_inventory = wheel_integrity["artifact_inventory"]
    errors = []

    try:
        wheel_metadata = inspect_distribution_metadata(wheel_path)
    except (OSError, ValueError) as exc:
        wheel_metadata = None
        errors.append("Could not validate wheel project metadata: {}".format(exc))
    wheel_release_matches = bool(
        wheel_metadata
        and _canonical_name(wheel_metadata.get("name", "")) == _canonical_name(project_name)
        and wheel_metadata.get("version") == version
    )
    if not wheel_release_matches:
        errors.append("Wheel metadata does not match the requested project/version")

    if not sdist_inventory["complete"]:
        errors.extend(sdist_inventory["errors"])
    if not wheel_inventory["complete"]:
        errors.extend(wheel_inventory["errors"])

    sdist_sources = {
        entry["relative_path"]: entry
        for entry in sdist_inventory["entries"]
        if entry["relative_path"].endswith(".py")
    }
    wheel_sources = {}
    for entry in wheel_inventory["entries"]:
        mapped_path = _wheel_source_path(entry["path"])
        if mapped_path is not None:
            wheel_sources.setdefault(mapped_path, []).append(entry)

    matching = []
    mismatched = []
    sdist_only = []
    wheel_only = []
    ambiguous = []
    for source_path, sdist_entry in sorted(sdist_sources.items()):
        wheel_candidates = wheel_sources.get(source_path, [])
        if len(wheel_candidates) > 1:
            ambiguous.append({"path": source_path, "sdist_path": sdist_entry["path"], "wheel_paths": [item["path"] for item in wheel_candidates]})
        elif len(wheel_candidates) == 1:
            wheel_entry = wheel_candidates[0]
            evidence = {
                "path": source_path,
                "sdist_path": sdist_entry["path"],
                "wheel_path": wheel_entry["path"],
                "sdist_sha256": sdist_entry["sha256"],
                "wheel_sha256": wheel_entry["hashes"]["sha256"],
                "sdist_size": sdist_entry["size"],
                "wheel_size": wheel_entry["size"],
            }
            (matching if sdist_entry["sha256"] == wheel_entry["hashes"]["sha256"] else mismatched).append(evidence)
        else:
            same_basename = [
                path for path in wheel_sources
                if PurePosixPath(path).name == PurePosixPath(source_path).name
            ]
            if same_basename:
                ambiguous.append({"path": source_path, "sdist_path": sdist_entry["path"], "wheel_paths": [item["path"] for path in same_basename for item in wheel_sources[path]]})
            else:
                sdist_only.append({"path": source_path, "sdist_path": sdist_entry["path"], "sha256": sdist_entry["sha256"], "size": sdist_entry["size"]})

    for wheel_path_key, candidates in sorted(wheel_sources.items()):
        if wheel_path_key not in sdist_sources:
            for entry in candidates:
                same_basename = [path for path in sdist_sources if PurePosixPath(path).name == PurePosixPath(wheel_path_key).name]
                if same_basename:
                    ambiguous.append({"path": wheel_path_key, "sdist_paths": [sdist_sources[path]["path"] for path in same_basename], "wheel_path": entry["path"]})
                else:
                    wheel_only.append({"path": wheel_path_key, "wheel_path": entry["path"], "sha256": entry["hashes"]["sha256"], "size": entry["size"]})

    complete = sdist_inventory["complete"] and wheel_inventory["complete"] and wheel_release_matches
    if not complete or ambiguous or (not matching and not mismatched):
        status = "RELEASE_FILES_PARTIAL"
    elif mismatched:
        status = "RELEASE_FILES_DIFFER"
    elif sdist_only or wheel_only:
        status = "RELEASE_FILES_PARTIAL"
    else:
        status = "RELEASE_FILES_MATCH"

    result = {
        "status": status,
        "complete": complete,
        "project_name": project_name,
        "version": version,
        "sdist_inventory": sdist_inventory,
        "wheel_inventory": wheel_inventory,
        "wheel_record": wheel_integrity["record_integrity"],
        "wheel_metadata": wheel_metadata,
        "matching_files": matching,
        "mismatched_files": mismatched,
        "sdist_only_files": sdist_only,
        "wheel_only_files": wheel_only,
        "ambiguous_mappings": ambiguous,
        "errors": errors,
        "limitations": [
            "Static file comparison does not prove reproducible builds or complete source-to-binary correspondence.",
            "Only unambiguous Python source paths are compared; generated, compiled, renamed, or transformed files may not map.",
        ],
    }
    result["counts"] = _counts(result)
    return result
