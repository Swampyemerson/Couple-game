// Rail Rush runner simulation (pure, fixed step, no DOM) and a perfect-information bot.
// Each device simulates only its own runner(s); the partner is drawn from the network.
import {
  DT, LANE_W, LANE_TIME, GRAV, JUMP_V, SUPER_JUMP_V, HANG_V, HANG_G, FASTFALL_V, SLIDE_TIME,
  BUFFER_T, COYOTE_T, STAND_H, ROLL_H, HALF_D, HALF_W, STEP_UP, TRIP_TOL, CHUNK, LOW_H,
  STUMBLE_T, CRASH_T, INVULN_T, HEARTS, MAGNET_T, SNEAKERS_T, LATE_DODGE_T, COMBO_TIERS, COMBO_BONUS, baseSpeed,
} from './tune.js';
import {
  O_LOW, O_HIGH, O_TRAIN, O_RAMP, O_MTRAIN, O_BLOCK, I_MAGNET, I_SNEAKERS, I_SHIELD, I_BOX,
  rampTop, createTrack,
} from './track.js';

export const A_LEFT = 1;
export const A_RIGHT = 2;
export const A_UP = 3;
export const A_DOWN = 4;

// Events a step can emit (drained by the game each frame).
export const E_JUMP = 1;
export const E_LAND = 2;
export const E_ROLL = 3;
export const E_LANE = 4;
export const E_COIN = 5;
export const E_PICK = 6;
export const E_STUMBLE = 7;
export const E_CRASH = 8;
export const E_RESPAWN = 9;
export const E_SHIELD = 10;
export const E_CLOSE = 11;
export const E_COMBO = 12;
export const E_FINISH = 13;
export const E_SMASH = 14;
export const E_TOKEN = 15;
export const E_BLOCK = 16;
export const E_BUMP = 17;
export const E_TRIP = 18;
export const E_SLAM = 19;
export const E_BONUS = 20;   // combo tier reached: val = coins awarded
export const E_CLIP = 21;    // a late dodge clipped the obstacle (stumble, not crash)

// Crash causes
export const C_HIT = 1;
export const C_FALL = 2;
export const C_SLAM = 3;
export const C_FORCED = 4;

const K_SPEED = 1 - Math.exp(-DT * 4);

/** A fresh runner in a lane (-1, 0, 1). */
export function newRunner(lane = 0) {
  const r = {
    t: 0, z: 0, zPrev: 0,
    lane, laneFrom: lane, x: lane * LANE_W, xFrom: lane * LANE_W, laneT: 1, laneAge: 9,
    y: 0, vy: 0, grounded: 1, coyote: 0, fastFall: 0, rollOnLand: 0, sup: 0, airT: 0,
    slideT: 0, slideAge: 9,
    speed: 12.5, catchup: 0, draft: 0, shoveT: 0,
    stumbleT: 0, bounceT: 0, bumpT: 0,
    down: 0, downT: 0, hold: 0, out: 0, cause: 0,
    invulnT: 0, hearts: HEARTS, coins: 0,
    magnetT: 0, sneakersT: 0, shield: 0, boostT: 0,
    bufA: 0, bufT: 0,
    fin: -1, finLen: 0, done: 0,
    crashes: 0, stumbles: 0, combo: 0, comboT: 0, maxCombo: 0, closeCalls: 0, jumps: 0, rolls: 0, shields: 0, clips: 0, bonus: 0,
    hitT: 0, hitOv: 0, hitY: 0, // what the last crash hit (telemetry)
    ignoreId: -1, ignoreT: 0,
    tandem: 0, zapT: 0, zapDir: 0, smashN: 0,
  };
  r.taken = new Set();
  r.smashed = new Set();
  r.extra = [];   // dynamic obstacles (roadblocks), sorted by z0
  r.tokens = [];  // revive tokens { id, x, z, y, alive }
  r.evT = new Int16Array(96);
  r.evV = new Float64Array(96);
  r.evN = 0;
  return r;
}

const NUM_KEYS = Object.keys(newRunner(0)).filter((k) => typeof newRunner(0)[k] === 'number');

