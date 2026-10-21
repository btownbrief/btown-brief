/* build-site-director.js — the life around the work, and the milestones.

   The work is the story: glance down and your builder is mid-job. The
   director adds light ambient life around it, in the world, never taking the
   camera and never interrupting a job: a stray dog the crew slowly adopts
   over days, geese crossing, a rain shower with tarps, lunch together on a
   beam, a kid on the sidewalk waving, a snowman on a snow day, the late
   crew sharing a thermos. A day's schedule is seeded by the date, so every
   phone in town sees the same day. Arcs persist across days on this phone.

   Milestones (the first pour, a floor done, topping out) get a short moment:
   the director calls K.moment(x, y, seconds), which the kernel may refuse
   (first minute of a shift, the whistle, reduced motion).

   INTERFACE:
     createDirector(K) -> {
       step(dt), collect(list)       extra characters and props (dog, geese, kid, cake, snowman, tarp)
       list() -> [{ id, title, kind: 'ambient'|'arc'|'milestone' }]
       play(id) -> bool              start one now (preview "jump to vignette", tests)
       debug() -> { today, active, arcs }
     }
   THIS FILE IS A STUB from the v2 kernel. The director helper replaces it. */

export function createDirector(K) {
  K.on('milestone', (m) => { K.moment(m.x, m.y - 10, 6); });
  return { step() {}, collect() {}, list: () => [], play: () => false, debug: () => ({ active: null }) };
}
