"""The accuracy gate in scripts/council_summaries.py, on invented minutes: a
summary runs only if every bullet is in the record, and it never names the public."""

import json
import os
import re
import sys
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import council_summaries as cs  # noqa: E402
import refresh_civic  # noqa: E402

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


# a second meeting: attendance in the other form, people presenting, and items
# whose recommended action is not what happened
RECORD = """BURLINGTON CITY COUNCIL

1. Agenda
Members present: Councilors Alder, Birch-Cedar and Dogwood and City Council President Example
Other members present: City Attorney Hazel, Mayor Mulvaney-Stanak, CAO Ivy and Lori Tamsworth

Subject 3.1. Fence Viewer Terms
Recommended Action authorize Zelda Quorn, Director of Public Works, to sign the Fence Viewer terms for $12,000.

3.1. Fence Viewer Terms
City Attorney Hazel spoke to this agenda item.

Subject 7.1. Authorization to Accept a Harbor Mural
Recommended Action accept the donated harbor mural, as described in Attachment A, with a total value of $20,000 from the Harbor Guild.

7.1. Authorization to Accept a Harbor Mural
HMAC Director Pell and BCA Rolf Ansgar were online for this agenda item.
Motion made by Councilor Alder, seconded by Councilor Dogwood, to approve the motion as presented.
Motion failed 11:1 - roll call vote taken: Aye: Councilor Alder

Subject 7.2. Update on the Quayside Center
Recommended Action hold a work session on the quayside center and its service report.

7.2. Update on the Quayside Center
VQCR Members Bettina Fallow, Jo Tarn and Milo Reddick spoke to this agenda item.
City Staff Sefa Ormond and Ana Pruitt were also present.

Subject 7.3. Dock Ordinance
Recommended Action waive the reading and adopt the amended dock ordinance.

7.3. Dock Ordinance
Motion made by Councilor Dogwood, seconded by Councilor Alder, to waive the reading and refer the amended dock ordinance to the Ordinance Committee.
Motion passed unanimously.

Subject 7.4. Purchase of Parking Cameras
Recommended Action approve the purchase of parking cameras for a total of $54,500.

7.4. Purchase of Parking Cameras
Motion made by Councilor Alder, seconded by Councilor Birch-Cedar, to amend the purchase price.
Amendment failed: 4:8.
Motion made by Councilor Alder, seconded by Councilor Birch-Cedar, to approve the motion as presented.
Motion passed: 10:2.
"""

MURAL_QUOTE = "accept the donated harbor mural, as described in Attachment A, with a total value of $20,000"
MURAL = {"head": "Harbor mural", "text": "The council voted 11-1 against accepting a donated harbor mural valued at $20,000.",
         "quote": MURAL_QUOTE, "locator": "7.1"}
DOCK = {"head": "Dock ordinance", "text": "The council unanimously referred the amended dock ordinance to its Ordinance Committee.",
        "quote": "to waive the reading and refer the amended dock ordinance", "locator": "7.3"}
CAMERAS = {"head": "Parking cameras", "text": "The council voted 10-2 to buy parking cameras for $54,500, after an amendment failed 4-8.",
           "quote": "approve the purchase of parking cameras for a total of $54,500", "locator": "7.4"}


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
        text = MINUTES.replace("6.3. Resolution: Nominee Report\n", "6.3. Resolution: Nominee Report\nto adopt the resolution. Motion passed 8-3.\n")
        self.assertIsNone(cs.bullet_fault(PILOT, cs.Record(text)))
        self.assertIsNone(cs.bullet_fault({**PILOT, "locator": "6.3"}, cs.Record(text)))

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


