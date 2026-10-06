// Rail Rush graphics helpers: theme palette, the ONE shared toon material (vertex colours +
// a per-vertex `fx` code for outlines / windows / sleepers / glow / stripes / halftone), geometry
// templates and a writer that merges transformed primitives, with ink outlines baked in as
// inverted hulls (reversed winding, unlit ink), into preallocated buffers.

// fx codes (attribute `fx`)
export const FX_PLAIN = 0;
export const FX_INK = 1;      // outline hull: unlit vertex colour
export const FX_FACADE = 2;   // window grid from world position (lit at night)
export const FX_GLOW = 3;     // emissive (lamps, headlights, tokens)
export const FX_SKY = 4;      // unlit, half fogged (skyline, sun)
export const FX_BED = 5;      // track bed: sleepers from world z
export const FX_STRIPE = 6;   // diagonal ink stripes (barriers)
export const FX_TRAINWIN = 7; // train side windows from world z
export const FX_PAPER = 8;    // diagonal paper-coloured stripes

// ── colours ──
let cctx = null;
/** Any CSS colour → [r, g, b] in 0..1 (the browser parses it, so oklch/color-mix etc. work). */
export function cssRGB(str, fallback = [0.5, 0.5, 0.5]) {
  try {
    if (!cctx) { const cv = document.createElement('canvas'); cv.width = cv.height = 1; cctx = cv.getContext('2d', { willReadFrequently: true }); }
    cctx.clearRect(0, 0, 1, 1);
    cctx.fillStyle = '#7f7f7f';
    cctx.fillStyle = str || '#7f7f7f';
    cctx.fillRect(0, 0, 1, 1);
    const d = cctx.getImageData(0, 0, 1, 1).data;
    if (!str) return fallback;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  } catch { return fallback; }
}
export const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Palette for the 3D world, derived from the theme tokens. */
export function makePalette(tok) {
  const c = (s, fb) => cssRGB(s, fb);
  const bg = c(tok.bg, [0.96, 0.95, 0.93]);
  const card = c(tok.card, [1, 1, 1]);
  const ink = c(tok.ink, [0.11, 0.1, 0.13]);
  const a = c(tok.a, [0.18, 0.36, 0.92]);
  const b = c(tok.b, [0.94, 0.26, 0.55]);
  const hl = c(tok.hl, [1, 0.82, 0.25]);
  const good = c(tok.good, [0.12, 0.62, 0.42]);
  const bad = c(tok.bad, [0.84, 0.27, 0.36]);
  const muted = c(tok.muted, [0.42, 0.41, 0.46]);
  const dark = !!tok.dark || lum(bg) < 0.35;
  // "paper" and "ink" in world terms: a dark theme is a night city with light linework.
  const paper = dark ? mix(bg, card, 0.6) : card;
  const shadeInk = dark ? mix(bg, [0, 0, 0], 0.55) : ink;
  const P = {
    dark, bg, card, ink, a, b, hl, good, bad, muted, paper, font: tok.fontDisplay || '',
    outline: dark ? mix(ink, bg, 0.12) : ink,
    fog: bg,
    sky: bg,
    street: dark ? mix(bg, [0, 0, 0], 0.2) : mix(bg, ink, 0.14),
    bed: dark ? mix(bg, [0.42, 0.38, 0.36], 0.32) : mix(mix(bg, ink, 0.38), [0.55, 0.47, 0.4], 0.35),
    sleeper: dark ? mix(bg, [0.55, 0.45, 0.36], 0.5) : mix(mix(ink, bg, 0.42), [0.42, 0.3, 0.22], 0.45),
    rail: dark ? mix(ink, bg, 0.35) : mix(ink, card, 0.22),
    deck: dark ? mix(bg, card, 0.9) : mix(card, ink, 0.12),
    parapet: dark ? mix(card, ink, 0.12) : mix(card, bg, 0.4),
    pole: dark ? mix(card, ink, 0.25) : mix(ink, card, 0.55),
    glass: dark ? mix(bg, [0, 0, 0], 0.35) : mix(mix(a, ink, 0.55), card, 0.12),
    lit: mix(hl, [1, 1, 1], 0.25),
    shadeInk,
    tunnel: dark ? mix(bg, [0, 0, 0], 0.3) : mix(bg, ink, 0.55),
    portal: dark ? mix(card, bad, 0.35) : mix(card, bad, 0.38),
    skin: [0.97, 0.87, 0.78],
    white: [0.98, 0.98, 0.97],
    pants: dark ? mix(ink, bg, 0.75) : mix(ink, bg, 0.12),
    hairA: [0.24, 0.17, 0.13],
    hairB: [0.45, 0.24, 0.16],
    coin: hl,
    coinRim: mix(hl, [0.85, 0.45, 0.05], 0.45),
  };
  const bTint = dark ? 0.55 : 0.0;
  P.buildings = [
    mix(mix(card, a, 0.22), bg, bTint), mix(mix(card, b, 0.2), bg, bTint), mix(mix(card, hl, 0.35), bg, bTint),
    mix(mix(card, good, 0.22), bg, bTint), mix(mix(card, ink, 0.14), bg, bTint), mix(mix(card, bad, 0.2), bg, bTint),
    mix(mix(card, muted, 0.3), bg, bTint),
  ];
  P.trains = [
    { body: mix(card, a, 0.62), stripe: hl },
    { body: mix(card, b, 0.55), stripe: card },
    { body: mix(card, good, 0.55), stripe: hl },
    { body: mix(card, muted, 0.35), stripe: bad },
    { body: mix(bad, card, 0.1), stripe: hl }, // oncoming
  ];
  P.skyline = [mix(bg, ink, dark ? 0.06 : 0.1), mix(bg, ink, dark ? 0.1 : 0.16), mix(bg, a, 0.12)];
  P.skyNear = [mix(bg, ink, dark ? 0.16 : 0.22), mix(mix(bg, a, 0.2), ink, dark ? 0.1 : 0.16), mix(mix(bg, b, 0.16), ink, dark ? 0.12 : 0.14)];
  // Colour script: the sky (and the fog that matches its horizon) warms up as the run gets fast.
  // [horizon, zenith] at a stroll and at top speed; every colour is a mix of the theme inks.
  P.skyCalm = dark ? [mix(bg, a, 0.16), mix(bg, [0, 0, 0], 0.35)] : [mix(bg, card, 0.5), mix(bg, a, 0.3)];
  P.skyFast = dark ? [mix(bg, b, 0.2), mix(mix(bg, a, 0.14), [0, 0, 0], 0.3)] : [mix(bg, hl, 0.2), mix(bg, b, 0.3)];
  return P;
}

