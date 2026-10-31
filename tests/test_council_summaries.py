"""The accuracy gate in scripts/council_summaries.py, on invented minutes: a
summary runs only if every bullet is in the record, and it never names the public."""

import os
import sys
import unittest
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import council_summaries as cs  # noqa: E402

MINUTES = """BURLINGTON CITY COUNCIL

1. Agenda
1. Agenda
City Council President Example convened the meeting at 6:05 pm.
Members present: City Council President Example, Councilors Alder, Birch-Cedar and Dogwood (all in person)
Members absent: Councilor Elm

Others present: Mayor Mulvaney-Stanak, City Attorney Hazel, COS Ivy and Juniper Kale

2. Public Forum: Time Certain: 6:30 pm

2.1. Verbal Comments
Subject 2.1. Verbal Comments
Recommended Action open Public Forum

2.1. Verbal Comments
BTV residents (in person):
Nora Quill: bike lanes
Otto Reed: Pine Street Paving Lloyd Sage: parks
Tamsin Vale
BTV resident (online):
Ulla Wren: bus routes

3. Consent Agenda

Subject 3.1. Lease of the Boathouse Annex
Recommended Action Approve a five year lease of the Boathouse Annex for $48,000 a year.
3.1. Lease of the Boathouse Annex
Motion made by Councilor Alder, seconded by Councilor Dogwood, to adopt the consent agenda. Motion passed unanimously.

6. Resolutions

6.1. Resolution: Winter Parking Pilot
Motion made by Councilor Birch-Cedar, seconded by Councilor Alder, to adopt the resolution. Motion passed 8-3.
The pilot will cost $125,000.50 and returns to the council by March 15, 2027.

6.2. Resolution: Pier Fees
Motion made by Councilor Alder, seconded by Councilor Dogwood, to raise pier fees by 7.5%. Motion failed for lack of a majority.

6.3. Resolution: Nominee Report
City Attorney Hazel presented the report to the council on Tuesday evening.
Juniper Kale reported from the office at 412 Maple Street about the nominee list.
"""

LEASE = {"head": "Boathouse lease", "text": "The council approved a five year lease of the Boathouse Annex for $48,000 a year.",
         "quote": "Approve a five year lease of the Boathouse Annex for $48,000 a year.", "locator": "3.1"}
PILOT = {"head": "Winter parking", "text": "The council adopted a winter parking pilot 8-3. It costs $125,000.50.",
         "quote": "to adopt the resolution. Motion passed 8-3.", "locator": "6.1"}
PIER = {"head": "Pier fees", "text": "A motion to raise pier fees by 7.5% failed.",
        "quote": "to raise pier fees by 7.5%. Motion failed for lack of a majority.", "locator": "6.2"}


def answer(*bullets, **extra):
    return {"top": "The council approved a five year lease of the Boathouse Annex.", "top_bullet": 1,
            "bullets": list(bullets), "next_item": "", "next_quote": "", **extra}


