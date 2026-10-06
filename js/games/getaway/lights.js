// Getaway light dressing (all instanced, a handful of draw calls in total):
//  • glow sprites: additive camera-facing halos for head/tail/brake/reverse lights, the cop's
//    lightbar and (at night) the nearest street lamps — "bloom-lite";
//  • headlight beams: soft additive cones in front of cars at night;
//  • contact shadows: a soft dark ellipse under every car (multiply blend);
//  • the per-pixel light uniforms: the two headlight spots nearest the camera and the eight
//    street-lamp pools nearest the camera (night).
// Producers (car views, traffic) push into the lists every frame; commit(cam, frameKey) uploads
// them once per frame (a second split-screen view of the same frame reuses them).

export function createLights(THREE, scene, U, P, cfg = {}, fog = { near: 120, far: 520 }) {
  const dark = !!P.dark;
  const NG = cfg.glows || 128; const NB = 24; const NBL = 96;
  const tmpM = new THREE.Matrix4(); const tmpQ = new THREE.Quaternion(); const tmpS = new THREE.Vector3(); const tmpP = new THREE.Vector3(); const tmpC = new THREE.Color();
  const fogU = { uFogNear: { value: fog.near }, uFogFar: { value: fog.far } };

  // ── glow sprites ──
  const quad = new THREE.PlaneGeometry(1, 1);
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { ...fogU },
    vertexShader: `uniform float uFogNear; uniform float uFogFar; varying vec2 vUv; varying vec3 vCol; varying float vF;
      void main(){
        vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(instanceMatrix[0].xyz);
        float d = length(c.xyz);
        c.xyz -= c.xyz / max(d, 0.001) * min(0.6, s * 0.4);
        c.xy += position.xy * s;
        gl_Position = projectionMatrix * c;
        vUv = position.xy * 2.0;
        #ifdef USE_INSTANCING_COLOR
        vCol = instanceColor;
        #else
        vCol = vec3(1.0);
        #endif
        vF = 1.0 - smoothstep(uFogNear, uFogFar * 1.1, d);
      }`,
    fragmentShader: `varying vec2 vUv; varying vec3 vCol; varying float vF;
      void main(){ float r = dot(vUv, vUv); float a = (exp(-r * 5.0) * 0.75 + exp(-r * 40.0) * 0.9) * (1.0 - smoothstep(0.7, 1.0, r)); gl_FragColor = vec4(vCol * a * vF, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation, fog: false,
  });
  const glows = new THREE.InstancedMesh(quad, glowMat, NG);
  glows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NG * 3), 3);
  glows.frustumCulled = false; glows.count = 0; glows.renderOrder = 20; glows.visible = false;
  scene.add(glows);

  // ── headlight beams ──
  let beams = null; let beamGeo = null; let beamMat = null;
  if (cfg.beams !== false && dark) {
    beamGeo = new THREE.CylinderGeometry(1, 0.08, 1, 14, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.5); // apex at 0 → wide end at +z
    beamMat = new THREE.ShaderMaterial({
      uniforms: { ...fogU },
      vertexShader: `uniform float uFogNear; uniform float uFogFar; varying float vZ; varying float vE; varying float vF; varying vec3 vCol;
        void main(){
          vZ = position.z;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vec3 n = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * vec3(position.x, position.y, 0.0));
          vec3 v = normalize(cameraPosition - w.xyz);
          vE = abs(dot(n, v));
          vec4 mv = viewMatrix * w; gl_Position = projectionMatrix * mv;
          vF = 1.0 - smoothstep(uFogNear * 0.6, uFogFar, length(mv.xyz));
          #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
          #else
          vCol = vec3(1.0);
          #endif
        }`,
      fragmentShader: `varying float vZ; varying float vE; varying float vF; varying vec3 vCol;
        void main(){ float a = pow(1.0 - vZ, 1.6) * smoothstep(0.0, 0.08, vZ) * pow(vE, 1.5) * 0.16; gl_FragColor = vec4(vCol * a * vF, 1.0); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation, fog: false,
    });
    beams = new THREE.InstancedMesh(beamGeo, beamMat, NB);
    beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NB * 3), 3);
    beams.frustumCulled = false; beams.count = 0; beams.renderOrder = 19; beams.visible = false;
    scene.add(beams);
  }

  // ── contact shadows ──
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const blobMat = makeDecalMaterial(THREE, dark, fog, true);
  const blobs = new THREE.InstancedMesh(blobGeo, blobMat, NBL);
  blobs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NBL * 3), 3);
  blobs.frustumCulled = false; blobs.count = 0; blobs.renderOrder = 2; blobs.visible = false;
  scene.add(blobs);

  // ── producer lists (struct-of-arrays, no allocation per frame), double-buffered: producers
  // fill `cur`; the first commit of a new frame shows it; later commits of the same frame (the
  // second split-screen view) reuse what is shown
  const mk = () => ({ G: { n: 0, d: new Float32Array(NG * 7) }, B: { n: 0, d: new Float32Array(NB * 8) }, BL: { n: 0, d: new Float32Array(NBL * 7) }, SP: { n: 0, d: new Float32Array(16 * 7) } });
  let cur = mk(); let shown = mk(); let lastKey = NaN;
  // G: x y z size r g b · B: x y z dx dy dz len k · BL: x y z yaw w l k · SP: x y z dx dy dz k
  let lamps = new Float32Array(0); let nLamps = 0;
  const nearL = new Int32Array(32); const nearD = new Float32Array(32);

  const api = {
    glows, beams, blobs, dark,
    /** Additive halo at (x,y,z), size in metres, colour (can exceed 1 for hot cores). */
    glow(x, y, z, size, r, g, b) {
      const G = cur.G; if (G.n >= NG) return; const o = G.n * 7; const d = G.d;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = size; d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; G.n++;
    },
    /** Headlight cone from (x,y,z) along unit (dx,dy,dz), len metres, strength k (night only). */
    beam(x, y, z, dx, dy, dz, len, k) {
      const B = cur.B; if (!beams || B.n >= NB) return; const o = B.n * 8; const d = B.d;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = dx; d[o + 4] = dy; d[o + 5] = dz; d[o + 6] = len; d[o + 7] = k; B.n++;
    },
    /** Soft contact shadow centred at (x,y,z), heading yaw (compass radians), w × l metres. */
    blob(x, y, z, yaw, w, l, k = 1) {
      const BL = cur.BL; if (BL.n >= NBL) return; const o = BL.n * 7; const d = BL.d;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = yaw; d[o + 4] = w; d[o + 5] = l; d[o + 6] = k; BL.n++;
    },
    /** A per-pixel headlight candidate; the two nearest the camera light the scene. */
    spot(x, y, z, dx, dy, dz, k) {
      const SP = cur.SP; if (SP.n >= 16) return; const o = SP.n * 7; const d = SP.d;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = dx; d[o + 4] = dy; d[o + 5] = dz; d[o + 6] = k; SP.n++;
    },
    /** Street-lamp heads [{x, y, z}] (static): pools + halos at night. */
    setLamps(list) {
      nLamps = list.length; lamps = new Float32Array(nLamps * 3);
      list.forEach((l, i) => { lamps[i * 3] = l.x; lamps[i * 3 + 1] = l.y; lamps[i * 3 + 2] = l.z; });
    },
    lampCount: () => nLamps,
    /** Upload this frame's lists for camera cam; frameKey is the same for every view of a frame. */
    commit(cam, frameKey) {
      const fresh = frameKey !== lastKey;
      if (fresh) { lastKey = frameKey; const t = shown; shown = cur; cur = t; cur.G.n = 0; cur.B.n = 0; cur.BL.n = 0; cur.SP.n = 0; }
      const { G, B, BL, SP } = shown;
      // the static lamp part depends on the camera: recompute every commit
      const fx = cam.position.x; const fz = cam.position.z;
      const e = cam.matrixWorld.elements; const fwx = -e[8]; const fwz = -e[10]; const fl = Math.hypot(fwx, fwz) || 1;
      const ax = fx + (fwx / fl) * 16; const az = fz + (fwz / fl) * 16;
      let nn = 0;
      if (dark && nLamps) {
        const K = Math.min(32, cfg.lampGlows || 20);
        for (let i = 0; i < nLamps; i++) {
          const dx = lamps[i * 3] - ax; const dz = lamps[i * 3 + 2] - az; const d2 = dx * dx + dz * dz;
          if (d2 > 200 * 200) continue;
          if (nn < K) { let j = nn++; while (j > 0 && nearD[j - 1] > d2) { nearD[j] = nearD[j - 1]; nearL[j] = nearL[j - 1]; j--; } nearD[j] = d2; nearL[j] = i; }
          else if (d2 < nearD[K - 1]) { let j = K - 1; while (j > 0 && nearD[j - 1] > d2) { nearD[j] = nearD[j - 1]; nearL[j] = nearL[j - 1]; j--; } nearD[j] = d2; nearL[j] = i; }
        }
      }
      // lamp pools: the 8 nearest
      const UL = U.uLamp.value;
      for (let k = 0; k < 8; k++) {
        if (k < nn) { const i = nearL[k]; const d = Math.sqrt(nearD[k]); UL[k].set(lamps[i * 3], lamps[i * 3 + 1], lamps[i * 3 + 2], 1 - smoothstep(55, 90, d)); }
        else UL[k].set(0, -999, 0, 0);
      }
      // glows: dynamic + lamp halos
      let n = 0;
      const put = (x, y, z, s, r, g, b) => {
        if (n >= NG) return;
        tmpM.makeScale(s, s, s); tmpM.elements[12] = x; tmpM.elements[13] = y; tmpM.elements[14] = z;
        glows.setMatrixAt(n, tmpM); tmpC.setRGB(r, g, b); glows.setColorAt(n, tmpC); n++;
      };
      for (let i = 0; i < G.n; i++) { const o = i * 7; const d = G.d; put(d[o], d[o + 1], d[o + 2], d[o + 3], d[o + 4], d[o + 5], d[o + 6]); }
      for (let k = 0; k < nn; k++) { const i = nearL[k]; const f = 1 - smoothstep(120, 200, Math.sqrt(nearD[k])); if (f > 0) put(lamps[i * 3], lamps[i * 3 + 1] - 0.15, lamps[i * 3 + 2], 2.6, 1.0 * f, 0.72 * f, 0.4 * f); }
      glows.count = n; glows.visible = n > 0; glows.instanceMatrix.needsUpdate = true; if (glows.instanceColor) glows.instanceColor.needsUpdate = true;
      if (fresh) {
        // beams
        if (beams) {
          let m = 0;
          for (let i = 0; i < B.n; i++) {
            const o = i * 8; const d = B.d;
            tmpP.set(d[o], d[o + 1], d[o + 2]); tmpS.set(d[o + 6] * 0.24, d[o + 6] * 0.12, d[o + 6]);
            const dirv = tmpQv.set(d[o + 3], d[o + 4], d[o + 5]).normalize();
            tmpQ.setFromUnitVectors(zAxis, dirv);
            tmpM.compose(tmpP, tmpQ, tmpS); beams.setMatrixAt(m, tmpM);
            const k = d[o + 7]; tmpC.setRGB(1.0 * k, 0.92 * k, 0.75 * k); beams.setColorAt(m, tmpC); m++;
          }
          beams.count = m; beams.visible = m > 0; beams.instanceMatrix.needsUpdate = true; if (beams.instanceColor) beams.instanceColor.needsUpdate = true;
        }
        // contact shadows
        let m = 0;
        for (let i = 0; i < BL.n; i++) {
          const o = i * 7; const d = BL.d;
          tmpP.set(d[o], d[o + 1], d[o + 2]); tmpS.set(d[o + 4], 1, d[o + 5]); tmpQ.setFromAxisAngle(yAxis, Math.PI - d[o + 3]);
          tmpM.compose(tmpP, tmpQ, tmpS); blobs.setMatrixAt(m, tmpM); tmpC.setRGB(d[o + 6], 0, 0); blobs.setColorAt(m, tmpC); m++;
        }
        blobs.count = m; blobs.visible = m > 0; blobs.instanceMatrix.needsUpdate = true; if (blobs.instanceColor) blobs.instanceColor.needsUpdate = true;
        // spots: the two nearest the camera
        const SPU = U.uSpotP.value; const SDU = U.uSpotD.value;
        let i0 = -1; let i1 = -1; let d0 = 1e18; let d1 = 1e18;
        for (let i = 0; i < SP.n; i++) {
          const o = i * 7; const d = SP.d; const q = (d[o] - fx) ** 2 + (d[o + 2] - fz) ** 2;
          if (q < d0) { i1 = i0; d1 = d0; i0 = i; d0 = q; } else if (q < d1) { i1 = i; d1 = q; }
        }
        for (const [k, i] of [[0, i0], [1, i1]]) {
          if (i < 0) { SPU[k].w = 0; continue; }
          const o = i * 7; const d = SP.d; SPU[k].set(d[o], d[o + 1], d[o + 2], d[o + 6]); SDU[k].set(d[o + 3], d[o + 4], d[o + 5]).normalize();
        }
      }
    },
    /** Empty every list (between rounds / after a map switch). */
    clear() { for (const L of [cur, shown]) { L.G.n = 0; L.B.n = 0; L.BL.n = 0; L.SP.n = 0; } glows.count = 0; blobs.count = 0; if (beams) beams.count = 0; glows.visible = blobs.visible = false; if (beams) beams.visible = false; for (const s of U.uSpotP.value) s.w = 0; },
    meshes() { return [glows, blobs, beams].filter(Boolean); },
    dispose() { quad.dispose(); glowMat.dispose(); blobGeo.dispose(); blobMat.dispose(); if (beamGeo) { beamGeo.dispose(); beamMat.dispose(); } for (const m of api.meshes()) if (m.parent) m.parent.remove(m); },
  };
  const tmpQv = new THREE.Vector3(); const zAxis = new THREE.Vector3(0, 0, 1); const yAxis = new THREE.Vector3(0, 1, 0);
  return api;
}

