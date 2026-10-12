// Tower Together: old-log replay safety, setup move + modes, bug fixes, records and the end panel.
//   PORT=8924 SHOTS=/some/dir node tools/test/games/threed-tower.test.js     (uses PORT and PORT+1)
const path = require('path');
const os = require('os');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { launch, ROOT } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'just-us-shots', 'threed-tower');
const PORT = Number(process.env.PORT) || 8920;
fs.mkdirSync(SHOTS, { recursive: true });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const other = (w) => (w === 'a' ? 'b' : 'a');
const clone = (x) => JSON.parse(JSON.stringify(x));
const throws = (fn, re) => { try { fn(); } catch (e) { return re ? re.test(e.message) : true; } return false; };
const shot = (pg, name) => pg.screenshot({ path: path.join(SHOTS, name), scale: 'css' });

// ── the ORIGINAL rules (copied from js/games/tower.js before modes existed) ──
const REF = (() => {
  const BASE = 3; const TOL = 0.1; const GROW = 0.2; const STREAK = 3; const MAX_O = 50;
  const o_ = (w) => (w === 'a' ? 'b' : 'a');
  const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
  const r4 = (v) => Math.round(v * 10000) / 10000 + 0;
  const axisOf = (level) => (level % 2 ? 'x' : 'z');
  const perfectTol = (size) => Math.min(TOL, size * 0.2);
  const init = ({ first }) => ({ turn: first === 'b' ? 'b' : 'a', blocks: [{ x: 0, z: 0, w: BASE, d: BASE, who: null }], streak: 0, perfects: { a: 0, b: 0 }, over: false, drop: null });
  function apply(s, who, mv) {
    if (s.over) throw new Error('The tower already toppled.');
    if (who !== s.turn) throw new Error('Hold on, it’s not your turn.');
    const raw = mv ? mv.o : undefined;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || Math.abs(raw) > MAX_O) throw new Error('That drop didn’t register. Try again.');
    const o = r3(raw);
    const level = s.blocks.length;
    const axis = axisOf(level);
    const prev = s.blocks[level - 1];
    const size = axis === 'x' ? prev.w : prev.d;
    const at = axis === 'x' ? prev.x : prev.z;
    const drop = { who, o, axis, level, miss: false, perfect: false, grew: false, streak: 0, cut: null };
    s.drop = drop;
    s.turn = o_(who);
    if (Math.abs(o) >= size) { drop.miss = true; s.streak = 0; s.over = true; return s; }
    const nb = { x: prev.x, z: prev.z, w: prev.w, d: prev.d, who };
    if (Math.abs(o) <= perfectTol(size)) {
      drop.perfect = true; nb.p = 1; s.streak += 1; s.perfects[who] += 1;
      if (s.streak % STREAK === 0 && (nb.w < BASE || nb.d < BASE)) { nb.w = r4(Math.min(BASE, nb.w + GROW)); nb.d = r4(Math.min(BASE, nb.d + GROW)); drop.grew = true; }
    } else {
      s.streak = 0;
      const keep = r4(size - Math.abs(o)); const mid = r4(at + o / 2); const cut = r4(Math.abs(o)); const cutMid = r4(at + Math.sign(o) * (size / 2) + o / 2);
      if (axis === 'x') { nb.x = mid; nb.w = keep; drop.cut = { x: cutMid, z: prev.z, w: cut, d: prev.d }; } else { nb.z = mid; nb.d = keep; drop.cut = { x: prev.x, z: cutMid, w: prev.w, d: cut }; }
    }
    drop.streak = s.streak;
    s.blocks.push(nb);
    return s;
  }
  return { init, apply };
})();

function lcg(seed) { let a = seed >>> 0; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; }
/** A fixed "old-style" log: offsets drawn from a seeded mix of perfects, near misses, slices and (finally) a miss. */
function oldLog(seed, len) {
  const r = lcg(seed);
  const os_ = [];
  for (let i = 0; i < len; i++) {
    const k = r();
    os_.push(k < 0.3 ? Math.round((r() - 0.5) * 0.2 * 1000) / 1000 : k < 0.45 ? Math.round((r() - 0.5) * 0.5 * 1000) / 1000 : Math.round((r() - 0.5) * 2.4 * 1000) / 1000);
  }
  os_.push(9); // the miss that ends it
  return os_;
}
function splitLists(first, offsets, pre = []) { // alternate players starting with `first`; `pre` = setup moves by the starter
  const lists = { a: [], b: [] };
  lists[first].push(...pre);
  offsets.forEach((o, i) => lists[i % 2 ? other(first) : first].push({ o }));
  return lists;
}

