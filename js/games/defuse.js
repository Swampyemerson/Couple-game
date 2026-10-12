// Defuse: asymmetric co-op for two devices. One player holds the bomb (best on a computer), the
// other reads the field guide (best on a phone), and they talk it through out loud.
//
// The round. The bomb device picks a seed and a tier; js/games/defuse/round.js turns { seed, tier } into the whole round
// (edgework, which modules, every module's rules and puzzle, twists, timed events) with pure functions, so the manual
// device rebuilds the identical round and prints the matching field guide. Only the seed travels.
//
// Netcode. In the lobby each device publishes its own role, a shared tier (last writer wins by a version counter, ties
// to 'b') and a start token. The bomb side is authoritative for a round: it runs the clock and publishes
// { round id, seed, tier, ms left, clock rate, strikes, solved slots, surge / blackout / vent flags, relay state, paused,
// result } in presence; the manual side shows that live and publishes its relay actions. The engine only records
// results sent by the host ('a'), so when the bomb is on 'b' it also sends a 'result' event.
//
// Modules are plugins (js/games/defuse/<module>.js). This file hosts them: it mounts each into its slot, forwards
// input to the slot that owns it, gives each a host (strike / solve / clock / busy) and judges nothing itself.
import { registerGame } from './core.js';
import { CSS } from './defuse/css.js';
import { REGISTRY, BY_ID, TIERS, TIER_ORDER, tierOf, buildRound, isScored, SURGE_SECS, BLACKOUT, GOLD_BONUS } from './defuse/round.js';
import { ctxOf, esc, fmt, cap } from './defuse/util.js';
import { tabsOf, guideHTML } from './defuse/manual.js';
import { readRecords, applyResult, dailyOf, dailySeed, dayKey, sameHolder, coupleLine, nextMedalHint, MEDAL_NAME } from './defuse/records.js';

const FINALE_MS = 1800;
const RATE_STEP = 0.25;
const DECOY_GAP = 700;

const ENDED = new Set();

// remembered between rematches on this device; the small bits also survive a page reload (sessionStorage)
// saved: a bomb round in progress when this device closed the game, so reopening it resumes
const SS_KEY = 'ju.defuse.memo.v2';
const memo = { role: null, diff: 'normal', td: false, page: 'basics', drawer: null, saved: null };
try {
  const o = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null');
  if (o && typeof o === 'object') {
    if (o.role === 'bomb' || o.role === 'manual') memo.role = o.role;
    if (tierOf(o.diff)) memo.diff = o.diff;
    memo.td = !!o.td;
    if (typeof o.page === 'string') memo.page = o.page.slice(0, 20);
    if (typeof o.drawer === 'boolean') memo.drawer = o.drawer;
  }
} catch { /* no storage */ }
const keep = () => { try { sessionStorage.setItem(SS_KEY, JSON.stringify({ role: memo.role, diff: memo.diff, td: memo.td, page: memo.page, drawer: memo.drawer })); } catch { /* ignore */ } };

