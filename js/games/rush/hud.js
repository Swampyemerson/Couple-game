// Rail Rush HUD and overlays (DOM over the canvas, themed with the app tokens). Every setter
// diffs against its last value so the per-frame update touches the DOM only on change.
import { A_UP, A_DOWN } from './sim.js';
import { A_USE } from './input.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEART = '<svg class="rr-heart" viewBox="0 0 24 22" aria-hidden="true"><path d="M12 20.2 3.4 11.9A5.2 5.2 0 0 1 12 4.9a5.2 5.2 0 0 1 8.6 7Z" fill="currentColor"/></svg>';
export const ICONS = {
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
  ink: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 5c5 8 11 13 11 20a11 11 0 0 1-22 0c0-7 6-12 11-20Z" fill="var(--g-ink)"/><circle cx="15.5" cy="25" r="3" fill="var(--g-card)"/></svg>',
  block: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="4" y="13" width="32" height="13" rx="2" fill="var(--g-card)" stroke="var(--g-ink)" stroke-width="3"/><path d="M10 13 4 22M19 13l-9 13M28 13l-9 13M36 15l-8 11" stroke="var(--g-ink)" stroke-width="3.5"/><path d="M8 26v8M32 26v8" stroke="var(--g-ink)" stroke-width="3.5" stroke-linecap="round"/></svg>',
  zap: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M23 3 8 23h10l-3 14 17-21H21Z" fill="var(--g-hl)" stroke="var(--g-ink)" stroke-width="3" stroke-linejoin="round"/></svg>',
  rocket: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3c7 5 9 13 7 22H13c-2-9 0-17 7-22Z" fill="var(--g-card)" stroke="var(--g-ink)" stroke-width="3" stroke-linejoin="round"/><circle cx="20" cy="15" r="3.5" fill="var(--g-ink)"/><path d="M14 25 8 31l7-1M26 25l6 6-7-1" fill="var(--g-bad)" stroke="var(--g-ink)" stroke-width="2.5" stroke-linejoin="round"/><path d="M16 27c0 5 2 8 4 10 2-2 4-5 4-10Z" fill="var(--g-hl)" stroke="var(--g-ink)" stroke-width="2.5"/></svg>',
  shield: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 4 33 9v9c0 9-6 15-13 18C13 33 7 27 7 18V9Z" fill="var(--g-hl)" stroke="var(--g-ink)" stroke-width="3" stroke-linejoin="round"/><path d="M14 19l4 4 8-8" fill="none" stroke="var(--g-ink)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  magnet: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 6h8v14a4 4 0 0 0 8 0V6h8v14a12 12 0 0 1-24 0Z" fill="var(--g-bad)" stroke="var(--g-ink)" stroke-width="3" stroke-linejoin="round"/><path d="M8 6h8v6H8zM24 6h8v6h-8z" fill="var(--g-card)" stroke="var(--g-ink)" stroke-width="3"/></svg>',
  sneakers: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M5 26c0-6 2-13 7-15l4 7 8 2c6 1 11 3 11 8v3H5Z" fill="var(--g-good)" stroke="var(--g-ink)" stroke-width="3" stroke-linejoin="round"/><path d="M5 31h30" stroke="var(--g-ink)" stroke-width="3"/><path d="M13 9c-3-3-7-3-9-1 3 0 5 2 6 4" fill="var(--g-hl)" stroke="var(--g-ink)" stroke-width="2.5" stroke-linejoin="round"/></svg>',
  flag: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M9 36V5" stroke="var(--g-ink)" stroke-width="3.5" stroke-linecap="round"/><path d="M10 6h22l-5 7 5 7H10Z" fill="var(--g-card)" stroke="var(--g-ink)" stroke-width="3" stroke-linejoin="round"/><path d="M15 6v14M21 6v14M10 13h18" stroke="var(--g-ink)" stroke-width="3"/></svg>',
  brawl: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M3 15h13l-3-5 10 10-10 10 3-5H3Z" fill="var(--p-a)" stroke="var(--g-ink)" stroke-width="2.5" stroke-linejoin="round"/><path d="M37 15H27l3-5-9 10 9 10-3-5h10Z" fill="var(--p-b)" stroke="var(--g-ink)" stroke-width="2.5" stroke-linejoin="round"/><path d="M20 4v6M14 6l3 4M26 6l-3 4" stroke="var(--g-ink)" stroke-width="2.5" stroke-linecap="round"/></svg>',
  tandem: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M14 30 5 21a5 5 0 0 1 9-6 5 5 0 0 1 9 6Z" fill="var(--p-a)" stroke="var(--g-ink)" stroke-width="2.5" stroke-linejoin="round"/><path d="M26 35l-9-9a5 5 0 0 1 9-6 5 5 0 0 1 9 6Z" fill="var(--p-b)" stroke="var(--g-ink)" stroke-width="2.5" stroke-linejoin="round"/></svg>',
  hand: '<svg viewBox="0 0 44 56" aria-hidden="true"><path d="M15 30V8a4 4 0 0 1 8 0v15l10 2c4 1 6 4 5 8l-3 14c-1 4-4 6-8 6h-7c-3 0-5-1-7-4L5 37c-2-3 2-7 5-5Z" fill="var(--g-card)" stroke="var(--g-ink)" stroke-width="3" stroke-linejoin="round"/></svg>',
  runner: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="38" cy="11" r="7" fill="var(--g-card)" stroke="var(--g-ink)" stroke-width="3"/><path d="M33 20 22 30l9 4-6 14M33 20l3 14 12 2M33 20l12 3 5-8M31 34 18 38l-6 8" fill="none" stroke="var(--p-a)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  box: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="7" y="7" width="26" height="26" rx="4" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="5 4"/><path d="M16 16a4 4 0 1 1 5 4c-1 .5-1 1.5-1 3M20 27v.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.3 2-1.9-.4-.6-1.5 1.1-1.6-1.9-1.9-1.6 1.1-1.5-.6-.4-1.9h-2.7l-.4 1.9-1.5.6-1.6-1.1-1.9 1.9 1.1 1.6-.6 1.5-1.9.4v2.7l1.9.4.6 1.5-1.1 1.6 1.9 1.9 1.6-1.1 1.5.6.4 1.9h2.7l.4-1.9 1.5-.6 1.6 1.1 1.9-1.9-1.1-1.6.6-1.5 1.9-.4Z" fill="currentColor"/></svg>',
};
export const WEAPONS = {
  ink: { name: 'Ink bomb', icon: ICONS.ink },
  block: { name: 'Roadblock', icon: ICONS.block },
  zap: { name: 'Lane zap', icon: ICONS.zap },
  rocket: { name: 'Rocket', icon: ICONS.rocket },
  shield: { name: 'Shield', icon: ICONS.shield },
};
const SPLAT = (col) => `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g fill="${col}" stroke="var(--g-ink)" stroke-width="1.2">
<path d="M48 10c9 0 10 9 18 8s16 6 12 14 7 12 3 20-12 4-11 13 9 15 0 18-11-6-18-3-14 12-21 6 0-13-7-17-16-2-15-11 11-7 8-15-6-15 3-19 13 2 17-5 9-9 11-9Z"/>
<circle cx="15" cy="20" r="6"/><circle cx="85" cy="78" r="5"/><circle cx="80" cy="14" r="3.5"/><circle cx="18" cy="84" r="4"/>
<path d="M60 80c2 6 1 13-1 16-2-4-3-10 1-16ZM34 78c1 5 0 9-2 12-1-4-1-8 2-12Z"/></g></svg>`;

