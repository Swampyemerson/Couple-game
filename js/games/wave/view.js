// Same Wave: the view. Draws v1 and v2 matches (derive everything from the state: round count, max, twists).
import { gameDataApi } from '../core.js';
import { MODES, MODE_IDS, PACKS, PACK_IDS, TWIST_INFO, BETS, DEAL_LEN, MAX_CLUE, poolFor, maxOf } from './rules.js';
import { BASE_CARDS, NEW_CARDS } from './cards.js';
import { clueOfNight, badgesOf, recordPatch, stampsOf, historyLine, chaseLine, pickDeal } from './records.js';

// ── dial geometry (SVG user units) ──
const CX = 120; const CY = 128; const R = 108;
const pt = (v, r) => { const a = Math.PI * (v / 100); return [CX - r * Math.cos(a), CY - r * Math.sin(a)]; };
const f1 = (n) => Math.round(n * 10) / 10;
const FACE = `M${CX - R} ${CY}A${R} ${R} 0 0 1 ${CX + R} ${CY}Z`;
const wedge = (v1, v2, r) => {
  const a = pt(Math.max(0, v1), r); const b = pt(Math.min(100, v2), r);
  return `M${CX} ${CY}L${f1(a[0])} ${f1(a[1])}A${r} ${r} 0 0 1 ${f1(b[0])} ${f1(b[1])}Z`;
};
const NEEDLE = `M${CX - 7.5} ${CY}L${CX - 2.6} ${CY - R + 20}Q${CX} ${CY - R + 11} ${CX + 2.6} ${CY - R + 20}L${CX + 7.5} ${CY}Z`;
const TICKS = (() => {
  let s = '';
  for (let v = 0; v <= 100; v += 5) {
    const major = v % 25 === 0;
    const [x1, y1] = pt(v, R - 3); const [x2, y2] = pt(v, R - (major ? 15 : 9));
    s += `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" class="wv-tick${major ? ' major' : ''}"/>`;
  }
  return s;
})();
const BANDS = [[17, 2], [10, 3], [4, 4]]; // half-width, points (widest first)
const RATIO = 156 / 240; // the dial's viewBox, height over width