// ── material ──
/** 3-step toon ramp. */
export function makeGradient(THREE) {
  const data = new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Shared uniforms (theme + light + screen) for every world/avatar material. */
export function makeUniforms(THREE, P) {
  return {
    uNight: { value: P.dark ? 1 : 0 },
    uGlass: { value: new THREE.Color().fromArray(P.glass) },
    uLit: { value: new THREE.Color().fromArray(P.lit) },
    uInk: { value: new THREE.Color().fromArray(P.outline) },
    uPaper: { value: new THREE.Color().fromArray(P.white) },
    uSleeper: { value: new THREE.Color().fromArray(P.sleeper) },
    uSun: { value: new THREE.Vector3(-0.42, 0.8, 0.43).normalize() },
    // ambient, sky (hemisphere), sun, halftone threshold
    uLk: { value: new THREE.Vector4(P.dark ? 0.62 : 0.6, P.dark ? 0.2 : 0.22, P.dark ? 0.26 : 0.3, 0.9) },
    uDot: { value: 4 },
  };
}
export function applyPaletteUniforms(U, P) {
  U.uNight.value = P.dark ? 1 : 0;
  U.uGlass.value.fromArray(P.glass); U.uLit.value.fromArray(P.lit); U.uInk.value.fromArray(P.outline);
  U.uPaper.value.fromArray(P.white); U.uSleeper.value.fromArray(P.sleeper);
}

// The world material is MeshBasicMaterial (no per-light loops) with a tiny hook: the toon band is
// computed per vertex from one sun direction + sky term (exact on flat faces, soft on round ones),
// ink hulls / glow / sky are unlit, the shadow band gets a screen-space halftone, and the skyline
// is only partly fogged. All patterns (windows, sleepers, stripes) are geometry, so the fragment
// shader stays about as cheap as plain MeshBasicMaterial.
const VERT_PRE = `#include <common>
attribute float fx;
uniform vec3 uSun;
uniform vec4 uLk;
uniform float uNight;
varying float vFx;
varying float vShade;`;
const VERT_POST = `#include <fog_vertex>
vFx = fx;
if ( fx > 0.5 && fx < 1.5 || fx > 3.5 && fx < 4.5 ) vShade = 1.0;
else if ( fx > 2.5 && fx < 3.5 ) vShade = 1.06 + 0.14 * uNight;
else {
  vec3 rrN = normal;
  #ifdef USE_SKINNING
    mat4 rrSk = skinWeight.x * boneMatX + skinWeight.y * boneMatY + skinWeight.z * boneMatZ + skinWeight.w * boneMatW;
    rrN = ( bindMatrixInverse * rrSk * bindMatrix * vec4( rrN, 0.0 ) ).xyz;
  #endif
  #ifdef USE_INSTANCING
    rrN = mat3( instanceMatrix ) * rrN;
  #endif
  rrN = normalize( mat3( modelMatrix ) * rrN );
  float ndl = dot( rrN, uSun );
  float band = ndl > 0.28 ? 1.0 : ( ndl > -0.22 ? 0.58 : 0.22 );
  vShade = uLk.x + uLk.y * ( 0.5 + 0.5 * rrN.y ) + uLk.z * band;
}`;
const FRAG_PRE = `#include <common>
uniform vec4 uLk;
uniform float uDot;
#ifdef RR_FADE
uniform float uFade;
#endif
varying float vFx;
varying float vShade;`;
// Shadow-band halftone: one fract + one dot product per shaded fragment (squared radius, no sqrt).
// Runners (the only skinned program) can also fade out through a halftone screen when the partner
// runs between the camera and you; the discard lives only in that program.
const FRAG_COLOR = `#include <color_fragment>
#ifdef RR_FADE
if ( uFade > 0.0 ) {
  vec2 q = fract( gl_FragCoord.xy * 0.25 ) - 0.5;
  if ( dot( q, q ) * 4.0 < uFade ) discard;
}
#endif
diffuseColor.rgb *= vShade;
if ( vShade < uLk.w && vFx < 0.5 ) {
  vec2 g = fract( gl_FragCoord.xy / uDot ) - 0.5;
  diffuseColor.rgb *= 1.0 - ( 1.0 - smoothstep( 0.0324, 0.09, dot( g, g ) ) ) * 0.17;
}`;
const FRAG_END = `if ( vFx > 3.5 && vFx < 4.5 ) {
  gl_FragColor.rgb = mix( vColor, fogColor, 0.3 );
} else {
  #include <fog_fragment>
}`;

/** The shared world material. One instance for the world (+ instanced variants), one skinned per runner. */
export function makeToon(THREE, grad, U, { skinning = false, extra = null } = {}) {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, skinning });
  // (three r128 only defines USE_SKINNING for vertex shaders, so the fade gets its own define)
  if (extra && extra.uFade) m.defines = { RR_FADE: '' };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    if (extra) Object.assign(sh.uniforms, extra);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_PRE).replace('#include <fog_vertex>', VERT_POST);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', FRAG_PRE)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <fog_fragment>', FRAG_END);
  };
  m.customProgramCacheKey = () => 'rush-toon-v4';
  return m;
}

