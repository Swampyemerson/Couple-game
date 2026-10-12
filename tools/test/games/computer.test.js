// Light Cycles and Defuse: the two computer-first live games.
//   node tools/test/games/computer.test.js          (SHOTS=/some/dir to choose where screenshots go)
//
// Phones (390×844) and laptops (1280×800), light and dark. Two simulated devices share a fake
// live room with ~40 ms of jittery latency.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'just-us-shots', 'computer');
const PORT = Number(process.env.PORT) || 8880; // PORT=8950 node … uses PORT..PORT+4
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 10000, step = 40) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('FAIL: timed out waiting for ' + what);
    await sleep(step);
  }
}
const shot = async (pg, name) => { await pg.screenshot({ path: path.join(SHOTS, name + '.png') }); console.log('   shot', name); };
const cy = (pg) => pg.evaluate(() => window.__cycles && window.__cycles.info());
const dx = (pg) => pg.evaluate(() => window.__defuse && window.__defuse.info());
const visible = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.getClientRects().length > 0; }, sel);
const noSideScroll = (pg) => pg.evaluate(() => { const r = document.getElementById('game-root'); return r.scrollWidth <= r.clientWidth + 1; });

async function asPhones(h) { for (const pg of [h.a, h.b]) await pg.setViewportSize({ width: 390, height: 844 }); }
async function asLaptops(h) {
  // a real laptop: fine pointer, no touch screen
  for (const pg of [h.a, h.b]) {
    const s = await pg.context().newCDPSession(pg);
    await s.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await pg.setViewportSize({ width: 1280, height: 800 });
  }
}
async function goLive(h, game) {
  await h.startLive(h.a, game, 'live');
  await h.settle();
  await until(() => visible(h.b, '#gm-invite'), 'the live invite');
  await h.b.click('#gm-invite [data-g="invite-yes"]');
  await h.settle(); await h.settle();
}
async function closeBoth(h) {
  for (const pg of [h.a, h.b]) if (await visible(pg, '#game-root .gm')) await h.closeGame(pg);
  await h.settle();
}

// ══════════════════════════ Light Cycles ══════════════════════════
const sameState = (x, y) => JSON.stringify(x) === JSON.stringify(y);
/** Play one live round: wait for it to run, steer, then check both devices agree. */
async function liveRound(h, n, steer) {
  await until(async () => { const x = await cy(h.a); return x && x.round === n && x.phase === 'run'; }, `round ${n} to start`, 12000, 25);
  await steer();
  const A = await until(async () => { const x = await cy(h.a); return x && x.round === n && (x.phase === 'end' || x.phase === 'over') ? x : null; }, `round ${n} to end on the host`, 15000, 30);
  const B = await until(async () => { const x = await cy(h.b); return x && x.round === n && (x.phase === 'end' || x.phase === 'over') && x.sim && x.sim.t === A.sim.t ? x : null; }, `round ${n} to end on the guest`, 6000, 30);
  assert(sameState(A.sim, A.rebuilt), `round ${n}: host's live sim equals the rebuild from its turn log`);
  assert(sameState(A.sim, B.sim), `round ${n}: both devices show the same trails (tick ${A.sim.t}, lengths ${A.sim.a.len}/${A.sim.b.len})`);
  assert(A.log === B.log && A.rw === B.rw, `round ${n}: same turn log and same round result (${A.rw})`);
  return A;
}
/** The pre-match picker: the host taps an arena and Boosts (Classic, no boosts by default) and then GO. */
async function pickGo(pg, { arena = 'classic', boosts = false } = {}) {
  await until(() => visible(pg, '.cy-pick .cy-go'), 'the arena picker', 8000);
  await pg.click(`.cy-chip[data-arena="${arena}"]`);
  const on = (await pg.getAttribute('.cy-boost', 'aria-checked')) === 'true';
  if (on !== boosts) await pg.click('.cy-boost');
  await pg.click('.cy-go');
}
const turnsOf = (log, p) => log.split(',').filter(Boolean).filter((e) => (+e.slice(-1) < 4) === (p === 'a'));

async function cyclesLivePhones(h) {
  console.log('\n# Light Cycles, live on two phones');
  await goLive(h, 'cycles');
  // the guest watches the host pick: names, the live choice, no GO button of its own
  await until(() => visible(h.b, '.cy-pick.is-ro'), 'the guest to see the picker');
  assert(/Emerson is picking/.test(await h.b.textContent('.cy-pick-t')) && !(await visible(h.b, '.cy-go')), 'guest sees "Emerson is picking…" and no GO');
  await h.a.click('.cy-chip[data-arena="rings"]');
  await until(async () => (await h.b.getAttribute('.cy-chip[data-arena="rings"]', 'aria-checked')) === 'true', 'the guest to see the live choice');
  assert(true, 'guest sees the host\'s live choice (Rings)');
  await pickGo(h.a);
  const i0 = await until(async () => { const a = await cy(h.a); const b = await cy(h.b); return a && b && a.layout && b.layout ? [a, b] : null; }, 'both grids');
  assert(i0[0].layout === 'p' && i0[1].layout === 'p', 'phones agree on the portrait grid');
  assert(i0[0].host && !i0[1].host && i0[1].flip, 'host simulates; the guest sees the board turned round');
  assert(await visible(h.b, '.cy-pad.p-b'), 'guest phone shows its D-pad');

  // round 1: both steer with keys. Sydney turns (her) left into a wall; Emerson jinks left then up.
  const r1 = await liveRound(h, 1, async () => {
    await h.b.keyboard.press('ArrowLeft');
    await h.a.keyboard.press('a'); await sleep(170); await h.a.keyboard.press('w');
    await sleep(400);
    await shot(h.a, 'cycles-phone-live-host-light');
    await shot(h.b, 'cycles-phone-live-guest-light');
  });
  assert(turnsOf(r1.log, 'a').length === 2 && turnsOf(r1.log, 'b').length === 1, 'round 1: both players\' key turns are in the log');
  assert(r1.rw === 'a', 'round 1: Emerson takes it');
  await shot(h.b, 'cycles-phone-roundend-guest-light');

  // round 2: Sydney steers with a swipe, Emerson dives into the bottom wall
  const r2 = await liveRound(h, 2, async () => {
    await h.a.keyboard.press('d'); await sleep(170); await h.a.keyboard.press('s');
    const box = await h.b.locator('.cy-board canvas').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await h.b.mouse.move(x, y); await h.b.mouse.down(); await h.b.mouse.move(x - 70, y + 4, { steps: 6 }); await h.b.mouse.up();
  });
  assert(turnsOf(r2.log, 'b').length === 1 && r2.sim.b.d === 1, 'round 2: Sydney\'s swipe turned her bike');
  assert(r2.rw === 'b', 'round 2: Sydney takes it');

  // round 3: nobody steers: head-on in the same cell is a draw
  const r3 = await liveRound(h, 3, async () => {});
  assert(r3.rw === 'd' && !r3.sim.a.alive && !r3.sim.b.alive && sameState(r3.sim.a.crash, r3.sim.b.crash), 'round 3: head-on into the same cell is a draw round');

  // round 4: Sydney's key turn shows as an intent arrow before the host confirms it
  const r4 = await liveRound(h, 4, async () => {
    const pend = await h.b.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true })); return window.__cycles.info().pending; });
    assert(pend.length === 1 && pend[0] === 1, 'guest shows its own turn at once (intent hint) while the host confirms it');
  });
  assert(r4.rw === 'a', 'round 4: Emerson takes it');

  // round 5: Sydney taps her D-pad
  const r5 = await liveRound(h, 5, async () => { await h.b.click('.cy-pad .cy-key[data-d="3"]'); });
  assert(r5.rw === 'a' && turnsOf(r5.log, 'b').length === 1, 'round 5: the D-pad steers; Emerson takes it');
  await until(async () => await visible(h.a, '#game-root .gm-end') && await visible(h.b, '#game-root .gm-end'), 'end card on both phones', 6000);
  assert(true, 'best of 5 ends with the end card on both phones');
  await until(() => h.results().some((r) => r.game === 'cycles'), 'the cycles result', 4000);
  await h.settle();
  const res = h.results().filter((r) => r.game === 'cycles');
  assert(res.length === 1 && res[0].winner === 'a', 'one result recorded (Emerson wins 3–1)');
  const sizes = [...(h.roomState['ju-cycles'] || new Map()).values()].map((p) => JSON.stringify(p.presence || {}).length);
  assert(sizes.length === 2 && Math.max(...sizes) < 3500, `presence stays small (${sizes.join(' / ')} bytes)`);
  const sc = await h.b.evaluate(() => [...document.querySelectorAll('#game-root [data-score]')].map((x) => x.textContent).join('-'));
  assert(sc === '3-1', 'guest chips show 3–1');
  await sleep(400);
  await shot(h.a, 'cycles-phone-end-host-light');
  await shot(h.b, 'cycles-phone-end-guest-light');
  await closeBoth(h);
}

/** One computer (or one phone): returns info when the given round is running. */
async function localRun(pg, n) {
  return until(async () => { const x = await cy(pg); return x && x.round === n && x.phase === 'run' ? x : null; }, `local round ${n}`, 12000, 25);
}
async function localEnd(pg, n) {
  return until(async () => { const x = await cy(pg); return x && x.round === n && (x.phase === 'end' || x.phase === 'over') ? x : null; }, `local round ${n} to end`, 15000, 30);
}

