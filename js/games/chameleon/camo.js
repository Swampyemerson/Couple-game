// Camouflage score ("blend %") and the live camo meter shown while painting.
//
// The score: every other mapped body texel that faces away from the surface the hider is on is
// projected onto that surface, the surface's albedo there is sampled exactly as the stamp samples
// it (vertex colour × atlas tile, blob shadows included) and the mean per-channel difference
// becomes a percentage: camo = 100 × (1 − 2.8 × mean |ΔRGB| / 255). A job can run all at once (the
// lock) or a slice per frame (the meter), so painting never hitches.
//
// The meter: a riso sticker on the right edge while the paint tools are open. A tube fills to the
// score (ticks at the grade lines 50 / 75 / 90, a star at the blend-bonus line), the number counts
// toward it, the grade word changes colour, and a better grade pops a sticker with a sound
// (Spotted → Sneaky → Ghost). DOM writes only when something changes.
import { sampleAtlas } from './atlas.js';
import { blendWord } from './cards.js';

const UV = [0, 0]; const TMP = [0, 0, 0];

/** A resumable blend-score job. */
export function createBlendJob() {
  return { on: false, p: null, surf: null, k: 0, n: 0, sum: 0, score: -1, steps: 0 };
}
/** Start scoring paint `p` (a createPaint) against `surf` (stage.surfaceOf); texels must be fresh. */
export function startBlend(J, p, surf) {
  if (p.settle) p.settle();
  J.on = true; J.p = p; J.surf = surf; J.k = 0; J.n = 0; J.sum = 0; J.score = -1; J.steps = 0;
}
/** Score up to `budget` texel samples; true (and J.score set) when the job is finished. */
export function stepBlend(J, budget = 1e9) {
  if (!J.on) return true;
  const p = J.p; const surf = J.surf;
  const list = p.list; const wpos = p.wpos; const wnrm = p.wnrm; const data = p.data;
  const qx = surf.q[0]; const qy = surf.q[1]; const qz = surf.q[2];
  const nx = surf.n[0]; const ny = surf.n[1]; const nz = surf.n[2];
  const vc = surf.vc; const br = surf.blobRgb || TMP;
  const end = Math.min(list.length, J.k + budget * 2);
  let n = J.n; let sum = J.sum; let k = J.k;
  for (; k < end; k += 2) {
    const i = list[k];
    const facing = wnrm[i * 3] * nx + wnrm[i * 3 + 1] * ny + wnrm[i * 3 + 2] * nz;
    if (facing < 0.1) continue; // the side pressed against the surface is never seen
    const px = wpos[i * 3]; const py = wpos[i * 3 + 1]; const pz = wpos[i * 3 + 2];
    const dist = (px - qx) * nx + (py - qy) * ny + (pz - qz) * nz;
    const sx = px - nx * dist; const sy = py - ny * dist; const sz = pz - nz * dist;
    surf.uvAt(sx, sy, sz, UV);
    sampleAtlas(surf.atlas, surf.tile, UV[0], UV[1], TMP);
    const sh = surf.shadeAt ? surf.shadeAt(sx, sy, sz) : 0;
    const r = TMP[0] * vc[0] * (1 - sh) + br[0] * sh; const g = TMP[1] * vc[1] * (1 - sh) + br[1] * sh; const b = TMP[2] * vc[2] * (1 - sh) + br[2] * sh;
    const o = i * 4;
    sum += (Math.abs(data[o] - r) + Math.abs(data[o + 1] - g) + Math.abs(data[o + 2] - b)) / 765;
    n++;
  }
  J.k = k; J.n = n; J.sum = sum; J.steps++;
  if (k < list.length) return false;
  J.on = false;
  J.score = n ? Math.round(Math.min(100, Math.max(0, 100 * (1 - 2.8 * (sum / n))))) : -1;
  return true;
}
/** The whole score at once (the lock). */
export function scoreBlend(p, surf) {
  const J = createBlendJob(); startBlend(J, p, surf); stepBlend(J); return J.score;
}

/** Grade index: 0 Sore thumb, 1 Spotted, 2 Sneaky, 3 Ghost. */
export const gradeOf = (b) => (b >= 90 ? 3 : b >= 75 ? 2 : b >= 50 ? 1 : 0);
const GRADE_CLS = ['g0', 'g1', 'g2', 'g3'];
const GRADE_SND = [null, 'pose', 'good', 'unlock'];

