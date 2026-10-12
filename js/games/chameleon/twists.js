// Blend & Seek — round twists, the underdog overlay and the small pure helpers behind sudden death
// and the called-it streak (update pass). Pure data and functions: game.js owns the state, stage.js
// and fx.js draw the moods. Everything that both phones must agree on (which round has which
// twist, the bounty spot, the three colours) derives from the match seed, so it travels only as
// the `twists` array inside the match info; nothing here uses Math.random.
import { seeded, mixHex, hexToRgb, esc } from './util.js';
import { MAPS, TWISTS, mapArea } from './maps.js';
import { LOCAL_DEAD } from './rules.js';

/** Fog starts closing after this fraction of the hunt, in FOG_STEPS steps, down to FOG_END × the map's fog. */
export const FOG = { from: 2 / 3, end: 0.45, steps: 6 };
/** Dusk dims the lights over the hunt in DUSK.steps steps; the lights never go below these fractions. */
export const DUSK = { steps: 12, hemi: 0.45, sun: 0.6, tint: '#2b2447', tintK: 0.55, glint: 1.7 };
/** Bounty spot: radius (m) of the prize, the hider's multiplier on a survive, the seeker's bonus on a tag. */
export const BOUNTY = { r: 3, mult: 1.5, tag: 15 };
/** The underdog gap (points); XL maps are bigger, so every point is cheaper there (× 1.5). */
export const UNDERDOG = { gap: 25, xl: 1.5, hotseatHideMs: 10000 };
/** Sudden death: a quick pair of rounds. */
export const SUDDEN = { hide: 20000, seek: 30000, dbSeek: 60000, rounds: 2, dbRounds: 1 };

const bigMap = (id) => { const e = MAPS.find((m) => m.id === id); return !!e && mapArea(e) > 160; };

/**
 * The deck. `applies(mode, local, mapId)`: can this twist run in that mode / on one phone / on that
 * map? (Each was checked in two-device play and in hotseat; Double Blind is noted per twist.)
 *  - fog: only where the fog is ever in the picture: the big maps (the dioramas fit inside it);
 *    both modes (a hunted double-blind hider is also a hunter, so it is symmetric).
 *  - dusk: every map and mode.
 *  - colours: every map and mode (in Double Blind both hide, so both are locked).
 *  - bounty: Hide & Seek only (its prize is a hider's survive / a seeker's tag).
 */
export const TWIST_DECK = [
  { id: 'fog', label: 'Fog rolls in', short: 'Fog', sub: 'The fog closes in over the last third of the hunt: paint pellets stop short, hiders get a comeback.', applies: (mode, local, mapId) => bigMap(mapId) },
  { id: 'dusk', label: 'Dusk', short: 'Dusk', sub: 'The light fades through the hunt. Eyes glint brighter in the dark.', applies: () => true },
  { id: 'colours', label: 'Three colours', short: '3 colours', sub: 'The hider paints with just three colours from the room. No Pick, no Stamp.', applies: () => true },
  { id: 'bounty', label: 'Bounty spot', short: 'Bounty', sub: `A ring marks a spot. Survive within ${BOUNTY.r} m of it: hider points ×${BOUNTY.mult}. Tag within ${BOUNTY.r} m: seeker +${BOUNTY.tag}.`, applies: (mode) => mode === 'hs' },
];
export const twistById = (id) => TWIST_DECK.find((t) => t.id === id) || null;

/**
 * Which round gets which twist: an array of `rounds` entries, a twist id or null, seeded from the
 * match seed. 'some' = about half the rounds (rounds / 2, rounded) and never round 1; 'every' = every
 * round; 'off' = none. `mapId` is one map id or one per round (Mix it up). A twist never repeats
 * the previous round's, and one that doesn't apply (mode / one phone / map) is never drawn.
 */
