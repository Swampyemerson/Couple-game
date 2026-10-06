// Reference turn game (unlisted in the hub). Copy this shape for new turn games.
import { registerGame } from './core.js';

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const winnerOf = (b) => {
  for (const [x, y, z] of LINES) if (b[x] && b[x] === b[y] && b[x] === b[z]) return { who: b[x], line: [x, y, z] };
  return null;
};

registerGame({
  id: 'example-ttt',
  title: 'Tic-Tac-Toe (example)',
  blurb: 'Reference implementation.',
  kind: 'turns',
  unlisted: true,
  tags: ['quick'],
  howTo: ['Tap a square.', 'Three in a row wins.'],

  // ── rules (pure, deterministic) ──
  init: ({ first }) => ({ board: Array(9).fill(null), turn: first }),
  next: (s) => (winnerOf(s.board) || s.board.every(Boolean) ? [] : [s.turn]),
  apply(s, who, move) {
    const i = move.i;
    if (!Number.isInteger(i) || i < 0 || i > 8) throw new Error('Bad square');
    if (s.board[i]) throw new Error('That square is taken');
    s.board[i] = who;
    s.turn = who === 'a' ? 'b' : 'a';
    return s;
  },
  result(s) {
    const w = winnerOf(s.board);
    return w ? { winner: w.who } : { winner: null, text: 'Cat’s game' };
  },

  // ── view ──
  css: `
    .ttt { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: min(84vw, 360px); margin: 12px auto; }
    .ttt button { aspect-ratio: 1; border-radius: 12px; border: 2px solid var(--g-line); background: var(--g-card); font-size: 2.4rem; font-weight: 900; }
    .ttt button.a { color: var(--p-a); } .ttt button.b { color: var(--p-b); }
    .ttt button.win { background: var(--g-hl); }
  `,
  mount(el, api) {
    el.innerHTML = '<div class="ttt"></div>';
    const grid = el.querySelector('.ttt');
    let ctx = null;
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !ctx || !ctx.canMove) return;
      const r = api.move({ i: Number(b.dataset.i) });
      if (r.ok) api.sfx('place'); else api.toast(r.error);
    });
    return {
      update(c) {
        ctx = c;
        const w = winnerOf(c.state.board);
        grid.innerHTML = c.state.board.map((v, i) => `<button data-i="${i}" class="${v || ''} ${w && w.line.includes(i) ? 'win' : ''}" aria-label="Square ${i + 1}" ${v || !c.canMove ? 'disabled' : ''}>${v === 'a' ? '×' : v === 'b' ? '○' : ''}</button>`).join('');
      },
      destroy() {},
    };
  },
});
