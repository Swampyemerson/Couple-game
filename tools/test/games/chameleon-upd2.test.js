// Blend & Seek (chameleon) — "update 2" before/after measurements. Not a pass/fail suite: every section
// prints `METRIC {json}` lines so two runs (base vs. changed tree) can be diffed. Depends only on the
// window.__cham hooks that exist at the base commit (no new hooks needed).
//
//   PORT=9100 ONLY=xfeel node tools/test/games/chameleon-upd2.test.js     (xfeel | xperf | xseek; default = all three)
//   env: FEEL_MAPS=living,house   xfeel maps (default living)
//        PERF_MAPS=all|living,house,...   xperf maps (default all)
//        SEEK_MAPS=living,garden,studio,candy   xseek maps (default those four)
//        CPU=4        CPU throttle rate for every section (CDP Emulation.setCPUThrottlingRate; default 4)
//        FEEL_CPU=4   xfeel's own throttle (default = CPU)
//
// All sections run on the 'iPhone 13' playwright device profile (390x664 @3x, touch), one device (hotseat),
// with window.__chamTune = { maxDpr: 0.6, fixedScale: true } so the software-GL canvas stays small and the
// dynamic resolution scaler cannot change the scale mid-run. Draw calls / triangles / textures do not depend on dpr.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { launch } = require('../harness');

const PORT = Number(process.env.PORT) || 9100; // uses PORT..PORT+2
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const CPU = Number(process.env.CPU) || 4;
const FEEL_CPU = Number(process.env.FEEL_CPU) || CPU;
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'chameleon-upd2-shots');
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const metric = (group, obj) => console.log('METRIC ' + JSON.stringify({ group, ...obj }));
const r2 = (x, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

const TUNE = { hide: 600000, seek: 600000, title: 700, recap: 2500, found: 2200, final: 3000, seekLead: 900, resume: 1500, maxDpr: 0.6, noTips: true, fixedScale: true };
const arm = (p, tune = TUNE) => p.evaluate((t) => { window.__chamTest = true; window.__chamTune = t; }, tune);
const hook = (p, fn, ...args) => p.evaluate(([f, a]) => window.__cham[f](...a), [fn, args]);
const st = (p) => p.evaluate(() => window.__cham.state());
const waitReady = (p) => p.waitForFunction(() => window.__cham && window.__cham.ready, null, { timeout: 60000 });
const waitPhase = (p, name, timeout = 40000) => p.waitForFunction((n) => window.__cham && window.__cham.state().phase.name === n, name, { timeout });
const waitMap = (p, id) => p.waitForFunction((m) => window.__cham.state().mapId === m, id, { timeout: 90000 });

async function throttle(page, rate) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  return cdp;
}

