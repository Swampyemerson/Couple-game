// Blend & Seek: paint panel round 2 (builder P) — recent colours, pattern fill, the palette lock
// (Three colours twist), the camo meter's stale state, pose-bar labels.
//   node tools/test/games/chameleon-paint2.test.js
//   ONLY=chips,pattern,lock,sync,meter,poses PORT=9640 node tools/test/games/chameleon-paint2.test.js   (PORT..PORT+5)
//   SHOTS=/some/dir   where screenshots go
const path = require('path');
const fs = require('fs');
const os = require('os');
const { launch } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'chameleon-paint2-shots');
const PORT = Number(process.env.PORT) || 9640;
fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
let failures = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FAST = { hide: 12000, seek: 15000, title: 700, recap: 2500, found: 2200, final: 3000, seekLead: 900, resume: 1500, maxDpr: 0.6, noTips: true };
const SLOW = { ...FAST, hide: 300000, seek: 60000, maxDpr: 0.45 };
const arm = (p, tune = SLOW) => p.evaluate((t) => { window.__chamTest = true; window.__chamTune = t; }, tune);
const hook = (p, fn, ...args) => p.evaluate(([f, a]) => window.__cham[f](...a), [fn, args]);
const st = (p) => p.evaluate(() => window.__cham.state());
const waitReady = (p) => p.waitForFunction(() => window.__cham && window.__cham.ready, null, { timeout: 40000 });
const waitPhase = (p, name, timeout = 30000) => p.waitForFunction((n) => window.__cham && window.__cham.state().phase.name === n, name, { timeout });
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, name + '.png') });
const ui = (p) => hook(p, 'paintUi');
const settled = (p, w = 'b') => p.waitForFunction((x) => !window.__cham.reveal(null, x).on, w, { timeout: 8000 });
const settleMeter = (p) => p.waitForFunction(() => { const k = window.__cham.camo(); return k.shown && !k.busy && k.score >= 0 && k.meter.text === `${k.score}%`; }, null, { timeout: 15000 });
const rects = (p, sels) => p.evaluate((ss) => ss.map((s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.offsetParent && getComputedStyle(e).position !== 'fixed') return null; const r = e.getBoundingClientRect(); return r.width ? [r.left, r.top, r.right, r.bottom] : null; }), sels);
const overlap = (a, b) => !!a && !!b && a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5;
const hexOf = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

