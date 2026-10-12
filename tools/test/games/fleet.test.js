// Battleships (fleet) test.
//   node tools/test/games/fleet.test.js
// (a) online game through the real UI (drag, tap-to-place, rotate, Shuffle, shooting to the end)
// (b) same-phone game: the curtain shows between players and only the viewer's fleet is ever drawn
// (c) illegal moves are rejected (rules directly, the replay engine, and the UI)
// (d) the opponent's ships never reach the DOM before they are sunk
// Screenshots (light + dark, 390×844 and 360 wide, plus a laptop) go to SHOTS.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { launch, ROOT } = require('../harness');

const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-Couple-game/0bac2931-fb3f-54c3-8279-c15850ed70e8/scratchpad/fleet';
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const N = 8;
const SIZES = [4, 3, 3, 2, 2];
const other = (w) => (w === 'a' ? 'b' : 'a');
const cellsOf = (s) => Array.from({ length: s.len }, (_, i) => (s.dir === 'v' ? [s.r + i, s.c] : [s.r, s.c + i]));
const posStyle = (s) => `--r:${s.r};--c:${s.c};--w:${s.dir === 'h' ? s.len : 1};--h:${s.dir === 'v' ? s.len : 1}`;
const sameFleet = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const LETTERS = 'ABCDEFGH';
const crypto = require('crypto');
// A whole classic match (with an overlapping fleet and a repeat shot, both rejected) recorded with
// the rules at commit 6e9fee4, before rule sets existed, and the sha-256 of its derived state then.
const GOLDEN = { hash: '1810970636aae553ebf5e0e4f6d16151457ae235634e1a781a4b505696da76c5', sub: 'Sank all five in 64 shots (22% on target), with 2 ships still afloat.',
  lists: {"a":[{"fleet":[{"r":0,"c":0,"len":4,"dir":"h"},{"r":2,"c":0,"len":3,"dir":"h"},{"r":4,"c":0,"len":3,"dir":"v"},{"r":7,"c":6,"len":2,"dir":"h"},{"r":5,"c":7,"len":2,"dir":"v"}]},{"r":2,"c":2},{"r":2,"c":0},{"r":7,"c":7},{"r":3,"c":7},{"r":5,"c":2},{"r":5,"c":2},{"r":0,"c":0},{"r":0,"c":4},{"r":2,"c":5},{"r":7,"c":6},{"r":2,"c":4},{"r":2,"c":3},{"r":6,"c":0},{"r":3,"c":5},{"r":3,"c":4},{"r":4,"c":2},{"r":1,"c":3},{"r":4,"c":3},{"r":1,"c":7},{"r":5,"c":3},{"r":5,"c":6},{"r":1,"c":6},{"r":4,"c":5},{"r":0,"c":7},{"r":3,"c":1},{"r":4,"c":7},{"r":4,"c":6},{"r":0,"c":6},{"r":0,"c":3},{"r":7,"c":4},{"r":7,"c":0},{"r":3,"c":6},{"r":4,"c":1},{"r":0,"c":2},{"r":6,"c":4},{"r":4,"c":0},{"r":1,"c":1},{"r":3,"c":0},{"r":5,"c":0},{"r":6,"c":7},{"r":1,"c":5},{"r":0,"c":1},{"r":5,"c":1},{"r":1,"c":4},{"r":2,"c":1},{"r":6,"c":3},{"r":7,"c":5},{"r":6,"c":1},{"r":7,"c":2},{"r":6,"c":5},{"r":1,"c":2},{"r":2,"c":6},{"r":5,"c":7},{"r":3,"c":2},{"r":4,"c":4},{"r":7,"c":3},{"r":2,"c":7},{"r":0,"c":5},{"r":5,"c":5},{"r":6,"c":2},{"r":5,"c":4},{"r":7,"c":1},{"r":6,"c":6}],"b":[{"fleet":[{"r":0,"c":7,"len":4,"dir":"v"},{"r":7,"c":0,"len":3,"dir":"h"},{"r":3,"c":3,"len":3,"dir":"h"},{"r":0,"c":0,"len":2,"dir":"v"},{"r":0,"c":7,"len":2,"dir":"h"}]},{"fleet":[{"r":0,"c":7,"len":4,"dir":"v"},{"r":7,"c":0,"len":3,"dir":"h"},{"r":3,"c":3,"len":3,"dir":"h"},{"r":0,"c":0,"len":2,"dir":"v"},{"r":5,"c":5,"len":2,"dir":"h"}]},{"r":2,"c":6},{"r":7,"c":4},{"r":4,"c":3},{"r":3,"c":7},{"r":4,"c":7},{"r":3,"c":6},{"r":6,"c":2},{"r":2,"c":7},{"r":5,"c":4},{"r":7,"c":0},{"r":3,"c":4},{"r":1,"c":6},{"r":7,"c":5},{"r":2,"c":0},{"r":4,"c":5},{"r":7,"c":7},{"r":3,"c":2},{"r":1,"c":3},{"r":5,"c":0},{"r":1,"c":7},{"r":0,"c":5},{"r":4,"c":2},{"r":4,"c":6},{"r":3,"c":3},{"r":7,"c":3},{"r":2,"c":5},{"r":4,"c":1},{"r":2,"c":4},{"r":1,"c":2},{"r":0,"c":2},{"r":2,"c":2},{"r":1,"c":0},{"r":6,"c":1},{"r":6,"c":3},{"r":4,"c":0},{"r":5,"c":1},{"r":4,"c":4},{"r":5,"c":6},{"r":6,"c":6},{"r":5,"c":5},{"r":3,"c":0},{"r":1,"c":4},{"r":7,"c":1},{"r":7,"c":2},{"r":2,"c":3},{"r":6,"c":4},{"r":2,"c":1},{"r":0,"c":6},{"r":5,"c":2},{"r":7,"c":6},{"r":5,"c":7},{"r":0,"c":4},{"r":1,"c":5},{"r":0,"c":7},{"r":1,"c":1},{"r":3,"c":1},{"r":3,"c":5},{"r":6,"c":0},{"r":6,"c":5},{"r":5,"c":3},{"r":6,"c":7},{"r":0,"c":3},{"r":0,"c":0},{"r":0,"c":1}]} };

