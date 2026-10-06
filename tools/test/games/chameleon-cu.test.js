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
  // the G1B30 catwalk (deck at 4.82 m) is climb-only by design: ladder, ropes, pulleys or the walls
  const catwalk = r.pockets.find((p) => Math.abs(p.y - 4.82) < 0.02 && p.x0 < -15 && p.x1 > -5);
  assert(!!catwalk, `the G1B30 catwalk is a climb-only deck (${catwalk ? catwalk.area + ' m²' : 'missing'})`);
  const big = r.pockets.filter((p) => p.area >= 3 && p !== catwalk);
  assert(!big.length, `no other large unreachable area (≥ 3 m²)${big.length ? ': ' + JSON.stringify(big) : ''}`);
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
    // hide in the kneehole under the G1B30 demo bench (open on the chalkboard side)
    await hook(a, 'teleport', -12.0, -2.95, Math.PI, 0);
    await wait(300);
    s = await st(a);
    assert(Math.abs(s.bodies[hider].x + 12) < 0.3 && s.bodies[hider].y < 0.05, `hider fits under the demo bench (${s.bodies[hider].x.toFixed(2)}, ${s.bodies[hider].z.toFixed(2)})`);
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
    await hook(a, 'teleport', -12.4, -2.05, Math.PI, 0);
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

// ─────────────────────────────────────────────────────────────────────
/** Render a list of [name, cam, viewport, theme] views; returns { name: file }. */
async function views(port, list, { device = 'iPhone 13' } = {}) {
  const out = {};
  const groups = {};
  for (const v of list) { const k = v[2].width + 'x' + v[2].height + ':' + (v[3] || 'light'); (groups[k] = groups[k] || []).push(v); }
  for (const g of Object.values(groups)) {
    const [, , vp, theme = 'light'] = g[0];
    const h = await launch({ port, only: ['chameleon'], who: ['a'], device: vp.width > 900 ? 'Desktop Chrome' : device, colorScheme: theme });
    const a = h.a;
    try {
      await a.setViewportSize(vp);
      await arm(a, { ...FAST, hide: 600000, seek: 600000, maxDpr: 1, fixedScale: true });
      await h.startLive(a, 'chameleon', 'local');
      await waitReady(a);
      await selectMap(a, ID);
      await wait(600);
      await a.addStyleTag({ content: '.cushot .chm-over, .cushot .chm-top, .cushot .chm-sub, .cushot .chm-card, .cushot .chm-btn, .cushot button { visibility: hidden !important; }' });
      await a.evaluate(() => document.body.classList.add('cushot'));
      for (const [name, cam] of g) {
        await hook(a, 'lookFrom', [...cam.p, ...cam.t]);
        await wait(1000);
        const f = path.join(SHOTS, name + '.png'); await a.screenshot({ path: f }); out[name] = f;
      }
      h.assertNoErrors();
    } catch (e) { console.error(e.message, h.errors); failures++; } finally { await h.close(); }
  }
  return out;
}

/** Lay images side by side (or in a grid) with captions, into one PNG. */
async function compose(port, items, file, { cols = items.length, w = 390, title = '' } = {}) {
  const { chromium } = require(process.env.PW || path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: cols * (w + 16) + 16, height: 400 } });
  const imgs = items.map(([cap, f]) => `<figure><img src="data:image/${/\.jpe?g$/.test(f) ? 'jpeg' : 'png'};base64,${fs.readFileSync(f).toString('base64')}"><figcaption>${cap}</figcaption></figure>`).join('');
  await pg.setContent(`<style>body{margin:0;padding:8px;background:#f3efe6;font:600 15px system-ui;color:#2a2730}h1{font-size:18px;margin:4px 8px 8px}.g{display:grid;grid-template-columns:repeat(${cols},${w}px);gap:16px;padding:0 8px}figure{margin:0}img{width:${w}px;display:block;border:3px solid #2a2730;border-radius:6px}figcaption{padding:4px 2px}</style>${title ? `<h1>${title}</h1>` : ''}<div class="g">${imgs}</div>`);
  await pg.waitForTimeout(300);
  const el = await pg.$('body'); await el.screenshot({ path: file });
  await b.close();
  void port;
}

