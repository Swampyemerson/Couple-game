// Getaway records: per-person bests and careers in the shared game data (core api.data() /
// setData(), flat keys of numbers only: the doc drops objects). Each phone writes only its own
// person's keys. Couple modes (live, split) use `<w>_<key>`; practice and the Daily chase use
// `ai_<w>_<key>`, so AI rounds never pollute the couple's records. Daily chase scores are
// `<w>_daily_<YYYY-MM-DD>` (seconds survived; a heat escape scores 120 + the seconds left) and
// `<w>_daily_best`. Cop days (even days of the year) use `<w>_dailycop_<date>` and `<w>_dailycop_best` (seconds left at the bust).
//
// Keys: busts, escapes, heats (heat escapes), pits (career), pits_r (most PITs in a round),
// fastbust (fastest bust, s), heatesc (fastest heat escape, s), top (km/h), topboost (km/h on
// nitro), near_r (near misses in a round), streak / streak_best (rounds won in a row), wins
// (matches), runs (rounds as the runner), chain_r (the cop's longest Hot Pursuit chain in a round).
// The Daily chase also keeps `<w>_daily_streak`, `<w>_daily_streak_best` and `<w>_daily_last` (the
// day number of the last Daily played): see foldStreak.
// Content update: safe (safehouse escapes), clean (escapes at full health over 45 s), revenge (grudge
// matches won), pairs (pairs won); the couple's ledger is the shared `series_*` keys (seriesAfter).

import { twistFor, ptsFor } from './twists.js';

const key = (ns, w, k) => `${ns}${w}_${k}`;
const num = (d, k) => (d && typeof d[k] === 'number' && Number.isFinite(d[k]) ? d[k] : 0);
export const fmtSec = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** The records that make a 'NEW RECORD' moment, most notable first. lower: smaller is better. */
const BESTS = [
  { k: 'fastbust', lower: true, label: 'Fastest bust', fmt: (v) => `${Math.round(v)} s` },
  { k: 'heatesc', lower: true, label: 'Fastest getaway', fmt: (v) => fmtSec(v) },
  { k: 'pits_r', label: 'Most PITs in a round', fmt: (v) => `${v}` },
  { k: 'streak_best', label: 'Longest win streak', fmt: (v) => `${v} round${v === 1 ? '' : 's'}`, min: 2 },
  { k: 'top', label: 'Top speed', fmt: (v) => `${v} km/h`, min: 120, step: 5 },
  { k: 'near_r', label: 'Near misses in a round', fmt: (v) => `${v}`, min: 3 },
  { k: 'chain_r', label: 'Longest pursuit chain', fmt: (v) => `×${v}`, min: 6 },
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
    // (a safehouse escape counts as an escape but not as 'losing the heat': it never sets the fastest-getaway mark or counts towards the Rally livery)
    if (ev.outcome === 'escaped') {
      add('escapes');
      if (ev.reason === 'heat') { add('heats'); best('heatesc', Math.round(ev.t), true); touched.push('heatesc'); }
      if (ev.reason === 'safe') add('safe');
      if ((ev.hp | 0) >= 100 && (ev.t || 0) >= 45) add('clean'); // a real escape without a scratch (Checkerboard livery; not a 20 s dash)
    }
    best('top', Math.round(ev.top || 0)); touched.push('top');
    best('topboost', Math.round(ev.topBoost || 0));
    best('near_r', ev.near | 0); touched.push('near_r');
  } else {
    if (ev.outcome === 'busted' && ev.reason !== 'quit') {
      add('busts');
      // a splash is a bust, but it never sets the fastest-bust mark (nor unlocks the highway patrol livery)
      if (ev.reason !== 'water') { best('fastbust', Math.round(ev.t), true); touched.unshift('fastbust'); }
    }
    if (ev.pits) { add('pits', ev.pits | 0); best('pits_r', ev.pits | 0); touched.push('pits_r'); }
    best('chain_r', ev.chain | 0); touched.push('chain_r'); // (Hot Pursuit: the cop's best chain this round)
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
export function recordMatch(data, w, ns, won, revenge = false) {
  const K = key(ns, w, 'wins'); const out = won ? { [K]: num(data, K) + 1 } : {};
  if (won && revenge) { const R = key(ns, w, 'revenge'); out[R] = num(data, R) + 1; } // (won a grudge match: Sweetheart livery)
  return out;
}
/** A pair won (couple modes and practice): the Classic cruiser's counter. */
export function recordPair(data, w, ns) { const K = key(ns, w, 'pairs'); return { [K]: num(data, K) + 1 }; }

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
  const maxOf = (k) => Math.max(num(data, key('', w, k)), num(data, key('ai_', w, k)));
  return { esc: both('escapes'), heat: both('heats'), bust: both('busts'), fastBust: minOf('fastbust'), pits: both('pits'), topBoost: maxOf('topboost'), wins: both('wins'), revenge: both('revenge'), clean: both('clean'), chainBest: maxOf('chain_r'), pairs: both('pairs') };
}