// ─────────────────────────────────────────────────────────────────────
// in-page instrumentation (installed by the test, no game hooks needed)
//  pre  (before the game mounts): WebGL texture-memory tracker (every texImage2D / texStorage2D / generateMipmap /
//       deleteTexture), requestAnimationFrame timing wrapper (JS ms spent inside each rAF callback, by function name).
//  post (once three.js is loaded): wraps THREE.WebGLRenderer.prototype.render to remember the renderer, scene and
//       camera, so the test can read renderer.info, walk the scene graph and project avatar vertices.
const INSTRUMENT_PRE = () => {
  if (window.__ins) return;
  const I = window.__ins = { tex: new Map(), renderer: null, scene: null, camera: null, js: { by: {} } };
  const raw = window.requestAnimationFrame.bind(window);
  I.rawRaf = raw;
  window.requestAnimationFrame = (cb) => raw(function wrapped(t) {
    const t0 = performance.now();
    try { return cb(t); } finally {
      const d = performance.now() - t0; const nm = cb.name || 'anon';
      const o = I.js.by[nm] || (I.js.by[nm] = { n: 0, sum: 0, max: 0, list: [] });
      o.n++; o.sum += d; if (d > o.max) o.max = d; if (o.list.length < 6000) o.list.push(d);
    }
  });
  // renderer / scene / camera capture. three r128 builds `render` inside the constructor (not on the prototype), so
  // wrap THREE.WebGLRenderer when the UMD bundle assigns it (the game loads three lazily from the CDN).
  let three;
  Object.defineProperty(window, 'THREE', {
    configurable: true, enumerable: true,
    get() { return three; },
    set(v) {
      three = v;
      if (!v || typeof v !== 'object') return;
      let real = v.WebGLRenderer; let wrapped = null;
      const mk = (F) => {
        const W = function (...args) { const r = new F(...args); const rr = r.render; r.render = function (sc, cam) { I.renderer = r; I.scene = sc; I.camera = cam; return rr.apply(this, arguments); }; return r; };
        W.prototype = F.prototype; return W;
      };
      if (real) wrapped = mk(real);
      Object.defineProperty(v, 'WebGLRenderer', { configurable: true, enumerable: true, get() { return wrapped || real; }, set(F) { real = F; wrapped = mk(F); } });
    },
  });
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    const P = C.prototype;
    const ct = P.createTexture; P.createTexture = function () { const t = ct.call(this); if (t) I.tex.set(t, { w: 0, h: 0, mip: false, faces: 0 }); return t; };
    const dt = P.deleteTexture; P.deleteTexture = function (t) { I.tex.delete(t); return dt.call(this, t); };
    const bt = P.bindTexture; P.bindTexture = function (target, t) { (this.__bt || (this.__bt = {}))[target] = t; return bt.call(this, target, t); };
    const info = (ctx, target) => I.tex.get((ctx.__bt || {})[target]);
    const ti = P.texImage2D;
    P.texImage2D = function (...a) {
      const inf = info(this, a[0]);
      if (inf && a[1] === 0) {
        let w; let h;
        if (a.length >= 9) { w = a[3]; h = a[4]; } else { const src = a[5]; w = src && (src.width || src.videoWidth) || 0; h = src && (src.height || src.videoHeight) || 0; }
        inf.w = w; inf.h = h; inf.faces = a[0] === 3553 ? 1 : Math.max(inf.faces, 0) + 1;
      }
      return ti.apply(this, a);
    };
    const ts = P.texStorage2D;
    if (ts) P.texStorage2D = function (target, levels, ifmt, w, h) { const inf = info(this, target); if (inf) { inf.w = w; inf.h = h; inf.faces = 1; inf.mip = levels > 1; } return ts.apply(this, arguments); };
    const gm = P.generateMipmap; P.generateMipmap = function (target) { const inf = info(this, target); if (inf) inf.mip = true; return gm.call(this, target); };
  }
};
const insReset = (p) => p.evaluate(() => { window.__ins.js.by = {}; });
/** JS time spent in rAF callbacks since the last reset: top 3 callbacks by total time. */
const insJs = (p) => p.evaluate(() => {
  const q = (arr, f) => { if (!arr.length) return 0; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; };
  const rows = Object.entries(window.__ins.js.by).map(([name, o]) => ({ name, n: o.n, meanMs: o.sum / o.n, p95Ms: q(o.list, 0.95), maxMs: o.max, sumMs: o.sum }));
  rows.sort((a, b) => b.sumMs - a.sumMs);
  return rows.slice(0, 3);
});
/** Texture memory: GL-tracked (all alive textures) and scene-referenced (what the drawn scene samples). */
const insTex = (p) => p.evaluate(() => {
  const I = window.__ins; const MB = 1 / (1024 * 1024);
  let live = 0; let liveMip = 0; let n = 0; const top = [];
  for (const t of I.tex.values()) {
    if (!t.w || !t.h) continue;
    const base = t.w * t.h * 4 * Math.max(1, t.faces);
    n++; live += base * 1.33; liveMip += base * (t.mip ? 4 / 3 : 1);
    top.push([t.w, t.h, t.mip ? 1 : 0]);
  }
  top.sort((a, b) => b[0] * b[1] - a[0] * a[1]);
  // scene-referenced
  const seen = new Set(); let sc = 0; let scMip = 0; const list = [];
  const add = (t) => {
    if (!t || !t.isTexture || seen.has(t)) return; seen.add(t);
    const im = t.image || {}; const w = im.width || 0; const h = im.height || 0;
    if (!w) return;
    const mip = t.generateMipmaps !== false && [1004, 1005, 1007, 1008].includes(t.minFilter);
    const base = w * h * 4; sc += base * 1.33; scMip += base * (mip ? 4 / 3 : 1); list.push([w, h, mip ? 1 : 0]);
  };
  const mat = (m) => { if (!m) return; for (const k of Object.keys(m)) { const v = m[k]; if (v && v.isTexture) add(v); } if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture) add(u.value); };
  const walk = (o) => { o.traverse((x) => { if (x.material) (Array.isArray(x.material) ? x.material : [x.material]).forEach(mat); }); };
  if (I.scene) walk(I.scene);
  if (I.camera) walk(I.camera);
  list.sort((a, b) => b[0] * b[1] - a[0] * a[1]);
  const mem = I.renderer ? I.renderer.info.memory : {};
  return { glTracked: { n, estMB: live * MB, mipMB: liveMip * MB, top: top.slice(0, 4) }, scene: { n: list.length, estMB: sc * MB, mipMB: scMip * MB, top: list.slice(0, 5) }, info: { textures: mem.textures, geometries: mem.geometries } };
});

/** One device (hotseat), booted into the lobby with the game hooks armed; CPU throttled. */
async function boot(port, { cpu = CPU, tune = TUNE, instrument = false } = {}) {
  const h = await launch({ port, only: ['chameleon'], who: ['a'], coarse: true });
  const a = h.a;
  const cdp = await throttle(a, cpu);
  if (instrument) await a.evaluate(INSTRUMENT_PRE);
  await arm(a, tune);
  const t0 = Date.now();
  await h.startLive(a, 'chameleon', 'local');
  await waitReady(a);
  const bootMs = Date.now() - t0;
  return { h, a, cdp, bootMs };
}

/** Lobby → curtain → hide phase on `map` (first: 'b' = the hider is the device's player). */
async function toHide(a, map, rules = {}) {
  await hook(a, 'setRules', { map, first: 'b', rules: { size: 'large', climb: true, ...rules } });
  await waitMap(a, map);
  await a.click('[data-act="start"]');
  await waitPhase(a, 'curtain');
  await a.click('[data-act="curtain"]');
  await waitPhase(a, 'hide');
  await wait(600);
}

