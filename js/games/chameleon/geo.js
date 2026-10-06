// Geometry for Blend & Seek: primitive generators with metre-scaled UVs, and a builder that
// merges a whole diorama into ONE indexed BufferGeometry (vertex colours + atlas tile per
// vertex) with ink outlines baked in as inverted hulls (duplicated, winding-flipped triangles
// carrying an `onrm` push direction that the vertex shader expands). Also collects colliders,
// blob shadows and test probes. Everything here runs once at load.

// ── primitive generators: return { pos, nrm, uv, idx } plain arrays ──

/** Axis-aligned box centred on the origin. uv in metres (or 0..1 per face with fit). Optional rounding. */
export function boxGeo(w, h, d, { seg = 1, round = 0, fit = false, faces = null } = {}) {
  const pos = []; const nrm = []; const uv = []; const idx = [];
  const hx = w / 2; const hy = h / 2; const hz = d / 2;
  const F = [
    ['px', [1, 0, 0], [0, 0, -1], [0, 1, 0], d, h],
    ['nx', [-1, 0, 0], [0, 0, 1], [0, 1, 0], d, h],
    ['py', [0, 1, 0], [1, 0, 0], [0, 0, -1], w, d],
    ['ny', [0, -1, 0], [1, 0, 0], [0, 0, 1], w, d],
    ['pz', [0, 0, 1], [1, 0, 0], [0, 1, 0], w, h],
    ['nz', [0, 0, -1], [-1, 0, 0], [0, 1, 0], w, h],
  ];
  const s = round > 0 ? Math.max(seg, 4) : seg;
  for (const [name, n, u, v, su, sv] of F) {
    if (faces && !faces.includes(name)) continue;
    const base = pos.length / 3;
    const hn = Math.abs(n[0]) * hx + Math.abs(n[1]) * hy + Math.abs(n[2]) * hz;
    for (let j = 0; j <= s; j++) {
      for (let i = 0; i <= s; i++) {
        const a = i / s - 0.5; const b = j / s - 0.5;
        let x = n[0] * hn + u[0] * a * su + v[0] * b * sv;
        let y = n[1] * hn + u[1] * a * su + v[1] * b * sv;
        let z = n[2] * hn + u[2] * a * su + v[2] * b * sv;
        let nx = n[0]; let ny = n[1]; let nz = n[2];
        if (round > 0) {
          const ix = Math.max(-hx + round, Math.min(hx - round, x));
          const iy = Math.max(-hy + round, Math.min(hy - round, y));
          const iz = Math.max(-hz + round, Math.min(hz - round, z));
          let dx = x - ix; let dy = y - iy; let dz = z - iz;
          const L = Math.hypot(dx, dy, dz);
          if (L > 1e-6) { dx /= L; dy /= L; dz /= L; x = ix + dx * round; y = iy + dy * round; z = iz + dz * round; nx = dx; ny = dy; nz = dz; }
        }
        pos.push(x, y, z); nrm.push(nx, ny, nz);
        if (fit) uv.push(0.002 + (i / s) * 0.996, 0.002 + (j / s) * 0.996);
        else uv.push((a + 0.5) * su, (b + 0.5) * sv);
      }
    }
    const row = s + 1;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const k = base + j * row + i;
      idx.push(k, k + 1, k + row + 1, k, k + row + 1, k + row);
    }
  }
  return fixWinding({ pos, nrm, uv, idx });
}

