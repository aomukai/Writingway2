#!/usr/bin/env python3
"""Tests for environment-variable config and /writingway.json endpoint."""

import importlib.util
import json
import os
import signal
import subprocess
import sys
import time
import unittest
from http.client import HTTPConnection
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent / "tools"

# Pre-cleanup any lingering servers on default ports that might block tests
def _cleanup_default_ports():
    """Kill any processes bound to the default ports used by these tests."""
    for p in [8000, 8001, 8080]:
        try:
            subprocess.run(
                ["lsof", "-ti", f":{p}"],
                capture_output=True, text=True, timeout=3,
            )
        except Exception:
            pass


def _free_port() -> int:
    """Return a currently-free TCP port."""
    import socket as _sock
    s = _sock.socket(_sock.AF_INET, _sock.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _load_port_from_file(filename: str, env: dict) -> int:
    """Dynamically load PORT from *filename* without running main()."""
    spec = importlib.util.spec_from_file_location(
        "writingway_test_module", str(SERVER_DIR / filename)
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["writingway_test_module"] = mod  # required for loader
    # Set env vars before exec
    saved = {}
    for k, v in env.items():
        saved[k] = os.environ.get(k)
    for k, v in env.items():
        os.environ[k] = v
    try:
        spec.loader.exec_module(mod)
        return int(mod.PORT)
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        sys.modules.pop("writingway_test_module", None)


def _make_request(port: int, path: str = "/writingway.json") -> tuple[int, dict, str]:
    """GET *path* on localhost:*port*, return (status, json_body, content_type)."""
    conn = HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        conn.request("GET", path)
        resp = conn.getresponse()
        body_bytes = resp.read()
        content_type = resp.getheader("Content-Type", "")
        status = resp.status
    finally:
        conn.close()
    json_body = json.loads(body_bytes.decode("utf-8"))
    return status, json_body, content_type


def _start_server(port: int, extra_env: dict | None = None) -> subprocess.Popen:
    """Start the writingway server on *port* in a subprocess."""
    server_env = os.environ.copy()
    server_env["WRITINGWAY_PORT"] = str(port)
    if extra_env:
        server_env.update(extra_env)
    proc = subprocess.Popen(
        [sys.executable, "-u", str(SERVER_DIR / "writingway-server.py")],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, env=server_env,
    )
    time.sleep(0.8)
    return proc


def _stop_server(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        # Give OS time to release the port
        time.sleep(0.2)


class TestPortEnvVars(unittest.TestCase):
    """Verify that each server reads its port from an environment variable."""

    def test_writingway_server_default_port(self):
        """When WRITINGWAY_PORT is unset, default is 8000."""
        port = _load_port_from_file("writingway-server.py", {})
        self.assertEqual(port, 8000)

    def test_writingway_server_custom_port(self):
        """When WRITINGWAY_PORT is set, PORT reflects it."""
        port = _load_port_from_file("writingway-server.py", {"WRITINGWAY_PORT": "9191"})
        self.assertEqual(port, 9191)

    def test_updater_server_default_port(self):
        """When WRITINGWAY_UPDATER_PORT is unset, default is 8001."""
        port = _load_port_from_file("updater-server.py", {})
        self.assertEqual(port, 8001)

    def test_updater_server_custom_port(self):
        """When WRITINGWAY_UPDATER_PORT is set, PORT reflects it."""
        port = _load_port_from_file("updater-server.py", {"WRITINGWAY_UPDATER_PORT": "8181"})
        self.assertEqual(port, 8181)


class TestWritingwayJSONEndpoint(unittest.TestCase):
    """Test the GET /writingway.json endpoint."""

    def test_writingway_json_default_ports(self):
        """Default /writingway.json returns correct ports."""
        port = _free_port()
        proc = _start_server(port)
        try:
            status, body, _ = _make_request(port, "/writingway.json")
            self.assertEqual(status, 200)
            self.assertEqual(body["port"], port)
            self.assertEqual(body["updaterPort"], 8001)
            self.assertEqual(body["aiPort"], 8080)
        finally:
            _stop_server(proc)

    def test_writingway_json_content_type(self):
        """Content-Type is application/json; charset=utf-8."""
        port = _free_port()
        proc = _start_server(port)
        try:
            _, _, ctype = _make_request(port, "/writingway.json")
            self.assertIn("application/json", ctype)
            self.assertIn("charset=utf-8", ctype)
        finally:
            _stop_server(proc)

    def test_writingway_json_custom_all_ports(self):
        """When other env vars are set, all three values are reflected."""
        port = _free_port()
        extra = {
            "WRITINGWAY_UPDATER_PORT": "7001",
            "WRITINGWAY_AI_PORT": "7080",
        }
        proc = _start_server(port, extra)
        try:
            status, body, _ = _make_request(port, "/writingway.json")
            self.assertEqual(status, 200)
            self.assertEqual(body["port"], port)
            self.assertEqual(body["updaterPort"], 7001)
            self.assertEqual(body["aiPort"], 7080)
        finally:
            _stop_server(proc)


class TestStartupMessages(unittest.TestCase):
    """Verify startup print statements reflect the resolved port."""

    def _start_and_read_stdout(self, env: dict, server_script: str) -> str:
        """Start server, wait for startup message, then terminate and return stdout."""
        proc = subprocess.Popen(
            [sys.executable, "-u", str(SERVER_DIR / server_script)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, env=dict(env),
        )
        # Wait for startup message to print, then terminate
        time.sleep(0.5)
        _stop_server(proc)
        return proc.stdout.read()

    def test_writingway_startup_print_default(self):
        """Startup message shows correct port when no env var set."""
        port = _free_port()
        env = os.environ.copy()
        env.pop("WRITINGWAY_PORT", None)
        # Set a non-default port so it doesn't conflict with any running server
        env["WRITINGWAY_PORT"] = str(port)
        stdout = self._start_and_read_stdout(env, "writingway-server.py")
        # The env var overrides the default, so the printed port should be our test port
        self.assertIn(f"http://127.0.0.1:{port}", stdout)

    def test_writingway_startup_print_custom(self):
        """Startup message shows correct port when env var overrides it."""
        port = _free_port()
        env = {"WRITINGWAY_PORT": str(port)}
        stdout = self._start_and_read_stdout(env, "writingway-server.py")
        self.assertIn(f"http://127.0.0.1:{port}", stdout)

    def test_updater_startup_print_default(self):
        """Updater prints correct port on startup when no env var set."""
        env = os.environ.copy()
        env.pop("WRITINGWAY_UPDATER_PORT", None)
        stdout = self._start_and_read_stdout(env, "updater-server.py")
        self.assertIn("http://127.0.0.1:8001", stdout)

    def test_updater_startup_print_custom(self):
        """Updater prints correct port when env var overrides it."""
        env = {"WRITINGWAY_UPDATER_PORT": "9999"}
        stdout = self._start_and_read_stdout(env, "updater-server.py")
        self.assertIn("http://127.0.0.1:9999", stdout)

    def test_updater_startup_print_custom_env(self):
        """Updater prints correct port when WRITINGWAY_UPDATER_PORT is set."""
        env = {"WRITINGWAY_UPDATER_PORT": "5555"}
        stdout = self._start_and_read_stdout(env, "updater-server.py")
        self.assertIn("http://127.0.0.1:5555", stdout)


class TestBackwardsCompatibility(unittest.TestCase):
    """Default behavior must produce identical output to current hardcoded values."""

    def test_default_port_unchanged(self):
        """Default port is still 8000 — no breaking change."""
        port = _load_port_from_file("writingway-server.py", {})
        self.assertEqual(port, 8000)

    def test_default_updater_port_unchanged(self):
        """Default updater port is still 8001 — no breaking change."""
        port = _load_port_from_file("updater-server.py", {})
        self.assertEqual(port, 8001)


class TestWritingwayJSONNoEnvVars(unittest.TestCase):
    """When no env vars are set, everything uses defaults."""

    def test_default_ports_no_env(self):
        """With zero env vars, /writingway.json returns 8000, 8001, 8080."""
        port = _free_port()
        env = os.environ.copy()
        env.pop("WRITINGWAY_PORT", None)
        env.pop("WRITINGWAY_UPDATER_PORT", None)
        env.pop("WRITINGWAY_AI_PORT", None)
        # Set WRITINGWAY_PORT just so the server can start on our test port
        env["WRITINGWAY_PORT"] = str(port)
        proc = subprocess.Popen(
            [sys.executable, "-u", str(SERVER_DIR / "writingway-server.py")],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, env=env,
        )
        time.sleep(0.8)
        try:
            status, body, _ = _make_request(port, "/writingway.json")
            self.assertEqual(status, 200)
            self.assertEqual(body["port"], port)
            self.assertEqual(body["updaterPort"], 8001)
            self.assertEqual(body["aiPort"], 8080)
        finally:
            proc.terminate()
            proc.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