// The harness blocks Google Fonts. If local copies of the app's fonts are around (npm
// @fontsource/rammetto-one + @fontsource/schibsted-grotesk unpacked into FONTS/r and FONTS/s),
// load them so the screenshots show real text widths. Optional: the test passes without them.
const FONTS = process.env.FONTS || path.join(SHOTS, '..', 'fonts');
async function realFonts(h) {
  const r = path.join(FONTS, 'r/package/files');
  const s = path.join(FONTS, 's/package/files');
  if (!fs.existsSync(r) || !fs.existsSync(s)) return false;
  const files = { rammetto: path.join(r, 'rammetto-one-latin-400-normal.woff2') };
  for (const w of [400, 700, 800, 900]) files[`schibsted-${w}`] = path.join(s, `schibsted-grotesk-latin-${w}-normal.woff2`);
  const faces = `@font-face{font-family:'Rammetto One';src:url(https://fonts.gstatic.com/local/rammetto) format('woff2');font-weight:400}`
    + [400, 700, 800, 900].map((w) => `@font-face{font-family:'Schibsted Grotesk';src:url(https://fonts.gstatic.com/local/schibsted-${w}) format('woff2');font-weight:${w}}`).join('');
  for (const pg of [h.a, h.b]) {
    await pg.route(/fonts\.gstatic\.com\/local\//, (rt) => rt.fulfill({ path: files[rt.request().url().split('/local/')[1]], contentType: 'font/woff2' }));
    await pg.addStyleTag({ content: faces });
  }
  await h.a.evaluate(() => document.fonts.ready);
  return true;
}

// ── (c) rules, straight from the module (same code both phones replay) ──
async function rulesTests() {
  const core = await import(pathToFileURL(path.join(ROOT, 'js/games/core.js')).href);
  await import(pathToFileURL(path.join(ROOT, 'js/games/fleet.js')).href);
  const def = core.gameById('fleet');
  assert(def && def.secret && def.kind === 'turns' && def.platforms.includes('phone') && def.platforms.includes('computer'), 'fleet is a secret turn game for phone + computer');
  const good = [{ r: 0, c: 0, len: 4, dir: 'h' }, { r: 2, c: 0, len: 3, dir: 'h' }, { r: 4, c: 0, len: 3, dir: 'v' }, { r: 7, c: 6, len: 2, dir: 'h' }, { r: 5, c: 7, len: 2, dir: 'v' }];
  const good2 = [{ r: 0, c: 7, len: 4, dir: 'v' }, { r: 7, c: 0, len: 3, dir: 'h' }, { r: 3, c: 3, len: 3, dir: 'h' }, { r: 0, c: 0, len: 2, dir: 'v' }, { r: 5, c: 5, len: 2, dir: 'h' }];
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const rejects = (state, who, mv, re, label) => {
    let msg = null;
    try { def.apply(copy(state), who, copy(mv)); } catch (e) { msg = e.message; }
    assert(msg && re.test(msg), `rejects ${label} ("${msg}")`);
  };
  const s0 = def.init({ first: 'a', seed: 7 });
  assert(sameFleet(def.next(s0), ['a', 'b']), 'placement is simultaneous: both players listed');
  const touching = [{ r: 0, c: 0, len: 4, dir: 'h' }, { r: 1, c: 0, len: 3, dir: 'h' }, { r: 2, c: 0, len: 3, dir: 'h' }, { r: 3, c: 0, len: 2, dir: 'h' }, { r: 4, c: 0, len: 2, dir: 'h' }];
  def.apply(copy(s0), 'a', { fleet: touching });
  console.log('ok - touching ships are allowed');
  rejects(s0, 'a', { fleet: [...good.slice(0, 4), { r: 0, c: 3, len: 2, dir: 'v' }] }, /overlap/i, 'an overlapping fleet');
  rejects(s0, 'a', { fleet: [{ r: 0, c: 5, len: 4, dir: 'h' }, ...good.slice(1)] }, /off the chart/i, 'a ship off the right edge');
  rejects(s0, 'a', { fleet: [...good.slice(0, 4), { r: 7, c: 0, len: 2, dir: 'v' }] }, /off the chart/i, 'a ship off the bottom');
  rejects(s0, 'a', { fleet: [...good.slice(0, 4), { r: -1, c: 3, len: 2, dir: 'h' }] }, /off the chart/i, 'a negative row');
  rejects(s0, 'a', { fleet: [...good.slice(0, 4), { r: 6, c: 3, len: 4, dir: 'h' }] }, /one 4-long, two 3-long and two 2-long/i, 'the wrong ship set (two 4s)');
  rejects(s0, 'a', { fleet: good.slice(0, 4) }, /five ships/i, 'a fleet of four');
  rejects(s0, 'a', { fleet: [...good.slice(0, 4), { r: 6, c: 3, len: 2, dir: 'x' }] }, /doesn.t make sense/i, 'a bad direction');
  rejects(s0, 'a', { r: 1, c: 1 }, /hide your fleet first/i, 'a shot during placement');
  let s1 = def.apply(copy(s0), 'a', { fleet: good });
  rejects(s1, 'a', { fleet: good }, /already in position/i, 'placing twice');
  s1 = def.apply(s1, 'b', { fleet: good2 });
  assert(s1.phase === 'battle' && sameFleet(def.next(s1), ['a']), 'battle starts with first player');
  rejects(s1, 'b', { r: 0, c: 0 }, /not your turn/i, 'shooting out of turn');
  rejects(s1, 'a', { r: 8, c: 0 }, /off the chart/i, 'a shot off the chart');
  rejects(s1, 'a', { r: 1.5, c: 0 }, /off the chart/i, 'a fractional shot');
  const s2 = def.apply(copy(s1), 'a', { r: 0, c: 0 }); // b's 2-ship at A1: hit
  assert(s2.turn === 'a' && s2.shots[0].hit === 1, 'a hit fires again');
  rejects(s2, 'a', { r: 0, c: 0 }, /already fired at A1/i, 'shooting the same cell twice');
  const s3 = def.apply(copy(s2), 'a', { r: 1, c: 0 });
  assert(s3.shots[1].sunk === 3, 'sinking is detected with the ship index');
  const s4 = def.apply(copy(s3), 'a', { r: 6, c: 6 });
  assert(s4.turn === 'b' && s4.shots[2].hit === 0, 'a miss passes the turn');
  assert(sameFleet(def.score(s4), { a: 5, b: 4 }), 'score shows ships afloat');
  // the replay engine drops illegal moves and keeps going
  const m = { first: 'b', seed: 3, lists: { a: [{ fleet: touching }, { r: 6, c: 6 }], b: [{ fleet: [...good.slice(0, 4), { r: 0, c: 3, len: 2, dir: 'v' }] }, { fleet: good2 }, { r: 0, c: 7 }, { r: 0, c: 7 }, { r: 7, c: 7 }] } };
  const d = core.derive(def, m);
  assert(d.rejected.length === 2 && /overlap/i.test(d.rejected[0].error) && /already fired/i.test(d.rejected[1].error), 'engine replay rejects the overlap and the repeat shot');
  assert(sameFleet(d.state.fleets.b, good2) && d.state.shots.length === 3 && d.state.turn === 'a', 'engine replay keeps the legal moves');

  // ── saved matches keep replaying: a full classic log recorded with the rules as they were
  // before rule sets existed (commit 6e9fee4) derives to the very same state, byte for byte
  const gm = { first: 'b', seed: 12345, lists: GOLDEN.lists };
  const gd = core.derive(def, gm);
  const hash = crypto.createHash('sha256').update(JSON.stringify(gd.state)).digest('hex');
  assert(hash === GOLDEN.hash && gd.count === 128 && gd.rejected.length === 2, `an old classic match replays to the identical state (${gd.count} moves, sha ${hash.slice(0, 10)})`);
  assert(gd.result.winner === 'b' && gd.result.sub.startsWith(GOLDEN.sub), 'an old classic match has the same winner and result line');
  assert(gd.state.mode === undefined && !gd.state.kit && !gd.state.scans, 'an old match carries no rule-set fields');

  // ── rule sets: { rules } before any fleet is hidden
  let r0 = def.apply(copy(s0), 'b', { rules: 'salvo' });
  assert(r0.mode === 'salvo' && r0.modeBy === 'b' && sameFleet(def.next(r0), ['a', 'b']), 'either player can pick the rules first; placement stays open to both');
  rejects(r0, 'a', { rules: 'arsenal' }, /already set: Salvo/i, 'a second rules pick');
  rejects(s0, 'a', { rules: 'chess' }, /don.t exist/i, 'unknown rules');
  rejects(s1, 'a', { rules: 'salvo' }, /battle|off the chart/i, 'a rules pick during the battle');
  const sa = def.apply(copy(s0), 'a', { fleet: good });
  rejects(sa, 'b', { rules: 'salvo' }, /too late/i, 'a rules pick after a fleet is hidden');
  // replay order decides a race the same way on both phones: the first player's moves go first
  const race = core.derive(def, { first: 'a', seed: 1, lists: { a: [{ fleet: good }], b: [{ rules: 'salvo' }, { fleet: good2 }] } });
  assert(race.state.phase === 'battle' && !race.state.mode && race.rejected.length === 1, 'a pick that loses the race to a hidden fleet is dropped and the match stays Classic');
  const race2 = core.derive(def, { first: 'b', seed: 1, lists: { a: [{ rules: 'arsenal' }, { fleet: good }], b: [{ rules: 'salvo' }, { fleet: good2 }] } });
  assert(race2.state.mode === 'salvo' && race2.rejected.length === 1, 'two picks at once: the first player’s pick wins on every phone');

  // ── Salvo
  let sv = def.apply(def.apply(def.apply(copy(s0), 'a', { rules: 'salvo' }), 'a', { fleet: good }), 'b', { fleet: good2 });
  assert(sv.phase === 'battle' && sv.turn === 'a', 'Salvo battle starts with the first player');
  rejects(sv, 'a', { r: 0, c: 0 }, /pick 5 squares/i, 'a single shot in Salvo');
  rejects(sv, 'a', { salvo: [[0, 0], [1, 0], [2, 2]] }, /salvo is 5 shots/i, 'a salvo of the wrong size');
  rejects(sv, 'a', { salvo: [[0, 0], [0, 0], [1, 1], [2, 2], [3, 3]] }, /twice/i, 'a salvo with a repeat square');
  rejects(sv, 'a', { salvo: [[0, 0], [1, 1], [2, 2], [3, 3], [8, 8]] }, /off the chart/i, 'a salvo off the chart');
  sv = def.apply(sv, 'a', { salvo: [[0, 0], [1, 0], [7, 7], [6, 6], [5, 5]] }); // sinks b's 2-ship (A1-A2), hits 5,5
  assert(sv.shots.length === 5 && sv.turn === 'b' && sv.shots[1].sunk === 3 && sv.shots[4].hit === 1, 'a salvo fires all five, sinks and hits, then passes the turn (even after hits)');
  rejects(sv, 'b', { salvo: [[0, 0], [0, 1], [0, 2], [0, 3], [7, 7]] }, /salvo is 4 shots/i, 'a five-shot salvo from a player who just lost a ship');
  sv = def.apply(sv, 'b', { salvo: [[0, 0], [0, 1], [0, 2], [0, 3]] }); // sinks a's 4-ship
  assert(sv.turn === 'a' && def.score(sv).a === 4, 'Salvo: losing a ship...');
  rejects(sv, 'a', { salvo: [[3, 0], [3, 1], [3, 2], [3, 3], [3, 4]] }, /salvo is 4 shots/i, '...means one shot fewer next salvo');
  rejects(sv, 'a', { salvo: [[0, 0], [3, 1], [3, 2], [3, 3]] }, /already fired at A1/i, 'a salvo at a square already fired at');

  // ── Arsenal
  let ar = def.apply(def.apply(def.apply(copy(s0), 'b', { rules: 'arsenal' }), 'a', { fleet: good }), 'b', { fleet: good2 });
  assert(sameFleet(ar.kit, { a: { sonar: 1, torp: 1 }, b: { sonar: 1, torp: 1 } }), 'Arsenal: one sonar and one torpedo each');
  ar = def.apply(ar, 'a', { sonar: [1, 1] }); // b ships near B2: A1, A2 (2-ship) -> 2 squares
  assert(ar.scans.length === 1 && ar.scans[0].n === 2 && ar.turn === 'a' && ar.kit.a.sonar === 0 && ar.shots.length === 0, 'a sonar ping counts the ship squares around it and is free');
  rejects(ar, 'a', { sonar: [5, 5] }, /no sonar/i, 'a ping with no sonar left');
  rejects(s1, 'a', { sonar: [1, 1] }, /no kit/i, 'a ping outside Arsenal');
  ar = def.apply(ar, 'a', { r: 0, c: 0 });
  ar = def.apply(ar, 'a', { torp: [1, 0, 'v'] }); // A1 (already hit: skipped), A2 hit+sink, A3 miss
  const torp = ar.shots.filter((x) => x.t === 'torp');
  assert(torp.length === 2 && torp[0].r === 1 && torp[0].sunk === 3 && torp[1].hit === 0 && ar.turn === 'a' && ar.kit.a.torp === 0, 'a torpedo fires its line, skips squares already hit, and a hit keeps the turn');
  assert(ar.kit.b.sonar === 2 && torp[0].kit === 'sonar', 'losing a ship gives that player +1 sonar');
  rejects(ar, 'a', { torp: [5, 5, 'h'] }, /no torpedoes/i, 'a torpedo with none left');
  ar = def.apply(ar, 'a', { r: 6, c: 6 }); // miss
  assert(ar.turn === 'b', 'Arsenal: a miss passes the turn');
  ar = def.apply(ar, 'b', { r: 0, c: 0 }); ar = def.apply(ar, 'b', { r: 0, c: 1 });
  assert(ar.kit.b.torp === 1, 'two hits in a row: no bonus yet');
  ar = def.apply(ar, 'b', { r: 0, c: 2 });
  assert(ar.kit.b.torp === 2 && ar.shots[ar.shots.length - 1].bonus === 'torp', 'three hits in a row earn a torpedo');
  ar = def.apply(ar, 'b', { r: 0, c: 3 }); // sinks a's 4-ship: a gets a sonar
  ar = def.apply(ar, 'b', { torp: [3, 6, 'h'] }); // F4 G4 H4: all water
  assert(ar.turn === 'a' && ar.kit.b.torp === 1 && ar.kit.a.sonar === 1, 'a torpedo that only finds water passes the turn; a sunk ship pays its owner a sonar');
  const edge = def.apply(def.apply(def.apply(def.apply(copy(s0), 'a', { rules: 'arsenal' }), 'a', { fleet: good }), 'b', { fleet: good2 }), 'a', { torp: [0, 7, 'h'] });
  assert(edge.shots.length === 2 && edge.shots.every((x) => x.t === 'torp') && edge.shots[1].hit === 1 && edge.turn === 'a', 'a torpedo at the edge fires only the squares on the chart');
  rejects(ar, 'a', { torp: [3, 3, 'x'] }, /off the chart/i, 'a torpedo with no direction');
  return { def, core };
}

// ── UI helpers ──
async function fleetState(h, pg, id) { return (await h.engine(pg, id)).state; }
async function waitSynced(h, id, total, ms = 6000) {
  const t0 = Date.now();
  for (;;) {
    const ea = await h.engine(h.a, id);
    const eb = await h.engine(h.b, id);
    const n = (e) => (e ? e.lists.a.length + e.lists.b.length : -1);
    if (n(ea) === total && n(eb) === total) return [ea, eb];
    if (Date.now() - t0 > ms) throw new Error(`FAIL: phones did not sync to ${total} moves (a=${n(ea)}, b=${n(eb)})`);
    await h.wait(40);
  }
}
async function gridBox(pg, sel = '.g-fleet .is-edit .fl-grid') {
  const b = await pg.$eval(sel, (g) => { const r = g.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
  return { ...b, cs: b.w / N };
}
async function dragMouse(pg, i, r, c) {
  const ship = await pg.$(`.g-fleet [data-ship="${i}"]`);
  const sb = await ship.boundingBox();
  const g = await gridBox(pg);
  const x0 = sb.x + g.cs / 2;
  const y0 = sb.y + sb.height / 2;
  await pg.mouse.move(x0, y0);
  await pg.mouse.down();
  await pg.mouse.move(x0 + 5, y0 - 5, { steps: 2 });
  await pg.mouse.move(g.x + (c + 0.5) * g.cs, g.y + (r + 0.5) * g.cs, { steps: 10 });
  await pg.mouse.up();
  await pg.waitForTimeout(80);
}
async function dragTouch(pg, i, r, c) {
  const cdp = await pg.context().newCDPSession(pg);
  const ship = await pg.$(`.g-fleet [data-ship="${i}"]`);
  const sb = await ship.boundingBox();
  const g = await gridBox(pg);
  const p0 = { x: sb.x + g.cs / 2, y: sb.y + sb.height / 2 };
  const p1 = { x: g.x + (c + 0.5) * g.cs, y: g.y + (r + 0.5) * g.cs };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p0] });
  for (let k = 1; k <= 10; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p0.x + ((p1.x - p0.x) * k) / 10, y: p0.y + ((p1.y - p0.y) * k) / 10 }] });
    await pg.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await pg.waitForTimeout(80);
}
const placedShips = (pg) => pg.$$eval('.g-fleet .is-edit .fl-ship', (xs) => xs.map((x) => ({ i: +x.dataset.ship, style: x.getAttribute('style').replace(/;--k:\d+/, '') })));
const dockShips = (pg) => pg.$$eval('.g-fleet .fl-dock-ship', (xs) => xs.map((x) => +x.dataset.ship));

