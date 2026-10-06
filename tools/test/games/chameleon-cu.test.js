// Blend & Seek — the CU Boulder map (js/games/chameleon/maps/cuboulder.js).
//   node tools/test/games/chameleon-cu.test.js                   (all sections)
//   ONLY=static | load | round | shots   PORT=8990 (uses PORT..PORT+2; keep within 8990–8999)
//   SHOTS=dir (default: $TMPDIR/chameleon-cu-shots)   THEMES=light,dark   VIEWS=phone,land,laptop
//
// static  Node build (stub canvas): triangles, colliders, atlas fit, spawn clearance, and a
//         walk/step/jump flood fill with the engine's world.js from a hider spawn: every zone is
//         reached on its own floor, and no ground-level walkable pocket is left enclosed.
// load    phone + laptop: the map is selectable on the start screen, loads with no page errors,
//         checkMap (spawns, camo wall, eyedropper probes), build time with the real atlas.
// round   a quick hotseat hide-and-seek round (hide under the demo bench, seeker finds + tags),
//         draw calls and triangles per frame while hiding and seeking.
// shots   every zone from the map's info.cams at 390×844, 844×390 and 1280×800, light + dark.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { launch } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'chameleon-cu-shots');
const PORT = Number(process.env.PORT) || 8990;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const BUDGET = { tris: 120000, drawCalls: 80, buildMs: 400 };
const ID = 'cuboulder';
let failures = 0;
const assert = (c, m) => { if (!c) { failures++; console.log('FAIL -', m); return false; } console.log('ok -', m); return true; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });

const FAST = { hide: 12000, seek: 15000, title: 700, recap: 2500, found: 2200, seekLead: 900, resume: 1500, maxDpr: 0.6 };
async function arm(page, tune = FAST) { await page.evaluate((t) => { window.__chamTest = true; window.__chamTune = t; }, tune); }
const st = (p) => p.evaluate(() => window.__cham && window.__cham.state());
const hook = (p, fn, ...args) => p.evaluate(([f, a]) => window.__cham[f](...a), [fn, args]);
async function waitReady(p) { await p.waitForFunction(() => window.__cham && window.__cham.ready, null, { timeout: 60000 }); }
async function waitPhase(p, name, timeout = 40000) { await p.waitForFunction((n) => window.__cham && window.__cham.state().phase.name === n, name, { timeout }); }
async function shot(p, name) { await p.screenshot({ path: path.join(SHOTS, name + '.png') }); }

/** Pick the map on the start screen: its chip / arrow if shown, else step "next". */
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

// ─────────────────────────────────────────────────────────────────────
async function staticSection() {
  console.log('\n# static: Node build, budgets, spawns, flood fill');
  const { analyse } = await import(pathToFileURL(path.join(__dirname, 'cu-static.mjs')).href);
  const r = await analyse();
  console.log(`  ${r.tris} triangles (incl. outline hulls), ${r.verts} vertices, ${r.colliders} colliders (${r.names.ceil} ceil, ${r.names.perch} perch), ${r.atlasTiles} atlas tiles, Node build ${r.ms} ms`);
  assert(r.tris <= BUDGET.tris, `triangles ${r.tris} ≤ ${BUDGET.tris}`);
  assert(!r.atlasDropped.length, `every pattern fits one 1024² atlas${r.atlasDropped.length ? ': ' + r.atlasDropped.join(', ') : ''}`);
  const tight = r.spawns.filter((s) => s.clear < 0.45);
  assert(!tight.length, `all ${r.spawns.length} spawns are ≥ 0.45 m clear of colliders${tight.length ? ': ' + JSON.stringify(tight) : ''}`);
  for (const rm of r.rooms) assert(rm.floorCells > 20, `flood fill reaches "${rm.name}" on its floor (${rm.floorCells} cells)`);
  const ground = r.pockets.filter((p) => p.y < 0.3 && p.area >= 0.25);
  assert(!ground.length, `no enclosed walkable pocket at ground level${ground.length ? ': ' + JSON.stringify(ground) : ''}`);
  const big = r.pockets.filter((p) => p.area >= 3);
  assert(!big.length, `no large unreachable area (≥ 3 m²) anywhere${big.length ? ': ' + JSON.stringify(big) : ''}`);
  console.log(`  reached ${r.reached} of ${r.standable} standable states; ${r.pocketCount} small raised perches are climb-only (largest ${r.pockets[0] ? r.pockets[0].area + ' m² at y ' + r.pockets[0].y : '—'})`);
}

