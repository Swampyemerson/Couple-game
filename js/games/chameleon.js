// TEMP viewer (being built)
import { registerGame } from './core.js';
import { buildMap } from './chameleon/maps.js';
import { makeGradient, makeWorldMaterial, makeBlobMaterial } from './chameleon/toon.js';

registerGame({
  id: 'chameleon', title: 'Blend & Seek', kind: 'live', tags: ['silly', '3d'],
  mount(el, api) {
    el.innerHTML = '<div style="position:absolute;inset:0"></div>';
    const host = el.firstChild;
    let raf = 0; let renderer = null;
    api.three().then((THREE) => {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      const W = host.clientWidth; const H = host.clientHeight;
      renderer.setSize(W, H);
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#f4f2ee');
      scene.fog = new THREE.Fog('#f4f2ee', 14, 34);
      const cam = new THREE.PerspectiveCamera(55, W / H, 0.05, 80);
      const id = window.__mapId || 'living';
      const t0 = performance.now();
      const map = buildMap(THREE, id);
      const t1 = performance.now();
      const tex = new THREE.CanvasTexture(map.atlas.canvas);
      tex.anisotropy = 4;
      const grad = makeGradient(THREE);
      const mat = makeWorldMaterial(THREE, { map: tex, gradientMap: grad, ink: '#1d1b22' });
      const mesh = new THREE.Mesh(map.geometry, mat);
      scene.add(mesh);
      if (map.blobGeo) scene.add(new THREE.Mesh(map.blobGeo, makeBlobMaterial(THREE)));
      const hemi = new THREE.HemisphereLight('#fffaf0', '#c9b9a6', 0.62);
      const dir = new THREE.DirectionalLight('#fff1dc', 0.62); dir.position.set(-3, 8, 5);
      scene.add(hemi, dir);
      window.__view = { info: { verts: map.vertexCount, ms: t1 - t0, colliders: map.colliders.length, blobs: map.blobs.length }, setCam(x, y, z, tx, ty, tz) { cam.position.set(x, y, z); cam.lookAt(tx, ty, tz); renderer.render(scene, cam); return renderer.info.render; } };
      cam.position.set(0, 7, 9); cam.lookAt(0, 0.5, 0);
      renderer.render(scene, cam);
    }).catch((e) => { el.textContent = 'fail ' + e.message; });
    return { destroy() { cancelAnimationFrame(raf); if (renderer) renderer.dispose(); } };
  },
});
