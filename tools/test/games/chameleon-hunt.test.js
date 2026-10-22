// Blend & Seek — hunt interactions & couple moments (whisker shots, mercy chirp, notes on the skin, last-second drama).
//   node tools/test/games/chameleon-hunt.test.js                 (all sections)
//   ONLY=whisker,mercy PORT=9660 node tools/test/games/chameleon-hunt.test.js
// Sections: units, whisker, whiskerhs, mercy, note, notehs, drama, dramahs, db, shots
// Ports 9660–9679 (PORT moves them). Real taps (iPhone profile) for the touch flows.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { launch } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'chameleon-hunt-shots');
const PORT = Number(process.env.PORT) || 9660;
fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
let failures = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FAST = { hide: 12000, seek: 15000, title: 700, recap: 2500, found: 2200, final: 3000, seekLead: 900, resume: 1500, maxDpr: 0.6, noTips: true };
const SLOW = { ...FAST, hide: 90000, seek: 60000, recap: 10000, maxDpr: 0.45 };

async function arm(page, tune = FAST) { await page.evaluate((t) => { window.__chamTest = true; window.__chamTune = t; }, tune); }
const st = (p) => p.evaluate(() => window.__cham && window.__cham.state());
const hook = (p, fn, ...args) => p.evaluate(([f, a]) => window.__cham[f](...a), [fn, args]);
const mo = (p) => hook(p, 'moments');
async function waitReady(p) { await p.waitForFunction(() => window.__cham && window.__cham.ready, null, { timeout: 40000 }); }
async function waitPhase(p, name, timeout = 30000) { await p.waitForFunction((n) => window.__cham && window.__cham.state().phase.name === n, name, { timeout }); }
async function waitLinked(p) { await p.waitForFunction(() => window.__cham && window.__cham.ready && window.__cham.state().linkReady, null, { timeout: 40000 }); }
async function shot(p, name) { await p.screenshot({ path: path.join(SHOTS, name + '.png') }); }
async function startPair(h, tune = SLOW) {
  const { a, b } = h;
  for (const p of [a, b]) await arm(p, tune);
  await h.startLive(a, 'chameleon', 'live');
  await h.settle();
  await b.click('#gm-invite [data-g="invite-yes"]');
  await waitLinked(a); await waitLinked(b);
  await wait(600);
}
async function startMatch(h, { map = 'living', first = 'b', rules = {} } = {}) {
  const { a, b } = h;
  await hook(a, 'setRules', { map, first, rules });
  await b.waitForFunction(([m, f]) => window.__cham.state().mapId === m && window.__cham.state().setup.first === f, [map, first], { timeout: 20000 });
  await a.tap('[data-act="start"]');
}
/** Put the hider flat on the wallpaper with the stamp on (the good-camouflage setup). */
async function camoHide(p) {
  const spots = await hook(p, 'spots');
  const s = spots.camo;
  await hook(p, 'teleport', s.x, s.z - 0.1, 0, s.y);
  await wait(150);
  return hook(p, 'setPose', 'wall');
}
/** Stand the seeker `dist` m out from the hider's wall and aim at the hider's body centre shifted `side` m sideways (along the wall). */
async function standAndAim(sk, hiderW, { dist = 2.6, side = 0, up = 0 } = {}) {
  const bc = await hook(sk, 'bodyCenter', hiderW);
  await hook(sk, 'teleport', bc[0] + 0.3, bc[2] + dist, Math.PI, 0);
  await hook(sk, 'aimAt', bc[0] + side, bc[1] + up, bc[2]);
  return bc;
}
/** aimAt over a few frames, then the real Fire action. */
async function aimFire(sk, x, y, z) {
  await sk.evaluate(([px, py, pz]) => new Promise((res) => { let n = 0; const tk = () => { window.__cham.aimAt(px, py, pz); if (++n < 3) requestAnimationFrame(tk); else { window.__cham.action('fire'); res(); } }; requestAnimationFrame(tk); }), [x, y, z]);
}
async function huntReady(h, { hider = 'b', side = 0 } = {}) {
  const { a, b } = h;
  const H = hider === 'b' ? b : a; const S = hider === 'b' ? a : b;
  await waitPhase(H, 'hide', 25000);
  await camoHide(H);
  await H.tap('.chm-acts [data-act="ready"]');
  await waitPhase(S, 'seek', 25000); await waitPhase(H, 'seek', 5000);
  await S.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
  await wait(400);
  return { H, S };
}
/**
 * How far off the hider's body centre a "near miss" aims. The whisker band is fixed (0.35 m from the skin, never smaller than
 * for a size-1 body), but the skin shrinks with the hider: 0.55 m off a Large body is ~0.2 m from the skin, 0.55 m off a Petite
 * one (the By-map default on the Living Room) is ~0.37 m, just outside the band. Aim ~0.2 m off the skin for any size.
 */
const nearSide = async (p, w = 'b') => Math.min(0.55, 0.2 + 0.3 * (await hook(p, 'sizes'))[w].scale);
/** The newest round record (match history: survives the next round's reset). */
const lastRec = (p) => p.evaluate(() => { const h = window.__cham.state().match.hist; return h[h.length - 1] || null; });
const sticks = (p) => p.evaluate(() => Array.from(document.querySelectorAll('.chm-pops .chm-pop')).map((e) => e.textContent));

