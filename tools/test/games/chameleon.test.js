// Blend & Seek (chameleon) — end-to-end tests.
//   node tools/test/games/chameleon.test.js            (all sections)
//   ONLY=hotseat,match node tools/test/games/chameleon.test.js
//   SHOTS=/some/dir   where screenshots go (default: $TMPDIR/chameleon-shots)
//
// The game exposes a test hook (window.__cham) only when the page sets window.__chamTest = true
// before mounting. window.__chamTune shortens timers so a 4-round match fits in a test, and
// caps the pixel ratio (headless Chromium renders WebGL in software, so frames are slow).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { launch } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'chameleon-shots');
const PORT = Number(process.env.PORT) || 8910; // PORT=8950 node … uses PORT..PORT+9
fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
let failures = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FAST = { hide: 12000, seek: 15000, title: 700, recap: 2500, found: 2200, seekLead: 900, resume: 1500, maxDpr: 0.6, noTips: true };
const near = (a, b, tol) => a.every((x, i) => Math.abs(x - b[i]) <= tol);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fmt3 = (v) => `(${v.map((x) => x.toFixed(2)).join(', ')})`;
/** The largest map by area × floors (needs a mounted game). */
async function biggestMap(p) {
  const list = await p.evaluate(() => window.__cham.mapsInfo());
  let best = list[0];
  for (const m of list) if (m.area > best.area) best = m;
  return { id: best.id, area: best.area, ids: list.map((x) => x.id), big: list.filter((x) => x.area > 160).map((x) => x.id), list };
}

async function arm(page, tune = FAST) {
  await page.evaluate((t) => { window.__chamTest = true; window.__chamTune = t; }, tune);
}
const st = (p) => p.evaluate(() => window.__cham && window.__cham.state());
const hook = (p, fn, ...args) => p.evaluate(([f, a]) => window.__cham[f](...a), [fn, args]);
async function waitReady(p) { await p.waitForFunction(() => window.__cham && window.__cham.ready, null, { timeout: 40000 }); }
async function waitPhase(p, name, timeout = 30000) {
  await p.waitForFunction((n) => window.__cham && window.__cham.state().phase.name === n, name, { timeout });
}
async function waitLinked(p) { await p.waitForFunction(() => window.__cham && window.__cham.ready && window.__cham.state().linkReady, null, { timeout: 40000 }); }
async function shot(p, name) { await p.screenshot({ path: path.join(SHOTS, name + '.png') }); }

/** A real touch drag (pointerType 'touch'), holding at the end for `ms`. */
async function touchHold(page, x0, y0, x1, y1, ms, id = 11) {
  await page.evaluate(async ([ax, ay, bx, by, hold, pid]) => {
    const el = document.elementFromPoint(ax, ay);
    const mk = (type, x, y) => new PointerEvent(type, { pointerId: pid, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 });
    el.dispatchEvent(mk('pointerdown', ax, ay));
    for (let i = 1; i <= 6; i++) { await new Promise((r) => setTimeout(r, 30)); el.dispatchEvent(mk('pointermove', ax + (bx - ax) * i / 6, ay + (by - ay) * i / 6)); }
    await new Promise((r) => setTimeout(r, hold));
    el.dispatchEvent(mk('pointerup', bx, by));
  }, [x0, y0, x1, y1, ms, id]);
}
async function surfaceBox(p) { return p.evaluate(() => { const r = document.querySelector('.chm-surface').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }); }

/** Paint a stroke across my own body through the canvas (mouse on desktop, touch on phones). */
async function strokeOnBody(p, touch) {
  const [x, y] = await hook(p, 'bodyPoint', 0);
  if (touch) {
    await p.evaluate(async ([cx, cy]) => {
      const el = document.elementFromPoint(cx, cy);
      const mk = (type, xx, yy) => new PointerEvent(type, { pointerId: 21, pointerType: 'touch', clientX: xx, clientY: yy, bubbles: true, cancelable: true, isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 });
      el.dispatchEvent(mk('pointerdown', cx - 18, cy));
      for (let i = 1; i <= 8; i++) { await new Promise((r) => setTimeout(r, 25)); el.dispatchEvent(mk('pointermove', cx - 18 + i * 5, cy + (i % 2) * 3)); }
      el.dispatchEvent(mk('pointerup', cx + 22, cy));
    }, [x, y]);
  } else {
    await p.mouse.move(x - 18, y); await p.mouse.down();
    for (let i = 1; i <= 8; i++) { await p.mouse.move(x - 18 + i * 5, y + (i % 2) * 3); await wait(25); }
    await p.mouse.up();
  }
}

/** Put the hider flat on the map's open wallpaper and stamp it on (the "good camouflage" setup). */
async function camoHide(p) {
  const spots = await hook(p, 'spots');
  const s = spots.camo;
  await hook(p, 'teleport', s.x, s.z - 0.1, 0, s.y);
  await wait(150);
  const pose = await hook(p, 'setPose', 'wall');
  return pose;
}

// ─────────────────────────────────────────────────────────────────────
// screenshot runs render at the real pixel ratio, which is very slow in software GL: long phases
const SHOWCASE = { ...FAST, hide: 120000, seek: 120000, recap: 60000, found: 6000, maxDpr: 2, fixedScale: true };
async function hotseat(port, { colorScheme = 'light', device = 'iPhone 13', prefix = 'phone-light', viewport = null, keyboard = false } = {}) {
  const h = await launch({ port, only: ['chameleon'], who: ['a'], colorScheme, device });
  const a = h.a;
  try {
    if (viewport) await a.setViewportSize(viewport);
    await arm(a, SHOWCASE);
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await wait(1800);
    await shot(a, `${prefix}-1-start`);
    assert(await a.isVisible('[data-act="start"]'), `[${prefix}] start screen shows a Start button`);
    const dbDisabled = await a.$eval('[data-lobby="mode"][data-v="db"]', (b) => b.disabled);
    assert(dbDisabled, `[${prefix}] Double Blind is disabled on one device`);
    await a.click('[data-lobby="first"][data-v="b"]');
    await a.click('[data-act="start"]');
    await waitPhase(a, 'curtain');
    const cur = await st(a);
    assert(cur.blind && await a.isVisible('[data-curtain="hide"]'), `[${prefix}] "Seeker, look away" curtain covers the screen`);
    assert(await a.evaluate(() => getComputedStyle(document.querySelector('.chm canvas')).visibility) === 'hidden', `[${prefix}] canvas hidden behind the curtain`);
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(500);
    let s = await st(a);
    assert(s.viewer === 'b' && s.round && s.match.first === 'b', `[${prefix}] hider (Sydney) is playing the hide phase`);
    // move: keyboard on desktop, joystick on phones
    const before = s.bodies.b;
    if (keyboard) {
      // hold W until the hider has walked a bit (software rendering can be very slow here)
      await a.keyboard.down('KeyW');
      await a.waitForFunction((b0) => { const b = window.__cham.state().bodies.b; return Math.hypot(b.x - b0.x, b.z - b0.z) > 0.5; }, before, { timeout: 15000 }).catch(() => {});
      await a.keyboard.up('KeyW');
    } else {
      const box = await surfaceBox(a);
      await touchHold(a, box[0] + 80, box[1] + box[3] - 150, box[0] + 80, box[1] + box[3] - 195, 900);
    }
    s = await st(a);
    const moved = Math.hypot(s.bodies.b.x - before.x, s.bodies.b.z - before.z);
    assert(moved > 0.4, `[${prefix}] hider moved ${moved.toFixed(2)} m with ${keyboard ? 'W' : 'the joystick'}`);
    // pose + paint + stamp
    const pose = await camoHide(a);
    assert(pose === 'wall', `[${prefix}] flattened against the wallpaper`);
    if (keyboard) await a.keyboard.press('KeyP'); else await a.click('.chm-acts [data-act="paint"]');
    await wait(900);
    assert(await a.isVisible('.chm-tools'), `[${prefix}] paint tools are showing`);
    const h0 = await hook(a, 'paintHash', 'b');
    await strokeOnBody(a, !keyboard);
    await wait(300);
    const h1 = await hook(a, 'paintHash', 'b');
    assert(h1 !== h0, `[${prefix}] a brush stroke changed the body texture`);
    if (keyboard) await a.keyboard.press('KeyT'); else await a.click('.chm-tool[data-tool="stamp"]');
    await wait(500);
    const h2 = await hook(a, 'paintHash', 'b');
    assert(h2 !== h1, `[${prefix}] stamping the wallpaper changed the texture`);
    await hook(a, 'paintCamAt', ...(await hook(a, 'bodyCenter', 'b')), 0.5, 0.3, 1, 1.25);
    await wait(900);
    await shot(a, `${prefix}-2-painting`);
    if (keyboard) await a.keyboard.press('KeyP'); else await a.click('.chm-done');
    await wait(200);
    if (keyboard) await a.keyboard.press('KeyR'); else await a.click('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'curtain');
    assert(await a.isVisible('[data-curtain="seek"]'), `[${prefix}] "Hider, hand it over" curtain`);
    s = await st(a);
    assert(s.violations === 0, `[${prefix}] the hider was never drawn on the seeker's screen before seeking`);
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'seek');
    s = await st(a);
    assert(s.viewer === 'a', `[${prefix}] seeker (Emerson) holds the device for the hunt`);
    // seeker walks up and looks at the hider from ~2.6 m
    const bc = await hook(a, 'bodyCenter', 'b');
    await hook(a, 'teleport', bc[0] + 0.4, bc[2] + 2.6, Math.PI);
    await hook(a, 'aimAt', bc[0] + 0.25, bc[1] + 0.05, bc[2]);
    await wait(1400);
    await shot(a, `${prefix}-3-camouflaged`);
    // fire through the UI
    await hook(a, 'aimAt', ...(await hook(a, 'bodyCenter', 'b')));
    await wait(250);
    if (keyboard) {
      // mouse click fires (pointer lock is attempted; headless may refuse and we fall back)
      const box = await surfaceBox(a);
      await a.mouse.click(box[0] + box[2] / 2, box[1] + box[3] / 2);
      await wait(400);
      if ((await st(a)).phase.name === 'seek' && (await st(a)).round.used.a === 0) await a.mouse.click(box[0] + box[2] / 2, box[1] + box[3] / 2);
    } else await a.click('.chm-acts [data-act="fire"]');
    await waitPhase(a, 'found', 20000);
    await wait(900);
    await shot(a, `${prefix}-4-found`);
    await waitPhase(a, 'recap', 20000);
    s = await st(a);
    await wait(1800);
    await shot(a, `${prefix}-5-recap`);
    assert(s.round.rec && s.round.rec.found && s.match.scores.b >= 0, `[${prefix}] round recorded: found after ${(s.round.rec.ms / 1000).toFixed(1)} s`);
    h.assertNoErrors();
    return h;
  } catch (e) {
    await shot(a, `${prefix}-FAIL`).catch(() => {});
    console.error(e.message, h.errors);
    try { console.error(JSON.stringify(await st(a)).slice(0, 1500)); } catch { /* ignore */ }
    failures++;
    return h;
  }
}

// ─────────────────────────────────────────────────────────────────────
/** Start a live two-phone game and wait until both are linked and in the lobby. */
async function startPair(h, tune = FAST) {
  const { a, b } = h;
  for (const p of [a, b]) await arm(p, tune);
  await h.startLive(a, 'chameleon', 'live');
  await h.settle();
  await b.click('#gm-invite [data-g="invite-yes"]');
  await waitLinked(a); await waitLinked(b);
  await wait(600);
}
/** Eyedropper through the UI: tap a probe point in paint mode, compare with the map's colour. */
async function probeTap(p, probe, w) {
  const [px, py, pz] = probe.point; const [nx, ny, nz] = probe.normal;
  let d = [nx, ny, nz];
  if (Math.abs(ny) > 0.9) { const l = Math.hypot(0.9, 1.1, 0.4); d = [0.9 / l, 1.1 / l, 0.4 / l]; }
  const hl = Math.hypot(d[0], d[2]) || 1; const tx = -d[2] / hl; const tz = d[0] / hl;
  await hook(p, 'teleport', px + (d[0] / hl) * 1.05 + tx * 0.45, pz + (d[2] / hl) * 1.05 + tz * 0.45, 0);
  await wait(250);
  await hook(p, 'paintCamAt', px, py, pz, d[0], d[1], d[2], 2.3);
  await wait(900);
  const [sx, sy, sz] = await hook(p, 'screenOf', px, py, pz);
  await p.click('.chm-tool[data-tool="pick"]');
  await p.evaluate(([x, y]) => {
    const el = document.querySelector('.chm-surface');
    const mk = (type) => new PointerEvent(type, { pointerId: 31, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 });
    el.dispatchEvent(mk('pointerdown')); el.dispatchEvent(mk('pointerup'));
  }, [sx, sy]);
  await wait(250);
  const s = await st(p);
  const pick = s.lastPick;
  const hex = '#' + pick.rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
  const dist = Math.hypot(pick.point[0] - px, pick.point[1] - py, pick.point[2] - pz);
  return { hex, want: probe.hex.toLowerCase(), dist, onScreen: sz < 1, tool: s.paint && s.paint.tool, w };
}