/** Hold a finger still on `sel` for `ms` (a real touch: touchstart … touchend). */
async function longPress(pg, sel, ms = 850) {
  const box = await (await pg.$(sel)).boundingBox();
  const p = { x: box.x + Math.min(48, box.width / 2), y: box.y + box.height / 2 };
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
  await pg.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await pg.waitForTimeout(80);
}
const scopes = (pg) => pg.$$eval('#game-root .g-fleet .fl-scope', (xs) => xs.map((x) => x.getAttribute('style')).sort());
/** Record every db call, room call, storage write and fetch a page makes from now on. */
async function spy(pg) {
  await pg.evaluate(() => {
    if (window.__spyLog) { window.__spyLog.length = 0; return; }
    const log = (window.__spyLog = []);
    for (const name of ['__db', '__room']) { const f = window[name]; window[name] = (...args) => { log.push([name, ...args.map(String)]); return f(...args); }; }
    for (const m of ['setItem', 'removeItem', 'clear']) { const f = Storage.prototype[m]; Storage.prototype[m] = function (...args) { log.push([m, ...args.map(String)]); return f.apply(this, args); }; }
    const ff = window.fetch; window.fetch = (...args) => { log.push(['fetch', String(args[0])]); return ff(...args); };
    if (navigator.sendBeacon) { const sb = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = (...args) => { log.push(['beacon', String(args[0])]); return sb(...args); }; }
  });
}
const spied = (pg) => pg.evaluate(() => (window.__spyLog || []).map((x) => x.join(' ')));
/** Everything that could carry a trace: the shared db, room presence, both phones' storage, Sydney's screen. */
async function traces(h) {
  const store = (pg) => pg.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
  const presence = JSON.stringify(Object.fromEntries(Object.entries(h.roomState).map(([k, m]) => [k, [...m.values()].map((p) => p.presence)])));
  return {
    docs: JSON.stringify(h.docs),
    presence,
    storeA: await store(h.a),
    storeB: await store(h.b),
    screenB: await h.b.$eval('#game-root', (el) => el.innerHTML),
    statusA: await h.a.textContent('#game-root .gm-status'),
    toastsA: await h.a.$$eval('.toast', (x) => x.length),
  };
}

/** (d) Nothing about `viewer`'s opponent's unsunk ships may be in the DOM. Own fleet must be exactly the viewer's. */
async function checkNoLeak(h, pg, id, viewer, label, { scope = false } = {}) {
  const st = await fleetState(h, pg, id);
  const foe = other(viewer);
  const dom = await pg.evaluate(() => {
    const root = document.querySelector('#game-root .g-fleet');
    if (!root) return null;
    const pick = (sel) => [...root.querySelectorAll(sel)].map((s) => ({ style: (s.getAttribute('style') || '').replace(/;--(k|d):[^;]*/g, ''), cls: s.className }));
    return {
      viewer: root.dataset.viewer || null,
      target: pick('.fl-target .fl-ship'),
      home: pick('.fl-home .fl-ship, .is-edit .fl-ship'),
      allShips: root.querySelectorAll('.fl-ship').length,
      ghosts: root.querySelectorAll('.fl-ghost').length,
      cells: [...root.querySelectorAll('.fl-target .fl-cell')].map((b) => ({ r: +b.dataset.r, c: +b.dataset.c, cls: b.className, html: b.innerHTML, label: b.getAttribute('aria-label'), attrs: b.getAttributeNames().sort().join() })),
      marks: [...root.querySelectorAll('.fl-target .fl-mark')].map((m) => m.getAttribute('style').replace(/;--d:[^;]*/, '')),
      scopes: root.querySelectorAll('.fl-scope').length,
      text: root.textContent,
    };
  });
  if (!dom) throw new Error(`FAIL: no board (${label})`);
  if (dom.viewer !== viewer) throw new Error(`FAIL: board is drawn for ${dom.viewer}, expected ${viewer} (${label})`);
  if (!scope && dom.scopes) throw new Error(`FAIL: ${dom.scopes} periscope outlines in the DOM (${label})`);
  const myFleet = st.fleets[viewer];
  const foeFleet = st.fleets[foe];
  const sunk = new Set(st.shots.filter((x) => x.by === viewer && x.sunk >= 0).map((x) => x.sunk));
  const over = st.phase === 'over';
  // own fleet: exactly mine (or nothing/draft during placement)
  if (myFleet && st.phase !== 'place') {
    const want = myFleet.map(posStyle).sort();
    const got = dom.home.map((x) => x.style).sort();
    if (!sameFleet(want, got)) throw new Error(`FAIL: own fleet drawn wrong (${label}): ${got} vs ${want}`);
  }
  if (!foeFleet) return;
  // the target chart: only sunk enemy ships (all of them once the game is over)
  const allowed = new Set(foeFleet.filter((_, i) => over || sunk.has(i)).map(posStyle));
  for (const s of dom.target) if (!allowed.has(s.style)) throw new Error(`FAIL: an unsunk enemy ship is in the DOM (${label}): ${s.style}`);
  if (!over && dom.target.length !== sunk.size) throw new Error(`FAIL: ${dom.target.length} enemy ships drawn but ${sunk.size} sunk (${label})`);
  if (dom.allShips !== dom.target.length + dom.home.length + dom.ghosts) throw new Error(`FAIL: stray ship elements in the DOM (${label})`);
  // unshot cells all look identical, whatever is under them
  const shotSet = new Set(st.shots.filter((x) => x.by === viewer).map((x) => x.r * N + x.c));
  const plain = dom.cells.filter((x) => !shotSet.has(x.r * N + x.c));
  const shapes = new Set(plain.map((x) => `${x.cls.replace(/ is-(aim|pick|zone|core)/g, '')}|${x.html}|${x.attrs}`));
  if (shapes.size > 1) throw new Error(`FAIL: unshot cells differ (${label}): ${[...shapes].join(' / ')}`);
  for (const x of plain) if (x.label !== LETTERS[x.c] + (x.r + 1)) throw new Error(`FAIL: unshot cell label leaks (${label}): ${x.label}`);
  if (dom.marks.length !== shotSet.size) throw new Error(`FAIL: ${dom.marks.length} marks for ${shotSet.size} shots (${label})`);
}

/** Pick the next shot for `w`: hit, hit, miss pattern (or as given), using the engine's truth. */
function nextShot(st, w, pattern) {
  const foeFleet = st.fleets[other(w)];
  const shot = new Set(st.shots.filter((x) => x.by === w).map((x) => x.r * N + x.c));
  const shipCells = foeFleet.flatMap(cellsOf).filter(([r, c]) => !shot.has(r * N + c));
  const occ = new Set(foeFleet.flatMap(cellsOf).map(([r, c]) => r * N + c));
  const water = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!occ.has(r * N + c) && !shot.has(r * N + c)) water.push([r, c]);
  let run = 0;
  for (let i = st.shots.length - 1; i >= 0 && st.shots[i].by === w; i--) run++;
  const wantHit = run < pattern[w];
  return wantHit && shipCells.length ? shipCells[0] : water.length ? water[(st.shots.length * 7) % water.length] : shipCells[0];
}

async function fire(pg, r, c, how = 'click') {
  const sel = `.g-fleet .fl-target .fl-cell[data-r="${r}"][data-c="${c}"]`;
  if (how === 'tap') await pg.tap(sel); else await pg.click(sel);
}

/** Screenshots at CSS scale. Default 390×844; opts.width for other sizes (then back to `base`). */
async function shotsAt(h, pages, name, opts = {}) {
  for (const [w, pg] of Object.entries(pages)) {
    const base = pg.viewportSize();
    await pg.setViewportSize({ width: opts.width || 390, height: opts.height || 844 });
    await pg.waitForTimeout(60);
    if (opts.bottom) await pg.evaluate(() => { const r = document.getElementById('game-root'); if (r) r.scrollTop = r.scrollHeight; });
    await h.shot(pg, path.join(SHOTS, `${name}-${w}${opts.width ? '-' + opts.width : ''}.png`), { scale: 'css', ...(opts.full ? { fullPage: true } : {}) });
    await pg.setViewportSize(base);
  }
}

