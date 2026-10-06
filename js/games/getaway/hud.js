// Getaway HUD: per-viewer views (one, or two for split screen), touch controls, the minimap and
// full map (tap a road to drop a spike strip), and the overlay cards. Every setter diffs against
// its last value, so a frame touches the DOM only when something visibly changed.
import { OPTIONS, LABELS, HINTS, fmt, KEYS } from './rules.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtTime = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const IC = {
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
      <div class="gtw-sc b gtw-st"><i></i><b data-s="b">0</b><em>${esc(api.name('b'))}</em></div></div>
    <div class="gtw-left"><span class="gtw-role">Runner</span>
      <div class="gtw-bar gtw-hp gtw-st"><small><span>Car</span><b data-h="v">100%</b></small><div class="t"><i></i></div></div>
      <div class="gtw-bar gtw-heat gtw-st"><small><span data-e="lab">Lose the heat</span><b data-e="v"></b></small><div class="t"><i></i></div></div></div>
    <button class="gtw-mini gtw-st" data-tap="map" aria-label="Open the map"><canvas></canvas><b>N</b><kbd>M</kbd></button>
    <div class="gtw-speed"><div class="gtw-tools"></div><div class="gtw-nitro"><i></i></div><b>0</b><small>KM/H</small></div>
    <div class="gtw-vig"></div><div class="gtw-tag"></div><div class="gtw-edge" hidden></div>
    <div class="gtw-hint"></div><div class="gtw-count"></div><div class="gtw-stamp"></div><div class="gtw-flash"></div>
  </div>`;
  const hudEl = document.createElement('div');
  hudEl.className = 'gtw-hud';
  hudEl.innerHTML = (split ? viewHTML('l') + viewHTML('r') + '<div class="gtw-split-line"></div>' : viewHTML('full'))
    + `<div class="gtw-ctl"><div class="gtw-steerhint">Steer</div><div class="gtw-steer"><i></i></div>
      <button data-pad="nitro">Nitro</button><button data-pad="gas"><span>Gas</span></button><button data-pad="brake">Brake</button><button data-pad="hand">Drift</button>
      <button data-tap="act" class="runner">${IC.oil}</button><button data-tap="look">${IC.look}</button><button data-tap="cam">Cam</button></div>
    <div class="gtw-legend gtw-st" hidden></div>
    <div class="gtw-map" hidden><div class="box gtw-st"><div class="row"><div><h3 data-m="t">Map</h3><p data-m="s"></p></div><button data-m="close">Done</button></div><canvas></canvas></div></div>
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
    };
    let hintT = 0; let stampAlt = false;
    const V = {
      el, els,
      scores(a, b) { setText('sa', els.sa, String(a)); setText('sb', els.sb, String(b)); },
      clock(ms, label, hot) { setText('ct', els.clkT, ms == null ? '–:––' : fmtTime(ms)); setText('cl', els.clkL, label); setCls('ch', els.clk, 'hot', !!hot); },
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
        setCls('heat', els.heat, 'gone', !show);
        els.heat.hidden = !show;
        if (!show) return;
        const v = Math.round(Math.max(0, Math.min(1, k)) * 100);
        if (last.heatw !== v) { last.heatw = v; els.heatI.style.transform = `scaleX(${v / 100})`; }
        setText('hl', els.heatL, label); setText('hv', els.heatV, sub);
        setCls('hs', els.heat, 'spotted', !!spotted); setCls('hh', els.heat, 'hot', v > 70);
      },
      speed(kmh) { setText('sp', els.speed, String(Math.round(kmh))); },
      nitro(k, on, show) {
        els.nitro.hidden = !show;
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
      tag(x, y, on, text, cls) {
        if (!on) { if (last.tagOn) { last.tagOn = false; els.tag.hidden = true; } return; }
        if (!last.tagOn) { last.tagOn = true; els.tag.hidden = false; }
        setText('tagt', els.tag, text); setCls('tc', els.tag, 'cop', cls === 'cop');
        els.tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
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
        g.fillStyle = '#0003'; g.fillRect(0, 0, S, S);
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
    const s = Math.min(W / img.cv.width, H / img.cv.height); const ox = (W - img.cv.width * s) / 2; const oy = (H - img.cv.height * s) / 2;
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
  mapCv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!mapState || !mapState.onTap) return;
    const p = mapToWorld(e.clientX, e.clientY); if (p) mapState.onTap(p.x, p.z);
  });
  mapEl.querySelector('[data-m="close"]').addEventListener('click', () => { if (mapState && mapState.onClose) mapState.onClose(); });

  // ── public ──
  const H = {
    root: hudEl, views, ctl, actBtn, over, sheet, legend,
    view: (w) => (split ? views[w] : views.one),
    setPalette(P) { P0 = P; },
    setAct(role, enabled, count) {
      const key = `${role}${enabled}${count}`;
      if (H._act === key) return; H._act = key;
      actBtn.className = role; actBtn.disabled = !enabled;
      actBtn.innerHTML = `${role === 'cop' ? IC.spike : IC.oil}<span class="l">${role === 'cop' ? `Spike ${count}` : count ? 'Oil' : 'Oil 0'}</span>`;
    },
    setLegend(html) { legend.hidden = !html; if (html && legend.innerHTML !== html) legend.innerHTML = html; },
    /** Full map. opts: { img, title, sub, marks(g, toPx, dpr, k), onTap(x, z), onClose } */
    openMap(opts) { mapState = opts; mapEl.hidden = false; mapEl.querySelector('[data-m="t"]').textContent = opts.title; mapEl.querySelector('[data-m="s"]').textContent = opts.sub || ''; requestAnimationFrame(drawMapView); },
    mapSub(t) { mapEl.querySelector('[data-m="s"]').textContent = t; },
    redrawMap: drawMapView,
    closeMap() { mapState = null; mapEl.hidden = true; },
    get mapOpen() { return !mapEl.hidden; },
    card(html, cls = 'dim') { if (html == null) { over.hidden = true; over.innerHTML = ''; H._card = null; return; } if (H._card === html && !over.hidden) return; H._card = html; over.className = 'gtw-over ' + cls; over.innerHTML = html; over.hidden = false; },
    showSheet(html) { if (html == null) { sheet.hidden = true; sheet.innerHTML = ''; return; } const sc = sheet.querySelector('.in'); const keep = sc ? sc.scrollTop : 0; sheet.innerHTML = html; sheet.hidden = false; const sc2 = sheet.querySelector('.in'); if (sc2 && keep) sc2.scrollTop = keep; },
    drawArrow, drawSpike, drawLandmark,
    destroy() { hudEl.remove(); },
  };
  void touch;
  return H;
}

