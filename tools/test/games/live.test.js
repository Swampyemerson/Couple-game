// Live games: Air Hockey and Quick Draw, on two simulated phones (~40 ms network with jitter),
// on one shared phone (real multi-touch), and on one laptop (keyboard).
//   node tools/test/games/live.test.js            (SHOTS=/some/dir to keep the screenshots)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'live-shots');
const PORT = Number(process.env.PORT) || 8850; // PORT=8950 node … uses PORT..PORT+2
fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const near = (x, y, d = 1.5) => Math.abs(x - y) <= d;

// ── helpers ────────────────────────────────────────────────────────────
const hk = (pg) => pg.evaluate(() => window.__hockeyTest && window.__hockeyTest.state());
const qd = (pg) => pg.evaluate(() => window.__qdTest && window.__qdTest.state());
const endShown = (pg) => pg.isVisible('#game-root .gm-end');
const endHead = (pg) => pg.textContent('#game-root .gm-end .gm-end-head');
const results = (h, game) => h.results().filter((r) => r.game === game);

/** Dispatch pointer events on the hockey canvas at table coordinates (synthetic touches, so
 *  several fingers can be down at once). steps: [[id, type, x, y], ...] with type down|move|up. */
async function touch(pg, steps, gap = 16) {
  await pg.evaluate(async ({ steps, gap }) => {
    const cv = document.querySelector('.g-hockey canvas');
    for (const [id, type, x, y, raw] of steps) {
      const [cx, cy] = raw ? [x, y] : window.__hockeyTest.toClient(x, y);
      cv.dispatchEvent(new PointerEvent(`pointer${type}`, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: cx, clientY: cy, buttons: type === 'up' ? 0 : 1 }));
      if (gap) await new Promise((r) => setTimeout(r, gap));
    }
  }, { steps, gap });
}
/** A straight drag of one finger from (x0,y0) to (x1,y1) in table units. */
const drag = (pg, id, x0, y0, x1, y1, n = 8, gap = 16) => touch(pg, [
  [id, 'down', x0, y0], ...Array.from({ length: n }, (_, i) => [id, 'move', x0 + ((x1 - x0) * (i + 1)) / n, y0 + ((y1 - y0) * (i + 1)) / n]), [id, 'up', x1, y1],
], gap);
async function mouseTo(pg, x, y, steps = 1) {
  const [cx, cy] = await pg.evaluate(([x, y]) => window.__hockeyTest.toClient(x, y), [x, y]);
  await pg.mouse.move(cx, cy, { steps });
}
async function joinLive(h, game) {
  await h.startLive(h.a, game, 'live');
  await h.settle();
  assert(await h.b.isVisible('#gm-invite'), `${game}: Sydney sees the live invite`);
  await h.b.click('#gm-invite [data-g="invite-yes"]');
  await h.settle(); await h.settle();
}
/** Quick Draw: when `phase` shows on this page, wait `delay` ms and fire (precisely, in page).
 *  w: which pads (one pointerdown each, `lag` ms apart); key: a keyboard key instead. */
function qdFireAt(pg, phase, delay, { key = null, w = null, lag = 0 } = {}) {
  return pg.evaluate(({ phase, delay, key, w, lag }) => new Promise((resolve) => {
    const root = document.querySelector('.g-qd');
    const mk = (p, i) => { const r = p.getBoundingClientRect(); return new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7 + i, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }); };
    const down = (p, i, ev) => p.dispatchEvent(ev || mk(p, i));
    const go = () => setTimeout(() => {
      if (key) window.dispatchEvent(new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, bubbles: true }));
      else {
        const pads = w ? w.map((x) => root.querySelector(`.qd-pad[data-w="${x}"]`)) : [root.querySelector('.qd-pad')];
        if (lag) {   // taps `lag` ms apart: spin in this task (a timer would add its own lateness on a busy box)
          const t1 = performance.now();
          pads.forEach((p, i) => { while (performance.now() < t1 + i * lag); down(p, i); });
        } else {
          const evs = pads.map(mk);   // all events are made first: their timeStamps don't include the first handler's run time
          pads.forEach((p, i) => down(p, i, evs[i]));
        }
      }
      resolve(performance.now());
    }, delay);
    if (root.dataset.phase === phase) go();
    else {
      const mo = new MutationObserver(() => { if (root.dataset.phase === phase) { mo.disconnect(); go(); } });
      mo.observe(root, { attributes: true, attributeFilter: ['data-phase'] });
    }
  }), { phase, delay, key, w, lag });
}
const verdictFor = (pg, r) => pg.waitForFunction((r) => { const s = window.__qdTest && window.__qdTest.state(); return s && s.verdict && s.verdict.r >= r ? s.verdict : null; }, r, { timeout: 20000 }).then((x) => x.jsonValue());
const qdPhase = (pg, p, t = 14000) => pg.waitForFunction((p) => document.querySelector('.g-qd')?.dataset.phase === p, p, { timeout: t });
const qdCue = (pg, c, t = 14000) => pg.waitForFunction((c) => window.__qdTest && window.__qdTest.state().cue === c, c, { timeout: t });
const qdTap = (pg, sel) => pg.evaluate(() => matchMedia('(pointer: coarse)').matches).then((c) => (c ? pg.tap(sel) : pg.click(sel)));
const qdGo = (pg) => qdTap(pg, '.g-qd .qd-go');
const qdPick = async (pg, pack, series) => { if (pack) await qdTap(pg, `.g-qd [data-pack="${pack}"]`); if (series) await qdTap(pg, `.g-qd [data-series="${series}"]`); };
/** Quick Draw shots are JPEG: the paper grain makes a PNG of the screen take over a second, and most of these sit inside a timing window (a countdown, the gap between two draws, a decoy). */
const qdQuickShot = (h, pg, file) => h.shot(pg, file, { type: 'jpeg', quality: 80 });
const qdPressed = (pg, attr, v) => pg.waitForFunction(([a, v]) => document.querySelector(`.g-qd [${a}="${v}"]`)?.getAttribute('aria-pressed') === 'true', [attr, v], { timeout: 4000 });
const qdText = (pg, sel = '.qd-sig:not(.qd-top)') => pg.evaluate((sel) => { const s = document.querySelector(sel); return { word: s.querySelector('.qd-word').textContent.trim(), line: s.querySelector('.qd-line').textContent.trim(), times: s.querySelector('.qd-times').textContent.replace(/\s+/g, ' ').trim(), cls: s.className }; }, sel);
const qdData = (pg) => pg.evaluate(() => { try { return JSON.parse(localStorage.getItem('ju.games.data.v1') || '{}').quickdraw || {}; } catch { return {}; } });
/** Everything fits: no scrolling, every FIRE pad fully on screen and at least 44 px, the picker inside the stage. */
async function qdFit(pg, label) {
  const m = await pg.evaluate(() => {
    const r = document.getElementById('game-root');
    const box = (e) => { const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, w: b.width, h: b.height }; };
    const setup = document.querySelector('.qd-setup');
    return {
      over: r.scrollHeight - r.clientHeight, vw: innerWidth, vh: innerHeight, pageOver: document.scrollingElement.scrollHeight - innerHeight,
      pads: [...document.querySelectorAll('.qd-pad')].map(box), setupOver: setup && !setup.hidden ? setup.scrollHeight - setup.clientHeight : 0,
      card: setup && !setup.hidden ? box(setup.querySelector('.qd-setup-card')) : null, go: setup && !setup.hidden ? box(setup.querySelector('.qd-go')) : null,
    };
  });
  assert(m.over <= 1 && m.pageOver <= 1, `${label}: nothing scrolls (stage ${m.over}px, page ${m.pageOver}px)`);
  assert(m.pads.length > 0 && m.pads.every((p) => p.h >= 44 && p.w >= 44 && p.t >= 0 && p.b <= m.vh + 0.5 && p.l >= 0 && p.r <= m.vw + 0.5), `${label}: FIRE pads fully visible and >= 44 px (${m.pads.map((p) => `${Math.round(p.w)}x${Math.round(p.h)}`).join(', ')})`);
  if (m.card) assert(m.setupOver <= 1 && m.card.b <= m.vh + 0.5 && (m.go.h === 0 || m.go.h >= 44), `${label}: the picker fits (overflow ${m.setupOver}px, GO ${Math.round(m.go.h)} px tall)`);
}
/** After closing a game: no animation frames or timers keep running behind it. */
async function quietAfterClose(h, pg, label) {
  await pg.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 6000 }); // the app's own toasts use timers
  await pg.evaluate(() => {
    window.__bg = { raf: 0, to: 0, iv: 0, who: [] };
    const where = () => (new Error().stack || '').split('\n').slice(2, 4).map((x) => x.trim()).join(' < ');
    const r = window.requestAnimationFrame; const t = window.setTimeout; const i = window.setInterval;
    window.requestAnimationFrame = function (f) { window.__bg.raf++; window.__bg.who.push(where()); return r.call(window, f); };
    window.setTimeout = function (...a) { window.__bg.to++; window.__bg.who.push(where()); return t.apply(window, a); };
    window.setInterval = function (...a) { window.__bg.iv++; window.__bg.who.push(where()); return i.apply(window, a); };
  });
  await h.wait(1200);
  const bg = await pg.evaluate(() => window.__bg);
  assert(bg.raf === 0 && bg.to === 0 && bg.iv === 0, `${label}: nothing keeps running after close (raf ${bg.raf}, timeouts ${bg.to}, intervals ${bg.iv}) ${bg.who.join(' ;; ')}`);
}
/** Hockey: the host starts the match on `table` through the test hook (the picker itself is tested in hockeyPicker). */
async function hkStart(pg, table = 'classic') {
  await pg.waitForFunction(() => window.__hockeyTest, null, { timeout: 5000 });
  await pg.waitForFunction(() => window.__hockeyTest.state().phase === 'setup', null, { timeout: 5000 });
  await pg.evaluate((t) => window.__hockeyTest.start(t), table);
}
async function sizes(h) {
  await h.a.setViewportSize({ width: 390, height: 844 });
  await h.b.setViewportSize({ width: 360, height: 780 });
}

// ── 1. Air Hockey, two phones ─────────────────────────────────────────
async function hockeyLive(h, tag, quick = false) {
  const { a, b } = h;
  await joinLive(h, 'hockey');
  await hkStart(a, 'classic');
  await a.waitForFunction(() => window.__hockeyTest && window.__hockeyTest.state().phase === 'play', null, { timeout: 6000 });
  await b.waitForFunction(() => window.__hockeyTest && window.__hockeyTest.state().phase === 'play', null, { timeout: 6000 });
  const sa = await hk(a); const sb = await hk(b);
  assert(sa.host && sa.view === 'up' && !sb.host && sb.view === 'down', 'host draws its goal at the bottom; the guest sees the table turned round');
  const p1 = [(await hk(a)).puck, (await hk(b)).puck];
  await h.wait(250);
  const p2 = [(await hk(a)).puck, (await hk(b)).puck];
  assert(Math.hypot(p2[0].x - p1[0].x, p2[0].y - p1[0].y) > 2 && Math.hypot(p2[1].x - p1[1].x, p2[1].y - p1[1].y) > 2, 'the served puck moves on both phones');
  const [ha, hb] = [await hk(a), await hk(b)];
  const ahead = Math.hypot(hb.puck.x - ha.puck.x, hb.puck.y - ha.puck.y);
  assert(ahead < 14, `guest's predicted puck tracks the host's (${ahead.toFixed(1)} units apart, rtt ${hb.rtt} ms)`);
  await h.shot(a, `${SHOTS}/hockey-${tag}-live-mid-390-a.png`);
  await h.shot(b, `${SHOTS}/hockey-${tag}-live-mid-360-b.png`);
  if (!quick) {
    // Two fingers on the guest's phone (B1 on the live path): the first keeps the mallet, then the second takes over.
    await touch(b, [[91, 'down', 30, 20], [92, 'down', 70, 30], [91, 'move', 35, 18], [92, 'move', 75, 32]], 12);
    await h.wait(250);
    let gm = (await hk(b)).mallets.b;
    assert(near(gm.x, 35, 2.5) && near(gm.y, 18, 2.5), `live guest: the second finger doesn't steal the mallet (${gm.x.toFixed(1)},${gm.y.toFixed(1)})`);
    await touch(b, [[91, 'up', 35, 18]], 0); await h.wait(700);
    gm = (await hk(b)).mallets.b;
    assert(near(gm.x, 75, 3) && near(gm.y, 32, 3), `live guest: the first lifts, the mallet follows the second (${gm.x.toFixed(1)},${gm.y.toFixed(1)})`);
    await touch(b, [[92, 'up', 75, 32]], 0);
    // Host shot: Sydney parks in a corner, Emerson's mouse (a computer's way to play) drives through the puck.
    await touch(b, [[1, 'down', 12, 14], [1, 'move', 10, 10], [1, 'up', 10, 10]]);
    await mouseTo(a, 50, 160);
    await h.settle();
    await a.evaluate(() => window.__hockeyTest.place(50, 116, 0, 0));
    await h.wait(60);
    const hits0 = (await hk(a)).hits.a;
    await mouseTo(a, 50, 70, 6);
    await a.waitForFunction(() => window.__hockeyTest.state().score.a === 1, null, { timeout: 4000 });
    assert((await hk(a)).hits.a > hits0, 'host mallet hit the puck');
    await b.waitForFunction(() => window.__hockeyTest.state().score.a === 1, null, { timeout: 3000 });
    assert(true, 'a real shot scores, and both phones count it');
    // Guest shot: the puck waits on Sydney's half; Emerson moves aside; Sydney's finger sweeps through it.
    await a.waitForFunction(() => window.__hockeyTest.state().phase === 'play', null, { timeout: 5000 });
    await mouseTo(a, 90, 162, 4);
    await touch(b, [[2, 'down', 50, 22], [2, 'up', 50, 22]]);
    await h.settle();
    // Sydney's mallet sits still on Emerson's phone too (the host's copy of it used to keep a stale sideways speed for a while, which skewed the first hit)
    await a.waitForFunction(() => { const t = window.__hockeyTest.state().targets.b; return Math.abs(t.x - 50) < 0.3 && Math.abs(t.y - 22) < 0.6; }, null, { timeout: 3000 });
    await a.evaluate(() => window.__hockeyTest.place(50, 56, 0, 0));
    await h.settle();
    const hb0 = (await hk(a)).hits.b;
    await drag(b, 3, 50, 22, 50, 77, 6, 16);
    await a.waitForFunction((n) => window.__hockeyTest.state().hits.b > n, hb0, { timeout: 3000 });
    assert(true, 'the host registered the guest mallet hitting the puck');
    const after = await hk(a);
    assert(after.puck.vy > 30 || after.score.b === 1, `the guest's hit sent the puck toward Emerson's goal (vy ${after.puck.vy.toFixed(0)})`);
    assert(after.score.b === 1 || Math.abs(after.puck.vx) < 0.25 * after.puck.vy, `... and straight on, not skewed (vx ${after.puck.vx.toFixed(0)})`);
    await a.waitForFunction(() => window.__hockeyTest.state().score.b === 1, null, { timeout: 7000 });
    await b.waitForFunction(() => window.__hockeyTest.state().score.b === 1, null, { timeout: 3000 });
    assert(true, "the guest's shot scores on both phones");
    const chips = async (pg) => pg.evaluate(() => [...document.querySelectorAll('#game-root [data-score]')].map((e) => e.textContent).join('-'));
    assert(await chips(a) === '1-1' && await chips(b) === '1-1', 'score chips agree: 1-1');
  }
  // Fast-forward to 7 with the test hook (host only).
  const before = results(h, 'hockey').length;
  const target = 7 - (await hk(a)).score.a;
  for (let i = 0; i < target; i++) { await a.evaluate(() => window.__hockeyTest.score('a')); await h.wait(40); }
  await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 4000 });
  await b.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 4000 });
  assert(/Emerson/.test(await endHead(a)) && /Emerson/.test(await endHead(b)), 'end card on both phones: Emerson wins');
  const [ea, eb] = [await hk(a), await hk(b)];
  assert(ea.score.a === 7 && eb.score.a === 7 && ea.score.b === eb.score.b, `final score matches on both (${ea.score.a}-${ea.score.b})`);
  await h.settle();
  assert(results(h, 'hockey').length === before + 1, 'the result is recorded once');
  await h.shot(a, `${SHOTS}/hockey-${tag}-live-end-390-a.png`);
  await h.shot(b, `${SHOTS}/hockey-${tag}-live-end-360-b.png`);
}

