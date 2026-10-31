/* rank-core.js — the arithmetic behind Food's Rank section (modes/rank.js).
   Pure, no DOM, so node can test it. A list is { key, title, items: [{ name,
   where }] }; a row is get_rankings' { item, ballot_count, score }; the
   server does the weighting: on a ballot of n places, position r earns
   (n - r + 1) / n, and a place's score is the mean of those.

   A place charts at MIN_BALLOTS ballots (Rank What You Know's rule). Rows for
   a place no longer on the list (it closed) are left out here, so a ballot
   cast for it still counts toward the others' weighting and it never shows. */

export const MIN_BALLOTS = 3;

/* the rows for this list's places, best first */
function shaped(rows, list) {
  const on = new Set(list.items.map((i) => i.name));
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && on.has(r.item))
    .map((r) => ({ item: r.item, ballot_count: Number(r.ballot_count) || 0, score: Number(r.score) || 0 }))
    .sort((a, b) => b.score - a.score || a.item.localeCompare(b.item));
}
export const chartOf = (rows, list) => shaped(rows, list).filter((r) => r.ballot_count >= MIN_BALLOTS);
export const pendingOf = (rows, list) => shaped(rows, list).filter((r) => r.ballot_count < MIN_BALLOTS);

/* ballots until the list has a first place to show; 0 once it does */
export function needsMore(rows, list) {
  if (chartOf(rows, list).length) return 0;
  return MIN_BALLOTS - Math.max(0, ...shaped(rows, list).map((r) => r.ballot_count));
}

/* Freshest first: the list anyone ranked last leads, lists with no ballots
   follow in the file's order. `activity` maps a list's key to { ballots,
   last_at }. */
export function orderLists(lists, activity) {
  const at = (l) => { const a = activity && activity[l.key]; return a && a.ballots > 0 ? Date.parse(a.last_at) || 0 : 0; };
  return lists.map((l, i) => [l, i, at(l)]).sort((a, b) => b[2] - a[2] || a[1] - b[1]).map((x) => x[0]);
}

/* a saved ballot, minus anything no longer on the list */
export function cleanBallot(ballot, list) {
  const on = new Set(list.items.map((i) => i.name));
  return [...new Set(Array.isArray(ballot) ? ballot : [])].filter((n) => on.has(n));
}

/* where the order step starts: your last order, then new picks in list order */
export function startOrder(checked, list, previous) {
  const was = (n) => { const i = (previous || []).indexOf(n); return i < 0 ? Infinity : i; };
  return list.items.map((i) => i.name).filter((n) => checked.has(n)).map((n, i) => [n, i])
    .sort((a, b) => (was(a[0]) === was(b[0]) ? a[1] - b[1] : was(a[0]) - was(b[0]))).map((x) => x[0]);
}

/* Your match with Burlington: the Spearman rank correlation between your
   ballot and the community order over the places in both, mapped to 0-100.
   null with fewer than two in common. */
export function matchPercent(mine, community) {
  const shared = mine.filter((n) => community.includes(n));
  const m = shared.length;
  if (m < 2) return null;
  const yours = shared.slice().sort((a, b) => mine.indexOf(a) - mine.indexOf(b));
  const theirs = shared.slice().sort((a, b) => community.indexOf(a) - community.indexOf(b));
  const d2 = shared.reduce((sum, n) => sum + (yours.indexOf(n) - theirs.indexOf(n)) ** 2, 0);
  return Math.round(((1 - (6 * d2) / (m * (m * m - 1)) + 1) / 2) * 100);
}
