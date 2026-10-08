// Blend & Seek — the big maps (EXTRA_MAPS): budgets, reachability and a round on each map.
//   node tools/test/games/chameleon-maps.test.js                 (all sections)
//   ONLY=static node tools/test/games/chameleon-maps.test.js     (no browser: budgets + flood fill)
//   MAPS=house,market …   only these maps          SHOTS=dir   screenshot folder
//   PORT=8980 (uses PORT..PORT+3)                   ROOMSHOTS=1 every room × 3 viewports × 2 themes
//
// Sections
//   static   builds every extra map in Node (fake atlas + fake THREE): triangles, chunks, colliders,
//            build time, spawn clearance, a grid flood-fill of walkable space from the seeker spawn
//            (walk + step + jump, mirroring world.js), every room reached at size 1 and at the
//            largest size, no walkable floor pocket left enclosed, and every climb-only surface
//            (a top you can only reach by crawling) visible from somewhere a seeker can stand.
//   browser  each map is selectable on the start screen, loads on phone + laptop without errors,
//            probes + camo wall + spawns pass checkMap, draw calls while playing, build time
//            with the real atlas; then a quick hotseat hide-and-seek round per map.
//   rooms    screenshots of every room (390×844, 844×390, 1280×800; light + dark).
//   pockets  (maps pass) every map at Tiny / Large / Huge: crawl from every open contact with the
//            real crawl code and require each reached contact to be in sight of somewhere ≥ 1 m
//            away (no sealed nooks); the review's Market fridge-header slot and House armchair.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '../../..');
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'chameleon-maps-shots');
const PORT = Number(process.env.PORT) || 8980;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const MAPF = (process.env.MAPS || '').split(',').filter(Boolean);
let failures = 0;
const assert = (c, m) => { if (!c) { failures++; console.log('FAIL -', m); return false; } console.log('ok -', m); return true; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const MINE = ['house', 'market', 'greenhouse', 'museum'];
const BUDGET = { tris: 120000, drawCalls: 80, buildMs: 400, atlas: 1024 };

// ─────────────────────────────────────────────────────────────────────
// static: fake atlas + fake THREE, real geo.js builder, flood fill mirroring world.js
const FAKE_THREE = (() => {
  class Attr { constructor(a, n) { this.array = a; this.itemSize = n; this.count = a.length / n; } }
  class Geo { setAttribute(k, a) { this[k] = a; } setIndex(i) { this.index = Array.isArray(i) ? new Attr(i, 1) : i; } computeBoundingSphere() {} computeBoundingBox() {} dispose() {} }
  return { BufferGeometry: Geo, Float32BufferAttribute: Attr, BufferAttribute: Attr };
})();

function fakeAtlas(size = 1024) {
  const SIZES = { S: 48, M: 112, L: 240, XL: 496 }; const PAD = 8;
  const reqs = []; const tiles = {}; const dropped = [];
  return {
    add(key, painter, { size: sz = 'L', repeat = true, w, h } = {}) {
      if (typeof painter !== 'function') throw new Error('painter for ' + key + ' is not a function');
      const iw = w || SIZES[sz] || SIZES.L; reqs.push({ key, iw, ih: h || iw, repeat });
    },
    finish() {
      reqs.push({ key: 'white', iw: 48, ih: 48 });
      const keys = new Set();
      const order = [...reqs].sort((a, b) => b.ih - a.ih || b.iw - a.iw);
      let x = 0; let y = 0; let shelf = 0;
      for (const r of order) {
        if (keys.has(r.key)) throw new Error('duplicate atlas key ' + r.key);
        keys.add(r.key);
        const W = r.iw + PAD * 2; const H = r.ih + PAD * 2;
        if (x + W > size) { x = 0; y += shelf; shelf = 0; }
        if (y + H > size) { dropped.push(r.key); continue; }
        tiles[r.key] = [x / size, y / size, r.iw / size, r.ih / size];
        x += W; shelf = Math.max(shelf, H);
      }
      return { tiles, used: y + shelf, dropped, keys: [...keys] };
    },
    reqs,
  };
}

async function loadModules() {
  const imp = (f) => import(pathToFileURL(path.join(ROOT, 'js/games/chameleon', f)).href);
  const [maps, geo, extra, world, move] = await Promise.all([imp('maps.js'), imp('geo.js'), imp('maps/index.js'), imp('world.js'), imp('move.js')]);
  return { maps, geo, extra: extra.EXTRA_MAPS, world, move };
}

function buildStatic(M, entry) {
  // median of three builds (the first one pays for JIT warm-up)
  let atlas; let at; let out; const times = [];
  for (let k = 0; k < 3; k++) {
    atlas = fakeAtlas();
    const t0 = performance.now();
    const fill = entry.build(atlas, M.maps.KIT);
    at = atlas.finish();
    const b = M.geo.createBuilder({ tiles: at.tiles, ink: [0.1, 0.1, 0.1] });
    fill(b);
    out = b.finish(FAKE_THREE);
    if (M.maps.closeSlots) M.maps.closeSlots(out.colliders); // as buildMap does
    times.push(performance.now() - t0);
  }
  times.sort((x, y) => x - y);
  const t0 = 0; const t1 = 0; const t2 = times[1];
  // used tiles: every tile key referenced by geometry must exist (else silently white)
  return { out, atlas: at, ms: t2 - t0, fillMs: t2 - t1, reqs: atlas.reqs };
}

/** Collision queries with world.js semantics, accelerated by a 1 m bucket grid. */
function makeQuery(colliders, { r, step, head }) {
  const G = 1; const buckets = new Map();
  const key = (i, j) => i * 4096 + j;
  colliders.forEach((c, k) => {
    for (let i = Math.floor(c.minX / G) - 1; i <= Math.floor(c.maxX / G) + 1; i++) for (let j = Math.floor(c.minZ / G) - 1; j <= Math.floor(c.maxZ / G) + 1; j++) {
      const kk = key(i, j); let a = buckets.get(kk); if (!a) { a = []; buckets.set(kk, a); } a.push(k);
    }
  });
  const near = (x, z) => buckets.get(key(Math.floor(x / G), Math.floor(z / G))) || [];
  const overlaps = (c, x, z, rr) => {
    const cx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x; const cz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
    return (x - cx) ** 2 + (z - cz) ** 2 < rr * rr;
  };
  const inRect = (c, x, z, rr) => !(x + rr < c.minX || x - rr > c.maxX || z + rr < c.minZ || z - rr > c.maxZ);
  return {
    groundAt(x, z, feet) { let g = 0; for (const k of near(x, z)) { const c = colliders[k]; if (c.maxY > feet + step + 0.001 || c.maxY <= g) continue; if (inRect(c, x, z, r * 0.6)) g = c.maxY; } return g; },
    surfaces(x, z) { const s = new Set([0]); for (const k of near(x, z)) { const c = colliders[k]; if (c.climb === false && !c.wall) continue; if (inRect(c, x, z, r * 0.6)) s.add(c.maxY); } return [...s].sort((a, b) => a - b); },
    blocked(x, z, feet) { for (const k of near(x, z)) { const c = colliders[k]; if (c.maxY > feet + step && c.minY < feet + head && overlaps(c, x, z, r)) return c; } return null; },
    ceiling(x, z, feet) { let cc = Infinity; for (const k of near(x, z)) { const c = colliders[k]; if (c.minY < feet + head - 0.05 || c.minY >= cc) continue; if (inRect(c, x, z, r * 0.7)) cc = c.minY; } return cc; },
    clearance(x, z, feet) { let d = Infinity; for (const c of colliders) { if (!(c.maxY > feet + step && c.minY < feet + head)) continue; const cx = Math.max(c.minX, Math.min(c.maxX, x)); const cz = Math.max(c.minZ, Math.min(c.maxZ, z)); d = Math.min(d, Math.hypot(x - cx, z - cz)); } return d; },
    ray(ox, oy, oz, dx, dy, dz, maxT) {
      // brute-force slab test over boxes near the segment's bounding box
      for (const c of colliders) {
        let t0 = 0; let t1 = maxT; let ok = true;
        for (let a = 0; a < 3 && ok; a++) {
          const o = a === 0 ? ox : a === 1 ? oy : oz; const d = a === 0 ? dx : a === 1 ? dy : dz;
          const lo = a === 0 ? c.minX : a === 1 ? c.minY : c.minZ; const hi = a === 0 ? c.maxX : a === 1 ? c.maxY : c.maxZ;
          if (Math.abs(d) < 1e-9) { if (o <= lo || o >= hi) ok = false; continue; }
          let ta = (lo - o) / d; let tb = (hi - o) / d; if (ta > tb) { const t = ta; ta = tb; tb = t; }
          if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 >= t1) ok = false;
        }
        if (ok) return c;
      }
      return null;
    },
  };
}

