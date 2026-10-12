// Same Wave: records, rivalry badges and the history line. Pure functions over a finished match state
// and the game's shared data doc (api.data()). Flat doc, number / string / boolean values only.
import { MODES } from './rules.js';

const other = (w) => (w === 'a' ? 'b' : 'a');
const num = (d, k) => (typeof d[k] === 'number' && Number.isFinite(d[k]) ? d[k] : 0);
export const MILESTONES = [10, 25, 50, 100];
export const SEEN_CAP = 3000;

/** Per-person and per-match numbers from a state. Works for v1 and v2 states. */
export function statsOf(s) {
  const P = () => ({ givePts: 0, guessPts: 0, giveN: 0, guessN: 0, dSum: 0, chars: 0, bets: 0, betsPlaced: 0, edge: 0 });
  const st = { a: P(), b: P() };
  const rows = [];
  let minD = null;
  for (let i = 0; i < s.rounds.length; i++) {
    const Rd = s.rounds[i];
    if (Rd.at == null) continue;
    const g = Rd.giver; const h = other(g);
    const d = Math.abs(Rd.at - Rd.target);
    const bn = Rd.bn || [];
    st[g].givePts += Rd.points; st[g].giveN++; st[g].chars += (Rd.clue || '').length;
    st[h].guessPts += Rd.points; st[h].guessN++; st[h].dSum += d;
    if (Rd.bet) { st[g].betsPlaced++; if (bn.includes('bet')) st[g].bets++; }
    if (bn.includes('edge')) st[g].edge++;
    if (minD == null || d < minD) minD = d;
    rows.push({ i, giver: g, guesser: h, d, points: Rd.points, clue: Rd.clue || '', card: Rd.card, bull: d <= 4, dead: d === 0, edge: bn.includes('edge'), jp: !!Rd.jp });
  }
  return { st, rows, minD, bulls: rows.filter((r) => r.bull).length };
}

export const BADGES = {
  fortune: 'Fortune Teller',
  edge: 'Edge Walker',
  economist: 'Economist',
  poet: 'Clue Poet',
  whisperer: 'Dial Whisperer',
};

/**
 * One playful title per person. Never negative; ties read "Dead heat".
 * Returns { a: { id, name, why }, b: { ... } }.
 */
export function badgesOf(s, names) {
  const { st } = statsOf(s);
  const cands = [];
  const add = (id, a, b, better, why) => {
    const win = a === b ? null : (better === 'high' ? a > b : a < b) ? 'a' : 'b';
    cands.push({ id, win, why: why(win || 'a', win === 'a' ? a : b, win === 'a' ? b : a) });
  };
  if (st.a.betsPlaced + st.b.betsPlaced > 0) add('fortune', st.a.bets, st.b.bets, 'high', (w, x) => `${x} bet${x === 1 ? '' : 's'} called right`);
  if (st.a.edge + st.b.edge > 0) add('edge', st.a.edge, st.b.edge, 'high', (w, x) => `${x} edge hit${x === 1 ? '' : 's'} from ${names[w]}’s clues`);
  const cpp = (p) => (p.givePts > 0 ? p.chars / p.givePts : Infinity);
  if (cpp(st.a) !== Infinity || cpp(st.b) !== Infinity) add('economist', cpp(st.a), cpp(st.b), 'low', (w, x) => (x === Infinity ? '' : `${(Math.round(x * 10) / 10)} letters a point`));
  add('poet', st.a.givePts, st.b.givePts, 'high', (w, x, y) => `clues earned ${x} to ${y}`);
  if (st.a.guessN + st.b.guessN > 0) add('whisperer', -st.a.dSum, -st.b.dSum, 'high', (w, x, y) => `${-x} off in total, against ${-y}`);
  const out = { a: null, b: null };
  for (const c of cands) if (c.win && !out[c.win]) out[c.win] = { id: c.id, name: BADGES[c.id], why: c.why };
  for (const w of ['a', 'b']) {
    if (out[w]) continue;
    const tie = cands.find((c) => !c.win);
    out[w] = tie ? { id: 'heat', name: 'Dead heat', why: `${BADGES[tie.id]}: all square` } : { id: 'team', name: 'Wave Rider', why: 'along for every wave' };
  }
  return out;
}