// ─────────────────────────────────────────────────────────────────────
async function unitsSection() {
  console.log('\n# units: sanitiser, geometry, bands');
  const M = await import(path.resolve(__dirname, '../../../js/games/chameleon/moments.js'));
  assert(M.cleanNote('  Hello   <b>there</b>​\n world\u0007 ') === 'Hello b there /b world', 'cleanNote strips angle brackets, control and zero-width characters and collapses spaces');
  assert(M.cleanNote('x'.repeat(80)).length === 40, 'cleanNote caps at 40');
  assert(Array.from(M.cleanNote('🙂'.repeat(60))).length === 40, 'cleanNote caps by code point (no split surrogates)');
  assert(M.cleanNote(null) === '' && M.cleanNote(42) === '' && M.cleanNote('   ') === '', 'cleanNote: non-strings and blanks are empty');
  const o = {};
  assert(Math.abs(M.segGap(0, 0, 0, 10, 0, 0, 5, 0.3, 0, o) - 0.3) < 1e-9 && Math.abs(o.t - 0.5) < 1e-9, 'segGap: perpendicular distance, mid-segment');
  assert(Math.abs(M.segGap(0, 0, 0, 10, 0, 0, 12, 0, 0, o) - 2) < 1e-9 && o.t === 1, 'segGap: beyond the end = distance to the end');
  assert(M.mercyBand(2.99) === 'hot' && M.mercyBand(3) === 'warm' && M.mercyBand(6.99) === 'warm' && M.mercyBand(7) === 'cold', 'mercy bands: hot < 3 m, warm < 7 m, else cold');
  const api = { name: (w) => (w === 'a' ? 'Emerson' : 'Sydney'), other: (w) => (w === 'a' ? 'b' : 'a') };
  const ml = M.momentLines(api, { hider: 'b', seeker: 'a', whisker: 2, mercy: 'warm', mercyPts: 10 });
  assert(ml.length === 2 && /whisker 2×/.test(ml[0]) && /took pity/.test(ml[1]) && /−10/.test(ml[1]), 'momentLines: whiskers + pity');
  const nl = M.noteLines(api, [{ round: 2, hider: 'b', note: '<img src=x onerror=alert(1)>' }, { round: 3, hider: 'a' }]);
  assert(nl.length === 1 && !/<img/.test(nl[0]) && /&lt;img/.test(nl[0]), 'noteLines escapes the note');
}

// ─────────────────────────────────────────────────────────────────────
async function whiskerSection(port) {
  console.log('\n# whisker shots (two devices): a near miss stains the hider in the seeker\'s ink, both see the sticker, the stat counts, the recap says so');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h);
    await startMatch(h, { rules: { grace: 0, headStart: 0, seek: 60 } });
    const { H, S } = await huntReady(h);
    const near = await nearSide(S);
    const bc = await standAndAim(S, 'b', { side: near });
    const hash0 = await hook(H, 'paintHash', 'b');
    // a miss well clear of the whisker band: nothing
    await aimFire(S, bc[0] + 1.6, bc[1], bc[2]);
    await wait(900);
    assert((await mo(H)).whisker === 0 && (await mo(S)).whisker === 0, 'a wide miss (1.6 m off) is not a whisker');
    assert(await hook(H, 'paintHash', 'b') === hash0, '…and leaves the skin alone');
    // now a near miss
    await aimFire(S, bc[0] + near, bc[1], bc[2]);
    await H.waitForFunction(() => window.__cham.moments().whisker >= 1, null, { timeout: 6000 });
    await S.waitForFunction(() => window.__cham.moments().whisker >= 1, null, { timeout: 6000 });
    const s0 = await st(S);
    assert(s0.phase.name === 'seek' && s0.round.pellets[S === a ? 'a' : 'b'] === 4, 'the near miss was a miss (round still on, 4 pellets left)');
    await wait(500);
    assert((await sticks(H)).includes('Missed by a whisker!') || (await mo(H)).stickers.includes('Missed by a whisker!'), 'the hider sees "Missed by a whisker!"');
    assert((await mo(S)).stickers.includes('Missed by a whisker!'), 'the seeker sees "Missed by a whisker!"');
    const mH = await mo(H);
    assert(mH.stains === 1 && mH.whiskLog.length === 1 && mH.whiskLog[0] <= 35, `the hider's device painted the stain (gap ${mH.whiskLog[0]} cm)`);
    const hash1 = await hook(H, 'paintHash', 'b');
    assert(hash1 !== hash0, 'the splat changed the hider\'s skin');
    await S.waitForFunction(() => window.__cham.state().live.got >= 1, null, { timeout: 6000 });
    await wait(300);
    assert(await hook(S, 'paintHash', 'b') === hash1, 'the stain reached the seeker\'s screen (texture hashes match through the live paint sync)');
    const d = await hook(H, 'data');
    assert((d.b_whisker | 0) === 1, `b_whisker recorded (${d.b_whisker})`);
    await shot(S, 'whisker-seeker');
    await shot(H, 'whisker-hider');
    // finish the round with a tag: the recap mentions the whisker
    await aimFire(S, ...(await hook(S, 'bodyCenter', 'b')));
    await waitPhase(S, 'recap', 30000); await waitPhase(H, 'recap', 5000);
    const rec = await lastRec(S);
    assert(rec && rec.found && rec.whisker === 1, `the round record carries the whisker (${rec && rec.whisker})`);
    await wait(400);
    for (const p of [S, H]) assert(/by a whisker/.test(await p.evaluate(() => document.querySelector('.chm-recap .chm-lines')?.textContent || '')), 'the recap card mentions the whisker');
    await shot(S, 'whisker-recap');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'whisker-FAIL-a').catch(() => {}); await shot(b, 'whisker-FAIL-b').catch(() => {});
    try { console.error(JSON.stringify(await mo(a)), JSON.stringify(await mo(b))); } catch { /* ignore */ }
  } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
