// Getaway graphics core: theme palette, the ONE shader family every opaque surface uses (a
// MeshBasicMaterial patched in onBeforeCompile), a geometry Builder that merges primitives with
// ink outlines baked in as inverted hulls, the chunk auto-merger (every toon mesh in a chunk →
// one draw call per material family, material colours baked into vertex colours) and the sky.
//
// The shader ("toon" for historical reasons; v2 is stylised-realistic): sun + hemisphere light per
// vertex (soft bands), and per pixel: the car shadow map (mid/high tier), the cop's siren, two
// headlight spots, eight street-lamp pools at night, a sky reflection for paint / glass / chrome
// / water, procedural surface detail picked by a per-vertex `fx` code (windows by building type,
// asphalt with lane wear, brick, stucco, roof tiles, shingles, concrete, grass, dirt, metal, wood,
// rock, foliage), car dirt and scratches, emissive lenses, and height + sun-tinted fog.
// No textures are needed for any of it. Codes are listed in FX below and in docs/games/getaway-maps.md.

export const FX_PLAIN = 0;
export const FX_INK = 1;
export const FX_WINDOWS = 2;
export const FX_GLOW = 3;
export const FX_FAR = 4; // unlit, slightly fogged (backdrop)
export const FX_ROAD = 5;
export const FX_PAINT = 6;
export const FX_GLASS = 7;
export const FX_CHROME = 8;
export const FX_TRIM = 9;
export const FX_SIREN_R = 20;
export const FX_SIREN_B = 21;
export const FX_TAIL = 22;
export const FX_REVERSE = 23;
/** Every fx code by name (kit.FX). Codes ≥ 5 are new in v2; older maps only use 0–4. */
export const FX = {
  plain: 0, ink: 1, windows: 2, office: 2, glow: 3, far: 4, road: 5, paint: 6, glass: 7, chrome: 8, trim: 9,
  house: 10, shop: 11, tower: 12, brick: 13, stucco: 14, tile: 15, shingle: 16, concrete: 17, grass: 18, dirt: 19, sand: 19,
  sirenR: 20, sirenB: 21, tail: 22, reverse: 23, water: 24, metal: 25, wood: 26, rock: 27, foliage: 28, lot: 29,
};

// quality tier ('low' | 'mid' | 'high'): set by render.js before any material is made
let TIER = 'high';
export function setGfxTier(t) { TIER = t === 'low' || t === 'mid' ? t : 'high'; }
export function gfxTier() { return TIER; }

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
    outline: dark ? [0.05, 0.05, 0.07] : mix(ink, [0.2, 0.2, 0.24], 0.35),
    asphalt: dark ? [0.19, 0.19, 0.22] : [0.33, 0.33, 0.35],
    asphaltHi: dark ? [0.23, 0.23, 0.26] : [0.4, 0.4, 0.42],
    gutter: dark ? [0.16, 0.16, 0.18] : [0.28, 0.28, 0.3],
    dirtRoad: dark ? [0.34, 0.29, 0.23] : [0.64, 0.55, 0.42],
    curb: dark ? [0.46, 0.46, 0.48] : [0.8, 0.79, 0.76],
    sidewalk: dark ? [0.4, 0.4, 0.42] : [0.76, 0.75, 0.72],
    lineW: dark ? [0.82, 0.8, 0.76] : [0.94, 0.93, 0.9],
    lineY: dark ? [0.8, 0.62, 0.2] : [0.96, 0.76, 0.22],
    glass: dark ? [0.08, 0.1, 0.16] : [0.2, 0.26, 0.36],
    lit: mix(hl, [1, 1, 1], 0.2),
    grass: dark ? [0.2, 0.3, 0.22] : [0.5, 0.66, 0.38],
    white: [0.97, 0.97, 0.95],
    copBody: dark ? [0.08, 0.08, 0.1] : [0.09, 0.09, 0.11],
    copDoor: [0.95, 0.95, 0.94],
    red: [0.95, 0.15, 0.2], blue: [0.15, 0.4, 1.0],
    traffic: [[0.72, 0.16, 0.14], [0.93, 0.93, 0.92], [0.12, 0.13, 0.15], [0.55, 0.57, 0.6], [0.18, 0.28, 0.5], [0.78, 0.76, 0.72], [0.3, 0.42, 0.34], [0.86, 0.62, 0.24], [0.4, 0.42, 0.46], [0.62, 0.12, 0.2], [0.24, 0.5, 0.66], [0.9, 0.88, 0.82]],
  };
}

