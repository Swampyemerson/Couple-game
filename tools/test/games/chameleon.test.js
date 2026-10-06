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

const FAST = { hide: 12000, seek: 15000, title: 700, recap: 2500, found: 2200, seekLead: 900, resume: 1500, maxDpr: 0.6 };

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
      await hook(H, 'setLook', 0.6, 0);
      await H.click('.chm-acts [data-act="scurry"]');
      await Sk.waitForFunction(() => window.__cham.state().trails > 0, null, { timeout: 5000 });
      await wait(900);
      const p1 = (await st(H)).bodies[hider];
      const dash = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      assert(dash > 1 && (await st(H)).round.scurried[hider] && (await st(Sk)).round.scurried[hider], `round ${round}: one scurry dashed ${dash.toFixed(1)} m and left a trail the seeker saw`);
      assert(await H.$eval('.chm-acts [data-act="scurry"]', (b) => b.disabled), `round ${round}: the scurry is used up`);
      await wait(400);
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
  console.log('\n# the three dioramas: spawns, hiding walls, eyedropper probes, lobby sync of the map choice');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, maxDpr: 0.45 });
    for (const id of ['garden', 'studio', 'living']) {
      await a.click(`[data-lobby="map"][data-v="${id}"]`);
      await b.waitForFunction((m) => window.__cham.state().mapId === m, id, { timeout: 8000 });
      assert(true, `host picked the ${id} map and the guest's diorama switched with it`);
      await wait(400);
      await shot(a, `map-${id}`);
      const r = await hook(a, 'checkMap', id);
      const bad = Object.entries(r.spawns).filter(([, d]) => d > 0.02);
      assert(!bad.length, `${id}: every spawn is clear of props (${Object.keys(r.spawns).length} checked)`);
      assert(!!r.camoWall, `${id}: the suggested hiding spot has a wall to flatten against`);
      for (const p of r.probes) assert(p.got === p.want, `${id}: probe "${p.name}" albedo ${p.got} (want ${p.want})`);
      console.log(`  ${id}: ${r.verts} vertices, ${r.colliders} colliders`);
    }
    h.assertNoErrors();
  } catch (e) {
    console.error(e.message, h.errors); failures++;
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
  if (want('db')) sections.push(() => doubleBlindSection(PORT + 6));
  if (want('disconnect')) sections.push(() => disconnectSection(PORT + 7));
  if (want('robust')) sections.push(() => robustSection(PORT + 8));
  if (want('leaks')) sections.push(() => leakSection(PORT + 9));
  if (want('maps')) sections.push(() => mapsSection(PORT + 0));
  for (const run of sections) {
    try { await run(); } catch (e) { console.error(e); failures++; }
  }
  if (failures) { console.error(`\n${failures} section(s) failed`); process.exitCode = 1; } else console.log('\nALL GOOD');
})();
