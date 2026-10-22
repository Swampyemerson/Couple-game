// Battleships: hide five ships on an 8×8 chart, then take turns shelling each other's waters.
//
// Rules (pure): phase 'place' is simultaneous (each player locks in one { fleet } move), then
// 'battle'. Ships may touch but never overlap. First to sink all five wins.
//
// Rule sets live in the move log, so every match saved before they existed replays unchanged:
//  - No { rules } move = Classic: one { r, c } shot a turn. A hit fires again; a miss passes.
//  - Before they hide their own fleet, either player may send { rules: 'classic' | 'salvo' |
//    'arsenal' }. The first one applied wins; later ones are rejected. Every set uses the same
//    fleet, so a pick that lands after the other player placed never invalidates their fleet. The
//    check is on the sender's own fleet only, so replay order between the two never changes it.
//  - Salvo: { salvo: [[r, c], …] } fires one shot per ship you still have afloat, all at once,
//    then the turn passes. The first player opens with 3 ranging shots. Equal salvos: if the first
//    player sinks the last ship, the other side still fires its answer (with the ships it had as
//    that salvo flew), and sinking everything back makes it a draw.
//  - Arsenal: Classic plus a kit. { sonar: [r, c] } counts the ship squares you haven't hit yet
//    in the 3×3 around a square; it's free (you still shoot). { torp: [r, c, 'h' | 'v'] } fires
//    the three squares centred there; any hit fires again. Everyone starts with 1 sonar and
//    1 torpedo. Losing a ship gives you +1 sonar (max 3); three hits in a row earn +1 torpedo
//    (max 2).
//  - Stakes: { stake: key } (same window as { rules }) says what the winner gets. Shown on the
//    end card; it never changes the play.
//
// View: only ctx.viewer's own fleet is drawn. Enemy ships reach the DOM only once sunk (or when
// the game is over); before that the target chart shows nothing but your own shots and pings.
import { registerGame, shuffled, gameDataApi } from './core.js';

const N = 8;
const SIZES = [4, 3, 3, 2, 2];
const LETTERS = 'ABCDEFGH';
const coord = (r, c) => LETTERS[c] + (r + 1);
const foeOf = (w) => (w === 'a' ? 'b' : 'a');
const onChart = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const cellsOf = (s) => Array.from({ length: s.len }, (_, i) => (s.dir === 'v' ? [s.r + i, s.c] : [s.r, s.c + i]));
const covers = (s, r, c) => (s.dir === 'v' ? c === s.c && r >= s.r && r < s.r + s.len : r === s.r && c >= s.c && c < s.c + s.len);
const isInt = Number.isInteger;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const clone = (x) => JSON.parse(JSON.stringify(x));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const MODES = {
  classic: { name: 'Classic', line: 'One shot a turn. A hit fires again.' },
  salvo: { name: 'Salvo', line: 'Fire one shot per ship you have afloat, all at once, then it’s their go. The opening salvo is 3 ranging shots. Sink their last ship first and they still get one answer.' },
  arsenal: { name: 'Arsenal', line: 'Classic plus sonar pings and torpedoes. Lose a ship, gain a ping. Three hits in a row earn a torpedo.' },
};
const MODE_KEYS = Object.keys(MODES);
// Stakes: what the winner gets. Optional, set like the rules (before anyone hides a fleet).
const STAKES = {
  brag: 'bragging rights',
  coffee: 'coffee, made by the loser',
  dishes: 'a night off dishes',
  movie: 'picking the movie',
  rub: 'a back rub',
  breakfast: 'breakfast in bed',
  dessert: 'dessert of their choice',
  date: 'planning the next date',
};
const modeOf = (s) => (s && s.mode) || 'classic';
const KIT_MAX = { sonar: 3, torp: 2 };

// A pack of ship names. Each player gets five, seeded per match, so both phones agree.
const SHIP_NAMES = [
  'Big Spoon', 'Little Spoon', 'Forehead Kiss', 'Midnight Snack', 'Blanket Hog', 'Stolen Hoodie',
  'Pancake Sunday', 'Hot Cocoa', 'Slow Dance', 'Inside Joke', 'Second Breakfast', 'Couch Potato',
  'Sleepy Otter', 'Road Trip', 'Last Fry', 'Movie Night', 'Good Morning Text', 'Window Seat',
  'Shared Dessert', 'Cold Feet', 'Lazy Sunday', 'Pillow Fort', 'Brunch Date', 'Spare Charger',
];
const shipNames = (seed, w) => shuffled(SHIP_NAMES, `fleet-names:${seed}:${w}`).slice(0, SIZES.length);

// ── rules ────────────────────────────────────────────────────────────────
function checkFleet(fleet) {
  if (!Array.isArray(fleet) || fleet.length !== SIZES.length) throw new Error('A fleet is five ships: one 4-long, two 3-long and two 2-long.');
  for (const s of fleet) {
    if (!s || typeof s !== 'object' || !isInt(s.r) || !isInt(s.c) || !isInt(s.len) || (s.dir !== 'h' && s.dir !== 'v')) throw new Error('That fleet doesn’t make sense.');
  }
  const lens = fleet.map((s) => s.len).sort().join();
  if (lens !== [...SIZES].sort().join()) throw new Error('A fleet is five ships: one 4-long, two 3-long and two 2-long.');
  const taken = new Set();
  for (const s of fleet) {
    for (const [r, c] of cellsOf(s)) {
      if (!onChart(r, c)) throw new Error('A ship is hanging off the chart.');
      if (taken.has(r * N + c)) throw new Error('Ships can’t overlap.');
      taken.add(r * N + c);
    }
  }
  return fleet.map((s) => ({ r: s.r, c: s.c, len: s.len, dir: s.dir }));
}

/** Indices of w's ships that have been sunk. */
const sunkOf = (s, w) => s.shots.filter((x) => x.by === foeOf(w) && x.sunk >= 0).map((x) => x.sunk);
const afloat = (s, w) => SIZES.length - sunkOf(s, w).length;
/** Indices of the most recent unbroken run of shots by one player, ending before `end`. */
function lastRun(shots, end = shots.length) {
  const out = [];
  if (end <= 0) return out;
  const by = shots[end - 1].by;
  for (let i = end - 1; i >= 0 && shots[i].by === by; i--) out.unshift(i);
  return out;
}
/** The latest run of shots fired by `w` (anywhere in the log). */
function lastRunBy(shots, w) {
  for (let i = shots.length - 1; i >= 0; i--) if (shots[i].by === w) return lastRun(shots, i + 1);
  return [];
}
/** Consecutive hits by `w` at the very end of the shot log. */
function tailHits(s, w) {
  let n = 0;
  for (let i = s.shots.length - 1; i >= 0 && s.shots[i].by === w && s.shots[i].hit; i--) n++;
  return n;
}
const firedBy = (s, w) => new Set(s.shots.filter((x) => x.by === w).map((x) => x.r * N + x.c));
/** How many shots `w` must fire in a salvo right now. */
// Salvo balance (bot self-play, docs/games/fleet.md): the first player opens with 3 ranging shots,
// and a last answer flies with the ships its side had when the winning salvo was fired.
const SALVO_OPEN = 3;
const salvoSize = (s, w) => Math.min(
  s.final && w !== s.first ? s.final : w === s.first && !s.shots.some((x) => x.by === w) ? SALVO_OPEN : afloat(s, w),
  N * N - firedBy(s, w).size);
/** The squares a torpedo centred on (r, c) covers. */
const torpCells = (r, c, dir) => [-1, 0, 1].map((k) => (dir === 'v' ? [r + k, c] : [r, c + k])).filter(([rr, cc]) => onChart(rr, cc));
/** The squares a sonar ping centred on (r, c) covers. */
const sonarCells = (r, c) => { const out = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (onChart(r + dr, c + dc)) out.push([r + dr, c + dc]); return out; };

/** Fire one square. Returns the shot. Ends the game when the last ship goes down. */
function fireAt(s, who, r, c, tag) {
  const foe = foeOf(who);
  const fleet = s.fleets[foe];
  const idx = fleet.findIndex((ship) => covers(ship, r, c));
  const shot = { by: who, r, c, hit: idx >= 0 ? 1 : 0, sunk: -1 };
  if (tag) shot.t = tag;
  s.shots.push(shot);
  if (idx >= 0) {
    const mine = s.shots.filter((x) => x.by === who);
    if (cellsOf(fleet[idx]).every(([rr, cc]) => mine.some((x) => x.r === rr && x.c === cc))) shot.sunk = idx;
    if (shot.sunk >= 0 && s.kit && s.kit[foe].sonar < KIT_MAX.sonar) { s.kit[foe].sonar++; shot.kit = 'sonar'; } // damage control: a ping for the one who lost a ship
    if (afloat(s, foe) === 0) { s.phase = 'over'; s.winner = who; }
  }
  return shot;
}
/** Arsenal: three hits in a row earns a torpedo. */
function streakBonus(s, who, before) {
  if (!s.kit || s.phase !== 'battle') return;
  if (before < 3 && tailHits(s, who) >= 3 && s.kit[who].torp < KIT_MAX.torp) { s.kit[who].torp++; s.shots[s.shots.length - 1].bonus = 'torp'; }
}

const rules = {
  init: ({ first }) => ({ first, phase: 'place', turn: first, fleets: { a: null, b: null }, shots: [], winner: null }),
  next(s) {
    if (s.phase === 'place') return [s.first, foeOf(s.first)].filter((w) => !s.fleets[w]);
    if (s.phase === 'battle') return [s.turn];
    return [];
  },
  apply(s, who, mv) {
    if (!mv || typeof mv !== 'object') throw new Error('That move doesn’t make sense.');
    if (s.phase === 'place') {
      if (has(mv, 'stake')) {
        if (!has(STAKES, mv.stake)) throw new Error('Those stakes don’t exist.');
        if (s.stake) throw new Error(`The stakes are already set: ${STAKES[s.stake]}.`);
        if (s.fleets[who]) throw new Error('Too late to set the stakes: your fleet is already hidden.');
        s.stake = mv.stake;
        s.stakeBy = who;
        return s;
      }
      if (has(mv, 'rules')) {
        if (!MODE_KEYS.includes(mv.rules)) throw new Error('Those rules don’t exist.');
        if (s.mode) throw new Error(`The rules are already set: ${MODES[s.mode].name}.`);
        if (s.fleets[who]) throw new Error('Too late to change the rules: your fleet is already hidden.');
        s.mode = mv.rules;
        s.modeBy = who;
        if (mv.rules === 'arsenal') s.kit = { a: { sonar: 1, torp: 1 }, b: { sonar: 1, torp: 1 } };
        return s;
      }
      if (s.fleets[who]) throw new Error('Your fleet is already in position.');
      if (!('fleet' in mv)) throw new Error('Hide your fleet first.');
      s.fleets[who] = checkFleet(mv.fleet);
      if (s.fleets.a && s.fleets.b) { s.phase = 'battle'; s.turn = s.first; }
      return s;
    }
    if (s.phase !== 'battle') throw new Error('The battle is over.');
    if (who !== s.turn) throw new Error('Not your turn. Wait for their shot.');
    const foe = foeOf(who);
    const mode = modeOf(s);
    const fired = firedBy(s, who);

    if (mode === 'salvo') {
      const need = salvoSize(s, who);
      if (!Array.isArray(mv.salvo)) throw new Error(`Pick ${need} squares, then fire the salvo.`);
      if (mv.salvo.length !== need) throw new Error(`Your salvo is ${need} shot${need === 1 ? '' : 's'} right now.`);
      const seen = new Set();
      for (const p of mv.salvo) {
        if (!Array.isArray(p) || !isInt(p[0]) || !isInt(p[1]) || !onChart(p[0], p[1])) throw new Error('That’s off the chart.');
        if (fired.has(p[0] * N + p[1])) throw new Error(`You already fired at ${coord(p[0], p[1])}.`);
        if (seen.has(p[0] * N + p[1])) throw new Error(`${coord(p[0], p[1])} is in that salvo twice.`);
        seen.add(p[0] * N + p[1]);
      }
      const answer = afloat(s, foe); // their firepower while this salvo is in the air
      for (const [r, c] of mv.salvo) { fireAt(s, who, r, c); if (s.phase !== 'battle') break; }
      // Equal salvos: when the first player sinks the last ship, the other side still fires its
      // answer, with the ships it had as the salvo flew. Sink everything back and it's a draw.
      if (s.final) { if (s.phase === 'over') s.winner = null; else { s.phase = 'over'; s.winner = s.first; } return s; }
      if (s.phase === 'over' && who === s.first) { s.phase = 'battle'; s.winner = null; s.final = answer; }
      if (s.phase === 'battle') s.turn = foe;
      return s;
    }

    if (has(mv, 'sonar') || has(mv, 'torp')) {
      if (mode !== 'arsenal') throw new Error('There’s no kit in these rules.');
      const kit = s.kit[who];
      if (has(mv, 'sonar')) {
        const [r, c] = Array.isArray(mv.sonar) ? mv.sonar : [];
        if (!isInt(r) || !isInt(c) || !onChart(r, c)) throw new Error('That’s off the chart.');
        if (kit.sonar < 1) throw new Error('No sonar pings left.');
        kit.sonar--;
        const fleet = s.fleets[foe];
        const n = sonarCells(r, c).filter(([rr, cc]) => !fired.has(rr * N + cc) && fleet.some((ship) => covers(ship, rr, cc))).length;
        (s.scans = s.scans || []).push({ by: who, r, c, n, at: s.shots.length });
        return s; // a ping is free: still your shot
      }
      const [r, c, dir] = Array.isArray(mv.torp) ? mv.torp : [];
      if (!isInt(r) || !isInt(c) || !onChart(r, c) || (dir !== 'h' && dir !== 'v')) throw new Error('That’s off the chart.');
      if (kit.torp < 1) throw new Error('No torpedoes left.');
      const cells = torpCells(r, c, dir).filter(([rr, cc]) => !fired.has(rr * N + cc));
      if (!cells.length) throw new Error('You’ve already fired at every square on that line.');
      kit.torp--;
      const before = tailHits(s, who);
      let any = false;
      for (const [rr, cc] of cells) { if (fireAt(s, who, rr, cc, 'torp').hit) any = true; if (s.phase !== 'battle') break; }
      if (s.phase === 'battle') { if (any) streakBonus(s, who, before); else s.turn = foe; }
      return s;
    }

    const { r, c } = mv;
    if (!isInt(r) || !isInt(c) || !onChart(r, c)) throw new Error('That’s off the chart.');
    if (fired.has(r * N + c)) throw new Error(`You already fired at ${coord(r, c)}.`);
    const before = tailHits(s, who);
    const shot = fireAt(s, who, r, c);
    if (s.phase === 'battle') {
      if (shot.hit) streakBonus(s, who, before); // a hit fires again: the turn stays put
      else s.turn = foe;
    }
    return s;
  },
  result(s) {
    const w = s.winner;
    const prize = s.stake && STAKES[s.stake];
    if (!w) return { winner: null, sub: s.phase === 'over' ? `Both fleets went down in the same round of salvos.${prize ? ` ${cap(prize)} is still up for grabs.` : ''}` : undefined };
    const mine = s.shots.filter((x) => x.by === w);
    const hits = mine.filter((x) => x.hit).length;
    const left = afloat(s, w);
    // how close the other side came: their hits still needed when the last ship went down
    const theirs = firedBy(s, foeOf(w));
    const need = s.fleets[w].flatMap(cellsOf).filter(([r, c]) => !theirs.has(r * N + c)).length;
    const close = need <= 3 ? ` Photo finish: the other fleet was ${need === 1 ? 'one hit' : `${need} hits`} from winning.` : '';
    return {
      winner: w,
      sub: `Sank all five in ${mine.length} shots (${Math.round((hits / Math.max(1, mine.length)) * 100)}% on target)${left === SIZES.length ? ' without losing a ship.' : `, with ${left} ${left === 1 ? 'ship' : 'ships'} still afloat.`}${close}${prize ? ` Winner gets: ${prize}.` : ''}`,
    };
  },
  score(s) {
    if (s.phase === 'place') return null;
    return { a: afloat(s, 'a'), b: afloat(s, 'b') };
  },
};

/** Per-player numbers for one match (for the logbook). */
function statsOf(s, w) {
  const mine = s.shots.filter((x) => x.by === w);
  const hits = mine.filter((x) => x.hit).length;
  let run = 0;
  let best = 0;
  for (const x of mine) { run = x.hit ? run + 1 : 0; best = Math.max(best, run); }
  return { shots: mine.length, hits, acc: Math.round((hits / Math.max(1, mine.length)) * 100), run: best };
}

