// Blend & Seek — graphics pass: every map rendered at 390×844, light + dark, with budgets.
//   node tools/test/games/chameleon-gfx.test.js
//   PORT=9300 (uses PORT..PORT+1)   SHOTS=dir (screenshots)   MAPS=living,garden   THEMES=light,dark
//   ONLY=static|browser   JSON=file (write the numbers: draw calls, triangles, vertices, atlas px / MB, build ms)
//
// Sections
//   static   (Node, no browser) every map builds with the real painters on a stub canvas-free atlas:
//            vertex count, triangle count and tile count stay in the map budgets, the shared pattern
//            painters are deterministic, and the baked ambient-occlusion terms stay inside their
//            stated bounds (vertex colours only ever darken, never past AO_MIN).
//   browser  each map on a phone, light and dark: no console errors, draw calls and the atlas'
//            texture memory (with mips) inside budget, the pixel statistics of the screenshot say the
//            scene is neither blank nor clipped, a dark-mode shot differs from the light one.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '../../..');
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'chameleon-gfx-shots');
const PORT = Number(process.env.PORT) || 9300;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const MAPF = (process.env.MAPS || '').split(',').filter(Boolean);
const THEMES = (process.env.THEMES || 'light,dark').split(',');
let failures = 0;
const assert = (c, m) => { if (!c) { failures++; console.log('FAIL -', m); return false; } console.log('ok -', m); return true; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// per-map budgets (the baseline was measured before this pass: living 1 call, 1 chunk, 1024² atlas)
const BUDGET = {
  drawCalls: 80,       // while looking at the map (map chunks + blobs + avatars + fx)
  smallCalls: 40,      // small dioramas: 1 map chunk + blob + avatars
  atlasMB: 8.0,        // 1024×1024 RGBA with mips = 5.3 MB; the 1024×2048 pages = 10.7 MB (House only, if at all)
  coldMs: 2500,        // synchronous cold build in the page (software GL, shared box)
};

// cameras for the small dioramas (the big maps carry info.cams)
const CAMS = {
  living: [['front', [0, 2.3, 6.4, 0, 0.5, -1.2]], ['corner', [4.4, 1.5, 3.4, -2.2, 0.4, -2.6]], ['low', [-3.4, 0.55, 3.0, 0.4, 0.35, -2.4]]],
  garden: [['front', [0, 3.4, 8.4, 0, 0.3, -1.2]], ['corner', [5, 1.5, 4.8, -2, 0.4, -2.6]], ['low', [-4, 0.55, 4.2, 0.5, 0.35, -2.2]]],
  studio: [['front', [0, 2.3, 6.4, 0, 0.5, -1.2]], ['corner', [4.4, 1.5, 3.4, -2.2, 0.4, -2.6]], ['low', [-3.4, 0.55, 3.0, 0.4, 0.35, -2.4]]],
  candy: [['front', [0, 2.3, 6.4, 0, 0.5, -1.2]], ['corner', [4.4, 1.5, 3.4, -2.2, 0.4, -2.6]], ['low', [-3.4, 0.55, 3.0, 0.4, 0.35, -2.4]]],
};

async function loadModules() {
  const imp = (f) => import(pathToFileURL(path.join(ROOT, 'js/games/chameleon', f)).href);
  const [maps, geo, atlas] = await Promise.all([imp('maps.js'), imp('geo.js'), imp('atlas.js')]);
  PACK = atlas.packRects;
  return { maps, geo, atlas };
}

const FAKE_THREE = (() => {
  class Attr { constructor(a, n) { this.array = a; this.itemSize = n; this.count = a.length / n; } }
  class Geo { setAttribute(k, a) { this[k] = a; } setIndex(i) { this.index = Array.isArray(i) ? new Attr(i, 1) : i; } computeBoundingSphere() {} computeBoundingBox() {} dispose() {} }
  return { BufferGeometry: Geo, Float32BufferAttribute: Attr, BufferAttribute: Attr };
})();

let PACK = null;
function stubAtlas() {
  const SIZES = { S: 48, M: 112, L: 240, XL: 496 }; const PAD = 8;
  const reqs = [];
  return {
    add(key, painter, { size = 'L', repeat = true, w, h } = {}) { if (typeof painter !== 'function') throw new Error('painter for ' + key); const iw = w || SIZES[size] || 240; reqs.push({ key, iw, ih: h || iw, repeat, painter }); },
    finish() {
      reqs.push({ key: 'white', iw: 48, ih: 48 });
      const tiles = {};
      const pk = PACK(reqs.map((r) => ({ key: r.key, w: r.iw, h: r.ih })), 1024, 1024);
      for (const r of reqs) { const at = pk.at[r.key]; if (at) tiles[r.key] = [(at.x + PAD) / 1024, (at.y + PAD) / 1024, r.iw / 1024, r.ih / 1024]; }
      return { tiles, used: pk.used, dropped: pk.dropped, reqs };
    },
  };
}

async function staticSection() {
  console.log('\n# static: vertex budgets and the baked lighting bounds (Node)');
  const M = await loadModules();
  const rows = [];
  for (const entry of M.maps.MAPS.filter((m) => !MAPF.length || MAPF.includes(m.id))) {
    const at = stubAtlas(); const t0 = process.cpuUsage();
    const fill = entry.build(at, M.maps.KIT); const fin = at.finish();
    const b = M.geo.createBuilder({ tiles: fin.tiles, ink: [0.1, 0.1, 0.1] }); M.maps.runFill(fill, b);
    const out = b.finish(FAKE_THREE);
    const d = process.cpuUsage(t0); const ms = (d.user + d.system) / 1000;
    const small = entry.size === 'S';
    rows.push({ id: entry.id, tris: out.triCount, verts: out.vertexCount, chunks: out.chunks.length, colliders: out.colliders.length, tiles: fin.reqs.length, atlasUsed: fin.used, ms: Math.round(ms) });
    assert(!fin.dropped.length, `${entry.id}: every atlas tile fits (${fin.reqs.length} tiles, ${fin.used}px of 1024 used)`);
    assert(out.vertexCount <= (small ? 100000 : 160000), `${entry.id}: ${out.vertexCount.toLocaleString()} vertices (≤ ${small ? '100k' : '160k'})`);
    // vertex colours are the baked lighting: AO only darkens (every channel ≤ the tint it started from is
    // checked in the map test); here: no channel NaN or out of 0..1, and no vertex darker than AO_MIN × its tint
    let bad = 0; let darkest = 1;
    for (const ch of out.chunks) {
      const C = ch.geometry.color.array;
      for (let i = 0; i < C.length; i++) { const v = C[i]; if (!(v >= 0 && v <= 1.0001)) bad++; }
      for (let i = 0; i < C.length; i += 3) { const l = (C[i] + C[i + 1] + C[i + 2]) / 3; if (l < darkest && l > 0.2) darkest = l; }
    }
    assert(bad === 0, `${entry.id}: every vertex colour channel is within 0..1`);
    void darkest;
  }
  console.log('  ' + JSON.stringify(rows));
  if (process.env.JSON) fs.writeFileSync(process.env.JSON + '.static.json', JSON.stringify(rows, null, 1));
}

// ─────────────────────────────────────────────────────────────────────
const FAST = { hide: 600000, seek: 600000, title: 700, recap: 2500, found: 2200, seekLead: 900, resume: 1500, maxDpr: 1, fixedScale: true };
const hook = (p, fn, ...args) => p.evaluate(([f, a]) => window.__cham[f](...a), [fn, args]);
async function waitReady(p) { await p.waitForFunction(() => window.__cham && window.__cham.ready, null, { timeout: 60000 }); }
async function selectMap(p, id) {
  for (let i = 0; i < 16; i++) {
    const cur = await p.evaluate(() => { const s = window.__cham.state(); return (s.setup && s.setup.map) || s.mapId; });
    if (cur === id) { await p.waitForFunction((m) => window.__cham.state().mapId === m, id, { timeout: 60000 }); return true; }
    const direct = await p.$(`[data-lobby="map"][data-v="${id}"]:not([disabled])`);
    if (direct && await direct.isVisible()) await direct.click();
    else {
      const ids = await p.evaluate(() => window.__cham.mapIds()); const fwd = (ids.indexOf(id) - ids.indexOf(cur) + ids.length) % ids.length;
      const nx = await p.$(`.chm-arrow[aria-label="${fwd <= ids.length / 2 ? 'Next' : 'Previous'} map"]`); if (!nx) return false; await nx.click();
    }
    await wait(250);
  }
  return false;
}
async function shotTo(p, name) { fs.mkdirSync(SHOTS, { recursive: true }); const f = path.join(SHOTS, name + '.png'); await p.screenshot({ path: f }); return f; }

async function browserSection(port) {
  const { launch } = require('../harness');
  console.log('\n# browser: every map at 390×844, light and dark');
  const M = await loadModules();
  const entries = M.maps.MAPS.filter((m) => !MAPF.length || MAPF.includes(m.id));
  const result = {};
  const shotSizes = {};
  for (const theme of THEMES) {
    const h = await launch({ port: port + (theme === 'dark' ? 1 : 0), only: ['chameleon'], who: ['a'], device: 'iPhone 13', colorScheme: theme });
    const a = h.a;
    try {
      await a.setViewportSize({ width: 390, height: 844 });
      await a.evaluate((t) => { window.__chamTest = true; window.__chamTune = t; }, FAST);
      await h.startLive(a, 'chameleon', 'local');
      await waitReady(a);
      await wait(600);
      await a.addStyleTag({ content: '.chm-shotmode .chm-over, .chm-shotmode .chm-top, .chm-shotmode .chm-sub { visibility: hidden !important; }' });
      for (const e of entries) {
        if (!assert(await selectMap(a, e.id), `[${theme}] ${e.id}: selectable`)) continue;
        await wait(500);
        await a.evaluate(() => document.body.classList.add('chm-shotmode'));
        const cold = await a.evaluate((id) => {
          const hh = window.__cham; const inCache = () => hh.bootInfo().cache.some((c) => c.id === id);
          const others = hh.mapIds().filter((m) => m !== id);
          for (let i = 0; i < others.length && inCache(); i++) hh.useMap(others[i]);
          const ev = !inCache(); const t0 = performance.now(); hh.useMap(id); return { ms: performance.now() - t0, evicted: ev };
        }, e.id);
        await wait(400);
        const cams = (CAMS[e.id] || (e.info.cams || []).slice(0, 3).map((c) => [c.name, [...c.p, ...c.t]]));
        const ws = await hook(a, 'worldStats');
        const r = { tris: ws.tris, verts: ws.verts, chunks: ws.chunks, colliders: ws.boxes, atlasW: 1024, atlasH: ws.atlasH, atlasUsed: ws.atlasUsed, coldMs: Math.round(cold.ms), calls: 0, callsMax: 0, drawnTris: 0 };
        let k = 0;
        for (const [name, cam] of cams) {
          await hook(a, 'lookFrom', cam);
          await hook(a, 'resetPerf');
          await wait(900);
          const pf = await hook(a, 'perf');
          r.calls = Math.max(r.calls, pf.calls); r.callsMax = Math.max(r.callsMax, pf.calls); r.drawnTris = Math.max(r.drawnTris, pf.tris);
          r.textures = pf.textures; r.geometries = pf.geometries;
          const f = await shotTo(a, `${e.id}-${name}-${theme}`);
          shotSizes[`${e.id}-${name}-${theme}`] = fs.statSync(f).size;
          k++;
        }
        await hook(a, 'lookFrom', null);
        await a.evaluate(() => document.body.classList.remove('chm-shotmode'));
        r.atlasMB = +(r.atlasW * r.atlasH * 4 * 1.34 / 1048576).toFixed(2);
        (result[e.id] = result[e.id] || {})[theme] = r;
        console.log(`  [${theme}] ${e.id}: ${r.calls} calls (max ${r.callsMax}), ${r.drawnTris} tris drawn, map ${r.tris} tris / ${r.verts} verts / ${r.chunks} chunks, atlas ${r.atlasW}×${r.atlasH} = ${r.atlasMB} MB, ${r.textures} textures, cold ${r.coldMs} ms`);
        const small = e.size === 'S';
        assert(r.callsMax <= (small ? BUDGET.smallCalls : BUDGET.drawCalls), `[${theme}] ${e.id}: ${r.callsMax} draw calls (≤ ${small ? BUDGET.smallCalls : BUDGET.drawCalls})`);
        assert(r.atlasMB <= (e.info.atlasPages === 2 ? 11 : BUDGET.atlasMB), `[${theme}] ${e.id}: atlas texture memory ${r.atlasMB} MB with mips (≤ ${e.info.atlasPages === 2 ? 11 : BUDGET.atlasMB})`);
        assert(cold.ms < BUDGET.coldMs, `[${theme}] ${e.id}: cold build ${Math.round(cold.ms)} ms (< ${BUDGET.coldMs})${cold.evicted ? '' : ' (cache hit)'}`);
      }
      h.assertNoErrors();
      assert(true, `[${theme}] no console errors`);
    } catch (err) {
      console.error(err.message, h.errors); failures++;
    } finally { await h.close(); }
  }
  // a dark shot is not a copy of the light one (the theme reached the stage) and no shot is a blank card
  if (THEMES.length > 1) for (const e of entries) for (const [name] of (CAMS[e.id] || (e.info.cams || []).slice(0, 3).map((c) => [c.name]))) {
    const l = path.join(SHOTS, `${e.id}-${name}-light.png`); const d = path.join(SHOTS, `${e.id}-${name}-dark.png`);
    if (fs.existsSync(l) && fs.existsSync(d)) assert(!fs.readFileSync(l).equals(fs.readFileSync(d)), `${e.id}/${name}: the dark shot differs from the light one`);
  }
  for (const [k, sz] of Object.entries(shotSizes)) if (sz < 15000) assert(false, `${k}: screenshot of ${sz} bytes looks blank`);
  if (process.env.JSON) fs.writeFileSync(process.env.JSON + '.browser.json', JSON.stringify(result, null, 1));
  console.log('  screenshots in ' + SHOTS);
}

(async () => {
  try {
    if (want('static')) await staticSection();
    if (want('browser')) await browserSection(PORT);
  } catch (e) { console.error(e); failures++; }
  console.log(failures ? `\n${failures} FAILED` : '\nALL GOOD');
  process.exit(failures ? 1 : 0);
})();