/** Hotseat helpers: start, walk the curtains. Returns { hider, seeker } once the hunt has begun (hider hides first = `first`). */
async function hsStart(a, first = 'b') {
  await a.click(`[data-lobby="first"][data-v="${first}"]`);
  await a.click('[data-act="start"]');
  await waitPhase(a, 'curtain', 30000);
  await hook(a, 'action', 'curtain');
  await waitPhase(a, 'hide', 30000);
  await wait(300);
}
async function hsLock(a) {
  await hook(a, 'action', 'ready');
  await waitPhase(a, 'curtain', 30000);
}
async function hsSeek(a) {
  await hook(a, 'action', 'curtain');
  await waitPhase(a, 'seek', 30000);
  await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 30000 });
  await wait(300);
}

async function whiskerHsSection(port) {
  console.log('\n# hotseat: one device judges both: the near miss stains the hider, the sticker shows, the stat counts, no Mercy chip');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await arm(a, { ...SLOW, seek: 40000 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await wait(1200);
    await hook(a, 'setRules', { rules: { grace: 0, headStart: 0 } });
    await hsStart(a, 'b');
    assert(!(await mo(a)).chips.mercy, 'no Mercy chip in the hide phase');
    await camoHide(a);
    await hsLock(a); await hsSeek(a);
    const s = await st(a);
    const hider = s.viewer === 'a' ? 'b' : 'a';
    assert(hider === 'b', 'Sydney hid, Emerson seeks');
    assert(!(await a.isVisible('.chm-mo-mercy')) && !(await mo(a)).chips.mercy, 'hotseat: the Mercy chip is hidden (no one to send it to)');
    const near = await nearSide(a, hider);
    const bc = await standAndAim(a, hider, { side: near });
    const hash0 = await hook(a, 'paintHash', hider);
    await aimFire(a, bc[0] + near, bc[1], bc[2]);
    await a.waitForFunction(() => window.__cham.moments().whisker >= 1, null, { timeout: 6000 });
    await wait(400);
    const m1 = await mo(a);
    assert(m1.stains === 1 && m1.stickers.includes('Missed by a whisker!'), `hotseat near miss: stain + sticker (${m1.whiskLog[0]} cm)`);
    assert(await hook(a, 'paintHash', hider) !== hash0, 'the hider\'s skin took the splat');
    assert(((await hook(a, 'data')).b_whisker | 0) === 1, 'b_whisker recorded');
    // survive to the end of the clock → record carries the whisker
    await aimFire(a, ...(await hook(a, 'bodyCenter', hider)));
    await waitPhase(a, 'recap', 40000);
    const rec = await lastRec(a);
    assert(rec.found && rec.whisker === 1, 'the round record has the whisker');
    await wait(400);
    assert(/by a whisker/.test(await a.evaluate(() => document.querySelector('.chm-recap .chm-lines')?.textContent || '')), 'hotseat recap mentions the whisker');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'whiskerhs-FAIL').catch(() => {});
  } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
async function mercySection(port) {
  console.log('\n# mercy chirp (two devices): a hot / warm / cold ping for 10 points, once per hunt, 44 px, clear of the other buttons');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...SLOW, seek: 16000 });
    await startMatch(h, { rules: { grace: 0, headStart: 0, rounds: 4 } });
    const { H, S } = await huntReady(h);
    assert(!(await S.isVisible('.chm-mo-mercy')), 'the seeker has no Mercy chip');
    assert(await H.isVisible('.chm-mo-mercy'), 'the hunted hider has a Mercy chip');
    const box = await H.evaluate(() => { const r = document.querySelector('.chm-mo-mercy').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    assert(box[2] >= 44 && box[3] >= 44, `Mercy is ${Math.round(box[2])} × ${Math.round(box[3])} px (≥ 44)`);
    const overlaps = await H.evaluate(() => {
      const r = document.querySelector('.chm-mo-mercy').getBoundingClientRect(); const bad = [];
      for (const sel of ['.chm-acts button', '.chm-top', '.chm-sub', '.chm-gear', '.chm-pellets']) for (const e of document.querySelectorAll(sel)) { const q = e.getBoundingClientRect(); if (q.width && r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top) bad.push(sel); }
      return bad;
    });
    assert(!overlaps.length, `Mercy overlaps nothing (${overlaps.join(',') || 'clear'})`);
    await standAndAim(S, 'b', { dist: 2.4 });
    await wait(500);
    await shot(H, 'mercy-hider');
    await H.tap('.chm-mo-mercy');
    await S.waitForFunction(() => window.__cham.moments().mercy === 1, null, { timeout: 6000 });
    const mS = await mo(S);
    assert(mS.mercyBand === 'hot' && mS.stickers.includes('HOT'), `the seeker (2.4 m away) got a ${mS.mercyBand} ping`);
    await wait(500);
    assert(/HOT/.test(await S.evaluate(() => document.querySelector('.chm-hint')?.textContent || '') + (await sticks(S)).join(' ')), 'the ping is on the seeker\'s screen');
    await shot(S, 'mercy-seeker');
    assert(!(await H.isVisible('.chm-mo-mercy')), 'once per hunt: the chip is gone after use');
    assert(((await hook(H, 'data')).b_mercy | 0) === 1, 'b_mercy recorded');
    // survive the 9 s clock
    await waitPhase(S, 'recap', 40000); await waitPhase(H, 'recap', 5000);
    const rec = await lastRec(S);
    const base = Math.floor(rec.ms / 1000) + 30 + (rec.blendPts || 0);
    assert(rec.mercy === 'hot' && rec.mercyPts === 10 && rec.points === base - 10, `survived: ${rec.ms} ms → ${base} − 10 = ${rec.points} points (mercy ${rec.mercy})`);
    const sc = (await st(S)).match.scores;
    assert(sc.b === rec.points && (await st(H)).match.scores.b === rec.points, `the score carries the cost (Sydney ${sc.b})`);
    for (const p of [S, H]) {
      const ok = await p.waitForFunction(() => /took pity/.test(document.querySelector('.chm-recap .chm-lines')?.textContent || ''), null, { timeout: 5000 }).then(() => true, () => false);
      assert(ok, 'the recap says "took pity"');
    }
    // round 2: Emerson hides, Sydney seeks from ~5 m (warm); a quick tag: the cost never takes the round below zero
    for (const p of [a, b]) await p.evaluate(() => { window.__chamTune.seek = 40000; });
    await a.waitForFunction(() => window.__cham.state().phase.round === 2 && window.__cham.state().phase.name === 'hide', null, { timeout: 40000 });
    await camoHide(a);
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 25000);
    await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    const ac = await hook(b, 'bodyCenter', 'a');
    await hook(b, 'teleport', ac[0] + 0.3, ac[2] + 5.2, Math.PI, 0);
    await wait(500);
    await a.waitForFunction(() => window.__cham.moments().chips.mercy, null, { timeout: 6000 });
    await a.tap('.chm-mo-mercy');
    await b.waitForFunction(() => window.__cham.moments().mercy === 1, null, { timeout: 6000 });
    assert((await mo(b)).mercyBand === 'warm', `5.2 m away: ${(await mo(b)).mercyBand}`);
    await hook(b, 'teleport', ac[0] + 0.3, ac[2] + 2.6, Math.PI, 0);
    await aimFire(b, ...(await hook(b, 'bodyCenter', 'a')));
    await waitPhase(b, 'recap', 30000);
    const rec2 = await lastRec(b);
    assert(rec2.found && rec2.mercyPts === Math.min(10, rec2.mercyPts + rec2.points) && rec2.points >= 0, `a quick find with Mercy: +${rec2.points} (cost ${rec2.mercyPts}, never below zero)`);
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'mercy-FAIL-a').catch(() => {}); await shot(b, 'mercy-FAIL-b').catch(() => {});
    try { console.error(JSON.stringify(await mo(a)), JSON.stringify(await mo(b))); } catch { /* ignore */ }
  } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
