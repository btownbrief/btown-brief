// bd-intro — The Build's one email: the introduction after "I can help".
//
// A neighbour offers help on a Stuck post (bd_help_offer), and the poster
// taps Yes (bd_help_respond). Both have now said yes, so this function emails
// each of them once: the other's first name, the post and the offer, and
// the other's email address, with Reply-To set to the other person. That is
// the whole mechanism; after it the app gets out of the way.
//
// Nothing else ever sends: only an offer with status 'accepted' and no
// intro_sent_at, whose post is not hidden and whose two people have not
// blocked each other. Idempotent per offer: the row is claimed
// (intro_claimed_at) before sending, marked intro_sent_at after, and
// released if a send fails, so retries and two racing calls can never send
// twice. Addresses are never logged or returned.
//
// Runs with the service role (the default for edge functions). It is the
// ONLY thing in The Build that reads an email, from auth.users through the
// admin API. Same provider and key as Up For It's uf-notify (Resend,
// RESEND_API_KEY, already set on the project).
//
//   POST {"help_id":"<uuid>"}   the app's poke right after a Yes (fire and forget)
//   POST {}                     a sweep: every accepted offer from the last 14
//                               days still waiting for its email (at most 25)
//
// Deploy (from the btown-brief repo root, Supabase CLI logged in) — Stephen
// does this, see all-day/supabase/SETUP-BUILD.md part B:
//   supabase functions deploy bd-intro --no-verify-jwt --project-ref jnouvwxomrcffqwilqkq
//   supabase secrets set BD_INTRO_FROM="The Build <hello@btownbrief.com>" --project-ref jnouvwxomrcffqwilqkq
//   (optional) supabase secrets set BD_INTRO_BCC="you@…" --project-ref jnouvwxomrcffqwilqkq
// --no-verify-jwt because the browser sends the publishable key; the
// function trusts nothing from the caller beyond an id to look at.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const APP_URL = 'https://guide.btownbrief.com/all-day/#build';
const CLAIM_MINUTES = 10;   // a claim older than this was a crashed call: take it again
const SWEEP_DAYS = 14;
const SWEEP_MAX = 25;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: Record<string, unknown>) => new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } });

type Help = { id: string; post_id: string; helper_id: string; line: string };
type Post = { id: string; user_id: string; line: string; thing_id: string | null; hidden_at: string | null };
type Mail = { from: string; to: string[]; reply_to: string; subject: string; text: string; bcc?: string[] };

async function emailOf(db: SupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await db.auth.admin.getUserById(id);
  if (error || !data || !data.user) return null;
  const e = String(data.user.email || '').trim();
  return e.includes('@') ? e : null;
}
async function firstName(db: SupabaseClient, id: string): Promise<string> {
  const { data } = await db.from('bd_builder').select('first_name').eq('user_id', id).maybeSingle();
  const n = data && typeof data.first_name === 'string' ? data.first_name.trim() : '';
  return n || 'A neighbor';
}
async function blocked(db: SupabaseClient, a: string, b: string): Promise<boolean> {
  const { count } = await db.from('bd_blocks').select('id', { count: 'exact', head: true })
    .or(`and(user_id.eq.${a},blocked_id.eq.${b}),and(user_id.eq.${b},blocked_id.eq.${a})`);
  return (count || 0) > 0;
}

