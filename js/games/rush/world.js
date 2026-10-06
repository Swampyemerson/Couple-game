// Rail Rush world: scene, lights, fog, pooled per-chunk merged meshes (track + scenery + parked
// trains + outlines, one draw call per chunk), instanced coins / pickups / barriers / roadblocks,
// pooled oncoming trains, skyline and street. `syncView(view)` lays out the per-runner things
// (collected coins, smashed barriers, oncoming train positions) right before rendering a view.
import { rng } from '../core.js';
import { CHUNK, LANE_W, CAR, ROOF, LOW_H, HIGH_B, HIGH_T } from './tune.js';
import { O_LOW, O_HIGH, O_TRAIN, O_RAMP, O_MTRAIN, O_BLOCK, I_MAGNET, I_SNEAKERS, I_SHIELD, I_BOX, I_REVIVE, mtrainFront } from './track.js';
import { GeoBuf, makeToon, makeUniforms, makeTemplates, blobTexture, mix, FX_PLAIN, FX_GLOW, FX_SKY } from './gfx.js';

// Sky dome: two theme inks printed as a halftone gradient (dots grow from the horizon up), so the
// sky reads as Riso print rather than a CSS gradient. Its uniforms carry the colour script.
const SKY_VERT = `varying float vE;
void main() { vE = normalize( position ).y; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;
const SKY_FRAG = `uniform vec3 uHor; uniform vec3 uTop; uniform float uDot;
varying float vE;
void main() {
  float t = clamp( ( vE - 0.03 ) * 2.6, 0.0, 1.0 );
  vec2 g = fract( gl_FragCoord.xy / ( uDot * 1.5 ) ) - 0.5;
  float ink = step( dot( g, g ), t * t * 0.52 );
  gl_FragColor = vec4( mix( uHor, uTop, ink ), 1.0 );
}`;

const OL = 0.05;
const CHUNK_V = 18000;
const POOL = 9;
const COIN_MAX = 300;
const ITEM_MAX = 16;
const BAR_MAX = 40;
const VIEW_AHEAD = 175;
const COIN_AHEAD = 132;   // coins further out are lost in the fog anyway
const VIEW_BEHIND = 14;
const SIDE_X = 4.35;      // parapet line

export function createWorld(THREE, P) {
  const T = makeTemplates(THREE);
  const U = makeUniforms(THREE, P);
  // Same shader, separate instances per object kind: three r128 recomputes program parameters
  // (and allocates) whenever one material alternates between plain and instanced draws.
  const mat = makeToon(THREE, null, U);
  const matInst = makeToon(THREE, null, U);
  const matInstC = makeToon(THREE, null, U);
  // barriers: instanced, plus a halftone dissolve once they're behind your runner, near the camera
  // (the discard lives in this program only, so the world keeps its early depth rejection)
  const matBar = makeToon(THREE, null, U, { extra: { near: true } });
  // One skinned material per runner (same program): each has its own fade, so the partner can
  // dissolve through a halftone screen when they run between your camera and you.
  const fade = { a: { value: 0 }, b: { value: 0 } };
  const avatarMats = { a: makeToon(THREE, null, U, { skinning: true, extra: { uFade: fade.a } }), b: makeToon(THREE, null, U, { skinning: true, extra: { uFade: fade.b } }) };
  const avatarMat = avatarMats.a;
  const disposables = [mat, matInst, matInstC, matBar, avatarMats.a, avatarMats.b];

  const scene = new THREE.Scene();
  scene.background = new THREE.Color().fromArray(P.bg);
  // Fog starts far enough out that obstacles are crisp ~2.5 s ahead at top speed, and swallows
  // chunk pop-in (chunks are built 175 m ahead) completely.
  scene.fog = new THREE.Fog(new THREE.Color().fromArray(P.skyCalm[0]), 62, 170);

  // ── chunk meshes ──
  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const buf = new GeoBuf(THREE, CHUNK_V);
    const mesh = new THREE.Mesh(buf.geo, mat);
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    pool.push({ buf, mesh, ci: null, used: 0 });
    disposables.push(buf);
  }
  const byChunk = new Map();
  const stats = { maxV: 0, maxI: 0, over: 0, built: 0 };
  let frame = 0;

  // ── instanced things ──
  const tmpBuf = new GeoBuf(THREE, 6000, { dynamic: false });
  const freezeWith = (fn) => { tmpBuf.reset(); fn(tmpBuf); const g = tmpBuf.freeze(THREE); disposables.push(g); return g; };
  const inst = (geo, max, m = matInst) => {
    const im = new THREE.InstancedMesh(geo, m, max);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.count = 0; im.frustumCulled = false;
    scene.add(im);
    return im;
  };
  const ink = P.outline;
  // 12-sided: ~156 triangles a coin with its outline (up to ~50 on screen)
  const coinGeo = freezeWith((b) => {
    b.add(T.disc12, 0, 0, 0, 0.84, 0.13, 0.84, 0, P.coinRim, FX_PLAIN, 0.045, ink);
    b.add(T.disc12, 0, 0, 0, 0.62, 0.16, 0.62, 0, P.coin, FX_GLOW, 0, ink);
    b.add(T.box, 0, 0, 0, 0.12, 0.19, 0.34, 0, P.coinRim, FX_PLAIN, 0, ink);
  });
  // disc template is a Y-axis cylinder: rotate its axis to Z by swapping in the instance matrix (see writeCoin)
  const coins = inst(coinGeo, COIN_MAX);

  const itemGeo = {};
  itemGeo[I_MAGNET] = freezeWith((b) => {
    b.add(T.box, -0.26, 0.06, 0, 0.2, 0.62, 0.22, 0, P.bad, FX_PLAIN, 0.04, ink);
    b.add(T.box, 0.26, 0.06, 0, 0.2, 0.62, 0.22, 0, P.bad, FX_PLAIN, 0.04, ink);
    b.add(T.box, 0, -0.32, 0, 0.72, 0.2, 0.22, 0, P.bad, FX_PLAIN, 0.04, ink);
    b.add(T.box, -0.26, 0.42, 0, 0.21, 0.14, 0.23, 0, P.white, FX_GLOW, 0, ink);
    b.add(T.box, 0.26, 0.42, 0, 0.21, 0.14, 0.23, 0, P.white, FX_GLOW, 0, ink);
  });
  itemGeo[I_SNEAKERS] = freezeWith((b) => {
    b.add(T.box, 0, -0.22, 0.02, 0.36, 0.14, 0.78, 0, P.white, FX_PLAIN, 0.04, ink);
    b.add(T.box, 0, 0.0, 0.1, 0.34, 0.32, 0.55, 0, P.good, FX_PLAIN, 0.04, ink);
    b.add(T.box, 0, 0.22, 0.26, 0.32, 0.36, 0.24, 0, P.good, FX_PLAIN, 0.04, ink);
    b.add(T.box, 0.22, 0.18, 0.2, 0.06, 0.34, 0.46, -0.5, P.hl, FX_GLOW, 0.03, ink);
    b.add(T.box, -0.22, 0.18, 0.2, 0.06, 0.34, 0.46, 0.5, P.hl, FX_GLOW, 0.03, ink);
  });
  itemGeo[I_SHIELD] = freezeWith((b) => {
    b.add(T.sphere, 0, 0, 0, 0.8, 0.8, 0.8, 0, mix(P.a, P.white, 0.45), FX_GLOW, 0.045, ink);
    b.add(T.box, 0, 0, -0.38, 0.12, 0.42, 0.08, 0, P.white, FX_GLOW, 0, ink);
    b.add(T.box, 0, 0.05, -0.38, 0.32, 0.12, 0.08, 0, P.white, FX_GLOW, 0, ink);
  });
  itemGeo[I_BOX] = freezeWith((b) => {
    b.add(T.box, 0, 0, 0, 0.78, 0.78, 0.78, 0, P.hl, FX_GLOW, 0.05, ink);
    b.add(T.box, 0, 0, 0, 0.82, 0.22, 0.82, 0, P.a, FX_PLAIN, 0, ink);
    b.add(T.box, 0, 0, 0, 0.22, 0.82, 0.83, 0, P.b, FX_PLAIN, 0, ink);
  });
  itemGeo[I_REVIVE] = freezeWith((b) => {
    // a fat heart with a halo ring and a light beam you can spot from far away
    b.add(T.sphere, -0.3, 0.18, 0, 0.75, 0.75, 0.5, 0, P.b, FX_GLOW, 0.06, ink);
    b.add(T.sphere, 0.3, 0.18, 0, 0.75, 0.75, 0.5, 0, P.b, FX_GLOW, 0.06, ink);
    b.add(T.box, 0, -0.16, 0, 0.74, 0.74, 0.48, Math.PI / 4, P.b, FX_GLOW, 0.05, ink);
    b.add(T.disc, 0, -1.05, 0, 2.2, 0.06, 2.2, 0, mix(P.hl, P.white, 0.3), FX_GLOW, 0.04, ink);
    b.add(T.cyl, 0, 2.6, 0, 0.32, 6.5, 0.32, 0, mix(P.b, P.white, 0.55), FX_GLOW, 0, ink);
  });
  // The revive halo should be drawn first-ish; it's opaque but smaller parts poke through. Fine for a glowing token.
  const items = {};
  for (const k of [I_MAGNET, I_SNEAKERS, I_SHIELD, I_BOX, I_REVIVE]) items[k] = inst(itemGeo[k], ITEM_MAX);

  const lowGeo = freezeWith((b) => {
    b.boxMM(-1.02, 0, -0.1, -0.84, LOW_H, 0.1, P.pole, FX_PLAIN, 0.035, ink, T);
    b.boxMM(0.84, 0, -0.1, 1.02, LOW_H, 0.1, P.pole, FX_PLAIN, 0.035, ink, T);
    b.boxMM(-1.1, 0.46, -0.16, 1.1, 0.98, 0.16, P.hl, FX_PLAIN, 0.045, ink, T);
    stripes(b, T, -1.1, 0.46, 1.1, 0.98, 0.17, P.ink, 5);
    b.boxMM(-1.12, 0, -0.3, -0.74, 0.08, 0.3, P.pole, FX_PLAIN, 0, ink, T);
    b.boxMM(0.74, 0, -0.3, 1.12, 0.08, 0.3, P.pole, FX_PLAIN, 0, ink, T);
  });
  const highGeo = freezeWith((b) => {
    b.boxMM(-1.12, 0, -0.1, -0.94, HIGH_T, 0.1, P.pole, FX_PLAIN, 0.035, ink, T);
    b.boxMM(0.94, 0, -0.1, 1.12, HIGH_T, 0.1, P.pole, FX_PLAIN, 0.035, ink, T);
    b.boxMM(-1.16, HIGH_B + 0.04, -0.12, 1.16, HIGH_T - 0.05, 0.12, P.white, FX_PLAIN, 0.045, ink, T);
    stripes(b, T, -1.16, HIGH_B + 0.04, 1.16, HIGH_T - 0.05, 0.13, P.bad, 5);
    b.boxMM(-0.18, HIGH_T - 0.05, -0.08, 0.18, HIGH_T + 0.12, 0.08, P.hl, FX_GLOW, 0.03, ink, T);
  });
  const blockGeo = freezeWith((b) => {
    b.boxMM(-1.15, 0, -0.35, 1.15, 1.1, 0.35, P.white, FX_PLAIN, 0.06, ink, T);
    stripes(b, T, -1.15, 0, 1.15, 1.1, 0.36, mix(P.white, P.ink, 0.75), 5);
    b.boxMM(-1.2, 1.1, -0.4, 1.2, 1.25, 0.4, P.white, FX_PLAIN, 0.05, ink, T);
    b.boxMM(-0.25, 1.25, -0.1, 0.25, 1.6, 0.1, P.hl, FX_GLOW, 0.04, ink, T);
  });
  const lows = inst(lowGeo, BAR_MAX, matBar);
  const highs = inst(highGeo, BAR_MAX, matBar);
  const blocks = inst(blockGeo, 8, matInstC);
  blocks.setColorAt(0, new THREE.Color(1, 1, 1));

  // start / finish gates
  const gateGeo = freezeWith((b) => {
    for (const sx of [-1, 1]) b.boxMM(sx * 4.62 - 0.26, -0.12, -0.26, sx * 4.62 + 0.26, 7.4, 0.26, P.pole, FX_PLAIN, 0.05, ink, T);
    b.boxMM(-4.95, 6.3, -0.28, 4.95, 7.5, 0.28, P.white, FX_PLAIN, 0.06, ink, T);
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2) b.add(T.quad, -4.95 + (i + 0.5) * (9.9 / 16), 6.3 + (j + 0.5) * 0.6, 0.29, 9.9 / 16, 0.6, 1, 0, P.ink, FX_PLAIN, 0, ink);
    b.boxMM(-2.3, 5.95, -0.38, 2.3, 7.85, 0.38, P.hl, FX_GLOW, 0.06, ink, T);
    for (let i = 0; i < 14; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2) b.add(T.quadUp, -4.2 + (i + 0.5) * 0.6, 0.02, (j - 0.5) * 0.45, 0.6, 1, 0.45, 0, P.ink, FX_PLAIN, 0, ink);
    b.boxMM(-4.2, -0.025, -0.45, 4.2, 0.015, 0.45, P.white, FX_PLAIN, 0, ink, T);
  });
  const gates = inst(gateGeo, 2);
  // printed banners on the gates (two tiny canvas textures)
  const bannerTex = (text) => {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192;
    const draw = () => {
      const g = cv.getContext('2d');
      g.fillStyle = hexOf(P.hl); g.fillRect(0, 0, 512, 192);
      g.fillStyle = hexOf(P.dark ? P.bg : P.ink); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 120px ${P.font || 'Arial Black, sans-serif'}`;
      g.fillText(text, 256, 102, 470);
    };
    draw();
    const t = new THREE.CanvasTexture(cv);
    try { document.fonts && document.fonts.ready.then(() => { draw(); t.needsUpdate = true; }); } catch { /* ignore */ }
    disposables.push(t);
    return t;
  };
  const bannerGeo = new THREE.PlaneGeometry(4.5, 1.7);
  disposables.push(bannerGeo);
  const banners = ['RUN!', 'FINISH'].map((txt) => {
    const m = new THREE.MeshBasicMaterial({ map: bannerTex(txt), fog: true });
    disposables.push(m);
    const mesh = new THREE.Mesh(bannerGeo, m);
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  });

  // oncoming trains (pooled, 2 cars, front at local z = 0 facing +z)
  const mtGeo = freezeWith((b) => trainCars(b, 0, 0, 2, P.trains[4], true, T, P));
  const mtrains = [];
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(mtGeo, mat); m.visible = false; m.frustumCulled = false; m.matrixAutoUpdate = false; scene.add(m); mtrains.push(m); }

  // blob shadows
  const blobTex = blobTexture(THREE);
  const shadowMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, color: P.dark ? 0x000000 : 0x2a2440, opacity: P.dark ? 0.9 : 0.75, fog: true });
  shadowMat.polygonOffset = true; shadowMat.polygonOffsetFactor = -2;
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, 6);
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadows.count = 0; shadows.frustumCulled = false; shadows.renderOrder = 2;
  scene.add(shadows);
  disposables.push(blobTex, shadowMat, shadowGeo);

  // street far below and the skyline ring (both follow the camera)
  // The far layers draw after the near world (renderOrder), so early depth testing skips every
  // pixel a building or train already covers: no overdraw from the street, skyline or sky.
  const streetGeo = freezeWith((b) => { b.boxMM(-450, -8.6, -450, 450, -8, 450, P.street, FX_PLAIN, 0, ink, T); });
  const street = new THREE.Mesh(streetGeo, mat);
  street.frustumCulled = false;
  street.renderOrder = 3;
  scene.add(street);
  const skyBuf = new GeoBuf(THREE, 26000, { dynamic: false });
  buildSkyline(skyBuf, T, P);
  const skyGeo = skyBuf.freeze(THREE);
  disposables.push(skyGeo);
  skyBuf.dispose();
  const skyline = new THREE.Mesh(skyGeo, mat);
  skyline.frustumCulled = false;
  skyline.renderOrder = 4;
  scene.add(skyline);
  const skyU = { uHor: { value: new THREE.Color().fromArray(P.skyCalm[0]) }, uTop: { value: new THREE.Color().fromArray(P.skyCalm[1]) }, uDot: U.uDot };
  const domeGeo = new THREE.SphereGeometry(400, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.56);
  const domeMat = new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = 5;
  scene.add(dome);
  disposables.push(domeGeo, domeMat);
  tmpBuf.dispose();
  const calm0 = new THREE.Color().fromArray(P.skyCalm[0]); const calm1 = new THREE.Color().fromArray(P.skyCalm[1]);
  const fast0 = new THREE.Color().fromArray(P.skyFast[0]); const fast1 = new THREE.Color().fromArray(P.skyFast[1]);
  let moodK = -1;
  let sunFront = null;
  /** Colour script: 0 = strolling, 1 = flat out (sky and fog warm up together). */
  function setMood(k) {
    const q = Math.round(Math.max(0, Math.min(1, k)) * 64) / 64;
    if (q === moodK) return;
    moodK = q;
    const e = q * q * (3 - 2 * q);
    skyU.uHor.value.copy(calm0).lerp(fast0, e);
    skyU.uTop.value.copy(calm1).lerp(fast1, e);
    scene.fog.color.copy(skyU.uHor.value);
  }
  setMood(0);

  // ── chunks ──
  function chunkMesh(track, ci) {
    let e = byChunk.get(ci);
    if (e) { e.used = frame; return e; }
    // take the least recently used slot
    e = null;
    for (const p of pool) if (p.ci === null) { e = p; break; }
    if (!e) { for (const p of pool) if (p.used < frame - 1 && (!e || p.used < e.used)) e = p; }
    if (!e) return null;
    if (e.ci !== null) byChunk.delete(e.ci);
    const c = ci < 0 ? behindChunk(ci) : track.chunk(ci);
    e.buf.reset();
    buildChunk(e.buf, c, T, P);
    e.buf.commit(140, 0, 4, -(c.z0 + CHUNK / 2));
    if (e.buf.nv > stats.maxV) stats.maxV = e.buf.nv;
    if (e.buf.ni > stats.maxI) stats.maxI = e.buf.ni;
    if (e.buf.over) stats.over++;
    stats.built++;
    e.mesh.visible = true;
    e.ci = ci; e.used = frame;
    byChunk.set(ci, e);
    return e;
  }

  /** Make sure the chunks around these track positions have meshes. Returns how many were built. */
  function ensure(track, zs, nz, budget = 9) {
    frame++;
    let built = 0;
    for (let zi = 0; zi < nz; zi++) {
      const z = zs[zi];
      const c0 = Math.floor((z - VIEW_BEHIND) / CHUNK);
      const c1 = Math.floor((z + VIEW_AHEAD) / CHUNK);
      for (let ci = Math.max(-1, c0); ci <= c1; ci++) {
        if (byChunk.has(ci)) { byChunk.get(ci).used = frame; continue; }
        if (built >= budget) continue;
        chunkMesh(track, ci); built++;
      }
    }
    return built;
  }

  // ── per-view layout ──
  const itemCount = new Int16Array(8);
  const tmpColor = new THREE.Color();
  // writeM's doubles travel through WM (x, y, z, scale, ry, rx), not as call arguments, so V8
  // never boxes them when the call isn't inlined. Instance matrix i = T(x,y,z) · Ry · Rx · s.
  const WM = new Float64Array(6);
  function writeM(arr, i) {
    const x = WM[0]; const y = WM[1]; const z = WM[2]; const s = WM[3]; const ry = WM[4]; const rx = WM[5];
    const cy = Math.cos(ry); const sy = Math.sin(ry);
    const cx = Math.cos(rx); const sx = Math.sin(rx);
    const o = i * 16;
    arr[o] = cy * s; arr[o + 1] = 0; arr[o + 2] = -sy * s; arr[o + 3] = 0;
    arr[o + 4] = sy * sx * s; arr[o + 5] = cx * s; arr[o + 6] = cy * sx * s; arr[o + 7] = 0;
    arr[o + 8] = sy * cx * s; arr[o + 9] = -sx * s; arr[o + 10] = cy * cx * s; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }

  /**
   * Lay out per-runner things for one view. v = { track, z (view runner z), r (runner whose
   * pickups count, may be null), time (s), fly: [{x,y,z,s}] flying coins }
   */
  function syncView(v) {
    const { track, z } = v;
    const r = v.r;
    const spin = v.time * 3.2;
    const c0 = Math.max(0, Math.floor((z - VIEW_BEHIND) / CHUNK));
    const c1 = Math.floor((z + VIEW_AHEAD) / CHUNK);
    const ca = coins.instanceMatrix.array;
    if (sunFront !== !!v.front) { sunFront = !!v.front; U.uSun.value.set(-0.42, 0.8, sunFront ? -0.43 : 0.43).normalize(); }
    let nc = 0;
    const ic = itemCount;
    ic.fill(0);
    let nl = 0; let nh = 0; let nm = 0;
    const la = lows.instanceMatrix.array; const ha = highs.instanceMatrix.array;
    for (let ci = c0; ci <= c1; ci++) {
      const c = track.chunk(ci);
      const base = ci * 1000;
      const cs = c.coins;
      for (let i = 0; i < cs.length && nc < COIN_MAX; i++) {
        const cn = cs[i];
        if (cn.z < z - VIEW_BEHIND) continue;
        if (cn.z > z + COIN_AHEAD) break; // sorted by z
        if (r && r.taken.has(base + i)) continue;
        WM[0] = cn.x; WM[1] = cn.y; WM[2] = -cn.z; WM[3] = 1; WM[4] = spin + cn.z * 0.05; WM[5] = Math.PI / 2; writeM(ca, nc++);
      }
      const its = c.items;
      for (let i = 0; i < its.length; i++) {
        const it = its[i];
        if (it.z < z - VIEW_BEHIND || it.z > z + VIEW_AHEAD) continue;
        if (r && r.taken.has(base + 500 + i)) continue;
        if (it.k === I_BOX && !v.boxes) continue;
        const m = items[it.k];
        if (ic[it.k] >= ITEM_MAX) continue;
        const bob = Math.sin(v.time * 3 + it.z) * 0.12;
        WM[0] = it.x; WM[1] = it.y + bob; WM[2] = -it.z; WM[3] = it.k === I_BOX ? 1 : 1.05; WM[4] = spin * 0.7 + it.z; WM[5] = it.k === I_BOX ? 0.6 : 0; writeM(m.instanceMatrix.array, ic[it.k]++);
      }
      const obs = c.obs;
      for (let oi = 0; oi < obs.length; oi++) {
        const o = obs[oi];
        if (o.z1 < z - VIEW_BEHIND || o.z0 > z + VIEW_AHEAD) continue;
        if (o.t === O_LOW || o.t === O_HIGH) {
          if (r && r.smashN && r.smashed.has(o.id)) continue;
          if (o.t === O_LOW) { if (nl < BAR_MAX) { WM[0] = o.lane * LANE_W; WM[1] = 0; WM[2] = -(o.z0 + 0.25); WM[3] = 1; WM[4] = 0; WM[5] = 0; writeM(la, nl++); } }
          else if (nh < BAR_MAX) { WM[0] = o.lane * LANE_W; WM[1] = 0; WM[2] = -(o.z0 + 0.2); WM[3] = 1; WM[4] = 0; WM[5] = 0; writeM(ha, nh++); }
        } else if (o.t === O_MTRAIN && nm < mtrains.length) {
          const f = mtrainFront(o, z);
          const m = mtrains[nm++];
          m.visible = true;
          const me = m.matrix.elements; me[12] = o.lane * LANE_W; me[13] = 0; me[14] = -f; // (no Vector3 setters per frame)
          m.matrixWorldNeedsUpdate = true;
        }
      }
    }
    if (v.fly) for (let fi = 0; fi < v.fly.length; fi++) { const f = v.fly[fi]; if (nc < COIN_MAX && f.on) { WM[0] = f.x; WM[1] = f.y; WM[2] = -f.z; WM[3] = f.s; WM[4] = spin * 2; WM[5] = Math.PI / 2; writeM(ca, nc++); } }
    if (r) {
      for (let ti = 0; ti < r.tokens.length; ti++) {
        const tk = r.tokens[ti];
        if (!tk.alive || ic[I_REVIVE] >= ITEM_MAX) continue;
        const bob = Math.sin(v.time * 5) * 0.15;
        WM[0] = tk.x; WM[1] = tk.y + bob; WM[2] = -tk.z; WM[3] = 1 + Math.sin(v.time * 9) * 0.08; WM[4] = spin * 1.4; WM[5] = 0; writeM(items[I_REVIVE].instanceMatrix.array, ic[I_REVIVE]++);
      }
      let nb = 0;
      for (let ei = 0; ei < r.extra.length; ei++) {
        const o = r.extra[ei];
        if (o.t !== O_BLOCK || nb >= 8) continue;
        if (o.z1 < z - VIEW_BEHIND || o.z0 > z + VIEW_AHEAD) continue;
        if (o.hit) continue;
        WM[0] = o.lane * LANE_W; WM[1] = 0; WM[2] = -(o.z0 + 0.35); WM[3] = 1; WM[4] = 0; WM[5] = 0; writeM(blocks.instanceMatrix.array, nb);
        tmpColor.fromArray(o.rgb || P.hl);
        blocks.setColorAt(nb, tmpColor);
        nb++;
      }
      blocks.count = nb;
      if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
      blocks.instanceMatrix.needsUpdate = true;
    } else blocks.count = 0;
    for (let i = nm; i < mtrains.length; i++) mtrains[i].visible = false;
    coins.count = nc; coins.instanceMatrix.needsUpdate = true;
    for (let k = 1; k <= 5; k++) { items[k].count = ic[k]; items[k].instanceMatrix.needsUpdate = true; }
    lows.count = nl; lows.instanceMatrix.needsUpdate = true;
    highs.count = nh; highs.instanceMatrix.needsUpdate = true;
  }

  /** Blob shadows: list of [x, groundY, z, size, strength]. */
  function setShadows(list, n) {
    const a = shadows.instanceMatrix.array;
    for (let i = 0; i < n; i++) {
      const s = list[i];
      const o = i * 16;
      a.fill(0, o, o + 16);
      a[o] = s[3]; a[o + 5] = 1; a[o + 10] = s[3] * 0.8; a[o + 15] = 1;
      a[o + 12] = s[0]; a[o + 13] = s[1] + 0.03; a[o + 14] = -s[2];
    }
    shadows.count = n;
    shadows.instanceMatrix.needsUpdate = true;
  }

  const followers = [street, skyline, dome];
  for (let i = 0; i < 3; i++) followers[i].matrixAutoUpdate = false;
  /** The far layers sit around the camera (translation only, written straight into the matrices). */
  function follow(cam) {
    const x = cam.position.x; const z = cam.position.z;
    for (let i = 0; i < 3; i++) {
      const o = followers[i]; const me = o.matrix.elements;
      me[12] = x; me[14] = z;
      o.matrixWorld.elements[12] = x; o.matrixWorld.elements[14] = z;
    }
  }

  /** Track positions (metres) of the start / finish gates. */
  function setGates(list) {
    const a = gates.instanceMatrix.array;
    let n = 0;
    for (const d of list) {
      if (n >= 2) continue;
      WM[0] = 0; WM[1] = 0; WM[2] = -d; WM[3] = 1; WM[4] = 0; WM[5] = 0; writeM(a, n);
      banners[n].position.set(0, 6.9, -d + 0.4); banners[n].visible = true; n++;
    }
    for (let i = n; i < 2; i++) banners[i].visible = false;
    gates.count = n;
    gates.instanceMatrix.needsUpdate = true;
  }
  /** Forget built chunks (the track changed). */
  function reset() {
    for (const p of pool) { p.ci = null; p.mesh.visible = false; p.used = 0; }
    byChunk.clear();
  }

  function setPalette(P2) {
    // Rebuilding everything is simplest; palette changes are rare (theme switch).
    scene.background.fromArray(P2.bg);
    scene.fog.color.fromArray(P2.fog);
    for (const p of pool) { p.ci = null; p.mesh.visible = false; }
    byChunk.clear();
  }

  return {
    scene, mat, matInst, matInstC, avatarMat, avatarMats, fade, U, T, P,
    ensure, syncView, setShadows, follow, setPalette, setGates, reset, setMood,
    chunkCount: () => byChunk.size,
    stats,
    /** Everything that can be drawn, for shader warm-up. */
    warmList: () => [coins, lows, highs, blocks, gates, shadows, street, skyline, dome, ...Object.values(items), mtrains[0], pool[0].mesh, ...banners],
    dispose() {
      for (const d of disposables) { try { d.dispose(); } catch { /* ignore */ } }
      for (const m of [coins, lows, highs, blocks, gates, ...Object.values(items)]) { try { m.dispose(); } catch { /* ignore */ } }
      try { shadows.dispose(); } catch { /* ignore */ }
      scene.clear();
    },
  };
}

