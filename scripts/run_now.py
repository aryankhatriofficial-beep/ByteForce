#!/usr/bin/env python3
"""Local ByteForce launcher; owns and cleans up only child process groups it starts."""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "pyverify"
FRONTEND = ROOT / "frontend byteforce"
API_HOST = "127.0.0.1"
API_PORT = 8766
API_URL = f"http://{API_HOST}:{API_PORT}"
PYTHON_MIN = (3, 10)
FRONTEND_TIMEOUT = 90
BACKEND_TIMEOUT = 30
CHILDREN: list[subprocess.Popen[Any]] = []


class LaunchError(Exception):
    """An actionable local startup failure."""


def status(label: str, message: str) -> None:
    print(f"[{label}] {message}", flush=True)


def run_checked(command: list[str], *, cwd: Path, env=None, label: str) -> None:
    status(label, " ".join(command))
    subprocess.run(command, cwd=cwd, env=env, check=True)


def compatible_python() -> str:
    if sys.version_info[:2] < PYTHON_MIN:
        raise LaunchError(
            f"Launcher Python {sys.version.split()[0]} is too old; PyVerify needs Python 3.10+. "
            "Install a compatible python3 and retry."
        )
    status("CHECKING", f"Python {sys.version.split()[0]} ({sys.executable})")
    return sys.executable


