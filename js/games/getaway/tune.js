// Getaway tuning: every feel number in one place (docs/games/getaway.md explains them).
// Units: metres, seconds, m/s. Yaw is a compass bearing in radians (0 = north = −z, π/2 = east = +x),
// so a car's heading is (sin yaw, −cos yaw) and its right is (cos yaw, sin yaw).

export const DT = 1 / 120;            // fixed simulation step
export const MAX_STEPS = 15;          // per frame (a 125 ms frame catches up, a longer gap is dropped)
export const MAX_STEPS_SLOW = 8;      // on a slow frame (> 50 ms) the step doubles to 1/60 and at most this many run
export const G = 9.81;

/** Car handling. The runner and the cop share the model; the cop is a touch faster in a straight
 *  line but heavier on its feet, the runner turns in sharper. */
export const CAR = {
  len: 4.6, wid: 2.0, base: 2.75,     // body length, width, wheelbase
  hl: 2.3, hw: 0.98,                  // collision box half length / half width (the body: bumpers ±2.3 m)
  mass: 1, inertia: 2.1,              // per unit mass: I/m (m²) for a 4.6 × 2 m box
  runner: { vTop: 47, accel: 9.5, grip: 20, steer: 0.62, brake: 15, nitroA: 4.5, nitroTop: 1.15, yawK: 11 },
  cop: { vTop: 48, accel: 9.6, grip: 19, steer: 0.58, brake: 15.5, nitroA: 4, nitroTop: 1.1, yawK: 10 },
  revTop: 12, revAccel: 6.5,
  drag: 0.00042, roll: 0.012,          // aero (× v²) and rolling (× v) decel
  coast: 1.6,                         // engine braking (m/s²) with no pedal (a lift reads as a decision)
  overTopBleed: 0.3,                  // decel per m/s over the top speed (nitro running out eases off, no brake slam)
  handGrip: 0.34,                     // rear lateral grip multiplier with the handbrake
  handYaw: 2.3,                       // the handbrake lets yaw rate exceed the grip cap this much
  driftGrip: 0.72,                    // lateral grip while power-sliding (slip > driftSlip, gas held)
  driftSlip: 3.4,                     // lateral slip (m/s) that counts as a power slide (the rear stays loose)
  weightTurn: 0.12,                   // weight transfer: full braking adds 12% turn-in, power takes some away
  suspK: 100, suspD: 9,               // body spring (1/s²) and damper (1/s): pitch, roll, heave
  handDecel: 5.5,
  steerSpeed: 18,                     // steering lock falls off as 1 / (1 + v / steerSpeed)
  lockGripK: 1.18,                    // full lock asks for this × the grip-limited yaw rate (so 0..100% steer = 0..118% of grip: the slider keeps its resolution at speed)
  powerCapK: 1.08,                    // full gas + full lock at speed may exceed the grip cap this much (the tail steps out; never above 1.1: 1.1 runs away)
  liftCapK: 1.06,                     // lift-off + full lock: a little oversteer tightens the line
  capFadeSlip: 3.2,                   // the cap allowance fades to nothing by this lateral slip (m/s), below driftSlip so a slide can't run away (4 ran away at 100 km/h)
  flatDrag: 1.2,                      // extra rolling drag (m/s²) on a flat tyre
  flatWobble: 3.0,                    // roll wobble on a flat, one per wheel turn (rad/s²): the rim thump
  steerRate: 5.5,                     // keyboard steering slew (full lock per s)
  slipSkid: 1.6,                      // lateral slip (m/s) that leaves skid marks / squeals (just under the limit: 1.7–2.3 at full lock)
  driftSlip0: 1.2, driftSlip1: 6.2,   // c.drift ramps 0 → 1 over this slip range (0.1–0.2 at the grip limit, 1 in a handbrake slide)
  heaveK: 0.2,                        // body heave kick per m/s of ground vertical speed change (humps, crests)
  roadTexture: 1.2,                   // light heave noise on tarmac at speed (dirt has 9)
  wallE: 0.18,                        // wall restitution
  wallFric: 0.3,                      // wall friction coefficient (tangential impulse ≤ μ × normal impulse)
  carE: 0.25,                         // car-car restitution
};

/** Surfaces: lateral grip and top-speed multipliers, extra drag. */
export const SURF = {
  road: { grip: 1, top: 1, drag: 0, dust: 0 },
  lot: { grip: 1, top: 1, drag: 0, dust: 0 },
  grass: { grip: 0.72, top: 0.66, drag: 1.6, dust: 1 },
  dirt: { grip: 0.78, top: 0.78, drag: 0.9, dust: 1 },
  sand: { grip: 0.6, top: 0.5, drag: 3.2, dust: 1 },
};
export const SURF_IDS = ['road', 'lot', 'grass', 'dirt', 'sand'];