async function hsRound(h, { hider, round, style }) {
  const pages = { a: h.a, b: h.b };
  const H = pages[hider]; const Sk = pages[hider === 'a' ? 'b' : 'a'];
  const sk = hider === 'a' ? 'b' : 'a';
  await waitPhase(H, 'hide', 20000);
  await waitPhase(Sk, 'hide', 5000);
  let sH = await st(H); const sS = await st(Sk);
  assert(sH.phase.round === round && sS.phase.round === round, `round ${round}: both in the hide phase`);
  assert(sS.blind && await Sk.isVisible('.chm-blind'), `round ${round}: seeker is blindfolded (${sk})`);
  assert(!sS.visible[hider], `round ${round}: the hider is not drawn on the seeker's screen`);
  const result = {};
  if (style === 'full') {
    // joystick walk
    const box = await surfaceBox(H);
    const before = sH.bodies[hider];
    await touchHold(H, box[0] + 80, box[1] + box[3] - 150, box[0] + 80, box[1] + box[3] - 196, 900);
    sH = await st(H);
    const moved = Math.hypot(sH.bodies[hider].x - before.x, sH.bodies[hider].z - before.z);
    assert(moved > 0.4, `round ${round}: hider walked ${moved.toFixed(2)} m with the joystick`);
    // seeker never learned where (presence carries no position while hiding)
    const leak = await Sk.evaluate((w) => window.__cham.partnerPos(w), hider);
    assert(!(await st(Sk)).visible[hider], `round ${round}: still hidden from the seeker after moving (seen at ${leak.map((x) => x.toFixed(1))})`);
    // eyedropper on known surfaces (through the UI)
    await H.click('.chm-acts [data-act="paint"]');
    await wait(700);
    const probes = await hook(H, 'probes');
    for (const pr of probes) {
      const r = await probeTap(H, pr, hider);
      assert(r.hex === r.want && r.dist < 0.08, `eyedropper on "${pr.name}" returns ${r.hex} (want ${r.want}, ${Math.round(r.dist * 100)} cm from the probe)`);
      assert(r.tool === 'brush', 'after picking, the tool flips back to the brush');
    }
    await H.click('.chm-done');
    await wait(200);
    // pose against the wallpaper, paint a stroke, stamp
    const pose = await camoHide(H);
    assert(pose === 'wall', `round ${round}: hider flattened against the wall`);
    await H.click('.chm-acts [data-act="paint"]');
    await wait(800);
    const h0 = await hook(H, 'paintHash', hider);
    await strokeOnBody(H, true);
    await wait(200);
    await H.click('.chm-tool[data-tool="stamp"]');
    await wait(400);
    assert(await hook(H, 'paintHash', hider) !== h0, `round ${round}: brush + stamp changed the hider's texture`);
    await H.click('.chm-done');
    await wait(200);
  } else {
    await camoHide(H);
    await H.click('.chm-acts [data-act="paint"]');
    await wait(500);
    await H.click('.chm-tool[data-tool="stamp"]');
    await wait(300);
    await H.click('.chm-done');
  }
  await H.click('.chm-acts [data-act="ready"]');
  await waitPhase(Sk, 'seek', 20000);
  await waitPhase(H, 'seek', 5000);
  const hh = await hook(H, 'paintHash', hider); const hs = await hook(Sk, 'paintHash', hider);
  assert(hh === hs, `round ${round}: paint texture round-tripped exactly (hash ${hh})`);
  const lastPaint = (await st(H)).lastPaint;
  if (lastPaint) result.paintBytes = lastPaint.b64;
  await wait(400);
  assert((await st(Sk)).visible[hider], `round ${round}: hider visible to the seeker once seeking starts`);
  const bc = await hook(Sk, 'bodyCenter', hider);
  await hook(Sk, 'teleport', bc[0] + 0.3, bc[2] + 2.6, Math.PI);
  if (style === 'full') {
    // a miss leaves a splat both players see
    await hook(Sk, 'aimAt', bc[0] + 1.3, 0, bc[2] + 1.1);
    await wait(200);
    await Sk.click('.chm-acts [data-act="fire"]');
    await H.waitForFunction(() => window.__cham.state().splats >= 1, null, { timeout: 6000 });
    assert((await st(Sk)).splats >= 1 && (await st(H)).splats >= 1, `round ${round}: a miss left a splat on both screens`);
    // chirp scan glints the hider's eyes on both devices
    await Sk.click('.chm-acts [data-act="scan"]');
    await H.waitForFunction((w) => window.__cham.state().glint[w] > 0, hider, { timeout: 5000 });
    assert((await st(Sk)).glint[hider] > 0, `round ${round}: scan glint scheduled on both devices`);
    await wait(500);
  }
  if (style === 'dry') {
    // six misses: out of pellets ends the round, the hider survives outright
    for (let i = 0; i < 6; i++) {
      await hook(Sk, 'aimAt', bc[0] + 1.5 + i * 0.1, 0, bc[2] + 1.2);
      await wait(120);
      await Sk.click('.chm-acts [data-act="fire"]');
      await wait(220);
    }
    await waitPhase(Sk, 'time', 10000);
    await waitPhase(H, 'time', 3000);
    const rec = (await st(Sk)).round.rec;
    assert(rec && !rec.found && rec.outOfPellets && rec.points === Math.floor(FAST.seek / 1000) + 30, `round ${round}: out of pellets → hider survives (+${rec && rec.points})`);
  } else if (style === 'timeout') {
    await waitPhase(Sk, 'time', FAST.seek + 6000);
    await waitPhase(H, 'time', 3000);
    const rec = (await st(H)).round.rec;
    assert(rec && !rec.found, `round ${round}: time ran out, the hider survived (+${rec && rec.points})`);
  } else {
    if (style === 'found') {
      // the hider panics and scurries once: a faint trail shows on both screens
      const p0 = (await st(H)).bodies[hider];
      // (v2: a hider stuck to a wall scurries ALONG the wall; dash away from the sofa)
      await hook(H, 'setLook', -0.6, 0);
      await H.click('.chm-acts [data-act="scurry"]');
      await Sk.waitForFunction(() => window.__cham.state().trails > 0, null, { timeout: 5000 });
      await wait(900);
      const p1 = (await st(H)).bodies[hider];
      const dash = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      assert(dash > 1 && (await st(H)).round.scurried[hider] && (await st(Sk)).round.scurried[hider], `round ${round}: one scurry dashed ${dash.toFixed(1)} m and left a trail the seeker saw`);
      assert(await H.$eval('.chm-acts [data-act="scurry"]', (b) => b.disabled), `round ${round}: the scurry is used up`);
      await wait(400);
      const c2 = await hook(Sk, 'bodyCenter', hider);
      await hook(Sk, 'teleport', c2[0] + 0.9, c2[2] + 1.9, Math.PI);
    }
    await hook(Sk, 'aimAt', ...(await hook(Sk, 'bodyCenter', hider)));
    await wait(250);
    await Sk.click('.chm-acts [data-act="fire"]');
    await waitPhase(Sk, 'found', 8000);
    await waitPhase(H, 'found', 3000);
    const tc = (await st(H)).lastTagCheck;
    assert(tc && tc.ok, `round ${round}: the hider's device confirmed the tag`);
    result.foundAt = (await st(Sk)).round.rec.ms;
  }
  await waitPhase(Sk, 'recap', 8000);
  return result;
}

async function matchSection(port) {
  console.log('\n# two phones: full Hide & Seek match through the UI');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, hide: 45000, maxDpr: 0.45 });
    // start screen: host picks, guest sees it live
    await a.click('[data-lobby="first"][data-v="b"]');
    await b.waitForFunction(() => window.__cham.state().setup.first === 'b', null, { timeout: 5000 });
    assert(await b.isVisible('.chm-wait'), 'guest sees the host setting up');
    assert(!(await b.isVisible('[data-act="start"]')), 'only the host can start');
    await a.click('[data-act="start"]');
    const rounds = [['b', 'full'], ['a', 'dry'], ['b', 'found'], ['a', 'timeout']];
    for (let i = 0; i < rounds.length; i++) {
      const [hider, style] = rounds[i];
      await hsRound(h, { hider, round: i + 1, style });
      const sa = await st(a); const sb = await st(b);
      assert(JSON.stringify(sa.match.scores) === JSON.stringify(sb.match.scores), `after round ${i + 1}: both agree on scores ${JSON.stringify(sa.match.scores)}`);
      if (i === 0) {
        assert(await a.isVisible('.chm-recap') && await b.isVisible('.chm-recap'), 'recap card on both');
        // swap: the next round's roles
        await b.click('[data-act="next"]');
      }
    }
    await a.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 20000 });
    await b.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 20000 });
    assert(true, 'end card shows on both phones');
    await wait(500);
    assert(h.results().length === 1, `result recorded once (${JSON.stringify(h.results()[0])})`);
    // phase sync: both devices flip within 50 ms
    const la = await hook(a, 'phaseLog'); const lb = await hook(b, 'phaseLog');
    const skews = [];
    const detail = [];
    for (const x of la) { const y = lb.find((q) => q.seq === x.seq); if (y && x.name !== 'lobby') { skews.push(Math.abs(x.wall - y.wall)); detail.push(`${x.name}:${Math.round(x.wall - y.wall)}(late ${Math.round(x.late)}/${Math.round(y.late)})`); } }
    console.log('  ' + detail.join(' '));
    skews.sort((p, q) => p - q);
    const med = skews[Math.floor(skews.length / 2)]; const mx = skews[skews.length - 1];
    // what the netcode controls: both devices schedule each switch for the same shared instant,
    // and their shared clocks agree (clock = shared now − wall time at the switch)
    const clockErr = la.map((x) => { const y = lb.find((q) => q.seq === x.seq); return y ? Math.abs(x.clock - y.clock) : 0; });
    const ce = Math.max(...clockErr);
    const lates = la.concat(lb).map((x) => x.late).sort((p, q) => p - q);
    console.log(`  phase switches: ${skews.length}, measured skew median ${med.toFixed(1)} ms, max ${mx.toFixed(1)} ms; shared-clock disagreement ≤ ${ce.toFixed(1)} ms; main-thread lateness median ${lates[Math.floor(lates.length / 2)].toFixed(0)} ms (CPU load ${require('os').loadavg()[0].toFixed(1)} on ${require('os').cpus().length} cores)`);
    assert(ce < 20, `both devices put every phase change at the same shared instant (clocks agree within ${ce.toFixed(1)} ms)`);
    assert(med <= 50, `phase changes land within 50 ms of each other on both devices (median ${med.toFixed(1)} ms)`);
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'match-FAIL-a').catch(() => {}); await shot(b, 'match-FAIL-b').catch(() => {});
    try { console.error(JSON.stringify(await st(a)).slice(0, 1200)); console.error(JSON.stringify(await st(b)).slice(0, 1200)); } catch { /* ignore */ }
  } finally { await h.close(); }
}

async function buzzerSection(port) {
  console.log('\n# two phones: a tag fired just before the seek clock runs out still counts');
  const h = await launch({ port, only: ['chameleon'], latency: 80 });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, seek: 14000, maxDpr: 0.4 });
    // a phone held sideways: the whole lobby card fits, Start included (no scrolling inside it)
    await a.setViewportSize({ width: 844, height: 390 });
    await wait(600);
    const fit = await a.evaluate(() => { const c = document.querySelector('.chm-lobby .chm-card'); const s = document.querySelector('[data-act="start"]').getBoundingClientRect(); return { over: c.scrollHeight - c.clientHeight, startIn: s.bottom <= innerHeight }; });
    assert(fit.over <= 1 && fit.startIn, `landscape lobby fits the screen (overflow ${fit.over}px)`);
    await shot(a, 'lobby-landscape-844');
    await a.setViewportSize({ width: 390, height: 844 });
    await wait(300);
    await a.click('[data-lobby="first"][data-v="b"]');
    await b.waitForFunction(() => window.__cham.state().setup.first === 'b', null, { timeout: 5000 });
    await a.click('[data-act="start"]');
    await waitPhase(b, 'hide', 20000);
    await camoHide(b);
    await b.click('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 20000); await waitPhase(b, 'seek', 5000);
    await wait(400);
    const bc = await hook(a, 'bodyCenter', 'b');
    await hook(a, 'teleport', bc[0] + 0.3, bc[2] + 2.6, Math.PI);
    await hook(a, 'aimAt', ...(await hook(a, 'bodyCenter', 'b')));
    // the seeker (the host here) fires 150 ms before the buzzer: the hider's device confirms
    // after it, and the host must still count it instead of having already called time
    const left = await a.evaluate(() => new Promise((res) => {
      const tick = () => { const s = window.__cham.state(); const l = s.phase.end - s.now; if (l <= 150) { window.__cham.action('fire'); res(l); } else setTimeout(tick, 5); };
      tick();
    }));
    await waitPhase(a, 'found', 6000).catch(() => {});
    const sa = await st(a); const sb = await st(b);
    assert(sa.phase.name === 'found' && sa.round.rec && sa.round.rec.found, `a tag fired ${Math.round(left)} ms before the buzzer counts (phase ${sa.phase.name})`);
    await waitPhase(b, 'found', 3000);
    assert(sb.lastTagCheck && sb.lastTagCheck.ok, "the hider's device confirmed it");
    const fired = (await st(a)).round.used.a;
    await a.evaluate(() => window.__cham.action('fire'));
    assert((await st(a)).round.used.a === fired, 'no more shots once the round is over');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'buzzer-FAIL-a').catch(() => {}); await shot(b, 'buzzer-FAIL-b').catch(() => {});
  } finally { await h.close(); }
}

async function lossySection(port) {
  console.log('\n# lossy network (20% drops, 90 ms latency): paint round trip + phase sync');
  const h = await launch({ port, only: ['chameleon'], dropRate: 0.2, latency: 90 });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, maxDpr: 0.4 });
    await a.click('[data-lobby="first"][data-v="a"]');
    await a.click('[data-act="start"]');
    await waitPhase(a, 'hide', 20000);
    await camoHide(a);
    // a busy, high-entropy paint job: stamp, then brush blotches in several colours
    await a.click('.chm-acts [data-act="paint"]');
    await wait(600);
    await a.click('.chm-tool[data-tool="stamp"]');
    for (const rgb of [[200, 40, 60], [30, 160, 90], [240, 200, 40]]) { await hook(a, 'setPaint', { rgb, size: 0, hard: false }); await strokeOnBody(a, true); }
    await a.click('.chm-done');
    await a.click('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 30000);
    await waitPhase(a, 'seek', 10000);
    const ha = await hook(a, 'paintHash', 'a'); const hb = await hook(b, 'paintHash', 'a');
    const lp = (await st(a)).lastPaint;
    assert(ha === hb, `paint round-trips exactly through 20% packet loss (${lp.b64} chars of base64 in ${lp.chunks} chunk(s))`);
    const la = await hook(a, 'phaseLog'); const lb = await hook(b, 'phaseLog');
    const sk = la.map((x) => { const y = lb.find((q) => q.seq === x.seq); return y ? Math.abs(x.wall - y.wall) : null; }).filter((x) => x != null);
    console.log(`  phase skews under loss: ${sk.map((x) => x.toFixed(0)).join(', ')} ms`);
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'lossy-FAIL-a').catch(() => {}); await shot(b, 'lossy-FAIL-b').catch(() => {});
  } finally { await h.close(); }
}

async function doubleBlindSection(port) {
  console.log('\n# Double Blind round');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, maxDpr: 0.45 });
    await a.click('[data-lobby="mode"][data-v="db"]');
    await b.waitForFunction(() => window.__cham.state().setup.mode === 'db', null, { timeout: 5000 });
    await a.click('[data-act="start"]');
    await waitPhase(a, 'hide', 20000); await waitPhase(b, 'hide', 5000);
    let sa = await st(a); let sb = await st(b);
    assert(!sa.blind && !sb.blind, 'both players hide at the same time');
    assert(!sa.visible.b && !sb.visible.a, 'neither can see the other while hiding');
    // a hides on the wallpaper, b stays near its spawn crouched
    await camoHide(a);
    await hook(b, 'setPose', 'crouch');
    await a.click('.chm-acts [data-act="ready"]');
    await wait(400);
    assert((await st(a)).phase.name === 'hide', 'one player ready is not enough');
    await b.click('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 20000); await waitPhase(b, 'seek', 5000);
    assert(await hook(a, 'paintHash', 'b') === await hook(b, 'paintHash', 'b') && await hook(a, 'paintHash', 'a') === await hook(b, 'paintHash', 'a'), 'both paint jobs synced both ways');
    // slow movement once seeking starts
    const box = await surfaceBox(b);
    const before = (await st(b)).bodies.b;
    await touchHold(b, box[0] + 80, box[1] + box[3] - 150, box[0] + 80, box[1] + box[3] - 196, 900);
    const after = (await st(b)).bodies.b;
    const mv = Math.hypot(after.x - before.x, after.z - before.z);
    assert(mv > 0.15 && mv < 1.6, `movement is slow while seeking (${mv.toFixed(2)} m in ~1 s)`);
    sa = await st(a);
    assert(sa.round.pellets.a === 5 && sa.round.pellets.b === 5, 'each player has 5 pellets');
    // b tags a
    const bc = await hook(b, 'bodyCenter', 'a');
    await hook(b, 'teleport', bc[0] + 0.3, bc[2] + 2.4, Math.PI);
    await hook(b, 'aimAt', ...(await hook(b, 'bodyCenter', 'a')));
    await wait(250);
    await b.click('.chm-acts [data-act="fire"]');
    await waitPhase(a, 'found', 8000); await waitPhase(b, 'found', 3000);
    sb = await st(b);
    assert(sb.round.rec.winner === 'b' && sb.match.scores.b === 1, 'first tag wins the round for the tagger');
    await waitPhase(a, 'recap', 8000);
    assert(await a.isVisible('.chm-recap') && /wins the round/.test(await a.textContent('.chm-recap h2')), 'recap names the round winner');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'db-FAIL-a').catch(() => {}); await shot(b, 'db-FAIL-b').catch(() => {});
    try { console.error(JSON.stringify(await st(a)).slice(0, 1200)); } catch { /* ignore */ }
  } finally { await h.close(); }
}

