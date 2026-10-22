// Getaway — "feel" and render-cost measurement harness (not a pass/fail gameplay test).
//   node tools/test/games/getaway-feel.test.js
// Env: PORT (default 9400; the live scenario uses PORT+1), OUT (also write the JSON there),
//      THROTTLE (CDP CPU throttle, default 4), SECS (chase seconds recorded per scenario, default 10),
//      REPS (latency repetitions, default 5), ONLY=practice|cost|live (scenarios, comma list), MAXDPR (default 0.6; 0 = the
//      game's own tier dpr with dynamic resolution on), DARK=1 (dark colour scheme), MINF (frames to record at least, default 40: a chase runs on until then), DUMP=prefix (write the raw frame rows).
//
// Everything is measured on an iPhone 13 profile (coarse pointer, landscape; VIEW=844x390 for the full size) under a CPU throttle,
// on Dockside, from a page-side recorder that hooks what the player sees:
//   * window.requestAnimationFrame is wrapped so the rAF timestamp of the frame being drawn is known;
//   * renderer.render is wrapped: after each draw of world.scene it samples the camera that was drawn
//     with, the THREE group of my car and of the partner's car (carViews groups, i.e. the drawn pose, not
//     the physics state: robust to code with or without render interpolation) and the sim state.
// The JSON printed at the end is one object { meta, practice, cost, live }.
const fs = require('fs');
const { launch } = require('../harness');

const PORT = Number(process.env.PORT) || 9400;
const THROTTLE = process.env.THROTTLE === undefined ? 4 : Number(process.env.THROTTLE);
const SECS = Number(process.env.SECS) || 10;
const REPS = Number(process.env.REPS) || 5;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const MAXDPR = process.env.MAXDPR === undefined ? 0.6 : Number(process.env.MAXDPR);
const VIEW = process.env.VIEW ? { width: Number(process.env.VIEW.split('x')[0]), height: Number(process.env.VIEW.split('x')[1]) } : { width: 568, height: 260 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FAST = { intro: 900, count: 1200, result: 1800, final: 900, resume: 1500, ...(MAXDPR ? { maxDpr: MAXDPR } : {}), rules: { wildcards: 'off', score: 'rounds' } };

// ── helpers (same shapes as getaway.test.js) ──
const st = (p) => p.evaluate(() => window.__getaway && window.__getaway.state());
const hook = (p, fn, ...args) => p.evaluate(([f, a]) => window.__getaway[f](...a), [fn, args]);
async function until(p, fn, arg, ms = 20000, what = 'condition') {
  try { await p.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); } catch {
    const s = await st(p).catch(() => null);
    throw new Error('timed out waiting for ' + what + ' ' + JSON.stringify(s && { phase: s.phase, paused: s.paused, R: s.R && { idx: s.R.idx, over: s.R.over, result: s.R.result }, a: s.a && { x: s.a.x, z: s.a.z, sp: s.a.speed }, b: s.b && { x: s.b.x, z: s.b.z, sp: s.b.speed } }));
  }
}
const phase = (p, ph, ms = 30000) => until(p, (x) => window.__getaway && window.__getaway.state().phase === x, ph, ms, 'phase ' + ph);
async function arm(p, tune = FAST) { await p.evaluate((t) => { window.__gtwTest = true; window.__gtwTune = t; try { localStorage.removeItem('getaway.setup.v1'); localStorage.removeItem('getaway.device.v1'); } catch { /* ignore */ } }, tune); }
const ready = (p) => until(p, () => window.__getaway && window.__getaway.ready, null, 240000, 'game ready');
async function throttle(p, rate) {
  if (!(rate > 1)) return;
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}
/** A chase in progress (a new round's chase if the last one ended). */
const chasing = (p, ms = 60000) => until(p, () => { const s = window.__getaway.internals.S; return s.phase === 'chase' && s.R && !s.R.over && !s.paused; }, null, ms, 'a running chase');

// ── page side ──
const NC = 22; // columns per recorded frame
/** Hooks the draw. Row layout: 0 rAF ts · 1 performance.now() after the draw · 2-4 camera xyz · 5 camera yaw ·
 *  6-8 my drawn car xyz · 9 my drawn car rotation.y · 10 my sim speed · 11 my sim yaw rate · 12-14 partner's drawn
 *  car xyz · 15 partner sim speed · 16 chase flag · 17 draw calls so far · 18 triangles so far · 19 my sim yaw · 20-21 my sim x, z. */
