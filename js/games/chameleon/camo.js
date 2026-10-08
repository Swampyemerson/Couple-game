// Camouflage score ("blend %") and the live camo meter shown while painting.
//
// The score is what a seeker walking round would see. A stamp copies the surface along its
// normal, so from straight in front it matches perfectly by construction; from the side every
// body texel sits in front of a DIFFERENT bit of the surface (parallax: a texel h off the wall
// seen at an angle a covers the point h·tan a away), so the pattern stops lining up. So the
// score looks from BLEND.views viewpoints `dist` m from the body's centre: one straight in front
// of the surface and four `ang` (50°) off its normal, round it (on a wall: from the left, right,
// above and below; on a floor: four sides; an eye that would be inside a wall comes forward of
// it). For a view, every body texel facing it is followed along the sight line to whatever map
// triangle is really BEHIND it (the wall it's on, or past that wall's edge the bottles, the floor,
// the far room), sampled as the renderer draws it (vertex colour × atlas tile, blob shadows
// included); a texel the map hides from that eye doesn't count. A view's
// loss mixes two things a seeker notices (weights `exact` and 1 − exact):
//   - does the pattern line up? the mean |texel − the colour right behind it|;
//   - is it the same stuff? the body's colours against the colours behind it as a whole: the
//     difference of the means plus the difference of the spreads (per channel, RMS). A stamp
//     seen from the side keeps this; a white body on wallpaper, or one flat colour on a busy
//     rug, does not.
// Texels count by how squarely they face the eye (their share of the screen). The views' losses
// average into camo = 100 × (1 − k × loss) (k = 2.8, |ΔRGB| / 765 units). Calm surfaces blend
// best; a stamp is a good start, not a finished hide (paint QA1: the old score was the stamp's
// own head-on projection, so every stamp read 98–100 %). A job runs all at once (the
// lock) or a slice per frame (the meter); each texel is scored in one view per job (texel k in
// view k mod views), so a job is one pass over the body.
//
// The meter: a riso sticker on the right edge while the paint tools are open. A tube fills to the
// score (ticks at the grade lines 50 / 75 / 90, a star at the blend-bonus line), the number counts
// toward it, the grade word changes colour, and a better grade pops a sticker with a sound
// (Spotted → Sneaky → Ghost). DOM writes only when something changes.
import { sampleAtlas } from './atlas.js';
import { blendWord } from './cards.js';

const UV = [0, 0]; const TMP = [0, 0, 0]; const ZERO = [0, 0, 0];

/** How the score looks (tests may tune it): `views` viewpoints (1 = only the stamp's own front
 *  view), `dist` m from the body's centre, `ang` rad off the surface normal for all but the
 *  first, `front` = the front view's weight (the others weigh 1), `exact` = the pattern-lines-up
 *  share of a view's loss (the rest: same colours, same busyness), `k` = loss → % scale,
 *  `lit` = how much the toon shading of each face counts (0: albedo against albedo), `backdrop` =
 *  0 to sample the plane of the surface the body is on instead of what's really behind (QA A/B). */
export const BLEND = { views: 5, dist: 2.6, ang: 0.87, front: 1, exact: 0.6, k: 2.8, lit: 0, backdrop: 1 };
/** The scene's lights as the toon shader applies them (stage.js; setBlendLights copies the real
 *  ones in): hemisphere sky / ground rgb × intensity, the sun's rgb × intensity, its direction,
 *  and the toon ramp's steps (MeshToonMaterial: step = ramp[floor((n·L × 0.5 + 0.5) × steps)]). */
export const LIGHT = { sky: [1, 0.98, 0.941], ground: [0.937, 0.89, 0.816], hemi: 0.56, sun: [1, 0.945, 0.863], sunI: 0.52, dir: [-0.3275, 0.8188, 0.4708], ramp: [0.42, 0.62, 0.84] };
/** Copy the stage's real lights (THREE.HemisphereLight, THREE.DirectionalLight) and toon ramp in. */
export function setBlendLights(hemi, sun, ramp) {
  if (hemi) { LIGHT.sky = [hemi.color.r, hemi.color.g, hemi.color.b]; LIGHT.ground = [hemi.groundColor.r, hemi.groundColor.g, hemi.groundColor.b]; LIGHT.hemi = hemi.intensity; }
  if (sun) {
    LIGHT.sun = [sun.color.r, sun.color.g, sun.color.b]; LIGHT.sunI = sun.intensity;
    const t = sun.target ? sun.target.position : { x: 0, y: 0, z: 0 };
    const dx = sun.position.x - t.x; const dy = sun.position.y - t.y; const dz = sun.position.z - t.z; const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    LIGHT.dir = [dx / L, dy / L, dz / L];
  }
  if (ramp && ramp.length) LIGHT.ramp = ramp.slice();
}
/** How bright a face with normal n renders, per channel (× its albedo), into out[o..o+2]. */
function lightOf(nx, ny, nz, out, o) {
  const H = LIGHT; const d = H.dir; const rp = H.ramp;
  const u = ny * 0.5 + 0.5; // hemisphere: ground → sky with the normal's up
  let i = Math.floor(((nx * d[0] + ny * d[1] + nz * d[2]) * 0.5 + 0.5) * rp.length);
  if (i < 0) i = 0; else if (i >= rp.length) i = rp.length - 1;
  const s = H.sunI * rp[i];
  for (let c = 0; c < 3; c++) out[o + c] = H.hemi * (H.ground[c] + (H.sky[c] - H.ground[c]) * u) + s * H.sun[c];
}
const NV_MAX = 9;
const ACC = 14; // per view: Σw, Σw·exact, Σw·body rgb, Σw·body rgb², Σw·behind rgb, Σw·behind rgb²
const G = 16; // screen bins per axis, per view (the backdrop's triangles are binned by where they land)
const NB = G * G;

/** A resumable blend-score job. */
export function createBlendJob() {
  return {
    on: false, p: null, surf: null, k: 0, n: 0, sum: 0, score: -1, steps: 0, nv: 0,
    ex: new Float64Array(NV_MAX), ey: new Float64Array(NV_MAX), ez: new Float64Array(NV_MAX), vw: new Float64Array(NV_MAX), acc: new Float64Array(NV_MAX * ACC), views: new Float64Array(NV_MAX), ls: new Float64Array(3), mu: new Float64Array(NV_MAX * 3), sd: new Float64Array(NV_MAX * 3), out: null, x: 0, bad: 0, xon: false,
    // the backdrop (paint QA1b): per view a camera frame (forward f, right r, up u, half-extent h in
    // tan units) and the gathered map triangles binned by where they land on its screen
    bd: false, gv: -1, bv: 0, cx: 0, cy: 0, cz: 0, rb: 0,
    fx: new Float64Array(NV_MAX), fy: new Float64Array(NV_MAX), fz: new Float64Array(NV_MAX), rx: new Float64Array(NV_MAX), ry: new Float64Array(NV_MAX), rz: new Float64Array(NV_MAX), ux: new Float64Array(NV_MAX), uy: new Float64Array(NV_MAX), uz: new Float64Array(NV_MAX), vh: new Float64Array(NV_MAX),
    bs: new Int32Array(NV_MAX * (NB + 1)), bi: new Int32Array(4096), bz: new Float32Array(4096), bgc: new Float64Array(3), hidden: 0, open: 0, binMs: 0, tests: 0, adopted: 0,
  };
}