async function unit() {
  const core = await import(pathToFileURL(path.join(ROOT, 'js/games/core.js')).href);
  await import(pathToFileURL(path.join(ROOT, 'js/games/tower.js')).href);
  const T = core.gameById('tower');
  const step = (s, who, mv) => T.apply(clone(s), who, mv);

  // 1. old logs replay exactly as they did before modes existed
  const refState = (first, seed, offsets) => {
    let s = REF.init({ first, seed });
    s.seed = seed;
    let who = first;
    for (const o of offsets) { if (s.over) break; s = REF.apply(clone(s), who, { o }); who = other(who); }
    return s;
  };
  let logs = 0; let heights = 0;
  for (let i = 0; i < 60; i++) {
    const first = i % 3 === 0 ? 'b' : 'a';
    const offsets = oldLog(1000 + i, 3 + (i * 7) % 60);
    const match = { first, seed: 77 + i, lists: splitLists(first, offsets) };
    const d = core.derive(T, match);
    const ref = refState(first, 77 + i, offsets);
    const mine = clone(d.state); delete mine.seed;
    const want = clone(ref); delete want.seed;
    if (JSON.stringify(mine) !== JSON.stringify(want)) throw new Error(`FAIL: tower old log #${i} replays differently:\n${JSON.stringify(mine).slice(0, 300)}\n${JSON.stringify(want).slice(0, 300)}`);
    const res = T.result(d.state);
    if (res.winner !== null || res.team !== true || res.score !== ref.blocks.length - 1 || res.text !== `${ref.blocks.length - 1} block${ref.blocks.length - 1 === 1 ? '' : 's'} high`) throw new Error(`FAIL: tower old log #${i} result differs`);
    if (d.rejected.length) throw new Error(`FAIL: tower old log #${i} had rejected moves`);
    if (T.score(d.state).a + T.score(d.state).b !== ref.blocks.length - 1) throw new Error('FAIL: chips');
    logs++; heights += res.score;
  }
  ok(logs === 60 && heights > 100, `tower: ${logs} old-style logs (${heights} blocks in all) replay identically to the original rules, with the same results`);
  // no new fields leak into classic
  {
    const d = core.derive(T, { first: 'a', seed: 5, lists: splitLists('a', [0.3, 0.02, 0.01, 0.0, 9]) });
    const keys = Object.keys(d.state).sort().join();
    ok(keys === 'blocks,drop,over,perfects,seed,streak,turn', `tower: a classic state has only the original fields (${keys})`);
    ok(d.state.blocks.every((b) => !('gift' in b) && !('lm' in b)), 'tower: classic blocks carry no gift or landmark marks');
    ok(!('gift' in d.state.drop) && !('landmark' in d.state.drop), 'tower: classic drops carry no gift or landmark marks');
  }
  // a fixed hand-checked log (pinned values)
  {
    const d = core.derive(T, { first: 'a', seed: 9, lists: { a: [{ o: 0.6 }, { o: 0.05 }, { o: -0.08 }], b: [{ o: -0.4 }, { o: 0 }, { o: 5 }] } });
    const top = d.state.blocks[d.state.blocks.length - 1];
    ok(d.over && d.result.score === 5 && d.state.streak === 0 && d.state.perfects.a === 2 && d.state.perfects.b === 1 && d.state.blocks[5].p === 1 && top.w === 2.6 && top.d === 2.8, 'tower: a pinned old log still ends at 5 high, 3 perfects, one growth');
  }

  // 2. the setup move
  const s0 = T.init({ first: 'a', seed: 3, opts: {} });
  s0.seed = 3;
  const picked = step(s0, 'a', { m: 'duet' });
  ok(picked.mode === 'duet' && picked.turn === 'a' && picked.blocks.length === 1 && !picked.over && T.next(picked).join() === 'a', 'tower setup: the starter picks a mode and keeps the turn');
  ok(throws(() => step(s0, 'b', { m: 'duet' }), /turn/), 'tower setup: only the starting player can pick');
  ok(throws(() => step(picked, 'a', { m: 'hard' }), /before the first drop/), 'tower setup: a mode can only be picked once');
  const played = step(s0, 'a', { o: 0.5 });
  ok(throws(() => step(played, 'b', { m: 'duet' }), /before the first drop/) && throws(() => step(step(played, 'b', { o: 0.1 }), 'a', { m: 'duet' }), /before the first drop/), 'tower setup: after a normal move the match is classic and the setup move is rejected');
  const missed = step(s0, 'a', { o: 9 });
  ok(throws(() => step(missed, 'b', { m: 'duet' })), 'tower setup: nothing after a total miss');
  ok(['party', '', null, 3, 'constructor', '__proto__', 'toString'].every((m) => throws(() => step(s0, 'a', { m }), /menu/)), 'tower setup: unknown modes are rejected with a friendly message');
  const cl = step(s0, 'a', { m: 'classic' });
  ok(cl.mode === 'classic' && cl.blocks[0].w === 3, 'tower setup: choosing Classic keeps the classic base');
  {
    const match = { first: 'a', seed: 3, lists: { a: [{ o: 0.5 }, { m: 'duet' }], b: [{ o: 0.1 }] } };
    const d = core.derive(T, match);
    ok(d.rejected.length === 1 && d.rejected[0].move.m === 'duet' && d.state.mode === undefined, 'tower setup: a late setup move in a log is rejected and the match stays classic');
    // classic chosen explicitly plays identically to no setup move
    const offs = oldLog(4242, 25);
    const x = core.derive(T, { first: 'a', seed: 8, lists: splitLists('a', offs) });
    const y = core.derive(T, { first: 'a', seed: 8, lists: splitLists('a', offs, [{ m: 'classic' }]) });
    const xs = clone(x.state); const ys = clone(y.state); delete ys.mode;
    ok(JSON.stringify(xs) === JSON.stringify(ys) && x.result.score === y.result.score && !y.rejected.length, 'tower setup: an explicit Classic plays exactly like no setup move');
  }

  // 3. modes
  const play = (mode, seed, offsets, first = 'a') => {
    const d = core.derive(T, { first, seed, lists: splitLists(first, offsets, mode ? [{ m: mode }] : []) });
    if (d.rejected.length) throw new Error('rejected: ' + JSON.stringify(d.rejected));
    return d;
  };
  { // hard hat
    const d = play('hard', 11, [0.05, 0.08]);
    ok(d.state.blocks[0].w === 2.4 && d.state.blocks[0].d === 2.4 && d.state.mode === 'hard', 'tower hard: the base is 2.4');
    ok(d.state.blocks[1].p === 1 && d.state.blocks[2].p !== 1 && d.state.blocks[2].d === 2.32, 'tower hard: 0.05 is perfect, 0.08 is sliced');
    const c1 = play('classic', 11, [0.08]);
    ok(c1.state.drop.perfect, 'tower hard: (classic still allows 0.08)');
    const flat = play('hard', 11, [0.0, 0.0, 0.0]);
    ok(flat.state.streak === 3 && flat.state.blocks[3].w === 2.4 && !flat.state.drop.grew, 'tower hard: growth is capped at the hard base (2.4)');
    const g = play('hard', 11, [1, 0.0, 0.0, 0.0]);
    ok(g.state.blocks[1].w === 1.4 && g.state.drop.grew && g.state.blocks[4].w === 1.6 && g.state.blocks[4].d === 2.4, 'tower hard: three perfects still grow a small block');
  }
  { // duet: two perfects in a row (always by different players) grow it
    const d = play('duet', 12, [0.6, 0.0, 0.0]);
    ok(d.state.blocks[2].w === 2.4 && d.state.blocks[3].w === 2.6 && d.state.blocks[3].d === 3 && d.state.drop.grew && d.state.streak === 2 && d.state.blocks[2].who !== d.state.blocks[3].who, 'tower duet: the second perfect in a row, by the other player, grows the block back (+0.2)');
    const e = play('duet', 12, [0.6, 0.4, 0.0, 0.0]);
    ok(e.state.drop.grew && e.state.blocks[4].w === 2.6 && e.state.blocks[4].d === 2.8, 'tower duet: a slice resets the pair');
    const f = play('duet', 12, [0.6, 0.0, 0.0, 0.0, 0.0]);
    ok(f.state.streak === 4 && f.state.drop.grew && !play('duet', 12, [0.6, 0.0, 0.0, 0.0]).state.drop.grew, 'tower duet: and again on every second perfect');
    const g = play('duet', 12, [0.6, 0.0]);
    ok(!g.state.drop.grew && g.state.streak === 1, 'tower duet: one perfect on its own does not grow it');
    const c = play('classic', 12, [0.6, 0.0, 0.0]);
    ok(!c.state.drop.grew, 'tower duet: classic still needs three');
  }
  { // gifts: seeded, from level 5, +0.3 on landing, never on a miss, only duet and windy
    const seed = 21;
    const gifts = [];
    for (let l = 1; l <= 60; l++) if (core.randInt(6, seed, 'gift', l) === 0) gifts.push(l);
    const first = gifts.find((l) => l >= 5);
    ok(first && gifts.length >= 4 && gifts.length <= 20, `tower gifts: roughly one level in six is a gift (levels ${gifts.slice(0, 8).join(', ')}…)`);
    const offs = [];
    for (let l = 1; l < first; l++) offs.push(l % 2 ? 0.2 : -0.2); // slice a little every level so there is room to grow
    for (const mode of ['windy', 'duet']) {
      const d = play(mode, seed, [...offs, 0.4]);
      const g = d.state.blocks[first];
      const before = d.state.blocks[first - 1];
      const size = first % 2 ? 'w' : 'd';
      const sliced = Math.round((before[size] - 0.4) * 10000) / 10000;
      ok(g.gift === 1 && d.state.drop.gift && d.state.drop.grew && Math.abs(g[size] - Math.min(3, sliced + 0.3)) < 1e-9, `tower ${mode}: gift level ${first} grows +0.3 after the slice (${sliced} → ${g[size]})`);
    }
    const none = play('hard', seed, [...offs, 0.4]);
    ok(!none.state.blocks[first].gift && !none.state.drop.gift, 'tower hard: no gifts');
    ok(!play('classic', seed, [...offs, 0.4]).state.blocks[first].gift, 'tower classic: no gifts');
    const miss = play('windy', seed, [...offs, 9]);
    ok(miss.over && miss.state.drop.miss && !miss.state.drop.gift && miss.state.blocks.length === first, 'tower gifts: a miss gets no gift');
    const d1 = play('windy', seed, [...offs, 0.4]); const d2 = play('windy', seed, [...offs, 0.4]);
    ok(JSON.stringify(d1.state) === JSON.stringify(d2.state), 'tower gifts: deterministic');
    const pat = (sd) => Array.from({ length: 40 }, (_, i) => core.randInt(6, sd, 'gift', i + 5) === 0).join();
    ok(pat(21) !== pat(22), 'tower gifts: a different seed gives a different gift pattern');
  }
  { // windy = classic + gifts: with no gift in play the blocks match classic exactly
    let seed = 1;
    while (Array.from({ length: 12 }, (_, i) => core.randInt(6, seed, 'gift', i + 5)).some((v) => v === 0)) seed++;
    const offs = oldLog(55, 9).slice(0, 8);
    const w = play('windy', seed, offs); const c = play('classic', seed, offs);
    ok(JSON.stringify(w.state.blocks) === JSON.stringify(c.state.blocks) && w.state.over === c.state.over, 'tower windy: the rules are classic when no gift is in play');
  }
  { // landmarks: every 10th level in non-classic modes; a perfect there grows +0.2 and is flagged
    const offs = [];
    for (let l = 1; l <= 9; l++) offs.push(l % 2 ? 0.12 : -0.12);
    const d = play('hard', 31, [...offs, 0]);
    const b = d.state.blocks[10];
    const before = d.state.blocks[9];
    ok(b.lm === 1 && d.state.drop.landmark && d.state.drop.bonus && d.state.drop.grew, 'tower landmark: level 10 is a landmark and a perfect there is flagged');
    ok(Math.abs(b.w - (before.w + 0.2)) < 1e-9 && Math.abs(b.d - (before.d + 0.2)) < 1e-9, `tower landmark: a perfect on a landmark grows +0.2 (${before.w} → ${b.w})`);
    const slice = play('hard', 31, [...offs, 0.3]);
    ok(slice.state.blocks[10].lm === 1 && slice.state.drop.landmark && !slice.state.drop.bonus && !slice.state.drop.grew, 'tower landmark: a sliced drop on a landmark gets no bonus');
    const cl = play('classic', 31, [...offs, 0]);
    ok(!cl.state.blocks[10].lm && !cl.state.drop.landmark, 'tower landmark: classic has none');
    ok(play('duet', 31, [...offs, 0]).state.blocks[10].lm === 1 && play('windy', 31, [...offs, 0]).state.blocks[10].lm === 1, 'tower landmark: duet and windy have them too');
  }
  { // the result line
    const d = play('duet', 5, [0.5, 0, 0, 0, 0.5, 9]);
    const r = T.result(d.state);
    ok(r.winner === null && r.team && r.score === d.state.blocks.length - 1 && /perfect drops?, longest streak 3/.test(r.sub), `tower result: counts perfects and the longest streak (“${r.sub}”)`);
  }
  return { core, T };
}

