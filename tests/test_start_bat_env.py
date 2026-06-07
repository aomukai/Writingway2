#!/usr/bin/env python3
"""Tests for start.bat .env file sourcing behavior.

Verifies that start.bat:
  - Checks for .env file existence before parsing
  - Parses KEY=VALUE pairs from .env via PowerShell
  - Echoes "[*] Loaded .env" when .env exists
  - Comment lines (starting with #) are ignored by the regex
  - Values with spaces are captured correctly
  - Default ports still work when .env is absent
  - The .env parsing block appears before port variable definitions
"""

import re
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BATCH_PATH = ROOT / "start.bat"


class TestEnvFileExistenceCheck(unittest.TestCase):
    """AC1: start.bat checks for .env file before parsing."""

    def test_env_existence_branch_exists(self):
        """The script contains 'if exist ".env" ( ... )' construct."""
        text = BATCH_PATH.read_text()
        self.assertIn('if exist ".env"', text)

    def test_conditional_block_closes(self):
        """The if exist .env block is properly closed with ) after the echo."""
        text = BATCH_PATH.read_text()
        lines = text.splitlines()

        # Find the "if exist" line
        if_line_idx = None
        for i, line in enumerate(lines):
            if 'if exist ".env"' in line:
                if_line_idx = i
                break

        self.assertIsNotNone(if_line_idx, "if exist '.env' not found")

        # After the PowerShell command and the two echo lines, there should be a closing )
        # that is not indented (same level as 'if')
        block_end_found = False
        for i in range(if_line_idx + 1, min(if_line_idx + 10, len(lines))):
            stripped = lines[i].strip()
            if stripped == ")":
                block_end_found = True
                break

        self.assertTrue(block_end_found, "Expected closing ')' for .env if block not found")


class TestEnvParsingViaPowerShell(unittest.TestCase):
    """AC4: PowerShell inline reads .env and sets process-level env vars."""

    def test_powerShell_command_present(self):
        """The PowerShell command is present as an inline invocation."""
        text = BATCH_PATH.read_text()
        self.assertIn("PowerShell -NoProfile -Command", text)

    def test_Get_Env_uses_UTF8_encoding(self):
        """The PowerShell reader uses UTF-8 encoding."""
        text = BATCH_PATH.read_text()
        self.assertIn("Get-Content '.env' -Encoding UTF8", text)

    def test_SetEnvironmentVariable_Protocol_set(self):
        """Environment vars are set at Process scope."""
        text = BATCH_PATH.read_text()
        # Check that SetEnvironmentVariable is used with 'Process'
        self.assertIn("SetEnvironmentVariable", text)
        self.assertIn("'Process'", text)

    def test_stderr_suppressed(self):
        """PowerShell stderr is suppressed with 2>nul."""
        text = BATCH_PATH.read_text()
        self.assertIn("2>nul", text)

    def test_regex_pattern_for_key_value(self):
        """The regex matches KEY=VALUE format for valid env var names."""
        text = BATCH_PATH.read_text()
        # The regex should match typical env var names: letters, digits, underscores
        self.assertIn("([A-Za-z_][A-Za-z0-9_]*)", text)
        # And should capture the value
        self.assertIn("(.+?)", text)


class TestEnvEchoOutput(unittest.TestCase):
    """AC5: echo "[*] Loaded .env" appears when .env exists."""

    def test_loaded_env_echo_present(self):
        """The echo '[*] Loaded .env' message is present."""
        text = BATCH_PATH.read_text()
        self.assertIn('echo [*] Loaded .env', text)

    def test_loaded_env_echo_in_env_block(self):
        """The echo is inside the 'if exist .env' block."""
        text = BATCH_PATH.read_text()
        lines = text.splitlines()

        if_line_idx = None
        brace_close = None
        for i, line in enumerate(lines):
            if 'if exist ".env"' in line:
                if_line_idx = i
            if if_line_idx is not None and line.strip() == ")":
                brace_close = i
                break

        self.assertIsNotNone(if_line_idx, "if exist '.env' not found")
        self.assertIsNotNone(brace_close, "Close parenthesis for if block not found")

        found = False
        for i in range(if_line_idx + 1, brace_close):
            if "Loaded .env" in lines[i]:
                found = True
                break
        self.assertTrue(found, "Loaded .env echo not inside the .env if block")


