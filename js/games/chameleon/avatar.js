// The chameleon: a chunky creature built from primitives. Every skin part owns a rectangle of
// one 128×128 paint texture (UVs remapped into it), so a single material per avatar covers the
// whole body. At load we rasterise the parts into that atlas to get, per texel, which part it
// belongs to and its local position + normal: painting then happens in 3D (see paint.js).
// Eyes (pupil + white ring) are not paintable: they are the only giveaway.
import { sphereGeo, tubeGeo } from './geo.js';
import { clamp, lerp, damp } from './util.js';

export const TEX = 128;
export const POSES = ['stand', 'crouch', 'wall', 'ball', 'flat'];
export const POSE_LABEL = { stand: 'Stand', crouch: 'Crouch', wall: 'Wall', ball: 'Ball', flat: 'Flat' };
// Fill regions (part groups)
export const REGIONS = { body: [0], head: [1, 2, 3, 4], tail: [5], legs: [6, 7, 8, 9] };
export const REGION_OF_PART = [0, 1, 1, 1, 1, 2, 3, 3, 3, 3]; // index into ['body','head','tail','legs']
export const REGION_NAMES = ['body', 'head', 'tail', 'legs'];

// Atlas rectangles in texels (x, y from the bottom, w, h), and whether to swap the part's u/v.
const RECTS = [
  { name: 'body', r: [0, 52, 76, 76] },
  { name: 'head', r: [76, 76, 52, 52] },
  { name: 'casque', r: [76, 52, 26, 24] },
  { name: 'eyeL', r: [102, 52, 13, 24] },
  { name: 'eyeR', r: [115, 52, 13, 24] },
  { name: 'tail', r: [0, 28, 128, 24], swap: true },
  { name: 'legFL', r: [0, 0, 32, 28] },
  { name: 'legFR', r: [32, 0, 32, 28] },
  { name: 'legBL', r: [64, 0, 32, 28] },
  { name: 'legBR', r: [96, 0, 32, 28] },
];

// Pivot (part origin) positions in avatar space for the standing pose.
const PIV = {
  body: [0, 0.225, -0.03],
  head: [0, 0.275, 0.18],
  tail: [0, 0.215, -0.28],
  legFL: [0.125, 0.17, 0.13], legFR: [-0.125, 0.17, 0.13],
  legBL: [0.125, 0.17, -0.16], legBR: [-0.125, 0.17, -0.16],
};
const EYE = { L: [0.108, 0.075, 0.125], R: [-0.108, 0.075, 0.125] }; // relative to the head pivot

function remapUV(g, rect, swap) {
  const [x, y, w, h] = rect;
  const inset = 1.5;
  for (let i = 0; i < g.uv.length; i += 2) {
    let u = g.uv[i]; let v = g.uv[i + 1];
    if (swap) { const t = u; u = v; v = t; }
    g.uv[i] = (x + inset + u * (w - inset * 2)) / TEX;
    g.uv[i + 1] = (y + inset + v * (h - inset * 2)) / TEX;
  }
  return g;
}

function legGeo(side) {
  // hip (origin) → knee → ankle, then a mitten foot
  const s = side;
  const pts = [[0, 0, 0], [s * 0.045, -0.015, 0.005], [s * 0.085, -0.03, 0.01], [s * 0.1, -0.08, 0.015], [s * 0.1, -0.145, 0.02]];
  const leg = tubeGeo(pts, (t) => 0.05 - t * 0.012, { radial: 10, capEnd: false, capStart: true });
  const foot = sphereGeo(0.045, 0.026, 0.058, { w: 10, h: 6, metres: false });
  // squash leg uv into the top 70% of the rect, foot into the bottom 30%
  for (let i = 1; i < leg.uv.length; i += 2) leg.uv[i] = 0.3 + leg.uv[i] * 0.7;
  for (let i = 0; i < foot.uv.length; i += 2) { foot.uv[i + 1] *= 0.3; }
  const off = leg.pos.length / 3;
  for (let i = 0; i < foot.pos.length; i += 3) { leg.pos.push(foot.pos[i] + s * 0.1, foot.pos[i + 1] - 0.15, foot.pos[i + 2] + 0.04); }
  leg.nrm.push(...foot.nrm); leg.uv.push(...foot.uv);
  for (const k of foot.idx) leg.idx.push(k + off);
  return leg;
}

