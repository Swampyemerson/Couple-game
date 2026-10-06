// Dockside: the lead engineer's compact harbour town (about 1.1 × 1.0 km). It is the fallback map
// and the one the fast tests use, and it doubles as a worked example of the kit: everything is
// written into one kit.builder() per 200 m chunk (one draw call each after the engine's merge),
// buildings use the shader-drawn facade windows, and street furniture is left to the engine
// (solids without `drawn`, so they can be knocked over). Contract: docs/games/getaway-maps.md.

const AV = [-360, -200, -40, 120, 280];          // north–south avenues (x)
const CS = [-380, -240, -100, 40, 180, 320];      // east–west streets (z)
const CANAL = { x0: 190, x1: 222, z0: -70, z1: 470 };
const HARBOR_Z = 444;
const B = { x0: -560, z0: -520, x1: 560, z1: 560 };

function hill(x, z) {
  const dx = (x + 400) / 250; const dz = (z + 400) / 230; const d2 = dx * dx + dz * dz;
  return d2 >= 1 ? 0 : 15 * (1 - d2) * (1 - d2);
}
const height = (x, z) => hill(x, z);

const roads = [];
const street = (name, pts, o = {}) => roads.push({ name, kind: o.kind || 'street', width: o.width || 11, pts, closed: !!o.closed, bridge: !!o.bridge, ...(o.clear ? { clear: o.clear } : {}), ...(o.lanes ? { lanes: o.lanes } : {}) });
// avenues
const AVN = ['Gull Ave', 'Rope Ave', 'Main St', 'Anchor Ave', 'Tide Ave'];
AV.forEach((x, i) => street(AVN[i], [[x, -460], [x, -300], [x, -100], [x, 100], [x, 300], [x, 400]], i === 2 ? { kind: 'arterial', width: 15, lanes: 2 } : {}));
// cross streets (split over the canal by bridges)
const CSN = ['Ridge St', 'Kelp St', 'Market St', 'Mill St', 'Ferry St', 'Dock St'];
CS.forEach((z, i) => {
  const crossesCanal = z > CANAL.z0 && z < CANAL.z1;
  const w = i === 3 ? 13 : 11;
  if (!crossesCanal) street(CSN[i], [[-470, z], [-300, z], [-100, z], [100, z], [300, z], [440, z]], { width: w });
  else {
    street(CSN[i], [[-470, z], [-300, z], [-100, z], [100, z], [170, z]], { width: w });
    street(CSN[i] + ' Bridge', [[170, z], [190, z], [206, z], [222, z], [242, z]], { width: w, bridge: true });
    street(CSN[i] + ' East', [[242, z], [300, z], [440, z]], { width: w });
  }
});
// harbour boulevard + its canal bridge
street('Harbor Blvd', [[-520, 400], [-360, 400], [-200, 400], [0, 400], [170, 400]], { kind: 'arterial', width: 16, lanes: 2 });
street('Harbor Bridge', [[170, 400], [190, 400], [206, 400], [222, 400], [242, 400]], { kind: 'arterial', width: 16, lanes: 2, bridge: true });
street('Harbor Blvd East', [[242, 400], [360, 400], [440, 400], [520, 400]], { kind: 'arterial', width: 16, lanes: 2 });
// coast highway on the east side, meeting the boulevard
street('Coast Hwy', [[478, -500], [486, -340], [474, -180], [486, 0], [478, 160], [468, 300], [452, 380], [440, 400]], { kind: 'highway', width: 18 });
street('North Rd', [[-360, -460], [-200, -462], [-40, -460], [120, -462], [280, -460], [420, -458], [482, -440]], { width: 12 });
// winding ridge road over the hill (north-west)
street('Ridge Rd', [[-470, -240], [-505, -300], [-500, -390], [-460, -470], [-420, -490], [-360, -460]], { width: 9 });
street('Lookout Ln', [[-360, -300], [-400, -330], [-440, -360], [-470, -380]], { width: 8, kind: 'alley' });
// pier service road
street('Pier Rd', [[-40, 400], [-40, 430], [-40, 462], [-60, 490], [-110, 500], [-160, 492]], { width: 10 });