// ── geometry templates ──
/** Turn a THREE geometry into a template { n, pos, nrm, idx, hull } (hull = outline directions). */
export function tpl(geo, hullMode = 'smooth') {
  const pa = geo.getAttribute('position');
  const na = geo.getAttribute('normal');
  const n = pa.count;
  const pos = new Float32Array(pa.array.length);
  pos.set(pa.array);
  const nrm = new Float32Array(n * 3);
  if (na) nrm.set(na.array);
  let idx;
  if (geo.index) idx = Uint16Array.from(geo.index.array);
  else { idx = new Uint16Array(n); for (let i = 0; i < n; i++) idx[i] = i; }
  const hull = new Float32Array(n * 3);
  if (hullMode === 'box') {
    for (let i = 0; i < n * 3; i++) hull[i] = pos[i] > 1e-6 ? 1 : pos[i] < -1e-6 ? -1 : 0;
  } else {
    // average the normals of coincident vertices so the hull has no cracks
    const acc = new Map();
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
      let e = acc.get(k);
      if (!e) { e = [0, 0, 0, []]; acc.set(k, e); }
      e[0] += nrm[i * 3]; e[1] += nrm[i * 3 + 1]; e[2] += nrm[i * 3 + 2]; e[3].push(i);
    }
    for (const e of acc.values()) {
      const l = Math.hypot(e[0], e[1], e[2]) || 1;
      for (const i of e[3]) { hull[i * 3] = e[0] / l; hull[i * 3 + 1] = e[1] / l; hull[i * 3 + 2] = e[2] / l; }
    }
  }
  geo.dispose();
  return { n, pos, nrm, idx, hull, box: hullMode === 'box' };
}

