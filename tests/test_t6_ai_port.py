#!/usr/bin/env python3
"""Tests for T6: dynamic AI port from WritingwayConfig replaces hardcoded localhost:8080."""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_AI = ROOT / "src" / "ai.js"
SRC_GEN = ROOT / "src" / "generation.js"
SRC_AI_SETTINGS = ROOT / "src" / "modules" / "ai-settings.js"

# The expected dynamic port pattern
DYNAMIC_PORT_RE = re.compile(
    r"typeof\s+window\.WritingwayConfig\s*!==\s*'undefined'"
)
FALLBACK_RE = re.compile(r"\?\s*window\.WritingwayConfig\.aiPort\s*:\s*8080")
localhost_8080_RE = re.compile(r"localhost:8080")


class TestNoHardcodedLocalhost8080InAISource(unittest.TestCase):
    """AC: No hardcoded 'http://localhost:8080' remains in the three modified modules."""

    @classmethod
    def setUpClass(cls):
        cls.ai_content = SRC_AI.read_text()
        cls.gen_content = SRC_GEN.read_text()
        cls.ai_settings_content = SRC_AI_SETTINGS.read_text()

    def test_ai_js_no_hardcoded_8080(self):
        """src/ai.js must not contain 'localhost:8080'."""
        self.assertNotIn(
            "localhost:8080",
            self.ai_content,
            "src/ai.js still contains hardcoded localhost:8080",
        )

    def test_generation_js_no_hardcoded_8080(self):
        """src/generation.js must not contain 'localhost:8080'."""
        self.assertNotIn(
            "localhost:8080",
            self.gen_content,
            "src/generation.js still contains hardcoded localhost:8080",
        )

    def test_ai_settings_js_no_hardcoded_8080(self):
        """src/modules/ai-settings.js must not contain 'localhost:8080'."""
        self.assertNotIn(
            "localhost:8080",
            self.ai_settings_content,
            "src/modules/ai-settings.js still contains hardcoded localhost:8080",
        )


class TestDynamicPortPatternPresent(unittest.TestCase):
    """AC: Every modified module uses the typeof window.WritingwayConfig pattern."""

    @classmethod
    def setUpClass(cls):
        cls.ai_content = SRC_AI.read_text()
        cls.gen_content = SRC_GEN.read_text()
        cls.ai_settings_content = SRC_AI_SETTINGS.read_text()

    def test_ai_js_uses_dynamic_port(self):
        """src/ai.js defines defaultAIPort via WritingwayConfig."""
        self.assertIsNotNone(
            DYNAMIC_PORT_RE.search(self.ai_content),
            "src/ai.js does not use the WritingwayConfig pattern",
        )

    def test_generation_js_uses_dynamic_port(self):
        """src/generation.js defines defaultAIPort via WritingwayConfig."""
        self.assertIsNotNone(
            DYNAMIC_PORT_RE.search(self.gen_content),
            "src/generation.js does not use the WritingwayConfig pattern",
        )

    def test_ai_settings_js_uses_dynamic_port(self):
        """src/modules/ai-settings.js defines defaultAIPort via WritingwayConfig."""
        matches = DYNAMIC_PORT_RE.findall(self.ai_settings_content)
        self.assertGreaterEqual(
            len(matches),
            3,
            f"Expected at least 3 WritingwayConfig usages in ai-settings.js, found {len(matches)}",
        )


class TestFallbackTo8080(unittest.TestCase):
    """AC: Graceful fallback to 8080 when WritingwayConfig is unavailable."""

    @classmethod
    def setUpClass(cls):
        cls.ai_content = SRC_AI.read_text()
        cls.gen_content = SRC_GEN.read_text()
        cls.ai_settings_content = SRC_AI_SETTINGS.read_text()

    def test_ai_js_fallback(self):
        """src/ai.js falls back to 8080."""
        self.assertIsNotNone(
            FALLBACK_RE.search(self.ai_content),
            "src/ai.js missing fallback to 8080 in ternary",
        )

    def test_generation_js_fallback(self):
        """src/generation.js falls back to 8080."""
        self.assertIsNotNone(
            FALLBACK_RE.search(self.gen_content),
            "src/generation.js missing fallback to 8080 in ternary",
        )

    def test_ai_settings_js_fallback(self):
        """src/modules/ai-settings.js falls back to 8080."""
        self.assertGreaterEqual(
            len(FALLBACK_RE.findall(self.ai_settings_content)),
            3,
            "src/modules/ai-settings.js should have at least 3 fallback patterns",
        )


class TestLocalStorageEndpointPreserved(unittest.TestCase):
    """AC: localStorage user overrides (app.aiEndpoint) are checked first."""

    @classmethod
    def setUpClass(cls):
        cls.gen_content = SRC_GEN.read_text()
        cls.ai_settings_content = SRC_AI_SETTINGS.read_text()

    def test_generation_js_checks_app_aiEndpoint_first(self):
        """src/generation.js checks app.aiEndpoint before dynamic fallback."""
        # The pattern is: app?.aiEndpoint || 'http://localhost:' + defaultAIPort
        # So app.aiEndpoint must be checked first
        match = re.search(
            r"app\?\.aiEndpoint\s*\|\|\s*'http://localhost:'",
            self.gen_content,
        )
        self.assertIsNotNone(
            match,
            "src/generation.js should check app.aiEndpoint before default fallback",
        )

    def test_ai_js_checks_app_aiEndpoint_first(self):
        """src/ai.js checks app.aiEndpoint before dynamic fallback."""
        match = re.search(
            r"app\.aiEndpoint\s*\|\|\s*'http://localhost:'",
            SRC_AI.read_text(),
        )
        self.assertIsNotNone(
            match,
            "src/ai.js should check app.aiEndpoint before default fallback",
        )


class TestConfigModuleIntegration(unittest.TestCase):
    """AC: config.js provides WritingwayConfig with aiPort."""

    @classmethod
    def setUpClass(cls):
        cls.config_content = (ROOT / "src" / "config.js").read_text()

    def test_config_has_aiport(self):
        """config.js sets aiPort default."""
        self.assertIn("aiPort: 8080", self.config_content)

    def test_config_fetches_writingway_json(self):
        """config.js fetches /writingway.json."""
        self.assertIn("/writingway.json", self.config_content)

    def test_config_aiPort_override(self):
        """config.js reads aiPort from /writingway.json."""
        self.assertIn("data.aiPort", self.config_content)


if __name__ == "__main__":
    unittest.main()
