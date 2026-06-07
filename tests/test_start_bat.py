#!/usr/bin/env python3
"""Tests for start.bat port environment variable support.

Verifies that start.bat:
  - Defines APP_PORT, UPDATER_PORT, AI_PORT from WRITINGWAY_* env vars
  - Defaults to 8000, 8001, 8080 when env vars are unset
  - Uses !VAR! syntax (not %VAR%) for all runtime port references
  - Replaces every hardcoded port in status messages, curl calls, and browser-open
"""

import re
import unittest
from pathlib import Path

BATCH_PATH = Path(__file__).resolve().parent.parent / "start.bat"


class TestPortVariableDefinitions(unittest.TestCase):
    """Acceptance-criterion: env vars are read and default values set."""

    def test_app_port_defined_from_env(self):
        """APP_PORT reads from %WRITINGWAY_PORT%."""
        text = BATCH_PATH.read_text()
        self.assertIn('set "APP_PORT=%WRITINGWAY_PORT%"', text)

    def test_updater_port_defined_from_env(self):
        """UPDATER_PORT reads from %WRITINGWAY_UPDATER_PORT%."""
        text = BATCH_PATH.read_text()
        self.assertIn('set "UPDATER_PORT=%WRITINGWAY_UPDATER_PORT%"', text)

    def test_ai_port_defined_from_env(self):
        """AI_PORT reads from %WRITINGWAY_AI_PORT%."""
        text = BATCH_PATH.read_text()
        self.assertIn('set "AI_PORT=%WRITINGWAY_AI_PORT%"', text)

    def test_default_app_port(self):
        """Default APP_PORT is 8000."""
        text = BATCH_PATH.read_text()
        self.assertIn('set "APP_PORT=8000"', text)

    def test_default_updater_port(self):
        """Default UPDATER_PORT is 8001."""
        text = BATCH_PATH.read_text()
        self.assertIn('set "UPDATER_PORT=8001"', text)

    def test_default_ai_port(self):
        """Default AI_PORT is 8080."""
        text = BATCH_PATH.read_text()
        self.assertIn('set "AI_PORT=8080"', text)

    def test_default_emptiness_check_app(self):
        """APP_PORT defaults to 8000 only when the env var is empty (not 8000)."""
        text = BATCH_PATH.read_text()
        self.assertIn('if "!APP_PORT!"=="" set "APP_PORT=8000"', text)

    def test_default_emptiness_check_updater(self):
        text = BATCH_PATH.read_text()
        self.assertIn('if "!UPDATER_PORT!"=="" set "UPDATER_PORT=8001"', text)

    def test_default_emptiness_check_ai(self):
        text = BATCH_PATH.read_text()
        self.assertIn('if "!AI_PORT!"=="" set "AI_PORT=8080"', text)


class TestNoHardcodedPortsInRuntimeLines(unittest.TestCase):
    """Acceptance-criterion: all hardcoded 8000/8001/8080 removed from
    status messages, curl calls, and browser-open commands."""

    _HARDCODED_RE = re.compile(r"\b(8000|8001|8080)\b")

    def _get_lines(self):
        text = BATCH_PATH.read_text()
        return [line.strip() for line in text.splitlines()]

    def _runtime_lines(self):
        """Lines that should NOT contain hardcoded port numbers.

        We exclude:
          - Comment lines
          - The three default-value assignments inside the port-config block
          - Lines that are only assigning defaults
        """
        lines = self._get_lines()
        result = []
        in_port_block = False
        for line in lines:
            # Detect the port-config block
            if "Read port configuration from environment" in line:
                in_port_block = True
                continue
            in_port_block = False

            # Skip pure comment lines and empty
            if not line or line.startswith("REM ") or line.startswith("rem "):
                result.append(line)  # keep for scanning (will catch false positives)

            # Skip the three default-value assignment lines
            if line in (
                'set "APP_PORT=8000"',
                'set "UPDATER_PORT=8001"',
                'set "AI_PORT=8080"',
            ):
                continue
            if '"" set "APP_PORT=8000"' in line:
                continue
            if '"" set "UPDATER_PORT=8001"' in line:
                continue
            if '"" set "AI_PORT=8080"' in line:
                continue

            result.append(line)
        return result

    def test_no_hardcoded_8000_in_runtime(self):
        """No hardcoded 8000 outside default-value lines."""
        line_text = " ".join(self._runtime_lines())
        self.assertEqual(
            list(self._HARDCODED_RE.finditer(line_text)), [],
            "Found hardcoded 8000 in runtime lines:",
        )

    def test_no_hardcoded_8001_in_runtime(self):
        """No hardcoded 8001 outside default-value lines."""
        line_text = " ".join(self._runtime_lines())
        self.assertEqual(
            list(self._HARDCODED_RE.finditer(line_text)), [],
            "Found hardcoded 8001 in runtime lines:",
        )

    def test_no_hardcoded_8080_in_runtime(self):
        """No hardcoded 8080 outside default-value lines."""
        line_text = " ".join(self._runtime_lines())
        self.assertEqual(
            list(self._HARDCODED_RE.finditer(line_text)), [],
            "Found hardcoded 8080 in runtime lines:",
        )


