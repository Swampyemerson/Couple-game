// Blend & Seek: headless crawl simulator (Node, no browser). Builds a map's colliders the way
// chameleon-maps.test.js does (fake atlas + fake THREE), then drives a sticky-feet body over every
// climbable box face with a constant stick input through the engine's own move.js / world.js, a
// model of the hider's orbit camera (world-up, screen-relative stick mapping through the camera
// the player sees) and the drawn-pose layer, and counts what the player would see go wrong:
// jumps, blocked steps while the stick is held, face flip-flops, reversed transfers, stalls.
//   import { loadMods, loadMap, runCrawl, sweepMap } from './crawl-sim.mjs'
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../../..');
const CH = path.join(ROOT, 'js/games/chameleon');

export const FAKE_THREE = (() => {
  class Attr { constructor(a, n) { this.array = a; this.itemSize = n; this.count = a.length / n; } }
  class Geo { setAttribute(k, a) { this[k] = a; } setIndex(i) { this.index = Array.isArray(i) ? new Attr(i, 1) : i; } computeBoundingSphere() {} computeBoundingBox() {} dispose() {} }
  return { BufferGeometry: Geo, Float32BufferAttribute: Attr, BufferAttribute: Attr };
})();

/** Modules from a directory (default: the game's own); `dir` may hold older copies of move.js + world.js. */
export async function loadMods(dir = CH) {
  const imp = (f) => import(pathToFileURL(path.join(dir, f)).href);
  const [move, world] = await Promise.all([imp('move.js'), imp('world.js')]);
  return { move, world };
}

const mapCache = new Map();
/** { colliders, bounds, entry } for a map id (built once). */
export async function loadMap(id) {
  if (mapCache.has(id)) return mapCache.get(id);
  const imp = (f) => import(pathToFileURL(path.join(CH, f)).href);
  const [maps, geo] = await Promise.all([imp('maps.js'), imp('geo.js')]);
  const entry = maps.MAPS.find((m) => m.id === id);
  if (!entry) throw new Error('no map ' + id);
  const tiles = new Proxy({}, { get: () => [0, 0, 0.1, 0.1] });
  const fill = entry.build({ add() {}, finish() { return { tiles }; } }, maps.KIT);
  const b = geo.createBuilder({ tiles, ink: [0, 0, 0] });
  maps.runFill(fill, b);
  const out = b.finish(FAKE_THREE);
  maps.closeSlots(out.colliders);
  const res = { colliders: out.colliders, bounds: maps.boundsOf(out.colliders, entry.info || {}), entry };
  mapCache.set(id, res);
  return res;
}

// ── tiny vector / quaternion helpers (no allocation in the hot loop beyond the shared scratch) ──
const qd = [0, 0, 0, 1]; const qs = [0, 0, 0, 1];
function qAngle(a, b) { const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]); return 2 * Math.acos(Math.min(1, d)); }
function qSlerpTo(a, b, k) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; const s = d < 0 ? -1 : 1; d *= s;
  let w0; let w1;
  if (d > 0.9995) { w0 = 1 - k; w1 = k * s; } else { const th = Math.acos(d); const sn = Math.sin(th); w0 = Math.sin((1 - k) * th) / sn; w1 = (Math.sin(k * th) / sn) * s; }
  a[0] = a[0] * w0 + b[0] * w1; a[1] = a[1] * w0 + b[1] * w1; a[2] = a[2] * w0 + b[2] * w1; a[3] = a[3] * w0 + b[3] * w1;
  const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1; a[0] /= l; a[1] /= l; a[2] /= l; a[3] /= l;
}
const upOf = (q, o) => { o[0] = 2 * (q[0] * q[1] - q[3] * q[2]); o[1] = 1 - 2 * (q[0] * q[0] + q[2] * q[2]); o[2] = 2 * (q[1] * q[2] + q[3] * q[0]); return o; };