async function tapBody(p, id = 61) {
  const [x, y] = await hook(p, 'bodyPoint', 0);
  await p.evaluate(([cx, cy, pid]) => {
    const el = document.elementFromPoint(cx, cy);
    const mk = (type) => new PointerEvent(type, { pointerId: pid, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, cancelable: true, isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 });
    el.dispatchEvent(mk('pointerdown')); setTimeout(() => el.dispatchEvent(mk('pointerup')), 60);
  }, [x, y, id]);
}
/** Tap the body until the skin changes (a tap can land a texel off the body while it breathes): returns the tries. */
async function fillTap(p, id = 61) {
  const h0 = await hook(p, 'paintHash', 'b');
  for (let k = 1; k <= 4; k++) {
    await tapBody(p, id + k);
    await wait(250);
    if (await hook(p, 'paintHash', 'b') !== h0) return k;
    await faceBody(p);
  }
  throw new Error('FAIL: the fill tap never landed on the body');
}
async function strokeOnBody(p) {
  const [x, y] = await hook(p, 'bodyPoint', 0);
  await p.evaluate(async ([cx, cy]) => {
    const el = document.elementFromPoint(cx, cy);
    const mk = (type, xx, yy) => new PointerEvent(type, { pointerId: 21, pointerType: 'touch', clientX: xx, clientY: yy, bubbles: true, cancelable: true, isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 });
    el.dispatchEvent(mk('pointerdown', cx - 18, cy));
    for (let i = 1; i <= 8; i++) { await new Promise((r) => setTimeout(r, 25)); el.dispatchEvent(mk('pointermove', cx - 18 + i * 5, cy + (i % 2) * 3)); }
    el.dispatchEvent(mk('pointerup', cx + 22, cy));
  }, [x, y]);
}
/** Hotseat (one iPhone): the hider (Sydney) flat on the Living Room wall; the paint panel is NOT open yet. */
async function hotseatHide(port, { colorScheme = 'light', viewport = null } = {}) {
  const h = await launch({ port, only: ['chameleon'], who: ['a'], device: 'iPhone 13', colorScheme });
  const a = h.a;
  if (viewport) await a.setViewportSize(viewport);
  await arm(a);
  await h.startLive(a, 'chameleon', 'local');
  await waitReady(a);
  await hook(a, 'setRules', { map: 'living', first: 'b', rules: { size: 'large', blendBonus: 10 } });
  await a.tap('[data-act="start"]');
  await a.tap('[data-act="curtain"]');
  await waitPhase(a, 'hide');
  await wait(400);
  const s = (await hook(a, 'spots')).camo;
  await hook(a, 'teleport', s.x, s.z - 0.1, 0, s.y);
  await wait(150);
  await hook(a, 'setPose', 'wall');
  return h;
}
async function openPaint(a) { await a.tap('.chm-acts [data-act="paint"]'); await a.waitForFunction(() => { const t = document.querySelector('.chm-tools'); return t && !t.hidden; }, null, { timeout: 8000 }); await wait(500); }
/** Face the body square-on so a tap on bodyPoint lands on it. */
async function faceBody(a) { const ctr = await hook(a, 'bodyCenter', 'b'); const bb = await hook(a, 'body', 'b'); await hook(a, 'paintCamAt', ctr[0], ctr[1], ctr[2], bb.nx, bb.ny, bb.nz, 1.2); await wait(500); }
const frames = (a, n = 3) => a.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);