function tailGeo() {
  const pts = [];
  const N = 40;
  // back, then curling down into a spiral under itself
  const c = [0, -0.085, -0.17]; // spiral centre relative to the tail pivot
  for (let k = 0; k <= N; k++) {
    const s = k / N;
    if (s < 0.18) {
      const t = s / 0.18;
      pts.push([0, 0.01 * Math.sin(t * 3), -0.02 - t * 0.15]);
    } else {
      const t = (s - 0.18) / 0.82;
      const ang = Math.PI / 2 + 0.35 - t * Math.PI * 2 * 1.3;
      const rad = 0.105 * (1 - 0.72 * t);
      pts.push([0, c[1] + Math.sin(ang) * rad, c[2] - Math.cos(ang) * rad * 1.0 - 0.02]);
    }
  }
  // smooth the joint
  for (let pass = 0; pass < 2; pass++) for (let k = 1; k < pts.length - 1; k++) for (let a = 0; a < 3; a++) pts[k][a] = (pts[k - 1][a] + pts[k][a] * 2 + pts[k + 1][a]) / 4;
  return tubeGeo(pts, (t) => 0.072 * (1 - t) + 0.016, { radial: 10, capEnd: true, capStart: false });
}

function bodyGeo() {
  const g = sphereGeo(0.175, 0.158, 0.27, { w: 22, h: 14, metres: false });
  // dorsal ridge + flatter belly + slightly fuller rump
  for (let i = 0; i < g.pos.length; i += 3) {
    const x = g.pos[i]; let y = g.pos[i + 1]; let z = g.pos[i + 2];
    const ny = y / 0.158;
    if (ny > 0) y += 0.035 * Math.pow(ny, 6) * (1 - Math.abs(x) / 0.175);
    else y *= 0.86;
    z *= 1 + 0.06 * (z < 0 ? 1 : 0);
    g.pos[i + 1] = y; g.pos[i + 2] = z;
  }
  recomputeNormals(g);
  return g;
}

function headGeo() {
  const g = sphereGeo(0.138, 0.128, 0.16, { w: 22, h: 14, metres: false });
  for (let i = 0; i < g.pos.length; i += 3) {
    const y = g.pos[i + 1]; const z = g.pos[i + 2];
    const fz = Math.max(0, z / 0.16);
    const bz = Math.max(0, -z / 0.16);
    g.pos[i + 2] = z * (1 + 0.34 * fz * fz); // long snout
    g.pos[i + 1] = y * (1 - 0.22 * fz) - 0.022 * fz + (y > 0 ? 0.03 * bz : 0); // tapered snout, raised back of the skull
    g.pos[i] *= 1 - 0.26 * fz * fz;
  }
  recomputeNormals(g);
  // pivot at the neck: head centre sits forward + up from it
  for (let i = 0; i < g.pos.length; i += 3) { g.pos[i + 1] += 0.03; g.pos[i + 2] += 0.09; }
  return g;
}

function casqueGeo() {
  // a smooth helmet crest: a thin, swept-back half-ellipsoid
  const g = sphereGeo(0.03, 0.085, 0.1, { w: 14, h: 8, metres: false, thetaMax: Math.PI * 0.62 });
  for (let i = 0; i < g.pos.length; i += 3) { const y = g.pos[i + 1]; g.pos[i + 2] -= y * 0.55; }
  recomputeNormals(g);
  return g;
}

