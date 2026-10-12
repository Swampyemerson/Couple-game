// Defuse: records, pure. The engine's per-game data (api.data / api.setData) only stores FLAT keys with number / string /
// boolean values, so everything is spelled as one flat key:
//   wins booms streak bestStreak                   totals (a boom resets streak)
//   best_<tier> bestWho_<tier> bestAt_<tier>       most seconds left on a win, who held the bomb, when
//   medal_<tier>                                   0..3, never goes down
//   clean_<tier>                                   wins with zero strikes
//   holder_<w>_wins / _booms / _clean              per person who held the bomb
//   manual_<w>_rounds / _strikes                   per person who read the manual
//   mods_<id>                                      modules solved
//   daily_<date>_<tier>_<w>                        Today's bomb: seconds left, 0 = boom (first attempt counts)
//   parN_<tier> parSum_<tier>                      Personal par: wins and the summed seconds USED on them (halved at 20 wins)
//   log                                            JSON string, the last 8 rounds
// Every read tolerates a missing doc, {}, wrong types, and the nested shape a server round trip could produce.
import { hash } from './util.js';
import { TIERS, tierOf } from './round.js';

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
/** Read a value by path from flat ('best_normal'), dotted ('best.normal') or nested ({ best: { normal } }) data. */
export function rd(d, ...path) {
  if (!isObj(d)) return undefined;
  const flat = path.join('_');
  if (flat in d) return d[flat];
  const dot = path.join('.');
  if (dot in d) return d[dot];
  let cur = d;
  for (const k of path) { if (!isObj(cur) || !(k in cur)) return undefined; cur = cur[k]; }
  return cur;
}
const num = (d, ...path) => { const v = rd(d, ...path); return nn(typeof v === 'string' ? Number(v) : v); };
const WHO = (w) => (w === 'a' || w === 'b' ? w : null);

export function medalFor(win, strikes, secs, T) {
  if (!win) return 0;
  if (strikes > 0) return 1;
  return secs * 2 > T.secs ? 3 : 2;
}
export const MEDAL_NAME = ['No medal yet', 'Bronze', 'Silver', 'Gold'];
export function nextMedalHint(medal) {
  return medal < 1 ? 'First medal: defuse it.' : medal === 1 ? 'Next medal: defuse it with zero strikes.' : medal === 2 ? 'Gold medal: zero strikes and more than half the clock left.' : '';
}

/** The tier's best: { secs, who, at }. Accepts a bare number (older shape) or a nested object. */
export function bestOf(d, tier) {
  let secs = num(d, 'best', tier);
  const v = rd(d, 'best', tier);
  let who = WHO(rd(d, 'bestWho', tier));
  let at = num(d, 'bestAt', tier);
  if (isObj(v)) { secs = nn(v.secs); who = WHO(v.who) || who; at = nn(v.at) || at; }
  return { secs, who, at };
}
export function readRecords(d) {
  const r = { wins: num(d, 'wins'), booms: num(d, 'booms'), streak: num(d, 'streak'), bestStreak: num(d, 'bestStreak'), best: {}, medal: {}, clean: {}, holder: { a: {}, b: {} }, manual: { a: {}, b: {} }, log: readLog(d) };
  for (const t of ['classic', 'chill', 'normal', 'spicy', 'wild']) {
    r.best[t] = bestOf(d, t);
    r.medal[t] = Math.min(3, num(d, 'medal', t) | 0);
    r.clean[t] = num(d, 'clean', t);
  }
  for (const w of ['a', 'b']) {
    r.holder[w] = { wins: num(d, 'holder', w, 'wins'), booms: num(d, 'holder', w, 'booms'), clean: num(d, 'holder', w, 'clean') };
    r.manual[w] = { rounds: num(d, 'manual', w, 'rounds'), strikes: num(d, 'manual', w, 'strikes') };
  }
  return r;
}
export function readLog(d) {
  let v = rd(d, 'log');
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  if (!Array.isArray(v)) return [];
  // entries from an unknown tier are dropped; seconds are held to the tier's clock (plus a gold module's bonus and some slack)
  return v.filter((e) => isObj(e) && tierOf(e.tier)).slice(-8).map((e) => ({ name: String(e.name || '').slice(0, 40), tier: e.tier, win: e.win ? 1 : 0, holder: WHO(e.holder), secs: Math.min(nn(e.secs), TIERS[e.tier].secs + 60) }));
}
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export const dailySeed = (date) => 'day-' + date;
export const dailyOf = (d, date, tier, w) => { const v = rd(d, 'daily', date, tier, w); return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null; };

/**
 * One finished round in, one flat patch out. o = { tier, T, win, secs, strikes, holder, reader, solved: [moduleIds], name, daily?: dateKey, at }
 * Returns { patch, info }; info drives the end card (new record, medal ups).
 */
