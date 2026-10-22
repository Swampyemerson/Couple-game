// Getaway smoothing helpers: critically damped springs, a frame pacer and a draw pose. Nothing
// here allocates after creation (the camera, the partner's car and the frame loop call them every frame).
//
// Critically damped spring (Unity SmoothDamp / GPG4 1.10): the exact solution of x'' = −2ω x' − ω² x
// over a step dt, so it is stable at any dt (a 125 ms frame included), frame-rate independent and has
// a continuous velocity (an exponential `x += (g − x) · k · dt` jumps in velocity whenever the goal
// moves and depends on the frame rate). The caller keeps the state as an error e (position − goal) and
// ev (velocity − goal velocity): the goal velocity is a feed-forward, so a goal that moves at a steady
// speed is followed with no lag at all and ω only decides how fast a change is taken up.

export const SPR = { e: 0, v: 0 };

/** Advance (e, ev) by dt with natural frequency w (rad/s; it settles in about 4.7 / w seconds); result in SPR. */
export function critDamp(e, ev, w, dt) {
  const ex = Math.exp(-w * dt);
  const t = ev + w * e;
  SPR.e = (e + t * dt) * ex;
  SPR.v = (ev - w * t * dt) * ex;
}

export function wrapAngle(a) { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }

const RATES = [24, 25, 30, 48, 50, 60, 72, 75, 80, 90, 100, 120, 144, 165, 240];

/**
 * Frame pacer. The wall delta between two requestAnimationFrame callbacks is the display interval
 * plus timestamp jitter (± 1–4 ms, more on a busy phone); feeding it raw to a fixed-step
 * accumulator makes the simulation advance unevenly (a car looks like it stutters at constant
 * speed). The pacer estimates the display interval (the median of the last 30 normal deltas, snapped
 * to a known refresh rate when within 1.5%) and snaps what is owed to the simulation (this frame's
 * delta plus the `debt` carried from before) to the nearest whole multiple of it when within ±25%
 * of one, carrying the remainder in the debt. The debt is simply wall time minus fed time, so it
 * stays within a quarter of an interval and the sum of what was fed never drifts from the wall
 * clock: the simulation still keeps pace with the shared clock (live mode needs that). What is not
 * near a multiple (a real hitch, an irregular frame) passes through, the debt paid with it.
 */
export function createPacer() {
  const N = 30;
  const ring = new Float32Array(N); const tmp = new Float32Array(N);
  let n = 0; let head = 0; let est = 1 / 60; let debt = 0; let since = 0; let bias = 0;
  // The interval: the median finds the multiple each delta is (a dropped frame is 2), then total time over
  // total multiples (the timestamp noise of consecutive deltas cancels in the sum), snapped to a known rate.
  function estimate() {
    for (let i = 0; i < n; i++) tmp[i] = ring[i];
    for (let i = 1; i < n; i++) { const v = tmp[i]; let j = i - 1; while (j >= 0 && tmp[j] > v) { tmp[j + 1] = tmp[j]; j--; } tmp[j + 1] = v; }
    const med = n & 1 ? tmp[n >> 1] : (tmp[(n >> 1) - 1] + tmp[n >> 1]) / 2;
    let sw = 0; let sm = 0;
    for (let i = 0; i < n; i++) { sw += ring[i]; sm += Math.max(1, Math.round(ring[i] / med)); }
    let m = sw / sm;
    const hz = 1 / m;
    for (let i = 0; i < RATES.length; i++) if (Math.abs(hz - RATES[i]) < RATES[i] * 0.015) { m = 1 / RATES[i]; break; }
    return m;
  }
  const api = {
    get est() { return est; },
    get debt() { return debt; },
    get n() { return n; },
    reset() { n = 0; head = 0; est = 1 / 60; debt = 0; since = 0; bias = 0; },
    /** One frame's wall delta (s) → the delta to simulate (s). */
    feed(wall) {
      if (!(wall > 0)) return 0;
      if (wall >= 0.0035 && wall <= 0.045) {
        ring[head] = wall; head = (head + 1) % N; if (n < N) n++;
        if (n >= 10 && ++since >= 4) {
          since = 0; const e2 = estimate();
          est = Math.abs(e2 / est - 1) > 0.04 ? e2 : est + (e2 - est) * 0.25; // (a new refresh rate takes at once, noise is filtered)
        }
      }
      // `bias` is the slow average of the debt: the frame grid's phase against the timestamps' (the
      // noise is symmetric around it, so the ±25% window is centred on it, not on wherever a hitch left the debt)
      const owed = wall + debt; let out = owed;
      if (n >= 10 && wall <= 0.1 && owed > 0 && Math.abs(debt) < 0.45 * est) {
        const m = Math.round((owed - bias) / est);
        if (m >= 1 && Math.abs(owed - bias - m * est) <= 0.25 * est) out = m * est;
      }
      if (out === owed) bias = 0; // (passed through: the grid starts over)
      debt = owed - out; bias += (debt - bias) * Math.min(1, wall * 2);
      if (debt > 0.05) debt = 0.05; else if (debt < -0.05) debt = -0.05;
      return out > 0 ? out : 0;
    },
  };
  return api;
}

/** A car's draw pose: where the picture goes, which may differ from the physics car. prev* is the
 *  state before the last simulation step, the rest what is drawn (render interpolation). */
export function newDrawPose() {
  return { car: null, px: 0, py: 0, pz: 0, pyaw: 0, ppitch: 0, proll: 0, pheave: 0, pwheel: 0, psteer: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, heave: 0, wheel: 0, steer: 0 };
}

/** Remember the car's state as the "previous" one (call right before each simulation step). */
export function keepPrev(d, c) {
  d.px = c.x; d.py = c.y; d.pz = c.z; d.pyaw = c.yaw; d.ppitch = c.pitch; d.proll = c.roll; d.pheave = c.heave; d.pwheel = c.wheel; d.psteer = c.steer;
}

/** Pose = c (alpha 1) or prev → c at alpha. A new car object or a jump over `jump` m is a teleport: no lerp across it. */
export function blendPose(d, c, alpha, jump = 3) {
  if (d.car !== c) { d.car = c; keepPrev(d, c); }
  else if (Math.abs(c.x - d.px) > jump || Math.abs(c.z - d.pz) > jump) keepPrev(d, c);
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  d.x = d.px + (c.x - d.px) * a; d.y = d.py + (c.y - d.py) * a; d.z = d.pz + (c.z - d.pz) * a;
  d.yaw = d.pyaw + wrapAngle(c.yaw - d.pyaw) * a;
  d.pitch = d.ppitch + (c.pitch - d.ppitch) * a; d.roll = d.proll + (c.roll - d.proll) * a; d.heave = d.pheave + (c.heave - d.pheave) * a;
  d.wheel = d.pwheel + (c.wheel - d.pwheel) * a; d.steer = d.psteer + (c.steer - d.psteer) * a;
}

/** Pose = the car as it is now (no interpolation: remote cars, countdown, result, pause). */
export function copyPose(d, c) {
  d.car = c; keepPrev(d, c);
  d.x = c.x; d.y = c.y; d.z = c.z; d.yaw = c.yaw; d.pitch = c.pitch; d.roll = c.roll; d.heave = c.heave; d.wheel = c.wheel; d.steer = c.steer;
}
