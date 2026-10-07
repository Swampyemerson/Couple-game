// Hub cover art for each game, keyed by game id (inline SVG strings, 160×100).
// One printed-illustration style: flat Riso inks on a tint, a black key plate for outlines,
// halftone dots for shading and the odd off-register plate. Everything is drawn with the
// theme's CSS variables, so covers reprint themselves in dark mode. No text, no ids/defs
// (a cover can appear several times on one page), and the art crops from the centre.

const INK = {
  a: 'var(--p-a)', b: 'var(--p-b)', y: 'var(--g-hl)', k: 'var(--g-ink)', w: 'var(--g-card)', g: 'var(--g-bg)',
  sa: 'var(--p-a-soft)', sb: 'var(--p-b-soft)', sy: 'var(--g-hl-soft)', l: 'var(--g-line)', n: 'none',
};
const c = (x) => INK[x] || x;
const f1 = (n) => Math.round(n * 10) / 10;
// style attribute: fill, stroke, stroke width, extra css
const st = (fill, stroke, sw, extra) => ` style="fill:${c(fill || 'n')};stroke:${c(stroke || 'n')}${stroke && stroke !== 'n' ? `;stroke-width:${sw ?? 2.5}` : ''}${extra ? `;${extra}` : ''}"`;
const R = (x, y, w, h, f, k, sw, rx = 0, ex = '') => `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}"${rx ? ` rx="${rx}"` : ''}${st(f, k, sw, ex)}/>`;
const C = (cx, cy, r, f, k, sw, ex = '') => `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}"${st(f, k, sw, ex)}/>`;
const E = (cx, cy, rx, ry, f, k, sw, ex = '', rot = 0) => `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(ry)}"${rot ? ` transform="rotate(${rot} ${f1(cx)} ${f1(cy)})"` : ''}${st(f, k, sw, ex)}/>`;
const P = (d, f, k, sw, ex = '') => `<path d="${d}"${st(f, k, sw, ex)}/>`;
const L = (d, k = 'k', sw = 2.5, ex = '') => P(d, 'n', k, sw, ex);
const G = (tr, body) => `<g transform="${tr}">${body}</g>`;
const poly = (pts) => 'M' + pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L') + 'Z';
const star = (cx, cy, ro, ri, n = 8, rot = 0) => poly(Array.from({ length: n * 2 }, (_, i) => {
  const r = i % 2 ? ri : ro; const t = (Math.PI * i) / n + (rot * Math.PI) / 180 - Math.PI / 2;
  return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
}));
// halftone: rows of dots (stroke-dasharray trick, so no <pattern>)
function dots(x0, y0, x1, y1, step, ink = 'k', r = 1, op = 1) {
  let d = '';
  for (let y = y0, i = 0; y <= y1; y += step, i++) d += `M${f1(x0 + (i % 2 ? step / 2 : 0))} ${f1(y)}H${f1(x1)}`;
  return `<path d="${d}" style="fill:none;stroke:${c(ink)};stroke-width:${r * 2};stroke-dasharray:0 ${step};stroke-linecap:round;opacity:${op}"/>`;
}
const svg = (bg, body) => `<svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="stroke-linejoin:round;stroke-linecap:round">${R(0, 0, 160, 100, bg)}${body}</svg>`;

// isometric cube: top-face centre (cx, cy), edge e; returns faces
function cube(cx, cy, e, top, left, right, sw = 2.2) {
  const h = 0.5 * e, w = 0.866 * e;
  const T = [[cx, cy - h], [cx + w, cy], [cx, cy + h], [cx - w, cy]];
  const Lf = [[cx - w, cy], [cx, cy + h], [cx, cy + h + e], [cx - w, cy + e]];
  const Rf = [[cx, cy + h], [cx + w, cy], [cx + w, cy + e], [cx, cy + h + e]];
  return P(poly(Lf), left, 'k', sw) + P(poly(Rf), right, 'k', sw) + P(poly(Rf), 'k', 'n', 0, 'opacity:.22') + P(poly(T), top, 'k', sw);
}
// a little running figure with outlined limbs
function runner(x, y, s, ink, flip = 1) {
  const p = (dx, dy) => `${f1(x + dx * s * flip)} ${f1(y + dy * s)}`;
  const limbs = `M${p(-3, 2)}L${p(-9, 9)}L${p(-6, 15)}M${p(-3, 2)}L${p(2, 9)}L${p(8, 10)}M${p(1, -10)}L${p(-6, -5)}L${p(-10, -9)}M${p(1, -10)}L${p(7, -5)}L${p(9, 0)}M${p(1, -10)}L${p(-3, 2)}`;
  return L(limbs, 'k', 7.4 * s) + L(limbs, ink, 3.6 * s) + C(x + 3 * s * flip, y - 16 * s, 4.6 * s, ink, 'k', 2);
}