// ── what is really behind a texel (paint QA1b) ───────────────────────────────────────────
// The score used to follow each sight line to the PLANE of the surface the body is stuck to and
// sample that plane's pattern there, as if the surface went on for ever: a body on a narrow fridge
// pillar (the Corner Market's camo spot) scored 97 % "Invisible!" (a plain white one 87 %) while
// the seeker saw a cream lump against rows of bottles. Now each sight line is cast against the
// map's own triangles round the body: the first triangle behind the texel is sampled (its tile,
// uv and vertex colours, as the renderer draws it); a texel with map geometry between it and the
// eye is hidden from that view (it doesn't count); a sight line that leaves the neighbourhood
// sees the room's background colour. The triangles within `rb + REACH` m of the body are gathered
// once per spot (shared by every job, in slices), then binned per view on a 16 × 16 screen grid
// so a sample tests only the few that land where it does.
const REACH = 1.6;
const GAT = { ms: 0, scanned: 0, map: null, mid: null, mn: -1, ver: 0, done: false, cx: 0, cy: 0, cz: 0, R: 0, ci: 0, ti: 0, n: 0, cap: 0, P: null, U: null, T: null, C: null, N: null };
function growGather(need) {
  if (need <= GAT.cap) return;
  const cap = Math.max(4096, Math.ceil(need * 1.5));
  const g = (old, k) => { const a = new Float32Array(cap * k); if (old) a.set(old.subarray(0, GAT.n * k)); return a; };
  GAT.P = g(GAT.P, 9); GAT.U = g(GAT.U, 6); GAT.T = g(GAT.T, 4); GAT.C = g(GAT.C, 9); GAT.N = g(GAT.N, 3); GAT.cap = cap;
}
/** Is the shared gather good for a body centred at (cx, cy, cz) of radius rb on `map`? */
function gatherFits(map, cx, cy, cz, rb) {
  return !!map && GAT.mid === map.id && GAT.mn === map.chunks.length && Math.abs(GAT.cx - cx) < 0.25 && Math.abs(GAT.cy - cy) < 0.25 && Math.abs(GAT.cz - cz) < 0.25 && GAT.R >= rb + REACH;
}
function startGather(map, cx, cy, cz, rb) {
  // (a map is known by its id and chunk count: the same triangles even if it was rebuilt)
  GAT.map = map; GAT.mid = map.id; GAT.mn = map.chunks.length; GAT.ver++; GAT.done = false; GAT.ms = 0; GAT.scanned = 0; GAT.cx = cx; GAT.cy = cy; GAT.cz = cz; GAT.R = rb + REACH + 0.25; GAT.ci = 0; GAT.ti = 0; GAT.n = 0;
}
/** Gather up to `budget` triangles' worth (Infinity: all); true when the gather is complete. */
function stepGather(budget) {
  if (GAT.done) return true;
  const t0 = performance.now();
  const r = gatherSome(budget);
  GAT.ms += performance.now() - t0;
  return r;
}
function gatherSome(budget) {
  const chunks = GAT.map.chunks; const R = GAT.R;
  const x0 = GAT.cx - R; const x1 = GAT.cx + R; const y0 = GAT.cy - R; const y1 = GAT.cy + R; const z0 = GAT.cz - R; const z1 = GAT.cz + R;
  let left = budget;
  while (GAT.ci < chunks.length) {
    const ch = chunks[GAT.ci]; const geo = ch.geometry;
    const bs = geo && geo.boundingSphere;
    if (!geo || ch.backdrop || !bs || Math.hypot(bs.center.x - GAT.cx, bs.center.y - GAT.cy, bs.center.z - GAT.cz) > bs.radius + R * 1.733) { GAT.ci++; GAT.ti = 0; continue; }
    const idx = geo.index.array; const P = geo.attributes.position.array; const U = geo.attributes.uv.array; const T = geo.attributes.tile.array; const C = geo.attributes.color.array;
    const nt = (ch.mainIndexCount || idx.length) / 3; // (the outline hulls come after: never sampled)
    let t = GAT.ti;
    const stop = Math.min(nt, t + left);
    for (; t < stop; t++) {
      const a = idx[t * 3]; const b = idx[t * 3 + 1]; const c = idx[t * 3 + 2];
      const ax = P[a * 3]; const ay = P[a * 3 + 1]; const az = P[a * 3 + 2];
      const bx = P[b * 3]; const by = P[b * 3 + 1]; const bz = P[b * 3 + 2];
      const qx = P[c * 3]; const qy = P[c * 3 + 1]; const qz = P[c * 3 + 2];
      if ((ax < x0 && bx < x0 && qx < x0) || (ax > x1 && bx > x1 && qx > x1) || (ay < y0 && by < y0 && qy < y0) || (ay > y1 && by > y1 && qy > y1) || (az < z0 && bz < z0 && qz < z0) || (az > z1 && bz > z1 && qz > z1)) continue;
      const e1x = bx - ax; const e1y = by - ay; const e1z = bz - az; const e2x = qx - ax; const e2y = qy - ay; const e2z = qz - az;
      let nx = e1y * e2z - e1z * e2y; let ny = e1z * e2x - e1x * e2z; let nz = e1x * e2y - e1y * e2x;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz); if (nl < 1e-10) continue; nx /= nl; ny /= nl; nz /= nl;
      if (GAT.n >= GAT.cap) growGather(GAT.n + 1);
      const k = GAT.n++;
      const p9 = k * 9; const GP = GAT.P; GP[p9] = ax; GP[p9 + 1] = ay; GP[p9 + 2] = az; GP[p9 + 3] = bx; GP[p9 + 4] = by; GP[p9 + 5] = bz; GP[p9 + 6] = qx; GP[p9 + 7] = qy; GP[p9 + 8] = qz;
      const GU = GAT.U; GU[k * 6] = U[a * 2]; GU[k * 6 + 1] = U[a * 2 + 1]; GU[k * 6 + 2] = U[b * 2]; GU[k * 6 + 3] = U[b * 2 + 1]; GU[k * 6 + 4] = U[c * 2]; GU[k * 6 + 5] = U[c * 2 + 1];
      const GT = GAT.T; GT[k * 4] = T[a * 4]; GT[k * 4 + 1] = T[a * 4 + 1]; GT[k * 4 + 2] = T[a * 4 + 2]; GT[k * 4 + 3] = T[a * 4 + 3];
      const GC = GAT.C; GC[p9] = C[a * 3]; GC[p9 + 1] = C[a * 3 + 1]; GC[p9 + 2] = C[a * 3 + 2]; GC[p9 + 3] = C[b * 3]; GC[p9 + 4] = C[b * 3 + 1]; GC[p9 + 5] = C[b * 3 + 2]; GC[p9 + 6] = C[c * 3]; GC[p9 + 7] = C[c * 3 + 1]; GC[p9 + 8] = C[c * 3 + 2];
      const GN = GAT.N; GN[k * 3] = nx; GN[k * 3 + 1] = ny; GN[k * 3 + 2] = nz;
    }
    left -= stop - GAT.ti; GAT.scanned += stop - GAT.ti;
    if (t < nt) { GAT.ti = t; return false; }
    GAT.ci++; GAT.ti = 0;
    if (left <= 0) break;
  }
  if (GAT.ci < chunks.length) return false;
  GAT.done = true; GAT.map = null; // (the copies are all it needs: no map kept alive after a switch or a close)
  return true;
}
let RECT = new Int16Array(4 * 4096); // per-triangle bin rectangle while binning one view
let TZ = new Float32Array(4096); // per-triangle nearest depth from the eye, while binning one view
let ORD = new Int32Array(4096); // triangles nearest first (each bin's items come out in that order)
const byDepth = (a, b) => TZ[a] - TZ[b];
/**
 * Bin the gathered triangles on view v's screen (counting pass, then filling pass, nearest
 * first): a sample walks its bin's items in depth order and stops at the first item that starts
 * beyond the best hit so far (a hit along a sight line is never nearer than that depth).
 */
