"""build_wire_audio.py: the script writer on a real (trimmed) wire-today.json,
its fact and copy checks, the fail-soft posture and the rolling archive. The
model and the voice are always stubs; nothing touches the network.

Run: python3 -m unittest discover -s tests -p 'test_wire*.py'
"""

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import build_wire_audio as wa  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "wire", "audio-wire-today.json")
ENGINE = {"provider": "anthropic", "model": "claude-opus-5-5"}
NOW = datetime(2026, 10, 16, 11, 2, tzinfo=timezone.utc)   # 7:02 am Eastern


def wire():
    with open(FIXTURE, encoding="utf-8") as src:
        return json.load(src)


# A body a newsreader might write from the fixture's twelve local headlines:
# every fact is in a headline (never in a reason), nothing is copied eight
# words in a row, nothing is padding.
GOOD = [
    "Vermont State Police have an update on their investigation into the police shooting in Williston, Vermont Biz reports.",
    "In the race for governor, Seven Days reports that Janoo again leads Governor Scott in fundraising, as the campaign hits the home stretch.",
    "One month in, WCAX says, Vermont's diverging diamond traffic pattern is getting positive reviews.",
    "DandyLion is expanding into furniture, according to Vermont Biz.",
    "Essex police are warning Vermonters about a possible scam in which someone impersonates law enforcement, WCAX reports.",
    "Vermont Biz has the Agency of Transportation's weekly road construction report, covering the week of October 19.",
    "The Center for Research on Vermont is hosting a panel on the history of the revolutionary war, the Vermont Cynic reports.",
    "Vox looks at how Vermont once dreamed of universal healthcare, and at a Democrat who wants to try again, with a twist.",
    "Vermont Biz reports a new investment of 4.95 million dollars to strengthen suicide care across Vermont.",
    "UVM men's basketball hosts Holy Cross in an exhibition game on Saturday afternoon.",
    "Vermont Public has a story on horse logging, a Vermont tradition two hundred years old that still has a future.",
    "And The Frequency looks at the removal of a historic dam.",
]
# The first Opus clip's line, carried in from pick 7's reason ("A free UVM
# evening on Vermont's Revolutionary history"); its headline never says free.
FREE = "The Vermont Cynic reports that it is a free evening, and there is no cost to attend."


def fake_answers(*answers, checks=()):
    """An ask_json stand-in. The writer's calls get `answers` in turn and are
    recorded in `calls`; the fact check's get `checks` in turn (default:
    nothing unsupported) and are recorded in `ask.checked`."""
    calls, checked = [], []

    def ask(engine, system, user, schema, max_tokens, log_prefix):
        if "unsupported" in schema["properties"]:
            checked.append(SimpleNamespace(system=system, user=user, max_tokens=max_tokens))
            got = checks[len(checked) - 1] if len(checked) <= len(checks) else {"unsupported": []}
            if isinstance(got, Exception):
                raise got
            return got, {"in": 800, "out": 200, "calls": 1}
        calls.append(SimpleNamespace(system=system, user=user, max_tokens=max_tokens))
        return answers[min(len(calls), len(answers)) - 1], {"in": 1000, "out": 600, "calls": 1}
    ask.checked = checked
    return ask, calls


class Stories(unittest.TestCase):
    def test_local_picks_in_rank_order_never_national_or_own(self):
        stories = wa.local_stories(wire())
        self.assertEqual(len(stories), 12)
        titles = [s["title"] for s in stories]
        self.assertTrue(titles[0].startswith("VSP provides update"))
        self.assertTrue(all(s["why"] for s in stories))
        national = [p["title"] for p in wire()["picks"] if not p["local"]]
        self.assertFalse(set(national) & set(titles))

    def test_the_brief_itself_is_never_a_story(self):
        payload = wire()
        payload["picks"][0]["own"] = True
        self.assertNotIn(payload["picks"][0]["id"], [s["id"] for s in wa.local_stories(payload)])

    def test_thin_today_falls_back_to_yesterdays_frozen_edition(self):
        today = wire()
        frozen = dict(wire(), date="2026-10-15", final=True)
        self.assertEqual(wa.choose_edition(today, "2026-10-16", lambda d: None)[1], "today")
        today["picks"] = today["picks"][:2]
        today["updates"] = []
        asked = []
        got, which = wa.choose_edition(today, "2026-10-16", lambda d: asked.append(d) or frozen)
        self.assertEqual((got["date"], which, asked), ("2026-10-15", "yesterday", ["2026-10-15"]))
        self.assertIsNone(wa.choose_edition(today, "2026-10-16", lambda d: today)[0])

    def test_the_prompt_numbers_every_story_with_outlet_and_reason(self):
        system, user = wa.prompt_for(wa.local_stories(wire()), "today")
        self.assertIn("1. Headline: VSP provides update on investigation into Williston police shooting || Outlet: Vermont Biz || "
                      "Editor's note, not a source: ", user)
        self.assertIn("12. ", user)
        self.assertNotIn("13. ", user)
        self.assertNotIn("{lo}", system)
        self.assertIn("is your only source\n  of facts", system)
        self.assertIn("Never\n  pad", system)


