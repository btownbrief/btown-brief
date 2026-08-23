# Btown Out Loud — field test (30 minutes, one phone)

The engine and UI are covered by tests and a simulated walk (`?replay=downtown-loop`).
What only a real walk can tell us is how iOS/Android behave with GPS, the screen,
and audio outdoors. Do this once before launch and once after any iOS update.

## Before you leave
- Open https://guide.btownbrief.com/out-loud/ in Safari. Also add it to the Home
  Screen (Share → Add to Home Screen) — test both ways if you have time; installed
  is the one that matters.
- Earbuds in. Screen brightness low. Battery % noted: ____

## The spike (anywhere, 5 minutes)
Open `…/out-loud/?spike=here`, tap **Start walking**, allow location.
1. Did **Test story A** start by itself within ~10 s of the first fix? ☐ yes ☐ no
2. Walk ~120 m in any direction. Did **Test story B** start **without a tap**? ☐ yes ☐ no
   (If Safari shows the "Tap to play the story" button instead, note it — that's
   the iOS audio-unlock limit and we'll need to change the player strategy.)
3. Tap **Pocket mode**, phone in pocket, walk back toward A for 2 minutes. Did the
   screen stay on (dim, not locked)? ☐ yes ☐ no
4. Did A **not** replay when you walked back (24 h cooldown)? ☐ correct ☐ it replayed
5. Lock the phone mid-story. Did audio keep playing? ☐ yes ☐ no. Unlock — did the
   app pick up where it was? ☐ yes ☐ no

## The loop (downtown, 20 minutes)
Open `…/out-loud/?route=downtown-loop`, tap **Start walking**.
6. Church Street top → City Hall → Battery Park: how many of the stories on that
   leg fired on their own? ____ / ____. Any that fired too early / too late / twice?
7. GPS accuracy shown in the status line (±__ m) on Church Street: ____  at the
   waterfront: ____
8. Any story that needs a wider/tighter radius or a moved pin? (note the id)
9. Battery % at the end: ____  (30 min of screen-on + GPS; ~10–15% is normal)
10. Anything annoying? (chime volume, status text, the bar covering something)

Send the numbers back and I'll tune radii, the cooldown, and copy. If 2. fails on
iOS, that is the one result that changes the architecture — tell me first.

## Things the fact-checkers could not settle from a desk (walk past and tell me)
- Battery Park: is the Peter Wolf Toth red-oak carving of Chief Grey Lock still standing? (the script mentions it)
- Fletcher Free: is preservation scaffolding still wrapping the Carnegie columns? (script says work ran 2024 into 2026)
- Nectar's: marquee still up and dark? building still empty / for lease? (script: "went dark in May 2025")
- King Street ferry dock: are the old pilings visible from the dock apron? (line was cut pending your eyes)
- Ben & Jerry's corner (College & St. Paul): what is physically there — parking lot, marker? (script describes a parking lot + marker)
- Perkins Pier: read the Dr. Charles N. Perkins marker (the "old salt dock renamed 1959" story is omitted until someone reads it)
- Rock Point / North Beach: the Champlain Thrust pin is at the clifftop trail junction; if you find a safe, legal shoreline viewpoint, send me its coordinates and I'll move it
- CityPlace block: what's the construction status as you see it? (script says "as of August 2026")
- Church & Pearl: Unitarian Church, Masonic Temple and Richardson Building all fire within ~50 m — do three back-to-back stories feel like too much there?
- Boathouse / Breakwater (34 m apart) and Memorial Auditorium / 242 Main (22 m): same question