function pageInstall(NC) {
  const G = window.__getaway.internals; const R = G.renderer;
  if (window.__feel) { window.__feel.n = 0; window.__feel.marks.length = 0; window.__feel.on = false; return true; }
  const CAP = 12000;
  const F = window.__feel = { on: false, n: 0, cap: CAP, buf: new Float64Array(NC * CAP), marks: [], ts: 0, me: window.__getaway.state().me };
  const oraf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => oraf((t) => { F.ts = t; cb(t); });
  const orig = R.render;
  R.render = function feelRender(scene) {
    const ret = orig.apply(this, arguments);
    if (!F.on || F.n >= F.cap || !G.world || scene !== G.world.scene) return ret;
    const cam = arguments[1]; const S = G.S; const Rr = S.R; const me = F.me; const o = me === 'a' ? 'b' : 'a';
    const cv = G.carViews; const grp = (w) => (Rr && cv ? (Rr.runner === w ? (w === 'a' ? cv.runA : cv.runB) : cv.cop).group : null);
    const gm = grp(me); const go = grp(o); const c = G.P2[me].car; const co = G.P2[o].car;
    const q = cam.quaternion; const fx = -2 * (q.x * q.z + q.w * q.y); const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const b = F.buf; const i = F.n * NC;
    b[i] = F.ts; b[i + 1] = performance.now();
    b[i + 2] = cam.position.x; b[i + 3] = cam.position.y; b[i + 4] = cam.position.z; b[i + 5] = Math.atan2(fx, -fz);
    if (gm) { b[i + 6] = gm.position.x; b[i + 7] = gm.position.y; b[i + 8] = gm.position.z; b[i + 9] = gm.rotation.y; }
    b[i + 10] = c.speed; b[i + 11] = c.r || 0;
    if (go) { b[i + 12] = go.position.x; b[i + 13] = go.position.y; b[i + 14] = go.position.z; }
    b[i + 15] = co.speed;
    b[i + 16] = S.phase === 'chase' && Rr && !Rr.over && !S.paused ? 1 : 0;
    b[i + 17] = R.info.render.calls; b[i + 18] = R.info.render.triangles; b[i + 19] = c.yaw; b[i + 20] = c.x; b[i + 21] = c.z;
    F.n++;
    return ret;
  };
  return true;
}
const pageStart = () => { const F = window.__feel; F.n = 0; F.marks.length = 0; F.on = true; };
const pageStop = (NC) => { const F = window.__feel; F.on = false; return { n: F.n, rows: Array.from(F.buf.subarray(0, F.n * NC)), marks: F.marks.slice() }; };
/** pointer helpers: press an element (a pedal) / the steering surface, move the thumb, release. Marks the time. */
function pagePress([sel, id, mark]) {
  const F = window.__feel; const el = document.querySelector(sel); const b = el.getBoundingClientRect();
  const x = b.left + b.width / 2; const y = b.top + b.height / 2;
  if (mark) F.marks.push({ name: mark, t0: performance.now() });
  el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
}
function pageSteerDown([id, x]) {
  const sf = document.querySelector('.g-gtw .gtw-surface'); const r = sf.getBoundingClientRect();
  sf.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + r.height * 0.8, bubbles: true, cancelable: true }));
}
function pageSteerMove([id, x, mark]) {
  const F = window.__feel; const sf = document.querySelector('.g-gtw .gtw-surface'); const r = sf.getBoundingClientRect();
  if (mark) F.marks.push({ name: mark, t0: performance.now() });
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + r.height * 0.8, bubbles: true, cancelable: true }));
}
const pageRelease = (id) => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: id, pointerType: 'touch', bubbles: true }));
/** Texture memory: every THREE.Texture reachable from the scenes' materials (maps and shader uniforms), plus the shadow render target. */
function pageTextures() {
  const G = window.__getaway.internals; const T = window.THREE; const W = G.world; const R = G.renderer;
  const seen = new Map();
  const visit = (v) => { if (!v) return; if (Array.isArray(v)) { v.forEach(visit); return; } if (v.isTexture) seen.set(v.uuid, v); };
  const scan = (scene) => scene && scene.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) { if (!m) continue; for (const k in m) { const v = m[k]; if (v && (v.isTexture || Array.isArray(v))) visit(v); } if (m.uniforms) for (const k in m.uniforms) visit(m.uniforms[k] && m.uniforms[k].value); }
  });
  scan(W.scene); scan(W.farScene);
  const chan = (f) => (f === T.RGBAFormat ? 4 : f === T.RGBFormat ? 3 : f === T.RGFormat || f === T.LuminanceAlphaFormat ? 2 : f === T.DepthFormat ? 4 : 1);
  const list = []; let bytes = 0; const sh = W.shadow && W.shadow.rt;
  for (const t of seen.values()) {
    if (sh && t === sh.texture) continue; // counted below, with its depth buffer
    const im = t.image; const w = im && (im.width || im.videoWidth) || 0; const h = im && (im.height || im.videoHeight) || 0;
    const bpt = chan(t.format) * (t.type === T.FloatType ? 4 : t.type === T.HalfFloatType ? 2 : 1);
    const mip = t.generateMipmaps && t.minFilter !== T.NearestFilter && t.minFilter !== T.LinearFilter ? 4 / 3 : 1;
    const b = w * h * bpt * mip; bytes += b; list.push({ name: t.name || t.constructor.name, w, h, mb: +(b / 1048576).toFixed(3) });
  }
  let shadowMB = 0; if (sh) { shadowMB = (sh.width * sh.height * 8) / 1048576; bytes += shadowMB * 1048576; }
  const ds = R.getDrawingBufferSize(new T.Vector2()); const ss = R.capabilities.isWebGL2 ? 4 : 1; // MSAA 4x colour + depth, plus the resolve
  const drawMB = (ds.x * ds.y * (4 * ss * 2 + 4)) / 1048576;
  list.sort((a, b) => b.mb - a.mb);
  return { glTextures: R.info.memory.textures, glGeometries: R.info.memory.geometries, found: seen.size, estTexMB: +(bytes / 1048576).toFixed(3), shadowRtMB: +shadowMB.toFixed(3), shadowSize: sh ? sh.width : 0, drawingBuffer: [ds.x, ds.y], drawingBufferMB_est: +drawMB.toFixed(2), top: list.slice(0, 6) };
}