// ── Daily chase ──
export const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const dayOfYear = (t = Date.now()) => { const d = new Date(t); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000); };
export const DAILY = { roundTime: 120, heat: 0 }; // one 2:00 round as the runner vs a Hard AI cop
/** Score: seconds survived; a heat escape scores 120 + the seconds that were left. Any bust (even one
 *  in overtime) tops out at roundTime - 1, so it can never tie or beat an escape. */
export const dailyScore = (outcome, reason, t, roundTime = DAILY.roundTime) => (outcome === 'escaped' ? (reason === 'heat' ? roundTime + Math.max(0, Math.round(roundTime - t)) : roundTime) : Math.min(roundTime - 1, Math.max(0, Math.round(t))));
export const dailyText = (score, roundTime = DAILY.roundTime) => (score > roundTime ? `lost them, +${score - roundTime}` : score >= roundTime ? `${fmtSec(roundTime)} (escaped)` : fmtSec(score));
// Cop days: every even day-of-year the Daily flips, you are the COP vs a Hard AI runner (same 2:00, map, spawn
// and traffic for both phones). The score is the seconds left on the clock when you bust them (0 = they got
// away); any bust scores at least 1, so even an overtime bust beats an escape. Own keys, the runner ones keep their meaning.
/** The Daily's role for a day of the year: even days are cop days. */
export const dailyRoleFor = (day = dayOfYear()) => (day % 2 === 0 ? 'cop' : 'runner');
export const copDailyScore = (outcome, t, roundTime = DAILY.roundTime) => (outcome === 'busted' ? Math.min(roundTime, Math.max(1, Math.round(roundTime - t))) : 0);
export const copDailyText = (score) => (score > 0 ? `Bust at ${fmtSec(score)} left` : 'They got away');
/** The Daily score of a finished round for the role that played it. */
export const dailyScoreOf = (role, outcome, reason, t, roundTime = DAILY.roundTime) => (role === 'cop' ? copDailyScore(outcome, t, roundTime) : dailyScore(outcome, reason, t, roundTime));
export const dailyTextOf = (role, score, roundTime = DAILY.roundTime) => (role === 'cop' ? copDailyText(score) : dailyText(score, roundTime));
/** Runner days: `<w>_daily_<date>` / `<w>_daily_best`; cop days: `<w>_dailycop_<date>` / `<w>_dailycop_best`. */
export const dailyKey = (w, day = dayKey(), role = 'runner') => (role === 'cop' ? `${w}_dailycop_${day}` : `${w}_daily_${day}`);
export const dailyBestKey = (w, role = 'runner') => (role === 'cop' ? `${w}_dailycop_best` : `${w}_daily_best`);
/** Today's two scores: { a, b } (0 = not played). */
export function dailyBoard(data, day = dayKey(), role = 'runner') { return { a: num(data, dailyKey('a', day, role)), b: num(data, dailyKey('b', day, role)) }; }

// ── Daily streak: days in a row with a Daily chase played ──
/** The day number (whole days since 1970, by the local calendar date): consecutive dates differ by 1. */
export const dayNum = (t = Date.now()) => { const d = new Date(t); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000); };
/**
 * Fold a Daily played on `day` into a streak. st: { streak, best, last } (0 = none). The same day
 * again changes nothing; the day after the last one adds 1; anything else starts again at Day 1.
 */
export function foldStreak(st, day) {
  const last = st && st.last > 0 ? st.last : 0; const was = st && st.streak > 0 ? st.streak : 0;
  const streak = last === day ? Math.max(1, was) : last === day - 1 && was > 0 ? was + 1 : 1;
  return { streak, best: Math.max(streak, st && st.best > 0 ? st.best : 0), last: day, changed: last !== day };
}
/** The day number of a Daily's date key ('2026-10-12'). */
export const dayNumFromKey = (k) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || ''); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : dayNum(); };
/** Person w's streak keys in the shared data. */
export const streakOf = (data, w) => ({ streak: num(data, `${w}_daily_streak`), best: num(data, `${w}_daily_streak_best`), last: num(data, `${w}_daily_last`) });
/** The patch for person w playing today's Daily (empty when they already have today). */
export function streakPatch(data, w, day = dayNum()) {
  const f = foldStreak(streakOf(data, w), day);
  return f.changed ? { [`${w}_daily_streak`]: f.streak, [`${w}_daily_streak_best`]: f.best, [`${w}_daily_last`]: f.last } : {};
}
/** What the Daily panel shows for person w: the day they are on (Day 1 after a gap, with no fuss),
 *  whether they have played today, and their best. */
