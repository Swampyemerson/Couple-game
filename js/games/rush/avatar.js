// Rail Rush runners: one rigid-skinned mesh per runner (primitives + baked ink outline, a single
// draw call), animated procedurally: run cycle driven by distance, lean into lane changes, tuck
// on jumps, forward roll, stumble flail, crash fall, idle, victory, shove lunge. Poses are blended
// with eased weights so nothing pops, and squash & stretch rides on a spring.
import { GeoBuf, mix, FX_PLAIN, FX_GLOW } from './gfx.js';
import { JUMP_V } from './tune.js';

const NJ = 22;
const POSES = 7; // run, air, roll, stumble, crash, idle, win
const P_RUN = 0;
const P_AIR = 1;
const P_ROLL = 2;
const P_STUMBLE = 3;
const P_CRASH = 4;
const P_IDLE = 5;
const P_WIN = 6;
const STRIDE = 7;

const JOINTS = {
  root: [0, 0, 0, -1], hips: [0, 0.95, 0, 0], spine: [0, 1.0, 0, 1], chest: [0, 1.36, 0, 2], head: [0, 1.62, 0, 3],
  shL: [-0.31, 1.5, 0, 3], elL: [-0.33, 1.18, 0, 5], shR: [0.31, 1.5, 0, 3], elR: [0.33, 1.18, 0, 7],
  hipL: [-0.13, 0.94, 0, 1], knL: [-0.13, 0.52, 0, 9], hipR: [0.13, 0.94, 0, 1], knR: [0.13, 0.52, 0, 11],
  tail: [0, 2.0, 0.24, 4],
};
const ORDER = ['root', 'hips', 'spine', 'chest', 'head', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'hipR', 'knR', 'tail'];

let sharedGeo = { a: null, b: null, key: '' };

