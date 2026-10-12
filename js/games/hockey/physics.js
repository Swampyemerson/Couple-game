// Air Hockey physics: pure functions shared by the host's simulation, the one-phone game and the
// guest's prediction. Table units: 100 wide, 170 long. 'a' defends y = H (bottom), 'b' defends y = 0.
export const W = 100;          // table width
export const H = 170;          // table length
export const RM = 7.5;         // mallet radius
export const RP = 4.6;         // puck radius
export const GH = 16;          // goal half-width (Classic)
export const GH_MIN = 10;      // Shrinking Goals never goes below this
export const POST_R = 6.5;     // the Pillar's radius
export const DT = 1 / 120;     // fixed physics step
export const PUCK_MAX = 300;   // units/s (2.5 units per step: no tunnelling through a 12-unit contact)
export const MALLET_MAX = 440; // how fast a mallet may chase a finger. Above PUCK_MAX on purpose: see transferScale
export const WALL_E = 0.86;    // wall restitution
export const MALLET_E = 0.8;   // mallet restitution
export const FRICTION = 0.28;  // 1/s, exponential
export const SERVE_V = 42;
export const POST_NEAR = 6;    // a bounce this close to the goal mouth is a "POST!"

// ── the power curve ──
// Before: the whole of the mallet's speed bounced into the puck (x1.8), so a lazy 167 u/s swipe
// already hit the 300 cap and every shot felt the same. Now the impulse a *moving* mallet gives is
// scaled down with the mallet's speed (a still mallet still bounces the puck back at full
// restitution): puck speed ~ 0.9 x mallet speed for anything past a gentle push, so a slow push is a
// soft pass and the cap needs a real flick of about 330 u/s (about 2x the old saturating speed).
export const SLAP_V = 330;     // mallet speed (u/s) that reaches the cap
const SOFT_V = 60;             // below this the mallet is still "gentle": full bounce fades out by here
export function transferScale(mn) {
  if (mn <= 0) return 1;
  return mn >= SOFT_V ? 0.5 : 1 - (0.5 * mn) / SOFT_V;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const r1 = (v) => Math.round(v * 10) / 10;
export const other = (w) => (w === 'a' ? 'b' : 'a');

// ── tables ──
export const TABLE_ORDER = ['classic', 'pillar', 'twin', 'shrink', 'power', 'quick'];
export const TABLES = {
  classic: { id: 'classic', name: 'Classic', blurb: 'Plain table. First to 7.', toWin: 7, pucks: 1 },
  pillar: { id: 'pillar', name: 'Pillar', blurb: 'A post in the middle. Bank it.', toWin: 7, pucks: 1, post: true },
  twin: { id: 'twin', name: 'Twin Pucks', blurb: 'Two pucks. Either one scores.', toWin: 7, pucks: 2 },
  shrink: { id: 'shrink', name: 'Shrinking Goals', blurb: 'Score and their goal gets smaller.', toWin: 7, pucks: 1, shrink: true },
  power: { id: 'power', name: 'Power Puck', blurb: 'Every rally hit makes it faster.', toWin: 7, pucks: 1, power: true },
  quick: { id: 'quick', name: 'Quick', blurb: 'Sudden death. First to 3.', toWin: 3, pucks: 1 },
};
export const tableOf = (id) => TABLES[id] || TABLES.classic;

/** The world a table plays in: goal widths, the post, the speed cap. Mutated as the score changes. */
export function newEnv(table, score) {
  const env = { post: !!table.post, shrink: !!table.shrink, power: !!table.power, ghA: GH, ghB: GH, cap: table.power ? PUCK_MAX * 1.25 : PUCK_MAX };
  setGoals(env, score);
  return env;
}
/** Each goal YOU score makes your OPPONENT's goal 2 units narrower (half-width, never below GH_MIN). */
export function setGoals(env, score) {
  if (!env.shrink) { env.ghA = GH; env.ghB = GH; return; }
  env.ghA = Math.max(GH_MIN, GH - 2 * (score ? score.b : 0)); // 'a' defends the bottom goal; 'b' scoring shrinks it
  env.ghB = Math.max(GH_MIN, GH - 2 * (score ? score.a : 0));
}
export const goalHalf = (env, w) => (w === 'a' ? env.ghA : env.ghB);

// ── collisions ──
function bouncePoint(p, px, py, R = RP) {
  const dx = p.x - px; const dy = p.y - py; const d2 = dx * dx + dy * dy;
  if (d2 >= R * R || d2 < 1e-9) return false;
  const d = Math.sqrt(d2); const nx = dx / d; const ny = dy / d;
  p.x = px + nx * R; p.y = py + ny * R;
  const vn = p.vx * nx + p.vy * ny;
  if (vn < 0) { p.vx -= (1 + WALL_E) * vn * nx; p.vy -= (1 + WALL_E) * vn * ny; return true; }
  return false;
}
export const HIT_WALL = 1;
export const HIT_PILLAR = 2;
export const HIT_FRAME = 4;

/** Rails, goal posts, goal pockets and the Pillar. Returns a mask of HIT_* bits (0 = no bounce). */
export function walls(p, env) {
  let hit = 0;
  const gh = p.y < H / 2 ? env.ghB : env.ghA;
  if (p.x < RP) { p.x = RP; if (p.vx < 0) { p.vx = -p.vx * WALL_E; p.vy *= 0.98; hit |= HIT_WALL; } }
  else if (p.x > W - RP) { p.x = W - RP; if (p.vx > 0) { p.vx = -p.vx * WALL_E; p.vy *= 0.98; hit |= HIT_WALL; } }
  if (Math.abs(p.x - W / 2) >= gh) {
    if (p.y < RP) { p.y = RP; if (p.vy < 0) { p.vy = -p.vy * WALL_E; p.vx *= 0.98; hit |= Math.abs(p.x - W / 2) - gh < POST_NEAR ? HIT_FRAME : HIT_WALL; } }
    else if (p.y > H - RP) { p.y = H - RP; if (p.vy > 0) { p.vy = -p.vy * WALL_E; p.vx *= 0.98; hit |= Math.abs(p.x - W / 2) - gh < POST_NEAR ? HIT_FRAME : HIT_WALL; } }
  } else if (p.y < RP || p.y > H - RP) {
    for (const py of [0, H]) for (const px of [W / 2 - gh, W / 2 + gh]) if (bouncePoint(p, px, py)) hit |= HIT_FRAME;
    if (p.y < 0 || p.y > H) p.x = clamp(p.x, W / 2 - gh + RP, W / 2 + gh - RP);
  }
  if (env.post && bouncePoint(p, W / 2, H / 2, POST_R + RP)) hit |= HIT_PILLAR;
  return hit;
}

export function clampMallet(m, env) {
  m.x = clamp(m.x, RM, W - RM);
  m.y = m.who === 'a' ? clamp(m.y, H / 2 + RM, H - RM) : clamp(m.y, RM, H / 2 - RM);
  if (env && env.post) pushFromPost(m);
}
export function clampTarget(who, x, y, env) {
  const o = { who, x: clamp(x, RM, W - RM), y: who === 'a' ? clamp(y, H / 2 + RM, H - RM) : clamp(y, RM, H / 2 - RM) };
  if (env && env.post) pushFromPost(o);
  return [o.x, o.y];
}
/** A mallet can't sit on the Pillar: slide it round the post, staying on its own half. */
function pushFromPost(m) {
  const R = RM + POST_R;
  const dx = m.x - W / 2; const dy = m.y - H / 2; const d = Math.hypot(dx, dy);
  if (d >= R) return;
  const nx = d > 1e-6 ? dx / d : 0; const ny = d > 1e-6 ? dy / d : m.who === 'a' ? 1 : -1;
  m.x = W / 2 + nx * R; m.y = H / 2 + ny * R;
  m.x = clamp(m.x, RM, W - RM);
  m.y = m.who === 'a' ? clamp(m.y, H / 2 + RM, H - RM) : clamp(m.y, RM, H / 2 - RM);
  // still inside (pinned in a corner of the clamp): go straight out along the centre line
  if (Math.hypot(m.x - W / 2, m.y - H / 2) < R - 0.01) m.y = m.who === 'a' ? H / 2 + Math.sqrt(Math.max(0, R * R - (m.x - W / 2) ** 2)) : H / 2 - Math.sqrt(Math.max(0, R * R - (m.x - W / 2) ** 2));
}

/** Puck vs a kinematic mallet (infinite mass). A still mallet bounces the puck back at full
 *  restitution; a moving one hands over its speed through transferScale. Returns impact speed. */
export function collideMallet(p, m) {
  const dx = p.x - m.x; const dy = p.y - m.y; const R = RM + RP;
  const d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return 0;
  const d = Math.sqrt(d2);
  let nx; let ny;
  if (d < 1e-6) { nx = 0; ny = m.who === 'a' ? -1 : 1; } else { nx = dx / d; ny = dy / d; }
  p.x = m.x + nx * R; p.y = m.y + ny * R;
  const vn = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
  if (vn < 0) {
    const s = transferScale(m.vx * nx + m.vy * ny);
    p.vx -= (1 + MALLET_E) * s * vn * nx; p.vy -= (1 + MALLET_E) * s * vn * ny;
    return -vn;
  }
  return 0.001;
}
/** The puck is pinned against a rail or the post: push the mallet back instead of through the puck. */
export function unsqueeze(p, m, env) {
  const dx = m.x - p.x; const dy = m.y - p.y; const R = RM + RP; const d = Math.hypot(dx, dy);
  if (d >= R - 0.01) return;
  const nx = d > 1e-6 ? dx / d : 0; const ny = d > 1e-6 ? dy / d : m.who === 'a' ? 1 : -1;
  m.x = p.x + nx * R; m.y = p.y + ny * R;
  clampMallet(m, env);
}
/** Track how fast the player's hand (the mallet's target) is moving, with a short peak hold. */
export function trackHand(m, dt) {
  if (m.ptx === undefined) { m.ptx = m.tx; m.pty = m.ty; m.hand = 0; }
  const sp = dt > 0 ? Math.hypot(m.tx - m.ptx, m.ty - m.pty) / dt : 0;
  m.hand = Math.max(sp, m.hand * Math.exp(-dt / 0.1));
  m.ptx = m.tx; m.pty = m.ty;
}
/** A mallet hits only as hard as the hand behind it moves: when it snaps back after being
 *  pushed off the puck (pinned on a rail, or released at the serve) it nudges, not slams. */
export function capToHand(m) {
  const sp = Math.hypot(m.vx, m.vy); const cap = Math.max(25, m.hand * 1.25);
  if (sp > cap) { m.vx *= cap / sp; m.vy *= cap / sp; }
}

/** One fixed step for one puck. Returns { mask, goal } where goal is the scorer ('a' scores in the top
 *  goal). onHit(m, impact, p) runs on every mallet contact. ts < 1 is slow motion (the puck only). */
export function stepPuck(p, mallets, onHit, hold, env, ts = 1) {
  const f = Math.exp(-FRICTION * DT * ts);
  p.vx *= f; p.vy *= f;
  p.x += p.vx * DT * ts; p.y += p.vy * DT * ts;
  let mask = walls(p, env);
  for (const m of mallets) {
    const imp = collideMallet(p, m);
    if (imp > 0) {
      if (onHit) onHit(m, imp, p);
      const w = walls(p, env);
      if (w) { mask |= w; unsqueeze(p, m, env); }
    }
  }
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > env.cap) { p.vx *= env.cap / sp; p.vy *= env.cap / sp; }
  let goal = p.y < -RP ? 'a' : p.y > H + RP ? 'b' : null;
  if (goal && hold) { p.y = goal === 'a' ? -RP : H + RP; p.vx = 0; p.vy = 0; goal = null; }
  return { mask, goal };
}