// ── shader ──
export function makeUniforms(THREE, P) {
  const v4 = () => new THREE.Vector4(0, -999, 0, 0);
  return {
    uNight: { value: P.dark ? 1 : 0 },
    uGlass: { value: new THREE.Color().fromArray(P.glass) },
    uLit: { value: new THREE.Color().fromArray(P.lit) },
    uSun: { value: new THREE.Vector3(-0.42, 0.8, 0.43).normalize() },
    uSunCol: { value: new THREE.Color(P.dark ? 0.55 : 1.0, P.dark ? 0.62 : 0.93, P.dark ? 0.8 : 0.8) },
    uLk: { value: new THREE.Vector4(P.dark ? 0.36 : 0.5, P.dark ? 0.2 : 0.22, P.dark ? 0.24 : 0.4, P.dark ? 0.62 : 0.86) },
    uDot: { value: 4 },
    uSiren: { value: new THREE.Vector4(0, -999, 0, 0) },   // xyz = lightbar, w = strength
    uSirenCol: { value: new THREE.Color(1, 0.1, 0.1) },
    uHead: { value: new THREE.Vector4(0, -999, 0, 0) },    // legacy (game.js sets it; the spots below light the scene)
    uHeadDir: { value: new THREE.Vector3(0, 0, -1) },
    uSpotP: { value: [v4(), v4()] },                        // headlight spots: xyz, strength
    uSpotD: { value: [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1)] },
    uLamp: { value: [v4(), v4(), v4(), v4(), v4(), v4(), v4(), v4()] }, // street-lamp pools (night): xyz, strength
    uLampCol: { value: new THREE.Color(1, 0.72, 0.4) },
    uSkyTop: { value: new THREE.Color(0.45, 0.65, 0.9) },
    uSkyHor: { value: new THREE.Color(0.85, 0.85, 0.85) },
    uGroundC: { value: new THREE.Color(P.dark ? 0.04 : 0.24, P.dark ? 0.04 : 0.23, P.dark ? 0.05 : 0.22) },
    uFogSun: { value: new THREE.Color(1, 0.9, 0.75) },
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },                   // camera position (MeshBasic doesn't get cameraPosition)
    uShadowMap: { value: null },
    uShadowM: { value: new THREE.Matrix4() },
    uShadowP: { value: new THREE.Vector4(0, 1 / 1024, 0.8, 0) }, // on, texel, strength, -
  };
}

