// Rail Rush: generator determinism + passability, feel numbers, synchronized live start, a full
// live Race with UI inputs and weapons, Brawl shove, Tandem revive, disconnect / visibility /
// GL-context pauses, one-computer split screen, leaks, packet loss, steady-state allocations and
// heap growth, seamlessness (late lobby, partner / host re-mounts mid-race, 30 s in the
// background, a much slower partner), and screenshots in light and dark.
//   node tools/test/games/rush.test.js            (ONLY=gen,race,... to run some sections)
// Sections: gen race brawl tandem pause daily rival | split leak | drop | dark | heap | seam | rejoin | loop. Ports 8960-8969.
// `loop` (two phones + one computer): the Daily's twist of the day (Mirror flips the canvas not the HUD and swaps left / right, Double
// ladder, Fog, Blind coins, Night, Gold rush: same on both phones, restored in the lobby), three dares a day with checks and weekly
// stamps, the love-note input (44 px chip, 16 px, keys reach it, 60 chars, text only) and note pickup, and the new unlocks.
// (the author runs two halves: ONLY=gen,split,leak,drop,dark and ONLY=race,brawl,tandem,pause,daily,rival)
const fs = require('fs');
const { launch } = require('../harness');

const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-Couple-game/0bac2931-fb3f-54c3-8279-c15850ed70e8/scratchpad/rush-polish/test';
fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
// RUSH_PORT=8885 packs every launch into 8885–8887 (they run one after another), so parallel runs can share a machine
const PORT = (k) => (process.env.RUSH_PORT ? +process.env.RUSH_PORT + (k % 3) : 8960 + k);
let fails = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const soft = (c, m) => { if (!c) { fails++; console.log('not ok -', m); } else console.log('ok -', m); };
const DEBUG = { raceLen: 990, noTutorial: true, awayMs: 3000 }; // (awayMs: the "End match" offer after a partner has been gone 3 s instead of 20) // long enough that a loaded machine finishes the race steps before the line (< 1 km: that's an unlock)

const S = (pg) => pg.evaluate(() => window.__rush && window.__rush.state());
const until = async (pg, fn, arg, ms = 15000, what = 'condition') => {
  try { await pg.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); } catch {
    const st = await pg.evaluate(() => { const s = window.__rush && window.__rush.state(); return s && { phase: s.phase, paused: s.paused, reasons: s.reasons, partnerPz: s.partnerPz, rtt: s.rtt, a: { z: s.a.z, lane: s.a.lane, down: s.a.down }, b: { z: s.b.z, lane: s.b.lane, down: s.b.down } }; }).catch(() => null);
    throw new Error('FAIL: timed out waiting for ' + what + ' ' + JSON.stringify(st));
  }
};
// WCAG contrast of the revive prompt (the pill under the bar turns red for the reviver) in the page's theme
const hotGapContrast = (pg) => pg.evaluate(() => {
  const v = window.__rush.internals.players[window.__rush.state().me || 'a'].view;
  v.gap('Grab the ♥ for Sydney · 5', true);
  const sp = document.querySelector('.g-rush .rr-gap.hot span');
  const rgb = (c) => { const m = c.match(/[\d.]+/g).map(Number); return m.slice(0, 3); };
  const lum = (c) => { const [r, g, b] = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const cs = getComputedStyle(sp); const f = lum(rgb(cs.color)); const bg = lum(rgb(cs.backgroundColor));
  v.gap('', false);
  return (Math.max(f, bg) + 0.05) / (Math.min(f, bg) + 0.05);
});
const shot = (pg, name) => pg.screenshot({ path: `${SHOTS}/${name}.png` });

// Feedback spy (install after each mount): counts crash sounds, music ducks, CRASH!/FELL!/SLAMMED! pops
// and combo-ladder updates on one page, against its local runners' real crashes. A combo payout once
// fell through into the crash case, so every x3/x5/x8 sounded, shook and froze like a crash.
const spyFeedback = (pg) => pg.evaluate(() => {
  const I = window.__rush.internals;
  const f = window.__fb = { play: {}, duck: 0, pops: [], ladder: [], c0: {} };
  for (const w of ['a', 'b']) { const r = I.players[w].r; if (r && I.players[w].view) f.c0[w] = r.crashes; }
  const au = I.audio;
  if (!au.__spy) {
    const p0 = au.play; const d0 = au.duck;
    au.play = function (n, x) { window.__fb.play[n] = (window.__fb.play[n] || 0) + 1; return p0.call(this, n, x); };
    au.duck = function (ms) { window.__fb.duck++; return d0.call(this, ms); };
    au.__spy = 1;
  }
  for (const w of ['a', 'b']) {
    const v = I.players[w].view;
    if (!v || v.__spy) continue;
    const pop0 = v.pop; const combo0 = v.combo;
    v.pop = function (t, c, s) { window.__fb.pops.push(`${w}:${t}`); return pop0.call(this, t, c, s); };
    v.combo = function (n, label, tier) { window.__fb.ladder.push(`${w}:x${n} ${label}`); return combo0.call(this, n, label, tier); };
    v.__spy = 1;
  }
});
const feedback = (pg) => pg.evaluate(() => {
  const I = window.__rush.internals; const f = window.__fb;
  let crashes = 0;
  for (const w in f.c0) crashes += I.players[w].r.crashes - f.c0[w];
  return {
    crashes, crashSounds: f.play.crash || 0, ducks: f.duck, bonus: f.play.bonus || 0,
    crashPops: f.pops.filter((p) => /:(CRASH|FELL|SLAMMED)!$/.test(p)).length, ladder: f.ladder.slice(-4),
  };
});
const checkFeedback = async (pg, what) => {
  const f = await feedback(pg);
  assert(f.crashSounds === f.crashes && f.crashPops === f.crashes && f.ducks === f.crashes,
    `${what}: crash sound, music duck and CRASH! pop only on real crashes (${f.crashes} crashes; ${f.crashSounds} sounds, ${f.ducks} ducks, ${f.crashPops} pops; ${f.bonus} combo payouts)`);
  return f;
};

// Mode rules, headless (no browser): modes.js + sim/track/tune copied into a scratch ESM package
// with core's hash/rng, two local runners, messages delivered in order with a fake shared clock.
async function rulesUnit() {
  const path = require('path');
  const { pathToFileURL } = require('url');
  const PKG = path.join(SHOTS, '..', 'rules-pkg');
  const SRC = path.join(__dirname, '..', '..', '..', 'js', 'games');
  fs.mkdirSync(path.join(PKG, 'rush'), { recursive: true });
  fs.writeFileSync(path.join(PKG, 'package.json'), '{"type":"module"}');
  const core = fs.readFileSync(path.join(SRC, 'core.js'), 'utf8');
  fs.writeFileSync(path.join(PKG, 'core.js'), core.match(/export function hash[\s\S]*?\n}\n[\s\S]*?export function rng[\s\S]*?\n}\n/)[0]);
  for (const f of ['tune.js', 'track.js', 'sim.js', 'modes.js', 'audio.js', 'link.js']) fs.writeFileSync(path.join(PKG, 'rush', f), fs.readFileSync(path.join(SRC, 'rush', f), 'utf8'));
  fs.writeFileSync(path.join(PKG, 'net.js'), fs.readFileSync(path.join(SRC, 'net.js'), 'utf8'));
  const imp = (f) => import(pathToFileURL(path.join(PKG, 'rush', f)).href);
  const [U, T, Sm, Md, Au, Lk] = await Promise.all([imp('tune.js'), imp('track.js'), imp('sim.js'), imp('modes.js'), imp('audio.js'), imp('link.js')]);
  function world(mode, local = null) {
    let now = 100000;
    const q = [];
    const sent = [];
    const sentData = [];
    const pops = { a: [], b: [] };
    const M = { mode, phase: 'run' };
    const track = T.createTrack(7);
    const players = {};
    for (const w of ['a', 'b']) {
      const r = Sm.newRunner(w === 'a' ? -1 : 1); r.z = r.zPrev = 300; r.speed = 15;
      players[w] = { w, r, local: local ? w === local : undefined, rs: { x: r.x, z: r.z, y: 0, ground: 0, down: false, invuln: false, visible: true }, stats: {} };
    }
    const sync = () => { for (const w of ['a', 'b']) { const p = players[w]; p.rs.x = p.r.x; p.rs.z = p.r.z; p.rs.y = p.r.y; p.rs.down = !!p.r.down; p.rs.invuln = p.r.invulnT > 0; } };
    const noop = () => {};
    const G = {
      M, players, track, now: () => now, rs: (p) => p.rs, view: (w) => ({ pop: (t) => pops[w].push(t), flash: noop }), name: (w) => w.toUpperCase(),
      pal: { a: 0, b: 0, hl: 0 }, fx: { burst: noop }, audio: { play: noop }, isJudge: () => true, kick: noop, shake: noop,
      send(to, type, data) { sent.push(type); sentData.push([type, data]); q.push([type, data, now, to === 'a' ? 'b' : 'a']); },
      history: (w) => { const r = players[w].r; return { z: r.z, x: r.x, lane: r.lane, y: r.y, g: Math.max(0, r.sup) }; },
      remoteAt: () => null, coins: (w) => players[w].r.coins, teamGoalReached: noop, splat: noop, projectile: noop,
    };
    const rules = Md.createRules(G);
    rules.init();
    const tick = (sec, beforeStep) => {
      for (let i = 0; i < Math.round(sec / U.DT); i++) {
        now += U.DT * 1000;
        if (beforeStep) beforeStep();
        for (const w of ['a', 'b']) { const r = players[w].r; Sm.step(r, track, false); for (let e = 0; e < r.evN; e++) rules.onEvent(players[w], r.evT[e], r.evV[e]); r.evN = 0; }
        sync();
        while (q.length) { const [type, data, at, from] = q.shift(); rules.msg(type, data, at, from); }
        if (i % 2 === 0) rules.tick(now, U.DT * 2);
      }
    };
    // the run is paused for `sec`: the shared clock moves on, rules.hold() gets the time instead of tick()
    const pause = (sec, hold = true) => { now += sec * 1000; if (hold) rules.hold(sec * 1000); };
    sync();
    return { G, M, players, rules, tick, pause, sent, sentData, pops, invuln: () => { for (const w of ['a', 'b']) players[w].r.invulnT = 1e9; } };
  }
  const out = {};
  // Brawl: a plain dodge into the partner's lane is not a shove; a beat side by side, or a double swipe, is
  {
    const W = world('brawl');
    const a = W.players.a; const b = W.players.b;
    W.invuln(); b.r.invulnT = 0; // b must be shovable (invulnerable runners can't be)
    Sm.act(a.r, Sm.A_RIGHT); W.tick(0.2, () => { a.r.invulnT = 1e9; }); // a: lane 0, adjacent to b (lane 1) for 0.2 s
    const n0 = W.sent.filter((x) => x === 'shove').length;
    W.players.a.sideT = 0; // just arrived beside b
    W.rules.onLane(a, 1); // into b's lane at once: a dodge, not a shove
    out.plain = W.sent.filter((x) => x === 'shove').length - n0;
    W.tick(0.4);
    W.rules.onLane(a, 1); // after 0.4 s side by side: a shove
    out.beat = W.sent.filter((x) => x === 'shove').length - n0;
    const W2 = world('brawl');
    W2.players.a.sideT = 0; W2.rules.onLane(W2.players.a, 1); W2.players.a.r.lane = 0; // first swipe (a: -1 → 0)
    W2.tick(0.1);
    W2.players.a.sideT = 0; W2.rules.onLane(W2.players.a, 1); // second swipe toward b within 250 ms
    out.double = W2.sent.filter((x) => x === 'shove').length;
    W2.tick(0.5);
    out.doubleRes = W2.pops.b.slice(-1)[0] || '';
  }
  // Together: both down at once resolves straight away for one team heart; a cheer lifts the partner
  {
    const W = world('tandem');
    const a = W.players.a; const b = W.players.b;
    W.invuln(); a.r.invulnT = 0; b.r.invulnT = 0;
    const th0 = W.M.th;
    Sm.crash(a.r, Sm.C_FORCED, false); W.rules.onEvent(a, Sm.E_CRASH, 0);
    W.tick(0.3, () => { a.r.invulnT = 0; });
    out.cheer = W.rules.cheer(a);
    W.tick(0.05);
    out.cheerLift = +(b.r.catchup).toFixed(3);
    Sm.crash(b.r, Sm.C_FORCED, false); W.rules.onEvent(b, Sm.E_CRASH, 0);
    let t = 0;
    while ((a.r.down || b.r.down) && t < 10) { W.tick(0.1); t += 0.1; }
    out.ddSec = +t.toFixed(1);
    out.ddLost = th0 - W.M.th;
    out.ddInvuln = a.r.invulnT > 0 && b.r.invulnT > 0;
    out.ddSide = [a.r.lane, b.r.lane];
    W.invuln(); // (no inputs in this harness: keep them off the obstacles while we wait)
    W.tick(9);
    out.ddLostLater = th0 - W.M.th;
    // a single down: the partner gets a revive heart after 1 s
    W.invuln(); a.r.invulnT = 0;
    Sm.crash(a.r, Sm.C_FORCED, false); W.rules.onEvent(a, Sm.E_CRASH, 0);
    W.tick(0.5); out.tok05 = b.r.tokens.filter((x) => x.alive).length;
    W.tick(0.7); out.tok12 = b.r.tokens.filter((x) => x.alive).length;
  }
  // Pause: revive windows (and the team hearts they cost) wait while the run is paused; without hold() a long pause burns them
  {
    const run = (hold) => {
      const W = world('tandem');
      const a = W.players.a; const b = W.players.b;
      W.invuln(); a.r.invulnT = 0;
      const th0 = W.M.th;
      Sm.crash(a.r, Sm.C_FORCED, false); W.rules.onEvent(a, Sm.E_CRASH, 0);
      W.tick(1.2);
      const open = !!b.revive;
      W.pause(20, hold); // the app goes to the background for 20 s (a window is 7 s)
      W.invuln();
      W.tick(0.2);
      return { open, still: !!b.revive, lost: th0 - W.M.th };
    };
    out.pauseHeld = run(true); out.pauseBurnt = run(false);
    // a Brawl brace window shifts with the pause too
    const W = world('brawl');
    W.players.a.incoming = { d: { to: 1 }, from: 'b', until: 5000 };
    W.pause(3, true);
    out.braceUntil = W.players.a.incoming.until;
  }
  // ids minted on the two devices never collide (the judge keeps one set of down ids for both)
  {
    const ids = { a: new Set(), b: new Set() };
    for (const w of ['a', 'b']) for (let k = 0; k < 40; k++) {
      const W = world('tandem', w); // a device whose local runner is `w`
      const r = W.players[w].r; r.invulnT = 0;
      Sm.crash(r, Sm.C_FORCED, false); W.rules.onEvent(W.players[w], Sm.E_CRASH, 0);
      for (const [t, d] of W.sentData) if (t === 'down') ids[w].add(d.id);
    }
    out.idParity = [[...ids.a].every((x) => x % 2 === 0), [...ids.b].every((x) => x % 2 === 1), ids.a.size > 0 && ids.b.size > 0];
  }
  // the full-width broken-bridge gap: walking in without jumping is a fall (it used to be a harmless dip)
  {
    out.gap = [];
    for (const seed of [2, 3, 4, 5, 6, 8]) {
      const tr = T.createTrack(seed); let g = null;
      for (let ci = 0; ci < 40 && !g; ci++) for (const x of tr.chunk(ci).gaps) if (x.mask === 7) { g = x; break; }
      if (!g) continue;
      for (const [t0, jump] of [[10, 0], [60, 0], [160, 0], [60, 1]]) {
        const r = Sm.newRunner(0); r.hearts = 99; r.z = r.zPrev = g.z0 - 30; r.t = t0; r.speed = U.baseSpeed(t0);
        for (let k = 0; k < 600 && !r.down; k++) { if (jump && g.z0 - (r.z + 0.35) < U.baseSpeed(t0) * 0.2 && !r.jumps) Sm.act(r, Sm.A_UP); Sm.step(r, tr, false); r.evN = 0; if (r.z > g.z1 + 4) break; }
        out.gap.push({ seed, t0, jump, fell: r.down && r.cause === Sm.C_FALL ? 1 : 0, hit: r.down && r.cause !== Sm.C_FALL ? 1 : 0, past: r.z > g.z1 });
      }
    }
  }
  // pickup events keep their kind and slot past chunk 100 (the old kind * 100000 + slot overflowed there)
  {
    const tr = T.createTrack(3); let o = null;
    for (let ci = 100; ci < 160 && !o; ci++) { const c = tr.chunk(ci); const i = c.items.findIndex((x) => x.k >= 1); if (i >= 0) o = { ci, i, it: c.items[i] }; }
    const r = Sm.newRunner(Math.round(o.it.x / U.LANE_W)); r.invulnT = 1e9; r.z = r.zPrev = o.it.z - 1.5; r.speed = 15; r.t = 50;
    let val = null;
    for (let k = 0; k < 400 && val === null; k++) { Sm.step(r, tr, false); for (let e = 0; e < r.evN; e++) if (r.evT[e] === Sm.E_PICK) val = r.evV[e]; r.evN = 0; }
    out.pick = val === null ? null : { kind: Math.floor(val / 1000000) === o.it.k, slot: val % 1000000 === o.ci * 1000 + 500 + o.i, chunk: o.ci, k: o.it.k };
  }
  // audio: destroying leaves nothing running on the app's shared context (wind loop, magnet hoover)
  {
    const live = new Set(); let closed = 0;
    const node = (kind) => {
      const o = { kind, connect(n) { return n; }, disconnect() {}, start() { live.add(o); }, stop() { live.delete(o); }, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} };
      return new Proxy(o, { get: (t, k) => (k in t ? t[k] : (t[k] = { value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} })), set: (t, k, v) => { t[k] = v; return true; } });
    };
    const ctx = { state: 'running', sampleRate: 8000, currentTime: 0, destination: {}, resume: () => Promise.resolve(), close() { closed++; },
      createDynamicsCompressor: () => node('comp'), createGain: () => node('gain'), createBuffer: () => ({ getChannelData: () => new Float32Array(8) }), createBufferSource: () => node('src'),
      createBiquadFilter: () => node('filter'), createOscillator: () => node('osc') };
    const au = Au.createAudio({ getCtx: () => ctx, mutedFn: () => false });
    au.unlock(); au.setWind(1); au.setMagnet(1);
    out.audioBefore = live.size;
    au.destroy();
    out.audioAfter = live.size; out.audioClosed = closed;
  }
  // link: an ack that comes from an earlier instance of the partner must not delete the new instance's message
  {
    const handlers = {};
    const api = { isHost: true, mode: 'live', me: 'a', on: (t, fn) => { (handlers[t] = handlers[t] || new Set()).add(fn); return () => handlers[t].delete(fn); }, send() {}, onPartnerState: () => () => {}, setPresence() {}, partnerState: () => null };
    const L = Lk.createLink(api);
    const fire = (t, d) => handlers[t] && handlers[t].forEach((fn) => fn(d));
    fire('rr', { f: 'oldB', t: '', s: 1, ty: 'x', d: 1, at: 0 }); // the first partner instance says hello
    fire('rr', { f: 'newB', t: '', s: 1, ty: 'x', d: 1, at: 0 }); // it re-mounted: a new instance
    L.send('hello', {});
    const p0 = L.pending();
    fire('ra', { f: 'oldB', t: L.iid, s: 1 });
    const p1 = L.pending();
    fire('ra', { f: 'newB', t: L.iid, s: 1 });
    out.ack = [p0, p1, L.pending()];
    L.destroy();
  }
  return out;
}


