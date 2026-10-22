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
// Material ids, ORed onto the fx code (fx = code + 16 * material): the world shader prints the detail
// texture (or a procedural pattern) on the face as ink. Only on flat boxes and quads: the uv is box-projected
// from the face normal when the geometry is written (GeoBuf.add), so it is exact there.
export const M_BRICK = 16;    // brick courses (R)
export const M_PLANK = 32;    // boards (G)
export const M_COBBLE = 48;   // cobbles (B)
export const M_CORR = 64;     // corrugated sheet / bark: vertical ribs (G, transposed)
export const M_GRASS = 80;    // grass hatching (procedural, from the grain)
export const M_RAIL = 96;     // rails: a glint sweeps along them
export const M_WATER = 112;   // water: animated ripples
export const M_GRAVEL = 128;  // ballast / gravel (speckle from the grain, A)
export const M_BLOCK = 144;   // concrete blocks (R, large)
export const M_TILE = 160;    // paving slabs (B, large)
export const M_PLASTER = 176; // stucco mottling (A)
export const M_PANEL = 192;   // panel seams (G, wide, transposed)

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
    // lit windows beside the track: warm white, so the coin / hazard yellow stays the only yellow near the lanes
    warm: mix(mix(hl, [1, 1, 1], 0.78), [1, 0.88, 0.74], 0.35),
    shadeInk,
    tunnel: dark ? mix(bg, [0, 0, 0], 0.3) : mix(bg, ink, 0.55),
    portal: dark ? mix(card, ink, 0.22) : mix(card, ink, 0.34), // concrete, banded in hazard yellow
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
  P.skyFast = dark ? [mix(bg, b, 0.2), mix(mix(bg, a, 0.14), [0, 0, 0], 0.3)] : [mix(bg, hl, 0.2), mix(mix(bg, b, 0.22), a, 0.06)];
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
    // split toning: the key light's colour and the shadow band's tint (both luminance ~1), per district
    uKey: { value: new THREE.Color(1, 1, 1) },
    uShd: { value: new THREE.Color(1, 1, 1) },
    // ambient occlusion on walls: ground y, strength, height of the gradient
    uAo: { value: new THREE.Vector4(-4, 0.3, 9, 0) },
    // time: x glint phase 0..1, y seconds (water), z glint strength
    uTm: { value: new THREE.Vector4(0, 0, P.dark ? 0.85 : 0.55, 0) },
    uDot: { value: 4 },
    uDetail: { value: makeDetailTexture(THREE) },
  };
}
export function applyPaletteUniforms(U, P) {
  U.uNight.value = P.dark ? 1 : 0;
  U.uGlass.value.fromArray(P.glass); U.uLit.value.fromArray(P.lit); U.uInk.value.fromArray(P.outline);
  U.uPaper.value.fromArray(P.white); U.uSleeper.value.fromArray(P.sleeper);
  U.uTm.value.z = P.dark ? 0.85 : 0.55;
}

