// Wardrobe: unlockable looks that paint can't cover: eye colour, eye shape, a tail charm and an
// idle twitch. Unlocks are earned from the shared records (records.js) and live in the shared
// data doc as `unlock_${w}_${key}${k}` (Rail Rush's shape); what each person WEARS is this
// device's pick (localStorage), guarded by unlocked() when resolved, and sent to the partner
// as one small int per slot (reliable `wear`), so both phones draw the same chameleon.
import { esc } from './util.js';

export const STYLES = [
  { key: 'eye', k: 0, name: 'Amber', how: '' },
  { key: 'eye', k: 1, name: 'Emerald', how: 'Survive 3 hunts', test: (S) => S.surv >= 3 },
  { key: 'eye', k: 2, name: 'Ruby', how: 'Tag someone in under 15 s', test: (S) => S.findMs > 0 && S.findMs <= 15000 },
  { key: 'eye', k: 3, name: 'Gold', how: 'Blend 90 % or better', test: (S) => S.blend >= 90 },
  { key: 'eye', k: 4, name: 'Galaxy', how: 'Survive on a ceiling 3 times', test: (S) => S.ceiling >= 3 },
  { key: 'shape', k: 0, name: 'Round', how: '' },
  { key: 'shape', k: 1, name: 'Cat slit', how: 'Win a Double Blind round', test: (S) => S.dbwins >= 1 },
  { key: 'shape', k: 2, name: 'Wide eyed', how: 'Get stared at 5 times in one hunt', test: (S) => S.stared >= 5 },
  { key: 'charm', k: 0, name: 'None', how: '' },
  { key: 'charm', k: 1, name: 'Bell', how: 'Play 10 rounds', test: (S) => S.rounds >= 10 },
  { key: 'charm', k: 2, name: 'Bow', how: 'Survive a hunt hanging', test: (S) => S.hang >= 1 },
  { key: 'charm', k: 3, name: 'Paintbrush', how: '25 brush strokes in one hide', test: (S) => S.strokes >= 25 },
  { key: 'twitch', k: 0, name: 'Still', how: '' },
  { key: 'twitch', k: 1, name: 'Head bob', how: 'A 3-round streak', test: (S) => S.streakBest >= 3 },
  { key: 'twitch', k: 2, name: 'Tail wag', how: 'Win 3 matches', test: (S) => S.wins >= 3 },
];
export const SLOTS = ['eye', 'shape', 'charm', 'twitch'];
export const SLOT_LABEL = { eye: 'Eyes', shape: 'Eye shape', charm: 'Tail charm', twitch: 'Idle' };
/** Iris colours per eye k (0 = the plain white ring). */
export const EYE_RGB = [null, [0.36, 0.86, 0.5], [0.96, 0.3, 0.38], [1, 0.8, 0.22], [0.62, 0.45, 0.98]];

