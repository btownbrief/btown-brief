/* boards-core.js — the rules every board follows, in one place.

   No DOM, no fetch, no clock: time is an argument. Three things obey these
   rules and must agree: this file (the compose sheet checks a post before it
   is sent), supabase/nn-SETUP.sql (the server checks it again, because the
   anon key is public), and js/boards-fake.js (the demo and the tests).

   The RULES object below is copied, as JSON, into nn_rules() in the SQL:
   in supabase/nn-ROUND4.sql, the newest file, which replaces the copies in
   nn-SETUP.sql (version 1) and nn-ROUND2.sql (version 2).
   scripts/test-boards-core.mjs fails if the two ever differ, and if a kind
   or field either older copy allowed is ever taken away, so a change here
   is a change there: edit RULES, run
   `node scripts/test-boards-core.mjs --write-sql`, and Stephen pastes
   nn-ROUND4.sql again.

   Vocabulary. A BOARD is one tab's shelf of reader posts (vintage, art,
   people, watch). A KIND is the sort of post on that board ("spotted",
   "swap"). META is the kind's own small fields (size, price, shop), each
   with a type the server checks (text, int, enum, bool). A post with a photo sends the picture
   through the fleet's photo queue (photos-lib.js, photo-admin.html); the
   post shows its photo only once that queue approves it. `gallery` says
   whether a board's approved photos also join the community gallery
   (photos.html): Art's do, it is the gallery's new home; a Vintage find on
   a rack does not belong there, so it is filed as category 'board', which
   the gallery leaves out (db/photos-board.sql).

   Round four (version 3) adds three boards: Games (what you're playing,
   looking for a group), the Square (the community square: posts, show and
   tell, questions, free stuff, pets) and Gatherings (reader-submitted
   events, which Stephen approves before they show). A gathering ends the
   day after its date when its `when` starts with one (2026-10-24, 7 pm),
   and after 30 days when it does not (`until` below). It also adds a
   profile's HANDLES: a reader's name on Instagram, Strava, PSN and the
   rest, each checked against its own pattern (`handles` below; never a
   link, never an @). Two new field types: `url` (a link, only on a board
   Stephen pre-moderates, since links are how spam arrives) and the `until`
   rule on a kind.

   The eight apps (2026-10-29, wave 0; the map's "new post kinds ... on the
   existing boards framework with its moderation") add seven boards and
   twelve kinds, with no new field type and nothing taken away, so the
   rules stay at version 3 and the SQL is one function (nn-APPS.sql):
     nightlife  open_tonight   Out · Nightlife · Open tonight: "my group is
                               out tonight", where, until when, spots, ages
     sports     session        Out · Sports · Pickup and Body · Together:
                               "anyone at the courts at 6?"
     stage      logged         Out · Events · Been there: a show you saw
     neighbors  borrow, free, favor, lost, found
                               People · Neighbors: the Neighbor Exchange and
                               Lost & found (pets and things)
     shifts     shift          People · Neighbors · Shifts: a nonprofit's
                               two-hour slot; Stephen looks first (a link)
     clubs      idea           People · Clubs · Start something
     streets    report         Town · Streets · Report: a pothole, a dark
                               streetlight; Stephen looks first (places)
     rescue     rescue         Eat · Market · Rescue: food left at closing
   A same-day kind lasts a day or two (`days`); a shift ends after its date
   (`until`). */