// ── detail texture: ONE 256x256 RGBA tile, four grayscale patterns (1 = bare paper, 0 = full ink) ──
//   R brick courses (running bond, per-brick tone)   G boards with butt joints and a rounded profile
//   B cobbles (staggered rounded stones)             A paper grain: fibres + speckle
// Built once at load into a DataTexture (no canvas: premultiplied alpha would corrupt the channels), tileable by
// construction (periodic grids and periodic noise). The shader uses the channel as ink darkening.
export function makeDetailTexture(THREE) {
  const N = 256;
  const d = new Uint8Array(N * N * 4);
  const hs = (x, y, s) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const sm = (t) => t * t * (3 - 2 * t);
  // periodic value noise: lattice of px x py cells over the tile
  const vn = (x, y, px, py, s) => {
    const fx = x * px / N; const fy = y * py / N;
    const x0 = Math.floor(fx); const y0 = Math.floor(fy);
    const tx = sm(fx - x0); const ty = sm(fy - y0);
    const a = hs(x0 % px, y0 % py, s); const b = hs((x0 + 1) % px, y0 % py, s);
    const c = hs(x0 % px, (y0 + 1) % py, s); const e = hs((x0 + 1) % px, (y0 + 1) % py, s);
    return (a + (b - a) * tx) + ((c + (e - c) * tx) - (a + (b - a) * tx)) * ty;
  };
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4;
      // R: brick (rows 16 px, bricks 32 px, running bond)
      const row = y >> 4; const yy = y & 15;
      const xs = (x + ((row & 1) << 4)) & 255; const xx = xs & 31; const bc = xs >> 5;
      let r;
      if (yy < 2 || xx < 2) r = 0.04 * hs(x, y, 1);
      else {
        r = 0.7 + 0.3 * hs(bc, row, 2) + (hs(x, y, 3) - 0.5) * 0.12 + (vn(x, y, 16, 16, 4) - 0.5) * 0.16;
        if (yy === 2 || xx === 2) r *= 0.9;
      }
      d[o] = clamp01(r) * 255;
      // G: boards (32 px), butt joints, rounded profile, long grain streaks
      const bi = y >> 5; const by = y & 31;
      const jx = Math.floor(hs(bi, 0, 5) * 256);
      let g;
      if (by < 2 || ((x - jx) & 255) < 2 || ((x - jx - 128) & 255) < 2) g = 0.03;
      else {
        const prof = Math.sqrt(Math.sin(Math.PI * (by - 1.5) / 30));
        g = 0.68 + 0.17 * prof + 0.15 * vn(x, y, 8, 128, 6) + (hs(x, y, 7) - 0.5) * 0.06;
      }
      d[o + 1] = clamp01(g) * 255;
      // B: cobbles (cells 32 px, alternate rows shifted half a cell, jittered rounded stones with a gap)
      const cr = y >> 5; const cxs = (x + ((cr & 1) << 4)) & 255; const cc = cxs >> 5;
      const dx = (cxs & 31) - 16 - (hs(cc, cr, 8) - 0.5) * 3; const dy = (y & 31) - 16 - (hs(cc, cr, 9) - 0.5) * 3;
      const rx = 12 + hs(cc, cr, 10) * 2; const ry = 11.5 + hs(cc, cr, 11) * 2;
      const ax = Math.abs(dx) / rx; const ay = Math.abs(dy) / ry;
      const dd = ax * ax * ax + ay * ay * ay;
      let b;
      if (dd >= 1) b = 0.03;
      else b = (0.66 + 0.34 * hs(cc, cr, 12)) * (0.8 + 0.2 * (1 - Math.sqrt(dd))) + (hs(x, y, 13) - 0.5) * 0.08;
      d[o + 2] = clamp01(b) * 255;
      // A: paper grain: speckle + soft blotches (fibres added below)
      const a = 0.5 + (hs(x, y, 14) - 0.5) * 0.5 + (vn(x, y, 32, 32, 15) - 0.5) * 0.36 + (vn(x, y, 8, 8, 16) - 0.5) * 0.2;
      d[o + 3] = clamp01(a) * 255;
    }
  }
  // fibres: short strokes at random angles, wrapping round the tile
  for (let k = 0; k < 700; k++) {
    let fx = hs(k, 0, 17) * N; let fy = hs(k, 1, 17) * N;
    const ang = hs(k, 2, 17) * 6.2832; const len = 5 + hs(k, 3, 17) * 9; const dv = (hs(k, 4, 17) - 0.5) * 70;
    const cx = Math.cos(ang); const cy = Math.sin(ang);
    for (let i = 0; i < len; i++) {
      const px = ((Math.floor(fx) % N) + N) % N; const py = ((Math.floor(fy) % N) + N) % N;
      const o = (py * N + px) * 4 + 3;
      d[o] = Math.max(0, Math.min(255, d[o] + dv));
      fx += cx; fy += cy;
    }
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.flipY = false;
  t.needsUpdate = true;
  return t;
}