async function cyclesLocalLaptop(h, scheme) {
  console.log(`\n# Light Cycles, one computer (${scheme})`);
  const pg = h.a;
  await h.startLive(pg, 'cycles', 'local');
  await pickGo(pg);
  let i = await localRun(pg, 1);
  assert(i.layout === 's' && !i.touch, 'square grid with key legends on a laptop');
  assert(await visible(pg, '.cy-legend.p-a') && await visible(pg, '.cy-legend.p-b') && !(await visible(pg, '.cy-pad')), 'both key legends, no touch pads');
  if (scheme === 'light') {
    await pg.keyboard.press('w');
    await pg.keyboard.press('ArrowDown');
    await sleep(260);
    i = await cy(pg);
    assert(turnsOf(i.log, 'a').length === 1 && turnsOf(i.log, 'b').length === 1 && i.sim.a.d === 0 && i.sim.b.d === 2, 'W A S D steers Emerson and the arrows steer Sydney');
    const y0 = i.sim.a.y;
    await pg.keyboard.press('s'); // straight back the way she came: refused
    await sleep(260);
    i = await cy(pg);
    assert(i.sim.a.d === 0 && i.sim.a.y < y0 && turnsOf(i.log, 'a').length === 1, 'no 180° reversals');
    await shot(pg, 'cycles-laptop-local-light');
    const e1 = await localEnd(pg, 1);
    const r2 = await localRun(pg, 2);
    assert(e1.rw === 'd' && r2.cfg.sv > 0 && r2.cfg.ar === 'classic', 'round 1 was a draw: round 2 starts from a staggered, symmetric start (Classic otherwise starts on the centre line)');
    const e = await localEnd(pg, 2);
    assert(e.rw === 'd' && !e.sim.a.alive && !e.sim.b.alive, 'one computer: riding straight on from the staggered start is a draw too (both reach the far walls together)');
    await sleep(250);
    await shot(pg, 'cycles-laptop-headon-light');
  } else {
    await sleep(700);
    await shot(pg, 'cycles-laptop-local-' + scheme);
    await localEnd(pg, 1);
  }
  // let Sydney win the rest quickly: Emerson turns up and then back into the left wall
  for (;;) {
    const cur = await cy(pg);
    if (cur.phase === 'over') break;
    const r = cur.phase === 'end' ? cur.round + 1 : cur.round;
    await localRun(pg, r);
    await pg.keyboard.press('w'); await sleep(160); await pg.keyboard.press('a');
    const e = await localEnd(pg, r);
    if (e.phase === 'over' || e.score.b >= 3) break;
  }
  await until(() => visible(pg, '#game-root .gm-end'), 'local end card', 6000);
  assert(true, 'one-computer match reaches the end card');
  await sleep(500);
  await shot(pg, 'cycles-laptop-end-' + scheme);
  await h.closeGame(pg);
  await h.settle();
}

async function cyclesLocalPhone(h, scheme) {
  console.log(`\n# Light Cycles, one phone (${scheme})`);
  const pg = h.a;
  await h.startLive(pg, 'cycles', 'local');
  await pickGo(pg);
  let i = await localRun(pg, 1);
  assert(i.layout === 'p' && i.touch && await visible(pg, '.cy-pad.p-a') && await visible(pg, '.cy-pad.p-b.is-rot'), 'one phone: a D-pad at each end, the far one turned round');
  // Sydney sits at the top: her pad's left is the screen's right, her pad's up is the screen's down
  await pg.click('.cy-pad.p-b .cy-key[data-d="3"]'); await sleep(170); await pg.click('.cy-pad.p-b .cy-key[data-d="0"]');
  await pg.click('.cy-pad.p-a .cy-key[data-d="3"]'); // Emerson heads for the left wall
  await sleep(250);
  i = await cy(pg);
  const bDirs = turnsOf(i.log, 'b').map((e) => +e.slice(-1) & 3);
  assert(sameState(bDirs, [1, 2]) && i.sim.b.x > 15, 'the far D-pad is mapped from its player\'s side');
  await sleep(300);
  await shot(pg, 'cycles-phone-local-' + scheme);
  assert(await noSideScroll(pg), 'no sideways scroll on a phone');
  const e = await localEnd(pg, 1);
  assert(e.rw === 'b', 'one phone: Emerson\'s pad steered him into the wall');
  await sleep(300);
  await shot(pg, 'cycles-phone-roundend-' + scheme);
  await pg.setViewportSize({ width: 360, height: 740 });
  await sleep(300);
  assert(await noSideScroll(pg), 'fits a 360 px phone');
  await shot(pg, 'cycles-phone360-local-' + scheme);
  // turned on its side mid-match: the pads move beside the board and nothing scrolls
  await pg.setViewportSize({ width: 844, height: 390 });
  await sleep(400);
  const land = await pg.evaluate(() => {
    const r = document.getElementById('game-root');
    const inView = (el) => { const b = el.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight + 1 && b.left >= 0 && b.right <= innerWidth + 1; };
    return { over: r.scrollHeight - r.clientHeight, pads: [...document.querySelectorAll('.cy-pad .cy-key')].every(inView), board: inView(document.querySelector('.cy-board canvas')) };
  });
  assert(land.over <= 1 && land.pads && land.board, `phone on its side: board and both D-pads on screen (overflow ${land.over}px)`);
  await shot(pg, 'cycles-phone-landscape-local-' + scheme);
  await pg.setViewportSize({ width: 390, height: 844 });
  await h.closeGame(pg);
  await h.settle();
}

async function cyclesLiveLaptops(h, scheme) {
  console.log(`\n# Light Cycles, live on two laptops (${scheme})`);
  await goLive(h, 'cycles');
  await pickGo(h.a);
  const i = await until(async () => { const a = await cy(h.a); const b = await cy(h.b); return a && b && b.layout && a.phase === 'run' ? [a, b] : null; }, 'live laptops running', 12000, 25);
  assert(i[0].layout === 's' && i[1].layout === 's', 'two laptops play on the square grid');
  await h.b.keyboard.press('KeyW'); // either key set steers on a laptop
  await h.a.keyboard.press('ArrowUp');
  await sleep(700);
  await shot(h.a, `cycles-laptop-live-host-${scheme}`);
  await shot(h.b, `cycles-laptop-live-guest-${scheme}`);
  const x = await cy(h.a);
  assert(turnsOf(x.log, 'a').length === 1 && turnsOf(x.log, 'b').length === 1, 'both laptops steer (arrows on one, W A S D on the other)');
  if (scheme === 'light') {
    // Sydney drops out mid-round and comes back: the host pauses, then her new turns still count
    await h.closeGame(h.b);
    await until(async () => (await cy(h.a)).paused, 'the host to pause');
    assert(true, 'host pauses when the guest drops');
    await h.startLive(h.b, 'cycles', 'live');
    const back = await until(async () => { const p = await cy(h.a); return !p.paused && p.phase === 'run' ? p : null; }, 'play to resume', 12000, 25);
    const before = turnsOf(back.log, 'b').length;
    const target = (back.sim.b.d + 1) & 3; // a quarter turn from wherever she is heading
    await h.b.keyboard.press(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][(target + 2) & 3]); // her board is turned round
    await sleep(400);
    const after = await cy(h.a);
    assert(after.round === back.round && turnsOf(after.log, 'b').length === before + 1, 're-joined guest steers again in the same round');
  }
  await closeBoth(h);
}

// ── Light Cycles: arenas, power-ups, swipes, landscape, replay, records, latency ──
/** Pure checks of the simulation inside the page (the game's own code, not a copy). */
async function cyclesUnits(h) {
  console.log('\n# Light Cycles: arenas, boosts, jump, near misses, speed ramp (pure simulation)');
  const pg = h.a;
  await h.startLive(pg, 'cycles', 'local');
  await until(() => cy(pg), 'the cycles hook');
  const r = await pg.evaluate(() => {
    const H = window.__cycles;
    const out = { arenas: [], bad: [] };
    for (const L of ['s', 'p', 'l']) {
      for (const ar of ['classic', 'pillars', 'cross', 'rings', 'scatter']) {
        for (const sd of [1, 77, 123456, 987654321]) {
          const cfg = { L, ar, sd, bo: 1, sv: ar === 'classic' ? 0 : sd % 97 + 1, rm: 'r' };
          const m = H.make(cfg);
          const m2 = H.make(cfg);
          const toks = new Set(m.toks.map((t) => t.join(',')));
          const W = { s: 49, p: 31, l: 41 }[L];
          const Hh = { s: 49, p: 45, l: 27 }[L];
          const pairs = m.toks.every((t) => toks.has([W - 1 - t[0], Hh - 1 - t[1], t[2]].join(',')));
          const st = m.st;
          const symStart = st.a[0] + st.b[0] === W - 1 && st.a[1] + st.b[1] === Hh - 1 && ((st.a[2] + 2) & 3) === st.b[2];
          if (!m.sym) out.bad.push(`${L}/${ar}/${sd}: blocks not symmetric`);
          if (!pairs) out.bad.push(`${L}/${ar}/${sd}: tokens not in symmetric pairs`);
          if (!symStart) out.bad.push(`${L}/${ar}/${sd}: starts not symmetric`);
          if (m.obs !== m2.obs) out.bad.push(`${L}/${ar}/${sd}: not deterministic`);
          if ((ar === 'classic') !== (m.blocks === 0)) out.bad.push(`${L}/${ar}/${sd}: block count ${m.blocks}`);
          if (m.toks.length < 4) out.bad.push(`${L}/${ar}/${sd}: only ${m.toks.length} tokens`);
          out.arenas.push(`${L}/${ar}`);
        }
      }
    }
    out.scatterVaries = H.make({ L: 'p', ar: 'scatter', sd: 1, bo: 0, sv: 1, rm: 'r' }).obs !== H.make({ L: 'p', ar: 'scatter', sd: 2, bo: 0, sv: 1, rm: 'r' }).obs;
    out.starts = new Set([1, 2, 3, 4, 5, 6].map((sv) => JSON.stringify(H.make({ L: 'p', ar: 'pillars', sd: 5, bo: 0, sv, rm: 'r' }).st))).size;
    out.ramp = { c0: H.ramp({ rm: 'c' }, 0), c400: H.ramp({ rm: 'c' }, 400), r0: H.ramp({ rm: 'r' }, 0), r400: H.ramp({ rm: 'r' }, 400) };
    let ms = 0; let t = 0;
    while (H.ramp({ rm: 'r' }, t) > 50.001) { ms += H.ramp({ rm: 'r' }, t); t++; }
    out.rampSecs = ms / 1000;
    // boost: ride over a boost token on the centre row, then move two cells a tick for 8 ticks
    const { newSim, step } = H.lib;
    let found = null;
    for (let sd = 1; sd < 20000 && !found; sd++) {
      const s = newSim({ L: 's', ar: 'classic', sd, bo: 1, sv: 0, rm: 'c' });
      const tk = s.tl.find((q) => q.y === 24 && q.k === 1 && q.x > 8 && q.x < 15);
      if (tk && s.tl.filter((q) => q.y === 24).length === 2) found = { sd, tk }; // the only tokens on the row are this pair
    }
    out.foundBoost = !!found;
    if (found) {
      const s = newSim({ L: 's', ar: 'classic', sd: found.sd, bo: 1, sv: 0, rm: 'c' });
      step(s, { b: 0 }); // the other rider turns away, up the board
      while (s.a.x < found.tk.x) step(s, {});
      out.boostSet = s.a.boost;
      const xs = [];
      for (let i = 0; i < 10; i++) { const x0 = s.a.x; step(s, {}); xs.push(s.a.x - x0); if (s.done) break; }
      out.boostSteps = xs;
    }
    // jump: pass over one trail cell, the second one is a crash; the outer wall is never passable
    {
      const s = newSim({ L: 's', ar: 'classic', sd: 1, bo: 0, sv: 0, rm: 'c' });
      s.occ[24 * 49 + 10] = 2; s.a.jump = 1;
      for (let i = 0; i < 6; i++) step(s, {});
      out.jumpPassed = s.a.alive && s.a.x === 12 && s.a.jump === 0;
      s.occ[24 * 49 + 14] = 2;
      for (let i = 0; i < 4 && !s.done; i++) step(s, {});
      out.jumpOnce = !s.a.alive && s.a.ck === 'squeeze' || s.a.ck === 'trail';
      const w = newSim({ L: 's', ar: 'classic', sd: 1, bo: 0, sv: 0, rm: 'c' });
      w.a.jump = 1; w.a.x = 47; w.occ[24 * 49 + 47] = 1; w.a.path = [47, 24]; w.a.pi = [0];
      step(w, {}); step(w, {});
      out.wallHolds = !w.a.alive && w.a.ck === 'wall';
    }
    // near miss: three cells alongside a block counts once; a squeeze counts at once
    {
      const s = newSim({ L: 's', ar: 'classic', sd: 1, bo: 0, sv: 0, rm: 'c' });
      for (let x = 10; x <= 14; x++) s.occ[23 * 49 + x] = 3;
      for (let i = 0; i < 12; i++) step(s, {});
      out.shave = s.a.sh;
      const q = newSim({ L: 's', ar: 'classic', sd: 1, bo: 0, sv: 0, rm: 'c' });
      for (let x = 10; x <= 11; x++) { q.occ[23 * 49 + x] = 3; q.occ[25 * 49 + x] = 3; }
      for (let i = 0; i < 8; i++) step(q, {});
      out.squeeze = q.a.sh;
      out.shaveEv = s.ev.filter((e) => e.k === 'shave').length;
    }
    return out;
  });
  assert(r.bad.length === 0, `arenas: symmetric blocks, symmetric token pairs, symmetric starts, deterministic (${r.arenas.length} configs${r.bad.length ? ': ' + r.bad.slice(0, 3).join('; ') : ''})`);
  assert(r.scatterVaries && r.starts >= 4, `scatter differs by seed; start variants differ (${r.starts} of 6 distinct)`);
  assert(r.ramp.c0 === 78 && Math.abs(r.ramp.c400 - 70) < 0.01 && r.ramp.r0 === 78 && r.ramp.r400 === 50, `speed ramp: classic 78→70 as today, others 78→50 (${JSON.stringify(r.ramp)})`);
  assert(r.rampSecs > 17 && r.rampSecs < 23, `the ramp takes about 20 s (${r.rampSecs.toFixed(1)} s)`);
  assert(r.foundBoost && r.boostSet === 8 && r.boostSteps.slice(0, 8).every((d) => d === 2) && r.boostSteps[8] === 1, `a boost token gives 2 cells per tick for 8 ticks, then 1 (${r.boostSteps})`);
  assert(r.jumpPassed && r.jumpOnce && r.wallHolds, 'a jump token passes one trail cell once, not the second, and never the outer wall');
  assert(r.shave === 1 && r.shaveEv === 1 && r.squeeze === 1, `near misses: 3 cells alongside a block is one close shave, a squeeze is one (${r.shave}/${r.squeeze})`);
  await h.closeGame(pg);
  await h.settle();
}

