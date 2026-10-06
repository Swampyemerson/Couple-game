// Rail Rush tuning: every feel number in one place. Pure data, no DOM.

export const DT = 1 / 120;            // fixed sim step (s)
export const LANE_W = 2.6;            // lane spacing (m)
export const LANE_TIME = 0.15;        // lane change duration (s)
export const GRAV = 34;               // m/s²
export const JUMP_V = 10.6;           // jump apex ≈ 1.65 m (+ hang)
export const SUPER_JUMP_V = 16.2;     // sneakers: apex ≈ 3.9 m
export const HANG_V = 2.4;            // |vy| below this = hang time near the apex
export const HANG_G = 0.5;            // gravity multiplier during the hang
export const FASTFALL_V = -24;        // swipe down in the air
export const SLIDE_TIME = 0.62;       // roll duration (s)
export const BUFFER_T = 0.2;          // input buffer window (s)
export const COYOTE_T = 0.1;          // jump grace after leaving an edge (s)
export const STAND_H = 1.75;
export const ROLL_H = 0.85;
export const HALF_D = 0.35;           // runner half depth (z)
export const HALF_W = 0.42;           // runner half width (x)
export const STEP_UP = 0.5;           // max climb without a collision
export const TRIP_TOL = 0.32;         // feet this close to a low barrier's top = trip, not crash

export const V0 = 12.5;               // start speed (m/s)
export const VMAX = 30;               // top speed
export const TAU = 110;               // speed ramp time constant (s)

export const CHUNK = 80;              // track chunk length (m)
export const ROOF = 2.8;              // train roof height
export const TRAIN_HW = 1.15;         // train half width
export const LOW_H = 1.0;             // low barrier top
export const HIGH_B = 1.2;            // high bar bottom (roll under)
export const HIGH_T = 2.55;           // high bar top
export const BAR_HW = 1.1;            // barrier half width
export const CAR = 12.5;              // train car length
export const RAMP_L = 10;             // ramp length
export const MT_K = 0.55;             // oncoming train speed as a fraction of yours
export const MT_LEAD = 45;            // oncoming train starts moving when you're this far from the meeting point
export const GAP_L = 4;               // broken-bridge gap length

export const STUMBLE_T = 0.9;
export const CRASH_T = 1.6;           // time down before respawn
export const INVULN_T = 2.0;
export const HEARTS = 3;
export const TEAM_HEARTS = 4;
export const TEAM_HEARTS_MAX = 5;
export const MAGNET_T = 10;
export const SNEAKERS_T = 10;
export const BOOST_T = 2.2;
export const REVIVE_WINDOW = 10000;   // ms

export const RACE_LEN = 2000;         // m
export const BRAWL_CAP = 3000;        // m: tiebreak distance for Brawl

export const START_DELAY = 3500;      // ms between "start" and GO
export const RESUME_DELAY = 3000;     // ms countdown after a pause

/** Base running speed after t seconds of running. */
export function baseSpeed(t) {
  return V0 + (VMAX - V0) * (1 - Math.exp(-t / TAU));
}