/**
 * Flood fill of standable cells from a spawn. Nodes are (cell, feet height). Moves: walk to a
 * neighbour (step up ≤ step, fall any height), jump onto a surface up to `jump` higher within
 * two cells. Returns reached nodes + every standable node in the map.
 */
function floodFill(map, info, spawn, dims, cell = 0.2) {
  const Qy = makeQuery(map.colliders, dims);
  const hw = info.w / 2; const hd = info.d / 2;
  const nx = Math.round(info.w / cell); const nz = Math.round(info.d / cell);
  const cx = (i) => -hw + (i + 0.5) * cell; const cz = (j) => -hd + (j + 0.5) * cell;
  const id = (i, j, y) => `${i},${j},${Math.round(y * 1000)}`;
  const standable = (x, z, y) => Math.abs(Qy.groundAt(x, z, y) - y) < 1e-4 && !Qy.blocked(x, z, y);
  // all standable nodes
  const all = new Map();
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = cx(i); const z = cz(j);
    for (const s of Qy.surfaces(x, z)) if (standable(x, z, s)) all.set(id(i, j, s), { i, j, x, z, y: s });
  }
  const si = Math.max(0, Math.min(nx - 1, Math.floor((spawn.x + hw) / cell))); const sj = Math.max(0, Math.min(nz - 1, Math.floor((spawn.z + hd) / cell)));
  const sy = Qy.groundAt(cx(si), cz(sj), (spawn.y || 0) + 0.05);
  const reached = new Map(); const queue = [];
  const startK = id(si, sj, sy);
  if (all.has(startK)) { reached.set(startK, all.get(startK)); queue.push(all.get(startK)); }
  while (queue.length) {
    const n = queue.pop();
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
      if (!di && !dj) continue;
      const i2 = n.i + di; const j2 = n.j + dj; if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= nz) continue;
      const x2 = cx(i2); const z2 = cz(j2); const ring1 = Math.abs(di) <= 1 && Math.abs(dj) <= 1;
      const push = (y2) => { const k = id(i2, j2, y2); if (!reached.has(k) && all.has(k)) { const v = all.get(k); reached.set(k, v); queue.push(v); } };
      if (ring1 && !Qy.blocked(x2, z2, n.y)) {
        const y2 = Qy.groundAt(x2, z2, n.y);
        if (!Qy.blocked(x2, z2, y2)) push(y2);
      }
      // jump: onto a higher surface within reach, with headroom above the take-off cell
      const ceil = Qy.ceiling(n.x, n.z, n.y);
      for (const s of Qy.surfaces(x2, z2)) {
        if (s <= n.y + dims.step || s > n.y + dims.jumpH) continue;
        if (ceil < s + dims.head) continue;
        if (standable(x2, z2, s)) push(s);
      }
    }
  }
  return { all, reached, Qy, cell };
}