const open = [];
const solids = [];
const water = [
  { poly: [[CANAL.x0, CANAL.z0], [CANAL.x1, CANAL.z0], [CANAL.x1, HARBOR_Z + 1], [CANAL.x0, HARBOR_Z + 1]] },
  { poly: [[B.x0, HARBOR_Z], [-200, HARBOR_Z], [-200, 520], [B.x0, 520], [B.x0, HARBOR_Z]] },
  { poly: [[-20, HARBOR_Z], [B.x1, HARBOR_Z], [B.x1, B.z1], [-20, B.z1]] },
  { poly: [[-200, 520], [-20, 520], [-20, B.z1], [-200, B.z1]] },
];
// the pier is a lot in the harbour (water around it)
open.push({ kind: 'lot', poly: [[-200, HARBOR_Z], [-20, HARBOR_Z], [-20, 520], [-200, 520]] });
// a sandy beach strip west of the pier
open.push({ kind: 'sand', poly: [[-520, 416], [-210, 416], [-210, HARBOR_Z], [-520, HARBOR_Z]] });
// dirt lookout on the hill top
open.push({ kind: 'dirt', poly: [[-440, -420], [-360, -420], [-360, -350], [-440, -350]] });

// ── blocks ──
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(90210);
const halfW = (z) => (z === CS[3] ? 6.5 : 5.5);
const blocks = [];
const xs = [-480, ...AV, 450]; const zs = [-470, ...CS, 400];
for (let i = 0; i < xs.length - 1; i++) {
  for (let j = 0; j < zs.length - 1; j++) {
    const xa = xs[i] + (i === 0 ? 4 : AV.includes(xs[i]) ? (xs[i] === -40 ? 7.5 : 5.5) : 0) + 4;
    const xb = xs[i + 1] - (AV.includes(xs[i + 1]) ? (xs[i + 1] === -40 ? 7.5 : 5.5) : 30) - 4;
    const za = zs[j] + (j === 0 ? 14 : halfW(zs[j])) + 4;
    const zb = zs[j + 1] - (zs[j + 1] === 400 ? 8 : j + 1 === zs.length - 1 ? 8 : halfW(zs[j + 1])) - 4;
    if (xb - xa < 20 || zb - za < 20) continue;
    // split around the canal
    if (xa < CANAL.x1 + 6 && xb > CANAL.x0 - 6 && zb > CANAL.z0) {
      if (CANAL.x0 - 8 - xa > 18) blocks.push({ x0: xa, z0: za, x1: CANAL.x0 - 8, z1: zb });
      if (xb - (CANAL.x1 + 8) > 18) blocks.push({ x0: CANAL.x1 + 8, z0: za, x1: xb, z1: zb });
      if (za < CANAL.z0 - 10) blocks.push({ x0: xa, z0: za, x1: xb, z1: CANAL.z0 - 10 });
      continue;
    }
    blocks.push({ x0: xa, z0: za, x1: xb, z1: zb });
  }
}
const PARK = blocks.find((b) => b.x0 < -150 && b.x1 > -60 && b.z0 > 40 && b.z1 < 180);
const TOWER = { x: 40, z: -30 };
const GAS = { x: 380, z: 250 };
const buildings = []; // { x, z, w, d, h, kind: 'tower'|'house'|'shed', color }
for (const b of blocks) {
  if (b === PARK) continue;
  const cx = (b.x0 + b.x1) / 2; const cz = (b.z0 + b.z1) / 2;
  const hilly = cx < -200 && cz < -150;
  const harbor = cz > 300;
  const downtown = cx > -60 && cx < 300 && cz > -260 && cz < 200;
  // lots: split the block into a grid
  const nx = Math.max(1, Math.round((b.x1 - b.x0) / (hilly ? 30 : harbor ? 55 : 40)));
  const nz = Math.max(1, Math.round((b.z1 - b.z0) / (hilly ? 30 : harbor ? 45 : 40)));
  for (let a = 0; a < nx; a++) for (let c = 0; c < nz; c++) {
    if (nx > 2 && nz > 2 && a > 0 && a < nx - 1 && c > 0 && c < nz - 1) continue; // courtyards
    const lx0 = b.x0 + ((b.x1 - b.x0) * a) / nx; const lx1 = b.x0 + ((b.x1 - b.x0) * (a + 1)) / nx;
    const lz0 = b.z0 + ((b.z1 - b.z0) * c) / nz; const lz1 = b.z0 + ((b.z1 - b.z0) * (c + 1)) / nz;
    const m = hilly ? 5 : 2.5;
    const w = lx1 - lx0 - m * 2; const d = lz1 - lz0 - m * 2;
    if (w < 6 || d < 6) continue;
    const x = (lx0 + lx1) / 2; const z = (lz0 + lz1) / 2;
    if (Math.hypot(x - TOWER.x, z - TOWER.z) < 40 || Math.hypot(x - GAS.x, z - GAS.z) < 55) continue;
    let h; let kind;
    if (hilly) { h = 6 + R() * 4; kind = 'house'; }
    else if (harbor) { h = 8 + R() * 6; kind = 'shed'; }
    else if (downtown) { h = 18 + R() * 34; kind = 'tower'; }
    else { h = 10 + R() * 16; kind = 'tower'; }
    buildings.push({ x, z, w: hilly ? Math.min(w, 16) : w, d: hilly ? Math.min(d, 14) : d, h, kind, c: Math.floor(R() * 8) });
  }
}
for (const bd of buildings) solids.push({ kind: 'building', x: bd.x, z: bd.z, w: bd.w, d: bd.d, rot: 0, h: bd.h, drawn: true });
// clock tower + gasworks
solids.push({ kind: 'building', x: TOWER.x, z: TOWER.z, w: 18, d: 18, rot: 0, h: 64, drawn: true });
for (const [dx, dz, r] of [[-22, -18, 13], [18, -20, 15], [0, 22, 12]]) solids.push({ kind: 'building', x: GAS.x + dx, z: GAS.z + dz, w: r * 2, d: r * 2, rot: 0, h: 20, drawn: true });
// canal walls are low curbs: cars CAN drive into the canal (and get busted)
// street furniture (engine-drawn, breakable)
for (let x = -500; x <= 500; x += 42) if (x < CANAL.x0 - 30 || x > CANAL.x1 + 30) { solids.push({ kind: 'lamp', style: 'lamp', x, z: 400 - 10.5, w: 0.5, d: 0.5, rot: 0 }); solids.push({ kind: 'lamp', style: 'lamp', x: x + 21, z: 400 + 10.5, w: 0.5, d: 0.5, rot: Math.PI }); }
for (let z = -440; z <= 380; z += 40) { if (CS.some((c) => Math.abs(c - z) < 14)) continue; solids.push({ kind: 'lamp', style: 'lamp', x: -40 - 10, z, w: 0.5, d: 0.5, rot: Math.PI }); solids.push({ kind: 'tree', style: 'aspen', x: -40 + 10.5, z: z + 20, w: 1, d: 1 }); }
for (const x of AV) for (const z of CS) { if (R() < 0.5) solids.push({ kind: 'hydrant', x: x + 8.5, z: z + 8.5, w: 0.5, d: 0.5 }); if (R() < 0.35) solids.push({ kind: 'signal', x: x - 8.5, z: z - 8.5, w: 0.5, d: 0.5, rot: Math.PI / 2 }); }
if (PARK) {
  for (let k = 0; k < 34; k++) {
    const x = PARK.x0 + 6 + R() * (PARK.x1 - PARK.x0 - 12); const z = PARK.z0 + 6 + R() * (PARK.z1 - PARK.z0 - 12);
    if (Math.hypot(x - (PARK.x0 + PARK.x1) / 2, z - (PARK.z0 + PARK.z1) / 2) < 16) continue;
    solids.push({ kind: 'tree', style: R() < 0.3 ? 'pine' : 'cottonwood', x, z, w: 1.2, d: 1.2 });
  }
  solids.push({ kind: 'wall', x: (PARK.x0 + PARK.x1) / 2, z: (PARK.z0 + PARK.z1) / 2, w: 10, d: 10, rot: 0.785, h: 1.2, drawn: true });
  open.push({ kind: 'grass', poly: [[PARK.x0, PARK.z0], [PARK.x1, PARK.z0], [PARK.x1, PARK.z1], [PARK.x0, PARK.z1]] });
}
for (const bd of buildings) if (bd.kind === 'house' && R() < 0.7) solids.push({ kind: 'tree', style: R() < 0.5 ? 'pine' : 'aspen', x: bd.x + bd.w / 2 + 3, z: bd.z - bd.d / 2 - 2, w: 1, d: 1 });
for (let x = -196; x <= -24; x += 12) solids.push({ kind: 'bollard', x, z: 517, w: 0.4, d: 0.4 });
for (let z = 448; z <= 512; z += 12) { solids.push({ kind: 'bollard', x: -197, z, w: 0.4, d: 0.4 }); solids.push({ kind: 'bollard', x: -23, z, w: 0.4, d: 0.4 }); }
// pier containers
for (let k = 0; k < 6; k++) solids.push({ kind: 'building', x: -150 + (k % 3) * 34, z: 470 + Math.floor(k / 3) * 22, w: 13, d: 5.5, rot: 0, h: 5.2, drawn: true, color: ['#d4553f', '#3d7cc9', '#e3b23c', '#3f9b6e', '#d4553f', '#7a5ac4'][k] });
// cacti and shrubs on the beach, for flavour
for (let x = -500; x < -230; x += 37) solids.push({ kind: 'shrub', x, z: 425, w: 1.6, d: 1.6 });