// ── browser helpers ───────────────────────────────────────────────────
let core;
const movesOf = (h, pg, id) => h.engine(pg, id).then((e) => (e ? e.lists.a.length + e.lists.b.length : -1));
const waitMoves = (pg, id, n, timeout = 12000) => pg.waitForFunction(([mid, k]) => {
  const d = window.__gamesDebug(mid);
  return d && d.lists.a.length + d.lists.b.length >= k;
}, [id, n], { timeout });
const armed = (pg, timeout = 12000) => pg.waitForSelector('.gt-view[data-armed="1"]', { timeout });
const endCard = (pg, timeout = 12000) => pg.waitForSelector('#game-root .gm-end:not([hidden]) .gm-end-card', { timeout }).then(() => pg.waitForTimeout(500));
async function withRandom(pg, r, fn) {
  await pg.evaluate((v) => { window.__realRandom = Math.random; Math.random = () => v; }, r);
  try { return await fn(); } finally { await pg.evaluate(() => { Math.random = window.__realRandom; }); }
}
const hook = (pg) => pg.evaluate(() => { window.__towerTest = { log: [] }; });
/** Fire a tap in the very frame the slider appears (before it is armed). */
const tapAtAppear = (pg) => pg.waitForFunction(() => {
  const v = document.querySelector('.gt-view');
  if (!v || v.dataset.phase !== 'slide') return false;
  v.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', clientX: 120, clientY: 300 }));
  return true;
}, null, { polling: 'raf', timeout: 12000 });
/** Drop with a chosen offset (the slider is view-only: the test hook stands in for the tap position). */
async function dropAt(pg, id, n, o) {
  await armed(pg);
  await pg.evaluate((v) => { window.__towerTest.next = v; }, o === 'miss' ? 9 : o);
  await pg.click('.gt-view');
  await waitMoves(pg, id, n);
}
/** Move lists for a match: alternating players, `first` starts (`setup` = an optional setup move by the starter). */
function listsOf(first, offsets, setup = null) {
  const lists = { a: [], b: [] };
  if (setup) lists[first].push(setup);
  offsets.forEach((o, i) => lists[i % 2 ? other(first) : first].push({ o }));
  return lists;
}
/** Start an online match, close it, and give it these offsets (so a long or finished match needs no tapping).
 *  Returns the id and the page of the phone that starts it. */
async function presetOnline(h, pg, offsets) {
  const id = await withRandom(pg, 0.3, () => h.newOnlineGame(pg, 'tower'));
  await h.closeGame(pg);
  const first = (await h.engine(pg, id)).first;
  const L = listsOf(first, offsets);
  await pg.evaluate(([mid, ls]) => globalThis.claude.use('db').then((db) => db.doc('matches/' + mid).update({ a: JSON.stringify(ls.a), b: JSON.stringify(ls.b), ua: Date.now(), ub: Date.now() })), [id, L]);
  await h.wait(400);
  return { id, first, S: first === 'a' ? h.a : h.b };
}
const localData = (pg) => pg.evaluate(() => { try { return (JSON.parse(localStorage.getItem('ju.games.data.v1') || '{}').tower) || {}; } catch { return {}; } });