// ── cards ──
const nameB = (api, w) => `<b class="gtw-name-${w}">${esc(api.name(w))}</b>`;
export function loadingCard(text, pct, w = 'a') {
  return `<div class="gtw-load" style="--me: var(--p-${w})"><div class="gtw-card gtw-st" role="status">
    <div class="gtw-logo">Get<span>away</span></div>
    <div class="gtw-road"><i style="left:${Math.round(4 + pct * 82)}%"></i></div>
    <p>${esc(text)}</p></div></div>`;
}
export function errorCard(msg) {
  return `<div class="gtw-card gtw-st" role="alert"><h2>Engine trouble</h2><p>${esc(msg)}</p><p>Close the game and open it again.</p></div>`;
}

export function mapCardHTML(maps, setup, canEdit) {
  const i = Math.max(0, maps.findIndex((m) => m.id === setup.map)); const m = maps[i];
  const dis = canEdit ? '' : 'disabled';
  return `<div class="gtw-mapcard">
    <button class="gtw-arrow" data-l="map" data-dir="-1" aria-label="Previous map" ${dis}>‹</button>
    <div class="gtw-mapsel"><canvas class="plan" data-plan="${esc(m.id)}" width="168" height="168"></canvas>
      <div class="info"><b>${esc(m.name)}</b><small>${esc(m.blurb || '')}</small>${m.stub ? '<em>Coming soon</em>' : ''}</div></div>
    <button class="gtw-arrow" data-l="map" data-dir="1" aria-label="Next map" ${dis}>›</button></div>`;
}

