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
/** Quick Draw: when `phase` shows on this page, wait `delay` ms and fire (precisely, in page). */
function qdFireAt(pg, phase, delay, { key = null, w = null } = {}) {
  return pg.evaluate(({ phase, delay, key, w }) => new Promise((resolve) => {
    const root = document.querySelector('.g-qd');
    const go = () => setTimeout(() => {
      if (key) window.dispatchEvent(new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, bubbles: true }));
      else {
        const pads = w ? w.map((x) => root.querySelector(`.qd-pad[data-w="${x}"]`)) : [root.querySelector('.qd-pad')];
        const evs = pads.map((p, i) => { const r = p.getBoundingClientRect(); return [p, new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7 + i, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })]; });
        for (const [p, ev] of evs) p.dispatchEvent(ev);
      }
      resolve(performance.now());
    }, delay);
    if (root.dataset.phase === phase) go();
    else {
      const mo = new MutationObserver(() => { if (root.dataset.phase === phase) { mo.disconnect(); go(); } });
      mo.observe(root, { attributes: true, attributeFilter: ['data-phase'] });
    }
  }), { phase, delay, key, w });
}
const verdictFor = (pg, r) => pg.waitForFunction((r) => { const s = window.__qdTest && window.__qdTest.state(); return s && s.verdict && s.verdict.r >= r ? s.verdict : null; }, r, { timeout: 15000 }).then((x) => x.jsonValue());
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
async function sizes(h) {
  await h.a.setViewportSize({ width: 390, height: 844 });
  await h.b.setViewportSize({ width: 360, height: 780 });
}

// ── 1. Air Hockey, two phones ─────────────────────────────────────────
async function hockeyLive(h, tag, quick = false) {
  const { a, b } = h;
  await joinLive(h, 'hockey');
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
    await a.evaluate(() => window.__hockeyTest.place(50, 56, 0, 0));
    await h.settle();
    const hb0 = (await hk(a)).hits.b;
    await drag(b, 3, 50, 22, 50, 77, 6, 16);
    await a.waitForFunction((n) => window.__hockeyTest.state().hits.b > n, hb0, { timeout: 3000 });
    assert(true, 'the host registered the guest mallet hitting the puck');
    const after = await hk(a);
    assert(after.puck.vy > 30 || after.score.b === 1, `the guest's hit sent the puck toward Emerson's goal (vy ${after.puck.vy.toFixed(0)})`);
    await a.waitForFunction(() => window.__hockeyTest.state().score.b === 1, null, { timeout: 4000 });
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
  await h.closeGame(a); await h.closeGame(b);
  assert(await a.evaluate(() => !window.__hockeyTest) && await b.evaluate(() => !window.__hockeyTest), 'destroy() removed the test hooks');
  await quietAfterClose(h, a, 'hockey host');
  await quietAfterClose(h, b, 'hockey guest');
}

// ── 2. Air Hockey, one phone, two fingers ─────────────────────────────
async function hockeyLocalTouch(h) {
  const { a } = h;
  await h.startLive(a, 'hockey', 'local');
  await a.waitForFunction(() => window.__hockeyTest, null, { timeout: 4000 });
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
  await h.shot(a, `${SHOTS}/hockey-light-local-mid-390.png`);
  const n0 = results(h, 'hockey').length;
  for (let i = 0; i < 7; i++) { await a.evaluate(() => window.__hockeyTest.score('b')); await h.wait(30); }
  await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 4000 });
  assert(/Sydney/.test(await endHead(a)), 'one phone: game to the end, Sydney wins');
  await h.settle();
  assert(results(h, 'hockey').length === n0 + 1, 'one-phone result recorded');
  await h.closeGame(a);
}