// ── analysis (node side) ──
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
function quant(sorted, k) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * k))] : NaN; }
function summary(a) {
  const s = a.slice().sort((x, y) => x - y); const n = s.length; const mean = n ? s.reduce((p, c) => p + c, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(s.reduce((p, c) => p + (c - mean) * (c - mean), 0) / (n - 1)) : NaN;
  return { n, mean, median: quant(s, 0.5), p95: quant(s, 0.95), max: s[n - 1], sd };
}
const r3 = (x) => (fin(x) ? Math.round(x * 1000) / 1000 : x);
function rnd(o) { if (Array.isArray(o)) return o.map(rnd); if (o && typeof o === 'object') { const q = {}; for (const k in o) q[k] = rnd(o[k]); return q; } return typeof o === 'number' ? r3(o) : o; }
const HITCH = 2; // s: a frame longer than this is a freeze, not a rate (its pair is skipped)
const SIMCAP = 0.125; // s: the game simulates at most this much per frame (longer frames lose sim time, so the car moves for 125 ms only)
/** Rows as objects. */
function unpack(flat) {
  const rows = []; const un = (a, b) => b; void un;
  let yawPrev = null; let camYaw = 0;
  for (let i = 0; i < flat.length; i += NC) {
    const r = flat.slice(i, i + NC);
    // unwrap the camera yaw
    if (yawPrev === null) camYaw = r[5]; else { let d = r[5] - yawPrev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; camYaw += d; }
    yawPrev = r[5];
    rows.push({ ts: r[0] / 1000, t: r[1], cam: [r[2], r[3], r[4]], camYaw, car: [r[6], r[7], r[8]], carRot: r[9], speed: r[10], rate: r[11], oth: [r[12], r[13], r[14]], oSpeed: r[15], chase: r[16] === 1, calls: r[17], tris: r[18], yaw: r[19], sim: [r[20], 0, r[21]] });
  }
  return rows;
}
const dist = (a, b, xz) => Math.hypot(a[0] - b[0], xz ? 0 : a[1] - b[1], a[2] - b[2]);
/** Consecutive chase frames with a usable frame time. */
function pairs(rows) { const out = []; for (let i = 1; i < rows.length; i++) { const dt = rows[i].ts - rows[i - 1].ts; if (rows[i].chase && rows[i - 1].chase && dt > 0.002 && dt <= HITCH) out.push([rows[i - 1], rows[i], dt]); } return out; }
/** 1. frame-time jitter (all consecutive chase frames; hitches included). */
function jitter(rows) {
  const d = []; for (let i = 1; i < rows.length; i++) if (rows[i].chase && rows[i - 1].chase && rows[i].ts > rows[i - 1].ts) d.push((rows[i].ts - rows[i - 1].ts) * 1000);
  const s = summary(d); const dev = d.filter((x) => Math.abs(x - s.median) > 0.25 * s.median).length / (d.length || 1);
  return { frames: d.length, medianMs: s.median, p95Ms: s.p95, maxMs: s.max, stdevMs: s.sd, fpsMedian: 1000 / s.median, devOver25pct: dev, over50ms: d.filter((x) => x > 50).length / (d.length || 1), over125ms: d.filter((x) => x > 125).length / (d.length || 1) };
}
/** 2. apparent speed of a drawn car vs its sim speed, frames above 10 m/s. The time a frame covers is its rAF delta,
 *  capped at `cap` (125 ms for my own car, like the game's own simulation, so a slow software-GL frame is judged on what the
 *  sim advanced; the partner's car follows the wall clock, so there the cap is only the 2 s freeze limit).
 *  timeErr: displacement / sim speed minus that time, in ms: the time-quantisation of the drawn pose (a car drawn at
 *  the last fixed 120 Hz step is off by up to one 8.3 ms step, whatever the frame rate). */
function stutter(rows, key, speedKey, cap = SIMCAP) {
  const app = []; const ratio = []; const terr = [];
  for (const [p, q, dt0] of pairs(rows)) {
    const dt = Math.min(dt0, cap);
    const sp = (p[speedKey] + q[speedKey]) / 2; if (p[speedKey] <= 10 || q[speedKey] <= 10) continue;
    const d = dist(q[key], p[key], true); const a = d / dt; app.push(a); ratio.push(a / sp); terr.push((d / sp - dt) * 1000);
  }
  const sr = summary(ratio); const sa = summary(app); const se = summary(terr); const ae = summary(terr.map(Math.abs));
  return { frames: ratio.length, cvRatio: sr.sd / sr.mean, meanRatio: sr.mean, cvApparent: sa.sd / sa.mean, p95Ratio: sr.p95, p05Ratio: quant(ratio.slice().sort((x, y) => x - y), 0.05), timeErrStdMs: se.sd, timeErrMeanMs: se.mean, timeErrAbsP95Ms: ae.p95 };
}
/** How far the drawn pose of my car runs behind the sim state at the moment of drawing, in ms along its heading
 *  (positive = the picture is older than the physics; 0 = drawn at the last step, a 1-step interpolation: about +4 ms). */
function drawLag(rows) {
  const l = [];
  for (const r of rows) { if (!r.chase || r.speed <= 10) continue; const vx = Math.sin(r.yaw); const vz = -Math.cos(r.yaw); l.push((((r.sim[0] - r.car[0]) * vx + (r.sim[2] - r.car[2]) * vz) / r.speed) * 1000); }
  const s = summary(l); const a = summary(l.map(Math.abs));
  return { frames: l.length, meanMs: s.mean, medianMs: s.median, absP95Ms: a.p95 };
}
/** third finite difference (jerk) of a vector track with real timestamps, over runs of usable frames. */
function jerks(rows, get, dim) {
  const out = []; let run = [];
  const flush = () => {
    if (run.length >= 4) {
      const t = run.map((r) => r.ts); const p = run.map(get);
      const diff = (vals, times) => { const v = []; const tt = []; for (let k = 1; k < vals.length; k++) { const dt = times[k] - times[k - 1]; v.push(vals[k].map((x, j) => (x - vals[k - 1][j]) / dt)); tt.push((times[k] + times[k - 1]) / 2); } return [v, tt]; };
      const [v, tv] = diff(p, t); const [a, ta] = diff(v, tv); const [j] = diff(a, ta);
      for (const x of j) out.push(Math.hypot(...x.slice(0, dim)));
    }
    run = [];
  };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const prev = run[run.length - 1];
    if (!r.chase) { flush(); continue; }
    if (prev && (r.ts - prev.ts <= 0.002 || r.ts - prev.ts > HITCH)) flush();
    run.push(r);
  }
  flush(); return out;
}
/** 3. camera jerk and teleport events. */
function camera(rows) {
  const j = summary(jerks(rows, (r) => r.cam, 3)); const jy = summary(jerks(rows, (r) => [r.camYaw], 1)); const jc = summary(jerks(rows, (r) => r.car, 3));
  let tele = 0; let n = 0;
  for (let i = 1; i < rows.length; i++) { if (!rows[i].chase || !rows[i - 1].chase) continue; n++; const cm = dist(rows[i].cam, rows[i - 1].cam); const km = dist(rows[i].car, rows[i - 1].car); if (cm > 3 * km + 0.5) tele++; }
  return { frames: n, jerkMedian: j.median, jerkP95: j.p95, yawJerkMedian: jy.median, yawJerkP95: jy.p95, carJerkMedian: jc.median, carJerkP95: jc.p95, teleportEvents: tele };
}
/** 4. input -> first frame where something moved (performance.now() at the input vs at the end of the drawing of that frame). */
function firstAfter(rows, t0, test) { for (const r of rows) if (r.t >= t0 && test(r)) return r.t - t0; return null; }
function latencyOf(rows, mark, kind) {
  const before = rows.filter((r) => r.t < mark.t0).pop(); if (!before) return null; const lim = mark.t0 + 1500;
  const rr = rows.filter((r) => r.t <= lim);
  if (kind === 'gas') {
    return {
      sim: firstAfter(rr, mark.t0, (r) => r.speed > before.speed + 0.25),
      car: firstAfter(rr, mark.t0, (r) => dist(r.car, before.car) > 0.03),
      cam: firstAfter(rr, mark.t0, (r) => dist(r.cam, before.cam) > 0.03),
    };
  }
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  return {
    sim: firstAfter(rr, mark.t0, (r) => Math.abs(r.rate - before.rate) > 0.05),
    car: firstAfter(rr, mark.t0, (r) => Math.abs(wrap(r.carRot - before.carRot)) > 0.01),
    cam: firstAfter(rr, mark.t0, (r) => Math.abs(r.camYaw - before.camYaw) > 0.005),
  };
}
const med = (a) => { const v = a.filter(fin).sort((x, y) => x - y); return v.length ? quant(v, 0.5) : null; };