// ── the covers ─────────────────────────────────────────────────────────
function four() {
  const bx = 33, by = 30, cw = 13.43, rh = 12;
  const grid = [
    '.......',
    '.......',
    '...a...',
    '..ab...',
    '.bbab..',
    'baabab.',
  ];
  let holes = '', discs = '';
  grid.forEach((row, j) => [...row].forEach((v, i) => {
    const x = bx + cw / 2 + i * cw, y = by + 7 + j * rh;
    holes += C(x, y, 4.6, 'sy');
    if (v !== '.') discs += C(x, y, 4.6, v, 'k', 1.6) + C(x, y, 2.2, 'n', 'k', 1.1, 'opacity:.55');
  }));
  const fx = bx + cw / 2 + 4 * cw;
  return svg('sy',
    dots(8, 8, 152, 26, 5, 'y', 1.3) +
    R(bx, by, 94, 80, 'k', 'n', 0, 7) + holes + discs +
    L(`M${f1(fx - 5)} 4v6M${f1(fx + 5)} 2v8`, 'k', 2.2) +
    C(fx + 1.6, 18.6, 6.4, 'y') + C(fx, 17, 6.4, 'b', 'k', 2.4) + C(fx, 17, 3, 'n', 'k', 1.2, 'opacity:.55') +
    R(22, 94, 116, 10, 'k', 'n', 0, 3));
}

function dots_() {
  const x0 = 25, y0 = 17, s = 22;
  const X = (i) => x0 + i * s, Y = (j) => y0 + j * s;
  const box = (i, j, ink) => R(X(i) + 4.5, Y(j) + 4.5, s - 6, s - 6, ink, 'n', 0, 2);
  const h = (i, j, ink) => L(`M${X(i)} ${Y(j)}H${X(i + 1)}`, ink, 3.4);
  const v = (i, j, ink) => L(`M${X(i)} ${Y(j)}V${Y(j + 1)}`, ink, 3.4);
  let d = '';
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) d += C(X(i), Y(j), 2.9, 'k');
  return svg('sa',
    box(0, 0, 'a') + box(1, 0, 'a') + box(3, 1, 'b') + box(4, 1, 'b') + box(3, 2, 'b') +
    h(0, 0, 'a') + h(1, 0, 'a') + h(0, 1, 'b') + h(1, 1, 'a') + v(0, 0, 'a') + v(1, 0, 'b') + v(2, 0, 'a') +
    h(3, 1, 'b') + h(4, 1, 'a') + h(3, 2, 'b') + h(4, 2, 'b') + h(3, 3, 'a') + v(3, 1, 'b') + v(4, 1, 'b') + v(5, 1, 'a') + v(3, 2, 'a') + v(4, 2, 'b') +
    h(2, 3, 'a') + v(1, 2, 'b') + h(0, 2, 'a') +
    L(`M${X(2)} ${Y(2)}H${X(2) + 13}`, 'y', 6) + L(`M${X(2)} ${Y(2)}H${X(2) + 13}`, 'k', 1.6, 'stroke-dasharray:3 3') +
    d);
}

function ultimate() {
  const ox = 41, oy = 11, cs = 26;
  const X = (gi, li) => ox + gi * cs + 4 + li * 6 + 3;
  const Y = (gj, lj) => oy + gj * cs + 4 + lj * 6 + 3;
  const x = (cx, cy, r, ink, sw) => L(`M${f1(cx - r)} ${f1(cy - r)}L${f1(cx + r)} ${f1(cy + r)}M${f1(cx + r)} ${f1(cy - r)}L${f1(cx - r)} ${f1(cy + r)}`, ink, sw);
  const o = (cx, cy, r, ink, sw) => C(cx, cy, r, 'n', ink, sw);
  let small = '';
  for (let gi = 0; gi < 3; gi++) for (let gj = 0; gj < 3; gj++) {
    if ((gi === 0 && gj === 0) || (gi === 2 && gj === 1)) continue;
    const bx = ox + gi * cs + 4, by = oy + gj * cs + 4;
    small += L(`M${bx + 6} ${by}v18M${bx + 12} ${by}v18M${bx} ${by + 6}h18M${bx} ${by + 12}h18`, 'k', 1, 'opacity:.7');
  }
  const marks = [[1, 1, 0, 0, 'x'], [1, 1, 1, 1, 'o'], [1, 1, 2, 0, 'o'], [1, 1, 2, 2, 'x'], [0, 1, 1, 1, 'x'], [0, 2, 0, 2, 'o'], [1, 0, 2, 1, 'x'], [2, 0, 1, 1, 'o'], [2, 2, 0, 0, 'x'], [1, 2, 1, 0, 'o'], [0, 1, 2, 0, 'o'], [2, 2, 2, 1, 'o']];
  const ms = marks.map(([gi, gj, li, lj, m]) => (m === 'x' ? x(X(gi, li), Y(gj, lj), 1.8, 'a', 1.7) : o(X(gi, li), Y(gj, lj), 2, 'b', 1.6))).join('');
  return svg('sb',
    dots(4, 6, 40, 96, 5, 'b', 1.1, 0.55) + dots(120, 6, 158, 96, 5, 'b', 1.1, 0.55) +
    R(ox, oy, cs * 3, cs * 3, 'w', 'k', 2.6, 4) +
    R(ox + cs + 2, oy + cs + 2, cs - 4, cs - 4, 'y', 'n', 0, 2) +
    small + ms +
    x(ox + 13, oy + 13, 8, 'a', 4.6) + C(ox + 2 * cs + 13, oy + cs + 13, 8.4, 'n', 'b', 4.4) +
    L(`M${ox + cs} ${oy + 3}V${oy + 3 * cs - 3}M${ox + 2 * cs} ${oy + 3}V${oy + 3 * cs - 3}M${ox + 3} ${oy + cs}H${ox + 3 * cs - 3}M${ox + 3} ${oy + 2 * cs}H${ox + 3 * cs - 3}`, 'k', 3));
}

