// Getaway renderer setup: picks the graphics quality tier for this device (low / mid / high),
// creates the WebGL renderer for it (MSAA, pixel-ratio cap, dynamic-resolution floor), and owns
// the real-time car shadow map (mid/high): an orthographic depth pass over a ~60 m square that
// follows the camera, with only the cars, wheels, traffic and falling props as casters (they sit
// on layer SHADOW_LAYER). The toon shader samples it with 4-tap PCF.
import { setGfxTier } from './gfx.js';

export const GFX_KEY = 'getaway.gfx.v1';
export const SHADOW_LAYER = 2;

/** Per-tier settings. dpr = device-pixel-ratio cap; minScale = dynamic-resolution floor. */
export const TIERS = {
  low: { dpr: 1.25, minScale: 0.75, msaa: true, shadow: 0, shadowR: 0, beams: false, glows: 64, lampGlows: 10, decals: true, smoke: 0.6, fogFar: 330, carNear: 26, carMid: 60 },
  mid: { dpr: 1.5, minScale: 0.7, msaa: true, shadow: 1024, shadowR: 26, beams: true, glows: 128, lampGlows: 20, decals: true, smoke: 1 },
  high: { dpr: 1.5, minScale: 0.7, msaa: true, shadow: 1536, shadowR: 34, beams: true, glows: 160, lampGlows: 28, decals: true, smoke: 1 },
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
  const size = cfg.shadow; const R = cfg.shadowR || 28;
  const rt = new THREE.WebGLRenderTarget(size, size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false, generateMipmaps: false });
  rt.texture.generateMipmaps = false;
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const cam = new THREE.OrthographicCamera(-R, R, R, -R, 1, 260);
  cam.layers.set(SHADOW_LAYER);
  const right = new THREE.Vector3(); const up = new THREE.Vector3(); const f = new THREE.Vector3(); const tmp = new THREE.Vector3();
  const oldClear = new THREE.Color(); const white = new THREE.Color(1, 1, 1);
  const vp = new THREE.Matrix4();
  U.uShadowMap.value = rt.texture; U.uShadowP.value.set(1, 1 / size, 0.82, 0);
  let enabled = true;
  return {
    rt, cam, size, R,
    set enabled(v) { enabled = !!v; U.uShadowP.value.x = enabled ? 1 : 0; },
    get enabled() { return enabled; },
    /** Render the casters around `focus` (THREE.Vector3 on the ground) as lit from sunDir. */
    render(renderer, scene, sunDir, focus) {
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
      const prevOverride = scene.overrideMaterial; const prevFog = scene.fog;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(white, 1); renderer.clear(true, true, false);
      scene.overrideMaterial = depthMat; scene.fog = null;
      try { renderer.render(scene, cam); } finally {
        scene.overrideMaterial = prevOverride; scene.fog = prevFog;
        renderer.setRenderTarget(prevRT); renderer.setClearColor(oldClear, oldA);
      }
    },
    dispose() { rt.dispose(); depthMat.dispose(); U.uShadowMap.value = null; U.uShadowP.value.x = 0; },
  };
}

/** Put an object (and its children) on the shadow-caster layer as well as the normal one. */
export function castShadow(o) { if (o) o.traverse((c) => c.layers.enable(SHADOW_LAYER)); return o; }
