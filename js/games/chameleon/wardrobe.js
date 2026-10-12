// Wardrobe: unlockable looks that paint can't cover: eye colour, eye shape, a tail charm and an
// idle twitch (plus a fifth slot, "trim": a gold crest, a tail stripe, rosy cheeks, a neck ribbon,
// each earned from the rivalry stats). Unlocks are earned from the shared records (records.js) and live in the shared
// data doc as `unlock_${w}_${key}${k}` (Rail Rush's shape); what each person WEARS is this
// device's pick (localStorage), guarded by unlocked() when resolved, and sent to the partner
// as one small int per slot (reliable `wear`), so both phones draw the same chameleon.
import { esc, fmtTime } from './util.js';
import { portraitImg, portraitOk } from './gallery.js';

export const STYLES = [
  { key: 'eye', k: 0, name: 'Amber', how: '' },
  { key: 'eye', k: 1, name: 'Emerald', how: 'Survive 3 hunts', test: (S) => S.surv >= 3 },
  { key: 'eye', k: 2, name: 'Ruby', how: 'Tag someone in under 15 s', test: (S) => S.findMs > 0 && S.findMs <= 15000 },
  { key: 'eye', k: 3, name: 'Gold', how: 'Survive a hunt at 90 % blend', test: (S) => S.blendSurv >= 90 },
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
  // trim: visible from across a room (drawn on a chameleon that isn't hiding), earned from the rivalry stats
  { key: 'trim', k: 0, name: 'Bare', how: '' },
  { key: 'trim', k: 1, name: 'Gold crest', how: 'Take the Cup', test: (S) => S.cups >= 1 },
  { key: 'trim', k: 2, name: 'Tail stripe', how: 'Dodge 3 whisker shots', test: (S) => S.whisker >= 3 },
  { key: 'trim', k: 3, name: 'Rosy cheeks', how: 'Call it 3 times running', test: (S) => S.callstreak >= 3 },
  { key: 'trim', k: 4, name: 'Neck ribbon', how: 'Leave a note on your skin', test: (S) => S.notes >= 1 },
];
export const SLOTS = ['eye', 'shape', 'charm', 'twitch', 'trim'];
export const SLOT_LABEL = { eye: 'Eyes', shape: 'Eye shape', charm: 'Tail charm', twitch: 'Idle', trim: 'Trim' };
/** Progress toward an unlock as [have, need] (the locked tile prints "2 / 3"). */
export function progressOf(st, S) {
  switch (`${st.key}${st.k}`) {
    case 'eye1': return [Math.min(3, S.surv), 3];
    case 'eye2': return [S.findMs > 0 && S.findMs <= 15000 ? 1 : 0, 1];
    case 'eye3': return [S.blendSurv >= 90 ? 1 : 0, 1];
    case 'eye4': return [Math.min(3, S.ceiling), 3];
    case 'shape1': return [Math.min(1, S.dbwins), 1];
    case 'shape2': return [Math.min(5, S.staredBest), 5];
    case 'charm1': return [Math.min(10, S.rounds), 10];
    case 'charm2': return [Math.min(1, S.hang), 1];
    case 'charm3': return [Math.min(25, S.strokes), 25];
    case 'twitch1': return [Math.min(3, S.streakBest), 3];
    case 'twitch2': return [Math.min(3, S.wins), 3];
    case 'trim1': return [Math.min(1, S.cups), 1];
    case 'trim2': return [Math.min(3, S.whisker), 3];
    case 'trim3': return [Math.min(3, S.callstreak), 3];
    case 'trim4': return [Math.min(1, S.notes), 1];
    default: return null;
  }
}
/** Iris colours per eye k (0 = the plain white ring). */
export const EYE_RGB = [null, [0.36, 0.86, 0.5], [0.96, 0.3, 0.38], [1, 0.8, 0.22], [0.62, 0.45, 0.98]];

