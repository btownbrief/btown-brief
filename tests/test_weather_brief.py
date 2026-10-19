"""The plain-words weather brief (scripts/weather_brief.py) and the grid
amounts behind it (scripts/refresh_weather.py).

Stephen, 2026-10-19: "a text brief about today's weather … When and how
much. Temps." Each case pins a rule: highs and lows are the NWS periods'
own numbers, rain timing and amounts come from the hourly rows, wind is
said only when it matters on foot or on a bike, in mph.

Run: python3 -m unittest tests.test_weather_brief
"""

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

import weather_brief as wb  # noqa: E402
import refresh_weather as rw  # noqa: E402

ET = ZoneInfo("America/New_York")


def at(day, hh, mm=0):
    return datetime(2026, 10, day, hh, mm, tzinfo=ET)


def period(name, start, is_day, temp, short="Sunny", pop=0, wind="S 5 mph", detailed=""):
    return {"name": name, "start": start.isoformat(), "is_day": is_day, "temp_f": temp,
            "pop": pop, "wind": wind, "short": short, "detailed": detailed or short}


def hours_from(start, n, **over):
    """n hourly rows from `start`; `over` maps an hour offset range to
    field overrides, e.g. {range(7, 13): {"pop": 80, "qpf_in": 0.05}}."""
    rows = []
    for i in range(n):
        t = start + timedelta(hours=i)
        row = {"t": t.isoformat(), "temp_f": 50, "feels_f": 48, "pop": 0, "wind_mph": 8,
               "wind_dir": "S", "sky": 10, "short": "Sunny", "qpf_in": 0.0, "snow_in": 0.0, "gust_mph": 12}
        for rng, fields in over.get("spans", {}).items():
            if i in rng:
                row.update(fields)
        rows.append(row)
    return rows


def week(first_day_start, first_is_day=True):
    """Fourteen alternating periods from the given start, dry and mild."""
    out = []
    t, is_day = first_day_start, first_is_day
    names = iter(["Today", "Tonight", "Tuesday", "Tuesday Night", "Wednesday", "Wednesday Night"] * 3)
    for _ in range(6):
        nxt = (t.replace(hour=18) if is_day else (t + timedelta(days=1 if t.hour >= 6 else 0)).replace(hour=6))
        out.append(period(next(names), t, is_day, 60 if is_day else 42,
                          "Sunny" if is_day else "Mostly Clear"))
        t, is_day = nxt, not is_day
    return out


class DryDay(unittest.TestCase):
    """Monday 2026-10-19 as NWS had it at 7 am: Sunny, high near 62;
    Tonight mostly clear, low around 42; Tuesday mostly sunny, high near 56."""

    def setUp(self):
        self.d = {
            "forecast": {"periods": [
                period("Today", at(19, 7), True, 62, "Sunny"),
                period("Tonight", at(19, 18), False, 42, "Mostly Clear"),
                period("Tuesday", at(20, 6), True, 56, "Mostly Sunny"),
                period("Tuesday Night", at(20, 18), False, 34, "Mostly Clear"),
            ]},
            # hourly lows run a couple of degrees warmer than the period low
            "hourly": {"hours": hours_from(at(19, 7), 36)},
        }

    def test_text_matches_the_nws_periods(self):
        b = wb.build(self.d, now=at(19, 7, 30))
        self.assertEqual(b["text"], "Sunny today, high 62. Mostly clear tonight, low 42. "
                                    "Tuesday, mostly sunny and cooler, high 56.")
        self.assertEqual(b["date"], "2026-10-19")
        self.assertEqual([p["label"] for p in b["periods"]], ["Today", "Tonight"])

    def test_no_wind_on_a_light_wind_day(self):
        b = wb.build(self.d, now=at(19, 7, 30))
        self.assertNotIn("wind", b["text"])
        self.assertNotIn("knot", b["text"])

    def test_evening_leads_with_tonight(self):
        b = wb.build(self.d, now=at(19, 19))
        self.assertTrue(b["text"].startswith("Mostly clear tonight, low 42."), b["text"])
        self.assertEqual([p["label"] for p in b["periods"]], ["Tonight", "Tuesday"])
        # dry Tuesday night is left out at night: two sentences
        self.assertEqual(b["text"].count("."), 2, b["text"])

    def test_last_evenings_night_after_midnight_is_overnight(self):
        b = wb.build(self.d, now=at(20, 1))
        self.assertTrue(b["text"].startswith("Mostly clear overnight, low 42. Mostly sunny today, high 56."), b["text"])
        self.assertEqual(b["date"], "2026-10-20")

    def test_a_forecast_that_has_run_out_says_nothing(self):
        # kept from an old run: its last period ended days ago
        self.assertIsNone(wb.build(self.d, now=at(23, 9)))

    def test_a_period_that_has_ended_is_dropped(self):
        b = wb.build(self.d, now=at(20, 7))
        self.assertTrue(b["text"].startswith("Mostly sunny today, high 56."), b["text"])