function binView(J, v) {
  const n = GAT.n; const GP = GAT.P;
  if (RECT.length < n * 4) RECT = new Int16Array(Math.ceil(n * 1.5) * 4);
  if (TZ.length < n) { TZ = new Float32Array(Math.ceil(n * 1.5)); ORD = new Int32Array(TZ.length); }
  const ex = J.ex[v]; const ey = J.ey[v]; const ez = J.ez[v];
  const fx = J.fx[v]; const fy = J.fy[v]; const fz = J.fz[v]; const rx = J.rx[v]; const ry = J.ry[v]; const rz = J.rz[v]; const ux = J.ux[v]; const uy = J.uy[v]; const uz = J.uz[v];
  const h = J.vh[v]; const sc = G / (2 * h); const ZN = 0.04;
  const base = v * (NB + 1); const bs = J.bs;
  for (let b = 0; b <= NB; b++) bs[base + b] = 0;
  let total = 0;
  for (let t = 0; t < n; t++) {
    let mnx = Infinity; let mny = Infinity; let mxx = -Infinity; let mxy = -Infinity; let behind = 0; let mz = Infinity;
    const o = t * 9;
    for (let c = 0; c < 3; c++) {
      const qx = GP[o + c * 3] - ex; const qy = GP[o + c * 3 + 1] - ey; const qz = GP[o + c * 3 + 2] - ez;
      const z = qx * fx + qy * fy + qz * fz;
      if (z < mz) mz = z;
      if (z < ZN) { behind++; continue; }
      const sx = (qx * rx + qy * ry + qz * rz) / z; const sy = (qx * ux + qy * uy + qz * uz) / z;
      if (sx < mnx) mnx = sx; if (sx > mxx) mxx = sx; if (sy < mny) mny = sy; if (sy > mxy) mxy = sy;
    }
    if (behind === 3) { RECT[t * 4] = -1; continue; }
    if (behind) {
      // clipped by the eye plane: the edges' crossings bound what's in front
      for (let c = 0; c < 3; c++) {
        const a = o + c * 3; const b = o + ((c + 1) % 3) * 3;
        const za = (GP[a] - ex) * fx + (GP[a + 1] - ey) * fy + (GP[a + 2] - ez) * fz; const zb = (GP[b] - ex) * fx + (GP[b + 1] - ey) * fy + (GP[b + 2] - ez) * fz;
        if ((za < ZN) === (zb < ZN)) continue;
        const k = (ZN - za) / (zb - za);
        const qx = GP[a] + (GP[b] - GP[a]) * k - ex; const qy = GP[a + 1] + (GP[b + 1] - GP[a + 1]) * k - ey; const qz = GP[a + 2] + (GP[b + 2] - GP[a + 2]) * k - ez;
        const sx = (qx * rx + qy * ry + qz * rz) / ZN; const sy = (qx * ux + qy * uy + qz * uz) / ZN;
        if (sx < mnx) mnx = sx; if (sx > mxx) mxx = sx; if (sy < mny) mny = sy; if (sy > mxy) mxy = sy;
      }
    }
    if (mxx < -h || mnx > h || mxy < -h || mny > h) { RECT[t * 4] = -1; continue; }
    const b0x = Math.max(0, Math.min(G - 1, Math.floor((mnx + h) * sc))); const b1x = Math.max(0, Math.min(G - 1, Math.floor((mxx + h) * sc)));
    const b0y = Math.max(0, Math.min(G - 1, Math.floor((mny + h) * sc))); const b1y = Math.max(0, Math.min(G - 1, Math.floor((mxy + h) * sc)));
    RECT[t * 4] = b0x; RECT[t * 4 + 1] = b1x; RECT[t * 4 + 2] = b0y; RECT[t * 4 + 3] = b1y;
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++) bs[base + 1 + by * G + bx]++;
    total += (b1x - b0x + 1) * (b1y - b0y + 1);
    TZ[t] = mz;
  }
  // starts (absolute into J.bi: view v's items follow view v−1's)
  const off = v === 0 ? 0 : J.bs[(v - 1) * (NB + 1) + NB];
  if (J.bi.length < off + total) { const a = new Int32Array(Math.ceil((off + total) * 1.5)); a.set(J.bi.subarray(0, off)); J.bi = a; const z = new Float32Array(a.length); z.set(J.bz.subarray(0, off)); J.bz = z; }
  let run = off;
  for (let b = 0; b < NB; b++) { const c = bs[base + 1 + b]; bs[base + b] = run; run += c; }
  bs[base + NB] = run;
  // fill, nearest triangle first (bs[base + b] walks forward while filling, then is restored)
  let m = 0;
  for (let t = 0; t < n; t++) if (RECT[t * 4] >= 0) ORD[m++] = t;
  ORD.subarray(0, m).sort(byDepth);
  for (let q = 0; q < m; q++) {
    const t = ORD[q]; const z = TZ[t];
    const b0x = RECT[t * 4]; const b1x = RECT[t * 4 + 1]; const b0y = RECT[t * 4 + 2]; const b1y = RECT[t * 4 + 3];
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++) { const k = bs[base + by * G + bx]++; J.bi[k] = t; J.bz[k] = z; }
  }
  for (let b = NB - 1; b > 0; b--) bs[base + b] = bs[base + b - 1];
  bs[base] = off;
}
/** The viewpoints for paint p (texels fresh) on surf: eye positions + weights into J (no garbage). */
function placeViews(J, p, surf) {
  const list = p.list; const wpos = p.wpos;
  let cx = 0; let cy = 0; let cz = 0;
  for (let k = 0; k < list.length; k++) { const i = list[k] * 3; cx += wpos[i]; cy += wpos[i + 1]; cz += wpos[i + 2]; }
  const N = Math.max(1, list.length); cx /= N; cy /= N; cz /= N;
  let rb2 = 0;
  for (let k = 0; k < list.length; k++) { const i = list[k] * 3; const dx = wpos[i] - cx; const dy = wpos[i + 1] - cy; const dz = wpos[i + 2] - cz; const d2 = dx * dx + dy * dy + dz * dz; if (d2 > rb2) rb2 = d2; }
  const rb = Math.sqrt(rb2);
  const nx = surf.n[0]; const ny = surf.n[1]; const nz = surf.n[2];
  // tangent frame: t1 horizontal along a wall (world up × n), else world x; t2 = n × t1
  const ax = nz; const az = -nx; let al = Math.sqrt(ax * ax + az * az);
  let t1x; let t1y; let t1z;
  if (al > 0.3) { t1x = ax / al; t1y = 0; t1z = az / al; } else { t1x = 1 - nx * nx; t1y = -nx * ny; t1z = -nx * nz; al = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z) || 1; t1x /= al; t1y /= al; t1z /= al; }
  const t2x = ny * t1z - nz * t1y; const t2y = nz * t1x - nx * t1z; const t2z = nx * t1y - ny * t1x;
  const nv = Math.max(1, Math.min(NV_MAX, BLEND.views | 0)); J.nv = nv;
  const D = BLEND.dist; const ca = Math.cos(BLEND.ang); const sa = Math.sin(BLEND.ang);
  const world = J.bd ? surf.world : null;
  let moved = !(Math.abs(J.cx - cx) < 0.01 && Math.abs(J.cy - cy) < 0.01 && Math.abs(J.cz - cz) < 0.01 && Math.abs(J.rb - rb) < 0.01);
  for (let v = 0; v < nv; v++) {
    let dx = nx; let dy = ny; let dz = nz;
    if (v > 0) {
      const ph = ((v - 1) / (nv - 1)) * Math.PI * 2; const c = Math.cos(ph) * sa; const s = Math.sin(ph) * sa;
      dx = nx * ca + t1x * c + t2x * s; dy = ny * ca + t1y * c + t2y * s; dz = nz * ca + t1z * c + t2z * s;
    }
    let d = D; let w = v === 0 ? BLEND.front : 1;
    if (world) {
      // no seeker stands inside a wall: an eye behind something comes forward of it, and a view
      // with no room for a seeker (closer than half a metre) is dropped
      const H = world.raycast(cx, cy, cz, dx, dy, dz, D, null, true);
      if (H) { d = H.t - 0.08; if (d < 0.5) { w = 0; d = 0.5; } }
    }
    const ex = cx + dx * d; const ey = cy + dy * d; const ez = cz + dz * d;
    if (!(Math.abs(J.ex[v] - ex) < 0.005 && Math.abs(J.ey[v] - ey) < 0.005 && Math.abs(J.ez[v] - ez) < 0.005)) moved = true;
    J.ex[v] = ex; J.ey[v] = ey; J.ez[v] = ez; J.vw[v] = w;
    // the view's camera frame: forward at the body's centre, right = forward × world up (or x)
    const fx = -dx; const fy = -dy; const fz = -dz;
    let rx = -fz; let ry = 0; let rz = fx; let rl = Math.sqrt(rx * rx + rz * rz);
    if (rl < 0.2) { rx = 0; ry = fz; rz = -fy; rl = Math.sqrt(ry * ry + rz * rz) || 1; }
    rx /= rl; ry /= rl; rz /= rl;
    J.fx[v] = fx; J.fy[v] = fy; J.fz[v] = fz; J.rx[v] = rx; J.ry[v] = ry; J.rz[v] = rz;
    J.ux[v] = ry * fz - rz * fy; J.uy[v] = rz * fx - rx * fz; J.uz[v] = rx * fy - ry * fx;
    J.vh[v] = rb / Math.max(0.2, d - rb * 0.5) * 1.15 + 0.02;
  }
  J.cx = cx; J.cy = cy; J.cz = cz; J.rb = rb;
  lightOf(nx, ny, nz, J.ls, 0); // the surface's own shade: a texel facing another way renders lighter or darker than it
  J.acc.fill(0);
  if (J.bd) {
    if (!gatherFits(surf.map, cx, cy, cz, rb)) startGather(surf.map, cx, cy, cz, rb);
    if (moved || J.gv !== GAT.ver) { J.bv = 0; J.binMs = 0; } // new eyes or new triangles: bin again
    const bg = surf.bg || ZERO; J.bgc[0] = bg[0]; J.bgc[1] = bg[1]; J.bgc[2] = bg[2];
  }
}
/** Start scoring paint `p` (a createPaint) against `surf` (stage.surfaceOf); texels must be fresh. */
export function startBlend(J, p, surf) {
  if (p.settle) p.settle();
  J.on = true; J.p = p; J.surf = surf; J.k = 0; J.n = 0; J.sum = 0; J.score = -1; J.steps = 0; J.hidden = 0; J.open = 0; J.tests = 0;
  J.bd = !!(BLEND.backdrop && surf.map && surf.map.chunks && surf.world);
  placeViews(J, p, surf);
}
/** The backdrop ready for J's views: the gather, then each view's bins. Sliced (the meter, the
 *  x-ray), each call does one piece (≤ 30k triangles gathered, or views binned for ~2 ms) and
 *  returns false, so a frame never holds more than that; true once everything is in place. */