export function lobbyCard(api, { maps, setup, canEdit, local, localMode, practiceRole, splitOK, waitingFor, partnerReady, me }) {
  const first = setup.first; const r = setup.rules;
  const modeRow = local ? `<div class="gtw-modes">
      <button class="gtw-mode ${localMode === 'ai' ? 'on' : ''}" data-l="lmode" data-v="ai"><b>Practice vs AI</b><small>You against a computer driver. Roles swap.</small></button>
      <button class="gtw-mode ${localMode === 'split' ? 'on' : ''}" data-l="lmode" data-v="split" ${splitOK ? '' : 'disabled'}><b>Split screen</b><small>${splitOK ? 'Two on one keyboard: WASD vs arrows.' : 'Needs a laptop keyboard.'}</small></button></div>` : '';
  const firstRow = local && localMode === 'ai'
    ? `<div class="gtw-lrow"><h3>You start as</h3><div class="gtw-chips">${['runner', 'cop'].map((x) => `<button class="gtw-chip ${practiceRole === x ? 'on' : ''}" data-l="prole" data-v="${x}">${x === 'cop' ? 'Cop' : 'Runner'}</button>`).join('')}</div></div>`
    : `<div class="gtw-lrow"><h3>Runs first</h3><div class="gtw-chips">${['a', 'b'].map((w) => `<button class="gtw-chip p${w} ${first === w ? 'on' : ''}" data-l="first" data-v="${w}" ${canEdit ? '' : 'disabled'}><i></i>${esc(api.name(w))}</button>`).join('')}</div></div>`;
  const facts = `<p>${r.rounds} rounds · ${fmt('roundTime', r.roundTime)} each · ${r.spikes ? `${r.spikes} spike strip${r.spikes === 1 ? '' : 's'}` : 'no spikes'} · traffic ${r.traffic}</p>`;
  const btn = canEdit
    ? `<button class="gtw-go" data-l="start" ${maps.find((m) => m.id === setup.map && !m.stub) ? '' : 'disabled'}>Start</button>`
    : `<p class="gtw-wait">${nameB(api, waitingFor)} is setting up…${partnerReady ? '' : ''}</p><button class="gtw-ghost" data-l="ready">${partnerReady ? 'Ready ✓' : 'Ready'}</button>`;
  return `<div class="gtw-lobby" style="--me: var(--p-${me})"><div class="gtw-card gtw-st">
    <div class="col"><div class="gtw-logo">Get<span>away</span></div>
    <p class="gtw-tagline">One runs, one chases. PIT them, spike them, or lose the heat.</p>
    ${modeRow}${firstRow}${facts}</div>
    <div class="col">${mapCardHTML(maps, setup, canEdit)}
    <div class="gtw-btns"><button class="gtw-ghost" data-l="settings">${canEdit ? 'Settings' : 'See settings'}</button>${btn}</div></div>
  </div></div>`;
}