async function hockeyRematchAndLeave(h) {
  const { a, b } = h;
  await b.click('#game-root [data-g="rematch"]');
  await h.settle(); await h.settle();
  assert(!(await endShown(a)) && !(await endShown(b)), 'rematch (from the guest) restarts on both');
  await hkStart(a, 'classic');
  const [ra, rb] = [await hk(a), await hk(b)];
  assert(ra.score.a === 0 && ra.score.b === 0 && rb.score.a === 0 && rb.score.b === 0, 'rematch starts at 0-0 on both');
  await a.waitForFunction(() => window.__hockeyTest.state().phase === 'play', null, { timeout: 5000 });
  // Sydney leaves: the host pauses. She comes back: a countdown, then play again.
  await h.closeGame(b);
  await h.settle(); await h.settle();
  assert((await hk(a)).phase === 'paused' && await a.isVisible('#game-root .gm-wait'), 'host pauses when the partner leaves');
  await a.click('#game-root [data-g="invite-again"]');
  await h.settle();
  await b.click('#gm-invite [data-g="invite-yes"]');
  await a.waitForFunction(() => window.__hockeyTest.state().phase === 'count', null, { timeout: 5000 });
  await a.waitForFunction(() => window.__hockeyTest.state().phase === 'play', null, { timeout: 5000 });
  assert(true, 'partner back: countdown, then play resumes');
  // The host (Emerson) leaves mid-match and comes back: the match carries on from the same score.
  for (let i = 0; i < 2; i++) { await a.evaluate(() => window.__hockeyTest.score('a')); await h.wait(40); }
  await b.waitForFunction(() => window.__hockeyTest.state().score.a === 2, null, { timeout: 4000 });
  await h.closeGame(a);
  await h.settle(); await h.settle();
  await b.click('#game-root [data-g="invite-again"]');
  await h.settle();
  await a.click('#gm-invite [data-g="invite-yes"]');
  await a.waitForFunction(() => window.__hockeyTest && ['count', 'play'].includes(window.__hockeyTest.state().phase), null, { timeout: 6000 });
  await h.settle();
  const [ka, kb] = [await hk(a), await hk(b)];
  assert(ka.score.a === 2 && ka.score.b === 0 && kb.score.a === 2 && kb.score.b === 0, `host left and came back: the match goes on at 2-0 on both (${ka.score.a}-${ka.score.b} / ${kb.score.a}-${kb.score.b})`);
  // Phones turned on their side: each sees a sideways table, own goal on the left, and a finger still lands the mallet under it.
  for (const pg of [a, b]) await pg.setViewportSize({ width: 844, height: 390 });
  await h.wait(300);
  const [la, lb] = [await hk(a), await hk(b)];
  assert(la.view === 'side' && lb.view === 'sideb', `landscape: sideways tables (${la.view} / ${lb.view})`);
  for (const [pg, w, tx, ty] of [[a, 'a', 30, 150], [b, 'b', 70, 25]]) {
    await touch(pg, [[5, 'down', tx + 1, ty + 1], [5, 'move', tx, ty]], 30);
    await h.wait(250);
    const m = (await hk(pg)).mallets[w];
    await touch(pg, [[5, 'up', tx, ty]], 0);
    assert(near(m.x, tx, 2) && near(m.y, ty, 2), `landscape ${w}: the mallet follows the finger (${m.x.toFixed(1)},${m.y.toFixed(1)})`);
  }
  await h.shot(b, `${SHOTS}/hockey-light-live-landscape-844-b.png`);
  await sizes(h);
  await h.closeGame(a); await h.closeGame(b);
  assert(await a.evaluate(() => !window.__hockeyTest) && await b.evaluate(() => !window.__hockeyTest), 'destroy() removed the test hooks');
  await quietAfterClose(h, a, 'hockey host');
  await quietAfterClose(h, b, 'hockey guest');
}

// ── 2. Air Hockey, one phone, two fingers ─────────────────────────────
async function hockeyLocalTouch(h) {
  const { a } = h;
  await h.startLive(a, 'hockey', 'local');
  await hkStart(a, 'classic');
  assert((await hk(a)).view === 'up', 'one phone: table upright, Sydney at the far end');
  // Two fingers down at once, one on each half, moved together.
  const steps = [[11, 'down', 30, 150], [12, 'down', 70, 20]];
  for (let i = 1; i <= 6; i++) steps.push([11, 'move', 30 - i * 2, 150 - i * 5], [12, 'move', 70 + i * 2, 20 + i * 5]);
  await touch(a, steps, 12);
  await h.wait(120);
  let s = await hk(a);
  assert(near(s.mallets.a.x, 18) && near(s.mallets.a.y, 120) && near(s.mallets.b.x, 82) && near(s.mallets.b.y, 50), `two simultaneous touches drive both mallets (a ${s.mallets.a.x.toFixed(1)},${s.mallets.a.y.toFixed(1)} b ${s.mallets.b.x.toFixed(1)},${s.mallets.b.y.toFixed(1)})`);
  // A finger keeps its own half: Emerson's finger crossing the line drags his mallet only to the line.
  await touch(a, [[11, 'move', 40, 30], [12, 'move', 60, 160]], 12);
  await h.wait(120);
  s = await hk(a);
  assert(near(s.mallets.a.y, 85 + 7.5, 0.6) && near(s.mallets.b.y, 85 - 7.5, 0.6), 'each finger stays bound to its half; mallets stop at the centre line');
  await touch(a, [[11, 'up', 40, 30], [12, 'up', 60, 160]], 0);
  // The iOS back-swipe edge is ignored.
  const before = (await hk(a)).mallets.a;
  await touch(a, [[13, 'down', 6, 700, true], [13, 'move', 60, 600, true], [13, 'up', 60, 600, true]]);
  await h.wait(80);
  const after = (await hk(a)).mallets.a;
  assert(near(before.x, after.x, 0.01) && near(before.y, after.y, 0.01), 'touches starting at the left screen edge are ignored');
  await hockeyTwoFingers(a, h);
  await h.shot(a, `${SHOTS}/hockey-light-local-mid-390.png`);
  const n0 = results(h, 'hockey').length;
  for (let i = 0; i < 7; i++) { await a.evaluate(() => window.__hockeyTest.score('b')); await h.wait(30); }
  await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 4000 });
  assert(/Sydney/.test(await endHead(a)), 'one phone: game to the end, Sydney wins');
  await h.settle();
  assert(results(h, 'hockey').length === n0 + 1, 'one-phone result recorded');
  await h.closeGame(a);
}

// ── 1b. Air Hockey: the table picker, power curve, stall breaker, drama, tables, lag ──
const hdata = (pg) => pg.evaluate(() => { try { return (JSON.parse(localStorage.getItem('ju.games.data.v1') || '{}')).hockey || {}; } catch { return {}; } });
const endUp = (pg) => pg.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 8000 });
const hkPhase = (pg, ph, timeout = 6000) => pg.waitForFunction((ph) => window.__hockeyTest && window.__hockeyTest.state().phase === ph, ph, { timeout });
async function scoreMany(pg, who, n, gap = 30) { for (let i = 0; i < n; i++) { await pg.evaluate((w) => window.__hockeyTest.score(w), who); await pg.waitForTimeout(gap); } }

