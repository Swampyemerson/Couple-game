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

const FAST = { hide: 12000, seek: 15000, title: 700, recap: 2500, found: 2200, final: 3000, seekLead: 900, resume: 1500, maxDpr: 0.6, noTips: true }; // final: the match's own final card (12 s live) before the hub end card
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
    // (pro pass: the hider is paid for the seconds actually survived + the bonus, not the whole clock)
    assert(rec && !rec.found && rec.outOfPellets && rec.ms < FAST.seek && Math.abs(rec.points - (rec.blendPts || 0) - 30 - rec.ms / 1000) <= 1, `round ${round}: out of pellets at ${rec && (rec.ms / 1000).toFixed(1)} s → hider survives (+${rec && rec.points}, the time survived + 30)`);
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
    assert(rb.size === 'huge' && rb.pellets === 8 && rb.blink === 'on' && rb.escapes === 1 && rb.headStart === 10 && rb.seekSpeed === 'normal' && rb.heartbeat === false && rb.minimap === true, 'Easy preset applied on the guest (huge, 8 pellets, blinks on, 1 escape, 10 s head start, normal seeker, no heartbeat)');
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
// ── maps pass: the session map cache, build-free switches and rematch, chunk culling ──────────
/** Drive a hotseat match to the hub's end card (curtains, Ready, Next). */
async function playToEnd(a, limitMs = 150000) {
  const tEnd = Date.now() + limitMs;
  while (Date.now() < tEnd) {
    if (await a.$('#game-root .gm-end:not([hidden]) [data-g="rematch"]')) return true;
    const ph = await a.evaluate(() => window.__cham && window.__cham.state().phase.name);
    try {
      if (ph === 'curtain') await a.click('[data-act="curtain"]', { timeout: 2000 });
      else if (ph === 'recap') await a.click('[data-act="next"]', { timeout: 2000 });
      else if (ph === 'hide') await a.click('.chm-acts [data-act="ready"]', { timeout: 2000 });
    } catch { /* the phase moved on */ }
    await wait(350);
  }
  return false;
}
async function mapCacheSection(port) {
  console.log('\n# maps pass: session map cache, deferred lobby switches, no relinks, chunk culling hook, build-free rematch');
  const h = await launch({ port, only: ['chameleon'], who: ['a'], coarse: true });
  const a = h.a;
  try {
    await arm(a, { ...FAST, hide: 2500, seek: 2500, recap: 1200, found: 900, final: 1500, title: 300, maxDpr: 0.5 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    const b0 = await hook(a, 'bootInfo');
    assert(b0.warm && b0.warm.slices >= 1 && !b0.reused, `boot compiles in slices behind the loading card (${JSON.stringify(b0.warm)}), ${b0.programs} programs`);
    const ids = await hook(a, 'mapIds');
    const sw = (id) => a.evaluate((m) => { const t = performance.now(); window.__cham.setRules({ map: m }); return performance.now() - t; }, id);
    const cold = {};
    for (const id of ids.slice(1).concat(ids[0])) cold[id] = Math.round(await sw(id));
    const p1 = (await hook(a, 'perf')).programs;
    assert(p1 === b0.programs, `switching through all ${ids.length} maps links no program (${b0.programs} → ${p1}; CU's backdrop is in the boot compile)`);
    const back = ids[ids.length - 1]; await sw(back);
    // best of three per cached map (a GC or a busy box can land on any one switch)
    const warm = [];
    for (const id of [ids[0], back]) { let best = Infinity; for (let k = 0; k < 3; k++) { await sw(id === ids[0] ? back : ids[0]); await wait(120); best = Math.min(best, await sw(id)); await wait(120); } warm.push(Math.round(best)); }
    const cache = (await hook(a, 'bootInfo')).cache;
    console.log(`  cold switch ms ${JSON.stringify(cold)}; cached ${warm.join(' / ')} ms; cache ${cache.map((c) => `${c.id} ${(c.bytes / 1048576).toFixed(1)} MB`).join(', ')}`);
    assert(Math.max(...warm) < 60, `a map seen this session is a scene swap (${warm.join(' / ')} ms JS, < 60)`);
    assert(cache.length >= 2 && cache.length <= 3, `the cache keeps 2–3 maps (${cache.length})`);
    // a real arrow tap: the click handler builds nothing, the card shows the next map at once
    await a.evaluate(() => { window.__clk = []; window.addEventListener('click', () => { window.__clk.push(performance.now()); }, true); window.addEventListener('click', () => { const t = window.__clk.pop(); window.__clkMs = performance.now() - t; }, false); });
    const before = (await st(a)).mapId;
    await a.tap('.chm-mapcard .chm-arrow[aria-label="Next map"]');
    const clickMs = await a.evaluate(() => window.__clkMs);
    const nm = await a.evaluate(() => document.querySelector('.chm-mapinfo b').textContent);
    await a.waitForFunction((b0) => window.__cham.state().mapId !== b0, before, { timeout: 15000 });
    assert(clickMs < 50, `the arrow's tap handler takes ${clickMs.toFixed(1)} ms (the build runs a frame later, < 50)`);
    assert(nm && nm.length > 2, `the card shows the next map right away (${nm})`);
    // chunk culling hook: tweak({ hideMap }) survives cullChunks, perf() counts drawn chunks
    await hook(a, 'setRules', { map: 'house' }); await wait(500);
    const c0 = (await hook(a, 'perf')).chunksDrawn;
    await hook(a, 'tweak', { hideMap: true }); await wait(500);
    const c1 = (await hook(a, 'perf')).chunksDrawn;
    await hook(a, 'tweak', { hideMap: false }); await wait(500);
    const c2 = (await hook(a, 'perf')).chunksDrawn;
    assert(c0 > 0 && c1 === 0 && c2 > 0, `perf().chunksDrawn counts drawn chunks (${c0}), tweak({ hideMap }) holds across frames (${c1}), and lets go (${c2})`);
    // rematch: the stage is parked across the remount and reused
    await hook(a, 'setRules', { map: 'cuboulder', rules: { rounds: 2 } });
    await a.click('[data-act="start"]');
    assert(await playToEnd(a), 'a quick hotseat match reaches the end card');
    await wait(400);
    const pr = (await hook(a, 'perf')).programs;
    const t0 = Date.now();
    await a.click('#game-root .gm-end [data-g="rematch"]');
    await waitReady(a);
    const ms = Date.now() - t0;
    const b1 = await hook(a, 'bootInfo');
    assert(b1.reused && b1.programs === pr, `Rematch reuses the parked stage: ready ${ms} ms after the tap, programs ${pr} → ${b1.programs}, no rebuild`);
    assert((await a.evaluate(() => window.__chamGL)) === 1, 'one GL stage alive after the rematch');
    await hook(a, 'setRules', { map: 'living' }); await wait(300);
    assert((await st(a)).mapId === 'living' && (await hook(a, 'perf')).calls > 0, 'the reused stage switches maps and draws');
    await h.closeGame(a); await wait(400);
    const left = await a.evaluate(() => ({ gl: window.__chamGL || 0, canvases: document.querySelectorAll('canvas').length }));
    assert(left.gl === 0 && left.canvases === 0, `closing after a rematch tears the stage down (${JSON.stringify(left)})`);
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'mapcache-FAIL').catch(() => {});
  } finally { await h.close(); }
}

// ── maps QA round 1: cold builds in slices, the cache released on close / trimmed when hidden ──
async function mapSliceSection(port) {
  console.log('\n# maps QA round 1: cold map builds in slices (boot, lobby arrows), a burst drops half-built maps, the cache trimmed on pagehide and released on close');
  const h = await launch({ port, only: ['chameleon'], who: ['a'], coarse: true });
  const a = h.a;
  try {
    const cdp = await a.context().newCDPSession(a);
    const mem = async () => { await cdp.send('HeapProfiler.collectGarbage'); await wait(250); await cdp.send('HeapProfiler.collectGarbage'); const u = await cdp.send('Runtime.getHeapUsage'); return (u.usedSize + (u.backingStorageSize || 0)) / 1048576; };
    await h.openGames(a); await wait(500);
    const m0 = await mem();
    await a.evaluate(() => {
      window.__lt = []; window.__raf = 0;
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] }); } catch { /* no longtask API */ }
      const tick = () => { window.__raf++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    });
    await arm(a, { ...FAST, maxDpr: 0.5 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    const b0 = await hook(a, 'bootInfo');
    const boot = b0.builds[b0.builds.length - 1];
    // (bounds with room for a busy box: the sandbox shares its CPU; at rest steps are ≤ 6 ms. The
    // p90 is the code's step size; the longest step also holds any GC pause or preemption)
    assert(boot && boot.id === 'living' && boot.slices >= 2 && boot.p90 < 16 && boot.over50 <= 2, `the boot builds the lobby map in slices behind the loading card (${JSON.stringify(boot)})`);
    // real taps on the lobby arrow through every map: each is a cold build (the cache keeps 3)
    const ids = await hook(a, 'mapIds');
    const rows = [];
    for (let i = 1; i <= ids.length; i++) {
      const want = ids[i % ids.length];
      const t0 = await a.evaluate(() => { window.__raf0 = window.__raf; return performance.now(); });
      await a.tap('.chm-mapcard .chm-arrow[aria-label="Next map"]');
      await a.waitForFunction((m) => window.__cham.state().mapId === m, want, { timeout: 30000 });
      const r0 = await a.evaluate((t) => ({ ms: performance.now() - t, frames: window.__raf - window.__raf0, t1: performance.now() }), t0);
      await wait(150); // long-task entries arrive a little late
      const r = { ...r0, longest: await a.evaluate(([t, t1]) => window.__lt.filter((x) => x[0] >= t && x[0] <= t1).reduce((m, x) => Math.max(m, x[1]), 0), [t0, r0.t1]) };
      const bi = await hook(a, 'bootInfo'); const bs = bi.builds[bi.builds.length - 1];
      rows.push({ id: want, ms: Math.round(r.ms), frames: r.frames, longest: Math.round(r.longest), slices: bs.id === want ? bs.slices : 0, step: bs.id === want ? bs.maxMs : 0, at: bs.id === want ? bs.maxAt : '', p90: bs.id === want ? bs.p90 : 0, o50: bs.id === want ? bs.over50 : 0, sp90: bs.id === want ? bs.sliceP90 : 0, slice: bs.id === want ? bs.maxSlice : 0 });
      await wait(250);
    }
    console.log('  cold switches by arrow taps: ' + rows.map((r) => `${r.id} ${r.ms} ms / ${r.frames} frames / ${r.slices} slices (p90 ${r.sp90} / longest ${r.slice} ms; steps p90 ${r.p90} / max ${r.step} at ${r.at}, ${r.o50} over 50 ms), longest task ${r.longest}`).join(' · '));
    const big = rows.filter((r) => r.id === 'cuboulder' || r.id === 'house');
    assert(big.every((r) => r.slices >= 3 && r.frames >= 3), `the big maps build over several frames while the old diorama keeps drawing (${big.map((r) => `${r.id}: ${r.slices} slices, ${r.frames} frames`).join(', ')})`);
    // Step and slice times are wall time. On this shared 4-core box (load 8–16, the software-GL GPU
    // processes run at a higher priority than the pages) a preemption or a GC pause lands on a step
    // or two: 135–206 ms on steps that take 4–14 ms at rest. So the code's own sizes are the p90s,
    // and only a couple of steps per map may run past 50 ms (an unsliced build is one big step).
    const worstStep = Math.max(...rows.map((r) => r.step)); const worstP90 = Math.max(...rows.map((r) => r.p90)); const worstO50 = Math.max(...rows.map((r) => r.o50));
    assert(worstP90 < 16 && worstO50 <= 2, `build steps are small: p90 ≤ ${worstP90} ms on every map, at most ${worstO50} step(s) a map over 50 ms (the longest ${worstStep} ms; a whole CU build was one 0.3–0.8 s task at 4x)`);
    // the build's own slices (frames in software GL are long tasks by themselves on a busy box, so
    // the longest task is only reported)
    const worstSlice = Math.max(...rows.map((r) => r.slice)); const worstSP90 = Math.max(...rows.map((r) => r.sp90));
    assert(worstSP90 < 40, `build slices keep to their budget: p90 ≤ ${worstSP90} ms on every map (16 ms + one step; the longest ${worstSlice} ms; the longest task, frames included: ${Math.max(...rows.map((r) => r.longest))} ms)`);
    // a newer tap drops a half-built map: Next while the House is building goes on to the Market
    await hook(a, 'setRules', { map: 'studio' }); await wait(300);
    const n0 = (await hook(a, 'bootInfo')).builds.length;
    const next = () => a.evaluate(() => document.querySelector('.chm-mapcard .chm-arrow[aria-label="Next map"]').click());
    await next();
    await a.waitForFunction(() => window.__cham.bootInfo().jobs.some((j) => j.id === 'house'), null, { timeout: 15000, polling: 5 });
    const mid = await hook(a, 'bootInfo');
    await next();
    await a.waitForFunction(() => window.__cham.state().mapId === 'market', null, { timeout: 30000 });
    await wait(300);
    const bb = await hook(a, 'bootInfo');
    const built = bb.builds.slice(n0).map((x) => x.id);
    assert(built.join() === 'market' && !bb.jobs.length && (await st(a)).mapId === 'market', `Next while the House was building (${JSON.stringify(mid.jobs)}) dropped it and built the Market only (${built.join(', ')}; jobs left ${JSON.stringify(bb.jobs)})`);
    const last = 'market';
    // pagehide (and a hidden page) keeps only the map on screen
    const c0 = bb.cache.map((c) => c.id);
    await a.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    const c1 = (await hook(a, 'bootInfo')).cache.map((c) => c.id);
    assert(c0.length >= 2 && c1.length === 1 && c1[0] === last, `pagehide trims the map cache to the map on screen (${c0.join(', ')} → ${c1.join(', ')})`);
    await a.tap('.chm-mapcard .chm-arrow[aria-label="Next map"]');
    await a.waitForFunction((m) => window.__cham.state().mapId === m, ids[(ids.indexOf(last) + 1) % ids.length], { timeout: 30000 });
    assert((await hook(a, 'perf')).calls > 0, 'maps still switch and draw after the trim');
    // close: nothing of the cache stays behind
    await h.closeGame(a); await wait(1200);
    const m1 = await mem();
    console.log(`  JS heap + array buffers: hub ${m0.toFixed(1)} MB, after the game closed ${m1.toFixed(1)} MB`);
    assert(m1 - m0 < 8, `closing the game releases the map cache (+${(m1 - m0).toFixed(1)} MB over the hub; it kept ~28 MB before)`);
    await arm(a, { ...FAST, maxDpr: 0.5 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    const c2 = (await hook(a, 'bootInfo')).cache;
    assert(c2.length === 1 && c2[0].hits <= 1, `a reopen starts from an empty cache: the lobby map built afresh (${JSON.stringify(c2.map((c) => ({ id: c.id, hits: c.hits })))})`);
    // closing while the boot is still building the lobby map (CU, the last map picked, cold after
    // the close): the stage it made goes too
    await h.closeGame(a); await wait(400);
    await arm(a, { ...FAST, maxDpr: 0.5 });
    await h.startLive(a, 'chameleon', 'local');
    await a.waitForFunction(() => (window.__chamGL || 0) >= 1, null, { timeout: 30000, polling: 5 });
    const midBoot = await a.evaluate(() => ({ ready: !!(window.__cham && window.__cham.ready) }));
    await h.closeGame(a); await wait(1500);
    const left = await a.evaluate(() => ({ gl: window.__chamGL || 0, canvases: document.querySelectorAll('canvas').length, inst: window.__chamCount || 0 }));
    assert(!midBoot.ready && left.gl === 0 && left.canvases === 0 && left.inst === 0, `closing mid-boot (the lobby map still building) disposes the stage (${JSON.stringify(left)})`);
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'mapslice-FAIL').catch(() => {});
  } finally { await h.close(); }
}

// ── maps pass: Mix it up, Today's hide, where you start ──────────────────────────────────────
async function varietySection(port) {
  console.log('\n# maps pass: Mix it up (a new map every round), Today\'s hide, "You start in the …"');
  // pure parts (Node): the per-round plan, today's setup, today's board
  {
    const imp = (f) => import(require('url').pathToFileURL(path.join(__dirname, '../../../js/games/chameleon', f)).href);
    const [mp, rc] = await Promise.all([imp('maps.js'), imp('records.js')]);
    const small = mp.mixPlan('m1', 'living', 6); const big = mp.mixPlan('m1', 'house', 6); const paired = mp.mixPlan('m1', 'house', 6, 2);
    const pool = (ids) => ids.map((id) => mp.mapPool(mp.MAPS.find((m) => m.id === id)));
    assert(JSON.stringify(small) === JSON.stringify(mp.mixPlan('m1', 'living', 6)) && small[0] === 'living' && small.every((id, i) => !i || id !== small[i - 1]) && pool(small).every((p) => p === 'S') && pool(big).every((p) => p === 'XL'), `mixPlan is seeded, starts on the picked map, never repeats a round and stays in its pool (${small.join(' ')} · ${big.join(' ')})`);
    assert(paired[0] === 'house' && paired[0] === paired[1] && paired[2] === paired[3] && paired[4] === paired[5] && paired[1] !== paired[2] && paired[3] !== paired[4], `Hide & Seek pairs the rounds: you each hide once on every map (${paired.join(' ')})`);
    const days = []; for (let i = 0; i < 8; i++) days.push(mp.dailyPlan(mp.dayKey(new Date(2026, 0, 1 + i))));
    assert(new Set(days.map((d) => d.map)).size >= 6 && days.every((d) => d.rounds === 2 && d.twist && ['a', 'b'].includes(d.first)), `Today's hide changes every day (${days.map((d) => `${d.map}/${d.twist.id}`).join(' ')})`);
    const api = { name: (w) => (w === 'a' ? 'Emerson' : 'Sydney') };
    const r1 = rc.recordRound({}, { hider: 'b', seeker: 'a', found: true, ms: 41000 }, { mode: 'hs', names: { a: 'Emerson', b: 'Sydney' }, daily: '2026-10-08' });
    const r2 = rc.recordRound(r1.patch, { hider: 'a', seeker: 'b', found: false, ms: 70000 }, { mode: 'hs', names: { a: 'Emerson', b: 'Sydney' }, daily: '2026-10-08' });
    const line = rc.dailyLine(api, { ...r1.patch, ...r2.patch }, '2026-10-08').replace(/<[^>]+>/g, '');
    assert(/Today.*Emerson.*1:10.*Sydney.*0:41.*Emerson leads/.test(line) && rc.dailyLine(api, {}, '2026-10-08') === '', `today's board: "${line}"`);
  }
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    // (mixSeed 'cu1' plans House, House, CU, CU: round 3's prefetch is the biggest map, the case
    // that used to run short in a 3.5 s test recap; VARIETY_SEED=… for another plan)
    await startPair(h, { ...FAST, hide: 6000, seek: 6000, recap: 3500, title: 3000, noTips: true, mixSeed: process.env.VARIETY_SEED || 'cu1' });
    // Mix it up chip: both phones see it on
    await a.tap('.chm-lobby .chm-presets .chm-mix');
    await b.waitForFunction(() => window.__cham.state().setup.mix === true, null, { timeout: 8000 });
    assert((await st(a)).setup.mix && await a.isVisible('.chm-mix.on'), 'the host taps Mix it up; the guest\'s setup follows');
    await shot(a, 'variety-lobby-mix');
    // Today's hide: the same map / size / first hider on both phones, from the date
    await a.tap('.chm-presets .chm-today');
    await b.waitForFunction(() => !!window.__cham.state().setup.daily, null, { timeout: 8000 });
    const sa = (await st(a)).setup; const sb = (await st(b)).setup;
    assert(sa.daily === sb.daily && sa.map === sb.map && sa.first === sb.first && sa.rules.size === sb.rules.size && !sa.mix, `Today's hide: ${sa.daily} → ${sa.map}, ${sa.rules.size}, ${sa.first} hides first, ${sa.rules.rounds} rounds on both phones (mix off)`);
    await b.waitForFunction((m) => window.__cham.state().mapId === m, sa.map, { timeout: 20000 });
    await shot(a, 'variety-lobby-today');
    await a.tap('.chm-presets [data-v="classic"]');
    await b.waitForFunction(() => !window.__cham.state().setup.daily, null, { timeout: 8000 });
    assert(!(await st(a)).setup.daily, 'any other change makes it the host\'s own setup again');
    // Mix it up on the big maps: a 4-round match on the House; rounds 1–2 there (each hides once),
    // round 3 on another big map
    await hook(a, 'setRules', { map: 'house', mix: true, first: 'b', rules: { rounds: 4 } });
    await b.waitForFunction(() => window.__cham.state().mapId === 'house', null, { timeout: 20000 });
    // the hider (Sydney) is told where she starts: watch both title cards from inside the pages
    for (const p of [a, b]) await p.evaluate(() => { window.__startTxt = null; window.__titleSeen = false; const poll = () => { const t = document.querySelector('.chm-titlecard'); if (t) { window.__titleSeen = true; const e = t.querySelector('.chm-start'); if (e && !window.__startTxt) window.__startTxt = e.textContent; } if (!window.__cham || window.__cham.state().phase.name !== 'hide') requestAnimationFrame(poll); }; requestAnimationFrame(poll); });
    await a.click('[data-act="start"]');
    await b.waitForFunction(() => window.__startTxt, null, { timeout: 15000 }).catch(() => {});
    await shot(b, 'variety-title-start');
    const startTxt = await b.evaluate(() => window.__startTxt);
    await waitPhase(a, 'hide', 20000);
    const aStart = await a.evaluate(() => ({ seen: window.__titleSeen, start: window.__startTxt }));
    assert(startTxt && /You start in the /.test(startTxt) && aStart.seen && !aStart.start, `round 1 title: the hider reads "${startTxt}", the seeker isn't told`);
    const m1 = (await st(a)).match;
    assert(Array.isArray(m1.maps) && m1.maps[0] === 'house' && m1.maps[1] === 'house' && m1.maps[2] !== 'house', `the match plans a map per pair of rounds (${JSON.stringify(m1.maps)})`);
    // rounds 1 and 2 on the House: the hiders tap Ready, the seek clock runs out
    for (const [hider, r] of [[b, 1], [a, 2]]) {
      await hider.waitForFunction((rr) => { const s = window.__cham.state(); return s.phase.name === 'hide' && s.phase.round === rr; }, r, { timeout: 40000 });
      if (r === 2) await a.evaluate(() => { window.__lt2 = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt2.push([e.startTime, e.duration, window.__cham && window.__cham.state().phase.name]); }).observe({ entryTypes: ['longtask'] }); } catch { /* no longtask API */ } });
      await wait(500);
      await hider.click('.chm-acts [data-act="ready"]');
      await a.waitForFunction((rr) => { const s = window.__cham.state(); return s.phase.name === 'recap' && s.phase.round === rr; }, r, { timeout: 60000 });
      if (r === 1) { const nl1 = await a.evaluate(() => (document.querySelector('.chm-nextline') || {}).textContent || ''); assert(!nl1.includes('new map') && (await st(b)).mapId === 'house', `round 2 stays on the House so you each hide there once ("${nl1.trim()}")`); }
    }
    const nl = await a.evaluate(() => { const e = document.querySelector('.chm-nextline'); return e ? e.textContent : ''; });
    assert(nl.includes('new map'), `the recap says what's next: "${nl.trim()}"`);
    await shot(a, 'variety-recap-next');
    // both phones preload round 3's map during round 2 (maps QA round 1: from its hide phase; it
    // was the recap, too short for CU on a busy box)
    for (const p of [a, b]) await p.waitForFunction((m) => window.__cham.bootInfo().cache.some((c) => c.id === m), m1.maps[2], { timeout: 15000 });
    assert(true, `round 3's map (${m1.maps[2]}) was built during round 2 on both phones`);
    // maps QA round 1: in idle-time slices (it was one 0.3–0.8 s task at 4x CPU in the recap)
    await wait(200);
    const pf = (await hook(a, 'bootInfo')).builds.filter((x) => x.id === m1.maps[2]).pop();
    const recapLong = await a.evaluate(() => (window.__lt2 || []).reduce((m, x) => Math.max(m, x[1]), 0));
    // (if round 3 starts first, e.g. two software-GL phones on a very busy box, its loadMap
    // finishes the rest, which must be small)
    // (wall time on a busy box: the p90 is the code's step size, a preemption or GC lands on one step)
    assert(pf && pf.slices >= 2 && pf.p90 < 16 && pf.over50 <= 2 && (!pf.drained || pf.drainMs < 150), `round 3's map (${m1.maps[2]}) was prefetched during round 2 (from its hide phase) in ${pf ? pf.slices : '?'} idle slices (steps p90 ${pf ? pf.p90 : '?'} ms, ${pf ? pf.over50 : '?'} over 50 ms, longest ${pf ? `${pf.maxMs} ms at ${pf.maxAt}` : '?'}), ${pf && pf.drained ? `the round's start finished the last ${pf.drainMs} ms` : 'done before the round'} (round 2's longest task, frames included, ${Math.round(recapLong)} ms)`);
    await a.waitForFunction(() => { const s = window.__cham.state(); return s.phase.name === 'hide' && s.phase.round === 3; }, null, { timeout: 30000 });
    await b.waitForFunction((m) => window.__cham.state().mapId === m, m1.maps[2], { timeout: 15000 });
    assert((await st(a)).mapId === m1.maps[2] && (await st(b)).match.map === m1.maps[2], `round 3 plays on ${m1.maps[2]} on both phones`);
    await shot(b, 'variety-round3');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'variety-FAIL-a').catch(() => {}); await shot(b, 'variety-FAIL-b').catch(() => {});
  } finally { await h.close(); }
}

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
    const burst0 = Date.now();
    for (let i = 0; i < 4; i++) { await strokeOnBody(b, true); await wait(120); }
    const burstS = (Date.now() - burst0) / 1000; // a loaded software-GL box can take seconds per stroke
    await wait(1600);
    const g1 = (await st(a)).live.got;
    const cap = Math.min(4, Math.max(3, Math.floor(burstS) + 1));
    assert(g1 - g0 >= 1 && g1 - g0 <= cap, `four quick strokes in ${burstS.toFixed(1)} s → ${g1 - g0} update(s) (≤ 1 a second: ≤ ${cap})`);
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

// ── pro pass (paint owner): codec cost, dab culling, brush feedback ─────────────────
async function paintFeelSection(port) {
  console.log('\n# paint: lock/live codec cost on a stamped CU skin, dab culling, brush cursor / sound / fill + stamp juice');
  const SH = process.env.PAINT_SHOTS || SHOTS;
  fs.mkdirSync(SH, { recursive: true });
  const h = await launch({ port, only: ['chameleon'], who: ['a'], device: 'iPhone 13' });
  const a = h.a;
  try {
    await arm(a, { ...SLOW, hide: 300000, maxDpr: 1 }); // (a loaded sandbox can take > 90 s over the brush shots)
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await hook(a, 'setRules', { map: 'cuboulder', first: 'b', rules: { size: 'large' } });
    await a.tap('[data-act="start"]');
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(400);
    assert(await camoHide(a) === 'wall', 'hider flat on the CU wall');
    await a.tap('.chm-acts [data-act="paint"]');
    await wait(900);
    // stamp: the outline flashes white → off in 0.25 s
    await a.tap('.chm-tool[data-tool="stamp"]');
    const pf0 = await hook(a, 'paintPerf');
    assert(pf0.pfx.stamps === 1, 'a stamp starts the outline wipe');
    await wait(700);
    assert(!(await hook(a, 'paintPerf')).pfx.stamp, '…which is over after 0.25 s');
    // codec: lock a freshly stamped skin (the moment the hider taps Ready)
    const lock = await a.evaluate(() => {
      const c0 = window.__cham.paintPerf('b').colours;
      const t0 = performance.now(); window.__cham.lockPaintNow('b'); const t1 = performance.now();
      const pf = window.__cham.paintPerf('b');
      const t2 = performance.now(); window.__cham.lockPaintNow('b'); const t3 = performance.now();
      return { before: c0, after: pf.colours, ms: t1 - t0, again: t3 - t2, lp: pf.lastPaint, lp2: window.__cham.paintPerf("b").lastPaint };
    });
    console.log(`  lock split: encode ${lock.lp.encMs.toFixed(1)} ms + blend ${lock.lp.blendMs.toFixed(1)} ms; again encode ${lock.lp2.encMs.toFixed(2)} + blend ${lock.lp2.blendMs.toFixed(1)}`);
    console.log(`  stamped skin: ${lock.before} colours → ${lock.after}; lock ${lock.ms.toFixed(1)} ms, again ${lock.again.toFixed(2)} ms; blob ${lock.lp.bytes} B / ${lock.lp.b64} b64 (${lock.lp.chunks} chunk${lock.lp.chunks === 1 ? '' : 's'})`);
    assert(lock.after <= 32, `the lock quantises to ≤ 32 colours (${lock.after})`);
    assert(lock.ms < 30, `lock on a fresh stamped skin is cheap: ${lock.ms.toFixed(1)} ms (was 25–66 ms at 1x)`);
    assert(lock.lp2.encMs < 1, `a second lock on the same version reuses the blob (encode ${lock.lp2.encMs.toFixed(2)} ms)`);
    assert(lock.lp.chunks <= 4, `stamped blob ${lock.lp.b64} chars ≤ 4 chunks`);
    // warm: re-stamp + lock a few times (what a hider repainting under the hunt pays per update)
    const warm = await a.evaluate(() => {
      const out = [];
      for (let k = 0; k < 5; k++) {
        window.__cham.stampNow();
        const t0 = performance.now(); window.__cham.lockPaintNow('b'); const lp = window.__cham.paintPerf('b').lastPaint;
        out.push({ ms: performance.now() - t0, enc: lp.encMs, blend: lp.blendMs, bytes: lp.bytes });
      }
      return out;
    });
    const medOf = (xs) => xs.slice().sort((x, y) => x - y)[xs.length >> 1];
    console.log(`  warm stamp→lock ×5: total ${warm.map((x) => x.ms.toFixed(1)).join('/')} ms; encode median ${medOf(warm.map((x) => x.enc)).toFixed(1)} ms, blend median ${medOf(warm.map((x) => x.blend)).toFixed(1)} ms; ${warm[4].bytes} B`);
    assert(medOf(warm.map((x) => x.enc)) < 8, `warm encode (quantise + pack) median ${medOf(warm.map((x) => x.enc)).toFixed(1)} ms`);
    // brush: every size and hardness, with the preview ring on the body
    const shots = [];
    const perStroke = [];
    for (const [size, hard] of [[0, true], [1, true], [2, true], [0, false], [1, false], [2, false]]) {
      await hook(a, 'setPaint', { size, hard, tool: 'brush', rgb: [size === 0 ? 230 : 40, 90 + size * 60, hard ? 60 : 220] });
      const [x, y] = await hook(a, 'bodyPoint', 0);
      assert(await hook(a, 'brushPreviewNow'), `size ${'SML'[size]} ${hard ? 'hard' : 'soft'}: the new brush shows on the body`);
      await a.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const f = path.join(SH, `brush-${'SML'[size]}-${hard ? 'hard' : 'soft'}.png`);
      await a.screenshot({ path: f, clip: { x: Math.max(0, x - 120), y: Math.max(0, y - 120), width: 240, height: 240 } });
      shots.push(f);
      const p0 = await hook(a, 'paintPerf');
      const t0 = Date.now();
      await strokeOnBody(a, true);
      const p1 = await hook(a, 'paintPerf');
      const dabs = p1.dabs - p0.dabs; const tex = p1.dabTexels - p0.dabTexels;
      perStroke.push({ size: 'SML'[size], hard, dabs, tex, ms: Date.now() - t0 });
      assert(dabs > 0 && tex / dabs < p1.texels * 0.6, `size ${'SML'[size]}: ${dabs} dabs walked ${Math.round(tex / dabs)} texels each (of ${p1.texels}: part culling)`);
    }
    console.log('  strokes: ' + perStroke.map((x) => `${x.size}${x.hard ? 'h' : 's'} ${x.dabs} dabs/${x.ms} ms`).join(', '));
    await a.waitForFunction(() => !window.__cham.paintPerf().pfx.preview, null, { timeout: 8000 });
    assert(true, 'the preview ring goes away by itself');
    // fill: the part swells 1.08 → 1
    const hf0 = await hook(a, 'paintHash', 'b');
    await a.tap('.chm-tool[data-tool="fill"]');
    const [fx, fy] = await hook(a, 'bodyPoint', 0);
    await a.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      const mk = (type) => new PointerEvent(type, { pointerId: 31, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 });
      el.dispatchEvent(mk('pointerdown')); setTimeout(() => el.dispatchEvent(mk('pointerup')), 60);
    }, [fx, fy]);
    await a.waitForFunction(() => window.__cham.paintPerf().pfx.fills === 1, null, { timeout: 2000 });
    assert(true, 'a fill swells the filled part');
    await wait(500);
    assert(!(await hook(a, 'paintPerf')).pfx.fill && await hook(a, 'paintHash', 'b') !== hf0, '…and settles, the part filled');
    const lock2 = await a.evaluate(() => { const t0 = performance.now(); window.__cham.lockPaintNow('b'); return { ms: performance.now() - t0, lp: window.__cham.paintPerf('b').lastPaint }; });
    console.log(`  painted skin lock ${lock2.ms.toFixed(1)} ms, blob ${lock2.lp.bytes} B (${lock2.lp.chunks} chunk${lock2.lp.chunks === 1 ? '' : 's'})`);
    assert(lock2.ms < 40, `lock after brushing ${lock2.ms.toFixed(1)} ms`);
    if (process.env.PAINT_MONT) { try { require('child_process').execFileSync('node', [process.env.PAINT_MONT, path.join(SH, 'brush-montage.png'), '720', '480', ...shots]); } catch (e) { console.log('  (montage skipped)', e.message.split('\n')[0]); } }
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'paintfeel-FAIL').catch(() => {});
  } finally { await h.close(); }
}

// ── paint owner, second pass: the stamp wipe, the fill flood, the live camo meter ──────────
const rectsOf = (p, sels) => p.evaluate((ss) => { const o = {}; for (const k of ss) { const e = document.querySelector(k); if (!e || e.hidden || getComputedStyle(e).display === 'none') continue; const b = e.getBoundingClientRect(); if (b.width && b.height) o[k] = [b.left, b.top, b.right, b.bottom]; } return o; }, sels);
const overlap = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
async function tapBody(p, id = 61) {
  const [x, y] = await hook(p, 'bodyPoint', 0);
  await p.evaluate(([cx, cy, pid]) => {
    const el = document.elementFromPoint(cx, cy);
    const mk = (type) => new PointerEvent(type, { pointerId: pid, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, cancelable: true, isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 });
    el.dispatchEvent(mk('pointerdown')); setTimeout(() => el.dispatchEvent(mk('pointerup')), 60);
  }, [x, y, id]);
}
async function paintJuiceSection(port) {
  console.log('\n# paint: stamp wipe + fill flood (settle-before-read), the live camo meter (sliced scoring, grade pops, layout), the lock reusing its score');
  const SH = process.env.PAINT_SHOTS || SHOTS;
  fs.mkdirSync(SH, { recursive: true });
  const h = await launch({ port, only: ['chameleon'], who: ['a'], device: 'iPhone 13' });
  const a = h.a;
  const shots = [];
  const snap = async (n) => { const f = path.join(SH, `juice-${n}.png`); await a.screenshot({ path: f }); shots.push(f); };
  try {
    await arm(a, { ...SLOW, hide: 300000, maxDpr: 0.6 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await hook(a, 'setRules', { map: 'living', first: 'b', rules: { size: 'large', blendBonus: 10 } });
    await a.tap('[data-act="start"]');
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(400);
    assert(await camoHide(a) === 'wall', 'hider flat on the Living Room wallpaper');
    assert(!(await hook(a, 'camo')).shown, 'no camo meter before the paint tools open');
    await a.tap('.chm-acts [data-act="paint"]');
    await a.waitForFunction(() => { const c = window.__cham.camo(); return c.shown && c.score >= 0 && c.meter && c.meter.text === `${c.score}%`; }, null, { timeout: 10000 });
    let c = await hook(a, 'camo');
    assert(c.score >= 10 && c.score < 75, `the meter scores a plain white body on the wallpaper: ${c.score}% "${c.meter.word}"`);
    const plain = c.score; const c0 = c;
    await snap('1-open');
    // stamp: the print wipes up the body; anything that reads the skin settles it first
    await a.tap('.chm-tool[data-tool="stamp"]');
    let rv = await hook(a, 'reveal', null, 'b');
    assert(rv.on && rv.kind === 'stamp' && rv.n > 1000, `the stamp starts a wipe over ${rv.n} texels`);
    await a.waitForFunction(() => !window.__cham.reveal(null, 'b').on, null, { timeout: 3000 });
    assert(true, 'the wipe finishes by itself');
    await a.waitForFunction((p0) => { const k = window.__cham.camo(); return !k.busy && k.score > p0 + 20 && k.meter.text === `${k.score}%`; }, plain, { timeout: 10000 });
    c = await hook(a, 'camo');
    // paint QA1: the score looks from the side too, so a stamp on the busy wallpaper is a good start, not a free Ghost
    assert(c.score >= plain + 25 && c.score < 90 && c.meter.grade >= 1, `after the stamp the meter reads ${c.score}% "${c.meter.word}" (from ${plain}%)`);
    const stamped = c.score;
    assert((c.slices - c0.slices) / Math.max(1, c.runs - c0.runs) >= 3, `re-scoring is sliced over frames (${c.slices - c0.slices} slices for ${c.runs - c0.runs} run${c.runs - c0.runs === 1 ? '' : 's'}; the round's first score is taken at once)`);
    assert(c.meter.pops >= 1 && c.meter.sounds >= 1, `the better grade popped a sticker with a sound (pops ${c.meter.pops}, sounds ${c.meter.sounds}; the +10 star is ONLY=blendfair's)`);
    await snap('2-stamped');
    // a slow wipe, frozen mid-way: part of the body changed, reading the hash settles it
    await hook(a, 'reveal', { stamp: { dur: 30 } });
    const h0 = await hook(a, 'paintHash', 'b');
    await hook(a, 'setPaint', { tool: 'brush' });
    await a.tap('.chm-tool[data-tool="stamp"]');
    await wait(1500);
    rv = await hook(a, 'reveal', null, 'b');
    assert(rv.on && rv.done < rv.n, `a 30 s wipe is part-way after 1.5 s (${rv.done} / ${rv.n} settled)`);
    const h1 = await hook(a, 'paintHash', 'b');
    rv = await hook(a, 'reveal', null, 'b');
    assert(!rv.on && rv.done === rv.n, 'reading the skin (hash) settles the wipe at once');
    assert(typeof h1 === 'number' && h0 !== undefined, `hash after settle ${h1}`);
    await hook(a, 'reveal', { stamp: { dur: 0.36 } });
    // fill floods out from the finger
    await hook(a, 'setPaint', { rgb: [222, 64, 120] });
    await a.tap('.chm-tool[data-tool="fill"]');
    const hf0 = await hook(a, 'paintHash', 'b');
    await tapBody(a);
    await a.waitForFunction(() => window.__cham.paintPerf().pfx.fills >= 1, null, { timeout: 3000 });
    rv = await hook(a, 'reveal', null, 'b');
    assert(rv.kind === 'fill', `a fill starts a flood (${rv.on ? 'running' : 'already settled'}, ${rv.n} texels)`);
    await a.waitForFunction(() => !window.__cham.reveal(null, 'b').on, null, { timeout: 3000 });
    assert(await hook(a, 'paintHash', 'b') !== hf0, '…which settles to the filled region');
    await a.waitForFunction(() => { const k = window.__cham.camo(); return !k.busy && k.meter.text === `${k.score}%`; }, null, { timeout: 10000 });
    c = await hook(a, 'camo');
    assert(c.score < 85, `a pink body scores lower: ${c.score}% "${c.meter.word}"`);
    await snap('3-filled');
    // undo back to the stamp (the pink dissolves away): the meter climbs again
    const rc0 = (await hook(a, 'reveal', null, 'b')).count;
    await a.tap('.chm-tools [data-act="undo"]');
    rv = await hook(a, 'reveal', null, 'b');
    assert(rv.kind === 'undo' && rv.count === rc0 + 1 && rv.n > 1000, `undo dissolves ${rv.n} changed texels back`);
    await a.waitForFunction((s0) => { const k = window.__cham.camo(); return !k.busy && k.score >= s0 - 4 && k.meter.text === `${k.score}%`; }, stamped, { timeout: 10000 });
    c = await hook(a, 'camo');
    assert(true, `undo: back to ${c.score}% (stamped ${stamped}%)`);
    // layout: the meter never covers the tools, poses, top bar or hint (portrait, landscape, SE)
    await hook(a, 'openPoses');
    for (const [w, hh] of [[390, 844], [844, 390], [375, 667]]) {
      await a.setViewportSize({ width: w, height: hh });
      await wait(700);
      const r = await rectsOf(a, ['.chm-meter', '.chm-tools', '.chm-poses', '.chm-top', '.chm-sub', '.chm-hint.on']);
      assert(r['.chm-meter'], `${w}×${hh}: the meter shows`);
      const hits = ['.chm-tools', '.chm-poses', '.chm-top', '.chm-sub', '.chm-hint.on'].filter((k) => overlap(r['.chm-meter'], r[k]));
      assert(!hits.length && r['.chm-meter'][2] <= w && r['.chm-meter'][1] >= 0 && r['.chm-meter'][3] <= hh, `${w}×${hh}: the meter (${r['.chm-meter'].map(Math.round).join(',')}) clear of ${hits.join(', ') || 'everything'}`);
      if (w === 844) await snap('4-landscape');
    }
    await a.setViewportSize({ width: 390, height: 844 });
    await wait(500);
    // the lock reuses the meter's score: nothing to re-score at the tap
    await a.tap('.chm-tools [data-act="paint"]');
    await wait(300);
    assert(!(await hook(a, 'camo')).shown, 'the meter goes with the paint tools');
    const lk = await a.evaluate(() => { const t0 = performance.now(); window.__cham.lockPaintNow('b'); return { ms: performance.now() - t0, lp: window.__cham.paintPerf('b').lastPaint, camo: window.__cham.camo(), locked: window.__cham.blend('b').locked.b }; });
    console.log(`  lock after painting: ${lk.ms.toFixed(1)} ms (encode ${lk.lp.encMs.toFixed(1)} + blend ${lk.lp.blendMs.toFixed(2)}), ${lk.lp.bytes} B`);
    assert(lk.camo.cached && lk.locked === lk.camo.score, `the lock took the meter's ${lk.camo.score}% (what the hider saw) without re-scoring (blend ${lk.lp.blendMs.toFixed(2)} ms)`);
    if (process.env.PAINT_MONT) { try { require('child_process').execFileSync('node', [process.env.PAINT_MONT, path.join(SH, 'juice-montage.png'), '300', '650', ...shots]); } catch (e) { console.log('  (montage skipped)', e.message.split('\n')[0]); } }
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'paintjuice-FAIL').catch(() => {});
  } finally { await h.close(); }
}

