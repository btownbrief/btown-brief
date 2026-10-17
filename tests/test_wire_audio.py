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
# words in a row, nothing is padding, no outlet is named (the Brief is the
# station: Stephen, 2026-10-17), and every sentence starts with its subject.
GOOD = [
    "Vermont State Police have an update this morning. It's on their investigation into the police shooting in Williston.",
    "The race for governor is in its home stretch. Janoo again leads Governor Scott in fundraising.",
    "Vermont's diverging diamond traffic pattern has been open for a month now. The reviews so far are positive.",
    "DandyLion is growing. The business is expanding into furniture.",
    "Essex police have a warning out for Vermonters. There's a possible scam. Someone is impersonating law enforcement.",
    "The Agency of Transportation has its weekly road construction report out. It covers the week of October 19.",
    "The Center for Research on Vermont is putting on a panel. The subject is the history of the revolutionary war.",
    "Vermont once had a dream of universal healthcare. Now one Democrat wants to give it another try, with a twist.",
    "There's a new investment of 4.95 million dollars in suicide care. It's meant to strengthen that care across Vermont.",
    "UVM men's basketball hosts Holy Cross on Saturday afternoon. It's an exhibition game.",
    "Horse logging is a Vermont tradition that's two hundred years old. It still has a future.",
    "And one more. A historic dam is coming out.",
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
        self.assertIn("1. Headline: VSP provides update on investigation into Williston police shooting || Outlet, never said aloud: Vermont Biz || "
                      "Editor's note, not a source: ", user)
        self.assertIn("12. ", user)
        self.assertNotIn("13. ", user)
        self.assertNotIn("{lo}", system)
        self.assertIn("is your only source\n  of facts", system)
        self.assertIn("Never\n  pad", system)
        # the voice: a person, not a bulletin, with a worked example and the marks it may use
        for asked in ("neighbour", "Contractions", "No two stories start the same way", "NOT today's",
                      "Written jumbled", "Subject first", "One idea per sentence", "You are the station", "[long pause]", "[softly]", "Never an emotion", "is put before every one for\n  you"):
            self.assertIn(asked, system)
        self.assertNotIn("synthetic", system.lower())
        self.assertNotRegex(system, r"\bAI\b")


class Writer(unittest.TestCase):
    def setUp(self):
        self.stories = wa.local_stories(wire())

    def test_a_clean_body_becomes_the_script_in_one_call(self):
        ask, calls = fake_answers({"paragraphs": GOOD, "teaser": "The Williston case, the governor's race money, and a scam warning."})
        script, teaser, usage, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertEqual(len(calls), 1, notes)
        self.assertTrue(script.startswith("Morning. It's Friday, October 16th, and this is the Btown Brief. "
                                          "Here's what's going on around Burlington.\n\n"), script[:200])
        self.assertTrue(script.endswith("Have a good one.\n"), script[-200:])
        for never in ("AI", "synthetic", "artificial"):     # readers are never told how it is made
            self.assertNotRegex(script, r"(?i)\b" + never + r"\b")
        self.assertTrue(wa.SHORT_OK <= wa.word_count(script) <= wa.WORDS_MAX, wa.word_count(script))
        self.assertEqual(teaser, "The Williston case, the governor's race money, and a scam warning.")
        self.assertEqual(usage["calls"], 2)          # the draft and its fact check
        self.assertIn("The script:\nVermont State Police have an update", ask.checked[0].user)
        self.assertNotRegex(script, wa.OUTLET_RE)
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
        short = GOOD[:10]                      # 209 words: under SHORT_OK, inside the soft range
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
        self.assertIn("Now one Democrat wants to give it another try", script)
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
        self.assertIn("And one more. A historic dam is coming out.", script)   # a short story stays
        self.assertEqual(wa.cut_sentences(["And a historic dam is coming out."], []), ["And a historic dam is coming out."])

    def test_naming_an_outlet_is_sent_back_and_never_ships(self):
        # Stephen, 2026-10-17: "'VTDigger reported that' at the end of the sentence just
        # doesn't hit... why do I need to quote them? I'm my own news station"
        named = GOOD[:4] + ["Essex police are warning about a possible scam, WCAX reports."] + GOOD[5:]
        ask, calls = fake_answers({"paragraphs": named, "teaser": "x"}, {"paragraphs": GOOD, "teaser": "x"})
        script, _, _, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertEqual(len(calls), 2)
        self.assertIn('never names an outlet', calls[1].user)
        self.assertIn('"WCAX"', calls[1].user)
        self.assertEqual(len(ask.checked), 1)          # the draft that named one never reached the fact check
        self.assertNotIn("WCAX", script)
        always = fake_answers({"paragraphs": named, "teaser": "x"})[0]
        script, _, _, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=always)
        self.assertIsNone(script)
        self.assertTrue(any("no clip today" in n for n in notes), notes)

    def test_every_newsroom_counts_but_not_a_word_that_only_looks_like_one(self):
        named = wa.outlets_named("Seven Days has it. VT Digger too. NBC5 and Vermont Public as well. "
                                 "The Burlington Free Press, The Other Paper and the Vermont Cynic.", self.stories)
        self.assertEqual(named, ["Seven Days", "VT Digger", "NBC5", "Vermont Public", "Burlington Free Press",
                                 "The Other Paper", "Vermont Cynic"])
        self.assertEqual(wa.outlets_named("The ban lasts seven days. The Vermont Public Utility Commission met. "
                                          "Vermont State Police and UVM have news.", self.stories), [])
        about = [{"title": "Seven Days wins a national award", "text": ""}]
        self.assertEqual(wa.outlets_named("Seven Days won a national award.", about), [])

    def test_saying_where_a_story_came_from_is_sent_back_and_never_ships(self):
        said = GOOD[:2] + ["Vermont's diverging diamond is a month old, and the reviews are positive, according to the paper."] + GOOD[3:]
        ask, calls = fake_answers({"paragraphs": said, "teaser": "x"}, {"paragraphs": GOOD, "teaser": "x"})
        script, *_ = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertEqual(len(calls), 2)
        self.assertIn('"according to the paper"', calls[1].user)
        self.assertNotIn("according to", script)
        always = fake_answers({"paragraphs": said, "teaser": "x"})[0]
        script, _, _, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=always)
        self.assertIsNone(script)
        self.assertEqual(wa.attributions("According to police, the road is closed."), [])   # a source in the story, not an outlet

    def test_a_story_source_counts_only_when_it_is_credited(self):
        # UVM Athletics is pick 10's source: "UVM men's basketball" is the story, "UVM Athletics says" is credit
        self.assertEqual(wa.outlets_named(GOOD[9], self.stories), [])
        self.assertEqual(wa.outlets_named("UVM Athletics says the Catamounts host Holy Cross.", self.stories), ["UVM Athletics"])
        # an outlet a headline names excuses only an uncredited mention of that same outlet
        about = [{"title": "Seven Days wins a national award", "source": "WCAX"}]
        self.assertEqual(wa.outlets_named("Seven Days won a national award.", about), [])
        self.assertEqual(wa.outlets_named("Seven Days reports a new editor.", about), ["Seven Days"])
        utility = [{"title": "Vermont Public Utility Commission meets", "source": "x"}]
        self.assertEqual(wa.outlets_named("Vermont Public reports the commission met.", utility), ["Vermont Public"])
        self.assertEqual(wa.outlets_named("Vermont Daily Chronicle has the story. Community News Service too.", self.stories),
                         ["Vermont Daily Chronicle", "Community News Service"])

    def test_the_fact_check_is_told_a_missing_outlet_is_not_a_problem(self):
        self.assertIn("never says which outlet", wa.VERIFY_TASK)
        self.assertIn("never a problem", wa.VERIFY_TASK)
        self.assertNotIn("That one's from", wa.VERIFY_TASK)
        # and it is exactly as strict as before about everything else
        for rule in ("a pronoun that gives someone a gender", "an opinion, judgement or prediction",
                     "Also list padding", "one for the weekend"):
            self.assertIn(rule, wa.VERIFY_TASK)
        self.assertNotRegex(wa.TASK.split("An example")[1].split("Same facts")[0].split("the way a person says it:")[1], wa.OUTLET_RE)

    def test_a_teaser_that_names_an_outlet_is_dropped(self):
        ask, _ = fake_answers({"paragraphs": GOOD, "teaser": "The Williston case and a scam, from WCAX."})
        script, teaser, _, _ = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertIsNotNone(script)
        self.assertEqual(teaser, "")

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


