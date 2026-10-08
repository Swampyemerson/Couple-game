// Renderer, scene, lights, map meshes, avatars and picking for Blend & Seek.
// Owns every GPU resource and disposes them all in dispose().
import { buildMap, mapCached, releaseMapGPU } from './maps.js';
import { makeGradient, makeWorldMaterial, makeBlobMaterial } from './toon.js';
import { createKit, createAvatar } from './avatar.js';
import { createPaint } from './paint.js';
import { createFx } from './fx.js';
import { createWorld } from './world.js';
import { sampleAtlas } from './atlas.js';
import { hexToRgb, luminance, clamp } from './util.js';

// collision worlds of cached maps (a world is stateless apart from scratch buffers)
const worlds = new WeakMap();
const idle = (fn) => { if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 3000 }); else setTimeout(fn, 400); };

// ── rematch: one parked stage (maps pass) ──
// The hub's Rematch destroys the game and mounts a fresh one. The stage (renderer, compiled
// programs, uploaded map, paint textures) is parked across that remount instead of disposed,
// so the new mount links no programs and builds nothing; unclaimed, it is disposed after `ms`.
let parked = null; let parkTimer = 0;
function dropParked(st) { if (parked === st) parked = null; clearTimeout(parkTimer); st.dispose(); if (st.onParkDispose) st.onParkDispose(); }
export function parkStage(st, onDispose, ms = 8000) {
  if (parked && parked !== st) dropParked(parked);
  st.park(); st.onParkDispose = onDispose; parked = st;
  clearTimeout(parkTimer);
  parkTimer = setTimeout(() => { if (parked === st) dropParked(st); }, ms);
}
/** The parked stage if it fits this mount (same three.js, same pixel-ratio cap), else null. */
export function takeParkedStage(THREE, maxDpr) {
  const st = parked; if (!st) return null;
  parked = null; clearTimeout(parkTimer);
  if (st.THREE !== THREE || st.maxDpr !== maxDpr) { dropParked(st); return null; }
  return st;
}

