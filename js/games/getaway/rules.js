// Getaway settings: option lists, defaults, validation and per-device memory. The host owns
// them; they travel in `setup` (lobby, live to the guest) and inside the match start message.

export const OPTIONS = {
  roundTime: [60, 90, 120, 150, 180, 240],
  rounds: [2, 4, 6, 8],
  spikes: [0, 1, 2, 3, 4, 5, 6],
  traffic: ['off', 'light', 'normal'],
  nitro: ['off', 'normal', 'big'],
  damage: [0.5, 0.75, 1, 1.5, 2],
  radar: ['always', 'los', 'off'],
  heat: [120, 150, 180, 220, 260],
  camera: ['near', 'far'],
  spikeSee: ['near', 'always'],
  tiebreak: ['sudden', 'time'],
};
export const DEFAULTS = {
  roundTime: 150, rounds: 4, spikes: 3, traffic: 'normal', nitro: 'normal', damage: 1,
  radar: 'los', heat: 180, camera: 'near', spikeSee: 'near', tiebreak: 'sudden',
};
export const KEYS = Object.keys(OPTIONS);

export const LABELS = {
  roundTime: 'Round time', rounds: 'Rounds', spikes: 'Spike strips (cop)', traffic: 'Traffic',
  nitro: 'Runner nitro', damage: 'Damage', radar: 'Cop radar', heat: 'Lose the heat at',
  camera: 'Camera', spikeSee: 'Runner sees spikes', tiebreak: 'Level after the last round',
};
export const HINTS = {
  roundTime: 'Survive this long to escape', rounds: 'Roles swap every round',
  spikes: 'Tap the map to drop one ahead', traffic: 'Civilian cars on the roads',
  nitro: 'Boost tank, recharges', damage: 'How hard crashes hit',
  radar: 'When the cop sees the runner on the map', heat: 'Out of sight this far for 7 s',
  camera: 'Default chase camera (C switches)', spikeSee: 'Red marks on the runner’s map',
  tiebreak: 'A 0:45 decider, or the longest run wins',
};

export function fmt(k, v) {
  switch (k) {
    case 'roundTime': return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
    case 'rounds': return `${v}`;
    case 'spikes': return v === 0 ? 'None' : `${v}`;
    case 'damage': return `${v}×`;
    case 'heat': return `${v} m`;
    case 'radar': return { always: 'Always', los: 'Line of sight', off: 'Off' }[v];
    case 'spikeSee': return { near: 'Within 120 m', always: 'Always' }[v];
    case 'tiebreak': return { sudden: 'Sudden death', time: 'Longest run' }[v];
    default: return String(v).charAt(0).toUpperCase() + String(v).slice(1);
  }
}

const same = (a, b) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);

export function sanitizeRules(r) {
  const src = r && typeof r === 'object' ? r : {};
  const out = {};
  for (const k of KEYS) {
    const opts = OPTIONS[k]; const v = src[k];
    const hit = opts.find((o) => same(o, v));
    if (hit !== undefined) { out[k] = hit; continue; }
    if (typeof v === 'number' && Number.isFinite(v) && typeof opts[0] === 'number') {
      let best = opts[0]; for (const o of opts) if (Math.abs(o - v) < Math.abs(best - v)) best = o;
      out[k] = best; continue;
    }
    out[k] = DEFAULTS[k];
  }
  return out;
}

export function sanitizeSetup(s, mapIds, fallbackFirst = 'a') {
  const src = s && typeof s === 'object' ? s : {};
  return {
    map: mapIds.includes(src.map) ? src.map : mapIds[0],
    first: src.first === 'a' || src.first === 'b' ? src.first : fallbackFirst,
    rules: sanitizeRules(src.rules),
  };
}

export function stepRule(rules, k, dir) {
  const opts = OPTIONS[k]; if (!opts) return rules;
  const i = opts.findIndex((o) => same(o, rules[k]));
  const j = Math.max(0, Math.min(opts.length - 1, (i < 0 ? 0 : i) + (dir > 0 ? 1 : -1)));
  return sanitizeRules({ ...rules, [k]: opts[j] });
}
export function setRule(rules, k, raw) {
  const opts = OPTIONS[k]; if (!opts) return rules;
  const v = opts.find((o) => String(o) === String(raw));
  return v === undefined ? rules : sanitizeRules({ ...rules, [k]: v });
}

const KEY = 'getaway.setup.v1';
export function loadSaved() { try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
export function saveSetup(s) { try { localStorage.setItem(KEY, JSON.stringify({ map: s.map, rules: s.rules })); } catch { /* private mode */ } }
