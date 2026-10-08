// Body paint: a 128×128 RGBA buffer (uploaded as a DataTexture) edited in 3D through the
// avatar's texel map. Brush dabs, region fill, stamp-from-surface, undo, and the network codec:
// median-cut quantisation to ≤ 32 colours (in place, so both players see the same pixels),
// then palette + byte ops (short run / long run / copy-row-above), base64, FNV-1a checksum.
import { TEX, REGIONS } from './avatar.js';
import { fnv, bytesToB64, b64ToBytes } from './util.js';
import { sampleAtlas } from './atlas.js';

const N = TEX * TEX;
const UNDO_MAX = 24;
/** Reveal waves: seconds, the width of the bright front (in units of the whole sweep), its
 *  brightness toward white. A stamp wipes up the body like a print being pulled; a fill floods
 *  out from the finger; an undo dissolves back in a speckle. */
export const REVEAL = { stamp: { dur: 0.36, band: 0.22, glow: 0.65 }, fill: { dur: 0.28, band: 0.3, glow: 0.4 }, undo: { dur: 0.22, band: 0.45, glow: 0.3 } };
const BLACK = [0, 0, 0];

export function createPaint(THREE, kit) {
  const data = new Uint8Array(N * 4).fill(255);
  const texture = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const { part, lpos, lnrm, list } = kit.texels;
  const wpos = new Float32Array(N * 3);
  const wnrm = new Float32Array(N * 3);
  const undo = [];
  // undo snapshots are 64 KB each: recycled through a pool, so a stroke allocates nothing once
  // the history is full (it used to slice() a fresh buffer per stroke / fill / stamp)
  const pool = [];
  const recycle = (b) => { if (b && pool.length < UNDO_MAX + 1) pool.push(b); };
  let snapAllocs = 0;
  let dirty = false;
  let version = 0;
  let encVer = -1; let encCache = null;
  if (!warmed) warmCodec();
  const tmp = [0, 0, 0];
  // per-part texel lists + world bounding spheres (from updateWorld) so a dab only walks the
  // one or two parts it can reach instead of every texel on the body
  let NP = 0; for (let k = 0; k < list.length; k++) if (part[list[k]] + 1 > NP) NP = part[list[k]] + 1;
  const plist = []; { const cnt = new Int32Array(NP); for (let k = 0; k < list.length; k++) cnt[part[list[k]]]++; for (let p = 0; p < NP; p++) plist.push(new Int32Array(cnt[p])); cnt.fill(0); for (let k = 0; k < list.length; k++) { const i = list[k]; const p = part[i]; plist[p][cnt[p]++] = i; } }
  const psph = new Float32Array(NP * 4).fill(0); // cx, cy, cz, r (r = 1e9 until the first updateWorld)
  for (let p = 0; p < NP; p++) psph[p * 4 + 3] = 1e9;
  let dabTexels = 0; let dabs = 0; // texels tested by dabs, dabs made (perf counters)
  let fxMs = 0; let fxMax = 0; let fxN = 0; // reveal / x-ray frame cost (flush)

  // ── reveals: a stamp wipes up the body, a fill floods out from the finger ──
  // The new colours go into `tgt`; every affected texel gets a key 0..1 (when the wave reaches
  // it) and the texels are bucket-sorted by key. flush() (once a frame) advances the wave: texels
  // behind its band take their target, the band itself flashes toward white and settles. Anything
  // that reads or edits the skin settles the wave first, so the codec, undo, hashes and the blend
  // score only ever see finished paint. Scratch buffers are allocated once (no per-stamp garbage).
  const tgt = new Uint8Array(N * 4);
  const rkey = new Float32Array(N);
  const rtmp = new Int32Array(N); const rord = new Int32Array(N);
  const RBK = 64; const rcnt = new Int32Array(RBK + 1);
  const rv = { on: false, n: 0, done: 0, head: 0, t0: 0, dur: 0.3, band: 0.25, glow: 0.6, kind: '', count: 0 };
  /** Start a wave over the rn texels in rtmp whose raw keys are in rkey (normalised here). */
  function beginReveal(rn, kind, dur, band, glow) {
    let k0 = Infinity; let k1 = -Infinity;
    for (let j = 0; j < rn; j++) { const k = rkey[rtmp[j]]; if (k < k0) k0 = k; if (k > k1) k1 = k; }
    const span = k1 - k0 > 1e-6 ? k1 - k0 : 1;
    rcnt.fill(0);
    // (the bucket is taken from the stored float32 key in both passes, so they always agree)
    for (let j = 0; j < rn; j++) { const i = rtmp[j]; rkey[i] = (rkey[i] - k0) / span; rcnt[Math.min(RBK - 1, (rkey[i] * RBK) | 0) + 1]++; }
    for (let b = 1; b <= RBK; b++) rcnt[b] += rcnt[b - 1];
    for (let j = 0; j < rn; j++) { const i = rtmp[j]; rord[rcnt[Math.min(RBK - 1, (rkey[i] * RBK) | 0)]++] = i; }
    rv.on = rn > 0; rv.n = rn; rv.done = 0; rv.head = 0; rv.t0 = performance.now(); rv.dur = dur; rv.band = band; rv.glow = glow; rv.kind = kind; rv.count++;
    touch();
  }
  /** Advance the wave to real time `t` (ms). */
  function stepReveal(t) {
    const band = rv.band; const p = ((t - rv.t0) / 1000 / rv.dur) * (1 + band);
    if (p >= 1 + band) { settle(); return; }
    const n = rv.n; let head = rv.head;
    while (head < n && rkey[rord[head]] <= p) head++;
    rv.head = head;
    const glow = rv.glow;
    for (let j = rv.done; j < head; j++) {
      const i = rord[j]; const a = (p - rkey[i]) / band; const o = i * 4;
      if (a >= 1) { data[o] = tgt[o]; data[o + 1] = tgt[o + 1]; data[o + 2] = tgt[o + 2]; if (j === rv.done) rv.done++; continue; }
      if (a <= 0) continue;
      const g = (1 - a) * (1 - a) * glow; // the front flashes toward white, then settles
      data[o] = (tgt[o] + (255 - tgt[o]) * g) | 0; data[o + 1] = (tgt[o + 1] + (255 - tgt[o + 1]) * g) | 0; data[o + 2] = (tgt[o + 2] + (255 - tgt[o + 2]) * g) | 0;
    }
    dirty = true;
  }
  /** Finish any running wave now (every reader / editor of the skin calls this first). */
  function settle() {
    if (!rv.on) return;
    rv.on = false;
    for (let j = rv.done; j < rv.n; j++) { const o = rord[j] * 4; data[o] = tgt[o]; data[o + 1] = tgt[o + 1]; data[o + 2] = tgt[o + 2]; }
    rv.done = rv.n;
    touch();
  }

  /** Recompute world-space texel positions from the avatar meshes (call when the pose settles). */
  function updateWorld(meshes) {
    const els = meshes.map((m) => { m.updateWorldMatrix(true, false); return m.matrixWorld.elements; });
    for (let k = 0; k < list.length; k++) {
      const i = list[k]; const e = els[part[i]];
      const x = lpos[i * 3]; const y = lpos[i * 3 + 1]; const z = lpos[i * 3 + 2];
      wpos[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      wpos[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      wpos[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = lnrm[i * 3]; const ny = lnrm[i * 3 + 1]; const nz = lnrm[i * 3 + 2];
      let ax = e[0] * nx + e[4] * ny + e[8] * nz; let ay = e[1] * nx + e[5] * ny + e[9] * nz; let az = e[2] * nx + e[6] * ny + e[10] * nz;
      const L = Math.sqrt(ax * ax + ay * ay + az * az) || 1; ax /= L; ay /= L; az /= L; // (Math.hypot is several times slower)
      wnrm[i * 3] = ax; wnrm[i * 3 + 1] = ay; wnrm[i * 3 + 2] = az;
    }
    for (let p = 0; p < NP; p++) {
      const L = plist[p]; if (!L.length) continue;
      let cx = 0; let cy = 0; let cz = 0;
      for (let k = 0; k < L.length; k++) { const i = L[k] * 3; cx += wpos[i]; cy += wpos[i + 1]; cz += wpos[i + 2]; }
      cx /= L.length; cy /= L.length; cz /= L.length;
      let r2 = 0;
      for (let k = 0; k < L.length; k++) { const i = L[k] * 3; const dx = wpos[i] - cx; const dy = wpos[i + 1] - cy; const dz = wpos[i + 2] - cz; const d = dx * dx + dy * dy + dz * dz; if (d > r2) r2 = d; }
      psph[p * 4] = cx; psph[p * 4 + 1] = cy; psph[p * 4 + 2] = cz; psph[p * 4 + 3] = Math.sqrt(r2);
    }
  }

  function snapshot() {
    settle();
    let b = pool.pop();
    if (!b) { b = new Uint8Array(N * 4); snapAllocs++; }
    b.set(data);
    undo.push(b);
    if (undo.length > UNDO_MAX) recycle(undo.shift());
  }

  function touch() { dirty = true; version++; if (xr.on) xrayOff(); }

  // ── x-ray ("where do I show?"): mismatched texels flash with crawling hazard stripes ──
  // err (Uint8Array(N), camo.js errorMap): how much each texel loses against the surface behind
  // (0 = perfect, 255 = scores nothing). The stripes are drawn into a display copy that the
  // texture points at while the x-ray runs; `data` is never touched, and any edit (touch) ends
  // the x-ray at once, so a stroke always lands on the real skin.
  const xr = { on: false, t0: 0, dur: 0, n: 0, frames: 0 };
  let disp = null; let xbad = null; let xerr = null;
  const XRAY_MIN = 64; // a texel shows when it loses more than 25 % of its score
  function xray(err, durMs = 2200) {
    settle();
    if (!disp) { disp = new Uint8Array(N * 4); xbad = new Int32Array(N); }
    let n = 0;
    for (let k = 0; k < list.length; k++) { const i = list[k]; if (err[i] > XRAY_MIN) xbad[n++] = i; }
    xerr = err; xr.n = n; xr.t0 = performance.now(); xr.dur = durMs; xr.frames = 0;
    disp.set(data);
    xr.on = true;
    texture.image.data = disp; dirty = true;
    return n;
  }
  function xrayOff() {
    if (!xr.on) return;
    xr.on = false;
    texture.image.data = data; dirty = true;
  }
  /** One x-ray frame: stripes crawl along the texture diagonal; fade in 0.12 s, out over the last 0.45 s. */
  function stepXray(t) {
    const el = t - xr.t0;
    if (el >= xr.dur) { xrayOff(); return; }
    const env = Math.min(1, el / 120, (xr.dur - el) / 450);
    const ph = (el / 40) | 0;
    for (let j = 0; j < xr.n; j++) {
      const i = xbad[j]; const o = i * 4;
      // hazard tape: yellow / ink diagonal bands 6 texels wide, crawling; they read on any paint
      // colour (a magenta hatch vanished on a pink body), stronger where the texel shows more
      const on = ((i & 127) + (i >> 7) + ph) % 12 < 6;
      const a = env * Math.min(1, (xerr[i] - XRAY_MIN) / 96 + 0.45) * (on ? 0.94 : 0.8);
      const tr = on ? 255 : 26; const tg = on ? 208 : 24; const tb = on ? 20 : 32;
      disp[o] = data[o] + (tr - data[o]) * a; disp[o + 1] = data[o + 1] + (tg - data[o + 1]) * a; disp[o + 2] = data[o + 2] + (tb - data[o + 2]) * a;
    }
    xr.frames++;
    dirty = true;
  }

  /**
   * One brush dab at world point (hx,hy,hz). view = direction camera→hit (skips texels facing
   * away so you paint what you see). hard: crisp edge; else soft falloff with flow.
   */
  function dab(hx, hy, hz, vx, vy, vz, radius, rgb, hard, flow = 0.4) {
    const r2 = radius * radius;
    settle();
    let hit = 0; dabs++;
    for (let p = 0; p < NP; p++) {
      const sx = psph[p * 4] - hx; const sy = psph[p * 4 + 1] - hy; const sz = psph[p * 4 + 2] - hz; const reach = psph[p * 4 + 3] + radius;
      if (sx * sx + sy * sy + sz * sz > reach * reach) continue;
      const L = plist[p];
      dabTexels += L.length;
      for (let k = 0; k < L.length; k++) {
        const i = L[k];
        const dx = wpos[i * 3] - hx; const dy = wpos[i * 3 + 1] - hy; const dz = wpos[i * 3 + 2] - hz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const facing = wnrm[i * 3] * vx + wnrm[i * 3 + 1] * vy + wnrm[i * 3 + 2] * vz;
        if (facing > 0.35) continue;
        let a;
        if (hard) a = d2 > r2 * 0.82 ? 0.5 : 1;
        else { const t = 1 - Math.sqrt(d2) / radius; a = Math.min(1, t * t * 1.6) * flow; }
        const o = i * 4;
        data[o] = Math.round(data[o] + (rgb[0] - data[o]) * a);
        data[o + 1] = Math.round(data[o + 1] + (rgb[1] - data[o + 1]) * a);
        data[o + 2] = Math.round(data[o + 2] + (rgb[2] - data[o + 2]) * a);
        hit++;
      }
    }
    if (hit) touch();
    return hit;
  }

  /**
   * Fill one region ('body' | 'head' | 'tail' | 'legs') or 'all'. from = [x,y,z] (world, the
   * finger's hit): the colour floods out from there over 0.28 s instead of appearing at once.
   */
  function fill(region, rgb, from = null) {
    settle();
    const parts = region === 'all' ? null : REGIONS[region];
    let rn = 0;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (parts && !parts.includes(part[i])) continue;
      const o = i * 4;
      if (from) {
        tgt[o] = rgb[0]; tgt[o + 1] = rgb[1]; tgt[o + 2] = rgb[2]; rtmp[rn++] = i;
        const dx = wpos[i * 3] - from[0]; const dy = wpos[i * 3 + 1] - from[1]; const dz = wpos[i * 3 + 2] - from[2];
        rkey[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      } else { data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; }
    }
    if (!parts) for (let i = 0; i < N; i++) if (part[i] < 0) { const o = i * 4; data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; }
    if (rn) beginReveal(rn, 'fill', REVEAL.fill.dur, REVEAL.fill.band, REVEAL.fill.glow); else touch();
  }

  /** Paint texels whose (world) normal points along `dir` with rgb (used for seeker bellies). */
  function tintFacing(dirx, diry, dirz, minDot, rgb, region = 'body') {
    settle();
    const parts = REGIONS[region];
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (parts && !parts.includes(part[i])) continue;
      const d = lnrm[i * 3] * dirx + lnrm[i * 3 + 1] * diry + lnrm[i * 3 + 2] * dirz;
      if (d < minDot) continue;
      const o = i * 4; data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2];
    }
    touch();
  }

  /**
   * Stamp: project the surface pattern under the avatar onto every texel that faces away from
   * that surface. surf = { q:[x,y,z], n:[x,y,z] (unit, out of the surface), uvAt(x,y,z,out2),
   * tile, vc:[r,g,b] 0..1, atlas, shadeAt(x,y,z) -> factor }.
   */
  function stamp(surf, wave = null) {
    settle();
    const [qx, qy, qz] = surf.q; const [nx, ny, nz] = surf.n;
    const uv = [0, 0];
    let hit = 0;
    const out = wave ? tgt : data;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const facing = wnrm[i * 3] * nx + wnrm[i * 3 + 1] * ny + wnrm[i * 3 + 2] * nz;
      if (facing < -0.25) continue;
      const px = wpos[i * 3]; const py = wpos[i * 3 + 1]; const pz = wpos[i * 3 + 2];
      const dist = (px - qx) * nx + (py - qy) * ny + (pz - qz) * nz;
      const sx = px - nx * dist; const sy = py - ny * dist; const sz = pz - nz * dist;
      surf.uvAt(sx, sy, sz, uv);
      sampleAtlas(surf.atlas, surf.tile, uv[0], uv[1], tmp);
      const sh = surf.shadeAt ? surf.shadeAt(sx, sy, sz) : 0;
      const br = surf.blobRgb || BLACK;
      const a = facing < 0 ? 1 + facing / 0.25 : 1;
      const o = i * 4;
      const r = tmp[0] * surf.vc[0] * (1 - sh) + br[0] * sh; const g = tmp[1] * surf.vc[1] * (1 - sh) + br[1] * sh; const b = tmp[2] * surf.vc[2] * (1 - sh) + br[2] * sh;
      out[o] = Math.round(data[o] + (r - data[o]) * a);
      out[o + 1] = Math.round(data[o + 1] + (g - data[o + 1]) * a);
      out[o + 2] = Math.round(data[o + 2] + (b - data[o + 2]) * a);
      if (wave) { rtmp[hit] = i; rkey[i] = px * wave[0] + py * wave[1] + pz * wave[2]; }
      hit++;
    }
    if (hit && wave) beginReveal(hit, 'stamp', REVEAL.stamp.dur, REVEAL.stamp.band, REVEAL.stamp.glow);
    else if (hit) touch();
    return hit;
  }

  /** Paint texels of one part whose local position passes fn(x, y, z) → 0..1 coverage. */
  function paintLocal(partIdx, fn, rgb) {
    settle();
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (part[i] !== partIdx) continue;
      const a = fn(lpos[i * 3], lpos[i * 3 + 1], lpos[i * 3 + 2]);
      if (a <= 0) continue;
      const o = i * 4;
      data[o] = Math.round(data[o] + (rgb[0] - data[o]) * a);
      data[o + 1] = Math.round(data[o + 1] + (rgb[1] - data[o + 1]) * a);
      data[o + 2] = Math.round(data[o + 2] + (rgb[2] - data[o + 2]) * a);
    }
    touch();
  }

  /** Colour of the body at a texel uv (for picking colours off yourself). */
  function colorAtUV(u, v, out) {
    settle();
    const x = Math.min(TEX - 1, Math.max(0, Math.floor(u * TEX))); const y = Math.min(TEX - 1, Math.max(0, Math.floor(v * TEX)));
    const o = (y * TEX + x) * 4; out[0] = data[o]; out[1] = data[o + 1]; out[2] = data[o + 2];
    return out;
  }

  /**
   * Fresh paint: texels whose colour differs from `prev` (a copy of the buffer from before an
   * update). Writes up to `max` world points (from the last updateWorld) spread over the changed
   * area into out (flat x,y,z) and returns how many texels changed.
   */
  function changedPoints(prev, out, max = 3) {
    settle();
    let n = 0;
    for (let k = 0; k < list.length; k++) {
      const o = list[k] * 4;
      if (Math.abs(prev[o] - data[o]) + Math.abs(prev[o + 1] - data[o + 1]) + Math.abs(prev[o + 2] - data[o + 2]) > 24) n++;
    }
    if (!n) return 0;
    const stride = Math.max(1, Math.floor(n / max)); let seen = 0; let w = 0;
    for (let k = 0; k < list.length && w < max; k++) {
      const i = list[k]; const o = i * 4;
      if (Math.abs(prev[o] - data[o]) + Math.abs(prev[o + 1] - data[o + 1]) + Math.abs(prev[o + 2] - data[o + 2]) <= 24) continue;
      if (seen++ % stride !== Math.floor(stride / 2)) continue;
      out[w * 3] = wpos[i * 3]; out[w * 3 + 1] = wpos[i * 3 + 1]; out[w * 3 + 2] = wpos[i * 3 + 2]; w++;
    }
    out.length = w * 3;
    return n;
  }

  /** Once a frame: advance a running reveal, upload the texture if anything changed. */
  function flush() {
    if (rv.on || xr.on) {
      const t = performance.now();
      if (rv.on) stepReveal(t);
      if (xr.on) stepXray(t);
      const ms = performance.now() - t; fxMs += ms; if (ms > fxMax) fxMax = ms; fxN++;
    }
    if (!dirty) return false;
    dirty = false;
    texture.needsUpdate = true;
    return true;
  }

  return {
    data, texture, wpos, wnrm, list,
    get version() { return version; },
    get canUndo() { return undo.length > 0; },
    get dabTexels() { return dabTexels; }, get dabs() { return dabs; }, get texels() { return list.length; },
    /** A stamp wipe / fill flood is still running (live paint waits for it to settle). */
    get revealing() { return rv.on; },
    get reveal() { return { on: rv.on, kind: rv.kind, count: rv.count, n: rv.n, done: rv.done }; },
    /** The x-ray is showing (see xray()). */
    get xraying() { return xr.on; },
    /** Perf counters: undo buffers ever allocated, reveal / x-ray frames and their cost (ms). */
    get perf() { return { snapAllocs, pool: pool.length, undo: undo.length, fxN, fxMax, fxAvg: fxN ? fxMs / fxN : 0, xray: { on: xr.on, n: xr.n, frames: xr.frames } }; },
    updateWorld, snapshot, dab, fill, stamp, tintFacing, paintLocal, colorAtUV, flush, changedPoints, settle, xray, xrayOff,
    /** Undo the last change. wave: the undone paint dissolves back over 0.2 s instead of snapping. */
    undo(wave = false) {
      settle();
      const s = undo.pop(); if (!s) return false;
      if (!wave) { data.set(s); recycle(s); touch(); return true; }
      let rn = 0;
      for (let i = 0; i < N; i++) {
        const o = i * 4;
        if (s[o] === data[o] && s[o + 1] === data[o + 1] && s[o + 2] === data[o + 2]) continue;
        tgt[o] = s[o]; tgt[o + 1] = s[o + 1]; tgt[o + 2] = s[o + 2];
        rtmp[rn++] = i; rkey[i] = ((Math.imul(i, 0x9e3779b1) >>> 0) & 1023) / 1023; // a speckled dissolve
      }
      recycle(s);
      if (rn) beginReveal(rn, 'undo', REVEAL.undo.dur, REVEAL.undo.band, REVEAL.undo.glow); else touch();
      return true;
    },
    clearUndo() { while (undo.length) recycle(undo.pop()); },
    reset(rgb = [255, 255, 255]) { rv.on = false; xrayOff(); for (let i = 0; i < N; i++) { data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255; } while (undo.length) recycle(undo.pop()); touch(); },
    hash() { settle(); return fnv(data); },
    quantize(max = 32) { settle(); const q = quantize(data, max); dirty = true; return q; },
    /** Quantise in place + encode, once per paint version (a lock right after a live update, or
     *  a re-request, reuses the blob). */
    encode() {
      settle();
      if (encVer === version && encCache) return encCache;
      encCache = encode(data, quantize(data, 32)); encVer = version; dirty = true;
      return encCache;
    },
    decode(b64) { rv.on = false; const ok = decodeInto(b64, data); touch(); return ok; },
    dispose() { xrayOff(); texture.dispose(); },
  };
}