class OutcomeTests(unittest.TestCase):
    def setUp(self):
        self.record = cs.Record(RECORD)

    def fault(self, bullet, text):
        return cs.bullet_fault({**bullet, "text": text}, self.record)

    def test_what_happened_passes(self):
        for bullet in (MURAL, DOCK, CAMERAS):
            self.assertIsNone(cs.bullet_fault(bullet, self.record), bullet["head"])

    def test_the_recommended_action_cannot_turn_a_failure_into_a_pass(self):
        self.assertIn("recorded outcome", self.fault(MURAL, "The council approved accepting a donated harbor mural, valued at $20,000."))
        self.assertIn("recorded outcome", self.fault(MURAL, "The council voted 11-1 to accept a donated harbor mural."))

    def test_a_pass_cannot_be_called_a_failure(self):
        self.assertIn("recorded outcome", self.fault(DOCK, "The council rejected the amended dock ordinance."))

    def test_referred_is_not_adopted(self):
        self.assertIn("postponed or referred", self.fault(DOCK, "The council adopted the amended dock ordinance."))

    def test_the_tally_is_the_recorded_one(self):
        self.assertIn("no 9-3 vote", cs.outcome_fault("The council voted 9-3 to buy parking cameras.", "7.4", self.record))
        self.assertIn("no 2-10 vote", self.fault(CAMERAS, "The council voted 2-10 to buy parking cameras."))

    def test_a_failed_tally_reads_either_way(self):
        self.assertIsNone(self.fault(MURAL, "The council voted 1-11 against accepting a donated harbor mural."))

    def test_unanimous_must_be_recorded(self):
        self.assertIn("not unanimous", self.fault(CAMERAS, "The council unanimously approved parking cameras."))

    def test_a_section_number_is_not_a_tally(self):
        self.assertIsNone(cs.outcome_fault("The motion changed Sec. 2-3 of the code.", "7.3", cs.Record(RECORD.replace("Motion passed unanimously.", "Motion passed."))))

    def test_an_item_with_no_outcome_has_nothing_to_disagree_with(self):
        self.assertIsNone(cs.outcome_fault("The council approved the update.", "7.2", self.record))

    def test_the_outcomes_are_read_in_order(self):
        self.assertEqual([(o["passed"], o["tally"]) for o in self.record.outcomes["7.4"]], [(False, (4, 8)), (True, (10, 2))])
        self.assertEqual(self.record.outcomes["7.1"][0]["tally"], (11, 1))
        self.assertTrue(self.record.outcomes["7.3"][0]["delay"])
        self.assertTrue(self.record.outcomes["7.3"][0]["all"])

    def test_a_motion_withdrawn_is_not_the_motion_voted_on(self):
        text = RECORD.replace("to waive the reading and refer the amended dock ordinance to the Ordinance Committee.\nMotion passed",
                              "to postpone. Councilor Alder withdrew his motion to postpone. Made by Councilor Alder, to adopt the ordinance.\nMotion passed")
        self.assertFalse(cs.Record(text).outcomes["7.3"][0]["delay"])


class NamedInTheMinutesTests(unittest.TestCase):
    def setUp(self):
        self.record = cs.Record(RECORD)

    def named(self, text):
        return cs.bad_people(text, self.record)

    def test_the_other_form_of_attendance(self):
        self.assertEqual(cs.others_present(RECORD), {"Hazel", "Ivy", "Tamsworth"})
        self.assertLessEqual({"Alder", "Dogwood"}, cs.councilors(RECORD))
        self.assertFalse({"Hazel", "Ivy", "Tamsworth"} & cs.councilors(RECORD))

    def test_staff_are_refused_by_surname_and_title(self):
        for text in ("City Attorney Hazel advised the council.", "CAO Ivy advised the council.", "Hazel advised the council."):
            self.assertTrue(self.named(text), text)

    def test_presenters_are_read_out_of_the_minutes(self):
        self.assertLessEqual({"Bettina", "Fallow", "Jo", "Tarn", "Milo", "Reddick", "Pell", "Rolf", "Ansgar", "Sefa", "Ormond", "Ana", "Pruitt"}, cs.presenters(RECORD))
        for text in ("Bettina Fallow of the Vermont Quayside Coalition updated the council.", "Reddick spoke at the work session.",
                     "HMAC Director Pell spoke.", "The council thanked Ansgar."):
            self.assertTrue(self.named(text), text)

    def test_a_name_in_a_recommended_action_is_refused(self):
        self.assertTrue(self.named("The council authorized Zelda Quorn to sign."))
        self.assertTrue(self.named("Quorn signed it."))

    def test_a_capitalised_word_the_minutes_never_vouch_for_is_refused(self):
        self.assertTrue(self.named("The council heard from Ottoline Brandvold on the matter."))

    def test_the_council_and_the_mayor_stay(self):
        for text in ("Councilor Birch-Cedar moved the pilot.", "Mayor Mulvaney-Stanak spoke.", "The council thanked Dogwood."):
            self.assertIsNone(self.named(text), text)

    def test_bodies_and_places_are_not_people(self):
        for text in ("The council wrote to the Harbor Guild Foundation.", "The work covers Shelburne Road and the Quayside Center.",
                     "It goes to the Ordinance Committee.", "Wastewater rates did not change."):
            self.assertIsNone(self.named(text), text)

    def test_the_model_reads_no_one_but_the_council(self):
        text = cs.scrub(RECORD)
        for name in ("Bettina", "Fallow", "Tarn", "Reddick", "Pell", "Ansgar", "Hazel", "Quorn", "Tamsworth", "Ormond", "Pruitt"):
            self.assertNotIn(name, text)
        self.assertIn("Councilor Birch-Cedar", text)
        self.assertIn("Mayor Mulvaney-Stanak", text)

    def test_nor_does_the_agenda_carry_them(self):
        event = {"eventName": "City Council Meeting", "startDateTime": "2026-10-26T18:00:00Z"}
        copy = cs.format_meeting(event, RECORD, "7.2. Update, with Milo Reddick presenting", "")
        self.assertNotIn("Reddick", copy)