/** Records for SECS seconds of chase, and on until MINF frames are in (software GL on a loaded box draws 2-5 fps), at most 2.5 x SECS. */
const MINF = Number(process.env.MINF) || 40;
async function recordChase(p, seconds = SECS, minf = MINF) {
  await p.evaluate(pageStart);
  const t0 = Date.now();
  for (;;) {
    await wait(250);
    const r = await p.evaluate(() => { const s = window.__getaway.internals.S; return { live: !!(s.phase === 'chase' && s.R && !s.R.over), n: window.__feel.n }; });
    const el = (Date.now() - t0) / 1000;
    if (!r.live || el >= seconds * 2.5 || (el >= seconds && r.n >= minf)) break;
  }
}
// ── scenario: practice vs AI ──
async function practice() {
  const out = {};
  const h = await launch({ port: PORT, only: ['getaway'], who: ['a'], coarse: true, colorScheme: process.env.DARK === '1' ? 'dark' : 'light' });
  const a = h.a;
  try {
    await a.setViewportSize(VIEW);
    await arm(a, { ...FAST, rounds: 4, intro: 1500 });
    await h.startLive(a, 'getaway', 'local');
    await ready(a);
    await throttle(a, THROTTLE); // (after the map build: the load itself is not what is measured)
    await a.tap('.g-gtw [data-l="start"]');
    await phase(a, 'chase', 60000);
    out.map = (await st(a)).mapId;
    await a.evaluate(pageInstall, NC);
    await until(a, () => window.__getaway.navReady(), null, 60000, 'nav grid');

    // 1-3 + 5: an actual chase, my runner driven by the game's bot
    await chasing(a);
    await hook(a, 'auto', 'a', true);
    await until(a, () => window.__getaway.internals.P2.a.car.speed > 12, null, 30000, 'the bot up to speed').catch(() => {});
    await hook(a, 'resetPerf');
    await recordChase(a);
    const rec = await a.evaluate(pageStop, NC);
    const rows = unpack(rec.rows);
    if (process.env.DUMP) fs.writeFileSync(process.env.DUMP + '.practice.json', JSON.stringify(rows));
    const chaseRows = rows.filter((r) => r.chase);
    const pf = await hook(a, 'perf');
    const sc = chaseRows.map((r) => r.calls).sort((x, y) => x - y); const st2 = chaseRows.map((r) => r.tris).sort((x, y) => x - y);
    out.chaseSeconds = chaseRows.length ? chaseRows[chaseRows.length - 1].ts - chaseRows[0].ts : 0;
    out.frameJitter = jitter(rows);
    out.carStutter = stutter(rows, 'car', 'speed');
    out.drawLag = drawLag(rows);
    out.camera = camera(rows);
    out.render = {
      callsMedian: quant(sc, 0.5), callsP95: quant(sc, 0.95), callsMax: sc[sc.length - 1], trisMedian: quant(st2, 0.5), trisP95: quant(st2, 0.95), trisMax: st2[st2.length - 1],
      perf: { calls: pf.calls, tris: pf.tris, maxCalls: pf.maxCalls, maxTris: pf.maxTris, p50: pf.p50, p95: pf.p95, work50: pf.work50, work95: pf.work95, level: pf.level, scale: pf.scale, resizes: pf.resizes, shadow: pf.shadow, programs: pf.programs, textures: pf.textures, geoms: pf.geoms },
      memory: await a.evaluate(pageTextures),
    };

    // 4: input -> response, by real pointer events on the pedals / steering surface
    await hook(a, 'auto', 'a', false);
    const reset = async () => {
      await chasing(a);
      await a.evaluate(() => { const g = window.__getaway; g.hold('a', { hand: true }); g.hold('b', { hand: true }); g.teleport('a', -330, 40, Math.PI / 2, 0); g.teleport('b', -420, 40, Math.PI / 2, 0); });
      await wait(500); await hook(a, 'hold', 'a', null); await wait(450);
    };
    await a.evaluate(pageStart);
    for (let k = 0; k < REPS; k++) {
      await reset();
      await a.evaluate(pagePress, ['.g-gtw [data-pad="gas"]', 31, 'gas' + k]);
      await wait(1200);
      await a.evaluate(pageRelease, 31); await hook(a, 'hold', 'a', { hand: true }); await wait(250);
    }
    for (let k = 0; k < REPS; k++) {
      await reset();
      await a.evaluate(pagePress, ['.g-gtw [data-pad="gas"]', 31, '']);
      await until(a, () => window.__getaway.internals.P2.a.car.speed > 13, null, 8000, 'speed for the steering test').catch(() => {});
      await a.evaluate(pageSteerDown, [32, 120]); await wait(200);
      await a.evaluate(pageSteerMove, [32, 170, 'steer' + k]);
      await wait(800);
      await a.evaluate(pageRelease, 32); await a.evaluate(pageRelease, 31); await hook(a, 'hold', 'a', { hand: true }); await wait(250);
    }
    const lat = await a.evaluate(pageStop, NC); const lrows = unpack(lat.rows);
    if (process.env.DUMP) fs.writeFileSync(process.env.DUMP + '.latency.json', JSON.stringify({ rows: lrows, marks: lat.marks }));
    const runs = { gas: [], steer: [] };
    for (const m of lat.marks) { const kind = m.name.startsWith('gas') ? 'gas' : 'steer'; const l = latencyOf(lrows, m, kind); if (l) runs[kind].push(l); }
    const sum = (arr) => ({ n: arr.length, simMs: med(arr.map((x) => x.sim)), carMs: med(arr.map((x) => x.car)), camMs: med(arr.map((x) => x.cam)), runs: arr });
    out.latency = { gas: sum(runs.gas), steer: sum(runs.steer), note: 'ms from the pointer event to the end of the first drawn frame in which: sim speed +0.25 m/s / sim yaw rate +0.05 rad/s; drawn car moved 3 cm / yawed 0.01 rad; camera moved 3 cm / yawed 0.005 rad' };
    h.assertNoErrors();
  } finally { await h.close(); }
  return out;
}