class QuoteAndNumberTests(unittest.TestCase):
    def fault(self, **change):
        return cs.bullet_fault({**PILOT, **change}, cs.Record(MINUTES))

    def test_a_good_bullet_passes(self):
        for bullet in (LEASE, PILOT, PIER):
            self.assertIsNone(cs.bullet_fault(bullet, cs.Record(MINUTES)), bullet["head"])

    def test_a_quote_found_across_a_line_break_with_padding(self):
        wrapped = MINUTES.replace("to adopt the resolution. Motion passed 8-3.", "to adopt   the\n   resolution. Motion\tpassed 8-3.")
        self.assertIsNone(cs.bullet_fault(PILOT, cs.Record(wrapped)))

    def test_a_curly_apostrophe_is_the_same_quote(self):
        text = MINUTES.replace("to adopt the resolution.", "to adopt the council’s resolution.")
        self.assertIsNone(cs.bullet_fault({**PILOT, "quote": "to adopt the council's resolution. Motion passed 8-3."}, cs.Record(text)))

    def test_a_made_up_quote_is_dropped(self):
        self.assertIn("quote", self.fault(quote="The council enthusiastically adopted the resolution."))

    def test_a_scrap_of_a_quote_is_dropped(self):
        self.assertIn("quote", self.fault(quote="the resolution"))

    def test_a_quote_from_another_item_is_dropped(self):
        self.assertIn("under item", self.fault(locator="3.1"))
        self.assertIn("under item", self.fault(locator="no item"))

    def test_a_quote_said_twice_counts_under_either_item(self):
        text = MINUTES.replace("6.2. Resolution: Pier Fees\n", "6.2. Resolution: Pier Fees\nto adopt the resolution. Motion passed 8-3.\n")
        self.assertIsNone(cs.bullet_fault(PILOT, cs.Record(text)))
        self.assertIsNone(cs.bullet_fault({**PILOT, "locator": "6.2"}, cs.Record(text)))

    def test_a_number_not_in_the_minutes_is_dropped(self):
        self.assertIn("9", self.fault(text="The council adopted a parking pilot 9-3."))
        self.assertIn("130000", self.fault(text="The pilot costs $130,000."))

    def test_a_head_is_checked_too(self):
        self.assertIn("2028", self.fault(head="The 2028 pilot"))

    def test_a_spelled_number_not_in_the_minutes_is_dropped(self):
        self.assertIn("nine", self.fault(text="Nine people asked the council to adopt the pilot."))

    def test_a_spelled_number_the_minutes_have_in_digits_passes(self):
        self.assertIsNone(self.fault(text="Eight councilors adopted the pilot."))

    def test_figures_compare_as_numbers(self):
        self.assertEqual(cs.numbers("$1,250,000.00 and 7.50% and 08"), {"1250000", "7.5", "8"})

    def test_a_motion_that_failed_cannot_be_called_passed(self):
        fault = cs.bullet_fault({**PIER, "text": "The council approved raising pier fees by 7.5%."}, cs.Record(MINUTES))
        self.assertIn("contradicts", fault)

    def test_a_motion_that_passed_cannot_be_called_failed(self):
        self.assertIn("contradicts", self.fault(text="The winter parking pilot failed."))

    def test_a_long_bullet_is_dropped(self):
        self.assertEqual(self.fault(text="pilot " * 80), "too long")


class PeopleTests(unittest.TestCase):
    def fault(self, text, **change):
        return cs.bullet_fault({**PILOT, "text": text, **change}, cs.Record(MINUTES))

    def test_the_speakers_are_read_out_of_the_minutes(self):
        self.assertLessEqual({"Nora Quill", "Otto Reed", "Lloyd Sage", "Tamsin Vale", "Ulla Wren"}, cs.forum_names(MINUTES))

    def test_a_speaker_is_never_named(self):
        self.assertIn("names", self.fault("Otto Reed spoke about the winter parking pilot."))
        self.assertIn("names", self.fault("Tamsin Vale spoke about the pilot."))

    def test_a_private_name_the_list_missed_is_caught_by_the_guard(self):
        self.assertIn("names", self.fault("Sarah Bellwether asked for the pilot."))

    def test_others_present_are_never_named_but_the_mayor_is_fine(self):
        self.assertEqual(cs.others_present(MINUTES), {"Hazel", "Ivy", "Kale"})
        self.assertIn("names", self.fault("City Attorney Hazel explained the pilot."))
        self.assertIsNone(self.fault("Mayor Mulvaney-Stanak asked for the winter parking pilot."))

    def test_councilors_may_be_named_in_office(self):
        self.assertIsNone(self.fault("Councilor Birch-Cedar moved the winter parking pilot."))

    def test_a_councilor_is_not_an_outsider(self):
        text = MINUTES.replace("COS Ivy", "Councilor Elm")
        self.assertNotIn("Elm", cs.Record(text).others)

    def test_a_quote_with_a_name_is_dropped(self):
        fault = cs.bullet_fault({"head": "Nominees", "text": "The council heard about the nominee list.",
                                 "quote": "Juniper Kale reported from the office", "locator": "6.3"}, cs.Record(MINUTES))
        self.assertIn("names", fault)

    def test_a_place_named_for_someone_is_not_a_person(self):
        self.assertIsNone(self.fault("The pilot covers the Robert Miller center."))

    def test_a_street_number_or_phone_is_dropped(self):
        self.assertIn("contact", self.fault("The pilot covers 412 Maple Street."))
        self.assertTrue(cs.bad_contact("Call 802-555-0134 about the pilot."))

    def test_city_hall_is_a_public_address(self):
        self.assertIsNone(cs.bad_contact("The council meets at 149 Church Street."))

    def test_the_model_never_reads_a_speakers_name(self):
        text = cs.scrub(MINUTES)
        for name in cs.forum_names(MINUTES):
            self.assertNotIn(name, text)
        self.assertIn("Speaker: bike lanes", text)
        self.assertIn("BTV resident (online):", text)
        self.assertIn("Motion passed 8-3.", text)