export const RULES = {
  version: 3,
  limits: {
    nameMax: 32,
    titleMax: 80,
    bodyMax: 600,
    placeMax: 80,
    metaKeysMax: 8,
    metaTextMax: 80,
    postsPerDay: 20,
    waitingMax: 5,
    reportsToHide: 2,
    reportsPerDay: 10,
    interestsMax: 8,
    weeksMax: 26,
    listDefault: 30,
    listMax: 60,
    expiredKeepDays: 7,
    deletedKeepDays: 30,
    handleMax: 40,
    aheadMaxDays: 180,
  },
  neighborhoods: ['downtown', 'old-north-end', 'new-north-end', 'south-end', 'hill', 'waterfront', 'winooski',
    'south-burlington', 'essex', 'shelburne', 'colchester', 'elsewhere'],
  archetypes: ['new', 'regular', 'trail', 'games'],
  reasons: ['spam', 'unkind', 'unsafe', 'other'],
  /* what a profile may say a reader is into: activities only, never who
     they are (the People tab's list, nn_people_rules() in nn-people.sql) */
  interests: ['sports', 'running', 'outdoors', 'games', 'music', 'dance', 'books', 'making', 'languages', 'food'],
  /* A profile's handles: the name a reader goes by elsewhere, one per
     service, each matched whole against its pattern after the spaces at
     either end are trimmed (1 to handleMax characters). Never a link (no
     slash, no colon) and never an @. handlesDeny (any case) refuses the
     common web addresses (www., .com, .net ...) a pattern with dots would
     let by; a rarer ending (.co, .me) can still pass, since real usernames
     end that way too. */
  handles: {
    instagram: '^[A-Za-z0-9._]{1,30}$',
    spotify: '^[A-Za-z0-9._-]{1,40}$',
    strava: '^[A-Za-z0-9_-]{1,40}$',
    letterboxd: '^[A-Za-z0-9_]{2,15}$',
    goodreads: '^[A-Za-z0-9_-]{1,40}$',
    beli: '^[A-Za-z0-9._]{1,30}$',
    untappd: '^[A-Za-z0-9._-]{1,40}$',
    psn: '^[A-Za-z][A-Za-z0-9_-]{2,15}$',
    xbox: '^[A-Za-z][A-Za-z0-9 ]{0,14}(#[0-9]{1,4})?$',
    steam: '^[A-Za-z0-9_-]{2,32}$',
    switch: '^SW-[0-9]{4}-[0-9]{4}-[0-9]{4}$',
    discord: '^[A-Za-z0-9_.]{2,32}$',
    epic: '^[A-Za-z0-9._ -]{3,16}$',
    riot: '^[A-Za-z0-9 ._]{3,16}#[A-Za-z0-9]{3,5}$',
    chess: '^[A-Za-z0-9_-]{2,25}$',
    linkedin: '^[A-Za-z0-9-]{3,40}$',
  },
  handlesDeny: '^www[.]|[.](com|net|org|io|gg|tv|ly|xyz|dev|app|info|biz|site|online|link|page)$',
  /* a `url` field: http(s), a host with a dot, no spaces, nothing that
     breaks out of an attribute */
  urlPattern: '^https?://[A-Za-z0-9.-]+[.][A-Za-z]{2,}(:[0-9]{1,5})?([/?#][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$',
  boards: {
    people: {
      premod: false,
      gallery: false,
      kinds: { plan: { days: 14, photo: 'none', needs: ['when'] } },
      meta: {
        when: { type: 'text', max: 60 },
        arch: { type: 'enum', values: ['new', 'regular', 'trail', 'games'] },
        spots: { type: 'int', min: 1, max: 50 },
        meetup: { type: 'bool' },
        ages: { type: 'enum', values: ['twenties', 'thirties', 'forties', 'fifties', 'any'] },
      },
    },
    vintage: {
      premod: false,
      gallery: false,
      kinds: {
        spotted: { days: 21, photo: 'optional', needs: ['shop'] },
        swap: { days: 21, photo: 'optional', needs: ['want'] },
        design: { days: null, photo: 'required', needs: ['thanks'] },
        fit: { days: 60, photo: 'required', needs: [] },
      },
      meta: {
        shop: { type: 'text', max: 60 },
        size: { type: 'text', max: 12 },
        price: { type: 'int', min: 0, max: 10000 },
        want: { type: 'text', max: 80 },
        thanks: { type: 'enum', values: ['shirts', 'credit'] },
        got: { type: 'bool' },
      },
    },
    art: {
      premod: false,
      gallery: true,
      kinds: {
        photo: { days: null, photo: 'required', needs: [] },
        art: { days: null, photo: 'required', needs: [] },
        notice: { days: 30, photo: 'none', needs: [] },
      },
      meta: {
        medium: { type: 'text', max: 40 },
        shirt: { type: 'enum', values: ['yes', 'no'] },
      },
    },
    watch: {
      premod: false,
      gallery: false,
      kinds: {
        rating: { days: null, photo: 'none', needs: ['stars'] },
        /* one_vote: a voter has one vote among a kind's live posts; voting
           for another moves it (the screening ballot) */
        pick: { days: 30, photo: 'none', needs: [], one_vote: true },
      },
      meta: {
        year: { type: 'int', min: 1888, max: 2100 },
        stars: { type: 'int', min: 1, max: 5 },
        where: { type: 'text', max: 40 },
        film: { type: 'int', min: 1, max: 99999999 },
      },
    },
    /* Games: votes on a post mean "me too" */
    games: {
      premod: false,
      gallery: false,
      kinds: {
        playing: { days: 14, photo: 'none', needs: ['game', 'platform'] },
        lfg: { days: 7, photo: 'none', needs: ['game', 'platform', 'when'] },
      },
      meta: {
        game: { type: 'text', max: 60 },
        platform: { type: 'enum', values: ['pc', 'ps5', 'xbox', 'switch', 'mobile', 'vr', 'board', 'tabletop'] },
        when: { type: 'text', max: 60 },
      },
    },
    /* the community square */
    square: {
      premod: false,
      gallery: false,
      kinds: {
        post: { days: 30, photo: 'none', needs: [] },
        show: { days: 30, photo: 'required', needs: [] },
        ask: { days: 14, photo: 'none', needs: [] },
        free: { days: 14, photo: 'optional', needs: [] },
        pets: { days: 30, photo: 'required', needs: [] },
      },
      meta: {
        topic: { type: 'enum', values: ['food', 'outdoors', 'pets', 'events', 'home', 'lost-found', 'recommend', 'other'] },
      },
    },
    /* reader-submitted events, shown once Stephen approves them. `until`:
       the post ends the day after the date its `when` field starts with
       (YYYY-MM-DD, Burlington's calendar), or after `days` when it starts
       with none. That date may be no earlier than today and no later than
       aheadMaxDays from now. */
    gatherings: {
      premod: true,
      gallery: false,
      kinds: {
        gathering: { days: 30, photo: 'optional', needs: ['when', 'place', 'kind'], until: 'when' },
      },
      meta: {
        when: { type: 'text', max: 60 },
        place: { type: 'text', max: 80 },
        link: { type: 'url', max: 200 },
        kind: { type: 'enum', values: ['pickup', 'league', 'board-games', 'run', 'social', 'music', 'other'] },
      },
    },
    /* readers' playlists for On Air (supabase/nn-PLAYLISTS.sql, which only
       replaces nn_rules() with this copy): a playlist link on Spotify,
       YouTube, Apple Music, SoundCloud, Tidal, Deezer or Amazon Music, or a Spotify profile. Links mean
       Stephen looks first (premod), and a playlist stays until its poster
       or he takes it down. The tab shows only links it recognises. */
    playlists: {
      premod: true,
      gallery: false,
      kinds: {
        playlist: { days: null, photo: 'none', needs: ['link'] },
      },
      meta: {
        link: { type: 'url', max: 200 },
      },
    },
    /* ---- the eight apps (2026-10-29) ---- */
    /* Out · Nightlife: a group that is out tonight and has room. A day, then gone. */
    nightlife: {
      premod: false,
      gallery: false,
      kinds: {
        open_tonight: { days: 1, photo: 'none', needs: ['where', 'until'] },
      },
      meta: {
        where: { type: 'text', max: 60 },
        until: { type: 'text', max: 20 },
        spots: { type: 'int', min: 1, max: 20 },
        ages: { type: 'enum', values: ['twenties', 'thirties', 'forties', 'fifties', 'any'] },
      },
    },
    /* Out · Sports (pickup) and Body · Together (a workout, a recovery
       session): who, what, where and when, for the next two days */
    sports: {
      premod: false,
      gallery: false,
      kinds: {
        session: { days: 2, photo: 'none', needs: ['sport', 'where', 'when'] },
      },
      meta: {
        sport: { type: 'enum', values: ['basketball', 'soccer', 'volleyball', 'tennis', 'pickleball', 'frisbee', 'hockey', 'run', 'ride',
          'climb', 'workout', 'yoga', 'recovery', 'other'] },
        where: { type: 'text', max: 60 },
        when: { type: 'text', max: 60 },
        spots: { type: 'int', min: 1, max: 30 },
        level: { type: 'enum', values: ['easy', 'any', 'competitive'] },
      },
    },
    /* Out · Events · Been there: the Stage Log, a show or play you saw. Kept. */
    stage: {
      premod: false,
      gallery: false,
      kinds: {
        logged: { days: null, photo: 'optional', needs: ['venue', 'date'] },
      },
      meta: {
        venue: { type: 'text', max: 60 },
        date: { type: 'text', max: 20 },
        what: { type: 'enum', values: ['show', 'play', 'comedy', 'film', 'talk', 'game', 'other'] },
        stars: { type: 'int', min: 1, max: 5 },
      },
    },
    /* People · Neighbors: borrow a ladder, give away a couch, ask an hour's
       help, a lost or found pet or thing. `got` marks it done (lent, given,
       home again). */
    neighbors: {
      premod: false,
      gallery: false,
      kinds: {
        borrow: { days: 14, photo: 'none', needs: ['item'] },
        free: { days: 14, photo: 'optional', needs: [] },
        favor: { days: 7, photo: 'none', needs: [] },
        lost: { days: 30, photo: 'optional', needs: ['what', 'seen'] },
        found: { days: 30, photo: 'optional', needs: ['what', 'seen'] },
      },
      meta: {
        item: { type: 'text', max: 60 },
        what: { type: 'enum', values: ['pet', 'keys', 'phone', 'wallet', 'bike', 'bag', 'other'] },
        seen: { type: 'text', max: 60 },
        when: { type: 'text', max: 60 },
        got: { type: 'bool' },
      },
    },
    /* People · Neighbors · Shifts: a nonprofit's slot, with its sign-up
       link, so Stephen looks first. Ends the day after its date. */
    shifts: {
      premod: true,
      gallery: false,
      kinds: {
        shift: { days: 30, photo: 'none', needs: ['org', 'when', 'hours'], until: 'when' },
      },
      meta: {
        org: { type: 'text', max: 60 },
        when: { type: 'text', max: 60 },
        hours: { type: 'int', min: 1, max: 8 },
        slots: { type: 'int', min: 1, max: 50 },
        link: { type: 'url', max: 200 },
      },
    },
    /* People · Clubs · Start something: a club or ritual someone wants;
       votes are "I'm in", and `size` is how many it needs to start */
    clubs: {
      premod: false,
      gallery: false,
      kinds: {
        idea: { days: 60, photo: 'none', needs: ['kind'] },
      },
      meta: {
        kind: { type: 'enum', values: ['sport', 'outdoors', 'music', 'books', 'food', 'games', 'making', 'social', 'learning', 'other'] },
        days: { type: 'text', max: 40 },
        size: { type: 'int', min: 2, max: 50 },
      },
    },
    /* Town · Streets · Report: a pothole or a dark streetlight on the
       public fixed-or-not map. Places and photos of streets, so Stephen
       looks first. `fixed` is the poster's (or his) tick. */
    streets: {
      premod: true,
      gallery: false,
      kinds: {
        report: { days: 90, photo: 'optional', needs: ['what', 'where'] },
      },
      meta: {
        what: { type: 'enum', values: ['pothole', 'streetlight', 'sidewalk', 'crosswalk', 'sign', 'graffiti', 'trash', 'tree', 'other'] },
        where: { type: 'text', max: 80 },
        fixed: { type: 'bool' },
      },
    },
    /* Eat · Market · Rescue: food a kitchen has left at closing, tonight */
    rescue: {
      premod: false,
      gallery: false,
      kinds: {
        rescue: { days: 1, photo: 'optional', needs: ['spot', 'until'] },
      },
      meta: {
        spot: { type: 'text', max: 60 },
        until: { type: 'text', max: 20 },
        price: { type: 'int', min: 0, max: 100 },
        portions: { type: 'int', min: 1, max: 100 },
      },
    },
  },
};