// ─────────────────────────────────────────────────────────────────────
// real touch input: CDP Input.dispatchTouchEvent (→ real touch pointer events, as a finger would send)
const JOY = { x: 70, r: 50 };
class Stick {
  constructor(cdp, page) { this.cdp = cdp; this.page = page; this.down = false; this.id = 7; }
  async origin() { const v = await this.page.evaluate(() => { const r = document.querySelector('.chm-surface').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }); this.x0 = v[0] + JOY.x; this.y0 = v[1] + v[3] - 170; }
  async set(sx, sy) { // sx right, sy up (screen), each -1..1
    const x = this.x0 + sx * JOY.r; const y = this.y0 - sy * JOY.r;
    if (!this.down) {
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: this.x0, y: this.y0, id: this.id }] });
      this.down = true;
    }
    if (sx || sy) await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: this.id }] });
  }
  async release() {
    if (!this.down) return;
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    this.down = false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// per-frame sampler (in page). Installed after the game runs; uses requestAnimationFrame, so it ticks once per
// rendered frame, after the game's own frame callback (registered earlier). Reads camera + drawn avatar + body.
const SAMPLER = () => {
  if (window.__xs) return;
  const X = window.__xs = { rows: [], on: false, seg: 0 };
  const tick = (t) => {
    (window.__ins ? window.__ins.rawRaf : requestAnimationFrame)(tick);
    if (!X.on || !window.__cham) return;
    const H = window.__cham;
    const s = H.state(); const c = H.camera();
    const v = s.viewer || 'b'; const d = s.drawn && s.drawn[v]; const b = s.bodies[v];
    if (!d) return;
    X.rows.push([t, X.seg,
      c.p[0], c.p[1], c.p[2], c.dir[0], c.dir[1], c.dir[2],
      d.p[0], d.p[1], d.p[2], d.up[0], d.up[1], d.up[2], d.fwd[0], d.fwd[1], d.fwd[2],
      b.at ? 1 : 0, b.nx, b.ny, b.nz, b.x, b.y, b.z, s.climbV ? 1 : 0]);
  };
  requestAnimationFrame(tick);
};
const segStart = (p) => p.evaluate(() => { window.__xs.seg++; window.__xs.on = true; });
const segStop = (p) => p.evaluate(() => { window.__xs.on = false; });
const takeRows = (p) => p.evaluate(() => { const r = window.__xs.rows; window.__xs.rows = []; return r; });

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const angDeg = (a, b) => { const la = len(a) || 1; const lb = len(b) || 1; const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb); return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI; };
const quant = (arr, q) => { if (!arr.length) return 0; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stddev = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const REF_DT = 1 / 30;

/**
 * rows → metrics. Per frame i (within a segment): dt = frame delta; dtEff = min(dt, 0.1) (game.js clamps its
 * step at 0.1 s, so a longer frame does not move the world further); camera / body displacement and rotation are
 * measured raw ("raw") and normalised to a 1/30 s frame by x (1/30)/dtEff ("N", the primary metric: frame-rate
 * independent, so a slow sandbox frame is not mistaken for a jump). Events (teleport/jerk):
 *   cam move   : disp > max(0.25 m, 4 x median cam disp of the run)
 *   cam rotate : > 25 deg in one frame        body move : drawn root > 0.15 m        body turn : > 30 deg (up or forward)
 * "near" = within +-3 frames of a surface switch (contact normal changed > 10 deg, or stuck/unstuck).
 */
function analyse(rows) {
  const F = []; // per-frame records
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1]; const q = rows[i];
    if (p[1] !== q[1]) continue; // new segment (a teleport/setup in between)
    const dt = (q[0] - p[0]) / 1000;
    const dtEff = Math.min(Math.max(dt, 0.001), 0.1);
    const k = REF_DT / dtEff;
    const camD = len(sub([q[2], q[3], q[4]], [p[2], p[3], p[4]]));
    const camR = angDeg([q[5], q[6], q[7]], [p[5], p[6], p[7]]);
    const bodD = len(sub([q[8], q[9], q[10]], [p[8], p[9], p[10]]));
    const bodR = Math.max(angDeg([q[11], q[12], q[13]], [p[11], p[12], p[13]]), angDeg([q[14], q[15], q[16]], [p[14], p[15], p[16]]));
    const sw = q[17] !== p[17] || angDeg([q[18], q[19], q[20]], [p[18], p[19], p[20]]) > 10;
    F.push({ i, dt, dtEff, k, camD, camR, bodD, bodR, sw, camV: camD / dtEff, camW: camR / dtEff, bodV: bodD / dtEff, seg: q[1] });
  }
  const n = F.length;
  const swIdx = F.map((f, j) => (f.sw ? j : -1)).filter((j) => j >= 0);
  const near = new Array(n).fill(false);
  for (const j of swIdx) for (let d = -3; d <= 3; d++) if (j + d >= 0 && j + d < n) near[j + d] = true;
  // jerk: |dv/dt| between consecutive frames of one segment
  for (let j = 0; j < n; j++) {
    const f = F[j]; const g = F[j - 1];
    if (g && g.seg === f.seg) { f.camJ = Math.abs(f.camV - g.camV) / f.dtEff; f.camWJ = Math.abs(f.camW - g.camW) / f.dtEff; f.bodJ = Math.abs(f.bodV - g.bodV) / f.dtEff; } else { f.camJ = 0; f.camWJ = 0; f.bodJ = 0; }
  }
  const medCam = quant(F.map((f) => f.camD), 0.5); const medCamN = quant(F.map((f) => f.camD * f.k), 0.5);
  const thrCam = Math.max(0.25, 4 * medCam); const thrCamN = Math.max(0.25, 4 * medCamN);
  const ev = (raw) => {
    const out = { camMove: 0, camRot: 0, bodyMove: 0, bodyTurn: 0, near: 0, far: 0, total: 0 };
    F.forEach((f, j) => {
      const m = raw ? 1 : f.k;
      const e = { camMove: f.camD * m > (raw ? thrCam : thrCamN), camRot: f.camR * m > 25, bodyMove: f.bodD * m > 0.15, bodyTurn: f.bodR * m > 30 };
      const any = e.camMove || e.camRot || e.bodyMove || e.bodyTurn;
      for (const kk of Object.keys(e)) if (e[kk]) out[kk]++;
      if (any) { out.total++; if (near[j]) out.near++; else out.far++; }
    });
    return out;
  };
  const dts = F.map((f) => f.dt * 1000);
  const q3 = (arr) => ({ p50: r2(quant(arr, 0.5)), p95: r2(quant(arr, 0.95)), p99: r2(quant(arr, 0.99)), max: r2(Math.max(0, ...arr)) });
  const nearOnly = (key) => F.filter((f, j) => near[j]).map((f) => f[key]);
  return {
    frames: n, switches: swIdx.length, stalls250ms: dts.filter((x) => x > 250).length,
    frameMs: { p50: r2(quant(dts, 0.5), 1), p95: r2(quant(dts, 0.95), 1), p99: r2(quant(dts, 0.99), 1), stddev: r2(stddev(dts), 1) },
    medianCamDispM: { raw: r2(medCam, 4), norm33ms: r2(medCamN, 4) },
    events: { norm33ms: ev(false), raw: ev(true) },
    camSpeedMps: q3(F.map((f) => f.camV)), camAngDegPerS: q3(F.map((f) => f.camW)), bodyVisualSpeedMps: q3(F.map((f) => f.bodV)),
    camJerkMps2: q3(F.map((f) => f.camJ)), camAngJerkDegPerS2: q3(F.map((f) => f.camWJ)), bodyJerkMps2: q3(F.map((f) => f.bodJ)),
    nearSwitch: { frames: near.filter(Boolean).length, camAngDegPerSmax: r2(Math.max(0, ...nearOnly('camW'))), camSpeedMpsMax: r2(Math.max(0, ...nearOnly('camV'))), camAngJerkMax: r2(Math.max(0, ...nearOnly('camWJ'))), bodyJerkMax: r2(Math.max(0, ...nearOnly('bodJ'))), bodyTurnDegMax: r2(Math.max(0, ...F.filter((f, j) => near[j]).map((f) => f.bodR * f.k))) },
    maxNorm: { camDispM: r2(Math.max(0, ...F.map((f) => f.camD * f.k)), 3), camRotDeg: r2(Math.max(0, ...F.map((f) => f.camR * f.k)), 1), bodyDispM: r2(Math.max(0, ...F.map((f) => f.bodD * f.k)), 3), bodyTurnDeg: r2(Math.max(0, ...F.map((f) => f.bodR * f.k)), 1) },
  };
}
// ─────────────────────────────────────────────────────────────────────
// xfeel: scripted crawl routes driven through the joystick
//
// The route runner steers like a player looking at the screen: every 90 ms it reads the body (contact normal,
// position) and the camera, takes the world direction to the next waypoint, flattens it onto the surface the body
// is on, expresses it on screen axes (camera right / camera up) and pushes the joystick that way. Teleports are used
// only to set up a start (each route segment starts with a settled camera and is sampled separately).
const norm3 = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