export function applyResult(d, o) {
  const tier = o.tier;
  const patch = { v: 1 };
  const prev = bestOf(d, tier);
  const info = { prevBest: prev.secs, newRecord: false, firstWin: false, medalBefore: Math.min(3, num(d, 'medal', tier) | 0), medal: 0, medalUp: false, streak: 0, secs: o.secs };
  patch.wins = num(d, 'wins') + (o.win ? 1 : 0);
  patch.booms = num(d, 'booms') + (o.win ? 0 : 1);
  info.streak = o.win ? num(d, 'streak') + 1 : 0;
  patch.streak = info.streak;
  patch.bestStreak = Math.max(num(d, 'bestStreak'), info.streak);
  const h = WHO(o.holder);
  if (h) {
    if (o.win) patch[`holder_${h}_wins`] = num(d, 'holder', h, 'wins') + 1; else patch[`holder_${h}_booms`] = num(d, 'holder', h, 'booms') + 1;
    if (o.win && o.strikes === 0) patch[`holder_${h}_clean`] = num(d, 'holder', h, 'clean') + 1;
  }
  const m = WHO(o.reader);
  if (m) { patch[`manual_${m}_rounds`] = num(d, 'manual', m, 'rounds') + 1; patch[`manual_${m}_strikes`] = num(d, 'manual', m, 'strikes') + (o.strikes | 0); }
  for (const id of o.solved || []) patch[`mods_${id}`] = num(d, 'mods', id) + 1;
  if (o.win) {
    info.firstWin = !prev.secs && !num(d, 'wins');
    if (o.secs > prev.secs) { patch[`best_${tier}`] = o.secs; if (h) patch[`bestWho_${tier}`] = h; patch[`bestAt_${tier}`] = Math.floor((o.at || 0) / 1000); info.newRecord = prev.secs > 0; }
    if (o.strikes === 0) patch[`clean_${tier}`] = num(d, 'clean', tier) + 1;
  }
  if (o.win) {
    const full = (o.T && Number.isFinite(o.T.secs) ? o.T.secs : (TIERS[tier] || {}).secs) || 0;
    const start = Number.isFinite(o.start) && o.start > 0 ? Math.min(o.start, full || o.start) : full;
    const used = Math.max(0, Math.min(full, Math.round(start - nn(o.secs))));
    let n = num(d, 'parN', tier) + 1;
    let sum = num(d, 'parSum', tier) + used;
    if (n >= 20) { n = Math.floor(n / 2); sum = Math.round(sum / 2); } // keep it adaptive: older wins fade
    patch[`parN_${tier}`] = n; patch[`parSum_${tier}`] = sum;
  }
  const medal = medalFor(o.win, o.strikes, o.secs, o.T);
  info.medal = Math.max(info.medalBefore, medal);
  info.medalUp = info.medal > info.medalBefore;
  if (info.medalUp) patch[`medal_${tier}`] = info.medal;
  if (o.daily && h && dailyOf(d, o.daily, tier, h) === null) patch[`daily_${o.daily}_${tier}_${h}`] = o.win ? o.secs : 0;
  const log = readLog(d);
  log.push({ name: o.name || '', tier, win: o.win ? 1 : 0, holder: h, secs: o.win ? o.secs : 0 });
  patch.log = JSON.stringify(log.slice(-8));
  return { patch, info };
}

/** Personal par on a tier: { secs, n } (average seconds used on wins), or null below 3 wins or on garbage. Never throws. */
export function parOf(d, tier) {
  try {
    if (typeof tier !== 'string' || !Object.prototype.hasOwnProperty.call(TIERS, tier)) return null;
    const T = TIERS[tier];
    const n = Math.floor(num(d, 'parN', tier));
    const sum = num(d, 'parSum', tier);
    if (n < 3 || !(sum > 0)) return null;
    const secs = Math.round(sum / n);
    return secs >= 1 && secs <= T.secs + 60 ? { secs, n } : null;
  } catch { return null; }
}

const LADDER = ['chill', 'normal', 'spicy', 'wild'];
/**
 * A nudge for the selected tier from recent rounds: { kind: 'up' | 'down', tier, text } or null. Takes readRecords() output or the raw data.
 * Three wins in a row on this tier with a silver medal or better: try the next tier. Two booms in the last three rounds: one easier.
 */
export function suggestTier(records, tier = 'normal') {
  try {
    const r = isObj(records) && Array.isArray(records.log) && isObj(records.medal) ? records : readRecords(records);
    const i = LADDER.indexOf(tier);
    if (i < 0 || !Array.isArray(r.log)) return null;
    const tail = r.log.slice(-3);
    if (tail.length < 3) return null;
    const label = (k) => TIERS[k].label;
    if (tail.every((e) => e && e.win && e.tier === tier) && ((r.medal || {})[tier] | 0) >= 2 && i < LADDER.length - 1) {
      return { kind: 'up', tier: LADDER[i + 1], text: `Three ${label(tier)} wins in a row. Try ${label(LADDER[i + 1])}?` };
    }
    if (tail.filter((e) => e && !e.win).length >= 2 && i > 0) {
      return { kind: 'down', tier: LADDER[i - 1], text: `Two booms lately. ${label(LADDER[i - 1])} is a kind place to warm up.` };
    }
  } catch { /* fall through */ }
  return null;
}

/** Same person has held the bomb the last `n` rounds in a row? Returns the holder or null. */
export function sameHolder(log, n = 3) {
  if (log.length < n) return null;
  const tail = log.slice(-n);
  return tail.every((e) => e.holder && e.holder === tail[0].holder) ? tail[0].holder : null;
}

export const COUPLE_LINES = [
  'Two minds, one very calm voice.', 'Zero strikes. Trust looks good on you.', 'That is what listening looks like.', 'Hearts steady, hands steadier.',
  'Not a single wobble. Take a bow, both of you.', 'You finished each other’s wires.', 'Someone owes someone a high five.', 'Calm under pressure. Annoyingly calm.',
  'A flawless run. Go get a snack together.', 'This is what trust sounds like out loud.', 'Seamless. Like you planned it. (You did not.)', 'Zero strikes: the bomb never stood a chance.',
  'Perfect communication. Suspiciously perfect.', 'Whatever you are doing, keep doing it.', 'Soft voice, steady hands: a good combination.', 'Team Us, undefeated this round.',
  'Great talking. Great listening. Great everything.', 'You make a very good pair of oven gloves.', 'The bomb never saw you two coming.', 'Quietly brilliant, both of you.',
];
export const coupleLine = (key) => COUPLE_LINES[hash('line', key) % COUPLE_LINES.length];
