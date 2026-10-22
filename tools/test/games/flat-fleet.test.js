// Battleships (fleet), upgrade 2 "flat" unit: smoothness, juice and the printed look.
//   node tools/test/games/flat-fleet.test.js          (PORT env = first port, default 9060)
// (a) placement drag: the ship in your hand moves by transform only, with no layout per pointermove
// (b) the boards are patched, not rebuilt: the 64 squares and old marks survive a shot
// (c) reduced motion: no shell, flash or confetti is ever started, and nothing is left animating
// (d) juice: a shell flies, a sink freezes + flashes, the winner gets confetti that cleans itself up
// (e) riso: grain + wave lines on the charts, off-register headings, light and dark
// (f) the hidden gesture's heading has no affordance of any kind (no cursor, press state or hover style)
const path = require('path');
const { launch } = require('../harness');

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const PORT = Number(process.env.PORT) || 9060;
const N = 8;
const other = (w) => (w === 'a' ? 'b' : 'a');
const cellsOf = (s) => Array.from({ length: s.len }, (_, i) => (s.dir === 'v' ? [s.r + i, s.c] : [s.r, s.c + i]));
const cellSel = (r, c) => `.g-fleet .fl-target .fl-cell[data-r="${r}"][data-c="${c}"]`;
const metrics = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

async function waitMoves(h, id, total, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const ea = await h.engine(h.a, id);
    const eb = await h.engine(h.b, id);
    const n = (e) => (e ? e.lists.a.length + e.lists.b.length : -1);
    if (n(ea) === total && n(eb) === total) return ea;
    if (Date.now() - t0 > ms) throw new Error(`FAIL: phones did not sync to ${total} moves (a=${n(ea)}, b=${n(eb)})`);
    await h.wait(30);
  }
}
const FLEETS = {
  a: [{ r: 0, c: 0, len: 4, dir: 'h' }, { r: 2, c: 0, len: 3, dir: 'h' }, { r: 4, c: 0, len: 3, dir: 'v' }, { r: 7, c: 6, len: 2, dir: 'h' }, { r: 5, c: 7, len: 2, dir: 'v' }],
  b: [{ r: 0, c: 7, len: 4, dir: 'v' }, { r: 7, c: 0, len: 3, dir: 'h' }, { r: 3, c: 3, len: 3, dir: 'h' }, { r: 0, c: 0, len: 2, dir: 'v' }, { r: 5, c: 5, len: 2, dir: 'h' }],
};

/** Both fleets hidden by Shuffle; returns the match id once the battle has begun. */
async function startBattle(h) {
  const id = await h.newOnlineGame(h.a, 'fleet');
  await h.openMatch(h.b, id);
  await h.settle();
  for (const pg of [h.b, h.a]) { await pg.click('.g-fleet [data-fl="shuffle"]'); await pg.click('.g-fleet [data-fl="ready"]'); }
  await waitMoves(h, id, 2);
  await h.wait(300);
  return id;
}
/** A shot at a ship square (hit) or at water (miss), from the engine's truth. */
function pickShot(st, w, hit) {
  const foe = st.fleets[other(w)];
  const shot = new Set(st.shots.filter((x) => x.by === w).map((x) => x.r * N + x.c));
  const occ = new Set(foe.flatMap(cellsOf).map(([r, c]) => r * N + c));
  if (hit) { const c = foe.flatMap(cellsOf).find(([r, cc]) => !shot.has(r * N + cc)); return c; }
  for (let i = 0; i < 64; i++) if (!occ.has(i) && !shot.has(i)) return [Math.floor(i / 8), i % 8];
  return null;
}

