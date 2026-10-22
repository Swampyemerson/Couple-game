// Knucklebones: a quick dice duel. Each turn a d6 is rolled for you and you place it in one of
// your three columns. Matching dice multiply (value × count²), and placing a die knocks every die
// of the same value out of your opponent's facing column. Ends the moment a grid fills.
//
// Rules are pure: move = { col }. The roll for turn n is randInt(6, seed, 'roll', n) + 1, so both
// phones always see the same die. The 3D tumble is view-only.
import { registerGame, randInt, gameDataApi } from './core.js';

// ── rules ─────────────────────────────────────────────────────────────
const ROWS = 3;
const COLS = 3;
const other = (w) => (w === 'a' ? 'b' : 'a');
const rollFor = (seed, n) => randInt(6, seed, 'roll', n) + 1;

// Twists. A match starts classic. The player who goes first may, before their first die, send one
// setup move { tw: '<id>' } (it doesn't pass the turn); playing a die instead keeps the match
// classic for good. Old logs never contain a setup move, so they replay exactly as they always did.
//   golden: one seeded column is gilded for both players and scores double
//   mirror: you both draw from the same dice, dealt in a different order. A round is five dice each: the
//           starter takes them in order and the other player starts two places along (3 4 5 1 2), so nobody
//           is handed the twin of the die just played against them. It is not an exact copy: a match ends
//           part-way through a round in about three matches of four, so the last die or two can differ.
//           (The same die in two turns running gave the second player 85% of the games; X Y / Y X, which
//           still had a twin right after Y, was 44% starter wins with random bots and 51% with greedy.
//           The five-dice round: 51% and 52%. See docs/games/bones.md.)
//   blind:  you pick a column before you see the roll (rules as classic; the view hides the die)
//   oracle: both players see the next two rolls (rules as classic; the view shows them)
// Every twist also plays the Last Word rule: if the starter fills their grid first, the other
// player gets one last die, so both have placed the same number of dice. That last die lands
// softly (it doesn't smash) except in Mirror Dice. Bot self-play: with a normal last die the
// second player became the favourite (43-45% for the starter); the soft landing evens that out
// (see docs/games/bones.md and `threed-bones.test.js --balance`).
const TWISTS = {
  classic: { name: 'Classic', hint: 'The original rules.' },
  golden: { name: 'Golden Column', hint: 'One column scores double.' },
  mirror: { name: 'Mirror Dice', hint: 'Same dice, different order.' },
  blind: { name: 'Blind Draw', hint: 'Pick before you see the roll.' },
  oracle: { name: 'Oracle', hint: 'See the next two rolls.' },
};
const TWIST_IDS = ['golden', 'mirror', 'blind', 'oracle'];
const twisted = (s) => !!s.tw && s.tw !== 'classic';
/** The die for turn n under this match's rules. */
function rollAt(s, n) {
  if (s.tw === 'mirror') { // the starter (even turns) takes a round's five dice in order; the other player starts two along
    const i = (n >> 1) % 5;
    return rollFor(s.seed, Math.floor(n / 10) * 5 + (n % 2 ? (i + 2) % 5 : i));
  }
  return rollFor(s.seed, n);
}

/** Column score: each value counts value × count × count (4,4 = 16; 4,4,4 = 36; 3,4 = 7). */
function colScore(col) {
  const c = {};
  for (const v of col) c[v] = (c[v] || 0) + 1;
  let t = 0;
  for (const v of Object.keys(c)) t += Number(v) * c[v] * c[v];
  return t;
}
/** What a column is worth, counting the gilded column of a Golden Column match (×2). */
const colPts = (col, i, gold) => colScore(col) * (i === gold ? 2 : 1);
const gridScore = (g, gold) => g.reduce((t, col, i) => t + colPts(col, i, gold), 0);
const gridFull = (g) => g.every((col) => col.length >= ROWS);

function init({ first, seed }) {
  const turn = first === 'b' ? 'b' : 'a';
  return {
    seed, turn, n: 0, roll: rollFor(seed, 0),
    grids: { a: [[], [], []], b: [[], [], []] }, last: null, over: false,
    // additive facts for commentary and records (never read by the rules)
    first: turn, big: { pts: 0, who: null, n: -1 }, deficit: { a: 0, b: 0 }, wipes: { a: 0, b: 0 }, trips: { a: 0, b: 0 }, cb: { a: 0, b: 0 },
  };
}
function next(s) { return s.over ? [] : [s.turn]; }
function setup(s, who, mv) {
  if (s.n !== 0 || s.tw !== undefined) throw new Error('Twists are picked before the first die.');
  if (typeof mv.tw !== 'string' || (mv.tw !== 'classic' && !TWIST_IDS.includes(mv.tw))) throw new Error('That twist isn’t in this version of the game.');
  s.tw = mv.tw;
  if (mv.tw === 'golden') s.gold = randInt(3, s.seed, 'gold');
  // the starter has already watched the first die tumble: a blind match throws a fresh one that nobody has seen
  if (mv.tw === 'blind') s.roll = randInt(6, s.seed, 'blind', 0) + 1;
  return s;
}
function apply(s, who, mv) {
  if (s.over) throw new Error('The game is over.');
  if (who !== s.turn) throw new Error('Hold on, it’s not your turn.');
  if (mv && typeof mv === 'object' && 'tw' in mv && !('col' in mv)) return setup(s, who, mv);
  const col = mv ? mv.col : undefined;
  if (!Number.isInteger(col) || col < 0 || col >= COLS) throw new Error('Pick one of your three columns.');
  const mine = s.grids[who][col];
  if (mine.length >= ROWS) throw new Error('That column is full. Pick another one.');
  const opp = other(who);
  const gold = s.gold;
  const lead0 = gridScore(s.grids[who], gold) - gridScore(s.grids[opp], gold);
  const mineWas = colPts(mine, col, gold);
  const value = s.roll;
  mine.push(value);
  const before = s.grids[opp][col];
  const soft = s.final && s.tw !== 'mirror'; // the last word lands softly: no smash
  const after = soft ? before : before.filter((v) => v !== value);
  s.grids[opp][col] = after;
  const pts = colPts(before, col, gold) - colPts(after, col, gold);
  const gain = colPts(mine, col, gold) - mineWas;
  const same = mine.filter((v) => v === value).length;
  const destroyed = before.length - after.length;
  s.last = { who, col, value, n: s.n, oppBefore: before.slice(), destroyed, pts, gain, triple: same === 3, wipe: destroyed === ROWS };
  // facts for commentary and records
  if (pts > s.big.pts) s.big = { pts, who, n: s.n };
  if (destroyed === ROWS) s.wipes[who] += 1;
  if (same === 3) s.trips[who] += 1;
  const diff = gridScore(s.grids.a, gold) - gridScore(s.grids.b, gold);
  s.deficit.a = Math.max(s.deficit.a, -diff);
  s.deficit.b = Math.max(s.deficit.b, diff);
  const lead1 = who === 'a' ? diff : -diff;
  if (lead0 < 0 && lead1 > 0 && s.deficit[who] >= 15 && !s.cb[who]) { s.cb[who] = 1; s.last.comeback = true; }
  s.n += 1;
  let over;
  if (!twisted(s) || s.lw === false) over = gridFull(s.grids.a) || gridFull(s.grids.b); // (s.lw === false: balance tests only)
  else if (s.final) over = true; // the last word has been said
  else if (gridFull(s.grids[who]) && who === s.first) { // the starter filled up first: the other player answers
    s.final = true;
    over = false;
  } else over = gridFull(s.grids[who]);
  if (over) { s.over = true; s.roll = null; } else { s.turn = opp; s.roll = rollAt(s, s.n); }
  return s;
}
function result(s) {
  const a = gridScore(s.grids.a, s.gold);
  const b = gridScore(s.grids.b, s.gold);
  if (a === b) return { winner: null, text: 'Dead even', sub: `${a} apiece. Rematch?` };
  const w = a > b ? 'a' : 'b';
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const m = hi - lo;
  const score = `${hi} to ${lo}.`;
  const down = s.deficit ? s.deficit[w] : 0;
  const bigPts = s.big ? s.big.pts : 0;
  let line = score;
  if (m <= 3) line = `${m === 1 ? 'Won by 1! ' : ''}${score} So close — rematch?`;
  else if (down >= 15) line = `${score} Comeback from ${down} down.`;
  else if (bigPts >= 20) line = `${score} Wiped ${bigPts} in one go.`;
  else if (s.trips && s.trips[w] > 0) line = `${score} A triple stack paid off.`;
  return { winner: w, sub: line };
}
function score(s) { return { a: gridScore(s.grids.a, s.gold), b: gridScore(s.grids.b, s.gold) }; }

// ── view helpers ──────────────────────────────────────────────────────
const PIPS = {
  1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]], 6: [[0, 0], [1, 0], [2, 0], [0, 2], [1, 2], [2, 2]],
};
const pipHTML = (v) => (PIPS[v] || []).map(([r, c]) => `<i style="grid-area:${r + 1}/${c + 1}"></i>`).join('');
const dieHTML = (v, cls = '', extra = '') => `<span class="gb-die ${cls}" data-v="${v}"${extra}>${v === '?' ? '<em class="gb-qm">?</em>' : pipHTML(v)}</span>`;
const noop = () => {};
const SLOW_3D_MS = 8000; // how long to wait for three.js before switching to flat dice
const DEAD = { dead: true };

let probe = null;
function rgbOf(css, fb) {
  const s = String(css || '').trim() || fb;
  try {
    if (!probe) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      probe = c.getContext('2d', { willReadFrequently: true });
    }
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = fb;
    probe.fillStyle = s;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  } catch { return [0.5, 0.5, 0.5]; }
}
const cssOf = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
function readPalette(api) {
  const t = api.tokens();
  return {
    a: rgbOf(t.a, '#2f5bea'), b: rgbOf(t.b, '#f0428b'), card: rgbOf(t.card, '#ffffff'),
    ink: rgbOf(t.ink, '#1d1b22'), hl: rgbOf(t.hl, '#ffd23f'), bg: rgbOf(t.bg, '#f4efe3'), edge: rgbOf(t.edge, '#1d1b22'), dark: !!t.dark,
  };
}
const easeOut = (k) => 1 - (1 - k) ** 3;

// ── the 3D dice tray ──────────────────────────────────────────────────
// Faces of the (rounded) die, in the order +x, -x, +y, -y, +z, -z. Opposite faces sum to 7.
const FACE_VALUES = [2, 5, 1, 6, 3, 4];
// Euler rotation that turns each value's face to the top (+y).
const FACE_UP = { 1: [0, 0, 0], 6: [Math.PI, 0, 0], 2: [0, 0, Math.PI / 2], 5: [0, 0, -Math.PI / 2], 3: [-Math.PI / 2, 0, 0], 4: [Math.PI / 2, 0, 0] };
// Each face as a frame seen from outside: n out of the face, u right, v up (u × v = n). Pips are drawn in (u, v).
const FACE_FRAME = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
const CAM_FOV = 28;
const CAM_DIST = 4.5;
const CAM_EL = 55 * Math.PI / 180;
const CAM_TARGET_Y = 0.45;
const HALF_PI = Math.PI / 2;

// ── dice physics ──────────────────────────────────────────────────────
// A rounded cube (eight corner spheres of radius R_DIE on a cube of side 1) falls on the floor y = 0. Impulse solver with
// speculative contacts, restitution that fades with speed, Coulomb friction, a little damping and a sleep threshold,
// stepped at a fixed h = 1/120 s. The whole throw is solved once when the roll starts (the rolled value is known up
// front), stored per step, then played back with interpolation. Nothing here is random: every number comes from the
// seeded `rnd(k)` both phones share. The rolled value is made exact afterwards by composing a cube-symmetry rotation (see throwTo).
const PH_H = 1 / 120;
const PH_G = 45;
const R_DIE = 0.1;
const PH_HALF = 0.5 - R_DIE;
const PH_MAX = 168; // 1.4 s
const PH_E = 0.4; // restitution at full speed (fades below 4 units/s)
const PH_MU = 0.9;
const PH_IINV = 6; // 1 / inertia of a unit cube of unit mass
const SS = new Float64Array(13); // px py pz | qx qy qz qw | vx vy vz | wx wy wz
const CORN = new Float64Array(24);
for (let i = 0; i < 8; i++) { CORN[i * 3] = i & 1 ? PH_HALF : -PH_HALF; CORN[i * 3 + 1] = i & 2 ? PH_HALF : -PH_HALF; CORN[i * 3 + 2] = i & 4 ? PH_HALF : -PH_HALF; }
const CA = new Float64Array(24); const CN = new Float64Array(8); const CJ = new Float64Array(8);
const CTX = new Float64Array(8); const CTZ = new Float64Array(8); const CVT = new Float64Array(8);
const EV_MAX = 24;
const evStep = new Int16Array(EV_MAX); const evSpd = new Float32Array(EV_MAX);
let evN = 0;

function simStep(i, record) {
  const s = SS; const h = PH_H;
  s[8] -= PH_G * h;
  const x = s[3]; const y = s[4]; const z = s[5]; const w = s[6];
  const r00 = 1 - 2 * (y * y + z * z); const r01 = 2 * (x * y - z * w); const r02 = 2 * (x * z + y * w);
  const r10 = 2 * (x * y + z * w); const r11 = 1 - 2 * (x * x + z * z); const r12 = 2 * (y * z - x * w);
  const r20 = 2 * (x * z - y * w); const r21 = 2 * (y * z + x * w); const r22 = 1 - 2 * (x * x + y * y);
  let nc = 0;
  let impact = 0;
  for (let c = 0; c < 8; c++) {
    const cx = CORN[c * 3]; const cy = CORN[c * 3 + 1]; const cz = CORN[c * 3 + 2];
    const ay = r10 * cx + r11 * cy + r12 * cz;
    const gap = s[1] + ay - R_DIE;
    const ax = r00 * cx + r01 * cy + r02 * cz; const az = r20 * cx + r21 * cy + r22 * cz;
    const vn = s[8] + s[12] * ax - s[10] * az;
    if (gap > 0.002 && gap + vn * h > 0.002) continue; // can't reach the floor this step
    const o = nc * 3;
    CA[o] = ax; CA[o + 1] = ay - R_DIE; CA[o + 2] = az;
    CN[nc] = 1 + PH_IINV * (ax * ax + az * az);
    CJ[nc] = 0; CTX[nc] = 0; CTZ[nc] = 0;
    let target = gap > 0 ? -gap / h : 0;
    if (vn < -0.9 && gap + vn * h <= 0.002) {
      const e = PH_E * Math.min(1, -vn / 4);
      target = Math.max(target, -e * vn);
      if (-vn > impact) impact = -vn;
    }
    CVT[nc] = target;
    nc++;
  }
  for (let it = 0; it < 6; it++) {
    for (let c = 0; c < nc; c++) {
      const o = c * 3; const ax = CA[o]; const ay = CA[o + 1]; const az = CA[o + 2];
      const vn = s[8] + s[12] * ax - s[10] * az;
      let d = (CVT[c] - vn) / CN[c];
      const nj = Math.max(0, CJ[c] + d);
      d = nj - CJ[c]; CJ[c] = nj;
      s[8] += d; s[10] -= PH_IINV * az * d; s[12] += PH_IINV * ax * d;
      // friction: two axes, held inside the friction cone
      const lim = PH_MU * CJ[c];
      const vx = s[7] + s[11] * az - s[12] * ay;
      const vz = s[9] + s[10] * ay - s[11] * ax;
      let jx = CTX[c] - vx / (1 + PH_IINV * (ay * ay + az * az));
      let jz = CTZ[c] - vz / (1 + PH_IINV * (ax * ax + ay * ay));
      const m = Math.hypot(jx, jz);
      if (m > lim) { const k = lim / (m || 1); jx *= k; jz *= k; }
      const dx = jx - CTX[c]; const dz = jz - CTZ[c];
      CTX[c] = jx; CTZ[c] = jz;
      s[7] += dx; s[9] += dz;
      s[10] += PH_IINV * ay * dz; s[11] += PH_IINV * (az * dx - ax * dz); s[12] -= PH_IINV * ay * dx;
    }
  }
  // damping: the felt eats a little spin and slide, the air next to nothing
  if (nc) { const k = 1 - 1.5 * h; s[10] *= k; s[11] *= k; s[12] *= k; const f = 1 - 1.5 * h; s[7] *= f; s[9] *= f; } else { const k = 1 - 0.1 * h; s[10] *= k; s[11] *= k; s[12] *= k; }
  s[0] += s[7] * h; s[1] += s[8] * h; s[2] += s[9] * h;
  const wx = s[10]; const wy = s[11]; const wz = s[12];
  const hq = 0.5 * h;
  const nx = x + hq * (wx * w + wy * z - wz * y);
  const ny = y + hq * (wy * w + wz * x - wx * z);
  const nz = z + hq * (wz * w + wx * y - wy * x);
  const nw = w + hq * (-wx * x - wy * y - wz * z);
  const il = 1 / Math.hypot(nx, ny, nz, nw);
  s[3] = nx * il; s[4] = ny * il; s[5] = nz * il; s[6] = nw * il;
  // push out of the floor, then count what is touching it
  const q0 = s[3]; const q1 = s[4]; const q2 = s[5]; const q3 = s[6];
  const a10 = 2 * (q0 * q1 + q2 * q3); const a11 = 1 - 2 * (q0 * q0 + q2 * q2); const a12 = 2 * (q1 * q2 - q0 * q3);
  let low = 1e9; let touch = 0;
  for (let c = 0; c < 8; c++) {
    const g = s[1] + a10 * CORN[c * 3] + a11 * CORN[c * 3 + 1] + a12 * CORN[c * 3 + 2] - R_DIE;
    if (g < low) low = g;
  }
  if (low < 0) { s[1] -= low; low = 0; }
  for (let c = 0; c < 8; c++) {
    const g = s[1] + a10 * CORN[c * 3] + a11 * CORN[c * 3 + 1] + a12 * CORN[c * 3 + 2] - R_DIE;
    if (g < 0.006) touch++;
  }
  if (record && impact > 1.2 && (evN === 0 || i - evStep[evN - 1] >= 4) && evN < EV_MAX) { evStep[evN] = i; evSpd[evN] = impact; evN++; }
  return touch;
}

