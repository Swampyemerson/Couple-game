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

/** Allowed values per field (the first entry is never the default; see PRESETS.classic). */
export const OPTIONS = {
  size: SIZES.map((x) => x.id),
  rounds: [2, 4, 6],
  hide: [30, 45, 60, 75, 90, 120],
  seek: [60, 90, 120, 150, 180],
  pellets: [3, 4, 5, 6, 7, 8, 10],
  scans: [0, 1, 2, 3, 5], // 0 = unlimited
  scanCd: [10, 15, 20, 30, 45],
  escapes: [0, 1, 2, 3], // scurries + tongue-zips while being hunted
  seekSpeed: ['slow', 'normal', 'fast'],
  heartbeat: [true, false],
  blink: ['off', 'on', 'strong'],
  stamp: [true, false],
  climb: [true, false],
  minimap: [true, false],
};
export const SPEED_MUL = { slow: 0.85, normal: 1, fast: 1.2 };

// "Hard" is hard for the SEEKER (masters of disguise); "Easy" makes the hunt friendlier.
export const PRESETS = {
  easy: { size: 'huge', rounds: 4, hide: 45, seek: 120, pellets: 8, scans: 0, scanCd: 15, escapes: 0, seekSpeed: 'fast', heartbeat: false, blink: 'strong', stamp: true, climb: true, minimap: true },
  classic: { size: 'large', rounds: 4, hide: 60, seek: 90, pellets: 6, scans: 0, scanCd: 20, escapes: 1, seekSpeed: 'normal', heartbeat: true, blink: 'on', stamp: true, climb: true, minimap: true },
  hard: { size: 'medium', rounds: 4, hide: 75, seek: 90, pellets: 5, scans: 3, scanCd: 30, escapes: 2, seekSpeed: 'normal', heartbeat: true, blink: 'off', stamp: true, climb: true, minimap: false },
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
    case 'hide': case 'seek': case 'scanCd': return v >= 60 && v % 60 === 0 ? `${v / 60} min` : v >= 60 ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` : `${v} s`;
    case 'scans': return v === 0 ? 'Unlimited' : String(v);
    case 'rounds': return `${v}`;
    case 'size': return (SIZES.find((x) => x.id === v) || {}).label || v;
    case 'seekSpeed': return v === 'slow' ? 'Slow' : v === 'fast' ? 'Fast' : 'Normal';
    case 'blink': return v === 'off' ? 'Off' : v === 'strong' ? 'Strong' : 'On';
    default: return typeof v === 'boolean' ? (v ? 'On' : 'Off') : String(v);
  }
}