// ── (a) the ship in your hand ──
async function dragTest(h) {
  const { a, b } = h;
  const id = await h.newOnlineGame(a, 'fleet');
  await h.openMatch(b, id);
  await h.settle();
  await a.waitForSelector('.g-fleet .fl-dock-ship');
  const cdp = await a.context().newCDPSession(a);
  await cdp.send('Performance.enable');
  const g = await a.$eval('.g-fleet .is-edit .fl-grid', (x) => { const r = x.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
  const cs = g.w / N;
  const sb = await (await a.$('.g-fleet .fl-dock-ship[data-ship="0"]')).boundingBox();
  const p0 = { x: sb.x + cs / 2, y: sb.y + sb.height / 2 };
  const tdev = await a.context().newCDPSession(a);
  await tdev.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p0] });
  const to = (k, steps, p1) => ({ x: p0.x + ((p1.x - p0.x) * k) / steps, y: p0.y + ((p1.y - p0.y) * k) / steps });
  const p1 = { x: g.x + 0.5 * cs, y: g.y + 3.5 * cs };
  for (let k = 1; k <= 4; k++) { await tdev.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to(k, 44, p1)] }); await a.waitForTimeout(16); }
  await a.waitForSelector('.g-fleet .fl-ghost');
  const m0 = await metrics(cdp);
  for (let k = 5; k <= 44; k++) { await tdev.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to(k, 44, p1)] }); await a.waitForTimeout(16); }
  const m1 = await metrics(cdp);
  const layouts = m1.LayoutCount - m0.LayoutCount;
  assert(layouts <= 8, `[drag] 40 pointermoves cost ${layouts} layouts (not one per move)`);
  const ghost = await a.$eval('.g-fleet .fl-ghost', (x) => { const cs2 = getComputedStyle(x); const r = x.getBoundingClientRect(); return { left: x.style.left, top: x.style.top, cl: cs2.left, ct: cs2.top, tr: cs2.transform, cx: r.left + r.width / 2, cy: r.top + r.height / 2, will: cs2.willChange }; });
  assert(ghost.left === '' && ghost.top === '' && ghost.cl === '0px' && ghost.ct === '0px', '[drag] the ghost is placed by transform only (left/top stay 0)');
  assert(/^matrix/.test(ghost.tr) && ghost.will === 'transform', '[drag] the ghost has a transform and its own layer');
  assert(Math.abs(ghost.cy - (p1.y + 0)) < cs * 1.2, `[drag] the ghost follows the finger (${Math.round(ghost.cy)} vs ${Math.round(p1.y)})`);
  const prev = await a.$eval('.g-fleet .fl-preview', (x) => ({ hidden: x.hidden, left: x.style.left, tr: getComputedStyle(x).transform }));
  assert(!prev.hidden && prev.left === '' && /^matrix/.test(prev.tr), '[drag] the preview box moves by transform too');
  await tdev.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await a.waitForTimeout(150);
  const placed = await a.$$eval('.g-fleet .is-edit .fl-ship', (xs) => xs.map((x) => x.getAttribute('style').replace(/;--k:\d+/, '')));
  assert(placed.length === 1 && placed[0] === '--r:3;--c:0;--w:4;--h:1', `[drag] released at A4: the 4-ship landed across A4 (${placed[0]})`);
  assert(await a.$$eval('.g-fleet .fl-ghost', (x) => x.length) === 0, '[drag] the ghost is gone once released');
  // the 64 placement squares are never rebuilt
  const same = await a.evaluate(() => { const first = [...document.querySelectorAll('.g-fleet .is-edit .fl-cell')]; window.__c0 = first; return first.length; });
  assert(same === 64, '[drag] 64 placement squares');
  await a.tap('.g-fleet .fl-dock-ship[data-ship="1"]');
  await a.tap('.g-fleet .is-edit .fl-cell[data-r="6"][data-c="0"]');
  assert(await a.evaluate(() => [...document.querySelectorAll('.g-fleet .is-edit .fl-cell')].every((c, i) => c === window.__c0[i])), '[drag] placing a ship patches the screen: the squares are the same nodes');
  await h.closeGame(a); await h.closeGame(b);
}

