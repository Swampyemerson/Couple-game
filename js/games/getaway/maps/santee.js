// Santee, California (San Diego County): Getaway map. Contract: docs/games/getaway-maps.md
// Layout data lives in santee-data.js (authored, real bearings) and santee-layout.js (generated);
// visuals in santee-build.js; the cats at 8524 Boulder Way in santee-cats.js.
//
// The layout (~150-300 ms) is generated lazily: on first access to any data field, or sliced across
// frames by `await SANTEE.prepare(kit)` if the engine calls it first (uses kit.slice when present).
import { layoutSteps } from './santee-layout.js';
import { BOUNDS } from './santee-data.js';
import { buildSantee, backdropSantee } from './santee-build.js';
import { animateCats } from './santee-cats.js';

let L = null;
let gen = null;
function ensure() {
  if (L) return L;
  if (!gen) gen = layoutSteps();
  let r = gen.next();
  while (!r.done) r = gen.next();
  L = r.value;
  return L;
}

export const SANTEE = {
  id: 'santee', name: 'Santee', blurb: 'Mission Gorge Rd to Mast Blvd, the river in between',
  scale: 0.4,
  bounds: { ...BOUNDS },
  get height() { return ensure().height; },
  get roads() { return ensure().roads; },
  get open() { return ensure().open; },
  get solids() { return ensure().solids; },
  get water() { return ensure().water; },
  get spawns() { return ensure().spawns.map(({ runner, cop, where }) => ({ runner, cop, where })); },
  get landmarks() { return ensure().landmarks; },
  sky: {
    top: '#7fb3e3', horizon: '#f3e2c2', fog: '#ecd9b8', fogNear: 160, fogFar: 640,
    sun: { bearing: 252, elev: 24 },
  },
  /** Optional: generate the layout in slices before the engine reads the data fields. */
  async prepare(kit = {}) {
    if (L) return;
    if (!gen) gen = layoutSteps();
    for (;;) {
      const r = gen.next();
      if (r.done) { L = r.value; return; }
      if (kit.slice) await kit.slice(); else await new Promise((res) => setTimeout(res, 0));
    }
  },
  build(THREE, kit) { return buildSantee(THREE, kit || {}, ensure()); },
  backdrop(THREE, kit) { return backdropSantee(THREE, kit || {}, ensure()); },
  animate(t, cars) { animateCats(t, cars); },
};