async function sendAll(key: string, mails: Mail[]): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(mails),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// One offer, start to finish. Returns why it did or did not send; never an address.
async function introduce(db: SupabaseClient, key: string, from: string, bcc: string | null, helpId: string): Promise<string> {
  const stale = new Date(Date.now() - CLAIM_MINUTES * 60000).toISOString();
  const { data: claimed, error } = await db.from('bd_help')
    .update({ intro_claimed_at: new Date().toISOString() })
    .eq('id', helpId).eq('status', 'accepted').is('intro_sent_at', null)
    .or(`intro_claimed_at.is.null,intro_claimed_at.lt.${stale}`)
    .select('id, post_id, helper_id, line');
  if (error) return 'error';
  const h = (claimed as Help[] | null)?.[0];
  if (!h) return 'not_due';
  const release = () => db.from('bd_help').update({ intro_claimed_at: null }).eq('id', h.id);

  const { data: postRow } = await db.from('bd_posts').select('id, user_id, line, thing_id, hidden_at').eq('id', h.post_id).maybeSingle();
  const post = postRow as Post | null;
  if (!post || post.hidden_at) { await release(); return 'post_gone'; }
  if (await blocked(db, post.user_id, h.helper_id)) { await release(); return 'blocked'; }

  const [posterEmail, helperEmail, posterName, helperName] = await Promise.all([
    emailOf(db, post.user_id), emailOf(db, h.helper_id), firstName(db, post.user_id), firstName(db, h.helper_id),
  ]);
  if (!posterEmail || !helperEmail) { await release(); return 'no_email'; }

  const sign = ['', 'If anything about this feels off, write to hello@btownbrief.com and Stephen will look.', '', 'Btown Brief'];
  const toPoster: Mail = {
    from, to: [posterEmail], reply_to: helperEmail,
    subject: `${helperName} can help with your Build post`,
    text: [
      `Hi ${posterName},`,
      '',
      `You said yes to ${helperName}'s offer on The Build.`,
      '',
      `Your Stuck post: "${post.line}"`,
      `${helperName} said: "${h.line}"`,
      '',
      `${helperName}'s email is ${helperEmail}. Reply to this email and it goes straight to them. We sent them yours too.`,
      '',
      `That's all from us. Take it from here. ${APP_URL}`,
      ...sign,
    ].join('\n'),
  };
  const toHelper: Mail = {
    from, to: [helperEmail], reply_to: posterEmail,
    subject: `${posterName} said yes to your offer`,
    text: [
      `Hi ${helperName},`,
      '',
      `${posterName} said yes to your offer to help on The Build.`,
      '',
      `Their Stuck post: "${post.line}"`,
      `You said: "${h.line}"`,
      '',
      `${posterName}'s email is ${posterEmail}. Reply to this email and it goes straight to them. We sent them yours too.`,
      '',
      `Thanks for stepping in. ${APP_URL}`,
      ...sign,
    ].join('\n'),
  };
  const mails = [toPoster, toHelper].map((m) => (bcc ? { ...m, bcc: [bcc] } : m));
  if (!(await sendAll(key, mails))) { await release(); return 'send_failed'; }
  await db.from('bd_help').update({ intro_sent_at: new Date().toISOString() }).eq('id', h.id);
  return 'sent';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const helpId = body && typeof body.help_id === 'string' ? body.help_id : null;
    if (helpId !== null && !/^[0-9a-f-]{36}$/.test(helpId)) return reply({ sent: false, why: 'bad_id' });
    const key = Deno.env.get('RESEND_API_KEY');
    if (!key) return reply({ sent: false, why: 'no_key' });
    const from = Deno.env.get('BD_INTRO_FROM') || 'The Build <hello@btownbrief.com>';
    const bccRaw = (Deno.env.get('BD_INTRO_BCC') || '').trim();
    const bcc = bccRaw.includes('@') ? bccRaw : null;
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (helpId) {
      const why = await introduce(db, key, from, bcc, helpId);
      return reply({ sent: why === 'sent', why });
    }
    const since = new Date(Date.now() - SWEEP_DAYS * 86400000).toISOString();
    const { data } = await db.from('bd_help').select('id').eq('status', 'accepted').is('intro_sent_at', null)
      .gte('decided_at', since).order('decided_at').limit(SWEEP_MAX);
    let sent = 0, skipped = 0;
    for (const row of (data as { id: string }[] | null) || []) {
      if ((await introduce(db, key, from, bcc, row.id)) === 'sent') sent++; else skipped++;
    }
    return reply({ sent: sent > 0, intros: sent, skipped });
  } catch {
    return reply({ sent: false, why: 'error' });
  }
});