export function createHud(root, o) {
  const views = {};
  const L = root;
  const mk = (cls, html = '', tag = 'div') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };

  function makeView(side, who) {
    const el = mk('rr-hud');
    el.dataset.side = side;
    el.innerHTML = `
      <div class="rr-top">
        <div class="rr-left"><div class="rr-hearts" data-r="hearts"></div><div class="rr-chip" data-r="coins"><i class="rr-coin-ico"></i><span>0</span></div><div class="rr-powers" data-r="powers"></div></div>
        <div class="rr-dist" data-r="dist">0<small>m</small></div>
        <div class="rr-right"><div class="rr-chip rr-partner" data-r="partner" hidden><i class="rr-dot"></i><span></span></div></div>
      </div>
      ${side !== 'r' ? `<button class="rr-icon-btn rr-pause" data-r="pause" aria-label="Pause">${ICONS.pause}</button>` : ''}
      <div class="rr-bar" data-r="bar" hidden><i class="rr-fill"></i><span class="rr-flag">${ICONS.flag}</span><span class="rr-mk" data-r="mko"></span><span class="rr-mk me" data-r="mkm"></span></div>
      <div class="rr-gap" data-r="gap" hidden><span></span></div>
      <div class="rr-pops" data-r="pops"></div>
      <div class="rr-combo" data-r="combo"></div>
      <div class="rr-warn" data-r="warn">!</div>
      <div class="rr-banner" data-r="banner"></div>
      <div class="rr-splat" data-r="splat"></div>
      <div class="rr-flash" data-r="flash"></div>
      <button class="rr-weapon empty" data-r="weapon" hidden aria-label="Use weapon"><span class="rr-wname"></span><span class="rr-wic">${ICONS.box}</span>${o.keyHint ? `<span class="rr-key">${esc(o.keyHint(who))}</span>` : ''}</button>
      <div class="rr-btns" data-r="btns"><button data-a="${A_DOWN}">ROLL</button><button data-a="${A_UP}">JUMP</button></div>`;
    L.appendChild(el);
    const $ = (r) => el.querySelector(`[data-r="${r}"]`);
    const R = {
      hearts: $('hearts'), coins: $('coins').querySelector('span'), dist: $('dist'), powers: $('powers'), partner: $('partner'),
      bar: $('bar'), fill: el.querySelector('.rr-fill'), mkm: $('mkm'), mko: $('mko'), gap: $('gap'), pops: $('pops'), combo: $('combo'),
      warn: $('warn'), banner: $('banner'), splat: $('splat'), flash: $('flash'), weapon: $('weapon'), pause: $('pause'), btns: $('btns'),
    };
    R.powers.innerHTML = ['magnet', 'sneakers', 'shield', 'rocket'].map((k) => `<div class="rr-pw" data-pw="${k}" hidden>${ICONS[k].replace('<svg ', '<svg class="ic" ')}<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" pathLength="100"/></svg></div>`).join('');
    const pw = {};
    R.powers.querySelectorAll('[data-pw]').forEach((p) => { pw[p.dataset.pw] = { el: p, ring: p.querySelector('.ring circle'), last: -1 }; });
    R.weapon.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); o.onUse(who); });
    R.btns.querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); o.onBtn(who, +b.dataset.a); }));
    if (R.pause) R.pause.addEventListener('click', () => o.onPause());
    const last = {};
    const set = (k, v, fn) => { if (last[k] !== v) { last[k] = v; fn(v); } };
    let popN = 0;
    const v = {
      el, who,
      hearts(n, max, color) {
        set('hm', `${max}|${color}`, () => { R.hearts.innerHTML = Array.from({ length: max }, () => HEART).join(''); R.hearts.style.color = color; last.h = -1; });
        set('h', n, (val) => {
          const hs = R.hearts.children;
          for (let i = 0; i < hs.length; i++) {
            const was = !hs[i].classList.contains('off');
            const on = i < val;
            hs[i].classList.toggle('off', !on);
            if (on && !was) { hs[i].classList.remove('pop'); void hs[i].offsetWidth; hs[i].classList.add('pop'); }
          }
        });
      },
      coins(n) { set('c', n, (val) => { R.coins.textContent = val; }); },
      dist(m) { set('d', m, (val) => { R.dist.firstChild.nodeValue = val.toLocaleString('en-US'); }); },
      partner(text, color) {
        set('pt', text, (val) => { R.partner.hidden = !val; if (val) R.partner.querySelector('span').textContent = val; });
        set('pc', color, (val) => { R.partner.querySelector('.rr-dot').style.background = val; });
      },
      bar(on, me, other, meCol, otherCol, meInit, otherInit) {
        set('bo', on, (val) => { R.bar.hidden = !val; });
        if (!on) return;
        set('bc', meCol + otherCol, () => {
          R.mkm.style.background = meCol; R.mko.style.background = otherCol;
          R.mkm.textContent = meInit; R.mko.textContent = otherInit;
          R.mko.style.display = otherCol ? '' : 'none';
        });
        const w = R.bar.clientWidth || 200;
        set('bm', Math.round(me * w), (px) => { R.mkm.style.transform = `translateX(${px}px)`; R.fill.style.width = px + 'px'; });
        set('bt', Math.round(other * w), (px) => { R.mko.style.transform = `translateX(${px}px)`; });
      },
      gap(text) { set('g', text, (val) => { R.gap.hidden = !val; if (val) R.gap.firstChild.textContent = val; }); },
      powers(m, s, sh, rk) {
        const upd = (k, frac) => {
          const p = pw[k];
          const q = frac <= 0 ? -1 : Math.round(frac * 50) / 50;
          if (q === p.last) return;
          p.last = q;
          p.el.hidden = q < 0;
          if (q >= 0) p.ring.style.strokeDashoffset = String(100 - q * 100);
        };
        upd('magnet', m); upd('sneakers', s); upd('shield', sh ? 1 : 0); upd('rocket', rk);
      },
      weapon(kind, show) {
        set('ws', show, (val) => { R.weapon.hidden = !val; });
        set('w', kind, (val) => {
          R.weapon.classList.toggle('empty', !val); R.weapon.classList.toggle('full', !!val);
          R.weapon.querySelector('.rr-wic').innerHTML = val ? WEAPONS[val].icon : ICONS.box;
          R.weapon.querySelector('.rr-wname').textContent = val ? WEAPONS[val].name : '';
        });
      },
      pop(text, cls = '', sub = '') {
        const p = mk('rr-pop ' + cls, esc(text) + (sub ? `<small>${esc(sub)}</small>` : ''));
        R.pops.appendChild(p);
        void p.offsetWidth; p.classList.add('go');
        popN++;
        while (R.pops.children.length > 2) R.pops.firstChild.remove();
        setTimeout(() => p.remove(), 1200);
      },
      combo(n, label) {
        R.combo.innerHTML = `x${n}<small>${esc(label)}</small>`;
        R.combo.classList.remove('go'); void R.combo.offsetWidth; R.combo.classList.add('go');
      },
      warn(on, xFrac) {
        set('wo', on, (val) => { R.warn.classList.toggle('on', val); });
        if (on) set('wx', Math.round(xFrac * 100), (val) => { R.warn.style.transform = `translateX(${val}%)`; });
      },
      splat(color, ms = 2000) {
        R.splat.innerHTML = SPLAT(color);
        R.splat.classList.add('on');
        clearTimeout(v._st);
        v._st = setTimeout(() => R.splat.classList.remove('on'), ms);
      },
      get splatted() { return R.splat.classList.contains('on'); },
      flash() { R.flash.classList.remove('go'); void R.flash.offsetWidth; R.flash.classList.add('go'); },
      banner(html) { set('bn', html || '', (val) => { R.banner.classList.toggle('on', !!val); if (val) R.banner.innerHTML = val; }); },
      bannerNum(n) { const b = R.banner.querySelector('b'); if (b && b.textContent !== String(n)) b.textContent = String(n); },
      buttons(on) { set('btn', on, () => {}); },
    };
    views[who] = v;
    return v;
  }

  // shared overlays
  const ov = {};
  for (const k of ['load', 'lobby', 'count', 'pause', 'msg', 'fin', 'set']) { ov[k] = mk('rr-ov rr-ov-' + k); L.appendChild(ov[k]); }
  ov.load.classList.add('on');
  ov.load.innerHTML = `<div style="text-align:center"><div class="rr-logo"><span>RAIL</span><span>RUSH</span></div><div class="rr-runner-ico">${ICONS.runner}</div><div class="rr-progress"><i></i></div><p>Laying track…</p></div>`;
  const tut = mk('rr-tut');
  tut.innerHTML = '<div class="rr-hand"></div><div class="rr-cap"></div><div class="rr-steps"><i></i><i></i><i></i></div>';
  L.appendChild(tut);
  const tag = mk('rr-tag');
  L.appendChild(tag);
  let lastCount = '';

  const show = (k, on) => { ov[k].classList.toggle('on', !!on); };
  const api = {
    views, makeView, ov,
    loading(frac, text) {
      ov.load.querySelector('.rr-progress i').style.width = Math.round(frac * 100) + '%';
      if (text) ov.load.querySelector('p').textContent = text;
    },
    hideLoading() { show('load', false); },
    error(msg, retry) {
      show('load', false);
      ov.msg.classList.add('dim');
      ov.msg.innerHTML = `<div class="rr-card"><h2>Couldn’t start the 3D engine</h2><p>${esc(msg)}</p>
        ${retry ? '<button class="rr-btn hot" data-x="retry">Try again</button>' : ''}<button class="rr-btn ghost" data-g="close">Back to games</button></div>`;
      const b = ov.msg.querySelector('[data-x="retry"]');
      if (b) b.addEventListener('click', retry);
      show('msg', true);
    },
    phoneCard(partnerName) {
      show('load', false);
      ov.msg.classList.add('dim');
      ov.msg.innerHTML = `<div class="rr-card"><div class="rr-logo" style="font-size:38px"><span>RAIL</span><span>RUSH</span></div>
        <h2>One device needs a keyboard</h2>
        <p>Split screen is for a computer: one of you on W A S D, the other on the arrow keys. On phones, race each other live instead, it’s the best way to play.</p>
        <button class="rr-btn hot" data-g="live" data-game="rush" data-mode="live">Play live with ${esc(partnerName)}</button>
        <button class="rr-btn ghost" data-g="close">Back to games</button></div>`;
      show('msg', true);
    },
    lobby(st) {
      // st: { modes, mode, canPick, canStart, startLabel, status (html), keys (html|''), host, showReady, ready }
      show('lobby', true);
      if (!ov.lobby.dataset.built) {
        ov.lobby.dataset.built = '1';
        ov.lobby.innerHTML = `<div class="rr-head"><div class="rr-logo"><span>RAIL</span><span>RUSH</span></div><div class="rr-tagline">Same track. Two runners. No mercy.</div></div><div></div>
          <div class="rr-sheet">
            <div class="rr-modes">
              <button class="rr-mode" data-mode="race">${ICONS.flag}<b>Race</b><span>First to 2 km. Ink, roadblocks, zaps.</span></button>
              <button class="rr-mode" data-mode="brawl">${ICONS.brawl}<b>Brawl</b><span>Side by side. Shove them into walls.</span></button>
              <button class="rr-mode" data-mode="tandem">${ICONS.tandem}<b>Together</b><span>Shared hearts. Revive each other.</span></button>
            </div>
            <div class="rr-status" data-r="status"></div>
            <div class="rr-keys" data-r="keys"></div>
            <div class="rr-row"><button class="rr-btn hot" data-r="go">Start</button><button class="rr-btn ghost sq" data-r="gear" aria-label="Settings">${ICONS.gear}</button></div>
          </div>`;
        ov.lobby.querySelectorAll('.rr-mode').forEach((b) => b.addEventListener('click', () => o.onMode(b.dataset.mode)));
        ov.lobby.querySelector('[data-r="go"]').addEventListener('click', () => o.onGo());
        ov.lobby.querySelector('[data-r="gear"]').addEventListener('click', () => o.onSettings());
      }
      ov.lobby.querySelectorAll('.rr-mode').forEach((b) => { b.classList.toggle('on', b.dataset.mode === st.mode); b.disabled = !st.canPick; });
      const go = ov.lobby.querySelector('[data-r="go"]');
      if (go.textContent !== st.startLabel) go.textContent = st.startLabel;
      go.disabled = !st.canStart;
      const s = ov.lobby.querySelector('[data-r="status"]');
      if (s.innerHTML !== st.status) s.innerHTML = st.status;
      const k = ov.lobby.querySelector('[data-r="keys"]');
      if (k.dataset.v !== st.keys) { k.dataset.v = st.keys; k.innerHTML = st.keys; k.hidden = !st.keys; }
    },
    hideLobby() { show('lobby', false); },
    count(text, sub = '') {
      const key = text + '|' + sub;
      if (key === lastCount) return;
      lastCount = key;
      if (!text) { show('count', false); ov.count.innerHTML = ''; return; }
      show('count', true);
      ov.count.innerHTML = `<div><div class="rr-num go ${/^\d$/.test(text) ? '' : 'run'}">${esc(text)}</div>${sub ? `<p><span>${esc(sub)}</span></p>` : ''}</div>`;
    },
    pause(info) {
      // info: null | { title, text, resume (bool), quit (bool), count }
      if (!info) { show('pause', false); ov.pause.dataset.k = ''; return; }
      const k = JSON.stringify(info);
      if (ov.pause.dataset.k === k) return;
      ov.pause.dataset.k = k;
      ov.pause.classList.add('dim');
      ov.pause.innerHTML = `<div class="rr-card"><h2>${esc(info.title)}</h2>${info.text ? `<p>${esc(info.text)}</p>` : ''}
        ${info.resume ? `<button class="rr-btn hot" data-x="resume">${esc(info.resumeLabel || 'Resume')}</button>` : ''}
        <div class="rr-row"><button class="rr-btn ghost" data-x="set">Settings</button><button class="rr-btn ghost" data-g="close">Quit</button></div></div>`;
      const r = ov.pause.querySelector('[data-x="resume"]');
      if (r) r.addEventListener('click', () => o.onResume());
      ov.pause.querySelector('[data-x="set"]').addEventListener('click', () => o.onSettings());
      show('pause', true);
    },
    settings(cfg) {
      if (!cfg) { show('set', false); return; }
      ov.set.classList.add('dim');
      const seg = (key, opts) => `<span class="rr-seg">${opts.map(([v, l]) => `<button data-k="${key}" data-v="${v}" class="${cfg[key] === v ? 'on' : ''}">${l}</button>`).join('')}</span>`;
      ov.set.innerHTML = `<div class="rr-card"><h2>Settings</h2>
        <div class="rr-set"><span>Controls</span>${seg('scheme', [['swipe', 'Swipe'], ['buttons', 'Buttons']])}</div>
        <div class="rr-set"><span>Music</span>${seg('music', [['on', 'On'], ['off', 'Off']])}</div>
        <div class="rr-set"><span>Sound</span>${seg('sound', [['on', 'On'], ['off', 'Off']])}</div>
        <p style="font-size:13px">Buttons: tap the left or right side to change lanes, and use the Jump and Roll buttons.</p>
        <button class="rr-btn" data-x="done">Done</button></div>`;
      ov.set.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => { o.onSet(b.dataset.k, b.dataset.v); }));
      ov.set.querySelector('[data-x="done"]').addEventListener('click', () => o.onSettingsDone());
      show('set', true);
    },
    finale(text, cls, sub) {
      if (!text) { show('fin', false); return; }
      ov.fin.innerHTML = `<div class="rr-stamp ${cls}">${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
      show('fin', true);
    },
    tutorial(step, total, dir, caption) {
      if (step < 0) { tut.classList.remove('on'); return; }
      tut.classList.add('on');
      const h = tut.querySelector('.rr-hand');
      const k = `${step}|${dir}|${caption}`;
      if (tut.dataset.k === k) return;
      tut.dataset.k = k;
      h.className = 'rr-hand ' + dir;
      h.innerHTML = dir ? ICONS.hand : '';
      tut.querySelector('.rr-cap').textContent = caption;
      tut.querySelectorAll('.rr-steps i').forEach((i, n) => i.classList.toggle('on', n <= step));
    },
    tag(on, x, y, name, color) {
      if (!on) { if (tag.style.display !== 'none') tag.style.display = 'none'; return; }
      if (tag.style.display !== 'block') tag.style.display = 'block';
      if (tag.textContent !== name) tag.textContent = name;
      if (tag.style.background !== color) tag.style.background = color;
      tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    },
    get countText() { return lastCount; },
    A_USE,
  };
  return api;
}