function fleet() {
  let grid = '';
  for (let x = 6; x < 160; x += 14) grid += `M${x} 0V100`;
  for (let y = 8; y < 100; y += 14) grid += `M0 ${y}H160`;
  const peg = (x, y) => C(x, y, 3.4, 'w', 'k', 1.8);
  const ripple = (x, y) => L(`M${x - 8} ${y + 7}q4 -3 8 0t8 0`, 'k', 1.6, 'opacity:.5');
  const hull = 'M30 41Q30 38 33 38H102Q120 38 130 50Q120 62 102 62H33Q30 62 30 59Z';
  return svg('sa',
    L(grid, 'k', 0.8, 'opacity:.2') +
    P(hull, 'k', 'n', 0, 'transform:translate(3px,3px)') + P(hull, 'w', 'k', 2.6) +
    R(40, 45, 50, 10, 'sa', 'k', 1.8, 2) +
    C(54, 50, 6.2, 'k') + L('M54 50H69', 'k', 3.2) + C(84, 50, 5.4, 'k') + L('M84 50H97', 'k', 3) +
    dots(36, 42, 46, 58, 4, 'k', 0.8, 0.5) +
    P(star(108, 48, 15, 6.5, 9, 8), 'b', 'k', 2.2) + P(star(108, 48, 7, 3.4, 7), 'y', 'k', 1.4) +
    P('M14 82Q14 79 17 79H52Q60 79 64 85Q60 91 52 91H17Q14 91 14 88Z', 'w', 'k', 2.2) + C(40, 85, 3.4, 'b', 'k', 1.5) +
    peg(126, 20) + ripple(126, 20) + peg(140, 78) + ripple(140, 78) + peg(22, 22) + ripple(22, 22) + peg(96, 84));
}

function wordduel() {
  const tile = (x, y, f, flip = false) => (flip
    ? R(x, y + 6, 18, 6, f, 'k', 2, 2)
    : R(x + 1.6, y + 1.6, 18, 18, 'k', 'n', 0, 3) + R(x, y, 18, 18, f, 'k', 2, 3));
  const row = (y, fills, flipAt = -1) => fills.map((f, i) => tile(27 + i * 22, y, f, i === flipAt)).join('');
  const glyph = (x, y, k) => [
    P(`M${x + 9} ${y + 4.5}L${x + 13.5} ${y + 13}H${x + 4.5}Z`, 'k'),
    C(x + 9, y + 9, 3.8, 'n', 'k', 2.4),
    C(x + 9, y + 9, 2.6, 'k'),
    R(x + 4.5, y + 7.6, 9, 2.8, 'k', 'n', 0, 1.4),
  ][k % 4];
  const g1 = [0, 1, 2, 3, 1].map((k, i) => glyph(27 + i * 22, 10, k)).join('');
  const g2 = [2, 0, 1, 3, 0].map((k, i) => (i === 3 ? '' : glyph(27 + i * 22, 33, k))).join('');
  let keys = '';
  const kb = [[10, 21], [9, 26], [7, 36]];
  const hot = { '0,2': 'a', '0,6': 'y', '1,1': 'b', '1,4': 'a', '2,3': 'y', '0,8': 'l', '1,7': 'l', '2,0': 'l', '2,5': 'b' };
  kb.forEach(([n, x0], r) => { for (let i = 0; i < n; i++) keys += R(x0 + i * 11.8, 62 + r * 12, 9.6, 9.6, hot[`${r},${i}`] || 'w', 'k', 1.4, 2); });
  return svg('sy',
    row(10, ['w', 'y', 'w', 'a', 'w']) + g1 +
    row(33, ['b', 'b', 'y', 'w', 'b'], 3) + g2 +
    keys);
}