async function disconnectSection(port) {
  console.log('\n# disconnect + resume');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, seek: 40000, maxDpr: 0.45 });
    await a.click('[data-lobby="first"][data-v="b"]');
    await a.click('[data-act="start"]');
    await waitPhase(b, 'hide', 20000);
    await camoHide(b);
    await b.click('.chm-acts [data-act="paint"]'); await wait(500);
    await b.click('.chm-tool[data-tool="stamp"]'); await b.click('.chm-done');
    await b.click('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 20000);
    await wait(1500);
    const hiderHash = await hook(b, 'paintHash', 'b');
    const spot = (await st(b)).bodies.b;
    const remBefore = (await st(a)).phase.end - (await st(a)).now;
    // Sydney's app closes mid-hunt
    await h.closeGame(b);
    await a.waitForFunction(() => !!window.__cham.state().paused, null, { timeout: 8000 });
    const pa = await st(a);
    assert(pa.paused && pa.paused.reason === 'away', 'host pauses when the partner drops');
    await wait(2500);
    const remPaused = (await st(a)).paused.remaining;
    assert(Math.abs(remPaused - pa.paused.remaining) < 1, 'the seek timer is frozen while paused');
    // she comes back (fresh mount = new session) and the match resumes from a snapshot
    await arm(b, { ...FAST, seek: 40000, maxDpr: 0.45 });
    await h.startLive(b, 'chameleon', 'live');
    await waitLinked(b);
    await b.waitForFunction(() => window.__cham.state().match && window.__cham.state().phase.name === 'seek', null, { timeout: 15000 });
    const sb = await st(b);
    assert(sb.resumeAt > sb.now || !sb.paused, 'a resume countdown runs on the returning device');
    await a.waitForFunction(() => !window.__cham.state().paused, null, { timeout: 10000 });
    await wait(FAST.resume + 400);
    const sa2 = await st(a); const sb2 = await st(b);
    assert(!sa2.paused && !sb2.paused && sa2.phase.name === 'seek' && sb2.phase.name === 'seek', 'both back in the seek phase');
    const remA = sa2.phase.end - sa2.now; const remB = sb2.phase.end - sb2.now;
    assert(Math.abs(remA - remB) < 400 && remA > 20000 && remA <= remPaused + 50 && remPaused <= remBefore + 50, `timers agree after resuming and continue from the frozen ${(remPaused / 1000).toFixed(1)} s (${(remA / 1000).toFixed(1)} s vs ${(remB / 1000).toFixed(1)} s left)`);
    assert(await hook(b, 'paintHash', 'b') === hiderHash, 'the returning hider got her paint back from the snapshot');
    const back = sb2.bodies.b;
    assert(Math.hypot(back.x - spot.x, back.z - spot.z) < 0.2, 'and her hiding spot');
    assert(sb2.epoch >= 1 && sa2.epoch >= 2, `the link re-handshaked (epochs ${sa2.epoch}/${sb2.epoch})`);
    // the hunt still works after resuming
    await hook(a, 'aimAt', ...(await hook(a, 'bodyCenter', 'b')));
    await hook(a, 'teleport', back.x + 0.3, back.z + 2.5, Math.PI);
    await hook(a, 'aimAt', ...(await hook(a, 'bodyCenter', 'b')));
    await wait(300);
    await a.click('.chm-acts [data-act="fire"]');
    await waitPhase(b, 'found', 8000);
    assert(true, 'a tag after resuming is confirmed');
    // now the HOST reloads mid-round: the fresh host restores the match from the guest's snapshot
    await waitPhase(b, 'hide', 20000);
    const roundB = (await st(b)).phase.round; const scoresB = JSON.stringify((await st(b)).match.scores);
    await h.closeGame(a);
    await wait(1500);
    await arm(a, { ...FAST, seek: 40000, maxDpr: 0.45 });
    await h.startLive(a, 'chameleon', 'live');
    await waitLinked(a);
    await a.waitForFunction(() => window.__cham.state().match && window.__cham.state().phase.name === 'hide', null, { timeout: 15000 });
    await a.waitForFunction(() => !window.__cham.state().paused && window.__cham.state().resumeAt < window.__cham.state().now, null, { timeout: 15000 });
    const sa3 = await st(a); const sb3 = await st(b);
    assert(sa3.phase.round === roundB && JSON.stringify(sa3.match.scores) === scoresB && sa3.isHost, `a reloaded host restores round ${roundB} and the scores ${scoresB} from the guest`);
    assert(Math.abs((sa3.phase.end - sa3.now) - (sb3.phase.end - sb3.now)) < 500, 'and both timers line up again');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'dc-FAIL-a').catch(() => {}); await shot(b, 'dc-FAIL-b').catch(() => {});
    try { console.error(JSON.stringify(await st(a)).slice(0, 1500)); console.error(JSON.stringify(await st(b)).slice(0, 1500)); } catch { /* ignore */ }
  } finally { await h.close(); }
}

async function robustSection(port) {
  console.log('\n# iPhone 13 profile: perf, context loss/restore, visibility pause');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await arm(a, { ...FAST, hide: 60000, maxDpr: 2 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await a.click('[data-act="start"]');
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(1500);
    await hook(a, 'resetPerf');
    await wait(4000);
    const pf = await hook(a, 'perf');
    const bench = await hook(a, 'bench', 20);
    const js = bench.simulate + bench.animate + bench.cameras + bench.fx + bench.ui;
    console.log(`  frame time p50 ${pf.p50.toFixed(1)} ms, p95 ${pf.p95.toFixed(1)} ms over ${pf.n} frames (software GL); draw calls ${pf.calls}, triangles ${pf.tris}, dpr ${pf.dpr.toFixed(2)} (scale ${pf.scale.toFixed(2)}), programs ${pf.programs}, textures ${pf.textures}, geometries ${pf.geometries}`);
    console.log(`  JS per frame: ${js.toFixed(2)} ms (+ render submit ${bench.render.toFixed(2)} ms)`);
    assert(pf.calls > 0 && pf.calls < 80, `draw calls under 80 (${pf.calls})`);
    assert(js < 6, `game logic stays cheap per frame (${js.toFixed(2)} ms)`);
    assert(pf.dpr <= 2, 'pixel ratio capped at 2');
    // context loss + restore
    const before = await hook(a, 'paintHash', 'b');
    await a.evaluate(() => { const gl = window.__cham.gl(); window.__loseExt = gl.getExtension('WEBGL_lose_context'); window.__loseExt.loseContext(); });
    await a.waitForFunction(() => window.__cham.ctxLost(), null, { timeout: 5000 });
    await wait(300);
    assert(await a.isVisible('[data-act="ctxresume"]'), 'context lost → "Tap to resume" card');
    assert((await st(a)).paused, 'the game pauses while the GPU context is gone');
    await a.evaluate(() => window.__loseExt.restoreContext());
    await a.waitForFunction(() => !window.__cham.ctxLost(), null, { timeout: 8000 });
    await a.click('[data-act="ctxresume"]');
    await wait(FAST.resume + 600);
    const r0 = (await hook(a, 'perf')).renders;
    await wait(800);
    const pf2 = await hook(a, 'perf');
    assert(pf2.renders > r0 && pf2.calls > 0, `rendering resumed after restore (${pf2.calls} draw calls)`);
    assert(await hook(a, 'paintHash', 'b') === before && !(await st(a)).paused, 'paint texture survived (re-uploaded from the CPU copy) and play resumed');
    // visibility: pause while hidden, resume with a countdown
    const end0 = (await st(a)).phase.end;
    await a.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const r1 = (await hook(a, 'perf')).renders;
    await wait(2000);
    const sh = await st(a);
    assert(sh.paused && sh.paused.reason === 'hidden', 'hidden page → paused');
    assert((await hook(a, 'perf')).renders === r1, 'no frames rendered while hidden');
    await a.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await wait(300);
    const sv = await st(a);
    assert(!sv.paused && sv.resumeAt > sv.now && sv.phase.end > end0 + 1500, 'visible again → resume countdown, timer extended by the pause');
    await shot(a, 'robust-resume-countdown');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'robust-FAIL').catch(() => {});
  } finally { await h.close(); }
}

async function leakSection(port) {
  console.log('\n# no leaks after opening and closing 5 times');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    const cdp = await a.context().newCDPSession(a);
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await wait(200); await cdp.send('HeapProfiler.collectGarbage'); return a.evaluate(() => performance.memory.usedJSHeapSize); };
    const counts = [];
    for (let i = 0; i < 5; i++) {
      await arm(a, { ...FAST, maxDpr: 0.5 });
      await h.startLive(a, 'chameleon', 'local');
      await waitReady(a);
      await a.click('[data-act="start"]');
      await a.click('[data-act="curtain"]');
      await waitPhase(a, 'hide');
      await wait(400);
      await h.closeGame(a);
      await wait(400);
      const c = await a.evaluate(() => ({ inst: window.__chamCount || 0, gl: window.__chamGL || 0, hook: !!window.__cham, nodes: document.querySelectorAll('.chm').length, canvases: document.querySelectorAll('canvas').length }));
      counts.push(c);
      if (i === 0) counts.heap0 = await heap();
    }
    const heap5 = await heap();
    const last = counts[counts.length - 1];
    assert(counts.every((c) => c.inst === 0 && c.gl === 0 && !c.hook && c.nodes === 0 && c.canvases === 0), 'every close tears down the instance, renderer, hook, DOM and canvas');
    const growth = (heap5 - counts.heap0) / 1048576;
    console.log(`  JS heap after 1st close ${(counts.heap0 / 1048576).toFixed(1)} MB, after 5th ${(heap5 / 1048576).toFixed(1)} MB (${growth >= 0 ? '+' : ''}${growth.toFixed(2)} MB)`);
    assert(growth < 3, 'JS heap does not grow across 5 open/close cycles');
    void last;
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
  } finally { await h.close(); }
}

async function mapsSection(port) {
  console.log('\n# every diorama: spawns, hiding walls, eyedropper probes, lobby sync of the map choice (settings sheet)');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, maxDpr: 0.45 });
    const ids = await hook(a, 'mapIds');
    await a.click('.chm-lobby [data-act="settings"]');
    for (const id of ids.slice(1).concat(ids[0])) {
      await a.click(`.chm-sheet .chm-mapchips [data-lobby="map"][data-v="${id}"]`);
      await b.waitForFunction((m) => window.__cham.state().mapId === m, id, { timeout: 20000 });
      assert(true, `host picked the ${id} map and the guest's diorama switched with it`);
      await wait(400);
      if (id === ids[0] || id === 'house') await shot(a, `map-sheet-${id}`);
      const r = await hook(a, 'checkMap', id);
      const bad = Object.entries(r.spawns).filter(([, d]) => d > 0.02);
      assert(!bad.length, `${id}: every spawn is clear of props (${Object.keys(r.spawns).length} checked)${bad.length ? ' ' + JSON.stringify(bad) : ''}`);
      const badHuge = Object.entries(r.spawnsHuge).filter(([, d]) => d > 0.05);
      if (badHuge.length) console.log(`  note: ${id}: ${badHuge.length} spawn(s) get nudged for a Huge chameleon: ${badHuge.map(([k, d]) => `${k} ${d.toFixed(2)} m`).join(', ')}`);
      if (r.camoWall !== null || ids.indexOf(id) < 3) assert(!!r.camoWall, `${id}: the suggested hiding spot has a wall to flatten against`);
      for (const p of r.probes) assert(p.got === p.want, `${id}: probe "${p.name}" albedo ${p.got} (want ${p.want})`);
      console.log(`  ${id}: ${r.verts} vertices, ${Math.round(r.tris)} triangles, ${r.chunks} chunk(s), ${r.colliders} colliders, atlas ${r.atlasUsed}/${r.atlasH} px`);
    }
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'maps-FAIL').catch(() => {});
  } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
// v2: sticky feet, sizes, settings, big maps
const SLOW = { ...FAST, hide: 90000, seek: 60000, maxDpr: 0.45 };

/** Hold the joystick straight up for ms (touch). */
async function stickUp(p, ms) {
  const box = await surfaceBox(p);
  await touchHold(p, box[0] + 80, box[1] + box[3] - 150, box[0] + 80, box[1] + box[3] - 200, ms);
}

async function crawlSection(port) {
  console.log('\n# sticky feet: walk into a wall, crawl up onto the rafter (ceiling), back down; orientation on the partner; a tag on a ceiling hider');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, SLOW);
    await hook(a, 'setRules', { map: 'living', first: 'b', rules: { size: 'large', climb: true } });
    await b.waitForFunction(() => window.__cham.state().setup.first === 'b' && window.__cham.state().setup.rules.size === 'large', null, { timeout: 5000 });
    await a.click('[data-act="start"]');
    await waitPhase(b, 'hide', 20000);
    // walk into the left wall (camera turned so "forward" is -x), holding the stick: the feet stick
    await hook(b, 'teleport', -4.25, 2.35, -Math.PI / 2, 0);
    await hook(b, 'setCam', Math.PI / 2, 0.25, 2.3);
    await wait(300);
    await stickUp(b, 520);
    let bb = await hook(b, 'body');
    assert(bb.at && (near([bb.nx, bb.ny, bb.nz], [1, 0, 0], 0.01) || bb.ny < -0.9), `walking into the wall with forward held sticks to it (normal ${fmt3([bb.nx, bb.ny, bb.nz])}, y ${bb.y.toFixed(2)})`);
    // crawl up with the same stick: screen-relative, so "up the screen" is up the wall
    const y0 = bb.y;
    await stickUp(b, 1500);
    bb = await hook(b, 'body');
    assert(bb.at && (bb.ny < -0.9 || bb.y > y0 + 1.0), `pushing up the screen crawls up the wall (y ${y0.toFixed(2)} → ${bb.y.toFixed(2)}, normal ${fmt3([bb.nx, bb.ny, bb.nz])})`);
    if (bb.ny > -0.9) { const r = await hook(b, 'crawl', 0, 1.5, 0, 60); bb = await hook(b, 'body'); void r; }
    assert(bb.ny < -0.9 && bb.y > 2.3, `the wall turns into the rafter's underside: upside down at y ${bb.y.toFixed(2)} (normal ${fmt3([bb.nx, bb.ny, bb.nz])})`);
    await wait(500);
    let d = (await st(b)).drawn.b;
    assert(dot(d.up, [0, -1, 0]) > 0.95, `drawn upside down on the hider's own screen (up ${fmt3(d.up)})`);
    // along the beam, back to the wall, down to the floor: walking again
    let r = await hook(b, 'crawl', -1.4, 0, 0, 40);
    assert(r.at && r.n[0] > 0.9, `crawling back along the beam turns down onto the wall (normal ${fmt3(r.n)})`);
    r = await hook(b, 'crawl', 0, -1.4, 0, 90);
    bb = await hook(b, 'body');
    assert(!bb.at && bb.onGround && bb.y < 0.05, `down the wall onto the floor: feet on the ground and walking again (y ${bb.y.toFixed(2)})`);
    await shot(b, 'v2-crawl-hider-floor');
    // and back up for the hunt: stick (button), crawl up, hang
    await hook(b, 'teleport', -4.55, 2.35, -Math.PI / 2, 0);
    await b.click('.chm-acts [data-act="stick"]');
    bb = await hook(b, 'body');
    assert(bb.at && bb.nx > 0.9, 'the Stick button grabs the nearest wall');
    assert(await b.isVisible('.chm-acts [data-act="stick"].on'), 'Stick shows as on (Let go)');
    await hook(b, 'crawl', 0, 1.5, 0, 60);
    await hook(b, 'crawl', 1.4, 0, 0, 25);
    bb = await hook(b, 'body');
    await b.click('.chm-acts [data-act="poses"]');
    await wait(400);
    assert(await b.isVisible('.chm-pose[data-pose="hang"]'), 'the pose bar offers Hang under a ceiling');
    await b.click('.chm-pose[data-pose="hang"]');
    await wait(600);
    assert((await hook(b, 'body')).pose === 'hang', 'hanging from the rafter');
    await shot(b, 'v2-hang-hider');
    await b.click('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 20000); await waitPhase(b, 'seek', 5000);
    await wait(800);
    // the seeker's device draws her upside down, where she is, from her published orientation
    bb = await hook(b, 'body');
    const sa = await st(a);
    d = sa.drawn.b;
    assert(sa.rem.at === 1 && dot(d.up, [0, -1, 0]) > 0.95 && near(d.p, [bb.x, bb.y, bb.z], 0.08), `on the seeker's screen she hangs upside down at ${fmt3(d.p)} (up ${fmt3(d.up)}, true ${fmt3([bb.x, bb.y, bb.z])})`);
    assert(d.pose === 'hang' && Math.abs(d.scale - 1.3) < 1e-6, 'with the same pose and size');
    // look up and fire
    await hook(a, 'teleport', bb.x + 1.0, bb.z + 0.7, 0, 0);
    const bc = await hook(a, 'bodyCenter', 'b');
    const aim = await hook(a, 'aimAt', ...bc);
    assert(aim.pitch > 0.45, `the seeker looks up at the ceiling (pitch ${aim.pitch.toFixed(2)} rad)`);
    await wait(300);
    await shot(a, 'v2-seeker-looks-up');
    await a.click('.chm-acts [data-act="fire"]');
    await waitPhase(a, 'found', 8000); await waitPhase(b, 'found', 3000);
    assert((await st(b)).lastTagCheck.ok, 'a pellet tags a hider on the ceiling (confirmed by her device)');
    await waitPhase(a, 'recap', 8000);
    await wait(600);
    const head = await a.textContent('.chm-recap h2');
    assert(/CEILING|HANGING/.test(head), `recap: "${head}"`);
    await shot(a, 'v2-recap-ceiling');
    // round 2: Emerson hides flat on the back wall, then tongue-zips down to the floor while hunted
    // (the recap may already have run out on a slow machine: then the next round started by itself)
    if ((await st(b)).phase.name === 'recap') await b.click('[data-act="next"]', { timeout: 4000 }).catch(() => {});
    await waitPhase(a, 'hide', 20000);
    const camo = (await hook(a, 'spots')).camo;
    await hook(a, 'teleport', camo.x, camo.z - 0.1, 0, 0);
    assert(await hook(a, 'setPose', 'wall') === 'wall', 'round 2: pressed flat on the wallpaper');
    await hook(a, 'crawl', 0, 1.0, 0, 25);
    const ab = await hook(a, 'body');
    await a.click('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 20000); await waitPhase(a, 'seek', 5000);
    await wait(800);
    let sb = await st(b);
    assert(dot(sb.drawn.a.up, [0, 0, 1]) > 0.95 && near(sb.drawn.a.p, [ab.x, ab.y, ab.z], 0.08), `the partner draws him on the wall facing out (up ${fmt3(sb.drawn.a.up)})`);
    // zip: look straight down, the tongue grabs the floor
    await hook(a, 'setLook', 0, -1.1);
    await wait(100);
    const zipped = await hook(a, 'zip');
    assert(zipped, 'tongue-zip fired (uses an escape)');
    await b.waitForFunction(() => window.__cham.state().trails > 0, null, { timeout: 5000 });
    await wait(1200);
    const ab2 = await hook(a, 'body');
    sb = await st(b);
    assert(!ab2.at && ab2.y < 0.05 && dot(sb.drawn.a.up, [0, 1, 0]) > 0.95 && near(sb.drawn.a.p, [ab2.x, ab2.y, ab2.z], 0.08), `back down on the floor, upright on both screens (partner sees up ${fmt3(sb.drawn.a.up)})`);
    assert(sb.round.escapes.a === (sb.rules.escapes - 1) && sb.trails > 0, `the zip left a trail on the seeker's screen and used an escape (${sb.round.escapes.a} left)`);
    h.assertNoErrors();
    assert(!h.warnings.length, `message budget respected (${h.warnings.length} warnings)`);
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'crawl-FAIL-a').catch(() => {}); await shot(b, 'crawl-FAIL-b').catch(() => {});
    try { console.error(JSON.stringify(await hook(b, 'body')).slice(0, 600)); } catch { /* ignore */ }
  } finally { await h.close(); }
}