// ── (a) online game ──
async function onlineGame(h, { scheme = 'light', drag = true } = {}) {
  const { a, b } = h;
  const id = await h.newOnlineGame(a, 'fleet');
  assert(!!id, `[${scheme}] online match created`);
  await h.openMatch(b, id);
  await h.settle();
  // Sydney: Shuffle, then Ready
  await b.waitForSelector('.g-fleet .fl-dock-ship');
  assert((await dockShips(b)).length === 5, `[${scheme}] five ships wait in the dock`);
  await b.click('.g-fleet [data-fl="shuffle"]');
  assert((await placedShips(b)).length === 5, `[${scheme}] Shuffle places all five`);
  await b.click('.g-fleet [data-fl="shuffle"]');
  await b.click('.g-fleet [data-fl="ready"]');
  await waitSynced(h, id, 1);
  await b.waitForSelector('.g-fleet .fl-wait');
  assert(/Waiting for Emerson/.test(await b.textContent('.g-fleet')), `[${scheme}] Sydney waits for Emerson`);
  const waitShips = await b.$$eval('.g-fleet .fl-wait .fl-ship', (xs) => xs.filter((x) => x.getBoundingClientRect().width > 10).length);
  assert(waitShips === 5, `[${scheme}] Sydney's waiting screen shows her own fleet`);
  if (scheme === 'light') await shotsAt(h, { b }, `${scheme}-waiting`);
  // Emerson: place by hand
  await a.waitForSelector('.g-fleet .fl-note');
  assert(/Sydney is ready/.test(await a.textContent('.g-fleet .fl-note')), `[${scheme}] Emerson sees Sydney is ready`);
  const aShips = await a.$$eval('.g-fleet .fl-ship', (x) => x.length);
  assert(aShips === 0, `[${scheme}] none of Sydney's ships are drawn on Emerson's placement screen`);
  if (drag) {
    await dragTouch(a, 0, 0, 0); // 4-long by touch drag to A1 across
    let ps = await placedShips(a);
    assert(ps.length === 1 && ps[0].i === 0 && ps[0].style === posStyle({ r: 0, c: 0, len: 4, dir: 'h' }), `[${scheme}] touch-drag placed the 4-ship at A1`);
    await dragMouse(a, 1, 2, 1); // 3-long by mouse drag to B3
    ps = await placedShips(a);
    assert(ps.some((x) => x.i === 1 && x.style === posStyle({ r: 2, c: 1, len: 3, dir: 'h' })), `[${scheme}] mouse-drag placed a 3-ship at B3`);
    // drag a placed ship to move it
    await dragMouse(a, 1, 2, 0);
    ps = await placedShips(a);
    assert(ps.some((x) => x.i === 1 && x.style === posStyle({ r: 2, c: 0, len: 3, dir: 'h' })), `[${scheme}] dragging a placed ship moves it`);
    // tap-to-place: pick ship 2 in the dock, tap E1 → across at A5
    await a.tap('.g-fleet .fl-dock-ship[data-ship="2"]');
    await a.tap('.g-fleet .is-edit .fl-cell[data-r="4"][data-c="0"]');
    ps = await placedShips(a);
    assert(ps.some((x) => x.i === 2 && x.style === posStyle({ r: 4, c: 0, len: 3, dir: 'h' })), `[${scheme}] tap-to-place put a 3-ship at A5`);
    // tap the placed ship (on its first square) to turn it
    const g = await gridBox(a);
    await a.touchscreen.tap(g.x + 0.5 * g.cs, g.y + 4.5 * g.cs);
    await a.waitForTimeout(60);
    ps = await placedShips(a);
    assert(ps.some((x) => x.i === 2 && x.style === posStyle({ r: 4, c: 0, len: 3, dir: 'v' })), `[${scheme}] tapping a ship turns it`);
    // overlap via the UI is refused: drag a 2-ship onto the 4-ship
    await dragMouse(a, 3, 0, 1);
    assert((await dockShips(a)).includes(3) && (await placedShips(a)).length === 3, `[${scheme}] dropping onto another ship is refused`);
    await shotsAt(h, { a }, `${scheme}-placement`);
    await shotsAt(h, { a }, `${scheme}-placement`, { width: 360, height: 740 });
    // tap the remaining two into place
    await a.tap('.g-fleet .is-edit .fl-cell[data-r="7"][data-c="6"]');
    await a.tap('.g-fleet .is-edit .fl-cell[data-r="5"][data-c="6"]');
    ps = await placedShips(a);
    assert(ps.length === 5, `[${scheme}] all five placed by hand`);
  } else {
    await a.click('.g-fleet [data-fl="shuffle"]');
  }
  const draftStyles = (await placedShips(a)).map((x) => x.style).sort();
  await a.click('.g-fleet [data-fl="ready"]');
  const [ea0, eb0] = await waitSynced(h, id, 2);
  assert(ea0.state.phase === 'battle' && eb0.state.phase === 'battle', `[${scheme}] both phones move to battle`);
  assert(sameFleet(ea0.state.fleets.a.map(posStyle).sort(), draftStyles), `[${scheme}] Emerson's fleet is what was placed on screen`);
  assert(sameFleet(ea0.state, eb0.state), `[${scheme}] both phones agree on the fleets`);
  await h.wait(300);

  // battle
  const pages = { a, b };
  const pattern = { a: 2, b: 1 }; // hits per turn before a deliberate miss
  let total = 2;
  let n = 0;
  let midShot = false;
  let checkedTwice = false;
  for (;;) {
    const e = await h.engine(a, id);
    if (e.over) break;
    const w = e.acts[0];
    const shooter = pages[w];
    const waiter = pages[other(w)];
    await shooter.waitForSelector('.g-fleet .fl-target.is-live');
    if (n % 3 === 0) {
      await checkNoLeak(h, a, id, 'a', `online shot ${n}, Emerson`);
      await checkNoLeak(h, b, id, 'b', `online shot ${n}, Sydney`);
    }
    // (c) via the UI: the waiting phone can't shoot; a used square can't be shot again
    if (n === 4) {
      const anyCell = '.g-fleet .fl-target .fl-cell[data-r="7"][data-c="7"]';
      assert(await waiter.$eval(anyCell, (x) => x.disabled), 'the waiting phone’s chart is locked');
      await waiter.click(anyCell, { force: true }).catch(() => {});
      await h.wait(150);
      const e2 = await h.engine(a, id);
      assert(e2.lists.a.length + e2.lists.b.length === total, 'an out-of-turn tap adds no move');
    }
    if (!checkedTwice) {
      const used = e.state.shots.find((x) => x.by === w);
      if (used) {
        checkedTwice = true;
        const sel = `.g-fleet .fl-target .fl-cell[data-r="${used.r}"][data-c="${used.c}"]`;
        assert(await shooter.$eval(sel, (x) => x.disabled), 'a square already fired at is locked');
        await shooter.click(sel, { force: true }).catch(() => {});
        await h.wait(150);
        const e2 = await h.engine(a, id);
        assert(e2.lists.a.length + e2.lists.b.length === total, 'tapping a used square adds no move');
      }
    }
    const [r, c] = nextShot(e.state, w, pattern);
    await fire(shooter, r, c, n % 2 ? 'tap' : 'click');
    total++;
    n++;
    await waitSynced(h, id, total);
    if (!midShot && e.state.shots.filter((x) => x.sunk >= 0).length >= 2) {
      midShot = true;
      await h.wait(700);
      await shotsAt(h, pages, `${scheme}-battle`);
      await shotsAt(h, pages, `${scheme}-battle`, { width: 360, height: 740 });
    }
  }
  const [ea, eb] = await waitSynced(h, id, total);
  assert(ea.over && eb.over, `[${scheme}] the battle ends on both phones`);
  assert(sameFleet(ea.state, eb.state) && ea.result.winner === eb.result.winner, `[${scheme}] both phones agree on every shot and the winner (${ea.result.winner})`);
  assert(ea.state.shots.filter((x) => x.by === ea.result.winner && x.sunk >= 0).length === 5, `[${scheme}] the winner sank all five`);
  await checkNoLeak(h, a, id, 'a', 'game over, Emerson');
  await checkNoLeak(h, b, id, 'b', 'game over, Sydney');
  await h.wait(500);
  await shotsAt(h, pages, `${scheme}-sinking`);
  await h.wait(1700);
  assert(await a.isVisible('#game-root .gm-end') && await b.isVisible('#game-root .gm-end'), `[${scheme}] end card on both phones`);
  await shotsAt(h, pages, `${scheme}-end`);
  // see the board
  await a.click('#game-root [data-g="end-look"]');
  await b.click('#game-root [data-g="end-look"]');
  await h.wait(1200);
  await shotsAt(h, pages, `${scheme}-final-board`);
  await shotsAt(h, pages, `${scheme}-final-board`, { width: 360, height: 740 });
  return { id, winner: ea.result.winner };
}