/** Smooth vertex normals from triangles (merging coincident vertices). */
function recomputeNormals(g) {
  const n = g.pos.length / 3;
  const acc = new Float32Array(n * 3);
  const key = (i) => `${Math.round(g.pos[i * 3] * 1e4)},${Math.round(g.pos[i * 3 + 1] * 1e4)},${Math.round(g.pos[i * 3 + 2] * 1e4)}`;
  const groups = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  for (let t = 0; t < g.idx.length; t += 3) {
    const a = g.idx[t]; const b = g.idx[t + 1]; const c = g.idx[t + 2];
    const ux = g.pos[b * 3] - g.pos[a * 3]; const uy = g.pos[b * 3 + 1] - g.pos[a * 3 + 1]; const uz = g.pos[b * 3 + 2] - g.pos[a * 3 + 2];
    const vx = g.pos[c * 3] - g.pos[a * 3]; const vy = g.pos[c * 3 + 1] - g.pos[a * 3 + 1]; const vz = g.pos[c * 3 + 2] - g.pos[a * 3 + 2];
    const cx = uy * vz - uz * vy; const cy = uz * vx - ux * vz; const cz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { acc[v * 3] += cx; acc[v * 3 + 1] += cy; acc[v * 3 + 2] += cz; }
  }
  for (const ids of groups.values()) {
    let x = 0; let y = 0; let z = 0;
    for (const i of ids) { x += acc[i * 3]; y += acc[i * 3 + 1]; z += acc[i * 3 + 2]; }
    const L = Math.hypot(x, y, z) || 1;
    for (const i of ids) { g.nrm[i * 3] = x / L; g.nrm[i * 3 + 1] = y / L; g.nrm[i * 3 + 2] = z / L; }
  }
}

function toBuffer(THREE, g) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
  geo.setIndex(g.idx);
  geo.computeBoundingSphere();
  return geo;
}

/** Rasterise every part's triangles into the texel map: part id, local position, local normal. */
function rasterise(parts) {
  const N = TEX * TEX;
  const part = new Int8Array(N).fill(-1);
  const lpos = new Float32Array(N * 3);
  const lnrm = new Float32Array(N * 3);
  parts.forEach((g, pi) => {
    const { pos, nrm, uv, idx } = g;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]; const b = idx[t + 1]; const c = idx[t + 2];
      const ax = uv[a * 2] * TEX; const ay = uv[a * 2 + 1] * TEX;
      const bx = uv[b * 2] * TEX; const by = uv[b * 2 + 1] * TEX;
      const cx = uv[c * 2] * TEX; const cy = uv[c * 2 + 1] * TEX;
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))); const x1 = Math.min(TEX - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))); const y1 = Math.min(TEX - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5; const py = y + 0.5;
        const w1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den;
        const w2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
        const w3 = 1 - w1 - w2;
        if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue;
        const i = y * TEX + x;
        part[i] = pi;
        for (let k = 0; k < 3; k++) {
          lpos[i * 3 + k] = pos[a * 3 + k] * w1 + pos[b * 3 + k] * w2 + pos[c * 3 + k] * w3;
          lnrm[i * 3 + k] = nrm[a * 3 + k] * w1 + nrm[b * 3 + k] * w2 + nrm[c * 3 + k] * w3;
        }
        const L = Math.hypot(lnrm[i * 3], lnrm[i * 3 + 1], lnrm[i * 3 + 2]) || 1;
        lnrm[i * 3] /= L; lnrm[i * 3 + 1] /= L; lnrm[i * 3 + 2] /= L;
      }
    }
  });
  // dilate 2 px into the gutters so filtering never shows unpainted texels
  for (let pass = 0; pass < 2; pass++) {
    const src = part.slice();
    for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      if (src[i] >= 0) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx; const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= TEX || yy >= TEX) continue;
        const j = yy * TEX + xx;
        if (src[j] < 0) continue;
        part[i] = src[j];
        for (let k = 0; k < 3; k++) { lpos[i * 3 + k] = lpos[j * 3 + k]; lnrm[i * 3 + k] = lnrm[j * 3 + k]; }
        break;
      }
    }
  }
  const list = [];
  for (let i = 0; i < N; i++) if (part[i] >= 0) list.push(i);
  return { part, lpos, lnrm, list: Int32Array.from(list) };
}