// ── bug fixes 1, 2, 5, 6: early taps, lost context, resume, handoff ────
async function stray(h, pg) {
  await hook(pg);
  await h.newLocalGame(pg, 'tower');
  const id = await pg.evaluate(() => window.__lastMatchId);
  // 1. a tap in the frame the slider appears is a stray tap, not a drop
  await tapAtAppear(pg);
  await h.wait(120);
  ok(await movesOf(h, pg, id) === 0 && await pg.evaluate(() => window.__towerTest.ignored) >= 1, 'tower early tap: a tap the instant the slider appears is ignored');
  // it also holds for a burst of taps across the first 200 ms
  await dropAt(pg, id, 1, 0.3);
  ok(await pg.evaluate(() => window.__towerTest.tapped) === 0.3, 'tower early tap: a tap once the slider is armed still drops');
  await pg.waitForSelector('.gt-view[data-phase="beat"], .gt-view[data-phase="slide"]', { timeout: 6000 });
  const ign0 = await pg.evaluate(() => window.__towerTest.ignored);
  await pg.evaluate(() => window.__towerTest.tapped = null);
  await pg.waitForFunction(() => {
    const v = document.querySelector('.gt-view');
    if (!v || v.dataset.phase !== 'slide') return false;
    for (const ms of [0, 70, 140, 200]) setTimeout(() => v.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', clientX: 120, clientY: 300 })), ms);
    return true;
  }, null, { polling: 'raf', timeout: 8000 });
  await h.wait(450);
  ok(await movesOf(h, pg, id) === 1 && await pg.evaluate(() => window.__towerTest.ignored) >= ign0 + 3, 'tower early tap: a burst of taps right after a drop (same phone) records no miss');
  let e = await h.engine(pg, id);
  ok(!e.over, 'tower early tap: the game goes on');

  // 6. same phone: a short “Sydney’s turn” beat before the next slider
  await dropAt(pg, id, 2, 0.2);
  const beat = await pg.waitForSelector('.gt-beat:not([hidden])', { timeout: 3000 });
  const who = (await h.engine(pg, id)).acts[0];
  const nm = await pg.evaluate((x) => document.querySelector(`#game-root .gm-p-${x} .gm-p-name`).textContent, who);
  ok((await beat.textContent()) === `${nm}’s turn` && await pg.getAttribute('.gt-view', 'data-phase') === 'beat' && await pg.getAttribute('.gt-view', 'data-armed') === '0', `tower handoff: a “${nm}’s turn” beat comes before the slider and taps do nothing meanwhile`);
  await pg.click('.gt-view');
  await h.wait(100);
  ok(await movesOf(h, pg, id) === 2, 'tower handoff: a tap during the beat is ignored');
  await pg.waitForSelector('.gt-view[data-phase="slide"]', { timeout: 3000 });

  // 5. coming back from a hidden tab: a short 3-2-1, then the slider starts over
  await armed(pg);
  await pg.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await h.wait(150);
  ok(await pg.getAttribute('.gt-view', 'data-armed') === '0', 'tower resume: hiding the page disarms the slider');
  await pg.evaluate(() => {
    window.__towerTest.log = [];
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const seen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 2200 && seen.length < 3) {
    const t = await pg.evaluate(() => { const b = document.querySelector('.gt-beat'); return b && !b.hidden ? b.textContent : null; });
    if (t && seen[seen.length - 1] !== t) seen.push(t);
    await h.wait(40);
  }
  ok(seen.join() === '3,2,1', `tower resume: the slider waits for a 3-2-1 (saw ${seen.join('-')})`);
  await pg.click('.gt-view');
  await h.wait(100);
  ok(await movesOf(h, pg, id) === 2 && await pg.evaluate(() => window.__towerTest.log.includes('resume')), 'tower resume: a tap during the countdown does nothing');
  await armed(pg, 4000);
  ok(true, 'tower resume: then the slider is live again');

  // 2. taps while the WebGL context is lost do nothing
  await pg.evaluate(() => { window.__lose = document.querySelector('.gt-canvas').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
  await pg.waitForSelector('.gt-view[data-gl="lost"]', { timeout: 4000 });
  await pg.evaluate(() => { window.__towerTest.next = 0.1; });
  await pg.click('.gt-view');
  await pg.keyboard.press('Space');
  await h.wait(250);
  ok(await movesOf(h, pg, id) === 2 && await pg.getAttribute('.gt-view', 'data-armed') === '0', 'tower context loss: taps and Space do nothing while the context is lost');
  await pg.evaluate(() => window.__lose.restoreContext());
  await pg.waitForFunction(() => window.__towerTest.log.includes('restored'), null, { timeout: 4000 });
  await pg.click('.gt-view');
  await h.wait(150);
  ok(await movesOf(h, pg, id) === 2, 'tower context loss: after the restore the 3-2-1 holds the slider first');
  await armed(pg, 4000);
  await pg.evaluate(() => { window.__towerTest.next = 0.1; });
  await pg.click('.gt-view');
  await waitMoves(pg, id, 3);
  ok(true, 'tower context loss: and then it plays on');
  // paused (hidden) pages never take a tap
  await armed(pg);
  await pg.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.__towerTest.next = 0.1;
    document.querySelector('.gt-view').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', clientX: 120, clientY: 300 }));
  });
  await h.wait(200);
  ok(await movesOf(h, pg, id) === 3, 'tower paused: a tap while the page is hidden does nothing');
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await h.closeGame(pg);
}

/** Before the 3D view is ready, nothing drops. */
async function notReady(h, pg) {
  await hook(pg);
  await h.newLocalGame(pg, 'tower');
  const id = await pg.evaluate(() => window.__lastMatchId);
  await pg.evaluate(() => { const v = document.querySelector('.gt-view'); for (let i = 0; i < 5; i++) v.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', clientX: 120, clientY: 300 })); });
  await h.wait(400);
  ok(await movesOf(h, pg, id) === 0, 'tower: taps before the view is ready do nothing');
  await h.closeGame(pg);
}

/** Two phones in one online match. S is the phone that starts (it varies with the match history), O the other. */
async function pair(h) {
  const { a, b } = h;
  for (const p of [a, b]) { await p.setViewportSize({ width: 390, height: 844 }); await hook(p); }
  const id = await withRandom(a, 0.3, () => h.newOnlineGame(a, 'tower'));
  await h.openMatch(b, id);
  const first = (await h.engine(a, id)).first;
  const S = first === 'a' ? a : b;
  const O = first === 'a' ? b : a;
  const nm = await S.evaluate((x) => document.querySelector(`#game-root .gm-p-${x} .gm-p-name`).textContent, first);
  const nmO = await O.evaluate((x) => document.querySelector(`#game-root .gm-p-${x} .gm-p-name`).textContent, other(first));
  return { id, first, S, O, nm, nmO };
}

// ── bug fix 3: online, the HUD follows the replay ────────────────────
async function onlineHud(h) {
  const { id, S: a, O: b } = await pair(h);
  await dropAt(a, id, 1, 0.5); // Emerson drops (classic: just play)
  await waitMoves(b, id, 1);
  await dropAt(b, id, 2, -0.3); // Sydney
  await waitMoves(a, id, 2);
  // now Emerson drops once more and we sample Sydney's screen all the way through the replay
  await armed(a);
  await b.evaluate(() => {
    const q = (s) => document.querySelector(s);
    window.__samples = [];
    window.__sampler = setInterval(() => window.__samples.push({ ph: q('.gt-view').dataset.phase, pill: q('.gt-turn').textContent, h: q('.gt-height b').textContent, na: q('.gt-t-a b').textContent, nb: q('.gt-t-b b').textContent, armed: q('.gt-view').dataset.armed }), 16);
  });
  await a.evaluate(() => { window.__towerTest.next = 0.2; });
  await a.click('.gt-view');
  await waitMoves(b, id, 3);
  await armed(b);
  await h.wait(100);
  const samples = await b.evaluate(() => { clearInterval(window.__sampler); return window.__samples; });
  const badPill = samples.filter((x) => /Your turn/.test(x.pill) && x.ph !== 'slide');
  ok(badPill.length === 0, `tower hud: “Your turn” never shows before the slider exists (${samples.length} samples)`);
  const cnt = (x) => Number(x.na) + Number(x.nb);
  const replaying = samples.filter((x) => x.ph === 'replay' || x.ph === 'busy');
  ok(replaying.length > 3 && replaying.every((x) => cnt(x) === 2 && (x.h === '2' || x.ph === 'busy')), `tower hud: the block counts hold until the replayed drop lands (${replaying.length} replay samples)`);
  ok(samples.filter((x) => x.ph === 'replay').every((x) => x.h === '2'), 'tower hud: and so does the height');
  const last = samples[samples.length - 1];
  ok(last.ph === 'slide' && /Your turn/.test(last.pill) && last.h === '3' && cnt(last) === 3, 'tower hud: after the replay it is your turn and the numbers are current');
  // the stray tap on the waiting→active phone: the instant the slider appears
  await a.waitForSelector('.gt-view[data-phase="wait"]', { timeout: 6000 });
  await b.evaluate(() => { window.__towerTest.ignored = 0; });
  // (Sydney's slider is already up: let Emerson's next replay hand over, then tap in the frame it appears)
  await dropAt(b, id, 4, 0.1);
  await a.evaluate(() => { window.__towerTest.ignored = 0; });
  await a.waitForFunction(() => {
    const v = document.querySelector('.gt-view');
    if (!v || v.dataset.phase !== 'slide') return false;
    v.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', clientX: 120, clientY: 300 }));
    return true;
  }, null, { polling: 'raf', timeout: 12000 });
  await h.wait(300);
  ok(await movesOf(h, a, id) === 4 && !(await h.engine(a, id)).over && await a.evaluate(() => window.__towerTest.ignored) >= 1, 'tower early tap: a tap in the frame the slider appears on the waiting→active phone records nothing');
  await h.closeGame(a);
  await h.closeGame(b);
}

// ── modes: the picker, the setup move, badge, duet, gifts, windy, hard ──
async function picker(h) {
  for (const p of [h.a, h.b]) await p.evaluate(() => { try { localStorage.setItem('ju.tower.lastmode', 'windy'); } catch { /* ignore */ } });
  const { id, S: a, O: b, first, nm } = await pair(h);
  await armed(a);
  await b.waitForSelector('.gt-view[data-phase="wait"]', { timeout: 8000 });
  const boxes = await a.$$eval('.gt-pick:not([hidden]) .gt-chip', (cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return { h: r.height, w: r.width, l: r.left, r: r.right, t: c.textContent, last: c.classList.contains('is-last'), bottom: r.bottom }; }));
  ok(boxes.length === 4 && boxes.every((c) => c.h >= 44 && c.l >= 0 && c.r <= 390), `tower picker: the starter sees four mode chips, each ≥44 px tall (${boxes.map((c) => Math.round(c.h)).join('/')})`);
  ok(boxes.find((c) => /Windy/.test(c.t)).last && boxes.filter((c) => c.last).length === 1, 'tower picker: the last mode played is highlighted, but nothing is sent');
  ok(await movesOf(h, a, id) === 0, 'tower picker: nothing sent until a chip is tapped');
  ok(await b.isHidden('.gt-pick'), 'tower picker: the partner does not see the chips');
  const pill = await b.textContent('.gt-turn');
  ok(pill.includes(`${nm} is choosing a twist`), `tower picker: the partner sees “${pill}”`);
  await shot(a, 'tower-picker-390.png');
  await shot(b, 'tower-picker-partner-390.png');
  await a.tap('.gt-chip[data-mode="duet"]');
  await waitMoves(a, id, 1);
  await waitMoves(b, id, 1);
  let e = await h.engine(a, id);
  ok(e.state.mode === 'duet' && e.lists[first].length === 1 && e.lists[first][0].m === 'duet' && e.acts.join() === first && e.state.blocks.length === 1, 'tower picker: tapping Duet sends the setup move at once and keeps the turn');
  await b.waitForSelector('.toast', { timeout: 3000 });
  const toast = await b.$$eval('.toast', (ts) => ts.map((t) => t.textContent).join('|'));
  ok(toast.includes(`${nm} picked Duet`), `tower picker: the partner is told (“${toast}”)`);
  ok(await b.isVisible('.gt-badge') && (await b.textContent('.gt-badge')) === 'Duet' && await a.isVisible('.gt-badge'), 'tower picker: both phones show the Duet badge');
  ok(await a.isHidden('.gt-pick') && await b.isHidden('.gt-pick'), 'tower picker: the chips go away');
  ok((await a.evaluate(() => { try { return localStorage.getItem('ju.tower.lastmode'); } catch { return null; } })) === 'duet', 'tower picker: the choice is remembered for next time');
  ok(!/Your turn/.test(await b.textContent('.gt-turn')) && (await b.textContent('.gt-turn')).includes(`${nm}’s turn`), 'tower picker: then it is just “Emerson’s turn” for the partner');
  // duet: a perfect from each of you grows the block
  await armed(a);
  await dropAt(a, id, 2, 0.4);  // slice: 3 → 2.6
  await waitMoves(b, id, 2);
  await dropAt(b, id, 3, 0.02); // Sydney: perfect
  await waitMoves(a, id, 3);
  await dropAt(a, id, 4, -0.03); // Emerson: perfect → duet pair → grows
  await waitMoves(b, id, 4);
  e = await h.engine(a, id);
  ok(e.state.streak === 2 && e.state.drop.grew && e.state.blocks[3].who === first && e.state.blocks[2].who === other(first), 'tower duet: the partner then the starter perfect → the block grew');
  await a.waitForSelector('.gt-stamp.show', { timeout: 3000 });
  ok(/Duet/.test(await a.textContent('.gt-stamp')), 'tower duet: the stamp says so');
  const dia = await a.$$eval('.gt-streak i', (is) => is.map((i) => ({ on: i.classList.contains('on'), w: i.dataset.w || '', shown: getComputedStyle(i).display !== 'none' })));
  ok(dia.filter((d) => d.shown).length === 2 && dia.slice(0, 2).every((d) => d.on) && dia[0].w === other(first) && dia[1].w === first, 'tower duet: two diamonds, in each player’s colour');
  await shot(a, 'tower-duet-390.png');
  await dropAt(b, id, 5, 'miss');
  await endCard(a);
  await h.settle();
  const d = await localData(a);

  ok(d.h_duet_best === 3 && d.towers_n >= 1, `tower duet: the run counts for the Duet board (${JSON.stringify(d).slice(0, 120)})`);
  await h.closeGame(a);
  await h.closeGame(b);
}

/** Playing a normal move skips the picker for good (the match is classic), on the starter's screen too. */
async function classicSkip(h, pg) {
  await hook(pg);
  await pg.evaluate(() => { try { localStorage.removeItem('ju.tower.lastmode'); } catch { /* ignore */ } });
  await h.newLocalGame(pg, 'tower');
  const id = await pg.evaluate(() => window.__lastMatchId);
  await armed(pg);
  ok(await pg.isVisible('.gt-pick'), 'tower classic: the starter sees the picker first');
  ok(await pg.$$eval('.gt-chip.is-last', (c) => c.length) === 0, 'tower classic: no chip is highlighted the first time');
  await dropAt(pg, id, 1, 0.3);
  await pg.waitForSelector('.gt-view[data-armed="1"]', { timeout: 6000 });
  ok(await pg.isHidden('.gt-pick') && await pg.isHidden('.gt-badge'), 'tower classic: just dropping skips the picker and shows no badge');
  const e = await h.engine(pg, id);
  ok(e.state.mode === undefined && e.lists.a.length + e.lists.b.length === 1, 'tower classic: the state has no mode');
  await h.closeGame(pg);
}

/** Hard hat, windy and gifts through the real UI. */
async function modesUi(h, pg) {
  await hook(pg);
  await h.newLocalGame(pg, 'tower');
  const id = await pg.evaluate(() => window.__lastMatchId);
  await armed(pg);
  await pg.tap('.gt-chip[data-mode="hard"]');
  await waitMoves(pg, id, 1);
  let e = await h.engine(pg, id);
  ok(e.state.mode === 'hard' && e.state.blocks[0].w === 2.4, 'tower hard: the setup move rewrites the base to 2.4');
  await armed(pg);
  ok(await pg.evaluate(() => window.__towerTest.model.blocks[0].w) === 2.4, 'tower hard: the view draws the smaller base');
  await dropAt(pg, id, 2, 0.05);
  e = await h.engine(pg, id);
  ok(e.state.drop.perfect, 'tower hard: 0.05 is still perfect');
  await dropAt(pg, id, 3, 0.08);
  e = await h.engine(pg, id);
  ok(!e.state.drop.perfect, 'tower hard: 0.08 is not');
  await shot(pg, 'tower-hard-390.png');
  await h.closeGame(pg);

  // windy: the streamer shows, and the pattern of gift levels comes from the seed
  await h.newLocalGame(pg, 'tower');
  const id2 = await pg.evaluate(() => window.__lastMatchId);
  await armed(pg);
  await pg.tap('.gt-chip[data-mode="windy"]');
  await waitMoves(pg, id2, 1);
  e = await h.engine(pg, id2);
  ok(e.state.mode === 'windy', 'tower windy: picked');
  const seed = e.state.seed;
  const gifts = []; for (let l = 1; l <= 40; l++) if (core.randInt(6, seed, 'gift', l) === 0) gifts.push(l);
  const firstGift = gifts.find((l) => l >= 5);
  // sail up to the first gift level, slicing a little each time
  let n = 1;
  for (let l = 1; l < firstGift; l++) { await dropAt(pg, id2, ++n, l % 2 ? 0.2 : -0.2); }
  await armed(pg);
  const vis = await pg.evaluate(() => { const m = window.__towerTest.model; return { extras: m.extras.length, gift: !!(m.slider && m.slider.rib), wind: m.mode }; });
  ok(vis.gift && vis.wind === 'windy', `tower gifts: level ${firstGift}'s block is gift-wrapped while it slides`);
  ok(await pg.evaluate(() => window.__towerTest.model.extras.length) === 4, 'tower windy: the streamer is up (a pole and three flags)');
  await shot(pg, 'tower-gift-390.png');
  const calls = await pg.evaluate(() => window.__towerTest.calls);
  ok(calls > 0 && calls <= 12, `tower windy: ${calls} draw calls per frame with a gift ribbon, the dashed best ring and the streamer (budget 12)`);
  await dropAt(pg, id2, ++n, 0.4);
  e = await h.engine(pg, id2);
  ok(e.state.drop.gift && e.state.blocks[firstGift].gift === 1, 'tower gifts: it landed and grew');
  await pg.waitForSelector('.gt-banner.show', { timeout: 3000 });
  ok(/Gift/.test(await pg.textContent('.gt-banner b')), 'tower gifts: “Gift!” banner');
  await h.wait(800);
  ok(await pg.evaluate((k) => !!window.__towerTest.model.blocks[k].rib, firstGift), 'tower gifts: the landed block keeps its ribbon');
  await h.closeGame(pg);
}

/** Play offsets on a same-phone game (reduced motion keeps this quick). Returns the match id. */
async function playLocal(h, pg, offsets, { shotName = null } = {}) {
  await hook(pg);
  await h.newLocalGame(pg, 'tower');
  const id = await pg.evaluate(() => window.__lastMatchId);
  let n = 0;
  for (const o of offsets) await dropAt(pg, id, ++n, o);
  return id;
}

// ── Hall of Heights: records, ghost line, milestones, near-misses, the end panel ──
async function records(h, pg) {
  await pg.setViewportSize({ width: 390, height: 844 });
  // run 1: four perfects in a row, then a miss
  const id1 = await playLocal(h, pg, [0, 0, 0, 0, 'miss']);
  await pg.waitForSelector('.gt-panel.show', { timeout: 6000 });
  const p1 = await pg.evaluate(() => ({ txt: document.querySelector('.gt-panel').innerText, flag: !document.querySelector('.gt-pn-flag').hidden, big: document.querySelector('.gt-pn-big b').textContent, btn: Array.from(document.querySelectorAll('.gt-panel .gm-btn')).map((b) => b.getBoundingClientRect().height) }));
  ok(p1.flag && p1.big === '4' && /Longest streak 4/.test(p1.txt) && /perfects?/.test(p1.txt) && /First one on the board/.test(p1.txt), `tower panel: NEW BEST, the height, per-player perfects and the longest streak (${p1.txt.replace(/\n+/g, ' | ')})`);
  ok(p1.btn.length === 2 && p1.btn.every((x) => x >= 44), 'tower panel: Rematch and Back are ≥44 px tall');
  await shot(pg, 'tower-panel-390.png');
  await endCard(pg);
  let d = await localData(pg);
  ok(d.h_classic_best === 4 && d.towers_n === 1 && d.blocks_n === 4 && d.perf_a_n + d.perf_b_n === 4 && d.streak_best === 4 && typeof d.last_id === 'string', `tower records: the first run is on the board (${JSON.stringify(d)})`);
  const res = await h.engine(pg, id1);
  ok(res.result.score === 4 && /longest streak 4/.test(res.result.sub), 'tower records: the result line mentions the streak');
  await shot(pg, 'tower-endcard-390.png');
  await pg.click('#game-root [data-g="end-look"]');
  await h.wait(300);
  ok(await pg.isVisible('.gt-panel.show'), 'tower panel: it is still there after “See the tower”');
  await shot(pg, 'tower-panel-after-390.png');
  await h.closeGame(pg);

  // run 2: lower. The ghost line shows the best; nothing new is recorded as best
  await hook(pg);
  await h.newLocalGame(pg, 'tower');
  const id2 = await pg.evaluate(() => window.__lastMatchId);
  await armed(pg);
  const g = await pg.evaluate(() => ({ deco: window.__towerTest.model.deco.length, best: document.querySelector('.gt-bestline').textContent, hidden: document.querySelector('.gt-bestline').hidden }));
  ok(g.deco === 16 && g.best === 'Best 4' && !g.hidden, `tower ghost: a dashed ring at the best height and “${g.best}” in the HUD`);
  await dropAt(pg, id2, 1, 0.3); await dropAt(pg, id2, 2, 0.3); await dropAt(pg, id2, 3, 0.3);
  await h.wait(500);
  const gl = await pg.evaluate(() => { const e = document.querySelector('.gt-ghost'); return { hidden: e.hidden, t: e.textContent }; });
  ok(!gl.hidden && gl.t === 'Best 4', 'tower ghost: the “Best 4” tag sits at the line on screen');
  await shot(pg, 'tower-ghost-390.png');
  await dropAt(pg, id2, 4, 'miss');
  await pg.waitForSelector('.gt-panel.show', { timeout: 6000 });
  ok(await pg.isHidden('.gt-pn-flag') && /Best Classic: 4/.test(await pg.textContent('.gt-pn-best')), 'tower panel: a lower run shows the best, not a NEW BEST flag');
  await endCard(pg);
  d = await localData(pg);
  ok(d.h_classic_best === 4 && d.towers_n === 2 && d.blocks_n === 7, `tower records: a lower run only adds to the totals (${JSON.stringify(d)})`);
  await h.closeGame(pg);

  // run 3: pass the best: NEW BEST banner naming who set it
  const id3 = await playLocal(h, pg, [0, 0, 0, 0]);
  await dropAt(pg, id3, 5, 0);
  await pg.waitForFunction(() => { const b = document.querySelector('.gt-banner'); return b.classList.contains('show') && /New best/i.test(b.textContent); }, null, { timeout: 4000 });
  const bn = await pg.textContent('.gt-banner');
  ok(/set the record/.test(bn), `tower ghost: passing the best shows “${bn}”`);
  await shot(pg, 'tower-newbest-390.png');
  await dropAt(pg, id3, 6, 'miss');
  await pg.waitForSelector('.gt-panel.show', { timeout: 6000 });
  ok(await pg.isVisible('.gt-pn-flag') && /Old best 4/.test(await pg.textContent('.gt-pn-best')), 'tower panel: NEW BEST with the old best');
  await endCard(pg);
  d = await localData(pg);
  ok(d.h_classic_best === 5 && d.towers_n === 3 && d.blocks_n === 12, `tower records: the new best is saved (${JSON.stringify(d)})`);
  await h.closeGame(pg);

  // re-opening a finished match (seeded) records nothing and shows the panel straight away
  const before = await localData(pg);
  const { id: done1 } = await presetOnline(h, pg, [0, 0, 0, 9]);
  await h.openMatch(pg, done1);
  await pg.waitForSelector('.gt-panel.show', { timeout: 6000 });
  await h.wait(500);
  const d2 = await localData(pg);
  ok(d2.towers_n === before.towers_n && d2.blocks_n === before.blocks_n && await pg.isHidden('.gt-pn-flag') && /Best Classic: 5/.test(await pg.textContent('.gt-pn-best')) && (await pg.textContent('.gt-pn-big b')) === '3', 're-opening a finished match does not count it again');
  await endCard(pg);
  await h.closeGame(pg);

  // near misses and milestones
  const id4 = await playLocal(h, pg, [0.12]);
  await pg.waitForFunction(() => document.querySelector('.gt-stamp').classList.contains('show'), null, { timeout: 3000 });
  ok(/So close/.test(await pg.textContent('.gt-stamp')), 'tower near miss: 0.12 off (tolerance 0.1) says “So close!”');
  await dropAt(pg, id4, 2, 2.85);
  await pg.waitForFunction(() => /whisker/i.test(document.querySelector('.gt-stamp').textContent) && document.querySelector('.gt-stamp').classList.contains('show'), null, { timeout: 3000 });
  ok(true, 'tower near miss: keeping under 0.25 says “By a whisker!”');
  for (let l = 3; l <= 9; l++) await dropAt(pg, id4, l, 0);
  await dropAt(pg, id4, 10, 0);
  await pg.waitForFunction(() => { const b = document.querySelector('.gt-banner'); return b.classList.contains('show') && /Ten high/.test(b.textContent); }, null, { timeout: 5000 });
  ok(true, 'tower milestone: 10 high gets a banner');
  const ol = await pg.evaluate(() => ({ px: window.__towerTest.model.outPx, on: window.__towerTest.model.lineOn }));
  ok(Math.abs(ol.px - 2.2) < 0.01 && ol.on === true, 'tower outline: full ink outline on a short tower');
  await dropAt(pg, id4, 11, 'miss');
  await endCard(pg);
  await h.closeGame(pg);
}

/** A 110-high tower: the finale fits between the HUD and the panel, and thin blocks lose their shimmer. */
async function tall(h, p0) {
  const offs = Array.from({ length: 110 }, (_, i) => (i % 9 === 4 ? 0.15 : 0));
  const { id, S: pg } = await presetOnline(h, p0, offs);
  await pg.setViewportSize({ width: 390, height: 844 });
  await hook(pg);
  await h.openMatch(pg, id);
  await armed(pg);
  await h.wait(600);
  const o1 = await pg.evaluate(() => ({ px: window.__towerTest.model.outPx, on: window.__towerTest.model.lineOn }));
  await shot(pg, 'tower-tall-110-play-390.png');
  ok(await pg.textContent('.gt-height b') === '110', 'tower tall: a 110-high tower opens');
  await dropAt(pg, id, 111, 'miss');
  await pg.waitForSelector('.gt-panel.show', { timeout: 10000 });
  await h.wait(900);
  const fit = async (label) => {
    const r = await pg.evaluate(() => {
      const w = document.querySelector('.gt-view').getBoundingClientRect();
      const e = window.__towerTest.extent();
      const pn = document.querySelector('.gt-panel').getBoundingClientRect();
      const hud = document.querySelector('.gt-hud').getBoundingClientRect();
      const wide = pn.left > w.left + 100; // landscape: the panel sits at the side
      return { top: e.top, bottom: e.bottom, hudB: hud.bottom - w.top, panelT: pn.top - w.top, wide, h: w.height, outPx: window.__towerTest.model.outPx, lineOn: window.__towerTest.model.lineOn };
    });
    ok(r.top >= r.hudB - 1 && r.bottom <= (r.wide ? r.h : r.panelT) + 1, `tower tall (${label}): the tower sits between the HUD and ${r.wide ? 'the bottom' : 'the panel'} (top ${Math.round(r.top)} ≥ HUD ${Math.round(r.hudB)}; bottom ${Math.round(r.bottom)} ≤ ${Math.round(r.wide ? r.h : r.panelT)})`);
    return r;
  };
  const r1 = await fit('portrait');
  ok(r1.outPx < 2.2 * 0.7 && r1.lineOn === false && o1.px >= 0, `tower tall: the outline eases off on thin blocks (${r1.outPx.toFixed(2)} px) and the crease lines drop out`);
  await shot(pg, 'tower-tall-110-390.png');
  await endCard(pg);
  await pg.click('#game-root [data-g="end-look"]');
  await pg.setViewportSize({ width: 844, height: 390 });
  await h.wait(1800);
  await fit('landscape');
  await shot(pg, 'tower-tall-110-landscape.png');
  await pg.setViewportSize({ width: 360, height: 740 });
  await h.wait(1800);
  await fit('360×740');
  await shot(pg, 'tower-tall-110-360.png');
  await h.closeGame(pg);
  await pg.setViewportSize({ width: 390, height: 844 });
}

/** Screenshots of the picker and the end panel at a given size (light or dark run). */
async function visuals(h, pg, w, ht, name) {
  await pg.setViewportSize({ width: w, height: ht });
  await hook(pg);
  await h.newLocalGame(pg, 'tower');
  const id = await pg.evaluate(() => window.__lastMatchId);
  await armed(pg);
  await h.wait(300);
  const box = await pg.$eval('.gt-pick', (e) => { const r = e.getBoundingClientRect(); const t = document.querySelector('.gt-turn').getBoundingClientRect(); const hud = document.querySelector('.gt-hud').getBoundingClientRect(); const v = document.querySelector('.gt-view').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, pillT: t.top, hudB: hud.bottom, vw: v.width, vh: v.height, chips: Array.from(e.querySelectorAll('.gt-chip')).map((c) => c.getBoundingClientRect().height) }; });
  ok(box.l >= 0 && box.r <= box.vw && box.b <= box.pillT + 1 && box.t >= box.hudB && box.chips.every((x) => x >= 44), `tower ${name}: the picker fits (chips ${box.chips.map(Math.round).join('/')} px, clear of the HUD and the pill)`);
  await shot(pg, `tower-${name}-picker.png`);
  await pg.tap('.gt-chip[data-mode="windy"]');
  await waitMoves(pg, id, 1);
  let n = 1;
  for (const o of [0.3, 0, 0, 0.2]) await dropAt(pg, id, ++n, o);
  await h.wait(500);
  await shot(pg, `tower-${name}-windy.png`);
  await dropAt(pg, id, ++n, 'miss');
  await pg.waitForSelector('.gt-panel.show', { timeout: 10000 });
  await h.wait(500);
  const pn = await pg.$eval('.gt-panel', (e) => { const r = e.getBoundingClientRect(); const v = document.querySelector('.gt-view').getBoundingClientRect(); return { l: r.left - v.left, r: r.right - v.left, t: r.top - v.top, b: r.bottom - v.top, vw: v.width, vh: v.height, btn: Array.from(e.querySelectorAll('.gm-btn')).map((x) => x.getBoundingClientRect().height) }; });
  ok(pn.l >= 0 && pn.r <= pn.vw && pn.b <= pn.vh && pn.t >= 0 && pn.btn.every((x) => x >= 44), `tower ${name}: the end panel fits on screen (${Math.round(pn.t)}–${Math.round(pn.b)} of ${Math.round(pn.vh)})`);
  await shot(pg, `tower-${name}-panel.png`);
  await endCard(pg);
  await h.closeGame(pg);
}

/** The flat 2D version: modes, the ghost line, gifts and the streamer all draw without WebGL. */
async function flat(h, pg) {
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.evaluate(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    window.__realGetContext = orig;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : orig.call(this, type, ...rest); };
    window.__towerTest = { log: [] };
  });
  await withRandom(pg, 0.3, () => h.newLocalGame(pg, 'tower'));
  const id = await pg.evaluate(() => window.__lastMatchId);
  await pg.waitForSelector('.gt-view[data-gl="2d"][data-armed="1"]', { timeout: 8000 });
  await pg.tap('.gt-chip[data-mode="windy"]');
  await waitMoves(pg, id, 1);
  const seed = (await h.engine(pg, id)).state.seed;
  const gifts = []; for (let l = 1; l <= 40; l++) if (core.randInt(6, seed, 'gift', l) === 0) gifts.push(l);
  const g = gifts.find((l) => l >= 5);
  let n = 1;
  for (let l = 1; l < g; l++) await dropAt(pg, id, ++n, l % 2 ? 0.2 : -0.2);
  await armed(pg);
  await h.wait(500);
  ok(await pg.isVisible('.gt-note') && await pg.evaluate(() => !!window.__towerTest.model.slider.rib && window.__towerTest.model.extras.length === 4), 'tower flat: windy and a gift block draw in the 2D version, with the streamer');
  await shot(pg, 'tower-flat-gift-390.png');
  await dropAt(pg, id, ++n, 0.3);
  await h.wait(600);
  await dropAt(pg, id, ++n, 'miss');
  await pg.waitForSelector('.gt-panel.show', { timeout: 8000 });
  await shot(pg, 'tower-flat-panel-390.png');
  await endCard(pg);
  await h.closeGame(pg);
  await pg.evaluate(() => { HTMLCanvasElement.prototype.getContext = window.__realGetContext; });
  for (let i = h.errors.length - 1; i >= 0; i--) if (/Error creating WebGL context/.test(h.errors[i])) h.errors.splice(i, 1);
}