// ── paint owner, third pass: smoothed strokes, the x-ray, "Invisible!", zero-garbage undo, 4x CPU costs ──
async function sparseLoop(p, cx, cy, R, moves, id = 43) {
  return p.evaluate(async ([cx, cy, R, moves, pid]) => {
    const pt = (k) => [cx + Math.cos(k * Math.PI * 1.9) * R, cy + Math.sin(k * Math.PI * 1.9) * R];
    const [x0, y0] = pt(0); const el = document.elementFromPoint(x0, y0);
    const mk = (type, x, y) => new PointerEvent(type, { pointerId: pid, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 });
    el.dispatchEvent(mk('pointerdown', x0, y0));
    for (let i = 1; i <= moves; i++) { await new Promise((r) => setTimeout(r, 40)); const [x, y] = pt(i / moves); el.dispatchEvent(mk('pointermove', x, y)); }
    const beforeUp = window.__cham.paintPerf('b').dabs;
    const [x1, y1] = pt(1); el.dispatchEvent(mk('pointerup', x1, y1));
    return { beforeUp, afterUp: window.__cham.paintPerf('b').dabs };
  }, [cx, cy, R, moves, id]);
}
async function paintProSection(port) {
  console.log('\n# paint: smoothed strokes, the meter x-ray (page.tap), "Invisible!", zero-garbage undo, costs at 4x CPU');
  const SH = process.env.PAINT_SHOTS || SHOTS;
  fs.mkdirSync(SH, { recursive: true });
  const h = await launch({ port, only: ['chameleon'], who: ['a'], device: 'iPhone 13' });
  const a = h.a;
  const shots = [];
  const snap = async (n) => { const f = path.join(SH, `pro-${n}.png`); await a.screenshot({ path: f, clip: { x: 0, y: 80, width: 390, height: 520 } }); shots.push(f); };
  try {
    await arm(a, { ...SLOW, hide: 300000, maxDpr: 0.6 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await hook(a, 'setRules', { map: 'living', first: 'b', rules: { size: 'large', blendBonus: 10 } });
    await a.tap('[data-act="start"]');
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(400);
    assert(await camoHide(a) === 'wall', 'hider flat on the Living Room wallpaper');
    await a.tap('.chm-acts [data-act="paint"]');
    await a.waitForFunction(() => { const c = window.__cham.camo(); return c.shown && c.score >= 0 && !c.busy; }, null, { timeout: 10000 });
    // smoothing: a fast loop of 7 moves (a slow phone's frames) is drawn as a curve, and the last
    // half-segment lands on lift
    await hook(a, 'setPaint', { size: 0, hard: true, tool: 'brush', rgb: [40, 40, 60] });
    { const ctr = await hook(a, 'bodyCenter', 'b'); const bb = await hook(a, 'body', 'b'); await hook(a, 'paintCamAt', ctr[0], ctr[1], ctr[2], bb.nx, bb.ny, bb.nz, 1.2); await wait(500); } // face on (the paint camera may have picked a clear side view): the loop stays on the body
    const [cx, cy] = await hook(a, 'bodyPoint', 0);
    const lp = await sparseLoop(a, cx, cy, 40, 7);
    assert(lp.afterUp > lp.beforeUp, `the stroke's last half-segment is drawn on lift (${lp.afterUp - lp.beforeUp} dabs)`);
    // zero garbage: once the undo history is full, strokes recycle its buffers
    const pf0 = (await hook(a, 'paintPerf', 'b')).perf;
    for (let k = 0; k < 30; k++) await a.evaluate(() => { const p = window.__cham; p.stampNow(); });
    const pf1 = (await hook(a, 'paintPerf', 'b')).perf;
    for (let k = 0; k < 20; k++) await a.evaluate(() => window.__cham.stampNow());
    const pf2 = (await hook(a, 'paintPerf', 'b')).perf;
    assert(pf1.snapAllocs <= 25 && pf2.snapAllocs === pf1.snapAllocs, `undo snapshots come from a pool: ${pf0.snapAllocs} → ${pf1.snapAllocs} buffers after 30 stamps, +${pf2.snapAllocs - pf1.snapAllocs} after 20 more (history ${pf2.undo})`);
    await a.waitForFunction(() => !window.__cham.reveal(null, 'b').on, null, { timeout: 5000 });
    // a stamp on the wallpaper, a white fill over it, undo: the meter drops and climbs back with a
    // grade pop (paint QA1: "Invisible!" needs a calm surface now, ONLY=blendfair stamps the Market's)
    await a.waitForFunction(() => { const k = window.__cham.camo(); return !k.busy && k.meter.text === `${k.score}%`; }, null, { timeout: 10000 });
    let c = await hook(a, 'camo');
    const st0 = c.score;
    assert(st0 >= 50 && !c.meter.inv, `the stamped body reads ${st0}% "${c.meter.word}" on the wallpaper`);
    await hook(a, 'setPaint', { rgb: [255, 255, 255], tool: 'fill' });
    await a.tap('.chm-tool[data-tool="fill"]'); await tapBody(a);
    await a.waitForFunction((s0) => { const k = window.__cham.camo(); return !k.busy && !window.__cham.reveal(null, 'b').on && k.score < s0 - 10 && k.meter.text === `${k.score}%`; }, st0, { timeout: 10000 });
    const lo = await hook(a, 'camo');
    await a.tap('.chm-tools [data-act="undo"]');
    await a.waitForFunction((s0) => { const k = window.__cham.camo(); return !k.busy && !window.__cham.reveal(null, 'b').on && k.score >= s0 - 4 && k.meter.text === `${k.score}%`; }, st0, { timeout: 10000 });
    c = await hook(a, 'camo');
    assert(c.meter.grade > lo.meter.grade ? c.meter.pops > lo.meter.pops && c.meter.sounds > lo.meter.sounds && /!$/.test(c.meter.lastPop) : c.meter.pops === lo.meter.pops, `white fill ${lo.score}% "${lo.meter.word}" → undo ${c.score}% "${c.meter.word}": ${c.meter.grade > lo.meter.grade ? `pops "${c.meter.lastPop}" with a sound` : 'same grade, no pop'}`);
    // a sloppy pink patch, then the x-ray from a real tap on the meter
    await hook(a, 'setPaint', { size: 2, hard: false, tool: 'brush', rgb: [226, 70, 130] });
    await strokeOnBody(a, true);
    await a.waitForFunction(() => { const k = window.__cham.camo(); return !k.busy && k.score < 98 && k.meter.text === `${k.score}%`; }, null, { timeout: 10000 });
    await snap('1-pink');
    const hp = await hook(a, 'paintHash', 'b');
    const cdp = await a.context().newCDPSession(a);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await a.tap('.chm-meter');
    await a.waitForFunction(() => window.__cham.camo().xray.on, null, { timeout: 10000 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    c = await hook(a, 'camo');
    let pp = (await hook(a, 'paintPerf', 'b')).perf;
    console.log(`  x-ray at 4x CPU: error map ${c.xray.ms.toFixed(1)} ms in ${c.xray.slices} slices (largest ${c.xray.slice.toFixed(1)} ms; the meter's score ${c.xray.lent ? 'lent' : 'not lent'}), ${c.xray.bad} texels show`);
    assert(c.xray.on && c.xray.bad > 50 && c.meter.check === 'Shows', `tapping the meter x-rays the body (${c.xray.bad} texels show, the pill reads "${c.meter.check}")`);
    assert(c.xray.slice < 16 && c.xray.ms < 400, `the x-ray's five-view error map is sliced over frames at 4x CPU: largest slice ${c.xray.slice.toFixed(1)} ms (paint QA1; it was one 8–47 ms pass)`);
    await a.waitForFunction(() => window.__cham.paintPerf('b').perf.xray.frames >= 2, null, { timeout: 5000 });
    await snap('2-xray');
    assert(await hook(a, 'paintHash', 'b') === hp, 'the x-ray never touches the skin (hash unchanged)');
    await a.waitForFunction(() => !window.__cham.camo().xray.on, null, { timeout: 6000 });
    c = await hook(a, 'camo');
    assert(c.meter.check === 'Check', 'the x-ray ends by itself and the pill reads Check again');
    // painting ends it at once; a second tap turns it off
    await a.tap('.chm-meter');
    await a.waitForFunction(() => window.__cham.camo().xray.on, null, { timeout: 10000 });
    assert(true, 'x-ray on again');
    await strokeOnBody(a, true);
    pp = (await hook(a, 'paintPerf', 'b')).perf;
    assert(!pp.xray.on, 'a stroke ends the x-ray at once (the stroke lands on the real skin)');
    await a.waitForFunction(() => !window.__cham.camo().busy && !window.__cham.camo().xray.on, null, { timeout: 6000 });
    await a.tap('.chm-meter'); await wait(150); await a.tap('.chm-meter');
    assert(!(await hook(a, 'camo')).xray.on, 'a second tap on the meter turns the x-ray off');
    const popHit = await a.evaluate(() => { const r = document.querySelector('.chm-meter .cm-pop').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { w: r.width, inMeter: !!(e && e.closest('.chm-meter')) }; });
    assert(!popHit.inMeter, `the meter's (invisible) pop sticker never catches a paint stroke beside it (${Math.round(popHit.w)} px wide)`);
    // per-frame costs at 4x CPU: a stamp wipe, sliced re-scoring, brush moves
    await hook(a, 'camoPerfReset');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await a.tap('.chm-tool[data-tool="stamp"]');
    await a.waitForFunction(() => !window.__cham.reveal(null, 'b').on && !window.__cham.camo().busy, null, { timeout: 30000 });
    await hook(a, 'setPaint', { size: 1, hard: false, tool: 'brush', rgb: [90, 140, 200] });
    const mv = await a.evaluate(async ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      const mk = (type, xx, yy) => new PointerEvent(type, { pointerId: 44, pointerType: 'touch', clientX: xx, clientY: yy, bubbles: true, cancelable: true, isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 });
      const ms = []; el.dispatchEvent(mk('pointerdown', x - 30, y));
      for (let i = 1; i <= 8; i++) { await new Promise((r) => setTimeout(r, 30)); const t = performance.now(); el.dispatchEvent(mk('pointermove', x - 30 + i * 8, y + Math.sin(i) * 12)); ms.push(performance.now() - t); }
      const t = performance.now(); el.dispatchEvent(mk('pointerup', x + 34, y)); ms.push(performance.now() - t);
      return ms;
    }, [cx, cy]);
    await a.waitForFunction(() => !window.__cham.camo().busy, null, { timeout: 30000 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    c = await hook(a, 'camo'); pp = (await hook(a, 'paintPerf', 'b')).perf;
    const mvs = mv.slice().sort((x, y) => x - y);
    console.log(`  4x CPU: wipe frame avg ${pp.fxAvg.toFixed(2)} / max ${pp.fxMax.toFixed(2)} ms; camo slice avg ${c.sliceAvg.toFixed(2)} / max ${c.sliceMax.toFixed(2)} ms; brush move median ${mvs[mvs.length >> 1].toFixed(2)} / max ${mvs[mvs.length - 1].toFixed(2)} ms`);
    assert(pp.fxMax < 16 && c.sliceMax < 16 && mvs[mvs.length - 1] < 30, 'wipe frames, meter slices and brush moves stay well inside a frame at 4x CPU');
    if (process.env.PAINT_MONT) { try { require('child_process').execFileSync('node', [process.env.PAINT_MONT, path.join(SH, 'pro-montage.png'), '300', '400', ...shots]); } catch (e) { console.log('  (montage skipped)', e.message.split('\n')[0]); } }
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'paintpro-FAIL').catch(() => {});
  } finally { await h.close(); }
}

// ── paint owner, QA round 1: the blend % is what a seeker walking round sees, not the stamp's own
// projection (every stamp used to read 98-100 % "Invisible!", so the bonus and Gold were one tap) ──
const camoSettled = (a, cond = '') => a.waitForFunction(new Function(`const k = window.__cham.camo(); return !k.busy && !window.__cham.reveal(null, 'b').on && k.meter && k.meter.text === k.score + '%'${cond ? ` && (${cond})` : ''};`), null, { timeout: 15000 });
const hintText = (a) => a.evaluate(() => { const e = document.querySelector('.chm-hint'); return e ? e.textContent : ''; });
async function blendHide(a, map) {
  await hook(a, 'setRules', { map, first: 'b', rules: { size: 'large', blendBonus: 10 } });
  await a.tap('[data-act="start"]');
  await a.tap('[data-act="curtain"]');
  await waitPhase(a, 'hide');
  await wait(400);
}
async function blendFairSection(port) {
  console.log('\n# paint QA1: the blend % from five viewpoints (a stamp is a start, not a free Ghost), the side hint, the x-ray, Gold needs a hide that held up');
  const SH = process.env.PAINT_SHOTS || SHOTS;
  fs.mkdirSync(SH, { recursive: true });
  const shots = [];
  // Gold eyes: the best blend of a hide that SURVIVED (records.js `${w}_blend_surv`), not a lock score
  const R = await import('file://' + path.resolve(__dirname, '../../../js/games/chameleon/records.js'));
  const W = await import('file://' + path.resolve(__dirname, '../../../js/games/chameleon/wardrobe.js'));
  let d = {};
  const names = { a: 'Emerson', b: 'Sydney' };
  const gold = W.STYLES.find((x) => x.key === 'eye' && x.name === 'Gold');
  const fold = (rec) => { const r = R.recordRound(d, { seeker: 'a', hider: 'b', surf: 'wall', ...rec }, { mode: 'hs', map: 'living', names, strokes: { a: 0, b: 0 } }); d = { ...d, ...r.patch }; const u = W.newUnlocks(d, 'b'); d = { ...d, ...u.patch }; return u.pops.map((x) => x.st.name); };
  let pops = fold({ found: true, ms: 21000, blend: 97 });
  assert(!pops.includes('Gold') && d.b_blend === 97 && !d.b_blend_surv, `a 97 % hide that got found: best blend 97, no Gold (hint: "${W.hintFor(gold, W.statsOf(d, 'b'))}")`);
  pops = fold({ found: false, ms: 90000, blend: 86 });
  assert(!pops.includes('Gold') && d.b_blend_surv === 86, `an 86 % hide that survived: no Gold yet (hint: "${W.hintFor(gold, W.statsOf(d, 'b'))}")`);
  pops = fold({ found: false, ms: 90000, blend: 91 });
  assert(pops.includes('Gold') && d.b_blend_surv === 91 && gold.how === 'Survive a hunt at 90 % blend', `a 91 % hide that survived the hunt unlocks Gold ("${gold.how}")`);
  // one phone, Living Room: flat on the busy wallpaper
  let h = await launch({ port, only: ['chameleon'], who: ['a'], device: 'iPhone 13' });
  let a = h.a;
  const snap = async (n) => { const f = path.join(SH, `fair-${n}.png`); await a.screenshot({ path: f, clip: { x: 0, y: 80, width: 390, height: 560 } }); shots.push(f); };
  try {
    await arm(a, { ...SLOW, hide: 300000, maxDpr: 0.6 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await blendHide(a, 'living');
    assert(await camoHide(a) === 'wall', 'hider flat on the Living Room wallpaper');
    await a.tap('.chm-acts [data-act="paint"]');
    await camoSettled(a, 'k.score >= 0');
    let c = await hook(a, 'camo');
    const plain = c.score;
    assert(plain < 50, `a plain white body on the wallpaper: ${plain}% "${c.meter.word}"`);
    await a.tap('.chm-tool[data-tool="stamp"]');
    await camoSettled(a, `k.score > ${plain} + 20`);
    c = await hook(a, 'camo');
    let v = (await hook(a, 'blendViews')).last;
    const side = Math.min(...v.slice(1).filter((x) => x >= 0)); // (−1: a view with no room for a seeker)
    console.log(`  stamp on the wallpaper: ${c.score}% "${c.meter.word}" (front ${v[0]}, sides ${v.slice(1).join(' / ')})`);
    assert(c.score >= plain + 25 && c.score < 90 && !c.meter.inv, `one Stamp tap: ${plain}% → ${c.score}% "${c.meter.word}": a good start, not a free Ghost`);
    assert(v.length === 5 && v[0] >= 72 && side <= v[0] - 8, `head-on the stamp holds up (${v[0]}%), from 50° to the side the stripes stop lining up (worst side ${side}%)`);
    const stamped = c.score;
    const old = await a.evaluate(() => { window.__cham.blendViews({ views: 1, dist: 1000, backdrop: 0 }); const n = window.__cham.blend('b').now; window.__cham.blendViews({ views: 5, dist: 2.6, backdrop: 1 }); return n; });
    assert(old >= 80 && old - stamped >= 8, `scored from the stamp's own projection only (the old score) the same body reads ${old}%`);
    await a.waitForFunction(() => /From the side/.test((document.querySelector('.chm-hint') || {}).textContent || ''), null, { timeout: 5000 });
    assert(true, `the side hint explains it once: "${await hintText(a)}"`);
    await snap('1-stamp-wallpaper');
    // the x-ray: parallax shows as hazard tape where the pattern breaks, and the hint says why
    await a.tap('.chm-meter');
    await a.waitForFunction(() => window.__cham.camo().xray.on, null, { timeout: 10000 });
    c = await hook(a, 'camo');
    assert(c.xray.on && c.xray.bad > 200 && c.xray.lent && /From the side|Head-on/.test(await hintText(a)), `the x-ray flags ${c.xray.bad} texels that break up from the side (borrowing the meter's score) and says why: "${await hintText(a)}"`);
    assert(c.xray.slice < 16, `the five-view error map is sliced: ${c.xray.ms.toFixed(1)} ms in ${c.xray.slices} slices, largest ${c.xray.slice.toFixed(1)} ms`);
    await a.waitForFunction(() => window.__cham.paintPerf('b').perf.xray.frames >= 2, null, { timeout: 5000 });
    await snap('2-xray');
    await a.tap('.chm-meter');
    // the busy kilim, standing: worse than the wallpaper (a tall body on a busy floor breaks up more)
    const rug = (await hook(a, 'spots')).rug;
    await hook(a, 'teleport', rug.x, rug.z, 0, 0);
    await wait(500);
    await camoSettled(a);
    await a.tap('.chm-tool[data-tool="stamp"]');
    await wait(300);
    await camoSettled(a);
    c = await hook(a, 'camo'); v = (await hook(a, 'blendViews')).last;
    console.log(`  stamp standing on the kilim: ${c.score}% (front ${v[0]}, sides ${v.slice(1).join(' / ')})`);
    assert(c.score < stamped - 5 && v[0] >= 70, `stamped standing on the busy kilim: ${c.score}% < the wallpaper's ${stamped}%`);
    await snap('3-stamp-kilim');
    // costs: the meter's slices and a cold lock score (nothing cached) at 1x and 4x CPU
    const cdp = await a.context().newCDPSession(a);
    const cost = async () => a.evaluate(() => { const t = []; for (let i = 0; i < 5; i++) { const t0 = performance.now(); window.__cham.blend('b'); t.push(performance.now() - t0); } t.sort((x, y) => x - y); return t; });
    const c1 = await cost();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const c4 = await cost();
    await hook(a, 'camoPerfReset');
    await hook(a, 'setPaint', { size: 1, hard: false, tool: 'brush', rgb: [90, 140, 200] });
    await strokeOnBody(a, true);
    await camoSettled(a);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    c = await hook(a, 'camo');
    console.log(`  whole score (cold, as the lock): 1x median ${c1[2].toFixed(1)} / max ${c1[4].toFixed(1)} ms, 4x median ${c4[2].toFixed(1)} / max ${c4[4].toFixed(1)} ms; meter slices at 4x avg ${c.sliceAvg.toFixed(2)} / max ${c.sliceMax.toFixed(2)} ms (${c.slices} slices)`);
    assert(c4[4] < 120 && c.sliceMax < 16, 'a whole score stays far under the 200 ms rule at 4x CPU, a meter slice inside a frame');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'blendfair-FAIL').catch(() => {});
  } finally { await h.close(); }
  // paint QA1b: the score sees what is really behind the body, not the plane of the surface it's
  // on extended for ever. The Corner Market's camo spot is a narrow cream pillar between fridge
  // doors full of bottles: a stamp used to read 97 % "Invisible!" (a plain white body 87 %) while
  // the seeker saw a cream lump against the bottles
  h = await launch({ port, only: ['chameleon'], who: ['a'], device: 'iPhone 13' });
  a = h.a;
  try {
    await arm(a, { ...SLOW, hide: 300000, maxDpr: 0.6 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await blendHide(a, 'market');
    assert(await camoHide(a) === 'wall', 'hider flat on the Corner Market\'s fridge pillar');
    await a.tap('.chm-acts [data-act="paint"]');
    await camoSettled(a, 'k.score >= 0');
    const c0 = await hook(a, 'camo');
    const plane0 = await a.evaluate(() => { window.__cham.blendViews({ backdrop: 0 }); const n = window.__cham.blend('b').now; window.__cham.blendViews({ backdrop: 1 }); return n; });
    assert(c0.score < 40 && plane0 >= 80, `a plain white body on the cream pillar: ${c0.score}% with the bottles round it; ${plane0}% scored against the pillar's plane extended for ever (the old way)`);
    await a.tap('.chm-tool[data-tool="stamp"]');
    await camoSettled(a, `k.runs >= ${c0.runs + 1}`);
    let c = await hook(a, 'camo'); let v = await hook(a, 'blendViews'); const ls = (await st(a)).lastStamp;
    console.log(`  Market pillar: plain ${c0.score}%, stamped ${c.score}% (front ${v.last[0]}, sides ${v.last.slice(1).join(' / ')}; ${v.diag.tris} map triangles round it, ${v.diag.hidden} texel views hidden by the map; the stamp found something behind ${ls.hits} texels in ${ls.ms.toFixed(1)} ms)`);
    assert(ls.hits > 3000 && v.last[0] >= 75 && c.score < 80 && !c.meter.inv && !c.meter.bonusOn, `the stamp prints what is behind each bit of the body (the bottles past the pillar's edges): head-on ${v.last[0]}%, but the bottles break up from the side: ${c.score}% "${c.meter.word}", no star, no "Invisible!" (it read 97 %)`);
    await snap('4-market-pillar');
    // the x-ray shows the overhang
    await a.tap('.chm-meter');
    await a.waitForFunction(() => window.__cham.camo().xray.on, null, { timeout: 10000 });
    c = await hook(a, 'camo');
    assert(c.xray.bad > 500 && c.xray.slice < 16, `the x-ray flags ${c.xray.bad} texels (sliced: largest ${c.xray.slice.toFixed(1)} ms)`);
    await a.tap('.chm-meter');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'blendfair2-FAIL').catch(() => {});
  } finally { await h.close(); }
  // a calm surface still blends: the Living Room's plain painted wall. One Stamp tap is a good
  // start (Sneaky, the +10 star lit); painting the rest of the body the wall's colour (eyedropper,
  // fill) takes it to Ghost and "Invisible!", with a sticker and a sound each
  h = await launch({ port, only: ['chameleon'], who: ['a'], device: 'iPhone 13' });
  a = h.a;
  try {
    await arm(a, { ...SLOW, hide: 300000, maxDpr: 0.6 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await blendHide(a, 'living');
    const probe = (await hook(a, 'probes')).find((p) => p.name === 'right-wall-paint');
    await hook(a, 'teleport', probe.point[0] - 0.25, probe.point[2], Math.PI / 2, 1.7); // (clear of the dado below)
    await wait(150);
    assert(await hook(a, 'setPose', 'wall') === 'wall' && (await hook(a, 'body', 'b')).nx < -0.9, 'hider flat on the Living Room\'s plain painted wall');
    await a.tap('.chm-acts [data-act="paint"]');
    await camoSettled(a, 'k.score >= 0');
    await hook(a, 'setPaint', { rgb: [200, 40, 90], tool: 'fill' });
    await a.tap('.chm-tool[data-tool="fill"]'); await tapBody(a);
    await camoSettled(a, 'k.score < 40');
    const pink = await hook(a, 'camo');
    await a.tap('.chm-tool[data-tool="stamp"]');
    await camoSettled(a, `k.score > ${pink.score} + 30`);
    let c = await hook(a, 'camo'); const v = (await hook(a, 'blendViews')).last;
    console.log(`  plain wall: a pink body ${pink.score}%, stamped ${c.score}% (front ${v[0]}, sides ${v.slice(1).join(' / ')})`);
    assert(c.score >= 80 && c.score < 95 && c.meter.bonusOn && c.meter.pops > pink.meter.pops && c.meter.sounds > pink.meter.sounds, `on a calm wall one Stamp tap gets ${c.score}% "${c.meter.word}": the +10 star lit, "${c.meter.lastPop}" with a sound`);
    assert(!/From the side/.test(await hintText(a)), 'no side hint where the pattern holds up from the side');
    // the rest of the body (its sides, the bits the stamp only half covered) in the wall's colour
    const st = c;
    await hook(a, 'setPaint', { rgb: probe.hex.match(/\w\w/g).map((x) => parseInt(x, 16)), tool: 'fill' });
    { const ctr = await hook(a, 'bodyCenter', 'b'); const bb = await hook(a, 'body', 'b'); await hook(a, 'paintCamAt', ctr[0], ctr[1], ctr[2], bb.nx, bb.ny, bb.nz, 1.4); await wait(500); } // face on: every region in sight
    for (let part = 0; part < 8; part++) {
      const pt = await hook(a, 'bodyPoint', part).catch(() => null); if (!pt) break;
      await a.evaluate(([cx, cy]) => { const el = document.elementFromPoint(cx, cy); const mk = (type) => new PointerEvent(type, { pointerId: 62, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, cancelable: true, isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 }); el.dispatchEvent(mk('pointerdown')); setTimeout(() => el.dispatchEvent(mk('pointerup')), 60); }, pt);
      await wait(350);
    }
    await camoSettled(a, `k.score >= ${st.score} + 2`);
    c = await hook(a, 'camo');
    assert(c.score >= 90 && c.meter.grade === 3, `filled in the wall's colour: ${st.score}% → ${c.score}% "${c.meter.word}" (views ${(await hook(a, 'blendViews')).last.join(' / ')}: from close above and below the wainscot and the ceiling still show past the body)`);
    // the meter's "Invisible!" line (95): scored head-on only, a stamp over that pops it
    if (!c.meter.inv) {
      const s0 = c.meter.sounds;
      await hook(a, 'blendViews', { views: 1 });
      await a.tap('.chm-tool[data-tool="stamp"]');
      await camoSettled(a, 'k.score >= 95');
      c = await hook(a, 'camo');
      await hook(a, 'blendViews', { views: 5 });
      assert(c.meter.inv && c.meter.lastPop === 'Invisible!' && c.meter.sounds > s0, `past 95 % the meter pops "${c.meter.lastPop}" with a sound (${c.score}%, head-on)`);
    } else assert(c.meter.lastPop === 'Invisible!', `past 95 % the meter popped "${c.meter.lastPop}"`);
    await snap('5-plain-wall');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'blendfair3-FAIL').catch(() => {});
  } finally { await h.close(); }
  if (process.env.PAINT_MONT) { try { require('child_process').execFileSync('node', [process.env.PAINT_MONT, path.join(SH, 'fair-montage.png'), '300', '430', ...shots]); } catch (e) { console.log('  (montage skipped)', e.message.split('\n')[0]); } }
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

// ─────────────────────────────────────────────────────────────────────
// pro pass (mechanics): hotseat Jump for player b, blend score, grace holds the scan, seeker
// points, the dry-out pays the time survived, per-map clocks
const FEELTUNE = { ...FAST, hide: undefined, seek: undefined, seekLead: 900, maxDpr: 0.5 };
async function feelSection(port) {
  console.log('\n# pro pass: Jump for player b in hotseat, blend %, grace holds the scan, seeker points, dry-out pays the time survived, per-map clocks');
  const h = await launch({ port, only: ['chameleon'], who: ['a'], device: 'iPhone 13' });
  const a = h.a;
  try {
    await arm(a, FEELTUNE);
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    // per-map clocks: CU Boulder's hunt is 3× (the sweep is 190 s sprinting), hide capped at 2×, sprint stays 1.7×
    const ids = await hook(a, 'mapIds');
    if (ids.includes('cuboulder')) {
      await hook(a, 'setRules', { map: 'cuboulder', rules: { hide: 60, seek: 90 } });
      const e = await hook(a, 'effTimes');
      assert(e.scale === 3 && e.hideScale === 2 && e.seek === 270000 && e.hide === 120000 && Math.abs(e.sprint - 1.7) < 1e-9, `CU Boulder: seek ×${e.scale} = ${e.seek / 1000} s, hide ×${e.hideScale} = ${e.hide / 1000} s, sprint ×${e.sprint}`);
    }
    for (const [id, sc] of [['greenhouse', 1], ['market', 1.25], ['house', 1.5], ['museum', 1.5]]) {
      if (!ids.includes(id)) continue;
      await hook(a, 'setRules', { map: id });
      const e = await hook(a, 'effTimes');
      assert(e.scale === sc, `${id}: seek clock ×${e.scale}`);
    }
    const rr = await hook(a, 'setRules', { map: 'living', first: 'b', rules: { hide: 30, seek: 20, pellets: 4, scans: 2, grace: 3, rounds: 2 } });
    assert(rr.rules.seekScore === 'full' && rr.rules.blendBonus === 10, `Classic-derived rules: seeker scores "${rr.rules.seekScore}", blend bonus ${rr.rules.blendBonus}`);
    await a.tap('[data-act="start"]');
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(700);
    let s = await st(a);
    assert(s.viewer === 'b', 'Sydney (player b) hides first and holds the phone');
    // the Jump button with a real tap: used to be dead for player b in hotseat (a's pass ate the tap)
    const y0 = s.bodies.b.y;
    await a.tap('.chm-acts [data-act="jump"]');
    const jump = await a.evaluate(async (y0) => {
      let peak = 0; let vy = 0;
      for (let i = 0; i < 40; i++) { await new Promise((r) => requestAnimationFrame(r)); const b = window.__cham.state().bodies.b; peak = Math.max(peak, b.y - y0); vy = Math.max(vy, b.vy); if (i > 10 && b.onGround) break; }
      return { peak, vy };
    }, y0);
    // (the peak is the robust signal: on a loaded sandbox the first sampled frame can already be past the launch vy)
    assert(jump.peak > 0.6, `player b's Jump tap works in hotseat: vy ${jump.vy.toFixed(1)} m/s, rose ${jump.peak.toFixed(2)} m`);
    // acceleration: the joystick ramps the body up (no 0 → 3 m/s in one frame) and it brakes in ~0.1 s
    const box = await surfaceBox(a);
    const run = a.evaluate(async () => {
      const out = []; const t0 = performance.now();
      while (performance.now() - t0 < 1500) { await new Promise((r) => requestAnimationFrame(r)); const b = window.__cham.state().bodies.b; out.push([Math.round(performance.now() - t0), +b.speed.toFixed(2)]); }
      return out;
    });
    await wait(120);
    await touchHold(a, box[0] + 80, box[1] + box[3] - 150, box[0] + 80, box[1] + box[3] - 200, 700);
    const trace = await run;
    const max = Math.max(...trace.map((x) => x[1]));
    const first = trace.find((x) => x[1] > 0.05); const full = trace.find((x) => x[1] >= max * 0.95);
    const stopAt = trace.findIndex((x, i) => i > 0 && trace[i - 1][1] >= max * 0.9 && x[1] < 0.05);
    console.log(`  speed trace (ms, m/s): ${trace.filter((x, i) => i % 3 === 0).map((x) => `${x[0]}:${x[1]}`).join(' ')}`);
    assert(max > 2.5 && first && full && full[0] > first[0], `the walk ramps up: ${first[1]} m/s at ${first[0]} ms → ${max.toFixed(2)} m/s at ${full[0]} ms`);
    // blend score: a plain white body against the wallpaper vs a stamped one
    const pose = await camoHide(a);
    assert(pose === 'wall', 'flat against the wallpaper');
    const b0 = (await hook(a, 'blend', 'b')).now;
    await a.tap('.chm-acts [data-act="paint"]');
    await wait(500);
    await hook(a, 'stampNow');
    await wait(200);
    const b1 = (await hook(a, 'blend', 'b')).now;
    assert(b0 >= 0 && b0 < 60 && b1 > b0 + 20 && b1 >= 60, `blend score: plain white ${b0} % → stamped ${b1} %`); // (paint QA1: the score looks from the side too, a stamp on this wallpaper reads ~74)
    await a.tap('.chm-done');
    await wait(200);
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'curtain', 5000);
    const locked = (await hook(a, 'blend', 'b')).locked;
    assert(locked.b === b1 || Math.abs(locked.b - b1) <= 3, `the lock recorded the blend (${locked.b} %)`);
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'seek', 15000);
    await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    // grace: the scan is held too
    s = await st(a);
    assert(s.now < s.graceUntil, 'in the grace period');
    await hook(a, 'action', 'scan');
    await wait(200);
    s = await st(a);
    assert(s.round.scansLeft.a === 2 && s.glint.b < 0, 'Scan refused during the grace period (no glint, no scan spent)');
    await a.waitForFunction(() => !document.querySelector('.chm-acts [data-act="fire"]').disabled, null, { timeout: 6000 });
    await hook(a, 'action', 'scan');
    await wait(200);
    assert((await st(a)).round.scansLeft.a === 1, 'Scan works once the grace period ends');
    // the seeker tags at ~5 s: seeker points = ½ × seconds left + 10 per spare pellet, hider gets the seconds + blend bonus
    const bc = await hook(a, 'bodyCenter', 'b');
    await hook(a, 'teleport', bc[0] + 0.4, bc[2] + 2.4, Math.PI);
    await hook(a, 'aimAt', ...(await hook(a, 'bodyCenter', 'b')));
    await wait(250);
    await a.tap('.chm-acts [data-act="fire"]');
    await waitPhase(a, 'found', 10000);
    s = await st(a);
    const rec = s.round.rec;
    const wantSeek = Math.round(((20000 - rec.ms) / 1000) * 0.5) + 10 * 3;
    assert(rec.found && rec.spare === 3 && rec.seekPoints === wantSeek && s.match.scores.a === wantSeek, `the seeker banked +${rec.seekPoints} (found at ${(rec.ms / 1000).toFixed(1)} s of 20, 3 pellets spare)`);
    const wantBlend = rec.blend >= 80 ? 10 : 0;
    assert(rec.blend === locked.b && rec.blendPts === wantBlend && rec.points === Math.floor(rec.ms / 1000) + wantBlend, `the hider got ${rec.points}: ${Math.floor(rec.ms / 1000)} s + blend ${rec.blend} % (+${rec.blendPts})`);
    const stampText = (await a.textContent('.chm-stamp')).replace(/\s+/g, ' ');
    assert(new RegExp(`\\+${rec.seekPoints}`).test(stampText) && /3 pellets spare/.test(stampText), `the FOUND stamp shows the seeker's points ("${stampText.trim()}")`);
    await waitPhase(a, 'recap', 10000);
    await wait(400);
    const recapText = (await a.textContent('.chm-recap')).replace(/\s+/g, ' ');
    assert(/Blend \d+%/.test(recapText) && new RegExp(`\\+${rec.seekPoints} for`).test(recapText), 'the recap shows the blend % and the seeker\'s points');
    await shot(a, 'pro-recap-blend');
    // round 2: Emerson hides, Sydney runs dry after 4 misses → the hider is paid for the time survived, not the clock
    // (the recap auto-advances on its ring now, so the Next button may already be gone)
    if ((await st(a)).phase.name !== 'curtain') await a.tap('[data-act="next"]', { timeout: 5000 }).catch(() => {});
    await waitPhase(a, 'curtain', 10000);
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(500);
    await camoHide(a);
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'curtain', 5000);
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'seek', 15000);
    await a.waitForFunction(() => !document.querySelector('.chm-acts [data-act="fire"]').disabled, null, { timeout: 12000 });
    const ac = await hook(a, 'bodyCenter', 'a');
    for (let i = 0; i < 4; i++) {
      await hook(a, 'aimAt', ac[0] + 1.6 + i * 0.1, 0, ac[2] + 1.3);
      await wait(100);
      await a.tap('.chm-acts [data-act="fire"]');
      await wait(200);
    }
    await waitPhase(a, 'time', 10000);
    const r2 = (await st(a)).round.rec;
    assert(r2 && !r2.found && r2.outOfPellets && r2.ms < 15000 && Math.abs(r2.points - r2.blendPts - 30 - r2.ms / 1000) <= 1, `ran dry at ${(r2.ms / 1000).toFixed(1)} s: the hider gets ${r2.points} (${Math.floor(r2.ms / 1000)} s + 30${r2.blendPts ? ` + blend ${r2.blendPts}` : ''}), not the whole clock`);
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'pro-feel-FAIL').catch(() => {});
    try { console.error(JSON.stringify(await st(a)).slice(0, 1500)); } catch { /* ignore */ }
  } finally { await h.close(); }
}

/**
 * QA round 1 (mechanics): the body has to fit, not just its contact point. On the Market's right
 * wall a carton stack sits 0.25 m off the wall: a Large chameleon (r 0.31) used to crawl along
 * the wall behind it with its body inside the cartons (and over lockers, into fridges). Crawling
 * now stops at the stack, a body wedged in by other means can still crawl out, and the tongue
 * won't zip into the slot (a normal zip still lands).
 */
async function fitSection(port) {
  console.log('\n# QA1 mechanics: a crawling body never ends inside a prop (Market carton slot, Large); escape hatch; tongue-zip into a slot refused');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await arm(a, { ...SLOW, hide: undefined, seek: undefined });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    if (!(await hook(a, 'mapIds')).includes('market')) { console.log('  (no market map: skipped)'); return; }
    await hook(a, 'setRules', { map: 'market', first: 'b', rules: { size: 'large', hide: 300, seek: 300 } });
    await a.click('[data-act="start"]');
    await waitPhase(a, 'curtain');
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(400);
    const carton = { minX: 9.05, maxX: 9.75, minY: 1.63, maxY: 2.12, minZ: 0.78, maxZ: 1.22 };
    const centreOf = (bd) => [bd.x + bd.nx * bd.r, bd.y + bd.ny * bd.r, bd.z + bd.nz * bd.r];
    const inCarton = (c) => c[0] > carton.minX && c[0] < carton.maxX && c[1] > carton.minY && c[1] < carton.maxY && c[2] > carton.minZ && c[2] < carton.maxZ;
    // on the right wall beside the stack, heading toward it
    await hook(a, 'attachAt', 10, 1.9, 2.0, -1, 0, 0, 0, 0, -1);
    let bd = await hook(a, 'body');
    assert(bd.at && bd.nx < -0.9 && Math.abs(bd.r - 0.312) < 0.01, `a Large chameleon (r ${bd.r.toFixed(3)}) on the Market's right wall beside the carton stack`);
    await hook(a, 'setCam', -2.2, 0.25, 2.6);
    let res = await hook(a, 'crawl', 0, 0, -1.2, 45);
    bd = await hook(a, 'body');
    let c = centreOf(bd);
    assert(bd.at && !inCarton(c) && bd.z > carton.maxZ - 0.02 && res.res.includes(3), `crawling along the wall stops at the stack (contact z ${bd.z.toFixed(2)}, body centre ${fmt3(c)} outside the carton; results ${[...new Set(res.res)].join(',')})`);
    await wait(700);
    await shot(a, 'qa1-fit-stops-at-stack');
    // the slot behind the stack, as the old engine let a body into it
    await hook(a, 'attachAt', 10, 1.9, 1.0, -1, 0, 0, 0, 0, 1);
    await wait(700);
    await shot(a, 'qa1-fit-old-inside-cartons');
    c = centreOf(await hook(a, 'body'));
    assert(inCarton(c), `(attachAt bypasses the checks: the old reach had the body centre ${fmt3(c)} inside the cartons)`);
    // wedged in by other means (a forced attach, a stale snapshot): it can still crawl out
    res = await hook(a, 'crawl', 0, 0, 1.2, 30);
    bd = await hook(a, 'body');
    c = centreOf(bd);
    assert(bd.at && bd.z > carton.maxZ + 0.1 && !inCarton(c), `a wedged body isn't frozen: it crawls out of the slot (z 1.00 → ${bd.z.toFixed(2)})`);
    // the tongue: a ray that passes the stack and hits the wall behind it is refused, no cooldown spent
    await hook(a, 'attachAt', 10, 1.9, 2.0, -1, 0, 0, 0, 0, -1);
    const L = Math.hypot(0.15, 0.6);
    const ok1 = await hook(a, 'zip', [9.85, 1.9, 1.75, 0.15 / L, 0, -0.6 / L]);
    const ht = (await a.textContent('.chm-hint')).trim();
    bd = await hook(a, 'body');
    assert(ok1 === false && !bd.zip && /tight/i.test(ht) && Math.abs(bd.z - 2.0) < 0.01, `a tongue-zip at the wall behind the stack is refused ("${ht}")`);
    // …while a zip to the open underside of the shelf above still lands, upside down
    const ok2 = await hook(a, 'zip', [9.2, 1.5, 1.6, 0, 1, 0]);
    await a.waitForFunction(() => !window.__cham.body().zip, null, { timeout: 5000 });
    bd = await hook(a, 'body');
    c = centreOf(bd);
    assert(ok2 === true && bd.at && bd.ny < -0.9 && Math.abs(bd.y - 2.12) < 0.02 && !inCarton(c), `a zip to the open shelf underside still lands (at ${fmt3([bd.x, bd.y, bd.z])}, upside down)`);
    await wait(600);
    await shot(a, 'qa1-fit-zip-shelf-underside');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'qa1-fit-FAIL').catch(() => {});
  } finally { await h.close(); }
}

/** Two phones: a scurry from a wall drops and dashes (it used to spend the escape without moving); the tag window during an escape. */
async function feel2Section(port) {
  console.log('\n# pro pass (two phones): scurry off a wall = drop and dash, escape-aware tag window');
  const h = await launch({ port, only: ['chameleon'], latency: 60 });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, hide: 40000, seek: 30000 });
    await startMatch(h, { map: 'living', first: 'b', rules: { escapes: 3 } });
    await waitPhase(b, 'hide', 20000); await waitPhase(a, 'hide', 5000);
    await wait(500);
    const spots = await hook(b, 'spots'); const c = spots.camo;
    await hook(b, 'teleport', c.x, c.z - 0.1, 0, c.y);
    await wait(200);
    const stk = await hook(b, 'stick');
    assert(stk.at && Math.abs(stk.n[1]) < 0.7, 'the hider is stuck flat on the camo wall');
    await b.click('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 20000); await waitPhase(b, 'seek', 5000);
    await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    await wait(300);
    const p0 = (await st(b)).bodies.b;
    assert(p0.at, 'still on the wall when the hunt starts');
    // look along the wall and scurry
    await hook(b, 'setLook', 1.2, 0);
    await b.click('.chm-acts [data-act="scurry"]');
    await a.waitForFunction(() => window.__cham.state().trails > 0, null, { timeout: 5000 }).catch(() => {});
    await wait(900);
    const sb = await st(b);
    const p1 = sb.bodies.b;
    const dash = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    assert(!p1.at && dash > 1.2 && sb.round.escapes.b === 2, `scurry from the wall: dropped and dashed ${dash.toFixed(2)} m (escape spent: ${3 - sb.round.escapes.b})`);
    assert((await st(a)).trails > 0, 'the seeker saw the trail');
    await shot(a, 'pro-feel2-seeker-trail'); await shot(b, 'pro-feel2-hider-dashed');
    // a shot right after a second scurry is judged on the short (escape) window. The aim and the
    // trigger happen in the same animation frame (a click from the test runner lands ~100-300 ms
    // later in this shared sandbox, by which time the dashing body has left the crosshair).
    await hook(b, 'setLook', -1.2, 0);
    const bc = await hook(a, 'bodyCenter', 'b');
    await hook(a, 'teleport', bc[0], bc[2] + 2.2, Math.PI);
    await hook(a, 'aimAt', ...(await hook(a, 'bodyCenter', 'b')));
    await wait(300);
    let tc = null; let win = null; let tries = 0;
    for (; tries < 2 && !tc; tries++) {
      const before = (await st(b)).lastTagCheck;
      await b.click('.chm-acts [data-act="scurry"]');
      // let the 0.5 s dash (and the seeker's interpolation of it) finish, then aim and fire two
      // frames later; the shot still lands inside the escape-aware window's 1.5 s horizon
      await wait(750);
      const ls = await a.evaluate(() => new Promise((res) => {
        const H = window.__cham; let n = 0;
        const tick = () => { H.aimAt(...H.bodyCenter('b')); if (++n < 3) requestAnimationFrame(tick); else { H.action('fire'); res(H.state().lastShot); } };
        requestAnimationFrame(tick);
      }));
      if (!ls || !ls.tag) { console.log(`  try ${tries + 1}: the shot missed (${JSON.stringify(ls)})`); await wait(600); continue; }
      await b.waitForFunction((t0) => { const c = window.__cham.state().lastTagCheck; return c && (!t0 || c.T !== t0); }, before ? before.T : 0, { timeout: 5000 });
      tc = (await st(b)).lastTagCheck; win = (await st(b)).lastWindow;
    }
    assert(!!tc, `a shot at the dashing hider reached the victim's tag check (${tries} tr${tries === 1 ? 'y' : 'ies'})`);
    const since = tc.T - tc.escAt; const expect = since > tc.delay + tc.rtt / 2 + 120 && since < 1500 ? 'escape' : 'full';
    console.log(`  shot ${since.toFixed(0)} ms into the scurry (delay ${tc.delay} ms, rtt ${tc.rtt.toFixed(0)} ms): window ${win}, confirmed ${tc.ok}, seen-vs-me ${Math.hypot(tc.seen[0] - tc.me[0], tc.seen[2] - tc.me[2]).toFixed(2)} m`);
    assert(win === expect && tc.escAt > 0, `the tag check used the ${expect} window for a shot ${since.toFixed(0)} ms into the scurry`);
    await wait(700); await shot(a, 'pro-feel2-seeker-after-shot'); await shot(b, 'pro-feel2-hider-after-shot');
    if (expect !== 'escape') console.log('  (sandbox was too slow to fire inside the escape window; the full window was correctly used)');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'pro-feel2-FAIL-a').catch(() => {}); await shot(b, 'pro-feel2-FAIL-b').catch(() => {});
    try { console.error(JSON.stringify(await st(b)).slice(0, 1500)); } catch { /* ignore */ }
  } finally { await h.close(); }
}

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
// polish (UX): shared records + unlocks, the wardrobe, the seeker's wager + ticker, emotes, the recap's
// auto-advance ring, the final card; a landscape HUD overlap check; the Ready pill
async function uxSection(port) {
  console.log('\n# polish: records, wardrobe, wager, ticker, emotes, final card (two phones, 2 rounds)');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...SLOW, recap: 12000, final: 15000 }); // a long recap: the stickers land 0.9 s + 1.1 s apart; a long final card for the vote
    // lobby: the wardrobe chip opens a sheet of sticker tiles; locked tiles say what's missing
    assert(await a.isVisible('.chm-wardbtn'), 'lobby: a Wardrobe chip next to Settings');
    await a.tap('.chm-wardbtn');
    await a.waitForSelector('.chm-wardrobe', { timeout: 4000 });
    const tiles = await a.$$eval('.chm-wt', (els) => els.map((e) => ({ locked: e.classList.contains('locked'), hint: e.dataset.hint || '', k: e.dataset.k, key: e.dataset.wear })));
    assert(tiles.length === 15 && tiles.filter((t) => t.locked).length === 11, `wardrobe: ${tiles.length} tiles, ${tiles.filter((t) => t.locked).length} locked (the four defaults are free)`);
    await shot(a, 'ux-wardrobe');
    await a.tap('.chm-wt.locked[data-wear="eye"][data-k="1"]');
    await a.waitForSelector('.chm-pop', { timeout: 3000 });
    const popTxt = await a.$eval('.chm-pop', (e) => e.textContent);
    assert(/LOCKED/.test(popTxt) && /3 more hunts/.test(popTxt), `a locked tile says what's missing: "${popTxt.trim().replace(/\s+/g, ' ')}"`);
    const wear0 = await hook(a, 'polish');
    assert(wear0.wear.a.eye === 0, 'nothing worn yet (amber eyes)');
    await a.tap('.chm-wardrobe .chm-done');
    await wait(300);
    assert(!(await a.isVisible('.chm-wardrobe')), 'Done closes the wardrobe');
    // music is a per-phone setting on the sheet
    await a.tap('[data-act="settings"]');
    await a.waitForSelector('[data-music="hunt"]', { timeout: 4000 });
    await a.tap('[data-music="hunt"]');
    await wait(200);
    assert((await hook(a, 'polish')).music === 'hunt', 'Music · Hunt only sticks on this phone');
    await a.tap('.chm-sheet .chm-done');
    await wait(300);
    await startMatch(h, { rules: { rounds: 2, wager: 5, sights: true, escapes: 0 } });
    // ── round 1: b hides, a (blindfolded) calls the hide and reads the ticker ──
    await waitPhase(b, 'hide', 20000); await waitPhase(a, 'hide', 5000);
    await a.waitForSelector('.chm-call [data-call="wall"]', { timeout: 5000 });
    assert(await a.isVisible('[data-call="ceiling"]'), 'blind card: wager chips (floor · furniture · wall · ceiling)');
    await a.tap('[data-call="wall"]');
    await wait(300);
    assert((await hook(a, 'polish')).call.a === 'wall', 'seeker called WALL');
    await b.waitForFunction(() => window.__cham.polish().call.a === 'wall', null, { timeout: 5000 });
    // the hider paints: the seeker's ticker says so (count only, no coordinates)
    await camoHide(b);
    await b.tap('.chm-acts [data-act="paint"]');
    await wait(600);
    await strokeOnBody(b, true);
    await strokeOnBody(b, true);
    await a.waitForFunction(() => /painting/.test(window.__cham.polish().ticker), null, { timeout: 8000 });
    const tick = (await hook(a, 'polish')).ticker;
    assert(/Sydney is painting… \(\d+ strokes?\)/.test(tick), `ticker on the seeker's blind card: "${tick}"`);
    assert(await a.$eval('[data-live="ticker"]', (e) => e.textContent) === tick, 'the ticker is live in the card');
    await b.tap('.chm-tool[data-tool="stamp"]');
    await wait(300);
    await b.tap('.chm-done');
    await wait(300);
    const hideActs = await b.$$eval('.chm-acts .chm-b', (els) => els.map((e) => [e.dataset.act, e.classList.contains('wide'), e.getBoundingClientRect().width]));
    const readyBtn = hideActs.find((x) => x[0] === 'ready');
    assert(readyBtn && readyBtn[1] && readyBtn[2] > 120 && hideActs[0][0] === 'ready', `Ready is a wide pill at the top of the cluster (${Math.round(readyBtn[2])} px)`);
    await shot(b, 'ux-hider-hud');
    await shot(a, 'ux-blind-wager');
    await b.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 20000); await waitPhase(b, 'seek', 5000);
    await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    // staring straight at the hider: 'in their sights' counts on both phones, the hider feels it
    const bc = await hook(a, 'bodyCenter', 'b');
    await hook(a, 'teleport', bc[0] + 0.3, bc[2] + 2.4, Math.PI, 0);
    await hook(a, 'aimAt', ...bc);
    await a.waitForFunction(() => window.__cham.polish().stared >= 1, null, { timeout: 6000 });
    await b.waitForFunction(() => window.__cham.polish().stared >= 1, null, { timeout: 6000 });
    assert(true, `in their sights: stared ${(await hook(a, 'polish')).stared}× (seeker) / ${(await hook(b, 'polish')).stared}× (hider)`);
    const pa = await hook(a, 'polish');
    assert(pa.nearD < 4 && pa.nearD > 1.5, `3-D nearness ${pa.nearD.toFixed(2)} m`);
    // tag
    await hook(a, 'aimAt', ...(await hook(a, 'bodyCenter', 'b')));
    await wait(200);
    await a.tap('.chm-acts [data-act="fire"]');
    await waitPhase(a, 'found', 15000);
    await waitPhase(a, 'recap', 15000); await waitPhase(b, 'recap', 5000);
    let sa = await st(a);
    const rec1 = sa.round.rec;
    assert(rec1.called && rec1.zone === 'wall' && rec1.wagerPts === 5, `the call was right (${rec1.call} = ${rec1.zone}): +5 for the seeker`);
    assert(rec1.rx && rec1.rx.records.length === 0, 'first round: no records yet (nothing to beat)');
    await a.waitForSelector('.chm-recap .chm-ring', { timeout: 4000 });
    const ring = await a.$eval('.chm-recap .chm-ring', (e) => ({ k: +getComputedStyle(e).getPropertyValue('--k'), secs: e.querySelector('small').textContent }));
    assert(ring.k > 0 && ring.k <= 1 && /^\d+$/.test(ring.secs), `the Next button carries the auto-advance ring (${ring.k.toFixed(2)}, ${ring.secs} s)`);
    assert(await a.isVisible('.chm-nextline') && /Next: Emerson hides/.test(await a.$eval('.chm-nextline', (e) => e.textContent)), 'the recap says who hides next');
    await a.waitForFunction(() => [...document.querySelectorAll('.chm-pop')].some((e) => /CALLED IT/.test(e.textContent)), null, { timeout: 6000 });
    assert(true, 'CALLED IT sticker pops on the recap (after the UNLOCKED stickers)');
    const unl = rec1.rx.unlocks.map((u) => `${u.w}:${u.name}`).join(',');
    assert(/a:Ruby/.test(unl), `unlocks on a fast tag: ${unl}`);
    // emotes: b reacts, a sees the sticker
    await b.tap('.chm-emote[data-emote="how"]');
    await a.waitForSelector('.chm-emo:not(.mine)', { timeout: 5000, state: 'attached' });
    assert(!!(await b.$('.chm-emo.mine')), 'emote: a small mirrored sticker on the sender, a big one on the partner');
    await shot(a, 'ux-recap-emote');
    // shared records after round 1 (host writes, both read)
    await b.waitForFunction(() => window.__cham.data().a_finds === 1, null, { timeout: 8000 });
    const d1 = await hook(a, 'data');
    assert(d1.a_finds === 1 && d1.b_hides === 1 && d1.a_find_ms > 0 && d1.a_called === 1 && d1.a_streak === 1 && d1.a_rounds === 1 && d1.b_rounds === 1, `records after round 1: ${JSON.stringify({ a_finds: d1.a_finds, b_hides: d1.b_hides, a_find_ms: d1.a_find_ms, a_called: d1.a_called, a_streak: d1.a_streak })}`);
    assert(d1.b_strokes >= 2, `b's best strokes-in-a-hide recorded (${d1.b_strokes})`);
    await b.tap('[data-act="next"]');
    // ── round 2: a hides, b runs dry → a survives; final card ──
    await waitPhase(a, 'hide', 20000); await waitPhase(b, 'hide', 5000);
    await camoHide(a);
    await a.tap('.chm-acts [data-act="paint"]');
    await wait(400);
    await a.tap('.chm-tool[data-tool="stamp"]');
    await wait(300);
    await a.tap('.chm-done');
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 20000); await waitPhase(a, 'seek', 5000);
    await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    const ac = await hook(b, 'bodyCenter', 'a');
    await hook(b, 'teleport', ac[0] + 0.3, ac[2] + 2.6, Math.PI, 0);
    for (let i = 0; i < 6; i++) {
      await hook(b, 'aimAt', ac[0] + 1.6 + i * 0.1, 0, ac[2] + 1.2);
      await wait(120);
      await b.tap('.chm-acts [data-act="fire"]');
      await wait(260);
      if (i === 4) { await b.waitForSelector('.chm-pop', { timeout: 3000 }); assert(/LAST PELLET/.test(await b.$eval('.chm-pop', (e) => e.textContent)), 'LAST PELLET stamp on the fifth shot'); }
    }
    await waitPhase(b, 'time', 10000);
    await waitPhase(a, 'recap', 15000); await waitPhase(b, 'recap', 5000);
    sa = await st(a);
    assert(!sa.round.rec.found && sa.round.rec.rx, 'round 2: a survived');
    await a.waitForFunction(() => window.__cham.data().a_surv === 1, null, { timeout: 8000 });
    const d2 = await hook(a, 'data');
    assert(d2.a_surv === 1 && d2.a_streak === 2 && d2.b_streak === 0 && d2.a_surv_ms > 0 && d2.a_surv_surf === 'wall', `records after round 2: a_surv ${d2.a_surv}, a_streak ${d2.a_streak}, longest hide ${d2.a_surv_ms} ms on the ${d2.a_surv_surf}`);
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'final', 15000); await waitPhase(b, 'final', 5000);
    await a.waitForSelector('.chm-final', { timeout: 4000 }); await b.waitForSelector('.chm-final', { timeout: 4000 });
    const rows = await a.$$eval('.chm-tl-row', (els) => els.length);
    const story = await a.$eval('.chm-story', (e) => e.textContent);
    assert(rows === 2 && /Best hide: Emerson/.test(story) && /Fastest find: Emerson/.test(story), `final card: ${rows} round bars, "${story.replace(/\s+/g, ' ').trim()}"`);
    assert(!(await st(a)).finished && await a.evaluate(() => document.querySelector('#game-root .gm-end').hidden), 'the hub end card waits for the final card');
    await shot(a, 'ux-final');
    // 'Best hide tonight?': a matching pick on both phones crowns the round (Creative hide on the wardrobe)
    await a.tap('.chm-vote [data-vote="2"]');
    await b.waitForSelector('.chm-vote .chm-vpip.pa', { timeout: 5000, state: 'attached' });
    assert(!(await b.$('.chm-vote .crown')), 'one vote: the partner sees the pick pip, nothing crowned yet');
    await b.tap('.chm-vote [data-vote="2"]');
    await a.waitForSelector('.chm-vote .crown', { timeout: 5000 });
    await a.waitForFunction(() => window.__cham.data().a_creative === 1, null, { timeout: 8000 });
    assert(true, 'both picked round 2: CREATIVE HIDE crowned, a_creative = 1');
    await shot(a, 'ux-final-vote');
    await b.tap('.chm-final [data-act="finish"]');
    await a.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 10000 });
    await b.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 10000 });
    assert(true, 'either phone\'s "See the board" hands over to the hub end card on both');
    await a.waitForFunction(() => window.__cham.data().a_matches === 1, null, { timeout: 8000 });
    const d3 = await hook(a, 'data');
    assert(d3.a_matches === 1 && d3.b_matches === 1 && d3.a_wins === 1, `match counters: a_wins ${d3.a_wins}, matches ${d3.a_matches}/${d3.b_matches}`);
    // the lobby strip reads the records next time
    const strip = bestsStripText(d3);
    assert(strip, strip);
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'ux-FAIL-a').catch(() => {}); await shot(b, 'ux-FAIL-b').catch(() => {});
    try { console.error(JSON.stringify(await st(a)).slice(0, 1200)); } catch { /* ignore */ }
  } finally { await h.close(); }
}
const bestsStripText = (d) => `records: longest hide ${d.a_surv_ms || d.b_surv_ms} ms · fastest find ${d.a_find_ms || d.b_find_ms} ms · streak a ${d.a_streak | 0}`;