function agents() {
  const cw = 20, ch = 13, gx = 3.6, gy = 3.4, x0 = 80 - (5 * cw + 4 * gx) / 2, y0 = 50 - (5 * ch + 4 * gy) / 2;
  const map = ['w a w w l', 'y w w b w', 'w w a w y', 'l w w a w', 'w y w w a'].map((r) => r.split(' '));
  let cards = '';
  map.forEach((row, j) => row.forEach((v, i) => {
    const x = x0 + i * (cw + gx), y = y0 + j * (ch + gy);
    if (i === 2 && j === 2) return;
    cards += R(x, y, cw, ch, v, 'n', 0, 2);
    if (v === 'w' || v === 'l') cards += L(`M${f1(x + 5)} ${f1(y + ch / 2 + 1)}H${f1(x + cw - 5)}`, 'k', 2.2, 'opacity:.35');
  }));
  const lx = x0 + 2 * (cw + gx), ly = y0 + 2 * (ch + gy);
  return svg('k',
    dots(0, 3, 160, 100, 6, 'w', 0.9, 0.18) +
    G('rotate(-7 80 50)', cards +
      R(lx + 3, ly - 1, cw, ch, 'g', 'n', 0, 2, 'opacity:.35') + R(lx - 1, ly - 5, cw, ch, 'b', 'w', 2, 2) +
      C(lx + cw / 2 - 1, ly + ch / 2 - 5, 3.6, 'n', 'k', 1.8) + L(`M${f1(lx + cw / 2 + 1.6)} ${f1(ly + ch / 2 - 2.4)}l3 3`, 'k', 2)));
}

function doodle() {
  const cat = 'M36 56c-1-9 3-17 9-21l-2-12 9 7c4-1 9-1 13 0l8-7-1 12c6 5 9 12 8 20-1 12-12 19-23 19-12 0-21-7-21-18z';
  return svg('w',
    dots(110, 6, 158, 40, 5, 'b', 1.1, 0.6) +
    P(cat, 'n', 'y', 7) + G('translate(-2 -2)', P(cat, 'n', 'a', 3)) +
    C(48, 53, 2.6, 'a') + C(64, 53, 2.6, 'a') + L('M53 61q3 3 6 0', 'a', 2.6) +
    L('M40 60l-12-2M40 64l-12 3M71 60l13-2M71 64l13 3', 'a', 2.4) +
    L('M90 76c6-3 9 3 15 0s8-4 12-1', 'a', 3) +
    G('rotate(-38 118 72)',
      R(116, 66, 58, 13, 'y', 'k', 2.4) + L('M118 70.3h54M118 74.6h54', 'k', 1.2, 'opacity:.4') +
      R(160, 66, 7, 13, 'l', 'k', 2.2) + R(167, 66, 9, 13, 'b', 'k', 2.4, 3) +
      P('M116 66L103 72.5L116 79Z', 'w', 'k', 2.2) + P('M107.4 70.3L103 72.5L107.4 74.7Z', 'k')));
}

function wave() {
  const cx = 80, cy = 82, r = 58;
  const pt = (deg, rr = r) => [cx + rr * Math.cos((deg * Math.PI) / 180), cy - rr * Math.sin((deg * Math.PI) / 180)];
  const wedge = (a0, a1, ink) => { const [x0, y0] = pt(a0), [x1, y1] = pt(a1); return P(`M${cx} ${cy}L${f1(x0)} ${f1(y0)}A${r} ${r} 0 0 0 ${f1(x1)} ${f1(y1)}Z`, ink, 'k', 1.6); };
  const t = 118;
  const [nx, ny] = pt(106, 50);
  let ticks = '';
  for (let d = 10; d < 180; d += 10) { const [ax, ay] = pt(d, r - 2), [bx, by] = pt(d, r - 7); ticks += `M${f1(ax)} ${f1(ay)}L${f1(bx)} ${f1(by)}`; }
  return svg('sb',
    dots(6, 6, 154, 30, 6, 'b', 1.2, 0.5) +
    P(`M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}Z`, 'w', 'k', 2.6) +
    wedge(t - 18, t + 18, 'y') + wedge(t - 11, t + 11, 'b') + wedge(t - 4, t + 4, 'a') +
    L(ticks, 'k', 1.4, 'opacity:.6') +
    P(`M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}`, 'n', 'k', 2.6) +
    R(14, cy, 132, 12, 'k', 'n', 0, 3) +
    L(`M${cx} ${cy}L${f1(nx)} ${f1(ny)}`, 'k', 4.2) + C(cx, cy, 8, 'y', 'k', 2.6) +
    C(14, cy - 8, 5, 'a', 'k', 2) + C(146, cy - 8, 5, 'b', 'k', 2));
}

function hockey() {
  return svg('sa',
    R(21, 13, 124, 80, 'k', 'n', 0, 16) +
    R(18, 10, 124, 80, 'w', 'k', 2.6, 16) +
    dots(28, 18, 134, 84, 7, 'l', 1.1) +
    L('M80 12V88', 'k', 2.2, 'stroke-dasharray:5 4') + C(80, 50, 14, 'n', 'k', 2.2) +
    R(15, 36, 6, 28, 'k', 'n', 0, 2) + R(139, 36, 6, 28, 'k', 'n', 0, 2) +
    L('M62 40L88 33M64 47L88 40M70 54L90 47', 'y', 3.4) +
    C(102, 40, 7, 'k') + C(100.5, 38.5, 7, 'k', 'k', 0) + C(100.5, 38.5, 3, 'n', 'w', 1.4, 'opacity:.5') +
    C(44, 34, 12, 'a', 'k', 2.6) + C(44, 34, 5.6, 'a', 'k', 2.4) +
    C(122, 66, 12, 'b', 'k', 2.6) + C(122, 66, 5.6, 'b', 'k', 2.4));
}