const VERT_PRE = `#include <common>
attribute float fx;
attribute float aux;
uniform vec3 uSun;
uniform vec4 uLk;
uniform float uNight;
uniform float uFxm;
varying float vFx;
varying float vShade;
varying float vSunK;
varying float vAux;
varying vec3 vWPos;
varying vec3 vWN;
varying vec3 vLPos;`;
// instance colours tint paint and plain parts only (glass, chrome, trim, lights keep their colour)
const VERT_COLOR = `#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	{ float fq = fx + uFxm; if ( !( ( fq > 2.5 && fq < 3.5 ) || ( fq > 6.5 && fq < 9.5 ) || ( fq > 19.5 && fq < 23.5 ) ) ) vColor.xyz *= instanceColor.xyz; }
#endif`;
const VERT_POST = `#include <fog_vertex>
vFx = fx + uFxm;
vAux = aux;
vLPos = transformed;
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
vWPos = gW.xyz; vWN = gN;
vSunK = 0.0;
float gCode = floor( vFx + 0.5 );
if ( gCode == 1.0 || gCode == 4.0 || ( gCode > 19.5 && gCode < 23.5 ) ) vShade = 1.0;
else if ( gCode == 3.0 ) vShade = 1.05 + 0.15 * uNight;
else {
  float ndl = dot( gN, uSun );
  vSunK = uLk.z * ( 0.22 + 0.78 * smoothstep( -0.25, 0.6, ndl ) );
  vShade = uLk.x + uLk.y * ( 0.5 + 0.5 * gN.y ) + vSunK;
}`;
const FRAG_PRE = `#include <common>
uniform vec4 uLk;
uniform float uDot;
uniform float uNight;
uniform vec3 uGlass;
uniform vec3 uLit;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec4 uSiren;
uniform vec3 uSirenCol;
uniform vec4 uSpotP[ 2 ];
uniform vec3 uSpotD[ 2 ];
uniform vec4 uLamp[ 8 ];
uniform vec3 uLampCol;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform vec3 uGroundC;
uniform vec3 uFogSun;
uniform float uTime;
uniform vec3 uCam;
uniform vec4 uCar;
uniform vec2 uFlash;
varying float vFx;
varying float vShade;
varying float vSunK;
varying float vAux;
varying vec3 vWPos;
varying vec3 vWN;
varying vec3 vLPos;
#ifdef GTW_SHADOW
uniform sampler2D uShadowMap;
uniform mat4 uShadowM;
uniform vec4 uShadowP;
float gUnpack( vec4 v ) { return dot( v, vec4( 255.0 / 256.0 / 16777216.0, 255.0 / 256.0 / 65536.0, 255.0 / 256.0 / 256.0, 255.0 / 256.0 ) ); }
float gShadow( vec3 wp, vec3 n ) {
  vec4 sc = uShadowM * vec4( wp + n * 0.07, 1.0 );
  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
  if ( p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0 ) return 1.0;
  float z = p.z - 0.001;
  // 4 taps on a per-pixel rotated square (rotated-grid PCF: soft edges without stair steps)
  float r = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2831;
  vec2 o1 = vec2( cos( r ), sin( r ) ) * uShadowP.y * 1.6; vec2 o2 = vec2( -o1.y, o1.x );
  float s = step( z, gUnpack( texture2D( uShadowMap, p.xy + o1 ) ) );
  s += step( z, gUnpack( texture2D( uShadowMap, p.xy - o1 ) ) );
  s += step( z, gUnpack( texture2D( uShadowMap, p.xy + o2 * 0.5 ) ) );
  s += step( z, gUnpack( texture2D( uShadowMap, p.xy - o2 * 0.5 ) ) );
  vec2 e = abs( p.xy - 0.5 ) * 2.0;
  return mix( s * 0.25, 1.0, smoothstep( 0.75, 0.98, max( e.x, e.y ) ) );
}
#endif
float gHash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float gNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gHash( i ), gHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( gHash( i + vec2( 0.0, 1.0 ) ), gHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
vec3 gEnv( vec3 R ) {
  if ( R.y >= 0.0 ) return mix( uSkyHor, uSkyTop, smoothstep( 0.0, 0.6, R.y ) ) * ( 1.0 + 0.6 * pow( max( dot( R, uSun ), 0.0 ), 6.0 ) * ( 1.0 - uNight ) );
  return mix( uSkyHor * 0.6, uGroundC, smoothstep( 0.0, -0.22, R.y ) );
}
vec3 gWindows( vec3 c, float kind, vec3 N, vec3 V, float dist, inout float emis ) {
  if ( abs( N.y ) > 0.5 ) return c;
  vec2 hz = normalize( vec2( -N.z, N.x ) );
  float u = dot( vWPos.xz, hz );
  vec2 cs = vec2( 3.1, 3.3 ); vec4 fr = vec4( 0.2, 0.8, 0.3, 0.82 ); float y0 = 0.9;
  if ( kind == 10.0 ) { cs = vec2( 4.4, 3.0 ); fr = vec4( 0.3, 0.7, 0.3, 0.76 ); y0 = 0.25; }
  else if ( kind == 11.0 ) { cs = vec2( 2.8, 3.9 ); fr = vec4( 0.07, 0.93, 0.08, 0.88 ); y0 = 0.15; }
  else if ( kind == 12.0 ) { cs = vec2( 1.55, 3.6 ); fr = vec4( 0.05, 0.95, 0.08, 0.95 ); y0 = 0.4; }
  vec2 cell = vec2( u / cs.x, ( vWPos.y - y0 ) / cs.y );
  vec2 g = fract( cell ); vec2 id = floor( cell );
  float above = step( 0.0, cell.y );
  float win = step( fr.x, g.x ) * step( g.x, fr.y ) * step( fr.z, g.y ) * step( g.y, fr.w ) * above;
  float frame = step( fr.x - 0.045, g.x ) * step( g.x, fr.y + 0.045 ) * step( fr.z - 0.07, g.y ) * step( g.y, fr.w + 0.035 ) * above * ( 1.0 - win );
  float h = gHash( id + floor( vWPos.xz * 0.013 ) * 7.31 );
  float far = smoothstep( 110.0, 300.0, dist );
  vec3 glass = uGlass * ( 0.78 + 0.4 * h );
#ifndef GTW_LOW
  vec3 R = reflect( V, vec3( N.x, 0.0, N.z ) );
  glass = mix( glass, gEnv( R ), ( 0.3 + 0.25 * h ) * ( 1.0 - 0.7 * uNight ) );
  glass *= 0.9 + 0.2 * smoothstep( 0.2, 1.0, g.y );
#endif
  bool lit = uNight > 0.5 && h > 0.5;
  vec3 wc = glass;
  if ( lit ) {
    vec3 lc = h > 0.86 ? vec3( 0.72, 0.84, 1.0 ) : ( h > 0.66 ? vec3( 1.0, 0.84, 0.56 ) : vec3( 1.0, 0.72, 0.4 ) );
    float curtain = fract( h * 13.7 ) > 0.55 ? 0.62 + 0.38 * step( 0.5, fract( g.x * 5.0 + 0.25 ) ) : 1.0;
    wc = uLit * 0.25 + lc * curtain * ( 0.8 + 0.3 * g.y );
    emis = win * ( 1.0 - far * 0.4 );
  }
  vec3 o = mix( c, c * 0.62, frame * 0.7 );
  o = mix( o, wc, win );
  float area = ( fr.y - fr.x ) * ( fr.w - fr.z );
  return mix( o, mix( c, uNight > 0.5 ? mix( glass, uLit, 0.35 ) : glass, area * 0.55 ), far * ( 1.0 - emis ) );
}
vec3 gRoad( vec3 c, float lane, float dist ) {
  float far = smoothstep( 40.0, 180.0, dist );
  float n1 = gNoise( vWPos.xz * 0.31 ); float n3 = gNoise( vWPos.xz * 0.043 );
  float n2 = far < 0.99 ? gNoise( vWPos.xz * 2.1 ) : 0.5;
  c *= 0.95 + 0.07 * n1 + 0.09 * ( n2 - 0.5 ) * ( 1.0 - far ) + 0.09 * ( n3 - 0.5 );
  if ( lane != 0.0 ) {
    float lf = fract( abs( lane ) );
    float a = ( lf - 0.27 ) * 8.0; float b = ( lf - 0.73 ) * 8.0; float o = ( lf - 0.5 ) * 6.0;
    float tr = 1.0 / ( 1.0 + a * a * a * a ) + 1.0 / ( 1.0 + b * b * b * b );
    c *= 1.0 + 0.05 * tr - 0.09 * ( 0.5 + 0.5 * n1 ) / ( 1.0 + o * o * o * o );
  }
  vec2 pq = vWPos.xz / 7.0; float ph = gHash( floor( pq ) );
  if ( ph > 0.93 ) { vec2 f = fract( pq ); c *= 1.0 - 0.07 * step( 0.12, f.x ) * step( f.x, 0.8 ) * step( 0.1, f.y ) * step( f.y, 0.7 ); }
  return c;
}
vec3 gMaterial( vec3 c, float k, vec3 N, vec3 V, float dist, inout vec3 add ) {
  float far = smoothstep( 30.0, 150.0, dist );
  bool wall = abs( N.y ) < 0.6;
  vec2 e = normalize( vec2( -N.z, N.x ) + vec2( 1e-4, 0.0 ) );
  float u = wall ? dot( vWPos.xz, e ) : vWPos.x;
  float v = wall ? vWPos.y : vWPos.z;
  if ( k == 13.0 ) {
    vec2 q = vec2( u / 0.62, v / 0.26 ); q.x += 0.5 * mod( floor( q.y ), 2.0 );
    vec2 f = fract( q ); float m = max( step( f.x, 0.06 ), step( f.y, 0.11 ) );
    vec3 b = c * ( 0.86 + 0.24 * gHash( floor( q ) ) );
    b = mix( b, mix( c, vec3( 0.84, 0.82, 0.77 ), 0.5 ), m * 0.7 );
    return mix( b, c, far );
  }
  if ( k == 14.0 ) {
    float n = gNoise( vec2( u, v ) * 1.1 ) * 0.6 + gNoise( vec2( u, v ) * 4.7 ) * 0.4 * ( 1.0 - far );
    return c * ( 0.95 + 0.1 * n );
  }
  if ( k == 15.0 || k == 16.0 ) {
    float ue = dot( vWPos.xz, e );
    if ( k == 15.0 ) {
      float row = fract( vWPos.y / 0.3 ); float barrel = 0.5 + 0.5 * cos( ue * 19.6 );
      vec3 t = c * ( 0.8 + 0.22 * barrel + 0.1 * gHash( floor( vec2( ue / 0.32, vWPos.y / 0.3 ) ) ) ) * ( 1.0 - 0.2 * smoothstep( 0.78, 1.0, row ) );
      return mix( t, c * 0.95, far );
    }
    float ry = vWPos.y / 0.22; float row = floor( ry ); float tab = floor( ue / 0.45 + 0.5 * mod( row, 2.0 ) );
    vec3 t = c * ( 0.82 + 0.26 * gHash( vec2( tab, row ) ) ) * ( 1.0 - 0.22 * smoothstep( 0.8, 1.0, fract( ry ) ) );
    return mix( t, c * 0.96, far );
  }
  if ( k == 17.0 ) {
    vec2 f = abs( fract( vec2( u, v ) / 1.6 ) - 0.5 ); float j = smoothstep( 0.46, 0.5, max( f.x, f.y ) );
    return c * ( 0.95 + 0.08 * gNoise( vWPos.xz * 0.7 + vWPos.y ) ) * ( 1.0 - 0.13 * j * ( 1.0 - far ) );
  }
  if ( k == 18.0 ) {
    float n1 = gNoise( vWPos.xz * 0.055 ); float n2 = gNoise( vWPos.xz * 0.29 );
    float n3 = far < 0.99 ? gNoise( vWPos.xz * 1.6 ) : 0.5;
    vec3 g = c * ( 0.86 + 0.2 * n2 + 0.12 * ( n3 - 0.5 ) * ( 1.0 - far ) );
    return mix( g, g * vec3( 1.2, 1.1, 0.72 ), smoothstep( 0.58, 0.85, n1 ) * 0.55 );
  }
  if ( k == 19.0 ) {
    float n1 = gNoise( vWPos.xz * 0.11 ); float n2 = far < 0.99 ? gNoise( vWPos.xz * 2.2 ) : 0.5;
    vec3 d = c * ( 0.9 + 0.14 * n1 + 0.1 * ( n2 - 0.5 ) * ( 1.0 - far ) );
    return mix( d, d * 0.76, step( 0.93, gHash( floor( vWPos.xz * 2.6 ) ) ) * ( 1.0 - far ) );
  }
  if ( k == 24.0 ) {
    vec2 w = vWPos.xz * 0.3 + vec2( uTime * 0.11, uTime * 0.06 );
    float a = gNoise( w ); float b = gNoise( w * 2.3 + 5.0 - uTime * 0.08 );
    vec3 n = normalize( vec3( ( a - 0.5 ) * 0.3, 1.0, ( b - 0.5 ) * 0.3 ) );
    vec3 R = reflect( V, n ); float fr = pow( 1.0 - clamp( dot( -V, n ), 0.0, 1.0 ), 3.0 );
    add += uSunCol * pow( max( dot( R, uSun ), 0.0 ), 140.0 ) * 1.6 * ( 1.0 - uNight );
    return mix( c, gEnv( R ), 0.22 + 0.6 * fr );
  }
  if ( k == 25.0 ) { return c * ( 0.86 + 0.14 * ( 0.5 + 0.5 * sin( u * 52.0 ) ) * ( 1.0 - far ) ) + gEnv( reflect( V, N ) ) * 0.08; }
  if ( k == 26.0 ) { float p = u / 0.16; return c * ( 0.84 + 0.22 * gHash( vec2( floor( p ), 3.0 ) ) ) * ( 1.0 - 0.28 * step( fract( p ), 0.08 ) * ( 1.0 - far ) ); }
  if ( k == 27.0 ) { return c * ( 0.8 + 0.22 * gNoise( vec2( u * 0.4, v * 1.6 ) ) + 0.12 * gNoise( vWPos.xz * 1.3 + v ) * ( 1.0 - far ) ); }
  if ( k == 28.0 ) { float n = gNoise( vWPos.xz * 1.2 + vWPos.y * 1.4 ); return c * ( 0.78 + 0.34 * n * ( 1.0 - far * 0.6 ) ) * ( 0.85 + 0.15 * clamp( N.y + 0.5, 0.0, 1.0 ) ); }
  if ( k == 29.0 ) { return gRoad( c, 0.0, dist ); }
  return c;
}`;
const FRAG_COLOR = `#include <color_fragment>
float gc = floor( vFx + 0.5 );
vec3 gN = normalize( vWN );
vec3 gVd = vWPos - uCam; float gDist = length( gVd ); vec3 gV = gVd / max( gDist, 0.001 );
float gSh = vShade;
float gSunVis = 1.0;
float gEmis = 0.0;
vec3 gAdd = vec3( 0.0 );
bool gLit = !( gc == 1.0 || gc == 3.0 || gc == 4.0 || ( gc > 19.5 && gc < 23.5 ) );
#ifdef GTW_SHADOW
if ( gLit && uShadowP.x > 0.5 ) { gSunVis = gShadow( vWPos, gN ); gSh -= vSunK * ( 1.0 - gSunVis ) * uShadowP.z; }
#endif
vec3 gC = diffuseColor.rgb;
if ( gc < 0.5 ) {
#ifndef GTW_LOW
  if ( gN.y > 0.7 && gDist < 220.0 ) gC *= 0.955 + ( gNoise( vWPos.xz * 0.09 ) * 0.6 + gNoise( vWPos.xz * 0.41 ) * 0.4 ) * 0.09;
#endif
} else if ( gc == 2.0 || ( gc > 9.5 && gc < 12.5 ) ) {
  gC = gWindows( gC, gc, gN, gV, gDist, gEmis );
} else if ( gc == 5.0 ) {
#ifndef GTW_LOW
  gC = gRoad( gC, vAux, gDist );
#endif
} else if ( gc > 5.5 && gc < 8.5 ) {
  vec3 gR = reflect( gV, gN );
  float gFr = pow( 1.0 - clamp( dot( -gV, gN ), 0.0, 1.0 ), 4.0 );
  vec3 gEv = gEnv( gR );
  float gSp = 0.0;
#ifndef GTW_LOW
  gSh = uLk.x + uLk.y * ( 0.5 + 0.5 * gN.y ) + uLk.z * ( 0.22 + 0.78 * smoothstep( -0.25, 0.6, dot( gN, uSun ) ) ) * ( 1.0 - ( 1.0 - gSunVis ) * 0.85 );
  gSp = pow( max( dot( gR, uSun ), 0.0 ), gc == 6.0 ? 90.0 : 160.0 ) * gSunVis * ( 1.0 - 0.85 * uNight );
#endif
  if ( gc == 6.0 ) {
    float gDirt = uCar.x * ( 0.3 + 0.7 * smoothstep( 1.0, 0.3, vLPos.y ) ) * smoothstep( 0.3, 0.8, gNoise( vLPos.xz * 3.1 + vLPos.y * 2.3 ) + 0.2 );
    gC = mix( gC, vec3( 0.44, 0.38, 0.3 ), clamp( gDirt, 0.0, 0.75 ) );
    float gScr = uCar.y * step( 0.84, gHash( floor( vec2( vLPos.z * 9.0 + vLPos.y * 4.0, vLPos.y * 26.0 + vLPos.x ) ) ) ) * step( 0.45, gNoise( vLPos.zy * 1.7 + uCar.y * 3.0 ) );
    gC = mix( gC, vec3( 0.72, 0.72, 0.7 ), gScr * 0.75 );
    gC *= 1.0 - uCar.y * 0.3 * gNoise( vLPos.xz * 1.6 + 4.0 );
    float gGloss = 1.0 - clamp( gDirt * 1.3, 0.0, 0.8 );
    gAdd += gEv * ( 0.05 + 0.5 * gFr ) * gGloss + uSunCol * gSp * gGloss;
  } else if ( gc == 7.0 ) {
    gC = mix( gC * 0.75, gEv, 0.22 + 0.62 * gFr ); gSh = mix( gSh, 1.0, 0.55 ); gAdd += uSunCol * gSp * 1.3;
  } else { gC = mix( gC, gEv, 0.5 ); gAdd += uSunCol * gSp; }
} else if ( gc > 19.5 && gc < 23.5 ) {
  float gk = gc == 20.0 ? uFlash.x : ( gc == 21.0 ? uFlash.y : ( gc == 22.0 ? 0.5 + 0.3 * uNight + 0.9 * uCar.z : 0.22 + 1.1 * uCar.w ) );
  gC *= gk; gEmis = 1.0;
} else if ( gc > 12.5 ) {
#ifndef GTW_LOW
  gC = gMaterial( gC, gc, gN, gV, gDist, gAdd );
#endif
}
vec3 gL = vec3( 0.0 );
if ( gLit ) {
  if ( uSiren.w > 0.0 ) {
    vec3 d = vWPos - uSiren.xyz; float q = dot( d, d );
    float a = max( 0.0, 1.0 - q / ( uNight > 0.5 ? 260.0 : 120.0 ) ); a *= a;
    gL += uSirenCol * uSiren.w * ( uNight > 0.5 ? 0.34 : 0.35 ) * a * ( 0.3 + 0.7 * max( 0.0, -dot( d * inversesqrt( q + 0.01 ), gN ) ) );
  }
  for ( int i = 0; i < 2; i++ ) {
    if ( uSpotP[ i ].w > 0.0 ) {
      vec3 d = vWPos - uSpotP[ i ].xyz; float l = length( d ); vec3 dn = d / max( l, 0.01 );
      float a = smoothstep( 0.8, 0.95, dot( dn, uSpotD[ i ] ) ) * max( 0.0, 1.0 - l / 46.0 ) * smoothstep( 0.6, 2.5, l );
      gL += vec3( 1.0, 0.93, 0.8 ) * uSpotP[ i ].w * a * ( 0.15 + 0.85 * max( 0.0, -dot( dn, gN ) ) ) * ( gc > 5.5 && gc < 9.5 ? 0.35 : 0.9 );
    }
  }
  if ( uNight > 0.5 ) {
    for ( int i = 0; i < 8; i++ ) {
      if ( uLamp[ i ].w > 0.0 ) {
        // the pool is measured mostly horizontally so a lamp head 8 m up still lights a ~12 m disc
        vec3 d = vWPos - uLamp[ i ].xyz; float q = dot( d.xz, d.xz ) + d.y * d.y * 0.3;
        float a = max( 0.0, 1.0 - q / 170.0 ); a *= a;
        gL += uLampCol * uLamp[ i ].w * a * ( 0.3 + 0.7 * max( 0.0, -dot( d * inversesqrt( dot( d, d ) + 0.01 ), gN ) ) );
      }
    }
  }
}
diffuseColor.rgb = gC * mix( gSh, 1.12 + 0.08 * uNight, gEmis ) + gC * gL * 2.2 + gL * 0.07 + gAdd;`;
const FRAG_END = `if ( gc == 4.0 ) {
  #ifdef USE_FOG
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, 0.18 );
  #endif
} else {
  #ifdef USE_FOG
  float gF = clamp( ( gDist - fogNear ) / ( fogFar - fogNear ), 0.0, 1.0 );
  gF = gF * gF * ( 3.0 - 2.0 * gF ) * 0.85 + gF * 0.15;
  gF *= 1.0 - 0.45 * smoothstep( 6.0, 90.0, vWPos.y - uCam.y );
  gF *= 1.0 - 0.35 * gEmis;
  vec3 gFc = mix( fogColor, uFogSun, pow( max( dot( gV, uSun ), 0.0 ), 6.0 ) * 0.5 * ( 1.0 - uNight ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, gFc, gF );
  #endif
}`;