// ── (b) + (c) + (d) a battle ──
async function battleTest(h, { reduced }) {
  const { a, b } = h;
  const tag = reduced ? 'reduced motion' : 'motion';
  const id = await startBattle(h);
  const pages = { a, b };
  for (const pg of [a, b]) {
    await pg.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await pg.evaluate(() => {
      window.__seen = { shell: 0, flash: 0, conf: 0, sinking: 0 };
      new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) { if (n.nodeType !== 1) continue; const c = n.className || ''; if (/fl-shell/.test(c)) window.__seen.shell++; if (/fl-flash/.test(c)) window.__seen.flash++; if (/fl-conf/.test(c)) window.__seen.conf++; if (/is-sinking/.test(c)) window.__seen.sinking++; } }).observe(document.getElementById('game-root'), { childList: true, subtree: true });
    });
  }
  let e = await h.engine(a, id);
  let w = e.acts[0];
  const shooter = () => pages[w];
  await shooter().waitForSelector('.g-fleet .fl-target.is-live');
  // identity of everything the boards are made of, before the first shot
  for (const pg of [a, b]) {
    await pg.evaluate(() => {
      window.__keep = { cells: [...document.querySelectorAll('.g-fleet .fl-target .fl-cell')], grid: document.querySelector('.g-fleet .fl-target .fl-grid'), hgrid: document.querySelector('.g-fleet .fl-home .fl-grid'), head: document.querySelector('.g-fleet .fl-target .fl-head') };
    });
  }
  // a miss: the shell flies (or doesn't, under reduced motion), the board is patched
  const [mr, mc] = pickShot(e.state, w, false);
  await shooter().tap(cellSel(mr, mc));
  await shooter().waitForTimeout(40);
  const shellNow = await shooter().evaluate(() => document.querySelectorAll('.g-fleet .fl-shell').length);
  if (reduced) assert(shellNow === 0, `[${tag}] no shell is launched`); else assert(shellNow === 1, `[${tag}] a shell is in the air right after the tap`);
  await waitMoves(h, id, 3);
  await h.wait(900);
  for (const pg of [a, b]) {
    const kept = await pg.evaluate(() => {
      const k = window.__keep;
      const cells = [...document.querySelectorAll('.g-fleet .fl-target .fl-cell')];
      return { cells: cells.length === 64 && cells.every((c, i) => c === k.cells[i]), grid: document.querySelector('.g-fleet .fl-target .fl-grid') === k.grid, hgrid: document.querySelector('.g-fleet .fl-home .fl-grid') === k.hgrid, head: document.querySelector('.g-fleet .fl-target .fl-head') === k.head };
    });
    assert(kept.cells && kept.grid && kept.hgrid && kept.head, `[${tag}] after a shot the 64 squares, both grids and the heading are the same nodes (patched, not rebuilt)`);
  }
  assert(await shooter().evaluate(() => document.querySelectorAll('.g-fleet .fl-shell').length) === 0, `[${tag}] the shell cleans itself up`);
  e = await h.engine(a, id);
  w = e.acts[0];
  // the reply lands on the first shooter's phone; its first mark node survives the update
  await shooter().evaluate(() => { window.__m = document.querySelector('.g-fleet .fl-mark'); });
  const [hr, hc] = pickShot(e.state, w, true);
  await shooter().tap(cellSel(hr, hc));
  await waitMoves(h, id, 4);
  await h.wait(500);
  const noneRunning = await shooter().evaluate(() => document.getAnimations().filter((x) => x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest('.g-fleet') && x.playState === 'running').length);
  if (reduced) assert(noneRunning === 0, `[${tag}] nothing under the game is animating after a hit`);
  // sink the whole first ship: a freeze + flash for the big moment (not at all under reduced motion)
  e = await h.engine(a, id);
  w = e.acts[0];
  const foe = e.state.fleets[other(w)];
  const ship = foe.find((s) => cellsOf(s).every(([r, c]) => !e.state.shots.some((x) => x.by === w && x.r === r && x.c === c)));
  assert(!!ship, `[${tag}] an untouched enemy ship to sink`);
  const before = await shooter().evaluate(() => ({ ...window.__seen }));
  for (const [r, c] of cellsOf(ship)) {
    await shooter().tap(cellSel(r, c));
    await h.wait(120);
  }
  await shooter().waitForSelector('.g-fleet .fl-stamp', { timeout: 4000 }).catch(() => {});
  const seen = await shooter().evaluate(() => ({ ...window.__seen }));
  if (reduced) {
    assert(seen.shell === before.shell && seen.flash === 0 && seen.conf === 0, `[${tag}] a sink starts no shell, flash or confetti`);
    assert(await shooter().evaluate(() => document.querySelectorAll('.g-fleet .fl-shell, .g-fleet .fl-flash, .g-fleet .fl-conf').length) === 0, `[${tag}] and none are lying around`);
    const anims = await shooter().evaluate(() => document.getAnimations().filter((x) => x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest('.g-fleet')).length);
    assert(anims === 0, `[${tag}] no animation of any kind runs under the game (${anims})`);
  } else {
    assert(seen.shell - before.shell >= cellsOf(ship).length && seen.flash >= 1, `[${tag}] each shot flew a shell and the sink flashed (${seen.shell - before.shell} shells, ${seen.flash} flash)`);
    assert(await shooter().evaluate(() => !!document.querySelector('.g-fleet .fl-ship.is-wreck')), `[${tag}] the wreck is on the chart`);
    await h.wait(1100);
    assert(await shooter().evaluate(() => document.querySelectorAll('.g-fleet .fl-flash, .g-fleet .fl-shell').length) === 0, `[${tag}] flash and shells are removed again`);
  }
  await h.closeGame(a); await h.closeGame(b);
}