/** Cylinder / cone frustum along Y, centred. uv: (arc length, height) in metres. */
export function cylGeo(rTop, rBot, h, { radial = 14, caps = true, open = false, fit = false } = {}) {
  const pos = []; const nrm = []; const uv = []; const idx = [];
  const slope = (rBot - rTop) / h;
  const rAvg = (rTop + rBot) / 2;
  for (let i = 0; i <= radial; i++) {
    const a = (i / radial) * Math.PI * 2; const sa = Math.sin(a); const ca = Math.cos(a);
    const L = Math.hypot(1, slope);
    for (const [y, r, t] of [[-h / 2, rBot, 0], [h / 2, rTop, 1]]) {
      pos.push(sa * r, y, ca * r); nrm.push(sa / L, slope / L, ca / L);
      uv.push(fit ? i / radial : a * rAvg, fit ? t : t * h);
    }
  }
  for (let i = 0; i < radial; i++) { const b0 = i * 2; const t0 = b0 + 1; const b1 = b0 + 2; const t1 = b0 + 3; idx.push(b0, b1, t1, b0, t1, t0); }
  if (caps && !open) {
    for (const [y, r, ny] of [[h / 2, rTop, 1], [-h / 2, rBot, -1]]) {
      if (r <= 0) continue;
      const c = pos.length / 3;
      pos.push(0, y, 0); nrm.push(0, ny, 0); uv.push(fit ? 0.5 : 0, fit ? 0.5 : 0);
      for (let i = 0; i <= radial; i++) {
        const a = (i / radial) * Math.PI * 2;
        pos.push(Math.sin(a) * r, y, Math.cos(a) * r); nrm.push(0, ny, 0);
        uv.push(fit ? 0.5 + Math.sin(a) * 0.49 : Math.sin(a) * r, fit ? 0.5 + Math.cos(a) * 0.49 : Math.cos(a) * r);
      }
      for (let i = 0; i < radial; i++) idx.push(c, c + 1 + i, c + 2 + i);
    }
  }
  return fixWinding({ pos, nrm, uv, idx });
}

/** Ellipsoid. uv: (u 0..1 around, v 0..1 top→bottom flipped) unless metres. */
export function sphereGeo(rx, ry = rx, rz = rx, { w = 16, h = 10, metres = true, thetaMax = Math.PI } = {}) {
  const pos = []; const nrm = []; const uv = []; const idx = [];
  for (let j = 0; j <= h; j++) {
    const th = (j / h) * thetaMax; const st = Math.sin(th); const ct = Math.cos(th);
    for (let i = 0; i <= w; i++) {
      const ph = (i / w) * Math.PI * 2; const sp = Math.sin(ph); const cp = Math.cos(ph);
      const x = rx * st * sp; const y = ry * ct; const z = rz * st * cp;
      pos.push(x, y, z);
      let nx = x / (rx * rx); let ny = y / (ry * ry); let nz = z / (rz * rz);
      const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      nrm.push(nx, ny, nz);
      if (metres) uv.push(ph * Math.max(rx, rz), (1 - j / h) * Math.PI * ry);
      else uv.push(i / w, 1 - j / h);
    }
  }
  const row = w + 1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = j * row + i; const b = a + 1; const c = a + row + 1; const d = a + row;
    idx.push(d, c, b, d, b, a);
  }
  return fixWinding({ pos, nrm, uv, idx });
}

