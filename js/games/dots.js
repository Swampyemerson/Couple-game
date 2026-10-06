// Dots & Boxes: 5×5 dots, 4×4 boxes. Draw a line between two neighbouring dots; close a box
// to claim it and go again. Most boxes when every line is drawn wins.
// Touch: tap a gap to pick the line, tap it again to draw. Mouse: hover previews, click draws.
import { registerGame } from './core.js';

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

// ── geometry (SVG user units) ──
const S = 100;
const M = 50;
const V = B * S + 2 * M;
const px = (c) => M + c * S;
const ends = (l, r, c) => (l === 'h' ? [px(c), px(r), px(c + 1), px(r)] : [px(c), px(r), px(c), px(r + 1)]);
const lineD = (l, r, c) => { const [x1, y1, x2, y2] = ends(l, r, c); return `M${x1} ${y1}L${x2} ${y2}`; };
function hitPoints(l, r, c) {
  const h = S / 2;
  if (l === 'h') { const y = px(r); const x0 = px(c); return `${x0},${y} ${x0 + h},${y - h} ${x0 + S},${y} ${x0 + h},${y + h}`; }
  const x = px(c); const y0 = px(r);
  return `${x},${y0} ${x + h},${y0 + h} ${x},${y0 + S} ${x - h},${y0 + h}`;
}
const ALL = [];
for (let r = 0; r < N; r++) for (let c = 0; c < B; c++) ALL.push(['h', r, c]);
for (let r = 0; r < B; r++) for (let c = 0; c < N; c++) ALL.push(['v', r, c]);
const BOX_IN = 41;