let warmed = false;
/** Run the codec once on a busy buffer so the first real lock isn't paid in the interpreter. */
function warmCodec() {
  warmed = true;
  const d = new Uint8Array(N * 4);
  let h = 7;
  for (let i = 0; i < d.length; i++) { h = (h * 1103515245 + 12345) & 0x7fffffff; d[i] = h >> 16; }
  for (let k = 0; k < 2; k++) { const c = d.slice(); encode(c, quantize(c, 32)); encode(c); }
}

// ── quantisation (median cut over a 5-bit histogram) ─────────────────────
// Bounded work regardless of brush softness / stamp detail: one pass into a 32×32×32 histogram
// (counts + exact channel sums per bin), median cut over the occupied bins with a counting sort
// per split, palette = population-weighted mean of the real colours in each box, then a per-bin
// nearest-palette LUT. Buffers are module scratch (no garbage). Data that already has ≤ max
// exact colours keeps them exactly (so quantize is idempotent and the receiver sees the same
// pixels and checksum).
const HB = 32768;
const H_N = new Uint32Array(HB); const H_R = new Uint32Array(HB); const H_G = new Uint32Array(HB); const H_B = new Uint32Array(HB);
const H_LUT = new Uint8Array(HB);
const BINS = new Int32Array(HB); const BINS2 = new Int32Array(HB);
const PIXBIN = new Uint16Array(N);
const CNT = new Int32Array(33);
const EXACT = new Int32Array(64);
const BOX_LO = new Int32Array(64); const BOX_HI = new Int32Array(64);
const BOX_SC = new Float64Array(64); const BOX_CH = new Int8Array(64);
const chOf = (bin, ch) => (ch === 0 ? bin >> 10 : ch === 1 ? (bin >> 5) & 31 : bin & 31);

