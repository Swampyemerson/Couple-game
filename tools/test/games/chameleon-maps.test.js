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
  const [maps, geo, extra] = await Promise.all([imp('maps.js'), imp('geo.js'), imp('maps/index.js')]);
  return { maps, geo, extra: extra.EXTRA_MAPS };
}

function buildStatic(M, entry) {
  const atlas = fakeAtlas();
  const t0 = performance.now();
  const fill = entry.build(atlas, M.maps.KIT);
  const at = atlas.finish();
  const b = M.geo.createBuilder({ tiles: at.tiles, ink: [0.1, 0.1, 0.1] });
  const t1 = performance.now();
  fill(b);
  const out = b.finish(FAKE_THREE);
  const t2 = performance.now();
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
  assert(list.length >= 4, `EXTRA_MAPS lists ${list.length} maps (${list.map((m) => m.id).join(', ')})`);
  const report = [];
  for (const entry of list) {
    const tag = entry.id;
    assert(typeof entry.build === 'function' && entry.name && entry.blurb && entry.info && entry.info.w && entry.info.d, `${tag}: entry has build, name, blurb and info`);
    const res = analyse(M, entry);
    report.push(res);
    const area = entry.info.w * entry.info.d;
    console.log(`  ${tag}: ${entry.info.w}×${entry.info.d} m (${area} m² footprint, ${(entry.info.floors || [1]).length} floor(s)), ${res.tris.toLocaleString()} tris, ${res.verts.toLocaleString()} verts, ${res.chunks} chunks, ${res.colliders} colliders, ${res.blobs} blobs, ${res.tiles} atlas tiles (${res.atlasUsed}px of 1024 used), geometry built in ${res.buildMsNode.toFixed(0)} ms`);
    assert(area >= 160 && area <= 420, `${tag}: footprint ${area} m² is 2–4× the 80–120 m² originals (${(area / 100).toFixed(1)}×)`);
    assert(res.tris < BUDGET.tris, `${tag}: ${res.tris.toLocaleString()} triangles < ${BUDGET.tris.toLocaleString()}`);
    assert(!res.atlasDropped.length, `${tag}: every atlas tile fits in one 1024² page${res.atlasDropped.length ? ' (dropped ' + res.atlasDropped.join(', ') + ')' : ''}`);
    assert(res.buildMsNode < 250, `${tag}: geometry + colliders build in ${res.buildMsNode.toFixed(0)} ms (Node, without painting the atlas)`);
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
    await arm(a, { ...FAST, hide: 60000, seek: 60000 });
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
      // build time with the real atlas: rebuild once from scratch
      const ms = await a.evaluate((id) => window.__cham.rebuildMs ? window.__cham.rebuildMs(id) : null, e.id);
      if (ms != null) assert(ms < BUDGET.buildMs, `[${label}] ${e.id}: map + atlas built in ${ms.toFixed(0)} ms (< ${BUDGET.buildMs})`);
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
  // walk a little with the keyboard / joystick, then hide on the camo wall
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
  await h.reloadToLobby ? h.reloadToLobby(a) : null;
  await a.evaluate(() => window.__cham.action('next')).catch(() => {});
  await a.reload();
  await arm(a, { ...FAST, hide: 60000, seek: 60000 });
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

module.exports = { analyse, loadModules, floodFill, clusters };

if (require.main === module) {
  (async () => {
    try {
      if (want('static')) await staticSection();
      if (want('browser')) {
        await browserSection(PORT, { device: 'iPhone 13', viewport: null, label: 'phone' });
        await browserSection(PORT + 1, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, label: 'laptop' });
      }
      if (want('rooms')) await roomsSection(PORT + 2);
    } catch (e) { console.error(e); failures++; }
    if (failures) { console.error(`\n${failures} check(s) failed`); process.exitCode = 1; } else console.log('\nALL GOOD');
  })();
}
