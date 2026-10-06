// Rail Rush mode rules: Race (weapons + rubber-banding), Brawl (shoves), Tandem (revives, team
// hearts, coin goals) and the host's verdicts. Works the same with one device (both runners
// local, messages delivered directly) and two (messages over the reliable link).
import { LANE_W, CHUNK, ROOF, BOOST_T, REVIVE_WINDOW, TEAM_HEARTS, TEAM_HEARTS_MAX, BRAWL_CAP, STEP_UP } from './tune.js';
import { O_BLOCK, O_TRAIN, O_MTRAIN, O_RAMP, pathLane } from './track.js';
import { crash, respawn, C_SLAM, E_PICK, E_CRASH, E_FINISH, E_TOKEN, E_BLOCK } from './sim.js';
import { I_BOX } from './track.js';

export const MODES = ['race', 'brawl', 'tandem'];
export const MODE_LABEL = { race: 'Race', brawl: 'Brawl', tandem: 'Together' };
const GOALS = [100, 250, 450, 700, 1000, 1400, 1900, 2500];

const pick = (table) => {
  let t = 0;
  for (const [, w] of table) t += w;
  let q = Math.random() * t;
  for (const [k, w] of table) { q -= w; if (q <= 0) return k; }
  return table[0][0];
};

/** Is there a train-like body in `lane` around z that the runner couldn't stand on? */
export function wallAt(track, lane, z, y) {
  const ci = Math.floor(z / CHUNK);
  for (let c = ci - 1; c <= ci + 1; c++) {
    if (c < 0) continue;
    for (const o of track.chunk(c).obs) {
      if (o.lane !== lane || o.z1 < z - 1 || o.z0 > z + 1) continue;
      if ((o.t === O_TRAIN || o.t === O_MTRAIN || o.t === O_RAMP) && y < ROOF - STEP_UP) return true;
    }
  }
  return false;
}

function clearSpot(track, lane, z) {
  const ci = Math.floor(z / CHUNK);
  for (let c = ci - 1; c <= ci + 1; c++) {
    if (c < 0) continue;
    const ch = track.chunk(c);
    for (const o of ch.obs) if (o.lane === lane && o.z1 > z - 6 && o.z0 < z + 6) return false;
    for (const g of ch.gaps) if ((g.mask & (1 << (lane + 1))) && g.z1 > z - 6 && g.z0 < z + 6) return false;
  }
  return true;
}