/** Surface of revolution from a profile [[r, y], …] (bottom → top). uv metres. */
export function latheGeo(profile, { radial = 16, capTop = true, capBottom = true } = {}) {
  const pos = []; const nrm = []; const uv = []; const idx = [];
  const n = profile.length;
  const len = [0];
  for (let k = 1; k < n; k++) len.push(len[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
  for (let k = 0; k < n; k++) {
    const p0 = profile[Math.max(0, k - 1)]; const p1 = profile[Math.min(n - 1, k + 1)];
    let tr = p1[0] - p0[0]; let ty = p1[1] - p0[1];
    const L = Math.hypot(tr, ty) || 1; tr /= L; ty /= L;
    const nr = ty; const ny = -tr; // outward normal of the profile
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2; const sa = Math.sin(a); const ca = Math.cos(a);
      const r = profile[k][0];
      pos.push(sa * r, profile[k][1], ca * r); nrm.push(sa * nr, ny, ca * nr);
      uv.push(a * Math.max(0.02, r), len[k]);
    }
  }
  const row = radial + 1;
  for (let k = 0; k < n - 1; k++) for (let i = 0; i < radial; i++) {
    const a = k * row + i; idx.push(a, a + 1, a + row + 1, a, a + row + 1, a + row);
  }
  const cap = (k, up) => {
    const r = profile[k][0]; const y = profile[k][1];
    if (r <= 0.0005) return;
    const c = pos.length / 3;
    pos.push(0, y, 0); nrm.push(0, up ? 1 : -1, 0); uv.push(0, 0);
    for (let i = 0; i <= radial; i++) { const a = (i / radial) * Math.PI * 2; pos.push(Math.sin(a) * r, y, Math.cos(a) * r); nrm.push(0, up ? 1 : -1, 0); uv.push(Math.sin(a) * r, Math.cos(a) * r); }
    for (let i = 0; i < radial; i++) idx.push(c, c + 1 + i, c + 2 + i);
  };
  if (capTop) cap(n - 1, true);
  if (capBottom) cap(0, false);
  return fixWinding({ pos, nrm, uv, idx });
}

/** Tube along points [[x,y,z]…] with radius r(t). uv: (u around 0..1, v along 0..1). */
export function tubeGeo(points, radiusAt, { radial = 10, capEnd = true, capStart = false } = {}) {
  const pos = []; const nrm = []; const uv = []; const idx = [];
  const n = points.length;
  const T = []; const N = []; const B = [];
  for (let k = 0; k < n; k++) {
    const a = points[Math.max(0, k - 1)]; const b = points[Math.min(n - 1, k + 1)];
    let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(...t) || 1; t = t.map((x) => x / L);
    T.push(t);
  }
  // parallel transport frames
  let nn = Math.abs(T[0][0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const norm = (v) => { const L = Math.hypot(...v) || 1; return v.map((x) => x / L); };
  let bb = norm(cross(T[0], nn)); nn = norm(cross(bb, T[0]));
  for (let k = 0; k < n; k++) {
    if (k > 0) { bb = norm(cross(T[k], nn)); nn = norm(cross(bb, T[k])); }
    N.push(nn); B.push(bb);
  }
  for (let k = 0; k < n; k++) {
    const r = radiusAt(k / (n - 1));
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2; const ca = Math.cos(a); const sa = Math.sin(a);
      const d = [N[k][0] * ca + B[k][0] * sa, N[k][1] * ca + B[k][1] * sa, N[k][2] * ca + B[k][2] * sa];
      pos.push(points[k][0] + d[0] * r, points[k][1] + d[1] * r, points[k][2] + d[2] * r);
      nrm.push(d[0], d[1], d[2]);
      uv.push(i / radial, 1 - k / (n - 1));
    }
  }
  const row = radial + 1;
  for (let k = 0; k < n - 1; k++) for (let i = 0; i < radial; i++) {
    const a = k * row + i; idx.push(a, a + 1, a + row + 1, a, a + row + 1, a + row);
  }
  const cap = (k, sign) => {
    const c = pos.length / 3; const r = radiusAt(k / (n - 1));
    pos.push(...points[k]); nrm.push(T[k][0] * sign, T[k][1] * sign, T[k][2] * sign); uv.push(0.5, 1 - k / (n - 1));
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2; const ca = Math.cos(a); const sa = Math.sin(a);
      pos.push(points[k][0] + (N[k][0] * ca + B[k][0] * sa) * r, points[k][1] + (N[k][1] * ca + B[k][1] * sa) * r, points[k][2] + (N[k][2] * ca + B[k][2] * sa) * r);
      nrm.push(T[k][0] * sign, T[k][1] * sign, T[k][2] * sign); uv.push(i / radial, 1 - k / (n - 1));
    }
    for (let i = 0; i < radial; i++) idx.push(c, c + 1 + i, c + 2 + i);
  };
  if (capEnd) cap(n - 1, 1);
  if (capStart) cap(0, -1);
  return fixWinding({ pos, nrm, uv, idx });
}

/** Flip any triangle whose winding disagrees with its vertex normals (robust for every generator). */
export function fixWinding(g) {
  const { pos: p, nrm: n, idx } = g;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3; const b = idx[t + 1] * 3; const c = idx[t + 2] * 3;
    const ux = p[b] - p[a]; const uy = p[b + 1] - p[a + 1]; const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a]; const vy = p[c + 1] - p[a + 1]; const vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy; const cy = uz * vx - ux * vz; const cz = ux * vy - uy * vx;
    const d = cx * (n[a] + n[b] + n[c]) + cy * (n[a + 1] + n[b + 1] + n[c + 1]) + cz * (n[a + 2] + n[b + 2] + n[c + 2]);
    if (d < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  }
  return g;
}

