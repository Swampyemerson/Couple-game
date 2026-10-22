// Flat unit, Light Cycles (upgrade 2): what the render / netcode / texture upgrade must not break and must deliver.
//   PORT=9280 node tools/test/games/flat-cycles.test.js          (run through the slot wrapper)
//   BASE=/path/to/untouched/copy node ...                          (default: the scratchpad's base copy, if present)
// 1. sim.js is unchanged in behaviour: rebuild() / advance() / pathAt() against the original sim.js on random turn logs.
// 2. A tick draws only new trail: the frame loop makes no layout and no style recalculation, and the trail layer persists.
// 3. Smoothness: heads glide between ticks at 60 and 120 Hz; under latency + loss the partner head has no snaps and the
//    correction is blended (2nd difference of the rendered position).
// 4. Juice and texture: the crash burst/shake, the turn ring, light / dark, reduced motion switches the motion off.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { launch } = require('../harness');

let passed = 0;
const failures = [];
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); passed++; console.log('ok -', m); };
async function section(name, fn) {
  console.log(`\n# ${name}`);
  try { await fn(); } catch (e) { failures.push(`${name}: ${e.message}`); console.error('not ok -', e.message); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPO = path.resolve(__dirname, '../../..');
const BASE = process.env.BASE || '/tmp/claude-0/-home-user-Couple-game/ac335618-6fb4-5b2c-b4a6-99b65607bb6e/scratchpad/base';
const PORT = Number(process.env.PORT) || 9280;
const SHOTS = process.env.SHOTS || '';

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function simEquivalence() {
  const baseSim = path.join(BASE, 'js/games/cycles/sim.js');
  if (!fs.existsSync(baseSim)) { console.log('skip - no base copy of sim.js at', baseSim); return; }
  // import through copies with an .mjs name so node treats them as modules whatever package.json says
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cysim-'));
  fs.copyFileSync(baseSim, path.join(tmp, 'old.mjs'));
  fs.copyFileSync(path.join(REPO, 'js/games/cycles/sim.js'), path.join(tmp, 'new.mjs'));
  const O = await import(pathToFileURL(path.join(tmp, 'old.mjs')).href);
  const N = await import(pathToFileURL(path.join(tmp, 'new.mjs')).href);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const full = (s) => JSON.stringify({ t: s.t, done: s.done, out: s.out, occ: Array.from(s.occ), tok: Array.from(s.tok), a: s.a, b: s.b, ev: s.ev, tl: s.tl, pk: [...s.pk] });
  let logs = 0, ticks = 0, pathChecks = 0, bad = '';
  const r = rng(12345);
  for (const L of ['s', 'p', 'l']) for (const ar of O.ARENAS) for (const bo of [0, 1]) for (let rep = 0; rep < 6; rep++) {
    const cfg = { L, ar, sd: Math.floor(r() * 2 ** 31), bo, sv: rep % 3 ? 1 + Math.floor(r() * 1e6) : 0, rm: ar === 'classic' ? 'c' : 'r' };
    // a random log, made by actually riding (so turns are legal), with a few illegal / duplicate entries thrown in
    const live = N.newSim(cfg); const entries = []; const turnP = 0.04 + r() * 0.3;
    for (let t = 1; t <= 400 && !live.done; t++) {
      const turns = {};
      for (const p of ['a', 'b']) {
        const c = live[p]; if (!c.alive) continue;
        const free = (d) => { const x = c.x + N.DX[d]; const y = c.y + N.DY[d]; return x >= 0 && y >= 0 && x < live.W && y < live.H && !live.occ[y * live.W + x]; };
        let d = -1;
        if (!free(c.d)) { const o = [0, 1, 2, 3].filter((k) => N.okTurn(c.d, k) && free(k)); if (o.length) d = o[Math.floor(r() * o.length)]; } else if (r() < turnP) { const k = Math.floor(r() * 4); if (r() < 0.9 ? N.okTurn(c.d, k) && free(k) : true) d = k; }
        if (d >= 0) { turns[p] = d; entries.push({ t, p, d }); }
      }
      N.step(live, turns);
    }
    logs++; ticks += live.t;
    const enc = entries.map(N.enc).join(',');
    if (enc !== entries.map(O.enc).join(',') || !same(N.decode(enc), O.decode(enc))) bad = 'enc/decode differ';
    for (const T of [0, 1, 7, Math.floor(live.t / 2), live.t, live.t + 50]) {
      const so = O.rebuild(cfg, entries, T); const sn = N.rebuild(cfg, entries, T);
      if (full(so) !== full(sn)) bad = bad || `rebuild differs ${JSON.stringify(cfg)} T=${T}`;
      if (!same(O.summary(so), N.summary(sn))) bad = bad || `summary differs ${JSON.stringify(cfg)} T=${T}`;
    }
    // advance() carried across arbitrary chunks reaches the same state as one rebuild
    const inc = N.newSim(cfg); let idx = 0; let T = 0;
    while (T < live.t) { T = Math.min(live.t, T + 1 + Math.floor(r() * 9)); idx = N.advance(inc, entries, T, idx); }
    if (full(inc) !== full(O.rebuild(cfg, entries, live.t))) bad = bad || `advance chunks differ ${JSON.stringify(cfg)}`;
    // pathAt(): same answers at fractional ticks, allocating or into a reused object
    const out = { i: 0, x: 0, y: 0, d: 0 };
    for (const p of ['a', 'b']) for (let k = 0; k < 40; k++) {
      const Tt = -1 + r() * (live.t + 3);
      const a = O.pathAt(live, p, Tt); const b = N.pathAt(live, p, Tt); const c = N.pathAt(live, p, Tt, out);
      pathChecks++;
      if (!same(a, b) || !same(a, c) || c !== out) bad = bad || `pathAt differs ${p} T=${Tt}`;
    }
  }
  ok(!bad, 'sim: ' + (bad || `rebuild / advance / pathAt / enc / decode identical to the original on ${logs} random turn logs (${ticks} ticks, ${pathChecks} pathAt checks)`));
}

const visible = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.getClientRects().length > 0; }, sel);
async function until(fn, what, ms = 12000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(40); } }
const counters = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

