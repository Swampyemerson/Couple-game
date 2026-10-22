// Blend & Seek — chameleon sizes: Micro / Tiny / Petite, and "By map".
//   node tools/test/games/chameleon-sizes.test.js                     (all sections)
//   ONLY=rules | bymap | lobby | play | mix   PORT=9200 (uses PORT..PORT+4; keep within 9200–9209)
//   SHOTS=dir (default: $TMPDIR/chameleon-sizes-shots)
//
// rules   Node: the size list, the By map tables, the saved-setup migration, sanitising, JSON round trip.
// bymap   two phones: every map x every preset resolves to the table's size on BOTH devices (body scale,
//         collider, tag tolerance), and an explicit size beats the table.
// lobby   the size picker: 8 chips (By map + 7 sizes), each >= 44 px, inside the viewport at 375x667 and
//         844x390, "By map" names what it means on the selected map; light + dark screenshots.
// play    one phone (hotseat): Micro and Tiny spawn, walk into walls, stick, crawl up a wall and down,
//         squeeze, on the Living Room and the House; two phones: both draw the partner at the same scale.
// mix     Mix it up: By map follows the CURRENT round's map on both phones.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { launch } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'chameleon-sizes-shots');
const PORT = Number(process.env.PORT) || 9200;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
let failures = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });

const FAST = { hide: 12000, seek: 15000, title: 500, recap: 2500, found: 2200, final: 3000, seekLead: 700, resume: 1500, maxDpr: 0.5, noTips: true };
const SLOW = { ...FAST, hide: 90000, seek: 60000, maxDpr: 0.45 };
const arm = (p, t = FAST) => p.evaluate((x) => { window.__chamTest = true; window.__chamTune = x; }, t);
const st = (p) => p.evaluate(() => window.__cham && window.__cham.state());
const hook = (p, fn, ...args) => p.evaluate(([f, a]) => window.__cham[f](...a), [fn, args]);
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, name + '.png') });
const waitReady = (p) => p.waitForFunction(() => window.__cham && window.__cham.ready, null, { timeout: 40000 });
const waitLinked = (p) => p.waitForFunction(() => window.__cham && window.__cham.ready && window.__cham.state().linkReady, null, { timeout: 40000 });
const waitPhase = (p, name, timeout = 30000) => p.waitForFunction((n) => window.__cham && window.__cham.state().phase.name === n, name, { timeout });
async function startPair(h, tune = SLOW) {
  const { a, b } = h;
  for (const p of [a, b]) await arm(p, tune);
  await h.startLive(a, 'chameleon', 'live');
  await h.settle();
  await b.click('#gm-invite [data-g="invite-yes"]');
  await waitLinked(a); await waitLinked(b);
  await wait(600);
}

/** rules.js is an ES module without imports: copy it to a .mjs and import that. */
async function loadRules() {
  const src = fs.readFileSync(path.join(__dirname, '../../../js/games/chameleon/rules.js'), 'utf8');
  const f = path.join(os.tmpdir(), `chameleon-rules-${process.pid}.mjs`);
  fs.writeFileSync(f, src);
  try { return await import(require('url').pathToFileURL(f).href); } finally { try { fs.unlinkSync(f); } catch { /* ignore */ } }
}
// the map ids + size classes of this build (maps.js can't load in Node: it needs the canvas), from the running game
const mapsOf = (p) => p.evaluate(() => window.__cham.mapsInfo());

