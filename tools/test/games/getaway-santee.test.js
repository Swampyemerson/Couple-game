// Getaway: the Santee map (js/games/getaway/maps/santee*.js) against docs/games/getaway-maps.md.
//   node tools/test/games/getaway-santee.test.js
//   ONLY=static | engine     PORT=8946 (uses PORT only; keep within 8945–8949)
//   SHOTS=dir (default: $TMPDIR/getaway-santee-shots)   QUALITY=high|mid|low   DARK=1
//
// static  Node: contract shape, determinism, spawns (on the same road, cop 60–100 m behind, clear of
//         solids and water), landmarks (incl. the home), solids (kinds, styles, drawn), drawn solids
//         clear of the engine's smoothed roads, water clear of roads, flat roads, every road
//         connected, cul-de-sac escape paths, the cats non-solid and off the roads, height speed.
// engine  Chromium: the engine's own buildWorld() on the map (feature-detected), budgets (total
//         tris, build time, longest block, draw calls + tris at chase-cam views), canvas textures,
//         no page errors, screenshots of the key spots.
// game    The real game (dist build via the harness, phone 844x390): Santee as the saved map,
//         budgets from every spawn + sampled roads + the home, a practice round with the intro,
//         the AI driving the main routes (Mission Gorge, Mast, SR-52, Magnolia, Cuyamaca, Carlton
//         Hills, Fanita Pkwy, Weston Rd), the sandy riverbed (slow, dry), a lake (busts), the
//         cats at 8524 Boulder Way, the minimap. Uses PORT+1.
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { pathToFileURL } = require('url');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'getaway-santee-shots');
const PORT = Number(process.env.PORT) || 8946;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const BUDGET = { calls: 90, viewTris: 220000, totalTris: 900000, buildMs: 1500, blockMs: 200, textures: 2 };
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log('FAIL -', m); return false; } console.log('ok -', m); return true; };
const warn = (c, m) => { console.log(c ? 'ok -' : 'WARN -', m); return c; };
fs.mkdirSync(SHOTS, { recursive: true });
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// ─────────────────────────────────────────────────────────────────────
async function staticSection() {
  console.log('\n# static');
  const { SANTEE: M } = await imp('js/games/getaway/maps/santee.js');
  const { layoutSteps, makeLayout } = await imp('js/games/getaway/maps/santee-layout.js');
  const { createGeo, BREAKABLE } = await imp('js/games/getaway/geo.js');

  // shape
  ok(M.id === 'santee' && M.name === 'Santee' && !M.stub, 'santee: real map (no stub flag)');
  const B = M.bounds;
  ok(B && B.x1 - B.x0 >= 1200 && B.x1 - B.x0 <= 2800 && B.z1 - B.z0 >= 1200 && B.z1 - B.z0 <= 2800, `bounds ${B.x1 - B.x0} x ${B.z1 - B.z0} m`);
  ok(typeof M.build === 'function' && typeof M.backdrop === 'function' && typeof M.height === 'function', 'build, backdrop and height are functions');
  const KINDS = ['highway', 'arterial', 'street', 'alley', 'dirt', 'ramp'];
  const badRoad = M.roads.filter((r) => !KINDS.includes(r.kind) || !(r.width >= 4 && r.width <= 40) || r.pts.length < 2 || r.pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1])));
  ok(M.roads.length > 50 && !badRoad.length, `${M.roads.length} roads, kinds/widths/points valid${badRoad.length ? ': ' + badRoad.map((r) => r.name).join(', ') : ''}`);
  let close = 0;
  for (const r of M.roads) for (let i = 1; i < r.pts.length; i++) if (Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]) < 7.99) close++;
  ok(close === 0, `road points ≥ 8 m apart (${close} too close)`);
  const named = new Set(M.roads.map((r) => r.name));
  for (const n of ['Mission Gorge Rd', 'Magnolia Ave', 'Cuyamaca St', 'Mast Blvd', 'Carlton Hills Blvd', 'Prospect Ave', 'Fanita Pkwy', 'Town Center Pkwy', 'SR-52', 'SR-125', 'SR-67', 'Weston Rd', 'Toyon Pl', 'Boulder Way']) ok(named.has(n), `road: ${n}`);
  ok(M.roads.some((r) => r.bridge && r.clear > 0), `bridges with clearance: ${M.roads.filter((r) => r.bridge).map((r) => r.name).join(', ')}`);
  ok(M.roads.filter((r) => r.kind === 'ramp').length >= 8, `${M.roads.filter((r) => r.kind === 'ramp').length} freeway ramps`);

  // determinism (fresh generator runs, compared as JSON)
  const snap = (L) => JSON.stringify({ r: L.roads, o: L.open, s: L.solids, w: L.water, sp: L.spawns, l: L.landmarks });
  const t0 = Date.now();
  const A = makeLayout();
  const layoutMs = Date.now() - t0;
  const g = layoutSteps(); let st = g.next(); let slices = 0; let maxSlice = 0; let ts = Date.now();
  while (!st.done) { maxSlice = Math.max(maxSlice, Date.now() - ts); slices++; ts = Date.now(); st = g.next(); }
  ok(snap(A) === snap(st.value), 'layout is deterministic (two runs identical)');
  warn(layoutMs < 600, `layout ${layoutMs} ms in Node, ${slices} slices, longest ${maxSlice} ms`);
  ok(!/__q|NaN/.test(JSON.stringify(M.solids)), 'solids carry no internal fields or NaN');

  // geo (the engine's own queries)
  const geo = createGeo(M);
  const nq = {};
  // spawns
  ok(M.spawns.length >= 8, `${M.spawns.length} spawn pairs`);
  const solidsHit = (x, z, r) => M.solids.some((s) => { const c = Math.cos(s.rot || 0), sn = Math.sin(s.rot || 0); const dx = x - s.x, dz = z - s.z; const lx = dx * c - dz * sn, lz = dx * sn + dz * c; return Math.abs(lx) < s.w / 2 + r && Math.abs(lz) < s.d / 2 + r; });
  for (const [i, sp] of M.spawns.entries()) {
    const d = Math.hypot(sp.runner.x - sp.cop.x, sp.runner.z - sp.cop.z);
    geo.nearestRoad(sp.runner.x, sp.runner.z, nq, 30); const rr = nq.road >= 0 ? geo.roads[nq.road] : null; const rd = nq.d;
    geo.nearestRoad(sp.cop.x, sp.cop.z, nq, 30); const cr = nq.road >= 0 ? geo.roads[nq.road] : null; const cd = nq.d;
    const fx = Math.sin(sp.runner.yaw), fz = -Math.cos(sp.runner.yaw); // compass yaw: 0 = north (-z)
    const behind = ((sp.runner.x - sp.cop.x) * fx + (sp.runner.z - sp.cop.z) * fz) / d;
    ok(rr && cr && rr.name === cr.name && rd < rr.hw && cd < cr.hw && d >= 60 && d <= 100 && behind > 0.8
      && !solidsHit(sp.runner.x, sp.runner.z, 1.5) && !solidsHit(sp.cop.x, sp.cop.z, 1.5) && geo.surfaceAt(sp.runner.x, sp.runner.z) !== 'water',
    `spawn ${i} (${sp.where}): same road ${rr && rr.name}, cop ${d.toFixed(0)} m behind, on the asphalt, clear`);
  }
  const quads = new Set(M.spawns.map((s) => `${s.runner.x > -250 ? 'E' : 'W'}${s.runner.z > -300 ? 'S' : 'N'}`));
  ok(quads.size === 4, `spawns spread over all four quarters (${[...quads].join(' ')})`);
  ok(M.spawns.some((s) => Math.hypot(s.runner.x + 1232, s.runner.z + 614) < 200), 'a spawn pair in Weston, near Boulder Way');

  // landmarks
  const lm = new Map(M.landmarks.map((l) => [l.name, l]));
  for (const n of ['Santee Lakes', 'Santee Town Center', 'Trolley', 'San Diego River', 'Santana High', 'Mission Gorge', 'Cowles Mtn', '8524 Boulder Way']) ok(lm.has(n), `landmark: ${n}`);
  const home = lm.get('8524 Boulder Way');
  ok(home && home.home === true, 'the home landmark has home: true');
  geo.nearestRoad(home.x, home.z, nq, 40, (r) => r.name === 'Boulder Way');
  ok(nq.road >= 0 && nq.d < 22, `8524 Boulder Way sits on Boulder Way (${nq.d.toFixed(1)} m from its centre line)`);
  const L = makeLayout();
  ok(L.deco.home && L.deco.home.num === 8524 && L.deco.home.style === 'prism', 'the hero house is #8524, a Prism-at-Weston style home');
  // Boulder Way geometry: Mast > Weston Rd (north) > right (east) on Toyon Pl > left (north) on Boulder Way
  const rd = (n) => M.roads.find((r) => r.name === n);
  const wr = rd('Weston Rd'), tp = rd('Toyon Pl'), bw = rd('Boulder Way');
  ok(wr.pts[1][1] < wr.pts[0][1], 'Weston Rd leaves Mast Blvd heading north');
  ok(tp.pts[tp.pts.length - 1][0] > tp.pts[0][0], 'Toyon Pl runs east (right) from Weston Rd');
  ok(bw.pts[bw.pts.length - 1][1] < bw.pts[0][1] && Math.hypot(bw.pts[0][0] - tp.pts[2][0], bw.pts[0][1] - tp.pts[2][1]) < 2, 'Boulder Way runs north (left) from Toyon Pl');

  // solids
  const SOLID = ['building', 'wall', 'rock', 'tree', 'pole', 'barrier', 'bollard', 'shrub', 'sign', 'mailbox', 'hydrant', 'lamp', 'signal', 'cactus', 'car'];
  const STYLES = ['cottonwood', 'tree', 'pine', 'aspen', 'palm', 'jacaranda', 'lamp', 'signal', 'bollard', 'hydrant', 'pole', 'sign', 'mailbox', 'cactus', 'shrub'];
  const badS = M.solids.filter((s) => !SOLID.includes(s.kind) || ![s.x, s.z, s.w, s.d, s.rot, s.h].every(Number.isFinite) || (!s.drawn && !STYLES.includes(s.style)) || (s.drawn && BREAKABLE[s.kind]));
  ok(!badS.length, `${M.solids.length} solids valid (kinds, numbers, styles; breakables engine-drawn)`);
  const bykind = {}; for (const s of M.solids) bykind[s.kind + (s.drawn ? '' : '/' + s.style)] = (bykind[s.kind + (s.drawn ? '' : '/' + s.style)] || 0) + 1;
  console.log('  ', JSON.stringify(bykind));
  // drawn solids clear of the engine's smoothed road ribbons (bridges excluded: things pass under)
  const onRoad = [];
  for (const s of M.solids) {
    if (!s.drawn || s.kind === 'barrier') continue;
    const c = Math.cos(s.rot), sn = Math.sin(s.rot);
    const pts = [[0, 0], [-s.w / 2, -s.d / 2], [s.w / 2, -s.d / 2], [s.w / 2, s.d / 2], [-s.w / 2, s.d / 2]];
    for (const [lx, lz] of pts) {
      const x = s.x + c * lx + sn * lz, z = s.z - sn * lx + c * lz;
      geo.nearestRoad(x, z, nq, 30, (r) => !r.bridge);
      if (nq.road >= 0 && nq.d < geo.roads[nq.road].hw - 0.3) { onRoad.push(`${s.kind}@${s.x.toFixed(0)},${s.z.toFixed(0)} on ${geo.roads[nq.road].name}`); break; }
    }
  }
  const propsOn = M.solids.filter((s) => { if (s.drawn) return false; geo.nearestRoad(s.x, s.z, nq, 30, (r) => !r.bridge); return nq.road >= 0 && nq.d < geo.roads[nq.road].hw - 0.3; });
  ok(propsOn.length === 0, `engine-drawn props clear of the roads${propsOn.length ? ': ' + propsOn.slice(0, 6).map((s) => `${s.style}@${s.x},${s.z}`).join('; ') : ''}`);
  ok(onRoad.length === 0, `drawn solids clear of the roads${onRoad.length ? ': ' + onRoad.slice(0, 8).join('; ') : ''}`);
  // v2 collisions audit: no solid inside any road's asphalt + 0.3 m (dense sampling of the whole
  // footprint, not just corners), and no traffic lane runs through a solid. Overhead solids (base
  // above 2 m) and bridge decks are excluded; nothing on Santee is allow-listed.
  {
    const HARD = { building: 1, wall: 1, rock: 1, barrier: 1, car: 1 };
    const intr = [];
    for (const s of M.solids) {
      if (!HARD[s.kind] || (s.y || 0) > 2) continue;
      const c = Math.cos(s.rot || 0), sn = Math.sin(s.rot || 0);
      const nx = Math.max(1, Math.ceil(s.w / 1.5)), nz = Math.max(1, Math.ceil(s.d / 1.5));
      let hit = null;
      for (let i = 0; i <= nx && !hit; i++) for (let j = 0; j <= nz && !hit; j++) {
        const lx = -s.w / 2 + (s.w * i) / nx, lz = -s.d / 2 + (s.d * j) / nz;
        const x = s.x + c * lx + sn * lz, z = s.z - sn * lx + c * lz;
        geo.nearestRoad(x, z, nq, 40, (r) => !r.bridge);
        if (nq.road >= 0 && nq.d < geo.roads[nq.road].hw + 0.3) hit = geo.roads[nq.road].name;
      }
      if (hit) intr.push(`${s.kind}@${s.x.toFixed(0)},${s.z.toFixed(0)} (${s.w.toFixed(0)}x${s.d.toFixed(0)}) on ${hit}`);
    }
    ok(intr.length === 0, `no solid inside a road's asphalt + 0.3 m${intr.length ? ` (${intr.length}): ` + intr.slice(0, 8).join('; ') : ''}`);
    // traffic lanes vs solids (a coarse grid of the hard solids, then exact box tests)
    const G = new Map(); const GC = 20; const gk = (i, j) => i * 100003 + j;
    for (const s of M.solids) {
      if (!HARD[s.kind] || (s.y || 0) > 2) continue;
      const r0 = Math.hypot(s.w, s.d) / 2;
      for (let i = Math.floor((s.x - r0) / GC); i <= Math.floor((s.x + r0) / GC); i++) for (let j = Math.floor((s.z - r0) / GC); j <= Math.floor((s.z + r0) / GC); j++) { const k = gk(i, j); if (!G.has(k)) G.set(k, []); G.get(k).push(s); }
    }
    const inBox = (s, x, z, pad) => { const c = Math.cos(s.rot || 0), sn = Math.sin(s.rot || 0); const dx = x - s.x, dz = z - s.z; return Math.abs(dx * c - dz * sn) < s.w / 2 + pad && Math.abs(dx * sn + dz * c) < s.d / 2 + pad; };
    const laneHits = []; const out = {};
    for (const r of geo.roads) {
      if (!r.traffic || r.bridge) continue;
      const lw = r.hw / r.lanes;
      for (let sd = 2; sd < r.len - 2; sd += 3) {
        geo.sampleRoad(r, sd, out);
        for (const dir of r.oneway ? [1] : [1, -1]) for (let k = 0; k < r.lanes; k++) {
          const off = dir * (k + 0.5) * lw; const x = out.x - out.tz * off, z = out.z + out.tx * off;
          const l = G.get(gk(Math.floor(x / GC), Math.floor(z / GC))); if (!l) continue;
          for (const s of l) if (inBox(s, x, z, 0.9)) { laneHits.push(`${r.name}@${x.toFixed(0)},${z.toFixed(0)} through ${s.kind}`); break; }
        }
      }
    }
    ok(laneHits.length === 0, `no traffic lane runs through a solid${laneHits.length ? ` (${laneHits.length}): ` + laneHits.slice(0, 8).join('; ') : ''}`);
  }
  // the AI's road graph (engine v2, feature-detected): one component, and the Weston loop routes
  // out through its stem to Mast Blvd (the practice cop used to cut across lawns here)
  try {
    const { buildRoadGraph } = await imp('js/games/getaway/roadgraph.js');
    const tg = Date.now(); const RG = buildRoadGraph(geo); const gms = Date.now() - tg;
    const dist = RG.newDist(), prev = RG.newPrev(), src = [], loc = {}, loc2 = {}, res = {};
    const mg = RG.locate(0, 0, Math.PI / 2, {});
    RG.dijkstra(RG.sourcesFor(mg, 0, src), dist, prev);
    let unreach = 0; for (let n = 0; n < RG.nodes.n; n++) if (!Number.isFinite(dist[n])) unreach++;
    ok(unreach === 0, `road graph (${RG.nodes.n} nodes, ${gms} ms): every node reachable from Mission Gorge Rd${unreach ? ` (${unreach} not)` : ''}`);
    const mast = RG.locate(-1300, -398, 0, loc2, 30);
    const far = [[-1430, -624], [-1462, -548], [-1388, -638], [-1340, -626], [-1420, -462], [-1236, -620], [-1500, -604]];
    const slow = [];
    for (const [x, z] of far) {
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        RG.locate(x, z, yaw, loc, 30);
        RG.dijkstra(RG.sourcesFor(loc, 8, src), dist, prev);
        const c = RG.costTo(mast, dist, res).cost;
        // straight-line distance at 15 m/s, x 2.6 for the winding loop + a possible U-turn
        const lim = (Math.hypot(x + 1300, z + 398) / 15) * 2.6 + 6;
        if (!(c < lim)) slow.push(`${x},${z}@${yaw.toFixed(1)}: ${c.toFixed(1)} s > ${lim.toFixed(1)}`);
      }
    }
    ok(!slow.length, `Weston streets route out to Mast Blvd via the Weston Rd stem${slow.length ? ': ' + slow.slice(0, 4).join('; ') : ''}`);
    const wl = RG.roads.find((r) => r.name === 'Weston Rd' && r.closed);
    ok(wl && RG.roadNodes[wl.idx].length >= 5, `the Weston Rd loop is a closed road with ${wl ? RG.roadNodes[wl.idx].length : 0} junction nodes (stem, Toyon Pl, Yucca St x2, the courts)`);
  } catch (e) { warn(false, 'road graph check skipped: ' + e.message); }
  // water clear of non-bridge roads
  let wet = 0;
  for (const r of geo.roads) { if (r.bridge) continue; for (let i = 0; i < r.n; i += 2) if (geo.surfaceAt(r.x[i], r.z[i]) === 'water') wet++; }
  ok(wet === 0, `no road runs into water (${wet} samples)`);
  const lakeIn = [[-985, -585], [-1000, -705], [-990, -830], [-1005, -960], [-995, -1075]].filter(([x, z]) => geo.surfaceAt(x, z) !== 'water');
  ok(!lakeIn.length, `the engine reads all five Santee Lakes as water${lakeIn.length ? ': not ' + JSON.stringify(lakeIn) : ''}`);
  warn([[-170, -186], [880, -232]].every(([x, z]) => geo.surfaceAt(x, z) === 'water'), 'the river pools read as water (needs the engine to check water before open polys)');
  ok(M.water.length >= 5, `${M.water.length} water polygons (Santee Lakes + river pools)`);
  ok(M.open.some((o) => o.kind === 'sand') && M.open.some((o) => o.kind === 'lot') && M.open.some((o) => o.kind === 'grass') && M.open.some((o) => o.kind === 'dirt'), 'open ground has sand, lots, grass and dirt');

  // roads flat enough (≤ 12 %) outside bridges
  let steep = 0;
  for (const r of geo.roads) { if (r.bridge) continue; for (let i = 1; i < r.n; i++) { const dl = r.cum[i] - r.cum[i - 1]; if (dl > 1 && Math.abs(geo.ground(r.x[i], r.z[i]) - geo.ground(r.x[i - 1], r.z[i - 1])) / dl > 0.12) steep++; } }
  ok(steep === 0, `road slopes ≤ 12 % (${steep} steep samples)`);
  // height is fast
  const th = Date.now(); let acc = 0;
  for (let i = 0; i < 200000; i++) acc += M.height(B.x0 + (i * 13.7) % (B.x1 - B.x0), B.z0 + (i * 7.3) % (B.z1 - B.z0));
  ok(Number.isFinite(acc) && Date.now() - th < 120, `height(): 200k calls in ${Date.now() - th} ms`);

  // connectivity: every road reachable from Mission Gorge Rd (touching = within both half widths)
  const R = geo.roads; const adj = R.map(() => []);
  for (let a = 0; a < R.length; a++) for (const i of [0, R[a].n - 1, ...Array.from({ length: Math.floor(R[a].n / 4) }, (_, k) => k * 4)]) {
    geo.nearestRoad(R[a].x[i], R[a].z[i], nq, 40, (o) => o !== R[a]);
    if (nq.road >= 0 && nq.d < R[nq.road].hw + R[a].hw + 3) { adj[a].push(nq.road); adj[nq.road].push(a); }
  }
  const seen = new Set([R.findIndex((r) => r.name === 'Mission Gorge Rd')]); const q = [...seen];
  while (q.length) { const a = q.pop(); for (const b of adj[a]) if (!seen.has(b)) { seen.add(b); q.push(b); } }
  const lost = R.filter((r, i) => !seen.has(i)).map((r) => r.name);
  ok(lost.length === 0, `all ${R.length} road pieces connected${lost.length ? ': missing ' + lost.join(', ') : ''}`);
  // cul-de-sacs: most have an escape path
  const { culs, paths } = L.deco.stats;
  ok(culs >= 30 && paths / culs >= 0.6, `${culs} cul-de-sacs, ${paths} with a footpath out (${Math.round((100 * paths) / culs)} %)`);
  // the cats: 4–6, varied coats, non-solid, never on a road
  const cats = L.deco.cats;
  ok(cats.length >= 4 && cats.length <= 6 && new Set(cats.map((c) => c.coat)).size >= 4, `${cats.length} cats at the house: ${cats.map((c) => `${c.coat} (${c.where})`).join(', ')}`);
  ok(cats.every((c) => { geo.nearestRoad(c.x, c.z, nq, 30); return nq.road < 0 || nq.d > geo.roads[nq.road].hw + 1; }), 'no cat sits on a road');
  ok(!M.solids.some((s) => s.cat), 'cats are not solids');
  return M;
}