export function createStage(THREE, host, { theme, maxDpr = 2 }) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, depth: true, preserveDrawingBuffer: false });
  const baseDpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  let dynScale = 1;
  renderer.setPixelRatio(baseDpr);
  renderer.outputEncoding = THREE.LinearEncoding;
  renderer.info.autoReset = true;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', 'Game view');
  host.prepend(canvas);

  const scene = new THREE.Scene();
  const bg = new THREE.Color(theme.bg);
  scene.background = bg;
  scene.fog = new THREE.Fog(bg.getHex(), 13, 30);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.03, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  // kept just under 1.0 total on lit faces so colours never clip (clipping would make painted
  // skin read brighter than the surface it copies). The ground colour is a warm, light bounce so
  // ceilings and undersides (which only get the darkest toon step of the sun) don't go muddy;
  // bodies share these lights and the ramp, so a stamp still matches what the seeker sees.
  const hemi = new THREE.HemisphereLight(0xfffaf0, 0xefe3d0, 0.56);
  const sun = new THREE.DirectionalLight(0xfff1dc, 0.52);
  sun.position.set(-3.2, 8, 4.6);
  scene.add(hemi, sun, sun.target);

  const gradientMap = makeGradient(THREE);
  const kit = createKit(THREE);
  const paints = { a: createPaint(THREE, kit), b: createPaint(THREE, kit) };
  const av = {
    a: createAvatar(THREE, kit, { gradientMap, texture: paints.a.texture }),
    b: createAvatar(THREE, kit, { gradientMap, texture: paints.b.texture }),
  };
  for (const w of ['a', 'b']) { scene.add(av[w].root); scene.add(av[w].blob); }
  const fx = createFx(THREE, scene, { gradientMap });

  // viewmodel: a little paint popper in the corner of the first-person view
  const vm = new THREE.Group();
  const vmMat = new THREE.MeshToonMaterial({ gradientMap, color: 0xffffff });
  const vmInk = new THREE.MeshToonMaterial({ gradientMap, color: 0x2a2730 });
  const vmBody = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.24, 14), vmMat);
  vmBody.rotation.x = Math.PI / 2;
  const vmTank = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), vmMat);
  vmTank.position.set(0, 0.06, 0.05);
  const vmNozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.06, 10), vmInk);
  vmNozzle.rotation.x = Math.PI / 2; vmNozzle.position.z = -0.14;
  vm.add(vmBody, vmTank, vmNozzle);
  vm.position.set(0.2, -0.16, -0.42);
  vm.scale.setScalar(0.5);
  vm.rotation.y = 0.12;
  vm.visible = false;
  camera.add(vm);

  let map = null; let mapMesh = null; let atlasTex = null; let world = null;
  const mapMeshes = []; // one per chunk (frustum culled individually); mapMesh = mapMeshes[0]
  const backMeshes = []; let backdropReach = 0; let fogCull = Infinity;
  const cullV = new THREE.Vector3();
  const inkCol = theme.outline;
  const isMap = (o) => !!o && o.userData.isMap === true;

  // Maps pass: the map materials live as long as the stage (one per kind, the atlas texture
  // swapped on load), so a switch links no program: disposing the old world material used to
  // release its program and the new one relinked it, and CU's fog-free backdrop material
  // linked a 15th program on every CU switch (~155 ms). A 1×1 placeholder keeps USE_MAP on,
  // and hidden one-triangle meshes put all three into the boot compile.
  const placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  placeholder.needsUpdate = true;
  const worldMat = makeWorldMaterial(THREE, { map: placeholder, gradientMap, ink: inkCol });
  const backMat = makeWorldMaterial(THREE, { map: placeholder, gradientMap, ink: inkCol }); backMat.fog = false;
  const blobMat = makeBlobMaterial(THREE, '#3a2a1c');
  const warmGeo = new THREE.BufferGeometry();
  for (const [k, n] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3], ['tile', 4], ['onrm', 3], ['alpha', 1]]) warmGeo.setAttribute(k, new THREE.Float32BufferAttribute(new Float32Array(n * 3), n));
  const warmMeshes = [worldMat, backMat, blobMat].map((mt) => { const m = new THREE.Mesh(warmGeo, mt); m.visible = false; m.frustumCulled = false; m.userData.warm = true; scene.add(m); return m; });
  const blobMesh = new THREE.Mesh(warmGeo, blobMat);
  blobMesh.matrixAutoUpdate = false; blobMesh.renderOrder = 1; blobMesh.visible = false; blobMesh.frustumCulled = false;
  scene.add(blobMesh);
  // per built map (while the session cache keeps it): its atlas texture and chunk meshes
  const mapRes = new Map();
  function resFor(m) {
    let r = mapRes.get(m);
    if (r) return r;
    const tex = new THREE.CanvasTexture(m.atlas.canvas);
    tex.anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    r = { tex, meshes: [], backs: [], reach: 0 };
    for (const ch of m.chunks) {
      if (ch.backdrop) {
        // far scenery: the same look without fog, always drawn, never picked
        const bm = new THREE.Mesh(ch.geometry, backMat);
        bm.matrixAutoUpdate = false; bm.updateMatrix(); bm.frustumCulled = false;
        bm.userData.backdrop = true;
        r.backs.push(bm);
        const bs = ch.geometry.boundingSphere; r.reach = Math.max(r.reach, bs.center.length() + bs.radius);
        continue;
      }
      const cm = new THREE.Mesh(ch.geometry, worldMat);
      cm.matrixAutoUpdate = false; cm.updateMatrix();
      cm.userData.isMap = true; cm.userData.chunk = ch;
      r.meshes.push(cm);
    }
    mapRes.set(m, r);
    return r;
  }
  /** Drop GPU resources of maps the session cache let go of (their geometry is already disposed). */
  function pruneRes() { for (const [m, r] of mapRes) if (m !== map && !mapCached(m)) { r.tex.dispose(); mapRes.delete(m); } }

  function loadMap(id) {
    if (map && map.id === id) return map;
    unloadMap();
    const ink = hexToRgb(inkCol).map((x) => x / 255);
    map = buildMap(THREE, id, { ink });
    pruneRes();
    const r = resFor(map);
    atlasTex = r.tex;
    for (const mt of [worldMat, backMat]) { mt.map = atlasTex; mt.userData.uniforms.uAtlas.value = map.atlas.size; }
    for (const m of r.meshes) { m.userData.forceHidden = false; scene.add(m); mapMeshes.push(m); }
    for (const m of r.backs) { scene.add(m); backMeshes.push(m); }
    backdropReach = r.reach;
    mapMesh = mapMeshes[0];
    // draw distance: big maps fog out (and cull) beyond a room or two while playing; the
    // overview orbit pulls the fog back so the whole map reads from up high (see setView)
    viewKind = '';
    setView('play');
    blobMesh.geometry = map.blobGeo || warmGeo; blobMesh.visible = !!map.blobGeo;
    world = worlds.get(map);
    if (!world) { world = createWorld(map); worlds.set(map, world); }
    // the eyedropper's CPU copy of the atlas: read when the main thread is idle, not in the switch
    if (!map.atlas.hasData) idle(() => { if (map && !map.atlas.hasData) map.atlas.warm(); });
    return map;
  }
  let viewKind = '';
  /** 'play' (fog 11–26 m on big maps) or 'overview' (fog scaled to the map's footprint). */
  function setView(kind) {
    if (!map || kind === viewKind) return;
    viewKind = kind;
    let near; let far;
    if (kind === 'overview') {
      const inf = map.info || {}; const ov = map.overview;
      const diag = Math.hypot(inf.w || 12, inf.d || 10);
      near = Math.max(13, ov.radius * 0.9); far = Math.max(30, ov.radius + diag * 0.75 + ov.y * 0.5);
    } else { near = map.big ? 11 : 13; far = map.big ? 26 : 30; }
    scene.fog.near = near; scene.fog.far = far;
    // chunks past the fog are skipped by cullChunks(); the far plane only has to reach the backdrop
    fogCull = far + 2;
    camera.far = Math.max(far + 6, backdropReach + 10); camera.updateProjectionMatrix();
  }
  /** Per frame: hide map chunks entirely inside the fog (cheap: one sphere test per chunk), and
   *  count the ones the camera actually draws (fog + frustum) for perf(). A chunk a test hid
   *  with tweak({ hideMap }) stays hidden (userData.forceHidden). */
  let chunksDrawn = 0;
  const frustum = new THREE.Frustum(); const projScreen = new THREE.Matrix4();
  function cullChunks() {
    const cp = camera.position;
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    let n = 0;
    for (let i = 0; i < mapMeshes.length; i++) {
      const m = mapMeshes[i]; const bs = m.geometry.boundingSphere;
      const v = !m.userData.forceHidden && cullV.copy(bs.center).distanceTo(cp) - bs.radius < fogCull;
      m.visible = v;
      if (v && frustum.intersectsSphere(bs)) n++;
    }
    chunksDrawn = n;
  }
  /** Build a map into the session cache and put its atlas on the GPU without showing it (the
   *  recap does this for Mix it up's next round, so the round's title is a scene swap). */
  function prefetch(id) {
    const ink = hexToRgb(inkCol).map((x) => x / 255);
    const m = buildMap(THREE, id, { ink });
    if (map) buildMap(THREE, map.id, { ink }); // the map on screen stays the most recent in the LRU
    const r = resFor(m);
    try { renderer.initTexture(r.tex); } catch { /* uploads at first draw instead */ }
    if (!worlds.has(m)) worlds.set(m, createWorld(m));
    pruneRes();
    return m;
  }
  /** Take the map out of the scene; its geometry, texture and world stay for the session cache. */
  function unloadMap() {
    if (!map) return;
    for (const m of mapMeshes) scene.remove(m);
    for (const m of backMeshes) scene.remove(m);
    mapMeshes.length = 0; backMeshes.length = 0;
    blobMesh.geometry = warmGeo; blobMesh.visible = false;
    map = null; mapMesh = null; atlasTex = null; world = null;
  }

  // ── picking ──
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hits = [];
  const pickList = [];
  function setRayFromScreen(x, y, w, h) { ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1); ray.setFromCamera(ndc, camera); return ray; }
  /** Nearest hit among the map (front faces only) and the given avatar meshes. */
  function pick(objects, far = 60) {
    ray.far = far;
    hits.length = 0;
    pickList.length = 0;
    for (const o of objects) {
      if (o === mapMesh) { for (const m of mapMeshes) pickList.push(m); continue; } // "the map" = every chunk
      pickList.push(o);
    }
    if (map) for (const ch of map.chunks) ch.geometry.setDrawRange(0, ch.mainIndexCount); // outline hulls excluded
    ray.intersectObjects(pickList, false, hits);
    if (map) for (const ch of map.chunks) ch.geometry.setDrawRange(0, Infinity);
    return hits.length ? hits[0] : null;
  }
  function pickMap(far = 60) { return mapMesh ? pick([mapMesh], far) : null; }

  /** Blob-shadow coverage (0..1) at a world point (matches the blob shader). */
  /** blobAt over only the blob shadows near a point (stamp / blend scoring call it per texel:
   *  a big map has hundreds of blobs). Returns a shade function (x, y, z) → 0..1. */
  function nearBlobs(px, py, pz, reach = 1.6) {
    const L = [];
    if (map) for (const b of map.blobs) {
      const r = reach + Math.max(b.rx, b.rz) * 1.25;
      if (Math.abs(py - b.y) > reach || (b.x - px) * (b.x - px) + (b.z - pz) * (b.z - pz) > r * r) continue;
      L.push({ x: b.x, y: b.y, c: Math.cos(b.yaw), s: Math.sin(b.yaw), ru: b.rx * 1.25, rv: b.rz * 1.25, a: b.a, z: b.z });
    }
    const n = L.length;
    return (x, y, z) => {
      let a = 0;
      for (let i = 0; i < n; i++) {
        const b = L[i];
        if (Math.abs(y - b.y) > 0.04) continue;
        const dx = x - b.x; const dz = z - b.z;
        const u = (dx * b.c - dz * b.s) / b.ru; const v = (dx * b.s + dz * b.c) / b.rv;
        const d2 = (u * u + v * v) * 1.5625;
        if (d2 >= 1) continue;
        const t = clamp((Math.sqrt(d2) - 0.35) / 0.65, 0, 1);
        const k = (1 - t * t * (3 - 2 * t)) * b.a;
        a = 1 - (1 - a) * (1 - k);
      }
      return a;
    };
  }
  function blobAt(x, y, z) {
    if (!map) return 0;
    let a = 0;
    for (const b of map.blobs) {
      if (Math.abs(y - b.y) > 0.04) continue;
      const c = Math.cos(b.yaw); const s = Math.sin(b.yaw);
      const dx = x - b.x; const dz = z - b.z;
      const lx = dx * c - dz * s; const lz = dx * s + dz * c;
      const u = lx / (b.rx * 1.25); const v = lz / (b.rz * 1.25);
      const d = Math.hypot(u, v) * 1.25;
      if (d >= 1) continue;
      const t = clamp((d - 0.35) / 0.65, 0, 1);
      const k = (1 - t * t * (3 - 2 * t)) * b.a;
      a = 1 - (1 - a) * (1 - k);
    }
    return a;
  }
  const BLOB_RGB = hexToRgb('#3a2a1c');
  const tmp3 = [0, 0, 0];
  /** Albedo of the map at a ray hit: vertex colour × atlas texel, mixed with blob shadow. */
  function albedoAtHit(hit, out) {
    const g = hit.object.geometry;
    if (isMap(hit.object)) {
      const a = hit.face.a;
      const tile = g.attributes.tile; const col = g.attributes.color;
      const t = [tile.getX(a), tile.getY(a), tile.getZ(a), tile.getW(a)];
      sampleAtlas(map.atlas, t, hit.uv.x, hit.uv.y, tmp3);
      const sh = blobAt(hit.point.x, hit.point.y, hit.point.z);
      for (let k = 0; k < 3; k++) {
        const base = tmp3[k] * col.array[a * 3 + k];
        out[k] = Math.round(base * (1 - sh) + BLOB_RGB[k] * sh);
      }
      return out;
    }
    for (const w of ['a', 'b']) {
      if (av[w].meshes.includes(hit.object)) return paints[w].colorAtUV(hit.uv.x, hit.uv.y, out);
    }
    if (hit.object.isInstancedMesh && hit.object.instanceColor && hit.instanceId != null) {
      const c = hit.object.instanceColor.array; const i = hit.instanceId * 3;
      out[0] = Math.round(c[i] * 255); out[1] = Math.round(c[i + 1] * 255); out[2] = Math.round(c[i + 2] * 255);
      return out;
    }
    const m = hit.object.material;
    out[0] = Math.round(m.color.r * 255); out[1] = Math.round(m.color.g * 255); out[2] = Math.round(m.color.b * 255);
    return out;
  }

  /** Describe the surface plane of a map hit for the stamp tool. */
  function surfaceOf(hit) {
    if (!hit || !isMap(hit.object)) return null;
    const g = hit.object.geometry;
    const P = g.attributes.position; const U = g.attributes.uv; const T = g.attributes.tile; const C = g.attributes.color;
    const ia = hit.face.a; const ib = hit.face.b; const ic = hit.face.c;
    const p0 = [P.getX(ia), P.getY(ia), P.getZ(ia)]; const p1 = [P.getX(ib), P.getY(ib), P.getZ(ib)]; const p2 = [P.getX(ic), P.getY(ic), P.getZ(ic)];
    const t0 = [U.getX(ia), U.getY(ia)]; const t1 = [U.getX(ib), U.getY(ib)]; const t2 = [U.getX(ic), U.getY(ic)];
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]; const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const d00 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2]; const d01 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]; const d11 = e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2];
    const den = d00 * d11 - d01 * d01 || 1e-9;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    return {
      q: [hit.point.x, hit.point.y, hit.point.z],
      n: [n.x, n.y, n.z],
      tile: [T.getX(ia), T.getY(ia), T.getZ(ia), T.getW(ia)],
      vc: [C.getX(ia), C.getY(ia), C.getZ(ia)],
      atlas: map.atlas,
      uvAt(x, y, z, out) {
        const vx = x - p0[0]; const vy = y - p0[1]; const vz = z - p0[2];
        const d20 = vx * e1[0] + vy * e1[1] + vz * e1[2]; const d21 = vx * e2[0] + vy * e2[1] + vz * e2[2];
        const s = (d11 * d20 - d01 * d21) / den; const t = (d00 * d21 - d01 * d20) / den;
        out[0] = t0[0] + s * (t1[0] - t0[0]) + t * (t2[0] - t0[0]);
        out[1] = t0[1] + s * (t1[1] - t0[1]) + t * (t2[1] - t0[1]);
      },
      shadeAt: nearBlobs(hit.point.x, hit.point.y, hit.point.z),
      blobRgb: BLOB_RGB,
    };
  }

  // ── sizing + dynamic resolution ──
  let W = 1; let H = 1;
  function resize() {
    const r = host.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    // keep at least ~66° horizontally in portrait without going fisheye
    const vf = 2 * Math.atan(Math.tan((66 * Math.PI) / 360) / camera.aspect) * (180 / Math.PI);
    camera.fov = clamp(vf, 58, 84);
    camera.updateProjectionMatrix();
  }
  function setScale(s) {
    s = clamp(s, 0.6, 1);
    if (Math.abs(s - dynScale) < 0.01) return;
    dynScale = s;
    renderer.setPixelRatio(baseDpr * dynScale);
    renderer.setSize(W, H, false);
  }

  function setTheme(t) {
    bg.set(t.bg);
    scene.fog.color.set(t.bg);
  }

  function compile() {
    // make everything visible once so every program is built up front
    const vis = [];
    scene.traverse((o) => { if (!o.visible) { vis.push(o); o.visible = true; } });
    renderer.compile(scene, camera);
    vis.forEach((o) => { o.visible = false; });
  }
  /**
   * Boot warm-up in slices (the maps pass; KHR_parallel_shader_compile-style, as Getaway's): the
   * programs of one material at a time through renderer.compile over a view of the scene that
   * lists just that object (same fog and lights, so the cache keys match the real render's),
   * yielding a frame whenever a slice ran past `budget` ms, so the loading card keeps painting
   * instead of one 15-program block. Returns { slices, maxMs }.
   */
  async function warm(yieldFrame, { budget = 24, alive = () => true, sync = true } = {}) {
    const gl = renderer.getContext();
    const objs = []; const seen = new Set();
    scene.traverse((o) => { const m = o.material; if (!m || Array.isArray(m) || seen.has(m)) return; seen.add(m); objs.push(o); });
    const view = Object.create(scene); const one = [null];
    view.traverse = (cb) => { for (const o of one) cb(o); };
    let t0 = performance.now(); let slices = 1; let maxMs = 0;
    const cut = async (last) => {
      const d = performance.now() - t0;
      if (d <= budget || last) return true;
      maxMs = Math.max(maxMs, d);
      await yieldFrame();
      t0 = performance.now(); slices++;
      return alive();
    };
    for (let i = 0; i < objs.length; i++) {
      one[0] = objs[i];
      renderer.compile(view, camera);
      if (!(await cut(false))) return null;
    }
    // first draws, one material per slice: drivers build a program's pipeline (and upload its
    // textures) at its first draw; drawing everything in the first frame was one 0.6–0.9 s
    // block in software GL. Everything else hidden, 3 vertices, no frustum cull.
    const vis = []; scene.traverse((o) => { if (o !== scene && !o.isLight) vis.push(o, o.visible); }); // lights stay: they are in the program key
    for (let i = 0; i < vis.length; i += 2) vis[i].visible = false;
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i]; const chain = [];
      for (let p = o; p && p !== scene; p = p.parent) { chain.push(p); p.visible = true; }
      const fc = o.frustumCulled; o.frustumCulled = false;
      const g = o.geometry; const dr = g && g.drawRange ? g.drawRange.count : null;
      if (dr != null) g.drawRange.count = 3;
      try { renderer.render(scene, camera); if (sync) gl.finish(); } finally {
        if (dr != null) g.drawRange.count = dr;
        o.frustumCulled = fc;
        for (const p of chain) p.visible = false;
      }
      if (!(await cut(i === objs.length - 1))) { for (let k = 0; k < vis.length; k += 2) vis[k].visible = vis[k + 1]; return null; }
    }
    for (let i = 0; i < vis.length; i += 2) vis[i].visible = vis[i + 1];
    maxMs = Math.max(maxMs, performance.now() - t0);
    return { slices, maxMs: Math.round(maxMs), materials: objs.length };
  }
  /** Rematch (maps pass): leave the canvas, keep the renderer, programs and uploaded maps. */
  function park() {
    canvas.remove();
    canvas.style.visibility = '';
    unloadMap();
    fx.clearRound();
    vm.visible = false;
  }
  /** A parked stage taken by the next mount: its canvas goes into the new host. */
  function adopt(newHost, t) {
    host = newHost;
    host.prepend(canvas);
    setTheme(t);
  }

  return {
    THREE, renderer, scene, camera, canvas, hemi, sun, kit, paints, av, fx, vm, gradientMap,
    get map() { return map; }, get world() { return world; }, get mapMesh() { return mapMesh; }, mapMeshes, isMap,
    get size() { return [W, H]; }, get dpr() { return baseDpr * dynScale; }, get scale() { return dynScale; },
    loadMap, unloadMap, prefetch, resize, setScale, setTheme, compile, warm, park, adopt, setView, maxDpr,
    ray, setRayFromScreen, pick, pickMap, albedoAtHit, surfaceOf, blobAt,
    render() { cullChunks(); renderer.render(scene, camera); },
    get backdrops() { return backMeshes.length; },
    /** Map chunks drawn last frame (after the fog cull and the frustum). */
    get chunksDrawn() { return chunksDrawn; },
    dispose() {
      unloadMap();
      for (const r of mapRes.values()) r.tex.dispose();
      mapRes.clear();
      releaseMapGPU(); // this renderer's buffers for every cached map (the CPU data stays cached)
      worldMat.dispose(); backMat.dispose(); blobMat.dispose(); placeholder.dispose(); warmGeo.dispose();
      for (const m of warmMeshes) scene.remove(m);
      scene.remove(blobMesh);
      fx.dispose();
      for (const w of ['a', 'b']) { scene.remove(av[w].root); scene.remove(av[w].blob); av[w].dispose(); paints[w].dispose(); }
      kit.dispose();
      gradientMap.dispose();
      vmBody.geometry.dispose(); vmTank.geometry.dispose(); vmNozzle.geometry.dispose(); vmMat.dispose(); vmInk.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch { /* ignore */ }
      canvas.remove();
    },
    luminance,
  };
}