/** A toon material. opts: { vertexColors, fx (an FX code), side, fog, transparent, opacity,
 *  depthWrite, polygonOffset, outline }. Each material has its own uCar (dirt, scratches,
 *  brake, reverse) and uFlash (siren lenses) uniforms: m.userData.gtw.uCar / .uFlash. */
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
  const uCar = { value: new THREE.Vector4(0, 0, 0, 0) };
  const uFlash = { value: new THREE.Vector2(0.3, 0.3) };
  const tier = TIER;
  m.defines = { GTW_WIN: '' };
  if (tier === 'low') m.defines.GTW_LOW = '';
  else m.defines.GTW_SHADOW = '';
  m.userData.gtw = { fx: opts.fx || 0, outline: opts.outline || 0, uFxm, uCar, uFlash };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.uniforms.uFxm = uFxm; sh.uniforms.uCar = uCar; sh.uniforms.uFlash = uFlash;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_PRE).replace('#include <color_vertex>', VERT_COLOR).replace('#include <fog_vertex>', VERT_POST);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', FRAG_PRE).replace('#include <color_fragment>', FRAG_COLOR).replace('#include <fog_fragment>', FRAG_END);
  };
  m.customProgramCacheKey = () => 'gtw-toon-v2-' + tier;
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
    wheel16: t(new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1).rotateZ(Math.PI / 2), false),
    cyl16: t(new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1), false),
    cone12: t(new THREE.CylinderGeometry(0.0, 0.5, 1, 12, 1), false),
    sphereLo: t(new THREE.IcosahedronGeometry(0.5, 1), false),
    dome: t(new THREE.SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), false),
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
    this.aux = new Float32Array(this.cap); this.hasAux = false; this.auxV = 0; // per-vertex aux (road lane coordinate); auxV applies to add()/poly()
    this.icap = 8192; this.idx = new Uint32Array(this.icap);
  }
  grow(nv, ni) {
    if (this.nv + nv > this.cap) {
      let c = this.cap; while (this.nv + nv > c) c *= 2;
      for (const k of ['pos', 'nrm', 'col']) { const a = new Float32Array(c * 3); a.set(this[k]); this[k] = a; }
      const f = new Float32Array(c); f.set(this.fx); this.fx = f;
      const ax = new Float32Array(c); ax.set(this.aux); this.aux = ax; this.cap = c;
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
        this.fx[base + i] = f; this.aux[base + i] = this.auxV;
      }
      const ti = t.idx; let ni = this.ni;
      if (!h) for (let k = 0; k < ti.length; k++) this.idx[ni++] = base + ti[k];
      else for (let k = 0; k < ti.length; k += 3) { this.idx[ni++] = base + ti[k]; this.idx[ni++] = base + ti[k + 2]; this.idx[ni++] = base + ti[k + 1]; }
      this.ni = ni; this.nv = base + t.n;
    }
    return this;
  }
  /** Only the ink hull of template t (outline ol metres), for shapes added piecewise in several colours. */
  hull(t, ol, inkCol = null) {
    const ink = inkCol || this.ink;
    this.grow(t.n, t.idx.length);
    const base = this.nv;
    for (let i = 0; i < t.n; i++) {
      const o = (base + i) * 3; const hx = t.hull[i * 3]; const hy = t.hull[i * 3 + 1]; const hz = t.hull[i * 3 + 2];
      this.pos[o] = t.pos[i * 3] + hx * ol; this.pos[o + 1] = t.pos[i * 3 + 1] + hy * ol; this.pos[o + 2] = t.pos[i * 3 + 2] + hz * ol;
      this.nrm[o] = t.nrm[i * 3]; this.nrm[o + 1] = t.nrm[i * 3 + 1]; this.nrm[o + 2] = t.nrm[i * 3 + 2];
      this.col[o] = ink[0]; this.col[o + 1] = ink[1]; this.col[o + 2] = ink[2]; this.fx[base + i] = FX_INK; this.aux[base + i] = 0;
    }
    const ti = t.idx; let ni = this.ni;
    for (let k = 0; k < ti.length; k += 3) { this.idx[ni++] = base + ti[k]; this.idx[ni++] = base + ti[k + 2]; this.idx[ni++] = base + ti[k + 1]; }
    this.ni = ni; this.nv = base + t.n;
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
      this.col[o] = rgb[0]; this.col[o + 1] = rgb[1]; this.col[o + 2] = rgb[2]; this.fx[base + i] = fx; this.aux[base + i] = this.auxV;
    }
    for (let i = 1; i < n - 1; i++) { this.idx[this.ni++] = base; this.idx[this.ni++] = base + i; this.idx[this.ni++] = base + i + 1; }
    this.nv += n;
    return this;
  }
  /** Like quadUp, with a per-vertex aux value (a0..a3 for a..d): road ribbons carry the lane coordinate. */
  quadUpA(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, rgb, fx, a0, a1, a2, a3) {
    const b = this.nv;
    this.quadUp(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, rgb, fx);
    const A = this.aux; A[b] = a0; A[b + 1] = a1; A[b + 2] = a2; A[b + 3] = a3;
    if (a0 || a1 || a2 || a3) this.hasAux = true;
    return this;
  }
  /** Fast quad strip writer used by road ribbons: 4 verts, upward normal. */
  quadUp(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, rgb, fx = 0) {
    this.grow(4, 6);
    const b = this.nv; const P = this.pos; const N = this.nrm; const C = this.col; const F = this.fx; const o = b * 3;
    P[o] = ax; P[o + 1] = ay; P[o + 2] = az; P[o + 3] = bx; P[o + 4] = by; P[o + 5] = bz;
    P[o + 6] = cx; P[o + 7] = cy; P[o + 8] = cz; P[o + 9] = dx; P[o + 10] = dy; P[o + 11] = dz;
    const AX = this.aux; const av = this.auxV;
    for (let i = 0; i < 4; i++) { const q = o + i * 3; N[q] = 0; N[q + 1] = 1; N[q + 2] = 0; C[q] = rgb[0]; C[q + 1] = rgb[1]; C[q + 2] = rgb[2]; F[b + i] = fx; AX[b + i] = av; }
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
    if (this.hasAux || this.auxV) g.setAttribute('aux', new THREE.BufferAttribute(this.aux.slice(0, this.nv), 1));
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
  const it = mergeSteps(THREE, group, mats, inkRGB, disposeSet, pre);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}