class GateTests(unittest.TestCase):
    def test_two_good_bullets_publish(self):
        out, faults = cs.gate(answer(LEASE, PILOT), MINUTES, "Monday, November 9, 6:00 PM.")
        self.assertEqual([b["head"] for b in out["bullets"]], ["Boathouse lease", "Winter parking"])
        self.assertEqual(faults, [])
        self.assertEqual(out["next"], "Monday, November 9, 6:00 PM.")

    def test_a_bad_bullet_is_dropped_and_the_rest_run(self):
        out, faults = cs.gate(answer(LEASE, {**PILOT, "text": "It costs $9,999."}, PIER), MINUTES)
        self.assertEqual([b["head"] for b in out["bullets"]], ["Boathouse lease", "Pier fees"])
        self.assertEqual(len(faults), 1)

    def test_fewer_than_two_publishes_nothing(self):
        out, faults = cs.gate(answer(LEASE, {**PILOT, "quote": "not in the record at all, not one word"}), MINUTES)
        self.assertIsNone(out)
        self.assertEqual(len(faults), 1)

    def test_a_broken_answer_publishes_nothing(self):
        self.assertIsNone(cs.gate({}, MINUTES)[0])
        self.assertIsNone(cs.gate({"bullets": "nope"}, MINUTES)[0])
        self.assertIsNone(cs.gate(answer("a", "b"), MINUTES)[0])

    def test_no_more_than_five(self):
        out, faults = cs.gate(answer(*[LEASE, PILOT, PIER] * 3), MINUTES)
        self.assertEqual(len(out["bullets"]), 5)
        self.assertEqual(len(faults), 4)

    def test_the_top_line_restates_a_surviving_bullet(self):
        out, _ = cs.gate(answer(LEASE, PILOT), MINUTES)
        self.assertEqual(out["top"], "The council approved a five year lease of the Boathouse Annex.")

    def test_a_top_line_with_a_new_figure_falls_back(self):
        out, _ = cs.gate(answer(LEASE, PILOT, top="The council approved a lease of the Boathouse Annex for $48,000 over 3 decades."), MINUTES)
        self.assertEqual(out["top"], LEASE["text"])

    def test_a_top_line_on_a_dropped_bullet_falls_back_to_the_first(self):
        out, _ = cs.gate(answer({**PIER, "quote": "no such words in the minutes at all"}, LEASE, PILOT,
                                top="A motion to raise pier fees failed.", top_bullet=1), MINUTES)
        self.assertEqual(out["top"], LEASE["text"])

    def test_a_top_line_about_something_else_falls_back(self):
        out, _ = cs.gate(answer(LEASE, PILOT, top="Taxes are going up on every household in the city."), MINUTES)
        self.assertEqual(out["top"], LEASE["text"])

    def test_next_keeps_the_calendar_date_and_a_supported_item(self):
        out, _ = cs.gate(answer(LEASE, PILOT, next_item="The pilot returns to the council by March 15, 2027.",
                                next_quote="returns to the council by March 15, 2027."), MINUTES, "Monday, November 9, 6:00 PM.")
        self.assertEqual(out["next"], "Monday, November 9, 6:00 PM. The pilot returns to the council by March 15, 2027.")

    def test_next_drops_an_item_the_minutes_do_not_support(self):
        out, _ = cs.gate(answer(LEASE, PILOT, next_item="The pilot returns in April.", next_quote="words the minutes never used at all"),
                         MINUTES, "Monday, November 9, 6:00 PM.")
        self.assertEqual(out["next"], "Monday, November 9, 6:00 PM.")

    def test_next_drops_an_item_with_an_unknown_number(self):
        out, _ = cs.gate(answer(LEASE, PILOT, next_item="It returns on April 2, 2029.", next_quote="returns to the council by March 15, 2027."), MINUTES)
        self.assertEqual(out["next"], "")