/** Copy the numeric state (used by the bot's look-ahead); shared references stay shared. */
export function copyRunner(dst, src) {
  for (let i = 0; i < NUM_KEYS.length; i++) dst[NUM_KEYS[i]] = src[NUM_KEYS[i]];
  dst.taken = src.taken; dst.smashed = src.smashed; dst.extra = src.extra; dst.tokens = src.tokens;
  return dst;
}

function ev(r, t, v) {
  if (r.evN < 96) { r.evT[r.evN] = t; r.evV[r.evN] = v; r.evN++; }
}

/** Queue or perform an input. Returns true if it was used now. */
export function act(r, a) {
  if (tryAct(r, a, false)) return true;
  r.bufA = a; r.bufT = BUFFER_T;
  return false;
}

function tryAct(r, a, dry) {
  if (r.down || r.done) return true;
  if (a === A_LEFT || a === A_RIGHT) {
    const dir = a === A_LEFT ? -1 : 1;
    const nl = r.lane + dir;
    if (nl < -1 || nl > 1) { r.bumpT = 0.18 * dir; if (!dry) ev(r, E_BUMP, dir); return true; }
    r.laneFrom = r.lane; r.lane = nl; r.xFrom = r.x; r.laneT = 0; r.laneAge = 0;
    if (!dry) ev(r, E_LANE, dir);
    return true;
  }
  if (a === A_UP) {
    if (r.grounded || r.coyote > 0) {
      r.vy = r.sneakersT > 0 ? SUPER_JUMP_V : JUMP_V;
      r.grounded = 0; r.coyote = 0; r.slideT = 0; r.fastFall = 0; r.rollOnLand = 0; r.airT = 0; r.jumps++;
      if (!dry) ev(r, E_JUMP, r.sneakersT > 0 ? 1 : 0);
      return true;
    }
    return false;
  }
  if (a === A_DOWN) {
    if (r.grounded) {
      r.slideT = SLIDE_TIME; r.slideAge = 0; r.rolls++;
      if (!dry) ev(r, E_ROLL, 0);
      return true;
    }
    if (r.vy > FASTFALL_V) r.vy = FASTFALL_V;
    r.fastFall = 1; r.rollOnLand = 1;
    return true;
  }
  return true;
}

function stumble(r, k, dry) {
  r.stumbleT = STUMBLE_T * (k || 1);
  r.stumbles++;
  r.combo = 0;
  if (!dry) ev(r, E_STUMBLE, k || 1);
}

/** Knock the runner down (cause: C_*). Shield absorbs it. */
export function crash(r, cause, dry) {
  if (r.down) return;
  if (r.shield) {
    r.shield = 0; r.shields++; r.invulnT = 1.0;
    stumble(r, 0.8, dry);
    if (!dry) ev(r, E_SHIELD, cause);
    return;
  }
  r.down = 1; r.downT = 0; r.crashes++; r.combo = 0; r.slideT = 0; r.cause = cause;
  r.speed = cause === C_FALL ? 0 : -3;
  if (cause !== C_FALL) { r.vy = 5.5; r.grounded = 0; }
  if (!r.tandem) {
    r.hearts--;
    if (r.hearts <= 0) { r.hearts = 0; r.out = 1; r.hold = 1; }
  } else r.hold = 1;
  if (!dry) ev(r, E_CRASH, cause);
}

function overGap(track, x, z) {
  const c = track.chunk(Math.floor(z / CHUNK));
  if (!c.gaps.length) return null;
  const lane = Math.round(x / LANE_W);
  const bit = 1 << (lane + 1);
  const gs = c.gaps;
  for (let i = 0; i < gs.length; i++) { const g = gs[i]; if (z >= g.z0 && z <= g.z1 && (g.mask & bit)) return g; }
  return null;
}

/** Highest surface under the runner that it can stand on from its current height. */
function support(r, track) {
  let best = r.invulnT > 0 || !overGap(track, r.x, r.z) ? 0 : -100;
  const ci = Math.floor(r.z / CHUNK);
  best = supportIn(r, track.chunk(ci).obs, best);
  if (ci > 0 && r.z - ci * CHUNK < 1) best = supportIn(r, track.chunk(ci - 1).obs, best);
  return best;
}
function supportIn(r, obs, best) {
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    if (o.z0 > r.z) break;
    if (!o.walk || o.z1 < r.z) continue;
    const ox = o.lane * LANE_W;
    if (r.x < ox - o.hw - 0.25 || r.x > ox + o.hw + 0.25) continue;
    const top = o.t === O_RAMP ? rampTop(o, r.z) : o.h;
    if (top <= r.y + STEP_UP && top > best) best = top;
  }
  return best;
}