async function steer(a, stick, wps, { tick = 90, maxMs = 12000, tol = 0.3, label = '' } = {}) {
  const log = [];
  for (const wp of wps) {
    const t0 = Date.now(); let ok = false; let lastP = null; let lastMove = Date.now();
    while (Date.now() - t0 < (wp.max || maxMs)) {
      const { b, cam } = await a.evaluate(() => ({ b: window.__cham.body(), cam: window.__cham.camera() }));
      const p = [b.x, b.y, b.z]; const to = sub(wp.to, p);
      const n = b.at ? [b.nx, b.ny, b.nz] : [0, 1, 0];
      if (wp.done ? wp.done(b) : (len(to) < (wp.tol || tol))) { ok = true; break; }
      if (!lastP || len(sub(p, lastP)) > 0.05) { lastP = p; lastMove = Date.now(); } else if (Date.now() - lastMove > 2500) break; // stuck (not a failure of the harness: the game's geometry)
      let d = [to[0] - n[0] * dot3(to, n), to[1] - n[1] * dot3(to, n), to[2] - n[2] * dot3(to, n)];
      if (len(d) < 0.02) d = to;
      d = norm3(d);
      if (wp.dir) d = norm3(wp.dir(b));
      const R = norm3(cross(cam.dir, [0, 1, 0]));
      // screen "up": the view's up for a wall; the camera's horizontal heading for anything flat (floor, a table top,
      // a ceiling, flipped), which is what the game maps the stick to there
      const Up = Math.abs(n[1]) > 0.7 ? norm3([cam.dir[0], 0, cam.dir[2]]) : cross(R, cam.dir);
      const sx = dot3(d, R); const sy = dot3(d, Up) * (n[1] < -0.7 ? -1 : 1); // (seen from below, ceiling points nearer the camera are higher on screen)
      const m = Math.hypot(sx, sy) || 1;
      await stick.set(sx / m, sy / m);
      if (process.env.XDEBUG && (wp.name || '').match(process.env.XDEBUG)) console.log(`   [${wp.name}] p=${p.map((x) => x.toFixed(2))} n=${n.map((x) => x.toFixed(1))} at=${b.at} stick=${(sx / m).toFixed(2)},${(sy / m).toFixed(2)} camdir=${cam.dir.map((x) => x.toFixed(2))}`);
      await wait(tick);
    }
    log.push(`${wp.name || ''}:${ok ? 'ok' : 'TIMEOUT'}`);
    if (!ok && wp.required) break;
  }
  await stick.release();
  return log.join(' ');
}

const bodyKind = (b) => (!b.at ? 'floor' : b.ny > 0.7 ? 'top' : b.ny < -0.7 ? 'ceiling' : 'wall');

/** Wait until the camera stopped moving (< 2 cm and < 0.5 deg over ~0.45 s), at most 6 s. */
async function settleCam(a) {
  let prev = null; let still = 0;
  for (let i = 0; i < 40 && still < 3; i++) {
    await wait(150);
    const c = await hook(a, 'camera');
    if (prev && len(sub(c.p, prev.p)) < 0.02 && angDeg(c.dir, prev.dir) < 0.5) still++; else still = 0;
    prev = c;
  }
}