// ── (d) the finale: the winner gets paper confetti, which removes itself ──
async function finaleTest(h) {
  const { a, b } = h;
  const id = await h.newOnlineGame(a, 'fleet');
  await h.openMatch(b, id);
  await h.settle();
  const first = h.matches().find((m) => m.id === id).first;
  const hitCells = FLEETS.b.flatMap(cellsOf);
  const last = hitCells.pop();
  const lists = { a: [{ fleet: FLEETS.a }, ...hitCells.map(([r, c]) => ({ r, c }))], b: [{ fleet: FLEETS.b }] };
  if (first === 'b') lists.b.push({ r: 6, c: 6 }); // b opens with a miss so a has the move; a's hits keep it
  await a.evaluate(([mid, L]) => globalThis.claude.use('db').then((db) => db.doc('matches/' + mid).update({ a: JSON.stringify(L.a), b: JSON.stringify(L.b) })), [id, lists]);
  const total = lists.a.length + lists.b.length;
  await waitMoves(h, id, total);
  for (const pg of [a, b]) {
    await pg.emulateMedia({ reducedMotion: 'no-preference' });
    await pg.evaluate(() => {
      window.__seen = { conf: 0, flash: 0 };
      new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) { if (n.nodeType === 1 && /fl-conf/.test(n.className || '')) window.__seen.conf++; if (n.nodeType === 1 && /fl-flash/.test(n.className || '')) window.__seen.flash++; } }).observe(document.getElementById('game-root'), { childList: true, subtree: true });
    });
  }
  await a.waitForSelector('.g-fleet .fl-target.is-live');
  await a.tap(cellSel(last[0], last[1]));
  const t0 = Date.now();
  await waitMoves(h, id, total + 1);
  await h.wait(2000);
  const sa = await a.evaluate(() => ({ ...window.__seen }));
  const sb = await b.evaluate(() => ({ ...window.__seen }));
  assert(sa.conf >= 20, `[finale] the winner's chart throws confetti (${sa.conf} pieces)`);
  assert(sb.conf === 0, '[finale] the loser sees none');
  assert(sa.flash >= 1, '[finale] the last ship goes down with a flash');
  assert(await a.isVisible('#game-root .gm-end') && await b.isVisible('#game-root .gm-end'), `[finale] the end card still comes up on time (${Date.now() - t0} ms after the last shot)`);
  await h.wait(1500);
  assert(await a.evaluate(() => document.querySelectorAll('.g-fleet .fl-conf').length) === 0, '[finale] the confetti has removed itself');
  await a.click('#game-root [data-g="end-look"]');
  await h.wait(300);
  assert(await a.evaluate(() => document.querySelectorAll('.g-fleet .fl-ship.is-ghost, .g-fleet .fl-ship.is-wreck').length) === 5, '[finale] the final board shows all five of her ships');
  await h.closeGame(a); await h.closeGame(b);
}

