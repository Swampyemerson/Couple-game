// Getaway graphics core: theme palette, the ONE toon shader family (per-vertex 3-band light,
// a halftone screen in the shadow band, shader-drawn facade windows, glow, a red/blue siren
// tint on nearby surfaces), a geometry Builder that merges primitives with ink outlines baked in
// as inverted hulls, the chunk auto-merger (every toon mesh in a chunk → one draw call per
// material family, material colours baked into vertex colours) and the sky dome.

export const FX_PLAIN = 0;
export const FX_INK = 1;
export const FX_WINDOWS = 2;
export const FX_GLOW = 3;
export const FX_FAR = 4; // unlit, slightly fogged (backdrop)

// ── colours ──
let cctx = null;
export function cssRGB(str, fb = [0.5, 0.5, 0.5]) {
  if (Array.isArray(str)) return str;
  if (typeof str === 'number') return [((str >> 16) & 255) / 255, ((str >> 8) & 255) / 255, (str & 255) / 255];
  if (str && typeof str === 'object' && 'r' in str) return [str.r, str.g, str.b];
  if (!str) return fb;
  if (typeof str === 'string' && /^#[0-9a-f]{6}$/i.test(str)) { const n = parseInt(str.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
  if (typeof str === 'string' && /^#[0-9a-f]{3}$/i.test(str)) { const h = str.slice(1); return [parseInt(h[0] + h[0], 16) / 255, parseInt(h[1] + h[1], 16) / 255, parseInt(h[2] + h[2], 16) / 255]; }
  try {
    if (!cctx) { const cv = document.createElement('canvas'); cv.width = cv.height = 1; cctx = cv.getContext('2d', { willReadFrequently: true }); }
    cctx.clearRect(0, 0, 1, 1); cctx.fillStyle = '#7f7f7f'; cctx.fillStyle = str; cctx.fillRect(0, 0, 1, 1);
    const d = cctx.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  } catch { return fb; }
}
export const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
export const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export function makePalette(tok) {
  const c = (s, fb) => cssRGB(s, fb);
  const bg = c(tok.bg, [0.96, 0.95, 0.93]); const card = c(tok.card, [1, 1, 1]); const ink = c(tok.ink, [0.11, 0.1, 0.13]);
  const a = c(tok.a, [0.18, 0.36, 0.92]); const b = c(tok.b, [0.94, 0.26, 0.55]); const hl = c(tok.hl, [1, 0.82, 0.25]);
  const good = c(tok.good, [0.12, 0.62, 0.42]); const bad = c(tok.bad, [0.84, 0.27, 0.36]);
  const dark = !!tok.dark || lum(bg) < 0.35;
  return {
    dark, bg, card, ink, a, b, hl, good, bad,
    outline: dark ? [0.06, 0.05, 0.08] : ink,
    asphalt: dark ? [0.2, 0.2, 0.24] : [0.36, 0.36, 0.4],
    asphaltHi: dark ? [0.24, 0.24, 0.28] : [0.42, 0.41, 0.45],
    dirtRoad: dark ? [0.36, 0.3, 0.24] : [0.66, 0.56, 0.42],
    curb: dark ? [0.5, 0.5, 0.52] : [0.86, 0.84, 0.8],
    lineW: dark ? [0.86, 0.84, 0.8] : [0.97, 0.96, 0.93],
    lineY: mix(hl, [1, 0.7, 0.1], 0.25),
    glass: dark ? [0.1, 0.12, 0.2] : mix(mix(a, ink, 0.5), card, 0.2),
    lit: mix(hl, [1, 1, 1], 0.2),
    grass: dark ? [0.22, 0.33, 0.24] : [0.55, 0.72, 0.42],
    white: [0.97, 0.97, 0.95],
    copBody: dark ? [0.12, 0.12, 0.16] : [0.14, 0.14, 0.18],
    copDoor: [0.96, 0.96, 0.94],
    red: [0.95, 0.15, 0.2], blue: [0.15, 0.4, 1.0],
    traffic: [[0.86, 0.3, 0.26], [0.95, 0.78, 0.3], [0.32, 0.6, 0.48], [0.88, 0.88, 0.86], [0.36, 0.42, 0.66], [0.62, 0.36, 0.56], [0.94, 0.56, 0.3], [0.5, 0.52, 0.56], [0.3, 0.7, 0.78], [0.78, 0.66, 0.5]],
  };
}

// ── shader ──
export function makeUniforms(THREE, P) {
  return {
    uNight: { value: P.dark ? 1 : 0 },
    uGlass: { value: new THREE.Color().fromArray(P.glass) },
    uLit: { value: new THREE.Color().fromArray(P.lit) },
    uSun: { value: new THREE.Vector3(-0.42, 0.8, 0.43).normalize() },
    uLk: { value: new THREE.Vector4(P.dark ? 0.42 : 0.58, P.dark ? 0.18 : 0.22, P.dark ? 0.22 : 0.32, P.dark ? 0.62 : 0.86) },
    uDot: { value: 4 },
    uSiren: { value: new THREE.Vector4(0, -999, 0, 0) },   // xyz = lightbar, w = strength
    uSirenCol: { value: new THREE.Color(1, 0.1, 0.1) },
    uHead: { value: new THREE.Vector4(0, -999, 0, 0) },    // my headlights (night): xyz, w
    uHeadDir: { value: new THREE.Vector3(0, 0, -1) },
  };
}

const VERT_PRE = `#include <common>
attribute float fx;
uniform vec3 uSun;
uniform vec4 uLk;
uniform float uNight;
uniform float uFxm;
uniform vec4 uSiren;
uniform vec3 uSirenCol;
uniform vec4 uHead;
uniform vec3 uHeadDir;
varying float vFx;
varying float vShade;
varying vec3 vTint;
#ifdef GTW_WIN
varying vec3 vWPos;
varying vec3 vWN;
#endif`;
const VERT_POST = `#include <fog_vertex>
vFx = fx + uFxm;
vec3 gN = normal;
#ifdef USE_INSTANCING
  gN = mat3( instanceMatrix ) * gN;
#endif
gN = normalize( mat3( modelMatrix ) * gN );
vec4 gW = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  gW = instanceMatrix * gW;
#endif
gW = modelMatrix * gW;
#ifdef GTW_WIN
vWPos = gW.xyz; vWN = gN;
#endif
vTint = vec3( 0.0 );
if ( vFx > 0.5 && vFx < 1.5 || vFx > 3.5 ) vShade = 1.0;
else if ( vFx > 2.5 && vFx < 3.5 ) vShade = 1.05 + 0.15 * uNight;
else {
  float ndl = dot( gN, uSun );
  float band = ndl > 0.28 ? 1.0 : ( ndl > -0.22 ? 0.56 : 0.2 );
  vShade = uLk.x + uLk.y * ( 0.5 + 0.5 * gN.y ) + uLk.z * band;
  if ( uSiren.w > 0.0 ) {
    vec3 d = gW.xyz - uSiren.xyz; float q = dot( d, d );
    vTint = uSirenCol * uSiren.w * max( 0.0, 1.0 - q / 380.0 ) * ( 0.35 + 0.65 * max( 0.0, -dot( normalize( d + vec3( 0.0, 0.001, 0.0 ) ), gN ) ) );
  }
  if ( uHead.w > 0.0 ) {
    vec3 d = gW.xyz - uHead.xyz; float l = length( d );
    float cone = smoothstep( 0.55, 0.9, dot( d / max( l, 0.001 ), uHeadDir ) );
    vTint += vec3( 1.0, 0.92, 0.7 ) * uHead.w * cone * max( 0.0, 1.0 - l / 46.0 ) * 0.55;
  }
}`;
const FRAG_PRE = `#include <common>
uniform vec4 uLk;
uniform float uDot;
uniform float uNight;
uniform vec3 uGlass;
uniform vec3 uLit;
varying float vFx;
varying float vShade;
varying vec3 vTint;
#ifdef GTW_WIN
varying vec3 vWPos;
varying vec3 vWN;
#endif`;
const FRAG_COLOR = `#include <color_fragment>
float gShade = vShade;
#ifdef GTW_WIN
if ( vFx > 1.5 && vFx < 2.5 && abs( vWN.y ) < 0.5 ) {
  vec2 hz = normalize( vec2( -vWN.z, vWN.x ) );
  float u = dot( vWPos.xz, hz );
  vec2 cell = vec2( u / 3.1, ( vWPos.y - 0.9 ) / 3.3 );
  vec2 g = fract( cell );
  float win = step( 0.2, g.x ) * step( g.x, 0.8 ) * step( 0.3, g.y ) * step( g.y, 0.82 ) * step( 0.0, cell.y );
  vec2 id = floor( cell );
  float hsh = fract( sin( dot( id, vec2( 12.9898, 78.233 ) ) + floor( vWPos.x * 0.01 ) * 3.1 + floor( vWPos.z * 0.01 ) * 7.7 ) * 43758.5453 );
  bool lit = uNight > 0.5 && hsh > 0.42;
  vec3 wc = lit ? uLit : uGlass * ( 0.85 + 0.3 * hsh );
  diffuseColor.rgb = mix( diffuseColor.rgb, wc, win );
  if ( lit && win > 0.5 ) gShade = 1.12;
}
#endif
diffuseColor.rgb *= gShade;
diffuseColor.rgb += vTint * diffuseColor.rgb * 2.2 + vTint * 0.25;
if ( gShade < uLk.w && vFx < 0.5 ) {
  vec2 hg = fract( gl_FragCoord.xy / uDot ) - 0.5;
  diffuseColor.rgb *= 1.0 - ( 1.0 - smoothstep( 0.0324, 0.09, dot( hg, hg ) ) ) * 0.16;
}`;
const FRAG_END = `if ( vFx > 3.5 ) {
  #ifdef USE_FOG
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, 0.18 );
  #endif
} else {
  #include <fog_fragment>
}`;

/** A toon material. opts: { vertexColors, fx (0 plain, 2 windows, 3 glow, 4 far), side, fog,
 *  transparent, opacity, depthWrite, polygonOffset }. */
export function makeToon(THREE, U, color, opts = {}) {
  const m = new THREE.MeshBasicMaterial({
    color: color == null ? 0xffffff : new THREE.Color().fromArray(cssRGB(color)),
    vertexColors: !!opts.vertexColors,
    side: opts.side || THREE.FrontSide,
    fog: opts.fog !== false,
    transparent: !!opts.transparent,
    opacity: opts.opacity == null ? 1 : opts.opacity,
    depthWrite: opts.depthWrite !== false,
  });
  if (opts.polygonOffset) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = opts.polygonOffset; }
  const uFxm = { value: opts.fx || 0 };
  m.defines = { GTW_WIN: '' };
  m.userData.gtw = { fx: opts.fx || 0, outline: opts.outline || 0, uFxm };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.uniforms.uFxm = uFxm;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_PRE).replace('#include <fog_vertex>', VERT_POST);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', FRAG_PRE).replace('#include <color_fragment>', FRAG_COLOR).replace('#include <fog_fragment>', FRAG_END);
  };
  m.customProgramCacheKey = () => 'gtw-toon-v1';
  return m;
}