function prepBackdrop(J, sliced) {
  if (!gatherFits(J.surf.map, J.cx, J.cy, J.cz, J.rb)) startGather(J.surf.map, J.cx, J.cy, J.cz, J.rb); // (another spot's job took it meanwhile)
  if (!GAT.done) { const done = stepGather(sliced ? 30000 : Infinity); if (sliced || !done) return false; }
  if (J.gv !== GAT.ver) { J.gv = GAT.ver; J.bv = 0; J.binMs = 0; }
  if (J.bv < J.nv && J.bv === 0 && adoptBins(J)) return !sliced; // the meter's bins for the same eyes: the lock and the x-ray copy them
  if (J.bv < J.nv) {
    const t0 = performance.now(); let t1 = t0;
    do { binView(J, J.bv++); t1 = performance.now(); } while (J.bv < J.nv && (!sliced || t1 - t0 < 2));
    J.binMs += t1 - t0;
    if (J.bv >= J.nv) BINNED = J;
    if (sliced && (J.bv < J.nv || t1 - t0 > 1)) return false; // (quick bins: the samples start in the same slice)
  }
  return true;
}
let BINNED = null; // the job that binned last (its bins are lent to a job with the same eyes)
/** Copy the last binned job's bins into J when they were made for the same eyes on the same gather. */
function adoptBins(J) {
  const D = BINNED;
  if (!D || D === J || D.gv !== GAT.ver || D.bv < D.nv || D.nv !== J.nv || D.rb !== J.rb || D.cx !== J.cx || D.cy !== J.cy || D.cz !== J.cz) return false;
  for (let v = 0; v < J.nv; v++) if (D.ex[v] !== J.ex[v] || D.ey[v] !== J.ey[v] || D.ez[v] !== J.ez[v] || D.vh[v] !== J.vh[v]) return false;
  const total = D.bs[(D.nv - 1) * (NB + 1) + NB];
  if (J.bi.length < total) { J.bi = new Int32Array(Math.ceil(total * 1.5)); J.bz = new Float32Array(J.bi.length); }
  J.bs.set(D.bs); J.bi.set(D.bi.subarray(0, total)); J.bz.set(D.bz.subarray(0, total));
  J.bv = J.nv; J.binMs = 0; J.adopted = (J.adopted | 0) + 1;
  return true;
}
/**
 * Texel i seen from view v of job J. false when that eye can't see it (it faces away, map
 * geometry hides it, or, without a backdrop, its sight line never reaches the surface plane);
 * else SAMPLE = [|texel − the colour behind it| / 765, how squarely it faces the eye (0.1..1),
 * behind r, g, b, the texel's r, g, b as compared].
 */
const SAMPLE = new Float64Array(8);
const TILE = [0, 0, 0, 0];
function sampleView(J, p, surf, i, v) {
  if (!(J.vw[v] > 0)) return false;
  const wpos = p.wpos; const wnrm = p.wnrm;
  const px = wpos[i * 3]; const py = wpos[i * 3 + 1]; const pz = wpos[i * 3 + 2];
  const ex = J.ex[v]; const ey = J.ey[v]; const ez = J.ez[v];
  let dx = px - ex; let dy = py - ey; let dz = pz - ez;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; dx /= L; dy /= L; dz /= L;
  const cv = -(wnrm[i * 3] * dx + wnrm[i * 3 + 1] * dy + wnrm[i * 3 + 2] * dz);
  if (cv < 0.1) return false; // faces away from the eye (or edge-on: a sliver of screen)
  let r; let g; let b; let lnx; let lny; let lnz;
  const br = surf.blobRgb || ZERO; // (the stamp's fallback: black)
  if (J.bd) {
    // cast the sight line against the triangles binned where the texel lands on this view's screen
    const qx = px - ex; const qy = py - ey; const qz = pz - ez;
    const z = qx * J.fx[v] + qy * J.fy[v] + qz * J.fz[v];
    if (z < 0.04) return false;
    const h = J.vh[v]; const sx = (qx * J.rx[v] + qy * J.ry[v] + qz * J.rz[v]) / z; const sy = (qx * J.ux[v] + qy * J.uy[v] + qz * J.uz[v]) / z;
    let best = Infinity; let bt = -1; let bu = 0; let bw = 0;
    if (sx >= -h && sx <= h && sy >= -h && sy <= h) {
      const sc = G / (2 * h);
      const bx = Math.min(G - 1, Math.floor((sx + h) * sc)); const by = Math.min(G - 1, Math.floor((sy + h) * sc));
      const base = v * (NB + 1) + by * G + bx; const s0 = J.bs[base]; const s1 = J.bs[base + 1];
      const GP = GAT.P; const GN = GAT.N; const items = J.bi; const near = L - 0.015;
      const zs = J.bz;
      for (let s = s0; s < s1; s++) {
        if (zs[s] > best) break; // (items come nearest first: nothing from here on can be nearer)
        const t = items[s]; const o = t * 9; J.tests++;
        if (GN[t * 3] * dx + GN[t * 3 + 1] * dy + GN[t * 3 + 2] * dz >= 0) continue; // a back face: never drawn, see-through
        const ax = GP[o]; const ay = GP[o + 1]; const az = GP[o + 2];
        const e1x = GP[o + 3] - ax; const e1y = GP[o + 4] - ay; const e1z = GP[o + 5] - az;
        const e2x = GP[o + 6] - ax; const e2y = GP[o + 7] - ay; const e2z = GP[o + 8] - az;
        const pvx = dy * e2z - dz * e2y; const pvy = dz * e2x - dx * e2z; const pvz = dx * e2y - dy * e2x;
        const det = e1x * pvx + e1y * pvy + e1z * pvz;
        if (det > -1e-12 && det < 1e-12) continue;
        const inv = 1 / det; const tvx = ex - ax; const tvy = ey - ay; const tvz = ez - az;
        const uu = (tvx * pvx + tvy * pvy + tvz * pvz) * inv; if (uu < 0 || uu > 1) continue;
        const qvx = tvy * e1z - tvz * e1y; const qvy = tvz * e1x - tvx * e1z; const qvz = tvx * e1y - tvy * e1x;
        const vv = (dx * qvx + dy * qvy + dz * qvz) * inv; if (vv < 0 || uu + vv > 1) continue;
        const tt = (e2x * qvx + e2y * qvy + e2z * qvz) * inv;
        if (tt > 0.02 && tt < near) { J.hidden++; return false; } // the map hides this texel from this eye
        if (tt >= near && tt < best) { best = tt; bt = t; bu = uu; bw = vv; }
      }
    }
    if (bt >= 0) {
      triColor(surf, bt, bu, bw, ex + dx * best, ey + dy * best, ez + dz * best, RGB);
      r = RGB[0]; g = RGB[1]; b = RGB[2];
      lnx = GAT.N[bt * 3]; lny = GAT.N[bt * 3 + 1]; lnz = GAT.N[bt * 3 + 2];
    } else {
      // nothing within reach behind it: the far room, faded into the background colour
      r = J.bgc[0]; g = J.bgc[1]; b = J.bgc[2]; lnx = -dx; lny = -dy; lnz = -dz; J.open++;
    }
  } else {
    const nx = surf.n[0]; const ny = surf.n[1]; const nz = surf.n[2];
    const dn = dx * nx + dy * ny + dz * nz;
    if (dn > -0.1) return false; // a sight line that never reaches the surface
    const dist = (px - surf.q[0]) * nx + (py - surf.q[1]) * ny + (pz - surf.q[2]) * nz;
    const s = -dist / dn; // along the sight line, on to the surface behind the texel
    const sx = px + dx * s; const sy = py + dy * s; const sz = pz + dz * s;
    surf.uvAt(sx, sy, sz, UV);
    sampleAtlas(surf.atlas, surf.tile, UV[0], UV[1], TMP);
    const sh = surf.shadeAt ? surf.shadeAt(sx, sy, sz) : 0;
    const vc = surf.vc;
    r = TMP[0] * vc[0] * (1 - sh) + br[0] * sh; g = TMP[1] * vc[1] * (1 - sh) + br[1] * sh; b = TMP[2] * vc[2] * (1 - sh) + br[2] * sh;
    lnx = nx; lny = ny; lnz = nz;
  }
  const data = p.data; const o = i * 4;
  // the texel as it renders next to what's behind it: its albedo × (its shade / that face's shade)
  let tr = data[o]; let tg = data[o + 1]; let tb = data[o + 2];
  const lit = BLEND.lit;
  if (lit > 0) {
    lightOf(wnrm[i * 3], wnrm[i * 3 + 1], wnrm[i * 3 + 2], LT, 0); lightOf(lnx, lny, lnz, LT, 3);
    tr *= 1 + lit * (LT[0] / LT[3] - 1); tg *= 1 + lit * (LT[1] / LT[4] - 1); tb *= 1 + lit * (LT[2] / LT[5] - 1);
  }
  SAMPLE[0] = (Math.abs(tr - r) + Math.abs(tg - g) + Math.abs(tb - b)) / 765;
  SAMPLE[1] = cv; SAMPLE[2] = r; SAMPLE[3] = g; SAMPLE[4] = b; SAMPLE[5] = tr; SAMPLE[6] = tg; SAMPLE[7] = tb;
  return true;
}
const LT = new Float64Array(6);
const RGB = new Float64Array(3);
/** The colour gathered triangle t shows at barycentric (bu, bw), world point h (as the renderer
 *  draws it: atlas tile × interpolated vertex colour, blob shadow over it) into out. */