# The same story pair the flat way (above) and the way a person says it, with
# pacing marks: the checks read the words alone and pass it.
HUMAN = (["[short pause] Out in Williston... the Vermont State Police have an update on the police shooting there."]
         + GOOD[1:3]
         + ["DandyLion's branching out... into furniture.",
            "[softly] Essex police are warning about a possible scam, someone pretending to be law enforcement."]
         + GOOD[5:])


class Tags(unittest.TestCase):
    def setUp(self):
        self.stories = wa.local_stories(wire())

    def test_marks_pass_the_checks_and_reach_the_voice(self):
        ask, calls = fake_answers({"paragraphs": HUMAN, "teaser": "The Williston case and a [pause] scam warning."})
        script, teaser, _, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertEqual(len(calls), 1, notes)
        self.assertIn("[short pause] Out in Williston...", script)
        self.assertIn("[softly] Essex police", script)
        self.assertEqual(teaser, "")             # a teaser with a bracket is dropped whole, never trimmed
        checked = ask.checked[0].user
        self.assertNotIn("[", checked)                                            # the fact check reads the words alone
        self.assertIn("Out in Williston... the Vermont State Police", checked)
        self.assertIn("[pause] [softly] Essex police", wa.for_voice(script))

    def test_a_mark_never_hides_a_fact(self):
        p = wa.problems_of(["The panel [softly] is free and [pause] starts Tuesday at the [slowly] Fleming Museum."] + GOOD,
                           "", self.stories, "2026-10-16", "today")
        for word in ("free", "Tuesday", "Fleming"):
            self.assertIn(word, p["invented"])
        # a mark in the middle of a headline read out does not break the copied run
        p = wa.problems_of(["One month in, Vermont’s diverging diamond [pause] traffic pattern receives positive reviews."] + GOOD[3:],
                           "", self.stories, "2026-10-16", "today")
        self.assertTrue(p["copied"])
        she = wa.problems_of(["Janoo again leads Governor Scott, and [softly] she has the money."] + GOOD[2:], "",
                             self.stories, "2026-10-16", "today")
        self.assertIn("she", she["invented"])

    def test_a_bracket_that_is_not_a_mark_is_sent_back_and_never_ships(self):
        # Codex review: deleting it could reverse the meaning ("did [not] pass")
        got = wa.tidy(["The vote did [not] pass. [Short  Pause] And [slowly] more [softly] here [pause] [pause]."])
        self.assertEqual(got, ["The vote did [not] pass. [short pause] And [slowly] more here [pause]."])
        self.assertEqual(wa.tidy(["[pause] [softly]"]), [])                      # marks alone are not a paragraph
        bad = GOOD[:5] + ["[excited] Vermont Biz has the weekly road construction report."] + GOOD[6:]
        ask, calls = fake_answers({"paragraphs": bad, "teaser": "x"}, {"paragraphs": GOOD, "teaser": "x"})
        script, _, _, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertIn("[excited]", calls[1].user)
        self.assertIn("not pacing marks", calls[1].user)
        self.assertNotIn("[excited]", script)
        always = fake_answers({"paragraphs": bad, "teaser": "x"})[0]
        script, _, _, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=always)
        self.assertIsNone(script, notes)                                            # never shipped, never trimmed
        self.assertEqual(len(always.checked), 0)                                    # and no fact check spent on it
        self.assertEqual(wa.for_voice("In Charlotte.\n\n[long pause] Next.\n"), "In Shar-LOT.\n\n[long pause] Next.\n")

    def test_the_voice_refuses_a_script_with_an_unknown_bracket(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": "k"}, clear=True), \
                mock.patch.object(wa, "load_secrets"), mock.patch.object(wa.wc, "utcnow", return_value=NOW), \
                mock.patch.object(wa, "tts") as voice:
            src = os.path.join(tmp, "2026-10-16.txt")
            with open(src, "w", encoding="utf-8") as f:
                f.write("Morning.\n\nThe vote did [not] pass.\n\nThat's the Brief.\n")
            with redirect_stdout(io.StringIO()) as out:
                wa.run(Run.args(None, tmp, audio_from=src, wire_file=None))
            voice.assert_not_called()
            self.assertIn("not pacing marks ([not])", out.getvalue())

    def test_the_ration_holds_for_the_whole_brief(self):
        got = wa.tidy([f"[long pause] Story {n}. [softly] Hard one." for n in range(12)])
        text = "\n".join(got)
        self.assertEqual(text.count("[long pause]"), wa.BRIEF_MAX["long pause"])
        self.assertEqual(text.count("[softly]"), wa.BRIEF_MAX["delivery"])
        self.assertTrue(all("Story" in p for p in got))                           # marks go, never words
        voiced = wa.for_voice("Morning.\n\n" + "\n\n".join(got) + "\n")
        self.assertEqual(voiced.count("[long pause]"), wa.BRIEF_MAX["long pause"])

    def test_a_mark_inside_a_word_is_dropped_and_the_word_checked_whole(self):
        self.assertEqual(wa.tidy(["The council in Mont[short pause]pelier met."]), ["The council in Montpelier met."])
        self.assertEqual(wa.made_up("The council in Mont[short pause]pelier met.", wa.sources_of(self.stories)), ["Montpelier"])

    def test_every_story_gets_a_beat_in_the_voice_copy_only(self):
        script = "Morning.\n\nOne story.\n\n[softly] A hard one.\n\n[long pause] Closer to home.\n\nThat's the Brief.\n"
        self.assertEqual(wa.for_voice(script), "Morning.\n\n[pause] One story.\n\n[pause] [softly] A hard one.\n\n"
                                               "[long pause] Closer to home.\n\n[pause] That's the Brief.\n")
        self.assertEqual(wa.word_count(wa.for_voice(script)), wa.word_count(script))

    def test_marks_and_ellipses_do_not_count_as_words_or_sentences_to_flag(self):
        self.assertEqual(wa.word_count("[short pause] Closer to home... the council met."), 6)
        srcs = wa.sources_of(self.stories)
        self.assertEqual(wa.made_up("Two from the state. [short pause] Closer to home, DandyLion is expanding.", srcs), [])

    def test_a_cut_takes_the_marks_inside_the_sentence_with_it(self):
        claim = "It is a reminder that the choices on the ballot are being watched far past our borders."
        tagged = "One Democrat wants to try universal healthcare again. [pause] It is a reminder that the choices on the [slowly] ballot are being watched far past our borders."
        flag = {"unsupported": [{"sentence": claim, "problem": "opinion stated as fact"}]}
        ask, _ = fake_answers({"paragraphs": GOOD[:7] + [tagged] + GOOD[8:], "teaser": "x"}, checks=(flag,) * wa.DRAFTS)
        script, _, _, notes = wa.write_script(self.stories, ENGINE, "2026-10-16", "today", ask=ask)
        self.assertIsNotNone(script, notes)
        self.assertNotIn("ballot", script)
        self.assertNotIn("[slowly]", script)
        self.assertIn("One Democrat wants to try universal healthcare again.", script)


class Voice(unittest.TestCase):
    def test_the_quality_model_and_the_looser_settings(self):
        self.assertEqual(wa.MODEL, "eleven_v4")
        self.assertEqual((wa.STABILITY, wa.SIMILARITY), (0.4, 0.65))
        self.assertEqual(wa.DEFAULT_VOICE, "FrS6cKLB1wg4WYgPa9GW")             # Wyatt stays the default

        class Resp(io.BytesIO):
            headers = {"character-cost": "10"}
            def __enter__(self): return self
            def __exit__(self, *a): return False
        with mock.patch.object(wa.urllib.request, "urlopen", return_value=Resp(b"ID3")) as op:
            wa.tts("k", "v", "Hello.")
        sent = json.loads(op.call_args[0][0].data)
        self.assertEqual(sent["voice_settings"], {"stability": 0.4, "similarity_boost": 0.65})
        self.assertEqual(sent["model_id"], "eleven_v4")

    def test_the_voice_cap_is_dollars_at_the_models_rate(self):
        ask, _ = fake_answers({"paragraphs": GOOD, "teaser": "x"})
        env = {"ELEVENLABS_API_KEY": "k", "ANTHROPIC_API_KEY": "a"}
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(wa, "load_secrets"), mock.patch.object(wa.wc, "utcnow", return_value=NOW), \
                mock.patch.object(wa.wc, "ask_json", ask), mock.patch.object(wa, "tts") as voice:
            wa.wc.write_json(os.path.join(tmp, "cost.json"), {"v": 1, "month": wa.wc.month_key(NOW), "llm_usd": 0.0,
                                                              "tts_chars": 99_000, "tts_usd": 7.95, "runs": []})
            with redirect_stdout(io.StringIO()) as out:
                wa.run(Run.args(None, tmp))
            voice.assert_not_called()
            self.assertIn("$8 of ElevenLabs characters (about 100,000 on eleven_v4) is spent", out.getvalue())


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
            self.assertEqual((sent[1], sent[3]), (wa.DEFAULT_VOICE, "eleven_v4"))
            with open(os.path.join(tmp, "index.json"), encoding="utf-8") as f:
                clip = json.load(f)["clips"][0]
            self.assertEqual((clip["date"], clip["file"], clip["script"], clip["duration"], clip["bytes"]),
                             ("2026-10-16", "2026-10-16.mp3", "2026-10-16.txt", 201.4, 9))
            self.assertEqual((clip["from"], clip["stories"], clip["edition"]), ("today", 12, "2026-10-16"))
            with open(os.path.join(tmp, "cost.json"), encoding="utf-8") as f:
                cost = json.load(f)
            chars = len(sent[2])
            self.assertEqual((cost["tts_chars"], cost["runs"][-1]["tts_credits"]), (chars, 310))
            self.assertAlmostEqual(cost["tts_usd"], chars / 1000 * 0.08, places=5)
            self.assertEqual(cost["runs"][-1]["tts_model"], "eleven_v4")
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