/* Words people see, keyed the same way. Not part of the server's copy. */
export const NEIGHBORHOOD_LABELS = {
  downtown: 'Downtown', 'old-north-end': 'Old North End', 'new-north-end': 'New North End', 'south-end': 'South End',
  hill: 'Hill Section / UVM', waterfront: 'Waterfront', winooski: 'Winooski', 'south-burlington': 'South Burlington',
  essex: 'Essex / Williston', shelburne: 'Shelburne', colchester: 'Colchester', elsewhere: 'Elsewhere in Chittenden',
};
export const ARCHETYPE_LABELS = { new: 'New in town', regular: 'Weeknight regular', trail: 'Trail person', games: 'Game night' };
export const REASON_LABELS = { spam: 'Spam, or not from around here', unkind: 'Rude or unkind', unsafe: 'Not safe', other: 'Something else' };
export const INTEREST_LABELS = { sports: 'Pickup sports', running: 'Running', outdoors: 'The outdoors', games: 'Games', music: 'Live music',
  dance: 'Dancing', books: 'Books', making: 'Making things', languages: 'Languages', food: 'Food and drink' };
export const BOARD_LABELS = { people: 'People', vintage: 'Vintage', art: 'Art', watch: 'Watchlist', games: 'Games', square: 'The Square', gatherings: 'Gatherings',
  playlists: 'Playlists', nightlife: 'Open tonight', sports: 'Pickup', stage: 'Been there', neighbors: 'Neighbors', shifts: 'Shifts',
  clubs: 'Start something', streets: 'Street reports', rescue: 'Food rescue' };
