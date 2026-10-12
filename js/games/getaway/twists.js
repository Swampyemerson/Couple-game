// Getaway wildcard rounds ("twists"): pure, deterministic helpers shared by both phones and the Node
// unit tests. A twist is picked from (match.seed, round idx) alone, so the host's R only has to carry
// its id. The twist belongs to a PAIR of rounds (rounds 2k and 2k+1 share it, as they share the spawn and
// the safehouse landmark, so pairs scoring compares the same job): pair 0 is plain when the match has
// two or more pairs, a one-pair match (Quick chase) gets a wildcard on its pair, and the sudden-death
// decider is always plain. rulesFor() is the one place a twist
// changes the rules: the round reads its rules through it (game.js rules()).
//
// Effective-rules extras (all optional, absent = neutral): heatAdd (m) · heatK · fog (render fog
// distance ×) · copBoostK (cop boost recharge ×) · gripK (both cars' lateral grip ×) · oils (runner's
// oil slicks) · tw (the id) · pts (what the round is worth).

export const TWISTS = [
  { id: 'eagle', name: 'EAGLE EYE', chip: 'EAGLE EYE', blurb: 'The cop’s radar sees you the whole round, and the heat is 40 m further', run: 'The cop sees you on radar', cop: 'Radar always on' },
  { id: 'fog', name: 'FOG', chip: 'FOG', blurb: 'Thick fog: no radar for the cop, and the heat is 30% closer', run: 'Fog: easier to lose them', cop: 'Fog: no radar' },
  { id: 'rain', name: 'SPIKE RAIN', chip: 'SPIKE RAIN', blurb: 'The cop gets 6 spike strips, and you see every one', run: 'Watch for strips', cop: '6 spike strips' },
  { id: 'tank', name: 'BIG TANK', chip: 'BIG TANK', blurb: 'Big nitro for the runner, and the cop’s boost recharges 1.5× faster', run: 'Big nitro tank', cop: 'Faster boost' },
  { id: 'slick', name: 'SLICK STREETS', chip: 'SLICK', blurb: 'Less grip for both cars, and the runner gets 2 oil slicks', run: 'Slippery: 2 oil slicks', cop: 'Slippery roads' },
  { id: 'safe', name: 'SAFEHOUSE', chip: 'SAFEHOUSE', blurb: 'Reach the safehouse unseen to escape on the spot', run: 'Reach the safehouse unseen', cop: 'Guard the safehouse' },
  { id: 'double', name: 'DOUBLE OR NOTHING', chip: '×2', blurb: 'This round is worth 2 points', run: 'Worth 2 points', cop: 'Worth 2 points' },
];
const BY_ID = {}; for (const t of TWISTS) BY_ID[t.id] = t;
export const twistInfo = (id) => BY_ID[id] || null;

/** mulberry32 */
function rng(seed) {
  let a = (seed | 0) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** The match's twist order: a seeded shuffle of every twist id. Pair p (p ≥ 1) gets order[(p - 1) % n]: no repeats until the list runs out. */
export function twistOrder(seed, rules = null) {
  const ids = TWISTS.map((t) => t.id); const r = rng((seed | 0) ^ 0x5bd1e995);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = ids[i]; ids[i] = ids[j]; ids[j] = t; }
  return rules ? ids.filter((id) => !twistClashes(id, rules)) : ids;
}
/** A twist that would override what the couple chose in the match rules: SPIKE RAIN when the spike strips are 0, BIG TANK when the runner's nitro is off.
 *  (The picker leaves them out of the shuffle, a pure function of the match rules, so both phones agree.) */
export const twistClashes = (id, rules) => !!rules && ((id === 'rain' && rules.spikes != null && !(+rules.spikes > 0)) || (id === 'tank' && rules.nitro === 'off'));
/**
 * The twist id of round idx ('' = plain). It is chosen per pair, p = floor(idx / 2): both rounds of a pair get the
 * same one (also under score 'rounds'; then both rounds of a DOUBLE OR NOTHING pair are worth 2). opts: { sd (the
 * decider: plain), wild (false = wildcards off), pairs (how many pairs the match has: 1 = a Quick chase, whose one
 * pair gets a wildcard, never DOUBLE OR NOTHING since that would decide nothing; omitted = 2 or more), rules (the match rules: the
 * twists that would override them are left out, see twistClashes) }.
 */