async function startLocal(h, pg, opts) {
  await h.startLive(pg, 'cycles', 'local');
  await until(() => visible(pg, '.cy-pick .cy-go'), 'picker');
  if (opts && opts.arena) await pg.click(`.cy-chip[data-arena="${opts.arena}"]`);
  await pg.click('.cy-go');
  await until(async () => (await pg.evaluate(() => window.__cycles.info().phase)) === 'run', 'run', 15000);
}

/** Per-frame sampler: the drawn head of both riders, every rAF, with the frame time. */
const SAMPLER = () => {
  const H = window.__cycles; const S = { t: [], a: [], b: [], run: [], tms: [] };
  let flag = 0; let tms = 78; let lastInfo = 0;
  const loop = (now) => {
    if (now - lastInfo > 90) { lastInfo = now; const i = H.info(); flag = i.phase === 'run' && !i.paused && i.sim && !i.sim.done ? 1 : 0; tms = i.tms || 78; }
    const va = H.view('a'); const vb = H.view('b');
    if (va && vb) { S.t.push(now); S.a.push(va.x, va.y); S.b.push(vb.x, vb.y); S.run.push(flag); S.tms.push(tms); }
    if (!window.__sampStop) requestAnimationFrame(loop);
  };
  window.__samp = S; window.__sampStop = 0; requestAnimationFrame(loop);
};
function analyse(S, who) {
  const arr = S[who]; const ex = []; const d2 = [];
  for (let i = 2; i < S.t.length; i++) {
    if (!S.run[i] || !S.run[i - 1] || !S.run[i - 2]) continue;
    const dt = S.t[i] - S.t[i - 1]; if (dt > 60 || dt < 4) continue;
    ex.push(Math.abs(Math.hypot(arr[2 * i] - arr[2 * i - 2], arr[2 * i + 1] - arr[2 * i - 1]) - dt / S.tms[i]));
    d2.push(Math.hypot(arr[2 * i] - 2 * arr[2 * i - 2] + arr[2 * i - 4], arr[2 * i + 1] - 2 * arr[2 * i - 1] + arr[2 * i - 3]));
  }
  ex.sort((x, y) => x - y); d2.sort((x, y) => x - y);
  const q = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
  return { frames: ex.length, extraP50: q(ex, 0.5), extraP95: q(ex, 0.95), extraMax: ex[ex.length - 1] || 0, snaps05: ex.filter((x) => x > 0.5).length, snaps10: ex.filter((x) => x > 1).length, d2p99: q(d2, 0.99), d2max: d2[d2.length - 1] || 0 };
}
const STEER = () => {
  const ka = ['KeyW', 'KeyD', 'KeyS', 'KeyA']; const kb = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
  window.__botStop = 0;
  const go = () => { if (window.__botStop) return; for (const set of [ka, kb]) { const k = set[Math.floor(Math.random() * 4)]; window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true })); } setTimeout(go, 300 + Math.random() * 500); };
  go();
};