/** Real touch: a swipe on the top half of a phone turns the top rider the way the finger went (the old bug turned it round). */
const touchSwipe = async (pg, x0, y0, x1, y1) => {
  const s = await pg.context().newCDPSession(pg);
  const pt = (x, y) => ({ x: Math.round(x), y: Math.round(y), id: 1 });
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(x0, y0)] });
  for (let i = 1; i <= 6; i++) await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6)] });
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await s.detach().catch(() => {});
};
async function cyclesTouchAndReplay(h) {
  console.log('\n# Light Cycles, one phone: real swipes on both halves, the crash replay, records');
  const pg = h.a;
  await h.startLive(pg, 'cycles', 'local');
  await pickGo(pg);
  await localRun(pg, 1);
  const box = await pg.locator('.cy-board canvas').boundingBox();
  const cx = box.x + box.width / 2;
  // top half: Sydney rides down; a swipe to the RIGHT must send her right (world 1), as the finger moved
  await touchSwipe(pg, cx - 30, box.y + box.height * 0.2, cx + 50, box.y + box.height * 0.2 + 2);
  // then a swipe down on the same half: she is going right, so down is a quarter turn
  await touchSwipe(pg, cx, box.y + box.height * 0.15, cx, box.y + box.height * 0.15 + 70);
  // bottom half: Emerson rides up; a swipe to the LEFT must send him left (world 3)
  await touchSwipe(pg, cx + 30, box.y + box.height * 0.8, cx - 50, box.y + box.height * 0.8 + 2);
  await sleep(200);
  const i = await cy(pg);
  const dirs = (p) => turnsOf(i.log, p).map((e) => +e.slice(-1) & 3);
  assert(sameState(dirs('b'), [1, 2]), `top-half swipes right then down turn Sydney right then down on screen (${dirs('b')})`);
  assert(sameState(dirs('a'), [3]), `bottom-half swipe left turns Emerson left on screen (${dirs('a')})`);
  // the crash replay: crash, zoomed replay with a caption, a tap skips, then the banner with close shaves
  await until(async () => (await cy(pg)).stage === 'replay', 'the replay', 12000, 30);
  await until(async () => (await pg.textContent('.cy-rp-cap')).length > 3, 'the replay caption', 1500, 30);
  assert(await visible(pg, '.cy-rp.is-on') && (await pg.textContent('.cy-rp-cap')).length > 3, `the replay shows with a caption ("${await pg.textContent('.cy-rp-cap')}")`);
  await shot(pg, 'cycles-phone-replay-light');
  await pg.locator('.cy-board').click({ position: { x: 40, y: 200 } });
  await until(async () => (await cy(pg)).stage === 'banner', 'a tap to skip the replay', 2000, 30);
  await sleep(500);
  const ban = await pg.textContent('.cy-msg');
  assert(/Close shaves: \d+/.test(ban), `the round banner counts close shaves ("${ban.replace(/\s+/g, ' ').trim()}")`);
  await shot(pg, 'cycles-phone-banner-light');
  const d1 = (h.docs['gamedata/cycles'] || {});
  assert(d1.cy_long_n > 0 && typeof d1.cy_long_who === 'string', `the longest ride is recorded (${d1.cy_long_n} ticks, ${d1.cy_long_who})`);
  assert(d1.cycles_last === 'classic' && d1.cycles_boosts === false, 'the last arena choice is remembered');
  await h.closeGame(pg);
  await h.settle();
}

async function cyclesLandscape(h) {
  console.log('\n# Light Cycles: a phone on its side (844×390)');
  const pg = h.a;
  await pg.setViewportSize({ width: 844, height: 390 });
  await h.startLive(pg, 'cycles', 'local');
  await until(() => visible(pg, '.cy-pick .cy-go'), 'the picker in landscape');
  const pk = await pg.evaluate(() => { const r = document.getElementById('game-root'); const b = document.querySelector('.cy-go').getBoundingClientRect(); const chips = [...document.querySelectorAll('.cy-chip')].map((c) => c.getBoundingClientRect()); return { over: r.scrollHeight - r.clientHeight, goIn: b.bottom <= innerHeight + 1, minH: Math.min(...chips.map((c) => c.height)), minW: Math.min(...chips.map((c) => c.width)) }; });
  assert(pk.over <= 1 && pk.goIn && pk.minH >= 44 && pk.minW >= 44, `landscape picker fits with big targets (chips ≥ ${Math.round(pk.minW)}×${Math.round(pk.minH)}, overflow ${pk.over})`);
  await shot(pg, 'cycles-phone-landscape-picker-light');
  await pickGo(pg, { arena: 'pillars', boosts: true });
  const i = await localRun(pg, 1);
  assert(i.layout === 'l' && i.cell >= 7, `a landscape grid with big cells (layout ${i.layout}, ${i.cell} px per cell)`);
  const land = await pg.evaluate(() => {
    const r = document.getElementById('game-root');
    const inView = (el) => { const b = el.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight + 1 && b.left >= 0 && b.right <= innerWidth + 1; };
    return { over: r.scrollHeight - r.clientHeight, pads: [...document.querySelectorAll('.cy-pad .cy-key')].every(inView), board: inView(document.querySelector('.cy-board canvas')) };
  });
  assert(land.over <= 1 && land.pads && land.board, `board and both pads on screen (overflow ${land.over}px)`);
  await sleep(500);
  await shot(pg, 'cycles-phone-landscape-run-light');
  // the replay caption and the round banner stay inside a short board
  await until(async () => (await cy(pg)).stage === 'replay', 'the replay on the landscape board', 15000, 30);
  await sleep(700);
  const inside = (sel) => pg.evaluate((q) => { const c = document.querySelector('.cy-board canvas').getBoundingClientRect(); const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return b.left >= c.left - 1 && b.right <= c.right + 1 && b.top >= c.top - 1 && b.bottom <= c.bottom + 1; }, sel);
  assert(await inside('.cy-rp-cap') === true, 'landscape: the replay caption sits inside the board');
  await until(async () => (await cy(pg)).stage === 'banner', 'the banner on the landscape board', 4000, 30);
  await sleep(600);
  assert(await inside('.cy-msg > span') === true, 'landscape: the round banner sits inside the board');
  // a rotate mid-match: the grid changes from the next round
  await pg.setViewportSize({ width: 390, height: 844 });
  await sleep(400);
  const e = await localEnd(pg, 1);
  const n = await localRun(pg, 2);
  assert(e.layout === 'l' && n.layout === 'p' && n.cell >= 7, `turned upright mid-match: round 1 stays landscape, round 2 gets the portrait grid (${e.layout} → ${n.layout}, ${n.cell} px)`);
  await h.closeGame(pg);
  await pg.setViewportSize({ width: 390, height: 844 });
  await h.settle();
}