// ─────────────────────────────────────────────────────────────────────
async function rulesSection() {
  console.log('\n# rules (Node): sizes, By map tables, migration of old saved setups');
  const R = await loadRules();
  const ids = R.SIZES.map((x) => x.id); const sc = R.SIZES.map((x) => x.s);
  assert(JSON.stringify(ids) === JSON.stringify(['micro', 'mini', 'tiny', 'small', 'medium', 'large', 'huge']), `sizes, smallest first: ${ids.join(' < ')}`);
  assert(sc.every((s, i) => i === 0 || s > sc[i - 1]), `scales rise: ${sc.join(', ')}`);
  assert(R.sizeScale('tiny') === 0.6 && R.sizeScale('small') === 0.8 && R.sizeScale('medium') === 1 && R.sizeScale('large') === 1.3 && R.sizeScale('huge') === 1.8, "the saved ids keep their scales ('tiny' is still 0.6)");
  assert(R.sizeScale('micro') === 0.32 && R.sizeScale('mini') === 0.45, 'micro 0.32, mini 0.45');
  const lab = (id) => R.fmtRule('size', id);
  assert(lab('micro') === 'Micro' && lab('mini') === 'Tiny' && lab('tiny') === 'Petite' && lab('auto') === 'By map' && lab('huge') === 'Huge', `labels: ${['auto', ...ids].map(lab).join(' / ')}`);
  assert(R.OPTIONS.size[0] === 'auto' && R.OPTIONS.size.length === 8, 'By map + seven sizes are the allowed values');
  assert(R.PRESET_IDS.every((p) => R.PRESETS[p].size === 'auto'), 'Easy, Classic and Hard all use By map');
  for (const p of R.PRESET_IDS) assert(R.applyPreset(p).preset === p, `${p}: applyPreset still reads back as ${p}`);
  assert(R.sizeScale('gigantic') === 1.3 && R.sanitizeRules({ size: 'gigantic' }).size === 'auto', 'unknown ids sanitise to the Classic value (By map)');
  assert(R.sanitizeRules({ size: 'micro' }).size === 'micro' && R.sanitizeRules({ size: 'mini' }).size === 'mini' && R.sanitizeRules({ size: 'tiny' }).size === 'tiny', 'the new ids survive sanitising');
  // JSON round trip, as the setup message / the saved setup travel
  const back = R.sanitizeSetup(JSON.parse(JSON.stringify(R.sanitizeSetup({ mode: 'hs', map: 'living', rules: { ...R.PRESETS.hard } }, ['living']))), ['living']);
  assert(back.rules.size === 'auto' && back.rules.preset === 'hard', 'By map + the preset survive the setup message (re-sanitised on the guest)');
  assert(R.sanitizeRules(JSON.parse(JSON.stringify(R.sanitizeRules({ ...R.PRESETS.classic, size: 'micro' })))).size === 'micro', 'micro survives the round trip');
  // the tables
  const maps = [['living', 'S'], ['garden', 'S'], ['studio', 'S'], ['candy', 'S'], ['greenhouse', 'M'], ['launderette', 'M'], ['market', 'L'], ['house', 'L'], ['museum', 'L'], ['cuboulder', 'XL']];
  const at = (rules, id, cls) => R.resolveSize(rules, { id, size: cls });
  const E = R.applyPreset('easy'); const C = R.applyPreset('classic'); const H = R.applyPreset('hard');
  for (const [id, cls] of maps) {
    const e = R.sizeScale(at(E, id, cls)); const c = R.sizeScale(at(C, id, cls)); const hd = R.sizeScale(at(H, id, cls));
    assert(hd < c && c < e, `${id}: Hard ${at(H, id, cls)} (${hd}) < Classic ${at(C, id, cls)} (${c}) < Easy ${at(E, id, cls)} (${e})`);
  }
  for (const [id, cls] of maps.filter((m) => m[1] === 'S')) assert(R.sizeScale(at(C, id, cls)) <= 0.6 && R.sizeScale(at(H, id, cls)) <= 0.45, `${id}: the small rooms get a small body in Classic (<= 0.6) and a smaller one in Hard (<= 0.45)`);
  // the class fallback: a map the table has never heard of
  for (const cls of ['S', 'M', 'L', 'XL']) assert(['tiny', 'small', 'medium', 'large'].includes(at(C, 'newmap', cls)) && R.resolveSize(C, { id: 'newmap', size: cls }) === R.SIZE_TABLES.classic.cls[cls], `unknown map of class ${cls} → ${at(C, 'newmap', cls)} (class fallback)`);
  assert(R.resolveSize(C, null) === R.SIZE_TABLES.classic.cls.M && R.resolveSize(C, {}) === R.SIZE_TABLES.classic.cls.M, 'no map entry → the M row (never undefined)');
  // custom (a changed rule) uses Classic's table; an explicit size is itself
  const custom = R.sanitizeRules({ ...R.PRESETS.hard, pellets: 4 });
  assert(custom.preset === 'custom' && at(custom, 'living', 'S') === at(C, 'living', 'S'), 'a Custom setup uses the Classic table');
  assert(R.resolveSize({ ...C, size: 'micro' }, { id: 'house', size: 'L' }) === 'micro' && R.resolveSize({ ...E, size: 'huge' }, { id: 'living', size: 'S' }) === 'huge', 'an explicit size ignores the map');
  assert(R.resolveSize({ ...C, size: 'bogus' }, { id: 'house', size: 'L' }) === 'large', 'a bogus size resolves to Large (the old fallback), never undefined');
  assert(R.resolveSize({ ...H, preset: undefined }, { id: 'living', size: 'S' }) === 'mini', 'rules without a preset field work out which preset they are');
  // hotseat: rulesFor() keeps the preset, so the same table
  assert(R.resolveSize(R.rulesFor(H, true), { id: 'living', size: 'S' }) === 'mini', 'hotseat rules (rulesFor) resolve with the same preset table');
  // ── migration of saved setups ──
  const store = {}; globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const put = (o) => { store['chm.setup.v2'] = JSON.stringify(o); };
  for (const [id, old] of [['classic', 'large'], ['easy', 'huge'], ['hard', 'medium']]) {
    put({ mode: 'hs', map: 'house', rules: { ...R.PRESETS[id], size: old }, mix: false });
    const r = R.sanitizeSetup(R.loadSaved(), ['living', 'house']).rules;
    assert(r.size === 'auto' && r.preset === id, `an old ${id} setup (size ${old}) loads as ${id} with By map, not Custom`);
  }
  put({ mode: 'hs', map: 'living', rules: { ...R.PRESETS.classic, size: 'small' }, mix: false });
  let r = R.sanitizeSetup(R.loadSaved(), ['living']).rules;
  assert(r.size === 'small' && r.preset === 'custom', 'an old explicit custom size (small) stays as it was');
  put({ mode: 'hs', map: 'living', rules: { ...R.PRESETS.classic, size: 'large', pellets: 4 }, mix: false });
  r = R.sanitizeSetup(R.loadSaved(), ['living']).rules;
  assert(r.size === 'large' && r.preset === 'custom', 'an old Large with another changed rule stays Large (Custom)');
  put({ mode: 'hs', map: 'living', rules: { ...R.PRESETS.classic, size: 'tiny' }, mix: true });
  r = R.sanitizeSetup(R.loadSaved(), ['living']).rules;
  assert(r.size === 'tiny' && R.sizeScale(r.size) === 0.6, "an old 'tiny' still means 0.6");
  put({ mode: 'hs', map: 'living', rules: { ...R.PRESETS.classic, size: 'gigantic' } });
  assert(R.sanitizeSetup(R.loadSaved(), ['living']).rules.size === 'auto', 'an unknown saved id sanitises to the Classic value');
  put({ mode: 'hs', map: 'living', rules: { ...R.PRESETS.classic, size: 'large' }, sz: 1 });
  assert(R.sanitizeSetup(R.loadSaved(), ['living']).rules.size === 'large', "a setup saved by this build (sz: 1) with an explicit Large stays Large (it isn't the old Classic)");
  R.saveSetup({ mode: 'hs', map: 'living', rules: R.sanitizeRules({ ...R.PRESETS.classic, size: 'large' }), mix: false });
  assert(R.sanitizeSetup(R.loadSaved(), ['living']).rules.size === 'large', 'saveSetup → loadSaved keeps an explicit Large');
  store['chm.setup.v2'] = '{not json'; assert(R.loadSaved() === null, 'a broken saved setup is ignored');
  delete globalThis.localStorage;
}