export function streakView(data, w, today = dayNum()) {
  const s = streakOf(data, w); const played = s.last === today;
  const day = played ? Math.max(1, s.streak) : s.last === today - 1 && s.streak > 0 ? s.streak + 1 : 1;
  return { day, played, best: Math.max(s.best, played ? s.streak : 0) };
}

// ── Pairs scoring (rule `score: 'pairs'`, the default) ──
// Rounds 2k and 2k+1 share a spawn with the roles swapped. The point (or two, if either round was
// DOUBLE OR NOTHING) goes to whoever ran the better race across the pair, once both are played. A hist
// entry is { runner, outcome, reason, ran (ms), hp, escMax, pts, sd }.
const flip = (w) => (w === 'a' ? 'b' : 'a');
export const roundWinner = (h) => (h.outcome === 'busted' ? flip(h.runner) : h.runner);
const early = (h) => h.outcome === 'escaped' && (h.reason === 'heat' || h.reason === 'safe');
const tenth = (ms) => Math.round((ms || 0) / 100);
/**
 * Who won the pair (h0 then h1, the roles swapped): an escape beats a bust; two busts, the longer
 * survival wins (the cop who busted faster); two escapes, losing the heat (or reaching a safehouse)
 * beats the clock, then the faster getaway, then health left + 50 × the heat meter's peak; an exact tie
 * is a draw pair. h1 missing: the lone round decides. Returns { winner: 'a' | 'b' | null, why }.
 */
export function pairWinner(h0, h1) {
  if (!h1) return { winner: roundWinner(h0), why: 'round' };
  const X = h0.runner; const Y = h1.runner;
  const e0 = h0.outcome === 'escaped'; const e1 = h1.outcome === 'escaped';
  let c = 0; let why = '';
  if (e0 !== e1) { c = e0 ? 1 : -1; why = 'an escape beats a bust'; }
  else if (!e0) { c = tenth(h0.ran) - tenth(h1.ran); why = 'survived longer'; }
  else {
    const q0 = early(h0); const q1 = early(h1);
    if (q0 !== q1) { c = q0 ? 1 : -1; why = 'a getaway beats the clock'; }
    else if (q0) { c = tenth(h1.ran) - tenth(h0.ran); why = 'the faster getaway'; }
    if (!c) { c = Math.round(((h0.hp || 0) + 50 * (h0.escMax || 0)) * 10) - Math.round(((h1.hp || 0) + 50 * (h1.escMax || 0)) * 10); why = 'more health left'; }
  }
  return c === 0 ? { winner: null, why: 'level' } : { winner: c > 0 ? X : Y, why };
}
/** What a pair is worth: 2 if either round was DOUBLE OR NOTHING. */
export const pairPts = (h0, h1) => Math.max((h0 && h0.pts) || 1, (h1 && h1.pts) || 1);
/** The scores from the rounds played (idempotent: recomputed from hist, never incremented). mode: 'pairs' | 'rounds'; total: the match's rounds. */
export function scoresFromHist(hist, mode = 'pairs', total = 0) {
  const s = { a: 0, b: 0 }; let i = 0;
  while (i < hist.length) {
    const h = hist[i];
    if (mode !== 'pairs' || h.sd) { s[roundWinner(h)] += h.sd ? 1 : h.pts || 1; i++; continue; }
    const g = hist[i + 1];
    if (g && !g.sd) { const pw = pairWinner(h, g); if (pw.winner) s[pw.winner] += pairPts(h, g); i += 2; continue; }
    if (!g && total && hist.length >= total) { s[roundWinner(h)] += h.pts || 1; i++; continue; } // (an odd last round stands alone)
    break; // a pair still open: its point comes after the second round
  }
  return s;
}
/** The most points still to be won (for 'is the match decided?'). m: { rounds, seed, hist, rules: { score, wildcards } }. */
export function remainingPoints(m) {
  const played = m.hist.length; if (played >= m.rounds) return 0;
  const wild = (m.rules || {}).wildcards !== 'off' && !m.daily;
  const nPairs = Math.ceil(m.rounds / 2);
  const ptsAtFuture = (i) => ptsFor(twistFor(m.seed, i, { wild, pairs: nPairs, rules: m.rules }));
  const pairs = (m.rules || {}).score !== 'rounds' && !m.daily;
  const at = (i) => (i < played ? m.hist[i].pts || 1 : ptsAtFuture(i));
  let tot = 0;
  if (!pairs) { for (let i = played; i < m.rounds; i++) tot += at(i); return tot; }
  for (let p = Math.floor(played / 2); p * 2 < m.rounds; p++) tot += Math.max(at(p * 2), p * 2 + 1 < m.rounds ? at(p * 2 + 1) : 1);
  return tot;
}
/** The second half of a pair: what each role needs to beat the first half (h0). { run, cop } sentences; { hudRun, hudCop } short chips. */
export function pairTarget(h0) {
  const t = fmtSec((h0.ran || 0) / 1000);
  if (h0.outcome === 'busted') return { run: `survive past ${t}`, cop: `bust them before ${t}`, hudRun: `Beat ${t}`, hudCop: `Bust by ${t}` };
  if (early(h0)) return { run: `get away before ${t}`, cop: `stop them escaping before ${t}`, hudRun: `Escape by ${t}`, hudCop: `Stop them by ${t}` };
  return { run: 'escape too: losing the heat wins it outright, a clock escape goes to health left', cop: 'bust them and the pair is yours', hudRun: 'Escape to match', hudCop: 'Bust them to win' };
}
/** The words for how a pair was won. */
export function pairWhy(why) { return why === 'level' ? 'dead level' : why; }