async function compareSection(port) {
  console.log('\n# compare: G1B30 against the reference photo');
  const imp = await import(pathToFileURL(path.join(__dirname, '../../../js/games/chameleon/maps/cuboulder.js')).href);
  const cam = imp.CUBOULDER.info.cams.find((c) => c.name === 'g1b30-photo');
  const v = await views(port, [['g1b30-photo-view', cam, { width: 390, height: 693 }]]);
  const ref = process.env.REF || path.join(SHOTS, '..', 'g1b30-ref.jpg');
  if (fs.existsSync(ref)) {
    await compose(port, [['Reference photo (upper back right)', ref], ['CU Boulder map, same viewpoint', v['g1b30-photo-view']]], path.join(SHOTS, 'g1b30-compare.png'), { title: 'Duane G1B30' });
    assert(true, 'g1b30-compare.png written');
  }
}

// Real positions (decimal degrees) used for the zone-bearing comparison. Gamow Tower and the
// Engineering Center are published coordinates; the quad centre, Norlin and the UMC are approximate.
const REAL = { quad: [40.0085, -105.2725], 'Norlin reading room': [40.0087, -105.2705], 'Duane G1B30': [40.0081, -105.2678], 'UMC hangout': [40.0066, -105.2717], 'Engineering lab': [40.0068, -105.2628] };
function bearingLL(a, b) {
  const r = Math.PI / 180; const [la1, lo1] = [a[0] * r, a[1] * r]; const [la2, lo2] = [b[0] * r, b[1] * r];
  const y = Math.sin(lo2 - lo1) * Math.cos(la2); const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1);
  return (Math.atan2(y, x) / r + 360) % 360;
}