// ── 3. Quick Draw, two phones ─────────────────────────────────────────
async function quickdrawLive(h, tag) {
  const { a, b } = h;
  await joinLive(h, 'quickdraw');
  const n0 = results(h, 'quickdraw').length;
  // Round 1: Emerson jumps the gun.
  await Promise.all([qdFireAt(a, 'steady', 150)]);
  let v = await verdictFor(a, 1);
  const vb = await verdictFor(b, 1);
  assert(v.w === 'b' && v.why === 'foul' && vb.w === 'b', 'foul: firing before DRAW loses the round (both phones agree)');
  assert(/fired early/.test(await b.textContent('.qd-sig .qd-line')), 'the guest is told who fired early');

  // Round 2: Sydney's network is slow (+150 ms each way out) but her hand is faster.
  const slowed = await b.evaluate(() => {
    const o = window.__room; window.__roomFast = o;
    try { window.__room = (op, ...r) => (op === 'emit' || op === 'presence' ? new Promise((res) => setTimeout(res, 150)).then(() => o(op, ...r)) : o(op, ...r)); } catch { return false; }
    return window.__room !== o;
  });
  await b.waitForFunction(() => document.querySelector('.g-qd').dataset.phase === 'steady', null, { timeout: 9000 });
  await h.shot(b, `${SHOTS}/qd-${tag}-live-steady-360-b.png`);
  await Promise.all([qdFireAt(a, 'draw', 230), qdFireAt(b, 'draw', 140)]);
  v = await verdictFor(a, 2);
  const recv = (await a.evaluate(() => window.__qdTest.recv())).filter((x) => x.r === v.r);
  assert(slowed && recv.length === 2 && recv[0].w === 'a', `Emerson's result reached the referee first (${recv.map((x) => x.w).join(' then ')})`);
  assert(v.w === 'b' && v.b.reaction < v.a.reaction, `...but Sydney wins on reaction time (${v.b.reaction} ms vs ${v.a.reaction} ms)`);
  const timesA = await a.textContent('.qd-sig .qd-times');
  assert(/^Sydney \d+ ms·Emerson \d+ ms$/.test(timesA.replace(/\s*·\s*/, '·').trim()), `both reaction times shown: "${timesA.trim()}"`);
  await b.evaluate(() => { window.__room = window.__roomFast; });
  await h.wait(300);
  await h.shot(a, `${SHOTS}/qd-${tag}-live-result-390-a.png`);

  // Round 3: both jump; Sydney jumped earlier (relative to her own DRAW), so she loses it.
  await Promise.all([qdFireAt(a, 'steady', 160), qdFireAt(b, 'steady', 40)]);
  v = await verdictFor(a, 3);
  assert(v.why === 'fouls' && v.w === 'a', 'double foul: whoever jumped earlier loses');
  // Rounds 4 and 5: Emerson is faster.
  for (const r of [4, 5]) {
    const shot = r === 4 ? b.waitForFunction(() => document.querySelector('.g-qd').dataset.phase === 'draw', null, { timeout: 9000 }).then(() => h.shot(b, `${SHOTS}/qd-${tag}-live-draw-360-b.png`)) : null;
    await Promise.all([qdFireAt(a, 'draw', 110), qdFireAt(b, 'draw', 300), shot]);
    v = await verdictFor(a, r);
    assert(v.w === 'a', `round ${r}: faster hand wins (${v.a.reaction} vs ${v.b.reaction} ms)`);
  }
  assert(v.tally.a === 3 && v.tally.b === 2, 'best of 5 decided 3-2');
  await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 5000 });
  await b.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 5000 });
  assert(/Emerson/.test(await endHead(a)) && /Emerson/.test(await endHead(b)), 'end card on both phones: Emerson wins');
  await h.settle();
  assert(results(h, 'quickdraw').length === n0 + 1, 'the duel is recorded once');
  await h.shot(a, `${SHOTS}/qd-${tag}-live-end-390-a.png`);
  await h.shot(b, `${SHOTS}/qd-${tag}-live-end-360-b.png`);
  // Rematch from the host restarts both; then close and check nothing lingers.
  await a.click('#game-root [data-g="rematch"]');
  await h.settle();
  assert(!(await endShown(a)) && !(await endShown(b)), 'rematch restarts on both');
  await b.waitForFunction(() => document.querySelector('.g-qd')?.dataset.phase === 'steady', null, { timeout: 6000 });
  const [qa, qb] = [await qd(a), await qd(b)];
  assert(qa.tally.a + qa.tally.b === 0 && qb.tally.a + qb.tally.b === 0, 'rematch: fresh tally, first round under way on both');
  await h.closeGame(a); await h.closeGame(b);
  await quietAfterClose(h, a, 'quick draw host');
  await quietAfterClose(h, b, 'quick draw guest');
}