// The world material is MeshBasicMaterial (no per-light loops) with a tiny hook: the toon band is
// computed per vertex from one sun direction + sky term (exact on flat faces, soft on round ones), tinted
// by a key colour (lit) and a shadow tint (split toning, both per district); ink hulls / glow / sky are
// unlit, the shadow band gets a screen-space halftone, and the skyline is only partly fogged. Patterns
// (windows, sleepers, stripes) are geometry; the surface print (brick, boards, cobbles, hatching, paper
// grain) is ONE texture fetch of the detail tile plus a few ALU in the fragment shader, and the wall
// ambient occlusion is one smoothstep of the world y.
const VERT_PRE = `#include <common>
attribute float fx;
attribute vec2 tuv;
uniform vec3 uSun;
uniform vec4 uLk;
uniform vec3 uKey;
uniform vec3 uShd;
uniform float uNight;
varying float vFx;
varying vec3 vShade;
varying vec4 vTx;
#ifdef RR_RIM
varying float vRim;
#endif
#ifdef RR_NEAR
varying float vViewZ;
#endif`;
const VERT_POST = `#include <fog_vertex>
#ifdef RR_NEAR
vViewZ = - mvPosition.z;
#endif
float rrM = floor( fx * 0.0625 + 0.001 );
float rrF = fx - rrM * 16.0;
float rrWy = 1000.0;
vFx = rrF;
#ifdef RR_RIM
vRim = 0.0;
#endif
if ( rrF > 0.5 && rrF < 1.5 || rrF > 3.5 && rrF < 4.5 ) vShade = vec3( 1.0 );
else if ( rrF > 2.5 && rrF < 3.5 ) vShade = vec3( 1.06 + 0.14 * uNight );
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
  vShade = uShd * ( uLk.x + uLk.y * ( 0.5 + 0.5 * rrN.y ) ) + uKey * ( uLk.z * band );
  #if !defined( USE_INSTANCING ) && !defined( USE_SKINNING )
    if ( abs( rrN.y ) < 0.5 ) rrWy = position.y;
  #endif
  #ifdef RR_RIM
    vRim = pow( 1.0 - clamp( dot( normalize( ( viewMatrix * vec4( rrN, 0.0 ) ).xyz ), normalize( - mvPosition.xyz ) ), 0.0, 1.0 ), 2.2 );
  #endif
}
vTx = vec4( tuv, rrM, rrWy );`;
const FRAG_PRE = `#include <common>
uniform vec4 uLk;
uniform float uDot;
uniform float uNight;
uniform vec3 uInk;
uniform vec3 uPaper;
uniform vec4 uAo;
uniform vec4 uTm;
uniform sampler2D uDetail;
#ifdef RR_FADE
uniform float uFade;
#endif
#ifdef RR_RIM
uniform vec4 uRim;
varying float vRim;
#endif
#ifdef RR_NEAR
varying float vViewZ;
#endif
varying float vFx;
varying vec3 vShade;
varying vec4 vTx;`;
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
#ifdef RR_NEAR
// barriers you've already passed dissolve as they swing past the camera
if ( vViewZ < 6.2 ) {
  vec2 q = fract( gl_FragCoord.xy * 0.25 ) - 0.5;
  if ( dot( q, q ) * 4.0 < ( 6.2 - vViewZ ) * 0.55 ) discard;
}
#endif
diffuseColor.rgb *= vShade;
if ( vShade.g < uLk.w && vFx < 0.5 ) {
  vec2 g = fract( gl_FragCoord.xy / uDot ) - 0.5;
  diffuseColor.rgb *= 1.0 - ( 1.0 - smoothstep( 0.0324, 0.09, dot( g, g ) ) ) * 0.17;
}
#ifdef RR_RIM
// rim light in the runner's colour: readable against busy backgrounds
diffuseColor.rgb = mix( diffuseColor.rgb, uRim.rgb, vRim * uRim.a );
#else
vec4 rrT = texture2D( uDetail, vTx.xy );
if ( vFx < 0.5 || ( vFx > 4.5 && vFx < 8.5 ) ) {
  vec3 c = diffuseColor.rgb;
  float m = vTx.z;
  float p = 1.0; float k = 0.0;
  if ( m > 0.5 ) {
    if ( m < 1.5 ) { p = rrT.r; k = 0.36; }
    else if ( m < 2.5 ) { p = rrT.g; k = 0.3; }
    else if ( m < 3.5 ) { p = rrT.b; k = 0.3; }
    else if ( m < 4.5 ) { p = rrT.g; k = 0.34; }
    else if ( m < 5.5 ) { p = 1.0 - step( 0.8, fract( ( vTx.x + vTx.y * 0.6 ) * 9.0 + rrT.a * 1.4 ) ); k = 0.22 * ( 1.0 - smoothstep( 30.0, 75.0, fogDepth ) ); }
    else if ( m < 6.5 ) {
      // rails: a glint sweeps along them, front slanted across the lanes
      float s = fract( vTx.x - uTm.x );
      c += uPaper * ( smoothstep( 0.0, 0.003, s ) * ( 1.0 - smoothstep( 0.005, 0.024, s ) ) * uTm.z * ( 1.0 - smoothstep( 40.0, 100.0, fogDepth ) ) );
    } else if ( m < 7.5 ) {
      // water: two crossing sets of thin ripples drifting with time, fading out with distance
      float w1 = sin( vTx.x * 38.0 + sin( vTx.y * 9.0 + uTm.y * 0.8 ) * 1.7 - uTm.y * 1.5 );
      float w2 = sin( vTx.y * 31.0 + sin( vTx.x * 7.0 - uTm.y * 0.6 ) * 1.4 + uTm.y * 1.2 );
      float rp = max( smoothstep( 0.86, 0.97, w1 ), smoothstep( 0.9, 0.98, w2 ) );
      c = mix( c, uPaper, rp * ( 0.55 - 0.2 * uNight ) * ( 1.0 - smoothstep( 35.0, 90.0, fogDepth ) ) );
    }
    else if ( m < 8.5 ) { p = smoothstep( 0.3, 0.7, rrT.a ); k = 0.17; }
    else if ( m < 9.5 ) { p = rrT.r; k = 0.3; }
    else if ( m < 10.5 ) { p = rrT.b; k = 0.28; }
    else if ( m < 11.5 ) { p = smoothstep( 0.2, 0.8, rrT.a ); k = 0.11; }
    else { p = rrT.g; k = 0.42; }
  }
  c = mix( c, uInk, ( 1.0 - p ) * k );
  c *= 1.0 + ( rrT.a - 0.5 ) * 0.15;
  c *= 1.0 - uAo.y * ( 1.0 - smoothstep( 0.0, uAo.z, vTx.w - uAo.x ) );
  diffuseColor.rgb = c;
}
#endif`;
const FRAG_END = `if ( vFx > 3.5 && vFx < 4.5 ) {
  gl_FragColor.rgb = mix( vColor, fogColor, 0.3 );
} else {
  #include <fog_fragment>
}`;