// ── geometry templates (unit primitives with outline hull directions) ──
export function tplFromGeo(geo, boxHull = false) {
  const g = geo.index ? geo : geo;
  const pa = g.getAttribute('position'); const n = pa.count;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const na = g.getAttribute('normal');
  const pos = new Float32Array(n * 3); const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = pa.getX(i); pos[i * 3 + 1] = pa.getY(i); pos[i * 3 + 2] = pa.getZ(i); nrm[i * 3] = na.getX(i); nrm[i * 3 + 1] = na.getY(i); nrm[i * 3 + 2] = na.getZ(i); }
  let idx;
  if (g.index) { idx = new Uint32Array(g.index.count); for (let i = 0; i < idx.length; i++) idx[i] = g.index.getX(i); }
  else { idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; }
  return { n, pos, nrm, idx, hull: hullDirs(pos, nrm, n, boxHull), box: boxHull };
}
/** Outline directions: normals averaged over coincident vertices (numeric keys, no cracks). */
export function hullDirs(pos, nrm, n, boxHull) {
  const hull = new Float32Array(n * 3);
  if (boxHull) { for (let i = 0; i < n * 3; i++) hull[i] = pos[i] > 1e-6 ? 1 : pos[i] < -1e-6 ? -1 : 0; return hull; }
  const acc = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos[i * 3] * 1000) * 73856093 ^ Math.round(pos[i * 3 + 1] * 1000) * 19349663 ^ Math.round(pos[i * 3 + 2] * 1000) * 83492791;
    let e = acc.get(k); if (!e) { e = [0, 0, 0, []]; acc.set(k, e); }
    e[0] += nrm[i * 3]; e[1] += nrm[i * 3 + 1]; e[2] += nrm[i * 3 + 2]; e[3].push(i);
  }
  for (const e of acc.values()) {
    const l = Math.hypot(e[0], e[1], e[2]) || 1;
    for (const i of e[3]) { hull[i * 3] = e[0] / l; hull[i * 3 + 1] = e[1] / l; hull[i * 3 + 2] = e[2] / l; }
  }
  return hull;
}