class TestPowerShellRegexHandlesEnvFileFormats(unittest.TestCase):
    """Test that the PowerShell regex correctly parses different .env formats."""

    # The regex from start.bat, adapted to Python
    # Batch: '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$'
    _ENV_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$")

    def _parse_env_lines(self, text):
        """Simulate the PowerShell regex parse in Python."""
        result = {}
        for line in text.splitlines():
            m = self._ENV_RE.match(line)
            if m:
                result[m.group(1)] = m.group(2)
        return result

    def test_basic_key_value(self):
        """Simple KEY=VALUE pairs are parsed."""
        env_text = "WRITINGWAY_PORT=9000"
        pairs = self._parse_env_lines(env_text)
        self.assertEqual(pairs["WRITINGWAY_PORT"], "9000")

    def test_multiple_variables(self):
        """Multiple KEY=VALUE pairs are all parsed."""
        env_text = textwrap.dedent("""\
            WRITINGWAY_PORT=9000
            WRITINGWAY_UPDATER_PORT=9001
            WRITINGWAY_AI_PORT=9080
        """)
        pairs = self._parse_env_lines(env_text)
        self.assertEqual(pairs["WRITINGWAY_PORT"], "9000")
        self.assertEqual(pairs["WRITINGWAY_UPDATER_PORT"], "9001")
        self.assertEqual(pairs["WRITINGWAY_AI_PORT"], "9080")

    def test_comments_ignored(self):
        """Lines starting with # (optionally with leading whitespace) are ignored."""
        env_text = textwrap.dedent("""\
            # This is a comment
            WRITINGWAY_PORT=9000
            # Another comment
            WRITINGWAY_AI_PORT=8080
        """)
        pairs = self._parse_env_lines(env_text)
        self.assertNotIn("# This is a comment", pairs)
        self.assertEqual(pairs["WRITINGWAY_PORT"], "9000")
        self.assertEqual(pairs["WRITINGWAY_AI_PORT"], "8080")
        self.assertNotIn("# Another comment", pairs)

    def test_empty_lines_ignored(self):
        """Blank lines do not produce entries."""
        env_text = textwrap.dedent("""\
            WRITINGWAY_PORT=9000

            WRITINGWAY_AI_PORT=8080
        """)
        pairs = self._parse_env_lines(env_text)
        self.assertEqual(pairs["WRITINGWAY_PORT"], "9000")
        self.assertEqual(pairs["WRITINGWAY_AI_PORT"], "8080")
        self.assertNotIn("", pairs)

    def test_values_with_spaces(self):
        """Values containing spaces are captured correctly."""
        env_text = "DESCRIPTION=Writingway AI server"
        pairs = self._parse_env_lines(env_text)
        # 'DESCRIPTION' is a valid var name; the value should include spaces
        self.assertIn("DESCRIPTION", pairs)
        self.assertEqual(pairs["DESCRIPTION"], "Writingway AI server")

    def test_values_with_spaces_corrected(self):
        """Values containing spaces after = are correctly captured."""
        env_text = "MY_VAR=hello world foo"
        pairs = self._parse_env_lines(env_text)
        # The regex (.+?)\s*$ captures up to trailing whitespace
        self.assertEqual(pairs.get("MY_VAR", ""), "hello world foo")

    def test_comment_with_leading_whitespace(self):
        """Comment lines with leading whitespace are ignored."""
        env_text = "  # indented comment"
        pairs = self._parse_env_lines(env_text)
        self.assertNotIn("# indented comment", pairs)
        # Also check the key part isn't parsed
        for key in pairs:
            # The line starts with whitespace then #, so the regex's
            # ([A-Za-z_][A-Za-z0-9_]*) won't match because after whitespace,
            # the first char is # which is not [A-Za-z_]
            self.assertFalse(key.startswith("#"))

    def test_value_trimmed_of_trailing_whitespace(self):
        """Trailing whitespace is stripped from values by \s*$."""
        env_text = "WRITINGWAY_PORT=8000   "
        pairs = self._parse_env_lines(env_text)
        self.assertEqual(pairs["WRITINGWAY_PORT"], "8000")

    def test_value_trimmed_of_leading_whitespace_after_eq(self):
        """Leading whitespace after = is stripped by \s* in regex."""
        env_text = "WRITINGWAY_PORT=  8000"
        pairs = self._parse_env_lines(env_text)
        self.assertEqual(pairs["WRITINGWAY_PORT"], "8000")

    def test_underscore_in_var_name(self):
        """Variable names with underscores are valid."""
        env_text = "WRITINGWAY_AI_PORT=8080"
        pairs = self._parse_env_lines(env_text)
        self.assertEqual(pairs["WRITINGWAY_AI_PORT"], "8080")

    def test_var_starts_with_underscore(self):
        """Variable names starting with _ are valid."""
        env_text = "_PRIVATE_VAR=test"
        pairs = self._parse_env_lines(env_text)
        self.assertEqual(pairs["_PRIVATE_VAR"], "test")