/* the kinds' words, for a compose sheet and the boards desk */
export const KIND_LABELS = { open_tonight: 'Open tonight', session: 'A game or a session', logged: 'Been there', borrow: 'Borrow', free: 'Free',
  favor: 'A favor', lost: 'Lost', found: 'Found', shift: 'A shift', idea: 'Start something', report: 'Report', rescue: 'Food to rescue' };
export const HANDLE_LABELS = {
  instagram: 'Instagram', spotify: 'Spotify', strava: 'Strava', letterboxd: 'Letterboxd', goodreads: 'Goodreads', beli: 'Beli',
  untappd: 'Untappd', psn: 'PlayStation', xbox: 'Xbox', steam: 'Steam', switch: 'Switch', discord: 'Discord', epic: 'Epic',
  riot: 'Riot ID', chess: 'Chess', linkedin: 'LinkedIn',
};
/* how the profile sheet groups them; every handle kind is in exactly one */
export const HANDLE_GROUPS = [
  ['Social', ['instagram', 'spotify', 'letterboxd', 'goodreads', 'beli', 'untappd', 'linkedin']],
  ['Fitness', ['strava']],
  ['Games', ['psn', 'xbox', 'steam', 'switch', 'discord', 'epic', 'riot', 'chess']],
];
/* what each box expects, as a placeholder */
export const HANDLE_HINTS = { switch: 'SW-1234-5678-9012', riot: 'name#tag', xbox: 'Gamertag', chess: 'chess.com or lichess name', psn: 'Online ID' };