/** A small phone on its side (667×375) also gets the wide grid, with pads that leave room for it. */
async function cyclesSmallLandscape(h) {
  console.log('\n# Light Cycles: a small phone on its side (667×375, 568×320)');
  const pg = h.a;
  for (const [w, hh, minCell] of [[667, 375, 5], [568, 320, 4.75]]) {
    await pg.setViewportSize({ width: w, height: hh });
    await h.startLive(pg, 'cycles', 'local');
    // the picker keeps GO in view without scrolling
    await until(() => visible(pg, '.cy-pick .cy-go'), 'the picker');
    const pk = await pg.evaluate(() => { const r = document.getElementById('game-root'); const g = document.querySelector('.cy-go').getBoundingClientRect(); return { over: r.scrollHeight - r.clientHeight, goIn: g.bottom <= innerHeight && g.height >= 44 }; });
    assert(pk.over <= 0 && pk.goIn, `${w}×${hh}: the picker fits with GO in view (overflow ${pk.over}px)`);
    await pickGo(pg, { arena: 'cross' });
    const i = await localRun(pg, 1);
    const f = await pg.evaluate(() => {
      const keys = [...document.querySelectorAll('.cy-key')].map((e) => e.getBoundingClientRect());
      const pads = [...document.querySelectorAll('.cy-pad')].map((e) => e.getBoundingClientRect());
      return { k: Math.min(...keys.map((b) => Math.min(b.width, b.height))), padsIn: pads.every((b) => b.left >= 0 && b.right <= innerWidth) && keys.every((b) => b.left >= 0 && b.right <= innerWidth), over: document.getElementById('game-root').scrollWidth - innerWidth };
    });
    assert(i.layout === 'l' && i.cell >= minCell && f.k >= 44, `${w}×${hh} plays the landscape grid (cell ${i.cell} px, smallest key ${Math.round(f.k)} px)`);
    assert(f.padsIn && f.over <= 0, `${w}×${hh}: both pads sit fully on screen`);
    // the GO stamp is in proportion to the small board
    await until(() => visible(pg, '.cy-msg .is-go'), 'the GO stamp', 1500, 10);
    await sleep(340); // the stamp has popped in and is still up
    const go = await pg.evaluate(() => { const g = document.querySelector('.cy-msg .is-go'); const c = document.querySelector('.cy-board canvas').getBoundingClientRect(); if (!g) return null; const b = g.getBoundingClientRect(); return { w: b.width, h: b.height, cw: c.width, ch: c.height }; });
    assert(go && go.h <= go.ch * 0.34 && go.w <= go.cw * 0.45, `${w}×${hh}: the GO stamp is in proportion to the board (${Math.round(go.w)}×${Math.round(go.h)} on ${Math.round(go.cw)}×${Math.round(go.ch)})`);
    await shot(pg, `cycles-phone-small-landscape-${w}-light`);
    await h.closeGame(pg);
    await h.settle();
  }
  await pg.setViewportSize({ width: 390, height: 844 });
  await h.settle();
}

/** The picker on the small upright phone and the laptop-sized windows: GO in view, nothing scrolls, even with a long record line. */
async function cyclesPickerFit(h, sizes) {
  console.log('\n# Light Cycles: the picker fits small screens');
  const pg = h.a;
  for (const [w, hh] of sizes) {
    await pg.setViewportSize({ width: w, height: hh });
    await h.startLive(pg, 'cycles', 'local');
    await until(() => visible(pg, '.cy-pick .cy-go'), 'the picker');
    await pg.evaluate(() => { document.querySelector('.cy-recs').textContent = 'Sydney is on a 12-match streak · longest ride 456 ticks · most close shaves 14'; });
    await sleep(120);
    const m = await pg.evaluate(() => { const r = document.getElementById('game-root'); const g = document.querySelector('.cy-go').getBoundingClientRect(); const chips = [...document.querySelectorAll('.cy-chip')].map((c) => c.getBoundingClientRect()); return { over: r.scrollHeight - r.clientHeight, goIn: g.bottom <= innerHeight && g.height >= 44, chip: Math.min(...chips.map((c) => Math.min(c.width, c.height))) }; });
    assert(m.over <= 0 && m.goIn && m.chip >= 44, `${w}×${hh}: picker has no overflow (${m.over}px), GO in view, chips ≥ ${Math.round(m.chip)} px`);
    await h.closeGame(pg);
    await h.settle();
  }
}

/** A capped match: nine rounds, 2–1. The end card must say what the score says. */
async function cyclesCapped(h) {
  console.log('\n# Light Cycles: a capped nine-round match ends 2–1, and the card matches');
  const pg = h.a;
  await h.startLive(pg, 'cycles', 'local');
  await pickGo(pg);
  const plan = ['a', 'b', 'a', 'd', 'd', 'd', 'd', 'd', 'd']; // who takes each round (wins first: the classic start is fixed, so the steering is certain)
  for (let n = 1; n <= plan.length; n++) {
    await localRun(pg, n);
    if (plan[n - 1] === 'a') await pg.keyboard.press('ArrowUp'); // Sydney heads for the top wall
    if (plan[n - 1] === 'b') await pg.keyboard.press('w'); // Emerson heads for the top wall
    const e = await localEnd(pg, n);
    assert(e.rw === plan[n - 1], `round ${n}: ${plan[n - 1] === 'd' ? 'a draw' : 'a win'} (${e.rw}) ${e.stage}`);
    await pg.evaluate(() => window.__cycles.skip());
    if (n === 4) {
      assert(e.caption.length > 3, `draw caption: "${e.caption}"`);
      await sleep(500);
      assert(/DEAD HEAT/.test(await pg.textContent('.cy-msg')), 'a draw shows DEAD HEAT');
      assert(!/LONGEST RIDE|MOST SHAVES/.test(await pg.textContent('.cy-msg')), 'the long draw does not claim a record in a first match');
      await shot(pg, 'cycles-laptop-deadheat-light');
    }
  }
  await until(() => visible(pg, '#game-root .gm-end'), 'the end card', 8000);
  const txt = await pg.textContent('#game-root .gm-end');
  assert(!/new record/i.test(txt), 'the first match claims no new record');
  assert(/Emerson wins 2–1/.test(txt) && /9 rounds/.test(txt) && !/three times/.test(txt), `the card says 2–1 and why ("${txt.replace(/\s+/g, ' ').slice(0, 120)}")`);
  await shot(pg, 'cycles-laptop-capped-end-light');
  await h.closeGame(pg);
  await h.settle();
}

/** Two phones with real latency and dropped events: both sides agree, and the guest steers at once. */
async function cyclesBadNetwork(h, tag) {
  console.log(`\n# Light Cycles, two phones on a bad network (${tag}): a boosted Pillars match`);
  await goLive(h, 'cycles');
  await pickGo(h.a, { arena: 'pillars', boosts: true });
  for (let n = 1; n <= 2; n++) {
    const r = await liveRound(h, n, async () => {
      // smooth motion: sample the guest's drawn heads every frame for 0.7 s before anyone steers
      const smooth = await h.b.evaluate(() => new Promise((res) => {
        const H = window.__cycles; const t0 = performance.now(); const last = {}; const mx = { a: 0, b: 0 }; let frames = 0;
        const loop = () => {
          for (const p of ['a', 'b']) { const v = H.view(p); if (v && last[p]) mx[p] = Math.max(mx[p], Math.hypot(v.x - last[p][0], v.y - last[p][1])); if (v) last[p] = [v.x, v.y]; }
          frames++;
          if (performance.now() - t0 < 700) requestAnimationFrame(loop); else res({ mx, frames });
        };
        requestAnimationFrame(loop);
      }));
      assert(smooth.frames > 15 && smooth.mx.a < 1.3 && smooth.mx.b < 1.3, `round ${n}: heads glide between ticks (largest per-frame step: opponent ${smooth.mx.a.toFixed(2)}, own ${smooth.mx.b.toFixed(2)} cells over ${smooth.frames} frames)`);
      // the guest steers; its own head must turn at once, long before the host's log shows it
      // the turn shows in the same instant as the key; and while the host's log catches up with that turn (several ticks at this latency) its drawn head must not pop
      const turn = h.b.evaluate(() => new Promise((res) => {
        const H = window.__cycles;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true }));
        const pending = H.info().pending;
        const T0 = performance.now(); let lt = T0; let last = null; let ex = 0; let frames = 0;
        const loop = () => {
          const now = performance.now(); const v = H.view('b'); const dt = now - lt; lt = now;
          if (v && last && dt > 4) ex = Math.max(ex, Math.hypot(v.x - last[0], v.y - last[1]) - dt / H.info().tms); // beyond what steady riding covers
          if (v) last = [v.x, v.y];
          frames++;
          if (now - T0 < 950 && !H.info().sim.done) requestAnimationFrame(loop); else res({ pending, ex, frames });
        };
        requestAnimationFrame(loop);
      }));
      await sleep(250);
      await h.a.keyboard.press('a');
      const tr = await turn;
      assert(tr.pending.length === 1, `round ${n}: the guest's own turn is on screen at once (predicted)`);
      assert(tr.frames > 12 && tr.ex < 0.75, `round ${n}: the guest's head does not pop when the host confirms its turn (worst extra step ${tr.ex.toFixed(2)} cells over ${tr.frames} frames)`);
    });
    assert(r.sim.a.len + r.sim.b.len > 8, `round ${n}: ridden (${r.sim.t} ticks, ${r.sim.a.sh + r.sim.b.sh} close shaves)`);
    assert(r.rw === 'a' || r.rw === 'b' || r.rw === 'd', `round ${n}: both devices agree on the result (${r.rw})`);
  }
  await closeBoth(h);
}

async function cyclesLandscapeLive(h) {
  console.log('\n# Light Cycles, two phones on their sides (844×390)');
  for (const pg of [h.a, h.b]) await pg.setViewportSize({ width: 844, height: 390 });
  await goLive(h, 'cycles');
  await pickGo(h.a, { arena: 'cross', boosts: true });
  const r = await liveRound(h, 1, async () => {
    const i = await until(async () => { const a = await cy(h.a); const b = await cy(h.b); return a && b && a.layout ? [a, b] : null; }, 'both landscape grids');
    assert(i[0].layout === 'l' && i[1].layout === 'l' && i[0].cell >= 7 && i[1].cell >= 7, `both phones play the landscape grid (cells ${i[0].cell} / ${i[1].cell} px)`);
    await sleep(500);
    await shot(h.a, 'cycles-phone-landscape-live-host-light');
    await shot(h.b, 'cycles-phone-landscape-live-guest-light');
    await h.b.keyboard.press('ArrowLeft');
  });
  assert(r.rw === 'a' || r.rw === 'b' || r.rw === 'd', `landscape round played (${r.rw})`);
  await closeBoth(h);
  for (const pg of [h.a, h.b]) await pg.setViewportSize({ width: 390, height: 844 });
}

/** Where one rider's ink sits on the canvas as drawn (CSS px): the screen's own truth about which way a bike is heading. */
const inkBox = (pg, who) => pg.evaluate((w) => {
  const cv = document.querySelector('.cy-board canvas');
  const probe = document.createElement('i'); probe.style.color = `var(--p-${w})`; document.body.appendChild(probe);
  const m = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g).map(Number); probe.remove();
  const W = cv.width; const H = cv.height; const d = cv.getContext('2d').getImageData(0, 0, W, H).data;
  let x0 = 1e9; let y0 = 1e9; let x1 = -1; let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] > 200 && Math.abs(d[i] - m[0]) + Math.abs(d[i + 1] - m[1]) + Math.abs(d[i + 2] - m[2]) < 30) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  const k = W / cv.clientWidth;
  return x1 < 0 ? null : { l: x0 / k, t: y0 / k, r: x1 / k, b: y1 / k };
}, who);