async function sizeSection(port) {
  console.log('\n# chameleon size: every setting changes the body, collider and hit radius on both devices');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, SLOW);
    const want = { tiny: 0.6, small: 0.8, medium: 1.0, large: 1.3, huge: 1.8 };
    for (const [id, s] of Object.entries(want)) {
      await a.click(`.chm-lobby .chm-card > .chm-col .chm-sizes [data-v="${id}"]`);
      await b.waitForFunction((v) => window.__cham.state().setup.rules.size === v, id, { timeout: 5000 });
      await wait(200);
      const za = await hook(a, 'sizes'); const zb = await hook(b, 'sizes');
      const ok = [za, zb].every((z) => ['a', 'b'].every((w) => Math.abs(z[w].r - 0.24 * s) < 1e-9 && Math.abs(z[w].scale - s) < 1e-9 && Math.abs(z[w].head - 0.34 * s) < 1e-9 && Math.abs(z[w].step - Math.max(0.2, 0.24 * s)) < 1e-9));
      assert(ok && Math.abs(za.tagTol - zb.tagTol) < 1e-9 && Math.abs(za.tagTol - 0.75 * Math.max(1, s)) < 1e-9, `${id}: radius ${(0.24 * s).toFixed(3)} m, scale ${s}, head ${(0.34 * s).toFixed(2)} m, hit tolerance ${za.tagTol.toFixed(2)} m on both devices`);
    }
    await shot(a, 'v2-size-huge-lobby');
    // squeeze is the same tiny profile at every size
    await a.click('.chm-lobby .chm-card > .chm-col .chm-sizes [data-v="large"]');
    await b.waitForFunction(() => window.__cham.state().setup.rules.size === 'large', null, { timeout: 5000 });
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'size-FAIL-a').catch(() => {});
  } finally { await h.close(); }
}

async function settingsSection(port) {
  console.log('\n# game settings: presets, live sync to the guest, validation, persistence, the match plays by them');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, SLOW);
    // presets
    await a.click('.chm-lobby .chm-presets [data-v="easy"]');
    await b.waitForFunction(() => window.__cham.state().setup.rules.preset === 'easy', null, { timeout: 5000 });
    let rb = (await st(b)).setup.rules;
    assert(rb.size === 'huge' && rb.pellets === 8 && rb.blink === 'strong' && rb.heartbeat === false && rb.minimap === true, 'Easy preset applied on the guest (huge, 8 pellets, strong blinks, no heartbeat)');
    assert(await b.isVisible('.chm-presets button.on[data-v="easy"]'), 'guest sees Easy selected');
    // the settings sheet: host edits, guest watches live
    await a.click('.chm-lobby [data-act="settings"]');
    await b.click('.chm-lobby [data-act="settings"]');
    await a.waitForSelector('.chm-sheet');
    await b.waitForSelector('.chm-sheet');
    assert(await b.$eval('.chm-sheet [data-k="hide"][data-step="1"]', (x) => x.disabled), "the guest's controls are read-only");
    await a.click('.chm-sheet [data-k="hide"][data-step="1"]');
    await b.waitForFunction(() => window.__cham.state().setup.rules.hide === 50, null, { timeout: 5000 });
    assert((await b.textContent('.chm-sheet [data-rule="hide"]')).trim() === '50 s', "the guest's open sheet shows the new hide time live (45 s → 50 s: 5 s steps)");
    rb = (await st(b)).setup.rules;
    assert(rb.preset === 'custom' && await a.isVisible('.chm-sheet .chm-presets button.on.custom'), 'changing one value turns the preset into Custom');
    // scroll the sheet, change something further down, the guest's sheet keeps its scroll
    await a.click('.chm-sheet [data-k="stamp"][data-v="false"]');
    await a.click('.chm-sheet [data-k="climb"][data-v="false"]');
    await a.click('.chm-sheet [data-k="pellets"][data-step="-1"]');
    await a.click('.chm-sheet [data-k="scanCd"][data-step="1"]');
    await a.click('.chm-sheet [data-k="seekSpeed"][data-v="fast"]');
    await b.waitForFunction(() => { const r = window.__cham.state().setup.rules; return r.stamp === false && r.climb === false && r.pellets === 7 && r.seekSpeed === 'fast'; }, null, { timeout: 5000 });
    assert(true, 'stamp off, climbing off, 7 pellets, slower scans, fast seeker: all reached the guest');
    // validation: garbage is snapped to allowed values, identically on both devices
    await hook(a, 'setRules', { rules: { pellets: 999, size: 'gigantic', hide: 47, scans: -3 } });
    await b.waitForFunction(() => window.__cham.state().setup.rules.pellets === 10, null, { timeout: 5000 });
    const ra = (await st(a)).setup.rules; rb = (await st(b)).setup.rules;
    assert(JSON.stringify(ra) === JSON.stringify(rb) && ra.size === 'large' && ra.hide === 45 && ra.scans === 0, `invalid values are snapped (pellets 10, size large, hide 45 s, scans unlimited) and both agree`);
    // Hard preset
    await a.click('.chm-sheet .chm-presets [data-v="hard"]');
    await b.waitForFunction(() => window.__cham.state().setup.rules.preset === 'hard', null, { timeout: 5000 });
    rb = (await st(b)).setup.rules;
    assert(rb.size === 'medium' && rb.minimap === false && rb.blink === 'off' && rb.scans === 3 && rb.escapes === 2, 'Hard preset: medium size, no minimap, no blink glints, 3 scans, 2 escapes');
    await a.click('.chm-sheet [data-k="pellets"][data-step="-1"]'); // custom: 4 pellets
    await b.waitForFunction(() => window.__cham.state().setup.rules.pellets === 4, null, { timeout: 5000 });
    await a.click('.chm-sheet .chm-go[data-act="settings"]');
    // persisted per device: the host reopens the game and gets the same setup
    const keep = JSON.stringify((await st(a)).setup.rules);
    await h.closeGame(a); await h.closeGame(b);
    await wait(600);
    await arm(a, SLOW); await arm(b, SLOW);
    await h.startLive(a, 'chameleon', 'live');
    await h.settle();
    await b.click('#gm-invite [data-g="invite-yes"]');
    await waitLinked(a); await waitLinked(b);
    await wait(800);
    const back = (await st(a)).setup.rules;
    assert(JSON.stringify(back) === keep, `the host's device remembered the last setup (${back.preset}, ${back.pellets} pellets)`);
    await b.waitForFunction((k) => JSON.stringify(window.__cham.state().setup.rules) === k, keep, { timeout: 5000 });
    assert(true, 'and sent it to the guest on connect');
    // the match plays by these rules on both devices
    await a.click('[data-lobby="first"][data-v="b"]');
    await a.click('[data-act="start"]');
    await waitPhase(b, 'hide', 20000);
    const ma = (await st(a)).match; const mb = (await st(b)).match;
    assert(JSON.stringify(ma.rules) === JSON.stringify(mb.rules) && ma.rules.pellets === 4 && ma.rounds === 4, 'both devices hold the same match rules');
    await camoHide(b);
    await b.click('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 20000);
    const sa = await st(a);
    assert(sa.round.pellets.a === 4 && sa.round.scansLeft.a === 3, `the seeker gets 4 pellets and 3 scans (${sa.round.pellets.a}, ${sa.round.scansLeft.a})`);
    assert(!(await a.isVisible('.chm-mini')), 'no minimap in Hard');
    h.assertNoErrors();
    assert(!h.warnings.length, `message budget respected (${h.warnings.length} warnings)`);
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'settings-FAIL-a').catch(() => {}); await shot(b, 'settings-FAIL-b').catch(() => {});
  } finally { await h.close(); }
}

async function togglesSection(port) {
  console.log('\n# rules toggles: stamp off and walls & ceilings off are enforced');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await arm(a, SLOW);
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await a.click('.chm-lobby [data-act="settings"]');
    await a.click('.chm-sheet [data-k="stamp"][data-v="false"]');
    await a.click('.chm-sheet [data-k="climb"][data-v="false"]');
    await a.click('.chm-sheet .chm-go[data-act="settings"]');
    await a.click('[data-lobby="first"][data-v="b"]');
    await a.click('[data-act="start"]');
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(400);
    assert(!(await a.isVisible('.chm-acts [data-act="stick"]')) && !(await a.isVisible('.chm-acts [data-act="zip"]')), 'no Stick or Zip buttons');
    assert(!(await hook(a, 'stick')).at, 'Stick (E) does nothing');
    assert(!(await hook(a, 'zip')), 'tongue-zip refused');
    // walking into a wall holding forward doesn't stick either
    await hook(a, 'teleport', -4.25, 1.6, -Math.PI / 2, 0);
    await hook(a, 'setCam', Math.PI / 2, 0.25, 2.3);
    await wait(200);
    await stickUp(a, 1200);
    let bb = await hook(a, 'body');
    assert(!bb.at && bb.x < -4.6, `walked up to the wall (x ${bb.x.toFixed(2)}) and stayed on the floor`);
    // the classic flat-on-the-wall pose still works, but only slides sideways
    assert(await hook(a, 'setPose', 'wall') === 'wall', 'the flat-on-the-wall pose still works');
    const y0 = (await hook(a, 'body')).y;
    await hook(a, 'crawl', 0, 1.2, 0.4, 30);
    bb = await hook(a, 'body');
    assert(Math.abs(bb.y - y0) < 1e-6 && bb.at && bb.nx > 0.9, `but can't climb (y stays ${bb.y.toFixed(2)})`);
    // stamp off: the tool is gone, and the stamp action is refused
    await a.click('.chm-acts [data-act="paint"]');
    await wait(500);
    assert(!(await a.isVisible('.chm-tool[data-tool="stamp"]')), 'the Stamp tool is hidden');
    const h0 = await hook(a, 'paintHash', 'b');
    await hook(a, 'stampNow');
    await a.keyboard.press('KeyT');
    await wait(200);
    assert(await hook(a, 'paintHash', 'b') === h0, 'stamping is refused (texture unchanged)');
    await shot(a, 'v2-toggles-paint');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'toggles-FAIL').catch(() => {});
  } finally { await h.close(); }
}

/** A hider on a big map: stick to a surface near a spot, ready. Returns the hider's body. */
async function bigHide(p, spot) {
  await hook(p, 'teleport', spot.x, spot.z, spot.yaw || 0, spot.y != null ? spot.y : undefined);
  await wait(200);
  const r = await hook(p, 'stick');
  await p.click('.chm-acts [data-act="ready"]');
  return r;
}

async function bigMatchSection(port) {
  console.log('\n# a full match on the biggest map (2 rounds): random fair spawns, hide on a wall, tag, dry round, end card');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...SLOW, hide: 30000, seek: 30000 });
    const big = await biggestMap(a);
    console.log(`  maps: ${big.list.map((m) => `${m.id} ${Math.round(m.area)} m²`).join(', ')}; biggest: ${big.id}`);
    await hook(a, 'setRules', { map: big.id, first: 'b', rules: { rounds: 2, pellets: 3 } });
    await b.waitForFunction((m) => window.__cham.state().mapId === m, big.id, { timeout: 20000 });
    assert(true, `host picked ${big.id}; the guest loaded it`);
    await a.click('[data-act="start"]');
    await waitPhase(b, 'hide', 30000);
    const sa0 = await st(a); const sb0 = await st(b);
    assert(JSON.stringify(sa0.round.spawn) === JSON.stringify(sb0.round.spawn), `both devices agree on the round's spawns ${JSON.stringify(sb0.round.spawn)}`);
    const spots = await hook(b, 'spots');
    const H = spots.hiderSpawns[sb0.round.spawn.hs];
    const hb = sb0.bodies.b;
    assert(Math.hypot(hb.x - H.x, hb.z - H.z) < 0.6, 'the hider starts at the chosen hider spawn');
    // hide: stick to whatever surface is nearest a spot a few metres away
    const spot = spots.camo ? { x: spots.camo.x, z: spots.camo.z - (spots.camo.wallNormal ? -spots.camo.wallNormal[2] * 0.4 : 0), y: spots.camo.y != null ? Math.max(0, spots.camo.y - 0.6) : undefined } : H;
    const stuck = await bigHide(b, spot);
    console.log(`  hider stuck: ${JSON.stringify(stuck)}`);
    await waitPhase(a, 'seek', 30000); await waitPhase(b, 'seek', 5000);
    await wait(600);
    const hbody = await hook(b, 'body');
    const sa = await st(a);
    const K = spots.seekerSpawns;
    if (K.length > 1) {
      const sk = sa.bodies.a;
      const dists = K.map((p) => Math.hypot(p.x - hbody.x, p.z - hbody.z));
      const at = K.findIndex((p) => Math.hypot(p.x - sk.x, p.z - sk.z) < 0.7);
      assert(at >= 0 && (dists[at] >= 6 || dists[at] === Math.max(...dists)), `the seeker starts at a fair spawn ${dists[at] != null ? dists[at].toFixed(1) : '?'} m from the hider`);
    }
    // the seeker walks over and tags her (stand off along her surface normal)
    const n = [hbody.nx, hbody.ny, hbody.nz];
    const off = Math.abs(n[1]) > 0.7 ? [1.4, 0, 0.6] : [n[0] * 1.8, 0, n[2] * 1.8];
    await hook(a, 'teleport', hbody.x + off[0], hbody.z + off[2], 0, Math.max(0, hbody.y - 1.2) > 2 ? Math.floor(hbody.y / 2.8) * 2.8 : undefined);
    await hook(a, 'aimAt', ...(await hook(a, 'bodyCenter', 'b')));
    await wait(300);
    await shot(a, 'v2-bigmap-seeker');
    await a.click('.chm-acts [data-act="fire"]');
    await waitPhase(a, 'found', 8000);
    assert((await st(a)).round.rec.found, 'tagged on the big map');
    await waitPhase(a, 'recap', 8000);
    await a.click('[data-act="next"]');
    // round 2: Emerson hides, Sydney fires three misses → out of pellets
    await waitPhase(a, 'hide', 20000);
    await camoOr(a);
    await a.click('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 30000);
    for (let i = 0; i < 3; i++) { await hook(b, 'lookAtPitch', -1.2); await wait(120); await b.click('.chm-acts [data-act="fire"]'); await wait(300); }
    await waitPhase(b, 'time', 10000);
    assert((await st(b)).round.rec.outOfPellets, 'round 2: the seeker ran dry, Emerson survived');
    await a.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 30000 });
    await b.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 30000 });
    assert(h.results().length === 1, 'the big-map match ended once on both phones');
    const fa = await st(a); const fb = await st(b);
    assert(JSON.stringify(fa.match.scores) === JSON.stringify(fb.match.scores), `scores agree ${JSON.stringify(fa.match.scores)}`);
    h.assertNoErrors();
    assert(!h.warnings.length, `message budget respected (${h.warnings.length} warnings)`);
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'big-FAIL-a').catch(() => {}); await shot(b, 'big-FAIL-b').catch(() => {});
    try { console.error(JSON.stringify(await st(a)).slice(0, 1200)); } catch { /* ignore */ }
  } finally { await h.close(); }
}
async function camoOr(p) {
  const spots = await hook(p, 'spots');
  if (spots.camo) { await hook(p, 'teleport', spots.camo.x, spots.camo.z - 0.1, 0, spots.camo.y != null ? Math.max(0, spots.camo.y - 0.6) : undefined); return hook(p, 'setPose', 'wall'); }
  return null;
}