// Quick Draw dark pass: a quick duel decided by fouls, for screenshots.
async function quickdrawLiveFast(h, tag) {
  const { a, b } = h;
  await joinLive(h, 'quickdraw');
  // Sydney drops out mid-round: the round is voided and the host waits. She rejoins: a fresh round.
  await a.waitForFunction(() => document.querySelector('.g-qd')?.dataset.phase === 'steady', null, { timeout: 6000 });
  await h.closeGame(b);
  await a.waitForFunction(() => window.__qdTest.state().phase === 'paused', null, { timeout: 4000 });
  await h.wait(5000);
  assert((await qd(a)).phase === 'paused' && !(await qd(a)).verdict, 'partner gone: the round is voided and the duel waits (no verdict, no stray DRAW)');
  await a.click('#game-root [data-g="invite-again"]');
  await h.settle();
  await b.click('#gm-invite [data-g="invite-yes"]');
  await b.waitForFunction(() => document.querySelector('.g-qd')?.dataset.phase === 'draw' || document.querySelector('.g-qd')?.dataset.phase === 'steady', null, { timeout: 6000 });
  const shot = b.waitForFunction(() => document.querySelector('.g-qd').dataset.phase === 'draw', null, { timeout: 9000 }).then(() => h.shot(b, `${SHOTS}/qd-${tag}-live-draw-360-b.png`));
  await Promise.all([qdFireAt(a, 'draw', 120), qdFireAt(b, 'draw', 260), shot]);
  await verdictFor(a, 1);
  await h.wait(400);
  await h.shot(a, `${SHOTS}/qd-${tag}-live-result-390-a.png`);
  for (const r of [2, 3]) { await qdFireAt(b, 'steady', 100); await verdictFor(a, r); }
  await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 5000 });
  await b.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 5000 });
  assert(/Emerson/.test(await endHead(b)), `${tag}: duel over, end card on both`);
  await h.shot(a, `${SHOTS}/qd-${tag}-live-end-390-a.png`);
  await h.shot(b, `${SHOTS}/qd-${tag}-live-end-360-b.png`);
  await h.closeGame(a); await h.closeGame(b);
}

// ── 4. Quick Draw, one phone ──────────────────────────────────────────
async function quickdrawLocal(h, tag) {
  const { a } = h;
  await h.startLive(a, 'quickdraw', 'local');
  await a.waitForFunction(() => window.__qdTest, null, { timeout: 4000 });
  assert((await qd(a)).layout === 'phone', 'one phone: a button at each end');
  const n0 = results(h, 'quickdraw').length;
  // Both thumbs land in the same instant: a dead heat, replayed.
  await qdFireAt(a, 'draw', 120, { w: ['a', 'b'] });
  let v = await verdictFor(a, 1);
  assert(v.why === 'tie' && !v.w && v.tally.a + v.tally.b === 0, `same-instant shots tie within 5 ms and the round is replayed (${v.a.reaction} / ${v.b.reaction})`);
  await qdFireAt(a, 'steady', 120, { w: ['b'] });
  v = await verdictFor(a, 2);
  assert(v.w === 'a' && v.why === 'foul', 'one phone: the top player fouls, the bottom player takes it');
  await h.shot(a, `${SHOTS}/qd-${tag}-local-result-390.png`);
  const plan = [['a', 120, 'b', 260], ['b', 100, 'a', 240], ['a', 90, 'b', 200]];
  let r = 3;
  for (const [w1, d1, w2, d2] of plan) {
    await Promise.all([qdFireAt(a, 'draw', d1, { w: [w1] }), qdFireAt(a, 'draw', d2, { w: [w2] })]);
    v = await verdictFor(a, r++);
    assert(v.w === w1, `one phone: ${w1 === 'a' ? 'bottom' : 'top'} player is faster and wins (${v[w1].reaction} vs ${v[w2].reaction} ms)`);
  }
  await a.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 5000 });
  assert(/Emerson/.test(await endHead(a)), 'one phone: duel to the end (3-1)');
  await h.settle();
  assert(results(h, 'quickdraw').length === n0 + 1, 'one-phone duel recorded');
  await h.shot(a, `${SHOTS}/qd-${tag}-local-end-390.png`);
  await h.closeGame(a);
}