const spawns = [
  { runner: { x: -100, z: CS[3], yaw: Math.PI / 2 }, cop: { x: -180, z: CS[3], yaw: Math.PI / 2 } },
  { runner: { x: AV[2], z: -170, yaw: Math.PI }, cop: { x: AV[2], z: -250, yaw: Math.PI } },
  { runner: { x: 340, z: CS[2], yaw: -Math.PI / 2 }, cop: { x: 420, z: CS[2], yaw: -Math.PI / 2 } },
  { runner: { x: -280, z: 400, yaw: Math.PI / 2 }, cop: { x: -360, z: 400, yaw: Math.PI / 2 } },
];

const landmarks = [
  { name: 'Clock Tower', x: TOWER.x, z: TOWER.z },
  { name: 'Gasworks', x: GAS.x, z: GAS.z },
  { name: 'Pier 9', x: -110, z: 485 },
  { name: 'Lookout Hill', x: -400, z: -390 },
  { name: 'Canal Bridges', x: 206, z: 180 },
  { name: 'Bayside Park', x: PARK ? (PARK.x0 + PARK.x1) / 2 : -120, z: PARK ? (PARK.z0 + PARK.z1) / 2 : 110 },
];

const PAL = ['#e9d8c4', '#c9d8e8', '#f0c9b4', '#d4e2c4', '#e8d3a1', '#cdbfe0', '#d9b8a8', '#bcd3d0'];

