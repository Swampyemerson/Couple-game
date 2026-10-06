import { CONFIG } from './config.js';
import {
  PACKS, CATEGORIES, SPICY_CATEGORIES, DAILY, TRUTHS, DARES, TOD_LEVELS, DATES, DATE_CATS, LOVE_LANGS,
} from './content.js';
import { Store, randomId } from './store.js';
import { initGames, gamesHubHTML, gamesHomeHTML, gamesWaitingCount, gamesIdentityChanged, GAMES } from './games/core.js';
import './games/index.js';

const store = new Store(CONFIG);
const $app = document.getElementById('app');
const PACK = Object.fromEntries(PACKS.map((p) => [p.id, p]));
const ARTIFACT = !!globalThis.JUST_US_ARTIFACT;

// History can be unavailable inside sandboxed frames.
const hist = (fn, ...args) => { try { history[fn](...args); return true; } catch { return false; } };
const CAT = Object.fromEntries([...CATEGORIES, ...SPICY_CATEGORIES].map((c) => [c.id, c]));
const SKIPPED = '—';

// A reload puts you back where you were (not into a spicy pack, though: that stays behind the gate).
const VIEWS = new Set(['tab', 'pack', 'tod', 'dates', 'history', 'sync', 'connect']);
let ui = (() => {
  let st = null;
  try { st = history.state; } catch { /* sandboxed */ }
  if (!st || typeof st !== 'object' || !VIEWS.has(st.view)) return { view: 'tab', tab: 'home' };
  if (st.view === 'pack' && (!PACK[st.packId] || PACK[st.packId].spicy)) return { view: 'tab', tab: 'home' };
  if (st.view === 'tab' && st.tab === 'spicy') return { view: 'tab', tab: 'spicy' };
  return { ...st };
})();
const session = {
  spicyOpen: false,
  temp: null,
  drafts: {},
  tod: { level: 'sweet', turn: null, kind: null, card: null, decks: {} },
  date: { cat: 'home', pick: null, spinning: false },
  pendingRender: false,
};

// ── tiny helpers ──────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return dkey(new Date(y, m - 1, d + n)); };
const dayNum = (key) => { const [y, m, d] = key.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2025, 0, 1)) / 864e5); };
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const STEP = [37, 41, 43, 47, 53].find((s) => gcd(s, DAILY.length) === 1) || 1;
const dailyQ = (key) => DAILY[(((dayNum(key) * STEP) % DAILY.length) + DAILY.length) % DAILY.length];
const prettyDate = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const me = () => store.me;
const them = () => store.partner;
const N = (who) => esc(store.name(who));
const appUrl = () => location.origin + location.pathname;

function readSet(key) { try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); } }
function saveSet(key, set) { try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* ignore */ } }

const pdata = (who, p) => store.person(who).packs?.[p.id] || {};
const ansOf = (who, p) => pdata(who, p).ans || {};
const doneOf = (who, p) => !!pdata(who, p).done;
const has = (ans, i) => ans['i' + i] !== undefined && ans['i' + i] !== null;
const countOf = (who, p) => { const a = ansOf(who, p); return p.items.filter((_, i) => has(a, i)).length; };
const packTitle = (p) => (p.spicy && !session.spicyOpen ? 'Something spicy' : esc(p.title));
// "Seen" results are remembered per round of answers, so a redo by either of you makes them new again.
const seenKey = (p) => `${p.id}@${pdata('a', p).done || 0}.${pdata('b', p).done || 0}`;
const isSeen = (p, set) => set.has(seenKey(p)) || set.has(p.id); // a bare id: seen before this was tracked per round
// Question screens ignore taps for a moment after moving on, so a double tap can't answer
// the next question before it has been read.
const tapLocked = () => performance.now() < (session.lockUntil || 0);
const onQuestion = (p, idx) => ui.view === 'pack' && ui.packId === p.id && ui.step === 'play' && (ui.idx ?? 0) === idx;

// ── printed icon set ──────────────────────────────────────────────────
// 24px grid, 2px key-plate stroke. `.f` parts take a flat ink fill, `.d` parts are solid.
const ICO = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  next: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  prev: '<path d="M19 12H6M11 6l-6 6 6 6"/>',
  chev: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect class="f" x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5M12 14.3v2.6"/>',
  flame: '<path class="f" d="M12.4 2.8c.5 3.4 5.1 5.3 5.1 10.6a5.5 5.5 0 0 1-11 0c0-2.6 1.2-4.2 2.7-5.3.2 1.7 1 2.7 2.1 3.1-.5-3.1-.2-6.2 1.1-8.4z"/>',
  calendar: '<rect class="f" x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10.2h16M8.5 3.5v4M15.5 3.5v4"/><circle class="d" cx="12" cy="15" r="1.6"/>',
  list: '<rect class="f" x="4" y="3.5" width="16" height="17" rx="2"/><path d="M7.8 9.2l1.5 1.5 2.6-3M7.8 15.2l1.5 1.5 2.6-3M14.4 9.8h2.4M14.4 15.8h2.4"/>',
  ribbon: '<circle class="f" cx="12" cy="9.5" r="5.5"/><path d="M8.7 14l-1.7 6.5 5-2.5 5 2.5-1.7-6.5"/>',
  book: '<path class="f" d="M3.5 5.5c3.2-1.2 5.9-.9 8.5 1 2.6-1.9 5.3-2.2 8.5-1v13.6c-3.2-1.2-5.9-.9-8.5 1-2.6-1.9-5.3-2.2-8.5-1z"/><path d="M12 6.5v13.6"/>',
  sync: '<path d="M5.2 9.5A7 7 0 0 1 18 7.2M18.8 14.5A7 7 0 0 1 6 16.8"/><path d="M18.5 3.5v4h-4M5.5 20.5v-4h4"/>',
  swap: '<path d="M7.5 4 4 7.5 7.5 11M4 7.5h12.5M16.5 13l3.5 3.5-3.5 3.5M20 16.5H7.5"/>',
  die: '<rect class="f" x="4.6" y="4.6" width="14.8" height="14.8" rx="3.4" transform="rotate(-9 12 12)"/><circle class="d" cx="8.6" cy="9" r="1.35"/><circle class="d" cx="12" cy="12" r="1.35"/><circle class="d" cx="15.4" cy="15" r="1.35"/>',
  cards: '<rect x="3.8" y="6" width="10" height="14" rx="1.8" transform="rotate(-10 8.8 13)"/><rect class="f" x="10" y="3.8" width="10" height="14" rx="1.8" transform="rotate(9 15 10.8)"/>',
  wheel: '<circle class="f" cx="12" cy="10.5" r="7.5"/><path d="M12 3v15M4.5 10.5h15M6.7 5.2l10.6 10.6M17.3 5.2 6.7 15.8"/><path d="M9 21.5h6"/><circle class="d" cx="12" cy="10.5" r="1.8"/>',
  candle: '<rect class="f" x="9" y="10" width="6" height="10" rx="1"/><path d="M12 10V8.2M5.5 20.5h13"/><path class="d" d="M12 2.6c1.6 1.7 2.1 2.8 2.1 3.7a2.1 2.1 0 0 1-4.2 0c0-.9.5-2 2.1-3.7z"/>',
  eyeOff: '<path d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6z"/><circle class="f" cx="12" cy="12" r="2.8"/><path d="M4.5 4.5l15 15"/>',
  keyhole: '<circle class="f" cx="12" cy="9.3" r="3.6"/><path class="f" d="M10.4 12.2 9.2 19h5.6l-1.2-6.8"/>',
  hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11"/><path class="f" d="M8 3.5c0 4.6 8 4.4 8 8.5s-8 3.9-8 8.5h8c0-4.6-8-4.4-8-8.5s8-3.9 8-8.5z"/>',
  star: '<path class="f" d="M12 3.2l2.3 5.4 5.8.5-4.4 3.8 1.3 5.7L12 15.6l-5 3 1.3-5.7-4.4-3.8 5.8-.5z"/>',
  pen: '<path class="f" d="M15.6 4.4l4 4L9.2 18.8 4.5 19.5l.7-4.7z"/><path d="M13.2 6.8l4 4"/>',
  share: '<path d="M12 15V3.8M7.8 8 12 3.8 16.2 8"/><path class="f" d="M5 11.5v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle class="f" cx="12" cy="12" r="5"/><circle class="d" cx="12" cy="12" r="1.6"/>',
  scale: '<path d="M12 4v15.5M8 20h8M4.5 7.5h15"/><path class="f" d="M4.5 7.5 2.2 13.2a2.4 2.4 0 0 0 4.6 0zM19.5 7.5l-2.3 5.7a2.4 2.4 0 0 0 4.6 0z"/>',
  sign: '<path d="M12 3v18M8.5 21h7"/><path class="f" d="M12 5h6.2l2.3 2.4-2.3 2.4H12zM12 12H5.8l-2.3 2.4 2.3 2.4H12z"/>',
  who: '<circle class="f" cx="7.5" cy="8.5" r="3.2"/><circle cx="16.5" cy="8.5" r="3.2"/><path d="M2.8 19.5c.5-3.4 2.3-5.2 4.7-5.2s4.2 1.8 4.7 5.2M11.8 19.5c.5-3.4 2.3-5.2 4.7-5.2s4.2 1.8 4.7 5.2"/>',
  hand: '<path class="f" d="M7.4 12.2V6.8a1.4 1.4 0 0 1 2.8 0v4.4-6a1.4 1.4 0 0 1 2.8 0v6-4.6a1.4 1.4 0 0 1 2.8 0v5.2-2.4a1.4 1.4 0 0 1 2.8 0v5.4c0 3.6-2.6 6.7-6.3 6.7-2.3 0-3.7-.9-5-2.7l-2.5-3.6a1.5 1.5 0 0 1 2.3-1.9z"/>',
  talk: '<path d="M13.5 15.6h2.2l3.3 2.9v-2.9h.2a1.8 1.8 0 0 0 1.8-1.8V9.6a1.8 1.8 0 0 0-1.8-1.8h-1.4"/><path class="f" d="M3 5.8A1.8 1.8 0 0 1 4.8 4h9.6a1.8 1.8 0 0 1 1.8 1.8v6.4a1.8 1.8 0 0 1-1.8 1.8H9.2L5.5 17v-3h-.7A1.8 1.8 0 0 1 3 12.2z"/>',
  us: '<path class="f" d="M12 7.4a5.5 5.5 0 0 1 0 9.2 5.5 5.5 0 0 1 0-9.2z"/><circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>',
  moon: '<path class="f" d="M19 14.6A7.6 7.6 0 0 1 9.4 5a7.6 7.6 0 1 0 9.6 9.6z"/><path d="M16.5 4.5v3M15 6h3"/>',
};
const icon = (n, cls = '') => `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICO[n] || ''}</svg>`;
// Packs are drawn as an issue of their category: the category's icon and ink, plus a number.
const CAT_ICON = { quiz: 'target', thisorthat: 'scale', wyr: 'sign', who: 'who', nhie: 'hand', talk: 'talk', about: 'us', desire: 'flame', spicyquiz: 'target', spicyplay: 'die', spicytalk: 'moon' };
const packIcon = (p) => icon(CAT_ICON[p.cat] || 'talk');
const packNo = (p) => PACKS.filter((x) => x.cat === p.cat).indexOf(p) + 1;
// Their two-ring mark: Emerson's blue and Sydney's pink, overprinting where they meet.
const logoMark = (cls = '') => `<svg class="logo-mark${cls ? ' ' + cls : ''}" viewBox="0 0 132 84" aria-hidden="true"><circle class="lw" cx="80" cy="42" r="34"/><circle class="la" cx="52" cy="42" r="34"/><circle class="lb" cx="80" cy="42" r="34"/><circle class="lk" cx="52" cy="42" r="34"/><circle class="lk" cx="80" cy="42" r="34"/></svg>`;

