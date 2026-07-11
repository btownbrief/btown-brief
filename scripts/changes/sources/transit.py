#!/usr/bin/env python3
"""Green Mountain Transit service-alert RSS additions."""

from ..common import diff_feed_items, event, get, parse_feed

ID = "gmt-alerts"
NAME = "Green Mountain Transit"
URL = "https://ridegmt.com/category/service-alert/feed/"


def snapshot():
    return {"items": parse_feed(get(URL))}


def diff(prev, cur, bootstrap):
    return diff_feed_items(prev, cur, bootstrap, lambda item, ts: event(
        ts=ts, category="roads", headline=f"GMT: {item['title']}",
        url=item["link"], source=ID, source_name=NAME, priority=2,
    ))