async function noteSection(port) {
  console.log('\n# note on the skin (two devices): typed in the hide phase, sanitised, hidden from the seeker until FOUND / SURVIVED, then lettered over the body and listed on the final card');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...SLOW, final: 20000 });
    await startMatch(h, { rules: { grace: 0, headStart: 0, rounds: 2 } });
    await waitPhase(b, 'hide', 25000); await waitPhase(a, 'hide', 5000);
    assert(!(await a.isVisible('.chm-mo-note')), 'the blindfolded seeker has no Note chip');
    await camoHide(b);
    await b.waitForFunction(() => window.__cham.moments().chips.note, null, { timeout: 6000 });
    const box = await b.evaluate(() => { const r = document.querySelector('.chm-mo-note').getBoundingClientRect(); return [r.width, r.height]; });
    assert(box[0] >= 44 && box[1] >= 44, `Note chip ${Math.round(box[0])} × ${Math.round(box[1])} px`);
    await b.tap('.chm-mo-note');
    await b.waitForSelector('.chm-notesheet input', { timeout: 4000 });
    assert(await b.getAttribute('.chm-notesheet input', 'maxlength') === '40', 'the field is capped at 40 characters');
    await b.fill('.chm-notesheet input', 'Under the <b>zephyr</b> shade, hehe 123456789');
    const d1 = (await mo(b)).draft;
    assert(d1.length <= 40 && !/[<>]/.test(d1) && /^Under the b zephyr/.test(d1), `sanitised draft: "${d1}"`);
    await shot(b, 'note-sheet');
    await b.tap('.chm-notesheet [data-n="save"]');
    await wait(300);
    assert(!(await b.$('.chm-notesheet')), 'Save closes the sheet (and removes it from the DOM)');
    assert((await b.textContent('.chm-mo-note')).includes('Note set'), 'the chip says "Note set"');
    await b.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 25000); await waitPhase(b, 'seek', 5000);
    await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    await wait(600);
    const needle = 'zephyr';
    assert(!(await a.evaluate(() => document.documentElement.outerHTML)).includes(needle), 'the seeker\'s DOM does not contain the note during the hunt');
    assert(!(await a.evaluate(() => document.body.innerText)).includes(needle), '…nor in its visible text');
    assert((await mo(a)).notes.b.includes(needle), '(it is held in memory on the seeker\'s device for the reveal)');
    assert(((await hook(b, 'data')).b_notes | 0) === 1, 'b_notes recorded');
    await standAndAim(a, 'b', { dist: 2.4 });
    await aimFire(a, ...(await hook(a, 'bodyCenter', 'b')));
    await waitPhase(a, 'found', 30000);
    await waitPhase(a, 'recap', 20000); await waitPhase(b, 'recap', 5000);
    await wait(900);
    for (const p of [a, b]) {
      const tag = await p.evaluate(() => { const e = document.querySelector('.chm-notetag'); if (!e) return null; const r = e.querySelector('b').getBoundingClientRect(); return { text: e.querySelector('span').textContent, html: e.querySelector('span').innerHTML, x: r.left, y: r.top, w: r.width }; });
      assert(tag && tag.text === d1 && !/<b>/.test(tag.html), `the reveal sticker shows the note as plain text on both phones ("${tag && tag.text}")`);
      assert(tag.x >= 0 && tag.y >= 0, `…on screen (${Math.round(tag.x)}, ${Math.round(tag.y)})`);
    }
    await shot(a, 'note-recap-seeker');
    const rec = await lastRec(a);
    assert(rec.note === d1, 'the round record carries the note');
    // round 2: a hides without a note; the final card lists round 1's note
    await a.waitForFunction(() => window.__cham.state().phase.round === 2 && window.__cham.state().phase.name === 'hide', null, { timeout: 40000 });
    await camoHide(a);
    assert(!(await b.evaluate(() => document.documentElement.outerHTML)).includes('zephyr shade'), 'round 2: last round\'s note is gone from the seeker\'s page');
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 25000); await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    await standAndAim(b, 'a', { dist: 2.4 });
    await aimFire(b, ...(await hook(b, 'bodyCenter', 'a')));
    await waitPhase(a, 'recap', 30000);
    assert(!(await a.$('.chm-notetag')), 'no note, no sticker');
    await waitPhase(a, 'final', 30000);
    await wait(700);
    const fin = await a.evaluate(() => document.querySelector('.chm-over')?.textContent || '');
    assert(/Note from Sydney \(R1\)/.test(fin) && fin.includes(d1), 'the final card lists the note');
    await shot(a, 'note-final');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'note-FAIL-a').catch(() => {}); await shot(b, 'note-FAIL-b').catch(() => {});
    try { console.error(JSON.stringify(await mo(a)), JSON.stringify(await mo(b))); } catch { /* ignore */ }
  } finally { await h.close(); }
}

