"""build_games.py: first_seen and live_since from a games.json history, the
rooms flag, the fields kept, odd slugs dropped, and the fail-soft posture. Builds a tiny
arcade repo in a temp folder; nothing touches the network.

Run: python3 -m unittest tests/test_build_games.py
"""

import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import build_games as bg  # noqa: E402

SECTIONS = [{"id": "arcade-action", "title": "Action & Arcade", "description": "Quick reflexes."}]


def game(slug, live=True, **kw):
    return {"slug": slug, "name": slug.title(), "emoji": "x", "pitch": "Play " + slug, "section": "arcade-action",
            "live": live, "leaderboard": True, **kw}


def commit(repo, games, when):
    (repo / "games.json").write_text(json.dumps({"sections": SECTIONS, "games": games, "modes": []}))
    env = {**os.environ, "GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when,
           "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
    subprocess.run(["git", "-C", str(repo), "add", "games.json"], check=True, env=env)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "c"], check=True, env=env)


class BuildGames(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = pathlib.Path(self.tmp.name) / "arcade"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", "-b", "main", str(self.repo)], check=True)
        # a late-evening commit in Burlington is still that day, not tomorrow's UTC date
        commit(self.repo, [game("old-one"), game("soon", live=False)], "2026-07-07T23:30:00-04:00")
        commit(self.repo, [game("old-one"), game("soon", live=False), game("Bad Slug")], "2026-09-01T10:00:00-04:00")
        commit(self.repo, [game("old-one"), game("soon"), game("fresh", boardHint="Most points", extra="dropped")],
               "2026-10-10T09:00:00-04:00")

    def tearDown(self):
        self.tmp.cleanup()

    def test_dates_and_fields(self):
        cat = bg.build(self.repo, "main", {"fresh", "soon", "gone"})
        by = {g["slug"]: g for g in cat["games"]}
        self.assertEqual(list(by), ["old-one", "soon", "fresh"])
        self.assertEqual(by["old-one"]["first_seen"], "2026-07-07")
        self.assertEqual(by["soon"]["first_seen"], "2026-07-07")
        self.assertEqual(by["soon"]["live_since"], "2026-10-10")
        self.assertEqual(by["fresh"]["first_seen"], "2026-10-10")
        self.assertEqual(by["fresh"]["boardHint"], "Most points")
        self.assertNotIn("extra", by["fresh"])
        self.assertEqual([s for s, g in by.items() if g["rooms"]], ["soon", "fresh"])
        self.assertEqual(cat["sections"], SECTIONS)
        self.assertTrue(cat["source"].startswith("btownbrief/btownbrief.github.io@"))

    def test_keeps_the_last_file_when_the_arcade_is_unreachable(self):
        out = pathlib.Path(self.tmp.name) / "games-catalog.json"
        out.write_text('{"keep": true}\n')
        argv = sys.argv
        sys.argv = ["build_games.py", "--arcade", str(pathlib.Path(self.tmp.name) / "missing"), "--out", str(out), "--offline"]
        try:
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.assertEqual(bg.main(), 0)
            self.assertIn("keeping the last catalog", buf.getvalue())
            self.assertEqual(out.read_text(), '{"keep": true}\n')
            sys.argv.append("--strict")
            self.assertEqual(bg.main(), 1)
        finally:
            sys.argv = argv

    def test_refuses_a_thin_read(self):
        out = pathlib.Path(self.tmp.name) / "games-catalog.json"
        argv = sys.argv
        sys.argv = ["build_games.py", "--arcade", str(self.repo), "--out", str(out), "--offline"]
        try:
            with redirect_stdout(io.StringIO()):
                self.assertEqual(bg.main(), 0)
            self.assertFalse(out.exists(), "three live games is below the floor; nothing is written")
        finally:
            sys.argv = argv


if __name__ == "__main__":
    unittest.main()
