// Live, the guest's frames come from a virtual display (regular grid; the callback itself runs a little late or early: jitter) in real time;
// the partner's drawn car is measured against the grid. Both phones drive with the bot, nothing is drawn (drawHold).
const root = process.argv[2] || require('path').resolve(__dirname, '../../..'); const port = Number(process.argv[3]) || 9465; const out = process.argv[4] || ""; const HZ = Number(process.env.HZ || 60); const JIT = Number(process.env.JIT || 2);
const { launch } = require(root + '/tools/test/harness'); const fs = require('fs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FAST = { intro: 900, count: 1200, result: 1800, final: 900, resume: 1500, maxDpr: 0.6, heatT: 1.6, rules: { wildcards: 'off', score: 'rounds', roundTime: 600 }, rounds: 40 };
function install([hz, jit]) {
  const G = window.__getaway.internals; const V = window.__v = { rec: [], on: false, q: null, grid: 0 };
  const me = window.__getaway.state().me; const o = me === 'a' ? 'b' : 'a';
  window.requestAnimationFrame = (cb) => { V.q = cb; return 1; };
  let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const iv = 1000 / hz; V.grid = performance.now() + 50;
  const tick = () => {
    const target = V.grid + (rnd() - 0.5) * 2 * jit; // the callback runs at this moment, the timestamp it is given is the grid time
    const d = target - performance.now();
    if (d > 3) { setTimeout(tick, d - 2.5); return; }
    while (performance.now() < target) { /* spin to the exact moment */ }
    const cb = V.q; V.q = null; const gridNow = V.grid; V.grid += iv;
    if (cb) {
      cb(gridNow);
      if (V.on) {
        const cv = G.carViews; const S = G.S; const Rr = S.R;
        const vw = (w) => (Rr && cv ? (Rr.runner === w ? (w === 'a' ? cv.runA : cv.runB) : cv.cop) : null); const grp = (w) => { const v = vw(w); return v ? v.group : null; };
        const g = grp(o); const tl = vw(o) ? vw(o).tilt : null; const c = G.P2[o].car; const cam = window.__getaway.view(me); const gm = grp(me);
        V.rec.push([gridNow, g ? g.position.x : 0, g ? g.position.z : 0, c.speed, S.phase === 'chase' ? 1 : 0, cam.x, cam.z, gm ? gm.position.x : 0, gm ? gm.position.z : 0, G.P2[me].car.speed, tl ? tl.rotation.z : 0, tl ? tl.rotation.x : 0]);
      }
    }
    setTimeout(tick, Math.max(0, V.grid - 3 - performance.now()));
  };
  tick();
}
const q = (s, k) => s[Math.min(s.length - 1, Math.floor(s.length * k))];
function jerk(t, vals) { const d = (v, tt) => { const o = []; const to = []; for (let i = 1; i < v.length; i++) { const dt = tt[i] - tt[i - 1]; o.push(v[i].map((x, j) => (x - v[i - 1][j]) / dt)); to.push((tt[i] + tt[i - 1]) / 2); } return [o, to]; }; const [v, tv] = d(vals, t); const [a, ta] = d(v, tv); const [j] = d(a, ta); const m = j.map((x) => Math.hypot(...x)).sort((x, y) => x - y); return { med: q(m, 0.5), p95: q(m, 0.95) }; }
function analyze(rec) {
  const R = rec.filter((r) => r[4] === 1); const t = R.map((r) => r[0] / 1000);
  const ratio = []; for (let i = 1; i < R.length; i++) { const dt = t[i] - t[i - 1]; if (dt > 0.2) continue; const sp = (R[i][3] + R[i - 1][3]) / 2; if (sp > 8) ratio.push(Math.hypot(R[i][1] - R[i - 1][1], R[i][2] - R[i - 1][2]) / dt / sp); }
  const m = ratio.reduce((a, b) => a + b, 0) / ratio.length; const sd = Math.sqrt(ratio.reduce((a, b) => a + (b - m) ** 2, 0) / ratio.length); const s = ratio.slice().sort((a, b) => a - b);
  const pj = jerk(t, R.map((r) => [r[1], r[2]]));
  // pitch / roll of the partner's drawn car
  const pr = R.map((r) => Math.abs(r[10])); const pp = R.map((r) => Math.abs(r[11]));
  return { frames: R.length, speedMean: +(R.reduce((a, r) => a + r[3], 0) / R.length).toFixed(1), cvApparent: +(sd / m).toFixed(4), meanRatio: +m.toFixed(3), p05: +q(s, 0.05).toFixed(3), p95: +q(s, 0.95).toFixed(3), partnerJerkMed: +pj.med.toFixed(1), partnerJerkP95: +pj.p95.toFixed(1), partnerRollMaxDeg: +(Math.max(...pr) * 57.3).toFixed(2), partnerPitchMaxDeg: +(Math.max(...pp) * 57.3).toFixed(2) };
}
(async () => {
  const h = await launch({ port, only: ['getaway'], latency: 80, coarse: true });
  const { a, b } = h; const res = { hz: HZ, jitMs: JIT };
  try {
    for (const p of [a, b]) { await p.setViewportSize({ width: 568, height: 260 }); await p.evaluate((t) => { window.__gtwTest = true; window.__gtwTune = t; try { localStorage.removeItem('getaway.setup.v1'); localStorage.removeItem('getaway.device.v1'); } catch {} }, FAST); }
    await h.startLive(a, 'getaway', 'live'); await h.settle();
    const invited = await b.isVisible('#gm-invite').catch(() => false);
    if (invited) await b.click('#gm-invite [data-g="invite-yes"]'); else await h.startLive(b, 'getaway', 'live');
    const rdy = (p) => p.waitForFunction(() => window.__getaway && window.__getaway.ready, null, { timeout: 240000 });
    await rdy(a); await rdy(b);
    await b.waitForFunction(() => window.__getaway.state().linked, null, { timeout: 60000 }); await a.waitForFunction(() => window.__getaway.state().linked, null, { timeout: 60000 });
    await a.waitForFunction(() => { const p = window.__getaway.state().partnerSeen; return p && p.ph === 1 && p.sv >= 1; }, null, { timeout: 60000 });
    await a.tap('.g-gtw [data-l="start"]');
    await a.waitForFunction(() => window.__getaway.state().phase === 'chase', null, { timeout: 60000, polling: 100 });
    await b.waitForFunction(() => window.__getaway.state().phase === 'chase', null, { timeout: 60000, polling: 100 });
    await a.evaluate(() => window.__getaway.drawHold(true)); await b.evaluate(() => window.__getaway.drawHold(true));
    await a.waitForFunction(() => window.__getaway.navReady(), null, { timeout: 60000 }); await b.waitForFunction(() => window.__getaway.navReady(), null, { timeout: 60000 });
    await a.evaluate(() => window.__getaway.auto('a', true)); await b.evaluate(() => window.__getaway.auto('b', true));
    await b.evaluate(install, [HZ, JIT]);
    await wait(4000);
    const runs = [];
    for (let k = 0; k < 4; k++) {
      // a chase in progress on the guest
      for (let w = 0; w < 400; w++) { const ok = await b.evaluate(() => { const S = window.__getaway.internals.S; return S.phase === 'chase' && S.R && !S.R.over && !S.paused; }); if (ok) break; await wait(100); }
      await a.evaluate(() => window.__getaway.auto('a', true)); await b.evaluate(() => window.__getaway.auto('b', true));
      await wait(2500);
      await b.evaluate(() => { window.__v.rec.length = 0; window.__v.on = true; });
      await wait(7000);
      const rec = await b.evaluate(() => { window.__v.on = false; return window.__v.rec.slice(); });
      if (rec.filter((r) => r[4] === 1).length > 60) { runs.push(analyze(rec)); console.log(JSON.stringify(runs[runs.length - 1])); }
    }
    res.runs = runs;
    const med = (k) => { const v = runs.map((r) => r[k]).filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; };
    res.median = { cvApparent: med('cvApparent'), p05: med('p05'), p95: med('p95'), partnerJerkMed: med('partnerJerkMed'), partnerJerkP95: med('partnerJerkP95'), partnerRollMaxDeg: med('partnerRollMaxDeg'), partnerPitchMaxDeg: med('partnerPitchMaxDeg') };
    console.log('median', JSON.stringify(res.median));
  } catch (e) { res.error = String(e && e.stack || e); console.log('ERR', res.error); } finally { await h.close(); }
  if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
  process.exit(0);
})();
