// Flat unit, party games (upgrade 2): what the Doodle and Same Wave upgrade is for.
//   PORT=9150 node tools/test/games/flat-party.test.js
// The rules and the full UI flows are in party-doodle.test.js / party-wave.test.js; this file checks:
//  - Doodle: the stored points of a drawing are exactly the old quantisation (grid of 256, 8 ms steps, 3 sq px dead zone),
//    coalesced events are used when present, the canvas rect is read once per stroke (not per move), ink is drawn in
//    rAF as one batch, the canvas keeps DPR <= 2, an old drawing string still round-trips byte for byte;
//  - Same Wave: the needle moves by transform only, and the dial is not re-measured per move;
//  - reduced motion: the new entrance / stamp animations are off, the needle jumps.
const { launch } = require('../harness');

let passed = 0;
const failures = [];
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); passed++; console.log('ok -', m); };
async function section(name, fn) {
  console.log(`\n# ${name}`);
  try { await fn(); } catch (e) { failures.push(`${name}: ${e.message}`); console.error('not ok -', e.message); }
}

// ── the stroke format, as the game stores it (copied from the old code on purpose: it must never change) ──
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const I64 = Object.fromEntries([...B64].map((c, i) => [c, i]));
const enc = (strokes) => strokes.map((st) => {
  let s = B64[st.c + 4 * st.s] + B64[st.gap >> 6] + B64[st.gap & 63];
  for (const [x, y, t] of st.pts) { const v = (x << 16) | (y << 8) | t; s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63]; }
  return s;
}).join('.');
const dec = (str) => str.split('.').map((part) => {
  const style = I64[part[0]];
  const st = { c: style & 3, s: style >> 2, gap: (I64[part[1]] << 6) | I64[part[2]], pts: [] };
  for (let i = 3; i < part.length; i += 4) {
    const v = (I64[part[i]] << 18) | (I64[part[i + 1]] << 12) | (I64[part[i + 2]] << 6) | I64[part[i + 3]];
    st.pts.push([(v >> 16) & 255, (v >> 8) & 255, v & 255]);
  }
  return st;
});

// A drawing recorded by the code before the upgrade (two strokes: a house outline in ink, a sun in the first player's colour).
const OLD_DRAWING = enc([
  { c: 0, s: 1, gap: 0, pts: [[40, 200, 0], [40, 120, 5], [100, 70, 5], [160, 120, 6], [160, 200, 5], [40, 200, 7]] },
  { c: 1, s: 0, gap: 61, pts: [[200, 30, 0], [210, 40, 4], [200, 50, 4], [190, 40, 4], [200, 30, 4]] },
]);

const layoutCount = async (cdp) => (await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === 'LayoutCount').value;

async function toRound(h, a, game, ready) {
  await h.newLocalGame(a, game);
  for (let g = 0; g < 40; g++) {
    if (await a.isVisible('#game-root .gm-curtain')) { await a.tap('#game-root [data-g="reveal"]'); await a.waitForTimeout(150); continue; }
    if (game === 'doodle') {
      if (await a.isVisible('.dd-start')) { await a.tap('.dd-start'); await a.waitForTimeout(250); continue; }
      if (await a.isVisible('.dd-pick')) { await a.tap('.dd-pick'); break; }
    } else {
      if (await a.isVisible('.wv-start')) { await a.tap('.wv-start'); await a.waitForTimeout(250); continue; }
      if (await a.isVisible('.wv-input')) { await a.fill('.wv-input', 'sunny day'); await a.press('.wv-input', 'Enter'); await a.waitForTimeout(250); continue; }
      if (await a.isVisible('.wv-dial.live')) break;
    }
    await a.waitForTimeout(150);
  }
  await a.waitForSelector(ready);
  await a.waitForTimeout(400);
}

