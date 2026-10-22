// Blend & Seek (chameleon): surface transitions (floor / wall / ceiling / edges), smooth and controllable.
//   node tools/test/games/chameleon-crawl.test.js                  (all sections)
//   ONLY=sweep,box,thin PORT=9400 node tools/test/games/chameleon-crawl.test.js
//   MAPS=living,house   sweep maps
//
// Node-only sections (no browser; they use the engine's own move.js / world.js through crawl-sim.mjs, which
// builds each map's colliders like chameleon-maps.test.js and drives a body over every climbable face with a
// constant stick, a model of the hider's orbit camera and the drawn-pose layer):
//   sweep   every climbable face of the small maps and the House × 6 stick directions × 4 camera yaws, 5 s each.
//           Counts what a player sees go wrong: drawn-body jumps (> 2 × a walking step), face flip-flops,
//           dead stops (≥ 0.25 s blocked with the stick held), the largest drawn turn in one frame.
//           Before this pass (same maps, same runs; Living Room): 31 655 drawn jumps, 29 980 flip-flops,
//           718 dead stops, 0.28 m / 42° largest drawn move / turn per frame. After: ≤ 2 / 6 / 80 / 0.10 m / 22°.
//   box     floor → wall → top → far wall → floor with the stick held straight up: one pass, no flip-flop.
//   thin    a table top 3 cm … 15 cm thick, approached straight and diagonally: the body wraps its edge (it
//           used to stop dead on ≤ 4 cm tops), and a corner doesn't ping-pong.
//   slide   a wall approached at a grazing angle is slid along, not stopped at.
//   lock    the input-frame lock: after a corner the body keeps its heading whatever the screen mapping says,
//           steers with the stick, hands over after a 40°+ turn, drops on release.
//   fps     the same crawl at 30, 60 and 120 Hz ends on the same face (fixed pieces of ≤ 1/60 s).
//   vis     the drawn-pose layer: continuity through a jump, no lag on a steady walk, springs frame-rate exact.
// Browser section:
//   browser the real joystick (CDP touch) on a phone profile: hold up from the floor into a wall, up it, over the
//           rafter; and across the coffee table's convex edge. Per-frame drawn body and camera motion, progress.
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '../../..');
const PORT = Number(process.env.PORT) || 9400;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const MAPS = (process.env.MAPS || 'living,garden,studio,candy,house').split(',');
let failures = 0;
const assert = (c, m) => { if (!c) { failures++; console.log('FAIL -', m); return false; } console.log('ok -', m); return true; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const colBox = (x0, x1, y0, y1, z0, z1, name = 'box') => ({ minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1, name });
const arena = (cols) => ({ colliders: [...cols, colBox(-8, 8, 0, 3, -8.2, -8, 'back')], bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 } });