// ── drawing helpers ─────────────────────────────────────────────────────
/** An inked ship silhouette. Horizontal: bow to the right. Vertical: bow down. */
function shipSVG(len, dir, simple = false) {
  const W = len * 100;
  const hull = `M14 25H${W - 66}C${W - 30} 25 ${W - 12} 40 ${W - 4} 50C${W - 12} 60 ${W - 30} 75 ${W - 66} 75H14Q7 75 7 68V32Q7 25 14 25Z`;
  const T = (x, fwd) => `<circle cx="${x}" cy="50" r="10"/><path class="fl-gun" d="M${x + (fwd ? 9 : -9)} 50H${x + (fwd ? 30 : -30)}"/>`;
  let deck;
  if (simple) deck = `<rect x="${Math.round(W * 0.36)}" y="39" width="${len * 16}" height="22" rx="5"/>`;
  else if (len === 2) deck = `<rect x="28" y="38" width="56" height="24" rx="5"/>${T(128, true)}`;
  else if (len === 3) deck = `${T(56, false)}<rect x="94" y="36" width="72" height="28" rx="5"/>${T(206, true)}`;
  else deck = `${T(50, false)}${T(100, false)}<rect x="136" y="35" width="82" height="30" rx="5"/><rect x="228" y="41" width="22" height="18" rx="4"/>${T(296, true)}`;
  // two rows of halftone dots under the waterline (dots are a dashed round-capped line, so they stay 5 px apart at any size)
  const dots = simple ? '' : `<path class="fl-dots" d="M18 66H${W - 78}"/><path class="fl-dots is-b" d="M22 71H${W - 84}"/>`;
  const body = `<path class="fl-hull" d="${hull}"/>${dots}<path class="fl-hull-line" d="${hull}"/><g class="fl-deck">${deck}</g>`;
  return dir === 'v'
    ? `<svg viewBox="0 0 100 ${W}" aria-hidden="true" focusable="false"><g transform="translate(100 0) rotate(90)">${body}</g></svg>`
    : `<svg viewBox="0 0 ${W} 100" aria-hidden="true" focusable="false">${body}</svg>`;
}
const polar = (n, radii, rot = 0) => Array.from({ length: n }, (_, i) => {
  const a = (Math.PI * 2 * i) / n - Math.PI / 2 + rot;
  const rr = radii[i % radii.length];
  return `${(50 + rr * Math.cos(a)).toFixed(1)},${(50 + rr * Math.sin(a)).toFixed(1)}`;
}).join(' ');
/** Ink droplets that fly out of an impact: [dx, dy, r] in chart units. */
const DROPS = [[-36, -24, 4.5], [32, -30, 3.5], [40, 16, 4], [-30, 34, 3.5], [4, -42, 3], [10, 41, 4.5]];
// The spray and the ripple are plain HTML boxes (one transform + opacity animation each, on the compositor).
// Animating many little SVG shapes per splash repaints on the main thread every frame, which is what made firing janky.
const SPRAY_BG = DROPS.map(([dx, dy, r]) => `radial-gradient(circle at ${(10 + 0.8 * (50 + dx)).toFixed(1)}% ${(10 + 0.8 * (50 + dy)).toFixed(1)}%, var(--g-ink) 0 ${(r * 0.55).toFixed(1)}px, transparent ${(r * 0.55 + 0.6).toFixed(1)}px)`).join(', ');
const FX_MISS = '<i class="fl-rip" aria-hidden="true"></i><i class="fl-spray" aria-hidden="true"></i>';
const FX_HIT = '<i class="fl-spray" aria-hidden="true"></i>';
const BURST = (() => {
  const outer = [42, 33, 45, 35, 41, 31, 44, 36];
  const pts = polar(16, Array.from({ length: 16 }, (_, i) => (i % 2 ? 17 : outer[i / 2])));
  // the yellow plate is printed a hair off register, so it peeks out from behind the red burst
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><polygon class="fl-plate" points="${pts}" transform="translate(3.5 3)"/><polygon class="fl-blot is-hit" points="${polar(14, [30, 22, 33, 21, 31, 24, 34, 22])}"/><polygon class="fl-burst" points="${pts}"/><circle class="fl-core" cx="50" cy="50" r="11"/></svg>`;
})();
const SPLASH = `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><polygon class="fl-blot" points="${polar(14, [23, 16, 25, 15, 24, 17, 26, 16, 23, 15, 25, 17, 24, 16])}"/><circle class="fl-ring" cx="50" cy="50" r="22"/><circle class="fl-dot" cx="50" cy="50" r="8"/></svg>`;
const WRECK = '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path class="fl-x-under" d="M31 31L69 69M69 31L31 69"/><path class="fl-x" d="M31 31L69 69M69 31L31 69"/></svg>';

const at = (r, c, w = 1, h = 1) => `--r:${r};--c:${c};--w:${w};--h:${h}`;
const shipAt = (s) => at(s.r, s.c, s.dir === 'h' ? s.len : 1, s.dir === 'v' ? s.len : 1);
/** The dashed box a sonar ping drew, with its count. */
function scanBox(x, cls = '') {
  const r0 = Math.max(0, x.r - 1);
  const c0 = Math.max(0, x.c - 1);
  const r1 = Math.min(N - 1, x.r + 1);
  const c1 = Math.min(N - 1, x.c + 1);
  return `<span class="fl-scan${cls}" style="${at(r0, c0, c1 - c0 + 1, r1 - r0 + 1)}"><b>${x.n}</b></span>`;
}

function chartHTML({ cls = '', cells, layer = '', extra = '' }) {
  return `<div class="fl-chart ${cls}">
    <div class="fl-lab fl-lab-c" aria-hidden="true">${[...LETTERS].map((l) => `<span>${l}</span>`).join('')}</div>
    <div class="fl-lab fl-lab-r" aria-hidden="true">${Array.from({ length: N }, (_, i) => `<span>${i + 1}</span>`).join('')}</div>
    <div class="fl-grid">${cells}<i class="fl-sea" aria-hidden="true"></i><div class="fl-layer">${layer}</div></div>${extra}
  </div>`;
}
const plainCells = () => '<span class="fl-cell"></span>'.repeat(N * N);
/** The 64 squares of a chart you tap. Built once per screen, then only patched. */
const tapCells = (cls = 'fl-cell', off = true) => {
  let out = '';
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) out += `<button type="button" class="${cls}" data-r="${r}" data-c="${c}" aria-label="${coord(r, c)}"${off ? ' disabled' : ''}></button>`;
  return out;
};

/** A random legal fleet (UI only, so Math.random is fine). Prefers ships that don't touch. */
function randomFleet() {
  for (let attempt = 0; attempt < 400; attempt++) {
    const spread = attempt < 300;
    const occ = new Set();
    const halo = new Set();
    const out = [];
    for (const len of SIZES) {
      let done = false;
      for (let t = 0; t < 80 && !done; t++) {
        const dir = Math.random() < 0.5 ? 'h' : 'v';
        const r = Math.floor(Math.random() * (dir === 'v' ? N - len + 1 : N));
        const c = Math.floor(Math.random() * (dir === 'h' ? N - len + 1 : N));
        const cells = cellsOf({ r, c, len, dir });
        const block = spread ? halo : occ;
        if (cells.some(([rr, cc]) => block.has(rr * N + cc))) continue;
        for (const [rr, cc] of cells) {
          occ.add(rr * N + cc);
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) halo.add((rr + dr) * N + (cc + dc));
        }
        out.push({ r, c, dir });
        done = true;
      }
      if (!done) break;
    }
    if (out.length === SIZES.length) return out;
  }
  return null;
}

// Placement drafts outlive the screen (close a match mid-placement and come back: your ships are
// where you left them). Memory only, this tab only; a draft is dropped once that fleet is hidden.
const DRAFTS = new Map();

// ── styles ───────────────────────────────────────────────────────────────
// Printed look: the sea is wave lines in a player's ink on grainy paper, ships are two-plate pieces
// (ink, halftone dots under the waterline, a hard shadow), headings and stamps are off register.
// Motion is transform + opacity only; every animation has a reduced-motion off switch at the end.
const CSS = `
.g-fleet { --gut: 14px; --fl-edge: var(--g-edge, var(--g-ink)); --tooth: var(--g-grain) 0 0 / var(--g-grain-size); position: relative; container-type: inline-size; width: 100%; margin: 0 auto; padding: 0 0 4px; color: var(--g-ink); font-family: var(--g-font-body); -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.g-fleet.is-hidden { min-height: 240px; }
.g-fleet [hidden] { display: none !important; }
.g-fleet .fl-place, .g-fleet .fl-battle, .g-fleet .fl-wait { --cell: min(52px, calc((100cqw - var(--gut)) / 8)); --mini: clamp(17px, calc(100cqw / 19), 26px); }
.g-fleet .fl-place { --cell: min(40px, calc((100cqw - var(--gut)) / 8)); }
.g-fleet h2, .g-fleet h3, .g-fleet p { margin: 0; }

/* ── chart: the sea is printed wave lines in an ink, on paper with some tooth ── */
.g-fleet .fl-chart { --cs: var(--cell); --sea: var(--g-muted); position: relative; display: grid; grid-template-columns: var(--gut) auto; grid-template-rows: calc(var(--gut) - 1px) auto; width: max-content; }
.g-fleet .fl-chart.is-mini { --cs: var(--mini); --gut: 12px; }
.g-fleet[data-viewer="a"] .fl-home-chart { --sea: var(--p-a); } .g-fleet[data-viewer="b"] .fl-home-chart { --sea: var(--p-b); }
.g-fleet[data-viewer="a"] .fl-target-chart { --sea: var(--p-b); } .g-fleet[data-viewer="b"] .fl-target-chart { --sea: var(--p-a); }
.g-fleet .fl-lab { display: grid; font: 900 9px/1 var(--g-font-display); color: var(--g-muted); }
.g-fleet .is-mini .fl-lab { font-size: 8px; }
.g-fleet .fl-lab span { display: grid; place-items: center; transition: color .12s; }
.g-fleet .fl-lab span.is-on { color: var(--g-ink); }
.g-fleet .fl-lab-c { grid-column: 2; grid-row: 1; grid-template-columns: repeat(8, var(--cs)); padding-bottom: 3px; }
.g-fleet .fl-lab-r { grid-column: 1; grid-row: 2; grid-template-rows: repeat(8, var(--cs)); padding-right: 4px; }
.g-fleet .fl-lab-r span { justify-content: end; }
.g-fleet .fl-grid {
  --wave: color-mix(in srgb, var(--sea) 24%, transparent);
  grid-column: 2; grid-row: 2; position: relative; display: grid; grid-template-columns: repeat(8, var(--cs)); grid-auto-rows: var(--cs);
  isolation: isolate; will-change: transform; background: var(--g-card); /* its own layer, so the sink jolt never re-rasterises it */
}
/* The printed sea lives on its own layer: painted once, then only composited. (Tiny repeating gradients
   in the grid's own background were re-rasterised every time a square or mark changed.) */
.g-fleet .fl-sea {
  position: absolute; inset: 0; z-index: -1; pointer-events: none; will-change: transform;
  background:
    var(--tooth),
    radial-gradient(circle at 50% 100%, transparent 5.4px, var(--wave) 5.9px 6.7px, transparent 7.2px) 0 0 / 20px 10px,
    radial-gradient(circle at 50% 100%, transparent 5.4px, var(--wave) 5.9px 6.7px, transparent 7.2px) 10px 5px / 20px 10px,
    var(--g-card);
}
/* your own waters are the halftone plate: dots in your ink */
.g-fleet .fl-home-chart .fl-sea { background: var(--tooth), var(--dots, var(--g-halftone)) 0 0 / 5px 5px, var(--g-card); }
.g-fleet .fl-home-chart.is-mini .fl-sea { background-size: var(--g-grain-size), 4px 4px, auto; }
.g-fleet[data-viewer="a"] .fl-home-chart { --dots: var(--g-halftone-a); } .g-fleet[data-viewer="b"] .fl-home-chart { --dots: var(--g-halftone-b); }
.g-fleet .fl-grid::before { content: ''; position: absolute; inset: -2px; border: 2px solid var(--g-ink); box-shadow: var(--g-shadow); pointer-events: none; z-index: 4; }
.g-fleet .fl-grid::after { content: ''; position: absolute; inset: -2px; border: 1.5px solid color-mix(in srgb, var(--p-b) 70%, transparent); transform: translate(1.5px, 1px); pointer-events: none; z-index: 4; }
.g-fleet .fl-cell { display: block; width: var(--cs); height: var(--cs); margin: 0; padding: 0; border: 0; border-radius: 0; background: none; color: inherit; font: inherit; position: relative; box-shadow: inset -1px -1px 0 var(--g-line); touch-action: manipulation; -webkit-appearance: none; appearance: none; }
.g-fleet .fl-cell:nth-child(8n+4) { box-shadow: inset -1px -1px 0 var(--g-line), inset -2px 0 0 var(--g-line); }
.g-fleet .fl-cell:nth-child(n+25):nth-child(-n+32) { box-shadow: inset -1px -2px 0 var(--g-line); }
.g-fleet .fl-cell:nth-child(28) { box-shadow: inset -2px -2px 0 var(--g-line); }
.g-fleet .fl-cell:focus { outline: none; }
.g-fleet .fl-cell:focus-visible { outline: 3px solid var(--g-hl); outline-offset: -3px; z-index: 1; }
.g-fleet .fl-layer { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.g-fleet .fl-ship, .g-fleet .fl-mark, .g-fleet .fl-hl, .g-fleet .fl-scan, .g-fleet .fl-scope { position: absolute; left: calc(var(--c) * 12.5%); top: calc(var(--r) * 12.5%); width: calc(var(--w) * 12.5%); height: calc(var(--h) * 12.5%); }

/* ── ships: ink, halftone dots under the waterline, a hard shadow ── */
.g-fleet .fl-ship, .g-fleet .fl-dock-ship, .g-fleet .fl-ghost, .g-fleet .fl-ro { --ship: var(--g-muted); }
.g-fleet .p-a { --ship: var(--p-a); } .g-fleet .p-b { --ship: var(--p-b); }
.g-fleet .fl-ship { display: block; margin: 0; padding: 0; border: 0; background: none; color: inherit; filter: drop-shadow(2px 2px 0 var(--fl-edge)); }
.g-fleet .is-mini .fl-ship { filter: drop-shadow(1px 1px 0 var(--fl-edge)); }
.g-fleet .fl-ship svg, .g-fleet .fl-mark svg, .g-fleet .fl-dock-ship svg, .g-fleet .fl-ghost svg, .g-fleet .fl-ro svg { display: block; width: 100%; height: 100%; overflow: visible; }
.g-fleet .fl-hull { fill: var(--ship); stroke: none; }
.g-fleet .fl-hull-line { fill: none; stroke: var(--g-ink); stroke-width: 2; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.g-fleet .fl-dots { fill: none; stroke: var(--fl-edge); stroke-opacity: .55; stroke-width: 2; stroke-linecap: round; stroke-dasharray: 0 5; vector-effect: non-scaling-stroke; }
.g-fleet .fl-dots.is-b { stroke-dashoffset: 2.5; }
.g-fleet .fl-deck > * { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.g-fleet .fl-deck > .fl-gun { fill: none; stroke-width: 2.5; stroke-linecap: round; }
.g-fleet .is-mini .fl-hull-line, .g-fleet .fl-ro .fl-hull-line { stroke-width: 1.5; }
.g-fleet .is-mini .fl-deck > *, .g-fleet .fl-ro .fl-deck > * { stroke-width: 1; }
/* a wreck lies low and a little askew, whether it just sank or is being redrawn */
.g-fleet .fl-ship.is-wreck { transform: translateY(3%) rotate(-1.8deg); }
.g-fleet .fl-ship.is-wreck .fl-hull { fill: color-mix(in srgb, var(--ship) 52%, var(--fl-edge)); }
.g-fleet .fl-ship.is-wreck .fl-deck > * { fill: color-mix(in srgb, var(--g-card) 50%, var(--fl-edge)); }
.g-fleet .fl-ship.is-ghost { filter: none; }
.g-fleet .fl-ship.is-ghost .fl-hull { fill: color-mix(in srgb, var(--ship) 28%, transparent); }
.g-fleet .fl-ship.is-ghost .fl-hull-line { stroke-dasharray: 5 3; }
.g-fleet .fl-ship.is-ghost .fl-deck, .g-fleet .fl-ship.is-ghost .fl-dots { display: none; }
.g-fleet .fl-scope { z-index: 1; }
.g-fleet .fl-scope::after { content: ''; position: absolute; inset: 22% 8%; border: 1.5px dotted color-mix(in srgb, var(--g-ink) 38%, transparent); border-radius: 999px; }

/* ── marks: ink splats that stay as a printed stain ── */
.g-fleet .fl-mark { display: grid; place-items: center; z-index: 3; }
.g-fleet .fl-mark svg { width: 80%; height: 80%; }
.g-fleet .fl-plate { fill: var(--g-hl); }
.g-fleet .fl-burst { fill: var(--g-bad); stroke: var(--g-ink); stroke-width: 1.5; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.g-fleet .fl-core { fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 1; vector-effect: non-scaling-stroke; }
.g-fleet .fl-blot { fill: color-mix(in srgb, var(--g-muted) 20%, transparent); stroke: none; }
.g-fleet .fl-blot.is-hit { fill: color-mix(in srgb, var(--g-bad) 38%, transparent); }
.g-fleet .fl-ring { fill: none; stroke: var(--g-muted); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.g-fleet .fl-dot { fill: var(--g-muted); }
.g-fleet .fl-rip, .g-fleet .fl-spray { position: absolute; pointer-events: none; opacity: 0; }
.g-fleet .fl-rip { inset: 12%; border: 2px solid var(--g-ink); border-radius: 50%; }
.g-fleet .fl-spray { inset: 0; background: ${SPRAY_BG}; background-repeat: no-repeat; }
.g-fleet .fl-x-under { fill: none; stroke: var(--g-ink); stroke-width: 6; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.g-fleet .fl-x { fill: none; stroke: var(--g-card); stroke-width: 2.5; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.g-fleet .is-mini .fl-x-under { stroke-width: 4; } .g-fleet .is-mini .fl-x { stroke-width: 1.5; }
.g-fleet .fl-hl { background: color-mix(in srgb, var(--g-hl) 62%, transparent); box-shadow: inset 0 0 0 1.5px var(--g-ink); z-index: 2; }
.g-fleet .fl-hl.is-last { box-shadow: inset 0 0 0 2.5px var(--g-ink); }
.g-fleet .fl-target .fl-mark.is-last::after { content: ''; position: absolute; inset: 2px; border: 2px solid var(--g-ink); border-radius: 50%; }
.g-fleet .fl-scan { z-index: 3; border: 2px dashed var(--g-ink); border-radius: 8px; background: color-mix(in srgb, var(--g-hl) 14%, transparent); }
.g-fleet .fl-scan b { position: absolute; right: -9px; top: -9px; min-width: 22px; height: 22px; padding: 0 4px; box-sizing: border-box; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-hl); color: var(--g-on-ink); font: 900 .78rem/18px var(--g-font-body); text-align: center; }
.g-fleet .fl-scan.is-theirs { border-width: 1.5px; background: none; border-radius: 4px; }
.g-fleet .fl-scan.is-theirs b { right: -6px; top: -6px; min-width: 14px; height: 14px; border-width: 1.5px; font-size: .55rem; line-height: 11px; padding: 0 2px; }

/* ── target chart: aiming ── */
.g-fleet .fl-target .fl-cell:not(:disabled) { cursor: crosshair; }
.g-fleet .fl-target .fl-cell::before { content: ''; position: absolute; inset: 18%; border: 2.5px solid var(--g-ink); border-radius: 50%; opacity: 0; transform: scale(.5); transition: transform .12s, opacity .12s; }
.g-fleet .fl-target .fl-cell::after { content: ''; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: var(--g-ink); opacity: 0; transition: opacity .12s; }
.g-fleet .fl-target .fl-cell:not(:disabled):active, .g-fleet .fl-target .fl-cell.is-aim, .g-fleet .fl-target .fl-cell.is-pick { background: color-mix(in srgb, var(--g-hl) 55%, transparent); }
.g-fleet .fl-target .fl-cell:not(:disabled):active::before, .g-fleet .fl-target .fl-cell.is-aim::before, .g-fleet .fl-target .fl-cell.is-pick::before { opacity: 1; transform: none; }
.g-fleet .fl-target .fl-cell:not(:disabled):active::after, .g-fleet .fl-target .fl-cell.is-aim::after, .g-fleet .fl-target .fl-cell.is-pick::after { opacity: 1; }
.g-fleet .fl-target .fl-cell:not(:disabled):active::before { transform: scale(.82); transition-duration: .05s; }
.g-fleet .fl-target .fl-cell.is-pick { background: var(--g-hl); }
.g-fleet .fl-target .fl-cell.is-aim:disabled::before { border-style: dashed; }
.g-fleet .fl-target .fl-cell.is-zone { background: color-mix(in srgb, var(--g-hl) 42%, transparent); }
.g-fleet .fl-target .fl-cell.is-zone.is-core::before { opacity: 1; transform: none; border-style: dashed; }
@media (hover: hover) {
  .g-fleet .fl-target .fl-cell:not(:disabled):hover { background: color-mix(in srgb, var(--g-hl) 55%, transparent); }
  .g-fleet .fl-target .fl-cell:not(:disabled):hover::before { opacity: 1; transform: none; }
  .g-fleet .fl-target .fl-cell:not(:disabled):hover::after { opacity: 1; }
}

/* ── headers, pills, log ── */
.g-fleet .fl-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-left: var(--gut); margin-bottom: 3px; min-height: 22px; }
.g-fleet .fl-h { display: flex; align-items: center; gap: 7px; font: 900 .74rem/1.1 var(--g-font-display); text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
.g-fleet .fl-sw { width: 12px; height: 12px; flex: none; background: var(--ship); border: 2px solid var(--g-ink); border-radius: 3px; }
.g-fleet .fl-pill { flex: none; font: 800 .8rem/1 var(--g-font-body); padding: 7px 11px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--tooth), var(--g-card); color: var(--g-ink); white-space: nowrap; }
.g-fleet .fl-pill.is-mode { background: var(--tooth), var(--g-hl); color: var(--g-on-ink); }
.g-fleet .fl-target.is-live .fl-grid::before { box-shadow: 5px 5px 0 0 var(--g-hl), 5px 5px 0 2px var(--fl-edge); }
.g-fleet .fl-target { margin-bottom: 4px; }
.g-fleet .fl-target:not(.is-live) .fl-cell { cursor: default; }
.g-fleet .fl-pill.is-quiet { border-color: var(--g-line); color: var(--g-muted); }
.g-fleet .fl-log { padding: 6px 10px; border: 2px solid var(--g-ink); border-radius: var(--g-radius); background: var(--tooth), var(--g-card); font-size: .82rem; line-height: 1.45; display: flex; flex-direction: column; gap: 2px; min-height: 38px; justify-content: center; }
.g-fleet .fl-log b { font-weight: 900; }
.g-fleet .fl-tok { display: inline-block; padding: 0 7px; margin: 1px 2px 1px 0; border: 1.5px solid var(--g-ink); border-radius: 999px; font: 800 .76rem/1.55 var(--g-font-body); background: var(--g-card); color: var(--g-ink); white-space: nowrap; }
.g-fleet .fl-tok.is-hit { background: var(--g-bad); color: var(--g-card); }
.g-fleet .fl-tok.is-sunk { background: var(--g-ink); color: var(--g-card); }
.g-fleet .fl-tok.is-ping { background: var(--g-hl); color: var(--g-on-ink); border-style: dashed; }
.g-fleet .fl-who-a { color: var(--p-a-text, var(--p-a)); } .g-fleet .fl-who-b { color: var(--p-b-text, var(--p-b)); }

/* ── firing controls: salvo bar + arsenal kit ── */
.g-fleet .fl-tools { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; padding-left: var(--gut); }
.g-fleet .fl-fire, .g-fleet .fl-tray { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.g-fleet .fl-fire .gm-btn { min-height: 44px; }
.g-fleet .fl-fire .gm-btn:disabled, .g-fleet .fl-wpn:disabled { opacity: .4; cursor: default; }
.g-fleet .fl-fire-n { flex: 1; font: 800 .86rem/1.2 var(--g-font-body); white-space: nowrap; }
.g-fleet .fl-fire-n b { font: 900 1.15rem/1 var(--g-font-display); }
.g-fleet .fl-wpn { min-height: 44px; min-width: 44px; padding: 0 12px; display: inline-flex; align-items: center; gap: 6px; border: 2px solid var(--g-ink); border-radius: var(--g-radius-sm, 6px); background: var(--tooth), var(--g-card); color: var(--g-ink); font: 800 .84rem/1 var(--g-font-body); box-shadow: var(--g-shadow-sm); touch-action: manipulation; -webkit-appearance: none; appearance: none; }
.g-fleet .fl-wpn b { display: inline-grid; place-items: center; min-width: 20px; height: 20px; border-radius: 999px; background: var(--g-ink); color: var(--g-card); font: 900 .72rem/1 var(--g-font-body); }
.g-fleet .fl-wpn[aria-pressed="true"] { background: var(--tooth), var(--g-hl); color: var(--g-on-ink); transform: translate(2px, 2px); box-shadow: none; }
.g-fleet .fl-wpn:not(:disabled):active { transform: translate(2px, 2px); box-shadow: none; }
.g-fleet .fl-tip { font-size: .8rem; color: var(--g-muted); line-height: 1.35; }
.g-fleet .fl-tip b { color: var(--g-ink); }
.g-fleet .fl-kit { font: 700 .78rem/1.3 var(--g-font-body); color: var(--g-muted); }

/* ── roster ── */
.g-fleet .fl-side { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.g-fleet .fl-side .fl-head { padding-left: 0; min-height: 0; margin: 0; }
.g-fleet .fl-roster { display: flex; flex-wrap: wrap; gap: 9px 12px; align-items: center; }
.g-fleet .fl-ro { position: relative; width: calc(var(--len) * 16px); height: 16px; filter: drop-shadow(1px 1px 0 var(--fl-edge)); }
.g-fleet .fl-ro.is-sunk svg { opacity: .35; }
.g-fleet .fl-ro.is-sunk::after { content: ''; position: absolute; left: -2px; right: -2px; top: 50%; height: 2.5px; margin-top: -1.25px; background: var(--g-ink); border-radius: 2px; transform: rotate(-12deg); transform-origin: left center; }
.g-fleet .fl-count { font: 700 .8rem/1.25 var(--g-font-body); color: var(--g-muted); }

/* ── logbook ── */
.g-fleet .fl-book-slot { display: contents; }
.g-fleet .fl-book { grid-area: book; padding: 10px 12px 8px; border: 2px solid var(--g-ink); border-radius: var(--g-radius); background: var(--tooth), var(--g-card); box-shadow: var(--g-shadow); }
.g-fleet .fl-book .fl-head { padding-left: 0; margin-bottom: 6px; }
.g-fleet .fl-book table { width: 100%; border-collapse: collapse; font-size: .8rem; }
.g-fleet .fl-book th, .g-fleet .fl-book td { padding: 5px 4px; text-align: right; border-top: 1px solid var(--g-line); font-variant-numeric: tabular-nums; }
.g-fleet .fl-book thead th { border-top: 0; font: 900 .74rem/1.2 var(--g-font-body); padding-top: 0; }
.g-fleet .fl-book tbody th { text-align: left; font-weight: 700; color: var(--g-muted); }
.g-fleet .fl-book td { font: 900 .86rem/1.2 var(--g-font-body); white-space: nowrap; }
.g-fleet .fl-new { display: inline-block; margin-left: 4px; padding: 1px 4px; border: 1.5px solid var(--g-ink); border-radius: 4px; background: var(--g-hl); color: var(--g-on-ink); font: 900 .58rem/1.2 var(--g-font-body); text-transform: uppercase; letter-spacing: .04em; vertical-align: 1px; }
.g-fleet .fl-book-note { padding-top: 6px; font-size: .8rem; font-weight: 700; }
.g-fleet .fl-captain { font-size: .8rem; font-weight: 700; line-height: 1.35; padding: 0 0 8px var(--gut); color: var(--g-ink); }

/* ── stamps: printed on, a little off register ── */
.g-fleet .fl-stamp { position: absolute; left: calc(50% + var(--gut) / 2); top: calc(50% + var(--gut) / 2); z-index: 6; pointer-events: none; padding: 7px 16px 9px; border: 3px solid var(--g-ink); border-radius: 6px; background: var(--tooth), var(--g-hl); color: var(--g-on-ink); box-shadow: 4px 4px 0 var(--fl-edge); text-align: center; white-space: nowrap; font: 900 clamp(1.25rem, 6.4cqw, 1.9rem)/1.05 var(--g-font-display); text-transform: uppercase; letter-spacing: .03em; transform: translate(-50%, -50%) rotate(-8deg); animation: gfleet-stamp 1.9s cubic-bezier(.2, .9, .3, 1.2) both; }
.g-fleet .fl-stamp::before { content: ''; position: absolute; inset: -3px; border: 1.5px solid color-mix(in srgb, var(--p-b) 75%, transparent); border-radius: 6px; transform: translate(2.5px, 2px); pointer-events: none; }
.g-fleet .fl-stamp small { display: block; margin-top: 5px; max-width: 72cqw; margin-inline: auto; white-space: normal; font: 800 max(.72rem, .4em)/1.2 var(--g-font-body); letter-spacing: .06em; }
.g-fleet .fl-stamp.is-bad { background: var(--tooth), var(--g-bad); color: var(--g-on-ink); }
.g-fleet .is-mini .fl-stamp { font-size: .9rem; padding: 4px 8px 5px; border-width: 2px; box-shadow: 2px 2px 0 var(--fl-edge); }

/* ── placement ── */
.g-fleet .fl-place { display: grid; gap: 12px; justify-items: center; }
.g-fleet .fl-main, .g-fleet .fl-aside { width: calc(var(--cell) * 8 + var(--gut)); max-width: 100%; }
.g-fleet .fl-aside { padding-left: var(--gut); display: flex; flex-direction: column; gap: 12px; }
.g-fleet .fl-hint { font-size: .84rem; color: var(--g-muted); padding: 0 0 10px var(--gut); line-height: 1.35; }
.g-fleet .fl-hint b { color: var(--g-ink); }
.g-fleet .fl-setup { display: flex; flex-wrap: nowrap; gap: 4px 7px; align-items: center; padding-left: var(--gut); margin: 2px 0 5px; }
.g-fleet .fl-rules { display: flex; gap: 5px; flex: 1 1 auto; min-width: 0; }
.g-fleet .fl-rule { flex: 1 1 0; min-width: 0; min-height: 42px; padding: 0 4px; border: 2px solid var(--g-ink); border-radius: 10px; background: var(--tooth), var(--g-card); color: var(--g-ink); font: 800 .8rem/1 var(--g-font-body); box-shadow: var(--g-shadow-sm); white-space: nowrap; touch-action: manipulation; -webkit-appearance: none; appearance: none; }
.g-fleet .fl-rule[aria-pressed="true"] { background: var(--tooth), var(--g-hl); color: var(--g-on-ink); }
.g-fleet .fl-rule:not(:disabled):active { transform: translate(2px, 2px); box-shadow: none; }
.g-fleet .fl-stake { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; color: var(--g-muted); font-size: .76rem; }
.g-fleet .fl-stake .g-label { white-space: nowrap; } @container (max-width: 380px) { .g-fleet .fl-stake .g-label { display: none; } }
.g-fleet .fl-stake select { width: clamp(104px, 33vw, 150px); min-height: 42px; padding: 0 8px; border: 2px solid var(--g-ink); border-radius: 10px; background: var(--tooth), var(--g-card); color: var(--g-ink); font: 800 14px/1.1 var(--g-font-body); box-shadow: var(--g-shadow-sm); touch-action: manipulation; }
.g-fleet .fl-setup .fl-rules-note { margin: 0; padding: 0; flex: 1 1 100%; }
.g-fleet .fl-rules-note { font-size: .8rem; line-height: 1.3; color: var(--g-muted); padding: 0 0 6px var(--gut); }
.g-fleet .fl-rules-note b { color: var(--g-ink); }
.g-fleet .is-edit .fl-ship { pointer-events: auto; cursor: grab; touch-action: none; -webkit-appearance: none; appearance: none; }
.g-fleet .is-edit .fl-ship:focus-visible { outline: 3px solid var(--g-hl); outline-offset: 2px; }
.g-fleet .is-edit .fl-ship:active { filter: drop-shadow(1px 1px 0 var(--fl-edge)); }
.g-fleet .is-edit .fl-cell { cursor: pointer; }
.g-fleet .fl-ship.is-lifted { opacity: .25; filter: none; }
/* the drag preview moves by transform only: its size is set when the ship changes, its square when the finger crosses a line */
.g-fleet .fl-preview { position: absolute; left: 0; top: 0; width: calc(var(--w) * var(--cs)); height: calc(var(--h) * var(--cs)); transform: translate(calc(var(--c) * var(--cs)), calc(var(--r) * var(--cs))); transition: transform .09s var(--g-ease-out); will-change: transform; box-sizing: border-box; z-index: 3; border: 2.5px dashed var(--g-ink); background: color-mix(in srgb, var(--g-good) 30%, transparent); }
.g-fleet .fl-preview.is-bad { border-color: var(--g-bad); background: color-mix(in srgb, var(--g-bad) 28%, transparent); }
.g-fleet .fl-dock { display: flex; flex-wrap: wrap; gap: 10px 10px; min-height: var(--cell); }
.g-fleet .fl-dock-ship, .g-fleet .fl-slot { position: relative; width: calc(var(--len) * var(--cell)); height: var(--cell); flex: none; }
.g-fleet .fl-dock-ship { display: block; margin: 0; padding: 0; border: 0; background: none; color: inherit; touch-action: none; cursor: grab; filter: drop-shadow(2px 2px 0 var(--fl-edge)); transition: transform .15s var(--g-ease-out); -webkit-appearance: none; appearance: none; }
.g-fleet .fl-dock-ship:active { transform: translate(1px, 1px); filter: drop-shadow(1px 1px 0 var(--fl-edge)); transition-duration: .04s; }
.g-fleet .fl-dock-ship.is-sel { transform: translateY(-4px); filter: drop-shadow(3px 5px 0 var(--fl-edge)); }
.g-fleet .fl-dock-ship.is-sel::after { content: ''; position: absolute; left: 12%; right: 12%; bottom: -9px; height: 4px; border-radius: 2px; background: var(--g-hl); box-shadow: 0 0 0 1.5px var(--g-ink); }
.g-fleet .fl-dock-ship.is-lifted { opacity: .35; }
.g-fleet .fl-dock-ship:focus-visible { outline: 3px solid var(--g-hl); outline-offset: 3px; }
.g-fleet .fl-slot { border: 2px dashed var(--g-line); border-radius: 10px; }
.g-fleet .fl-dock-done { width: 100%; min-height: var(--cell); display: grid; place-items: center; text-align: center; font: 700 .9rem/1.3 var(--g-font-body); color: var(--g-muted); border: 2px dashed var(--g-line); border-radius: var(--g-radius); padding: 8px; }
.g-fleet .fl-named { font: 700 .8rem/1.3 var(--g-font-body); color: var(--g-muted); }
.g-fleet .fl-named b { color: var(--g-ink); }
.g-fleet .fl-note { font-size: .84rem; font-weight: 800; color: var(--g-muted); }
.g-fleet .fl-actions { display: flex; gap: 10px; }
.g-fleet .fl-actions .gm-btn { flex: 1; min-height: 48px; }
.g-fleet .fl-actions .gm-btn:disabled { opacity: .4; cursor: default; }
/* the ship in your hand: positioned by transform only (left/top stay 0) */
.g-fleet .fl-ghost { position: absolute; left: 0; top: 0; z-index: 30; pointer-events: none; will-change: transform; filter: drop-shadow(4px 5px 0 var(--fl-edge)); }
.g-fleet .fl-ghost svg { animation: gfleet-lift .18s var(--g-ease-spring) both; }
.g-fleet .fl-wait .fl-note-card { padding: 12px 14px; border: 2px solid var(--g-ink); border-radius: var(--g-radius); background: var(--tooth), var(--g-card); box-shadow: var(--g-shadow); text-align: center; display: flex; flex-direction: column; gap: 6px; }
.g-fleet .fl-wait .fl-note-card b { font: 900 1rem/1.2 var(--g-font-display); }
.g-fleet .fl-wait .fl-note-card span { color: var(--g-muted); font-size: .88rem; }

/* ── battle layout: stacked on phones, side by side on wide screens ── */
.g-fleet .fl-battle { display: grid; grid-template-columns: max-content minmax(0, 1fr); grid-template-areas: "log log" "target target" "home side"; gap: 8px 14px; width: calc(var(--cell) * 8 + var(--gut)); max-width: 100%; margin: 0 auto; align-items: start; }
.g-fleet .fl-battle.has-book { grid-template-areas: "log log" "target target" "home side" "book book"; }
.g-fleet .fl-battle .fl-target { grid-area: target; position: relative; }
.g-fleet .fl-battle .fl-log { grid-area: log; }
.g-fleet .fl-battle .fl-home { grid-area: home; }
.g-fleet .fl-battle .fl-side { grid-area: side; }
.g-fleet .fl-home .fl-head { padding-left: 12px; min-height: 0; margin-bottom: 2px; }
.g-fleet .fl-wait { display: grid; gap: 14px; justify-items: center; }
.g-fleet .fl-wait > * { width: calc(var(--cell) * 8 + var(--gut)); max-width: 100%; }
@container (min-width: 600px) {
  .g-fleet .fl-battle { --cell: min(54px, calc((58cqw - var(--gut)) / 8)); --mini: min(30px, calc((42cqw - 44px) / 8)); width: auto; grid-template-areas: "target log" "target home" "target side"; grid-template-rows: auto auto 1fr; gap: 14px 22px; justify-content: center; }
  .g-fleet .fl-battle.has-book { grid-template-areas: "target log" "target home" "target side" "target book"; grid-template-rows: auto auto auto 1fr; }
  .g-fleet .fl-log { align-self: start; }
  .g-fleet .fl-target .fl-head { min-height: 30px; }
  .g-fleet .fl-place { --cell: min(54px, calc((60cqw - var(--gut)) / 8)); grid-template-columns: max-content minmax(0, 1fr); gap: 22px; align-items: center; justify-content: center; }
  .g-fleet .fl-place .fl-aside { width: auto; max-width: calc(var(--cell) * 5); padding-left: 0; }
}
/* phones on their side: size the chart by height too, so all eight rows fit on screen */
@media (orientation: landscape) and (max-height: 560px) {
  .g-fleet .fl-battle, .g-fleet .fl-place, .g-fleet .fl-wait { --cell: max(30px, min(54px, calc((58cqw - var(--gut)) / 8), calc((100vh - 96px) / 8))); }
  @supports (height: 100svh) {
    .g-fleet .fl-battle, .g-fleet .fl-place, .g-fleet .fl-wait { --cell: max(30px, min(54px, calc((58cqw - var(--gut)) / 8), calc((100svh - 96px) / 8))); }
  }
}

/* ── effects: shells in flight, the impact flash, the finale's paper confetti ── */
.g-fleet .fl-shell, .g-fleet .fl-flash { position: absolute; left: 0; top: 0; pointer-events: none; opacity: 0; }
.g-fleet .fl-shell { width: 12.5%; height: 12.5%; z-index: 5; will-change: transform; }
.g-fleet .fl-shell::before { content: ''; position: absolute; left: 36%; top: 36%; width: 28%; height: 28%; border-radius: 50%; background: var(--g-ink); box-shadow: 1.5px 1.5px 0 color-mix(in srgb, var(--p-b) 70%, transparent); }
.g-fleet .fl-shell::after { content: ''; position: absolute; left: calc(50% - 1px); top: 54%; width: 2px; height: 190%; background: repeating-linear-gradient(180deg, var(--g-ink) 0 5px, transparent 5px 9px); opacity: .55; }
.g-fleet .fl-shell.is-down::after { top: auto; bottom: 54%; }
.g-fleet .fl-flash { inset: 0; width: 100%; height: 100%; z-index: 6; background: var(--g-hl); }
.g-fleet .fl-conf { position: absolute; top: 55%; width: 9px; height: 13px; border: 1.5px solid var(--g-ink); pointer-events: none; opacity: 0; z-index: 7; }
.g-fleet .fl-conf.c-a { background: var(--p-a); } .g-fleet .fl-conf.c-b { background: var(--p-b); } .g-fleet .fl-conf.c-h { background: var(--g-hl); } .g-fleet .fl-conf.c-i { background: var(--g-card); }
.g-fleet .fl-conf.is-dot { width: 10px; height: 10px; border-radius: 50%; }

/* ── motion ── */
@keyframes gfleet-pop { 0% { transform: scale(2.2); opacity: 0; } 55% { transform: scale(.85); opacity: 1; } 100% { transform: none; } }
@keyframes gfleet-bloom { 0% { transform: scale(0) rotate(-50deg); } 55% { transform: scale(1.4) rotate(10deg); } 80% { transform: scale(.92) rotate(-3deg); } 100% { transform: none; } }
@keyframes gfleet-ripple { 0% { transform: scale(.3); opacity: .9; } 100% { transform: scale(1.7); opacity: 0; } }
@keyframes gfleet-spray { 0% { transform: scale(.25); opacity: 1; } 100% { transform: scale(1.12); opacity: 0; } }
@keyframes gfleet-sink { 0% { transform: scale(1.3) rotate(-4deg); opacity: 0; } 22% { transform: scale(.94) rotate(1deg) translateY(0); opacity: 1; } 50% { transform: translateY(1%) rotate(1.5deg); } 100% { transform: translateY(3%) rotate(-1.8deg); } }
@keyframes gfleet-founder { 0% { transform: none; } 35% { transform: translateY(8%) rotate(4deg); } 70% { transform: translateY(4%) rotate(-2.6deg); } 100% { transform: translateY(3%) rotate(-1.8deg); } }
@keyframes gfleet-bubble { 0% { transform: translateY(0) scale(.5); opacity: 0; } 25% { opacity: .9; } 100% { transform: translateY(-190%) scale(1); opacity: 0; } }
@keyframes gfleet-stamp { 0% { transform: translate(-50%, -50%) scale(2.3) rotate(-16deg); opacity: 0; } 18% { transform: translate(-50%, -50%) scale(.94) rotate(-8deg); opacity: 1; } 26% { transform: translate(-50%, -50%) scale(1) rotate(-8deg); } 82% { opacity: 1; } 100% { transform: translate(-50%, -50%) scale(1) rotate(-8deg); opacity: 0; } }
@keyframes gfleet-strike { 0% { transform: rotate(-12deg) scaleX(0); } 100% { transform: rotate(-12deg) scaleX(1); } }
@keyframes gfleet-drop { 0% { transform: translateY(-12%) scale(1.07); } 45% { transform: translateY(2%) scale(1.05, .92); } 70% { transform: scale(.985, 1.02); } 100% { transform: none; } }
@keyframes gfleet-lift { 0% { transform: scale(.9); } 100% { transform: none; } }
@keyframes gfleet-pulse { 0%, 100% { transform: none; } 50% { transform: scale(1.18); } }
@keyframes gfleet-reveal { 0% { opacity: 0; transform: scale(.9); } 100% { opacity: 1; transform: none; } }
@keyframes gfleet-ping { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.06); opacity: 1; } 100% { transform: none; } }
.g-fleet .fl-mark.is-new { animation: gfleet-pop .38s cubic-bezier(.3, 1.4, .5, 1) both; animation-delay: var(--d, 0ms); }
.g-fleet .fl-mark.is-new.is-hit { animation: none; }
.g-fleet .fl-mark.is-new.is-hit svg { animation: gfleet-bloom .55s cubic-bezier(.3, 1.5, .5, 1) both; animation-delay: var(--d, 0ms); }
.g-fleet .fl-mark.is-new .fl-rip { animation: gfleet-ripple .75s ease-out forwards; animation-delay: calc(var(--d, 0ms) + 120ms); }
.g-fleet .fl-mark.is-new .fl-spray { animation: gfleet-spray .5s var(--g-ease-out) forwards; animation-delay: calc(var(--d, 0ms) + 50ms); }
.g-fleet .fl-mark.is-new.is-x { animation-duration: .3s; }
.g-fleet .fl-scan.is-new { animation: gfleet-ping .5s cubic-bezier(.3, 1.4, .5, 1) both; }
.g-fleet .fl-ship.is-sinking { animation: gfleet-sink 1.1s ease-out both; animation-delay: var(--d, 0ms); }
.g-fleet .fl-ship.is-sinking::before, .g-fleet .fl-ship.is-sinking::after { content: ''; position: absolute; left: 30%; top: 30%; width: 14%; padding-top: 14%; border: 1.5px solid var(--g-ink); border-radius: 50%; background: var(--g-card); opacity: 0; animation: gfleet-bubble 1s ease-out both; animation-delay: calc(var(--d, 0ms) + 350ms); }
.g-fleet .fl-ship.is-sinking::after { left: 58%; top: 40%; width: 9%; padding-top: 9%; animation-delay: calc(var(--d, 0ms) + 520ms); }
.g-fleet .fl-ship.is-foundering { animation: gfleet-founder .9s ease-in-out both; animation-delay: var(--d, 0ms); }
.g-fleet .fl-ship.is-ghost { animation: gfleet-reveal .5s ease-out both; animation-delay: calc(400ms + var(--k, 0) * 140ms); }
.g-fleet .fl-ro.is-new::after { animation: gfleet-strike .45s ease-out both; animation-delay: var(--d, 0ms); }
.g-fleet .fl-ship.is-drop { animation: gfleet-drop .36s cubic-bezier(.3, 1.5, .5, 1) both; animation-delay: calc(var(--k, 0) * 45ms); }
.g-fleet .fl-hl.is-last { animation: gfleet-pulse .9s ease-in-out 3; animation-delay: var(--d, 0ms); }
@media (prefers-reduced-motion: reduce) {
  .g-fleet *, .g-fleet *::before, .g-fleet *::after { animation: none !important; transition: none !important; }
}
`;

// ── the game ─────────────────────────────────────────────────────────────
registerGame({
  id: 'fleet',
  title: 'Battleships',
  blurb: 'Hide your fleet. Hunt theirs.',
  kind: 'turns',
  team: false,
  secret: true,
  tags: ['brainy'],
  platforms: ['phone', 'computer'],
  minutes: 10,
  endDelay: 'manual',
  howTo: [
    'Drag your 5 ships onto the chart, or Shuffle. Tap a ship to turn it. Ships may touch, never overlap.',
    'Pick the rules before a fleet is hidden: Classic (a hit fires again), Salvo (one shot per ship afloat, all at once) or Arsenal (sonar pings and torpedoes).',
    'Sink all five of their ships to win. Your records go in the shared logbook.',
    'On a computer: hover or arrow keys to aim, Enter to fire, R to turn a ship.',
  ],
  css: CSS,
  ...rules,

  mount(el, api) {
    const root = document.createElement('div');
    root.className = 'g-fleet is-hidden';
    el.appendChild(root);
    const fine = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
    const book = gameDataApi('fleet');
    const rmq = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)'); } catch { return null; } })();
    const reducedMotion = () => !!(rmq && rmq.matches);
    const FLIGHT = 150; // ms a shell takes to land (0 under reduced motion)
    const flight = () => (reducedMotion() ? 0 : FLIGHT);

    let ctx = null;
    let V = null; // whose eyes we draw for (never anyone else's fleet)
    let view = 'hidden';
    let sh = null; // the screen's persistent skeleton: built once per screen, then only patched
    let sel = 0; // dock ship picked for tap-to-place
    let selDir = 'h';
    let active = -1; // last ship touched (R rotates it)
    let drag = null;
    let deferred = false;
    let suppressClick = false;
    let fx = {}; // one-shot effects for the next placement paint
    let seenViewer;
    let seenShots = 0;
    let seenScans = 0;
    let seenPhase = null;
    let aim = { r: 3, c: 3 };
    let kbd = false;
    let aimOn = false; // an aim cursor is showing (mouse hover or keyboard)
    let pick = []; // salvo: squares aimed this turn, in tap order
    let weapon = 'shot'; // arsenal: 'shot' | 'sonar' | 'torp'
    let tdir = 'h';
    let armed = null; // arsenal: the square a special is aimed at (tap it again to fire)
    let booked = null; // match id whose records this screen has written
    let geo = null; // cached rects for placement (read at pointerdown / on demand, dropped on resize, scroll and repaint)
    let hoverKey = '';
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    const stop = (t) => { clearTimeout(t); timers.delete(t); };
    // Same phone: a move that passes the turn makes the engine drop the pass-the-phone curtain at
    // once. So it's shown here first (splashes, sinks, sound, "pass the phone"), then played.
    let hold = null; // { mv, state, from, t }
    const nm = (w) => api.name(w);
    const shown = () => (hold ? hold.state : ctx.state); // the state on screen
    const namesOf = (s, w) => shipNames(s.seed, w);
    const shipName = (s, w, idx) => namesOf(s, w)[idx] || `${s.fleets[w] ? s.fleets[w][idx].len : ''}-ship`;

    // ── patching helpers: the DOM is built once per screen and only the parts that changed are touched ──
    const tpl = document.createElement('template');
    const make = (html) => { tpl.innerHTML = html; return tpl.content.firstElementChild; };
    const setHTML = (node, html) => { if (node._h !== html) { node._h = html; node.innerHTML = html; } };
    const setText = (node, text) => { if (node._t !== text) { node._t = text; node.textContent = text; } };
    /** Keep `layer`'s keyed children in step with `items` ({ k, sig, html, patch? }). A child is rebuilt
     *  only when its sig changes, so running animations on the others are never cut short. */
    function sync(layer, items) {
      const m = layer._m || (layer._m = new Map());
      const seen = new Set();
      for (const it of items) {
        seen.add(it.k);
        let n = m.get(it.k);
        if (!n || n._s !== it.sig) {
          const nn = make(it.html);
          nn._s = it.sig;
          if (n) n.replaceWith(nn); else layer.appendChild(nn);
          m.set(it.k, nn);
          n = nn;
        }
        if (it.patch) it.patch(n);
      }
      for (const [k, n] of m) if (!seen.has(k)) { n.remove(); m.delete(k); }
    }

    // ── motion helpers (Web Animations: transform + opacity only, all off under reduced motion) ──
    const shakeKF = (px) => [{ transform: 'translate(0,0)' }, { transform: `translate(${-px}px,${px * 0.3}px)` }, { transform: `translate(${px}px,${-px * 0.3}px)` }, { transform: `translate(${-px * 0.7}px,0)` }, { transform: `translate(${px * 0.5}px,${px * 0.2}px)` }, { transform: 'translate(0,0)' }];
    function shakeEl(node, px = 2, ms = 200) {
      if (!node || reducedMotion() || !node.animate) return;
      try { node.animate(shakeKF(px), { duration: ms, easing: 'ease-out' }); } catch { /* ignore */ }
    }
    /** A shell crosses the chart to land on (r, c). Mine fly up from my side, theirs fall onto my fleet. */
    function fly(layer, r, c, delay, up) {
      if (reducedMotion() || !layer || !layer.animate) return;
      const n = document.createElement('i');
      n.className = `fl-shell${up ? '' : ' is-down'}`;
      n.setAttribute('aria-hidden', 'true');
      layer.appendChild(n);
      const y0 = up ? (N + 0.2) * 100 : -1.4 * 100;
      try {
        const a = n.animate([
          { transform: `translate(${c * 100}%,${y0}%) scale(.7)`, opacity: 1, offset: 0 },
          { transform: `translate(${c * 100}%,${r * 100}%) scale(1)`, opacity: 1, offset: 0.92 },
          { transform: `translate(${c * 100}%,${r * 100}%) scale(1)`, opacity: 0, offset: 1 },
        ], { duration: FLIGHT, delay, easing: 'cubic-bezier(.45,0,.9,.6)', fill: 'both' });
        a.onfinish = () => n.remove();
      } catch { n.remove(); }
    }
    /** A one-frame-ish flash of the yellow plate over a chart. */
    function flash(layer) {
      if (!layer || !layer.animate) return;
      const n = document.createElement('i');
      n.className = 'fl-flash';
      n.setAttribute('aria-hidden', 'true');
      layer.appendChild(n);
      try { const a = n.animate([{ opacity: 0 }, { opacity: 0.5, offset: 0.3 }, { opacity: 0 }], { duration: 190 }); a.onfinish = () => n.remove(); } catch { n.remove(); }
    }
    /** The big moment (a ship goes down): everything on the chart freezes for a beat, flashes, then jolts. */
    function hitStop(chart, layer, grid, at) {
      if (reducedMotion()) return;
      later(() => {
        if (!chart.isConnected) return;
        let running = [];
        try { running = chart.getAnimations ? chart.getAnimations({ subtree: true }).filter((a) => a.playState === 'running') : []; } catch { running = []; }
        for (const a of running) { try { a.pause(); } catch { /* ignore */ } }
        flash(layer);
        later(() => {
          for (const a of running) { try { a.play(); } catch { /* ignore */ } }
          shakeEl(grid, 4, 240);
        }, 85);
      }, at);
    }
    /** The finale: printed paper confetti pops off the chart. */
    function confetti(layer, n) {
      if (reducedMotion() || !layer || !layer.animate) return;
      const kinds = ['c-a', 'c-b', 'c-h', 'c-i', 'c-a', 'c-b'];
      const nodes = [];
      for (let i = 0; i < n; i++) {
        const p = document.createElement('i');
        p.className = `fl-conf ${kinds[i % kinds.length]}${i % 5 === 4 ? ' is-dot' : ''}`;
        p.style.left = `${8 + Math.random() * 84}%`;
        p.setAttribute('aria-hidden', 'true');
        layer.appendChild(p);
        const dx = (Math.random() - 0.5) * 220;
        const rise = 90 + Math.random() * 120;
        const fall = 30 + Math.random() * 90;
        const rot = (Math.random() - 0.5) * 540;
        nodes.push(p);
        try {
          const a = p.animate([
            { transform: 'translate(0,0) rotate(0deg)', opacity: 1, offset: 0 },
            { transform: `translate(${dx * 0.7}px,${-rise}px) rotate(${rot * 0.6}deg)`, opacity: 1, offset: 0.4 },
            { transform: `translate(${dx}px,${fall}px) rotate(${rot}deg)`, opacity: 0, offset: 1 },
          ], { duration: 1250 + Math.random() * 450, delay: Math.random() * 160, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'both' });
          a.onfinish = () => p.remove();
        } catch { p.remove(); }
      }
    }

    // ── periscope ──
    // A local-only view aid for Emerson's own phone in a two-phone match: a long press on the
    // heading over the target chart toggles a faint outline of the other side's afloat ships.
    // Their layout is already here (both move lists sync to both phones and are replayed into
    // ctx.state); this only draws it. Nothing is sent, stored, logged or announced, and it
    // switches itself off when the battle ends, the screen closes or the app is hidden.
    const skipper = ['a', 'b'].find((w) => /^emerson$/i.test(String(api.name(w) || '').trim())) || null;
    let scope = false;
    let press = null;
    const scopeOK = () => !!(skipper && ctx && ctx.mode === 'online' && ctx.me === skipper && V === skipper && view === 'battle' && ctx.state.phase === 'battle');
    function pressEnd() { if (press) { stop(press.t); press = null; } }
    function pressStart(e) {
      pressEnd();
      if (!scopeOK()) return;
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: later(() => { press = null; if (!scopeOK()) return; scope = !scope; render(); }, 650) };
    }
    const onVis = () => { if (document.hidden && scope) { scope = false; if (ctx) render(); } };
    document.addEventListener('visibilitychange', onVis);

    const draftKey = () => `${ctx ? ctx.matchId : ''}|${V}`;
    const draft = () => {
      if (!V) return SIZES.map(() => null);
      let d = DRAFTS.get(draftKey());
      if (!d) {
        d = SIZES.map(() => null);
        DRAFTS.set(draftKey(), d);
        if (DRAFTS.size > 24) DRAFTS.delete(DRAFTS.keys().next().value);
      }
      return d;
    };
    const shipOf = (d, i) => ({ ...d[i], len: SIZES[i] });
    function fits(d, i, o) {
      for (const [r, c] of cellsOf({ ...o, len: SIZES[i] })) {
        if (!onChart(r, c)) return false;
        for (let j = 0; j < d.length; j++) if (j !== i && d[j] && covers(shipOf(d, j), r, c)) return false;
      }
      return true;
    }
    const fitAt = (i, r, c, dir) => (dir === 'h' ? { r, c: clamp(c, 0, N - SIZES[i]), dir } : { r: clamp(r, 0, N - SIZES[i]), c, dir });
    const nextUnplaced = (d, from = 0) => { for (let k = 0; k < SIZES.length; k++) { const j = (from + k) % SIZES.length; if (!d[j]) return j; } return -1; };

    function bad(msg, elx) {
      api.sfx('bad');
      api.haptic(30);
      if (msg) api.toast(msg);
      shakeEl(elx, 4, 360);
    }

    // ── logbook (shared records: api data for 'fleet') ──
    // Keys: <w>_fs_<mode>_best = 1000 − fewest shots to win (stored so bigger is better, which the
    // shared doc keeps on merge) and <w>_fs_<mode>_id the match that set it; <w>_run_best /
    // <w>_run_id the longest run of hits; streak = "<w>:<n>:<match id>" the current win streak,
    // <w>_ws_best / <w>_ws_id the longest one. All of it comes from the move log, so both phones
    // write the same values.
    const readBook = () => { try { return book.data() || {}; } catch { return {}; } };
    function logRecords(S, matchId, live) {
      if (!S || S.phase !== 'over' || booked === matchId) return;
      booked = matchId;
      const B = readBook();
      const w = S.winner; // null after a Salvo draw: hit streaks still count, wins don't
      const patch = {};
      const fs = `${w}_fs_${modeOf(S)}`;
      const fsVal = w ? 1000 - statsOf(S, w).shots : 0;
      if (w && !(B[`${fs}_best`] >= fsVal)) { patch[`${fs}_best`] = fsVal; patch[`${fs}_id`] = matchId; }
      for (const p of ['a', 'b']) {
        const run = statsOf(S, p).run;
        if (run > 0 && !(B[`${p}_run_best`] >= run)) { patch[`${p}_run_best`] = run; patch[`${p}_run_id`] = matchId; }
      }
      if (live && w) { // win streaks only count games that ended while someone watched (not old ones reopened)
        const [pw, pn, pid] = String(B.streak || '').split(':');
        if (pid !== matchId) {
          const n = pw === w ? (Number(pn) || 0) + 1 : 1;
          patch.streak = `${w}:${n}:${matchId}`;
          if (!(B[`${w}_ws_best`] >= n)) { patch[`${w}_ws_best`] = n; patch[`${w}_ws_id`] = matchId; }
        }
      }
      try { book.setData(patch); } catch (e) { console.warn('fleet logbook', e); }
    }
    function streakOf(B) {
      const [w, n] = String(B.streak || '').split(':');
      return (w === 'a' || w === 'b') && Number(n) > 0 ? { w, n: Number(n) } : null;
    }
    /** One line of rivalry for the placement screen (the inside of its paragraph, or ''). */
    function captainsLine(S) {
      const B = readBook();
      const bits = [];
      const st = streakOf(B);
      if (st && st.n >= 2) bits.push(ctx.mode === 'online' && st.w === V ? `You’re on a ${st.n}-win streak.` : `${esc(nm(st.w))} is on a ${st.n}-win streak.`);
      const mode = modeOf(S);
      const best = (w) => (B[`${w}_fs_${mode}_best`] > 0 ? 1000 - B[`${w}_fs_${mode}_best`] : null);
      const fa = best('a');
      const fb = best('b');
      if (fa != null || fb != null) bits.push(`Fewest shots to win (${MODES[mode].name}): ${[['a', fa], ['b', fb]].filter(([, x]) => x != null).map(([w, x]) => `${esc(nm(w))} ${x}`).join(' · ')}.`);
      return bits.join(' ');
    }
    function logbookHTML(S, matchId) {
      const B = readBook();
      const st = { a: statsOf(S, 'a'), b: statsOf(S, 'b') };
      const mode = modeOf(S);
      const isNew = (k) => (B[k] === matchId ? '<i class="fl-new">New</i>' : '');
      const fewest = (w) => (B[`${w}_fs_${mode}_best`] > 0 ? `${1000 - B[`${w}_fs_${mode}_best`]}${isNew(`${w}_fs_${mode}_id`)}` : '–');
      const runBest = (w) => (B[`${w}_run_best`] > 0 ? `${B[`${w}_run_best`]}${isNew(`${w}_run_id`)}` : '–');
      const wsBest = (w) => (B[`${w}_ws_best`] > 0 ? `${B[`${w}_ws_best`]}${isNew(`${w}_ws_id`)}` : '–');
      const row = (label, f) => `<tr><th scope="row">${label}</th><td>${f('a')}</td><td>${f('b')}</td></tr>`;
      const s = streakOf(B);
      return `<section class="fl-book" aria-label="Logbook">
        <header class="fl-head"><h2 class="fl-h">Logbook</h2></header>
        <table>
          <thead><tr><th></th><th scope="col" class="fl-who-a">${esc(nm('a'))}</th><th scope="col" class="fl-who-b">${esc(nm('b'))}</th></tr></thead>
          <tbody>
            ${row('Shots this game', (w) => st[w].shots)}
            ${row('On target', (w) => `${st[w].acc}%`)}
            ${row('Hits in a row', (w) => st[w].run)}
            ${row(`Fewest shots to win · ${MODES[mode].name}`, fewest)}
            ${row('Best hit streak ever', runBest)}
            ${row('Longest win streak', wsBest)}
          </tbody>
        </table>
        ${S.stake && S.winner ? `<p class="fl-book-note">${esc(nm(S.winner))} won ${esc(STAKES[S.stake])}.</p>` : ''}
        ${s ? `<p class="fl-book-note">${esc(nm(s.w))} has won ${s.n === 1 ? 'the last game' : `${s.n} in a row`}.</p>` : ''}
      </section>`;
    }

    // ── paint ──
    function render(fresh = [], battleStart = false, freshScans = []) {
      if (drag) { deferred = true; return; }
      deferred = false;
      const c = ctx;
      if (!c || !V) {
        view = 'hidden';
        sh = null;
        root.className = 'g-fleet is-hidden';
        root.removeAttribute('data-viewer');
        root.innerHTML = '';
        api.setStatus(null);
        return;
      }
      const s = c.state;
      root.dataset.viewer = V;
      root.dataset.phase = s.phase;
      root.dataset.mode = modeOf(s);
      if (s.phase === 'place' && !s.fleets[V]) paintPlace();
      else if (s.phase === 'place') paintWait();
      else paintBattle(fresh, battleStart, freshScans);
    }

    // Rules and stakes share one compact row above the chart. Each side is a control while it is
    // still open (before you hide your own fleet), and a short status line once it is decided.
    function setupHTML(s) {
      const mode = modeOf(s);
      const canSet = !s.fleets[V] && ctx.canMove;
      const byMode = s.mode && s.modeBy ? (ctx.mode === 'online' && s.modeBy === V ? ' (your pick)' : ` (${esc(nm(s.modeBy))}’s pick)`) : '';
      const byStake = s.stake && s.stakeBy ? (ctx.mode === 'online' && s.stakeBy === V ? ' (your idea)' : ` (${esc(nm(s.stakeBy))}’s idea)`) : '';
      const left = !s.mode && canSet
        ? `<div class="fl-rules" role="group" aria-label="Rules">${MODE_KEYS.map((k) => `<button type="button" class="fl-rule" data-rules="${k}" aria-pressed="${k === mode}">${MODES[k].name}</button>`).join('')}</div>`
        : `<p class="fl-rules-note"><b>${MODES[mode].name} rules${byMode}.</b></p>`;
      const right = !s.stake && canSet
        ? `<label class="fl-stake"><span class="g-label">Play for</span><select data-stake aria-label="Play for"><option value="">glory only</option>${Object.entries(STAKES).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>`
        : (s.stake ? `<p class="fl-rules-note fl-stake-set"><b>Playing for ${esc(STAKES[s.stake])}${byStake}.</b></p>` : '');
      return `${left}${right}`;
    }

    // ── placement ──
    /** Build the placement screen once: the chart and its 64 squares never change, only the ships, dock and rules row do. */
    function buildPlace(v) {
      const key = `p|${v}|${ctx.mode}|${ctx.matchId}|${nm('a')}|${nm('b')}`;
      if (sh && sh.key === key && root.isConnected) return sh;
      geo = null;
      hoverKey = '';
      const hint = fine
        ? 'Drag a ship on, or pick one and click. Click a ship or press <b>R</b> to turn it.'
        : 'Drag a ship on, or tap to drop. Tap a ship to turn.';
      root.className = 'g-fleet';
      root.innerHTML = `<div class="fl-place">
        <div class="fl-main">
          <header class="fl-head"><h2 class="fl-h p-${v}"><span class="fl-sw"></span>${ctx.mode === 'local' ? `${esc(nm(v))}’s fleet` : 'Your fleet'}</h2><span class="fl-pill is-quiet"></span></header>
          <div class="fl-setup"></div>
          <p class="fl-captain" hidden></p>
          <p class="fl-hint">${hint}</p>
          ${chartHTML({ cls: 'fl-home-chart is-edit', cells: tapCells('fl-cell', false), layer: '<div class="fl-preview" hidden></div>' })}
        </div>
        <div class="fl-aside">
          <div class="fl-dock" aria-label="Ships to place"></div>
          <p class="fl-named" hidden></p>
          <p class="fl-note" hidden></p>
          <div class="fl-actions">
            <button type="button" class="gm-btn gm-btn-ghost" data-fl="shuffle">Shuffle</button>
            <button type="button" class="gm-btn" data-fl="ready" disabled>Ready</button>
          </div>
        </div>
      </div>`;
      const q = (s2) => root.querySelector(s2);
      sh = { key, kind: 'place', pill: q('.fl-pill'), setup: q('.fl-setup'), cap: q('.fl-captain'), layer: q('.fl-layer'), preview: q('.fl-preview'), dock: q('.fl-dock'), named: q('.fl-named'), note: q('.fl-note'), ready: q('[data-fl="ready"]') };
      return sh;
    }

    function paintPlace() {
      view = 'place';
      const v = V;
      const s = ctx.state;
      const d = draft();
      const names = namesOf(s, v);
      const S = buildPlace(v);
      if (sel < 0 || d[sel]) sel = nextUnplaced(d, Math.max(0, sel));
      const placed = d.filter(Boolean).length;
      S.pill.className = `fl-pill${placed === SIZES.length ? '' : ' is-quiet'}`;
      setText(S.pill, `${placed}/5 at sea`);
      setHTML(S.setup, setupHTML(s));
      const cap2 = captainsLine(s);
      S.cap.hidden = !cap2;
      setHTML(S.cap, cap2);
      const ships = d.map((o, i) => (o ? {
        k: `s${i}`,
        sig: `${o.r},${o.c},${o.dir}`,
        html: `<button type="button" class="fl-ship p-${v}${fx.drop === i || fx.shuffle ? ' is-drop' : ''}" data-ship="${i}" data-len="${SIZES[i]}" style="${shipAt(shipOf(d, i))};--k:${i}" aria-label="The ${esc(names[i])}, ${SIZES[i]} long, at ${coord(o.r, o.c)}, ${o.dir === 'h' ? 'across' : 'down'}. Tap to turn it.">${shipSVG(SIZES[i], o.dir)}</button>`,
      } : null)).filter(Boolean);
      sync(S.layer, ships);
      setHTML(S.dock, placed === SIZES.length
        ? `<div class="fl-dock-done">All five at sea. Drag to adjust, or hit Ready.</div>`
        : SIZES.map((len, i) => (d[i]
          ? `<span class="fl-slot" style="--len:${len}" aria-hidden="true"></span>`
          : `<button type="button" class="fl-dock-ship p-${v}${sel === i ? ' is-sel' : ''}" data-ship="${i}" data-len="${len}" style="--len:${len}" aria-label="The ${esc(names[i])}, ${len} long${sel === i ? ', picked' : ''}" aria-pressed="${sel === i}">${shipSVG(len, 'h')}</button>`)).join(''));
      const named = sel >= 0 && !d[sel] ? `Picked: <b>the ${esc(names[sel])}</b> (${SIZES[sel]} long)` : '';
      S.named.hidden = !named;
      setHTML(S.named, named);
      const foe = foeOf(v);
      const note = ctx.mode === 'online' && s.fleets[foe] ? `${esc(nm(foe))} is ready and waiting.` : '';
      S.note.hidden = !note;
      setHTML(S.note, note);
      S.ready.disabled = !(placed === SIZES.length && ctx.canMove);
      if (fx.shake != null) { const t = S.layer._m && S.layer._m.get(`s${fx.shake}`); if (t) shakeEl(t, 4, 360); }
      fx = {};
      geo = null;
      api.setStatus(ctx.mode === 'local' ? `${nm(v)}, hide your fleet` : 'Hide your fleet');
    }

    function paintWait() {
      view = 'wait';
      sh = null;
      const v = V;
      const s = ctx.state;
      const foe = foeOf(v);
      const ships = s.fleets[v].map((o) => `<div class="fl-ship p-${v}" data-len="${o.len}" style="${shipAt(o)}">${shipSVG(o.len, o.dir)}</div>`).join('');
      let cells = '';
      for (let i = 0; i < N * N; i++) cells += '<span class="fl-cell"></span>';
      root.className = 'g-fleet';
      root.innerHTML = `<div class="fl-wait">
        <header class="fl-head"><h2 class="fl-h p-${v}"><span class="fl-sw"></span>Your fleet</h2><span class="fl-pill">Ready</span></header>
        <div class="fl-home">${chartHTML({ cls: 'fl-home-chart', cells, layer: ships })}</div>
        <div class="fl-note-card"><b>Fleet in position</b><span>Waiting for ${esc(nm(foe))} to hide theirs. ${s.first === v ? 'You fire first.' : `${esc(nm(foe))} fires first.`}</span><span>${MODES[modeOf(s)].name} rules.${s.stake ? ` Playing for ${esc(STAKES[s.stake])}.` : ''}</span></div>
      </div>`;
      api.setStatus(`Waiting for ${nm(foe)} to hide their fleet…`);
    }

    // ── battle ──
    /** What a special weapon aimed at (r, c) would cover. */
    const footprint = (r, c) => (weapon === 'sonar' ? sonarCells(r, c) : weapon === 'torp' ? torpCells(r, c, tdir) : [[r, c]]);

    /** Build the battle screen once per viewer: both charts' 128 squares persist, panels are patched. */
    function buildBattle(v, foe) {
      const key = `b|${v}|${ctx.mode}|${ctx.matchId}|${nm('a')}|${nm('b')}`;
      if (sh && sh.key === key && root.isConnected) return sh;
      aimOn = kbd;
      root.className = 'g-fleet';
      root.innerHTML = `<div class="fl-battle">
        <section class="fl-target" aria-label="${esc(nm(foe))}’s waters">
          <header class="fl-head"><h2 class="fl-h p-${foe}"><span class="fl-sw"></span>${esc(nm(foe))}’s waters</h2><span class="fl-pill" hidden></span></header>
          ${chartHTML({ cls: 'fl-target-chart', cells: tapCells('fl-cell', true) })}
          <div class="fl-tools-slot"></div>
        </section>
        <div class="fl-log" aria-live="polite"></div>
        <section class="fl-home" aria-label="Your fleet">
          <header class="fl-head"><h2 class="fl-h p-${v}"><span class="fl-sw"></span>${ctx.mode === 'local' ? esc(nm(v)) : 'Your fleet'}</h2></header>
          ${chartHTML({ cls: 'fl-home-chart is-mini', cells: plainCells() })}
        </section>
        <section class="fl-side" aria-label="${esc(nm(foe))}’s fleet">
          <header class="fl-head"><h2 class="fl-h p-${foe}"><span class="fl-sw"></span>Their fleet</h2></header>
          <div class="fl-roster"></div>
          <p class="fl-count"></p>
          <p class="fl-kit" data-rg="kit" hidden></p>
          <p class="fl-kit" data-rg="stake" hidden></p>
        </section>
        <div class="fl-book-slot"></div>
      </div>`;
      const q = (s2) => root.querySelector(s2);
      const tchart = q('.fl-target .fl-chart');
      const hchart = q('.fl-home .fl-chart');
      const cells = [...tchart.querySelectorAll('.fl-cell')];
      cells.forEach((b, i) => { b._c = 'fl-cell'; b._l = coord(Math.floor(i / N), i % N); b._d = true; });
      sh = {
        key, kind: 'battle', battle: q('.fl-battle'), target: q('.fl-target'), pill: q('.fl-target .fl-pill'),
        tchart, hchart, tgrid: tchart.querySelector('.fl-grid'), hgrid: hchart.querySelector('.fl-grid'),
        tlayer: tchart.querySelector('.fl-layer'), hlayer: hchart.querySelector('.fl-layer'), cells,
        cols: [...tchart.querySelectorAll('.fl-lab-c span')], rows: [...tchart.querySelectorAll('.fl-lab-r span')],
        tools: q('.fl-tools-slot'), log: q('.fl-log'), roster: q('.fl-roster'), count: q('.fl-count'),
        kit: q('[data-rg="kit"]'), stake: q('[data-rg="stake"]'), book: q('.fl-book-slot'),
      };
      return sh;
    }

    /** Patch the 64 target squares from the state on screen and the aim/pick UI state. Only squares that changed are touched. */
    function paintTargetCells() {
      if (!sh || sh.kind !== 'battle' || !ctx || !V) return;
      const s = shown();
      const v = V;
      const mode = modeOf(s);
      const over = s.phase === 'over';
      const myTurn = ctx.canMove && !(hold && !over);
      const special = mode === 'arsenal' && weapon !== 'shot' && myTurn;
      const shotAt = new Map();
      for (const x of s.shots) if (x.by === v) shotAt.set(x.r * N + x.c, x);
      const picked = new Set(pick.map(([r, c2]) => r * N + c2));
      const zone = new Set();
      if (special && armed) for (const [r, c2] of footprint(armed.r, armed.c)) zone.add(r * N + c2);
      else if (special && aimOn) for (const [r, c2] of footprint(aim.r, aim.c)) zone.add(r * N + c2);
      const usable = (r, col, x) => {
        if (!myTurn) return false;
        if (!special) return !x;
        if (weapon === 'sonar') return true;
        return torpCells(r, col, tdir).some(([rr, cc]) => !shotAt.has(rr * N + cc));
      };
      for (let r = 0; r < N; r++) {
        for (let col = 0; col < N; col++) {
          const i = r * N + col;
          const x = shotAt.get(i);
          const aimed = kbd && aimOn && aim.r === r && aim.c === col;
          const z = zone.has(i);
          const cls = `fl-cell${x ? ' is-shot' : ''}${aimed ? ' is-aim' : ''}${picked.has(i) ? ' is-pick' : ''}${z ? ' is-zone' : ''}${z && armed && armed.r === r && armed.c === col ? ' is-core' : ''}`;
          const lab = `${coord(r, col)}${x ? (x.hit ? ', hit' : ', miss') : ''}`;
          const dis = !usable(r, col, x);
          const b = sh.cells[i];
          if (b._c !== cls) { b._c = cls; b.className = cls; }
          if (b._l !== lab) { b._l = lab; b.setAttribute('aria-label', lab); }
          if (b._d !== dis) { b._d = dis; b.disabled = dis; }
        }
      }
      for (let k = 0; k < N; k++) {
        const on1 = aimOn && aim.c === k;
        const on2 = aimOn && aim.r === k;
        if (sh.cols[k].classList.contains('is-on') !== on1) sh.cols[k].classList.toggle('is-on', on1);
        if (sh.rows[k].classList.contains('is-on') !== on2) sh.rows[k].classList.toggle('is-on', on2);
      }
    }

    function paintBattle(fresh, battleStart, freshScans) {
      view = 'battle';
      const c = ctx;
      const s = shown();
      const v = V;
      const foe = foeOf(v);
      const S = buildBattle(v, foe);
      const mode = modeOf(s);
      const over = s.phase === 'over';
      const shots = s.shots;
      const scans = s.scans || [];
      const myFleet = s.fleets[v];
      const theirFleet = s.fleets[foe]; // read ONLY for sunk ships (or once the game is over)
      const FL = flight();
      const freshAt = new Map(fresh.map((i, k) => [i, k]));
      const delay = (i) => (freshAt.has(i) ? freshAt.get(i) * 260 + FL : 0);
      const mine = [];
      const theirs = [];
      shots.forEach((x, i) => (x.by === v ? mine : theirs).push({ ...x, i }));
      const sunkTheirs = new Map(mine.filter((x) => x.sunk >= 0).map((x) => [x.sunk, x.i]));
      const sunkMine = new Map(theirs.filter((x) => x.sunk >= 0).map((x) => [x.sunk, x.i]));
      const onSunk = (fleet, sunkMap, r, c2) => { for (const [idx, at2] of sunkMap) if (covers(fleet[idx], r, c2)) return at2; return -1; };
      const pending = !!hold && !over; // a same-phone move about to be played
      const myTurn = c.canMove && !pending;
      const lastMine = mine.length ? mine[mine.length - 1].i : -1;
      const foeRun = lastRunBy(shots, foe);
      const foeRunSet = new Set(foeRun);
      const lastFoe = foeRun.length ? foeRun[foeRun.length - 1] : -1;
      if (weapon !== 'shot' && !(mode === 'arsenal' && s.kit && s.kit[v][weapon] > 0)) { weapon = 'shot'; armed = null; } // nothing left to fire
      const need = mode === 'salvo' ? salvoSize(s, v) : 0;
      if (!myTurn) { pick = []; armed = null; }

      // their waters (what I know: my shots, my pings, plus ships I've sunk)
      paintTargetCells();
      const tItems = [];
      for (const [idx, at2] of sunkTheirs) {
        const o = theirFleet[idx];
        const isNew = freshAt.has(at2);
        tItems.push({ k: `w${idx}`, sig: 'w', html: `<div class="fl-ship p-${foe} is-wreck${isNew ? ' is-sinking' : ''}" data-len="${o.len}" style="${shipAt(o)};--d:${delay(at2) + 280}ms">${shipSVG(o.len, o.dir)}</div>` });
      }
      if (over) {
        let k = 0;
        theirFleet.forEach((o, idx) => { if (!sunkTheirs.has(idx)) tItems.push({ k: `g${idx}`, sig: 'g', html: `<div class="fl-ship p-${foe} is-ghost" data-len="${o.len}" style="${shipAt(o)};--k:${k++}">${shipSVG(o.len, o.dir)}</div>` }); });
      } else if (scope && scopeOK()) {
        theirFleet.forEach((o, idx) => { if (!sunkTheirs.has(idx)) tItems.push({ k: `sp${idx}`, sig: 'sp', html: `<i class="fl-scope" style="${shipAt(o)}" aria-hidden="true"></i>` }); });
      }
      const freshScanSet = new Set(freshScans);
      scans.forEach((x, k) => { if (x.by === v) tItems.push({ k: `sc${k}`, sig: `${x.n}`, html: scanBox(x, freshScanSet.has(k) ? ' is-new' : '') }); });
      for (const x of mine) {
        const sunkBy = x.hit ? onSunk(theirFleet, sunkTheirs, x.r, x.c) : -1;
        const kind = !x.hit ? 'is-miss' : sunkBy >= 0 ? 'is-x' : 'is-hit';
        const isNew = freshAt.has(x.i) || (sunkBy >= 0 && freshAt.has(sunkBy));
        const d = freshAt.has(x.i) ? delay(x.i) : sunkBy >= 0 ? delay(sunkBy) + 520 : 0;
        const last = x.i === lastMine && !over && (pending || mode !== 'salvo');
        tItems.push({
          k: `m${x.i}`,
          sig: kind,
          html: `<span class="fl-mark ${kind}${isNew ? ' is-new' : ''}${last ? ' is-last' : ''}" style="${at(x.r, x.c)};--d:${d}ms">${!x.hit ? SPLASH : sunkBy >= 0 ? WRECK : BURST}${isNew && sunkBy < 0 ? (x.hit ? FX_HIT : FX_MISS) : ''}</span>`,
          patch: (n) => { if (n.classList.contains('is-last') !== last) n.classList.toggle('is-last', last); },
        });
      }
      sync(S.tlayer, tItems);

      // my fleet (their shots on it; their latest volley highlighted; their pings)
      const hItems = myFleet.map((o, idx) => {
        const at2 = sunkMine.has(idx) ? sunkMine.get(idx) : -1;
        const cls = at2 >= 0 ? ` is-wreck${freshAt.has(at2) ? ' is-foundering' : ''}` : '';
        return { k: `f${idx}`, sig: at2 >= 0 ? 'w' : 'f', html: `<div class="fl-ship p-${v}${cls}" data-len="${o.len}" style="${shipAt(o)};--d:${at2 >= 0 ? delay(at2) + 200 : 0}ms">${shipSVG(o.len, o.dir, true)}</div>` };
      });
      scans.forEach((x, k) => { if (x.by === foe) hItems.push({ k: `sc${k}`, sig: `${x.n}`, html: scanBox(x, ` is-theirs${freshScanSet.has(k) ? ' is-new' : ''}`) }); });
      for (const x of theirs) {
        if (!foeRunSet.has(x.i)) continue;
        const last = x.i === lastFoe;
        hItems.push({
          k: `h${x.i}`,
          sig: 'h',
          html: `<span class="fl-hl${last ? ' is-last' : ''}" style="${at(x.r, x.c)};--d:${delay(x.i) + 300}ms"></span>`,
          patch: (n) => { if (n.classList.contains('is-last') !== last) n.classList.toggle('is-last', last); },
        });
      }
      for (const x of theirs) {
        const sunkBy = x.hit ? onSunk(myFleet, sunkMine, x.r, x.c) : -1;
        const kind = !x.hit ? 'is-miss' : sunkBy >= 0 ? 'is-x' : 'is-hit';
        const isNew = freshAt.has(x.i) || (sunkBy >= 0 && freshAt.has(sunkBy));
        const d = freshAt.has(x.i) ? delay(x.i) : sunkBy >= 0 ? delay(sunkBy) + 400 : 0;
        hItems.push({ k: `hm${x.i}`, sig: kind, html: `<span class="fl-mark ${kind}${isNew ? ' is-new' : ''}" style="${at(x.r, x.c)};--d:${d}ms">${!x.hit ? SPLASH : sunkBy >= 0 ? WRECK : BURST}${isNew && sunkBy < 0 ? (x.hit ? FX_HIT : FX_MISS) : ''}</span>` });
      }
      sync(S.hlayer, hItems);

      // their fleet roster (sizes only, crossed off and named as they sink)
      const theirNames = namesOf(s, foe);
      const sunkList = [...sunkTheirs.keys()];
      const freshSunk = new Set([...sunkTheirs].filter(([, at2]) => freshAt.has(at2)).map(([idx]) => idx));
      const used = {};
      const sunkByLen = {};
      for (const idx of sunkList) (sunkByLen[theirFleet[idx].len] = sunkByLen[theirFleet[idx].len] || []).push(idx);
      const roster = SIZES.map((len) => {
        used[len] = (used[len] || 0) + 1;
        const idx = (sunkByLen[len] || [])[used[len] - 1];
        const sunk = idx != null;
        const isNew = sunk && freshSunk.has(idx);
        return `<span class="fl-ro p-${foe}${sunk ? ' is-sunk' : ''}${isNew ? ' is-new' : ''}" style="--len:${len}${isNew ? `;--d:${fresh.length * 260 + FL + 500}ms` : ''}" role="img" aria-label="${len}-long, ${sunk ? `sunk: the ${esc(theirNames[idx])}` : 'afloat'}"${sunk ? ` title="The ${esc(theirNames[idx])}"` : ''}>${shipSVG(len, 'h', true)}</span>`;
      }).join('');
      const left = SIZES.length - sunkList.length;
      const kitLine = (w) => (s.kit ? `${s.kit[w].sonar} sonar · ${s.kit[w].torp} torpedo${s.kit[w].torp === 1 ? '' : 'es'}` : '');

      // the log: the latest turn (theirs when you come back to it; yours while you keep firing)
      const tok = (x) => {
        const what = x.sunk >= 0 ? `sank ${x.by === v ? 'the' : 'your'} ${esc(shipName(s, foeOf(x.by), x.sunk))}` : x.hit ? 'hit' : 'miss';
        return `<span class="fl-tok ${x.sunk >= 0 ? 'is-sunk' : x.hit ? 'is-hit' : 'is-miss'}">${x.t === 'torp' ? 'Torpedo ' : ''}${coord(x.r, x.c)} ${what}</span>`;
      };
      const pingTok = (x) => `<span class="fl-tok is-ping">Ping ${coord(x.r, x.c)}: ${x.n}</span>`;
      const lines = [];
      const tailScan = scans.length && scans[scans.length - 1].at === shots.length ? scans[scans.length - 1] : null;
      let run = shots.length ? lastRun(shots) : [];
      let by = run.length ? shots[run[0]].by : null;
      if (tailScan && tailScan.by !== by) { run = []; by = tailScan.by; }
      if (!by) {
        lines.push(`<p><b>Battle stations.</b> ${s.first === v ? `You fire first: ${mode === 'salvo' ? `pick ${need} squares` : 'pick a square'} in ${esc(nm(foe))}’s waters.` : `${esc(nm(foe))} fires first.`}</p>`);
      } else {
        const from = run.length ? run[0] : shots.length;
        const parts = [];
        const pings = scans.filter((x) => x.by === by && x.at >= from);
        let p = 0;
        for (const i of run) { while (p < pings.length && pings[p].at <= i) parts.push(pingTok(pings[p++])); parts.push(tok(shots[i])); }
        while (p < pings.length) parts.push(pingTok(pings[p++]));
        const lastShot = run.length ? shots[run[run.length - 1]] : null;
        let tail = '';
        if (pending) tail = ` Pass the phone to <b class="fl-who-${foe}">${esc(nm(foe))}</b>.`;
        else if (by === v && !over && myTurn && (!lastShot || lastShot.hit)) tail = ` <b>${lastShot ? 'Fire again.' : 'Your shot.'}</b>`;
        lines.push(`<p><b class="fl-who-${by}">${by === v ? (pending ? esc(nm(v)) : 'You') : esc(nm(by))}</b> ${run.length ? 'fired' : 'pinged'} ${parts.join(' ')}${tail}</p>`);
      }

      // turn label
      const lastShot = shots[shots.length - 1];
      const again = myTurn && lastShot && lastShot.by === v && lastShot.hit && mode !== 'salvo';
      let pill = '';
      let status;
      if (over) {
        pill = !s.winner ? 'Draw' : s.winner === v ? 'All sunk' : 'Fleet lost';
        status = s.winner ? `${nm(s.winner)} sank the whole fleet` : 'Both fleets sunk';
      } else if (pending) {
        status = `${mode === 'salvo' ? 'Salvo away' : 'Miss'}. Over to ${nm(foe)}`;
      } else if (myTurn) {
        if (mode === 'salvo') status = s.final ? `Last salvo! Sink ${afloat(s, foe) === 1 ? 'it' : 'them all'} to draw` : c.mode === 'local' ? `${nm(v)}, fire a salvo of ${need}` : `Fire a salvo of ${need}`;
        else status = c.mode === 'local' ? (again ? `Hit! ${nm(v)} fires again` : `${nm(v)}’s shot`) : again ? 'Hit! Fire again' : 'Your shot';
        if (mode !== 'salvo' && afloat(s, foe) === 1) status += ' · one ship left';
      } else {
        status = s.final ? `${nm(foe)} gets one last salvo…` : `${nm(foe)} is taking aim…`;
      }
      api.setStatus(status);
      if (!pill && mode !== 'classic') pill = MODES[mode].name;

      // firing controls
      let tools = '';
      if (mode === 'salvo' && myTurn) {
        tools = `<div class="fl-tools"><div class="fl-fire">
          <span class="fl-fire-n"><b>${pick.length}</b>/${need} aimed</span>
          <button type="button" class="gm-btn gm-btn-ghost" data-fl="salvo-clear"${pick.length ? '' : ' disabled'}>Clear</button>
          <button type="button" class="gm-btn" data-fl="salvo-fire"${pick.length === need ? '' : ' disabled'}>Fire salvo</button>
        </div><p class="fl-tip">${pick.length < need ? `Tap ${need - pick.length} more square${need - pick.length === 1 ? '' : 's'}. Tap one again to take it back.` : 'All aimed. Fire away.'}</p></div>`;
      } else if (mode === 'arsenal' && !over) {
        const k = s.kit[v];
        const dis = !myTurn;
        let tip = '';
        if (myTurn) {
          if (weapon === 'sonar') tip = armed ? `Tap <b>${coord(armed.r, armed.c)}</b> again to ping it. Free: you still shoot after.` : 'Sonar: tap a square to count the ship squares you haven’t hit around it.';
          else if (weapon === 'torp') tip = armed ? `Tap <b>${coord(armed.r, armed.c)}</b> again to fire ${tdir === 'h' ? 'across' : 'down'}.` : `Torpedo: hits three squares ${tdir === 'h' ? 'across' : 'down'}. Tap where to aim it.`;
          else tip = 'Tap a square to fire. Lose a ship: +1 sonar. Three hits in a row: +1 torpedo.';
        }
        tools = `<div class="fl-tools"><div class="fl-tray" role="group" aria-label="Kit">
          <button type="button" class="fl-wpn" data-wpn="shot" aria-pressed="${weapon === 'shot'}"${dis ? ' disabled' : ''}>Shot</button>
          <button type="button" class="fl-wpn" data-wpn="sonar" aria-pressed="${weapon === 'sonar'}"${dis || !k.sonar ? ' disabled' : ''}>Sonar <b>${k.sonar}</b></button>
          <button type="button" class="fl-wpn" data-wpn="torp" aria-pressed="${weapon === 'torp'}"${dis || !k.torp ? ' disabled' : ''}>Torpedo <b>${k.torp}</b></button>
          ${weapon === 'torp' && myTurn ? `<button type="button" class="fl-wpn" data-fl="tdir" aria-label="Turn the torpedo">${tdir === 'h' ? 'Across' : 'Down'}</button>` : ''}
        </div>${tip ? `<p class="fl-tip">${tip}</p>` : ''}</div>`;
      }

      // the panels: each is rewritten only when its text changed
      S.battle.classList.toggle('has-book', over);
      S.target.classList.toggle('is-live', myTurn);
      S.pill.hidden = !pill;
      S.pill.className = `fl-pill${over ? '' : ' is-mode'}`;
      setText(S.pill, pill);
      setHTML(S.tools, tools);
      setHTML(S.log, lines.join(''));
      setHTML(S.roster, roster);
      setText(S.count, left === 0 ? 'All five sunk' : left === 1 ? 'One ship left!' : `${left} of 5 still afloat`);
      const kitTxt = s.kit ? `Their kit: ${kitLine(foe)}` : '';
      S.kit.hidden = !kitTxt;
      setText(S.kit, kitTxt);
      const stakeTxt = s.stake ? `Playing for ${STAKES[s.stake]}` : '';
      S.stake.hidden = !stakeTxt;
      setText(S.stake, stakeTxt);
      setHTML(S.book, over ? logbookHTML(s, c.matchId) : '');

      // effects for anything new
      if (fresh.length || freshScans.length) effects(fresh, over, freshScans);
      else if (battleStart) stamp(S.tchart, 'Battle stations', `${MODES[mode].name} · ${s.first === v ? (c.mode === 'local' ? `${nm(v)} fires first` : 'You fire first') : `${nm(foe)} fires first`}`, 0);
    }

    function effects(fresh, over, freshScans = []) {
      const s = shown();
      const v = V;
      const S = sh;
      if (!S || S.kind !== 'battle') return;
      const FL = flight();
      const list = fresh.map((i) => s.shots[i]);
      const lastK = list.length - 1;
      const mineNew = list.filter((x) => x.by === v);
      const theirsNew = list.filter((x) => x.by !== v);
      const tChart = S.tchart;
      const hChart = S.hchart;
      // each shot: a shell crosses the chart, then it lands (a splat, and a freeze-flash-jolt when it sinks a ship)
      list.forEach((x, k) => {
        const mineShot = x.by === v;
        const layer = mineShot ? S.tlayer : S.hlayer;
        const grid = mineShot ? S.tgrid : S.hgrid;
        const chart = mineShot ? tChart : hChart;
        fly(layer, x.r, x.c, k * 260, mineShot);
        if (x.hit && x.sunk >= 0) hitStop(chart, layer, grid, k * 260 + FL);
      });
      const sunkMine = mineNew.filter((x) => x.sunk >= 0);
      const sunkTheirs = theirsNew.filter((x) => x.sunk >= 0);
      const wait = Math.max(0, lastK) * 260 + FL;
      const torpBonus = mineNew.some((x) => x.bonus === 'torp') ? ' · +1 torpedo' : '';
      const sonarBonus = theirsNew.some((x) => x.kit === 'sonar') ? ' · +1 sonar' : '';
      // a hot streak: the run of hits you just extended crossed 3 (or 5)
      let hot = '';
      if (mineNew.length && list[lastK] && list[lastK].by === v) {
        const tail = tailHits(s, v);
        let freshTail = 0;
        for (let k = lastK; k >= 0 && list[k].by === v && list[k].hit; k--) freshTail++;
        const before = tail - freshTail;
        if (before < 5 && tail >= 5) hot = 'On fire!';
        else if (before < 3 && tail >= 3) hot = 'Hot streak!';
      }
      if (sunkMine.length) {
        const x = sunkMine[sunkMine.length - 1];
        const foe = foeOf(v);
        const left = afloat(s, foe);
        const finalWait = s.final && s.phase === 'battle';
        stamp(tChart, finalWait ? 'All sunk!' : sunkMine.length > 1 ? 'Double sink!' : 'Sunk!', over ? 'That’s the whole fleet' : finalWait ? `${nm(foe)} gets one last salvo` : `The ${shipName(s, foe, x.sunk)}${left === 1 ? ' · one to go' : ''}${torpBonus}`, wait + 280);
        later(() => api.sfx('hit'), FL); api.haptic(40);
        later(() => api.sfx('good'), wait + 300);
      } else if (sunkTheirs.length) {
        const x = sunkTheirs[sunkTheirs.length - 1];
        stamp(hChart, 'Sunk', `your ${shipName(s, v, x.sunk)}${sonarBonus}`, wait + 200, true);
        later(() => api.sfx('hit'), FL); api.haptic(40);
        later(() => api.sfx('bad'), wait + 240);
      } else if (hot) {
        stamp(tChart, hot, `${tailHits(s, v)} in a row${torpBonus}`, wait + 200);
        later(() => api.sfx('hit'), FL); api.haptic(25);
        later(() => api.sfx('good'), wait + 220);
      } else if (mineNew.some((x) => x.hit) && s.shots.findIndex((x) => x.hit) === s.shots.indexOf(mineNew.find((x) => x.hit))) {
        stamp(tChart, 'First hit!', 'Drew first blood', wait + 200);
        later(() => api.sfx('hit'), FL); api.haptic(25);
      } else if (list.length) {
        const last = list[lastK];
        if (last.hit) { later(() => api.sfx('hit'), FL); api.haptic(25); } else later(() => api.sfx(last.by === v ? 'pop' : 'tick'), FL);
      }
      if (s.final && s.phase === 'battle' && s.turn === v && theirsNew.length) stamp(tChart, 'Last salvo!', 'Sink them all to draw', wait + 1300);
      const scans = s.scans || [];
      for (const k of freshScans) {
        const x = scans[k];
        if (!x) continue;
        if (x.by === v) { stamp(tChart, `Ping: ${x.n}`, x.n ? `ship square${x.n === 1 ? '' : 's'} near ${coord(x.r, x.c)}` : `all clear around ${coord(x.r, x.c)}`, 120); api.sfx('pop'); later(() => api.sfx('tick'), 160); }
        else if (!list.length) { stamp(hChart, 'Pinged', `near ${coord(x.r, x.c)}`, 120, true); api.sfx('tick'); }
      }
      // the finale: whoever won gets a shower of printed paper; the loser's waters rumble
      if (over && list.length) {
        later(() => {
          if (!S.tlayer.isConnected) return;
          if (s.winner && s.winner !== v) shakeEl(S.hgrid, 5, 300);
          else confetti(S.tlayer, s.winner ? 26 : 12);
        }, wait + 420);
      }
    }

    function stamp(chart, text, sub, delay, badTone = false) {
      if (!chart) return;
      later(() => {
        if (!chart.isConnected) return;
        const t = document.createElement('div');
        t.className = `fl-stamp${badTone ? ' is-bad' : ''}`;
        t.setAttribute('role', 'status');
        t.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
        chart.appendChild(t);
        later(() => t.remove(), 2000);
      }, delay);
    }

    // ── aiming (hover + keyboard) ──
    function paintAim(show) {
      aimOn = !!show;
      paintTargetCells();
    }

    /** Play a battle move. Same phone: a move that passes the turn is shown first, then played. */
    function send(mv) {
      if (!ctx || !ctx.canMove || view !== 'battle' || hold) return false;
      if (ctx.mode === 'local') {
        let ns;
        try { ns = rules.apply(clone(ctx.state), ctx.actor, clone(mv)); } catch (err) { bad(err.message); return false; }
        if (ns.phase === 'battle' && ns.turn !== ctx.actor) {
          const from = ctx.state.shots.length;
          hold = { mv, state: ns, from };
          const fresh = Array.from({ length: ns.shots.length - from }, (_, k) => from + k);
          const sinks = fresh.some((i) => ns.shots[i].sunk >= 0);
          pick = []; armed = null; weapon = 'shot';
          render(fresh);
          hold.t = later(playHeld, reducedMotion() ? 500 : 1150 + 260 * Math.max(0, fresh.length - 1) + (sinks ? 900 : 0));
          return true;
        }
      }
      const res = api.move(mv);
      if (!res.ok) { bad(res.error); return false; }
      return true;
    }
    function playHeld() {
      const hd = hold;
      if (!hd) return;
      stop(hd.t);
      hold = null;
      const res = api.move(hd.mv);
      if (!res.ok) { bad(res.error); if (root.isConnected) render(); }
    }

    function tapTarget(r, c) {
      const s = ctx.state;
      const mode = modeOf(s);
      aim = { r, c };
      if (mode === 'salvo') {
        const k = pick.findIndex(([pr, pc]) => pr === r && pc === c);
        const need = salvoSize(s, ctx.actor);
        if (k >= 0) pick.splice(k, 1);
        else if (pick.length >= need) { bad(`That’s all ${need}. Fire, or tap one to take it back.`); return; }
        else pick.push([r, c]);
        api.sfx('tap');
        render();
        return;
      }
      if (mode === 'arsenal' && weapon !== 'shot') {
        if (armed && armed.r === r && armed.c === c) {
          const mv = weapon === 'sonar' ? { sonar: [r, c] } : { torp: [r, c, tdir] };
          if (send(mv)) { weapon = 'shot'; armed = null; }
          return;
        }
        armed = { r, c };
        api.sfx('tick');
        render();
        return;
      }
      send({ r, c });
    }
    function fireSalvo() {
      const need = salvoSize(ctx.state, ctx.actor);
      if (pick.length !== need) { bad(`Pick ${need - pick.length} more.`); return; }
      const mv = { salvo: pick.map(([r, c]) => [r, c]) };
      if (send(mv)) pick = [];
    }

    // ── placement actions ──
    function chooseStake(k) {
      if (!k || !ctx || !ctx.canMove || view !== 'place' || ctx.state.stake) return;
      const res = api.move({ stake: k });
      if (res.ok) api.sfx('good'); else bad(res.error);
    }
    function chooseRules(k) {
      if (!ctx || !ctx.canMove || view !== 'place' || ctx.state.mode) return;
      const res = api.move({ rules: k });
      if (res.ok) api.sfx('flip'); else bad(res.error);
    }
    function place(i, o, how) {
      const d = draft();
      d[i] = o;
      active = i;
      if (sel === i || sel < 0) sel = nextUnplaced(d, i + 1);
      fx = { drop: i };
      hoverKey = '';
      showPreview(null); // the screen used to be rebuilt after a placement, which put the hover preview away
      api.sfx(how === 'turn' ? 'flip' : 'place');
      api.haptic(12);
      render();
    }
    function rotate(i, k = 0) {
      const d = draft();
      const o = d[i];
      if (!o) return;
      const len = SIZES[i];
      k = clamp(k, 0, len - 1);
      const nd = o.dir === 'h' ? 'v' : 'h';
      const pr = o.dir === 'h' ? o.r : o.r + k;
      const pc = o.dir === 'h' ? o.c + k : o.c;
      const order = Array.from({ length: len }, (_, j) => j).sort((x, y) => Math.abs(x - k) - Math.abs(y - k));
      for (const j of order) {
        const cand = nd === 'v' ? { r: pr - j, c: pc, dir: nd } : { r: pr, c: pc - j, dir: nd };
        if (fits(d, i, cand)) { place(i, cand, 'turn'); return; }
      }
      active = i;
      bad('No room to turn it there.', sh && sh.layer && sh.layer._m ? sh.layer._m.get(`s${i}`) : null);
    }
    function tapPlace(r, c) {
      const d = draft();
      if (sel < 0) sel = nextUnplaced(d);
      if (sel < 0) return;
      for (const dir of [selDir, selDir === 'h' ? 'v' : 'h']) {
        const o = fitAt(sel, r, c, dir);
        if (fits(d, sel, o)) { place(sel, o); return; }
      }
      bad('No room there. Try another square.');
    }
    function shuffle() {
      const f = randomFleet();
      if (!f) return;
      DRAFTS.set(draftKey(), f);
      sel = -1;
      active = -1;
      fx = { shuffle: true };
      api.sfx('flip');
      api.haptic(15);
      render();
    }
    function ready() {
      const d = draft();
      if (d.some((x) => !x)) { bad('Place all five ships first.'); return; }
      const res = api.move({ fleet: d.map((o, i) => ({ r: o.r, c: o.c, len: SIZES[i], dir: o.dir })) });
      if (res.ok) { api.sfx('good'); api.haptic(20); } else bad(res.error);
    }

    // ── geometry for placement: read once (pointerdown, or the first hover after a repaint / resize / scroll), never per move ──
    function measure() {
      const g = root.querySelector('.fl-place .fl-grid');
      if (!g) { geo = null; return null; }
      const gr = g.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      geo = { gl: gr.left, gt: gr.top, gw: gr.width, cs: gr.width / N, rl: rr.left, rt: rr.top };
      return geo;
    }
    const getGeo = () => geo || measure();
    const dropGeo = () => { geo = null; if (drag) drag.dirty = true; };
    let ro = null;
    try { if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => dropGeo()); ro.observe(root); } } catch { ro = null; }
    window.addEventListener('resize', dropGeo);
    window.addEventListener('scroll', dropGeo, { capture: true, passive: true });

    /** The dashed box that shows where the ship would land. It moves by transform; its size changes only when the ship does. */
    function showPreview(o, len, ok) {
      const p = sh && sh.kind === 'place' ? sh.preview : null;
      if (!p) return;
      if (!o) { if (!p.hidden) p.hidden = true; return; }
      const w = o.dir === 'h' ? len : 1;
      const h = o.dir === 'v' ? len : 1;
      const st = p.style;
      if (p._w !== w) { p._w = w; st.setProperty('--w', w); }
      if (p._h !== h) { p._h = h; st.setProperty('--h', h); }
      st.setProperty('--r', o.r);
      st.setProperty('--c', o.c);
      if (p._ok !== ok) { p._ok = ok; p.classList.toggle('is-bad', !ok); }
      if (p.hidden) p.hidden = false;
    }
    function cellUnder(x, y) {
      const g = getGeo();
      if (!g) return null;
      const c = Math.floor((x - g.gl) / g.cs);
      const r = Math.floor((y - g.gt) / g.cs);
      return onChart(r, c) ? { r, c } : null;
    }

    // ── drag: the ship in your hand is moved by transform in a rAF, from rects read once at pointerdown ──
    function startDrag(e, t) {
      const i = Number(t.dataset.ship);
      const d = draft();
      const from = t.classList.contains('fl-dock-ship') ? 'dock' : 'chart';
      const rect = t.getBoundingClientRect();
      measure();
      drag = { i, from, el: t, id: e.pointerId, x0: e.clientX, y0: e.clientY, px: e.clientX, py: e.clientY, offX: e.clientX - rect.left, offY: e.clientY - rect.top, srcW: rect.width, srcH: rect.height, dir: from === 'chart' ? d[i].dir : 'h', moved: false, ghost: null, target: null, over: false, key: '', raf: 0, dirty: false };
      try { t.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    function ghostSize() {
      const g = getGeo();
      const cs = g ? g.cs : 40;
      const len = SIZES[drag.i];
      return { cs, w: drag.dir === 'h' ? len * cs : cs, h: drag.dir === 'v' ? len * cs : cs };
    }
    function paintGhost() {
      const { w, h } = ghostSize();
      drag.ghost.style.width = `${w}px`;
      drag.ghost.style.height = `${h}px`;
      drag.ghost.innerHTML = shipSVG(SIZES[drag.i], drag.dir);
    }
    function dragFrame() {
      const dg = drag;
      if (!dg) return;
      dg.raf = 0;
      if (!dg.ghost) return;
      if (dg.dirty) { dg.dirty = false; measure(); }
      const g = getGeo();
      if (!g) return;
      const x = dg.px;
      const y = dg.py;
      dg.ghost.style.transform = `translate3d(${(x - dg.offX - g.rl).toFixed(1)}px,${(y - dg.offY - g.rt).toFixed(1)}px,0)${reducedMotion() ? '' : ' rotate(-2deg) scale(1.05)'}`;
      const { cs } = g;
      const len = SIZES[dg.i];
      const wc = dg.dir === 'h' ? len : 1;
      const hc = dg.dir === 'v' ? len : 1;
      const over = x > g.gl - cs * 0.5 && x < g.gl + g.gw + cs * 0.5 && y > g.gt - cs * 0.5 && y < g.gt + g.gw + cs * 0.5;
      if (!over) {
        if (dg.key !== 'out') { dg.key = 'out'; dg.over = false; dg.target = null; showPreview(null); }
        return;
      }
      dg.over = true;
      const c = clamp(Math.round((x - dg.offX - g.gl) / cs), 0, N - wc);
      const r = clamp(Math.round((y - dg.offY - g.gt) / cs), 0, N - hc);
      const key = `${r},${c},${dg.dir}`;
      if (key === dg.key) return;
      dg.key = key;
      const o = { r, c, dir: dg.dir };
      const ok = fits(draft(), dg.i, o);
      dg.target = ok ? o : null;
      showPreview(o, len, ok);
    }
    function endDrag(commit) {
      const dg = drag;
      drag = null;
      if (!dg) return;
      if (dg.raf) cancelAnimationFrame(dg.raf);
      try { dg.el.releasePointerCapture(dg.id); } catch { /* ignore */ }
      if (dg.ghost) dg.ghost.remove();
      dg.el.classList.remove('is-lifted');
      showPreview(null);
      if (!dg.moved) { if (deferred) render(); return; }
      suppressClick = true;
      const d = draft();
      if (commit && dg.target) { place(dg.i, dg.target); return; }
      if (commit && !dg.over && dg.from === 'chart') {
        d[dg.i] = null;
        sel = dg.i;
        active = -1;
        api.sfx('flip');
        render();
        return;
      }
      if (commit && dg.over) { fx = { shake: dg.from === 'chart' ? dg.i : null }; bad('Ships can’t overlap.'); }
      render();
    }

    // ── events ──
    root.addEventListener('pointerdown', (e) => {
      suppressClick = false;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (view === 'battle') { if (e.target.closest('.fl-target .fl-head')) pressStart(e); return; }
      if (view !== 'place' || !ctx || !ctx.canMove || drag) return;
      const t = e.target.closest('.fl-dock-ship[data-ship], .is-edit .fl-ship[data-ship]');
      if (t) startDrag(e, t);
    });
    root.addEventListener('pointermove', (e) => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) pressEnd();
      if (drag && e.pointerId === drag.id) {
        drag.px = e.clientX;
        drag.py = e.clientY;
        if (!drag.moved) {
          if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 7) return;
          drag.moved = true;
          // the ghost is drawn at chart scale, so keep the grab point proportional
          const gs = ghostSize();
          drag.offX *= gs.w / Math.max(1, drag.srcW);
          drag.offY *= gs.h / Math.max(1, drag.srcH);
          drag.ghost = document.createElement('div');
          drag.ghost.className = `fl-ghost p-${V}`;
          paintGhost();
          root.appendChild(drag.ghost);
          drag.el.classList.add('is-lifted');
          api.sfx('tap');
          dragFrame();
        }
        e.preventDefault();
        if (!drag.raf) drag.raf = requestAnimationFrame(dragFrame);
        return;
      }
      if (e.pointerType !== 'mouse') return;
      if (view === 'place' && ctx && ctx.canMove) {
        const cell = e.target.closest('.is-edit .fl-cell') ? cellUnder(e.clientX, e.clientY) : null;
        if (cell && sel >= 0) {
          const key = `${cell.r},${cell.c},${sel},${selDir}`;
          if (key === hoverKey) return;
          hoverKey = key;
          const o = fitAt(sel, cell.r, cell.c, selDir);
          showPreview(o, SIZES[sel], fits(draft(), sel, o));
        } else if (hoverKey) { hoverKey = ''; showPreview(null); }
      } else if (view === 'battle') {
        const b = e.target.closest('.fl-target .fl-cell');
        if (b && !b.disabled) {
          const r = Number(b.dataset.r);
          const c = Number(b.dataset.c);
          if (!aimOn || aim.r !== r || aim.c !== c) { aim = { r, c }; paintAim(true); }
        } else if (!kbd && aimOn) paintAim(false);
      }
    });
    root.addEventListener('change', (e) => { const sel2 = e.target.closest && e.target.closest('select[data-stake]'); if (sel2) chooseStake(sel2.value); });
    root.addEventListener('contextmenu', (e) => { if (press) e.preventDefault(); }); // Android's long-press menu would cancel the press
    root.addEventListener('pointerleave', () => { pressEnd(); if (!drag && view === 'place') { hoverKey = ''; showPreview(null); } if (view === 'battle' && !kbd && aimOn) paintAim(false); });
    root.addEventListener('pointerup', (e) => {
      pressEnd();
      if (drag && e.pointerId === drag.id) {
        if (drag.moved) { drag.px = e.clientX; drag.py = e.clientY; if (drag.raf) { cancelAnimationFrame(drag.raf); drag.raf = 0; } dragFrame(); }
        endDrag(true);
      }
    });
    root.addEventListener('pointercancel', (e) => { pressEnd(); if (drag && e.pointerId === drag.id) endDrag(false); });
    root.addEventListener('lostpointercapture', (e) => {
      if (!drag || e.pointerId !== drag.id || !drag.moved) return;
      if (drag.raf) { cancelAnimationFrame(drag.raf); drag.raf = 0; }
      dragFrame();
      endDrag(true);
    });

    root.addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; return; }
      if (!ctx || !ctx.canMove) return;
      const act = e.target.closest('[data-fl]');
      if (act) {
        const a = act.dataset.fl;
        if (a === 'shuffle' && view === 'place') shuffle();
        else if (a === 'ready' && view === 'place') ready();
        else if (a === 'salvo-fire' && view === 'battle') fireSalvo();
        else if (a === 'salvo-clear' && view === 'battle') { pick = []; api.sfx('flip'); render(); }
        else if (a === 'tdir' && view === 'battle') { tdir = tdir === 'h' ? 'v' : 'h'; api.sfx('flip'); render(); }
        return;
      }
      if (view === 'place') {
        const rb = e.target.closest('[data-rules]');
        if (rb) { chooseRules(rb.dataset.rules); return; }
        const dockShip = e.target.closest('.fl-dock-ship[data-ship]');
        if (dockShip) { sel = Number(dockShip.dataset.ship); api.sfx('tap'); render(); return; }
        const ship = e.target.closest('.is-edit .fl-ship[data-ship]');
        if (ship) {
          const i = Number(ship.dataset.ship);
          const o = draft()[i];
          const rect = ship.getBoundingClientRect();
          let k = 0;
          if (e.detail && o) {
            k = o.dir === 'h' ? Math.floor(((e.clientX - rect.left) / rect.width) * SIZES[i]) : Math.floor(((e.clientY - rect.top) / rect.height) * SIZES[i]);
          }
          rotate(i, k);
          return;
        }
        const cell = e.target.closest('.is-edit .fl-cell');
        if (cell) tapPlace(Number(cell.dataset.r), Number(cell.dataset.c));
        return;
      }
      if (view === 'battle') {
        const w = e.target.closest('[data-wpn]');
        if (w && !w.disabled) { weapon = w.dataset.wpn; armed = null; api.sfx('tap'); render(); return; }
        const cell = e.target.closest('.fl-target .fl-cell');
        if (cell && !cell.disabled) tapTarget(Number(cell.dataset.r), Number(cell.dataset.c));
      }
    });

    const onKey = (e) => {
      if (!root.isConnected || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
      const gm = root.closest('.gm');
      if (gm && gm.querySelector('.gm-sheet:not([hidden]), .gm-end:not([hidden]), .gm-curtain:not([hidden])')) return;
      if (!ctx || !ctx.canMove) return;
      if (view === 'place' && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        if (drag && drag.moved) {
          drag.dir = drag.dir === 'h' ? 'v' : 'h';
          const tmp = drag.offX; drag.offX = drag.offY; drag.offY = tmp;
          drag.key = '';
          paintGhost();
          api.sfx('flip');
          if (!drag.raf) drag.raf = requestAnimationFrame(dragFrame);
          return;
        }
        const d = draft();
        const preview = sh && sh.kind === 'place' ? sh.preview : null;
        if (sel >= 0 && preview && !preview.hidden) { selDir = selDir === 'h' ? 'v' : 'h'; api.sfx('flip'); hoverKey = ''; showPreview(null); return; }
        if (active >= 0 && d[active]) { rotate(active, 0); return; }
        if (sel >= 0) { selDir = selDir === 'h' ? 'v' : 'h'; api.sfx('flip'); api.toast(selDir === 'h' ? 'Placing across' : 'Placing down'); }
        return;
      }
      if (view !== 'battle') return;
      const mode = modeOf(ctx.state);
      // a focused button or link keeps its own Enter / Space (the back button must still go back)
      const onCell = t && t.closest ? t.closest('.fl-target .fl-cell') : null;
      const onControl = !onCell && t && t !== document.body && t.closest && t.closest('button, a[href], [role="button"], [tabindex]:not([tabindex="-1"])');
      if ((e.key === 'r' || e.key === 'R') && mode === 'arsenal' && weapon === 'torp') { e.preventDefault(); tdir = tdir === 'h' ? 'v' : 'h'; api.sfx('flip'); render(); return; }
      if ((e.key === 'f' || e.key === 'F') && mode === 'salvo') { e.preventDefault(); fireSalvo(); return; }
      const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (step) {
        if (onControl) return;
        e.preventDefault();
        if (onCell) { aim = { r: Number(onCell.dataset.r), c: Number(onCell.dataset.c) }; kbd = true; }
        if (kbd) aim = { r: clamp(aim.r + step[0], 0, N - 1), c: clamp(aim.c + step[1], 0, N - 1) };
        kbd = true;
        paintAim(true);
        if (onCell) { const nb = sh && sh.kind === 'battle' ? sh.cells[aim.r * N + aim.c] : null; if (nb && !nb.disabled) nb.focus(); }
        api.sfx('tick');
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        if (onControl || onCell) return; // the native click does it: a focused square fires at itself
        e.preventDefault();
        if (!kbd) { kbd = true; paintAim(true); return; }
        const b = sh && sh.kind === 'battle' ? sh.cells[aim.r * N + aim.c] : null;
        if (b && !b.disabled) tapTarget(aim.r, aim.c);
      }
    };
    document.addEventListener('keydown', onKey);

    return {
      update(c) {
        ctx = c;
        const s = c.state;
        const v = c.viewer || (c.over ? s.winner : null);
        const shots = s.shots || [];
        const scans = s.scans || [];
        let fresh = [];
        let freshScans = [];
        let battleStart = false;
        let live = false;
        if (v) {
          // new shots since the last paint, but at most the latest volley (after a reconnect a pile
          // of shots can land at once, and replaying them all one by one would take ages)
          if (seenViewer === v && shots.length > seenShots) { const run0 = lastRun(shots)[0]; fresh = Array.from({ length: shots.length - seenShots }, (_, k) => seenShots + k).filter((i) => i >= run0); }
          else if (seenViewer !== v && shots.length && shots[shots.length - 1].by !== v) fresh = lastRun(shots); // catch up on their volley
          if (seenViewer === v && scans.length > seenScans) freshScans = Array.from({ length: scans.length - seenScans }, (_, k) => seenScans + k).slice(-2);
          else if (seenViewer !== v && scans.length && scans[scans.length - 1].by !== v && scans[scans.length - 1].at >= (fresh[0] ?? shots.length)) freshScans = [scans.length - 1];
          battleStart = seenPhase === 'place' && s.phase === 'battle' && !shots.length;
          live = seenPhase != null && seenPhase !== 'over' && s.phase === 'over';
          if (shots.length !== seenShots || scans.length !== seenScans || seenViewer !== v) { pick = []; armed = null; weapon = 'shot'; if (!kbd) aimOn = false; }
          seenViewer = v;
          seenShots = shots.length;
          seenScans = scans.length;
          seenPhase = s.phase;
        } else seenViewer = null;
        if (V !== v) { sel = 0; selDir = 'h'; active = -1; scope = false; }
        V = v;
        if (s.phase !== 'battle') scope = false; // the periscope never outlives the battle
        if (v && s.fleets && s.fleets[v]) DRAFTS.delete(`${c.matchId}|${v}`);
        if (s.phase === 'over') logRecords(s, c.matchId, live);
        render(fresh, battleStart, freshScans);
        if (c.over) later(() => api.showEnd(), fresh.length ? 1900 + 260 * (fresh.length - 1) : 300);
      },
      destroy() {
        playHeld(); // closing mid-splash still plays the move that was taken
        scope = false;
        pressEnd();
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('resize', dropGeo);
        window.removeEventListener('scroll', dropGeo, { capture: true });
        if (ro) { try { ro.disconnect(); } catch { /* ignore */ } }
        if (drag && drag.raf) cancelAnimationFrame(drag.raf);
        for (const t of timers) clearTimeout(t);
        timers.clear();
        drag = null;
      },
    };
  },
});

function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