/** One phone upright, the other on its side: one agreed grid, each screen draws it so it fills, and steering follows each screen. */
async function cyclesMixedLive(h) {
  console.log('\n# Light Cycles, two phones, one upright (390×844) and one on its side (844×390)');
  await h.a.setViewportSize({ width: 390, height: 844 });
  await h.b.setViewportSize({ width: 844, height: 390 });
  await goLive(h, 'cycles');
  await pickGo(h.a);
  const r = await liveRound(h, 1, async () => {
    const i = await until(async () => { const a = await cy(h.a); const b = await cy(h.b); return a && b && a.layout && b.layout && a.cell && b.cell ? [a, b] : null; }, 'both grids');
    assert(i[0].layout === i[1].layout && i[0].layout === 'l', `both phones play one grid, the wide one (${i[0].layout} / ${i[1].layout})`);
    assert(i[0].qr === 3 && i[1].qr === 0, `the upright phone draws it turned a quarter, the one on its side upright (turns ${i[0].qr} / ${i[1].qr})`);
    assert(i[0].cell >= 7 && i[1].cell >= 7, `both screens get a board with big cells (upright phone ${i[0].cell} px, phone on its side ${i[1].cell} px)`);
    const fill = await h.a.evaluate(() => { const c = document.querySelector('.cy-board canvas').getBoundingClientRect(); return { w: c.width, h: c.height, vw: innerWidth }; });
    assert(fill.h > fill.w && fill.w > fill.vw * 0.7, `the upright phone's board is tall and fills its width (${Math.round(fill.w)}×${Math.round(fill.h)})`);
    // before any steering: each screen shows its own rider starting on the near side and riding on
    const a0 = await inkBox(h.a, 'a'); const b0 = await inkBox(h.b, 'b');
    await sleep(100);
    const a1 = await inkBox(h.a, 'a'); const b1 = await inkBox(h.b, 'b');
    assert(a1.t < a0.t - 0.5 && a1.b > i[0].cssH * 0.7, `Emerson (upright phone) starts low on his screen and rides up it (top ${a0.t.toFixed(0)} → ${a1.t.toFixed(0)})`);
    assert(b1.r > b0.r + 0.5 && b1.l < i[1].cssW * 0.3, `Sydney (phone on its side) starts on the left of her screen and rides right (right edge ${b0.r.toFixed(0)} → ${b1.r.toFixed(0)})`);
    // steering follows each screen: D on the upright phone is screen-right, Up on the other is screen-up
    await h.a.keyboard.press('d');
    await h.b.keyboard.press('ArrowUp');
    await sleep(90);
    const a2 = await inkBox(h.a, 'a'); const b2 = await inkBox(h.b, 'b');
    await sleep(160);
    const a3 = await inkBox(h.a, 'a'); const b3 = await inkBox(h.b, 'b');
    assert(a3.r > a2.r + 2 * i[0].cell && Math.abs(a3.t - a2.t) < 1.5, `"right" on the upright phone rides right on that screen (right edge ${a2.r.toFixed(0)} → ${a3.r.toFixed(0)}, top steady)`);
    assert(b3.t < b2.t - 2 * i[1].cell && Math.abs(b3.r - b2.r) < 1.5, `"up" on the phone on its side rides up that screen (top ${b2.t.toFixed(0)} → ${b3.t.toFixed(0)}, right edge steady)`);
    await shot(h.a, 'cycles-phone-mixed-upright-light');
    await shot(h.b, 'cycles-phone-mixed-landscape-light');
  });
  assert(r.rw === 'a' || r.rw === 'b' || r.rw === 'd', `mixed round played to the end (${r.rw})`);
  await closeBoth(h);
  for (const pg of [h.a, h.b]) await pg.setViewportSize({ width: 390, height: 844 });
}

/** A phone turned on its side in the middle of a live match: the same grid, redrawn to fill the new shape. */
async function cyclesTurnedLive(h) {
  console.log('\n# Light Cycles, live: a phone is turned on its side mid-round');
  await goLive(h, 'cycles');
  await pickGo(h.a);
  await liveRound(h, 1, async () => {
    const i = await until(async () => { const b = await cy(h.b); return b && b.layout === 'p' && b.cell ? b : null; }, 'the upright grid on the guest');
    await h.b.setViewportSize({ width: 844, height: 390 });
    const j = await until(async () => { const b = await cy(h.b); return b && b.qr === 1 && b.cssW > b.cssH ? b : null; }, 'the guest to turn the board', 4000, 30);
    assert(j.layout === 'p' && j.cell >= 6, `turned on its side mid-round: the same grid is drawn wide, filling the screen (cell ${i.cell} → ${j.cell} px)`);
    // Sydney starts on the left of her turned screen; up is up
    // the resized canvas is blank until its next paint: wait for Sydney's ink to show
    const b0 = await until(() => inkBox(h.b, 'b'), 'the turned board to repaint', 2000, 30);
    await h.b.keyboard.press('ArrowUp');
    await sleep(120);
    const b1 = await inkBox(h.b, 'b');
    await sleep(250);
    const b2 = await inkBox(h.b, 'b');
    assert(b0.l < j.cssW * 0.3 && b2.t < b1.t - 1.5 * j.cell && Math.abs(b2.r - b1.r) < 2, `"up" still rides up the turned screen (top ${b1.t.toFixed(0)} → ${b2.t.toFixed(0)})`);
    await shot(h.b, 'cycles-phone-turned-live-guest-light');
    await h.a.keyboard.press('a');
  });
  await closeBoth(h);
  for (const pg of [h.a, h.b]) await pg.setViewportSize({ width: 390, height: 844 });
}

/** Records: a match's own first rides are not "new records"; beating a record that stood before the match is. */
async function cyclesFirstMatch(h) {
  console.log('\n# Light Cycles: the very first match claims no records');
  const pg = h.a;
  await pg.setViewportSize({ width: 390, height: 844 });
  await h.startLive(pg, 'cycles', 'local');
  await pickGo(pg);
  for (let n = 1; n <= 3; n++) {
    await localRun(pg, n);
    await sleep([0, 600, 300][n - 1]); // Sydney rides on for a while, then turns for the side wall: each round a bit longer than the last
    await pg.keyboard.press('ArrowLeft');
    const e = await localEnd(pg, n);
    assert(e.rw === 'a', `round ${n}: Emerson (got ${e.rw}, log ${e.log}, layout ${e.layout}, sim ${JSON.stringify(e.sim.a)})`);
    assert(sameState(e.rc, []), `round ${n}: no record stamp in a first match (${JSON.stringify(e.rc)})`);
    await pg.evaluate(() => window.__cycles.skip());
    await until(async () => /takes round/.test(await pg.textContent('.cy-msg')) || (await visible(pg, '#game-root .gm-end')), 'the round banner', 3000, 30).catch(() => {});
    assert(!/LONGEST RIDE|MOST SHAVES/.test(await pg.textContent('.cy-msg')), `round ${n}: the banner has no record stamp`);
  }
  await until(() => visible(pg, '#game-root .gm-end'), 'the end card', 8000);
  const txt = await pg.textContent('#game-root .gm-end');
  assert(/Emerson wins 3–0/.test(txt) && !/new record/i.test(txt), `the end card of a first match has no "new record" ("${txt.replace(/\s+/g, ' ').slice(0, 140)}")`);
  const d = h.docs['gamedata/cycles'] || {};
  assert(d.cy_long_n > 0, `the ride is still recorded (${d.cy_long_n} ticks)`);
  await h.closeGame(pg);
  await h.settle();
}
async function cyclesRecordBeaten(h) {
  console.log('\n# Light Cycles: beating a record that stood before the match is celebrated');
  const pg = h.a;
  await until(() => (h.docs['gamedata/cycles'] || {}).cy_long_n === 3, 'the seeded record', 4000);
  await h.startLive(pg, 'cycles', 'local');
  await pickGo(pg);
  let stamped = false;
  for (let n = 1; n <= 3; n++) {
    await localRun(pg, n);
    await pg.keyboard.press('ArrowUp');
    const e = await localEnd(pg, n);
    if (n === 1) assert(e.rc.includes('long'), `round 1 beats the old record of 3 ticks and says so (${JSON.stringify(e.rc)})`);
    await pg.evaluate(() => window.__cycles.skip());
    await sleep(450);
    if (n === 1) { stamped = /LONGEST RIDE/.test(await pg.textContent('.cy-msg')); assert(stamped, 'the round banner shows the LONGEST RIDE stamp'); }
  }
  await until(() => visible(pg, '#game-root .gm-end'), 'the end card', 8000);
  const txt = await pg.textContent('#game-root .gm-end');
  assert(/new record: longest ride/i.test(txt), `the end card names the record that was beaten ("${txt.replace(/\s+/g, ' ').slice(0, 160)}")`);
  await h.closeGame(pg);
  await h.settle();
}