/** Score a box [lo,hi) of BINS: widest channel (bin units) × sqrt(population). */
function scoreBox(k) {
  const lo = BOX_LO[k]; const hi = BOX_HI[k];
  if (hi - lo < 2) { BOX_SC[k] = -1; return; }
  let r0 = 31; let r1 = 0; let g0 = 31; let g1 = 0; let b0 = 31; let b1 = 0; let pop = 0;
  for (let i = lo; i < hi; i++) {
    const b = BINS[i]; const r = b >> 10; const g = (b >> 5) & 31; const bl = b & 31;
    if (r < r0) r0 = r; if (r > r1) r1 = r; if (g < g0) g0 = g; if (g > g1) g1 = g; if (bl < b0) b0 = bl; if (bl > b1) b1 = bl;
    pop += H_N[b];
  }
  const rr = r1 - r0; const gr = g1 - g0; const br = b1 - b0;
  let ch = 0; let rg = rr; if (gr > rg) { rg = gr; ch = 1; } if (br > rg) { rg = br; ch = 2; }
  BOX_CH[k] = ch; BOX_SC[k] = rg > 0 ? rg * Math.sqrt(pop) : -1;
}

export function quantize(data, max = 32) {
  const n = data.length >> 2;
  // exact pass: ≤ max distinct colours → keep them as they are
  let ne = 0; let last = -1; let lastK = 0; let exact = true;
  for (let i = 0; i < data.length; i += 4) {
    const c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    if (c === last) continue;
    let k = 0; while (k < ne && EXACT[k] !== c) k++;
    if (k === ne) { if (ne >= max) { exact = false; break; } EXACT[ne++] = c; }
    last = c; lastK = k;
  }
  const idx = new Uint8Array(n);
  if (exact) {
    const pr = [];
    for (let k = 0; k < ne; k++) pr.push([(EXACT[k] >> 16) & 255, (EXACT[k] >> 8) & 255, EXACT[k] & 255]);
    last = -1;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      if (c !== last) { let k = 0; while (EXACT[k] !== c) k++; last = c; lastK = k; }
      idx[p] = lastK; data[i + 3] = 255;
    }
    return { palette: pr, idx };
  }
  // histogram
  let nb = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    if (H_N[bin] === 0) BINS[nb++] = bin;
    H_N[bin]++; H_R[bin] += r; H_G[bin] += g; H_B[bin] += b;
    PIXBIN[p] = bin;
  }
  // median cut
  let nbox = 1; BOX_LO[0] = 0; BOX_HI[0] = nb; scoreBox(0);
  while (nbox < max) {
    let bi = -1; let best = 0;
    for (let k = 0; k < nbox; k++) if (BOX_SC[k] > best) { best = BOX_SC[k]; bi = k; }
    if (bi < 0) break;
    const lo = BOX_LO[bi]; const hi = BOX_HI[bi]; const ch = BOX_CH[bi];
    // counting sort BINS[lo,hi) by channel ch (stable), via BINS2
    CNT.fill(0);
    let tot = 0;
    for (let i = lo; i < hi; i++) { CNT[chOf(BINS[i], ch) + 1]++; tot += H_N[BINS[i]]; }
    for (let v = 1; v <= 32; v++) CNT[v] += CNT[v - 1];
    for (let i = lo; i < hi; i++) { const b = BINS[i]; BINS2[lo + CNT[chOf(b, ch)]++] = b; }
    for (let i = lo; i < hi; i++) BINS[i] = BINS2[i];
    // population median, kept off the ends
    let acc = 0; let cut = lo + 1;
    for (let i = lo; i < hi; i++) { acc += H_N[BINS[i]]; if (acc * 2 >= tot) { cut = i + 1; break; } }
    if (cut >= hi) cut = hi - 1; if (cut <= lo) cut = lo + 1;
    BOX_HI[bi] = cut; BOX_LO[nbox] = cut; BOX_HI[nbox] = hi;
    scoreBox(bi); scoreBox(nbox); nbox++;
  }
  // palette: weighted means of the real colours in each box (deduped)
  const pr = [];
  for (let k = 0; k < nbox; k++) {
    let r = 0; let g = 0; let b = 0; let c = 0;
    for (let i = BOX_LO[k]; i < BOX_HI[k]; i++) { const bin = BINS[i]; r += H_R[bin]; g += H_G[bin]; b += H_B[bin]; c += H_N[bin]; }
    const cr = Math.round(r / c); const cg = Math.round(g / c); const cb = Math.round(b / c);
    let dup = false; for (const q of pr) if (q[0] === cr && q[1] === cg && q[2] === cb) { dup = true; break; }
    if (!dup) pr.push([cr, cg, cb]);
  }
  // per-bin nearest palette entry (to the bin's mean colour), then clear the histogram
  const np = pr.length;
  for (let i = 0; i < nb; i++) {
    const bin = BINS2[i] = BINS[i]; const c = H_N[bin];
    const mr = H_R[bin] / c; const mg = H_G[bin] / c; const mb = H_B[bin] / c;
    let bestD = 1e12; let bk = 0;
    for (let j = 0; j < np; j++) { const q = pr[j]; const dr = q[0] - mr; const dg = q[1] - mg; const db = q[2] - mb; const d = dr * dr * 2 + dg * dg * 4 + db * db * 3; if (d < bestD) { bestD = d; bk = j; } }
    H_LUT[bin] = bk;
    H_N[bin] = 0; H_R[bin] = 0; H_G[bin] = 0; H_B[bin] = 0;
  }
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const k = H_LUT[PIXBIN[p]]; const q = pr[k];
    idx[p] = k; data[i] = q[0]; data[i + 1] = q[1]; data[i + 2] = q[2]; data[i + 3] = 255;
  }
  return { palette: pr, idx };
}

