// Doodle records: pure helpers. Lifetime totals live in the game's shared data doc
// (api.data / api.setData); everything about ONE match is computed from its final state.
// Values in the doc are numbers or strings; keys match ^[a-zA-Z0-9_.-]{1,60}$.

export const MILESTONES = [10, 25, 50, 100, 250];
const SEEN_CAP = 3000;
const num = (d, k) => (Number.isFinite(Number(d && d[k])) ? Number(d[k]) : 0);
const other = (w) => (w === 'a' ? 'b' : 'a');

// ── seen cards (rotation) ──
export function encodeSeen(list) {
  let s = list.map((i) => i.toString(36)).join('.');
  if (s.length > SEEN_CAP) { const cut = s.indexOf('.', s.length - SEEN_CAP); s = cut < 0 ? '' : s.slice(cut + 1); }
  return s;
}
export function decodeSeen(str) {
  if (typeof str !== 'string' || !str) return [];
  return str.split('.').map((x) => parseInt(x, 36)).filter((n) => Number.isInteger(n) && n >= 0);
}

// ── one finished match ──
export function summarize(s, tierOf) {
  const rounds = s.rounds.map((R, r) => {
    const tier = R.tier != null ? R.tier : R.pick != null ? tierOf(R.choices[R.pick]) : 0;
    const hit = R.points > 0;
    return {
      r, drawer: R.drawer, guesser: other(R.drawer), tier, points: R.points || 0, hit,
      first: hit && R.guesses.length === 1, timeUp: !!R.timeUp, gaveUp: !!R.gaveUp,
      gold: !!R.gold, drawn: !!R.strokes,
    };
  });
  const z = () => ({ a: 0, b: 0 });
  const sum = { rounds, n: rounds.length, draw: z(), guess: z(), guessRounds: z(), firstTry: z(), daredevil: z(), hits: 0, tricky: 0, drawings: 0, goldHits: 0, perfect: rounds.length > 0 && rounds.every((x) => x.hit) };
  for (const x of rounds) {
    if (x.hit) sum.hits++;
    sum.draw[x.drawer] += x.points;
    if (x.drawn) {
      sum.guess[x.guesser] += x.points;
      sum.guessRounds[x.guesser]++;
      sum.drawings++;
    }
    if (x.first) sum.firstTry[x.guesser]++;
    if (x.tier === 2 && x.drawn) sum.daredevil[x.drawer]++;
    if (x.tier === 2 && x.hit) sum.tricky++;
    if (x.gold && x.hit) sum.goldHits++;
  }
  return sum;
}

// What the one device that ended the match writes to the shared doc.
export function recordPatch(sum, d, { matchId, mode, score }) {
  const bestKey = `best_${mode}`;
  const prev = num(d, bestKey);
  let streak = num(d, 'hitStreak');
  let bestStreak = num(d, 'hitStreakBest');
  for (const x of sum.rounds) {
    if (x.hit) { streak++; bestStreak = Math.max(bestStreak, streak); } else streak = 0;
  }
  const before = num(d, 'drawings');
  const after = before + sum.drawings;
  const mile = MILESTONES.filter((m) => before < m && after >= m).pop() || 0;
  const plays = num(d, 'plays') + 1;
  return {
    lastRec: matchId, plays, [bestKey]: Math.max(prev, score), hitStreak: streak, hitStreakBest: bestStreak,
    a_drawPts: num(d, 'a_drawPts') + sum.draw.a, b_drawPts: num(d, 'b_drawPts') + sum.draw.b,
    a_guessPts: num(d, 'a_guessPts') + sum.guess.a, b_guessPts: num(d, 'b_guessPts') + sum.guess.b,
    a_guessRounds: num(d, 'a_guessRounds') + sum.guessRounds.a, b_guessRounds: num(d, 'b_guessRounds') + sum.guessRounds.b,
    a_firstTry: num(d, 'a_firstTry') + sum.firstTry.a, b_firstTry: num(d, 'b_firstTry') + sum.firstTry.b,
    trickyHits: num(d, 'trickyHits') + sum.tricky, perfects: num(d, 'perfects') + (sum.perfect ? 1 : 0),
    drawings: after, golds: num(d, 'golds') + sum.goldHits,
    // what happened in the match just recorded, so both phones can show the same strip
    rc_mode: mode, rc_score: score, rc_prev: prev, rc_new: score > prev ? 1 : 0, rc_mile: mile,
    rc_streak: streak, rc_perfect: sum.perfect ? 1 : 0, rc_gold: sum.goldHits, rc_plays: plays,
  };
}

// ── per-person title badges (one each, never negative) ──
const CATS = [
  { id: 'picasso', title: 'Picasso', val: (s, w) => s.draw[w], line: (n) => `${n} point${n === 1 ? '' : 's'} on their drawings` },
  { id: 'mind', title: 'Mind Reader', val: (s, w) => s.guess[w], line: (n) => `${n} point${n === 1 ? '' : 's'} as the guesser` },
  { id: 'ace', title: 'First-Try Ace', val: (s, w) => s.firstTry[w], line: (n) => `${n} first-try hit${n === 1 ? '' : 's'}` },
  { id: 'dare', title: 'Daredevil', val: (s, w) => s.daredevil[w], line: (n) => `${n} Tricky card${n === 1 ? '' : 's'} drawn` },
];
export function badgesOf(sum) {
  const wins = { a: [], b: [] };
  const ties = [];
  CATS.forEach((c, i) => {
    const va = c.val(sum, 'a'); const vb = c.val(sum, 'b');
    if (va > vb) wins.a.push(i); else if (vb > va) wins.b.push(i); else if (va > 0) ties.push(i);
  });
  let pick = { a: null, b: null }; let score = -1;
  for (const ca of [null, ...wins.a]) {
    for (const cb of [null, ...wins.b]) {
      if (ca !== null && ca === cb) continue;
      const sc = (ca !== null) + (cb !== null);
      if (sc > score) { score = sc; pick = { a: ca, b: cb }; }
    }
  }
  const out = {};
  for (const w of ['a', 'b']) {
    if (pick[w] !== null) { const c = CATS[pick[w]]; out[w] = { id: c.id, title: c.title, line: c.line(c.val(sum, w)) }; continue; }
    if (ties.length) { const c = CATS[ties[0]]; out[w] = { id: 'tie', title: 'Dead heat', line: `Level on ${c.title}` }; continue; }
    out[w] = { id: 'sport', title: 'Good Sport', line: 'Brought the fun' };
  }
  return out;
}

