// Knucklebones + Tower Together perf bench on an iPhone 13 profile with the CPU throttled 4×.
// Not a pass/fail suite: it prints a JSON table so a change can be measured before and after.
//   node tools/test/games/threed-perf.js            (PORT=… to move it; uses PORT)
// What it measures, the same way for any version of the games (it instruments WebGL, not the game):
//   frame-time jitter  rAF deltas while the tower slider sweeps / a die tumbles: mean, p95, stdev, frames > 25 ms
//   input latency      pointerdown → the first rAF after the game has reacted (tower: the drop is recorded;
//                      bones: the placed die is in the tray), measured inside the page
//   draw calls / tris  per rendered frame (max), counted at the GL entry points
//   texture memory     bytes uploaded with texImage2D (live textures, ×4/3 when mipmapped)
const path = require('path');
const { launch } = require('../harness');

const PORT = Number(process.env.PORT) || 8990;
const THROTTLE = Number(process.env.CPU) || 4;

const INSTRUMENT = () => {
  const S = (window.__perf = { calls: 0, tris: 0, frameCalls: [], frameTris: [], tex: new Map(), rafs: [] });
  const wrap = (proto) => {
    if (!proto || proto.__wrapped) return;
    proto.__wrapped = true;
    const tri = (mode, n) => (mode === 4 ? n / 3 : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0);
    const de = proto.drawElements; proto.drawElements = function (m, n, ...r) { S.calls++; S.tris += tri(m, n); return de.call(this, m, n, ...r); };
    const da = proto.drawArrays; proto.drawArrays = function (m, f, n) { S.calls++; S.tris += tri(m, n); return da.call(this, m, f, n); };
    const bind = proto.bindTexture; proto.bindTexture = function (t, tex) { this.__tex = tex; return bind.call(this, t, tex); };
    const ti = proto.texImage2D;
    proto.texImage2D = function (...a) {
      let w = 0; let h = 0;
      if (a.length >= 8) { w = a[3]; h = a[4]; } else { const src = a[5]; w = src && (src.width || src.videoWidth) || 0; h = src && (src.height || src.videoHeight) || 0; }
      if (a[1] === 0 && this.__tex) S.tex.set(this.__tex, { w, h, mip: false });
      return ti.apply(this, a);
    };
    const gm = proto.generateMipmap; proto.generateMipmap = function (t) { const e = this.__tex && S.tex.get(this.__tex); if (e) e.mip = true; return gm.call(this, t); };
    const dt = proto.deleteTexture; proto.deleteTexture = function (t) { S.tex.delete(t); return dt.call(this, t); };
  };
  wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  const raf = window.requestAnimationFrame.bind(window);
  // every frame: close the GL counters of the previous frame, note the rAF timestamp
  const tick = (t) => {
    if (S.calls) { S.frameCalls.push(S.calls); S.frameTris.push(S.tris); }
    S.calls = 0; S.tris = 0;
    S.rafs.push(t);
    raf(tick);
  };
  raf(tick);
  S.texBytes = () => { let b = 0; for (const e of S.tex.values()) b += e.w * e.h * 4 * (e.mip ? 4 / 3 : 1); return Math.round(b); };
  S.reset = () => { S.frameCalls = []; S.frameTris = []; S.rafs = []; };
};

function stats(rafs) {
  const d = [];
  for (let i = 1; i < rafs.length; i++) d.push(rafs[i] - rafs[i - 1]);
  if (!d.length) return null;
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
  const s = [...d].sort((a, b) => a - b);
  const p = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { n: d.length, mean: +mean.toFixed(2), sd: +sd.toFixed(2), p50: +p(0.5).toFixed(2), p95: +p(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2), over25: d.filter((x) => x > 25).length };
}
const gl = async (pg) => pg.evaluate(() => ({
  calls: Math.max(0, ...window.__perf.frameCalls), tris: Math.max(0, ...window.__perf.frameTris), texBytes: window.__perf.texBytes(), textures: window.__perf.tex.size,
}));