/** Two phones: the host picks, the guest watches the choice, GO starts the same table on both. */
async function hockeyPicker(h) {
  const { a, b } = h;
  await joinLive(h, 'hockey');
  await a.waitForSelector('.hk-setup:not([hidden])'); await b.waitForSelector('.hk-setup:not([hidden])');
  assert(/Emerson is picking/.test(await b.textContent('.hk-wait')), 'guest sees "Emerson is picking…"');
  assert(await b.isDisabled('.hk-chip[data-tb="twin"]') && !(await a.isDisabled('.hk-chip[data-tb="twin"]')), 'only the host can choose');
  const boxes = await a.evaluate(() => [...document.querySelectorAll('.hk-chip, .hk-go')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  assert(boxes.length === 8 && boxes.every(([w, hh]) => w >= 44 && hh >= 44), `picker: 6 tables + Surprise + GO, all tap targets >= 44 px (${boxes.length})`);
  assert(await a.evaluate(() => document.querySelector('.hk-chip.is-on').dataset.tb) === 'classic', 'Classic is preselected the first time');
  await h.shot(a, `${SHOTS}/hockey-picker-390-a.png`); await h.shot(b, `${SHOTS}/hockey-picker-360-b.png`);
  await a.tap('.hk-chip[data-tb="twin"]');
  await b.waitForFunction(() => document.querySelector('.hk-chip.is-on') && document.querySelector('.hk-chip.is-on').dataset.tb === 'twin', null, { timeout: 4000 });
  assert(true, "the guest sees the host's choice change live (Twin Pucks)");
  await a.tap('.hk-go');
  await hkPhase(a, 'play', 7000); await hkPhase(b, 'play', 7000);
  const [sa, sb] = [await hk(a), await hk(b)];
  assert(sa.table === 'twin' && sb.table === 'twin' && sa.pucks.length === 2 && sb.pucks.length === 2, 'GO starts Twin Pucks on both phones, two pucks each');
  assert((await hdata(a)).hockey_last === 'twin', 'the choice is remembered (hockey_last)');
  await h.settle();
  await h.shot(a, `${SHOTS}/hockey-twin-live-390-a.png`); await h.shot(b, `${SHOTS}/hockey-twin-live-360-b.png`);
  await h.closeGame(a); await h.closeGame(b);
  // one phone: the last choice is preselected; Surprise me picks one by itself
  await h.startLive(a, 'hockey', 'local');
  await a.waitForSelector('.hk-setup:not([hidden])');
  assert(await a.evaluate(() => document.querySelector('.hk-chip.is-on').dataset.tb) === 'twin', 'rematch/next time: the last table is preselected');
  await a.tap('.hk-chip[data-tb="surprise"]'); await a.tap('.hk-go');
  await hkPhase(a, 'count', 4000);
  const ss = await hk(a);
  assert(ss.sel === 'surprise' && ['classic', 'pillar', 'twin', 'shrink', 'power', 'quick'].includes(ss.table), `Surprise me picked ${ss.table}`);
  assert((await hdata(a)).hockey_last === 'surprise', 'Surprise is remembered too');
  await h.closeGame(a);
}

/** B1: a second finger on a half that's already controlled is ignored; control passes on when the first lifts. */
async function hockeyTwoFingers(a, h) {
  await touch(a, [[31, 'down', 30, 150], [32, 'down', 70, 140]], 12);
  await h.wait(250);
  let s = await hk(a);
  assert(near(s.mallets.a.x, 30, 2) && near(s.mallets.a.y, 150, 2), `a second finger on the same half does not steal the mallet (${s.mallets.a.x.toFixed(1)},${s.mallets.a.y.toFixed(1)})`);
  await touch(a, [[31, 'move', 40, 145], [32, 'move', 75, 130]], 12);
  await h.wait(250);
  s = await hk(a);
  assert(near(s.mallets.a.x, 40, 2) && near(s.mallets.a.y, 145, 2), 'the first finger still drives the mallet; the second one is only waiting');
  await touch(a, [[31, 'up', 40, 145]], 0);
  await h.wait(700);
  s = await hk(a);
  assert(near(s.mallets.a.x, 75, 3) && near(s.mallets.a.y, 130, 3), `the first finger lifts: the mallet follows the second (${s.mallets.a.x.toFixed(1)},${s.mallets.a.y.toFixed(1)})`);
  await touch(a, [[32, 'move', 60, 155]], 12);
  await h.wait(350);
  s = await hk(a);
  assert(near(s.mallets.a.x, 60, 3) && near(s.mallets.a.y, 155, 3), 'and keeps following it');
  await touch(a, [[32, 'up', 60, 155]], 0);
}

/** The power curve: a slow push is a soft pass, a medium swipe a firm one, only a real flick a slap shot. */
async function hockeyPower(h) {
  const { a } = h;
  await h.startLive(a, 'hockey', 'local');
  await hkStart(a, 'classic');
  await hkPhase(a, 'play', 5000);
  const peak = () => a.evaluate(() => new Promise((resolve) => {
    let m = 0; const t0 = performance.now();
    const f = () => { const p = window.__hockeyTest.state().puck; m = Math.max(m, Math.hypot(p.vx, p.vy)); if (performance.now() - t0 < 1300) requestAnimationFrame(f); else resolve(m); };
    f();
  }));
  const trial = async (n, gap) => {
    await touch(a, [[60, 'down', 50, 150]], 0); await h.wait(450);
    await a.evaluate(() => window.__hockeyTest.place(50, 120, 0, 0));
    const p = peak();
    await touch(a, Array.from({ length: n }, (_, i) => [60, 'move', 50, 150 - ((i + 1) * 52) / n]), gap);
    await touch(a, [[60, 'up', 50, 98]], 0);
    return p;
  };
  const slow = await trial(70, 25); const med = await trial(15, 20); const fast = await trial(5, 5);
  assert(slow < 100, `slow push = soft pass (${Math.round(slow)} u/s)`);
  assert(med > slow && med <= fast + 5, `a medium swipe lands in between (${Math.round(med)} u/s; timing-dependent, so no absolute bound)`);
  assert(fast > 245, `a real flick = slap shot (${Math.round(fast)} u/s)`);
  assert(fast > slow * 2.5, 'the shot range is wide: flick vs push is > 2.5x');
  // Touch jitter must not double a push: the finger moves steadily but 30 % of the frames bring no touch sample (like a
  // 120 Hz screen over a 60 Hz digitiser: single, isolated drops in a fixed pattern; random drops made a run of three in
  // a row now and then, a triple step that was a real slap and failed the test about one run in twenty), so the next sample is a double step. The mallet's hitting speed is low-passed,
  // so the push stays near the finger's speed. Unsmoothed, a third of these pushes were slaps (median ~190, up to the 300 cap).
  const finger = 104; // u/s (about 350 px/s on a phone)
  const peaks = await a.evaluate(async (finger) => {
    const cv = document.querySelector('.g-hockey canvas'); const T = window.__hockeyTest; const frame = () => new Promise((r) => requestAnimationFrame(r));
    const send = (type, y) => { const [cx, cy] = T.toClient(50, y); cv.dispatchEvent(new PointerEvent(`pointer${type}`, { bubbles: true, cancelable: true, pointerId: 61, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: cy, buttons: type === 'up' ? 0 : 1 })); };
    const out = []; let tick = 0;
    for (let rep = 0; rep < 6; rep++) {
      let worst = 0; let y = 158; send('down', y); for (let i = 0; i < 30; i++) await frame();
      T.place(50, 118, 0, 0); let last = performance.now();
      while (y > 96) {
        await frame(); const now = performance.now(); const dt = (now - last) / 1000; last = now;
        y -= finger * dt; if (![2, 5, 8].includes(tick++ % 10)) send('move', y);
        const p = T.state().puck; worst = Math.max(worst, Math.hypot(p.vx, p.vy));
      }
      send('up', y);
      for (let i = 0; i < 20; i++) { await frame(); const p = T.state().puck; worst = Math.max(worst, Math.hypot(p.vx, p.vy)); }
      T.place(50, 80, 0, 0); out.push(Math.round(worst));
    }
    return out;
  }, finger);
  const sorted = [...peaks].sort((x, y) => x - y); const median = (sorted[2] + sorted[3]) / 2; const worst = sorted[sorted.length - 1];
  assert(median < 140 && worst < 220, `a ${finger} u/s push stays a soft pass under touch jitter (peaks ${peaks.join(' ')}; median ${median} < 140, worst ${worst} < 220)`);
  await h.closeGame(a);
}

/** B3/B4: shot clock on a puck sat on one half, and a puck sandwiched between both mallets. */
async function hockeyStall(h) {
  const { a } = h;
  await h.startLive(a, 'hockey', 'local');
  await hkStart(a, 'classic');
  await hkPhase(a, 'play', 5000);
  await a.evaluate(() => window.__hockeyTest.place(50, 130, 0, 0));
  await a.waitForFunction(() => window.__hockeyTest.state().pucks[0].sk > 0, null, { timeout: 6000 });
  const sk = (await hk(a)).pucks[0].sk;
  assert(sk > 0 && sk <= 3000, `a puck sat on one half starts the 3-2-1 shot clock after ~3 s (${sk} ms left)`);
  await h.shot(a, `${SHOTS}/hockey-shotclock-390.png`);
  await hkPhase(a, 'count', 5000);
  const st = await a.evaluate(() => ({ stamps: window.__hockeyTest.stamps(), s: window.__hockeyTest.state() }));
  assert(st.stamps.includes('HOG!'), 'HOG! stamp');
  assert(near(st.s.puck.x, 50, 1) && near(st.s.puck.y, 85, 1), 'the puck is back on the centre spot');
  await h.shot(a, `${SHOTS}/hockey-hog-390.png`);
  await hkPhase(a, 'play', 4000); await h.wait(500);
  assert((await hk(a)).puck.vy < -5, 'served toward the player who did not hog it');
  // a puck squeezed between both mallets
  await a.evaluate(() => window.__hockeyTest.place(50, 85, 0, 0));
  await touch(a, [[71, 'down', 50, 90], [72, 'down', 50, 80]], 10);
  await a.waitForFunction(() => window.__hockeyTest.stamps().includes('RESET') || window.__hockeyTest.state().phase === 'count', null, { timeout: 4000 });
  assert(true, 'a puck sandwiched between the mallets is reset');
  await touch(a, [[71, 'up', 50, 90], [72, 'up', 50, 80]], 0);
  await h.closeGame(a);
}

/** Nothing printed in the middle of the table may land on anything else, and the scoreboard bands come and go with the room. */
async function hockeyOverlays(h) {
  const { a } = h;
  await h.startLive(a, 'hockey', 'local');
  for (const [w, hh, want] of [[390, 844, 'h'], [430, 932, 'h'], [360, 640, null], [375, 667, null], [844, 390, 'v'], [390, 664, null]]) {
    await a.setViewportSize({ width: w, height: hh }); await h.wait(300);
    const st = await hk(a);
    assert(st.band === want, `${w}x${hh}: scoreboard bands ${want ? `shown (${want})` : 'hidden when space is tight'} (band ${st.band})`);
  }
  await hkStart(a, 'classic');
  const sample = (ms) => a.evaluate((ms) => new Promise((resolve) => {
    const out = []; const t0 = performance.now(); let since = null;
    const f = () => {
      const s = window.__hockeyTest.state(); const now = performance.now();
      if (s.centre.length) { if (since === null) since = now; } else since = null;
      out.push({ ph: s.phase, c: s.centre, hint: s.hint, busyFor: since === null ? 0 : now - since, stamps: window.__hockeyTest.stamps() });
      if (now - t0 < ms) requestAnimationFrame(f); else resolve(out);
    };
    f();
  }), ms);
  await hkPhase(a, 'play', 5000);
  await a.evaluate(() => window.__hockeyTest.place(50, 130, 0, 0));
  await hkPhase(a, 'count', 8000);
  const hog = await sample(3300);
  assert(hog.some((f) => f.c.includes('HOG!')), 'the HOG! stamp showed');
  assert(hog.some((f) => f.c.includes('digit')), 'then the 3-2-1 showed');
  assert(!hog.some((f) => f.c.includes('HOG!') && f.c.includes('digit')), 'HOG! and the 3-2-1 are never on screen together');
  assert(!hog.some((f) => f.busyFor > 250 && f.hint > 0.2), 'the "Drag your mallet" hint steps aside while the middle is busy');
  assert(hog[hog.length - 1].ph === 'play' && hog[hog.length - 1].hint > 0.9 || (await hk(a)).hint > 0.9, 'and comes back (nobody has touched yet)');
  await a.evaluate(() => window.__hockeyTest.score('b'));
  const goal = await sample(3200);
  assert(goal.some((f) => f.c.includes('goal')) && goal.some((f) => f.c.includes('digit')), 'goal stamp, then the countdown');
  assert(!goal.some((f) => f.c.includes('goal') && f.c.includes('digit')), 'the goal stamp and the 3-2-1 never overlap');
  assert(!goal.some((f) => f.busyFor > 250 && f.hint > 0.2), 'the hint stays out of the way of the goal stamp and the countdown');
  await a.setViewportSize({ width: 390, height: 664 });
  await h.closeGame(a);
}

/** The drama kit, records and the rivalry line (one phone, hooks). */
async function hockeyDrama(h) {
  const { a } = h;
  await h.startLive(a, 'hockey', 'local');
  await hkStart(a, 'classic');
  await hkPhase(a, 'play', 5000);
  // POST! on the goal frame
  await a.evaluate(() => window.__hockeyTest.place(30, 14, 0, -130));
  await a.waitForFunction(() => window.__hockeyTest.stamps().includes('POST!'), null, { timeout: 2000 });
  assert((await a.evaluate(() => window.__hockeyTest.events())).some((e) => e[1] === 1), 'the puck off the goal frame: POST! stamp + clang event');
  await h.shot(a, `${SHOTS}/hockey-post-390.png`);
  // rally counter + record
  await a.evaluate(() => window.__hockeyTest.setRally(9, 'a'));
  await h.wait(120);
  await h.shot(a, `${SHOTS}/hockey-rally-390.png`);
  assert((await hk(a)).rally === 9, 'rally counter (9 shown as RALLY 9!)');
  await a.evaluate(() => window.__hockeyTest.score('a'));
  await a.waitForFunction(() => window.__hockeyTest.stamps().some((x) => /RALLY RECORD/.test(x)), null, { timeout: 2000 });
  let d = await hdata(a);
  assert(d.hk_rally_best === 9 && d.hk_rally_who === 'a', `longest rally saved (hk_rally_best ${d.hk_rally_best}, who ${d.hk_rally_who})`);
  // match point: slow-mo once when the puck heads at the goal in the defending third
  await scoreMany(a, 'a', 5);
  await hkPhase(a, 'count', 5000); await hkPhase(a, 'play', 5000);
  await h.shot(a, `${SHOTS}/hockey-matchpoint-390.png`);
  await touch(a, [[73, 'down', 90, 15]], 0); await h.wait(400); // Sydney's mallet steps aside
  await a.evaluate(() => window.__hockeyTest.place(50, 44, 0, -170));
  await a.waitForFunction(() => window.__hockeyTest.state().ts < 0.9, null, { timeout: 1500 });
  assert(true, 'match point: slow motion as the puck heads at goal');
  await h.shot(a, `${SHOTS}/hockey-slowmo-390.png`);
  await endUp(a);
  assert(/Emerson/.test(await endHead(a)), 'match won');
  const sub = await a.textContent('#game-root .gm-end .gm-end-sub');
  d = await hdata(a);
  assert(/7–0/.test(sub) && /Shutout/.test(sub), `rivalry line: "${sub}"`);
  assert(d.hk_shutout_a_n === 1 && d.hk_streak_who === 'a' && d.hk_streak_len === 1, 'shutout and streak saved');
  await h.shot(a, `${SHOTS}/hockey-end-shutout-390.png`);
  await h.closeGame(a);
  // second match: Emerson comes back from 0-3 and extends the streak
  await h.startLive(a, 'hockey', 'local');
  await hkStart(a, 'classic');
  await scoreMany(a, 'b', 3); await scoreMany(a, 'a', 7);
  await endUp(a);
  const sub2 = await a.textContent('#game-root .gm-end .gm-end-sub');
  d = await hdata(a);
  assert(/COMEBACK from 3 down/.test(sub2) && /2-match streak/.test(sub2), `comeback badge and streak in the rivalry line: "${sub2}"`);
  assert(d.hk_comeback_a_n === 1 && d.hk_streak_len === 2 && d.hk_streak_best >= 2, 'comeback + streak saved');
  await h.shot(a, `${SHOTS}/hockey-end-comeback-390.png`);
  await h.closeGame(a);
}

/** Every table on one phone: its own rule, played to the end. */
async function hockeyTables(h, tag, which) {
  const { a } = h;
  for (const t of which) {
    await h.startLive(a, 'hockey', 'local');
    await hkStart(a, t);
    await hkPhase(a, 'play', 5000);
    const s0 = await hk(a);
    assert(s0.table === t, `table ${t}`);
    if (t === 'pillar') {
      assert(s0.post, 'Pillar: the post is on the table');
      await a.evaluate(() => window.__hockeyTest.place(50, 55, 0, 110));
      await h.wait(300);
      const s = await hk(a);
      assert(s.puck.y < 76 && s.puck.vy < 0, `the puck bounces off the post (y ${s.puck.y.toFixed(1)}, vy ${s.puck.vy.toFixed(0)})`);
      await touch(a, [[81, 'down', 50, 90]], 0); await h.wait(450);
      const m = (await hk(a)).mallets.a;
      assert(Math.hypot(m.x - 50, m.y - 85) >= 14 - 0.6, `a mallet can't sit on the post (${m.x.toFixed(1)},${m.y.toFixed(1)})`);
      await touch(a, [[81, 'up', 50, 90]], 0);
    }
    if (t === 'twin') {
      assert(s0.pucks.length === 2, 'Twin Pucks: two pucks');
      await a.evaluate(() => window.__hockeyTest.place(50, 12, 0, -140, 1));
      await a.waitForFunction(() => window.__hockeyTest.state().score.a === 1, null, { timeout: 3000 });
      const s = await hk(a);
      assert(s.phase === 'play' && s.pucks[0].on && !s.pucks[1].on, 'a goal with either puck counts; the other keeps playing');
      await a.waitForFunction(() => window.__hockeyTest.state().pucks[1].on, null, { timeout: 4000 });
      assert(true, 'the scored puck re-serves from the centre');
    }
    if (t === 'shrink') {
      assert(s0.goals.a === 16 && s0.goals.b === 16, 'Shrinking Goals: both goals 16 wide (half-width)');
      await scoreMany(a, 'a', 1);
      let s = await hk(a);
      assert(s.goals.b === 14 && s.goals.a === 16, "Emerson scored: Sydney's goal gets smaller, Emerson's stays");
      await scoreMany(a, 'a', 3);
      s = await hk(a);
      assert(s.goals.b === 10, `...down to a minimum (${s.goals.b})`);
      await scoreMany(a, 'b', 1);
      s = await hk(a);
      assert(s.goals.a === 14, 'the trailing player keeps the bigger target');
      await h.wait(900);
      await h.shot(a, `${SHOTS}/hockey-shrink-${tag}-390.png`);
    }
    if (t === 'power') {
      await touch(a, [[82, 'down', 50, 150]], 0); await h.wait(450);
      await a.evaluate(() => window.__hockeyTest.place(50, 120, 0, 0));
      await touch(a, Array.from({ length: 6 }, (_, i) => [82, 'move', 50, 150 - ((i + 1) * 50) / 6]), 8);
      await touch(a, [[82, 'up', 50, 100]], 0);
      await h.wait(150);
      assert((await hk(a)).rally >= 1, 'Power Puck: the rally counts hits');
      await a.evaluate(() => window.__hockeyTest.setRally(10, 'a'));
      await a.evaluate(() => window.__hockeyTest.place(50, 100, 0, -140));
      await h.wait(150);
      await h.shot(a, `${SHOTS}/hockey-power-${tag}-390.png`);
    }
    if (t === 'pillar' || t === 'twin') await h.shot(a, `${SHOTS}/hockey-${t}-${tag}-390.png`);
    const need = t === 'quick' ? 3 : 7;
    const have = (await hk(a)).score.a;
    await scoreMany(a, 'a', need - have);
    await endUp(a);
    assert(/Emerson/.test(await endHead(a)), `${t}: played to the end (first to ${need})`);
    await h.closeGame(a);
  }
}

/** Two phones, every table: both see it, the host's rules run, the guest follows. */
async function hockeyLiveTables(h, which, label) {
  const { a, b } = h;
  await joinLive(h, 'hockey');
  for (let i = 0; i < which.length; i++) {
    const t = which[i];
    if (i) { await b.click('#game-root [data-g="rematch"]'); await h.settle(); await h.settle(); }
    await hkStart(a, t);
    await hkPhase(a, 'play', 9000); await hkPhase(b, 'play', 9000);
    const sb = await hk(b);
    assert(sb.table === t && sb.pucks.length === (t === 'twin' ? 2 : 1), `${label}: the guest plays ${t}`);
    if (t === 'twin') {
      await a.evaluate(() => window.__hockeyTest.place(50, 100, 0, 30, 1));
      await h.wait(600);
      const [pa, pb] = [(await hk(a)).pucks, (await hk(b)).pucks];
      assert(Math.hypot(pa[1].x - pb[1].x, pa[1].y - pb[1].y) < 25, `${label}: the guest sees both pucks where the host has them`);
    }
    if (t === 'shrink') {
      await a.evaluate(() => window.__hockeyTest.score('a'));
      await b.waitForFunction(() => window.__hockeyTest.state().goals.b === 14, null, { timeout: 4000 });
      assert(true, `${label}: the guest's goals shrink with the score`);
    }
    if (t === 'pillar') assert((await hk(b)).post, `${label}: the guest sees the post`);
    const need = t === 'quick' ? 3 : 7;
    await scoreMany(a, 'a', need - (await hk(a)).score.a, 60);
    await endUp(a); await endUp(b);
    assert(/Emerson/.test(await endHead(b)), `${label}: ${t} played to the end on both`);
  }
  await h.closeGame(a); await h.closeGame(b);
}

/** B2: guest puck corrections never teleport (latency 120, 20 % loss, the host hits again and again). */
async function hockeyLag(h) {
  const { a, b } = h;
  await joinLive(h, 'hockey');
  await hkStart(a, 'classic');
  await hkPhase(a, 'play', 9000); await hkPhase(b, 'play', 9000);
  await a.evaluate(() => {
    const cv = document.querySelector('.g-hockey canvas'); const T = window.__hockeyTest;
    const send = (type, x, y) => { const [cx, cy] = T.toClient(x, y); cv.dispatchEvent(new PointerEvent('pointer' + type, { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: cy, buttons: type === 'up' ? 0 : 1 })); };
    let bx = 50; let by = 150; let down = false; let last = performance.now(); let next = last + 1200;
    window.__botStop = false; window.__placeAt = [];
    const f = () => {
      if (window.__botStop) return; requestAnimationFrame(f);
      const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const P = T.state().puck;
      if (now > next) { next = now + 1300; window.__placeAt.push(Date.now()); T.place(25 + Math.random() * 50, 96, (Math.random() - 0.5) * 60, 120); }
      let tx = 50; let ty = 150;
      if (P.y > 90) { tx = P.x; ty = P.y - 4; }
      const dx = tx - bx; const dy = ty - by; const d = Math.hypot(dx, dy); const st = 320 * dt;
      if (d > st) { bx += (dx / d) * st; by += (dy / d) * st; } else { bx = tx; by = ty; }
      send(down ? 'move' : 'down', bx, by); down = true;
    };
    f();
  });
  await b.evaluate(() => {
    const T = window.__hockeyTest; window.__smp = []; window.__smpStop = false;
    const f = () => { if (window.__smpStop) return; requestAnimationFrame(f); const s = T.state(); window.__smp.push([Date.now(), performance.now(), s.puck.x, s.puck.y, s.puck.vx, s.puck.vy, s.phase, s.score.a + s.score.b]); };
    f();
  });
  await h.wait(14000);
  const hostHits = (await hk(a)).hits.a;
  const [smp, places] = await Promise.all([b.evaluate(() => { window.__smpStop = true; return window.__smp; }), a.evaluate(() => { window.__botStop = true; return window.__placeAt; })]);
  let worst = 0; let n = 0;
  for (let i = 1; i < smp.length; i++) {
    const [w0, t0, x0, y0, vx0, vy0, ph0, sc0] = smp[i - 1]; const [w1, t1, x1, y1, , , ph1, sc1] = smp[i];
    const dt = t1 - t0;
    if (dt > 34 || ph0 !== 'play' || ph1 !== 'play' || sc0 !== sc1) continue;
    if (places.some((p) => w1 >= p - 100 && w1 <= p + 700)) continue; // the test's own teleport of the puck
    const jump = Math.abs(Math.hypot(x1 - x0, y1 - y0) - Math.hypot(vx0, vy0) * (dt / 1000));
    worst = Math.max(worst, jump); n++;
  }
  assert(hostHits >= 4 && n > 100, `the host hit the puck ${hostHits} times; ${n} guest frames measured`);
  assert(worst < 25, `latency 120 + 20 % loss: the guest's puck never jumps more than 25 u in a frame (worst ${worst.toFixed(1)} u)`);
  await h.closeGame(a); await h.closeGame(b);
}

/** The host's copy of the guest's mallet moves at the guest's finger speed: no catch-up spikes between presence samples
 *  (a spike would turn a soft guest pass into a slap on the host, and the guest would see the puck suddenly speed up). */
async function hockeyGuestMallet(h) {
  const { a, b } = h;
  await joinLive(h, 'hockey');
  await hkStart(a, 'classic');
  await hkPhase(a, 'play', 9000); await hkPhase(b, 'play', 9000);
  await a.evaluate(() => window.__hockeyTest.place(92, 140, 0, 0));
  const sampler = a.evaluate(() => new Promise((res) => { const out = []; const t0 = performance.now(); const f = () => { out.push([performance.now() - t0, window.__hockeyTest.state().mallets.b.y]); if (performance.now() - t0 < 1800) requestAnimationFrame(f); else res(out); }; f(); }));
  const finger = 89; // u/s
  await b.evaluate(async (finger) => {
    const T = window.__hockeyTest; const cv = document.querySelector('.g-hockey canvas'); const frame = () => new Promise((r) => requestAnimationFrame(r));
    const send = (type, y) => { const [cx, cy] = T.toClient(50, y); cv.dispatchEvent(new PointerEvent(`pointer${type}`, { bubbles: true, pointerId: 44, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: cy, buttons: 1 })); };
    send('down', 15); for (let i = 0; i < 40; i++) await frame();
    let y = 15; while (y < 70) { await frame(); y += finger / 60; send('move', y); }
    send('up', y);
  }, finger);
  const out = await sampler;
  let peak = 0; let moved = 0;
  for (let i = 1; i < out.length; i++) { const v = Math.abs(out[i][1] - out[i - 1][1]) / ((out[i][0] - out[i - 1][0]) / 1000); if (out[i][0] > 600 && out[i][0] < 1500) { peak = Math.max(peak, v); moved++; } }
  assert(moved > 20 && peak < 2.6 * finger, `the host sees the guest's mallet at the finger's speed, with no catch-up spikes (peak ${Math.round(peak)} u/s for a ${finger} u/s finger)`);
  await h.closeGame(a); await h.closeGame(b);
}

/** The laptop: Enter starts the picked table; WASD around the post. */
async function hockeyDesk(h, pg) {
  await h.startLive(pg, 'hockey', 'local');
  await pg.waitForSelector('.hk-setup:not([hidden])');
  await h.shot(pg, `${SHOTS}/hockey-picker-desk.png`);
  await pg.click('.hk-chip[data-tb="pillar"]');
  await pg.keyboard.press('Enter');
  await hkPhase(pg, 'play', 6000);
  assert((await hk(pg)).table === 'pillar' && (await hk(pg)).view === 'side', 'laptop: click a table, press Enter, play (sideways table with the post)');
  await h.shot(pg, `${SHOTS}/hockey-pillar-desk.png`);
  await pg.keyboard.down('KeyD'); await h.wait(1200); await pg.keyboard.up('KeyD');
  const m = (await hk(pg)).mallets.a;
  assert(Math.hypot(m.x - 50, m.y - 85) >= 13.4, 'keyboard mallet stays off the post');
  await h.closeGame(pg);
}

// ── 3. Quick Draw, two phones ─────────────────────────────────────────
/** Play whole rounds to a decision by fouls: `loser` jumps early in each. Returns the last round number. */
async function qdFoulRounds(h, host, loserPg, n, from = 1) {
  for (let r = from; r < from + n; r++) { if (r > 1) await verdictFor(loserPg, r - 1); await qdFireAt(loserPg, 'steady', 150); await verdictFor(host, r); }
  return from + n - 1;
}
async function quickdrawLive(h, tag) {
  const { a, b } = h;
  await joinLive(h, 'quickdraw');
  const n0 = results(h, 'quickdraw').length;
  // The picker: the host chooses, the guest watches the choice change.
  await a.waitForSelector('.g-qd .qd-setup'); await b.waitForSelector('.g-qd .qd-setup');
  assert(await a.isVisible('.g-qd .qd-setup') && await b.isVisible('.g-qd .qd-setup'), 'both phones open on the duel picker');
  assert(/Emerson is picking/.test(await b.textContent('.qd-setup-head')) && !(await b.isVisible('.qd-go')) && await a.isVisible('.qd-go'), 'the guest sees "Emerson is picking…" and no GO button');
  await qdFit(a, `${tag} host picker (390x844)`); await qdFit(b, `${tag} guest picker (360x780)`);
  await qdPick(a, 'bell');
  await qdPressed(b, 'data-pack', 'bell');
  assert(true, "the guest sees the host's live choice (Bell)");
  await qdPick(a, 'classic', '5');
  await qdPressed(b, 'data-pack', 'classic');
  await qdQuickShot(h, b, `${SHOTS}/qd-${tag}-live-picker-360-b.jpg`);
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-live-picker-390-a.jpg`);
  await qdGo(a);
  await qdPhase(b, 'steady');
  assert(true, 'GO starts the duel on both phones');
  await qdFit(a, `${tag} host in play`); await qdFit(b, `${tag} guest in play`);
  // Round 1: Emerson jumps the gun.
  await qdFireAt(a, 'steady', 150);
  let v = await verdictFor(a, 1);
  const vb = await verdictFor(b, 1);
  assert(v.w === 'b' && v.why === 'foul' && vb.w === 'b', 'foul: firing before DRAW loses the round (both phones agree)');
  await h.wait(300);
  let t = await qdText(b);
  assert(t.line === 'Emerson jumped early' && t.times === '' && !/[—–]/.test(`${t.word} ${t.line} ${t.times}`), `a foul win reads "${t.line}" with no bare dash`);

  // Round 2: Sydney's network is slow (+150 ms each way out) but her hand is faster.
  const slowed = await b.evaluate(() => {
    const o = window.__room; window.__roomFast = o;
    try { window.__room = (op, ...r) => (op === 'emit' || op === 'presence' ? new Promise((res) => setTimeout(res, 150)).then(() => o(op, ...r)) : o(op, ...r)); } catch { return false; }
    return window.__room !== o;
  });
  await qdPhase(b, 'steady');
  await qdQuickShot(h, b, `${SHOTS}/qd-${tag}-live-steady-360-b.jpg`);
  await Promise.all([qdFireAt(a, 'draw', 230), qdFireAt(b, 'draw', 140)]);
  v = await verdictFor(a, 2);
  const recv = (await a.evaluate(() => window.__qdTest.recv())).filter((x) => x.r === v.r);
  assert(slowed && recv.length === 2 && recv[0].w === 'a', `Emerson's result reached the referee first (${recv.map((x) => x.w).join(' then ')})`);
  assert(v.w === 'b' && v.b.reaction < v.a.reaction, `...but Sydney wins on reaction time (${v.b.reaction} ms vs ${v.a.reaction} ms)`);
  await h.wait(700);
  t = await qdText(a);
  assert(/^Emerson \d+ ms\s*·\s*Sydney \d+ ms$/.test(t.times) && t.line === `Sydney by ${v.diff} ms`, `times in chip order and the margin: "${t.times}" / "${t.line}"`);
  const tb = await qdText(b);
  assert(tb.times === t.times, 'both phones show the same timings');
  await b.evaluate(() => { window.__room = window.__roomFast; });
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-live-result-390-a.jpg`);

  // Round 3: Emerson fires, Sydney sits it out: the verdict doesn't wait 4 s for her.
  const t0 = await qdFireAt(a, 'draw', 150);
  v = await verdictFor(a, 3);
  const took = (await a.evaluate(() => performance.now())) - t0;
  assert(v.w === 'a' && v.why === 'time' && took < 1700, `an idle opponent doesn't hold up the verdict (${Math.round(took)} ms after the shot, rtt ${(await qd(a)).rtt} ms)`);
  await h.wait(300);
  t = await qdText(b);
  assert(/Emerson takes the round/.test(t.line), `no margin when only one fired: "${t.line}"`);

  // Round 4: both jump; Sydney jumped earlier (on the shared clock), so she loses it.
  await Promise.all([qdFireAt(a, 'steady', 160), qdFireAt(b, 'steady', 40)]);
  v = await verdictFor(a, 4);
  assert(v.why === 'fouls' && v.w === 'a', 'double foul: whoever jumped earlier loses');
  // 2-2 at match point: the decider is Both barrels. Sydney fires on the first draw: foul.
  await qdPhase(a, 'steady');
  const rd = (await qd(a)).rd;
  assert(rd.both === 1 && rd.gap > 0, `tied at match point: Both barrels (second draw ${rd.gap} ms after the first)`);
  await qdCue(b, 'first');
  await qdFireAt(b, 'steady', 30);
  await qdQuickShot(h, b, `${SHOTS}/qd-${tag}-live-barrels-360-b.jpg`);   // after the tap: a shot inside the gap would eat it
  v = await verdictFor(a, 5);
  assert(v.w === 'a' && v.why === 'foul' && v.both === 1 && v.tally.a === 3 && v.tally.b === 2, 'firing on the first of the two draws is a foul: Emerson takes the duel 3-2');
  await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 5000 });
  await b.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 5000 });
  assert(/Emerson/.test(await endHead(a)) && /Emerson/.test(await endHead(b)), 'end card on both phones: Emerson wins');
  const sub = await a.textContent('#game-root .gm-end .gm-end-sub');
  assert(/3–2/.test(sub) && /fastest draw \d+ ms|new PB/.test(sub), `the end card carries the rivalry line: "${sub.trim()}"`);
  assert((await b.textContent('#game-root .gm-end .gm-end-sub')).trim() === sub.trim(), 'the guest reads the same line');
  await h.settle();
  assert(results(h, 'quickdraw').length === n0 + 1, 'the duel is recorded once');
  const d = await qdData(a);
  assert(typeof d.qd_pb_a_ms === 'number' && typeof d.qd_pb_b_ms === 'number' && typeof d.qd_best_ms === 'number' && (d.qd_best_who === 'a' || d.qd_best_who === 'b'), `personal bests and the fastest draw are saved (${d.qd_pb_a_ms} / ${d.qd_pb_b_ms} / ${d.qd_best_ms} ms)`);
  assert(d.qd_streak_who === 'a' && d.qd_streak_c === 1 && d.qd_streak_best === 1 && d.qd_last === 'classic:5', `streak and last duel are saved (${d.qd_streak_who} x${d.qd_streak_c}, ${d.qd_last})`);
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-live-end-390-a.jpg`);
  await qdQuickShot(h, b, `${SHOTS}/qd-${tag}-live-end-360-b.jpg`);
  // Rematch from the host: the picker is back on the last duel, and starts it after a short countdown.
  await a.click('#game-root [data-g="rematch"]');
  await h.settle();
  assert(!(await endShown(a)) && !(await endShown(b)), 'rematch restarts on both');
  await a.waitForSelector('.g-qd .qd-setup:not([hidden])');
  await qdPressed(a, 'data-pack', 'classic'); await qdPressed(a, 'data-series', '5');
  assert(/GO · \d/.test(await a.textContent('.qd-go')) && /Same again/.test(await a.textContent('.qd-setup-head')), 'rematch: the last duel is preselected, with a countdown to GO');
  await qdPhase(b, 'steady');
  const [qa, qb] = [await qd(a), await qd(b)];
  assert(qa.tally.a + qa.tally.b === 0 && qb.tally.a + qb.tally.b === 0 && qb.cfg.s === '5', 'rematch: fresh tally, the same duel started by itself on both');
  await h.closeGame(a); await h.closeGame(b);
  await quietAfterClose(h, a, 'quick draw host');
  await quietAfterClose(h, b, 'quick draw guest');
}

// Quick Draw packs: Decoys, Colour, Bell and Mixed, rendered identically on both phones.
async function quickdrawPacks(h, tag) {
  const { a, b } = h;
  await joinLive(h, 'quickdraw');
  await qdPick(a, 'mixed', '9');
  await qdPressed(b, 'data-pack', 'mixed'); await qdPressed(b, 'data-series', '9');
  await qdGo(a);
  const word = async (pg) => (await qdText(pg)).word;
  // Decoys: BRAW! appears in the DRAW style, firing on it is a foul.
  await a.evaluate(() => window.__qdTest.force({ kind: 'decoys', decoys: [800], dw: [0], delay: 2800 }));
  await qdCue(a, 'decoy'); await qdCue(b, 'decoy');
  const [da, db] = [await qdText(a), await qdText(b)];
  assert(da.word === 'BRAW!' && db.word === 'BRAW!' && /is-draw/.test(da.cls) && (await qd(b)).phase === 'steady', 'a decoy word shows in the DRAW style on both phones while it is still Steady');
  await qdQuickShot(h, b, `${SHOTS}/qd-${tag}-live-decoy-360-b.jpg`);
  await qdFireAt(a, 'steady', 120);
  let v = await verdictFor(a, 1);
  assert(v.w === 'b' && v.why === 'foul' && v.kind === 'decoys', 'firing on a decoy is a foul');
  // Colour: the lantern turns PINK (a bluff), then YELLOW.
  await a.evaluate(() => window.__qdTest.force({ kind: 'colour', decoys: [900], dw: [1], delay: 2800 }));
  await qdCue(a, 'decoy'); await qdCue(b, 'decoy');
  const lc = (pg) => pg.evaluate(() => document.querySelector('.qd-lantern').style.getPropertyValue('--lc'));
  assert(/--p-b/.test(await lc(a)) && /--p-b/.test(await lc(b)) && await word(a) === 'PINK' && await word(b) === 'PINK', 'colour pack: the same bluff colour (named, too) on both phones');
  await qdPhase(a, 'draw'); await qdPhase(b, 'draw');
  assert(/--g-hl/.test(await lc(b)) && await word(b) === 'YELLOW!', 'colour pack: the lantern turns YELLOW');
  await qdQuickShot(h, b, `${SHOTS}/qd-${tag}-live-colour-360-b.jpg`);
  await qdFireAt(b, 'draw', 150);
  v = await verdictFor(a, 2);
  assert(v.w === 'b' && v.why === 'time' && v.kind === 'colour', 'firing on yellow wins the round');
  // Bell: a quiet tink (bluff), then the bell rings and swings.
  await a.evaluate(() => window.__qdTest.force({ kind: 'bell', decoys: [900], dw: [0], delay: 2800 }));
  await qdCue(a, 'decoy'); await qdCue(b, 'decoy');
  const bell = (pg) => pg.evaluate(() => document.querySelector('.qd-bell').getAttribute('class'));
  assert(/is-tink/.test(await bell(a)) && /is-tink/.test(await bell(b)), 'bell pack: a bluff tink shows on both phones');
  await qdPhase(a, 'draw'); await qdPhase(b, 'draw');
  assert(/is-ring/.test(await bell(a)) && /is-ring/.test(await bell(b)) && await word(a) === 'DING!', 'bell pack: the bell swings and the word says DING! (a muted phone still sees it)');
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-live-bell-390-a.jpg`);
  await qdFireAt(a, 'draw', 150);
  v = await verdictFor(a, 3);
  assert(v.w === 'a' && v.kind === 'bell', 'firing on the bell wins');
  // Mixed: whichever kind the host picks, both phones show it and the sign announces it.
  await qdPhase(a, 'steady'); await qdPhase(b, 'steady');
  const kinds = await Promise.all([a, b].map((pg) => pg.evaluate(() => ({ k: document.querySelector('.g-qd').dataset.kind, sign: document.querySelector('.qd-kind').textContent, hidden: document.querySelector('.qd-kind').hidden }))));
  assert(kinds[0].k === kinds[1].k && /MIXED/.test(kinds[0].sign) && !kinds[0].hidden && kinds[0].sign === kinds[1].sign, `mixed: both phones announce "${kinds[0].sign}"`);
  await qdFireAt(b, 'steady', 100);
  v = await verdictFor(a, 4);
  assert(v.why === 'foul', 'a mixed round plays to a verdict');
  await h.closeGame(a); await h.closeGame(b);
}

