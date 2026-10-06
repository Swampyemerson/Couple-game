// The cats of 8524 Boulder Way. Purely visual and local: never solid, never in a car's way. Each cat
// is one small merged mesh (vertex colours for its coat) plus a tail drawn as one shared
// InstancedMesh. animateCats(t, cars) flicks tails, turns heads a touch and, when a car comes within
// a few metres of a cat on the ground, the cat hops up to its safe perch (wall top or porch roof)
// and comes back down a while after the cars have gone. Deterministic from t; no network sync.

const COATS = {
  orange: { base: '#e8913a', patch: '#f6c48a', stripe: '#c46a1e', tail: '#d97c2a' },
  black: { base: '#25262b', patch: '#35363c', stripe: '#1b1c20', tail: '#25262b' },
  grey: { base: '#8d9198', patch: '#b3b7bd', stripe: '#6c7077', tail: '#7f838a' },
  calico: { base: '#f4efe6', patch: '#e08a3c', stripe: '#2b2b2e', tail: '#e08a3c' },
  white: { base: '#f7f5f0', patch: '#ffffff', stripe: '#e7e2d8', tail: '#f2efe8' },
  tabby: { base: '#a8865a', patch: '#d8c19a', stripe: '#6f5434', tail: '#8f7048' },
};
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

let STATE = null;

function catGeometry(THREE, coat, pose) {
  const P = [], Cc = [];
  const k = COATS[coat] || COATS.orange;
  const base = hex(k.base), patch = hex(k.patch), stripe = hex(k.stripe);
  const pink = hex('#f0a0a8'), eye = hex('#3c8a3a');
  const tri = (a, b, c, col) => { P.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) Cc.push(...col); };
  const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };
  const box = (x, y, z, w, h, d, side, top, front) => {
    const x0 = x - w / 2, x1 = x + w / 2, y0 = y, y1 = y + h, z0 = z - d / 2, z1 = z + d / 2;
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], front || side); // +z (face)
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], side);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], side);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top || side);
  };
  // The cat faces +z. Scale: a real cat, a bit chunky so it reads from a car (~0.5 m long).
  const s = 1.6;
  if (pose === 'loaf') {
    box(0, 0, 0, 0.26 * s, 0.2 * s, 0.42 * s, base, coat === 'calico' ? patch : base);
    box(0, 0.12 * s, 0.22 * s, 0.2 * s, 0.17 * s, 0.17 * s, base, base, coat === 'calico' ? patch : base);
  } else {
    // sitting: haunches, upright chest
    box(0, 0, -0.04 * s, 0.26 * s, 0.17 * s, 0.3 * s, base, coat === 'calico' ? patch : base);
    box(0, 0.12 * s, 0.06 * s, 0.2 * s, 0.22 * s, 0.17 * s, base, base, coat === 'white' || coat === 'calico' ? patch : base);
    box(0, 0.32 * s, 0.09 * s, 0.2 * s, 0.17 * s, 0.17 * s, base, base, coat === 'calico' ? patch : base);
  }
  const hy = pose === 'loaf' ? 0.29 * s : 0.49 * s, hz = pose === 'loaf' ? 0.22 * s : 0.09 * s;
  // ears
  for (const sx of [-1, 1]) {
    tri([sx * 0.1 * s, hy, hz - 0.02 * s], [sx * 0.03 * s, hy, hz - 0.02 * s], [sx * 0.075 * s, hy + 0.09 * s, hz - 0.03 * s], base);
    tri([sx * 0.09 * s, hy + 0.005, hz + 0.0], [sx * 0.045 * s, hy + 0.005, hz + 0.0], [sx * 0.075 * s, hy + 0.07 * s, hz - 0.01 * s], pink);
  }
  // eyes + nose on the face (+z side of the head)
  const fz = hz + 0.086 * s + 0.002;
  const ey = hy - 0.07 * s;
  for (const sx of [-1, 1]) quad([sx * 0.06 * s - 0.018, ey - 0.012, fz], [sx * 0.06 * s + 0.018, ey - 0.012, fz], [sx * 0.06 * s + 0.018, ey + 0.016, fz], [sx * 0.06 * s - 0.018, ey + 0.016, fz], coat === 'black' ? hex('#e8c53a') : eye);
  tri([-0.015, ey - 0.05, fz], [0.015, ey - 0.05, fz], [0, ey - 0.07, fz], pink);
  // tabby stripes / calico patch on the back
  if (coat === 'tabby' || coat === 'orange' || coat === 'grey') {
    const top = pose === 'loaf' ? 0.2 * s + 0.003 : 0.17 * s + 0.003;
    for (let i = 0; i < 3; i++) { const z = -0.12 * s + i * 0.09 * s; quad([-0.13 * s, top, z + 0.02], [0.13 * s, top, z + 0.02], [0.13 * s, top, z - 0.01], [-0.13 * s, top, z - 0.01], stripe); }
  }
  if (coat === 'calico') {
    const top = pose === 'loaf' ? 0.2 * s + 0.004 : 0.17 * s + 0.004;
    quad([-0.13 * s, top, 0.02], [0.02, top, 0.02], [0.02, top, -0.12], [-0.13 * s, top, -0.12], stripe);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
  g.computeVertexNormals();
  return { g, headY: hy };
}