function toast(msg) {
  document.querySelectorAll('.toast').forEach((x) => x.remove()); // one at a time
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  // In a game, the message sits on the status line under the player chips, never over the board.
  if (document.body.classList.contains('gm-open')) {
    t.classList.add('in-game');
    const st = document.querySelector('#game-root .gm:not(.is-immersive) .gm-status');
    const r = st && st.getBoundingClientRect();
    if (r && r.height) t.style.top = `${Math.max(8, Math.round(r.top - 6))}px`;
  }
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

// confirm() is blocked inside artifacts, so ask in-page.
function ask(msg, okLabel = 'Yes') {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><p class="sheet-kicker">Just checking</p><p>${esc(msg)}</p>
      <div class="sheet-btns"><button class="btn alt small" data-r="0">Cancel</button><button class="btn small" data-r="1">${esc(okLabel)}</button></div></div>`;
    const done = (yes) => { document.removeEventListener('keydown', onKey, true); wrap.remove(); resolve(yes); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b && e.target !== wrap) return;
      done(!!(b && b.dataset.r === '1'));
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-r="0"]').focus({ preventScroll: true });
  });
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); return ok;
  }
}

async function share(text, url) {
  if (ARTIFACT) {
    const ok = await copy(url ? `${text}\n${url}` : text);
    toast(ok ? `Copied. Text it to ${store.name(them())}` : 'Couldn’t copy on this device');
    return;
  }
  if (navigator.share) {
    try { await navigator.share({ text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  await copy(url ? `${text}\n${url}` : text);
  toast('Copied! Paste it to ' + store.name(them()));
}

// Message to send partner; in link mode it carries my answers.
async function nudge(text) {
  if (ARTIFACT) return share(text);
  if (store.mode === 'cloud') return share(text, appUrl());
  const url = await store.exportLink();
  markExported();
  return share(text + ' (open this to load my answers)', url);
}
function markExported() { try { localStorage.setItem('jt.exported', String(store.person(me()).updated || 0)); } catch { /* ignore */ } }
const needsExport = () => {
  if (store.mode !== 'local') return false;
  let last = 0; try { last = Number(localStorage.getItem('jt.exported') || 0); } catch { /* ignore */ }
  return (store.person(me()).updated || 0) > last;
};

// ── navigation ────────────────────────────────────────────────────────
function go(next) { ui = next; session.pushed = hist('pushState', ui, '') || session.pushed; session.temp = null; render(true); }
function update(patch, top = true) { Object.assign(ui, patch); hist('replaceState', ui, ''); render(top); }
function back() {
  if (session.pushed && ui.view !== 'tab' && hist('back')) return;
  ui = { view: 'tab', tab: 'home' }; hist('replaceState', ui, ''); session.temp = null; render(true);
}
window.addEventListener('popstate', (e) => { ui = e.state || { view: 'tab', tab: 'home' }; session.temp = null; render(true); });

// ── rendering ─────────────────────────────────────────────────────────
function render(top = false) {
  const active = document.activeElement;
  if (!top && active && /^(TEXTAREA|INPUT)$/.test(active.tagName) && $app.contains(active)) {
    session.pendingRender = true; // don't clobber what they're typing
    return;
  }
  session.pendingRender = false;
  let html;
  if (!me()) html = viewWho();
  else if (ui.view === 'pack') html = viewPack();
  else if (ui.view === 'tod') html = viewTod();
  else if (ui.view === 'dates') html = viewDates();
  else if (ui.view === 'history') html = viewHistory();
  else if (ui.view === 'sync') html = viewSync();
  else if (ui.view === 'connect') html = viewConnect();
  else html = viewTab();
  const y = window.scrollY;
  $app.innerHTML = html;
  document.body.classList.toggle('spicy-mode', (ui.view === 'tab' && ui.tab === 'spicy') || (ui.view === 'pack' && PACK[ui.packId]?.spicy) || (ui.view === 'tod' && session.tod.level === 'spicy'));
  window.scrollTo(0, top ? 0 : y);
  restoreDrafts();
}

function restoreDrafts() {
  $app.querySelectorAll('[data-draft]').forEach((el) => {
    const k = el.dataset.draft;
    if (session.drafts[k] != null && !el.value) el.value = session.drafts[k];
  });
}

function syncPill() {
  const dot = '<i class="pill-dot" aria-hidden="true"></i>';
  if (store.mode === 'artifact') {
    const bad = store.readOnly || store.full || !store.online;
    return `<button class="pill ${bad ? 'warn' : 'ok'}" data-act="go" data-view="sync">${dot}${store.readOnly ? 'Can’t save' : store.full ? 'Storage full' : store.online ? 'Synced' : 'Reconnecting'}</button>`;
  }
  if (store.mode === 'cloud') {
    return `<button class="pill ${store.online ? 'ok' : ''}" data-act="go" data-view="sync">${dot}${store.online ? 'Synced' : 'Offline'}</button>`;
  }
  return `<button class="pill ${needsExport() ? 'warn' : ''}" data-act="go" data-view="sync">${icon('sync')}Sync</button>`;
}

function topbar(title, { backBtn = true, right = '' } = {}) {
  return `<header class="topbar">
    ${backBtn ? `<button class="icon-btn" data-act="back" aria-label="Back">${icon('back')}</button>` : '<span class="icon-btn ghost"></span>'}
    <h1>${title}</h1>
    <div class="topbar-right">${right}</div>
  </header>`;
}

const TAB_ICONS = {
  home: '<path class="f" d="M4.5 10.4 12 4.2l7.5 6.2v8.4a1.2 1.2 0 0 1-1.2 1.2H14.2v-5.2h-4.4V20H5.7a1.2 1.2 0 0 1-1.2-1.2z"/>',
  play: '<path d="M13.5 15.6h2.2l3.3 2.9v-2.9h.2a1.8 1.8 0 0 0 1.8-1.8V9.6a1.8 1.8 0 0 0-1.8-1.8h-1.4"/><path class="f" d="M3 5.8A1.8 1.8 0 0 1 4.8 4h9.6a1.8 1.8 0 0 1 1.8 1.8v6.4a1.8 1.8 0 0 1-1.8 1.8H9.2L5.5 17v-3h-.7A1.8 1.8 0 0 1 3 12.2z"/>',
  games: '<rect class="f" x="4.6" y="4.6" width="14.8" height="14.8" rx="3.4" transform="rotate(-9 12 12)"/><circle class="d" cx="8.6" cy="9" r="1.35"/><circle class="d" cx="12" cy="12" r="1.35"/><circle class="d" cx="15.4" cy="15" r="1.35"/>',
  spicy: '<path class="f" d="M12.4 2.8c.5 3.4 5.1 5.3 5.1 10.6a5.5 5.5 0 0 1-11 0c0-2.6 1.2-4.2 2.7-5.3.2 1.7 1 2.7 2.1 3.1-.5-3.1-.2-6.2 1.1-8.4z"/>',
  us: '<path class="f" d="M12 7.4a5.5 5.5 0 0 1 0 9.2 5.5 5.5 0 0 1 0-9.2z"/><circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>',
};
function tabbar() {
  const t = (id, label, badge = 0) => `<button class="tab ${ui.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}"><svg class="tab-ico" viewBox="0 0 24 24" aria-hidden="true">${TAB_ICONS[id]}</svg>${label}${badge ? `<i class="tab-badge">${badge}</i>` : ''}</button>`;
  return `<nav class="tabbar">${t('home', 'Home')}${t('play', 'Questions')}${t('games', 'Games', gamesWaitingCount())}${t('spicy', 'Spicy')}${t('us', 'Us')}</nav>`;
}

// Games run in their own overlay (#game-root); this just starts the engine once we know who's here.
let gamesStarted = false;
function ensureGames() {
  if (gamesStarted || !me()) return;
  gamesStarted = true;
  initGames(store, { onChange: () => render(), toast, ask });
}

// ── onboarding ────────────────────────────────────────────────────────
// Someone else's Claude account has already picked this person.
const takenBy = (w) => ARTIFACT && !!store.uid && store.uidsOf(w).size > 0 && !store.uidsOf(w).has(store.uid);

function viewWho() {
  if (ARTIFACT && !session.ready) {
    return `<div class="screen center onboard">${logoMark('is-loading')}<p class="muted">Getting your answers…</p></div>`;
  }
  const btn = (w, cls) => `<button class="btn big-btn ${cls}" data-act="pickMe" data-who="${w}"${takenBy(w) ? ' data-taken="1"' : ''}>I’m ${N(w)}${takenBy(w) ? '<small>set up on another account</small>' : ''}</button>`;
  return `<div class="screen center onboard">
    ${logoMark()}
    <h1 class="big mast-title">${esc(CONFIG.appName)}</h1>
    <p class="onboard-lede">Our own little game app. Who’s playing on this device?</p>
    <div class="stack">
      ${btn('a', 'who-btn p-a')}
      ${btn('b', 'who-btn p-b')}
    </div>
    <p class="tiny muted onboard-note">You only pick once. Your other devices on this Claude account will know it’s you.</p>
  </div>`;
}

function viewConnect() {
  const room = store.room;
  return `${topbar('Connect phones', { backBtn: false })}
  <div class="screen">
    ${room ? `
      <div class="card">
        <h2>${icon('link')}Send this to ${N(them())}</h2>
        <p class="muted">When ${N(them())} opens it, your phones are linked for good. Everything syncs live.</p>
        <button class="btn" data-act="sharePair">Share pairing link</button>
      </div>
      <button class="btn alt" data-act="tab" data-tab="home">Done, let’s play ${icon('next')}</button>
    ` : `
      <div class="card">
        <h2>${icon('link')}Link your phones</h2>
        <p class="muted">One of you creates your private space and sends the link to the other.</p>
        <button class="btn" data-act="createRoom">Create our space</button>
      </div>
      <div class="card">
        <h2>Got a link from ${N(them())}?</h2>
        <p class="muted">Just open it on this phone — or paste it here.</p>
        <input class="input" data-draft="pair" placeholder="Paste link…" />
        <button class="btn alt" data-act="joinRoom">Join</button>
      </div>
      <button class="btn ghost" data-act="tab" data-tab="home">Skip for now</button>
    `}
  </div>`;
}

// ── tabs ──────────────────────────────────────────────────────────────
function viewTab() {
  const body = { home: tabHome, play: tabPlay, games: tabGames, spicy: tabSpicy, us: tabUs }[ui.tab] || tabHome;
  return body() + tabbar();
}

function streak() {
  const both = (k) => store.person('a').daily?.[k] && store.person('b').daily?.[k];
  let k = dkey();
  if (!both(k)) k = addDays(k, -1);
  let n = 0;
  while (both(k)) { n++; k = addDays(k, -1); }
  return n;
}

function daysTogether() {
  const s = store.state.shared.since;
  if (!s) return null;
  return dayNum(dkey()) - dayNum(s);
}

function dailyCard(key, { compact = false } = {}) {
  const q = dailyQ(key);
  const mine = store.person(me()).daily?.[key];
  const theirs = store.person(them()).daily?.[key];
  let inner;
  if (!mine) {
    inner = `<textarea class="input" rows="3" data-draft="daily-${key}" placeholder="Your answer…"></textarea>
      <div class="daily-act"><button class="btn" data-act="saveDaily" data-key="${key}">Lock it in</button>
      <p class="tiny muted">${theirs ? `${N(them())} already answered. Answer to unlock it.` : `Answers stay hidden until you’ve both answered.`}</p></div>`;
  } else if (!theirs) {
    inner = `${bubble(me(), mine)}
      <div class="locked">${icon('lock')}Waiting on ${N(them())}…</div>
      <button class="btn ghost small" data-act="nudge" data-text="${esc(`Answer today's question on ${CONFIG.appName} 👀`)}">Nudge ${N(them())}</button>`;
  } else {
    inner = bubble(me(), mine) + bubble(them(), theirs);
  }
  return `<div class="card daily ${compact ? 'compact' : ''}">
    <div class="eyebrow">${key === dkey() ? (compact ? 'Today' : 'Question of the day') : key === addDays(dkey(), -1) ? 'Yesterday' : prettyDate(key)}</div>
    <h2 class="q">${esc(q)}</h2>
    ${inner}
  </div>`;
}

function bubble(who, text) {
  const skipped = text === SKIPPED;
  return `<div class="bubble p-${who} ${who === me() ? 'mine' : 'theirs'}">
    <div class="who">${N(who)}</div>
    <div class="txt ${skipped ? 'muted' : ''}">${skipped ? 'skipped' : esc(text)}</div>
  </div>`;
}

function packRow(p, note = '') {
  const locked = p.spicy && !session.spicyOpen;
  return `<button class="row c-${p.cat}" data-act="openPack" data-id="${p.id}">
    <span class="row-ico">${locked ? icon('lock') : packIcon(p)}</span>
    <span class="row-title">${packTitle(p)}</span>
    <span class="row-note">${note}</span>
    <span class="chev">${icon('chev')}</span>
  </button>`;
}

function tabHome() {
  const s = streak();
  const days = daysTogether();
  const seen = readSet('jt.seen');
  const yourMove = PACKS.filter((p) => !doneOf(me(), p) && (doneOf(them(), p) || countOf(them(), p) > 0));
  const fresh = PACKS.filter((p) => doneOf(me(), p) && doneOf(them(), p) && !isSeen(p, seen));
  const inProgress = PACKS.filter((p) => !doneOf(me(), p) && countOf(me(), p) > 0 && !yourMove.includes(p));
  const waiting = PACKS.filter((p) => doneOf(me(), p) && !doneOf(them(), p));

  const since = store.state.shared.since;
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const sec = (ico, title, rows) => `<section class="front-sec"><h3 class="section">${icon(ico)}<span>${title}</span></h3><div class="list">${rows}</div></section>`;
  return `<div class="front">
    <header class="masthead">
      <div class="mast-line"><span>${esc(today)}</span>${syncPill()}</div>
      <h1 class="mast-title">${esc(CONFIG.appName)}</h1>
      <div class="mast-line mast-names"><span><b class="ink-a">${N('a')}</b> &amp; <b class="ink-b">${N('b')}</b></span><span>${since ? `Est. ${esc(since.slice(0, 4))}` : 'The paper for two'}</span></div>
    </header>

    <div class="ticker">
      ${days != null ? `<div class="tick"><b>${days.toLocaleString()}</b><span>days together</span></div>` : `<button class="tick link" data-act="tab" data-tab="us"><b>${icon('calendar')}</b><span>set your date</span></button>`}
      <div class="tick ${s ? 'hot' : ''}"><b>${s}${s ? icon('flame') : ''}</b><span>day streak</span></div>
    </div>

    ${needsExport() ? `<div class="card notice">
      <b>You’ve got new answers to send ${N(them())}.</b>
      <button class="btn small" data-act="nudge" data-text="${esc('New answers on ' + CONFIG.appName + ' 💌')}">Send sync link</button>
    </div>` : ''}

    ${dailyCard(dkey())}

    ${gamesHomeHTML()}

    ${startHere()}

    ${fresh.length ? sec('star', 'New results', fresh.map((p) => packRow(p, '<span class="chip hot">see results</span>')).join('')) : ''}
    ${yourMove.length ? sec('pen', 'Your move', yourMove.map((p) => packRow(p, `<span class="chip">${N(them())} ${doneOf(them(), p) ? 'finished' : 'started'}</span>`)).join('')) : ''}
    ${inProgress.length ? sec('book', 'Keep going', inProgress.map((p) => packRow(p, `${countOf(me(), p)}/${p.items.length}`)).join('')) : ''}
    ${waiting.length ? sec('hourglass', `Waiting on ${N(them())}`, waiting.map((p) => packRow(p, '')).join('')) : ''}

    <section class="front-sec">
      <h3 class="section">${icon('die')}<span>Quick play</span></h3>
      <div class="grid2">
        <button class="tile tone-y" data-act="surprise">${icon('die')}<span>Surprise me</span></button>
        <button class="tile tone-b" data-act="go" data-view="tod">${icon('cards')}<span>Truth or Dare</span></button>
        <button class="tile tone-a" data-act="go" data-view="dates">${icon('wheel')}<span>Date spinner</span></button>
        <button class="tile tone-w" data-act="go" data-view="history">${icon('book')}<span>Past questions</span></button>
      </div>
    </section>
  </div>`;
}

// A brand-new couple gets a first stop: three easy packs and the game room.
function startHere() {
  if (PACKS.some((p) => countOf('a', p) || countOf('b', p))) return '';
  const games = GAMES.filter((g) => !g.unlisted).length;
  const pick = [['quiz-basics', 'Guess each other'], ['tot-everyday', 'Quick picks'], ['lovelang', 'Takes 3 min']].filter(([id]) => PACK[id]);
  return `<section class="front-sec start-here">
    <h3 class="section">${icon('target')}<span>Start here</span></h3>
    <p class="tiny muted">Pick one and answer on your own phone. Results show up once you’ve both finished.</p>
    <div class="list">
      ${pick.map(([id, note]) => packRow(PACK[id], note)).join('')}
      ${games ? `<button class="row c-quiz" data-act="tab" data-tab="games"><span class="row-ico">${icon('die')}</span><span class="row-title">Play a game together</span><span class="row-note">${games} games</span><span class="chev">${icon('chev')}</span></button>` : ''}
    </div>
  </section>`;
}

function packTile(p) {
  const mine = doneOf(me(), p) ? '✓' : countOf(me(), p) ? `${countOf(me(), p)}/${p.items.length}` : '';
  const theirs = doneOf(them(), p) ? '✓' : countOf(them(), p) ? '…' : '';
  const both = doneOf(me(), p) && doneOf(them(), p);
  return `<button class="ptile c-${p.cat} ${both ? 'both' : ''}" data-act="openPack" data-id="${p.id}">
    <span class="pe">${packIcon(p)}</span>
    <span class="pno">No. ${packNo(p)}</span>
    <span class="pt">${esc(p.title)}</span>
    <span class="ps">
      <span class="dot p-${me()} ${mine === '✓' ? 'on' : mine ? 'half' : ''}">${N(me())[0]}</span>
      <span class="dot p-${them()} ${theirs === '✓' ? 'on' : theirs ? 'half' : ''}">${N(them())[0]}</span>
      <span class="pc">${p.items.length} Qs</span>
    </span>
    ${both ? '<span class="pstamp">Results</span>' : ''}
  </button>`;
}

function catSection(c, i = 0) {
  const packs = PACKS.filter((p) => p.cat === c.id);
  if (!packs.length) return '';
  return `<section class="shelf c-${c.id}">
    <div class="shelf-head"><h3 class="shelf-title"><i>${pad(i + 1)}</i>${esc(c.title)}</h3><p class="shelf-note">${esc(c.blurb)}</p></div>
    <div class="pgrid">${packs.map(packTile).join('')}</div>
  </section>`;
}

function tabGames() {
  return `<div class="games-tab">${gamesHubHTML()}</div>`;
}

function tabPlay() {
  return `${topbar('Questions', { backBtn: false, right: syncPill() })}
  <div class="screen">
    <div class="grid2 feature">
      <button class="tile tone-b" data-act="go" data-view="tod">${icon('cards')}<span>Truth or Dare</span></button>
      <button class="tile tone-a" data-act="go" data-view="dates">${icon('wheel')}<span>Date spinner</span></button>
    </div>
    ${CATEGORIES.map(catSection).join('')}
  </div>`;
}

function tabSpicy() {
  if (!session.spicyOpen) {
    return `${topbar('After Dark', { backBtn: false, right: syncPill() })}
    <div class="screen center gate">
      <div class="gate-mark">${icon('keyhole')}</div>
      <h2>For your eyes only</h2>
      <p class="muted">The spicy stuff is hidden so nobody sees it over your shoulder.</p>
      <button class="btn hot big-btn" data-act="openSpicy">Open it up</button>
    </div>`;
  }
  return `${topbar('After Dark', { backBtn: false, right: `<button class="pill" data-act="closeSpicy">${icon('eyeOff')}Hide</button>` })}
  <div class="screen">
    <div class="grid2 feature">
      <button class="tile hot" data-act="spicyTod">${icon('cards')}<span>Spicy Truth or Dare</span></button>
      <button class="tile hot" data-act="spicyDate">${icon('candle')}<span>Spicy date night</span></button>
    </div>
    ${SPICY_CATEGORIES.map(catSection).join('')}
  </div>`;
}

function tabUs() {
  const ll = PACK.lovelang;
  const llBoth = doneOf('a', ll) && doneOf('b', ll);
  const bucket = Object.entries(store.state.shared.bucket || {})
    .filter(([, v]) => v && !v.del)
    .sort(([, x], [, y]) => (x.done - y.done) || (y.ts - x.ts));

  // who knows who better
  let mineRight = 0; let theirsRight = 0; let total = 0;
  for (const p of PACKS.filter((x) => x.type === 'quiz')) {
    if (!doneOf('a', p) || !doneOf('b', p)) continue;
    const a = ansOf(me(), p); const b = ansOf(them(), p);
    p.items.forEach((_, i) => {
      total++;
      if (a['i' + i]?.g === b['i' + i]?.m) mineRight++;
      if (b['i' + i]?.g === a['i' + i]?.m) theirsRight++;
    });
  }

  return `${topbar('Us', { backBtn: false, right: syncPill() })}
  <div class="screen">
    <div class="card">
      <h2>${icon('calendar')}Our date</h2>
      <p class="muted tiny">When did you two start? Powers the days-together counter.</p>
      <input class="input" type="date" data-act-change="since" value="${esc(store.state.shared.since || '')}" max="${dkey()}" />
    </div>

    <div class="card">
      <h2>${icon('list')}Bucket list</h2>
      <div class="add-row">
        <input class="input" data-draft="bucket" placeholder="Something to do together…" maxlength="140" />
        <button class="btn small" data-act="addBucket">Add</button>
      </div>
      ${bucket.length ? `<ul class="bucket">${bucket.map(([id, v]) => `<li class="${v.done ? 'done' : ''}">
          <button class="check" data-act="toggleBucket" data-id="${id}" aria-label="${v.done ? 'Done' : 'Not done yet'}">${v.done ? icon('check') : ''}</button>
          <span class="bt">${esc(v.t)}<small class="p-${v.by}">${N(v.by)}</small></span>
          <button class="x" data-act="delBucket" data-id="${id}" aria-label="Remove">${icon('close')}</button>
        </li>`).join('')}</ul>` : '<p class="muted tiny">Empty for now. The date spinner can add ideas here too.</p>'}
    </div>

    <div class="card">
      <h2>${icon('us')}Love languages</h2>
      ${llBoth ? ['a', 'b'].map((w) => { const top = loveScores(w)[0]; return `<p class="ll-line p-${w}"><b>${N(w)}</b><span>${LOVE_LANGS[top[0]].name}</span></p>`; }).join('') + `<button class="btn ghost small" data-act="openPack" data-id="lovelang">Full results</button>`
        : `<p class="muted tiny">${doneOf(me(), ll) ? `Waiting on ${N(them())} to take it.` : 'Take the quiz to find out how you each feel most loved.'}</p><button class="btn small" data-act="openPack" data-id="lovelang">${doneOf(me(), ll) ? 'See mine' : 'Take the quiz'}</button>`}
    </div>

    ${total ? `<div class="card">
      <h2>${icon('ribbon')}Who knows who better</h2>
      <div class="score-duo">
        <div class="p-${me()}"><b>${Math.round((mineRight / total) * 100)}%</b><span>${N(me())} knows ${N(them())}</span></div>
        <div class="p-${them()}"><b>${Math.round((theirsRight / total) * 100)}%</b><span>${N(them())} knows ${N(me())}</span></div>
      </div>
      <p class="tiny muted">Across ${total} quiz questions you’ve both answered.</p>
    </div>` : ''}

    <div class="list">
      <button class="row" data-act="go" data-view="history"><span class="row-ico">${icon('book')}</span><span class="row-title">Past daily questions</span><span class="chev">${icon('chev')}</span></button>
      <button class="row" data-act="go" data-view="sync"><span class="row-ico">${icon('sync')}</span><span class="row-title">Sync & pairing</span><span class="chev">${icon('chev')}</span></button>
      <button class="row" data-act="switchMe"><span class="row-ico">${icon('swap')}</span><span class="row-title">I’m actually ${N(them())}</span><span class="chev">${icon('chev')}</span></button>
    </div>
    <p class="colophon">${logoMark('small')}<span>Made just for ${N('a')} &amp; ${N('b')}</span></p>
  </div>`;
}

// ── packs ─────────────────────────────────────────────────────────────
function packBlurb(p) { return p.blurb || CAT[p.cat]?.blurb || ''; }

function viewPack() {
  const p = PACK[ui.packId];
  if (!p) return topbar('Not found') + '<div class="screen">That one’s gone.</div>';
  const step = ui.step || (doneOf(me(), p) ? 'results' : 'intro');
  if (step === 'play') return viewPlay(p);
  if (step === 'results') return viewResults(p);
  const mineN = countOf(me(), p); const theirsN = countOf(them(), p);
  const status = (who, n) => (doneOf(who, p) ? `<span class="chip ok">${icon('check')}done</span>` : n ? `<span class="chip">${n}/${p.items.length}</span>` : '<span class="chip dim">not started</span>');
  return `${topbar('')}
  <div class="screen center pack-intro c-${p.cat}">
    <div class="pack-cover">${packIcon(p)}<span class="pack-no">No. ${packNo(p)}</span><span class="pack-cat">${esc(CAT[p.cat]?.title || '')}</span></div>
    <h1 class="big">${esc(p.title)}</h1>
    <p class="muted">${esc(packBlurb(p))}</p>
    <div class="status-row">
      <div class="p-${me()}"><i class="who-dot"></i>${N(me())} ${status(me(), mineN)}</div>
      <div class="p-${them()}"><i class="who-dot"></i>${N(them())} ${status(them(), theirsN)}</div>
    </div>
    <button class="btn big-btn ${p.spicy ? 'hot' : ''}" data-act="startPack">${mineN ? 'Keep going' : 'Start'} · ${p.items.length} questions</button>
  </div>`;
}

function viewPlay(p) {
  const idx = ui.idx ?? 0;
  const total = p.items.length;
  const item = p.items[idx];
  const existing = ansOf(me(), p)['i' + idx];
  if (!session.temp || session.temp.idx !== idx || session.temp.pack !== p.id) {
    session.temp = { idx, pack: p.id, ...(p.type === 'quiz' && existing ? existing : {}) };
  }
  const progress = `<div class="progress"><i style="width:${(idx / total) * 100}%"></i></div>`;
  const head = `<header class="topbar is-play">
    <button class="icon-btn" data-act="exitPlay" aria-label="Close">${icon('close')}</button>
    <h1>${esc(p.title)}</h1>
    <div class="topbar-right"><span class="count">${idx + 1}/${total}</span></div>
  </header>${progress}`;
  const sel = (v) => (existing === v ? 'sel' : '');
  let body = '';

  switch (p.type) {
    case 'quiz': {
      const t = session.temp;
      const opts = (k) => item.o.map((o, i) => `<button class="opt ${t[k] === i ? 'sel' : ''}" data-act="quizPick" data-k="${k}" data-v="${i}">${esc(o)}</button>`).join('');
      body = `<h2 class="q">${esc(item.q)}</h2>
        <div class="label">Your answer</div><div class="opts p-${me()}">${opts('m')}</div>
        <div class="label">What will ${N(them())} say?</div><div class="opts guess p-${them()}">${opts('g')}</div>`;
      break;
    }
    case 'pick':
      body = `<div class="vs p-${me()}">
        <button class="choice ${sel(0)}" data-act="answer" data-v="0">${esc(item[0])}</button>
        <div class="or">or</div>
        <button class="choice ${sel(1)}" data-act="answer" data-v="1">${esc(item[1])}</button>
      </div>`;
      break;
    case 'who':
      body = `<div class="eyebrow center-text">Who’s more likely to…</div><h2 class="q center-text">${esc(item)}</h2>
      <div class="vs two">
        <button class="choice p-${me()} ${sel(me())}" data-act="answer" data-v="${me()}">${N(me())}<small>(me)</small></button>
        <button class="choice p-${them()} ${sel(them())}" data-act="answer" data-v="${them()}">${N(them())}</button>
      </div>`;
      break;
    case 'nhie':
      body = `<div class="eyebrow center-text">Never have I ever…</div><h2 class="q center-text">${esc(item)}</h2>
      <div class="vs two p-${me()}">
        <button class="choice ${sel(1)}" data-act="answer" data-v="1">${icon('hand')}I have</button>
        <button class="choice ${sel(0)}" data-act="answer" data-v="0">${icon('close')}Never</button>
      </div>`;
      break;
    case 'open':
      body = `<h2 class="q">${esc(item)}</h2>
        <textarea class="input" rows="5" data-draft="open-${p.id}-${idx}" placeholder="Write as much as you want…">${existing && existing !== SKIPPED ? esc(existing) : ''}</textarea>
        <button class="btn ${p.spicy ? 'hot' : ''}" data-act="saveOpen">Save & next</button>
        <button class="btn ghost small" data-act="skipOpen">Skip this one</button>`;
      break;
    case 'ynm':
      body = `<div class="eyebrow center-text">Would you be into…</div><h2 class="q center-text">${esc(item)}</h2>
      <div class="ynm">
        <button class="choice y ${sel(2)}" data-act="answer" data-v="2">Yes</button>
        <button class="choice m ${sel(1)}" data-act="answer" data-v="1">Maybe</button>
        <button class="choice n ${sel(0)}" data-act="answer" data-v="0">No</button>
      </div>
      <p class="tiny muted center-text">${N(them())} only sees this if you both say yes or maybe.</p>`;
      break;
    case 'lovelang':
      body = `<div class="eyebrow center-text">Which would mean more to you?</div>
      <div class="vs p-${me()}">
        <button class="choice ${sel(0)}" data-act="answer" data-v="0">${esc(item[0][0])}</button>
        <div class="or">or</div>
        <button class="choice ${sel(1)}" data-act="answer" data-v="1">${esc(item[1][0])}</button>
      </div>`;
      break;
    default: body = 'Unknown pack type';
  }

  return `${head}<div class="screen play">
    <div class="card qcard">${body}</div>
    <div class="nav-row">
      ${idx > 0 ? `<button class="btn ghost small" data-act="prevQ">${icon('prev')}Back</button>` : '<span></span>'}
      ${existing !== undefined && idx < total - 1 ? `<button class="btn ghost small" data-act="nextQ">Next${icon('next')}</button>` : ''}
    </div>
  </div>`;
}

function saveAnswer(p, idx, value) {
  store.setMine(['packs', p.id, 'ans', 'i' + idx], value);
  session.temp = null;
  session.lockUntil = performance.now() + 350;
  const ans = ansOf(me(), p);
  let next = p.items.findIndex((_, i) => i > idx && !has(ans, i));
  if (next < 0) next = p.items.findIndex((_, i) => !has(ans, i));
  if (next < 0) {
    if (!doneOf(me(), p)) store.setMine(['packs', p.id, 'done'], Date.now());
    update({ step: 'results' });
  } else {
    update({ idx: next }, false);
    window.scrollTo(0, 0);
  }
}

// ── results ───────────────────────────────────────────────────────────
function loveScores(who) {
  const p = PACK.lovelang; const a = ansOf(who, p);
  const s = { W: 0, Q: 0, G: 0, A: 0, T: 0 };
  p.items.forEach((it, i) => { if (has(a, i)) s[it[a['i' + i]][1]]++; });
  return Object.entries(s).sort((x, y) => y[1] - x[1]);
}

function viewResults(p) {
  const both = doneOf(me(), p) && doneOf(them(), p);
  if (both) { const s = readSet('jt.seen'); if (!s.has(seenKey(p))) { s.add(seenKey(p)); s.delete(p.id); saveSet('jt.seen', s); } }
  const a = ansOf(me(), p); const b = ansOf(them(), p);
  const head = topbar(esc(p.title));
  const footer = `<div class="footer-actions">
      ${!both ? `<button class="btn" data-act="nudge" data-text="${esc(`I finished "${p.title}" on ${CONFIG.appName}. Your turn 😘`)}">Nudge ${N(them())}</button>` : ''}
      <button class="btn ghost small" data-act="redoPack">Redo my answers</button>
    </div>`;

  if (!both && p.type !== 'lovelang') {
    const preview = p.type === 'ynm' ? '<p class="muted">Your answers are locked in and private.</p>' : '';
    return `${head}<div class="screen center pack-intro c-${p.cat}">
      <div class="pack-cover is-wait">${icon('hourglass')}<span class="pack-no">No. ${packNo(p)}</span><span class="pack-cat">${esc(CAT[p.cat]?.title || '')}</span></div>
      <h2 class="big">Locked in!</h2>
      <p class="muted">Results unlock as soon as ${N(them())} finishes${countOf(them(), p) ? ` (they’re ${countOf(them(), p)}/${p.items.length} in)` : ''}.</p>
      ${preview}
      ${footer}
    </div>`;
  }

  let body = '';
  switch (p.type) {
    case 'quiz': {
      let mine = 0; let theirs = 0;
      const rows = p.items.map((it, i) => {
        const am = a['i' + i] || {}; const bm = b['i' + i] || {};
        const iGotIt = am.g === bm.m; const theyGotIt = bm.g === am.m;
        if (iGotIt) mine++; if (theyGotIt) theirs++;
        return `<div class="rcard">
          <div class="rq">${esc(it.q)}</div>
          <div class="rline"><b>${N(me())}:</b> ${esc(it.o[am.m])} <span class="mark ${theyGotIt ? 'ok' : 'no'}">${N(them())} guessed ${theyGotIt ? '✓' : `“${esc(it.o[bm.g])}” ✗`}</span></div>
          <div class="rline"><b>${N(them())}:</b> ${esc(it.o[bm.m])} <span class="mark ${iGotIt ? 'ok' : 'no'}">you guessed ${iGotIt ? '✓' : `“${esc(it.o[am.g])}” ✗`}</span></div>
        </div>`;
      }).join('');
      const n = p.items.length;
      const verdict = (x) => (x === n ? 'Perfect. Mind reader.' : x >= n * 0.7 ? 'You really know them.' : x >= n * 0.4 ? 'Not bad, keep studying.' : 'Uh oh. Date night needed.');
      body = `<div class="score-duo large">
          <div class="p-${me()}"><b>${mine}/${n}</b><span>${N(me())} knows ${N(them())}</span><small>${verdict(mine)}</small></div>
          <div class="p-${them()}"><b>${theirs}/${n}</b><span>${N(them())} knows ${N(me())}</span><small>${verdict(theirs)}</small></div>
        </div>${rows}`;
      break;
    }
    case 'pick': {
      let m = 0;
      const rows = p.items.map((it, i) => {
        const x = a['i' + i]; const y = b['i' + i]; const same = x === y; if (same) m++;
        const side = (k) => `<div class="side ${x === k || y === k ? 'picked' : ''}">${esc(it[k])}
          <span class="avs">${x === k ? `<i class="av me p-${me()}">${N(me())[0]}</i>` : ''}${y === k ? `<i class="av them p-${them()}">${N(them())[0]}</i>` : ''}</span></div>`;
        return `<div class="rcard pickrow ${same ? 'match' : ''}">${side(0)}${side(1)}</div>`;
      }).join('');
      const pct = Math.round((m / p.items.length) * 100);
      body = `<div class="score-big"><b>${pct}%</b><span>in sync · ${m}/${p.items.length} matches</span><small>${pct >= 80 ? 'Basically the same person.' : pct >= 55 ? 'Pretty in sync!' : pct >= 35 ? 'Opposites attract?' : 'Chaos couple.'}</small></div>${rows}`;
      break;
    }
    case 'who': {
      let agree = 0; const votes = { a: 0, b: 0 };
      const rows = p.items.map((it, i) => {
        const x = a['i' + i]; const y = b['i' + i]; if (x === y) agree++;
        votes[x]++; votes[y]++;
        return `<div class="rcard ${x === y ? 'match' : ''}"><div class="rq">${esc(it)}</div>
          <div class="rline">${x === y ? `Both said <b class="ink-${x}">${N(x)}</b>` : `${N(me())} said <b class="ink-${x}">${N(x)}</b> · ${N(them())} said <b class="ink-${y}">${N(y)}</b>`}</div></div>`;
      }).join('');
      body = `<div class="score-duo"><div class="p-${me()}"><b>${votes[me()]}</b><span>votes for ${N(me())}</span></div><div class="p-${them()}"><b>${votes[them()]}</b><span>votes for ${N(them())}</span></div></div>
        <p class="center-text muted">You agreed on ${agree}/${p.items.length}.</p>${rows}`;
      break;
    }
    case 'nhie': {
      const lbl = (v) => (v ? '<b class="nh-have">have</b>' : '<b class="nh-never">never</b>');
      const rows = p.items.map((it, i) => {
        const x = a['i' + i]; const y = b['i' + i];
        const tag = x && y ? '<span class="chip hot">both!</span>' : x || y ? '<span class="chip">one of you</span>' : '';
        return `<div class="rcard"><div class="rq">${esc(it)} ${tag}</div>
          <div class="rline">${N(me())}: ${lbl(x)} · ${N(them())}: ${lbl(y)}</div></div>`;
      }).join('');
      const both2 = p.items.filter((_, i) => a['i' + i] && b['i' + i]).length;
      body = `<p class="center-text muted">You’ve both done ${both2} of these. Story time for the “one of you” ones.</p>${rows}`;
      break;
    }
    case 'open': {
      body = p.items.map((it, i) => `<div class="rcard"><div class="rq">${esc(it)}</div>${bubble(me(), a['i' + i])}${bubble(them(), b['i' + i])}</div>`).join('');
      break;
    }
    case 'ynm': {
      const mutual = p.items.map((it, i) => ({ it, x: a['i' + i], y: b['i' + i] })).filter((r) => r.x > 0 && r.y > 0);
      const bothYes = mutual.filter((r) => r.x === 2 && r.y === 2);
      const someMaybe = mutual.filter((r) => !(r.x === 2 && r.y === 2));
      body = `<div class="score-big"><b>${mutual.length}</b><span>things you’re both into</span><small>Everything else stays private. Forever.</small></div>
        ${bothYes.length ? `<h3 class="section">${icon('flame')}<span>Both said yes</span></h3><div class="tags">${bothYes.map((r) => `<span class="tag hot">${esc(r.it)}</span>`).join('')}</div>` : ''}
        ${someMaybe.length ? `<h3 class="section">${icon('talk')}<span>Worth talking about</span></h3><p class="tiny muted">At least one maybe, nobody said no.</p><div class="tags">${someMaybe.map((r) => `<span class="tag">${esc(r.it)}</span>`).join('')}</div>` : ''}
        ${!mutual.length ? '<p class="muted center-text">No overlap on this one — and that’s fine. Try the other list?</p>' : ''}`;
      break;
    }
    case 'lovelang': {
      const prof = (who) => {
        if (!doneOf(who, p)) return `<div class="card"><h2>${N(who)}</h2><p class="muted">Hasn’t taken it yet.</p></div>`;
        const sc = loveScores(who); const top = LOVE_LANGS[sc[0][0]];
        return `<div class="card ll p-${who}"><p class="ll-who">${N(who)}</p><h2>${top.name}</h2>
          ${sc.map(([k, v]) => `<div class="bar"><span>${LOVE_LANGS[k].name}</span><i style="width:${(v / 6) * 100}%"></i><b>${v}</b></div>`).join('')}
          ${who === them() ? `<p class="tip"><b>Tip</b>To love ${N(them())} well: ${esc(top.tip)}</p>` : ''}
        </div>`;
      };
      body = prof(me()) + prof(them());
      break;
    }
    default: body = '';
  }
  return `${head}<div class="screen results">${body}${footer}</div>`;
}

// ── truth or dare ─────────────────────────────────────────────────────
function viewTod() {
  const t = session.tod;
  if (!t.turn) t.turn = me();
  const levels = TOD_LEVELS.map((l) => `<button class="chip-btn ${t.level === l.id ? 'on' : ''}" data-act="todLevel" data-level="${l.id}">${l.spicy ? icon('flame') : ''}${l.label}</button>`).join('');
  return `${topbar('Truth or Dare')}
  <div class="screen center">
    <div class="chips">${levels}</div>
    <p class="turn p-${t.turn}"><i class="who-dot"></i>${N(t.turn)}’s turn</p>
    ${t.card ? `<div class="card todcard ${t.kind}">
        <div class="eyebrow">${t.kind === 'truth' ? 'Truth' : 'Dare'}</div>
        <h2>${esc(t.card)}</h2>
      </div>
      <div class="stack">
        <button class="btn ${t.level === 'spicy' ? 'hot' : ''}" data-act="todDone">Done ${icon('next')} ${N(t.turn === 'a' ? 'b' : 'a')}’s turn</button>
        <button class="btn ghost small" data-act="todDraw" data-kind="${t.kind}">Draw another ${t.kind}</button>
      </div>`
    : `<div class="vs two">
        <button class="choice big tcard truth" data-act="todDraw" data-kind="truth"><span>Truth</span></button>
        <button class="choice big tcard dare" data-act="todDraw" data-kind="dare"><span>Dare</span></button>
      </div>`}
    <p class="tiny muted">Play this one together, in person. Pass the phone or just read it out.</p>
  </div>`;
}

function todDraw(kind) {
  const t = session.tod;
  const key = `${t.level}-${kind}`;
  if (!t.decks[key] || !t.decks[key].length) t.decks[key] = shuffle((kind === 'truth' ? TRUTHS : DARES)[t.level]);
  t.kind = kind;
  t.card = t.decks[key].pop();
  render();
}

// ── date spinner ──────────────────────────────────────────────────────
function viewDates() {
  const d = session.date;
  const cats = DATE_CATS.filter((c) => !c.spicy || session.spicyOpen)
    .map((c) => `<button class="chip-btn ${d.cat === c.id ? 'on' : ''}" data-act="dateCat" data-cat="${c.id}">${c.spicy ? icon('flame') : ''}${c.label}</button>`).join('');
  return `${topbar('Date spinner')}
  <div class="screen center">
    <div class="chips">${cats}</div>
    <div class="card spin ${d.spinning ? 'spinning' : ''} ${d.pick ? 'has-pick' : ''}">
      <p class="spin-label">${icon('wheel')}Date idea</p>
      <h2>${d.pick ? esc(d.pick) : 'Tap spin for a date idea'}</h2>
    </div>
    <div class="stack">
      <button class="btn big-btn ${d.cat === 'spicy' ? 'hot' : ''}" data-act="spin" ${d.spinning ? 'disabled' : ''}>${icon('wheel')}${d.pick ? 'Spin again' : 'Spin'}</button>
      ${d.pick && !d.spinning ? `<button class="btn ghost small" data-act="dateToBucket">${icon('plus')}Add to our bucket list</button>` : ''}
    </div>
  </div>`;
}

function spin() {
  const d = session.date;
  const pool = DATES[d.cat];
  d.spinning = true;
  let n = 0;
  const tick = () => {
    let next; do { next = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && next === d.pick);
    d.pick = next;
    n++;
    if (n >= 14) { d.spinning = false; render(); return; }
    render();
    setTimeout(tick, 40 + n * n * 1.6);
  };
  tick();
}

function addBucket(text) {
  const t = text.trim();
  if (!t) return false;
  store.setShared(['bucket', randomId(10)], { t: t.slice(0, 140), done: false, by: me(), ts: Date.now() });
  return true;
}

// ── daily history ─────────────────────────────────────────────────────
function viewHistory() {
  const keys = new Set([...Object.keys(store.person('a').daily || {}), ...Object.keys(store.person('b').daily || {})]);
  keys.add(dkey());
  const sorted = [...keys].sort().reverse();
  // also offer yesterday if missed
  const y = addDays(dkey(), -1);
  if (!keys.has(y)) sorted.splice(1, 0, y);
  return `${topbar('Past questions')}
  <div class="screen">
    ${sorted.map((k) => dailyCard(k, { compact: true })).join('')}
  </div>`;
}

// ── sync ──────────────────────────────────────────────────────────────
function viewSync() {
  if (store.mode === 'artifact') {
    return `${topbar('Sync')}
    <div class="screen">
      <div class="card">
        <h2>${store.readOnly ? `<i class="pill-dot warn"></i>This device can’t save yet` : store.online ? '<i class="pill-dot ok"></i>Sync is on' : '<i class="pill-dot"></i>Reconnecting…'}</h2>
        ${store.readOnly
    ? `<p class="muted">Your answers aren’t saving. ${N('a')} needs to share this artifact with you as an <b>Editor</b> (Share → invite by email → Editor). A public link won’t work.</p>`
    : `<p class="muted">Everything saves automatically and shows up for both of you right away, on any device where you’re signed in to Claude.</p>`}
        ${store.full ? '<p class="muted">The shared storage is full. Remove some bucket list items to free space.</p>' : ''}
      </div>
      ${store.owner === false ? `<div class="card">
        <h2>Shared with you</h2>
        <p class="muted tiny">${N(them())} shared Just Us with you. As an <b>Editor</b>, everything you play saves for both of you. If saving ever stops, ask ${N(them())} to check you’re still an Editor.</p>
      </div>` : `<div class="card">
        <h2>Adding ${N(them())}</h2>
        <p class="muted tiny">In Claude, open this artifact, tap Share, and invite ${N(them())}’s email with <b>Editor</b> access. Leave the public link off: with it on, guests can’t save.</p>
      </div>`}
    </div>`;
  }
  if (store.cloudAvailable) {
    return `${topbar('Sync')}
    <div class="screen">
      <div class="card">
        <h2>${store.mode === 'cloud' ? (store.online ? '<i class="pill-dot ok"></i>Live sync is on' : '<i class="pill-dot"></i>Offline right now') : 'Live sync available'}</h2>
        <p class="muted">${store.room ? `Your phones share a private space. Answers show up on both phones instantly.` : 'Not paired yet.'}</p>
        ${store.room ? `<button class="btn" data-act="sharePair">Share pairing link with ${N(them())}</button>` : '<button class="btn" data-act="go" data-view="connect">Pair phones</button>'}
      </div>
      <div class="card">
        <h2>Join a different space</h2>
        <input class="input" data-draft="pair" placeholder="Paste pairing link…" />
        <button class="btn alt small" data-act="joinRoom">Join</button>
      </div>
    </div>`;
  }
  return `${topbar('Sync')}
  <div class="screen">
    <div class="card">
      <h2>Send ${N(them())} your answers</h2>
      <p class="muted">Tap below and text the link to ${N(them())}. When they open it, your answers load on their phone. They do the same for you.</p>
      <button class="btn" data-act="nudge" data-text="${esc('My latest answers on ' + CONFIG.appName + ' 💌')}">Send my sync link</button>
    </div>
    <div class="card">
      <h2>Got a link from ${N(them())}?</h2>
      <p class="muted tiny">Opening the link usually does it. If you added the app to your home screen, the link may open in the browser instead — copy it and paste it here.</p>
      <textarea class="input" rows="2" data-draft="synclink" placeholder="Paste sync link…"></textarea>
      <button class="btn alt small" data-act="importPaste">Load answers</button>
    </div>
    <p class="tiny muted">Want it to sync by itself? Add a free Firebase database. The README explains how (about 5 minutes, one time).</p>
  </div>`;
}

function parseRoom(text) {
  const m = String(text).match(/pair=([a-z0-9]{8,40})/i);
  if (m) return m[1];
  const t = String(text).trim();
  return /^[a-z0-9]{8,40}$/i.test(t) ? t : null;
}

// ── actions ───────────────────────────────────────────────────────────
const actions = {
  back,
  go: (d) => go({ view: d.view }),
  tab: (d) => { ui = { view: 'tab', tab: d.tab }; hist('replaceState', ui, ''); render(true); },
  pickMe: async (d) => {
    if (d.taken && !(await ask(`${store.name(d.who)} already plays from another Claude account. Is this ${store.name(d.who)} on a second account?`, `Yes, I’m ${store.name(d.who)}`))) return;
    store.me = d.who;
    ensureGames();
    store.claim(d.who);
    if (session.pendingSync) { await doImport(session.pendingSync); session.pendingSync = null; }
    if (store.cloudAvailable && !store.room) go({ view: 'connect' }); else render(true);
  },
  switchMe: async () => {
    const to = them();
    const msg = takenBy(to)
      ? `${store.name(to)} plays from another Claude account. Switch this device to ${store.name(to)} anyway?`
      : `Switch this device to ${store.name(to)}?`;
    if (!(await ask(msg, 'Switch'))) return;
    store.release(me());
    store.me = to;
    store.claim(to);
    gamesIdentityChanged();
    render(true);
  },
  createRoom: async () => { store.room = randomId(20); await store.connect(); render(); },
  joinRoom: async () => {
    const room = parseRoom(session.drafts.pair || '');
    if (!room) return toast('That doesn’t look like a pairing link.');
    store.room = room; session.drafts.pair = '';
    if (store.mode === 'cloud') { location.reload(); return; }
    await store.connect(); toast('Paired!'); go({ view: 'tab', tab: 'home' });
  },
  sharePair: () => share(`Join me on ${CONFIG.appName} 💞`, `${appUrl()}#pair=${store.room}`),
  nudge: (d) => nudge(d.text),
  importPaste: async () => {
    const m = String(session.drafts.synclink || '').match(/sync=([A-Za-z0-9_-]+)/);
    if (!m) return toast('Couldn’t find a sync code in that.');
    session.drafts.synclink = '';
    await doImport(m[1]);
  },
  saveDaily: (d, el) => {
    // Read the field itself: on iOS the last autocorrected word can land after the input event.
    const box = el.closest('.daily')?.querySelector(`[data-draft="daily-${d.key}"]`);
    const v = ((box ? box.value : session.drafts['daily-' + d.key]) || '').trim();
    if (!v) return toast('Write something first.');
    store.setMine(['daily', d.key], v.slice(0, 2000));
    delete session.drafts['daily-' + d.key];
    const theirs = store.person(them()).daily?.[d.key];
    toast(theirs ? 'Unlocked!' : `Locked in. Waiting on ${store.name(them())}.`);
  },
  openPack: (d) => go({ view: 'pack', packId: d.id }),
  startPack: () => {
    const p = PACK[ui.packId]; const a = ansOf(me(), p);
    const first = p.items.findIndex((_, i) => !has(a, i));
    update({ step: 'play', idx: first < 0 ? 0 : first });
  },
  exitPlay: () => update({ step: 'intro' }),
  prevQ: () => { session.temp = null; update({ idx: Math.max(0, ui.idx - 1) }); },
  nextQ: () => { session.temp = null; update({ idx: Math.min(PACK[ui.packId].items.length - 1, ui.idx + 1) }); },
  answer: (d, el) => {
    const p = PACK[ui.packId];
    if (!p || tapLocked()) return;
    const idx = ui.idx ?? 0;
    const v = p.type === 'who' ? d.v : Number(d.v);
    el.parentElement.querySelectorAll('.choice').forEach((b) => b.classList.remove('sel'));
    el.classList.add('sel');
    // One save per question: a second tap in this beat changes the pick instead of answering the next one.
    clearTimeout(session.answerT);
    session.answerT = setTimeout(() => { if (onQuestion(p, idx)) saveAnswer(p, idx, v); }, 160);
  },
  quizPick: (d) => {
    const p = PACK[ui.packId];
    if (!p || tapLocked() || !session.temp) return;
    const idx = ui.idx ?? 0;
    const t = session.temp;
    t[d.k] = Number(d.v);
    render();
    clearTimeout(session.answerT);
    if (t.m !== undefined && t.g !== undefined) {
      session.answerT = setTimeout(() => { if (onQuestion(p, idx) && session.temp === t) saveAnswer(p, idx, { m: t.m, g: t.g }); }, 260);
    }
  },
  saveOpen: () => {
    if (tapLocked()) return;
    const p = PACK[ui.packId]; const k = `open-${p.id}-${ui.idx}`;
    const el = $app.querySelector(`[data-draft="${k}"]`);
    const v = (el ? el.value : session.drafts[k] || '').trim();
    if (!v) return toast('Write something, or tap skip.');
    delete session.drafts[k];
    if (el) el.blur();
    saveAnswer(p, ui.idx, v.slice(0, 4000));
  },
  skipOpen: () => { if (tapLocked()) return; const p = PACK[ui.packId]; delete session.drafts[`open-${p.id}-${ui.idx}`]; saveAnswer(p, ui.idx, SKIPPED); },
  redoPack: async () => {
    if (!(await ask('Clear your answers for this one and redo it?', 'Redo'))) return;
    store.setMine(['packs', ui.packId], null);
    const s = readSet('jt.seen'); s.delete(ui.packId); saveSet('jt.seen', s);
    update({ step: 'play', idx: 0 });
  },
  surprise: () => {
    const pool = PACKS.filter((p) => !p.spicy && !doneOf(me(), p));
    if (!pool.length) return toast('You’ve done them all! Try the spicy tab.');
    go({ view: 'pack', packId: pool[Math.floor(Math.random() * pool.length)].id });
  },
  openSpicy: () => { session.spicyOpen = true; render(true); },
  closeSpicy: () => { session.spicyOpen = false; render(true); },
  spicyTod: () => { session.tod.level = 'spicy'; session.tod.card = null; go({ view: 'tod' }); },
  spicyDate: () => { session.date = { cat: 'spicy', pick: null, spinning: false }; go({ view: 'dates' }); },
  todLevel: (d) => { session.tod.level = d.level; session.tod.card = null; render(); },
  todDraw: (d) => todDraw(d.kind),
  todDone: () => { const t = session.tod; t.turn = t.turn === 'a' ? 'b' : 'a'; t.card = null; t.kind = null; render(); },
  dateCat: (d) => { session.date.cat = d.cat; session.date.pick = null; render(); },
  spin,
  dateToBucket: () => { if (addBucket(session.date.pick)) toast('Added to the bucket list'); },
  addBucket: () => {
    const el = $app.querySelector('[data-draft="bucket"]');
    if (addBucket(el ? el.value : '')) { session.drafts.bucket = ''; if (el) { el.value = ''; el.blur(); } render(); }
  },
  toggleBucket: (d) => { const v = store.state.shared.bucket[d.id]; store.setShared(['bucket', d.id], { ...v, done: !v.done, ts: Date.now() }); },
  delBucket: async (d) => { const v = store.state.shared.bucket[d.id]; if (await ask(`Remove "${v.t}"?`, 'Remove')) store.setShared(['bucket', d.id], { ...v, del: true, ts: Date.now() }); },
};

async function doImport(code) {
  const r = await store.importCode(code);
  if (r.ok) toast(`Loaded ${store.name(r.who)}’s answers`);
  else toast(r.msg);
  render(true);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !$app.contains(el)) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  const a = document.activeElement;
  if (a && a !== el && /^(TEXTAREA|INPUT)$/.test(a.tagName) && !el.matches('input,textarea')) a.blur();
  fn(el.dataset, el);
});
document.addEventListener('input', (e) => {
  const k = e.target.dataset && e.target.dataset.draft;
  if (k) session.drafts[k] = e.target.value;
});
document.addEventListener('change', (e) => {
  if (e.target.dataset && e.target.dataset.actChange === 'since') {
    const v = e.target.value || null;
    if (v && v > dkey()) { toast('That’s in the future. Pick the day you started.'); e.target.value = store.state.shared.since || ''; return; }
    store.setShared(['since'], v);
  }
});
document.addEventListener('focusout', () => { setTimeout(() => { if (session.pendingRender) render(); }, 0); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset?.draft === 'bucket') { e.preventDefault(); actions.addBucket(); }
});