export function settingsSheet(rules, { canEdit, device }) {
  const row = (k) => {
    const opts = OPTIONS[k]; const i = opts.indexOf(rules[k]);
    return `<div class="gtw-srow"><div><b>${esc(LABELS[k])}</b><small>${esc(HINTS[k])}</small></div>
      <div class="gtw-step"><button data-l="rule" data-k="${k}" data-step="-1" ${i <= 0 || !canEdit ? 'disabled' : ''} aria-label="Less">−</button><output data-rule="${k}">${esc(fmt(k, rules[k]))}</output><button data-l="rule" data-k="${k}" data-step="1" ${i >= opts.length - 1 || !canEdit ? 'disabled' : ''} aria-label="More">+</button></div></div>`;
  };
  const dev = `<div class="gtw-srow"><div><b>Steering (this phone)</b><small>Slider under your thumb, or tilt the phone</small></div>
    <div class="gtw-chips">${['slider', 'tilt'].map((v) => `<button class="gtw-chip ${device.steer === v ? 'on' : ''}" data-l="steer" data-v="${v}">${v === 'tilt' ? 'Tilt' : 'Slider'}</button>`).join('')}</div></div>`;
  return `<div class="in gtw-st ${canEdit ? '' : 'gtw-ro'}"><div class="gtw-lrow"><h2>Settings</h2><button class="gtw-go" data-l="sheetclose" style="flex:none">Done</button></div>
    ${canEdit ? '' : '<p class="note">The host picks these. You see changes live.</p>'}
    ${KEYS.map(row).join('')}${device.touch ? dev : ''}</div>`;
}

export function introCard(api, { map, round, rounds, runner, me, landmark, roundTime, local }) {
  const cop = runner === 'a' ? 'b' : 'a';
  const youRun = !local && me === runner; const youCop = !local && me === cop;
  return `<div class="gtw-card gtw-st"><h3>${esc(map.name)} · Round ${round + 1} of ${rounds}</h3>
    <h2>${local ? (api.name(runner) === 'You' ? 'You’re running' : api.name(runner) === 'AI' ? 'You’re the cop' : `${esc(api.name(runner))} runs`) : youRun ? 'You’re running' : 'You’re the cop'}</h2>
    ${landmark ? `<p>Starting near <b>${esc(landmark)}</b></p>` : ''}
    <div class="gtw-roles"><div class="${youRun ? 'me' : ''}"><small>Runner</small>${nameB(api, runner)}<p>Survive ${fmt('roundTime', roundTime)} or lose the heat</p></div>
      <div class="${youCop ? 'me' : ''}"><small>Cop</small>${nameB(api, cop)}<p>PIT, spike or box them in</p></div></div></div>`;
}

export function resultCard(api, { outcome, reason, runner, stats, scores, next, local, me }) {
  const busted = outcome === 'busted';
  const head = busted ? (reason === 'water' ? 'SPLASH!' : 'BUSTED!') : 'ESCAPED!';
  const why = {
    hp: 'Car disabled.', boxed: 'Boxed in and stopped.', water: 'Straight into the water.', time: 'Survived the clock.', heat: 'Lost the heat.', quit: 'The runner gave up.',
  }[reason] || '';
  const winner = busted ? (runner === 'a' ? 'b' : 'a') : runner;
  const youWon = !local && winner === me;
  const st = stats || {};
  return `<div class="gtw-card gtw-st"><div class="gtw-big ${busted ? 'bad' : 'good'}">${head}</div>
    <p>${why} ${nameB(api, winner)} takes the round${local ? '' : youWon ? ' — nice driving' : ''}.</p>
    <div class="gtw-stats"><div><b>${Math.round((st.top || 0) * 3.6)}</b><small>Top km/h</small></div><div><b>${st.near || 0}</b><small>Near misses</small></div><div><b>${st.pits || 0}</b><small>PITs</small></div><div><b>${st.spikes || 0}</b><small>Spikes hit</small></div></div>
    <div class="gtw-score"><span><i style="background:var(--p-a)"></i>${esc(api.name('a'))} ${scores.a}</span><span><i style="background:var(--p-b)"></i>${esc(api.name('b'))} ${scores.b}</span></div>
    <p>${esc(next)}</p></div>`;
}

export function pauseCard(text, sub, btn) {
  return `<div class="gtw-card gtw-st gtw-pause"><h2>${esc(text)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}${btn ? `<button class="gtw-go" data-l="${btn[0]}">${esc(btn[1])}</button>` : ''}</div>`;
}
