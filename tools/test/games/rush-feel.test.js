// Rail Rush feel metrics: two phones live (iPhone 13 profile, both CPUs throttled 4×), one Race.
// Measures on Emerson's phone:
//   - frame pacing: rAF interval mean / sd / p95 / p99, share of frames over 1.5× the median;
//   - motion judder: how far the drawn runner's per-frame advance strays from speed × frame interval
//     (RMS, as a share of one frame's advance); the partner's (network-interpolated) runner too;
//   - input → response: real touch swipes; from the touchmove that fires the lane change to the end of
//     the first frame whose drawn runner (and camera) has moved toward the new lane; lane change length;
//   - camera: lateral jerk (RMS of the third difference, m/s³), per-frame teleports (> 0.35 m lateral
//     or > 0.6 m off the expected forward step), max lateral speed of the camera;
//   - GPU budget: draw calls and triangles per frame (p50 / max), texture memory (bytes of every
//     texture reachable from the scene, × 4/3 when mipmapped).
// Asserts only budgets (calls ≤ 30, triangles ≤ 60k, textures ≤ 8 MB) and that swipes respond within
// 3 frames; prints the rest as JSON (FEEL_OUT=<file> also writes it).
//   node tools/test/games/rush-feel.test.js         (CPU=1 for an unthrottled run, SECS=20 run length)
const fs = require('fs');
const { launch } = require('../harness');

const CPU = +(process.env.CPU || 4);
const SECS = +(process.env.SECS || 20);
const PORT = +(process.env.RUSH_PORT || 8975);
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const until = async (pg, fn, arg, ms = 15000, what = 'condition') => {
  try { await pg.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); } catch { throw new Error('FAIL: timed out waiting for ' + what); }
};

async function swipe(pg, x0, y0, dx, dy) {
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 4; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / 4, y: y0 + (dy * i) / 4 }] });
    await new Promise((r) => setTimeout(r, 12));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

// In the page: a rAF recorder that runs after the game's frame (registered later in each frame).
const RECORDER = () => {
  const I = window.__rush.internals;
  const me = window.__rush.state().me;
  const pa = I.players[me]; const pb = I.players[me === 'a' ? 'b' : 'a'];
  const R = window.__rec = { f: [], lat: [], lastMove: 0, lastLane: pa.r.lane, pend: null, on: true };
  const cap = (e) => { R.lastMove = e.timeStamp; };
  window.addEventListener('touchmove', cap, { capture: true, passive: true });
  window.addEventListener('pointermove', cap, { capture: true, passive: true });
  const info = I.renderer.info.render;
  const loop = (ts) => {
    if (!R.on) return;
    requestAnimationFrame(loop);
    const r = pa.r; const s = pa.rs; const c = pa.rig.cam.position;
    const t1 = performance.now();
    R.f.push([ts, s.z, s.x, r.speed, c.x, c.y, c.z, pb.rs.z, pb.rs.speed, info.calls, info.triangles, t1, I.M.alpha, r.down ? 1 : 0]);
    if (r.lane !== R.lastLane) {
      if (R.pend) R.lat.push({ vis: R.pend.vis, visF: R.pend.visF, cam: R.pend.cam, laneMs: R.pend.done });
      R.pend = { t0: R.lastMove, x0: s.x, cx0: c.x, dir: Math.sign(r.lane - R.lastLane), target: r.lane * 2.4, ts0: ts, frames: 0, vis: null, visF: null, cam: null, done: null };
      R.lastLane = r.lane;
    }
    const p = R.pend;
    if (p) {
      p.frames++;
      if (p.vis === null && (s.x - p.x0) * p.dir > 0.02) p.vis = t1 - p.t0, p.visF = p.frames;
      if (p.cam === null && (c.x - p.cx0) * p.dir > 0.01) p.cam = t1 - p.t0;
      if (p.done === null && Math.abs(s.x - p.target) < 0.03) p.done = ts - p.ts0;
      if ((p.vis !== null && p.cam !== null && p.done !== null) || p.frames > 90) { R.lat.push({ vis: p.vis, visF: p.visF, cam: p.cam, laneMs: p.done }); R.pend = null; }
    }
  };
  requestAnimationFrame(loop);
};