// ─────────────────────────────────────────────────────────────────────
async function loadSection(port, { device, viewport, label }) {
  console.log(`\n# load (${label}): select, load, checkMap, build time`);
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
    assert(await selectMap(a, ID), `[${label}] "CU Boulder" can be picked on the start screen`);
    await wait(900);
    await shot(a, `lobby-${label}`);
    const r = await hook(a, 'checkMap', ID);
    const bad = Object.entries(r.spawns).filter(([, d]) => d > 0.02);
    assert(!bad.length, `[${label}] spawns clear of props in the engine (${Object.keys(r.spawns).length} checked)`);
    if (r.spawnsHuge) { const bh = Object.entries(r.spawnsHuge).filter(([, d]) => d > 0.02); assert(!bh.length, `[${label}] spawns clear at the largest size${bh.length ? ': ' + bh.map(([k]) => k).join(', ') : ''}`); }
    assert(!!r.camoWall, `[${label}] the camo spot has a sandstone wall to flatten against`);
    for (const p of r.probes) assert(p.got === p.want, `[${label}] probe "${p.name}" albedo ${p.got} (want ${p.want})`);
    // build time with the real atlas: load another map, then time a fresh load of this one
    const ms = await a.evaluate((id) => { window.__cham.checkMap('living'); const t0 = performance.now(); window.__cham.checkMap(id); return performance.now() - t0; }, ID);
    assert(ms < BUDGET.buildMs, `[${label}] map + atlas built in ${ms.toFixed(0)} ms (< ${BUDGET.buildMs})`);
    await wait(300);
    h.assertNoErrors();
    assert(!warns.length, `[${label}] no atlas-full / bad-map warnings${warns.length ? ': ' + warns.join(' | ') : ''}`);
  } catch (e) { console.error(e.message, h.errors); failures++; } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