function buildGeo(THREE, T, P, who) {
  const buf = new GeoBuf(THREE, 14000, { skin: true, dynamic: false });
  const ink = P.outline;
  const col = who === 'a' ? P.a : P.b;
  const dk = mix(col, P.ink, 0.28);
  const ol = 0.024;
  const B = (name) => { buf.bone = ORDER.indexOf(name); };
  const cap = (r, len) => T.cap(r, len);
  // pelvis + torso (spine)
  B('hips');
  buf.add(cap(0.21, 0.08), 0, 0.98, 0, 1.2, 1, 0.95, 0, P.pants, FX_PLAIN, ol, ink);
  B('spine');
  buf.add(cap(0.26, 0.14), 0, 1.3, 0, 1.08, 1, 0.86, 0, col, FX_PLAIN, ol, ink);
  buf.add(T.box, 0, 1.06, -0.2, 0.34, 0.14, 0.06, 0, dk, FX_PLAIN, 0, ink); // hoodie pocket
  B('chest');
  buf.add(T.lowSphere, 0, 1.6, 0.03, 0.42, 0.18, 0.38, 0, dk, FX_PLAIN, 0, ink); // hood bunch
  buf.add(T.box, 0, 1.32, 0.29, 0.42, 0.48, 0.2, 0, who === 'a' ? P.hl : mix(P.hl, P.b, 0.25), FX_PLAIN, ol, ink); // backpack
  buf.add(T.box, 0, 1.42, 0.4, 0.3, 0.14, 0.04, 0, mix(P.hl, P.ink, 0.3), FX_PLAIN, 0, ink);
  // head
  B('head');
  buf.add(T.sphere, 0, 1.9, 0, 0.6, 0.62, 0.6, 0, P.skin, FX_PLAIN, 0.026, ink);
  for (const s of [-1, 1]) {
    buf.add(T.lowSphere, s * 0.105, 1.93, -0.272, 0.07, 0.1, 0.05, 0, [0.12, 0.1, 0.14], FX_PLAIN, 0, ink);
    buf.add(T.lowSphere, s * 0.17, 1.84, -0.235, 0.09, 0.06, 0.04, 0, mix(P.skin, P.b, 0.35), FX_PLAIN, 0, ink);
  }
  if (who === 'a') {
    buf.add(T.sphere12, 0, 1.98, 0.03, 0.64, 0.5, 0.64, 0, P.hairA, FX_PLAIN, 0.022, ink);
    // backwards cap
    buf.add(T.sphere12, 0, 2.06, 0.02, 0.62, 0.36, 0.62, 0, dk, FX_PLAIN, 0.022, ink);
    buf.add(T.box, 0, 2.02, 0.32, 0.42, 0.05, 0.26, 0, dk, FX_PLAIN, 0.02, ink);
    buf.add(T.lowSphere, 0, 2.24, 0.02, 0.08, 0.06, 0.08, 0, P.hl, FX_PLAIN, 0, ink);
  } else {
    buf.add(T.sphere12, 0, 1.99, 0.04, 0.66, 0.52, 0.66, 0, P.hairB, FX_PLAIN, 0.022, ink);
    buf.add(T.lowSphere, -0.2, 1.92, -0.18, 0.18, 0.24, 0.14, 0.4, P.hairB, FX_PLAIN, 0, ink);
    buf.add(T.lowSphere, 0, 2.08, 0.26, 0.16, 0.16, 0.16, 0, P.hl, FX_PLAIN, 0.018, ink);
    B('tail');
    buf.add(cap(0.11, 0.26), 0, 1.8, 0.33, 1, 1, 0.9, 0, P.hairB, FX_PLAIN, 0.022, ink);
  }
  // arms
  for (const [sh, el, s] of [['shL', 'elL', -1], ['shR', 'elR', 1]]) {
    B(sh);
    buf.add(cap(0.088, 0.17), s * 0.33, 1.35, 0, 1, 1, 1, 0, col, FX_PLAIN, ol, ink);
    B(el);
    buf.add(cap(0.078, 0.13), s * 0.33, 1.06, 0, 1, 1, 1, 0, col, FX_PLAIN, ol, ink);
    buf.add(T.lowSphere, s * 0.33, 0.93, 0, 0.17, 0.17, 0.17, 0, dk, FX_PLAIN, 0, ink);
    buf.add(T.lowSphere, s * 0.33, 0.84, -0.01, 0.17, 0.18, 0.17, 0, P.skin, FX_PLAIN, 0.02, ink);
  }
  // legs
  for (const [hp, kn, s] of [['hipL', 'knL', -1], ['hipR', 'knR', 1]]) {
    B(hp);
    buf.add(cap(0.115, 0.2), s * 0.13, 0.735, 0, 1, 1, 1, 0, P.pants, FX_PLAIN, ol, ink);
    B(kn);
    buf.add(cap(0.098, 0.22), s * 0.13, 0.31, 0, 1, 1, 1, 0, P.pants, FX_PLAIN, ol, ink);
    buf.add(T.box, s * 0.13, 0.085, -0.06, 0.21, 0.15, 0.38, 0, P.white, FX_PLAIN, 0.022, ink);
    buf.add(T.box, s * 0.13, 0.015, -0.06, 0.22, 0.04, 0.39, 0, col, FX_PLAIN, 0, ink);
    buf.add(T.box, s * 0.13, 0.12, -0.2, 0.16, 0.06, 0.1, 0, col, FX_GLOW, 0, ink);
  }
  const g = buf.freeze(THREE);
  buf.dispose();
  return g;
}

function bubbleMaterial(THREE, P) {
  return new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color().fromArray(P.hl) }, uInk: { value: new THREE.Color().fromArray(P.outline) }, uT: { value: 0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uCol; uniform vec3 uInk; uniform float uT; varying vec3 vN; varying vec3 vV; void main(){ float f = 1.0 - abs(dot(vN, vV)); float rim = smoothstep(0.5, 0.92, f); float edge = step(0.9, f); float shine = step(0.985, abs(dot(vN, normalize(vec3(-0.5,0.7,0.5))))); gl_FragColor = vec4(mix(uCol, uInk, edge) + shine, 0.07 + rim * 0.75 + shine * 0.6); }',
    transparent: true, depthWrite: false,
  });
}

