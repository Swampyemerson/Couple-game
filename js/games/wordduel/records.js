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
//   recent_m                     the last 60 recorded match ids, comma-joined (record once per match)
//   last_w                       who won the last recorded duel: 'a' | 'b' | 'd' (a draw)
//   a_revenge_n b_revenge_n      wins right after losing the previous duel
//   a_snap_n b_snap_n            wins that ended the partner's streak of 3 or more
//   snapm                        '<matchId>:<length>' of the last match that snapped a streak
//   revm                         match id of the last revenge win
//   a_used b_used                each player's last 40 secret words as 'word:n' (n = guesses it took, 7 = held out)
//   lastm                        match id of the last recorded match
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

export const RECENT = 60;
export const USED = 40;
/** A player's secret-word history as [{ w, n }], oldest first. */
export function usedOf(data, who) {
  return String(data[`${who}_used`] || '').split(',').filter(Boolean).map((x) => { const [w, n] = x.split(':'); return { w, n: Number(n) || 7 }; });
}
export const recentOf = (data) => String(data.recent_m || '').split(',').filter(Boolean);

/** The patch that records one finished match, or null when it must not be counted.
 *  `seen` = this phone watched the match end (the move that finished it landed during this
 *  mount). A finished match merely opened later (seen = false) counts only if it is v2 and its id
 *  isn't in recent_m: legacy v1 matches are never recorded on reopen. */
export function recordMatch(data, s, matchId, seen = true) {
  if (!s || !matchId || recentOf(data).includes(matchId)) return null;
  if (!seen && s.v !== 2) return null;
  // a reopened match on a phone whose shared data hasn't arrived yet (empty) must not record: the patch
  // would overwrite plain keys (streaks, last_w, recent_m, *_used) with values built from nothing
  if (!seen && !(num(data.matches_n) > 0)) return null;
  const res = result(s);
  const p = { lastm: matchId, recent_m: [...recentOf(data), matchId].slice(-RECENT).join(',') };
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
    // derived from the snapshot BEFORE this patch
    if (data.last_w === other(w)) { inc(`${w}_revenge_n`); p.revm = matchId; }
    const broke = num(data[`${other(w)}_streak`]);
    if (broke >= 3) { inc(`${w}_snap_n`); p.snapm = `${matchId}:${broke}`; }
    if (bo3 && rounds.length && rounds[0].w === other(w)) inc('comeback_n');
  } else inc('draws_n');
  p.last_w = w === 'a' || w === 'b' ? w : 'd';
  let pb = false;
  for (const r of rounds) {
    for (const q of ['a', 'b']) {
      const n = cracked(r, q);
      if (n === null) { inc(`${other(q)}_held_n`); continue; }
      const key = `${q}_fast_pb`;
      const before = num(data[key]); // only the best from before this match counts as a record
      if (8 - n > Math.max(before, p[key] || 0)) { p[key] = 8 - n; if (before > 0) pb = true; }
      if (n <= 2) inc(`${q}_two_n`);
      if (n === MAX) inc(`${q}_lastditch_n`);
    }
  }
  if (pb) p.pbm = matchId;
  for (const q of ['a', 'b']) {
    const add = rounds.map((r) => `${r.sec[q]}:${cracked(r, other(q)) ?? 7}`).filter((x) => !x.startsWith('null:'));
    p[`${q}_used`] = [...String(data[`${q}_used`] || '').split(',').filter(Boolean), ...add].slice(-USED).join(',');
  }
  return p;
}

/** Stamps for the end view: { label, who } (who = 'a' | 'b' | 'hl' for the ink). Computed from the
 *  finished state plus the data (so either phone shows the same ones). */
