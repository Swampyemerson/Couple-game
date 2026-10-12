// Rail Rush rivalry & moments: everything the run says that isn't a sim event. Rivalry pops
// (OVERTAKE! / REVENGE! / "Sydney passed you", best-stripe crossings, neck and neck), district
// entries, event warnings (Coin Rush, Golden Hundred), the last-heart clutch, Together's shared
// power-ups and the lines the end card shares (lead changes, team best).
//
// Local, from presence: each device reads the partner's streamed position, so nothing here is sent
// except the one reliable `share`. Every pop fires on a *change* (a state machine with hysteresis),
// never per frame, and nothing allocates in tick(). The shared end-card text is decorated once, by
// the judge (the host, or the one device), so both phones show the same line.
import { CHUNK, MAGNET_T, SNEAKERS_T, DOUBLE_T } from './tune.js';
import { DISTRICTS, districtSeq, districtIn, isZoneStart, I_MAGNET, I_SNEAKERS, I_DOUBLE, EV_RUSH, EV_HUNDRED } from './track.js';

export const PASS_GAP = 4;       // m ahead the new leader must be…
export const PASS_HOLD = 0.6;    // …for this long before it counts as a lead change
export const PASS_QUIET = 3;     // s between two rivalry pops
export const REVENGE_T = 10;     // s: retaking the lead within this of losing it is REVENGE!
export const NECK_GAP = 5;       // m: closer than this…
export const NECK_HOLD = 3;      // …for this long is neck and neck (stays on until the gap passes NECK_OFF)
export const NECK_OFF = 8;
export const CLUTCH_M = 500;     // m survived on the last heart
export const CLUTCH_COINS = 20;
export const RUSH_WARN_S = 2;    // s of warning before a Coin Rush field
const POP_T = 1.15;              // s a centre pop stays up (the next one waits its turn)

/** Pop names of the pickups a runner can grab (the box is the weapon roll; the note is the loop builder's). */
export const PICK_NAME = ['', 'MAGNET', 'SUPER SNEAKERS', 'SHIELD', '', '', '', 'COIN DOUBLER'];
const SHARED = { [I_MAGNET]: MAGNET_T, [I_SNEAKERS]: SNEAKERS_T, [I_DOUBLE]: DOUBLE_T };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * X: { M, players, viewers, other(w), audio, now(), send(to, type, data), data(), setData(patch),
 *      haptic(n), fmtM(m), zOf(w) (the judge's view of a runner's distance), bestKey(w) }
 */