// Quick Draw: win streaks across duels, the bounty, Both barrels fired correctly, the Showdown.
async function quickdrawStreaks(h, tag) {
  const { a, b } = h;
  await joinLive(h, 'quickdraw');
  await qdPick(a, 'classic', '3'); await qdGo(a);
  // Duel 1 (best of 3): Emerson wins 2-0 on fouls, then rematches twice more.
  await qdFoulRounds(h, a, b, 2);
  await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 8000 });
  let sub = await a.textContent('#game-root .gm-end .gm-end-sub');
  assert(/2–0/.test(sub) && !/streak/.test(sub), `duel 1: "${sub.trim()}"`);
  for (const n of [2, 3]) {
    await a.click('#game-root [data-g="rematch"]'); await h.settle();
    await qdPick(a, null, '3'); await qdGo(a);   // taps cancel the countdown, so GO is ours
    await qdFoulRounds(h, a, b, 2);
    await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 8000 });
    sub = await a.textContent('#game-root .gm-end .gm-end-sub');
    assert(new RegExp(`Emerson on a ${n}-duel streak`).test(sub), `duel ${n}: "${sub.trim()}"`);
  }
  // Duel 4: Sydney ends a 3-duel streak and claims the bounty. The decider is Both barrels, fired properly.
  await a.click('#game-root [data-g="rematch"]'); await h.settle();
  await qdPick(a, null, '3'); await qdGo(a);
  await qdFireAt(a, 'steady', 150); await verdictFor(a, 1); await verdictFor(b, 1);   // Emerson jumps: Sydney 1-0
  await qdFireAt(b, 'steady', 150); await verdictFor(a, 2);   // Sydney jumps: 1-1, match point for both
  await qdPhase(a, 'steady');
  { const s = await qd(a); assert(s.rd.both === 1, `best of 3 tied 1-1: Both barrels (${JSON.stringify({ t: s.tally, cfg: s.cfg, r: s.r, ph: s.phase })})`); }
  await qdCue(a, 'first'); await qdCue(b, 'first');
  assert((await qdText(a)).word === 'DRAW!' && (await qdText(b)).word === 'DRAW!' && (await qd(a)).phase === 'steady', 'the first of the two draws looks like a real one');
  await Promise.all([qdFireAt(b, 'draw', 140)]);
  const v = await verdictFor(a, 3);
  assert(v.w === 'b' && v.why === 'time' && v.both === 1 && v.res && v.res.bounty === true, 'firing on the second draw wins the decider');
  await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 8000 });
  await b.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 8000 });
  sub = await b.textContent('#game-root .gm-end .gm-end-sub');
  assert(/Bounty claimed!/.test(sub), `Sydney ends Emerson's streak: "${sub.trim()}"`);
  await qdQuickShot(h, b, `${SHOTS}/qd-${tag}-live-bounty-360-b.jpg`);
  const d = await qdData(a);
  assert(d.qd_streak_who === 'b' && d.qd_streak_c === 1 && d.qd_streak_best === 3 && d.qd_streak_best_who === 'a', `streak resets, best streak kept (${d.qd_streak_who} x${d.qd_streak_c}, best ${d.qd_streak_best})`);
  // Showdown: first to 5, win by 2.
  await b.click('#game-root [data-g="rematch"]'); await h.settle();
  await qdPick(a, 'classic', 'sd'); await qdPressed(b, 'data-series', 'sd'); await qdGo(a);
  await qdPhase(b, 'steady');
  assert((await qd(b)).cfg.s === 'sd', 'Showdown reaches the guest');
  await h.closeGame(a); await h.closeGame(b);
}