async function geoSection(port) {
  console.log('\n# geo: compass views from the quad, views out of windows, a plan with a north arrow, zone bearings');
  const imp = await import(pathToFileURL(path.join(__dirname, '../../../js/games/chameleon/maps/cuboulder.js')).href);
  const E = imp.CUBOULDER; const cams = E.info.cams;
  assert(E.info.north === '-x', `compass recorded: info.north = ${E.info.north} (east = −z, west = +z)`);
  // map bearing of a point from the quad centre: north = −x, east = −z
  const room = (n) => E.info.rooms.find((r) => r.name === n);
  const ctr = (r) => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
  const q = [-6, 7.7];
  const mapBrg = ([x, z]) => (Math.atan2(-(z - q[1]), -(x - q[0])) * 180 / Math.PI + 360) % 360;
  const rows = ['Norlin reading room', 'Duane G1B30', 'UMC hangout', 'Engineering lab'].map((n) => {
    const real = bearingLL(REAL.quad, REAL[n]); const mb = mapBrg(ctr(room(n)));
    const d = Math.abs(((real - mb) + 540) % 360 - 180);
    return { n, real: +real.toFixed(0), map: +mb.toFixed(0), d: +d.toFixed(0) };
  });
  for (const r of rows) assert(r.d <= 60, `${r.n}: bearing from the quad ${r.map}° in the map vs ${r.real}° on campus (${r.d}° off)`);
  const pick = (n) => cams.find((c) => c.name === n);
  const names = ['quad-looking-N', 'quad-looking-E', 'quad-looking-S', 'quad-looking-SW', 'quad-looking-W', 'norlin-facade-window-W', 'norlin-back-window-E', 'umc-booth-window-W', 'lab-window-S', 'yard', 'top-down'];
  const v = await views(port, names.map((n) => ['dir-' + n, pick(n), { width: 640, height: 400 }]));
  const label = { 'quad-looking-N': 'Quad looking N (−x): Duane side, foothills', 'quad-looking-E': 'Quad looking E (−z): Norlin façade', 'quad-looking-S': 'Quad looking S (+x): the UMC', 'quad-looking-SW': 'Quad looking SW (221°): Flatirons + Green Mtn', 'quad-looking-W': 'Quad looking W (+z): Flagstaff, sun', 'norlin-facade-window-W': 'Norlin façade window, looking W over the quad', 'norlin-back-window-E': 'Norlin back windows (face E)', 'umc-booth-window-W': 'UMC booth window (faces W)', 'lab-window-S': 'Lab window (faces S)', yard: 'Engineering yard (SE)', 'top-down': 'Overview (fog-limited)' };
  await compose(port, names.filter((n) => v['dir-' + n]).map((n) => [label[n], v['dir-' + n]]), path.join(SHOTS, 'compass-views.png'), { cols: 3, w: 420, title: 'CU Boulder: compass views (north = −x, east = −z)' });
  // plan, north up: map −x → up, map −z (east) → right
  const S = 14; const W = E.info.w; const D = E.info.d; const pad = 230;
  const px = (x, z) => [pad + (D / 2 - z) * S, pad + (x + W / 2) * S];
  const rects = E.info.rooms.filter((r) => !r.floor).map((r) => { const [a1, b1] = px(r.x0, r.z1); const [a2, b2] = px(r.x1, r.z0); return `<rect x="${a1}" y="${b1}" width="${a2 - a1}" height="${b2 - b1}" fill="#f1e2cc" stroke="#2a2730"/><text x="${(a1 + a2) / 2}" y="${(b1 + b2) / 2}" text-anchor="middle" font-size="12">${r.name}</text>`; }).join('');
  const [ox, oy] = px(0, 0);
  const ray = (brg, L, col, txt, dy = 0) => { const a = brg * Math.PI / 180; const x2 = ox + Math.sin(a) * L; const y2 = oy - Math.cos(a) * L; return `<line x1="${ox}" y1="${oy}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-dasharray="4 3"/><text x="${x2}" y="${y2 + dy}" font-size="11" text-anchor="middle" fill="${col}">${txt}</text>`; };
  const rays = imp.PEAKS.map(([n, brg, el], i) => ray(brg, 190 + (i % 3) * 32, '#b5482f', `${n} ${brg}° (${el}°)`, 12)).join('');
  const plan = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="system-ui"><rect width="100%" height="100%" fill="#f6f2ea"/>${body}
    <g transform="translate(60,70)"><polygon points="0,-40 12,0 0,-8 -12,0" fill="#2a2730"/><text y="-46" text-anchor="middle" font-size="20" font-weight="700">N</text><text y="22" text-anchor="middle" font-size="11">map −x</text></g></svg>`;
  const svg = plan(D * S + pad * 2, W * S + pad * 2, `${rects}${rays}<circle cx="${ox}" cy="${oy}" r="4" fill="#b5482f"/>
    <text x="${D * S + pad * 2 - 20}" y="${pad + W * S / 2}" text-anchor="end" font-size="13">E (−z): plains →</text><text x="20" y="${pad + W * S / 2}" font-size="13">← W (+z): Flagstaff</text>`);
  // real vs map zone bearings from the quad
  const [qx, qy] = px(q[0], q[1]);
  const cmp = rows.map((r, i) => {
    const arr = (brg, col, dash) => { const a = brg * Math.PI / 180; return `<line x1="${qx}" y1="${qy}" x2="${qx + Math.sin(a) * 120}" y2="${qy - Math.cos(a) * 120}" stroke="${col}" stroke-width="3" ${dash ? 'stroke-dasharray="6 4"' : ''}/>`; };
    return `<g transform="translate(${(i % 2) * 300},${Math.floor(i / 2) * 300})">${arr(r.real, '#2f7a4f', false)}${arr(r.map, '#3f6fd1', true)}<circle cx="${qx}" cy="${qy}" r="5"/><text x="${qx}" y="${qy + 150}" text-anchor="middle" font-size="13" font-weight="700">${r.n}</text><text x="${qx}" y="${qy + 168}" text-anchor="middle" font-size="12">campus ${r.real}° (green) · map ${r.map}° (blue, dashed)</text></g>`;
  }).join('');
  const cmpSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="640" font-family="system-ui"><rect width="100%" height="100%" fill="#f6f2ea"/><text x="16" y="24" font-size="16" font-weight="700">Zone bearings from the quad: campus vs map (north up)</text><g transform="translate(${150 - qx},${150 - qy})">${cmp}</g><g transform="translate(560,70)"><polygon points="0,-30 9,0 0,-6 -9,0" fill="#2a2730"/><text y="-34" text-anchor="middle" font-size="15" font-weight="700">N</text></g></svg>`;
  const { chromium } = require(process.env.PW || path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
  const br = await chromium.launch();
  for (const [svgS, file, w, h] of [[svg, 'plan-north-arrow.png', D * S + pad * 2, W * S + pad * 2], [cmpSvg, 'zone-bearings.png', 600, 640]]) {
    const pg = await br.newPage({ viewport: { width: w, height: h } }); await pg.setContent(svgS); await pg.screenshot({ path: path.join(SHOTS, file) }); await pg.close();
  }
  await br.close();
  assert(true, 'compass-views.png, plan-north-arrow.png and zone-bearings.png written');
}

(async () => {
  try {
    if (want('geo')) await geoSection(PORT + 1);
    if (want('compare')) await compareSection(PORT);
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