function analyse(M, entry, { quick = false } = {}) {
  const res = { id: entry.id, errors: [], notes: [] };
  const bs = buildStatic(M, entry);
  const { out } = bs;
  const info = entry.info || {};
  res.tris = out.triCount; res.verts = out.vertexCount; res.chunks = out.chunks.length; res.colliders = out.colliders.length;
  res.buildMsNode = bs.ms; res.atlasUsed = bs.atlas.used; res.atlasDropped = bs.atlas.dropped; res.tiles = bs.reqs.length;
  res.blobs = out.blobs.length;
  // atlas keys referenced but never registered (would silently render white)
  const sp = out.spots;
  const spawns = [...(sp.hiderSpawns || []).map((s) => ['hider', s]), ...(sp.seekerSpawns || []).map((s) => ['seeker', s]), ['lobby', sp.lobby], ['spawnA', sp.spawnA], ['spawnB', sp.spawnB], ['hiderSpawn', sp.hiderSpawn], ['seekerSpawn', sp.seekerSpawn]].filter(([, s]) => s);
  const big = M.geo && 1;
  void big;
  const Q1 = makeQuery(out.colliders, { r: 0.24, step: 0.24, head: 0.34 });
  res.spawnClear = spawns.map(([k, s]) => {
    const y = s.y || 0; const g = Q1.groundAt(s.x, s.z, y + 0.05);
    return { k, x: s.x, z: s.z, y, ground: g, clear: Q1.clearance(s.x, s.z, g) };
  });
  // flood fill at size 1 and at the largest size
  const sizes = quick ? [1] : [1, 1.8];
  res.fill = {};
  for (const s of sizes) {
    const dims = { r: 0.24 * s, step: Math.max(0.2, 0.24 * s), head: 0.34 * s, jumpH: Math.min(0.78, (4.6 * Math.pow(s, 0.4)) ** 2 / 26 - 0.02) };
    const start = (sp.seekerSpawns && sp.seekerSpawns[0]) || sp.seekerSpawn;
    const t0 = performance.now();
    const ff = floodFill(out, info, start, dims, s > 1.2 ? 0.1 : 0.2);
    const rooms = (info.rooms || []).map((rm) => {
      let tot = 0; let got = 0;
      for (const [k, n] of ff.all) {
        if (Math.abs(n.y - (rm.y || 0)) > 0.03) continue;
        if (n.x < rm.x0 || n.x > rm.x1 || n.z < rm.z0 || n.z > rm.z1) continue;
        tot++; if (ff.reached.has(k)) got++;
      }
      return { name: rm.name, tot, got };
    });
    // enclosed floor pockets: standable floor-level cells (y = some room floor) not reached
    const floors = new Set((info.floors || [{ y: 0 }]).map((f) => Math.round(f.y * 1000)));
    const pockets = []; const climbOnly = [];
    for (const [k, n] of ff.all) {
      if (ff.reached.has(k)) continue;
      if (floors.has(Math.round(n.y * 1000))) pockets.push(n); else climbOnly.push(n);
    }
    // climb-only surfaces must be visible from somewhere a seeker can stand (sampled 0.6 m)
    const eyes = [...ff.reached.values()].filter((n) => n.i % 2 === 0 && n.j % 2 === 0);
    const hidden = [];
    if (s === 1) {
      const sample = climbOnly.filter((n) => n.i % 3 === 0 && n.j % 3 === 0);
      for (const n of sample) {
        // a chameleon there is a body ~0.45 m across and ~0.3 m tall: any of five points seen counts
        const pts = [[0, 0.15, 0], [0.2, 0.12, 0], [-0.2, 0.12, 0], [0, 0.12, 0.2], [0, 0.12, -0.2], [0, 0.3, 0]];
        const cand = eyes.map((e) => [e, (e.x - n.x) ** 2 + (e.z - n.z) ** 2 + (e.y - n.y) ** 2]).filter(([, d]) => d < 144).sort((a, b) => a[1] - b[1]);
        let seen = false;
        for (let q = 0; q < cand.length && q < 400 && !seen; q += (q < 40 ? 1 : 5)) {
          const e = cand[q][0]; const ex = e.x; const ey = e.y + 0.46; const ez = e.z;
          for (const [ox, oy, oz] of pts) {
            const tx = n.x + ox; const ty = n.y + oy; const tz = n.z + oz;
            const dx = ex - tx; const dy = ey - ty; const dz = ez - tz; const L = Math.hypot(dx, dy, dz);
            if (!ff.Qy.ray(tx, ty, tz, dx / L, dy / L, dz / L, L - 0.02)) { seen = true; break; }
          }
        }
        if (!seen) hidden.push(n);
      }
    }
    res.fill[s] = { ms: performance.now() - t0, all: ff.all.size, reached: ff.reached.size, rooms, pockets, climbOnly: climbOnly.length, hidden };
  }
  return res;
}

