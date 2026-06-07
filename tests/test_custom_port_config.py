#!/usr/bin/env python3
"""Tests for .env.example creation and README.md Custom Port Configuration section."""

import os
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class TestEnvExampleExists(unittest.TestCase):
    """AC1: .env.example exists in the project root."""

    def test_env_example_file_exists(self):
        """The .env.example file must exist at project root."""
        f = ROOT / ".env.example"
        self.assertTrue(f.exists(), ".env.example not found in project root")
        self.assertTrue(f.is_file(), ".env.example is not a regular file")


class TestEnvExampleContent(unittest.TestCase):
    """AC1: .env.example contains three variable assignments with default values."""

    @classmethod
    def setUpClass(cls):
        cls.content = (ROOT / ".env.example").read_text()
        # Collect non-comment, non-blank lines (actual assignments)
        cls.assignments = [
            line.strip()
            for line in cls.content.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]

    def test_three_assignments(self):
        """There are exactly three variable assignment lines."""
        self.assertEqual(
            len(self.assignments),
            3,
            f"Expected 3 assignments, found {len(self.assignments)}: {self.assignments}",
        )

    def test_writingway_port(self):
        """WRITINGWAY_PORT = 8000 is present."""
        self.assertIn("WRITINGWAY_PORT=8000", "\n".join(self.assignments))

    def test_writingway_updater_port(self):
        """WRITINGWAY_UPDATER_PORT = 8001 is present."""
        self.assertIn("WRITINGWAY_UPDATER_PORT=8001", "\n".join(self.assignments))

    def test_writingway_ai_port(self):
        """WRITINGWAY_AI_PORT = 8080 is present."""
        self.assertIn("WRITINGWAY_AI_PORT=8080", "\n".join(self.assignments))

    def test_no_json_format(self):
        """Must not use JSON format (no curly braces, no key-value objects)."""
        self.assertNotIn("{", self.content, ".env.example uses JSON format instead of plain assignments")
        self.assertNotIn("}", self.content, ".env.example uses JSON format instead of plain assignments")


class TestReadmeCustomPortSection(unittest.TestCase):
    """AC2: README.md has a 'Custom Port Configuration' section with required content."""

    @classmethod
    def setUpClass(cls):
        cls.content = (ROOT / "README.md").read_text()

    def test_section_heading_exists(self):
        """README contains '## Custom Port Configuration' heading."""
        self.assertIn("## Custom Port Configuration", self.content)

    def test_table_present(self):
        """A markdown table with Variable, Default, Service columns is present."""
        self.assertIn("| Variable | Default | Service |", self.content)
        self.assertIn("|---|---|---|", self.content)

    def test_table_variable_rows(self):
        """All three variable rows appear in the table."""
        self.assertIn("| `WRITINGWAY_PORT` | `8000` | App server (web UI) |", self.content)
        self.assertIn("| `WRITINGWAY_UPDATER_PORT` | `8001` | Update checker service |", self.content)
        self.assertIn("| `WRITINGWAY_AI_PORT` | `8080` | llama.cpp AI server |", self.content)

    def test_dotenv_usage_example(self):
        """The section contains a .env usage example (cp .env.example .env)."""
        self.assertIn("cp .env.example .env", self.content)

    def test_shell_export_examples(self):
        """The section contains export examples."""
        self.assertIn("export WRITINGWAY_PORT=9000", self.content)
        self.assertIn("export WRITINGWAY_UPDATER_PORT=9001", self.content)
        self.assertIn("export WRITINGWAY_AI_PORT=9080", self.content)

    def test_section_is_between_launchers_and_saving(self):
        """Custom Port Configuration is placed between 'Launchers and local services' and 'Saving and backups'."""
        launchers_pos = self.content.index("## Launchers and local services")
        custom_pos = self.content.index("## Custom Port Configuration")
        saving_pos = self.content.index("## Saving and backups")

        self.assertLess(
            launchers_pos,
            custom_pos,
            "Custom Port Configuration must come after 'Launchers and local services'",
        )
        self.assertLess(
            custom_pos,
            saving_pos,
            "Custom Port Configuration must come before 'Saving and backups'",
        )


class TestReadmeNoContentRemoved(unittest.TestCase):
    """AC3: No existing README content was removed or altered except the new section insertion."""

    @classmethod
    def setUpClass(cls):
        cls.content = (ROOT / "README.md").read_text()

    def _content(self):
        return type(self).content

    def test_section_headers_preserved(self):
        """All original section headers are still present."""
        expected_headers = [
            "## What Writingway does",
            "## Highlights",
            "## Requirements",
            "## Quick start",
            "## First-run local AI flow",
            "## AI modes",
            "## Launchers and local services",
            "## Saving and backups",
            "## Updates",
            "## Writingway 1 import",
            "## Project structure",
            "## Development notes",
            "## Current status",
            "## Troubleshooting",
        ]
        for header in expected_headers:
            self.assertIn(
                header,
                self._content(),
                f"Section header '{header}' was removed or altered",
            )

    def test_launcher_service_lines_unchanged(self):
        """The specific launcher service description lines are intact."""
        c = self._content()
        self.assertIn("- Start the Writingway app server on `http://127.0.0.1:8000`", c)
        self.assertIn("- Start the updater service on `http://127.0.0.1:8001`", c)
        self.assertIn("- Start llama.cpp on `http://127.0.0.1:8080` when local GGUF mode is available", c)
        self.assertIn("Use the launcher scripts instead of opening `main.html` directly.", c)

    def test_saving_and_backups_content_unchanged(self):
        """The Saving and backups section content is intact."""
        c = self._content()
        self.assertIn("### Manual project save", c)
        self.assertIn("### Local versioning backup", c)
        self.assertIn("### GitHub Gist backup", c)
        self.assertIn("project-backups/", c)

    def test_troubleshooting_unchanged(self):
        """Troubleshooting section is intact."""
        c = self._content()
        self.assertIn("### The browser says it cannot connect on startup", c)
        self.assertIn("The launchers wait for the local app server before opening the browser.", c)


if __name__ == "__main__":
    unittest.main()
