// Game settings ("rules") for Blend & Seek: the option lists, presets, validation, and the
// per-device "last used" memory. The host owns them; they travel inside `setup` (lobby) and the
// match info of every phase message, so both devices always play by the same, validated rules.

/** Chameleon sizes: scale of the body, collider, step/jump/camera offsets, brush and hit radius. */
export const SIZES = [
  { id: 'tiny', label: 'Tiny', s: 0.6 },
  { id: 'small', label: 'Small', s: 0.8 },
  { id: 'medium', label: 'Medium', s: 1.0 },
  { id: 'large', label: 'Large', s: 1.3 },
  { id: 'huge', label: 'Huge', s: 1.8 },
];
export const sizeScale = (id) => (SIZES.find((x) => x.id === id) || SIZES[3]).s;

/** n0..n1 in steps of k (inclusive). */
const span = (n0, n1, k) => { const out = []; for (let v = n0; v <= n1; v += k) out.push(v); return out; };
/** Hide time: 10 s – 5 min (5 s steps to 2 min, then 10 s, then 15 s). */
export const HIDE_SECS = [...span(10, 120, 5), ...span(130, 180, 10), ...span(195, 300, 15)];
/** Seek time: 20 s – 10 min (5 s steps to 2 min, then 10 s, 15 s, 30 s). */
export const SEEK_SECS = [...span(20, 120, 5), ...span(130, 180, 10), ...span(195, 300, 15), ...span(330, 600, 30)];

/** Allowed values per field (the first entry is never the default; see PRESETS.classic). */
export const OPTIONS = {
  size: SIZES.map((x) => x.id),
  rounds: [2, 4, 6],
  hide: HIDE_SECS,
  // 'timer': the hide clock runs (Ready still starts the hunt early); 'ready': no clock at all,
  // the hunt starts when the hider taps Ready
  hideEnd: ['timer', 'ready'],
  countdown: [0, 3, 5, 10], // seconds of 3-2-1 before the hunt (after the paint lock)
  headStart: [0, 5, 10, 15, 20, 30], // seeker blindfolded while the hider may still move (hide & seek)
  grace: [0, 3, 5, 10, 15], // seconds into the hunt before the seeker may fire
  seek: SEEK_SECS,
  pellets: [3, 4, 5, 6, 7, 8, 10],
  scans: [0, 1, 2, 3, 5], // 0 = unlimited
  scanCd: [10, 15, 20, 30, 45],
  escapes: [0, 1, 2, 3], // scurries + tongue-zips while being hunted
  seekSpeed: ['slow', 'normal', 'fast'],
  heartbeat: [true, false],
  blink: ['off', 'on', 'strong'],
  stamp: [true, false],
  climb: [true, false],
  seekClimb: [true, false], // the seeker gets sticky feet too (needs climb)
  climbSpeed: ['slow', 'normal', 'fast'], // the seeker's crawl speed
  huntPaint: ['off', 'on', 'tell'], // the hider may paint while hunted; 'tell': fresh paint glints for a nearby seeker
  minimap: [true, false],
  // the seeker banks points too: 'time' = ½ pt per second left on the clock when they tag,
  // 'full' = that plus 10 per unused pellet; 'off' = v1 (only the hider scores)
  seekScore: ['off', 'time', 'full'],
  // blend bonus: the paint job is scored at the lock (camo % = how close the body's texels are to
  // the surface behind them); 10 = +10 points at ≥ 80 %, 20 = +20 at ≥ 90 %
  blendBonus: [0, 10, 20],
  // the seeker's wager while blindfolded: call FLOOR / FURNITURE / WALL / CEILING / HANGING; a
  // right call pays this many points ('CALLED IT' stamp in the recap)
  wager: [0, 5, 10],
  // 'in their sights': the hider's vignette pulses when the seeker looks straight at them
  sights: [true, false],
};
export const SPEED_MUL = { slow: 0.85, normal: 1, fast: 1.2 };
/** Seeker crawl speed relative to the hider's crawl (a hider crawls at 0.78 × walking). */
export const CLIMB_MUL = { slow: 0.65, normal: 0.85, fast: 1 };