/** Lane with the most clear running room ahead of z (for respawns). */
export function clearLane(track, z, prefer) {
  let bestL = prefer;
  let bestD = -1;
  for (let k = 0; k < 3; k++) {
    const l = k === 0 ? prefer : k === 1 ? (prefer === 0 ? -1 : 0) : (prefer === 1 ? -1 : prefer === -1 ? 1 : 1);
    let d = 60;
    for (let ci = Math.floor((z - 5) / CHUNK); ci <= Math.floor((z + 60) / CHUNK); ci++) {
      const c = track.chunk(ci);
      for (const o of c.obs) {
        if (o.lane !== l || o.z1 < z - 1) continue;
        const dd = Math.max(0, o.z0 - z);
        if (dd < d) d = dd;
      }
      for (const g of c.gaps) if ((g.mask & (1 << (l + 1))) && g.z1 > z - 1) { const dd = Math.max(0, g.z0 - z); if (dd < d) d = dd; }
    }
    if (d > bestD + 4) { bestD = d; bestL = l; }
  }
  return bestL;
}

/** Bring a downed runner back (optionally at a given z / lane). */
export function respawn(r, track, z, lane) {
  if (z != null) r.z = z;
  r.down = 0; r.hold = 0; r.downT = 0; r.invulnT = INVULN_T; r.stumbleT = 0; r.slideT = 0;
  r.vy = 0; r.grounded = 1; r.fastFall = 0; r.rollOnLand = 0; r.bufT = 0; r.zapT = 0;
  const l = lane != null ? lane : clearLane(track, r.z, r.lane);
  r.lane = l; r.laneFrom = l; r.x = r.xFrom = l * LANE_W; r.laneT = 1;
  r.y = 0; r.sup = 0;
  const g = overGap(track, r.x, r.z);
  if (g) r.z = g.z1 + 0.5;
  r.zPrev = r.z;
  r.speed = baseSpeed(r.t) * 0.55;
  ev(r, E_RESPAWN, 0);
}

function collectAll(r, track, h) {
  const ci = Math.floor(r.z / CHUNK);
  collectIn(r, track.chunk(ci), h);
  if (r.magnetT > 0 || (ci + 1) * CHUNK - r.z < 16) collectIn(r, track.chunk(ci + 1), h);
  const tks = r.tokens;
  for (let i = 0; i < tks.length; i++) {
    const tk = tks[i];
    if (!tk.alive) continue;
    const dz = tk.z - r.z;
    if (dz < 1.1 && dz > -1.1 && Math.abs(tk.x - r.x) < 1.2 && tk.y > r.y - 0.5 && tk.y < r.y + h + 0.6) {
      tk.alive = 0;
      ev(r, E_TOKEN, tk.id);
    }
  }
}
function collectIn(r, c, h) {
  const base = c.i * 1000;
  const mag = r.magnetT > 0;
  const coins = c.coins;
  for (let i = 0; i < coins.length; i++) {
    const cn = coins[i];
    const dz = cn.z - r.z;
    if (dz < -1.2) continue;
    if (dz > (mag ? 15 : 1)) break;
    const key = base + i;
    if (r.taken.has(key)) continue;
    let hit;
    if (mag) hit = Math.abs(cn.x - r.x) < 3.4 * LANE_W / 2.6 && cn.y < r.y + 4.5 && cn.y > r.y - 2.5;
    else hit = dz < 0.9 && Math.abs(cn.x - r.x) < 1.0 && cn.y > r.y - 0.35 && cn.y < r.y + h + 0.45;
    if (hit) { r.taken.add(key); r.coins++; ev(r, E_COIN, key); }
  }
  const items = c.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const dz = it.z - r.z;
    if (dz < -1.2) continue;
    if (dz > 1.2) break;
    const key = base + 500 + i;
    if (r.taken.has(key)) continue;
    if (Math.abs(it.x - r.x) < 1.15 && it.y > r.y - 0.5 && it.y < r.y + h + 0.6) {
      r.taken.add(key);
      if (it.k === I_MAGNET) r.magnetT = MAGNET_T;
      else if (it.k === I_SNEAKERS) r.sneakersT = SNEAKERS_T;
      else if (it.k === I_SHIELD) r.shield = 1;
      ev(r, E_PICK, it.k * 100000 + key);
    }
  }
}

