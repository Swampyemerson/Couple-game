// Input: a floating joystick (left half) + drag-to-look (right half) on touch screens,
// W/A/S/D + mouse look (pointer lock, falling back to drag) on computers, and paint-mode
// gestures (one finger paints, off-body drags orbit, two fingers rotate + pinch zoom).
// Touches that start within 20 px of the left edge are ignored (iOS back gesture).
import { listeners } from './util.js';

const EDGE = 20;
const JOY_R = 52;
const TAP_SLOP = 9;

export function createControls({ surface, root, joyBase, joyKnob, onAction, paint, isActive }) {
  const L = listeners();
  const st = {
    mode: 'none', // none | move | look | paint
    moveX: 0, moveY: 0, // joystick or keys, forward = +y
    lookDX: 0, lookDY: 0, // pixels accumulated since the last frame
    jumpHeld: false,
    locked: false,
    lockFailed: false,
    usingMouse: matchMedia('(pointer: fine)').matches,
    lastInput: 'touch',
  };
  const keys = new Set();
  const ptrs = new Map(); // id -> { role, x0, y0, x, y, moved, button, t0 }
  let joyId = null;
  let pinch = null;
  let strokeId = null;

  function keyMove() {
    let x = 0; let y = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
    const l = Math.hypot(x, y);
    return l > 0 ? [x / l, y / l] : [0, 0];
  }

  function showJoy(on, x = 0, y = 0) {
    if (!joyBase) return;
    joyBase.classList.toggle('on', on);
    if (on) { joyBase.style.transform = `translate(${x - JOY_R}px, ${y - JOY_R}px)`; joyKnob.style.transform = 'translate(0px, 0px)'; }
    else { joyBase.style.transform = ''; joyKnob.style.transform = ''; }
  }

  function local(e) {
    const r = surface.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top, r.width, r.height];
  }

  function requestLock() {
    if (st.locked || st.lockFailed || !surface.requestPointerLock) return;
    try {
      const p = surface.requestPointerLock();
      if (p && p.catch) p.catch(() => { st.lockFailed = true; });
    } catch { st.lockFailed = true; }
  }

  // ── pointer events on the play surface ──
  L.on(surface, 'pointerdown', (e) => {
    if (!isActive()) return;
    const [x, y, w] = local(e);
    if (e.pointerType === 'touch' && e.clientX < EDGE) return; // iOS back-swipe zone
    st.lastInput = e.pointerType === 'mouse' ? 'mouse' : 'touch';
    if (e.pointerType === 'mouse') st.usingMouse = true;
    try { surface.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = { role: 'look', x0: x, y0: y, x, y, moved: false, button: e.button, t0: performance.now(), type: e.pointerType };
    ptrs.set(e.pointerId, p);
    if (st.mode === 'paint') {
      const touches = [...ptrs.values()].filter((q) => q.type !== 'mouse');
      if (e.pointerType !== 'mouse' && touches.length >= 2) {
        if (strokeId != null) { paint.cancel(); strokeId = null; }
        for (const q of ptrs.values()) q.role = 'pinch';
        const [a, b] = touches;
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        return;
      }
      if (e.button === 2) { p.role = 'orbit'; return; }
      if (paint.begin(x, y)) { p.role = 'stroke'; strokeId = e.pointerId; } else p.role = 'orbit-or-tap';
      return;
    }
    if (st.mode === 'move' && e.pointerType !== 'mouse' && x < w * 0.45 && joyId == null) {
      p.role = 'joy'; joyId = e.pointerId; showJoy(true, x, y);
      return;
    }
    if (e.pointerType === 'mouse' && (st.mode === 'move' || st.mode === 'look')) {
      if (st.locked) { if (e.button === 0) onAction('fire'); p.role = 'none'; return; }
      requestLock();
      p.role = 'mouse-look';
      return;
    }
    p.role = 'look';
  }, { passive: false });

  L.on(surface, 'pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (st.locked && e.pointerType === 'mouse') {
      if (st.mode === 'move' || st.mode === 'look') { st.lookDX += e.movementX || 0; st.lookDY += e.movementY || 0; }
      return;
    }
    if (!p) return;
    const [x, y] = local(e);
    const dx = x - p.x; const dy = y - p.y;
    p.x = x; p.y = y;
    if (!p.moved && Math.hypot(x - p.x0, y - p.y0) > TAP_SLOP) p.moved = true;
    switch (p.role) {
      case 'joy': {
        let jx = x - p.x0; let jy = y - p.y0;
        const l = Math.hypot(jx, jy);
        if (l > JOY_R) { jx = (jx / l) * JOY_R; jy = (jy / l) * JOY_R; }
        st.moveX = jx / JOY_R; st.moveY = -jy / JOY_R;
        if (joyKnob) joyKnob.style.transform = `translate(${jx}px, ${jy}px)`;
        break;
      }
      case 'look': case 'mouse-look':
        if (p.moved) { st.lookDX += dx; st.lookDY += dy; }
        break;
      case 'stroke': paint.move(x, y); break;
      case 'orbit': case 'orbit-or-tap':
        if (p.moved) { p.role = 'orbit'; paint.orbit(dx, dy); }
        break;
      case 'pinch': {
        const touches = [...ptrs.values()].filter((q) => q.role === 'pinch');
        if (touches.length >= 2 && pinch) {
          const [a, b] = touches;
          const d = Math.hypot(a.x - b.x, a.y - b.y); const cx = (a.x + b.x) / 2; const cy = (a.y + b.y) / 2;
          if (pinch.d > 10 && d > 10) paint.zoom(pinch.d / d);
          paint.orbit(cx - pinch.cx, cy - pinch.cy);
          pinch.d = d; pinch.cx = cx; pinch.cy = cy;
        }
        break;
      }
      default: break;
    }
  }, { passive: false });

  const up = (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    ptrs.delete(e.pointerId);
    try { surface.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (p.role === 'joy') { joyId = null; st.moveX = 0; st.moveY = 0; showJoy(false); }
    if (p.role === 'stroke') { paint.end(); strokeId = null; }
    if (p.role === 'orbit-or-tap' && !p.moved && e.type === 'pointerup') paint.tap(p.x, p.y);
    if (p.role === 'mouse-look' && !p.moved && e.type === 'pointerup' && st.lockFailed && p.button === 0) onAction('fire');
    if (p.role === 'look' && !p.moved && e.type === 'pointerup' && p.type === 'mouse' && p.button === 0) onAction('fire');
    if (p.role === 'pinch' && [...ptrs.values()].filter((q) => q.role === 'pinch').length < 2) { pinch = null; for (const q of ptrs.values()) q.role = 'none'; }
  };
  L.on(surface, 'pointerup', up);
  L.on(surface, 'pointercancel', up);
  L.on(surface, 'contextmenu', (e) => e.preventDefault());
  L.on(surface, 'wheel', (e) => { if (st.mode === 'paint') { e.preventDefault(); paint.zoom(e.deltaY > 0 ? 1.08 : 1 / 1.08); } }, { passive: false });

  // iOS: stop the iframe / app sheet from scrolling or being dismissed by drags on the game.
  const stopTouch = (e) => { if (e.target.closest && e.target.closest('[data-scroll]')) return; if (e.cancelable) e.preventDefault(); };
  L.on(root, 'touchstart', (e) => { if (e.touches[0] && e.touches[0].clientX < EDGE && e.cancelable) e.preventDefault(); }, { passive: false });
  L.on(root, 'touchmove', stopTouch, { passive: false });

  // pointer lock state
  L.on(document, 'pointerlockchange', () => { st.locked = document.pointerLockElement === surface; });
  L.on(document, 'pointerlockerror', () => { st.lockFailed = true; st.locked = false; });

  // ── keyboard ──
  const KEYMAP = {
    Space: 'jump', KeyC: 'crouch', KeyP: 'paint', KeyB: 'brush', KeyG: 'fill', KeyE: 'pick', KeyT: 'stamp', KeyZ: 'undo',
    KeyQ: 'scan', KeyF: 'scurry', KeyR: 'ready', Enter: 'confirm', KeyH: 'hardness', KeyX: 'size',
    Digit1: 'pose:stand', Digit2: 'pose:crouch', Digit3: 'pose:wall', Digit4: 'pose:ball', Digit5: 'pose:flat',
  };
  L.on(window, 'keydown', (e) => {
    if (!isActive()) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    st.lastInput = 'keys'; st.usingMouse = true;
    if (/^(Key[WASD]|Arrow)/.test(e.code)) { keys.add(e.code); e.preventDefault(); return; }
    if (e.code === 'Space') { st.jumpHeld = true; e.preventDefault(); }
    if (e.repeat) return;
    const a = KEYMAP[e.code];
    if (a) { onAction(a); if (e.code === 'Space') e.preventDefault(); }
  });
  L.on(window, 'keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'Space') st.jumpHeld = false;
  });
  L.on(window, 'blur', () => { keys.clear(); st.jumpHeld = false; });

  return {
    st,
    setMode(m) {
      if (st.mode === m) return;
      st.mode = m;
      st.moveX = 0; st.moveY = 0; st.lookDX = 0; st.lookDY = 0;
      joyId = null; showJoy(false); pinch = null;
      if (strokeId != null) { paint.end(); strokeId = null; }
      ptrs.clear();
      if (m !== 'move' && m !== 'look' && st.locked) { try { document.exitPointerLock(); } catch { /* ignore */ } }
    },
    /** Movement for this frame (keys win over the stick when held). */
    move(out) {
      const [kx, ky] = keyMove();
      if (kx || ky) { out[0] = kx; out[1] = ky; } else { out[0] = st.moveX; out[1] = st.moveY; }
      return out;
    },
    takeLook(out) { out[0] = st.lookDX; out[1] = st.lookDY; st.lookDX = 0; st.lookDY = 0; return out; },
    releaseLock() { if (st.locked) { try { document.exitPointerLock(); } catch { /* ignore */ } } },
    destroy() { L.clear(); keys.clear(); ptrs.clear(); if (st.locked) { try { document.exitPointerLock(); } catch { /* ignore */ } } },
    get listenerCount() { return L.count; },
  };
}