/** One launch (candidate k of the seeded stream) into P (x y z per step) and Q (x y z w per step). Returns { n, slept }. */
function simRun(rnd, k, P, Q, record) {
  const s = SS; const b = k * 16;
  const u1 = rnd(b); const u2 = rnd(b + 1) * 6.283185307; const u3 = rnd(b + 2) * 6.283185307;
  const a = Math.sqrt(1 - u1); const c = Math.sqrt(u1);
  s[3] = a * Math.sin(u2); s[4] = a * Math.cos(u2); s[5] = c * Math.sin(u3); s[6] = c * Math.cos(u3);
  s[0] = 0; s[1] = 1.1 + 0.7 * rnd(b + 3); s[2] = 0;
  s[7] = 5.6 + 2 * rnd(b + 4); s[8] = -0.5 + 2 * rnd(b + 5); s[9] = (rnd(b + 6) - 0.5) * 2.4;
  s[10] = (rnd(b + 7) - 0.5) * 16; s[11] = (rnd(b + 8) - 0.5) * 10; s[12] = -(6 + 9 * rnd(b + 9));
  evN = 0;
  P[0] = s[0]; P[1] = s[1]; P[2] = s[2]; Q[0] = s[3]; Q[1] = s[4]; Q[2] = s[5]; Q[3] = s[6];
  let still = 0; let n = 0; let slept = false;
  for (let i = 1; i <= PH_MAX; i++) {
    const touch = simStep(i, record);
    n = i;
    P[i * 3] = s[0]; P[i * 3 + 1] = s[1]; P[i * 3 + 2] = s[2];
    Q[i * 4] = s[3]; Q[i * 4 + 1] = s[4]; Q[i * 4 + 2] = s[5]; Q[i * 4 + 3] = s[6];
    const v2 = s[7] * s[7] + s[8] * s[8] + s[9] * s[9]; const w2 = s[10] * s[10] + s[11] * s[11] + s[12] * s[12];
    if (touch >= 4 && v2 < 0.04 && w2 < 0.25) { if (++still >= 10) { slept = true; break; } } else still = 0;
  }
  return { n, slept };
}

// small quaternion / matrix helpers on plain arrays (no allocation in the loops that use them)
function qMulInto(out, o, a, ao, b, bo) {
  const ax = a[ao]; const ay = a[ao + 1]; const az = a[ao + 2]; const aw = a[ao + 3];
  const bx = b[bo]; const by = b[bo + 1]; const bz = b[bo + 2]; const bw = b[bo + 3];
  out[o] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
function qToM(q, o, m) {
  const x = q[o]; const y = q[o + 1]; const z = q[o + 2]; const w = q[o + 3];
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - z * w); m[2] = 2 * (x * z + y * w);
  m[3] = 2 * (x * y + z * w); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z - x * w);
  m[6] = 2 * (x * z - y * w); m[7] = 2 * (y * z + x * w); m[8] = 1 - 2 * (x * x + y * y);
}
function mToQ(m, out) {
  const tr = m[0] + m[4] + m[8];
  let x; let y; let z; let w; let s;
  if (tr > 0) { s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s; }
  else if (m[0] > m[4] && m[0] > m[8]) { s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; w = (m[7] - m[5]) / s; x = s / 4; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s; }
  else if (m[4] > m[8]) { s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = s / 4; z = (m[5] + m[7]) / s; }
  else { s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = s / 4; }
  const l = Math.hypot(x, y, z, w) || 1;
  out[0] = x / l; out[1] = y / l; out[2] = z / l; out[3] = w / l;
}
const rotYq = (a, out) => { out[0] = 0; out[1] = Math.sin(a / 2); out[2] = 0; out[3] = Math.cos(a / 2); };

// Orientation (as a quaternion) that shows each value on top, with the pips upright for the camera.
const FACE_Q = {};
const FACE_M = {};
{
  const rx = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const rz = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  const mm = (a, b) => { const o = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]; return o; };
  for (const v of FACE_VALUES) {
    const e = FACE_UP[v];
    const fv = mm(rx(e[0]), rz(e[2]));
    const vl = FACE_FRAME[FACE_VALUES.indexOf(v)].v;
    const d = [fv[0] * vl[0] + fv[1] * vl[1] + fv[2] * vl[2], fv[3] * vl[0] + fv[4] * vl[1] + fv[5] * vl[2], fv[6] * vl[0] + fv[7] * vl[1] + fv[8] * vl[2]];
    let bestB = 0; let bestD = -9;
    for (let k = 0; k < 4; k++) { // spin it about the vertical so the top of the pips points away from the camera
      const bb = k * HALF_PI;
      const zz = -d[0] * Math.sin(bb) + d[2] * Math.cos(bb);
      if (-zz > bestD) { bestD = -zz; bestB = bb; }
    }
    const ry = [Math.cos(bestB), 0, Math.sin(bestB), 0, 1, 0, -Math.sin(bestB), 0, Math.cos(bestB)];
    const m = mm(ry, fv);
    FACE_M[v] = Float64Array.from(m);
    FACE_Q[v] = new Float64Array(4);
    mToQ(FACE_M[v], FACE_Q[v]);
  }
}
/** The value on the top face of a die with this orientation (x y z w). */
function topOfQuat(x, y, z, w) {
  const a = 2 * (x * y + z * w); const b = 1 - 2 * (x * x + z * z); const c = 2 * (y * z - x * w); // world up, in the die's own axes
  const A = Math.abs(a); const B = Math.abs(b); const C = Math.abs(c);
  if (B >= A && B >= C) return FACE_VALUES[b > 0 ? 2 : 3];
  if (A >= C) return FACE_VALUES[a > 0 ? 0 : 1];
  return FACE_VALUES[c > 0 ? 4 : 5];
}

const TP = new Float32Array((PH_MAX + 2) * 3); const TQ = new Float32Array((PH_MAX + 2) * 4); // the throw, as played
const SP = new Float32Array((PH_MAX + 2) * 3); const SQ = new Float32Array((PH_MAX + 2) * 4); // the simulation
const THROW = { n: 2, hh: 0.22, slept: true, hx: 1, hz: 0, travel: 0, restQ: new Float64Array(4) };
const QF = new Float64Array(4); const QT = new Float64Array(4); const QA = new Float64Array(4); const QB = new Float64Array(4);
const MA = new Float64Array(9); const MB = new Float64Array(9); const MC = new Float64Array(9);
/** Turn the nearly-flat rest orientation q (at q[o]) into an exactly flat one with the same yaw. */
function snapFlat(q, o, out) {
  qToM(q, o, MA);
  let k = 0;
  if (Math.abs(MA[4]) > Math.abs(MA[3 + k])) k = 1;
  if (Math.abs(MA[5]) > Math.abs(MA[3 + k])) k = 2;
  const sg = MA[3 + k] < 0 ? -1 : 1;
  const ux = MA[k] * sg; const uy = MA[3 + k] * sg; const uz = MA[6 + k] * sg; // that axis of the die, which is nearly up
  QA[0] = -uz; QA[1] = 0; QA[2] = ux; QA[3] = 1 + uy; // shortest arc from u to +y
  const l = Math.hypot(QA[0], QA[2], QA[3]) || 1;
  QA[0] /= l; QA[2] /= l; QA[3] /= l;
  qMulInto(out, 0, QA, 0, q, o);
  const il = 1 / Math.hypot(out[0], out[1], out[2], out[3]);
  out[0] *= il; out[1] *= il; out[2] *= il; out[3] *= il;
}
/** Yaw (about +y) that lines a flat die up with the world axes, in -π/4..π/4, and the axis it was measured on. */
function yawOfFlat(q) {
  qToM(q, 0, MA);
  let k = 0;
  if (Math.abs(MA[4]) > Math.abs(MA[3])) k = 1;
  if (Math.abs(MA[5]) > Math.abs(MA[3 + k])) k = 2;
  const j = (k + 1) % 3;
  const al = Math.atan2(MA[6 + j], MA[j]);
  return al - Math.round(al / HALF_PI) * HALF_PI;
}
const wrapQuarter = (x) => x - Math.round(x / HALF_PI) * HALF_PI;

/**
 * Precompute the whole throw for a die that must land showing `value`, into TP / TQ (one entry per 1/120 s).
 * `from` is +1 (top player, in from the far right) or -1 (bottom player, near left); `yf` the final yaw; `rnd(k)` the
 * shared seeded stream. The simulated cube comes to rest on some face; because a cube is symmetric, composing the
 * orientation with one of its 24 rotations C (rest·C shows `value` on top) changes nothing about the contacts, so every
 * bounce stays exactly as simulated while the result is the rolled value. The simulation is then turned about the
 * vertical (no change for a floor) and slid so it ends on the centre.
 */