const KEY = 'chm.wear.v1';
export function loadWear() { try { return { eye: 0, shape: 0, charm: 0, twitch: 0, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch { return { eye: 0, shape: 0, charm: 0, twitch: 0 }; } }
export function saveWear(wear) { try { localStorage.setItem(KEY, JSON.stringify(wear)); } catch { /* private mode */ } }

export const unlocked = (d, w, st) => st.k === 0 || !!d[`unlock_${w}_${st.key}${st.k}`];
/** Stats for the unlock tests, from the shared data for one person. */
export function statsOf(d, w) {
  const g = (k) => d[`${w}_${k}`] | 0;
  return { surv: g('surv'), findMs: g('find_ms'), ghost: g('ghost'), blend: g('blend'), ceiling: g('surf_ceiling') + g('surf_hang'), dbwins: g('dbwins'), stared: g('stared'), rounds: g('rounds'), hang: g('surf_hang'), strokes: g('strokes'), streakBest: g('streak_best'), wins: g('wins') };
}
/** New unlocks for `w` given the data (after a patch has been folded in): [{ w, st }] and the patch. */
export function newUnlocks(d, w) {
  const S = statsOf(d, w); const patch = {}; const pops = [];
  for (const st of STYLES) {
    if (!st.test || unlocked(d, w, st)) continue;
    if (st.test(S)) { patch[`unlock_${w}_${st.key}${st.k}`] = 1; pops.push({ w, st }); }
  }
  return { patch, pops };
}
/** What `w` actually wears: the picks, each kept only if earned. */
export function resolveWear(d, w, picks) {
  const out = { eye: 0, shape: 0, charm: 0, twitch: 0 };
  for (const key of SLOTS) {
    const k = picks[key] | 0; const st = STYLES.find((x) => x.key === key && x.k === k);
    out[key] = st && unlocked(d, w, st) ? k : 0;
  }
  return out;
}
/** Pack / unpack the worn set into one small int for the wire. */
export const packWear = (wr) => (wr.eye | 0) + (wr.shape | 0) * 8 + (wr.charm | 0) * 64 + (wr.twitch | 0) * 512;
export const unpackWear = (n) => ({ eye: n & 7, shape: (n >> 3) & 7, charm: (n >> 6) & 7, twitch: (n >> 9) & 7 });
/** How many more of something until the unlock (for the locked tile's tap). */
export function hintFor(st, S) {
  switch (`${st.key}${st.k}`) {
    case 'eye1': return `Survive ${Math.max(1, 3 - S.surv)} more hunt${3 - S.surv === 1 ? '' : 's'}`;
    case 'eye2': return S.findMs ? `Your fastest tag is ${(S.findMs / 1000).toFixed(1)} s: beat 15 s` : 'Tag someone in under 15 s';
    case 'eye3': return S.blend ? `Your best blend is ${S.blend} %: stamp the surface you’re on and get to 90` : 'Blend 90 % or better at the lock (Stamp helps)';
    case 'eye4': return `Survive on a ceiling ${Math.max(1, 3 - S.ceiling)} more time${3 - S.ceiling === 1 ? '' : 's'}`;
    case 'shape1': return 'Win a round of Double Blind (two phones)';
    case 'shape2': return 'Get stared at 5 times in one hunt and live';
    case 'charm1': return `Play ${Math.max(1, 10 - S.rounds)} more round${10 - S.rounds === 1 ? '' : 's'}`;
    case 'charm2': return 'Survive a hunt hanging from a ceiling';
    case 'charm3': return `${Math.max(1, 25 - S.strokes)} more brush strokes in one hide (best ${S.strokes})`;
    case 'twitch1': return `Win 3 rounds in a row (best ${S.streakBest})`;
    case 'twitch2': return `Win ${Math.max(1, 3 - S.wins)} more match${3 - S.wins === 1 ? '' : 'es'}`;
    default: return st.how;
  }
}

const TILE_ART = {
  eye: (k) => `<i class="chm-wt-eye e${k}"><b></b></i>`,
  shape: (k) => `<i class="chm-wt-eye s${k}"><b></b></i>`,
  charm: (k) => `<i class="chm-wt-charm c${k}"></i>`,
  twitch: (k) => `<i class="chm-wt-tw t${k}"></i>`,
};
/** The wardrobe sheet: rows of sticker tiles; locked tiles print the condition in grey halftone. */
export function wardrobeSheet(api, { w, d, picks, local = false }) {
  const S = statsOf(d, w);
  const rows = SLOTS.map((key) => {
    const tiles = STYLES.filter((x) => x.key === key).map((st) => {
      const un = unlocked(d, w, st); const on = (picks[key] | 0) === st.k;
      return `<button class="chm-wt ${un ? '' : 'locked'} ${on ? 'on' : ''}" data-wear="${key}" data-k="${st.k}" aria-pressed="${on}" ${un ? '' : `data-hint="${esc(hintFor(st, S))}"`}>${TILE_ART[key](st.k)}<b>${esc(st.name)}</b>${st.how ? `<small>${esc(st.how)}</small>` : ''}</button>`;
    }).join('');
    return `<h3>${SLOT_LABEL[key]}</h3><div class="chm-wrow">${tiles}</div>`;
  }).join('');
  const earned = STYLES.filter((st) => st.k && unlocked(d, w, st)).length; const total = STYLES.filter((st) => st.k).length;
  return `<div class="chm-sheetwrap" role="dialog" aria-label="Wardrobe"><div class="chm-sheet chm-wardrobe chm-sticker" data-scroll>
    <div class="chm-sheethead"><h2>${esc(api.name(w))}’s wardrobe</h2><button class="chm-done" data-act="wardrobe">Done</button></div>
    ${local ? `<div class="chm-chips">${['a', 'b'].map((x) => `<button class="chm-chip p${x} ${x === w ? 'on' : ''}" data-wfor="${x}"><i></i>${esc(api.name(x))}</button>`).join('')}</div>` : ''}
    <p class="chm-wait">${earned} of ${total} unlocked · paint can’t cover these</p>
    ${rows}
    <button class="chm-go" data-act="wardrobe">Done</button>
  </div></div>`;
}