// Quick Draw, two phones on a slow line: a simultaneous double foul is a re-round, whoever's network is slower.
async function quickdrawLatency(h) {
  const { a, b } = h;
  await joinLive(h, 'quickdraw');
  await qdGo(a);
  const fireAtWall = (pg, target) => pg.evaluate((target) => new Promise((res) => setTimeout(() => { const p = document.querySelector('.qd-pad'); const r = p.getBoundingClientRect(); p.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); res(Date.now()); }, Math.max(0, target - Date.now()))), target);
  for (let r = 1; r <= 3; r++) {
    await qdPhase(a, 'steady'); await qdPhase(b, 'steady');
    const target = Date.now() + 500;
    const [ta, tb] = await Promise.all([fireAtWall(a, target), fireAtWall(b, target)]);
    const v = await verdictFor(a, r);
    const vb = await verdictFor(b, r);
    assert(v.why === 'dfoul' && !v.w && vb.why === 'dfoul', `latency 200, taps ${Math.abs(ta - tb)} ms apart on the wall clock: a double foul, re-round with no winner (rtt ${(await qd(a)).rtt} ms)`);
    assert(v.tally.a === 0 && v.tally.b === 0, 'the re-round scores nothing');
  }
  await h.closeGame(a); await h.closeGame(b);
}

// Quick Draw on a bad line (120 ms, 20 % of messages lost): a whole best-of-3 still plays to the end.
async function quickdrawLossy(h) {
  const { a, b } = h;
  await joinLive(h, 'quickdraw');
  await qdPick(a, 'decoys', '3'); await qdGo(a);
  let v;
  for (let n = 1; n <= 10 && !(v && v.res); n++) {
    await qdFireAt(b, 'draw', 170);
    v = await verdictFor(a, n);
    await verdictFor(b, n);
    assert(v.w === 'b' || v.why === 'void' || v.why === 'none', `lossy line, round ${n}: a clean verdict on both phones (${v.why}${v.w ? `, ${v.w}` : ''})`);
  }
  await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 12000 });
  await b.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 12000 });
  assert(/Sydney/.test(await endHead(a)) && /Sydney/.test(await endHead(b)), 'lossy line: the duel finishes, Sydney wins on both phones');
  await h.closeGame(a); await h.closeGame(b);
}

