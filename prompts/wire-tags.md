# The Wire — tagging rules

`scripts/tag_wire.py` pastes this into the model's prompt every hour, followed by the
new items as a numbered list. The tags decide what the Wire's editor (a separate, more
careful pass) gets to see, so be accurate, not generous. Every item gets a tag.

The page is for people in Burlington, Vermont. "Local" means Burlington, Chittenden
County (Winooski, South Burlington, Essex, Colchester, Williston, Shelburne, Charlotte,
Milton, Hinesburg, Richmond, Jericho), or statewide Vermont news that lands here.

Each line reads: index · mechanical channel · LOCAL or NATIONAL (from the source;
for X only a guess from the post's text, since the X list mixes Vermont accounts with
national desks like AP and Reuters) · source · text. The text is a headline, or for X
and Facebook a one-line summary of the post written by a bot.

For each item return:

- **junk**: `none`, or why it should never reach a reader. The junk words below are
  written for outlets' headlines; posts from people (Facebook groups, Reddit, X) have
  their own, narrower rules in the next section, and those win for those channels.
  - `promo`: sponsored, advertising, a station or outlet promoting itself or its own
    show, "download our app", a subscription pitch, a newsletter's welcome or
    housekeeping email, a sale that is only an ad, and press releases that are
    publicity rather than news: an award ceremony or gathering, an expo or conference
    appearance, a company's marketing stunt. A company opening, closing, moving, hiring
    at scale or winning a contract is news. Spam (crypto, followers, adult, "DM me to
    earn") is `promo` too.
  - `contest`: contests, sweepstakes, raffles run as ads, "win tickets", "like and
    share to win".
  - `tunein`: "tune in", "watch live", "join us tonight at 6", a livestream notice,
    a podcast episode whose title is only a show name and date. A news story about an
    event (a talk, a panel, a festival, an expert visiting) is news, not `tunein`.
  - `jobs`: job listings and hiring posts (a story about a big employer hiring is news,
    not jobs).
  - `duplicate`: the same story as an item already in today's river (listed under
    ALREADY IN THE RIVER). Same event, same facts, even if the wording differs. A
    genuinely new development is not a duplicate. Two items in the NEW list about
    the same story are NOT duplicates: tag both normally; the editor chooses the best
    version.
  - `noise`: jokes, memes, horoscopes, quizzes, puzzles, "open thread", recipes of the
    day with no local hook, generic listicles, pure clickbait. A police warning about
    a scam, a missing person or a road closure is never noise.

## Posts from people: Facebook groups, Reddit, X

These channels are the town talking, and that is why they are on the page. (An X post
from an outlet or a news desk, like AP or WCAX, is judged as a headline, by the rules
above.) On 2026-10-17 the old rules junked 14 of 16 Facebook group posts and 22 of 30
Reddit posts, nearly all of them neighbors announcing events and asking questions. Do
not do that.

The Facebook and X text is a bot's one-line summary of the post. Its verbs
("promoting", "advertising", "sharing", "inviting") are the bot's words, not a verdict:
judge what the post is, not how the summary phrases it. "Someone is promoting a show
tonight at The Old Post" is a band announcing a show.

A post from a neighbor, a band, a club, a school, a church, a nonprofit or a venue is
**never junk** when it does one of these:

- **Announces an event** people can go to: a show, a market, a dance, a community
  dinner, a food drive, a cook-off, a tour, a movie night, a festival, a repair cafe,
  a talk. A ticket price, a raffle on the side, or a venue posting its own show does
  not make it an ad. (Kept: "Someone is announcing the 12th annual Orchard food drive
  starting Nov 7"; "Vintage Clothing Market today! 377 Pine St till 2pm"; "Repair Cafe
  Saturday!"; "Someone is promoting an all-ages metal show tomorrow night at the
  Oddfellows hall in Burlington".)
- **Asks a question**: a recommendation, a road, a repair, a visitor asking what to
  do, "is this open?", a title that names a need ("Sewing machine repair").
  (Kept: "Is 108 open today? Getting mixed information."; "Where do the crows go
  during the day??"; "best deli style chicken salad?".)
- **Reports something**: a sighting, a crash, traffic, a lost or found pet, a scam,
  ICE spotted, something odd on the street, a group the neighborhood should know is
  back. (Kept: "Cars on bike path"; "Moose spotted off Route 5".)
- **Gives something away or offers help**: a spare ticket, a reservation they cannot
  use, free stuff, a curb alert, mutual aid, a fundraiser for a neighbor. (Kept: "New
  friend for Bob the Drag Queen show tonight? Free ticket!"; "Giving away Woodstock VT
  Restaurant Reservation, 10/16".)
- **Shares something from here**: local history, a photo of the lake or the leaves,
  an opinion on a local vote ("Vote Yes on Prop3!").

Junk on these channels is narrow, and only this:

- `promo`: **a business advertising what it sells**: its menu or today's specials, its
  hours, a hot bar, a farm stand, a bake case, a sale, a discount or a deal, a product,
  a service, "book now", a store's trade-in or sale billed as an "event", a free
  haircut to bring in customers. A date does not turn an offer into an event: "eight
  soups today" and "our weekend hot bar, open 8 to 6" are ads. An event is something
  people come for besides buying from the poster: a performance, a gathering, a
  class, a market of many vendors, a fundraiser. And spam. (Junk: "Someone is
  advertising tonight's fall specials at Sweet Basil"; "Last Chance for a Free Haircut
  This Week at Burlington Barbershop!"; "Someone is announcing a Burton gear trade-in
  event at the Burlington flagship store".)
- `contest`: an engagement contest ("like, share and tag a friend to win"). A
  neighbor giving away their own spare ticket or reservation is not a contest, and
  not junk.
- `noise`: empty chatter with nothing to go on: a meme, a joke, a one-word reaction.
  When a short title could be a question, a report or an announcement, it is not noise.
- `jobs`: a business's job listing. A neighbor asking where to find work is a question.
- `duplicate`: as above.

Whether it is far away or small is not a junk question: the score says that. A
contra dance in Corinth is not junk; it scores 1.

## The other fields

- **local**: true when the story is about the Burlington area or Vermont as defined
  above, whatever the source. A Vermont outlet running a wire story about Gaza is
  `false`. A national outlet's story about a Vermont town is `true`.
- **ch**: keep the mechanical channel, except: a `local` or `world` headline flips to
  the other one when `local` says so (`local` true means `ch` local). Never change
  `x`, `facebook`, `reddit`, `newsletters` or `video`.
- **topic**: the one best fit from the list in the schema.
- **score**: 0 to 10, how much a Burlingtonian would care today. 9 to 10: affects many
  people here now (an emergency, a rate decision, a major closure, a council vote on
  something big). 7 to 8: solid local news (an opening, a policy step, a notable crime
  with public impact). 4 to 6: minor local news, strong national news. 1 to 3: minor
  national news, soft features. 0: junk. Local news usually outscores national news of
  similar weight. A post from a person scores by its use to a Burlington reader: an
  event in the Burlington area this week or a report people need (a road, a scam, a
  lost dog) 4 to 6; a local question, something given away, a photo 2 to 3; anything
  about a place far from Burlington 1 to 2.