/** The hider's third-person camera as a pinhole (portrait phone): look-at basis + projection. */
function mkCamModel() { return { px: 0, py: 3, pz: 3, lx: 0, ly: 0, lz: 0, fx: 0, fy: 0, fz: -1, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, tan: Math.tan((70 * Math.PI) / 360), init: false }; }
function camBasis(c) {
  let fx = c.lx - c.px; let fy = c.ly - c.py; let fz = c.lz - c.pz; const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  // right = f × up(0,1,0)
  let rx = fy * 0 - fz * 1; let ry = fz * 0 - fx * 0; let rz = fx * 1 - fy * 0;
  const rl = Math.hypot(rx, ry, rz);
  if (rl < 1e-6) { rx = 1; ry = 0; rz = 0; } else { rx /= rl; ry /= rl; rz /= rl; }
  c.fx = fx; c.fy = fy; c.fz = fz; c.rx = rx; c.ry = ry; c.rz = rz;
  c.ux = ry * fz - rz * fy; c.uy = rz * fx - rx * fz; c.uz = rx * fy - ry * fx;
}
function camProj(c, x, y, z, out) {
  const dx = x - c.px; const dy = y - c.py; const dz = z - c.pz;
  const zv = dx * c.fx + dy * c.fy + dz * c.fz;
  if (zv < 0.02) return false;
  const t = zv * c.tan;
  out[0] = (dx * c.rx + dy * c.ry + dz * c.rz) / t; out[1] = (dx * c.ux + dy * c.uy + dz * c.uz) / t;
  return true;
}

/** Start contacts for a sweep: face centres (+ offsets) of every climbable box, filtered to ones the body fits. */
export function startPoints(world, colliders, { size = 1, maxBoxes = 160, perFace = 2, seed = 7 } = {}) {
  const r = 0.24 * size; const out = [];
  let s = seed; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const bxs = colliders.filter((b) => b.climb !== false && Math.min(b.maxX - b.minX, b.maxZ - b.minZ, b.maxY - b.minY) >= 0.05 && Math.max(b.maxX - b.minX, b.maxZ - b.minZ) >= 0.3 && b.maxY < 30);
  const pick = bxs.length > maxBoxes ? bxs.filter(() => rnd() < maxBoxes / bxs.length) : bxs;
  const clear = 0.27;
  for (const b of pick) {
    const faces = [[0, 1, 0, b.maxY], [-1, 0, 0, b.minX], [1, 0, 0, b.maxX], [0, 0, -1, b.minZ], [0, 0, 1, b.maxZ]];
    if (b.ceil || b.minY > 1) faces.push([0, -1, 0, b.minY]);
    for (const [nx, ny, nz, c] of faces) {
      for (let k = 0; k < perFace; k++) {
        const u = k === 0 ? 0.5 : 0.2 + 0.6 * rnd(); const v = k === 0 ? 0.5 : 0.2 + 0.6 * rnd();
        let x; let y; let z;
        if (ny) { x = b.minX + (b.maxX - b.minX) * u; z = b.minZ + (b.maxZ - b.minZ) * v; y = c; }
        else if (nx) { x = c; z = b.minZ + (b.maxZ - b.minZ) * u; y = b.minY + Math.max(0.05, (b.maxY - b.minY)) * (0.15 + 0.7 * v); }
        else { z = c; x = b.minX + (b.maxX - b.minX) * u; y = b.minY + Math.max(0.05, (b.maxY - b.minY)) * (0.15 + 0.7 * v); }
        if (y < 0.001 && !ny) continue;
        if (!world.inside(x, z)) continue;
        if (world.buried(x, y, z, nx, ny, nz) || world.guarded(x, y, z, nx, ny, nz, clear) || !world.clearOf(x, y, z, nx, ny, nz, r)) continue;
        out.push({ x, y, z, nx, ny, nz, box: b });
      }
    }
  }
  return out;
}

const SURF = [0, 0, 0]; const PA = [0, 0]; const PB = [0, 0];
const H_C = 0.2; // drawn-centre height above the feet (× size)

/**
 * One run: a body on `start`, constant stick (mx,my), camera yaw `yaw`, T seconds at frame time dt
 * (jitter: ± fraction random), returns the metric record. mods: loadMods().
 */