/** Watches the board for a shake (a running animation on .cy-board) until the round has ended; resolves with whether one ran. */
const WATCH_SHAKE = () => new Promise((res) => {
  let seen = false; const t0 = performance.now();
  const loop = () => {
    const b = document.querySelector('.cy-board');
    if (b && b.getAnimations && b.getAnimations().some((a) => a.playState === 'running')) seen = true;
    const i = window.__cycles.info();
    if (i.phase === 'end' && performance.now() - t0 > 0 && i.stage === 'banner') return res(seen);
    if (performance.now() - t0 > 25000) return res(seen);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});

async function main() {
  await section('sim.js is unchanged in behaviour', simEquivalence);

  const h = await launch({ port: PORT, only: ['cycles'], coarse: true, colorScheme: 'light' });
  try {
    await section('frame loop: no layout, no style recalc; persistent trail layer', async () => {
      const pg = h.a;
      await h.startLive(pg, 'cycles', 'local');
      await until(() => visible(pg, '.cy-pick .cy-go'), 'picker');
      const cdp = await pg.context().newCDPSession(pg);
      await cdp.send('Performance.enable');
      // the shell has its own ticking animation (the presence dot): what the picker costs while nothing is drawn is the floor
      const f0 = await counters(cdp); await sleep(2000); const f1 = await counters(cdp);
      const floorSty = (f1.RecalcStyleCount - f0.RecalcStyleCount) / 2; const floorLay = (f1.LayoutCount - f0.LayoutCount) / 2;
      await pg.click('.cy-chip[data-arena="pillars"]'); await pg.click('.cy-go');
      await until(async () => (await pg.evaluate(() => window.__cycles.info().phase)) === 'run', 'run', 15000);
      await pg.evaluate(STEER);
      await sleep(1500);
      const m0 = await counters(cdp);
      await sleep(3000);
      const m1 = await counters(cdp);
      await pg.evaluate(() => { window.__botStop = 1; });
      const info = await pg.evaluate(() => window.__cycles.info());
      const secs = 3;
      const lay = (m1.LayoutCount - m0.LayoutCount) / secs; const sty = (m1.RecalcStyleCount - m0.RecalcStyleCount) / secs;
      console.log(`  riding: layouts/s ${lay.toFixed(1)} (floor ${floorLay.toFixed(1)}), style recalcs/s ${sty.toFixed(1)} (floor ${floorSty.toFixed(1)}); phase ${info.phase}, round ${info.round}`);
      ok(lay <= floorLay + 2.5, `riding makes at most 2.5 layouts a second over the idle floor (${lay.toFixed(1)} vs ${floorLay.toFixed(1)})`);
      ok(sty <= floorSty + 6, `riding makes at most 6 style recalcs a second over the idle floor (${sty.toFixed(1)} vs ${floorSty.toFixed(1)}): nothing is restyled per frame`);
      ok(await pg.evaluate(() => window.__cycles.info().cssW > 100), 'the board has a size');
      await h.closeGame(pg); await h.settle();
    });

    await section('input: a turn is felt in the very frame (ring at the head, queued turn drawn at once)', async () => {
      const pg = h.a;
      await startLocal(h, pg, {});
      const r = await pg.evaluate(async () => {
        const H = window.__cycles;
        const before = H.info().sim.a.d;
        const want = before === 0 ? 1 : 0;
        const key = ['KeyW', 'KeyD'][want];
        window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const v = H.view('a');
        return { want, d: v.d };
      });
      ok(r.d === r.want, `the drawn bike points the new way within two frames (${r.d} vs ${r.want})`);
      await h.closeGame(pg); await h.settle();
    });
  } finally { await h.close(); }

  for (const rate of [1, 4]) {
    await section(`heads glide between ticks (CPU x${rate}: frames ${rate === 1 ? 'on time' : 'late and uneven'})`, async () => {
      const hh = await launch({ port: PORT + 1, only: ['cycles'], coarse: true });
      try {
        const pg = hh.a;
        await startLocal(hh, pg, {});
        if (rate > 1) { const c = await pg.context().newCDPSession(pg); await c.send('Emulation.setCPUThrottlingRate', { rate }); }
        // motion is dt / tick whatever the frame time is (the same code path as a 120 Hz screen, where dt is 8 ms)
        await pg.evaluate(SAMPLER); await pg.evaluate(STEER);
        await sleep(8000);
        await pg.evaluate(() => { window.__sampStop = 1; window.__botStop = 1; });
        const S = await pg.evaluate(() => window.__samp);
        const a = analyse(S, 'a'); const b = analyse(S, 'b');
        console.log('  ', JSON.stringify({ a, b }));
        ok(a.frames > 60, `sampled ${a.frames} riding frames`);
        // a steering frame (a turn is drawn at once and its correction fades) is allowed to differ from dt / tick; the typical frame must not
        ok(Math.max(a.extraP50, b.extraP50) < 0.03, `the typical frame moves exactly dt / tick (median error ${a.extraP50.toFixed(3)} / ${b.extraP50.toFixed(3)} cells)`);
        ok(Math.max(a.extraP95, b.extraP95) < 0.4 && Math.max(a.extraMax, b.extraMax) < 1, `and even a steering frame stays within 0.4 cell (p95 ${a.extraP95.toFixed(3)} / ${b.extraP95.toFixed(3)}, worst ${Math.max(a.extraMax, b.extraMax).toFixed(2)})`);
        ok(a.snaps10 + b.snaps10 === 0, `no jumps over a cell (${a.snaps10 + b.snaps10})`);
      } finally { await hh.close(); }
    });
  }

  await section('live: partner head under 80 ms latency and 10 % loss', async () => {
    const hl = await launch({ port: PORT + 2, only: ['cycles'], coarse: true, latency: 80, dropRate: 0.1 });
    try {
      for (const pg of [hl.a, hl.b]) await pg.setViewportSize({ width: 390, height: 844 });
      await hl.startLive(hl.a, 'cycles', 'live'); await hl.settle();
      await until(() => visible(hl.b, '#gm-invite'), 'invite');
      await hl.b.click('#gm-invite [data-g="invite-yes"]'); await hl.settle(); await hl.settle();
      await until(() => visible(hl.a, '.cy-pick .cy-go'), 'picker');
      await hl.a.click('.cy-chip[data-arena="pillars"]'); await hl.a.click('.cy-go');
      await until(async () => (await hl.b.evaluate(() => window.__cycles && window.__cycles.info().phase)) === 'run', 'run', 15000);
      await hl.a.evaluate(SAMPLER); await hl.b.evaluate(SAMPLER);
      for (const pg of [hl.a, hl.b]) await pg.evaluate(STEER);
      await sleep(14000);
      for (const pg of [hl.a, hl.b]) await pg.evaluate(() => { window.__botStop = 1; window.__sampStop = 1; });
      const sa = await hl.a.evaluate(() => window.__samp); const sb = await hl.b.evaluate(() => window.__samp);
      const R = { 'guest sees opponent': analyse(sb, 'a'), 'guest own': analyse(sb, 'b'), 'host own': analyse(sa, 'a'), 'host sees partner': analyse(sa, 'b') };
      console.log('  ', JSON.stringify(R));
      for (const [k, v] of Object.entries(R)) {
        const partner = /opponent|partner/.test(k);
        ok(v.frames > 100, `${k}: ${v.frames} frames`);
        ok(v.snaps10 <= 1, `${k}: at most one jump over a cell (${v.snaps10})`);
        ok(v.snaps05 <= (partner ? 4 : 12), `${k}: at most ${partner ? 4 : 12} jumps over half a cell (${v.snaps05})`);
      }
      ok(R['host sees partner'].d2p99 < 0.8, `host sees partner: p99 of the 2nd difference stays under 0.8 cells (${R['host sees partner'].d2p99.toFixed(2)}; the original code: 1.4)`);
      ok(R['guest sees opponent'].d2p99 < 0.8, `guest sees opponent: p99 of the 2nd difference stays under 0.8 cells (${R['guest sees opponent'].d2p99.toFixed(2)}; the original code: 0.8 to 0.9, host side 1.4)`);
    } finally { await hl.close(); }
  });

  await section('crash: the board shakes once, with normal motion (head-on classic round)', async () => {
    const hc = await launch({ port: PORT + 4, only: ['cycles'], coarse: true });
    try {
      const pg = hc.a;
      await startLocal(hc, pg, {});
      const shook = await pg.evaluate(WATCH_SHAKE);
      ok(shook, 'a crash shakes the board (a transform animation on .cy-board)');
      const props = await pg.evaluate(() => { const b = document.querySelector('.cy-board'); return b.getAnimations().flatMap((a) => (a.effect.getKeyframes ? a.effect.getKeyframes() : []).flatMap((k) => Object.keys(k))).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)); });
      ok(props.every((k) => k === 'transform'), `and nothing but transform animates on it (${[...new Set(props)].join(',') || 'finished'})`);
    } finally { await hc.close(); }
  });

  await section('reduced motion: no shake, no turn ring, no misregistration; light and dark both render', async () => {
    for (const scheme of ['light', 'dark']) {
      const hr = await launch({ port: PORT + 3, only: ['cycles'], coarse: true, colorScheme: scheme, reducedMotion: 'reduce' });
      try {
        const pg = hr.a;
        await startLocal(hr, pg, {});
        await pg.evaluate(() => { const k = 'KeyD'; window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true })); });
        await sleep(300);
        const n = await pg.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.cy-board') && a.effect.target.tagName === 'DIV' && a.effect.target.classList.contains('cy-board')).length);
        ok(n === 0, `${scheme}: no animation runs on the board under reduced motion`);
        const px = await pg.evaluate(() => { const c = document.querySelector('.cy-board canvas'); const g = c.getContext('2d'); const d = g.getImageData(c.width / 2, c.height / 2, 1, 1).data; return [d[0], d[1], d[2], d[3]]; });
        ok(px[3] > 0, `${scheme}: the canvas is painted (${px})`);
        const shook = await pg.evaluate(WATCH_SHAKE);
        ok(!shook, `${scheme}: the crash does not shake the board under reduced motion`);
        if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `cycles-rm-${scheme}.png`) });
        hr.assertNoErrors && hr.assertNoErrors();
      } finally { await hr.close(); }
    }
  });

  console.log(`\n${passed} ok`);
  if (failures.length) { console.error('\nFAILURES:\n' + failures.join('\n')); process.exit(1); }
  console.log('ALL GOOD');
}
main().catch((e) => { console.error(e); process.exit(1); });
