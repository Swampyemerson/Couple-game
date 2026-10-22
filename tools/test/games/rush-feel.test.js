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
//
// Part 2 (software GL here draws a frame in ~120 ms, so real frame pacing can't be measured live):
// the synthetic vsync bench `__rush.pace(opts)` (game.js, maths in bench.js). One computer, split screen,
// CPU throttled; it drives frame() with synthetic vsync timestamps at 60 / 120 / 30 Hz with callback delay
// (jitter 3 ms + occasional spikes), 2 % missed vsyncs and a lane change at a random sub-frame time every
// 0.9 s, once with the previous clock and camera (`__RUSH_DEBUG.oldPacing` / `oldCam`) and once with the
// current ones, and prints a before / after table: judder RMS (the drawn runner's per-frame advance vs
// speed × interval, in frames of advance), camera lateral jerk, input → first visible move latency, lane
// change time, camera settle / overshoot. Asserts the new numbers are better (judder under half, jerk
// below the old one), latency p95 ≤ 2 periods + 9 ms, no camera teleports and no overshoot. Also feeds
// the dynamic-resolution judge Low Power Mode (30 Hz), 60 and 120 Hz cadences.
// The live part also records a window per clock (new, then old) so the partner's runner can be compared.
//   node tools/test/games/rush-feel.test.js         (CPU=1 for an unthrottled run, SECS=20 run length,
//                                                    PART=bench | live to run one part)
const fs = require('fs');
const { launch } = require('../harness');

const CPU = +(process.env.CPU || 4);
const SECS = +(process.env.SECS || 20);
const PORT = +(process.env.RUSH_PORT || 8975);
const PART = process.env.PART || 'all';
const SCALE = +(process.env.SCALE || 0);
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
  const R = window.__rec = { f: [], lat: [], lastMove: 0, lastLane: pa.r.lane, pend: null, on: true, px: pa.rs.x, pcx: pa.rig.cam.position.x };
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
      R.pend = { t0: R.lastMove, x0: R.px, cx0: R.pcx, // (the previous frame's x: with slow frames the whole lane change can be in the first frame)
       dir: Math.sign(r.lane - R.lastLane), target: r.lane * 2.6, ts0: ts, frames: 0, vis: null, visF: null, cam: null, done: null };
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
    R.px = s.x; R.pcx = c.x;
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

