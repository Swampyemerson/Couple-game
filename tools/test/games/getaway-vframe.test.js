// Deterministic frame-pacing harness: the game's rAF is replaced by a virtual display (60 / 120 Hz grids with timestamp jitter,
// dropped frames); nothing is drawn (drawHold) so the machine's load doesn't matter. Metrics are against the display grid, i.e. what the eye sees.
const root = process.argv[2] || require('path').resolve(__dirname, '../../..'); const port = Number(process.argv[3]) || 9460; const out = process.argv[4] || '';
const { launch } = require(root + '/tools/test/harness');
const fs = require('fs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FAST = { intro: 900, count: 1200, result: 1800, final: 900, resume: 1500, maxDpr: 0.6, heatT: 1.6, rules: { wildcards: 'off', score: 'rounds', roundTime: 600 } };
function install() {
  const G = window.__getaway.internals;
  if (window.__v) return;
  const V = window.__v = { q: null, ts: performance.now(), rec: [] };
  const oraf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { V.q = cb; return 1; };
  // flush: a real frame may be pending; our hook takes over at its next registration
  V.step = (ts, grid) => {
    const cb = V.q; if (!cb) return false; V.q = null; cb(ts);
    const cv = G.carViews; const S = G.S; const me = window.__getaway.state().me; const Rr = S.R;
    const grp = (w) => (Rr && cv ? (Rr.runner === w ? (w === 'a' ? cv.runA : cv.runB) : cv.cop).group : null);
    const g = grp(me); const c = G.P2[me].car; const cam = window.__getaway.view(me);
    const cr = window.__getaway.camRig();
    V.rec.push([grid, g ? g.position.x : 0, g ? g.position.z : 0, g ? g.rotation.y : 0, cam.x, cam.z, cr.yaw, c.speed, c.r, S.phase === 'chase' ? 1 : 0, cam.y]);
    return true;
  };
  V.run = (n, hz, jit, drop, seed) => {
    V.rec.length = 0; let s = seed; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    let grid = 0; let lastTs = V.ts;
    for (let i = 0; i < n; i++) {
      grid += 1000 / hz; if (drop && rnd() < drop) grid += 1000 / hz; // a dropped frame: the display shows nothing new for one interval
      let ts = V.ts + grid + (rnd() - 0.5) * 2 * jit; if (ts <= lastTs) ts = lastTs + 0.5; lastTs = ts;
      if (!V.step(ts, grid)) break;
    }
    V.ts = V.ts + grid + 50;
    return V.rec.slice();
  };
}
const unwrap = (a) => { const o = [a[0]]; for (let i = 1; i < a.length; i++) { let d = a[i] - a[i - 1]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; o.push(o[i - 1] + d); } return o; };
const q = (s, k) => s[Math.min(s.length - 1, Math.floor(s.length * k))];
function jerk(t, vals) { // vals: arrays per frame of k comps; t in s
  const d = (v, tt) => { const o = []; const to = []; for (let i = 1; i < v.length; i++) { const dt = tt[i] - tt[i - 1]; o.push(v[i].map((x, j) => (x - v[i - 1][j]) / dt)); to.push((tt[i] + tt[i - 1]) / 2); } return [o, to]; };
  const [v, tv] = d(vals, t); const [a, ta] = d(v, tv); const [j] = d(a, ta); const m = j.map((x) => Math.hypot(...x)).sort((x, y) => x - y); return { med: q(m, 0.5), p95: q(m, 0.95) };
}
function analyze(rec) {
  const R = rec.filter((r) => r[9] === 1); if (R.length < 30) { console.log('short', rec.length, R.length); return { cvApparent: 0, p05: 0, p95: 0, camJerkMed: 0, camJerkP95: 0, carJerkMed: 0, carJerkP95: 0, camYawJerkMed: 0, camYawJerkP95: 0, carYawJerkMed: 0, carYawJerkP95: 0 }; } const t = R.map((r) => r[0] / 1000);
  const ratio = []; for (let i = 1; i < R.length; i++) { const dt = t[i] - t[i - 1]; const sp = (R[i][7] + R[i - 1][7]) / 2; if (sp > 10) ratio.push(Math.hypot(R[i][1] - R[i - 1][1], R[i][2] - R[i - 1][2]) / dt / sp); }
  const m = ratio.reduce((a, b) => a + b, 0) / ratio.length; const sd = Math.sqrt(ratio.reduce((a, b) => a + (b - m) ** 2, 0) / ratio.length); const s = ratio.slice().sort((a, b) => a - b);
  const camYaw = unwrap(R.map((r) => r[6])); const carRot = unwrap(R.map((r) => r[3]));
  const cj = jerk(t, R.map((r) => [r[4], r[5]])); const kj = jerk(t, R.map((r) => [r[1], r[2]])); const yj = jerk(t, camYaw.map((x) => [x])); const rj = jerk(t, carRot.map((x) => [x]));
  // the car's place in the lens: bearing from the camera to the car vs the camera's heading (deg)
  return { frames: R.length, cvApparent: +(sd / m).toFixed(4), meanRatio: +m.toFixed(3), p05: +(q(s, 0.05) || 0).toFixed(3), p95: +(q(s, 0.95) || 0).toFixed(3), camJerkMed: +cj.med.toFixed(1), camJerkP95: +cj.p95.toFixed(1), carJerkMed: +kj.med.toFixed(1), carJerkP95: +kj.p95.toFixed(1), camYawJerkMed: +yj.med.toFixed(3), camYawJerkP95: +yj.p95.toFixed(3), carYawJerkMed: +rj.med.toFixed(3), carYawJerkP95: +rj.p95.toFixed(3) };
}
let ensureChase = async () => {};
(async () => {
  const h = await launch({ port, only: ['getaway'], who: ['a'], coarse: true });
  const a = h.a; const res = {};
  try {
    await a.setViewportSize({ width: 568, height: 260 });
    await a.evaluate((t) => { window.__gtwTest = true; window.__gtwTune = t; try { localStorage.removeItem('getaway.setup.v1'); localStorage.removeItem('getaway.device.v1'); } catch {} }, { ...FAST, rounds: 40, intro: 1500 });
    await h.startLive(a, 'getaway', 'local');
    await a.waitForFunction(() => window.__getaway && window.__getaway.ready, null, { timeout: 240000 });
    await a.evaluate(() => window.__getaway.drawHold(true));
    await a.tap('.g-gtw [data-l="start"]');
    await a.waitForFunction(() => window.__getaway.state().phase === 'chase', null, { timeout: 60000, polling: 100 });
    await a.waitForFunction(() => window.__getaway.navReady(), null, { timeout: 60000, polling: 100 });
    await a.evaluate(() => window.__getaway.auto('a', true));
    await a.evaluate(install);
    ensureChase = async () => {
      for (let k = 0; k < 400; k++) {
        const ok = await a.evaluate(() => { const S = window.__getaway.internals.S; return S.phase === 'chase' && S.R && !S.R.over && !S.paused; });
        if (ok) break;
        await a.evaluate(() => { window.__v.run(4, 60, 0.2, 0, 7); });
        await wait(40);
      }
      await a.evaluate(() => { window.__getaway.auto('a', true); window.__v.run(240, 60, 0.3, 0, 5); });
    };
    await wait(500);
    const scen = [['60Hz j0.5', 60, 0.5, 0], ['60Hz j2', 60, 2, 0], ['120Hz j1', 120, 1, 0], ['60Hz j1 + 4% drops', 60, 1, 0.04], ['90Hz j1', 90, 1, 0]].slice(0, Number(process.env.NSC || 5));
    // warm up: get the bot moving at speed
    await a.evaluate(() => { window.__v.run(600, 60, 0.3, 0, 1); });
    for (const [name, hz, jit, drop] of scen) {
      const n = Math.round(hz * 6); const reps = [];
      for (const seed of [11, 222, 3333, 44444]) {
        await ensureChase();
        const rec = await a.evaluate(([n, hz, jit, drop, seed]) => window.__v.run(n, hz, jit, drop, seed), [n, hz, jit, drop, seed]);
        reps.push(analyze(rec));
      }
      const med = (k) => { const v = reps.map((r) => r[k]).filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; return +((v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2).toFixed(4); };
      res[name] = { cvApparent: reps.map((r) => r.cvApparent), cvMedian: med('cvApparent'), p05: med('p05'), p95: med('p95'), camJerkMed: med('camJerkMed'), camJerkP95: med('camJerkP95'), carJerkMed: med('carJerkMed'), carJerkP95: med('carJerkP95'), camYawJerkMed: med('camYawJerkMed'), camYawJerkP95: med('camYawJerkP95'), carYawJerkMed: med('carYawJerkMed'), carYawJerkP95: med('carYawJerkP95'), phaseAfter: await a.evaluate(() => window.__getaway.state().phase) };
      console.log(name, JSON.stringify(res[name]));
    }
  } catch (e) { res.error = String(e && e.stack || e); console.log('ERR', res.error); } finally { await h.close(); }
  if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
  process.exit(0);
})();