// ─────────────────────────────────────────────────────────────────────
async function byMapSection(port) {
  console.log('\n# by map: every map x preset resolves to the table size on both phones');
  const R = await loadRules();
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, SLOW);
    const maps = await mapsOf(a);
    console.log('  maps: ' + maps.map((m) => `${m.id}:${m.size}:${m.area}`).join(' '));
    for (const m of maps) {
      for (const preset of R.PRESET_IDS) {
        await hook(a, 'setRules', { map: m.id, rules: { ...R.PRESETS[preset] } });
        await b.waitForFunction(([id, pr]) => { const s = window.__cham.state(); return s.mapId === id && s.setup.map === id && s.setup.rules.preset === pr; }, [m.id, preset], { timeout: 40000 });
        await wait(120);
        const rules = (await st(a)).setup.rules;
        const id = R.resolveSize(rules, m); const s = R.sizeScale(id);
        const za = await hook(a, 'sizes'); const zb = await hook(b, 'sizes');
        const okAll = [za, zb].every((z) => ['a', 'b'].every((w) => Math.abs(z[w].s - s) < 1e-9 && Math.abs(z[w].scale - s) < 1e-9 && Math.abs(z[w].r - 0.24 * s) < 1e-9));
        assert(okAll && Math.abs(za.tagTol - 0.75 * Math.max(1, s)) < 1e-9, `${m.id} / ${preset}: ${id} (${s}) on both phones, hit tolerance ${za.tagTol.toFixed(2)} m`);
        assert(rules.size === 'auto' && (await st(b)).setup.rules.size === 'auto', 'and the setting is still By map on both');
      }
    }
    // an explicit size wins over the table, and 'tiny' is still 0.6
    await hook(a, 'setRules', { map: 'living', rules: { ...R.PRESETS.classic, size: 'tiny' } });
    await b.waitForFunction(() => window.__cham.state().setup.rules.size === 'tiny', null, { timeout: 8000 });
    assert((await hook(b, 'sizes')).a.s === 0.6 && (await hook(a, 'sizes')).b.s === 0.6, "'tiny' is 0.6 on both phones");
    await hook(a, 'setRules', { map: 'house', rules: { ...R.PRESETS.classic, size: 'micro' } });
    await b.waitForFunction(() => window.__cham.state().setup.rules.size === 'micro' && window.__cham.state().mapId === 'house', null, { timeout: 40000 });
    assert((await hook(b, 'sizes')).a.s === 0.32, 'Micro stays 0.32 on the House (an explicit size ignores the map)');
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); failures++; await shot(a, 'bymap-FAIL-a').catch(() => {}); } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
async function chipGeom(p, root) {
  return p.evaluate((sel) => {
    const g = document.querySelector(sel + ' .chm-sizes'); if (!g) return null;
    const vw = document.documentElement.clientWidth;
    const cells = [...g.querySelectorAll('button')].map((e) => { const r = e.getBoundingClientRect(); return { v: e.dataset.v, w: Math.round(r.width), h: Math.round(r.height), l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), text: e.textContent.trim().replace(/\s+/g, ' '), on: e.classList.contains('on'), checked: e.getAttribute('aria-checked') }; });
    return { vw, cells, over: g.scrollWidth - g.clientWidth, gl: Math.round(g.getBoundingClientRect().left), gr: Math.round(g.getBoundingClientRect().right), rows: new Set(cells.map((c) => c.t)).size };
  }, root);
}