function clusters(nodes, cell) {
  // group pocket nodes into connected clusters (8-neighbourhood, same height)
  const left = new Map(nodes.map((n) => [`${n.i},${n.j},${Math.round(n.y * 1000)}`, n]));
  const out = [];
  while (left.size) {
    const [k0, n0] = left.entries().next().value; left.delete(k0);
    const st = [n0]; const c = [n0];
    while (st.length) {
      const n = st.pop();
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const k = `${n.i + di},${n.j + dj},${Math.round(n.y * 1000)}`; if (left.has(k)) { const m = left.get(k); left.delete(k); st.push(m); c.push(m); } }
    }
    const xs = c.map((n) => n.x); const zs = c.map((n) => n.z);
    out.push({ n: c.length, area: +(c.length * cell * cell).toFixed(2), y: n0.y, x0: +Math.min(...xs).toFixed(1), x1: +Math.max(...xs).toFixed(1), z0: +Math.min(...zs).toFixed(1), z1: +Math.max(...zs).toFixed(1) });
  }
  return out.sort((a, b) => b.n - a.n);
}

async function staticSection() {
  console.log('\n# static: budgets, spawns and reachability (Node, no browser)');
  const M = await loadModules();
  const list = M.extra.filter((m) => !MAPF.length || MAPF.includes(m.id));
  if (!MAPF.length) assert(list.length >= 4, `EXTRA_MAPS lists ${list.length} maps (${list.map((m) => m.id).join(', ')})`);
  const report = [];
  for (const entry of list) {
    const tag = entry.id;
    assert(typeof entry.build === 'function' && entry.name && entry.blurb && entry.info && entry.info.w && entry.info.d, `${tag}: entry has build, name, blurb and info`);
    const res = analyse(M, entry);
    report.push(res);
    const area = entry.info.w * entry.info.d;
    console.log(`  ${tag}: ${entry.info.w}×${entry.info.d} m (${area} m² footprint, ${(entry.info.floors || [1]).length} floor(s)), ${res.tris.toLocaleString()} tris, ${res.verts.toLocaleString()} verts, ${res.chunks} chunks, ${res.colliders} colliders, ${res.blobs} blobs, ${res.tiles} atlas tiles (${res.atlasUsed}px of 1024 used), geometry built in ${res.buildMsNode.toFixed(0)} ms`);
    const maxArea = entry.size === 'XL' ? 950 : 420;
    assert(area >= 160 && area <= maxArea, `${tag}: footprint ${area} m² (${(area / 100).toFixed(1)}× the 80–120 m² originals; ≤ ${maxArea} m² for size ${entry.size})`);
    assert(res.tris < BUDGET.tris, `${tag}: ${res.tris.toLocaleString()} triangles < ${BUDGET.tris.toLocaleString()}`);
    assert(!res.atlasDropped.length, `${tag}: every atlas tile fits in one 1024² page${res.atlasDropped.length ? ' (dropped ' + res.atlasDropped.join(', ') + ')' : ''}`);
    const nodeMs = entry.size === 'XL' ? 500 : 250;
    assert(res.buildMsNode < nodeMs, `${tag}: geometry + colliders build in ${res.buildMsNode.toFixed(0)} ms (Node, median of 3, without painting the atlas; < ${nodeMs})`);
    for (const s of res.spawnClear) {
      const floorOk = (entry.info.floors || [{ y: 0 }]).some((f) => Math.abs(f.y - s.ground) < 0.03) || Math.abs(s.ground - s.y) < 0.03;
      assert(s.clear >= 0.45 && Math.abs(s.ground - s.y) < 0.03 && floorOk, `${tag}: spawn ${s.k} (${s.x}, ${s.y}, ${s.z}) stands on its floor and is ${s.clear.toFixed(2)} m clear of props (≥ 0.45)`);
    }
    for (const [size, f] of Object.entries(res.fill)) {
      for (const rm of f.rooms) assert(rm.tot > 0 && rm.got / rm.tot >= (size === '1' ? 0.97 : 0.9), `${tag} @size ${size}: ${rm.name} reachable from the seeker spawn (${rm.got}/${rm.tot} floor cells)`);
      const big = clusters(f.pockets, 0.2).filter((c) => c.n >= (size === '1' ? 2 : 4));
      if (size === '1') assert(!big.length, `${tag} @size ${size}: no enclosed walkable floor pockets${big.length ? ' — ' + JSON.stringify(big.slice(0, 6)) : ''}`);
      else if (big.length) console.log(`  note ${tag} @size ${size}: floor pockets too tight for the biggest chameleon: ${JSON.stringify(big.slice(0, 4))}`);
      if (size === '1') {
        const hc = clusters(f.hidden, 0.6);
        const byY = {}; for (const n of f.hidden) byY[n.y] = (byY[n.y] || 0) + 1;
        assert(!f.hidden.length, `${tag}: every climb-only surface (${f.climbOnly} cells) is visible from somewhere a seeker can stand${f.hidden.length ? ' — hidden by height ' + JSON.stringify(byY) + ': ' + JSON.stringify(hc.slice(0, 8)) : ''}`);
      }
      console.log(`  ${tag} @size ${size}: ${f.reached}/${f.all} standable cells reached by walking/jumping, ${f.climbOnly} climb-only (flood fill ${f.ms.toFixed(0)} ms)`);
    }
  }
  return report;
}