/* Every refusal is a short code, the same from the server, the fake and the
   checks below. message() turns one into a sentence a reader can act on. */
export const MESSAGES = {
  not_signed_in: 'Sign in first. It’s in Settings, and it takes one email.',
  no_name: 'Add your first name before you post. Neighbors see it on your post.',
  bad_name: 'A first name, up to 32 characters, with no @ in it.',
  bad_neighborhood: 'Pick a neighborhood from the list, or none.',
  bad_archetype: 'Pick one of the four, or none.',
  bad_interest: 'Pick what you’re into from the list, eight at most.',
  bad_handle: 'One of your handles isn’t right. Just the name, with no link and no @.',
  bad_date: 'Start “when” with a real date, from today to six months out (2026-10-24).',
  bad_board: 'That board isn’t open.',
  bad_kind: 'That kind of post isn’t open on this board.',
  bad_title: 'A title, up to 80 characters.',
  bad_body: 'Keep it under 600 characters.',
  bad_place: 'Keep the place under 80 characters.',
  bad_meta: 'One of the details isn’t right. Check the fields and try again.',
  needs_meta: 'Fill in the required details first.',
  no_consent: 'Tick the box first: we only show photos you took and said we could use.',
  bad_photo: 'That photo didn’t go through. Try another one.',
  photo_required: 'This one needs a photo.',
  photo_not_allowed: 'This kind of post doesn’t take a photo.',
  rate_day: 'That’s 20 posts today. Try again tomorrow.',
  rate_waiting: 'You have 5 posts waiting for a look. Give those a day first.',
  banned: 'Posting is switched off for this account.',
  not_found: 'That post has gone.',
  own_post: 'You can’t report your own post. Delete it instead.',
  already_reported: 'You’ve already reported this one. Thanks.',
  rate_reports: 'That’s a lot of reports today. Thanks; we’ll take it from here.',
  bad_reason: 'Pick a reason.',
  bad_voter: 'Couldn’t count that vote.',
  off: 'Posting is coming soon.',
  offline: 'Couldn’t reach the boards. Try again in a moment.',
};
export const message = (code) => MESSAGES[code] || MESSAGES.offline;