export function createRivalry(X) {
  const { M, players, viewers, audio } = X;
  const AB = ['a', 'b'];
  const mkView = () => ({
    lead: 0, cand: 0, candT: 0, lastAt: -1e9, lostAt: -1e9, tookAt: -1e9,
    neckT: 0, neck: false, low: false,
    qz: -1, pz: -1, mine: 0, theirs: 0, fMine: false, fTheirs: false, fQ: false,
    dci: -1, zone: -1, rushAt: -1, hundAt: -1,
    clz: -1, clDone: false, clutches: 0, free: 0, q: [],
  });
  const st = { a: mkView(), b: mkView() };
  const R = { T: 0, changes: 0, seq: null, heart: false, key: 0, mode: 0 };

  const pop = (w, text, cls, sub) => { const v = players[w] && players[w].view; if (v) v.pop(text, cls, sub); };
  /** A pop (with its sound) for view w. Centre pops stack on one spot, so they take turns: if one is still on screen the next waits (at most 3 wait, none longer than 4 s). */
  function say(w, s, text, cls, sub, snd) {
    if (R.T >= s.free) { pop(w, text, cls, sub); if (snd) audio.play(snd); s.free = R.T + POP_T; }
    else if (s.q.length < 3) s.q.push({ text, cls, sub, snd, at: R.T });
  }
  function flush(w, s) {
    while (s.q.length && R.T >= s.free) {
      const e = s.q.shift();
      if (R.T - e.at > 4) continue;
      pop(w, e.text, e.cls, e.sub); if (e.snd) audio.play(e.snd); s.free = R.T + POP_T;
    }
  }

  /** A new match: forget everything, snapshot the bests the stripes are drawn at. */
  function reset() {
    R.T = 0; R.changes = 0; R.heart = false; R.seq = districtSeq(M.seed); R.key = -1;
    M.leadChanges = 0;
    R.mode = M.mode === 'race' || M.mode === 'daily' ? 1 : 0;
    const d = X.data();
    for (const w of AB) {
      const s = st[w]; const q = X.other(w);
      s.lead = 0; s.cand = 0; s.candT = 0; s.lastAt = -1e9; s.lostAt = -1e9; s.tookAt = -1e9; s.neckT = 0; s.neck = false; s.low = false;
      s.qz = -1; s.pz = -1; s.fMine = false; s.fTheirs = false; s.fQ = false;
      s.mine = R.mode ? d[X.bestKey(w)] | 0 : 0;
      s.theirs = R.mode ? d[X.bestKey(q)] | 0 : 0;
      if (s.mine <= 60) s.fMine = true; // (no stripe: nothing to cross)
      if (s.theirs <= 60) s.fTheirs = true;
      if (s.mine <= 60) s.fQ = true;
      if (Math.abs(s.mine - s.theirs) <= 3) s.fTheirs = true; // (one stripe for both: "NEW BEST!" says it)
      s.dci = -1; s.zone = -1; s.rushAt = -1; s.hundAt = -1;
      s.clz = -1; s.clDone = false; s.clutches = 0; s.free = 0; s.q.length = 0;
      const p = players[w];
      if (p) { p.stats.clutch = 0; p.stats.crossed = 0; p.stats.leadChanges = 0; }
    }
  }

  // ── per frame (run, not paused) ──
  function tick(dt) {
    R.T += dt;
    let maxZ = 0;
    for (let vi = 0; vi < viewers.length; vi++) {
      const w = viewers[vi];
      const p = players[w]; const r = p.r;
      if (!r || !p.view) continue;
      const s = st[w]; const q = players[X.other(w)];
      const pz = p.rs.z; const qz = q.rs.z;
      if (pz > maxZ) maxZ = pz;
      if (R.T > 1) {
        if (s.q.length) flush(w, s);
        if (R.mode) { rivalry(w, p, q, s, pz, qz, dt); bests(w, p, q, s, pz, qz); }
        district(w, s, pz);
        events(w, r, s, pz);
        clutch(w, p, r, s);
      }
      s.pz = pz; s.qz = qz;
    }
    // music key follows the district of the front viewer (shifts at a bar line, see audio.js)
    if (R.seq) {
      const id = districtIn(R.seq, Math.floor(maxZ / CHUNK));
      if (id !== R.key) { R.key = id; audio.setDistrict(id); }
    }
  }

  function rivalry(w, p, q, s, pz, qz, dt) {
    const r = p.r;
    const g = qz - pz; // > 0: they're ahead
    const live = !r.down && !r.out && !r.done && !q.rs.down && !q.rs.idle && q.rs.visible && qz > 0;
    const cand = g >= PASS_GAP ? -1 : g <= -PASS_GAP ? 1 : 0;
    if (!live) {
      // a crash or a spectating partner isn't a pass: follow the lead quietly, no pop, no count
      s.cand = 0; s.candT = 0; s.neckT = 0; s.neck = false;
      if (cand) s.lead = cand;
      return;
    }
    const ag = g < 0 ? -g : g;
    if (ag < NECK_GAP) { s.neckT += dt; if (s.neckT >= NECK_HOLD) s.neck = true; }
    else if (ag >= NECK_OFF) { s.neckT = 0; s.neck = false; }
    else if (!s.neck) s.neckT = 0;
    if (s.lead === 0) { if (cand) s.lead = cand; return; }
    if (!cand || cand === s.lead) { s.cand = 0; s.candT = 0; return; }
    if (s.cand !== cand) { s.cand = cand; s.candT = 0; }
    s.candT += dt;
    if (s.candT < PASS_HOLD || R.T - s.lastAt < PASS_QUIET) return;
    // a lead change, held long enough and not on the heels of the last pop
    s.lead = cand; s.cand = 0; s.candT = 0; s.lastAt = R.T;
    if (w === viewers[0]) { R.changes++; M.leadChanges = R.changes; }
    p.stats.leadChanges++;
    if (cand > 0) {
      const revenge = R.T - s.lostAt <= REVENGE_T;
      s.tookAt = R.T;
      say(w, s, revenge ? 'REVENGE!' : 'OVERTAKE!', revenge ? 'hl' : 'good', revenge ? `back ahead of ${q.name}` : `you passed ${q.name}`, revenge ? 'revenge' : 'pass');
      X.haptic(12);
    } else {
      s.lostAt = R.T;
      say(w, s, `${q.name} passed you`, 'p' + q.w, R.T - s.tookAt <= REVENGE_T ? 'they took it back' : '', 'passed');
    }
  }

  /** The stripes: crossing my own best, their best, and them crossing mine (both phones pop). */
  function bests(w, p, q, s, pz, qz) {
    const step = pz - s.pz; const qstep = qz - s.qz;
    if (!s.fMine && s.pz >= 0 && s.pz < s.mine && pz >= s.mine && step < 60) {
      s.fMine = true; p.stats.crossed++;
      say(w, s, 'NEW BEST!', 'hl', `past ${X.fmtM(s.mine)} m`, 'sting');
    }
    if (!s.fTheirs && s.pz >= 0 && s.pz < s.theirs && pz >= s.theirs && step < 60) {
      s.fTheirs = true; p.stats.crossed++;
      say(w, s, `You beat ${q.name}’s best`, 'good', `${X.fmtM(s.theirs)} m`, 'sting');
      X.haptic(15);
    }
    if (!s.fQ && s.qz >= 0 && s.qz < s.mine && qz >= s.mine && qstep < 60 && q.rs.visible) {
      s.fQ = true;
      say(w, s, `${q.name} just beat your best`, 'p' + q.w, `${X.fmtM(s.mine)} m`, 'sting');
      X.haptic(15);
    }
  }

  /** "HARBOUR" tag on the first chunk of a new district zone. */
  function district(w, s, pz) {
    const ci = Math.floor(pz / CHUNK);
    if (ci === s.dci) return;
    const was = s.dci; s.dci = ci;
    if (was < 0 || ci !== was + 1 || !isZoneStart(ci) || s.zone === ci) return;
    s.zone = ci;
    const d = DISTRICTS[districtIn(R.seq, ci)];
    pop(w, d ? d.name : '', 'tag', '');
    audio.play('district');
  }

  /** Track v2 events: Coin Rush ~2 s before its field, Golden Hundred on entering its chunk. */
  function events(w, r, s, pz) {
    const tr = M.track;
    if (!tr || tr.ver < 2) return;
    const ci = Math.floor(pz / CHUNK);
    for (let k = 0; k < 2; k++) {
      const c = tr.chunk(ci + k);
      const ev = c.event | 0;
      if (!ev) continue;
      if (ev === EV_RUSH && s.rushAt !== c.i) {
        const d = c.eventZ - pz;
        if (d < r.speed * RUSH_WARN_S && d > -30) { s.rushAt = c.i; say(w, s, 'COIN RUSH!', 'hl', 'grab every lane', 'event'); }
      } else if (ev === EV_HUNDRED && s.hundAt !== c.i && pz >= c.z0) {
        s.hundAt = c.i; say(w, s, 'GOLDEN HUNDRED', 'hl', 'coins ×2', 'event');
      }
    }
  }

  /** The last heart: a ring + heartbeat while it lasts; 500 m on it pays CLUTCH! once per heart lost. */
  function clutch(w, p, r, s) {
    const low = M.mode !== 'tandem' && r.hearts === 1 && !r.out && M.phase === 'run';
    s.low = low;
    if (!low) { s.clz = -1; s.clDone = false; return; }
    if (r.down) return;
    if (s.clz < 0) { s.clz = r.z; return; }
    if (!s.clDone && r.z - s.clz >= CLUTCH_M) {
      s.clDone = true; s.clutches++;
      r.coins += CLUTCH_COINS; r.bonus += CLUTCH_COINS;
      p.stats.clutch++;
      say(w, s, 'CLUTCH!', 'good', `+${CLUTCH_COINS} coins`, 'clutch');
      X.haptic(20);
    }
  }

  // ── Together: a power-up picked by one is shared with the other ──
  /** A local runner just picked item kind k (drain). Returns the sub line for its own pop. */
  function onPick(p, k) {
    if (M.mode !== 'tandem' || !SHARED[k]) return '';
    const q = X.other(p.w);
    X.send(q, 'share', { k });
    return `shared with ${players[q].name}`;
  }
  /** The reliable `share` event arrived (or was queued, one device): apply it to my own runner. */
  function onShare(d, at, from) {
    const w = X.other(from); const p = players[w]; const r = p && p.r;
    const k = d && d.k | 0;
    if (!r || !p.local || M.phase !== 'run' || !SHARED[k] || r.done) return;
    // the same duration the picker got, less the time the message took
    const left = Math.max(0.5, SHARED[k] - clamp((X.now() - at) / 1000, 0, 3));
    if (k === I_MAGNET) r.magnetT = Math.max(r.magnetT, left);
    else if (k === I_SNEAKERS) r.sneakersT = Math.max(r.sneakersT, left);
    else r.dblT = Math.max(r.dblT, left);
    say(w, st[w], `${players[from].name} shared a ${PICK_NAME[k]}`, 'hl', '', 'share');
  }

  // ── the shared end-card line (judge only: its text rides in the result, so both phones agree) ──
  function decorate(res) {
    if (!res || res.forfeit) return res;
    const add = (t) => { res.sub = res.sub ? `${res.sub} · ${t}` : t; };
    if ((M.mode === 'race' || M.mode === 'daily') && R.changes > 0) { res.lc = R.changes; add(`${R.changes} lead change${R.changes === 1 ? '' : 's'}`); }
    if (res.team) {
      const m = Math.round((X.zOf('a') + X.zOf('b')) / 2);
      const prev = X.data().team_best_m | 0;
      res.m = m; res.tb = prev;
      if (prev > 0 && m > prev) { res.tbNew = 1; add('New team best!'); } else if (prev > 0) add(`Team best ${X.fmtM(prev)} m`);
      else if (m > 0) add(`Team best ${X.fmtM(m)} m`);
    }
    return res;
  }
  /** The finale starts (both devices): record the team best, celebrate a new one. */
  function finale(res) {
    if (!res || !res.team || !(res.m > 0)) return;
    if (res.m > (X.data().team_best_m | 0)) X.setData({ team_best_m: res.m });
    if (res.tbNew) { for (const w of viewers) pop(w, 'NEW TEAM BEST!', 'hl', `${X.fmtM(res.m)} m together`); audio.play('good'); }
  }

  return {
    reset, tick, onPick, onShare, decorate, finale,
    neck: (w) => st[w].neck,
    low: (w) => st[w].low,
    get anyLow() { for (let i = 0; i < viewers.length; i++) if (st[viewers[i]].low && !players[viewers[i]].r.down) return true; return false; },
    get changes() { return R.changes; },
    debug: () => ({ T: R.T, changes: R.changes, a: { ...st.a }, b: { ...st.b }, seq: R.seq, key: R.key }),
  };
}