// ── codec ──────────────────────────────────────────────────────────────
const ENC_OUT = new Uint8Array(4 + 32 * 3 + N * 2 + 16);
/**
 * Encode an RGBA buffer, quantising it in place first (≤ 32 colours). Pass the result of a
 * quantize() you just ran as `q` to skip the second pass. Returns { b64, sum, bytes }.
 */
export function encode(data, q = null) {
  const { palette, idx } = q || quantize(data, 32);
  const W = TEX; const H = TEX; const n = W * H;
  const out = ENC_OUT;
  let o = 0;
  out[o++] = 1; out[o++] = W; out[o++] = H; out[o++] = palette.length;
  for (const c of palette) { out[o++] = c[0]; out[o++] = c[1]; out[o++] = c[2]; }
  let p = 0;
  while (p < n) {
    let r = 1; while (p + r < n && idx[p + r] === idx[p] && r < 256) r++;
    let c = 0;
    if (p >= W) { while (p + c < n && idx[p + c] === idx[p + c - W] && c < 8192) c++; }
    if (c >= 2 && c >= r) {
      if (c <= 64) out[o++] = 0x80 | (c - 1);
      else { const L = c - 1; out[o++] = 0xe0 | (L >> 8); out[o++] = L & 255; }
      p += c;
    } else if (r <= 4) {
      out[o++] = (idx[p] << 2) | (r - 1); p += r;
    } else {
      out[o++] = 0xc0 | idx[p]; out[o++] = r - 1; p += r;
    }
  }
  return { b64: bytesToB64(out.subarray(0, o)), sum: fnv(data), bytes: o };
}

