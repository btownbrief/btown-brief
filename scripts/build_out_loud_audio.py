#!/usr/bin/env python3
"""Render Btown Out Loud story audio with ElevenLabs.

Reads data/out-loud.json, renders an MP3 for every enabled pin whose script
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
import struct
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "out-loud.json"
AUDIO_DIR = ROOT / "out-loud" / "audio"
SECRETS = Path.home() / ".config" / "btownbrief" / "secrets.env"
API = "https://api.elevenlabs.io/v1"
DEFAULT_VOICE = os.environ.get("ELEVENLABS_VOICE_ID") or "JBFqnCBsd6RMkjVDRZzb"  # "George" — warm narrator
MODEL = os.environ.get("ELEVENLABS_MODEL") or "eleven_multilingual_v2"
OUTPUT_FORMAT = "mp3_44100_64"


def load_secrets():
    if SECRETS.exists():
        for line in SECRETS.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    return os.environ.get("ELEVENLABS_API_KEY")


def script_hash(pin):
    h = hashlib.sha256()
    h.update((pin.get("script") or "").strip().encode("utf-8"))
    h.update(b"|" + (os.environ.get("ELEVENLABS_VOICE_ID") or DEFAULT_VOICE).encode())
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
        if data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0:
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
    a = ap.parse_args()

    api_key = load_secrets()
    if a.voice:
        os.environ["ELEVENLABS_VOICE_ID"] = a.voice
    voice_id = os.environ.get("ELEVENLABS_VOICE_ID") or DEFAULT_VOICE
    if a.list_voices:
        if not api_key:
            sys.exit("no ELEVENLABS_API_KEY")
        list_voices(api_key)
        return

    data = json.loads(DATA.read_text(encoding="utf-8"))
    pins = [p for p in data.get("pins", []) if p.get("enabled", True) and p.get("script")]
    if a.only:
        pins = [p for p in pins if p["id"] in set(a.only)]
    todo = [p for p in pins if a.force or p.get("audio_hash") != script_hash(p) or not (AUDIO_DIR / f"{p['id']}.mp3").exists()]
    chars = sum(len(p["script"]) for p in todo)
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
            audio = tts(api_key, voice_id, p["script"].strip())
        except urllib.error.HTTPError as e:
            print(f"  ✗ {p['id']}: HTTP {e.code} {e.read()[:200]!r}")
            continue
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {p['id']}: {e}")
            continue
        out.write_bytes(audio)
        p["audio"] = f"audio/{p['id']}.mp3"
        p["audio_hash"] = script_hash(p)
        p["duration_s"] = mp3_duration_seconds(out)
        ok += 1
        print(f"  ✓ {p['id']}: {len(audio)/1e6:.2f} MB, ~{p['duration_s']} s")
        DATA.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        time.sleep(0.5)
    data["voice"] = {
        "provider": "elevenlabs", "voice_id": voice_id, "model": MODEL,
        "about": "Every story is written by a person from cited sources and reviewed before it goes live — tap Where this comes from under any story. The narration is a synthetic voice (ElevenLabs); no real person recorded it.",
    }
    DATA.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"rendered {ok}/{len(todo)}; data updated")


if __name__ == "__main__":
    main()