class TopTests(unittest.TestCase):
    def gate(self, top, **extra):
        return cs.gate({"top": top, "top_bullet": 1, "bullets": [DOCK, CAMERAS], "next_item": "", "next_quote": "", **extra}, RECORD)[0]["top"]

    def test_a_good_top_runs(self):
        top = "The council unanimously referred the amended dock ordinance to its Ordinance Committee for review."
        self.assertEqual(self.gate(top), top)

    def test_a_name_in_the_top_falls_back_to_the_bullet(self):
        self.assertEqual(self.gate("Milo Reddick got the council to refer the amended dock ordinance to its Ordinance Committee."), DOCK["text"])

    def test_a_contact_detail_in_the_top_falls_back(self):
        self.assertEqual(self.gate("The council referred the amended dock ordinance to its Ordinance Committee, call 802-555-0134."), DOCK["text"])

    def test_an_outcome_flip_in_the_top_falls_back(self):
        self.assertEqual(self.gate("The council unanimously adopted the amended dock ordinance, referred to its Ordinance Committee."), DOCK["text"])


class CopyTests(unittest.TestCase):
    def test_a_note_about_the_document_is_cut(self):
        for note in ("The minutes record no vote on this item.", "It was a discussion item with no vote.", "The ordinance was not adopted."):
            out, _ = cs.gate(answer({**LEASE, "text": LEASE["text"] + " " + note}, PILOT), MINUTES)
            self.assertEqual(out["bullets"][0]["text"], LEASE["text"])

    def test_a_bullet_that_is_only_a_note_goes(self):
        out, faults = cs.gate(answer({**LEASE, "text": "The minutes record no vote."}, PILOT, PIER), MINUTES)
        self.assertEqual([b["head"] for b in out["bullets"]], ["Winter parking", "Pier fees"])
        self.assertIn("empty", faults[0])

    def test_over_the_limit_the_last_bullets_go_never_the_one_on_top(self):
        pad = {**PIER, "text": "A motion to raise pier fees by 7.5% failed " + "and failed " * 30 + "again."}
        long_one = {**LEASE, "text": "The council approved a lease of the Boathouse Annex " + "with terms " * 28 + "attached."}
        bullets = [PILOT, long_one, pad, {**long_one, "head": "Again"}, {**pad, "head": "Once more"}]
        out, faults = cs.gate({"top": "", "top_bullet": 5, "bullets": bullets, "next_item": "", "next_quote": ""}, MINUTES)
        self.assertLessEqual(len(" ".join([out["top"], out["next"]] + [b["text"] for b in out["bullets"]]).split()), cs.MAX_WORDS)
        self.assertIn("Once more", [b["head"] for b in out["bullets"]])
        self.assertIn("word limit", faults[-1])


class LinkTests(unittest.TestCase):
    EVENT = {"id": 10093, "hasAgenda": True, "publishedFiles": [
        {"fileId": 21481, "type": "Agenda", "name": "City Council Meeting V7", "url": "stream/BURLINGTONVT/a.pdf"},
        {"fileId": 21482, "type": "Agenda Packet", "name": "City Council Meeting V7", "url": "stream/BURLINGTONVT/b.pdf"},
        {"fileId": 21491, "type": "Minutes", "name": "October 26, 2026 City Council Meeting Minutes LO", "url": "stream/BURLINGTONVT/c.pdf"}]}

    def test_each_file_opens_in_the_citys_viewer(self):
        links = refresh_civic.document_links(self.EVENT)
        self.assertEqual(links["minutes_url"], "https://burlingtonvt.portal.civicclerk.com/event/10093/files/agenda/21491")
        self.assertEqual(links["agenda_url"], "https://burlingtonvt.portal.civicclerk.com/event/10093/files/agenda/21481")
        self.assertEqual(links["packet_url"], "https://burlingtonvt.portal.civicclerk.com/event/10093/files/agenda/21482")

    def test_a_file_with_no_id_has_no_link(self):
        links = refresh_civic.document_links({"id": 1, "publishedFiles": [{"type": "Minutes", "url": "stream/x.pdf"}]})
        self.assertIsNone(links["minutes_url"])

    def test_the_stored_links_are_the_viewers_and_the_file_exists(self):
        with open(cs.OUT, encoding="utf-8") as src:
            meetings = json.load(src)["meetings"]
        form = re.compile(r"^https://burlingtonvt\.portal\.civicclerk\.com/event/(\d+)/files/agenda/(\d+)$")
        for meeting in meetings:
            match = form.match(meeting["minutes_url"])
            self.assertTrue(match and match.group(1) == str(meeting["id"]), meeting["minutes_url"])
        # the viewer answers 200 for anything, so ask for the file it would show
        file_id = form.match(meetings[0]["minutes_url"]).group(2)
        request = urllib.request.Request(f"{cs.FILE_API}(fileId={file_id},plainText=false)", headers={"User-Agent": cs.USER_AGENT, "Range": "bytes=0-4"})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                self.assertEqual(response.read(5), b"%PDF-")
        except urllib.error.HTTPError as exc:
            if exc.code < 500:
                raise
            self.skipTest(f"the city's API is down ({exc.code})")
        except OSError as exc:
            self.skipTest(f"no network ({exc})")


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