/** mergeGroup as a generator that yields after every source mesh (the world slices on it). */
export function* mergeSteps(THREE, group, mats, inkRGB, disposeSet, pre = null) {
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
      const ca = m.vertexColors ? geo.getAttribute('color') : null; const fa = geo.getAttribute('fx'); const xa = geo.getAttribute('aux');
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
          if (xa) { const av = xa.getX(i); b.aux[base + i] = av; if (av) b.hasAux = true; }
        }
      }
      yield 0;
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
/**
 * Sky dome: a three-stop gradient (zenith, mid, horizon haze), a Mie-like glow and a soft sun disc
 * (no ring), drifting procedural clouds, and at night a moon with a halo and twinkling stars fixed
 * to the sky (not the screen). opts: { sunCol, clouds (0..1), tier }. mesh.userData.tick(t).
 */
export function makeSky(THREE, top, horizon, sunDir, dark, opts = {}) {
  const g = new THREE.SphereGeometry(1, 32, 16);
  const mid = [horizon[0] * 0.45 + top[0] * 0.55, horizon[1] * 0.45 + top[1] * 0.55, horizon[2] * 0.45 + top[2] * 0.55];
  const sunCol = opts.sunCol || (dark ? [0.85, 0.88, 0.95] : [1.0, 0.9, 0.7]);
  const low = opts.tier === 'low';
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color().fromArray(top) }, uMid: { value: new THREE.Color().fromArray(mid) }, uHor: { value: new THREE.Color().fromArray(horizon) },
      uSun: { value: sunDir.clone().normalize() }, uNight: { value: dark ? 1 : 0 }, uSunCol: { value: new THREE.Color().fromArray(sunCol) },
      uCloud: { value: opts.clouds == null ? 0.55 : opts.clouds }, uTime: { value: 0 },
    },
    defines: low ? { SKY_LOW: '' } : {},
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999; }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uSun; uniform float uNight; uniform vec3 uSunCol; uniform float uCloud; uniform float uTime; varying vec3 vD;
      float h2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float n2(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){
        vec3 d = normalize(vD);
        float h = d.y;
        float s = dot(d, normalize(uSun));
        vec3 c = mix(uHor, uMid, smoothstep(0.0, 0.16, h));
        c = mix(c, uTop, smoothstep(0.12, 0.75, h));
        if (h < 0.0) c = mix(uHor, uHor * 0.88, smoothstep(0.0, -0.25, h));
        float sp = max(s, 0.0);
        float day = 1.0 - uNight;
        // haze glow + a warmer horizon towards the sun
        c += uSunCol * (pow(sp, 6.0) * 0.16 + pow(sp, 48.0) * 0.32) * day;
        c = mix(c, c * vec3(1.06, 0.98, 0.9), pow(sp, 3.0) * (1.0 - smoothstep(0.0, 0.35, h)) * day);
        #ifndef SKY_LOW
        // clouds: two octaves projected on a high plane, drifting
        if (h > 0.0 && uCloud > 0.0) {
          vec2 uv = d.xz / (h + 0.09) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
          float n = n2(uv * 1.3) * 0.62 + n2(uv * 3.1 + 7.0) * 0.28 + n2(uv * 7.0 + 3.0) * 0.1;
          float cov = smoothstep(0.62 - uCloud * 0.2, 0.86 - uCloud * 0.12, n) * smoothstep(0.015, 0.2, h);
          vec3 cc = mix(vec3(1.0, 0.99, 0.97), uHor * 0.92, 0.35 + 0.35 * (1.0 - n));
          cc += uSunCol * pow(sp, 5.0) * 0.25;
          if (uNight > 0.5) cc = mix(uTop * 1.6, uHor * 0.9, 0.5) + uSunCol * pow(sp, 12.0) * 0.25;
          c = mix(c, cc, cov * (0.82 - 0.4 * uNight));
        }
        #endif
        // sun / moon: a soft disc with a halo, no ring
        float disc = smoothstep(0.99935, 0.99965, s);
        if (uNight > 0.5) {
          c += uSunCol * pow(sp, 160.0) * 0.18;
          c = mix(c, vec3(0.93, 0.93, 0.88), disc);
          #ifndef SKY_LOW
          vec3 cell = floor(d * 260.0);
          float r = h2(cell.xy * 1.37 + cell.z * 0.71);
          vec3 cp = (cell + 0.5) / 260.0;
          float st = smoothstep(0.9985, 1.0, r) * smoothstep(0.08, 0.3, h) * (1.0 - smoothstep(0.0011, 0.0024, length(d - normalize(cp))));
          c += vec3(0.9, 0.92, 1.0) * st * (0.6 + 0.4 * sin(uTime * 2.0 + r * 300.0));
          #endif
        } else {
          c = mix(c, uSunCol * 1.12 + 0.08, disc);
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  mesh.userData.tick = (t) => { m.uniforms.uTime.value = t; };
  return mesh;
}
