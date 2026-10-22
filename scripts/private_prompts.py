#!/usr/bin/env python3
"""Stephen's taste prompts, kept out of this public repo (2026-10-22).

wire-taste.md, wire-tags.md, tv-taste.md and weather-read.md describe his
editorial taste, so they no longer live in prompts/ here (prompts/ is now
gitignored). Where a script finds one at run time, first hit wins:

  1. GitHub Actions: an Actions secret named PROMPT_<NAME> (PROMPT_WIRE_TASTE,
     PROMPT_WIRE_TAGS, PROMPT_TV_TASTE, PROMPT_WEATHER_READ), passed to the
     step as an environment variable of the same name.
  2. Stephen's Mac: the folder in $BTOWN_PROMPTS_DIR, else
     ~/btownbrief/newsletter/allday-prompts/ (inside the private newsletter
     repo, which is the prompts' home and history).

A missing or empty prompt raises PromptMissing. Nothing runs a model with an
empty doctrine, and the workflows stop before they publish.

To change a prompt: edit the file in the private folder, then copy it into
its Actions secret (the text is never printed):
    python3 scripts/private_prompts.py --push wire-taste.md

    python3 scripts/private_prompts.py --check NAME...  exit 1 unless every one loads
    python3 scripts/private_prompts.py --push [NAME...]  local files -> Actions secrets
"""

import hashlib
import os
import subprocess
import sys

NAMES = ("wire-taste.md", "wire-tags.md", "tv-taste.md", "weather-read.md")
DEFAULT_DIR = os.path.expanduser("~/btownbrief/newsletter/allday-prompts")
REPO = "btownbrief/btown-brief"


class PromptMissing(RuntimeError):
    """A taste prompt could not be found, or was empty."""


def env_name(name):
    """wire-taste.md -> PROMPT_WIRE_TASTE"""
    stem = name[:-3] if name.endswith(".md") else name
    return "PROMPT_" + stem.upper().replace("-", "_")


def prompts_dir():
    return os.environ.get("BTOWN_PROMPTS_DIR") or DEFAULT_DIR


def _normal(text):
    # The same text whichever way it arrived (gh may trim a trailing newline)
    return text.rstrip() + "\n"


def locate(name):
    """(text, where) for a prompt, or raise PromptMissing."""
    text = os.environ.get(env_name(name)) or ""
    if text.strip():
        return _normal(text), f"${env_name(name)}"
    path = os.path.join(prompts_dir(), name)
    try:
        with open(path, encoding="utf-8") as src:
            text = src.read()
    except OSError:
        text = ""
    if text.strip():
        return _normal(text), path
    raise PromptMissing(
        f"the private prompt {name} is missing or empty: no ${env_name(name)} "
        f"(the Actions secret) and nothing readable at {path}. Refusing to run "
        f"without it; the last published data stays up. Fix: on Stephen's Mac, "
        f"python3 scripts/private_prompts.py --push {name}")


def load(name):
    return locate(name)[0]


def fingerprint(text):
    """A short hash, safe to print: it proves two copies match, reveals nothing."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def check(names):
    bad = 0
    for name in names:
        try:
            text, where = locate(name)
        except PromptMissing as exc:
            print(f"::error::{exc}")
            bad += 1
            continue
        print(f"{name}: {len(text)} chars, sha256 {fingerprint(text)}, from {where}")
    return 1 if bad else 0


def push(names):
    bad = 0
    for name in names:
        path = os.path.join(prompts_dir(), name)
        try:
            with open(path, encoding="utf-8") as src:
                text = src.read()
        except OSError:
            text = ""
        if not text.strip():
            print(f"{path} is missing or empty; {env_name(name)} left as it was")
            bad += 1
            continue
        done = subprocess.run(["gh", "secret", "set", env_name(name), "-R", REPO],
                              input=_normal(text), text=True,
                              stdout=subprocess.DEVNULL)
        if done.returncode:
            print(f"could not set {env_name(name)} (gh exit {done.returncode})")
            bad += 1
        else:
            print(f"{env_name(name)} <- {name} ({len(text)} chars, "
                  f"sha256 {fingerprint(_normal(text))})")
    return 1 if bad else 0


def main(argv):
    if len(argv) < 1 or argv[0] not in ("--check", "--push"):
        print(__doc__)
        return 2
    names = argv[1:] or list(NAMES)
    unknown = [n for n in names if n not in NAMES]
    if unknown:
        print(f"unknown prompt(s): {', '.join(unknown)}; known: {', '.join(NAMES)}")
        return 2
    return check(names) if argv[0] == "--check" else push(names)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