// ─────────────────────────────────────────────────────────────────────
async function chipsSection(port) {
  console.log('\n# recent colours: 5 distinct chips (>= 44 px), tap = brush colour, a real Pick lands in the strip, layout in both orientations, light + dark');
  for (const [scheme, vp, tag] of [['light', null, 'port-light'], ['dark', { width: 844, height: 390 }, 'land-dark']]) {
    const h = await hotseatHide(port, { colorScheme: scheme, viewport: vp });
    const a = h.a;
    try {
      await openPaint(a);
      const chips = await a.evaluate(() => [...document.querySelectorAll('.chm-pal .chm-rc')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), b.hidden, b.className]; }));
      assert(chips.length === 6 && chips.every((c) => c[0] >= 44 && c[1] >= 44), `[${tag}] five colour chips + the pattern chip are all >= 44 x 44 (${chips.map((c) => c[0] + 'x' + c[1]).join(' ')})`);
      let u = await ui(a);
      assert(u.recent.length === 1 && u.pattern === 'solid', `[${tag}] the strip starts with the brush colour (${u.recent.length}), the pattern is Solid`);
      // six colours through the brush: the strip keeps the newest five, no duplicates
      const cols = [[200, 40, 40], [40, 160, 60], [40, 70, 200], [230, 200, 30], [150, 60, 180], [20, 20, 20]];
      for (const c of cols) { await hook(a, 'setPaint', { rgb: c }); await frames(a, 3); }
      await hook(a, 'setPaint', { rgb: cols[3] }); await frames(a, 3); // an old colour again: no duplicate, no reorder
      u = await ui(a);
      assert(u.recent.length === 5 && u.recent.map(hexOf).join() === [cols[5], cols[4], cols[3], cols[2], cols[1]].map(hexOf).join(), `[${tag}] the last 5 distinct colours, newest first: ${u.recent.map(hexOf).join(' ')}`);
      const sw = await a.evaluate(() => [...document.querySelectorAll('.chm-pal .chm-rc[data-chip]')].map((b) => b.style.background));
      assert(sw.every((x) => x), `[${tag}] every chip shows its colour (${sw.join(' ')})`);
      // a real tap on a chip sets the brush colour and keeps the order
      await a.tap('.chm-rc[data-chip="3"]');
      u = await ui(a);
      assert(hexOf(u.rgb) === hexOf(cols[2]) && u.recent.map(hexOf).join() === [cols[5], cols[4], cols[3], cols[2], cols[1]].map(hexOf).join(), `[${tag}] tapping chip 4 sets the brush to ${hexOf(cols[2])} and the strip keeps its order`);
      assert(await a.$eval('.chm-rc[data-chip="3"]', (b) => b.classList.contains('on')), `[${tag}] the chip that is the brush colour is marked`);
      // with the Pick tool armed, a chip tap switches back to the brush
      await a.tap('.chm-tool[data-tool="pick"]');
      assert((await ui(a)).tool === 'pick', `[${tag}] Pick armed`);
      await a.tap('.chm-rc[data-chip="1"]');
      u = await ui(a);
      assert(u.tool === 'brush' && hexOf(u.rgb) === hexOf(cols[4]), `[${tag}] a chip tap while picking sets the colour and goes back to the brush`);
      // a real Pick (drink the body's own colour) puts that colour at the front
      await faceBody(a);
      await hook(a, 'setPaint', { rgb: [255, 255, 255] }); await frames(a, 3); // (the body is white)
      await a.tap('.chm-tool[data-tool="pick"]');
      await hook(a, 'setPaint', { rgb: [12, 99, 77] }); await frames(a, 3);
      await a.tap('.chm-tool[data-tool="pick"]');
      await tapBody(a);
      await a.waitForFunction(() => window.__cham.paintUi().rgb[0] > 240, null, { timeout: 6000 });
      u = await ui(a);
      assert(u.recent.length === 5 && u.recent[0].every((v) => v > 235) && hexOf(u.recent[1]) === '#0c634d', `[${tag}] a real Pick of the (lit, near-white) body is the newest chip (${u.recent.map(hexOf).join(' ')})`);
      // layout: the chips don't sit on the other paint controls
      const R = await rects(a, ['.chm-pal', '.chm-opts', '.chm-trow', '.chm-poses', '.chm-meter']);
      const names = ['chips', 'opts', 'tools', 'poses', 'meter'];
      for (let i = 1; i < R.length; i++) assert(!overlap(R[0], R[i]), `[${tag}] the chip row does not overlap the ${names[i]}`);
      const vw = await a.evaluate(() => [innerWidth, innerHeight]);
      assert(R[0][0] >= 0 && R[0][2] <= vw[0] && R[0][3] <= vw[1], `[${tag}] the chip row is on screen (${R[0].map(Math.round)} in ${vw})`);
      await shot(a, `chips-${tag}`);
      h.assertNoErrors();
    } finally { await h.close(); }
  }
}