// ── boot ──────────────────────────────────────────────────────────────
// Handles #pair=… and #sync=… links, then connects live sync if it can.
async function handleHash() {
  const hash = location.hash.slice(1);
  const params = new URLSearchParams(hash);
  if (hash) history.replaceState(ui, '', location.pathname + location.search);
  const pair = params.get('pair') && parseRoom('pair=' + params.get('pair'));
  if (pair && pair !== store.room) {
    store.room = pair;
    if (store.mode === 'cloud') { location.reload(); return; }
  }
  if (params.get('sync')) {
    if (me()) await doImport(params.get('sync'));
    else session.pendingSync = params.get('sync');
  }
  if (store.cloudAvailable && store.room && store.mode !== 'cloud') {
    await store.connect();
    if (pair) toast('Paired!');
    render();
  }
}

async function bootArtifact() {
  hist('replaceState', ui, '');
  store.onChange(() => render());
  render(true);
  const ok = await store.connectArtifact();
  if (ok) await store.ready;
  session.ready = true;
  // Recognize this person on a new device (unless one account has picked both).
  if (!me() && store.uid) {
    const ws = ['a', 'b'].filter((x) => store.uidsOf(x).has(store.uid));
    if (ws.length === 1) store.me = ws[0];
  }
  if (me()) store.claim(me());
  if (!ok) toast('Sync isn’t available here. Answers stay on this device.');
  ensureGames();
  render(true);
}

async function boot() {
  document.title = CONFIG.appName;
  if (ARTIFACT) return bootArtifact();
  history.replaceState(ui, '');
  store.onChange(() => render());
  ensureGames();
  render(true);
  await handleHash();
  window.addEventListener('hashchange', handleHash);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