// Quick Draw: either phone leaves mid-duel and comes back (picker, mid-round, host re-mount, Showdown cap).
async function qdRejoin(h, from, to) {
  await from.click('#game-root [data-g="invite-again"]');
  await h.settle();
  await to.click('#gm-invite [data-g="invite-yes"]');
}
async function quickdrawLeave(h, tag) {
  const { a, b } = h;
  await joinLive(h, 'quickdraw');
  const n0 = results(h, 'quickdraw').length;
  // 1. Sydney drops out while Emerson is still picking; when she is back she sees his choice, and GO starts both.
  await a.waitForSelector('.g-qd .qd-setup');
  await qdPick(a, 'bell', '3');
  await qdPressed(b, 'data-pack', 'bell');
  await h.closeGame(b);
  await a.waitForFunction(() => window.__qdTest.state().paused, null, { timeout: 4000 });
  await qdRejoin(h, a, b);
  await b.waitForFunction(() => window.__qdTest && document.querySelector('.g-qd .qd-setup:not([hidden])'), null, { timeout: 6000 });
  await qdPressed(b, 'data-pack', 'bell'); await qdPressed(b, 'data-series', '3');
  assert(/Emerson is picking/.test(await b.textContent('.qd-setup-head')), 'guest came back during the picker: the host\'s choice (Bell, best of 3) is shown again');
  await qdPick(a, 'classic', '3');
  await qdPressed(b, 'data-pack', 'classic');
  await qdGo(a);
  // 2. Sydney drops out mid-round: the round is voided and the host waits. She rejoins: a fresh round.
  await qdPhase(a, 'steady');
  await h.closeGame(b);
  await a.waitForFunction(() => window.__qdTest.state().phase === 'paused', null, { timeout: 4000 });
  await h.wait(5000);
  assert((await qd(a)).phase === 'paused' && !(await qd(a)).verdict, 'partner gone: the round is voided and the duel waits (no verdict, no stray DRAW)');
  await qdRejoin(h, a, b);
  await b.waitForFunction(() => { const p = document.querySelector('.g-qd')?.dataset.phase; return p === 'draw' || p === 'steady'; }, null, { timeout: 8000 });
  const shot = qdPhase(b, 'draw', 9000).then(() => qdQuickShot(h, b, `${SHOTS}/qd-${tag}-live-draw-360-b.jpg`));
  await Promise.all([qdFireAt(a, 'draw', 120), qdFireAt(b, 'draw', 260), shot]);
  await verdictFor(a, 1);
  await verdictFor(b, 1);
  await h.wait(400);
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-live-result-390-a.jpg`);
  // 3. The host (Emerson) leaves mid-duel and comes back: the duel carries on from the same tally and pack.
  const t1 = (await qd(b)).tally;
  assert(t1.a === 1 && t1.b === 0, `Emerson is up 1-0 (${t1.a}-${t1.b})`);
  await h.closeGame(a);
  await b.waitForFunction(() => window.__qdTest.state().phase === 'paused', null, { timeout: 4000 });
  assert((await qd(b)).paused, 'host gone: the guest waits too');
  await qdRejoin(h, b, a);
  await a.waitForFunction(() => window.__qdTest, null, { timeout: 6000 });
  await h.settle(); await h.settle();
  const [ta, tb] = [await qd(a), await qd(b)];
  assert(ta.tally.a === t1.a && ta.tally.b === t1.b && tb.tally.a === t1.a && tb.tally.b === t1.b, `host left and came back: the tally is still ${t1.a}-${t1.b} on both`);
  assert(ta.started && ta.cfg.s === '3' && ta.cfg.p === 'classic', `...and the duel's pack and series survive the re-mount (${ta.cfg.p}:${ta.cfg.s})`);
  assert(!(await a.isVisible('.g-qd .qd-setup')), 'the returning host skips the picker');
  await qdPhase(b, 'steady'); await qdPhase(a, 'steady');
  await qdFireAt(b, 'steady', 100);
  await verdictFor(a, 1);
  await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 6000 });
  await b.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 6000 });
  assert(/Emerson/.test(await endHead(b)) && /Emerson/.test(await endHead(a)), `${tag}: duel over after the re-mount, end card on both`);
  await h.settle();
  assert(results(h, 'quickdraw').length === n0 + 1, 'and the duel is recorded once');
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-live-end-390-a.jpg`);
  await qdQuickShot(h, b, `${SHOTS}/qd-${tag}-live-end-360-b.jpg`);
  await h.closeGame(a); await h.closeGame(b);
}

// Quick Draw: a rematch starts the last duel by itself after 3 s, visibly, and "Pick again" stops it.
async function quickdrawRematch(h, tag) {
  const { a, b } = h;
  await joinLive(h, 'quickdraw');
  await qdPick(a, 'decoys', '3'); await qdGo(a);
  await qdFoulRounds(h, a, b, 2);
  await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 6000 });
  await b.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 6000 });
  await a.click('#game-root [data-g="rematch"]');
  await h.settle();
  await a.waitForSelector('.g-qd .qd-setup:not([hidden])'); await b.waitForSelector('.g-qd .qd-setup:not([hidden])');
  await qdPressed(a, 'data-pack', 'decoys'); await qdPressed(a, 'data-series', '3');
  await b.waitForFunction(() => /Same again/.test(document.querySelector('.qd-setup-head')?.textContent || ''), null, { timeout: 3000 });
  const [ha, hb] = [await a.textContent('.qd-setup-head'), await b.textContent('.qd-setup-head')];
  assert(/Same again/.test(ha) && /Starting in \d/.test(hb) && await a.isVisible('.qd-again') && !(await b.isVisible('.qd-again')), `the host sees the countdown with a "Pick again" button, the guest sees it too ("${hb.trim()}")`);
  const btn = await a.evaluate(() => { const r = document.querySelector('.qd-again').getBoundingClientRect(); const g = document.querySelector('.qd-go').getBoundingClientRect(); return { h: r.height, w: r.width, gh: g.height }; });
  assert(btn.h >= 44 && btn.w >= 44 && btn.gh >= 44, `"Pick again" and GO are big enough (${Math.round(btn.w)}x${Math.round(btn.h)}, GO ${Math.round(btn.gh)} px)`);
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-live-rematch-390-a.jpg`);
  await qdQuickShot(h, b, `${SHOTS}/qd-${tag}-live-rematch-360-b.jpg`);
  await qdTap(a, '.qd-again');
  await h.wait(3800);
  assert((await qd(a)).phase === 'setup' && (await qd(b)).phase === 'setup' && !(await qd(a)).started, 'Pick again: nothing starts by itself any more, on either phone');
  assert(/is picking/.test(await b.textContent('.qd-setup-head')) && /Pick the duel/.test(await a.textContent('.qd-setup-head')) && !(await a.isVisible('.qd-again')), 'the countdown is gone from both screens, the choice is kept');
  await qdPressed(a, 'data-pack', 'decoys'); await qdPressed(a, 'data-series', '3');
  await qdGo(a);
  await qdPhase(b, 'steady');
  await h.closeGame(a); await h.closeGame(b);
}

// Quick Draw, Showdown: after 15 decided rounds the next one is sudden death (one phone, laptop-free).
async function quickdrawSudden(h, tag) {
  const { a } = h;
  await h.startLive(a, 'quickdraw', 'local');
  await a.waitForFunction(() => window.__qdTest, null, { timeout: 4000 });
  const n0 = results(h, 'quickdraw').length;
  await a.evaluate(() => window.__qdTest.start('classic', 'sd', { a: 7, b: 8 }));   // 15 rounds in, nobody is two ahead
  await qdPhase(a, 'steady');
  const rd = (await qd(a)).rd;
  assert(rd.sd === 1 && (await qd(a)).cfg.s === 'sd', 'Showdown at 7-8 after 15 rounds: the next round is sudden death');
  const t = await qdText(a);
  assert(/SUDDEN DEATH/.test(t.line) && /SUDDEN DEATH/.test(await a.textContent('.qd-kind:not(.qd-top)')), `it says so ("${t.line}") and on the sign`);
  await h.wait(250);
  assert(/SUDDEN DEATH/.test(await a.textContent('.qd-stamp')), 'and stamps SUDDEN DEATH');
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-local-sudden-390.jpg`);
  await qdFireAt(a, 'draw', 130, { w: ['a'] });   // Emerson was behind: his hit takes the duel
  const v = await verdictFor(a, 1);
  assert(v.w === 'a' && v.res && v.sd === 1 && v.tally.a > v.tally.b, `whoever hits first takes the duel, even from behind (${v.tally.a}-${v.tally.b})`);
  await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 5000 });
  assert(/Emerson/.test(await endHead(a)) && /sudden death/.test(await a.textContent('#game-root .gm-end .gm-end-sub')), 'the end card says Emerson won in sudden death');
  await h.settle();
  assert(results(h, 'quickdraw').length === n0 + 1, 'recorded once');
  await h.closeGame(a);
}

// ── 4. Quick Draw, one phone ──────────────────────────────────────────
async function quickdrawLocal(h, tag) {
  const { a } = h;
  await h.startLive(a, 'quickdraw', 'local');
  await a.waitForFunction(() => window.__qdTest, null, { timeout: 4000 });
  assert((await qd(a)).layout === 'phone', 'one phone: a button at each end');
  // Fit: no scrolling and both FIRE pads fully visible, on small and large phones, both ways round.
  for (const [w, hh] of [[375, 667], [360, 640], [320, 568], [568, 320], [844, 390], [390, 844]]) {
    await a.setViewportSize({ width: w, height: hh });
    await h.wait(250);
    await qdFit(a, `phone ${w}x${hh} picker`);
  }
  await a.setViewportSize({ width: 568, height: 320 }); await h.wait(250);
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-local-picker-568.jpg`);
  await a.setViewportSize({ width: 390, height: 844 }); await h.wait(250);
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-local-picker-390.jpg`);
  await qdPick(a, 'classic', '3');
  await qdGo(a);
  await qdPhase(a, 'steady');
  for (const [w, hh] of [[375, 667], [360, 640], [320, 568], [568, 320], [844, 390]]) {
    await a.setViewportSize({ width: w, height: hh });
    await h.wait(250);
    await qdFit(a, `phone ${w}x${hh} steady`);
    if (w === 568 || w === 320) await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-local-steady-${w}.jpg`);
  }
  await a.setViewportSize({ width: 390, height: 844 });
  const n0 = results(h, 'quickdraw').length;
  // Round 1: both thumbs land in the same instant: a dead heat, shown once, replayed.
  await qdFireAt(a, 'draw', 130, { w: ['a', 'b'] });
  let v = await verdictFor(a, 1);
  assert(v.why === 'tie' && !v.w && v.tally.a + v.tally.b === 0, `same-instant shots tie within 5 ms and the round is replayed (${v.a.reaction} / ${v.b.reaction})`);
  await h.wait(300);
  let t = await qdText(a);
  const heats = await a.evaluate(() => [...document.querySelectorAll('.qd-sig')].map((e) => (e.textContent.match(/dead heat/gi) || []).length));
  assert(t.word === 'Dead heat' && t.line === 'Go again.' && heats.every((x) => x === 1), `a dead heat reads once per player ("${t.word}" / "${t.line}")`);
  // Round 2: a photo finish, a hair apart.
  await qdFireAt(a, 'draw', 140, { w: ['a', 'b'], lag: 7 });
  v = await verdictFor(a, 2);
  assert(v.w === 'a' && v.why === 'time' && v.photo && v.diff < 15, `a photo finish: Emerson by ${v.diff} ms`);
  await h.wait(700);
  t = await qdText(a);
  assert(await a.isVisible('.qd-bars') && /PHOTO FINISH/.test(await a.textContent('.qd-stamp')) && t.line === `Emerson by ${v.diff} ms`, 'photo finish: stamp and a side-by-side timing bar');
  const stamps = await a.evaluate(() => [...document.querySelectorAll('.qd-stamp')].map((e) => { const r = e.getBoundingClientRect(); const m = new DOMMatrix(getComputedStyle(e).transform); return { text: e.textContent, cx: r.left + r.width / 2, cy: r.top + r.height / 2, up: m.a > 0, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, op: +getComputedStyle(e).opacity }; }));
  assert(stamps.length === 2 && stamps.every((x) => x.text === 'PHOTO FINISH' && x.inside && x.op > 0.1) && stamps.filter((x) => x.up).length === 1 && stamps[1].cy < stamps[0].cy - 20, `one phone: the stamp is printed twice, the top copy upside down and above (${stamps.map((x) => `${x.text} ${x.up ? 'upright' : 'flipped'}@${Math.round(x.cy)} in:${x.inside} op:${x.op.toFixed(2)}`).join(' / ')})`);
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-local-photo-390.jpg`);
  // Round 3: Emerson fires 40 ms after DRAW: that's a guess, not a reaction, so it's a foul.
  await qdFireAt(a, 'draw', 40, { w: ['a'] });
  v = await verdictFor(a, 3);
  assert(v.w === 'b' && v.why === 'foul' && v.a.foul && v.a.jump, 'a "reaction" under 100 ms is a false start');
  await h.wait(250);
  t = await qdText(a);
  assert(/JUMPED THE GUN/.test(await a.textContent('.qd-stamp')) && t.line === 'Emerson jumped the gun', `stamped JUMPED THE GUN: "${t.line}"`);
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-local-gun-390.jpg`);
  // 1-1 at match point: Both barrels. Sydney fires on the first draw: foul, Emerson takes the duel.
  await qdCue(a, 'first');
  assert((await qd(a)).rd.both === 1, 'one phone: Both barrels at 1-1');
  await qdFireAt(a, 'steady', 20, { w: ['b'] });
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-local-barrels-390.jpg`);
  v = await verdictFor(a, 4);
  assert(v.w === 'a' && v.why === 'foul' && v.res, 'one phone: the first of the two draws is a trap');
  await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 5000 });
  assert(/Emerson/.test(await endHead(a)), 'one phone: duel to the end (2-1)');
  await h.settle();
  assert(results(h, 'quickdraw').length === n0 + 1, 'one-phone duel recorded');
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-local-end-390.jpg`);
  await h.closeGame(a);
}

