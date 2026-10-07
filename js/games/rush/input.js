// Rail Rush input: swipes recognised mid-move (not on release), a "Buttons" scheme (tap left /
// right thirds + on-screen jump / roll), and keyboards (one player, or two on one computer).
import { A_LEFT, A_RIGHT, A_UP, A_DOWN } from './sim.js';

export const A_USE = 5;
const SWIPE_PX = 20;
const FLICK_PX = 12;
const FLICK_V = 0.55; // px/ms
const EDGE_PX = 20;

const KEYS_ONE = {
  ArrowLeft: A_LEFT, KeyA: A_LEFT, ArrowRight: A_RIGHT, KeyD: A_RIGHT,
  ArrowUp: A_UP, KeyW: A_UP, Space: A_UP, ArrowDown: A_DOWN, KeyS: A_DOWN,
  KeyE: A_USE, ShiftLeft: A_USE, ShiftRight: A_USE, Enter: A_USE,
};
const KEYS_A = { KeyA: A_LEFT, KeyD: A_RIGHT, KeyW: A_UP, KeyS: A_DOWN, KeyE: A_USE, KeyQ: A_USE };
const KEYS_B = { ArrowLeft: A_LEFT, ArrowRight: A_RIGHT, ArrowUp: A_UP, ArrowDown: A_DOWN, Enter: A_USE, Slash: A_USE, ShiftRight: A_USE, NumpadEnter: A_USE };

/**
 * surface: element receiving touches (the canvas layer). opts:
 *  onAction(who, action), who (live: my id), split (two keyboard players),
 *  scheme() -> 'swipe' | 'buttons', enabled() -> bool, onAny() (first interaction: unlock audio),
 *  onPress(who) (every touch / click on the surface, before any swipe is recognised)
 */
export function createInput(surface, opts) {
  const ptrs = new Map();
  const offs = [];
  const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); offs.push(() => el.removeEventListener(ev, fn, o)); };
  const fire = (who, a) => { if (opts.enabled()) opts.onAction(who, a); };
  const stats = { swipes: 0, ignored: 0, last: 0 };

  // Keep the host page / sheet from scrolling, bouncing or zooming.
  const stop = (e) => { if (e.cancelable) e.preventDefault(); };
  on(surface, 'touchstart', stop, { passive: false });
  on(surface, 'touchmove', stop, { passive: false });
  on(surface, 'gesturestart', stop, { passive: false });
  on(surface, 'contextmenu', stop);

  on(surface, 'pointerdown', (e) => {
    opts.onAny && opts.onAny();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.clientX < EDGE_PX) { stats.ignored++; return; } // iOS back-swipe zone
    const who = opts.who;
    if (opts.onPress && opts.enabled()) opts.onPress(who); // any touch (e.g. a cheer while you're down)
    if (opts.scheme() === 'buttons' && e.pointerType !== 'mouse') {
      const r = surface.getBoundingClientRect();
      const u = (e.clientX - r.left) / Math.max(1, r.width);
      if (u < 1 / 3) fire(who, A_LEFT); else if (u > 2 / 3) fire(who, A_RIGHT);
      return;
    }
    ptrs.set(e.pointerId, { ax: e.clientX, ay: e.clientY, at: e.timeStamp || performance.now(), fired: 0, last: 0 });
    try { surface.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  on(surface, 'pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.ax; const dy = e.clientY - p.ay;
    const ad = Math.max(Math.abs(dx), Math.abs(dy));
    const dt = Math.max(1, (e.timeStamp || performance.now()) - p.at);
    const need = ad / dt > FLICK_V ? FLICK_PX : SWIPE_PX;
    if (ad < need) return;
    const a = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? A_LEFT : A_RIGHT) : (dy < 0 ? A_UP : A_DOWN);
    // one swipe per direction per touch; a clear change of direction fires again without lifting
    if (p.fired && (a === p.last || ad < need * 1.2)) { p.ax = e.clientX; p.ay = e.clientY; p.at = e.timeStamp || performance.now(); return; }
    p.fired++; p.last = a; p.ax = e.clientX; p.ay = e.clientY; p.at = e.timeStamp || performance.now();
    stats.swipes++; stats.last = a;
    fire(opts.who, a);
  });
  const end = (e) => { ptrs.delete(e.pointerId); };
  on(surface, 'pointerup', end);
  on(surface, 'pointercancel', end);

  on(window, 'keydown', (e) => {
    if (!opts.enabled() || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    let who = null; let a = 0;
    if (opts.split) {
      if (KEYS_A[e.code]) { who = 'a'; a = KEYS_A[e.code]; } else if (KEYS_B[e.code]) { who = 'b'; a = KEYS_B[e.code]; }
    } else if (KEYS_ONE[e.code]) { who = opts.who; a = KEYS_ONE[e.code]; }
    if (!a) return;
    opts.onAny && opts.onAny();
    e.preventDefault();
    fire(who, a);
  });

  return {
    stats,
    destroy() { offs.forEach((f) => f()); ptrs.clear(); },
  };
}