const METER_CSS = `
.chm-meter { position: absolute; right: calc(8px + var(--chm-sr)); top: calc(184px + var(--chm-st)); width: 56px; padding: 5px 0 6px; display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none; z-index: 1; transform-origin: 100% 50%; animation: cm-in .28s cubic-bezier(.34,1.56,.64,1) both; }
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
.chm-meter .cm-star { position: absolute; right: calc(100% + 1px); transform: translateY(50%); font: 900 0.9rem/1 var(--g-font-body); color: var(--g-card); -webkit-text-stroke: 1.4px var(--g-ink); }
.chm-meter.bonus .cm-star { color: var(--g-hl); animation: cm-star .45s ease-out; }
.chm-meter .cm-starline { position: absolute; left: 0; right: 0; height: 0; border-top: 2px dashed var(--g-ink); margin-bottom: -1px; opacity: .7; }
.chm-meter .cm-word { font: 900 0.6rem/1.05 var(--g-font-body); text-transform: uppercase; letter-spacing: .03em; text-align: center; min-height: 2.1em; display: grid; place-items: center; padding: 0 3px; font-style: normal; }
.chm-meter .cm-word.pop { animation: cm-bump .4s ease-out; }
.chm-meter .cm-pop { position: absolute; right: calc(100% + 10px); top: 46%; padding: 5px 9px; border: 2.5px solid var(--g-ink); border-radius: 10px; background: var(--g-good); color: var(--g-on-signal, #fff); font: 900 0.95rem/1 var(--g-font-display); white-space: nowrap; box-shadow: 3px 3px 0 var(--g-edge); opacity: 0; transform-origin: 100% 50%; }
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
  const el = doc.createElement('div');
  el.className = 'chm-meter chm-sticker'; el.hidden = true;
  el.setAttribute('role', 'status'); el.setAttribute('aria-label', 'Camouflage');
  el.innerHTML = '<span class="cm-cap">Camo</span><b class="cm-num">--</b>'
    + '<div class="cm-col"><div class="cm-tube"><i class="cm-fill"></i><s class="cm-tick" style="bottom:50%"></s><s class="cm-tick" style="bottom:75%"></s><s class="cm-tick" style="bottom:90%"></s><i class="cm-starline" hidden></i></div><span class="cm-star" hidden>★</span></div>'
    + '<em class="cm-word"></em><span class="cm-pop"></span>';
  host.appendChild(style); host.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const num = $('.cm-num'); const fill = $('.cm-fill'); const word = $('.cm-word'); const pop = $('.cm-pop');
  const star = $('.cm-star'); const starLine = $('.cm-starline');
  const M = { shown: false, target: -1, from: 0, val: -1, shownVal: -2, t0: 0, tNow: 0, grade: -1, first: true, bonusAt: -1, bonusPts: 0, bonusOn: false, sounds: 0, pops: 0 };
  const DUR = 0.55;
  function writeNum(v) {
    if (v === M.shownVal) return;
    M.shownVal = v;
    num.innerHTML = v < 0 ? '--' : `${v}<small>%</small>`;
  }
  function popSticker(text, cls) {
    pop.className = `cm-pop ${cls}`; pop.textContent = text; void pop.offsetWidth; pop.classList.add('go'); M.pops++;
  }
  return {
    el,
    get value() { return M.target; },
    get shown() { return M.shown; },
    get stats() { return { target: M.target, grade: M.grade, sounds: M.sounds, pops: M.pops, bonusOn: M.bonusOn, text: num.textContent, word: word.textContent }; },
    show(on) {
      if (on === M.shown) return;
      M.shown = on; el.hidden = !on;
      if (on) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
    },
    /** A new round / a new painter: the next score counts up from zero, silently. */
    reset() { M.first = true; M.target = -1; M.val = -1; M.grade = -1; M.bonusOn = false; el.classList.remove('bonus', ...GRADE_CLS); fill.style.transform = 'scaleY(0)'; writeNum(-1); word.textContent = ''; },
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
      if (g !== prevGrade) {
        el.classList.remove(...GRADE_CLS); el.classList.add(GRADE_CLS[g]);
        word.textContent = blendWord(score);
        word.classList.remove('pop'); void word.offsetWidth; word.classList.add('pop');
        if (!first && prevGrade >= 0 && g > prevGrade) {
          popSticker(`${blendWord(score)}!`, GRADE_CLS[g]);
          if (GRADE_SND[g]) { play(GRADE_SND[g]); M.sounds++; }
        }
        M.grade = g;
      }
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