// ─────────────────────────────────────────────────────────────────────
function threePath() {
  const out = path.join(__dirname, '..', '.cache', 'three.min.js'); // tools/test/.cache
  if (fs.existsSync(out)) return out;
  const dir = path.dirname(out); fs.mkdirSync(dir, { recursive: true });
  execSync('npm pack three@0.128.0 --silent', { cwd: dir, stdio: 'pipe' });
  execSync('tar -xzf three-0.128.0.tgz package/build/three.min.js', { cwd: dir });
  fs.renameSync(path.join(dir, 'package/build/three.min.js'), out);
  return out;
}
const PAGE = `<!doctype html><meta charset="utf-8"><style>body{margin:0;overflow:hidden;background:#000}canvas{display:block}</style>
<script src="/three.min.js"></script>
<script type="module">
const q = new URLSearchParams(location.search);
const W = +q.get('w'), Hh = +q.get('h'), dark = q.get('dark') === '1';
const texs = []; const TT = THREE.CanvasTexture; THREE.CanvasTexture = class extends TT { constructor(...a) { super(...a); texs.push(this); } };
const { SANTEE: M } = await import('/js/games/getaway/maps/santee.js');
const { makePalette, makeUniforms } = await import('/js/games/getaway/gfx.js');
const { createGeo } = await import('/js/games/getaway/geo.js');
const { buildWorld } = await import('/js/games/getaway/world.js');
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(W, Hh); renderer.setPixelRatio(1); renderer.autoClear = false;
document.body.appendChild(renderer.domElement);
let maxPrep = 0, t = performance.now();
const tp = performance.now();
await M.prepare({ slice: () => { maxPrep = Math.max(maxPrep, performance.now() - t); return new Promise((r) => setTimeout(() => { t = performance.now(); r(); }, 0)); } });
maxPrep = Math.max(maxPrep, performance.now() - t);
const prepMs = performance.now() - tp;
const P = makePalette(dark ? { bg: '#16151c', ink: '#f1eee8', dark: true } : { bg: '#f6f3ee', ink: '#1c1a22' });
const U = makeUniforms(THREE, P);
const geo = createGeo(M);
const world = await buildWorld(THREE, M, geo, P, U, { quality: q.get('quality') || 'high' });
const camera = new THREE.PerspectiveCamera(62, W / Hh, 0.5, 4000);
const car = (b, t2) => { const g = new THREE.Group(); const m1 = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 4.5), new THREE.MeshBasicMaterial({ color: b })); m1.position.y = 0.75; const m2 = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), new THREE.MeshBasicMaterial({ color: t2 })); m2.position.set(0, 1.45, -0.2); g.add(m1, m2); return g; };
const runner = car(0xd23a2a, 0x2a2a30), cop = car(0x15161a, 0xf2f2f2); world.scene.add(runner, cop);
const place = (c, p) => { c.position.set(p.x, Math.max(0, M.height(p.x, p.z)), p.z); c.rotation.y = p.yaw; };
window.view = (v) => {
  if (v.spawn != null) { const s = M.spawns[v.spawn]; const cv = (p) => ({ ...p, yaw: Math.PI - p.yaw }); place(runner, cv(s.runner)); place(cop, cv(s.cop)); v = { x: s.runner.x, z: s.runner.z, yaw: Math.PI - s.runner.yaw, ...v }; }
  else if (v.x != null) { place(runner, v); place(cop, { x: v.x - Math.sin(v.yaw) * 30, z: v.z - Math.cos(v.yaw) * 30, yaw: v.yaw }); }
  if (v.home) {
    const lm = M.landmarks.find((l) => l.home); let best = null;
    for (const so of M.solids) if (so.kind === 'building') { const d = Math.hypot(so.x - lm.x, so.z - lm.z); if (!best || d < best.d) best = { d, so }; }
    const h = best.so, fx = -Math.sin(h.rot), fz = -Math.cos(h.rot), sx = Math.cos(h.rot), sz = -Math.sin(h.rot);
    camera.position.set(h.x + fx * v.dist + sx * v.side, v.up, h.z + fz * v.dist + sz * v.side);
    camera.lookAt(h.x + fx * 4, v.lookY, h.z + fz * 4);
    place(runner, { x: h.x + fx * 13 - sx * 9, z: h.z + fz * 13 - sz * 9, yaw: Math.atan2(sx, sz) }); place(cop, { x: 9e3, z: 9e3, yaw: 0 });
  } else if (v.pos) { camera.position.set(...v.pos); camera.lookAt(...v.look); }
  else { const back = v.back ?? 9, up = v.up ?? 3.2, gy = Math.max(0, M.height(v.x, v.z)); camera.position.set(v.x - Math.sin(v.yaw) * back, gy + up, v.z - Math.cos(v.yaw) * back); camera.lookAt(v.x + Math.sin(v.yaw) * 30, gy + 1.2 + (v.lookUp || 0), v.z + Math.cos(v.yaw) * 30); }
  camera.updateProjectionMatrix();
  M.animate(v.t ?? 2, [{ x: runner.position.x, z: runner.position.z }]);
  world.update(camera, 0.016, 1);
  renderer.info.reset(); renderer.info.autoReset = false;
  renderer.clear(); renderer.render(world.farScene, camera); renderer.clearDepth(); renderer.render(world.scene, camera);
  return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
};
window.__stats = { prepMs, maxPrep, world: world.stats, textures: texs.length, texSizes: texs.map((x) => [x.image.width, x.image.height]) };
document.title = 'ready';
</script>`;
const VIEWS = [
  { name: '01-mission-gorge-rd', spawn: 0 },
  { name: '02-magnolia-ave', spawn: 1 },
  { name: '03-riverbed', x: 420, z: -196, yaw: -1.62, up: 2.8 },
  { name: '04-santee-lakes', x: -1050, z: -560, yaw: 3.0, up: 3.4 },
  { name: '05-town-center-trolley', x: 4, z: 40, yaw: 3.14, up: 3.6 },
  { name: '06-sr52', spawn: 3 },
  { name: '07-cul-de-sac', x: -54, z: -760, yaw: 3.06, up: 3.2 },
  { name: '08-cowles-mtn', x: -500, z: 336, yaw: -1.17, up: 3 },
  { name: '09-boulder-way-home', home: true, dist: 17, side: 3, up: 2.4, lookY: 1.4 },
  { name: '10-weston', spawn: 8 },
  { name: '11-mast-santana', x: 562, z: -560, yaw: -2.9, pos: [598, 9, -548], look: [470, 2, -680] },
  { name: '12-gillespie', x: 150, z: 585, yaw: 1.57, up: 3.5 },
  { name: '13-boulder-way-street', x: -1231, z: -548, yaw: 3.0 },
  { name: '14-mast-blvd-west', spawn: 11 },
];