/** Shared geometry + texel map (built once, used by both avatars). */
export function createKit(THREE) {
  const raw = [
    remapUV(bodyGeo(), RECTS[0].r),
    remapUV(headGeo(), RECTS[1].r),
    remapUV(casqueGeo(), RECTS[2].r),
    remapUV(sphereGeo(0.074, 0.074, 0.074, { w: 14, h: 10, metres: false }), RECTS[3].r),
    remapUV(sphereGeo(0.074, 0.074, 0.074, { w: 14, h: 10, metres: false }), RECTS[4].r),
    remapUV(tailGeo(), RECTS[5].r, true),
    remapUV(legGeo(1), RECTS[6].r),
    remapUV(legGeo(-1), RECTS[7].r),
    remapUV(legGeo(1), RECTS[8].r),
    remapUV(legGeo(-1), RECTS[9].r),
  ];
  const geos = raw.map((g) => toBuffer(THREE, g));
  const texels = rasterise(raw);
  // pupil + white ring (vertex coloured), facing +z of the eye turret
  const ring = sphereGeo(0.03, 0.03, 0.012, { w: 12, h: 6, metres: false });
  const pupil = sphereGeo(0.019, 0.019, 0.01, { w: 10, h: 6, metres: false });
  const ep = []; const en = []; const ec = []; const ei = [];
  const put = (g, z, col) => {
    const o = ep.length / 3;
    for (let i = 0; i < g.pos.length; i += 3) { ep.push(g.pos[i], g.pos[i + 1], g.pos[i + 2] + z); en.push(g.nrm[i], g.nrm[i + 1], g.nrm[i + 2]); ec.push(...col); }
    for (const k of g.idx) ei.push(k + o);
  };
  put(ring, 0.066, [1, 0.98, 0.94]);
  put(pupil, 0.074, [0.08, 0.07, 0.09]);
  const eyeGeo = new THREE.BufferGeometry();
  eyeGeo.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
  eyeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(en, 3));
  eyeGeo.setAttribute('color', new THREE.Float32BufferAttribute(ec, 3));
  eyeGeo.setIndex(ei);
  eyeGeo.computeBoundingSphere();
  const blobGeo = new THREE.PlaneGeometry(1, 1);
  blobGeo.rotateX(-Math.PI / 2);
  const bc = document.createElement('canvas'); bc.width = bc.height = 64;
  const bg = bc.getContext('2d');
  const gr = bg.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.5, '#bbb'); gr.addColorStop(1, '#000');
  bg.fillStyle = gr; bg.fillRect(0, 0, 64, 64);
  const blobTex = new THREE.CanvasTexture(bc);
  return {
    geos, texels, eyeGeo, blobGeo, blobTex,
    dispose() { geos.forEach((g) => g.dispose()); eyeGeo.dispose(); blobGeo.dispose(); blobTex.dispose(); },
  };
}

// Pose targets: per part [px,py,pz, rx,ry,rz, sx,sy,sz] (position relative to the stand pivot).
const Z = [0, 0, 0, 0, 0, 0, 1, 1, 1];
const POSE_DEF = {
  stand: { body: Z, head: [0, 0, 0, -0.08, 0, 0, 1, 1, 1], tail: Z, legs: [0, 0, 0, 0, 0, 0, 1, 1, 1] },
  crouch: { body: [0, -0.06, 0, 0.05, 0, 0, 1.08, 0.9, 1.0], head: [0, -0.07, -0.02, 0.18, 0, 0, 1, 1, 1], tail: [0, -0.06, 0.02, 0.12, 0, 0, 1, 1, 1], legs: [0, -0.05, 0, 0, 0, 0.45, 1, 0.65, 1] },
  ball: { body: [0, -0.02, 0.02, 0, 0, 0, 1.22, 1.24, 0.86], head: [0, -0.09, -0.12, 0.95, 0, 0, 0.92, 0.92, 0.92], tail: [0, -0.06, 0.12, -0.45, 0, 0, 0.9, 0.9, 0.9], legs: [0, -0.03, 0, 0, 0, 0, 0.01, 0.01, 0.01] },
  flat: { body: [0, -0.145, 0, 0, 0, 0, 1.3, 0.52, 1.1], head: [0, -0.19, 0.03, -0.05, 0, 0, 1.08, 0.72, 1.02], tail: [0, -0.15, 0.03, 0, 0, Math.PI / 2, 1, 1, 1.0], legs: [0, -0.13, 0, 0, 0, 0.9, 1, 0.85, 1] },
};
POSE_DEF.wall = POSE_DEF.flat;
const LEG_SIDE = { legFL: 1, legFR: -1, legBL: 1, legBR: -1 };

/**
 * One chameleon. paint: a paint object (paint.js) providing .texture.
 * root (Object3D): position = feet, rotation.y = yaw. model: inner group (wall tilt, bob).
 */