const KEY = 'chm.wear.v1';
export function loadWear() { try { return { eye: 0, shape: 0, charm: 0, twitch: 0, trim: 0, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch { return { eye: 0, shape: 0, charm: 0, twitch: 0, trim: 0 }; } }
export function saveWear(wear) { try { localStorage.setItem(KEY, JSON.stringify(wear)); } catch { /* private mode */ } }

export const unlocked = (d, w, st) => st.k === 0 || !!d[`unlock_${w}_${st.key}${st.k}`];
/** Stats for the unlock tests, from the shared data for one person. */
export function statsOf(d, w) {
  const g = (k) => d[`${w}_${k}`] | 0;
  return { surv: g('surv'), findMs: g('find_ms'), ghost: g('ghost'), blend: g('blend'), blendSurv: g('blend_surv'), ceiling: g('surf_ceiling') + g('surf_hang'), dbwins: g('dbwins'), stared: g('stared'), rounds: g('rounds'), hang: g('surf_hang'), strokes: g('strokes'), streakBest: g('streak_best'), wins: g('wins'), cups: g('cups'), whisker: g('whisker'), callstreak: g('callstreak'), notes: g('notes'), staredBest: g('stared') };
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
  const out = { eye: 0, shape: 0, charm: 0, twitch: 0, trim: 0 };
  for (const key of SLOTS) {
    const k = picks[key] | 0; const st = STYLES.find((x) => x.key === key && x.k === k);
    out[key] = st && unlocked(d, w, st) ? k : 0;
  }
  return out;
}
/** Pack / unpack the worn set into one small int for the wire. The first four slots keep their bits
 *  (a value from an older phone has trim 0); the trim slot takes bits 12–14. */
export const packWear = (wr) => (wr.eye | 0) + (wr.shape | 0) * 8 + (wr.charm | 0) * 64 + (wr.twitch | 0) * 512 + (wr.trim | 0) * 4096;
export const unpackWear = (n) => ({ eye: n & 7, shape: (n >> 3) & 7, charm: (n >> 6) & 7, twitch: (n >> 9) & 7, trim: (n >> 12) & 7 });
/** How many more of something until the unlock (for the locked tile's tap). */
export function hintFor(st, S) {
  switch (`${st.key}${st.k}`) {
    case 'eye1': return `Survive ${Math.max(1, 3 - S.surv)} more hunt${3 - S.surv === 1 ? '' : 's'}`;
    case 'eye2': return S.findMs ? `Your fastest tag is ${(S.findMs / 1000).toFixed(1)} s: beat 15 s` : 'Tag someone in under 15 s';
    case 'eye3': return S.blendSurv ? `Your best hide that lasted was ${S.blendSurv} % blend: get to 90 and survive` : S.blend ? `Your best blend is ${S.blend} %: get to 90 on a calm surface, then survive the hunt` : 'Lock in at 90 % blend or better, then survive the hunt';
    case 'eye4': return `Survive on a ceiling ${Math.max(1, 3 - S.ceiling)} more time${3 - S.ceiling === 1 ? '' : 's'}`;
    case 'shape1': return 'Win a round of Double Blind (two phones)';
    case 'shape2': return 'Get stared at 5 times in one hunt and live';
    case 'charm1': return `Play ${Math.max(1, 10 - S.rounds)} more round${10 - S.rounds === 1 ? '' : 's'}`;
    case 'charm2': return 'Survive a hunt hanging from a ceiling';
    case 'charm3': return `${Math.max(1, 25 - S.strokes)} more brush strokes in one hide (best ${S.strokes})`;
    case 'twitch1': return `Win 3 rounds in a row (best ${S.streakBest})`;
    case 'twitch2': return `Win ${Math.max(1, 3 - S.wins)} more match${3 - S.wins === 1 ? '' : 'es'}`;
    case 'trim1': return 'Win a match to take the Cup (from the holder, or while nobody holds it)';
    case 'trim2': return `Dodge ${Math.max(1, 3 - S.whisker)} more whisker shot${3 - S.whisker === 1 ? '' : 's'}: a miss that just brushes your skin`;
    case 'trim3': return `Call the hide right ${Math.max(1, 3 - S.callstreak)} more time${3 - S.callstreak === 1 ? '' : 's'} running (best ${S.callstreak})`;
    case 'trim4': return 'Type a note when you lock in your hide';
    default: return st.how;
  }
}

const SVG = (cls, body) => `<svg class="chm-wt-svg ${cls}" viewBox="0 0 40 40" aria-hidden="true">${body}</svg>`;
const TILE_ART = {
  eye: (k) => `<i class="chm-wt-eye e${k}"><b></b></i>`,
  shape: (k) => `<i class="chm-wt-eye s${k}"><b></b></i>`,
  charm: (k) => `<i class="chm-wt-charm c${k}"></i>`,
  twitch: (k) => `<i class="chm-wt-tw t${k}"></i>`,
  // trim: riso stickers drawn with the ink tokens (see CARDS_CSS .chm-wt-svg)
  trim: (k) => (k === 1 ? SVG('trim1', '<path class="i1" d="M5 30 L9 11 L15 22 L20 7 L25 22 L31 11 L35 30 Z"/><path class="i2" d="M5 30 H35 V34 H5 Z"/>')
    : k === 2 ? SVG('trim2', '<path class="i3" d="M6 30 C6 14 22 8 30 14 C37 19 33 32 24 31 C17 30 17 22 23 21"/><path class="i1" d="M10 22 L15 24 M13 15 L18 18 M23 11 L25 16" />')
      : k === 3 ? SVG('trim3', '<ellipse class="i4" cx="20" cy="22" rx="15" ry="13"/><ellipse class="i5" cx="11" cy="25" rx="5" ry="3.4"/><ellipse class="i5" cx="29" cy="25" rx="5" ry="3.4"/><circle class="i6" cx="14" cy="17" r="2.2"/><circle class="i6" cx="26" cy="17" r="2.2"/>')
        : k === 4 ? SVG('trim4', '<path class="i7" d="M6 16 Q20 28 34 16"/><path class="i1" d="M20 25 L11 33 L16 33 Z M20 25 L29 33 L24 33 Z"/><circle class="i2" cx="20" cy="25" r="3"/>')
          : '<i class="chm-wt-charm c0"></i>'),
};
const LOCK = '<svg class="chm-wt-lock" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.6"/><path d="M5.2 7V5.2a2.8 2.8 0 015.6 0V7"/></svg>';
/** The wardrobe sheet: rows of sticker tiles; locked tiles show the look in colour with a lock badge and progress ("2 / 3"). */
export function wardrobeSheet(api, { w, d, picks, local = false }) {
  const S = statsOf(d, w);
  const rows = SLOTS.map((key) => {
    const tiles = STYLES.filter((x) => x.key === key).map((st) => {
      const un = unlocked(d, w, st); const on = (picks[key] | 0) === st.k;
      const pr = !un ? progressOf(st, S) : null;
      return `<button class="chm-wt ${un ? '' : 'locked'} ${on ? 'on' : ''}" data-wear="${key}" data-k="${st.k}" aria-pressed="${on}" ${un ? '' : `data-hint="${esc(hintFor(st, S))}" aria-label="${esc(st.name)}, locked: ${esc(st.how)}${pr ? ` (${pr[0]} of ${pr[1]})` : ''}"`}>${un ? '' : LOCK}${TILE_ART[key](st.k)}<b>${esc(st.name)}</b>${st.how ? `<small>${esc(st.how)}</small>` : ''}${pr ? `<s class="chm-prog" data-prog="${pr[0]}/${pr[1]}">${pr[0]} / ${pr[1]}</s>` : ''}</button>`;
    }).join('');
    return `<h3>${SLOT_LABEL[key]}${key === 'trim' ? ' <small>seen from across the room (not while you hide)</small>' : ''}</h3><div class="chm-wrow">${tiles}</div>`;
  }).join('');
  const earned = STYLES.filter((st) => st.k && unlocked(d, w, st)).length; const total = STYLES.filter((st) => st.k).length;
  const pimg = portraitOk(String(d[`${w}_portrait`] || ''), d[`${w}_portrait_ms`] | 0) ? portraitImg(String(d[`${w}_portrait`]), w) : '';
  return `<div class="chm-sheetwrap" role="dialog" aria-label="Wardrobe"><div class="chm-sheet chm-wardrobe chm-sticker" data-scroll>
    <div class="chm-sheethead"><h2>${esc(api.name(w))}’s wardrobe</h2><button class="chm-done" data-act="wardrobe">Done</button></div>
    ${local ? `<div class="chm-chips">${['a', 'b'].map((x) => `<button class="chm-chip p${x} ${x === w ? 'on' : ''}" data-wfor="${x}"><i></i>${esc(api.name(x))}</button>`).join('')}</div>` : ''}
    <p class="chm-wait">${earned} of ${total} unlocked · paint can’t cover these</p>
    ${pimg ? `<figure class="chm-port chm-port-big p${w}" data-portrait="${w}">${pimg}<figcaption>Best hide ${fmtTime(d[`${w}_portrait_ms`] | 0)}</figcaption></figure>` : ''}
    ${d[`${w}_creative`] ? `<div class="chm-ribbon">Creative hide ×${d[`${w}_creative`] | 0}</div>` : ''}
    ${rows}
    <button class="chm-go" data-act="wardrobe">Done</button>
  </div></div>`;
}