async function lobbySection(port, scheme) {
  console.log(`\n# lobby (${scheme}): the size picker fits, 44 px chips, By map says what it means`);
  const R = await loadRules();
  const h = await launch({ port, only: ['chameleon'], colorScheme: scheme });
  const { a, b } = h;
  try {
    await startPair(h, SLOW);
    for (const [vw, vh, tag] of [[375, 667, 'portrait'], [360, 740, 'narrow'], [430, 760, 'big'], [844, 390, 'landscape']]) {
      for (const p of [a, b]) await p.setViewportSize({ width: vw, height: vh });
      await wait(500);
      const g = await chipGeom(a, '.chm-lobby');
      assert(g && g.cells.length === 8 && g.cells.map((c) => c.v).join() === 'auto,micro,mini,tiny,small,medium,large,huge', `${tag} ${vw}x${vh}: By map + the seven sizes, smallest first`);
      const bad = g.cells.filter((c) => c.w < 44 || c.h < 44 || c.l < 0 || c.r > g.vw);
      assert(!bad.length && g.over <= 0, `${tag} ${vw}x${vh}: every chip >= 44 x 44 px and inside the screen (${g.rows} rows, narrowest ${Math.min(...g.cells.map((c) => c.w))} px${bad.length ? ', BAD ' + JSON.stringify(bad) : ''})`);
      assert(g.cells.filter((c) => c.checked === 'true').length === 1 && g.cells[0].on, `${tag}: exactly one chip is selected (By map)`);
      // text not clipped: each chip's content fits its box
      const clip = await a.$$eval('.chm-lobby .chm-sizes button', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.dataset.v));
      assert(!clip.length, `${tag}: no chip label is clipped${clip.length ? ' ' + clip : ''}`);
      await shot(a, `sizes-lobby-${scheme}-${tag}`);
    }
    for (const p of [a, b]) await p.setViewportSize({ width: 375, height: 667 });
    await wait(300);
    // By map names the size on the selected map, per preset
    const maps = await mapsOf(a);
    const label = (rules, id) => R.fmtRule('size', R.resolveSize(rules, maps.find((m) => m.id === id)));
    for (const [map, preset] of [['living', 'classic'], ['living', 'hard'], ['living', 'easy'], ['house', 'classic'], ['cuboulder', 'hard']]) {
      await hook(a, 'setRules', { map, rules: { ...R.PRESETS[preset] } });
      await b.waitForFunction((m) => window.__cham.state().mapId === m, map, { timeout: 40000 });
      await wait(250);
      const want1 = label((await st(a)).setup.rules, map);
      for (const [p, who] of [[a, 'host'], [b, 'guest']]) {
        const t = await p.$eval('.chm-lobby .chm-sizes button[data-v="auto"]', (e) => e.innerText.trim().replace(/\s+/g, ' '));
        assert(t.toLowerCase() === `by map ${want1}`.toLowerCase(), `${map} / ${preset} (${who}): the chip reads "By map ${want1}" (${t})`);
      }
    }
    // pick sizes with a tap; the guest follows and sees the chip selected
    await a.click('.chm-lobby .chm-sizes [data-v="micro"]');
    await b.waitForFunction(() => window.__cham.state().setup.rules.size === 'micro', null, { timeout: 5000 });
    assert(await b.$eval('.chm-lobby .chm-sizes [data-v="micro"]', (e) => e.classList.contains('on')), 'the guest sees Micro selected');
    assert((await st(b)).setup.rules.preset === 'custom', 'a fixed size is a Custom setup');
    assert((await hook(b, 'sizes')).b.s === 0.32 && (await hook(a, 'sizes')).a.s === 0.32, 'both phones scale to 0.32');
    await a.click('.chm-lobby .chm-sizes [data-v="tiny"]');
    await b.waitForFunction(() => window.__cham.state().setup.rules.size === 'tiny', null, { timeout: 5000 });
    assert((await hook(b, 'sizes')).a.s === 0.6, 'Petite (id tiny) is 0.6');
    await shot(a, `sizes-lobby-${scheme}-petite`);
    await a.click('.chm-lobby .chm-presets [data-v="classic"]');
    await b.waitForFunction(() => window.__cham.state().setup.rules.preset === 'classic' && window.__cham.state().setup.rules.size === 'auto', null, { timeout: 5000 });
    assert(await a.$eval('.chm-lobby .chm-sizes [data-v="auto"]', (e) => e.classList.contains('on')), 'tapping Classic puts By map back');
    // the settings sheet: same picker, host and guest
    for (const [p, who] of [[a, 'host'], [b, 'guest']]) {
      await p.click('.chm-lobby [data-act="settings"]');
      await p.waitForSelector('.chm-sheet', { timeout: 4000 });
      await wait(250);
      const g = await chipGeom(p, '.chm-sheet');
      const bad = g.cells.filter((c) => c.w < 44 || c.h < 44 || c.l < 0 || c.r > g.vw);
      assert(g.cells.length === 8 && !bad.length && g.over <= 0, `settings sheet (${who}): 8 chips, each >= 44 x 44 px, inside the screen (narrowest ${Math.min(...g.cells.map((c) => c.w))} px)`);
      await p.evaluate(() => { const s = document.querySelector('.chm-sheet .chm-sizes'); s.scrollIntoView({ block: 'center' }); });
      await wait(200);
      if (who === 'host') await shot(p, `sizes-sheet-${scheme}`);
      await p.click('.chm-sheet .chm-done');
    }
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); failures++; await shot(a, `lobby-${scheme}-FAIL-a`).catch(() => {}); } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
const fin = (...v) => v.every((x) => Number.isFinite(x));
async function playSection(port) {
  console.log('\n# play: Micro and Tiny spawn, walk, stick, crawl and squeeze (hotseat), partner draw scale (two phones)');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await arm(a, SLOW);
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    for (const map of ['living', 'house']) {
      await hook(a, 'setRules', { map, first: 'b' });
      await wait(400);
      await a.click('[data-act="start"]');
      await a.click('[data-act="curtain"]');
      await waitPhase(a, 'hide');
      await wait(300);
      const sp = await hook(a, 'spots');
      for (const size of ['micro', 'mini']) {
        const s = await hook(a, 'forceSize', size);
        await wait(150);
        const z = await hook(a, 'sizes');
        assert(Math.abs(z.b.scale - s) < 1e-9 && Math.abs(z.b.r - 0.24 * s) < 1e-9 && Math.abs(z.b.head - 0.34 * s) < 1e-9, `${map} / ${size}: scale ${s}, radius ${z.b.r.toFixed(3)} m, head ${z.b.head.toFixed(3)} m, step ${z.b.step.toFixed(2)} m`);
        // spawn: standing on the floor, inside the map, not buried
        const sx = (sp.spawnB || sp.camo || { x: 0, z: 0 });
        await hook(a, 'teleport', sx.x, sx.z, 0, sx.y || 0);
        let r = await hook(a, 'walk', 0, 0, 20);
        assert(fin(r.x, r.y, r.z) && Math.abs(r.y - (sx.y || 0)) < 0.35, `${map} / ${size}: spawns on its feet (y ${r.y.toFixed(2)})`);
        // walk in every direction for 4 s: never NaN, never past the walls
        const b0 = (await hook(a, 'body'));
        let worst = 0;
        for (let k = 0; k < 8; k++) {
          const an = k * Math.PI / 4;
          const q = await hook(a, 'walk', Math.sin(an) * 2.2, Math.cos(an) * 2.2, 120);
          if (!fin(q.x, q.y, q.z)) worst = Infinity;
          worst = Math.max(worst, Math.abs(q.x), Math.abs(q.z));
        }
        const bounds = (await hook(a, 'worldStats')).bounds;
        void b0; void bounds;
        assert(Number.isFinite(worst) && worst < 60, `${map} / ${size}: eight 4 s walks stay finite and inside the map (|max| ${worst.toFixed(1)} m)`);
        if (map === 'living') {
          // into the west wall: stops one radius short of it
          await hook(a, 'teleport', -3, 1, -Math.PI / 2, 0);
          r = await hook(a, 'walk', -1.6, 0, 120);
          assert(Math.abs(r.x - (-5 + 0.24 * z.b.s)) < 0.12 && Math.abs(r.y) < 0.05, `living / ${size}: stops at the wall (x ${r.x.toFixed(3)}, radius ${(0.24 * z.b.s).toFixed(3)})`);
          // sticky feet: grab the wall, crawl up, onto the rafter, and back down to the floor
          await hook(a, 'teleport', -3, 2.35, -Math.PI / 2, 0);
          await hook(a, 'walk', -1.6, 0, 120); // (the stick grabs what the body is facing and touching)
          const sk = await hook(a, 'stick');
          assert(sk.at && sk.n[0] > 0.9, `living / ${size}: Stick grabs the wall (normal ${sk.n.map((x) => x.toFixed(2))})`);
          await hook(a, 'crawl', 0, 1.5, 0, 90);
          let bb = await hook(a, 'body');
          assert(bb.at && fin(bb.x, bb.y, bb.z) && (bb.y > 1 || bb.ny < -0.9), `living / ${size}: crawls up the wall (y ${bb.y.toFixed(2)}, normal ${[bb.nx, bb.ny, bb.nz].map((x) => x.toFixed(2))})`);
          await hook(a, 'crawl', 0, 1.5, 0, 60);
          bb = await hook(a, 'body');
          assert(bb.at && bb.ny < -0.9 && bb.y > 2.3, `living / ${size}: over the top onto the rafter's underside (y ${bb.y.toFixed(2)})`);
          await hook(a, 'crawl', -1.4, 0, 0, 40);
          await hook(a, 'crawl', 0, -1.4, 0, 120);
          bb = await hook(a, 'body');
          assert(!bb.at && bb.onGround && bb.y < 0.06, `living / ${size}: back down the wall onto the floor (y ${bb.y.toFixed(2)})`);
          await hook(a, 'setCam', Math.PI / 2, 0.3, 2.3); await wait(900);
          if (size === 'micro') await shot(a, 'sizes-play-micro-living');
        } else {
          // the House bed leaves 0.26 m: Micro (head 0.11) and Tiny (0.15) walk under it standing up; squeeze works at any size
          const FH = 2.8; const bx = -5.4; const footZ = -3.43;
          await hook(a, 'teleport', bx, footZ + 0.75, Math.PI, FH);
          r = await hook(a, 'walk', 0, -1.2, 40);
          assert(r.z < footZ - 0.4, `house / ${size}: walks upright under the bed (z ${r.z.toFixed(2)})`);
          await hook(a, 'teleport', bx, footZ + 0.75, Math.PI, FH);
          assert(await hook(a, 'setPose', 'squeeze') === 'squeeze', `house / ${size}: squeeze pose`);
          r = await hook(a, 'walk', 0, -1.2, 120);
          assert(r.z < footZ - 0.6 && Math.abs(r.y - FH) < 0.01, `house / ${size}: squeeze-crawls under the bed (z ${r.z.toFixed(2)}, y ${r.y.toFixed(2)})`);
          await hook(a, 'setPose', 'stand');
        }
        await hook(a, 'setPose', 'stand');
      }
      // quit the round: back to a fresh lobby
      await h.closeGame(a); await wait(500);
      await arm(a, SLOW); await h.startLive(a, 'chameleon', 'local'); await waitReady(a);
    }
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); failures++; await shot(a, 'play-FAIL').catch(() => {}); } finally { await h.close(); }

  // two phones: the partner is drawn at the same (Micro) scale on both, and the camera never swallows the body
  const h2 = await launch({ port: port + 1, only: ['chameleon'] });
  try {
    const { a: a2, b: b2 } = h2;
    await startPair(h2, SLOW);
    await hook(a2, 'setRules', { map: 'living', first: 'b', rules: { size: 'micro' } });
    await b2.waitForFunction(() => window.__cham.state().setup.rules.size === 'micro' && window.__cham.state().setup.first === 'b', null, { timeout: 8000 });
    await a2.click('[data-act="start"]');
    await waitPhase(b2, 'hide', 20000); await waitPhase(a2, 'hide', 20000);
    await wait(500);
    await hook(b2, 'teleport', 0.5, 0.5, 0.6, 0);
    await wait(600);
    const sa = await st(a2); const sb = await st(b2);
    assert(Math.abs(sa.drawn.b.scale - 0.32) < 1e-6 && Math.abs(sb.drawn.b.scale - 0.32) < 1e-6 && Math.abs(sa.drawn.a.scale - 0.32) < 1e-6, 'both phones draw both chameleons at scale 0.32');
    const cam = await hook(b2, 'camDist');
    assert(cam > 0.34 && cam < 2.5, `the third-person camera stands ${cam.toFixed(2)} m behind a Micro hider (never inside it, not far off)`);
    await shot(b2, 'sizes-play-micro-hider-view');
    await b2.click('.chm-acts [data-act="ready"]');
    await waitPhase(a2, 'seek', 20000); await waitPhase(b2, 'seek', 5000);
    await wait(500);
    await hook(a2, 'teleport', -1.5, -0.5, 0, 0);
    const bc = await hook(a2, 'bodyCenter', 'b');
    await hook(a2, 'aimAt', ...bc);
    await wait(500);
    await shot(a2, 'sizes-play-micro-seeker-view');
    h2.assertNoErrors();
  } catch (e) { console.error(e.message, h2.errors); failures++; } finally { await h2.close(); }
}