const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOutBack = (k) => { const c = 1.5; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const other = (w) => (w === 'a' ? 'b' : 'a');
let uid = 0;

const nR = (s) => s.rounds.length;
const isV2 = (s) => s.v === 2;
const twOf = (s, Rd) => (isV2(s) && Rd.tw) || 'normal';
const maxFor = (s) => (isV2(s) ? maxOf(s) : nR(s) * 4);
const scoreBefore = (s, ri) => s.rounds.slice(0, ri).reduce((n, R) => n + (R.points || 0), 0);
const cardOf = (CARDS, i) => (i < BASE_CARDS ? CARDS[i] : NEW_CARDS[i - BASE_CARDS]);
const labelFor = (Rd, d) => (Rd.sure && d > 10 ? 'Sure? Not this time' : d <= 4 ? 'Bullseye' : d <= 10 ? 'So close' : d <= 17 ? 'Near enough' : 'Missed');

// A miss that stung: nudge, never scold. d is how far off the guess was.
export function nearMiss(Rd, d) {
  if (Rd.sure) return d >= 11 && d <= 12 ? 'Just missed the 6!' : ''; // Sure either paid its full 6 or is a clear miss
  if (d >= 5 && d <= 6) return `${d - 4} off the bullseye!`;
  if (d >= 11 && d <= 12) return 'Just missed 3 points';
  if (d >= 18 && d <= 19) return 'Just missed 2 points';
  return '';
}

export function createWaveView(el, api, env) {
  el.innerHTML = '<div class="g-wave"><div class="wv-scroll"></div></div>';
  const root = el.firstChild;
  const scroller = root.querySelector('.wv-scroll');
  const nm = (w) => `<b class="p-${w}">${esc(api.name(w))}</b>`;
  const plain = (t) => t.replace(/\{a\}/g, api.name('a')).replace(/\{b\}/g, api.name('b'));
  const label = (t) => esc(plain(t));
  const cardTxt = (i) => { const c = cardOf(env.CARDS, i); return `${plain(c[0])} ↔ ${plain(c[1])}`; };
  const vs = { ack: {}, fresh: false, wasOver: null, toRecap: 0, recorded: false, recapAnimated: false, busy: false };
  let ctx = null;
  let scr = null;
  const rafs = new Set();
  const cleanups = [];
  const onCleanup = (fn) => cleanups.push(fn);
  // The turn-game api doesn't carry the per-game data doc (only the live api does), so use the engine's own accessor.
  const store = typeof api.data === 'function' ? api : gameDataApi('wave');
  const dataOf = () => { try { return (typeof store.data === 'function' && store.data()) || {}; } catch { return {}; } };
  const putData = (patch) => { try { if (typeof store.setData === 'function') store.setData(patch); } catch (e) { console.error(e); } };

  // Drafts survive a reload on this device: a half-typed clue, or where the dial was left.
  const DRAFT = 'ju.wave.draft.';
  const draftGet = (k) => { try { const v = JSON.parse(localStorage.getItem(DRAFT + ctx.matchId) || 'null'); return v && v.k === k ? v : null; } catch { return null; } };
  const draftPut = (k, data) => { try { if (data == null) localStorage.removeItem(DRAFT + ctx.matchId); else localStorage.setItem(DRAFT + ctx.matchId, JSON.stringify({ k, ...data })); } catch { /* storage off */ } };

  // Which reveals this device has already seen (and moved past): a reload must not replay them with Next locked.
  const MEMO = 'ju.wave.memo.';
  const memoGet = () => { try { const v = JSON.parse(localStorage.getItem(MEMO + ctx.matchId) || 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  const memoPut = (patch) => { try { localStorage.setItem(MEMO + ctx.matchId, JSON.stringify({ ...memoGet(), ...patch })); } catch { /* storage off */ } };
  const acked = (i) => !!vs.ack[i] || (Number.isInteger(memoGet().ack) && memoGet().ack >= i);

  // Keep the focused clue box above the on-screen keyboard: scroll our own scroller, padded by
  // the keyboard's height when only the visual viewport shrinks (iOS).
  const kb = { t: 0, off: 0 };
  const kbFix = () => {
    const a = document.activeElement;
    if (!a || !a.matches || !a.matches('.wv-input') || !root.contains(a)) return;
    const vv = window.visualViewport;
    const vb = vv ? vv.offsetTop + vv.height : window.innerHeight;
    scroller.style.setProperty('--kb', `${Math.max(0, Math.round(window.innerHeight - vb))}px`);
    const box = (a.form || a).getBoundingClientRect();
    const sb = scroller.getBoundingClientRect();
    const limit = Math.min(vb, sb.bottom) - 8;
    if (box.bottom > limit) scroller.scrollTop += box.bottom - limit;
    else if (box.top < sb.top + 8) scroller.scrollTop -= sb.top + 8 - box.top;
  };
  const kbSoon = () => { requestAnimationFrame(kbFix); clearTimeout(kb.t); kb.t = setTimeout(kbFix, 350); };
  const kbOff = () => { clearTimeout(kb.off); kb.off = setTimeout(() => { if (!root.contains(document.activeElement) || !document.activeElement.matches('.wv-input')) scroller.style.removeProperty('--kb'); }, 250); };
  root.addEventListener('focusin', kbSoon);
  root.addEventListener('focusout', kbOff);
  const vvp = window.visualViewport || null;
  if (vvp) { vvp.addEventListener('resize', kbSoon); vvp.addEventListener('scroll', kbSoon); }
  window.addEventListener('resize', kbSoon);

  function animate(ms, fn, done) {
    if (reduced()) { fn(1); if (done) done(); return; }
    const t0 = performance.now();
    const step = (now) => {
      rafs.delete(id);
      const k = Math.min(1, (now - t0) / ms);
      fn(k);
      if (k < 1) { id = requestAnimationFrame(step); rafs.add(id); } else if (done) done();
    };
    let id = requestAnimationFrame(step);
    rafs.add(id);
  }

  // A needle on a spring. Positions are dial values (0..100). The simulation runs in fixed 1/120 s steps from the real
  // rAF time (clamped), and what is drawn is interpolated between the last two steps, so it moves the same at 30, 60 and
  // 120 Hz and never stutters when a frame is late. The ends are walls: it bounces off them, never past.
  function spring(apply, { x = 50, k = 520, z = 0.86, wall = 0.35 } = {}) {
    const c = 2 * z * Math.sqrt(k); const H = 1 / 120;
    let prev = x; let cur = x; let v = 0; let target = x; let acc = 0; let last = 0; let id = 0; let dead = false;
    const frame = (now) => {
      rafs.delete(id); id = 0;
      if (dead) return;
      let dt = last ? Math.min(0.05, (now - last) / 1000) : H;
      last = now;
      acc += dt;
      while (acc >= H) {
        prev = cur;
        v += (k * (target - cur) - c * v) * H;
        cur += v * H;
        if (cur > 100) { cur = 100; v = -v * wall; } else if (cur < 0) { cur = 0; v = -v * wall; }
        acc -= H;
      }
      if (Math.abs(target - cur) < 0.01 && Math.abs(v) < 0.02) { cur = prev = target; v = 0; last = 0; apply(cur); return; }
      apply(prev + (cur - prev) * (acc / H));
      id = requestAnimationFrame(frame); rafs.add(id);
    };
    const run = () => { if (!id && !dead) { id = requestAnimationFrame(frame); rafs.add(id); } };
    return {
      to(t) { target = t; if (reduced()) { cur = prev = t; v = 0; apply(t); return; } run(); },
      kick(dv) { if (reduced()) return; v += dv; run(); },
      snap(t) { cur = prev = target = t; v = 0; apply(t); },
      get value() { return cur; },
      stop() { dead = true; if (id) { cancelAnimationFrame(id); rafs.delete(id); id = 0; } },
    };
  }

  // ── small pieces ──
  const twistChip = (s, Rd) => {
    const tw = twOf(s, Rd);
    if (tw !== 'normal') return `<span>${esc(TWIST_INFO[tw].name)}</span>`;
    return '';
  };
  const top = (s, ri = s.r, shown = null, dvText = 'this card again') => {
    const i = Math.min(ri, nR(s) - 1);
    const Rd = s.rounds[i];
    // Déjà vu always has a strip of its own, whatever the twist and the screen size
    const dv = Rd.dv ? `<div class="wv-dvb"><span>Déjà vu</span> ${esc(dvText)}</div>` : '';
    return `<div class="wv-top"><span class="wv-round">Round ${i + 1}<i>/${nR(s)}</i></span><span class="wv-tw">${twistChip(s, Rd)}</span><span class="wv-team">Team <b>${shown == null ? scoreBefore(s, ri) : shown}</b></span></div>${dv}`;
  };
  const ruleLine = (s, Rd) => {
    const parts = [];
    const tw = twOf(s, Rd);
    if (tw !== 'normal' && TWIST_INFO[tw].rule) parts.push(`<b>${esc(TWIST_INFO[tw].name)}.</b> ${esc(TWIST_INFO[tw].rule)}`);
    if (Rd.dv) {
      const R0 = s.rounds[0];
      parts.push(`Round 1 had “${esc(R0.clue || '')}” on this card. New target.`);
    }
    return parts.length ? `<p class="wv-rule">${parts.join(' ')}</p>` : '';
  };
  const ARROW_L = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ARROW_R = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const fit = (t) => {
    const n = Math.max(...t.split(/[\s-]+/).map((w) => w.length));
    const byWord = n >= 13 ? 3 : n >= 11 ? 2 : n >= 9 ? 1 : 0;
    const byLen = t.length >= 24 ? 3 : t.length >= 18 ? 2 : t.length >= 13 ? 1 : 0;
    return ['', 'fm', 'fs', 'fxs'][Math.max(byWord, byLen)];
  };
  const cardHTML = (c) => { const [l, r] = cardOf(env.CARDS, c).map(label); return `<div class="wv-card"><div class="wv-end l ${fit(l)}">${ARROW_L}<span>${l}</span></div><div class="wv-end r ${fit(r)}"><span>${r}</span>${ARROW_R}</div></div>`; };
  const dots = '<span class="wv-dots"><i></i><i></i><i></i></span>';

  // Build a dial inside `host` (the flexible middle of the screen) and size it from the room it has.
  // zone: target (only when the viewer may see it). lid: the hiding screen. needle: { at, who, gold } or null.
  function dial(host, { card, zone = null, lid = false, needle = null, ghost = false, jp = false }) {
    const id = `wv${++uid}`;
    const VB = 'viewBox="0 -4 240 156"';
    // The dial is a stack of layers with the same box: the static face, the zone, the lid, grain, ticks, the needle and
    // the plinth. The needle and the lid are plain elements turned with CSS transforms (compositor only), so
    // moving them never repaints the artwork; only the zone paints while it opens.
    const zoneSvg = zone == null ? '' : `<svg class="wv-lay wv-zl" ${VB} aria-hidden="true"><defs><clipPath id="${id}c"><path d="${FACE}"/></clipPath>${[[2, 3], [3, 6]].map(([p, w]) => `<pattern id="${id}s${p}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="8" height="8" class="wv-hlsoft"/><rect width="${w}" height="8" class="wv-hlfill"/></pattern>`).join('')}</defs>
      <g class="wv-zone" clip-path="url(#${id}c)">${BANDS.map(([, p]) => `<path class="wv-zb${p}" d=""${p < 4 ? ` fill="url(#${id}s${p})"` : ''}/>`).join('')}</g></svg>`;
    const labelsSvg = zone == null ? '' : `<g class="wv-zlabels">${[2, 3, 4, 3, 2].map(() => '<text></text>').join('')}</g>`;
    const lidHtml = lid ? `<div class="wv-lidclip"><div class="wv-lidrot"><svg class="wv-lay" ${VB} aria-hidden="true"><defs><pattern id="${id}h" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><line x1="0" y1="0" x2="0" y2="8" class="wv-hatch"/></pattern></defs><path class="wv-lid-face" d="${FACE}"/><path d="${FACE}" fill="url(#${id}h)"/></svg></div></div>` : '';
    const needleHtml = needle ? `<div class="wv-nl sh"><svg class="wv-lay" viewBox="108 -4 24 132" aria-hidden="true"><path class="wv-needle-shadow" d="${NEEDLE}"/></svg></div>
      <div class="wv-nl n"><svg class="wv-lay" viewBox="108 -4 24 132" aria-hidden="true"><path class="wv-needle ${needle.who}${needle.gold ? ' jp' : ''}" d="${NEEDLE}"/></svg></div>` : '';
    host.innerHTML = `<div class="wv-dialbox"><div class="wv-dial${jp ? ' jp' : ''}" aria-label="Dial"><svg class="wv-svg" ${VB} aria-hidden="true">
      <path class="wv-shadow" d="${FACE}" transform="translate(4 4)"/>
      <rect class="wv-plinth-shadow" x="8" y="${CY + 2}" width="232" height="16" rx="4"/>
      <path class="wv-face" d="${FACE}"/>
    </svg>
      ${zoneSvg}
      ${lidHtml}
      <div class="wv-grainface" aria-hidden="true"></div>
      <svg class="wv-lay wv-lmid" ${VB} aria-hidden="true">
        ${ghost ? `<path class="wv-ghost" d="M${CX} ${CY}L${CX} ${CY - R + 14}"/>` : ''}
        ${TICKS}
        <path class="wv-rim" d="${FACE}"/>
      </svg>
      ${needleHtml}
      <svg class="wv-lay wv-ltop" ${VB} aria-hidden="true">
        ${labelsSvg}
        <rect class="wv-plinth" x="4" y="${CY - 1}" width="232" height="16" rx="4"/>
        <circle class="wv-hub" cx="${CX}" cy="${CY}" r="13"/><circle class="wv-hub-dot" cx="${CX}" cy="${CY}" r="4.5"/>
      </svg></div>${cardHTML(card)}</div>`;
    const box = host.firstChild;
    const d = box.querySelector('.wv-dial');
    const svg = box.querySelector('svg');
    const nlShadow = box.querySelector('.wv-nl.sh');
    const nlNeedle = box.querySelector('.wv-nl.n');
    const lidEl = box.querySelector('.wv-lidrot');
    const lidClip = box.querySelector('.wv-lidclip');
    // 3 user units to the right and down, as a share of the needle box (24 wide, 132 tall) (the shadow is lit from a fixed side)
    const setNeedle = (v) => {
      if (!nlNeedle) return;
      const a = Math.round((v - 50) * 180) / 100;
      nlNeedle.style.transform = `rotate(${a}deg)`;
      nlShadow.style.transform = `translate(12.5%, 2.27%) rotate(${a}deg)`;
    };
    const zPaths = [...box.querySelectorAll('.wv-zone path')];
    const zTexts = [...box.querySelectorAll('.wv-zlabels text')];
    const setZone = (k) => {
      if (zone == null) return;
      const paths = zPaths;
      BANDS.forEach(([w], i) => paths[i].setAttribute('d', wedge(zone - w * k, zone + w * k, R - 1)));
      const texts = zTexts;
      [[-13.5, 2], [-7, 3], [0, 4], [7, 3], [13.5, 2]].forEach(([o, p], i) => {
        const v = zone + o * k;
        const tx = texts[i];
        if (v < 1.5 || v > 98.5 || k < 0.6) { tx.textContent = ''; return; }
        const [x, y] = pt(v, R - 26);
        tx.setAttribute('x', f1(x)); tx.setAttribute('y', f1(y)); tx.textContent = p;
      });
    };
    const setLid = (deg) => {
      if (!lidEl) return;
      lidEl.style.transform = `rotate(${f1(deg)}deg)`;
      lidClip.style.visibility = deg <= -179.5 ? 'hidden' : '';
    };
    if (needle) setNeedle(needle.at);
    setZone(1);
    // size: as wide as the room allows, but never so tall that the dial and its card leave the screen
    const run = () => {
      const W = host.clientWidth; const H = host.clientHeight;
      if (!W || !H) return;
      const card = box.querySelector('.wv-card');
      // the card is as wide as the room allows (up to 300); the dial above it as big as the height allows
      box.style.width = `${Math.min(W, 300)}px`;
      box.style.setProperty('--dw', '100%');
      const ch = card ? card.offsetHeight - 6 : 0;
      const w = Math.max(130, Math.min(W, 480, Math.floor((H - ch - 8) / RATIO)));
      box.style.width = `${Math.max(w, Math.min(W, 300))}px`;
      box.style.setProperty('--dw', `${w}px`);
    };
    let ro = null;
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(run); ro.observe(host); }
    window.addEventListener('resize', run);
    onCleanup(() => { if (ro) ro.disconnect(); window.removeEventListener('resize', run); });
    run();
    return { box, d, svg, setNeedle, setZone, setLid, run };
  }

  function setScreen(key, build, kind = 'dial') {
    if (scr && scr.key === key) { scr.refresh && scr.refresh(); return; }
    if (scr && scr.destroy) { try { scr.destroy(); } catch (e) { console.error(e); } }
    while (cleanups.length) { try { cleanups.pop()(); } catch (e) { console.error(e); } }
    scroller.innerHTML = '';
    const node = document.createElement('div');
    node.className = `wv-scr ${kind === 'dial' ? 'dialscr' : 'flow'}`;
    scroller.appendChild(node);
    scroller.scrollTop = 0;
    scr = build(node) || {};
    scr.key = key;
    scr.refresh && scr.refresh();
  }

  // ── setup (the first player picks the game) ──
  function setupScreen(node) {
    const d0 = dataOf();
    const slot = `${ctx.viewer}|setup`;
    const saved = draftGet(slot);
    let remembered = MODE_IDS.includes(d0.lastMode) && PACK_IDS.includes(d0.lastPack);
    let mode = MODE_IDS.includes(d0.lastMode) ? d0.lastMode : 'classic';
    let pack = PACK_IDS.includes(d0.lastPack) ? d0.lastPack : 'everything';
    let changed = false;
    // a reload mid-setup keeps what was picked
    if (saved && MODE_IDS.includes(saved.mode) && PACK_IDS.includes(saved.pack)) { mode = saved.mode; pack = saved.pack; changed = !!saved.changed; }
    const modeName = () => MODES.find((m) => m.id === mode).name;
    const packName = () => PACKS.find((p) => p.id === pack).name;
    node.innerHTML = `<h2 class="wv-h wv-seth">How shall we play?</h2>
      <div class="wv-modes" role="radiogroup" aria-label="Game mode">${MODES.map((m) => `<button class="wv-mode" type="button" role="radio" data-mode="${m.id}"><b>${esc(m.name)}</b></button>`).join('')}</div>
      <p class="wv-pitch" aria-live="polite"></p>
      <p class="wv-lab">Cards</p>
      <div class="wv-packs" role="radiogroup" aria-label="Card pack">${PACKS.map((p) => `<button class="wv-pack" type="button" role="radio" data-pack="${p.id}">${esc(p.name)}</button>`).join('')}</div>
      <p class="wv-note wv-packnote"></p>
      <div class="wv-sticky"><button class="gm-btn gm-btn-big wv-start" type="button"></button></div>`;
    const start = node.querySelector('.wv-start');
    const paint = () => {
      node.querySelectorAll('.wv-mode').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
      node.querySelectorAll('.wv-pack').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.pack === pack)));
      node.querySelector('.wv-pitch').textContent = MODES.find((m) => m.id === mode).pitch;
      const p = PACKS.find((x) => x.id === pack);
      node.querySelector('.wv-packnote').textContent = `${p.pitch} · ${poolFor(pack).length} cards`;
      start.textContent = `${remembered && !changed ? 'Same again' : 'Start'}: ${modeName()} · ${packName()}`;
    };
    const remember = () => draftPut(slot, { mode, pack, changed });
    node.querySelector('.wv-modes').addEventListener('click', (e) => { const b = e.target.closest('.wv-mode'); if (!b) return; mode = b.dataset.mode; changed = true; api.sfx('tap'); paint(); remember(); });
    node.querySelector('.wv-packs').addEventListener('click', (e) => { const b = e.target.closest('.wv-pack'); if (!b) return; pack = b.dataset.pack; changed = true; api.sfx('tap'); paint(); remember(); });
    start.addEventListener('click', () => {
      if (!ctx.canMove || vs.busy) return;
      vs.busy = true; start.disabled = true;
      const { deal, seen } = pickDeal(poolFor(pack), dataOf(), Math.random, DEAL_LEN);
      const res = api.move({ setup: { v: 2, mode, pack, deal } });
      if (res.ok) { draftPut(slot, null); putData({ lastMode: mode, lastPack: pack, seen }); api.sfx('pop'); api.haptic(12); } else { api.toast(res.error); api.sfx('bad'); vs.busy = false; start.disabled = false; }
    });
    paint();
    return { refresh() { start.disabled = !ctx.canMove || vs.busy; } };
  }

  function waitSetupScreen(node) {
    node.innerHTML = `<h2 class="wv-h">${nm(ctx.first)} is choosing how to play</h2>
      <div class="wv-wait"><span>Mode and cards, then the first clue</span> ${dots}</div>`;
    return {};
  }

  // ── a round ──
  function clueScreen(node) {
    const s = ctx.state; const Rd = s.rounds[s.r];
    const guesser = other(Rd.giver);
    const tw = twOf(s, Rd);
    node.innerHTML = `<div class="wv-head">${top(s)}${tw === 'bet' ? '' : ruleLine(s, Rd)}<p class="wv-sub">Write a clue that lands on the yellow 4.</p></div>
      <div class="wv-main"></div>
      <div class="wv-foot">
        ${tw === 'bet' ? `<div class="wv-wager"><span>Optional bet on how close ${esc(api.name(guesser))} lands. Right call: +1</span><div class="wv-wgs">${Object.entries(BETS).map(([k, b]) => `<button class="wv-wg" type="button" data-wg="${k}" aria-pressed="false">${b.name}<small>${b.def}</small></button>`).join('')}</div></div>` : ''}
        <form class="wv-form" autocomplete="off"><div class="wv-field"><input class="wv-input" maxlength="${MAX_CLUE}" placeholder="${tw === 'oneword' ? 'One word' : 'Your clue'}" aria-label="Your clue" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send"><span class="wv-count">0 / ${MAX_CLUE}</span></div><button class="gm-btn" type="submit" disabled>Send</button></form>
        <p class="wv-note warn" hidden></p>
        <span class="wv-secret">Only you can see the target${ctx.mode === 'local' ? `. ${esc(api.name(guesser))}, look away` : ''}</span>
      </div>`;
    dial(node.querySelector('.wv-main'), { card: Rd.card, zone: Rd.target, ghost: false });
    const input = node.querySelector('.wv-input');
    const btn = node.querySelector('.wv-form .gm-btn');
    const count = node.querySelector('.wv-count');
    const warn = node.querySelector('.wv-note.warn');
    const slot = `${ctx.viewer}|clue|${s.r}`;
    let bet = null;
    const paintBet = () => node.querySelectorAll('.wv-wg').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.wg === bet)));
    const saveDraft = () => draftPut(slot, input.value || bet ? { t: input.value, bet } : null);
    const paintCount = () => {
      const bad = tw === 'oneword' && /\s/.test(input.value.trim());
      btn.disabled = !input.value.trim() || bad || vs.busy;
      count.textContent = `${input.value.length} / ${MAX_CLUE}`;
      warn.hidden = !bad; warn.textContent = bad ? 'One word only. No spaces!' : '';
    };
    const saved = draftGet(slot);
    if (saved && typeof saved.t === 'string') input.value = saved.t.slice(0, MAX_CLUE);
    if (saved && typeof saved.bet === 'string' && BETS[saved.bet]) bet = saved.bet;
    paintBet(); paintCount();
    input.addEventListener('input', () => { paintCount(); saveDraft(); });
    node.querySelectorAll('.wv-wg').forEach((b) => b.addEventListener('click', () => { bet = bet === b.dataset.wg ? null : b.dataset.wg; api.sfx('tap'); paintBet(); saveDraft(); }));
    node.querySelector('.wv-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!ctx.canMove || vs.busy) return;
      const clue = input.value.trim();
      if (!clue) { api.toast('Write a clue first.'); input.focus(); return; }
      const mv = { clue };
      if (tw === 'bet' && bet) mv.bet = bet;
      vs.busy = true; btn.disabled = true;
      const res = api.move(mv);
      if (res.ok) { draftPut(slot, null); api.sfx('pop'); api.haptic(12); } else { api.toast(res.error); api.sfx('bad'); vs.busy = false; paintCount(); }
    });
    return { refresh() { paintCount(); } };
  }

  function clueBubble(Rd, anim = false) {
    return `<div class="wv-clue ${anim && !reduced() ? 'anim' : ''}"><small>${esc(api.name(Rd.giver))}’s clue</small><b>“${esc(Rd.clue)}”</b></div>`;
  }

  function lastLine(s, ri) {
    const P = s.rounds[ri];
    if (!P || P.points == null) return '';
    return `<div class="wv-last"><span>Last round</span><b>“${esc(P.clue)}”</b><span style="margin-left:auto">${P.points ? `+${P.points}` : 'missed'}</span></div>`;
  }

  function guessScreen(node) {
    const s = ctx.state; const r = s.r; const Rd = s.rounds[r];
    const me = other(Rd.giver);
    const tw = twOf(s, Rd);
    node.innerHTML = `<div class="wv-head">${top(s)}${ruleLine(s, Rd)}${clueBubble(Rd, true)}</div>
      <div class="wv-main"></div>
      <div class="wv-foot">
        <div class="wv-actions">${tw === 'sure' ? '<button class="wv-sure" type="button" aria-pressed="false">Sure<small>6 within 10, else 0</small></button>' : ''}<button class="gm-btn wv-go">Lock it in</button></div>
        <p class="wv-note opt">Drag the needle to where the clue belongs.</p>
        ${ctx.mode === 'online' ? lastLine(s, r - 1) : ''}
      </div>`;
    const slot = `${ctx.viewer}|dial|${r}`;
    const savedAt = draftGet(slot);
    let value = savedAt && Number.isInteger(savedAt.at) && savedAt.at >= 0 && savedAt.at <= 100 ? savedAt.at : 50;
    let sure = tw === 'sure' && !!(savedAt && savedAt.sure);
    let shown = value;
    const D = dial(node.querySelector('.wv-main'), { card: Rd.card, lid: true, needle: { at: value, who: me } });
    const dEl = D.d;
    dEl.classList.add('live');
    dEl.tabIndex = 0;
    dEl.setAttribute('role', 'slider');
    dEl.setAttribute('aria-valuemin', '0');
    dEl.setAttribute('aria-valuemax', '100');
    dEl.setAttribute('aria-label', `Dial from ${plain(cardOf(env.CARDS, Rd.card)[0])} to ${plain(cardOf(env.CARDS, Rd.card)[1])}`);
    let lastTick = 0; let lastStep = Math.round(value / 2); let dragging = null;
    const paintAria = () => { dEl.setAttribute('aria-valuenow', String(value)); dEl.setAttribute('aria-valuetext', `${value} of 100`); };
    // the needle follows the finger on a (nearly critically damped) spring: a transform per frame, nothing else
    const needleSp = spring((x) => {
      shown = x;
      D.setNeedle(x);
      const step = Math.round(x / 2);
      if (step !== lastStep) {
        lastStep = step;
        const now = performance.now();
        if (now - lastTick > 32) { lastTick = now; api.sfx('tick'); api.haptic(4); }
      }
    }, { x: value });
    const save = () => draftPut(slot, { at: value, sure });
    const setValue = (v) => {
      const nv = Math.max(0, Math.min(100, Math.round(v)));
      if (nv === value) return;
      value = nv; paintAria();
      save();
      needleSp.to(nv);
    };
    // the dial's box is measured once per touch (never per move); the move maths is plain arithmetic on it
    let mb = null;
    const measure = () => { const r = D.svg.getBoundingClientRect(); mb = r.width && r.height ? { l: r.left, t: r.top, sx: 240 / r.width, sy: 156 / r.height } : null; };
    const toSvg = (cx, cy) => { if (!mb) measure(); return mb ? { x: (cx - mb.l) * mb.sx, y: (cy - mb.t) * mb.sy - 4 } : null; };
    const valueAt = (cx, cy) => {
      const p = toSvg(cx, cy);
      if (!p) return value;
      const dx = p.x - CX; const dy = CY - p.y;
      const a = dy <= 0 ? (dx < 0 ? Math.PI : 0) : Math.atan2(dy, dx);
      return (1 - a / Math.PI) * 100;
    };
    dEl.addEventListener('pointerdown', (e) => {
      if (!ctx.canMove || dragging != null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // a touch that starts on the plinth (below the baseline) is not a dial turn
      measure();
      const p0 = toSvg(e.clientX, e.clientY);
      if (p0 && p0.y > CY + 1) return;
      e.preventDefault();
      dragging = e.pointerId;
      try { dEl.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      dEl.classList.add('drag');
      dEl.focus({ preventScroll: true });
      setValue(valueAt(e.clientX, e.clientY));
    });
    dEl.addEventListener('pointermove', (e) => { if (e.pointerId !== dragging) return; e.preventDefault(); setValue(valueAt(e.clientX, e.clientY)); });
    const end = (e) => { if (e.pointerId !== dragging) return; dragging = null; dEl.classList.remove('drag'); };
    dEl.addEventListener('pointerup', end);
    dEl.addEventListener('pointercancel', end);
    dEl.addEventListener('lostpointercapture', end);
    dEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    dEl.addEventListener('keydown', (e) => {
      if (!ctx.canMove) return;
      const big = e.shiftKey ? 5 : 1;
      const k = { ArrowLeft: -big, ArrowDown: -big, ArrowRight: big, ArrowUp: big, PageDown: -10, PageUp: 10 }[e.key];
      if (k) { e.preventDefault(); setValue(value + k); }
      else if (e.key === 'Home') { e.preventDefault(); setValue(0); }
      else if (e.key === 'End') { e.preventDefault(); setValue(100); }
      else if (e.key === 'Enter') { e.preventDefault(); lock(); }
    });
    const goBtn = node.querySelector('.wv-go');
    const sureBtn = node.querySelector('.wv-sure');
    const paintSure = () => { if (sureBtn) sureBtn.setAttribute('aria-pressed', String(sure)); };
    if (sureBtn) sureBtn.addEventListener('click', () => { sure = !sure; api.sfx('tap'); paintSure(); save(); });
    // one lock per round: the busy flag and the disabled button stop a double tap
    const lock = () => {
      if (!ctx.canMove || vs.busy) return;
      vs.busy = true; goBtn.disabled = true;
      const mv = { at: value };
      if (tw === 'sure' && sure) mv.sure = true;
      const res = api.move(mv);
      if (res.ok) { draftPut(slot, null); api.sfx('place'); api.haptic(20); } else { api.toast(res.error); api.sfx('bad'); vs.busy = false; goBtn.disabled = !ctx.canMove; }
    };
    goBtn.addEventListener('click', lock);
    paintAria(); paintSure();
    return {
      refresh() { goBtn.disabled = !ctx.canMove || vs.busy; },
      destroy() { needleSp.stop(); },
    };
  }

  const bonusText = { ow: '+1 One word', edge: '+1 Edge', bet: '+1 Bet right' };

  // A finished round: the screen swings open, the zone spreads, points stamp down.
  function revealScreen(node, ri, { next = false, waiting = false, final = false } = {}) {
    const s = ctx.state; const Rd = s.rounds[ri];
    const guesser = other(Rd.giver);
    const nextGiver = s.r < nR(s) ? s.rounds[s.r].giver : null;
    const d = Math.abs(Rd.at - Rd.target);
    const before = scoreBefore(s, ri);
    const near = nearMiss(Rd, d);
    const bn = Rd.bn || [];
    const chips = [...bn.map((b) => `<span class="wv-chip">${bonusText[b]}</span>`), Rd.jp ? '<span class="wv-chip jp">Jackpot x2</span>' : '', Rd.sure ? `<span class="wv-chip">${Rd.base ? 'Sure: 6' : 'Sure: missed'}</span>` : ''].join('');
    let dvText;
    if (Rd.dv && ri > 0) { const R0 = s.rounds[0]; const d0 = Math.abs(R0.at - R0.target); dvText = `round 1 on this card: ${d0} off. Now ${d}${d < d0 ? `: ${d0 - d} closer` : ''}.`; }
    node.innerHTML = `<div class="wv-head">${top(s, ri, before, dvText)}${clueBubble(Rd)}</div>
      <div class="wv-main"></div>
      <div class="wv-mid">
        <div class="wv-result hide">
          <div class="wv-pts ${Rd.points ? '' : 'zero'} ${Rd.jp ? 'jp' : ''}">${Rd.points ? `+${Rd.points}` : '0'}</div>
          <div class="wv-result-txt"><b>${esc(labelFor(Rd, d))}</b><span>${nm(guesser)} was ${d === 0 ? 'dead on' : `${d} off`}</span>${near || chips ? `<div class="wv-chips">${near ? `<em class="wv-near">${esc(near)}</em>` : ''}${chips}</div>` : ''}</div>
        </div>
      </div>
      <div class="wv-foot">
        ${next ? `<button class="gm-btn wv-go" disabled>${final ? 'See how you did' : 'Next round: your clue'}</button>
          ${ctx.mode === 'local' && nextGiver && !final ? `<p class="wv-note">${esc(api.name(other(nextGiver)))}, look away. ${esc(api.name(nextGiver))} sees the next target.</p>` : ''}` : ''}
        ${waiting && nextGiver ? `<div class="wv-wait"><span>${nm(nextGiver)} is thinking of a clue</span> ${dots}</div>` : ''}
      </div>`;
    const D = dial(node.querySelector('.wv-main'), { card: Rd.card, zone: Rd.target, lid: true, needle: { at: Rd.at, who: guesser }, jp: Rd.jp });
    const res = node.querySelector('.wv-result');
    const team = node.querySelector('.wv-team');
    const goBtn = node.querySelector('.wv-go');
    let dead = false;
    // The giver has not seen the guess yet: the needle swings in from the middle on a loose spring, bouncing off the
    // ends. The guesser already knows where it is: it stays put and shivers once as the lid goes.
    const fresh = ctx.viewer !== guesser;
    const needleSp = spring((x) => D.setNeedle(x), { x: fresh && !reduced() ? 50 : Rd.at, k: 78, z: 0.3 });
    if (fresh && !reduced()) D.setNeedle(50);
    const memo = memoGet();
    const replay = Number.isInteger(memo.rv) && memo.rv >= ri; // already shown on this device (a reload): no show, Next is ready
    const showResult = () => {
      if (dead) return;
      if (!replay && !reduced() && Rd.points) { D.d.classList.add(Rd.jp ? 'slam' : 'thump'); }
      memoPut({ rv: Math.max(ri, Number.isInteger(memo.rv) ? memo.rv : -1) });
      if (goBtn) goBtn.disabled = false; // the next round waits for the stamp, so a double tap on Lock can't skip it
      res.classList.remove('hide');
      if (!reduced()) res.classList.add('anim');
      if (Rd.jp && Rd.points) D.box.querySelector('.wv-needle').classList.add('jp');
      if (!replay) { api.sfx(Rd.jp && Rd.points ? 'win' : Rd.points >= 3 ? 'good' : Rd.points ? 'pop' : 'bad'); api.haptic(Rd.points ? 25 : 60); }
      team.querySelector('b').textContent = String(before + Rd.points);
      if (Rd.points && !reduced()) team.classList.add('bump');
      if (final && !vs.toRecap) vs.toRecap = setTimeout(finish, 3500);
    };
    if (replay) { needleSp.snap(Rd.at); D.setLid(-180); D.setZone(1); showResult(); } else {
      D.setZone(0);
      D.setLid(0);
      api.sfx('flip');
      if (fresh) needleSp.to(Rd.at); else setTimeout(() => { if (!dead) needleSp.kick(Rd.target >= Rd.at ? 36 : -36); }, 260);
      animate(650, (k) => D.setLid(-180 * easeInOut(k)), () => {
        D.setLid(-180);
        animate(520, (k) => D.setZone(easeOutBack(k)), () => { D.setZone(1); showResult(); });
      });
    }
    if (goBtn) goBtn.addEventListener('click', () => { api.sfx('tap'); if (final) finish(); else { vs.ack[ri] = true; memoPut({ ack: ri }); render(); } });
    return { destroy() { dead = true; needleSp.stop(); } };
  }

  // The final reveal is over (a tap, or a few seconds after the stamp): recap + the end card.
  function finish() {
    clearTimeout(vs.toRecap); vs.toRecap = 0;
    if (!ctx || !ctx.over) return;
    vs.ack[nR(ctx.state) - 1] = true;
    render();
    try { api.showEnd(); } catch (e) { console.error(e); }
  }

  function waitClueScreen(node) {
    const s = ctx.state; const Rd = s.rounds[s.r];
    node.innerHTML = `<div class="wv-head">${top(s)}${ruleLine(s, Rd)}<h2 class="wv-h">${nm(Rd.giver)} is thinking of a clue</h2></div>
      <div class="wv-main"></div>
      <div class="wv-foot"><div class="wv-wait"><span>You’ll turn the dial next</span> ${dots}</div></div>`;
    dial(node.querySelector('.wv-main'), { card: Rd.card, lid: true });
    return {};
  }

  function waitGuessScreen(node) {
    const s = ctx.state; const Rd = s.rounds[s.r];
    const guesser = other(Rd.giver);
    node.innerHTML = `<div class="wv-head">${top(s)}${ruleLine(s, Rd)}${clueBubble(Rd, true)}</div>
      <div class="wv-main"></div>
      <div class="wv-foot">
        ${Rd.bet ? `<span class="wv-mybet">Your bet: <b>${BETS[Rd.bet].name}</b> (${BETS[Rd.bet].def})</span>` : ''}
        <div class="wv-wait"><span>${nm(guesser)} is turning the dial</span> ${dots}</div>
      </div>`;
    dial(node.querySelector('.wv-main'), { card: Rd.card, zone: Rd.target });
    return {};
  }

  // ── the recap ──
  const recsHTML = () => {
    const c = ctx; const s = c.state;
    const data = dataOf();
    const mode = isV2(s) ? s.mode : 'classic';
    const names = { a: api.name('a'), b: api.name('b') };
    // Stamps, history and streaks belong to the match that was just played (or the one recorded last). Any other
    // finished match opened later gets none of them: the numbers would be made up.
    if (!vs.fresh && data.lastRec !== c.matchId) return '';
    const st = stampsOf(s, data, c.matchId, mode);
    const lines = [];
    lines.push(`<p><b>${esc(historyLine(s, data, c.matchId, mode, s.score))}</b></p>`);
    const chase = chaseLine(data, names);
    if (chase) lines.push(`<p>${esc(chase)}</p>`);
    if (st.streak != null && st.streak >= 2) lines.push(`<p>Bullseye streak: <b>${st.streak} in a row</b>, across matches. Best ${st.streakBest}.</p>`);
    if (typeof data.bestClue === 'string' && data.bestClue) lines.push(`<p class="dim">Dead-centre record: ${esc(data.bestClue)}</p>`);
    return `${st.stamps.length ? `<div class="wv-stamps">${st.stamps.map((x) => `<div class="wv-stamp"><b>${esc(x.text)}</b><small>${esc(x.sub)}</small></div>`).join('')}</div>` : ''}<div class="wv-recs">${lines.join('')}</div>`;
  };

  function recapScreen(node) {
    const s = ctx.state;
    const anim = !vs.recapAnimated && !reduced();
    vs.recapAnimated = true;
    const mx = maxFor(s);
    const rating = isV2(s) ? null : env.ratingOf(s.score);
    const text = rating || (ctx.result && ctx.result.text) || '';
    const names = { a: api.name('a'), b: api.name('b') };
    const badges = badgesOf(s, names);
    // a keepsake read straight from the rounds (no records involved, so it is true for any finished match)
    const con = clueOfNight(s.rounds);
    const conLine = con ? `<p class="wv-con" data-round="${con.i + 1}">Clue of the night: “${esc(con.round.clue)}” by ${nm(con.round.giver)} on <span class="pp">${label(cardOf(env.CARDS, con.round.card)[0])} ↔ ${label(cardOf(env.CARDS, con.round.card)[1])}</span>, ${con.d === 0 ? 'dead on' : `${con.d} off`}</p>` : '';
    const seg = (cls, a, b) => { const l = Math.max(0, a); const r = Math.min(100, b); return r > l ? `<span class="${cls}" style="left:${l}%;width:${r - l}%"></span>` : ''; };
    node.innerHTML = `<div class="wv-rhead">
        <span class="wv-kicker">Same Wave${isV2(s) ? ` · ${esc(MODES.find((m) => m.id === s.mode).name)}` : ''}</span>
        <div class="wv-plaque"><b>${s.score}<small>/${mx}</small></b><span>${esc(text)}</span></div>
        <div class="wv-meter" aria-hidden="true" style="--n:${mx}">${Array.from({ length: mx }, (_, i) => `<i class="${i < s.score ? 'on' : ''}"></i>`).join('')}</div>
        ${conLine}
      </div>
      <div class="wv-recwrap" style="width:100%;display:flex;flex-direction:column;gap:8px;align-items:center">${recsHTML()}</div>
      <div class="wv-medals">${['a', 'b'].map((w) => `<div class="wv-medal ${w}"><small class="p-${w}">${esc(names[w])}</small><b>${esc(badges[w].name)}</b><span>${esc(badges[w].why)}</span></div>`).join('')}</div>
      <div class="wv-rows">${s.rounds.map((Rd, i) => {
    const d = Math.abs(Rd.at - Rd.target);
    const bn = Rd.bn || [];
    const star = con && con.i === i ? '<span class="wv-chip star"><svg viewBox="0 0 16 16" aria-hidden="true" width="10" height="10"><path d="M8 1l2 4.6 5 .4-3.8 3.3 1.2 4.9L8 11.6 3.6 14.2l1.2-4.9L1 6l5-.4Z" /></svg> Clue of the night</span>' : '';
    const tags = [Rd.jp ? '<span class="wv-chip jp">Jackpot x2</span>' : '', Rd.dv ? '<span class="wv-chip">Déjà vu</span>' : '', ...(isV2(s) && Rd.tw !== 'normal' ? [`<span class="wv-chip">${esc(TWIST_INFO[Rd.tw].name)}</span>`] : []), ...bn.map((b) => `<span class="wv-chip">${bonusText[b]}</span>`), star].join('');
    return `<div class="wv-row ${Rd.jp ? 'jp' : ''} ${anim ? 'anim' : ''}" style="animation-delay:${i * 70}ms">
            <span class="wv-row-card">${i + 1}. ${label(cardOf(env.CARDS, Rd.card)[0])} ↔ ${label(cardOf(env.CARDS, Rd.card)[1])}</span>
            <span class="wv-row-pts ${Rd.points ? '' : 'zero'}">${Rd.points ? `+${Rd.points}` : '0'}</span>
            <span class="wv-row-clue">“${esc(Rd.clue)}” <small>by ${nm(Rd.giver)}</small></span>
            <div class="wv-mini" aria-label="Target ${Rd.target}, guess ${Rd.at}">${seg('z2', Rd.target - 17, Rd.target + 17)}${seg('z3', Rd.target - 10, Rd.target + 10)}${seg('z4', Rd.target - 4, Rd.target + 4)}<span class="tick" style="left:${Rd.target}%"></span><span class="pin ${other(Rd.giver)}" style="left:${Rd.at}%"></span></div>
            <div class="wv-row-meta"><span>Target ${Rd.target}, guess ${Rd.at}${d ? `, ${d} off` : ', dead on'}</span>${tags}</div>
          </div>`;
  }).join('')}</div>
      <div class="wv-actions end"><button class="gm-btn" data-g="rematch">Play again</button><button class="gm-btn gm-btn-ghost" data-g="close">Back to games</button></div>`;
    return { refresh() { /* data refresh handled below */ } };
  }

  function refreshRecs() {
    if (!scr || scr.key !== 'recap') return;
    const w = scroller.querySelector('.wv-recwrap');
    if (w && ctx) w.innerHTML = recsHTML();
  }

  function writeRecords(c) {
    if (vs.recorded) return;
    vs.recorded = true;
    if (typeof store.data !== 'function' || typeof store.setData !== 'function') return;
    if (c.mode === 'online' && !(c.last && c.last.who === c.me)) return;
    const data = dataOf();
    if (data.lastRec === c.matchId) return;
    const mode = isV2(c.state) ? c.state.mode : 'classic';
    putData(recordPatch(c.state, data, c.matchId, mode, cardTxt));
  }

  function render() {
    const c = ctx;
    if (!c) return;
    const s = c.state;
    const v = c.viewer;
    const last = nR(s) - 1;
    if (c.over) {
      if (vs.wasOver === false && !vs.ack[last]) { setScreen(`reveal:${last}`, (n) => revealScreen(n, last, { next: true, final: true })); return; }
      setScreen('recap', recapScreen, 'flow');
      return;
    }
    if (!v) { setScreen('blank', (n) => { n.innerHTML = ''; return {}; }, 'flow'); return; }
    // a fresh match: the first player sets the game up
    if (!s.v && c.moves === 0) {
      if (v === c.first) setScreen('setup', setupScreen, 'flow'); else setScreen('wsetup', waitSetupScreen, 'flow');
      return;
    }
    const Rd = s.rounds[s.r];
    const prev = s.rounds[s.r - 1];
    if (s.phase === 'clue') {
      vs.busy = false;
      if (v === Rd.giver) {
        if (prev && !acked(s.r - 1)) setScreen(`reveal:${s.r - 1}`, (n) => revealScreen(n, s.r - 1, { next: true }));
        else setScreen(`clue:${s.r}`, clueScreen);
      } else if (prev) setScreen(`reveal:${s.r - 1}`, (n) => revealScreen(n, s.r - 1, { waiting: true }));
      else setScreen(`wclue:${s.r}`, waitClueScreen);
      return;
    }
    vs.busy = false;
    if (v === Rd.giver) setScreen(`wguess:${s.r}`, waitGuessScreen);
    else setScreen(`guess:${s.r}`, guessScreen);
  }

  const offData = typeof store.onData === 'function' ? store.onData(() => { try { refreshRecs(); } catch (e) { console.error(e); } }) : null;

  return {
    update(c) {
      const was = vs.wasOver;
      if (c.over && was === false) vs.fresh = true; // finished while this screen was open
      ctx = c;
      render();
      if (c.over && was === false) writeRecords(c);
      if (vs.wasOver === null || !c.over) vs.wasOver = c.over;
      if (c.over) draftPut('', null);
    },
    destroy() {
      clearTimeout(vs.toRecap);
      if (scr && scr.destroy) scr.destroy();
      while (cleanups.length) { try { cleanups.pop()(); } catch (e) { console.error(e); } }
      rafs.forEach((id) => cancelAnimationFrame(id));
      clearTimeout(kb.t); clearTimeout(kb.off);
      if (typeof offData === 'function') offData();
      root.removeEventListener('focusin', kbSoon);
      root.removeEventListener('focusout', kbOff);
      if (vvp) { vvp.removeEventListener('resize', kbSoon); vvp.removeEventListener('scroll', kbSoon); }
      window.removeEventListener('resize', kbSoon);
    },
  };
}