/** The patch to write when a match finishes (one device). */
export function recordPatch(s, data, matchId, mode, cardText) {
  const { st, rows, minD } = statsOf(s);
  const p = { lastRec: matchId, plays: num(data, 'plays') + 1 };
  const bk = `best_${mode}`;
  if (typeof data[bk] !== 'number' || s.score > data[bk]) {
    p[bk] = s.score;
    p.lastNewBest = matchId;
    p.lastOldBest = typeof data[bk] === 'number' ? data[bk] : 0;
  }
  let run = num(data, 'bullStreak'); let best = num(data, 'bullStreakBest');
  for (const r of rows) { run = r.bull ? run + 1 : 0; if (run > best) best = run; }
  p.bulls = num(data, 'bulls') + rows.filter((r) => r.bull).length;
  p.bullStreak = run;
  p.bullStreakBest = best;
  for (const w of ['a', 'b']) {
    p[`${w}_givePts`] = num(data, `${w}_givePts`) + st[w].givePts;
    p[`${w}_guessPts`] = num(data, `${w}_guessPts`) + st[w].guessPts;
    p[`${w}_bets`] = num(data, `${w}_bets`) + st[w].bets;
  }
  if (minD != null && (typeof data.closest !== 'number' || minD < data.closest)) p.closest = minD;
  const dead = rows.filter((r) => r.dead);
  if (dead.length) {
    p.dead = num(data, 'dead') + dead.length;
    const last = dead[dead.length - 1];
    p.bestClue = `“${last.clue}” on ${cardText(last.card)}`.slice(0, 120);
  }
  p.edgeHits = num(data, 'edgeHits') + rows.filter((r) => r.edge).length;
  p.jackpots = num(data, 'jackpots') + rows.filter((r) => r.jp && r.points > 0).length;
  return p;
}

/** What the totals will be once this match is counted, whether or not the write has landed yet. */
export function tally(s, data, matchId) {
  const done = data.lastRec === matchId;
  const { bulls } = statsOf(s);
  const plays = done ? num(data, 'plays') : num(data, 'plays') + 1;
  const bullsNow = done ? num(data, 'bulls') : num(data, 'bulls') + bulls;
  return { done, plays, bulls: bullsNow, matchBulls: bulls };
}

const crossed = (after, delta) => MILESTONES.filter((m) => after - delta < m && after >= m);

/** Stamps and streaks for the records strip. */
export function stampsOf(s, data, matchId, mode) {
  const t = tally(s, data, matchId);
  const out = [];
  const bk = `best_${mode}`;
  // NEW BEST only means something when there was an earlier best to beat
  if (data.lastNewBest === matchId && data.lastOldBest > 0) out.push({ id: 'best', text: 'NEW BEST', sub: `was ${data.lastOldBest}` });
  for (const m of crossed(t.bulls, t.matchBulls)) out.push({ id: 'bulls', text: `${m} BULLSEYES`, sub: 'together, all time' });
  for (const m of crossed(t.plays, 1)) out.push({ id: 'plays', text: `${m} MATCHES`, sub: 'together' });
  const { rows } = statsOf(s);
  if (rows.some((r) => r.dead)) out.push({ id: 'dead', text: 'DEAD CENTRE', sub: 'bang on the target' });
  if (rows.some((r) => r.jp && r.points > 0)) out.push({ id: 'jp', text: 'JACKPOT', sub: 'doubled points' });
  const streak = t.done ? num(data, 'bullStreak') : null;
  return { stamps: out, streak, streakBest: t.done ? num(data, 'bullStreakBest') : null };
}