// ══════════════════════════ Defuse ══════════════════════════
// The rules exactly as the field guide prints them. If the guide changes, this list (and the
// solver under it) must be updated by a person reading the new text.
const GUIDE = {
  'w3-1': 'If the first and last wires are the same colour, cut the second wire.',
  'w3-2': 'Otherwise, if exactly one wire is black, cut the black wire.',
  'w3-3': 'Otherwise, if the last digit of the serial number is even, cut the first wire.',
  'w3-4': 'Otherwise, cut the last wire.',
  'w4-1': 'If there is a lit RDY indicator and two or more wires are yellow, cut the last yellow wire.',
  'w4-2': 'Otherwise, if no wire is blue, cut the third wire.',
  'w4-3': 'Otherwise, if exactly one wire is white, cut the first wire.',
  'w4-4': 'Otherwise, if the last digit of the serial number is odd, cut the second wire.',
  'w4-5': 'Otherwise, cut the last blue wire.',
  'w5-1': 'If the last wire is black and the last digit of the serial number is odd, cut the fourth wire.',
  'w5-2': 'Otherwise, if there are more red wires than blue wires, cut the first red wire.',
  'w5-3': 'Otherwise, if no wire is yellow, cut the second wire.',
  'w5-4': 'Otherwise, if the bomb has three or more batteries, cut the last wire.',
  'w5-5': 'Otherwise, cut the first wire.',
  'w6-1': 'If no wire is white and the last digit of the serial number is even, cut the third wire.',
  'w6-2': 'Otherwise, if exactly one wire is yellow, cut the yellow wire.',
  'w6-3': 'Otherwise, if there is a lit PWR indicator, cut the fifth wire.',
  'w6-4': 'Otherwise, if no wire is red, cut the last wire.',
  'w6-5': 'Otherwise, cut the fourth wire.',
  'b-1': 'If the button is blue and says WAIT, hold it.',
  'b-2': 'Otherwise, if the button says FIRE and the bomb has two or more batteries, tap it.',
  'b-3': 'Otherwise, if the button is white and there is a lit AUX indicator, hold it.',
  'b-4': 'Otherwise, if the button is red and says HALT, tap it.',
  'b-5': 'Otherwise, if the button is yellow, hold it.',
  'b-6': 'Otherwise, if the bomb has no batteries, hold it.',
  'b-7': 'Otherwise, tap it.',
};
/** Solve a bomb the way a person reading the guide would (tables and columns come from the page). */
function solveByGuide(f, page) {
  const even = +f.serial.slice(-1) % 2 === 0;
  const vowel = /[AEIOU]/.test(f.serial);
  const lit = (l) => f.indicators.some((x) => x.label === l && x.lit);
  const w = f.wires;
  const n = w.length;
  const count = (c) => w.filter((x) => x === c).length;
  let wire;
  if (n === 3) wire = w[0] === w[2] ? 1 : count('black') === 1 ? w.indexOf('black') : even ? 0 : 2;
  else if (n === 4) wire = lit('RDY') && count('yellow') >= 2 ? w.lastIndexOf('yellow') : !count('blue') ? 2 : count('white') === 1 ? 0 : !even ? 1 : w.lastIndexOf('blue');
  else if (n === 5) wire = w[4] === 'black' && !even ? 3 : count('red') > count('blue') ? w.indexOf('red') : !count('yellow') ? 1 : f.batteries >= 3 ? 4 : 0;
  else wire = !count('white') && even ? 2 : count('yellow') === 1 ? w.indexOf('yellow') : lit('PWR') ? 4 : !count('red') ? 5 : 3;
  const b = f.button;
  const act = b.color === 'blue' && b.label === 'WAIT' ? 'hold'
    : b.label === 'FIRE' && f.batteries >= 2 ? 'tap'
      : b.color === 'white' && lit('AUX') ? 'hold'
        : b.color === 'red' && b.label === 'HALT' ? 'tap'
          : b.color === 'yellow' ? 'hold'
            : f.batteries === 0 ? 'hold' : 'tap';
  const cols = page.columns.filter((c) => f.keypad.every((g) => c.includes(g)));
  const keypad = cols.length ? [...f.keypad].sort((x, y) => cols[0].indexOf(x) - cols[0].indexOf(y)) : null;
  const seq = [0, 1, 2].map((st) => f.seq.map((c) => page.seq[vowel ? 'v' : 'n'][st][c]));
  return { wire, act, digit: act === 'hold' ? page.strip[b.strip] : null, keypad, columns: cols.length, seq };
}
async function readGuide(pg) {
  return pg.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    const word = (el) => el.textContent.trim().toLowerCase();
    const seq = { v: [{}, {}, {}], n: [{}, {}, {}] };
    for (const v of ['v', 'n']) {
      const t = document.querySelector(`.g-defuse table[data-table="${v}"]`);
      [...t.tBodies[0].rows].forEach((row) => { const from = word(row.cells[0]); for (let st = 0; st < 3; st++) seq[v][st][from] = word(row.cells[st + 1]); });
    }
    const strip = {};
    [...document.querySelector('.g-defuse table[data-table="strip"]').tBodies[0].rows].forEach((row) => { strip[word(row.cells[0])] = +row.cells[1].textContent.trim(); });
    return {
      rules: Object.fromEntries(q('.g-defuse li[data-rule]').map((li) => [li.dataset.rule, li.textContent.trim().replace(/\s+/g, ' ')])),
      columns: q('.g-defuse .dx-col').map((c) => [...c.querySelectorAll('[data-glyph]')].map((g) => g.dataset.glyph)),
      strip, seq,
    };
  });
}

async function holdAndRelease(pg, digit) {
  await pg.locator('.dx-big').scrollIntoViewIfNeeded();
  const box = await pg.locator('.dx-big').boundingBox();
  await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pg.mouse.down();
  await until(() => pg.evaluate(() => document.querySelector('.dx-strip').classList.contains('is-on')), 'the light strip', 3000, 30);
  let prev = null;
  await until(async () => {
    const d = +(await pg.textContent('.dx-time')).trim().slice(-1);
    const fresh = d === digit && prev !== null && prev !== digit; // just ticked over: most of a second to spare
    prev = d;
    return fresh;
  }, `timer digit ${digit}`, 14000, 15);
  await pg.mouse.up();
}

async function pickRoles(h, bombPg, manualPg) {
  await bombPg.click('.dx-role[data-role="bomb"]');
  await manualPg.click('.dx-role[data-role="manual"]');
  await h.settle();
}
async function startRound(h, presser) {
  await until(() => presser.evaluate(() => !document.querySelector('.g-defuse [data-act="start"]').disabled), 'start to be enabled');
  await presser.click('.g-defuse [data-act="start"]');
  await until(async () => { const x = await dx(h.a); const y = await dx(h.b); return x && y && x.phase !== 'lobby' && y.phase !== 'lobby'; }, 'both devices to leave the lobby');
}

