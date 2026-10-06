// Getaway input. Keyboard: one player (WASD / arrows, Space handbrake, Shift nitro, E action,
// M map, C camera, B look back) or two halves for split screen. Touch: a floating steering
// slider on the left (starts where your thumb lands; drag ± 72 px for full lock), pedals and
// buttons on the right, true multi-touch; optional tilt steering. Touches starting within 20 px
// of the left edge are ignored (iOS back gesture). No allocations per frame.
import { CAR } from './tune.js';

export function newPad() {
  return { kL: 0, kR: 0, kU: 0, kD: 0, hand: 0, nitro: 0, look: 0, touchSteer: 0, touchOn: 0, tilt: 0, tiltOn: 0, gasT: 0, brakeT: 0, handT: 0, nitroT: 0, steer: 0, gas: 0, brake: 0, auto: null };
}

/** Resolve a pad into the car input (steer slews for keys, analog for touch/tilt). */
export function readPad(p, out, dt) {
  if (p.auto) { out.steer = p.auto.steer; out.gas = p.auto.gas; out.brake = p.auto.brake; out.hand = p.auto.hand; out.nitro = p.auto.nitro; return out; }
  let target = 0;
  if (p.touchOn) target = p.touchSteer;
  else if (p.tiltOn) target = p.tilt;
  else target = p.kR - p.kL;
  if (p.touchOn || p.tiltOn) p.steer = target;
  else {
    const rate = CAR.steerRate * (target === 0 || Math.sign(target) !== Math.sign(p.steer) ? 1.6 : 1);
    p.steer += Math.max(-rate * dt, Math.min(rate * dt, target - p.steer));
  }
  out.steer = p.steer;
  out.gas = Math.max(p.kU, p.gasT);
  out.brake = Math.max(p.kD, p.brakeT);
  out.hand = !!(p.hand || p.handT);
  out.nitro = !!(p.nitro || p.nitroT);
  return out;
}