// ─────────────────────────────────────────────────────────────────────
async function mixSection(port) {
  console.log('\n# mix it up: By map follows the current round\'s map on both phones');
  const R = await loadRules();
  const T = { hide: 3000, seek: 2500, title: 300, recap: 1200, found: 1000, final: 2000, seekLead: 300, resume: 1000, maxDpr: 0.4, noTips: true };
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, T);
    const maps = await mapsOf(a);
    await hook(a, 'setRules', { map: 'house', first: 'b', mix: true, rules: { ...R.PRESETS.classic, rounds: 4, headStart: 0, twists: 'off', grace: 0 } });
    await b.waitForFunction(() => window.__cham.state().mapId === 'house' && window.__cham.state().setup.mix === true, null, { timeout: 40000 });
    await a.click('[data-act="start"]');
    const seen = [];
    for (const r of [1, 2, 3]) {
      for (const p of [a, b]) await p.waitForFunction((n) => { const s = window.__cham.state(); return s.phase.round === n && (s.phase.name === 'hide' || s.phase.name === 'seek'); }, r, { timeout: 90000 });
      await wait(400);
      const sa = await st(a); const sb = await st(b);
      const m = maps.find((x) => x.id === sa.match.map);
      const want1 = R.sizeScale(R.resolveSize(sa.match.rules, m));
      const za = await hook(a, 'sizes'); const zb = await hook(b, 'sizes');
      const ok = [za, zb].every((z) => ['a', 'b'].every((w) => Math.abs(z[w].scale - want1) < 1e-9));
      assert(sb.match.map === sa.match.map && ok, `round ${r}: map ${sa.match.map} (${m.size}) → ${want1} on both phones (${za.a.scale}, ${zb.b.scale})`);
      seen.push(`${sa.match.map}:${want1}`);
    }
    console.log('  rounds: ' + seen.join(' → '));
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); failures++; await shot(a, 'mix-FAIL-a').catch(() => {}); } finally { await h.close(); }
}

(async () => {
  const sections = [];
  if (want('rules')) sections.push(() => rulesSection());
  if (want('bymap')) sections.push(() => byMapSection(PORT + 0));
  if (want('lobby')) { sections.push(() => lobbySection(PORT + 1, 'light')); sections.push(() => lobbySection(PORT + 2, 'dark')); }
  if (want('play')) sections.push(() => playSection(PORT + 3));
  if (want('mix')) sections.push(() => mixSection(PORT + 5));
  for (const run of sections) {
    try { await run(); } catch (e) { console.error(e); failures++; }
  }
  console.log(`screenshots: ${SHOTS}`);
  if (failures) { console.error(`\n${failures} section(s) failed`); process.exitCode = 1; } else console.log('\nALL GOOD');
})();