/** Landscape seek HUD with a climbing seeker, pose bar open, minimap on: no two HUD pieces overlap. */
async function uxLandscapeSection(port) {
  console.log('\n# polish: landscape seek HUD (844×390, House, seeker stuck, poses open, minimap): no overlaps; tap targets ≥ 44 px');
  const h = await launch({ port, only: ['chameleon'], who: ['a'], device: 'iPhone 13' });
  const a = h.a;
  try {
    await a.setViewportSize({ width: 844, height: 390 });
    await arm(a, { ...FAST, hide: 60000, seek: 60000 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await wait(500);
    // tap targets on the lobby + sheet
    await a.tap('[data-act="settings"]');
    await a.waitForSelector('.chm-sheet', { timeout: 4000 });
    const small = await a.$$eval('.chm-sheet button, .chm-sheet .chm-chip', (els) => els.filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return [e.className.split(' ')[0] + (e.dataset.k ? ':' + e.dataset.k : ''), Math.round(r.width), Math.round(r.height)]; }).filter((x) => x[2] < 44 || x[1] < 40));
    assert(small.length === 0, `settings sheet: every button ≥ 44 px tall (${small.length ? JSON.stringify(small.slice(0, 5)) : 'ok'})`);
    await a.tap('.chm-sheet .chm-done');
    await wait(200);
    await hook(a, 'setRules', { map: 'house', first: 'b', rules: { minimap: true, seekClimb: true, climb: true } });
    await wait(400);
    await a.tap('[data-act="start"]');
    await waitPhase(a, 'curtain');
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(400);
    const opts = await a.$$eval('.chm-acts .chm-b', (els) => els.map((e) => { const r = e.querySelector('span').getBoundingClientRect(); return [e.dataset.act, Math.round(r.width), Math.round(r.height)]; }));
    assert(opts.every((x) => x[2] >= 40), `hide buttons: ${JSON.stringify(opts)}`);
    await a.tap('.chm-acts [data-act="paint"]');
    await wait(500);
    const seg = await a.$$eval('.chm-seg button, .chm-done', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    assert(seg.every((x) => x[1] >= 44 && x[0] >= 40), `paint options ≥ 44 px: ${JSON.stringify(seg)}`);
    await a.tap('.chm-done');
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'curtain');
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'seek');
    await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    await wait(300);
    // walk the seeker into the nearest wall and stick
    const b0 = await hook(a, 'body');
    const wall = await hook(a, 'surfaceAt', b0.x, b0.y + 0.3, b0.z, Math.sin(b0.yaw), 0, Math.cos(b0.yaw), 6);
    if (wall) { await hook(a, 'teleport', wall.p[0] - wall.n[0] * 0.3, wall.p[2] - wall.n[2] * 0.3, b0.yaw); await wait(100); }
    await hook(a, 'stick');
    await hook(a, 'openPoses');
    await wait(600);
    const rects = await a.evaluate(() => {
      const out = {};
      for (const k of ['.chm-mini', '.chm-poses', '.chm-gear', '.chm-acts', '.chm-joyhint']) { const e = document.querySelector(k); if (e && !e.hidden && e.offsetParent) { const r = e.getBoundingClientRect(); out[k] = [r.left, r.top, r.right, r.bottom]; } }
      return out;
    });
    const keys = Object.keys(rects);
    const hits = [];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const A = rects[keys[i]]; const B = rects[keys[j]];
      if (A[0] < B[2] - 1 && B[0] < A[2] - 1 && A[1] < B[3] - 1 && B[1] < A[3] - 1) hits.push(`${keys[i]} × ${keys[j]}`);
    }
    assert(keys.includes('.chm-mini') && keys.includes('.chm-poses') && keys.includes('.chm-gear'), `landscape seek HUD shows ${keys.join(', ')}`);
    assert(hits.length === 0, `no two of ${keys.join(' / ')} intersect${hits.length ? ': ' + hits.join(', ') : ''}`);
    await shot(a, 'ux-land-seek');
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'ux-land-FAIL').catch(() => {});
  } finally { await h.close(); }
}

