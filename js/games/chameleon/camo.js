// Camouflage score ("blend %") and the live camo meter shown while painting.
//
// The score is what a seeker walking round would see. A stamp copies the surface along its
// normal, so from straight in front it matches perfectly by construction; from the side every
// body texel sits in front of a DIFFERENT bit of the surface (parallax: a texel h off the wall
// seen at an angle a covers the point h·tan a away), so the pattern stops lining up. So the
// score looks from BLEND.views viewpoints `dist` m from the body's centre: one straight in front
// of the surface and four `ang` (50°) off its normal, round it (on a wall: from the left, right,
// above and below; on a floor: four sides). For a view, every body texel facing it is followed
// along the sight line to the surface plane BEHIND it, where the surface's albedo is sampled
// exactly as the stamp samples it (vertex colour × atlas tile, blob shadows included). A view's
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
 *  share of a view's loss (the rest: same colours, same busyness), `k` = loss → % scale. */
export const BLEND = { views: 5, dist: 2.6, ang: 0.87, front: 1, exact: 0.6, k: 2.8 };
const NV_MAX = 9;
const ACC = 14; // per view: Σw, Σw·exact, Σw·body rgb, Σw·body rgb², Σw·behind rgb, Σw·behind rgb²

/** A resumable blend-score job. */
export function createBlendJob() {
  return { on: false, p: null, surf: null, k: 0, n: 0, sum: 0, score: -1, steps: 0, nv: 0, ex: new Float64Array(NV_MAX), ey: new Float64Array(NV_MAX), ez: new Float64Array(NV_MAX), vw: new Float64Array(NV_MAX), acc: new Float64Array(NV_MAX * ACC), views: new Float64Array(NV_MAX), mu: new Float64Array(NV_MAX * 3), sd: new Float64Array(NV_MAX * 3), out: null, x: 0, bad: 0, xon: false };
}
/** The viewpoints for paint p (texels fresh) on surf: eye positions + weights into J (no garbage). */
function placeViews(J, p, surf) {
  const list = p.list; const wpos = p.wpos;
  let cx = 0; let cy = 0; let cz = 0;
  for (let k = 0; k < list.length; k++) { const i = list[k] * 3; cx += wpos[i]; cy += wpos[i + 1]; cz += wpos[i + 2]; }
  const N = Math.max(1, list.length); cx /= N; cy /= N; cz /= N;
  const nx = surf.n[0]; const ny = surf.n[1]; const nz = surf.n[2];
  // tangent frame: t1 horizontal along a wall (world up × n), else world x; t2 = n × t1
  const ax = nz; const az = -nx; let al = Math.sqrt(ax * ax + az * az);
  let t1x; let t1y; let t1z;
  if (al > 0.3) { t1x = ax / al; t1y = 0; t1z = az / al; } else { t1x = 1 - nx * nx; t1y = -nx * ny; t1z = -nx * nz; al = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z) || 1; t1x /= al; t1y /= al; t1z /= al; }
  const t2x = ny * t1z - nz * t1y; const t2y = nz * t1x - nx * t1z; const t2z = nx * t1y - ny * t1x;
  const nv = Math.max(1, Math.min(NV_MAX, BLEND.views | 0)); J.nv = nv;
  const D = BLEND.dist; const ca = Math.cos(BLEND.ang); const sa = Math.sin(BLEND.ang);
  for (let v = 0; v < nv; v++) {
    let dx = nx; let dy = ny; let dz = nz;
    if (v > 0) {
      const ph = ((v - 1) / (nv - 1)) * Math.PI * 2; const c = Math.cos(ph) * sa; const s = Math.sin(ph) * sa;
      dx = nx * ca + t1x * c + t2x * s; dy = ny * ca + t1y * c + t2y * s; dz = nz * ca + t1z * c + t2z * s;
    }
    J.ex[v] = cx + dx * D; J.ey[v] = cy + dy * D; J.ez[v] = cz + dz * D;
    J.vw[v] = v === 0 ? BLEND.front : 1;
  }
  J.acc.fill(0);
}
/** Start scoring paint `p` (a createPaint) against `surf` (stage.surfaceOf); texels must be fresh. */
export function startBlend(J, p, surf) {
  if (p.settle) p.settle();
  J.on = true; J.p = p; J.surf = surf; J.k = 0; J.n = 0; J.sum = 0; J.score = -1; J.steps = 0;
  placeViews(J, p, surf);
}
/**
 * Texel i seen from view v of job J. false when that eye can't see it in front of the surface
 * (it faces away, or its sight line never reaches the surface plane); else SAMPLE = [|texel −
 * the colour behind it| / 765, how squarely it faces the eye (0.1..1), behind r, g, b].
 */