// ── (b) same phone ──
async function localGame(h) {
  const pg = h.a;
  await h.newLocalGame(pg, 'fleet');
  const curtainUp = () => pg.isVisible('#game-root .gm-curtain');
  const id = await pg.evaluate(() => window.__lastMatchId);
  let curtains = 0;
  const atCurtain = async (label) => {
    assert(await curtainUp(), `curtain is up ${label}`);
    const ships = await pg.$$eval('#game-root .fl-ship, #game-root .fl-dock-ship, #game-root .fl-ghost', (x) => x.length);
    if (ships !== 0) throw new Error(`FAIL: ${ships} ship elements in the DOM behind the curtain (${label})`);
    curtains++;
    await pg.click('#game-root [data-g="reveal"]');
    await pg.waitForSelector('#game-root .g-fleet[data-viewer]');
  };
  let e = await h.engine(pg, id);
  const first = e.first;
  await shotsAt(h, { a: pg }, 'local-curtain');
  await atCurtain('before the first player places');
  assert(await pg.$eval('.g-fleet', (x) => x.dataset.viewer) === first, 'first player places first');
  await pg.click('.g-fleet [data-fl="shuffle"]');
  await pg.click('.g-fleet [data-fl="ready"]');
  await atCurtain('between the two placements');
  assert(await pg.$eval('.g-fleet', (x) => x.dataset.viewer) === other(first), 'second player places next');
  assert(await pg.$$eval('.g-fleet .fl-ship', (x) => x.length) === 0, 'second player starts with an empty chart (no sign of the first fleet)');
  await pg.tap('.g-fleet .is-edit .fl-cell[data-r="0"][data-c="0"]');
  assert((await placedShips(pg)).length === 1, 'tap-to-place works on one phone');
  await pg.click('.g-fleet [data-fl="shuffle"]');
  await pg.click('.g-fleet [data-fl="ready"]');
  e = await h.engine(pg, id);
  assert(e.state.phase === 'battle', 'battle begins after both fleets are in');
  const pattern = { a: 2, b: 2 };
  await pg.emulateMedia({ reducedMotion: 'reduce' });
  let motionChecked = false;
  let missChecked = false;
  let localShot = false;
  for (let n = 0; n < 200; n++) {
    e = await h.engine(pg, id);
    if (e.over) break;
    const w = e.acts[0];
    if (await curtainUp()) await atCurtain(`before ${w} shoots (shot ${n})`);
    await checkNoLeak(h, pg, id, w, `same-phone shot ${n}`);
    const [r, c] = nextShot(e.state, w, pattern);
    const before = e.lists.a.length + e.lists.b.length;
    const isMiss = !e.state.fleets[other(w)].some((s) => cellsOf(s).some(([rr, cc]) => rr === r && cc === c));
    await fire(pg, r, c, 'tap');
    if (isMiss && !missChecked) {
      // a miss hands the phone over, but the shooter sees the splash first
      missChecked = true;
      await h.wait(80);
      assert(!(await curtainUp()), 'same phone: no curtain the instant you miss');
      assert(await pg.$eval('.g-fleet .fl-target .fl-mark.is-miss.is-last', (m, at) => m.getAttribute('style').startsWith(at), `--r:${r};--c:${c};`).catch(() => false), 'same phone: the splash shows where you missed');
      assert(/pass the phone/i.test(await pg.textContent('.g-fleet .fl-log')), 'same phone: the log says to pass the phone');
      assert((await h.engine(pg, id)).lists[w].length === e.lists[w].length, 'same phone: the miss is played after the splash, not before');
    }
    for (let t = 0; t < 100; t++) { const x = await h.engine(pg, id); if (x.lists.a.length + x.lists.b.length > before) break; await h.wait(40); }
    if (isMiss) { await h.wait(60); if (!(await curtainUp()) && !(await h.engine(pg, id)).over) throw new Error('FAIL: same phone: the curtain comes down after a miss'); }
    if (!motionChecked && !(await curtainUp())) {
      motionChecked = true;
      const anim = await pg.$eval('.g-fleet .fl-mark.is-new', (m) => getComputedStyle(m.querySelector('svg')).animationName + '|' + getComputedStyle(m).animationName);
      assert(anim === 'none|none', 'reduced motion: new shots appear without animation');
      await pg.emulateMedia({ reducedMotion: 'no-preference' });
    }
    if (n >= 14 && !localShot && !(await curtainUp())) { localShot = true; await h.wait(400); await shotsAt(h, { a: pg }, 'local-battle'); }
  }
  e = await h.engine(pg, id);
  assert(e.over && (e.result.winner === 'a' || e.result.winner === 'b'), `same-phone game ends (${e.result.winner} wins)`);
  assert(curtains >= 6, `the curtain came down between players (${curtains} times)`);
  assert(!(await curtainUp()), 'no curtain once the game is over');
  await h.wait(2100);
  assert(await pg.isVisible('#game-root .gm-end'), 'same-phone end card');
  await h.closeGame(pg);
  await h.settle();
}

// After a reconnect a pile of moves can land at once: only the latest volley replays.
async function pileOfShots(h) {
  const { a, b } = h;
  const id = await h.newOnlineGame(a, 'fleet');
  await h.openMatch(b, id);
  await h.settle();
  const fleets = {
    a: [{ r: 0, c: 0, len: 4, dir: 'h' }, { r: 2, c: 0, len: 3, dir: 'h' }, { r: 4, c: 0, len: 3, dir: 'v' }, { r: 7, c: 6, len: 2, dir: 'h' }, { r: 5, c: 7, len: 2, dir: 'v' }],
    b: [{ r: 0, c: 7, len: 4, dir: 'v' }, { r: 7, c: 0, len: 3, dir: 'h' }, { r: 3, c: 3, len: 3, dir: 'h' }, { r: 0, c: 0, len: 2, dir: 'v' }, { r: 5, c: 5, len: 2, dir: 'h' }],
  };
  const water = (w) => { const occ = new Set(fleets[other(w)].flatMap(cellsOf).map(([r, c]) => r * N + c)); const out = []; for (let i = 0; i < N * N; i++) if (!occ.has(i)) out.push({ r: Math.floor(i / N), c: i % N }); return out; };
  const first = h.matches().find((m) => m.id === id).first;
  const lists = { a: [{ fleet: fleets.a }], b: [{ fleet: fleets.b }] };
  for (let k = 0; k < 10; k++) { const w = k % 2 ? other(first) : first; lists[w].push(water(w)[k]); } // ten misses, alternating
  await a.evaluate(([mid, L]) => globalThis.claude.use('db').then((db) => db.doc('matches/' + mid).update({ a: JSON.stringify(L.a), b: JSON.stringify(L.b) })), [id, lists]);
  await waitSynced(h, id, 12);
  await h.wait(100);
  for (const pg of [a, b]) {
    const fresh = await pg.$$eval('.g-fleet .fl-mark.is-new', (xs) => xs.length);
    assert(fresh === 1, `ten shots landing at once replay only the latest one (${fresh} new on ${pg === a ? 'Emerson' : 'Sydney'}’s phone)`);
  }
  await h.closeGame(a); await h.closeGame(b);
}

// Same phone: closing the game during a miss's splash still plays that shot.
async function missThenClose(h) {
  const pg = h.a;
  await h.newLocalGame(pg, 'fleet');
  const id = await pg.evaluate(() => window.__lastMatchId);
  for (let i = 0; i < 2; i++) {
    await pg.click('#game-root [data-g="reveal"]');
    await pg.click('.g-fleet [data-fl="shuffle"]');
    await pg.click('.g-fleet [data-fl="ready"]');
  }
  await pg.click('#game-root [data-g="reveal"]');
  const e = await h.engine(pg, id);
  const w = e.acts[0];
  const [r, c] = nextShot(e.state, w, { a: 0, b: 0 }); // water
  await fire(pg, r, c, 'tap');
  await h.closeGame(pg);
  await h.wait(100);
  await h.openMatch(pg, id);
  const e2 = await h.engine(pg, id);
  const last = e2.state.shots[e2.state.shots.length - 1];
  assert(e2.state.shots.length === 1 && last.by === w && last.r === r && last.c === c && !last.hit, 'same phone: closing mid-splash still plays the miss');
  assert(await pg.isVisible('#game-root .gm-curtain'), 'same phone: reopening after that miss shows the curtain for the other player');
  await h.closeGame(pg);
}

const cellSel = (r, c) => `.g-fleet .fl-target .fl-cell[data-r="${r}"][data-c="${c}"]`;
const movesOf = (e) => e.lists.a.length + e.lists.b.length;
const RECORD_KEY = /^(a|b)_(fs_(classic|salvo|arsenal)_(best|id)|run_(best|id)|ws_(best|id))$|^streak$/;