// ── scenario: render cost on the phone tier (mid: shadow map, MSAA) ──
// (software GL picks the 'low' tier by itself, which has no shadow pass; a phone is 'mid')
async function cost() {
  const out = { tier: 'mid' };
  const h = await launch({ port: PORT + 2, only: ['getaway'], who: ['a'], coarse: true, colorScheme: process.env.DARK === '1' ? 'dark' : 'light' });
  const a = h.a;
  try {
    await a.setViewportSize(VIEW);
    await arm(a, { ...FAST, rounds: 4, intro: 1500, tier: 'mid' });
    await h.startLive(a, 'getaway', 'local');
    await ready(a);
    await a.tap('.g-gtw [data-l="start"]');
    await phase(a, 'chase', 60000);
    await a.evaluate(pageInstall, NC);
    await until(a, () => window.__getaway.navReady(), null, 60000, 'nav grid');
    await chasing(a);
    await hook(a, 'auto', 'a', true);
    await until(a, () => window.__getaway.internals.P2.a.car.speed > 12, null, 30000, 'the bot up to speed').catch(() => {});
    await hook(a, 'resetPerf');
    await recordChase(a, Math.min(SECS, 5), 5);
    const rows = unpack((await a.evaluate(pageStop, NC)).rows).filter((r) => r.chase);
    const pf = await hook(a, 'perf');
    const c = rows.map((r) => r.calls).sort((x, y) => x - y); const t = rows.map((r) => r.tris).sort((x, y) => x - y);
    out.frames = rows.length; out.tierSeen = await a.evaluate(() => window.__getaway.ui().tier);
    out.render = { callsMedian: quant(c, 0.5), callsP95: quant(c, 0.95), callsMax: c[c.length - 1], trisMedian: quant(t, 0.5), trisP95: quant(t, 0.95), trisMax: t[t.length - 1], perfMaxCalls: pf.maxCalls, perfMaxTris: pf.maxTris, shadow: pf.shadow, programs: pf.programs };
    out.memory = await a.evaluate(pageTextures);
    h.assertNoErrors();
  } finally { await h.close(); }
  return out;
}