function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/**
 * Multiply-blend darkening decal. instanced: strength from instanceColor.r and a radial falloff on
 * the unit quad; otherwise per-vertex attribute `a` (0..1) is the darkening (static AO / shadows).
 */
export function makeDecalMaterial(THREE, dark, fog = { near: 120, far: 520 }, instanced = false) {
  const tint = dark ? 'vec3(0.62, 0.64, 0.74)' : 'vec3(0.5, 0.53, 0.64)';
  return new THREE.ShaderMaterial({
    uniforms: { uFogNear: { value: fog.near }, uFogFar: { value: fog.far }, uK: { value: dark ? 0.55 : 1 } },
    vertexShader: instanced
      ? `uniform float uFogNear; uniform float uFogFar; varying vec2 vUv; varying float vK; varying float vF;
        void main(){ vUv = position.xz * 2.0; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          #ifdef USE_INSTANCING_COLOR
          vK = instanceColor.r;
          #else
          vK = 1.0;
          #endif
          vF = 1.0 - smoothstep(uFogNear, uFogFar, length(mv.xyz)); }`
      : `attribute float a; uniform float uFogNear; uniform float uFogFar; varying float vK; varying float vF;
        void main(){ vK = a; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vF = 1.0 - smoothstep(uFogNear, uFogFar, length(mv.xyz)); }`,
    fragmentShader: instanced
      ? `uniform float uK; varying vec2 vUv; varying float vK; varying float vF;
        void main(){ float r = length(vUv); float a = (1.0 - smoothstep(0.35, 1.0, r)) * 0.8 + (1.0 - smoothstep(0.0, 0.7, r)) * 0.2; gl_FragColor = vec4(mix(vec3(1.0), ${tint} * 0.8, clamp(a * vK * uK * vF, 0.0, 1.0)), 1.0); }`
      : `uniform float uK; varying float vK; varying float vF;
        void main(){ gl_FragColor = vec4(mix(vec3(1.0), ${tint}, clamp(vK * uK * vF, 0.0, 1.0)), 1.0); }`,
    transparent: true, depthWrite: false, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide,
  });
}