function triColor(surf, t, bu, bw, hx, hy, hz, out) {
  const GU = GAT.U; const GC = GAT.C; const o6 = t * 6; const o9 = t * 9; const w0 = 1 - bu - bw;
  TILE[0] = GAT.T[t * 4]; TILE[1] = GAT.T[t * 4 + 1]; TILE[2] = GAT.T[t * 4 + 2]; TILE[3] = GAT.T[t * 4 + 3];
  sampleAtlas(surf.atlas, TILE, w0 * GU[o6] + bu * GU[o6 + 2] + bw * GU[o6 + 4], w0 * GU[o6 + 1] + bu * GU[o6 + 3] + bw * GU[o6 + 5], TMP);
  const sh = surf.shadeAt ? surf.shadeAt(hx, hy, hz) : 0; const br = surf.blobRgb || ZERO;
  out[0] = TMP[0] * (w0 * GC[o9] + bu * GC[o9 + 3] + bw * GC[o9 + 6]) * (1 - sh) + br[0] * sh;
  out[1] = TMP[1] * (w0 * GC[o9 + 1] + bu * GC[o9 + 4] + bw * GC[o9 + 7]) * (1 - sh) + br[1] * sh;
  out[2] = TMP[2] * (w0 * GC[o9 + 2] + bu * GC[o9 + 5] + bw * GC[o9 + 8]) * (1 - sh) + br[2] * sh;
}

// ── the stamp's own projection (paint QA1b) ────────────────────────────────────────────────
// The stamp used to copy the hit triangle's tile and colour onto every texel along the surface's
// normal, as if that triangle went on for ever: a body bigger than a pillar, or hanging over the
// edge of the dado, came out all one surface. Now each texel takes what is really behind it along
// −normal (the same gathered triangles, binned once per stamp on a 16 × 16 grid across the
// body), so head-on a stamp is exact wherever it is: the bottles beside the pillar, the green
// below the dado line. Texels with nothing behind them within reach keep the old projection.
const SB = { bs: new Int32Array(NB + 1), bi: new Int32Array(4096), cx: 0, cy: 0, cz: 0, nx: 0, ny: 0, nz: 0, t1: [0, 0, 0], t2: [0, 0, 0], h: 1, surf: null, p: null, hits: 0, miss: 0, ms: 0 };
/**
 * A sampler for paint p's stamp on surf, or null (no map triangles to cast at): at(i, out) puts
 * the colour behind texel i (along −surf.n) into out[0..2] and returns true, or returns false.
 * Gathers the triangles round the body (shared with the score) and bins them, all at once.
 */
export function stampSampler(surf, p) {
  if (!BLEND.backdrop || !surf || !surf.map || !surf.map.chunks || !p) return null;
  const t0 = performance.now();
  if (p.settle) p.settle();
  const list = p.list; const wpos = p.wpos;
  let cx = 0; let cy = 0; let cz = 0;
  for (let k = 0; k < list.length; k++) { const i = list[k] * 3; cx += wpos[i]; cy += wpos[i + 1]; cz += wpos[i + 2]; }
  const N = Math.max(1, list.length); cx /= N; cy /= N; cz /= N;
  let rb2 = 0;
  for (let k = 0; k < list.length; k++) { const i = list[k] * 3; const dx = wpos[i] - cx; const dy = wpos[i + 1] - cy; const dz = wpos[i + 2] - cz; const d2 = dx * dx + dy * dy + dz * dz; if (d2 > rb2) rb2 = d2; }
  const rb = Math.sqrt(rb2);
  if (!gatherFits(surf.map, cx, cy, cz, rb)) startGather(surf.map, cx, cy, cz, rb);
  stepGather(Infinity);
  const nx = surf.n[0]; const ny = surf.n[1]; const nz = surf.n[2];
  const ax = nz; const az = -nx; let al = Math.sqrt(ax * ax + az * az);
  let t1x; let t1y; let t1z;
  if (al > 0.3) { t1x = ax / al; t1y = 0; t1z = az / al; } else { t1x = 1 - nx * nx; t1y = -nx * ny; t1z = -nx * nz; al = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z) || 1; t1x /= al; t1y /= al; t1z /= al; }
  const t2x = ny * t1z - nz * t1y; const t2y = nz * t1x - nx * t1z; const t2z = nx * t1y - ny * t1x;
  SB.cx = cx; SB.cy = cy; SB.cz = cz; SB.nx = nx; SB.ny = ny; SB.nz = nz; SB.h = rb * 1.05 + 0.02; SB.surf = surf; SB.p = p; SB.hits = 0; SB.miss = 0;
  SB.t1[0] = t1x; SB.t1[1] = t1y; SB.t1[2] = t1z; SB.t2[0] = t2x; SB.t2[1] = t2y; SB.t2[2] = t2z;
  // orthographic bins across the body: a triangle lands where it projects along the normal
  const n = GAT.n; const GP = GAT.P; const GN = GAT.N; const h = SB.h; const sc = G / (2 * h); const bs = SB.bs;
  if (RECT.length < n * 4) RECT = new Int16Array(Math.ceil(n * 1.5) * 4);
  bs.fill(0);
  let total = 0;
  for (let t = 0; t < n; t++) {
    RECT[t * 4] = -1;
    if (GN[t * 3] * nx + GN[t * 3 + 1] * ny + GN[t * 3 + 2] * nz <= 0) continue; // faces away from a ray going −n
    let mnx = Infinity; let mny = Infinity; let mxx = -Infinity; let mxy = -Infinity; const o = t * 9;
    for (let c = 0; c < 3; c++) {
      const qx = GP[o + c * 3] - cx; const qy = GP[o + c * 3 + 1] - cy; const qz = GP[o + c * 3 + 2] - cz;
      const sx = qx * t1x + qy * t1y + qz * t1z; const sy = qx * t2x + qy * t2y + qz * t2z;
      if (sx < mnx) mnx = sx; if (sx > mxx) mxx = sx; if (sy < mny) mny = sy; if (sy > mxy) mxy = sy;
    }
    if (mxx < -h || mnx > h || mxy < -h || mny > h) continue;
    const b0x = Math.max(0, Math.min(G - 1, Math.floor((mnx + h) * sc))); const b1x = Math.max(0, Math.min(G - 1, Math.floor((mxx + h) * sc)));
    const b0y = Math.max(0, Math.min(G - 1, Math.floor((mny + h) * sc))); const b1y = Math.max(0, Math.min(G - 1, Math.floor((mxy + h) * sc)));
    RECT[t * 4] = b0x; RECT[t * 4 + 1] = b1x; RECT[t * 4 + 2] = b0y; RECT[t * 4 + 3] = b1y;
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++) bs[1 + by * G + bx]++;
    total += (b1x - b0x + 1) * (b1y - b0y + 1);
  }
  if (SB.bi.length < total) SB.bi = new Int32Array(Math.ceil(total * 1.5));
  let run = 0;
  for (let b = 0; b < NB; b++) { const c = bs[1 + b]; bs[b] = run; run += c; }
  bs[NB] = run;
  for (let t = 0; t < n; t++) {
    const b0x = RECT[t * 4]; if (b0x < 0) continue;
    const b1x = RECT[t * 4 + 1]; const b0y = RECT[t * 4 + 2]; const b1y = RECT[t * 4 + 3];
    for (let by = b0y; by <= b1y; by++) for (let bx = b0x; bx <= b1x; bx++) SB.bi[bs[by * G + bx]++] = t;
  }
  for (let b = NB - 1; b > 0; b--) bs[b] = bs[b - 1];
  bs[0] = 0;
  SB.ms = performance.now() - t0;
  return STAMPER;
}
const STAMPER = {
  get stats() { return { hits: SB.hits, miss: SB.miss, ms: SB.ms, tris: GAT.n }; },
  /** The stamp is done: drop the paint and surface it held. */
  release() { SB.surf = null; SB.p = null; },
  /** The colour behind texel i of the stamped paint, along −normal, into out; false: nothing there. */
  at(i, out) {
    const wpos = SB.p.wpos; const nx = SB.nx; const ny = SB.ny; const nz = SB.nz;
    // from just off the body's skin (a texel pressed a little into the wall still finds it)
    const ox = wpos[i * 3] + nx * 0.04; const oy = wpos[i * 3 + 1] + ny * 0.04; const oz = wpos[i * 3 + 2] + nz * 0.04;
    const qx = ox - SB.cx; const qy = oy - SB.cy; const qz = oz - SB.cz; const h = SB.h;
    const sx = qx * SB.t1[0] + qy * SB.t1[1] + qz * SB.t1[2]; const sy = qx * SB.t2[0] + qy * SB.t2[1] + qz * SB.t2[2];
    if (sx < -h || sx > h || sy < -h || sy > h) { SB.miss++; return false; }
    const sc = G / (2 * h);
    const bx = Math.min(G - 1, Math.floor((sx + h) * sc)); const by = Math.min(G - 1, Math.floor((sy + h) * sc));
    const s0 = SB.bs[by * G + bx]; const s1 = SB.bs[by * G + bx + 1];
    const GP = GAT.P; const items = SB.bi; const dx = -nx; const dy = -ny; const dz = -nz;
    let best = Infinity; let bt = -1; let bu = 0; let bw = 0;
    for (let s = s0; s < s1; s++) {
      const t = items[s]; const o = t * 9;
      const ax = GP[o]; const ay = GP[o + 1]; const az = GP[o + 2];
      const e1x = GP[o + 3] - ax; const e1y = GP[o + 4] - ay; const e1z = GP[o + 5] - az;
      const e2x = GP[o + 6] - ax; const e2y = GP[o + 7] - ay; const e2z = GP[o + 8] - az;
      const pvx = dy * e2z - dz * e2y; const pvy = dz * e2x - dx * e2z; const pvz = dx * e2y - dy * e2x;
      const det = e1x * pvx + e1y * pvy + e1z * pvz;
      if (det > -1e-12 && det < 1e-12) continue;
      const inv = 1 / det; const tvx = ox - ax; const tvy = oy - ay; const tvz = oz - az;
      const uu = (tvx * pvx + tvy * pvy + tvz * pvz) * inv; if (uu < 0 || uu > 1) continue;
      const qvx = tvy * e1z - tvz * e1y; const qvy = tvz * e1x - tvx * e1z; const qvz = tvx * e1y - tvy * e1x;
      const vv = (dx * qvx + dy * qvy + dz * qvz) * inv; if (vv < 0 || uu + vv > 1) continue;
      const tt = (e2x * qvx + e2y * qvy + e2z * qvz) * inv;
      if (tt >= 0 && tt < best) { best = tt; bt = t; bu = uu; bw = vv; }
    }
    if (bt < 0) { SB.miss++; return false; }
    triColor(SB.surf, bt, bu, bw, ox + dx * best, oy + dy * best, oz + dz * best, out);
    SB.hits++;
    return true;
  },
};
/** Fold view v's sums into J.views[v] (its own %), J.mu / J.sd (the colours behind, for the
 *  x-ray); returns the view's loss (−1: it saw nothing). */
