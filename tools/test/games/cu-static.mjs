// Node-side analysis of the CU Boulder map (used by chameleon-cu.test.js): builds the map with
// a stub canvas (patterns are not rasterised), then measures triangles/colliders and runs a
// walk/jump flood fill over the colliders with the engine's own world.js.
//   node tools/test/games/cu-static.mjs            prints a JSON report
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);

function stubCanvas() {
  const noop = () => {};
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (k === 'getLineDash') return () => [];
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: 1, height: 1, getContext: () => ctx };
}
globalThis.document = { createElement: () => stubCanvas() };

export async function analyse({ cell = 0.25, r = 0.24 } = {}) {
  const THREE = require(path.join(ROOT, 'tools/test/.cache/three.min.js'));
  const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
  const { CUBOULDER } = await imp('js/games/chameleon/maps/cuboulder.js');
  const { KIT } = await imp('js/games/chameleon/maps.js');
  const { createAtlas } = await imp('js/games/chameleon/atlas.js');
  const { createBuilder } = await imp('js/games/chameleon/geo.js');
  const { createWorld, dims } = await imp('js/games/chameleon/world.js');

  const t0 = performance.now();
  const atlasB = createAtlas(1024, 1024);
  const dropped = [];
  const warn = console.warn; console.warn = (...a) => { dropped.push(a.join(' ')); };
  const fill = CUBOULDER.build(atlasB, KIT);
  const atlas = atlasB.finish();
  console.warn = warn;
  const b = createBuilder({ tiles: atlas.tiles, ink: [0.1, 0.1, 0.1] });
  fill(b);
  const out = b.finish(THREE);
  const ms = performance.now() - t0;
  const map = { colliders: out.colliders, bounds: { minX: -16.9, maxX: 16.85, minZ: -12.9, maxZ: 12.85 } };
  const world = createWorld(map);
  const { info } = CUBOULDER;

  // ── spawns: clear of colliders by 0.45 m (horizontal), standing height ──
  const clearance = (x, y, z) => {
    let best = Infinity;
    for (const c of out.colliders) {
      if (c.maxY <= y + 0.2 || c.minY >= y + 1.0) continue;
      const dx = Math.max(c.minX - x, 0, x - c.maxX); const dz = Math.max(c.minZ - z, 0, z - c.maxZ);
      best = Math.min(best, Math.hypot(dx, dz));
    }
    return best;
  };
  const spots = out.spots;
  const spawnList = [];
  for (const k of ['lobby', 'hiderSpawn', 'seekerSpawn', 'spawnA', 'spawnB']) if (spots[k]) spawnList.push([k, spots[k]]);
  for (const k of ['hiderSpawns', 'seekerSpawns']) (spots[k] || []).forEach((p, i) => spawnList.push([k + '[' + i + ']', p]));
  const spawns = spawnList.map(([k, p]) => ({ k, x: p.x, z: p.z, clear: +clearance(p.x, p.y || 0, p.z).toFixed(3) }));

  // ── flood fill: walk (step), jump (up to the jump apex), drop; states on a grid per surface height ──
  const d = dims(1);
  const B = { minX: -17, maxX: 17, minZ: -13, maxZ: 13 };
  const NX = Math.round((B.maxX - B.minX) / cell); const NZ = Math.round((B.maxZ - B.minZ) / cell);
  const key = (i, j, y) => `${i},${j},${Math.round(y * 100)}`;
  const body = { x: 0, y: 0, z: 0, r, step: d.step, head: d.head, sq: false };
  const fits = (x, y, z) => {
    body.x = x; body.y = y; body.z = z; world.pushOut(body);
    if (Math.hypot(body.x - x, body.z - z) > 0.02) return false;
    return world.ceilingAt(x, z, r, y, d.head) >= y + d.head - 0.01;
  };
  const apex = (d.jump * d.jump) / (2 * 13); // ≈ 0.81 m
  const cxw = (i) => B.minX + (i + 0.5) * cell; const czw = (j) => B.minZ + (j + 0.5) * cell;
  // candidate surface heights per cell: ground + every collider top under the cell centre
  const surf = new Map();
  const tops = (i, j) => {
    const k = i + ',' + j; let s = surf.get(k); if (s) return s;
    const x = cxw(i); const z = czw(j); const set = new Set([0]);
    for (const c of out.colliders) if (x >= c.minX - 0.05 && x <= c.maxX + 0.05 && z >= c.minZ - 0.05 && z <= c.maxZ + 0.05 && c.maxY < 6) set.add(Math.round(c.maxY * 1000) / 1000);
    s = [...set].sort((a, b2) => a - b2); surf.set(k, s); return s;
  };
  const standY = (i, j, y) => world.groundAt(cxw(i), czw(j), r * 0.6, y, d.step);
  const seen = new Set(); const Q = [];
  const start = spots.hiderSpawns && spots.hiderSpawns[0] ? spots.hiderSpawns[0] : spots.lobby;
  const si = Math.floor((start.x - B.minX) / cell); const sj = Math.floor((start.z - B.minZ) / cell);
  const push = (i, j, y) => { const k = key(i, j, y); if (seen.has(k)) return; seen.add(k); Q.push([i, j, y]); };
  push(si, sj, 0);
  const maxY = {};
  while (Q.length) {
    const [i, j, y] = Q.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di; const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
      const x = cxw(ni); const z = czw(nj);
      for (const ty of tops(ni, nj)) {
        if (ty > y + apex + d.step) continue; // too high to jump onto
        const g = standY(ni, nj, ty);
        if (Math.abs(g - ty) > 0.002) continue; // not the surface actually under us
        if (!fits(x, g, z)) continue;
        if (g > y + d.step) {
          // jump: need headroom above the take-off point for the arc
          if (world.ceilingAt(cxw(i), czw(j), r, y, d.head) < g + d.head) continue;
        }
        push(ni, nj, g);
      }
    }
  }
  // every standable cell (any surface with headroom): reached or not
  const reachedCells = new Set([...seen].map((k) => k.split(',').slice(0, 2).join(',')));
  const pockets = []; let standable = 0;
  const unreached = new Set();
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
    for (const ty of tops(i, j)) {
      if (ty > 5.2) continue;
      const g = standY(i, j, ty); if (Math.abs(g - ty) > 0.002) continue;
      if (!fits(cxw(i), g, czw(j))) continue;
      standable++;
      if (!seen.has(key(i, j, g))) unreached.add(key(i, j, g));
    }
  }
  // group unreached states into connected regions (same-level neighbours within a step)
  const byCell = new Map();
  for (const k of unreached) { const [i, j] = k.split(',').map(Number); const c = i + ',' + j; if (!byCell.has(c)) byCell.set(c, []); byCell.get(c).push(k); }
  const left = new Set(unreached);
  for (const k of unreached) {
    if (!left.has(k)) continue;
    left.delete(k);
    const reg = [k]; const st = [k];
    while (st.length) {
      const [i, j, yy] = st.pop().split(',').map(Number);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const k2 of byCell.get((i + di) + ',' + (j + dj)) || []) {
        if (!left.has(k2)) continue;
        const y2 = Number(k2.split(',')[2]);
        if (Math.abs(y2 - yy) <= 25) { left.delete(k2); reg.push(k2); st.push(k2); }
      }
    }
    const pts = reg.map((s2) => s2.split(',').map(Number));
    const area = reg.length * cell * cell;
    const xs = pts.map((p) => cxw(p[0])); const zs = pts.map((p) => czw(p[1]));
    pockets.push({ area: +area.toFixed(2), y: pts[0][2] / 100, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) });
  }
  pockets.sort((a, c) => c.area - a.area);
  // rooms: reached at their floor level?
  const rooms = info.rooms.map((rm) => {
    const fy = info.floors[rm.floor || 0].y;
    let n = 0; let tot = 0;
    for (const s of seen) {
      const [i, j, yy] = s.split(',').map(Number);
      const x = cxw(i); const z = czw(j);
      if (x < rm.x0 || x > rm.x1 || z < rm.z0 || z > rm.z1) continue;
      tot++; if (Math.abs(yy / 100 - fy) < 0.05) n++;
    }
    return { name: rm.name, floorCells: n, anyCells: tot };
  });
  for (const s of seen) { const y = s.split(',')[2] / 100; maxY.top = Math.max(maxY.top || 0, y); }
  const atlasUsed = Object.keys(atlas.tiles).length;
  return {
    ms: +ms.toFixed(1), tris: out.triCount, verts: out.vertexCount, chunks: out.chunks.length, colliders: out.colliders.length, blobs: out.blobs.length,
    atlasTiles: atlasUsed, atlasDropped: dropped, spawns, reached: seen.size, standable, pockets: pockets.slice(0, 12), pocketCount: pockets.length, rooms, maxReachY: maxY.top,
    names: { ceil: out.colliders.filter((c) => c.ceil || /^ceil:/.test(c.name)).length, perch: out.colliders.filter((c) => c.perch || /^perch:/.test(c.name)).length },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  analyse().then((r) => console.log(JSON.stringify(r, null, 1)), (e) => { console.error(e); process.exit(1); });
}