registerGame({
  id: 'dots',
  title: 'Dots & Boxes',
  blurb: 'Draw lines, close boxes, steal the chain.',
  kind: 'turns',
  team: false,
  tags: ['brainy'],
  platforms: ['phone', 'computer'],
  minutes: 8,
  endDelay: 1500,
  howTo: [
    'Take turns drawing a line between two dots next to each other.',
    'Tap a gap to pick it, tap again to draw it.',
    'Close a box and it’s yours, and you go again.',
    'When every line is drawn, most boxes wins.',
  ],

  // ── rules (pure, deterministic) ──
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

  // ── view ──
  css: `
.g-dots { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 4px 0 10px; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.g-dots .gd-wrap { position: relative; width: min(100%, 540px, calc(100vh - 270px)); width: min(100%, 540px, calc(100dvh - 270px)); min-width: 260px; aspect-ratio: 1; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow); }
.g-dots .gd-wrap::after { content: ''; position: absolute; inset: 6px; border: 1px solid var(--g-ink); border-radius: calc(var(--g-radius) - 5px); opacity: 0.3; pointer-events: none; }
.g-dots .gd-svg { display: block; width: 100%; height: 100%; overflow: visible; }
.g-dots .gd-guide { fill: none; stroke: var(--g-muted); stroke-width: 3.5; stroke-linecap: round; stroke-dasharray: 0.1 12; opacity: 0.55; }
.g-dots .gd-guide.off { display: none; }
.g-dots .gd-dot { fill: var(--g-ink); }
.g-dots .gd-ln { fill: none; stroke: var(--g-ink); stroke-width: 9; stroke-linecap: round; }
.g-dots .gd-ln.is-new { stroke-dasharray: 1 1; animation: gd-draw 300ms cubic-bezier(0.5, 0, 0.3, 1) both; }
.g-dots .gd-ln-hl { fill: none; stroke: var(--g-hl); stroke-width: 22; stroke-linecap: round; animation: gd-fade 300ms ease-out both; }
@keyframes gd-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes gd-fade { from { opacity: 0; } to { opacity: 1; } }
.g-dots .gd-box rect { stroke: var(--g-ink); stroke-width: 2px; vector-effect: non-scaling-stroke; }
.g-dots .gd-box.gd-a rect, .g-dots .gd-chip.gd-a { fill: var(--p-a); background: var(--p-a); }
.g-dots .gd-box.gd-b rect, .g-dots .gd-chip.gd-b { fill: var(--p-b); background: var(--p-b); }
.g-dots .gd-box text { fill: var(--g-on-ink); font: 900 46px var(--g-font-display); text-anchor: middle; dominant-baseline: central; }
.g-dots .gd-box .gd-stamp { transform-box: fill-box; transform-origin: center; }
.g-dots .gd-box.is-new .gd-stamp { animation: gd-stamp 380ms cubic-bezier(0.3, 1.6, 0.5, 1) both; animation-delay: var(--sd, 0ms); }
@keyframes gd-stamp { from { transform: scale(1.5) rotate(-12deg); opacity: 0; } 60% { opacity: 1; } to { transform: none; opacity: 1; } }
.g-dots.is-done .gd-box.is-win .gd-stamp { animation: gd-cheer 520ms cubic-bezier(0.3, 1.6, 0.5, 1) both; animation-delay: var(--wd, 0ms); }
@keyframes gd-cheer { 0% { transform: none; } 45% { transform: scale(1.12) rotate(-4deg); } 100% { transform: none; } }
.g-dots.is-done.has-winner .gd-box:not(.is-win) { opacity: 0.45; transition: opacity 500ms; }
.g-dots .gd-pl { fill: none; stroke-width: 9; stroke-linecap: round; opacity: 0; }
.g-dots .gd-pl.gd-a { stroke: var(--p-a); } .g-dots .gd-pl.gd-b { stroke: var(--p-b); }
.g-dots .gd-pl.is-hover { opacity: 0.55; }
.g-dots .gd-pl.is-sel { opacity: 1; animation: gd-pulse 900ms ease-in-out infinite; }
@keyframes gd-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.g-dots .gd-gb { stroke: none; opacity: 0.3; }
.g-dots .gd-gb.gd-a { fill: var(--p-a); } .g-dots .gd-gb.gd-b { fill: var(--p-b); }
.g-dots .gd-hit { fill: transparent; pointer-events: all; cursor: pointer; outline: none; }
.g-dots .gd-hit.is-drawn { cursor: default; }
.g-dots.is-locked .gd-hit { pointer-events: none; cursor: default; }
.g-dots .gd-plate { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 16px 8px 10px; border-radius: 999px; background: var(--g-card); border: 2px solid var(--g-ink); box-shadow: var(--g-shadow); font: 800 0.98rem/1.2 var(--g-font-display); color: var(--g-ink); max-width: 100%; }
.g-dots .gd-plate.wait { color: var(--g-muted); border-color: var(--g-line); }
.g-dots .gd-plate.pop { animation: gd-plate 280ms cubic-bezier(0.3, 1.6, 0.5, 1); }
.g-dots .gd-plate.extra { background: color-mix(in srgb, var(--g-hl) 45%, var(--g-card)); }
@keyframes gd-plate { from { transform: scale(0.9); } to { transform: none; } }
.g-dots .gd-chip { flex: none; width: 22px; height: 22px; border-radius: 5px; border: 2px solid var(--g-ink); }
.g-dots .gd-chip.none { background: transparent; border-style: dashed; }
@media (prefers-reduced-motion: reduce) {
  .g-dots * { animation: none !important; transition: none !important; }
}
`,

  mount(el, api) {
    const root = document.createElement('div');
    root.className = 'g-dots';
    const dots = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) dots.push(`<circle class="gd-dot" cx="${px(c)}" cy="${px(r)}" r="8.5"/>`);
    root.innerHTML = `
      <div class="gd-wrap">
        <svg class="gd-svg" viewBox="0 0 ${V} ${V}">
          <g class="gd-boxes"></g>
          <g class="gd-guides">${ALL.map(([l, r, c]) => `<path class="gd-guide" data-k="${key(l, r, c)}" d="${lineD(l, r, c)}"/>`).join('')}</g>
          <g class="gd-hls"></g>
          <g class="gd-lines"></g>
          <g class="gd-ghosts"></g>
          <path class="gd-pl" d="M0 0"/>
          <g class="gd-dots">${dots.join('')}</g>
          <g class="gd-hits">${ALL.map(([l, r, c]) => `<polygon class="gd-hit" data-k="${key(l, r, c)}" data-l="${l}" data-r="${r}" data-c="${c}" points="${hitPoints(l, r, c)}" role="button" aria-label="${l === 'h' ? 'Across' : 'Down'} line, row ${r + 1}, column ${c + 1}"/>`).join('')}</g>
        </svg>
      </div>
      <div class="gd-plate" aria-live="polite"><span class="gd-chip"></span><span class="gd-plate-t"></span></div>`;
    el.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const svg = $('.gd-svg');
    const boxLayer = $('.gd-boxes');
    const hlLayer = $('.gd-hls');
    const lineLayer = $('.gd-lines');
    const ghostLayer = $('.gd-ghosts');
    const pl = $('.gd-pl');
    const hits = $('.gd-hits');
    const plate = $('.gd-plate');
    const guides = new Map([...root.querySelectorAll('.gd-guide')].map((g) => [g.dataset.k, g]));
    const initial = (w) => (String(api.name(w) || w).trim()[0] || w).toUpperCase();

    let ctx = null;
    let seenLines = null; // how many lines were drawn at the last paint
    let sel = null; // { l, r, c, by: 'tap' | 'hover' }
    let lastPT = '';
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

    function renderBoard(c, fresh) {
      const s = c.state;
      const order = s.order;
      // the newest turn: trailing lines drawn by whoever drew last
      const lastOwner = order.length ? drawn(s, ...unkey(order[order.length - 1])) : null;
      let k = order.length;
      while (k > 0 && drawn(s, ...unkey(order[k - 1])) === lastOwner) k--;
      const recent = new Set(c.over ? [] : order.slice(k));
      const newFrom = fresh.from;
      let lines = '';
      let hls = '';
      order.forEach((kk, i) => {
        const d = lineD(...unkey(kk));
        const isNew = i >= newFrom;
        const delay = isNew ? (i - newFrom) * fresh.gap : 0;
        if (recent.has(kk)) hls += `<path class="gd-ln-hl" d="${d}" style="animation-delay:${delay}ms"/>`;
        lines += `<path class="gd-ln${isNew ? ' is-new' : ''}" pathLength="1" d="${d}" style="animation-delay:${delay}ms"/>`;
        const g = guides.get(kk);
        if (g) g.classList.add('off');
      });
      for (const [kk, g] of guides) if (!order.includes(kk)) g.classList.remove('off');
      lineLayer.innerHTML = lines;
      hlLayer.innerHTML = hls;
      // boxes
      const winner = c.over && c.result ? c.result.winner : null;
      let boxes = '';
      s.boxes.forEach((w, bi) => {
        if (!w) return;
        const br = Math.floor(bi / B);
        const bc = bi % B;
        const isNew = fresh.boxes.has(bi);
        const x = px(bc) + S / 2;
        const y = px(br) + S / 2;
        const sd = isNew ? fresh.boxes.get(bi) : 0;
        boxes += `<g class="gd-box gd-${w}${isNew ? ' is-new' : ''}${winner === w ? ' is-win' : ''}" transform="translate(${x} ${y})"><g class="gd-stamp" style="--sd:${sd}ms;--wd:${bi * 45}ms"><rect x="${-BOX_IN}" y="${-BOX_IN}" width="${2 * BOX_IN}" height="${2 * BOX_IN}" rx="7"/><text y="3">${initial(w)}</text></g></g>`;
      });
      boxLayer.innerHTML = boxes;
      for (const h of hits.children) {
        const isDrawn = !!drawn(s, h.dataset.l, Number(h.dataset.r), Number(h.dataset.c));
        h.classList.toggle('is-drawn', isDrawn);
        h.setAttribute('aria-disabled', String(!c.canMove || isDrawn));
      }
    }

    function renderSel() {
      const c = ctx;
      const on = sel && c && c.canMove;
      const who = (c && c.actor) || 'a';
      if (!on) { pl.setAttribute('class', 'gd-pl'); ghostLayer.innerHTML = ''; return; }
      pl.setAttribute('d', lineD(sel.l, sel.r, sel.c));
      pl.setAttribute('class', `gd-pl gd-${who} ${sel.by === 'tap' ? 'is-sel' : 'is-hover'}`);
      ghostLayer.innerHTML = wouldClose(c.state, sel.l, sel.r, sel.c)
        .map(([br, bc]) => `<rect class="gd-gb gd-${who}" x="${px(bc) + S / 2 - BOX_IN}" y="${px(br) + S / 2 - BOX_IN}" width="${2 * BOX_IN}" height="${2 * BOX_IN}" rx="7"/>`).join('');
    }

    function renderPlate() {
      const c = ctx;
      if (!c) return;
      const online = c.mode === 'online';
      let who = c.actor;
      let text;
      let wait = false;
      let extra = false;
      if (c.over) {
        const { a, b } = countBoxes(c.state);
        who = c.result && c.result.winner;
        text = who ? `${api.name(who)} wins, ${Math.max(a, b)} to ${Math.min(a, b)}` : `${a} boxes each. A draw!`;
      } else if (!c.canMove) {
        who = c.acts[0] || null;
        wait = true;
        text = c.last && c.last.who === who && c.state.got ? `${api.name(who)} closed a box and goes again` : `${api.name(who)}’s turn`;
      } else if (sel && sel.by === 'tap') {
        text = 'Tap the same line again to draw it';
      } else if (sel && sel.by === 'hover') {
        text = 'Click to draw this line';
      } else if (c.last && c.last.who === who && c.state.got) {
        extra = true;
        const n = c.state.got;
        text = online ? `${n > 1 ? 'Two boxes' : 'Box'}! Go again` : `${n > 1 ? 'Two boxes' : 'Box'} for ${api.name(who)}! Go again`;
      } else {
        text = online ? 'Your turn · tap between two dots' : `${api.name(who)}, tap between two dots`;
      }
      $('.gd-chip').className = `gd-chip ${who ? 'gd-' + who : 'none'}`;
      plate.classList.toggle('wait', wait);
      plate.classList.toggle('extra', extra);
      $('.gd-plate-t').textContent = text;
    }
    const popPlate = () => { plate.classList.remove('pop'); void plate.offsetWidth; plate.classList.add('pop'); };

    function pick(l, r, c, by) {
      if (!ctx || !ctx.canMove) return;
      const same = sel && sel.l === l && sel.r === r && sel.c === c;
      if (same && sel.by === by) return;
      sel = { l, r, c, by };
      if (by === 'tap') { api.sfx('tap'); api.haptic(8); }
      renderSel();
      renderPlate();
    }
    function clearSel() {
      if (!sel) return;
      sel = null;
      renderSel();
      renderPlate();
    }
    function commit(l, r, c) {
      if (!ctx || !ctx.canMove) return;
      const res = api.move({ l, r, c });
      if (!res.ok) { api.toast(res.error); api.sfx('bad'); api.haptic(40); clearSel(); }
    }
    const hitOf = (e) => { const h = e.target.closest && e.target.closest('.gd-hit'); return h ? [h.dataset.l, Number(h.dataset.r), Number(h.dataset.c)] : null; };

    svg.addEventListener('pointerdown', (e) => { lastPT = e.pointerType || ''; });
    svg.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !ctx || !ctx.canMove) return;
      const h = hitOf(e);
      if (!h || drawn(ctx.state, ...h)) { if (sel && sel.by === 'hover') clearSel(); return; }
      pick(...h, 'hover');
    });
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && sel && sel.by === 'hover') clearSel(); });
    svg.addEventListener('click', (e) => {
      const h = hitOf(e);
      if (!h || !ctx || !ctx.canMove) return;
      const pt = e.pointerType || lastPT || 'touch';
      lastPT = '';
      const [l, r, c] = h;
      if (pt === 'mouse') { commit(l, r, c); return; }
      if (drawn(ctx.state, l, r, c)) { api.toast('That line is already drawn'); api.sfx('bad'); clearSel(); return; }
      if (sel && sel.by === 'tap' && sel.l === l && sel.r === r && sel.c === c) commit(l, r, c);
      else pick(l, r, c, 'tap');
    });

    return {
      update(c) {
        ctx = c;
        const n = c.state.order.length;
        const prev = seenLines;
        seenLines = n;
        // which lines and boxes are new since the last paint (to animate and to sound)
        let from = n;
        if (prev != null && n > prev) from = prev;
        else if (prev == null && c.mode === 'online' && c.last && c.last.who !== c.me) {
          // opening the game: replay the partner's latest turn
          let k = n;
          while (k > 0 && drawn(c.state, ...unkey(c.state.order[k - 1])) === c.last.who) k--;
          from = k;
        }
        if (reduced()) from = n;
        const gap = n - from > 1 ? 260 : 0;
        const boxDelay = new Map();
        const before = { h: c.state.h.slice(), v: c.state.v.slice() };
        for (let i = from; i < n; i++) { const [l, r, cc] = unkey(c.state.order[i]); before[l][idx(l, r, cc)] = null; }
        // replay the new lines one by one to find when each box closed
        for (let i = from; i < n; i++) {
          const [l, r, cc] = unkey(c.state.order[i]);
          before[l][idx(l, r, cc)] = 'x';
          for (const [br, bc] of boxesBeside(l, r, cc)) {
            const bi = br * B + bc;
            if (c.state.boxes[bi] && !boxDelay.has(bi) && complete(before, br, bc)) boxDelay.set(bi, (i - from) * gap + 220);
          }
        }
        if (n !== prev) sel = null;
        if (!c.canMove) sel = null;
        renderBoard(c, { from, gap, boxes: boxDelay });
        renderSel();
        renderPlate();
        root.classList.toggle('is-locked', !c.canMove);
        root.classList.remove('is-done');
        root.classList.toggle('has-winner', !!(c.over && c.result && c.result.winner));
        if (c.over) {
          const wait = boxDelay.size ? Math.max(...boxDelay.values()) + 420 : 0;
          if (wait) later(() => root.classList.add('is-done'), wait); else root.classList.add('is-done');
        }
        if (n > from) {
          for (let i = from; i < n; i++) later(() => { api.sfx(i === n - 1 ? 'place' : 'tick'); }, (i - from) * gap);
          const got = boxDelay.size;
          if (got) later(() => { api.sfx('good'); api.haptic(25); if (got > 1) later(() => api.sfx('pop'), 160); }, Math.max(...boxDelay.values()));
          if (prev != null) popPlate();
        }
      },
      destroy() {
        for (const t of timers) clearTimeout(t);
        timers.clear();
      },
    };
  },
});