async function nodeSections() {
  const sim = await imp('tools/test/games/crawl-sim.mjs');
  const mods = await sim.loadMods();
  const { move, world: W } = mods;

  // ── sweep ──
  if (want('sweep')) {
    console.log('\n# sweep: every climbable face × stick directions × camera yaws (hider orbit camera model, 60 Hz)');
    for (const id of MAPS) {
      const map = await sim.loadMap(id);
      const t0 = Date.now();
      const a = sim.sweepMap(mods, map, { maxBoxes: id === 'house' ? 80 : 120 });
      console.log(`  ${id}: ${a.starts} starts, ${a.runs} runs, ${a.frames} frames (${Date.now() - t0} ms): transfers ${a.res1 + a.res2} (concave ${a.res1}, convex ${a.res2}), blocked frames ${a.blocked}, dead stops ${a.deadStops}, flip-flops ${a.flips}, drawn jumps ${a.drawnJumps}, max drawn move ${a.maxDrawnJump.toFixed(3)} m/frame, feet ${a.maxDrawnFeetJump.toFixed(3)}, max drawn turn ${(a.maxDrawnTurn * 57.3).toFixed(0)}°/frame, max sim contact jump ${a.maxContactJump.toFixed(2)} m, drawn feet ≥ 4 cm in a prop ${a.burrow} frames`);
      const big = id === 'house';
      assert(a.flips <= 10, `${id}: no face flip-flop (${a.flips} in ${a.runs} runs; before: tens of thousands)`);
      assert(a.drawnJumps <= (big ? a.frames * 0.001 : 5), `${id}: the drawn body never jumps (${a.drawnJumps} frames with a move > 2 × the step; before ${big ? '81 330' : 'up to 50 000'})`);
      assert(a.maxDrawnJump <= (big ? 0.25 : 0.12), `${id}: largest drawn move in a 60 Hz frame ${a.maxDrawnJump.toFixed(3)} m (≤ ${big ? 0.25 : 0.12}; before 0.28-0.31 m)`);
      assert(a.maxDrawnTurn <= 0.5, `${id}: largest drawn turn in a 60 Hz frame ${(a.maxDrawnTurn * 57.3).toFixed(0)}° (≤ 29°; before 42°)`);
      assert(a.deadStops <= a.runs * 0.25, `${id}: dead stops with the stick held ${a.deadStops} of ${a.runs} runs (≤ 25 %; before 40-60 %: ${id === 'living' ? '718 of 1164' : id === 'candy' ? '524 of 1116' : 'about half'}; what's left is the map edge and pockets the body doesn't fit)`);
      assert(a.blocked <= a.frames * 0.3, `${id}: blocked frames ${a.blocked} of ${a.frames} (≤ 30 %; before 46-58 %; a held stick that wraps a thin plank waits for the wrap pause, move.js/world.js WRAP_T)`);
    }
  }

  // ── box ──
  if (want('box')) {
    console.log('\n# box: floor → front wall → top → far wall → floor, stick held straight up (camera behind)');
    for (const [h, w, d] of [[0.6, 1, 1], [1.0, 1.2, 0.8], [0.3, 1, 1], [0.6, 0.12, 1], [0.25, 0.5, 0.5]]) {
      const map = arena([colBox(-w / 2, w / 2, 0, h, -d / 2, d / 2)]);
      const tr = [];
      const m = sim.runCrawl(mods, map, { x: 0, y: 0, z: 2.5, nx: 0, ny: 1, nz: 0, box: null }, { stick: [0, 1], yaw: 0, T: 8, trace: tr });
      const zs = tr.filter((r) => typeof r[0] === 'number' && r[1] === 0).map((r) => r[4]);
      let back = 0; for (let i = 1; i < zs.length; i++) if (zs[i] > zs[i - 1] + 0.02) back++;
      const tag = `box ${w}×${d}×${h}`;
      console.log(`  ${tag}: transfers ${m.res1 + m.res2}, released ${m.released}, flip-flops ${m.flips}, reversals ${m.reversals}, drawn jumps ${m.drawnJumps}, done at ${m.t.toFixed(2)} s`);
      assert(m.released === 1 && m.flips === 0 && m.blocked === 0, `${tag}: crosses it in one pass (released onto the floor beyond, ${m.res1 + m.res2} transfers, ${m.flips} flip-flops; before: 200 transfers, never got over)`);
      assert(back === 0 && m.drawnJumps === 0, `${tag}: never goes backwards (${back} backward steps), the drawn body never jumps (${m.drawnJumps})`);
    }
  }

  // ── thin ──
  if (want('thin')) {
    console.log('\n# thin: tops 3-15 cm thick: the edge wraps (no drop, no dead stop); a corner does not ping-pong');
    for (const th of [0.03, 0.05, 0.08, 0.15]) {
      const world = W.createWorld(arena([colBox(-1, 1, 0.7 - th, 0.7, -1, 1, 'top')]));
      for (const ang of [0, 0.5, 1.0]) {
        const b = move.mkBody();
        move.attachBody(world, b, 0, 0.7, 0, 0, 1, 0, null, Math.cos(ang), 0, Math.sin(ang));
        const dir = [Math.cos(ang), 0, Math.sin(ang)]; let blocked = 0; let released = 0; let flips = 0; let last = ''; let prev = '';
        for (let i = 0; i < 240; i++) {
          const r = move.crawlSteps(world, b, null, dir[0] * 2.34, 0, dir[2] * 2.34, 1 / 60);
          if (r === 3) blocked++; if (r === 4) { released++; break; }
          const k = `${b.nx},${b.ny},${b.nz}`;
          if (k !== last) { if (k === prev) flips++; prev = last; last = k; }
        }
        const tag = `${(th * 100).toFixed(0)} cm top, ${(ang * 57.3).toFixed(0)}° approach`;
        if (ang === 0) assert(blocked === 0 && released === 0 && last !== '0,1,0', `${tag}: wraps the edge onto the side (${last}), not stopped (blocked ${blocked}), not dropped`);
        else assert(flips <= 12, `${tag}: a diagonal push at the corner does not ping-pong (${flips} face flips in 4 s; before ~75)`);
      }
    }
  }

  // ── slide ──
  if (want('slide')) {
    console.log('\n# slide: a wall met at a grazing angle is slid along');
    const world = W.createWorld(arena([colBox(-2, 2, 0, 2, -3, -2.5, 'wall')]));
    for (const deg of [20, 35, 50, 65]) {
      const a = (deg * Math.PI) / 180;
      const b = move.mkBody(); move.attachBody(world, b, -1.5, 0, -1.5, 0, 1, 0, null, 1, 0, 0);
      // heading mostly along +x with a component into the wall (-z): `deg` off the wall's plane
      const vx = Math.cos(a) * 2.34; const vz = -Math.sin(a) * 2.34;
      let blocked = 0; const x0 = b.x; let climbed = false;
      for (let i = 0; i < 90; i++) { const r = move.crawlSteps(world, b, null, vx, 0, vz, 1 / 60); if (r === 3) blocked++; if (Math.abs(b.ny) < 0.7) climbed = true; }
      const along = b.x - x0;
      assert(climbed || along > 0.5 * Math.cos(a) * 2.34 * 1.5 * 0.5, `${deg}° to the wall: ${climbed ? 'climbs onto it' : `slides along it (${along.toFixed(2)} m of ${(Math.cos(a) * 2.34 * 1.5).toFixed(2)} m, ${blocked} blocked steps)`}`);
    }
  }

  // ── lock ──
  if (want('lock')) {
    console.log('\n# lock: the input-frame lock (surfaceVel / crawlSteps)');
    const world = W.createWorld(arena([colBox(-1, 1, 0, 1.2, -1, 1, 'box')]));
    const fs = move.mkFrameState();
    const out = [0, 0, 0];
    // a screen mapping that always says "toward +z" (a camera swinging round as the body turns a corner)
    const projFlip = (x, y, z, o) => { o[0] = x * 0.3; o[1] = -z * 0.3; return true; };
    const F = [0, 0, -1]; const R = [1, 0, 0];
    const b = move.mkBody(); move.attachBody(world, b, 0, 0, 2, 0, 1, 0, null, 0, 0, -1); // on the floor facing -z, box ahead
    let hit = false; let h0 = null;
    for (let i = 0; i < 90 && !hit; i++) {
      move.surfaceVel(b, fs, 0, 1, projFlip, F, R, 1 / 60, out);
      const r = move.crawlSteps(world, b, fs, out[0] * 2.34, out[1] * 2.34, out[2] * 2.34, 1 / 60);
      if (r === 1) { hit = true; h0 = [b.nx, b.ny, b.nz]; }
    }
    assert(hit && h0[2] > 0.9, `the floor turns into the box's front wall (normal ${h0 && h0.map((x) => x.toFixed(1))}) with the stick held`);
    assert(fs.lock, 'the transfer starts the input-frame lock');
    // the screen mapping now disagrees completely (projects "up" backwards): the locked body still goes up the wall
    const projRev = (x, y, z, o) => { o[0] = -x * 0.3; o[1] = -y * 0.3; return true; };
    let y1 = b.y;
    for (let i = 0; i < 20; i++) { move.surfaceVel(b, fs, 0, 1, projRev, F, R, 1 / 60, out); move.crawlSteps(world, b, fs, out[0] * 2.34, out[1] * 2.34, out[2] * 2.34, 1 / 60); }
    assert(b.y > y1 + 0.3, `locked: keeps climbing though the screen mapping now points down (y ${y1.toFixed(2)} → ${b.y.toFixed(2)})`);
    // a 25° turn of the stick steers; a 90° one hands over to the screen mapping after ~0.2 s; release drops the lock
    const lk = (mx, my) => { move.surfaceVel(b, fs, mx, my, projRev, F, R, 1 / 60, out); return [out[0], out[1], out[2]]; };
    const v25 = lk(Math.sin(0.44), Math.cos(0.44));
    assert(fs.lock && Math.abs(v25[1]) > 0.7 && Math.abs(v25[0]) + Math.abs(v25[2]) > 0.2, `a 25° turn of the stick steers the heading (still locked, v ${v25.map((x) => x.toFixed(2))})`);
    for (let i = 0; i < 30; i++) lk(1, 0);
    assert(!fs.lock, 'a 90° turn of the stick hands over to the screen mapping (lock dropped within 0.5 s)');
    // new lock then release
    move.attachBody(world, b, 0, 0, 2, 0, 1, 0, null, 0, 0, -1);
    for (let i = 0; i < 90; i++) { move.surfaceVel(b, fs, 0, 1, projFlip, F, R, 1 / 60, out); if (move.crawlSteps(world, b, fs, out[0] * 2.34, out[1] * 2.34, out[2] * 2.34, 1 / 60) === 1) break; }
    assert(fs.lock, 'locked again after another transfer');
    move.surfaceVel(b, fs, 0, 0, projRev, F, R, 1 / 60, out);
    assert(!fs.lock, 'releasing the stick drops the lock');
  }

  // ── fps ──
  if (want('fps')) {
    console.log('\n# fps: the same crawl at 30 / 60 / 120 Hz');
    const map = await sim.loadMap('living');
    const world = W.createWorld({ colliders: map.colliders, bounds: map.bounds });
    const starts = sim.startPoints(world, map.colliders, { maxBoxes: 60, perFace: 1, seed: 5 });
    const last = {};
    for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
      last[dt] = starts.map((st, i) => { const tr = []; sim.runCrawl(mods, map, st, { stick: [0, 1], yaw: [0, 1.6, 3.1, 4.7][i % 4], dt, T: 1.5, world, trace: tr }); return tr.filter((r) => typeof r[0] === 'number').pop(); });
    }
    for (const dt of [1 / 30, 1 / 120]) {
      let same = 0; let near = 0; let n = 0;
      last[1 / 60].forEach((r, i) => { const o = last[dt][i]; if (!r || !o) return; n++; if (r.slice(5, 8).join() === o.slice(5, 8).join()) same++; if (Math.hypot(r[2] - o[2], r[3] - o[3], r[4] - o[4]) < 0.15) near++; });
      assert(same >= n * 0.93 && near >= n * 0.9, `${dt > 0.02 ? '30' : '120'} Hz vs 60 Hz after 1.5 s: ${same}/${n} on the same face, ${near}/${n} within 15 cm (before: ~60 % / 77-89 %)`);
    }
  }

  // ── vis ──
  if (want('vis')) {
    console.log('\n# vis: the drawn pose');
    // springs: exact for any dt
    const o = [0, 0];
    let x = 1; let v = 0; for (let i = 0; i < 12; i++) { move.spring1(x, v, 0, 0.2, 1 / 60, o); x = o[0]; v = o[1]; }
    let x2 = 1; let v2 = 0; for (let i = 0; i < 6; i++) { move.spring1(x2, v2, 0, 0.2, 1 / 30, o); x2 = o[0]; v2 = o[1]; }
    assert(Math.abs(x - x2) < 1e-9 && Math.abs(v - v2) < 1e-9, 'the critically damped spring gives the same curve at 30 and 60 Hz');
    // a steady walk has no lag (drawn = sim)
    const vs = move.mkVis(); const b = move.mkBody(); b.speed = 2.4;
    let lag = 0;
    for (let i = 0; i < 120; i++) { b.x += 2.4 / 60; move.visUpdate(vs, b, 1 / 60); lag = Math.max(lag, Math.abs(vs.fx - b.x)); }
    assert(lag < 1e-6, `a steady walk is drawn exactly where it is (lag ${lag.toExponential(1)} m)`);
    // a 0.25 m sim jump + a 90° turn (a concave transfer): the drawn pose continues from where it was and settles
    const q0 = [0, 0, 0, 1]; move.bodyQuat(b, q0);
    move.attachBody(world0(W), b, b.x + 0.4, 0.4, b.z, -1, 0, 0, null, 0, 1, 0); b.speed = 2.4;
    const prev = [vs.cx, vs.cy, vs.cz]; const steps = [];
    let upPrev = [vs.ux, vs.uy, vs.uz]; let maxTurn = 0; let first = 0;
    for (let i = 0; i < 40; i++) {
      move.visUpdate(vs, b, 1 / 60);
      const d = Math.hypot(vs.cx - prev[0], vs.cy - prev[1], vs.cz - prev[2]); steps.push(d); if (i === 0) first = d;
      prev[0] = vs.cx; prev[1] = vs.cy; prev[2] = vs.cz;
      const turn = Math.acos(Math.max(-1, Math.min(1, vs.ux * upPrev[0] + vs.uy * upPrev[1] + vs.uz * upPrev[2]))); maxTurn = Math.max(maxTurn, turn); upPrev = [vs.ux, vs.uy, vs.uz];
    }
    const err = Math.hypot(vs.cx - (b.x + b.nx * vs.h), vs.cy - (b.y + b.ny * vs.h), vs.cz - (b.z + b.nz * vs.h));
    assert(first < 0.06, `the first frame after a transfer moves the drawn centre ${first.toFixed(3)} m (the sim jumped ~0.3 m)`);
    assert(maxTurn < 0.35, `the drawn up vector turns ≤ ${(maxTurn * 57.3).toFixed(0)}° per 60 Hz frame (90° in one sim step)`);
    assert(err < 0.01 && Math.abs(vs.ux - b.nx) < 0.02, `and it has settled on the sim pose within 0.67 s (centre error ${err.toFixed(3)} m)`);
    // teleports snap
    move.visSnap(vs); b.x += 5; move.visUpdate(vs, b, 1 / 60);
    assert(Math.abs(vs.fx - b.x) < 1e-6, 'a snapped pose is the sim pose at once');
    // a jump beyond 1.2 m snaps by itself
    b.x += 3; move.visUpdate(vs, b, 1 / 60);
    assert(Math.abs(vs.fx - b.x) < 1e-6, 'a 3 m jump is a teleport, no glide');
  }
}
const world0 = (W) => W.createWorld({ colliders: [], bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 } });