export function createRules(G) {
  const { M } = G;
  let seq = 1;
  const pending = new Map(); // my attacks waiting for a result
  const missedIds = new Set();
  const revivedIds = new Set();
  const countRevive = (id) => { if (G.isJudge()) { revivedIds.add(id); M.revives = revivedIds.size; } };

  const other = (w) => (w === 'a' ? 'b' : 'a');
  const P = (w) => G.players[w];

  function init() {
    seq = 1 + Math.floor(Math.random() * 1000) * 10;
    pending.clear();
    missedIds.clear();
    revivedIds.clear();
    M.th = TEAM_HEARTS; M.goalIdx = 0; M.goal = GOALS[0]; M.revives = 0;
    M.partnerFin = -1; M.partnerOut = -1;
    for (const w of ['a', 'b']) {
      const p = P(w);
      p.weapon = null; p.weaponRoll = 0; p.shoveCD = 0; p.revive = null; p.downId = 0; p.downAt = 0; p.pushOff = 0;
      p.stats = { shoves: 0, slams: 0, inks: 0, hits: 0, revives: 0, dodges: 0 };
      if (p.r) {
        p.r.tandem = M.mode === 'tandem' ? 1 : 0;
        p.r.finLen = M.mode === 'race' ? M.len : 0;
      }
    }
  }

  // ── weapons ──
  function rollWeapon(p) {
    const q = P(other(p.w));
    const gap = G.rs(q).z - G.rs(p).z;
    let table;
    if (gap > 60) table = [['ink', 35], ['zap', 25], ['rocket', 30], ['shield', 10]];
    else if (gap > 12) table = [['ink', 35], ['zap', 30], ['rocket', 15], ['shield', 10], ['block', 10]];
    else if (gap >= -12) table = [['ink', 20], ['zap', 25], ['block', 25], ['shield', 20], ['rocket', 10]];
    else if (gap >= -60) table = [['block', 45], ['shield', 35], ['zap', 20]];
    else table = [['block', 40], ['shield', 55], ['zap', 5]];
    return pick(table);
  }

  function use(p) {
    if (M.mode !== 'race' || M.phase !== 'run' || !p.r || p.r.down || !p.weapon || p.weaponRoll > 0) return false;
    const kind = p.weapon;
    p.weapon = null;
    const q = P(other(p.w));
    const r = p.r;
    const qs = G.rs(q);
    const id = seq++;
    const v = G.view(p.w);
    G.audio.play('weapon');
    if (kind === 'rocket') { r.boostT = BOOST_T; v && v.pop('ROCKET!', 'hl'); G.kick(p.w, 1); G.audio.play('power'); return true; }
    if (kind === 'shield') { r.shield = 1; v && v.pop('Shield up', 'hl'); G.audio.play('shield'); return true; }
    if (kind === 'ink') {
      if (qs.z > r.z - 3 && !qs.down) {
        G.send(q.w, 'atk', { id, k: 'ink', z: r.z, l: r.lane });
        pending.set(id, { k: 'ink', t: G.now() });
        G.projectile(p.w, q.w, 'ink');
      } else { G.projectile(p.w, null, 'ink'); v && v.pop('Nobody ahead!', '', 'Ink flies best forward'); }
      p.stats.inks++;
      return true;
    }
    if (kind === 'block') {
      G.send(q.w, 'atk', { id, k: 'block', z: r.z - 1, l: Math.max(-1, Math.min(1, Math.round(qs.laneX / LANE_W))) });
      pending.set(id, { k: 'block', t: G.now() });
      G.fx.burst(r.x, r.y + 0.5, r.z - 1, G.pal[p.w], 10, 4);
      v && v.pop('Roadblock!', 'p' + p.w, qs.z < r.z ? `dropped in ${q.name}’s lane` : `${q.name} is ahead`);
      return true;
    }
    if (kind === 'zap') {
      G.send(q.w, 'atk', { id, k: 'zap', z: r.z, l: r.lane });
      pending.set(id, { k: 'zap', t: G.now() });
      G.projectile(p.w, q.w, 'zap');
      v && v.pop('ZAP!', 'hl');
      return true;
    }
    return false;
  }

  /** A lane input from a local player: in Brawl it may be a shove. */
  function onLane(p, dir) {
    if (M.mode !== 'brawl' || M.phase !== 'run' || !p.r) return;
    const r = p.r;
    if (r.down || r.done || p.shoveCD > 0) return;
    const to = r.lane + dir;
    if (to < -1 || to > 1) return;
    const q = P(other(p.w));
    const qs = G.rs(q);
    if (qs.down || qs.invuln) return;
    const qLane = Math.round(qs.x / LANE_W);
    if (Math.abs(qs.z - r.z) > 2.0 || qLane !== to || Math.abs(qs.ground - (r.sup > -50 ? r.sup : 0)) > 1) return;
    const id = seq++;
    p.shoveCD = 1.2;
    p.av && p.av.lunge(dir);
    q.pushOff = dir * LANE_W * 0.55; // predicted push, corrected by their real state
    G.audio.play('whoosh', dir);
    pending.set(id, { k: 'shove', t: G.now() });
    G.send(q.w, 'shove', { id, z: r.z, from: r.lane, to, y: r.y });
  }

  // ── messages (data, sentAt on the shared clock, from = sender) ──
  function msg(type, d, at, from) {
    const to = other(from);
    const p = P(to);
    const r = p.r;
    const v = G.view(to);
    const reply = (res) => G.send(from, 'res', { id: d.id, k: d.k || type, r: res });
    if (type === 'atk') {
      if (!r || M.phase !== 'run') { reply('miss'); return; }
      if (d.k === 'ink') {
        if (r.down || r.done) { reply('miss'); return; }
        if (r.shield) { r.shield = 0; G.fx.burst(r.x, r.y + 1.2, r.z, G.pal.hl, 12, 5); v && v.pop('Blocked!', 'hl', 'shield took the ink'); G.audio.play('shield'); reply('blocked'); return; }
        G.splat(to, from);
        reply('hit');
        return;
      }
      if (d.k === 'zap') {
        if (r.down || r.done) { reply('miss'); return; }
        if (r.shield) { r.shield = 0; v && v.pop('Blocked!', 'hl'); G.audio.play('shield'); reply('blocked'); return; }
        r.zapT = 0.35; r.zapDir = d.id % 2 ? 1 : -1;
        v && v.pop('ZAPPED!', 'hl', 'hold on'); v && v.flash();
        G.audio.play('zap');
        G.fx.burst(r.x, r.y + 2, r.z, G.pal.hl, 10, 4);
        reply('hit');
        return;
      }
      if (d.k === 'block') {
        const lane = Math.max(-1, Math.min(1, d.l | 0));
        let z = Math.max(d.z, r.z + 32);
        let ok = false;
        for (let k = 0; k < 12; k++) { if (clearSpot(G.track, lane, z)) { ok = true; break; } z += 6; }
        if (!ok || r.done) { reply('miss'); return; }
        r.extra.push({ id: 900000 + d.id, t: O_BLOCK, lane, z0: z, z1: z + 0.7, b: 0, h: 1.1, hw: 1.15, walk: false, gone: 0, hit: 0, rgb: G.pal[from], atk: d.id, from });
        r.extra.sort((x, y) => x.z0 - y.z0);
        v && v.pop('Roadblock ahead!', 'bad', `${G.name(from)} dropped it`);
        return; // result comes when it's hit or passed
      }
    }
    if (type === 'res') {
      const pd = pending.get(d.id);
      pending.delete(d.id);
      const atk = P(to); // the attacker is the receiver here
      const av = G.view(to);
      const qn = G.name(from);
      if (d.k === 'shove') {
        if (d.r === 'hit' || d.r === 'slam') {
          atk.stats.shoves++;
          if (d.r === 'slam') atk.stats.slams++;
          if (atk.r) atk.r.shoveT = 1.2;
          av && av.pop(d.r === 'slam' ? 'SLAM!' : 'SHOVE!', 'p' + to, d.r === 'slam' ? `${qn} hit the wall` : '');
          G.audio.play('shove'); G.shake(to, 0.25); G.kick(to, 0.6);
        } else if (d.r === 'dodged') { av && av.pop('Whiff!', '', `${qn} jumped it`); G.audio.play('whiff'); }
        else if (d.r === 'blocked') av && av.pop('Shielded', 'hl');
        return;
      }
      if (d.r === 'hit') { atk.stats.hits++; av && av.pop(d.k === 'ink' ? `Inked ${qn}!` : d.k === 'block' ? `${qn} hit it!` : `Zapped ${qn}!`, 'p' + to); G.audio.play('good'); }
      else if (d.r === 'blocked') av && av.pop(`${qn} had a shield`, '');
      else if (d.r === 'dodged') av && av.pop(`${qn} dodged it`, '');
      void pd;
      return;
    }
    if (type === 'shove') {
      if (!r || M.phase !== 'run') { reply('miss'); return; }
      // Victim decides with lag compensation: where was I at the attacker's timestamp?
      const h = G.history(to, at);
      const ref = G.remoteAt(from, at); // the attacker as I saw them then (net.remote(at))
      const az = ref ? (ref.z + d.z) / 2 : d.z;
      const side = Math.abs(h.z - d.z) < 2.4 || Math.abs(h.z - az) < 2.4;
      const inLane = h.lane === d.to || Math.abs(h.x - d.to * LANE_W) < LANE_W * 0.55;
      if (r.down || r.done || r.invulnT > 0 || !side || !inLane) { reply('miss'); return; }
      if (h.y - h.g > 0.45 || (!r.grounded && r.y - Math.max(0, r.sup) > 0.6)) {
        p.stats.dodges++;
        v && v.pop('DODGED!', 'good'); reply('dodged'); return;
      }
      if (r.shield) { r.shield = 0; v && v.pop('Shield!', 'hl'); G.audio.play('shield'); reply('blocked'); return; }
      const dir = Math.sign(d.to - d.from) || 1;
      const nl = r.lane + dir;
      G.audio.play('shove'); G.shake(to, 0.45);
      if (nl < -1 || nl > 1 || wallAt(G.track, nl, r.z, r.y)) {
        crash(r, C_SLAM, false);
        v && v.pop('SLAMMED!', 'bad', `by ${G.name(from)}`);
        reply('slam');
        return;
      }
      r.laneFrom = r.lane; r.lane = nl; r.xFrom = r.x; r.laneT = 0; r.laneAge = 0;
      r.stumbleT = 0.9; r.stumbles++;
      v && v.pop('SHOVED!', 'p' + from);
      reply('hit');
      return;
    }
    if (type === 'fin') { if (G.isJudge()) M.partnerFin = d.rt; return; }
    if (type === 'out') { if (G.isJudge()) M.partnerOut = d.rt; return; }
    if (type === 'down') {
      // my partner went down: give me revive tokens
      if (!r) return;
      p.revive = { id: d.id, from, until: at + REVIVE_WINDOW, next: 0, n: 0 };
      return;
    }
    if (type === 'revive') {
      if (!r || !r.down || p.downId !== d.id) return;
      const lane = freeLaneNear(d.l, d.z);
      respawn(r, G.track, d.z, lane);
      p.downId = 0;
      countRevive(d.id);
      v && v.pop('Back in it!', 'good', `${G.name(from)} saved you`);
      G.audio.play('revive');
      G.fx.burst(r.x, 1.2, r.z, G.pal.hl, 16, 5);
      return;
    }
    if (type === 'missed') {
      if (G.isJudge() && !missedIds.has(d.id)) { missedIds.add(d.id); M.th--; }
      if (r && r.down && p.downId === d.id) {
        const qz = G.rs(P(from)).z;
        respawn(r, G.track, Math.max(r.z, qz - 8));
        p.downId = 0;
        v && v.pop('−1 team heart', 'bad');
      }
    }
  }

  function freeLaneNear(l, z) {
    for (const c of [l + 1, l - 1, l]) if (c >= -1 && c <= 1 && clearSpot(G.track, c, z)) return c;
    return Math.max(-1, Math.min(1, l));
  }

  // ── sim events from local runners ──
  function onEvent(p, t, val) {
    const r = p.r;
    const v = G.view(p.w);
    if (t === E_PICK && Math.floor(val / 100000) === I_BOX) {
      if (M.mode !== 'race') return;
      if (!p.weapon && p.weaponRoll <= 0) { p.weapon = rollWeapon(p); p.weaponRoll = 0.6; G.audio.play('box'); }
      else { r.coins += 5; v && v.pop('+5', 'hl'); }
      return;
    }
    if (t === E_CRASH) {
      if (M.mode === 'tandem') {
        const id = seq++;
        p.downId = id; p.downAt = G.now();
        G.send(other(p.w), 'down', { id, z: r.z });
      } else if (r.out) {
        G.send(other(p.w), 'out', { rt: r.t });
        if (G.isJudge()) M.myOut = r.t;
      }
      return;
    }
    if (t === E_FINISH) {
      G.send(other(p.w), 'fin', { rt: r.fin });
      v && v.pop('FINISH!', 'hl');
      G.audio.play('finish');
      return;
    }
    if (t === E_TOKEN && p.revive) {
      const rv = p.revive;
      p.revive = null;
      for (const tk of r.tokens) tk.alive = 0;
      r.tokens.length = 0;
      p.stats.revives++;
      countRevive(rv.id);
      G.send(rv.from, 'revive', { id: rv.id, z: r.z, l: r.lane });
      v && v.pop(`Revived ${G.name(rv.from)}!`, 'good');
      G.audio.play('revive');
      return;
    }
    if (t === E_BLOCK) {
      const id = Math.floor(val / 10);
      const o = r.extra.find((x) => x.id === id);
      if (o && o.atk) { G.send(o.from, 'res', { id: o.atk, k: 'block', r: val % 10 ? 'blocked' : 'hit' }); o.atk = 0; }
      v && v.pop(val % 10 ? 'Blocked!' : 'Roadblocked!', val % 10 ? 'hl' : 'bad');
    }
  }

  // ── per frame ──
  function tick(now, dt) {
    for (const w of ['a', 'b']) {
      const p = P(w);
      if (p.shoveCD > 0) p.shoveCD -= dt;
      if (p.weaponRoll > 0) p.weaponRoll -= dt;
      p.pushOff *= Math.exp(-dt * 6);
      const r = p.r;
      if (!r || M.phase !== 'run') continue;
      const q = P(other(w));
      const qs = G.rs(q);
      const gap = qs.z - r.z;
      // rubber bands
      if (M.mode === 'brawl') r.catchup = Math.max(-0.18, Math.min(0.32, gap * 0.012));
      else if (M.mode === 'tandem') r.catchup = qs.down ? 0 : Math.max(-0.12, Math.min(0.2, gap * 0.008));
      else {
        r.catchup = 0;
        const drafting = gap > 2.5 && gap < 14 && Math.abs(qs.x - r.x) < 1.1 && !qs.down && r.grounded;
        r.draft = drafting ? 0.05 : 0;
      }
      // roadblocks passed without a hit
      for (const o of r.extra) {
        if (o.t === O_BLOCK && o.atk && !o.hit && o.z1 < r.z - 3) { G.send(o.from, 'res', { id: o.atk, k: 'block', r: 'dodged' }); o.atk = 0; o.gone = 1; }
      }
      if (r.extra.length > 6) r.extra = r.extra.filter((o) => o.z1 > r.z - 20);
      // revive tokens for my downed partner
      if (p.revive) {
        const rv = p.revive;
        if (now > rv.until) {
          p.revive = null;
          for (const tk of r.tokens) tk.alive = 0;
          r.tokens.length = 0;
          G.send(rv.from, 'missed', { id: rv.id });
          if (G.isJudge() && !missedIds.has(rv.id)) { missedIds.add(rv.id); M.th--; }
          G.view(w) && G.view(w).pop('Too late', 'bad', '−1 team heart');
        } else if (!r.down && now >= rv.next) {
          rv.next = now + 3000;
          rv.n++;
          const z = r.z + Math.max(24, r.speed * 1.5);
          let lane = r.lane;
          if (!clearSpot(G.track, lane, z)) {
            const c = G.track.chunk(Math.floor(z / CHUNK));
            lane = pathLane(c, z);
            for (const l of [lane, -1, 0, 1]) if (clearSpot(G.track, l, z)) { lane = l; break; }
          }
          for (const tk of r.tokens) tk.alive = 0;
          r.tokens.length = 0;
          r.tokens.push({ id: rv.id * 10 + rv.n, x: lane * LANE_W, z, y: 1.2, alive: 1 });
        }
      }
      // tandem: my own down timer fallback (partner vanished)
      if (M.mode === 'tandem' && r.down && p.downId && now > p.downAt + REVIVE_WINDOW + 2500) {
        respawn(r, G.track, Math.max(r.z, qs.z - 8));
        if (G.isJudge() && !missedIds.has(p.downId)) { missedIds.add(p.downId); M.th--; }
        p.downId = 0;
      }
    }
    // tandem: team coin goals (judge)
    if (M.mode === 'tandem' && G.isJudge() && M.phase === 'run') {
      const coins = G.coins('a') + G.coins('b');
      if (coins >= M.goal) {
        M.th = Math.min(TEAM_HEARTS_MAX, M.th + 1);
        M.goalIdx = Math.min(GOALS.length - 1, M.goalIdx + 1);
        M.goal = M.goalIdx < GOALS.length - 1 || coins < GOALS[GOALS.length - 1] ? GOALS[M.goalIdx] : M.goal + 600;
        G.teamGoalReached();
      }
    }
  }

  /** The judge (host, or the one device) decides the end. Returns a result or null. */
  function verdict() {
    if (!G.isJudge() || M.phase !== 'run') return null;
    const A = G.judgeView('a'); const B = G.judgeView('b');
    if (!A || !B) return null;
    const nm = { a: G.name('a'), b: G.name('b') };
    const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    if (M.mode === 'race') {
      let w = null; let why = '';
      if (A.out >= 0 && B.out < 0) { w = 'b'; why = `${nm.a} ran out of hearts`; }
      else if (B.out >= 0 && A.out < 0) { w = 'a'; why = `${nm.b} ran out of hearts`; }
      else if (A.out >= 0 && B.out >= 0) { w = A.out > B.out ? 'a' : 'b'; why = 'both ran out of hearts'; }
      else if (A.fin >= 0 && B.fin >= 0) { w = A.fin <= B.fin ? 'a' : 'b'; }
      else if (A.fin >= 0 && B.rt > A.fin + 0.03) w = 'a';
      else if (B.fin >= 0 && A.rt > B.fin + 0.03) w = 'b';
      if (!w) return null;
      const W = w === 'a' ? A : B; const Lp = w === 'a' ? B : A;
      const sub = why || `${(M.len / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} km in ${fmtT(W.fin)} · ${Lp.fin >= 0 ? `${fmtT(Lp.fin)} for ${nm[w === 'a' ? 'b' : 'a']}` : `${Math.max(0, Math.round(M.len - Lp.z))} m short`}`;
      return { winner: w, text: `${nm[w]} wins the race`, sub };
    }
    if (M.mode === 'brawl') {
      let w = null; let sub = '';
      if (A.out >= 0 && B.out < 0) w = 'b';
      else if (B.out >= 0 && A.out < 0) w = 'a';
      else if (A.out >= 0 && B.out >= 0) w = A.out > B.out ? 'a' : 'b';
      if (w) sub = `${nm[w === 'a' ? 'b' : 'a']} ran out of hearts · ${G.players[w].stats.shoves || A.shoves || 0} shoves`;
      else if (A.z >= M.cap || B.z >= M.cap) {
        if (A.h !== B.h) w = A.h > B.h ? 'a' : 'b';
        else if (A.shoves !== B.shoves) w = A.shoves > B.shoves ? 'a' : 'b';
        else w = A.z >= B.z ? 'a' : 'b';
        sub = `${(M.cap / 1000).toFixed(0)} km tiebreak · ${A.h}–${B.h} hearts`;
      }
      if (!w) return null;
      return { winner: w, text: `${nm[w]} wins the brawl`, sub };
    }
    if (M.mode === 'tandem') {
      if (M.th > 0) return null;
      const meters = Math.round((A.z + B.z) / 2);
      const coins = A.c + B.c;
      const score = meters + coins;
      return { winner: null, team: true, score, text: `Team score ${score.toLocaleString('en-US')}`, sub: `${meters.toLocaleString('en-US')} m together · ${coins} coins · ${M.revives} revive${M.revives === 1 ? '' : 's'}` };
    }
    return null;
  }

  return { init, use, onLane, msg, onEvent, tick, verdict, rollWeapon, cap: BRAWL_CAP };
}