function passed(r, o, ov, dry) {
  if (dry) return;
  let clean = false;
  let close = false;
  if (ov > 0) {
    if (o.t === O_LOW && r.y >= LOW_H - 0.02) { clean = true; close = r.y < LOW_H + 0.3; }
    else if (o.t === O_HIGH && r.slideT > 0) { clean = true; close = r.slideAge < 0.16; }
  } else if ((o.t === O_TRAIN || o.t === O_MTRAIN || o.t === O_LOW || o.t === O_HIGH) && r.laneFrom === o.lane && r.laneAge < 0.28 && Math.abs(o.lane * LANE_W - r.x) < LANE_W * 1.3) {
    clean = true; close = true;
  }
  if (!clean) return;
  r.combo++;
  r.comboT = 2.6;
  if (r.combo > r.maxCombo) r.maxCombo = r.combo;
  if (close) { r.closeCalls++; r.coins += 2; ev(r, E_CLOSE, o.lane); }
  if (r.combo >= 2) ev(r, E_COMBO, r.combo);
  for (let i = 0; i < COMBO_TIERS.length; i++) {
    if (r.combo === COMBO_TIERS[i]) { r.coins += COMBO_BONUS[i]; r.bonus += COMBO_BONUS[i]; ev(r, E_BONUS, COMBO_BONUS[i]); break; }
  }
}

function collideIn(r, obs, h, dry) {
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    // the hull's front is z + HALF_D; a hair of slack guards float noise (it used to be 0.6 m,
    // which fired a hit ~25 ms before the runner visibly reached the obstacle)
    if (o.z0 > r.z + HALF_D + 0.06) break;
    if (o.z1 < r.z - HALF_D) continue;
    const ox = o.lane * LANE_W;
    const ov = Math.min(r.x + HALF_W, ox + o.hw) - Math.max(r.x - HALF_W, ox - o.hw);
    const crossed = r.zPrev + HALF_D <= o.z0 && r.z + HALF_D > o.z0;
    if (crossed && !r.down) passed(r, o, ov, dry);
    if (ov <= 0 || r.down) continue;
    if (o.id === r.ignoreId || o.gone) continue;
    if (r.smashN && r.smashed.has(o.id)) continue;
    const top = o.t === O_RAMP ? rampTop(o, r.z) : o.h;
    if (r.y + h <= o.b + 0.02 || r.y >= top - 0.02) continue;
    if (o.walk && r.y >= top - STEP_UP) continue;
    hit(r, o, r.zPrev + HALF_D <= o.z0 + 0.03, ov, dry);
  }
}

