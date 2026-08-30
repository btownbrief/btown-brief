-- ============================================================
-- THE JAR, PART 2 — email me when someone puts something in it
--
-- Run AFTER db/jar.sql, in the SQL Editor of the shared project
-- (jnouvwxomrcffqwilqkq).
--
-- ⚠️ EDIT ONE LINE: the `re_...` placeholder in STEP 2. That is your
-- Resend key. It is deliberately NOT in this file — btown-brief is a
-- public repo — so it goes into Supabase's own Vault instead, where it
-- is encrypted at rest and never appears in a table anyone can select.
--
-- WHY A TRIGGER AND NOT AN EDGE FUNCTION. The other apps here notify
-- through a deployed function (wp-notify, uf-notify, st-notify) because
-- they need to read private columns and decide who to write to. This one
-- has exactly one recipient and one sentence to say, so it can happen in
-- the database: no CLI, no deploy, no second thing to keep alive.
--
-- The send is ASYNCHRONOUS (pg_net queues it and returns immediately) and
-- wrapped so that any failure is swallowed. A suggestion being SAVED must
-- never depend on an email going out — Resend having a bad afternoon is
-- not a reason to lose someone's note.
-- ============================================================

-- ------------------------------------------------- step 1: the plumbing

-- pg_net does the outbound HTTP. Supabase ships it; this just switches
-- it on for this project if it is not already.
create extension if not exists pg_net with schema extensions;


-- ------------------------------------------------ step 2: the key

-- Replace re_xxxxxxxxxxxxxxxx with your Resend key, then run this line.
-- Re-running it with a new key is how you rotate: delete first, recreate.
--   delete from vault.secrets where name = 'resend_api_key';
select vault.create_secret(
  're_xxxxxxxxxxxxxxxx',
  'resend_api_key',
  'Resend, for jar notifications'
);


-- --------------------------------------------- step 3: the notification

create or replace function ad_suggest_notify() returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  api_key text;
  body_text text;
begin
  select decrypted_secret into api_key
    from vault.decrypted_secrets
   where name = 'resend_api_key';
  if api_key is null then
    return new;   -- no key configured: saving still works, quietly
  end if;

  body_text :=
    coalesce(nullif(new.tab, ''), 'somewhere') || E' tab\n\n' ||
    new.body || E'\n\n' ||
    case when new.who <> '' then '— ' || new.who || E'\n\n' else '' end ||
    'Read the rest:' || E'\n' ||
    'https://supabase.com/dashboard/project/jnouvwxomrcffqwilqkq/editor';

  -- fire and forget. net.http_post queues the request and returns an id;
  -- it does not wait for Resend, and nothing here blocks the insert.
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || api_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', 'The Jar <hello@btownbrief.com>',
      'to', jsonb_build_array('stephenvdavis@gmail.com'),
      -- the first words of the suggestion, so the inbox line is the thing
      -- itself rather than a notice that a thing exists
      'subject', 'Jar: ' || left(regexp_replace(new.body, E'\\s+', ' ', 'g'), 60),
      'text', body_text
    ),
    timeout_milliseconds := 4000
  );
  return new;
exception when others then
  -- a broken notification must never cost a suggestion
  return new;
end;
$$;

drop trigger if exists ad_suggest_notify_t on ad_suggestions;
create trigger ad_suggest_notify_t
  after insert on ad_suggestions
  for each row execute function ad_suggest_notify();


-- ------------------------------------------------------ step 4: test it

-- Run this and you should have an email within a few seconds. It also
-- leaves a real row, so delete it after.
--
--   select ad_suggest('Testing the jar notification.', 'Stephen', 'music', 'test');
--   delete from ad_suggestions where sender = 'test';
--
-- Nothing arrived? pg_net records every attempt — this shows what Resend
-- actually said:
--
--   select created, status_code, content
--     from net._http_response order by created desc limit 5;
--
-- A 403 there usually means the from-address domain is not verified in
-- Resend; a 401 means the key in the Vault is wrong.


-- --------------------------------------------------- turning it off

-- Suggestions keep saving; you just stop hearing about them.
--   drop trigger if exists ad_suggest_notify_t on ad_suggestions;
