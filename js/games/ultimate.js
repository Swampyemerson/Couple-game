// Ultimate Tic-Tac-Toe: nine small boards in a 3×3. The square you pick sends your partner to
// the matching small board; if that board is won or full they may play in any open board.
// Three in a row takes a small board; three small boards in a row takes the game. If no big
// line is possible for either player, most boards won wins (equal = draw).
// Touch: tap a square to aim, tap it again to place. Mouse: hover previews, click places.
// Keys: arrows move a cursor, Enter or Space places.
import { registerGame } from './core.js';

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const NAMES = ['top-left', 'top', 'top-right', 'left', 'middle', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const other = (w) => (w === 'a' ? 'b' : 'a');
function lineOf(arr) {
  for (const L of LINES) {
    const v = arr[L[0]];
    if ((v === 'a' || v === 'b') && arr[L[1]] === v && arr[L[2]] === v) return { who: v, line: L };
  }
  return null;
}
const canStillLine = (big, w) => LINES.some((L) => L.every((k) => big[k] === null || big[k] === w));
const boardsWon = (s) => ({ a: s.big.filter((x) => x === 'a').length, b: s.big.filter((x) => x === 'b').length });

/** Why a move is illegal (a friendly message), or null when it's fine. */
function whyNot(s, who, b, i) {
  if (s.end) return 'The game is over';
  if (!Number.isInteger(b) || b < 0 || b > 8 || !Number.isInteger(i) || i < 0 || i > 8) return 'Pick a square';
  if (who !== s.turn) return 'Not your turn';
  // the send rule first: when you're sent somewhere, that's the useful thing to hear
  if (s.force !== null && s.force !== b) return `You have to play in the ${NAMES[s.force]} board`;
  if (s.big[b] === 'd') return 'That board is full';
  if (s.big[b]) return 'That board is already won';
  if (s.cells[b * 9 + i]) return 'That square is taken';
  return null;
}

function applyMove(s, who, move) {
  const b = move && move.b;
  const i = move && move.i;
  const err = whyNot(s, who, b, i);
  if (err) throw new Error(err);
  s.cells[b * 9 + i] = who;
  s.last = b * 9 + i;
  const small = s.cells.slice(b * 9, b * 9 + 9);
  if (lineOf(small)) s.big[b] = who;
  else if (small.every(Boolean)) s.big[b] = 'd';
  s.force = s.big[i] ? null : i;
  s.turn = other(who);
  const big = lineOf(s.big);
  if (big) s.end = { why: 'line', who: big.who, line: big.line };
  else if (!canStillLine(s.big, 'a') && !canStillLine(s.big, 'b')) {
    const { a, b: bb } = boardsWon(s);
    s.end = { why: 'count', who: a > bb ? 'a' : bb > a ? 'b' : null, a, b: bb };
  }
  return s;
}

const MARK = {
  a: '<path class="gu-ink" d="M11 11L29 29M29 11L11 29"/><path class="gu-col" d="M11 11L29 29M29 11L11 29"/>',
  b: '<circle class="gu-ink" cx="20" cy="20" r="10"/><circle class="gu-col" cx="20" cy="20" r="10"/>',
};
const BIG = {
  a: '<path class="gu-ink" pathLength="2" d="M20 20L80 80M80 20L20 80"/><path class="gu-col" pathLength="2" d="M20 20L80 80M80 20L20 80"/>',
  b: '<circle class="gu-ink" pathLength="2" cx="50" cy="50" r="31" transform="rotate(-90 50 50)"/><circle class="gu-col" pathLength="2" cx="50" cy="50" r="31" transform="rotate(-90 50 50)"/>',
};
const cellSVG = (w, cls = '') => `<svg class="gu-m gu-${w} ${cls}" viewBox="0 0 40 40" aria-hidden="true">${MARK[w]}</svg>`;
const clone = (x) => JSON.parse(JSON.stringify(x));

registerGame({
  id: 'ultimate',
  title: 'Ultimate Tic-Tac-Toe',
  blurb: 'Nine boards. Every move picks where they play next.',
  kind: 'turns',
  team: false,
  tags: ['brainy'],
  platforms: ['phone', 'computer'],
  minutes: 12,
  endDelay: 2000,
  howTo: [
    'Tap a square, tap again to place. Its spot sends your partner to the matching small board.',
    'If that board is already won or full, they may play in any open board.',
    'Three in a row wins a small board; three small boards in a row wins the game. A full board with no winner is dead.',
    'If neither of you can still make a big line, the game ends: most boards won wins, equal is a draw.',
  ],

  // ── rules (pure, deterministic) ──
  init: ({ first }) => ({ cells: Array(81).fill(null), big: Array(9).fill(null), force: null, turn: first, last: null, end: null }),
  next: (s) => (s.end || s.big.every(Boolean) ? [] : [s.turn]),
  apply: applyMove,
  score: (s) => boardsWon(s),
  result(s) {
    const e = s.end;
    const { a, b } = boardsWon(s);
    if (e && e.why === 'line') return { winner: e.who, sub: 'Three boards in a row' };
    if (e && e.who) return { winner: e.who, sub: `No big line was left, so boards won decide it: ${Math.max(a, b)} to ${Math.min(a, b)}` };
    return { winner: null, text: 'Stalemate', sub: `No big line was left and boards won are tied ${a}–${b}. It’s a draw.` };
  },

  // ── view ──
  css: `
.g-ult { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 4px 0 10px; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.g-ult .gu-wrap { position: relative; width: min(100%, 600px, calc(100vh - 260px)); width: min(100%, 600px, calc(100dvh - 260px)); min-width: 270px; }
.g-ult .gu-big { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; background: var(--g-ink); border: 2px solid var(--g-ink); border-radius: var(--g-radius); overflow: hidden; box-shadow: var(--g-shadow); }
.g-ult .gu-sb { position: relative; background: var(--g-card); padding: 6px; transition: background-color 160ms; }
.g-ult .gu-cells { display: grid; grid-template-columns: repeat(3, 1fr); transition: opacity 200ms; }
.g-ult .gu-c { position: relative; aspect-ratio: 1; min-width: 0; margin: 0; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; border-right: 2px solid color-mix(in srgb, var(--g-ink) 30%, transparent); border-bottom: 2px solid color-mix(in srgb, var(--g-ink) 30%, transparent); -webkit-tap-highlight-color: transparent; }
.g-ult .gu-c:nth-child(3n) { border-right: 0; }
.g-ult .gu-c:nth-child(n+7) { border-bottom: 0; }
.g-ult .gu-c:disabled { cursor: default; }
.g-ult .gu-c:focus { outline: none; }
.g-ult .gu-c::before { content: ''; position: absolute; inset: 3px; border-radius: 6px; background: transparent; }
.g-ult .gu-c.is-last::before { background: color-mix(in srgb, var(--g-hl) 75%, transparent); }
.g-ult .gu-c.is-sel::before { background: color-mix(in srgb, var(--g-hl) 60%, transparent); box-shadow: inset 0 0 0 2px var(--g-ink); }
.g-ult .gu-c.is-cur::after { content: ''; position: absolute; inset: 1px; border-radius: 7px; border: 2px dashed var(--g-ink); }
.g-ult .gu-m { position: absolute; inset: 6%; width: 88%; height: 88%; overflow: visible; }
.g-ult .gu-ink { fill: none; stroke: var(--g-ink); stroke-width: 9; stroke-linecap: round; }
.g-ult .gu-col { fill: none; stroke-width: 5; stroke-linecap: round; }
.g-ult .gu-a .gu-col, .g-ult .gu-chip.gu-a { stroke: var(--p-a); background: var(--p-a); }
.g-ult .gu-b .gu-col, .g-ult .gu-chip.gu-b { stroke: var(--p-b); background: var(--p-b); }
.g-ult .gu-m.ghost { opacity: 0.5; }
.g-ult .gu-m.is-new { animation: gu-pop 300ms cubic-bezier(0.3, 1.7, 0.5, 1) both; }
@keyframes gu-pop { from { transform: scale(0.2) rotate(-25deg); opacity: 0; } to { transform: none; opacity: 1; } }

.g-ult .gu-sb.is-open.gu-a { background: color-mix(in srgb, var(--p-a) 16%, var(--g-card)); }
.g-ult .gu-sb.is-open.gu-b { background: color-mix(in srgb, var(--p-b) 16%, var(--g-card)); }
.g-ult .gu-sb.is-open::before, .g-ult .gu-sb.is-theirs::before { content: ''; position: absolute; inset: 2px; border-radius: 6px; pointer-events: none; z-index: 1; }
.g-ult .gu-sb.is-target::after { content: ''; position: absolute; inset: 6px; border-radius: 6px; pointer-events: none; z-index: 1; border: 3px dashed var(--g-ink); animation: gu-breathe 1.2s ease-in-out infinite; }
.g-ult .gu-sb.gu-ta::after { border-color: var(--p-a); } .g-ult .gu-sb.gu-tb::after { border-color: var(--p-b); }
.g-ult .gu-sb.is-open.gu-a::before { box-shadow: inset 0 0 0 3px var(--p-a); }
.g-ult .gu-sb.is-open.gu-b::before { box-shadow: inset 0 0 0 3px var(--p-b); }
.g-ult .gu-sb.is-open::before { animation: gu-breathe 1.8s ease-in-out infinite; }
@keyframes gu-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
.g-ult .gu-sb.is-theirs.gu-a::before { border: 3px dashed var(--p-a); }
.g-ult .gu-sb.is-theirs.gu-b::before { border: 3px dashed var(--p-b); }
.g-ult .gu-sb.is-off .gu-cells { opacity: 0.4; }
.g-ult .gu-sb.is-won .gu-cells { opacity: 0.16; }
.g-ult .gu-sb.is-dead .gu-cells { opacity: 0.35; }
.g-ult .gu-sb.is-dead::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(-45deg, transparent 0 7px, color-mix(in srgb, var(--g-ink) 16%, transparent) 7px 9px); }
.g-ult .gu-sb.shake { animation: gu-shake 340ms ease-out; }
@keyframes gu-shake { 0%, 100% { transform: none; } 25% { transform: translateX(-5px); } 50% { transform: translateX(4px); } 75% { transform: translateX(-2px); } }
.g-ult .gu-bm { position: absolute; inset: 6px; width: calc(100% - 12px); height: calc(100% - 12px); pointer-events: none; overflow: visible; }
.g-ult .gu-bm .gu-ink { stroke-width: 21; }
.g-ult .gu-bm .gu-col { stroke-width: 13; }
.g-ult .gu-bm.is-new path, .g-ult .gu-bm.is-new circle { stroke-dasharray: 2 2; animation: gu-draw 520ms cubic-bezier(0.6, 0, 0.3, 1) both; animation-delay: var(--d, 0ms); }
@keyframes gu-draw { from { stroke-dashoffset: 2; } to { stroke-dashoffset: 0; } }
.g-ult .gu-bm.is-cheer { transform-box: fill-box; transform-origin: center; animation: gu-cheer 560ms cubic-bezier(0.3, 1.6, 0.5, 1) both; animation-delay: var(--c, 0ms); }
@keyframes gu-cheer { 0% { transform: none; } 45% { transform: scale(1.14) rotate(-5deg); } 100% { transform: none; } }
.g-ult .gu-strike { position: absolute; inset: 2px; width: calc(100% - 4px); height: calc(100% - 4px); pointer-events: none; overflow: visible; }
.g-ult .gu-sk { fill: none; stroke-linecap: round; stroke-dasharray: 1 1; animation: gu-sk 480ms cubic-bezier(0.6, 0, 0.3, 1) both; animation-delay: var(--d, 0ms); }
.g-ult .gu-sk-ink { stroke: var(--g-ink); stroke-width: 20; }
.g-ult .gu-sk-hl { stroke: var(--g-hl); stroke-width: 11; }
@keyframes gu-sk { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@media (hover: hover) and (pointer: fine) {
  .g-ult .gu-sb.is-open .gu-c:not(:disabled):hover::before { background: color-mix(in srgb, var(--g-hl) 60%, transparent); }
}

.g-ult .gu-plate { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 16px 8px 10px; border-radius: 999px; background: var(--g-card); border: 2px solid var(--g-ink); box-shadow: var(--g-shadow); font: 800 0.95rem/1.2 var(--g-font-display); color: var(--g-ink); max-width: 100%; text-wrap: balance; }
.g-ult .gu-plate.wait { color: var(--g-muted); border-color: var(--g-line); }
.g-ult .gu-plate.pop { animation: gu-plate 260ms cubic-bezier(0.3, 1.5, 0.5, 1); }
@keyframes gu-plate { from { transform: scale(0.92); } to { transform: none; } }
.g-ult .gu-chip { flex: none; width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--g-ink); background: var(--g-card) !important; display: grid; place-items: center; }
.g-ult .gu-chip .gu-m { position: static; width: 20px; height: 20px; }
.g-ult .gu-chip.none { border-style: dashed; }
@media (prefers-reduced-motion: reduce) {
  .g-ult *, .g-ult *::before, .g-ult *::after { animation: none !important; transition: none !important; }
}
`,

  mount(el, api) {
    const root = document.createElement('div');
    root.className = 'g-ult';
    let html = '<div class="gu-wrap"><div class="gu-big">';
    for (let b = 0; b < 9; b++) {
      html += `<div class="gu-sb" data-b="${b}"><div class="gu-cells">`;
      for (let i = 0; i < 9; i++) html += `<button type="button" class="gu-c" data-b="${b}" data-i="${i}"></button>`;
      html += '</div><svg class="gu-bm" viewBox="0 0 100 100" aria-hidden="true"></svg></div>';
    }
    html += '</div><svg class="gu-strike" viewBox="0 0 300 300" aria-hidden="true"></svg></div>';
    html += '<div class="gu-plate" aria-live="polite"><span class="gu-chip"></span><span class="gu-plate-t"></span></div>';
    root.innerHTML = html;
    el.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const bigEl = $('.gu-big');
    const regions = [...root.querySelectorAll('.gu-sb')];
    const cells = [...root.querySelectorAll('.gu-c')];
    const strike = $('.gu-strike');
    const plate = $('.gu-plate');

    let ctx = null;
    let seen = null;
    let sel = null; // { b, i, by: 'tap' | 'hover' | 'key' }
    let lastPT = '';
    let bigShown = Array(9).fill(null); // which big marks are drawn (to animate new ones)
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
    const legalFor = (s, w) => (s.force !== null ? [s.force] : s.big.map((x, b) => (x ? -1 : b)).filter((b) => b >= 0));
    function preview(b, i) {
      if (!ctx || !ctx.canMove || whyNot(ctx.state, ctx.actor, b, i)) return null;
      try { return applyMove(clone(ctx.state), ctx.actor, { b, i }); } catch { return null; }
    }

    function paint(fresh) {
      const c = ctx;
      const s = c.state;
      const actor = c.actor;
      const waitingOn = !c.over && !c.canMove ? c.acts[0] : null;
      const allowed = new Set(c.over ? [] : legalFor(s, actor || waitingOn));
      const pv = sel ? preview(sel.b, sel.i) : null;
      const target = pv && !pv.end ? pv.force : null;
      regions.forEach((rg, b) => {
        const st = s.big[b];
        let cls = 'gu-sb';
        if (st === 'a' || st === 'b') cls += ' is-won';
        else if (st === 'd') cls += ' is-dead';
        else if (c.canMove) cls += allowed.has(b) ? ` is-open gu-${actor}` : ' is-off';
        else if (waitingOn && allowed.has(b)) cls += ` is-theirs gu-${waitingOn}`;
        if (pv && target === b) cls += ` is-target gu-t${other(actor)}`;
        if (rg.classList.contains('shake')) cls += ' shake';
        rg.className = cls;
        // big mark
        const bm = rg.querySelector('.gu-bm');
        if (st === 'a' || st === 'b') {
          const isNew = bigShown[b] !== st && fresh.animate;
          if (bigShown[b] !== st || bm.dataset.w !== st) {
            bm.innerHTML = BIG[st];
            bm.dataset.w = st;
          }
          bm.setAttribute('class', `gu-bm gu-${st}${isNew ? ' is-new' : ''}`);
          bm.style.setProperty('--d', `${fresh.bigDelay}ms`);
        } else if (bm.dataset.w) { bm.innerHTML = ''; bm.dataset.w = ''; bm.setAttribute('class', 'gu-bm'); }
      });
      bigShown = s.big.slice();
      cells.forEach((btn, k) => {
        const b = Math.floor(k / 9);
        const i = k % 9;
        const v = s.cells[k];
        const isSel = sel && sel.b === b && sel.i === i;
        const ok = isSel && !!pv;
        let cls = 'gu-c';
        if (k === s.last && !c.over) cls += ' is-last';
        if (ok) cls += ' is-sel';
        if (isSel && sel.by === 'key') cls += ' is-cur';
        btn.className = cls;
        const want = v ? `${v}${k === fresh.newCell ? '+' : ''}` : ok ? `ghost-${actor}` : '';
        if (btn.dataset.m !== want) {
          btn.dataset.m = want;
          btn.innerHTML = v ? cellSVG(v, k === fresh.newCell ? 'is-new' : '') : ok ? cellSVG(actor, 'ghost') : '';
        }
        btn.disabled = !c.canMove;
        btn.setAttribute('aria-label', `${NAMES[b]} board, square ${i + 1}${v ? `, ${api.name(v)}` : ''}`);
      });
      // finale
      strike.innerHTML = '';
      if (s.end && s.end.why === 'line') {
        const L = s.end.line;
        const pt = (b) => [50 + (b % 3) * 100, 50 + Math.floor(b / 3) * 100];
        const [x1, y1] = pt(L[0]);
        const [x2, y2] = pt(L[2]);
        const dx = (x2 - x1) / 200 * 30;
        const dy = (y2 - y1) / 200 * 30;
        const d = `M${x1 - dx} ${y1 - dy}L${x2 + dx} ${y2 + dy}`;
        const delay = fresh.finale;
        strike.innerHTML = `<path class="gu-sk gu-sk-ink" pathLength="1" d="${d}" style="--d:${delay}ms"/><path class="gu-sk gu-sk-hl" pathLength="1" d="${d}" style="--d:${delay}ms"/>`;
      }
      if (s.end && s.end.who) {
        const winners = s.end.why === 'line' ? s.end.line : s.big.map((x, b) => (x === s.end.who ? b : -1)).filter((b) => b >= 0);
        winners.forEach((b, n) => {
          const bm = regions[b].querySelector('.gu-bm');
          const cheer = () => { bm.classList.remove('is-new'); bm.style.setProperty('--c', `${n * 100}ms`); bm.classList.add('is-cheer'); };
          if (fresh.finale > 0) later(cheer, fresh.finale + 300); else cheer();
        });
      }
      renderPlate(pv, target);
    }

    function renderPlate(pv, target) {
      const c = ctx;
      const s = c.state;
      const online = c.mode === 'online';
      let who = c.actor;
      let text;
      let wait = false;
      if (c.over) {
        const e = s.end || {};
        const { a, b } = boardsWon(s);
        who = e.who || null;
        if (e.why === 'line') text = `${api.name(e.who)} wins, three in a row`;
        else if (e.who) text = `${api.name(e.who)} wins on boards, ${Math.max(a, b)}–${Math.min(a, b)}`;
        else text = `Boards tied ${a}–${b}. A draw.`;
      } else if (!c.canMove) {
        who = c.acts[0] || null;
        wait = true;
        text = `${api.name(who)}’s turn`;
      } else if (sel && pv) {
        const act = sel.by === 'tap' ? 'Tap again' : sel.by === 'hover' ? 'Click' : 'Press Enter';
        const opp = api.name(other(who));
        if (pv.end) text = `${act} to place`;
        else if (target === null) text = `${act} · ${opp} can then go anywhere`;
        else text = `${act} · sends ${opp} to the ${NAMES[target]} board`;
      } else {
        const where = s.force !== null ? `play in the ${NAMES[s.force]} board` : 'play in any open board';
        text = online ? `Your turn · ${where}` : `${api.name(who)}: ${where}`;
      }
      const chip = $('.gu-chip');
      chip.className = `gu-chip ${who ? 'gu-' + who : 'none'}`;
      chip.innerHTML = who ? cellSVG(who) : '';
      plate.classList.toggle('wait', wait);
      $('.gu-plate-t').textContent = text;
    }
    const popPlate = () => { plate.classList.remove('pop'); void plate.offsetWidth; plate.classList.add('pop'); };
    const calm = { animate: false, newCell: -1, bigDelay: 0, finale: 0 };

    function shake(b) {
      const rg = regions[b];
      rg.classList.remove('shake'); void rg.offsetWidth; rg.classList.add('shake');
      later(() => rg.classList.remove('shake'), 360);
    }
    function refuse(b, msg) {
      api.toast(msg);
      api.sfx('bad');
      api.haptic(40);
      shake(b);
    }
    function aim(b, i, by) {
      if (!ctx || !ctx.canMove) return;
      if (sel && sel.b === b && sel.i === i && sel.by === by) return;
      sel = { b, i, by };
      if (by !== 'hover') { api.sfx('tap'); api.haptic(8); }
      paint(calm);
    }
    function clearAim() {
      if (!sel) return;
      sel = null;
      paint(calm);
    }
    function place(b, i) {
      if (!ctx || !ctx.canMove) return;
      const r = api.move({ b, i });
      if (!r.ok) refuse(b, r.error);
    }

    // touch: aim then place. mouse: hover previews, click places.
    bigEl.addEventListener('pointerdown', (e) => { lastPT = e.pointerType || ''; });
    bigEl.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !ctx || !ctx.canMove) return;
      const btn = e.target.closest('.gu-c');
      if (!btn) return;
      const b = Number(btn.dataset.b);
      const i = Number(btn.dataset.i);
      if (whyNot(ctx.state, ctx.actor, b, i)) { if (sel && sel.by === 'hover') clearAim(); return; }
      aim(b, i, 'hover');
    });
    bigEl.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && sel && sel.by === 'hover') clearAim(); });
    bigEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.gu-c');
      if (!btn || !ctx || !ctx.canMove) return;
      const b = Number(btn.dataset.b);
      const i = Number(btn.dataset.i);
      const pt = e.pointerType || lastPT || 'touch';
      lastPT = '';
      if (pt === 'mouse') { place(b, i); return; }
      const why = whyNot(ctx.state, ctx.actor, b, i);
      if (why) { refuse(b, why); if (sel) clearAim(); return; }
      if (sel && sel.b === b && sel.i === i && sel.by !== 'hover') place(b, i);
      else aim(b, i, 'tap');
    });
    const toRC = (b, i) => [Math.floor(b / 3) * 3 + Math.floor(i / 3), (b % 3) * 3 + (i % 3)];
    const fromRC = (R, C) => ({ b: Math.floor(R / 3) * 3 + Math.floor(C / 3), i: (R % 3) * 3 + (C % 3) });
    function defaultCursor() {
      const s = ctx.state;
      const boards = legalFor(s, ctx.actor);
      const b = boards.includes(4) ? 4 : boards[0];
      const order = [4, 0, 2, 6, 8, 1, 3, 5, 7];
      const i = order.find((x) => !s.cells[b * 9 + x]);
      return { b, i: i ?? 4 };
    }
    const onKey = (e) => {
      if (!ctx || !ctx.canMove || !root.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('#game-root .gm-sheet:not([hidden]), #game-root .gm-end:not([hidden])')) return;
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      const foreignButton = t && t.closest && t.closest('button, a') && !root.contains(t);
      const arrows = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
      if (arrows[e.key]) {
        e.preventDefault();
        if (!sel || sel.by === 'hover') { const d = defaultCursor(); aim(d.b, d.i, 'key'); return; }
        const [R, C] = toRC(sel.b, sel.i);
        const [dr, dc] = arrows[e.key];
        // when you're sent to one board, the cursor stays inside it
        const f = ctx.state.force;
        const [r0, c0, span] = f !== null ? [Math.floor(f / 3) * 3, (f % 3) * 3, 2] : [0, 0, 8];
        const n = fromRC(Math.max(r0, Math.min(r0 + span, R + dr)), Math.max(c0, Math.min(c0 + span, C + dc)));
        aim(n.b, n.i, 'key');
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && !foreignButton) {
        e.preventDefault();
        if (!sel) { const d = defaultCursor(); aim(d.b, d.i, 'key'); return; }
        const why = whyNot(ctx.state, ctx.actor, sel.b, sel.i);
        if (why) refuse(sel.b, why);
        else place(sel.b, sel.i);
      }
    };
    document.addEventListener('keydown', onKey);

    return {
      update(c) {
        const prev = seen;
        ctx = c;
        seen = c.moves;
        const moved = prev !== c.moves;
        const animate = !reduced() && !!c.last && (prev == null ? c.mode === 'online' && c.last.who !== c.me : c.moves === prev + 1);
        if (prev == null) bigShown = animate ? c.state.big.map((x, b) => (c.last && Math.floor(c.state.last / 9) === b ? null : x)) : c.state.big.slice();
        if (moved || !c.canMove) sel = sel && sel.by === 'key' && c.canMove ? sel : null;
        if (sel && sel.by === 'key' && c.canMove) {
          // keep the keyboard cursor, but move it into the board you're now sent to
          if (whyNot(c.state, c.actor, sel.b, sel.i)) { const d = defaultCursor(); sel = { ...d, by: 'key' }; }
        }
        const lastB = c.state.last != null ? Math.floor(c.state.last / 9) : -1;
        const wonNow = animate && lastB >= 0 && bigShown[lastB] !== c.state.big[lastB] && (c.state.big[lastB] === 'a' || c.state.big[lastB] === 'b');
        const fresh = {
          animate,
          newCell: animate ? c.state.last : -1,
          bigDelay: 180,
          finale: c.over && animate ? (wonNow ? 760 : 300) : 0,
        };
        paint(fresh);
        if (animate) {
          api.sfx('place');
          api.haptic(14);
          if (wonNow) later(() => { api.sfx('good'); api.haptic(25); }, 220);
          else if (lastB >= 0 && c.state.big[lastB] === 'd') later(() => api.sfx('flip'), 200);
          if (c.over && c.state.end && c.state.end.why === 'line') later(() => api.sfx('pop'), fresh.finale + 200);
        }
        if (moved && prev != null) popPlate();
      },
      destroy() {
        document.removeEventListener('keydown', onKey);
        for (const t of timers) clearTimeout(t);
        timers.clear();
      },
    };
  },
});