async function noteHsSection(port) {
  console.log('\n# note on the skin (hotseat): typed before the curtain, never on the page while the seeker holds the phone, revealed at the end');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await arm(a, { ...SLOW, seek: 40000 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await wait(1200);
    await hook(a, 'setRules', { rules: { grace: 0, headStart: 0 } });
    await hsStart(a, 'b');
    await camoHide(a);
    await a.tap('.chm-mo-note');
    await a.fill('.chm-notesheet input', 'Behind the plant, shh');
    await a.keyboard.press('Enter');
    await wait(300);
    assert(!(await a.$('.chm-notesheet')), 'Enter closes the sheet');
    assert((await mo(a)).draft === 'Behind the plant, shh', 'the note is kept');
    await hsLock(a);
    assert(!(await a.evaluate(() => document.documentElement.outerHTML)).includes('plant, shh'), 'the hand-over curtain does not contain the note');
    await hsSeek(a);
    assert(!(await a.evaluate(() => document.documentElement.outerHTML)).includes('plant, shh'), 'the hunt does not contain the note');
    assert(!(await a.isVisible('.chm-mo-note')), 'no Note chip while hunting');
    await standAndAim(a, 'b', { dist: 2.4 });
    await aimFire(a, ...(await hook(a, 'bodyCenter', 'b')));
    await waitPhase(a, 'recap', 30000);
    await wait(900);
    const txt = await a.evaluate(() => document.querySelector('.chm-notetag span')?.textContent || '');
    assert(txt === 'Behind the plant, shh', `revealed in the recap ("${txt}")`);
    assert(((await hook(a, 'data')).b_notes | 0) === 1, 'b_notes recorded');
    await shot(a, 'notehs-recap');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'notehs-FAIL').catch(() => {});
  } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
/** Wait until the hunt clock has `ms` left (shared clock), polling fast. */
async function untilLeft(p, ms) {
  await p.waitForFunction((m) => { const s = window.__cham.state(); return s.phase.name === 'seek' && s.phase.end - s.now < m; }, ms, { timeout: 60000, polling: 25 });
}
async function dramaSection(port) {
  console.log('\n# last-second drama (two devices): AT THE BUZZER (tag in the last 2 s), SO CLOSE (survived with the seeker < 1.5 m), the jingles');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...SLOW, seek: 12000 });
    await startMatch(h, { rules: { grace: 0, headStart: 0, rounds: 4 } });
    // round 1 (b hides): a tags with ~1.6 s left
    const { H, S } = await huntReady(h);
    await standAndAim(S, 'b', { dist: 2.4 });
    await untilLeft(S, 1900);
    await aimFire(S, ...(await hook(S, 'bodyCenter', 'b')));
    await waitPhase(S, 'found', 20000);
    const f0 = await hook(S, 'moments');
    await waitPhase(H, 'found', 5000).catch(() => {});
    let rec = await (async () => { await waitPhase(S, 'recap', 20000); return lastRec(S); })();
    assert(rec.found && rec.buzz != null && rec.buzz <= 2000, `a tag with ${rec.buzz} ms left is flagged (buzz)`);
    for (const p of [S, H]) {
      const m = await mo(p);
      assert(m.jingle === 'buzzer', `the buzzer chord plays on ${p === S ? 'the seeker' : 'the hider'} (${m.jingle})`);
      assert(m.stickers.includes('AT THE BUZZER'), `AT THE BUZZER sticker on ${p === S ? 'the seeker' : 'the hider'}`);
    }
    // the hit-stop was longer than the usual 0.5 s: measured at the FOUND entry on the seeker
    assert(f0.freezeLeft > 0.55, `the hit-stop at the buzzer is longer than the usual 0.5 s (${f0.freezeLeft.toFixed(2)} s left at the FOUND entry)`);
    // round 2 (a hides): an early find is not "at the buzzer"; it's a quick one
    await a.waitForFunction(() => window.__cham.state().phase.round === 2 && window.__cham.state().phase.name === 'hide', null, { timeout: 40000 });
    await camoHide(a);
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 25000); await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    await standAndAim(b, 'a', { dist: 2.4 });
    await aimFire(b, ...(await hook(b, 'bodyCenter', 'a')));
    await waitPhase(b, 'recap', 30000);
    rec = await lastRec(b);
    assert(rec.found && rec.buzz == null && rec.ms < 10000, `an early find (${rec.ms} ms) is not at the buzzer`);
    assert((await mo(b)).jingle === 'quick' && (await mo(a)).jingle === 'sad', `a find under 10 s: "${(await mo(b)).jingle}" for the finder, "${(await mo(a)).jingle}" for the found`);
    assert((await mo(b)).stickers.filter((x) => x === 'AT THE BUZZER').length === 1, 'no second buzzer sticker (the early find did not earn one)');
    // round 3 (b hides): the seeker waits 1.0 m away and never fires: SO CLOSE
    await b.waitForFunction(() => window.__cham.state().phase.round === 3 && window.__cham.state().phase.name === 'hide', null, { timeout: 40000 });
    await camoHide(b);
    await b.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 25000); await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    const bc = await hook(a, 'bodyCenter', 'b');
    await hook(a, 'teleport', bc[0] + 0.2, bc[2] + 1.0, Math.PI, 0);
    await waitPhase(a, 'recap', 60000);
    rec = await lastRec(a);
    assert(!rec.found && rec.close != null && rec.close <= 1.5, `survived with the seeker ${rec.close} m away: SO CLOSE`);
    for (const p of [a, b]) { const m = await mo(p); assert(m.jingle === 'closeCall' && m.stickers.includes('SO CLOSE'), `close-call chord + sticker on ${p === a ? 'the seeker' : 'the hider'} (${m.jingle})`); }
    // round 4 (a hides): the seeker far away: a plain survival
    await a.waitForFunction(() => window.__cham.state().phase.round === 4 && window.__cham.state().phase.name === 'hide', null, { timeout: 40000 });
    await camoHide(a);
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 25000); await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    const ac = await hook(b, 'bodyCenter', 'a');
    await hook(b, 'teleport', ac[0] + 0.2, ac[2] + 5.5, Math.PI, 0);
    await waitPhase(b, 'recap', 60000);
    rec = await lastRec(b);
    assert(!rec.found && rec.close == null, 'a far seeker: no SO CLOSE');
    assert(['survive', 'ghost'].includes((await mo(a)).jingle), `plain survive chord (${(await mo(a)).jingle})`);
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'drama-FAIL-a').catch(() => {}); await shot(b, 'drama-FAIL-b').catch(() => {});
    try { console.error(JSON.stringify(await mo(a)), JSON.stringify(await mo(b))); } catch { /* ignore */ }
  } finally { await h.close(); }
}