function viewLoss(J, v) {
  const a = J.acc; const o = v * ACC; const W = a[o];
  if (!(W > 0)) { J.views[v] = -1; return -1; }
  let stat = 0;
  for (let c = 0; c < 3; c++) {
    const mb = a[o + 2 + c] / W; const sb = Math.sqrt(Math.max(0, a[o + 5 + c] / W - mb * mb));
    const mg = a[o + 8 + c] / W; const sg = Math.sqrt(Math.max(0, a[o + 11 + c] / W - mg * mg));
    stat += Math.abs(mb - mg) + Math.abs(sb - sg);
    J.mu[v * 3 + c] = mg; J.sd[v * 3 + c] = sg;
  }
  const ex = BLEND.exact;
  const loss = ex * (a[o + 1] / W) + (1 - ex) * (stat / 765);
  J.views[v] = Math.round(Math.min(100, Math.max(0, 100 * (1 - BLEND.k * loss))));
  return loss;
}
/** Score up to `budget` texel samples; true (and J.score set) when the job is finished. */
export function stepBlend(J, budget = 1e9) {
  if (!J.on) return true;
  if (J.bd) {
    if (J.gv !== GAT.ver && J.k > 0) { J.k = 0; J.n = 0; J.acc.fill(0); J.hidden = 0; J.open = 0; } // another spot's gather came in between: start over
    if (!prepBackdrop(J, budget < 1e9)) return false;
  }
  const p = J.p; const surf = J.surf; const list = p.list; const nv = J.nv; const a = J.acc;
  const end = Math.min(list.length, J.k + budget * 2); // ~half of the texels face any one eye
  let k = J.k; let n = J.n; let v = k % nv;
  for (; k < end; k++) {
    const i = list[k];
    if (sampleView(J, p, surf, i, v)) {
      const w = SAMPLE[1]; const o = v * ACC;
      const tr = SAMPLE[5]; const tg = SAMPLE[6]; const tb = SAMPLE[7]; const r = SAMPLE[2]; const g = SAMPLE[3]; const b = SAMPLE[4];
      a[o] += w; a[o + 1] += w * SAMPLE[0];
      a[o + 2] += w * tr; a[o + 3] += w * tg; a[o + 4] += w * tb; a[o + 5] += w * tr * tr; a[o + 6] += w * tg * tg; a[o + 7] += w * tb * tb;
      a[o + 8] += w * r; a[o + 9] += w * g; a[o + 10] += w * b; a[o + 11] += w * r * r; a[o + 12] += w * g * g; a[o + 13] += w * b * b;
      n++;
    }
    if (++v === nv) v = 0;
  }
  J.k = k; J.n = n; J.steps++;
  if (k < list.length) return false;
  J.on = false;
  let loss = 0; let wsum = 0;
  for (let u = 0; u < nv; u++) { const l = viewLoss(J, u); if (l >= 0) { loss += J.vw[u] * l; wsum += J.vw[u]; } }
  J.sum = wsum > 0 ? loss / wsum : 0;
  J.score = wsum > 0 ? Math.round(Math.min(100, Math.max(0, 100 * (1 - BLEND.k * J.sum)))) : -1;
  return true;
}
/** Tests / perf: forget the gathered triangles (the next score gathers them again, as a cold lock would). */
export function dropBackdrop() { GAT.map = null; GAT.mid = null; GAT.mn = -1; GAT.done = false; GAT.ver++; }
/** The game closed: let the gathered triangles and bins go. */
export function releaseBackdrop() {
  dropBackdrop(); GAT.P = GAT.U = GAT.T = GAT.C = GAT.N = null; GAT.cap = 0; GAT.n = 0;
  SB.bi = new Int32Array(4096); SB.surf = null; SB.p = null; RECT = new Int16Array(4 * 4096); BINNED = null;
}
/** Tests / perf: what job J's last pass saw (gathered triangles, texels hidden by the map, sight
 *  lines that reached nothing, each eye's distance; 0 = dropped). */
export function blendDiag(J) {
  const eyes = [];
  for (let v = 0; v < J.nv; v++) eyes.push(J.vw[v] > 0 ? Math.round(Math.hypot(J.ex[v] - J.cx, J.ey[v] - J.cy, J.ez[v] - J.cz) * 100) / 100 : 0);
  return { backdrop: J.bd, tris: GAT.n, scanned: GAT.scanned, gatherMs: Math.round(GAT.ms * 10) / 10, binMs: Math.round(J.binMs * 10) / 10, gathers: GAT.ver, hidden: J.hidden, open: J.open, samples: J.n, tests: J.tests, adopted: J.adopted | 0, eyes, items: J.nv ? J.bs[(J.nv - 1) * (NB + 1) + NB] : 0 };
}
/** Tests: view v's samples for every `step`-th texel of a finished job: texel rgb, what's behind
 *  with the backdrop (its rgb) and the old plane sample (rgb), and the face normal it hit. */
export function blendProbe(J, v, step = 25) {
  const out = []; const p = J.p; const surf = J.surf; const list = p.list; const bd = J.bd;
  for (let k = 0; k < list.length; k += step) {
    const i = list[k];
    J.bd = bd; const okB = sampleView(J, p, surf, i, v); const b = Array.from(SAMPLE);
    J.bd = false; const okP = sampleView(J, p, surf, i, v); const q = Array.from(SAMPLE);
    J.bd = bd;
    out.push({ okB, okP, tex: b.slice(5, 8).map(Math.round), back: okB ? b.slice(2, 5).map(Math.round) : null, plane: okP ? q.slice(2, 5).map(Math.round) : null });
  }
  return out;
}
/** The whole score at once (the lock). */
export function scoreBlend(p, surf, J = createBlendJob()) {
  startBlend(J, p, surf); stepBlend(J); return J.score;
}
/**
 * The x-ray's error map: for EVERY mapped texel, how much it shows against `surf` across the
 * score's views that see it (weighted as in the score): the exact part as scored, the "same
 * stuff" part as how far its colour lies outside the spread of the colours behind it in that
 * view. 0 = a perfect match … 255 = scores nothing; a texel no view sees (the side pressed
 * against the surface) is 0. out: Uint8Array(texels); J.bad = how many texels lose > 25 %.
 * Resumable (a tap never blocks a frame): startErrorMap, then stepErrorMap(J, ms) once a frame
 * until it returns true. It needs each view's colours behind: `from`, a finished score job for
 * the same paint version and spot (the meter's), lends them; else a score pass runs first.
 */