function hit(r, o, frontal, ov, dry) {
  if (r.invulnT > 0) return;
  if (o.soft) { // warm-up rows: a miss trips you up, it doesn't knock you down
    r.ignoreId = o.id; r.ignoreT = 0.5;
    stumble(r, 0.8, dry);
    if (!dry) ev(r, E_TRIP, 0);
    return;
  }
  if (o.t === O_BLOCK) {
    r.ignoreId = o.id; r.ignoreT = 0.5;
    const sh = r.shield;
    if (!dry) { o.hit = 1; ev(r, E_BLOCK, o.id * 10 + (sh ? 1 : 0)); }
    if (sh) { r.shield = 0; r.shields++; if (!dry) ev(r, E_SHIELD, 0); } else stumble(r, 1.3, dry);
    return;
  }
  if (r.boostT > 0 && (o.t === O_LOW || o.t === O_HIGH)) {
    if (!dry) { r.smashed.add(o.id); r.smashN++; ev(r, E_SMASH, o.id); }
    else { r.ignoreId = o.id; r.ignoreT = 0.3; }
    return;
  }
  if (!frontal) {
    if (r.bounceT > 0) return;
    if (r.laneT < 1 || r.laneAge < 0.3) { const back = r.laneFrom; r.laneFrom = r.lane; r.lane = back; r.xFrom = r.x; r.laneT = 0; }
    r.bounceT = 0.32;
    stumble(r, 1, dry);
    return;
  }
  if (ov < 0.5 && r.laneT < 1) {
    if (r.lane === o.lane) { const back = r.laneFrom; r.laneFrom = r.lane; r.lane = back; r.xFrom = r.x; r.laneT = 0; r.bounceT = 0.32; }
    r.ignoreId = o.id; r.ignoreT = 0.4;
    stumble(r, 1, dry);
    return;
  }
  if (o.t === O_LOW && r.y > LOW_H - TRIP_TOL) {
    r.ignoreId = o.id; r.ignoreT = 0.4;
    stumble(r, 1, dry);
    if (!dry) ev(r, E_TRIP, 0);
    return;
  }
  // Late dodge: the lane change began within LATE_DODGE_T of the impact, so the player was
  // visibly on their way out. Count it as a clip: bounce back where they came from, stumble.
  if (r.laneT < 1 && r.laneAge < LATE_DODGE_T && r.lane !== r.laneFrom) {
    const back = r.laneFrom; r.laneFrom = r.lane; r.lane = back; r.xFrom = r.x; r.laneT = 0; r.bounceT = 0.32;
    r.ignoreId = o.id; r.ignoreT = 0.45;
    r.clips++;
    stumble(r, 1.1, dry);
    if (!dry) ev(r, E_CLIP, o.t);
    return;
  }
  r.hitT = o.t; r.hitOv = ov; r.hitY = r.y;
  crash(r, C_HIT, dry);
}