/** Bigger maps get proportionally longer hide/seek clocks and a faster seeker sprint (every preset). */
export const MAP_TIME = { S: 1, M: 1.2, L: 1.35, XL: 1.5 };
/**
 * Per-map seek-clock scale, from a geometry sweep (greedy vantage cover so every reachable spot
 * is in line of sight within 7 m, BFS tour from the seeker spawn, 3 s look per vantage, sprint):
 * one "XL = 1.5×" for maps from 432 to 1768 m² made CU Boulder a hider walkover (sweep 191 s
 * sprinting vs a 135 s clock) and the Greenhouse a seeker walkover (59 s). A map entry's own
 * `time` field wins; then this table; then the size class.
 */
export const MAP_TIME_ID = { living: 1, garden: 1, studio: 1, greenhouse: 1, market: 1.25, house: 1.5, museum: 1.5, cuboulder: 3 };
export const timeScale = (mapEntry) => {
  if (!mapEntry) return 1;
  if (Number.isFinite(mapEntry.time)) return mapEntry.time;
  if (Number.isFinite(MAP_TIME_ID[mapEntry.id])) return MAP_TIME_ID[mapEntry.id];
  return MAP_TIME[mapEntry.size || 'S'] || 1;
};
/** The hide clock (and head start) scale too, but never past 2×: exploring a big map takes longer, hunting it takes much longer. */
export const hideScale = (mapEntry) => Math.min(2, timeScale(mapEntry));
/** Effective seconds on a map: base × scale, rounded to 5 s. */
export const effSeconds = (base, scale) => Math.round((base * scale) / 5) * 5;
/** Sprint grows with the map, up to the old XL figure (1.7×); CU's 3× clock doesn't make a 2.15× sprint. */
export const sprintMul = (scale) => 1.55 + 0.3 * (Math.min(1.5, scale) - 1);
/** Double Blind hunting speed: 1.1 m/s on the small dioramas, up to 1.6 m/s on the biggest map. */
export const dbSpeed = (scale) => Math.min(1.6, 1.1 + 0.33 * Math.max(0, scale - 1));

// "Hard" is hard for the SEEKER (masters of disguise); "Easy" makes the hunt friendlier.
// v3: the seeker climbs in every preset; Easy keeps the hider's paint locked once the hunt starts,
// Classic lets them touch up but fresh paint glints for a nearby seeker, Hard lets them repaint
// silently, slows the seeker on walls and holds the seeker's fire for the first 5 s.
export const PRESETS = {
  // Easy used to be a seeker walkover (Huge + strong blinks + fast seeker + no escapes: 96 % found in
  // the Living Room, mean 4 s): now Huge and 8 pellets stay, but blinks are 'on', the seeker walks at
  // normal speed, the hider gets one escape and a 10 s head start, so the camouflage matters.
  easy: { size: 'huge', rounds: 4, hide: 45, hideEnd: 'timer', countdown: 3, headStart: 10, grace: 0, seek: 120, pellets: 8, scans: 0, scanCd: 20, escapes: 1, seekSpeed: 'normal', heartbeat: false, blink: 'on', stamp: true, climb: true, seekClimb: true, climbSpeed: 'fast', huntPaint: 'off', minimap: true, seekScore: 'off', wager: 0, sights: true, blendBonus: 0 },
  classic: { size: 'large', rounds: 4, hide: 60, hideEnd: 'timer', countdown: 3, headStart: 0, grace: 0, seek: 90, pellets: 6, scans: 0, scanCd: 20, escapes: 1, seekSpeed: 'normal', heartbeat: true, blink: 'on', stamp: true, climb: true, seekClimb: true, climbSpeed: 'normal', huntPaint: 'tell', minimap: true, seekScore: 'full', wager: 5, sights: true, blendBonus: 10 },
  hard: { size: 'medium', rounds: 4, hide: 75, hideEnd: 'timer', countdown: 3, headStart: 0, grace: 5, seek: 90, pellets: 5, scans: 3, scanCd: 30, escapes: 2, seekSpeed: 'normal', heartbeat: true, blink: 'off', stamp: true, climb: true, seekClimb: true, climbSpeed: 'slow', huntPaint: 'on', minimap: false, seekScore: 'time', wager: 5, sights: false, blendBonus: 20 },
};
export const PRESET_IDS = ['easy', 'classic', 'hard'];
export const PRESET_LABEL = { easy: 'Easy', classic: 'Classic', hard: 'Hard', custom: 'Custom' };
export const PRESET_SUB = { easy: 'Big, blinky chameleons', classic: 'Fair for both', hard: 'Masters of disguise', custom: 'Your own mix' };
export const RULE_KEYS = Object.keys(OPTIONS);

const same = (a, b) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);