export function startErrorMap(J, p, surf, out, from = null) {
  if (from && !from.on && from.p === p && from.surf === surf && from.score >= 0) {
    if (p.settle) p.settle();
    J.p = p; J.surf = surf; J.on = false; J.nv = from.nv; J.score = from.score;
    J.ex.set(from.ex); J.ey.set(from.ey); J.ez.set(from.ez); J.vw.set(from.vw); J.mu.set(from.mu); J.sd.set(from.sd); J.views.set(from.views); J.ls.set(from.ls);
    J.bd = from.bd; J.gv = -1; J.bv = 0; J.bgc.set(from.bgc); J.cx = from.cx; J.cy = from.cy; J.cz = from.cz; J.rb = from.rb;
    for (const k of ['fx', 'fy', 'fz', 'rx', 'ry', 'rz', 'ux', 'uy', 'uz', 'vh']) J[k].set(from[k]);
    if (J.bd && from.gv !== GAT.ver) startBlend(J, p, surf); // the triangles it was scored on are gone: score again
  } else startBlend(J, p, surf);
  J.out = out; J.x = 0; J.bad = 0; J.xon = true;
}
/** Run the error map for about `ms` milliseconds (Infinity: to the end); true when it's done. */
export function stepErrorMap(J, ms = Infinity) {
  if (!J.xon) return true;
  const t0 = performance.now();
  if (J.on && !stepBlend(J, ms === Infinity ? 1e9 : 1500)) return false; // the score pass first (each view's colours behind)
  if (J.bd && (J.bv < J.nv || J.gv !== GAT.ver)) { const done = prepBackdrop(J, ms !== Infinity); if (!done || ms !== Infinity) return false; } // a lent score: this job's own bins (a slice of their own); again if the triangles changed
  const p = J.p; const surf = J.surf; const out = J.out;
  const list = p.list; const nv = J.nv; const K = BLEND.k; const ex = BLEND.exact;
  let k = J.x; let bad = J.bad;
  while (k < list.length) {
    const end = Math.min(list.length, k + 64);
    for (; k < end; k++) {
      const i = list[k];
      let ls = 0; let ws = 0;
      for (let v = 0; v < nv; v++) {
        if (!sampleView(J, p, surf, i, v)) continue;
        let st = 0;
        for (let c = 0; c < 3; c++) { const d = Math.abs(SAMPLE[5 + c] - J.mu[v * 3 + c]) - J.sd[v * 3 + c]; if (d > 0) st += d; }
        const w = J.vw[v] * SAMPLE[1];
        ls += (ex * SAMPLE[0] + (1 - ex) * (st / 765)) * w; ws += w;
      }
      if (!ws) { out[i] = 0; continue; }
      const loss = Math.min(1, K * (ls / ws));
      out[i] = (loss * 255) | 0;
      if (loss > 0.25) bad++;
    }
    if (performance.now() - t0 >= ms) break;
  }
  J.x = k; J.bad = bad;
  if (k < list.length) return false;
  J.xon = false;
  return true;
}
/** The whole error map at once; returns how many texels lose > 25 %. */
export function errorMap(p, surf, out, J = XJ) {
  startErrorMap(J, p, surf, out); stepErrorMap(J); return J.bad;
}
const XJ = createBlendJob();

/** Grade index: 0 Sore thumb, 1 Spotted, 2 Sneaky, 3 Ghost. */
export const gradeOf = (b) => (b >= 90 ? 3 : b >= 75 ? 2 : b >= 50 ? 1 : 0);
const GRADE_CLS = ['g0', 'g1', 'g2', 'g3'];
const GRADE_SND = [null, 'pose', 'good', 'unlock'];
/** The meter's "Invisible!" line (above Ghost's 90). 95 since the score looks from the side too
 *  (paint QA1): a stamp on a calm wall reads ~90-95, on the old head-on-only score it was ~98-100. */
export const INVISIBLE = 95;

const METER_CSS = `
.chm-meter { position: absolute; right: calc(8px + var(--chm-sr)); top: calc(184px + var(--chm-st)); width: 56px; padding: 5px 0 5px; margin: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: auto; z-index: 1; transform-origin: 100% 50%; animation: cm-in .28s cubic-bezier(.34,1.56,.64,1) both; font: inherit; color: var(--g-ink); cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.chm-meter:focus-visible { outline: 3px solid var(--g-hl); outline-offset: 2px; }
.chm-meter .cm-chk { display: inline-flex; align-items: center; gap: 2px; padding: 2px 5px 2px 4px; border: 1.5px solid var(--g-ink); border-radius: 999px; font: 900 0.5rem/1 var(--g-font-body); letter-spacing: .06em; text-transform: uppercase; background: var(--g-card); }
.chm-meter .cm-chk svg { width: 8px; height: 8px; flex: none; }
.chm-meter.xray .cm-chk { background: repeating-linear-gradient(135deg, #ffd014 0 4px, #fff1a8 4px 8px); background-size: 11.3px 11.3px; color: #1a1820; animation: cm-hatch .45s linear infinite; }
.chm-meter.xray.clear .cm-chk { background: var(--g-good); color: var(--g-on-signal, #fff); animation: none; }
.chm-meter .cm-tube.flash { animation: cm-tube .5s ease-out; }
.chm-meter .cm-pop.inv { background: linear-gradient(100deg, var(--g-good) 0 38%, #fff 50%, var(--g-good) 62% 100%) 0 0 / 300% 100%; color: var(--g-on-signal, #fff); font-size: 1.05rem; }
.chm-meter .cm-pop.inv.go { animation: cm-pop 1.5s cubic-bezier(.2,.9,.3,1) both, cm-shine 1.1s .15s linear; }
@keyframes cm-hatch { to { background-position: 11.3px 0; } }
@media (prefers-reduced-motion: reduce) { .chm-meter.xray .cm-chk, .chm-meter .cm-tube.flash { animation: none; } }
@keyframes cm-tube { 30% { transform: scale(1.1); box-shadow: 0 0 0 4px var(--g-hl); } }
@keyframes cm-shine { from { background-position: 100% 0; } to { background-position: 0 0; } }
.chm-meter .cm-cap { font: 900 0.56rem/1 var(--g-font-body); letter-spacing: .1em; text-transform: uppercase; color: var(--g-muted, var(--g-ink)); }
.chm-meter .cm-num { font: 900 1.12rem/1 var(--g-font-display); font-variant-numeric: tabular-nums; color: var(--g-ink); display: inline-block; }
.chm-meter .cm-num small { font-size: 0.55em; margin-left: 1px; }
.chm-meter .cm-num.bump { animation: cm-bump .32s ease-out; }
.chm-meter .cm-tube { position: relative; width: 22px; height: 148px; border: 2.5px solid var(--g-ink); border-radius: 12px; overflow: hidden; background: var(--g-halftone) 0 0 / 5px 5px, var(--g-bg); }
.chm-meter .cm-fill { position: absolute; left: 0; right: 0; bottom: 0; height: 100%; transform-origin: 50% 100%; transform: scaleY(0); transition: transform .55s cubic-bezier(.34,1.45,.64,1), background-color .3s; background: var(--g-bad); }
.chm-meter.g1 .cm-fill { background: var(--g-hl); }
.chm-meter.g2 .cm-fill { background: var(--chm-me); }
.chm-meter.g3 .cm-fill { background: var(--g-good); }
.chm-meter.g3 .cm-fill::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 0 35%, rgb(255 255 255 / .55) 50%, transparent 65% 100%) 0 0 / 100% 300%; animation: cm-sheen 1.6s linear infinite; }
.chm-meter .cm-tick { position: absolute; left: 0; width: 7px; height: 2px; background: var(--g-ink); margin-bottom: -1px; text-decoration: none; }
.chm-meter .cm-col { position: relative; }
.chm-meter .cm-star { pointer-events: none; position: absolute; right: calc(100% + 1px); transform: translateY(50%); font: 900 0.9rem/1 var(--g-font-body); color: var(--g-card); -webkit-text-stroke: 1.4px var(--g-ink); }
.chm-meter.bonus .cm-star { color: var(--g-hl); animation: cm-star .45s ease-out; }
.chm-meter .cm-starline { position: absolute; left: 0; right: 0; height: 0; border-top: 2px dashed var(--g-ink); margin-bottom: -1px; opacity: .7; }
.chm-meter .cm-word { font: 900 0.6rem/1.05 var(--g-font-body); text-transform: uppercase; letter-spacing: .03em; text-align: center; min-height: 2.1em; display: grid; place-items: center; padding: 0 3px; font-style: normal; }
.chm-meter .cm-word.pop { animation: cm-bump .4s ease-out; }
.chm-meter .cm-pop { pointer-events: none; position: absolute; right: calc(100% + 10px); top: 46%; padding: 5px 9px; border: 2.5px solid var(--g-ink); border-radius: 10px; background: var(--g-good); color: var(--g-on-signal, #fff); font: 900 0.95rem/1 var(--g-font-display); white-space: nowrap; box-shadow: 3px 3px 0 var(--g-edge); opacity: 0; transform-origin: 100% 50%; }
.chm-meter .cm-pop.g1 { background: var(--g-hl); color: var(--g-on-ink, #18171d); }
.chm-meter .cm-pop.g2 { background: var(--chm-me); color: var(--g-on-ink, #18171d); }
.chm-meter .cm-pop.go { animation: cm-pop 1.25s cubic-bezier(.2,.9,.3,1) both; }
@keyframes cm-in { from { opacity: 0; transform: translateX(14px) scale(.9); } }
@keyframes cm-bump { 35% { transform: scale(1.28); } 70% { transform: scale(.94); } }
@keyframes cm-star { 35% { transform: translateY(50%) scale(1.5) rotate(20deg); } 70% { transform: translateY(50%) scale(.9); } }
@keyframes cm-pop { 0% { opacity: 0; transform: scale(.4) rotate(-14deg); } 18% { opacity: 1; transform: scale(1.12) rotate(-6deg); } 30% { transform: scale(1) rotate(-6deg); } 80% { opacity: 1; transform: scale(1) rotate(-6deg); } 100% { opacity: 0; transform: translateY(-14px) scale(.96) rotate(-6deg); } }
@keyframes cm-sheen { from { background-position: 0 100%; } to { background-position: 0 -200%; } }
@media (max-height: 500px) { .chm-meter { top: calc(64px + var(--chm-st)); } .chm-meter .cm-tube { height: 116px; } }
@media (max-height: 700px) and (min-height: 501px) { .chm-meter .cm-tube { height: 128px; } }
`;