// ── Emerson's periscope: works for him, does nothing for Sydney, leaves no trace ──
async function periscope(h) {
  const { a, b } = h;
  const head = '.g-fleet .fl-target .fl-head';
  const id = await h.newOnlineGame(a, 'fleet');
  await h.openMatch(b, id);
  await h.settle();
  await b.click('.g-fleet [data-fl="shuffle"]');
  await b.click('.g-fleet [data-fl="ready"]');
  await waitSynced(h, id, 1);
  await a.click('.g-fleet [data-fl="shuffle"]');
  await a.click('.g-fleet [data-fl="ready"]');
  await waitSynced(h, id, 2);
  await h.wait(2300); // the "Battle stations" stamps come and go
  const herAfloat = (s) => s.fleets.b.filter((_, i) => !s.shots.some((x) => x.by === 'a' && x.sunk === i)).map(posStyle).sort();
  let st = (await h.engine(a, id)).state;
  assert((await scopes(a)).length === 0, '[periscope] off until Emerson asks for it');

  // Sydney: the same long press on her phone does nothing
  await longPress(b, head);
  assert((await scopes(b)).length === 0, '[periscope] Sydney’s long press on the same heading shows nothing');
  await checkNoLeak(h, b, id, 'b', 'Sydney after her long press');
  // a plain tap on the heading does nothing
  await a.tap(head);
  assert((await scopes(a)).length === 0, '[periscope] a plain tap on the heading does nothing');

  // Emerson: hold the heading over Sydney's waters
  await spy(a);
  await spy(b);
  const before = await traces(h);
  await longPress(a, head);
  assert(sameFleet(await scopes(a), herAfloat(st)), '[periscope] Emerson’s long press outlines all five of Sydney’s ships, exactly where they are');
  await checkNoLeak(h, a, id, 'a', 'Emerson with the periscope up', { scope: true });
  await h.wait(400);
  const after = await traces(h);
  for (const k of Object.keys(before)) assert(before[k] === after[k], `[periscope] leaves no trace: ${k} unchanged`);
  const logA = await spied(a);
  const logB = await spied(b);
  assert(!logA.length, `[periscope] Emerson’s phone made no db, room, storage or network call (${logA.join(' | ') || 'none'})`);
  assert(!logB.length, `[periscope] nothing reached Sydney’s phone (${logB.join(' | ') || 'none'})`);
  await shotsAt(h, { a }, 'periscope-on');

  // off and on again
  await longPress(a, head);
  assert((await scopes(a)).length === 0, '[periscope] a second long press puts it away');
  await longPress(a, head);
  assert((await scopes(a)).length === 5, '[periscope] and a third brings it back');
  // hiding the app puts it away
  await a.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; });
  await h.wait(60);
  assert((await scopes(a)).length === 0, '[periscope] switching away from the app puts it away');
  // leaving the match puts it away
  await longPress(a, head);
  assert((await scopes(a)).length === 5, '[periscope] back on');
  await h.closeGame(a);
  await h.openMatch(a, id);
  await a.waitForSelector('.g-fleet .fl-battle');
  assert((await scopes(a)).length === 0, '[periscope] leaving the match and coming back puts it away');

  // play it out with the periscope up: Sydney only finds water, Emerson never misses
  await longPress(a, head);
  await spy(a);
  let total = 2;
  const seenAfloat = new Set();
  for (let n = 0; n < 60; n++) {
    const e = await h.engine(a, id);
    if (e.over) break;
    const w = e.acts[0];
    const shooter = w === 'a' ? a : b;
    await shooter.waitForSelector('.g-fleet .fl-target.is-live');
    if (w === 'a') {
      if (!sameFleet(await scopes(a), herAfloat(e.state))) throw new Error(`FAIL: periscope out of step with Sydney’s afloat ships at shot ${n}`);
      seenAfloat.add(herAfloat(e.state).length);
      if (n % 4 === 0) await checkNoLeak(h, b, id, 'b', `Sydney while Emerson peeks (${n})`);
    }
    const [r, c] = nextShot(e.state, w, { a: 99, b: 0 });
    await fire(shooter, r, c, 'tap');
    total++;
    await waitSynced(h, id, total);
    if (w === 'a') {
      const sent = h.matches().find((m) => m.id === id).a;
      const last = sent[sent.length - 1];
      if (!sameFleet(last, { r, c })) throw new Error(`FAIL: Emerson’s move went out as ${JSON.stringify(last)}`);
    }
  }
  const [ea, eb] = await waitSynced(h, id, total);
  assert(seenAfloat.size >= 4, `[periscope] stayed up between shots and dropped each ship as it sank (checked at ${[...seenAfloat].sort().reverse().join(', ')} afloat)`);
  assert(ea.over && ea.result.winner === 'a' && sameFleet(ea.state, eb.state), '[periscope] Emerson wins; both phones agree on every move');
  console.log('ok - [periscope] every move Emerson sent was a bare { r, c }');
  assert((await scopes(a)).length === 0, '[periscope] gone the moment the battle ends');
  const doc = h.docs[`matches/${id}`];
  assert(sameFleet(Object.keys(doc).sort(), ['a', 'b', 'by', 'created', 'first', 'game', 'opts', 'seed', 'ua', 'ub']), '[periscope] the shared match doc has only the usual fields');
  const aMoves = JSON.parse(doc.a);
  assert('fleet' in aMoves[0] && Object.keys(aMoves[0]).length === 1 && aMoves.slice(1).every((m) => sameFleet(Object.keys(m).sort(), ['c', 'r'])), '[periscope] Emerson’s move list is a fleet and plain shots, like anyone’s');
  // what his phone wrote during the game: his move list, the result, the logbook. Nothing else.
  const writes = await a.evaluate(() => (window.__spyLog || []).filter((x) => x[0] === '__db' && x[1] !== 'get' && x[1] !== 'snapshot').map((x) => [x[1], x[2], x[3]]));
  const odd = writes.filter(([op, p, v]) => {
    const body = v && v !== 'null' ? JSON.parse(v) : {};
    if (p === `matches/${id}`) return op !== 'update' || Object.keys(body).some((k) => k !== 'a' && k !== 'ua');
    if (p === `results/${id}`) return op !== 'set' || !sameFleet(Object.keys(body).sort(), ['at', 'game', 'mode', 'score', 'winner']);
    if (p === 'gamedata/fleet') return Object.keys(body).some((k) => !RECORD_KEY.test(k));
    return true;
  });
  assert(writes.length > 0 && !odd.length, `[periscope] Emerson’s phone wrote only moves, the result and logbook records (${writes.length} writes${odd.length ? `; odd: ${JSON.stringify(odd)}` : ''})`);
  const storage = await a.evaluate(() => (window.__spyLog || []).filter((x) => x[0] === 'setItem').map((x) => x[1]));
  assert(storage.every((k) => /^ju\.games\.(data|seenEnd)/.test(k)), `[periscope] local storage only got the usual keys (${[...new Set(storage)].join(', ') || 'none'})`);
  const rec = h.docs[`results/${id}`];
  assert(rec && sameFleet(Object.keys(rec).sort(), ['at', 'game', 'mode', 'score', 'winner']) && rec.winner === 'a', '[periscope] the result record is the usual five fields');
  const gd = h.docs['gamedata/fleet'] || {};
  assert(Object.keys(gd).every((k) => RECORD_KEY.test(k)), `[periscope] the shared logbook holds only record keys (${Object.keys(gd).join(', ')})`);
  await h.wait(2300);
  assert(await a.isVisible('#game-root .gm-end') && await b.isVisible('#game-root .gm-end'), '[periscope] end card on both phones');
  const subA = await a.textContent('#game-root .gm-end .gm-end-sub');
  const subB = await b.textContent('#game-root .gm-end .gm-end-sub');
  assert(subA === ea.result.sub && subB === eb.result.sub, '[periscope] both end cards say exactly what the move log says');
  await a.click('#game-root [data-g="end-look"]');
  await b.click('#game-root [data-g="end-look"]');
  await h.wait(300);
  await checkNoLeak(h, a, id, 'a', 'Emerson, final board');
  await checkNoLeak(h, b, id, 'b', 'Sydney, final board');
  const book = (pg) => pg.$eval('.g-fleet .fl-book table', (t) => t.textContent.replace(/\s+/g, ' '));
  assert(await book(a) === await book(b), '[periscope] the logbook reads the same on both phones');
  await h.closeGame(a);
  await h.closeGame(b);
}

// Same phone: the periscope never works (Sydney is holding the same screen).
async function periscopeLocal(h) {
  const pg = h.a;
  await h.newLocalGame(pg, 'fleet');
  const id = await pg.evaluate(() => window.__lastMatchId);
  for (let i = 0; i < 2; i++) {
    await pg.click('#game-root [data-g="reveal"]');
    await pg.click('.g-fleet [data-fl="shuffle"]');
    await pg.click('.g-fleet [data-fl="ready"]');
  }
  let done = false;
  for (let n = 0; n < 6 && !done; n++) {
    if (await pg.isVisible('#game-root .gm-curtain')) await pg.click('#game-root [data-g="reveal"]');
    await pg.waitForSelector('.g-fleet .fl-target.is-live');
    const e = await h.engine(pg, id);
    if (e.acts[0] === 'a') {
      await longPress(pg, '.g-fleet .fl-target .fl-head');
      assert((await scopes(pg)).length === 0, '[periscope] same phone: Emerson’s long press does nothing');
      await checkNoLeak(h, pg, id, 'a', 'same phone, after the long press');
      done = true;
      break;
    }
    const [r, c] = nextShot(e.state, 'b', { a: 0, b: 0 });
    await fire(pg, r, c, 'tap');
    for (let t = 0; t < 100; t++) { if (movesOf(await h.engine(pg, id)) > movesOf(e)) break; await h.wait(40); }
  }
  assert(done, '[periscope] same phone: reached Emerson’s turn');
  await h.closeGame(pg);
}

// A half-placed fleet survives leaving the match.
async function draftSurvives(h) {
  const { a } = h;
  const id = await h.newOnlineGame(a, 'fleet');
  await a.waitForSelector('.g-fleet .fl-dock-ship');
  await a.tap('.g-fleet .is-edit .fl-cell[data-r="0"][data-c="0"]');
  await a.tap('.g-fleet .is-edit .fl-cell[data-r="2"][data-c="0"]');
  const before = (await placedShips(a)).map((x) => x.style).sort();
  await h.closeGame(a);
  await h.openMatch(a, id);
  await a.waitForSelector('.g-fleet .fl-place');
  const after = (await placedShips(a)).map((x) => x.style).sort();
  assert(before.length === 2 && sameFleet(before, after), '[draft] two ships placed, the game closed and reopened: both still where they were');
  await h.closeGame(a);
}

// Phone on its side: the whole chart fits on screen.
async function landscape(h) {
  const { a, b } = h;
  const id = await h.newOnlineGame(a, 'fleet');
  await h.openMatch(b, id);
  await h.settle();
  await a.setViewportSize({ width: 844, height: 390 });
  await h.wait(150);
  const ph = await a.$eval('.g-fleet .fl-place .fl-grid', (g) => g.getBoundingClientRect().height);
  assert(ph <= 390 - 60, `[landscape] the placement chart fits a phone on its side (${Math.round(ph)} px tall)`);
  await a.setViewportSize({ width: 390, height: 844 });
  for (const pg of [b, a]) { await pg.click('.g-fleet [data-fl="shuffle"]'); await pg.click('.g-fleet [data-fl="ready"]'); }
  await waitSynced(h, id, 2);
  await a.setViewportSize({ width: 844, height: 390 });
  await h.wait(2300);
  const t = await a.$eval('.g-fleet .fl-target', (s) => { const g = s.querySelector('.fl-grid').getBoundingClientRect(); const hd = s.querySelector('.fl-head').getBoundingClientRect(); return { all: g.bottom - hd.top, cell: g.width / 8 }; });
  assert(t.all <= 390 - 8 && t.cell >= 30, `[landscape] heading to row 8 of the target chart fits on screen (${Math.round(t.all)} px, ${Math.round(t.cell)} px squares)`);
  await a.evaluate(() => { const s = document.querySelector('.g-fleet .fl-target'); s.scrollIntoView({ block: 'start' }); });
  await h.shot(a, path.join(SHOTS, 'landscape-battle-a.png'), { scale: 'css' });
  await a.setViewportSize({ width: 390, height: 844 });
  await h.closeGame(a);
  await h.closeGame(b);
}

/** `w`'s next salvo from the engine's truth: `hits` ship squares, the rest water. */
function salvoPick(st, w, hits) {
  const foeFleet = st.fleets[other(w)];
  const shot = new Set(st.shots.filter((x) => x.by === w).map((x) => x.r * N + x.c));
  const need = Math.min(5 - st.shots.filter((x) => x.by === other(w) && x.sunk >= 0).length, 64 - shot.size);
  const ship = foeFleet.flatMap(cellsOf).filter(([r, c]) => !shot.has(r * N + c));
  const occ = new Set(foeFleet.flatMap(cellsOf).map(([r, c]) => r * N + c));
  const water = [];
  for (let i = 0; i < N * N; i++) if (!occ.has(i) && !shot.has(i)) water.push([Math.floor(i / N), i % N]);
  const out = ship.slice(0, Math.min(hits, need));
  for (const x of [...water, ...ship.slice(out.length)]) { if (out.length >= need) break; out.push(x); }
  return out;
}

