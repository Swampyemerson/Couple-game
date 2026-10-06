// Materials: one shared toon material for the whole diorama (vertex colours × atlas tile, with
// the ink outline hull expanded in the vertex shader), a toon material for chameleon bodies
// (same lighting so painted colours match the world), blob shadows and fx.

/** 3-step toon ramp (kept soft so a good paint job can actually blend). */
export function makeGradient(THREE, steps = [0.36, 0.62, 0.84]) {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => { const c = Math.round(v * 255); data[i * 4] = c; data[i * 4 + 1] = c; data[i * 4 + 2] = c; data[i * 4 + 3] = 255; });
  const t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** The world material. uniforms: uInk (outline colour), uOutline (metres at 1 m), uAtlas (px). */
export function makeWorldMaterial(THREE, { map, gradientMap, ink, outline = 0.0075, atlasSize = 1024 }) {
  const m = new THREE.MeshToonMaterial({ map, gradientMap, vertexColors: true });
  const uniforms = {
    uInk: { value: new THREE.Color(ink) },
    uOutline: { value: outline },
    uAtlas: { value: atlasSize },
  };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 tile;
attribute vec3 onrm;
uniform float uOutline;
varying vec4 vTile;
varying float vInk;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vTile = tile;
vInk = 0.0;
if (onrm.x != 0.0 || onrm.y != 0.0 || onrm.z != 0.0) {
  vec4 ip = modelViewMatrix * vec4(transformed, 1.0);
  float od = clamp(-ip.z, 0.4, 16.0);
  transformed += onrm * uOutline * (0.5 + 0.5 * od);
  vInk = 1.0;
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uInk;
uniform float uAtlas;
varying vec4 vTile;
varying float vInk;`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec2 tUv = vTile.xy + fract(vUv) * vTile.zw;
  #if __VERSION__ >= 300
    vec2 gx = dFdx(vUv) * vTile.zw;
    vec2 gy = dFdy(vUv) * vTile.zw;
    float mm = max(dot(gx, gx), dot(gy, gy)) * uAtlas * uAtlas;
    if (mm > 64.0) { float sc = 8.0 / sqrt(mm); gx *= sc; gy *= sc; }
    vec4 texelColor = textureGrad(map, tUv, gx, gy);
  #else
    vec4 texelColor = texture2D(map, tUv);
  #endif
  diffuseColor *= texelColor;
#endif`)
      .replace('#include <tonemapping_fragment>', `if (vInk > 0.5) gl_FragColor.rgb = uInk;
#include <tonemapping_fragment>`);
  };
  m.customProgramCacheKey = () => 'chm-world-1';
  return m;
}

/** Chameleon body material: the paint canvas as map, same lighting as the world. */
export function makeBodyMaterial(THREE, { map, gradientMap }) {
  const m = new THREE.MeshToonMaterial({ map, gradientMap });
  return m;
}

/** Blob shadows: one merged quad mesh, radial falloff in the shader, per-quad alpha attribute. */
export function makeBlobMaterial(THREE, color = '#3a2a1c') {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uFade: { value: 1 } },
    vertexShader: `attribute float alpha; varying vec2 vUv; varying float vA;
      void main() { vUv = uv; vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uFade; varying vec2 vUv; varying float vA;
      void main() { float d = length(vUv * 2.0 - 1.0) * 1.25; float a = (1.0 - smoothstep(0.35, 1.0, d)) * vA * uFade; gl_FragColor = vec4(uColor, a); }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/** Soft radial texture for single blob meshes (avatar shadows). */
export function makeBlobTexture(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Paint-splat alpha shape (white; tinted per instance). */
export function makeSplatTexture(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  let s = 11;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.beginPath(); g.arc(64, 64, 34, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rnd() * 0.3; const d = 30 + rnd() * 22; const r = 6 + rnd() * 9;
    g.beginPath(); g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a - 0.12) * d, 64 + Math.sin(a - 0.12) * d); g.lineTo(64 + Math.cos(a + 0.12) * d, 64 + Math.sin(a + 0.12) * d); g.fill();
    if (rnd() < 0.6) { const d2 = d + r + 4 + rnd() * 8; g.beginPath(); g.arc(64 + Math.cos(a) * d2, 64 + Math.sin(a) * d2, 2 + rnd() * 3, 0, Math.PI * 2); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Four-point sparkle for the scan glint. */
export function makeGlintTexture(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 - Math.PI / 2; const r = i % 2 ? 7 : 31; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
  g.closePath(); g.fill();
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 18); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
