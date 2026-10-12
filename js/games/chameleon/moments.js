// Blend & Seek — hunt interactions & couple moments (the "H" pass):
//   * whisker shots: a miss that passes within 0.35 m x size of the hider stains their skin in the
//     seeker's ink, whooshes, and says "Missed by a whisker!" to both
//   * the mercy chirp: once per hunt the hunted hider sends the seeker a hot / warm / cold ping (-10 pts)
//   * a note on the skin: <= 40 plain characters typed in the hide phase, revealed only at FOUND / SURVIVED
//   * last-second drama: AT THE BUZZER (a tag in the last 2 s), SO CLOSE (survived with the seeker < 1.5 m away)
// Everything here is a factory over the game's closure (createMoments(env)) so game.js only needs small
// hooks; the pure helpers are exported for the unit checks. Nothing in here uses Math.random for anything the
// two phones must agree on (the splat droplets are seeded by the shot id).
import { esc, hexToRgb, clamp, seeded } from './util.js';

export const NOTE_MAX = 40;
export const WHISKER = 0.35; // metres x body size
export const MERCY_COST = 10;
export const MERCY_NEAR = 3; // hot below this (m)
export const MERCY_MID = 7; // warm below this, else cold
export const BUZZER_MS = 2000; // a tag with this much clock left is "at the buzzer"
export const CLOSE_M = 1.5; // survived with the seeker this close at the buzzer
const PELLET_SPEED = 28; // m/s (fx.pellet)