const ICON_BOMB = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="18" width="48" height="36" rx="8" class="f-card"/><rect x="15" y="25" width="22" height="11" rx="2" class="f-lcd"/><path d="M19 30.5h3M25 30.5h3M31 30.5h2" class="s-hl"/><circle cx="46" cy="30.5" r="5" class="f-bad"/><path d="M15 43c6 5 12-5 18 0s12-5 16 0" class="s-wire"/><path d="M32 18c0-6 4-9 9-9s7 3 8 0" class="s-ink"/><path d="M50 4l1.5 4M54 6l-3 3M55 11l-4-1" class="s-ink"/></svg>';
const ICON_BOOK = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 16c-7-5-15-6-24-5v38c9-1 17 0 24 5c7-5 15-6 24-5V11c-9-1-17 0-24 5z" class="f-card"/><path d="M32 16v38" class="s-ink"/><path d="M14 20c4-.5 8 0 12 2M14 27c4-.5 8 0 12 2M14 34c4-.5 8 0 12 2M38 22c4-2 8-2.5 12-2M38 29c4-2 8-2.5 12-2" class="s-muted"/><rect x="38" y="35" width="12" height="10" rx="2" class="f-hl"/></svg>';
const batterySVG = '<svg viewBox="0 0 40 20" aria-hidden="true"><rect class="b-body" x="1.5" y="2" width="33" height="16" rx="3"/><rect class="b-band" x="23" y="3" width="6" height="14"/><rect class="b-nub" x="35" y="6.5" width="3.5" height="7" rx="1"/></svg>';
const PORT_SVG = {
  DVI: '<svg viewBox="0 0 22 14" aria-hidden="true"><rect x="1" y="2" width="20" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 5h2M9 5h2M13 5h2M17 5h1M5 9h2M9 9h2M13 9h2M17 9h1" stroke="currentColor" stroke-width="1.6"/></svg>',
  PS2: '<svg viewBox="0 0 22 14" aria-hidden="true"><circle cx="11" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 6h.1M11 5h.1M14 6h.1M8.5 9h.1M13.5 9h.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  RJ45: '<svg viewBox="0 0 22 14" aria-hidden="true"><path d="M3 2h16v7h-3v3H6V9H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 5v2M11 5v2M14 5v2" stroke="currentColor" stroke-width="1.6"/></svg>',
  SERIAL: '<svg viewBox="0 0 22 14" aria-hidden="true"><path d="M2 2h18l-2.5 10h-13z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M6 5h.1M9 5h.1M12 5h.1M15 5h.1M7.5 9h.1M11 9h.1M14.5 9h.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};
const ALLCSS = () => CSS + '\n' + REGISTRY.map((p) => p.css || '').join('\n');

const jlen = (x) => { try { return JSON.stringify(x).length; } catch { return 0; } };

registerGame({
  id: 'defuse',
  title: 'Defuse',
  blurb: 'One sees the bomb, one reads the manual. Talk fast.',
  kind: 'live',
  team: true,
  modes: ['live'],
  tags: ['brainy'],
  platforms: ['phone', 'computer'],
  best: 'computer',
  minutes: 6,
  howTo: [
    'One of you holds the Bomb, the other reads the Manual. Talk out loud.',
    'The Bomb describes what they see; the Manual finds the rule and says what to do.',
    'Defuse every module before the clock runs out. Every round has new rules.',
    'A wrong move is a strike. Three strikes: boom.',
  ],
  css: ALLCSS(),
  mount(el, api) {
    if (api.mode !== 'live') {
      el.innerHTML = `<div class="g-defuse"><div class="dx-solo">
        <div class="dx-solo-art">${ICON_BOMB}${ICON_BOOK}</div>
        <h2 class="dx-h">Two devices, please</h2>
        <p>Defuse needs two devices: one for the bomb, one for the manual.</p>
        <p class="dx-lead">Start it with <b>Play live</b>. The bomb works best on a computer, the manual on a phone. Then talk it through out loud.</p>
        <button type="button" class="gm-btn gm-btn-big" data-g="close">Back to games</button>
      </div></div>`;
      api.setStatus('Needs two devices');
      return { destroy() {} };
    }

    const me = api.me;
    const them = api.other(me);
    const offs = [];
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    const token = () => Math.random().toString(36).slice(2, 10);
    const D = () => { try { const d = typeof api.data === 'function' ? api.data() : {}; return d && typeof d === 'object' ? d : {}; } catch { return {}; } };
    let alive = true;
    let raf = 0;

    // lobby state (mine), the partner's comes from presence
    const L = { role: memo.role, diff: tierOf(memo.diff) ? memo.diff : 'normal', td: !!memo.td, dv: 0, dw: me, go: null, sw: null };
    const P = () => { const s = api.partnerState(); return s && s.v === 2 ? s : null; };
    const seenGo = new Set();
    const seenSwap = new Set();
    { const s = P(); if (s && s.go) seenGo.add(s.go); if (s && s.sw && s.sw.t) seenSwap.add(s.sw.t); }
    let phase = 'lobby'; // lobby | bomb | manual
    let B = null; // the bomb round (bomb side)
    let M = null; // the mirrored round (manual side)
    let partnerHid = false;
    let lobbySince = 0; // when the partner's presence last said "lobby" during our round
    let partnerLobby = false;

    el.innerHTML = '<div class="g-defuse"></div>';
    const root = el.firstElementChild;
    const $ = (s) => root.querySelector(s);
    const $$ = (s) => [...root.querySelectorAll(s)];

    // ── presence ────────────────────────────────────────────────────────
    const svOf = () => B.round.slots.map((s, i) => (s.decoy ? 'd' : BY_ID[s.id].needy ? 'n' : B.solved[i] ? '1' : '0')).join('');
    const rate = () => (B ? (B.round.twistRules.tax ? 1 : 1 + RATE_STEP * B.strikes) * (B.surge.left > 0 ? 2 : 1) : 1);
    function pub() {
      const o = { v: 2, role: L.role, diff: L.diff, td: L.td ? 1 : 0, dv: L.dv, dw: L.dw, go: L.go, sw: L.sw, ph: phase === 'bomb' ? (B.over ? 'over' : 'play') : phase === 'manual' ? 'reading' : 'lobby', hid: document.hidden ? 1 : 0 };
      if (phase === 'bomb') {
        Object.assign(o, { n: B.n, sd: B.seed, rd: B.tier, left: Math.round(B.left), rate: +rate().toFixed(3), st: B.strikes, sv: svOf(), sg: Math.ceil(B.surge.left / 1000), bo: B.dark.phase, vn: B.vent ? 1 : 0, pz: B.pz ? 1 : 0, pr: B.pr, res: B.res, win: B.win ? 1 : 0, fx: B.fx });
        if (B.relay) o.rs = B.relay.live;
      }
      if (phase === 'manual') { o.n = M.n; if (M.ra.length) o.ra = M.ra; }
      api.setPresence(o);
    }
    function adoptDiff(s) {
      if (!s || !tierOf(s.diff) || !Number.isFinite(s.dv)) return false;
      if (s.dv > L.dv || (s.dv === L.dv && String(s.dw) > String(L.dw))) { L.diff = s.diff; L.td = !!s.td; L.dv = s.dv; L.dw = s.dw; memo.diff = s.diff; memo.td = L.td; keep(); return true; }
      return false;
    }

    // ── lobby ───────────────────────────────────────────────────────────
    const clockOf = (k) => fmt(TIERS[k].secs * 1000);
    function renderLobby() {
      toTop();
      root.className = 'g-defuse is-lobby';
      root.innerHTML = `<section class="dx-lobby">
        <header>
          <p class="dx-tag">Briefing</p>
          <h2 class="dx-h">Who’s holding what?</h2>
          <p class="dx-lead">One of you gets the bomb, the other gets the field guide. Only the manual knows the rules, so talk it through out loud.</p>
        </header>
        <div class="dx-roles" role="group" aria-label="Pick your role">
          <button type="button" class="dx-role" data-role="bomb" aria-pressed="false">${ICON_BOMB}<span class="dx-role-name">Bomb</span><span class="dx-role-desc">Sees the device. Describes it, cuts and presses.</span><span class="dx-role-who"></span></button>
          <button type="button" class="dx-role" data-role="manual" aria-pressed="false">${ICON_BOOK}<span class="dx-role-name">Manual</span><span class="dx-role-desc">Reads the field guide and calls the moves.</span><span class="dx-role-who"></span></button>
        </div>
        <p class="dx-hint"><i aria-hidden="true"></i>Bomb works best on a computer, Manual on a phone.</p>
        <div class="dx-tiers" role="radiogroup" aria-label="Difficulty">${TIER_ORDER.map((k) => `<button type="button" role="radio" aria-checked="false" data-diff="${k}"><b>${TIERS[k].label}</b><span class="c">${clockOf(k)}</span><span class="dx-pips" aria-hidden="true"><i></i><i></i><i></i></span></button>`).join('')}</div>
        <p class="dx-tierinfo"></p>
        <button type="button" class="dx-today" role="switch" aria-checked="false" data-act="today"><i aria-hidden="true"></i><span>Today’s bomb: the same bomb for both of you, today only</span></button>
        <div class="dx-rec"></div>
        <p class="dx-nudge" hidden></p>
        <p class="dx-lobby-status" aria-live="polite"></p>
        <div class="dx-lobby-actions"><button type="button" class="gm-btn gm-btn-ghost" data-act="swap">Swap roles</button><button type="button" class="gm-btn" data-act="start">Start</button></div>
      </section>`;
      updateLobby();
    }
    const clock = (s) => fmt(s * 1000);
    function updateRec() {
      const box = $('.dx-rec');
      if (!box) return;
      const r = readRecords(D());
      const k = L.diff;
      const T = TIERS[k];
      const row = [];
      if (r.wins + r.booms > 0) {
        row.push(`<span>Streak <b>${r.streak}</b></span>`);
        const b = r.best[k];
        if (b.secs) row.push(`<span>Best on ${esc(T.label)}: <b>${clock(b.secs)}</b> left${b.who ? ` (${esc(api.name(b.who))}’s hands)` : ''}</span>`);
        row.push(`<span>Defused <b>${r.wins}</b></span>`);
      }
      let html = row.length ? `<div class="row">${row.join('')}</div>` : '';
      if (L.td) {
        const date = dayKey(Date.now());
        const d = D();
        const bit = (w) => { const v = dailyOf(d, date, k, w); return `${esc(api.name(w))} ${v === null ? '—' : v === 0 ? 'boom' : clock(v) + ' left'}`; };
        html += `<div class="row"><span>Today (${esc(T.label)}): <b>${bit('a')}</b> · <b>${bit('b')}</b></span></div>`;
      }
      if (r.log.length) html += `<div class="log" aria-label="Recent rounds">${[...r.log].reverse().map((e) => `<span class="${e.win ? 'win' : ''}">${esc(e.name)} · ${esc((tierOf(e.tier) || { label: e.tier }).label)} · ${e.win ? clock(e.secs) : 'boom'}</span>`).join('')}</div>`;
      box.innerHTML = html;
      const nd = $('.dx-nudge');
      const h = sameHolder(r.log, 3);
      if (nd) {
        nd.hidden = !h;
        if (h) nd.textContent = `${api.name(h)} has held the bomb three rounds running. Swap?`;
      }
      const sw = $('[data-act="swap"]');
      if (sw) sw.classList.toggle('is-nudged', !!h);
      for (const b of $$('.dx-tiers button')) {
        const m = r.medal[b.dataset.diff] | 0;
        b.querySelectorAll('.dx-pips i').forEach((p, i) => p.classList.toggle('on', i < m));
        b.setAttribute('aria-label', `${TIERS[b.dataset.diff].label}, ${clockOf(b.dataset.diff)}, ${m ? MEDAL_NAME[m] + ' medal' : 'no medal yet'}`);
      }
    }
    function updateLobby() {
      if (phase !== 'lobby') return;
      const s = P();
      const theirs = s ? s.role || null : null;
      const here = api.partnerHere;
      for (const b of $$('.dx-role')) {
        const r = b.dataset.role;
        b.classList.toggle('is-mine', L.role === r);
        b.classList.toggle('is-clash', L.role === r && theirs === r);
        b.setAttribute('aria-pressed', String(L.role === r));
        const who = [];
        if (L.role === r) who.push(me);
        if (here && theirs === r) who.push(them);
        b.querySelector('.dx-role-who').innerHTML = who.sort().map((w) => `<span class="dx-who p-${w}">${esc(w === me ? 'You' : api.name(w))}</span>`).join('');
      }
      for (const b of $$('.dx-tiers button')) b.setAttribute('aria-checked', String(b.dataset.diff === L.diff));
      const T = TIERS[L.diff];
      const info = $('.dx-tierinfo');
      if (info) info.textContent = `${T.label} · ${clockOf(L.diff)} · ${T.blurb}`;
      const td = $('.dx-today');
      if (td) td.setAttribute('aria-checked', String(L.td));
      updateRec();
      const ready = L.role && theirs && L.role !== theirs && here;
      const st = $('.dx-lobby-status');
      st.textContent = !here ? `Waiting for ${api.name(them)}…`
        : !L.role ? 'Pick a role.'
          : !theirs ? `Waiting for ${api.name(them)} to pick.`
            : L.role === theirs ? `You both picked ${cap(L.role)}. One of you switch.`
              : L.go ? 'Starting…' : `Ready. ${L.role === 'bomb' ? 'You have the bomb.' : 'You have the manual.'}`;
      $('[data-act="start"]').disabled = !ready;
      $('[data-act="swap"]').disabled = !ready;
      api.setStatus(ready ? 'Roles set' : 'Pick your roles');
    }
    function lobbyClick(e) {
      const role = e.target.closest('.dx-role');
      if (role) { L.role = role.dataset.role; memo.role = L.role; keep(); L.go = null; api.sfx('tap'); pub(); updateLobby(); return; }
      const bump = (diff, td) => {
        const s = P();
        L.dv = Math.max(L.dv, (s && s.dv) || 0) + 1; L.dw = me; L.diff = diff; L.td = td; memo.diff = diff; memo.td = td; keep();
        api.sfx('tap'); pub(); updateLobby();
      };
      const d = e.target.closest('[data-diff]');
      if (d) { bump(d.dataset.diff, L.td); return; }
      if (e.target.closest('[data-act="today"]')) { bump(L.diff, !L.td); return; }
      const act = e.target.closest('[data-act]');
      if (!act || act.disabled) return;
      const s = P();
      const theirs = s && s.role;
      if (act.dataset.act === 'swap' && L.role && theirs && L.role !== theirs) {
        // the swap rides in the event and in presence, so a dropped event still lands
        const next = { t: token(), [me]: theirs, [them]: L.role };
        L.sw = next;
        api.send('swap', next);
        L.role = theirs; memo.role = L.role; keep(); L.go = null;
        api.sfx('flip'); pub(); updateLobby();
      } else if (act.dataset.act === 'start' && L.role && theirs && L.role !== theirs) {
        if (L.role === 'bomb') begin();
        else { L.go = token(); api.send('go', { g: L.go }); pub(); updateLobby(); }
      }
    }
    function maybeGo(g) {
      if (phase !== 'lobby' || !g || seenGo.has(g)) return;
      const s = P();
      if (L.role === 'bomb' && s && s.role === 'manual') { seenGo.add(g); begin(); }
    }

    // ── the bomb side ─────────────────────────────────────────────────────
    function newBomb(seed, tier, daily) {
      const round = buildRound(seed, tier);
      const k = round.slots.length;
      return {
        n: token(), seed, tier: round.tier, daily, round, left: round.T.secs * 1000, strikes: 0,
        solved: Array(k).fill(0), slotStrikes: Array(k).fill(0), ctl: Array(k).fill(null), host: [],
        surge: { left: 0, fired: [] }, dark: { phase: 0, left: 0, fired: [] }, vent: false, ventAt: 0,
        relay: null, pz: wantPause(), pr: pauseWhy(), over: false, win: false, res: null, fx: null, recorded: false, shownSecs: -1,
        decoyAt: -1e9, note: null, active: null, ventSlot: round.slots.findIndex((s) => BY_ID[s.id].needy), info: null,
      };
    }
    let forced = null; // test hook: the next round's seed
    function begin() {
      const date = L.td ? dayKey(Date.now()) : null;
      lobbySince = 0; partnerLobby = false;
      B = newBomb(forced || (date ? dailySeed(date) : token()), L.diff, date);
      forced = null;
      memo.saved = null;
      phase = 'bomb';
      renderBomb();
      api.sfx('place');
      api.setStatus('You have the bomb');
      pub();
    }
    const modEl = (i) => $(`.dx-mod[data-slot="${i}"]`);
    function modHTML(s, i) {
      const p = BY_ID[s.id];
      const gold = B.round.gold === i;
      return `<section class="dx-mod${gold ? ' is-gold' : ''}${p.needy ? ' is-needy' : ''}${p.remote ? ' is-remote' : ''}" data-mod="${s.id}" data-slot="${i}" aria-label="${esc(p.name)}"><header class="dx-mod-head"><span class="dx-mod-tag">${i + 1} · ${esc(p.name)}</span><span class="dx-mod-end">${gold ? '<span class="dx-goldtag">GOLD</span>' : ''}${s.plate ? `<span class="dx-plate" data-plate="${s.plate}" aria-label="Plate number ${s.plate}">${s.plate}</span>` : ''}<i class="dx-led" aria-hidden="true"></i></span></header><div class="dx-mod-body"></div></section>`;
    }
    const flagsHTML = (extra) => `<div class="dx-flags"><span class="dx-flag is-pulse" data-flag="surge" hidden></span><span class="dx-flag is-pulse" data-flag="dark" hidden></span><span class="dx-flag is-pulse" data-flag="vent" hidden>VENT</span>${extra || ''}</div>`;
    const strikesHTML = '<div class="dx-strikes" aria-label="Strikes: 0 of 3"><i></i><i></i><i></i></div>';
    /** A fresh screen starts at the top: the lobby's Start button sits below the fold on a phone, and the tap that pressed it scrolled the page. */
    function toTop() {
      try { const gr = document.getElementById('game-root'); if (gr) gr.scrollTop = 0; window.scrollTo(0, 0); } catch { /* ignore */ }
    }
    function renderBomb(sv) {
      const g = B.round;
      const E = g.E;
      const k = g.slots.filter((s) => !BY_ID[s.id].needy).length;
      root.className = 'g-defuse is-bomb';
      root.innerHTML = `<div class="dx-topbar" aria-label="Clock and strikes"><div class="dx-lcd"><span class="dx-time" role="timer">${fmt(B.left)}</span><span class="dx-surgetxt"></span></div>${strikesHTML}${flagsHTML()}</div>
      <div class="dx-bomb" aria-label="The bomb">
        <i class="dx-screw"></i><i class="dx-screw"></i><i class="dx-screw"></i><i class="dx-screw"></i>
        <aside class="dx-side">
          <div class="dx-lcd"><span class="dx-tag">Time left</span><span class="dx-time" role="timer">${fmt(B.left)}</span><span class="dx-surgetxt"></span></div>
          ${strikesHTML}
          ${flagsHTML()}
          <div class="dx-sticker"><span class="dx-tag">Serial no.</span><span class="dx-serial">${E.serial}</span><span class="dx-edition">Manual: <b>${esc(g.name)}</b></span></div>
          ${E.void ? `<div class="dx-sticker is-void"><span class="dx-tag">Serial no.</span><span class="dx-serial">${E.void}</span><span class="dx-void-stamp">VOID</span></div>` : ''}
          <div class="dx-bay"><span class="dx-tag">Batteries</span><div class="dx-bats" aria-label="${E.batteries} batteries">${E.batteries ? batterySVG.repeat(E.batteries) : '<span class="dx-none">Empty bay</span>'}</div></div>
          <div class="dx-bay"><span class="dx-tag">Indicators</span><div class="dx-inds">${E.indicators.map((x) => `<span class="dx-ind${x.lit ? ' is-lit' : ''}" aria-label="${x.label}, ${x.lit ? 'lit' : 'unlit'}"><i></i>${x.label}</span>`).join('')}${E.voidInd ? `<span class="dx-ind is-void${E.voidInd.lit ? ' is-lit' : ''}" aria-label="${E.voidInd.label}, ${E.voidInd.lit ? 'lit' : 'unlit'}, stamped VOID"><i></i>${E.voidInd.label}</span>` : ''}</div></div>
          ${E.portPlate ? `<div class="dx-bay"><span class="dx-tag">Ports</span><div class="dx-ports" aria-label="${E.ports.length} ports">${E.ports.length ? E.ports.map((p) => `<span class="dx-port" data-port="${p}">${PORT_SVG[p] || ''}${p}</span>`).join('') : '<span class="dx-none">No ports</span>'}</div></div>` : ''}
        </aside>
        <div class="dx-mods" data-k="${k}">${g.slots.map(modHTML).join('')}</div>
      </div><div class="dx-fx"></div><div class="dx-pause" role="status" hidden><div><b>Paused</b><span></span></div></div>`;
      mountSlots(sv || null);
      updateBomb();
      toTop();
    }
    function hostFor(i, saved) {
      const slot = B.round.slots[i];
      const p = BY_ID[slot.id];
      const E = B.round.E;
      const dead = slot.decoy;
      return {
        E, K: ctxOf(E), T: B.round.T, saved: saved || null,
        strikes: () => B.strikes,
        left: () => B.left,
        busy: () => dead || !B || B.over || B.pz || B.dark.phase === 2 || !!B.solved[i],
        solve: () => { if (!dead && !p.needy) solveSlot(i); },
        strike: (why) => { if (!dead) strikeSlot(i, why); },
        sfx: (n) => { if (!dead) api.sfx(n); },
        haptic: (ms) => api.haptic(ms),
        later: (fn, ms) => later(fn, ms),
        now: () => performance.now(),
      };
    }
    function mountSlots(saved) {
      B.round.slots.forEach((s, i) => {
        const p = BY_ID[s.id];
        const box = modEl(i).querySelector('.dx-mod-body');
        const host = hostFor(i, saved && saved.slots ? saved.slots[i] : null);
        B.host[i] = host;
        try { B.ctl[i] = p.mount(box, s.S, B.round.book[s.id].R, host) || {}; } catch (e) { console.error(e); B.ctl[i] = {}; }
      });
      const ri = B.round.slots.findIndex((s) => BY_ID[s.id].remote);
      if (ri >= 0) {
        const p = BY_ID.relay;
        const sv = saved && saved.relay;
        B.relay = { i: ri, live: sv && sv.live ? sv.live : p.init(B.round.slots[ri].S), seen: sv && Array.isArray(sv.seen) ? [...sv.seen] : [] };
        if (B.ctl[ri] && B.ctl[ri].update) B.ctl[ri].update(B.relay.live);
      }
    }
    function updateBomb() {
      if (!B) return;
      $$('.dx-strikes').forEach((s) => { s.querySelectorAll('i').forEach((x, i) => x.classList.toggle('on', i < B.strikes)); s.setAttribute('aria-label', `Strikes: ${B.strikes} of 3`); });
      B.round.slots.forEach((s, i) => { const x = modEl(i); if (x) x.classList.toggle('is-solved', !!B.solved[i]); });
      paintFlags();
      const pz = $('.dx-pause');
      if (pz) {
        pz.hidden = !(B.pz && !B.over);
        if (!pz.hidden) pz.querySelector('span').textContent = B.pr === 'lobby' ? `${api.name(them)} went back to the lobby. The clock waits.` : B.pr === 'bg' ? `${api.name(them)} has the game in the background. The clock waits.` : B.pr === 'me' ? 'You left the game for a moment. The clock waits.' : `${api.name(them)} stepped away. The clock waits.`;
      }
    }
    function paintFlags() {
      if (!B) return;
      const sg = Math.ceil(B.surge.left / 1000);
      const set = (name, text, on) => $$(`[data-flag="${name}"]`).forEach((f) => { f.hidden = !on; if (on && text != null) f.textContent = text; });
      set('surge', `SURGE x2 · ${sg}s`, sg > 0);
      set('dark', B.dark.phase === 1 ? 'GOING DARK' : 'BLACKOUT', B.dark.phase > 0);
      set('vent', null, B.vent);
      $$('.dx-surgetxt').forEach((t) => { t.textContent = B.note && B.note.until > performance.now() ? B.note.text : sg > 0 ? `x2 · ${sg}s` : ''; });
      $$('.dx-time').forEach((t) => t.classList.toggle('is-surge', sg > 0));
      const mods = $('.dx-mods');
      if (mods) { mods.classList.toggle('is-dark', B.dark.phase === 2); mods.classList.toggle('is-warn', B.dark.phase === 1); }
      $$('.dx-topbar, .dx-bomb').forEach((x) => x.classList.toggle('is-surge', sg > 0));
    }
    function shake(i) {
      const x = modEl(i);
      if (x) { x.classList.remove('is-bad'); void x.offsetWidth; x.classList.add('is-bad'); later(() => x.classList.remove('is-bad'), 700); }
    }
    function strikeSlot(i, why) {
      if (!B || B.over) return;
      B.strikes++;
      B.slotStrikes[i]++;
      const tax = B.round.twistRules.tax;
      if (tax) { B.left = Math.max(0, B.left - tax.secs * 1000); B.note = { text: `-${tax.secs} s`, until: performance.now() + 1600 }; }
      api.sfx('bad'); api.haptic(90);
      shake(i);
      updateBomb();
      pub();
      if (B.strikes >= 3) lose('strikes'); else if (B.left <= 0) lose('time');
    }
    function solveSlot(i) {
      if (!B || B.over || B.solved[i]) return;
      B.solved[i] = 1;
      api.sfx('good'); api.haptic(20);
      if (B.round.gold === i && B.slotStrikes[i] === 0) {
        B.left += GOLD_BONUS * 1000;
        B.note = { text: `+${GOLD_BONUS} s`, until: performance.now() + 2200 };
        later(() => api.sfx('win'), 180);
      }
      updateBomb();
      pub();
      if (B.round.slots.every((s, j) => !isScored(s) || B.solved[j])) win();
    }
    function decoyTouch(i) {
      if (B.over || B.pz || B.dark.phase === 2) return;
      const now = performance.now();
      if (now - B.decoyAt < DECOY_GAP) return;
      B.decoyAt = now;
      strikeSlot(i, 'decoy');
    }
    function applyRelay(list) {
      const R = B && B.relay;
      if (!R || !Array.isArray(list) || B.over || B.pz || B.dark.phase === 2) return;
      const slot = B.round.slots[R.i];
      if (B.solved[R.i]) return;
      const p = BY_ID.relay;
      let changed = false;
      for (const a of list.slice(-8)) {
        if (!a || typeof a !== 'object' || typeof a.id !== 'string' || R.seen.includes(a.id)) continue;
        R.seen.push(a.id);
        if (R.seen.length > 40) R.seen.shift();
        const out = p.step(R.live, a, slot.S, B.round.E, B.round.book.relay.R);
        R.live = out.live;
        changed = true;
        if (B.ctl[R.i] && B.ctl[R.i].update) B.ctl[R.i].update(R.live);
        if (out.verdict === 'strike') strikeSlot(R.i, 'relay');
        else if (out.verdict === 'solve') solveSlot(R.i);
        if (B.over) break;
      }
      if (changed) pub();
    }
    function finale(kind, res, fx) {
      const fxEl = $('.dx-fx');
      if (!fxEl) return;
      if (kind === 'win') {
        const md = fx && fx.md ? fx.md : 0;
        fxEl.innerHTML = `<div class="dx-stamp" role="status"><b>DEFUSED</b><span>${esc(res && res.text ? res.text.replace(/^Defused /, '') : '')}</span>${fx && fx.ln ? `<small>${esc(fx.ln)}</small>` : ''}${md ? `<div class="dx-medal" aria-label="${MEDAL_NAME[md]} medal">${[1, 2, 3].map((n) => `<i class="${n <= md ? 'on' : ''}"></i>`).join('')}</div>` : ''}</div>`;
      } else {
        root.classList.add('is-boom');
        const pts = (R, r, n, ox = 0, oy = 0) => Array.from({ length: n * 2 }, (_, i) => { const a = (i * Math.PI) / n - Math.PI / 2; const k = i % 2 ? r : R * (0.82 + 0.18 * ((i * 7) % 5) / 4); return `${(50 + ox + Math.cos(a) * k).toFixed(1)},${(50 + oy + Math.sin(a) * k * 0.86).toFixed(1)}`; }).join(' ');
        fxEl.innerHTML = `<div class="dx-boom" role="status"><svg viewBox="0 0 100 100" aria-hidden="true"><polygon class="b0" points="${pts(50, 28, 13, 3, 3)}"/><polygon class="b1" points="${pts(50, 28, 13)}"/><polygon class="b2" points="${pts(32, 19, 11)}"/></svg><b>BOOM</b></div>`;
      }
    }
    function endRound(win, res, fx) {
      memo.saved = null;
      B.over = true; B.win = win; B.res = res; B.fx = fx || null; B.active = null; B.vent = false;
      B.surge.left = 0; B.dark.phase = 0;
      ENDED.add(B.n);
      api.sfx(win ? 'win' : 'hit'); api.haptic(win ? 30 : 220);
      finale(win ? 'win' : 'boom', res, fx);
      updateBomb();
      pub();
      if (!api.isHost) api.send('result', { n: B.n, res, win, fx: B.fx });
      later(() => api.finish(res), FINALE_MS);
    }
    /** Records are written once, here, by the bomb device. */
    function record(win, secs) {
      if (B.recorded) return null;
      B.recorded = true;
      const solved = B.round.slots.filter((s, i) => B.solved[i] && isScored(s)).map((s) => s.id);
      const out = applyResult(D(), { tier: B.tier, T: B.round.T, win, secs, strikes: B.strikes, holder: me, reader: them, solved, name: B.round.name, daily: B.daily, at: Date.now() });
      try { if (typeof api.setData === 'function') api.setData(out.patch); } catch (e) { console.error(e); }
      return out.info;
    }
    function win() {
      const secs = Math.max(0, Math.ceil(B.left / 1000));
      const T = B.round.T;
      const info = record(true, secs) || {};
      const flavour = B.strikes === 0 && secs > T.secs / 2 ? 'Not a single strike. Suspiciously smooth.'
        : B.strikes === 0 ? 'Clean hands, zero strikes.'
          : secs < 30 ? 'Cut it close. Very close.'
            : B.strikes === 2 ? 'Two strikes and a lot of nerve.' : 'One strike, no regrets.';
      const bits = [flavour];
      if (secs < 10) bits.push('Under ten seconds. Your hearts would like a word.');
      if (info.newRecord) bits.push(`New record for ${T.label}!`);
      else if (info.firstWin) bits.push(`First ${T.label} defuse!`);
      if (info.medalUp) bits.push(`${MEDAL_NAME[info.medal]} medal earned.`);
      const hint = nextMedalHint(info.medal || 0);
      if (hint) bits.push(hint);
      const tag = `${T.label} · ${B.round.edition}${B.daily ? ' · Today’s bomb' : ''}`;
      const fx = { ln: B.strikes === 0 ? coupleLine(B.n + B.seed) : '', md: info.medal || 0 };
      endRound(true, { team: true, score: secs, text: `Defused with ${fmt(B.left)} left`, sub: `${bits.join(' ')} (${tag})` }, fx);
    }
    function lose(why) {
      const T = B.round.T;
      record(false, 0);
      const left = B.round.slots.filter((s, i) => isScored(s) && !B.solved[i]).length;
      const bits = [why === 'time' ? 'The clock hit zero mid-sentence.' : 'Three strikes. The bomb had opinions.'];
      if (left === 1) bits.push('One module away from safe.');
      else if (B.strikes === 2 && why === 'time') bits.push('Two strikes and out of time. Brutal.');
      endRound(false, { team: true, text: 'Boom.', sub: `${bits.join(' ')} (${T.label} · ${B.round.edition}${B.daily ? ' · Today’s bomb' : ''})` }, null);
    }
    function startEvent(kind) {
      if (kind === 'surge') { B.surge.left = SURGE_SECS * 1000; api.sfx('pop'); }
      else { B.dark.phase = 1; B.dark.left = BLACKOUT.warn * 1000; api.sfx('tick'); cancelActive(); }
      paintFlags();
      pub();
    }
    function tickEvents(dt) {
      if (B.surge.left > 0) { B.surge.left -= dt; if (B.surge.left <= 0) { B.surge.left = 0; paintFlags(); pub(); } }
      if (B.dark.phase) {
        B.dark.left -= dt;
        if (B.dark.left <= 0) {
          if (B.dark.phase === 1) { B.dark.phase = 2; B.dark.left = BLACKOUT.dur * 1000; cancelActive(); } else { B.dark.phase = 0; B.dark.left = 0; applyRelay((P() || {}).ra); }
          paintFlags(); pub();
        }
      }
      if (B.surge.left > 0 || B.dark.phase || B.left < 30000) return; // never overlapping, never in the last 30 s
      const X = B.round.twistRules;
      const secs = B.left / 1000;
      if (X.surge) for (let k = 0; k < X.surge.at.length; k++) if (!B.surge.fired[k] && secs <= X.surge.at[k]) { B.surge.fired[k] = 1; startEvent('surge'); return; }
      if (X.blackout) for (let k = 0; k < X.blackout.at.length; k++) if (!B.dark.fired[k] && secs <= X.blackout.at[k]) { B.dark.fired[k] = 1; startEvent('blackout'); return; }
    }
    function cancelActive() {
      if (!B || B.active == null) return;
      const i = B.active;
      B.active = null;
      const c = B.ctl[i];
      if (c && c.up) { try { c.up({ type: 'pointercancel' }, true); } catch (e) { console.error(e); } }
    }
    function bombFrame(now, dt) {
      if (!B.over) {
        const lg = lobbySince && now - lobbySince > 1500;
        if (lg !== partnerLobby) { partnerLobby = lg; syncBombPause(); }
        if (!B.pz) {
          B.left -= dt * rate();
          if (B.left <= 0) { B.left = 0; lose('time'); }
          else tickEvents(dt);
        }
        if (B.note && B.note.until < now) { B.note = null; paintFlags(); }
        if (!B.over) {
          for (const c of B.ctl) if (c && c.frame) c.frame(now, dt);
          if (B.ventSlot >= 0 && now - B.ventAt > 200) {
            B.ventAt = now;
            const c = B.ctl[B.ventSlot];
            const on = !!(c && c.save && c.save().on);
            if (on !== B.vent) { B.vent = on; paintFlags(); pub(); }
          }
        }
      }
      const secs = Math.max(0, Math.ceil(B.left / 1000));
      if (secs !== B.shownSecs) {
        B.shownSecs = secs;
        $$('.dx-time').forEach((t) => { t.textContent = fmt(B.left); });
        $$('.dx-bomb, .dx-topbar').forEach((x) => x.classList.toggle('is-hurry', secs <= 30));
        if (!B.over && !B.pz && secs <= 30 && secs > 0) api.sfx('tick');
        paintFlags();
        pub();
      }
    }
    // input: forwarded to the module that owns the target
    const slotOf = (e) => { const x = e.target && e.target.closest && e.target.closest('.dx-mod[data-slot]'); return x ? +x.dataset.slot : null; };
    const isDecoy = (i) => B.round.slots[i].decoy;
    function bombClick(e) {
      if (!B || B.over) return;
      const i = slotOf(e);
      if (i == null) return;
      if (isDecoy(i)) { decoyTouch(i); return; }
      const c = B.ctl[i];
      // a module that already acted on this tap's pointerdown must not act again on the click that follows it
      // (some touch stacks send that click with detail 0, which looks like a keyboard click)
      if (c && c.down && B.lastDown && B.lastDown.slot === i && performance.now() - B.lastDown.at < 900) return;
      if (c && c.click) c.click(e);
    }
    function bombDown(e) {
      if (phase !== 'bomb' || !B || B.over || e.button > 0) return;
      const i = slotOf(e);
      if (i == null || isDecoy(i)) return;
      B.active = i;
      B.lastDown = { slot: i, at: performance.now() };
      const c = B.ctl[i];
      if (c && c.down) c.down(e);
    }
    function bombUp(e, cancel) {
      if (!B || B.active == null) return;
      const i = B.active;
      B.active = null;
      const c = B.ctl[i];
      if (c && c.up) c.up(e, cancel);
    }
    function bombKey(e) {
      if (phase !== 'bomb' || !B || B.over) return;
      const i = slotOf(e);
      if (i == null) return;
      if (isDecoy(i)) { if (e.type === 'keydown' && (e.key === 'Enter' || e.key === ' ')) decoyTouch(i); return; }
      const c = B.ctl[i];
      if (c && c.key) c.key(e);
    }
    function globalKey(e) { // Y / N for the vent from anywhere on a laptop
      if (phase !== 'bomb' || !B || B.over || B.ventSlot < 0 || root.contains(e.target)) return;
      const c = B.ctl[B.ventSlot];
      if (c && c.key) c.key(e);
    }

    // ── the manual side ───────────────────────────────────────────────────
    const lampName = (s) => BY_ID[s.id].name;
    function manualHTML() {
      const g = M.round;
      const tabs = tabsOf(g);
      const tab = (t) => `<button type="button" role="tab" data-page="${t.id}" data-n="${t.n}" aria-selected="false" class="${t.gold ? 'is-gold' : ''}${t.twin ? ' is-twin' : ''}" aria-label="${esc(t.sm)}${t.id === 'basics' ? '' : ', plate ' + t.big}${t.gold ? ', gold module' : ''}"><span class="big">${t.big}</span><span class="sm">${esc(t.sm)}</span></button>`;
      const hasRelay = g.slots.some((s) => s.id === 'relay');
      return `<div class="dx-manual-wrap">
        <div class="dx-mbar">
          <div class="dx-lcd"><span class="dx-time" role="timer">${fmt(M.left)}</span><span class="dx-surgetxt"></span></div>
          <div class="dx-strikes" aria-label="Strikes: 0 of 3"><span class="dx-tag">Strikes</span><i></i><i></i><i></i></div>
          ${flagsHTML()}
          <div class="dx-lamps">${g.slots.map((s, i) => (BY_ID[s.id].needy ? '' : `<span class="dx-lamp" data-slot="${i}" data-mod="${s.id}" title="${esc(lampName(s))}"><i></i>${esc(lampName(s))}</span>`)).join('')}</div>
        </div>
        <div class="dx-mbody">
          <nav class="dx-index" role="tablist" aria-label="Field guide sections">${tabs.map(tab).join('')}</nav>
          <article class="dx-page">${guideHTML(g)}</article>
        </div>
        ${hasRelay ? '<div class="dx-drawer" data-drawer><button type="button" class="dx-drawer-head" data-act="drawer" aria-expanded="false"><span>Relay box</span><small>Tap to open or close</small></button><div class="dx-drawer-body"></div></div>' : ''}
      </div><div class="dx-fx"></div><div class="dx-pause" role="status" hidden><div><b>Paused</b><span></span></div></div>`;
    }
    function enterManual(s) {
      if (!s || typeof s.sd !== 'string' || !tierOf(s.rd)) return;
      phase = 'manual';
      const round = buildRound(s.sd, s.rd);
      M = { n: s.n, round, left: s.left, rate: s.rate || 1, at: performance.now(), strikes: s.st | 0, solved: String(s.sv || ''), pz: !!s.pz, over: false, frozen: false, shown: '', ra: [], seq: 0, stamp: Date.now().toString(36), relay: null, sg: 0, bo: 0, vn: 0, rsKey: '' };
      root.className = 'g-defuse is-manual';
      root.innerHTML = manualHTML();
      toTop();
      mountRelayPanel();
      const ids = ['basics', ...round.ids];
      showPage(ids.includes(memo.page) ? memo.page : 'basics', true);
      watchBar();
      api.setStatus('You have the manual');
      api.sfx('place');
      pub();
      manualState(s);
    }
    function mountRelayPanel() {
      const i = M.round.slots.findIndex((s) => s.id === 'relay');
      const body = $('.dx-drawer-body');
      if (i < 0 || !body) return;
      const slot = M.round.slots[i];
      const p = BY_ID.relay;
      const host2 = {
        E: M.round.E, K: ctxOf(M.round.E), T: M.round.T,
        act: (a) => { if (!M || M.over) return; M.ra = [...M.ra, { id: `${M.stamp}.${++M.seq}`, ...a }].slice(-8); pub(); },
        sfx: (n) => api.sfx(n),
        live: () => (M && M.relay ? M.relay.live : null),
      };
      M.relay = { i, live: p.init(slot.S), ctl: null };
      try { M.relay.ctl = p.panel(body, slot.S, M.round.book.relay.R, host2); } catch (e) { console.error(e); }
      if (M.relay.ctl && M.relay.ctl.render) M.relay.ctl.render(M.relay.live);
      setDrawer(memo.drawer == null ? window.innerWidth >= 760 && window.innerHeight >= 700 : memo.drawer, false); // the default is not remembered, only a tap is
    }
    function setDrawer(open, remember = true) {
      const d = $('.dx-drawer');
      if (!d) return;
      if (remember) { memo.drawer = open; keep(); }
      d.classList.toggle('is-open', open);
      d.querySelector('.dx-drawer-head').setAttribute('aria-expanded', String(open));
    }
    let ro = null;
    function watchBar() {
      const bar = $('.dx-mbar');
      if (!bar) return;
      const set = () => root.style.setProperty('--dx-mbar-h', bar.offsetHeight + 'px');
      set();
      if (ro) ro.disconnect();
      if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(set); ro.observe(bar); }
    }
    function showPage(id, quiet) {
      memo.page = id; keep();
      $$('.dx-index [data-page]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.page === id)));
      $$('.dx-sec').forEach((x) => { x.hidden = x.dataset.page !== id; });
      const b = $(`.dx-index [data-page="${id}"]`);
      const strip = $('.dx-index');
      if (b && strip && strip.scrollWidth > strip.clientWidth + 2) strip.scrollLeft = Math.max(0, b.offsetLeft - strip.clientWidth / 2 + b.offsetWidth / 2);
      if (!quiet) { const pg = $('.dx-page'); const bar = $('.dx-mbar'); if (pg && bar && pg.getBoundingClientRect().top < bar.offsetHeight) pg.scrollIntoView({ block: 'start' }); }
    }
    function manualState(s) {
      if (!M || !s) return;
      if (s.n !== M.n) return;
      const now = performance.now();
      M.left = s.left; M.rate = s.rate || 1; M.at = now; M.pz = !!s.pz;
      const st = s.st | 0;
      if (st > M.strikes) {
        api.sfx('bad'); api.haptic(90);
        const bar = $('.dx-mbar');
        if (bar) { bar.classList.remove('is-bad'); void bar.offsetWidth; bar.classList.add('is-bad'); }
      }
      M.strikes = st;
      M.solved = String(s.sv || '');
      $$('.dx-mbar .dx-strikes i').forEach((x, i) => x.classList.toggle('on', i < st));
      $$('.dx-lamp').forEach((x) => x.classList.toggle('on', M.solved[+x.dataset.slot] === '1'));
      $$('.dx-index [data-page]').forEach((b) => {
        const idx = M.round.slots.map((x, i) => (x.id === b.dataset.page && isScored(x) ? i : -1)).filter((i) => i >= 0);
        b.classList.toggle('is-done', idx.length > 0 && idx.every((i) => M.solved[i] === '1'));
      });
      $$('[data-st]').forEach((x) => x.classList.toggle('is-now', +x.dataset.st === Math.min(2, st)));
      // timed events and the vent, mirrored from the bomb
      const sg = s.sg | 0, bo = s.bo | 0, vn = s.vn ? 1 : 0;
      if (sg && !M.sg) api.sfx('pop');
      if (vn && !M.vn) api.sfx('tick');
      if (bo && !M.bo) api.sfx('tick');
      M.sg = sg; M.bo = bo; M.vn = vn;
      const set = (name, text, on) => $$(`.dx-mbar [data-flag="${name}"]`).forEach((f) => { f.hidden = !on; if (on && text != null) f.textContent = text; });
      set('surge', `SURGE x2 · ${sg}s`, sg > 0);
      set('dark', bo === 1 ? 'GOING DARK' : 'BLACKOUT', bo > 0);
      set('vent', null, !!vn);
      $$('.dx-mbar .dx-surgetxt').forEach((t) => { t.textContent = sg > 0 ? `x2 · ${sg}s` : ''; });
      const mb = $('.dx-mbar');
      if (mb) mb.classList.toggle('is-surge', sg > 0);
      $$('.dx-mbar .dx-time').forEach((t) => t.classList.toggle('is-surge', sg > 0));
      if (M.relay && M.relay.ctl && s.rs && typeof s.rs === 'object') {
        const key = JSON.stringify(s.rs);
        if (key !== M.rsKey) {
          M.rsKey = key; M.relay.live = s.rs;
          if (M.relay.ctl.render) M.relay.ctl.render(s.rs);
          const d = $('.dx-drawer');
          if (d) d.classList.toggle('is-done', !!s.rs.d);
        }
      }
      const pz = $('.dx-pause');
      if (pz) {
        pz.hidden = !(M.pz && !M.over);
        if (!pz.hidden) pz.querySelector('span').textContent = s.pr === 'lobby' ? 'The bomb is paused while you are not in the round.' : `The bomb is paused. ${api.name(them)} ${s.pr === 'bg' || s.pr === 'me' ? 'has the game in the background' : 'stepped away'}.`;
      }
      watchBarSoon();
      if (s.ph === 'over' && !M.over) manualOver(s.res, !!s.win, s.fx);
    }
    function watchBarSoon() { const bar = $('.dx-mbar'); if (bar) root.style.setProperty('--dx-mbar-h', bar.offsetHeight + 'px'); }
    function manualOver(res, win, fx) {
      if (!M || M.over) return;
      M.over = true;
      ENDED.add(M.n);
      finale(win ? 'win' : 'boom', res, fx);
      api.sfx(win ? 'win' : 'hit');
      // the host records it; the guest's end card normally arrives from the host, with a fallback
      if (res) later(() => api.finish(res), api.isHost ? FINALE_MS : FINALE_MS + 1500);
    }
    function manualFrame(now) {
      const left = M.over || M.pz || M.frozen ? M.left : M.left - (now - M.at) * M.rate;
      const t = fmt(left);
      if (t !== M.shown) { M.shown = t; $$('.dx-time').forEach((x) => { x.textContent = t; }); }
    }

    // ── wiring ────────────────────────────────────────────────────────────
    root.addEventListener('click', (e) => {
      if (phase === 'lobby') lobbyClick(e);
      else if (phase === 'bomb') bombClick(e);
      else if (phase === 'manual') {
        const t = e.target.closest('.dx-index [data-page]');
        if (t) { showPage(t.dataset.page); api.sfx('flip'); return; }
        if (e.target.closest('[data-act="drawer"]')) { setDrawer(!$('.dx-drawer').classList.contains('is-open')); return; }
        if (e.target.closest('[data-act="relay-open"]')) setDrawer(true);
      }
    });
    root.addEventListener('pointerdown', bombDown);
    const up = (e) => bombUp(e, false);
    const cancel = (e) => bombUp(e, true);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    root.addEventListener('keydown', bombKey);
    root.addEventListener('keyup', bombKey);
    document.addEventListener('keydown', globalKey);
    root.addEventListener('contextmenu', (e) => { if (e.target.closest('.dx-big, .dx-pad, .dx-gkey, .dx-wire')) e.preventDefault(); });
    offs.push(() => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); document.removeEventListener('keydown', globalKey); if (ro) ro.disconnect(); });

    offs.push(api.onPartnerState((s) => {
      if (!alive || !s || s.v !== 2) return;
      if (adoptDiff(s) && phase === 'lobby') pub();
      if (phase === 'lobby') {
        if (s.ph === 'play' && s.role === 'bomb' && L.role === 'manual' && s.n && !ENDED.has(s.n)) { enterManual(s); return; }
        if (s.sw) takeSwap(s.sw);
        if (s.go) maybeGo(s.go);
        updateLobby();
      } else if (phase === 'manual') {
        // the bomb device came back without our round (a reload) and started a new one, or is back in the lobby
        if (s.ph === 'play' && s.role === 'bomb' && s.n && s.n !== M.n && !ENDED.has(s.n)) { enterManual(s); return; }
        if (s.ph === 'lobby' && !M.over) { backToLobby(); return; }
        manualState(s);
      } else if (phase === 'bomb') {
        lobbySince = s.ph === 'lobby' && !B.over ? lobbySince || performance.now() : 0;
        if (s.ra) applyRelay(s.ra);
      }
      if (!!s.hid !== partnerHid) { partnerHid = !!s.hid; syncBombPause(); }
    }));
    offs.push(api.on('go', (d) => { if (d && d.g) maybeGo(d.g); }));
    function takeSwap(d) {
      if (phase !== 'lobby' || !d || !d.t || seenSwap.has(d.t) || (d[me] !== 'bomb' && d[me] !== 'manual')) return;
      seenSwap.add(d.t);
      L.role = d[me]; memo.role = L.role; keep(); L.go = null; api.sfx('flip'); pub(); updateLobby();
    }
    offs.push(api.on('swap', takeSwap));
    offs.push(api.on('result', (d) => { if (phase === 'manual' && d && d.n === M.n) manualOver(d.res, !!d.win, d.fx); }));
    offs.push(api.onPartnerHere((here) => {
      if (!here) partnerHid = false;
      syncBombPause();
      if (phase === 'manual' && M) { if (!here) { M.left = M.left - (performance.now() - M.at) * M.rate; M.at = performance.now(); } M.frozen = !here; }
      if (phase === 'lobby') updateLobby();
    }));
    if (typeof api.onData === 'function') offs.push(api.onData(() => { if (alive && phase === 'lobby') updateRec(); }));

    // ── pausing: the bomb's clock stops while either player is gone, in the background, or back in the lobby ──
    function wantPause() { return !api.partnerHere || partnerHid || document.hidden || partnerLobby; }
    function pauseWhy() { return document.hidden ? 'me' : !api.partnerHere ? 'gone' : partnerHid ? 'bg' : partnerLobby ? 'lobby' : ''; }
    function syncBombPause() {
      if (phase !== 'bomb' || !B || B.over) return;
      const want = wantPause();
      const why = want ? pauseWhy() : '';
      if (want === B.pz && why === B.pr) return;
      B.pz = want; B.pr = why;
      if (want) cancelActive();
      last = 0;
      updateBomb();
      pub();
      if (!want) applyRelay((P() || {}).ra); // relay actions the manual sent while we were paused
    }
    const onVis = () => { last = 0; if (phase === 'bomb') syncBombPause(); pub(); };
    document.addEventListener('visibilitychange', onVis);
    offs.push(() => document.removeEventListener('visibilitychange', onVis));
    function backToLobby() {
      phase = 'lobby'; M = null; L.go = null;
      renderLobby();
      pub();
      api.toast(`${api.name(them)}’s bomb restarted. Start a new round.`);
    }
    /** This device closed the game mid-round with the bomb, and the manual is still reading it: carry on. */
    function resumeBomb(s) {
      const sv = memo.saved;
      if (!sv || !s || s.ph !== 'reading' || s.n !== sv.n || ENDED.has(sv.n) || Date.now() - sv.at > 30 * 60000) return false;
      memo.saved = null;
      lobbySince = 0; partnerLobby = false;
      B = newBomb(sv.seed, sv.tier, sv.daily);
      Object.assign(B, { n: sv.n, left: sv.left, strikes: sv.strikes, solved: sv.solved, slotStrikes: sv.slotStrikes });
      B.surge = { left: sv.surge.left, fired: sv.surge.fired };
      B.dark = { phase: 0, left: 0, fired: sv.dark.fired };
      L.role = 'bomb'; memo.role = 'bomb'; keep();
      phase = 'bomb';
      renderBomb(sv);
      api.setStatus('You have the bomb');
      pub();
      return true;
    }
    let last = 0;
    function frame(now) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(250, now - (last || now));
      last = now;
      if (phase === 'bomb' && B) bombFrame(now, dt);
      else if (phase === 'manual' && M) manualFrame(now);
    }

    {
      const s = P();
      if (s) adoptDiff(s);
      if (!resumeBomb(s)) {
        renderLobby();
        pub();
        if (s) { if (s.ph === 'play' && s.role === 'bomb' && L.role === 'manual' && s.n && !ENDED.has(s.n)) enterManual(s); else updateLobby(); }
      }
    }
    raf = requestAnimationFrame(frame);

    // test hook (automation only)
    const scope = (sel, slot) => (/^\.dx-mod\[data-mod="[a-z]+"\]/.test(sel) ? sel.replace(/^\.dx-mod\[data-mod="[a-z]+"\]/, `.dx-mod[data-slot="${slot}"]`) : `.dx-mod[data-slot="${slot}"] ${sel}`);
    const hook = {
      info: () => ({
        phase, role: L.role, partnerRole: (P() || {}).role || null, diff: L.diff, tier: L.diff, today: L.td,
        bomb: B && {
          n: B.n, seed: B.seed, tier: B.tier, diff: B.tier, daily: B.daily, left: B.left, strikes: B.strikes, solved: [...B.solved], over: B.over, win: B.win, res: B.res, fx: B.fx,
          pz: B.pz, pr: B.pr, round: B.round, surge: B.surge.left, dark: B.dark.phase, vent: B.vent, relay: B.relay && B.relay.live, gold: B.round.gold, rate: rate(), slotStrikes: [...B.slotStrikes],
          slots: B.round.slots.map((s, i) => ({ id: s.id, plate: s.plate, decoy: s.decoy, solved: !!B.solved[i] })),
        },
        manual: M && { n: M.n, strikes: M.strikes, solved: M.solved, over: M.over, shown: M.shown, tier: M.round.tier, seed: M.round.seed, sg: M.sg, bo: M.bo, vn: M.vn, relay: M.relay && M.relay.live, ra: M.ra },
      }),
      gen: (seed, tier) => buildRound(seed, tier || 'normal'),
      saveOf: (i) => (B && B.ctl[i] && B.ctl[i].save ? B.ctl[i].save() : null),
      drive: (i) => {
        if (!B) return [];
        const s = B.round.slots[i];
        const p = BY_ID[s.id];
        if (!s || !p.drive) return [];
        const live = p.remote ? B.relay && B.relay.live : { ...((B.ctl[i] && B.ctl[i].save && B.ctl[i].save()) || {}), strikes: B.strikes };
        return p.drive(s.S, B.round.E, B.round.book[s.id].R, live).map((a) => ({ ...a, sel: scope(a.sel, i) }));
      },
      force: (seed) => { forced = seed; },
      setLeft: (ms) => { if (B && !B.over) { B.left = ms; pub(); } },
      records: () => readRecords(D()),
      presenceBytes: () => jlen(api.partnerState()),
    };
    if (navigator.webdriver) window.__defuse = hook;

    return {
      destroy() {
        alive = false;
        if (phase === 'bomb' && B && !B.over) {
          memo.saved = {
            n: B.n, at: Date.now(), seed: B.seed, tier: B.tier, daily: B.daily, left: B.left, strikes: B.strikes, solved: [...B.solved], slotStrikes: [...B.slotStrikes],
            slots: B.ctl.map((c) => { try { return c && c.save ? c.save() : null; } catch { return null; } }),
            relay: B.relay ? { live: B.relay.live, seen: [...B.relay.seen] } : null, surge: { left: B.surge.left, fired: [...B.surge.fired] }, dark: { fired: [...B.dark.fired] },
          };
        }
        cancelAnimationFrame(raf);
        timers.forEach((t) => clearTimeout(t));
        timers.clear();
        if (B) for (const c of B.ctl) if (c && c.destroy) { try { c.destroy(); } catch { /* ignore */ } }
        offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
        if (window.__defuse === hook) delete window.__defuse;
      },
    };
  },
});