async function roundSection(port) {
  console.log('\n# round: a quick hotseat hide-and-seek on CU Boulder (phone)');
  const h = await launch({ port, only: ['chameleon'], who: ['a'], device: 'iPhone 13' });
  const a = h.a;
  try {
    await arm(a, { ...FAST, hide: 60000, seek: 60000 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await wait(600);
    await selectMap(a, ID);
    await a.click('[data-act="start"]');
    await waitPhase(a, 'curtain');
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(500);
    let s = await st(a);
    const hider = s.viewer;
    const start = s.bodies[hider];
    // walk a bit with the joystick
    const box = await a.evaluate(() => { const r = document.querySelector('.chm-surface').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    await a.evaluate(async ([x0, y0]) => {
      const el = document.elementFromPoint(x0, y0);
      const mk = (type, x, y) => new PointerEvent(type, { pointerId: 11, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 });
      el.dispatchEvent(mk('pointerdown', x0, y0));
      for (let i = 1; i <= 6; i++) { await new Promise((r) => setTimeout(r, 30)); el.dispatchEvent(mk('pointermove', x0, y0 - i * 8)); }
      await new Promise((r) => setTimeout(r, 900));
      el.dispatchEvent(mk('pointerup', x0, y0 - 48));
    }, [box[0] + 80, box[1] + box[3] - 150]);
    s = await st(a);
    const moved = Math.hypot(s.bodies[hider].x - start.x, s.bodies[hider].z - start.z);
    assert(moved > 0.3, `hider walked ${moved.toFixed(2)} m on the quad`);
    // hide in the kneehole under the G1B30 demo bench
    await hook(a, 'teleport', -10.0, -3.15, Math.PI, 0);
    await wait(300);
    s = await st(a);
    assert(Math.abs(s.bodies[hider].x + 10) < 0.3 && s.bodies[hider].y < 0.05, `hider fits under the demo bench (${s.bodies[hider].x.toFixed(2)}, ${s.bodies[hider].z.toFixed(2)})`);
    await hook(a, 'resetPerf'); await wait(1500);
    const perfH = await hook(a, 'perf');
    await a.click('[data-act="ready"]').catch(() => hook(a, 'action', 'ready'));
    await waitPhase(a, 'curtain', 20000).catch(() => {});
    if ((await st(a)).phase.name === 'curtain') await a.click('[data-act="curtain"]');
    await waitPhase(a, 'seek', 20000);
    s = await st(a);
    const seeker = s.viewer;
    assert(seeker !== hider, 'roles swap for the hunt');
    // seeker comes in by the stage door and looks under the bench from the chalkboard side
    await hook(a, 'teleport', -10.4, -1.75, Math.PI, 0);
    await wait(400);
    await hook(a, 'resetPerf'); await wait(1500);
    const perfS = await hook(a, 'perf');
    const hc = await hook(a, 'bodyCenter', hider);
    await hook(a, 'aimAt', hc[0], hc[1], hc[2]);
    await wait(300);
    await shot(a, 'round-seek-under-bench');
    await hook(a, 'action', 'fire');
    await a.waitForFunction(() => ['found', 'recap'].includes(window.__cham.state().phase.name), null, { timeout: 30000 }).catch(() => {});
    s = await st(a);
    assert(['found', 'recap'].includes(s.phase.name), `the seeker tags the hider under the bench (${s.phase.name})`);
    await wait(1200);
    await shot(a, 'round-found');
    const calls = Math.max(perfH.calls || 0, perfS.calls || 0);
    assert(calls > 0 && calls <= BUDGET.drawCalls, `${calls} draw calls while playing (hide ${perfH.calls}, seek ${perfS.calls}; ≤ ${BUDGET.drawCalls})`);
    console.log(`  triangles per frame: hide ${perfH.tris}, seek ${perfS.tris}`);
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); await shot(a, 'round-FAIL').catch(() => {}); failures++; } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
async function shotsSection(port) {
  console.log('\n# shots: every zone × 3 viewports × light/dark');
  const imp = await import(pathToFileURL(path.join(__dirname, '../../../js/games/chameleon/maps/cuboulder.js')).href).catch(() => null);
  const cams = imp ? imp.CUBOULDER.info.cams : [];
  const VIEWS = [['phone', 'iPhone 13', { width: 390, height: 844 }], ['land', 'iPhone 13', { width: 844, height: 390 }], ['laptop', 'Desktop Chrome', { width: 1280, height: 800 }]]
    .filter(([k]) => !process.env.VIEWS || process.env.VIEWS.split(',').includes(k));
  const only = (process.env.CAMS || '').split(',').filter(Boolean);
  for (const theme of (process.env.THEMES || 'light,dark').split(',')) {
    for (const [vk, device, vp] of VIEWS) {
      const h = await launch({ port, only: ['chameleon'], who: ['a'], device, colorScheme: theme });
      const a = h.a;
      try {
        await a.setViewportSize(vp);
        await arm(a, { ...FAST, hide: 600000, seek: 600000, maxDpr: 1, fixedScale: true });
        await h.startLive(a, 'chameleon', 'local');
        await waitReady(a);
        await selectMap(a, ID);
        await wait(600);
        await shot(a, `lobby-${vk}-${theme}`);
        await a.addStyleTag({ content: '.cushot .chm-over, .cushot .chm-top, .cushot .chm-sub, .cushot .chm-card { visibility: hidden !important; }' });
        await a.evaluate(() => document.body.classList.add('cushot'));
        for (const cam of cams.filter((c) => !only.length || only.includes(c.name))) {
          await hook(a, 'lookFrom', [...cam.p, ...cam.t]);
          await wait(900);
          await shot(a, `${cam.name}-${vk}-${theme}`);
        }
        await hook(a, 'lookFrom', null);
        h.assertNoErrors();
        console.log(`ok - ${cams.length} zone shots at ${vk} ${theme}`);
      } catch (e) { console.error(e.message, h.errors); failures++; } finally { await h.close(); }
    }
  }
  console.log(`  screenshots in ${SHOTS}`);
}

(async () => {
  try {
    if (want('static')) await staticSection();
    if (want('load')) {
      await loadSection(PORT, { device: 'iPhone 13', viewport: null, label: 'phone' });
      await loadSection(PORT + 1, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, label: 'laptop' });
    }
    if (want('round')) await roundSection(PORT + 2);
    if (want('shots')) await shotsSection(PORT);
  } catch (e) { console.error(e); failures++; }
  if (failures) { console.error(`\n${failures} check(s) failed`); process.exitCode = 1; } else console.log('\nALL GOOD');
})();
