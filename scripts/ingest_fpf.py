#!/usr/bin/env python3
"""Turn locally saved Front Porch Forum material into private tip lines."""

import argparse
from email import policy
from email.parser import BytesParser
import html
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
TIPS = os.path.join(ROOT, "data", "tips-inbox.md")
DIGESTS = os.path.join(ROOT, "data", "fpf-digests")
DROPBOX = os.path.join(ROOT, "data", "fpf-dropbox")
PROCESSED = os.path.join(DIGESTS, ".processed")
HEADER = "<!-- PRIVATE — newsletter leads, never publish directly; verify everything independently -->\n"


# ----------------------------------------------------------------------
# Extraction helpers
# ----------------------------------------------------------------------

def clean(value):
    return re.sub(r"\s+", " ", value or "").strip()


def strip_html(value):
    return clean(html.unescape(re.sub(r"(?s)<[^>]+>", " ", value or "")))


def first_80(value):
    value = clean(value).replace("*", "")  # asterisks would break the **…** dedup capture
    return value if len(value) <= 80 else (value[:80].rsplit(" ", 1)[0] or value[:80]).rstrip(" ,.;:-") + "…"


def digest_text(path):
    if path.lower().endswith(".eml"):
        with open(path, "rb") as src:
            message = BytesParser(policy=policy.default).parse(src)
        body = message.get_body(preferencelist=("plain",))
        if body:
            return body.get_content()
        body = message.get_body(preferencelist=("html",))
        return strip_html(body.get_content()) if body else ""
    with open(path, encoding="utf-8", errors="replace") as src:
        value = src.read()
    return strip_html(value) if path.lower().endswith(".html") else value


def digest_items(value):
    value = value.replace("\r\n", "\n")
    chunks = re.split(r"\n\s*(?:-{4,}|={4,})\s*\n|(?=^#{1,4}\s+\S)", value, flags=re.M)
    items = []
    for chunk in chunks:
        lines = [clean(line.lstrip("# ")) for line in chunk.splitlines() if clean(line)]
        if not lines:
            continue
        # Consecutive title-like headings naturally begin a new item.
        starts = [0] + [i for i in range(1, len(lines)) if
                        (lines[i].isupper() or re.fullmatch(r"(?:[A-Z][^\s]*\s*){2,}", lines[i])) and i + 1 < len(lines)]
        for start, end in zip(starts, starts[1:] + [len(lines)]):
            item = clean(" ".join(lines[start:end]))
            if item:
                items.append(item)
    return items


def dropbox_items(value):
    blocks = re.split(r"\n\s*\n", value.replace("\r\n", "\n"))
    items = []
    for block in blocks:
        bullets = re.findall(r"(?m)^\s*[-*+]\s+(.+)$", block)
        if bullets:
            items.extend(clean(item) for item in bullets if clean(item))
        elif clean(block):
            items.append(clean(block))
    return items


def norm(value):
    return re.sub(r"[^a-z0-9]+", " ", first_80(value).lower()).strip()


# ----------------------------------------------------------------------
# Private append-only ingestion
# ----------------------------------------------------------------------

def run():
    try:
        with open(TIPS, encoding="utf-8") as src:
            existing = src.read()
    except OSError:
        existing = HEADER
    known = {norm(match) for match in re.findall(r"\*\*FPF: (.*?)\*\*", existing)}
    try:
        with open(PROCESSED, encoding="utf-8") as src:
            processed = {line.strip() for line in src if line.strip()}
    except OSError:
        processed = set()

    files = []
    if os.path.isdir(DIGESTS):
        files += [(path, True) for path in (os.path.join(DIGESTS, name) for name in sorted(os.listdir(DIGESTS)))
                  if os.path.isfile(path) and os.path.splitext(path)[1].lower() in {".eml", ".txt", ".html"}]
    if os.path.isdir(DROPBOX):
        files += [(path, False) for path in (os.path.join(DROPBOX, name) for name in sorted(os.listdir(DROPBOX)))
                  if os.path.isfile(path) and os.path.splitext(path)[1].lower() in {".md", ".txt"}]

    lines, newly_processed = [], []
    for path, is_digest in files:
        name = os.path.basename(path)
        if is_digest and name in processed:
            continue
        try:
            value = digest_text(path) if is_digest else open(path, encoding="utf-8", errors="replace").read()
            items = digest_items(value) if is_digest else dropbox_items(value)
        except Exception as exc:
            print(f"could not ingest {name}: {exc}", file=sys.stderr)
            continue
        for item in items:
            key = norm(item)
            if not key or key in known:
                continue
            known.add(key)
            lines.append(f"- [ ] **FPF: {first_80(item)}** — Front Porch Forum (PRIVATE tip line — never quote, link, or summarize publicly; verify independently) · from {name}")
        if is_digest:
            newly_processed.append(name)

    if lines:
        os.makedirs(os.path.dirname(TIPS), exist_ok=True)
        with open(TIPS, "w", encoding="utf-8") as dst:
            dst.write(existing.rstrip() + "\n" + "\n".join(lines) + "\n")
    if newly_processed:
        os.makedirs(DIGESTS, exist_ok=True)
        with open(PROCESSED, "a", encoding="utf-8") as dst:
            for name in newly_processed:
                dst.write(name + "\n")
    print(f"added {len(lines)} FPF tips; processed {len(newly_processed)} digest files")
    return 0


# ----------------------------------------------------------------------
# Built-in offline check
# ----------------------------------------------------------------------

def selftest():
    sample = """Neighborhood Cleanup\nBring gloves Saturday morning.\n\n----\n\nLOST CAT\nOrange cat last seen near the park."""
    items = digest_items(sample)
    assert len(items) == 2
    assert items[0].startswith("Neighborhood Cleanup")
    assert items[1].startswith("LOST CAT")
    assert len(first_80("word " * 30)) <= 80
    assert norm("Hello, Neighbor!") == "hello neighbor"
    print("ingest_fpf selftest passed")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)
    return selftest() if args.selftest else run()


if __name__ == "__main__":
    sys.exit(main())