export function runCrawl(mods, map, start, opts = {}) {
  const { move, world: W } = mods;
  const { stick = [0, 1], yaw = 0, dt = 1 / 60, T = 6, jitter = 0, size = 1, speed = 2.34, seed = 1, release = false, maxXfer = 0 } = opts;
  let xfers = 0; let endAt = Infinity;
  const world = opts.world || W.createWorld({ colliders: map.colliders, bounds: map.bounds });
  const b = move.mkBody(); move.sizeBody(b, size);
  const newPath = typeof move.crawlFrame === 'function';
  const hasVis = typeof move.visUpdate === 'function';
  const hasSpring = typeof move.spring3Step === 'function';
  b.pose = 'wall';
  move.attachBody(world, b, start.x, start.y, start.z, start.nx, start.ny, start.nz, start.box, ...(Math.abs(start.ny) < 0.7 ? [0, 1, 0] : [Math.sin(yaw + Math.PI), 0, Math.cos(yaw + Math.PI)]));
  const fs = newPath ? move.mkFrameState() : null;
  const vs = hasVis ? move.mkVis() : null;
  const cam = mkCamModel();
  const sp3 = hasSpring ? move.mkSpring3() : null;
  const hh = H_C * size;
  let s = seed * 9301 + 49297; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const M = { frames: 0, t: 0, res1: 0, res2: 0, res3: 0, res4: 0, blocked: 0, steers: 0, unslid: 0, deadStops: 0, maxDead: 0, screenRev: 0, contactJumps: 0, maxContactJump: 0, drawnJumps: 0, maxDrawnJump: 0, maxDrawnTurn: 0, maxDrawnFeetJump: 0, flips: 0, maxBurrow: 0, reversals: 0, stalls: 0, camJumps: 0, maxCamJump: 0, maxCamTurn: 0, path: 0, simPath: 0, released: 0, dirFlips: 0, maxSimTurn: 0, burrow: 0 };
  const q = [0, 0, 0, 1]; const up = [0, 1, 0];
  const camLook = [0, 0, 0];
  const centreOf = (o) => { o[0] = b.x + b.nx * hh; o[1] = b.y + b.ny * hh; o[2] = b.z + b.nz * hh; };
  const pc = [0, 0, 0]; centreOf(pc);
  // the drawn pose starts on the sim pose
  move.bodyQuat(b, q); qd[0] = q[0]; qd[1] = q[1]; qd[2] = q[2]; qd[3] = q[3];
  if (vs) move.visUpdate(vs, b, 1 / 60);
  const dc = [pc[0], pc[1], pc[2]]; let prevDc = [pc[0], pc[1], pc[2]]; let prevFeet = [b.x, b.y, b.z];
  let prevCam = null; let prevCamDir = null;
  // camera on the body at the start (no whip-in)
  const setCamWant = (cen, out) => {
    const dist = 2.3 * (0.55 + 0.45 * size); const pitch = 0.32; const cp = Math.cos(pitch);
    const yawC = yaw;
    const lx = cen[0]; const ly = cen[1] + (b.at ? 0.05 : 0.14) * size; const lz = cen[2];
    let wx = lx + Math.sin(yawC) * cp * dist; let wy = ly + Math.sin(pitch) * dist; let wz = lz + Math.cos(yawC) * cp * dist;
    if (b.at) {
      let ux = wx - lx; let uy = wy - ly; let uz = wz - lz;
      const k = ux * b.nx + uy * b.ny + uz * b.nz; const lim = 0.3 * dist;
      if (k < lim) { ux += b.nx * (lim - k); uy += b.ny * (lim - k); uz += b.nz * (lim - k); const l = Math.hypot(ux, uy, uz) || 1; wx = lx + (ux / l) * dist; wy = ly + (uy / l) * dist; wz = lz + (uz / l) * dist; }
    }
    // sphere-cast from the body centre (pull in at once)
    const ddx = wx - cen[0]; const ddy = wy - cen[1]; const ddz = wz - cen[2]; const L = Math.hypot(ddx, ddy, ddz) || 1;
    const h = world.sweep(cen[0], cen[1], cen[2], ddx / L, ddy / L, ddz / L, L, 0.12, (bb) => bb.climb !== false, true);
    const reach = h ? Math.max(0.4, h.t - 0.01) : L;
    out[0] = cen[0] + (ddx / L) * reach; out[1] = cen[1] + (ddy / L) * reach; out[2] = cen[2] + (ddz / L) * reach;
    out[3] = lx; out[4] = ly; out[5] = lz;
  };
  const cw = [0, 0, 0, 0, 0, 0];
  const pivotCentre = [0, 0, 0];
  const getCamCentre = () => { if (vs) { pivotCentre[0] = vs.cx; pivotCentre[1] = vs.cy; pivotCentre[2] = vs.cz; } else centreOf(pivotCentre); return pivotCentre; };
  setCamWant(getCamCentre(), cw);
  cam.px = cw[0]; cam.py = cw[1]; cam.pz = cw[2]; cam.lx = cw[3]; cam.ly = cw[4]; cam.lz = cw[5]; camBasis(cam);
  if (sp3) move.spring3Snap(sp3, cw[3], cw[4], cw[5]);
  let camOff = null;
  let deadRun = 0; let deadCounted = false;
  let lastFaceKey = ''; const faceHist = []; // [t, key]
  let lastDir = null;
  let simQ = [q[0], q[1], q[2], q[3]];
  const winPos = []; // for the stall check
  let mx = stick[0]; let my = stick[1]; let turns = 0; // (steer: a player stuck for 0.5 s turns the stick a quarter turn; steers counts those)
  const stickMag = Math.min(1, Math.hypot(mx, my));
  for (let t = 0; t < Math.min(T, endAt);) {
    const ddt = Math.min(0.1, dt * (1 + jitter * (rnd() * 2 - 1)));
    t += ddt; M.t = t; M.frames++;
    // 1. sim: stick → screen-relative world velocity → crawl
    const sx = b.x; const sy = b.y; const sz = b.z; const snx = b.nx; const sny = b.ny; const snz = b.nz;
    camBasis(cam);
    const F = [cam.fx, cam.fy, cam.fz]; const R = [Math.cos(yaw), 0, -Math.sin(yaw)];
    let res;
    const proj = (x, y, z, o) => camProj(cam, x, y, z, o);
    if (newPath) {
      res = move.crawlFrame(world, b, fs, mx, my, proj, F, R, speed, ddt, SURF);
    } else {
      move.inputOnSurface(b, mx, my, proj, F, R, SURF);
      res = move.crawlStep(world, b, SURF[0] * speed, SURF[1] * speed, SURF[2] * speed, ddt);
    }
    const expected = speed * stickMag * ddt;
    if (opts.trace) opts.trace.push([+t.toFixed(3), res, +b.x.toFixed(3), +b.y.toFixed(3), +b.z.toFixed(3), b.nx, b.ny, b.nz, +SURF[0].toFixed(2), +SURF[1].toFixed(2), +SURF[2].toFixed(2)]);
    const dContact = Math.hypot(b.x - sx, b.y - sy, b.z - sz);
    if (res === 1) M.res1++; else if (res === 2) M.res2++; else if (res === 3) { M.res3++; if (stickMag > 0.3) M.blocked++; } else if (res === 4) M.res4++;
    if (res === 3 && stickMag > 0.3) {
      // would turning the stick a little have moved the body? (a stop that a slide should have avoided)
      const sdl = Math.hypot(SURF[0], SURF[1], SURF[2]);
      if (sdl > 0.1) {
        let slid = false;
        for (const ang of [0.35, -0.35]) {
          const cs = Math.cos(ang); const sn = Math.sin(ang);
          const c = { ...b, x: sx, y: sy, z: sz, nx: snx, ny: sny, nz: snz };
          const ax = SURF[0] / sdl; const ay = SURF[1] / sdl; const az = SURF[2] / sdl;
          const kx = sny * az - snz * ay; const ky = snz * ax - snx * az; const kz = snx * ay - sny * ax; // n × d
          const wx = ax * cs + kx * sn; const wy = ay * cs + ky * sn; const wz = az * cs + kz * sn;
          const r2 = move.crawlStep(world, c, wx * speed, wy * speed, wz * speed, ddt);
          if (r2 !== 3 && Math.hypot(c.x - sx, c.y - sy, c.z - sz) > 0.5 * speed * ddt) { slid = true; break; }
        }
        if (slid) M.unslid++;
      }
    }
    if (res === 3 && stickMag > 0.3) { deadRun += ddt; if (deadRun > M.maxDead) M.maxDead = deadRun; if (deadRun > 0.25 && !deadCounted) { M.deadStops++; deadCounted = true; } if (opts.steer && deadRun > 0.5) { const a = (turns++ % 2 ? -1 : 1) * Math.PI / 2; const c = Math.cos(a); const sn = Math.sin(a); const nx2 = mx * c - my * sn; my = mx * sn + my * c; mx = nx2; M.steers++; deadRun = 0; } } else { deadRun = 0; deadCounted = false; }
    if ((res === 1 || res === 2) && maxXfer && ++xfers >= maxXfer && endAt === Infinity) endAt = t + 0.6;
    if (res === 1 || res === 2 || res === 4) {
      // a transfer's own jump is geometry (≤ one body radius); more than that is a teleport
      if (dContact > 2 * expected + 0.02) { M.contactJumps++; }
      if (dContact > M.maxContactJump) M.maxContactJump = dContact;
      // face flip-flop and reversals
      const key = (b.box ? boxId(map, b.box) : 'g') + ':' + b.nx + ',' + b.ny + ',' + b.nz;
      faceHist.push([t, key]);
      const n = faceHist.length;
      if (n >= 3 && faceHist[n - 1][1] === faceHist[n - 3][1] && t - faceHist[n - 3][0] < 0.6) M.flips++;
      lastFaceKey = key;
      // reversal: after the transfer the body's heading opposes how it was moving
      if (lastDir && b.fx * lastDir[0] + b.fy * lastDir[1] + b.fz * lastDir[2] < -0.3 && res !== 4) M.reversals++;
    }
    M.simPath += dContact;
    const sd = Math.hypot(SURF[0], SURF[1], SURF[2]);
    if (res === 0 && sd > 0.1) { if (!lastDir) lastDir = [0, 0, 0]; lastDir[0] = SURF[0] / sd; lastDir[1] = SURF[1] / sd; lastDir[2] = SURF[2] / sd; }
    // heading direction flips between frames (the velocity direction itself, in world space)
    if (lastDir && sd > 0.1 && res === 0 && (SURF[0] * lastDir[0] + SURF[1] * lastDir[1] + SURF[2] * lastDir[2]) / sd < 0.0) M.dirFlips++;
    if (res === 4) { M.released++; if (!release) break; }
    // 2. drawn pose
    move.bodyQuat(b, simQ);
    if (vs) {
      move.visUpdate(vs, b, ddt);
      dc[0] = vs.cx; dc[1] = vs.cy; dc[2] = vs.cz; qd[0] = vs.qx; qd[1] = vs.qy; qd[2] = vs.qz; qd[3] = vs.qw;
    } else {
      qSlerpTo(qd, simQ, 1 - Math.exp(-16 * ddt));
      upOf(qd, up);
      centreOf(dc); // the old drawn root is the feet: centre = feet + drawn up × h
      dc[0] = b.x + up[0] * hh; dc[1] = b.y + up[1] * hh; dc[2] = b.z + up[2] * hh;
    }
    upOf(qd, up);
    const feet = [dc[0] - up[0] * hh, dc[1] - up[1] * hh, dc[2] - up[2] * hh];
    const dJump = Math.hypot(dc[0] - prevDc[0], dc[1] - prevDc[1], dc[2] - prevDc[2]);
    const fJump = Math.hypot(feet[0] - prevFeet[0], feet[1] - prevFeet[1], feet[2] - prevFeet[2]);
    // jump = more than twice the walking step (+2 cm)
    if (dJump > 2 * expected + 0.02) { M.drawnJumps++; if (opts.trace) opts.trace.push(['dj', +t.toFixed(3), +dJump.toFixed(3), 'res', res, 'sim', +b.x.toFixed(3), +b.y.toFixed(3), +b.z.toFixed(3), 'dc', +dc[0].toFixed(3), +dc[1].toFixed(3), +dc[2].toFixed(3), 'prev', +prevDc[0].toFixed(3), +prevDc[1].toFixed(3), +prevDc[2].toFixed(3)]); }
    if (dJump > M.maxDrawnJump) M.maxDrawnJump = dJump / Math.max(ddt, 1e-3) * (1 / 60); // normalised to a 60 Hz frame
    if (fJump > M.maxDrawnFeetJump) M.maxDrawnFeetJump = fJump / Math.max(ddt, 1e-3) * (1 / 60);
    if (stickMag > 0.3 && dJump > 0.3 * expected && camProj(cam, prevDc[0], prevDc[1], prevDc[2], PA) && camProj(cam, dc[0], dc[1], dc[2], PB)) {
      const sxv = PB[0] - PA[0]; const syv = PB[1] - PA[1]; const sl = Math.hypot(sxv, syv);
      if (sl > 1e-5 && (sxv * mx + syv * my) / (sl * Math.hypot(mx, my)) < -0.5) M.screenRev++;
    }
    prevDc = [dc[0], dc[1], dc[2]]; prevFeet = feet;
    if (M.frames > 1) {
      const turn = qAngle(qd, qdPrev) / Math.max(ddt, 1e-3) * (1 / 60);
      if (turn > M.maxDrawnTurn) M.maxDrawnTurn = turn;
      const sTurn = qAngle(simQ, simQPrev) / Math.max(ddt, 1e-3) * (1 / 60);
      if (sTurn > M.maxSimTurn) M.maxSimTurn = sTurn;
    }
    var qdPrev = [qd[0], qd[1], qd[2], qd[3]]; var simQPrev = [simQ[0], simQ[1], simQ[2], simQ[3]];
    // is the drawn body's feet buried in a box (it cut through a corner)? depth ≥ 4 cm
    if (world.buried(feet[0], feet[1], feet[2], up[0], up[1], up[2])) { const dd = depthIn(world, feet); if (dd > M.maxBurrow) M.maxBurrow = dd; if (dd > 0.04) M.burrow++; if (opts.trace) opts.trace.push(['burrow', +t.toFixed(3), +dd.toFixed(3), +feet[0].toFixed(3), +feet[1].toFixed(3), +feet[2].toFixed(3), 'sim', +b.x.toFixed(3), +b.y.toFixed(3), +b.z.toFixed(3), b.nx, b.ny, b.nz, 'up', +up[0].toFixed(2), +up[1].toFixed(2), +up[2].toFixed(2)]); }
    // 3. camera
    const cc = getCamCentre();
    setCamWant(cc, cw);
    if (sp3) {
      // the pivot springs; the camera keeps an offset from it that eases (in fast, out slowly) when the solver moves it
      move.spring3Step(sp3, cw[3], cw[4], cw[5], 0.09, ddt);
      const ow = [cw[0] - cw[3], cw[1] - cw[4], cw[2] - cw[5]];
      if (!camOff) camOff = ow.slice();
      const kk = 1 - Math.exp(-(Math.hypot(...ow) < Math.hypot(...camOff) ? 14 : 4) * ddt);
      camOff[0] += (ow[0] - camOff[0]) * kk; camOff[1] += (ow[1] - camOff[1]) * kk; camOff[2] += (ow[2] - camOff[2]) * kk;
      cam.px = sp3.x + camOff[0]; cam.py = sp3.y + camOff[1]; cam.pz = sp3.z + camOff[2];
      cam.lx = sp3.x; cam.ly = sp3.y; cam.lz = sp3.z;
    } else {
      const k = 1 - Math.exp(-12 * ddt);
      cam.px += (cw[0] - cam.px) * k; cam.py += (cw[1] - cam.py) * k; cam.pz += (cw[2] - cam.pz) * k;
      cam.lx += (cw[3] - cam.lx) * k; cam.ly += (cw[4] - cam.ly) * k; cam.lz += (cw[5] - cam.lz) * k;
    }
    { // the eased camera never ends inside / behind a collider on its way to a solved spot (cameras(): camGuard)
      const gc = getCamCentre();
      const ex = cam.px - gc[0]; const ey = cam.py - gc[1]; const ez = cam.pz - gc[2]; const el = Math.hypot(ex, ey, ez);
      if (el > 1e-3) {
        const h = world.sweep(gc[0], gc[1], gc[2], ex / el, ey / el, ez / el, el, 0.12, (bb) => bb.climb !== false, true);
        if (h && h.t - 0.01 < el - 0.005) { const r = Math.max(0, h.t - 0.01); cam.px = gc[0] + (ex / el) * r; cam.py = gc[1] + (ey / el) * r; cam.pz = gc[2] + (ez / el) * r; }
      }
    }
    camBasis(cam);
    const cp = [cam.px, cam.py, cam.pz];
    if (prevCam) {
      const cj = Math.hypot(cp[0] - prevCam[0], cp[1] - prevCam[1], cp[2] - prevCam[2]) / Math.max(ddt, 1e-3) * (1 / 60);
      if (cj > M.maxCamJump) M.maxCamJump = cj;
      const dir = [cam.fx, cam.fy, cam.fz];
      const ang = Math.acos(Math.max(-1, Math.min(1, dir[0] * prevCamDir[0] + dir[1] * prevCamDir[1] + dir[2] * prevCamDir[2]))) / Math.max(ddt, 1e-3) * (1 / 60);
      if (ang > M.maxCamTurn) M.maxCamTurn = ang;
      if (cj > 0.1) M.camJumps++;
    }
    prevCam = cp; prevCamDir = [cam.fx, cam.fy, cam.fz];
    // 4. progress / stalls: net travel over any 0.5 s window while the stick is held
    winPos.push([t, b.x, b.y, b.z]);
    while (winPos.length && t - winPos[0][0] > 0.5) winPos.shift();
    if (winPos.length > 3 && t > 0.6 && t - winPos[0][0] > 0.45) {
      const w0 = winPos[0]; const d = Math.hypot(b.x - w0[1], b.y - w0[2], b.z - w0[3]);
      if (d < 0.2 * speed * stickMag * (t - w0[0])) M.stalls++;
    }
  }
  return M;
}