async function defusePhones(h) {
  console.log('\n# Defuse, live on two phones');
  await goLive(h, 'defuse');
  await until(async () => (await dx(h.a)) && (await dx(h.b)), 'both lobbies');
  await h.a.click('.dx-role[data-role="bomb"]');
  await h.b.click('.dx-role[data-role="bomb"]');
  await h.settle();
  assert(await h.a.evaluate(() => document.querySelector('[data-act="start"]').disabled) && /both picked/i.test(await h.a.textContent('.dx-lobby-status')), 'same role on both: no start, and a hint to switch');
  await h.b.click('.dx-role[data-role="manual"]');
  await h.settle();
  const seen = await h.a.evaluate(() => [...document.querySelectorAll('.dx-role[data-role="manual"] .dx-who')].map((x) => x.className));
  assert(seen.some((c) => /p-b/.test(c)), 'roles are shown live: Emerson sees Sydney on the manual');
  await h.b.click('.dx-diff [data-diff="chill"]');
  await h.settle();
  assert(await h.a.evaluate(() => document.querySelector('.dx-diff [data-diff="chill"]').getAttribute('aria-checked')) === 'true', 'difficulty pick reaches the other phone');
  await h.b.click('.dx-diff [data-diff="normal"]');
  await h.settle();
  await shot(h.a, 'defuse-phone-lobby-light');
  await startRound(h, h.b); // the manual side asks the bomb side to start
  const A = await dx(h.a);
  assert(A.phase === 'bomb' && (await dx(h.b)).phase === 'manual', 'Emerson has the bomb, Sydney has the manual');
  const g = A.bomb.gen;
  assert(A.bomb.diff === 'normal' && Math.abs(A.bomb.left - 300000) < 3000, 'Normal is a 5:00 clock');

  // what the bomb shows is what was generated
  const shown = await h.a.evaluate(() => ({
    serial: document.querySelector('.dx-serial').textContent.trim(),
    wires: [...document.querySelectorAll('.dx-wire')].map((x) => x.dataset.color),
    label: document.querySelector('.dx-big').textContent.trim(),
    color: document.querySelector('.dx-big').dataset.color,
    keys: [...document.querySelectorAll('.dx-gkey')].map((x) => x.dataset.glyph),
    bats: document.querySelectorAll('.dx-bats svg').length,
    inds: [...document.querySelectorAll('.dx-ind')].map((x) => [x.textContent.trim(), x.classList.contains('is-lit')]),
  }));
  assert(shown.serial === g.serial && sameState(shown.wires, g.wires) && shown.label === g.button.label && shown.color === g.button.color && sameState(shown.keys, g.keypad) && shown.bats === g.batteries && sameState(shown.inds, g.indicators.map((x) => [x.label, x.lit])), 'the bomb on screen matches its seed');

  // the field guide on Sydney's phone produces the bomb's answers, for this bomb and 100 more
  const page = await readGuide(h.b);
  assert(Object.keys(page.rules).length === Object.keys(GUIDE).length && Object.entries(GUIDE).every(([k, t]) => page.rules[k] === t), 'the guide prints exactly the rules the solver reads');
  assert(page.columns.length === 5 && page.columns.every((c) => c.length === 7) && new Set(page.columns.flat()).size === 30, 'glyph keypad page: 5 columns of 7 from 30 glyphs');
  const gens = await h.a.evaluate(() => Array.from({ length: 100 }, (_, i) => window.__defuse.gen('test-' + i, ['chill', 'normal', 'spicy'][i % 3])));
  let ok = 0;
  const holds = { tap: 0, hold: 0 };
  for (const x of [g, ...gens]) {
    const s = solveByGuide(x, page);
    holds[s.act]++;
    const good = s.columns === 1 && s.wire === x.answers.wire && s.act === x.answers.button.act && s.digit === x.answers.button.digit && sameState(s.keypad, x.answers.keypad) && sameState(s.seq, x.answers.seq);
    if (!good) console.error('mismatch', x.seed, JSON.stringify(s), JSON.stringify(x.answers));
    ok += good ? 1 : 0;
  }
  assert(ok === 101, `the field guide gives the bomb's answers for 101 seeds (tap ${holds.tap}, hold ${holds.hold})`);
  const wc = new Set(gens.map((x) => x.wires.length));
  assert(wc.size === 4 && gens.some((x) => x.vowel) && gens.some((x) => !x.vowel), 'seeds cover 3–6 wires and serials with and without vowels');

  // a strike, felt on both phones
  const ans = g.answers;
  const wrong = ans.wire === 0 ? 1 : 0;
  await h.a.click(`.dx-wire[data-wire="${wrong}"]`);
  await h.settle();
  assert((await dx(h.a)).bomb.strikes === 1, 'a wrong wire is a strike');
  await until(async () => (await h.b.evaluate(() => document.querySelectorAll('.dx-mbar .dx-strikes i.on').length)) === 1, 'the manual to show the strike');
  assert(true, 'the manual sees the strike live');
  await h.b.click('.dx-index [data-page="wires"]');
  await sleep(200);
  await shot(h.a, 'defuse-phone-bomb-light');
  await shot(h.b, 'defuse-phone-manual-light');

  // solve all four through the UI
  await h.a.click(`.dx-wire[data-wire="${ans.wire}"]`);
  if (ans.button.act === 'tap') await h.a.click('.dx-big'); else await holdAndRelease(h.a, ans.button.digit);
  await h.settle();
  assert((await dx(h.a)).bomb.solved.slice(0, 2).join('') === '11', `wires and the big button solved (${ans.button.act}${ans.button.act === 'hold' ? ' to ' + ans.button.digit : ''})`);
  for (const k of ans.keypad) await h.a.click(`.dx-gkey[data-glyph="${k}"]`);
  await h.b.click('.dx-index [data-page="keypad"]');
  await h.settle();
  const mid = await dx(h.b);
  assert(mid.manual.solved === '1110' && mid.manual.strikes === 1, 'the manual shows three modules done and one strike');
  await sleep(1500);
  const secs = (t) => { const [m, x] = t.trim().split(':').map(Number); return m * 60 + x; };
  const [tA, tB] = [await h.a.textContent('.dx-time'), await h.b.textContent('.dx-time')];
  assert(secs(tA) < 300 && Math.abs(secs(tA) - secs(tB)) <= 1, `the manual's clock follows the bomb's (${tA.trim()} / ${tB.trim()})`);
  await shot(h.b, 'defuse-phone-manual-keypad-light');
  const seq = ans.seq[1]; // one strike so far
  for (let k = 0; k < seq.length; k++) for (let j = 0; j <= k; j++) { await h.a.click(`.dx-pad[data-color="${seq[j]}"]`); await sleep(30); }
  const won = await until(async () => { const x = await dx(h.a); return x.bomb.over ? x : null; }, 'the bomb to be safe');
  assert(won.bomb.win && won.bomb.res.team && won.bomb.res.score > 200, `defused: team result, ${won.bomb.res.score} s left`);
  await until(async () => (await dx(h.b)).manual.over, 'the manual to hear it');
  await sleep(500);
  await shot(h.a, 'defuse-phone-defused-bomb-light');
  await until(async () => await visible(h.a, '#game-root .gm-end') && await visible(h.b, '#game-root .gm-end'), 'end card on both', 6000);
  assert(true, 'end card on both devices');
  await until(() => h.results().some((r) => r.game === 'defuse'), 'the win to be recorded', 4000);
  await h.settle();
  let res = h.results().filter((r) => r.game === 'defuse');
  assert(res.length === 1 && res[0].winner === 'team' && res[0].score === won.bomb.res.score, 'one team result recorded with the seconds left as the score');
  await sleep(500);
  await shot(h.a, 'defuse-phone-end-bomb-light');
  await shot(h.b, 'defuse-phone-end-manual-light');

  // rematch: roles are remembered; swap so the bomb is on Sydney's phone (the guest)
  await h.a.click('#game-root [data-g="rematch"]');
  await until(async () => { const x = await dx(h.a); const y = await dx(h.b); return x && y && x.phase === 'lobby' && y.phase === 'lobby' && x.role === 'bomb' && y.role === 'manual' && x.partnerRole === 'manual'; }, 'rematch lobby with remembered roles');
  assert(!(await visible(h.b, '#game-root .gm-end')), 'rematch clears the end card on both');
  await h.b.click('[data-act="swap"]');
  await until(async () => (await dx(h.a)).role === 'manual' && (await dx(h.b)).role === 'bomb', 'the swap');
  assert(true, 'swap flips both roles');
  await startRound(h, h.a);
  const B = await dx(h.b);
  assert(B.phase === 'bomb' && (await dx(h.a)).phase === 'manual', 'now Sydney has the bomb');
  const a2 = B.bomb.gen.answers;
  await h.b.click(`.dx-wire[data-wire="${a2.wire === 0 ? 1 : 0}"]`);
  await h.b.click(`.dx-gkey[data-glyph="${a2.keypad[3]}"]`);
  await sleep(150);
  await h.a.click('.dx-index [data-page="basics"]');
  await until(async () => (await dx(h.a)).manual.strikes === 2, 'two strikes on the manual');
  await shot(h.a, 'defuse-phone-manual-2strikes-light');
  await h.b.click(`.dx-gkey[data-glyph="${a2.keypad[2]}"]`);
  const lost = await until(async () => { const x = await dx(h.b); return x.bomb.over ? x : null; }, 'boom');
  assert(!lost.bomb.win && lost.bomb.strikes === 3, 'three strikes: boom');
  await until(async () => (await dx(h.a)).manual.over, 'the manual to see the boom');
  await sleep(400);
  await shot(h.a, 'defuse-phone-boom-manual-light');
  await shot(h.b, 'defuse-phone-boom-bomb-light');
  await until(async () => await visible(h.a, '#game-root .gm-end') && await visible(h.b, '#game-root .gm-end'), 'end card on both after the boom', 6000);
  assert(true, 'loss: end card on both devices');
  await until(() => h.results().filter((r) => r.game === 'defuse').length >= 2, 'the boom to be recorded', 4000);
  await h.settle();
  res = h.results().filter((r) => r.game === 'defuse');
  assert(res.length === 2 && res.some((r) => r.winner === 'team' && r.score == null), 'the boom is recorded once, by the host, with no score');
  await sleep(400);
  await shot(h.b, 'defuse-phone-end-boom-light');
  await closeBoth(h);

  // one device: a friendly card
  await h.a.evaluate(() => { const b = document.createElement('button'); b.dataset.g = 'live'; b.dataset.game = 'defuse'; b.dataset.mode = 'local'; document.body.appendChild(b); b.click(); b.remove(); });
  await h.a.waitForSelector('.g-defuse .dx-solo');
  assert(/Defuse needs two devices: one for the bomb, one for the manual\./.test(await h.a.textContent('.dx-solo')), 'one device: the "needs two devices" card');
  await shot(h.a, 'defuse-phone-solo-light');
  await h.a.click('.dx-solo [data-g="close"]');
  await h.settle();
}

/** Bomb on one laptop, manual on the other (or phones): screenshots mid-game and after a boom. */
async function defuseShots(h, tag, opts = {}) {
  console.log(`\n# Defuse screenshots (${tag})`);
  await goLive(h, 'defuse');
  await until(async () => (await dx(h.a)) && (await dx(h.b)), 'both lobbies');
  await pickRoles(h, h.a, h.b);
  if (opts.lobby) await shot(h.b, `defuse-${tag}-lobby`);
  await startRound(h, h.a);
  const g = (await dx(h.a)).bomb.gen;
  await h.a.click(`.dx-wire[data-wire="${g.answers.wire}"]`);
  await h.a.click(`.dx-gkey[data-glyph="${g.answers.keypad[0]}"]`);
  await h.b.click('.dx-index [data-page="sequence"]');
  await h.settle();
  await sleep(900);
  if (opts.hold) { // show the light strip lit
    await h.a.locator('.dx-big').scrollIntoViewIfNeeded();
    const box = await h.a.locator('.dx-big').boundingBox();
    await h.a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await h.a.mouse.down();
    await sleep(700);
  }
  await shot(h.a, `defuse-${tag}-bomb`);
  await shot(h.b, `defuse-${tag}-manual`);
  if (opts.hold) { await h.a.mouse.up(); await sleep(100); }
  if (opts.narrow) {
    await h.b.setViewportSize({ width: 360, height: 740 });
    await sleep(300);
    assert(await noSideScroll(h.b), 'the manual fits a 360 px phone');
    await shot(h.b, `defuse-${tag}-manual-360`);
    await h.b.click('.dx-index [data-page="keypad"]');
    await shot(h.b, `defuse-${tag}-manual-360-keypad`);
    await h.b.setViewportSize({ width: 390, height: 844 });
  }
  // three wrong moves: boom
  for (let i = 0; i < 4; i++) {
    const x = await dx(h.a);
    if (x.bomb.over) break;
    const keyAt = x.bomb.keyAt;
    const bad = g.answers.keypad.find((k, j) => j > keyAt);
    if (!x.bomb.solved[2] && bad) await h.a.click(`.dx-gkey[data-glyph="${bad}"]`);
    else await h.a.click('.dx-pad[data-color="red"]').catch(() => {});
    await sleep(420); // separate presses: the same wrong key tapped twice within 400 ms is one mistake

  }
  await until(async () => (await dx(h.a)).bomb.over && (await dx(h.b)).manual.over, 'the boom on both');
  await sleep(600);
  await shot(h.a, `defuse-${tag}-boom-bomb`);
  await until(async () => await visible(h.a, '#game-root .gm-end') && await visible(h.b, '#game-root .gm-end'), 'end cards', 6000);
  await sleep(500);
  await shot(h.a, `defuse-${tag}-end-bomb`);
  await shot(h.b, `defuse-${tag}-end-manual`);
  assert(true, `${tag}: boom and end card on both`);
  await closeBoth(h);
}