const SAMPLE = new Float64Array(5);
function sampleView(J, p, surf, i, v) {
  const wpos = p.wpos; const wnrm = p.wnrm;
  const px = wpos[i * 3]; const py = wpos[i * 3 + 1]; const pz = wpos[i * 3 + 2];
  let dx = px - J.ex[v]; let dy = py - J.ey[v]; let dz = pz - J.ez[v];
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; dx /= L; dy /= L; dz /= L;
  const cv = -(wnrm[i * 3] * dx + wnrm[i * 3 + 1] * dy + wnrm[i * 3 + 2] * dz);
  if (cv < 0.1) return false; // faces away from the eye (or edge-on: a sliver of screen)
  const nx = surf.n[0]; const ny = surf.n[1]; const nz = surf.n[2];
  const dn = dx * nx + dy * ny + dz * nz;
  if (dn > -0.1) return false; // a sight line that never reaches the surface
  const dist = (px - surf.q[0]) * nx + (py - surf.q[1]) * ny + (pz - surf.q[2]) * nz;
  const s = -dist / dn; // along the sight line, on to the surface behind the texel
  const sx = px + dx * s; const sy = py + dy * s; const sz = pz + dz * s;
  surf.uvAt(sx, sy, sz, UV);
  sampleAtlas(surf.atlas, surf.tile, UV[0], UV[1], TMP);
  const sh = surf.shadeAt ? surf.shadeAt(sx, sy, sz) : 0;
  const vc = surf.vc; const br = surf.blobRgb || ZERO; // (the stamp's fallback: black)
  const r = TMP[0] * vc[0] * (1 - sh) + br[0] * sh; const g = TMP[1] * vc[1] * (1 - sh) + br[1] * sh; const b = TMP[2] * vc[2] * (1 - sh) + br[2] * sh;
  const data = p.data; const o = i * 4;
  SAMPLE[0] = (Math.abs(data[o] - r) + Math.abs(data[o + 1] - g) + Math.abs(data[o + 2] - b)) / 765;
  SAMPLE[1] = cv; SAMPLE[2] = r; SAMPLE[3] = g; SAMPLE[4] = b;
  return true;
}
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
  const p = J.p; const surf = J.surf; const list = p.list; const nv = J.nv; const a = J.acc; const data = p.data;
  const end = Math.min(list.length, J.k + budget * 2); // ~half of the texels face any one eye
  let k = J.k; let n = J.n; let v = k % nv;
  for (; k < end; k++) {
    const i = list[k];
    if (sampleView(J, p, surf, i, v)) {
      const w = SAMPLE[1]; const o = v * ACC; const t = i * 4;
      const tr = data[t]; const tg = data[t + 1]; const tb = data[t + 2]; const r = SAMPLE[2]; const g = SAMPLE[3]; const b = SAMPLE[4];
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
    J.ex.set(from.ex); J.ey.set(from.ey); J.ez.set(from.ez); J.vw.set(from.vw); J.mu.set(from.mu); J.sd.set(from.sd); J.views.set(from.views);
  } else startBlend(J, p, surf);
  J.out = out; J.x = 0; J.bad = 0; J.xon = true;
}
/** Run the error map for about `ms` milliseconds (Infinity: to the end); true when it's done. */
export function stepErrorMap(J, ms = Infinity) {
  if (!J.xon) return true;
  const t0 = performance.now();
  if (J.on && !stepBlend(J, ms === Infinity ? 1e9 : 1500)) return false; // the score pass first (each view's colours behind)
  const p = J.p; const surf = J.surf; const out = J.out;
  const list = p.list; const nv = J.nv; const K = BLEND.k; const ex = BLEND.exact; const data = p.data;
  let k = J.x; let bad = J.bad;
  while (k < list.length) {
    const end = Math.min(list.length, k + 256);
    for (; k < end; k++) {
      const i = list[k]; const t = i * 4;
      let ls = 0; let ws = 0;
      for (let v = 0; v < nv; v++) {
        if (!sampleView(J, p, surf, i, v)) continue;
        let st = 0;
        for (let c = 0; c < 3; c++) { const d = Math.abs(data[t + c] - J.mu[v * 3 + c]) - J.sd[v * 3 + c]; if (d > 0) st += d; }
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