const TEXMEM = () => {
  const I = window.__rush.internals; const seen = new Set(); let bytes = 0; let n = 0;
  const add = (t) => {
    if (!t || !t.isTexture || seen.has(t)) return; seen.add(t); n++;
    const im = t.image || {}; const w = im.width || 0; const h = im.height || 0;
    bytes += w * h * 4 * (t.generateMipmaps && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1);
  };
  const scan = (m) => {
    if (!m) return;
    for (const k in m) { const v = m[k]; if (v && v.isTexture) add(v); }
    if (m.uniforms) for (const k in m.uniforms) add(m.uniforms[k] && m.uniforms[k].value);
  };
  const scenes = [I.world.scene];
  if (I.overlay && I.overlay.scene) scenes.push(I.overlay.scene);
  for (const sc of scenes) sc.traverse((o) => { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(scan); });
  return { textures: n, bytes, glTextures: I.renderer.info.memory.textures };
};

function stats(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).slice().sort((p, q) => p - q);
  if (!a.length) return null;
  const q = (k) => a[Math.min(a.length - 1, Math.floor(k * a.length))];
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const sd = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length);
  const r = (x) => Math.round(x * 100) / 100;
  return { n: a.length, mean: r(mean), sd: r(sd), p50: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(a[a.length - 1]) };
}

function analyse(f) {
  const dts = []; const judder = []; const judderB = []; const jerk = []; let teleports = 0; let camVmax = 0;
  for (let i = 1; i < f.length; i++) {
    const dt = (f[i][0] - f[i - 1][0]) / 1000;
    if (dt <= 0) continue;
    dts.push(dt * 1000);
    if (f[i][13] || f[i - 1][13]) continue; // down: no forward motion to judge
    const exp = f[i][3] * dt;
    if (exp > 0.05) judder.push((f[i][1] - f[i - 1][1] - exp) / (f[i][3] / 60));
    const expB = f[i][8] * dt;
    if (expB > 0.05) judderB.push((f[i][7] - f[i - 1][7] - expB) / (f[i][8] / 60));
    const dx = f[i][4] - f[i - 1][4]; const dy = f[i][5] - f[i - 1][5];
    const lat = Math.hypot(dx, dy);
    const dzc = -(f[i][6] - f[i - 1][6]);
    if (lat > 0.35 || Math.abs(dzc - exp) > 0.6) teleports++;
    camVmax = Math.max(camVmax, lat / dt);
    if (i >= 3) {
      // third difference of the camera's lateral position over non-uniform steps (m/s³)
      const v = (k) => (f[k][4] - f[k - 1][4]) / ((f[k][0] - f[k - 1][0]) / 1000);
      const a1 = (v(i) - v(i - 1)) / dt; const a0 = (v(i - 1) - v(i - 2)) / ((f[i - 1][0] - f[i - 2][0]) / 1000);
      const j = (a1 - a0) / dt;
      if (Number.isFinite(j)) jerk.push(Math.abs(j));
    }
  }
  const med = stats(dts).p50;
  const rms = (xs) => Math.round(Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / Math.max(1, xs.length)) * 1000) / 1000;
  return {
    frames: f.length, frameMs: stats(dts), longFrames: Math.round((dts.filter((d) => d > med * 1.5).length / dts.length) * 1000) / 10 + '%',
    judderRms: rms(judder), judderP95: stats(judder.map(Math.abs)).p95, partnerJudderRms: rms(judderB), partnerJudderP95: judderB.length ? stats(judderB.map(Math.abs)).p95 : null,
    camJerkRms: rms(jerk), camJerkP95: stats(jerk).p95, camTeleports: teleports, camLatVmax: Math.round(camVmax * 100) / 100,
    calls: { p50: stats(f.map((x) => x[9])).p50, max: stats(f.map((x) => x[9])).max }, tris: { p50: stats(f.map((x) => x[10])).p50, max: stats(f.map((x) => x[10])).max },
  };
}