/** The shared world material. One instance for the world (+ instanced variants), one skinned per runner. */
export function makeToon(THREE, grad, U, { skinning = false, extra = null } = {}) {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, skinning });
  // (three r128 only defines USE_SKINNING for vertex shaders, so the fade and the rim get their own defines)
  const defs = {};
  if (extra && extra.uFade) defs.RR_FADE = '';
  if (extra && extra.uRim) defs.RR_RIM = '';
  if (extra && extra.near) defs.RR_NEAR = '';
  if (Object.keys(defs).length) m.defines = defs;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    if (extra && extra.uFade) sh.uniforms.uFade = extra.uFade;
    if (extra && extra.uRim) sh.uniforms.uRim = extra.uRim;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_PRE).replace('#include <fog_vertex>', VERT_POST);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', FRAG_PRE)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <fog_fragment>', FRAG_END);
  };
  m.customProgramCacheKey = () => 'rush-toon-v5';
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

/** Gable roof: two sloped quads (no caps, no floor), ridge along local z, eaves at y = -0.5, ridge at +0.5. */
function gableRoof(THREE) {
  const g = new THREE.BufferGeometry();
  const k = 0.8944272; const q = 0.4472136;
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, -0.5,
    0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([-k, q, 0, -k, q, 0, -k, q, 0, -k, q, 0, k, q, 0, k, q, 0, k, q, 0, k, q, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}
/** Flat triangle facing +z: apex up (up = true: gable ends) or apex down (bunting pennants). */
function triangle(THREE, up) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(up ? [-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0] : [-0.5, 0.5, 0, 0, -0.5, 0, 0.5, 0.5, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setIndex([0, 1, 2]);
  return g;
}

/** Several indexed geometries as one (positions, normals, indices concatenated). */
function mergeGeos(THREE, geos) {
  const pos = []; const nrm = []; const idx = [];
  for (const g of geos) {
    const base = pos.length / 3;
    pos.push(...g.getAttribute('position').array); nrm.push(...g.getAttribute('normal').array);
    for (const i of g.index.array) idx.push(base + i);
    g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  m.setIndex(idx);
  return m;
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
    fan: tpl(new THREE.CircleGeometry(0.5, 16).rotateX(-Math.PI / 2), 'box'), // flat disc facing up (light pools)
    roof: tpl(gableRoof(THREE), 'box'),
    tri: tpl(triangle(THREE, true), 'box'),
    pen: tpl(triangle(THREE, false), 'box'),
    stripe: tpl(parallelogram(THREE), 'box'),
    stripeL: tpl(parallelogram(THREE, true), 'box'),
    discZ: tpl(new THREE.CylinderGeometry(0.5, 0.5, 1, 28, 1).rotateX(Math.PI / 2), 'smooth'),
    // axis along x (a barrel lying on its side), and three narrow axial strips around it (staves: they make the roll readable)
    discX: tpl(new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1).rotateZ(Math.PI / 2), 'smooth'),
    staves: tpl(mergeGeos(THREE, [0, 1, 2].map((k) => new THREE.CylinderGeometry(0.5, 0.5, 1, 2, 1, true, k * 2.0944, 0.5).rotateZ(Math.PI / 2))), 'smooth'),
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
// Detail-texture repeats per metre by material id (fx >> 4), and how the uv is made: 0 box-projected, 1 box-projected
// with u and v swapped (ribs run vertically), 2 along the track (rails: u = distance + a slant across the lanes).
const MAT_SCALE = new Float32Array(16);
const MAT_SPECIAL = new Uint8Array(16);
MAT_SCALE[0] = 0.5;            // paper grain
MAT_SCALE[1] = 1 / 3.2;        // brick: 0.4 x 0.2 m bricks
MAT_SCALE[2] = 1 / 2.56;       // boards 0.32 m
MAT_SCALE[3] = 1 / 3.2;        // cobbles 0.4 m
MAT_SCALE[4] = 1 / 1.6; MAT_SPECIAL[4] = 1; // corrugation: ribs 0.2 m
MAT_SCALE[5] = 0.5;            // grass hatching
MAT_SCALE[6] = 1 / 40; MAT_SPECIAL[6] = 2;  // rail glint period 40 m
MAT_SCALE[7] = 1 / 8;          // water
MAT_SCALE[8] = 1 / 0.64;       // gravel: fine speckle from the grain
MAT_SCALE[9] = 1 / 9.6;        // concrete blocks 1.2 x 0.6 m
MAT_SCALE[10] = 1 / 6.4;       // paving slabs 0.8 m
MAT_SCALE[11] = 1 / 3.2;       // stucco
MAT_SCALE[12] = 1 / 5.12; MAT_SPECIAL[12] = 1; // panel seams every 0.64 m

/** Preallocated vertex buffers you can fill with transformed templates and reuse. */
export class GeoBuf {
  constructor(THREE, maxV, { skin = false, dynamic = true } = {}) {
    this.maxV = maxV;
    this.maxI = maxV * 2;
    this.pos = new Float32Array(maxV * 3);
    this.nrm = new Float32Array(maxV * 3);
    this.col = new Float32Array(maxV * 3);
    this.fx = new Float32Array(maxV);
    this.uv = new Float32Array(maxV * 2); // detail-texture uv per vertex (see add)
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
    g.setAttribute('tuv', new THREE.BufferAttribute(this.uv, 2).setUsage(use));
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
    // detail uv: material m = fx >> 4. Flat materials project the face along its dominant normal axis
    // (top: x,z · x-facing: z,y · z-facing: x,y); no material = a skewed world projection for the paper grain.
    // Subtracting a whole number of tiles taken at the primitive's centre keeps uv small (no precision loss far
    // down the track) without changing the phase, so neighbouring primitives still line up.
    const mm = (fx / 16) | 0;
    const sc = MAT_SCALE[mm]; const sp = MAT_SPECIAL[mm];
    const UV = this.uv;
    let ucn = 0; let vcn = 0;
    if (mm === 0) { ucn = Math.floor((tx + 0.37 * ty) * sc); vcn = Math.floor((tz + 0.61 * ty) * sc); }
    else if (sp === 2) { ucn = Math.floor((-tz + 1.7 * tx) * sc); vcn = 0; }
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
        {
          const wx = P[o]; const wy = P[o + 1]; const wz = P[o + 2];
          let u; let v;
          if (mm === 0) { u = (wx + 0.37 * wy) * sc - ucn; v = (wz + 0.61 * wy) * sc - vcn; }
          else if (sp === 2) { u = (-wz + 1.7 * wx) * sc - ucn; v = 0; }
          else {
            const ax = Math.abs(N[o]); const ay = Math.abs(N[o + 1]); const az = Math.abs(N[o + 2]);
            let cu; let cv;
            if (ay >= ax && ay >= az) { u = wx; v = wz; cu = tx; cv = tz; }
            else if (ax >= az) { u = wz; v = wy; cu = tz; cv = ty; }
            else { u = wx; v = wy; cu = tx; cv = ty; }
            if (sp === 1) { const q = u; u = v; v = q; const r = cu; cu = cv; cv = r; }
            u = u * sc - Math.floor(cu * sc); v = v * sc - Math.floor(cv * sc);
          }
          UV[(base + i) * 2] = u; UV[(base + i) * 2 + 1] = v;
        }
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
    for (const k of ['position', 'normal', 'color', 'fx', 'tuv']) {
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
    g.setAttribute('tuv', new THREE.BufferAttribute(this.uv.slice(0, this.nv * 2), 2));
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
