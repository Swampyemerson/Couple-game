// Getaway records: per-person bests and careers in the shared game data (core api.data() /
// setData(), flat keys of numbers only: the doc drops objects). Each phone writes only its own
// person's keys. Couple modes (live, split) use `<w>_<key>`; practice and the Daily chase use
// `ai_<w>_<key>`, so AI rounds never pollute the couple's records. Daily chase scores are
// `<w>_daily_<YYYY-MM-DD>` (seconds survived; a heat escape scores 120 + the seconds left) and
// `<w>_daily_best`.
//
// Keys: busts, escapes, heats (heat escapes), pits (career), pits_r (most PITs in a round),
// fastbust (fastest bust, s), heatesc (fastest heat escape, s), top (km/h), topboost (km/h on
// nitro), near_r (near misses in a round), streak / streak_best (rounds won in a row), wins
// (matches), runs (rounds as the runner).

const key = (ns, w, k) => `${ns}${w}_${k}`;
const num = (d, k) => (d && typeof d[k] === 'number' && Number.isFinite(d[k]) ? d[k] : 0);
export const fmtSec = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** The records that make a 'NEW RECORD' moment, most notable first. lower: smaller is better. */
const BESTS = [
  { k: 'fastbust', lower: true, label: 'Fastest bust', fmt: (v) => `${Math.round(v)} s` },
  { k: 'heatesc', lower: true, label: 'Fastest getaway', fmt: (v) => fmtSec(v) },
  { k: 'pits_r', label: 'Most PITs in a round', fmt: (v) => `${v}` },
  { k: 'streak_best', label: 'Longest win streak', fmt: (v) => `${v} rounds`, min: 2 },
  { k: 'top', label: 'Top speed', fmt: (v) => `${v} km/h`, min: 120, step: 2 },
  { k: 'near_r', label: 'Near misses in a round', fmt: (v) => `${v}`, min: 3 },
];

/**
 * Fold one finished round into person w's records. ev: { role: 'runner' | 'cop', won, outcome,
 * reason, t (s on the run), pits, top (km/h), topBoost (km/h), near }. Returns { patch, news,
 * held }: news = the improved bests [{ k, label, val, was, text }] (most notable first); held = the
 * partner's better value for the first best this round touched, for 'X still holds …'.
 */
export function recordRound(data, w, ns, ev, partner) {
  const d = data || {}; const patch = {}; const news = [];
  const K = (k) => key(ns, w, k);
  const add = (k, n = 1) => { patch[K(k)] = num(d, K(k)) + n; };
  const best = (k, v, lower) => {
    if (!(v > 0)) return;
    const was = num(d, K(k));
    if (lower ? !was || v < was : v > was) {
      patch[K(k)] = v;
      const B = BESTS.find((b) => b.k === k);
      if (B && v >= (B.min || 0) && (!B.step || !was || Math.abs(v - was) >= B.step)) news.push({ k, label: B.label, val: v, was, text: was ? `${B.label} yet: ${B.fmt(v)} (was ${B.fmt(was)})` : `${B.label}: ${B.fmt(v)}` });
    }
  };
  const touched = [];
  if (ev.role === 'runner') {
    add('runs');
    if (ev.outcome === 'escaped') { add('escapes'); if (ev.reason === 'heat') { add('heats'); best('heatesc', Math.round(ev.t), true); touched.push('heatesc'); } }
    best('top', Math.round(ev.top || 0)); touched.push('top');
    best('topboost', Math.round(ev.topBoost || 0));
    best('near_r', ev.near | 0); touched.push('near_r');
  } else {
    if (ev.outcome === 'busted' && ev.reason !== 'quit') { add('busts'); best('fastbust', Math.round(ev.t), true); touched.unshift('fastbust'); }
    if (ev.pits) { add('pits', ev.pits | 0); best('pits_r', ev.pits | 0); touched.push('pits_r'); }
  }
  const streak = ev.won ? num(d, K('streak')) + 1 : 0;
  if (streak !== num(d, K('streak'))) patch[K('streak')] = streak;
  if (ev.won) best('streak_best', streak);
  news.sort((x, y) => BESTS.findIndex((b) => b.k === x.k) - BESTS.findIndex((b) => b.k === y.k));
  // the partner's mark this round was measured against ('Sydney still holds fastest bust, 38 s')
  let held = null;
  if (!news.length && partner) {
    for (const k of touched) {
      const B = BESTS.find((b) => b.k === k); if (!B) continue;
      const mine = num(patch, K(k)) || num(d, K(k)); const theirs = num(d, key(ns, partner, k));
      if (theirs > 0 && (B.lower ? !mine || theirs < mine : theirs > mine) && theirs >= (B.min || 0)) { held = { k, label: B.label, val: theirs, text: B.fmt(theirs) }; break; }
    }
  }
  return { patch, news, streak, held };
}
/** A match won (couple modes) or played. */
export function recordMatch(data, w, ns, won) {
  const K = key(ns, w, 'wins'); return won ? { [K]: num(data, K) + 1 } : {};
}

