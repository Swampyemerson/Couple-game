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

/** (d) Nothing about `viewer`'s opponent's unsunk ships may be in the DOM. Own fleet must be exactly the viewer's. */
async function checkNoLeak(h, pg, id, viewer, label) {
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
      text: root.textContent,
    };
  });
  if (!dom) throw new Error(`FAIL: no board (${label})`);
  if (dom.viewer !== viewer) throw new Error(`FAIL: board is drawn for ${dom.viewer}, expected ${viewer} (${label})`);
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
  const shapes = new Set(plain.map((x) => `${x.cls.replace(' is-aim', '')}|${x.html}|${x.attrs}`));
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
  let localShot = false;
  for (let n = 0; n < 200; n++) {
    e = await h.engine(pg, id);
    if (e.over) break;
    const w = e.acts[0];
    if (await curtainUp()) await atCurtain(`before ${w} shoots (shot ${n})`);
    await checkNoLeak(h, pg, id, w, `same-phone shot ${n}`);
    const [r, c] = nextShot(e.state, w, pattern);
    await fire(pg, r, c, 'tap');
    await h.wait(40);
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

// ── laptop: hover, R to rotate, arrow keys + Enter ──
async function laptop() {
  const h = await launch({ port: 8924, only: ['fleet'], device: 'Desktop Chrome' });
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
    await a.keyboard.press('Enter');
    await waitSynced(h, id, (await h.engine(b, id)).lists.a.length + (await h.engine(b, id)).lists.b.length + 1);
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
    h.assertNoErrors();
  } finally {
    await h.close();
  }
}

(async () => {
  let h = null;
  try {
    await rulesTests();

    // light: online + same phone
    h = await launch({ port: 8922, only: ['fleet'] });
    if (await realFonts(h)) console.log('(using local copies of the app fonts for screenshots)');
    const r1 = await onlineGame(h, { scheme: 'light' });
    assert(h.results().length === 1 && h.results()[0].game === 'fleet' && h.results()[0].winner === r1.winner, 'the online result is recorded once');
    await h.closeGame(h.a); await h.closeGame(h.b);
    await localGame(h);
    assert(h.results().length === 2, 'the same-phone result is recorded');
    h.assertNoErrors();
    await h.close();
    h = null;

    // dark: online again (screenshots), placement by Shuffle on both
    h = await launch({ port: 8923, only: ['fleet'], colorScheme: 'dark' });
    await realFonts(h);
    await onlineGame(h, { scheme: 'dark', drag: true });
    h.assertNoErrors();
    await h.close();
    h = null;

    await laptop();
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