const boxIds = new WeakMap(); let boxN = 0;
function boxId(map, b) { let i = boxIds.get(b); if (i == null) { i = ++boxN; boxIds.set(b, i); } return i; }
function depthIn(world, f) {
  // how far (m) is this point inside the nearest box: min distance to a face of any box holding it
  let best = 0;
  const n = world.gather(f[0], f[2], f[0], f[2]);
  void n;
  for (const bx of world.boxes) {
    if (f[0] > bx.minX && f[0] < bx.maxX && f[1] > bx.minY && f[1] < bx.maxY && f[2] > bx.minZ && f[2] < bx.maxZ) {
      const d = Math.min(f[0] - bx.minX, bx.maxX - f[0], f[1] - bx.minY, bx.maxY - f[1], f[2] - bx.minZ, bx.maxZ - f[2]);
      if (d > best) best = d;
    }
  }
  return best;
}

const ADD = ['res1', 'res2', 'res3', 'res4', 'blocked', 'steers', 'unslid', 'deadStops', 'screenRev', 'contactJumps', 'drawnJumps', 'flips', 'reversals', 'stalls', 'camJumps', 'released', 'dirFlips', 'burrow', 'frames'];
const MAXK = ['maxBurrow', 'maxDead', 'maxContactJump', 'maxDrawnJump', 'maxDrawnTurn', 'maxDrawnFeetJump', 'maxCamJump', 'maxCamTurn', 'maxSimTurn'];
export function mkAgg() { const a = { runs: 0, simPath: 0 }; for (const k of ADD) a[k] = 0; for (const k of MAXK) a[k] = 0; a.runsWith = {}; for (const k of ADD) a.runsWith[k] = 0; a.p95 = {}; a._v = {}; for (const k of MAXK) a._v[k] = []; return a; }
export function addAgg(a, m) {
  a.runs++; a.simPath += m.simPath;
  for (const k of ADD) { a[k] += m[k]; if (m[k] > 0) a.runsWith[k]++; }
  for (const k of MAXK) { a[k] = Math.max(a[k], m[k]); a._v[k].push(m[k]); }
}
export function finishAgg(a) {
  for (const k of MAXK) { const v = a._v[k].sort((x, y) => x - y); a.p95[k] = v.length ? v[Math.floor(v.length * 0.95)] : 0; }
  delete a._v; return a;
}

/** Many runs on one map: every start face × stick directions × camera yaws. */
export function sweepMap(mods, map, opts = {}) {
  const { sticks = [[0, 1], [1, 0], [-1, 0], [0.7, 0.7], [-0.7, 0.7], [0, -1]], yaws = [0, 1.6, 3.1, 4.7], dt = 1 / 60, T = 5, size = 1, jitter = 0, maxBoxes = 120, perFace = 1, seed = 3, maxXfer = 0 } = opts;
  const world = mods.world.createWorld({ colliders: map.colliders, bounds: map.bounds });
  const starts = startPoints(world, map.colliders, { size, maxBoxes, perFace, seed });
  const agg = mkAgg();
  let i = 0;
  for (const st of starts) {
    for (const stick of sticks) {
      const yaw = yaws[(i++) % yaws.length];
      const m = runCrawl(mods, map, st, { stick, yaw, dt, T, size, jitter, world, seed: i, maxXfer, steer: opts.steer !== false });
      addAgg(agg, m);
    }
  }
  agg.starts = starts.length;
  return finishAgg(agg);
}
