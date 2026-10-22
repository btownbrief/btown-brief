"""The taste prompts are private (scripts/private_prompts.py): they load from
the Actions secret or the private folder, and a missing one is never empty."""

import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import private_prompts as pp  # noqa: E402


class PrivatePromptTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        clean = {k: v for k, v in os.environ.items() if not k.startswith("PROMPT_")}
        clean["BTOWN_PROMPTS_DIR"] = self.dir
        patcher = mock.patch.dict(os.environ, clean, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def write(self, name, text):
        with open(os.path.join(self.dir, name), "w", encoding="utf-8") as dst:
            dst.write(text)

    def test_env_names(self):
        self.assertEqual(pp.env_name("wire-taste.md"), "PROMPT_WIRE_TASTE")
        self.assertEqual(pp.env_name("weather-read.md"), "PROMPT_WEATHER_READ")

    def test_the_secret_wins_over_the_folder(self):
        self.write("tv-taste.md", "from the folder\n")
        os.environ["PROMPT_TV_TASTE"] = "from the secret"
        text, where = pp.locate("tv-taste.md")
        self.assertEqual(text, "from the secret\n")
        self.assertEqual(where, "$PROMPT_TV_TASTE")

    def test_the_folder_on_the_mac(self):
        self.write("wire-tags.md", "rules\n\n")
        self.assertEqual(pp.load("wire-tags.md"), "rules\n")

    def test_missing_or_empty_raises_never_blank(self):
        with self.assertRaises(pp.PromptMissing):
            pp.load("wire-taste.md")
        os.environ["PROMPT_WIRE_TASTE"] = "   \n"
        self.write("wire-taste.md", "\n")
        with self.assertRaises(pp.PromptMissing):
            pp.load("wire-taste.md")

    def test_check_fails_loudly_and_never_prints_the_text(self):
        self.write("tv-taste.md", "secret taste words\n")
        out = StringIO()
        with redirect_stdout(out):
            self.assertEqual(pp.main(["--check", "tv-taste.md"]), 0)
            self.assertEqual(pp.main(["--check", "weather-read.md"]), 1)
        self.assertNotIn("secret taste words", out.getvalue())
        self.assertIn("::error::", out.getvalue())

    def test_the_wire_and_tv_and_weather_scripts_use_it(self):
        import wire_common as wc
        import curate_tv
        self.write("wire-taste.md", "wire doctrine\n")
        self.write("tv-taste.md", "  tv doctrine  \n")
        self.assertEqual(wc.read_prompt("wire-taste.md"), "wire doctrine\n")
        self.assertEqual(curate_tv.load_taste(), "tv doctrine")
        with self.assertRaises(pp.PromptMissing):
            wc.read_prompt("wire-tags.md")


if __name__ == "__main__":
    unittest.main()
