// Getaway HUD: per-viewer views (one, or two for split screen), touch controls, the minimap and
// full map (tap a road to drop a spike strip), and the overlay cards. Every setter diffs against
// its last value, so a frame touches the DOM only when something visibly changed.
import { OPTIONS, LABELS, HINTS, fmt, KEYS } from './rules.js';
import { fmtSec } from './records.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtTime = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/**
 * Tap handling that works on every phone: a touch acts on pointerup (if the finger didn't move
 * and stayed on the same control), a mouse on click. iOS drops the click after any cancelled
 * touchstart, so menus must never depend on it. After a touch tap, the browser's own synthetic
 * click for it is swallowed (700 ms), so a menu that re-renders under the finger can't get a
 * second, unintended press. Taps are tracked per pointer, so a menu button works while another
 * finger is still on a pedal (map Done, pause Resume with the gas held). Returns an unbind function.
 */
export function bindTap(root, sel, fn) {
  const downs = new Map(); let swallowUntil = 0; // pointerId -> { key, x, y } of a touch that began on a control
  const keyOf = (el) => { const d = el.dataset; return `${d.l || ''}|${d.v || ''}|${d.dir || ''}|${d.k || ''}|${d.step || ''}|${d.m || ''}`; };
  const pick = (t) => { const el = t && t.closest ? t.closest(sel) : null; return el && root.contains(el) && !el.disabled ? el : null; };
  const pd = (e) => {
    if (e.pointerType === 'mouse') return;
    const el = pick(e.target);
    if (el) downs.set(e.pointerId, { key: keyOf(el), x: e.clientX, y: e.clientY }); else downs.delete(e.pointerId);
  };
  const pu = (e) => {
    const d = downs.get(e.pointerId); if (!d) return;
    downs.delete(e.pointerId);
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 14) return; // a scroll or a drag, not a tap
    const el = pick(e.target) || pick(document.elementFromPoint && document.elementFromPoint(e.clientX, e.clientY));
    if (!el || keyOf(el) !== d.key) return;
    swallowUntil = performance.now() + 700;
    fn(el, e);
  };
  const pc = (e) => { downs.delete(e.pointerId); };
  const ck = (e) => {
    // a click the browser made from a touch we already acted on at pointerup (Chrome says so with
    // pointerType; a starved page can deliver it after the 700 ms window: a double step)
    if (e.pointerType === 'touch' || e.pointerType === 'pen') return;
    if (performance.now() < swallowUntil) { swallowUntil = 0; return; }
    const el = pick(e.target); if (el) fn(el, e);
  };
  root.addEventListener('pointerdown', pd, true); root.addEventListener('pointerup', pu, true);
  root.addEventListener('pointercancel', pc, true); root.addEventListener('click', ck);
  return () => { root.removeEventListener('pointerdown', pd, true); root.removeEventListener('pointerup', pu, true); root.removeEventListener('pointercancel', pc, true); root.removeEventListener('click', ck); };
}

const IC = {
  pause: '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>',
  spike: '<svg viewBox="0 0 24 24"><path d="M3 16h18M5 16l2-6 2 6M10 16l2-6 2 6M15 16l2-6 2 6"/></svg>',
  oil: '<svg viewBox="0 0 24 24"><path d="M12 3c3 4 6 7 6 10a6 6 0 0 1-12 0c0-3 3-6 6-10z"/></svg>',
  look: '<svg viewBox="0 0 24 24"><path d="M9 7l-5 5 5 5M4 12h11a5 5 0 0 1 5 5"/></svg>',
};

// ── map images ──
/** A printed street map of the whole map on a canvas (north up). */
export function makeMapImage(geo, map, P, maxPx = 1400) {
  const B = geo.bounds; const W0 = B.x1 - B.x0; const H0 = B.z1 - B.z0;
  const k = maxPx / Math.max(W0, H0);
  const cv = document.createElement('canvas'); cv.width = Math.round(W0 * k); cv.height = Math.round(H0 * k);
  const g = cv.getContext('2d');
  const css = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
  const dark = P.dark;
  const X = (x) => (x - B.x0) * k; const Z = (z) => (z - B.z0) * k;
  g.fillStyle = dark ? '#1d2230' : '#e9e4d2'; g.fillRect(0, 0, cv.width, cv.height);
  const poly = (pts, fill) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.closePath(); g.fillStyle = fill; g.fill(); };
  const OPEN = { lot: dark ? '#2b2f3b' : '#d9d4c6', grass: dark ? '#25382c' : '#c7dcae', dirt: dark ? '#3a3127' : '#dcc7a2', sand: dark ? '#3e3829' : '#efe1b8' };
  for (const o of geo.opens) poly(o.poly, OPEN[o.kind]);
  for (const w of geo.waters) poly(w.poly, dark ? '#1f3b66' : '#8ec3e6');
  g.fillStyle = dark ? '#3a3f52' : '#bdb6a6';
  for (const s of geo.solids) {
    if (s.breakable || s.hw * s.hd < 6) continue;
    g.save(); g.translate(X(s.x), Z(s.z)); g.rotate(-s.rot); g.fillRect(-s.hw * k, -s.hd * k, s.hw * 2 * k, s.hd * 2 * k); g.restore();
  }
  const stroke = (r, w, col) => { g.beginPath(); for (let i = 0; i < r.n; i++) (i ? g.lineTo(X(r.x[i]), Z(r.z[i])) : g.moveTo(X(r.x[i]), Z(r.z[i]))); g.lineWidth = w; g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); };
  const ink = css(P.outline);
  const order = [...geo.roads].sort((a, b) => (a.bridge - b.bridge) || (a.rank - b.rank));
  for (const r of order) if (!r.bridge) stroke(r, Math.max(2.5, r.width * k + 2.4), ink);
  for (const r of order) if (!r.bridge) stroke(r, Math.max(1.4, r.width * k), r.kind === 'highway' ? (dark ? '#c9a640' : '#f5cf55') : r.kind === 'dirt' ? (dark ? '#6b5a44' : '#cfb58c') : dark ? '#5b6072' : '#fffdf6');
  for (const r of order) if (r.bridge) { stroke(r, Math.max(2.5, r.width * k + 3.4), ink); stroke(r, Math.max(1.4, r.width * k), dark ? '#7c8194' : '#ffffff'); }
  return { cv, k, B };
}