async function dramaHsSection(port) {
  console.log('\n# last-second drama (hotseat): a tag with ~1.5 s left is AT THE BUZZER and counts as a find; a survival with the seeker beside the hider is SO CLOSE');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await arm(a, { ...SLOW, seek: 12000 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await wait(1200);
    await hook(a, 'setRules', { rules: { grace: 0, headStart: 0, rounds: 2 } });
    await hsStart(a, 'b');
    await camoHide(a);
    await hsLock(a); await hsSeek(a);
    await standAndAim(a, 'b', { dist: 2.4 });
    await untilLeft(a, 1900);
    await aimFire(a, ...(await hook(a, 'bodyCenter', 'b')));
    await waitPhase(a, 'found', 20000);
    const f = await hook(a, 'moments');
    await waitPhase(a, 'recap', 20000);
    let rec = await lastRec(a);
    assert(rec.found && rec.buzz != null, `hotseat: a tag with ${rec.buzz} ms left is a FIND at the buzzer`);
    assert(f.jingle === 'buzzer' || (await mo(a)).jingle === 'buzzer', 'buzzer chord');
    await wait(900);
    assert((await mo(a)).stickers.includes('AT THE BUZZER'), 'AT THE BUZZER sticker');
    // round 2: a hides (curtain), b seeks and just stands next to the hider
    await waitPhase(a, 'curtain', 40000); await hook(a, 'action', 'curtain');
    await waitPhase(a, 'hide', 30000); await wait(300);
    await camoHide(a);
    await hsLock(a); await hsSeek(a);
    const bc = await hook(a, 'bodyCenter', 'a');
    await hook(a, 'teleport', bc[0] + 0.2, bc[2] + 1.0, Math.PI, 0);
    await waitPhase(a, 'recap', 60000);
    rec = await lastRec(a);
    assert(!rec.found && rec.close != null && rec.close <= 1.5, `hotseat survival with the seeker ${rec.close} m away: SO CLOSE`);
    await wait(900);
    assert((await mo(a)).stickers.includes('SO CLOSE') && (await mo(a)).jingle === 'closeCall', 'close-call sticker + chord');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'dramahs-FAIL').catch(() => {});
    try { console.error(JSON.stringify(await mo(a))); } catch { /* ignore */ }
  } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
async function dbSection(port) {
  console.log('\n# Double Blind: no Mercy / Note chips; a near miss still says "Missed by a whisker!" and counts (no stain: there is no sync path)');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, SLOW);
    await hook(a, 'setRules', { mode: 'db', map: 'living', rules: { grace: 0, headStart: 0, seek: 60 } });
    await b.waitForFunction(() => window.__cham.state().setup.mode === 'db', null, { timeout: 20000 });
    await a.tap('[data-act="start"]');
    await waitPhase(a, 'hide', 25000); await waitPhase(b, 'hide', 5000);
    assert(!(await mo(a)).chips.note && !(await mo(b)).chips.note, 'no Note chip in Double Blind');
    await camoHide(b);
    // (both hide on the same wall: Emerson a metre and a half along it)
    { const sp = (await hook(a, 'spots')).camo; await hook(a, 'teleport', sp.x + 1.5, sp.z - 0.1, 0, sp.y); await hook(a, 'setPose', 'wall'); }
    await a.tap('.chm-acts [data-act="ready"]'); await b.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 30000); await waitPhase(b, 'seek', 5000);
    await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    await wait(500);
    assert(!(await mo(a)).chips.mercy && !(await mo(b)).chips.mercy, 'no Mercy chip in Double Blind');
    const bc = await hook(a, 'bodyCenter', 'b');
    const near = await nearSide(a);
    await hook(a, 'teleport', bc[0] + 0.3, bc[2] + 2.6, Math.PI, 0);
    await hook(a, 'aimAt', bc[0] + near, bc[1], bc[2]);
    await aimFire(a, bc[0] + near, bc[1], bc[2]);
    await wait(1500);
    await b.waitForFunction(() => window.__cham.moments().whisker >= 1, null, { timeout: 8000 });
    await a.waitForFunction(() => window.__cham.moments().whisker >= 1, null, { timeout: 8000 });
    const mb = await mo(b);
    assert(mb.stains === 0 && mb.stickers.includes('Missed by a whisker!') && ((await hook(b, 'data')).b_whisker | 0) === 1, 'DB: sticker + stat, no stain');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'db-FAIL-a').catch(() => {}); await shot(b, 'db-FAIL-b').catch(() => {});
    try { console.error(JSON.stringify(await mo(a)), JSON.stringify(await mo(b))); } catch { /* ignore */ }
  } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
