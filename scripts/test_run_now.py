"""Regression tests for ByteForce launcher package-manager selection."""

from __future__ import annotations

import tempfile
import unittest
import subprocess
import os
import signal
import sys
from pathlib import Path
from unittest.mock import patch

import run_now


class PackageManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.frontend = self.root / "frontend byteforce"
        self.frontend.mkdir()
        self.manifest = {
            "scripts": {"dev": "next dev"},
            "dependencies": {"next": "16.4.3"},
        }
        self.frontend.joinpath("package.json").write_text('{"name":"test"}')
        self.addCleanup(self.temp.cleanup)

    def _patch_paths(self):
        stack = patch.multiple(run_now, ROOT=self.root, FRONTEND=self.frontend)
        stack.start()
        self.addCleanup(stack.stop)

    def test_npm_lockfile_selects_npm_without_yarn_installed(self) -> None:
        self._patch_paths()
        (self.frontend / "package-lock.json").write_text("{}")

        def executable(name: str) -> str | None:
            return "/usr/bin/npm" if name == "npm" else None

        with patch.object(run_now, "shutil_which", side_effect=executable):
            self.assertEqual(run_now.detect_package_manager(self.manifest), "npm")

    def test_yarn_lockfile_selects_yarn_when_yarn_is_available(self) -> None:
        self._patch_paths()
        (self.frontend / "yarn.lock").write_text("# yarn lockfile")

        with patch.object(run_now, "shutil_which", return_value="/usr/bin/yarn"):
            self.assertEqual(run_now.detect_package_manager(self.manifest), "yarn")

    def test_yarn_lockfile_without_yarn_fails_without_switching(self) -> None:
        self._patch_paths()
        (self.frontend / "yarn.lock").write_text("# yarn lockfile")

        with patch.object(run_now, "shutil_which", return_value=None):
            with self.assertRaisesRegex(run_now.LaunchError, "yarn is required"):
                run_now.detect_package_manager(self.manifest)

    def test_conflicting_lockfiles_fail_without_selecting_a_manager(self) -> None:
        self._patch_paths()
        (self.frontend / "package-lock.json").write_text("{}")
        (self.frontend / "yarn.lock").write_text("# yarn")
        with patch.object(run_now, "shutil_which", return_value="/usr/bin/npm"):
            with self.assertRaisesRegex(run_now.LaunchError, "Multiple frontend lockfiles"):
                run_now.detect_package_manager(self.manifest)

    def test_missing_node_is_reported(self) -> None:
        with patch.object(run_now, "shutil_which", return_value=None):
            with self.assertRaisesRegex(run_now.LaunchError, "Node.js is required"):
                run_now.check_node_version(self.manifest)

    def test_missing_python_is_reported(self) -> None:
        with patch.object(run_now.sys, "version_info", (3, 9)):
            with self.assertRaisesRegex(run_now.LaunchError, "PyVerify needs Python 3.10+"):
                run_now.compatible_python()

    def test_npm_install_does_not_probe_or_execute_yarn(self) -> None:
        self._patch_paths()
        (self.frontend / "package.json").write_text('{"name":"test","scripts":{"dev":"next dev"}}')
        (self.frontend / "package-lock.json").write_text("lock")
        calls: list[list[str]] = []

        def executable(name: str) -> str | None:
            return "/usr/bin/npm" if name == "npm" else None

        with (
            patch.object(run_now, "shutil_which", side_effect=executable),
            patch.object(run_now, "yarn_major", side_effect=AssertionError("npm must not probe Yarn")),
            patch.object(run_now, "run_checked", side_effect=lambda command, **kwargs: calls.append(command)),
        ):
            run_now.install_frontend_dependencies("npm")

        self.assertEqual(calls, [["npm", "ci"]])

    def test_yarn_install_uses_lockfile_frozen_flag(self) -> None:
        self._patch_paths()
        self.frontend.joinpath("package.json").write_text('{"name":"test","scripts":{"dev":"next dev"}}')
        (self.frontend / "yarn.lock").write_text("lock")
        calls: list[list[str]] = []

        with (
            patch.object(run_now, "shutil_which", return_value="/usr/bin/yarn"),
            patch.object(run_now, "yarn_major", return_value=1),
            patch.object(run_now, "run_checked", side_effect=lambda command, **kwargs: calls.append(command)),
        ):
            run_now.install_frontend_dependencies("yarn")

        self.assertEqual(calls, [["yarn", "install", "--frozen-lockfile"]])

    def test_next_dev_is_bound_to_loopback_port_3001(self) -> None:
        framework, port, args = run_now.detect_frontend_command(self.manifest)
        self.assertEqual(framework, "Next.js")
        self.assertEqual(port, 3001)
        self.assertEqual(args, ["--hostname", "127.0.0.1", "--port", "3001"])

    def test_occupied_port_message_shows_listener_pid_without_signalling(self) -> None:
        result = subprocess.CompletedProcess(
            args=["lsof"], returncode=0, stdout="55906\n55906\nnot-a-pid\n", stderr=""
        )
        with (
            patch.object(run_now, "shutil_which", return_value="/usr/sbin/lsof"),
            patch.object(run_now.subprocess, "run", return_value=result) as run,
        ):
            message = run_now.occupied_port_message(3001, "Frontend")

        self.assertIn("PID(s): 55906", message)
        self.assertIn("never kills processes", message)
        run.assert_called_once_with(
            ["/usr/sbin/lsof", "-nP", "-t", "-iTCP:3001", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_startup_failure_is_reported_for_backend_and_frontend(self) -> None:
        process = subprocess.Popen([sys.executable, "-c", "raise SystemExit(7)"])
        process.wait(timeout=5)
        for label in ("PyVerify API", "ByteForce frontend"):
            with self.subTest(label=label):
                with self.assertRaisesRegex(run_now.LaunchError, "exited with code 7"):
                    run_now.wait_http("http://127.0.0.1:1", process, 1, label)

    def test_repeated_dependency_check_is_idempotent(self) -> None:
        self._patch_paths()
        (self.frontend / "package.json").write_text('{"scripts":{"dev":"next dev"}}')
        (self.frontend / "package-lock.json").write_text("lock")
        (self.frontend / "node_modules").mkdir()
        stamp = self.root / ".pyverify-local" / "frontend-dependencies.sha256"
        with patch.object(run_now, "run_checked") as run:
            run_now.install_frontend_dependencies("npm")
            run_now.install_frontend_dependencies("npm")
        run.assert_called_once()

    def test_ctrl_c_stops_only_the_launcher_owned_process_group(self) -> None:
        unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        harness = r'''import os, signal, sys, time
sys.path.insert(0, sys.argv[1])
import run_now
for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
    signal.signal(sig, run_now.signal_handler)
child = run_now.spawn([sys.executable, "-c", "import time; time.sleep(30)"], cwd=__import__("pathlib").Path.cwd(), env=os.environ.copy(), label="test child")
print(child.pid, flush=True)
while True: time.sleep(1)
'''
        launcher = subprocess.Popen(
            [sys.executable, "-c", harness, str(Path(run_now.__file__).parent)],
            cwd=self.root,
            stdout=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        try:
            assert launcher.stdout is not None
            child_pid = None
            for line in launcher.stdout:
                try:
                    child_pid = int(line.strip())
                    break
                except ValueError:
                    continue
            self.assertIsNotNone(child_pid, "launcher harness should report its child PID")
            os.kill(launcher.pid, signal.SIGINT)
            self.assertEqual(launcher.wait(timeout=8), 128 + signal.SIGINT)
            launcher.stdout.close()
            with self.assertRaises(ProcessLookupError):
                os.kill(child_pid, 0)
            self.assertIsNone(unrelated.poll(), "unrelated process should remain alive")
        finally:
            if launcher.poll() is None:
                launcher.kill()
                launcher.wait()
            unrelated.terminate()
            unrelated.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