export function pickTwists(seed, rounds, mode, local, mapId, freq = 'some') {
  const n = Math.max(0, rounds | 0);
  const out = new Array(n).fill(null);
  if (freq === 'off' || !n) return out;
  const rnd = seeded(`twists:${seed}`);
  const cand = []; for (let r = freq === 'every' ? 1 : 2; r <= n; r++) cand.push(r);
  let slots = cand;
  if (freq !== 'every') {
    const bag = cand.slice();
    for (let i = bag.length - 1; i > 0; i--) { const j = rnd.int(i + 1); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    slots = bag.slice(0, Math.min(cand.length, Math.max(1, Math.round(n / 2)))).sort((x, y) => x - y);
  }
  for (const r of slots) {
    const mid = Array.isArray(mapId) ? mapId[Math.min(r, mapId.length) - 1] : mapId;
    const ok = TWIST_DECK.filter((t) => t.applies(mode, !!local, mid));
    if (!ok.length) continue;
    const prev = out[r - 2] || null;
    const fresh = ok.filter((t) => t.id !== prev);
    const pool = fresh.length ? fresh : ok;
    out[r - 1] = pool[rnd.int(pool.length)].id;
  }
  return out;
}

/** The step (0..FOG.steps) the fog has closed to, `frac` of the hunt in. */
export function fogStep(frac) {
  if (!(frac > FOG.from)) return 0;
  return Math.min(FOG.steps, Math.ceil(((frac - FOG.from) / (1 - FOG.from)) * FOG.steps));
}
/** The mood for the fog at `step` over a base fog { near, far }. */
export function fogMood(base, step) {
  const k = 1 - (1 - FOG.end) * (step / FOG.steps);
  return { fogNear: base.near * k, fogFar: base.far * k };
}
/** The dusk step (0..DUSK.steps), `frac` of the hunt in. */
export function duskStep(frac) { return Math.max(0, Math.min(DUSK.steps, Math.floor(frac * DUSK.steps))); }
/** The mood for the dusk at `step`: the lights' intensities (absolute, from the stage's bases) and the sky tint. */
export function duskMood(step, baseHemi, baseSun, bgHex) {
  const d = step / DUSK.steps;
  return { hemi: baseHemi * (1 - (1 - DUSK.hemi) * d), sun: baseSun * (1 - (1 - DUSK.sun) * d), bg: step ? mixHex(bgHex, DUSK.tint, DUSK.tintK * d) : bgHex };
}

const dist2 = (a, b) => { const x = hexToRgb(a); const y = hexToRgb(b); return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2; };
const hex2 = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(252, Math.round(v / 4) * 4)).toString(16).padStart(2, '0')).join('');
/** sRGB hex -> CIE Lab (D65), for perceptual distances between swatches. */
export function labOf(hex) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = hexToRgb(hex).map(lin);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047; const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b; const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X); const fy = f(Y); const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** Perceptual distance (CIE76 ΔE) between two '#rrggbb' colours. */
export function deltaE(a, b) { const x = labOf(a); const y = labOf(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }
const chromaOf = (hex) => { const l = labOf(hex); return Math.hypot(l[1], l[2]); };

const SWATCH_CACHE = new WeakMap();
/**
 * The colours a map is made of, biggest first: [{ hex, w }], w = surface area (m²) wearing that colour.
 * Every triangle of the map's chunks (not the distant backdrop) contributes its area to the colours of
 * its atlas tile (a few dominant texels, sampled at fixed points of the deterministic atlas) tinted by
 * its vertex colour: the floor's checker gives both squares, a flat-coloured sofa its own colour.
 * Pure function of the map data, so both phones get the same list. Cached per map object.
 */
export function mapSwatches(map) {
  if (!map || !map.chunks || !map.atlas) return [];
  if (SWATCH_CACHE.has(map)) return SWATCH_CACHE.get(map);
  const A = map.atlas; const S = A.size; const H = A.height || S; const D = A.data;
  const tileCols = new Map(); // tile key -> [{ r, g, b, f }] (f: share of the tile)
  const colsOf = (px, py, pw, ph) => {
    const key = (px * 4096 + py) * 4096 + pw * 64 + ph; let c = tileCols.get(key); if (c) return c;
    const bins = new Map(); let n = 0; const G = 10;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = Math.min(S - 1, px + Math.floor(((i + 0.5) / G) * pw)); const y = Math.min(H - 1, py + Math.floor(((j + 0.5) / G) * ph)); const o = (y * S + x) * 4;
      const r = D[o]; const g = D[o + 1]; const b = D[o + 2]; const k = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
      let e = bins.get(k); if (!e) { e = { r: 0, g: 0, b: 0, c: 0 }; bins.set(k, e); }
      e.r += r; e.g += g; e.b += b; e.c++; n++;
    }
    c = [...bins.values()].sort((x, y) => y.c - x.c || x.r - y.r).slice(0, 3).map((e) => ({ r: e.r / e.c, g: e.g / e.c, b: e.b / e.c, f: e.c / n }));
    tileCols.set(key, c); return c;
  };
  const acc = new Map(); // quantised colour -> { r, g, b, w }
  for (const ch of map.chunks) {
    if (ch.backdrop) continue;
    const g = ch.geometry; const P = g.attributes.position.array; const T = g.attributes.tile.array; const C = g.attributes.color.array; const IX = g.index.array;
    for (let t = 0; t + 2 < ch.mainIndexCount; t += 3) {
      const a = IX[t]; const b = IX[t + 1]; const c = IX[t + 2];
      const ux = P[b * 3] - P[a * 3]; const uy = P[b * 3 + 1] - P[a * 3 + 1]; const uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3]; const vy = P[c * 3 + 1] - P[a * 3 + 1]; const vz = P[c * 3 + 2] - P[a * 3 + 2];
      const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      if (!(area > 1e-4)) continue;
      const cr = C[a * 3]; const cg = C[a * 3 + 1]; const cb = C[a * 3 + 2];
      const px = Math.round(T[a * 4] * S); const py = Math.round((1 - T[a * 4 + 1] - T[a * 4 + 3]) * H); const pw = Math.max(1, Math.round(T[a * 4 + 2] * S)); const ph = Math.max(1, Math.round(T[a * 4 + 3] * H));
      for (const tc of colsOf(px, py, pw, ph)) {
        const r = tc.r * cr; const gg = tc.g * cg; const bb = tc.b * cb; const k = (r >> 4) * 256 + (gg >> 4) * 16 + (bb >> 4);
        const w = area * tc.f; let e = acc.get(k); if (!e) { e = { r: 0, g: 0, b: 0, w: 0 }; acc.set(k, e); }
        e.r += r * w; e.g += gg * w; e.b += bb * w; e.w += w;
      }
    }
  }
  // merge near-identical colours into the heavier one (ΔE < 9), keep the top 14
  const list = [...acc.values()].filter((e) => e.w > 0).map((e) => ({ hex: hex2(e.r / e.w, e.g / e.w, e.b / e.w), w: e.w })).sort((x, y) => y.w - x.w || (x.hex < y.hex ? -1 : 1));
  const out = [];
  for (const e of list) { const m = out.find((o) => deltaE(o.hex, e.hex) < 9); if (m) m.w += e.w; else out.push({ ...e }); }
  out.sort((x, y) => y.w - x.w || (x.hex < y.hex ? -1 : 1)); out.length = Math.min(out.length, 14);
  SWATCH_CACHE.set(map, out);
  return out;
}