// ─────────────────────────────────────────────────────────────────────
// pockets (maps pass): no sealed nooks. Seed every clearly open sticky-feet contact (on a 0.5 m
// grid over every collider face, legal by the engine's rules: in bounds, contact point not buried,
// body clear of guards; ≥ 30 of 60 escape rays run 1.5 m into the room), crawl from all of them
// with the real world.crawl / move.crawlStep in four directions per state (BFS on a 0.2 m grid),
// and require every reached contact whose body centre is in open air to be in sight of somewhere
// ≥ 1 m away (60 escape rays first, then a 0.35 m viewpoint grid out to 6 m; guards and glass are
// see-through, the map's box and its top ceiling clip). Bodies whose centre ends up inside solid
// geometry (a contact point that fits a slot the body doesn't) are counted and reported: the maps
// close the slots they can (closeSlots), the rest is the engine's (see docs, maps pass).
function pocketScan(M, entry, size) {
  const tiles = new Proxy({}, { get: () => [0, 0, 0.1, 0.1] });
  const fill = entry.build({ add() {}, finish() { return { tiles }; } }, M.maps.KIT);
  const b = M.geo.createBuilder({ tiles, ink: [0, 0, 0] }); fill(b);
  const out = b.finish(FAKE_THREE);
  M.maps.closeSlots(out.colliders);
  const bounds = M.maps.boundsOf(out.colliders, entry.info || {});
  const world = M.world.createWorld({ colliders: out.colliders, bounds });
  const d = M.world.dims(size); const r = d.r;
  let top = 0; for (const c of out.colliders) if (c.ceil && c.maxY < 30) top = Math.max(top, c.maxY); if (!top) top = 8;
  const boxes = out.colliders; const solid = (bx) => bx.climb !== false;
  // 1 m XZ buckets of solid boxes for the centre test
  const G = new Map(); const gk = (i, j) => i * 4096 + j;
  boxes.forEach((bx) => { if (!solid(bx)) return; for (let i = Math.floor(bx.minX); i <= Math.floor(bx.maxX); i++) for (let j = Math.floor(bx.minZ); j <= Math.floor(bx.maxZ); j++) { const k = gk(i, j); let L = G.get(k); if (!L) G.set(k, (L = [])); L.push(bx); } });
  const centreIn = (x, y, z) => { const L = G.get(gk(Math.floor(x), Math.floor(z))); if (L) for (const bx of L) if (x > bx.minX + 0.01 && x < bx.maxX - 0.01 && y > bx.minY + 0.01 && y < bx.maxY - 0.01 && z > bx.minZ + 0.01 && z < bx.maxZ - 0.01) return bx; return null; };
  // does a body (a sphere of 0.8 r round its centre) overlap a solid box other than the one it's on?
  const overlaps = (c, rr, on) => {
    const r2 = rr * rr; const seenB = new Set();
    for (let i = Math.floor(c[0] - rr); i <= Math.floor(c[0] + rr); i++) for (let j = Math.floor(c[2] - rr); j <= Math.floor(c[2] + rr); j++) {
      const L = G.get(gk(i, j)); if (!L) continue;
      for (const bx of L) {
        if (bx === on || seenB.has(bx)) continue; seenB.add(bx);
        const dx = Math.max(bx.minX - c[0], 0, c[0] - bx.maxX); const dy = Math.max(bx.minY - c[1], 0, c[1] - bx.maxY); const dz = Math.max(bx.minZ - c[2], 0, c[2] - bx.maxZ);
        if (dx * dx + dy * dy + dz * dz < r2) return bx;
      }
    }
    return null;
  };
  const freeAt = (x, y, z) => { const L = G.get(gk(Math.floor(x), Math.floor(z))); if (L) for (const bx of L) if (x > bx.minX - 0.08 && x < bx.maxX + 0.08 && y > bx.minY - 0.08 && y < bx.maxY + 0.08 && z > bx.minZ - 0.08 && z < bx.maxZ + 0.08) return false; return true; };
  const DIRS = []; const ND = 60;
  for (let i = 0; i < ND; i++) { const y = 1 - (2 * (i + 0.5)) / ND; const rr = Math.sqrt(1 - y * y); const a = i * Math.PI * (3 - Math.sqrt(5)); DIRS.push([Math.cos(a) * rr, y, Math.sin(a) * rr]); }
  const clipT = (o, dd) => { let t = 8; const lo = [bounds.minX, -0.01, bounds.minZ]; const hi = [bounds.maxX, top, bounds.maxZ]; for (let a = 0; a < 3; a++) { if (Math.abs(dd[a]) < 1e-9) continue; const tt = ((dd[a] > 0 ? hi[a] : lo[a]) - o[a]) / dd[a]; if (tt < t) t = Math.max(0, tt); } return t; };
  const escapes = (c, enough = ND) => { let e = 0; for (const dd of DIRS) { const far = Math.min(8, clipT(c, dd)); if (far < 1.5) continue; const H = world.raycast(c[0], c[1], c[2], dd[0], dd[1], dd[2], far, solid, true); if (!H || H.t >= 1.5) { if (++e >= enough) return e; } } return e; };
  const viewpoints = (c) => {
    let n = 0;
    for (let i = -17; i <= 17; i++) for (let j = -17; j <= 17; j++) {
      const x = c[0] + i * 0.35; const z = c[2] + j * 0.35;
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
      for (let kk = Math.ceil((0.2 - c[1]) / 0.35); c[1] + kk * 0.35 <= Math.min(top - 0.1, c[1] + 4); kk++) {
        const y = c[1] + kk * 0.35;
        const dx = x - c[0]; const dy = y - c[1]; const dz = z - c[2]; const dd = Math.hypot(dx, dy, dz);
        if (dd < 1 || dd > 6) continue;
        if (world.raycast(c[0], c[1], c[2], dx / dd, dy / dd, dz / dd, dd, solid, true)) continue;
        if (!freeAt(x, y, z)) continue;
        if (++n >= 3) return n;
      }
    }
    return n;
  };
  const key = (bd) => `${Math.round(bd.x / 0.2)},${Math.round(bd.y / 0.2)},${Math.round(bd.z / 0.2)},${Math.round(bd.nx)},${Math.round(bd.ny)},${Math.round(bd.nz)}`;
  const queue = []; const seen = new Set(); let seeds = 0; const clear = Math.min(0.35, d.head * 0.8);
  for (const bx of boxes) {
    if (bx.climb === false) continue;
    for (const nrm of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const ax = nrm[0] ? 0 : nrm[1] ? 1 : 2; const sg = nrm[ax] > 0 ? 1 : -1;
      const fixed = ax === 0 ? (sg > 0 ? bx.maxX : bx.minX) : ax === 1 ? (sg > 0 ? bx.maxY : bx.minY) : (sg > 0 ? bx.maxZ : bx.minZ);
      const u = [0, 1, 2].filter((k) => k !== ax);
      const lo = u.map((k) => [bx.minX, bx.minY, bx.minZ][k]); const hi = u.map((k) => [bx.maxX, bx.maxY, bx.maxZ][k]);
      for (let p0 = lo[0] + 0.05; p0 <= hi[0] - 0.05 + 1e-9; p0 += 0.5) for (let p1 = lo[1] + 0.05; p1 <= hi[1] - 0.05 + 1e-9; p1 += 0.5) {
        const p = [0, 0, 0]; p[ax] = fixed; p[u[0]] = p0; p[u[1]] = p1;
        if (p[1] < 0.001 && nrm[1] < 0) continue;
        if (!world.inside(p[0], p[2]) || world.buried(p[0], p[1], p[2], ...nrm) || world.guarded(p[0], p[1], p[2], ...nrm, clear)) continue;
        const c = [p[0] + nrm[0] * r, p[1] + nrm[1] * r, p[2] + nrm[2] * r];
        if (c[1] < r * 0.7 || centreIn(...c) || escapes(c, 30) < 30) continue;
        const bd = { x: p[0], y: p[1], z: p[2], nx: nrm[0], ny: nrm[1], nz: nrm[2], fx: 0, fy: 0, fz: 0, box: bx, r, head: d.head, step: d.step, sq: false, at: true, yaw: 0, wa: 0 };
        world.reHead(bd, 0, nrm[1] ? 0 : 1, nrm[1] ? 1 : 0);
        const k = key(bd); if (seen.has(k)) continue; seen.add(k); queue.push(bd); seeds++;
      }
    }
  }
  const sealed = []; let inSolid = 0; let outside = 0; let overlap = 0; let states = 0;
  while (queue.length && states < 300000) {
    const s0 = queue.pop(); states++;
    const c = [s0.x + s0.nx * r, s0.y + s0.ny * r, s0.z + s0.nz * r];
    if (c[1] < r * 0.7) continue; // crawling down a wall onto the floor releases the body first
    // a body the engine let into a slot narrower than itself (centre past the walls, inside a box,
    // or overlapping a neighbour) is the engine's contact check, not a map nook: counted apart
    if (c[0] < bounds.minX - 0.01 || c[0] > bounds.maxX + 0.01 || c[2] < bounds.minZ - 0.01 || c[2] > bounds.maxZ + 0.01) outside++;
    else if (centreIn(...c)) inSolid++;
    else if (overlaps(c, r * 0.8, s0.box)) overlap++;
    else if (escapes(c, 4) < 4 && viewpoints(c) < 3) sealed.push({ p: [s0.x, s0.y, s0.z].map((v) => +v.toFixed(2)), n: [s0.nx, s0.ny, s0.nz].map((v) => Math.round(v)), on: s0.box ? s0.box.name || '-' : 'floor' });
    const f = [s0.fx, s0.fy, s0.fz]; const sx = [s0.ny * f[2] - s0.nz * f[1], s0.nz * f[0] - s0.nx * f[2], s0.nx * f[1] - s0.ny * f[0]];
    for (const dir of [f, f.map((v) => -v), sx, sx.map((v) => -v)]) {
      const bd = { ...s0 }; let moved = 0;
      for (let k = 0; k < 8 && moved < 0.2; k++) {
        const px = bd.x; const py = bd.y; const pz = bd.z;
        const res = M.move.crawlStep(world, bd, dir[0] * 2, dir[1] * 2, dir[2] * 2, 1 / 30);
        if (res === 3 || res === 4 || !bd.at) break;
        moved += Math.hypot(bd.x - px, bd.y - py, bd.z - pz) + (res ? 0.2 : 0);
        if (res === 1 || res === 2) break;
      }
      if (moved < 0.02 || !bd.at) continue;
      const k = key(bd); if (seen.has(k)) continue; seen.add(k); queue.push(bd);
    }
  }
  return { seeds, states, sealed, inSolid, outside, overlap, world, colliders: boxes, r };
}