/** Run one route as a sampled segment; returns { name, log, kinds visited, transitions }. */
async function runRoute(a, stick, name, setup, wps, opts = {}) {
  await setup();
  await settleCam(a); // let the camera settle on the (teleported) start
  await stick.origin();
  await segStart(a);
  const log = await steer(a, stick, wps, opts);
  await wait(250);
  await segStop(a);
  return { name, log };
}

/** Route tables. Living Room geometry: room 10 x 8 x 2.5 m, left wall x=-5 (dot wallpaper), back wall z=-4,
 *  right wall x=+5, coffee table top at y~0.5 around (-0.5,-1.25) (1.25 x 0.65 m). `seeker`: the seeker's first-person
 *  walk + over-the-shoulder climb view (no camera hook: the game owns it); else the hider's third-person orbit camera. */
function livingRoutes(a, stick, seeker) {
  const tp = async (x, z, yaw, camYaw) => { await hook(a, 'teleport', x, z, yaw, 0); if (!seeker) await hook(a, 'setCam', camYaw, 0.25, 2.3); };
  const on = (x, y, z, nx, ny, nz, hx, hy, hz, camYaw) => async () => { await hook(a, 'attachAt', x, y, z, nx, ny, nz, hx, hy, hz); if (!seeker) await hook(a, 'setCam', camYaw, 0.25, 2.3); };
  const bk = (f) => (b) => bodyKind(b) === f;
  const routes = [
    // floor → wall (walk into it), wall → ceiling (concave), along the ceiling, ceiling → wall (concave), wall → floor (release)
    ['floor-wall-ceiling-wall-floor', () => tp(-3.4, 1.2, -Math.PI / 2, Math.PI / 2), [
      { name: 'to-left-wall', to: [-5.0, 0.3, 1.2], done: bk('wall'), max: 9000, required: true },
      { name: 'up-to-ceiling', to: [-4.4, 2.5, 1.2], done: bk('ceiling'), max: 12000 },
      { name: 'along-ceiling', to: [-2.8, 2.5, 1.2], tol: 0.35, max: 9000 },
      { name: 'back-to-left-wall', to: [-5.0, 2.3, 1.2], done: bk('wall'), max: 12000 },
      { name: 'down-and-off', to: [-4.6, 0.0, 1.2], done: bk('floor'), max: 14000 },
    ]],
    // wall → wall concave corner (right wall to the back wall), a little way along the back wall
    ['wall-wall-corner', on(4.995, 1.5, -0.6, -1, 0, 0, 0, 0, -1, -Math.PI / 4), [
      { name: 'to-corner-and-back-wall', to: [4.0, 1.5, -3.99], done: (b) => b.at && b.nz > 0.9, max: 16000, required: true },
      { name: 'past-corner', to: [3.6, 1.5, -3.99], tol: 0.25, max: 3500 },
    ]],
  ];
  if (!seeker) {
    // convex edge wrap: table top → edge → side (→ underside, if the surface lets it)
    routes.push(['table-top-edge-side', on(-0.5, 0.497, -1.25, 0, 1, 0, 0, 0, 1, 0), [
      { name: 'to-edge-and-over', to: [0.4, 0.2, -1.25], done: (b) => b.at && Math.abs(b.ny) < 0.5, max: 12000 },
      { name: 'to-underside', to: [0.0, 0.42, -1.25], done: (b) => !b.at || b.ny < -0.7, max: 6000 },
    ]]);
  }
  return routes;
}

/** Any map: from a hider spawn find the nearest wall (4 rays), walk into it, climb to the ceiling above, back, down. */
async function tourRoutes(a, stick, seeker, k) {
  const spots = await hook(a, 'spots');
  const sp = spots.hiderSpawns[k % spots.hiderSpawns.length];
  const y0 = sp.y != null ? sp.y : 0;
  let best = null;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const H = await hook(a, 'surfaceAt', sp.x, y0 + 0.5, sp.z, dx, 0, dz, 8);
    if (H && Math.abs(H.n[1]) < 0.2 && H.n[0] * dx + H.n[2] * dz < -0.7 && H.t > 1.6 && (!best || H.t < best.H.t)) best = { H, d: [dx, dz] };
  }
  if (!best) return [];
  const { H, d } = best;
  const px = H.p[0] - d[0] * 1.4; const pz = H.p[2] - d[1] * 1.4; // 1.4 m from the wall
  const wy = Math.max(y0, H.p[1] - 0.5 > y0 ? H.p[1] - 0.5 : y0);
  const U = await hook(a, 'surfaceAt', H.p[0] - d[0] * 0.8, y0 + 1.0, H.p[2] - d[1] * 0.8, 0, 1, 0, 4);
  const yaw = Math.atan2(d[0], d[1]); // body faces the wall
  const camYaw = Math.atan2(-d[0], -d[1]); // orbit camera behind the body, looking at the wall
  const setup = async () => { await hook(a, 'teleport', px, pz, yaw, y0); if (!seeker) await hook(a, 'setCam', camYaw, 0.25, 2.3); };
  const bk = (f) => (b) => bodyKind(b) === f;
  const wps = [{ name: 'to-wall', to: [H.p[0], wy + 0.3, H.p[2]], done: bk('wall'), max: 9000, required: true }];
  if (U && U.n[1] < -0.9) {
    const cy = U.p[1];
    wps.push({ name: 'up-to-ceiling', to: [U.p[0], cy, U.p[2]], done: bk('ceiling'), max: 9000 });
    wps.push({ name: 'along-ceiling', to: [U.p[0] - d[0] * 0.9, cy, U.p[2] - d[1] * 0.9], tol: 0.35, max: 6000 });
    wps.push({ name: 'back-to-wall', to: [H.p[0], cy - 0.2, H.p[2]], done: bk('wall'), max: 12000 });
  }
  wps.push({ name: 'down-and-off', to: [H.p[0] - d[0] * 0.5, y0, H.p[2] - d[1] * 0.5], done: bk('floor'), max: 16000 });
  return [[`tour-wall-${k}`, setup, wps]];
}