// ── Quick Draw: Gunslinger handicap ───────────────────────────────────
/** One phone: fire each half `ms[w]` after ITS OWN signal showed (waits for the cue, then times it in the page). */
function qdFireOwn(pg, ms) {
  return pg.evaluate((ms) => new Promise((resolve) => {
    const root = document.querySelector('.g-qd');
    const down = (w, i) => { const p = root.querySelector(`.qd-pad[data-w="${w}"]`); const r = p.getBoundingClientRect(); p.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 20 + i, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); };
    const pending = new Set(Object.keys(ms));
    const poll = () => {
      const t0 = window.__qdTest.state().t0 || {};
      for (const w of [...pending]) if (t0[w] != null) { pending.delete(w); setTimeout(() => down(w, w === 'a' ? 0 : 1), Math.max(0, ms[w] - (performance.now() - t0[w]))); }
      if (pending.size) requestAnimationFrame(poll); else resolve();
    };
    poll();
  }), ms);
}
/** One phone: the first frame on which any half has its signal: what each half shows, and the paint times. */
const qdSplit = (pg) => pg.evaluate(() => new Promise((resolve) => {
  const word = (sel) => document.querySelector(sel).querySelector('.qd-word').textContent.trim();
  const poll = () => {
    const s = window.__qdTest.state();
    if (s.t0 && Object.keys(s.t0).length) resolve({ t0: s.t0, bottom: word('.qd-sig:not(.qd-top)'), top: word('.qd-sig.qd-top'), lit: document.querySelector('.g-qd').dataset.lit || '' });
    else requestAnimationFrame(poll);
  };
  poll();
}));
async function quickdrawHandicapLocal(h, tag) {
  const { a } = h;
  await h.startLive(a, 'quickdraw', 'local');
  await a.waitForFunction(() => window.__qdTest, null, { timeout: 4000 });
  await a.setViewportSize({ width: 360, height: 640 }); await h.wait(250);
  // the picker: an optional chip, off by default, remembered
  assert(await a.isVisible('.g-qd [data-hcap]') && (await qd(a)).pick.h === false, 'handicap: the picker has a Gunslinger handicap chip, off by default');
  assert((await a.evaluate(() => document.querySelector('.g-qd [data-hcap]').getBoundingClientRect().height)) >= 44, 'handicap chip is >= 44 px tall');
  await qdTap(a, '.g-qd [data-hcap]');
  assert(await a.evaluate(() => document.querySelector('.g-qd [data-hcap]').getAttribute('aria-pressed')) === 'true', 'tapping the chip switches the handicap on');
  // the offset is half the PB gap, at least 20 and at most 60 ms, for the quicker player; under a 40 ms gap there is none
  for (const [pa, pb, want] of [[140, 260, /^Emerson's signal shows 60 ms later$/], [200, 240, /^Emerson's signal shows 20 ms later$/], [200, 239, /evenly matched/], [300, 200, /^Sydney's signal shows 50 ms later$/], [260, 140, /^Sydney's signal shows 60 ms later$/]]) {
    await a.evaluate(([x, y]) => window.__qdTest.pbs(x, y), [pa, pb]);
    const txt = await a.textContent('.g-qd [data-hcap] small');
    assert(want.test(txt), `PBs ${pa}/${pb} ms: the chip says "${txt}"`);
  }
  const exp = { w: 'a', o: 60 };
  for (const [w, hh] of [[375, 667], [360, 640], [320, 568], [568, 320], [844, 390], [390, 844]]) { await a.setViewportSize({ width: w, height: hh }); await h.wait(200); await qdFit(a, `phone ${w}x${hh} picker with the handicap chip`); }
  await a.setViewportSize({ width: 320, height: 568 }); await h.wait(200);
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-hcap-picker-320.jpg`);
  await a.setViewportSize({ width: 360, height: 640 }); await h.wait(200);
  await a.evaluate(() => window.__qdTest.pbs(140, 260));   // (set just before GO: a sync from the shared doc could overwrite it)
  await h.wait(400);
  await qdPick(a, 'classic', '5'); await qdGo(a);
  await qdPhase(a, 'steady');
  let s = await qd(a);
  assert(JSON.stringify(s.cfg.h) === JSON.stringify(exp || 0), `GO takes the handicap from the personal bests: ${JSON.stringify(s.cfg.h)} (expected ${JSON.stringify(exp || 0)})`);
  assert((await qdData(a)).qd_hcap === true, 'the choice is remembered in api.data (qd_hcap)');
  await h.closeGame(a);
  // a handicapped duel: Emerson (the quicker hand) waits 60 ms for his signal
  await h.startLive(a, 'quickdraw', 'local');
  await a.waitForFunction(() => window.__qdTest, null, { timeout: 4000 });
  assert(await a.evaluate(() => document.querySelector('.g-qd [data-hcap]').getAttribute('aria-pressed')) === 'true', 'the handicap choice is preselected next time');
  await a.evaluate(() => window.__qdTest.pbs(999, 999));   // so this duel's raw reactions are the new PBs
  await a.evaluate(() => window.__qdTest.start('classic', '5', null, { w: 'a', o: 150 }  /* far past the real 60 ms cap: the jitter of a busy test machine can't flip the outcome */));
  await qdPhase(a, 'steady');
  s = await qd(a);
  assert(s.cfg.h && s.cfg.h.w === 'a' && s.cfg.h.o === 150 && s.rd.ho.a === 150 && s.rd.ho.b === 0, `one phone: the round carries the offsets ${JSON.stringify(s.rd.ho)}`);
  const tags = await a.evaluate(() => [...document.querySelectorAll('.qd-hc')].map((e) => ({ w: e.dataset.w, txt: e.textContent.trim(), vis: !e.hidden && e.getBoundingClientRect().width > 0 })));
  assert(tags.filter((x) => x.vis).length === 1 && tags.find((x) => x.vis).w === 'a' && tags.find((x) => x.vis).txt === 'handicap +150 ms', `a "handicap +150 ms" tag sits by Emerson's name (${JSON.stringify(tags)})`);
  await qdFit(a, 'phone 360x640 steady with the handicap tag');
  const split = await qdSplit(a);
  assert(split.top === 'DRAW!' && split.bottom !== 'DRAW!' && split.lit === '', `the two halves show DRAW at different moments: Sydney's half has it, Emerson's still says "${split.bottom}"`);
  await h.wait(250);
  s = await qd(a);
  const gapMs = s.t0.a - s.t0.b;
  assert(gapMs >= 125 && gapMs <= 180 && (await qdText(a)).word === 'DRAW!', `Emerson's DRAW follows Sydney's by ${Math.round(gapMs)} ms (handicap 150)`);
  assert((await qd(a)).phase === 'draw', 'one phone: the round is still live');
  // Emerson fires 160 ms after HIS signal, Sydney 230 ms after hers: Emerson was quicker on the raw clock, but the handicap flips it.
  await qdFireOwn(a, { a: 160, b: 230 });
  let v = await verdictFor(a, 1);
  const ra = v.a.reaction; const rb = v.b.reaction;
  assert(v.why === 'time' && v.ho.a === 150 && v.w === (ra + 150 < rb ? 'a' : 'b') && v.diff === Math.round(Math.abs(ra + 150 - rb)) && v.w === 'b', `reactions stay raw (${ra} / ${rb} ms), the verdict adds the handicap: ${v.w} by ${v.diff} ms`);
  await h.wait(250);
  let t = await qdText(a);
  assert(new RegExp(`^Sydney by ${v.diff} ms \\(Emerson's 150 ms handicap counted\\)$`).test(t.line) && /\+150/.test(t.times), `the verdict says so: "${t.line}" / "${t.times}"`);
  let d = await qdData(a);
  assert(d.qd_pb_a_ms === Math.round(ra) && d.qd_pb_b_ms === Math.round(rb), `records keep the raw reaction from the cue each player saw, not the adjusted time (PB ${d.qd_pb_a_ms}/${d.qd_pb_b_ms}, shots ${Math.round(ra)}/${Math.round(rb)})`);
  await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-hcap-verdict-360.jpg`);
  // Round 2: the quicker hand beats the handicap anyway.
  await qdPhase(a, 'steady');
  await qdFireOwn(a, { a: 130, b: 400 });
  v = await verdictFor(a, 2);
  assert(v.w === 'a' && v.why === 'time', `round 2: Emerson wins even with the handicap (${v.a.reaction} / ${v.b.reaction})`);
  await h.wait(250);
  t = await qdText(a);
  assert(new RegExp(`^Emerson by ${v.diff} ms \\(with 150 ms handicap\\)$`).test(t.line), `"${t.line}"`);
  // Round 3: Emerson fires after Sydney's signal but before his own: still Steady for him, so a foul.
  await qdPhase(a, 'steady');
  await a.evaluate(() => new Promise((resolve) => {
    const poll = () => { const s = window.__qdTest.state(); if (s.t0 && s.t0.b != null) { setTimeout(() => { const p = document.querySelector('.qd-pad[data-w="a"]'); const r = p.getBoundingClientRect(); p.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 31, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); resolve(); }, 12); } else requestAnimationFrame(poll); };
    poll();
  }));
  v = await verdictFor(a, 3);
  assert(v.w === 'b' && v.why === 'foul' && v.a.foul, "firing in the handicap gap (Sydney's signal is up, his isn't) is a foul");
  await h.wait(250);
  t = await qdText(a);
  assert(t.line === 'Emerson jumped early', `"${t.line}"`);
  await h.closeGame(a);
  // The other way round, in a different pack: Sydney is quicker, and the bell rings once (at the later cue)
  await h.startLive(a, 'quickdraw', 'local');
  await a.waitForFunction(() => window.__qdTest, null, { timeout: 4000 });
  await a.evaluate(() => { window.__qdTest.force({ kind: 'bell', decoys: [900], dw: [0], delay: 2800 }); window.__qdTest.start('bell', '3', null, { w: 'b', o: 30 }); });
  await qdPhase(a, 'steady');
  const sp = await qdSplit(a);
  assert(sp.bottom === 'DING!' && sp.top !== 'DING!', `handicap +30 for Sydney: Emerson's half rings first, Sydney's still says "${sp.top}"`);
  await qdFireOwn(a, { a: 290, b: 200 });
  v = await verdictFor(a, 1);
  assert(v.why === 'time' && v.ho.b === 30 && v.w === (v.a.reaction < v.b.reaction + 30 ? 'a' : 'b'), `bell pack with a handicap decides on the adjusted times (${v.a.reaction} vs ${v.b.reaction}+30)`);
  await h.closeGame(a);
  // leave the handicap off for every later test
  await h.startLive(a, 'quickdraw', 'local');
  await a.waitForFunction(() => window.__qdTest, null, { timeout: 4000 });
  await qdTap(a, '.g-qd [data-hcap]');
  assert(await a.evaluate(() => document.querySelector('.g-qd [data-hcap]').getAttribute('aria-pressed')) === 'false', 'the chip switches the handicap off again');
  await a.evaluate(() => window.__qdTest.start('classic', '5', null, false));
  assert((await qdData(a)).qd_hcap === false && (await qd(a)).cfg.h === 0, 'off: classic timing, nothing remembered but "off"');
  await h.closeGame(a);
}
async function quickdrawHandicapLive(h, tag) {
  const { a, b } = h;
  await joinLive(h, 'quickdraw');
  // the host's chip reaches the guest, who can't change it
  await qdTap(a, '.g-qd [data-hcap]');
  await b.waitForFunction(() => document.querySelector('.g-qd [data-hcap]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 4000 });
  assert(true, 'live: the guest sees the host switch the handicap on');
  await b.evaluate(() => document.querySelector('.g-qd [data-hcap]').click());   // (it is aria-disabled for the guest)
  await h.wait(300);
  assert(await a.evaluate(() => document.querySelector('.g-qd [data-hcap]').getAttribute('aria-pressed')) === 'true', "the guest's tap on the chip changes nothing (the host decides)");
  await a.evaluate(() => window.__qdTest.pbs(999, 999));   // so the first round's raw reactions become the PBs
  // Emerson is the quicker hand: his signal shows 150 ms late
  await a.evaluate(() => window.__qdTest.start('classic', '5', null, { w: 'a', o: 150 } /* far past the real cap, so test-machine jitter can't flip the outcome */));
  await qdPhase(a, 'steady'); await qdPhase(b, 'steady');
  const [sa, sb] = [await qd(a), await qd(b)];
  assert(JSON.stringify(sa.rd.ho) === '{"a":150,"b":0}' && JSON.stringify(sb.rd.ho) === '{"a":150,"b":0}' && sb.cfg.h && sb.cfg.h.w === 'a', `the host sends the offsets in the round: ${JSON.stringify(sb.rd.ho)}`);
  for (const [pg, who] of [[a, 'Emerson'], [b, 'Sydney']]) {
    const tag2 = await pg.evaluate(() => [...document.querySelectorAll('.qd-hc')].filter((e) => !e.hidden && e.getBoundingClientRect().width > 0).map((e) => `${e.dataset.w}:${e.textContent.trim()}`));
    assert(tag2.length === 1 && tag2[0] === 'a:handicap +150 ms', `${who}'s screen: "handicap +150 ms" by Emerson's name (${tag2})`);
  }
  await qdFit(b, 'live guest with the handicap tag'); await qdFit(a, 'live host with the handicap tag');
  // each device shows its own player's cue at shared (at + delay + own offset)
  const shared = (pg) => qdCue(pg, 'real').then(() => pg.evaluate(() => { const s = window.__qdTest.state(); const me = document.querySelector('.qd-pad').dataset.w; return { t: s.t0[me] + (s.now - performance.now()), want: s.rd.at + s.rd.delay + (s.rd.ho[me] | 0), me }; }));
  const firing = Promise.all([qdFireOwnLive(a, 160), qdFireOwnLive(b, 230)]);   // armed now: each fires N ms after its own DRAW shows
  const cues = await Promise.all([shared(a), shared(b)]);
  for (const c of cues) assert(Math.abs(c.t - c.want) < 45, `${c.me === 'a' ? 'Emerson' : 'Sydney'}'s DRAW shows ${Math.round(c.t - c.want)} ms from its planned shared time (own cue, offset ${c.me === 'a' ? 150 : 0})`);
  // Emerson fires 160 ms after HIS cue (150 ms late: 310 ms after the nominal DRAW), Sydney 230 ms after hers. Emerson was quicker raw; Sydney fired first.
  await firing;
  let v = await verdictFor(a, 1); await verdictFor(b, 1);
  assert(v.why === 'time' && v.ho.a === 150 && v.w === (v.a.reaction + 150 < v.b.reaction ? 'a' : 'b') && v.w === 'b' && v.a.reaction < v.b.reaction, `live verdict on the adjusted times (${v.a.reaction} + 150 vs ${v.b.reaction}): ${v.w} by ${v.diff} ms, though Emerson's raw time was quicker`);
  await h.wait(300);
  for (const [pg, who] of [[a, 'Emerson'], [b, 'Sydney']]) {
    const t = await qdText(pg);
    assert(t.line === `Sydney by ${v.diff} ms (Emerson's 150 ms handicap counted)` && /\+150/.test(t.times), `${who}'s screen: "${t.line}" / "${t.times}"`);
  }
  const d = await qdData(a);
  assert(d.qd_pb_a_ms === Math.round(v.a.reaction) && d.qd_pb_b_ms === Math.round(v.b.reaction), `PBs keep each raw reaction (${d.qd_pb_a_ms}/${d.qd_pb_b_ms} vs shots ${Math.round(v.a.reaction)}/${Math.round(v.b.reaction)})`);
  // Emerson fires 20 ms after the nominal DRAW, before his own (late) cue: a foul, so Sydney takes the round
  await qdPhase(a, 'steady'); await qdPhase(b, 'steady');
  await a.evaluate(() => { const s = window.__qdTest.state(); const wait = s.rd.at + s.rd.delay + 20 - s.now; setTimeout(() => { const p = document.querySelector('.qd-pad'); const r = p.getBoundingClientRect(); p.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); }, wait); });
  v = await verdictFor(a, 2); await verdictFor(b, 2);
  assert(v.w === 'b' && v.why === 'foul' && v.a.foul && v.a.rel > 0, `Emerson's early shot (rel ${v.a.rel} ms) before his late cue is a foul`);
  await h.wait(300);
  assert((await qdText(b)).line === 'Emerson jumped early', 'and Sydney sees it: "Emerson jumped early"');
  await h.closeGame(a); await h.closeGame(b);
  // switch it off again for later tests (the host's data is shared with every mount on this device)
  await h.startLive(a, 'quickdraw', 'local');
  await a.waitForFunction(() => window.__qdTest, null, { timeout: 4000 });
  await a.evaluate(() => window.__qdTest.start('classic', '3', null, false));
  assert((await qdData(a)).qd_hcap === false, 'live: handicap off again');
  await h.closeGame(a);
}
/** Live: fire `ms` after this device's own DRAW shows. */
const qdFireOwnLive = (pg, ms) => pg.evaluate((ms) => new Promise((resolve) => {
  const poll = () => {
    const s = window.__qdTest.state(); const me = document.querySelector('.qd-pad').dataset.w;
    if (s.t0 && s.t0[me] != null) { setTimeout(() => { const p = document.querySelector('.qd-pad'); const r = p.getBoundingClientRect(); p.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); }, Math.max(0, ms - (performance.now() - s.t0[me]))); resolve(); } else requestAnimationFrame(poll);
  };
  poll();
}), ms);