async function bigPerfSection(port) {
  console.log('\n# perf on the biggest map (iPhone 13 profile): draw calls, triangles, JS per frame, allocations');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await arm(a, { ...FAST, hide: 120000, seek: 120000, maxDpr: 2 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    const big = await biggestMap(a);
    await hook(a, 'setRules', { map: big.id, first: 'b', rules: { minimap: true } });
    await a.waitForFunction((m) => window.__cham.state().mapId === m, big.id, { timeout: 20000 });
    const ws = await hook(a, 'worldStats');
    console.log(`  ${big.id}: ${ws.chunks} chunks, ${ws.verts} vertices, ${Math.round(ws.tris)} triangles in total (incl. outline hulls), ${ws.boxes} colliders, atlas ${ws.atlasUsed}/${ws.atlasH} px used`);
    await a.click('[data-act="start"]');
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(1200);
    // third person from every hider spawn (different rooms / floors)
    const spots = await hook(a, 'spots');
    let worst = { calls: 0, tris: 0 }; const samples = [];
    const pts = spots.hiderSpawns.concat(spots.seekerSpawns);
    for (const sp of pts) {
      await hook(a, 'teleport', sp.x, sp.z, sp.yaw || 0, sp.y != null ? sp.y : undefined);
      for (const yaw of [0, 2.1, 4.2]) {
        await hook(a, 'setCam', yaw, 0.3, 2.3);
        await wait(450);
        const pf = await hook(a, 'perf');
        samples.push(pf.calls); worst = { calls: Math.max(worst.calls, pf.calls), tris: Math.max(worst.tris, pf.tris) };
      }
    }
    console.log(`  hide (3rd person) over ${samples.length} views: draw calls max ${worst.calls}, triangles max ${worst.tris}`);
    const benchH = await hook(a, 'bench', 20);
    const jsH = benchH.simulate + benchH.animate + benchH.cameras + benchH.fx + benchH.ui;
    await hook(a, 'resetPerf'); await wait(2500);
    const pfH = await hook(a, 'perf');
    // the hunt: first person from every seeker spawn, looking around
    await a.click('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'curtain');
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'seek');
    await wait(1500);
    let worstS = { calls: 0, tris: 0 };
    for (const sp of pts) {
      await hook(a, 'teleport', sp.x, sp.z, sp.yaw || 0, sp.y != null ? sp.y : undefined);
      for (const [yaw, pitch] of [[0, 0], [1.6, 0.2], [3.1, -0.3], [4.7, 1.2]]) {
        await hook(a, 'setLook', yaw, pitch);
        await wait(450);
        const pf = await hook(a, 'perf');
        worstS = { calls: Math.max(worstS.calls, pf.calls), tris: Math.max(worstS.tris, pf.tris) };
      }
    }
    const benchS = await hook(a, 'bench', 20);
    const jsS = benchS.simulate + benchS.animate + benchS.cameras + benchS.fx + benchS.ui;
    // allocations: heap growth over 3 s of play (sampled after GC)
    const cdp = await a.context().newCDPSession(a);
    await cdp.send('HeapProfiler.collectGarbage');
    const m0 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    const f0 = (await hook(a, 'perf')).renders;
    await wait(3000);
    const m1 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    const frames = (await hook(a, 'perf')).renders - f0;
    const pf = await hook(a, 'perf');
    console.log(`  seek (1st person): draw calls max ${worstS.calls}, triangles max ${worstS.tris}; JS per frame hide ${jsH.toFixed(2)} ms, seek ${jsS.toFixed(2)} ms (+ render submit ${benchS.render.toFixed(2)} ms); heap growth ${((m1 - m0) / 1024).toFixed(0)} KB over 3 s / ${frames} frames (${frames ? ((m1 - m0) / frames).toFixed(0) : '?'} B per frame, incl. net + harness); textures ${pf.textures}, geometries ${pf.geometries}, programs ${pf.programs}; frame p50 ${pfH.p50.toFixed(0)} ms in software GL`);
    assert(Math.max(worst.calls, worstS.calls) <= 80, `draw calls ≤ 80 everywhere (${Math.max(worst.calls, worstS.calls)})`);
    assert(Math.max(worst.tris, worstS.tris) <= 150000, `triangles ≤ 150k (${Math.max(worst.tris, worstS.tris)})`);
    assert(Math.max(jsH, jsS) < 4, `game JS per frame stays small (${Math.max(jsH, jsS).toFixed(2)} ms)`);
    await shot(a, 'v2-bigmap-perf-seek');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'bigperf-FAIL').catch(() => {});
  } finally { await h.close(); }
}

async function squeezeSection(port) {
  console.log('\n# squeeze: under the House bed (0.26 m clearance) at every size; no standing up under it');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await arm(a, SLOW);
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    const ids = await hook(a, 'mapIds');
    if (!ids.includes('house')) { console.log('  (no house map: skipped)'); return; }
    await hook(a, 'setRules', { map: 'house', first: 'b' });
    await a.click('[data-act="start"]');
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    const FH = 2.8; const bx = -5.4; const footZ = -3.43;
    for (const size of ['tiny', 'medium', 'huge']) {
      await hook(a, 'forceSize', size);
      await wait(150);
      // walking in upright: blocked by the bed frame (except Tiny, which fits under on its feet)
      await hook(a, 'teleport', bx, footZ + 0.75, Math.PI, FH);
      let r = await hook(a, 'walk', 0, -1.2, 40);
      const under = r.z < footZ - 0.4;
      if (size !== 'tiny') assert(!under, `${size}: upright, the bed stops you (z ${r.z.toFixed(2)})`);
      await hook(a, 'teleport', bx, footZ + 0.75, Math.PI, FH);
      assert(await hook(a, 'setPose', 'squeeze') === 'squeeze', `${size}: squeezed flat`);
      r = await hook(a, 'walk', 0, -1.2, 120);
      assert(r.z < footZ - 0.6 && Math.abs(r.y - FH) < 0.01, `${size}: squeeze-crawled under the bed (z ${r.z.toFixed(2)}, still on the floor)`);
      if (size !== 'tiny') assert(await hook(a, 'setPose', 'stand') === 'squeeze', `${size}: no room to stand up under the bed`);
      if (size === 'huge') { await hook(a, 'setCam', 0.4, 0.2, 2.2); await wait(900); await shot(a, 'v2-squeeze-under-bed'); }
    }
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'squeeze-FAIL').catch(() => {});
  } finally { await h.close(); }
}

async function guardsSection(port) {
  console.log('\n# invisible guards (climb:false): solid for crawlers, never stuck to, ignored by cameras; big-map clocks and overview fog');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await arm(a, { ...SLOW, hide: undefined, seek: undefined });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    const ids = await hook(a, 'mapIds');
    if (!ids.includes('house')) { console.log('  (no house map: skipped)'); return; }
    await hook(a, 'setRules', { map: 'house', first: 'b', rules: { hide: 60, seek: 90 } });
    const eff = await hook(a, 'effTimes');
    const info = (await hook(a, 'mapsInfo')).find((m) => m.id === 'house');
    console.log(`  house (${info.size}): hide ${eff.hide / 1000} s, seek ${eff.seek / 1000} s, sprint ×${eff.sprint.toFixed(2)}`);
    assert(eff.scale > 1 && eff.hide === Math.round(60 * eff.scale / 5) * 5 * 1000 && eff.seek === Math.round(90 * eff.scale / 5) * 5 * 1000, `big map: clocks scaled ×${eff.scale} (hide ${eff.hide / 1000} s, seek ${eff.seek / 1000} s)`);
    await a.click('.chm-lobby [data-act="settings"]');
    const hint = (await a.textContent('.chm-sheet [data-eff="seek"]')).trim();
    assert(/on /.test(hint), `the settings sheet shows the effective seek time ("${hint}")`);
    await shot(a, 'v2-settings-house-times');
    await a.click('.chm-sheet .chm-go[data-act="settings"]');
    await a.click('[data-act="start"]');
    await wait(500);
    const fo = await hook(a, 'fog');
    assert(fo.far > 30, `title orbit pulls the fog back to ${fo.far.toFixed(0)} m`);
    await shot(a, 'v2-house-title-orbit');
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(400);
    const fp = await hook(a, 'fog');
    assert(fp.far <= 26.01, `playing: fog back at ${fp.far} m`);
    const g = (await hook(a, 'guards')).find((x) => /front/.test(x.name)) || (await hook(a, 'guards'))[0];
    assert(!!g, `the map has invisible guards (${g && g.name})`);
    // the inner face of the wall under the guard
    const cx = (g.minX + g.maxX) / 2 + 0.7;
    const wall = await hook(a, 'surfaceAt', cx, 0.3, g.minZ - 1.2, 0, 0, 1, 3);
    assert(wall && wall.n[2] < -0.9, `found the low front wall under it (top ${wall && wall.box.maxY.toFixed(2)} m)`);
    await hook(a, 'attachAt', wall.p[0], 0.3, wall.p[2], 0, 0, -1, 0, 1, 0);
    const r = await hook(a, 'crawl', 0, 1.2, 0, 60);
    const bb = await hook(a, 'body');
    assert(bb.at && bb.nz < -0.9 && bb.y <= wall.box.maxY + 0.01, `crawling up stops at the top of the wall (y ${bb.y.toFixed(2)}), never over it (results ${[...new Set(r.res)].join(',')})`);
    // the tongue can't stick to a guard
    await hook(a, 'teleport', cx, g.minZ - 1.5, 0, 0);
    await hook(a, 'setCam', Math.PI, -0.05, 2.3);
    await wait(500);
    const zipped = await hook(a, 'zip');
    const after = await hook(a, 'body');
    assert(!(zipped && after.at && after.box === null && after.y > 0.75), `a tongue-zip at the guard doesn't stick to it (zip ${zipped})`);
    // the third-person camera looks out through the guard without being pushed in
    await hook(a, 'teleport', cx, g.minZ - 0.6, 0, 0);
    await hook(a, 'setCam', 0, 0.35, 2.3);
    await wait(900);
    const d = await hook(a, 'camDist');
    assert(d > 2.0, `the camera passes through the invisible guard (distance ${d.toFixed(2)} m)`);
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'guards-FAIL').catch(() => {});
  } finally { await h.close(); }
}

/** Screenshots of the settings panel and the new mechanics (one device). */
async function shotsRun(port, { colorScheme, device, viewport, prefix, mechanics }) {
  const h = await launch({ port, only: ['chameleon'], who: ['a'], colorScheme, device });
  const a = h.a;
  try {
    if (viewport) await a.setViewportSize(viewport);
    await arm(a, { ...SHOWCASE, noTips: false });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await a.evaluate(() => { try { localStorage.removeItem('chm.tips.v2'); } catch { /* ignore */ } });
    await wait(1500);
    await shot(a, `${prefix}-lobby`);
    const fit = await a.evaluate(() => { const c = document.querySelector('.chm-lobby .chm-card'); const s = document.querySelector('[data-act="start"]').getBoundingClientRect(); return { over: c.scrollHeight - c.clientHeight, startIn: s.bottom <= innerHeight + 1 }; });
    assert(fit.over <= 1 && fit.startIn, `[${prefix}] lobby fits without scrolling (overflow ${fit.over}px)`);
    await a.click('.chm-lobby [data-act="settings"]');
    await wait(500);
    await shot(a, `${prefix}-settings`);
    const wide = await a.evaluate(() => { const s = document.querySelector('.chm-sheet'); return { sw: s.scrollWidth - s.clientWidth, w: s.getBoundingClientRect().width }; });
    assert(wide.sw <= 1, `[${prefix}] settings sheet has no sideways overflow (${wide.w.toFixed(0)} px wide)`);
    await a.evaluate(() => { const s = document.querySelector('.chm-sheet'); s.scrollTop = s.scrollHeight; });
    await wait(300);
    await shot(a, `${prefix}-settings-end`);
    await a.click('.chm-sheet .chm-go[data-act="settings"]');
    if (!mechanics) { h.assertNoErrors(); return h; }
    await hook(a, 'setRules', { map: 'living', first: 'b', rules: { size: 'large' } });
    await a.click('[data-act="start"]');
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(900);
    await shot(a, `${prefix}-tips`);
    await a.click('[data-act="tips-ok"]');
    // crawling up the left wall, seen from the side
    await hook(a, 'teleport', -4.55, 2.35, -Math.PI / 2, 0);
    await hook(a, 'stick');
    await hook(a, 'crawl', 0, 1.2, 0, 22);
    await hook(a, 'setCam', 0.9, 0.15, 2.4);
    await a.click('.chm-acts [data-act="poses"]');
    await wait(1200);
    await shot(a, `${prefix}-wall-crawl`);
    // up onto the rafter and hang
    await hook(a, 'crawl', 0, 1.2, 0, 60);
    await hook(a, 'crawl', 1.2, 0, 0, 25);
    assert(await hook(a, 'setPose', 'hang') === 'hang', `[${prefix}] hanging from the rafter`);
    await hook(a, 'setCam', 0.5, -0.1, 2.6);
    await wait(1400);
    await shot(a, `${prefix}-ceiling-hang`);
    // perched on the curtain rail (zip-free: place on top of it)
    await hook(a, 'teleport', 2.9, -3.86, 0, 2.095);
    await wait(900);
    await hook(a, 'setCam', 0.35, 0.25, 2.2);
    await wait(900);
    await shot(a, `${prefix}-perch`);
    // squeezed behind the sofa
    await hook(a, 'teleport', 0.3, -3.78, Math.PI / 2, 0);
    await hook(a, 'setPose', 'squeeze');
    await hook(a, 'setCam', 0.4, 0.75, 2.0);
    await wait(1200);
    await shot(a, `${prefix}-squeeze`);
    // tongue-zip in flight toward the floating shelf
    await hook(a, 'teleport', 3.0, -0.3, Math.PI / 2, 0);
    await hook(a, 'setCam', -Math.PI / 2 - 0.25, -0.25, 1.6);
    await wait(900);
    await hook(a, 'zip');
    await wait(140);
    await shot(a, `${prefix}-zip`);
    await wait(900);
    // the hunt on a big map with the minimap
    await a.click('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'curtain');
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'seek');
    await wait(1800);
    await hook(a, 'lookAtPitch', 0.75);
    await wait(500);
    await shot(a, `${prefix}-seek-lookup`);
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, `${prefix}-FAIL`).catch(() => {});
  }
  return h;
}
async function minimapShot(port, { colorScheme, prefix }) {
  const h = await launch({ port, only: ['chameleon'], who: ['a'], colorScheme, device: 'iPhone 13' });
  const a = h.a;
  try {
    await arm(a, SHOWCASE);
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    const big = await biggestMap(a);
    const id = big.list.find((m) => m.id === 'house') ? 'house' : big.id;
    await hook(a, 'setRules', { map: id, first: 'b', rules: { minimap: true } });
    await a.waitForFunction((m) => window.__cham.state().mapId === m, id, { timeout: 20000 });
    await a.click('[data-act="start"]');
    await wait(400);
    await shot(a, `${prefix}-title-overview`);
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await a.click('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'curtain');
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'seek');
    await wait(2500);
    assert(await a.isVisible('.chm-mini'), `[${prefix}] the seeker's minimap shows on ${id}`);
    await shot(a, `${prefix}-minimap`);
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, `${prefix}-FAIL`).catch(() => {});
  }
  return h;
}

// ─────────────────────────────────────────────────────────────────────
// v3: the seeker climbs, the hider spectates and paints while hunted, start timing
/** Start a live Hide & Seek match with these rules (b hides first unless told otherwise). */
async function startMatch(h, { map = 'living', first = 'b', rules = {} } = {}) {
  const { a, b } = h;
  await hook(a, 'setRules', { map, first, rules });
  await b.waitForFunction(([m, f]) => window.__cham.state().mapId === m && window.__cham.state().setup.first === f, [map, first], { timeout: 20000 });
  await a.tap('[data-act="start"]');
}
const vlen = (v) => Math.hypot(...v);