async function feelRun(a, cdp, mapId, role, repeat) {
  await a.evaluate(SAMPLER);
  const stick = new Stick(cdp, a);
  const seeker = role === 'seeker';
  const routes = mapId === 'living' ? livingRoutes(a, stick, seeker) : await tourRoutes(a, stick, seeker, 0);
  const results = [];
  for (const [name, setup, wps, o] of routes) {
    const rowsAll = []; const logs = [];
    for (let i = 0; i < repeat; i++) {
      const res = await runRoute(a, stick, name, setup, wps, o || {});
      const rows = await takeRows(a);
      // keep segment ids unique across repeats (analyse() ignores frame pairs from different segments)
      const base = i * 1000; for (const r of rows) { r[1] += base; rowsAll.push(r); }
      logs.push(res.log);
    }
    const m = analyse(rowsAll);
    results.push({ name, m, logs });
    metric('xfeel.route', { map: mapId, role, route: name, repeats: repeat, log: logs, ...m });
  }
  return results;
}

async function feelCombo(port, map, role, repeat) {
  const { h, a, cdp } = await boot(port, { cpu: FEEL_CPU });
  try {
    const rules = role === 'seeker' ? { seekClimb: true, climbSpeed: 'normal', grace: 0, headStart: 0 } : {};
    await toHide(a, map, rules);
    if (role === 'seeker') {
      await a.click('.chm-acts [data-act="ready"]');
      await waitPhase(a, 'curtain');
      await a.click('[data-act="curtain"]');
      await waitPhase(a, 'seek');
      await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 15000 });
      await wait(500);
    }
    const results = await feelRun(a, cdp, map, role, repeat);
    const all = { routes: results.length, frames: 0, switches: 0, events: 0, near: 0, far: 0, eventsRaw: 0, camRotEvents: 0, camMoveEvents: 0, bodyMoveEvents: 0, bodyTurnEvents: 0 };
    for (const r of results) {
      const e = r.m.events.norm33ms;
      all.frames += r.m.frames; all.switches += r.m.switches; all.events += e.total; all.near += e.near; all.far += e.far; all.eventsRaw += r.m.events.raw.total;
      all.camRotEvents += e.camRot; all.camMoveEvents += e.camMove; all.bodyMoveEvents += e.bodyMove; all.bodyTurnEvents += e.bodyTurn;
    }
    metric('xfeel.total', { map, role, ...all });
    h.assertNoErrors();
  } catch (e) { console.error(e); failures++; await a.screenshot({ path: path.join(SHOTS, `xfeel-${map}-${role}-FAIL.png`) }).catch(() => {}); } finally { await h.close().catch(() => {}); }
}

async function feelSection(port) {
  console.log('\n# xfeel: surface-switch smoothness (hotseat, real joystick via CDP touch; CPU x' + FEEL_CPU + ')');
  const maps = (process.env.FEEL_MAPS || 'living,house').split(',');
  const roles = (process.env.FEEL_ROLES || 'hider,seeker').split(',');
  const repeat = Number(process.env.REPEAT) || 3;
  for (const role of roles) for (const map of maps) await feelCombo(port, map, role, repeat);
}

// ─────────────────────────────────────────────────────────────────────
// xperf: budgets per map on the iPhone 13 profile at CPU x4
//
//  cold build ms  : wall time of one synchronous stage.loadMap(id) (hook useMap) for a map not in the session cache, in the page, at CPU x4
//                   (= the longest main-thread block a map switch can cause). `cached` = it was already in the cache (then it is a scene swap).
//                   bootMs: click on the hub card -> game ready (mount + first map + shader compile), living room.
//  calls / tris   : renderer.info.render.calls / .triangles of the last frame (hook perf()), worst and mean over the sampled views.
//                   hide = third person orbit from the hider spawns (x2 yaws), seek = first person from the seeker spawns (x2 looks).
//  js ms          : time spent inside the game's requestAnimationFrame callback ('frame': simulate+animate+cameras+fx+ui+render submit)
//                   measured by a rAF wrapper over a 2.5 s window, mean / p95 / max per frame (CPU x4, so ~4x a real phone's JS cost,
//                   software GL does not slow the JS but the main thread still waits on it in some calls). bench = the game's own
//                   bench() hook split (ms, mean of 20 runs).
//  textures       : sampled by the scene: textures referenced by the drawn scene's materials (atlas, toon ramp, paint textures, blobs...) and
//                   their size w*h*4*1.33 (estMB) / with the real mipmap flag (mipMB), plus the number of live GL textures and the
//                   GL-tracked total (every texture the page still holds, including other maps' atlases kept in the session cache).
const PERF_ALL = ['living', 'garden', 'studio', 'candy', 'house', 'market', 'cuboulder', 'greenhouse', 'museum', 'launderette'];
const r1 = (x) => r2(x, 1);

async function sampleViews(a, kind, spawns, views) {
  let calls = []; let tris = [];
  for (const sp of spawns) {
    await hook(a, 'teleport', sp.x, sp.z, sp.yaw || 0, sp.y != null ? sp.y : undefined);
    for (const v of views) {
      if (kind === 'hide') await hook(a, 'setCam', v, 0.3, 2.3); else await hook(a, 'setLook', v[0], v[1]);
      await wait(650);
      const pf = await hook(a, 'perf');
      calls.push(pf.calls); tris.push(pf.tris);
    }
  }
  return { callsMax: Math.max(...calls), callsMean: r1(mean(calls)), trisMax: Math.max(...tris), trisMean: Math.round(mean(tris)), views: calls.length };
}

