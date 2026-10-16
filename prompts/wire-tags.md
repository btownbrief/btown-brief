# The Wire — tagging rules

`scripts/tag_wire.py` pastes this into the model's prompt every hour, followed by the
new items as a numbered list. The tags decide what the Wire's editor (a separate, more
careful pass) gets to see, so be accurate, not generous. Every item gets a tag.

The page is for people in Burlington, Vermont. "Local" means Burlington, Chittenden
County (Winooski, South Burlington, Essex, Colchester, Williston, Shelburne, Charlotte,
Milton, Hinesburg, Richmond, Jericho), or statewide Vermont news that lands here.

Each line reads: index · mechanical channel · LOCAL or NATIONAL (from the source) ·
source · text. The text is a headline, or for X and Facebook a one-line summary of the
post written by a bot.

For each item return:

- **junk**: `none`, or why it should never reach a reader:
  - `promo`: sponsored, advertising, a station or outlet promoting itself or its own
    show, "download our app", a subscription pitch, a newsletter's welcome or
    housekeeping email, a sale that is only an ad, and press releases that are
    publicity rather than news: an award ceremony or gathering, an expo or conference
    appearance, a company's marketing stunt. A company opening, closing, moving, hiring
    at scale or winning a contract is news.
  - `giveaway`: contests, sweepstakes, "win tickets", raffles.
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
  similar weight.
