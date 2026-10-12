// Doodle's view: every screen, the paper, the replay player.
// Rules live in ../doodle.js and are passed in as K (so there are no import cycles).
import { gameDataApi } from '../core.js';
import { MODE_INFO, PACK_INFO, TWIST_INFO, MODE_LIST, PACK_LIST } from './packs.js';
import { summarize, recordPatch, badgesOf, historyLine, chaseLine, stampsOf, encodeSeen, decodeSeen } from './records.js';

const WIDTHS = [2.6, 7.5]; // in grid units (the grid is 256 wide)
const REPLAY_CAP = 20000; // ms
const INK_VARS = ['var(--g-ink)', 'var(--p-a)', 'var(--p-b)', 'var(--g-good)'];

// ── view helpers ─────────────────────────────────────────────────────
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fitWord = (t) => { const n = Math.max(...t.split(/\s+/).map((w) => w.length)); return n >= 13 ? 'fs' : n >= 10 ? 'fm' : ''; };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ICON = {
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7H4V2M4.5 6.5A8.5 8.5 0 1 1 3.6 14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5l8 7-8 7zM12 5l8 7-8 7z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  yes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  no: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
};
const PENCIL = `<svg class="dd-pencil" viewBox="0 0 220 90" aria-hidden="true">
  <path class="dd-pencil-line" d="M14 62c18-26 30-30 40-10s22 22 34-6 26-30 36-4 20 26 34 2 22-26 34-14 10 18 14 20"/>
  <g class="dd-pencil-body"><path d="M0 0l-9-26 14-5 9 26z" class="dd-pencil-wood"/><path d="M0 0l14-5-3 8z" class="dd-pencil-tip"/><path d="M-9-26l14-5 3 8-14 5z" class="dd-pencil-cap"/></g>
</svg>`;

// Timeline of a drawing for replay: per point absolute ms.
function timeline(strokes) {
  let t = 0;
  const T = strokes.map((st) => {
    t += Math.min(st.gap * 10, 900);
    return st.pts.map(([, , dt]) => (t += Math.min(dt * 8, 450)));
  });
  return { T, total: t };
}