function quickdraw() {
  const cowboy = (x, flip, ink) => {
    const p = (dx, dy) => `${f1(x + dx * flip)} ${f1(70 + dy)}`;
    return P(`M${p(-6, 0)}L${p(-4, -14)}L${p(-6, -26)}L${p(6, -26)}L${p(4, -14)}L${p(6, 0)}Z`, ink, 'k', 2) +
      L(`M${p(5, -24)}L${p(16, -21)}`, 'k', 3.4) +
      C(x, 70 - 31, 4.6, ink, 'k', 2) +
      L(`M${p(-10, -34)}L${p(10, -34)}`, 'k', 2.8) + R(x - 4.5, 70 - 41, 9, 7, 'k', 'n', 0, 2);
  };
  const cactus = (x, h) => L(`M${x} 70V${70 - h}M${x} ${70 - h * 0.45}h-6v-8M${x} ${70 - h * 0.6}h6v-9`, 'k', 4.4);
  let sun = '';
  for (let y = 54; y < 70; y += 5) sun += `M40 ${y}H120`;
  return svg('sy',
    C(80, 70, 32, 'b', 'k', 2.6) + L(sun, 'sy', 2.2) +
    R(0, 70, 160, 30, 'y') + L('M0 70H160', 'k', 2.6) +
    dots(4, 76, 156, 98, 5, 'k', 0.9, 0.35) +
    cactus(62, 22) + cactus(102, 14) +
    cowboy(28, 1, 'a') + cowboy(132, -1, 'w') +
    P(star(48, 47, 8, 3.6, 8, 10), 'w', 'k', 1.8) +
    L('M14 26l8 2M138 22l9-3M131 30l8 1', 'k', 2, 'opacity:.55'));
}

function tower() {
  const blk = (x, y, w, ink, tilt = 0) => {
    const d = [9, -6];
    const front = R(x, y, w, 11, ink, 'k', 2.2);
    const top = P(poly([[x, y], [x + d[0], y + d[1]], [x + w + d[0], y + d[1]], [x + w, y]]), 'w', 'k', 2.2);
    const side = P(poly([[x + w, y], [x + w + d[0], y + d[1]], [x + w + d[0], y + 11 + d[1]], [x + w, y + 11]]), ink, 'k', 2.2) +
      P(poly([[x + w, y], [x + w + d[0], y + d[1]], [x + w + d[0], y + 11 + d[1]], [x + w, y + 11]]), 'k', 'n', 0, 'opacity:.3');
    const g = front + side + top;
    return tilt ? G(`rotate(${tilt} ${x + w / 2} ${y + 5})`, g) : g;
  };
  return svg('sa',
    dots(10, 10, 60, 40, 5, 'a', 1.1, 0.55) +
    E(84, 95, 46, 4, 'k', 'n', 0, 'opacity:.18') + L('M0 95H160', 'k', 2.6) +
    blk(48, 84, 60, 'a') + blk(54, 73, 52, 'b') + blk(46, 62, 58, 'y') + blk(57, 51, 48, 'a') + blk(51, 40, 50, 'w') +
    blk(70, 14, 40, 'b', 16) +
    L('M64 12q-4 6 0 12M58 10q-5 8 0 16', 'k', 2, 'opacity:.6') + L('M118 30l6 4M120 22l7 1', 'k', 2));
}

function bones() {
  const pipT = (cx, cy, e, uv) => uv.map(([u, v]) => E(cx + (u - v) * 0.866 * e * 0.3, cy + (u + v) * 0.5 * e * 0.3, 2.4, 1.45, 'k')).join('');
  const pipL = (cx, cy, e, uv) => uv.map(([u, v]) => E(cx - 0.433 * e + u * 0.866 * e * 0.28, cy + 0.25 * e + 0.5 * e + u * 0.5 * e * 0.28 + v * e * 0.28, 1.6, 2.4, 'w', 'n', 0, '', -30)).join('');
  const pipR = (cx, cy, e, uv) => uv.map(([u, v]) => E(cx + 0.433 * e + u * 0.866 * e * 0.28, cy + 0.25 * e + 0.5 * e - u * 0.5 * e * 0.28 + v * e * 0.28, 1.6, 2.4, 'w', 'n', 0, '', 30)).join('');
  const five = [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], three = [[-1, -1], [0, 0], [1, 1]], two = [[-1, -1], [1, 1]], four = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  return svg('sb',
    dots(4, 4, 156, 40, 6, 'b', 1.1, 0.5) +
    E(64, 86, 30, 7, 'k', 'n', 0, 'opacity:.2') + E(112, 84, 22, 5, 'k', 'n', 0, 'opacity:.2') +
    cube(62, 44, 28, 'w', 'a', 'a', 2.4) + pipT(62, 44, 28, five) + pipL(62, 44, 28, two) + pipR(62, 44, 28, three) +
    cube(110, 52, 21, 'w', 'b', 'b', 2.2) + pipT(110, 52, 21, three) + pipL(110, 52, 21, [[0, 0]]) + pipR(110, 52, 21, two) +
    G('rotate(22 120 20)', cube(120, 14, 12, 'w', 'y', 'y', 1.8)) +
    L('M104 10q-6 -2 -10 3M140 26q5 2 6 7', 'k', 2, 'opacity:.6'));
}