// ─────────────────────────────────────────────────────────────────────
async function patternSection(port) {
  console.log('\n# pattern fill: Solid / Stripes / Dots / Checker from the pattern chip, ink on the previous colour, undo, deterministic');
  const h = await hotseatHide(port);
  const a = h.a;
  try {
    await openPaint(a);
    await faceBody(a);
    const base = await hook(a, 'paintHash', 'b');
    const baseCols = await hook(a, 'paintColors', 'b');
    const NB = baseCols.length; // (the avatar's default skin has a few colours of its own)
    assert(NB >= 1 && !baseCols.some((c) => c.hex === '#285078' || c.hex === '#4a8474'), `a fresh skin has ${NB} colours, none of the test inks`);
    const INK = [40, 60, 120]; const GROUND = [74, 132, 116];
    await hook(a, 'setPaint', { rgb: GROUND }); await frames(a, 3);
    await hook(a, 'setPaint', { rgb: INK }); await frames(a, 3); // the strip: ink, then the previous colour
    assert((await ui(a)).recent.map(hexOf).join() === [INK, GROUND].map(hexOf).join(), 'the strip is [ink, previous colour]');
    const seen = {};
    const kinds = ['stripes', 'dots', 'checker'];
    // Solid first (the existing behaviour is untouched)
    await a.tap('.chm-tool[data-tool="fill"]'); await fillTap(a);
    await settled(a);
    let cols = await hook(a, 'paintColors', 'b');
    assert(cols.length <= NB + 1 && cols.some((c) => c.hex === hexOf(INK)), `Solid fill: the body in one colour (${cols.map((c) => c.hex + ' ' + c.n).join(', ')})`);
    const solidN = cols.find((c) => c.hex === hexOf(INK)).n;
    seen.solid = await hook(a, 'paintHash', 'b');
    await a.tap('.chm-tools [data-act="undo"]'); await settled(a);
    assert(await hook(a, 'paintHash', 'b') === base, 'Undo after a Solid fill restores the skin exactly');
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i];
      await a.tap('.chm-pat');
      let u = await ui(a);
      assert(u.pattern === kind && u.tool === 'fill' && u.fillLabel.toLowerCase() === kind, `pattern chip -> ${kind}: the tool is Fill, the Fill button reads "${u.fillLabel}"`);
      await fillTap(a);
      await settled(a);
      cols = await hook(a, 'paintColors', 'b');
      const ink = cols.find((c) => c.hex === hexOf(INK)); const gr = cols.find((c) => c.hex === hexOf(GROUND));
      assert(cols.length <= NB + 2 && ink && gr, `${kind}: the skin's other parts + ink + the previous colour (${cols.map((c) => c.hex + ' ' + c.n).join(', ')})`);
      const tot = ink.n + gr.n;
      assert(tot >= solidN * 0.98 && tot <= solidN * 1.02, `${kind}: covers the same texels as the solid fill (${tot} vs ${solidN})`);
      assert(ink.n / tot >= 0.25 && ink.n / tot <= 0.75, `${kind}: ink is ${Math.round((100 * ink.n) / tot)}% of the body, not a sliver`);
      seen[kind] = await hook(a, 'paintHash', 'b');
      await shot(a, `pattern-${kind}`);
      await a.tap('.chm-tools [data-act="undo"]'); await settled(a);
      assert(await hook(a, 'paintHash', 'b') === base, `Undo after ${kind} restores the skin exactly`);
    }
    assert(new Set(Object.values(seen)).size === 4, 'the four fills are four different skins');
    // determinism: the same fill again gives the same pixels
    await a.tap('.chm-pat'); // -> solid
    assert((await ui(a)).pattern === 'solid', 'the chip cycles back to Solid');
    await a.tap('.chm-pat'); await fillTap(a); await settled(a);
    if (await hook(a, 'paintHash', 'b') !== seen.stripes) console.log('  second stripes:', JSON.stringify(await hook(a, 'paintColors', 'b')), JSON.stringify(await ui(a)));
    assert(await hook(a, 'paintHash', 'b') === seen.stripes, 'a second Stripes fill gives the same pixels (deterministic)');
    // a pattern then the codec: quantise + encode keeps the exact pixels (<= 32 colours), so the seeker's copy matches (ONLY=sync)
    const pre = await hook(a, 'paintHash', 'b');
    await a.click('.chm-done'); await wait(400);
    assert(await hook(a, 'paintHash', 'b') === pre, 'closing the panel (pre-encode, <= 32 colours) leaves the patterned skin as it was');
    h.assertNoErrors();
  } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