class RunTests(unittest.TestCase):
    def test_item_at_ignores_a_decimal_in_a_line(self):
        text = "6.1. First\nSpeaker: 6.8\nThe vote was 7.5 to none.\n6.2. Second\n"
        self.assertEqual(cs.item_at(text, text.index("vote")), "6.1")
        self.assertEqual(cs.item_at(text, len(text) - 1), "6.2")

    def test_item_at_ignores_a_numbered_step_inside_a_motion(self):
        text = "6.15. Lease\nRecommended Action 1. Approve it\n2. To authorize the lease\n7. Other business\n"
        self.assertEqual(cs.item_at(text, text.index("authorize")), "6.15")
        self.assertEqual(cs.item_at(text, len(text) - 1), "7")

    def test_a_meeting_is_a_meeting_of_the_council(self):
        self.assertTrue(cs.is_meeting({"eventName": "Special City Council Meeting"}))
        self.assertFalse(cs.is_meeting({"eventName": "FY27 Budget Presentations"}))
        self.assertFalse(cs.is_meeting({"eventName": "**CANCELLED** City Council Meeting"}))
        self.assertFalse(cs.is_meeting({"eventName": "City Council TEST routing"}))

    def test_retries_stop(self):
        event = {"id": 7, "publishedFiles": [{"type": "Minutes", "fileId": 1}]}
        self.assertEqual(cs.waiting([event], {"meetings": [], "tries": {}}), [event])
        self.assertEqual(cs.waiting([event], {"meetings": [], "tries": {"7": cs.RETRIES}}), [event])
        self.assertEqual(cs.waiting([event], {"meetings": [], "tries": {"7": cs.RETRIES + 1}}), [])
        self.assertEqual(cs.waiting([event], {"meetings": [{"id": 7}], "tries": {}}), [])

    def test_no_minutes_no_meeting(self):
        self.assertEqual(cs.waiting([{"id": 7, "publishedFiles": [{"type": "Agenda", "fileId": 1}]}], {"meetings": [], "tries": {}}), [])

    def test_the_next_meeting_comes_from_the_calendar_at_wall_time(self):
        when = datetime(2026, 10, 26, 18, tzinfo=timezone.utc)
        later = [{"startDateTime": "2026-11-23T18:00:00Z"}, {"startDateTime": "2026-11-09T18:00:00Z"}, {"startDateTime": "2026-10-05T18:00:00Z"}]
        self.assertEqual(cs.next_meeting(when, later), "Monday, November 9, 6:00 PM.")
        self.assertEqual(cs.next_meeting(when, []), "")

    def test_the_tracking_is_cut_from_a_video_link(self):
        self.assertEqual(cs.clean_video("https://www.youtube.com/live/abc?si=xyz"), "https://www.youtube.com/live/abc")
        self.assertIsNone(cs.clean_video(None))

    def test_the_prompt_is_private(self):
        import private_prompts
        self.assertIn(cs.PROMPT, private_prompts.NAMES)
        with open(cs.__file__, encoding="utf-8") as src:
            self.assertNotIn("You write", src.read())


if __name__ == "__main__":
    unittest.main()