class RainTimingAndAmount(unittest.TestCase):

    def test_afternoon_rain_says_when_and_how_much(self):
        start = at(19, 7)
        hours = hours_from(start, 36, spans={range(7, 10): {"pop": 80, "qpf_in": 0.1, "short": "Rain"}})
        d = {"forecast": {"periods": [
            period("Today", at(19, 7), True, 55, "Sunny then Rain", pop=80),
            period("Tonight", at(19, 18), False, 44, "Mostly Cloudy"),
            period("Tuesday", at(20, 6), True, 52, "Partly Sunny")]},
            "hourly": {"hours": hours}}
        b = wb.build(d, now=at(19, 8))
        today = b["periods"][0]
        self.assertEqual(today["precip"]["kind"], "rain")
        self.assertEqual(today["precip"]["when"], "from 2 to 5pm")
        self.assertEqual(today["precip"]["amount"], "about 0.3 inch")      # 3 x 0.1
        self.assertTrue(b["text"].startswith("Rain today from 2 to 5pm, about 0.3 inch, high 55."), b["text"])

    def test_rain_running_into_the_night_is_split_at_the_period(self):
        hours = hours_from(at(19, 7), 36, spans={range(9, 14): {"pop": 70, "qpf_in": 0.1, "short": "Rain Likely"}})
        d = {"forecast": {"periods": [
            period("Today", at(19, 7), True, 55, "Partly Sunny then Rain Likely", pop=70),
            period("Tonight", at(19, 18), False, 44, "Rain Likely then Mostly Cloudy", pop=70),
            period("Tuesday", at(20, 6), True, 52, "Partly Sunny")]},
            "hourly": {"hours": hours}}
        b = wb.build(d, now=at(19, 8))
        self.assertTrue(b["text"].startswith("Rain likely today from 4pm on, about 0.2 inch, high 55. "
                                             "Rain likely tonight until 9pm, about 0.3 inch, low 44."), b["text"])

    def test_a_chance_of_showers_until_mid_morning(self):
        hours = hours_from(at(19, 7), 36, spans={range(0, 3): {"pop": 40, "qpf_in": 0.01, "short": "Chance Rain Showers"}})
        d = {"forecast": {"periods": [
            period("Today", at(19, 7), True, 58, "Chance Rain Showers then Mostly Sunny", pop=40),
            period("Tonight", at(19, 18), False, 40, "Clear")]},
            "hourly": {"hours": hours}}
        b = wb.build(d, now=at(19, 7, 10))
        self.assertTrue(b["text"].startswith("A chance of showers today until 10am, under a tenth of an inch, high 58."), b["text"])

    def test_overnight_snow_in_inches(self):
        hours = hours_from(at(19, 18), 36, spans={range(4, 10): {"pop": 90, "qpf_in": 0.04, "snow_in": 0.45, "short": "Snow"}})
        d = {"forecast": {"periods": [
            period("Tonight", at(19, 18), False, 28, "Snow", pop=90),
            period("Tuesday", at(20, 6), True, 33, "Mostly Cloudy"),
            period("Tuesday Night", at(20, 18), False, 20, "Clear")]},
            "hourly": {"hours": hours}}
        b = wb.build(d, now=at(19, 18, 20))
        self.assertTrue(b["text"].startswith("Snow tonight from 10pm to 4am, about 3 inches of snow, low 28."), b["text"])

    def test_separate_wet_stretches_are_on_and_off(self):
        hours = hours_from(at(19, 7), 36, spans={range(1, 4): {"pop": 70, "qpf_in": 0.05, "short": "Rain Showers Likely"},
                                                 range(7, 10): {"pop": 70, "qpf_in": 0.05, "short": "Rain Showers Likely"}})
        d = {"forecast": {"periods": [
            period("Today", at(19, 7), True, 55, "Showers Likely", pop=70),
            period("Tonight", at(19, 18), False, 44, "Mostly Cloudy")]},
            "hourly": {"hours": hours}}
        b = wb.build(d, now=at(19, 7, 10))
        self.assertTrue(b["text"].startswith("Showers likely today on and off from 8am to 5pm, about 0.3 inch, high 55."), b["text"])

    def test_rain_beyond_the_hourly_rows_says_no_time_or_amount(self):
        hours = hours_from(at(19, 7), 12)    # only to 7 pm today
        d = {"forecast": {"periods": [
            period("Today", at(19, 7), True, 60),
            period("Tonight", at(19, 18), False, 45, "Mostly Clear"),
            period("Tuesday", at(20, 6), True, 54, "Rain Likely", pop=70)]},
            "hourly": {"hours": hours}}
        b = wb.build(d, now=at(19, 7, 30))
        self.assertIn("Tuesday, rain likely and cooler, high 54.", b["text"])
        self.assertNotIn("inch", b["text"])