// ── scenario: live, two phones at 80 ms ──
async function live() {
  const out = {};
  const h = await launch({ port: PORT + 1, only: ['getaway'], latency: 80, coarse: true, colorScheme: process.env.DARK === '1' ? 'dark' : 'light' });
  const { a, b } = h;
  try {
    for (const p of [a, b]) { await p.setViewportSize(VIEW); await arm(p, { ...FAST, rounds: 4, intro: 1500 }); }
    await h.startLive(a, 'getaway', 'live');
    await h.settle();
    const invited = await b.isVisible('#gm-invite').catch(() => false);
    if (invited) await b.click('#gm-invite [data-g="invite-yes"]'); else await h.startLive(b, 'getaway', 'live');
    await ready(a); await ready(b);
    await until(b, () => window.__getaway.state().linked, null, 60000, 'guest linked');
    await until(a, () => window.__getaway.state().linked, null, 60000, 'host linked');
    await throttle(b, THROTTLE); // (the guest is the phone that is measured; the host runs unthrottled and draws nothing)
    await hook(a, 'setRules', { heat: 260, tiebreak: 'time' });
    await until(b, () => window.__getaway.state().setup.rules.heat === 260, null, 15000, 'guest sees the rules');
    await until(a, () => { const p = window.__getaway.state().partnerSeen; return p && p.ph === 1 && p.sv >= 1; }, null, 60000, 'guest in the lobby with the map loaded');
    await a.tap('.g-gtw [data-l="start"]');
    await until(b, () => ['intro', 'count', 'chase', 'wait'].includes(window.__getaway.state().phase), null, 30000, 'guest starts');
    await phase(a, 'chase', 60000); await phase(b, 'chase', 60000);
    await b.evaluate(pageInstall, NC);
    await until(a, () => window.__getaway.navReady(), null, 60000, 'host nav grid'); await until(b, () => window.__getaway.navReady(), null, 60000, 'guest nav grid');
    await hook(a, 'drawHold', true); // (the host plays but draws nothing: two software-GL phones in one machine starve each other, and only the guest's picture is measured)
    await hook(a, 'auto', 'a', true); await hook(b, 'hold', 'b', { hand: true }); // (the host drives the runner; the guest's cop sits at the spawn)
    await until(b, () => window.__getaway.internals.P2.a.car.speed > 12, null, 40000, 'the partner up to speed').catch(() => {});
    await wait(1500);
    out.me = (await st(b)).me;
    await recordChase(b);
    const rec = await b.evaluate(pageStop, NC); const rows = unpack(rec.rows);
    if (process.env.DUMP) fs.writeFileSync(process.env.DUMP + '.live.json', JSON.stringify(rows));
    out.chaseSeconds = rows.filter((r) => r.chase).length ? rows.filter((r) => r.chase).slice(-1)[0].ts - rows.filter((r) => r.chase)[0].ts : 0;
    out.guestFrameJitter = jitter(rows);
    const remote = stutter(rows, 'oth', 'oSpeed', 2); // (the partner's car is placed by the wall clock, not by this phone's capped sim time)
    const pj = summary(jerks(rows, (r) => r.oth, 3));
    out.remoteCar = { ...remote, jerkMedian: pj.median, jerkP95: pj.p95 };
    out.remoteSimSpeedMean = summary(rows.filter((r) => r.chase).map((r) => r.oSpeed)).mean;
    const sa = await st(a); const sb = await st(b);
    out.remoteError = sa.R && sb.partnerSeen ? Math.hypot(sa.a.x - sb.partnerSeen.shown.x, sa.a.z - sb.partnerSeen.shown.z) : null;
    out.rtt = sb.rtt;
    await hook(a, 'auto', 'a', false); await hook(b, 'hold', 'b', null);
    h.assertNoErrors();
  } finally { await h.close(); }
  return out;
}