/* ---------------------------------------------------------------- text */
/* The server runs the same three steps with regexp_replace, in this order:
   drop control characters, drop links, squeeze the spaces. A post is plain
   words; links in a reader post are how spam arrives. */
const CONTROL = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const LINKS = /https?:\/\/\S+|www\.\S+/gi;

export function clean(s, multiline) {
  let t = String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(LINKS, '');
  t = multiline ? t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n') : t.replace(/\s+/g, ' ');
  return t.trim();
}
/* Lengths in characters as a person counts them (an emoji is one), which is
   what Postgres's char_length counts too. */
export const len = (s) => [...String(s)].length;

/* -------------------------------------------------------------- profile */
export function checkProfile(rules, input) {
  const name = clean(input && input.display_name);
  if (!name || len(name) > rules.limits.nameMax || name.includes('@')) return { ok: false, error: 'bad_name' };
  const hood = input.neighborhood || null;
  if (hood && !rules.neighborhoods.includes(hood)) return { ok: false, error: 'bad_neighborhood' };
  const arch = input.archetype || null;
  if (arch && !rules.archetypes.includes(arch)) return { ok: false, error: 'bad_archetype' };
  const profile = { display_name: name, neighborhood: hood, archetype: arch };
  /* interests are optional in the call: left out, the server keeps the ones
     it has; a list replaces them, an empty list clears them */
  if (input.interests !== undefined && input.interests !== null) {
    const i = checkInterests(rules, input.interests);
    if (!i) return { ok: false, error: 'bad_interest' };
    profile.interests = i;
  }
  /* handles likewise: left out, kept; a map replaces them; {} clears them.
     handles_public left out is kept too. */
  if (input.handles !== undefined && input.handles !== null) {
    const h = checkHandles(rules, input.handles);
    if (!h.ok) return h;
    profile.handles = h.handles;
  }
  if (input.handles_public !== undefined && input.handles_public !== null) {
    if (typeof input.handles_public !== 'boolean') return { ok: false, error: 'bad_handle' };
    profile.handles_public = input.handles_public;
  }
  return { ok: true, profile };
}
/* A reader's handles, as nn_check_handles() checks them: an object whose
   keys are handle kinds, each a string that, with the spaces at either end
   trimmed, is 1 to handleMax characters, matches its kind's pattern and is
   not plainly a web address. An empty string or a null drops that kind.
   { ok, handles } or { ok: false, error: 'bad_handle', key }. */
const trimSpaces = (s) => s.replace(/^ +| +$/g, '');
export function checkHandles(rules, input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'bad_handle', key: null };
  const deny = new RegExp(rules.handlesDeny, 'i');
  const out = {};
  for (const k of Object.keys(input)) {
    const pat = rules.handles[k];
    if (!pat) return { ok: false, error: 'bad_handle', key: k };
    const v = input[k];
    if (v == null) continue;
    if (typeof v !== 'string') return { ok: false, error: 'bad_handle', key: k };
    const t = trimSpaces(v);
    if (!t) continue;
    if (len(t) > rules.limits.handleMax || !new RegExp(pat).test(t) || deny.test(t)) return { ok: false, error: 'bad_handle', key: k };
    out[k] = t;
  }
  return { ok: true, handles: out };
}
/* Each from the list, each once, at most interestsMax; null when not. */
export function checkInterests(rules, list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const t of list) {
    if (typeof t !== 'string' || !rules.interests.includes(t)) return null;
    if (!out.includes(t)) out.push(t);
  }
  return out.length > rules.limits.interestsMax ? null : out;
}

