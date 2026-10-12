// Snapshot of the Dots & Boxes rules exactly as they were before the modes (setup move) were added.
// board.test.js replays random legacy logs (no setup move) through this and the live game and compares them.
const N = 5; // dots per side
const B = N - 1; // boxes per side
const TOTAL = 2 * N * B; // 40 lines
const other = (w) => (w === 'a' ? 'b' : 'a');
const idx = (l, r, c) => (l === 'h' ? r * B + c : r * N + c);
const key = (l, r, c) => `${l}-${r}-${c}`;
const unkey = (k) => { const [l, r, c] = k.split('-'); return [l, Number(r), Number(c)]; };
const drawn = (s, l, r, c) => (l === 'h' ? s.h : s.v)[idx(l, r, c)];
const edgesOf = (r, c) => [['h', r, c], ['h', r + 1, c], ['v', r, c], ['v', r, c + 1]];
const complete = (s, r, c) => edgesOf(r, c).every(([l, rr, cc]) => drawn(s, l, rr, cc));
function boxesBeside(l, r, c) {
  const out = [];
  if (l === 'h') { if (r > 0) out.push([r - 1, c]); if (r < B) out.push([r, c]); } else { if (c > 0) out.push([r, c - 1]); if (c < B) out.push([r, c]); }
  return out;
}
function parseMove(m) {
  const l = m && m.l;
  const r = m && m.r;
  const c = m && m.c;
  if ((l !== 'h' && l !== 'v') || !Number.isInteger(r) || !Number.isInteger(c)) throw new Error('Tap between two dots');
  const ok = l === 'h' ? r >= 0 && r < N && c >= 0 && c < B : r >= 0 && r < B && c >= 0 && c < N;
  if (!ok) throw new Error('Tap between two dots');
  return { l, r, c };
}
/** Boxes this line would close right now. */
function wouldClose(s, l, r, c) {
  const t = { h: s.h.slice(), v: s.v.slice() };
  (l === 'h' ? t.h : t.v)[idx(l, r, c)] = 'x';
  return boxesBeside(l, r, c).filter(([br, bc]) => !s.boxes[br * B + bc] && complete(t, br, bc));
}
const countBoxes = (s) => ({ a: s.boxes.filter((x) => x === 'a').length, b: s.boxes.filter((x) => x === 'b').length });

export const legacyDots = {
  id: 'dots-legacy',
  init: ({ first }) => ({ h: Array(N * B).fill(null), v: Array(N * B).fill(null), boxes: Array(B * B).fill(null), turn: first, order: [], got: 0 }),
  next: (s) => (s.order.length >= TOTAL ? [] : [s.turn]),
  apply(s, who, move) {
    const { l, r, c } = parseMove(move);
    if (who !== s.turn) throw new Error('Not your turn');
    const arr = l === 'h' ? s.h : s.v;
    if (arr[idx(l, r, c)]) throw new Error('That line is already drawn');
    arr[idx(l, r, c)] = who;
    s.order.push(key(l, r, c));
    let got = 0;
    for (const [br, bc] of boxesBeside(l, r, c)) {
      const bi = br * B + bc;
      if (!s.boxes[bi] && complete(s, br, bc)) { s.boxes[bi] = who; got++; }
    }
    s.got = got;
    if (!got) s.turn = other(who);
    return s;
  },
  score: (s) => countBoxes(s),
  result(s) {
    const { a, b } = countBoxes(s);
    if (a === b) return { winner: null, text: `${a} all`, sub: 'Same number of boxes. It’s a draw.', score: a };
    const w = a > b ? 'a' : 'b';
    return { winner: w, sub: `${Math.max(a, b)} boxes to ${Math.min(a, b)}` };
  },
};