/** Landmark marker on a 2D context. */
function drawLandmark(g, x, y, lm, s = 1) {
  if (lm.home) {
    g.save(); g.translate(x, y); g.scale(s, s);
    g.beginPath(); g.moveTo(0, -9); g.lineTo(9, -1); g.lineTo(6, -1); g.lineTo(6, 7); g.lineTo(-6, 7); g.lineTo(-6, -1); g.lineTo(-9, -1); g.closePath();
    g.fillStyle = '#ff5fa2'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#1b1a20'; g.stroke();
    g.fillStyle = '#1b1a20'; g.fillRect(-1.6, 2, 3.2, 5);
    g.restore(); return;
  }
  g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillStyle = '#ffd23f'; g.strokeStyle = '#1b1a20'; g.lineWidth = 1.6;
  g.fillRect(-4 * s, -4 * s, 8 * s, 8 * s); g.strokeRect(-4 * s, -4 * s, 8 * s, 8 * s); g.restore();
}
/** A car arrow at (x, y) heading `yaw` (compass) on a north-up 2D context. */
function drawArrow(g, x, y, yaw, fill, size = 8, ring = false) {
  g.save(); g.translate(x, y); g.rotate(yaw);
  if (ring) { g.beginPath(); g.arc(0, 0, size * 1.7, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.35)'; g.fill(); }
  g.beginPath(); g.moveTo(0, -size); g.lineTo(size * 0.72, size * 0.8); g.lineTo(0, size * 0.38); g.lineTo(-size * 0.72, size * 0.8); g.closePath();
  g.fillStyle = fill; g.fill(); g.lineWidth = 2; g.strokeStyle = '#1b1a20'; g.stroke(); g.restore();
}
function drawSpike(g, x, y, yaw, s = 1, ghost = false) {
  g.save(); g.translate(x, y); g.rotate(yaw + Math.PI / 2); g.globalAlpha = ghost ? 0.55 : 1;
  g.fillStyle = '#e2333f'; g.strokeStyle = '#1b1a20'; g.lineWidth = 1.5;
  g.fillRect(-7 * s, -2.5 * s, 14 * s, 5 * s); g.strokeRect(-7 * s, -2.5 * s, 14 * s, 5 * s);
  g.restore();
}

// ── HUD ──
export function createHud(root, api, { split, touch }) {
  const views = {};
  const viewHTML = (cls) => `<div class="gtw-view ${cls}">
    <div class="gtw-top"><div class="gtw-sc a gtw-st"><i></i><b data-s="a">0</b><em>${esc(api.name('a'))}</em></div>
      <div class="gtw-clock gtw-st"><small data-c="lab">Round 1</small><b data-c="t">2:30</b><div class="gtw-pips"></div></div>
      <div class="gtw-sc b gtw-st"><i></i><b data-s="b">0</b><em>${esc(api.name('b'))}</em></div>
      <button class="gtw-pausebtn gtw-st" data-tap="pause" aria-label="Pause">${IC.pause}</button></div>
    <div class="gtw-left"><span class="gtw-role">Runner</span>
      <div class="gtw-bar gtw-hp gtw-st"><small><span>Car</span><b data-h="v">100%</b></small><div class="t"><i></i></div></div>
      <div class="gtw-bar gtw-heat gtw-st"><small><span data-e="lab">Lose the heat</span><b data-e="v"></b></small><div class="t"><i></i></div></div></div>
    <button class="gtw-mini gtw-st" data-tap="map" aria-label="Open the map"><canvas></canvas><b>N</b><kbd>M</kbd></button>
    <div class="gtw-speed"><div class="gtw-tools"></div><div class="gtw-nitro"><i></i></div><b>0</b><small>KM/H</small></div>
    <div class="gtw-vig"></div><div class="gtw-tag"></div><div class="gtw-edge" hidden></div>
    <div class="gtw-hint"></div><div class="gtw-count"></div><div class="gtw-stamp"></div><div class="gtw-flash"></div>
    <div class="gtw-box" hidden><b></b><i><s></s></i></div><div class="gtw-dmg"></div>
  </div>`;
  const hudEl = document.createElement('div');
  hudEl.className = 'gtw-hud';
  hudEl.innerHTML = (split ? viewHTML('l') + viewHTML('r') + '<div class="gtw-split-line"></div>' : viewHTML('full'))
    + `<div class="gtw-ctl"><div class="gtw-steerhint">Steer</div><div class="gtw-steer"><i></i></div>
      <button data-pad="nitro">Nitro</button><button data-pad="gas"><span>Gas</span></button><button data-pad="brake">Brake</button><button data-pad="hand">Drift</button>
      <button data-tap="act" class="runner">${IC.oil}</button><button data-tap="look">${IC.look}</button><button data-tap="cam">Cam</button><button data-tap="horn" hidden>Honk</button></div>
    <div class="gtw-legend gtw-st" hidden></div>
    <div class="gtw-map" hidden><div class="box gtw-st"><div class="row"><div><h3 data-m="t">Map</h3><p data-m="s"></p></div><button class="gtw-mapwhole" data-m="whole" hidden>Whole map</button><button data-m="close">Done</button></div><div class="gtw-mapwrap"><canvas></canvas><i class="gtw-mapping"></i><b class="gtw-maptoast"></b></div></div></div>
    <div class="gtw-over" hidden></div><div class="gtw-sheet" hidden></div>`;
  root.appendChild(hudEl);
  const q = (s) => hudEl.querySelector(s);
  const ctl = q('.gtw-ctl'); const actBtn = q('[data-tap="act"]');
  const over = q('.gtw-over'); const sheet = q('.gtw-sheet'); const mapEl = q('.gtw-map'); const legend = q('.gtw-legend');
  const mapCv = mapEl.querySelector('canvas');

  function makeView(el) {
    const $ = (s) => el.querySelector(s);
    const last = {};
    const setText = (k, node, v) => { if (last[k] !== v) { last[k] = v; node.textContent = v; } };
    const setCls = (k, node, cls, on) => { const key = k + cls; if (last[key] !== on) { last[key] = on; node.classList.toggle(cls, on); } };
    const els = {
      sa: $('[data-s="a"]'), sb: $('[data-s="b"]'), clk: $('.gtw-clock'), clkT: $('[data-c="t"]'), clkL: $('[data-c="lab"]'), pips: $('.gtw-pips'),
      role: $('.gtw-role'), hp: $('.gtw-hp'), hpI: $('.gtw-hp .t i'), hpV: $('[data-h="v"]'), heat: $('.gtw-heat'), heatI: $('.gtw-heat .t i'), heatL: $('[data-e="lab"]'), heatV: $('[data-e="v"]'),
      mini: $('.gtw-mini'), miniCv: $('.gtw-mini canvas'), speed: $('.gtw-speed b'), nitro: $('.gtw-nitro'), nitroI: $('.gtw-nitro i'), tools: $('.gtw-tools'),
      vig: $('.gtw-vig'), tag: $('.gtw-tag'), edge: $('.gtw-edge'), hint: $('.gtw-hint'), count: $('.gtw-count'), stamp: $('.gtw-stamp'), flash: $('.gtw-flash'),
      box: $('.gtw-box'), boxT: $('.gtw-box b'), boxI: $('.gtw-box s'), dmg: $('.gtw-dmg'),
    };
    let hintT = 0; let stampAlt = false; let dmgAlt = false;
    // Where the other car's tag may go: on screen, and off the left HUD column (role, health, heat,
    // and the CAM / horn buttons under it). A car right beside mine projects to the screen edge, and
    // the tag used to sit there half off-screen, on top of the panels. Measured at most every 0.5 s
    // (layout reads), in this view's coordinates.
    const colEls = [$('.gtw-left'), ctl.querySelector('[data-tap="cam"]'), ctl.querySelector('[data-tap="horn"]')];
    const keep = { at: -1e9, w: 0, l: 6, r: 0, colR: 0, colT: 0, colB: 0 };
    function keepOut() {
      const t = performance.now(); if (t - keep.at < 500) return keep; keep.at = t;
      const vb = el.getBoundingClientRect(); keep.w = vb.width;
      let l = 1e9; let r = 0; let top = 1e9; let b = 0;
      for (const n of colEls) {
        if (!n || n.hidden) continue; const q = n.getBoundingClientRect(); if (!q.width || !q.height) continue;
        l = Math.min(l, q.left - vb.left); r = Math.max(r, q.right - vb.left); top = Math.min(top, q.top - vb.top); b = Math.max(b, q.bottom - vb.top);
      }
      keep.l = l < 1e9 ? l : 6; keep.colR = r; keep.colT = top < 1e9 ? top : 0; keep.colB = b;
      const m = els.mini.getBoundingClientRect(); keep.r = m.width ? m.right - vb.left : vb.width - 6; // (the minimap's right edge: inside the safe area)
      return keep;
    }
    const V = {
      el, els,
      scores(a, b) { setText('sa', els.sa, String(a)); setText('sb', els.sb, String(b)); },
      clock(ms, label, hot) {
        const sec = ms == null ? -1 : Math.max(0, Math.ceil(ms / 1000)); // (a new string only when the shown second changes)
        if (last.cs !== sec) { last.cs = sec; setText('ct', els.clkT, sec < 0 ? '–:––' : fmtTime(ms)); }
        setText('cl', els.clkL, label); setCls('ch', els.clk, 'hot', !!hot);
      },
      pips(list) { const key = list.join(''); if (last.pips !== key) { last.pips = key; els.pips.innerHTML = list.map((c) => `<i class="${c}"></i>`).join(''); } },
      role(r, w) { setText('role', els.role, r === 'cop' ? 'Cop' : 'Runner'); setCls('r', els.role, 'cop', r === 'cop'); setCls('r', els.role, 'runner', r !== 'cop'); el.style.setProperty('--me', `var(--p-${w})`); el.style.setProperty('--them', `var(--p-${w === 'a' ? 'b' : 'a'})`); },
      health(hp, role) {
        const v = Math.max(0, Math.round(hp));
        setText('hpv', els.hpV, `${v}%`);
        if (last.hpw !== v) { last.hpw = v; els.hpI.style.transform = `scaleX(${v / 100})`; }
        setCls('hp', els.hp, 'low', v < 30); setCls('hp', els.hp, 'mid', v >= 30 && v < 60);
        setText('hpl', els.hp.querySelector('span'), role === 'cop' ? 'Cruiser' : 'Car');
      },
      heat(k, label, sub, spotted, show) {
        if (last.heatH !== !show) { last.heatH = !show; els.heat.hidden = !show; }
        if (!show) return;
        const v = Math.round(Math.max(0, Math.min(1, k)) * 100);
        if (last.heatw !== v) { last.heatw = v; els.heatI.style.transform = `scaleX(${v / 100})`; }
        setText('hl', els.heatL, label); setText('hv', els.heatV, sub);
        setCls('hs', els.heat, 'spotted', !!spotted); setCls('hh', els.heat, 'hot', v > 70);
      },
      speed(kmh) { const v = Math.round(kmh); if (last.spv !== v) { last.spv = v; els.speed.textContent = String(v); } },
      nitro(k, on, show) {
        if (last.nitroH !== !show) { last.nitroH = !show; els.nitro.hidden = !show; }
        const v = Math.round(k * 50) / 50;
        if (last.nw !== v) { last.nw = v; els.nitroI.style.transform = `scaleX(${v})`; }
        setCls('no', els.nitro, 'on', !!on);
      },
      tools(html) { if (last.tools !== html) { last.tools = html; els.tools.innerHTML = html; } },
      vignette(cls) { if (last.vig !== cls) { last.vig = cls; els.vig.className = 'gtw-vig' + (cls ? ' ' + cls : ''); } },
      hint(text, ms = 2600) {
        clearTimeout(hintT);
        if (!text) { els.hint.classList.remove('on'); return; }
        els.hint.textContent = text; els.hint.classList.add('on');
        hintT = setTimeout(() => els.hint.classList.remove('on'), ms);
      },
      count(t) { if (last.cnt === t) return; last.cnt = t; els.count.textContent = t; els.count.classList.toggle('go', t === 'GO'); els.count.classList.remove('pop'); if (t) { void els.count.offsetWidth; els.count.classList.add('pop'); } },
      stamp(text, cls = '') {
        els.stamp.textContent = text; els.stamp.className = 'gtw-stamp ' + cls;
        // restart the animation without a forced reflow: alternate two identical keyframes
        stampAlt = !stampAlt; els.stamp.style.animationName = stampAlt ? 'gtw-stamp' : 'gtw-stamp2';
        els.stamp.classList.add('go');
      },
      flash() { els.flash.classList.remove('go'); void els.flash.offsetWidth; els.flash.classList.add('go'); },
      /** The boxed-in countdown: k = time left 0..1 (null hides), text over it, cls 'cop' for the cop's view. */
      boxed(k, text, cls) {
        const on = k != null;
        if (last.boxOn !== on) { last.boxOn = on; els.box.hidden = !on; }
        if (!on) return;
        setText('boxt', els.boxT, text); setCls('boxc', els.box, 'cop', cls === 'cop');
        const q = Math.round(Math.max(0, Math.min(1, k)) * 40) / 40;
        if (last.boxk !== q) { last.boxk = q; els.boxI.style.transform = `scaleX(${q})`; }
      },
      /** A floating damage number by the health bar (−6, −12): the hit lands as a number. */
      dmg(n, cls = '') {
        els.dmg.textContent = `−${Math.round(n)}`; els.dmg.className = 'gtw-dmg ' + cls;
        dmgAlt = !dmgAlt; els.dmg.style.animationName = dmgAlt ? 'gtw-dmg' : 'gtw-dmg2';
        els.dmg.classList.add('go');
      },
      tag(x, y, on, text, cls) {
        if (!on) { if (last.tagOn) { last.tagOn = false; els.tag.hidden = true; } return; }
        if (!last.tagOn) { last.tagOn = true; els.tag.hidden = false; }
        setText('tagt', els.tag, text); setCls('tc', els.tag, 'cop', cls === 'cop'); setCls('te', els.tag, 'emote', cls === 'emote');
        // clamp: half the tag's width from its text (heavy 0.7rem type ≈ 7 px a character, plus
        // padding and border; an emote is bigger), no layout read per frame
        const emo = cls === 'emote'; const hw = text.length * (emo ? 4.8 : 3.6) + (emo ? 13 : 10); const th = emo ? 32 : 22;
        const k = keepOut();
        let tx = Math.max(k.l + hw, Math.min(k.r - hw, x));
        if (y > k.colT - 4 && y - th < k.colB + 4 && tx - hw < k.colR + 8) tx = k.colR + 8 + hw;
        const ty = Math.max(th + 4, y);
        const px = Math.round(tx); const py = Math.round(ty);
        if (last.tagX !== px || last.tagY !== py) { last.tagX = px; last.tagY = py; els.tag.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%)`; }
      },
      edgeArrow(x, y, ang, on) {
        if (!on) { if (!els.edge.hidden) els.edge.hidden = true; return; }
        els.edge.hidden = false;
        els.edge.style.left = `${Math.round(x)}px`; els.edge.style.top = `${Math.round(y)}px`; els.edge.style.setProperty('--a', `${Math.round((ang * 180) / Math.PI)}deg`);
      },
      showPlay(on, top = on) {
        if (last.play === on && last.top === top) return; last.play = on; last.top = top;
        els.mini.hidden = !on; el.querySelector('.gtw-left').hidden = !on; el.querySelector('.gtw-speed').hidden = !on; el.querySelector('.gtw-top').hidden = !top;
      },
      /** Minimap: north-up, 420 m across, around (cx, cz). marks: function(g, toPx) */
      mini(img, cx, cz, draw) {
        const cv = els.miniCv; const dpr = Math.min(2, window.devicePixelRatio || 1);
        const S = Math.round(124 * dpr);
        if (cv.width !== S) { cv.width = S; cv.height = S; }
        const g = cv.getContext('2d');
        const span = 420; const k = S / span;
        // Opaque backdrop each frame (same paper as the full map view): a translucent fill without a
        // clear accumulates to solid black wherever the map image doesn't reach (near the map edges).
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, S, S); g.fillStyle = P0.dark ? '#141821' : '#d9d3c0'; g.fillRect(0, 0, S, S);
        const sx = (cx - span / 2 - img.B.x0) * img.k; const sz = (cz - span / 2 - img.B.z0) * img.k;
        g.drawImage(img.cv, sx, sz, span * img.k, span * img.k, 0, 0, S, S);
        draw(g, (x, z) => [(x - cx) * k + S / 2, (z - cz) * k + S / 2], dpr, k);
      },
    };
    return V;
  }
  if (split) { views.a = makeView(q('.gtw-view.l')); views.b = makeView(q('.gtw-view.r')); }
  else views.one = makeView(q('.gtw-view.full'));
  // a second keyframe name for restarting the stamp animation without a reflow
  const st2 = document.createElement('style'); st2.textContent = '@keyframes gtw-stamp2 { 0% { opacity: 0; transform: translate(-50%, -50%) rotate(-7deg) scale(2.2); } 14% { opacity: 1; transform: translate(-50%, -50%) rotate(-7deg) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -50%) rotate(-7deg) scale(1.05); } }';
  st2.textContent += '@keyframes gtw-dmg2 { 0% { opacity: 0; transform: translateY(6px) scale(1.5); } 15% { opacity: 1; transform: translateY(0) scale(1); } 75% { opacity: 1; } 100% { opacity: 0; transform: translateY(-18px); } }';
  hudEl.appendChild(st2);

  // ── map view ──
  let mapState = null;
  function drawMapView() {
    if (!mapState) return;
    const { img, marks } = mapState;
    const r = mapCv.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(10, Math.round(r.width * dpr)); const H = Math.max(10, Math.round(r.height * dpr));
    if (mapCv.width !== W || mapCv.height !== H) { mapCv.width = W; mapCv.height = H; }
    const g = mapCv.getContext('2d');
    // zoomed (the cop's spike map): a window of `span` m across the longer side around view(), north
    // up; else the whole map fitted
    const v = !mapState.whole && mapState.view ? mapState.view() : null;
    let s; let ox; let oy;
    if (v) {
      const span = Math.min(v.span, Math.max(img.cv.width, img.cv.height) / img.k);
      s = Math.max(W, H) / (span * img.k);
      ox = W / 2 - (v.cx - img.B.x0) * img.k * s; oy = H / 2 - (v.cz - img.B.z0) * img.k * s;
    } else { s = Math.min(W / img.cv.width, H / img.cv.height); ox = (W - img.cv.width * s) / 2; oy = (H - img.cv.height * s) / 2; }
    mapState.fit = { s, ox, oy, dpr };
    g.fillStyle = P0.dark ? '#141821' : '#d9d3c0'; g.fillRect(0, 0, W, H);
    g.drawImage(img.cv, ox, oy, img.cv.width * s, img.cv.height * s);
    const toPx = (x, z) => [ox + (x - img.B.x0) * img.k * s, oy + (z - img.B.z0) * img.k * s];
    marks(g, toPx, dpr, img.k * s);
  }
  let P0 = { dark: false };
  function mapToWorld(clientX, clientY) {
    if (!mapState || !mapState.fit) return null;
    const r = mapCv.getBoundingClientRect(); const { s, ox, oy, dpr } = mapState.fit; const img = mapState.img;
    const px = (clientX - r.left) * dpr; const py = (clientY - r.top) * dpr;
    return { x: (px - ox) / (img.k * s) + img.B.x0, z: (py - oy) / (img.k * s) + img.B.z0 };
  }
  // tap feedback where the finger is: a ring in the strip colour, or a red ring and the reason 60 px above it
  const ring = mapEl.querySelector('.gtw-mapping'); const toast = mapEl.querySelector('.gtw-maptoast'); let ringAlt = false; let toastT = 0;
  function feedback(cx, cy, ok, msg) {
    const r = mapCv.parentNode.getBoundingClientRect(); const x = cx - r.left; const y = cy - r.top;
    ring.style.left = `${x}px`; ring.style.top = `${y}px`; ring.className = 'gtw-mapping go ' + (ok ? 'ok' : 'no');
    ringAlt = !ringAlt; ring.style.animationName = ringAlt ? 'gtw-ring' : 'gtw-ring2';
    clearTimeout(toastT);
    if (ok || !msg) { toast.classList.remove('on'); return; }
    toast.textContent = msg; toast.style.left = `${Math.max(90, Math.min(r.width - 90, x))}px`; toast.style.top = `${Math.max(24, y - 60)}px`; toast.classList.add('on');
    toastT = setTimeout(() => toast.classList.remove('on'), 1800);
  }
  mapCv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!mapState || !mapState.onTap) return;
    const p = mapToWorld(e.clientX, e.clientY); if (!p) return;
    const r = mapState.onTap(p.x, p.z);
    if (r !== undefined) feedback(e.clientX, e.clientY, r === true, r === true ? '' : String(r));
  });
  const unbindMap = bindTap(mapEl, '[data-m]', (el) => {
    if (el.dataset.m === 'close') { if (mapState && mapState.onClose) mapState.onClose(); }
    else if (el.dataset.m === 'whole' && mapState) { mapState.whole = !mapState.whole; el.textContent = mapState.whole ? 'Zoom in' : 'Whole map'; drawMapView(); }
  });

  // ── public ──
  const H = {
    root: hudEl, views, ctl, actBtn, over, sheet, legend,
    view: (w) => (split ? views[w] : views.one),
    setPalette(P) { P0 = P; },
    setAct(role, enabled, count) {
      const key = `${role}${enabled}${count}`;
      if (H._act === key) return; H._act = key;
      actBtn.className = role; actBtn.disabled = !enabled;
      // the count lives on the button as a badge (touch hides the HUD's tool chip, so it shows once)
      const what = role === 'cop' ? 'Spike' : 'Oil';
      actBtn.setAttribute('aria-label', `${what} (${count} left)`);
      actBtn.innerHTML = `${role === 'cop' ? IC.spike : IC.oil}<span class="l">${what}</span><em class="n${count ? '' : ' zero'}">${count}</em>`;
    },
    setLegend(html) { if (H._leg === html) return; H._leg = html; legend.hidden = !html; if (html) legend.innerHTML = html; },
    /** Full map. opts: { img, title, sub, marks(g, toPx, dpr, k), onTap(x, z), onClose } */
    openMap(opts) {
      mapState = opts; mapEl.hidden = false; mapEl.querySelector('[data-m="t"]').textContent = opts.title; mapEl.querySelector('[data-m="s"]').textContent = opts.sub || '';
      const wb = mapEl.querySelector('[data-m="whole"]'); wb.hidden = !opts.view; wb.textContent = 'Whole map'; toast.classList.remove('on');
      requestAnimationFrame(drawMapView);
    },
    mapSub(t) { mapEl.querySelector('[data-m="s"]').textContent = t; },
    redrawMap: drawMapView,
    closeMap() { mapState = null; mapEl.hidden = true; },
    get mapOpen() { return !mapEl.hidden; },
    card(html, cls = 'dim') { if (html == null) { over.hidden = true; over.innerHTML = ''; H._card = null; return; } if (H._card === html && !over.hidden) return; H._card = html; over.className = 'gtw-over ' + cls; over.innerHTML = html; over.hidden = false; },
    showSheet(html) { if (html == null) { sheet.hidden = true; sheet.innerHTML = ''; return; } const sc = sheet.querySelector('.in'); const keep = sc ? sc.scrollTop : 0; sheet.innerHTML = html; sheet.hidden = false; const sc2 = sheet.querySelector('.in'); if (sc2 && keep) sc2.scrollTop = keep; },
    /** The emote button: shown in live play, labelled with the line it sends next. */
    setHorn(show, label) { const b = ctl.querySelector('[data-tap="horn"]'); const key = show ? label : ''; if (H._horn === key) return; H._horn = key; b.hidden = !show; if (show) b.textContent = label; },
    drawArrow, drawSpike, drawLandmark,
    destroy() { unbindMap(); hudEl.remove(); },
  };
  void touch;
  return H;
}

// ── cards ──
const nameB = (api, w) => `<b class="gtw-name-${w}">${esc(api.name(w))}</b>`;
const btnHTML = (b) => `<button class="${b[2] || 'gtw-ghost'}" data-l="${esc(b[0])}"${b[3] ? ` data-v="${esc(b[3])}"` : ''}>${esc(b[1])}</button>`;
const TIPS = [
  'Cop: get alongside and nudge their back corner to PIT them.',
  'Runner: break line of sight behind buildings to lose the heat.',
  'Drift (handbrake) swings the tail round tight corners.',
  'Near misses with traffic top up the runner’s nitro.',
  'Cop: tap the minimap to drop spike strips ahead of them.',
  'Runner: drop oil when the cop is right behind you.',
];
/** Loading: a progress bar with a stage line and an optional Cancel. */
export function loadingCard(text, pct, w = 'a', { cancel = false, tip = -1, slow = false } = {}) {
  const p = Math.max(0, Math.min(1, pct || 0));
  const t = tip >= 0 ? TIPS[tip % TIPS.length] : '';
  return `<div class="gtw-load" style="--me: var(--p-${w})"><div class="gtw-card gtw-st" role="status" aria-live="polite">
    <div class="gtw-logo">Get<span>away</span></div>
    <div class="gtw-road" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p * 100)}"><b style="width:${Math.round(p * 100)}%"></b><i style="left:${Math.round(2 + p * 84)}%"></i></div>
    <p class="gtw-loadtxt"><span>${esc(text)}</span><b>${Math.round(p * 100)}%</b></p>
    ${slow ? '<p class="gtw-slow">Taking longer than usual. Hang on, or cancel and pick a smaller map.</p>' : t ? `<p class="gtw-tip">${esc(t)}</p>` : ''}
    ${cancel ? '<button class="gtw-ghost gtw-cancel" data-l="loadcancel">Cancel</button>' : ''}</div></div>`;
}
/** An error with a way out: buttons [[action, label, cls]]. */
export function errorCard(msg, { title = 'Engine trouble', buttons = null, detail = '' } = {}) {
  const bs = buttons && buttons.length ? `<div class="gtw-btns col">${buttons.map(btnHTML).join('')}</div>` : '<p>Close the game and open it again.</p>';
  return `<div class="gtw-card gtw-st gtw-err" role="alert"><h2>${esc(title)}</h2><p>${esc(msg)}</p>${detail ? `<p class="gtw-detail">${esc(detail)}</p>` : ''}${bs}</div>`;
}

export function mapCardHTML(maps, setup, canEdit, loading = false) {
  const i = Math.max(0, maps.findIndex((m) => m.id === setup.map)); const m = maps[i];
  const dis = canEdit ? '' : 'disabled';
  return `<div class="gtw-mapcard">
    <button class="gtw-arrow" data-l="map" data-dir="-1" aria-label="Previous map" ${dis}>‹</button>
    <div class="gtw-mapsel"><canvas class="plan" data-plan="${esc(m.id)}" width="168" height="168"></canvas>
      <div class="info"><b>${esc(m.name)}</b><small>${esc(m.blurb || '')}</small>${m.stub ? '<em>Coming soon</em>' : loading ? '<em class="ld">Loading…</em>' : ''}</div></div>
    <button class="gtw-arrow" data-l="map" data-dir="1" aria-label="Next map" ${dis}>›</button></div>`;
}

export function lobbyCard(api, o) {
  const { maps, setup, canEdit, local, localMode, practiceRole, splitOK, waitingFor, partnerReady, me } = o;
  const first = setup.first; const r = setup.rules;
  const ai = local && localMode === 'ai';
  const daily = local && localMode === 'daily' && o.daily;
  const modeRow = local ? `<div class="gtw-modes ${splitOK ? 'three' : ''}">
      <button class="gtw-mode ${localMode === 'ai' ? 'on' : ''}" data-l="lmode" data-v="ai"><b>Practice vs AI</b><small>You against a computer driver. Roles swap.</small></button>
      <button class="gtw-mode ${localMode === 'daily' ? 'on' : ''}" data-l="lmode" data-v="daily"><b>Daily chase</b><small>${o.daily ? esc(o.daily.short) : 'Today’s run, the same for both of you.'}</small></button>
      ${splitOK ? `<button class="gtw-mode ${localMode === 'split' ? 'on' : ''}" data-l="lmode" data-v="split"><b>Split screen</b><small>Two on one keyboard: WASD vs arrows.</small></button>` : ''}</div>` : '';
  const levels = o.levels || ['easy', 'normal', 'hard'];
  const lvLab = o.levelLabels || { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
  const firstRow = ai
    ? `<div class="gtw-lrow"><h3>You start as</h3><div class="gtw-chips">${['runner', 'cop'].map((x) => `<button class="gtw-chip ${practiceRole === x ? 'on' : ''}" data-l="prole" data-v="${x}">${x === 'cop' ? 'Cop' : 'Runner'}</button>`).join('')}</div></div>
      <div class="gtw-lrow"><h3>AI driver</h3><div class="gtw-chips gtw-seg">${levels.map((x) => `<button class="gtw-chip ${o.aiLevel === x ? 'on' : ''}" data-l="ailevel" data-v="${esc(x)}">${esc(lvLab[x] || x)}</button>`).join('')}</div></div>`
    : `<div class="gtw-lrow"><h3>Runs first</h3><div class="gtw-chips">${['a', 'b'].map((w) => `<button class="gtw-chip p${w} ${first === w ? 'on' : ''}" data-l="first" data-v="${w}" ${canEdit ? '' : 'disabled'}><i></i>${esc(api.name(w))}</button>`).join('')}</div></div>`;
  const quickOn = r.rounds === 2 && r.roundTime === 60;
  const facts = daily
    ? `<div class="gtw-daily"><p><b>${esc(o.daily.title)}</b></p><p>${esc(o.daily.how)}</p>${o.daily.board.length ? `<ul>${o.daily.board.map((x) => `<li class="p${x.w}"><i></i>${esc(x.name)} <b>${esc(x.text)}</b></li>`).join('')}</ul>` : '<p class="gtw-tapon">Nobody has run it yet today.</p>'}${o.daily.note ? `<p class="gtw-tapon">${esc(o.daily.note)}</p>` : ''}</div>`
    : `<div class="gtw-factsrow"><p class="gtw-facts">${r.rounds} rounds · ${fmt('roundTime', r.roundTime)} each · ${r.spikes ? `${r.spikes} spike strip${r.spikes === 1 ? '' : 's'}` : 'no spikes'} · traffic ${r.traffic}${r.tiebreak === 'sudden' ? ' · sudden death' : ''}</p>${canEdit && !quickOn ? '<button class="gtw-chip" data-l="quick">Quick chase</button>' : ''}</div>`;
  const recs = !daily && o.records && o.records.length ? `<p class="gtw-records"><span>${ai ? 'Your practice' : 'Records'}</span>${o.records.map((x) => `${esc(x.t)} <b class="gtw-name-${x.w}">${esc(x.name)}</b> ${esc(x.v)}`).join(' · ')}</p>` : '';
  const partner = o.partnerName || 'your partner';
  let status = '';
  if (!local) {
    if (canEdit) status = o.partnerHere ? `<p class="gtw-status ok"><i></i>${esc(partner)} is here${partnerReady ? ' and ready' : ''}${o.partnerLoading ? ' (loading the map…)' : ''}</p>` : `<p class="gtw-status"><i></i>Waiting for ${esc(partner)}: open Games → Getaway → Play live on the other phone.</p>`;
  }
  const blocked = !local && (o.partnerLoading || !o.partnerHere);
  const btn = canEdit
    ? `<button class="gtw-go" data-l="start" ${maps.find((m) => m.id === setup.map && !m.stub) && !o.loading && !blocked ? '' : 'disabled'}>${local ? (daily ? 'Start today’s chase' : ai ? 'Start practice' : 'Start') : o.partnerLoading ? `${esc(partner)} is loading…` : !o.partnerHere ? `Waiting for ${esc(partner)}` : 'Start the chase'}</button>`
    : `<p class="gtw-wait">${nameB(api, waitingFor)} picks the map and starts.</p><button class="gtw-go ${partnerReady ? 'on' : ''}" data-l="ready">${o.meReady ? 'Ready ✓' : 'I’m ready'}</button>`;
  const tip = o.portraitPhone ? '<p class="gtw-landtip">Tip: turn your phone sideways for a wider view.</p>' : '';
  return `<div class="gtw-lobby" style="--me: var(--p-${me})"><div class="gtw-card gtw-st">
    <div class="col"><div class="gtw-logo">Get<span>away</span></div>
    <p class="gtw-tagline">One runs, one chases. PIT them, spike them, or lose the heat.</p>
    ${modeRow}${daily ? '' : firstRow}${facts}${recs}${status}</div>
    <div class="col">${mapCardHTML(maps, daily ? { ...setup, map: o.daily.mapId } : setup, canEdit && !daily, o.loading)}
    <div class="gtw-btns"><button class="gtw-ghost" data-l="settings">${canEdit ? 'Settings' : 'Settings'}</button><button class="gtw-ghost ${o.newcomer ? 'gtw-new' : ''}" data-l="howto">${o.newcomer ? 'New here? How to play' : 'How to play'}</button></div>
    <div class="gtw-btns">${btn}</div>${tip}</div>
  </div></div>`;
}

/** First-time help. touch: phone controls, else keyboard. */
export function howToCard({ touch = true, split = false } = {}) {
  const ctl = touch
    ? '<li><b>Steer</b> put your left thumb down anywhere on the left half and slide it. The slider starts where your thumb lands.</li><li><b>Right thumb</b> Gas, Brake (hold to reverse), Drift, Nitro.</li><li><b>Map</b> tap the minimap. <b>Pause</b> the ‖ button at the top.</li>'
    : split ? '<li><b>Left player</b> WASD, Space drift, Shift nitro, E spike/oil.</li><li><b>Right player</b> arrows, right Shift drift, Enter nitro, / spike/oil.</li><li><b>Esc</b> pauses.</li>'
      : '<li><b>Drive</b> WASD or arrows. <b>Space</b> drift, <b>Shift</b> nitro.</li><li><b>E</b> spike strip / oil, <b>M</b> map, <b>C</b> camera, <b>B</b> look back.</li><li><b>Esc</b> pauses.</li>';
  return `<div class="gtw-card gtw-st gtw-how"><h2>How to play</h2>
    <div class="gtw-howgrid">
      <div><small>Runner</small><p>Survive the clock, or get far away and out of sight to fill the <b>escape</b> meter. Drop <b>oil</b> on a cop right behind you.</p></div>
      <div><small>Cop</small><p>Get alongside and push their <b>back corner</b> to PIT them, box them in, or tap the map to drop <b>spike strips</b> ahead.</p></div>
    </div>
    <ul class="gtw-howlist">${ctl}</ul>
    <p>Roles swap every round. Crashes cost health; at 0 the runner is busted.</p>
    <div class="gtw-btns"><button class="gtw-go" data-l="howclose">Got it</button></div></div>`;
}

const chipRow = (k, cur, opts, labels) => `<div class="gtw-chips gtw-seg">${opts.map((v) => `<button class="gtw-chip ${cur === v ? 'on' : ''}" data-l="dev" data-k="${k}" data-v="${v}">${esc(labels[v] || v)}</button>`).join('')}</div>`;
export function settingsSheet(rules, { canEdit, device, live = false }) {
  const row = (k) => {
    const opts = OPTIONS[k]; const i = opts.indexOf(rules[k]);
    const hint = k === 'camera' && (device || {}).touch ? 'Default chase camera' : HINTS[k]; // (no C key on a phone)
    return `<div class="gtw-srow"><div><b>${esc(LABELS[k])}</b><small>${esc(hint)}</small></div>
      <div class="gtw-step"><button data-l="rule" data-k="${k}" data-step="-1" ${i <= 0 || !canEdit ? 'disabled' : ''} aria-label="Less">−</button><output data-rule="${k}">${esc(fmt(k, rules[k]))}</output><button data-l="rule" data-k="${k}" data-step="1" ${i >= opts.length - 1 || !canEdit ? 'disabled' : ''} aria-label="More">+</button></div></div>`;
  };
  const d = device || {};
  let dev = '';
  if (d.touch) {
    dev += `<div class="gtw-srow"><div><b>Steering</b><small>Slider under your thumb, or tilt the phone</small></div>${chipRow('steer', d.steer, ['slider', 'tilt'], { slider: 'Slider', tilt: 'Tilt' })}</div>`;
    dev += `<div class="gtw-srow"><div><b>Sensitivity</b><small>How far you slide${d.steer === 'tilt' ? ' or tilt' : ''} for full lock</small></div>${chipRow('sens', d.sens, ['low', 'normal', 'high'], { low: 'Gentle', normal: 'Normal', high: 'Quick' })}</div>`;
    dev += `<div class="gtw-srow"><div><b>Centre dead zone</b><small>Ignores tiny wobbles around straight ahead</small></div>${chipRow('dead', d.dead, ['small', 'normal', 'large'], { small: 'Small', normal: 'Normal', large: 'Large' })}</div>`;
    if (d.steer === 'tilt') dev += '<div class="gtw-srow"><div><b>Calibrate tilt</b><small>Hold the phone how you like to drive, then tap</small></div><button class="gtw-chip on" data-l="calib">Set straight</button></div>';
  }
  dev += `<div class="gtw-srow"><div><b>Graphics</b><small>${esc(d.gfxNote || 'Lower is smoother and uses less memory')}</small></div>${chipRow('gfx', d.gfx || 'auto', ['auto', 'low', 'mid', 'high'], { auto: 'Auto', low: 'Low', mid: 'Medium', high: 'High' })}</div>`;
  dev += `<div class="gtw-srow"><div><b>Camera</b><small>${d.touch ? 'Chase camera distance (also in the pause menu)' : 'Chase camera distance (C switches)'}</small></div>${chipRow('cam', d.cam || 'near', ['near', 'far'], { near: 'Close', far: 'Far' })}</div>`;
  dev += `<div class="gtw-srow"><div><b>Music</b><small>A pursuit beat that builds as the cop closes in</small></div>${chipRow('music', d.music || 'on', ['on', 'off'], { on: 'On', off: 'Off' })}</div>`;
  if (d.live) dev += `<div class="gtw-srow"><div><b>Emotes</b><small>Honks and one-liners from your partner (${d.touch ? 'the HONK button' : 'H'})</small></div>${chipRow('emotes', d.emotes || 'on', ['on', 'off'], { on: 'On', off: 'Off' })}</div>`;
  if (d.liveries) { // unlockable paint jobs (liveries.js): locked chips show how to earn them
    for (const [kind, label] of [['runner', 'Runner livery'], ['cop', 'Cruiser']]) {
      const rows = d.liveries[kind] || []; const cur = rows.find((r) => r.cur) || rows[0];
      const locked = rows.filter((r) => !r.on);
      dev += `<div class="gtw-srow gtw-livery"><div><b>${label}</b><small>${esc(locked.length ? `Next: ${locked[0].name} — ${locked[0].how}` : 'Every paint job earned')}</small></div><div class="gtw-chips gtw-seg">${rows.map((r) => `<button class="gtw-chip ${cur && cur.k === r.k ? 'on' : ''}" data-l="dev" data-k="livery${kind}" data-v="${r.k}" ${r.on ? '' : 'disabled'} title="${esc(r.on ? r.name : `${r.name}: ${r.how}`)}">${r.on ? '' : '🔒 '}${esc(r.name)}</button>`).join('')}</div></div>`;
    }
  }
  const match = rules ? `<h3 class="gtw-sh">Match${canEdit ? '' : ` · ${live ? 'the host picks these' : ''}`}</h3>${canEdit ? '' : '<p class="note">The host picks these. You see changes live.</p>'}${KEYS.map(row).join('')}` : '';
  return `<div class="in gtw-st ${canEdit ? '' : 'gtw-ro'}"><div class="gtw-lrow gtw-shead"><h2>Settings</h2><button class="gtw-go" data-l="sheetclose" style="flex:none">Done</button></div>
    <h3 class="gtw-sh">This ${d.touch ? 'phone' : 'device'}</h3>${dev}${match}</div>`;
}

const ROLE_TIP = {
  runner: 'Survive the clock or lose the heat: get far away and out of sight.',
  cop: 'Hit their back corner from the side to PIT them. Tap the map for spike strips.',
};
export function introCard(api, { map, round, rounds, runner, me, landmark, roundTime, local }) {
  const cop = runner === 'a' ? 'b' : 'a';
  const youRun = !local && me === runner; const youCop = !local && me === cop;
  const myRole = local ? (api.name(runner) === 'You' ? 'runner' : api.name(runner) === 'AI' ? 'cop' : '') : youRun ? 'runner' : 'cop';
  return `<div class="gtw-card gtw-st gtw-intro"><h3>${esc(map.name)} · Round ${round + 1} of ${rounds}</h3>
    <h2>${local ? (api.name(runner) === 'You' ? 'You’re running' : api.name(runner) === 'AI' ? 'You’re the cop' : `${esc(api.name(runner))} runs`) : youRun ? 'You’re running' : 'You’re the cop'}</h2>
    ${landmark ? `<p>Starting near <b>${esc(landmark)}</b></p>` : ''}
    <div class="gtw-roles"><div class="${youRun || myRole === 'runner' ? 'me' : ''}"><small>Runner</small>${nameB(api, runner)}<p>Survive ${fmt('roundTime', roundTime)} or lose the heat</p></div>
      <div class="${youCop || myRole === 'cop' ? 'me' : ''}"><small>Cop</small>${nameB(api, cop)}<p>PIT, spike or box them in</p></div></div>
    ${myRole ? `<p class="gtw-tip">${esc(ROLE_TIP[myRole])}</p>` : ''}</div>`;
}

const takes = (n) => (n === 'You' ? 'take' : 'takes');
export function resultCard(api, { outcome, reason, runner, stats, scores, next, local, me, ran, unlocks, lines, head, queue, d, wait, daily, adv }) {
  const busted = outcome === 'busted';
  const big = head || (busted ? (reason === 'water' ? 'SPLASH!' : 'BUSTED!') : 'ESCAPED!');
  const why = {
    hp: 'Car disabled.', boxed: queue ? 'Boxed in, stuck in traffic.' : 'Boxed in and stopped.', water: 'Straight into the water.', time: d >= 0 && d <= 15 ? `Survived the clock with the cop ${d} m behind.` : 'Survived the clock.', heat: 'Lost the heat.', quit: 'The runner gave up.',
  }[reason] || '';
  const winner = busted ? (runner === 'a' ? 'b' : 'a') : runner;
  const youWon = !local && winner === me;
  const st = stats || {};
  // (an elapsed time: rounded like the Daily score beside it, not counted up like the round clock)
  const t = ran ? fmtSec(ran / 1000) : '';
  const recs = (lines || []).slice(0, 2).map((l) => `<p class="gtw-rec ${l.hot ? 'hot' : ''}">${l.hot ? '<b>NEW</b> ' : ''}${esc(l.t)}</p>`).join('');
  return `<div class="gtw-card gtw-st gtw-result" data-l="skip" role="button" aria-label="Continue"><div class="gtw-big ${busted ? 'bad' : 'good'}${big.length > 10 ? ' long' : ''}">${esc(big)}</div>
    <p>${why} ${nameB(api, winner)} ${takes(api.name(winner))} the round${local ? '' : youWon ? ' — nice driving' : ''}.</p>
    ${daily ? `<p class="gtw-rec hot">${esc(daily)}</p>` : ''}
    <div class="gtw-stats">${t ? `<div><b>${t}</b><small>On the run</small></div>` : ''}<div><b>${Math.round((st.top || 0) * 3.6)}</b><small>Top km/h</small></div><div><b>${st.near || 0}</b><small>Near misses</small></div><div><b>${st.pits || 0}</b><small>PITs</small></div>${t ? '' : `<div><b>${st.spikes || 0}</b><small>Spikes hit</small></div>`}</div>
    ${recs}
    ${daily ? '' : `<div class="gtw-score"><span><i style="background:var(--p-a)"></i>${esc(api.name('a'))} ${scores.a}</span><span><i style="background:var(--p-b)"></i>${esc(api.name('b'))} ${scores.b}</span></div>`}
    ${unlocks && unlocks.length ? `<p class="gtw-unlock"><b>UNLOCKED</b> ${unlocks.map((u) => `${esc(u.name)} (${u.kind === 'cop' ? 'cruiser' : 'runner'})`).join(', ')} — pick it in Settings</p>` : ''}
    <p>${esc(next)}</p><p class="gtw-tapon">${esc(wait || 'Tap to continue')}</p>${adv && adv.total > 0 ? `<i class="gtw-adv" aria-hidden="true" style="animation-duration:${Math.round(adv.total)}ms;animation-delay:${-Math.round(adv.total - adv.left)}ms"></i>` : ''}</div>`;
}

/** The match card: round by round, the two of you side by side, the MVP. Tap to go on. */
export function finalCard(api, { hist, scores, winner, rounds, sum, daily, dailySub, ai, tb }) {
  const pip = (h, i) => {
    if (!h) return `<li class="tbd"><small>R${i + 1}</small><b>–</b></li>`;
    const w = h.outcome === 'busted' ? (h.runner === 'a' ? 'b' : 'a') : h.runner;
    const what = h.outcome === 'busted' ? (h.reason === 'water' ? 'SPLASH' : `BUSTED ${fmtSec(h.ran / 1000)}`) : h.reason === 'heat' ? `LOST THEM ${fmtSec(h.ran / 1000)}` : 'ESCAPED';
    return `<li class="w${w}"><small>${h.sd ? 'SD' : `R${i + 1}`} · ${esc(api.name(h.runner))} ran</small><b>${what}</b></li>`;
  };
  const list = []; for (let i = 0; i < Math.max(rounds, hist.length); i++) list.push(pip(hist[i], i));
  const T = sum.T; const col = (w) => `<div class="p${w}"><h4>${nameB(api, w)}</h4><dl><dt>PITs</dt><dd>${T[w].pits}</dd><dt>Top km/h</dt><dd>${T[w].top || '–'}</dd><dt>Near misses</dt><dd>${T[w].near}</dd><dt>Spikes landed</dt><dd>${T[w].spikes}</dd><dt>Escapes</dt><dd>${T[w].esc}</dd></dl></div>`;
  const head = daily ? 'Daily chase' : winner ? `${esc(api.name(winner))} ${api.name(winner) === 'You' ? 'win' : 'wins'}` : 'All square';
  return `<div class="gtw-card gtw-st gtw-final" data-l="finskip" role="button" aria-label="Continue"><h3>${daily ? esc(dailySub) : `Match · ${scores.a}–${scores.b}${tb ? ` · ${esc(tb)}` : ''}`}</h3><h2>${daily ? esc(daily) : head}</h2>
    ${daily ? '' : `<ol class="gtw-rounds">${list.join('')}</ol><div class="gtw-cols">${col('a')}${col('b')}</div>`}
    ${sum.mvp ? `<p class="gtw-mvp"><b>${esc(sum.mvp.t.split(' · ')[0])}</b> ${esc(sum.mvp.t.split(' · ')[1] || '')}</p>` : ''}
    ${ai && !daily ? '<p class="gtw-tapon">Practice rounds go to your practice bests, not the couple’s record</p>' : ''}<p class="gtw-tapon">Tap to continue</p></div>`;
}

/** Pause: text, sub, buttons ([action, label, cls] or a list of them). */
export function pauseCard(text, sub, btns) {
  const list = !btns ? [] : Array.isArray(btns[0]) ? btns : [btns];
  const bs = list.map((b, i) => btnHTML([b[0], b[1], b[2] || (i ? 'gtw-ghost' : 'gtw-go'), b[3]])).join('');
  return `<div class="gtw-card gtw-st gtw-pause"><h2>${esc(text)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}${bs ? `<div class="gtw-btns col">${bs}</div>` : ''}</div>`;
}