class WindAndAlerts(unittest.TestCase):

    def test_gusts_are_said_in_mph_when_they_matter(self):
        hours = hours_from(at(19, 7), 36, spans={range(4, 9): {"wind_mph": 22, "gust_mph": 38}})
        d = {"forecast": {"periods": [period("Today", at(19, 7), True, 50, "Mostly Cloudy"),
                                      period("Tonight", at(19, 18), False, 38, "Mostly Cloudy")]},
             "hourly": {"hours": hours}}
        b = wb.build(d, now=at(19, 7, 30))
        self.assertTrue(b["text"].startswith("Mostly cloudy today, windy with gusts to 38 mph, high 50."), b["text"])

    def test_an_active_alert_leads(self):
        d = {"forecast": {"periods": week(at(19, 7))}, "hourly": {"hours": hours_from(at(19, 7), 36)},
             "alerts": {"active": [{"event": "Wind Advisory", "expires": at(19, 20).isoformat()},
                                   {"event": "Old Advisory", "expires": at(19, 6).isoformat()}]}}
        b = wb.build(d, now=at(19, 9))
        self.assertTrue(b["text"].startswith("Wind Advisory until 8pm. Sunny today, high 60."), b["text"])
        self.assertNotIn("Old Advisory", b["text"])
        self.assertEqual(b["text"].count("."), 3, b["text"])


class Words(unittest.TestCase):

    def test_sky_words_drop_the_precip_part(self):
        self.assertEqual(wb.sky_words("Mostly Sunny then Slight Chance Rain Showers", True), "mostly sunny")
        self.assertEqual(wb.sky_words("Patchy Frost then Sunny", True), "patchy frost then sunny")
        self.assertEqual(wb.sky_words("Rain Showers Likely", False), "clear")

    def test_amounts(self):
        self.assertEqual(wb.amount_words(0.02, 0), "under a tenth of an inch")
        self.assertEqual(wb.amount_words(0.11, 0), "about a tenth of an inch")
        self.assertEqual(wb.amount_words(1.26, 0), "about 1.3 inches")
        self.assertEqual(wb.amount_words(0.3, 0.8), "about an inch of snow")
        self.assertEqual(wb.amount_words(0.3, 0.6), "under an inch of snow")
        self.assertEqual(wb.amount_words(0.3, 2.5), "about 3 inches of snow")
        self.assertEqual(wb.amount_words(0.3, 0.4), "about 0.3 inch")
        # half up, as the page's JS rounds (Python's round() would say 0.2)
        self.assertEqual(wb.amount_words(0.25, 0), "about 0.3 inch")
        self.assertEqual(wb.amount_words(0.95, 0), "about 1 inch")
        self.assertEqual(wb.amount_words(1.0, 0), "about 1 inch")
        self.assertEqual(wb.amount_words(1.05, 0), "about 1.1 inches")
        self.assertEqual(wb.amount_words(0.149, 0), "about a tenth of an inch")

    def test_clock(self):
        self.assertEqual(wb.clock(at(19, 0)), "midnight")
        self.assertEqual(wb.clock(at(19, 12)), "noon")
        self.assertEqual(wb.clock(at(19, 14, 30)), "2:30pm")
        self.assertEqual(wb._span(at(19, 21), at(20, 2)), "from 9pm to 2am")


class GridAmounts(unittest.TestCase):

    def test_no_brief_from_sections_kept_from_an_old_run(self):
        d = {"forecast": {"periods": [period("Today", at(19, 7), True, 62)]}, "hourly": {"hours": hours_from(at(19, 7), 12)}}
        self.assertIsNone(rw.brief_for(d, ["forecast"]))
        self.assertIsNone(rw.brief_for(d, ["hourly"]))

    def test_a_six_hour_total_is_split_not_repeated(self):
        vals = [{"validTime": "2026-10-19T18:00:00+00:00/PT6H", "value": 12.0}]
        out = rw._expand_grid_amounts(vals)
        self.assertEqual(len(out), 6)
        self.assertAlmostEqual(sum(out.values()), 12.0)

    def test_days_are_burlington_days(self):
        rain = rw._expand_grid_amounts([{"validTime": "2026-10-20T00:00:00+00:00/PT6H", "value": 25.4}])
        days = {r["date"]: r for r in rw._precip_days(rain, {})}
        # 00-06 UTC on the 20th is 8 pm to 2 am in Burlington: 4 hours on the 19th, 2 on the 20th
        self.assertAlmostEqual(days["2026-10-19"]["precip_in"], 0.67, places=2)
        self.assertAlmostEqual(days["2026-10-20"]["precip_in"], 0.33, places=2)


if __name__ == "__main__":
    unittest.main()
