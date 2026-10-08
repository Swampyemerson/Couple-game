// Getaway renderer setup: picks the graphics quality tier for this device (low / mid / high),
// creates the WebGL renderer for it (MSAA, pixel-ratio cap, dynamic-resolution floor), and owns
// the real-time car shadow map (mid/high): an orthographic depth pass over a ~50 m square that
// follows the camera, rendered from the world's small `casters` scene (cars, wheels, the near
// traffic instances, falling props: layer SHADOW_LAYER) so the pass never walks the chunk groups.
// The toon shader samples it with a 2-tap (phones) or 4-tap rotated PCF. The map can be shrunk
// at run time (`setSize`): the dynamic-resolution controller's cheapest lever (game.js dynRes).
import { setGfxTier } from './gfx.js';

export const GFX_KEY = 'getaway.gfx.v1';
export const SHADOW_LAYER = 2;

/** Per-tier settings. dpr = device-pixel-ratio cap; minScale = dynamic-resolution floor. */
export const TIERS = {
  low: { dpr: 1.25, minScale: 0.75, msaa: true, shadow: 0, shadowR: 0, beams: false, glows: 64, lampGlows: 10, decals: true, smoke: 0.6, fogFar: 330, carNear: 26, carMid: 60 },
  // shadow: map size; shadowLow: the size dynRes drops to first; shadowTaps: PCF taps per lit pixel
  mid: { dpr: 1.5, minScale: 0.7, msaa: true, shadow: 512, shadowLow: 384, shadowR: 24, shadowTaps: 2, beams: true, glows: 128, lampGlows: 20, decals: true, smoke: 1 },
  high: { dpr: 1.5, minScale: 0.7, msaa: true, shadow: 1536, shadowLow: 768, shadowR: 34, shadowTaps: 4, beams: true, glows: 160, lampGlows: 28, decals: true, smoke: 1 },
};

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
/** The player's saved choice: 'auto' (default), 'low', 'mid' or 'high'. Applies on the next game open. */
export function gfxSetting() { const v = lsGet(GFX_KEY, null); return v && TIERS[v.tier] ? v.tier : 'auto'; }
export function setGfxSetting(tier) { try { localStorage.setItem(GFX_KEY, JSON.stringify({ tier: TIERS[tier] ? tier : 'auto' })); } catch { /* ignore */ } }

function glInfo(gl) {
  let name = '';
  try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch { /* ignore */ }
  const software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  return { name, software, webgl2 };
}

/**
 * Create the renderer. opts: { phoneish, coarse, tune }. tune.tier forces a tier; tune.maxDpr
 * (tests) disables the DPR cap logic. Returns { renderer, tier, cfg, info, dpr }.
 */
export function createRenderer(THREE, { phoneish = false, coarse = false, tune = {} } = {}) {
  const forced = TIERS[tune.tier] ? tune.tier : (gfxSetting() !== 'auto' ? gfxSetting() : null);
  const make = (aa) => new THREE.WebGLRenderer({ antialias: aa, powerPreference: 'high-performance', alpha: false, stencil: false, depth: true });
  let renderer = make(true);
  let info = glInfo(renderer.getContext());
  let tier = forced || (info.software || !info.webgl2 ? 'low' : phoneish || coarse ? 'mid' : 'high');
  // software GL (headless tests, broken drivers): MSAA there is slow and pointless
  if (info.software && !forced) {
    try { renderer.dispose(); renderer.forceContextLoss(); } catch { /* ignore */ }
    renderer = make(false); info = glInfo(renderer.getContext());
  }
  const cfg = { ...TIERS[tier] };
  if (info.software && !forced) cfg.msaa = false;
  setGfxTier(tier);
  const dev = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const dpr = Math.min(dev, cfg.dpr);
  renderer.userData = { tier, cfg, info };
  return { renderer, tier, cfg, info, dpr };
}

/** The car shadow map. Returns null on tiers without one. */
export function createShadow(THREE, U, cfg) {
  if (!cfg || !cfg.shadow) { U.uShadowP.value.x = 0; return null; }
  const full = cfg.shadow; const R = cfg.shadowR || 28; const taps = cfg.shadowTaps === 2 ? 0 : 1;
  const mkRT = (size) => { const rt = new THREE.WebGLRenderTarget(size, size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false, generateMipmaps: false }); rt.texture.generateMipmaps = false; return rt; };
  let size = full; let rt = mkRT(size);
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const cam = new THREE.OrthographicCamera(-R, R, R, -R, 1, 260);
  cam.layers.set(SHADOW_LAYER);
  const right = new THREE.Vector3(); const up = new THREE.Vector3(); const f = new THREE.Vector3(); const tmp = new THREE.Vector3();
  const oldClear = new THREE.Color(); const white = new THREE.Color(1, 1, 1);
  const vp = new THREE.Matrix4();
  U.uShadowMap.value = rt.texture; U.uShadowP.value.set(1, 1 / size, 0.82, taps);
  let enabled = true;
  return {
    rt, cam, R, full,
    get size() { return size; },
    set enabled(v) { enabled = !!v; U.uShadowP.value.x = enabled ? 1 : 0; },
    get enabled() { return enabled; },
    /** Re-make the map at `n` pixels square (dynRes: 'shadowLow' before the resolution drops). */
    setSize(n) {
      n = Math.max(128, Math.min(full, n | 0)); if (n === size) return;
      rt.dispose(); rt = mkRT(n); size = n; this.rt = rt;
      U.uShadowMap.value = rt.texture; U.uShadowP.value.y = 1 / size;
    },
    /** Render the casters (a scene holding only shadow casters) around `focus` (THREE.Vector3 on the ground) as lit from sunDir. */
    render(renderer, casters, sunDir, focus) {
      if (!enabled) return;
      // light-space basis; snap the focus to whole texels so the map doesn't shimmer as it slides
      f.copy(sunDir).normalize();
      right.set(0, 1, 0).cross(f); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize();
      up.copy(f).cross(right).normalize();
      const tx = (2 * R) / size;
      const a = Math.round(focus.dot(right) / tx) * tx - focus.dot(right);
      const b = Math.round(focus.dot(up) / tx) * tx - focus.dot(up);
      tmp.copy(focus).addScaledVector(right, a).addScaledVector(up, b);
      cam.position.copy(tmp).addScaledVector(f, 130);
      cam.up.copy(up); cam.lookAt(tmp); cam.updateMatrixWorld(true);
      vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      U.uShadowM.value.copy(vp);
      const prevRT = renderer.getRenderTarget();
      renderer.getClearColor(oldClear); const oldA = renderer.getClearAlpha();
      const prevOverride = casters.overrideMaterial; const prevFog = casters.fog;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(white, 1); renderer.clear(true, true, false);
      casters.overrideMaterial = depthMat; casters.fog = null;
      try { renderer.render(casters, cam); } finally {
        casters.overrideMaterial = prevOverride; casters.fog = prevFog;
        renderer.setRenderTarget(prevRT); renderer.setClearColor(oldClear, oldA);
      }
    },
    dispose() { rt.dispose(); depthMat.dispose(); U.uShadowMap.value = null; U.uShadowP.value.x = 0; },
  };
}