def prepare_python() -> Path:
    base_python = compatible_python()
    # Reuse the existing project-local environment when present; otherwise keep
    # generated state at the repository root as the documented default.
    candidates = [BACKEND / ".venv", ROOT / ".venv"]
    env_dir = next((item for item in candidates if (item / "bin/python").is_file()), ROOT / ".venv")
    python = env_dir / "bin/python"
    if not python.is_file():
        status("INSTALLING", f"Creating local virtual environment at {env_dir}")
        run_checked([base_python, "-m", "venv", str(env_dir)], cwd=ROOT, label="INSTALLING")
    result = subprocess.run(
        [str(python), "-c", "import sys; print(sys.version_info[:2])"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    version = tuple(int(part) for part in re.findall(r"\d+", result.stdout))
    if version[:2] < PYTHON_MIN:
        raise LaunchError(f"The existing virtual environment uses Python {version}; remove it manually and retry.")

    marker_dir = ROOT / ".pyverify-local"
    marker = marker_dir / "pyproject.sha256"
    source_hash = hashlib.sha256((BACKEND / "pyproject.toml").read_bytes()).hexdigest()
    installed_editable = False
    probe = subprocess.run(
        [str(python), "-c", "import importlib.metadata as m; d=m.distribution('pyverify'); "
         "print(d.read_text('direct_url.json') or '')"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if probe.returncode == 0:
        try:
            metadata = json.loads(probe.stdout)
            installed_editable = bool(metadata.get("dir_info", {}).get("editable")) and Path(
                metadata.get("url", "").removeprefix("file://")
            ).resolve() == BACKEND.resolve()
        except (json.JSONDecodeError, OSError, ValueError):
            installed_editable = False
    if not installed_editable or not marker.is_file() or marker.read_text().strip() != source_hash:
        status("INSTALLING", "Installing PyVerify editable from ./pyverify")
        run_checked(
            [str(python), "-m", "pip", "install", "-e", "./pyverify"],
            cwd=ROOT,
            label="INSTALLING",
        )
        marker_dir.mkdir(exist_ok=True)
        marker.write_text(source_hash + "\n")
    else:
        status("READY", "PyVerify editable installation is current")
    return python


def inspect_frontend() -> tuple[str, str, int, list[str], bool]:
    if not FRONTEND.is_dir():
        raise LaunchError(
            f"Frontend folder is missing: {FRONTEND}\n"
            "Place the ByteForce frontend at exactly 'frontend byteforce/' in the repository root, then retry. "
            "No backend process was started."
        )
    manifest_path = FRONTEND / "package.json"
    if not manifest_path.is_file():
        raise LaunchError("Frontend folder exists but package.json is missing; no service was started.")
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise LaunchError(f"Could not read frontend package.json: {exc}") from exc
    if not isinstance(manifest, dict) or not isinstance(manifest.get("scripts"), dict):
        raise LaunchError("Frontend package.json must contain a scripts object.")
    if not manifest["scripts"].get("dev"):
        raise LaunchError("Frontend package.json has no 'dev' script; the launcher will not guess a start command.")

    package_manager = detect_package_manager(manifest)
    node_version = check_node_version(manifest)
    framework, port, extra_args = detect_frontend_command(manifest)
    api_env = detect_api_configuration()
    if api_env is None:
        raise LaunchError(
            "Could not find an existing frontend API setting for http://127.0.0.1:8766. "
            "Configure the frontend API client to use that address (or an existing environment variable) first. "
            "No services were started."
        )
    frontend_reused = False
    if not is_port_available(port):
        if healthy_project_frontend(port):
            frontend_reused = True
            status("READY", f"Reusing this ByteForce frontend at http://{API_HOST}:{port}")
        else:
            raise LaunchError(occupied_port_message(port, "Frontend"))
    status("CHECKING", f"Frontend: {framework}; package manager: {package_manager}; Node {node_version}; port {port}")
    return package_manager, api_env, port, extra_args, frontend_reused


def detect_package_manager(manifest: dict[str, Any]) -> str:
    lockfiles = {
        "npm": FRONTEND / "package-lock.json",
        "pnpm": FRONTEND / "pnpm-lock.yaml",
        "yarn": FRONTEND / "yarn.lock",
        "bun": FRONTEND / "bun.lock",
    }
    if (FRONTEND / "bun.lockb").is_file():
        lockfiles["bun"] = FRONTEND / "bun.lockb"
    present = [name for name, path in lockfiles.items() if path.is_file()]
    declared = manifest.get("packageManager")
    if declared:
        name = str(declared).split("@", 1)[0]
        if name not in lockfiles or name not in present:
            raise LaunchError("packageManager must match an existing supported lockfile.")
        if len(present) != 1:
            raise LaunchError("Multiple frontend lockfiles exist; remove the ambiguity before launching.")
        manager = name
    elif len(present) == 1:
        manager = present[0]
    else:
        raise LaunchError("Expected exactly one supported frontend lockfile; will not generate or choose one.")
    if not shutil_which(manager):
        raise LaunchError(f"{manager} is required by the frontend lockfile. Install it locally and retry.")
    return manager


def shutil_which(command: str) -> str | None:
    # Small wrapper keeps the launcher standard-library-only.
    import shutil

    return shutil.which(command)


def port_listener_pids(port: int) -> list[int]:
    """Return listener PIDs when lsof is available; never signal those processes."""
    lsof = shutil_which("lsof")
    if not lsof:
        return []
    result = subprocess.run(
        [lsof, "-nP", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"],
        capture_output=True,
        text=True,
        check=False,
    )
    pids: list[int] = []
    for line in result.stdout.splitlines():
        try:
            pid = int(line.strip())
        except ValueError:
            continue
        if pid not in pids:
            pids.append(pid)
    return pids


def process_cwd(pid: int) -> Path | None:
    """Read one process cwd without signaling or otherwise changing it."""
    lsof = shutil_which("lsof")
    if not lsof:
        return None
    result = subprocess.run(
        [lsof, "-a", "-p", str(pid), "-d", "cwd", "-Fn"],
        capture_output=True,
        text=True,
        check=False,
    )
    for line in result.stdout.splitlines():
        if line.startswith("n") and len(line) > 1:
            return Path(line[1:]).resolve()
    return None


def process_command(pid: int) -> str:
    ps = shutil_which("ps")
    if not ps:
        return ""
    result = subprocess.run(
        [ps, "-p", str(pid), "-o", "command="],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip()


def healthy_frontend(port: int) -> bool:
    """Check the local page without following redirects to another host."""
    connection = http.client.HTTPConnection(API_HOST, port, timeout=2)
    try:
        connection.request("GET", "/")
        response = connection.getresponse()
        content_type = response.getheader("Content-Type", "")
        body = response.read(1024 * 1024)
        return response.status == 200 and "text/html" in content_type and b"PyVerify" in body
    except (OSError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def healthy_project_frontend(port: int) -> bool:
    """Reuse only a healthy Next server whose listener cwd belongs to this app."""
    pids = port_listener_pids(port)
    if not pids:
        return False
    expected_cwd = FRONTEND.resolve()
    for pid in pids:
        command = process_command(pid).lower()
        if process_cwd(pid) != expected_cwd:
            return False
        if "next-server" not in command and "node_modules/next" not in command:
            return False
    return healthy_frontend(port)


def occupied_port_message(port: int, service: str) -> str:
    pids = port_listener_pids(port)
    listener = f" Listener PID(s): {', '.join(map(str, pids))}." if pids else ""
    return (
        f"{service} port {port} is already occupied.{listener} "
        "Stop or reconfigure that service yourself, then retry; the launcher never kills processes."
    )


def check_node_version(manifest: dict[str, Any]) -> str:
    node = shutil_which("node")
    if not node:
        raise LaunchError("Node.js is required by the frontend. Install a compatible Node.js locally and retry.")
    result = subprocess.run([node, "--version"], capture_output=True, text=True, check=True)
    version = result.stdout.strip().lstrip("v")
    match = re.match(r"(\d+)\.(\d+)", version)
    if not match:
        raise LaunchError(f"Could not understand installed Node.js version {version!r}.")
    major, minor = int(match.group(1)), int(match.group(2))
    for version_file in (FRONTEND / ".nvmrc", FRONTEND / ".node-version"):
        if version_file.is_file():
            requested = version_file.read_text().strip().lstrip("v")
            requested_match = re.match(r"(\d+)(?:\.(\d+))?", requested)
            if requested_match and major != int(requested_match.group(1)):
                raise LaunchError(f"Node {version} does not match {version_file.name} ({requested}).")
    engines = manifest.get("engines", {}).get("node") if isinstance(manifest.get("engines"), dict) else None
    if engines:
        # Enforce the common lower-bound forms without pretending to implement
        # the full npm semver grammar.
        lower = re.search(r">=\s*(\d+)(?:\.(\d+))?", str(engines))
        if lower and (major, minor) < (int(lower.group(1)), int(lower.group(2) or 0)):
            raise LaunchError(f"Node {version} is below the package.json engine requirement {engines}.")
        exact_major = re.fullmatch(r"(?:\^|~)?\s*(\d+)(?:\.\d+)?(?:\.\d+)?", str(engines))
        if exact_major and major != int(exact_major.group(1)):
            raise LaunchError(f"Node {version} does not match package.json engine requirement {engines}.")
    return version


def detect_frontend_command(manifest: dict[str, Any]) -> tuple[str, int, list[str]]:
    scripts = manifest["scripts"]
    dev_script = str(scripts["dev"])
    deps = {}
    for key in ("dependencies", "devDependencies"):
        if isinstance(manifest.get(key), dict):
            deps.update(manifest[key])
    if "next" in deps or re.search(r"(?:^|\s)next\s+dev(?:\s|$)", dev_script):
        return "Next.js", 3001, ["--hostname", API_HOST, "--port", "3001"]
    if "vite" in deps or re.search(r"(?:^|\s)vite(?:\s|$)", dev_script):
        return "Vite", 5173, ["--host", API_HOST, "--port", "5173", "--strictPort"]
    if "astro" in deps or re.search(r"(?:^|\s)astro\s+dev(?:\s|$)", dev_script):
        return "Astro", 4321, ["--host", API_HOST, "--port", "4321", "--strictPort"]
    if "nuxt" in deps or re.search(r"(?:^|\s)nuxt\s+dev(?:\s|$)", dev_script):
        return "Nuxt", 3001, ["--host", API_HOST, "--port", "3001"]
    raise LaunchError("Unsupported frontend dev server. The launcher supports detected Vite, Next.js, Astro, or Nuxt projects.")


def detect_api_configuration() -> dict[str, str] | None:
    variable = "NEXT_PUBLIC_PYVERIFY_API_BASE_URL"
    source_roots = [
        FRONTEND / name
        for name in ("src", "app", "pages", "lib")
        if (FRONTEND / name).is_dir()
    ]

    for source_root in source_roots:
        for path in source_root.rglob("*"):
            if path.is_file() and path.suffix in {
                ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"
            }:
                try:
                    if variable in path.read_text(errors="replace"):
                        return {variable: API_URL}
                except OSError:
                    continue

    return None


def install_frontend_dependencies(manager: str) -> None:
    lockfile_names = {
        "npm": "package-lock.json",
        "pnpm": "pnpm-lock.yaml",
        "yarn": "yarn.lock",
        "bun": "bun.lock" if (FRONTEND / "bun.lock").exists() else "bun.lockb",
    }
    lockfile = FRONTEND / lockfile_names[manager]
    stamp_dir = ROOT / ".pyverify-local"
    stamp = stamp_dir / "frontend-dependencies.sha256"
    digest = hashlib.sha256((FRONTEND / "package.json").read_bytes() + lockfile.read_bytes()).hexdigest()
    install_state_exists = (FRONTEND / "node_modules").is_dir() or (FRONTEND / ".pnp.cjs").is_file()
    if install_state_exists and stamp.is_file() and stamp.read_text().strip() == digest:
        status("READY", "Frontend dependencies match the lockfile")
        return
    if manager == "npm":
        command = ["npm", "ci"]
    elif manager == "pnpm":
        command = ["pnpm", "install", "--frozen-lockfile"]
    elif manager == "yarn":
        if not shutil_which("yarn"):
            raise LaunchError("Yarn is selected by the frontend lockfile but is not available in PATH.")
        yarn_install_flag = "--immutable" if yarn_major() >= 2 else "--frozen-lockfile"
        command = ["yarn", "install", yarn_install_flag]
    elif manager == "bun":
        command = ["bun", "install", "--frozen-lockfile"]
    else:
        raise LaunchError(f"Unsupported frontend package manager: {manager}")
    status("INSTALLING", "Installing frontend dependencies from the existing lockfile")
    run_checked(command, cwd=FRONTEND, label="INSTALLING")
    stamp_dir.mkdir(exist_ok=True)
    stamp.write_text(digest + "\n")


def yarn_major() -> int:
    result = subprocess.run(["yarn", "--version"], capture_output=True, text=True, check=True)
    return int(result.stdout.strip().split(".", 1)[0])


def is_port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex((API_HOST, port)) != 0


def healthy_backend() -> bool:
    try:
        with urllib.request.urlopen(API_URL + "/api/health", timeout=1) as response:
            data = json.loads(response.read(4096))
        return response.status == 200 and data == {"status": "ok", "service": "pyverify"}
    except (OSError, ValueError, urllib.error.URLError):
        return False


def ensure_api_port_safe() -> bool:
    if healthy_backend():
        status("READY", f"Reusing healthy PyVerify API at {API_URL}")
        return False
    if not is_port_available(API_PORT):
        raise LaunchError(
            f"Port {API_PORT} is occupied by a service that did not identify itself as PyVerify. "
            f"{occupied_port_message(API_PORT, 'Backend')}"
        )
    return True


def spawn(command: list[str], *, cwd: Path, env: dict[str, str], label: str) -> subprocess.Popen[Any]:
    status("STARTING", f"{label}: {' '.join(command)}")
    process = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True)
    CHILDREN.append(process)
    return process


def wait_http(url: str, process: subprocess.Popen[Any], timeout: int, label: str) -> None:
    deadline = time.monotonic() + timeout
    last_error = "no response yet"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise LaunchError(f"{label} exited with code {process.returncode} before becoming ready.")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if 200 <= response.status < 400:
                    status("READY", f"{label} responded at {url}")
                    return
                last_error = f"HTTP {response.status}"
        except (OSError, urllib.error.URLError, TimeoutError) as exc:
            last_error = str(exc)
        time.sleep(0.25)
    raise LaunchError(f"Timed out waiting for {label} at {url}: {last_error}")


def stop_children() -> None:
    # Each process was started in a fresh session, so its process group contains
    # only descendants of that exact launcher child.
    for process in reversed(CHILDREN):
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 8
    for process in reversed(CHILDREN):
        if process.poll() is None:
            try:
                process.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
    CHILDREN.clear()


def signal_handler(signum, _frame) -> None:
    status("STOPPED", f"Received {signal.Signals(signum).name}; stopping launcher-owned services")
    stop_children()
    raise SystemExit(128 + signum)


def main() -> int:
    print("╔══════════════════════════════════════════════╗")
    print("║          BYTEFORCE — PYVERIFY                ║")
    print("║          LOCAL DEVELOPMENT                  ║")
    print("╚══════════════════════════════════════════════╝")
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, signal_handler)
    try:
        status("CHECKING", "Required project files")
        if not (BACKEND / "pyproject.toml").is_file() or not (BACKEND / "src/pyverify/api.py").is_file():
            raise LaunchError("PyVerify project files are missing under ./pyverify.")
        # Inspect frontend before installing anything or starting a service.
        manager, api_env, frontend_port, frontend_args, frontend_reused = inspect_frontend()
        python = prepare_python()
        install_frontend_dependencies(manager)
        start_backend = ensure_api_port_safe()
        if start_backend:
            backend_env = os.environ.copy()
            backend_env["PYVERIFY_API_PORT"] = str(API_PORT)
            backend = spawn([str(python), "-m", "pyverify.api"], cwd=ROOT, env=backend_env, label="PyVerify API")
            wait_http(API_URL + "/api/health", backend, BACKEND_TIMEOUT, "PyVerify API")

        frontend_url = f"http://127.0.0.1:{frontend_port}"
        if not frontend_reused:
            frontend_env = os.environ.copy()
            frontend_env.update(api_env)
            # Pass loopback and a strict port to the detected framework's dev script.
            command = [manager, "run", "dev", "--", *frontend_args]
            frontend = spawn(command, cwd=FRONTEND, env=frontend_env, label="ByteForce frontend")
            wait_http(frontend_url, frontend, FRONTEND_TIMEOUT, "ByteForce frontend")
        status("READY", f"Backend: {API_URL}")
        status("READY", f"Frontend: {frontend_url}")
        if CHILDREN:
            status("READY", "Application is ready. Press Ctrl+C to stop only launcher-owned services.")
        else:
            status("READY", "Application was already running; existing services were left untouched.")
        subprocess.run(["open", frontend_url], check=False)
        if not CHILDREN:
            return 0
        while True:
            for child in CHILDREN:
                code = child.poll()
                if code is not None:
                    raise LaunchError(f"A launched service exited with code {code}.")
            time.sleep(0.5)
    except LaunchError as exc:
        status("FAILED", str(exc))
        return 1
    except subprocess.CalledProcessError as exc:
        status("FAILED", f"Command failed with exit code {exc.returncode}: {exc.cmd}")
        return 1
    except OSError as exc:
        status("FAILED", f"Local process or file operation failed: {exc}")
        return 1
    finally:
        if CHILDREN:
            stop_children()
            status("STOPPED", "Launcher-owned services stopped")


if __name__ == "__main__":
    raise SystemExit(main())