// A square canvas in a 256×256 grid space.
class Paper {
  constructor(canvas, inks) { this.cv = canvas; this.g = canvas.getContext('2d'); this.inks = inks; this.size = 0; }
  fit(css) {
    const dpr = Math.min(3, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    this.size = css;
    this.cv.style.width = this.cv.style.height = `${css}px`;
    const px = Math.max(1, Math.round(css * dpr));
    if (this.cv.width !== px) { this.cv.width = px; this.cv.height = px; }
    this.reset();
  }
  reset() {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    const k = this.cv.width / 256;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.lineCap = 'round'; g.lineJoin = 'round';
  }
  pen(st) { const c = this.inks()[st.c]; this.g.strokeStyle = c; this.g.fillStyle = c; this.g.lineWidth = WIDTHS[st.s]; }
  dot(st) { const [x, y] = st.pts[0]; this.pen(st); const g = this.g; g.beginPath(); g.arc(x + 0.5, y + 0.5, WIDTHS[st.s] / 2, 0, Math.PI * 2); g.fill(); }
  // the curve piece that point k (k >= 1) completes
  seg(st, k) {
    const p = st.pts; const g = this.g;
    this.pen(st);
    g.beginPath();
    if (k === 1) { g.moveTo(p[0][0] + 0.5, p[0][1] + 0.5); g.lineTo((p[0][0] + p[1][0]) / 2 + 0.5, (p[0][1] + p[1][1]) / 2 + 0.5); }
    else {
      const a = p[k - 2]; const b = p[k - 1]; const c = p[k];
      g.moveTo((a[0] + b[0]) / 2 + 0.5, (a[1] + b[1]) / 2 + 0.5);
      g.quadraticCurveTo(b[0] + 0.5, b[1] + 0.5, (b[0] + c[0]) / 2 + 0.5, (b[1] + c[1]) / 2 + 0.5);
    }
    g.stroke();
  }
  tail(st) {
    const p = st.pts; const n = p.length;
    if (n === 1) { this.dot(st); return; }
    const g = this.g; this.pen(st);
    g.beginPath();
    g.moveTo((p[n - 2][0] + p[n - 1][0]) / 2 + 0.5, (p[n - 2][1] + p[n - 1][1]) / 2 + 0.5);
    g.lineTo(p[n - 1][0] + 0.5, p[n - 1][1] + 0.5);
    g.stroke();
  }
  stroke(st, n = st.pts.length, done = true) {
    const p = st.pts;
    if (!n) return;
    if (n === 1) { if (done) this.dot(st); return; }
    const g = this.g; this.pen(st);
    g.beginPath();
    g.moveTo(p[0][0] + 0.5, p[0][1] + 0.5);
    g.lineTo((p[0][0] + p[1][0]) / 2 + 0.5, (p[0][1] + p[1][1]) / 2 + 0.5);
    for (let k = 2; k < n; k++) g.quadraticCurveTo(p[k - 1][0] + 0.5, p[k - 1][1] + 0.5, (p[k - 1][0] + p[k][0]) / 2 + 0.5, (p[k - 1][1] + p[k][1]) / 2 + 0.5);
    if (done) g.lineTo(p[n - 1][0] + 0.5, p[n - 1][1] + 0.5);
    g.stroke();
  }
  all(strokes) { this.reset(); for (const st of strokes) this.stroke(st); }
}

// Plays a drawing back on a Paper, at real speed squeezed into `cap` ms. `base` strokes are
// already on the paper (the half of a Half & Half drawing that was shown first).
function player(paper, strokes, { cap: capMs = REPLAY_CAP, onDone = () => {}, base = [] } = {}) {
  const { T, total } = timeline(strokes);
  const k = total > capMs ? total / capMs : 1;
  let si = 0; let pi = 0; let raf = 0; let t0 = 0; let done = false;
  const drawBase = () => { paper.reset(); for (const b of base) paper.stroke(b); };
  const finish = () => { if (done) return; done = true; cancelAnimationFrame(raf); onDone(); };
  const step = (now) => {
    if (!t0) t0 = now;
    const e = (now - t0) * k;
    while (si < strokes.length && T[si][pi] <= e) {
      const st = strokes[si];
      if (pi >= 1) paper.seg(st, pi);
      if (pi === st.pts.length - 1) { paper.tail(st); si++; pi = 0; } else pi++;
    }
    if (si >= strokes.length) finish(); else raf = requestAnimationFrame(step);
  };
  drawBase();
  raf = requestAnimationFrame(step);
  return {
    get done() { return done; },
    skip() { cancelAnimationFrame(raf); si = strokes.length; pi = 0; drawBase(); for (const st of strokes) paper.stroke(st); finish(); },
    stop() { cancelAnimationFrame(raf); done = true; },
    redraw() {
      drawBase();
      for (let i = 0; i < Math.min(si, strokes.length); i++) paper.stroke(strokes[i]);
      if (si < strokes.length && pi > 0) paper.stroke(strokes[si], pi, false);
    },
  };
}

const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export function mountDoodle(el, api, K) {
  const { DRAW_SECONDS, INK_CHARS, TIER_NAMES, POOL: PROMPTS, tierOf, encode, decode, charsOf, other, STAKES, EARLY } = K;
  el.innerHTML = '<div class="g-doodle"><div class="dd-scroll"></div><div class="dd-lb" hidden></div></div>';
  const root = el.firstChild;
  const scroller = root.querySelector('.dd-scroll');
  const lb = root.querySelector('.dd-lb');
  const nm = (w) => `<b class="p-${w}">${esc(api.name(w))}</b>`;
  let toks = api.tokens();
  const inks = () => [toks.ink, toks.a, toks.b, toks.good];
  const vs = { ack: {}, color: 0, size: 0, replayed: {}, galleryPlayed: false, wasOver: null, draft: null, early: {}, recorded: null };
  let ctx = null;
  let scr = null;
  let lbClose = null;
  let lbRedraw = null;

  // The game's shared data doc (bests, streaks, the seen-card list, the pinned drawing). Turn
  // games don't get api.data from the engine yet, so fall back to the engine's own accessor.
  const DB = typeof api.data === 'function' ? api : gameDataApi('doodle');
  const data = () => { try { return DB.data() || {}; } catch { return {}; } };
  const setData = (patch) => { try { DB.setData(patch); } catch { /* offline */ } };
  const dataSubs = new Set();
  const offData = typeof DB.onData === 'function' ? DB.onData(() => dataSubs.forEach((f) => { try { f(); } catch (e) { console.error(e); } })) : null;

  const v2 = () => !!ctx && ctx.state.v === 2;
  const nRounds = () => ctx.state.rounds.length;
  const kindOf = (s, R) => (s.v === 2 ? K.kindOf(s, R) : 'normal');
  const secsFor = (s, R) => (s.v === 2 ? K.drawSecondsFor(K.kindOf(s, R)) : DRAW_SECONDS);

  // Drafts survive a reload on this device: the drawing in progress (with its clock) and a
  // half-typed guess. One slot per match.
  const DRAFT = 'ju.doodle.draft.';
  const draftGet = (k) => { try { const v = JSON.parse(localStorage.getItem(DRAFT + ctx.matchId) || 'null'); return v && v.k === k ? v : null; } catch { return null; } };
  const draftPut = (k, d) => { try { if (d == null) localStorage.removeItem(DRAFT + ctx.matchId); else localStorage.setItem(DRAFT + ctx.matchId, JSON.stringify({ k, ...d })); } catch { /* storage off */ } };
  const drawSlot = () => `${ctx.viewer}|draw|${ctx.state.r}`;
  const saveDrawing = () => {
    const D = vs.draft;
    if (!D || D.sent || !ctx) return;
    draftPut(drawSlot(), { pick: D.pick, s: encode(D.strokes), left: Math.round(D.deadline - performance.now()), at: Date.now() });
  };
  function restoreDrawing() {
    const d = draftGet(drawSlot());
    if (!d || !Number.isInteger(d.pick) || d.pick < 0 || d.pick > 2) return false;
    const strokes = (d.s && decode(d.s)) || [];
    const now = performance.now();
    const left = Math.max(0, Number(d.left) - Math.max(0, Date.now() - Number(d.at)));
    vs.draft = { r: ctx.state.r, pick: d.pick, strokes, hist: strokes.map(() => ({ k: 'stroke' })), started: now, deadline: now + (Number.isFinite(left) ? left : 0), lastEnd: now, sent: false, secs: secsFor(ctx.state, ctx.state.rounds[ctx.state.r]) };
    if (ctx.state.r > 0) vs.ack[ctx.state.r - 1] = true; // they were past the reveal already
    return true;
  }

  // Keep a focused text box above the on-screen keyboard by scrolling our own scroller,
  // padding it by the keyboard's height when the visual viewport shrinks (iOS).
  const kbFix = () => {
    const a = document.activeElement;
    if (!a || !a.matches || !a.matches('.dd-input') || !root.contains(a)) return;
    const vv = window.visualViewport;
    const vb = vv ? vv.offsetTop + vv.height : window.innerHeight;
    scroller.style.setProperty('--kb', `${Math.max(0, Math.round(window.innerHeight - vb))}px`);
    const box = (a.form || a).getBoundingClientRect();
    const sb = scroller.getBoundingClientRect();
    const limit = Math.min(vb, sb.bottom) - 12;
    if (box.bottom > limit) scroller.scrollTop += box.bottom - limit;
    else if (box.top < sb.top + 8) scroller.scrollTop -= sb.top + 8 - box.top;
  };
  const kbSoon = () => { requestAnimationFrame(kbFix); clearTimeout(vs.kbT); vs.kbT = setTimeout(kbFix, 350); };
  const kbOff = () => { clearTimeout(vs.kbOffT); vs.kbOffT = setTimeout(() => { if (!root.contains(document.activeElement) || !document.activeElement.matches('.dd-input')) scroller.style.removeProperty('--kb'); }, 250); };
  root.addEventListener('focusin', kbSoon);
  root.addEventListener('focusout', kbOff);
  const vvp = typeof window !== 'undefined' ? window.visualViewport : null;
  if (vvp) { vvp.addEventListener('resize', kbSoon); vvp.addEventListener('scroll', kbSoon); }
  window.addEventListener('resize', kbSoon);

  const top = (s, right = '') => `<div class="dd-top"><span class="dd-round">Round ${Math.min(s.r + 1, s.rounds.length)}<i>/${s.rounds.length}</i></span>${right}<span class="dd-team">Team <b>${s.score}</b></span></div>`;
  const blanks = (text) => `<div class="dd-blanks" aria-label="${text.replace(/[^a-z0-9 ]/gi, '').split(' ').filter(Boolean).map((w) => w.length).join(', ')} letters">${text.split(/\s+/).map((w) => `<span>${'<i></i>'.repeat(w.replace(/[^a-z0-9]/gi, '').length)}</span>`).join('')}</div>`;
  const promptOf = (R) => PROMPTS[R.choices[R.pick]];
  // The twist banner (Mixed Bag) and, in the other modes, nothing: the mode is the twist.
  // The twist banner (Mixed Bag): one slim line, nothing for a plain round. `soft` banners (guess,
  // watch, wait) disappear on short screens, where the controls need the room.
  const twistBanner = (s, R, soft = false) => {
    if (s.v !== 2 || s.mode !== 'mixed' || !R || !R.twist || R.twist === 'normal') return '';
    const t = TWIST_INFO[R.twist];
    return `<div class="dd-twist t-${R.twist}${soft ? ' soft' : ''}" role="status"><b>${esc(t.title)}</b><span>${esc(t.pitch)}</span></div>`;
  };
  const payLine = (tier, kind) => `Pays ${STAKES[tier].join(' · ')}${kind === 'halfhalf' ? ` · early call ${EARLY[tier]}` : ''}`;

  // ── paper sizing: portrait stacks, landscape puts the paper left and the controls right ──
  const isLand = () => scroller.clientWidth >= scroller.clientHeight * 1.25 && scroller.clientHeight < 640;
  function applyLand(s) {
    if (!s || !s.el) return;
    s.el.classList.toggle('land', isLand());
    s.el.classList.toggle('short', scroller.clientHeight < 470);
  }
  // Make a paper inside `host` that is sized to fit the screen.
  function makePaper(host, { draw = false } = {}) {
    const box = document.createElement('div');
    box.className = 'dd-paper' + (draw ? ' can-draw' : '');
    const cv = document.createElement('canvas');
    box.appendChild(cv);
    host.replaceWith(box);
    return { box, cv, paper: new Paper(cv, inks) };
  }
  // scale the stamp text to the paper it sits on ("Time’s up" must fit a small paper)
  function sizeStamps(box, size) {
    box.querySelectorAll('.dd-stamp').forEach((st) => { st.style.fontSize = `${Math.round(Math.max(11, Math.min(36, (size * 0.86 - 22) / (st.textContent.trim().length * 0.95 + 0.8))))}px`; });
  }
  function fitPaper(s) {
    if (!s || !s.p) return;
    applyLand(s);
    const w = scroller.clientWidth - 8;
    let size;
    if (s.el.classList.contains('land')) {
      size = Math.floor(Math.max(150, Math.min(scroller.clientHeight - 10, w * 0.5, 520)));
    } else {
      s.el.style.minHeight = '0px';
      const others = s.el.offsetHeight - s.p.box.offsetHeight;
      s.el.style.minHeight = '';
      const avail = scroller.clientHeight - others - 4;
      size = Math.floor(Math.max(s.minPaper || 170, Math.min(w, avail, 520)));
    }
    if (Math.abs(size - s.p.paper.size) < 1) return;
    s.p.paper.fit(size);
    sizeStamps(s.p.box, size);
    s.redraw && s.redraw();
  }

  function setScreen(key, build) {
    if (scr && scr.key === key) { scr.refresh && scr.refresh(ctx); return; }
    if (scr) { try { scr.destroy && scr.destroy(); } catch (e) { console.error(e); } }
    closeLightbox();
    scroller.innerHTML = '';
    const node = document.createElement('div');
    node.className = 'dd-scr';
    scroller.appendChild(node);
    scroller.scrollTop = 0;
    applyLand({ el: node });
    scr = build(node) || {};
    scr.key = key;
    scr.el = node;
    node.classList.toggle('has-p', !!scr.p);
    fitPaper(scr);
    scr.refresh && scr.refresh(ctx);
  }

  // ── screens ──
  function blank(node) { node.innerHTML = ''; return {}; }

  // The first player chooses mode and cards before anything else happens.
  function setupScreen(node) {
    const s = ctx.state;
    const d = data();
    const lastMode = MODE_LIST.includes(d.lastMode) ? d.lastMode : null;
    const lastPack = PACK_LIST.includes(d.lastPack) ? d.lastPack : null;
    const sel = vs.setup || (vs.setup = { mode: lastMode || 'classic', pack: lastPack || 'classic' });
    const pinned = typeof d.pin_s === 'string' && d.pin_s ? decode(d.pin_s) : null;
    node.classList.add('dd-setup');
    node.innerHTML = `<div class="dd-head dd-sethead"><h2 class="dd-h">Set up the game</h2>${pinned && pinned.length ? `<div class="dd-fridge" role="img" aria-label="On the fridge: ${esc(cap(String(d.pin_t || 'our favourite')))}${d.pin_by === 'a' || d.pin_by === 'b' ? ` by ${esc(api.name(d.pin_by))}` : ''}"><div class="dd-fridge-pic"></div></div>` : ''}</div>
      <div class="dd-sec"><span class="g-label">How to play</span>
        <div class="dd-modes" role="radiogroup" aria-label="Mode">${MODE_LIST.map((m) => `<button class="dd-mode" role="radio" data-m="${m}" aria-checked="false"><b>${esc(MODE_INFO[m].title)}</b><span>${esc(MODE_INFO[m].pitch)}</span></button>`).join('')}</div></div>
      <div class="dd-sec"><span class="g-label">Which cards</span>
        <div class="dd-packs" role="radiogroup" aria-label="Cards">${PACK_LIST.map((p) => `<button class="dd-pack" role="radio" data-p="${p}" aria-checked="false" title="${esc(PACK_INFO[p].pitch)}">${esc(PACK_INFO[p].title)}</button>`).join('')}</div></div>
      <div class="dd-setup-foot"><button class="gm-btn gm-btn-big dd-start"></button></div>`;
    const startBtn = node.querySelector('.dd-start');
    const paint = () => {
      node.querySelectorAll('.dd-mode').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.m === sel.mode)));
      node.querySelectorAll('.dd-pack').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.p === sel.pack)));
      const same = lastMode && lastPack && sel.mode === lastMode && sel.pack === lastPack;
      startBtn.innerHTML = `${same ? 'Same again' : 'Start'}<small>${esc(MODE_INFO[sel.mode].title)} · ${esc(PACK_INFO[sel.pack].title)}</small>`;
      startBtn.disabled = !ctx.canMove || !!vs.setupSent;
    };
    node.querySelector('.dd-modes').addEventListener('click', (e) => { const b = e.target.closest('.dd-mode'); if (b) { sel.mode = b.dataset.m; api.sfx('tap'); paint(); } });
    node.querySelector('.dd-packs').addEventListener('click', (e) => { const b = e.target.closest('.dd-pack'); if (b) { sel.pack = b.dataset.p; api.sfx('tap'); paint(); } });
    startBtn.addEventListener('click', () => {
      if (!ctx.canMove || vs.setupSent) return;
      const fresh = K.dealFresh(sel.pack, decodeSeen(data().seen));
      vs.setupSent = true; paint();
      const res = api.move({ setup: { v: 2, mode: sel.mode, pack: sel.pack, deal: fresh.deal } });
      if (!res.ok) { vs.setupSent = false; api.toast(res.error); api.sfx('bad'); paint(); return; }
      api.sfx('flip');
      setData({ lastMode: sel.mode, lastPack: sel.pack, seen: encodeSeen(fresh.seen) });
    });
    let fridge = null;
    if (pinned && pinned.length) {
      const fp = new Paper(document.createElement('canvas'), inks);
      node.querySelector('.dd-fridge-pic').appendChild(fp.cv);
      fp.fit(44); fp.all(pinned);
      fridge = fp;
    }
    paint();
    return { refresh: paint, redraw() { if (fridge) fridge.all(pinned); } };
  }
  function setupWaitScreen(node) {
    const s = ctx.state;
    node.innerHTML = `<div class="dd-waiting">${PENCIL}<div class="dd-wait-name">${nm(s.first)} is picking the game</div><p class="dd-sub">Mode and cards first. Then the drawing starts.</p></div>`;
    return {};
  }

  function pickScreen(node) {
    const s = ctx.state; const R = s.rounds[s.r];
    const guesser = other(R.drawer);
    const is2 = s.v === 2;
    const kind = kindOf(s, R);
    const ladder = is2 && s.mode === 'ladder';
    const secs = secsFor(s, R);
    const cards = (ladder ? [R.tier] : [0, 1, 2]).map((i) => ({ i, pi: R.choices[i] }));
    const rung = ladder ? `<div class="dd-rungs" aria-label="Rung ${R.tier + 1} of 3">${[0, 1, 2].map((i) => `<i class="${i < R.tier ? 'done' : i === R.tier ? 'now' : ''}">${TIER_NAMES[i]}</i>`).join('')}</div>` : '';
    node.innerHTML = `<div class="dd-head">${top(s)}${twistBanner(s, R)}
        <h2 class="dd-h">${ladder ? 'Your card on the ladder' : 'Pick something to draw'}</h2>
        <p class="dd-sub">${nm(guesser)} has to guess it. You get ${secs} seconds.</p>${rung}</div>
      <div class="dd-picks">${cards.map(({ i, pi }) => `<button class="dd-pick" data-i="${i}">
          <span class="dd-tier t${tierOf(pi)}">${TIER_NAMES[tierOf(pi)]}</span>
          <span class="dd-pick-main"><span class="dd-pick-word ${fitWord(PROMPTS[pi].show)}">${esc(cap(PROMPTS[pi].show))}</span>${is2 ? `<span class="dd-pay">${esc(payLine(tierOf(pi), kind))}</span>` : ''}</span></button>`).join('')}</div>
      ${ladder ? '<p class="dd-note">Tap the card to start. Hit it and the next one is harder. A miss only drops one rung.</p>' : ''}
      ${ctx.mode === 'local' ? `<p class="dd-note">${esc(api.name(guesser))}, no peeking.</p>` : ''}`;
    node.querySelector('.dd-picks').addEventListener('click', (e) => {
      const b = e.target.closest('.dd-pick');
      if (!b || !ctx.canMove) return;
      api.sfx('flip'); api.haptic(8);
      const now = performance.now();
      vs.draft = { r: s.r, pick: Number(b.dataset.i), strokes: [], hist: [], started: now, deadline: now + secs * 1000, lastEnd: now, sent: false, secs };
      saveDrawing();
      render();
    });
    return {};
  }

  function drawScreen(node) {
    const s = ctx.state; const R = s.rounds[s.r];
    const D = vs.draft;
    const kind = kindOf(s, R);
    const secs = D.secs || secsFor(s, R);
    const word = PROMPTS[R.choices[D.pick]].show;
    node.innerHTML = `<div class="dd-head"><div class="dd-top">
          <span class="dd-word"><small>Round ${s.r + 1} of ${s.rounds.length} · draw</small>${esc(cap(word))}</span>
          <span class="dd-timer" role="timer" aria-label="Time left"><svg viewBox="0 0 26 26"><circle class="dd-ring-bg" cx="13" cy="13" r="9.5"/><circle class="dd-ring" cx="13" cy="13" r="9.5" stroke-dasharray="59.7" stroke-dashoffset="0"/></svg><span class="dd-secs">${fmtClock(secs)}</span></span>
        </div>${twistBanner(s, R)}</div>
        <div class="dd-ph"></div>
        <div class="dd-foot">
        <div class="dd-tools">
          <div class="dd-group" role="radiogroup" aria-label="Ink">${['Ink', `${api.name('a')}’s colour`, `${api.name('b')}’s colour`, 'Green'].map((n, i) => `<button class="dd-swatch" role="radio" data-c="${i}" aria-label="${esc(n)}" aria-checked="${vs.color === i}" style="--ink:${INK_VARS[i]}"><i></i></button>`).join('')}</div>
          <div class="dd-group" role="radiogroup" aria-label="Brush"><button class="dd-size" role="radio" data-s="0" aria-label="Thin brush" aria-checked="${vs.size === 0}"><i></i></button><button class="dd-size" role="radio" data-s="1" aria-label="Thick brush" aria-checked="${vs.size === 1}"><i></i></button></div>
        </div>
        <div class="dd-actions">
          <button class="dd-tool" data-a="undo" aria-label="Undo">${ICON.undo}</button>
          <button class="dd-tool" data-a="clear" aria-label="Clear">${ICON.clear}</button>
          <button class="gm-btn dd-send">Send drawing</button>
        </div></div>`;
    const p = makePaper(node.querySelector('.dd-ph'), { draw: true });
    const ink = document.createElement('div');
    ink.className = 'dd-ink'; ink.innerHTML = '<i></i>';
    p.box.appendChild(ink);
    if (kind === 'invisible') p.box.insertAdjacentHTML('beforeend', '<span class="dd-papernote">Ink fades</span>');
    if (kind === 'oneline') p.box.insertAdjacentHTML('beforeend', '<span class="dd-papernote">One line</span>');
    const cv = p.cv;
    const timerEl = node.querySelector('.dd-timer');
    const secsEl = node.querySelector('.dd-secs');
    const ring = node.querySelector('.dd-ring');
    let active = null;
    let lastSec = -1;
    let warnedInk = false;
    let retryT = 0;
    let oneToast = false;
    const fade = kind === 'invisible';
    const fades = [];
    let fadeRaf = 0;

    const used = () => charsOf(D.strokes) + (active ? 4 * active.st.pts.length + 4 : 0);
    const paintInk = () => {
      const f = used() / INK_CHARS;
      ink.classList.toggle('on', f > 0.45);
      ink.classList.toggle('low', f > 0.85);
      ink.firstChild.style.width = `${Math.min(100, f * 100)}%`;
    };
    const paintTools = () => {
      node.querySelector('[data-a="undo"]').disabled = !D.hist.length || D.sent;
      node.querySelector('[data-a="clear"]').disabled = !D.strokes.length || D.sent;
      node.querySelector('.dd-send').disabled = !D.strokes.length || !ctx.canMove || D.sent;
      node.querySelectorAll('.dd-swatch').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.c) === vs.color)));
      node.querySelectorAll('.dd-size').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.s) === vs.size)));
      p.box.classList.toggle('locked', !!D.locked);
      paintInk();
    };
    // Invisible Ink: strokes stay for a moment after the pen lifts, then fade (view only).
    const fadeFrame = (now) => {
      fadeRaf = 0;
      p.paper.reset();
      const g = p.paper.g;
      let live = false;
      for (const f of fades) {
        const age = now - f.end;
        const a = reduced() ? (age < 600 ? 1 : 0) : age < 150 ? 1 : Math.max(0, 1 - (age - 150) / 450);
        if (a > 0) { g.globalAlpha = a; p.paper.stroke(f.st); live = true; }
      }
      g.globalAlpha = 1;
      if (active) { p.paper.stroke(active.st, active.st.pts.length, false); live = true; }
      while (fades.length && now - fades[0].end > 650) fades.shift();
      if (live || fades.length) fadeRaf = requestAnimationFrame(fadeFrame);
    };
    const kick = () => { if (!fadeRaf) fadeRaf = requestAnimationFrame(fadeFrame); };

    const send = () => {
      if (D.sent || !ctx.canMove) return false;
      if (active) endStroke();
      let mv;
      if (D.strokes.length) mv = { prompt: D.pick, strokes: encode(D.strokes) };
      else if (s.v === 2) mv = { prompt: D.pick, timeUp: true };
      else return false;
      const res = api.move(mv);
      if (res.ok) { D.sent = true; vs.draft = null; draftPut('', null); api.sfx('pop'); api.haptic(15); return true; }
      api.toast(res.error);
      return false;
    };
    const trySend = (n = 0) => {
      if (D.sent || vs.draft !== D) return;
      if (send()) return;
      if (n < 3) retryT = setTimeout(() => trySend(n + 1), 1500);
      else { D.locked = false; paintTools(); } // let them fix it by hand
    };
    const lockPaper = () => { if (active) endStroke(); D.locked = true; paintTools(); };
    // v1 rules can't take a blank drawing: nudge once, give a short grace to scribble something.
    const nudge = () => {
      api.toast('Time’s up! Draw anything and send it.');
      D.locked = false; D.grace = performance.now() + 10000;
      paintTools();
    };
    const timeUp = () => {
      lockPaper();
      if (D.strokes.length || s.v === 2) trySend(); else nudge();
    };
    const tick = () => {
      const now = performance.now();
      const left = Math.max(0, D.deadline - now);
      const sec = Math.ceil(left / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        secsEl.textContent = fmtClock(sec);
        timerEl.classList.toggle('low', sec <= 10);
        if (sec <= 5 && sec > 0) api.sfx('tick');
      }
      if (left <= 0 && !D.over && ctx.canMove && !D.sent) { D.over = true; timerEl.classList.add('zero'); timeUp(); }
      if (D.grace && now > D.grace && !D.sent) { D.grace = 0; lockPaper(); if (D.strokes.length) trySend(); else nudge(); }
      ring.setAttribute('stroke-dashoffset', String(59.7 * (1 - left / (secs * 1000))));
    };

    const gridPt = (ev, rect) => {
      const x = Math.round(((ev.clientX - rect.left) / rect.width) * 256 - 0.5);
      const y = Math.round(((ev.clientY - rect.top) / rect.height) * 256 - 0.5);
      return [Math.max(0, Math.min(255, x)), Math.max(0, Math.min(255, y))];
    };
    const addPoint = (ev) => {
      const [x, y] = gridPt(ev, active.rect);
      const pts = active.st.pts;
      const now = ev.timeStamp || performance.now();
      if (pts.length) {
        const l = pts[pts.length - 1];
        const dx = x - l[0]; const dy = y - l[1];
        if (dx * dx + dy * dy < 3) return;
      }
      if (charsOf(D.strokes) + 1 + 3 + 4 * (pts.length + 1) > INK_CHARS) {
        if (!warnedInk) { warnedInk = true; api.toast('Out of ink! Send it as it is.'); api.sfx('bad'); }
        return;
      }
      const dt = pts.length ? Math.max(0, Math.min(255, Math.round((now - active.t) / 8))) : 0;
      active.t = now;
      pts.push([x, y, dt]);
      if (fade) kick(); else if (pts.length >= 2) p.paper.seg(active.st, pts.length - 1);
    };
    const endStroke = () => {
      const a = active; active = null;
      if (!a) return;
      if (a.st.pts.length) {
        if (fade) { fades.push({ st: a.st, end: performance.now() }); kick(); } else p.paper.tail(a.st);
        D.strokes.push(a.st);
        D.hist.push({ k: 'stroke' });
        D.lastEnd = performance.now();
        saveDrawing();
        if (D.grace) { D.grace = 0; lockPaper(); trySend(); }
      }
      paintTools();
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!ctx.canMove || D.sent || active || D.locked) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      if (kind === 'oneline' && D.strokes.length) {
        if (!oneToast) { oneToast = true; api.toast('One line only. Undo to try again.'); }
        return;
      }
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      const now = performance.now();
      if (charsOf(D.strokes) + 8 > INK_CHARS) { if (!warnedInk) { warnedInk = true; api.toast('Out of ink! Send it as it is.'); } return; }
      active = { id: e.pointerId, rect: cv.getBoundingClientRect(), t: e.timeStamp || now, st: { c: vs.color, s: vs.size, gap: Math.min(4095, Math.round((now - D.lastEnd) / 10)), pts: [] } };
      addPoint(e);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!active || e.pointerId !== active.id) return;
      e.preventDefault();
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ev of list.length ? list : [e]) addPoint(ev);
      paintInk();
    });
    const up = (e) => { if (active && e.pointerId === active.id) { e.preventDefault(); endStroke(); } };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('lostpointercapture', up);
    const stopTouch = (e) => e.preventDefault();
    cv.addEventListener('touchstart', stopTouch, { passive: false });
    cv.addEventListener('touchmove', stopTouch, { passive: false });
    cv.addEventListener('contextmenu', stopTouch);

    const redrawAll = () => { if (fade) { fades.length = 0; p.paper.reset(); kick(); } else p.paper.all(D.strokes); };
    node.querySelector('.dd-tools').addEventListener('click', (e) => {
      const sw = e.target.closest('.dd-swatch'); const sz = e.target.closest('.dd-size');
      if (sw) { vs.color = Number(sw.dataset.c); api.sfx('tap'); }
      if (sz) { vs.size = Number(sz.dataset.s); api.sfx('tap'); }
      paintTools();
    });
    node.querySelector('[data-a="undo"]').addEventListener('click', () => {
      if (D.locked && !D.grace && D.over) return;
      const h = D.hist.pop();
      if (!h) return;
      if (h.k === 'stroke') D.strokes.pop(); else D.strokes = h.prev;
      redrawAll(); api.sfx('flip'); paintTools(); saveDrawing();
    });
    node.querySelector('[data-a="clear"]').addEventListener('click', () => {
      if (!D.strokes.length || (D.locked && D.over)) return;
      D.hist.push({ k: 'clear', prev: D.strokes }); D.strokes = [];
      redrawAll(); api.sfx('hit'); api.haptic(20); paintTools(); saveDrawing();
    });
    node.querySelector('.dd-send').addEventListener('click', () => { send(); });
    paintTools();
    const timer = setInterval(tick, 200);
    tick();
    return {
      p, minPaper: 150,
      redraw() { if (fade) kick(); else { p.paper.all(D.strokes); if (active) p.paper.stroke(active.st, active.st.pts.length, false); } },
      refresh() { paintTools(); },
      destroy() { clearInterval(timer); clearTimeout(retryT); if (fadeRaf) cancelAnimationFrame(fadeRaf); },
    };
  }

  // The pay for each guess slot (v2): [3, 2, 1] style, with the early call first in Half & Half.
  function slotsOf(s, R, half) {
    if (s.v !== 2) return [null, null, null];
    const st = STAKES[R.tier];
    if (!half) return [st[0], st[1], st[2]];
    return R.rest && !R.early ? [st[1], st[2]] : [EARLY[R.tier], st[1], st[2]];
  }

  function guessScreen(node) {
    const s = ctx.state; const r = s.r; const R0 = s.rounds[r];
    const kind = kindOf(s, R0);
    const half = kind === 'halfhalf';
    const prompt = promptOf(R0);
    const strokes = decode(R0.strokes) || [];
    // Half & Half: whole strokes up to the split, or (one-stroke drawings) the first part of the stroke
    const plan = half ? K.halfPlan(R0.strokes) : { k: strokes.length, cut: 0 };
    const baseStrokes = strokes.slice(0, plan.k);
    const partial = plan.cut && strokes[plan.k] ? [{ ...strokes[plan.k], pts: strokes[plan.k].pts.slice(0, plan.cut) }] : [];
    const firstHalf = [...baseStrokes, ...partial];
    const secondHalf = strokes.slice(plan.k);
    const prev = s.rounds[r - 1];
    const recap = prev && prev.drawer === ctx.viewer && ctx.mode === 'local'
      ? `<p class="dd-note">Last round ${esc(api.name(other(ctx.viewer)))} ${prev.points ? `got your ${esc(PROMPTS[prev.choices[prev.pick]].show)} (+${prev.points})` : `missed your ${esc(PROMPTS[prev.choices[prev.pick]].show)}`}.</p>` : '';
    node.innerHTML = `<div class="dd-head">${top(s, `<span class="dd-by">by ${nm(R0.drawer)}</span>`)}${twistBanner(s, R0, true)}</div>
      <div class="dd-ph"></div>
      <div class="dd-foot">
        ${blanks(prompt.show)}
        <div class="dd-half" hidden>
          <button class="gm-btn dd-know" type="button">I know it!<small></small></button>
          <button class="gm-btn gm-btn-ghost dd-rest" type="button">Show me the rest</button>
        </div>
        <div class="dd-tries"><span class="dd-pips" aria-label="Guesses"></span><span class="dd-chips"></span></div>
        <form class="dd-form" autocomplete="off"><input class="dd-input" name="g" maxlength="40" placeholder="What is it?" aria-label="Your guess" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send"><button class="gm-btn" type="submit">Guess</button></form>
        <div class="dd-actrow"><button class="dd-unearly" type="button" hidden>Never mind, show me the rest</button><button class="dd-giveup" type="button">Give up</button></div>
        ${recap}
      </div>`;
    const p = makePaper(node.querySelector('.dd-ph'));
    const btn = document.createElement('button');
    btn.className = 'dd-over-btn';
    p.box.appendChild(btn);
    const input = node.querySelector('.dd-input');
    const form = node.querySelector('.dd-form');
    const give = node.querySelector('.dd-giveup');
    const unearly = node.querySelector('.dd-unearly');
    const halfBox = node.querySelector('.dd-half');
    const gSlot = `${ctx.viewer}|guess|${r}`;
    const saved = draftGet(gSlot);
    if (saved && typeof saved.t === 'string') input.value = saved.t.slice(0, 40);
    input.addEventListener('input', () => draftPut(gSlot, input.value ? { t: input.value } : null));
    let pl = null;
    let seen = R0.guesses.length;
    let armT = 0;
    let stage = null; // 'full' | 'half' | 'rest'
    const stageOf = (RR) => (!half ? 'full' : RR.rest ? 'rest' : 'half');
    const setBtn = () => {
      if (pl && !pl.done) btn.innerHTML = `${ICON.skip}<span>Skip</span>`;
      else btn.innerHTML = `${ICON.replay}<span>Replay</span>`;
      btn.setAttribute('aria-label', pl && !pl.done ? 'Skip the replay' : 'Replay the drawing');
    };
    const done = () => { vs.replayed[r] = true; setBtn(); };
    const playFull = () => { if (pl) pl.stop(); pl = player(p.paper, strokes, { onDone: done }); setBtn(); };
    const playFirst = () => { if (pl) pl.stop(); pl = player(p.paper, firstHalf, { onDone: setBtn }); setBtn(); };
    const playRest = () => { if (pl) pl.stop(); pl = player(p.paper, secondHalf, { base: baseStrokes, onDone: done }); setBtn(); };
    const showStatic = () => { if (pl) pl.stop(); pl = null; p.paper.all(stage === 'half' ? firstHalf : strokes); setBtn(); };
    btn.addEventListener('click', () => {
      if (pl && !pl.done) pl.skip();
      else if (stage === 'half') playFirst(); else playFull();
      api.sfx('tap');
    });
    const sendGuess = (early) => {
      if (!ctx.canMove) return;
      const g = input.value.trim();
      if (!g) { input.focus({ preventScroll: true }); return; }
      const res = api.move(early ? { guess: g, early: true } : { guess: g });
      if (!res.ok) { api.toast(res.error); api.sfx('bad'); return; }
      input.value = '';
      draftPut(gSlot, null);
      vs.early[r] = false;
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); sendGuess(stage === 'half'); });
    node.querySelector('.dd-know').addEventListener('click', () => {
      if (!ctx.canMove) return;
      vs.early[r] = true; api.sfx('tap'); refresh();
      input.focus({ preventScroll: true });
    });
    const showRest = () => {
      if (!ctx.canMove) return;
      const res = api.move({ rest: true });
      if (!res.ok) api.toast(res.error); else { api.sfx('flip'); vs.early[r] = false; }
    };
    node.querySelector('.dd-rest').addEventListener('click', showRest);
    unearly.addEventListener('click', showRest); // the way back from an early call you have not sent
    give.addEventListener('click', () => {
      if (!ctx.canMove) return;
      if (!give.classList.contains('armed')) {
        give.classList.add('armed'); give.textContent = 'Really? Tap again to give up';
        clearTimeout(armT); armT = setTimeout(() => { give.classList.remove('armed'); give.textContent = 'Give up'; }, 3000);
        return;
      }
      const res = api.move({ giveUp: true });
      if (!res.ok) api.toast(res.error); else api.sfx('lose');
    });
    const refresh = () => {
      const RR = ctx.state.rounds[r];
      const was = stage;
      stage = stageOf(RR);
      const slots = slotsOf(ctx.state, RR, half);
      node.querySelector('.dd-pips').innerHTML = slots.map((pay, i) => `<i class="${i < RR.guesses.length ? 'used' : ''}${pay != null ? ' pay' : ''}">${pay != null ? pay : ''}</i>`).join('');
      node.querySelector('.dd-chips').innerHTML = RR.guesses.map((g, i) => {
        const close = K.nearMiss(g, prompt);
        return `<span class="dd-chip no ${i >= seen ? 'new' : ''}">${ICON.no}${esc(g)}${close ? '<em>So close!</em>' : ''}</span>`;
      }).join(' ');
      if (RR.guesses.length > seen) {
        api.sfx('bad'); api.haptic(30);
        input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
        seen = RR.guesses.length;
      }
      const wantEarly = stage === 'half' && !!vs.early[r];
      halfBox.hidden = stage !== 'half' || wantEarly;
      form.hidden = stage === 'half' && !wantEarly;
      unearly.hidden = !wantEarly;
      unearly.disabled = !ctx.canMove;
      node.querySelector('.dd-know small').textContent = `+${EARLY[RR.tier]} if right`;
      input.disabled = !ctx.canMove;
      form.querySelector('button').disabled = !ctx.canMove;
      give.disabled = !ctx.canMove;
      node.querySelector('.dd-know').disabled = !ctx.canMove;
      node.querySelector('.dd-rest').disabled = !ctx.canMove;
      const left = slots.length - RR.guesses.length;
      input.placeholder = stage === 'half' ? `Early call: +${EARLY[RR.tier]} if right` : left <= 1 ? 'Last guess…' : left === 3 ? 'What is it?' : `${left} guesses left`;
      if (was && was !== stage && stage === 'rest') { if (reduced()) showStatic(); else playRest(); }
      if (scr && scr.p === p) fitPaper(scr); // the controls below changed height
    };
    return {
      p, minPaper: 120,
      redraw() { if (pl && !pl.done) pl.redraw(); else p.paper.all(stage === 'half' ? firstHalf : strokes); },
      refresh,
      start() {
        const RR = ctx.state.rounds[r];
        stage = stageOf(RR);
        if (reduced()) { showStatic(); return; }
        if (stage === 'half') playFirst();
        else if (stage === 'rest') { if (vs.replayed[r]) showStatic(); else playRest(); }
        else if (vs.replayed[r]) showStatic(); else playFull();
      },
      destroy() { if (pl) pl.stop(); clearTimeout(armT); },
    };
  }

  // The round that just ended, shown to the guesser (then they draw next) or to the drawer while they wait.
  function resultBlock(R, viewer, s) {
    const word = cap(promptOf(R).show);
    const guesser = other(R.drawer);
    const prompt = promptOf(R);
    const chips = R.guesses.map((g, i) => {
      const ok = R.points > 0 && i === R.guesses.length - 1;
      return `<span class="dd-chip ${ok ? 'yes' : 'no'}">${ok ? ICON.yes : ICON.no}${esc(g)}${!ok && K.nearMiss(g, prompt) ? '<em>So close!</em>' : ''}</span>`;
    }).join('');
    const early = R.early === 'hit';
    const line = R.timeUp
      ? (viewer === R.drawer ? 'Time ran out before you could send it.' : `${esc(api.name(R.drawer))} ran out of time.`)
      : R.points > 0
        ? (viewer === guesser ? `You got it on guess ${R.guesses.length}${early ? ', an early call' : ''}.` : `${esc(api.name(guesser))} got it on guess ${R.guesses.length}${early ? ', an early call' : ''}.`)
        : R.gaveUp ? (viewer === guesser ? 'You gave up on this one.' : `${esc(api.name(guesser))} gave up.`)
          : (viewer === guesser ? (s && s.v === 2 ? 'Out of guesses. So close.' : 'Three misses. So close.') : `${esc(api.name(guesser))} couldn’t get it.`);
    const extras = [];
    if (R.points > 0 && R.bonus) extras.push(`+1 ${{ invisible: 'invisible ink', sprint: 'sprint', oneline: 'one-line' }[s ? K.kindOf(s, R) : ''] || 'twist'} bonus`);
    const gold = R.gold
      ? (R.x2 ? '<div class="dd-goldbar">Golden Frame. Double points!</div>' : '<div class="dd-goldbar">That was the Golden Frame round. A hit would have paid double.</div>')
      : '';
    const stamp = R.points > 0 ? `<div class="dd-stamp good anim">+${R.points}</div>` : `<div class="dd-stamp bad anim">${R.timeUp ? 'Time’s up' : R.gaveUp ? 'Pass' : 'Missed'}</div>`;
    return { word, chips, line, extras, gold, stamp };
  }

  function revealScreen(node, ri, { next = false, waiting = false } = {}) {
    const s = ctx.state; const R = s.rounds[ri];
    const strokes = decode(R.strokes) || [];
    const b = resultBlock(R, ctx.viewer, s);
    const nextDrawer = s.rounds[s.r] ? s.rounds[s.r].drawer : null;
    const last = s.r >= s.rounds.length;
    node.innerHTML = `<div class="dd-head">${top({ ...s, r: ri })}</div>
      <div class="dd-ph"></div>
      <div class="dd-foot">
        <div class="dd-answer"><small>It was</small><b>${esc(b.word)}</b></div>
        <p class="dd-note">${b.line}</p>
        ${b.extras.length ? `<p class="dd-bonus">${b.extras.map(esc).join(' · ')}</p>` : ''}
        ${b.gold}
        ${b.chips ? `<div class="dd-glist">${b.chips}</div>` : ''}
        ${next ? `<div class="dd-stick"><button class="gm-btn dd-next">${last ? 'See the gallery' : 'Your turn to draw'}</button>
          ${ctx.mode === 'local' && nextDrawer ? `<p class="dd-note">${esc(api.name(other(nextDrawer)))}, look away while ${esc(api.name(nextDrawer))} picks.</p>` : ''}</div>` : ''}
        ${waiting ? `<div class="dd-waiting">${PENCIL}<div class="dd-wait-name">${nm(nextDrawer)} is drawing</div><p class="dd-sub">Your turn to guess is next.</p></div>` : ''}
      </div>`;
    const p = makePaper(node.querySelector('.dd-ph'));
    if (R.gold) p.box.classList.add('gold');
    p.box.insertAdjacentHTML('beforeend', reduced() ? b.stamp.replace(' anim', '') : b.stamp);
    if (next) {
      node.querySelector('.dd-next').addEventListener('click', () => {
        vs.ack[ri] = true; api.sfx('tap');
        clearTimeout(vs.toGallery);
        render();
        if (last) api.showEnd();
      });
    }
    if (R.points > 0) api.sfx(R.x2 ? 'win' : 'good'); else api.sfx('bad');
    return { p, minPaper: 130, redraw() { p.paper.all(strokes); } };
  }

  function waitDrawScreen(node) {
    const s = ctx.state; const R = s.rounds[s.r];
    const prev = s.rounds[s.r - 1];
    if (prev && prev.drawer === ctx.viewer) return revealScreen(node, s.r - 1, { waiting: true });
    node.innerHTML = `<div class="dd-head">${top(s)}${twistBanner(s, R, true)}</div>
      <div class="dd-waiting">${PENCIL}<div class="dd-wait-name">${nm(R.drawer)} is drawing something</div><p class="dd-sub">You’ll watch it replay, then guess.</p></div>`;
    return {};
  }

  function watchScreen(node) {
    const s = ctx.state; const r = s.r; const R = s.rounds[r];
    const strokes = decode(R.strokes) || [];
    const guesser = other(R.drawer);
    const half = kindOf(s, R) === 'halfhalf';
    const prompt = promptOf(R);
    node.innerHTML = `<div class="dd-head">${top(s)}${twistBanner(s, R, true)}</div>
      <div class="dd-ph"></div>
      <div class="dd-foot">
        <div class="dd-answer"><small>You drew</small><b>${esc(cap(promptOf(R).show))}</b></div>
        <div class="dd-live" aria-live="polite"></div>
      </div>`;
    const p = makePaper(node.querySelector('.dd-ph'));
    let seen = R.guesses.length;
    const live = node.querySelector('.dd-live');
    return {
      p, minPaper: 130,
      redraw() { p.paper.all(strokes); },
      refresh() {
        const RR = ctx.state.rounds[r];
        const slots = slotsOf(ctx.state, RR, half).length;
        live.innerHTML = RR.guesses.map((g, i) => `<div class="dd-live-row no ${i >= seen ? 'new' : ''}">${ICON.no}<span>${esc(g)}</span>${K.nearMiss(g, prompt) ? '<em>So close!</em>' : ''}<small>${RR.early && i === 0 ? 'Early call' : `Guess ${i + 1}`}</small></div>`).join('')
          + `<div class="dd-live-row"><span>${nm(guesser)} ${half && !RR.rest && !RR.guesses.length ? 'sees half your drawing' : 'is guessing'}</span><span class="dd-dots"><i></i><i></i><i></i></span><small>${slots - RR.guesses.length} left</small></div>`;
        if (RR.guesses.length > seen) { api.sfx('flip'); seen = RR.guesses.length; }
        if (scr && scr.p === p) fitPaper(scr);
      },
    };
  }

  function openLightbox(ri) {
    const s = ctx.state; const R = s.rounds[ri];
    const strokes = decode(R.strokes) || [];
    const b = resultBlock(R, null, s);
    const pinId = `${ctx.matchId}:${ri}`;
    const pinned = () => data().pin === pinId;
    lb.innerHTML = `<div class="dd-lb-card ${reduced() ? '' : 'anim'}" role="dialog" aria-label="${esc(b.word)}">
      <div class="dd-lb-top"><div class="dd-answer"><small>Round ${ri + 1} · by ${esc(api.name(R.drawer))}</small><b>${esc(b.word)}</b></div>
        <button class="dd-tool" data-a="close" aria-label="Close">${ICON.close}</button></div>
      <div class="dd-ph"></div>
      <p class="dd-note">${b.line}</p>
      ${b.chips ? `<div class="dd-glist">${b.chips}</div>` : ''}
      ${strokes.length ? '<button class="gm-btn gm-btn-ghost dd-pin" type="button"></button>' : ''}
    </div>`;
    lb.hidden = false;
    const p = makePaper(lb.querySelector('.dd-ph'));
    if (R.gold) p.box.classList.add('gold');
    const size = Math.floor(Math.max(150, Math.min(lb.clientWidth - 52, 420, lb.clientHeight - 270)));
    p.paper.fit(size);
    sizeStamps(p.box, size);
    const btn = document.createElement('button');
    btn.className = 'dd-over-btn';
    p.box.appendChild(btn);
    let pl = null;
    const setBtn = () => { btn.innerHTML = pl && !pl.done ? `${ICON.skip}<span>Skip</span>` : `${ICON.replay}<span>Replay</span>`; };
    const play = () => { if (pl) pl.stop(); pl = player(p.paper, strokes, { onDone: setBtn }); setBtn(); };
    btn.addEventListener('click', () => { if (pl && !pl.done) pl.skip(); else play(); });
    if (reduced()) { p.paper.all(strokes); setBtn(); } else play();
    lb.querySelector('[data-a="close"]').addEventListener('click', closeLightbox);
    const pinBtn = lb.querySelector('.dd-pin');
    if (pinBtn) {
      const paintPin = () => { const on = pinned(); pinBtn.textContent = on ? 'Unpin from the fridge' : 'Pin to the fridge'; pinBtn.setAttribute('aria-pressed', String(on)); };
      paintPin();
      pinBtn.addEventListener('click', () => {
        if (pinned()) setData({ pin: '', pin_s: '', pin_t: '', pin_by: '' });
        else if (R.strokes.length > 8000) { api.toast('That one is too detailed to pin.'); return; }
        else { setData({ pin: pinId, pin_s: R.strokes, pin_t: promptOf(R).show, pin_by: R.drawer }); api.sfx('pop'); }
        paintPin();
      });
    }
    lbClose = () => { if (pl) pl.stop(); };
    lbRedraw = () => { if (pl && !pl.done) pl.redraw(); else p.paper.all(strokes); };
    api.sfx('pop');
  }
  function closeLightbox() {
    if (lbClose) { lbClose(); lbClose = null; }
    lbRedraw = null;
    lb.hidden = true; lb.innerHTML = '';
  }
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });

  function galleryScreen(node) {
    const s = ctx.state;
    const n = s.rounds.length;
    const got = s.rounds.filter((R) => R.points > 0).length;
    const is2 = s.v === 2;
    const max = K.maxScore(s);
    const sum = summarize(s, tierOf);
    const badges = badgesOf(sum);
    const tilts = [-1.6, 1.2, 0.9, -1.1, -0.7, 1.5, -0.9];
    const modeName = is2 ? MODE_INFO[s.mode].title : 'Classic';
    node.innerHTML = `<div class="dd-gal-head">
        <span class="dd-gal-kicker">The gallery${is2 ? ` · ${esc(modeName)}` : ''}</span>
        <div class="dd-plaque"><b>${s.score}<small>/${max}</small></b><span>${esc(ctx.result ? ctx.result.text : '')}</span></div>
        <p class="dd-gal-hint">${got} of ${n} guessed. Tap a drawing to watch it again.</p>
      </div>
      <div class="dd-strip" hidden></div>
      <div class="dd-badges">${['a', 'b'].map((w) => `<div class="dd-badge2 p-${w}-b"><span class="dd-badge2-who">${esc(api.name(w))}</span><b>${esc(badges[w].title)}</b><span>${esc(badges[w].line)}</span></div>`).join('')}</div>
      <p class="dd-history" hidden></p>
      <p class="dd-chase" hidden></p>
      <div class="dd-wall">${s.rounds.map((R, i) => `<button class="dd-frame${R.gold ? ' gold' : ''}" data-i="${i}" style="--tilt:${tilts[i % tilts.length]}deg" aria-label="Round ${i + 1}: ${esc(PROMPTS[R.choices[R.pick]].show)} by ${esc(api.name(R.drawer))}${R.gold ? ', golden frame' : ''}">
          <canvas></canvas>
          <span class="dd-frame-title">${esc(cap(PROMPTS[R.choices[R.pick]].show))}</span>
          <span class="dd-frame-meta">by ${nm(R.drawer)}${R.gold ? ' · golden' : ''}${is2 && s.mode === 'mixed' && R.twist && R.twist !== 'normal' ? ` · ${esc(TWIST_INFO[R.twist].title)}` : ''}</span>
          <span class="dd-frame-pts ${R.points ? '' : 'zero'}">${R.points ? `+${R.points}` : R.timeUp ? 'time up' : R.gaveUp ? 'pass' : 'missed'}</span>
          ${R.gold ? '<span class="dd-frame-gold">Golden</span>' : ''}
        </button>`).join('')}</div>
      <div class="dd-gal-actions"><button class="gm-btn" data-g="rematch">Play again</button><button class="gm-btn gm-btn-ghost" data-g="close">Back to games</button></div>`;
    const stripEl = node.querySelector('.dd-strip');
    const historyEl = node.querySelector('.dd-history');
    const chaseEl = node.querySelector('.dd-chase');
    // The records strip reads the shared doc: the phone that ended the match wrote it, the other
    // one sees it as soon as it syncs.
    const paintStrip = () => {
      const d = data();
      if (d.lastRec !== ctx.matchId) { stripEl.hidden = true; historyEl.hidden = true; chaseEl.hidden = true; return; }
      const mt = d.rc_mode === 'v1' ? 'Classic' : (MODE_INFO[d.rc_mode] || { title: 'Classic' }).title;
      const stamps = stampsOf(d, mt);
      stripEl.hidden = !stamps.length;
      stripEl.innerHTML = stamps.map((x) => `<div class="dd-stamp2 s-${x.id}"><b>${esc(x.text)}</b><span>${esc(x.sub)}</span></div>`).join('');
      historyEl.hidden = false; historyEl.textContent = historyLine(d, mt);
      const chase = chaseLine(d, { a: api.name('a'), b: api.name('b') });
      chaseEl.hidden = !chase; chaseEl.textContent = chase;
    };
    dataSubs.add(paintStrip);
    paintStrip();
    const frames = [...node.querySelectorAll('.dd-frame')];
    const papers = frames.map((f) => new Paper(f.querySelector('canvas'), inks));
    const drawings = s.rounds.map((R) => decode(R.strokes) || []);
    const players = papers.map(() => null);
    const waiting = papers.map(() => false);
    const layout = () => {
      const w = node.clientWidth;
      const cols = w >= 520 ? 3 : 2;
      node.querySelector('.dd-wall').style.setProperty('--cols', cols);
      const size = Math.floor((Math.min(w, 560) - 8 - 24 - 14 * (cols - 1)) / cols - 24);
      papers.forEach((pp, i) => {
        if (Math.abs(pp.size - size) < 1) return;
        pp.fit(size);
        if (waiting[i]) return;
        if (players[i] && !players[i].done) players[i].redraw(); else pp.all(drawings[i]);
      });
    };
    layout();
    // The drawings sketch themselves once, as soon as the gallery is actually in view
    // (the end card sits on top of it at first).
    const timers = [];
    let mo = null;
    const playAll = () => {
      if (mo) { mo.disconnect(); mo = null; }
      papers.forEach((pp, i) => {
        timers.push(setTimeout(() => { waiting[i] = false; players[i] = player(pp, drawings[i], { cap: 2600 }); }, 250 + i * 260));
      });
    };
    if (!vs.galleryPlayed && !reduced()) {
      vs.galleryPlayed = true;
      papers.forEach((pp, i) => { waiting[i] = true; pp.reset(); });
      const end = el.closest('.gm') && el.closest('.gm').querySelector('.gm-end');
      if (!end || typeof MutationObserver !== 'function') playAll();
      else {
        let seenEnd = !end.hidden;
        mo = new MutationObserver(() => {
          if (!end.hidden) seenEnd = true;
          else if (seenEnd) playAll();
        });
        mo.observe(end, { attributes: true, attributeFilter: ['hidden'] });
        timers.push(setTimeout(() => { if (mo && !seenEnd) playAll(); }, 4500));
      }
    }
    node.querySelector('.dd-wall').addEventListener('click', (e) => {
      const f = e.target.closest('.dd-frame');
      if (f) openLightbox(Number(f.dataset.i));
    });
    const redraw = () => papers.forEach((pp, i) => {
      if (waiting[i]) return;
      if (players[i] && !players[i].done) players[i].redraw(); else pp.all(drawings[i]);
    });
    return { layout, redraw, destroy() { dataSubs.delete(paintStrip); timers.forEach(clearTimeout); if (mo) mo.disconnect(); players.forEach((pl) => pl && pl.stop()); } };
  }

  // ── records: the one device that ended the match writes it, once ──
  function maybeRecord() {
    const c = ctx;
    if (!c || !c.over || vs.recorded === c.matchId || vs.wasOver !== false) return;
    const mine = c.mode === 'local' || (c.last && c.me && c.last.who === c.me);
    if (!mine) return;
    vs.recorded = c.matchId;
    const d = data();
    if (d.lastRec === c.matchId) return;
    const mode = c.state.v === 2 ? c.state.mode : 'v1';
    setData(recordPatch(summarize(c.state, tierOf), d, { matchId: c.matchId, mode, score: c.state.score }));
  }

  // ── routing ──
  function render() {
    const c = ctx;
    if (!c) return;
    const s = c.state;
    const v = c.viewer;
    if (c.over) {
      const lastR = s.rounds.length - 1;
      if (vs.wasOver === false && !vs.ack[lastR]) {
        // we watched the last guess land: show it first, then the gallery
        setScreen(`reveal:${lastR}`, (n) => revealScreen(n, lastR, { next: true }));
        return;
      }
      setScreen('gallery', galleryScreen);
      return;
    }
    if (!v) { setScreen('blank', blank); return; }
    // a fresh match: the first player chooses mode and cards
    if (!s.v && c.moves === 0) {
      if (v === s.first && c.canMove) setScreen('setup', setupScreen);
      else setScreen('setupwait', setupWaitScreen);
      return;
    }
    const R = s.rounds[s.r];
    const prev = s.rounds[s.r - 1];
    if (s.phase === 'draw') {
      if (v === R.drawer) {
        if ((!vs.draft || vs.draft.r !== s.r) && c.canMove) restoreDrawing();
        if (prev && !vs.ack[s.r - 1]) { setScreen(`reveal:${s.r - 1}`, (n) => revealScreen(n, s.r - 1, { next: true })); return; }
        if (vs.draft && vs.draft.r === s.r && !vs.draft.sent) { setScreen(`draw:${s.r}`, drawScreen); return; }
        setScreen(`pick:${s.r}`, pickScreen);
        return;
      }
      setScreen(`wait:${s.r}`, waitDrawScreen);
      return;
    }
    if (v === R.drawer) setScreen(`watch:${s.r}`, watchScreen);
    else {
      const fresh = !scr || scr.key !== `guess:${s.r}`;
      setScreen(`guess:${s.r}`, guessScreen);
      if (fresh && scr.start) scr.start();
    }
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { fitPaper(scr); if (scr && scr.layout) scr.layout(); }) : null;
  if (ro) ro.observe(scroller);
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const onTheme = () => {
    requestAnimationFrame(() => {
      toks = api.tokens();
      if (scr && scr.redraw) scr.redraw();
      if (lbRedraw) lbRedraw();
    });
  };
  if (mq && mq.addEventListener) mq.addEventListener('change', onTheme);
  const themeMo = typeof MutationObserver === 'function' ? new MutationObserver(onTheme) : null;
  if (themeMo) themeMo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  const noGesture = (e) => e.preventDefault();
  root.addEventListener('gesturestart', noGesture);

  return {
    update(c) {
      ctx = c;
      toks = api.tokens();
      if (c.over) maybeRecord();
      render();
      if (vs.wasOver === null || !c.over) vs.wasOver = c.over;
      if (c.over) draftPut('', null);
      const lastR = c.state.rounds.length - 1;
      if (c.over && scr && scr.key === `reveal:${lastR}`) {
        // the last result gets a proper moment; a tap on the button skips ahead
        clearTimeout(vs.toGallery);
        vs.toGallery = setTimeout(() => { vs.ack[lastR] = true; render(); api.showEnd(); }, 4200);
      }
    },
    destroy() {
      clearTimeout(vs.toGallery);
      if (scr && scr.destroy) scr.destroy();
      closeLightbox();
      if (ro) ro.disconnect();
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onTheme);
      if (themeMo) themeMo.disconnect();
      if (typeof offData === 'function') offData();
      clearTimeout(vs.kbT); clearTimeout(vs.kbOffT);
      root.removeEventListener('focusin', kbSoon);
      root.removeEventListener('focusout', kbOff);
      if (vvp) { vvp.removeEventListener('resize', kbSoon); vvp.removeEventListener('scroll', kbSoon); }
      window.removeEventListener('resize', kbSoon);
      root.removeEventListener('gesturestart', noGesture);
    },
  };
}