/* ---------------------------------------------------------------- posts */
export function checkMeta(rules, board, kindRule, meta) {
  const schema = rules.boards[board].meta;
  if (meta == null) meta = {};
  if (typeof meta !== 'object' || Array.isArray(meta)) return { error: 'bad_meta' };
  const keys = Object.keys(meta);
  if (keys.length > rules.limits.metaKeysMax) return { error: 'bad_meta' };
  const out = {};
  for (const k of keys) {
    const f = schema[k];
    if (!f) return { error: 'bad_meta' };
    const v = meta[k];
    if (v == null || v === '') continue;          // an empty optional field is no field
    if (f.type === 'text') {
      if (typeof v !== 'string') return { error: 'bad_meta' };
      const t = clean(v);
      if (len(t) > (f.max || rules.limits.metaTextMax)) return { error: 'bad_meta' };
      if (t) out[k] = t;
    } else if (f.type === 'int') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < f.min || v > f.max) return { error: 'bad_meta' };
      out[k] = v;
    } else if (f.type === 'enum') {
      if (!f.values.includes(v)) return { error: 'bad_meta' };
      out[k] = v;
    } else if (f.type === 'bool') {
      if (typeof v !== 'boolean') return { error: 'bad_meta' };
      out[k] = v;
    } else if (f.type === 'url') {
      /* a link, kept as typed (clean() would strip it), and only where
         Stephen sees every post before it shows */
      if (!rules.boards[board].premod || typeof v !== 'string') return { error: 'bad_meta' };
      const t = trimSpaces(v);
      if (len(t) > (f.max || rules.limits.metaTextMax) || !new RegExp(rules.urlPattern).test(t)) return { error: 'bad_meta' };
      if (t) out[k] = t;
    } else return { error: 'bad_meta' };
  }
  for (const k of kindRule.needs || []) if (out[k] == null) return { error: 'needs_meta' };
  return { meta: out };
}

/* A post as typed, checked the way the server checks it, in the server's
   order, so both refuse the same post with the same code. The photo is a
   storage path from the photo queue, or null. */
export const PHOTO_PATH = /^submissions\/[A-Za-z0-9-]+\.jpg$/;
export function checkPost(rules, board, input) {
  const b = rules.boards[board];
  if (!b) return { ok: false, error: 'bad_board' };
  const kindRule = input && b.kinds[input.kind];
  if (!kindRule) return { ok: false, error: 'bad_kind' };
  const title = clean(input.title);
  if (!title || len(title) > rules.limits.titleMax) return { ok: false, error: 'bad_title' };
  const body = clean(input.body, true);
  if (len(body) > rules.limits.bodyMax) return { ok: false, error: 'bad_body' };
  const place = clean(input.place);
  if (len(place) > rules.limits.placeMax) return { ok: false, error: 'bad_place' };
  const m = checkMeta(rules, board, kindRule, input.meta);
  if (m.error) return { ok: false, error: m.error };
  const photo = input.photo_path || null;
  if (photo && kindRule.photo === 'none') return { ok: false, error: 'photo_not_allowed' };
  if (!photo && kindRule.photo === 'required') return { ok: false, error: 'photo_required' };
  if (photo && !PHOTO_PATH.test(photo)) return { ok: false, error: 'bad_photo' };
  return { ok: true, post: { kind: input.kind, title, body, place, meta: m.meta, photo_path: photo } };
}

/* -------------------------------------------------------------- the clock */
const DAY = 86400000;
const kindOf = (rules, board, kind) => (rules.boards[board] && rules.boards[board].kinds[kind]) || null;
/* The date a field starts with, YYYY-MM-DD, as [y, m, d]; null when it
   starts with none, or with one that is not on the calendar (2026-02-30,
   which dateError refuses). The server reads it the same way: the leading
   ten characters, cast to a date. */
export const DATE_SHAPE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}/;
export function leadingDate(s) {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(String(s == null ? '' : s));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1) return null;
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? [y, mo, d] : null;
}
/* the instant a Burlington calendar day starts */
const ET_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' });
export function etMidnight(y, m, d) {
  for (const h of [4, 5]) {
    const t = Date.UTC(y, m - 1, d, h);
    const [yy, mm, dd] = etDate(t);
    if (yy === y && mm === m && dd === d && Number(ET_HOUR.format(new Date(t))) === 0) return t;
  }
  return Date.UTC(y, m - 1, d, 5);
}
const dayNumber = (y, m, d) => { const t = new Date(0); t.setUTCFullYear(y, m - 1, d); return Math.round(t.getTime() / DAY); };
/* the date an `until` kind ends by, from its meta, or null */
const untilDate = (rules, board, kind, meta) => {
  const k = kindOf(rules, board, kind);
  return k && k.until ? leadingDate(meta && meta[k.until]) : null;
};
/* When a new post stops showing, or null for never. A kind with `until`
   ends at the end of the day after the date its field starts with
   (Burlington time), and after its `days` when the field starts with none. */