/** Advance one fixed step. `dry` = look-ahead: no pickups, no events, no shared mutation. */
export function step(r, track, dry) {
  const dt = DT;
  r.t += dt;
  r.zPrev = r.z;
  if (r.invulnT > 0) r.invulnT -= dt;
  if (r.magnetT > 0) r.magnetT -= dt;
  if (r.sneakersT > 0) r.sneakersT -= dt;
  if (r.boostT > 0) r.boostT -= dt;
  if (r.shoveT > 0) r.shoveT -= dt;
  if (r.bounceT > 0) r.bounceT -= dt;
  if (r.bumpT > 0) r.bumpT = Math.max(0, r.bumpT - dt); else if (r.bumpT < 0) r.bumpT = Math.min(0, r.bumpT + dt);
  if (r.ignoreT > 0) { r.ignoreT -= dt; if (r.ignoreT <= 0) r.ignoreId = -1; }
  if (r.comboT > 0) { r.comboT -= dt; if (r.comboT <= 0) r.combo = 0; }

  if (r.down) {
    r.downT += dt;
    if (r.speed < 0) r.speed = Math.min(0, r.speed + 12 * dt);
    else r.speed = Math.max(0, r.speed - 30 * dt);
    r.z += r.speed * dt;
    if (r.cause === C_FALL) { r.vy -= GRAV * dt; r.y += r.vy * dt; if (r.y < -9) r.y = -9; }
    else if (!r.grounded) {
      r.vy -= GRAV * dt; r.y += r.vy * dt;
      if (r.y <= r.sup) { r.y = r.sup; r.vy = 0; r.grounded = 1; }
    }
    if (!r.hold && r.downT >= CRASH_T) respawn(r, track);
    return;
  }

  if (r.bufT > 0) { r.bufT -= dt; if (tryAct(r, r.bufA, dry)) r.bufT = 0; }
  if (r.zapT > 0) {
    r.zapT -= dt;
    if (r.zapT <= 0) {
      let dir = r.zapDir;
      if (r.lane + dir < -1 || r.lane + dir > 1) dir = -dir;
      tryAct(r, dir < 0 ? A_LEFT : A_RIGHT, dry);
    }
  }

  // forward
  let m = 1 + r.catchup + r.draft;
  if (r.boostT > 0) m += 0.35;
  if (r.shoveT > 0) m += 0.12;
  if (r.stumbleT > 0) { m -= 0.42 * (r.stumbleT / STUMBLE_T); r.stumbleT -= dt; }
  let target = baseSpeed(r.t) * m;
  if (r.done) target = 7;
  r.speed += (target - r.speed) * K_SPEED;
  r.z += r.speed * dt;

  // lateral (ease-out)
  if (r.laneT < 1) {
    r.laneT += dt / LANE_TIME;
    if (r.laneT > 1) r.laneT = 1;
    const u = 1 - r.laneT;
    r.x = r.xFrom + (r.lane * LANE_W - r.xFrom) * (1 - u * u * u);
  }
  r.laneAge += dt;

  // vertical
  const sup = support(r, track);
  r.sup = sup;
  if (r.grounded) {
    if (sup < r.y - 0.3) { r.grounded = 0; r.coyote = COYOTE_T; r.vy = 0; r.airT = 0; }
    else if (sup <= r.y + STEP_UP) r.y = sup;
  }
  if (!r.grounded) {
    r.coyote -= dt;
    r.airT += dt;
    let g = GRAV;
    if (!r.fastFall && r.vy < HANG_V && r.vy > -HANG_V) g *= HANG_G;
    r.vy -= g * dt;
    if (r.vy < -40) r.vy = -40;
    r.y += r.vy * dt;
    if (r.vy <= 0 && r.y <= sup) {
      const impact = -r.vy;
      r.y = sup; r.vy = 0; r.grounded = 1; r.fastFall = 0; r.airT = 0;
      if (!dry) ev(r, E_LAND, impact);
      if (r.rollOnLand) { r.rollOnLand = 0; r.slideT = SLIDE_TIME; r.slideAge = 0; r.rolls++; if (!dry) ev(r, E_ROLL, 1); }
    } else if (r.y < -2.2) {
      crash(r, C_FALL, dry);
      return;
    }
  }
  if (r.slideT > 0) { r.slideT -= dt; r.slideAge += dt; }

  // obstacles
  const h = r.slideT > 0 ? ROLL_H : STAND_H;
  const ci = Math.floor(r.z / CHUNK);
  collideIn(r, track.chunk(ci).obs, h, dry);
  if (ci > 0 && r.z - ci * CHUNK < 1.5) collideIn(r, track.chunk(ci - 1).obs, h, dry);
  if ((ci + 1) * CHUNK - r.z < 1.5) collideIn(r, track.chunk(ci + 1).obs, h, dry);
  if (r.extra.length) collideIn(r, r.extra, h, dry);
  if (r.down) return;

  if (!dry) {
    collectAll(r, track, h);
    if (r.finLen > 0 && r.fin < 0 && r.z >= r.finLen) {
      const k = (r.z - r.finLen) / Math.max(1e-6, r.z - r.zPrev);
      r.fin = r.t - dt * k;
      r.done = 1;
      r.invulnT = 1e9;
      ev(r, E_FINISH, r.fin);
    }
  }
}

/** Make a downed runner hold (wait for a verdict) or not. */
export function setHold(r, on) { r.hold = on ? 1 : 0; }

export const ITEM_KINDS = { I_MAGNET, I_SNEAKERS, I_SHIELD, I_BOX };
export const OBS_KINDS = { O_LOW, O_HIGH, O_TRAIN, O_RAMP, O_MTRAIN, O_BLOCK };

// ── perfect-information bot: depth-first search over the real sim ──
const BOT_EVERY = 12; // steps per decision (0.1 s)
const BOT_H = 20;     // decisions of look-ahead (2 s)
const BOT_BUDGET = 60000;