// ── Salvo, online, through the UI ──
async function salvoOnline(h, scheme) {
  const { a, b } = h;
  const id = await h.newOnlineGame(a, 'fleet');
  await h.openMatch(b, id);
  await h.settle();
  await a.waitForSelector('.g-fleet .fl-rule[data-rules="salvo"]');
  assert(await a.getAttribute('.g-fleet .fl-rule[data-rules="classic"]', 'aria-pressed') === 'true', `[salvo ${scheme}] Classic is the default`);
  await a.tap('.g-fleet .fl-rule[data-rules="salvo"]');
  await waitSynced(h, id, 1);
  await b.waitForFunction(() => /Salvo rules \(Emerson’s pick\)/.test(document.querySelector('#game-root .fl-rules-note')?.textContent || ''), null, { timeout: 5000 });
  assert(await b.$$eval('.g-fleet .fl-rule', (x) => x.length) === 0 && /Salvo rules \(your pick\)/.test(await a.textContent('.g-fleet .fl-rules-note')), `[salvo ${scheme}] Emerson picks Salvo; both phones show it and the choice is closed`);
  await shotsAt(h, { a, b }, `${scheme}-salvo-placement`);
  for (const pg of [b, a]) { await pg.click('.g-fleet [data-fl="shuffle"]'); await pg.click('.g-fleet [data-fl="ready"]'); }
  let total = 3;
  await waitSynced(h, id, total);
  const pages = { a, b };
  let smaller = false;
  for (let n = 0; n < 40; n++) {
    const e = await h.engine(a, id);
    if (e.over) break;
    const w = e.acts[0];
    const shooter = pages[w];
    await shooter.waitForSelector('.g-fleet .fl-target.is-live');
    if (n % 2 === 0) { await checkNoLeak(h, a, id, 'a', `salvo ${n}, Emerson`); await checkNoLeak(h, b, id, 'b', `salvo ${n}, Sydney`); }
    const cells = salvoPick(e.state, w, w === 'a' ? 3 : 2);
    if (cells.length < 5) smaller = true;
    if (n === 0) {
      assert(await shooter.$eval('.g-fleet [data-fl="salvo-fire"]', (x) => x.disabled), `[salvo ${scheme}] Fire waits for a full salvo`);
      await shooter.tap(cellSel(...cells[0]));
      await shooter.tap(cellSel(...cells[0]));
      assert(await shooter.$$eval('.g-fleet .fl-cell.is-pick', (x) => x.length) === 0, `[salvo ${scheme}] tapping an aimed square again takes it back`);
    }
    for (const [r, c] of cells) await shooter.tap(cellSel(r, c));
    if (n === 0) {
      const spare = [...Array(64).keys()].map((i) => [Math.floor(i / 8), i % 8]).find(([r, c]) => !cells.some(([x, y]) => x === r && y === c));
      await shooter.tap(cellSel(...spare));
      assert(await shooter.$$eval('.g-fleet .fl-cell.is-pick', (x) => x.length) === cells.length, `[salvo ${scheme}] a sixth square is refused`);
      assert(/5\s*\/5 aimed/.test(await shooter.textContent('.g-fleet .fl-fire-n')), `[salvo ${scheme}] the counter reads 5/5`);
      await shotsAt(h, { [w]: shooter }, `${scheme}-salvo-aim`);
    }
    await shooter.tap('.g-fleet [data-fl="salvo-fire"]');
    total++;
    await waitSynced(h, id, total);
    const e2 = await h.engine(a, id);
    const fired = e2.state.shots.length - e.state.shots.length;
    if (fired !== cells.length && !e2.over) throw new Error(`FAIL: salvo fired ${fired} of ${cells.length}`);
    if (!e2.over && e2.acts[0] === w) throw new Error('FAIL: the turn did not pass after a salvo');
    if (n === 1) { await h.wait(900); await shotsAt(h, pages, `${scheme}-salvo-battle`); }
  }
  const [ea, eb] = await waitSynced(h, id, total);
  assert(ea.over && eb.over && sameFleet(ea.state, eb.state) && ea.state.mode === 'salvo', `[salvo ${scheme}] the salvo battle ends; both phones agree (${ea.result.winner} wins)`);
  assert(smaller, `[salvo ${scheme}] a player who lost ships fired smaller salvos`);
  await h.wait(2300);
  await a.click('#game-root [data-g="end-look"]');
  await b.click('#game-root [data-g="end-look"]');
  await h.wait(400);
  const bookTxt = await a.textContent('.g-fleet .fl-book');
  assert(/Fewest shots to win · Salvo/.test(bookTxt) && /New/.test(bookTxt), `[salvo ${scheme}] the logbook shows the Salvo record, marked New`);
  await shotsAt(h, pages, `${scheme}-salvo-logbook`, { bottom: true });
  await h.closeGame(a);
  await h.closeGame(b);
}

// ── Salvo on one phone: the whole salvo lands on screen before the phone is passed ──
async function salvoLocal(h) {
  const pg = h.a;
  await h.newLocalGame(pg, 'fleet');
  const id = await pg.evaluate(() => window.__lastMatchId);
  await pg.click('#game-root [data-g="reveal"]');
  await pg.tap('.g-fleet .fl-rule[data-rules="salvo"]');
  for (let i = 0; i < 2; i++) {
    if (i) await pg.click('#game-root [data-g="reveal"]');
    await pg.click('.g-fleet [data-fl="shuffle"]');
    await pg.click('.g-fleet [data-fl="ready"]');
  }
  await pg.click('#game-root [data-g="reveal"]');
  await pg.waitForSelector('.g-fleet .fl-target.is-live');
  const e = await h.engine(pg, id);
  const w = e.acts[0];
  const cells = salvoPick(e.state, w, 2);
  for (const [r, c] of cells) await pg.tap(cellSel(r, c));
  await pg.tap('.g-fleet [data-fl="salvo-fire"]');
  await h.wait(120);
  assert(!(await pg.isVisible('#game-root .gm-curtain')), '[salvo same phone] no curtain the instant the salvo is fired');
  assert(await pg.$$eval('.g-fleet .fl-target .fl-mark', (x) => x.length) === 5 && /pass the phone/i.test(await pg.textContent('.g-fleet .fl-log')), '[salvo same phone] all five shots land on screen, then "pass the phone"');
  assert(movesOf(await h.engine(pg, id)) === movesOf(e), '[salvo same phone] the salvo is played after it is shown, not before');
  for (let t = 0; t < 120; t++) { if (movesOf(await h.engine(pg, id)) > movesOf(e)) break; await h.wait(40); }
  await h.wait(80);
  const e2 = await h.engine(pg, id);
  assert(e2.state.shots.length === 5 && e2.acts[0] === other(w) && await pg.isVisible('#game-root .gm-curtain'), '[salvo same phone] then it is played and the curtain comes down for the other player');
  await h.closeGame(pg);
}

// ── Arsenal on one phone: sonar, torpedo, the kit's bonuses ──
async function arsenalLocal(h) {
  const pg = h.a;
  await h.newLocalGame(pg, 'fleet');
  const id = await pg.evaluate(() => window.__lastMatchId);
  await pg.click('#game-root [data-g="reveal"]');
  await pg.tap('.g-fleet .fl-rule[data-rules="arsenal"]');
  await h.wait(100);
  let e = await h.engine(pg, id);
  const first = e.first;
  assert(e.state.mode === 'arsenal' && /Arsenal rules/.test(await pg.textContent('.g-fleet .fl-rules-note')), '[arsenal] the first player picks Arsenal');
  await pg.click('.g-fleet [data-fl="shuffle"]');
  await pg.click('.g-fleet [data-fl="ready"]');
  await pg.click('#game-root [data-g="reveal"]');
  assert(await pg.$$eval('.g-fleet .fl-rule', (x) => x.length) === 0 && new RegExp(`Arsenal rules \\(${first === 'a' ? 'Emerson' : 'Sydney'}’s pick\\)`).test(await pg.textContent('.g-fleet .fl-rules-note')), '[arsenal] the second player sees who picked the rules');
  await pg.click('.g-fleet [data-fl="shuffle"]');
  await pg.click('.g-fleet [data-fl="ready"]');
  await pg.click('#game-root [data-g="reveal"]');
  await pg.waitForSelector('.g-fleet .fl-target.is-live');
  e = await h.engine(pg, id);
  const w = e.acts[0];
  const foeFleet = e.state.fleets[other(w)];
  assert(/Sonar\s*1/.test(await pg.textContent('.g-fleet [data-wpn="sonar"]')) && /Torpedo\s*1/.test(await pg.textContent('.g-fleet [data-wpn="torp"]')), '[arsenal] the kit tray shows one sonar and one torpedo');
  // sonar: aim (the 3×3 lights up), then tap again to ping
  const [sr, sc] = cellsOf(foeFleet[0])[1];
  await pg.tap('.g-fleet [data-wpn="sonar"]');
  await pg.tap(cellSel(sr, sc));
  const zone = await pg.$$eval('.g-fleet .fl-target .fl-cell.is-zone', (x) => x.length);
  const want = [-1, 0, 1].flatMap((dr) => [-1, 0, 1].map((dc) => [sr + dr, sc + dc])).filter(([r, c]) => r >= 0 && r < 8 && c >= 0 && c < 8);
  assert(zone === want.length, `[arsenal] aiming the sonar lights up its ${want.length} squares`);
  await pg.tap(cellSel(sr, sc));
  await h.wait(150);
  let e2 = await h.engine(pg, id);
  const expectN = want.filter(([r, c]) => foeFleet.some((s) => cellsOf(s).some(([x, y]) => x === r && y === c))).length;
  assert(e2.state.scans.length === 1 && e2.state.scans[0].n === expectN && e2.acts[0] === w && e2.state.kit[w].sonar === 0, `[arsenal] the ping counts ${expectN} ship squares and it’s still the same player’s shot`);
  assert(await pg.textContent('.g-fleet .fl-target .fl-scan b') === String(expectN) && await pg.$eval('.g-fleet [data-wpn="sonar"]', (x) => x.disabled), '[arsenal] the ping’s box and count are drawn; the sonar is spent');
  assert(await pg.getAttribute('.g-fleet [data-wpn="shot"]', 'aria-pressed') === 'true' && await pg.$$eval('.g-fleet .fl-target .fl-cell.is-zone', (x) => x.length) === 0, '[arsenal] after the ping the kit is back on Shot (no stale sonar aim)');
  await h.wait(500);
  await shotsAt(h, { a: pg }, 'arsenal-sonar');
  // torpedo along the first ship
  const s0 = foeFleet[0];
  const [tr, tc] = cellsOf(s0)[1];
  await pg.tap('.g-fleet [data-wpn="torp"]');
  if (s0.dir === 'v') await pg.tap('.g-fleet [data-fl="tdir"]');
  await pg.tap(cellSel(tr, tc));
  assert(await pg.$$eval('.g-fleet .fl-target .fl-cell.is-zone', (x) => x.length) === 3, '[arsenal] aiming the torpedo lights up three squares in a line');
  await pg.tap(cellSel(tr, tc));
  await h.wait(150);
  e2 = await h.engine(pg, id);
  const torps = e2.state.shots.filter((x) => x.t === 'torp');
  assert(torps.length === 3 && torps.every((x) => x.hit) && e2.acts[0] === w && e2.state.kit[w].torp >= 0, '[arsenal] the torpedo hits three squares of the ship; a hit keeps the turn');
  await h.wait(700);
  await shotsAt(h, { a: pg }, 'arsenal-torpedo');
  // play it out with plain shots: three hits then a miss, so streaks and sinkings pay out
  const pattern = { a: 3, b: 3 };
  for (let n = 0; n < 200; n++) {
    e = await h.engine(pg, id);
    if (e.over) break;
    if (await pg.isVisible('#game-root .gm-curtain')) await pg.click('#game-root [data-g="reveal"]');
    await pg.waitForSelector('.g-fleet .fl-target.is-live');
    e = await h.engine(pg, id);
    const who = e.acts[0];
    if (n % 5 === 0) await checkNoLeak(h, pg, id, who, `arsenal shot ${n}`);
    const [r, c] = nextShot(e.state, who, pattern);
    await fire(pg, r, c, 'tap');
    for (let t = 0; t < 100; t++) { if (movesOf(await h.engine(pg, id)) > movesOf(e)) break; await h.wait(40); }
  }
  e = await h.engine(pg, id);
  assert(e.over, `[arsenal] the arsenal game ends (${e.result.winner} wins)`);
  assert(e.state.shots.some((x) => x.bonus === 'torp') && e.state.shots.some((x) => x.kit === 'sonar'), '[arsenal] three-hit streaks paid torpedoes and lost ships paid sonar pings');
  await h.wait(2300);
  assert(await pg.isVisible('#game-root .gm-end'), '[arsenal] end card');
  await pg.click('#game-root [data-g="end-look"]');
  await h.wait(300);
  await shotsAt(h, { a: pg }, 'arsenal-final', { bottom: true });
  await h.closeGame(pg);
}