/** The lobby's records line: the couple's headline bests (live / split) or mine vs the AI. */
export function recordsLine(data, ns, name, ws = ['a', 'b']) {
  const d = data || {}; const bits = [];
  const pick = (k, lower) => { let bw = null; let bv = 0; for (const w of ws) { const v = num(d, key(ns, w, k)); if (v > 0 && (!bw || (lower ? v < bv : v > bv))) { bw = w; bv = v; } } return bw ? { w: bw, v: bv } : null; };
  const fb = pick('fastbust', true); if (fb) bits.push({ t: 'Fastest bust', w: fb.w, v: `${Math.round(fb.v)} s` });
  const he = pick('heatesc', true); if (he) bits.push({ t: 'Fastest getaway', w: he.w, v: fmtSec(he.v) });
  const pr = pick('pits_r'); if (pr && pr.v >= 2) bits.push({ t: 'Most PITs', w: pr.w, v: `${pr.v}` });
  const sb = pick('streak_best'); if (sb && sb.v >= 2) bits.push({ t: 'Streak', w: sb.w, v: `${sb.v}` });
  if (!bits.length) { const tp = pick('top'); if (tp) bits.push({ t: 'Top speed', w: tp.w, v: `${tp.v} km/h` }); }
  return bits.slice(0, 3).map((b) => ({ ...b, name: name(b.w) }));
}

/** Career totals for livery unlocks: couple + practice summed (liveries.js tests). */
export function careerFrom(data, w) {
  const both = (k) => num(data, key('', w, k)) + num(data, key('ai_', w, k));
  const minOf = (k) => { const a = num(data, key('', w, k)); const b = num(data, key('ai_', w, k)); return a && b ? Math.min(a, b) : a || b; };
  return { esc: both('escapes'), heat: both('heats'), bust: both('busts'), fastBust: minOf('fastbust'), pits: both('pits'), topBoost: Math.max(num(data, key('', w, 'topboost')), num(data, key('ai_', w, 'topboost'))), wins: both('wins') };
}

// ── Daily chase ──
export const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const dayOfYear = (t = Date.now()) => { const d = new Date(t); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000); };
export const DAILY = { roundTime: 120, heat: 0 }; // one 2:00 round as the runner vs a Hard AI cop
/** Score: seconds survived; a heat escape scores 120 + the seconds that were left. */
export const dailyScore = (outcome, reason, t, roundTime = DAILY.roundTime) => (outcome === 'escaped' ? (reason === 'heat' ? roundTime + Math.max(0, Math.round(roundTime - t)) : roundTime) : Math.max(0, Math.round(t)));
export const dailyText = (score, roundTime = DAILY.roundTime) => (score > roundTime ? `lost them, +${score - roundTime}` : score >= roundTime ? `${fmtSec(roundTime)} (escaped)` : fmtSec(score));
export const dailyKey = (w, day = dayKey()) => `${w}_daily_${day}`;
/** Today's two scores: { a, b } (0 = not played). */
export function dailyBoard(data, day = dayKey()) { return { a: num(data, dailyKey('a', day)), b: num(data, dailyKey('b', day)) }; }
