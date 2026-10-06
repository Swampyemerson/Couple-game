// Getaway effects: instanced puffs (smoke, dust, fire, debris), instanced sparks, a ring buffer of
// skid marks, spike strips and oil slicks (instanced), and a clip-space speed-line overlay.
// Pools are preallocated; nothing is allocated per frame.
import { Builder, FX_GLOW, mix, makeToon } from './gfx.js';

export function createFx(THREE, scene, P, U, mats) {
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  // ── puffs ──
  const NP = 260;
  const pb = new Builder(THREE, P.outline);
  pb.add(pb.T.ico, 0, 0, 0, 1, 1, 1, 0, [1, 1, 1], 0);
  const puffGeo = pb.geometryOut();
  const puffs = new THREE.InstancedMesh(puffGeo, mats.vcColor || mats.vc, NP);
  puffs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NP * 3).fill(1), 3);
  puffs.frustumCulled = false; puffs.count = 0;
  scene.add(puffs);
  const pp = new Float32Array(NP * 12); // x y z vx vy vz life max size grow r g  (+b in a side array)
  const pbC = new Float32Array(NP);
  let np = 0;
  function puff(x, y, z, vx, vy, vz, size, grow, life, r, g, b) {
    if (np >= NP) return;
    const o = np * 12;
    pp[o] = x; pp[o + 1] = y; pp[o + 2] = z; pp[o + 3] = vx; pp[o + 4] = vy; pp[o + 5] = vz;
    pp[o + 6] = 0; pp[o + 7] = life; pp[o + 8] = size; pp[o + 9] = grow; pp[o + 10] = r; pp[o + 11] = g; pbC[np] = b;
    np++;
  }
  // ── sparks ──
  const NS = 160;
  const sb = new Builder(THREE, P.outline);
  sb.add(sb.T.box, 0, 0, 0.5, 0.07, 0.07, 1, 0, [1, 0.85, 0.35], 0, FX_GLOW);
  const sparkGeo = sb.geometryOut();
  const sparks = new THREE.InstancedMesh(sparkGeo, mats.vc, NS);
  sparks.frustumCulled = false; sparks.count = 0;
  scene.add(sparks);
  const sp = new Float32Array(NS * 8);
  let ns = 0;
  function spark(x, y, z, vx, vy, vz, life) {
    if (ns >= NS) return;
    const o = ns * 8; sp[o] = x; sp[o + 1] = y; sp[o + 2] = z; sp[o + 3] = vx; sp[o + 4] = vy; sp[o + 5] = vz; sp[o + 6] = 0; sp[o + 7] = life; ns++;
  }
  // ── skid marks ──
  const NK = 1400;
  const kPos = new Float32Array(NK * 4 * 3);
  const kIdx = new Uint16Array(NK * 6);
  for (let i = 0; i < NK; i++) { const b = i * 4; kIdx.set([b, b + 2, b + 1, b, b + 3, b + 2], i * 6); }
  const kGeo = new THREE.BufferGeometry();
  kGeo.setAttribute('position', new THREE.BufferAttribute(kPos, 3).setUsage(THREE.DynamicDrawUsage));
  kGeo.setIndex(new THREE.BufferAttribute(kIdx, 1));
  const kMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().fromArray(mix(P.asphalt, [0, 0, 0], P.dark ? 0.45 : 0.55)), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  const skids = new THREE.Mesh(kGeo, kMat);
  skids.frustumCulled = false;
  scene.add(skids);
  let kHead = 0; let kDirty = false; let kLo = NK; let kHi = 0;
  function skid(ax, ay, az, bx, by, bz, w) {
    const dx = bx - ax; const dz = bz - az; const l = Math.hypot(dx, dz);
    if (l < 0.05 || l > 6) return;
    const nx = (-dz / l) * w * 0.5; const nz = (dx / l) * w * 0.5;
    const o = kHead * 12;
    kPos[o] = ax - nx; kPos[o + 1] = ay + 0.06; kPos[o + 2] = az - nz;
    kPos[o + 3] = bx - nx; kPos[o + 4] = by + 0.06; kPos[o + 5] = bz - nz;
    kPos[o + 6] = bx + nx; kPos[o + 7] = by + 0.06; kPos[o + 8] = bz + nz;
    kPos[o + 9] = ax + nx; kPos[o + 10] = ay + 0.06; kPos[o + 11] = az + nz;
    if (kHead < kLo) kLo = kHead; if (kHead > kHi) kHi = kHead;
    kHead = (kHead + 1) % NK; kDirty = true;
  }
  // ── spikes + oil ──
  const NSP = 16;
  const stb = new Builder(THREE, P.outline);
  stb.box(0, 0.06, 0, 1, 0.12, 0.6, 0, [0.16, 0.16, 0.18], 0.03);
  for (let k = -9; k <= 9; k++) stb.cone(k / 19, 0.08, 0, 0.035, 0.22, [0.82, 0.84, 0.88], 0);
  stb.box(0.5, 0.2, 0, 0.06, 0.22, 0.2, 0, P.red, 0, FX_GLOW);
  stb.box(-0.5, 0.2, 0, 0.06, 0.22, 0.2, 0, P.blue, 0, FX_GLOW);
  const stripGeo = stb.geometryOut();
  const strips = new THREE.InstancedMesh(stripGeo, mats.vc, NSP);
  strips.frustumCulled = false; strips.count = 0;
  scene.add(strips);
  const ob = new Builder(THREE, P.outline);
  ob.add(ob.T.cyl, 0, 0.04, 0, 1, 0.02, 1, 0, [0.08, 0.07, 0.1], 0);
  ob.add(ob.T.cyl, 0.25, 0.05, -0.15, 0.4, 0.02, 0.3, 0, [0.35, 0.3, 0.45], 0);
  const oilGeo = ob.geometryOut();
  const oils = new THREE.InstancedMesh(oilGeo, mats.vc, 6);
  oils.frustumCulled = false; oils.count = 0;
  scene.add(oils);
  /** list: [{x, y, z, yaw, len, k (0..1 deploy)}] */
  function setStrips(list) {
    let n = 0;
    for (const s of list) {
      if (n >= NSP) break;
      dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(0, Math.PI - s.yaw, 0);
      dummy.scale.set(Math.max(0.001, s.len * s.k), 1, 1); dummy.updateMatrix();
      strips.setMatrixAt(n++, dummy.matrix);
    }
    strips.count = n; strips.instanceMatrix.needsUpdate = true;
  }
  function setOils(list) {
    let n = 0;
    for (const s of list) {
      if (n >= 6) break;
      dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(0, s.rot || 0, 0); dummy.scale.set(s.r * 2 * s.k, 1, s.r * 1.6 * s.k); dummy.updateMatrix();
      oils.setMatrixAt(n++, dummy.matrix);
    }
    oils.count = n; oils.instanceMatrix.needsUpdate = true;
  }

  // ── speed lines (clip space) ──
  const NL = 30;
  const lp = new Float32Array(NL * 3 * 3); const la = new Float32Array(NL * 3);
  const rr = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < NL; i++) {
    const a = (i / NL) * Math.PI * 2 + rr(i) * 0.2; const w = 0.006 + rr(i + 7) * 0.008;
    const r0 = 0.62 + rr(i + 3) * 0.3; const r1 = 1.5;
    const ca = Math.cos(a); const sa = Math.sin(a);
    lp.set([ca * r0, sa * r0, 0, ca * r1 - sa * w * 6, sa * r1 + ca * w * 6, 0, ca * r1 + sa * w * 6, sa * r1 - ca * w * 6, 0], i * 9);
    la.set([rr(i + 11), rr(i + 11), rr(i + 11)], i * 3);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  lg.setAttribute('seed', new THREE.BufferAttribute(la, 1));
  const lineMat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 0 }, uT: { value: 0 }, uAsp: { value: 1 }, uC: { value: new THREE.Color().fromArray(P.dark ? [0.9, 0.9, 0.95] : [1, 1, 1]) } },
    vertexShader: 'attribute float seed; uniform float uT; uniform float uAsp; varying float vA; void main(){ vec3 p = position; float ph = fract(seed + uT * (1.6 + seed)); vA = step(0.45, ph); p.x *= max(1.0, 1.0 / uAsp) ; p.y *= max(1.0, uAsp); gl_Position = vec4(p.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform float uK; uniform vec3 uC; varying float vA; void main(){ gl_FragColor = vec4(uC, uK * vA * 0.55); }',
    transparent: true, depthTest: false, depthWrite: false,
  });
  const lines = new THREE.Mesh(lg, lineMat);
  lines.frustumCulled = false; lines.renderOrder = 999;
  scene.add(lines);

  function update(dt, cam) {
    const cx = cam ? cam.position.x : 0; const cy = cam ? cam.position.y : 0; const cz = cam ? cam.position.z : 0;
    // puffs
    let w = 0;
    for (let i = 0; i < np; i++) {
      const o = i * 12;
      pp[o + 6] += dt;
      if (pp[o + 6] >= pp[o + 7]) continue;
      if (w !== i) { for (let k = 0; k < 12; k++) pp[w * 12 + k] = pp[o + k]; pbC[w] = pbC[i]; }
      const q = w * 12;
      pp[q] += pp[q + 3] * dt; pp[q + 1] += pp[q + 4] * dt; pp[q + 2] += pp[q + 5] * dt;
      const dr = Math.max(0, 1 - 1.8 * dt); pp[q + 3] *= dr; pp[q + 5] *= dr; pp[q + 4] *= Math.max(0, 1 - 0.8 * dt);
      const u = pp[q + 6] / pp[q + 7];
      let s = (pp[q + 8] + pp[q + 9] * pp[q + 6]) * (u > 0.7 ? (1 - u) / 0.3 : 1);
      // never let a puff fill the screen: shrink the ones right in front of the camera
      const dc = Math.hypot(pp[q] - cx, pp[q + 1] - cy, pp[q + 2] - cz);
      if (dc < 7) s *= Math.max(0, (dc - 2) / 5);
      dummy.position.set(pp[q], pp[q + 1], pp[q + 2]); dummy.rotation.set(u * 2, u * 3, 0); dummy.scale.setScalar(Math.max(0.001, s)); dummy.updateMatrix();
      puffs.setMatrixAt(w, dummy.matrix);
      col.setRGB(pp[q + 10], pp[q + 11], pbC[w]); puffs.setColorAt(w, col);
      w++;
    }
    np = w; puffs.count = np; puffs.instanceMatrix.needsUpdate = true; puffs.instanceColor.needsUpdate = true;
    // sparks
    w = 0;
    for (let i = 0; i < ns; i++) {
      const o = i * 8;
      sp[o + 6] += dt; if (sp[o + 6] >= sp[o + 7]) continue;
      if (w !== i) for (let k = 0; k < 8; k++) sp[w * 8 + k] = sp[o + k];
      const q = w * 8;
      sp[q + 4] -= 14 * dt; sp[q] += sp[q + 3] * dt; sp[q + 1] += sp[q + 4] * dt; sp[q + 2] += sp[q + 5] * dt;
      const v = Math.hypot(sp[q + 3], sp[q + 4], sp[q + 5]) || 1;
      dummy.position.set(sp[q], sp[q + 1], sp[q + 2]);
      dummy.lookAt(sp[q] + sp[q + 3], sp[q + 1] + sp[q + 4], sp[q + 2] + sp[q + 5]);
      dummy.scale.set(1, 1, Math.min(1.2, v * 0.05) * (1 - sp[q + 6] / sp[q + 7]));
      dummy.updateMatrix(); sparks.setMatrixAt(w, dummy.matrix);
      w++;
    }
    ns = w; sparks.count = ns; sparks.instanceMatrix.needsUpdate = true;
    if (kDirty) {
      const a = kGeo.getAttribute('position');
      a.updateRange.offset = kLo * 12; a.updateRange.count = (kHi - kLo + 1) * 12; a.needsUpdate = true;
      kDirty = false; kLo = NK; kHi = 0;
    }
    lineMat.uniforms.uT.value += dt;
  }

  return {
    puff, spark, skid, setStrips, setOils, update, puffs, sparks, skids, strips, oils, lines,
    setSpeedLines(k, asp) { lineMat.uniforms.uK.value = k; lineMat.uniforms.uAsp.value = asp; lines.visible = k > 0.01; },
    clear() { np = 0; ns = 0; puffs.count = 0; sparks.count = 0; kPos.fill(0); const a = kGeo.getAttribute('position'); a.updateRange.offset = 0; a.updateRange.count = -1; a.needsUpdate = true; kHead = 0; },
    stats: () => ({ puffs: np, sparks: ns }),
    dispose() { for (const g of [puffGeo, sparkGeo, kGeo, stripGeo, oilGeo, lg]) g.dispose(); kMat.dispose(); lineMat.dispose(); },
  };
}