/** Colour distance a swatch must keep from the others (ΔE, CIE76). */
export const SWATCH_DE = 24;
/**
 * Three seeded, clearly different swatches from the map's own colours (`cands`: [{ hex, w? }] from
 * mapSwatches, or a map's probes): the first is one of the room's three biggest surfaces, so there is
 * always something to blend into; the others favour colours that are far from the chosen ones, sizeable
 * and not grey. Every pair is at least SWATCH_DE apart (ΔE); when the room is short of colours the
 * plain primaries fill in. '#rrggbb' strings, the same on both phones.
 */
export function paletteFor(seed, round, cands) {
  const list = []; for (const p of cands || []) if (p && /^#[0-9a-f]{6}$/i.test(p.hex || '')) list.push({ hex: p.hex.toLowerCase(), w: p.w > 0 ? +p.w : 1 });
  const rnd = seeded(`palette:${seed}:${round}`);
  const out = [];
  const top = list.slice().sort((x, y) => y.w - x.w).slice(0, 3);
  if (top.length) out.push(top[rnd.int(top.length)].hex);
  const wmax = Math.max(1e-6, ...list.map((c) => c.w));
  const far = (h) => Math.min(...out.map((o) => deltaE(o, h)));
  while (out.length < 3) {
    let best = null; let bs = -1;
    for (const c of list) {
      if (out.includes(c.hex)) continue;
      const d = far(c.hex); if (d < SWATCH_DE) continue;
      if (c.w < wmax * 0.03) continue; // a speck of colour on one prop is not the room's
      const sc = Math.min(d, 50) * Math.sqrt(c.w / wmax) * (0.2 + 0.8 * Math.min(1, chromaOf(c.hex) / 14)) * (0.4 + 1.2 * rnd()); // seeded: the room's characteristic colours take turns
      if (sc > bs) { bs = sc; best = c; }
    }
    if (!best) break;
    out.push(best.hex);
  }
  const fallback = ['#d9534f', '#3b7ddd', '#e8c547', '#4b9f6a', '#8e6bbf', '#f2eadf', '#2b2b33'];
  for (let k = rnd.int(fallback.length), n = 0; out.length < 3 && n < fallback.length; n++, k = (k + 1) % fallback.length) if (!out.length || far(fallback[k]) >= SWATCH_DE) out.push(fallback[k]);
  return out;
}

/**
 * The bounty spot: a seeded pick among `cands` ({ x, y, z } floor points) that sit at least `minD`
 * from every `avoid` point ({ x, z }), so it is never where someone starts. Falls back to the
 * farthest candidate when none is far enough. null when there are no candidates.
 */
export function pickBounty(seed, round, cands, avoid, minD = 5) {
  if (!cands || !cands.length) return null;
  const far = []; let best = null; let bestD = -1;
  for (const c of cands) {
    let d = Infinity; for (const a of avoid) d = Math.min(d, Math.hypot(c.x - a.x, c.z - a.z));
    if (d >= minD) far.push(c);
    if (d > bestD) { bestD = d; best = c; }
  }
  const rnd = seeded(`bounty:${seed}:${round}`);
  return far.length ? far[rnd.int(far.length)] : best;
}

/** The player trailing by the gap (× 1.5 on XL maps), else null. */
export function underdogOf(scores, xl) {
  const gap = Math.round(UNDERDOG.gap * (xl ? UNDERDOG.xl : 1));
  const d = scores.a - scores.b;
  return d <= -gap ? 'a' : d >= gap ? 'b' : null;
}

/** What a right wager call pays: base × min(3, streak). */
export const wagerPay = (base, streak) => base * Math.min(3, Math.max(1, streak | 0));

/**
 * Today's hide on one phone: the day's twist, unless it is one of the rules a hotseat can't play
 * (maps.js TWISTS: head start, paint while hunted), then the next one in the list that works.
 * cards.js shows this label on the Today button, game.js plays it.
 */
export function dailyTwistFor(plan, local) {
  if (!local || !plan || !plan.twist) return plan ? plan.twist : null;
  const alive = (t) => !Object.keys(t.rules || {}).some((k) => LOCAL_DEAD.includes(k));
  if (alive(plan.twist)) return plan.twist;
  const i = Math.max(0, TWISTS.findIndex((t) => t.id === plan.twist.id));
  for (let k = 1; k <= TWISTS.length; k++) { const t = TWISTS[(i + k) % TWISTS.length]; if (alive(t)) return t; }
  return plan.twist;
}

// ── cards: pieces the game splices into the title / blind / curtain / recap / final cards ──
export const TWIST_CSS = `
.chm .chm-twist { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 2px 8px; margin: 8px 0 2px; padding: 6px 12px; border: 2.5px solid var(--g-ink); border-radius: 12px; background: var(--g-hl); color: var(--g-on-ink); font-weight: 800; font-size: .82rem; line-height: 1.25; transform: rotate(-1.2deg); box-shadow: var(--g-shadow, 3px 3px 0 var(--g-edge)); }
.chm .chm-twist b { font-family: var(--g-font-display); font-weight: 900; font-size: .95rem; letter-spacing: .04em; text-transform: uppercase; }
.chm .chm-twist.sd { background: var(--g-ink); color: var(--g-bg); }
.chm .chm-twisttag { font-weight: 900; white-space: nowrap; }
.chm .chm-twistrow { margin: 6px 0 0; }
.chm .chm-twistrow .chm-seg2 button { min-height: 44px; }
/* hand-over curtains: the main button is always on screen. It sticks to the foot of the card whenever the card has to scroll (chips, twist and underdog stickers make it tall), and a short landscape phone (iPhone 13: 342 px) also packs the stickers and the call chips into single lines. */
.chm .chm-over[data-curtain] .chm-go { position: sticky; bottom: 0; z-index: 2; margin-top: auto; box-shadow: 0 0 0 8px var(--g-card), var(--g-shadow, 3px 3px 0 var(--g-edge)); }
@media (max-height: 520px) and (orientation: landscape) {
  .chm .chm-over[data-curtain] .chm-card { gap: 6px; padding: 8px 14px 10px; width: min(100%, 560px); }
  .chm .chm-over[data-curtain] .chm-card h2 { font-size: 1.25rem; }
  .chm .chm-over[data-curtain] .chm-card p { font-size: .84rem; line-height: 1.25; }
  .chm .chm-over[data-curtain] .chm-twist { margin: 0; padding: 3px 10px; font-size: .74rem; transform: none; flex-wrap: nowrap; gap: 0 8px; box-shadow: none; }
  .chm .chm-over[data-curtain] .chm-twist b { font-size: .8rem; white-space: nowrap; }
  .chm .chm-over[data-curtain] .chm-twist[data-twist] span { display: none; }
  .chm .chm-over[data-curtain] .chm-call { flex-direction: row; align-items: center; justify-content: center; flex-wrap: wrap; gap: 4px 10px; padding: 4px 8px; }
  .chm .chm-over[data-curtain] .chm-call .chm-chips { gap: 6px; }
}
`;
/** The announcement sticker. */
export function twistChip(t, extra = '') {
  if (!t) return '';
  return `<div class="chm-twist" data-twist="${esc(t.id)}"><b>${esc(t.label)}</b><span>${esc(t.sub)}${extra ? ` ${esc(extra)}` : ''}</span></div>`;
}
/** A small sticker for the underdog boost and other one-liners. */
export function noteChip(key, label, text) {
  return `<div class="chm-twist" data-note="${esc(key)}"><b>${esc(label)}</b><span>${esc(text)}</span></div>`;
}
export function suddenChip(text, sub = '') {
  return `<div class="chm-twist sd" data-sudden="1"><b>${esc(text)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
}
/** Put `frag` inside a card's closing `</div></div>` (the card is the inner div), or after the first `</h2>`. */
export function inject(html, frag, where = 'end') {
  if (!frag || typeof html !== 'string') return html;
  if (where === 'afterH2') { const i = html.indexOf('</h2>'); if (i >= 0) return html.slice(0, i + 5) + frag + html.slice(i + 5); }
  if (where === 'afterP') { const i = html.indexOf('</p>'); if (i >= 0) return html.slice(0, i + 4) + frag + html.slice(i + 4); }
  const j = html.lastIndexOf('</div></div>');
  return j >= 0 ? html.slice(0, j) + frag + html.slice(j) : html + frag;
}
/** The recap's "Next: …" line gets the next round's twist as a tag at its end. */
export function tagNextLine(html, tag) {
  if (!tag) return html;
  const i = html.indexOf('chm-nextline');
  if (i < 0) return html;
  const j = html.indexOf('</p>', i);
  return j < 0 ? html : html.slice(0, j) + ` · ${tag}` + html.slice(j);
}
/** The settings sheet's rows for the three update-pass rules (spliced into the sheet; same markup as cards.js rows). */
export function twistRows(r, hs, canEdit) {
  const dis = canEdit ? '' : 'disabled';
  const seg = (k, items) => `<div class="chm-seg2" role="radiogroup">${items.map(([v, label]) => `<button class="${String(r[k]) === String(v) ? 'on' : ''}" data-lobby="rule" data-k="${k}" data-v="${v}" role="radio" aria-checked="${String(r[k]) === String(v)}" ${dis}>${label}</button>`).join('')}</div>`;
  const row = (label, hint, control) => `<div class="chm-set"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span>${control}</div>`;
  return `<h3>Twists &amp; comebacks</h3><div class="chm-sets" data-twistrows="1">`
    + row('Round twists', r.twists === 'off' ? 'Every round plays by the plain rules' : r.twists === 'every' ? 'Fog, dusk, three colours or a bounty spot every round' : 'About half the rounds (never the first) get fog, dusk, three colours or a bounty spot', seg('twists', [['off', 'Off'], ['some', 'Some'], ['every', 'Every']]))
    + (hs ? row('Underdog boost', r.underdog ? 'Trailing by 25+ points: +1 pellet seeking, +1 escape hiding' : 'No catch-up help', seg('underdog', [[true, 'On'], [false, 'Off']])) : '')
    + row('Sudden death', r.sudden ? (hs ? 'A tied match plays one more pair: 20 s hide, 30 s hunt' : 'A tied match plays one more round') : 'A tied match is a draw', seg('sudden', [[true, 'On'], [false, 'Off']]))
    + '</div>';
}
/** Splice twistRows into the settings sheet html just before its Timing section (else before the last Done button). */
export function injectRows(html, rows) {
  if (!rows || typeof html !== 'string' || html.includes('data-twistrows')) return html;
  let i = html.indexOf('<h3>Timing</h3>');
  if (i < 0) i = html.lastIndexOf('<button class="chm-go" data-act="settings">Done</button>');
  return i < 0 ? html : html.slice(0, i) + rows + html.slice(i);
}
