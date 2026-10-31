-- All Day: the town's answers, on Stay Awhile's table (btb_sa_answers), so its
-- report button, auto-hide and admin.html moderate them too. Rank What You
-- Know's ballots gain a last-answered time, so its blocks can rise.
-- Additive and safe to re-run. Applied 2026-10-31.
--
-- Question ids: q### Stay Awhile, tt### Talk's deck, bd### Stephen's board
-- prompts (data/board-prompts.json), n<12 hex> a Wire story's question.

CREATE OR REPLACE FUNCTION public.btb_sa_submit(p_qid text, p_name text, p_body text, p_voter text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_body   text;
  v_name   text;
  v_recent int;
  v_id     uuid;
begin
  -- Shape checks. Anything malformed is a client bug or someone poking.
  if p_qid  is null or p_qid  !~ '^(q[0-9]{3,4}|tt[0-9]{3,4}|bd[0-9]{3,4}|n[0-9a-f]{12})$' then
    raise exception 'bad question id';
  end if;
  if p_voter is null or length(p_voter) not between 8 and 64 then
    raise exception 'bad voter';
  end if;

  -- Collapse whitespace, strip control characters, cap the length.
  v_body := btrim(regexp_replace(coalesce(p_body, ''), '[[:cntrl:]]+', ' ', 'g'));
  v_body := regexp_replace(v_body, '\s{2,}', ' ', 'g');
  if length(v_body) < 2   then raise exception 'too short'; end if;
  if length(v_body) > 600 then v_body := left(v_body, 600); end if;

  v_name := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]+', '', 'g'));
  v_name := nullif(left(v_name, 24), '');

  -- A blunt slur filter. Not a content policy — just the floor. Anything
  -- subtler is what the report button and admin.html are for.
  if v_body ~* '(n[i1]gg|f[a4]gg|k[i1]ke|sp[i1]c\M|tr[a4]nny|c[o0]on\M|retard)' then
    raise exception 'rejected';
  end if;

  -- Rate limit: five answers a minute, thirty an hour, per browser.
  select count(*) into v_recent
  from btb_sa_answers
  where voter = p_voter and created_at > now() - interval '1 minute';
  if v_recent >= 5 then raise exception 'slow down'; end if;

  select count(*) into v_recent
  from btb_sa_answers
  where voter = p_voter and created_at > now() - interval '1 hour';
  if v_recent >= 30 then raise exception 'slow down'; end if;

  -- Don't let the same browser post the same answer twice to one question.
  if exists (
    select 1 from btb_sa_answers
    where qid = p_qid and voter = p_voter and body = v_body
  ) then
    raise exception 'duplicate';
  end if;

  insert into btb_sa_answers (qid, name, body, voter)
  values (p_qid, v_name, v_body, p_voter)
  returning id into v_id;

  return v_id;
end $function$;

-- Everything the town has said, newest first (Stay Awhile's answers.html too).
drop function if exists public.btb_sa_feed(int);
create function public.btb_sa_feed(p_limit int default 1000)
returns table (qid text, id uuid, name text, body text, hearts int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.qid, a.id, a.name, a.body, a.hearts, a.created_at
  from btb_sa_answers a
  where a.status = 'visible'
  order by a.created_at desc
  limit least(coalesce(p_limit, 1000), 2000);
$$;
grant execute on function public.btb_sa_feed(int) to anon, authenticated;

-- Which questions have answers, how many, and when the last one landed.
create or replace function public.btb_sa_activity()
returns table (qid text, n int, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.qid, count(*)::int, max(a.created_at)
  from btb_sa_answers a
  where a.status = 'visible'
  group by a.qid
  order by max(a.created_at) desc
  limit 500;
$$;
grant execute on function public.btb_sa_activity() to anon, authenticated;

-- Each ranking's ballots and when the last one landed.
create or replace function public.rank_activity()
returns table (category_month text, ballots int, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.category_month, count(*)::int, max(b.updated_at)
  from rank_ballots b
  group by b.category_month
  order by max(b.updated_at) desc;
$$;
grant execute on function public.rank_activity() to anon, authenticated;