class Writer(unittest.TestCase):
    def setUp(self):
        self.stories = wa.local_stories(wire())

    def test_a_clean_body_becomes_the_script_in_one_call(self):
        ask, calls = fake_answers({"paragraphs": GOOD, "teaser": "The Williston case, the governor's race money, and a scam warning."})
        script, teaser, usage, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertEqual(len(calls), 1, notes)
        self.assertTrue(script.startswith("Good morning. It's Friday, October 16, and this is the Btown Brief, out loud"))
        self.assertIn("read by an AI voice", script)
        self.assertTrue(wa.SHORT_OK <= wa.word_count(script) <= wa.WORDS_MAX, wa.word_count(script))
        self.assertEqual(teaser, "The Williston case, the governor's race money, and a scam warning.")
        self.assertEqual(usage["calls"], 2)          # the draft and its fact check
        self.assertIn("The script:\nVermont State Police have an update", ask.checked[0].user)
        self.assertIn("1. VSP provides update", ask.checked[0].user)
        self.assertNotIn("A free UVM evening", ask.checked[0].user)     # the check never sees the reasons
        self.assertNotIn("\n\n\n", script)
        # Opus gets room for the whole draft and its check: 8,000 cut it off
        self.assertEqual((calls[0].max_tokens, ask.checked[0].max_tokens), (16000, 16000))

    def test_an_invented_fact_gets_one_rewrite_naming_it(self):
        bad = ["The panel is free and starts Tuesday at the Fleming Museum."] + GOOD
        ask, calls = fake_answers({"paragraphs": bad, "teaser": "x"}, {"paragraphs": GOOD, "teaser": "A scam warning."})
        script, _, usage, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertEqual(len(calls), 2)
        for word in ('"free"', '"Tuesday"', '"Fleming"', '"Museum"'):    # "free" only in pick 7's reason
            self.assertIn(word, calls[1].user)
        self.assertIn("Your draft:", calls[1].user)
        self.assertIsNotNone(script)
        self.assertNotIn("Fleming", script)
        self.assertEqual((usage["calls"], len(ask.checked)), (3, 1))   # no fact check on a draft that already invents

    def test_still_inventing_after_the_rewrites_means_no_clip(self):
        bad = ["Mayor Emma Mulvaney-Stanak will speak at 6 pm."] + GOOD
        ask, calls = fake_answers({"paragraphs": bad, "teaser": "x"})
        script, teaser, _, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertIsNone(script)
        self.assertEqual(len(calls), wa.DRAFTS)
        self.assertTrue(any("no clip today" in n for n in notes))

    def test_a_rewrite_that_invents_loses_to_an_honest_short_draft(self):
        short = GOOD[:10]                      # 237 words: under SHORT_OK, inside the soft range
        liar = ["Lieutenant Jane Doe briefed reporters."] + GOOD
        ask, calls = fake_answers({"paragraphs": short, "teaser": "x"}, {"paragraphs": liar, "teaser": "x"})
        script, _, _, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertEqual(len(calls), 3)
        self.assertIsNotNone(script)
        self.assertNotIn("Lieutenant", script)
        self.assertTrue(any("soft problem" in n for n in notes), notes)

    def test_the_fact_check_sends_back_what_the_word_checks_miss(self):
        claim = "It is a reminder that the choices on the ballot are being watched far past our borders."
        draft = GOOD + [claim]
        ask, calls = fake_answers({"paragraphs": draft, "teaser": "x"}, {"paragraphs": GOOD, "teaser": "x"},
                                  checks=({"unsupported": [{"sentence": claim, "problem": "opinion stated as fact"}]},))
        script, _, _, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertEqual((len(calls), len(ask.checked)), (2, 2))
        self.assertIn("opinion stated as fact", calls[1].user)
        self.assertIn(claim, calls[1].user)
        self.assertNotIn("ballot", script)

    def test_a_sentence_the_check_flags_on_every_draft_is_cut(self):
        claim = "It is a reminder that the choices on the ballot are being watched far past our borders."
        draft = GOOD + [claim]
        flag = {"unsupported": [{"sentence": claim, "problem": "opinion stated as fact"}]}
        ask, calls = fake_answers({"paragraphs": draft, "teaser": "x"}, checks=(flag,) * wa.DRAFTS)
        script, _, _, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertEqual(len(calls), wa.DRAFTS)
        self.assertIsNotNone(script, notes)
        self.assertNotIn("ballot", script)
        self.assertIn("Vox looks at how", script)
        self.assertTrue(any("cut 1 sentence" in n for n in notes), notes)

    def test_a_cut_never_leaves_a_turn_introducing_nothing(self):
        # the first end-to-end run in Actions: the DandyLion sentence was cut and
        # "Some business news now." was left standing on its own
        dandy = "DandyLion is branching out, and it is adding furniture to what it sells."
        draft = GOOD[:3] + ["Some business news now. " + dandy] + GOOD[4:]
        flag = {"unsupported": [{"sentence": dandy, "problem": "implies selling"}]}
        ask, _ = fake_answers({"paragraphs": draft, "teaser": "x"}, checks=(flag,) * wa.DRAFTS)
        script, *_ = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertIsNotNone(script)
        self.assertNotIn("Some business news now", script)
        self.assertNotIn("DandyLion", script)
        self.assertIn("And The Frequency looks at the removal of a historic dam.", script)   # a short story stays
        self.assertEqual(wa.cut_sentences(["And The Frequency looks at a dam."], []), ["And The Frequency looks at a dam."])

    def test_a_gendered_pronoun_no_source_gives_is_invented(self):
        she = ["Janoo again leads Governor Scott in fundraising, and she has the money."] + GOOD[2:]
        p = wa.problems_of(she, "", self.stories, "2026-10-16", "today")
        self.assertIn("she", p["invented"])

    def test_a_fact_check_that_does_not_run_means_no_clip(self):
        ask, _ = fake_answers({"paragraphs": GOOD, "teaser": "x"}, checks=(wa.wc.ModelError("down"),) * wa.DRAFTS)
        script, _, _, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertIsNone(script)
        self.assertTrue(any("did not run" in n for n in notes), notes)

    def test_a_quote_that_is_not_in_the_script_does_not_count(self):
        ask, calls = fake_answers({"paragraphs": GOOD, "teaser": "x"},
                                  checks=({"unsupported": [{"sentence": "A sentence nobody wrote.", "problem": "x"}]},))
        script, *_ = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertIsNotNone(script)
        self.assertEqual(len(calls), 1)

    def test_a_headline_read_out_is_sent_back(self):
        verbatim = ["One month in, Vermont’s diverging diamond traffic pattern receives positive reviews."] + GOOD[3:]
        ask, calls = fake_answers({"paragraphs": verbatim, "teaser": "x"}, {"paragraphs": GOOD, "teaser": "x"})
        wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertEqual(len(calls), 2)
        self.assertIn("word for word", calls[1].user)

    def test_too_short_is_sent_back_and_a_list_never_ships(self):
        ask, calls = fake_answers({"paragraphs": GOOD[:2], "teaser": "x"}, {"paragraphs": GOOD, "teaser": "x"})
        script, *_ = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertIn("add no fact and no filler", calls[1].user)
        self.assertIsNotNone(script)
        p = wa.problems_of(["1. The Williston case.", "2. The race for governor."], "", self.stories, "2026-10-16", "today")
        self.assertTrue(p["list"])

    def test_a_teaser_that_invents_is_dropped_not_the_clip(self):
        ask, _ = fake_answers({"paragraphs": GOOD, "teaser": "A free concert Saturday and the Williston case."})
        script, teaser, _, _ = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertIsNotNone(script)
        self.assertEqual(teaser, "")

    def test_a_fact_only_a_reason_gives_never_reaches_the_script(self):
        srcs = wa.sources_of(self.stories)
        self.assertIn("free", wa.made_up(FREE, srcs))
        self.assertNotIn("Chittenden", " ".join(srcs))                 # pick 1's reason, not its headline
        ask, calls = fake_answers({"paragraphs": GOOD[:6] + [FREE] + GOOD[6:], "teaser": "A free history panel."},
                                  {"paragraphs": GOOD, "teaser": "A new interchange and a scam warning."})
        script, teaser, _, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertIn('"free"', calls[1].user)
        self.assertNotIn("free", script)
        self.assertNotIn("no cost", script)
        always = fake_answers({"paragraphs": GOOD[:6] + [FREE] + GOOD[6:], "teaser": "x"})[0]
        script, *_ = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=always)
        self.assertIsNone(script)

    def test_padding_the_check_quotes_is_cut(self):
        pad_line = "The plan comes with a twist of some kind, and it remains to be seen how it plays out."
        flag = {"unsupported": [{"sentence": pad_line, "problem": "padding"}]}
        ask, calls = fake_answers({"paragraphs": GOOD[:8] + [pad_line] + GOOD[8:], "teaser": "x"}, checks=(flag,) * wa.DRAFTS)
        script, *_ = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertIsNotNone(script)
        self.assertNotIn("some kind", script)
        self.assertIn("with a twist", script)

    def test_a_spelled_out_acronym_is_given_but_a_first_name_is_not(self):
        srcs = wa.sources_of(self.stories)      # pick 1 says "VSP", pick 2 "Gov. Scott"
        self.assertEqual(wa.made_up("The Vermont State Police have an update on the Williston case.", srcs), [])
        self.assertEqual(wa.made_up("Janoo again leads Governor Phil Scott.", srcs), ["Phil"])

    def test_the_fixed_parts_and_the_voice_text(self):
        self.assertIn("yesterday", wa.intro("2026-10-16", "yesterday"))
        self.assertEqual(wa.for_voice("Charlotte, Calais and Vergennes"), "Shar-LOT, CAL-iss and ver-JENZ")
        self.assertEqual(wa.tidy([" A  &  B was 5% ", ""]), ["A and B was 5 percent"])