export function expiresAt(rules, board, kind, nowMs, meta) {
  const date = untilDate(rules, board, kind, meta);
  if (date) { const t = new Date(0); t.setUTCFullYear(date[0], date[1] - 1, date[2] + 2); return etMidnight(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  const k = kindOf(rules, board, kind);
  const d = k && k.days;
  return d ? nowMs + d * DAY : null;
}
/* 'bad_date' when an `until` kind's field starts with a date that is not
   on the calendar, or one before today in Burlington or more than
   aheadMaxDays after it; null otherwise (no date is no error). */
export function dateError(rules, board, kind, meta, nowMs) {
  const k = kindOf(rules, board, kind);
  if (!k || !k.until) return null;
  const date = untilDate(rules, board, kind, meta);
  if (!date) return DATE_SHAPE.test(String((meta && meta[k.until]) || '')) ? 'bad_date' : null;
  const today = dayNumber(...etDate(nowMs));
  const n = dayNumber(...date);
  return n < today || n > today + rules.limits.aheadMaxDays ? 'bad_date' : null;
}
/* An edit to your own post's fields (nn_post_meta_set): the new fields go
   over the old ones, a null takes one away, and the result is checked like
   a new post's. */
export function mergeMeta(rules, board, kind, old, change) {
  if (change == null || typeof change !== 'object' || Array.isArray(change)) return { error: 'bad_meta' };
  const merged = { ...(old || {}) };
  for (const [k, v] of Object.entries(change)) { if (v === null) delete merged[k]; else merged[k] = v; }
  const kindRule = rules.boards[board] && rules.boards[board].kinds[kind];
  if (!kindRule) return { error: 'bad_kind' };
  return checkMeta(rules, board, kindRule, merged);
}

export const oneVote = (rules, board, kind) => !!(rules.boards[board] && rules.boards[board].kinds[kind] && rules.boards[board].kinds[kind].one_vote);
export const startsPending = (rules, board) => !!(rules.boards[board] && rules.boards[board].premod);
export const photoRequired = (rules, board, kind) => !!(rules.boards[board] && rules.boards[board].kinds[kind] && rules.boards[board].kinds[kind].photo === 'required');

/* The two posting limits. `today` counts the reader's posts in the last 24
   hours; `waiting` counts theirs not yet showing: held for a look, or with
   a photo the photo queue has not approved. */
export function rateError(rules, today, waiting) {
  if (today >= rules.limits.postsPerDay) return 'rate_day';
  if (waiting >= rules.limits.waitingMax) return 'rate_waiting';
  return null;
}

/* "19d left", "8h left", "ends soon"; null when the post never expires. */
export function leftLabel(expiresMs, nowMs) {
  if (expiresMs == null) return null;
  const left = expiresMs - nowMs;
  if (left <= 0) return 'ended';
  if (left < 3600000) return 'ends soon';
  if (left < DAY) return Math.floor(left / 3600000) + 'h left';
  return Math.floor(left / DAY) + 'd left';
}

/* An anonymous voter is the device's btown-player-id; a signed-in one is
   their account, written u:<id> so the two can never collide. */
export const PLAYER_ID = /^[A-Za-z0-9_-]{6,64}$/;
export const voterFor = (uid, player) => (uid ? 'u:' + uid : PLAYER_ID.test(String(player || '')) ? String(player) : null);

/* ---------------------------------------------------------- Burlington's week */
/* An ISO week ("2026-W42": Monday to Sunday) on Burlington's calendar,
   wherever the reader is. The server labels a vote's week the same way:
   to_char(created_at at time zone 'America/New_York', 'IYYY-"W"IW'). */
const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export function etDate(ms) {
  const o = {};
  ET_DAY.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return [Number(o.year), Number(o.month), Number(o.day)];
}
/* the ISO week of a calendar date (no clock: the date is plain arithmetic) */
export function isoWeekOf(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = (t.getUTCDay() + 6) % 7;            // Monday 0 … Sunday 6
  t.setUTCDate(t.getUTCDate() - dow + 3);         // the Thursday of this week names its year
  const year = t.getUTCFullYear();
  const week = 1 + Math.floor(Math.round((t - Date.UTC(year, 0, 1)) / DAY) / 7);
  return year + '-W' + String(week).padStart(2, '0');
}
export const isoWeek = (ms) => isoWeekOf(...etDate(ms));
/* this week's label and the n - 1 before it, newest first */
export function lastWeeks(nowMs, n) {
  const [y, m, d] = etDate(nowMs);
  const out = [];
  for (let i = 0; i < n; i++) { const t = new Date(Date.UTC(y, m - 1, d - 7 * i)); out.push(isoWeekOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())); }
  return out;
}