/** Layout checks + screenshots: portrait / landscape x light / dark; chips are ≥ 44 px, inside the screen, clear of the other controls. */
async function shotsSection(port) {
  console.log('\n# layout: Note + Mercy chips and the note sheet in portrait / landscape, light / dark (screenshots in ' + SHOTS + ')');
  const chipRect = (p, sel) => p.evaluate((q) => { const e = document.querySelector(q); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }, sel);
  const clear = (p, sel) => p.evaluate((q) => {
    const r = document.querySelector(q).getBoundingClientRect(); const bad = [];
    for (const s2 of ['.chm-meter', '.chm-acts button', '.chm-top > *', '.chm-sub > *', '.chm-gear > *', '.chm-poses', '.chm-joyhint']) for (const e of document.querySelectorAll(s2)) { const o = e.getBoundingClientRect(); if (o.width && !e.closest('[hidden]') && r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top) bad.push(s2); }
    return bad;
  }, sel);
  for (const [scheme, vp, tag] of [['dark', null, 'port-dark'], ['light', { width: 844, height: 390 }, 'land-light'], ['dark', { width: 844, height: 390 }, 'land-dark'], ['light', { width: 375, height: 667 }, 'se-light']]) {
    const h = await launch({ port, only: ['chameleon'], colorScheme: scheme, device: 'iPhone 13' });
    const { a, b } = h;
    try {
      if (vp) for (const p of [a, b]) await p.setViewportSize(vp);
      await startPair(h, { ...SLOW, final: 20000 });
      await startMatch(h, { rules: { grace: 0, headStart: 0 } });
      await waitPhase(b, 'hide', 25000); await waitPhase(a, 'hide', 5000);
      await camoHide(b);
      await b.waitForFunction(() => window.__cham.moments().chips.note, null, { timeout: 8000 });
      let r = await chipRect(b, '.chm-mo-note');
      assert(r && r[2] >= 44 && r[3] >= 44 && r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= (vp ? vp.width : 390), `[${tag}] Note chip ${Math.round(r[2])} × ${Math.round(r[3])} px, on screen`);
      let bad = await clear(b, '.chm-mo-note');
      assert(!bad.length, `[${tag}] Note chip overlaps nothing (${bad.join(',') || 'clear'})`);
      await shot(b, `${tag}-1-note-chip`);
      await b.tap('.chm-mo-note');
      await b.waitForSelector('.chm-notesheet input');
      await b.fill('.chm-notesheet input', 'Under the lamp, shh');
      const sr = await b.evaluate(() => { const r = document.querySelector('.chm-notesheet .chm-card').getBoundingClientRect(); const i = document.querySelector('.chm-notesheet input').getBoundingClientRect(); const bt = [...document.querySelectorAll('.chm-notesheet button')].map((e) => { const q = e.getBoundingClientRect(); return [q.width, q.height]; }); return { card: [r.left, r.top, r.right, r.bottom], input: [i.width, i.height], bt, vh: innerHeight, vw: innerWidth }; });
      assert(sr.card[1] >= 0 && sr.card[3] <= sr.vh && sr.card[0] >= 0 && sr.card[2] <= sr.vw, `[${tag}] the note sheet fits the screen (${sr.card.map(Math.round)} in ${sr.vw}×${sr.vh})`);
      assert(sr.input[1] >= 44 && sr.bt.every((q) => q[0] >= 44 && q[1] >= 44), `[${tag}] field and buttons ≥ 44 px`);
      await shot(b, `${tag}-2-note-sheet`);
      await b.tap('.chm-notesheet [data-n="save"]');
      await b.tap('.chm-acts [data-act="ready"]');
      await waitPhase(a, 'seek', 25000); await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
      await b.waitForFunction(() => window.__cham.moments().chips.mercy, null, { timeout: 8000 });
      r = await chipRect(b, '.chm-mo-mercy');
      assert(r && r[2] >= 44 && r[3] >= 44 && r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= (vp ? vp.width : 390), `[${tag}] Mercy chip ${Math.round(r[2])} × ${Math.round(r[3])} px, on screen`);
      bad = await clear(b, '.chm-mo-mercy');
      assert(!bad.length, `[${tag}] Mercy chip overlaps nothing (${bad.join(',') || 'clear'})`);
      await shot(b, `${tag}-3-mercy-chip`);
      // a whisker, so the sticker + stain are on screen
      const near = await nearSide(a);
      const bc = await standAndAim(a, 'b', { side: near });
      await aimFire(a, bc[0] + near, bc[1], bc[2]);
      await a.waitForFunction(() => window.__cham.moments().whisker >= 1, null, { timeout: 8000 });
      await wait(450);
      await shot(a, `${tag}-4-whisker-seeker`); await shot(b, `${tag}-4-whisker-hider`);
      await b.tap('.chm-mo-mercy');
      await a.waitForFunction(() => window.__cham.moments().mercy === 1, null, { timeout: 8000 });
      await wait(450);
      await shot(a, `${tag}-5-ping-seeker`);
      await aimFire(a, ...(await hook(a, 'bodyCenter', 'b')));
      await waitPhase(a, 'recap', 30000);
      await wait(1300);
      const tg = await a.evaluate(() => { const e = document.querySelector('.chm-notetag b'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, innerWidth, innerHeight]; });
      assert(tg && tg[0] >= 0 && tg[2] <= tg[4] && tg[1] >= 0 && tg[3] <= tg[5], `[${tag}] the revealed note sticker is on screen (${tg && tg.map(Math.round)})`);
      await shot(a, `${tag}-6-recap-note`);
      h.assertNoErrors();
    } catch (e) {
      console.error(e.message, h.errors); failures++;
      await shot(a, `${tag}-FAIL-a`).catch(() => {}); await shot(b, `${tag}-FAIL-b`).catch(() => {});
    } finally { await h.close(); }
  }
}

// ─────────────────────────────────────────────────────────────────────
(async () => {
  const sections = [];
  if (want('units')) sections.push(() => unitsSection());
  if (want('whisker')) sections.push(() => whiskerSection(PORT + 0));
  if (want('whiskerhs')) sections.push(() => whiskerHsSection(PORT + 1));
  if (want('mercy')) sections.push(() => mercySection(PORT + 2));
  if (want('note')) sections.push(() => noteSection(PORT + 3));
  if (want('notehs')) sections.push(() => noteHsSection(PORT + 4));
  if (want('drama')) sections.push(() => dramaSection(PORT + 5));
  if (want('dramahs')) sections.push(() => dramaHsSection(PORT + 6));
  if (want('db')) sections.push(() => dbSection(PORT + 7));
  if (want('shots')) sections.push(() => shotsSection(PORT + 8));
  for (const run of sections) {
    try { await run(); } catch (e) { console.error(e); failures++; }
  }
  if (failures) { console.error(`\n${failures} section(s) failed`); process.exitCode = 1; } else console.log('\nALL GOOD');
})();