/** Both phones finish the same online match: it is counted once. */
async function onlineOnce(h) {
  const { id, S: a, O: b } = await pair(h);
  await dropAt(a, id, 1, 0.3);
  await waitMoves(b, id, 1);
  await dropAt(b, id, 2, 0.02);
  await waitMoves(a, id, 2);
  await dropAt(a, id, 3, 'miss');
  await endCard(a); await endCard(b);
  await h.settle(); await h.wait(300);
  const da = await localData(a); const db = await localData(b);
  ok(da.towers_n === 1 && db.towers_n === 1 && da.last_id === id && db.last_id === id && da.blocks_n === 2 && db.blocks_n === 2, `tower records: two phones, one match, counted once (${da.towers_n}/${db.towers_n})`);
  ok(da.h_classic_best === 2 && db.h_classic_best === 2, 'tower records: both phones show the same best');
  await h.closeGame(a); await h.closeGame(b);
}

let failed = false;
(async () => {
  try {
    core = (await unit()).core;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
    return;
  }
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const want = (k) => !only || only.includes(k);
  const h = await launch({ port: PORT, only: ['tower'], coarse: true });
  try {
    await h.a.setViewportSize({ width: 390, height: 844 });
    if (want('stray')) { await stray(h, h.a); await notReady(h, h.a); }
    if (want('hud')) await onlineHud(h);
    if (want('once')) await onlineOnce(h);
    if (want('flat')) await flat(h, h.b);
    if (want('visuals')) { await visuals(h, h.a, 390, 844, 'light-390'); await visuals(h, h.a, 844, 390, 'landscape-844'); }
    if (want('tall')) await tall(h, h.a);
    if (want('modes')) { await picker(h); await classicSkip(h, h.a); await modesUi(h, h.a); }
    h.assertNoErrors();
    ok(true, 'no page errors');
  } catch (e) {
    failed = true;
    console.error(e.message);
    await shot(h.a, 'FAIL-a.png').catch(() => {});
    await shot(h.b, 'FAIL-b.png').catch(() => {});
    console.error('errors:', h.errors);
  } finally {
    await h.close();
  }
  if (!failed && want('visuals')) {
    const d = await launch({ port: PORT + 2, only: ['tower'], coarse: true, colorScheme: 'dark' });
    try {
      await visuals(d, d.a, 360, 740, 'dark-360');
      await visuals(d, d.b, 390, 844, 'dark-390');
      d.assertNoErrors();
      ok(true, 'no page errors (dark run)');
    } catch (e) {
      failed = true;
      console.error(e.message);
      await shot(d.a, 'FAIL-d.png').catch(() => {});
      console.error('errors:', d.errors);
    } finally {
      await d.close();
    }
  }
  if (!failed && want('records')) {
    const r = await launch({ port: PORT + 1, only: ['tower'], coarse: true, reducedMotion: 'reduce' });
    try {
      await records(r, r.a);
      r.assertNoErrors();
      ok(true, 'no page errors (reduced motion run)');
    } catch (e) {
      failed = true;
      console.error(e.message);
      await shot(r.a, 'FAIL-r.png').catch(() => {});
      console.error('errors:', r.errors);
    } finally {
      await r.close();
    }
  }
  console.log(failed ? '\nFAILED' : `\nALL GOOD (screenshots in ${SHOTS})`);
  if (failed) process.exitCode = 1;
})();