// ── The Series: the couple's head-to-head ledger (flat keys, shared) ──
// series_a / series_b (matches won), series_d (drawn), series_n (played), series_last (1 = a won the
// latest, 2 = b, 0 = a draw) and series_run (matches in a row won by series_last's winner).
export function seriesOf(data) {
  const d = data || {};
  return { a: num(d, 'series_a'), b: num(d, 'series_b'), d: num(d, 'series_d'), n: num(d, 'series_n'), last: num(d, 'series_last'), run: num(d, 'series_run') };
}
/** The player who has lost their last 2 or more matches to the other ('a' | 'b' | ''): a grudge match. */
export function seriesGrudge(data) { const s = seriesOf(data); return s.run >= 2 && (s.last === 1 || s.last === 2) ? flip(s.last === 1 ? 'a' : 'b') : ''; }
/** Fold one finished match into the ledger (leadChange: someone edges ahead of a ledger where they were not in front). winner: 'a' | 'b' | null. grudge: seriesGrudge() as it stood at the start. Returns { patch, sr } (sr: what the match card tells). */
export function seriesAfter(data, winner, grudge = '') {
  const s = seriesOf(data); const n = { ...s };
  n.n = s.n + 1;
  if (winner === 'a') n.a++; else if (winner === 'b') n.b++; else n.d++;
  const code = winner === 'a' ? 1 : winner === 'b' ? 2 : 0;
  n.run = code && code === s.last ? s.run + 1 : code ? 1 : 0; n.last = code;
  const lead0 = Math.sign(s.a - s.b); const lead1 = Math.sign(n.a - n.b);
  const patch = { series_a: n.a, series_b: n.b, series_d: n.d, series_n: n.n, series_last: n.last, series_run: n.run };
  return { patch, sr: { ...n, leadChange: s.n > 0 && lead1 !== 0 && lead1 !== lead0, revenge: !!winner && winner === grudge, grudge, tenth: n.n % 10 === 0 } };
}
/** The lobby's ledger line: 'Series: Sydney 7–5 · Sydney has won the last 2' ('' before the first match). */
export function seriesLine(data, name) {
  const s = seriesOf(data); if (!s.n) return '';
  const lead = s.a === s.b ? '' : s.a > s.b ? 'a' : 'b';
  let t = lead ? `Series: ${name(lead)} ${Math.max(s.a, s.b)}–${Math.min(s.a, s.b)}` : `Series: level ${s.a}–${s.b}`;
  if (s.d) t += ` (${s.d} drawn)`;
  if (s.run >= 2 && (s.last === 1 || s.last === 2)) t += ` · ${name(s.last === 1 ? 'a' : 'b')} has won the last ${s.run}`;
  return t;
}
/** Who each played round counts for on the match card: the pair's winner for both its rounds (pairs), else the round's own winner. null = a level pair. */
export function winnersByRound(hist, mode = 'pairs', total = 0) {
  const out = []; let i = 0;
  while (i < hist.length) {
    const h = hist[i];
    if (mode !== 'pairs' || h.sd) { out.push(roundWinner(h)); i++; continue; }
    const g = hist[i + 1];
    if (g && !g.sd) { const w = pairWinner(h, g).winner; out.push(w, w); i += 2; continue; }
    out.push(!g && total && hist.length >= total ? roundWinner(h) : undefined); i++; // (undefined: its pair is still open)
  }
  return out;
}