/** Decode into an RGBA buffer. Returns the checksum of the result (or -1 on a malformed stream). */
export function decodeInto(b64, data) {
  let bytes;
  try { bytes = b64ToBytes(b64); } catch { return -1; }
  if (bytes[0] !== 1) return -1;
  const W = bytes[1]; const H = bytes[2]; const np = bytes[3];
  if (W !== TEX || H !== TEX || np < 1 || np > 32) return -1;
  const pal = [];
  let q = 4;
  for (let i = 0; i < np; i++) { pal.push([bytes[q], bytes[q + 1], bytes[q + 2]]); q += 3; }
  const n = W * H;
  const idx = new Uint8Array(n);
  let p = 0;
  while (p < n && q < bytes.length) {
    const b = bytes[q++];
    if (b < 0x80) { const k = b >> 2; const r = (b & 3) + 1; for (let i = 0; i < r && p < n; i++) idx[p++] = k; }
    else if (b < 0xc0) { const c = (b & 0x3f) + 1; for (let i = 0; i < c && p < n; i++, p++) idx[p] = idx[p - W]; }
    else if (b < 0xe0) { const k = b & 0x1f; const r = bytes[q++] + 1; for (let i = 0; i < r && p < n; i++) idx[p++] = k; }
    else { const c = (((b & 0x1f) << 8) | bytes[q++]) + 1; for (let i = 0; i < c && p < n; i++, p++) idx[p] = idx[p - W]; }
  }
  if (p !== n) return -1;
  for (let i = 0; i < n; i++) { const c = pal[idx[i]] || pal[0]; data[i * 4] = c[0]; data[i * 4 + 1] = c[1]; data[i * 4 + 2] = c[2]; data[i * 4 + 3] = 255; }
  return fnv(data);
}