// ── part 2: the synthetic vsync bench ──
const f1 = (x) => (Math.round(x * 10) / 10).toString();
async function benchPart() {
  const h = await launch({ port: PORT + 1, only: ['rush'], device: 'Desktop Chrome', who: ['a'], fine: true });
  const { a } = h;
  try {
    await a.setViewportSize({ width: 1280, height: 800 });
    await a.evaluate(() => { window.__RUSH_DEBUG = { raceLen: 30000, noTutorial: true }; });
    await h.startLive(a, 'rush', 'local');
    await until(a, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().phase === 'lobby', null, 40000, 'split lobby');
    const cdp = await a.context().newCDPSession(a);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    await a.click('.g-rush .rr-mode[data-mode="race"]');
    await a.click('.g-rush .rr-ov-lobby [data-r="go"]');
    await until(a, () => window.__rush.state().phase === 'run' && window.__rush.state().steps > 30, null, 30000, 'split running');
    const rows = {};
    for (const hz of [60, 120, 30]) {
      for (const old of [true, false]) {
        const o = { hz, n: hz * 12, lanes: Math.round(hz * 0.9), jitterMs: 3, drops: 0.02, old, seed: 7 };
        rows[`${hz}-${old ? 'old' : 'new'}`] = await a.evaluate((o) => window.__rush.pace(o), o);
      }
    }
    // the table
    const cols = ['Hz', 'clock+cam', 'frame sd ms', 'judder RMS', 'judder p95', 'cam jerk RMS', 'cam jerk max', 'cam tele', 'latency mean', 'latency p95', 'lane ms', 'cam settle ms', 'cam over m'];
    const line = (c) => c.map((x, i) => String(x).padEnd(i === 1 ? 11 : 14)).join('');
    console.log('\n' + line(cols));
    for (const hz of [60, 120, 30]) {
      for (const k of ['old', 'new']) {
        const r = rows[`${hz}-${k}`];
        console.log(line([hz, k, r.frameMs.sd, r.judderRms, r.judderP95, r.camJerkRms, r.camJerkMax, r.camTeleports, f1(r.latencyMs.mean), f1(r.latencyMs.p95), f1(r.laneMs.mean), f1(r.camSettleMs.mean), r.camOvershootM.max]));
      }
    }
    console.log(`(partner runner judder in split screen is a local runner: ${[60, 120, 30].map((hz) => `${hz} Hz ${rows[hz + '-old'].partnerJudderRms} → ${rows[hz + '-new'].partnerJudderRms}`).join(', ')}; JS ms per frame ${[60, 120, 30].map((hz) => rows[hz + '-new'].wallMsPerFrame).join(' / ')} at ${CPU}× throttle)`);
    // dynamic resolution on synthetic cadences
    const scen = [
      ['Low Power Mode, rAF capped at 30 Hz', { hz: 30, n: 30 * 14, drops: 0, jitterMs: 1 }],
      ['60 Hz, every vsync met', { hz: 60, n: 60 * 20, drops: 0, jitterMs: 1 }],
      ['120 Hz, every vsync met', { hz: 120, n: 120 * 20, drops: 0, jitterMs: 1 }],
      ['60 Hz, a third of the vsyncs missed', { hz: 60, n: 60 * 10, drops: 0.35, jitterMs: 1 }],
    ];
    const res = {};
    for (const [name, o] of scen) {
      for (const old of [true, false]) res[`${name}|${old ? 'old' : 'new'}`] = (await a.evaluate((o) => window.__rush.pace(o), { ...o, track: true, old })).res;
    }
    console.log('\ndynamic resolution (start 0.85):');
    for (const [name] of scen) {
      const o = res[`${name}|old`]; const n = res[`${name}|new`];
      console.log(`  ${name.padEnd(40)} old: scale ${o.scale} (${o.scaleDowns} down, ${o.scaleUps} up)   new: scale ${n.scale} (${n.scaleDowns} down, ${n.scaleUps} up${n.capHolds ? ', refresh cap held' : ''})`);
    }
    console.log('');
    for (const hz of [60, 120, 30]) {
      const o = rows[`${hz}-old`]; const n = rows[`${hz}-new`]; const P = 1000 / hz;
      assert(n.period > P * 0.95 && n.period < P * 1.05, `${hz} Hz: display period detected (${n.period} ms)`);
      assert(n.judderRms < o.judderRms / 2, `${hz} Hz: drawn-runner judder RMS ${n.judderRms} < half of the old ${o.judderRms} (frames of advance)`);
      assert(n.camJerkRms < o.camJerkRms, `${hz} Hz: camera lateral jerk RMS ${n.camJerkRms} < the old ${o.camJerkRms} m/s³`);
      assert(n.camJerkMax < o.camJerkMax, `${hz} Hz: peak camera jerk ${n.camJerkMax} < the old ${o.camJerkMax}`);
      assert(n.inputs >= 10 && n.latencyMs.n >= n.inputs - 1, `${hz} Hz: ${n.latencyMs.n} of ${n.inputs} lane changes showed on the runner`);
      assert(n.latencyMs.p95 <= 2 * P + 9, `${hz} Hz: input → first visible move p95 ${f1(n.latencyMs.p95)} ms ≤ 2 periods + 9 ms (${f1(2 * P + 9)})`);
      assert(n.latencyMs.mean <= o.latencyMs.mean + 1, `${hz} Hz: latency no worse than before (${f1(n.latencyMs.mean)} vs ${f1(o.latencyMs.mean)} ms)`);
      assert(n.camTeleports === 0, `${hz} Hz: no camera teleports`);
      assert(n.camOvershootM.max < 0.02, `${hz} Hz: the camera doesn't overshoot (${n.camOvershootM.max} m)`);
      assert(n.camSettleMs.mean > 150 && n.camSettleMs.mean < 330, `${hz} Hz: camera settles in ${f1(n.camSettleMs.mean)} ms`);
      assert(n.laneMs.mean < 130 + 2 * P + 9, `${hz} Hz: lane change on screen in ${f1(n.laneMs.mean)} ms`);
    }
    const lpm = res[`${scen[0][0]}|new`]; const s60 = res[`${scen[1][0]}|new`]; const s120 = res[`${scen[2][0]}|new`]; const bad = res[`${scen[3][0]}|new`];
    assert(lpm.scale >= 0.8 && lpm.capHolds === 1, `Low Power Mode: kept at ${lpm.scale} (refresh cap recognised), the old judge went to ${res[`${scen[0][0]}|old`].scale}`);
    assert(s60.scale >= 0.85 && s60.scaleDowns === 0, `60 Hz meeting every vsync never steps down (${s60.scale})`);
    assert(s120.scale >= 0.85 && s120.scaleDowns === 0, `120 Hz meeting every vsync never steps down (${s120.scale})`);
    assert(bad.scaleDowns >= 2 && bad.scale < 0.8, `a third of the vsyncs missed steps the resolution down (${bad.scale})`);
    h.assertNoErrors();
    await cdp.detach().catch(() => {});
    return rows;
  } finally { await h.close(); }
}

