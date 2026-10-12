// Air Hockey records (api.data). Flat keys, higher-is-better ones end in _best/_n (the sync keeps
// the larger value), lower-is-better ones end in _ms. Only the device that decides a result
// writes (the host online, the single phone locally).
//   hk_rally_best / hk_rally_who      longest rally (alternating hits) and who scored it
//   hk_fast_ms / hk_fast_who          fastest goal from the serve, in ms (lower is better)
//   hk_shutout_a_n / hk_shutout_b_n   matches won to nil
//   hk_comeback_a_n / hk_comeback_b_n matches won after trailing by 3 or more
//   hk_streak_who / hk_streak_len       the current win streak (matches), hk_streak_best the best ever
//   hockey_last                       the last table played (preselected next time)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function readRecords(d) {
  d = d || {};
  return {
    rallyBest: num(d.hk_rally_best), rallyWho: d.hk_rally_who === 'a' || d.hk_rally_who === 'b' ? d.hk_rally_who : null,
    fastMs: num(d.hk_fast_ms) || null, fastWho: d.hk_fast_who === 'a' || d.hk_fast_who === 'b' ? d.hk_fast_who : null,
    streakWho: d.hk_streak_who === 'a' || d.hk_streak_who === 'b' ? d.hk_streak_who : null,
    streakN: num(d.hk_streak_len), streakBest: num(d.hk_streak_best),
    shutout: { a: num(d.hk_shutout_a_n), b: num(d.hk_shutout_b_n) },
    comeback: { a: num(d.hk_comeback_a_n), b: num(d.hk_comeback_b_n) },
    last: typeof d.hockey_last === 'string' ? d.hockey_last : null,
  };
}

/** A rally just ended with `len` alternating hits, scored by `who`. Returns { patch, record } (record = broke the best). */
export function rallyResult(d, len, who) {
  const r = readRecords(d);
  if (len < 3 || len <= r.rallyBest) return { patch: null, record: false };
  return { patch: { hk_rally_best: len, hk_rally_who: who }, record: len >= 6 };
}
/** A goal `ms` after the serve. Lower is better; a new best needs at least 500 ms (the puck has to travel). */
export function fastResult(d, ms, who) {
  const r = readRecords(d);
  ms = Math.round(ms);
  if (ms < 500) return { patch: null, record: false };
  if (r.fastMs !== null && ms >= r.fastMs) return { patch: null, record: false };
  return { patch: { hk_fast_ms: ms, hk_fast_who: who }, record: r.fastMs !== null };
}

/** The match is decided. info: { winner, score:{a,b}, deficit (the most the winner ever trailed by) }.
 *  Returns { patch, streak: {who, n}, shutout, comeback, newStreakBest }. */
export function matchResult(d, info) {
  const r = readRecords(d);
  const w = info.winner; const l = w === 'a' ? 'b' : 'a';
  const patch = {};
  const n = r.streakWho === w ? r.streakN + 1 : 1;
  patch.hk_streak_who = w; patch.hk_streak_len = n;
  const newStreakBest = n > r.streakBest && n >= 2;
  if (n > r.streakBest) patch.hk_streak_best = n;
  const shutout = info.score[l] === 0;
  if (shutout) patch[`hk_shutout_${w}_n`] = r.shutout[w] + 1;
  const comeback = info.deficit >= 3;
  if (comeback) patch[`hk_comeback_${w}_n`] = r.comeback[w] + 1;
  return { patch, streak: { who: w, n }, shutout, comeback, newStreakBest };
}

/** The one rivalry line under the end card's headline. */
export function rivalryLine({ names, winner, score, tableName, comeback, deficit, streak, shutout, notes, newStreakBest }) {
  const w = winner; const l = w === 'a' ? 'b' : 'a';
  const parts = [`${score[w]}–${score[l]}`];
  if (tableName && tableName !== 'Classic') parts.push(`${tableName} table`);
  if (comeback) parts.push(`COMEBACK from ${deficit} down`);
  else if (shutout) parts.push('Shutout');
  if (streak && streak.n >= 2) parts.push(`${names[streak.who]} on a ${streak.n}-match streak${newStreakBest ? ' (a new best)' : ''}`);
  for (const n of notes || []) parts.push(n);
  return parts.join(' · ');
}