/** Create a runner avatar for player `who` ('a' | 'b'). */
export function createAvatar(THREE, world, P, who) {
  const key = P.outline.join() + P.a.join() + P.b.join() + P.skin.join();
  if (sharedGeo.key !== key) { sharedGeo = { a: null, b: null, key }; }
  if (!sharedGeo[who]) sharedGeo[who] = buildGeo(THREE, world.T, P, who);
  const geo = sharedGeo[who];
  const mesh = new THREE.SkinnedMesh(geo, world.avatarMats ? world.avatarMats[who] : world.avatarMat);
  const bones = [];
  for (const name of ORDER) {
    const j = JOINTS[name];
    const bn = new THREE.Bone();
    bn.name = name;
    if (j[3] < 0) { bn.position.set(j[0], j[1], j[2]); mesh.add(bn); }
    else {
      const parent = JOINTS[ORDER[j[3]]];
      bn.position.set(j[0] - parent[0], j[1] - parent[1], j[2] - parent[2]);
      bones[j[3]].add(bn);
    }
    bones.push(bn);
  }
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false;
  world.scene.add(mesh);
  // Every frame the pose is written straight into the local matrices (Matrix4.elements, a plain
  // double array) instead of through Object3D position / rotation / scale: three keeps Euler,
  // Quaternion and Vector3 in sync through setters, and V8 boxes the doubles stored in Euler's
  // fields (a fresh allocation per bone per frame). Same XYZ Euler order as three's.
  mesh.matrixAutoUpdate = false;
  for (const bn of bones) bn.matrixAutoUpdate = false;
  const BP = new Float64Array(bones.length * 3); // each bone's rest position
  bones.forEach((bn, i) => { BP[i * 3] = bn.position.x; BP[i * 3 + 1] = bn.position.y; BP[i * 3 + 2] = bn.position.z; });
  const BA = new Float64Array(4); // setBone's angles + y, passed through memory, not as arguments
  function setBone(i) {
    const bn = bones[i]; const te = bn.matrix.elements;
    const x = BA[0]; const y = BA[1]; const z = BA[2]; const py = BA[3];
    const a = Math.cos(x); const b = Math.sin(x); const c = Math.cos(y); const d = Math.sin(y); const e = Math.cos(z); const f = Math.sin(z);
    const ae = a * e; const af = a * f; const be = b * e; const bf = b * f;
    te[0] = c * e; te[4] = -c * f; te[8] = d;
    te[1] = af + be * d; te[5] = ae - bf * d; te[9] = -b * c;
    te[2] = bf - ae * d; te[6] = be + af * d; te[10] = a * c;
    te[3] = 0; te[7] = 0; te[11] = 0;
    te[12] = BP[i * 3]; te[13] = py; te[14] = BP[i * 3 + 2]; te[15] = 1;
    bn.matrixWorldNeedsUpdate = true;
  }

  // unlockable hats: small meshes parented to the head bone (one draw call while worn)
  const hats = [];
  {
    const hb = new GeoBuf(THREE, 1200, { dynamic: false });
    const ink = P.outline; const T = world.T;
    const mk = (fn) => { hb.reset(); fn(hb); const g = hb.freeze(THREE); const m = new THREE.Mesh(g, world.mat); m.visible = false; m.position.y = 0.6; bones[4].add(m); hats.push({ m, g }); };
    // crown: a gold band with four points and a jewel
    mk((b) => {
      b.add(T.cyl6, 0, 0, 0, 0.56, 0.16, 0.56, 0, P.hl, FX_PLAIN, 0.02, ink);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; b.add(T.cone, Math.cos(a) * 0.22, 0.2, Math.sin(a) * 0.22, 0.16, 0.26, 0.16, 0, P.hl, FX_PLAIN, 0.018, ink); }
      b.add(T.sphere12, 0, 0.02, -0.27, 0.12, 0.12, 0.08, 0, P.b, FX_GLOW, 0, ink);
    });
    // halo: a glowing ring floating over the head
    mk((b) => { b.add(T.disc, 0, 0.22, 0, 0.62, 0.05, 0.62, 0, mix(P.hl, P.white, 0.5), FX_GLOW, 0.02, ink); b.add(T.disc, 0, 0.22, 0, 0.4, 0.07, 0.4, 0, P.skin, FX_PLAIN, 0, ink); });
    // party cone with a pompom
    mk((b) => { b.add(T.cone, 0, 0.26, 0, 0.36, 0.56, 0.36, 0, who === 'a' ? P.b : P.a, FX_PLAIN, 0.02, ink); b.add(T.lowSphere, 0, 0.56, 0, 0.14, 0.14, 0.14, 0, P.hl, FX_GLOW, 0, ink); });
    hb.dispose();
  }
  let hatK = 0;
  const bubbleGeo = new THREE.SphereGeometry(1.25, 22, 16);
  const bubbleMat = bubbleMaterial(THREE, P);
  const bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
  bubble.visible = false;
  bubble.renderOrder = 3;
  world.scene.add(bubble);

  const W = new Float32Array(POSES);
  W[P_IDLE] = 1;
  const target = new Float32Array(POSES);
  const J = new Float32Array(NJ);
  const Q = new Float32Array(NJ * POSES);
  // per-frame doubles live on an object, not in closure variables: V8 boxes every double written
  // to a closure slot (a fresh HeapNumber per frame); object fields are updated in place
  const A = { sq: 0.5, sqv: 0.5, blinkT: 0.5, lean: 0.5, lastX: 0.5, rollP: 0.5, downPose: 0.5, lungeT: 0.5, lungeDir: 0.5, wobble: 0.5, px: 0.5, py: 0.5, pz: 0.5, sy: 0.5 };
  for (const k in A) A[k] = 0;
  let wasAir = false;

  // (poses are written straight into Q: Q[pose * NJ + joint] = angle; no call per joint, so V8
  // never has to box a double argument)
  function clearPose(p) { Q.fill(0, p * NJ, p * NJ + NJ); }

  /**
   * s: { x, y, z, ground, speed, air, vy, roll, rollT (0..1), stumble (0..1), down, downT,
   *      win, idle, invuln, shield, t (time s), visible }
   */
  function update(dt, s) {
    const t = s.t;
    const phi = (s.z / STRIDE) * Math.PI * 2;
    const sn = Math.sin(phi); const cs = Math.cos(phi);
    const sp = Math.min(1, s.speed / 30);
    // run
    clearPose(P_RUN);
    Q[0 * NJ + 0] = 0.07 * Math.abs(cs);
    Q[0 * NJ + 5] = -0.26 - 0.12 * sp;
    Q[0 * NJ + 7] = 0.12 * sn;
    Q[0 * NJ + 8] = 0.2 + 0.08 * sp;
    Q[0 * NJ + 16] = 0.85 * sn;
    Q[0 * NJ + 18] = -0.85 * sn;
    Q[0 * NJ + 17] = -(0.25 + 1.3 * Math.max(0, cs));
    Q[0 * NJ + 19] = -(0.25 + 1.3 * Math.max(0, -cs));
    Q[0 * NJ + 10] = -0.8 * sn;
    Q[0 * NJ + 13] = 0.8 * sn;
    Q[0 * NJ + 11] = -0.14; Q[0 * NJ + 14] = 0.14;
    Q[0 * NJ + 12] = 1.35; Q[0 * NJ + 15] = 1.35;
    Q[0 * NJ + 20] = 0.35 + 0.3 * Math.cos(phi * 2); Q[0 * NJ + 21] = 0.2 * sn;
    // air
    const u = Math.max(-1, Math.min(1, s.vy / JUMP_V));
    const tuck = 1 - Math.abs(u);
    clearPose(P_AIR);
    Q[1 * NJ + 5] = -0.12 - 0.25 * tuck;
    Q[1 * NJ + 8] = 0.12;
    Q[1 * NJ + 16] = u < 0 ? 0.35 + 0.4 * tuck : 0.7 + 0.6 * tuck;
    Q[1 * NJ + 18] = u < 0 ? 0.1 + 0.6 * tuck : 0.2 + 0.9 * tuck;
    Q[1 * NJ + 17] = -(0.35 + 1.3 * tuck);
    Q[1 * NJ + 19] = -(0.25 + 1.6 * tuck);
    Q[1 * NJ + 10] = 0.5 + 1.9 * Math.max(0, u) + 0.3 * tuck;
    Q[1 * NJ + 13] = 0.3 + 1.6 * Math.max(0, u) + 0.2 * tuck;
    Q[1 * NJ + 11] = -0.55; Q[1 * NJ + 14] = 0.55;
    Q[1 * NJ + 12] = 0.6; Q[1 * NJ + 15] = 0.6;
    Q[1 * NJ + 20] = 0.9 - u * 0.6;
    // roll
    clearPose(P_ROLL);
    Q[2 * NJ + 3] = -0.42;
    Q[2 * NJ + 5] = -0.95; Q[2 * NJ + 8] = -0.5;
    Q[2 * NJ + 16] = 2.0; Q[2 * NJ + 18] = 2.0;
    Q[2 * NJ + 17] = -2.4; Q[2 * NJ + 19] = -2.4;
    Q[2 * NJ + 10] = 1.3; Q[2 * NJ + 13] = 1.3;
    Q[2 * NJ + 11] = -0.25; Q[2 * NJ + 14] = 0.25;
    Q[2 * NJ + 12] = 1.7; Q[2 * NJ + 15] = 1.7;
    Q[2 * NJ + 20] = 1.2;
    // stumble
    clearPose(P_STUMBLE);
    Q[3 * NJ + 5] = -0.6 + 0.25 * Math.sin(t * 21);
    Q[3 * NJ + 6] = 0.28 * Math.sin(t * 13);
    Q[3 * NJ + 8] = 0.3 * Math.sin(t * 15);
    Q[3 * NJ + 10] = 1.6 + 0.8 * Math.sin(t * 25); Q[3 * NJ + 11] = -1.0 - 0.4 * Math.sin(t * 17);
    Q[3 * NJ + 13] = 1.3 + 0.8 * Math.sin(t * 23 + 1); Q[3 * NJ + 14] = 1.0 + 0.4 * Math.sin(t * 19);
    Q[3 * NJ + 12] = 0.4; Q[3 * NJ + 15] = 0.4;
    Q[3 * NJ + 16] = 0.6 * sn; Q[3 * NJ + 18] = -0.6 * sn;
    Q[3 * NJ + 17] = -0.7; Q[3 * NJ + 19] = -0.7;
    Q[3 * NJ + 20] = 1.0;
    // crash / down
    clearPose(P_CRASH);
    const fall = Math.min(1, s.downT * 4.5);
    A.downPose = fall;
    Q[4 * NJ + 1] = 1.42 * (1 - (1 - fall) * (1 - fall));
    Q[4 * NJ + 5] = 0.25;
    Q[4 * NJ + 8] = 0.35 + 0.1 * Math.sin(t * 3);
    Q[4 * NJ + 10] = 2.5; Q[4 * NJ + 11] = -1.3 - 0.15 * Math.sin(t * 6);
    Q[4 * NJ + 13] = 2.3; Q[4 * NJ + 14] = 1.3 + 0.15 * Math.sin(t * 6 + 1);
    Q[4 * NJ + 12] = 0.3; Q[4 * NJ + 15] = 0.3;
    Q[4 * NJ + 16] = 1.25; Q[4 * NJ + 18] = 0.55;
    Q[4 * NJ + 17] = -0.45; Q[4 * NJ + 19] = -0.9;
    Q[4 * NJ + 20] = 1.4;
    // idle
    clearPose(P_IDLE);
    const br = Math.sin(t * 2.1);
    Q[5 * NJ + 0] = 0.012 * br;
    Q[5 * NJ + 5] = -0.04 + 0.025 * br;
    Q[5 * NJ + 9] = 0.35 * Math.sin(t * 0.6);
    Q[5 * NJ + 8] = 0.05;
    Q[5 * NJ + 10] = 0.05; Q[5 * NJ + 13] = 0.05;
    Q[5 * NJ + 11] = -0.16 - 0.03 * br; Q[5 * NJ + 14] = 0.16 + 0.03 * br;
    Q[5 * NJ + 12] = 0.3; Q[5 * NJ + 15] = 0.3;
    Q[5 * NJ + 17] = -0.06; Q[5 * NJ + 19] = -0.06;
    Q[5 * NJ + 20] = 0.1 + 0.05 * br; Q[5 * NJ + 21] = 0.1 * Math.sin(t * 1.3);
    // win
    clearPose(P_WIN);
    const hop = Math.abs(Math.sin(t * 6.5));
    Q[6 * NJ + 0] = 0.32 * hop;
    Q[6 * NJ + 10] = 2.8; Q[6 * NJ + 13] = 2.8;
    Q[6 * NJ + 11] = -0.55 - 0.25 * Math.sin(t * 9); Q[6 * NJ + 14] = 0.55 + 0.25 * Math.sin(t * 9);
    Q[6 * NJ + 12] = 0.25; Q[6 * NJ + 15] = 0.25;
    Q[6 * NJ + 17] = -0.6 * (1 - hop); Q[6 * NJ + 19] = -0.6 * (1 - hop);
    Q[6 * NJ + 16] = 0.3 * (1 - hop); Q[6 * NJ + 18] = 0.3 * (1 - hop);
    Q[6 * NJ + 8] = 0.2;
    Q[6 * NJ + 20] = 0.6 + 0.4 * hop;

    // targets
    target.fill(0);
    let rate = 14;
    if (s.down) { target[P_CRASH] = 1; rate = 22; }
    else if (s.win) target[P_WIN] = 1;
    else if (s.idle) target[P_IDLE] = 1;
    else if (s.roll) { target[P_ROLL] = 1; rate = 26; }
    else if (s.air) target[P_AIR] = 1;
    else if (s.stumble > 0.05) { target[P_STUMBLE] = Math.min(1, s.stumble * 1.6); target[P_RUN] = 1 - target[P_STUMBLE]; }
    else target[P_RUN] = 1;
    const k = 1 - Math.exp(-dt * rate);
    let sum = 0;
    for (let p = 0; p < POSES; p++) { W[p] += (target[p] - W[p]) * k; sum += W[p]; }
    J.fill(0);
    for (let p = 0; p < POSES; p++) {
      const w = W[p] / (sum || 1);
      if (w < 0.001) continue;
      const o = p * NJ;
      for (let i = 0; i < NJ; i++) J[i] += Q[o + i] * w;
    }

    // roll spin (not blended: a full turn ends where it started)
    if (s.roll) A.rollP = Math.min(1, s.rollT); else A.rollP = 0;
    const e = A.rollP < 0.5 ? 2 * A.rollP * A.rollP : 1 - 2 * (1 - A.rollP) * (1 - A.rollP);
    const spin = -Math.PI * 2 * e;

    // lean into lane changes (and a little lead)
    const vx = dt > 0 ? (s.x - A.lastX) / dt : 0;
    A.lastX = s.x;
    A.lean += (Math.max(-0.4, Math.min(0.4, -vx * 0.035)) - A.lean) * (1 - Math.exp(-dt * 16));

    // squash & stretch
    const air = !!s.air;
    if (air && !wasAir && !s.down) { A.sq = 0.2; A.sqv = 0; }
    if (!air && wasAir && !s.down) { A.sq = -0.24; A.sqv = 0; }
    wasAir = air;
    // stiff spring: substep at 120 Hz so a long frame can't blow it up
    let rem = Math.min(dt, 0.1);
    while (rem > 1e-6) { const hh = rem > 1 / 120 ? 1 / 120 : rem; A.sqv += (-170 * A.sq - 13 * A.sqv) * hh; A.sq += A.sqv * hh; rem -= hh; }
    if (A.sq > 0.35) A.sq = 0.35; else if (A.sq < -0.35) A.sq = -0.35;
    if (A.lungeT > 0) A.lungeT -= dt;
    A.wobble += ((s.bump || 0) - A.wobble) * (1 - Math.exp(-dt * 20));

    // apply (mesh: translate + squash scale; bones: rotations, see setBone)
    const sy = 1 + A.sq; const sxz = 1 - A.sq * 0.55;
    A.px = s.x + A.wobble * 1.4; A.py = s.y + J[0]; A.pz = -s.z; A.sy = sy;
    const me = mesh.matrix.elements;
    me[0] = sxz; me[1] = 0; me[2] = 0; me[3] = 0; me[4] = 0; me[5] = sy; me[6] = 0; me[7] = 0;
    me[8] = 0; me[9] = 0; me[10] = sxz; me[11] = 0; me[12] = A.px; me[13] = A.py; me[14] = A.pz; me[15] = 1;
    mesh.matrixWorldNeedsUpdate = true;
    BA[0] = J[1]; BA[1] = 0; BA[2] = J[2] + A.lean; BA[3] = BP[0 * 3 + 1]; setBone(0);
    BA[0] = J[4] + spin; BA[1] = 0; BA[2] = 0; BA[3] = 0.95 + J[3]; setBone(1);
    let lunge = 0;
    if (A.lungeT > 0) lunge = Math.sin((1 - A.lungeT / 0.35) * Math.PI) * A.lungeDir;
    BA[0] = J[5]; BA[1] = J[7]; BA[2] = J[6] - lunge * 0.45; BA[3] = BP[2 * 3 + 1]; setBone(2);
    BA[0] = J[8]; BA[1] = J[9]; BA[2] = 0; BA[3] = BP[4 * 3 + 1]; setBone(4);
    BA[0] = J[10]; BA[1] = 0; BA[2] = J[11] - (lunge < 0 ? -lunge * 1.3 : 0); BA[3] = BP[5 * 3 + 1]; setBone(5);
    BA[0] = J[12]; BA[1] = 0; BA[2] = 0; BA[3] = BP[6 * 3 + 1]; setBone(6);
    BA[0] = J[13]; BA[1] = 0; BA[2] = J[14] + (lunge > 0 ? lunge * 1.3 : 0); BA[3] = BP[7 * 3 + 1]; setBone(7);
    BA[0] = J[15]; BA[1] = 0; BA[2] = 0; BA[3] = BP[8 * 3 + 1]; setBone(8);
    BA[0] = J[16]; BA[1] = 0; BA[2] = 0; BA[3] = BP[9 * 3 + 1]; setBone(9);
    BA[0] = J[17]; BA[1] = 0; BA[2] = 0; BA[3] = BP[10 * 3 + 1]; setBone(10);
    BA[0] = J[18]; BA[1] = 0; BA[2] = 0; BA[3] = BP[11 * 3 + 1]; setBone(11);
    BA[0] = J[19]; BA[1] = 0; BA[2] = 0; BA[3] = BP[12 * 3 + 1]; setBone(12);
    BA[0] = J[20]; BA[1] = 0; BA[2] = J[21]; BA[3] = BP[13 * 3 + 1]; setBone(13);
    A.blinkT += dt;
    mesh.visible = s.visible !== false && !(s.invuln && !s.down && Math.floor(A.blinkT * 14) % 2 === 0);
    if (hatK) hats[hatK - 1].m.visible = mesh.visible;
    bubble.visible = mesh.visible && !!s.shield;
    if (bubble.visible) {
      bubble.position.set(s.x, s.y + (s.roll ? 0.6 : 1.05), -s.z);
      const pulse = 1 + Math.sin(t * 6) * 0.03;
      bubble.scale.set(pulse, pulse * (s.roll ? 0.7 : 1), pulse);
    }
  }

  return {
    mesh, who,
    update,
    /** Things to draw once behind the loading screen so their shaders are compiled. */
    warmList: () => [mesh, bubble],
    lunge(dir) { A.lungeT = 0.35; A.lungeDir = dir; },
    /** Wear hat k (0 none, 1 crown, 2 halo, 3 party cone). */
    setHat(k) { k = k | 0; if (k === hatK) return; hatK = k; for (let i = 0; i < hats.length; i++) hats[i].m.visible = i + 1 === k; },
    get hat() { return hatK; },
    get downPose() { return A.downPose; },
    headPos(out) { out.set(A.px, A.py + 2.1 * A.sy, A.pz); return out; },
    dispose() {
      world.scene.remove(mesh); world.scene.remove(bubble);
      for (const h of hats) { bones[4].remove(h.m); h.g.dispose(); }
      bubbleGeo.dispose(); bubbleMat.dispose();
      mesh.skeleton.dispose();
    },
  };
}

/** Free the shared avatar geometries (on game destroy). */
export function disposeAvatarGeometry() {
  if (sharedGeo.a) sharedGeo.a.dispose();
  if (sharedGeo.b) sharedGeo.b.dispose();
  sharedGeo = { a: null, b: null, key: '' };
}