(async () => {
  await section('doodle: an old drawing string is unchanged by the format', async () => {
    const d = dec(OLD_DRAWING);
    ok(d.length === 2 && d[0].pts.length === 6 && d[1].gap === 61 && d[1].c === 1 && d[0].s === 1, 'it decodes to the strokes it was made from');
    ok(enc(d) === OLD_DRAWING, 'and encodes back to the same string, byte for byte');
    ok(OLD_DRAWING === 'EAAKMgAKHgFZEYFoHgGoMgFKMgH.BA9yB4A0igEyDIEvigEyB4E', 'the golden string for it is the one the old code wrote');
  });

  await section('doodle: drawing is quantised exactly as before and costs no layout per move', async () => {
    const h = await launch({ port: +process.env.PORT || 9150, only: ['doodle'], coarse: true, who: ['a'] });
    const a = h.a;
    try {
      await toRound(h, a, 'doodle', '.dd-paper.can-draw canvas');
      const cdp = await a.context().newCDPSession(a);
      await cdp.send('Performance.enable');
      const dpr = await a.$eval('.dd-paper canvas', (c) => ({ w: c.width, css: parseFloat(c.style.width), d: window.devicePixelRatio }));
      ok(dpr.w / dpr.css <= 2.001, `the paper keeps a backing store of at most 2x (device ratio ${dpr.d}, canvas ${dpr.w}px for ${dpr.css} css px)`);
      // a scripted stroke: 3 coalesced points per move event, one of them inside the dead zone
      const res = await a.evaluate(() => new Promise((done) => {
        const cv = document.querySelector('.dd-paper canvas');
        const r0 = cv.getBoundingClientRect();
        let rectReads = 0; let strokeCalls = 0;
        const gb = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function () { rectReads++; return gb.call(this); };
        const cs = CanvasRenderingContext2D.prototype.stroke;
        CanvasRenderingContext2D.prototype.stroke = function () { strokeCalls++; return cs.apply(this, arguments); };
        const at = (gx, gy) => ({ clientX: r0.left + ((gx + 0.5) / 256) * r0.width, clientY: r0.top + ((gy + 0.5) / 256) * r0.height });
        const mk = (type, gx, gy, extra) => new PointerEvent(type, { pointerId: 41, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...at(gx, gy), ...extra });
        cv.dispatchEvent(mk('pointerdown', 50, 50));
        const expected = [[50, 50]];
        let n = 0;
        for (let m = 1; m <= 30; m++) {
          const list = [mk('pointermove', 50 + m * 4 - 2, 50 + m * 3 - 1), mk('pointermove', 50 + m * 4 - 1, 50 + m * 3), mk('pointermove', 50 + m * 4, 50 + m * 3)];
          const head = mk('pointermove', 50 + m * 4, 50 + m * 3);
          head.getCoalescedEvents = () => list; // the browser hands over the in-between samples
          cv.dispatchEvent(head);
          n++;
        }
        const syncStrokes = strokeCalls;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const framed = strokeCalls - syncStrokes;
          cv.dispatchEvent(mk('pointerup', 50 + 30 * 4, 50 + 30 * 3));
          Element.prototype.getBoundingClientRect = gb;
          CanvasRenderingContext2D.prototype.stroke = cs;
          done({ rectReads, syncStrokes, framed, n });
        }));
      }));
      ok(res.rectReads <= 2, `30 move events (90 samples) read the canvas rect ${res.rectReads} time(s): once at pointerdown, never per move`);
      ok(res.syncStrokes === 0, 'nothing is stroked inside the event handlers');
      ok(res.framed >= 1 && res.framed <= 2, `the whole batch is stroked in the next frame(s) as ${res.framed} path(s), not one stroke per sample`);
      const stored = await a.evaluate(() => { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)); try { const j = JSON.parse(v); if (j && typeof j.s === 'string' && j.pick !== undefined) return j.s; } catch { /* not json */ } } return null; });
      ok(stored, 'the drawing is saved as a draft');
      const st = dec(stored)[0];
      // expected: every sample, minus those closer than sqrt(3) to the previous kept one
      const exp = [[50, 50]];
      for (let m = 1; m <= 30; m++) for (const [x, y] of [[50 + m * 4 - 2, 50 + m * 3 - 1], [50 + m * 4 - 1, 50 + m * 3], [50 + m * 4, 50 + m * 3]]) { const l = exp[exp.length - 1]; if ((x - l[0]) ** 2 + (y - l[1]) ** 2 >= 3) exp.push([x, y]); }
      ok(st.pts.length === exp.length, `the stored stroke has ${st.pts.length} points (expected ${exp.length}: coalesced samples used, dead zone applied)`);
      ok(st.pts.every((p, i) => Math.abs(p[0] - exp[i][0]) <= 1 && Math.abs(p[1] - exp[i][1]) <= 1), 'every stored point sits on the 256 grid cell it was drawn in');
      ok(st.pts.every((p) => p[2] >= 0 && p[2] <= 255), 'time steps stay in one byte');
      ok(h.errors.length === 0, 'no page errors: ' + JSON.stringify(h.errors));
    } finally { await h.close(); }
  });

  await section('doodle: reduced motion switches the new entrance animations off', async () => {
    const h = await launch({ port: (+process.env.PORT || 9150) + 1, only: ['doodle'], coarse: true, who: ['a'] });
    const a = h.a;
    try {
      await a.emulateMedia({ reducedMotion: 'reduce' });
      await h.newLocalGame(a, 'doodle');
      for (let g = 0; g < 30; g++) {
        if (await a.isVisible('#game-root .gm-curtain')) { await a.tap('#game-root [data-g="reveal"]'); await a.waitForTimeout(150); continue; }
        if (await a.isVisible('.dd-start')) { await a.tap('.dd-start'); await a.waitForTimeout(250); continue; }
        if (await a.isVisible('.dd-pick')) break;
        await a.waitForTimeout(150);
      }
      await a.waitForSelector('.dd-pick');
      const anim = await a.$$eval('.dd-pick', (xs) => xs.map((x) => getComputedStyle(x).animationName));
      ok(anim.length === 3 && anim.every((n) => n === 'none'), 'the three prompt cards are not dealt with an animation');
      ok(h.errors.length === 0, 'no page errors');
    } finally { await h.close(); }
  });

  await section('wave: the needle turns by transform only; dragging never re-measures the dial', async () => {
    const h = await launch({ port: (+process.env.PORT || 9150) + 2, only: ['wave'], coarse: true, who: ['a'] });
    const a = h.a;
    try {
      await toRound(h, a, 'wave', '.wv-dial.live');
      const cdp = await a.context().newCDPSession(a);
      await cdp.send('Performance.enable');
      const P = (v) => a.$eval('.wv-dial.live svg', (svg, val) => { const r = svg.getBoundingClientRect(); const ang = Math.PI * (val / 100); return { x: r.left + (120 - 108 * 0.72 * Math.cos(ang)) * r.width / 240, y: r.top + (128 - 108 * 0.72 * Math.sin(ang) + 4) * r.height / 156 }; }, v);
      const pos = []; for (let v = 10; v <= 90; v += 2) pos.push(await P(v));
      const s0 = await P(50);
      await a.evaluate(() => { window.__rects = 0; const gb = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = function () { window.__rects++; return gb.call(this); }; });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s0.x, y: s0.y, id: 1 }] });
      const l0 = await layoutCount(cdp);
      for (const p of pos) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }); await a.waitForTimeout(12); }
      const l1 = await layoutCount(cdp);
      const rects = await a.evaluate(() => window.__rects);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      ok(rects <= 2, `${pos.length} touch moves measured the dial ${rects} time(s)`);
      ok(l1 - l0 <= 6, `a drag of ${pos.length} moves caused ${l1 - l0} layouts (the needle is a transform)`);
      const tf = await a.$eval('.wv-nl.n', (e) => e.style.transform);
      ok(/rotate\(-?[\d.]+deg\)/.test(tf), `the needle layer is turned with a CSS transform (${tf})`);
      await a.waitForTimeout(700);
      const settled = await a.$eval('.wv-nl.n', (e) => parseFloat(/rotate\((-?[\d.]+)deg/.exec(e.style.transform)[1]));
      const val = await a.$eval('.wv-dial.live', (d) => Number(d.getAttribute('aria-valuenow')));
      ok(Math.abs(settled - (val - 50) * 1.8) < 1, `the spring settles on the dial value (value ${val}, needle ${settled} deg)`);
      ok(h.errors.length === 0, 'no page errors: ' + JSON.stringify(h.errors));
    } finally { await h.close(); }
  });

  await section('wave: reduced motion makes the needle jump (no spring)', async () => {
    const h = await launch({ port: (+process.env.PORT || 9150) + 3, only: ['wave'], coarse: true, who: ['a'] });
    const a = h.a;
    try {
      await a.emulateMedia({ reducedMotion: 'reduce' });
      await toRound(h, a, 'wave', '.wv-dial.live');
      await a.focus('.wv-dial.live');
      await a.keyboard.press('ArrowRight'); await a.keyboard.press('ArrowRight'); await a.keyboard.press('ArrowRight');
      await a.waitForTimeout(40);
      const val = await a.$eval('.wv-dial.live', (d) => Number(d.getAttribute('aria-valuenow')));
      const ang = await a.$eval('.wv-nl.n', (e) => parseFloat(/rotate\((-?[\d.]+)deg/.exec(e.style.transform)[1]));
      ok(val !== 50 && Math.abs(ang - (val - 50) * 1.8) < 0.05, `40 ms after a key press the needle is already at ${ang} deg for value ${val}`);
      ok(h.errors.length === 0, 'no page errors');
    } finally { await h.close(); }
  });

  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} section(s) failed:\n - ${failures.join('\n - ')}` : ''}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