let TPL = null;
export function templates(THREE) {
  if (TPL) return TPL;
  const t = (g, box) => { const r = tplFromGeo(g, box); g.dispose(); return r; };
  const wedge = () => { // unit box whose top slopes down towards +z (hoods, windscreens)
    const g = new THREE.BoxGeometry(1, 1, 1); const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0 && p.getZ(i) > 0) p.setY(i, -0.5);
    g.computeVertexNormals(); return g;
  };
  const roof = () => { // gable roof: unit box with a ridge along x
    const g = new THREE.BoxGeometry(1, 1, 1); const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setZ(i, 0);
    g.computeVertexNormals(); return g;
  };
  TPL = {
    box: t(new THREE.BoxGeometry(1, 1, 1), true),
    wedge: t(wedge(), true),
    roof: t(roof(), false),
    cyl: t(new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1), false),
    cyl6: t(new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1), false),
    cone: t(new THREE.CylinderGeometry(0.0, 0.5, 1, 7, 1), false),
    cone5: t(new THREE.CylinderGeometry(0.0, 0.5, 1, 5, 1), false),
    sphere: t(new THREE.IcosahedronGeometry(0.5, 1), false),
    ico: t(new THREE.IcosahedronGeometry(0.5, 0), false),
    wheel: t(new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1).rotateZ(Math.PI / 2), false),
  };
  return TPL;
}