/** Laptop: the click that grabs the mouse is a grab, not a shot. */
async function uxDesktopSection(port) {
  console.log('\n# polish: laptop, the first click grabs the mouse without spending a pellet');
  const h = await launch({ port, only: ['chameleon'], who: ['a'], device: 'Desktop Chrome', fine: true });
  const a = h.a;
  try {
    await a.setViewportSize({ width: 1280, height: 800 });
    await arm(a, { ...FAST, hide: 60000, seek: 60000 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await wait(400);
    await a.click('[data-act="start"]');
    await waitPhase(a, 'curtain');
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(300);
    await a.keyboard.press('KeyR');
    await waitPhase(a, 'curtain');
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'seek');
    await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    await wait(300);
    const box = await surfaceBox(a);
    const cx = box[0] + box[2] / 2; const cy = box[1] + box[3] / 2;
    const sk = (await st(a)).viewer;
    const used0 = (await st(a)).round.used[sk];
    await a.mouse.click(cx, cy);
    await wait(500);
    const lock = await a.evaluate(() => ({ locked: document.pointerLockElement === document.querySelector('.chm-surface') }));
    const used1 = (await st(a)).round.used[sk];
    if (lock.locked) assert(used1 === used0, `pointer lock granted: the grab click spent no pellet (${used1 - used0})`);
    else assert(used1 - used0 <= 1, `pointer lock refused here: the fallback click-to-fire fired ${used1 - used0} pellet (hint says click to grab, then click to fire)`);
    await a.mouse.click(cx, cy);
    await wait(500);
    const used2 = (await st(a)).round.used[sk];
    assert(used2 >= used1 && used2 - used0 <= 2 && used2 - used0 >= 1, `the next click fires (${used2 - used0} pellet${used2 - used0 === 1 ? '' : 's'} after two clicks)`);
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
  } finally { await h.close(); }
}

/** Net owner (pro pass): the hiding keepalive, the eased Watch switch and the fog-capped pellet range. */
async function netPolishSection(port) {
  console.log('\n# net polish: presence keepalive when nothing changes, adaptive interpolation delay, View → Watch whips the camera, pellets stop at the fog');
  const h = await launch({ port, only: ['chameleon'], latency: 60 });
  const { a, b } = h;
  // presence publishes vs frames over ms, measured in the page (each counted publish is sent: network() spaces them ≥ 49 ms)
  const pubRate = (p, ms, look = false) => p.evaluate(([ms2, lk]) => new Promise((res) => {
    const H = window.__cham; const p0 = H.state().pubs; let frames = 0; const t0 = performance.now();
    const tick = () => { frames++; if (lk) H.setLook(Math.sin(frames * 0.35) * 0.8, 0.1); if (performance.now() - t0 < ms2) requestAnimationFrame(tick); else res({ pubs: H.state().pubs - p0, frames, s: (performance.now() - t0) / 1000 }); };
    requestAnimationFrame(tick);
  }), [ms, look]);
  // real room presence sends, counted at the platform binding
  const countSends = (p) => p.evaluate(() => { if (window.__sendCount) return; const c = window.__sendCount = { presence: 0 }; const o = window.__room; window.__room = (op, ...x) => { if (op === 'presence') c.presence++; return o(op, ...x); }; });
  const sends = (p) => p.evaluate(() => ({ n: window.__sendCount.presence, t: performance.now() }));
  const angle = (u, v) => Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (vlen(u) * vlen(v) || 1))));
  try {
    // the presence schedule itself, in Node on phone frame clocks (the sandbox's slow frames can't show it):
    // link.js's publish() with network() running 0–4 ms into each frame, 30 s per clock
    const sim = JSON.parse(require('child_process').execFileSync(process.execPath, ['--input-type=module', '-e', `
      let T = 0; globalThis.performance = { now: () => T };
      const { createLink } = await import(${JSON.stringify('file://' + path.resolve(__dirname, '../../../js/games/chameleon/link.js'))});
      const out = {};
      for (const hz of [60, 120, 30]) {
        const H = {}; const sends = []; let r = 7;
        const api = { mode: 'live', isHost: true, send() {}, on(t, fn) { (H[t] = H[t] || []).push(fn); return () => {}; }, setPresence() { sends.push(T); }, onPartnerState() { return () => {}; } };
        const link = createLink(api, {}); H.chi.forEach((f) => f({ s: 'zz', p: null }));
        const st = { x: 0, y: 0, z: 0, yaw: 0, po: 0, ly: 0, lp: 0, v: 1, wa: 0, sp: 0, q: 0, at: 0 };
        for (let k = 0; k < 30 * hz; k++) { r = (r * 16807) % 2147483647; T = 1e4 + k * 1000 / hz + 4 * r / 2147483647; st.x = k; if (link.pubDue(T)) link.publish(st); }
        link.destroy();
        let win = 0; for (let i = 0, j = 0; i < sends.length; i++) { while (sends[i] - sends[j] > 1000) j++; win = Math.max(win, i - j + 1); }
        out[hz] = { rate: sends.length / 30, win };
      }
      console.log(JSON.stringify(out)); process.exit(0);`], { encoding: 'utf8' }));
    console.log(`  presence schedule (Node, 0–4 ms jitter): ${Object.entries(sim).map(([hz, x]) => `${hz} Hz ${x.rate.toFixed(1)}/s (≤ ${x.win} in any 1 s)`).join(', ')}`);
    assert(Object.values(sim).every((x) => x.rate >= 19.5 && x.win <= 21), 'presence keeps 20/s on 60, 120 and 30 Hz frame clocks, never more than 21 in a second');
    await startPair(h, SLOW);
    for (const p of [a, b]) await countSends(p);
    // the lobby: both idle
    let s0 = await sends(a); await wait(2500); let s1 = await sends(a);
    const lobbyRate = (s1.n - s0.n) / ((s1.t - s0.t) / 1000);
    assert(lobbyRate <= 3.5, `idle in the lobby: ${lobbyRate.toFixed(1)} presence sends/s (was 20/s)`);
    await startMatch(h, { rules: { huntPaint: 'tell', headStart: 0, grace: 0 } });
    await waitPhase(b, 'hide', 20000);
    await wait(800);
    const hr = await pubRate(b, 4000);
    console.log(`  hiding: ${hr.pubs} publishes in ${hr.s.toFixed(1)} s over ${hr.frames} frames`);
    assert(hr.pubs / hr.s <= 3.2 && hr.pubs >= 4, `the hider publishes a ~2.5/s keepalive while hiding (${(hr.pubs / hr.s).toFixed(1)}/s, was 20/s)`);
    s0 = await sends(a); await wait(2000); s1 = await sends(a);
    const blindRate = (s1.n - s0.n) / ((s1.t - s0.t) / 1000);
    assert(blindRate <= 3.5, `the blindfolded seeker: ${blindRate.toFixed(1)} presence sends/s`);
    const sa = await st(a);
    assert(!sa.paused && sa.rem && sa.rem.v === 0, `the host (seeker) stays linked and unpaused, and sees nobody (v ${sa.rem && sa.rem.v})`);
    await camoHide(b);
    await b.tap('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 20000);
    await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    await wait(600);
    assert(((await st(a)).rem || {}).v > 0.5, 'the seeker has the hider\'s real presence once hunted');
    const still = await pubRate(b, 2500);
    assert(still.pubs / still.s <= 3.2 && still.pubs >= 3, `a still hider in the hunt sends a keepalive (${(still.pubs / still.s).toFixed(1)}/s; was one per frame)`);
    const look = await pubRate(b, 2000, true);
    // full rate = link.js's 20/s schedule, or every frame when frames are slower than 50 ms
    const full = Math.min(look.frames, Math.floor(look.s * 20));
    console.log(`  looking round: ${look.pubs} publishes / ${look.frames} frames in ${look.s.toFixed(1)} s (${(look.pubs / look.s).toFixed(1)}/s)`);
    assert(look.pubs >= full * 0.85 - 2 && look.pubs / look.s <= 21.5, `looking round goes back to full rate at once (${look.pubs} of ≤ ${full}, ≤ 20/s)`);
    // the adaptive interpolation delay: above the old fixed 100 ms on a 60 ms link, capped at 250
    const ns = await hook(a, 'netStats');
    console.log(`  seeker draws the hider ${ns.delay.toFixed(0)} ms back (target ${ns.target.toFixed(0)}, rtt ${ns.rtt}); frames interpolated ${ns.interp.interp}, extrapolated ${ns.interp.extra}, held ${ns.interp.held}`);
    assert(ns.delay > 100 && ns.delay <= 250, `the interpolation delay adapted to the link (${ns.delay.toFixed(0)} ms)`);
    const nsb = await hook(b, 'netStats'); // the guest's presence stamps use the refined game clock now, not net.js's estimate
    console.log(`  guest clocks: net.js minus game clock ${nsb.skew.toFixed(1)} ms (what presence stamps used to be off by)`);
    // View → Watch: the camera whips over instead of cutting, and the aim turns by angle
    await hook(a, 'teleport', -1.0, 1.5, Math.PI, 0);
    await hook(b, 'setLook', 2.6, 0); // the hider looks away from where the seeker looks
    await wait(900);
    const trail = await b.evaluate(() => new Promise((res) => {
      const out = [window.__cham.camera()]; const t0 = performance.now();
      window.__cham.view('watch');
      const tick = () => { out.push(window.__cham.camera()); if (performance.now() - t0 < 900) requestAnimationFrame(tick); else res(out); };
      requestAnimationFrame(tick);
    }));
    const steps = []; const turns = []; const toEnd = [];
    const last = trail[trail.length - 1];
    for (let i = 1; i < trail.length; i++) {
      steps.push(vlen([trail[i].p[0] - trail[i - 1].p[0], trail[i].p[1] - trail[i - 1].p[1], trail[i].p[2] - trail[i - 1].p[2]]));
      turns.push(angle(trail[i].dir, trail[i - 1].dir));
    }
    for (const c of trail) toEnd.push(angle(c.dir, last.dir));
    const total = vlen([last.p[0] - trail[0].p[0], last.p[1] - trail[0].p[1], last.p[2] - trail[0].p[2]]);
    const turn = angle(trail[0].dir, last.dir);
    const vw = (await st(b)).viewWhip;
    console.log(`  watch switch: offset ${vw.step.toFixed(2)} m, turn ${(turn * 57.3).toFixed(0)}°, ${steps.length} frames, steps ${steps.slice(0, 8).map((x) => x.toFixed(2)).join(' ')}, turns ${turns.slice(0, 8).map((x) => (x * 57.3).toFixed(0)).join(' ')}°`);
    assert((await st(b)).spect === 'watch', 'the hunted hider is watching the seeker');
    assert(total > 0.3 && Math.max(...steps) < total * 0.85 && steps.filter((x) => x > 0.01).length >= 2, `the switch is eased across frames (largest step ${Math.max(...steps).toFixed(2)} of ${total.toFixed(2)} m)`);
    let back = 0; for (let i = 1; i < toEnd.length; i++) back = Math.max(back, toEnd[i] - toEnd[i - 1]);
    assert(turn < 0.3 || (Math.max(...turns) < turn * 0.85 && back < 0.06), `the aim turns smoothly towards the new view (largest turn ${(Math.max(...turns) * 57.3).toFixed(0)}° of ${(turn * 57.3).toFixed(0)}°, never back by more than ${(back * 57.3).toFixed(1)}°)`);
    // back to the eyes: the same whip
    await hook(b, 'view', 'eyes');
    await wait(700);
    if (process.env.NETSHOTS) { // frames of the whip (screenshots are slow here: each lands ~100+ ms apart)
      await hook(b, 'view', 'watch');
      for (let i = 0; i < 5; i++) await shot(b, `net-whip-${i}`);
      await hook(b, 'view', 'eyes'); await wait(700);
    }
    // pellets: range is the fog's far edge
    const fog = await hook(a, 'fog');
    const sb = await hook(a, 'body');
    await hook(a, 'aimAt', sb.x + 0.3, sb.y + 6, sb.z - 1);
    for (let i = 0; i < 40 && !(await st(a)).lastShot; i++) { await a.click('.chm-acts [data-act="fire"]').catch(() => {}); await wait(250); }
    const ls = (await st(a)).lastShot;
    assert(ls && ls.range === Math.min(40, fog.far), `a pellet flies at most to the fog (${ls && ls.range} m, fog far ${fog.far})`);
    // the hider's copy of that miss leaves the muzzle when the seeker as drawn there fires (T + delay)
    await b.waitForFunction(() => window.__cham.netStats().shotLag != null, null, { timeout: 6000 });
    const nb = await hook(b, 'netStats');
    console.log(`  the miss on the hider's screen waited ${nb.shotLag} ms for the seeker as drawn (delay ${nb.delay.toFixed(0)} ms)`);
    assert(nb.shotLag >= 0 && nb.shotLag <= 300, `a remote miss is lined up with the drawn shooter (${nb.shotLag} ms)`);
    // a tag: the victim judges it against the shooter's own (adaptive) interpolation delay
    const bc = await hook(a, 'bodyCenter', 'b');
    await hook(a, 'teleport', bc[0], bc[2] + 2.0, Math.PI);
    await wait(300);
    const shotDl = await a.evaluate(() => new Promise((res) => {
      const H = window.__cham; let n = 0;
      const tick = () => { H.aimAt(...H.bodyCenter('b')); if (++n < 3) requestAnimationFrame(tick); else { const d = H.netStats().delay; H.action('fire'); res({ d, shot: H.state().lastShot }); } };
      requestAnimationFrame(tick);
    }));
    assert(shotDl.shot && shotDl.shot.tag, 'the aimed pellet hits the hider on the seeker\'s screen');
    await b.waitForFunction(() => !!window.__cham.state().lastTagCheck, null, { timeout: 6000 });
    const tc = (await st(b)).lastTagCheck;
    assert(tc.ok && Math.abs(tc.delay - shotDl.d) <= 1, `the victim used the shooter's delay (${tc.delay} vs ${shotDl.d.toFixed(0)} ms) and confirmed the tag`);
    // the shooter's juice (hit-stop, flash, tag sound) lands before the FOUND stamp, in both
    // directions: a host victim used to call hostFound without answering, so a guest seeker got none
    const juiceCheck = async (shooter, label, T) => {
      await shooter.waitForFunction(() => window.__cham.state().phase.name === 'found' && !!window.__cham.state().juice, null, { timeout: 8000 });
      const s2 = await st(shooter); const j = s2.juice;
      const fl = (await hook(shooter, 'phaseLog')).filter((x) => x.name === 'found').pop(); // when this phone put the stamp up
      console.log(`  ${label}: fire → confirmed ${(j.at - T).toFixed(0)} ms, juice ${(j.fired - T).toFixed(0)} ms (waited ${j.wait} ms for the pellet), FOUND at ${(s2.phase.at - T).toFixed(0)} ms (shown ${(fl.now - T).toFixed(0)})`);
      assert(j.n >= 1 && j.fired >= j.at - 1 && j.fired <= fl.now + 1, `${label} gets the tag juice, no later than the FOUND stamp`);
    };
    await juiceCheck(a, 'host seeker', tc.T);
    // round 2: roles swap; the guest seeks and tags the host
    await waitPhase(a, 'hide', 20000);
    await waitPhase(b, 'hide', 20000);
    await wait(500);
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 20000);
    await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    await wait(500);
    const ac = await hook(b, 'bodyCenter', 'a');
    await hook(b, 'teleport', ac[0], ac[2] + 2.0, Math.PI);
    await wait(400);
    const shot2 = await b.evaluate(() => new Promise((res) => {
      const H = window.__cham; let n = 0;
      const tick = () => { H.aimAt(...H.bodyCenter('a')); if (++n < 3) requestAnimationFrame(tick); else { H.action('fire'); res(H.state().lastShot); } };
      requestAnimationFrame(tick);
    }));
    assert(shot2 && shot2.tag, 'round 2: the guest seeker\'s pellet hits the host hider on its screen');
    await a.waitForFunction((t0) => { const c = window.__cham.state().lastTagCheck; return c && c.T > t0; }, tc.T, { timeout: 8000 });
    const tc2 = (await st(a)).lastTagCheck;
    assert(tc2.ok, 'the host hider confirms the guest\'s tag');
    await juiceCheck(b, 'guest seeker', tc2.T);
    h.assertNoErrors();
    assert(!h.warnings.length, `message budget respected (${h.warnings.length} warnings)`);
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'net-FAIL-a').catch(() => {}); await shot(b, 'net-FAIL-b').catch(() => {});
  } finally { await h.close(); }
}