(async () => {
  const h = await launch({ port: PORT, only: ['rush'], latency: 80, coarse: true });
  const { a, b } = h;
  let out = null;
  try {
    for (const pg of [a, b]) await pg.evaluate(() => { window.__RUSH_DEBUG = { raceLen: 30000, noTutorial: true }; });
    await h.startLive(a, 'rush', 'live');
    await h.settle();
    if (await b.isVisible('#gm-invite').catch(() => false)) await b.click('#gm-invite [data-g="invite-yes"]');
    else await h.startLive(b, 'rush', 'live');
    await until(a, () => window.__rush && window.__rush.state().ready3D, null, 30000, 'host 3D ready');
    await until(b, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().synced, null, 30000, 'guest ready');
    const cdps = [];
    for (const pg of [a, b]) { const c = await pg.context().newCDPSession(pg); await c.send('Emulation.setCPUThrottlingRate', { rate: CPU }); cdps.push(c); }
    await until(a, () => !document.querySelector('.g-rush .rr-ov-lobby [data-r="go"]').disabled, null, 20000, 'start enabled');
    await a.click('.g-rush .rr-mode[data-mode="race"]');
    await until(b, () => window.__rush.state().lobbyMode === 'race', null, 8000, 'guest sees race');
    await a.click('.g-rush .rr-ov-lobby [data-r="go"]');
    await until(a, () => window.__rush.state().phase === 'run' && window.__rush.state().steps > 60, null, 30000, 'running');
    await a.evaluate(() => { window.__rush.ghost('a', 200); });
    await b.evaluate(() => { window.__rush.ghost('b', 200); window.__rush.auto('b', true); });
    await a.evaluate(RECORDER);
    await h.wait(1500);
    // input → response: alternate swipes, 0.7 s apart
    for (let i = 0; i < 12; i++) {
      const lane = await a.evaluate(() => window.__rush.internals.players.a.r.lane);
      const dir = lane >= 1 ? -1 : lane <= -1 ? 1 : (i % 2 ? -1 : 1);
      await swipe(a, 195, 560, 90 * dir, 0);
      await h.wait(700);
    }
    // steady running on the autopilot (lane changes, jumps, rolls: the camera's everyday work)
    await a.evaluate(() => { window.__rec.f.length = 0; window.__rush.auto('a', true); });
    await h.wait(SECS * 1000);
    const rec = await a.evaluate(() => { window.__rec.on = false; return { f: window.__rec.f, lat: window.__rec.lat }; });
    const tex = await a.evaluate(TEXMEM);
    const perf = await a.evaluate(() => window.__rush.perf());
    const m = analyse(rec.f);
    const lat = rec.lat;
    out = {
      cpu: CPU, secs: SECS, ...m,
      input: { swipes: lat.length, toRunnerMs: stats(lat.map((x) => x.vis)), toRunnerFrames: stats(lat.map((x) => x.visF)), toCameraMs: stats(lat.map((x) => x.cam)), laneChangeMs: stats(lat.map((x) => x.laneMs)) },
      texture: tex, gamePerf: { p50: perf.p50, p95: perf.p95, work50: perf.work50, work95: perf.work95, scale: perf.scale, scaleDowns: perf.scaleDowns, programs: perf.programs },
    };
    console.log(JSON.stringify(out, null, 1));
    if (process.env.FEEL_OUT) fs.writeFileSync(process.env.FEEL_OUT, JSON.stringify(out, null, 1));
    assert(lat.length >= 10, `${lat.length} of 12 swipes measured`);
    assert(out.input.toRunnerFrames.p95 <= 3, `swipes show on the runner within 3 frames (p95 ${out.input.toRunnerFrames.p95})`);
    assert(m.calls.max <= 30 && m.tris.max <= 60000, `phone budget: ${m.calls.max} calls, ${m.tris.max} triangles max`);
    assert(tex.bytes <= 8 * 1024 * 1024, `texture memory ${(tex.bytes / 1048576).toFixed(2)} MB (≤ 8 MB)`);
    h.assertNoErrors();
    for (const c of cdps) await c.detach().catch(() => {});
  } finally { await h.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
