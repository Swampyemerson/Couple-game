// Movement and collision against the map's axis-aligned boxes.
//
// Free mode: a chameleon is a vertical circle (radius r) whose feet are at y. A box blocks it
// horizontally when it rises above the step height and starts below the head; lower boxes are
// walked onto, higher ones walked under. Radius, step and head come from the body (they scale
// with the size setting), falling back to the v1 constants.
//
// Crawl mode (sticky feet): the body is a contact point on a box face (or the ground) with a
// surface normal n and a heading f. crawl() slides it along the surface; at a concave corner
// (a wall ahead) it transfers onto that face, at a convex edge it wraps around onto the side
// face it just left, so it can walk floor → wall → ceiling → wall → floor.
//
// A uniform XZ grid (CSR arrays) accelerates every query; everything is allocation-free per
// frame (shared result objects, a stamp array for de-duplication).

export const STEP = 0.24;
export const HEAD = 0.34;
export const GRAVITY = 13;
export const JUMP_V = 4.6;
/** Squeeze pose: the same tiny profile at every size (fits 0.18 m gaps, 0.16 m clearance). */
export const SQUEEZE_R = 0.08;
export const SQUEEZE_H = 0.15;

/** Body dimensions for a size factor (1 = the v1 chameleon). */
export function dims(s = 1) {
  return { r: 0.24 * s, step: Math.max(0.2, STEP * s), head: HEAD * s, jump: JUMP_V * Math.pow(s, 0.4) };
}

const CELL = 1.5;