(async () => {
  if (PART === 'all' || PART === 'bench') await benchPart();
  if (PART === 'bench') return;
  const h = await launch({ port: PORT, only: ['rush'], latency: 80, coarse: true });
  const { a, b } = h;
  let out = null;
  try {
    // (SCALE: a small render scale with fixedScale makes software GL fast enough (~60 ms or less a frame) for rAF pacing to mean something
    // on the partner comparison; the default is the game's own 0.85 and its dynamic resolution)
    for (const pg of [a, b]) await pg.evaluate((sc) => { window.__RUSH_DEBUG = { raceLen: 30000, noTutorial: true, ...(sc ? { scale0: sc, fixedScale: true } : {}) }; }, SCALE);
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
    // steady running on the autopilot (lane changes, jumps, rolls: the camera's everyday work): a window on
    // the current clock and camera, then one on the previous (__RUSH_DEBUG.oldPacing / oldCam, both phones:
    // the partner's picture depends on how the other phone stamps its stream)
    const setOld = (on) => Promise.all([a, b].map((pg) => pg.evaluate((o) => { window.__RUSH_DEBUG.oldPacing = o; window.__RUSH_DEBUG.oldCam = o; }, on)));
    await a.evaluate(() => { window.__rec.f.length = 0; window.__rush.auto('a', true); });
    await h.wait(SECS * 500);
    const recNew = await a.evaluate(() => { const f = window.__rec.f.slice(); window.__rec.f.length = 0; return f; });
    await setOld(true);
    await h.wait(1500); // (the partner's old-clock stream takes a moment to reach this phone)
    await a.evaluate(() => { window.__rec.f.length = 0; });
    await h.wait(SECS * 500);
    const recOld = await a.evaluate(() => { const f = window.__rec.f.slice(); window.__rec.f.length = 0; return f; });
    await setOld(false);
    await h.wait(1500);
    await a.evaluate(() => { window.__rec.f.length = 0; });
    await h.wait(SECS * 500);
    const rec = await a.evaluate(() => { window.__rec.on = false; return { f: window.__rec.f, lat: window.__rec.lat }; });
    const tex = await a.evaluate(TEXMEM);
    const perf = await a.evaluate(() => window.__rush.perf());
    const m = analyse(rec.f);
    const mNew = analyse(recNew); const mOld = analyse(recOld);
    const lat = rec.lat;
    const pick = (x) => ({ frames: x.frames, frameMs: x.frameMs.mean, judderRms: x.judderRms, partnerJudderRms: x.partnerJudderRms, partnerJudderP95: x.partnerJudderP95, camJerkRms: x.camJerkRms, camTeleports: x.camTeleports });
    out = {
      cpu: CPU, secs: SECS, ...m,
      input: { swipes: lat.length, toRunnerMs: stats(lat.map((x) => x.vis)), toRunnerFrames: stats(lat.map((x) => x.visF)), toCameraMs: stats(lat.map((x) => x.cam)), laneChangeMs: stats(lat.map((x) => x.laneMs)) },
      texture: tex, gamePerf: { p50: perf.p50, p95: perf.p95, work50: perf.work50, work95: perf.work95, scale: perf.scale, scaleDowns: perf.scaleDowns, programs: perf.programs },
      clockWindows: { current: pick(mNew), previous: pick(mOld) },
    };
    console.log(JSON.stringify(out, null, 1));
    console.log(`live (real network, frames of ${m.frameMs.mean} ms here): partner runner judder RMS ${mOld.partnerJudderRms} (previous clock, p95 ${mOld.partnerJudderP95}) → ${mNew.partnerJudderRms} (current, p95 ${mNew.partnerJudderP95}); own runner ${mOld.judderRms} → ${mNew.judderRms}`);
    if (process.env.FEEL_OUT) fs.writeFileSync(process.env.FEEL_OUT, JSON.stringify(out, null, 1));
    assert(lat.length >= 10, `${lat.length} of 12 swipes measured`);
    assert(out.input.toRunnerFrames && out.input.toRunnerFrames.p95 <= 3, `swipes show on the runner within 3 frames (p95 ${out.input.toRunnerFrames && out.input.toRunnerFrames.p95})`);
    assert(m.calls.max <= 30 && m.tris.max <= 60000, `phone budget: ${m.calls.max} calls, ${m.tris.max} triangles max`);
    assert(tex.bytes <= 8 * 1024 * 1024, `texture memory ${(tex.bytes / 1048576).toFixed(2)} MB (≤ 8 MB)`);
    assert(mNew.camTeleports <= mOld.camTeleports, `no more camera teleports on the current camera (${mNew.camTeleports} vs ${mOld.camTeleports})`);
    // short windows of the bench on this phone page (the shared clock mapped through link.at; the partner's runner isn't judged here:
    // its stream is real-time and the bench's frames are synthetic). Last, since it moves this runner on by its synthetic seconds.
    await a.evaluate(() => { window.__rush.ghost('a', 200); });
    for (const old of [true, false]) {
      const r = await a.evaluate((old) => window.__rush.pace({ hz: 60, n: 60, warm: 8, lanes: 25, jitterMs: 3, drops: 0.02, old, seed: 3 }), old);
      console.log(`live phone bench, 60 frames, ${old ? 'previous' : 'current'} clock + camera: judder RMS ${r.judderRms}, cam jerk RMS ${r.camJerkRms}, teleports ${r.camTeleports}, latency ${r.latencyMs.mean} ms`);
      if (!old) { assert(r.camTeleports === 0 && r.judderRms < 0.05, `live phone: paced frames are smooth (judder ${r.judderRms}, teleports ${r.camTeleports})`); }
    }
    await h.wait(1500);
    assert((await a.evaluate(() => window.__rush.state().phase)) === 'run', 'the live match carries on after the bench');
    h.assertNoErrors();
    for (const c of cdps) await c.detach().catch(() => {});
  } finally { await h.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