const badChar = (c) => c < 32 || (c >= 127 && c <= 159) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2060 && c <= 0x2064) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff || c === 60 || c === 62 || c === 96; // controls, zero-width / bidi marks, < > `
/** Plain text only: control / bidi / zero-width characters and angle brackets go, runs of spaces collapse, 40 code points. */
export function cleanNote(s) {
  if (typeof s !== 'string') return '';
  let t = ''; for (const ch of s.normalize('NFC')) t += badChar(ch.codePointAt(0)) ? ' ' : ch;
  t = t.replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, NOTE_MAX).join('').trim();
}
/** Distance from point c to the segment o -> p; t = where along it (0..1). */
export function segGap(ox, oy, oz, px, py, pz, cx, cy, cz, out) {
  const dx = px - ox; const dy = py - oy; const dz = pz - oz;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 1e-9 ? ((cx - ox) * dx + (cy - oy) * dy + (cz - oz) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ox + dx * t; const qy = oy + dy * t; const qz = oz + dz * t;
  if (out) { out.t = t; out.qx = qx; out.qy = qy; out.qz = qz; }
  return Math.hypot(cx - qx, cy - qy, cz - qz);
}
/** hot < 3 m, warm < 7 m, else cold. */
export const mercyBand = (d) => (d < MERCY_NEAR ? 'hot' : d < MERCY_MID ? 'warm' : 'cold');
const BAND_OK = { hot: 1, warm: 1, cold: 1 };
const BAND_SUB = { hot: 'closer than 3 m', warm: 'within 7 m', cold: 'further than 7 m' };

/** Recap lines for the moments of one round (escaped HTML, newest feature first). */
export function momentLines(api, rec) {
  const out = [];
  if (!rec || !rec.hider) return out;
  const hn = esc(api.name(rec.hider)); const sn = esc(api.name(rec.seeker || api.other(rec.hider)));
  if (rec.whisker) out.push(`${sn} missed ${hn} by a whisker${rec.whisker > 1 ? ` ${rec.whisker}×` : ''}`);
  if (rec.mercy) out.push(`${hn} took pity: a ${esc(rec.mercy)} ping${rec.mercyPts ? ` (−${rec.mercyPts})` : ''}`);
  return out;
}
/** Final-card lines: the notes people left on their skins. */
export function noteLines(api, hist) {
  const out = [];
  for (const r of hist || []) if (r && r.hider && r.note) out.push(`<span>Note from ${esc(api.name(r.hider))} (R${r.round | 0}): “${esc(r.note)}”</span>`);
  return out;
}

const IC = {
  mercy: '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>',
  note: '<path d="M4 20h4l11-11-4-4L4 16z"/><path d="M13 7l4 4"/>',
  tick: '<path d="M4 12.5l5 5L20 6.5"/>',
};
const svg = (k) => `<svg class="chm-ic" viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg>`;

export const MOMENTS_CSS = `
/* hunt interactions & couple moments (moments.js) */
.chm-mo { position: absolute; left: 50%; transform: translateX(-50%); top: calc(98px + var(--chm-st)); min-height: 44px; min-width: 44px; padding: 0 16px 0 12px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 2.5px solid var(--g-ink); border-radius: 999px; background: var(--g-card); color: var(--g-ink); font: 900 .82rem/1 var(--g-font-body); letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-edge)); cursor: pointer; touch-action: manipulation; pointer-events: auto; z-index: 3; }
.chm-mo:active { transform: translateX(-50%) translate(2px, 2px); box-shadow: 1px 1px 0 var(--g-edge); }
.chm-mo .chm-ic { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.3; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.chm-mo em { font-style: normal; font-size: .66rem; opacity: .75; letter-spacing: .02em; }
.chm-mo-mercy { background: var(--g-hl); color: var(--g-on-ink); }
.chm-mo-note.set { background: var(--g-ink); color: var(--g-bg); }
.chm-mo[hidden] { display: none !important; }
.chm-notesheet { position: absolute; inset: 0; z-index: 5; display: grid; place-items: start center; padding: calc(124px + var(--chm-st)) 14px 14px; background: color-mix(in srgb, var(--g-bg) 62%, transparent); pointer-events: auto; }
.chm-notesheet .chm-card { gap: 10px; }
.chm-notesheet input { appearance: none; width: 100%; box-sizing: border-box; min-height: 48px; padding: 0 12px; border: 2.5px solid var(--g-ink); border-radius: 12px; background: var(--g-bg); color: var(--g-ink); font: 800 1rem/1 var(--g-font-body); }
.chm-notesheet .chm-nrow { display: flex; gap: 8px; }
.chm-notesheet .chm-nrow button { flex: 1; min-height: 46px; }
.chm-notesheet small { color: var(--g-muted); font-weight: 800; font-size: .72rem; }
.chm-notetag { position: absolute; left: 0; top: 0; z-index: 5; pointer-events: none; will-change: transform; }
.chm-notetag b { display: block; max-width: min(78vw, 300px); padding: 7px 12px 8px; background: var(--g-card); color: var(--g-ink); border: 2.5px solid var(--g-ink); border-radius: 6px 12px 8px 12px; box-shadow: 3px 3px 0 var(--g-edge); font: 900 1rem/1.15 var(--g-font-display); text-align: center; overflow-wrap: anywhere; transform: translate(-50%, -100%) rotate(-3deg); animation: chm-stamp .45s cubic-bezier(.2,1.6,.4,1); }
.chm-notetag b small { display: block; font: 900 .58rem/1 var(--g-font-body); letter-spacing: .14em; text-transform: uppercase; color: var(--g-muted); margin-bottom: 3px; }
.chm-notetag i { position: absolute; left: -6px; top: 0; width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; border-top: 10px solid var(--g-ink); }
@media (orientation: landscape) and (max-height: 520px) { .chm-notesheet { padding-top: calc(48px + var(--chm-st)); } .chm-notesheet p { display: none; } .chm-notesheet .chm-card { padding-top: 12px; padding-bottom: 12px; gap: 8px; } .chm-mo { top: auto; bottom: calc(12px + var(--chm-sb)); } }
`;

/**
 * env: { api, local, me, isHost, link, hud, snd, root, getStage(), getTheme(), S, R, body, mode(), rules(), now(), later(fn, ms),
 *        hint(text, ms), data(), setData(patch), hiderOf(round), hunting(), sizeS(), frozen(), paintOn(), tSec(), L }
 */
export function createMoments(env) {
  const { api, local, me, link, hud, snd, root, S, R } = env;
  const other = (w) => (w === 'a' ? 'b' : 'a');
  const M = {
    mid: '', round: -1, whisker: 0, shots: new Set(), mercy: 0, mercyBand: '', notes: { a: '', b: '' }, draft: '', lockedNote: false,
    buzzSet: false, buzzD: 99, whiskLog: [], notesCount: 0,
  };
  function sync() {
    const mid = S.match ? S.match.id : ''; const rd = S.phase.round | 0;
    if (M.mid === mid && M.round === rd) return;
    M.mid = mid; M.round = rd; M.whisker = 0; M.shots.clear(); M.mercy = 0; M.mercyBand = ''; M.notes.a = ''; M.notes.b = ''; M.draft = ''; M.lockedNote = false; M.buzzSet = false; M.buzzD = 99; M.whiskLog.length = 0; M.stains = 0;
    closeSheet();
  }
  const bump = (key) => { const d = env.data(); env.setData({ [key]: (d[key] | 0) + 1 }); };
  const inkOf = (w) => (w === 'a' ? env.getTheme().a : env.getTheme().b);
  /** A sticker of our own (the hud pops sit at fixed heights): auto-removed. */
  const stickerLog = [];
  function sticker(text, sub = '', cls = 'hl', top = 30, ms = 2400) {
    const pops = root.querySelector('.chm-pops'); if (!pops) return;
    stickerLog.push(text); if (stickerLog.length > 12) stickerLog.shift();
    const d = document.createElement('div');
    d.className = `chm-pop ${cls}`; d.style.top = `${top}%`;
    d.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    pops.appendChild(d);
    env.later(() => d.remove(), ms);
  }

  // ── DOM: the two chips + the note sheet (created once; hidden until their moment) ──────────────
  const hudEl = root.querySelector('.chm-hud');
  const mk = (cls, act, html) => { const b = document.createElement('button'); b.className = `chm-mo ${cls}`; b.dataset.mo = act; b.hidden = true; b.type = 'button'; b.innerHTML = html; hudEl.appendChild(b); return b; };
  const mercyBtn = mk('chm-mo-mercy', 'mercy', `${svg('mercy')}<span>Mercy</span><em>−${MERCY_COST}</em>`);
  const noteBtn = mk('chm-mo-note', 'note', `${svg('note')}<span>Note</span>`);
  const noteLab = noteBtn.querySelector('span');
  env.L.on(hudEl, 'click', (e) => {
    const t = e.target.closest('button[data-mo]');
    if (!t || !hudEl.contains(t)) return;
    e.stopPropagation();
    snd.unlock();
    if (t.dataset.mo === 'mercy') mercyTap(); else if (t.dataset.mo === 'note') openSheet();
  });
  const N = { cardChk: 0, cardL: 0, tagW: 220, mercy: false, note: false, noteSet: null, tag: null, tagX: -1, tagY: -1, tagFor: '' };

  // ── whisker shots ──────────────────────────────────────────────────────────────────────────────
  const GAP = {};
  /**
   * Judge a miss (the victim's device in a live game, the one device in hotseat). d: { id, by, o:[x,y,z], p:[x,y,z] }.
   * The pellet's path is the segment o -> p (it ends where it hit the map or ran out of range).
   */
  function judgeMiss(d) {
    sync();
    const stage = env.getStage();
    if (!stage || !d || S.phase.name !== 'seek' || R.foundSent || !env.hunting()) return;
    const md = env.mode();
    const w = md === 'hs' ? env.hiderOf(S.phase.round) : other(d.by);
    if (!w || (!local && w !== me)) return;
    const key = `${d.by}:${d.id}`;
    if (M.shots.has(key)) return;
    M.shots.add(key);
    const av = stage.av[w];
    const ox = d.o[0]; const oy = d.o[1]; const oz = d.o[2]; const px = d.p[0]; const py = d.p[1]; const pz = d.p[2];
    const L = Math.hypot(px - ox, py - oy, pz - oz);
    if (L < 0.4) return;
    let best = Infinity; let bt = 0; let bc = null; let br = 0;
    for (const m of av.meshes) {
      if (m.visible === false) continue;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      m.updateWorldMatrix(true, false);
      const e = m.matrixWorld.elements; const c = m.geometry.boundingSphere.center;
      const cx = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12]; const cy = e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13]; const cz = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14];
      const rad = m.geometry.boundingSphere.radius * Math.hypot(e[0], e[1], e[2]) * 0.72; // the parts are fat ellipsoids
      const gap = Math.max(0, segGap(ox, oy, oz, px, py, pz, cx, cy, cz, GAP) - rad);
      if (gap < best) { best = gap; bt = GAP.t; bc = [cx, cy, cz, GAP.qx, GAP.qy, GAP.qz]; br = rad; }
    }
    const sz = Math.max(1, env.sizeS());
    if (!bc || best > WHISKER * sz) return;
    const cm = Math.round(best * 100);
    M.whisker++;
    M.whiskLog.push(cm);
    bump(`${w}_whisker`);
    const seeker = d.by;
    if (!local) link.send('whisk', { id: d.id, by: d.by, w, cm });
    const wait = clamp(((bt * L) / PELLET_SPEED) * 1000, 0, 900);
    const shotDir = [(px - ox) / L, (py - oy) / L, (pz - oz) / L];
    const hit = md === 'hs' && stage.paints[w] ? bc : null; // Double Blind has no sync path for a stain: sticker + sound only
    env.later(() => {
      if (S.phase.name !== 'seek') return;
      if (hit) stain(w, seeker, hit, br, shotDir, d.id, sz);
      whiskerFx(seeker, w, cm);
    }, wait);
  }
  /** Splat the seeker's ink onto the hider's own atlas (the same dab path a brush uses; the live paint sync carries it). */
  function stain(w, seeker, bc, rad, dir, id, sz) {
    const stage = env.getStage();
    const paint = stage.paints[w]; const av = stage.av[w];
    // the point on the skin nearest the pellet's closest approach: a ray from the approach point to the part's centre
    let ux = bc[0] - bc[3]; let uy = bc[1] - bc[4]; let uz = bc[2] - bc[5];
    const ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-4) { ux = -dir[0]; uy = -dir[1]; uz = -dir[2]; } else { ux /= ul; uy /= ul; uz /= ul; }
    const ray = stage.ray.ray;
    ray.origin.set(bc[3], bc[4], bc[5]); ray.direction.set(ux, uy, uz);
    const hit = stage.pick(av.meshes, ul + rad + 0.5);
    if (!hit) return;
    paint.updateWorld(av.meshes);
    const rgb = hexToRgb(inkOf(seeker));
    const r0 = 0.1 * sz;
    const hx = hit.point.x; const hy = hit.point.y; const hz = hit.point.z;
    paint.dab(hx, hy, hz, dir[0], dir[1], dir[2], r0, rgb, true, 1);
    // three droplets round the main splat (seeded by the shot, so a replay looks the same)
    const rnd = seeded(`whisker:${id}`);
    let t1x = -dir[2]; let t1y = 0; let t1z = dir[0]; // dir x up
    const tl = Math.hypot(t1x, t1y, t1z);
    if (tl < 0.05) { t1x = 1; t1y = 0; t1z = 0; } else { t1x /= tl; t1y /= tl; t1z /= tl; }
    const t2x = dir[1] * t1z - dir[2] * t1y; const t2y = dir[2] * t1x - dir[0] * t1z; const t2z = dir[0] * t1y - dir[1] * t1x;
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2; const rr = (0.1 + rnd() * 0.07) * sz;
      const ca = Math.cos(a) * rr; const sa = Math.sin(a) * rr;
      paint.dab(hx + t1x * ca + t2x * sa, hy + t1y * ca + t2y * sa, hz + t1z * ca + t2z * sa, dir[0], dir[1], dir[2], (0.035 + rnd() * 0.025) * sz, rgb, true, 1);
    }
    M.stains = (M.stains | 0) + 1;
  }
  function whiskerFx(seeker, w, cm) {
    snd.play('whisker');
    sticker('Missed by a whisker!', `${cm} cm off`, seeker, 30, 2200);
    if (local || w === me) api.haptic(35);
  }
  /** The shooter's side of a whisker: the victim's device says it happened. */
  function onWhisk(d) {
    if (!d || d.by !== me || S.phase.name !== 'seek') return;
    sync();
    M.whisker++; M.whiskLog.push(d.cm | 0);
    whiskerFx(d.by, d.w, d.cm | 0);
  }

  // ── mercy chirp ────────────────────────────────────────────────────────────────────────────────
  function canMercy() {
    return !local && env.mode() === 'hs' && S.phase.name === 'seek' && env.hiderOf(S.phase.round) === me && env.hunting() && env.now() < S.phase.end && !M.mercy && !R.foundSent;
  }
  function mercyTap() {
    sync();
    if (!canMercy() || env.frozen()) return;
    const stage = env.getStage(); const sk = other(me);
    const a = stage.av[sk].root.position; const b = stage.av[me].root.position;
    const band = mercyBand(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    M.mercy = 1; M.mercyBand = band;
    link.send('mercy', { band });
    bump(`${me}_mercy`);
    snd.play('mercyOut');
    api.haptic(20);
    sticker('Mercy sent', `${api.name(sk)} gets a ${band} ping · −${MERCY_COST}`, 'ink', 30, 2000);
  }
  /** The seeker's side: a hot / warm / cold ping. */
  function onMercy(d) {
    sync();
    if (!d || !BAND_OK[d.band] || S.phase.name !== 'seek' || env.mode() !== 'hs' || M.mercy || R.foundSent) return;
    M.mercy = 1; M.mercyBand = d.band;
    const hider = env.hiderOf(S.phase.round);
    const v = local ? null : me;
    if (v && v === hider) return; // (never to the hider)
    snd.play(d.band === 'hot' ? 'mercyHot' : d.band === 'warm' ? 'mercyWarm' : 'mercyCold');
    api.haptic(25);
    sticker(d.band.toUpperCase(), `${api.name(hider)} took pity: ${BAND_SUB[d.band]}`, d.band === 'cold' ? 'b' : d.band === 'warm' ? 'hl' : 'a', 30, 3600);
    env.hint(`${d.band.toUpperCase()} — ${BAND_SUB[d.band]}`, 4200);
  }

  // ── a note on the skin ─────────────────────────────────────────────────────────────────────────
  let sheet = null; let input = null;
  function canNote() {
    return env.mode() === 'hs' && S.phase.name === 'hide' && S.match && env.hiderOf(S.phase.round) === (local ? S.actor : me) && !env.paintOn();
  }
  function openSheet() {
    sync();
    if (sheet || !canNote()) return;
    sheet = document.createElement('div');
    sheet.className = 'chm-notesheet';
    sheet.innerHTML = '<div class="chm-card chm-sticker" role="dialog" aria-label="A note on your skin"><div class="chm-kicker">A note on your skin</div><p>The seeker only reads it after the round — found or not. Up to 40 characters.</p><input type="text" maxlength="40" enterkeyhint="done" autocomplete="off" autocapitalize="sentences" spellcheck="false" aria-label="Your note" placeholder="Hi from the sofa"><small class="n-count"></small><div class="chm-nrow"><button class="chm-ghost" data-n="clear" type="button">Clear</button><button class="chm-go me" data-n="save" type="button">Save</button></div></div>';
    root.appendChild(sheet);
    input = sheet.querySelector('input');
    const count = sheet.querySelector('.n-count');
    input.value = M.draft;
    const upd = () => { count.textContent = `${Array.from(input.value).length} / ${NOTE_MAX}`; };
    upd();
    input.addEventListener('input', () => { M.draft = cleanNote(input.value); upd(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); closeSheet(); } });
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-n]');
      if (b) { snd.unlock(); if (b.dataset.n === 'clear') { M.draft = ''; input.value = ''; upd(); input.focus({ preventScroll: true }); snd.play('undo'); } else { snd.play('good'); closeSheet(); } return; }
      if (e.target === sheet) closeSheet();
    });
    snd.play('ui');
    try { input.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
  /** Close (and remove from the DOM: a note must never sit in a seeker's page). */
  function closeSheet() {
    if (!sheet) return;
    if (input) M.draft = cleanNote(input.value);
    sheet.remove(); sheet = null; input = null;
  }
  /** What goes out with my lock: the cleaned note (and the count, once). */
  function noteForLock(w) {
    sync();
    const n = cleanNote(M.draft);
    if (env.mode() !== 'hs') return '';
    if (n) { M.notes[w] = n; if (!M.lockedNote) { M.lockedNote = true; bump(`${w}_notes`); } }
    return n;
  }
  /** The partner's note arrived with their lock: kept in memory only, never drawn before the reveal. */
  function noteIn(w, text) {
    if (w !== 'a' && w !== 'b') return;
    sync();
    const n = cleanNote(text);
    if (n) M.notes[w] = n;
  }

  // ── last-second drama ──────────────────────────────────────────────────────────────────────────
  /** Per hunt frame (both phones): remember how close the seeker was when the clock hit zero. */
  function huntTick(t, d) {
    if (M.buzzSet || t < S.phase.end) return;
    sync();
    M.buzzSet = true; M.buzzD = d;
  }
  /** A tag confirmed with <= 2 s on the clock: the shooter's hit-stop is longer. */
  function buzzNear() { return S.phase.name === 'seek' && S.phase.end - env.now() <= BUZZER_MS; }
  /** Host, in roundOver: fold the moments into the round record (and apply the mercy cost). */
  function decorate(rec, res) {
    sync();
    const m = S.match;
    if (rec.found && res.T != null) { const left = S.phase.end - res.T; if (left <= BUZZER_MS) rec.buzz = Math.max(0, Math.round(left)); }
    if (m.mode !== 'hs') return;
    if (M.whisker) rec.whisker = M.whisker;
    if (M.mercy) {
      const cost = Math.min(MERCY_COST, Math.max(0, rec.points | 0));
      rec.mercy = M.mercyBand || 'cold'; rec.mercyPts = cost;
      if (cost) { rec.points -= cost; m.scores[rec.hider] -= cost; }
    }
    const note = M.notes[rec.hider]; if (note) rec.note = note;
    // (live: the distance when the clock passed zero; hotseat calls time 380 ms early, before it does: the distance now)
    const dEnd = M.buzzSet ? M.buzzD : R.nearD;
    if (!rec.found && !rec.outOfPellets && dEnd <= CLOSE_M) rec.close = Math.round(dEnd * 10) / 10;
  }
  /** Which chord FOUND / SURVIVED plays. */
  function jingle(name, rec, iWon) {
    let j;
    if (name === 'found') j = rec.buzz != null ? 'buzzer' : !iWon ? 'sad' : rec.ms < 10000 && rec.hider ? 'quick' : 'found';
    else if (rec.close != null) j = 'closeCall';
    else if (!iWon) j = 'sad';
    else j = rec.blend >= 90 && !rec.outOfPellets ? 'ghost' : 'survive';
    M.lastJingle = j;
    return j;
  }
  /** The stickers (after the stamp has landed). */
  function drama(name, rec) {
    if (name === 'found' && rec.buzz != null) env.later(() => sticker('AT THE BUZZER', `${(rec.buzz / 1000).toFixed(1)} s on the clock`, 'hl', 62, 2600), 650);
    else if (name === 'time' && rec.close != null) env.later(() => sticker('SO CLOSE', `${api.name(rec.seeker || other(rec.hider))} was ${rec.close.toFixed(1)} m away`, 'ink', 62, 2600), 650);
  }

  // ── per frame (called from ui()) ───────────────────────────────────────────────────────────────
  const proj = { x: 0, y: 0, w: 0 };
  function project(cam, x, y, z) {
    const m = cam.matrixWorldInverse.elements; const p = cam.projectionMatrix.elements;
    const vx = m[0] * x + m[4] * y + m[8] * z + m[12]; const vy = m[1] * x + m[5] * y + m[9] * z + m[13]; const vz = m[2] * x + m[6] * y + m[10] * z + m[14];
    const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
    proj.x = (p[0] * vx + p[4] * vy + p[8] * vz + p[12]) / (cw || 1); proj.y = (p[1] * vx + p[5] * vy + p[9] * vz + p[13]) / (cw || 1); proj.w = cw;
    return proj;
  }
  /** ph / role: the current phase and the viewer's role; gate: the game is on screen (not a card / blind). */
  function ui(ph, role, gate) {
    sync();
    // the chips
    const mercyOn = gate && ph === 'seek' && role === 'hider' && canMercy() && !env.frozen() && !env.paintOn();
    if (N.mercy !== mercyOn) { N.mercy = mercyOn; mercyBtn.hidden = !mercyOn; }
    const noteOn = gate && ph === 'hide' && role === 'hider' && canNote() && !sheet;
    if (N.note !== noteOn) { N.note = noteOn; noteBtn.hidden = !noteOn; }
    const set = !!M.draft;
    if (N.noteSet !== set) { N.noteSet = set; noteBtn.classList.toggle('set', set); noteLab.textContent = set ? 'Note set' : 'Note'; }
    if (sheet && (ph !== 'hide' || !gate)) closeSheet();
    // the revealed note, lettered over the body in the recap orbit
    const rec = R.rec;
    const showTag = ph === 'recap' && rec && rec.note && rec.hider;
    if (!showTag) { if (N.tag) { N.tag.remove(); N.tag = null; N.tagFor = ''; } return; }
    const stage = env.getStage(); if (!stage) return;
    if (!N.tag || N.tagFor !== rec.note) {
      if (N.tag) N.tag.remove();
      N.tag = document.createElement('div'); N.tag.className = 'chm-notetag'; N.tag.setAttribute('role', 'note');
      N.tag.innerHTML = `<b><small>${esc(api.name(rec.hider))} left a note</small><span></span></b><i></i>`;
      N.tag.querySelector('span').textContent = rec.note; // (text, not HTML)
      hudEl.parentElement.appendChild(N.tag);
      N.tagFor = rec.note; N.tagX = -1; N.tagY = -1;
    }
    const av = stage.av[rec.hider]; const pos = av.root.position;
    const q = project(stage.camera, pos.x, pos.y + 0.34 * av.st.size, pos.z);
    const W = root.clientWidth || 390; const H = root.clientHeight || 800;
    let x = (q.x + 1) / 2 * W; let y = (1 - q.y) / 2 * H;
    if (q.w <= 0) { x = W / 2; y = H * 0.3; }
    // a recap card that is a side panel (landscape) is not covered: the sticker stays left of it
    if (++N.cardChk % 20 === 1) { const cd = root.querySelector('.chm-recap .chm-card'); N.cardL = cd && cd.getBoundingClientRect().left > W * 0.35 ? cd.getBoundingClientRect().left : W; N.tagW = N.tag.firstElementChild.offsetWidth || 220; }
    const half = Math.min(N.tagW, W) / 2 + 10;
    x = clamp(x, half, Math.max(half, N.cardL - 8 - half)); y = clamp(y - 8, 176, Math.max(176, H * 0.55));
    const rx = Math.round(x); const ry = Math.round(y);
    if (rx !== N.tagX || ry !== N.tagY) { N.tagX = rx; N.tagY = ry; N.tag.style.transform = `translate(${rx}px, ${ry}px)`; }
  }

  function destroy() { closeSheet(); if (N.tag) N.tag.remove(); mercyBtn.remove(); noteBtn.remove(); }
  /** Test hook. */
  function debug() { sync(); return { whisker: M.whisker, whiskLog: M.whiskLog.slice(), mercy: M.mercy, mercyBand: M.mercyBand, draft: M.draft, notes: { ...M.notes }, buzzSet: M.buzzSet, buzzD: M.buzzD, sheet: !!sheet, stains: M.stains | 0, chips: { mercy: !mercyBtn.hidden, note: !noteBtn.hidden }, jingle: M.lastJingle || null, stickers: stickerLog.slice() }; }

  return { judgeMiss, onWhisk, mercyTap, onMercy, openSheet, closeSheet, noteForLock, noteIn, huntTick, buzzNear, decorate, jingle, drama, ui, destroy, debug, sticker };
}
