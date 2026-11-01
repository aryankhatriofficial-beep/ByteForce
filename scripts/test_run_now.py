"""Regression tests for ByteForce launcher package-manager selection."""

from __future__ import annotations

import tempfile
import unittest
import subprocess
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

    def test_frontend_reuse_requires_same_project_cwd_and_next_process(self) -> None:
        self._patch_paths()
        with (
            patch.object(run_now, "port_listener_pids", return_value=[123]),
            patch.object(run_now, "process_cwd", return_value=self.frontend.resolve()),
            patch.object(run_now, "process_command", return_value="next-server (v16.4.3)"),
            patch.object(run_now, "healthy_frontend", return_value=True) as healthy,
        ):
            self.assertTrue(run_now.healthy_project_frontend(3001))
        healthy.assert_called_once_with(3001)

    def test_frontend_reuse_rejects_a_listener_from_another_directory(self) -> None:
        self._patch_paths()
        with (
            patch.object(run_now, "port_listener_pids", return_value=[123]),
            patch.object(run_now, "process_cwd", return_value=self.root.resolve()),
            patch.object(run_now, "process_command", return_value="next-server (v16.4.3)"),
            patch.object(run_now, "healthy_frontend") as healthy,
        ):
            self.assertFalse(run_now.healthy_project_frontend(3001))
        healthy.assert_not_called()

    def test_inspect_frontend_reuses_healthy_project_server(self) -> None:
        self._patch_paths()
        (self.frontend / "package.json").write_text(
            '{"scripts":{"dev":"next dev"},"dependencies":{"next":"16.4.3"}}'
        )
        (self.frontend / "package-lock.json").write_text("lock")
        with (
            patch.object(run_now, "detect_package_manager", return_value="npm"),
            patch.object(run_now, "check_node_version", return_value="24.21.0"),
            patch.object(run_now, "detect_api_configuration", return_value={"NEXT_PUBLIC_PYVERIFY_API_BASE_URL": run_now.API_URL}),
            patch.object(run_now, "is_port_available", return_value=False),
            patch.object(run_now, "healthy_project_frontend", return_value=True),
        ):
            result = run_now.inspect_frontend()
        self.assertEqual(result[0:3], ("npm", {"NEXT_PUBLIC_PYVERIFY_API_BASE_URL": run_now.API_URL}, 3001))
        self.assertTrue(result[4])

    def test_inspect_frontend_still_rejects_an_unrelated_listener(self) -> None:
        self._patch_paths()
        (self.frontend / "package.json").write_text(
            '{"scripts":{"dev":"next dev"},"dependencies":{"next":"16.4.3"}}'
        )
        (self.frontend / "package-lock.json").write_text("lock")
        with (
            patch.object(run_now, "detect_package_manager", return_value="npm"),
            patch.object(run_now, "check_node_version", return_value="24.21.0"),
            patch.object(run_now, "detect_api_configuration", return_value={"NEXT_PUBLIC_PYVERIFY_API_BASE_URL": run_now.API_URL}),
            patch.object(run_now, "is_port_available", return_value=False),
            patch.object(run_now, "healthy_project_frontend", return_value=False),
            patch.object(run_now, "port_listener_pids", return_value=[456]),
        ):
            with self.assertRaisesRegex(run_now.LaunchError, r"PID\(s\): 456"):
                run_now.inspect_frontend()


if __name__ == "__main__":
    unittest.main()