/** Unit parallelogram in the xy plane facing +z: a diagonal stripe (rising to the right, or to the left if `mirror`). */
function parallelogram(THREE, mirror = false) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(mirror ? [0.0, -0.5, 0, 0.5, -0.5, 0, 0.0, 0.5, 0, -0.5, 0.5, 0] : [-0.5, -0.5, 0, 0.0, -0.5, 0, 0.5, 0.5, 0, 0.0, 0.5, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Build every template once. */
export function makeTemplates(THREE) {
  const capsule = (r, len, seg = 8, rings = 3) => {
    const pts = [];
    for (let i = 0; i <= rings; i++) { const a = -Math.PI / 2 + (i / rings) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.cos(a) * r, -len / 2 + Math.sin(a) * r)); }
    for (let i = 0; i <= rings; i++) { const a = (i / rings) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.cos(a) * r, len / 2 + Math.sin(a) * r)); }
    pts[0].x = 0.0001; pts[pts.length - 1].x = 0.0001;
    return new THREE.LatheGeometry(pts, seg);
  };
  // Ramp wedge: unit box with the top sloping from z=+0.5 (low, toward the runner) to z=-0.5 (high)
  const wedge = () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i); const z = p.getZ(i);
      if (y > 0) p.setY(i, -0.5 + (0.5 - z));
    }
    g.computeVertexNormals();
    return g;
  };
  return {
    box: tpl(new THREE.BoxGeometry(1, 1, 1), 'box'),
    wedge: tpl(wedge(), 'box'),
    cyl: tpl(new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1), 'smooth'),
    cyl6: tpl(new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1), 'smooth'),
    cone: tpl(new THREE.CylinderGeometry(0.02, 0.5, 1, 6, 1), 'smooth'),
    disc: tpl(new THREE.CylinderGeometry(0.5, 0.5, 1, 18, 1), 'smooth'),
    disc12: tpl(new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1), 'smooth'),
    quad: tpl(new THREE.PlaneGeometry(1, 1), 'box'),
    quadUp: tpl(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), 'box'),
    stripe: tpl(parallelogram(THREE), 'box'),
    stripeL: tpl(parallelogram(THREE, true), 'box'),
    discZ: tpl(new THREE.CylinderGeometry(0.5, 0.5, 1, 28, 1).rotateX(Math.PI / 2), 'smooth'),
    sphere: tpl(new THREE.SphereGeometry(0.5, 14, 10), 'smooth'),
    sphere12: tpl(new THREE.SphereGeometry(0.5, 12, 8), 'smooth'),
    lowSphere: tpl(new THREE.SphereGeometry(0.5, 8, 6), 'smooth'),
    ico: tpl(new THREE.IcosahedronGeometry(0.5, 0), 'smooth'),
    octa: tpl(new THREE.OctahedronGeometry(0.5, 0), 'smooth'),
    cap: (r, len) => tpl(capsule(r, len), 'smooth'),
    capsule,
  };
}