// ── laptop: hover, R to rotate, arrow keys + Enter ──
async function laptop() {
  const h = await launch({ port: 9303, only: ['fleet'], device: 'Desktop Chrome' });
  const { a, b } = h;
  try {
    await realFonts(h);
    await a.setViewportSize({ width: 1280, height: 860 });
    await b.setViewportSize({ width: 1280, height: 860 });
    const id = await h.newOnlineGame(a, 'fleet');
    await h.openMatch(b, id);
    await h.settle();
    await b.click('.g-fleet [data-fl="shuffle"]');
    await b.click('.g-fleet [data-fl="ready"]');
    await waitSynced(h, id, 1);
    // hover shows a preview of the picked ship; R turns it; click places
    const g = await gridBox(a);
    await a.mouse.move(g.x + 2.5 * g.cs, g.y + 1.5 * g.cs);
    await a.waitForTimeout(50);
    assert(await a.isVisible('.g-fleet .fl-preview'), '[laptop] hovering the chart previews the picked ship');
    await a.keyboard.press('r');
    await a.mouse.move(g.x + 2.6 * g.cs, g.y + 1.5 * g.cs);
    await a.mouse.click(g.x + 2.5 * g.cs, g.y + 1.5 * g.cs);
    let ps = await placedShips(a);
    assert(ps.length === 1 && ps[0].style === posStyle({ r: 1, c: 2, len: 4, dir: 'v' }), '[laptop] R turned the ship before placing it');
    await a.keyboard.press('r');
    ps = await placedShips(a);
    assert(ps[0].style === posStyle({ r: 1, c: 2, len: 4, dir: 'h' }), '[laptop] R turns the last placed ship');
    await a.click('.g-fleet [data-fl="shuffle"]');
    await shotsAt(h, { a }, 'laptop-placement', { width: 1280, height: 860 });
    await a.click('.g-fleet [data-fl="ready"]');
    await waitSynced(h, id, 2);
    await h.wait(200);
    // the periscope with a mouse: press and hold the heading
    const hb = await (await a.$('.g-fleet .fl-target .fl-head')).boundingBox();
    const hold = async () => { await a.mouse.move(hb.x + 30, hb.y + hb.height / 2); await a.mouse.down(); await a.waitForTimeout(800); await a.mouse.up(); await a.waitForTimeout(60); };
    await hold();
    assert((await scopes(a)).length === 5, '[laptop] Emerson can press and hold with a mouse too');
    await hold();
    assert((await scopes(a)).length === 0, '[laptop] and put it away the same way');
    // aim with the keyboard
    const e = await h.engine(a, id);
    let shooter = e.acts[0] === 'a' ? a : b;
    if (shooter === b) { // let Sydney miss once so it's Emerson's turn
      const [r, c] = nextShot(e.state, 'b', { a: 0, b: 0 });
      await fire(b, r, c);
      await waitSynced(h, id, 3);
      shooter = a;
    }
    const st0 = (await h.engine(a, id)).state;
    const before = st0.shots.length;
    const [tr, tc] = nextShot(st0, 'a', { a: 99, b: 0 }); // one of Sydney's ship squares
    await a.mouse.move(5, 5);
    await a.keyboard.press('ArrowRight'); // first press just shows the aim, at D4
    assert(await a.$eval('.g-fleet .fl-target .fl-cell.is-aim', (x) => `${x.dataset.r},${x.dataset.c}`) === '3,3', '[laptop] the first arrow key shows the aim');
    for (let k = 0; k < Math.abs(tr - 3); k++) await a.keyboard.press(tr > 3 ? 'ArrowDown' : 'ArrowUp');
    for (let k = 0; k < Math.abs(tc - 3); k++) await a.keyboard.press(tc > 3 ? 'ArrowRight' : 'ArrowLeft');
    assert(await a.$eval('.g-fleet .fl-target .fl-cell.is-aim', (x) => `${x.dataset.r},${x.dataset.c}`) === `${tr},${tc}`, '[laptop] arrow keys move the aim');
    const movesBefore = st0.shots.length + 2; // two fleets + the shots so far
    await a.keyboard.press('Enter');
    await waitSynced(h, id, movesBefore + 1);
    const st = (await h.engine(a, id)).state;
    const last = st.shots[st.shots.length - 1];
    assert(st.shots.length === before + 1 && last.r === tr && last.c === tc && last.hit, '[laptop] Enter fires at the aimed square (a hit)');
    // still Emerson's turn: hovering a square lights up its row and column labels
    const tg = await gridBox(a, '.g-fleet .fl-target .fl-grid');
    const free = [[0, 7], [7, 0], [7, 7]].find(([r, c]) => !st.shots.some((x) => x.by === 'a' && x.r === r && x.c === c));
    await a.mouse.move(tg.x + (free[1] + 0.5) * tg.cs, tg.y + (free[0] + 0.5) * tg.cs);
    await a.waitForTimeout(60);
    const lit = await a.$$eval('.g-fleet .fl-target .fl-lab span.is-on', (xs) => xs.map((x) => x.textContent).join(''));
    assert(lit === `${LETTERS[free[1]]}${free[0] + 1}`, `[laptop] hovering ${LETTERS[free[1]]}${free[0] + 1} lights up its column and row labels`);
    // the keyboard cursor followed the mouse, so Enter fires there
    await a.keyboard.press('Enter');
    await h.wait(150);
    const st2 = (await h.engine(a, id)).state;
    const l2 = st2.shots[st2.shots.length - 1];
    assert(l2.r === free[0] && l2.c === free[1], '[laptop] Enter fires where the mouse is aiming');
    await h.wait(900);
    await shotsAt(h, { a, b }, 'laptop-battle', { width: 1280, height: 860 });
    // regression: Enter on a focused button (the back button) does what the button says, and fires nothing
    let e3 = await h.engine(a, id);
    if (e3.acts[0] === 'b') { const [r, c] = nextShot(e3.state, 'b', { a: 0, b: 0 }); await fire(b, r, c); await waitSynced(h, id, movesOf(e3) + 1); }
    e3 = await h.engine(a, id);
    await a.waitForSelector('.g-fleet .fl-target.is-live');
    await a.focus('#game-root [data-g="close"]');
    await a.keyboard.press('Enter');
    await h.wait(300);
    assert(!(await a.$('#game-root .gm')), '[laptop] Enter on the focused back button goes back');
    assert(movesOf(await h.engine(a, id)) === movesOf(e3), '[laptop] ...and fires no shot');
    await h.openMatch(a, id);
    await a.waitForSelector('.g-fleet .fl-target.is-live');
    // regression: Tab to a square and press Enter: it fires at that square (not at an old aim)
    const mine3 = new Set(e3.state.shots.filter((x) => x.by === 'a').map((x) => x.r * N + x.c));
    const tab = [[7, 3], [6, 2], [5, 1], [1, 5]].find(([r, c]) => !mine3.has(r * N + c));
    await a.focus(cellSel(...tab));
    await a.keyboard.press('Enter');
    await waitSynced(h, id, movesOf(e3) + 1);
    const st3 = (await h.engine(a, id)).state;
    const l3 = st3.shots[st3.shots.length - 1];
    assert(l3.by === 'a' && l3.r === tab[0] && l3.c === tab[1], `[laptop] Enter on a focused square (${LETTERS[tab[1]]}${tab[0] + 1}) fires at that square`);
    h.assertNoErrors();
  } finally {
    await h.close();
  }
}

(async () => {
  let h = null;
  // ONLY=rules,light,dark,arsenal,laptop runs a subset (default: everything)
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const want = (k) => !only || only.includes(k);
  try {
    if (want('rules')) await rulesTests();

    // light: online + same phone, the periscope, the regressions
    if (want('light')) {
      h = await launch({ port: 9301, only: ['fleet'] });
      if (await realFonts(h)) console.log('(using local copies of the app fonts for screenshots)');
      const r1 = await onlineGame(h, { scheme: 'light' });
      assert(h.results().length === 1 && h.results()[0].game === 'fleet' && h.results()[0].winner === r1.winner, 'the online result is recorded once');
      await h.closeGame(h.a); await h.closeGame(h.b);
      await localGame(h);
      assert(h.results().length === 2, 'the same-phone result is recorded');
      await missThenClose(h);
      await pileOfShots(h);
      await draftSurvives(h);
      await periscope(h);
      await periscopeLocal(h);
      await landscape(h);
      h.assertNoErrors();
      await h.close();
      h = null;
    }

    // dark: online classic again (screenshots), then a Salvo battle
    if (want('dark')) {
      h = await launch({ port: 9302, only: ['fleet'], colorScheme: 'dark' });
      await realFonts(h);
      await onlineGame(h, { scheme: 'dark', drag: true });
      await h.closeGame(h.a); await h.closeGame(h.b);
      await salvoOnline(h, 'dark');
      h.assertNoErrors();
      await h.close();
      h = null;
    }

    // Arsenal on one phone (light)
    if (want('arsenal')) {
      h = await launch({ port: 9304, only: ['fleet'] });
      await realFonts(h);
      await arsenalLocal(h);
      await salvoLocal(h);
      h.assertNoErrors();
      await h.close();
      h = null;
    }

    if (want('laptop')) await laptop();
    console.log('\nALL GOOD');
  } catch (e) {
    console.error(e.stack || e.message);
    if (h) {
      await h.shot(h.a, path.join(SHOTS, 'fail-a.png')).catch(() => {});
      await h.shot(h.b, path.join(SHOTS, 'fail-b.png')).catch(() => {});
      console.error('errors:', h.errors);
    }
    process.exitCode = 1;
  } finally {
    if (h) await h.close().catch(() => {});
  }
})();
