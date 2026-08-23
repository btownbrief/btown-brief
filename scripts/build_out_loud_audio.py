#!/usr/bin/env python3
"""Render Btown Out Loud story audio with ElevenLabs.

Reads out-loud/stories.json, renders an MP3 for every enabled pin whose script
hash differs from the stored audio_hash (so edits re-render, untouched stories
cost nothing), writes out-loud/audio/<id>.mp3, and updates audio / audio_hash /
duration_s in the data file. The API key never leaves this machine.

Setup:
  echo 'ELEVENLABS_API_KEY=sk_...' >> ~/.config/btownbrief/secrets.env
  # optional: ELEVENLABS_VOICE_ID=<voice id>  (default below is a stock narrator)

Usage:
  python3 scripts/build_out_loud_audio.py            # render what's stale
  python3 scripts/build_out_loud_audio.py --only nectars --force
  python3 scripts/build_out_loud_audio.py --list-voices
  python3 scripts/build_out_loud_audio.py --dry-run  # show what would render + cost

Format: mp3_44100_64 (mono-ish speech quality, ~1 MB per 2.5 min). Model:
eleven_multilingual_v2 (best narration quality; 1 credit per character).
"""
import argparse
import hashlib
import json
import os
import re
import struct
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "out-loud" / "stories.json"
AUDIO_DIR = ROOT / "out-loud" / "audio"
SECRETS = Path.home() / ".config" / "btownbrief" / "secrets.env"
API = "https://api.elevenlabs.io/v1"
DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL"  # "Sarah" — Stephen's pick 2026-08-23; stories.json["voice"]["voice_id"] wins once set
MODEL = os.environ.get("ELEVENLABS_MODEL") or "eleven_multilingual_v2"
OUTPUT_FORMAT = "mp3_44100_64"


# ---------- spoken-text normalizer (TTS tripwires → words) ----------
_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
         "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]