function cycles() {
  let grid = '';
  for (let x = 10; x < 160; x += 14) grid += `M${x} 0V100`;
  for (let y = 8; y < 100; y += 14) grid += `M0 ${y}H160`;
  const trail = (d, ink) => L(d, ink, 7.5, 'opacity:.45') + L(d, ink, 3.6) + L(d, 'w', 1.1, 'opacity:.9');
  const bike = (x, y, rot, ink) => G(`rotate(${rot} ${x} ${y})`, R(x - 9, y - 4.5, 18, 9, ink, 'w', 1.8, 4.5) + R(x + 1, y - 2.5, 5, 5, 'k', 'n', 0, 1.5));
  return svg('k',
    L(grid, 'w', 0.7, 'opacity:.16') +
    trail('M-4 74H44V34H86V50', 'a') + trail('M164 22H124V78H96V58', 'b') +
    bike(86, 58, 90, 'a') + bike(96, 66, -90, 'b') +
    P(star(91, 46, 13, 5, 10, 4), 'y', 'w', 1.8) + P(star(91, 46, 5.5, 2.6, 6, 30), 'w'));
}

function defuse() {
  return svg('sb',
    dots(100, 4, 156, 96, 6, 'b', 1.1, 0.5) +
    R(49, 21, 88, 66, 'k', 'n', 0, 8) + R(46, 18, 88, 66, 'w', 'k', 2.6, 8) +
    L('M90 22V80M50 51H130', 'k', 1.6, 'opacity:.35') +
    C(64, 34, 9, 'y', 'k', 2.2) + P('M64 34V25A9 9 0 0 1 72.4 37.3Z', 'b', 'k', 2) +
    C(80, 28, 2.6, 'b', 'k', 1.4) + C(80, 37, 2.6, 'w', 'k', 1.4) +
    R(98, 25, 12, 10, 'w', 'k', 1.8, 2) + R(113, 25, 12, 10, 'y', 'k', 1.8, 2) + R(98, 38, 12, 10, 'a', 'k', 1.8, 2) + R(113, 38, 12, 10, 'w', 'k', 1.8, 2) +
    C(104, 30, 1.7, 'k') + P('M116.6 32.5l2.4-4.4 2.4 4.4z', 'k') + L('M101.5 43h5M104 40.5v5', 'k', 1.6) + R(116.5, 40.6, 5, 5, 'n', 'k', 1.4, 1) +
    R(54, 57, 4, 22, 'k') + R(80, 57, 4, 22, 'k') +
    L('M58 61C66 58 72 70 80 62', 'a', 3.2) + L('M58 69C66 76 72 64 80 70', 'y', 3.2) + L('M58 76C64 72 70 80 76 78', 'b', 3.2) + L('M80 76l-3 1', 'b', 3.2) +
    C(111, 68, 12, 'k') + C(110, 67, 12, 'b', 'k', 2.4) + E(106, 63, 4, 2.4, 'w', 'n', 0, 'opacity:.6', -30) +
    G('rotate(-12 28 78)', R(10, 60, 38, 40, 'w', 'k', 2.2, 2) + L('M15 68h26M15 74h20M15 80h26M15 86h14', 'k', 1.6, 'opacity:.5') + P('M40 60h8v8z', 'l', 'k', 1.6) + R(15, 90, 10, 6, 'b', 'k', 1.4, 1)));
}

