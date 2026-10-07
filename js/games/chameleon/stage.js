// Renderer, scene, lights, map meshes, avatars and picking for Blend & Seek.
// Owns every GPU resource and disposes them all in dispose().
import { buildMap } from './maps.js';
import { makeGradient, makeWorldMaterial, makeBlobMaterial } from './toon.js';
import { createKit, createAvatar } from './avatar.js';
import { createPaint } from './paint.js';
import { createFx } from './fx.js';
import { createWorld } from './world.js';
import { sampleAtlas } from './atlas.js';
import { hexToRgb, luminance, clamp } from './util.js';

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

  let map = null; let mapMesh = null; let blobMesh = null; let atlasTex = null; let worldMat = null; let blobMat = null; let world = null;
  const mapMeshes = []; // one per chunk (frustum culled individually); mapMesh = mapMeshes[0]
  const backMeshes = []; let backMat = null; let backdropReach = 0; let fogCull = Infinity;
  const cullV = new THREE.Vector3();
  const inkCol = theme.outline;
  const isMap = (o) => !!o && o.userData.isMap === true;

  function loadMap(id) {
    if (map && map.id === id) return map;
    unloadMap();
    const ink = hexToRgb(inkCol).map((x) => x / 255);
    map = buildMap(THREE, id, { ink });
    atlasTex = new THREE.CanvasTexture(map.atlas.canvas);
    atlasTex.anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
    atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
    worldMat = makeWorldMaterial(THREE, { map: atlasTex, gradientMap, ink: inkCol, atlasSize: map.atlas.size });
    backdropReach = 0;
    for (const ch of map.chunks) {
      if (ch.backdrop) {
        // far scenery: the same look without fog, always drawn, never picked
        if (!backMat) { backMat = makeWorldMaterial(THREE, { map: atlasTex, gradientMap, ink: inkCol, atlasSize: map.atlas.size }); backMat.fog = false; }
        const m = new THREE.Mesh(ch.geometry, backMat);
        m.matrixAutoUpdate = false; m.updateMatrix(); m.frustumCulled = false;
        m.userData.backdrop = true;
        scene.add(m); backMeshes.push(m);
        const bs = ch.geometry.boundingSphere; backdropReach = Math.max(backdropReach, bs.center.length() + bs.radius);
        continue;
      }
      const m = new THREE.Mesh(ch.geometry, worldMat);
      m.matrixAutoUpdate = false; m.updateMatrix();
      m.userData.isMap = true; m.userData.chunk = ch;
      scene.add(m); mapMeshes.push(m);
    }
    mapMesh = mapMeshes[0];
    // draw distance: big maps fog out (and cull) beyond a room or two while playing; the
    // overview orbit pulls the fog back so the whole map reads from up high (see setView)
    viewKind = '';
    setView('play');
    if (map.blobGeo) {
      blobMat = makeBlobMaterial(THREE, '#3a2a1c');
      blobMesh = new THREE.Mesh(map.blobGeo, blobMat);
      blobMesh.matrixAutoUpdate = false; blobMesh.updateMatrix(); blobMesh.renderOrder = 1;
      scene.add(blobMesh);
    }
    world = createWorld(map);
    // map atlas CPU copy is kept for the eyedropper; the canvas itself can go once uploaded
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
  /** Per frame: hide map chunks entirely inside the fog (cheap: one sphere test per chunk). */
  function cullChunks() {
    const cp = camera.position;
    for (let i = 0; i < mapMeshes.length; i++) {
      const m = mapMeshes[i]; const bs = m.geometry.boundingSphere;
      m.visible = cullV.copy(bs.center).distanceTo(cp) - bs.radius < fogCull;
    }
  }
  function unloadMap() {
    if (!map) return;
    for (const m of mapMeshes) scene.remove(m);
    for (const m of backMeshes) scene.remove(m);
    mapMeshes.length = 0; backMeshes.length = 0;
    if (backMat) { backMat.dispose(); backMat = null; }
    if (blobMesh) scene.remove(blobMesh);
    for (const ch of map.chunks) ch.geometry.dispose();
    if (map.blobGeo) map.blobGeo.dispose();
    atlasTex.dispose(); worldMat.dispose(); if (blobMat) blobMat.dispose();
    map = null; mapMesh = null; blobMesh = null; atlasTex = null; worldMat = null; blobMat = null; world = null;
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

  return {
    THREE, renderer, scene, camera, canvas, hemi, sun, kit, paints, av, fx, vm, gradientMap,
    get map() { return map; }, get world() { return world; }, get mapMesh() { return mapMesh; }, mapMeshes, isMap,
    get size() { return [W, H]; }, get dpr() { return baseDpr * dynScale; }, get scale() { return dynScale; },
    loadMap, resize, setScale, setTheme, compile, setView,
    ray, setRayFromScreen, pick, pickMap, albedoAtHit, surfaceOf, blobAt,
    render() { cullChunks(); renderer.render(scene, camera); },
    get backdrops() { return backMeshes.length; },
    dispose() {
      unloadMap();
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