export function createWorld(map) {
  const boxes = map.colliders;
  const NB = boxes.length;
  const B = map.bounds || {};
  const bounds = {
    minX: Number.isFinite(B.minX) ? B.minX : -1e6, maxX: Number.isFinite(B.maxX) ? B.maxX : 1e6,
    minZ: Number.isFinite(B.minZ) ? B.minZ : -1e6, maxZ: Number.isFinite(B.maxZ) ? B.maxZ : 1e6,
  };
  for (const b of boxes) {
    const nm = b.name || '';
    if (b.ceil == null) b.ceil = nm.startsWith('ceil:');
    const thin = Math.min(b.maxX - b.minX, b.maxZ - b.minZ) < 0.16;
    if (b.perch == null) b.perch = nm.startsWith('perch:') || thin;
    if (b.climb == null) b.climb = true;
  }

  // ── spatial grid (CSR) ──
  let gx0 = Infinity; let gz0 = Infinity; let gx1 = -Infinity; let gz1 = -Infinity;
  for (const b of boxes) { gx0 = Math.min(gx0, b.minX); gz0 = Math.min(gz0, b.minZ); gx1 = Math.max(gx1, b.maxX); gz1 = Math.max(gz1, b.maxZ); }
  if (!NB) { gx0 = -1; gz0 = -1; gx1 = 1; gz1 = 1; }
  let cell = CELL;
  while (((gx1 - gx0) / cell) * ((gz1 - gz0) / cell) > 6000) cell *= 1.5;
  const GW = Math.max(1, Math.ceil((gx1 - gx0) / cell)); const GH = Math.max(1, Math.ceil((gz1 - gz0) / cell));
  const cx = (x) => { const i = Math.floor((x - gx0) / cell); return i < 0 ? 0 : i >= GW ? GW - 1 : i; };
  const cz = (z) => { const i = Math.floor((z - gz0) / cell); return i < 0 ? 0 : i >= GH ? GH - 1 : i; };
  const counts = new Int32Array(GW * GH + 1);
  for (const b of boxes) for (let j = cz(b.minZ); j <= cz(b.maxZ); j++) for (let i = cx(b.minX); i <= cx(b.maxX); i++) counts[j * GW + i + 1]++;
  for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
  const items = new Int32Array(counts[counts.length - 1]);
  const fillAt = counts.slice(0, GW * GH);
  boxes.forEach((b, bi) => { for (let j = cz(b.minZ); j <= cz(b.maxZ); j++) for (let i = cx(b.minX); i <= cx(b.maxX); i++) items[fillAt[j * GW + i]++] = bi; });
  const mark = new Uint32Array(Math.max(1, NB));
  let stamp = 0;
  const qbuf = new Int32Array(Math.max(1, NB));
  const stats = { queries: 0, tested: 0 };
  /** Unique box indices whose grid cells overlap the XZ rectangle → qbuf; returns the count. */
  function gather(x0, z0, x1, z1) {
    stamp = (stamp + 1) >>> 0;
    if (stamp === 0) { mark.fill(0); stamp = 1; }
    let n = 0;
    const i0 = cx(x0); const i1 = cx(x1); const j0 = cz(z0); const j1 = cz(z1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * GW + i;
      for (let k = counts[c]; k < counts[c + 1]; k++) { const bi = items[k]; if (mark[bi] !== stamp) { mark[bi] = stamp; qbuf[n++] = bi; } }
    }
    stats.queries++; stats.tested += n;
    return n;
  }

  const rOf = (body) => (body.sq ? SQUEEZE_R : body.r);
  const stepOf = (body) => (body.sq ? 0.12 : body.step || STEP);
  const headOf = (body) => (body.sq ? SQUEEZE_H : body.head || HEAD);

  function pushOut(body) {
    let moved = false;
    const r = rOf(body); const step = stepOf(body); const head = headOf(body);
    for (let it = 0; it < 3; it++) {
      let any = false;
      const n = gather(body.x - r, body.z - r, body.x + r, body.z + r);
      for (let q = 0; q < n; q++) {
        const b = boxes[qbuf[q]];
        if (!(b.maxY > body.y + step && b.minY < body.y + head)) continue;
        const px = body.x < b.minX ? b.minX : body.x > b.maxX ? b.maxX : body.x;
        const pz = body.z < b.minZ ? b.minZ : body.z > b.maxZ ? b.maxZ : body.z;
        let dx = body.x - px; let dz = body.z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2); const p = r - d;
          body.x += (dx / d) * p; body.z += (dz / d) * p;
        } else {
          // centre inside the box: leave by the nearest side
          const l = body.x - b.minX; const rr = b.maxX - body.x; const nn = body.z - b.minZ; const f = b.maxZ - body.z;
          const m = Math.min(l, rr, nn, f);
          if (m === l) body.x = b.minX - r; else if (m === rr) body.x = b.maxX + r;
          else if (m === nn) body.z = b.minZ - r; else body.z = b.maxZ + r;
          dx = 0; dz = 0;
        }
        any = true; moved = true;
      }
      if (!any) break;
    }
    return moved;
  }

  /** Highest walkable surface under the circle (≤ feet + step). The box (or null for the ground) → groundRes.box. */
  const groundRes = { y: 0, box: null };
  function groundAt(x, z, r, feet, step = STEP) {
    let g = 0; let gb = null;
    const n = gather(x - r, z - r, x + r, z + r);
    for (let q = 0; q < n; q++) {
      const b = boxes[qbuf[q]];
      if (b.maxY > feet + step + 0.001 || b.maxY <= g) continue;
      if (x + r < b.minX || x - r > b.maxX || z + r < b.minZ || z - r > b.maxZ) continue;
      g = b.maxY; gb = b;
    }
    groundRes.y = g; groundRes.box = gb;
    return g;
  }

  /** Lowest ceiling above the head (for jumps). */
  function ceilingAt(x, z, r, feet, head = HEAD) {
    let c = Infinity;
    const rr = r * 0.7;
    const n = gather(x - rr, z - rr, x + rr, z + rr);
    for (let q = 0; q < n; q++) {
      const b = boxes[qbuf[q]];
      if (b.minY < feet + head - 0.05 || b.minY >= c) continue;
      if (x + rr < b.minX || x - rr > b.maxX || z + rr < b.minZ || z - rr > b.maxZ) continue;
      c = b.minY;
    }
    return c;
  }

  /**
   * Integrate one free-mode step. body: { x, y, z, vy, r, step, head, jumpV, onGround }.
   * vx/vz: desired horizontal velocity. Returns true when the body just landed.
   */
  function step(body, vx, vz, dt, jump = false) {
    const prevY = body.y;
    const r = rOf(body); const st = stepOf(body); const head = headOf(body);
    body.x += vx * dt; body.z += vz * dt;
    pushOut(body);
    if (jump && body.onGround) { body.vy = body.jumpV || JUMP_V; body.onGround = false; }
    body.vy -= GRAVITY * dt;
    if (body.vy < -20) body.vy = -20;
    body.y += body.vy * dt;
    if (body.vy > 0) {
      const c = ceilingAt(body.x, body.z, r, prevY, head);
      if (body.y + head > c) { body.y = c - head; body.vy = 0; }
    }
    const g = groundAt(body.x, body.z, r * 0.6, Math.max(prevY, body.y), st);
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

  /** Is there room to stand at full size here (leaving the squeeze pose)? */
  const probeB = { x: 0, y: 0, z: 0, r: 0.24, step: STEP, head: HEAD, sq: false };
  function roomFor(body) {
    probeB.x = body.x; probeB.y = body.y; probeB.z = body.z; probeB.r = body.r; probeB.step = body.step || STEP; probeB.head = body.head || HEAD; probeB.sq = false;
    pushOut(probeB);
    if (Math.hypot(probeB.x - body.x, probeB.z - body.z) > 0.03) return false;
    return ceilingAt(body.x, body.z, body.r, body.y, probeB.head) >= body.y + probeB.head - 0.01;
  }

  /**
   * Ray vs boxes (slab test). Returns the shared `hit` object or null. filter(box) may skip
   * boxes; floor = also hit the y=0 ground plane (box null).
   */
  const hit = { t: 0, nx: 0, ny: 0, nz: 0, box: null, x: 0, y: 0, z: 0 };
  function raycast(ox, oy, oz, dx, dy, dz, maxT, filter = null, floor = false) {
    let best = maxT; let found = null; let bnx = 0; let bny = 0; let bnz = 0; let any = false;
    const ex = ox + dx * maxT; const ez = oz + dz * maxT;
    const n = gather(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez));
    for (let q = 0; q < n; q++) {
      const b = boxes[qbuf[q]];
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
      if (ok && t0 > 0 && t0 < best) { best = t0; found = b; bnx = nx; bny = ny; bnz = nz; any = true; }
    }
    if (floor && dy < -1e-6) {
      const t = -oy / dy;
      if (t > 0 && t < best) { best = t; found = null; bnx = 0; bny = 1; bnz = 0; any = true; }
    }
    if (!any) return null;
    hit.t = best; hit.box = found; hit.nx = bnx; hit.ny = bny; hit.nz = bnz;
    hit.x = ox + dx * best; hit.y = oy + dy * best; hit.z = oz + dz * best;
    return hit;
  }

  /** Nearest vertical wall face within `maxD` of (x,z) at height y (for the wall pose). Shared result object. */
  const wallRes = { nx: 0, nz: 0, px: 0, pz: 0, box: null, d: 0 };
  function putWall(nx, nz, px, pz, b, d) { wallRes.nx = nx; wallRes.nz = nz; wallRes.px = px; wallRes.pz = pz; wallRes.box = b; wallRes.d = d; return d; }
  function nearestWall(x, y, z, maxD, filter = null) {
    let best = maxD; let found = false;
    const n = gather(x - maxD, z - maxD, x + maxD, z + maxD);
    for (let q = 0; q < n; q++) {
      const b = boxes[qbuf[q]];
      if (!b.wall || b.maxY < y + 0.35 || b.minY > y + 0.1 || b.maxY - b.minY < 0.4) continue;
      if (filter && !filter(b)) continue;
      if (z >= b.minZ && z <= b.maxZ) {
        const dL = b.minX - x; const dR = x - b.maxX;
        if (dL >= -0.05 && dL < best && b.minX > bounds.minX - 0.01) { best = putWall(-1, 0, b.minX, z, b, dL); found = true; }
        if (dR >= -0.05 && dR < best && b.maxX < bounds.maxX + 0.01) { best = putWall(1, 0, b.maxX, z, b, dR); found = true; }
      }
      if (x >= b.minX && x <= b.maxX) {
        const dN = b.minZ - z; const dF = z - b.maxZ;
        if (dN >= -0.05 && dN < best && b.minZ > bounds.minZ - 0.01) { best = putWall(0, -1, x, b.minZ, b, dN); found = true; }
        if (dF >= -0.05 && dF < best && b.maxZ < bounds.maxZ + 0.01) { best = putWall(0, 1, x, b.maxZ, b, dF); found = true; }
      }
    }
    return found ? wallRes : null;
  }

  // ── crawling ──────────────────────────────────────────────────────
  const climbable = (b) => b.climb !== false;
  const inside = (x, z) => x > bounds.minX - 0.02 && x < bounds.maxX + 0.02 && z > bounds.minZ - 0.02 && z < bounds.maxZ + 0.02;
  /** Is a contact point (on a face with normal n) buried inside another box? */
  function buried(x, y, z, nx, ny, nz) {
    const px = x + nx * 0.03; const py = y + ny * 0.03; const pz = z + nz * 0.03;
    const n = gather(px, pz, px, pz);
    for (let q = 0; q < n; q++) {
      const b = boxes[qbuf[q]];
      if (px > b.minX + 0.001 && px < b.maxX - 0.001 && py > b.minY + 0.001 && py < b.maxY - 0.001 && pz > b.minZ + 0.001 && pz < b.maxZ - 0.001) return true;
    }
    return py < -0.001;
  }
  function setContact(body, x, y, z, nx, ny, nz, box) {
    body.x = x; body.y = y; body.z = z; body.nx = nx; body.ny = ny; body.nz = nz; body.box = box;
  }
  /** Heading := f projected onto the plane ⟂ n (fallback: any tangent). */
  function reHead(body, fx, fy, fz) {
    const d = fx * body.nx + fy * body.ny + fz * body.nz;
    fx -= body.nx * d; fy -= body.ny * d; fz -= body.nz * d;
    let L = Math.hypot(fx, fy, fz);
    if (L < 1e-4) {
      // pick world up projected, else world +z
      fx = -body.nx * body.ny; fy = 1 - body.ny * body.ny; fz = -body.nz * body.ny;
      L = Math.hypot(fx, fy, fz);
      if (L < 1e-4) { fx = 0; fy = 0; fz = 1; fx -= body.nx * body.nz; fy -= body.ny * body.nz; fz -= body.nz * body.nz; L = Math.hypot(fx, fy, fz) || 1; }
    }
    body.fx = fx / L; body.fy = fy / L; body.fz = fz / L;
  }

  /**
   * Slide an attached body along its surface by velocity (mx,my,mz) (tangent) for dt.
   * Returns 0 moved / still, 1 concave transfer, 2 convex wrap, 3 blocked (stayed).
   * After a transfer, body.n is the new face normal and body.f the new heading.
   */
  function crawl(body, mx, my, mz, dt) {
    const nx = body.nx; const ny = body.ny; const nz = body.nz;
    // keep the velocity tangent
    const dn = mx * nx + my * ny + mz * nz;
    mx -= nx * dn; my -= ny * dn; mz -= nz * dn;
    const sp = Math.hypot(mx, my, mz);
    const r = rOf(body);
    if (sp < 1e-4) return 0;
    const dx = mx / sp; const dy = my / sp; const dz = mz / sp;
    const dist = sp * dt;
    // 1. concave: a face ahead, facing us → climb onto it. Two feelers: one at belly height,
    //    one just above the surface (catches skirting boards, sills, shelf lips)
    const look = dist + r * 0.85;
    let H = null;
    for (let k = 0; k < 2; k++) {
      const h = k === 0 ? 0.035 : Math.min(0.6 * r, 0.16);
      const ox = body.x + nx * h; const oy = body.y + ny * h; const oz = body.z + nz * h;
      const G = raycast(ox, oy, oz, dx, dy, dz, k === 0 ? Math.min(look, dist + 0.06) : look, climbable, true);
      if (G && G.nx * dx + G.ny * dy + G.nz * dz < -0.5 && inside(G.x, G.z) && !buried(G.x, G.y, G.z, G.nx, G.ny, G.nz)) { H = G; break; }
    }
    if (H) {
      setContact(body, H.x, H.y, H.z, H.nx, H.ny, H.nz, H.box);
      reHead(body, nx, ny, nz);
      return 1;
    }
    // 2. move
    const px = body.x; const py = body.y; const pz = body.z;
    body.x += dx * dist; body.y += dy * dist; body.z += dz * dist;
    // 3. snap to the surface under the feet (same plane, maybe the next coplanar box)
    H = raycast(body.x + nx * 0.06, body.y + ny * 0.06, body.z + nz * 0.06, -nx, -ny, -nz, 0.06 + 0.1, climbable, true);
    if (H && H.nx * nx + H.ny * ny + H.nz * nz > 0.9 && inside(H.x, H.z)) {
      body.x = H.x; body.y = H.y; body.z = H.z; body.box = H.box;
      return 0;
    }
    // 4. convex edge: wrap round onto the side face we just walked off
    H = raycast(body.x - nx * 0.05, body.y - ny * 0.05, body.z - nz * 0.05, -dx, -dy, -dz, dist + 0.3, climbable, false);
    if (H && H.nx * dx + H.ny * dy + H.nz * dz > 0.7 && inside(H.x, H.z) && !buried(H.x, H.y, H.z, H.nx, H.ny, H.nz)) {
      setContact(body, H.x, H.y, H.z, H.nx, H.ny, H.nz, H.box);
      reHead(body, -nx, -ny, -nz);
      return 2;
    }
    // 5. nowhere to go: stay put
    body.x = px; body.y = py; body.z = pz;
    return 3;
  }

  /**
   * Best surface to stick to from a free body: the nearest wall face around it, an overhead
   * face just above the head, else null. Writes the contact into `out` {x,y,z,nx,ny,nz,box}.
   */
  const stickRes = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, box: null, d: 0 };
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
  function nearestSurface(body, reach) {
    const r = rOf(body); const head = headOf(body);
    let best = Infinity; let found = false;
    for (const [dx, dy, dz] of DIRS) {
      const oy = body.y + (dy ? head * 0.5 : Math.min(head * 0.5, 0.2));
      const lim = dy ? head * 0.5 + reach : r + reach;
      const H = raycast(body.x, oy, body.z, dx, dy, dz, lim, climbable, false);
      if (!H) continue;
      if (H.nx * dx + H.ny * dy + H.nz * dz > -0.5) continue;
      if (!inside(H.x, H.z) || buried(H.x, H.y, H.z, H.nx, H.ny, H.nz)) continue;
      const d = H.t - (dy ? head * 0.5 : r);
      if (d < best) { best = d; found = true; stickRes.x = H.x; stickRes.y = H.y; stickRes.z = H.z; stickRes.nx = H.nx; stickRes.ny = H.ny; stickRes.nz = H.nz; stickRes.box = H.box; stickRes.d = d; }
    }
    return found ? stickRes : null;
  }

  /** A second wall perpendicular to n within reach (for the corner pose), or null. */
  const cornerRes = { nx: 0, nz: 0, d: 0, x: 0, z: 0 };
  function cornerAt(x, y, z, nx, nz, reach) {
    const tx = -nz; const tz = nx;
    let best = reach; let found = false;
    for (const s of [1, -1]) {
      const H = raycast(x + nx * 0.12, y, z + nz * 0.12, tx * s, 0, tz * s, reach, climbable, false);
      if (H && Math.abs(H.ny) < 0.2 && H.t < best) { best = H.t; found = true; cornerRes.nx = H.nx; cornerRes.nz = H.nz; cornerRes.d = H.t; cornerRes.x = H.x; cornerRes.z = H.z; }
    }
    return found ? cornerRes : null;
  }

  return {
    boxes, bounds, stats, step, pushOut, groundAt, groundRes, ceilingAt, raycast, nearestWall, crawl, reHead, nearestSurface, cornerAt, roomFor, inside, buried,
    blocks(b, feet, body) { return b.maxY > feet + stepOf(body || {}) && b.minY < feet + headOf(body || {}); },
    /** For tests: how many boxes a query would touch (grid effectiveness). */
    gather,
  };
}