/** Scenery-only chunk behind the start line (seen in the lobby). */
function behindChunk(ci) {
  return { i: ci, z0: ci * CHUNK, z1: (ci + 1) * CHUNK, obs: [], gaps: [], coins: [], items: [], tunnel: null, path: [], scen: 777 + ci };
}

const hexOf = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');

// ── builders (all coordinates: x, y, track distance d; world z = -d) ──
function bx(b, T, x0, y0, d0, x1, y1, d1, rgb, fx, ol, ink) {
  b.add(T.box, (x0 + x1) / 2, (y0 + y1) / 2, -(d0 + d1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(d1 - d0), 0, rgb, fx, ol, ink);
}
/** Quad facing the runner (+z) centred at (x, y, d). */
function qz(b, T, x, y, d, w, h, rgb, fx) { b.add(T.quad, x, y, -d, w, h, 1, 0, rgb, fx, 0, rgb); }
/** Quad facing ±x (side = +1 faces +x) centred at (x, y, d), `len` along the track. */
function qx(b, T, side, x, y, d, len, h, rgb, fx) { b.add(T.quad, x, y, -d, len, h, 1, side * Math.PI / 2, rgb, fx, 0, rgb); }
/** Quad facing up centred at (x, y, d). */
function qu(b, T, x, y, d, w, len, rgb) { b.add(T.quadUp, x, y, -d, w, 1, len, 0, rgb, FX_PLAIN, 0, rgb); }

/** Diagonal stripes across a front face (local coords, z = face plane). */
function stripes(b, T, x0, y0, x1, y1, z, rgb, n) {
  const w = (x1 - x0) / n;
  const h = y1 - y0;
  for (let i = 0; i < n; i++) b.add(T.stripe, x0 + (i + 0.5) * w, (y0 + y1) / 2, z, w * 0.95, h, 1, 0, rgb, FX_PLAIN, 0, rgb);
}

/** Intervals of [d0, d1] not covered by gaps that include lane l. */
function openSpans(c, l, d0, d1, out) {
  out.length = 0;
  const bit = 1 << (l + 1);
  let cur = d0;
  const gs = c.gaps.filter((g) => g.mask & bit).sort((a, b) => a.z0 - b.z0);
  for (const g of gs) {
    if (g.z0 > cur) out.push([cur, Math.min(g.z0, d1)]);
    cur = Math.max(cur, g.z1);
  }
  if (cur < d1) out.push([cur, d1]);
  return out;
}

/** Train cars starting at d (front facing the runner), `n` cars. */
function trainCars(b, x, d, n, liv, oncoming, T, P) {
  const ink = P.outline;
  const under = mix(liv.body, [0.08, 0.08, 0.1], 0.6);
  const roof = mix(liv.body, P.white, 0.35);
  const door = mix(liv.body, P.ink, 0.25);
  const win = P.dark ? P.lit : P.glass;
  const wfx = P.dark ? FX_GLOW : FX_PLAIN;
  for (let k = 0; k < n; k++) {
    const a = d + k * CAR + (k ? 0.2 : 0);
    const e = d + (k + 1) * CAR - 0.25;
    bx(b, T, x - 1.15, 0.38, a, x + 1.15, ROOF - 0.06, e, liv.body, FX_PLAIN, OL, ink);
    bx(b, T, x - 1.02, ROOF - 0.08, a + 0.3, x + 1.02, ROOF, e - 0.3, roof, FX_PLAIN, 0.035, ink);
    bx(b, T, x - 0.95, 0.02, a + 0.6, x + 0.95, 0.42, e - 0.6, under, FX_PLAIN, 0, ink);
    for (const sd of [-1, 1]) {
      qx(b, T, sd, x + sd * 1.165, 0.95, (a + e) / 2, e - a - 0.2, 0.24, liv.stripe, FX_PLAIN);
      for (const u of [0.3, 0.7]) qx(b, T, sd, x + sd * 1.17, 1.35, a + (e - a) * u, 1.2, 1.9, door, FX_PLAIN);
      for (let wd = a + 1.3; wd < e - 1.0; wd += 2.1) {
        const u = (wd - a) / (e - a);
        if (Math.abs(u - 0.3) < 0.09 || Math.abs(u - 0.7) < 0.09) continue;
        qx(b, T, sd, x + sd * 1.172, 1.85, wd, 1.35, 0.72, win, wfx);
      }
    }
    if (k > 0) bx(b, T, x - 0.35, 0.7, a - 0.5, x + 0.35, 1.3, a + 0.1, under, FX_PLAIN, 0, ink);
    bx(b, T, x - 0.52, ROOF - 0.02, a + 2.4, x + 0.52, ROOF + 0.24, a + 4.8, mix(roof, P.ink, 0.14), FX_PLAIN, 0.025, ink); // roof unit
    qu(b, T, x, 0.004, (a + e) / 2, 2.7, e - a + 0.5, [0.1, 0.09, 0.12]);
  }
  // cab face (toward the runner, at the low-d end): two windscreen "eyes" with glints and a
  // destination board. Parked trains doze (half-lidded); the oncoming one glares (ink brows).
  const glass = P.dark ? mix(P.glass, P.lit, 0.3) : P.glass;
  for (let sxi = -1; sxi <= 1; sxi += 2) {
    const ex = x + sxi * 0.44;
    qz(b, T, ex, 1.8, d - 0.01, 0.72, 0.78, glass, FX_PLAIN);
    qz(b, T, ex - 0.17, oncoming ? 1.98 : 1.86, d - 0.025, 0.15, 0.12, P.white, FX_GLOW);
    if (oncoming) b.add(sxi < 0 ? T.stripeL : T.stripe, ex + sxi * 0.02, 2.3, -(d - 0.03), 0.86, 0.2, 1, 0, ink, FX_PLAIN, 0, ink);
    else {
      qz(b, T, ex, 2.07, d - 0.02, 0.74, 0.26, door, FX_PLAIN);
      qz(b, T, ex, 1.93, d - 0.03, 0.74, 0.05, ink, FX_PLAIN);
    }
  }
  bx(b, T, x - 0.62, 2.43, d - 0.05, x + 0.62, 2.66, d + 0.05, oncoming ? P.bad : P.hl, FX_GLOW, 0.02, ink);
  for (let i = 0; i < 4; i++) qz(b, T, x - 0.39 + i * 0.26, 2.545, d - 0.06, 0.16, 0.08, P.ink, FX_PLAIN);
  bx(b, T, x - 0.9, 0.62, d - 0.06, x - 0.55, 0.88, d + 0.1, oncoming ? P.lit : P.white, FX_GLOW, 0.025, ink);
  bx(b, T, x + 0.55, 0.62, d - 0.06, x + 0.9, 0.88, d + 0.1, oncoming ? P.lit : P.white, FX_GLOW, 0.025, ink);
  bx(b, T, x - 1.0, 0.3, d - 0.1, x + 1.0, 0.5, d + 0.2, mix(liv.stripe, P.ink, 0.2), FX_PLAIN, 0.03, ink);
  stripes(b, T, x - 1.0, 0.3, x + 1.0, 0.5, -(d - 0.11), P.ink, 6);
  if (oncoming) bx(b, T, x - 0.3, ROOF, d + 0.6, x + 0.3, ROOF + 0.25, d + 1.2, P.bad, FX_GLOW, 0.03, ink);
}

/** Windows on a facade. Facing ±x (side) along d, or facing +z across x. */
function windows(b, T, r, P, facing, fixed, a0, a1, y0, y1, pat) {
  const night = P.dark;
  const lit = P.lit; const glass = P.glass;
  const put = (u, v, w, h) => {
    const on = night && r() < 0.42;
    const col = on ? lit : glass;
    const fx = on ? FX_GLOW : FX_PLAIN;
    if (facing === 0) qz(b, T, u, v, fixed, w, h, col, fx);
    else qx(b, T, facing, fixed, v, u, w, h, col, fx);
  };
  const span = a1 - a0;
  if (span < 2.5 || y1 - y0 < 2) return;
  if (pat === 0) {
    for (let y = y0 + 1.1; y < y1 - 0.7; y += 3.2) put((a0 + a1) / 2, y, span - 1.2, 1.25);
  } else if (pat === 1) {
    const n = Math.max(1, Math.floor((span - 0.8) / 2.4));
    const st = (span - 0.8) / n;
    for (let i = 0; i < n; i++) put(a0 + 0.4 + (i + 0.5) * st, (y0 + 0.6 + y1 - 0.9) / 2, 0.95, y1 - y0 - 1.5);
  } else {
    const n = Math.max(1, Math.floor((span - 0.8) / 2.4));
    const st = (span - 0.8) / n;
    for (let y = y0 + 1.2; y < y1 - 0.8; y += 3.2) for (let i = 0; i < n; i++) put(a0 + 0.4 + (i + 0.5) * st, y, 1.15, 1.45);
  }
}

function buildChunk(b, c, T, P) {
  const ink = P.outline;
  const d0 = c.z0; const d1 = c.z1;
  const spans = [];
  const r = rng(c.scen);
  const tun = c.tunnel;

  // deck, bed, sleepers, rails per lane
  for (let l = -1; l <= 1; l++) {
    openSpans(c, l, d0, d1, spans);
    const xl = l === -1 ? -SIDE_X : l * LANE_W - LANE_W / 2;
    const xr = l === 1 ? SIDE_X : l * LANE_W + LANE_W / 2;
    for (const [a, e] of spans) {
      bx(b, T, xl, -1.5, a, xr, -0.12, e, P.deck, FX_PLAIN, 0, ink);
      bx(b, T, l * LANE_W - 1.18, -0.12, a, l * LANE_W + 1.18, -0.03, e, P.bed, FX_PLAIN, 0, ink);
      for (let d = Math.ceil(a / 0.9) * 0.9 + 0.2; d < e - 0.2; d += 0.9) qu(b, T, l * LANE_W, -0.02, d, 2.05, 0.34, P.sleeper);
      for (const sx of [-0.72, 0.72]) bx(b, T, l * LANE_W + sx - 0.06, -0.03, a, l * LANE_W + sx + 0.06, 0.1, e, P.rail, FX_PLAIN, 0, ink);
    }
    // broken-bridge edges and hazard stripes
    for (const g of c.gaps) {
      if (!(g.mask & (1 << (l + 1)))) continue;
      if (g.z0 > d0 + 1) {
        for (let k = 0; k < 4; k++) qu(b, T, l * LANE_W - 0.86 + k * 0.57, 0.0, g.z0 - 0.75, 0.29, 0.9, P.hl);
        bx(b, T, xl + 0.2, -1.9, g.z0 - 0.5, xr - 0.2, -1.5, g.z0, P.deck, FX_PLAIN, 0.04, ink);
      }
    }
  }
  // bridge railings along lanes that stay while their neighbours drop away
  for (const g of c.gaps) {
    if (g.mask === 7) continue;
    for (let l = -1; l <= 1; l++) {
      if (g.mask & (1 << (l + 1))) continue;
      for (const side of [-1, 1]) {
        const nb = l + side;
        if (nb < -1 || nb > 1 || !(g.mask & (1 << (nb + 1)))) continue;
        const xr = l * LANE_W + side * 1.25;
        bx(b, T, xr - 0.05, 0.85, g.z0, xr + 0.05, 0.95, g.z1, P.pole, FX_PLAIN, 0.025, ink);
        for (let d = g.z0; d <= g.z1; d += 2) bx(b, T, xr - 0.05, -0.03, d - 0.05, xr + 0.05, 0.9, d + 0.05, P.pole, FX_PLAIN, 0, ink);
      }
    }
  }
  // parapets
  for (const side of [-1, 1]) {
    openSpans(c, side, d0, d1, spans);
    for (const [a, e] of spans) bx(b, T, side * SIDE_X - 0.16, -0.12, a, side * SIDE_X + 0.16, 0.8, e, P.parapet, FX_PLAIN, 0.04, ink);
  }
  // signal masts every 50 m, alternating sides, one lamp lit (red / yellow / green)
  for (let d = Math.ceil((d0 - 20) / 50) * 50 + 20; d < d1; d += 50) {
    if (d < d0 + 1) continue;
    const side = Math.floor(d / 50) % 2 ? 1 : -1;
    let onGap = false;
    for (let gi = 0; gi < c.gaps.length; gi++) { const g = c.gaps[gi]; if ((g.mask & (1 << (side + 1))) && d > g.z0 - 1 && d < g.z1 + 1) onGap = true; }
    if (onGap) continue;
    const sx = side * 3.98;
    const head = P.shadeInk;
    bx(b, T, sx - 0.06, -0.12, d - 0.06, sx + 0.06, 2.3, d + 0.06, P.pole, FX_PLAIN, 0.025, ink);
    bx(b, T, sx - 0.21, 2.2, d - 0.15, sx + 0.21, 3.18, d + 0.15, head, FX_PLAIN, 0.035, ink);
    const on = Math.floor(r() * 3);
    const lamps = [P.bad, P.hl, P.good];
    for (let k = 0; k < 3; k++) {
      qz(b, T, sx, 2.94 - k * 0.27, d - 0.16, 0.2, 0.2, k === on ? mix(lamps[k], P.white, 0.2) : mix(lamps[k], head, 0.7), k === on ? FX_GLOW : FX_PLAIN);
      qz(b, T, sx, 3.06 - k * 0.27, d - 0.2, 0.3, 0.05, head, FX_PLAIN); // hood
    }
  }
  // viaduct piers (seen through gaps and past the edge)
  for (let d = Math.ceil(d0 / 25) * 25; d < d1; d += 25) {
    for (const px of [-2.6, 2.6]) bx(b, T, px - 0.7, -8, d - 0.7, px + 0.7, -1.5, d + 0.7, mix(P.deck, P.ink, 0.12), FX_PLAIN, 0.06, ink);
  }

  if (tun) {
    const [t0, t1] = tun;
    const wall = P.tunnel;
    for (const side of [-1, 1]) {
      bx(b, T, side * 4.7 - 0.25, -0.12, t0, side * 4.7 + 0.25, 6.2, t1, wall, FX_PLAIN, 0, ink);
      for (let d = t0 + 4; d < t1; d += 9) qx(b, T, -side, side * 4.44, 4.85, d, 1.4, 0.3, P.lit, FX_GLOW);
    }
    bx(b, T, -4.95, 6.2, t0, 4.95, 6.8, t1, mix(wall, P.ink, 0.15), FX_PLAIN, 0, ink);
    bx(b, T, -16, 6.8, t0 + 1, 16, 8.4, t1 - 1, mix(P.card, P.good, 0.42), FX_PLAIN, 0.08, ink);
    for (const pd of [t0, t1]) {
      const f = pd === t0 ? -1 : 1;
      bx(b, T, -12, 6.0, pd - 0.5 * f - 0.5, 12, 11.5, pd - 0.5 * f + 0.5, P.portal, FX_PLAIN, 0.08, ink);
      for (const side of [-1, 1]) bx(b, T, side * 5.0, -0.12, pd - 0.6, side * 7.5, 6.0, pd + 0.6, P.portal, FX_PLAIN, 0.07, ink);
      bx(b, T, -5.1, 6.0, pd - 0.65, 5.1, 6.6, pd + 0.65, mix(P.portal, P.ink, 0.25), FX_PLAIN, 0.05, ink);
      if (pd === t0) for (let i = 0; i < 8; i++) qz(b, T, -4.2 + i * 1.2, 6.3, pd - 0.66, 0.6, 0.3, i % 2 ? P.hl : P.ink, FX_PLAIN);
    }
  } else {
    // catenary gantries every 25 m
    for (let d = Math.floor(d0 / 25) * 25 + 12.5; d < d1; d += 25) {
      if (d < d0) continue;
      for (const side of [-1, 1]) {
        bx(b, T, side * 4.62 - 0.13, -0.12, d - 0.13, side * 4.62 + 0.13, 6.5, d + 0.13, P.pole, FX_PLAIN, 0.035, ink);
        bx(b, T, side * 4.45 - 0.1, 5.85, d - 0.1, side * 4.45 + 0.1, 6.05, d + 0.1, P.lit, FX_GLOW, 0, ink);
      }
      bx(b, T, -4.85, 6.3, d - 0.11, 4.85, 6.55, d + 0.11, P.pole, FX_PLAIN, 0.035, ink);
    }
  }

  // parked trains and ramps
  for (const o of c.obs) {
    if (o.t === O_TRAIN) trainCars(b, o.lane * LANE_W, o.z0, o.cars, P.trains[o.liv % 4], false, T, P);
    else if (o.t === O_RAMP) {
      b.add(T.wedge, o.lane * LANE_W, ROOF / 2, -(o.z0 + o.z1) / 2, 2.2, ROOF, o.z1 - o.z0, 0, mix(P.card, P.hl, 0.55), FX_PLAIN, OL, ink);
      for (const sx of [-1.12, 1.12]) bx(b, T, o.lane * LANE_W + sx - 0.05, 0, o.z0, o.lane * LANE_W + sx + 0.05, 0.12, o.z1, P.pole, FX_PLAIN, 0, ink);
      // chevrons on the slope
      for (let k = 1; k < 5; k++) qz(b, T, o.lane * LANE_W, ROOF * (k / 5) - 0.02, o.z0 + (o.z1 - o.z0) * (k / 5) - 0.02, 1.6, 0.12, P.ink, FX_PLAIN);
    }
  }

  // buildings (deterministic per chunk)
  for (const side of [-1, 1]) {
    let d = d0 + r() * 3;
    while (d < d1) {
      const w = 8 + Math.floor(r() * 10);
      const de = Math.min(d + w, d1);
      if (de - d > 3) {
        const inner = 7.2 + r() * 1.2;
        const depth = 7 + r() * 6;
        const h = tun && d < tun[1] && de > tun[0] ? 2 + r() * 6 : 4 + Math.floor(r() * 7) * 3.2;
        const col = P.buildings[Math.floor(r() * P.buildings.length)];
        const x0 = side * inner; const x1 = side * (inner + depth);
        const xa = Math.min(x0, x1); const xb = Math.max(x0, x1);
        bx(b, T, xa, -8, d + 0.4, xb, h, de - 0.4, col, FX_PLAIN, 0.09, ink);
        const cap = mix(col, P.ink, 0.18);
        bx(b, T, xa - 0.2, h, d + 0.2, xb + 0.2, h + 0.45, de - 0.2, cap, FX_PLAIN, 0.06, ink);
        const pat = h > 20 ? (r() < 0.5 ? 0 : 1) : Math.floor(r() * 3);
        windows(b, T, r, P, -side, x0 - side * 0.02, d + 1.0, de - 1.0, -4.2, h, pat);
        windows(b, T, r, P, 0, d + 0.38, xa + 0.4, xb - 0.4, -4.2, h, pat);
        // shop band + awning facing the track
        const sb = mix(col, P.ink, 0.3);
        bx(b, T, x0 - side * 0.15, -8, d + 0.6, x0 + side * 0.4, -4.6, de - 0.6, sb, FX_PLAIN, 0, ink);
        if (r() < 0.6) {
          const aw = [P.a, P.b, P.hl, P.good][Math.floor(r() * 4)];
          bx(b, T, x0 - side * 1.3, -4.7, d + 1, x0, -4.3, de - 1, aw, FX_PLAIN, 0.05, ink);
          for (let k = d + 1.5; k < de - 1.2; k += 1.6) qx(b, T, -side, x0 - side * 1.31, -4.5, k, 0.8, 0.4, P.white, FX_PLAIN);
        }
        const q = r();
        const xm = (x0 + x1) / 2;
        if (q < 0.28) {
          b.add(T.cyl6, xm, h + 2.2, -(d + de) / 2, 2.4, 2.2, 2.4, 0, mix(P.card, P.ink, 0.3), FX_PLAIN, 0.06, ink);
          for (const ox of [-0.8, 0.8]) bx(b, T, xm + ox - 0.08, h + 0.45, (d + de) / 2 - 0.08, xm + ox + 0.08, h + 1.1, (d + de) / 2 + 0.08, P.pole, FX_PLAIN, 0, ink);
        } else if (q < 0.5) {
          bx(b, T, xm - 1.2, h + 0.45, d + 1.5, xm + 1.2, h + 1.6, d + 3.5, mix(P.card, P.ink, 0.15), FX_PLAIN, 0.05, ink);
        } else if (q < 0.64 && h < 22) {
          // billboard facing the track
          const bc = r() < 0.5 ? P.a : P.b;
          const zz = (d + de) / 2;
          bx(b, T, x0 + side * 0.5 - 0.3, h + 0.45, zz - 3.2, x0 + side * 0.5 + 0.3, h + 4.6, zz + 3.2, bc, FX_PLAIN, 0.07, ink);
          qx(b, T, -side, x0 + side * 0.18, h + 2.6, zz, 3.6, 1.6, P.white, FX_GLOW);
          qx(b, T, -side, x0 + side * 0.17, h + 2.6, zz, 2.2, 0.35, bc, FX_PLAIN);
        }
      }
      d = de + 1 + r() * 4;
    }
    // back row: taller, simpler
    let e = d0 + r() * 8;
    while (e < d1) {
      const w = 12 + Math.floor(r() * 14);
      const ee = Math.min(e + w, d1);
      if (ee - e > 4) {
        const inner = 22 + r() * 6;
        const h = 16 + Math.floor(r() * 10) * 3.2;
        const col = mix(P.buildings[Math.floor(r() * P.buildings.length)], P.bg, 0.25);
        const xa = side > 0 ? inner : -inner - 14; const xb = side > 0 ? inner + 14 : -inner;
        bx(b, T, xa, -8, e, xb, h, ee, col, FX_PLAIN, 0.12, ink);
        windows(b, T, r, P, -side, side > 0 ? xa - 0.02 : xb + 0.02, e + 1, ee - 1, -2, h, 0);
      }
      e = ee + 2 + r() * 6;
    }
  }
}

function buildSkyline(b, T, P) {
  // Two rings of flat, unlit silhouettes around the camera (they follow it, so they sit at
  // infinity): a pale far ring and a darker, more detailed near ring. Shapes vary: setback towers,
  // spires, domes, water towers, antennas and one needle tower; day has misregistered Riso clouds,
  // night has stars, a moon and lit windows.
  const r = rng(424242);
  const ink = P.outline;
  const ring = (n, rad0, rad1, h0, h1, cols, detail) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.06;
      const rad = rad0 + r() * (rad1 - rad0);
      const w = 14 + r() * 22;
      const h = h0 + r() * (h1 - h0);
      const col = cols[Math.floor(r() * cols.length)];
      const cx = Math.sin(a) * rad; const cz = -Math.cos(a) * rad;
      const kind = r();
      const y0 = -8;
      const ry = -a; // local x along the ring, local z toward the camera
      if (kind < 0.42) {
        // setback tower: two or three tiers, maybe an antenna
        b.add(T.box, cx, y0 + h / 2, cz, w, h, w * 0.8, ry, col, FX_SKY, 0, ink);
        const h2 = h * (0.18 + r() * 0.2);
        b.add(T.box, cx, y0 + h + h2 / 2, cz, w * 0.66, h2, w * 0.55, ry, col, FX_SKY, 0, ink);
        if (r() < 0.5) { const h3 = h2 * 0.8; b.add(T.box, cx, y0 + h + h2 + h3 / 2, cz, w * 0.36, h3, w * 0.32, ry, col, FX_SKY, 0, ink); }
        if (detail && r() < 0.6) b.add(T.box, cx, y0 + h + h2 + 9, cz, 0.7, 18, 0.7, ry, col, FX_SKY, 0, ink);
      } else if (kind < 0.6) {
        // spire
        b.add(T.box, cx, y0 + h / 2, cz, w * 0.7, h, w * 0.7, ry, col, FX_SKY, 0, ink);
        b.add(T.cone, cx, y0 + h + w * 0.5, cz, w * 0.7, w, w * 0.7, ry + 0.4, col, FX_SKY, 0, ink);
      } else if (kind < 0.74) {
        // domed hall
        const hh = h * 0.45;
        b.add(T.box, cx, y0 + hh / 2, cz, w * 1.3, hh, w, ry, col, FX_SKY, 0, ink);
        b.add(T.ico, cx, y0 + hh, cz, w * 0.8, w * 0.62, w * 0.8, ry, col, FX_SKY, 0, ink);
      } else {
        // plain block with a water tower or a billboard frame on the roof
        b.add(T.box, cx, y0 + h / 2, cz, w, h, w, ry, col, FX_SKY, 0, ink);
        if (detail && r() < 0.6) {
          b.add(T.cyl6, cx + w * 0.2, y0 + h + 4.2, cz, 4, 4, 4, 0, col, FX_SKY, 0, ink);
          b.add(T.cone, cx + w * 0.2, y0 + h + 7.2, cz, 4.6, 2.2, 4.6, 0, col, FX_SKY, 0, ink);
          b.add(T.box, cx + w * 0.2, y0 + h + 1.1, cz, 3, 2.2, 3, 0, col, FX_SKY, 0, ink);
        }
      }
      if (P.dark && detail) {
        // a few lit windows: tiny glowing squares on the side facing the track
        const nx = Math.sin(a); const nz = -Math.cos(a);
        const lit = mix(P.lit, P.bg, 0.25);
        for (let k = 0; k < 5; k++) {
          if (r() < 0.45) continue;
          const u = (r() - 0.5) * w * 0.7; const v = y0 + 4 + r() * (h - 6);
          b.add(T.box, cx - nx * (w * 0.42) + Math.cos(a) * u, v, cz - nz * (w * 0.42) + Math.sin(a) * u, 1.6, 1.3, 1.6, ry, lit, FX_SKY, 0, ink);
        }
      }
    }
  };
  ring(64, 262, 296, 22, 70, P.skyline, false);
  ring(40, 188, 222, 18, 52, P.skyNear, true);
  // one needle tower, ahead and to the right of the start
  {
    const cx = 74; const cz = -228; const col = P.skyNear[1];
    b.add(T.cyl6, cx, 30, cz, 3.2, 76, 3.2, 0, col, FX_SKY, 0, ink);
    b.add(T.cone, cx, 2, cz, 16, 22, 16, 0, col, FX_SKY, 0, ink);
    b.add(T.disc, cx, 70, cz, 14, 5, 14, 0, col, FX_SKY, 0, ink);
    b.add(T.disc, cx, 74, cz, 9, 3, 9, 0, mix(col, P.hl, 0.35), FX_SKY, 0, ink);
    b.add(T.box, cx, 88, cz, 0.8, 24, 0.8, 0, col, FX_SKY, 0, ink);
  }
  if (!P.dark) {
    // sun: ink rim, yellow disc, a paler halo ring
    b.add(T.discZ, -46, 68, -302, 58, 58, 1, 0, mix(P.hl, P.bg, 0.55), FX_SKY, 0, ink);
    b.add(T.discZ, -46, 68, -301, 44, 44, 1, 0, mix(P.hl, P.ink, 0.25), FX_SKY, 0, ink);
    b.add(T.discZ, -46, 68, -300, 41, 41, 1, 0, P.hl, FX_SKY, 0, ink);
    // clouds: flat white puffs printed slightly off-register over a pink copy
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3 + r() * 0.4;
      const rad = 205 + r() * 30;
      const cx = Math.sin(a) * rad; const cz = -Math.cos(a) * rad; const cy = 48 + r() * 34;
      const s = 7 + r() * 6;
      const puffs = [[0, 0, 1.6], [-1.3, -0.2, 1.1], [1.3, -0.25, 1.2], [0.6, 0.55, 1.0], [-0.6, 0.45, 0.9]];
      for (const [layer, col, ox, oy] of [[0, mix(P.bg, P.b, 0.42), 1.1, -0.9], [1, P.white, 0, 0]]) {
        for (const [px, py, ps] of puffs) {
          const lx = (px * s + ox) * Math.cos(a); const lz = (px * s + ox) * Math.sin(a);
          b.add(T.ico, cx + lx - Math.sin(a) * layer * 0.8, cy + py * s + oy, cz + lz + Math.cos(a) * layer * 0.8, ps * s, ps * s * 0.62, ps * s * 0.3, -a, col, FX_SKY, 0, ink);
        }
      }
    }
  } else {
    // moon with craters, and stars
    b.add(T.discZ, -52, 74, -302, 40, 40, 1, 0, mix(P.card, P.white, 0.75), FX_SKY, 0, ink);
    for (const [ox, oy, rr] of [[-7, 5, 8], [8, -6, 6], [4, 10, 4], [-4, -10, 5]]) b.add(T.discZ, -52 + ox, 74 + oy, -301, rr, rr, 1, 0, mix(P.card, P.white, 0.45), FX_SKY, 0, ink);
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2; const el = 0.2 + r() * 0.75;
      const rad = 330;
      const s = 0.9 + r() * 1.6;
      b.add(T.octa, Math.sin(a) * Math.cos(el) * rad, Math.sin(el) * rad * 0.8, -Math.cos(a) * Math.cos(el) * rad, s, s * 1.6, s, a, mix(P.white, P.hl, r() * 0.5), FX_SKY, 0, ink);
    }
  }
}