async function engineSection() {
  console.log('\n# engine');
  const need = ['js/games/getaway/world.js', 'js/games/getaway/geo.js', 'js/games/getaway/gfx.js'];
  if (!need.every((p) => fs.existsSync(path.join(ROOT, p)))) { console.log('skip - the engine (world.js/geo.js/gfx.js) is not there yet'); return; }
  const three = threePath();
  const types = { '.js': 'text/javascript', '.html': 'text/html' };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/santee.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return; }
    const f = u === '/three.min.js' ? three : path.join(ROOT, u);
    if (!f.startsWith(ROOT) && f !== three) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
  }).listen(PORT);
  const PW = process.env.PW || path.join(execSync('npm root -g').toString().trim(), 'playwright');
  const { chromium } = require(PW);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  try {
    for (const [quality, dark] of [[process.env.QUALITY || 'high', process.env.DARK === '1'], ['low', false]]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(`http://localhost:${PORT}/santee.html?w=1280&h=720&quality=${quality}&dark=${dark ? 1 : 0}`);
      await page.waitForFunction(() => document.title === 'ready', null, { timeout: 180000 });
      const s = await page.evaluate(() => window.__stats);
      console.log(`  [${quality}${dark ? ', dark' : ''}] prepare ${Math.round(s.prepMs)} ms (longest slice ${Math.round(s.maxPrep)} ms); world`, JSON.stringify(s.world));
      ok(s.world.tris <= BUDGET.totalTris, `[${quality}] total triangles ${s.world.tris} ≤ ${BUDGET.totalTris} (roads, props and map)`);
      warn(s.world.buildMs <= BUDGET.buildMs, `[${quality}] world build ${s.world.buildMs} ms ≤ ${BUDGET.buildMs} (software GL; a phone GPU is faster at merge)`);
      warn(s.world.maxBlockMs <= BUDGET.blockMs && s.maxPrep <= BUDGET.blockMs, `[${quality}] longest main-thread block ${s.world.maxBlockMs} ms / prepare slice ${Math.round(s.maxPrep)} ms ≤ ${BUDGET.blockMs}`);
      ok(s.textures <= BUDGET.textures && s.texSizes.every(([w, h]) => w <= 1024 && h <= 1024), `[${quality}] ${s.textures} canvas texture(s) ≤ ${BUDGET.textures} × 1024²`);
      let worst = { calls: 0, tris: 0 };
      for (const v of VIEWS) {
        const r = await page.evaluate((vv) => window.view(vv), v);
        worst = { calls: Math.max(worst.calls, r.calls), tris: Math.max(worst.tris, r.tris) };
        if (quality !== 'low' || v.name.startsWith('01')) await page.screenshot({ path: path.join(SHOTS, `${v.name}${quality === 'low' ? '-low' : ''}${dark ? '-dark' : ''}.png`) });
        if (r.calls > BUDGET.calls || r.tris > BUDGET.viewTris) console.log(`   ${v.name}: ${r.calls} calls, ${r.tris} tris`);
      }
      ok(worst.calls <= BUDGET.calls, `[${quality}] worst view: ${worst.calls} draw calls ≤ ${BUDGET.calls}`);
      ok(worst.tris <= BUDGET.viewTris, `[${quality}] worst view: ${worst.tris} triangles ≤ ${BUDGET.viewTris}`);
      ok(!errors.length, `[${quality}] no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log(`  screenshots: ${SHOTS}`);
}

// ─────────────────────────────────────────────────────────────────────
async function gameSection() {
  console.log('\n# game');
  if (!fs.existsSync(path.join(ROOT, 'js/games/getaway.js'))) { console.log('skip - js/games/getaway.js is not there yet'); return; }
  const { launch } = require('../harness');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const h = await launch({ port: PORT + 1, only: ['getaway'], who: ['a'], coarse: true });
  const { a } = h;
  const hook = (fn, ...args) => a.evaluate(([f, x]) => window.__getaway[f](...x), [fn, args]);
  const st = () => a.evaluate(() => window.__getaway.state());
  const shot = (n) => a.screenshot({ path: path.join(SHOTS, 'game-' + n + '.png') });
  try {
    await a.setViewportSize({ width: 844, height: 390 });
    await a.evaluate(() => {
      window.__gtwTest = true; window.__gtwTune = { intro: 2500, count: 1200, result: 1800, final: 900, resume: 1500, maxDpr: 1 };
      localStorage.removeItem('getaway.device.v1');
      localStorage.setItem('getaway.setup.v1', JSON.stringify({ map: 'santee' }));
    });
    await h.startLive(a, 'getaway', 'local');
    await a.waitForFunction(() => window.__getaway && window.__getaway.ready, null, { timeout: 180000 });
    let s = await st();
    ok(s.mapId === 'santee', `the game loads Santee (${s.mapId})`);
    const maps = await hook('maps');
    ok(maps.some((m) => m.id === 'santee' && !m.stub), 'Santee is playable in the map list');
    const lms = await hook('landmarks');
    ok(lms.some((l) => l.home && l.name === '8524 Boulder Way'), 'the game sees the home landmark');
    const pf = await hook('perf');
    console.log('   build', JSON.stringify(pf.build), 'load', pf.load);
    ok(pf.build && pf.build.tris <= BUDGET.totalTris, `in-game map triangles ${pf.build && pf.build.tris} ≤ ${BUDGET.totalTris}`);
    warn(pf.build && pf.build.maxBlockMs <= 250, `in-game build: longest block ${pf.build && pf.build.maxBlockMs} ms`);
    const views = await a.evaluate(() => {
      const g = window.__getaway; const out = [];
      const pts = g.internals.S.mapEntry.spawns.map((x) => x.runner);
      const roads = g.roads(); for (let i = 0; i < 14; i++) { const r = Math.floor((i * 7919) % roads.length); const p = g.roadPoint(r, (roads[r].len * ((i % 6) + 1)) / 7); pts.push({ x: p.x, z: p.z, yaw: p.yaw }); }
      const home = g.landmarks().find((l) => l.home); pts.push({ x: home.x + 14, z: home.z, yaw: -Math.PI / 2 });
      for (const p of pts) for (let k = 0; k < 4; k++) out.push(g.measureView(p.x, p.z, (p.yaw || 0) + (k * Math.PI) / 2, k === 3 ? 'far' : 'near'));
      return out;
    });
    const mc = Math.max(...views.map((v) => v.calls)), mt = Math.max(...views.map((v) => v.tris));
    ok(mc <= BUDGET.calls, `in-game, ${views.length} views (spawns, roads, home): ≤ ${mc} draw calls`);
    ok(mt <= BUDGET.viewTris, `in-game, ${views.length} views: ≤ ${mt} triangles`);

    const live = async () => { await a.waitForFunction(() => { const q = window.__getaway.state(); return q.phase === 'chase' && q.R && !q.R.over; }, null, { timeout: 30000 }); await hook('shortenRound', 60000); };
    // traffic off, so the drivability checks below aren't decided by civilian cars
    await hook('setRules', { traffic: 'off' });
    // a practice round: intro shows where we are, then the chase
    // (the intro card is caught by an observer in the page, not by polling: on a loaded machine the
    // 2.5 s intro could come and go between two polls of a starved page)
    await a.evaluate(() => {
      window.__introSeen = '';
      const grab = () => { for (const c of document.querySelectorAll('.gtw-card')) if (/Round/i.test(c.textContent) && /Starting near/i.test(c.textContent)) window.__introSeen = c.textContent; };
      window.__introObs = new MutationObserver(grab); window.__introObs.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await a.click('.g-gtw [data-l="start"]');
    await a.waitForFunction(() => !!window.__introSeen || window.__getaway.state().phase === 'chase', null, { timeout: 30000, polling: 100 }).catch(() => {});
    const introText = await a.evaluate(() => { window.__introObs.disconnect(); return window.__introSeen || [...document.querySelectorAll('.gtw-card')].map((c) => c.textContent).join(' '); });
    await shot('intro');
    ok(/santee/i.test(introText), 'the round intro names Santee');
    ok(/Starting near/i.test(introText), `the intro says where: ${(introText.match(/Starting near[^\n]*/) || [''])[0]}`);
    await a.waitForFunction(() => window.__getaway.state().phase === 'chase', null, { timeout: 20000 });
    await a.waitForFunction(() => window.__getaway.navReady(), null, { timeout: 60000 });
    s = await st();
    const me = s.me;
    const x0 = s[me].x, z0 = s[me].z;
    await hook('auto', me, true); await wait(4000); await shot('chase');
    s = await st();
    warn(Math.hypot(s[me].x - x0, s[me].z - z0) > 25, `the AI drives away from the spawn (${Math.hypot(s[me].x - x0, s[me].z - z0).toFixed(0)} m)`);
    const other = me === 'a' ? 'b' : 'a';
    await a.evaluate(([m, o]) => { const g = window.__getaway; const q = g.state(); g.teleport(o, q[m].x - Math.sin(q[m].yaw) * 9, q[m].z + Math.cos(q[m].yaw) * 9, q[m].yaw, q[m].speed); }, [me, other]);
    await wait(700); await shot('pursuit');

    // the main routes: start ON the centre line facing along the road, other car parked 60 m
    // behind (no PIT, no escape), and a simple pure-pursuit driver following the road. This
    // checks the road is drivable end to end, without AI or traffic noise. Retries if the round
    // changes under us.
    const roads = await hook('roads');
    await a.evaluate(() => {
      window.__follow = (w, ri, s0, len) => {
        const g = window.__getaway; let s = s0;
        const id = setInterval(() => {
          const q = g.state()[w]; let best = s, bd = 1e9;
          for (let ds = -4; ds <= 30; ds += 1) { const p = g.roadPoint(ri, Math.min(len, s + ds)); const d = Math.hypot(p.x - q.x, p.z - q.z); if (d < bd) { bd = d; best = Math.min(len, s + ds); } }
          s = best;
          const t = g.roadPoint(ri, Math.min(len, s + 16));
          let e = Math.atan2(t.x - q.x, -(t.z - q.z)) - q.yaw; e = Math.atan2(Math.sin(e), Math.cos(e));
          g.hold(w, { steer: Math.max(-1, Math.min(1, e * 2.4)), gas: 0.75 });
        }, 50);
        return id;
      };
    });
    for (const name of ['Mission Gorge Rd', 'Mast Blvd', 'SR-52', 'Magnolia Ave', 'Cuyamaca St', 'Carlton Hills Blvd', 'Fanita Pkwy', 'Weston Rd', 'Town Center Pkwy', 'Prospect Ave']) {
      const ri = roads.findIndex((r) => r.name === name && !r.bridge && r.len > 200);
      if (ri < 0) { ok(false, `route ${name} found`); continue; }
      const len = roads[ri].len, s0 = Math.max(70, Math.min(len - 120, len * 0.35));
      // Timed by the game's own simulation clock (state().simT, the seconds the chase physics has run),
      // not the wall: the game clamps a frame to 125 ms of simulation, so a loaded software-GL page
      // simulates a fraction of real time, and the frame-time p50 this used to scale by reads 125
      // (the clamp itself) however slow the frames really are. 3.5 simulated seconds, sampled every
      // 0.5 of them; the distance is checked as a speed along the road: ≥ 8 m per simulated second.
      const SIM_S = 3.5;
      let p, moved = 0, simS = 0, surf = '', water = false, offRoad = 0, n = 0;
      for (let tries = 0; tries < 3; tries++) {
        await live();
        const idx0 = (await st()).R.idx;
        p = await hook('roadPoint', ri, s0);
        const back = await hook('roadPoint', ri, s0 - 60);
        await hook('hold', other, { brake: 1 });
        await hook('teleport', other, back.x, back.z, back.yaw, 0);
        await hook('teleport', me, p.x, p.z, p.yaw, 12);
        const t0 = (await st()).simT;
        const id = await a.evaluate(([w, r, ss, l]) => window.__follow(w, r, ss, l), [me, ri, s0, len]);
        offRoad = 0; n = 0;
        const wall0 = Date.now();
        while (n < SIM_S / 0.5 && Date.now() - wall0 < 60000) {
          await wait(100);
          const q = await st(); if (q.phase !== 'chase' || !q.R || q.R.idx !== idx0) break;
          if (q.simT - t0 >= (n + 1) * 0.5) { n++; if (q[me].surf !== 'road') offRoad++; }
        }
        await a.evaluate((x) => clearInterval(x), id);
        s = await st();
        await hook('hold', me, null); await hook('hold', other, null);
        moved = Math.hypot(s[me].x - p.x, s[me].z - p.z); simS = s.simT - t0; surf = s[me].surf; water = s[me].water;
        if (s.R && s.R.idx === idx0 && s.phase === 'chase' && n >= SIM_S / 0.5) break;
      }
      const need = 8 * simS;
      ok(n >= SIM_S / 0.5 && moved >= need && !water && offRoad <= 1, `${name}: follows the road ${moved.toFixed(0)} m in ${simS.toFixed(1)} simulated s (≥ ${need.toFixed(0)}: 8 m/s) from (${p.x.toFixed(0)}, ${p.z.toFixed(0)}), on ${surf} (${offRoad}/${n} samples off the asphalt)`);
      await shot('route-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    }
    // the riverbed: sand, slow, dry
    for (let tries = 0; tries < 3; tries++) {
      await live();
      const idx0 = (await st()).R.idx;
      await hook('teleport', other, 1000, -1100, 0, 0);
      await hook('hold', me, { gas: 1 });
      await hook('teleport', me, 420, -196, -Math.PI / 2, 12);
      await wait(2500);
      s = await st();
      if (s.R && s.R.idx === idx0 && s.phase === 'chase') break;
    }
    ok(s[me].surf === 'sand' && !s[me].water, `the riverbed is sand (${s[me].surf}), dry`);
    ok(s[me].speed < 30, `sand is slow: ${(s[me].speed * 3.6).toFixed(0)} km/h after 2.5 s flat out`);
    await shot('riverbed');
    const home = lms.find((l) => l.home);
    // park on Boulder Way just past the house, looking back at it with the chase cam
    await a.waitForFunction(() => { const q = window.__getaway.state(); return q.phase === 'chase' && q.R && !q.R.over; }, null, { timeout: 30000 });
    await hook('shortenRound', 60000);
    const bwi = roads.findIndex((r) => r.name === 'Boulder Way');
    let best = null;
    for (let k = 0; k <= 40; k++) { const q = await hook('roadPoint', bwi, (roads[bwi].len * k) / 40); const d = Math.hypot(q.x - home.x, q.z - home.z); if (!best || d < best.d) best = { d, q, k }; }
    const q0 = await hook('roadPoint', bwi, Math.max(0, (roads[bwi].len * (best.k - 3)) / 40));
    await hook('hold', me, { brake: 1 });
    await hook('teleport', me, q0.x, q0.z, q0.yaw, 0);
    await hook('teleport', other, -1291, -560, 0, 0); // parked on Weston Rd, in sight (no escape banner)
    await hook('hold', other, { brake: 1 });
    await wait(1500); await shot('home');
    await hook('hold', me, null); await hook('hold', other, null);
    // a lake: the runner is busted (or the car is in water)
    await live();
    await hook('teleport', me, -990, -830, 0, 4);
    await wait(900);
    s = await st();
    ok(s[me].water || (s.R && s.R.over), 'driving into Santee Lakes is water');
    await shot('lake');
    await hook('hold', me, null);
    // the home and its cats
    await hook('openMap'); await wait(500); await shot('minimap'); await hook('closeMap');
    h.assertNoErrors();
    ok(true, 'no page errors in the game');
  } catch (e) { failures++; console.log('FAIL -', e.message); await shot('fail').catch(() => {}); } finally { await h.close(); }
}

(async () => {
  try {
    if (want('static')) await staticSection();
    if (want('engine')) await engineSection();
    if (want('game')) await gameSection();
  } catch (e) { failures++; console.log('FAIL -', e.stack || e); }
  console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
  process.exit(failures ? 1 : 0);
})();