// Rivalry logic, headless (no browser): rivalry.js + tune/track copied into a scratch ESM package and driven
// with fake runners, a fake clock and spies for pops and sounds.
async function rivalUnit() {
  const path = require('path');
  const { pathToFileURL } = require('url');
  const PKG = path.join(SHOTS, '..', 'rival-pkg');
  const SRC = path.join(__dirname, '..', '..', '..', 'js', 'games');
  fs.mkdirSync(path.join(PKG, 'rush'), { recursive: true });
  fs.writeFileSync(path.join(PKG, 'package.json'), '{"type":"module"}');
  const core = fs.readFileSync(path.join(SRC, 'core.js'), 'utf8');
  fs.writeFileSync(path.join(PKG, 'core.js'), core.match(/export function hash[\s\S]*?\n}\n[\s\S]*?export function rng[\s\S]*?\n}\n/)[0]);
  for (const f of ['tune.js', 'track.js', 'rivalry.js']) fs.writeFileSync(path.join(PKG, 'rush', f), fs.readFileSync(path.join(SRC, 'rush', f), 'utf8'));
  const imp = (f) => import(pathToFileURL(path.join(PKG, 'rush', f)).href);
  const [Rv, T] = await Promise.all([imp('rivalry.js'), imp('track.js')]);
  const out = {};
  const mk = (mode, opt = {}) => {
    const log = { a: [], b: [] }; const snd = [];
    const M = { mode, phase: 'run', seed: 7, track: opt.track || null, steps: 999 };
    const players = {};
    for (const w of ['a', 'b']) {
      players[w] = { w, name: w === 'a' ? 'Emerson' : 'Sydney', local: true, stats: {}, r: { hearts: 3, coins: 0, bonus: 0, speed: 20, down: 0, out: 0, done: 0, z: 0, magnetT: 0, sneakersT: 0, dblT: 0 },
        rs: { z: 0, down: false, idle: false, visible: true }, view: { pop: (t, c, sb) => log[w].push([t, c, sb]) } };
    }
    const data = Object.assign({}, opt.data || {}); const sent = [];
    let now = 1000;
    const X = { M, players, viewers: opt.viewers || ['a', 'b'], other: (w) => (w === 'a' ? 'b' : 'a'), audio: { play: (n) => snd.push(n), setDistrict: (i) => snd.push('key' + i) },
      now: () => now, send: (to, t, d) => sent.push([to, t, d]), data: () => data, setData: (p) => Object.assign(data, p), haptic() {}, fmtM: (m) => Math.round(m).toLocaleString('en-US'),
      zOf: (w) => players[w].rs.z, bestKey: (w) => `${w}_race_m` };
    const rv = Rv.createRivalry(X);
    rv.reset();
    // advance sec seconds at 60 Hz; z(w) sets each runner's distance every tick
    const run = (sec, f) => { for (let i = 0; i < Math.round(sec * 60); i++) { now += 1000 / 60; if (f) f(i); for (const w of ['a', 'b']) players[w].r.z = players[w].rs.z; rv.tick(1 / 60); } };
    const set = (a, b) => { players.a.rs.z = a; players.b.rs.z = b; };
    return { rv, M, players, log, snd, data, sent, run, set, X, tm: () => now };
  };
  // hysteresis: a lead of 4 m+ held 0.6 s is a change; a shorter one is nothing
  {
    const W = mk('race');
    W.set(100, 90); W.run(1.2); // a leads (silently)
    W.set(100, 110); W.run(0.4); W.set(100, 90); W.run(1.5); // b ahead for 0.4 s: a flicker
    out.flick = W.log.a.length + W.log.b.length;
    W.set(100, 110); W.run(0.5); out.early = W.log.a.length; W.run(0.3); // 0.5 s: not yet; 0.8 s: yes
    out.pass = [W.log.a.map((x) => x[0]), W.log.b.map((x) => x[0]), W.rv.changes];
    // retaking at once: held through the 3 s quiet, then REVENGE! (they passed me within 10 s)
    W.set(100, 90); W.run(1.0); out.quiet = W.log.a.length; W.run(2.5);
    out.revenge = [W.log.a.map((x) => x[0]).slice(-1)[0], W.log.b.map((x) => x[0]).slice(-1)[0], W.rv.changes];
    // a lead change 15 s later is OVERTAKE!, not REVENGE!
    W.set(100, 110); W.run(12); W.set(100, 90); W.run(4); out.late = W.log.a.map((x) => x[0]).slice(-1)[0];
    out.m = W.M.leadChanges;
  }
  // Brawl and Together: no rivalry pops; a downed runner passed is not a pass
  {
    const W = mk('brawl'); W.set(100, 90); W.run(1.2); W.set(100, 140); W.run(5);
    out.brawl = W.log.a.length + W.log.b.length + W.rv.changes;
    const D = mk('race'); D.set(100, 90); D.run(1.2); D.players.a.r.down = 1; D.set(100, 140); D.run(3); D.players.a.r.down = 0; D.run(3);
    out.downed = D.log.a.length + D.rv.changes;
  }
  // neck and neck: < 5 m for 3 s, off at 8 m
  {
    const W = mk('race'); W.set(100, 102); W.run(4.5); const start = W.rv.neck('a'); W.set(300, 302); W.run(2.5); const early = W.rv.neck('a'); W.run(0.8); const on = W.rv.neck('a');
    W.set(300, 306); W.run(1); const hold = W.rv.neck('a'); W.set(300, 309); W.run(0.2); const off = W.rv.neck('a');
    out.neck = [start, early, on, hold, off, W.log.a.length];
  }
  // the best stripes: mine 150, theirs 260 (a); crossing pops once each, both phones
  {
    const W = mk('race', { data: { a_race_m: 150, b_race_m: 260 } });
    W.set(140, 140); W.run(1.2); W.set(155, 150); W.run(0.1); W.run(1.3); // a crosses 150 (NEW BEST!), b is just short
    W.set(160, 155); W.run(0.1);
    W.set(255, 240); W.run(0.1); W.set(265, 262); W.run(1.5);
    out.stripes = [W.log.a.map((x) => x[0]), W.log.b.map((x) => x[0])];
    out.stripeSub = W.log.a.find((x) => /just beat/.test(x[0])) || null;
    out.beatBest = [W.players.a.stats.beatBest, W.players.b.stats.beatBest, W.players.a.stats.crossed];
    const V = mk('race', { data: { a_race_m: 150, b_race_m: 260 } });
    V.set(30, 30); V.run(1.2); V.set(200, 200); V.run(2); // a 170 m teleport: not a crossing
    out.teleport = V.log.a.length + V.log.b.length;
  }
  // districts: a tag pop on entering a zone start, once; the music key follows
  {
    const W = mk('race');
    W.set(290, 0); W.run(1.2); W.set(301, 0); W.run(0.2); W.set(298, 0); W.run(0.2); W.set(302, 0); W.run(0.2);
    const names = W.log.a.filter((x) => x[1] === 'tag').map((x) => x[0]);
    out.district = [names, W.snd.filter((x) => /^key/.test(x)).length >= 1, W.snd.filter((x) => x === 'district').length];
    out.districtName = names[0] === T.DISTRICTS[T.districtAt(7, 301)].name;
  }
  // events: Coin Rush 2 s ahead of its field, Golden Hundred on entering its chunk; both once
  {
    const chunks = {};
    for (let i = 0; i < 12; i++) chunks[i] = { i, z0: i * 100, event: i === 5 ? 1 : i === 8 ? 2 : 0, eventZ: i === 5 ? 530 : 800 };
    const W = mk('race', { track: { ver: 2, chunk: (i) => chunks[i] || { i, z0: i * 100, event: 0, eventZ: 0 } } });
    W.set(400, 0); W.run(1.2); W.set(450, 0); W.run(0.2); W.set(493, 0); W.run(1.5); W.set(500, 0); W.run(1); // 530 - 2 s * 20 m/s = 490
    W.set(790, 0); W.run(0.2); W.set(805, 0); W.run(1.5); W.set(850, 0); W.run(1.5);
    out.events = W.log.a.map((x) => x[0]);
    const V = mk('race', { track: { ver: 1, chunk: () => ({ i: 0, z0: 0 }) } });
    V.set(500, 0); V.run(2); out.ver1 = V.log.a.length;
  }
  // the last heart: CLUTCH! after 500 m, once per heart lost; never in Together
  {
    const W = mk('daily');
    W.players.a.r.hearts = 1; W.set(10, 0); W.run(1.2);
    W.set(300, 0); W.run(0.1); const early = W.log.a.length; W.set(520, 0); W.run(0.2);
    W.set(900, 0); W.run(1.5); const once = W.log.a.filter((x) => x[0] === 'CLUTCH!').length;
    W.players.a.r.hearts = 2; W.run(0.1); W.players.a.r.hearts = 1; W.set(1000, 0); W.run(0.2); W.set(1520, 0); W.run(0.2);
    out.clutch = [early, once, W.log.a.filter((x) => x[0] === 'CLUTCH!').length, W.players.a.r.coins, W.players.a.stats.clutch, W.rv.low('a')];
    const T2 = mk('tandem'); T2.players.a.r.hearts = 1; T2.set(10, 0); T2.run(1.2); T2.set(700, 0); T2.run(1);
    out.clutchTandem = [T2.log.a.length, T2.rv.low('a')];
  }
  // pops take turns: three at once come one after another, in order
  {
    const W = mk('race', { data: { a_race_m: 50, b_race_m: 60 } });
    W.data.a_race_m = 100; W.data.b_race_m = 200; W.rv.reset();
    W.set(90, 90); W.run(1.2); W.set(105, 105); W.run(0.1); W.set(195, 195); W.run(0.1); W.set(205, 205); W.run(0.1); // both cross 100 at once, then 200
    const t0 = W.log.a.length;
    W.run(3);
    out.turns = [t0, W.log.a.length];
  }
  // shared power-ups: the same duration less the message time; a shield is not shared
  {
    const W = mk('tandem'); W.run(1.2);
    const sub = W.rv.onPick(W.players.a, T.I_MAGNET);
    out.shareSent = [W.sent.length, W.sent[0] && W.sent[0][0], W.sent[0] && W.sent[0][2].k, sub];
    W.rv.onShare({ k: T.I_MAGNET }, W.tm() - 120, 'a');
    W.rv.onShare({ k: T.I_SNEAKERS }, W.tm(), 'a');
    W.rv.onShare({ k: T.I_DOUBLE }, W.tm(), 'a');
    out.shared = [+W.players.b.r.magnetT.toFixed(2), W.players.b.r.sneakersT, W.players.b.r.dblT, W.log.b.map((x) => x[0])];
    W.rv.onPick(W.players.a, T.I_SHIELD); out.shieldSent = W.sent.length;
    const R = mk('race'); R.rv.onPick(R.players.a, T.I_MAGNET); out.raceSent = R.sent.length;
  }
  // the shared end-card line
  {
    const W = mk('race'); W.set(100, 90); W.run(1.2); W.set(100, 140); W.run(1); W.set(200, 140); W.run(4);
    const res = W.rv.decorate({ winner: 'a', text: 'x', sub: '1.5 km in 1:12' });
    out.lead = [res.sub, res.lc];
    const D = mk('daily'); const rd = D.rv.decorate({ winner: 'a', sub: 'Emerson 1,240 m · Sydney 980 m' }); out.leadNone = rd.sub;
    const T1 = mk('tandem', { data: { team_best_m: 3240 } }); T1.set(2000, 2000);
    const t1 = T1.rv.decorate({ team: true, sub: '2,000 m together · 100 coins' }); out.teamNew = [t1.sub, t1.tbNew || 0, t1.m];
    T1.set(4000, 3000); const t2 = T1.rv.decorate({ team: true, sub: 'x' }); out.teamUp = [t2.sub, t2.tbNew, t2.m];
    T1.rv.finale(t2); out.teamSaved = T1.data.team_best_m; out.teamPop = T1.log.a.map((x) => x[0]);
    const T0 = mk('tandem', { data: {} }); T0.set(500, 500); out.teamFirst = T0.rv.decorate({ team: true, sub: 'y' }).sub;
    const F = mk('race'); out.forfeit = F.rv.decorate({ winner: 'a', sub: 'z', forfeit: 1 }).sub;
  }
  return out;
}

async function swipe(pg, x0, y0, dx, dy) {
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 4; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / 4, y: y0 + (dy * i) / 4 }] });
    await new Promise((r) => setTimeout(r, 12));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Tap the weapon slot once the HUD shows it loaded (an empty slot lets taps through). */
async function fireWeapon(pg) {
  await until(pg, () => !!document.querySelector('.g-rush .rr-weapon.full'), null, 5000, 'weapon slot loaded');
  await pg.click('.g-rush .rr-weapon', { force: true }); // it wobbles while loaded, so skip the stability wait
}

async function openLivePair(h, extra = {}) {
  const { a, b } = h;
  for (const pg of [a, b]) await pg.evaluate((d) => { window.__RUSH_DEBUG = d; }, { ...DEBUG, ...extra });
  await h.startLive(a, 'rush', 'live');
  await h.settle();
  const invited = await b.isVisible('#gm-invite').catch(() => false);
  if (invited) await b.click('#gm-invite [data-g="invite-yes"]');
  else await h.startLive(b, 'rush', 'live'); // invite dropped (packet loss): open it directly
  await until(a, () => window.__rush && window.__rush.state().ready3D, null, 30000, 'host 3D ready');
  await until(b, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().synced, null, 30000, 'guest ready + clock synced');
}

async function pickAndStart(h, mode) {
  const { a, b } = h;
  await until(a, () => !document.querySelector('.g-rush .rr-ov-lobby [data-r="go"]').disabled, null, 15000, 'start enabled');
  await a.click(`.g-rush .rr-mode[data-mode="${mode}"]`);
  await until(b, (m) => window.__rush.state().lobbyMode === m && document.querySelector(`.g-rush .rr-mode[data-mode="${m}"]`).classList.contains('on'), mode, 8000, 'guest sees the mode');
  await a.click('.g-rush .rr-ov-lobby [data-r="go"]');
  await until(a, () => ['countdown', 'run'].includes(window.__rush.state().phase), null, 8000, 'host counting down');
  await until(b, () => ['countdown', 'run'].includes(window.__rush.state().phase), null, 8000, 'guest counting down');
}

async function waitRun(pg) { await until(pg, () => window.__rush.state().phase === 'run' && window.__rush.state().steps > 30, null, 15000, 'running'); }