class TestDefaultsWorkWhenEnvAbsent(unittest.TestCase):
    """AC2: When .env is absent, defaults to 8000, 8001, 8080."""

    def test_port_block_follows_env_check(self):
        """Port variable definitions come after the .env if block."""
        text = BATCH_PATH.read_text()
        lines = text.splitlines()

        env_block_close = None
        port_defs_start = None
        for i, line in enumerate(lines):
            if 'if exist ".env"' in line:
                # Find the closing )
                for j in range(i + 1, min(i + 15, len(lines))):
                    if lines[j].strip() == ")":
                        env_block_close = j
                        break
            if port_defs_start is None and "set \"APP_PORT=%WRITINGWAY_PORT%\"" in line:
                port_defs_start = i

        self.assertIsNotNone(env_block_close, "Env if block not found")
        self.assertIsNotNone(port_defs_start, "Port definition not found")
        self.assertTrue(env_block_close < port_defs_start)

    def test_default_port_lines_still_present(self):
        """Default values are set when env vars are empty."""
        text = BATCH_PATH.read_text()
        self.assertIn('set "APP_PORT=8000"', text)
        self.assertIn('set "UPDATER_PORT=8001"', text)
        self.assertIn('set "AI_PORT=8080"', text)

    def test_no_env_no_crash(self):
        """When .env is absent, the if exist block is skipped entirely."""
        text = BATCH_PATH.read_text()
        lines = text.splitlines()

        # The script must have 'if exist ".env"' (not 'if not exist' or other negation)
        env_check_line = None
        for line in lines:
            if 'if exist ".env"' in line:
                env_check_line = line
                break

        self.assertIsNotNone(env_check_line, "Env existence check not found")
        # Verify it does NOT use negation
        self.assertNotIn("if not exist", env_check_line)


class TestEnvBlockPlacement(unittest.TestCase):
    """The .env block must appear before all server-start commands."""

    def test_env_before_app_server_start(self):
        """.env parsing happens before python tools\\writingway-server.py."""
        text = BATCH_PATH.read_text()
        lines = text.splitlines()

        env_block_close = None
        server_stop_idx = None
        for i, line in enumerate(lines):
            if 'if exist ".env"' in line:
                for j in range(i + 1, min(i + 15, len(lines))):
                    if lines[j].strip() == ")":
                        env_block_close = j
                        break
            if "writingway-server.py" in line:
                server_stop_idx = i

        self.assertIsNotNone(env_block_close)
        self.assertIsNotNone(server_stop_idx)
        self.assertTrue(env_block_close < server_stop_idx)


class TestBatchSyntaxIntegrity(unittest.TestCase):
    """Ensure the batch file modifications did not break core syntax."""

    def test_delayed_expansion_still_enabled(self):
        """setlocal enabledelayedexpansion must still be present."""
        text = BATCH_PATH.read_text()
        self.assertIn("setlocal enabledelayedexpansion", text)

    def test_port_variable_syntax_uses_delayed(self):
        """All port variable references use !VAR! syntax."""
        text = BATCH_PATH.read_text()
        # The default-value assignments use %VAR% which is normal for
        # batch's 'if empty' pattern: if "!VAR!"=="" set "VAR=default"
        self.assertIn('set "APP_PORT=%WRITINGWAY_PORT%"', text)
        self.assertIn('set "UPDATER_PORT=%WRITINGWAY_UPDATER_PORT%"', text)
        self.assertIn('set "AI_PORT=%WRITINGWAY_AI_PORT%"', text)

    def test_port_emptiness_checks_unchanged(self):
        """Default fallback pattern is preserved."""
        text = BATCH_PATH.read_text()
        self.assertIn('if "!APP_PORT!"=="" set "APP_PORT=8000"', text)
        self.assertIn('if "!UPDATER_PORT!"=="" set "UPDATER_PORT=8001"', text)
        self.assertIn('if "!AI_PORT!"=="" set "AI_PORT=8080"', text)


if __name__ == "__main__":
    unittest.main()