// ── UX QA round 1: the final card on a short phone, who hides first after Rematch, wardrobe rows ──
/** One scripted hotseat round: the hider stamps on the map's camo wall, the seeker tags from 2.5 m. */
async function quickHsRound(a) {
  await waitPhase(a, 'curtain', 60000); await hook(a, 'action', 'curtain');
  await waitPhase(a, 'hide', 60000); await wait(200);
  const sp = await hook(a, 'spots');
  await hook(a, 'teleport', sp.camo.x, sp.camo.z - 0.1, 0, sp.camo.y); await hook(a, 'setPose', 'wall'); await hook(a, 'stampNow');
  await wait(300);
  await hook(a, 'action', 'ready');
  await waitPhase(a, 'curtain', 60000); await hook(a, 'action', 'curtain');
  await waitPhase(a, 'seek', 60000); await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 30000 });
  const s = await st(a); const hider = s.viewer === 'a' ? 'b' : 'a';
  const bc = await hook(a, 'bodyCenter', hider); const cn = sp.camo.wallNormal || [0, 0, 1];
  // stand 2.5 m out from the hider's wall on that floor (the House's camo wall can be upstairs)
  const dn = await hook(a, 'surfaceAt', bc[0] + cn[0] * 2.5, bc[1] + 0.2, bc[2] + cn[2] * 2.5, 0, -1, 0, 4);
  await hook(a, 'teleport', bc[0] + cn[0] * 2.5, bc[2] + cn[2] * 2.5, 0, dn ? dn.p[1] : undefined);
  for (let k = 0; k < 3; k++) {
    await a.evaluate(([x, y, z]) => new Promise((r2) => { let n = 0; const tk = () => { window.__cham.aimAt(x, y, z); if (++n < 3) requestAnimationFrame(tk); else { window.__cham.action('fire'); r2(); } }; requestAnimationFrame(tk); }), bc);
    try { await a.waitForFunction(() => window.__cham.state().phase.name !== 'seek', null, { timeout: 4000 }); break; } catch { /* missed: aim again */ }
  }
  await a.waitForFunction(() => ['recap', 'final'].includes(window.__cham.state().phase.name), null, { timeout: 40000 });
}
/** A real one-finger drag (CDP touch events) from (x, y) by dy px. */
async function touchDrag(page, x, y, dy, steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 7 }] });
  for (let i = 1; i <= steps; i++) { await wait(30); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / steps, id: 7 }] }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach().catch(() => {});
  await wait(400);
}
/** The final card's geometry on this viewport: overflow, the sticky button, the hub stickers. */
async function finalGeom(a) {
  return a.evaluate(() => {
    const c = document.querySelector('.chm-final .chm-card'); const r = c.getBoundingClientRect();
    const btn = c.querySelector('[data-act="finish"]'); const br = btn.getBoundingClientRect();
    const top = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
    const corners = [...document.querySelectorAll('#game-root .gm-top > button')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect());
    const hit = corners.some((q) => q.left < r.right && r.left < q.right && q.top < r.bottom && r.top < q.bottom);
    return { vh: innerHeight, vw: innerWidth, top: Math.round(r.top), bottom: Math.round(r.bottom), sh: c.scrollHeight, ch: c.clientHeight, st: c.scrollTop, x: r.left + r.width / 2, y: r.top + r.height * 0.55,
      btn: [Math.round(br.top), Math.round(br.bottom)], btnTop: !!top && (top === btn || btn.contains(top)), corner: hit,
      stickers: [...c.querySelectorAll('.chm-recs span')].map((e) => e.textContent), labels: [...c.querySelectorAll('.chm-recs span')].map((e) => e.getAttribute('aria-label')).join(' | '), first: (c.querySelector('.chm-nextline[data-first]') || {}).dataset?.first || null,
      chips: [...c.querySelectorAll('.chm-vote .chm-chip')].map((e) => { const q = e.getBoundingClientRect(); return [Math.round(q.left), Math.round(q.top), e.scrollWidth > e.clientWidth + 1]; }) };
  });
}
async function uxFinalSection(port) {
  console.log('\n# UX QA: a 4-round hotseat final card on a short phone (390×664, 375×667) scrolls under a finger, See the board stays on screen; Rematch keeps the "hides first" promise');
  const h = await launch({ port, only: ['chameleon'], who: ['a'], coarse: true, device: 'iPhone 13' });
  const a = h.a;
  try {
    await a.setViewportSize({ width: 390, height: 664 });
    await arm(a, { ...FAST, hide: 60000, seek: 60000, recap: 600000, final: 600000, found: 1200, title: 300, maxDpr: 0.5 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await hook(a, 'setRules', { map: 'house', first: 'a', rules: { rounds: 4 } });
    await a.waitForFunction(() => window.__cham.state().mapId === 'house', null, { timeout: 60000 });
    // the lobby: a [data-scroll] card; a drag on a card that fits is still held (the app sheet stays put)
    const lob = await a.evaluate(() => { const c = document.querySelector('.chm-lobby .chm-card'); return { ds: c.hasAttribute('data-scroll'), sh: c.scrollHeight, ch: c.clientHeight }; });
    assert(lob.ds && lob.sh <= lob.ch + 1, `390×664: the House lobby fits without scrolling (${lob.sh} / ${lob.ch} px)`);
    await a.setViewportSize({ width: 375, height: 560 }); await wait(500);
    const lob2 = await a.evaluate(() => { const c = document.querySelector('.chm-lobby .chm-card'); const r = c.getBoundingClientRect(); return { sh: c.scrollHeight, ch: c.clientHeight, x: r.left + r.width / 2, y: r.top + r.height * 0.6 }; });
    await touchDrag(a, lob2.x, lob2.y, -200);
    const lobS = await a.evaluate(() => document.querySelector('.chm-lobby .chm-card').scrollTop);
    assert(lob2.sh > lob2.ch && lobS > 0, `375×560: the lobby scrolls under a finger to Start (scrollTop ${lobS} of ${lob2.sh - lob2.ch})`);
    await a.evaluate(() => { document.querySelector('.chm-lobby .chm-card').scrollTop = 0; });
    await a.setViewportSize({ width: 390, height: 664 }); await wait(300);
    await a.tap('[data-act="start"]');
    for (let r = 1; r <= 4; r++) { await quickHsRound(a); if (r < 4) { await waitPhase(a, 'recap', 30000); await hook(a, 'action', 'next'); } }
    await waitPhase(a, 'recap', 30000); await hook(a, 'action', 'next');
    await waitPhase(a, 'final', 30000); await wait(900);
    // the QA case on top of whatever this run earned: a first match's FOUND IN + four unlocks (Gold and Ruby for both)
    await hook(a, 'finalExtras', [{ w: 'b', kind: 'find', text: 'Found in 0:05' }, { w: 'b', kind: 'find', text: 'Found in 0:04' }], [{ w: 'a', name: 'Gold', slot: 'eyes' }, { w: 'a', name: 'Ruby', slot: 'eyes' }, { w: 'b', name: 'Gold', slot: 'eyes' }, { w: 'b', name: 'Ruby', slot: 'eyes' }]);
    await wait(300);
    const pol = await hook(a, 'polish');
    // 375 × 560: an SE-sized phone with Safari's bars, where the card has to scroll
    for (const [w, hh] of [[390, 664], [375, 667], [375, 560]]) {
      await a.setViewportSize({ width: w, height: hh }); await wait(500);
      await a.evaluate(() => { document.querySelector('.chm-final .chm-card').scrollTop = 0; });
      const g0 = await finalGeom(a);
      console.log(`  ${w}×${hh}: card ${g0.top}–${g0.bottom} (scroll ${g0.sh} / ${g0.ch}), See the board ${g0.btn.join('–')}, stickers ${JSON.stringify(g0.stickers)} of ${pol.records.length} records + ${pol.unlocks.length} unlocks`);
      assert(g0.bottom <= g0.vh && g0.btn[1] <= g0.vh && g0.btnTop, `${w}×${hh}: See the board is on screen and on top before any scroll (${g0.btn.join('–')} of ${g0.vh})`);
      assert(!g0.corner, `${w}×${hh}: the hub's back / menu stickers clear the card (card top ${g0.top})`);
      const rowsN = new Set(g0.chips.map((q) => q[1])).size;
      assert(g0.chips.length < 2 || (rowsN <= Math.ceil(g0.chips.length / 2) && !g0.chips.some((q) => q[2])), `${w}×${hh}: vote chips sit two to a row (${g0.chips.length} chips in ${rowsN} rows), none clipped`);
      assert(g0.stickers.length <= 3 && (g0.stickers.length < 3 || !/^\+/.test(g0.stickers[2]) || /^\+\d+ (unlocked|more)$/.test(g0.stickers[2])) && !g0.labels.includes('0:05') && g0.labels.includes('Sydney: Found in 0:04') && (g0.labels.match(/Gold/g) || []).length === 1, `${w}×${hh}: ${pol.records.length} records + ${pol.unlocks.length} unlocks fold into ≤ 3 stickers, a record beaten twice shows once (${g0.stickers.join(' | ')})`);
      if (g0.sh > g0.ch + 1) {
        await touchDrag(a, g0.x, g0.y, -240);
        const g1 = await finalGeom(a);
        assert(g1.st > 0, `${w}×${hh}: a finger drag scrolls the final card (scrollTop ${g0.st} → ${g1.st} of ${g1.sh - g1.ch})`);
        assert(g1.btnTop && g1.btn[1] <= g1.vh, `${w}×${hh}: See the board stays pinned after the scroll (${g1.btn.join('–')})`);
      } else assert(hh > 600, `${w}×${hh}: the final card fits (${g0.sh} ≤ ${g0.ch}), nothing to scroll`);
      await shot(a, `uxqa-final-${w}x${hh}`);
    }
    // a vote rebuilds the card: the scroll position holds
    await a.evaluate(() => { const c = document.querySelector('.chm-final .chm-card'); c.scrollTop = c.scrollHeight; });
    const keep = (await finalGeom(a)).st;
    await a.tap('.chm-vote [data-vote="1"]');
    await a.waitForSelector('.chm-vote .crown', { timeout: 4000 });
    const after = (await finalGeom(a)).st;
    assert(keep === 0 || after >= keep - 2, `a vote rebuilds the card without jumping to the top (scrollTop ${keep} → ${after})`);
    const promised = (await finalGeom(a)).first;
    assert(promised === 'b', `the final card promises the other player first ("Rematch: … hides first" → ${promised})`);
    await a.tap('.chm-final [data-act="finish"]');
    // two rematches in a row: each new lobby (and round 1) follows what the last final card said
    let promise = promised;
    for (let k = 1; k <= 2; k++) {
      await a.waitForSelector('#game-root .gm-end [data-g="rematch"]', { timeout: 20000 });
      await a.click('#game-root .gm-end [data-g="rematch"]');
      await waitReady(a);
      const s1 = await st(a);
      assert(s1.setup.first === promise, `hotseat rematch ${k}: ${promise === 'a' ? 'Emerson' : 'Sydney'} hides first, as the final card said (lobby: ${s1.setup.first})`);
      if (k === 2) break;
      await hook(a, 'setRules', { rules: { rounds: 2 } });
      await a.tap('[data-act="start"]');
      await quickHsRound(a); await waitPhase(a, 'recap', 30000);
      assert((await st(a)).match.first === promise, `rematch ${k}: round 1's hider is ${promise}`);
      await hook(a, 'action', 'next');
      await quickHsRound(a); await waitPhase(a, 'recap', 30000); await hook(a, 'action', 'next');
      await waitPhase(a, 'final', 30000); await wait(500);
      const nextP = (await finalGeom(a)).first;
      assert(nextP === (promise === 'a' ? 'b' : 'a'), `rematch ${k}'s final card promises the other one next (${promise} → ${nextP})`);
      promise = nextP;
      await a.tap('.chm-final [data-act="finish"]');
    }
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'uxqa-final-FAIL').catch(() => {});
  } finally { await h.close(); }
}
async function uxRematchLiveSection(port) {
  console.log('\n# UX QA: two phones, Sydney picked to hide first: the final card promises Emerson, and the rematch starts with Emerson on both phones');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, hide: 6000, seek: 3000, recap: 900, found: 700, final: 600000, title: 300, maxDpr: 0.45 });
    await startMatch(h, { map: 'living', first: 'b', rules: { rounds: 2 } });
    // both rounds run out the clocks (Ready skips the hide)
    for (let r = 1; r <= 2; r++) {
      const hider = r === 1 ? b : a;
      await hider.waitForFunction((rr) => { const s = window.__cham.state(); return s.phase.round >= rr && s.phase.name !== 'title'; }, r, { timeout: 60000 });
      await hider.tap('.chm-acts [data-act="ready"]', { timeout: 2500 }).catch(() => {}); // or the 6 s hide clock runs out
      await a.waitForFunction((rr) => { const s = window.__cham.state(); return (s.phase.name === 'recap' && s.phase.round === rr) || s.phase.name === 'final'; }, r, { timeout: 60000 });
      // the 0.9 s recap moves on by itself
    }
    await waitPhase(a, 'final', 30000); await waitPhase(b, 'final', 10000); await wait(600);
    const fa = await finalGeom(a); const fb = await finalGeom(b);
    assert(fa.first === 'a' && fb.first === 'a', `both final cards: "Rematch: Emerson hides first" (${fa.first} / ${fb.first})`);
    await a.tap('.chm-final [data-act="finish"]');
    await a.waitForSelector('#game-root .gm-end [data-g="rematch"]', { timeout: 15000 });
    await b.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 15000 });
    await a.click('#game-root .gm-end [data-g="rematch"]');
    await waitLinked(a); await waitLinked(b);
    await a.waitForFunction(() => window.__cham.state().phase.name === 'lobby', null, { timeout: 20000 });
    await b.waitForFunction(() => window.__cham.state().setup.first === 'a', null, { timeout: 15000 }).catch(() => {});
    const sa = await st(a); const sb = await st(b);
    assert(sa.setup.first === 'a' && sb.setup.first === 'a', `after Rematch both lobbies say Emerson hides first (${sa.setup.first} / ${sb.setup.first})`);
    await a.tap('[data-act="start"]');
    await waitPhase(a, 'hide', 30000);
    const m = (await st(b)).match;
    assert(m && m.first === 'a', `the rematch's round 1 hider is Emerson on both phones (${m && m.first})`);
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'uxqa-rematch-FAIL-a').catch(() => {}); await shot(b, 'uxqa-rematch-FAIL-b').catch(() => {});
  } finally { await h.close(); }
}
async function uxWardrobeSection(port) {
  console.log('\n# UX QA: wardrobe rows keep their tile height on short phones (390×664, 375×667); the sheet scrolls under a finger');
  const h = await launch({ port, only: ['chameleon'], who: ['a'], coarse: true, device: 'iPhone 13' });
  const a = h.a;
  try {
    await arm(a, { ...FAST, maxDpr: 0.5 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    for (const [w, hh] of [[390, 844], [390, 664], [375, 667]]) {
      await a.setViewportSize({ width: w, height: hh }); await wait(400);
      if (!(await a.isVisible('.chm-wardrobe'))) await a.tap('.chm-wardbtn');
      await a.waitForSelector('.chm-wardrobe', { timeout: 4000 }); await wait(300);
      const m = await a.evaluate(() => {
        const rows = [...document.querySelectorAll('.chm-wardrobe .chm-wrow')].map((r) => { const t = r.querySelector('.chm-wt'); return { row: Math.round(r.getBoundingClientRect().height), tile: Math.round(t.getBoundingClientRect().height), clip: [...r.querySelectorAll('.chm-wt')].filter((x) => x.scrollHeight > x.clientHeight + 1).length, cut: r.clientHeight < r.scrollHeight - 1 }; });
        const sh = document.querySelector('.chm-wardrobe'); const sr = sh.getBoundingClientRect();
        return { rows, sh: sh.scrollHeight, ch: sh.clientHeight, x: sr.left + sr.width / 2, y: sr.top + sr.height * 0.6 };
      });
      assert(m.rows.length === 4 && m.rows.every((r) => r.row >= r.tile && !r.cut && !r.clip), `${w}×${hh}: every wardrobe row is as tall as its tiles (${m.rows.map((r) => `${r.row}/${r.tile}`).join(', ')} px), nothing clipped`);
      if (m.sh > m.ch + 1) {
        await a.evaluate(() => { document.querySelector('.chm-wardrobe').scrollTop = 0; });
        await touchDrag(a, m.x, m.y, -220);
        const s1 = await a.evaluate(() => document.querySelector('.chm-wardrobe').scrollTop);
        assert(s1 > 0, `${w}×${hh}: a finger drag scrolls the wardrobe sheet (scrollTop ${s1} of ${m.sh - m.ch})`);
      }
      await shot(a, `uxqa-ward-${w}x${hh}`);
    }
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
    await shot(a, 'uxqa-ward-FAIL').catch(() => {});
  } finally { await h.close(); }
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
  // pro pass (mechanics)
  if (want('feel')) sections.push(() => feelSection(PORT + 2));
  if (want('feel2')) sections.push(() => feel2Section(PORT + 3));
  if (want('fit')) sections.push(() => fitSection(PORT + 4));
  // pro pass (paint owner)
  if (want('paintfeel')) sections.push(() => paintFeelSection(PORT + 0));
  if (want('paintjuice')) sections.push(() => paintJuiceSection(PORT + 1));
  if (want('paintpro')) sections.push(() => paintProSection(PORT + 2));
  if (want('blendfair')) sections.push(() => blendFairSection(PORT + 3));
  // polish (UX owner)
  if (want('ux')) sections.push(() => uxSection(PORT + 5));
  if (want('uxland')) sections.push(() => uxLandscapeSection(PORT + 6));
  if (want('uxdesk')) sections.push(() => uxDesktopSection(PORT + 7));
  // UX QA round 1
  if (want('uxfinal')) sections.push(() => uxFinalSection(PORT + 8));
  if (want('uxrematch')) sections.push(() => uxRematchLiveSection(PORT + 9));
  if (want('uxward')) sections.push(() => uxWardrobeSection(PORT + 7));
  // pro pass (net owner)
  if (want('netpolish')) sections.push(() => netPolishSection(PORT + 4));
  // pro pass (maps owner)
  if (want('mapcache')) sections.push(() => mapCacheSection(PORT + 0));
  if (want('variety')) sections.push(() => varietySection(PORT + 1));
  if (want('mapslice')) sections.push(() => mapSliceSection(PORT + 2));
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