function rush() {
  const vx = 80, vy = 40;
  const lerp = (a, b, t) => a + (b - a) * t;
  const rail = (xb) => `M${f1(lerp(vx, xb, 0.06))} ${f1(lerp(vy, 100, 0.06))}L${xb} 100`;
  let ties = '';
  [0.12, 0.2, 0.3, 0.43, 0.6, 0.82].forEach((t) => {
    const y = lerp(vy, 100, t);
    ties += `M${f1(lerp(vx, -30, t))} ${f1(y)}H${f1(lerp(vx, 190, t))}`;
  });
  const city = [[2, 16, 18, 'w'], [18, 8, 14, 'sb'], [30, 20, 16, 'w'], [44, 12, 12, 'b'], [104, 14, 14, 'w'], [116, 6, 16, 'sb'], [130, 18, 14, 'w'], [142, 10, 20, 'y']];
  let bld = '';
  city.forEach(([x, top, w, ink]) => {
    bld += R(x, top, w, vy - top + 2, ink, 'k', 2);
    for (let wy = top + 5; wy < vy - 4; wy += 6) bld += L(`M${x + 4} ${wy}H${x + w - 4}`, 'k', 2, 'stroke-dasharray:2 3;opacity:.5');
  });
  return svg('sa',
    C(128, 18, 9, 'y', 'k', 2) +
    bld +
    P(`M0 ${vy}H160V100H0Z`, 'sy', 'k', 2.2) +
    P(`M${vx - 4} ${vy}L-30 100H190L${vx + 4} ${vy}Z`, 'w', 'k', 2) +
    L(ties, 'k', 2, 'opacity:.45') +
    L(rail(-6) + rail(28) + rail(58) + rail(102) + rail(132) + rail(166), 'k', 2.4) +
    R(74, 28, 12, 13, 'a', 'k', 1.8, 3) + R(76.5, 31, 7, 4, 'w', 'k', 1.2, 1) + C(80, 38.2, 1.4, 'y') +
    L('M118 46Q96 18 70 50', 'k', 1.6, 'stroke-dasharray:3 3;opacity:.7') +
    C(82, 34.5, 4.4, 'k') + L('M84.5 31l3 -3', 'k', 1.6) + P(star(88.5, 27, 3.6, 1.4, 6), 'y') +
    P('M62 64c3-4 8-1 10-4 4 1 3 5 7 6-1 3-5 2-6 5-4 1-6-2-9-1-3-2 0-4-2-6z', 'b', 'k', 1.8) +
    runner(40, 78, 1.25, 'a', 1) + runner(118, 64, 1.05, 'b', -1));
}

function chameleon() {
  const cx = 80, top = 6, ch = 54; // back corner of the room
  const lw = [[cx, top], [-10, top + 45], [-10, top + 45 + ch + 20], [cx, top + ch + 20]];
  const rw = [[cx, top], [170, top + 45], [170, top + 45 + ch + 20], [cx, top + ch + 20]];
  const fl = [[cx, top + ch], [170, top + ch + 45], [cx, top + ch + 90], [-10, top + ch + 45]];
  const wallX = (n) => 4 + n * 9;
  let stripes = '';
  for (let n = 0; wallX(n) < cx; n++) { const x = wallX(n), y0 = top + (cx - x) * 0.5; stripes += `M${f1(x)} ${f1(y0 + 2)}V${f1(y0 + ch - 2)}`; }
  // the hider, half painted to match the wallpaper behind it (drawn in local coords, then placed)
  const T = [6, 25], S = 1.22;
  const body = 'M20 30C18 18 30 10 44 11C52 12 58 15 62 19L70 12L79 22C80 26 77 29 72 29C66 31 60 32 56 33C48 36 34 37 26 35C22 34 20 33 20 30Z';
  const ex = 41, ey = 24.5, erx = 21, ery = 10.6; // painted patch (left half of this ellipse)
  let paint = '';
  for (let n = 0; n < 20; n++) {
    const lx = (wallX(n) - T[0]) / S;
    if (lx <= ex - erx + 0.5 || lx >= ex) continue;
    const h = ery * Math.sqrt(1 - ((lx - ex) / erx) ** 2);
    paint += `M${f1(lx)} ${f1(ey - h + 0.8)}V${f1(ey + h - 0.8)}`;
  }
  const tail = 'M21 31C12 33 8 42 14 46C19 49 25 45 23 41C21 38 17 40 18 42';
  const hider = G(`translate(${T[0]} ${T[1]}) scale(${S})`,
    L(tail, 'k', 4.8) + L(tail, 'w', 2) +
    L('M31 35l-3 8h-4M31 43h5M54 32l3 9h-4M57 41h4', 'k', 2.4) +
    P(body, 'w') +
    P(`M${ex} ${ey - ery}A${erx} ${ery} 0 0 0 ${ex} ${ey + ery}Z`, 'sb') + L(paint, 'b', 3.2 / S) +
    L(`M${ex} ${f1(ey - ery + 0.5)}c-3 4 2 6 -1 9s3 5 0 ${f1(2 * ery - 10)}`, 'b', 2.2) +
    P(body, 'n', 'k', 2.2) +
    C(65, 21, 4.4, 'w', 'k', 1.9) + C(66, 21, 1.8, 'k') + L('M72 27.4L77 25', 'k', 1.4));
  const splat = (x, y, ink) => P(star(x, y, 8, 4.4, 7, 14), ink, 'k', 1.6) + C(x + 10, y + 7, 1.8, ink, 'k', 1.1) + C(x - 9, y - 6, 1.4, ink, 'k', 1);
  return svg('sy',
    P(poly(lw), 'sb', 'k', 2.4) + L(stripes, 'b', 3.2) +
    P(poly(rw), 'sy', 'k', 2.4) + dots(cx + 6, top + 10, 166, top + 70, 6, 'y', 1.3) +
    P(poly(fl), 'w', 'k', 2.4) + E(cx + 8, top + ch + 30, 30, 12, 'a', 'k', 2.2) + E(cx + 8, top + ch + 30, 18, 7, 'n', 'w', 1.6, 'opacity:.7') +
    P(poly([[108, top + 26], [130, top + 37], [130, top + 55], [108, top + 44]]), 'w', 'k', 2.2) + P(poly([[112, top + 33], [126, top + 40], [126, top + 50], [112, top + 43]]), 'a') +
    R(136, top + 64, 14, 14, 'b', 'k', 2.2, 2) + L(`M143 ${top + 64}c-6-10-14-10-16-6M143 ${top + 64}c2-12 10-14 14-12M143 ${top + 64}c-1-14 3-18 4-18`, 'k', 3) +
    splat(140, 36, 'a') + C(150, 48, 2.2, 'a', 'k', 1.2) + C(134, 28, 1.8, 'a', 'k', 1.2) + C(100, 88, 2.6, 'a', 'k', 1.2) +
    hider);
}