export function twistFor(seed, idx, opts = {}) {
  if (opts.wild === false || opts.sd || !(idx >= 0)) return '';
  const o = twistOrder(seed, opts.rules); const p = idx >> 1;
  if (opts.pairs === 1) return o.filter((id) => id !== 'double')[0];
  return p === 0 ? '' : o[(p - 1) % o.length];
}
/** What a round is worth: 2 for DOUBLE OR NOTHING, else 1. */
export const ptsFor = (tw) => (tw === 'double' ? 2 : 1);

/**
 * The rules a round plays by: the match rules with the twist laid over them (and the sudden-death
 * decider's: heat ×0.75, at most 1 spike strip). Plain rounds return the match rules with the neutral extras.
 */
export function rulesFor(base, tw = '', sd = false) {
  const r = { ...base, heatAdd: 0, heatK: 1, fog: 1, copBoostK: 1, gripK: 1, oils: 1, tw: tw || '', pts: ptsFor(tw) };
  if (sd) { r.heatK = 0.75; r.spikes = Math.min(1, base.spikes | 0); r.pts = 1; r.tw = ''; return r; }
  switch (tw) {
    case 'eagle': r.radar = 'always'; r.heatAdd = 40; break;
    case 'fog': r.radar = 'off'; r.heatK = 0.7; r.fog = 0.55; break;
    case 'rain': r.spikes = 6; r.spikeSee = 'always'; break;
    case 'tank': r.nitro = 'big'; r.copBoostK = 1.5; break;
    case 'slick': r.gripK = 0.88; r.oils = 2; break;
    default:
  }
  return r;
}
/** The heat distance a round plays by, from the map/setting base distance. */
export const heatWith = (h, r) => Math.round(((h || 0) + (r.heatAdd || 0)) * (r.heatK || 1));

/**
 * The safehouse of a round: a landmark the runner can drive to, snapped to the road beside it.
 * lms: the map's landmarks; spawn: { runner: {x, z} }; snap(x, z) -> { x, z, d, dirt? } | null (nearest
 * drivable road point, how far off it was, and whether that road is a dirt trail: paved ones are preferred); seed/idx pick among the candidates; used: names
 * already taken this match. A home landmark (3865 Moorhead / 8524 Boulder Way) wins when it is
 * within reach. Returns { x, z, name, home } or null.
 */
export function pickSafehouse(lms, spawn, snap, seed, idx, used = []) { // (idx: the PAIR's index, so both rounds of a pair name the same landmark)
  const rs = spawn && spawn.runner ? spawn.runner : { x: 0, z: 0 };
  const cand = [];
  for (const l of lms || []) {
    if (l.far || used.includes(l.name)) continue;
    const s = snap(l.x, l.z); if (!s || !(s.d <= 110)) continue;
    const d = Math.hypot(s.x - rs.x, s.z - rs.z);
    cand.push({ l, s, d });
  }
  // a landmark whose nearest road is paved beats one that snaps to a dirt trail (when any exist in the pool): the runner has to be able to drive there
  const paved = (a) => { const q = a.filter((c) => !c.s.dirt); return q.length ? q : a; };
  const homes = cand.filter((c) => c.l.home && c.d >= 140 && c.d <= 1100);
  let pool = paved(homes);
  if (!pool.length) pool = paved(cand.filter((c) => c.d >= 200 && c.d <= 800));
  if (!pool.length) pool = paved(cand.filter((c) => c.d >= 120 && c.d <= 1300));
  if (!pool.length) return null;
  const k = Math.floor(rng((seed | 0) * 31 + idx * 7919 + 17)() * pool.length);
  const c = pool[Math.min(pool.length - 1, k)];
  return { x: Math.round(c.s.x * 10) / 10, z: Math.round(c.s.z * 10) / 10, name: c.l.name, home: c.l.home ? 1 : 0 };
}