// ── Builder ──
/** Growable merged geometry: add primitives (with optional ink outline), then mesh(). */
export class Builder {
  constructor(THREE, inkRGB) {
    this.THREE = THREE; this.T = templates(THREE); this.ink = inkRGB || [0.1, 0.1, 0.12];
    this.cap = 4096; this.nv = 0; this.ni = 0;
    this.pos = new Float32Array(this.cap * 3); this.nrm = new Float32Array(this.cap * 3); this.col = new Float32Array(this.cap * 3); this.fx = new Float32Array(this.cap);
    this.icap = 8192; this.idx = new Uint32Array(this.icap);
  }
  grow(nv, ni) {
    if (this.nv + nv > this.cap) {
      let c = this.cap; while (this.nv + nv > c) c *= 2;
      for (const k of ['pos', 'nrm', 'col']) { const a = new Float32Array(c * 3); a.set(this[k]); this[k] = a; }
      const f = new Float32Array(c); f.set(this.fx); this.fx = f; this.cap = c;
    }
    if (this.ni + ni > this.icap) { let c = this.icap; while (this.ni + ni > c) c *= 2; const a = new Uint32Array(c); a.set(this.idx); this.idx = a; this.icap = c; }
  }
  get empty() { return this.nv === 0; }
  /** Template t scaled (sx,sy,sz), rotated ry about y (THREE convention), at (x,y,z). */
  add(t, x, y, z, sx, sy, sz, ry, color, ol = 0, fx = 0, inkCol = null, rx = 0) {
    const rgb = cssRGB(color);
    const ink = inkCol || this.ink;
    const pass = ol > 0 ? 2 : 1;
    this.grow(t.n * pass, t.idx.length * pass);
    const c = Math.cos(ry); const s = Math.sin(ry);
    const cr = Math.cos(rx); const sr = Math.sin(rx);
    for (let h = 0; h < pass; h++) {
      const base = this.nv; const col = h ? ink : rgb; const f = h ? FX_INK : fx;
      for (let i = 0; i < t.n; i++) {
        let px = t.pos[i * 3] * sx; let py = t.pos[i * 3 + 1] * sy; let pz = t.pos[i * 3 + 2] * sz;
        let nx = t.nrm[i * 3] / sx; let ny = t.nrm[i * 3 + 1] / sy; let nz = t.nrm[i * 3 + 2] / sz;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        if (h) {
          if (t.box) { px += t.hull[i * 3] * ol; py += t.hull[i * 3 + 1] * ol; pz += t.hull[i * 3 + 2] * ol; }
          else { let hx = t.hull[i * 3] / sx; let hy = t.hull[i * 3 + 1] / sy; let hz = t.hull[i * 3 + 2] / sz; const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1; px += (hx / hl) * ol; py += (hy / hl) * ol; pz += (hz / hl) * ol; }
        }
        if (rx) { const y2 = py * cr - pz * sr; const z2 = py * sr + pz * cr; py = y2; pz = z2; const ny2 = ny * cr - nz * sr; const nz2 = ny * sr + nz * cr; ny = ny2; nz = nz2; }
        const o = (base + i) * 3;
        this.pos[o] = x + px * c + pz * s; this.pos[o + 1] = y + py; this.pos[o + 2] = z - px * s + pz * c;
        this.nrm[o] = nx * c + nz * s; this.nrm[o + 1] = ny; this.nrm[o + 2] = -nx * s + nz * c;
        this.col[o] = col[0]; this.col[o + 1] = col[1]; this.col[o + 2] = col[2];
        this.fx[base + i] = f;
      }
      const ti = t.idx; let ni = this.ni;
      if (!h) for (let k = 0; k < ti.length; k++) this.idx[ni++] = base + ti[k];
      else for (let k = 0; k < ti.length; k += 3) { this.idx[ni++] = base + ti[k]; this.idx[ni++] = base + ti[k + 2]; this.idx[ni++] = base + ti[k + 1]; }
      this.ni = ni; this.nv = base + t.n;
    }
    return this;
  }
  /** Box centred at (x, y, z) — y is the CENTRE; use boxOn() to stand one on the ground. */
  box(x, y, z, w, h, d, ry, color, ol = 0, fx = 0) { return this.add(this.T.box, x, y, z, w, h, d, ry || 0, color, ol, fx); }
  boxOn(x, y0, z, w, h, d, ry, color, ol = 0, fx = 0) { return this.add(this.T.box, x, y0 + h / 2, z, w, h, d, ry || 0, color, ol, fx); }
  cyl(x, y0, z, r, h, color, ol = 0, fx = 0, seg6 = false) { return this.add(seg6 ? this.T.cyl6 : this.T.cyl, x, y0 + h / 2, z, r * 2, h, r * 2, 0, color, ol, fx); }
  cone(x, y0, z, r, h, color, ol = 0, fx = 0) { return this.add(this.T.cone, x, y0 + h / 2, z, r * 2, h, r * 2, 0, color, ol, fx); }
  sphere(x, y, z, r, color, ol = 0, fx = 0, sy = 1) { return this.add(this.T.sphere, x, y, z, r * 2, r * 2 * sy, r * 2, 0, color, ol, fx); }
  /** Any THREE geometry, transformed by a Matrix4 (or null). */
  geometry(geo, matrix, color, ol = 0, fx = 0) {
    const t = tplFromGeo(geo, false);
    if (matrix) {
      const e = matrix.elements; const n = t.n;
      for (let i = 0; i < n; i++) {
        const x = t.pos[i * 3]; const y = t.pos[i * 3 + 1]; const z = t.pos[i * 3 + 2];
        t.pos[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; t.pos[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; t.pos[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        const nx = t.nrm[i * 3]; const ny = t.nrm[i * 3 + 1]; const nz = t.nrm[i * 3 + 2];
        let ax = e[0] * nx + e[4] * ny + e[8] * nz; let ay = e[1] * nx + e[5] * ny + e[9] * nz; let az = e[2] * nx + e[6] * ny + e[10] * nz;
        const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
        t.nrm[i * 3] = ax; t.nrm[i * 3 + 1] = ay; t.nrm[i * 3 + 2] = az;
      }
      t.hull = hullDirs(t.pos, t.nrm, t.n, false);
    }
    return this.add(t, 0, 0, 0, 1, 1, 1, 0, color, ol, fx);
  }
  /** Raw triangles/quads: verts [[x,y,z],…] (convex polygon, CCW seen from the normal side). */
  poly(verts, color, fx = 0, nrm = null) {
    const n = verts.length; this.grow(n, (n - 2) * 3);
    const rgb = cssRGB(color);
    let nx = 0; let ny = 1; let nz = 0;
    if (nrm) { [nx, ny, nz] = nrm; } else if (n >= 3) {
      const a = verts[0]; const b = verts[1]; const c = verts[2];
      const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2]; const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    }
    const base = this.nv;
    for (let i = 0; i < n; i++) {
      const o = (base + i) * 3; const v = verts[i];
      this.pos[o] = v[0]; this.pos[o + 1] = v[1]; this.pos[o + 2] = v[2];
      this.nrm[o] = nx; this.nrm[o + 1] = ny; this.nrm[o + 2] = nz;
      this.col[o] = rgb[0]; this.col[o + 1] = rgb[1]; this.col[o + 2] = rgb[2]; this.fx[base + i] = fx;
    }
    for (let i = 1; i < n - 1; i++) { this.idx[this.ni++] = base; this.idx[this.ni++] = base + i; this.idx[this.ni++] = base + i + 1; }
    this.nv += n;
    return this;
  }
  /** Fast quad strip writer used by road ribbons: 4 verts, upward normal. */
  quadUp(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, rgb, fx = 0) {
    this.grow(4, 6);
    const b = this.nv; const P = this.pos; const N = this.nrm; const C = this.col; const F = this.fx; const o = b * 3;
    P[o] = ax; P[o + 1] = ay; P[o + 2] = az; P[o + 3] = bx; P[o + 4] = by; P[o + 5] = bz;
    P[o + 6] = cx; P[o + 7] = cy; P[o + 8] = cz; P[o + 9] = dx; P[o + 10] = dy; P[o + 11] = dz;
    for (let i = 0; i < 4; i++) { const q = o + i * 3; N[q] = 0; N[q + 1] = 1; N[q + 2] = 0; C[q] = rgb[0]; C[q + 1] = rgb[1]; C[q + 2] = rgb[2]; F[b + i] = fx; }
    const I = this.idx; let n = this.ni;
    I[n++] = b; I[n++] = b + 2; I[n++] = b + 1; I[n++] = b; I[n++] = b + 3; I[n++] = b + 2;
    this.ni = n; this.nv += 4;
    return this;
  }
  geometryOut() {
    const THREE = this.THREE; const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, this.nv * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.nv * 3), 3));
    g.setAttribute('fx', new THREE.BufferAttribute(this.fx.slice(0, this.nv), 1));
    const ix = this.nv > 65535 ? this.idx.slice(0, this.ni) : Uint16Array.from(this.idx.subarray(0, this.ni));
    g.setIndex(new THREE.BufferAttribute(ix, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  mesh(material) { const m = new this.THREE.Mesh(this.geometryOut(), material); m.matrixAutoUpdate = false; m.updateMatrix(); return m; }
}

// ── chunk auto-merge ──
/**
 * Merge every toon mesh under `group` (world-space children of an identity group) into one mesh
 * per family (side × transparency), with material colours baked into vertex colours and the fx
 * code per vertex. Non-toon materials, textured materials and big instanced meshes stay as they
 * are. Returns the number of meshes removed.
 */
export function mergeGroup(THREE, group, mats, inkRGB, disposeSet, pre = null) {
  group.updateMatrixWorld(true);
  const fam = new Map();
  const victims = [];
  group.traverse((o) => {
    if (!o.isMesh || o.userData.noMerge || o.isSkinnedMesh) return;
    const m = o.material;
    if (!m || Array.isArray(m) || !m.userData || !m.userData.gtw || m.map || (m.transparent && m.opacity < 1)) return;
    const geo = o.geometry; if (!geo || !geo.getAttribute('position')) return;
    if (o.isInstancedMesh && o.count * geo.getAttribute('position').count > 40000) return;
    if (!o.visible) return;
    const key = m.side === THREE.DoubleSide ? 'double' : 'front';
    let f = fam.get(key); if (!f) { f = []; fam.set(key, f); }
    f.push(o); victims.push(o);
  });
  if (pre && !fam.has('front')) fam.set('front', []);
  if (!fam.size) return { removed: 0, front: null };
  const out = { removed: victims.length, front: null };
  const tmpM = new THREE.Matrix4(); const nm = new THREE.Matrix3();
  for (const [key, list] of fam) {
    const b = key === 'front' && pre ? pre : new Builder(THREE, inkRGB);
    for (const o of list) {
      const m = o.material; const geo = o.geometry; const g = m.userData.gtw;
      const pa = geo.getAttribute('position'); let na = geo.getAttribute('normal');
      if (!na) { geo.computeVertexNormals(); na = geo.getAttribute('normal'); }
      const ca = m.vertexColors ? geo.getAttribute('color') : null; const fa = geo.getAttribute('fx');
      const mc = m.color; const n = pa.count;
      const reps = o.isInstancedMesh ? o.count : 1;
      for (let r = 0; r < reps; r++) {
        tmpM.copy(o.matrixWorld);
        if (o.isInstancedMesh) { const im = new THREE.Matrix4(); o.getMatrixAt(r, im); tmpM.multiply(im); }
        nm.getNormalMatrix(tmpM);
        const e = tmpM.elements; const ne = nm.elements;
        let ic = null;
        if (o.isInstancedMesh && o.instanceColor) { const c = new THREE.Color(); o.getColorAt(r, c); ic = c; }
        const ol = g.outline || 0;
        // write via a template so outlines work
        const t = { n, pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), idx: null, hull: null, box: false };
        const PA = pa.isInterleavedBufferAttribute ? null : pa.array; const NA = na.isInterleavedBufferAttribute ? null : na.array;
        for (let i = 0; i < n; i++) {
          const x = PA ? PA[i * 3] : pa.getX(i); const y = PA ? PA[i * 3 + 1] : pa.getY(i); const z = PA ? PA[i * 3 + 2] : pa.getZ(i);
          t.pos[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; t.pos[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; t.pos[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          const a = NA ? NA[i * 3] : na.getX(i); const bb = NA ? NA[i * 3 + 1] : na.getY(i); const cc = NA ? NA[i * 3 + 2] : na.getZ(i);
          let nx = ne[0] * a + ne[3] * bb + ne[6] * cc; let ny = ne[1] * a + ne[4] * bb + ne[7] * cc; let nz = ne[2] * a + ne[5] * bb + ne[8] * cc;
          const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; t.nrm[i * 3] = nx / l; t.nrm[i * 3 + 1] = ny / l; t.nrm[i * 3 + 2] = nz / l;
        }
        if (geo.index) { t.idx = Uint32Array.from(geo.index.array.subarray(0, geo.index.count)); }
        else { t.idx = new Uint32Array(n); for (let i = 0; i < n; i++) t.idx[i] = i; }
        if (tmpM.determinant() < 0) for (let i = 0; i < t.idx.length; i += 3) { const q = t.idx[i + 1]; t.idx[i + 1] = t.idx[i + 2]; t.idx[i + 2] = q; }
        if (ol > 0) t.hull = hullDirs(t.pos, t.nrm, n, false);
        const base = b.nv;
        b.add(t, 0, 0, 0, 1, 1, 1, 0, [1, 1, 1], ol, g.fx);
        // colours + fx per vertex (the first pass; the hull pass stays ink)
        const CA = ca && !ca.isInterleavedBufferAttribute && ca.itemSize >= 3 ? ca.array : null; const cs = ca ? ca.itemSize : 3;
        for (let i = 0; i < n; i++) {
          let cr = mc ? mc.r : 1; let cg = mc ? mc.g : 1; let cb = mc ? mc.b : 1;
          if (ca) { if (CA) { cr *= CA[i * cs]; cg *= CA[i * cs + 1]; cb *= CA[i * cs + 2]; } else { cr *= ca.getX(i); cg *= ca.getY(i); cb *= ca.getZ(i); } }
          if (ic) { cr *= ic.r; cg *= ic.g; cb *= ic.b; }
          const o3 = (base + i) * 3; b.col[o3] = cr; b.col[o3 + 1] = cg; b.col[o3 + 2] = cb;
          if (fa) b.fx[base + i] = Math.max(g.fx, fa.getX(i));
        }
      }
    }
    if (b.empty) continue;
    const mesh = b.mesh(key === 'double' ? mats.double : mats.vc);
    mesh.name = 'merged-' + key;
    group.add(mesh);
    if (key === 'front') out.front = mesh;
  }
  for (const o of victims) {
    if (o.parent) o.parent.remove(o);
    if (disposeSet) disposeSet.add(o.geometry);
  }
  return out;
}

// ── sky ──
export function makeSky(THREE, top, horizon, sunDir, dark) {
  const g = new THREE.SphereGeometry(1, 24, 12);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color().fromArray(top) }, uHor: { value: new THREE.Color().fromArray(horizon) }, uSun: { value: sunDir.clone() }, uNight: { value: dark ? 1 : 0 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999; }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform float uNight; varying vec3 vD;
      void main(){
        float h = clamp(vD.y, 0.0, 1.0);
        vec3 c = mix(uHor, uTop, smoothstep(0.0, 0.55, h));
        // riso halftone dots that thin out going up
        vec2 g = fract(gl_FragCoord.xy / 5.0) - 0.5;
        float dotR = mix(0.2, 0.02, smoothstep(0.0, 0.35, h));
        c = mix(c, uTop, (1.0 - smoothstep(dotR * dotR * 0.7, dotR * dotR, dot(g, g))) * 0.35 * (1.0 - h));
        float s = dot(normalize(vD), normalize(uSun));
        vec3 sunC = uNight > 0.5 ? vec3(0.95, 0.93, 0.85) : vec3(1.0, 0.86, 0.35);
        if (s > 0.9985) c = sunC; else if (s > 0.998) c = mix(c, vec3(0.1), 0.85);
        else c += sunC * smoothstep(0.985, 0.998, s) * 0.12;
        if (uNight > 0.5) { vec2 st = floor(gl_FragCoord.xy / 3.0); float r = fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453); if (r > 0.9975 && h > 0.15) c = vec3(0.95); }
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return mesh;
}
