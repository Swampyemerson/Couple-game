// Getaway effects: soft billboard smoke / dust / fire puffs, glowing sparks, tumbling crash debris,
// a ring buffer of skid marks that fade with age, spike strips and oil slicks (instanced), and a
// clip-space speed-line overlay. Pools are preallocated; nothing is allocated per frame.
import { Builder, FX_GLOW, FX_TRIM, FX_CHROME } from './gfx.js';

export function createFx(THREE, scene, P, U, mats) {
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const dark = !!P.dark;
  // ── puffs (camera-facing soft sprites; fire / nitro glow additively) ──
  const NP = 260;
  const puffGeo = new THREE.PlaneGeometry(1, 1);
  const pA = new THREE.InstancedBufferAttribute(new Float32Array(NP * 2), 2); // alpha, emissive
  pA.setUsage(THREE.DynamicDrawUsage);
  puffGeo.setAttribute('iA', pA);
  const fogC = new THREE.Color(0.8, 0.8, 0.8);
  const puffMat = new THREE.ShaderMaterial({
    uniforms: { uFogC: { value: fogC }, uFogNear: { value: 120 }, uFogFar: { value: 520 }, uNight: { value: dark ? 1 : 0 } },
    vertexShader: `attribute vec2 iA; uniform float uFogNear; uniform float uFogFar; varying vec2 vUv; varying vec3 vCol; varying vec2 vA; varying float vF; varying float vSeed;
      void main(){
        vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(instanceMatrix[0].xyz);
        float a = instanceMatrix[1].x * 3.0; // rotation from the matrix (cheap: any per-instance value)
        vec2 p = position.xy; float ca = cos(a); float sa = sin(a);
        c.xy += vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca) * s;
        gl_Position = projectionMatrix * c;
        vUv = position.xy * 2.0;
        #ifdef USE_INSTANCING_COLOR
        vCol = instanceColor;
        #else
        vCol = vec3(1.0);
        #endif
        vA = iA; vSeed = fract(instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11);
        vF = smoothstep(uFogNear, uFogFar, length(c.xyz));
      }`,
    fragmentShader: `uniform vec3 uFogC; uniform float uNight; varying vec2 vUv; varying vec3 vCol; varying vec2 vA; varying float vF; varying float vSeed;
      float h2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float n2(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){
        float r = length(vUv);
        float n = n2(vUv * 2.2 + vSeed * 17.0) * 0.6 + n2(vUv * 5.0 - vSeed * 9.0) * 0.4;
        float a = (1.0 - smoothstep(0.35 + 0.35 * n, 1.0, r)) * vA.x;
        if (a < 0.01) discard;
        vec3 c;
        if (vA.y > 0.5) { c = vCol * (1.4 - r * 0.6); gl_FragColor = vec4(c * a * (1.0 - vF), 0.0); return; }
        float lit = 0.72 + 0.32 * clamp(vUv.y * 0.6 + 0.5, 0.0, 1.0) + 0.12 * n;
        c = vCol * lit * (1.0 - 0.45 * uNight);
        c = mix(c, uFogC, vF);
        gl_FragColor = vec4(c * a, a);
      }`,
    transparent: true, depthWrite: false, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const puffs = new THREE.InstancedMesh(puffGeo, puffMat, NP);
  puffs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NP * 3).fill(1), 3);
  puffs.frustumCulled = false; puffs.count = 0; puffs.renderOrder = 10;
  scene.add(puffs);
  if (scene.fog) { fogC.copy(scene.fog.color); puffMat.uniforms.uFogNear.value = scene.fog.near; puffMat.uniforms.uFogFar.value = scene.fog.far; }
  const pp = new Float32Array(NP * 12); // x y z vx vy vz life max size grow r g  (+b in a side array)
  const pbC = new Float32Array(NP); const pE = new Uint8Array(NP); const pS = new Float32Array(NP);
  let np = 0;
  function puff(x, y, z, vx, vy, vz, size, grow, life, r, g, b) {
    if (np >= NP) return;
    const o = np * 12;
    pp[o] = x; pp[o + 1] = y; pp[o + 2] = z; pp[o + 3] = vx; pp[o + 4] = vy; pp[o + 5] = vz;
    pp[o + 6] = 0; pp[o + 7] = life; pp[o + 8] = size; pp[o + 9] = grow; pp[o + 10] = r; pp[o + 11] = g; pbC[np] = b;
    // saturated colours (fire, nitro) glow
    pE[np] = Math.max(r, g, b) - Math.min(r, g, b) > 0.5 ? 1 : 0;
    pS[np] = Math.random() * 6.28;
    np++;
  }
  // ── sparks ──
  const NS = 160;
  const sb = new Builder(THREE, P.outline);
  sb.add(sb.T.box, 0, 0, 0.5, 0.06, 0.06, 1, 0, [1, 0.9, 0.5], 0, FX_GLOW);
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
  // ── debris (tumbling bits of car / glass / plastic) ──
  const ND = 120;
  const db = new Builder(THREE, P.outline);
  db.add(db.T.box, 0, 0, 0, 1, 0.35, 0.7, 0, [1, 1, 1], 0.02, 0);
  const debGeo = db.geometryOut();
  const debris = new THREE.InstancedMesh(debGeo, mats.vcColor || mats.vc, ND);
  debris.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ND * 3).fill(1), 3);
  debris.frustumCulled = false; debris.count = 0; debris.visible = false;
  scene.add(debris);
  const dd = new Float32Array(ND * 14); // x y z vx vy vz rx ry rz wx wy wz life gy
  const dS = new Float32Array(ND); const dC = new Float32Array(ND * 3);
  let nd = 0;
  /** n bits flying off (x, y, z) with base velocity (vx, vz), landing on ground gy; rgb = paint. */
  function crash(x, y, z, vx, vz, gy, n = 8, rgb = null) {
    for (let k = 0; k < n && nd < ND; k++) {
      const o = nd * 14;
      dd[o] = x + (Math.random() - 0.5) * 0.8; dd[o + 1] = y + Math.random() * 0.4; dd[o + 2] = z + (Math.random() - 0.5) * 0.8;
      dd[o + 3] = vx * 0.4 + (Math.random() - 0.5) * 7; dd[o + 4] = 2 + Math.random() * 5; dd[o + 5] = vz * 0.4 + (Math.random() - 0.5) * 7;
      dd[o + 6] = Math.random() * 6; dd[o + 7] = Math.random() * 6; dd[o + 8] = Math.random() * 6;
      dd[o + 9] = (Math.random() - 0.5) * 18; dd[o + 10] = (Math.random() - 0.5) * 18; dd[o + 11] = (Math.random() - 0.5) * 18;
      dd[o + 12] = 2.5 + Math.random() * 1.5; dd[o + 13] = gy;
      dS[nd] = 0.12 + Math.random() * 0.22;
      const kind = Math.random();
      const c = kind < 0.4 && rgb ? rgb : kind < 0.65 ? [0.1, 0.1, 0.11] : kind < 0.85 ? [0.6, 0.75, 0.85] : [0.85, 0.85, 0.82];
      dC[nd * 3] = c[0]; dC[nd * 3 + 1] = c[1]; dC[nd * 3 + 2] = c[2];
      nd++;
    }
  }
  // ── skid marks (fade with age, soft edges) ──
  const NK = 1800;
  const kPos = new Float32Array(NK * 4 * 3); const kQ = new Float32Array(NK * 4); const kSide = new Float32Array(NK * 4);
  const kIdx = new Uint16Array(NK * 6);
  for (let i = 0; i < NK; i++) { const b = i * 4; kIdx.set([b, b + 2, b + 1, b, b + 3, b + 2], i * 6); kQ.fill(i, b, b + 4); kSide[b] = 0; kSide[b + 1] = 0; kSide[b + 2] = 1; kSide[b + 3] = 1; }
  const kGeo = new THREE.BufferGeometry();
  kGeo.setAttribute('position', new THREE.BufferAttribute(kPos, 3).setUsage(THREE.DynamicDrawUsage));
  kGeo.setAttribute('q', new THREE.BufferAttribute(kQ, 1));
  kGeo.setAttribute('side', new THREE.BufferAttribute(kSide, 1));
  kGeo.setIndex(new THREE.BufferAttribute(kIdx, 1));
  const kMat = new THREE.ShaderMaterial({
    uniforms: { uHead: { value: 0 }, uN: { value: NK }, uC: { value: new THREE.Color().fromArray(dark ? [0.03, 0.03, 0.04] : [0.08, 0.08, 0.09]) }, uFogNear: { value: 120 }, uFogFar: { value: 520 } },
    vertexShader: 'attribute float q; attribute float side; uniform float uHead; uniform float uN; uniform float uFogNear; uniform float uFogFar; varying float vAge; varying float vS; varying float vF; void main(){ vAge = mod(uHead - q + uN, uN) / uN; vS = side; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vF = smoothstep(uFogNear, uFogFar, length(mv.xyz)); }',
    fragmentShader: 'uniform vec3 uC; varying float vAge; varying float vS; varying float vF; void main(){ float e = 1.0 - pow(abs(vS * 2.0 - 1.0), 3.0); float a = 0.62 * (1.0 - vAge * vAge * vAge) * (0.45 + 0.55 * e) * (1.0 - vF); gl_FragColor = vec4(uC, a); }',
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, fog: false,
  });
  if (scene.fog) { kMat.uniforms.uFogNear.value = scene.fog.near; kMat.uniforms.uFogFar.value = scene.fog.far; }
  const skids = new THREE.Mesh(kGeo, kMat);
  skids.frustumCulled = false; skids.renderOrder = 3;
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
  // an accordion of scissor links with steel spikes, yellow / black end caps
  const steel = [0.78, 0.8, 0.84]; const blk = [0.12, 0.12, 0.13];
  stb.box(0, 0.035, 0, 1, 0.05, 0.5, 0, blk, 0.02, FX_TRIM);
  for (let k = -9; k <= 8; k++) { const x = (k + 0.5) / 18.5; stb.add(stb.T.box, x, 0.08, 0, 0.075, 0.03, 0.56, (k & 1 ? 1 : -1) * 0.5, [0.45, 0.46, 0.5], 0, FX_CHROME); }
  for (let k = -9; k <= 9; k++) for (const zz of [-0.13, 0.13]) stb.cone(k / 19 + (zz > 0 ? 0.012 : -0.012), 0.08, zz, 0.028, 0.2, steel, 0, FX_CHROME);
  for (const sx of [-0.5, 0.5]) { stb.box(sx, 0.1, 0, 0.07, 0.18, 0.56, 0, [1, 0.82, 0.12], 0.02, 0); stb.box(sx, 0.1, 0, 0.072, 0.06, 0.57, 0, blk, 0, FX_TRIM); }
  stb.box(0.5, 0.24, 0, 0.05, 0.12, 0.16, 0, P.red, 0, FX_GLOW);
  stb.box(-0.5, 0.24, 0, 0.05, 0.12, 0.16, 0, P.blue, 0, FX_GLOW);
  const stripGeo = stb.geometryOut();
  const strips = new THREE.InstancedMesh(stripGeo, mats.vc, NSP);
  strips.frustumCulled = false; strips.count = 0;
  scene.add(strips);
  const ob = new Builder(THREE, P.outline);
  ob.add(ob.T.cyl16, 0, 0.04, 0, 1, 0.02, 1, 0, [0.06, 0.055, 0.08], 0, 8);
  ob.add(ob.T.cyl16, 0.25, 0.05, -0.15, 0.4, 0.02, 0.3, 0, [0.3, 0.24, 0.42], 0, 8);
  ob.add(ob.T.cyl16, -0.2, 0.05, 0.18, 0.3, 0.02, 0.22, 0, [0.22, 0.32, 0.4], 0, 8);
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
    strips.count = n; strips.visible = n > 0; strips.instanceMatrix.needsUpdate = true;
  }
  function setOils(list) {
    let n = 0;
    for (const s of list) {
      if (n >= 6) break;
      dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(0, s.rot || 0, 0); dummy.scale.set(s.r * 2 * s.k, 1, s.r * 1.6 * s.k); dummy.updateMatrix();
      oils.setMatrixAt(n++, dummy.matrix);
    }
    oils.count = n; oils.visible = n > 0; oils.instanceMatrix.needsUpdate = true;
  }

  // ── speed lines (clip space) ──
  const NL = 26;
  const lp = new Float32Array(NL * 3 * 3); const la = new Float32Array(NL * 3);
  const rr = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < NL; i++) {
    const a = (i / NL) * Math.PI * 2 + rr(i) * 0.2; const w = 0.004 + rr(i + 7) * 0.005;
    const r0 = 0.72 + rr(i + 3) * 0.28; const r1 = 1.5;
    const ca = Math.cos(a); const sa = Math.sin(a);
    lp.set([ca * r0, sa * r0, 0, ca * r1 - sa * w * 6, sa * r1 + ca * w * 6, 0, ca * r1 + sa * w * 6, sa * r1 - ca * w * 6, 0], i * 9);
    la.set([rr(i + 11), rr(i + 11), rr(i + 11)], i * 3);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  lg.setAttribute('seed', new THREE.BufferAttribute(la, 1));
  const lineMat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 0 }, uT: { value: 0 }, uAsp: { value: 1 }, uC: { value: new THREE.Color().fromArray(dark ? [0.85, 0.88, 0.95] : [1, 1, 1]) } },
    vertexShader: 'attribute float seed; uniform float uT; uniform float uAsp; varying float vA; varying float vR; void main(){ vec3 p = position; float ph = fract(seed + uT * (1.6 + seed)); vA = step(0.5, ph); vR = length(p.xy); p.x *= max(1.0, 1.0 / uAsp) ; p.y *= max(1.0, uAsp); gl_Position = vec4(p.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform float uK; uniform vec3 uC; varying float vA; varying float vR; void main(){ gl_FragColor = vec4(uC, uK * vA * 0.32 * smoothstep(0.7, 1.05, vR)); }',
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
      if (w !== i) { for (let k = 0; k < 12; k++) pp[w * 12 + k] = pp[o + k]; pbC[w] = pbC[i]; pE[w] = pE[i]; pS[w] = pS[i]; }
      const qq = w * 12;
      pp[qq] += pp[qq + 3] * dt; pp[qq + 1] += pp[qq + 4] * dt; pp[qq + 2] += pp[qq + 5] * dt;
      const dr = Math.max(0, 1 - 1.8 * dt); pp[qq + 3] *= dr; pp[qq + 5] *= dr; pp[qq + 4] *= Math.max(0, 1 - 0.8 * dt);
      const u = pp[qq + 6] / pp[qq + 7];
      let s = (pp[qq + 8] + pp[qq + 9] * pp[qq + 6]) * 1.5;
      // never let a puff fill the screen: fade the ones right in front of the camera
      const dc = Math.hypot(pp[qq] - cx, pp[qq + 1] - cy, pp[qq + 2] - cz);
      const near = dc < 6 ? Math.max(0, (dc - 1.5) / 4.5) : 1;
      const alpha = (pE[w] ? 0.9 : 0.55) * Math.min(1, u * 6) * (1 - u) * (1 - u * 0.3) * near;
      dummy.position.set(pp[qq], pp[qq + 1], pp[qq + 2]); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(Math.max(0.001, s)); dummy.updateMatrix();
      dummy.matrix.elements[4] = (pS[w] + u * 1.5) / 3; // rotation hint read by the shader (column 1, x)
      puffs.setMatrixAt(w, dummy.matrix);
      col.setRGB(pp[qq + 10], pp[qq + 11], pbC[w]); puffs.setColorAt(w, col);
      pA.array[w * 2] = alpha; pA.array[w * 2 + 1] = pE[w];
      w++;
    }
    np = w; puffs.count = np; puffs.visible = np > 0;
    if (np) { puffs.instanceMatrix.needsUpdate = true; puffs.instanceColor.needsUpdate = true; pA.needsUpdate = true; }
    // sparks
    w = 0;
    for (let i = 0; i < ns; i++) {
      const o = i * 8;
      sp[o + 6] += dt; if (sp[o + 6] >= sp[o + 7]) continue;
      if (w !== i) for (let k = 0; k < 8; k++) sp[w * 8 + k] = sp[o + k];
      const qq = w * 8;
      sp[qq + 4] -= 14 * dt; sp[qq] += sp[qq + 3] * dt; sp[qq + 1] += sp[qq + 4] * dt; sp[qq + 2] += sp[qq + 5] * dt;
      const v = Math.hypot(sp[qq + 3], sp[qq + 4], sp[qq + 5]) || 1;
      dummy.position.set(sp[qq], sp[qq + 1], sp[qq + 2]);
      dummy.lookAt(sp[qq] + sp[qq + 3], sp[qq + 1] + sp[qq + 4], sp[qq + 2] + sp[qq + 5]);
      dummy.scale.set(1, 1, Math.min(1.2, v * 0.05) * (1 - sp[qq + 6] / sp[qq + 7]));
      dummy.updateMatrix(); sparks.setMatrixAt(w, dummy.matrix);
      w++;
    }
    ns = w; sparks.count = ns; sparks.visible = ns > 0; if (ns) sparks.instanceMatrix.needsUpdate = true;
    // debris
    w = 0;
    for (let i = 0; i < nd; i++) {
      const o = i * 14;
      dd[o + 12] -= dt; if (dd[o + 12] <= 0) continue;
      if (w !== i) { for (let k = 0; k < 14; k++) dd[w * 14 + k] = dd[o + k]; dS[w] = dS[i]; dC[w * 3] = dC[i * 3]; dC[w * 3 + 1] = dC[i * 3 + 1]; dC[w * 3 + 2] = dC[i * 3 + 2]; }
      const qq = w * 14;
      dd[qq + 4] -= 15 * dt;
      dd[qq] += dd[qq + 3] * dt; dd[qq + 1] += dd[qq + 4] * dt; dd[qq + 2] += dd[qq + 5] * dt;
      if (dd[qq + 1] < dd[qq + 13] + dS[w] * 0.2) {
        dd[qq + 1] = dd[qq + 13] + dS[w] * 0.2;
        if (dd[qq + 4] < -1.5) { dd[qq + 4] *= -0.32; dd[qq + 3] *= 0.6; dd[qq + 5] *= 0.6; dd[qq + 9] *= 0.5; dd[qq + 11] *= 0.5; }
        else { dd[qq + 4] = 0; dd[qq + 3] *= Math.max(0, 1 - 5 * dt); dd[qq + 5] *= Math.max(0, 1 - 5 * dt); dd[qq + 9] *= Math.max(0, 1 - 6 * dt); dd[qq + 10] *= Math.max(0, 1 - 6 * dt); dd[qq + 11] *= Math.max(0, 1 - 6 * dt); dd[qq + 6] = Math.round(dd[qq + 6] / Math.PI) * Math.PI; }
      }
      dd[qq + 6] += dd[qq + 9] * dt; dd[qq + 7] += dd[qq + 10] * dt; dd[qq + 8] += dd[qq + 11] * dt;
      const sc = dS[w] * Math.min(1, dd[qq + 12] * 2);
      dummy.position.set(dd[qq], dd[qq + 1], dd[qq + 2]); dummy.rotation.set(dd[qq + 6], dd[qq + 7], dd[qq + 8]); dummy.scale.setScalar(Math.max(0.001, sc)); dummy.updateMatrix();
      debris.setMatrixAt(w, dummy.matrix); col.setRGB(dC[w * 3], dC[w * 3 + 1], dC[w * 3 + 2]); debris.setColorAt(w, col);
      w++;
    }
    nd = w; debris.count = nd; debris.visible = nd > 0;
    if (nd) { debris.instanceMatrix.needsUpdate = true; debris.instanceColor.needsUpdate = true; }
    if (kDirty) {
      const a = kGeo.getAttribute('position');
      a.updateRange.offset = kLo * 12; a.updateRange.count = (kHi - kLo + 1) * 12; a.needsUpdate = true;
      kDirty = false; kLo = NK; kHi = 0;
    }
    kMat.uniforms.uHead.value = kHead;
    lineMat.uniforms.uT.value += dt;
  }

  return {
    puff, spark, skid, crash, setStrips, setOils, update, puffs, sparks, skids, strips, oils, lines, debris,
    setSpeedLines(k, asp) { lineMat.uniforms.uK.value = k; lineMat.uniforms.uAsp.value = asp; lines.visible = k > 0.01; },
    clear() { np = 0; ns = 0; nd = 0; puffs.count = 0; sparks.count = 0; debris.count = 0; puffs.visible = sparks.visible = debris.visible = false; kPos.fill(0); const a = kGeo.getAttribute('position'); a.updateRange.offset = 0; a.updateRange.count = -1; a.needsUpdate = true; kHead = 0; },
    stats: () => ({ puffs: np, sparks: ns, debris: nd }),
    meshes() { return [puffs, sparks, skids, strips, oils, lines, debris]; },
    dispose() { for (const g of [puffGeo, sparkGeo, kGeo, stripGeo, oilGeo, lg, debGeo]) g.dispose(); kMat.dispose(); lineMat.dispose(); puffMat.dispose(); if (debris.parent) debris.parent.remove(debris); },
  };
}