// ── geometry writer ──
/** Preallocated vertex buffers you can fill with transformed templates and reuse. */
export class GeoBuf {
  constructor(THREE, maxV, { skin = false, dynamic = true } = {}) {
    this.maxV = maxV;
    this.maxI = maxV * 2;
    this.pos = new Float32Array(maxV * 3);
    this.nrm = new Float32Array(maxV * 3);
    this.col = new Float32Array(maxV * 3);
    this.fx = new Float32Array(maxV);
    this.idx = new Uint16Array(this.maxI);
    this.skin = skin;
    if (skin) { this.si = new Uint16Array(maxV * 4); this.sw = new Float32Array(maxV * 4); }
    this.nv = 0; this.ni = 0; this.over = false;
    const g = new THREE.BufferGeometry();
    const use = dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(use));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(use));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(use));
    g.setAttribute('fx', new THREE.BufferAttribute(this.fx, 1).setUsage(use));
    if (skin) {
      g.setAttribute('skinIndex', new THREE.BufferAttribute(this.si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(this.sw, 4));
    }
    g.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(use));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.bone = 0;
    this.sphere = new THREE.Sphere();
  }
  reset() { this.nv = 0; this.ni = 0; this.over = false; }
  /**
   * Add template `t` scaled (sx,sy,sz), rotated about Y by `ry`, translated (tx,ty,tz), coloured `rgb`,
   * with fx code `fx`. `ol` > 0 adds an ink outline hull `ol` metres thick in colour `ink`.
   */
  add(t, tx, ty, tz, sx, sy, sz, ry, rgb, fx, ol, ink) {
    const need = t.n * (ol > 0 ? 2 : 1);
    if (this.nv + need > this.maxV || this.ni + t.idx.length * (ol > 0 ? 2 : 1) > this.maxI) { this.over = true; return; }
    const c = Math.cos(ry); const s = Math.sin(ry);
    const P = this.pos; const N = this.nrm; const C = this.col; const F = this.fx;
    const pass = ol > 0 ? 2 : 1;
    for (let h = 0; h < pass; h++) {
      const base = this.nv;
      const col = h ? ink : rgb;
      const f = h ? 1 : fx;
      for (let i = 0; i < t.n; i++) {
        let px = t.pos[i * 3] * sx; let py = t.pos[i * 3 + 1] * sy; let pz = t.pos[i * 3 + 2] * sz;
        let nx = t.nrm[i * 3] / sx; let ny = t.nrm[i * 3 + 1] / sy; let nz = t.nrm[i * 3 + 2] / sz;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        if (h) {
          if (t.box) { px += t.hull[i * 3] * ol; py += t.hull[i * 3 + 1] * ol; pz += t.hull[i * 3 + 2] * ol; }
          else {
            let hx = t.hull[i * 3] / sx; let hy = t.hull[i * 3 + 1] / sy; let hz = t.hull[i * 3 + 2] / sz;
            const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
            px += (hx / hl) * ol; py += (hy / hl) * ol; pz += (hz / hl) * ol;
          }
        }
        const o = (base + i) * 3;
        P[o] = tx + px * c + pz * s; P[o + 1] = ty + py; P[o + 2] = tz - px * s + pz * c;
        N[o] = nx * c + nz * s; N[o + 1] = ny; N[o + 2] = -nx * s + nz * c;
        C[o] = col[0]; C[o + 1] = col[1]; C[o + 2] = col[2];
        F[base + i] = f;
        if (this.skin) { const q = (base + i) * 4; this.si[q] = this.bone; this.si[q + 1] = 0; this.si[q + 2] = 0; this.si[q + 3] = 0; this.sw[q] = 1; this.sw[q + 1] = 0; this.sw[q + 2] = 0; this.sw[q + 3] = 0; }
      }
      const I = this.idx; let ni = this.ni;
      const ti = t.idx;
      if (!h) for (let k = 0; k < ti.length; k++) I[ni++] = base + ti[k];
      else for (let k = 0; k < ti.length; k += 3) { I[ni++] = base + ti[k]; I[ni++] = base + ti[k + 2]; I[ni++] = base + ti[k + 1]; }
      this.ni = ni;
      this.nv = base + t.n;
    }
  }
  /** Axis-aligned box from min to max corner. */
  boxMM(x0, y0, z0, x1, y1, z1, rgb, fx, ol, ink, T) {
    this.add(T.box, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 0, rgb, fx, ol, ink);
  }
  /** Upload what was written. */
  commit(radius = 200, cx = 0, cy = 0, cz = 0) {
    const g = this.geo;
    for (const k of ['position', 'normal', 'color', 'fx']) {
      const a = g.getAttribute(k);
      a.updateRange.offset = 0; a.updateRange.count = this.nv * a.itemSize; a.needsUpdate = true;
    }
    if (this.skin) { g.getAttribute('skinIndex').needsUpdate = true; g.getAttribute('skinWeight').needsUpdate = true; }
    g.index.updateRange.offset = 0; g.index.updateRange.count = this.ni; g.index.needsUpdate = true;
    g.setDrawRange(0, this.ni);
    this.sphere.center.set(cx, cy, cz); this.sphere.radius = radius;
    g.boundingSphere = this.sphere;
  }
  /** Copy what was written into a right-sized static geometry (for instanced meshes / pools). */
  freeze(THREE) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, this.nv * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.nv * 3), 3));
    g.setAttribute('fx', new THREE.BufferAttribute(this.fx.slice(0, this.nv), 1));
    if (this.skin) {
      g.setAttribute('skinIndex', new THREE.BufferAttribute(this.si.slice(0, this.nv * 4), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(this.sw.slice(0, this.nv * 4), 4));
    }
    g.setIndex(new THREE.BufferAttribute(this.idx.slice(0, this.ni), 1));
    g.computeBoundingSphere();
    return g;
  }
  dispose() { this.geo.dispose(); }
}

/** Soft round blob texture (shadows). */
export function blobTexture(THREE) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(0.6, 'rgba(0,0,0,0.32)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  return t;
}
