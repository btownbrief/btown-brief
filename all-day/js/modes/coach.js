/* coach.js — Body · Coach (wave 1, 2026-10-29). For now:

   - How I do it: Stephen's own page, data/body/how-i-do-it.md, drawn from
     its few kinds of Markdown (## heads, - lists, **bold**, paragraphs).
   - Capture: setting up a one-tap voice note (data/body/coach.json).
   - Chat: a placeholder that says the coach is coming and what it will
     do. Nothing here calls a model yet. */

import * as app from '../app.js';
import { el, esc, ICON } from '../ui.js';
import { page, data, row, para, bullets, links, tabLink, section, divider, sources } from './body-kit.js';

const KEY = 'coach';

/* Markdown, the little of it the page uses. Escaped first, then **bold**. */
const inline = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
function markdown(box, md) {
  const blocks = String(md || '').replace(/\r/g, '').split(/\n\s*\n/);
  blocks.forEach((b) => {
    const lines = b.split('\n').filter((l) => l.trim());
    if (!lines.length) return;
    if (/^# /.test(lines[0])) return;   // the page's own title is the section's
    if (/^## /.test(lines[0])) { divider(box, lines[0].slice(3).trim(), null); lines.shift(); if (!lines.length) return; }
    if (lines.every((l) => /^- /.test(l))) {
      const card = el('div', 'hb-help');
      card.appendChild(el('ul', 'hb-helpl', lines.map((l) => '<li>' + inline(l.slice(2)) + '</li>').join('')));
      box.appendChild(card);
      return;
    }
    box.appendChild(el('p', 'hb-empty', inline(lines.join(' '))));
  });
}

function drawHow(box, md) {
  section(box, 'How I do it', esc('Stephen’s list, and why'));
  const page = el('div', 'co-page');
  page.dataset.page = 'how-i-do-it';
  markdown(page, md);
  box.appendChild(page);
  links(box, [tabLink('Copy the list to Today', 'template/stephen', 'btn')]);
}

function drawCapture(box, c) {
  const cap = c.capture;
  section(box, 'Capture', esc('A voice note in one tap'));
  para(box, cap.intro);
  divider(box, cap.iphone.name, null);
  cap.iphone.steps.forEach((s, i) => box.appendChild(row({ k: 'cap-i' + i, tile: { big: i + 1, small: 'step' }, title: s })));
  divider(box, cap.android.name, null);
  cap.android.steps.forEach((s, i) => box.appendChild(row({ k: 'cap-a' + i, tile: { icon: ICON.comment }, title: s })));
  bullets(box, [cap.tip]);
  sources(box, cap.iphone.sources);
}

function drawChat(box, c) {
  const ch = c.chat;
  section(box, 'Chat', null);
  /* Habits' "coming" block, not the shell's promise: this tab is built, its chat is not */
  const p = el('div', 'hb-soon');
  p.dataset.coach = 'soon';
  p.innerHTML = '<p><b>' + esc('The coach is coming') + '</b></p><p>' + esc(ch.status) + '</p>';
  box.appendChild(p);
  bullets(box, ch.will, 'What it will do');
  para(box, ch.privacy, 'note');
  links(box, [tabLink('Your habits today', 'habits'), tabLink('Breathing timer', 'recover/breathe')]);
}

app.register(KEY, page({
  key: KEY, label: 'Coach', icon: 'comment',
  promise: 'A coach that logs what you tell it and nudges you.',
  sections: [['how', 'How I do it'], ['capture', 'Capture'], ['chat', 'Chat']],
  load: () => Promise.all([data('how-i-do-it.md'), data('coach.json')]).then(([md, c]) => ({ md, c })),
  draw(k, box, ctx) {
    if (k === 'how') drawHow(box, ctx.md);
    else if (k === 'capture') drawCapture(box, ctx.c);
    else if (k === 'chat') drawChat(box, ctx.c);
  },
}));
