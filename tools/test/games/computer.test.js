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
const turnsOf = (log, p) => log.split(',').filter(Boolean).filter((e) => (+e.slice(-1) < 4) === (p === 'a'));

async function cyclesLivePhones(h) {
  console.log('\n# Light Cycles, live on two phones');
  await goLive(h, 'cycles');
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
    await localEnd(pg, 1);
    await localRun(pg, 2);
    const e = await localEnd(pg, 2);
    assert(e.rw === 'd' && sameState(e.sim.a.crash, e.sim.b.crash) && e.sim.t === 18, 'one computer: riding straight on is a head-on draw');
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
  await pg.setViewportSize({ width: 390, height: 844 });
  await h.closeGame(pg);
  await h.settle();
}

async function cyclesLiveLaptops(h, scheme) {
  console.log(`\n# Light Cycles, live on two laptops (${scheme})`);
  await goLive(h, 'cycles');
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
    await sleep(80);
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