(async () => {
  // ═══ two phones, live ═══
  if (['gen', 'race', 'brawl', 'tandem', 'pause', 'daily'].some(want)) {
    const h = await launch({ port: PORT(0), only: ['rush'], latency: 80, coarse: true });
    const { a, b } = h;
    try {
      await openLivePair(h);
      if (want('gen')) {
        const ru = await rulesUnit();
        assert(ru.plain === 0 && ru.beat === 1, `Brawl: a plain dodge into the partner's lane is not a shove (${ru.plain}); after a beat side by side it is (${ru.beat})`);
        assert(ru.double === 1 && /SHOVED|SLAMMED/.test(ru.doubleRes), `Brawl: a double swipe toward the partner shoves (${ru.double}, "${ru.doubleRes}" after the 300 ms brace window)`);
        assert(ru.cheer === true && ru.cheerLift >= 0.04, `Together: a tap while down cheers the partner on (+${(ru.cheerLift * 100).toFixed(0)} % speed)`);
        assert(ru.ddSec <= 2.2 && ru.ddLost === 1 && ru.ddLostLater === 1 && ru.ddInvuln && ru.ddSide[0] !== ru.ddSide[1], `Together: both down at once → both back up side by side in ${ru.ddSec} s with invulnerability, one team heart (${ru.ddLost}, still ${ru.ddLostLater} later)`);
        assert(ru.tok05 === 0 && ru.tok12 === 1, `Together: the first revive heart appears 1 s after the partner goes down (${ru.tok05} at 0.5 s, ${ru.tok12} at 1.2 s)`);
        assert(ru.pauseHeld.open && ru.pauseHeld.still && ru.pauseHeld.lost === 0, `Together: a 20 s pause burns no revive window and no team heart (window open ${ru.pauseHeld.still}, hearts lost ${ru.pauseHeld.lost})`);
        assert(ru.pauseBurnt.open && !ru.pauseBurnt.still && ru.pauseBurnt.lost === 1, `(control) the same pause without rules.hold() does burn the window (${ru.pauseBurnt.still}) and a heart (${ru.pauseBurnt.lost})`);
        assert(ru.braceUntil === 8000, `Brawl: a brace window shifts by the paused time (${ru.braceUntil})`);
        assert(ru.idParity.every(Boolean), 'Together: the two devices mint down ids of different parity (a even, b odd), so one judge set can never mix them up');
        assert(ru.gap.length >= 24 && ru.gap.filter((g) => !g.jump).every((g) => g.fell === 1) && ru.gap.filter((g) => g.jump).every((g) => !g.fell && !g.hit && g.past), `a full-width gap is a fall if you don't jump (${ru.gap.filter((g) => !g.jump && g.fell).length}/${ru.gap.filter((g) => !g.jump).length}) and a clean pass if you do`);
        assert(ru.pick && ru.pick.k >= 1 && ru.pick.kind && ru.pick.slot, `pickup events decode past chunk 100 (kind ${ru.pick && ru.pick.k} in chunk ${ru.pick && ru.pick.chunk})`);
        assert(ru.audioBefore >= 2 && ru.audioAfter === 0 && ru.audioClosed === 0, `audio destroy() stops the wind loop and the magnet hoover on a shared context (${ru.audioBefore} running → ${ru.audioAfter}), without closing it`);
        assert(ru.ack[0] === 1 && ru.ack[1] === 1 && ru.ack[2] === 0, `link: a stale ack from the partner's previous instance leaves the new message pending (${ru.ack.join(' → ')})`);
        // feel numbers, measured on the real sim
        const pr = await a.evaluate(() => window.__rush.probe());
        assert(pr.laneMs >= 100 && pr.laneMs <= 150, `lane change completes in ${pr.laneMs.toFixed(0)} ms (snappy: 100–150 ms)`);
        assert(pr.jumpApex > 1.5 && pr.jumpApex < 1.9 && pr.airMs > 550 && pr.airMs < 900, `jump: apex ${pr.jumpApex.toFixed(2)} m, ${pr.airMs.toFixed(0)} ms in the air`);
        assert(pr.softCrashes === 0 && pr.softStumbles === 1, 'a missed warm-up row trips you up instead of knocking you down');
        assert(pr.diff200 <= 0.15 && pr.diff30s <= 0.32 && pr.diff2k >= 0.8, `difficulty is gentle for the first 30 s (${pr.diff200} at 200 m, ${pr.diff30s} at 430 m) and ramps to ${pr.diff2k} at 2 km`);
        const seeds = [1, 42, 1337, 98765, 2024];
        const ha = await a.evaluate((ss) => ss.map((s) => window.__rush.trackHash(s, 40)), seeds);
        const hb = await b.evaluate((ss) => ss.map((s) => window.__rush.trackHash(s, 40)), seeds);
        assert(ha.every((x, i) => x === hb[i]) && new Set(ha).size === seeds.length, `track layouts identical on both devices for ${seeds.length} seeds (40 chunks each)`);
        // fairness: a lane change begun just before a head-on is a clip (stumble), a square hit a crash
        const p2 = await a.evaluate(() => window.__rush.probe2());
        assert(p2.late.crashes === 0 && p2.late.clips === 1 && p2.late.stumbles === 1, `a swipe a step before a barrier clips it (stumble, bounce back), no heart lost (${JSON.stringify(p2.late)})`);
        assert(p2.none.crashes === 1 && p2.none.clips === 0, `the same barrier hit square on is a crash (${JSON.stringify(p2.none)})`);
        assert(p2.early.crashes === 0 && p2.early.stumbles === 0, `a swipe in time passes clean (${JSON.stringify(p2.early)})`);
        assert(p2.combo.max >= 3 && p2.combo.bonus >= 5, `near-miss combos pay bonus coins: x${p2.combo.max} max, +${p2.combo.bonus} bonus, ${p2.combo.closeCalls} close calls over 1.2 km of perfect running`);
        // the Daily seed: one track for both, all day
        const da = await a.evaluate(() => [window.__rush.dailySeed(), window.__rush.dailySeed('2026-01-02')]);
        const db = await b.evaluate(() => [window.__rush.dailySeed(), window.__rush.dailySeed('2026-01-02')]);
        assert(da[0] === db[0] && da[1] === db[1] && da[0] !== da[1] && da[0] > 0, `both phones agree on today's Daily seed (${da[0]}) and it changes by day`);
        // landscape phones (667×375, 568×320, 844×390 with a notch's insets): the whole lobby fits, Start above the
        // home indicator, and the settings card scrolls inside the screen with Done always in reach; tap targets ≥ 44 px
        const vp0 = a.viewportSize();
        for (const [vw, vh] of [[667, 375], [568, 320], [844, 390]]) {
          await a.setViewportSize({ width: vw, height: vh }); await h.wait(500);
          const lo = await a.evaluate(() => { const q = (x) => { const r = document.querySelector(x).getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right }; }; return { vh: innerHeight, vw: innerWidth, logo: q('.rr-ov-lobby .rr-logo'), sheet: q('.rr-sheet'), go: q('[data-r="go"]'), back: q('.gm-top .gm-icon:first-child'), menu: q('.gm-top .gm-icon:last-child') }; });
          assert(lo.logo.t >= 0 && lo.sheet.t >= 0 && lo.go.b <= lo.vh - 8 && lo.sheet.b <= lo.vh && lo.go.t > 0, `${vw}×${vh} lobby fits: logo ${Math.round(lo.logo.t)}…, Start ${Math.round(lo.go.t)}–${Math.round(lo.go.b)} of ${lo.vh}`);
          assert(lo.sheet.t >= lo.menu.b - 2 || lo.sheet.l > lo.menu.r || lo.sheet.r < lo.menu.l, `${vw}×${vh}: the mode sheet clears the menu sticker`);
          await a.click('.g-rush [data-r="gear"]'); await h.wait(350);
          const se = await a.evaluate(() => { const r = document.querySelector('.rr-ov-set [data-x="done"]').getBoundingClientRect(); const o = document.querySelector('.rr-ov-set'); const c = document.querySelector('.rr-ov-set .rr-card').getBoundingClientRect(); return { done: { t: r.top, b: r.bottom }, vh: innerHeight, card: { t: c.top }, scroll: getComputedStyle(o).overflowY, seg: Math.min(...[...document.querySelectorAll('.rr-ov-set .rr-seg button')].map((x) => x.getBoundingClientRect().height)) }; });
          assert(se.done.t >= 0 && se.done.b <= se.vh && se.scroll === 'auto' && se.card.t >= lo.back.b - 2 && se.seg >= 44, `${vw}×${vh}: settings scrolls, Done is on screen (${Math.round(se.done.t)}–${Math.round(se.done.b)} of ${se.vh}), starts under the stickers, segment buttons ${Math.round(se.seg)} px`);
          await a.click('.g-rush .rr-ov-set [data-x="done"]'); await h.wait(150);
        }
        await a.setViewportSize(vp0); await h.wait(300);
        const bots = await a.evaluate((ss) => ss.map((s) => window.__rush.botRun(s, 500)), [11, 22, 33, 44, 55]);
        for (const r of bots) console.log(`   bot seed ${r.seed}: ${r.chunks} chunks, ${(r.z / 1000).toFixed(1)} km, crashes ${r.crashes}, stumbles ${r.stumbles}, ${r.ms} ms`);
        assert(bots.every((r) => r.chunks >= 500 && r.crashes === 0 && r.fails.length === 0), 'perfect-information bot never gets caught in 500 chunks × 5 seeds');
      }

      if (want('race')) {
        await shot(a, 'phone-light-start');
        // guest readies up; host flips modes and the guest follows live
        await b.click('.g-rush .rr-ov-lobby [data-r="go"]');
        await until(a, () => /ready/.test(document.querySelector('.g-rush .rr-status').textContent), null, 6000, 'host sees guest ready');
        await a.click('.g-rush .rr-mode[data-mode="brawl"]');
        await until(b, () => window.__rush.state().lobbyMode === 'brawl', null, 6000, 'guest sees brawl');
        console.log('ok - guest sees the host pick the mode live');
        await pickAndStart(h, 'race');
        await waitRun(a); await waitRun(b);
        await spyFeedback(a); await spyFeedback(b);
        // milestone for an unlock: Emerson racks up 15 close calls this run (set early: a short race
        // on a loaded machine can be over before the later steps)
        await a.evaluate(() => { window.__rush.internals.players.a.r.closeCalls = 15; });
        const sa = await S(a); const sb = await S(b);
        const skew = Math.abs(sa.startedWall - sb.startedWall);
        assert(skew < 50, `both phones start within 50 ms on the shared clock (skew ${skew.toFixed(1)} ms, rtt ${sb.rtt} ms)`);
        console.log(`   first frame after GO differs by ${Math.abs(sa.firstRunWall - sb.firstRunWall)} ms (frame granularity in the harness)`);
        // UI inputs: real touch swipes on both phones (runners ghosted meanwhile, so a slow harness
        // can't run them into a barrier and swallow the gesture while they're down)
        await a.evaluate(() => { window.__rush.resetPerf(); window.__rush.ghost('a', 30); });
        await b.evaluate(() => window.__rush.ghost('b', 30));
        const la = (await S(a)).a.lane; const lb = (await S(b)).b.lane;
        await swipe(a, 195, 560, 90, 0);   // Emerson: right
        await swipe(b, 195, 560, -90, 0);  // Sydney: left
        await h.wait(400);
        const la2 = (await S(a)).a.lane; const lb2 = (await S(b)).b.lane;
        assert(la2 === la + 1 && lb2 === lb - 1, `swipes change lanes on both phones (${la}→${la2}, ${lb}→${lb2})`);
        const ign0 = (await a.evaluate(() => window.__rush.inputStats())).ignored;
        await swipe(a, 8, 560, 120, 0);    // starts in the iOS back-gesture zone
        await h.wait(300);
        const st = await a.evaluate(() => window.__rush.inputStats());
        assert(st.ignored === ign0 + 1 && (await S(a)).a.lane === la2, 'a swipe starting at the left edge is ignored');
        const j0 = (await S(a)).a.jumps; const r0 = (await S(b)).b.rolls;
        await swipe(a, 195, 600, 0, -80);  // jump
        await until(a, (n) => window.__rush.state().a.jumps > n, j0, 4000, 'jump from an up-swipe');
        console.log('ok - up-swipe jumps');
        await swipe(b, 195, 500, 0, 80);   // roll
        await until(b, (n) => window.__rush.state().b.rolls > n, r0, 4000, 'roll from a down-swipe');
        console.log('ok - down-swipe rolls');
        // ghost marker: when the partner is out of sight ahead, a chip with the live gap sits at the horizon in their lane
        await b.evaluate(() => { const r = window.__rush.internals.players.b.r; r.z += 135; r.zPrev = r.z; });
        // (text read in the same poll: the 135 m teleport sits just past the 120 m threshold, and on a
        // loaded machine the interpolated partner can briefly sample from before it, flipping back to the name tag)
        await until(a, () => { const t = document.querySelector('.g-rush .rr-tag'); const ok = t && t.classList.contains('rr-ghost') && t.style.display !== 'none' && /↑ \d+ m/.test(t.textContent); if (ok) window.__gt = t.textContent; return ok; }, null, 6000, 'ghost marker for a partner far ahead');
        const gt = await a.evaluate(() => window.__gt);
        assert(/Sydney ↑ \d+ m/.test(gt), `host sees the partner's ghost marker: "${gt}"`);
        await until(a, () => /^Sydney leads by \d+ m$/.test(document.querySelector('.g-rush .rr-gap span').textContent), null, 4000, 'the gap pill says who leads');
        console.log('ok - gap pill: "' + (await a.$eval('.g-rush .rr-gap span', (e) => e.textContent)) + '"');
        assert((await hotGapContrast(a)) >= 4.5, 'the revive prompt (light) reads at 4.5:1 or better');
        assert(await a.$eval('.g-rush .rr-pause', (e) => { const r = e.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }), 'the pause button is at least 44 × 44 px');
        await shot(a, 'phone-light-ghost');
        await b.evaluate(() => { const r = window.__rush.internals.players.b.r; r.z -= 135; r.zPrev = r.z; }); // back to the pack
        await until(a, () => { const t = document.querySelector('.g-rush .rr-tag'); return !t || !t.classList.contains('rr-ghost') || t.style.display === 'none'; }, null, 6000, 'ghost marker gone once they are back in view');
        // hand over to the autopilot; the ghosting runs out like a respawn's, so it can steer clear first
        await a.evaluate(() => { window.__rush.ghost('a', 1.5); window.__rush.auto('a', true); });
        await b.evaluate(() => { window.__rush.ghost('b', 1.5); window.__rush.auto('b', true); });
        await h.wait(1800);
        await shot(a, 'phone-light-run');
        await h.wait(700);

        // weapons: whoever trails throws ink at the leader through the UI button
        const s1 = await S(a);
        const [lead, trail] = s1.a.z >= s1.b.z ? [a, b] : [b, a];
        const tw = trail === a ? 'a' : 'b'; const lw = tw === 'a' ? 'b' : 'a';
        // (a shield the leader picked up on the track would block it: that case is tested next)
        await lead.evaluate((w) => { window.__rush.internals.players[w].r.shield = 0; }, lw);
        await trail.evaluate((w) => window.__rush.give(w, 'ink'), tw);
        await fireWeapon(trail);
        await until(lead, (w) => window.__rush.state()[w].splat, lw, 5000, 'ink splat on the leader');
        await shot(lead, 'phone-light-hit');
        await until(trail, (w) => window.__rush.state()[w].stats.hits >= 1, tw, 5000, 'attacker hears it hit');
        console.log('ok - ink bomb thrown from the UI, resolved on the victim, reported back');
        // a shield blocks the next one
        await lead.evaluate((w) => window.__rush.give(w, 'shield'), lw);
        await trail.evaluate((w) => window.__rush.give(w, 'zap'), tw);
        await fireWeapon(trail);
        // (a tap while the thrower is down is ignored and the zap stays loaded: on a loaded machine the
        // autopilot can be mid-crash at the click, so tap again while it's still in the slot)
        for (let k = 0; k < 3; k++) {
          const gone = await lead.waitForFunction((w) => !window.__rush.state()[w].shield, lw, { timeout: 5000, polling: 100 }).then(() => true, () => false);
          if (gone || (await trail.evaluate((w) => window.__rush.state()[w].weapon, tw)) !== 'zap') break;
          console.log(`   zap tap ${k + 1} ignored (thrower down at the click), again`);
          await fireWeapon(trail);
        }
        await until(lead, (w) => !window.__rush.state()[w].shield, lw, 3000, 'shield used up by the zap');
        console.log('ok - shield blocks a zap (victim decides)');
        // roadblock from the leader lands in the trailer's lane
        await lead.evaluate((w) => window.__rush.give(w, 'block'), lw);
        await fireWeapon(lead);
        await until(trail, (w) => window.__rush.state()[w].extra >= 1, tw, 5000, 'roadblock placed on the trailer');
        console.log('ok - roadblock placed by the victim device');

        // hearts + respawn
        // (atomic in the page: a manual runner can hit something on its own between two round trips)
        const cr = await b.evaluate(async () => {
          window.__rush.auto('b', false);
          const r = () => window.__rush.internals.players.b.r;
          for (let i = 0; i < 80 && r().down; i++) await new Promise((ok) => setTimeout(ok, 50));
          const h0 = r().hearts;
          window.__rush.crash('b');
          return { h0, h1: r().hearts, down: !!r().down };
        });
        const hb0 = cr.h0;
        assert(cr.down && cr.h1 === hb0 - 1, `a crash costs a heart (${hb0}→${cr.h1})`);
        await until(b, () => !window.__rush.state().b.down && window.__rush.state().b.invuln, null, 4000, 'respawn with invulnerability');
        console.log('ok - respawns after a moment, blinking');
        await until(a, (n) => window.__rush.state().b.hearts === n, hb0 - 1, 3000, 'host sees the guest hearts');
        await b.evaluate(() => window.__rush.auto('b', true));
        await h.wait(600);
        // a rocket (speed lines + FOV kick), and the shield bubble on screen, before the shader check
        await a.evaluate(() => { window.__rush.give('a', 'rocket'); window.__rush.input('a', 'use'); window.__rush.give('a', 'shield'); });
        await h.wait(900);
        const pa = await a.evaluate(() => window.__rush.perf());
        console.log(`   perf (iPhone 13 profile, SwiftShader, two pages): frame p50 ${pa.p50.toFixed(1)} ms, p95 ${pa.p95.toFixed(1)} ms, js p50 ${pa.work50.toFixed(2)} ms, p95 ${pa.work95.toFixed(2)} ms, draw calls ${pa.calls} (max ${pa.maxCalls}), triangles ${pa.tris} (max ${pa.maxTris}), render scale ${pa.scale}, dpr ${pa.dpr}`);
        assert(pa.maxCalls <= 30, `draw calls within the phone budget of 30 in a busy race (max ${pa.maxCalls})`);
        assert(pa.maxTris <= 60000, `triangles within the phone budget of 60k (max ${pa.maxTris})`);
        assert(pa.scale >= 0.55 && pa.scale <= 1, `dynamic resolution stays in range (scale ${pa.scale} after ${pa.scaleDowns} step${pa.scaleDowns === 1 ? '' : 's'} down, ${pa.scaleUps} up)`);
        for (const [pg, w] of [[a, 'host'], [b, 'guest']]) {
          const pgm = await pg.evaluate(() => ({ now: window.__rush.internals.renderer.info.programs.length, warm: window.__rush.perf().programs0 }));
          assert(pgm.warm >= 8 && pgm.now === pgm.warm, `${w}: every shader compiled behind the loading screen (${pgm.warm} programs; still ${pgm.now} after ink, zap, roadblock, rocket, shield, crash)`);
        }

        // finish
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 90000, 'end card on the host');
        await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 15000, 'end card on the guest');
        await checkFeedback(a, 'race (host)'); await checkFeedback(b, 'race (guest)');
        const ra = await S(a); const rb = await S(b);
        assert(ra.result && rb.result && ra.result.winner === rb.result.winner, `both phones agree: ${ra.result.text} (${ra.result.sub})`);
        await h.wait(500);
        const res = h.results().filter((r) => r.game === 'rush');
        assert(res.length === 1 && res[0].winner === ra.result.winner, 'race result recorded once');
        // bests + unlocks land in the shared game data (and the end card shows this device's line)
        const gd = h.docs['gamedata/rush'] || {};
        assert(gd.a_race_m > 0 && gd.b_race_m > 0 && gd.a_runs === 1, `bests in the shared doc: Emerson ${gd.a_race_m} m, Sydney ${gd.b_race_m} m`);
        assert(gd.unlock_a_trail2 === 1, 'the "15 close calls" milestone unlocked the Ink trail for Emerson (shared doc)');
        const sub = await a.$eval('#game-root .gm-end', (e) => e.textContent);
        assert(/\d+ m/.test(sub) && /Sydney/.test(sub), 'the death card shows distance and the partner');
        // the shared result is neutral (the engine broadcasts it); each phone adds its own "You: …" line locally
        const cardOf = (pg) => pg.$eval('#game-root .gm-end', (e) => ({ sub: [...e.querySelectorAll('.gm-end-sub:not(.rr-you)')].map((x) => x.textContent).join(' | '), you: (e.querySelector('.rr-you') || {}).textContent || '' }));
        await until(a, () => !!document.querySelector('#game-root .gm-end .rr-you'), null, 8000, 'host personal line');
        await until(b, () => !!document.querySelector('#game-root .gm-end .rr-you'), null, 8000, 'guest personal line');
        const ca = await cardOf(a); const cb = await cardOf(b);
        assert(ca.sub === cb.sub && !/You:/.test(ca.sub) && /You:/.test(ca.you) && /You:/.test(cb.you) && ca.you !== cb.you, `end card: shared line "${ca.sub}" is the same on both phones; personal lines differ ("${ca.you}" / "${cb.you}")`);
        await shot(a, 'phone-light-end');
        await shot(b, 'phone-light-end-guest');
      }

      if (want('brawl')) {
        await a.click('#game-root [data-g="rematch"]').catch(() => {});
        await until(a, () => window.__rush && window.__rush.state().phase === 'lobby', null, 15000, 'host back in the lobby');
        await until(b, () => window.__rush && window.__rush.state().phase === 'lobby' && window.__rush.state().synced, null, 15000, 'guest back in the lobby');
        console.log(`   rematch: re-mounted and ready in ${(await S(a)).loadMs} ms (host), ${(await S(b)).loadMs} ms (guest) — three.js already loaded`);
        if (want('race')) {
          await until(b, () => window.__rush.data().unlock_a_trail2 === 1, null, 8000, 'guest sees the unlock');
          assert((await a.evaluate(() => window.__rush.data().unlock_a_trail2)) === 1, 'unlock persists across the re-mount on both phones');
          await a.click('.g-rush .rr-ov-lobby [data-r="gear"]');
          await until(a, () => !!document.querySelector('.g-rush .rr-chip-s[data-k="trail"][data-v="2"]:not(.locked)'), null, 4000, 'Ink trail chip unlocked in settings');
          // (not the 1 km trail: a winner can overshoot a 990 m race line past 1,000 m on a loaded machine, which unlocks it)
          assert(await a.$eval('.g-rush .rr-chip-s[data-k="hat"][data-v="1"]', (e) => e.classList.contains('locked')), 'the Crown hat is still locked');
          await a.click('.g-rush .rr-chip-s[data-k="trail"][data-v="2"]');
          await shot(a, 'phone-light-style');
          await a.click('.g-rush .rr-ov-set [data-x="done"]');
          assert((await a.evaluate(() => window.__rush.settings.trail)) === 2, 'Emerson wears the Ink trail');
        }
        await pickAndStart(h, 'brawl');
        await waitRun(a); await waitRun(b);
        await spyFeedback(a); await spyFeedback(b);
        // Emerson (lane -1) steps to the middle, runs beside Sydney a beat, then swipes into her lane
        // (1) while level: a deliberate shove
        await a.evaluate(() => window.__rush.input('a', 'right'));
        let before = null;
        // (a loaded harness can lag the partner's position past the 2 m window: step back and retry)
        for (let k = 0; k < 4; k++) {
          // (re-nudged to the middle every 0.5 s: a step back can bump off a train, or be swallowed by a stumble)
          await until(a, () => {
            const p = window.__rush.internals.players.a; const r = p.r; const t = performance.now();
            if (r.lane !== 0 && !r.down && r.laneT >= 1 && t - (window.__nudge || 0) > 500) { window.__nudge = t; window.__rush.input('a', r.lane > 0 ? 'left' : 'right'); }
            return p.sideT >= 0.3 && r.lane === 0;
          }, null, 8000, 'side by side for a beat');
          before = await S(b);
          await a.evaluate(() => window.__rush.input('a', 'right'));
          const ok = await a.waitForFunction(() => window.__rush.state().a.stats.shoves >= 1, null, { timeout: 4000, polling: 100 }).then(() => true, () => false);
          if (ok) break;
          console.log(`   shove try ${k + 1} missed (partner position lagging), again`);
          await a.evaluate(() => { const r = window.__rush.internals.players.a.r; if (r.lane === 1) window.__rush.input('a', 'left'); });
        }
        await until(a, () => window.__rush.state().a.stats.shoves >= 1, null, 2000, 'shove lands');
        const after = await S(b);
        assert(after.b.hearts < before.b.hearts || after.b.stumbleT > 0 || after.b.down, `shoved into the wall: Sydney ${before.b.hearts}→${after.b.hearts} hearts`);
        await shot(b, 'phone-light-brawl-shove');
        // Sydney jumps, Emerson whiffs
        await a.evaluate(() => window.__rush.auto('a', true));
        await b.evaluate(() => window.__rush.auto('b', true));
        await h.wait(2500);
        // finish the brawl: Sydney runs out of hearts
        await b.evaluate(() => { window.__rush.auto('b', false); window.__rush.setHearts('b', 1); window.__rush.crash('b'); });
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 15000, 'brawl ends');
        await checkFeedback(a, 'brawl (host)'); await checkFeedback(b, 'brawl (guest)');
        const rs = await S(a);
        assert(rs.result.winner === 'a', `brawl winner: ${rs.result.text}`);
        await h.wait(400);
        assert(h.results().filter((r) => r.game === 'rush').length === (want('race') ? 2 : 1), 'brawl result recorded once');
      }

      if (want('tandem') || want('pause')) {
        await a.click('#game-root [data-g="rematch"]').catch(() => {});
        await until(a, () => window.__rush && window.__rush.state().phase === 'lobby', null, 15000, 'lobby');
        await until(b, () => window.__rush && window.__rush.state().phase === 'lobby' && window.__rush.state().synced, null, 15000, 'guest lobby');
        await pickAndStart(h, 'tandem');
        await waitRun(a); await waitRun(b);
        await spyFeedback(a); await spyFeedback(b);
        await a.evaluate(() => window.__rush.auto('a', true));
        await b.evaluate(() => window.__rush.auto('b', true));
        await h.wait(1500);
        if (want('tandem')) {
          await b.evaluate(() => window.__rush.crash('b'));
          await until(a, () => window.__rush.state().a.revive, null, 5000, 'partner gets revive tokens');
          await h.wait(400);
          await shot(a, 'phone-light-revive-token');
          // the revive is judged by the token: wait for Emerson's window to close (a heart grabbed, or
          // missed), however slowly a loaded page simulates, then for the revive to reach Sydney
          await until(a, () => { const q = window.__rush.state().a; return q.stats.revives >= 1 || !q.revive; }, null, 30000, 'the revive window closes');
          const ra = (await S(a)).a.stats.revives;
          assert(ra === 1, `the bot steers into a revive heart and grabs it (${ra} revive${ra === 1 ? '' : 's'})`);
          await until(b, () => !window.__rush.state().b.down, null, 10000, 'revived');
          const sa = await S(a);
          assert(sa.a.stats.revives === 1 && sa.th === 4, `revived by grabbing the token, no team heart lost (team hearts ${sa.th})`);
          // both down at once: nobody can revive, so it resolves straight away (−1 team heart, both up)
          await h.wait(2500);
          await a.evaluate(() => { window.__rush.auto('a', false); window.__rush.crash('a'); });
          await b.evaluate(() => { window.__rush.auto('b', false); window.__rush.crash('b'); });
          const t0 = Date.now();
          await until(a, () => !window.__rush.state().a.down && window.__rush.state().th === 3, null, 6000, 'double down resolves on the host');
          await until(b, () => !window.__rush.state().b.down, null, 6000, 'double down resolves on the guest');
          const dd = Date.now() - t0;
          await h.wait(1500);
          const sd = await S(a);
          assert(sd.th === 3 && !sd.a.down && !sd.b.down, `both down at once: back up together in ${(dd / 1000).toFixed(1)} s for one team heart (team hearts ${sd.th}, no revive wait)`);
          await a.evaluate(() => window.__rush.auto('a', true));
          await b.evaluate(() => window.__rush.auto('b', true));
        }
        if (want('pause')) {
          // disconnect: Sydney's presence drops out of the room, then comes back
          await b.evaluate(async () => { const room = await window.claude.use('room'); window.__rr = await room.join('ju-rush'); });
          await until(a, () => window.__rush.state().paused && window.__rush.state().reasons.includes('gone'), null, 5000, 'host pauses when the partner drops');
          await until(b, () => window.__rush.state().paused, null, 5000, 'guest pauses too');
          assert(await a.isVisible('.g-rush .rr-ov.rr-ov-pause'), 'pause overlay shown');
          await shot(a, 'phone-light-paused');
          const za = (await S(a)).a.z;
          await h.wait(1500);
          assert(Math.abs((await S(a)).a.z - za) < 0.01, 'runner frozen while paused');
          await b.evaluate(async () => { await window.__rr.presence({ who: 'b', on: true }); });
          await until(a, () => !window.__rush.state().paused && window.__rush.state().resumeAt > window.__rush.state().now, null, 6000, 'resume countdown scheduled');
          const ra = (await S(a)).resumeAt; const rb = (await S(b)).resumeAt;
          assert(Math.abs(ra - rb) < 30, `both resume at the same shared time (Δ ${Math.abs(ra - rb).toFixed(1)} ms)`);
          await until(a, () => window.__rush.state().now > window.__rush.state().resumeAt + 300, null, 6000, 'countdown over');
          const z1 = (await S(a)).a.z; await h.wait(600);
          assert((await S(a)).a.z > z1 + 3, 'running again after the countdown');
          // visibility: Sydney switches apps
          await b.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
          await until(a, () => window.__rush.state().paused, null, 5000, 'host pauses when the partner hides the app');
          await b.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
          await until(a, () => !window.__rush.state().paused && window.__rush.state().now > window.__rush.state().resumeAt + 200, null, 9000, 'resumes after a 3-2-1');
          console.log('ok - visibility pause and resume');
          // WebGL context loss on Emerson's phone
          await a.evaluate(() => { const c = window.__rush.canvas; const gl = c.getContext('webgl2') || c.getContext('webgl'); window.__lc = gl.getExtension('WEBGL_lose_context'); window.__lc.loseContext(); });
          await until(a, () => window.__rush.state().glLost && window.__rush.state().paused, null, 5000, 'context lost → paused');
          await a.evaluate(() => window.__lc.restoreContext());
          await until(a, () => !window.__rush.state().glLost && window.__rush.state().reasons.includes('tap'), null, 5000, 'context restored → tap to resume');
          await a.click('.g-rush .rr-ov.rr-ov-pause [data-x="resume"]');
          await until(a, () => !window.__rush.state().paused && window.__rush.state().now > window.__rush.state().resumeAt + 200, null, 9000, 'resumed after tap');
          const z2 = (await S(a)).a.z; await h.wait(600);
          assert((await S(a)).a.z > z2 + 3, 'run continues after the GL context comes back');
          await shot(a, 'phone-light-after-restore');
        }
        if (want('tandem')) {
          // end: one team heart left, Sydney goes down and Emerson can't reach a token in time
          await a.evaluate(() => { window.__rush.teamHearts(1); window.__rush.auto('a', false); });
          await b.evaluate(() => { window.__rush.auto('b', false); window.__rush.crash('b'); });
          await a.evaluate(() => { window.__rush.crash('a'); });
          await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 25000, 'tandem ends');
          await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 10000, 'tandem ends for the guest');
          await checkFeedback(a, 'tandem (host)'); await checkFeedback(b, 'tandem (guest)');
          const st = await S(a);
          assert(st.result.team && st.result.score > 0, `team result: ${st.result.text} (${st.result.sub})`);
          await h.wait(400);
          const tr = h.results().filter((r) => r.game === 'rush' && r.winner === 'team');
          assert(tr.length === 1 && tr[0].score === st.result.score, 'team score recorded once');
        }
      }
      let dailyEpoch = 0;
      if (want('daily')) {
        await a.click('#game-root [data-g="rematch"]').catch(() => {});
        await until(a, () => window.__rush && window.__rush.state().phase === 'lobby', null, 15000, 'lobby for daily');
        await until(b, () => window.__rush && window.__rush.state().phase === 'lobby' && window.__rush.state().synced, null, 15000, 'guest lobby for daily');
        await pickAndStart(h, 'daily');
        await waitRun(a); await waitRun(b);
        await spyFeedback(a); await spyFeedback(b);
        const ds = await a.evaluate(() => window.__rush.dailySeed());
        const sa = await S(a); const sb = await S(b);
        assert(sa.seed === ds && sb.seed === ds, `the Daily run uses today's seed on both phones (${ds})`);
        const ma = await a.evaluate(() => window.__rush.matchInfo()); const mb = await b.evaluate(() => window.__rush.matchInfo());
        const today = await a.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
        assert(ma.day === today && mb.day === today && ma.trackV === 2 && mb.trackV === 2 && ma.epoch > 0 && ma.epoch === mb.epoch, `the match carries its day (${ma.day}) and track version (v${ma.trackV}) from the host to the guest, same epoch ${ma.epoch}`);
        dailyEpoch = ma.epoch;
        assert(ma.mod === mb.mod && ma.mod === (await a.evaluate((d) => window.__rush.internals.X.dailyMod(d), today)), `the Daily carries the day's twist from the host to the guest (${ma.mod} / ${mb.mod})`);
        await a.evaluate(() => window.__rush.auto('a', true));
        await b.evaluate(() => window.__rush.auto('b', true));
        await h.wait(2500);
        await shot(a, 'phone-light-daily');
        // Sydney runs out of hearts first; Emerson keeps going, then is out too: furthest wins
        await b.evaluate(() => { window.__rush.auto('b', false); window.__rush.setHearts('b', 1); window.__rush.crash('b'); });
        await until(a, () => window.__rush.state().b.out, null, 8000, 'host sees Sydney out');
        await h.wait(2500);
        await shot(b, 'phone-light-daily-spectate');
        await a.evaluate(() => { window.__rush.auto('a', false); window.__rush.setHearts('a', 1); window.__rush.crash('a'); });
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 20000, 'daily ends');
        await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 10000, 'daily ends for the guest');
        await checkFeedback(a, 'daily (host)'); await checkFeedback(b, 'daily (guest)');
        const rd = await S(a);
        assert(rd.result.daily && rd.result.winner === 'a' && rd.result.za > rd.result.zb, `furthest wins the Daily: ${rd.result.text} (${rd.result.sub})`);
        await h.wait(500);
        const gd = h.docs['gamedata/rush'] || {};
        const dk = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
        assert(gd[`a_daily_${dk}`] === rd.result.za && gd[`b_daily_${dk}`] === rd.result.zb, `today's board is in the shared doc (${gd[`a_daily_${dk}`]} / ${gd[`b_daily_${dk}`]} m)`);
        await shot(a, 'phone-light-daily-end');
        await a.click('#game-root [data-g="rematch"]').catch(() => {});
        await until(a, () => window.__rush && window.__rush.state().phase === 'lobby', null, 15000, 'lobby after daily');
        await until(a, () => /Today:/.test((document.querySelector('.g-rush [data-r="daily"]') || {}).textContent || ''), null, 8000, 'lobby shows today\'s board');
        await shot(a, 'phone-light-lobby-board');

        // a second Daily on the same seed is told apart from the first (the epoch used to be seed % 100000, identical every time)
        await pickAndStart(h, 'daily');
        await waitRun(a); await waitRun(b);
        const m2 = await a.evaluate(() => window.__rush.matchInfo()); const m2b = await b.evaluate(() => window.__rush.matchInfo());
        assert(m2.epoch > 0 && m2.epoch === m2b.epoch && m2.epoch !== dailyEpoch, `a Daily rematch gets its own epoch (${dailyEpoch} → ${m2.epoch})`);
        await a.evaluate(() => window.__rush.auto('a', true)); await b.evaluate(() => window.__rush.auto('b', true));
        await h.wait(1500);
        // Quit mid-run: Sydney leaves; after a while Emerson can end the match as a win (two taps)
        const zq = (await S(a)).a.z; const wins0 = await a.evaluate(() => window.__rush.data().a_wins | 0);
        await b.evaluate(async () => { const room = await window.claude.use('room'); window.__rr = await room.join('ju-rush'); });
        await until(a, () => window.__rush.state().paused && window.__rush.state().reasons.includes('gone'), null, 5000, 'host pauses when the partner quits');
        assert(!(await a.isVisible('.g-rush .rr-ov-pause [data-x="forfeit"]')), 'no "End match" offer right away');
        await until(a, () => !!document.querySelector('.g-rush .rr-ov-pause [data-x="forfeit"]'), null, 8000, 'the waiting card offers to end the match');
        await shot(a, 'phone-light-quit-card');
        // (both taps inside one page turn: the arm lasts 3 s, and a loaded harness takes longer than that between two round trips)
        const taps = await a.evaluate(() => { const b = document.querySelector('.g-rush .rr-ov-pause [data-x="forfeit"]'); b.click(); const armed = b.textContent; const phase = window.__rush.state().phase; b.click(); return { armed, phase }; });
        assert(/Tap again/.test(taps.armed) && taps.phase === 'run', 'the first tap only arms it, the second ends it');
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 8000, 'the match ends for the one still here');
        const qr = await S(a);
        assert(qr.result.winner === 'a' && qr.result.forfeit === 1 && /left the game/.test(qr.result.sub) && qr.a.z >= zq, `ending it hands the win to the one still here: "${qr.result.text}" (${qr.result.sub})`);
        await h.wait(400);
        assert((await a.evaluate(() => window.__rush.data().a_wins | 0)) === wins0, 'a win handed over by a quit does not count toward unlocks');
      }
      h.assertNoErrors();
      console.log('ok - no page errors (phones)');
      assert(!h.warnings.length, `stays inside the ~40 msg/s room budget (${h.warnings.length} warnings)`);
    } catch (e) {
      console.error(e.message); fails++;
      await shot(h.a, 'fail-a').catch(() => {}); await shot(h.b, 'fail-b').catch(() => {});
      console.error('errors:', h.errors.slice(0, 8));
    } finally { await h.close(); }
  }

  // ═══ one computer: split screen, keys, leaks ═══
  if (want('split') || want('leak')) {
    const h = await launch({ port: PORT(1), only: ['rush'], device: 'Desktop Chrome', who: ['a'] });
    const { a } = h;
    try {
      await a.setViewportSize({ width: 1280, height: 800 });
      await a.evaluate((d) => { window.__RUSH_DEBUG = d; }, { ...DEBUG, raceLen: 500 });
      if (want('split')) {
        await h.startLive(a, 'rush', 'local');
        await until(a, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().phase === 'lobby', null, 30000, 'split lobby');
        await h.wait(600);
        await shot(a, 'desk-light-start');
        await a.click('.g-rush .rr-mode[data-mode="race"]');
        // Enter on a focused button is that button's own press (it used to be swallowed for the weapon key)
        await a.focus('.g-rush [data-r="gear"]'); await a.keyboard.press('Enter');
        await until(a, () => !!document.querySelector('.g-rush .rr-ov-set.on'), null, 3000, 'Enter on the focused settings button opens it');
        // style picker: a style only Sydney has earned is open to pick (and says so), worn by her runner only
        await a.evaluate(() => window.__rush.setData({ unlock_b_trail1: 1 }));
        await a.click('.g-rush .rr-ov-set [data-x="done"]'); await a.click('.g-rush [data-r="gear"]');
        const chip = await a.$eval('.g-rush .rr-chip-s[data-k="trail"][data-v="1"]', (e) => ({ locked: e.classList.contains('locked'), text: e.textContent }));
        assert(!chip.locked && /Sydney only/.test(chip.text), `split screen: a trail one runner earned is selectable (${chip.text})`);
        await a.click('.g-rush .rr-ov-set [data-x="done"]');
        await a.click('.g-rush .rr-ov-lobby [data-r="go"]');
        await waitRun(a);
        const pz = await a.$eval('.g-rush .rr-pause', (e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; });
        assert(pz[0] >= 44 && pz[1] >= 44, `split screen: the pause button is ${pz[0]}×${pz[1]} px`);
        await a.keyboard.press('KeyD');        // Emerson right
        await a.keyboard.press('ArrowLeft');   // Sydney left
        await h.wait(300);
        let s = await S(a);
        assert(s.a.lane === 0 && s.b.lane === 0, `both key sets move their own runner (a ${s.a.lane}, b ${s.b.lane})`);
        await a.keyboard.press('ArrowRight');  // Sydney back out, so the shot shows both
        await h.wait(200);
        const jr = await S(a);
        await a.keyboard.press('KeyW');
        await a.keyboard.press('ArrowDown');
        await h.wait(200);
        s = await S(a);
        assert(s.a.jumps > jr.a.jumps && s.b.rolls > jr.b.rolls, 'W jumps Emerson, ↓ rolls Sydney');
        await h.wait(900);
        await shot(a, 'desk-light-run');
        await a.evaluate(() => { window.__rush.auto('a', true); window.__rush.auto('b', true); });
        // a combo payout plays the bonus chime on the ladder, and nothing of a crash
        await spyFeedback(a);
        assert(await a.evaluate(() => window.__rush.emit('a', 'bonus', 5)), 'queued a combo payout on Emerson');
        await until(a, () => window.__fb.play.bonus >= 1, null, 4000, 'bonus chime');
        await h.wait(300);
        const fb = await checkFeedback(a, 'combo payout');
        assert(fb.bonus >= 1 && fb.ladder.some((l) => /^a:x\d+ .*\+5 coins$/.test(l)), `the payout lands on the combo ladder (${fb.ladder.join(' | ')})`);
        await h.wait(1200);
        s = await S(a);
        const [tw, lw] = s.a.z >= s.b.z ? ['b', 'a'] : ['a', 'b'];
        await a.evaluate(([t, l]) => { window.__rush.internals.players[l].r.shield = 0; window.__rush.give(t, 'ink'); }, [tw, lw]);
        await a.keyboard.press(tw === 'a' ? 'KeyE' : 'Enter');
        await until(a, (w) => window.__rush.state()[w].splat, lw, 5000, 'ink from the weapon key');
        await shot(a, 'desk-light-hit');
        console.log('ok - weapon keys work in split screen');
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 90000, 'split race ends');
        await checkFeedback(a, 'split race on autopilot');
        // split screen is laptop-only: two views a frame, so its own budget (docs/games/rush.md,
        // Performance): ≤ 50 calls / 120k triangles a frame (the phone budget, 30 / 60k, is one view)
        const sp = await a.evaluate(() => window.__rush.perf());
        console.log(`   split screen (1280×800, both views): ≤ ${sp.maxCalls} draw calls, ≤ ${sp.maxTris} triangles a frame`);
        assert(sp.maxCalls <= 50 && sp.maxTris <= 120000, `split screen within the laptop split budget of 50 calls / 120k triangles (max ${sp.maxCalls} / ${sp.maxTris})`);
        await h.wait(400);
        assert(h.results().filter((r) => r.game === 'rush').length === 1, 'one-device result recorded');
        await shot(a, 'desk-light-end');
        await a.click('#game-root [data-g="close"]');
        await h.wait(300);
      }
      if (want('leak')) {
        await a.evaluate(() => {
          window.__gl = [];
          const orig = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (t, o) { const c = orig.call(this, t, o); if (c && /webgl/.test(t) && !window.__gl.includes(c)) window.__gl.push(c); return c; };
          window.__raf = 0;
          const r0 = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = (fn) => { window.__raf++; return r0(fn); };
        });
        for (let i = 0; i < 5; i++) {
          await h.startLive(a, 'rush', 'local');
          await until(a, () => window.__rush && window.__rush.state().ready3D, null, 30000, 'open ' + i);
          await h.wait(300);
          await a.click('#game-root [data-g="close"]');
          await h.wait(250);
        }
        await h.wait(500);
        const leak = await a.evaluate(async () => {
          const r1 = window.__raf;
          await new Promise((r) => setTimeout(r, 600));
          return { contexts: window.__gl.length, alive: window.__gl.filter((g) => !g.isContextLost()).length, rafDuring: window.__raf - r1, canvases: document.querySelectorAll('.g-rush canvas').length, hook: !!window.__rush };
        });
        assert(leak.contexts === 5 && leak.alive === 0, `5 opens → 5 WebGL contexts, all released (${leak.alive} alive)`);
        assert(leak.rafDuring === 0 && leak.canvases === 0 && !leak.hook, `no rAF loop or canvas left behind (${leak.rafDuring} rAF calls in 600 ms)`);
      }
      // a phone can't do one-device mode: friendly card
      h.assertNoErrors();
      console.log('ok - no page errors (computer)');
    } catch (e) {
      console.error(e.message); fails++;
      await shot(h.a, 'fail-desk').catch(() => {});
      console.error('errors:', h.errors.slice(0, 8));
    } finally { await h.close(); }
  }

  // ═══ packet loss ═══
  if (want('drop')) {
    const h = await launch({ port: PORT(2), only: ['rush'], latency: 80, dropRate: 0.2, coarse: true });
    const { a, b } = h;
    try {
      await openLivePair(h, { raceLen: 500 });
      await pickAndStart(h, 'race');
      await waitRun(a); await waitRun(b);
      await a.evaluate(() => window.__rush.auto('a', true));
      await b.evaluate(() => window.__rush.auto('b', true));
      const s = await S(a);
      const tw = s.a.z >= s.b.z ? 'b' : 'a';
      const tp = tw === 'a' ? a : b;
      await (tw === 'a' ? b : a).evaluate((w) => { window.__rush.internals.players[w].r.shield = 0; }, tw === 'a' ? 'b' : 'a');
      await tp.evaluate((w) => window.__rush.give(w, 'ink'), tw);
      await fireWeapon(tp);
      await until(tw === 'a' ? b : a, (w) => window.__rush.state()[w].splat, tw === 'a' ? 'b' : 'a', 10000, 'ink lands through 20% loss');
      console.log('ok - reliable weapon event through 20% loss');
      await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 90000, 'end card (host) with loss');
      await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 20000, 'end card (guest) with loss');
      const ra = await S(a); const rb = await S(b);
      assert(ra.result.winner === rb.result.winner, 'both agree on the winner with 20% packet loss');
      await h.wait(500);
      assert(h.results().filter((r) => r.game === 'rush').length === 1, 'result recorded once with 20% loss');
      h.assertNoErrors();
      console.log('ok - no page errors (20% loss)');
      assert(!h.warnings.length, `inside the room message budget with 20% loss and retries (${h.warnings.length} warnings)`);
    } catch (e) {
      console.error(e.message); fails++;
      console.error('errors:', h.errors.slice(0, 8));
    } finally { await h.close(); }
  }

  // ═══ screenshots: dark, phone one-device card ═══
  if (want('dark')) {
    const h = await launch({ port: PORT(3), only: ['rush'], latency: 60, colorScheme: 'dark', coarse: true });
    const { a, b } = h;
    try {
      await openLivePair(h);
      await h.wait(600);
      await shot(a, 'phone-dark-start');
      await pickAndStart(h, 'race');
      await waitRun(a); await waitRun(b);
      await a.evaluate(() => window.__rush.auto('a', true));
      await b.evaluate(() => window.__rush.auto('b', true));
      await h.wait(2200);
      await shot(a, 'phone-dark-run');
      assert((await hotGapContrast(a)) >= 4.5, 'the revive prompt (dark) reads at 4.5:1 or better');
      // ink the leader. Whoever leads is read again before each throw (the bots swap the lead), and a
      // throw that can't land (the leader changed hands, or was down when it arrived) is thrown again
      let inked = null;
      for (let k = 0; k < 3 && !inked; k++) {
        const s = await S(a);
        const tw = s.a.z >= s.b.z ? 'b' : 'a'; const lw = tw === 'a' ? 'b' : 'a';
        const tp = tw === 'a' ? a : b; const vp = tw === 'a' ? b : a;
        await vp.evaluate((w) => { window.__rush.internals.players[w].r.shield = 0; }, lw);
        await tp.evaluate((w) => window.__rush.give(w, 'ink'), tw);
        await fireWeapon(tp);
        if (await until(vp, (w) => window.__rush.state()[w].splat, lw, 10000, 'dark ink').then(() => true, () => false)) inked = vp;
        else console.log(`   (ink throw ${k + 1} didn't land: ${JSON.stringify(await S(a).then((q) => ({ a: Math.round(q.a.z), b: Math.round(q.b.z), da: q.a.down, db: q.b.down })))}; again)`);
      }
      assert(!!inked, 'dark: an ink bomb lands on the leader');
      await shot(inked, 'phone-dark-hit');
      await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 90000, 'dark end');
      await shot(a, 'phone-dark-end');
      await a.click('#game-root [data-g="close"]');
      await b.click('#game-root [data-g="close"]').catch(() => {});
      await h.wait(300);
      await h.startLive(a, 'rush', 'local');
      await until(a, () => document.querySelector('.g-rush .rr-ov.rr-ov-msg.on'), null, 10000, 'phone one-device card');
      await shot(a, 'phone-dark-onedevice');
      assert(await a.isVisible('.g-rush [data-g="live"][data-mode="live"]'), 'phone in one-device mode suggests live play');
      h.assertNoErrors();
      assert(!h.warnings.length, `dark: inside the room message budget (${h.warnings.length} warnings)`);
    } catch (e) { console.error(e.message); fails++; console.error('errors:', h.errors.slice(0, 8)); } finally { await h.close(); }
    const d = await launch({ port: PORT(4), only: ['rush'], device: 'Desktop Chrome', who: ['a'], colorScheme: 'dark' });
    try {
      await d.a.setViewportSize({ width: 1280, height: 800 });
      await d.a.evaluate((x) => { window.__RUSH_DEBUG = x; }, { ...DEBUG, raceLen: 400 });
      await d.startLive(d.a, 'rush', 'local');
      await until(d.a, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().phase === 'lobby', null, 30000, 'dark split lobby');
      await d.wait(600);
      await shot(d.a, 'desk-dark-start');
      await d.a.click('.g-rush .rr-ov-lobby [data-r="go"]');
      await waitRun(d.a);
      await d.a.evaluate(() => { window.__rush.auto('a', true); window.__rush.auto('b', true); });
      await d.wait(2200);
      await shot(d.a, 'desk-dark-run');
      await d.a.evaluate(() => { window.__rush.give('b', 'ink'); });
      await d.a.keyboard.press('Enter');
      await d.wait(900);
      await shot(d.a, 'desk-dark-hit');
      await until(d.a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 90000, 'dark split end');
      await shot(d.a, 'desk-dark-end');
      d.assertNoErrors();
    } catch (e) { console.error(e.message); fails++; console.error('errors:', d.errors.slice(0, 8)); } finally { await d.close(); }
  }

  // ═══ steady-state allocations + heap growth (one computer, so the numbers are this page's own) ═══
  if (want('heap')) {
    const h = await launch({ port: PORT(5), only: ['rush'], device: 'Desktop Chrome', who: ['a'] });
    const { a } = h;
    try {
      await a.setViewportSize({ width: 1280, height: 800 });
      await a.evaluate((d) => { window.__RUSH_DEBUG = d; }, { ...DEBUG, raceLen: 60000 });
      await h.startLive(a, 'rush', 'local');
      await until(a, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().phase === 'lobby', null, 30000, 'heap lobby');
      await a.click('.g-rush .rr-ov-lobby [data-r="go"]');
      await waitRun(a);
      await a.evaluate(() => { window.__rush.ghost('a', 1e6); window.__rush.ghost('b', 1e6); });
      const cdp = await a.context().newCDPSession(a);
      // let the per-frame path reach the optimizing tier first (SwiftShader frames are slow, so
      // this drives the JS side directly: sim, logic, avatars, particles, world sync, rig, HUD, overlay)
      await a.evaluate(() => window.__rush.bench(9000)); // ~2.5 min of 60 Hz play: the big functions reach the top tier
      await cdp.send('HeapProfiler.enable');
      // Steady state = after V8 tiers up, which only ever moves forward; on a loaded machine its
      // background compiles can lag, so sample up to three windows and keep the quietest.
      let hot = Infinity; let build = 0; let sites = new Map(); let bm = null;
      for (let win = 0; win < 3; win++) {
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.send('HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
        const wbm = await a.evaluate(() => window.__rush.bench(1500));
        const prof = (await cdp.send('HeapProfiler.stopSampling')).profile;
        let whot = 0; let wbuild = 0; const wsites = new Map();
        const walk = (n, stack) => {
          const cf = n.callFrame; const name = cf.functionName || '(anon)';
          const st = stack.concat(name);
          if (n.selfSize && st.includes('bench')) {
            // chunk building / generation happens once per 100 m, not per frame; setScore is the engine's
            if (st.some((f) => /^(buildChunk|chunkMesh|genChunk|keepFrom|setScore)$/.test(f))) wbuild += n.selfSize;
            else { whot += n.selfSize; const k = st.slice(-3).join(' < '); wsites.set(k, (wsites.get(k) || 0) + n.selfSize); }
          }
          for (const c of n.children) walk(c, st);
        };
        walk(prof.head, []);
        if (whot < hot) { hot = whot; build = wbuild; sites = wsites; bm = wbm; }
        if (hot / wbm.frames < 1024) break;
      }
      const perFrame = hot / bm.frames;
      console.log(`   JS per frame (both runners, no GL draw): ${bm.msPerFrame.toFixed(2)} ms; hot-path allocations ${perFrame.toFixed(1)} B/frame; chunk building ${(build / 1024).toFixed(0)} KB over ${bm.frames} frames`);
      for (const [k, v] of [...sites.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5)) console.log(`     ${(v / bm.frames).toFixed(1)} B/frame  ${k}`);
      // What remains is V8 boxing doubles passed across non-inlined calls (tier-dependent, and
      // absent on the iPhone's JSC); per-frame objects / arrays / strings would blow well past this.
      assert(perFrame < 2048, `per-frame hot path makes no garbage objects: ${perFrame.toFixed(0)} B/frame of boxed numbers (two runners, two views)`);
      // retained heap over 30 s of real running
      await cdp.send('HeapProfiler.collectGarbage');
      const h0 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
      const f0 = (await a.evaluate(() => window.__rush.perf())).frames;
      await h.wait(30000);
      await cdp.send('HeapProfiler.collectGarbage');
      const h1 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
      const f1 = (await a.evaluate(() => window.__rush.perf())).frames;
      assert(h1 - h0 < 1.5e6, `heap after 30 s of running (${f1 - f0} frames, after GC): ${(h0 / 1e6).toFixed(2)} → ${(h1 / 1e6).toFixed(2)} MB (${((h1 - h0) / 1024).toFixed(0)} KB growth)`);
      const au = await a.evaluate(() => window.__rush.internals.audio.stats);
      console.log(`   music scheduler: ${au.steps} steps, ${au.resets} resyncs, never more than ${(au.maxAhead * 1000).toFixed(0)} ms ahead`);
      h.assertNoErrors();
    } catch (e) { console.error(e.message); fails++; console.error('errors:', h.errors.slice(0, 8)); } finally { await h.close(); }
  }

  // ═══ seamlessness: late lobby, partner + host re-mounts mid-race, 30 s in the background, a slow partner ═══
  if (want('seam')) {
    const h = await launch({ port: PORT(6), only: ['rush'], latency: 80, coarse: true });
    const { a, b } = h;
    const running = async (pg, w, what) => {
      await until(pg, () => { const s = window.__rush && window.__rush.state(); return s && s.phase === 'run' && !s.paused && s.now > s.resumeAt + 200; }, null, 20000, what);
      const z0 = (await S(pg))[w].z; await h.wait(700);
      assert((await S(pg))[w].z > z0 + 2, `${what}: running again`);
    };
    try {
      for (const pg of [a, b]) await pg.evaluate((d) => { window.__RUSH_DEBUG = d; }, { ...DEBUG, raceLen: 20000 });
      // the host opens it and waits alone a while before the partner shows up
      await h.startLive(a, 'rush', 'live');
      await h.wait(4000);
      const invited = await b.isVisible('#gm-invite').catch(() => false);
      if (invited) await b.click('#gm-invite [data-g="invite-yes"]'); else await h.startLive(b, 'rush', 'live');
      await until(a, () => window.__rush && window.__rush.state().ready3D, null, 30000, 'host 3D ready');
      await until(b, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().synced, null, 30000, 'late guest ready');
      await pickAndStart(h, 'race');
      console.log('ok - lobby works when the partner arrives late');
      await waitRun(a); await waitRun(b);
      await a.evaluate(() => window.__rush.auto('a', true)); await b.evaluate(() => window.__rush.auto('b', true));
      await h.wait(3000);

      // the guest is 500 m in with a heart down (the milestone heart is already spent)
      await b.evaluate(() => { const r = window.__rush.internals.players.b.r; r.z += 520; r.zPrev = r.z; });
      await until(b, () => window.__rush.internals.players.b.lastMile >= 1, null, 5000, 'guest passes 500 m');
      await b.evaluate(() => window.__rush.setHearts('b', 2));
      await h.wait(1200);
      // the guest leaves mid-race and comes back
      const zb0 = (await S(b)).b.z;
      await b.click('#game-root [data-g="close"]');
      await until(a, () => window.__rush.state().paused && window.__rush.state().reasons.includes('gone'), null, 8000, 'host pauses when the guest leaves');
      assert(await a.isVisible('.g-rush .rr-ov-pause [data-g="invite-again"]'), 'the pause card offers to invite them back');
      await shot(a, 'seam-guest-left');
      await h.wait(1500);
      await h.startLive(b, 'rush', 'live');
      await until(b, () => window.__rush && window.__rush.state().phase === 'run', null, 30000, 'guest is put back into the run');
      const zb1 = (await S(b)).b.z;
      assert(Math.abs(zb1 - zb0) < 40, `guest picks up where it left off (${zb0.toFixed(0)} m → ${zb1.toFixed(0)} m)`);
      await h.wait(500);
      const rj = await b.evaluate(() => { const p = window.__rush.internals.players.b; return { hearts: p.r.hearts, mile: p.lastMile, z: p.r.z }; });
      assert(rj.hearts === 2 && rj.mile === Math.floor(rj.z / 500), `a Race reconnect after 500 m doesn't hand out a free milestone heart (hearts ${rj.hearts}, milestone ${rj.mile})`);
      await b.evaluate(() => window.__rush.auto('b', true));
      await running(a, 'a', 'host after the guest came back'); await running(b, 'b', 'guest after coming back');

      // the host leaves mid-race (a reload or app restart looks the same) and comes back
      const za0 = (await S(a)).a.z;
      await a.click('#game-root [data-g="close"]');
      await until(b, () => window.__rush.state().paused, null, 8000, 'guest pauses when the host leaves');
      await shot(b, 'seam-host-left');
      await h.wait(1500);
      await h.startLive(a, 'rush', 'live');
      await until(a, () => window.__rush && window.__rush.state().phase === 'run', null, 30000, 'host gets its run back from the guest');
      const za1 = (await S(a)).a.z;
      assert(Math.abs(za1 - za0) < 40, `host picks up where it left off (${za0.toFixed(0)} m → ${za1.toFixed(0)} m)`);
      await a.evaluate(() => window.__rush.auto('a', true));
      await running(a, 'a', 'host after its re-mount'); await running(b, 'b', 'guest after the host re-mount');
      const ra = (await S(a)).resumeAt; const rb = (await S(b)).resumeAt;
      assert(Math.abs(ra - rb) < 60, `both counted down to the same moment after the re-mount (Δ ${Math.abs(ra - rb).toFixed(0)} ms)`);

      // 30 s in the background (app switcher), then back with a 3-2-1
      await b.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await until(a, () => window.__rush.state().paused, null, 5000, 'host pauses while the guest is in the background');
      const zh = (await S(a)).a.z;
      await h.wait(30000);
      assert(Math.abs((await S(a)).a.z - zh) < 0.01, 'nothing moves while the partner is away');
      await b.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await running(a, 'a', 'host after 30 s in the background'); await running(b, 'b', 'guest after 30 s in the background');

      // a much slower partner phone (4x CPU throttle): no pause flapping, the race still resolves
      const cdpB = await b.context().newCDPSession(b);
      await cdpB.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      let pausedSamples = 0;
      for (let i = 0; i < 16; i++) { await h.wait(500); if ((await S(a)).paused) pausedSamples++; }
      const sa = await S(a); const sb = await S(b);
      console.log(`   slow partner: host ran to ${sa.a.z.toFixed(0)} m, slow guest to ${sb.b.z.toFixed(0)} m (${sb.b.t.toFixed(1)} s vs ${sa.a.t.toFixed(1)} s of run time); host paused in ${pausedSamples}/16 samples`);
      assert(pausedSamples <= 2, 'a slow partner doesn’t make the fast phone stutter between pauses');
      await b.evaluate(() => { window.__rush.auto('b', false); window.__rush.setHearts('b', 1); window.__rush.crash('b'); });
      await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 30000, 'race resolves with a slow partner');
      await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 30000, 'slow guest sees the end card');
      await cdpB.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const ea = await S(a); const eb = await S(b);
      assert(ea.result && eb.result && ea.result.winner === 'a' && eb.result.winner === 'a', 'both agree on the result');
      h.assertNoErrors();
      assert(!h.warnings.length, `stays inside the room message budget (${h.warnings.length} warnings)`);
    } catch (e) {
      console.error(e.message); fails++;
      await shot(h.a, 'fail-seam-a').catch(() => {}); await shot(h.b, 'fail-seam-b').catch(() => {});
      console.error('errors:', h.errors.slice(0, 8));
    } finally { await h.close(); }
  }

  // ═══ a Daily runner who was out of hearts and re-mounts is still out (it used to come back alive with 0 hearts) ═══
  if (want('rejoin')) {
    const h = await launch({ port: PORT(7), only: ['rush'], latency: 40, coarse: true });
    const { a, b } = h;
    try {
      await openLivePair(h, { raceLen: 20000 });
      await pickAndStart(h, 'daily');
      await waitRun(a); await waitRun(b);
      await a.evaluate(() => window.__rush.auto('a', true));
      await b.evaluate(() => { window.__rush.auto('b', false); window.__rush.setHearts('b', 1); window.__rush.crash('b'); });
      await until(a, () => window.__rush.state().b.out, null, 8000, 'host sees the guest out');
      await h.wait(1500);
      await b.click('#game-root [data-g="close"]');
      await until(a, () => window.__rush.state().paused && window.__rush.state().reasons.includes('gone'), null, 8000, 'host pauses when the guest leaves');
      await h.wait(1000);
      await h.startLive(b, 'rush', 'live');
      await until(b, () => window.__rush && window.__rush.state().phase === 'run', null, 30000, 'guest is put back into the run');
      await h.wait(3500);
      const sb = await S(b); const sa = await S(a);
      assert(sb.b.out && sb.b.down && sb.b.hearts === 0 && sa.b.out, `the guest comes back still out of hearts (out ${sb.b.out}, down ${sb.b.down}, hearts ${sb.b.hearts}; the host still sees it out: ${sa.b.out})`);
      h.assertNoErrors();
    } catch (e) { console.error(e.message); fails++; await shot(h.a, 'fail-rejoin-a').catch(() => {}); } finally { await h.close(); }
  }

  // ═══ the loop: the Daily's twist of the day, three dares + stamps, love notes, their unlocks (extras.js) ═══
  if (want('loop')) {
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const h = await launch({ port: PORT(10), only: ['rush'], latency: 40, coarse: true });
    const { a, b } = h;
    try {
      await openLivePair(h);
      // pure helpers: every twist comes up, three distinct dares a day, ISO weeks, notes are cleaned
      const pure = await a.evaluate(() => {
        const X = window.__rush.internals.X; const seen = new Set(); let distinct = true;
        for (let i = 0; i < 400; i++) {
          const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10); seen.add(X.dailyMod(d));
          const ds = X.daresOf(d); if (new Set(ds).size !== 3 || ds.some((k) => k < 0 || k >= X.DARES.length)) distinct = false;
        }
        return { mods: [...seen].sort().join(), distinct, weeks: ['2026-10-12', '2026-01-01', '2021-01-03', '2024-12-30', '2026-12-31'].map((d) => X.isoWeek(d)).join(), clean: X.cleanNote('  hi‮ there\n\n you  ' + 'z'.repeat(80)) };
      });
      assert(pure.mods === '0,1,2,3,4,5,6' && pure.distinct, `the day's twist covers all seven (${pure.mods}) and its dares are three distinct goals`);
      assert(pure.weeks === '2026-W42,2026-W01,2020-W53,2025-W01,2026-W53', `ISO weeks: ${pure.weeks}`);
      assert(pure.clean.length === 60 && !/[\n‮]/.test(pure.clean) && pure.clean.startsWith('hi there you z'), `a note is one clean line of at most 60 characters ("${pure.clean}")`);

      // lobby: today's three dares with a check per player, and the note chip
      const day = today();
      await a.evaluate((d) => window.__rush.setData({ ['a_dare_' + d]: 1, ['b_dare_' + d]: 3 }), day);
      await until(a, () => document.querySelectorAll('.g-rush .rr-dares-l li').length === 3 && document.querySelectorAll('.g-rush .rr-dares-l .rr-ck.on').length === 3, null, 6000, 'the lobby shows the 3 dares with 1 + 2 checks');
      assert((await a.evaluate(() => [...document.querySelectorAll('.g-rush .rr-dares-l li')].every((li) => li.textContent.trim().length > 8))), 'each dare reads as a goal');
      const chip = await a.evaluate(() => { const r = document.querySelector('.g-rush .rr-note-chip').getBoundingClientRect(); return { w: r.width, h: r.height, t: document.querySelector('.g-rush .rr-note-chip').textContent }; });
      assert(chip.h >= 44 && chip.w >= 44 && /Note for Sydney/.test(chip.t), `the note chip is a 44 px target ("${chip.t.trim()}", ${Math.round(chip.h)} px)`);
      await shot(a, 'phone-light-lobby-dares');
      // the input: iOS-safe (16 px, no zoom), the game's key handler leaves its keys alone, ≤ 60 chars, saved to the shared data
      await a.click('.g-rush .rr-note-chip');
      await until(a, () => document.activeElement && document.activeElement.classList.contains('rr-note-in'), null, 3000, 'the input is focused');
      const fz = await a.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.rr-note-in')).fontSize));
      assert(fz >= 16, `the note input is ${fz} px (iOS doesn't zoom at 16 or more)`);
      await a.evaluate(() => { const i = document.querySelector('.rr-note-in'); window.__kd = []; window.addEventListener('keydown', (e) => window.__kd.push([e.key, e.defaultPrevented]), false); i.value = ''; });
      await a.keyboard.type('a b', { delay: 10 }); await a.keyboard.press('Space'); await a.keyboard.press('KeyW'); await a.keyboard.press('ArrowLeft');
      const typed = await a.inputValue('.rr-note-in');
      const kd = await a.evaluate(() => window.__kd);
      assert(typed === 'a b w' && kd.every(([, dp]) => !dp), `typing in the note input reaches the input, with nothing prevented ("${typed}", prevented: ${kd.filter(([, dp]) => dp).length})`);
      await a.fill('.rr-note-in', 'Race you to the bakery <b>after</b> this!! ' + 'x'.repeat(40));
      assert((await a.inputValue('.rr-note-in')).length === 60, 'the input stops at 60 characters');
      await shot(a, 'phone-light-note-input');
      await a.keyboard.press('Enter');
      await until(b, () => (window.__rush.data().a_note || '').startsWith('Race you to the bakery <b>after</b>'), null, 8000, 'Sydney sees the note in the shared data');
      assert((await a.evaluate(() => window.__rush.data().a_note)).length <= 60 && (await a.evaluate(() => window.__rush.state().phase)) === 'lobby', 'saving the note keeps the lobby open and stores at most 60 characters');
      await b.click('.g-rush .rr-note-chip'); await b.fill('.rr-note-in', 'Last one to the bakery pays'); await b.keyboard.press('Enter');
      await until(a, () => (window.__rush.data().b_note || '') === 'Last one to the bakery pays', null, 8000, 'Emerson sees Sydney’s note');

      // Daily twists, one match each: the host's day picks it, both phones agree, the scene follows, the lobby restores it
      const finish = async () => {
        await a.evaluate(() => { window.__rush.auto('a', false); window.__rush.setHearts('a', 1); window.__rush.crash('a'); });
        await b.evaluate(() => { window.__rush.auto('b', false); window.__rush.setHearts('b', 1); window.__rush.crash('b'); });
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 40000, 'twist run ends');
        await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 20000, 'twist run ends (guest)');
      };
      const back = async () => {
        await a.click('#game-root [data-g="rematch"]').catch(() => {});
        await until(a, () => window.__rush && window.__rush.state().phase === 'lobby', null, 20000, 'lobby');
        await until(b, () => window.__rush && window.__rush.state().phase === 'lobby' && window.__rush.state().synced, null, 20000, 'guest lobby');
      };
      const twist = async (m) => {
        await a.evaluate((x) => { window.__RUSH_DEBUG.mod = x; }, m);
        await pickAndStart(h, 'daily');
        await waitRun(a); await waitRun(b);
        const ia = await a.evaluate(() => window.__rush.matchInfo()); const ib = await b.evaluate(() => window.__rush.matchInfo());
        assert(ia.mod === m && ib.mod === m, `twist ${m}: the guest runs the host's twist (${ia.mod} / ${ib.mod})`);
        await a.evaluate(() => window.__rush.auto('a', true)); await b.evaluate(() => window.__rush.auto('b', true));
        return ia;
      };
      const goldChunks = (pg) => pg.evaluate(() => { const t = window.__rush.internals.M.track; const o = []; for (let i = 3; i < 60; i++) if (t.chunk(i).coins.some((c) => c.v === 3)) o.push(i); return o; });
      let baseGold = [];
      // 1 Mirror: the picture flips, left / right swap, the HUD does not
      await twist(1);
      baseGold = await goldChunks(a);
      await a.evaluate(() => window.__rush.auto('a', false));
      await h.wait(300);
      const m1 = await a.evaluate(() => { const l0 = window.__rush.state().a.lane; window.__rush.input('a', 'left'); return { l0, root: document.querySelector('.g-rush').classList.contains('rr-mirror'), tf: getComputedStyle(document.querySelector('.rr-gl')).transform, hud: getComputedStyle(document.querySelector('.rr-hud')).transform }; });
      await h.wait(400);
      const l1 = await a.evaluate(() => window.__rush.state().a.lane);
      assert(m1.root && /matrix\(-1/.test(m1.tf) && m1.hud === 'none', `Mirror: the canvas is flipped (${m1.tf}), the HUD isn't (${m1.hud})`);
      assert(m1.l0 === -1 && l1 === 0, `Mirror: swiping left steers right (lane ${m1.l0} → ${l1}), the sim untouched`);
      await shot(a, 'phone-light-daily-mirror');
      // the finale also shows a found note: grab the envelope on both phones, with the partner's note
      await a.evaluate(() => window.__rush.emit('a', 'pick', 6000000 + 504)); await b.evaluate(() => window.__rush.emit('b', 'pick', 6000000 + 504));
      await until(a, () => !!document.querySelector('.g-rush .rr-lnote.on'), null, 4000, 'the note card shows on pickup');
      await h.wait(300);
      const nc = await a.evaluate(() => { const e = document.querySelector('.g-rush .rr-lnote'); e.style.animationPlayState = 'paused'; return { text: e.querySelector('.rr-lnote-t span').textContent, head: e.querySelector('b').textContent, kids: e.querySelector('.rr-lnote-t span').children.length }; });
      assert(nc.text === 'Last one to the bakery pays' && /Sydney left you a note/.test(nc.head) && nc.kids === 0, `grabbing the envelope pops the partner's note ("${nc.head}": "${nc.text}")`);
      await shot(a, 'phone-light-note-pop');
      const nb = await b.evaluate(() => { const e = document.querySelector('.g-rush .rr-lnote'); return e && e.querySelector('.rr-lnote-t span').textContent; });
      assert(nb && nb.startsWith('Race you to the bakery <b>after</b>') && !(await b.evaluate(() => document.querySelector('.g-rush .rr-lnote b + span b'))), 'Sydney reads Emerson’s note as plain text (the <b> is just characters)');
      await a.evaluate(() => { const e = document.querySelector('.g-rush .rr-lnote'); e.style.animationPlayState = ''; });
      await finish();
      await h.wait(500);
      const line = await a.evaluate(() => (document.querySelector('#game-root .gm-end .rr-you') || {}).textContent || '');
      assert(/You found Sydney’s note/.test(line), `the end card says "You found Sydney’s note" ("${line}")`);
      await back();
      assert(await a.evaluate(() => !document.querySelector('.g-rush').classList.contains('rr-mirror')), 'back in the lobby the picture is un-flipped');
      // 5 Double ladder: a combo payout pays twice
      await twist(5);
      await spyFeedback(a);
      await a.evaluate(() => window.__rush.auto('a', false));
      const b0 = await a.evaluate(() => window.__rush.internals.players.a.r.bonus);
      await a.evaluate(() => window.__rush.emit('a', 'bonus', 10));
      await until(a, () => window.__fb.ladder.some((l) => /\+20 coins/.test(l)), null, 4000, 'the ladder shows the doubled payout');
      const b1 = await a.evaluate(() => window.__rush.internals.players.a.r.bonus);
      assert(b1 - b0 === 10, `Double ladder: a x5 payout of 10 pays 20 (the extra 10 booked: ${b1 - b0})`);
      await finish(); await back();
      // 2 Fog: haze 40-110 m, restored after
      await twist(2);
      const fog = await a.evaluate(() => { const f = window.__rush.internals.world.scene.fog; return [f.near, f.far]; });
      assert(fog[0] === 40 && fog[1] === 110, `Fog: the haze runs ${fog[0]}–${fog[1]} m`);
      await finish(); await back();
      const fog1 = await a.evaluate(() => { const f = window.__rush.internals.world.scene.fog; return [f.near, f.far]; });
      assert(fog1[0] === 62 && fog1[1] === 170, `the lobby gets its own haze back (${fog1})`);
      // 4 Blind coins: nothing past 28 m
      await twist(4);
      await h.wait(1200);
      const bl = await a.evaluate(() => {
        const I = window.__rush.internals; const m = I.world.warmList()[0]; const z = I.players.a.rs.z; const arr = m.instanceMatrix.array; let far = 0;
        for (let i = 0; i < m.count; i++) if (-arr[i * 16 + 14] > z + 28.6) far++;
        return { n: m.count, far, z };
      });
      assert(bl.far === 0 && bl.n > 0, `Blind coins: ${bl.n} coins drawn, none past 28 m (${bl.far})`);
      await finish(); await back();
      // 3 Night: the dark world on a light phone, then the light one back
      await twist(3);
      const nt = await a.evaluate(() => ({ n: window.__rush.internals.world.U.uNight.value, d: window.__rush.extras().night }));
      assert(nt.n === 1 && nt.d, 'Night: the light phone runs in the dark palette');
      await shot(a, 'phone-light-daily-night');
      await finish(); await back();
      assert((await a.evaluate(() => window.__rush.internals.world.U.uNight.value)) === 0, 'the lobby is back to the light palette');
      // 6 Gold rush: the same track, more fool's-gold branches (at least every one of a normal day)
      await twist(6);
      const gold = await goldChunks(a); const goldB = await goldChunks(b);
      assert(gold.length > baseGold.length && baseGold.every((c) => gold.includes(c)) && gold.join() === goldB.join(), `Gold rush: ${gold.length} branches in 57 chunks (a normal day: ${baseGold.length}), identical on both phones`);
      // the finale: dares, stamps, unlocks. Runner a: the stats of a good run, 3 km out (Neon Market), 3 gold branches, a 5th note
      await a.evaluate((d) => {
        const w = window.__rush; const r = w.internals.players.a.r; const wk = w.internals.X.isoWeek(d);
        w.setData({ a_notes_n: 4, ['a_stamps_' + wk + '_n']: 6, ['a_dare_' + d]: 0 });
        r.maxCombo = 9; r.closeCalls = 20; r.coins = 500; r.notes = 1; r.branches = 3; w.setZ('a', 3000);
      }, day);
      await finish(); await h.wait(1800);
      const fd = await a.evaluate((d) => {
        const w = window.__rush; const X = w.internals.X; const ds = w.data();
        const st = { mode: 'daily', dist: 3000, coins: 500, maxCombo: 9, closeCalls: 20, hearts: 0, fin: -1, revives: 0, shoves: 0, uses: 0, notes: 1, branches: 3, beat: false, leads: 0 };
        const idx = X.daresOf(d); let want = 0; idx.forEach((k, i) => { if (![5, 11].includes(k) && X.DARES[k].ok(st)) want |= 1 << i; });
        const known = idx.reduce((m, k, i) => ([5, 11].includes(k) ? m : m | (1 << i)), 0);
        return { bits: ds['a_dare_' + d] | 0, want, known, stamps: ds['a_stamps_' + X.isoWeek(d) + '_n'], notes: ds.a_notes_n, hat4: ds.unlock_a_hat4, trail5: ds.unlock_a_trail5, trail6: ds.unlock_a_trail6, hat5: ds.unlock_a_hat5 };
      }, day);
      assert((fd.bits & fd.known) === fd.want && fd.want > 0, `dares are checked at the finale and saved as a bitmask (${fd.bits}, expected ${fd.want} of ${fd.known})`);
      const pc = (n) => { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; };
      assert(fd.stamps === 6 + pc(fd.bits), `each new dare adds one stamp to this week's counter (${fd.stamps})`);
      assert(fd.notes === 5 && fd.trail6 === 1, 'a fifth note found unlocks Love hearts');
      assert(fd.hat4 === 1 && fd.trail5 === 1, 'reaching the Neon Market unlocks the Lantern hat; 3 gold branches unlock Gold dust');
      assert(fd.hat5 === 1, 'seven stamps in a week unlock the Trophy hat');
      await shot(a, 'phone-light-daily-dares-end');
      const fl = await a.evaluate(() => (document.querySelector('#game-root .gm-end .rr-you') || {}).textContent || '');
      assert(/Dare done: /.test(fl), `the end card celebrates the dares ("${fl}")`);
      // bits only ever get added: finishing again with nothing new keeps them and adds no stamps
      const before = { bits: fd.bits, stamps: fd.stamps };
      await back();
      await pickAndStart(h, 'daily'); await waitRun(a); await finish(); await h.wait(1200);
      const af = await a.evaluate((d) => { const ds = window.__rush.data(); return { bits: ds['a_dare_' + d] | 0, stamps: ds['a_stamps_' + window.__rush.internals.X.isoWeek(d) + '_n'] }; }, day);
      assert((af.bits & before.bits) === before.bits && af.stamps >= before.stamps, `a dare done stays done (${before.bits} → ${af.bits}), stamps only go up (${before.stamps} → ${af.stamps})`);
      // the new hats and trails are worn through the settings and streamed (hat meshes exist for 4 and 5)
      const worn = await a.evaluate(() => { const I = window.__rush.internals; I.players.a.av.setHat(4); const h4 = I.players.a.av.hat; I.players.a.av.setHat(5); const h5 = I.players.a.av.hat; I.players.a.av.setHat(0); return [h4, h5]; });
      assert(worn[0] === 4 && worn[1] === 5, 'the Lantern and Trophy hats are meshes on the head bone');
      h.assertNoErrors();
      assert(!h.warnings.length, `loop: inside the room message budget (${h.warnings.length} warnings)`);
    } catch (e) { console.error(e.message); fails++; await shot(h.a, 'fail-loop-a').catch(() => {}); await shot(h.b, 'fail-loop-b').catch(() => {}); console.error('errors:', h.errors.slice(0, 8)); } finally { await h.close(); }

    // one computer: a note chip per player, a Mirror Daily steers with the keys swapped
    const d = await launch({ port: PORT(11), only: ['rush'], device: 'Desktop Chrome', who: ['a'] });
    try {
      await d.a.setViewportSize({ width: 1280, height: 800 });
      await d.a.evaluate((x) => { window.__RUSH_DEBUG = x; }, { ...DEBUG, mod: 1 });
      await d.startLive(d.a, 'rush', 'local');
      await until(d.a, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().phase === 'lobby', null, 30000, 'split lobby');
      await until(d.a, () => document.querySelectorAll('.g-rush .rr-note-chip').length === 2, null, 4000, 'a note chip for each of them');
      assert(await d.a.evaluate(() => /Note for Sydney/.test(document.querySelectorAll('.g-rush .rr-note-chip')[0].textContent) && /Note for Emerson/.test(document.querySelectorAll('.g-rush .rr-note-chip')[1].textContent)), 'split screen: Emerson writes for Sydney and Sydney for Emerson');
      await shot(d.a, 'desk-light-lobby-dares');
      await d.a.click('.g-rush .rr-mode[data-mode="daily"]');
      await d.a.click('.g-rush .rr-ov-lobby [data-r="go"]');
      await waitRun(d.a);
      await d.a.evaluate(() => { window.__rush.auto('a', false); window.__rush.auto('b', false); });
      const k0 = await d.a.evaluate(() => [window.__rush.state().a.lane, window.__rush.state().b.lane]);
      await d.a.keyboard.press('KeyA'); await d.a.keyboard.press('ArrowRight');
      await d.wait(500);
      const k1 = await d.a.evaluate(() => [window.__rush.state().a.lane, window.__rush.state().b.lane]);
      assert(k0[0] === -1 && k0[1] === 1 && k1[0] === 0 && k1[1] === 0, `split screen Mirror: A (left key) goes right, → (right key) goes left (${k0} → ${k1})`);
      await shot(d.a, 'desk-light-daily-mirror');
      d.assertNoErrors();
    } catch (e) { console.error(e.message); fails++; await shot(d.a, 'fail-loop-desk').catch(() => {}); console.error('errors:', d.errors.slice(0, 8)); } finally { await d.close(); }
  }


  // ═══ rivalry & moments: pops from presence, stripes, neck and neck, districts, events, the last heart,
  //     Together's shared power-ups, the shared end-card lines (two phones, light and dark; then one device) ═══
  if (want('rival')) {
    const names = ['Downtown', 'Harbour', 'Greenway', 'Old Town', 'Neon Market', 'Freight Yard'];
    {
      const u = await rivalUnit();
      assert(u.flick === 0 && u.early === 0, `rivalry: a lead held under 0.6 s (a 0.4 s flicker, 0.5 s) is not a lead change (${u.flick}, ${u.early})`);
      assert(u.pass[0].join() === 'Sydney passed you' && u.pass[1].join() === 'OVERTAKE!' && u.pass[2] === 1, `rivalry: held 0.6 s → "Sydney passed you" for the one passed, OVERTAKE! for the overtaker, 1 counted (${u.pass.join(' / ')})`);
      assert(u.quiet === 1 && u.revenge[0] === 'REVENGE!' && u.revenge[1] === 'Emerson passed you' && u.revenge[2] === 2, `rivalry: a retake inside the 3 s quiet waits for it, then REVENGE! (${u.quiet} pops before 3 s; ${u.revenge.join(' / ')})`);
      assert(u.late === 'OVERTAKE!' && u.m === 4, `rivalry: a retake 15 s later is a plain OVERTAKE!, M.leadChanges counts them (${u.late}, ${u.m})`);
      assert(u.brawl === 0 && u.downed === 0, `rivalry: no pops or counts in Brawl, nor for a pass of a downed runner (${u.brawl}, ${u.downed})`);
      assert(u.neck.join() === 'false,false,true,true,false,0', `rivalry: neck and neck after 3 s under 5 m (not at the start line), held to 8 m, no pop (${u.neck.join()})`);
      assert(u.stripes[0].join() === 'NEW BEST!,Sydney just beat your best,You beat Sydney’s best' && u.stripes[1].join() === 'You beat Emerson’s best,NEW BEST!,Emerson just beat your best', `rivalry: the stripes pop once each on both phones (${u.stripes[0].join(' | ')} / ${u.stripes[1].join(' | ')})`);
      assert(u.beatBest.join() === '1,1,2', `rivalry: crossing the partner's best is a run stat for the dare (${u.beatBest.join()})`);
      assert(u.stripeSub && u.stripeSub[2] === '150 m' && u.teleport === 0, `rivalry: the stripe pop carries the distance (${u.stripeSub && u.stripeSub[2]}); a 170 m jump is not a crossing (${u.teleport})`);
      assert(u.district[0].length === 1 && u.districtName && u.district[1] && u.district[2] === 1, `districts: one tag pop on entering the zone (${u.district[0].join()}), one chime, the music key follows`);
      assert(u.events.join() === 'COIN RUSH!,GOLDEN HUNDRED' && u.ver1 === 0, `events: COIN RUSH! ~2 s before its field and GOLDEN HUNDRED on entering, once each; none on track v1 (${u.events.join()})`);
      assert(u.clutch[0] === 0 && u.clutch[1] === 1 && u.clutch[2] === 2 && u.clutch[3] === 40 && u.clutch[4] === 2 && u.clutch[5] === true, `clutch: +20 once per heart lost after 500 m on the last heart, counted as a stat (${u.clutch.join()})`);
      assert(u.clutchTandem[0] === 0 && u.clutchTandem[1] === false, `clutch: none in Together (${u.clutchTandem.join()})`);
      assert(u.turns[0] === 1 && u.turns[1] === 3, `pops take turns instead of piling up (${u.turns.join(' → ')})`);
      assert(u.shareSent[0] === 1 && u.shareSent[1] === 'b' && u.shareSent[2] === 1 && /shared with Sydney/.test(u.shareSent[3]) && u.shieldSent === 1 && u.raceSent === 0, `share: a magnet picked in Together goes to the partner, a shield and a Race pickup do not (${u.shareSent.join()}, ${u.shieldSent}, ${u.raceSent})`);
      assert(u.shared[0] > 9.8 && u.shared[0] < 10 && u.shared[1] === 10 && u.shared[2] === 8 && u.shared[3].length >= 1, `share: the same duration less the message time (${u.shared.join(' / ')})`);
      assert(/2 lead changes$/.test(u.lead[0]) && u.lead[1] === 2 && u.leadNone === 'Emerson 1,240 m · Sydney 980 m' && u.forfeit === 'z', `end card: "${u.lead[0]}" (lead changes only when there were some, not on a forfeit)`);
      assert(/New team best!$/.test(u.teamUp[0]) && u.teamUp[1] === 1 && u.teamUp[2] === 3500 && /Team best 3,240 m$/.test(u.teamNew[0]) && u.teamNew[1] === 0 && u.teamSaved === 3500 && u.teamPop[0] === 'NEW TEAM BEST!' && /Team best 500 m$/.test(u.teamFirst), `end card: team best "${u.teamUp[0]}" / "${u.teamNew[0]}", saved ${u.teamSaved}, first run "${u.teamFirst}"`);
    }
    for (const scheme of (process.env.RIVAL_SCHEME ? [process.env.RIVAL_SCHEME] : ['light', 'dark'])) {
      const h = await launch({ port: PORT(scheme === 'dark' ? 9 : 8), only: ['rush'], latency: 60, colorScheme: scheme, coarse: true });
      const { a, b } = h;
      const rshot = (pg, name) => shot(pg, `rival-${scheme}-${name}`);
      const has = (pg, re) => pg.evaluate((src) => window.__fb.pops.some((p) => new RegExp(src).test(p)), re.source);
      const count = (pg, re) => pg.evaluate((src) => window.__fb.pops.filter((p) => new RegExp(src).test(p)).length, re.source);
      const waitPop = (pg, re, ms = 20000) => until(pg, (src) => window.__fb.pops.some((p) => new RegExp(src).test(p)), re.source, ms, `pop ${re}`);
      // the pop is on screen (a pop lives 1.1 s and settles after ~0.3 s): screenshot it
      const popShot = async (pg, re, name, seen = []) => {
        await until(pg, ([src, sn]) => { const e = [...document.querySelectorAll('.g-rush .rr-pop')].find((x) => new RegExp(src).test(x.textContent) && !sn.includes(x.textContent) && +getComputedStyle(x).opacity > 0.95); if (e) { window.__ps = e.textContent; e.dataset.shot = '1'; e.style.animationPlayState = 'paused'; document.querySelectorAll('.g-rush .rr-pop:not([data-shot])').forEach((x) => { x.style.visibility = 'hidden'; }); } return !!e; }, [re.source, seen], 20000, `pop on screen ${re}`);
        seen.push(await pg.evaluate(() => window.__ps));
        await rshot(pg, name); // (frozen on its settled frame: a loaded machine takes seconds to shoot)
        await pg.evaluate(() => document.querySelectorAll('.g-rush .rr-pop[data-shot]').forEach((x) => x.remove()));
      };
      const zOf = async (pg, w) => (await S(pg))[w].z;
      const tele = (pg, w, dz) => pg.evaluate(([x, d]) => { const s = window.__rush.state()[x]; window.__rush.setZ(x, s.z + d); }, [w, dz]);
      const ghost = (pg, w) => pg.evaluate((x) => window.__rush.ghost(x, 1e6), w);
      try {
        await openLivePair(h, { raceLen: 45000, seed: 7 });
        // (screenshots: a pop plays three times slower and is frozen when seen, so a loaded machine's polling still catches it)
        for (const pg of [a, b]) {
          await pg.addStyleTag({ content: '.g-rush .rr-pop.go { animation-duration: 3.3s !important; }' });
          await pg.evaluate(() => { const st = window.setTimeout; window.setTimeout = (fn, ms, ...x) => st(fn, ms === 1200 ? 30000 : ms, ...x); });
        }
        // ── Race: stripes at 75 m (Emerson) and 110 m (Sydney), then passes, neck and neck, districts, events ──
        await a.evaluate(() => window.__rush.setData({ a_race_m: 75, b_race_m: 110 }));
        await until(b, () => window.__rush.data().b_race_m === 110, null, 8000, 'guest sees the bests');
        await pickAndStart(h, 'race');
        await waitRun(a); await waitRun(b);
        await spyFeedback(a); await spyFeedback(b);
        await ghost(a, 'a'); await ghost(b, 'b');
        await h.wait(300);
        // the stripes: crossing my own best, their best, and them crossing mine: a pop on both phones, one each
        const stripes = async (pg, tag) => { const seen = []; for (let i = 0; i < 3; i++) await popShot(pg, /NEW BEST|just beat|You beat/, `stripe-${tag}${i}`, seen).catch(() => {}); };
        await Promise.all([stripes(a, 'a'), stripes(b, 'b')]);
        await waitPop(a, /^a:NEW BEST!$/, 30000); await waitPop(b, /^b:NEW BEST!$/, 30000);
        await waitPop(a, /^a:Sydney just beat your best$/, 30000); await waitPop(b, /^b:Emerson just beat your best$/, 30000);
        await waitPop(a, /^a:You beat Sydney’s best$/, 30000); await waitPop(b, /^b:You beat Emerson’s best$/, 30000);
        assert((await count(a, /^a:NEW BEST!$/)) === 1 && (await count(a, /just beat your best/)) === 1 && (await count(b, /^b:You beat/)) === 1, 'each best stripe pops once per phone');
        assert((await a.evaluate(() => window.__fb.play.sting || 0)) >= 2, 'the stripes sting');
        await h.wait(1500);
        // OVERTAKE!: a flicker of the lead (200 ms) is nothing; a held lead of 4 m or more for 0.6 s is a change
        await tele(a, 'a', 14);
        // (the lead settles on both phones: if they happened to be a few metres apart already, that was a change, counted by `base`)
        await until(a, () => { const r = window.__rush.rivalry().a; return r.lead === 1 && r.candT === 0; }, null, 30000, 'Emerson leads on her phone');
        await until(b, () => { const r = window.__rush.rivalry().b; return r.lead === -1 && r.candT === 0; }, null, 30000, 'Emerson leads on his phone');
        await h.wait(3500); // (past the 3 s of quiet)
        const base = (await a.evaluate(() => window.__rush.rivalry())).changes;
        const n0 = { pass: await count(a, /^a:Sydney passed you$/), over: await count(b, /^b:(OVERTAKE|REVENGE)!$/), rev: await count(a, /^a:REVENGE!$/) };
        await tele(b, 'b', 45);
        await until(a, (n) => window.__fb.pops.filter((p) => p === 'a:Sydney passed you').length > n, n0.pass, 25000, 'Sydney passed you');
        await until(b, (n) => window.__fb.pops.filter((p) => /^b:(OVERTAKE|REVENGE)!$/.test(p)).length > n, n0.over, 25000, 'OVERTAKE! (or REVENGE!, if Emerson had just passed him)').catch(async (e) => {
          const dbg = async (pg) => pg.evaluate(() => { const r = window.__rush.rivalry(); const f = (x) => ({ lead: x.lead, cand: x.cand, candT: +x.candT.toFixed(2), lastAt: +x.lastAt.toFixed(1), q: x.q.length, free: +x.free.toFixed(1) }); return { T: +r.T.toFixed(1), changes: r.changes, a: f(r.a), b: f(r.b), pops: window.__fb.pops.slice(-8) }; });
          console.log('   rivalry a:', JSON.stringify(await dbg(a)), '\n   rivalry b:', JSON.stringify(await dbg(b)));
          throw e;
        });
        await Promise.all([popShot(a, /passed you/, 'passed'), popShot(b, /OVERTAKE|REVENGE/, 'overtake')]);
        // taken back at once: held through the 3 s of quiet, then REVENGE! (they passed me within 10 s) and "took it back"
        await tele(a, 'a', 90);
        await until(a, (n) => window.__fb.pops.filter((p) => p === 'a:REVENGE!').length > n, n0.rev, 30000, 'REVENGE!');
        await Promise.all([popShot(a, /REVENGE/, 'revenge'), popShot(b, /passed you/, 'revenge-theirs')]);
        assert((await count(a, /^a:Sydney passed you$/)) === n0.pass + 1 && (await count(b, /^b:(OVERTAKE|REVENGE)!$/)) === n0.over + 1 && (await count(a, /^a:REVENGE!$/)) === n0.rev + 1, 'one pop per lead change on each phone');
        const rl = await a.evaluate(() => window.__rush.rivalry());
        assert(rl.changes === base + 2, `the host counted the 2 lead changes (${base} + 2 = ${rl.changes})`);
        // neck and neck: closer than 5 m for 3 s pulses the gap pill, and it lets go once they pull 8 m apart
        await b.evaluate(() => { const s = window.__rush.state().a; window.__rush.setZ('b', s.z - 0.5); });
        await until(a, () => { const g = document.querySelector('.g-rush .rr-gap'); return g && g.classList.contains('neck') && /^Neck and neck/.test(g.textContent); }, null, 25000, 'the gap pill pulses neck and neck');
        await until(b, () => { const g = document.querySelector('.g-rush .rr-gap'); return g && g.classList.contains('neck'); }, null, 6000, 'and on the other phone');
        await rshot(a, 'neck');
        assert((await a.$eval('.g-rush .rr-gap span', (e) => { const r = e.getBoundingClientRect(); return r.height; })) > 14, 'the pill is readable');
        await tele(b, 'b', 30);
        await until(a, () => !document.querySelector('.g-rush .rr-gap').classList.contains('neck'), null, 20000, 'the pulse stops when they pull apart');
        // districts: the next zone start (chunks 3, 7, 11… = 300 m + 400 m × n): a small tag pop and a chime
        for (const [pg, w] of [[a, 'a'], [b, 'b']]) {
          await pg.evaluate((x) => { const s = window.__rush.state()[x]; const nz = 300 + 400 * Math.ceil((s.z + 30 - 300) / 400); window.__rush.setZ(x, nz - 10); }, w);
        }
        await waitPop(a, new RegExp(`^a:(${names.join('|')})$`)); await waitPop(b, new RegExp(`^b:(${names.join('|')})$`));
        await popShot(a, new RegExp(names.join('|')), 'district');
        assert((await a.evaluate(() => document.querySelectorAll('.g-rush .rr-pop.tag').length)) >= 0 && (await a.evaluate(() => window.__fb.play.district || 0)) >= 1, 'a district name pops as a tag with a chime');
        // events (track v2): Coin Rush ~2 s before its field, Golden Hundred on entering its chunk
        const ev = await a.evaluate(() => {
          const M = window.__rush.internals.M; const out = { v: M.track.ver, rush: null, hund: null };
          for (let i = 30; i < 400 && !(out.rush && out.hund); i++) { const c = M.track.chunk(i); if (c.event === 1 && !out.rush) out.rush = { z: c.eventZ }; if (c.event === 2 && !out.hund) out.hund = { z: c.z0 }; }
          return out;
        });
        assert(ev.v >= 2, `the match runs track v${ev.v}`);
        if (ev.rush) {
          await a.evaluate((z) => window.__rush.setZ('a', z - 75), ev.rush.z);
          await waitPop(a, /^a:COIN RUSH!$/, 12000);
          await popShot(a, /COIN RUSH/, 'coin-rush');
        } else console.log('   (no Coin Rush on this seed in 400 chunks)');
        if (ev.hund) {
          await a.evaluate((z) => window.__rush.setZ('a', z - 18), ev.hund.z);
          await waitPop(a, /^a:GOLDEN HUNDRED$/, 12000);
          await popShot(a, /GOLDEN/, 'golden-hundred');
        } else console.log('   (no Golden Hundred on this seed in 400 chunks)');
        assert(ev.rush || ev.hund, 'the seed has at least one event chunk');
        // the shared end card: finish; the host's lead-change count is in the text both phones show
        await h.wait(1200);
        const hostChanges = (await a.evaluate(() => window.__rush.rivalry())).changes;
        await a.evaluate(() => { const s = window.__rush.state().a; window.__rush.setZ('a', 44992); });
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 30000, 'race ends on the host');
        await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 15000, 'race ends on the guest');
        const cardSub = (pg) => pg.$eval('#game-root .gm-end', (e) => [...e.querySelectorAll('.gm-end-sub:not(.rr-you)')].map((x) => x.textContent).join(' | '));
        const sa = await cardSub(a); const sb = await cardSub(b);
        assert(sa === sb && new RegExp(`${hostChanges} lead changes?`).test(sa), `the shared end-card line is the same on both phones and counts the lead changes: "${sa}"`);
        await rshot(a, 'end-lead-changes');
        await checkFeedback(a, 'rivalry race (host)'); await checkFeedback(b, 'rivalry race (guest)');

        // ── Daily: the last heart (heartbeat + ring), CLUTCH! once per heart lost ──
        await a.click('#game-root [data-g="rematch"]').catch(() => {});
        await until(a, () => window.__rush && window.__rush.state().phase === 'lobby', null, 15000, 'lobby for daily');
        await until(b, () => window.__rush && window.__rush.state().phase === 'lobby' && window.__rush.state().synced, null, 15000, 'guest lobby for daily');
        await pickAndStart(h, 'daily');
        await waitRun(a); await waitRun(b);
        await spyFeedback(a); await spyFeedback(b);
        await a.evaluate(() => { const au = window.__rush.internals.audio; const f = au.setHeart; window.__heart = []; au.setHeart = function (x) { if (window.__heart[window.__heart.length - 1] !== x) window.__heart.push(x); return f.call(this, x); }; });
        await ghost(a, 'a'); await ghost(b, 'b');
        await h.wait(500);
        await a.evaluate(() => window.__rush.setHearts('a', 1));
        await until(a, () => !!document.querySelector('.g-rush .rr-hearts.last'), null, 4000, 'the hearts ring pulses at one heart');
        assert(await a.evaluate(() => window.__heart[window.__heart.length - 1] === true), 'the heartbeat is on at one heart');
        const c0 = (await S(a)).a.coins;
        await h.wait(400);
        await tele(a, 'a', 520);
        await waitPop(a, /^a:CLUTCH!$/, 8000);
        await popShot(a, /CLUTCH/, 'clutch');
        const c1 = (await S(a)).a.coins;
        assert(c1 - c0 >= 20, `CLUTCH! pays 20 coins onto the coin count (${c0} → ${c1})`);
        await rshot(a, 'clutch-ring');
        await tele(a, 'a', 700); await h.wait(1500);
        assert((await count(a, /^a:CLUTCH!$/)) === 1, 'CLUTCH! once per heart lost, however far you run');
        await a.evaluate(() => window.__rush.setHearts('a', 2));
        await h.wait(500);
        assert(!(await a.evaluate(() => !!document.querySelector('.g-rush .rr-hearts.last'))), 'the ring stops once a heart is back');
        await a.evaluate(() => window.__rush.setHearts('a', 1));
        await h.wait(500); await tele(a, 'a', 520);
        await until(a, () => window.__rush.state().a.stats.clutch >= 2, null, 8000, 'a second clutch after losing another heart');
        assert((await S(a)).a.stats.clutch === 2 && (await S(b)).b.stats.clutch === 0, 'stat clutch counted per runner');
        await checkFeedback(a, 'clutch (host)');
        // both out of hearts: the Daily ends
        await a.evaluate(() => { window.__rush.ghost('a', 0); window.__rush.setHearts('a', 1); window.__rush.crash('a'); });
        await b.evaluate(() => { window.__rush.ghost('b', 0); window.__rush.setHearts('b', 1); window.__rush.crash('b'); });
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 25000, 'daily ends');
        await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 15000, 'daily ends for the guest');
        assert(await a.evaluate(() => window.__heart[window.__heart.length - 1] === false), 'the heartbeat stops when the run is over');

        // ── Together: shared power-ups, no clutch, the team best ──
        await a.click('#game-root [data-g="rematch"]').catch(() => {});
        await until(a, () => window.__rush && window.__rush.state().phase === 'lobby', null, 15000, 'lobby for together');
        await until(b, () => window.__rush && window.__rush.state().phase === 'lobby' && window.__rush.state().synced, null, 15000, 'guest lobby for together');
        await a.evaluate(() => window.__rush.setData({ team_best_m: 40 }));
        await until(b, () => window.__rush.data().team_best_m === 40, null, 8000, 'guest sees the team best');
        await pickAndStart(h, 'tandem');
        await waitRun(a); await waitRun(b);
        await spyFeedback(a); await spyFeedback(b);
        await ghost(a, 'a'); await ghost(b, 'b');
        await h.wait(500);
        const pw = (pg, w, f) => pg.evaluate(([x, k]) => window.__rush.internals.players[x].r[k], [w, f]);
        // a magnet picked by Emerson runs on Sydney's phone for the same duration; so do sneakers and a doubler
        await a.evaluate(() => { window.__rush.give('a', 'magnet'); window.__rush.emit('a', 'pick', 1000000); });
        await until(a, () => [...document.querySelectorAll('.g-rush .rr-pop small')].some((e) => /shared with Sydney/.test(e.textContent)), null, 6000, 'the picker is told it was shared');
        await until(b, () => window.__rush.internals.players.b.r.magnetT > 6, null, 6000, 'Sydney gets Emerson’s magnet');
        await waitPop(b, /^b:Emerson shared a MAGNET$/);
        await popShot(b, /shared a MAGNET/, 'share-magnet');
        await a.evaluate(() => { window.__rush.give('a', 'sneakers'); window.__rush.emit('a', 'pick', 2000000); });
        await until(b, () => window.__rush.internals.players.b.r.sneakersT > 6, null, 6000, 'Sydney gets Emerson’s sneakers');
        await a.evaluate(() => { window.__rush.give('a', 'double'); window.__rush.emit('a', 'pick', 7000000); });
        await until(b, () => window.__rush.internals.players.b.r.dblT > 4, null, 6000, 'Sydney gets Emerson’s doubler');
        await until(b, () => !!document.querySelector('.g-rush .rr-pw[data-pw="double"]:not([hidden])'), null, 4000, 'the doubler ring shows in the power-up row');
        await h.wait(300);
        await rshot(b, 'share-powerups');
        await b.evaluate(() => { window.__rush.give('b', 'magnet'); window.__rush.emit('b', 'pick', 1000000); });
        await until(a, () => window.__rush.internals.players.a.r.magnetT > 6, null, 6000, 'and the other way round');
        const sh0 = await b.evaluate(() => window.__rush.internals.players.b.r.shield);
        await a.evaluate(() => window.__rush.emit('a', 'pick', 3000000)); // a shield is not shared
        await h.wait(800);
        assert((await pw(b, 'b', 'shield')) === sh0 && !(await has(b, /shared a SHIELD/)), 'a shield stays with whoever picked it');
        // Together has no last-heart clutch
        await a.evaluate(() => window.__rush.setHearts('a', 1));
        await h.wait(400); await tele(a, 'a', 520); await h.wait(1200);
        assert(!(await has(a, /CLUTCH/)) && !(await a.evaluate(() => !!document.querySelector('.g-rush .rr-hearts.last'))), 'no clutch ring or pop in Together');
        // team best: a run past the old best (40 m) is "New team best!", on both phones' card and as a pop
        await tele(a, 'a', 300);
        await a.evaluate(() => window.__rush.teamHearts(0));
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 25000, 'together ends');
        await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 15000, 'together ends for the guest');
        const ta = await cardSub(a); const tb = await cardSub(b);
        assert(ta === tb && /New team best!/.test(ta), `the end card says "New team best!" on both phones: "${ta}"`);
        await waitPop(a, /NEW TEAM BEST!/, 5000); await waitPop(b, /NEW TEAM BEST!/, 5000);
        const rt = await S(a);
        assert((await a.evaluate(() => window.__rush.data().team_best_m)) === rt.result.m && rt.result.m > 40, `team_best_m went up to ${rt.result.m} m`);
        await rshot(a, 'team-best');
        await h.wait(500);
        // a lower run shows the best to beat
        await a.click('#game-root [data-g="rematch"]').catch(() => {});
        await until(a, () => window.__rush && window.__rush.state().phase === 'lobby', null, 15000, 'lobby for the second together');
        await until(b, () => window.__rush && window.__rush.state().phase === 'lobby' && window.__rush.state().synced, null, 15000, 'guest lobby for the second together');
        await pickAndStart(h, 'tandem');
        await waitRun(a); await waitRun(b);
        await a.evaluate(() => window.__rush.teamHearts(0));
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 25000, 'second together ends');
        await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 15000, 'second together ends for the guest');
        const ua = await cardSub(a); const ub = await cardSub(b);
        assert(ua === ub && /Team best [\d,]+ m/.test(ua) && !/New team best/.test(ua), `a shorter run shows the team best to beat: "${ua}"`);
        await rshot(a, 'team-best-old');
        h.assertNoErrors();
        assert(!h.warnings.length, `rivalry (${scheme}): inside the room message budget (${h.warnings.length} warnings)`);
      } catch (e) {
        console.error(e.message); fails++;
        await shot(h.a, `fail-rival-${scheme}-a`).catch(() => {}); await shot(h.b, `fail-rival-${scheme}-b`).catch(() => {});
        console.error('errors:', h.errors.slice(0, 8));
      } finally { await h.close(); }
    }

    // one device: each pop goes to the right half; Brawl has no overtakes; both halves get their own district
    {
      const d = await launch({ port: PORT(10), only: ['rush'], device: 'Desktop Chrome', who: ['a'] });
      const { a } = d;
      try {
        await a.setViewportSize({ width: 1280, height: 800 });
        await a.evaluate((x) => { window.__RUSH_DEBUG = x; }, { ...DEBUG, raceLen: 45000, seed: 7 });
        await d.startLive(a, 'rush', 'local');
        await until(a, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().phase === 'lobby', null, 30000, 'rival split lobby');
        const spyAll = () => spyFeedback(a);
        const pops = () => a.evaluate(() => window.__fb.pops.slice());
        const reach = async () => {
          await a.evaluate(() => { window.__rush.ghost('a', 1e6); window.__rush.ghost('b', 1e6); window.__rush.auto('a', false); window.__rush.auto('b', false); });
        };
        await a.click('.g-rush .rr-mode[data-mode="race"]');
        await a.click('.g-rush .rr-ov-lobby [data-r="go"]');
        await waitRun(a); await spyAll(); await reach();
        await a.evaluate(() => { window.__sd = new Set(); const w = window.__rush.internals.world; const f = w.setDistrictAt; w.setDistrictAt = function (s, z) { window.__sd.add(Math.round(z / 50)); return f.call(this, s, z); }; });
        await d.wait(1500);
        await a.evaluate(() => { const s = window.__rush.state(); window.__rush.setZ('a', s.a.z + 14); });
        await d.wait(1000);
        await a.evaluate(() => { const s = window.__rush.state(); window.__rush.setZ('b', s.b.z + 45); });
        await until(a, () => window.__fb.pops.includes('b:OVERTAKE!') && window.__fb.pops.includes('a:Sydney passed you'), null, 20000, 'overtake pops go to the right halves');
        const p1 = await pops();
        assert(!p1.includes('a:OVERTAKE!') && !p1.includes('b:Emerson passed you'), 'and not to the other half');
        assert((await a.evaluate(() => window.__rush.rivalry())).changes === 1, 'one lead change counted for one device, not two');
        // districts per half: Emerson only gets the next zone's name
        await a.evaluate(() => { const s = window.__rush.state(); const nz = 300 + 400 * Math.ceil((s.a.z + 30 - 300) / 400); window.__rush.setZ('a', nz - 10); });
        await until(a, (re) => window.__fb.pops.some((p) => new RegExp(re).test(p)), `^a:(${names.join('|')})$`, 8000, 'Emerson gets her district name');
        assert(!(await pops()).some((p) => new RegExp(`^b:(${names.join('|')})$`).test(p)), 'Sydney (still on her stretch) does not');
        assert((await a.evaluate(() => window.__sd.size)) >= 2, 'each half sets its own district sky (setDistrictAt per view)');
        // Together on one device: the power-up goes to the other runner
        await a.evaluate(() => { window.__rush.give('a', 'magnet'); window.__rush.emit('a', 'pick', 1000000); });
        // (Race: no share) ...
        await d.wait(600);
        assert(!(await a.evaluate(() => window.__rush.internals.players.b.r.magnetT > 1)), 'a Race pickup is not shared');
        d.assertNoErrors();
      } catch (e) { console.error(e.message); fails++; await shot(a, 'fail-rival-split').catch(() => {}); console.error('errors:', d.errors.slice(0, 8)); } finally { await d.close(); }
    }
    {
      const d = await launch({ port: PORT(11), only: ['rush'], device: 'Desktop Chrome', who: ['a'] });
      const { a } = d;
      try {
        await a.setViewportSize({ width: 1280, height: 800 });
        await a.evaluate((x) => { window.__RUSH_DEBUG = x; }, { ...DEBUG, raceLen: 45000, seed: 7 });
        await d.startLive(a, 'rush', 'local');
        await until(a, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().phase === 'lobby', null, 30000, 'brawl split lobby');
        await a.click('.g-rush .rr-mode[data-mode="brawl"]');
        await a.click('.g-rush .rr-ov-lobby [data-r="go"]');
        await waitRun(a); await spyFeedback(a);
        await a.evaluate(() => { window.__rush.ghost('a', 1e6); window.__rush.ghost('b', 1e6); });
        await d.wait(1500);
        await a.evaluate(() => { const s = window.__rush.state(); window.__rush.setZ('a', s.a.z + 14); });
        await d.wait(900);
        await a.evaluate(() => { const s = window.__rush.state(); window.__rush.setZ('b', s.b.z + 45); });
        await d.wait(2500);
        const bp = await a.evaluate(() => window.__fb.pops.filter((p) => /OVERTAKE|REVENGE|passed you/.test(p)));
        assert(bp.length === 0, `Brawl has no overtake pops (side by side they mean nothing): ${bp.join(', ') || 'none'}`);
        await a.click('.g-rush .rr-pause').catch(() => {});
        d.assertNoErrors();
      } catch (e) { console.error(e.message); fails++; await shot(a, 'fail-rival-brawl').catch(() => {}); console.error('errors:', d.errors.slice(0, 8)); } finally { await d.close(); }
    }
    {
      // Together on one device: the shared power-up reaches the other runner
      const d = await launch({ port: PORT(12), only: ['rush'], device: 'Desktop Chrome', who: ['a'] });
      const { a } = d;
      try {
        await a.setViewportSize({ width: 1280, height: 800 });
        await a.evaluate((x) => { window.__RUSH_DEBUG = x; }, { ...DEBUG, seed: 7 });
        await d.startLive(a, 'rush', 'local');
        await until(a, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().phase === 'lobby', null, 30000, 'together split lobby');
        await a.click('.g-rush .rr-mode[data-mode="tandem"]');
        await a.click('.g-rush .rr-ov-lobby [data-r="go"]');
        await waitRun(a);
        await a.evaluate(() => { window.__rush.ghost('a', 1e6); window.__rush.ghost('b', 1e6); window.__rush.give('b', 'sneakers'); window.__rush.emit('b', 'pick', 2000000); });
        await until(a, () => window.__rush.internals.players.a.r.sneakersT > 6, null, 6000, 'one device: Sydney’s sneakers reach Emerson');
        d.assertNoErrors();
      } catch (e) { console.error(e.message); fails++; await shot(a, 'fail-rival-tsplit').catch(() => {}); console.error('errors:', d.errors.slice(0, 8)); } finally { await d.close(); }
    }
  }

  if (fails) { console.log(`\n${fails} FAILED`); process.exitCode = 1; } else console.log('\nALL GOOD');
})();