def num_words(n):
    """Integer → English words (0..999,999,999,999)."""
    n = int(n)
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("" if n % 10 == 0 else "-" + _ONES[n % 10])
    if n < 1000:
        return _ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + num_words(n % 100))
    for div, name in ((10**9, "billion"), (10**6, "million"), (10**3, "thousand")):
        if n >= div:
            rest = n % div
            return num_words(n // div) + " " + name + ("" if rest == 0 else (", " if rest >= 100 else " and ") + num_words(rest))
    return str(n)


def _money_cents(m):
    dollars = int(m.group(1).replace(",", ""))
    cents = int(m.group(2).ljust(2, "0")[:2])
    out = num_words(dollars) + (" dollar" if dollars == 1 else " dollars")
    if cents:
        out += " and " + num_words(cents) + (" cent" if cents == 1 else " cents")
    return out


def _money_decimal_scale(m):
    # "$2.4 million" → "two point four million dollars"
    whole, frac, scale = m.group(1), m.group(2), m.group(3)
    return f"{num_words(whole)} point {' '.join(_ONES[int(c)] for c in frac)} {scale} dollars"


def _plain_decimal(m):
    whole, frac = m.group(1).replace(",", ""), m.group(2)
    return f"{num_words(whole)} point {' '.join(_ONES[int(c)] for c in frac)}"


def spoken_text(script):
    """What the narrator actually reads. The transcript on screen keeps the
    original; this only rewrites the patterns ElevenLabs stumbles on:
    currency with cents ($22,185.34), scaled decimals ($2.4 million),
    bare decimals (3.5), en/em-dash ranges (1985–2016), 'No.' and '&'."""
    t = script
    t = re.sub(r"\$(\d[\d,]*)\.(\d{1,2})\s+(million|billion|thousand)\b", _money_decimal_scale, t)
    t = re.sub(r"\$(\d[\d,]*)\.(\d{1,2})\b", _money_cents, t)
    t = re.sub(r"(?<![\d$])(\d[\d,]*)\.(\d+)\b", _plain_decimal, t)
    t = re.sub(r"(\d)\s?[–—]\s?(\d)", r"\1 to \2", t)
    t = re.sub(r"\bNo\.\s?(\d)", r"number \1", t)
    t = t.replace(" & ", " and ")
    return t


def load_secrets():
    if SECRETS.exists():
        for line in SECRETS.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    return os.environ.get("ELEVENLABS_API_KEY")


def script_hash(pin, voice_id):
    h = hashlib.sha256()
    h.update(spoken_text((pin.get("script") or "").strip()).encode("utf-8"))
    h.update(b"|" + voice_id.encode())
    h.update(b"|" + MODEL.encode())
    return h.hexdigest()[:16]


def mp3_duration_seconds(path):
    """Rough duration from frame headers (MPEG-1 Layer III, CBR-ish). Good enough for a label."""
    data = path.read_bytes()
    i = 0
    if data[:3] == b"ID3":
        size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
        i = 10 + size
    bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    rates = [44100, 48000, 32000]
    total = 0.0
    n = len(data)
    while i + 4 <= n:
        if data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0 \
                and ((data[i + 1] >> 3) & 0x03) == 0x03 and ((data[i + 1] >> 1) & 0x03) == 0x01:  # MPEG-1 Layer III only
            b = (data[i + 2] >> 4) & 0x0F
            r = (data[i + 2] >> 2) & 0x03
            pad = (data[i + 2] >> 1) & 0x01
            if b == 0 or b == 15 or r == 3:
                i += 1
                continue
            br = bitrates[b] * 1000
            sr = rates[r]
            frame_len = int(144 * br / sr) + pad
            total += 1152 / sr
            i += max(frame_len, 1)
        else:
            i += 1
    return round(total)


def tts(api_key, voice_id, text):
    body = json.dumps({
        "text": text,
        "model_id": MODEL,
        "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.25, "use_speaker_boost": True},
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{API}/text-to-speech/{voice_id}?output_format={OUTPUT_FORMAT}",
        data=body, method="POST",
        headers={"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def list_voices(api_key):
    req = urllib.request.Request(f"{API}/voices", headers={"xi-api-key": api_key})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    for v in d.get("voices", []):
        labels = ", ".join(f"{k}={val}" for k, val in (v.get("labels") or {}).items())
        print(f"{v['voice_id']}  {v['name']:<18} {labels}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", action="append", help="pin id (repeatable)")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--list-voices", action="store_true")
    ap.add_argument("--voice", help="ElevenLabs voice id (overrides env/default)")
    ap.add_argument("--show-spoken", action="store_true", help="print spoken-text rewrites and exit")
    a = ap.parse_args()

    api_key = load_secrets()
    data = json.loads(DATA.read_text(encoding="utf-8"))
    # Voice precedence: --voice flag > env > what stories.json already rendered with > default.
    voice_id = a.voice or os.environ.get("ELEVENLABS_VOICE_ID") or (data.get("voice") or {}).get("voice_id") or DEFAULT_VOICE
    if a.list_voices:
        if not api_key:
            sys.exit("no ELEVENLABS_API_KEY")
        list_voices(api_key)
        return

    pins = [p for p in data.get("pins", []) if p.get("enabled", True) and p.get("script")]
    if a.show_spoken:
        for p in pins:
            sp = spoken_text(p["script"])
            if sp != p["script"]:
                import difflib
                for line in difflib.unified_diff(p["script"].split(". "), sp.split(". "), lineterm="", n=0):
                    if line.startswith(("+", "-")) and not line.startswith(("+++", "---")):
                        print(f"  {p['id']}: {line}")
        return
    if a.only:
        pins = [p for p in pins if p["id"] in set(a.only)]
    todo = [p for p in pins if a.force or p.get("audio_hash") != script_hash(p, voice_id) or not (AUDIO_DIR / f"{p['id']}.mp3").exists()]
    chars = sum(len(spoken_text(p["script"])) for p in todo)
    print(f"{len(todo)} of {len(pins)} stories need rendering — {chars:,} characters (≈ {chars:,} credits on {MODEL})")
    if a.dry_run or not todo:
        return
    if not api_key:
        sys.exit(f"no ELEVENLABS_API_KEY — add it to {SECRETS}")

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    ok = 0
    for p in todo:
        out = AUDIO_DIR / f"{p['id']}.mp3"
        try:
            audio = tts(api_key, voice_id, spoken_text(p["script"].strip()))
        except urllib.error.HTTPError as e:
            print(f"  ✗ {p['id']}: HTTP {e.code} {e.read()[:200]!r}")
            continue
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {p['id']}: {e}")
            continue
        out.write_bytes(audio)
        p["audio"] = f"audio/{p['id']}.mp3"
        p["audio_hash"] = script_hash(p, voice_id)
        p["duration_s"] = mp3_duration_seconds(out)
        ok += 1
        print(f"  ✓ {p['id']}: {len(audio)/1e6:.2f} MB, ~{p['duration_s']} s")
        DATA.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        time.sleep(0.5)
    if ok:
        all_have_audio = all(p.get("audio") for p in data.get("pins", []) if p.get("enabled", True))
        data["voice"] = {
            "provider": "elevenlabs" if all_have_audio else "mixed", "voice_id": voice_id, "model": MODEL,
            "about": ("Every story is written by a person from cited sources and reviewed before it goes live — tap Where this comes from under any story. The narration is a synthetic voice (ElevenLabs); no real person recorded it."
                      if all_have_audio else
                      "Every story is written by a person from cited sources and reviewed before it goes live — tap Where this comes from under any story. Narration is a synthetic voice (ElevenLabs); stories without a recording yet are read by your phone's built-in voice."),
        }
        DATA.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"rendered {ok}/{len(todo)}; data {'updated' if ok else 'unchanged'}")


if __name__ == "__main__":
    main()