/**
 * GPU pacing for the map warm-up (game.js warmUp). A warm-up slice is a few ms of JS, but a
 * program's first draw makes the driver build its pipeline: 130–650 ms of GPU-side work in
 * SwiftShader. While the canvas is in the document, the next compositing step waits for that work
 * on the main thread (Chrome's software compositor reads the canvas back; WebKit's
 * prepareForDisplay is a synchronous call to its GPU process), so every heavy slice was one long
 * frozen task behind the loading card. While the solid loading card is up, the canvas is taken out
 * of the document instead (nothing composites it, the same drawing buffer gets the same pipelines),
 * and each slice ends on a fence that the warm-up polls between tasks (WebGL2), so the GPU finishes
 * one slice before the next is sent and nothing piles up for the first real frame. Without fences
 * (WebGL1), or after a slice whose fence hasn't signalled in 4 s, the canvas stays (or goes back)
 * in the page and the compositor's wait paces the slices as before.
 * detach/attach take an owner token: a newer warm-up takes over a detached canvas and an
 * overtaken one doesn't put it back under the newer one's feet.
 */
export function createGpuPacer(renderer) {
  const cv = renderer.domElement;
  let gl = null; try { gl = renderer.getContext(); } catch { /* ignore */ }
  let ok = !!gl && typeof gl.fenceSync === 'function' && typeof gl.getSyncParameter === 'function';
  let owner = null; let parent = null; let next = null; let gen = 0; let seen = false; // seen: a fence has signalled here
  if (cv.addEventListener) cv.addEventListener('webglcontextlost', () => { gen++; }, false);
  const tick = () => new Promise((r) => setTimeout(r, 4));
  const putBack = () => {
    owner = null;
    if (!cv.parentNode && parent) parent.insertBefore(cv, next && next.parentNode === parent ? next : null);
    parent = null; next = null;
  };
  return {
    renderer,
    get ok() { return ok; },
    get detached() { return !!owner; },
    get seen() { return seen; },
    /** Take the canvas out of the document for `tok` (false without working fences: stays put). */
    detach(tok) {
      if (!ok) return false;
      if (!owner) { if (!cv.parentNode) return false; parent = cv.parentNode; next = cv.nextSibling; parent.removeChild(cv); }
      owner = tok; return true;
    },
    /** Put it back where it was (only by its current owner). */
    attach(tok) { if (owner && owner === tok) putBack(); },
    /** A fence after everything sent so far (null when not pacing). */
    fence() {
      if (!ok || !owner) return null;
      try { const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); return s ? { s, gen } : null; } catch { return null; }
    },
    /** Resolves once the GPU is past fence `f`: polled every few ms between tasks, never waited on.
     *  After maxMs the canvas goes back for the rest of this warm-up (the compositor's wait paces
     *  it: a slow GPU, e.g. re-making everything after a context restore), and if no fence has ever
     *  signalled here, fences don't work: no pacing from then on. A context loss ends the wait (a
     *  fence from before a lost-and-restored context reads "unsignalled" forever in Chrome). */
    async drain(f, maxMs = 4000) {
      if (!f) return;
      const t0 = performance.now(); let done = false;
      try {
        while (performance.now() - t0 < maxMs) {
          if (f.gen !== gen || gl.isContextLost()) { done = true; break; }
          const v = gl.getSyncParameter(f.s, gl.SYNC_STATUS);
          if (v === gl.SIGNALED) { seen = true; done = true; break; }
          if (v == null) { done = true; break; }
          await tick();
        }
      } catch { /* ignore */ }
      try { gl.deleteSync(f.s); } catch { /* ignore */ }
      if (!done) { putBack(); if (!seen) ok = false; }
    },
  };
}

/** Put an object (and its children) on the shadow-caster layer as well as the normal one. */
export function castShadow(o) { if (o) o.traverse((c) => c.layers.enable(SHADOW_LAYER)); return o; }