async function pocketsSection() {
  console.log('\n# pockets: no sealed nooks a crawling chameleon can reach (Node, real crawl code, every map, Tiny / Large / Huge)');
  const M = await loadModules();
  const list = M.maps.MAPS.filter((m) => !MAPF.length || MAPF.includes(m.id));
  for (const entry of list) {
    for (const [label, s] of [['Tiny', 0.6], ['Large', 1.3], ['Huge', 1.8]]) {
      const t0 = performance.now();
      const res = pocketScan(M, entry, s);
      const groups = [];
      for (const f of res.sealed) { const g = groups.find((G) => Math.hypot(G.p[0] - f.p[0], G.p[1] - f.p[1], G.p[2] - f.p[2]) < 0.8); if (g) g.k++; else groups.push({ ...f, k: 1 }); }
      assert(!res.sealed.length, `${entry.id} @${label}: no sealed pockets among ${res.states} crawled contacts from ${res.seeds} open seeds${groups.length ? ' — ' + JSON.stringify(groups.slice(0, 6)) : ''} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
      if (res.inSolid + res.outside + res.overlap) console.log(`  note ${entry.id} @${label}: of ${res.states} reached contacts, ${res.inSolid} put the body's centre inside a box, ${res.outside} past the outer walls, ${res.overlap} overlapping a neighbour (slots narrower than the body: the engine checks the contact point only)`);
    }
  }
  // the two cavities from the review are shut
  const mk = M.maps.MAPS.find((m) => m.id === 'market');
  if (mk && (!MAPF.length || MAPF.includes('market'))) {
    const res = pocketScan(M, mk, 0.6);
    const tops = res.colliders.filter((c) => c.name === 'fridge-top');
    const row = tops.length && tops.every((c) => tops.some((o) => o !== c && (Math.abs(o.minX - c.maxX) < 1e-6 || Math.abs(o.maxX - c.minX) < 1e-6)) || c.minX <= -9.99 || c.maxX >= 3.9);
    assert(row, `market: the fridge-top colliders meet edge to edge (no 10 cm slot between the headers: ${tops.map((c) => `${c.minX.toFixed(2)}..${c.maxX.toFixed(2)}`).join(' ')})`);
  }
  const hs = M.maps.MAPS.find((m) => m.id === 'house');
  if (hs && (!MAPF.length || MAPF.includes('house'))) {
    const res = pocketScan(M, hs, 1.3);
    assert(res.world.buried(-3.25, 3.15, -0.25, 0, 1, 0), 'house: the armchair seat under its back cushion (-3.25, 3.15, -0.25) is not a place to stick to (buried)');
  }
}

// ─────────────────────────────────────────────────────────────────────
// browser sections
const FAST = { hide: 12000, seek: 15000, title: 700, recap: 2500, found: 2200, seekLead: 900, resume: 1500, maxDpr: 0.6 };
async function arm(page, tune = FAST) { await page.evaluate((t) => { window.__chamTest = true; window.__chamTune = t; }, tune); }
const st = (p) => p.evaluate(() => window.__cham && window.__cham.state());
const hook = (p, fn, ...args) => p.evaluate(([f, a]) => window.__cham[f](...a), [fn, args]);
async function waitReady(p) { await p.waitForFunction(() => window.__cham && window.__cham.ready, null, { timeout: 60000 }); }
async function waitPhase(p, name, timeout = 40000) { await p.waitForFunction((n) => window.__cham && window.__cham.state().phase.name === n, name, { timeout }); }


/** Pick a map on the start screen: the chip or carousel arrow for it if shown, else step "next". */
async function selectMap(p, id) {
  for (let i = 0; i < 16; i++) {
    const cur = await p.evaluate(() => { const s = window.__cham.state(); return (s.setup && s.setup.map) || s.mapId; });
    if (cur === id) { await p.waitForFunction((m) => window.__cham.state().mapId === m, id, { timeout: 30000 }); return true; }
    const direct = await p.$(`[data-lobby="map"][data-v="${id}"]:not([disabled])`);
    if (direct && await direct.isVisible()) await direct.click();
    else { const nx = await p.$('.chm-arrow[aria-label="Next map"]'); if (!nx) return false; await nx.click(); }
    await wait(250);
  }
  return false;
}

async function extraIds() { const M = await loadModules(); return M.extra.filter((m) => !MAPF.length || MAPF.includes(m.id)); }

async function browserSection(port, { device, viewport, label }) {
  const { launch } = require('../harness');
  console.log(`\n# browser (${label}): select, load, checkMap, draw calls, a hotseat round on every extra map`);
  const entries = await extraIds();
  const h = await launch({ port, only: ['chameleon'], who: ['a'], device });
  const a = h.a;
  const warns = [];
  a.on('console', (m) => { if (m.type() === 'warning' && /atlas full|skipping bad map/.test(m.text())) warns.push(m.text()); });
  try {
    if (viewport) await a.setViewportSize(viewport);
    await arm(a, { ...FAST, hide: 60000, seek: 9000 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await wait(800);
    for (const e of entries) {
      if (!assert(await selectMap(a, e.id), `[${label}] ${e.id}: "${e.name}" can be picked on the start screen`)) continue;
      await wait(500);
      const r = await hook(a, 'checkMap', e.id);
      const bad = Object.entries(r.spawns).filter(([, d]) => d > 0.02);
      assert(!bad.length, `[${label}] ${e.id}: spawns clear of props in the engine (${Object.keys(r.spawns).length} checked)`);
      assert(!!r.camoWall, `[${label}] ${e.id}: the suggested camo spot has a wall to flatten against`);
      for (const p of r.probes) assert(p.got === p.want, `[${label}] ${e.id}: probe "${p.name}" albedo ${p.got} (want ${p.want})`);
      // load time with the real atlas (paint patterns + build geometry + colliders + GPU objects):
      // switch away and back, timing the switch
      const ms = await a.evaluate((id) => { const h = window.__cham; h.setRules({ map: 'living' }); const t0 = performance.now(); h.setRules({ map: id }); return performance.now() - t0; }, e.id);
      const ws = await hook(a, 'worldStats');
      console.log(`  ${e.id}: ${ws.tris} tris, ${ws.chunks} chunks, ${ws.boxes} colliders, atlas ${ws.atlasUsed}/${ws.atlasH}px, map switch ${ms.toFixed(0)} ms`);
      assert(ms < BUDGET.buildMs, `[${label}] ${e.id}: map built and loaded in ${ms.toFixed(0)} ms (< ${BUDGET.buildMs})`);
    }
    // a quick round on each map: hide (walk + pose), seek (fire), recap
    for (const e of entries) {
      await roundOn(h, a, e, label);
    }
    h.assertNoErrors();
    assert(!warns.length, `[${label}] no atlas-full or bad-map warnings${warns.length ? ': ' + warns.join(' | ') : ''}`);
  } catch (err) {
    console.error(err.message, h.errors); failures++;
  } finally { await h.close(); }
}

async function roundOn(h, a, e, label) {
  // reload into a fresh lobby with this map picked, start a hotseat round
  await selectMap(a, e.id);
  await a.click('[data-act="start"]');
  await waitPhase(a, 'curtain');
  await a.click('[data-act="curtain"]');
  await waitPhase(a, 'hide');
  await wait(400);
  let s = await st(a);
  const hider = s.viewer;
  // hide on the map's suggested camo wall
  const spots = await hook(a, 'spots');
  const c = spots.camo;
  await hook(a, 'teleport', c.x, c.z + (c.wallNormal ? c.wallNormal[2] * 0.1 : 0), 0, c.y);
  await wait(200);
  await hook(a, 'resetPerf');
  await wait(1500);
  const perfH = await hook(a, 'perf');
  await a.click('[data-act="ready"]').catch(() => {});
  await waitPhase(a, 'curtain', 20000).catch(() => {});
  s = await st(a);
  if (s.phase.name === 'curtain') await a.click('[data-act="curtain"]');
  await waitPhase(a, 'seek', 20000);
  await wait(600);
  await hook(a, 'resetPerf');
  await wait(1500);
  const perfS = await hook(a, 'perf');
  // aim at the hider and fire
  const hc = await hook(a, 'bodyCenter', hider);
  await hook(a, 'aimAt', hc[0], hc[1], hc[2]);
  await wait(200);
  await hook(a, 'action', 'fire');
  await a.waitForFunction(() => ['found', 'time', 'recap'].includes(window.__cham.state().phase.name), null, { timeout: 30000 }).catch(() => {});
  s = await st(a);
  const calls = Math.max(perfH.calls || 0, perfS.calls || 0);
  assert(['found', 'time', 'recap'].includes(s.phase.name), `[${label}] ${e.id}: a hide-and-seek round runs to the reveal (${s.phase.name})`);
  assert(calls > 0 && calls <= BUDGET.drawCalls, `[${label}] ${e.id}: ${calls} draw calls while playing (hide ${perfH.calls}, seek ${perfS.calls}; ≤ ${BUDGET.drawCalls})`);
  console.log(`  ${e.id}: tris/frame hide ${perfH.tris}, seek ${perfS.tris}`);
  await shotTo(a, `${e.id}-round-${label}`);
  // back to the lobby for the next map
  await a.evaluate(() => window.__cham.action('next')).catch(() => {});
  await a.reload();
  await arm(a, { ...FAST, hide: 60000, seek: 9000 });
  await h.startLive(a, 'chameleon', 'local').catch(() => {});
  await waitReady(a);
  await wait(500);
}

async function shotTo(p, name) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); }

/** Screenshots of every room: a third-person view from the room's camera spot. */
async function roomsSection(port) {
  const { launch } = require('../harness');
  console.log('\n# rooms: screenshots of every room, 3 viewports × light/dark');
  const M = await loadModules();
  const entries = M.extra.filter((m) => !MAPF.length || MAPF.includes(m.id));
  const VIEWS = [['phone', 'iPhone 13', { width: 390, height: 844 }], ['land', 'iPhone 13', { width: 844, height: 390 }], ['laptop', 'Desktop Chrome', { width: 1280, height: 800 }]];
  const themes = (process.env.THEMES || 'light,dark').split(',');
  for (const theme of themes) {
    for (const [vk, device, vp] of VIEWS.filter(([k]) => !process.env.VIEWS || process.env.VIEWS.split(',').includes(k))) {
      const h = await launch({ port, only: ['chameleon'], who: ['a'], device, colorScheme: theme });
      const a = h.a;
      try {
        await a.setViewportSize(vp);
        await arm(a, { ...FAST, hide: 600000, seek: 600000, maxDpr: 1, fixedScale: true });
        await h.startLive(a, 'chameleon', 'local');
        await waitReady(a);
        for (const e of entries) {
          await selectMap(a, e.id);
          await wait(400);
          if (vk === 'phone') await shotTo(a, `${e.id}-lobby-${vk}-${theme}`);
          const cams = (e.info.cams || []);
          await a.addStyleTag({ content: '.chm-shotmode .chm-over, .chm-shotmode .chm-top, .chm-shotmode .chm-sub { visibility: hidden !important; }' });
          await a.evaluate(() => document.body.classList.add('chm-shotmode'));
          for (const cam of cams) {
            await hook(a, 'lookFrom', [...cam.p, ...cam.t]);
            await wait(900);
            await shotTo(a, `${e.id}-${cam.name}-${vk}-${theme}`);
          }
          await hook(a, 'lookFrom', null);
          await a.evaluate(() => document.body.classList.remove('chm-shotmode'));
        }
        h.assertNoErrors();
      } catch (err) {
        console.error(err.message, h.errors); failures++;
      } finally { await h.close(); }
    }
  }
}

module.exports = { analyse, loadModules, floodFill, clusters, pocketScan };

if (require.main === module) {
  (async () => {
    try {
      if (want('static')) await staticSection();
      if (want('pockets')) await pocketsSection();
      if (want('browser')) {
        await browserSection(PORT, { device: 'iPhone 13', viewport: null, label: 'phone' });
        await browserSection(PORT + 1, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, label: 'laptop' });
      }
      if (want('rooms')) await roomsSection(PORT + 2);
    } catch (e) { console.error(e); failures++; }
    if (failures) { console.error(`\n${failures} check(s) failed`); process.exitCode = 1; } else console.log('\nALL GOOD');
  })();
}