class Run(unittest.TestCase):
    def args(self, out_dir, **kw):
        base = dict(out_dir=out_dir, wire_file=FIXTURE, edition_file=None, date="2026-10-16", script_only=False, audio_from=None,
                    dry_run=False, force=False)
        base.update(kw)
        return SimpleNamespace(**base)

    def test_no_elevenlabs_key_writes_nothing_and_exits_zero(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {}, clear=True), \
                mock.patch.object(wa, "load_secrets"), mock.patch.object(wa, "write_script") as writer:
            out = io.StringIO()
            with redirect_stdout(out):
                code = wa.run(self.args(tmp))
            self.assertEqual(code, 0)
            self.assertEqual(os.listdir(tmp), [])
            writer.assert_not_called()
            self.assertIn("no ELEVENLABS_API_KEY", out.getvalue())

    def test_opus_only_no_cheaper_writer(self):
        env = {"ELEVENLABS_API_KEY": "k", "OPENROUTER_API_KEY": "o"}
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(wa, "load_secrets"), mock.patch.object(wa.wc, "ask_json") as ask, \
                mock.patch.object(wa, "tts") as voice:
            with redirect_stdout(io.StringIO()) as out:
                wa.run(self.args(tmp))
            ask.assert_not_called()
            voice.assert_not_called()
            self.assertIn("no ANTHROPIC_API_KEY", out.getvalue())
            self.assertEqual(wa.WRITER["model"], "claude-opus-5-5")

    def test_a_full_run_publishes_the_clip_its_script_and_the_index(self):
        ask, _ = fake_answers({"paragraphs": GOOD, "teaser": "The Williston case and a scam warning."})
        env = {"ELEVENLABS_API_KEY": "k", "ANTHROPIC_API_KEY": "a"}
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(wa, "load_secrets"), mock.patch.object(wa.wc, "utcnow", return_value=NOW), \
                mock.patch.object(wa.wc, "ask_json", ask), \
                mock.patch.object(wa, "tts", return_value=(b"ID3fake", {"character-cost": "310"})) as voice, \
                mock.patch.object(wa, "normalize", return_value=(b"ID3normal", 201.4)):
            with redirect_stdout(io.StringIO()):
                self.assertEqual(wa.run(self.args(tmp)), 0)
            self.assertEqual(sorted(os.listdir(tmp)), ["2026-10-16.mp3", "2026-10-16.txt", "cost.json", "index.json"])
            sent = voice.call_args[0]
            self.assertEqual((sent[1], sent[3]), (wa.DEFAULT_VOICE, "eleven_v4_turbo"))
            with open(os.path.join(tmp, "index.json"), encoding="utf-8") as f:
                clip = json.load(f)["clips"][0]
            self.assertEqual((clip["date"], clip["file"], clip["script"], clip["duration"], clip["bytes"]),
                             ("2026-10-16", "2026-10-16.mp3", "2026-10-16.txt", 201.4, 9))
            self.assertEqual((clip["from"], clip["stories"], clip["edition"]), ("today", 12, "2026-10-16"))
            with open(os.path.join(tmp, "cost.json"), encoding="utf-8") as f:
                cost = json.load(f)
            chars = len(sent[2])
            self.assertEqual((cost["tts_chars"], cost["runs"][-1]["tts_credits"]), (chars, 310))
            self.assertAlmostEqual(cost["tts_usd"], chars / 1000 * 0.04, places=5)
            with redirect_stdout(io.StringIO()) as out:
                self.assertEqual(wa.run(self.args(tmp)), 0)
            self.assertIn("already up", out.getvalue())
            self.assertEqual(voice.call_count, 1)

    def test_the_two_stages_apart_write_then_voice(self):
        ask, _ = fake_answers({"paragraphs": GOOD, "teaser": "The Williston case and a scam warning."})
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(wa, "load_secrets"), \
                mock.patch.object(wa.wc, "utcnow", return_value=NOW), mock.patch.object(wa.wc, "ask_json", ask), \
                mock.patch.object(wa, "normalize", return_value=(b"ID3normal", 201.4)), \
                mock.patch.object(wa, "tts", return_value=(b"ID3fake", {"character-cost": "300"})) as voice:
            with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "a"}, clear=True), redirect_stdout(io.StringIO()):
                self.assertEqual(wa.run(self.args(tmp, script_only=True)), 0)     # in Actions: Opus, no voice key
            self.assertEqual(sorted(os.listdir(tmp)), ["2026-10-16.txt", "cost.json", "pending.json"])
            voice.assert_not_called()
            with mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": "k"}, clear=True), redirect_stdout(io.StringIO()):
                self.assertEqual(wa.run(self.args(tmp, audio_from=os.path.join(tmp, "2026-10-16.txt"), wire_file=None)), 0)
            self.assertEqual(sorted(os.listdir(tmp)), ["2026-10-16.mp3", "2026-10-16.txt", "cost.json", "index.json"])
            with open(os.path.join(tmp, "index.json"), encoding="utf-8") as f:
                clip = json.load(f)["clips"][0]
            self.assertEqual((clip["writer"], clip["teaser"], clip["stories"]), ("claude-opus-5-5", "The Williston case and a scam warning.", 12))

    def test_a_dead_voice_fails_the_run_only_once_the_clips_are_stale(self):
        ask, _ = fake_answers({"paragraphs": GOOD, "teaser": "x"})
        env = {"ELEVENLABS_API_KEY": "k", "ANTHROPIC_API_KEY": "a"}
        boom = mock.Mock(side_effect=OSError("down"))
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(wa, "load_secrets"), mock.patch.object(wa.wc, "utcnow", return_value=NOW), \
                mock.patch.object(wa.wc, "ask_json", ask), mock.patch.object(wa, "tts", boom):
            wa.wc.write_json(os.path.join(tmp, "index.json"), {"v": 1, "clips": [{"date": "2026-10-15", "file": "2026-10-15.mp3", "script": "2026-10-15.txt"}]})
            with redirect_stdout(io.StringIO()):
                self.assertEqual(wa.run(self.args(tmp)), 0)
            wa.wc.write_json(os.path.join(tmp, "index.json"), {"v": 1, "clips": [{"date": "2026-10-01", "file": "2026-10-01.mp3", "script": "2026-10-01.txt"}]})
            with redirect_stdout(io.StringIO()):
                self.assertEqual(wa.run(self.args(tmp)), 1)
            self.assertFalse(os.path.exists(os.path.join(tmp, "2026-10-16.mp3")))

    def test_selftest(self):
        with redirect_stdout(io.StringIO()):
            wa.selftest()


if __name__ == "__main__":
    unittest.main()