const SINGLE = {
  KeyW: ['U'], ArrowUp: ['U'], KeyS: ['D'], ArrowDown: ['D'], KeyA: ['L'], ArrowLeft: ['L'], KeyD: ['R'], ArrowRight: ['R'],
  Space: ['hand'], ShiftLeft: ['nitro'], ShiftRight: ['nitro'], KeyB: ['look'],
};
const SPLIT = {
  a: { KeyW: 'U', KeyS: 'D', KeyA: 'L', KeyD: 'R', Space: 'hand', ShiftLeft: 'nitro', KeyQ: 'look' },
  b: { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', ShiftRight: 'hand', Enter: 'nitro', Period: 'look' },
};
const SPLIT_ACT = { a: { KeyE: 'act', KeyM: 'map', KeyC: 'cam' }, b: { Slash: 'act', Comma: 'map', Backslash: 'cam' } };
const SINGLE_ACT = { KeyE: 'act', KeyF: 'act', KeyM: 'map', KeyC: 'cam', Escape: 'esc' };

/** Keyboard. pads: { a, b } (live/practice uses pads[me]). onAct(w, name). */
export function createKeys({ split, me, pads, onAct, enabled }) {
  const set = (pad, k, v) => {
    if (k === 'U') pad.kU = v; else if (k === 'D') pad.kD = v; else if (k === 'L') pad.kL = v; else if (k === 'R') pad.kR = v;
    else if (k === 'hand') pad.hand = v; else if (k === 'nitro') pad.nitro = v; else if (k === 'look') pad.look = v;
  };
  const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
  function key(e, down) {
    if (typing(e) || !enabled()) return;
    let used = false;
    if (split) {
      for (const w of ['a', 'b']) {
        const k = SPLIT[w][e.code]; if (k) { set(pads[w], k, down ? 1 : 0); used = true; }
        const a = SPLIT_ACT[w][e.code]; if (a && down && !e.repeat) { onAct(w, a); used = true; }
      }
      if (e.code === 'Escape' && down) { onAct(null, 'esc'); used = true; }
    } else {
      const k = SINGLE[e.code]; if (k) { set(pads[me], k[0], down ? 1 : 0); used = true; }
      const a = SINGLE_ACT[e.code]; if (a && down && !e.repeat) { onAct(me, a); used = true; }
    }
    if (used && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault();
  }
  const kd = (e) => key(e, true); const ku = (e) => key(e, false);
  const blur = () => { for (const p of Object.values(pads)) { p.kL = p.kR = p.kU = p.kD = p.hand = p.nitro = p.look = 0; } };
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('blur', blur);
  return { destroy() { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur); }, release: blur };
}

/**
 * Touch controls over `surface` (the play area) and the pedal buttons (elements with
 * data-pad="gas|brake|hand|nitro" and data-tap="act|map|cam|look"). steerEl shows the slider.
 */
export function createTouch({ surface, root, pad, onAct, enabled, steerEl, stats }) {
  const ptrs = new Map(); // pointerId → { kind: 'steer'|'pad', key, x0 }
  const RANGE = 72;
  const counts = { gas: 0, brake: 0, hand: 0, nitro: 0 };
  const apply = () => { pad.gasT = counts.gas > 0 ? 1 : 0; pad.brakeT = counts.brake > 0 ? 1 : 0; pad.handT = counts.hand > 0 ? 1 : 0; pad.nitroT = counts.nitro > 0 ? 1 : 0; };
  function steerFrom(p, x) {
    let s = (x - p.x0) / RANGE;
    s = Math.max(-1, Math.min(1, s));
    const a = Math.abs(s); s = a < 0.06 ? 0 : Math.sign(s) * Math.pow((a - 0.06) / 0.94, 1.25);
    pad.touchSteer = s;
    if (steerEl) steerEl.style.setProperty('--k', String(s));
  }
  function down(e) {
    if (!enabled()) return;
    const t = e.target.closest ? e.target.closest('[data-pad],[data-tap]') : null;
    if (t && root.contains(t)) {
      e.preventDefault();
      if (t.dataset.tap) { onAct(t.dataset.tap); t.classList.add('press'); setTimeout(() => t.classList.remove('press'), 140); return; }
      const k = t.dataset.pad;
      ptrs.set(e.pointerId, { kind: 'pad', key: k, el: t });
      counts[k] = (counts[k] || 0) + 1; t.classList.add('press'); apply();
      try { t.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
    if (e.target !== surface && !surface.contains(e.target)) return;
    if (e.pointerType === 'mouse') return; // laptops steer with keys
    const r = surface.getBoundingClientRect();
    if (e.clientX - r.left < 20) { if (stats) stats.ignored++; return; } // iOS back gesture
    if (e.clientX - r.left > r.width * 0.55) return;
    e.preventDefault();
    const p = { kind: 'steer', x0: e.clientX };
    ptrs.set(e.pointerId, p);
    pad.touchOn = 1; pad.touchSteer = 0;
    if (steerEl) { steerEl.style.left = `${e.clientX - r.left}px`; steerEl.style.top = `${e.clientY - r.top}px`; steerEl.classList.add('on'); steerEl.style.setProperty('--k', '0'); }
    try { surface.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function move(e) {
    const p = ptrs.get(e.pointerId); if (!p) return;
    e.preventDefault();
    if (p.kind === 'steer') steerFrom(p, e.clientX);
  }
  function up(e) {
    const p = ptrs.get(e.pointerId); if (!p) return;
    ptrs.delete(e.pointerId);
    if (p.kind === 'steer') {
      let still = false; for (const q of ptrs.values()) if (q.kind === 'steer') still = true;
      if (!still) { pad.touchOn = 0; pad.touchSteer = 0; if (steerEl) steerEl.classList.remove('on'); }
    } else { counts[p.key] = Math.max(0, counts[p.key] - 1); if (!counts[p.key]) p.el.classList.remove('press'); apply(); }
  }
  // Only cancel touches on the driving surface and the pedals: cancelling a touchstart on iOS
  // suppresses the click, which would make every lobby/menu button dead on a phone.
  const tPrevent = (e) => {
    const t = e.target;
    const drive = t === surface || surface.contains(t) || (t.closest && t.closest('[data-pad],[data-tap]'));
    if (drive && e.cancelable) e.preventDefault();
  };
  root.addEventListener('pointerdown', down, { passive: false });
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  root.addEventListener('touchstart', tPrevent, { passive: false });
  root.addEventListener('touchmove', tPrevent, { passive: false });
  return {
    reset() { ptrs.clear(); for (const k in counts) counts[k] = 0; apply(); pad.touchOn = 0; pad.touchSteer = 0; root.querySelectorAll('.press').forEach((x) => x.classList.remove('press')); if (steerEl) steerEl.classList.remove('on'); },
    destroy() {
      root.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      root.removeEventListener('touchstart', tPrevent); root.removeEventListener('touchmove', tPrevent);
    },
  };
}

/** Tilt steering (device orientation). Must be enabled from a tap (iOS permission prompt). */
export function createTilt(pad) {
  let on = false; let zero = 0;
  function handler(e) {
    if (!on) return;
    const landscape = (screen.orientation && /landscape/.test(screen.orientation.type)) || Math.abs(window.orientation || 0) === 90;
    let a;
    if (landscape) { a = e.beta || 0; if ((screen.orientation && screen.orientation.angle === 270) || window.orientation === -90) a = -a; }
    else a = e.gamma || 0;
    pad.tilt = Math.max(-1, Math.min(1, (a - zero) / 24));
  }
  return {
    async enable() {
      try {
        const DOE = window.DeviceOrientationEvent;
        if (!DOE) return 'unsupported';
        if (typeof DOE.requestPermission === 'function') {
          const r = await DOE.requestPermission();
          if (r !== 'granted') return 'denied';
        }
        window.addEventListener('deviceorientation', handler);
        on = true; pad.tiltOn = 1; return 'ok';
      } catch { return 'denied'; }
    },
    disable() { on = false; pad.tiltOn = 0; pad.tilt = 0; window.removeEventListener('deviceorientation', handler); },
    get on() { return on; },
  };
}