// ══════════════════════════ resilience ══════════════════════════
const hide = (pg, on) => pg.evaluate((on) => {
  Object.defineProperty(document, 'hidden', { value: on, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: on ? 'hidden' : 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}, on);
/** `pg` closed the game; the partner re-sends the invite and `pg` takes it. */
async function comeBack(h, pg, partner) {
  await partner.click('#game-root [data-g="invite-again"]');
  await h.settle();
  await until(() => visible(pg, '#gm-invite'), 'the re-sent invite');
  await pg.click('#gm-invite [data-g="invite-yes"]');
  await h.settle(); await h.settle();
}

async function cyclesResilience(h) {
  console.log('\n# Light Cycles: a tab in the background, the host leaving mid-match');
  await goLive(h, 'cycles');
  await pickGo(h.a);
  await until(async () => { const x = await cy(h.a); return x && x.phase === 'run' && x.round === 1 && x.sim.t < 8 ? x : null; }, 'round 1 riding', 15000, 25);
  for (const [who, pg, other] of [['Sydney', h.b, h.a], ['Emerson', h.a, h.b]]) {
    await hide(pg, true);
    await sleep(350);
    const t1 = (await cy(h.a)).sim.t;
    await sleep(600);
    const x = await cy(h.a);
    assert(x.paused && x.sim.t === t1, `${who}'s tab in the background: the ride stops (tick ${t1} → ${x.sim.t})`);
    await until(async () => (await cy(other)).paused, `${who}: the other device to show Paused`, 4000);
    await sleep(150);
    const stepped = await other.textContent('.cy-msg');
    assert(stepped.includes(`${who} stepped away`), `${who}'s tab in the background: the other phone says why ("${stepped.trim()}")`);
    await hide(pg, false);
    await until(async () => { const y = await cy(h.a); return !y.paused && y.phase === 'count'; }, `${who} back: a countdown`, 4000);
    assert(true, `${who} back: a fresh countdown before riding again`);
  }
  // Sydney rides into the wall: Emerson takes round 1
  await until(async () => (await cy(h.a)).phase === 'run', 'riding again', 6000);
  await h.b.keyboard.press('ArrowLeft');
  await until(async () => (await cy(h.a)).score.a === 1, 'round 1 to Emerson', 12000);
  await until(async () => { const x = await cy(h.a); return x.round === 2 && x.phase === 'run'; }, 'round 2', 12000);
  // Emerson (the host) leaves mid-round and comes back: same score, round 2 ridden again
  await h.closeGame(h.a);
  await h.settle(); await h.settle();
  await comeBack(h, h.a, h.b);
  const [p, q] = [await until(() => cy(h.a), 'the host back'), await cy(h.b)];
  assert(p.score.a === 1 && p.score.b === 0 && q.score.a === 1 && q.score.b === 0 && p.round === 2, `host left and came back: 1–0 on both, round ${p.round} again`);
  await closeBoth(h);
}

async function defuseResilience(h) {
  console.log('\n# Defuse: double taps, a tab in the background, the bomb leaving and coming back');
  await goLive(h, 'defuse');
  await until(async () => (await dx(h.a)) && (await dx(h.b)), 'both lobbies');
  await pickRoles(h, h.b, h.a);
  await startRound(h, h.b);
  const g = (await dx(h.b)).bomb.gen;
  const wrong = g.keypad.find((k) => k !== g.answers.keypad[0]);
  await h.b.evaluate((k) => { const el = document.querySelector(`.dx-gkey[data-glyph="${k}"]`); el.click(); el.click(); }, wrong);
  await sleep(150);
  assert((await dx(h.b)).bomb.strikes === 1, 'a double tap on a wrong key is one strike, not two');
  await hide(h.a, true);
  await until(async () => (await dx(h.b)).bomb.pz, "the manual's tab in the background pauses the bomb", 4000);
  const l0 = (await dx(h.b)).bomb.left;
  await sleep(700);
  assert(Math.abs((await dx(h.b)).bomb.left - l0) < 50, 'the clock holds while the manual is away');
  await hide(h.a, false);
  await until(async () => !(await dx(h.b)).bomb.pz, 'the clock to run again', 4000);
  await h.b.click(`.dx-wire[data-wire="${g.answers.wire}"]`);
  await h.settle();
  const n = (await dx(h.b)).bomb.n;
  // the bomb closes the game and opens it again: the same round, wires still cut
  await h.closeGame(h.b);
  await h.settle(); await h.settle();
  await comeBack(h, h.b, h.a);
  const back = await until(async () => { const x = await dx(h.b); return x && x.phase === 'bomb' ? x : null; }, 'the bomb back', 6000);
  assert(back.bomb.n === n && back.bomb.solved[0] === 1 && back.bomb.strikes === 1 && (await dx(h.a)).manual.n === n, 'the bomb reopened: the same round carries on (wires done, one strike)');
  // the bomb's page reloads: that round is gone, the manual goes back to the lobby and follows the next one
  await h.b.reload(); await h.b.waitForSelector('.tabbar');
  await h.settle(); await h.settle();
  await comeBack(h, h.b, h.a);
  await until(async () => (await dx(h.a)).phase === 'lobby' && (await dx(h.b)) && (await dx(h.b)).phase === 'lobby', 'both back in the lobby', 6000);
  assert(true, 'bomb reloaded: the manual is back in the lobby, not stuck on a dead round');
  await h.b.click('.dx-role[data-role="bomb"]');
  await h.settle();
  await startRound(h, h.b);
  const [m, bb] = [await dx(h.a), await dx(h.b)];
  assert(m.phase === 'manual' && bb.phase === 'bomb' && m.manual.n === bb.bomb.n, 'the new round reaches the manual');
  await closeBoth(h);
}

// ══════════════════════════ dropped events ══════════════════════════
// A third of all room events vanish. Presence still gets through, and both games lean on it.
async function bothLive(h, game) {
  await h.startLive(h.a, game, 'live');
  await h.settle(); await h.settle();
  // the invite is a room event too: take it if it arrived, otherwise open the game directly
  if (await visible(h.b, '#gm-invite')) await h.b.click('#gm-invite [data-g="invite-yes"]');
  else await h.startLive(h.b, game, 'live');
  await h.settle(); await h.settle();
}
async function droppedEvents(h) {
  console.log('\n# Dropped events (a third of room events lost)');
  await bothLive(h, 'cycles');
  await pickGo(h.a);
  for (let n = 1; n <= 3; n++) {
    const r = await liveRound(h, n, async () => {
      await h.b.keyboard.press('ArrowLeft'); await sleep(90); await h.b.keyboard.press('ArrowDown'); await sleep(90); await h.b.keyboard.press('ArrowRight');
      await h.a.keyboard.press('a'); await sleep(170); await h.a.keyboard.press('w');
    });
    assert(turnsOf(r.log, 'b').length === 3 && r.rw === 'a', `round ${n}: every one of Sydney's three turns arrived`);
  }
  await until(async () => await visible(h.a, '#game-root .gm-end') && await visible(h.b, '#game-root .gm-end'), 'Light Cycles end card on both', 9000);
  assert(true, 'Light Cycles: end card on both even if the finish event is lost');
  await closeBoth(h);

  await bothLive(h, 'defuse');
  await until(async () => (await dx(h.a)) && (await dx(h.b)), 'both lobbies');
  await pickRoles(h, h.a, h.b);
  await until(async () => (await dx(h.a)).partnerRole === 'manual', 'roles to show');
  await h.b.click('[data-act="swap"]');
  await until(async () => (await dx(h.a)).role === 'manual' && (await dx(h.b)).role === 'bomb', 'the swap to land', 6000);
  assert(true, 'Defuse: swap lands even when its event is lost');
  await startRound(h, h.a);
  assert((await dx(h.b)).phase === 'bomb', 'Defuse: the start request lands');
  const ans = (await dx(h.b)).bomb.gen.answers;
  await h.b.click(`.dx-wire[data-wire="${ans.wire === 0 ? 1 : 0}"]`);
  await h.b.click(`.dx-gkey[data-glyph="${ans.keypad[3]}"]`);
  await h.b.click(`.dx-gkey[data-glyph="${ans.keypad[2]}"]`);
  await until(async () => (await dx(h.a)).manual && (await dx(h.a)).manual.over, 'the manual to see the boom');
  await until(async () => await visible(h.a, '#game-root .gm-end') && await visible(h.b, '#game-root .gm-end'), 'Defuse end card on both', 9000);
  await until(() => h.results().some((r) => r.game === 'defuse'), 'the result', 4000);
  await h.settle();
  assert(h.results().filter((r) => r.game === 'defuse').length === 1, 'Defuse: boom recorded once (the bomb was on the guest)');
  await closeBoth(h);
}

// ══════════════════════════ run ══════════════════════════
async function withHarness(opts, fn) {
  const h = await launch({ only: ['cycles', 'defuse'], ...opts });
  try {
    await fn(h);
    h.assertNoErrors();
    assert(true, `no page errors (${opts.device || 'iPhone 13'}, ${opts.colorScheme || 'light'})`);
  } catch (e) {
    await h.a.screenshot({ path: path.join(SHOTS, 'FAIL-a.png') }).catch(() => {});
    await h.b.screenshot({ path: path.join(SHOTS, 'FAIL-b.png') }).catch(() => {});
    console.error('errors:', h.errors);
    throw e;
  } finally {
    await h.close();
  }
}

(async () => {
  const only = process.argv[2] || 'all';
  try {
    if (only === 'all' || only === 'phone') {
      await withHarness({ port: PORT, coarse: true }, async (h) => {
        await asPhones(h);
        await cyclesLivePhones(h);
        await cyclesLocalPhone(h, 'light');
        await defusePhones(h);
        await cyclesResilience(h);
        await defuseResilience(h);
      });
    }
    if (only === 'all' || only === 'laptop') {
      await withHarness({ port: PORT + 1, device: 'Desktop Chrome' }, async (h) => {
        await asLaptops(h);
        await cyclesLocalLaptop(h, 'light');
        await cyclesLiveLaptops(h, 'light');
        await defuseShots(h, 'laptop-light', { lobby: true, hold: true });
      });
    }
    if (only === 'all' || only === 'dark') {
      await withHarness({ port: PORT + 2, device: 'Desktop Chrome', colorScheme: 'dark' }, async (h) => {
        await asLaptops(h);
        await cyclesLocalLaptop(h, 'dark');
        await cyclesLiveLaptops(h, 'dark');
        await defuseShots(h, 'laptop-dark', { hold: true });
      });
      await withHarness({ port: PORT + 3, colorScheme: 'dark', coarse: true }, async (h) => {
        await asPhones(h);
        await cyclesLocalPhone(h, 'dark');
        await defuseShots(h, 'phone-dark', { lobby: true, narrow: true });
      });
    }
    if (only === 'all' || only === 'cyx') {
      await withHarness({ port: PORT + 5, coarse: true }, async (h) => {
        await asPhones(h);
        await cyclesTouchAndReplay(h);
        await cyclesLandscape(h);
        await cyclesSmallLandscape(h);
      });
      await withHarness({ port: PORT + 6, device: 'Desktop Chrome' }, async (h) => {
        await asLaptops(h);
        await cyclesUnits(h);
        await cyclesCapped(h);
      });
      await withHarness({ port: PORT + 7, coarse: true }, async (h) => {
        await asPhones(h);
        await cyclesLandscapeLive(h);
        await cyclesMixedLive(h);
        await cyclesTurnedLive(h);
      });
      await withHarness({ port: PORT + 9, coarse: true }, async (h) => {
        await asPhones(h);
        await cyclesPickerFit(h, [[320, 568], [360, 640], [568, 320], [667, 375], [844, 390]]);
        await cyclesFirstMatch(h);
      });
      await withHarness({ port: PORT + 10, device: 'Desktop Chrome', seedDocs: { 'gamedata/cycles': { cy_long_n: 3, cy_long_who: 'b' } } }, async (h) => {
        await asLaptops(h);
        await cyclesRecordBeaten(h);
        await cyclesPickerFit(h, [[800, 500], [1280, 600], [1280, 800]]);
      });
      await withHarness({ port: PORT + 8, coarse: true, latency: 150, dropRate: 0.2 }, async (h) => {
        await asPhones(h);
        await cyclesBadNetwork(h, 'latency 150, 20% of events dropped');
      });
    }
    if (only === 'all' || only === 'drops') {
      await withHarness({ port: PORT + 4, coarse: true, dropRate: 0.33 }, async (h) => {
        await asPhones(h);
        await droppedEvents(h);
      });
    }
    console.log('\nALL GOOD. Screenshots in', SHOTS);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
})();
