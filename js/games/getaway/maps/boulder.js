// Boulder, Colorado — the Getaway map. Contract: docs/games/getaway-maps.md.
// Real streets on real bearings at 0.45× scale (≈ 2.6 × 2.3 km): downtown's compass grid with
// the Pearl Street Mall, Broadway bending SE past CU to Table Mesa, Boulder Creek and its path
// under the bridges, 28th/30th/Folsom/Foothills, US-36 (the Turnpike) with the Table Mesa
// interchange, Martin Acres and Moorhead Ave (3865 Moorhead marked as home), Chautauqua and
// Flagstaff Rd's switchbacks under the Flatirons. Data: boulder-data.js; layout:
// boulder-layout.js; meshes: boulder-build.js; skyline: boulder-backdrop.js.
import { BOUNDS, ROADS, OPEN, WATER, LANDMARKS, P } from './boulder-data.js';
import { layout, layoutGen, height, pickSpawn } from './boulder-layout.js';
import { buildBoulder } from './boulder-build.js';
import { buildBackdrop, PEAKS } from './boulder-backdrop.js';

const SPAWN_DEFS = [
  // road, nth piece (bridges excluded), fraction along, direction (+1 = drawn direction), label
  ['Pearl St', 1, 0.3, 1, 'Downtown, east on Pearl St'],
  ['Broadway', 0, 0.62, 1, 'Broadway, south through downtown'],
  ['28th St', 1, 0.45, -1, '28th St, northbound'],
  ['US-36 Boulder Turnpike', 0, 0.42, -1, 'US-36, the Turnpike into town'],
  ['Moorhead Ave', 0, 0.33, 1, 'Martin Acres, down Moorhead Ave'],
  ['Baseline Rd', 0, 0.36, -1, 'Baseline Rd, west to Chautauqua'],
  ['Arapahoe Ave', 0, 0.62, 1, 'Arapahoe Ave, east Boulder'],
  ['Folsom St', 0, 0.45, 1, 'Folsom St, south toward Folsom Field'],
  ['Foothills Pkwy', 1, 0.6, -1, 'Foothills Pkwy, northbound'],
  ['Canyon Blvd', 0, 0.45, -1, 'Canyon Blvd, west toward the canyon'],
  ['Valmont Rd', 0, 0.45, 1, 'Valmont Rd, eastbound'],
  ['Table Mesa Dr', 0, 0.62, -1, 'Table Mesa Dr, westbound'],
  ['Flagstaff Rd', 0, 0.86, -1, 'Flagstaff Rd, down the switchbacks'],
];
const SPAWNS = SPAWN_DEFS.map(([road, nth, f, dir, where]) => {
  const s = pickSpawn(road, f, 80, dir, nth);
  return { runner: s.runner, cop: s.cop, where };
});

const FAR = [
  ...PEAKS.filter((p) => p.name !== 'Mt Sanitas').map((p) => ({ name: p.name, x: Math.round(p.x), z: Math.round(p.z), far: true })),
  (() => { const [x, z] = P(39.99014, -105.29469); return { name: 'First Flatiron', x: Math.round(x), z: Math.round(z), far: true }; })(),
];

export const BOULDER = {
  id: 'boulder',
  name: 'Boulder',
  blurb: 'Pearl St to the Turnpike, Flatirons on your right',
  bounds: { ...BOUNDS },
  height,
  roads: ROADS,
  get open() { return [...OPEN, ...layout().lots].map(({ kind, poly }) => ({ kind, poly })); },
  get solids() { return layout().solids; },
  water: WATER.map(({ poly }) => ({ poly })),
  spawns: SPAWNS,
  landmarks: [...LANDMARKS, ...FAR],
  sky: { top: '#5d9bd3', horizon: '#f3dcb0', fog: '#ead8b9', fogNear: 170, fogFar: 640, sun: { bearing: 255, elev: 24 } },
  /** Optional: generate the layout ahead of build(), in slices. */
  async prepare(kit = {}) {
    const it = layoutGen();
    while (!it.next().done) if (kit.slice) await kit.slice();
  },
  build(THREE, kit) { return buildBoulder(THREE, kit || {}); },
  backdrop(THREE, kit) { return buildBackdrop(THREE, kit || {}); },
};
