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

  const bubbleGeo = new THREE.SphereGeometry(1.25, 22, 16);
  const bubbleMat = bubbleMaterial(THREE, P);
  const bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
  bubble.visible = false;
  bubble.renderOrder = 3;
  world.scene.add(bubble);

  const [root, hips, spine, , head, shL, elL, shR, elR, hipL, knL, hipR, knR, tail] = bones;
  const W = new Float32Array(POSES);
  W[P_IDLE] = 1;
  const target = new Float32Array(POSES);
  const J = new Float32Array(NJ);
  const Q = new Float32Array(NJ * POSES);
  let sq = 0; let sqv = 0;      // squash spring
  let wasAir = false;
  let blinkT = 0;
  let lean = 0;
  let lastX = 0;
  let rollP = 0;
  let downPose = 0;
  let lungeT = 0; let lungeDir = 0;
  let wobble = 0;

  function pose(p, i, v) { Q[p * NJ + i] = v; }
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
    pose(P_RUN, 0, 0.07 * Math.abs(cs));
    pose(P_RUN, 5, -0.26 - 0.12 * sp);
    pose(P_RUN, 7, 0.12 * sn);
    pose(P_RUN, 8, 0.2 + 0.08 * sp);
    pose(P_RUN, 16, 0.85 * sn);
    pose(P_RUN, 18, -0.85 * sn);
    pose(P_RUN, 17, -(0.25 + 1.3 * Math.max(0, cs)));
    pose(P_RUN, 19, -(0.25 + 1.3 * Math.max(0, -cs)));
    pose(P_RUN, 10, -0.8 * sn);
    pose(P_RUN, 13, 0.8 * sn);
    pose(P_RUN, 11, -0.14); pose(P_RUN, 14, 0.14);
    pose(P_RUN, 12, 1.35); pose(P_RUN, 15, 1.35);
    pose(P_RUN, 20, 0.35 + 0.3 * Math.cos(phi * 2)); pose(P_RUN, 21, 0.2 * sn);
    // air
    const u = Math.max(-1, Math.min(1, s.vy / JUMP_V));
    const tuck = 1 - Math.abs(u);
    clearPose(P_AIR);
    pose(P_AIR, 5, -0.12 - 0.25 * tuck);
    pose(P_AIR, 8, 0.12);
    pose(P_AIR, 16, u < 0 ? 0.35 + 0.4 * tuck : 0.7 + 0.6 * tuck);
    pose(P_AIR, 18, u < 0 ? 0.1 + 0.6 * tuck : 0.2 + 0.9 * tuck);
    pose(P_AIR, 17, -(0.35 + 1.3 * tuck));
    pose(P_AIR, 19, -(0.25 + 1.6 * tuck));
    pose(P_AIR, 10, 0.5 + 1.9 * Math.max(0, u) + 0.3 * tuck);
    pose(P_AIR, 13, 0.3 + 1.6 * Math.max(0, u) + 0.2 * tuck);
    pose(P_AIR, 11, -0.55); pose(P_AIR, 14, 0.55);
    pose(P_AIR, 12, 0.6); pose(P_AIR, 15, 0.6);
    pose(P_AIR, 20, 0.9 - u * 0.6);
    // roll
    clearPose(P_ROLL);
    pose(P_ROLL, 3, -0.42);
    pose(P_ROLL, 5, -0.95); pose(P_ROLL, 8, -0.5);
    pose(P_ROLL, 16, 2.0); pose(P_ROLL, 18, 2.0);
    pose(P_ROLL, 17, -2.4); pose(P_ROLL, 19, -2.4);
    pose(P_ROLL, 10, 1.3); pose(P_ROLL, 13, 1.3);
    pose(P_ROLL, 11, -0.25); pose(P_ROLL, 14, 0.25);
    pose(P_ROLL, 12, 1.7); pose(P_ROLL, 15, 1.7);
    pose(P_ROLL, 20, 1.2);
    // stumble
    clearPose(P_STUMBLE);
    pose(P_STUMBLE, 5, -0.6 + 0.25 * Math.sin(t * 21));
    pose(P_STUMBLE, 6, 0.28 * Math.sin(t * 13));
    pose(P_STUMBLE, 8, 0.3 * Math.sin(t * 15));
    pose(P_STUMBLE, 10, 1.6 + 0.8 * Math.sin(t * 25)); pose(P_STUMBLE, 11, -1.0 - 0.4 * Math.sin(t * 17));
    pose(P_STUMBLE, 13, 1.3 + 0.8 * Math.sin(t * 23 + 1)); pose(P_STUMBLE, 14, 1.0 + 0.4 * Math.sin(t * 19));
    pose(P_STUMBLE, 12, 0.4); pose(P_STUMBLE, 15, 0.4);
    pose(P_STUMBLE, 16, 0.6 * sn); pose(P_STUMBLE, 18, -0.6 * sn);
    pose(P_STUMBLE, 17, -0.7); pose(P_STUMBLE, 19, -0.7);
    pose(P_STUMBLE, 20, 1.0);
    // crash / down
    clearPose(P_CRASH);
    const fall = Math.min(1, s.downT * 4.5);
    downPose = fall;
    pose(P_CRASH, 1, 1.42 * (1 - (1 - fall) * (1 - fall)));
    pose(P_CRASH, 5, 0.25);
    pose(P_CRASH, 8, 0.35 + 0.1 * Math.sin(t * 3));
    pose(P_CRASH, 10, 2.5); pose(P_CRASH, 11, -1.3 - 0.15 * Math.sin(t * 6));
    pose(P_CRASH, 13, 2.3); pose(P_CRASH, 14, 1.3 + 0.15 * Math.sin(t * 6 + 1));
    pose(P_CRASH, 12, 0.3); pose(P_CRASH, 15, 0.3);
    pose(P_CRASH, 16, 1.25); pose(P_CRASH, 18, 0.55);
    pose(P_CRASH, 17, -0.45); pose(P_CRASH, 19, -0.9);
    pose(P_CRASH, 20, 1.4);
    // idle
    clearPose(P_IDLE);
    const br = Math.sin(t * 2.1);
    pose(P_IDLE, 0, 0.012 * br);
    pose(P_IDLE, 5, -0.04 + 0.025 * br);
    pose(P_IDLE, 9, 0.35 * Math.sin(t * 0.6));
    pose(P_IDLE, 8, 0.05);
    pose(P_IDLE, 10, 0.05); pose(P_IDLE, 13, 0.05);
    pose(P_IDLE, 11, -0.16 - 0.03 * br); pose(P_IDLE, 14, 0.16 + 0.03 * br);
    pose(P_IDLE, 12, 0.3); pose(P_IDLE, 15, 0.3);
    pose(P_IDLE, 17, -0.06); pose(P_IDLE, 19, -0.06);
    pose(P_IDLE, 20, 0.1 + 0.05 * br); pose(P_IDLE, 21, 0.1 * Math.sin(t * 1.3));
    // win
    clearPose(P_WIN);
    const hop = Math.abs(Math.sin(t * 6.5));
    pose(P_WIN, 0, 0.32 * hop);
    pose(P_WIN, 10, 2.8); pose(P_WIN, 13, 2.8);
    pose(P_WIN, 11, -0.55 - 0.25 * Math.sin(t * 9)); pose(P_WIN, 14, 0.55 + 0.25 * Math.sin(t * 9));
    pose(P_WIN, 12, 0.25); pose(P_WIN, 15, 0.25);
    pose(P_WIN, 17, -0.6 * (1 - hop)); pose(P_WIN, 19, -0.6 * (1 - hop));
    pose(P_WIN, 16, 0.3 * (1 - hop)); pose(P_WIN, 18, 0.3 * (1 - hop));
    pose(P_WIN, 8, 0.2);
    pose(P_WIN, 20, 0.6 + 0.4 * hop);

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
    if (s.roll) rollP = Math.min(1, s.rollT); else rollP = 0;
    const e = rollP < 0.5 ? 2 * rollP * rollP : 1 - 2 * (1 - rollP) * (1 - rollP);
    const spin = -Math.PI * 2 * e;

    // lean into lane changes (and a little lead)
    const vx = dt > 0 ? (s.x - lastX) / dt : 0;
    lastX = s.x;
    lean += (Math.max(-0.4, Math.min(0.4, -vx * 0.035)) - lean) * (1 - Math.exp(-dt * 16));

    // squash & stretch
    const air = !!s.air;
    if (air && !wasAir && !s.down) { sq = 0.2; sqv = 0; }
    if (!air && wasAir && !s.down) { sq = -0.24; sqv = 0; }
    wasAir = air;
    // stiff spring: substep at 120 Hz so a long frame can't blow it up
    let rem = Math.min(dt, 0.1);
    while (rem > 1e-6) { const hh = rem > 1 / 120 ? 1 / 120 : rem; sqv += (-170 * sq - 13 * sqv) * hh; sq += sqv * hh; rem -= hh; }
    if (sq > 0.35) sq = 0.35; else if (sq < -0.35) sq = -0.35;
    if (lungeT > 0) lungeT -= dt;
    wobble += ((s.bump || 0) - wobble) * (1 - Math.exp(-dt * 20));

    // apply
    mesh.position.set(s.x + wobble * 1.4, s.y + J[0], -s.z);
    root.rotation.set(J[1], 0, J[2] + lean);
    const sy = 1 + sq; const sxz = 1 - sq * 0.55;
    mesh.scale.set(sxz, sy, sxz);
    hips.position.y = 0.95 + J[3];
    hips.rotation.set(J[4] + spin, 0, 0);
    let lunge = 0;
    if (lungeT > 0) lunge = Math.sin((1 - lungeT / 0.35) * Math.PI) * lungeDir;
    spine.rotation.set(J[5], J[7], J[6] - lunge * 0.45);
    head.rotation.set(J[8], J[9], 0);
    shL.rotation.set(J[10], 0, J[11] - (lunge < 0 ? -lunge * 1.3 : 0));
    elL.rotation.set(J[12], 0, 0);
    shR.rotation.set(J[13], 0, J[14] + (lunge > 0 ? lunge * 1.3 : 0));
    elR.rotation.set(J[15], 0, 0);
    hipL.rotation.set(J[16], 0, 0);
    knL.rotation.set(J[17], 0, 0);
    hipR.rotation.set(J[18], 0, 0);
    knR.rotation.set(J[19], 0, 0);
    tail.rotation.set(J[20], 0, J[21]);
    blinkT += dt;
    mesh.visible = s.visible !== false && !(s.invuln && !s.down && Math.floor(blinkT * 14) % 2 === 0);
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
    lunge(dir) { lungeT = 0.35; lungeDir = dir; },
    get downPose() { return downPose; },
    headPos(out) { out.set(mesh.position.x, mesh.position.y + 2.1 * mesh.scale.y, mesh.position.z); return out; },
    dispose() {
      world.scene.remove(mesh); world.scene.remove(bubble);
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