async function jsWindow(a, ms = 2500) {
  await insReset(a);
  await wait(ms);
  const rows = await insJs(a);
  const f = rows.find((r) => r.name === 'frame') || rows[0] || { n: 0, meanMs: 0, p95Ms: 0, maxMs: 0 };
  return { fn: f.name || '?', frames: f.n, meanMs: r2(f.meanMs), p95Ms: r2(f.p95Ms), maxMs: r2(f.maxMs), fps: r1(f.n / (ms / 1000)), top: rows.map((r) => `${r.name}:${r2(r.meanMs)}x${r.n}`) };
}

async function perfSection(port) {
  console.log('\n# xperf: draw calls / triangles / textures / JS per frame / build time per map (iPhone 13 profile, CPU x' + CPU + ')');
  const ids = process.env.PERF_MAPS && process.env.PERF_MAPS !== 'all' ? process.env.PERF_MAPS.split(',') : PERF_ALL;
  const { h, a, cdp, bootMs } = await boot(port, { instrument: true });
  const out = {};
  try {
    const known = await hook(a, 'mapIds');
    const first = ids[0];
    // enter the hide phase on the first map (lobby selection is queued/sliced, so this is not the cold-build number)
    await toHide(a, first, {});
    metric('xperf.boot', { cpu: CPU, bootMs, mapIds: known, firstMap: first });
    // pass 1 (hide phase, third person): cold builds + views + JS
    for (const id of ids) {
      const cachedBefore = (await hook(a, 'bootInfo')).cache.some((c) => c.id === id);
      const t = await a.evaluate((m) => { const t0 = performance.now(); window.__cham.useMap(m); return performance.now() - t0; }, id);
      await wait(900);
      await hook(a, 'resetPerf');
      const info = (await hook(a, 'mapsInfo')).find((m) => m.id === id);
      const ws = await hook(a, 'worldStats');
      const spots = await hook(a, 'spots');
      const spawns = spots.hiderSpawns.slice(0, 2);
      const hide = await sampleViews(a, 'hide', spawns, [0, 2.4]);
      await hook(a, 'teleport', spawns[0].x, spawns[0].z, spawns[0].yaw || 0, spawns[0].y != null ? spawns[0].y : undefined);
      await hook(a, 'setCam', 0, 0.3, 2.3);
      await wait(500);
      const jsHide = await jsWindow(a);
      const bench = await hook(a, 'bench', 20);
      const pf = await hook(a, 'perf');
      const tex = await insTex(a);
      const builds = (await hook(a, 'bootInfo')).builds.filter((b) => b.id === id).pop() || null;
      await cdp.send('HeapProfiler.collectGarbage');
      const heapMB = (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576;
      out[id] = { cachedBefore };
      metric('xperf.map', {
        map: id, name: info && info.name, area: info && info.area, size: info && info.size,
        build: { ms: r1(t), cached: cachedBefore, steps: builds && builds.steps, stepMaxMs: builds && builds.maxMs, slices: builds && builds.slices },
        world: { chunks: ws.chunks, verts: ws.verts, tris: Math.round(ws.tris), colliders: ws.boxes, atlasUsedPx: ws.atlasUsed, atlasH: ws.atlasH },
        hide: { ...hide, js: jsHide },
        bench: { simulate: r2(bench.simulate), animate: r2(bench.animate), cameras: r2(bench.cameras), fx: r2(bench.fx), ui: r2(bench.ui), render: r2(bench.render) },
        perf: { textures: pf.textures, geometries: pf.geometries, programs: pf.programs, scale: pf.scale, dpr: pf.dpr },
        tex, heapMB: r1(heapMB),
      });
    }
    // pass 2 (seek phase, first person): the maps are cached now (scene swaps)
    await hook(a, 'useMap', ids[0]); await wait(600);
    await a.click('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'curtain');
    await a.click('[data-act="curtain"]');
    await waitPhase(a, 'seek');
    await wait(1200);
    for (const id of ids) {
      const t = await a.evaluate((m) => { const t0 = performance.now(); window.__cham.useMap(m); return performance.now() - t0; }, id);
      await wait(900);
      const spots = await hook(a, 'spots');
      const spawns = spots.seekerSpawns.slice(0, 2);
      const seek = await sampleViews(a, 'seek', spawns, [[0, 0], [2.4, 0.2]]);
      await hook(a, 'teleport', spawns[0].x, spawns[0].z, spawns[0].yaw || 0, spawns[0].y != null ? spawns[0].y : undefined);
      await hook(a, 'setLook', 0, 0);
      await wait(500);
      const jsSeek = await jsWindow(a);
      const bench = await hook(a, 'bench', 20);
      metric('xperf.map.seek', { map: id, swapMs: r1(t), seek: { ...seek, js: jsSeek }, bench: { simulate: r2(bench.simulate), animate: r2(bench.animate), cameras: r2(bench.cameras), fx: r2(bench.fx), ui: r2(bench.ui), render: r2(bench.render) } });
    }
    h.assertNoErrors();
  } catch (e) { console.error(e); failures++; await a.screenshot({ path: path.join(SHOTS, 'xperf-FAIL.png') }).catch(() => {}); } finally { await h.close().catch(() => {}); }
}

// ─────────────────────────────────────────────────────────────────────
// xseek: how big is the camouflaged hider on the seeker's screen? (a proxy for "too easy to find")
//
//  Hider: Large size (default Classic), flat on the map's camo wall (hook spots().camo + setPose('wall')), the map's hider spawn.
//  Seeker: first person, standing d m from the hider's centre along the wall's normal, looking at it (hook teleport + aimAt).
//  Measured: every vertex of the avatar's visible meshes projected with the seeker's camera (three.js scene captured at render time),
//  2-D bounding box in CSS px of the 390x664 phone screen: width, height, area, and the area as % of the screen. Distances
//  are the real camera-to-body-centre distance. If the room is too small for d, the closest possible is used (clipped:true).
async function seekSection(port) {
  console.log('\n# xseek: hider size on the seeker\'s screen at 3 m / 6 m (default Classic size)');
  for (const id of (process.env.SEEK_MAPS || 'living,garden,studio,candy').split(',')) await seekMap(port, id);
}
async function seekMap(port, id) {
  const { h, a } = await boot(port, { cpu: 1, instrument: true });
  try {
    {
      await toHide(a, id, { grace: 0, headStart: 0 });
      const spots = await hook(a, 'spots');
      const c = spots.camo || spots.hiderSpawns[0];
      await hook(a, 'teleport', c.x, c.z - 0.1, 0, c.y);
      await wait(300);
      const pose = await hook(a, 'setPose', 'wall');
      await wait(600);
      const hb = (await hook(a, 'body')); // viewer = the hider
      await a.click('.chm-acts [data-act="ready"]');
      await waitPhase(a, 'curtain');
      await a.click('[data-act="curtain"]');
      await waitPhase(a, 'seek');
      await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 15000 });
      await wait(700);
      const hbody = (await st(a)).bodies.b;
      const n = hbody.at ? [hbody.nx, 0, hbody.nz] : [0, 0, 1];
      const nl = Math.hypot(n[0], n[2]) || 1; const nx = n[0] / nl; const nz = n[2] / nl;
      const res = { map: id, pose, hiderAt: [r2(hbody.x), r2(hbody.y), r2(hbody.z)], hiderOnSurface: !!hbody.at, wallNormal: [r2(nx), r2(nz)], views: [] };
      void hb;
      for (const d of [3, 6]) {
        // free run from the hider along the normal (the room can be short)
        const H = await hook(a, 'surfaceAt', hbody.x, hbody.y + 0.3, hbody.z, nx, 0, nz, d + 1);
        const free = H ? Math.max(0.8, H.t - 0.5) : d + 1;
        const dd = Math.min(d, free);
        await hook(a, 'teleport', hbody.x + nx * dd, hbody.z + nz * dd, 0, hbody.y);
        const bc = await hook(a, 'bodyCenter', 'b');
        await hook(a, 'aimAt', ...bc);
        await wait(700);
        await hook(a, 'aimAt', ...bc);
        await wait(500);
        const m = await a.evaluate(() => {
          const I = window.__ins; const H = window.__cham; const T = window.THREE;
          const d = H.state().drawn.b; const cam = I.camera;
          cam.updateMatrixWorld(true);
          let root = null;
          for (const ch of I.scene.children) if (Math.abs(ch.position.x - d.p[0]) < 1e-5 && Math.abs(ch.position.y - d.p[1]) < 1e-5 && Math.abs(ch.position.z - d.p[2]) < 1e-5 && ch.children.length) { root = ch; break; }
          if (!root) return { err: 'avatar root not found' };
          root.updateMatrixWorld(true);
          const cv = document.querySelector('.chm canvas').getBoundingClientRect();
          const v = new T.Vector3(); let minX = 1e9; let maxX = -1e9; let minY = 1e9; let maxY = -1e9; let nv = 0; let behind = 0;
          root.traverse((o) => {
            if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes.position) return;
            let vis = true; for (let p = o; p; p = p.parent) if (p.visible === false) { vis = false; break; }
            if (!vis) return;
            const pos = o.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) {
              v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).project(cam);
              if (v.z > 1) { behind++; continue; }
              const x = (v.x + 1) / 2 * cv.width; const y = (1 - v.y) / 2 * cv.height;
              if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; nv++;
            }
          });
          const bc = new T.Vector3(); const b = H.bodyCenter('b'); bc.set(b[0], b[1], b[2]);
          const dist = cam.position.distanceTo(bc);
          return { w: maxX - minX, h: maxY - minY, area: (maxX - minX) * (maxY - minY), screenW: cv.width, screenH: cv.height, verts: nv, behind, dist, fov: cam.fov };
        });
        res.views.push({ wantM: d, ...(m.err ? m : { distM: r2(m.dist), clipped: dd < d, wPx: r1(m.w), hPx: r1(m.h), areaPx2: Math.round(m.area), areaPctScreen: r2(100 * m.area / (m.screenW * m.screenH)), heightPctScreen: r2(100 * m.h / m.screenH), fovDeg: r1(m.fov), screen: [Math.round(m.screenW), Math.round(m.screenH)], verts: m.verts }) });
      }
      metric('xseek.map', res);
    }
    h.assertNoErrors();
  } catch (e) { console.error(e); failures++; await a.screenshot({ path: path.join(SHOTS, 'xseek-FAIL.png') }).catch(() => {}); } finally { await h.close().catch(() => {}); }
}

// ─────────────────────────────────────────────────────────────────────
(async () => {
  const sections = [];
  if (want('xfeel')) sections.push(() => feelSection(PORT + 0));
  if (want('xperf')) sections.push(() => perfSection(PORT + 1));
  if (want('xseek')) sections.push(() => seekSection(PORT + 2));
  for (const run of sections) { try { await run(); } catch (e) { console.error(e); failures++; } }
  if (failures) { console.error(`\n${failures} section(s) failed`); process.exitCode = 1; } else console.log('\nDONE');
})();
