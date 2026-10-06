// Movement and collision against the map's axis-aligned boxes. A chameleon is a vertical
// circle (radius r) whose feet are at y. A box blocks it horizontally when it rises above the
// step height and starts below the head; lower boxes are walked onto, higher ones walked under.
// Everything is allocation-free per frame.

export const STEP = 0.24;
export const HEAD = 0.34;
export const GRAVITY = 13;
export const JUMP_V = 4.6;

export function createWorld(map) {
  const boxes = map.colliders;
  const hit = { t: 0, nx: 0, ny: 0, nz: 0, box: null };

  function blocks(b, feet) { return b.maxY > feet + STEP && b.minY < feet + HEAD; }

  function pushOut(body) {
    let moved = false;
    for (let it = 0; it < 3; it++) {
      let any = false;
      for (let k = 0; k < boxes.length; k++) {
        const b = boxes[k];
        if (!blocks(b, body.y)) continue;
        const cx = body.x < b.minX ? b.minX : body.x > b.maxX ? b.maxX : body.x;
        const cz = body.z < b.minZ ? b.minZ : body.z > b.maxZ ? b.maxZ : body.z;
        let dx = body.x - cx; let dz = body.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= body.r * body.r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2); const p = body.r - d;
          body.x += (dx / d) * p; body.z += (dz / d) * p;
        } else {
          // centre inside the box: leave by the nearest side
          const l = body.x - b.minX; const r = b.maxX - body.x; const n = body.z - b.minZ; const f = b.maxZ - body.z;
          const m = Math.min(l, r, n, f);
          if (m === l) body.x = b.minX - body.r; else if (m === r) body.x = b.maxX + body.r;
          else if (m === n) body.z = b.minZ - body.r; else body.z = b.maxZ + body.r;
          dx = 0; dz = 0;
        }
        any = true; moved = true;
      }
      if (!any) break;
    }
    return moved;
  }

  /** Highest walkable surface under the circle (≤ feet + STEP). */
  function groundAt(x, z, r, feet) {
    let g = 0;
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      if (b.maxY > feet + STEP + 0.001 || b.maxY <= g) continue;
      if (x + r < b.minX || x - r > b.maxX || z + r < b.minZ || z - r > b.maxZ) continue;
      g = b.maxY;
    }
    return g;
  }

  /** Lowest ceiling above the head (for jumps). */
  function ceilingAt(x, z, r, feet) {
    let c = Infinity;
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      if (b.minY < feet + HEAD - 0.05 || b.minY >= c) continue;
      if (x + r * 0.7 < b.minX || x - r * 0.7 > b.maxX || z + r * 0.7 < b.minZ || z - r * 0.7 > b.maxZ) continue;
      c = b.minY;
    }
    return c;
  }

  /**
   * Integrate one step. body: { x, y, z, vy, r, onGround }. vx/vz: desired horizontal velocity.
   * Returns true when the body just landed.
   */
  function step(body, vx, vz, dt, jump = false) {
    const prevY = body.y;
    body.x += vx * dt; body.z += vz * dt;
    pushOut(body);
    if (jump && body.onGround) { body.vy = JUMP_V; body.onGround = false; }
    body.vy -= GRAVITY * dt;
    if (body.vy < -20) body.vy = -20;
    body.y += body.vy * dt;
    if (body.vy > 0) {
      const c = ceilingAt(body.x, body.z, body.r, prevY);
      if (body.y + HEAD > c) { body.y = c - HEAD; body.vy = 0; }
    }
    const g = groundAt(body.x, body.z, body.r * 0.6, Math.max(prevY, body.y));
    let landed = false;
    if (body.y <= g) {
      landed = !body.onGround && body.vy < -2;
      body.y = g; body.vy = 0; body.onGround = true;
    } else if (body.onGround && body.y - g < 0.06 && body.vy <= 0) {
      body.y = g; body.vy = 0;
    } else body.onGround = false;
    pushOut(body);
    return landed;
  }

  /** Ray vs every box (slab test). Returns the shared `hit` object or null. */
  function raycast(ox, oy, oz, dx, dy, dz, maxT, filter = null) {
    let best = maxT; let found = null; let bnx = 0; let bny = 0; let bnz = 0;
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      if (filter && !filter(b)) continue;
      let t0 = 0; let t1 = best; let nx = 0; let ny = 0; let nz = 0;
      let ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        const o = a === 0 ? ox : a === 1 ? oy : oz; const d = a === 0 ? dx : a === 1 ? dy : dz;
        const lo = a === 0 ? b.minX : a === 1 ? b.minY : b.minZ; const hi = a === 0 ? b.maxX : a === 1 ? b.maxY : b.maxZ;
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) ok = false; continue; }
        let ta = (lo - o) / d; let tb = (hi - o) / d; let sgn = -1;
        if (ta > tb) { const t = ta; ta = tb; tb = t; sgn = 1; }
        if (ta > t0) { t0 = ta; nx = a === 0 ? sgn : 0; ny = a === 1 ? sgn : 0; nz = a === 2 ? sgn : 0; }
        if (tb < t1) t1 = tb;
        if (t0 > t1) ok = false;
      }
      if (ok && t0 > 0 && t0 < best) { best = t0; found = b; bnx = nx; bny = ny; bnz = nz; }
    }
    if (!found) return null;
    hit.t = best; hit.box = found; hit.nx = bnx; hit.ny = bny; hit.nz = bnz;
    return hit;
  }

  /** Nearest vertical wall face within `maxD` of (x,z) at height y (for the wall pose). */
  function nearestWall(x, y, z, maxD) {
    let best = maxD; let res = null;
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      if (!b.wall || b.maxY < y + 0.35 || b.minY > y + 0.1 || b.maxY - b.minY < 0.4) continue;
      if (z >= b.minZ && z <= b.maxZ) {
        const dL = b.minX - x; const dR = x - b.maxX;
        if (dL >= -0.05 && dL < best) { best = dL; res = { nx: -1, nz: 0, px: b.minX, pz: z, box: b, d: dL }; }
        if (dR >= -0.05 && dR < best) { best = dR; res = { nx: 1, nz: 0, px: b.maxX, pz: z, box: b, d: dR }; }
      }
      if (x >= b.minX && x <= b.maxX) {
        const dN = b.minZ - z; const dF = z - b.maxZ;
        if (dN >= -0.05 && dN < best) { best = dN; res = { nx: 0, nz: -1, px: x, pz: b.minZ, box: b, d: dN }; }
        if (dF >= -0.05 && dF < best) { best = dF; res = { nx: 0, nz: 1, px: x, pz: b.maxZ, box: b, d: dF }; }
      }
    }
    return res;
  }

  return { boxes, step, pushOut, groundAt, raycast, nearestWall, blocks };
}