const ordinal = (n) => { const v = n % 100; const suf = v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10] || 'th'; return `${n}${suf}`; };

/** "Your 12th match together. Best ever 26, tonight 24: so close." */
export function historyLine(s, data, matchId, mode, score) {
  const t = tally(s, data, matchId);
  const modeName = (MODES.find((m) => m.id === mode) || { name: '' }).name;
  const head = t.plays <= 1 ? 'Your first match together.' : `Your ${ordinal(t.plays)} match together.`;
  const isNew = data.lastNewBest === matchId;
  if (isNew) {
    const old = data.lastOldBest;
    return old > 0 ? `${head} A new ${modeName} best: ${score}, up from ${old}.` : `${head} ${score} goes on the ${modeName} board.`;
  }
  const best = num(data, `best_${mode}`);
  if (!t.done && best === 0) return `${head} ${score} goes on the ${modeName} board.`;
  const gap = best - score;
  if (gap <= 0) return `${head} That ties your ${modeName} best of ${best}.`;
  const tail = gap <= 2 ? 'so close.' : gap <= 5 ? 'within reach.' : `${gap} to chase, and one bullseye is worth 4.`;
  return `${head} Best ever ${best}, tonight ${score}: ${tail}`;
}

/** The lifetime clue-writing chase, phrased as a path forward. */
export function chaseLine(data, names) {
  const plays = num(data, 'plays');
  if (plays < 1) return '';
  const rounds = 4 * plays; // each of you gives four clues a match
  const a = num(data, 'a_givePts'); const b = num(data, 'b_givePts');
  const fmt = (x) => (Math.round((x / rounds) * 10) / 10).toFixed(1);
  if (a === b) return `As clue-writers you are dead level at ${fmt(a)} a round. One bullseye breaks it.`;
  const lead = a > b ? 'a' : 'b';
  const gap = Math.abs(a - b);
  const need = Math.max(1, Math.ceil((gap + 1) / 4));
  return `Clue-writing: ${names[lead]} leads ${fmt(Math.max(a, b))} to ${fmt(Math.min(a, b))} a round. ${need === 1 ? 'One bullseye' : `${need} bullseyes`} from ${names[other(lead)]} flips it.`;
}

// ── the seen list (rotation) ──
export const parseSeen = (data) => String(data.seen || '').split('.').filter(Boolean).map((x) => parseInt(x, 36)).filter((x) => Number.isInteger(x) && x >= 0);
export function encodeSeen(list) {
  let s = list.map((x) => x.toString(36)).join('.');
  while (s.length > SEEN_CAP) { list = list.slice(Math.ceil(list.length / 10)); s = list.map((x) => x.toString(36)).join('.'); }
  return s;
}

/**
 * Pick seven cards for a pack from what you haven't seen yet. When the pack runs low the pool starts over.
 * rnd: () => [0,1). Returns { deal, seen } where seen is the new encoded list.
 */
export function pickDeal(pool, data, rnd, len) {
  const seen = parseSeen(data);
  const seenSet = new Set(seen);
  const shuf = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
  const fresh = pool.filter((i) => !seenSet.has(i));
  let deal; let keep = seen;
  if (fresh.length >= len) deal = shuf(fresh).slice(0, len);
  else {
    // pool exhausted: the stragglers first, then a fresh lap
    const poolSet = new Set(pool);
    keep = seen.filter((i) => !poolSet.has(i));
    // ...but never open the new lap with the cards of the deal you just had, when there are others to use
    const lastDeal = new Set(seen.slice(-len));
    const lap = pool.filter((i) => !fresh.includes(i));
    deal = [...shuf(fresh), ...shuf(lap.filter((i) => !lastDeal.has(i))), ...shuf(lap.filter((i) => lastDeal.has(i)))].slice(0, len);
  }
  return { deal, seen: encodeSeen([...keep, ...deal]) };
}