/**
 * The meter. host: the HUD element to live in. play(name): sound hook. Returns
 * { show(on), set(score, bonusAt, bonusPts), tick(tSec), reset(), value, shown, el }.
 */
export function createMeter(host, { play = () => {} } = {}) {
  const doc = host.ownerDocument;
  const style = doc.createElement('style'); style.textContent = METER_CSS;
  // a button: tapping it x-rays the body (game.js 'xray' → paint.xray): the bits that show flash
  const el = doc.createElement('button');
  el.type = 'button'; el.dataset.act = 'xray';
  el.className = 'chm-meter chm-sticker'; el.hidden = true;
  el.setAttribute('aria-label', 'Camo meter: tap to see where you show');
  el.innerHTML = '<span class="cm-cap">Camo</span><b class="cm-num">--</b>'
    + '<div class="cm-col"><div class="cm-tube"><i class="cm-fill"></i><s class="cm-tick" style="bottom:50%"></s><s class="cm-tick" style="bottom:75%"></s><s class="cm-tick" style="bottom:90%"></s><i class="cm-starline" hidden></i></div><span class="cm-star" hidden>★</span></div>'
    + '<em class="cm-word" aria-live="polite"></em>'
    + '<span class="cm-chk"><svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="4" cy="4" r="2.9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6.2 6.2 9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span class="cm-chkt">Check</span></span>'
    + '<span class="cm-pop"></span>';
  host.appendChild(style); host.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const num = $('.cm-num'); const fill = $('.cm-fill'); const word = $('.cm-word'); const pop = $('.cm-pop');
  const star = $('.cm-star'); const starLine = $('.cm-starline'); const chk = $('.cm-chkt'); const tube = $('.cm-tube');
  const M = { shown: false, target: -1, from: 0, val: -1, shownVal: -2, t0: 0, tNow: 0, grade: -1, first: true, bonusAt: -1, bonusPts: 0, bonusOn: false, sounds: 0, pops: 0, inv: false, xray: false, lastPop: '' };
  const DUR = 0.55;
  function writeNum(v) {
    if (v === M.shownVal) return;
    M.shownVal = v;
    num.innerHTML = v < 0 ? '--' : `${v}<small>%</small>`;
  }
  function popSticker(text, cls) {
    pop.className = `cm-pop ${cls}`; pop.textContent = text; void pop.offsetWidth; pop.classList.add('go'); M.pops++; M.lastPop = text;
    tube.classList.remove('flash'); void tube.offsetWidth; tube.classList.add('flash');
  }
  return {
    el,
    get value() { return M.target; },
    get shown() { return M.shown; },
    get stats() { return { target: M.target, grade: M.grade, sounds: M.sounds, pops: M.pops, lastPop: M.lastPop, bonusOn: M.bonusOn, inv: M.inv, xray: M.xray, check: chk.textContent, text: num.textContent, word: word.textContent }; },
    /** The x-ray is showing (bad = texels that show): the Check pill hatches ("Shows") or goes green ("Clear"). */
    xray(on, bad = 0) {
      if (on === M.xray && (!on || el.classList.contains('clear') === !bad) && chk.textContent !== '…') return;
      M.xray = on;
      el.classList.toggle('xray', on); el.classList.toggle('clear', on && !bad);
      chk.textContent = !on ? 'Check' : bad ? 'Shows' : 'Clear';
    },
    /** The x-ray is being worked out (a few frames): the pill reads "…". */
    checking(on) { if (on) chk.textContent = '…'; else if (chk.textContent === '…') chk.textContent = M.xray ? (el.classList.contains('clear') ? 'Clear' : 'Shows') : 'Check'; },
    show(on) {
      if (on === M.shown) return;
      M.shown = on; el.hidden = !on;
      if (on) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
    },
    /** A new round / a new painter: the next score counts up from zero, silently. */
    reset() { M.first = true; M.target = -1; M.val = -1; M.grade = -1; M.bonusOn = false; M.inv = false; el.classList.remove('bonus', ...GRADE_CLS); fill.style.transform = 'scaleY(0)'; writeNum(-1); word.textContent = ''; },
    /** A fresh score (−1: nothing to score against). bonusAt: the bonus line (80 / 90) or −1. */
    set(score, bonusAt = -1, bonusPts = 0) {
      if (bonusAt !== M.bonusAt || bonusPts !== M.bonusPts) {
        M.bonusAt = bonusAt; M.bonusPts = bonusPts;
        star.hidden = starLine.hidden = bonusAt < 0;
        if (bonusAt >= 0) {
          // a dashed line across the tube and a star beside it at the bonus line
          starLine.style.bottom = `${bonusAt}%`; star.style.bottom = `${bonusAt}%`;
          star.title = `+${bonusPts} at ${bonusAt}%`;
        }
      }
      if (score === M.target) return;
      const prevGrade = M.grade; const first = M.first;
      M.from = M.val < 0 ? 0 : M.val; M.target = score; M.t0 = M.tNow; M.first = false;
      if (score < 0) { el.classList.remove(...GRADE_CLS); fill.style.transform = 'scaleY(0)'; word.textContent = 'No surface'; writeNum(-1); M.val = -1; M.grade = -1; return; }
      fill.style.transform = `scaleY(${score / 100})`;
      const g = gradeOf(score);
      // ≥ 98: past Ghost — a shinier "Invisible!" sticker (in place of "Ghost!" when it jumps straight there)
      const inv = score >= INVISIBLE; const invUp = inv && !M.inv && !first; M.inv = inv;
      if (g !== prevGrade) {
        el.classList.remove(...GRADE_CLS); el.classList.add(GRADE_CLS[g]);
        word.textContent = blendWord(score);
        word.classList.remove('pop'); void word.offsetWidth; word.classList.add('pop');
        if (!first && prevGrade >= 0 && g > prevGrade) {
          if (invUp) popSticker('Invisible!', 'g3 inv'); else popSticker(`${blendWord(score)}!`, GRADE_CLS[g]);
          if (GRADE_SND[g]) { play(GRADE_SND[g]); M.sounds++; }
        }
        M.grade = g;
      } else if (invUp) { popSticker('Invisible!', 'g3 inv'); play('unlock'); M.sounds++; }
      const bonusNow = bonusAt >= 0 && score >= bonusAt;
      if (bonusNow !== M.bonusOn) {
        M.bonusOn = bonusNow; el.classList.toggle('bonus', bonusNow);
        if (bonusNow && !first && g === prevGrade) { popSticker(`+${bonusPts}`, GRADE_CLS[g]); play('good'); M.sounds++; }
      }
      num.classList.remove('bump'); void num.offsetWidth; num.classList.add('bump');
    },
    /** Per frame while shown: the number counts toward the score (DOM write only on change). */
    tick(tSec) {
      M.tNow = tSec;
      if (!M.shown || M.target < 0 || M.val === M.target) return;
      const k = Math.min(1, (tSec - M.t0) / DUR); const e = 1 - (1 - k) * (1 - k) * (1 - k);
      M.val = k >= 1 ? M.target : M.from + (M.target - M.from) * e;
      writeNum(Math.round(M.val));
    },
    destroy() { el.remove(); style.remove(); },
  };
}