/** Which preset these rules equal, else 'custom'. */
export function presetOf(r) {
  for (const id of PRESET_IDS) if (RULE_KEYS.every((k) => same(PRESETS[id][k], r[k]))) return id;
  return 'custom';
}

/** Snap every rule to an allowed value (unknown → the Classic value). Pure and deterministic. */
export function sanitizeRules(r) {
  const out = {};
  const src = r && typeof r === 'object' ? r : {};
  for (const k of RULE_KEYS) {
    const opts = OPTIONS[k]; const v = src[k];
    if (opts.some((o) => same(o, v))) { out[k] = opts.find((o) => same(o, v)); continue; }
    if (typeof v === 'number' && typeof opts[0] === 'number' && Number.isFinite(v)) {
      // nearest allowed number
      let best = opts[0]; for (const o of opts) if (Math.abs(o - v) < Math.abs(best - v)) best = o;
      out[k] = best; continue;
    }
    out[k] = PRESETS.classic[k];
  }
  out.preset = presetOf(out);
  return out;
}

/** The whole lobby setup: mode, map, who hides first + rules. */
export function sanitizeSetup(s, mapIds, fallbackFirst = 'a') {
  const src = s && typeof s === 'object' ? s : {};
  const mode = src.mode === 'db' ? 'db' : 'hs';
  const map = mapIds.includes(src.map) ? src.map : mapIds[0];
  const first = src.first === 'a' || src.first === 'b' ? src.first : fallbackFirst;
  return { mode, map, first, rules: sanitizeRules(src.rules) };
}

/** Step a field through its option list (dir ±1), clamped at the ends. */
export function stepRule(rules, key, dir) {
  const opts = OPTIONS[key]; if (!opts) return rules;
  const i = opts.findIndex((o) => same(o, rules[key]));
  const j = Math.max(0, Math.min(opts.length - 1, (i < 0 ? 0 : i) + (dir > 0 ? 1 : -1)));
  return sanitizeRules({ ...rules, [key]: opts[j] });
}

/** Set a field from a string (buttons carry strings). */
export function setRule(rules, key, raw) {
  const opts = OPTIONS[key]; if (!opts) return rules;
  const v = opts.find((o) => String(o) === String(raw));
  if (v === undefined) return rules;
  return sanitizeRules({ ...rules, [key]: v });
}

export function applyPreset(id) {
  return sanitizeRules(PRESETS[id] || PRESETS.classic);
}

// ── per-device memory ──
const KEY = 'chm.setup.v2';
export function loadSaved() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function saveSetup(setup) {
  try { localStorage.setItem(KEY, JSON.stringify({ mode: setup.mode, map: setup.map, rules: setup.rules })); } catch { /* private mode etc. */ }
}
const TIPS = 'chm.tips.v2';
export function tipsSeen() { try { return localStorage.getItem(TIPS) === '1'; } catch { return false; } }
export function markTipsSeen() { try { localStorage.setItem(TIPS, '1'); } catch { /* ignore */ } }

/** Display helpers. */
export function fmtRule(k, v) {
  switch (k) {
    case 'countdown': case 'headStart': case 'grace': return v === 0 ? 'Off' : `${v} s`;
    case 'hideEnd': return v === 'ready' ? 'On Ready' : 'Timer';
    case 'huntPaint': return v === 'off' ? 'Off' : v === 'tell' ? 'Shows' : 'On';
    case 'seekScore': return v === 'off' ? 'Off' : v === 'time' ? 'Time left' : 'Time + pellets';
    case 'blendBonus': return v === 0 ? 'Off' : v === 10 ? '+10 at 80 %' : '+20 at 90 %';
    case 'wager': return v === 0 ? 'Off' : `+${v}`;
    case 'climbSpeed': return v === 'slow' ? 'Slow' : v === 'fast' ? 'Fast' : 'Normal';
    case 'hide': case 'seek': case 'scanCd': return v >= 60 && v % 60 === 0 ? `${v / 60} min` : v >= 60 ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` : `${v} s`;
    case 'scans': return v === 0 ? 'Unlimited' : String(v);
    case 'rounds': return `${v}`;
    case 'size': return (SIZES.find((x) => x.id === v) || {}).label || v;
    case 'seekSpeed': return v === 'slow' ? 'Slow' : v === 'fast' ? 'Fast' : 'Normal';
    case 'blink': return v === 'off' ? 'Off' : v === 'strong' ? 'Strong' : 'On';
    default: return typeof v === 'boolean' ? (v ? 'On' : 'Off') : String(v);
  }
}