export function createBot(track) {
  const pool = [];
  for (let i = 0; i <= BOT_H + 1; i++) pool.push(newRunner(0));
  let prev = new Int8Array(BOT_H + 2);
  let next = new Int8Array(BOT_H + 2);
  let prevN = 0;
  const seen = new Set();
  let budget = 0;
  let allowStumble = false;
  let goal = null;
  const order = new Int8Array(6);

  function simulate(dst, src, a) {
    copyRunner(dst, src);
    if (a && !tryAct(dst, a, true)) return false;
    const cr = dst.crashes; const st = dst.stumbles; const sh = dst.shields;
    for (let k = 0; k < BOT_EVERY; k++) {
      step(dst, track, true);
      budget++;
      if (dst.crashes !== cr || dst.shields !== sh) return false;
      if (!allowStumble && dst.stumbles !== st) return false;
    }
    return true;
  }
  function keyOf(d, s) {
    const x = Math.round(s.x * 2) + 8;
    const y = Math.max(0, Math.min(63, Math.round((s.y + 3) * 4)));
    const vy = Math.max(0, Math.min(31, Math.round((s.vy + 40) / 2)));
    const sl = Math.min(7, Math.ceil(s.slideT * 10));
    return ((((((d * 3 + s.lane + 1) * 20 + x) * 64 + y) * 32 + vy) * 8 + sl) * 2 + s.grounded) * 4 + s.fastFall * 2 + s.rollOnLand;
  }
  function dfs(d, src) {
    if (d >= BOT_H) return true;
    if (budget > BOT_BUDGET) return false;
    const node = pool[d + 1];
    let n = 0;
    const hint = d + 1 < prevN ? prev[d + 1] : 0;
    order[n++] = hint;
    if (goal !== null && src.lane !== goal && src.laneT >= 1) {
      const toward = goal < src.lane ? A_LEFT : A_RIGHT;
      if (toward !== hint) order[n++] = toward;
    }
    for (const a of [0, A_UP, A_DOWN, A_LEFT, A_RIGHT]) {
      let dup = false;
      for (let j = 0; j < n; j++) if (order[j] === a) dup = true;
      if (!dup) order[n++] = a;
    }
    for (let j = 0; j < n; j++) {
      const a = order[j];
      if ((a === A_LEFT && src.lane <= -1) || (a === A_RIGHT && src.lane >= 1)) continue;
      if (a === A_UP && !(src.grounded || src.coyote > 0)) continue;
      if (a === A_DOWN && src.grounded && src.slideT > 0.2) continue;
      if (!simulate(node, src, a)) continue;
      const k = keyOf(d, node);
      if (seen.has(k)) continue;
      seen.add(k);
      if (dfs(d + 1, node)) { next[d] = a; return true; }
    }
    return false;
  }
  return {
    /** Decide the action for this 0.1 s window (0 = none). Call every 12 steps. */
    decide(r, goalLane = null) {
      goal = goalLane;
      copyRunner(pool[0], r);
      for (const al of [false, true]) {
        allowStumble = al;
        seen.clear();
        budget = 0;
        if (dfs(0, pool[0])) {
          const t = prev; prev = next; next = t; prevN = BOT_H;
          return prev[0];
        }
      }
      prevN = 0;
      return 0;
    },
    every: BOT_EVERY,
  };
}

/** Headless bot run for tests: how often does a perfect player get caught? */
export function botRun(seed, chunks, { maxMs = 60000 } = {}) {
  const t0 = performance.now();
  const track = createTrack(seed);
  const r = newRunner(0);
  r.hearts = 1e6;
  const bot = createBot(track);
  const goalZ = chunks * CHUNK;
  let steps = 0;
  const fails = [];
  while (r.z < goalZ) {
    if (steps % BOT_EVERY === 0) { const a = bot.decide(r); if (a) act(r, a); }
    step(r, track, false);
    steps++;
    for (let i = 0; i < r.evN; i++) {
      if (r.evT[i] === E_CRASH || r.evT[i] === E_SHIELD) fails.push({ z: Math.round(r.z), chunk: Math.floor(r.z / CHUNK), kind: r.evT[i] === E_CRASH ? 'crash' : 'shield' });
    }
    r.evN = 0;
    if (r.down) respawn(r, track);
    if (steps % 600 === 0) {
      track.keepFrom(Math.floor(r.z / CHUNK) - 1);
      if (performance.now() - t0 > maxMs) break;
    }
  }
  return { seed, chunks: Math.floor(r.z / CHUNK), z: Math.round(r.z), steps, crashes: r.crashes, stumbles: r.stumbles, fails, ms: Math.round(performance.now() - t0) };
}
