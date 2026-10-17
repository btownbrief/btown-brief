-- Seed data for the Habits tab's sz_ tables: one live season, three pods,
-- twelve members with goals, habits and two weeks of taps.
--
-- FOR THE LOCAL TEST DATABASE ONLY (scripts/test-sz-sql.sh applies it).
-- Never paste this into the live Supabase project: it makes twelve pretend
-- accounts in auth.users. It is safe to run twice; nothing is duplicated.
--
-- Everything is dated from today in Burlington, so "two weeks of taps" is
-- always the two weeks up to today, whenever it runs. The tap pattern is a
-- fixed arithmetic one, so a run is the same every time.
--
-- The people (all invented), by pod:
--   Pod A, creative   Maya, Sam, Priya, Theo
--   Pod B, fitness    Kim, Lee, Ana, Ben
--   Pod C, business   Cal, Dev, Eva, Finn
-- Maya has one private and one shared habit of her own: the test proves
-- Sam (her podmate) sees only the shared one, and Kim (pod B) sees neither.

begin;

insert into auth.users (id, email) values
  ('51000000-0000-4000-8000-000000000001', 'maya@example.com'),
  ('51000000-0000-4000-8000-000000000002', 'sam@example.com'),
  ('51000000-0000-4000-8000-000000000003', 'priya@example.com'),
  ('51000000-0000-4000-8000-000000000004', 'theo@example.com'),
  ('51000000-0000-4000-8000-000000000005', 'kim@example.com'),
  ('51000000-0000-4000-8000-000000000006', 'lee@example.com'),
  ('51000000-0000-4000-8000-000000000007', 'ana@example.com'),
  ('51000000-0000-4000-8000-000000000008', 'ben@example.com'),
  ('51000000-0000-4000-8000-000000000009', 'cal@example.com'),
  ('51000000-0000-4000-8000-00000000000a', 'dev@example.com'),
  ('51000000-0000-4000-8000-00000000000b', 'eva@example.com'),
  ('51000000-0000-4000-8000-00000000000c', 'finn@example.com')
on conflict (id) do nothing;

-- Season 0, live: kicked off two weeks ago at 6 pm, the party eight weeks on.
insert into public.sz_seasons (id, city, name, signup_opens, kickoff_at, midway_at, party_at, stripe_link,
  luma_kickoff, luma_midway, luma_party, status)
select '52000000-0000-4000-8000-000000000000', 'burlington', 'Season 0',
  k - interval '21 days', k, k + interval '28 days', k + interval '56 days', null,
  'https://lu.ma/example-kickoff', 'https://lu.ma/example-midway', 'https://lu.ma/example-party', 'live'
from (select ((public.sz_today() - 14)::timestamp + time '18:00') at time zone 'America/New_York' as k) s
on conflict (id) do nothing;

insert into public.sz_events (id, season_id, type, starts_at, venue, luma_url)
select e.id::uuid, s.id, e.type, s.kickoff_at + e.off, e.venue, e.url
from public.sz_seasons s,
  (values ('53000000-0000-4000-8000-000000000001', 'kickoff', interval '0 days', 'Foam Brewers', 'https://lu.ma/example-kickoff'),
          ('53000000-0000-4000-8000-000000000002', 'midway', interval '28 days', 'Burlington Beer Co.', 'https://lu.ma/example-midway'),
          ('53000000-0000-4000-8000-000000000003', 'party', interval '56 days', 'The Old Gold', 'https://lu.ma/example-party')) as e(id, type, off, venue, url)
where s.id = '52000000-0000-4000-8000-000000000000'
on conflict (id) do nothing;

insert into public.sz_pods (id, season_id, category, captain_user_id, chat_url, meets_on) values
  ('54000000-0000-4000-8000-00000000000a', '52000000-0000-4000-8000-000000000000', 'creative', '51000000-0000-4000-8000-000000000001', 'https://chat.whatsapp.com/example-a', 'Tuesdays, 7 pm, Radio Bean'),
  ('54000000-0000-4000-8000-00000000000b', '52000000-0000-4000-8000-000000000000', 'fitness',  '51000000-0000-4000-8000-000000000005', 'https://chat.whatsapp.com/example-b', 'Saturdays, 8 am, Oakledge'),
  ('54000000-0000-4000-8000-00000000000c', '52000000-0000-4000-8000-000000000000', 'business', '51000000-0000-4000-8000-000000000009', 'https://chat.whatsapp.com/example-c', 'Thursdays, noon, Hen of the Wood')
on conflict (id) do nothing;

-- The twelve: name, phone, pod, goal, finish line, proof, category, goal
-- habit and its frequency.
create temporary table sz_seed_people (i int, uid uuid, name text, pod char, goal text, finish text, proof text,
  cat text, habit text, freq text, n int) on commit drop;