async function seekClimbSection(port) {
  console.log('\n# v3: the seeker climbs (Stick, crawl up a wall onto the rafter), the hider sees the orientation, a tag from the ceiling, guards');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, SLOW);
    await startMatch(h, { rules: { size: 'large', seekClimb: true, climbSpeed: 'normal', grace: 0, headStart: 0 } });
    await waitPhase(b, 'hide', 20000);
    // Sydney hides flat on the left wall, under the rafter
    await hook(b, 'teleport', -4.5, 0.6, -Math.PI / 2, 0);
    assert(await hook(b, 'setPose', 'wall') === 'wall', 'hider pressed flat on the left wall');
    const hb = await hook(b, 'body');
    await b.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 20000); await waitPhase(b, 'seek', 5000);
    await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 5000 });
    await wait(500);
    // the seeker's HUD has the sticky-feet buttons
    for (const act of ['stick', 'zip', 'poses', 'scan', 'sprint', 'jump', 'fire']) assert(await a.isVisible(`.chm-acts [data-act="${act}"]`), `seeker HUD: ${act}`);
    // walk to the left wall, Stick (real tap)
    await hook(a, 'teleport', -4.55, 2.35, -Math.PI / 2, 0);
    await wait(200);
    await a.tap('.chm-acts [data-act="stick"]');
    let ab = await hook(a, 'body');
    assert(ab.at && ab.nx > 0.9, `the seeker sticks to the left wall (normal ${fmt3([ab.nx, ab.ny, ab.nz])})`);
    await wait(700);
    let sa = await st(a);
    assert(sa.climbV && sa.visible.a, 'on a wall the seeker switches to the over-the-shoulder view and sees their own body');
    const eye = [ab.x, ab.y + 0.46 * ab.s, ab.z];
    assert(vlen([sa.cam[0] - eye[0], sa.cam[1] - eye[1], sa.cam[2] - eye[2]]) > 0.6, `the climb camera sits behind the body (${vlen([sa.cam[0] - eye[0], sa.cam[1] - eye[1], sa.cam[2] - eye[2]]).toFixed(2)} m from the eyes)`);
    assert(await a.isVisible('.chm-acts [data-act="stick"].on'), 'Stick shows as on (Let go)');
    // crawl up with the joystick: screen-relative from the climb view
    const y0 = ab.y;
    await stickUp(a, 1300);
    ab = await hook(a, 'body');
    assert(ab.at && (ab.y > y0 + 0.6 || ab.ny < -0.9), `pushing up crawls the seeker up the wall (y ${y0.toFixed(2)} → ${ab.y.toFixed(2)})`);
    await wait(500);
    // the partner draws the seeker on the wall, oriented with the wall
    let sb = await st(b);
    assert(sb.rem.at === 1 && (dot(sb.drawn.a.up, [ab.nx, ab.ny, ab.nz]) > 0.9) && near(sb.drawn.a.p, [ab.x, ab.y, ab.z], 0.12), `the hider's screen draws the seeker on the wall (up ${fmt3(sb.drawn.a.up)}, at ${fmt3(sb.drawn.a.p)})`);
    await shot(b, 'v3-hider-sees-seeker-on-wall');
    // onto the rafter's underside
    if (ab.ny > -0.9) await hook(a, 'crawl', 0, 1.5, 0, 60);
    await hook(a, 'crawl', 0.9, 0, 0, 12);
    ab = await hook(a, 'body');
    assert(ab.at && ab.ny < -0.9 && ab.y > 2.2, `the seeker is upside down on the rafter at y ${ab.y.toFixed(2)}`);
    await wait(700);
    sb = await st(b);
    assert(dot(sb.drawn.a.up, [0, -1, 0]) > 0.95 && near(sb.drawn.a.p, [ab.x, ab.y, ab.z], 0.12), `the hider sees the seeker upside down (up ${fmt3(sb.drawn.a.up)})`);
    // hang from it, the pose reaches the partner too
    await a.tap('.chm-acts [data-act="poses"]');
    await wait(300);
    assert(await a.isVisible('.chm-pose[data-pose="hang"]'), 'the seeker\'s pose bar offers Hang');
    await a.tap('.chm-pose[data-pose="hang"]');
    await wait(700);
    sb = await st(b);
    assert((await hook(a, 'body')).pose === 'hang' && sb.drawn.a.pose === 'hang', 'the seeker hangs from the rafter, on both screens');
    await shot(a, 'v3-seeker-hangs');
    // tag the hider from the ceiling (aim through the over-the-shoulder camera, fire with a real tap):
    // crawl along the ceiling to a spot above and in front of her
    await hook(a, 'attachAt', -3.6, 2.5, 1.6, 0, -1, 0, 1, 0, 0);
    await wait(600);
    const bc = await hook(a, 'bodyCenter', 'b');
    const aim = await hook(a, 'aimAt', ...bc);
    assert(aim.climb, 'aiming through the climb camera');
    await wait(500);
    await hook(a, 'aimAt', ...bc);
    await wait(250);
    await a.tap('.chm-acts [data-act="fire"]');
    await waitPhase(a, 'found', 8000).catch(async (e) => { console.error('last shot', JSON.stringify((await st(a)).lastShot), JSON.stringify((await st(a)).cam), bc); throw e; });
    await waitPhase(b, 'found', 3000);
    assert((await st(b)).lastTagCheck.ok, 'a pellet fired from the ceiling tags the hider (confirmed by her device)');
    void hb;
    // round 2: Emerson hides; Sydney (seeker) tongue-zips up to the ceiling; Emerson sees the tongue but no trail
    await waitPhase(a, 'recap', 8000);
    await b.tap('[data-act="next"]');
    await waitPhase(a, 'hide', 20000);
    await camoHide(a);
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 20000);
    await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 5000 });
    // a clear spot under the rafter (nothing else overhead)
    let spotX = -3.67;
    for (const x of [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5, -3.2]) { const u = await hook(b, 'surfaceAt', x, 0.05, 2.35, 0, 1, 0, 3); if (u && u.p[1] > 2.1 && u.p[1] < 2.45) { spotX = x; break; } }
    await hook(b, 'teleport', spotX, 2.35, 0, 0);
    await hook(b, 'lookAtPitch', 1.35);
    await wait(250);
    const z = await hook(b, 'zip');
    assert(z, `the seeker tongue-zips at the rafter${z ? '' : ` (hint: "${await b.textContent('.chm-hint')}", ${JSON.stringify((await st(b)).cam)})`}`);
    await wait(900);
    const bb = await hook(b, 'body');
    assert(bb.at && bb.ny < -0.9, `…and sticks under it (y ${bb.y.toFixed(2)})`);
    const sa2 = await st(a);
    assert(sa2.trails === 0 && sa2.round.escapes.b === sa2.rules.escapes, 'a seeker\'s zip leaves no trail and costs no escape');
    // let go: back to first person
    await b.tap('.chm-acts [data-act="stick"]');
    await b.waitForFunction(() => { const s = window.__cham.state(); return !s.bodies.b.at && s.bodies.b.onGround && !s.climbV; }, null, { timeout: 5000 });
    assert(!(await st(b)).visible.b, 'let go and landed: first person again (own body hidden)');
    h.assertNoErrors();
    assert(!h.warnings.length, `message budget respected (${h.warnings.length} warnings)`);
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'v3-climb-FAIL-a').catch(() => {}); await shot(b, 'v3-climb-FAIL-b').catch(() => {});
    try { console.error(JSON.stringify(await hook(a, 'body')).slice(0, 500)); } catch { /* ignore */ }
  } finally { await h.close(); }
}

/** One device: seeker climbing on the House stops at the invisible guards, and "Seeker can climb: Off" removes it. */
async function seekGuardsSection(port) {
  console.log('\n# v3: the climbing seeker and the invisible guards (House), and the toggle off');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await arm(a, SLOW);
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    const ids = await hook(a, 'mapIds');
    if (!ids.includes('house')) { console.log('  (no house map: skipped)'); return; }
    await hook(a, 'setRules', { map: 'house', first: 'b', rules: { seekClimb: true } });
    await a.tap('[data-act="start"]');
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'curtain');
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'seek');
    await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    assert((await st(a)).viewer === 'a', 'the seeker holds the device');
    const g = (await hook(a, 'guards')).find((x) => /front/.test(x.name)) || (await hook(a, 'guards'))[0];
    const cx = (g.minX + g.maxX) / 2 + 0.7;
    const wall = await hook(a, 'surfaceAt', cx, 0.3, g.minZ - 1.2, 0, 0, 1, 3);
    await hook(a, 'attachAt', wall.p[0], 0.3, wall.p[2], 0, 0, -1, 0, 1, 0);
    const r = await hook(a, 'crawl', 0, 1.2, 0, 60);
    let ab = await hook(a, 'body');
    assert(ab.at && ab.nz < -0.9 && ab.y <= wall.box.maxY + 0.01, `the seeker crawling up the low front wall stops at its top (y ${ab.y.toFixed(2)}, results ${[...new Set(r.res)].join(',')})`);
    await a.tap('.chm-acts [data-act="stick"]'); // let go
    await hook(a, 'teleport', cx, g.minZ - 1.5, Math.PI, 0);
    await hook(a, 'lookAtPitch', 0.35);
    await wait(300);
    const zipped = await hook(a, 'zip');
    ab = await hook(a, 'body');
    assert(!(zipped && ab.y > 0.9), `the seeker's tongue-zip at the guard doesn't stick to it (zip ${zipped})`);
    // toggle off (this device only): no Stick / Zip / Pose buttons, E does nothing
    await hook(a, 'forceRule', 'seekClimb', false);
    await wait(300);
    assert(!(await a.isVisible('.chm-acts [data-act="stick"]')) && await a.isVisible('.chm-acts [data-act="fire"]'), '"Seeker can climb: Off": the hunt HUD without sticky feet');
    await hook(a, 'teleport', cx, g.minZ - 1.5, Math.PI, 0);
    assert(!(await hook(a, 'stick')).at, 'and Stick is refused');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'v3-guards-FAIL').catch(() => {});
  } finally { await h.close(); }
}

async function spectateSection(port) {
  console.log('\n# v3: the hunted hider switches views (eyes → watch the seeker → free cam) without moving or telling the seeker anything');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, SLOW);
    await startMatch(h, { rules: { huntPaint: 'tell' } });
    await waitPhase(b, 'hide', 20000);
    await camoHide(b);
    await b.tap('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 20000);
    await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 5000 });
    await wait(600);
    await hook(a, 'teleport', -1.0, 1.5, Math.PI, 0);
    await wait(600);
    const key = (o) => [o.x, o.y, o.z, o.yaw, o.lookYaw, o.lookPitch, o.pose, o.at].map((x) => (typeof x === 'number' ? x.toFixed(4) : String(x))).join(',');
    const body0 = await hook(b, 'body');
    const seen0 = (await st(a)).rem;
    const sent0 = (await st(b)).sent;
    assert(await b.isVisible('.chm-acts [data-act="view"]'), 'the hider\'s HUD has a View button');
    // watch the seeker
    await b.tap('.chm-acts [data-act="view"]');
    await wait(900);
    let sb = await st(b);
    assert(sb.spect === 'watch' && /Watching Emerson/i.test(sb.badge || '') && sb.here.on, `View → watch the seeker (badge "${sb.badge}", you're-here marker on)`);
    const sk = sb.drawn.a.p; const d = vlen([sb.cam[0] - sk[0], sb.cam[1] - sk[1], sb.cam[2] - sk[2]]);
    assert(d > 0.6 && d < 3.5, `the camera rides over the seeker's shoulder (${d.toFixed(2)} m from them)`);
    assert(!(await b.isVisible('.chm-acts [data-act="scurry"]')), 'no scurry / zip / poses while spectating');
    await shot(b, 'v3-watch-seeker');
    // free cam: fly with the joystick
    await b.tap('.chm-acts [data-act="view"]');
    await wait(300);
    sb = await st(b);
    assert(sb.spect === 'free' && sb.badge === 'Free cam', 'View again → free cam');
    const fc0 = sb.fc.slice();
    await stickUp(b, 900);
    sb = await st(b);
    const flown = vlen([sb.fc[0] - fc0[0], sb.fc[1] - fc0[1], sb.fc[2] - fc0[2]]);
    assert(flown > 1, `the joystick flies the free cam ${flown.toFixed(2)} m`);
    // keyboard: Space rises
    await b.keyboard.down('Space'); await wait(500); await b.keyboard.up('Space');
    const fc1 = (await st(b)).fc;
    assert(fc1[1] > sb.fc[1] + 0.3 || fc1[1] >= (await hook(b, 'freeBounds')).top - 0.01, `Space rises (${sb.fc[1].toFixed(2)} → ${fc1[1].toFixed(2)})`);
    // clamped to the map, collides with nothing
    const fb = await hook(b, 'freeBounds');
    const cl = await hook(b, 'freeCamTo', 100, 100, -100);
    assert(cl[0] <= fb.maxX && cl[2] >= fb.minZ && cl[1] <= fb.top, `flying off the map is clamped to its bounds (${fmt3(cl)})`);
    await hook(b, 'freeCamTo', -1.5, 1.6, -0.5, Math.PI + 0.6, -0.25);
    await wait(500);
    sb = await st(b);
    assert(sb.here.on && sb.visible.b, 'the free cam shows my own body with the "You" marker');
    await shot(b, 'v3-free-cam');
    // nothing moved, nothing leaked
    const body1 = await hook(b, 'body');
    assert(key(body0) === key(body1), 'the hider\'s body stayed exactly where it was (position, heading, look, pose)');
    const sa = await st(a);
    const same = ['x', 'y', 'z', 'q', 'at', 'po'].every((k) => Math.abs((sa.rem[k] || 0) - (seen0[k] || 0)) < 1e-6);
    assert(same, 'the seeker\'s copy of the hider is unchanged');
    assert(sa.spect === 'eyes' && !sa.badge && !(await a.isVisible('.chm-here')), 'the seeker\'s screen shows no trace of the free cam');
    assert((await st(b)).sent === sent0, `the hider sent no messages while spectating (${(await st(b)).sent - sent0})`);
    // painting returns to the eyes
    await b.tap('.chm-acts [data-act="view"]');
    sb = await st(b);
    assert(sb.spect === 'eyes' && !sb.badge, 'View again → back in my own eyes');
    // seeker can't spectate; one device can't either
    await hook(a, 'view', 'free');
    assert((await st(a)).spect === 'eyes', 'the seeker has no spectator views');
    h.assertNoErrors();
    assert(!h.warnings.length, `message budget respected (${h.warnings.length} warnings)`);
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'v3-spect-FAIL-a').catch(() => {}); await shot(b, 'v3-spect-FAIL-b').catch(() => {});
  } finally { await h.close(); }
}

async function huntPaintSection(port) {
  console.log('\n# v3: painting while hunted syncs to the seeker; "Shows" glints for a seeker in range with a line of sight');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, SLOW);
    await startMatch(h, { rules: { huntPaint: 'tell', size: 'large' } });
    await waitPhase(b, 'hide', 20000);
    await camoHide(b);
    await b.tap('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 20000);
    await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 5000 });
    const bc = await hook(b, 'bodyCenter', 'b');
    // the seeker stands 2.5 m in front of her, looking at her
    await hook(a, 'teleport', bc[0] + 0.3, bc[2] + 2.5, Math.PI, 0);
    await hook(a, 'aimAt', ...bc);
    await wait(700);
    assert(await b.isVisible('.chm-acts [data-act="paint"]'), 'the hunted hider has a Paint button');
    await b.tap('.chm-acts [data-act="paint"]');
    await wait(800);
    assert(await b.isVisible('.chm-tools'), 'paint tools open while hunted');
    const sent0 = (await st(b)).sent;
    await strokeOnBody(b, true);
    await b.waitForFunction(() => window.__cham.state().live.sent >= 1, null, { timeout: 5000 });
    await a.waitForFunction(() => window.__cham.state().live.got >= 1, null, { timeout: 5000 });
    await wait(200);
    assert(await hook(a, 'paintHash', 'b') === await hook(b, 'paintHash', 'b'), 'the fresh paint reached the seeker\'s device (texture hashes match)');
    let sa = await st(a);
    assert(sa.live.tells >= 1, `"Shows": the seeker got a glint (${sa.live.tells})`);
    await shot(a, 'v3-paint-tell');
    const lp = (await st(b)).lastPaint;
    assert(lp.live && lp.chunks <= 2, `one paint update is ${lp.b64} bytes of base64 (${lp.chunks} chunk${lp.chunks === 1 ? '' : 's'})`);
    // fill + stamp too
    await b.tap('.chm-tool[data-tool="stamp"]');
    await a.waitForFunction(() => window.__cham.state().live.got >= 2, null, { timeout: 5000 });
    assert(await hook(a, 'paintHash', 'b') === await hook(b, 'paintHash', 'b'), 'a stamp while hunted syncs too');
    // far away (out of range): no glint, but the paint still syncs
    const tells = (await st(a)).live.tells;
    await hook(a, 'teleport', 3.6, 3.2, Math.PI, 0);
    await wait(1200);
    await strokeOnBody(b, true);
    await a.waitForFunction(() => window.__cham.state().live.got >= 3, null, { timeout: 6000 });
    sa = await st(a);
    assert(sa.live.tells === tells && sa.live.tellSkip >= 1, `out of range (${vlen([sa.bodies.a.x - bc[0], 0, sa.bodies.a.z - bc[2]]).toFixed(1)} m): synced, no glint`);
    // a burst of strokes is coalesced (≤ 1 update a second)
    const g0 = (await st(a)).live.got;
    for (let i = 0; i < 4; i++) { await strokeOnBody(b, true); await wait(120); }
    await wait(1600);
    const g1 = (await st(a)).live.got;
    assert(g1 - g0 >= 1 && g1 - g0 <= 3, `four quick strokes → ${g1 - g0} update(s)`);
    const sent = (await st(b)).sent - sent0;
    console.log(`  hider reliable sends while painting: ${sent}`);
    // "On" (silent): synced, never a glint
    for (const p of [a, b]) await hook(p, 'forceRule', 'huntPaint', 'on');
    await hook(a, 'teleport', bc[0] + 0.3, bc[2] + 2.5, Math.PI, 0); await hook(a, 'aimAt', ...bc);
    await wait(1200);
    const t2 = (await st(a)).live.tells; const g2 = (await st(a)).live.got;
    await strokeOnBody(b, true);
    await a.waitForFunction((g) => window.__cham.state().live.got > g, g2, { timeout: 6000 });
    assert((await st(a)).live.tells === t2, '"On": synced silently, no glint');
    // "Off": the Paint button goes, and painting is refused
    await b.tap('.chm-done');
    for (const p of [a, b]) await hook(p, 'forceRule', 'huntPaint', 'off');
    await wait(400);
    assert(!(await b.isVisible('.chm-acts [data-act="paint"]')), '"Off": no Paint button while hunted');
    await b.keyboard.press('KeyP');
    await wait(300);
    assert(!(await st(b)).paint, '…and P does nothing');
    h.assertNoErrors();
    assert(!h.warnings.length, `message budget respected (${h.warnings.length} warnings)`);
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'v3-paint-FAIL-a').catch(() => {}); await shot(b, 'v3-paint-FAIL-b').catch(() => {});
  } finally { await h.close(); }
}

