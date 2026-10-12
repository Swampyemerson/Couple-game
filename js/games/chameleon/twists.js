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
/** Three seeded, well-separated swatches from the map's own colours (its probes), as '#rrggbb'. */
export function paletteFor(seed, round, probes) {
  const hexes = []; for (const p of probes || []) if (p && /^#[0-9a-f]{6}$/i.test(p.hex || '') && !hexes.some((h) => dist2(h, p.hex) < 600)) hexes.push(p.hex.toLowerCase());
  const rnd = seeded(`palette:${seed}:${round}`);
  const fallback = ['#d9534f', '#3b7ddd', '#e8c547', '#4b9f6a', '#8e6bbf', '#f2eadf'];
  for (const f of fallback) { if (hexes.length >= 4) break; if (!hexes.some((h) => dist2(h, f) < 3000)) hexes.push(f); }
  const out = [hexes.splice(rnd.int(hexes.length), 1)[0]];
  while (out.length < 3 && hexes.length) {
    // the next swatch: the leftover colour farthest from the ones chosen (ties by the seed)
    let bi = 0; let bd = -1;
    for (let i = 0; i < hexes.length; i++) { const d = Math.min(...out.map((o) => dist2(o, hexes[i]))) * (0.85 + 0.3 * rnd()); if (d > bd) { bd = d; bi = i; } }
    out.push(hexes.splice(bi, 1)[0]);
  }
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