function throwTo(value, from, yf, rnd) {
  const aD = Math.atan2(from * 0.8, -from * 3.3); // direction of travel, start to centre
  let best = 0; let bestCost = 1e9;
  for (let k = 0; k < 24; k++) { // several launches from the same seeded stream; keep the one that suits the stage
    const r = simRun(rnd, k, SP, SQ, false);
    snapFlat(SQ, r.n * 4, QF);
    const rx = SP[r.n * 3]; const rz = SP[r.n * 3 + 2];
    const L = Math.hypot(rx, rz);
    const eps = wrapQuarter(yf + yawOfFlat(QF) - (Math.atan2(rz, rx) - aD));
    const cost = 3 * Math.abs(eps) + 0.5 * Math.abs(L - 3.9) + 1.2 * Math.max(0, 3.1 - L) + (r.slept ? 0 : 1.5);
    if (cost < bestCost) { bestCost = cost; best = k; }
    if (cost < 0.3) break;
  }
  const r = simRun(rnd, best, SP, SQ, true);
  const n = r.n;
  THROW.cost = bestCost; THROW.k = best;
  // the last stretch eases into an exactly flat rest (a few steps if it slept, 120 ms if the cap cut it short)
  snapFlat(SQ, n * 4, QF);
  const M = Math.min(n, r.slept ? 8 : 14);
  const ex = SP[n * 3]; const ez = SP[n * 3 + 2];
  const bx = SP[(n - M) * 3]; const bz = SP[(n - M) * 3 + 2];
  const px = r.slept ? ex : bx + (ex - bx) * 0.5; const pz = r.slept ? ez : bz + (ez - bz) * 0.5;
  for (let i = n - M; i <= n; i++) {
    const t = (i - (n - M)) / M; const e = t * t * (3 - 2 * t);
    const o = i * 4;
    const dot = SQ[o] * QF[0] + SQ[o + 1] * QF[1] + SQ[o + 2] * QF[2] + SQ[o + 3] * QF[3];
    const sg = dot < 0 ? -1 : 1;
    let x = SQ[o] + (QF[0] * sg - SQ[o]) * e; let y = SQ[o + 1] + (QF[1] * sg - SQ[o + 1]) * e;
    let z = SQ[o + 2] + (QF[2] * sg - SQ[o + 2]) * e; let w = SQ[o + 3] + (QF[3] * sg - SQ[o + 3]) * e;
    const l = 1 / Math.hypot(x, y, z, w); x *= l; y *= l; z *= l; w *= l;
    SQ[o] = x; SQ[o + 1] = y; SQ[o + 2] = z; SQ[o + 3] = w;
    SP[i * 3 + 1] += (0.5 - SP[i * 3 + 1]) * e;
    SP[i * 3] += (px - SP[i * 3]) * e; SP[i * 3 + 2] += (pz - SP[i * 3 + 2]) * e;
  }
  const rx = SP[n * 3]; const rz = SP[n * 3 + 2];
  const a2 = (Math.atan2(rz, rx) - aD) + wrapQuarter(yf + yawOfFlat(QF) - (Math.atan2(rz, rx) - aD)); // world yaw for the whole throw
  // C: the cube rotation with (yaw · rest · C) = (final yaw · the face-up orientation of `value`)
  rotYq(a2, QA); qMulInto(QB, 0, QA, 0, QF, 0); qToM(QB, 0, MA);
  rotYq(yf, QA); qMulInto(QT, 0, QA, 0, FACE_Q[value], 0); qToM(QT, 0, MB);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let sum = 0; for (let k = 0; k < 3; k++) sum += MA[k * 3 + i] * MB[k * 3 + j]; MC[i * 3 + j] = Math.round(sum); }
  mToQ(MC, QB); // QB = C
  rotYq(a2, QA);
  const ca = Math.cos(a2); const sa = Math.sin(a2);
  for (let i = 0; i <= n; i++) {
    const dx = SP[i * 3] - rx; const dz = SP[i * 3 + 2] - rz;
    TP[i * 3] = dx * ca + dz * sa; TP[i * 3 + 1] = SP[i * 3 + 1]; TP[i * 3 + 2] = -dx * sa + dz * ca;
    qMulInto(QT, 0, QA, 0, SQ, i * 4);
    qMulInto(TQ, i * 4, QT, 0, QB, 0);
  }
  THROW.n = n + 1; THROW.hh = PH_H; THROW.slept = r.slept;
  const hl = Math.hypot(TP[0], TP[2]) || 1;
  THROW.hx = -TP[0] / hl; THROW.hz = -TP[2] / hl; THROW.travel = hl;
  rotYq(yf, QA); qMulInto(THROW.restQ, 0, QA, 0, FACE_Q[value], 0);
  return THROW;
}
/** A short drop, no tumble (reduced motion, tap-to-skip, redraws). */
function dropTo(value, yf) {
  rotYq(yf, QA); qMulInto(QT, 0, QA, 0, FACE_Q[value], 0);
  for (let i = 0; i < 2; i++) { TP[i * 3] = 0; TP[i * 3 + 1] = i ? 0.5 : 0.75; TP[i * 3 + 2] = 0; for (let c = 0; c < 4; c++) TQ[i * 4 + c] = QT[c]; }
  THROW.n = 2; THROW.hh = 0.22; THROW.slept = true; THROW.hx = 1; THROW.hz = 0; THROW.travel = 0; evN = 0;
  for (let c = 0; c < 4; c++) THROW.restQ[c] = QT[c];
  return THROW;
}
/** A seeded stream for callers that don't have one (tests, redraws). */
function seededStream(seed) { return (i) => { let t = (seed + Math.imul(i + 1, 0x9e3779b9)) >>> 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ── textures, drawn once with a 2D canvas ─────────────────────────────
const ATLAS_W = 512; const ATLAS_H = 256; const CELL = 128; const CELL_PAD = 4; // 4 × 2 cells of 128 px: six faces and two spare
const MAT_N = 256; const MAT_TILE = 1.6; // the play mat tiles every 1.6 world units
const GRAD = [128, 192, 255]; // three printed tones for the banded toon shading
function lcg(seed) { let a = seed >>> 0; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; }
const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const rgba = (c, a) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
/** Paper + faint grain for all eight atlas cells (CPU-side canvas, drawn on a palette change). */
function paintAtlasBase(g, pal) {
  g.fillStyle = cssOf(pal.dark ? mix3(pal.card, pal.ink, 0.17) : pal.card); // on black stock the die is a lighter grey card, so its faces still read
  g.fillRect(0, 0, ATLAS_W, ATLAS_H);
  const rnd = lcg(7);
  for (let i = 0; i < 8 * 150; i++) { // paper grain: tiny ink specks at low strength
    g.fillStyle = rgba(pal.ink, 0.04 + rnd() * 0.07);
    const sz = rnd() < 0.8 ? 1 : 2;
    g.fillRect(Math.floor(rnd() * ATLAS_W), Math.floor(rnd() * ATLAS_H), sz, sz);
  }
}
/** The pips: printed ink with a second pass in the roller's colour a hair off register. */
function paintAtlasPips(g, base, pal, roller) {
  g.drawImage(base, 0, 0);
  const R = 11.5; const sp = (CELL - 2 * CELL_PAD) / 4;
  FACE_VALUES.forEach((v, i) => {
    const cx = (i % 4) * CELL + CELL_PAD; const cy = (i >> 2) * CELL + CELL_PAD;
    const dot = (x, y, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill(); };
    const pts = PIPS[v].map(([r, c]) => [cx + sp + c * sp, cy + sp + r * sp]);
    for (const [x, y] of pts) dot(x + 1.8, y + 1.5, cssOf(roller)); // off-register second ink
    for (const [x, y] of pts) dot(x, y, cssOf(pal.ink));
  });
}
/** The tileable play mat: paper, a faint halftone screen, felt fibres. Wrapped so the tile has no seam. */
function paintMat(g, pal) {
  const N = MAT_N;
  g.fillStyle = cssOf(pal.bg);
  g.fillRect(0, 0, N, N);
  const rnd = lcg(11);
  const spot = (x, y, w, h, col) => { // draws a spot and its wrapped copies
    g.fillStyle = col;
    for (let dx = -N; dx <= N; dx += N) for (let dy = -N; dy <= N; dy += N) {
      const X = x + dx; const Y = y + dy;
      if (X + w < 0 || Y + h < 0 || X > N || Y > N) continue;
      g.fillRect(X, Y, w, h);
    }
  };
  for (let i = 0; i < 900; i++) spot(Math.floor(rnd() * N), Math.floor(rnd() * N), rnd() < 0.8 ? 1 : 2, 1, rgba(pal.ink, 0.03 + rnd() * 0.05));
  for (let i = 0; i < 160; i++) { // felt fibres
    const x = rnd() * N; const y = rnd() * N; const a = rnd() * Math.PI; const l = 3 + rnd() * 5;
    g.strokeStyle = rgba(pal.ink, 0.04);
    g.lineWidth = 1;
    for (let dx = -N; dx <= N; dx += N) for (let dy = -N; dy <= N; dy += N) {
      g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); g.stroke();
    }
  }
  // halftone screen at 45°: dots every 16 px along the diagonals
  g.fillStyle = rgba(pal.ink, 0.075);
  const P = 16;
  for (let j = 0; j < N / (P / 2); j++) for (let i = 0; i < N / P; i++) {
    const x = i * P + (j & 1 ? P / 2 : 0) + P / 4; const y = j * (P / 2) + P / 4;
    g.beginPath(); g.arc(x, y, 2.3, 0, Math.PI * 2); g.fill();
  }
}

/** The die: a cube with rounded edges (R_DIE), 6 faces × 5 × 5 quads, smooth normals, UVs into the face atlas. */
function roundedDieGeometry(THREE) {
  const stops = [-0.5, -0.5 + R_DIE / 2, -0.5 + R_DIE, 0.5 - R_DIE, 0.5 - R_DIE / 2, 0.5];
  const K = stops.length;
  const pos = new Float32Array(6 * K * K * 3); const nor = new Float32Array(6 * K * K * 3); const uv = new Float32Array(6 * K * K * 2);
  const idx = [];
  for (let f = 0; f < 6; f++) {
    const { n, u, v } = FACE_FRAME[f];
    const cx = (f % 4) * CELL + CELL_PAD; const cy = (f >> 2) * CELL + CELL_PAD; const span = CELL - 2 * CELL_PAD;
    for (let iu = 0; iu < K; iu++) {
      for (let iv = 0; iv < K; iv++) {
        const a = stops[iu]; const b = stops[iv];
        const p = [0, 0, 0];
        for (let c = 0; c < 3; c++) p[c] = n[c] * 0.5 + u[c] * a + v[c] * b;
        const q = p.map((t) => Math.max(-PH_HALF, Math.min(PH_HALF, t)));
        const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
        const l = Math.hypot(d[0], d[1], d[2]) || 1;
        const o = (f * K * K + iu * K + iv);
        for (let c = 0; c < 3; c++) { nor[o * 3 + c] = d[c] / l; pos[o * 3 + c] = q[c] + (d[c] / l) * R_DIE; }
        uv[o * 2] = (cx + (a + 0.5) * span) / ATLAS_W;
        uv[o * 2 + 1] = 1 - (cy + (0.5 - b) * span) / ATLAS_H;
      }
    }
    for (let iu = 0; iu < K - 1; iu++) {
      for (let iv = 0; iv < K - 1; iv++) {
        const o = f * K * K + iu * K + iv;
        idx.push(o, o + K, o + K + 1, o, o + K + 1, o + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
/** Ink creases along the crest of the twelve rounded edges. */
function creaseGeometry(THREE) {
  const c = PH_HALF + R_DIE * Math.SQRT1_2; const e = PH_HALF;
  const v = [];
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
    v.push(-e, s1 * c, s2 * c, e, s1 * c, s2 * c); // along x
    v.push(s1 * c, -e, s2 * c, s1 * c, e, s2 * c); // along y
    v.push(s1 * c, s2 * c, -e, s1 * c, s2 * c, e); // along z
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  return g;
}
/** A printed target ring (and four tick marks) on the mat where the die lands, one flat mesh. */
function ringGeometry(THREE, r0, r1, seg) {
  const pos = []; const idx = [];
  const quad = (a, b, c, d) => { const o = pos.length / 3; pos.push(...a, ...b, ...c, ...d); idx.push(o, o + 1, o + 2, o + 2, o + 1, o + 3); };
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2; const a1 = ((i + 1) / seg) * Math.PI * 2;
    quad([r0 * Math.cos(a0), 0, r0 * Math.sin(a0)], [r0 * Math.cos(a1), 0, r0 * Math.sin(a1)], [r1 * Math.cos(a0), 0, r1 * Math.sin(a0)], [r1 * Math.cos(a1), 0, r1 * Math.sin(a1)]);
  }
  for (let k = 0; k < 4; k++) {
    const a = k * HALF_PI; const ca = Math.cos(a); const sa = Math.sin(a);
    const at = (rr, w) => [rr * ca - w * sa, 0, rr * sa + w * ca];
    quad(at(r1 + 0.05, -0.035), at(r1 + 0.05, 0.035), at(r1 + 0.22, -0.035), at(r1 + 0.22, 0.035));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

const PUFF_N = 10;
function dieView3D(THREE, canvas, pal0, onImpact) {
  let pal = pal0;
  let roller = pal0.a;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  let ratio = Math.min(2, window.devicePixelRatio || 1);
  let W = 1; let H = 1;
  renderer.setPixelRatio(ratio);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 60);
  let dist = CAM_DIST;
  function placeCam() {
    cam.position.set(0, CAM_TARGET_Y + dist * Math.sin(CAM_EL), dist * Math.cos(CAM_EL));
    cam.lookAt(0, CAM_TARGET_Y, 0);
  }
  placeCam();
  // paper above, ink below, one sun: with the three-step ramp the faces print in three distinct tones
  const hemi = new THREE.HemisphereLight(0xffffff, 0x777777, 0.42);
  const sun = new THREE.DirectionalLight(0xffffff, 0.62);
  sun.position.set(-0.5, 0.82, -0.12);
  scene.add(hemi, sun, sun.target);

  const atlasCv = document.createElement('canvas'); atlasCv.width = ATLAS_W; atlasCv.height = ATLAS_H;
  const atlasBase = document.createElement('canvas'); atlasBase.width = ATLAS_W; atlasBase.height = ATLAS_H;
  const matCv = document.createElement('canvas'); matCv.width = matCv.height = MAT_N;
  const atlasTex = new THREE.CanvasTexture(atlasCv);
  const matTex = new THREE.CanvasTexture(matCv);
  matTex.wrapS = matTex.wrapT = THREE.RepeatWrapping;
  matTex.repeat.set(24 / MAT_TILE, 12 / MAT_TILE);
  matTex.anisotropy = 1; // (the mat is a gentle 55° view: no need for anisotropic filtering, which is costly on weak GPUs)
  const grad = new THREE.DataTexture(new Uint8Array(GRAD), GRAD.length, 1, THREE.LuminanceFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.generateMipmaps = false;
  grad.unpackAlignment = 1;
  grad.needsUpdate = true;
  const texBytes = Math.round(ATLAS_W * ATLAS_H * 4 * 4 / 3 + MAT_N * MAT_N * 4 * 4 / 3 + GRAD.length * 4);

  const dieGeo = roundedDieGeometry(THREE);
  const creaseGeo = creaseGeometry(THREE);
  const shadowGeo = new THREE.CircleGeometry(0.6, 20);
  shadowGeo.rotateX(-HALF_PI);
  const matGeo = new THREE.PlaneGeometry(24, 12);
  matGeo.rotateX(-HALF_PI);
  const ringGeo = ringGeometry(THREE, 1.0, 1.05, 64);
  const puffGeo = new THREE.BufferGeometry();
  const puffPos = new Float32Array(PUFF_N * 3);
  puffGeo.setAttribute('position', new THREE.BufferAttribute(puffPos, 3));
  const dieMat = new THREE.MeshToonMaterial({ map: atlasTex, gradientMap: grad, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const hullMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
  const lineMat = new THREE.LineBasicMaterial();
  const shadowMat = new THREE.MeshBasicMaterial();
  const floorMat = new THREE.MeshBasicMaterial({ map: matTex });
  const ringMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const puffMat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false });

  const floor = new THREE.Mesh(matGeo, floorMat);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.002;
  const squash = new THREE.Group(); // scales along the world axes (the die inside it turns)
  const die = new THREE.Group();
  const mesh = new THREE.Mesh(dieGeo, dieMat);
  const hull = new THREE.Mesh(dieGeo, hullMat);
  const lines = new THREE.LineSegments(creaseGeo, lineMat);
  die.add(hull, mesh, lines);
  squash.add(die);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  const puff = new THREE.Points(puffGeo, puffMat);
  puff.frustumCulled = false;
  scene.add(floor, ring, shadow, squash, puff);
  squash.visible = false; shadow.visible = false; puff.visible = false;

  const qWob = new THREE.Quaternion();
  const wobAxis = new THREE.Vector3(0, 0, 1);
  const st = {
    mode: 'idle', t: 0, hh: 0.22, n: 2, res: null, calm: false, fast: false, evPtr: 0, lastSfx: -1, hold: 0, settleT: 0,
    sq: 0, sqv: 0, top: 0, wob: 0, puffT: -1, big: false, scale: 1, hideT: 0, hideDur: 0.16, yaw: 0,
  };
  const puffV = new Float32Array(PUFF_N * 3);
  let puffSeed = 1;

  function setPalette(p) {
    pal = p;
    renderer.setClearColor(new THREE.Color(p.bg[0], p.bg[1], p.bg[2]), 1);
    hullMat.color.setRGB(p.ink[0], p.ink[1], p.ink[2]);
    lineMat.color.setRGB(p.ink[0], p.ink[1], p.ink[2]);
    puffMat.color.setRGB(p.ink[0], p.ink[1], p.ink[2]);
    const rc = mix3(p.bg, p.ink, p.dark ? 0.4 : 0.34);
    ringMat.color.setRGB(rc[0], rc[1], rc[2]);
    // paper above, ink below: hemisphere sky is the paper tint (normalised, so a dark card doesn't darken the die)
    const m = Math.max(p.card[0], p.card[1], p.card[2], 0.01);
    hemi.color.setRGB(p.card[0] / m, p.card[1] / m, p.card[2] / m);
    const gnd = p.dark ? [0.42, 0.42, 0.46] : mix3([1, 1, 1], p.ink, 0.62);
    hemi.groundColor.setRGB(gnd[0], gnd[1], gnd[2]);
    paintAtlasBase(atlasBase.getContext('2d'), p);
    paintAtlasPips(atlasCv.getContext('2d'), atlasBase, p, roller);
    atlasTex.needsUpdate = true;
    paintMat(matCv.getContext('2d'), p);
    matTex.needsUpdate = true;
    grad.needsUpdate = true;
    setShadowColor();
  }
  function setShadowColor() { // hard shadow: the key plate (black on dark stock), a touch of the roller's ink
    const c = mix3(pal.edge, roller, 0.3);
    shadowMat.color.setRGB(c[0], c[1], c[2]);
  }
  function setRoller(c) {
    if (!c || c === roller) return;
    roller = c;
    paintAtlasPips(atlasCv.getContext('2d'), atlasBase, pal, roller);
    atlasTex.needsUpdate = true;
    setShadowColor();
  }
  setPalette(pal);

  function outline() { // ink outline thickness in world units at the die (≈ 2.2 CSS px)
    const visH = 2 * dist * Math.tan(CAM_FOV * Math.PI / 360);
    return 2.2 * visH / H;
  }
  function setHull() { const o = 1 + 2 * outline(); hull.scale.set(o, o, o); }

  /** Put the die and its shadow where the throw is at step i (+ α of the way to i + 1). */
  function sample(i, a) {
    const i1 = Math.min(i + 1, st.n - 1);
    const p0 = i * 3; const p1 = i1 * 3; const q0 = i * 4; const q1 = i1 * 4;
    const x = TP[p0] + (TP[p1] - TP[p0]) * a; const y = TP[p0 + 1] + (TP[p1 + 1] - TP[p0 + 1]) * a; const z = TP[p0 + 2] + (TP[p1 + 2] - TP[p0 + 2]) * a;
    let dot = TQ[q0] * TQ[q1] + TQ[q0 + 1] * TQ[q1 + 1] + TQ[q0 + 2] * TQ[q1 + 2] + TQ[q0 + 3] * TQ[q1 + 3];
    const sg = dot < 0 ? -1 : 1;
    const qx = TQ[q0] + (TQ[q1] * sg - TQ[q0]) * a; const qy = TQ[q0 + 1] + (TQ[q1 + 1] * sg - TQ[q0 + 1]) * a;
    const qz = TQ[q0 + 2] + (TQ[q1 + 2] * sg - TQ[q0 + 2]) * a; const qw = TQ[q0 + 3] + (TQ[q1 + 3] * sg - TQ[q0 + 3]) * a;
    dot = 1 / Math.hypot(qx, qy, qz, qw);
    die.quaternion.set(qx * dot, qy * dot, qz * dot, qw * dot);
    place(x, y, z);
  }
  function place(x, y, z) {
    let lift = 0;
    if (st.mode === 'settle' && st.wob) { // a short rock on landing: tilt about the horizontal, keep the low edge on the floor
      qWob.setFromAxisAngle(wobAxis, st.wob);
      die.quaternion.premultiply(qWob);
      lift = 0.5 * Math.abs(Math.sin(st.wob));
    }
    squash.position.set(x, 0, z);
    die.position.set(0, y + lift, 0);
    const sy = (1 - st.sq) * st.scale; const sx = (1 + 0.5 * st.sq) * st.scale;
    squash.scale.set(sx, sy, sx);
    const clear = Math.max(0, y - 0.5);
    const c = Math.min(clear, 1.5);
    // a hard offset shadow (never blurred): it tightens to the die as it lands
    const off = 0.1 + 0.11 * c;
    shadow.position.set(x + off * st.scale, 0.006, z + off * st.scale);
    const k = (1 + 0.2 * c + 0.5 * Math.max(0, st.sq)) * st.scale;
    shadow.scale.set(k, 1, k * 0.94);
  }
  function juice(dt) { // squash & stretch spring, ink flecks
    if (!st.calm && (st.sq !== 0 || st.sqv !== 0)) {
      const n = Math.ceil(dt / 0.008);
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        st.sqv += (-1440 * st.sq - 24 * st.sqv) * h; // ω ≈ 38 /s, well under-damped: a bounce or two
        st.sq += st.sqv * h;
      }
      st.sq = Math.max(-0.07, Math.min(0.12, st.sq));
      if (Math.abs(st.sq) < 0.002 && Math.abs(st.sqv) < 0.05) { st.sq = 0; st.sqv = 0; }
    }
    if (st.puffT >= 0) {
      st.puffT += dt;
      if (st.puffT > 0.4) { st.puffT = -1; puff.visible = false; } else {
        for (let i = 0; i < PUFF_N; i++) {
          puffV[i * 3 + 1] -= 9 * dt;
          puffPos[i * 3] += puffV[i * 3] * dt; puffPos[i * 3 + 1] = Math.max(0.01, puffPos[i * 3 + 1] + puffV[i * 3 + 1] * dt); puffPos[i * 3 + 2] += puffV[i * 3 + 2] * dt;
        }
        puffGeo.attributes.position.needsUpdate = true;
        puffMat.size = st.puffT < 0.28 ? 3 : 2; // flecks shrink at the end (three scales the size by the pixel ratio itself)
      }
    }
  }
  function impact(speed, x, z) {
    if (speed > 2.5 && !st.calm) st.sqv += 0.55 * Math.min(speed, 12);
    if (!st.big && speed > 4 && !st.calm) { // the first big impact kicks up a puff of ink flecks
      st.big = true;
      for (let i = 0; i < PUFF_N; i++) {
        puffSeed = (Math.imul(puffSeed, 1664525) + 1013904223) >>> 0;
        const a = (i / PUFF_N) * Math.PI * 2 + (puffSeed / 4294967296) * 0.6;
        const sp = 0.9 + (puffSeed & 255) / 255 * 1.1;
        puffPos[i * 3] = x + Math.cos(a) * 0.35; puffPos[i * 3 + 1] = 0.05; puffPos[i * 3 + 2] = z + Math.sin(a) * 0.35;
        puffV[i * 3] = Math.cos(a) * sp; puffV[i * 3 + 1] = 1.4 + ((puffSeed >> 8) & 255) / 255 * 1.6; puffV[i * 3 + 2] = Math.sin(a) * sp;
      }
      puffGeo.attributes.position.needsUpdate = true;
      st.puffT = 0; puff.visible = true; puffMat.size = 3;
    }
    if (st.t - st.lastSfx >= 0.06 && speed > 1.4) { st.lastSfx = st.t; onImpact(speed); }
  }
  function land() { // the die is at rest: show the final pose, then a hitstop and a short rock
    const last = st.n - 1;
    st.sq = st.sqv = 0; st.scale = 1; st.wob = 0;
    st.mode = 'idle';
    sample(last, 0);
    st.top = topOfQuat(die.quaternion.x, die.quaternion.y, die.quaternion.z, die.quaternion.w); // read back from what the renderer is given
    const r = st.res; st.res = null;
    if (st.calm || st.fast) { st.puffT = -1; puff.visible = false; } else {
      st.mode = 'settle'; st.settleT = 0; st.hold = 3;
      st.sq = 0.06; // the final slam, held for a few frames
      wobAxis.set(THROW.hz, 0, -THROW.hx);
      sample(last, 0);
    }
    if (r) r();
  }

  return {
    kind: '3d',
    /** Returns true if the canvas was resized (which clears it, so the caller must draw at once). */
    resize(w, h) {
      w = Math.max(1, w); h = Math.max(1, h);
      if (w === W && h === H) return false;
      W = w; H = h;
      renderer.setSize(W, H, false);
      cam.aspect = W / H;
      cam.updateProjectionMatrix();
      setHull();
      return true;
    },
    get ratio() { return ratio; },
    get texBytes() { return texBytes; },
    get mode() { return st.mode; },
    get info() { return renderer.info.render; },
    /** The value on top, read from the orientation the renderer is given once the die has landed (0 if it hasn't). */
    top() { return st.mode === 'roll' || !squash.visible ? 0 : st.top; },
    /** Pull the camera back (k > 1) so the die is smaller in a tall band. */
    setZoom(k) { if (dist === CAM_DIST * k) return false; dist = CAM_DIST * k; placeCam(); setHull(); return true; },
    setRatio(r) { ratio = r; renderer.setPixelRatio(r); renderer.setSize(W, H, false); },
    setPalette,
    compile() {
      const vis = squash.visible;
      squash.visible = shadow.visible = puff.visible = true;
      renderer.compile(scene, cam);
      squash.visible = shadow.visible = vis; puff.visible = st.puffT >= 0;
    },
    restore() { setPalette(pal); renderer.setPixelRatio(ratio); renderer.setSize(W, H, false); this.compile(); },
    /** Throw the die and land showing `value`. Resolves when it lands. `rnd(k)` is the shared seeded stream. */
    roll(value, who, yaw, calm, rnd) {
      if (st.res) st.res();
      return new Promise((res) => {
        const from = who === 'top' ? 1 : -1; // bottom player's die comes in from the near left
        st.res = res; st.calm = !!calm; st.fast = false; st.t = 0; st.evPtr = 0; st.lastSfx = -1; st.hold = 0; st.big = false;
        st.sq = st.sqv = 0; st.scale = 1; st.puffT = -1; puff.visible = false; st.yaw = yaw; st.wob = 0;
        setRoller(who === 'top' ? pal.topInk : pal.botInk);
        if (calm) dropTo(value, yaw); else throwTo(value, from, yaw, rnd || seededStream(1 + value));
        st.n = THROW.n; st.hh = THROW.hh;
        st.mode = 'roll';
        squash.visible = shadow.visible = true;
        setHull();
        sample(0, 0);
      });
    },
    hide(calm) {
      if (!squash.visible) return Promise.resolve();
      if (st.res) { st.res(); st.res = null; }
      return new Promise((res) => { st.mode = 'hide'; st.hideT = 0; st.hideDur = calm ? 0.05 : 0.16; st.res = res; st.sq = st.sqv = 0; st.wob = 0; });
    },
    setInks(top, bot) { pal.topInk = top; pal.botInk = bot; },
    /** Jump the current roll / hide to its end state on the next frame. */
    fast() { if (st.mode === 'roll') { st.fast = true; st.t = (st.n - 1) * st.hh; } else if (st.mode === 'hide') st.hideT = st.hideDur; else if (st.mode === 'settle') { st.hold = 0; st.settleT = 9; } },
    /** The GL context is gone for good: settle whatever was waiting on a frame (nothing will draw it). */
    abort() {
      const r = st.res; st.res = null; st.mode = 'idle'; st.scale = 1; st.sq = st.sqv = 0;
      if (r) r();
    },
    step(dt) {
      if (st.mode === 'roll') {
        st.t += dt;
        const T = (st.n - 1) * st.hh;
        if (st.t >= T) { if (!st.fast && !st.calm) while (st.evPtr < evN) { impact(evSpd[st.evPtr], squash.position.x, squash.position.z); st.evPtr++; } land(); } else {
          const f = st.t / st.hh; const i = Math.floor(f);
          if (!st.calm && !st.fast) while (st.evPtr < evN && evStep[st.evPtr] <= f) { impact(evSpd[st.evPtr], squash.position.x, squash.position.z); st.evPtr++; }
          juice(dt);
          sample(i, f - i);
        }
        return true;
      }
      if (st.mode === 'settle') {
        if (st.hold > 0) { st.hold--; return true; } // hitstop: the picture stays put for a few frames
        st.settleT += dt;
        juice(dt);
        const k = st.settleT;
        st.wob = k < 0.3 ? 0.075 * Math.exp(-k * 13) * Math.sin(k * 52) : 0;
        if (k >= 0.3 && st.sq === 0 && st.puffT < 0) { st.mode = 'idle'; st.wob = 0; }
        sample(st.n - 1, 0);
        return true;
      }
      if (st.mode === 'hide') {
        st.hideT += dt;
        const k = Math.min(1, st.hideT / st.hideDur);
        st.scale = 1 - easeOut(k);
        juice(dt);
        place(squash.position.x, die.position.y, squash.position.z);
        if (k >= 1) {
          st.mode = 'idle'; squash.visible = shadow.visible = false; st.scale = 1; st.puffT = -1; puff.visible = false;
          const r = st.res; st.res = null;
          if (r) r();
        }
        return true;
      }
      return false;
    },
    render() { renderer.render(scene, cam); return renderer.info.render.calls; },
    dispose() {
      if (st.res) { st.res(); st.res = null; }
      try { renderer.forceContextLoss(); } catch { /* ignore */ }
      for (const g of [dieGeo, creaseGeo, shadowGeo, matGeo, ringGeo, puffGeo]) g.dispose();
      for (const t of [atlasTex, matTex, grad]) t.dispose();
      for (const m of [dieMat, hullMat, lineMat, shadowMat, floorMat, ringMat, puffMat]) m.dispose();
      renderer.dispose();
    },
  };
}

// ── 2D fallback die (plain DOM, same api) ─────────────────────────────
function dieView2D(host) {
  host.hidden = false;
  let timer = 0;
  let res = null;
  const show = (v, cls) => { host.innerHTML = dieHTML(v, cls); };
  return {
    kind: '2d',
    resize() {}, setRatio() {}, setPalette() {}, compile() {}, restore() {}, setInks() {},
    get ratio() { return 1; },
    top() { const d = host.querySelector('.gb-die'); return d ? Number(d.dataset.v) || 0 : 0; },
    fast() { if (res) { clearInterval(timer); const v = host.querySelector('.gb-die'); const done = res; res = null; if (v) v.classList.add('landed'); done(); } },
    roll(value, who, yaw, calm) {
      clearInterval(timer);
      if (res) res();
      return new Promise((r) => {
        res = r;
        host.className = `gb-die2d from-${who}${calm ? '' : ' rolling'}`;
        let k = 0;
        show(((value + 2) % 6) + 1);
        const steps = calm ? 0 : 9;
        const tick = () => {
          k++;
          if (k > steps) {
            clearInterval(timer);
            show(value, 'landed');
            const done = res; res = null;
            if (done) done();
            return;
          }
          show(((value + k * 4) % 6) + 1);
        };
        if (!steps) tick();
        else timer = setInterval(tick, 85);
      });
    },
    hide() { clearInterval(timer); if (res) { res(); res = null; } host.innerHTML = ''; return Promise.resolve(); },
    step() { return false; },
    render() {},
    dispose() { clearInterval(timer); if (res) { res(); res = null; } host.innerHTML = ''; },
  };
}

// ── records and rivalry (api.data) ────────────────────────────────────
// Flat keys, numbers and strings only. *_best / *_n keys only ever go up, so a sync keeps the larger
// value; everything else (streaks, form) is written once per match, guarded by last_id and a per-match m_<id> marker.
const LAST_TW = 'ju.bones.twist';
function lastTwist() { try { const v = localStorage.getItem(LAST_TW); return TWIST_IDS.includes(v) ? v : ''; } catch { return ''; } }
function saveTwist(id) { try { localStorage.setItem(LAST_TW, id); } catch { /* storage off */ } }

/**
 * Fold one finished match into the shared record. Pure: returns { patch, flags, streak, form }.
 * Both phones run it on the same match and the same data, so they write the same values; if the
 * partner already wrote this match (last_id), nothing is written and its flags are read back.
 */
/** A per-match marker key: unlike last_id (a plain string a late sync can roll back), it is only ever added. */
const doneKey = (id) => 'm_' + String(id).replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 40);
function recordsFor(d, s, r, id) {
  if (d.last_id === id || d[doneKey(id)]) return { patch: null, flags: String(d.last_flags || ''), streak: { who: d.streak_who, len: Number(d.streak_len) || 0 }, form: String(d.form || '') };
  const sc = score(s);
  const w = r.winner;
  const prevGames = Number(d.games_n) || 0;
  const patch = { last_id: id, [doneKey(id)]: 1, games_n: prevGames + 1 };
  const flags = [];
  for (const p of ['a', 'b']) {
    const k = `best_${p}_best`;
    const prev = Number(d[k]) || 0;
    if (sc[p] > prev) { patch[k] = sc[p]; if (prev > 0) flags.push(`pb_${p}`); }
  }
  const smash = s.big ? s.big.pts : 0;
  if (smash > (Number(d.smash_best) || 0)) { patch.smash_best = smash; patch.smash_who = s.big.who; if (Number(d.smash_best) > 0 && smash >= 10) flags.push('smash'); }
  const down = w && s.deficit ? s.deficit[w] : 0;
  if (down > (Number(d.comeback_best) || 0)) { patch.comeback_best = down; patch.comeback_who = w; if (Number(d.comeback_best) > 0 && down >= 10) flags.push('comeback'); }
  const wipes = s.wipes ? s.wipes.a + s.wipes.b : 0;
  if (wipes) patch.wipe_n = (Number(d.wipe_n) || 0) + wipes;
  if (w) {
    const len = d.streak_who === w ? (Number(d.streak_len) || 0) + 1 : 1;
    patch.streak_who = w; patch.streak_len = len;
    if (len > (Number(d.streak_len_best) || 0)) patch.streak_len_best = len;
  } else { patch.streak_who = '-'; patch.streak_len = 0; patch.draw_n = (Number(d.draw_n) || 0) + 1; }
  const form = (String(d.form || '') + (w || '-')).slice(-5);
  patch.form = form;
  const tw = s.tw || 'classic';
  patch[`tw_${tw}_n`] = (Number(d[`tw_${tw}_n`]) || 0) + 1;
  if (w) patch[`tw_${tw}_${w}_n`] = (Number(d[`tw_${tw}_${w}_n`]) || 0) + 1;
  patch.last_flags = flags.join(',');
  return { patch, flags: patch.last_flags, streak: { who: patch.streak_who, len: patch.streak_len }, form };
}
const formHTML = (form) => (form && form.length >= 2
  ? `<span class="gb-form" role="img" aria-label="Last ${form.length} games">${[...form].map((ch) => `<i class="gb-fd ${ch === 'a' ? 'a' : ch === 'b' ? 'b' : 'd'}"></i>`).join('')}</span>` : '');
function pickerHTML() {
  const last = lastTwist();
  return `<p class="gb-pk-head"><b>Twist the rules?</b> <span>Or just place a die.</span></p><div class="gb-pk-grid">${TWIST_IDS.map((id) => `<button type="button" class="gb-pk${id === last ? ' is-last' : ''}" data-tw="${id}"><b><span class="gb-nl">${TWISTS[id].name}</span><span class="gb-ns">${TWISTS[id].name.split(' ')[0]}</span></b><span>${TWISTS[id].hint}</span></button>`).join('')}</div>`;
}

// ── the game ──────────────────────────────────────────────────────────
registerGame({
  id: 'bones',
  title: 'Knucklebones',
  blurb: 'Roll, place, pair up, and smash their dice.',
  kind: 'turns',
  team: false,
  tags: ['brainy', 'quick', '3d'],
  platforms: ['phone', 'computer'],
  minutes: 5,
  endDelay: 'manual', // the finale calls api.showEnd() once the last smash has played
  howTo: [
    'You roll a die each turn. Tap one of your columns (or press 1–3) to place it.',
    'Matching dice in a column multiply: 4 + 4 scores 16, three 4s score 36.',
    'Your die knocks out every die of that value in their facing column.',
    'It ends when a grid fills. Higher total wins. The starter can pick a twist first.',
  ],
  init, next, apply, result, score,
  _test: { recordsFor, rollAt, colPts, TWISTS, throwTo, dropTo, topOfQuat, seededStream, TP, TQ, THROW, evStep, evSpd, evN: () => evN, FACE_VALUES }, // for the tests

  css: `
    .g-bones { --gb-die: 52px; --gb-col: 52px; --gb-gap: 7px; --gb-pad: 8px; --gb-band: 112px; --gb-side: 62px;
      flex: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0; padding: 4px 0 10px; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
    .g-bones .gb-board { width: 100%; max-width: 480px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
    .g-bones .gb-half { display: grid; grid-template-columns: var(--gb-side) auto var(--gb-side); justify-content: center; align-items: center; column-gap: 8px; row-gap: 6px; transition: opacity 0.4s, filter 0.4s; }
    .g-bones .gb-tray, .g-bones .gb-scores { grid-column: 2; }
    .g-bones .gb-top .gb-scores { grid-row: 1; }
    .g-bones .gb-top .gb-tray, .g-bones .gb-top .gb-name, .g-bones .gb-top .gb-total { grid-row: 2; }
    .g-bones .gb-bot .gb-tray, .g-bones .gb-bot .gb-name, .g-bones .gb-bot .gb-total { grid-row: 1; }
    .g-bones .gb-bot .gb-scores { grid-row: 2; }
    .g-bones .gb-name { grid-column: 1; justify-self: end; min-width: 0; max-width: 100%; display: flex; flex-direction: column; align-items: flex-end; gap: 5px; text-align: right; font-weight: 900; font-size: 0.85rem; line-height: 1.1; }
    .g-bones .gb-chip { width: 16px; height: 16px; border: 2px solid var(--g-ink); border-radius: 5px; }
    .g-bones .gb-a .gb-chip { background: var(--p-a); } .g-bones .gb-b .gb-chip { background: var(--p-b); }
    .g-bones .gb-nm { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .g-bones .gb-mark { visibility: hidden; padding: 1px 5px; border: 2px solid var(--g-ink); border-radius: 5px; background: var(--g-hl); color: var(--g-on-ink); font-size: 0.6rem; letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; }
    .g-bones .gb-half.is-turn .gb-mark { visibility: visible; }
    .g-bones .gb-total { grid-column: 3; justify-self: start; font-family: var(--g-font-display); font-weight: 900; font-size: 1.85rem; line-height: 1; font-variant-numeric: tabular-nums; }
    .g-bones .gb-half.is-win .gb-total { animation: gb-win 0.7s cubic-bezier(.3, 1.6, .5, 1) both; background: var(--g-hl); color: var(--g-on-ink); border: 2px solid var(--g-ink); border-radius: 8px; padding: 4px 6px; box-shadow: var(--g-shadow); }
    .g-bones .gb-half.is-lose { opacity: 0.6; filter: grayscale(1); } /* the loser's half drops its inks: black plate only */
    .g-bones .gb-tray { display: grid; grid-template-columns: repeat(3, var(--gb-col)); column-gap: var(--gb-gap); padding: var(--gb-pad); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow); }
    .g-bones .gb-a .gb-tray { background: var(--p-a-soft); } .g-bones .gb-b .gb-tray { background: var(--p-b-soft); }
    .g-bones .gb-scores { display: grid; grid-template-columns: repeat(3, var(--gb-col)); column-gap: var(--gb-gap); padding: 0 calc(var(--gb-pad) + 2px); }
    .g-bones .gb-cs { justify-self: center; min-width: 34px; padding: 2px 8px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); font-weight: 900; font-size: 0.85rem; line-height: 1.3; text-align: center; font-variant-numeric: tabular-nums; }
    .g-bones .gb-cs.combo { background: var(--g-hl); color: var(--g-on-ink); }
    .g-bones .gb-cs.bump { animation: gb-bump 0.45s cubic-bezier(.3, 1.6, .5, 1); }
    .g-bones .gb-col { position: relative; z-index: 0; display: flex; flex-direction: column; align-items: center; gap: var(--gb-gap); margin: 0; padding: 0; border: 0; background: none; color: inherit; font: inherit; opacity: 1; touch-action: manipulation; -webkit-tap-highlight-color: transparent; cursor: default; border-radius: calc(var(--gb-die) * 0.26); }
    .g-bones .gb-top .gb-col { flex-direction: column-reverse; }
    .g-bones .gb-col.can { cursor: pointer; }
    .g-bones .gb-col.can::before { content: ''; position: absolute; inset: -4px -2px; z-index: -1; border: 2px solid var(--g-ink); border-radius: calc(var(--gb-die) * 0.3); background: var(--g-hl); box-shadow: var(--g-shadow-sm); transition: transform 0.08s, box-shadow 0.08s; }
    .g-bones .gb-col.can:active::before, .g-bones .gb-col.can.is-press::before { transform: translate(2px, 2px); box-shadow: 0 0 0 var(--g-edge); }
    .g-bones.is-hit * { animation-play-state: paused !important; } /* hitstop before a smash cracks */
    .g-bones .gb-col.can .gb-die.ghost { animation: gb-hint 0.9s ease-in-out infinite alternate; }
    .g-bones .gb-col:focus-visible { outline: 3px solid var(--g-ink); outline-offset: 7px; }
    .g-bones .gb-slot { position: relative; display: block; width: var(--gb-die); height: var(--gb-die); border-radius: 24%; border: 2px dashed var(--g-line); }
    .g-bones .gb-slot.full { border-color: transparent; }
    .g-bones .gb-col.can .gb-slot { border-color: transparent; }
    .g-bones .gb-die { position: absolute; inset: 0; box-sizing: border-box; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); padding: 13%; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 22%; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
    .g-bones .gb-die i { border-radius: 50%; background: var(--g-ink); margin: 13%; }
    .g-bones .gb-die.c2, .g-bones .gb-die.c3 { background: var(--g-hl); }
    .g-bones .gb-die.c2 i, .g-bones .gb-die.c3 i { background: var(--g-on-ink); }
    .g-bones .gb-die.c3 { border-width: 3px; box-shadow: var(--g-shadow); }
    .g-bones .gb-die.ghost { opacity: 0.6; border-style: dashed; border-color: var(--g-on-ink); box-shadow: none; background: transparent; }
    .g-bones .gb-die.ghost i { background: var(--g-on-ink); }
    .g-bones .gb-die.pulse { animation: gb-pulse 0.5s cubic-bezier(.3, 1.6, .5, 1); }
    .g-bones .gb-bot .gb-die.is-new { animation: gb-drop-b 0.34s cubic-bezier(.2, .8, .3, 1.2) both; }
    .g-bones .gb-top .gb-die.is-new { animation: gb-drop-t 0.34s cubic-bezier(.2, .8, .3, 1.2) both; }
    .g-bones .gb-die.threat::after { content: ''; position: absolute; inset: -6px; border: 2.5px dashed var(--g-bad); border-radius: 28%; animation: gb-threat 0.8s ease-in-out infinite alternate; }
    .g-bones .gb-die.crack { animation: gb-shake 0.32s linear both; }
    .g-bones .gb-die.crack::before, .g-bones .gb-die.crack::after { content: ''; position: absolute; top: 8%; bottom: 8%; width: 3px; background: var(--g-ink); border-radius: 2px; }
    .g-bones .gb-die.crack::before { left: 44%; transform: rotate(16deg); }
    .g-bones .gb-die.crack::after { left: 56%; top: 30%; bottom: 20%; transform: rotate(-38deg); }
    .g-bones .gb-die.pop { animation: gb-pop 0.3s ease-in both; }
    .g-bones .gb-shard { position: absolute; left: 50%; top: 50%; width: 24%; height: 24%; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 3px; animation: gb-shard 0.46s ease-out both; pointer-events: none; }
    .g-bones .gb-bot .gb-die.shift { animation: gb-shift-b 0.28s ease-out both; }
    .g-bones .gb-top .gb-die.shift { animation: gb-shift-t 0.28s ease-out both; }
    .g-bones .gb-band { position: relative; height: var(--gb-band); border: 2px solid var(--g-ink); border-radius: var(--g-radius); background: var(--g-card); box-shadow: var(--g-shadow); touch-action: none; }
    .g-bones .gb-band canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; border-radius: calc(var(--g-radius) - 2px); }
    .g-bones .gb-lab { position: absolute; top: 50%; transform: translateY(-50%); max-width: 36%; display: flex; flex-direction: column; gap: 4px; font-weight: 900; font-size: 0.86rem; line-height: 1.15; pointer-events: none; transition: opacity 0.12s; }
    .g-bones .gb-lab > * { max-width: 100%; }
    .g-bones .gb-lab .gb-hint, .g-bones .gb-lab .gb-streak, .g-bones .gb-lab .gb-wn, .g-bones .gb-lab .gb-kick { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .g-bones .gb-hint { font-size: 0.72rem; font-weight: 800; }
    .g-bones .gb-band.is-stamped .gb-lab { opacity: 0; } /* a stamp on the board is covering the band text: hide it for the moment */
    .g-bones .gb-lab-l { left: 12px; align-items: flex-start; }
    .g-bones .gb-lab-r { right: 12px; align-items: flex-end; text-align: right; color: var(--g-muted); font-weight: 800; }
    .g-bones .gb-kick { font-size: 0.62rem; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); }
    .g-bones .gb-arrow { width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; }
    .g-bones .gb-arrow.down { border-top: 9px solid var(--g-ink); }
    .g-bones .gb-arrow.up { border-bottom: 9px solid var(--g-ink); }
    .g-bones .gb-lab-r b { color: var(--g-ink); }
    .g-bones .gb-big { font-family: var(--g-font-display); font-weight: 900; font-size: 1.3rem; line-height: 1.05; color: var(--g-ink); }
    .g-bones .gb-band.is-final .gb-lab { max-width: 60%; }
    .g-bones .gb-band.is-final .gb-lab-r { max-width: 36%; }
    .g-bones .gb-by { display: flex; align-items: baseline; gap: 5px; }
    .g-bones .gb-by .gb-big { font-size: 1.7rem; }
    /* a short band (small phones): one line of kicker-free text each side, so nothing spills out of it */
    .g-bones.is-short .gb-lab { font-size: 0.8rem; gap: 2px; }
    .g-bones.is-short .gb-kick { font-size: 0.58rem; }
    .g-bones.is-short .gb-hint { font-size: 0.7rem; }
    .g-bones.is-short .gb-band.is-final .gb-lab > .gb-kick { display: none; }
    .g-bones.is-short .gb-big { font-size: 1.1rem; }
    .g-bones.is-short .gb-by .gb-big { font-size: 1.5rem; }
    .g-bones.is-short .gb-streak { font-size: 0.68rem; }
    .g-bones.is-short .gb-form { margin-top: 2px; gap: 3px; }
    .g-bones.is-short .gb-fd { width: 7px; height: 7px; border-width: 1.5px; }
    .g-bones.is-short .gb-nx { margin-top: 0; }
    .g-bones .gb-die2d { position: absolute; left: 50%; top: 50%; width: calc(var(--gb-band) * 0.52); height: calc(var(--gb-band) * 0.52); transform: translate(-50%, -50%); }
    .g-bones .gb-die2d .gb-die { box-shadow: var(--g-shadow); }
    .g-bones .gb-die2d.rolling .gb-die { animation: gb-tumble 0.8s cubic-bezier(.2, .7, .3, 1) both; }
    .g-bones .gb-die2d.from-top.rolling .gb-die { animation-name: gb-tumble-r; }
    .g-bones.is-tight { padding: 2px 0 4px; }
    .g-bones.is-tight .gb-board { gap: 6px; }
    .g-bones.is-tight .gb-half { row-gap: 3px; }
    .g-bones.is-tight .gb-cs { min-width: 30px; padding: 1px 7px; font-size: 0.75rem; line-height: 1.15; }
    .g-bones .gb-board { position: relative; }
    .g-bones .gb-half { position: relative; }
    /* the gilded column of a Golden Column match */
    .g-bones .gb-gild { position: absolute; inset: -4px -2px; z-index: -1; border: 2px solid var(--g-ink); border-radius: calc(var(--gb-die) * 0.3); background: var(--g-halftone) 0 0 / 5px 5px, var(--g-hl-soft); pointer-events: none; }
    .g-bones .gb-col.gold.can .gb-gild { background: var(--g-halftone) 0 0 / 5px 5px; }
    .g-bones .gb-cs { display: inline-flex; align-items: center; justify-content: center; gap: 3px; }
    .g-bones .gb-cs.gold { background: var(--g-hl); color: var(--g-on-ink); }
    .g-bones .gb-x2 { font-style: normal; font-size: 0.62rem; font-weight: 900; letter-spacing: 0.02em; }
    .g-bones .gb-pv { padding: 0 4px; border: 1.5px solid currentColor; border-radius: 999px; background: var(--g-card); font-size: 0.7rem; font-weight: 900; line-height: 1.25; }
    .g-bones .gb-cs.has-pv { padding-left: 5px; padding-right: 4px; gap: 2px; }
    .g-bones .gb-cs.has-pv .gb-x2 { display: none; } /* the gilded plate already says it, and the preview needs the room */
    .g-bones.is-tight .gb-pv { padding: 0 3px; font-size: 0.66rem; }
    .g-bones .gb-pv.up { color: var(--g-good); } .g-bones .gb-pv.dn { color: var(--g-bad); }
    .g-bones .gb-qm { grid-area: 1 / 1 / 4 / 4; place-self: center; font: normal 900 calc(var(--gb-die) * 0.5) / 1 var(--g-font-display); color: var(--g-on-ink); }
    /* twist picker: covers the opponent's (empty) half before the first die */
    .g-bones .gb-picker { position: absolute; inset: -4px -2px; z-index: 4; display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow); }
    .g-bones .gb-picker[hidden] { display: none; }
    .g-bones .gb-pk-head { margin: 0; font-size: 0.72rem; line-height: 1.2; color: var(--g-muted); font-weight: 700; }
    .g-bones .gb-pk-head b { color: var(--g-ink); font-weight: 900; }
    .g-bones .gb-pk-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: minmax(44px, 1fr); gap: 6px; }
    .g-bones .gb-pk { position: relative; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 1px; min-width: 0; min-height: 44px; margin: 0; padding: 2px 8px; border: 2px solid var(--g-ink); border-radius: var(--g-radius-sm); background: var(--g-card); box-shadow: var(--g-shadow-sm); color: var(--g-ink); font: inherit; text-align: left; touch-action: manipulation; -webkit-tap-highlight-color: transparent; cursor: pointer; }
    .g-bones .gb-pk b { font-size: 0.8rem; font-weight: 900; line-height: 1.15; }
    .g-bones .gb-pk > span { font-size: 0.7rem; font-weight: 700; line-height: 1.1; color: var(--g-muted); }
    .g-bones .gb-pk.is-last::after { content: 'Last time'; position: absolute; top: -9px; right: 6px; padding: 0 6px; border: 1.5px solid var(--g-ink); border-radius: 999px; background: var(--g-hl); color: var(--g-on-ink); font-size: 0.58rem; font-weight: 900; letter-spacing: 0.06em; line-height: 1.3; text-transform: uppercase; pointer-events: none; }
    .g-bones.is-land .gb-picker { padding: 6px; gap: 4px; }
    .g-bones.is-land .gb-pk-head span { display: none; }
    .g-bones.is-land .gb-pk-grid { gap: 5px; }
    .g-bones.is-land .gb-pk { padding: 3px 6px; overflow: hidden; }
    .g-bones.is-land .gb-pk b { font-size: 0.72rem; white-space: nowrap; }
    .g-bones .gb-pk .gb-ns { display: none; }
    .g-bones.is-land .gb-pk .gb-nl { display: none; } .g-bones.is-land .gb-pk .gb-ns { display: inline; } /* narrow chips: "Golden", not "Golden Column" */
    .g-bones.is-land .gb-pk > span { font-size: 0.64rem; line-height: 1.08; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }
    .g-bones .gb-pk:active { transform: translate(2px, 2px); box-shadow: 0 0 0 var(--g-edge); }
    .g-bones .gb-pk:focus-visible { outline: 3px solid var(--g-ink); outline-offset: 2px; }
    /* the band: twist badge, the mystery die, the oracle's next dice, stamps, final recap */
    .g-bones .gb-badge { position: absolute; z-index: 2; left: 50%; top: 0; transform: translate(-50%, -50%); max-width: 44%; padding: 1px 8px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-hl); color: var(--g-on-ink); font-size: 0.6rem; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
    .g-bones .gb-badge[hidden], .g-bones .gb-q[hidden] { display: none; }
    .g-bones .gb-q { position: absolute; left: 50%; top: 52%; width: calc(var(--gb-band) * 0.5); height: calc(var(--gb-band) * 0.5); transform: translate(-50%, -50%); display: grid; place-items: center; border: 2px solid var(--g-ink); border-radius: 22%; background: var(--g-card); box-shadow: var(--g-shadow); animation: gb-wobble 1.6s ease-in-out infinite; pointer-events: none; }
    .g-bones .gb-q em { font: normal 900 calc(var(--gb-band) * 0.3) / 1 var(--g-font-display); color: var(--g-ink); }
    .g-bones.is-land .gb-q { width: 64px; height: 64px; top: 50%; } .g-bones.is-land .gb-q em { font-size: 2rem; }
    .g-bones .gb-nx { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
    .g-bones .gb-nx .gb-kick { font-style: normal; }
    .g-bones .gb-nx .gb-die { position: relative; inset: auto; flex: none; width: 22px; height: 22px; padding: 2px; border-width: 1.5px; box-shadow: none; }
    .g-bones .gb-nx .gb-die i { margin: 8%; }
    .g-bones[data-tw="oracle"].is-tight .gb-lab-r > .gb-hint { display: none; } /* room for the next-dice queue */
    .g-bones .gb-stamp { position: absolute; z-index: 6; top: 50%; left: 50%; --rot: -5deg; width: max-content; max-width: 94%; padding: 6px 14px; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-hl); color: var(--g-on-ink); box-shadow: var(--g-shadow); font: 900 1.25rem / 1.1 var(--g-font-display); letter-spacing: 0.05em; text-align: center; text-transform: uppercase; pointer-events: none; opacity: 0; transform: translate(-50%, -50%) rotate(var(--rot)); }
    .g-bones .gb-stamp.sm { top: 41%; --rot: 4deg; padding: 4px 10px; background: var(--g-card); color: var(--g-ink); font-size: 0.9rem; }
    .g-bones .gb-stamp.show { animation: gb-stamp 1.15s cubic-bezier(.2, .9, .3, 1.25) both; }
    .g-bones .gb-streak { font-size: 0.72rem; font-weight: 800; line-height: 1.15; color: var(--g-muted); }
    .g-bones .gb-form { display: inline-flex; gap: 4px; margin-top: 4px; }
    .g-bones .gb-fd { width: 12px; height: 12px; border: 2px solid var(--g-ink); border-radius: 50%; }
    .g-bones .gb-fd.a { background: var(--p-a); } .g-bones .gb-fd.b { background: var(--p-b); }
    .g-bones .gb-col.nope { animation: gb-nope 0.4s linear; }
    .g-bones .gb-col.full.nope::before { content: ''; position: absolute; inset: -4px -2px; z-index: -1; border: 2px dashed var(--g-bad); border-radius: calc(var(--gb-die) * 0.3); }
    /* landscape: the trays sit side by side with the band between them */
    .g-bones.is-land .gb-board { max-width: 760px; flex-direction: row; align-items: center; justify-content: center; gap: 10px; }
    .g-bones.is-land .gb-band { flex: 1 1 0; min-width: 120px; height: auto; align-self: stretch; }
    .g-bones.is-land .gb-half { grid-template-columns: minmax(0, 1fr) auto; justify-content: center; row-gap: 4px; column-gap: 6px; }
    .g-bones.is-land .gb-half .gb-name { grid-column: 1; grid-row: 1; flex-direction: row; align-items: center; justify-self: start; text-align: left; gap: 5px; font-size: 0.78rem; }
    .g-bones.is-land .gb-half .gb-total { grid-column: 2; grid-row: 1; font-size: 1.5rem; justify-self: end; }
    .g-bones.is-land .gb-half .gb-tray { grid-column: 1 / 3; grid-row: 2; justify-self: center; }
    .g-bones.is-land .gb-half .gb-scores { grid-column: 1 / 3; grid-row: 3; justify-self: center; }
    .g-bones.is-land .gb-mark { display: none; }
    .g-bones.is-land .gb-half.is-turn .gb-nm { padding: 0 5px; border-radius: 4px; background: var(--g-hl); color: var(--g-on-ink); }
    .g-bones.is-land .gb-lab { left: 8px; right: 8px; max-width: none; align-items: center; text-align: center; transform: none; }
    .g-bones.is-land .gb-lab-l { top: 14px; align-items: center; }
    .g-bones.is-land .gb-lab-r { top: auto; bottom: 8px; align-items: center; }
    .g-bones.is-land .gb-band.is-final .gb-lab, .g-bones.is-land .gb-band.is-final .gb-lab-r { max-width: none; }
    .g-bones.is-land .gb-arrow { transform: rotate(-90deg); }
    .g-bones.is-land .gb-die2d { width: 64px; height: 64px; }
    .g-bones.is-land .gb-by .gb-big { font-size: 1.5rem; }
    .g-bones.is-land .gb-hint, .g-bones.is-land .gb-streak, .g-bones.is-land .gb-wn { white-space: normal; }
    @keyframes gb-hint { from { transform: scale(0.9); } to { transform: none; } }
    @keyframes gb-wobble { 0%, 100% { transform: translate(-50%, -50%) rotate(-7deg); } 50% { transform: translate(-50%, -54%) rotate(7deg); } }
    @keyframes gb-stamp { 0% { opacity: 0; transform: translate(-50%, -50%) scale(1.8) rotate(calc(var(--rot) - 8deg)); } 16% { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(var(--rot)); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -58%) scale(1) rotate(var(--rot)); } }
    @keyframes gb-nope { 0%, 100% { transform: none; } 20% { transform: translateX(-5px); } 40% { transform: translateX(5px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(3px); } }
    @keyframes gb-bump { 0% { transform: scale(1); } 40% { transform: scale(1.3); } 100% { transform: scale(1); } }
    @keyframes gb-win { 0% { transform: scale(0.6) rotate(-8deg); } 100% { transform: scale(1) rotate(-3deg); } }
    @keyframes gb-pulse { 0% { transform: scale(1); } 40% { transform: scale(1.14) rotate(-4deg); } 100% { transform: scale(1); } }
    @keyframes gb-drop-b { from { opacity: 0; transform: translateY(calc(var(--gb-die) * -1.2)) scale(1.3) rotate(-14deg); } 55% { opacity: 1; } to { transform: none; } }
    @keyframes gb-drop-t { from { opacity: 0; transform: translateY(calc(var(--gb-die) * 1.2)) scale(1.3) rotate(14deg); } 55% { opacity: 1; } to { transform: none; } }
    @keyframes gb-threat { from { opacity: 0.35; } to { opacity: 1; } }
    @keyframes gb-shake { 0%, 100% { transform: none; } 20% { transform: translateX(-3px) rotate(-4deg); } 40% { transform: translateX(3px) rotate(3deg); } 60% { transform: translateX(-2px) rotate(-2deg); } 80% { transform: translateX(2px); } }
    @keyframes gb-pop { 0% { transform: scale(1); } 30% { transform: scale(1.2) rotate(-8deg); } 100% { opacity: 0; transform: scale(0.1) rotate(30deg); } }
    @keyframes gb-shard { from { transform: translate(-50%, -50%); opacity: 1; } to { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) rotate(var(--r)); opacity: 0; } }
    @keyframes gb-shift-b { from { transform: translateY(calc(var(--sh) * (var(--gb-die) + var(--gb-gap)))); } to { transform: none; } }
    @keyframes gb-shift-t { from { transform: translateY(calc(var(--sh) * -1 * (var(--gb-die) + var(--gb-gap)))); } to { transform: none; } }
    @keyframes gb-tumble { 0% { transform: translate(-150px, -6px) rotate(-460deg); } 45% { transform: translate(-36px, -16px) rotate(-130deg); } 70% { transform: translate(-6px, 0) rotate(-22deg); } 86% { transform: translate(0, -4px) rotate(4deg); } 100% { transform: none; } }
    @keyframes gb-tumble-r { 0% { transform: translate(150px, -6px) rotate(460deg); } 45% { transform: translate(36px, -16px) rotate(130deg); } 70% { transform: translate(6px, 0) rotate(22deg); } 86% { transform: translate(0, -4px) rotate(-4deg); } 100% { transform: none; } }
    @media (prefers-reduced-motion: reduce) {
      .g-bones .gb-col.can .gb-die.ghost, .g-bones .gb-die.threat::after { animation: none; }
      .g-bones .gb-die.is-new, .g-bones .gb-die.shift, .g-bones .gb-die.pulse, .g-bones .gb-cs.bump, .g-bones .gb-die2d.rolling .gb-die, .g-bones .gb-die.crack, .g-bones .gb-col.nope { animation: none; }
      .g-bones .gb-die.pop { animation: gb-fade 0.15s linear both; }
      .g-bones .gb-shard { display: none; }
      .g-bones .gb-q { animation: none; }
      .g-bones .gb-stamp.show { opacity: 1; } /* the room switches every animation off: JS takes the stamp down again */
      @keyframes gb-fade { to { opacity: 0; } }
    }
  `,

  mount(el, api) {
    const threeP = api.three(); // start loading at once
    threeP.catch(noop);
    el.innerHTML = `<div class="g-bones">
      <div class="gb-board">
        <section class="gb-half gb-top"><div class="gb-scores"></div><div class="gb-name"></div><div class="gb-tray"></div><div class="gb-total">0</div><div class="gb-picker" hidden></div></section>
        <div class="gb-band" aria-live="polite">
          <canvas aria-hidden="true"></canvas>
          <div class="gb-die2d" hidden aria-hidden="true"></div>
          <div class="gb-q" hidden aria-hidden="true"><em>?</em></div>
          <div class="gb-badge" hidden></div>
          <div class="gb-lab gb-lab-l"></div>
          <div class="gb-lab gb-lab-r"></div>
        </div>
        <section class="gb-half gb-bot"><div class="gb-name"></div><div class="gb-tray"></div><div class="gb-total">0</div><div class="gb-scores"></div><div class="gb-picker" hidden></div></section>
        <div class="gb-stamp" aria-hidden="true"></div>
        <div class="gb-stamp sm" aria-hidden="true"></div>
      </div>
    </div>`;
    const $ = (s) => el.querySelector(s);
    const root = $('.g-bones');
    const band = $('.gb-band');
    const canvas = band.querySelector('canvas');
    const labL = $('.gb-lab-l');
    const labR = $('.gb-lab-r');
    const badge = $('.gb-badge');
    const qDie = $('.gb-q');
    const board = $('.gb-board');
    const stampBig = $('.gb-stamp:not(.sm)');
    const stampSm = $('.gb-stamp.sm');
    const halves = { top: $('.gb-top'), bot: $('.gb-bot') };
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = () => matchMedia('(pointer: coarse)').matches;

    let dead = false;
    let ctxNow = null;
    let bottom = api.mode === 'online' && api.me ? api.me : 'a';
    let topW = other(bottom);
    let shownMoves = -1;
    let dieN = -1;
    let picking = false;
    let opt = null; // a placement already drawn by pick(), waiting for the engine's update
    let finaleDone = false;
    let openedOver = null; // was the match already finished when this view first saw it?
    let dv = null;
    let pal = readPalette(api);
    let raf = 0;
    let lastT = 0;
    let paused = typeof document !== 'undefined' && document.hidden;
    let glLost = false;
    let ema = 16;
    let perfN = 0;
    let readyRes;
    const ready = new Promise((r) => { readyRes = r; });
    const T = () => (typeof window !== 'undefined' && window.__bonesTest) || null; // test hook only
    const log = (ev) => { const t = T(); if (t) { (t.log || (t.log = [])).push(ev); (t.at || (t.at = [])).push(performance.now()); } };
    const sfx = (name) => { log(`sfx:${name}`); api.sfx(name); };

    /** A die hitting the table: the existing tick, louder and higher the harder it lands (a thump under the big ones). */
    function impactSound(speed) {
      log('sfx:tick');
      try {
        if (api.muted && api.muted()) return;
        const ctx = api.audio && api.audio();
        if (!ctx) return;
        const t = ctx.currentTime + 0.002;
        const v = Math.min(1, speed / 9);
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(760 + 120 * Math.min(speed, 9), t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.02 + 0.05 * v, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.04);
        if (speed > 4.5) {
          const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
          o2.type = 'sine';
          o2.frequency.setValueAtTime(170, t); o2.frequency.exponentialRampToValueAtTime(70, t + 0.07);
          g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.06 + 0.12 * v, t + 0.006); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
          o2.connect(g2).connect(ctx.destination); o2.start(t); o2.stop(t + 0.1);
        }
      } catch { /* no audio */ }
    }
    function setSides() {
      halves.bot.classList.remove('gb-a', 'gb-b'); halves.top.classList.remove('gb-a', 'gb-b');
      halves.bot.classList.add(`gb-${bottom}`); halves.top.classList.add(`gb-${topW}`);
      halves.bot.dataset.who = bottom; halves.top.dataset.who = topW;
      halves.bot.querySelector('.gb-tray').dataset.who = bottom;
      halves.top.querySelector('.gb-tray').dataset.who = topW;
      for (const [k, w] of [['top', topW], ['bot', bottom]]) {
        const label = api.mode === 'online' && w === api.me ? 'You' : api.name(w);
        halves[k].querySelector('.gb-name').innerHTML = `<span class="gb-chip" aria-hidden="true"></span><span class="gb-nm"></span><span class="gb-mark">To play</span>`;
        halves[k].querySelector('.gb-nm').textContent = label;
      }
      const inks = (w) => (w === 'a' ? pal.a : pal.b);
      if (dv) dv.setInks(inks(topW), inks(bottom));
    }
    setSides();
    labL.innerHTML = '<span class="gb-kick">Shaking the dice…</span>'; // until the first roll

    // ── layout: size dice to fit the stage ──
    // The room scrolls (min-height content), so the stage can't tell us how much room there is:
    // work it out from the viewport instead. Portrait stacks the trays with the band between;
    // when that would make the dice small and a side-by-side board fits bigger ones, go landscape.
    function stageRoom() {
      const gm = el.closest('.gm');
      const rt = el.closest('#game-root');
      const vh = rt ? rt.clientHeight : window.innerHeight;
      const top = el.getBoundingClientRect().top - (rt ? rt.getBoundingClientRect().top - rt.scrollTop : 0);
      let padB = 12;
      try { if (gm) padB = parseFloat(getComputedStyle(gm).paddingBottom) || 12; } catch { /* keep */ }
      const W = Math.min(el.clientWidth || 360, 760);
      const H = Math.max(160, vh - top - padB);
      return { W, H };
    }
    const COLMIN = 44; // a column button is never narrower than this
    const gapOf = (d) => (d < 48 ? 5 : 7);
    const padOf = (d) => (d < 48 ? 6 : 8);
    // `tight` squeezes the stage padding, board gap and score chips so small screens can have bigger dice
    const SPACE = { loose: { pad: 14, gap: 10, row: 32, bandMin: 64 }, tight: { pad: 6, gap: 6, row: 23, bandMin: 58 } };
    function fitPortrait(W, H, tight) {
      const K = tight ? SPACE.tight : SPACE.loose;
      const fixed = K.pad + 2 * K.gap + K.bandMin + 2 * K.row;
      const side = Math.round(Math.max(54, Math.min(96, W * 0.19)));
      let best = 0;
      for (let d = 66; d >= 30; d--) {
        const col = Math.max(COLMIN, d);
        const gap = gapOf(d); const pad = padOf(d);
        if (2 * side + 16 + 3 * col + 2 * gap + 2 * pad + 4 > W) continue;
        if (fixed + 2 * (3 * d + 2 * gap + 2 * pad + 4) > H) continue;
        best = d; break;
      }
      const d = best || 30;
      const gap = gapOf(d); const pad = padOf(d);
      const left = H - (fixed - K.bandMin + 2 * (3 * d + 2 * gap + 2 * pad + 4));
      return { land: false, tight, die: d, col: Math.max(COLMIN, d), gap, pad, side, band: Math.round(Math.max(K.bandMin, Math.min(150, left))), fits: !!best };
    }
    function fitLand(W, H, tight) {
      const K = tight ? SPACE.tight : SPACE.loose;
      const head = tight ? 28 : 32; const foot = K.row; const bandMin = 128;
      let best = 0;
      for (let d = 60; d >= 30; d--) {
        const col = Math.max(COLMIN, d);
        const gap = gapOf(d); const pad = padOf(d);
        if (2 * (3 * col + 2 * gap + 2 * pad + 4) + bandMin + 2 * K.gap > W) continue;
        if (K.pad + head + foot + 3 * d + 2 * gap + 2 * pad + 4 + 8 > H) continue;
        best = d; break;
      }
      const d = best || 30;
      return { land: true, tight, die: d, col: Math.max(COLMIN, d), gap: gapOf(d), pad: padOf(d), side: 0, band: 0, fits: !!best };
    }
    function layout() {
      const { W, H } = stageRoom();
      const pw = Math.min(W, 480);
      // the biggest dice that fit wins; side-by-side and squeezed layouts have to earn their place
      const cands = [[fitPortrait(pw, H, false), 0], [fitPortrait(pw, H, true), 3], [fitLand(W, H, false), 8], [fitLand(W, H, true), 11]];
      let L = null; let top = -1e9;
      for (const [c, pen] of cands) { const v = c.fits ? c.die - pen : -1e6 + c.die; if (v > top) { top = v; L = c; } }
      root.classList.toggle('is-land', L.land);
      root.classList.toggle('is-tight', L.tight);
      root.classList.toggle('is-short', !L.land && L.band < 84);
      root.style.setProperty('--gb-die', `${L.die}px`);
      root.style.setProperty('--gb-col', `${L.col}px`);
      root.style.setProperty('--gb-gap', `${L.gap}px`);
      root.style.setProperty('--gb-pad', `${L.pad}px`);
      root.style.setProperty('--gb-side', `${L.side}px`);
      root.style.setProperty('--gb-band', `${L.band}px`);
      if (dv) {
        const zoomed = dv.setZoom ? dv.setZoom(L.land ? 1.75 : 1) : false;
        const cleared = dv.resize(band.clientWidth, band.clientHeight);
        if (cleared) renderNow(true); else if (zoomed) renderNow();
      }
    }
    window.addEventListener('resize', layout);
    const ro = new ResizeObserver(() => layout());
    ro.observe(el);
    layout();

    // ── board drawing ──
    function trayHTML(who, grid, o) {
      const pick = o.pick === who;
      return grid.map((col, ci) => {
        const counts = {};
        for (const v of col) counts[v] = (counts[v] || 0) + 1;
        let slots = '';
        for (let r = 0; r < ROWS; r++) {
          const v = col[r];
          let inner = '';
          if (v) {
            const cls = [];
            if (counts[v] === 2) cls.push('c2');
            if (counts[v] >= 3) cls.push('c3');
            if (o.newAt && o.newAt.who === who && o.newAt.col === ci && r === col.length - 1) cls.push('is-new');
            if (o.doomed && o.doomed.who === who && o.doomed.col === ci && v === o.doomed.value) cls.push(o.doomed.stage);
            if (o.threat && o.threat.who === who && v === o.threat.value && o.threat.cols.includes(ci)) cls.push('threat');
            if (o.pulse && o.pulse.who === who && o.pulse.col === ci && v === o.pulse.value && counts[v] > 1) cls.push('pulse');
            let extra = '';
            const sh = o.shift && o.shift.who === who && o.shift.col === ci ? o.shift.by[r] : 0;
            if (sh) { cls.push('shift'); extra = ` style="--sh:${sh}"`; }
            inner = dieHTML(v, cls.join(' '), extra);
            if (o.doomed && o.doomed.stage === 'pop' && cls.includes('pop')) {
              const burst = o.doomed.big ? [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1.7], [0, 1.7], [-1.7, 0], [1.7, 0]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]];
              inner += burst.map(([dx, dy], k) => `<b class="gb-shard" style="--dx:${dx * (18 + k * 3)}px;--dy:${dy * (16 + k * 4)}px;--r:${(k % 2 ? 1 : -1) * 120}deg"></b>`).join('');
            }
          } else if (pick && r === col.length) inner = dieHTML(o.blind ? '?' : o.roll, 'ghost');
          slots += `<span class="gb-slot${v ? ' full' : ''}">${inner}</span>`;
        }
        const can = pick && col.length < ROWS;
        const full = pick && !can;
        const gilded = o.gold === ci;
        const label = `${gilded ? 'Golden column ' : 'Column '}${ci + 1}: ${col.length ? col.join(', ') : 'empty'}. Scores ${colPts(col, ci, o.gold)}.${can ? ' Place your die here.' : full ? ' Full.' : ''}`;
        // aria-disabled, not disabled: a tap on a full column still arrives, so it can say why nothing happened
        return `<button type="button" class="gb-col${can ? ' can' : ''}${full ? ' full' : ''}${gilded ? ' gold' : ''}" data-col="${ci}" aria-label="${label}"${can ? '' : ' aria-disabled="true" tabindex="-1"'}>${gilded ? '<span class="gb-gild" aria-hidden="true"></span>' : ''}${slots}</button>`;
      }).join('');
    }
    function scoresHTML(grid, bumpCol, gold, pv) {
      return grid.map((col, ci) => {
        const combo = col.some((v) => col.indexOf(v) !== col.lastIndexOf(v));
        const chip = pv && pv[ci] ? `<b class="gb-pv ${pv[ci] > 0 ? 'up' : 'dn'}">${pv[ci] > 0 ? '+' : '−'}${Math.abs(pv[ci])}</b>` : '';
        return `<span class="gb-cs${combo ? ' combo' : ''}${gold === ci ? ' gold' : ''}${bumpCol === ci ? ' bump' : ''}${chip ? ' has-pv' : ''}"><span>${colPts(col, ci, gold)}</span>${gold === ci ? '<i class="gb-x2">×2</i>' : ''}${chip}</span>`;
      }).join('');
    }
    function draw(grids, o = {}) {
      const s = ctxNow && ctxNow.state;
      const gold = s ? s.gold : undefined;
      o.gold = gold;
      for (const [k, w] of [['top', topW], ['bot', bottom]]) {
        const h = halves[k];
        if (o.only && w !== o.only) { h.classList.remove('is-turn'); continue; } // only the half that changed is rebuilt
        const tray = h.querySelector('.gb-tray');
        tray.innerHTML = trayHTML(w, grids[w], o);
        tray.classList.toggle('is-picking', o.pick === w);
        const pv = o.pv ? (o.pick === w ? o.pv.gain : o.pv.loss) : null;
        h.querySelector('.gb-scores').innerHTML = scoresHTML(grids[w], o.bump && o.bump.who === w ? o.bump.col : -1, gold, pv);
        h.querySelector('.gb-total').textContent = gridScore(grids[w], gold);
        h.classList.toggle('is-turn', !!s && !s.over && s.turn === w && !o.noTurn);
      }
    }
    const cloneGrids = (g) => ({ a: g.a.map((c) => c.slice()), b: g.b.map((c) => c.slice()) });
    function preGrids(s) {
      const g = cloneGrids(s.grids);
      const L = s.last;
      g[L.who][L.col].pop();
      g[other(L.who)][L.col] = L.oppBefore.slice();
      return g;
    }

    // ── labels in the dice tray ──
    const whoLabel = (w) => (ctxNow && ctxNow.mode === 'online' && w === ctxNow.me ? 'You' : api.name(w));
    const twOf = () => (ctxNow && ctxNow.state && ctxNow.state.tw) || '';
    const isBlind = () => twOf() === 'blind';
    const nextRolls = (s) => [rollAt(s, s.n + 1), rollAt(s, s.n + 2)];
    function setBadge(s) {
      const tw = s && s.tw;
      const on = !!tw && tw !== 'classic' && TWISTS[tw];
      badge.hidden = !on;
      if (on) badge.textContent = TWISTS[tw].name;
      root.dataset.tw = on ? tw : '';
    }
    function setMystery(on) {
      qDie.hidden = !on;
      band.classList.toggle('is-mystery', on);
    }
    function setBand(mode, w, value) {
      const arrow = w === bottom ? 'down' : 'up';
      const nm = whoLabel(w);
      const s = ctxNow && ctxNow.state;
      if (mode === 'over') {
        labL.innerHTML = '';
        labR.innerHTML = '';
        return;
      }
      const lastWord = !!(s && s.final);
      const kick1 = lastWord ? 'Last word' : mode === 'mystery' ? (nm === 'You' ? 'Your pick' : 'Picking for') : nm === 'You' ? 'Your roll' : 'Rolling for';
      labL.innerHTML = `<span class="gb-kick">${kick1}</span><span class="gb-wn"></span><span class="gb-arrow ${arrow}" aria-hidden="true"></span>`;
      labL.querySelector('.gb-wn').textContent = nm === 'You' ? '' : nm;
      const nx = s && s.tw === 'oracle' && !s.over && !s.final ? `<span class="gb-nx"><i class="gb-kick">Next</i>${nextRolls(s).map((v) => dieHTML(v, 'mini')).join('')}</span>` : '';
      const first = !!(s && s.n === 0 && s.tw === undefined);
      // one short line under the headline: the band is only ~58 px tall on a small phone
      const lwHint = s && s.tw === 'mirror' ? 'One last die' : 'Last die, no smash';
      if (mode === 'rolling') labR.innerHTML = nx;
      else if (mode === 'mystery') labR.innerHTML = `<b>Blind draw</b><span class="gb-wait gb-hint"></span>`;
      else if (mode === 'pick') labR.innerHTML = `<b>Rolled ${value}</b><span class="gb-hint">${lastWord ? lwHint : coarse() ? 'Pick a column' : 'Pick a column (1–3)'}</span>${nx}`;
      else labR.innerHTML = `<b>Rolled ${value}</b><span class="gb-wait gb-hint"></span>${nx}`;
      const wt = labR.querySelector('.gb-wait');
      if (wt) {
        if (mode === 'mystery') wt.textContent = w === (ctxNow && ctxNow.actor) || (ctxNow && ctxNow.mode === 'local') ? 'Pick blind' : 'Choosing blind';
        else wt.textContent = lastWord ? lwHint : first ? 'Picking a twist…' : 'Choosing…';
      }
    }

    // ── loop for the 3D die ──
    function frame(now) {
      raf = 0;
      if (dead || paused || glLost || !dv) return;
      const dt = lastT ? Math.min(0.05, Math.max(0, (now - lastT) / 1000)) : 1 / 60;
      lastT = now;
      const t = T();
      const c0 = t ? performance.now() : 0;
      const busy = dv.step(dt);
      dirty = false;
      const calls = dv.render();
      if (dv.kind === '3d') {
        ema = ema * 0.92 + dt * 1000 * 0.08;
        if (++perfN > 50 && ema > 24 && dv.ratio > 1) { dv.setRatio(Math.max(1, dv.ratio - 0.25)); perfN = 0; ema = 16; }
      }
      if (t) {
        const ms = performance.now() - c0; // main-thread cost of this frame's step + render (the bench reads the worst)
        const cs = t.cost || (t.cost = []);
        cs.push(ms);
        if (cs.length > 900) cs.shift();
        t.frames = (t.frames || 0) + 1; t.calls = calls;
        if (dv.info) t.tris = dv.info.triangles;
        if (dv.texBytes !== undefined) t.texBytes = dv.texBytes;
      }
      if (busy || dirty) raf = requestAnimationFrame(frame);
      else lastT = 0;
    }
    let dirty = false;
    function kick() { if (!raf && !dead && !paused && !glLost && dv) raf = requestAnimationFrame(frame); }
    /** Ask for a redraw. One render per animation frame: the frame loop does it. Only a resize (which clears the canvas)
     *  is drawn at once, so the canvas never shows a blank frame. */
    function renderNow(now) {
      if (!dv || paused || glLost || dead) return;
      if (now) { dirty = false; dv.render(); }
      dirty = dirty || !now;
      if (dirty) kick();
    }
    // Tap-to-skip: while a roll / placement plays out, a tap fast-forwards it to the settled board.
    let skipping = false;
    let animating = false;
    const sleepers = new Set();
    const sleep = (ms) => new Promise((r) => {
      if (skipping) { r(); return; }
      const done = () => { clearTimeout(t); sleepers.delete(done); r(); };
      const t = setTimeout(done, ms);
      sleepers.add(done);
    }).then(() => { if (dead) throw DEAD; });
    function skipNow() {
      if (skipping) return;
      skipping = true;
      log('skip');
      if (dv) dv.fast();
      for (const f of [...sleepers]) f();
      kick();
    }

    async function roll(value, w, n) {
      dieN = n;
      log(`roll:${value}`);
      setMystery(false);
      setBand('rolling', w);
      band.dataset.roll = '';
      const s = ctxNow.state;
      const yaw = (api.rand(s.seed, 'yaw', n) - 0.5) * 0.9;
      const t = T();
      if (t) t.top = 0;
      // the throw is simulated from the seeded stream both phones share, so they see the same tumble
      const p = dv.roll(value, w === topW ? 'top' : 'bot', yaw, reduced() || skipping, (k) => api.rand(s.seed, 'throw', n, k));
      kick();
      await p;
      if (dead) throw DEAD;
      band.dataset.roll = String(value);
      if (t) t.top = dv.top ? dv.top() : 0; // the face that is up, read back from the orientation the renderer was given
      sfx('flip');
    }
    let bandT = 0;
    /** Ink a stamp on the board. `on` = 'top' / 'bot' parks it over that tray (the finale, so the recap in the band
     *  stays readable); without it the stamp sits mid-board over the band and its text fades out for a moment. */
    function stamp(text, small, on) {
      const e = small ? stampSm : stampBig;
      e.textContent = text;
      e.classList.remove('show');
      e.style.left = ''; e.style.maxWidth = '';
      if (on) {
        const br = board.getBoundingClientRect();
        const tr = halves[on].querySelector('.gb-tray').getBoundingClientRect();
        e.style.top = `${Math.round(tr.top + tr.height / 2 - br.top)}px`;
        if (root.classList.contains('is-land')) { // side-by-side trays: stay over this tray, wrapping if need be
          e.style.left = `${Math.round(tr.left + tr.width / 2 - br.left)}px`;
          e.style.maxWidth = `${Math.round(tr.width)}px`;
        }
      } else {
        e.style.top = '';
        band.classList.add('is-stamped');
        clearTimeout(bandT);
        bandT = setTimeout(() => band.classList.remove('is-stamped'), reduced() ? 1300 : 1150);
      }
      void e.offsetWidth;
      e.classList.add('show');
      clearTimeout(e._t);
      if (reduced()) e._t = setTimeout(() => e.classList.remove('show'), 1300);
      log(`stamp:${text}`);
    }
    /** A small shake of the band (CSS transform, 2–3 px, 150 ms) on a smash. */
    function shakeBand() {
      if (reduced() || skipping || typeof band.animate !== 'function') return;
      log('shake');
      try {
        band.animate([
          { transform: 'translate(0, 0)' }, { transform: 'translate(-3px, 1px)' }, { transform: 'translate(3px, -1px)' },
          { transform: 'translate(-2px, 0)' }, { transform: 'translate(2px, 1px)' }, { transform: 'translate(0, 0)' },
        ], { duration: 150, easing: 'linear' });
      } catch { /* no WAAPI */ }
    }
    /** `opt` = the placement was already drawn when the column was picked (see pick()): don't draw or sound it twice. */
    async function place(L, pre, s, opt) {
      const rm = reduced();
      const opp = other(L.who);
      const mid = cloneGrids(pre);
      mid[L.who][L.col].push(L.value);
      let hidden;
      if (opt) hidden = opt.hidden;
      else {
        log('place');
        labR.innerHTML = `<b>Rolled ${L.value}</b><span>Column ${L.col + 1}</span>`;
        hidden = dv.hide(rm || skipping);
        kick();
        draw(mid, { newAt: { who: L.who, col: L.col }, bump: { who: L.who, col: L.col } });
        sfx('place');
        api.haptic(10);
      }
      await hidden;
      await sleep(rm ? 60 : 300);
      if (L.destroyed > 0) {
        if (!rm) { // hitstop: the whole board holds still for a beat before it cracks
          root.classList.add('is-hit');
          await sleep(50);
          root.classList.remove('is-hit');
        }
        draw(mid, { doomed: { who: opp, col: L.col, value: L.value, stage: 'crack' } });
        log('crack');
        shakeBand();
        labR.innerHTML = `<b>${L.wipe ? 'Wiped out' : 'Smash'}</b><span>${L.destroyed === 1 ? 'One die' : `${L.destroyed} dice`} knocked out</span>`;
        sfx('hit');
        api.haptic(30);
        await sleep(rm ? 60 : 330);
        draw(mid, { doomed: { who: opp, col: L.col, value: L.value, stage: 'pop', big: !!L.wipe } });
        sfx('pop');
        if (L.wipe) { stamp('Wiped out'); sfx('win'); log('wipe'); }
        await sleep(rm ? 120 : 420);
        const by = [];
        let gone = 0;
        L.oppBefore.forEach((v) => { if (v === L.value) gone++; else by.push(gone); });
        draw(s.grids, { shift: { who: opp, col: L.col, by }, bump: { who: opp, col: L.col } });
        await sleep(rm ? 40 : 260);
      }
      const col = s.grids[L.who][L.col];
      const combo = col.filter((v) => v === L.value).length > 1;
      if (combo) {
        draw(s.grids, { pulse: { who: L.who, col: L.col, value: L.value }, bump: { who: L.who, col: L.col } });
        if (L.triple && !L.wipe) { stamp(`Triple ${L.value}s · ${colPts(col, L.col, s.gold)}`); log('triple'); sfx('win'); } else sfx('good');
        await sleep(rm ? 40 : 420);
      } else {
        draw(s.grids);
        await sleep(rm ? 20 : 120);
      }
      if (L.comeback) {
        stamp('Comeback!', true); log('comeback'); sfx('good');
        await sleep(rm ? 60 : 500);
      } else if (L.wipe || L.triple) await sleep(rm ? 60 : 380);
    }

    // ── sync the view to the rules state ──
    let chain = Promise.resolve();
    function enqueue(fn) {
      chain = chain.then(() => (dead ? null : fn())).catch((e) => { if (e !== DEAD) console.error('[bones]', e); });
    }
    let seenTw = null; // the twist this view has already announced ('' = classic, null = nothing seen yet)
    function announceTwist(c, s) {
      const now = s.tw || '';
      const prev = seenTw;
      seenTw = now;
      setBadge(s);
      if (prev === null || prev === now) return; // first look, or nothing new
      if (now === 'blind') dieN = -1; // the first die the starter watched was thrown away: roll the real one when it lands
      if (now && now !== 'classic' && !(c.mode === 'online' && s.first === c.me)) {
        // online: the partner is told who picked what and how it plays. Same phone: whoever tapped knows what they
        // picked, so the toast is just the rule for the person next to them.
        const msg = c.mode === 'local' ? `${TWISTS[now].name}: ${TWISTS[now].hint}` : `${api.name(s.first)} picked ${TWISTS[now].name}. ${TWISTS[now].hint}`;
        api.toast(msg);
        log(`picked:${now}`);
        log(`toast:${msg}`);
      }
    }
    async function sync() {
      animating = true;
      showPicker(false);
      for (;;) {
        const c = ctxNow;
        if (dead || !c || !c.state) return;
        const s = c.state;
        if (c.moves === shownMoves) break;
        const first = shownMoves < 0;
        const L = s.last;
        picking = false;
        announceTwist(c, s);
        if (!L || c.moves < shownMoves) {
          draw(s.grids);
          shownMoves = c.moves;
          continue;
        }
        const replay = !first || c.mode === 'local' || L.who !== c.me;
        if (!replay) { draw(s.grids); shownMoves = c.moves; continue; }
        const pre = preGrids(s);
        // this move was drawn already when the column was picked: keep that picture, don't redraw the tray
        const o = opt && opt.n === L.n && opt.who === L.who && opt.col === L.col ? opt : null;
        opt = null;
        if (!o) draw(pre, { noTurn: true });
        await ready;
        if (dieN !== L.n) {
          if (first) await sleep(reduced() ? 0 : 250);
          await roll(L.value, L.who, L.n);
          await sleep(reduced() ? 60 : 350);
        }
        await place(L, pre, s, o);
        shownMoves = c.moves;
      }
      const c = ctxNow;
      const s = c.state;
      announceTwist(c, s);
      await ready;
      if (c.over) { await finale(c); return; }
      if (dieN !== s.n && !isBlind()) await roll(s.roll, s.turn, s.n);
      if (ctxNow !== c && ctxNow.moves !== shownMoves) return; // a newer move is queued
      showIdle();
    }
    /** What picking a column here would do: your column's gain and their column's loss. */
    function previews(s, actor) {
      const gold = s.gold;
      const opp = other(actor);
      const soft = s.final && s.tw !== 'mirror';
      const gain = [0, 0, 0]; const loss = [0, 0, 0];
      for (let ci = 0; ci < COLS; ci++) {
        const mine = s.grids[actor][ci];
        if (mine.length >= ROWS) continue;
        gain[ci] = colPts(mine.concat(s.roll), ci, gold) - colPts(mine, ci, gold);
        if (!soft) {
          const oc = s.grids[opp][ci];
          loss[ci] = -(colPts(oc, ci, gold) - colPts(oc.filter((v) => v !== s.roll), ci, gold));
        }
      }
      return { gain, loss };
    }
    function showPicker(on, actor) {
      for (const k of ['top', 'bot']) {
        const el2 = halves[k].querySelector('.gb-picker');
        const target = on && halves[k].dataset.who === other(actor);
        if (target && el2.hidden) el2.innerHTML = pickerHTML();
        el2.hidden = !target;
      }
      root.classList.toggle('has-picker', !!on);
    }
    function showIdle() {
      const c = ctxNow;
      if (!c || !c.state || c.over) return;
      if (opt) { if (performance.now() - opt.at < 3000) return; opt = null; } // a placement is on its way in: leave the picture alone
      const s = c.state;
      const blind = s.tw === 'blind';
      setBadge(s);
      picking = !!c.canMove && (blind || dieN === s.n);
      const actor = s.turn;
      let threat = null;
      let pv = null;
      if (picking && !blind) {
        const cols = [0, 1, 2].filter((i) => s.grids[actor][i].length < ROWS);
        const soft = s.final && s.tw !== 'mirror';
        threat = soft ? null : { who: other(actor), value: s.roll, cols };
        pv = previews(s, actor);
      }
      draw(s.grids, picking ? { pick: actor, roll: s.roll, threat, pv, blind } : {});
      if (blind) {
        if (dv) { dv.hide(true); kick(); }
        band.dataset.roll = '';
        setMystery(true);
        setBand('mystery', actor, 0);
      } else setBand(picking ? 'pick' : 'wait', actor, s.roll);
      showPicker(picking && s.n === 0 && s.tw === undefined, actor);
      root.dataset.phase = picking ? 'pick' : 'wait';
      animating = false;
      skipping = false;
      if (dv3 && !$('.gb-die2d').querySelector('.gb-die')) redrawDie(); // flat dice standing in for a lost 3D view
    }
    /** Records and rivalry: fold this match into the shared per-game data (once; both phones agree). */
    let recap = null;
    function recordMatch(c) {
      const s = c.state;
      if (recap) return;
      try {
        // turn games don't get data() on their api (live games do): the shared store is the same one
        const store = typeof api.data === 'function' && typeof api.setData === 'function' ? api : gameDataApi('bones');
        const r = c.result || result(s);
        const rec = recordsFor(store.data() || {}, s, r, c.matchId);
        if (rec.patch) store.setData(rec.patch);
        recap = rec;
        log(`records:${rec.flags || '-'}`);
      } catch (err) { console.warn('[bones] records', err); }
    }
    const nameFor = (w) => (w === 'a' || w === 'b' ? (whoLabel(w) === 'You' ? 'You' : api.name(w)) : '');
    async function finale(c) {
      const s = c.state;
      root.dataset.phase = 'over';
      draw(s.grids, { noTurn: true });
      if (!finaleDone) setBand('over'); // (a second look at the finished match must not wipe the recap)
      setMystery(false);
      showPicker(false);
      dv.hide(true);
      kick();
      if (finaleDone) { animating = false; skipping = false; return; }
      finaleDone = true;
      log('finale');
      const r = c.result || result(s);
      for (const [k, w] of [['top', topW], ['bot', bottom]]) {
        halves[k].classList.toggle('is-win', r.winner === w);
        halves[k].classList.toggle('is-lose', !!r.winner && r.winner !== w);
      }
      const sc = score(s);
      band.classList.add('is-final');
      const streakLine = recap && recap.streak && recap.streak.len >= 2 && (recap.streak.who === 'a' || recap.streak.who === 'b')
        ? `${nameFor(recap.streak.who)} ${nameFor(recap.streak.who) === 'You' ? 'have' : 'has'} won ${recap.streak.len} straight` : '';
      const nmW = r.winner ? (whoLabel(r.winner) === 'You' ? 'You win' : `${api.name(r.winner)} wins`) : 'Dead even';
      labL.innerHTML = `<span class="gb-kick">Final</span><span class="gb-wn gb-big"></span><span class="gb-streak"></span>`;
      labL.querySelector('.gb-wn').textContent = nmW;
      labL.querySelector('.gb-streak').textContent = streakLine;
      labR.innerHTML = (r.winner ? `<span class="gb-by"><span class="gb-kick">by</span><b class="gb-big">${Math.abs(sc.a - sc.b)}</b></span>` : `<b>${sc.a} apiece</b>`) + formHTML(recap && recap.form);
      // new records get a stamp each (over the trays: the recap in the band stays readable), then the end card
      const flags = recap && recap.flags ? recap.flags.split(',').filter(Boolean) : [];
      const lines = [];
      for (const f of flags) {
        if (f === 'pb_a' || f === 'pb_b') lines.push(`New best: ${sc[f.slice(3)]}${ctxNow.mode === 'online' && f.slice(3) === c.me ? '' : ` for ${api.name(f.slice(3))}`}`);
        else if (f === 'smash') lines.push('Biggest smash ever');
        else if (f === 'comeback') lines.push('Biggest comeback');
      }
      if (lines[0]) { stamp(lines[0], false, 'top'); sfx('good'); }
      if (lines[1]) {
        await sleep(reduced() ? 100 : 450);
        stamp(lines[1], true, 'bot'); sfx('good');
      }
      // The band's recap (winner, streak, form) and the stamps get ~1.7 s before the end card covers them.
      // Total from the last move stays well under core's 8 s safety net.
      await sleep(reduced() ? 250 : lines[1] ? 1250 : 1700);
      animating = false;
      skipping = false;
      api.showEnd();
    }

    // ── input ──
    function pick(col) {
      const c = ctxNow;
      if (!picking || !c || !c.canMove || c.over) return;
      const g = c.state.grids[c.actor] && c.state.grids[c.actor][col];
      if (!g) return;
      if (g.length >= ROWS) {
        api.toast('That column is full');
        sfx('bad');
        const b = root.querySelector(`.gb-tray.is-picking .gb-col[data-col="${col}"]`);
        if (b) { b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope'); setTimeout(() => b.classList.remove('nope'), 420); }
        log('full');
        return;
      }
      picking = false;
      root.dataset.phase = 'busy';
      sfx('tap');
      const s = c.state;
      const actor = c.actor;
      const mine = dv && !isBlind() && dieN === s.n && shownMoves === c.moves;
      if (!mine) { // blind draws tumble in as they land, so there is nothing to show yet: plain path
        const r = api.move({ col });
        if (!r.ok) { api.toast(r.error); showIdle(); }
        return;
      }
      // Show the placement NOW, on this frame, and let the engine catch up on the next one: api.move replays the whole
      // match twice and writes it out (tens of ms on a phone), and the tray used to wait for all of that.
      const value = s.roll;
      animating = true;
      log('place');
      labR.innerHTML = `<b>Rolled ${value}</b><span>Column ${col + 1}</span>`;
      const hidden = dv.hide(reduced() || skipping);
      kick();
      const mid = cloneGrids(s.grids);
      mid[actor][col].push(value);
      draw(mid, { newAt: { who: actor, col }, bump: { who: actor, col }, noTurn: true, only: actor });
      sfx('place');
      api.haptic(10);
      opt = { n: s.n, who: actor, col, value, hidden, at: performance.now() };
      const mark = opt;
      let fired = false;
      const fire = () => {
        if (fired) return;
        fired = true;
        clearTimeout(backup);
        if (dead) return;
        const r = api.move({ col });
        if (!r.ok) { // can't happen (the engine accepted the same move a moment ago), but put the board back if it does
          if (opt === mark) opt = null;
          api.toast(r.error);
          animating = false; skipping = false;
          showIdle();
          redrawDie();
        }
      };
      const backup = setTimeout(fire, 120); // a hidden page gets no animation frames
      requestAnimationFrame(() => setTimeout(fire, 0)); // after this frame has been painted
    }
    function sendTwist(id) {
      const c = ctxNow;
      if (!picking || !c || !c.canMove || c.over || !TWIST_IDS.includes(id)) return;
      const s = c.state;
      if (s.n !== 0 || s.tw !== undefined) return;
      picking = false;
      root.dataset.phase = 'busy';
      sfx('tap');
      saveTwist(id);
      showPicker(false);
      const r = api.move({ tw: id });
      if (!r.ok) { api.toast(r.error); showIdle(); }
    }
    // Pressing a pickable column shows it pressed at once (no preventDefault: iOS needs the click for everything else).
    // The pick itself goes on finger-up on the same column, a few ms ahead of the click, which is then ignored.
    let pressEl = null;
    let tapAt = 0;
    function clearPress() { if (pressEl) { pressEl.classList.remove('is-press'); pressEl = null; } }
    function onPointerDown(e) {
      const b = e.target && e.target.closest ? e.target.closest('.gb-col.can') : null;
      if (!b || !root.contains(b) || !picking) return;
      const tray = b.closest('.gb-tray');
      if (!tray || !tray.classList.contains('is-picking')) return;
      clearPress();
      b.classList.add('is-press');
      pressEl = b;
      log(`press:${b.dataset.col}`);
      const t = T();
      if (t) t.pressed = Number(b.dataset.col);
    }
    function onPointerUp(e) {
      const b = pressEl;
      if (!b) return;
      clearPress();
      if (e.button > 0 || e.isPrimary === false || !b.isConnected) return;
      const at = document.elementFromPoint(e.clientX, e.clientY);
      if (!at || !b.contains(at)) return; // the finger slid off the column
      tapAt = performance.now();
      pick(Number(b.dataset.col));
    }
    function onClick(e) {
      const pk = e.target.closest('.gb-pk');
      if (pk && root.contains(pk)) { sendTwist(pk.dataset.tw); return; }
      const b = e.target.closest('.gb-col');
      if (!b || !root.contains(b)) return;
      if (e.detail > 0 && tapAt && performance.now() - tapAt < 500) return; // that tap was picked on finger-up already
      const tray = b.closest('.gb-tray');
      if (!tray || !tray.classList.contains('is-picking')) return;
      pick(Number(b.dataset.col));
    }
    function onKey(e) {
      if (e.repeat || !/^[1-3]$/.test(e.key) || !root.isConnected) return;
      const tgt = e.target;
      if (tgt && tgt.closest && tgt.closest('input, textarea, select, [contenteditable]')) return;
      const gm = root.closest('.gm');
      if (gm && gm.querySelector('.gm-sheet:not([hidden]), .gm-end:not([hidden]), .gm-curtain:not([hidden])')) return;
      if (!picking) return;
      e.preventDefault();
      pick(Number(e.key) - 1);
    }
    let unlocked = false;
    function onTouchEnd() { if (!unlocked) { unlocked = true; sfx('tick'); } } // iOS: unlock audio inside a gesture
    function onBandTouch(e) { e.preventDefault(); }
    // a tap anywhere on the stage (but a column) while dice are tumbling or smashing skips ahead
    function onStageDown(e) {
      if (!animating || picking || (e.target.closest && e.target.closest('.gb-col.can'))) return;
      skipNow();
    }
    el.addEventListener('pointerdown', onStageDown);
    root.addEventListener('click', onClick);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', clearPress);
    root.addEventListener('touchend', onTouchEnd);
    band.addEventListener('touchstart', onBandTouch, { passive: false });
    band.addEventListener('touchmove', onBandTouch, { passive: false });
    document.addEventListener('keydown', onKey);

    // ── environment ──
    function onTheme() {
      pal = readPalette(api);
      if (dv) { dv.setPalette(pal); setSides(); renderNow(); }
    }
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onTheme);
    const mo = new MutationObserver(onTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    function onVis() {
      paused = document.hidden;
      if (paused) { if (raf) cancelAnimationFrame(raf); raf = 0; }
      else { lastT = 0; renderNow(); kick(); }
    }
    document.addEventListener('visibilitychange', onVis);
    // A lost context stops every frame, so a roll or a hide that is waiting for its last frame would wait for ever.
    // Give the browser a moment to restore it; if it doesn't, play on with the flat dice (and go back to 3D if it
    // does come back later).
    const GL_GRACE_MS = 3000;
    let lostT = 0;
    let dv3 = null; // the 3D view, parked while flat dice are standing in for it
    /** Put the current die (if one is showing) back on whichever view is live. */
    function redrawDie() {
      const c = ctxNow;
      const s = c && c.state;
      if (!dv || !s || s.over || animating || isBlind() || dieN !== s.n) return;
      const yaw = (api.rand(s.seed, 'yaw', s.n) - 0.5) * 0.9;
      dv.roll(s.roll, s.turn === topW ? 'top' : 'bot', yaw, true);
      kick();
    }
    function glToFlat() {
      if (dead || !dv || dv.kind !== '3d' || !glLost) return;
      log('gl-flat');
      dv3 = dv;
      try { dv3.abort(); } catch (err) { console.warn('[bones] abort', err); }
      canvas.hidden = true;
      band.dataset.gl = '2d';
      dv = dieView2D($('.gb-die2d'));
      glLost = false;
      setSides();
      redrawDie();
    }
    function onLost(e) {
      e.preventDefault();
      glLost = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      band.dataset.gl = 'lost';
      clearTimeout(lostT);
      lostT = setTimeout(glToFlat, (T() && T().glGraceMs) || GL_GRACE_MS);
    }
    function onRestored() {
      clearTimeout(lostT);
      setTimeout(() => { // three.js re-creates its GL state in its own listener first
        if (dead) return;
        if (dv3) { // back from flat dice
          try { dv3.restore(); } catch (err) { console.warn('[bones] restore', err); dv3 = null; return; }
          try { dv.dispose(); } catch { /* ignore */ }
          $('.gb-die2d').hidden = true;
          dv = dv3; dv3 = null;
          canvas.hidden = false;
          setSides();
          dv.resize(band.clientWidth, band.clientHeight);
        } else if (dv) {
          try { dv.restore(); } catch (err) { console.warn('[bones] restore', err); }
        } else return;
        glLost = false;
        band.dataset.gl = 'ok';
        log('restored');
        lastT = 0;
        renderNow();
        redrawDie();
        kick();
      }, 0);
    }
    function useView(v) {
      clearTimeout(slowT);
      dv = v;
      setSides();
      if (dv.setZoom) dv.setZoom(root.classList.contains('is-land') ? 1.75 : 1);
      dv.resize(band.clientWidth, band.clientHeight);
      try { dv.compile(); } catch (err) { console.warn('[bones] warm-up', err); }
      renderNow();
      readyRes();
    }
    function fallback(note) {
      canvas.hidden = true;
      band.dataset.gl = '2d';
      useView(dieView2D($('.gb-die2d')));
      if (note) api.toast(note);
    }
    // A CDN that never answers would leave the game waiting for its dice forever: after a while,
    // play on with flat dice (and ignore three.js if it turns up later).
    const slowT = setTimeout(() => { if (!dead && !dv) fallback('The 3D dice are slow to load, so these are flat ones.'); }, (T() && T().slowMs) || SLOW_3D_MS);
    threeP.then((THREE) => {
      if (dead || dv) return;
      let v;
      try { v = dieView3D(THREE, canvas, pal, impactSound); } catch (err) {
        console.warn('[bones] WebGL unavailable', err);
        fallback('3D dice aren’t available here, so these are flat ones.');
        return;
      }
      canvas.addEventListener('webglcontextlost', onLost, false);
      canvas.addEventListener('webglcontextrestored', onRestored, false);
      band.dataset.gl = 'ok';
      useView(v);
    }, () => {
      if (dead || dv) return;
      fallback('Couldn’t load the 3D dice, so these are flat ones.');
    });

    return {
      update(c) {
        ctxNow = c;
        if (!c || !c.state) return;
        if (openedOver === null) openedOver = !!c.over;
        // The match just ended on this phone: write the records now, before any animation, so a mover who
        // leaves during the finale still counts it (idempotent per match via last_id).
        if (c.over && !openedOver && !recap) recordMatch(c);
        if (c.mode === 'online' && c.me && c.me !== bottom) { bottom = c.me; topW = other(bottom); setSides(); }
        enqueue(sync);
      },
      destroy() {
        dead = true;
        clearTimeout(slowT);
        clearTimeout(lostT);
        clearTimeout(bandT);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        ro.disconnect();
        mo.disconnect();
        mq.removeEventListener('change', onTheme);
        document.removeEventListener('visibilitychange', onVis);
        document.removeEventListener('keydown', onKey);
        root.removeEventListener('click', onClick);
        root.removeEventListener('pointerdown', onPointerDown);
        root.removeEventListener('pointerup', onPointerUp);
        root.removeEventListener('pointercancel', clearPress);
        el.removeEventListener('pointerdown', onStageDown);
        window.removeEventListener('resize', layout);
        root.removeEventListener('touchend', onTouchEnd);
        band.removeEventListener('touchstart', onBandTouch);
        band.removeEventListener('touchmove', onBandTouch);
        canvas.removeEventListener('webglcontextlost', onLost, false);
        canvas.removeEventListener('webglcontextrestored', onRestored, false);
        if (dv) { try { dv.dispose(); } catch (err) { console.warn('[bones] dispose', err); } }
        if (dv3) { try { dv3.dispose(); } catch { /* ignore */ } }
        dv = dv3 = null;
      },
    };
  },
});
