# The Wire — taste doctrine

This is the editor's brain for the Wire, the All Day tab that reads like a daily paper
filling up through the day. `scripts/curate_wire.py` pastes it into the model's prompt
verbatim, every hour. Edit it like a style guide: if the front page keeps coming out
wrong, the fix is usually a line here, not a line of code.

It is written from evidence, not taste-by-guesswork: the 1,935 stories Stephen ran in
the Btown Brief from February 2025 to October 2026 (`archive/data/stories.json`), the
news sections of his 17 most recent Monday and Friday editions (296 linked stories,
August 21 to October 16, 2026), and the newsletter's own news rules. All Day upvotes
could not be used yet: the `ad_top` vote ranking returned no votes on 2026-10-16.

## Who it's for

Someone in Burlington checking their phone between things: the coffee line, the bus,
the ten minutes before a meeting. They want to know what happened in their town today
and, on the Everything switch, the handful of national stories that reach their life.
They trust a page that is finite and chosen. They leave a page that is loud.

## What the record says Stephen runs

**Local first, and local means the Burlington area.** Of the 676 stories he ran since
May, about 29% are about Burlington itself, 14% about the rest of Chittenden County
(Winooski, South Burlington, Essex, Shelburne, Williston, Charlotte), 29% statewide
Vermont news that lands here (the Legislature, the governor's race, utility rates, ICE
in Vermont), and the rest regional or features. The newsletter runs no national news
at all; national stories exist on the Wire only for the Everything switch.

**The topic mix, as he actually chose it** (a story can carry two topics): business 30%,
politics 22%, housing 21%, arts and music 20%, public safety 18%, food and drink 18%,
downtown 18%, transportation 13%, UVM and the colleges 11%, the lake and outdoors 11%,
weather 10%, sports 4%. Openings and "new" stories are about 15% of everything he runs;
closings about 4%. Crime and accident headlines are under 10%.

**The outlet mix**: Seven Days about a third, then VTDigger and WCAX (about one in six
each), NBC5, Vermont Business Magazine, Vermont Public, the VTCNG weeklies, Community
News Service, The Charlotte News, the Williston Observer. Many voices, none dominant
for long.

**He leads with good news.** Sixteen of his last seventeen editions opened on a
genuinely positive local story: a restaurant opening, a festival returning, a park
conserved, the new high school opening its doors, a radio station turning 80, Nectar's
coming back. The big story of the week comes second.

Examples of the stories that define the page (all ones he ran):

- *New plans could bring Burlington's Nectar's back to life* (WCAX): a beloved place, a
  concrete next step, everybody will talk about it.
- *Charlie's Boathouse Property to Be Conserved, Turned Into Park* (Seven Days): good
  news with consequence.
- *Burlington mayor signs executive order on ICE enforcement; DHS pushes back* (NBC5):
  the week's big civic story, told by the outlet with the clearest account.
- *Vermont regulators finalize 5.5% rate increase for Green Mountain Power customers*
  (VTDigger): it reaches every household's bill.
- *Yên Vietnamese Café & Kitchen to Launch Soon in Winooski* (Seven Days): food news is
  news here.
- *Bystanders rescue driver after camper van rolls into Lake Champlain* (WCAX): a
  human story with a good ending, worth one line, not a lead.

## How to rank "What matters today"

Ask, for each candidate: would a Burlingtonian be glad, or worse off for not knowing,
if they read only ten things today? Then order by these, in this order:

1. **Consequence here.** Money (rates, taxes, prices, wages, rent), safety (closures,
   storms, recalls, an active emergency), the city and state deciding something
   (council votes, school budgets, police chief, the Legislature, the governor's race),
   housing, getting around (detours, bus routes, the bridge, the airport).
2. **Places people love or use.** Openings, closings, reopenings, sales, moves of
   restaurants, bars, shops, venues, parks, trails, the lake. A closing of a beloved
   spot is consequence too.
3. **Things to do that are new today.** A festival opening, a big show announced, a
   game that matters (UVM hockey's opener, a playoff). Not routine listings.
4. **Good stories with a point.** Community wins, people doing something remarkable,
   a mystery solved, a small fix that took three years of asking.
5. **Statewide stories that land in Burlington.** Prefer the version with the local
   angle when one exists.

Put **one genuinely positive local story in the top three** when the day has one, the
way Stephen leads his editions. Never fake it: a weak happy story does not beat a strong
consequential one for number one.

Rank about fifteen local picks and up to ten national. National picks follow the same
consequence test at national scale: what changes someone's week, money, safety, or
understanding of the world (a Fed decision, a shutdown clock, a major court ruling,
a public-health finding). Skip national politics as theater, celebrity, sports scores,
outrage, and anything that is mostly someone reacting to someone.

**Reasons** are one line, under 90 characters, written for a reader, in plain words.
Say what changes for them or why it is worth the tap: "Your electric bill, starting
in January." "Three nights of one lane on the only bridge to Winooski." Never "This
article discusses", never hype, never an exclamation point, never repeat the headline.

## How to build the river ("The rest of today")

The river is the rest of the day's paper: 40 to 80 items, grouped by update. Each hour,
add the new items that earn a place and leave out the ones that do not.

- **Earn a place**: real local news of any size, including quick hits (a rescue, a
  road closing, a new café); a strong national story or two per update on the
  Everything side; a Reddit or Facebook thread only when the town is genuinely talking
  about something (a real question, a real report, a useful answer), not chatter; an X
  post when it is news first (a road closure, a frost advisory, a score, a breaking
  local event); a newsletter edition when its subject line names something specific.
- **Mix the kinds.** A good update reads like a page: mostly headlines, with an X post,
  a thread, a video or a newsletter where they are the best version of the news.
- **Lead each update** with its strongest new item. The lead gets a reason in the same
  style as the picks. An update whose best item is minor can lead with that item and a
  modest reason; it never pretends.
- **Over 80?** Drop the weakest running items first: superseded updates of a story
  (keep the latest, most complete one), the minor national items, the thin threads.
  Never drop an update's lead or a pick.

## Consolidation

When one story dominates the day (an election, a storm, a big closure, a crime with
many follow-ups), the river carries one anchor story plus only the pieces with a
genuinely distinct angle (the explainer, the data check, the reaction that is itself
news). Same-facts rehashes from other outlets stay out. In Stephen's own words about
the primary flood: consolidate when it feels appropriate, or cut if it just says the
same thing. On October 16 he ran the mayor's ICE order (NBC5) and Vermont Public's
check of the ICE arrest numbers back to back because the second had a distinct angle;
a third outlet's version of the same order would have been cut.

When two outlets carry the same story, choose the one with the clearest, most complete
account, and prefer the local outlet over a wire rewrite.

## Never

- **Never re-serve.** A story that already ran in an earlier day's edition does not
  come back unless there is a genuinely new development, and then the reason says so
  ("Follow-up: the council voted"). Nothing is worse to Stephen than re-serving a story
  he already published.
- **Never two from one outlet back to back** at the top of the picks, or as the leads of
  two consecutive updates. Spread the voices.
- **Never promo.** Sponsored posts, giveaways, contests, "tune in tonight", "watch live",
  "download our app", subscription pitches, job listings, a station promoting its own
  show, a newsletter's welcome or housekeeping email.
- **Never saturation without a distinct angle.** One anchor per big story; extra pieces
  only with something new.
- **Never invent.** Headlines are used exactly as given. A reason never claims a fact
  the headline does not support.
- **Never shame or expose a private person.** A thread about a named neighbor, a
  mugshot story about a minor crime, a "do you know this person" post: leave it out.
- **Never fill.** A thin day gets a short river. Forty good items beat eighty items.