// ── lines of text ──
export const ordinal = (n) => { const m = n % 100; const k = n % 10; return `${n}${m >= 11 && m <= 13 ? 'th' : k === 1 ? 'st' : k === 2 ? 'nd' : k === 3 ? 'rd' : 'th'}`; };

// "Your 12th match together. Best ever 26, tonight 24: so close." d = the data doc AFTER this match was recorded.
export function historyLine(d, modeTitle) {
  const plays = num(d, 'rc_plays') || num(d, 'plays');
  const score = num(d, 'rc_score'); const prev = num(d, 'rc_prev'); const best = Math.max(prev, score);
  if (plays <= 1) return `Your first match together. ${score} is the number to beat.`;
  const head = `Your ${ordinal(plays)} match together.`;
  if (num(d, 'rc_new')) return prev > 0 ? `${head} A new ${modeTitle} best: ${score}, up from ${prev}.` : `${head} Your first ${modeTitle} game: ${score} is the number to beat.`;
  if (score === best) return `${head} You matched your ${modeTitle} best of ${best}.`;
  const gap = best - score;
  return `${head} Best ever ${best}, tonight ${score}: ${gap <= Math.max(3, Math.round(best * 0.12)) ? 'so close.' : 'plenty of room to climb.'}`;
}

// "As guesser Sydney leads 3.1 to 2.9 a round. Two first-try hits in a row flips it."
export function chaseLine(d, names) {
  const rows = {};
  for (const w of ['a', 'b']) {
    const n = num(d, `${w}_guessRounds`);
    if (n < 4) return '';
    rows[w] = { n, pts: num(d, `${w}_guessPts`), avg: num(d, `${w}_guessPts`) / n };
  }
  const lead = rows.a.avg >= rows.b.avg ? 'a' : 'b'; const trail = other(lead);
  const L = rows[lead]; const T = rows[trail];
  const f = (x) => (Math.round(x * 10) / 10).toFixed(1);
  if (f(L.avg) === f(T.avg)) return `As guesser you are dead level at ${f(L.avg)} a round. The next first-try hit breaks the tie.`;
  const v = 4; // a typical first-try hit across the three tiers
  const k = v > L.avg ? Math.floor((L.avg * T.n - T.pts) / (v - L.avg)) + 1 : 99;
  const words = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
  const tail = k <= 6 ? ` ${words[k]} first-try hit${k > 1 ? 's' : ''} in a row flips it.` : ` Every round is a chance to close it.`;
  return `As guesser ${names[lead]} leads ${f(L.avg)} to ${f(T.avg)} a round.${tail}`;
}

// Stamps for the strip: [{ id, text, sub }]
export function stampsOf(d, modeTitle) {
  const out = [];
  const score = num(d, 'rc_score'); const prev = num(d, 'rc_prev');
  if (num(d, 'rc_new') && prev > 0) out.push({ id: 'best', text: 'New best', sub: `${score}, was ${prev}` });
  const mile = num(d, 'rc_mile');
  if (mile) out.push({ id: 'mile', text: `${mile} drawings`, sub: 'Gallery milestone' });
  if (num(d, 'rc_perfect')) out.push({ id: 'perfect', text: 'Perfect match', sub: 'Every drawing guessed' });
  if (num(d, 'rc_gold')) out.push({ id: 'gold', text: 'Golden hit', sub: 'Double points' });
  const st = num(d, 'rc_streak'); const bs = num(d, 'hitStreakBest');
  if (st >= 3) out.push({ id: 'streak', text: `${st} in a row`, sub: st >= bs ? 'Your longest run yet' : `Longest run ${bs}` });
  return out;
}

// Tonight's masterpiece: the round with the most points; ties go to the fewest guesses (an early call
// is one guess), then the higher tier, then the earliest round. Null when nothing scored.
export function masterpieceOf(rounds) {
  let best = null;
  rounds.forEach((R, i) => {
    if (!(R.points > 0) || !R.strokes) return;
    const tier = R.tier != null ? R.tier : (R.pick || 0); // v1 rounds have no tier: the picked slot is the tier
    const cand = { i, points: R.points, guesses: R.guesses.length, tier };
    if (!best || cand.points > best.points || (cand.points === best.points && (cand.guesses < best.guesses || (cand.guesses === best.guesses && cand.tier > best.tier)))) best = cand;
  });
  if (!best) return null;
  const R = rounds[best.i];
  const how = R.early === 'hit' ? 'early' : best.guesses === 1 ? 'first' : 'nth';
  return { i: best.i, drawer: R.drawer, points: best.points, guesses: best.guesses, how };
}
export const masterpieceHow = (m) => (m.how === 'early' ? 'called early from half a drawing' : m.how === 'first' ? 'guessed first try' : `guessed on the ${ordinal(m.guesses)} try`);