// ── transforms (rigid: rotation from euler XYZ or yaw, then translation) ──
function rotMatrix(rx, ry, rz) {
  const cx = Math.cos(rx); const sx = Math.sin(rx); const cy = Math.cos(ry); const sy = Math.sin(ry); const cz = Math.cos(rz); const sz = Math.sin(rz);
  // R = Ry * Rx * Rz (yaw outermost, so `rot: [tilt, yaw, roll]` reads naturally)
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const mul = (A, B) => [
    A[0] * B[0] + A[1] * B[3] + A[2] * B[6], A[0] * B[1] + A[1] * B[4] + A[2] * B[7], A[0] * B[2] + A[1] * B[5] + A[2] * B[8],
    A[3] * B[0] + A[4] * B[3] + A[5] * B[6], A[3] * B[1] + A[4] * B[4] + A[5] * B[7], A[3] * B[2] + A[4] * B[5] + A[5] * B[8],
    A[6] * B[0] + A[7] * B[3] + A[8] * B[6], A[6] * B[1] + A[7] * B[4] + A[8] * B[7], A[6] * B[2] + A[7] * B[5] + A[8] * B[8],
  ];
  return mul(mul(Ry, Rx), Rz);
}

/**
 * The diorama builder.
 *   const b = createBuilder({ tiles, ink, chunker });
 *   b.add(boxGeo(1, 0.5, 1, { round: 0.04 }), { at: [x, y, z], yaw, color: '#c94', tile: 'tweed', rep: 0.4, collide: true });
 *   const out = b.finish(THREE);
 * chunker(x, y, z) → small int: every primitive lands in the chunk of its centroid, and each
 * chunk becomes its own geometry (own bounding sphere → frustum culled per chunk). Without a
 * chunker the whole map is one geometry (the v1 behaviour).
 */