export const DAMAGE = {
  wallMin: 6, wallK: 1.15,            // wall: (|vn| − wallMin) × wallK
  wallFx: 3,                          // closing speed for a wall 'hit' event (below: a 'scrape')
  ramMin: 4, ramK: 1.5,               // car-car ram, victim side
  ramCap: 30,                         // a single ram never costs the runner more than this (≈ 1.25 PITs)
  ramBlameMin: 0.4,                   // a runner that brake-checks or drives head-on takes 40–100% of a ram by who closed
  pit: 24,                            // a full PIT (scaled 0.55–1.25 by how hard the push was)
  pitMinSpeed: 7,                     // the runner must be moving at least this fast
  pitCopSpeed: 12,                    // the cop's speed along the runner's heading
  pitRearZ: -0.5,                     // contact behind this (m from the centre: the rear ~40%)
  pitAngle0: 0.35, pitAngle1: 0.7,    // contact normal angle from the car's axis: below a ram, above a PIT (blend)
  pitPush: 3.2, nudgePush: 1.8,       // sideways push (m/s) for a PIT / a nudge (small twitch, no slow-mo)
  pitSlowMo: 3.2,                     // every real PIT gets its slow-motion moment (its length scales with the push)
  pitCopK: 1.3,                       // the push counts the cop's own sideways motion (× this), not the runner's slide into it
  pitMaxAngle: 1.0,                   // rad between headings (≈ 57°)
  flimsy: 3,                          // mailboxes, hydrants, bollards, signs give way above this (m/s)
  copMinHp: 15,                       // the cop can't be disabled; low hp = slower
  smoke: 55, fire: 25,                // runner hp thresholds for smoke / fire
  breakable: 9,                       // speed that knocks a pole / tree / bollard over
  spikeExtra: 8,
};

export const RULES = {
  bustStop: 2, bustT: 3, bustNear: 12, // stopped (< 2 m/s) for 3 s with the cop within 12 m
  heatT: 7,                            // seconds out of sight and out of range to lose the heat (8 left 4 of 10 sampled rounds peaking at 0.85–0.95 without escaping)
  heatDecay: 1.0,                      // escape meter falls this many times faster when spotted (was 2.5: it never left 0)
  heatBreak: 0.6,                      // beyond this × the heat distance with the cop still watching, the meter fills at heatBreakK ('Breaking away')
  heatBreakK: 1 / 3,
  heatMemory: 10,                      // s: the meter can't drop below half its peak of the last 10 s (a near-escape stays on the table)
  heatFlicker: 1.0,                    // s: a line of sight that flickers back for less than this doesn't count as spotted
  hitStopMin: 12, hitStopMax: 27,      // m/s closing speed for a 60 ms → 90 ms hit-stop on walls and rams
  hitStop0: 0.06, hitStop1: 0.09,
  hitSlowV: 20, hitSlowT: 0.25, hitSlowK: 0.5, // ≥ 20 m/s: a quarter second at half speed after the stop
  intro: 3400, countdown: 3000, result: 5200, final: 1200,
  pitSlowMo: 0.45, pitSlowMoMax: 0.75, slowMoScale: 0.35, // a PIT's slow-mo: 0.45 s at push 3.2 → 0.75 s at push ≥ 7.2
  spikeDeploy: 1200, spikeRange: 400, spikeNoRunner: 25, spikeReveal: 120, spikeLen: 0.7,
  spikeNoRunnerT: 2.5, spikeRevealT: 4, // speed-scaled: no drop within 2.5 s of the runner, revealed 4 s out (floors: 25 m / 120 m)
  spikeWarn: 200,                      // 'SPIKES AHEAD' when a strip lands within this on the runner's road
  spikeSnap: 70,                       // a tap must be within this of a road
  oilT: 25, oilR: 3.4, oilSlide: 1.2, oilKick: 1.6, // s on oil (30% lateral grip, 25% yaw damping) and the yaw kick (rad/s)
  silentPause: 2600,                   // ms of link silence before a live round pauses
};

export const NITRO = {
  off: { drain: 1, regen: 0, start: 0 },
  normal: { drain: 0.3, regen: 0.055, start: 1 },
  big: { drain: 0.22, regen: 0.085, start: 1 },
  cop: { drain: 0.4, regen: 0.05, start: 1 },
  nearMiss: 0.1,
};

export const CAM = {
  near: { dist: 7.4, height: 2.9, look: 1.3, ahead: 5 },
  far: { dist: 12.5, height: 5.6, look: 1.0, ahead: 7 },
  fov: 60, fovSpeed: 15, fovNitro: 10, portraitFov: 74,
  accPull: 0.12, // m of follow distance per m/s² of forward acceleration (throttle out, brakes in; clamped +1 / −1.8)
};

export const TRAFFIC = {
  speed: { highway: 25, arterial: 15.5, street: 11, alley: 7, dirt: 9, ramp: 18 },
  gap: { light: 150, normal: 78 },     // metres of lane per car
  max: 112,                            // instances drawn (nearest first: every car within ~150 m)
  near: 340,                           // only cars within this of a viewer are placed
  knockT: 12,                          // s before a wreck may rejoin its lane
  knockMin: 3.5,                       // closing speed (m/s) that knocks a car out of its lane (below: a nudge)
};
