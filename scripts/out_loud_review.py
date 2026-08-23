#!/usr/bin/env python3
"""Render the Btown Out Loud script-review checklist.

Same pattern as the newsletter curation checklist: one HTML page, every story
PRE-CHECKED, Stephen unchecks rejects, edits text inline, and copies the result
back. Nothing reaches data/out-loud.json until it has been through this page
and scripts/out_loud_merge.py.

Usage:
  python3 scripts/out_loud_review.py drafts/*.json -o /tmp/out-loud-review.html
  open /tmp/out-loud-review.html

Input: one or more JSON files shaped {"batch": "A", "pins": [ {...} ]} (the
research-agent output) or {"pins": [...]} with the pin schema used in
data/out-loud.json. Output: a self-contained HTML page.
"""
import argparse
import html
import json
import sys
from pathlib import Path


def load_pins(paths):
    pins = []
    for p in paths:
        with open(p, encoding="utf-8") as fh:
            d = json.load(fh)
        for pin in d.get("pins", []):
            pin.setdefault("_batch", d.get("batch", Path(p).stem))
            pins.append(pin)
    return pins


def words(s):
    return len((s or "").split())


def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)


CSS = """
:root{--bg:#F7F7F4;--ink:#13212B;--ink2:#4A5A63;--mute:#7A8890;--line:#D7DDDD;--card:#fff;--acc:#D2711A;--good:#2F7A4A;--bad:#A83A32;--warn:#FBEBDA}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.wrap{max-width:880px;margin:0 auto;padding:28px 18px 120px}h1{font-size:1.8rem;margin:0 0 4px}.sub{color:var(--ink2);margin:0 0 18px}
.bar{position:sticky;top:0;background:var(--bg);padding:10px 0;border-bottom:1px solid var(--line);display:flex;gap:10px;flex-wrap:wrap;align-items:center;z-index:5}
.bar button{font:600 14px/1 inherit;padding:10px 14px;border-radius:999px;border:1px solid var(--line);background:#fff;cursor:pointer}.bar .pri{background:var(--ink);color:#fff;border-color:var(--ink)}
.count{color:var(--mute);font-size:14px;margin-left:auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:14px 0}.card.off{opacity:.55}
.head{display:flex;gap:12px;align-items:flex-start}.head input{width:22px;height:22px;margin-top:4px;accent-color:var(--acc)}
.head h2{font-size:1.2rem;margin:0}.meta{color:var(--mute);font-size:13px;margin:2px 0 0}.meta b{color:var(--ink2)}
.stand{font-size:14px;color:var(--ink2);margin:8px 0 0}
textarea{width:100%;font:15px/1.55 Georgia,serif;color:var(--ink);background:#FCFCFA;border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-top:10px;resize:vertical;min-height:150px}
input.field{font:14px inherit;width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 10px;margin-top:6px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.wc{font-size:12px;color:var(--mute);margin-top:4px}.wc.bad{color:var(--bad);font-weight:600}
details{margin-top:10px;font-size:14px}summary{cursor:pointer;color:var(--ink2);font-weight:600}
.src li{margin:3px 0}.src a{color:#2B6A7A}.claims{font-size:13px;color:var(--ink2)}.claims li{margin:2px 0}
.notes{background:var(--warn);border-radius:8px;padding:8px 12px;font-size:14px;margin-top:10px}.notes b{color:#8A4B0F}
.coord{font-family:ui-monospace,Menlo,monospace;font-size:13px}.conf-low{color:var(--bad);font-weight:600}.conf-medium{color:#8A4B0F}
.out{white-space:pre-wrap;font:12px/1.4 ui-monospace,Menlo,monospace;background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px;max-height:40vh;overflow:auto;margin-top:10px}
.tts{font:600 13px/1 inherit;padding:7px 11px;border-radius:999px;border:1px solid var(--line);background:#fff;cursor:pointer;margin-top:8px}
"""

JS = """
(function(){
  var KEY='btown-out-loud-review-v1';
  function collect(){var out=[];document.querySelectorAll('.card').forEach(function(c){var id=c.dataset.id;var on=c.querySelector('.keep').checked;out.push({id:id,keep:on,title:c.querySelector('.f-title').value,tease:c.querySelector('.f-tease').value,stand_at:c.querySelector('.f-stand').value,lat:parseFloat(c.querySelector('.f-lat').value),lng:parseFloat(c.querySelector('.f-lng').value),radius_m:parseInt(c.querySelector('.f-radius').value,10),script:c.querySelector('.f-script').value,note:c.querySelector('.f-note').value});});return out;}
  function save(){try{localStorage.setItem(KEY,JSON.stringify(collect()));}catch(e){}update();}
  function restore(){var s;try{s=JSON.parse(localStorage.getItem(KEY)||'null');}catch(e){}if(!s)return;s.forEach(function(r){var c=document.querySelector('.card[data-id="'+CSS.escape(r.id)+'"]');if(!c)return;c.querySelector('.keep').checked=r.keep;['title','tease','stand','lat','lng','radius','script','note'].forEach(function(k){var el=c.querySelector('.f-'+k);var v=r[k==='stand'?'stand_at':k==='radius'?'radius_m':k];if(el&&v!=null&&v===v)el.value=v;});});update();}
  function update(){var n=0,t=0;document.querySelectorAll('.card').forEach(function(c){t++;var on=c.querySelector('.keep').checked;c.classList.toggle('off',!on);if(on)n++;var ta=c.querySelector('.f-script');var w=ta.value.trim().split(/\\s+/).filter(Boolean).length;var wc=c.querySelector('.wc');wc.textContent=w+' words ≈ '+Math.round(w/150*60)+' s';wc.classList.toggle('bad',w<240||w>420);});document.getElementById('count').textContent=n+' of '+t+' approved';}
  document.addEventListener('input',save);document.addEventListener('change',save);
  document.getElementById('copy').addEventListener('click',function(){var out=collect();var txt=JSON.stringify({reviewed:new Date().toISOString(),decisions:out},null,1);document.getElementById('out').textContent=txt;document.getElementById('out').hidden=false;if(navigator.clipboard)navigator.clipboard.writeText(txt).then(function(){document.getElementById('copy').textContent='Copied — paste to Claude';});});
  document.getElementById('all').addEventListener('click',function(){document.querySelectorAll('.keep').forEach(function(k){k.checked=true;});save();});
  document.getElementById('none').addEventListener('click',function(){document.querySelectorAll('.keep').forEach(function(k){k.checked=false;});save();});
  document.querySelectorAll('.tts').forEach(function(b){b.addEventListener('click',function(){if(!('speechSynthesis' in window))return;speechSynthesis.cancel();var c=b.closest('.card');var u=new SpeechSynthesisUtterance(c.querySelector('.f-script').value);u.rate=0.98;speechSynthesis.speak(u);});});
  restore();update();
})();
"""


