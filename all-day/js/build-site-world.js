/* build-site-world.js — the yard and its zones, the fence and the gate,
   Lakeside Ave and the people going by.

   INTERFACE:
     createWorld(K) -> {
       drawBack(ctx)        world space, after the backdrop and before the building: the ground
                            (dirt, gravel, mud, snow), back-line structures (trailer, canteen awning,
                            prefab shed, lumber racks, brick stack, toolshed, john, dumpster, the
                            lakeside bench and its tree, the mill). Cache it with K.blit.
       collect(list)        push { y, draw(ctx) } for things standing in the yard that need depth
                            sorting with people (stacks people walk in front of and behind)
       drawFront(ctx)       the fence, the gate, the street, the far sidewalk, passers-by (cyclists,
                            dog walkers, a kid who waves), the bike path
       pile(kind) -> n      how full a material stack is (0..5); take(kind) / add(kind) change it
       spot(zone, name)     [x, y] of a named spot (ZONES in shared)
       step(dt)
     }
   THIS FILE IS A STUB from the v2 kernel. The world helper replaces it. */

import { WW, GROUND_Y, YARD_FRONT, STREET_Y, ZONES } from './build-site-shared.js';

export function createWorld(K) {
  const piles = { lumber: 3, brick: 3, glass: 2, copper: 2, nails: 1, rebar: 2, stakes: 2 };
  function drawBack(ctx) {
    K.blit('world:ground', 0, GROUND_Y - 6, WW, STREET_Y - GROUND_Y + 30, (g, x0, x1) => {
      g.fillStyle = K.pal.grass; g.fillRect(x0, GROUND_Y - 6, x1 - x0, 6);
      g.fillStyle = K.light.snowy ? K.pal.snow : K.pal.dirt; g.fillRect(x0, GROUND_Y, x1 - x0, YARD_FRONT - GROUND_Y);
      for (const [name, z] of Object.entries(ZONES)) {
        if (!z.label || name === 'pad' || name === 'street') continue;
        g.fillStyle = name === 'office' ? K.pal.trailer : name === 'mill' ? K.pal.mill : K.pal.shed;
        g.fillRect(z.x0, GROUND_Y - (name === 'mill' ? 30 : 14), z.x1 - z.x0, name === 'mill' ? 30 : 14);
      }
    }, { ver: 1 });
  }
  function drawFront(ctx) {
    ctx.fillStyle = K.pal.sidewalk; ctx.fillRect(0, YARD_FRONT + 2, WW, 3);
    ctx.fillStyle = K.pal.asphalt; ctx.fillRect(0, STREET_Y, WW, 16);
    ctx.fillStyle = K.pal.fence;
    for (let x = 0; x < WW; x += 8) if (x < ZONES.gate.x0 || x > ZONES.gate.x1) ctx.fillRect(x, YARD_FRONT - 6, 0.6, 7);
    ctx.fillRect(0, YARD_FRONT - 6, ZONES.gate.x0, 0.6); ctx.fillRect(ZONES.gate.x1, YARD_FRONT - 6, WW, 0.6);
  }
  return {
    drawBack, drawFront, collect() {}, step() {},
    pile: (k) => piles[k] || 0,
    take(k) { if (piles[k] > 0) piles[k]--; return piles[k]; },
    add(k) { piles[k] = Math.min(5, (piles[k] || 0) + 1); return piles[k]; },
    spot(zone, name) { const z = ZONES[zone]; return z && z.spots && z.spots[name] ? z.spots[name] : [z ? (z.x0 + z.x1) / 2 : 0, GROUND_Y + 20]; },
  };
}