// ── (e) + (f) the printed look, and the heading that must stay plain ──
async function looksTest(h, scheme) {
  const { a } = h;
  await startBattle(h);
  const r = await a.evaluate(() => {
    const cs = (sel) => getComputedStyle(document.querySelector(sel));
    const grid = cs('.g-fleet .fl-target .fl-sea');
    const home = cs('.g-fleet .fl-home .fl-sea');
    const props = ['cursor', 'touchAction', 'userSelect', 'transition', 'animationName', 'pointerEvents', 'webkitTapHighlightColor', 'outlineStyle', 'textDecorationLine'];
    const target = cs('.g-fleet .fl-target .fl-h');
    const homeH = cs('.g-fleet .fl-home .fl-h');
    const targetHead = cs('.g-fleet .fl-target .fl-head');
    const homeHead = cs('.g-fleet .fl-home .fl-head');
    const rules = [];
    const walk = (list) => { for (const x of list) { if (x.cssRules && !x.selectorText) walk(x.cssRules); if (x.selectorText) rules.push(x); } };
    for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch { /* cross-origin */ } }
    const headRules = rules.filter((x) => /(^|[^\w-])\.fl-(head|h)([^\w-]|$)/.test(x.selectorText) && /\.g-fleet/.test(x.selectorText));
    return {
      seaLayer: grid.willChange + '/' + home.willChange, gridPaint: cs('.g-fleet .fl-target .fl-grid').backgroundImage,
      gridBg: grid.backgroundImage, homeBg: home.backgroundImage, seaA: grid.getPropertyValue('--sea'), seaB: home.getPropertyValue('--sea'),
      shadow: target.textShadow, same: props.filter((p) => target[p] !== homeH[p] || targetHead[p] !== homeHead[p]),
      headRuleCount: headRules.length, headBad: headRules.filter((x) => /:(active|hover|focus|focus-visible|focus-within)/.test(x.selectorText) || x.style.cursor || x.style.touchAction || x.style.pointerEvents || x.style.userSelect).map((x) => x.selectorText),
      hull: document.querySelectorAll('.g-fleet .fl-home .fl-ship .fl-hull-line').length, dots: document.querySelectorAll('.g-fleet .fl-home .fl-dots').length,
      tooth: getComputedStyle(document.querySelector('.g-fleet .fl-log')).backgroundImage,
    };
  });
  assert(/url\(/.test(r.gridBg) && /radial-gradient/.test(r.gridBg), `[riso ${scheme}] the target chart is paper grain + printed wave lines`);
  assert(r.seaLayer === 'transform/transform' && r.gridPaint === 'none', `[riso ${scheme}] the printed sea is its own cached layer, so firing never repaints it (${r.seaLayer})`);
  assert(/url\(/.test(r.homeBg) && /radial-gradient/.test(r.homeBg), `[riso ${scheme}] and so is the home chart`);
  assert(r.seaA && r.seaB && r.seaA !== r.seaB, `[riso ${scheme}] each sea is printed in its owner's ink (${r.seaA.trim()} / ${r.seaB.trim()})`);
  assert(r.shadow && r.shadow !== 'none', `[riso ${scheme}] headings are printed off register`);
  assert(/url\(/.test(r.tooth), `[riso ${scheme}] panels carry the paper tooth`);
  assert(r.hull === 5, `[riso ${scheme}] ships are drawn as two-plate pieces`);
  assert(!r.same.length, `[hidden ${scheme}] the target heading looks and behaves like every other heading (differs in: ${r.same.join(', ') || 'nothing'})`);
  assert(r.headRuleCount >= 2 && !r.headBad.length, `[hidden ${scheme}] no heading rule sets a cursor, press state, hover or touch behaviour (${r.headBad.join(' | ') || 'none of ' + r.headRuleCount + ' rules'})`);
  await h.shot(a, path.join(process.env.SHOTS || require('os').tmpdir(), `flat-fleet-${scheme}.png`), { scale: 'css' });
  await h.closeGame(a); await h.closeGame(h.b);
}

(async () => {
  let h = null;
  try {
    h = await launch({ port: PORT, only: ['fleet'], coarse: true });
    await dragTest(h);
    await battleTest(h, { reduced: false });
    await battleTest(h, { reduced: true });
    await finaleTest(h);
    await looksTest(h, 'light');
    h.assertNoErrors();
    await h.close();
    h = await launch({ port: PORT + 1, only: ['fleet'], colorScheme: 'dark', coarse: true });
    await looksTest(h, 'dark');
    h.assertNoErrors();
    await h.close();
    h = null;
    console.log('\nALL GOOD');
  } catch (e) {
    console.error(e.stack || e.message);
    if (h) console.error('errors:', h.errors);
    process.exitCode = 1;
  } finally {
    if (h) await h.close().catch(() => {});
  }
})();