async function tower(h, pg) {
  await pg.evaluate(() => { window.__towerTest = { log: [] }; });
  await h.newLocalGame(pg, 'tower');
  const id = await pg.evaluate(() => window.__lastMatchId);
  const jit = []; const lat = [];
  for (let n = 0; n < 8; n++) {
    await pg.waitForSelector('.gt-view[data-armed="1"]', { timeout: 15000 });
    await pg.evaluate(() => window.__perf.reset());
    await h.wait(1500); // the slider sweeping: steady-state frame pacing
    jit.push(await pg.evaluate(() => window.__perf.rafs.slice()));
    await pg.evaluate((v) => {
      window.__towerTest.next = v;
      const el = document.querySelector('.gt-view');
      window.__lat = null;
      el.addEventListener('pointerdown', (ev) => {
        const t0 = ev.timeStamp;
        const seen = () => { if (window.__towerTest.tapped !== undefined && window.__towerTest.tapped !== null) requestAnimationFrame((t) => { window.__lat = t - t0; }); else requestAnimationFrame(seen); };
        seen();
      }, { once: true, capture: true });
      window.__towerTest.tapped = null;
    }, n % 3 === 0 ? 0.03 : 0.25);
    const box = await pg.locator('.gt-view').boundingBox();
    await pg.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.6);
    await pg.waitForFunction(() => window.__lat !== null, null, { timeout: 5000 });
    lat.push(await pg.evaluate(() => window.__lat));
    const e = await h.engine(pg, id);
    if (e.over) break;
  }
  const all = []; for (const r of jit) { const s = stats(r); if (s) all.push(s); }
  const g = await gl(pg);
  await h.closeGame(pg).catch(() => {});
  return { frame: merge(jit), latencyMs: summarise(lat), ...g };
}

async function bones(h, pg) {
  await pg.evaluate(() => { window.__bonesTest = { log: [] }; });
  await h.newLocalGame(pg, 'bones');
  const id = await pg.evaluate(() => window.__lastMatchId);
  const jit = []; const lat = [];
  for (let n = 0; n < 8; n++) {
    const e = await h.engine(pg, id);
    if (e.over) break;
    const who = e.acts[0];
    // the roll in flight: frame pacing while the die tumbles
    await pg.evaluate(() => window.__perf.reset());
    await pg.waitForSelector(`.gb-tray[data-who="${who}"].is-picking`, { timeout: 15000 });
    jit.push(await pg.evaluate(() => window.__perf.rafs.slice()));
    const col = [0, 1, 2].find((c) => e.state.grids[who][c].length < 3);
    const sel = `.gb-tray[data-who="${who}"] .gb-col[data-col="${col}"]`;
    await pg.evaluate((s) => {
      const el = document.querySelector(s);
      window.__lat = null;
      const T = window.__bonesTest; T.log = []; T.at = [];
      let t0 = 0;
      const seen = () => { const i = T.log.indexOf('place'); if (i >= 0) requestAnimationFrame((t) => { window.__lat = t - t0; }); else requestAnimationFrame(seen); };
      el.addEventListener('pointerdown', (ev) => { t0 = ev.timeStamp; seen(); }, { once: true, capture: true });
    }, sel);
    const box = await pg.locator(sel).boundingBox();
    await pg.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await pg.waitForFunction(() => window.__lat !== null, null, { timeout: 5000 }).catch(() => {});
    lat.push(await pg.evaluate(() => window.__lat));
  }
  const g = await gl(pg);
  await h.closeGame(pg).catch(() => {});
  return { frame: merge(jit), latencyMs: summarise(lat.filter((x) => x !== null)), ...g };
}

function merge(list) { // jitter over all the sampled windows (deltas inside each window only)
  const d = [];
  for (const r of list) for (let i = 1; i < r.length; i++) d.push(r[i] - r[i - 1]);
  const fake = [0]; for (const x of d) fake.push(fake[fake.length - 1] + x);
  return stats(fake);
}
function summarise(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return { n: xs.length, mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1), p50: +s[Math.floor(s.length / 2)].toFixed(1), max: +s[s.length - 1].toFixed(1) };
}

(async () => {
  const out = {};
  for (const scheme of (process.env.SCHEMES || 'light').split(',')) {
    const h = await launch({ port: PORT, only: ['tower', 'bones'], colorScheme: scheme, coarse: true });
    try {
      const pg = h.a;
      await pg.addInitScript(INSTRUMENT);
      await pg.reload();
      await pg.waitForTimeout(500);
      const cdp = await pg.context().newCDPSession(pg);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      await h.openGames(pg);
      out[`tower-${scheme}`] = await tower(h, pg);
      await h.openGames(pg).catch(() => {});
      out[`bones-${scheme}`] = await bones(h, pg);
    } finally { await h.close(); }
  }
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