insert into sz_seed_people values
  (1,  '51000000-0000-4000-8000-000000000001', 'Maya',  'a', 'Finish the screenplay draft', '110 pages, printed', 'The printed draft', 'creative', 'Write 300 words', 'weekdays', null),
  (2,  '51000000-0000-4000-8000-000000000002', 'Sam',   'a', 'Record a five-song EP', 'Five songs on Bandcamp', 'Play one live', 'creative', 'Practice guitar', 'daily', null),
  (3,  '51000000-0000-4000-8000-000000000003', 'Priya', 'a', 'Paint twelve linocuts', 'Twelve prints framed', 'The twelve prints', 'creative', 'Carve for an hour', 'n_per_week', 4),
  (4,  '51000000-0000-4000-8000-000000000004', 'Theo',  'a', 'Write a zine about the Old North End', '24 pages, 50 copies', 'A copy for everyone', 'creative', 'Draft one page', 'weekdays', null),
  (5,  '51000000-0000-4000-8000-000000000005', 'Kim',   'b', 'Run the Vermont City Marathon relay leg', 'A 10K in under 55 minutes', 'The race result', 'fitness', 'Run', 'n_per_week', 3),
  (6,  '51000000-0000-4000-8000-000000000006', 'Lee',   'b', 'Ten pull-ups', 'Ten in a row on video', 'The video', 'fitness', 'Hang and pull', 'daily', null),
  (7,  '51000000-0000-4000-8000-000000000007', 'Ana',   'b', 'Swim a mile', 'A mile at the Y without stopping', 'The lap count', 'fitness', 'Swim', 'n_per_week', 3),
  (8,  '51000000-0000-4000-8000-000000000008', 'Ben',   'b', 'Climb a V4', 'A V4 at Petra Cliffs', 'The send, on video', 'fitness', 'Climb', 'n_per_week', 2),
  (9,  '51000000-0000-4000-8000-000000000009', 'Cal',   'c', 'Launch the bike repair site', 'Live, with booking', 'The first booking', 'business', 'Ship one thing', 'weekdays', null),
  (10, '51000000-0000-4000-8000-00000000000a', 'Dev',   'c', 'Ten paying customers for the bakery box', 'Ten subscriptions', 'The tenth order', 'business', 'Call one customer', 'weekdays', null),
  (11, '51000000-0000-4000-8000-00000000000b', 'Eva',   'c', 'Finish the grant application', 'Submitted', 'The confirmation email', 'business', 'Write for 45 minutes', 'daily', null),
  (12, '51000000-0000-4000-8000-00000000000c', 'Finn',  'c', 'Open the Etsy shop', 'Twenty listings live', 'The shop page', 'business', 'List one item', 'daily', null);

insert into public.sz_members (user_id, name, phone, city, pod_id)
select uid, name, '802-555-01' || lpad(i::text, 2, '0'), 'burlington', ('54000000-0000-4000-8000-00000000000' || pod)::uuid
from sz_seed_people
on conflict (user_id) do nothing;

insert into public.sz_goals (id, user_id, season_id, text, finish_line, proof, category, paid, locked_at)
select ('55000000-0000-4000-8000-0000000000' || lpad(to_hex(i), 2, '0'))::uuid, uid, '52000000-0000-4000-8000-000000000000',
  goal, finish, proof, cat, true, (select kickoff_at from public.sz_seasons where id = '52000000-0000-4000-8000-000000000000')
from sz_seed_people
on conflict (id) do nothing;

-- The goal habit: one per goal.
insert into public.sz_habits (id, user_id, goal_id, text, frequency, n, is_goal, shared, position, created_at)
select ('56000000-0000-4000-8000-0000000000' || lpad(to_hex(i), 2, '0'))::uuid, uid,
  ('55000000-0000-4000-8000-0000000000' || lpad(to_hex(i), 2, '0'))::uuid, habit, freq, n, true, false, 0, now() - interval '15 days'
from sz_seed_people
on conflict (id) do nothing;

-- Habits of their own: everyone has "Read" (private); every other person
-- also has "Walk" (shared with the pod); Maya has both, plus nothing else.
insert into public.sz_habits (id, user_id, text, frequency, n, shared, position, created_at)
select ('57000000-0000-4000-8000-0000000001' || lpad(to_hex(i), 2, '0'))::uuid, uid, 'Read twenty pages', 'daily', null, false, 1, now() - interval '15 days'
from sz_seed_people
on conflict (id) do nothing;
insert into public.sz_habits (id, user_id, text, frequency, n, shared, position, created_at)
select ('57000000-0000-4000-8000-0000000002' || lpad(to_hex(i), 2, '0'))::uuid, uid, 'Walk to work', 'weekdays', null, true, 2, now() - interval '15 days'
from sz_seed_people where i % 2 = 1
on conflict (id) do nothing;

-- Two weeks of taps, today included, on a fixed pattern: most days, not all.
insert into public.sz_taps (habit_id, user_id, date, source)
select h.id, h.user_id, public.sz_today() - d, case when d % 4 = 1 then 'email' else 'app' end
from public.sz_habits h
join sz_seed_people p on p.uid = h.user_id
cross join generate_series(0, 13) as d
where h.archived_at is null
  and (p.i * 7 + d * 3 + h.position) % 5 <> 0
  and not (h.frequency = 'weekdays' and extract(isodow from public.sz_today() - d) >= 6)
on conflict (habit_id, date) do nothing;

commit;
