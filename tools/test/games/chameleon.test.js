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
async function hotseat(port, { colorScheme = 'light', device = 'iPhone 13', prefix = 'phone-light', viewport = null, keyboard = false } = {}) {
  const h = await launch({ port, only: ['chameleon'], who: ['a'], colorScheme, device });
  const a = h.a;
  try {
    if (viewport) await a.setViewportSize(viewport);
    await arm(a);
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
      await a.keyboard.down('KeyW'); await wait(900); await a.keyboard.up('KeyW');
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
    await waitPhase(a, 'found', 8000);
    await wait(900);
    await shot(a, `${prefix}-4-found`);
    await waitPhase(a, 'recap', 8000);
    await wait(1800);
    await shot(a, `${prefix}-5-recap`);
    s = await st(a);
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
(async () => {
  const sections = [];
  if (want('hotseat')) {
    sections.push(async () => {
      console.log('\n# one-device hotseat round (phone, light) + screenshots');
      const h = await hotseat(8910, { prefix: 'phone-light' });
      await h.close();
    });
  }
  if (want('desktop')) {
    sections.push(async () => {
      console.log('\n# Desktop Chrome: keyboard + mouse (light) + screenshots at 1280×800');
      const h = await hotseat(8911, { device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, keyboard: true, prefix: 'desktop-light' });
      await h.close();
    });
  }
  if (want('dark')) {
    sections.push(async () => {
      console.log('\n# dark mode screenshots (phone + desktop)');
      let h = await hotseat(8912, { colorScheme: 'dark', prefix: 'phone-dark' });
      await h.close();
      h = await hotseat(8913, { colorScheme: 'dark', device: 'Desktop Chrome', viewport: { width: 1280, height: 800 }, keyboard: true, prefix: 'desktop-dark' });
      await h.close();
    });
  }
  for (const run of sections) {
    try { await run(); } catch (e) { console.error(e); failures++; }
  }
  if (failures) { console.error(`\n${failures} section(s) failed`); process.exitCode = 1; } else console.log('\nALL GOOD');
})();