const REALTIME = { ...SLOW, hide: undefined, seek: undefined, seekLead: undefined, realCountdown: true };
async function timingLocalSection(port) {
  console.log('\n# v3: start timing on one device: 10 s hide, 5 s countdown, 5 s head start, 3 s grace, 20 s seek');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await arm(a, REALTIME);
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await hook(a, 'setRules', { map: 'living', first: 'b', rules: { hide: 10, countdown: 5, headStart: 5, grace: 3, seek: 20, rounds: 2 } });
    const tm = await hook(a, 'timing');
    assert(tm.hide === 10000 && tm.seek === 20000 && tm.head === 5000 && tm.countdown === 5000 && tm.grace === 3000, `timing: ${JSON.stringify(tm)}`);
    await a.tap('[data-act="start"]');
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    let s = await st(a);
    assert(s.phase.dur === 10000, 'one device: the hide clock is the 10 s setting (it used to ignore the setting)');
    const t0 = Date.now();
    await waitPhase(a, 'curtain', 20000);
    const hid = (Date.now() - t0) / 1000;
    assert(hid > 8.5 && hid < 12, `the hide phase ended by the clock after ${hid.toFixed(1)} s`);
    await a.tap('[data-act="curtain"]');
    await a.waitForFunction(() => /^count-/.test(window.__cham.state().layer), null, { timeout: 3000 });
    const c0 = Date.now();
    await waitPhase(a, 'seek', 10000);
    const cd = (Date.now() - c0) / 1000;
    assert(cd > 4 && cd < 6.5, `the countdown lasted ${cd.toFixed(1)} s`);
    s = await st(a);
    assert(s.phase.dur === 25000 && s.blind && /^head-/.test(s.layer), 'seek phase = 5 s head start + 20 s; the seeker is blindfolded');
    assert(await a.evaluate(() => getComputedStyle(document.querySelector('.chm canvas')).visibility) === 'hidden', 'canvas hidden under the blindfold');
    await hook(a, 'action', 'fire');
    assert((await st(a)).round.pellets.a === (await st(a)).rules.pellets, 'no firing while blindfolded');
    const clk = (await a.textContent('.chm-phase')).trim();
    assert(/Head start/i.test(clk), `the clock reads "${clk}"`);
    await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    s = await st(a);
    assert(!s.blind && await a.$eval('.chm-acts [data-act="fire"]', (x) => x.disabled), 'hunt on: Fire is disabled during the grace period');
    const lab = (await a.textContent('.chm-acts [data-act="fire"] em')).trim();
    assert(/Wait/.test(lab), `Fire reads "${lab}"`);
    await shot(a, 'v3-grace');
    await a.waitForFunction(() => !document.querySelector('.chm-acts [data-act="fire"]').disabled, null, { timeout: 5000 });
    const gEnd = await st(a);
    assert(gEnd.now >= gEnd.graceUntil - 50, 'Fire enables when the grace period ends');
    // no shots: the hider survives the 20 s hunt (head start doesn't score)
    await waitPhase(a, 'time', 30000);
    s = await st(a);
    assert(s.round.rec && s.round.rec.points === 20 + 30, `survived: ${s.round.rec.points} points (20 s of hunt + 30, the head start doesn't count)`);
    // spectating is a two-device thing
    assert(await hook(a, 'view', 'free') === 'eyes', 'one device: no spectator views');
    // round 2 (this device's rules changed mid-match): On Ready, a 10 s countdown, no head start, no grace
    await hook(a, 'forceRule', 'hideEnd', 'ready'); await hook(a, 'forceRule', 'countdown', 10);
    await hook(a, 'forceRule', 'headStart', 0); await hook(a, 'forceRule', 'grace', 0);
    await waitPhase(a, 'recap', 10000);
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'curtain', 10000);
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(400);
    s = await st(a);
    assert(s.phase.dur === 0 && (await a.textContent('.chm-phase')).trim() === 'No limit', `one device, On Ready: the hide phase is untimed (dur ${s.phase.dur}, ${s.rules.hideEnd}, "${await a.textContent('.chm-phase')}")`);
    await wait(1500);
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'curtain', 5000);
    await a.tap('[data-act="curtain"]');
    const c1 = Date.now();
    await waitPhase(a, 'seek', 15000);
    const cd10 = (Date.now() - c1) / 1000;
    assert(cd10 > 9 && cd10 < 11.5, `a 10 s countdown lasted ${cd10.toFixed(1)} s`);
    s = await st(a);
    assert(!s.blind && s.hunting && !(await a.$eval('.chm-acts [data-act="fire"]', (x) => x.disabled)), 'no head start, no grace: hunting with Fire ready at once');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'v3-timing-local-FAIL').catch(() => {});
  } finally { await h.close(); }
}

async function timingLiveSection(port) {
  console.log('\n# v3: start timing on two phones: untimed hide (On Ready), no countdown, head start (hider moves, seeker blind), grace');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, REALTIME);
    await startMatch(h, { rules: { hideEnd: 'ready', countdown: 0, headStart: 5, grace: 5, seek: 30 } });
    await waitPhase(b, 'hide', 20000); await waitPhase(a, 'hide', 5000);
    let sb = await st(b);
    assert(sb.phase.dur === 0 && (await b.textContent('.chm-phase')).trim() === 'No limit', 'On Ready: the hide phase has no clock ("No limit")');
    await wait(1500);
    const bl0 = (await a.textContent('[data-live="blind-time"]')).trim();
    await wait(1600);
    const bl1 = (await a.textContent('[data-live="blind-time"]')).trim();
    assert(bl1 !== bl0 && /On Ready|Ready/.test(await a.textContent('.chm-blind')), `the seeker's blindfold counts up (${bl0} → ${bl1}) and says the hunt starts on Ready`);
    await wait(1500);
    assert((await st(b)).phase.name === 'hide', 'still hiding after 4.5 s: nothing ends it but Ready');
    await camoHide(b);
    await b.tap('.chm-acts [data-act="ready"]');
    const r0 = Date.now();
    await waitPhase(a, 'seek', 15000);
    console.log(`  Ready → seek in ${((Date.now() - r0) / 1000).toFixed(1)} s (lock + no countdown)`);
    await waitPhase(b, 'seek', 3000);
    // head start: Sydney walks, Emerson is blindfolded
    let sa = await st(a); sb = await st(b);
    assert(sa.blind && /^head-/.test(sa.layer) && !sb.hunting, 'head start: the seeker is blindfolded');
    assert(await b.isVisible('.chm-acts [data-act="stick"]') && !(await b.isVisible('.chm-acts [data-act="scurry"]')), 'the hider gets her hiding moves back for the head start');
    const p0 = await hook(b, 'body');
    if (p0.at) await b.tap('.chm-acts [data-act="stick"]');
    await wait(200);
    const p1 = await hook(b, 'body');
    const box = await surfaceBox(b);
    await touchHold(b, box[0] + 80, box[1] + box[3] - 150, box[0] + 130, box[1] + box[3] - 150, 900);
    const p2 = await hook(b, 'body');
    assert(Math.hypot(p2.x - p1.x, p2.z - p1.z) > 0.4, `the hider moves during the head start (${Math.hypot(p2.x - p1.x, p2.z - p1.z).toFixed(2)} m)`);
    sa = await st(a);
    assert(sa.violations === 0 && sa.blind, 'and the seeker\'s screen stays covered');
    await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 2000 });
    await wait(400);
    sb = await st(b);
    const p3 = sb.bodies.b;
    await stickUp(b, 600);
    const p4 = (await st(b)).bodies.b;
    assert(Math.hypot(p4.x - p3.x, p4.z - p3.z) < 0.01, 'hunt on: the hider freezes');
    sa = await st(a);
    const drawn = sa.drawn.b.p;
    assert(sa.visible.b && near(drawn, [p4.x, p4.y, p4.z], 0.15), `the seeker sees her where she ended up (${fmt3(drawn)})`);
    // grace: no firing for 5 s
    const bc = await hook(a, 'bodyCenter', 'b');
    await hook(a, 'teleport', bc[0], bc[2] + 2.0, Math.PI, 0);
    await hook(a, 'aimAt', ...bc);
    await hook(a, 'action', 'fire');
    sa = await st(a);
    assert(sa.round.pellets.a === sa.rules.pellets && sa.now < sa.graceUntil, `grace period: fire refused (${((sa.graceUntil - sa.now) / 1000).toFixed(1)} s left)`);
    await a.waitForFunction(() => { const s = window.__cham.state(); return s.now >= s.graceUntil; }, null, { timeout: 8000 });
    await hook(a, 'aimAt', ...(await hook(a, 'bodyCenter', 'b')));
    await wait(200);
    await a.tap('.chm-acts [data-act="fire"]');
    await waitPhase(a, 'found', 8000);
    const rec = (await st(a)).round.rec;
    assert(rec.found && rec.ms < 8000, `after the grace the tag lands; found after ${(rec.ms / 1000).toFixed(1)} s of hunt (head start not counted)`);
    h.assertNoErrors();
    assert(!h.warnings.length, `message budget respected (${h.warnings.length} warnings)`);
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'v3-timing-live-FAIL-a').catch(() => {}); await shot(b, 'v3-timing-live-FAIL-b').catch(() => {});
  } finally { await h.close(); }
}