(async () => {
  const res = { meta: { device: 'iPhone 13', viewport: VIEW, coarse: true, throttle: THROTTLE, secs: SECS, reps: REPS, maxDpr: MAXDPR, scheme: process.env.DARK === '1' ? 'dark' : 'light', note: 'frame metrics use the rAF timestamps of drawn frames; apparent speed uses consecutive chase frames with sim speed > 10 m/s over min(rAF dt, 125 ms); frames over 2 s are skipped' } };
  let failed = null;
  try {
    if (want('practice')) res.practice = await practice();
    if (want('live')) res.live = await live();
    if (want('cost')) res.cost = await cost();
    // light pass/fail: every metric finite, enough frames
    const bad = [];
    const walk = (o, p) => { if (Array.isArray(o)) { if (!/runs$/.test(p)) o.forEach((x, i) => walk(x, p + '[' + i + ']')); return; } if (o && typeof o === 'object') { for (const k in o) walk(o[k], p ? p + '.' + k : k); return; } if (typeof o === 'number' && !Number.isFinite(o)) bad.push(p); };
    walk(res, '');
    const P = res.practice;
    if (P) {
      if (!(P.frameJitter.frames >= 20)) bad.push('practice.frameJitter.frames=' + P.frameJitter.frames);
      if (!(P.carStutter.frames >= 10)) bad.push('practice.carStutter.frames=' + P.carStutter.frames);
      for (const k of ['gas', 'steer']) for (const m of ['simMs', 'carMs', 'camMs']) if (!fin(P.latency[k][m])) bad.push(`practice.latency.${k}.${m}`);
    }
    if (res.cost && !(res.cost.memory.estTexMB > 0)) bad.push('cost.memory.estTexMB=' + res.cost.memory.estTexMB);
    if (res.live && !(res.live.remoteCar.frames >= 10)) bad.push('live.remoteCar.frames=' + res.live.remoteCar.frames);
    if (bad.length) throw new Error('metrics not usable: ' + bad.join(', '));
  } catch (e) { failed = e; res.error = String((e && e.stack) || e); }
  const json = JSON.stringify(rnd(res), null, 1);
  console.log(json);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, json);
  if (failed) { console.log('FAIL -', failed.message); process.exit(1); }
  console.log('all ok'); process.exit(0);
})();