// ─────────────────────────────────────────────────────────────────────
// browser: the real joystick
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const angDeg = (a, b) => { const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / ((len(a) || 1) * (len(b) || 1)); return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI; };
const q = (arr, f) => { if (!arr.length) return 0; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; };

class Stick {
  constructor(cdp, page) { this.cdp = cdp; this.page = page; this.down = false; this.id = 7; }
  async origin() { const v = await this.page.evaluate(() => { const r = document.querySelector('.chm-surface').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }); this.x0 = v[0] + 70; this.y0 = v[1] + v[3] - 170; }
  async set(sx, sy) {
    const x = this.x0 + sx * 50; const y = this.y0 - sy * 50;
    if (!this.down) { await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: this.x0, y: this.y0, id: this.id }] }); this.down = true; }
    if (sx || sy) await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: this.id }] });
  }
  async release() { if (!this.down) return; await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); this.down = false; }
}

const SAMPLER = () => {
  if (window.__cs) return;
  const X = window.__cs = { rows: [], on: false };
  const tick = (t) => {
    requestAnimationFrame(tick);
    if (!X.on || !window.__cham) return;
    const H = window.__cham; const s = H.state(); const c = H.camera(); const v = s.viewer || 'b'; const d = s.drawn && s.drawn[v]; const b = s.bodies[v];
    if (!d) return;
    X.rows.push([t, d.p, d.up, c.p, c.dir, [b.x, b.y, b.z], b.at ? [b.nx, b.ny, b.nz] : [0, 1, 0], b.at ? 1 : 0]);
  };
  requestAnimationFrame(tick);
};