export const BACKDROP = -1;
export function createBuilder({ tiles, ink = [0.11, 0.1, 0.13], chunker = null }) {
  const chunks = new Map(); // key -> { P, N, U, C, T, O, IDX, HULL }
  const chunkOf = (k) => { let c = chunks.get(k); if (!c) { c = { key: k, P: [], N: [], U: [], C: [], T: [], O: [], IDX: [], HULL: [] }; chunks.set(k, c); } return c; };
  const colliders = []; const blobs = []; const probes = []; const spots = {}; const rooms = [];
  const white = tiles.white;
  const tp = []; const tn = [];
  const sm = { grp: new Map(), acc: [], of: [] }; // outline smoothing scratch (reused)

  function colorOf(c) {
    if (Array.isArray(c)) return c;
    let s = String(c || '#ffffff').replace('#', '');
    if (s.length === 3) s = s.split('').map((x) => x + x).join('');
    const v = parseInt(s, 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }

  /**
   * Add a primitive. opts: at [x,y,z], rot [rx,ry,rz] or yaw, color, tile (atlas key), rep (metres per
   * pattern repeat; number or [u,v]), uvOff [u,v], outline (default true), collide (true | box flags),
   * chunk (force a chunk key), backdrop (true: distant scenery, never fogged or culled, not pickable).
   */
  function add(g, opts = {}) {
    const at = opts.at || [0, 0, 0];
    const R = rotMatrix(opts.rot ? opts.rot[0] : 0, opts.rot ? opts.rot[1] : opts.yaw || 0, opts.rot ? opts.rot[2] : 0);
    const col = colorOf(opts.color);
    const tile = (opts.tile && tiles[opts.tile]) || white;
    const rep = opts.rep == null ? 1 : opts.rep;
    const ru = Array.isArray(rep) ? rep[0] : rep; const rv = Array.isArray(rep) ? rep[1] : rep;
    const off = opts.uvOff || [0, 0];
    const n = g.pos.length / 3;
    let sx = 0; let sy = 0; let sz = 0;
    const gp = g.pos; const gn = g.nrm;
    for (let i = 0; i < n; i++) {
      const x = gp[i * 3]; const y = gp[i * 3 + 1]; const z = gp[i * 3 + 2];
      const px = R[0] * x + R[1] * y + R[2] * z + at[0]; const py = R[3] * x + R[4] * y + R[5] * z + at[1]; const pz = R[6] * x + R[7] * y + R[8] * z + at[2];
      const a = gn[i * 3]; const bb = gn[i * 3 + 1]; const c = gn[i * 3 + 2];
      tp[i * 3] = px; tp[i * 3 + 1] = py; tp[i * 3 + 2] = pz;
      tn[i * 3] = R[0] * a + R[1] * bb + R[2] * c; tn[i * 3 + 1] = R[3] * a + R[4] * bb + R[5] * c; tn[i * 3 + 2] = R[6] * a + R[7] * bb + R[8] * c;
      sx += px; sy += py; sz += pz;
    }
    // backdrop: far scenery (skylines, mountains) in its own chunk: no fog, never culled
    const ck = opts.backdrop ? BACKDROP : opts.chunk != null ? opts.chunk : chunker && n ? chunker(sx / n, sy / n, sz / n) : 0;
    const K = chunkOf(ck);
    const { P, N, U, C, T, O, IDX, HULL } = K;
    const base = P.length / 3;
    for (let i = 0; i < n; i++) {
      P.push(tp[i * 3], tp[i * 3 + 1], tp[i * 3 + 2]); N.push(tn[i * 3], tn[i * 3 + 1], tn[i * 3 + 2]);
      U.push(g.uv[i * 2] / ru + off[0], g.uv[i * 2 + 1] / rv + off[1]);
      C.push(col[0], col[1], col[2]);
      T.push(tile[0], tile[1], tile[2], tile[3]);
      O.push(0, 0, 0);
    }
    for (let k = 0; k < g.idx.length; k++) IDX.push(base + g.idx[k]);
    if (opts.outline !== false) {
      // Smoothed push directions: average normals of vertices sharing a position. Grouped on the
      // primitive's local positions with a numeric key (a rigid transform keeps coincident
      // vertices coincident), then rotated like the normals; much cheaper than string keys.
      const grp = sm.grp; const acc = sm.acc; grp.clear();
      let ng = 0;
      for (let i = 0; i < n; i++) {
        const qx = Math.round(gp[i * 3] * 2000); const qy = Math.round(gp[i * 3 + 1] * 2000); const qz = Math.round(gp[i * 3 + 2] * 2000);
        // exact numeric key while |local coord| < 32 m (17 bits each); a string key beyond that
        const k = qx > -65536 && qx < 65536 && qy > -65536 && qy < 65536 && qz > -65536 && qz < 65536 ? (qx + 65536) * 17179869184 + (qy + 65536) * 131072 + (qz + 65536) : `${qx},${qy},${qz}`;
        let gi = grp.get(k);
        if (gi === undefined) { gi = ng++; grp.set(k, gi); acc[gi * 3] = 0; acc[gi * 3 + 1] = 0; acc[gi * 3 + 2] = 0; }
        sm.of[i] = gi;
        acc[gi * 3] += gn[i * 3]; acc[gi * 3 + 1] += gn[i * 3 + 1]; acc[gi * 3 + 2] += gn[i * 3 + 2];
      }
      const hb = P.length / 3;
      for (let i = 0; i < n; i++) {
        const gi = sm.of[i]; const a = acc[gi * 3]; const bb = acc[gi * 3 + 1]; const c = acc[gi * 3 + 2];
        const ox = R[0] * a + R[1] * bb + R[2] * c; const oy = R[3] * a + R[4] * bb + R[5] * c; const oz = R[6] * a + R[7] * bb + R[8] * c;
        const L = Math.hypot(ox, oy, oz) || 1;
        P.push(tp[i * 3], tp[i * 3 + 1], tp[i * 3 + 2]);
        N.push(-tn[i * 3], -tn[i * 3 + 1], -tn[i * 3 + 2]);
        U.push(0, 0); C.push(ink[0], ink[1], ink[2]); T.push(white[0], white[1], white[2], white[3]);
        O.push(ox / L, oy / L, oz / L);
      }
      for (let k = 0; k < g.idx.length; k += 3) HULL.push(hb + g.idx[k], hb + g.idx[k + 2], hb + g.idx[k + 1]);
    }
    if (opts.collide) {
      let minX = Infinity; let minY = Infinity; let minZ = Infinity; let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
      for (let i = 0; i < n; i++) {
        const x = tp[i * 3]; const y = tp[i * 3 + 1]; const z = tp[i * 3 + 2];
        if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
      }
      const c = typeof opts.collide === 'object' ? opts.collide : {};
      collide(minX, minY, minZ, maxX, maxY, maxZ, c);
    }
    return base;
  }

  /**
   * Axis-aligned collider. flags: { wall: bool (can flatten against), name, ceil (an overhead
   * surface), perch (thin: rails, poles, stems), climb: false (sticky feet slide off) }.
   * Names prefixed 'ceil:' / 'perch:' set those flags too.
   */
  function collide(minX, minY, minZ, maxX, maxY, maxZ, flags = {}) {
    const name = flags.name || '';
    colliders.push({
      minX, minY, minZ, maxX, maxY, maxZ, wall: flags.wall !== false, name,
      ceil: flags.ceil != null ? !!flags.ceil : name.startsWith('ceil:') ? true : undefined,
      perch: flags.perch != null ? !!flags.perch : name.startsWith('perch:') ? true : undefined,
      climb: flags.climb === false ? false : undefined,
    });
  }

  /** Soft contact shadow on a horizontal surface at height y. */
  function blob(x, z, rx, rz = rx, { y = 0.004, a = 0.32, yaw = 0 } = {}) {
    blobs.push({ x, y, z, rx, rz, a, yaw });
  }
  function probe(name, point, normal, hex) { probes.push({ name, point, normal, hex }); }
  function spot(name, v) { spots[name] = v; }
  /** Label a room (culling, minimap, preview). floor: index into info.floors (default 0). */
  function room(name, x0, z0, x1, z1, o = {}) { rooms.push({ name, x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), floor: o.floor || 0, landmark: o.landmark || '' }); }

  function finishChunk(THREE, K) {
    const { P, N, U, C, T, O, IDX, HULL } = K;
    const vcount = P.length / 3;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    geo.setAttribute('tile', new THREE.Float32BufferAttribute(T, 4));
    geo.setAttribute('onrm', new THREE.Float32BufferAttribute(O, 3));
    const all = IDX.concat(HULL);
    const Arr = vcount > 65535 ? Uint32Array : Uint16Array;
    geo.setIndex(new THREE.BufferAttribute(new Arr(all), 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return { key: K.key, backdrop: K.key === BACKDROP, geometry: geo, mainIndexCount: IDX.length, hullIndexCount: HULL.length, vertexCount: vcount };
  }

  function finish(THREE) {
    if (!chunks.size) chunkOf(0);
    const parts = [...chunks.values()].sort((a, b) => a.key - b.key).filter((k) => k.IDX.length || chunks.size === 1).map((K) => finishChunk(THREE, K));
    // Blob shadows: one merged quad mesh.
    const bp = []; const bu = []; const bi = []; const ba = [];
    for (const b of blobs) {
      const k = bp.length / 3; const c = Math.cos(b.yaw); const s = Math.sin(b.yaw);
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = u * b.rx * 1.25; const lz = v * b.rz * 1.25;
        bp.push(b.x + lx * c + lz * s, b.y, b.z - lx * s + lz * c); bu.push((u + 1) / 2, (v + 1) / 2); ba.push(b.a);
      }
      bi.push(k, k + 2, k + 1, k, k + 3, k + 2);
    }
    let blobGeo = null;
    if (blobs.length) {
      blobGeo = new THREE.BufferGeometry();
      blobGeo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
      blobGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bu, 2));
      blobGeo.setAttribute('alpha', new THREE.Float32BufferAttribute(ba, 1));
      blobGeo.setIndex(bi);
      blobGeo.computeBoundingSphere();
    }
    const vertexCount = parts.reduce((s2, c) => s2 + c.vertexCount, 0);
    const triCount = parts.reduce((s2, c) => s2 + (c.mainIndexCount + c.hullIndexCount) / 3, 0);
    return {
      chunks: parts, geometry: parts[0].geometry, mainIndexCount: parts[0].mainIndexCount, hullIndexCount: parts[0].hullIndexCount,
      vertexCount, triCount, colliders, blobs, blobGeo, probes, spots, rooms,
    };
  }

  return { add, collide, blob, probe, spot, room, finish, colorOf };
}