function getaway() {
  // side-on muscle-car profile, (x, y) = the ground under the car's middle, facing right
  const shell = 'M-27 -5L-27.5 -13Q-27 -16.5 -21 -16.5L-11 -17.5L-5 -26L11 -26L18.5 -17.5L26 -15.5Q29 -14.5 29 -10L29 -5Z';
  const wheel = (x) => C(x, -5.5, 6, 'k') + C(x, -5.5, 2.6, 'w', 'k', 1.2);
  const car = (x, y, s, body, extra) => G(`translate(${x} ${y}) scale(${s})`,
    E(1, 0.4, 31, 2.6, 'k', 'n', 0, 'opacity:.3') +
    P(shell, body, 'k', 2.4) + extra +
    P('M-8.5 -18L-3.5 -24L3 -24L3 -18Z', 'sb', 'k', 1.8) + P('M6 -18L6 -24L10 -24L15 -18Z', 'sb', 'k', 1.8) +
    R(25.5, -14, 3.4, 3, 'y', 'k', 1.2, 1) + R(-27.6, -14, 2.6, 3, 'b', 'k', 1.2, 1) + wheel(-16.5) + wheel(16.5));
  // the runner: player ink with a racing stripe
  const run = car(113, 77, 1, 'a', L('M-26 -11H28', 'y', 3.4) + L('M-26 -11H28', 'k', 0.8, 'opacity:.45'));
  // the cop: black-and-white cruiser with a red/blue lightbar
  const cop = car(42, 90, 1.1, 'w',
    P('M-27 -5L-27.3 -11.5L28.6 -11.5L29 -5Z', 'k') + P('M-11 -17.5L-5 -26L11 -26L18.5 -17.5Z', 'k') +
    R(-2.5, -30.5, 6.5, 4.4, 'b', 'k', 1.5, 1) + R(4, -30.5, 6.5, 4.4, 'a', 'k', 1.5, 1) + P(star(2.5, -14.5, 3.4, 1.6, 5), 'y', 'k', 1));
  let skyline = '';
  [[-2, 22, 18, 'w'], [14, 30, 14, 'sb'], [26, 12, 16, 'w'], [58, 26, 16, 'w'], [72, 34, 12, 'sb'], [92, 16, 16, 'w'], [122, 28, 14, 'sb'], [134, 10, 20, 'w'], [152, 24, 12, 'sb']].forEach(([x, top, w, ink]) => {
    skyline += R(x, top, w, 52 - top, ink, 'k', 2);
    for (let wy = top + 5; wy < 49; wy += 6) skyline += L(`M${x + 4} ${wy}H${x + w - 4}`, 'k', 2, 'stroke-dasharray:2 3;opacity:.45');
  });
  return svg('sa',
    C(112, 16, 9, 'y', 'k', 2) + skyline +
    R(-4, 50, 168, 6, 'w', 'k', 2) + R(-4, 56, 168, 48, 'l', 'k', 2) +
    dots(-2, 60, 162, 100, 5, 'k', 0.7, 0.18) +
    L('M-6 83H14M30 83H50M66 83H86M102 83H122M138 83H158', 'w', 3) +
    L('M58 62H76M50 67H72M60 72H80', 'k', 2, 'opacity:.4') + L('M-4 74H6M-2 86H4', 'k', 2, 'opacity:.4') +
    dots(30, 46, 58, 60, 4.6, 'b', 1.1, 0.7) + dots(38, 52, 66, 62, 4.6, 'a', 1.1, 0.6) +
    L('M38 48l-3 -6M48 47l2 -7M56 50l6 -4M30 52l-6 -3', 'k', 4.4) + L('M38 48l-3 -6M30 52l-6 -3', 'b', 2.4) + L('M48 47l2 -7M56 50l6 -4', 'a', 2.4) +
    run + cop +
    L('M146 62l7 -1M146 68l9 0', 'k', 2, 'opacity:.6'));
}

export const COVERS = {
  four: four(), dots: dots_(), ultimate: ultimate(), fleet: fleet(), wordduel: wordduel(), agents: agents(),
  doodle: doodle(), wave: wave(), hockey: hockey(), quickdraw: quickdraw(), tower: tower(), bones: bones(),
  cycles: cycles(), defuse: defuse(), rush: rush(), chameleon: chameleon(), getaway: getaway(),
};