function tailGeometry(THREE) {
  // a tapered 4-sided tail, 0.32 m long, rooted at the origin, pointing -z and curling up
  const P = [];
  const segs = [[0, 0.05, 0, 0.035], [0, 0.07, -0.12, 0.03], [0, 0.14, -0.22, 0.026], [0, 0.26, -0.27, 0.02], [0, 0.36, -0.24, 0.012]];
  for (let i = 0; i < segs.length - 1; i++) {
    const [ax, ay, az, ar] = segs[i], [bx, by, bz, br] = segs[i + 1];
    const ring = (x, y, z, r) => [[x - r, y, z], [x, y + r, z], [x + r, y, z], [x, y - r, z]];
    const A = ring(ax, ay, az, ar), B = ring(bx, by, bz, br);
    for (let k = 0; k < 4; k++) { const a = A[k], b = A[(k + 1) % 4], c = B[(k + 1) % 4], d = B[k]; P.push(...a, ...b, ...c, ...a, ...c, ...d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  g.scale(1.6, 1.6, 1.6);
  return g;
}

export function makeCats(THREE, mat, cats, home, L) {
  const group = new THREE.Group();
  group.name = 'santee-cats';
  const tailMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const tails = new THREE.InstancedMesh(tailGeometry(THREE), tailMat, cats.length);
  tails.name = 'cat-tails';
  tails.userData.noMerge = true;
  tails.frustumCulled = false;
  const list = [];
  const c = Math.cos(home.rot), s = Math.sin(home.rot);
  const H = L.height;
  cats.forEach((k, i) => {
    const { g } = catGeometry(THREE, k.coat, k.pose);
    const m = new THREE.Mesh(g, mat);
    m.name = `cat-${k.coat}`;
    m.userData.noMerge = true; // animated: keep out of the chunk merge
    const y = k.y + Math.max(0, H(k.x, k.z));
    m.position.set(k.x, y, k.z);
    m.rotation.y = k.yaw;
    group.add(m);
    const col = new THREE.Color(COATS[k.coat].tail);
    if (tails.setColorAt) tails.setColorAt(i, col);
    // safe perch: ground cats hop onto the porch roof edge or the side wall top
    const ground = k.y < 0.3;
    const L2 = (lx, lz) => [home.x + c * lx + s * lz, home.z - s * lx + c * lz];
    const perch = ground ? (i % 2 ? L2(home.w / 2 + 0.6, -home.d / 2 + 2 + i * 0.6) : L2(-2.2 + (i - 2) * 0.7, -home.d / 2 - 1.8)) : [k.x, k.z];
    const perchY = ground ? (i % 2 ? 1.95 : 3.55) : y;
    list.push({ m, home: [k.x, y, k.z], perch: [perch[0], perchY, perch[1]], ground, yaw: k.yaw, pose: k.pose, up: 0, target: 0, quiet: 0, phase: i * 1.7 + 0.3 });
  });
  if (tails.instanceColor) tails.instanceColor.needsUpdate = true;
  group.add(tails);
  STATE = { list, tails, m4: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), sc: new THREE.Vector3(1, 1, 1), last: null, group, center: [home.x, home.z] };
  animateCats(0, []);
  return group;
}

export function animateCats(t, cars) {
  const S = STATE;
  if (!S) return;
  const dt = S.last == null ? 0 : Math.min(0.1, Math.max(0, t - S.last));
  S.last = t;
  const near = (x, z, r) => { if (!cars) return false; for (const c of cars) { if (!c) continue; const dx = c.x - x, dz = c.z - z; if (dx * dx + dz * dz < r * r) return true; } return false; };
  // hide the whole group when no car is within 260 m (saves a few draw calls)
  if (cars && cars.length) S.group.visible = near(S.center[0], S.center[1], 260);
  S.list.forEach((k, i) => {
    if (k.ground) {
      if (near(k.home[0], k.home[2], 11) || near(k.m.position.x, k.m.position.z, 9)) { k.target = 1; k.quiet = 0; }
      else { k.quiet += dt; if (k.quiet > 6) k.target = 0; }
      k.up += Math.sign(k.target - k.up) * Math.min(Math.abs(k.target - k.up), dt * 2.2);
      const u = k.up;
      const x = k.home[0] + (k.perch[0] - k.home[0]) * u, z = k.home[2] + (k.perch[2] - k.home[2]) * u;
      const y = k.home[1] + (k.perch[1] - k.home[1]) * u + Math.sin(u * Math.PI) * 1.4;
      k.m.position.set(x, y, z);
    }
    // a gentle head-turn: the whole cat turns a few degrees now and then
    const look = Math.sin(t * 0.37 + k.phase) > 0.85 ? Math.sin(t * 2.1 + k.phase) * 0.35 : 0;
    k.m.rotation.y = k.yaw + look;
    // breathing
    const br = 1 + Math.sin(t * 2.4 + k.phase) * 0.015;
    k.m.scale.set(1, br, 1);
    // tail: flick (fast sway now and then) and a slow idle swish
    const flick = Math.max(0, Math.sin(t * 0.9 + k.phase * 2)) ** 6;
    const sway = Math.sin(t * 1.3 + k.phase) * 0.25 + Math.sin(t * 9 + k.phase) * 0.5 * flick;
    const p = k.m.position;
    const back = k.pose === 'loaf' ? -0.24 : -0.2;
    const cy = Math.cos(k.m.rotation.y), sy = Math.sin(k.m.rotation.y);
    S.v.set(p.x + sy * back * 1.6, p.y + 0.03, p.z + cy * back * 1.6);
    S.e.set(0, k.m.rotation.y + sway, k.pose === 'loaf' ? 0.0 : 0);
    S.q.setFromEuler(S.e);
    S.m4.compose(S.v, S.q, S.sc);
    S.tails.setMatrixAt(i, S.m4);
  });
  S.tails.instanceMatrix.needsUpdate = true;
}