// ── 5. One laptop, keyboard ───────────────────────────────────────────
async function laptop(h, pg) {
  await pg.setViewportSize({ width: 1280, height: 800 });
  assert(!(await pg.evaluate(() => matchMedia('(pointer: coarse)').matches)), 'laptop: fine pointer, no touch');
}
async function hockeyKeys(h, pg, tag) {
  await h.startLive(pg, 'hockey', 'local');
  await pg.waitForFunction(() => window.__hockeyTest, null, { timeout: 4000 });
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
  assert(/A/.test(await pg.textContent('.qd-pad[data-w="a"] kbd')) && /L/.test(await pg.textContent('.qd-pad[data-w="b"] kbd')), 'keys are shown on each side');
  // A real key press during Steady is a foul.
  await pg.waitForFunction(() => document.querySelector('.g-qd').dataset.phase === 'steady', null, { timeout: 5000 });
  await h.wait(100);
  await pg.keyboard.press('l');
  let v = await verdictFor(pg, 1);
  assert(v.w === 'a' && v.why === 'foul', 'L pressed too early: Sydney fouls');
  const shot = pg.waitForFunction(() => document.querySelector('.g-qd').dataset.phase === 'draw', null, { timeout: 9000 }).then(() => h.shot(pg, `${SHOTS}/qd-${tag}-keys-draw.png`));
  await Promise.all([qdFireAt(pg, 'draw', 260, { key: 'a' }), qdFireAt(pg, 'draw', 120, { key: 'l' }), shot]);
  v = await verdictFor(pg, 2);
  assert(v.w === 'b' && v.b.reaction < v.a.reaction, `L key faster than A key: Sydney (${v.b.reaction} vs ${v.a.reaction} ms)`);
  await h.wait(300);
  await h.shot(pg, `${SHOTS}/qd-${tag}-keys-result.png`);
  for (const r of [3, 4]) {
    await Promise.all([qdFireAt(pg, 'draw', 100, { key: 'a' }), qdFireAt(pg, 'draw', 280, { key: 'l' })]);
    v = await verdictFor(pg, r);
    assert(v.w === 'a', `round ${r}: A key wins`);
  }
  await pg.waitForFunction(() => document.querySelector('#game-root .gm-end:not([hidden])'), null, { timeout: 5000 });
  assert(/Emerson/.test(await endHead(pg)), 'laptop duel to the end (3-1)');
  await h.shot(pg, `${SHOTS}/qd-${tag}-keys-end.png`);
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

(async () => {
  await run(PORT, 'light', async (h) => {
    await hockeyLive(h, 'light');
    await hockeyRematchAndLeave(h);
    await hockeyLocalTouch(h);
    await quickdrawLive(h, 'light');
    await quickdrawLocal(h, 'light');
  }, { coarse: true });
  await run(PORT + 1, 'dark', async (h) => {
    await hockeyLive(h, 'dark', true);
    await h.closeGame(h.a); await h.closeGame(h.b);
    await quickdrawLiveFast(h, 'dark');
    await quickdrawLocal(h, 'dark');
  }, { coarse: true });
  await run(PORT + 2, 'dark', async (h) => {
    await laptop(h, h.a);
    await hockeyKeys(h, h.a, 'dark');
    await quickdrawKeys(h, h.a, 'dark');
  }, { fine: true, device: 'Desktop Chrome', who: ['a'] });
  console.log(fails ? `\n${fails} SUITE(S) FAILED` : '\nALL GOOD');
  process.exitCode = fails ? 1 : 0;
})();