export function createAvatar(THREE, kit, { gradientMap, texture }) {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);
  const mat = new THREE.MeshToonMaterial({ map: texture, gradientMap });
  const eyeMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, emissive: new THREE.Color(0x000000) });
  const mk = (i) => { const m = new THREE.Mesh(kit.geos[i], mat); m.userData.part = i; return m; };
  const piv = {};
  for (const k of ['body', 'head', 'tail', 'legFL', 'legFR', 'legBL', 'legBR']) { piv[k] = new THREE.Group(); piv[k].position.fromArray(PIV[k]); model.add(piv[k]); }
  const meshes = [];
  const body = mk(0); piv.body.add(body); meshes.push(body);
  const head = mk(1); piv.head.add(head); meshes.push(head);
  const casque = mk(2); casque.position.set(0, 0.105, 0.0); casque.rotation.x = 0; piv.head.add(casque); meshes.push(casque);
  const eyes = [];
  for (const [side, pi] of [['L', 3], ['R', 4]]) {
    const turret = new THREE.Group();
    turret.position.fromArray(EYE[side]);
    piv.head.add(turret);
    const skin = mk(pi); turret.add(skin); meshes.push(skin);
    const look = new THREE.Group(); turret.add(look);
    const pup = new THREE.Mesh(kit.eyeGeo, eyeMat);
    look.add(pup);
    eyes.push({ side, turret, look, pup, skin, baseYaw: side === 'L' ? 0.55 : -0.55 });
  }
  const tail = mk(5); piv.tail.add(tail); meshes.push(tail);
  for (const [k, i] of [['legFL', 6], ['legFR', 7], ['legBL', 8], ['legBR', 9]]) { const m = mk(i); piv[k].add(m); meshes.push(m); }
  // order meshes by part index for the paint system
  meshes.sort((a, b) => a.userData.part - b.userData.part);
  // reveal outline (found / recap only): inverted hulls pushed along the normals
  const hullMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xffd23f) }, uW: { value: 0.014 } },
    vertexShader: 'uniform float uW; void main() { vec3 p = position + normal * uW; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }',
    side: THREE.BackSide,
  });
  const hulls = meshes.map((m) => { const h = new THREE.Mesh(m.geometry, hullMat); h.visible = false; h.raycast = () => {}; m.add(h); return h; });

  // blob shadow
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x3a2a1c, alphaMap: kit.blobTex, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const blob = new THREE.Mesh(kit.blobGeo, blobMat);
  blob.scale.set(0.62, 1, 0.72);
  blob.renderOrder = 1;

  // pose blending state
  const cur = { body: Z.slice(), head: POSE_DEF.stand.head.slice(), tail: Z.slice(), legs: Z.slice() };
  let poseName = 'stand';
  const st = {
    pose: 'stand',
    walk: 0, walkPhase: 0, speed: 0,
    lookYaw: 0, lookPitch: 0,
    blinkT: 2 + Math.random() * 3, blink: 0,
    glintUntil: 0,
    wallN: null, // [x, y, z] wall normal for the wall pose
    breathe: true,
  };

  function setPose(name, instant = false) {
    if (!POSE_DEF[name]) name = 'stand';
    poseName = name; st.pose = name;
    if (instant) for (const k of ['body', 'head', 'tail', 'legs']) for (let i = 0; i < 9; i++) cur[k][i] = POSE_DEF[name][k][i];
  }

  function applyPart(obj, base, v, extra = 0, side = 1) {
    obj.position.set(base[0] + v[0], base[1] + v[1], base[2] + v[2]);
    obj.rotation.set(v[3] + extra, v[4], v[5] * side);
    obj.scale.set(v[6], v[7], v[8]);
  }

  const tmpQ = new THREE.Quaternion();
  const tmpM = new THREE.Matrix4();
  const vx = new THREE.Vector3(); const vy = new THREE.Vector3(); const vz = new THREE.Vector3();

  /** Per-frame: blend pose, walk cycle, eyes, blink, glint. now = seconds (local). */
  function update(dt, now) {
    const tgt = POSE_DEF[poseName];
    const k = 1 - Math.exp(-14 * dt);
    for (const p of ['body', 'head', 'tail', 'legs']) for (let i = 0; i < 9; i++) cur[p][i] += (tgt[p][i] - cur[p][i]) * k;
    // walk cycle
    st.walk = damp(st.walk, clamp(st.speed / 2.6, 0, 1), 10, dt);
    st.walkPhase += dt * (4 + st.speed * 4.2);
    const sw = Math.sin(st.walkPhase) * 0.65 * st.walk;
    const bob = Math.abs(Math.sin(st.walkPhase)) * 0.025 * st.walk;
    const br = st.breathe ? Math.sin(now * 2.4) * 0.012 : 0;
    applyPart(piv.body, PIV.body, cur.body);
    piv.body.scale.y *= 1 + br; piv.body.scale.x *= 1 + br * 0.6;
    piv.body.position.y += bob;
    applyPart(piv.head, PIV.head, cur.head, Math.sin(st.walkPhase * 2) * 0.04 * st.walk);
    piv.head.position.y += bob;
    applyPart(piv.tail, PIV.tail, cur.tail, 0);
    piv.tail.rotation.y += Math.sin(now * 1.3) * 0.06 + Math.sin(st.walkPhase) * 0.12 * st.walk;
    for (const kk of ['legFL', 'legFR', 'legBL', 'legBR']) {
      const side = LEG_SIDE[kk];
      const ph = (kk === 'legFL' || kk === 'legBR') ? sw : -sw;
      applyPart(piv[kk], PIV[kk], cur.legs, ph, side);
    }
    // eyes: independent swivel toward the look direction, plus idle wander
    const wander = Math.sin(now * 0.7) * 0.25;
    for (const e of eyes) {
      const ly = clamp(st.lookYaw, -1.2, 1.2);
      e.turret.rotation.set(-st.lookPitch * 0.6, e.baseYaw * 0.4 + ly * 0.8 + (e.side === 'L' ? wander : -wander) * 0.3, 0);
      e.look.rotation.set(0, e.baseYaw * 0.6, 0);
    }
    // blink
    st.blinkT -= dt;
    if (st.blinkT <= 0) { st.blink = 0.14; st.blinkT = 2.2 + Math.random() * 3.4; }
    if (st.blink > 0) st.blink -= dt;
    const open = st.blink > 0 ? 0.08 : 1;
    for (const e of eyes) e.pup.scale.set(1, open, 1);
    // glint (emissive flash)
    const g = st.glintUntil > now ? 1 : 0;
    eyeMat.emissive.setScalar(g ? 0.9 : 0);
    // wall pose: tilt the model so the belly faces the wall, head up
    if ((poseName === 'wall') && st.wallN) {
      const n = st.wallN;
      // model basis in root space: up(+y) -> wall normal (in root frame), forward(+z) -> world up
      const cy = Math.cos(root.rotation.y); const sy = Math.sin(root.rotation.y);
      const lnx = n[0] * cy - n[2] * sy; const lnz = n[0] * sy + n[2] * cy;
      vy.set(lnx, n[1], lnz).normalize();
      vz.set(0, 1, 0);
      vx.crossVectors(vy, vz).normalize();
      vz.crossVectors(vx, vy).normalize();
      tmpM.makeBasis(vx, vy, vz);
      tmpQ.setFromRotationMatrix(tmpM);
      model.quaternion.slerp(tmpQ, k);
      model.position.set(0, 0, 0);
    } else {
      tmpQ.identity();
      model.quaternion.slerp(tmpQ, k);
    }
  }

  return {
    root, model, meshes, eyes, blob, mat, eyeMat, st,
    setPose,
    get pose() { return poseName; },
    update,
    setTexture(t) { mat.map = t; mat.needsUpdate = true; },
    /** Visible or not (also hides the blob). */
    setVisible(v) { root.visible = v; blob.visible = v; },
    /** Highlight outline for the reveal (null to hide). */
    setReveal(color, width = 0.014) {
      const on = !!color;
      if (on) { hullMat.uniforms.uColor.value.set(color); hullMat.uniforms.uW.value = width; }
      for (const h of hulls) h.visible = on;
    },
    /** Hide head parts (first-person view from inside the head). */
    setHeadVisible(v) { piv.head.visible = v; },
    eyeWorld(i, out) { return eyes[i].turret.getWorldPosition(out); },
    dispose() { mat.dispose(); eyeMat.dispose(); blobMat.dispose(); hullMat.dispose(); },
    lerpPose: lerp,
  };
}
