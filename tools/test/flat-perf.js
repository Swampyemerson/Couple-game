// Frame-pacing probe for the 2D/DOM games (upgrade 2, flat unit). Not part of run-all.
//   node tools/test/flat-perf.js                 # every flat game
//   node tools/test/flat-perf.js four hockey     # some
//   DARK=1 SECS=8 node tools/test/flat-perf.js
// iPhone 13 profile, CPU throttled 4x through CDP. Each game is started (same phone, or live with the
// invite accepted for live-only games), then for SECS seconds the probe taps random things on the stage
// while it records rAF frame deltas, long tasks, and Chrome's layout / style-recalc counters.
// Prints one JSON line per game and a table.
const { launch } = require('./harness');

const ALL = ['four', 'dots', 'ultimate', 'fleet', 'wordduel', 'agents', 'doodle', 'wave', 'hockey', 'quickdraw', 'cycles', 'defuse'];
const LIVE = new Set(['hockey', 'quickdraw', 'cycles', 'defuse']);
const LIVE_ONLY = new Set(['defuse']);
const games = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const SECS = Number(process.env.SECS) || 8;

const PROBE = () => {
  const d = []; let last = performance.now(); let long = 0; let longMax = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { long++; longMax = Math.max(longMax, e.duration); } }).observe({ type: 'longtask', buffered: false }); } catch {}
  let on = true;
  const f = (t) => { d.push(t - last); last = t; if (on) requestAnimationFrame(f); };
  requestAnimationFrame(f);
  window.__perfStop = () => { on = false; return { d, long, longMax }; };
};

async function tapRandom(pg) {
  const pt = await pg.evaluate(() => {
    const st = document.querySelector('#game-root .gm-layer:not([hidden]) .gm-btn, #game-root .gm-curtain .gm-btn');
    const pool = st ? [st] : [...document.querySelectorAll('#game-root .gm-stage button:not([disabled]), #game-root .gm-stage [data-i], #game-root .gm-stage [data-c], #game-root .gm-stage canvas, #game-root .gm-stage .g-key')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight; });
    if (!pool.length) return null;
    const e = pool[Math.floor(Math.random() * pool.length)]; const r = e.getBoundingClientRect();
    return { x: r.left + r.width * (0.2 + Math.random() * 0.6), y: r.top + r.height * (0.2 + Math.random() * 0.6), drag: e.tagName === 'CANVAS' };
  });
  if (!pt) return;
  if (pt.drag) { await pg.mouse.move(pt.x, pt.y); await pg.mouse.down(); for (let i = 1; i <= 6; i++) await pg.mouse.move(pt.x + i * 9 - 27, pt.y + i * 5 - 15); await pg.mouse.up(); }
  else await pg.touchscreen.tap(pt.x, pt.y);
}

const q = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;

(async () => {
  const rows = [];
  for (const g of games) {
    const h = await launch({ port: 9700 + Math.floor(Math.random() * 280), only: [g], colorScheme: process.env.DARK ? 'dark' : 'light', coarse: true });
    try {
      const pg = h.a;
      if (LIVE_ONLY.has(g)) {
        await h.startLive(pg, g, 'live'); await h.settle();
        if (await h.b.isVisible('#gm-invite')) await h.b.click('#gm-invite [data-g="invite-yes"]');
        await h.settle(); await h.settle();
      } else if (LIVE.has(g)) await h.startLive(pg, g, 'local');
      else await h.newLocalGame(pg, g);
      await h.wait(800);
      const cdp = await pg.context().newCDPSession(pg);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await cdp.send('Performance.enable');
      const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
      await pg.evaluate(PROBE);
      const t0 = Date.now(); let taps = 0;
      while (Date.now() - t0 < SECS * 1000) { await tapRandom(pg).catch(() => {}); taps++; await h.wait(250); }
      const r = await pg.evaluate(() => window.__perfStop());
      const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
      const d = r.d.slice(2).sort((x, y) => x - y);
      const secs = (Date.now() - t0) / 1000;
      const row = {
        game: g, frames: d.length, fps: +(d.length / secs).toFixed(1),
        p50: +q(d, 0.5).toFixed(1), p95: +q(d, 0.95).toFixed(1), p99: +q(d, 0.99).toFixed(1), max: +(d[d.length - 1] || 0).toFixed(0),
        janky: +(100 * d.filter((x) => x > 25).length / Math.max(1, d.length)).toFixed(1),
        longTasks: r.long, longMax: Math.round(r.longMax),
        layoutsPerS: +((m1.LayoutCount - m0.LayoutCount) / secs).toFixed(1),
        layoutMsPerS: +(1000 * (m1.LayoutDuration - m0.LayoutDuration) / secs).toFixed(1),
        stylePerS: +((m1.RecalcStyleCount - m0.RecalcStyleCount) / secs).toFixed(1),
        scriptMsPerS: +(1000 * (m1.ScriptDuration - m0.ScriptDuration) / secs).toFixed(1),
        taps, errors: h.errors.length,
      };
      rows.push(row); console.log(JSON.stringify(row));
    } catch (e) { console.log(JSON.stringify({ game: g, error: String(e.message || e).slice(0, 200) })); }
    await h.close();
  }
  console.log('\ngame        fps   p50   p95   p99   max  jank%  long  lay/s  layms/s  style/s  js ms/s');
  for (const r of rows) console.log([r.game.padEnd(10), r.fps, r.p50, r.p95, r.p99, r.max, r.janky, r.longTasks, r.layoutsPerS, r.layoutMsPerS, r.stylePerS, r.scriptMsPerS].map((x) => String(x).padStart(5)).join(' '));
})();