/** The smallest phones: the scene keeps a readable size, and the scene signs and stamps stay off the art. */
async function quickdrawSmallPhone(h, tag) {
  const { a } = h;
  await h.startLive(a, 'quickdraw', 'local');
  await a.waitForFunction(() => window.__qdTest, null, { timeout: 4000 });
  let first = true;
  for (const [w, hh, minScene] of [[320, 568, 110], [360, 640, 150]]) {
    if (!first) { await h.closeGame(a); await h.startLive(a, 'quickdraw', 'local'); await a.waitForFunction(() => window.__qdTest, null, { timeout: 4000 }); }
    first = false;
    await a.setViewportSize({ width: w, height: hh }); await h.wait(250);
    await a.evaluate(() => window.__qdTest.start('mixed', '5', { a: 2, b: 2 }));   // a Both barrels round: the signs are up
    await qdPhase(a, 'steady'); await h.wait(700);
    const m = await a.evaluate(() => {
      const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
      return { scene: box(document.querySelector('.qd-scene')), art: [...document.querySelectorAll('.qd-fig, .qd-cactus')].map(box), signs: [...document.querySelectorAll('.qd-kind')].filter((e) => !e.hidden).map((e) => ({ ...box(e), txt: e.textContent })) };
    });
    const hit = (p, q) => p.l < q.r && p.r > q.l && p.t < q.b && p.b > q.t;
    assert(m.scene.h >= minScene, `${w}x${hh}: the scene stays ${Math.round(m.scene.h)} px tall during Steady (>= ${minScene})`);
    assert(m.signs.length === 2 && m.signs.every((x) => x.l >= m.scene.l && x.r <= m.scene.r && x.t >= m.scene.t && x.b <= m.scene.b && !m.art.some((q) => hit(x, q))), `${w}x${hh}: both copies of the scene sign sit in the sky, clear of the art (${m.signs.map((x) => x.txt).join(' / ')})`);
    await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-small-sign-${w}.jpg`);
    await qdFireAt(a, 'draw', 130, { w: ['a', 'b'], lag: 9 });
    const v = await verdictFor(a, 1);
    await h.wait(350);
    const st = await a.evaluate(() => {
      const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, op: +getComputedStyle(e).opacity, txt: e.textContent }; };
      return { scene: box(document.querySelector('.qd-scene')), stamps: [...document.querySelectorAll('.qd-stamp')].map(box), pads: [...document.querySelectorAll('.qd-pad')].map(box), vw: innerWidth, vh: innerHeight };
    });
    assert(st.stamps.length === 2 && st.stamps.every((x) => x.op > 0.1 && x.l >= 0 && x.r <= st.vw && x.t >= 0 && x.b <= st.vh && !hit(x, st.scene)), `${w}x${hh}: both stamps (${st.stamps[0].txt}) are on screen and off the scene art (${v.diff} ms)`);
    await qdQuickShot(h, a, `${SHOTS}/qd-${tag}-small-stamp-${w}.jpg`);
  }
  await h.closeGame(a);
}

// ── 5. One laptop, keyboard ───────────────────────────────────────────
async function laptop(h, pg) {
  await pg.setViewportSize({ width: 1280, height: 800 });
  assert(!(await pg.evaluate(() => matchMedia('(pointer: coarse)').matches)), 'laptop: fine pointer, no touch');
}
async function hockeyKeys(h, pg, tag) {
  await h.startLive(pg, 'hockey', 'local');
  await hkStart(pg, 'classic');
  const s0 = await hk(pg);
  assert(s0.view === 'side' && !s0.coarse, 'laptop: table turned sideways, Emerson on the left (W A S D), Sydney on the right (arrows)');
  await h.shot(pg, `${SHOTS}/hockey-${tag}-keys-start.png`);
  // Hold D (toward the centre) and Left arrow (toward the centre) together.
  const track = [];
  await pg.keyboard.down('KeyD'); await pg.keyboard.down('ArrowLeft');
  for (let i = 0; i < 4; i++) { await h.wait(40); track.push((await hk(pg)).mallets); }
  await pg.keyboard.up('KeyD'); await pg.keyboard.up('ArrowLeft');
  const ya = track.map((m) => m.a.y); const yb = track.map((m) => m.b.y);
  assert(ya[ya.length - 1] < s0.mallets.a.y - 8 && yb[yb.length - 1] > s0.mallets.b.y + 8, `both players move at once (a ${s0.mallets.a.y.toFixed(0)}→${ya[ya.length - 1].toFixed(0)}, b ${s0.mallets.b.y.toFixed(0)}→${yb[yb.length - 1].toFixed(0)})`);
  // Speed profile of one press (sampled every frame in the page): ramps up, then eases to a stop.
  await pg.keyboard.down('KeyA'); await h.wait(500); await pg.keyboard.up('KeyA'); await h.wait(400); // back toward his goal
  const prof = await pg.evaluate(() => new Promise((resolve) => {
    const out = []; const t0 = performance.now();
    const key = (type) => window.dispatchEvent(new KeyboardEvent(type, { code: 'KeyD', key: 'd', bubbles: true }));
    key('keydown');
    setTimeout(() => key('keyup'), 220);
    const tick = () => {
      const t = performance.now() - t0;
      out.push([t, window.__hockeyTest.state().mallets.a.y]);
      if (t < 520) requestAnimationFrame(tick); else resolve(out);
    };
    tick();
  }));
  // Average speeds over fixed windows (single frames are too jittery in a headless browser).
  const yAt = (t) => { const i = prof.findIndex(([tt]) => tt >= t); if (i <= 0) return prof[Math.max(0, i)][1]; const [t0, y0] = prof[i - 1]; const [t1, y1] = prof[i]; return y0 + ((y1 - y0) * (t - t0)) / Math.max(1, t1 - t0); };
  const speed = (t0, t1) => (yAt(t0) - yAt(t1)) / ((t1 - t0) / 1000);
  const start = speed(0, 50); const top = speed(140, 220); const coastV = speed(260, 340); const end = speed(440, 520);
  assert(top > 90 && start < top * 0.7, `keyboard mallet accelerates smoothly (first 50 ms ${Math.round(start)} u/s, then ${Math.round(top)} u/s)`);
  assert(coastV > 1 && coastV < top * 0.7 && end < top * 0.15, `and eases to a stop after the key is released (${Math.round(coastV)} then ${Math.round(end)} u/s)`);
  // W moves Emerson's mallet up the screen (toward the near rail of a sideways table).
  const x0 = (await hk(pg)).mallets.a.x;
  await pg.keyboard.down('KeyW'); await h.wait(300); await pg.keyboard.up('KeyW');
  assert((await hk(pg)).mallets.a.x < x0 - 5, 'W moves up the screen');
  await h.wait(200);
  await h.shot(pg, `${SHOTS}/hockey-${tag}-keys-mid.png`);
  for (let i = 0; i < 7; i++) { await pg.evaluate(() => window.__hockeyTest.score('a')); await h.wait(30); }
  await pg.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 4000 });
  assert(/Emerson/.test(await endHead(pg)), 'laptop hockey to the end');
  await h.shot(pg, `${SHOTS}/hockey-${tag}-keys-end.png`);
  await h.closeGame(pg);
}
async function quickdrawKeys(h, pg, tag) {
  await h.startLive(pg, 'quickdraw', 'local');
  await pg.waitForFunction(() => window.__qdTest, null, { timeout: 4000 });
  assert((await qd(pg)).layout === 'desk', 'laptop: side-by-side pads, A key and L key');
  for (const [w, hh] of [[1280, 600], [800, 500], [1280, 800]]) {
    await pg.setViewportSize({ width: w, height: hh });
    await h.wait(250);
    await qdFit(pg, `laptop ${w}x${hh} picker`);
  }
  await qdQuickShot(h, pg, `${SHOTS}/qd-${tag}-keys-picker.jpg`);
  await qdGo(pg);
  await qdPhase(pg, 'steady');
  assert(/A/.test(await pg.textContent('.qd-pad[data-w="a"] kbd')) && /L/.test(await pg.textContent('.qd-pad[data-w="b"] kbd')), 'keys are shown on each side');
  for (const [w, hh] of [[1280, 600], [800, 500]]) {
    await pg.setViewportSize({ width: w, height: hh });
    await h.wait(250);
    await qdFit(pg, `laptop ${w}x${hh} in play`);
  }
  await pg.setViewportSize({ width: 1280, height: 800 });
  // Round 1: nobody fires.
  await qdPhase(pg, 'draw');
  let v = await verdictFor(pg, 1);
  await h.wait(300);
  const t = await qdText(pg);
  assert(v.why === 'none' && t.word === 'Nobody fired', `nobody fired: "${t.word}" (not "too slow")`);
  // A real key press during Steady is a foul.
  await pg.waitForFunction(() => document.querySelector('.g-qd').dataset.phase === 'steady', null, { timeout: 5000 });
  await h.wait(100);
  await pg.keyboard.press('l');
  v = await verdictFor(pg, 2);
  assert(v.w === 'a' && v.why === 'foul', 'L pressed too early: Sydney fouls');
  const shot = pg.waitForFunction(() => document.querySelector('.g-qd').dataset.phase === 'draw', null, { timeout: 9000 }).then(() => qdQuickShot(h, pg, `${SHOTS}/qd-${tag}-keys-draw.jpg`));
  await Promise.all([qdFireAt(pg, 'draw', 260, { key: 'a' }), qdFireAt(pg, 'draw', 130, { key: 'l' }), shot]);
  v = await verdictFor(pg, 3);
  assert(v.w === 'b' && v.b.reaction < v.a.reaction, `L key faster than A key: Sydney (${v.b.reaction} vs ${v.a.reaction} ms)`);
  await h.wait(500);
  await qdQuickShot(h, pg, `${SHOTS}/qd-${tag}-keys-result.jpg`);
  for (const r of [4, 5]) {
    await Promise.all([qdFireAt(pg, 'draw', 130, { key: 'a' }), qdFireAt(pg, 'draw', 290, { key: 'l' })]);
    v = await verdictFor(pg, r);
    assert(v.w === 'a', `round ${r}: A key wins`);
  }
  await pg.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 5000 });
  assert(/Emerson/.test(await endHead(pg)), 'laptop duel to the end (3-1)');
  await qdQuickShot(h, pg, `${SHOTS}/qd-${tag}-keys-end.jpg`);
  await h.closeGame(pg);
}

// ── run ───────────────────────────────────────────────────────────────
async function run(port, colorScheme, body, opts = {}) {
  const h = await launch({ port, only: ['hockey', 'quickdraw'], colorScheme, ...opts });
  try {
    if (!opts.fine) await sizes(h);
    await body(h);
    h.assertNoErrors();
    console.log(`ok - no page errors (${colorScheme})`);
  } catch (e) {
    fails++;
    console.error(e.message);
    await h.shot(h.a, `${SHOTS}/fail-${colorScheme}-a.png`).catch(() => {});
    await h.shot(h.b, `${SHOTS}/fail-${colorScheme}-b.png`).catch(() => {});
    console.error('errors:', h.errors);
  } finally {
    await h.close();
  }
}

// GAME=hockey or GAME=quickdraw runs only that game's suites (default: both).
const GAME = process.env.GAME || 'all';
const want = (g) => GAME === 'all' || GAME === g;
(async () => {
  await run(PORT, 'light', async (h) => {
    if (want('hockey')) {
      await hockeyPicker(h);
      await hockeyLive(h, 'light');
      await hockeyRematchAndLeave(h);
      await hockeyLocalTouch(h);
      await hockeyPower(h);
      await hockeyStall(h);
      await hockeyOverlays(h);
      await hockeyDrama(h);
      await hockeyTables(h, 'light', ['pillar', 'twin', 'shrink', 'power', 'quick']);
    }
    if (want('quickdraw')) {
      await quickdrawLive(h, 'light');
      await quickdrawLocal(h, 'light');
      await quickdrawSmallPhone(h, 'light');
      await quickdrawHandicapLocal(h, 'light');
      await quickdrawHandicapLive(h, 'light');
    }
  }, { coarse: true });
  await run(PORT + 1, 'dark', async (h) => {
    if (want('hockey')) {
      await hockeyLive(h, 'dark', true);
      await h.closeGame(h.a); await h.closeGame(h.b);
      await hockeyTables(h, 'dark', ['pillar', 'shrink', 'power']);
      await hockeyLiveTables(h, ['pillar', 'twin', 'shrink', 'power', 'quick'], 'latency 40');
    }
    if (want('quickdraw')) {
      await quickdrawPacks(h, 'dark');
      await quickdrawStreaks(h, 'dark');
      await quickdrawLocal(h, 'dark');
      await quickdrawSmallPhone(h, 'dark');
      await quickdrawSudden(h, 'dark');
    }
  }, { coarse: true });
  await run(PORT + 2, 'dark', async (h) => {
    await laptop(h, h.a);
    if (want('hockey')) { await hockeyKeys(h, h.a, 'dark'); await hockeyDesk(h, h.a); }
    if (want('quickdraw')) await quickdrawKeys(h, h.a, 'dark');
  }, { fine: true, device: 'Desktop Chrome', who: ['a'] });
  if (want('quickdraw')) await run(PORT + 3, 'light', quickdrawLatency, { coarse: true, latency: 200 });
  if (want('quickdraw')) {
    await run(PORT + 5, 'dark', async (h) => { await quickdrawLeave(h, 'dark'); await quickdrawRematch(h, 'dark'); }, { coarse: true });
  }
  if (want('quickdraw')) await run(PORT + 4, 'light', quickdrawLossy, { coarse: true, latency: 120, dropRate: 0.2 });
  if (want('hockey')) {
    await run(PORT + 4, 'light', async (h) => {
      await hockeyLag(h);
      await hockeyGuestMallet(h);
      await hockeyLiveTables(h, ['twin', 'shrink'], 'latency 120, 20 % loss');
    }, { coarse: true, latency: 120, dropRate: 0.2 });
  }
  console.log(fails ? `\n${fails} SUITE(S) FAILED` : '\nALL GOOD');
  process.exitCode = fails ? 1 : 0;
})();