function slab(b, x0, z0, x1, z1, dy, col, step = 20) {
  const nx = Math.max(1, Math.ceil((x1 - x0) / step)); const nz = Math.max(1, Math.ceil((z1 - z0) / step));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = x0 + ((x1 - x0) * i) / nx; const c = x0 + ((x1 - x0) * (i + 1)) / nx; const p = z0 + ((z1 - z0) * j) / nz; const q = z0 + ((z1 - z0) * (j + 1)) / nz;
    b.quadUp(a, height(a, p) + dy, p, a, height(a, q) + dy, q, c, height(c, q) + dy, q, c, height(c, p) + dy, p, col);
  }
}

export const DOCKSIDE = {
  id: 'dockside', name: 'Dockside', blurb: 'A harbour town: canal bridges, a clock tower and a hill to lose them on',
  bounds: B, height, roads, open, solids, water, spawns, landmarks, ground: '#a6c97a',
  sky: { top: '#7fb0e3', horizon: '#f2e6cf', fog: '#efe4cf', fogNear: 140, fogFar: 560, sun: { bearing: 220, elev: 34 } },
  build(THREE, kit) {
    const P = kit.palette; const dark = kit.dark;
    const builders = new Map();
    const bAt = (x, z) => { const g = kit.chunk(x, z); let b = builders.get(g); if (!b) { b = kit.builder(); builders.set(g, b); } return b; };
    const mixc = (a, c, k) => [a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k];
    const hexc = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
    const nightK = dark ? 0.5 : 0;
    const shade = (c) => mixc(c, [0.08, 0.08, 0.14], nightK);
    const walk = shade([0.83, 0.81, 0.77]); const roofC = shade([0.42, 0.4, 0.44]);
    // sidewalks under every block (2.5 m out to the curb)
    for (const bl of blocks) {
      const e = 3.2;
      const b = bAt((bl.x0 + bl.x1) / 2, (bl.z0 + bl.z1) / 2);
      if (bl === PARK) slab(b, bl.x0 - e, bl.z0 - e, bl.x1 + e, bl.z1 + e, 0.13, shade([0.5, 0.7, 0.4]));
      else slab(b, bl.x0 - e, bl.z0 - e, bl.x1 + e, bl.z1 + e, 0.13, walk);
    }
    // buildings
    for (const bd of buildings) {
      const b = bAt(bd.x, bd.z);
      const y0 = Math.min(height(bd.x - bd.w / 2, bd.z - bd.d / 2), height(bd.x + bd.w / 2, bd.z + bd.d / 2), height(bd.x, bd.z)) - 0.5;
      const col = shade(hexc(PAL[bd.c % PAL.length]));
      if (bd.kind === 'house') {
        b.boxOn(bd.x, y0, bd.z, bd.w, bd.h * 0.62 + 0.5, bd.d, 0, col, 0.1, 2);
        b.add(b.T.roof, bd.x, y0 + bd.h * 0.62 + 0.5 + bd.h * 0.2, bd.z, bd.w + 1.2, bd.h * 0.4, bd.d + 1.2, 0, shade([0.66, 0.32, 0.26]), 0.1);
        b.boxOn(bd.x + bd.w * 0.25, y0, bd.z + bd.d / 2 + 0.05, 1.4, 2.6, 0.2, 0, shade([0.4, 0.28, 0.2]), 0);
      } else if (bd.kind === 'shed') {
        b.boxOn(bd.x, y0, bd.z, bd.w, bd.h, bd.d, 0, mixc(col, [0.5, 0.55, 0.6], 0.4), 0.12, 0);
        b.add(b.T.roof, bd.x, y0 + bd.h + 1.5, bd.z, bd.w + 0.6, 3, bd.d + 0.6, 0, roofC, 0.1);
        for (let k = -1; k <= 1; k += 2) b.boxOn(bd.x + k * bd.w * 0.25, y0, bd.z + bd.d / 2 + 0.06, bd.w * 0.3, Math.min(5, bd.h * 0.6), 0.12, 0, shade([0.36, 0.38, 0.42]), 0);
      } else {
        b.boxOn(bd.x, y0, bd.z, bd.w, bd.h, bd.d, 0, col, 0.14, 2);
        b.boxOn(bd.x, y0 + bd.h, bd.z, bd.w + 0.6, 0.6, bd.d + 0.6, 0, mixc(col, [0, 0, 0], 0.22), 0.08);
        if (bd.h > 30) b.boxOn(bd.x + bd.w * 0.15, y0 + bd.h + 0.6, bd.z - bd.d * 0.1, bd.w * 0.35, 3.5, bd.d * 0.35, 0, roofC, 0.08);
        b.boxOn(bd.x, y0, bd.z, bd.w + 0.4, 4.2, bd.d + 0.4, 0, mixc(col, [0.2, 0.2, 0.25], 0.35), 0.06); // shopfront band
      }
    }
    // clock tower
    { const b = bAt(TOWER.x, TOWER.z); const c = shade([0.86, 0.76, 0.6]);
      b.boxOn(TOWER.x, 0, TOWER.z, 18, 50, 18, 0, c, 0.18, 2);
      b.boxOn(TOWER.x, 50, TOWER.z, 15, 10, 15, 0, shade([0.78, 0.68, 0.52]), 0.14);
      for (const [dx, dz, ry] of [[0, 7.6, 0], [0, -7.6, Math.PI], [7.6, 0, Math.PI / 2], [-7.6, 0, -Math.PI / 2]]) {
        b.add(b.T.cyl, TOWER.x + dx, 55, TOWER.z + dz, 7, 0.4, 7, ry, [0.98, 0.96, 0.88], 0.12, 3, null, Math.PI / 2);
        b.add(b.T.box, TOWER.x + dx * 1.04, 56.2, TOWER.z + dz * 1.04, 0.35, 2.6, 0.2, ry, P.outline, 0);
      }
      b.add(b.T.cone, TOWER.x, 66, TOWER.z, 16, 12, 16, 0, shade([0.36, 0.5, 0.46]), 0.14); }
    // gasworks
    for (const [dx, dz, r] of [[-22, -18, 13], [18, -20, 15], [0, 22, 12]]) {
      const b = bAt(GAS.x + dx, GAS.z + dz);
      b.cyl(GAS.x + dx, 0, GAS.z + dz, r, 20, shade([0.6, 0.66, 0.7]), 0.16);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.boxOn(GAS.x + dx + Math.cos(a) * (r + 0.5), 0, GAS.z + dz + Math.sin(a) * (r + 0.5), 0.6, 22, 0.6, a, shade([0.3, 0.32, 0.36]), 0.05); }
      b.add(b.T.box, GAS.x + dx, 20.3, GAS.z + dz, r * 2.05, 0.6, r * 2.05, 0, shade([0.5, 0.55, 0.6]), 0.06);
    }
    // water + canal banks
    const wc = dark ? [0.1, 0.18, 0.34] : [0.36, 0.6, 0.82]; const wc2 = dark ? [0.16, 0.26, 0.44] : [0.56, 0.76, 0.92];
    const quad = (x0, z0, x1, z1, y, c) => { const b = bAt((x0 + x1) / 2, (z0 + z1) / 2); b.quadUp(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0, c); };
    for (let z = CANAL.z0; z < HARBOR_Z; z += 40) quad(CANAL.x0, z, CANAL.x1, Math.min(HARBOR_Z, z + 40), -0.8, wc);
    for (let x = B.x0; x < B.x1; x += 100) for (let z = HARBOR_Z; z < B.z1 + 400; z += 100) {
      if (x >= -200 && x < -20 && z < 520) continue;
      quad(x, z, Math.min(x + 100, B.x1 + 400), z + 100, -0.8, ((x / 100 + z / 100) & 1) ? wc : mixc(wc, wc2, 0.25));
    }
    // ripples: short light dashes on the water
    const rr = kit.seeded(7);
    for (let k = 0; k < 160; k++) {
      const x = B.x0 + rr() * (B.x1 - B.x0); const z = HARBOR_Z + 8 + rr() * 140;
      if (x > -205 && x < -15 && z < 525) continue;
      quad(x, z, x + 4 + rr() * 6, z + 0.5, -0.76, wc2);
    }
    // canal walls (visual): concrete faces from the water to the bank
    for (const x of [CANAL.x0, CANAL.x1]) {
      const b = bAt(x, 200);
      for (let z = CANAL.z0; z < HARBOR_Z; z += 30) bAt(x, z).boxOn(x, -1.2, z + 15, 0.8, 1.35, 30, 0, shade([0.7, 0.68, 0.64]), 0.04);
      void b;
    }
    bAt(206, CANAL.z0).boxOn(206, -1.2, CANAL.z0, CANAL.x1 - CANAL.x0 + 0.8, 1.35, 0.8, 0, shade([0.7, 0.68, 0.64]), 0.04);
    // harbour wall + pier deck
    for (let x = B.x0; x < B.x1; x += 40) bAt(x + 20, HARBOR_Z).boxOn(x + 20, -1.2, HARBOR_Z - 0.3, 40, 1.35, 0.8, 0, shade([0.7, 0.68, 0.64]), 0.04);
    slab(bAt(-110, 480), -200, HARBOR_Z, -20, 520, 0.02, shade([0.62, 0.5, 0.38]), 30);
    for (let x = -200; x < -20; x += 6) bAt(x, 482).boxOn(x + 3, 0.03, 482, 0.12, 0.02, 76, 0, shade([0.5, 0.4, 0.3]), 0);
    // beach
    slab(bAt(-360, 430), -520, 416, -210, HARBOR_Z, -0.01, shade([0.93, 0.84, 0.62]), 40);
    // containers
    for (let k = 0; k < 6; k++) {
      const x = -150 + (k % 3) * 34; const z = 470 + Math.floor(k / 3) * 22;
      const c = shade(hexc(['#d4553f', '#3d7cc9', '#e3b23c', '#3f9b6e', '#d4553f', '#7a5ac4'][k]));
      const b = bAt(x, z); b.boxOn(x, 0.05, z, 13, 5.2, 5.5, 0, c, 0.1);
      for (let q = -5; q <= 5; q += 1.25) b.boxOn(x + q, 0.05, z + 2.78, 0.2, 5.2, 0.06, 0, mixc(c, [0, 0, 0], 0.25), 0);
    }
    // park fountain
    if (PARK) { const x = (PARK.x0 + PARK.x1) / 2; const z = (PARK.z0 + PARK.z1) / 2; const b = bAt(x, z);
      b.add(b.T.box, x, 0.6, z, 10, 1.2, 10, 0.785, shade([0.82, 0.8, 0.76]), 0.1);
      b.add(b.T.box, x, 1.25, z, 8.4, 0.1, 8.4, 0.785, wc, 0);
      b.cyl(x, 1.2, z, 0.8, 2.5, shade([0.82, 0.8, 0.76]), 0.06); b.sphere(x, 4, z, 0.9, wc2, 0.05); }
    // a lighthouse-ish beacon at the pier end
    { const b = bAt(-160, 492); b.cyl(-170, 0, 508, 2, 9, [0.95, 0.95, 0.93], 0.1); b.cyl(-170, 3, 508, 2.05, 1.6, P.red, 0); b.cyl(-170, 9, 508, 1.4, 2, [1, 0.9, 0.5], 0.06, 3); b.cone(-170, 11, 508, 2, 2.2, P.red, 0.08); }
    for (const [g, b] of builders) if (!b.empty) g.add(b.mesh(kit.toon(null, { vertexColors: true })));
    return null;
  },
  backdrop(THREE, kit) {
    const b = kit.builder(); const dark = kit.dark;
    const m = (c) => (dark ? c.map((v) => v * 0.45) : c);
    const rr = kit.seeded(31);
    // mountains to the north, hills east and west, an island to the south
    for (let k = 0; k < 26; k++) {
      const a = -1.25 + (k / 25) * 2.5; const d = 1700 + rr() * 900;
      const x = Math.sin(a) * d; const z = -Math.cos(a) * d; const h = 260 + rr() * 380; const r = 380 + rr() * 300;
      b.add(b.T.cone5, x, h / 2 - 20, z, r * 2, h, r * 2, rr() * 3, m(k % 2 ? [0.55, 0.62, 0.72] : [0.62, 0.68, 0.78]), 0);
      if (h > 480) b.add(b.T.cone5, x, h - (h * 0.18) / 2 - 20, z, r * 0.36 * 2, h * 0.18, r * 0.36 * 2, 0, m([0.96, 0.96, 0.98]), 0);
    }
    for (let k = 0; k < 14; k++) {
      const side = k % 2 ? 1 : -1; const z = -900 + (k >> 1) * 260; const x = side * (1600 + rr() * 500);
      b.sphere(x, -40, z, 260 + rr() * 160, m([0.5, 0.64, 0.5]), 0, 0, 0.45);
    }
    b.sphere(500, -30, 2100, 420, m([0.48, 0.6, 0.46]), 0, 0, 0.35);
    b.cyl(560, 90, 2000, 14, 70, m([0.96, 0.96, 0.94]), 0); b.cyl(560, 160, 2000, 16, 14, [1, 0.88, 0.45], 0, 3);
    return b.mesh(kit.toon(null, { vertexColors: true }));
  },
};
