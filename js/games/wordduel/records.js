// Word Duel records, kept in the game's shared data (api.data / setData / onData).
// Flat keys, numbers and strings only. Keys ending _n, _best or _pb only ever rise when two
// phones merge, so counters and bests use those; resetting streaks use plain keys.
//
//   a_wins_n b_wins_n draws_n matches_n sets_n comeback_n        counters
//   a_streak b_streak (reset)  a_streak_best b_streak_best        win streaks
//   a_fast_pb b_fast_pb          8 - the fewest guesses that player ever cracked a word in
//   a_two_n b_two_n              cracks in 2 or fewer ("mind-reader")
//   a_lastditch_n b_lastditch_n  cracks on the 6th and last guess
//   a_held_n b_held_n            their word held out (the partner never cracked it)
//   lastm                        match id of the last recorded match (record once per match)
//   pbm                          match id of the last match that beat a personal best
//   last_setup                   the rules card's last choice, 'pool:hard:dealt:bo3'
import { MAX, other, result } from './rules.js';

const num = (v) => (Number.isFinite(v) ? v : 0);
export const MILESTONES = [10, 25, 50, 100];

/** Each round of a match as { sec, gs, w }: one for a plain duel, several for a best of 3. */
export function roundsOf(s) {
  if (s.v === 2 && s.opts.bo3) return s.rounds.map((r) => ({ sec: r.secret, gs: r.guesses, w: r.w }));
  return [{ sec: s.secret, gs: s.guesses, w: null }];
}

/** How many guesses `p` needed to crack the other's word in a round (null = never). */
export function cracked(r, p) {
  const t = r.sec[other(p)];
  return t && r.gs[p].includes(t) ? r.gs[p].length : null;
}

/** The patch that records one finished match, or null when it's already recorded. */
export function recordMatch(data, s, matchId) {
  if (!s || !matchId || data.lastm === matchId) return null;
  const res = result(s);
  const p = { lastm: matchId };
  const inc = (k, by = 1) => { p[k] = (p[k] !== undefined ? p[k] : num(data[k])) + by; };
  inc('matches_n');
  const rounds = roundsOf(s);
  const bo3 = s.v === 2 && s.opts.bo3;
  if (bo3) inc('sets_n');
  const w = res.winner;
  if (w === 'a' || w === 'b') {
    inc(`${w}_wins_n`);
    const st = num(data[`${w}_streak`]) + 1;
    p[`${w}_streak`] = st;
    p[`${w}_streak_best`] = Math.max(num(data[`${w}_streak_best`]), st);
    p[`${other(w)}_streak`] = 0;
    if (bo3 && rounds.length && rounds[0].w === other(w)) inc('comeback_n');
  } else inc('draws_n');
  let pb = false;
  for (const r of rounds) {
    for (const q of ['a', 'b']) {
      const n = cracked(r, q);
      if (n === null) { inc(`${other(q)}_held_n`); continue; }
      const key = `${q}_fast_pb`;
      const prev = p[key] !== undefined ? p[key] : num(data[key]);
      if (8 - n > prev) { p[key] = 8 - n; if (prev > 0) pb = true; }
      if (n <= 2) inc(`${q}_two_n`);
      if (n === MAX) inc(`${q}_lastditch_n`);
    }
  }
  if (pb) p.pbm = matchId;
  return p;
}

/** Stamps for the end view: { label, who } (who = 'a' | 'b' | 'hl' for the ink). Computed from the
 *  finished state plus the data (so either phone shows the same ones). */
export function stampsFor(s, data, matchId, name) {
  const out = [];
  const rounds = roundsOf(s);
  const recorded = data.lastm === matchId;
  if (recorded && data.pbm === matchId) out.push({ label: 'New record', who: 'hl' });
  const res = result(s);
  if (recorded && (res.winner === 'a' || res.winner === 'b')) {
    const st = num(data[`${res.winner}_streak`]);
    if (st >= 3) out.push({ label: `${st} in a row`, who: res.winner });
    if (s.v === 2 && s.opts.bo3 && rounds.length && rounds[0].w === other(res.winner)) out.push({ label: 'Comeback', who: res.winner });
  }
  if (recorded && MILESTONES.includes(num(data.matches_n))) out.push({ label: `Duel number ${data.matches_n}`, who: 'hl' });
  let fastest = null;
  for (const r of rounds) for (const q of ['a', 'b']) { const n = cracked(r, q); if (n !== null && (!fastest || n < fastest.n)) fastest = { n, q }; }
  if (fastest && fastest.n <= 2) out.push({ label: 'Mind-reader', who: fastest.q });
  for (const r of rounds) {
    for (const q of ['a', 'b']) if (cracked(r, q) === MAX && !out.some((x) => x.label === 'Last-ditch crack')) out.push({ label: 'Last-ditch crack', who: q });
  }
  for (const o of ['a', 'b']) if (rounds.some((r) => cracked(r, other(o)) === null)) out.push({ label: 'Held out', who: o });
  if (rounds.some((r) => { const x = cracked(r, 'a'); return x !== null && x === cracked(r, 'b'); })) out.push({ label: 'In sync', who: 'hl' });
  if (rounds.some((r) => r.sec.a && r.sec.a === r.sec.b)) out.push({ label: 'Great minds', who: 'hl' });
  return out.slice(0, 5);
}

/** "E 12 – 9 S · Sydney ×3 streak", or '' before the first recorded duel. */
export function ledgerOf(data, name) {
  const a = num(data.a_wins_n);
  const b = num(data.b_wins_n);
  const d = num(data.draws_n);
  if (a + b + d === 0) return { text: '', parts: null };
  const ini = (w) => String(name(w) || w).trim().charAt(0).toUpperCase();
  let streak = '';
  for (const w of ['a', 'b']) if (num(data[`${w}_streak`]) >= 2) streak = `${name(w)} ×${data[`${w}_streak`]} streak`;
  return { text: `${ini('a')} ${a} – ${b} ${ini('b')}${streak ? ` · ${streak}` : ''}`, parts: { a, b, d, streak } };
}

/** The rules card's last choice as a compact string, and back. */
export function setupToString(o) { return `${o.pool}:${o.hard ? 1 : 0}:${o.dealt ? 1 : 0}:${o.bo3 ? 1 : 0}`; }
export function setupFromString(str) {
  const m = /^(fair|love|any):([01]):([01]):([01])$/.exec(String(str || ''));
  return m ? { pool: m[1], hard: m[2] === '1', dealt: m[3] === '1', bo3: m[4] === '1' } : null;
}