async function lockSection(port) {
  console.log('\n# palette lock (Three colours twist): 3 chips, brush + fill only use them, Pick and Stamp are off with a reason');
  const h = await hotseatHide(port);
  const a = h.a;
  try {
    const LOCK = ['#c0392b', '#2e86c1', '#f1c40f'];
    const skin0 = (await hook(a, 'paintColors', 'b')).map((c) => c.hex);
    assert(await hook(a, 'setPaletteLock', ['nope', null, 12]) === false && (await ui(a)).lock === null, 'garbage input is not a lock');
    assert(await hook(a, 'setPaletteLock', LOCK) === true, 'setPaletteLock(3 hex colours) is accepted (the panel need not be open)');
    assert((await ui(a)).lock.join() === LOCK.join(), 'the lock reads back as hex');
    await openPaint(a);
    await faceBody(a);
    let u = await ui(a);
    assert(LOCK.includes(hexOf(u.rgb)), `opening the panel snaps the brush into the lock (${hexOf(u.rgb)})`);
    const vis = await a.evaluate(() => [...document.querySelectorAll('.chm-pal .chm-rc[data-chip]')].map((b) => ({ hidden: b.hidden || getComputedStyle(b).display === 'none', bg: b.style.background, w: b.getBoundingClientRect().width })));
    assert(vis.filter((c) => !c.hidden).length === 3 && vis.filter((c) => !c.hidden).every((c) => c.w >= 44), 'exactly 3 swatch chips show, each >= 44 px');
    assert(await a.evaluate(() => { const c = document.querySelector('.chm-lockcap'); return !c.hidden && /three colours/i.test(c.textContent) && /pick/i.test(c.textContent); }), 'a caption says Three colours and that Pick and Stamp are off');
    assert(await a.evaluate(() => ['pick', 'stamp'].every((t) => document.querySelector(`.chm-tool[data-tool="${t}"]`).getAttribute('aria-disabled') === 'true')), 'Pick and Stamp are marked disabled');
    await shot(a, 'lock-panel');
    // a chip tap picks the swatch
    await a.tap('.chm-rc[data-chip="1"]');
    u = await ui(a);
    assert(hexOf(u.rgb) === LOCK[1], 'tapping the second swatch sets the brush to it');
    // Pick / Stamp: a short reason, nothing changes
    const h0 = await hook(a, 'paintHash', 'b');
    await a.tap('.chm-tool[data-tool="pick"]', { force: true }); // (aria-disabled: Playwright waits for "enabled", a thumb doesn't)
    u = await ui(a);
    assert(u.tool !== 'pick', 'Pick does not arm while locked');
    assert(/three colours: pick is off/i.test(await a.textContent('.chm-hint')), `Pick says why: "${await a.textContent('.chm-hint')}"`);
    await a.tap('.chm-tool[data-tool="stamp"]', { force: true });
    await wait(400);
    assert(await hook(a, 'paintHash', 'b') === h0, 'Stamp does nothing while locked');
    assert(/three colours: stamp is off/i.test(await a.textContent('.chm-hint')), `Stamp says why: "${await a.textContent('.chm-hint')}"`);
    // the brush: an off-palette colour (a stale pick, a hook) snaps to the nearest swatch before it paints
    await hook(a, 'setPaint', { rgb: [1, 2, 3], tool: 'brush', size: 2, hard: true });
    await strokeOnBody(a);
    u = await ui(a);
    assert(LOCK.includes(hexOf(u.rgb)), `a stroke with an off-palette colour snapped to ${hexOf(u.rgb)}`);
    let cols = await hook(a, 'paintColors', 'b');
    assert(!cols.some((c) => c.hex === '#010203'), 'the off-palette colour never reached the skin');
    // the fill (solid and patterned) only uses the swatches (+ the untouched white)
    await hook(a, 'setPaint', { rgb: [9, 9, 9] });
    await a.tap('.chm-tool[data-tool="fill"]'); await fillTap(a); await settled(a);
    cols = await hook(a, 'paintColors', 'b');
    assert(!cols.some((c) => c.hex === '#090909'), 'a solid fill with an off-palette colour used a swatch instead');
    await a.tap('.chm-pat'); await fillTap(a); await settled(a);
    u = await ui(a);
    cols = await hook(a, 'paintColors', 'b');
    const allowed = new Set([...LOCK, ...skin0]);
    // (the soft edge of the earlier hard stroke blends two swatches at 50 %: only colours made of swatches + white are allowed on the fill's body region)
    const body = cols.filter((c) => c.n > 200);
    assert(u.pattern === 'stripes' && body.every((c) => allowed.has(c.hex)), `a Stripes fill under the lock uses only swatches: ${body.map((c) => c.hex + ' ' + c.n).join(', ')}`);
    assert(u.recent.every((c) => !LOCK.includes(hexOf(c))), `the lock's colours never enter the recent strip (${u.recent.map(hexOf).join(' ')})`);
    // clearing
    assert(await hook(a, 'setPaletteLock', null) === false && (await ui(a)).lock === null, 'setPaletteLock(null) clears the lock');
    await frames(a, 3);
    const back = await a.evaluate(() => ({ chips: [...document.querySelectorAll('.chm-pal .chm-rc[data-chip]')].filter((b) => !b.hidden).length, dis: ['pick', 'stamp'].map((t) => document.querySelector(`.chm-tool[data-tool="${t}"]`).getAttribute('aria-disabled')), cap: document.querySelector('.chm-lockcap').hidden }));
    assert(back.chips === 5 && back.dis.every((x) => x === null) && back.cap, 'the five recent slots, Pick and Stamp are back');
    const h1 = await hook(a, 'paintHash', 'b');
    await a.tap('.chm-tool[data-tool="stamp"]'); await settled(a);
    assert(await hook(a, 'paintHash', 'b') !== h1, 'Stamp works again');
    await a.tap('.chm-tool[data-tool="pick"]');
    assert((await ui(a)).tool === 'pick', 'Pick works again');
    h.assertNoErrors();
  } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
async function syncSection(port) {
  console.log('\n# two devices: a pattern fill (and a locked palette) reaches the seeker pixel for pixel');
  const h = await launch({ port, only: ['chameleon'], device: 'iPhone 13' });
  const { a, b } = h;
  try {
    for (const p of [a, b]) await arm(p);
    await h.startLive(a, 'chameleon', 'live');
    await h.settle();
    await b.click('#gm-invite [data-g="invite-yes"]');
    for (const p of [a, b]) await p.waitForFunction(() => window.__cham && window.__cham.ready && window.__cham.state().linkReady, null, { timeout: 40000 });
    await wait(600);
    await hook(a, 'setRules', { map: 'living', first: 'b', rules: { size: 'large' } });
    await b.waitForFunction(() => window.__cham.state().mapId === 'living' && window.__cham.state().setup.first === 'b', null, { timeout: 20000 });
    await a.tap('[data-act="start"]');
    await waitPhase(b, 'hide', 20000);
    const s = (await hook(b, 'spots')).camo;
    await hook(b, 'teleport', s.x, s.z - 0.1, 0, s.y); await wait(150);
    await hook(b, 'setPose', 'wall');
    assert(await hook(b, 'setPaletteLock', ['#c0392b', '#2e86c1', '#f1c40f']), 'the hider device is locked to three colours');
    await openPaint(b);
    await faceBody(b);
    await b.tap('.chm-rc[data-chip="0"]');
    await b.tap('.chm-pat'); // stripes
    await fillTap(b); await settled(b);
    await b.tap('.chm-pat'); // dots
    await b.tap('.chm-rc[data-chip="2"]');
    await fillTap(b, 70); await settled(b);
    await b.tap('.chm-pat'); // checker, on the legs
    const mine = await hook(b, 'paintColors', 'b');
    assert(mine.filter((c) => c.n > 100).length >= 3, `the hider skin has several colours (${mine.length})`);
    await b.click('.chm-done'); await wait(300);
    await b.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 20000); await waitPhase(b, 'seek', 5000);
    await wait(600);
    const hh = await hook(b, 'paintHash', 'b'); const hs = await hook(a, 'paintHash', 'b');
    assert(hh === hs, `the seeker's copy of the patterned skin matches the hider's exactly (hash ${hh})`);
    assert(JSON.stringify(await hook(a, 'paintColors', 'b')) === JSON.stringify(await hook(b, 'paintColors', 'b')), 'same colour histogram on both phones');
    h.assertNoErrors();
  } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
async function meterSection(port) {
  console.log('\n# camo meter: a number that is out of date is dimmed ("22 % 0.5 s after a stamp that locked at 70 %")');
  const h = await hotseatHide(port);
  const a = h.a;
  try {
    await openPaint(a);
    await settleMeter(a);
    const before = (await hook(a, 'camo')).score;
    const samples = [];
    const t0 = Date.now();
    const poll = async () => { const [c, u] = await a.evaluate(() => [window.__cham.camo(), window.__cham.paintUi()]); samples.push({ t: Date.now() - t0, text: c.meter.text, score: c.score, stale: u.meterStale, busy: c.busy }); };
    await poll();
    await a.tap('.chm-tool[data-tool="stamp"]');
    while (Date.now() - t0 < 4500) { await poll(); await wait(35); }
    await settleMeter(a);
    const fin = (await hook(a, 'blend', 'b')).now;
    const c = await hook(a, 'camo');
    assert(fin >= before + 20, `the stamp moves the score ${before}% -> ${fin}%`);
    assert(c.score === fin && c.meter.text === `${fin}%`, `the meter ends on the lock-time score (${c.meter.text} vs ${fin}%)`);
    const wrong = samples.slice(1).filter((s) => s.text !== `${fin}%`); // (sample 0 is the baseline, before the tap)
    const shown = wrong.filter((s) => !s.stale && s.score !== fin); // (once the new score is in, the number counting up to it is not out of date)
    const mid = wrong.filter((s) => s.t > 300).length;
    console.log(`  ${samples.length} samples: ${wrong.length} showed a number other than ${fin}% (${wrong.filter((s) => s.stale).length} dimmed, ${shown.length} not), ${mid} of them later than 0.3 s after the tap`);
    console.log('  ' + samples.map((x) => `${x.t}ms ${x.text}${x.stale ? ' (stale)' : ''}`).join(' | '));
    assert(wrong.filter((s) => s.stale).length > 0 && shown.filter((s) => s.text !== '--').length === 0, 'every sample that showed an out-of-date number (new score not in yet) had the stale (dimmed) state on');
    assert(!(await ui(a)).meterStale, 'the stale state clears once the new score is in');
    await shot(a, 'meter-settled');
    h.assertNoErrors();
  } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
async function posesSection(port) {
  console.log('\n# pose bar: labels fit their tiles (SQUEEZE / CROUCH), portrait + landscape, light + dark, with and without the paint panel');
  for (const [scheme, vp, tag] of [['light', { width: 844, height: 390 }, 'land-light'], ['dark', { width: 844, height: 390 }, 'land-dark'], ['dark', null, 'port-dark'], ['light', { width: 375, height: 667 }, 'sm-light'], ['light', { width: 320, height: 568 }, 'se-light']]) {
    const h = await launch({ port, only: ['chameleon'], who: ['a'], device: 'iPhone 13', colorScheme: scheme });
    const a = h.a;
    try {
      if (vp) await a.setViewportSize(vp);
      await arm(a);
      await h.startLive(a, 'chameleon', 'local');
      await waitReady(a);
      await hook(a, 'setRules', { map: 'living', first: 'b', rules: { size: 'large', climb: true } });
      await a.tap('[data-act="start"]'); await a.tap('[data-act="curtain"]');
      await waitPhase(a, 'hide'); await wait(500);
      await hook(a, 'openPoses'); await wait(400);
      const fit = async (label) => {
        const t = await a.evaluate(() => [...document.querySelectorAll('.chm-pose')].map((b) => {
          const r = b.getBoundingClientRect(); const tn = [...b.childNodes].reverse().find((n) => n.nodeType === 3);
          const rg = document.createRange(); rg.selectNodeContents(tn); const tr = rg.getBoundingClientRect();
          return { label: tn.textContent, w: r.width, h: r.height, text: tr.width, slack: Math.min(tr.left - r.left, r.right - tr.right) };
        }));
        assert(t.length >= 3, `[${tag}] ${label}: the pose bar shows ${t.map((x) => x.label).join('/')}`);
        for (const x of t) assert(x.slack >= (tag.startsWith('se') ? 4 : 5) && x.w >= 44 && x.h >= 44, `[${tag}] ${label}: ${x.label} tile ${Math.round(x.w)}x${Math.round(x.h)}, text ${Math.round(x.text)} px, ${x.slack.toFixed(1)} px clear each side`);
        const bar = (await rects(a, ['.chm-poses']))[0]; const vw = await a.evaluate(() => innerWidth);
        assert(bar && bar[0] >= 0 && bar[2] <= vw + 0.5, `[${tag}] ${label}: the bar is inside the screen (${bar && bar.map(Math.round)} of ${vw})`);
      };
      await fit('floor bar');
      await shot(a, `poses-${tag}`);
      await a.tap('.chm-acts [data-act="paint"]'); await wait(900);
      await fit('with the paint panel');
      await shot(a, `paint-${tag}`);
      if (tag === 'sm-light') { const o = (await rects(a, ['.chm-opts']))[0]; assert(o[3] - o[1] < 66, `[${tag}] size, hardness and Done share one row on a 375 px phone (opts ${Math.round(o[3] - o[1])} px tall)`); }
      const R = await rects(a, ['.chm-poses', '.chm-pal', '.chm-opts', '.chm-trow']);
      console.log(`  [${tag}] poses ${R[0].map(Math.round)} chips ${R[1].map(Math.round)} opts ${R[2].map(Math.round)} tools ${R[3].map(Math.round)}`);
      assert(!overlap(R[0], R[1]) && !overlap(R[0], R[2]) && !overlap(R[0], R[3]), `[${tag}] the pose bar clears the paint panel`);
      const W = await a.evaluate(() => [...document.querySelectorAll('.chm-pal .chm-rc')].map((b) => Math.round(b.getBoundingClientRect().width)));
      assert(W.every((w) => w >= 44), `[${tag}] chips stay >= 44 px (${W.join(' ')})`);
      const cr = (await rects(a, ['.chm-pal']))[0]; const vw = await a.evaluate(() => innerWidth);
      assert(cr[0] >= 0 && cr[2] <= vw + 0.5, `[${tag}] the chip row fits the width (${Math.round(cr[0])}..${Math.round(cr[2])} of ${vw})`);
      await shot(a, `paint-${tag}`);
      h.assertNoErrors();
    } finally { await h.close(); }
  }
}

(async () => {
  const sections = [];
  if (want('chips')) sections.push(() => chipsSection(PORT + 0));
  if (want('pattern')) sections.push(() => patternSection(PORT + 1));
  if (want('lock')) sections.push(() => lockSection(PORT + 2));
  if (want('sync')) sections.push(() => syncSection(PORT + 3));
  if (want('meter')) sections.push(() => meterSection(PORT + 4));
  if (want('poses')) sections.push(() => posesSection(PORT + 5));
  for (const run of sections) {
    try { await run(); } catch (e) { console.error(e); failures++; }
  }
  if (failures) { console.error(`\n${failures} section(s) failed`); process.exitCode = 1; } else console.log('\nALL GOOD');
})();
