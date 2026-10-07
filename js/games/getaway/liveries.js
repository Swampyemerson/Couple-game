// Getaway liveries: unlockable paint jobs for the runner and cruiser variants for the cop, earned
// by milestones (the Rail Rush pattern), kept in the shared game data per person
// (`unlock_<w>_<kind><k>`, via api.data()), chosen per device in Settings → This phone → Livery,
// and told to the partner over the link so they see it. A livery only changes the colours and
// decals of the existing car model (carmodel.js buildPlayerCar `livery`): no extra draw calls.
//
// Career counters come from the flat record keys in the same shared doc (records.js careerFrom:
// couple + practice summed): { esc, heat, bust, fastBust, pits, topBoost, wins }. (The doc keeps
// numbers only, so the old `career_<w>` object never persisted.)
import { careerFrom } from './records.js';

export const LIVERIES = {
  runner: [
    { k: 0, name: 'Plain', how: '' },
    { k: 1, name: 'Racing stripe', how: 'Escape once', test: (c) => c.esc >= 1 },
    { k: 2, name: 'Rally', how: 'Lose the heat 3 times', test: (c) => c.heat >= 3 },
    { k: 3, name: 'Flames', how: '175 km/h on nitro', test: (c) => c.topBoost >= 175 },
    { k: 4, name: 'Gold roof', how: 'Win 3 matches', test: (c) => c.wins >= 3 },
  ],
  cop: [
    { k: 0, name: 'Black & white', how: '' },
    { k: 1, name: 'Undercover', how: '5 busts', test: (c) => c.bust >= 5 },
    { k: 2, name: 'Highway patrol', how: 'A bust under 30 s', test: (c) => c.fastBust > 0 && c.fastBust <= 30 },
    { k: 3, name: 'Light-up', how: '10 PITs landed', test: (c) => c.pits >= 10 },
  ],
};
export const CAREER0 = { esc: 0, heat: 0, bust: 0, fastBust: 0, pits: 0, topBoost: 0, wins: 0 };

export const liveryKey = (w, kind, k) => `unlock_${w}_${kind}${k}`;
export const careerKey = (w) => `career_${w}`;
export function careerOf(data, w) { return { ...CAREER0, ...careerFrom(data || {}, w) }; }
/** Is livery k of kind unlocked for person w? (0 always.) */
export function liveryUnlocked(data, w, kind, k) { return !k || !!(data && data[liveryKey(w, kind, k)]); }
/** The livery k if person w has it, else 0 (what the car is drawn with). */
export function liveryFor(data, w, kind, k) { const L = LIVERIES[kind]; k |= 0; return L && L[k] && liveryUnlocked(data, w, kind, k) ? k : 0; }
/**
 * Fold a round's events into w's career and find what it unlocks. ev: { esc, heat, bust, bustT (s),
 * pits, topBoost (km/h), win } (any missing). Returns { career, patch, pops: [{ kind, k, name }] };
 * patch is what to api.setData() (empty when nothing changed).
 */
export function careerUpdate(data, w, ev) {
  const c = careerOf(data, w); const before = JSON.stringify(c);
  if (ev.esc) c.esc += 1;
  if (ev.heat) c.heat += 1;
  if (ev.bust) { c.bust += 1; if (ev.bustT > 0 && (!c.fastBust || ev.bustT < c.fastBust)) c.fastBust = Math.round(ev.bustT * 10) / 10; }
  if (ev.pits) c.pits += ev.pits | 0;
  if (ev.topBoost > c.topBoost) c.topBoost = Math.round(ev.topBoost);
  if (ev.win) c.wins += 1;
  const patch = {}; const pops = [];
  if (JSON.stringify(c) !== before) patch[careerKey(w)] = c;
  for (const kind of Object.keys(LIVERIES)) {
    for (const L of LIVERIES[kind]) {
      if (!L.test || liveryUnlocked(data, w, kind, L.k) || patch[liveryKey(w, kind, L.k)]) continue;
      if (L.test(c)) { patch[liveryKey(w, kind, L.k)] = 1; pops.push({ kind, k: L.k, name: L.name }); }
    }
  }
  return { career: c, patch, pops };
}
/** Liveries person w has earned but not yet been given (data = the doc with this round's records in). */
export function checkUnlocks(data, w) {
  const c = careerOf(data, w); const patch = {}; const pops = [];
  for (const kind of Object.keys(LIVERIES)) {
    for (const L of LIVERIES[kind]) {
      if (!L.test || liveryUnlocked(data, w, kind, L.k)) continue;
      if (L.test(c)) { patch[liveryKey(w, kind, L.k)] = 1; pops.push({ kind, k: L.k, name: L.name }); }
    }
  }
  return { patch, pops };
}
/** Rows for the settings sheet: [{ k, name, how, on (unlocked), cur }] per kind. */
export function liveryRows(data, w, chosen) {
  const out = {};
  for (const kind of Object.keys(LIVERIES)) out[kind] = LIVERIES[kind].map((L) => ({ k: L.k, name: L.name, how: L.how, on: liveryUnlocked(data, w, kind, L.k), cur: ((chosen && chosen[kind]) | 0) === L.k }));
  return out;
}