def render(pins, title):
    parts = [f"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>{esc(title)}</title><style>{CSS}</style></head><body><div class='wrap'>"]
    parts.append(f"<h1>{esc(title)}</h1><p class='sub'>Every story starts approved. Uncheck the ones that don't survive (dates, provenance, tone). Edit anything inline — the script box is what gets recorded. Tap <b>Listen</b> to hear it in your browser's voice. When you're done, <b>Copy decisions</b> and paste the result back to Claude. Your edits save in this browser as you go.</p>")
    parts.append("<div class='bar'><button class='pri' id='copy'>Copy decisions</button><button id='all'>Check all</button><button id='none'>Uncheck all</button><span class='count' id='count'></span></div>")
    for p in pins:
        srcs = "".join(f"<li><a href='{esc(s.get('url'))}' target='_blank' rel='noopener'>{esc(s.get('label'))}</a> — {esc(s.get('supports',''))}</li>" for s in p.get("sources", []))
        claims = "".join(f"<li>{esc(c.get('claim') if isinstance(c, dict) else c)}{(' → source ' + esc(c.get('source'))) if isinstance(c, dict) and c.get('source') is not None else ''}</li>" for c in p.get("claims", []))
        notes = p.get("review_notes")
        if isinstance(notes, list):
            notes = " · ".join(str(n) for n in notes)
        conf = p.get("coord_confidence", "")
        parts.append(f"""
<section class='card' data-id='{esc(p.get('id'))}'>
  <div class='head'><input type='checkbox' class='keep' checked aria-label='Approve {esc(p.get('title'))}'>
    <div style='flex:1'>
      <h2><input class='field f-title' value='{esc(p.get('title'))}'></h2>
      <p class='meta'>batch <b>{esc(p.get('_batch'))}</b> · id <b>{esc(p.get('id'))}</b> · hood <b>{esc(p.get('hood'))}</b> · coords <span class='coord'>{esc(p.get('lat'))}, {esc(p.get('lng'))}</span> <span class='conf-{esc(conf)}'>({esc(conf)} confidence)</span> · <a href='https://www.openstreetmap.org/?mlat={esc(p.get('lat'))}&mlon={esc(p.get('lng'))}#map=19/{esc(p.get('lat'))}/{esc(p.get('lng'))}' target='_blank' rel='noopener'>check on map</a></p>
    </div></div>
  <div class='row'><div><label class='meta'>Tease</label><input class='field f-tease' value='{esc(p.get('tease'))}'></div><div><label class='meta'>Stand at</label><input class='field f-stand' value='{esc(p.get('stand_at'))}'></div></div>
  <div class='row' style='grid-template-columns:1fr 1fr 1fr'><div><label class='meta'>Lat</label><input class='field f-lat' value='{esc(p.get('lat'))}'></div><div><label class='meta'>Lng</label><input class='field f-lng' value='{esc(p.get('lng'))}'></div><div><label class='meta'>Radius (m)</label><input class='field f-radius' value='{esc(p.get('radius_m', 70))}'></div></div>
  <textarea class='f-script' spellcheck='true'>{esc(p.get('script'))}</textarea>
  <div class='wc'></div>
  <button class='tts' type='button'>▶ Listen (browser voice)</button>
  {f"<div class='notes'><b>Review notes:</b> {esc(notes)}</div>" if notes else ''}
  <details><summary>Sources ({len(p.get('sources', []))})</summary><ul class='src'>{srcs or '<li>none</li>'}</ul></details>
  <details><summary>Claims ({len(p.get('claims', []))})</summary><ul class='claims'>{claims or '<li>none listed</li>'}</ul></details>
  <label class='meta' style='display:block;margin-top:10px'>Your note to Claude (optional)</label><input class='field f-note' placeholder='e.g. cut the second paragraph, or: the date is wrong — it was 1981'>
</section>""")
    parts.append("<pre class='out' id='out' hidden></pre></div><script>" + JS + "</script></body></html>")
    return "".join(parts)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+", help="draft JSON files")
    ap.add_argument("-o", "--out", required=True, help="output HTML path")
    ap.add_argument("--title", default="Btown Out Loud — story review")
    a = ap.parse_args()
    pins = load_pins(a.inputs)
    if not pins:
        sys.exit("no pins found")
    Path(a.out).write_text(render(pins, a.title), encoding="utf-8")
    print(f"wrote {a.out} with {len(pins)} stories")


if __name__ == "__main__":
    main()