/** Speeds of the drawn body (root) and the camera between rendered frames (m/s, deg/s; a frame is at least 20 ms for the division). */
function analyse(rows) {
  const F = [];
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1]; const r = rows[i]; const dt = Math.max(0.02, Math.min(0.1, (r[0] - p[0]) / 1000));
    F.push({ dt, body: len(sub(r[1], p[1])) / dt, bodyTurn: angDeg(r[2], p[2]) / dt, cam: len(sub(r[3], p[3])) / dt, camTurn: angDeg(r[4], p[4]) / dt, sim: len(sub(r[5], p[5])) / dt });
  }
  const mx = (key) => Math.max(0, ...F.map((f) => f[key]));
  return { frames: F.length, F, maxBody: mx('body'), maxBodyTurn: mx('bodyTurn'), maxCam: mx('cam'), maxCamTurn: mx('camTurn'), maxSim: mx('sim'), p99Cam: q(F.map((f) => f.cam), 0.99), p99CamTurn: q(F.map((f) => f.camTurn), 0.99) };
}
const kindOf = (n, at) => (!at ? 'floor' : n[1] > 0.7 ? 'top' : n[1] < -0.7 ? 'ceiling' : 'wall');

async function browserSection() {
  const { launch } = require('../harness');
  console.log('\n# browser: the real joystick (CDP touch) on a phone profile, living room, hider, large size');
  const TUNE = { hide: 600000, seek: 600000, title: 700, recap: 2500, found: 2200, final: 3000, seekLead: 900, resume: 1500, maxDpr: 0.25, noTips: true, fixedScale: true };
  const h = await launch({ port: PORT, only: ['chameleon'], who: ['a'], coarse: true });
  const a = h.a;
  const hook = (fn, ...args) => a.evaluate(([f, ar]) => window.__cham[f](...ar), [fn, args]);
  try {
    const cdp = await a.context().newCDPSession(a);
    await a.evaluate((t) => { window.__chamTest = true; window.__chamTune = t; }, TUNE);
    await h.startLive(a, 'chameleon', 'local');
    await a.waitForFunction(() => window.__cham && window.__cham.ready, null, { timeout: 60000 });
    await hook('setRules', { map: 'living', first: 'b', rules: { size: 'large', climb: true } });
    await a.waitForFunction(() => window.__cham.state().mapId === 'living', null, { timeout: 90000 });
    await a.click('[data-act="start"]');
    await a.waitForFunction(() => window.__cham.state().phase.name === 'curtain', null, { timeout: 40000 });
    await a.click('[data-act="curtain"]');
    await a.waitForFunction(() => window.__cham.state().phase.name === 'hide', null, { timeout: 40000 });
    await wait(600);
    await a.evaluate(SAMPLER);
    const stick = new Stick(cdp, a);

    const settle = async () => { let prev = null; let still = 0; for (let i = 0; i < 40 && still < 3; i++) { await wait(150); const c = await hook('camera'); if (prev && len(sub(c.p, prev.p)) < 0.02 && angDeg(c.dir, prev.dir) < 0.5) still++; else still = 0; prev = c; } };

    /** Hold (sx, sy) until done(body) or maxMs; returns the analysed rows and the surface kinds visited. */
    const hold = async (name, sx, sy, done, maxMs) => {
      await stick.origin();
      await a.evaluate(() => { window.__cs.rows = []; window.__cs.on = true; });
      const t0 = Date.now(); const kinds = []; let stallMs = 0; let lastP = null; let lastT = Date.now(); let maxStall = 0; let ok = false;
      await stick.set(sx, sy);
      while (Date.now() - t0 < maxMs) {
        await wait(80);
        const b = await hook('body');
        const k = kindOf([b.nx, b.ny, b.nz], b.at); if (kinds[kinds.length - 1] !== k) kinds.push(k);
        const p = [b.x, b.y, b.z];
        if (!lastP || len(sub(p, lastP)) > 0.06) { lastP = p; lastT = Date.now(); } else maxStall = Math.max(maxStall, Date.now() - lastT);
        if (done(b, kinds)) { ok = true; break; }
      }
      await stick.release();
      await wait(250);
      const rows = await a.evaluate(() => { window.__cs.on = false; const r = window.__cs.rows; window.__cs.rows = []; return r; });
      const m = analyse(rows);
      if (process.env.DUMP) require('fs').writeFileSync(`${process.env.DUMP}.${name.split(' ')[0]}.json`, JSON.stringify(rows));
      console.log(`  ${name}: ${ok ? 'done' : 'timeout'} in ${((Date.now() - t0) / 1000).toFixed(1)} s, surfaces ${kinds.join(' → ')}, ${m.frames} frames; speeds: drawn body max ${m.maxBody.toFixed(1)} m/s (sim contact max ${m.maxSim.toFixed(1)}), body turn max ${m.maxBodyTurn.toFixed(0)}°/s, camera max ${m.maxCam.toFixed(1)} m/s (p99 ${m.p99Cam.toFixed(1)}), camera turn max ${m.maxCamTurn.toFixed(0)}°/s (p99 ${m.p99CamTurn.toFixed(0)}); longest stall ${maxStall} ms`);
      return { ok, kinds, m, maxStall };
    };
    const BASE = !!process.env.BASE; // numbers only (a run against the tree before this pass)
    const A = (c, msg) => { if (BASE) console.log((c ? 'ok' : 'would fail') + ' -', msg); else assert(c, msg); };

    // 1. floor → wall → ceiling (the left wall under the rafter): hold up the whole way
    await hook('teleport', -3.4, 1.2, -Math.PI / 2, 0);
    await hook('setCam', Math.PI / 2, 0.25, 2.3);
    await settle();
    let tCeil = 0;
    const r1 = await hold('floor → wall → ceiling, stick held up', 0, 1, (b) => { if (b.at && b.ny < -0.9) { tCeil = tCeil || Date.now(); return Date.now() - tCeil > 900; } return false; }, 8000);
    const r1b = r1;
    A(r1b.kinds.includes('wall') && r1b.kinds.includes('ceiling'), `holding up walks floor → wall → ceiling (${r1b.kinds.join(' → ')})`);
    A(r1b.m.maxBody < 7.5, `the drawn body never jumps (${r1b.m.maxBody.toFixed(1)} m/s at most while the sim contact hopped at ${r1b.m.maxSim.toFixed(1)} m/s; walking is ~2.5)`);
    A(r1b.m.maxBodyTurn < 900, `the drawn body never snaps round (${r1b.m.maxBodyTurn.toFixed(0)}°/s at most)`);
    A(r1b.m.maxCam < 14, `the camera doesn't pop (${r1b.m.maxCam.toFixed(1)} m/s at most, p99 ${r1b.m.p99Cam.toFixed(1)}; xfeel on the same route: 19 m/s before)`);
    A(r1b.m.maxCamTurn < 300, `the camera doesn't snap round (${r1b.m.maxCamTurn.toFixed(0)}°/s at most)`);
    A(r1b.maxStall < 700, `holding one direction keeps making progress (longest stall ${r1b.maxStall} ms)`);

    // 2. the coffee table's convex edge: onto its top, over the +x edge, down the side to the floor
    await hook('teleport', -2.0, -1.25, Math.PI / 2, 0);
    await hook('attachAt', -0.9, 0.5, -1.25, 0, 1, 0, 1, 0, 0);
    await hook('setCam', -Math.PI / 2, 0.25, 2.3);
    await settle();
    const r2 = await hold('table top → convex edge → side → floor, stick held up', 0, 1, (b, k) => k.includes('floor') && k.length >= 3, 9000);
    A(r2.kinds.includes('wall') || r2.kinds.includes('floor'), `walks off the table edge and down its side (${r2.kinds.join(' → ')})`);
    // (the coffee table top is a 3.6 cm plank: a held stick rolls the body round it, top / side / underside / side / top, a 180° flip every ~1 s)
    A(r2.m.maxBody < 7.5 && r2.m.maxBodyTurn < 1500, `edge: the drawn body never jumps (${r2.m.maxBody.toFixed(1)} m/s) and its flips round the plank are glides (${r2.m.maxBodyTurn.toFixed(0)}°/s at most)`);
    A(r2.m.maxCam < 30 && r2.m.maxCamTurn < 600, `edge: the camera doesn't pop or snap (${r2.m.maxCam.toFixed(1)} m/s, ${r2.m.maxCamTurn.toFixed(0)}°/s at most; a pull-in of 2.8 m used to be one frame)`);
    A(r2.maxStall < 700, `edge: holding one direction keeps making progress (longest stall ${r2.maxStall} ms)`);

    // 3. the stick itself: a dead zone and the Stick-by-walking-into-a-wall flow still work
    await hook('teleport', -3.4, 1.2, -Math.PI / 2, 0);
    await hook('setCam', Math.PI / 2, 0.25, 2.3);
    await settle();
    await stick.origin();
    const b0 = await hook('body');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x0, y: stick.y0, id: 9 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: stick.x0, y: stick.y0 - 4, id: 9 }] }); // 4 px = 8 % of the radius
    await wait(500);
    const b1 = await hook('body');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    A(Math.hypot(b1.x - b0.x, b1.z - b0.z) < 0.02, `a 4 px thumb tremor is inside the dead zone (moved ${Math.hypot(b1.x - b0.x, b1.z - b0.z).toFixed(3)} m)`);
    await stick.origin();
    await stick.set(0, 1); await wait(900); await stick.release();
    const b2 = await hook('body');
    A(b2.at && b2.nx > 0.9, `walking into the wall with the stick up still sticks to it (normal ${[b2.nx, b2.ny, b2.nz].map((x) => x.toFixed(1))})`);
    // floating base: drag the thumb 96 px sideways; the stick's base follows it (it never has to be re-found)
    await hook('teleport', -3.4, 1.2, -Math.PI / 2, 0);
    await wait(300);
    await stick.origin();
    const joyX = () => a.evaluate(() => { const m = /translate\((-?[\d.]+)px/.exec(document.querySelector('.chm-joy').style.transform || ''); return m ? Number(m[1]) : null; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x0, y: stick.y0, id: 9 }] });
    const jx0 = await joyX();
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: stick.x0 + i * 12, y: stick.y0, id: 9 }] });
    await wait(200);
    const jx1 = await joyX();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    A(jx0 != null && jx1 != null && jx1 - jx0 > 20, `the floating base follows a thumb that drifts far (base x ${jx0} → ${jx1} px after a 96 px drag; it stays put inside 1.3 radii)`);
  } finally {
    await h.close();
  }
}

(async () => {
  if (['sweep', 'box', 'thin', 'slide', 'lock', 'fps', 'vis'].some(want)) await nodeSections();
  if (want('browser')) await browserSection();
  console.log(failures ? `\n${failures} check(s) failed` : '\nALL GOOD');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