export function stampsFor(s, data, matchId, name) {
  const out = [];
  const rounds = roundsOf(s);
  // Stamps read from the shared data describe the ledger as of the newest recorded match, so an
  // older finished match that is reopened shows only the stamps its own state can prove.
  const latest = recentOf(data).includes(matchId) && data.lastm === matchId;
  if (rounds.some((r) => r.sec.a && r.sec.a === r.sec.b)) out.push({ label: 'Great minds', who: 'hl' });
  if (latest && data.pbm === matchId) out.push({ label: 'New record', who: 'hl' });
  const res = result(s);
  const winner = res.winner;
  if (latest && (winner === 'a' || winner === 'b')) {
    if (data.revm === matchId) out.push({ label: 'Revenge', who: winner });
    if (String(data.snapm || '').startsWith(`${matchId}:`)) out.push({ label: 'Streak snapped', who: winner });
  }
  if (latest) {
    // a secret this match that either player had used before it
    const before = (q) => { const h = usedOf(data, q).map((x) => x.w); return h.slice(0, Math.max(0, h.length - rounds.length)); };
    const seenBefore = new Set([...before('a'), ...before('b')]);
    if (rounds.some((r) => seenBefore.has(r.sec.a) || seenBefore.has(r.sec.b))) out.push({ label: 'Déjà vu', who: 'hl' });
  }
  if (latest && (winner === 'a' || winner === 'b')) {
    const st = num(data[`${winner}_streak`]);
    if (st >= 3) out.push({ label: `${st} in a row`, who: winner });
  }
  if (s.v === 2 && s.opts.bo3 && (winner === 'a' || winner === 'b') && rounds.length && rounds[0].w === other(winner) && recentOf(data).includes(matchId)) out.push({ label: 'Comeback', who: winner });
  if (latest && MILESTONES.includes(num(data.matches_n))) out.push({ label: `Duel number ${data.matches_n}`, who: 'hl' });
  let fastest = null;
  for (const r of rounds) for (const q of ['a', 'b']) { const n = cracked(r, q); if (n !== null && (!fastest || n < fastest.n)) fastest = { n, q }; }
  if (fastest && fastest.n <= 2) out.push({ label: 'Mind-reader', who: fastest.q });
  for (const r of rounds) {
    for (const q of ['a', 'b']) if (cracked(r, q) === MAX && !out.some((x) => x.label === 'Last-ditch crack')) out.push({ label: 'Last-ditch crack', who: q });
  }
  for (const o of ['a', 'b']) if (rounds.some((r) => cracked(r, other(o)) === null)) out.push({ label: 'Held out', who: o });
  if (rounds.some((r) => { const x = cracked(r, 'a'); return x !== null && x === cracked(r, 'b'); })) out.push({ label: 'In sync', who: 'hl' });
  return out.slice(0, 5); // rarest first, so the common ones are what gets cut
}

/** "E 12 – 9 S · Sydney ×3 streak", or '' before the first recorded duel. `context` is one more
 *  sentence: what is on the line right now. */
export function ledgerOf(data, name) {
  const a = num(data.a_wins_n);
  const b = num(data.b_wins_n);
  const d = num(data.draws_n);
  if (a + b + d === 0) return { text: '', context: '', parts: null };
  const ini = (w) => String(name(w) || w).trim().charAt(0).toUpperCase();
  let streak = '';
  let hot = null;
  for (const w of ['a', 'b']) if (num(data[`${w}_streak`]) >= 2) { streak = `${name(w)} ×${data[`${w}_streak`]} streak`; hot = w; }
  const context = hot ? `${name(hot)}’s ×${data[`${hot}_streak`]} streak is on the line.` : a === b ? `All square at ${a}–${b}.` : `${name(a > b ? 'a' : 'b')} leads by ${Math.abs(a - b)}.`;
  return { text: `${ini('a')} ${a} – ${b} ${ini('b')}${streak ? ` · ${streak}` : ''}`, context, parts: { a, b, d, streak } };
}

/** The rules card's last choice as a compact string, and back. */
export function setupToString(o) { return `${o.pool}:${o.hard ? 1 : 0}:${o.dealt ? 1 : 0}:${o.bo3 ? 1 : 0}`; }
export function setupFromString(str) {
  const m = /^(fair|love|any):([01]):([01]):([01])$/.exec(String(str || ''));
  return m ? { pool: m[1], hard: m[2] === '1', dealt: m[3] === '1', bo3: m[4] === '1' } : null;
}
