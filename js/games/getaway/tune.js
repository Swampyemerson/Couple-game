// Getaway tuning: every feel number in one place (docs/games/getaway.md explains them).
// Units: metres, seconds, m/s. Yaw is a compass bearing in radians (0 = north = −z, π/2 = east = +x),
// so a car's heading is (sin yaw, −cos yaw) and its right is (cos yaw, sin yaw).

export const DT = 1 / 120;            // fixed simulation step
export const MAX_STEPS = 24;          // per frame (a 200 ms hitch catches up, a longer one is dropped)
export const G = 9.81;

/** Car handling. The runner and the cop share the model; the cop is a touch faster in a straight
 *  line but heavier on its feet, the runner turns in sharper. */
export const CAR = {
  len: 4.6, wid: 2.0, base: 2.75,     // body length, width, wheelbase
  circR: 1.0, circZ: 1.55,            // collision: three circles at local z = +circZ, 0, −circZ
  mass: 1, inertia: 2.1,              // per unit mass: I/m (m²) for a 4.6 × 2 m box
  runner: { vTop: 47, accel: 9.5, grip: 20, steer: 0.62, brake: 15, nitroA: 4.5, nitroTop: 1.15, yawK: 11 },
  cop: { vTop: 48, accel: 9.6, grip: 19, steer: 0.58, brake: 15.5, nitroA: 4, nitroTop: 1.1, yawK: 10 },
  revTop: 12, revAccel: 6.5,
  drag: 0.00042, roll: 0.012,          // aero (× v²) and rolling (× v) decel
  coast: 0.6,                         // engine braking (m/s²) with no pedal
  handGrip: 0.34,                     // rear lateral grip multiplier with the handbrake
  handDecel: 5.5,
  steerSpeed: 18,                     // steering lock falls off as 1 / (1 + v / steerSpeed)
  steerRate: 5.5,                     // keyboard steering slew (full lock per s)
  slipSkid: 2.4,                      // lateral slip (m/s) that leaves skid marks / squeals
  wallE: 0.18,                        // wall restitution
  wallFric: 0.12,                     // tangential speed lost per wall contact step (fraction)
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
  ramMin: 4, ramK: 1.5,               // car-car ram, victim side
  pit: 24,                            // a proper PIT
  pitMinSpeed: 7, pitMinRel: 1.4,     // runner speed, lateral push speed
  pitMaxAngle: 1.0,                   // rad between headings (≈ 57°)
  copMinHp: 15,                       // the cop can't be disabled; low hp = slower
  smoke: 55, fire: 25,                // runner hp thresholds for smoke / fire
  breakable: 9,                       // speed that knocks a pole / tree / bollard over
  spikeExtra: 8,
};

export const RULES = {
  bustStop: 2, bustT: 3, bustNear: 12, // stopped (< 2 m/s) for 3 s with the cop within 12 m
  heatT: 8,                            // seconds out of sight and out of range to lose the heat
  heatDecay: 2.5,                      // escape meter falls this many times faster when spotted
  intro: 3400, countdown: 3000, result: 5200, final: 1200,
  pitSlowMo: 0.75, slowMoScale: 0.3,
  spikeDeploy: 1200, spikeRange: 400, spikeNoRunner: 25, spikeReveal: 120, spikeLen: 0.7,
  spikeSnap: 70,                       // a tap must be within this of a road
  oilT: 25, oilR: 3.4,
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
  fov: 60, fovSpeed: 15, fovNitro: 6, portraitFov: 74,
};

export const TRAFFIC = {
  speed: { highway: 25, arterial: 15.5, street: 11, alley: 7, dirt: 9, ramp: 18 },
  gap: { light: 150, normal: 78 },     // metres of lane per car
  max: 64,                             // instances drawn
  near: 340,                           // only cars within this of a viewer are placed
  knockT: 12,
};