class TestVariableSyntaxUsed(unittest.TestCase):
    """Acceptance-criterion: !VAR! syntax is used throughout
    (matching delayedexpansion on line 2)."""

    def _get_lines(self):
        return BATCH_PATH.read_text().splitlines()

    def test_ai_port_in_start_command(self):
        """llama-server starts with --port !AI_PORT!."""
        lines = self._get_lines()
        start_line = [
            l for l in lines if "llama-server.exe" in l and "--port" in l
        ]
        self.assertEqual(len(start_line), 1, "Expected exactly one llama start line")
        self.assertIn("--port !AI_PORT!", start_line[0])

    def test_ai_port_in_health_check(self):
        """curl health check uses !AI_PORT!."""
        lines = self._get_lines()
        curl_line = [l for l in lines if "curl" in l and "health" in l]
        self.assertEqual(len(curl_line), 1, "Expected exactly one health-check curl")
        self.assertIn("!AI_PORT!", curl_line[0])
        self.assertIn("localhost:!AI_PORT!/health", curl_line[0])

    def test_ai_echo_ports_var(self):
        """AI startup echo uses !AI_PORT!."""
        lines = self._get_lines()
        ai_echo = [
            l for l in lines if "AI server starting on port" in l
        ]
        self.assertEqual(len(ai_echo), 1)
        self.assertIn("!AI_PORT!", ai_echo[0])

    def test_updater_echo_ports_var(self):
        """Updater echo uses !UPDATER_PORT!."""
        lines = self._get_lines()
        up_echo = [
            l for l in lines if "Updater service started on port" in l
        ]
        self.assertEqual(len(up_echo), 1)
        self.assertIn("!UPDATER_PORT!", up_echo[0])

    def test_app_server_echo_ports_var(self):
        """App-server echo uses !APP_PORT!."""
        lines = self._get_lines()
        echo = [
            l for l in lines if "Starting app server on port" in l
        ]
        self.assertEqual(len(echo), 1)
        self.assertIn("!APP_PORT!", echo[0])

    def test_web_ui_url_uses_app_port(self):
        """Web UI message uses !APP_PORT!."""
        lines = self._get_lines()
        urls = [
            l for l in lines if "Web UI:" in l and "http://" in l
        ]
        self.assertEqual(len(urls), 1)
        self.assertIn("!APP_PORT!", urls[0])

    def test_ai_api_url_uses_ai_port(self):
        """AI API message uses !AI_PORT!."""
        lines = self._get_lines()
        urls = [
            l for l in lines if "AI API:" in l and "http://" in l
        ]
        self.assertEqual(len(urls), 1)
        self.assertIn("!AI_PORT!", urls[0])

    def test_updater_url_uses_updater_port(self):
        """Updater message uses !UPDATER_PORT!."""
        lines = self._get_lines()
        urls = [
            l for l in lines if "Updater:" in l and "http://" in l
        ]
        self.assertEqual(len(urls), 1)
        self.assertIn("!UPDATER_PORT!", urls[0])

    def test_browser_open_uses_app_port(self):
        """Browser open uses !APP_PORT!."""
        lines = self._get_lines()
        browser = [
            l for l in lines if l.startswith('start "" http://')
        ]
        self.assertEqual(len(browser), 1)
        self.assertIn("!APP_PORT!", browser[0])
        self.assertIn("/main.html", browser[0])


class TestDelayedExpansionUsed(unittest.TestCase):
    """Verify delayedexpansion is enabled (prerequisite for !VAR! syntax)."""

    def test_enabledelayedexpansion_present(self):
        text = BATCH_PATH.read_text()
        self.assertIn("setlocal enabledelayedexpansion", text)


class TestPortBlockPlacement(unittest.TestCase):
    """The port config block must appear before any port usage."""

    def test_port_before_any_server_reference(self):
        """Port variable defines must appear before start_ai_server / start_web labels."""
        text = BATCH_PATH.read_text()
        lines = text.splitlines()

        # Find the port block: it starts with a REM about reading port config
        port_block_idx = None
        for i, line in enumerate(lines):
            if "Read port configuration from environment" in line:
                port_block_idx = i
                break

        self.assertIsNotNone(port_block_idx, "Port config block not found")

        # It must appear before :start_ai_server and :start_web labels
        start_ai_idx = next(
            (i for i, l in enumerate(lines) if l.strip() == ":start_ai_server"),
            None,
        )
        start_web_idx = next(
            (i for i, l in enumerate(lines) if l.strip() == ":start_web"),
            None,
        )

        self.assertIsNotNone(start_ai_idx, "start_ai_server label should exist")
        self.assertIsNotNone(start_web_idx, "start_web label should exist")
        pbi: int = port_block_idx  # type: ignore[assignment]
        ai: int = start_ai_idx  # type: ignore[assignment]
        web: int = start_web_idx  # type: ignore[assignment]
        self.assertTrue(pbi < ai)
        self.assertTrue(pbi < web)


if __name__ == "__main__":
    unittest.main()