async function settings3Section(port) {
  console.log('\n# v3 settings: timing + climbing + paint while hunted through the sheet, live on the guest, validated, saved');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, SLOW);
    for (const [id, want] of [['easy', { seekClimb: true, climbSpeed: 'fast', huntPaint: 'off', grace: 0 }], ['classic', { seekClimb: true, climbSpeed: 'normal', huntPaint: 'tell', grace: 0, countdown: 3 }], ['hard', { seekClimb: true, climbSpeed: 'slow', huntPaint: 'on', grace: 5 }]]) {
      await a.tap(`.chm-lobby .chm-presets [data-v="${id}"]`);
      await b.waitForFunction((p) => window.__cham.state().setup.rules.preset === p, id, { timeout: 5000 });
      const rb = (await st(b)).setup.rules;
      assert(Object.entries(want).every(([k, v]) => rb[k] === v), `${id} preset on the guest: ${Object.entries(want).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    }
    await a.tap('.chm-lobby .chm-presets [data-v="classic"]');
    await a.tap('.chm-lobby [data-act="settings"]');
    await b.tap('.chm-lobby [data-act="settings"]');
    await a.waitForSelector('.chm-sheet'); await b.waitForSelector('.chm-sheet');
    // every new control, through the UI (taps), each one reaching the guest's open sheet
    const steps = [
      ['[data-k="hideEnd"][data-v="ready"]', (r) => r.hideEnd === 'ready'],
      ['[data-k="hideEnd"][data-v="timer"]', (r) => r.hideEnd === 'timer'],
      ['[data-k="countdown"][data-v="10"]', (r) => r.countdown === 10],
      ['[data-k="headStart"][data-step="1"]', (r) => r.headStart === 5],
      ['[data-k="grace"][data-step="1"]', (r) => r.grace === 3],
      ['[data-k="hide"][data-step="-1"]', (r) => r.hide === 55],
      ['[data-k="seek"][data-step="1"]', (r) => r.seek === 95],
      ['[data-k="climbSpeed"][data-v="fast"]', (r) => r.climbSpeed === 'fast'],
      ['[data-k="huntPaint"][data-v="on"]', (r) => r.huntPaint === 'on'],
      ['[data-k="seekClimb"][data-v="false"]', (r) => r.seekClimb === false],
    ];
    for (const [sel, ok] of steps) {
      await a.tap(`.chm-sheet ${sel}`);
      await b.waitForFunction((src) => (0, eval)(src)(window.__cham.state().setup.rules), ok.toString(), { timeout: 5000 });
    }
    assert(true, `hide ends, countdown, head start, grace, hide/seek steppers, climb speed, paint while hunted, seeker climb: all reached the guest (${steps.length} changes)`);
    assert(!(await a.isVisible('.chm-sheet [data-k="climbSpeed"]')), 'with the seeker\'s climbing off, its speed row hides');
    assert(await b.$eval('.chm-sheet [data-range="seek"]', (x) => x.disabled), "the guest's sliders are read-only");
    // the hide slider: drag to 3 min → preview, commit on release
    await a.evaluate(() => { const r = document.querySelector('.chm-sheet [data-range="hide"]'); r.value = r.max; r.dispatchEvent(new Event('input', { bubbles: true })); });
    assert((await a.textContent('.chm-sheet [data-rule="hide"]')).trim() === '5 min', 'dragging the hide slider previews the value (5 min)');
    await a.evaluate(() => { const r = document.querySelector('.chm-sheet [data-range="hide"]'); r.dispatchEvent(new Event('change', { bubbles: true })); });
    await b.waitForFunction(() => window.__cham.state().setup.rules.hide === 300, null, { timeout: 5000 });
    assert((await b.textContent('.chm-sheet [data-rule="hide"]')).trim() === '5 min', 'released: the guest sees 5 min');
    // effective times on a big map (House): hide, seek and head start scale, countdown and grace don't
    await a.tap('.chm-sheet .chm-mapchips [data-v="house"]');
    await b.waitForFunction(() => window.__cham.state().setup.map === 'house', null, { timeout: 20000 });
    await a.tap('.chm-sheet [data-k="headStart"][data-step="1"]');
    await b.waitForFunction(() => window.__cham.state().setup.rules.headStart === 10, null, { timeout: 5000 });
    const effs = await b.$$eval('.chm-sheet [data-eff]', (xs) => xs.map((x) => `${x.dataset.eff}: ${x.textContent.trim()}`));
    console.log('  ' + effs.join(' | '));
    assert(effs.some((x) => /^hide/.test(x)) && effs.some((x) => /^seek/.test(x)) && effs.some((x) => /^headStart/.test(x)), 'the guest\'s sheet shows the effective hide, seek and head-start times on the House');
    const tm = await hook(b, 'timing');
    const rr = (await st(b)).setup.rules;
    assert(tm.head === Math.round(10 * tm.scale / 5) * 5000 && rr.countdown === 10 && tm.grace === 3000, `map scaling applied consistently: head start ${tm.head / 1000} s (scaled ×${tm.scale}), countdown ${rr.countdown} s and grace ${tm.grace / 1000} s (not scaled)`);
    await shot(a, 'v3-settings-house');
    // validation on both devices
    await hook(a, 'setRules', { rules: { hide: 7, seek: 1000, countdown: 4, headStart: 'lots', grace: -2, huntPaint: 'sometimes', hideEnd: 1, seekClimb: 'yes', climbSpeed: 'warp' } });
    await b.waitForFunction(() => window.__cham.state().setup.rules.seek === 600, null, { timeout: 5000 });
    const ra = (await st(a)).setup.rules; const rb = (await st(b)).setup.rules;
    assert(JSON.stringify(ra) === JSON.stringify(rb) && ra.hide === 10 && ra.seek === 600 && ra.countdown === 3 && ra.headStart === 0 && ra.grace === 0 && ra.huntPaint === 'tell' && ra.hideEnd === 'timer' && ra.seekClimb === true && ra.climbSpeed === 'normal',
      `garbage is snapped identically on both devices (hide 10 s, seek 10 min, countdown 3, head start ${ra.headStart}, grace ${ra.grace}, paint ${ra.huntPaint})`);
    await a.tap('.chm-sheet [data-k="grace"][data-step="1"]'); // one more change through the UI (saves)
    await b.waitForFunction(() => window.__cham.state().setup.rules.grace === 3, null, { timeout: 5000 });
    await a.tap('.chm-sheet .chm-go[data-act="settings"]');
    // saved per device
    const keep = JSON.stringify((await st(a)).setup.rules);
    await h.closeGame(a); await h.closeGame(b);
    await wait(600);
    await arm(a, SLOW); await arm(b, SLOW);
    await h.startLive(a, 'chameleon', 'live');
    await h.settle();
    await b.click('#gm-invite [data-g="invite-yes"]');
    await waitLinked(a); await waitLinked(b);
    await wait(800);
    assert(JSON.stringify((await st(a)).setup.rules) === keep, 'the host\'s device remembered the v3 settings');
    await b.waitForFunction((k) => JSON.stringify(window.__cham.state().setup.rules) === k, keep, { timeout: 5000 });
    assert(true, '…and sent them to the guest');
    h.assertNoErrors();
    assert(!h.warnings.length, `message budget respected (${h.warnings.length} warnings)`);
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'v3-settings-FAIL-a').catch(() => {}); await shot(b, 'v3-settings-FAIL-b').catch(() => {});
  } finally { await h.close(); }
}

/** Full 2-round matches on the House and on CU Boulder with v3 settings. */
async function v3MatchSection(port, map) {
  console.log(`\n# v3: a full 2-round match on ${map}: the seeker climbs, paint while hunted (Shows), head start, grace, countdown`);
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...REALTIME, recap: 2500, found: 2200, title: 700 });
    const ids = await hook(a, 'mapIds');
    if (!ids.includes(map)) { console.log(`  (no ${map} map: skipped)`); return; }
    await startMatch(h, { map, rules: { rounds: 2, hide: 20, seek: 25, countdown: 3, headStart: 5, grace: 3, huntPaint: 'tell', seekClimb: true, pellets: 3 } });
    // round 1: Sydney hides on a wall, Emerson climbs and tags her
    await waitPhase(b, 'hide', 30000);
    const spots = await hook(b, 'spots');
    const spot = spots.camo ? { x: spots.camo.x, z: spots.camo.z - (spots.camo.wallNormal ? -spots.camo.wallNormal[2] * 0.4 : 0), y: spots.camo.y != null ? Math.max(0, spots.camo.y - 0.6) : undefined } : spots.hiderSpawns[0];
    await hook(b, 'teleport', spot.x, spot.z, spot.yaw || 0, spot.y);
    await wait(200);
    await hook(b, 'stick');
    await b.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 30000);
    await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 15000 });
    // the hider paints a dab while hunted; it syncs
    await b.tap('.chm-acts [data-act="paint"]');
    await wait(600);
    await strokeOnBody(b, true);
    await a.waitForFunction(() => window.__cham.state().live.got >= 1, null, { timeout: 6000 });
    await b.tap('.chm-done');
    assert(await hook(a, 'paintHash', 'b') === await hook(b, 'paintHash', 'b'), 'paint while hunted synced');
    // the seeker: stick to the nearest wall from a spot near her, crawl up a bit, then fire from the wall
    const hb = await hook(b, 'body');
    const n = [hb.nx, hb.ny, hb.nz];
    const off = Math.abs(n[1]) > 0.7 ? [1.4, 0, 0.6] : [n[0] * 2.0, 0, n[2] * 2.0];
    await hook(a, 'teleport', hb.x + off[0], hb.z + off[2], 0, hb.y > 2 ? Math.floor(hb.y / 2.8) * 2.8 : undefined);
    await a.waitForFunction(() => { const s = window.__cham.state(); return s.now >= s.graceUntil; }, null, { timeout: 8000 });
    // the seeker climbs onto the same wall, above her (or a little to the side), and looks down
    let stuck = { at: false };
    if (Math.abs(n[1]) < 0.7) {
      const tx = -n[2]; const tz = n[0];
      for (const side of [0.3, -0.3, 1.0, -1.0]) {
        const sx = hb.x + tx * side; const sz = hb.z + tz * side;
        const w = await hook(a, 'surfaceAt', sx + n[0] * 0.5, hb.y + 1.3, sz + n[2] * 0.5, -n[0], 0, -n[2], 1.2);
        if (w && w.n[0] * n[0] + w.n[2] * n[2] > 0.9 && Math.abs(w.t - 0.5) < 0.1) { await hook(a, 'attachAt', w.p[0], w.p[1], w.p[2], n[0], 0, n[2], 0, 1, 0); stuck = await hook(a, 'body'); break; }
      }
    }
    console.log(`  seeker: ${stuck.at ? `on the wall at ${fmt3([stuck.x, stuck.y, stuck.z])}` : 'on the floor'}`);
    await wait(600);
    await hook(a, 'aimAt', ...(await hook(a, 'bodyCenter', 'b')));
    await wait(500);
    await hook(a, 'aimAt', ...(await hook(a, 'bodyCenter', 'b')));
    await wait(200);
    await shot(a, `v3-${map}-seeker`);
    await a.tap('.chm-acts [data-act="fire"]');
    await waitPhase(a, 'found', 8000).catch(async (e) => { console.error('last shot', JSON.stringify((await st(a)).lastShot), 'cam', JSON.stringify((await st(a)).cam), 'hider', JSON.stringify(await hook(a, 'bodyCenter', 'b'))); throw e; });
    assert((await st(a)).round.rec.found, `round 1 on ${map}: tagged${stuck.at ? ' by a seeker on the wall' : ''}`);
    await waitPhase(a, 'recap', 8000);
    await a.tap('[data-act="next"]');
    // round 2: Emerson hides; Sydney spends her pellets in the air → survived
    await waitPhase(a, 'hide', 20000);
    await camoOr(a);
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 30000);
    await b.waitForFunction(() => { const s = window.__cham.state(); return s.hunting && s.now >= s.graceUntil; }, null, { timeout: 15000 });
    await a.tap('.chm-acts [data-act="view"]'); // Emerson watches her
    await wait(300);
    assert((await st(a)).spect === 'watch', 'the hunted hider watches the seeker');
    for (let i = 0; i < 3; i++) { await hook(b, 'lookAtPitch', -1.2); await wait(120); await b.tap('.chm-acts [data-act="fire"]'); await wait(300); }
    await waitPhase(b, 'time', 10000);
    assert((await st(b)).round.rec.outOfPellets, 'round 2: the seeker ran dry, Emerson survived');
    await a.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 30000 });
    await b.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 30000 });
    assert(h.results().length === 1, `the ${map} match ended once on both phones`);
    const fa = await st(a); const fb = await st(b);
    assert(JSON.stringify(fa.match.scores) === JSON.stringify(fb.match.scores), `scores agree ${JSON.stringify(fa.match.scores)}`);
    h.assertNoErrors();
    assert(!h.warnings.length, `message budget respected (${h.warnings.length} warnings)`);
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, `v3-${map}-FAIL-a`).catch(() => {}); await shot(b, `v3-${map}-FAIL-b`).catch(() => {});
    try { console.error(JSON.stringify(await st(a)).slice(0, 1000)); } catch { /* ignore */ }
  } finally { await h.close(); }
}

/** v3 screenshots: settings (timing), the climbing seeker's HUD, the hunted hider's HUD, watch + free cam. */
async function shots3Run(port, { colorScheme, device, viewport, prefix }) {
  const h = await launch({ port, only: ['chameleon'], colorScheme, device });
  const { a, b } = h;
  try {
    if (viewport) { await a.setViewportSize(viewport); await b.setViewportSize(viewport); }
    await startPair(h, { ...SHOWCASE, hide: 120000, seek: 240000 });
    await hook(a, 'setRules', { map: 'living', first: 'b', rules: { size: 'large', headStart: 5, grace: 3, huntPaint: 'tell' } });
    await b.waitForFunction(() => window.__cham.state().setup.first === 'b', null, { timeout: 5000 });
    await a.click('.chm-lobby [data-act="settings"]');
    await b.click('.chm-lobby [data-act="settings"]');
    await a.waitForSelector('.chm-sheet');
    await wait(300);
    for (const [p, who] of [[a, 'host'], [b, 'guest']]) {
      await p.evaluate(() => { const sh = document.querySelector('.chm-sheet'); const h3 = [...sh.querySelectorAll('h3')].find((x) => /Timing/i.test(x.textContent)); sh.scrollTop = h3.offsetTop - 12; });
      await wait(400);
      await shot(p, `${prefix}-settings-timing-${who}`);
    }
    await a.evaluate(() => { const sh = document.querySelector('.chm-sheet'); const h3 = [...sh.querySelectorAll('h3')].find((x) => /Rules/i.test(x.textContent)); sh.scrollTop = h3.offsetTop - 12; });
    await wait(300);
    await shot(a, `${prefix}-settings-rules`);
    const wide = await a.evaluate(() => { const s2 = document.querySelector('.chm-sheet'); return s2.scrollWidth - s2.clientWidth; });
    assert(wide <= 1, `[${prefix}] settings sheet has no sideways overflow`);
    await a.click('.chm-sheet .chm-go[data-act="settings"]');
    await b.click('.chm-sheet .chm-go[data-act="settings"]').catch(() => {});
    await a.click('[data-act="start"]');
    await waitPhase(b, 'hide', 30000);
    await camoHide(b);
    await b.click('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 30000);
    await wait(1200);
    await shot(a, `${prefix}-seeker-blindfold`);
    await shot(b, `${prefix}-hider-headstart`);
    await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 15000 });
    await wait(500);
    await shot(a, `${prefix}-seeker-grace`);
    // the seeker on the left wall, a metre up, looking across the room
    await hook(a, 'attachAt', -5.0, 1.3, 0.2, 1, 0, 0, 0, 1, 0);
    await hook(a, 'setLook', 0, -0.1);
    await wait(200);
    await hook(a, 'aimAt', -3.15, 0.5, -3.7); // across the room, toward the back wall
    await wait(1500);
    await shot(a, `${prefix}-seeker-on-wall`);
    // the hunted hider: HUD, watch the seeker, free cam
    await wait(300);
    await shot(b, `${prefix}-hider-hud`);
    await hook(b, 'view', 'watch');
    await wait(1400);
    await shot(b, `${prefix}-hider-watch`);
    await hook(b, 'view', 'free');
    await hook(b, 'freeCamTo', -1.2, 1.9, 1.6, -2.45, -0.32);
    await wait(1200);
    await shot(b, `${prefix}-hider-freecam`);
    await hook(b, 'view', 'eyes');
    await b.click('.chm-acts [data-act="paint"]');
    await wait(1000);
    await shot(b, `${prefix}-hider-paint-hunted`);
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, `${prefix}-FAIL-a`).catch(() => {}); await shot(b, `${prefix}-FAIL-b`).catch(() => {});
  }
  return h;
}

// ─────────────────────────────────────────────────────────────────────
(async () => {
  const sections = [];
  if (want('hotseat')) {
    sections.push(async () => {
      console.log('\n# one-device hotseat round (phone, light) + screenshots');
      const h = await hotseat(PORT + 0, { prefix: 'phone-light' });
      await h.close();
    });
  }
  if (want('desktop')) {
    sections.push(async () => {
      console.log('\n# Desktop Chrome: keyboard + mouse (light) + screenshots at 1280×800');
      const h = await hotseat(PORT + 1, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, keyboard: true, prefix: 'desktop-light' });
      await h.close();
    });
  }
  if (want('dark')) {
    sections.push(async () => {
      console.log('\n# dark mode screenshots (phone + desktop)');
      let h = await hotseat(PORT + 2, { colorScheme: 'dark', prefix: 'phone-dark' });
      await h.close();
      h = await hotseat(PORT + 3, { colorScheme: 'dark', device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, keyboard: true, prefix: 'desktop-dark' });
      await h.close();
    });
  }
  if (want('match')) sections.push(() => matchSection(PORT + 4));
  if (want('lossy')) sections.push(() => lossySection(PORT + 5));
  if (want('buzzer')) sections.push(() => buzzerSection(PORT + 5));
  if (want('db')) sections.push(() => doubleBlindSection(PORT + 6));
  if (want('disconnect')) sections.push(() => disconnectSection(PORT + 7));
  if (want('robust')) sections.push(() => robustSection(PORT + 8));
  if (want('leaks')) sections.push(() => leakSection(PORT + 9));
  if (want('maps')) sections.push(() => mapsSection(PORT + 0));
  if (want('crawl')) sections.push(() => crawlSection(PORT + 1));
  if (want('sizes')) sections.push(() => sizeSection(PORT + 2));
  if (want('settings')) sections.push(() => settingsSection(PORT + 3));
  if (want('toggles')) sections.push(() => togglesSection(PORT + 4));
  if (want('bigmatch')) sections.push(() => bigMatchSection(PORT + 5));
  if (want('bigperf')) sections.push(() => bigPerfSection(PORT + 6));
  if (want('squeeze')) sections.push(() => squeezeSection(PORT + 8));
  if (want('guards')) sections.push(() => guardsSection(PORT + 9));
  // v3
  if (want('seekclimb')) sections.push(() => seekClimbSection(PORT + 1));
  if (want('seekguards')) sections.push(() => seekGuardsSection(PORT + 2));
  if (want('spectate')) sections.push(() => spectateSection(PORT + 3));
  if (want('huntpaint')) sections.push(() => huntPaintSection(PORT + 4));
  if (want('timing')) sections.push(() => timingLocalSection(PORT + 5));
  if (want('timinglive')) sections.push(() => timingLiveSection(PORT + 6));
  if (want('settings3')) sections.push(() => settings3Section(PORT + 7));
  if (want('v3house')) sections.push(() => v3MatchSection(PORT + 8, 'house'));
  if (want('v3cu')) sections.push(() => v3MatchSection(PORT + 9, 'cuboulder'));
  if (want('shots3')) {
    sections.push(async () => {
      console.log('\n# v3 screenshots: settings (timing, rules), seeker on a wall, hider HUD, watch, free cam — phone, landscape, laptop; light + dark');
      for (const scheme of ['light', 'dark']) {
        for (const [device, viewport, tag] of [['iPhone 13', null, 'phone'], ['iPhone 13', { width: 844, height: 390 }, 'land'], ['Desktop Chrome', { width: 1280, height: 800 }, 'desk']]) {
          if (process.env.SHOTS3 && !process.env.SHOTS3.split(',').includes(`${tag}-${scheme}`)) continue; // e.g. SHOTS3=land-light
          const h = await shots3Run(PORT + 0, { colorScheme: scheme, device, viewport, prefix: `v3-${tag}-${scheme}` }); await h.close();
        }
      }
    });
  }
  if (want('shots2')) {
    sections.push(async () => {
      console.log('\n# v2 screenshots: settings panel (phone, landscape, laptop; light + dark) and the new mechanics');
      for (const scheme of ['light', 'dark']) {
        let h = await shotsRun(PORT + 7, { colorScheme: scheme, device: 'iPhone 13', prefix: `v2-phone-${scheme}`, mechanics: true }); await h.close();
        h = await shotsRun(PORT + 7, { colorScheme: scheme, device: 'iPhone 13', viewport: { width: 844, height: 390 }, prefix: `v2-land-${scheme}`, mechanics: scheme === 'light' }); await h.close();
        h = await shotsRun(PORT + 7, { colorScheme: scheme, device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, prefix: `v2-desk-${scheme}`, mechanics: false }); await h.close();
        h = await minimapShot(PORT + 7, { colorScheme: scheme, prefix: `v2-big-${scheme}` }); await h.close();
      }
    });
  }
  for (const run of sections) {
    try { await run(); } catch (e) { console.error(e); failures++; }
  }
  if (failures) { console.error(`\n${failures} section(s) failed`); process.exitCode = 1; } else console.log('\nALL GOOD');
})();
