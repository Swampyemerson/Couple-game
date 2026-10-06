import { CONFIG } from './config.js';
import {
  PACKS, CATEGORIES, SPICY_CATEGORIES, DAILY, TRUTHS, DARES, TOD_LEVELS, DATES, DATE_CATS, LOVE_LANGS,
} from './content.js';
import { Store, randomId } from './store.js';
import { initGames, gamesHubHTML, gamesHomeHTML, gamesWaitingCount } from './games/core.js';
import './games/index.js';

const store = new Store(CONFIG);
const $app = document.getElementById('app');
const PACK = Object.fromEntries(PACKS.map((p) => [p.id, p]));
const ARTIFACT = !!globalThis.JUST_US_ARTIFACT;

// History can be unavailable inside sandboxed frames.
const hist = (fn, ...args) => { try { history[fn](...args); return true; } catch { return false; } };
const CAT = Object.fromEntries([...CATEGORIES, ...SPICY_CATEGORIES].map((c) => [c.id, c]));
const SKIPPED = '—';

let ui = { view: 'tab', tab: 'home' };
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
const packTitle = (p) => (p.spicy && !session.spicyOpen ? '🔒 Something spicy' : `${p.emoji} ${esc(p.title)}`);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

// confirm() is blocked inside artifacts, so ask in-page.
function ask(msg, okLabel = 'Yes') {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><p>${esc(msg)}</p>
      <div class="sheet-btns"><button class="btn ghost small" data-r="0">Cancel</button><button class="btn small" data-r="1">${esc(okLabel)}</button></div></div>`;
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b && e.target !== wrap) return;
      wrap.remove();
      resolve(!!(b && b.dataset.r === '1'));
    });
    document.body.appendChild(wrap);
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
  if (store.mode === 'artifact') {
    const bad = store.readOnly || store.full || !store.online;
    return `<button class="pill ${bad ? 'warn' : 'ok'}" data-act="go" data-view="sync">${store.readOnly ? 'Can’t save' : store.full ? 'Storage full' : store.online ? '● Synced' : '○ Reconnecting'}</button>`;
  }
  if (store.mode === 'cloud') {
    return `<button class="pill ${store.online ? 'ok' : ''}" data-act="go" data-view="sync">${store.online ? '● Synced' : '○ Offline'}</button>`;
  }
  return `<button class="pill ${needsExport() ? 'warn' : ''}" data-act="go" data-view="sync">⇄ Sync</button>`;
}

function topbar(title, { backBtn = true, right = '' } = {}) {
  return `<header class="topbar">
    ${backBtn ? '<button class="icon-btn" data-act="back" aria-label="Back">‹</button>' : '<span class="icon-btn ghost"></span>'}
    <h1>${title}</h1>
    <div class="topbar-right">${right}</div>
  </header>`;
}

function tabbar() {
  const t = (id, icon, label, badge = 0) => `<button class="tab ${ui.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}"><span>${icon}</span>${label}${badge ? `<i class="tab-badge">${badge}</i>` : ''}</button>`;
  return `<nav class="tabbar">${t('home', '🏠', 'Home')}${t('play', '💬', 'Questions')}${t('games', '🎲', 'Games', gamesWaitingCount())}${t('spicy', '🔥', 'Spicy')}${t('us', '💞', 'Us')}</nav>`;
}

// Games run in their own overlay (#game-root); this just starts the engine once we know who's here.
let gamesStarted = false;
function ensureGames() {
  if (gamesStarted || !me()) return;
  gamesStarted = true;
  initGames(store, { onChange: () => render(), toast, ask });
}

// ── onboarding ────────────────────────────────────────────────────────
function viewWho() {
  if (ARTIFACT && !session.ready) {
    return `<div class="screen center"><div class="hero-emoji">💞</div><p class="muted">Loading your stuff…</p></div>`;
  }
  const taken = (w) => store.uid && store.person(w).uid && store.person(w).uid !== store.uid;
  const btn = (w, cls) => (taken(w)
    ? `<button class="btn big-btn ${cls}" disabled>${N(w)} (already set up)</button>`
    : `<button class="btn big-btn ${cls}" data-act="pickMe" data-who="${w}">I’m ${N(w)}</button>`);
  return `<div class="screen center">
    <div class="hero-emoji">💞</div>
    <h1 class="big">${esc(CONFIG.appName)}</h1>
    <p class="muted">Our own little game app. Who’s playing on this device?</p>
    <div class="stack">
      ${btn('a', '')}
      ${btn('b', 'alt')}
    </div>
  </div>`;
}

function viewConnect() {
  const room = store.room;
  return `${topbar('Connect phones', { backBtn: false })}
  <div class="screen">
    ${room ? `
      <div class="card">
        <h2>Send this to ${N(them())} 💌</h2>
        <p class="muted">When ${N(them())} opens it, your phones are linked for good. Everything syncs live.</p>
        <button class="btn" data-act="sharePair">Share pairing link</button>
      </div>
      <button class="btn ghost" data-act="tab" data-tab="home">Done → let’s play</button>
    ` : `
      <div class="card">
        <h2>Link your phones</h2>
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
      <button class="btn" data-act="saveDaily" data-key="${key}">Lock it in</button>
      <p class="tiny muted">${theirs ? `${N(them())} already answered 👀 Answer to unlock it.` : `Answers stay hidden until you’ve both answered.`}</p>`;
  } else if (!theirs) {
    inner = `${bubble(me(), mine)}
      <div class="locked">🔒 Waiting on ${N(them())}…</div>
      <button class="btn ghost small" data-act="nudge" data-text="${esc(`Answer today's question on ${CONFIG.appName} 👀`)}">Nudge ${N(them())}</button>`;
  } else {
    inner = bubble(me(), mine) + bubble(them(), theirs);
  }
  return `<div class="card daily ${compact ? 'compact' : ''}">
    <div class="eyebrow">${key === dkey() ? 'Question of the day' : prettyDate(key)}</div>
    <h2 class="q">${esc(q)}</h2>
    ${inner}
  </div>`;
}

function bubble(who, text) {
  const skipped = text === SKIPPED;
  return `<div class="bubble ${who === me() ? 'mine' : 'theirs'}">
    <div class="who">${N(who)}</div>
    <div class="txt ${skipped ? 'muted' : ''}">${skipped ? 'skipped' : esc(text)}</div>
  </div>`;
}

function packRow(p, note = '') {
  return `<button class="row" data-act="openPack" data-id="${p.id}">
    <span class="row-title">${packTitle(p)}</span>
    <span class="row-note">${note}</span>
    <span class="chev">›</span>
  </button>`;
}

function tabHome() {
  const s = streak();
  const days = daysTogether();
  const seen = readSet('jt.seen');
  const yourMove = PACKS.filter((p) => !doneOf(me(), p) && (doneOf(them(), p) || countOf(them(), p) > 0));
  const fresh = PACKS.filter((p) => doneOf(me(), p) && doneOf(them(), p) && !seen.has(p.id));
  const inProgress = PACKS.filter((p) => !doneOf(me(), p) && countOf(me(), p) > 0 && !yourMove.includes(p));
  const waiting = PACKS.filter((p) => doneOf(me(), p) && !doneOf(them(), p));

  return `${topbar(esc(CONFIG.appName), { backBtn: false, right: syncPill() })}
  <div class="screen">
    <div class="couple">
      <div class="names">${N('a')} <span class="heart">♥</span> ${N('b')}</div>
      <div class="stats">
        ${days != null ? `<div class="stat"><b>${days.toLocaleString()}</b><span>days together</span></div>` : `<button class="stat link" data-act="tab" data-tab="us"><b>📅</b><span>set your date</span></button>`}
        <div class="stat"><b>${s}${s ? ' 🔥' : ''}</b><span>day streak</span></div>
      </div>
    </div>

    ${needsExport() ? `<div class="card notice">
      <b>You’ve got new answers to send ${N(them())}.</b>
      <button class="btn small" data-act="nudge" data-text="${esc('New answers on ' + CONFIG.appName + ' 💌')}">Send sync link</button>
    </div>` : ''}

    ${dailyCard(dkey())}

    ${gamesHomeHTML()}

    ${fresh.length ? `<h3 class="section">✨ New results</h3><div class="list">${fresh.map((p) => packRow(p, '<span class="chip hot">see results</span>')).join('')}</div>` : ''}
    ${yourMove.length ? `<h3 class="section">👉 Your move</h3><div class="list">${yourMove.map((p) => packRow(p, `<span class="chip">${N(them())} ${doneOf(them(), p) ? 'finished' : 'started'}</span>`)).join('')}</div>` : ''}
    ${inProgress.length ? `<h3 class="section">Keep going</h3><div class="list">${inProgress.map((p) => packRow(p, `${countOf(me(), p)}/${p.items.length}`)).join('')}</div>` : ''}
    ${waiting.length ? `<h3 class="section">⏳ Waiting on ${N(them())}</h3><div class="list">${waiting.map((p) => packRow(p, '')).join('')}</div>` : ''}

    <h3 class="section">Quick play</h3>
    <div class="grid2">
      <button class="tile" data-act="surprise"><span>🎲</span>Surprise me</button>
      <button class="tile" data-act="go" data-view="tod"><span>🎭</span>Truth or Dare</button>
      <button class="tile" data-act="go" data-view="dates"><span>🎡</span>Date spinner</button>
      <button class="tile" data-act="go" data-view="history"><span>📖</span>Past questions</button>
    </div>
  </div>`;
}

function packTile(p) {
  const mine = doneOf(me(), p) ? '✓' : countOf(me(), p) ? `${countOf(me(), p)}/${p.items.length}` : '';
  const theirs = doneOf(them(), p) ? '✓' : countOf(them(), p) ? '…' : '';
  const both = doneOf(me(), p) && doneOf(them(), p);
  return `<button class="ptile ${both ? 'both' : ''}" data-act="openPack" data-id="${p.id}">
    <span class="pe">${p.emoji}</span>
    <span class="pt">${esc(p.title)}</span>
    <span class="ps">
      <span class="dot ${mine === '✓' ? 'on' : mine ? 'half' : ''}">${N(me())[0]}</span>
      <span class="dot ${theirs === '✓' ? 'on' : theirs ? 'half' : ''}">${N(them())[0]}</span>
      <span class="pc">${p.items.length} Qs</span>
    </span>
  </button>`;
}

function catSection(c) {
  const packs = PACKS.filter((p) => p.cat === c.id);
  if (!packs.length) return '';
  return `<section>
    <h3 class="section">${esc(c.title)}</h3>
    <p class="tiny muted sub">${esc(c.blurb)}</p>
    <div class="pgrid">${packs.map(packTile).join('')}</div>
  </section>`;
}

function tabGames() {
  return `<div class="games-tab">${gamesHubHTML()}</div>`;
}

function tabPlay() {
  return `${topbar('Questions', { backBtn: false, right: syncPill() })}
  <div class="screen">
    <div class="grid2">
      <button class="tile" data-act="go" data-view="tod"><span>🎭</span>Truth or Dare</button>
      <button class="tile" data-act="go" data-view="dates"><span>🎡</span>Date spinner</button>
    </div>
    ${CATEGORIES.map(catSection).join('')}
  </div>`;
}

function tabSpicy() {
  if (!session.spicyOpen) {
    return `${topbar('After Dark', { backBtn: false, right: syncPill() })}
    <div class="screen center gate">
      <div class="hero-emoji">🔥</div>
      <h2>For your eyes only</h2>
      <p class="muted">The spicy stuff is hidden so nobody sees it over your shoulder.</p>
      <button class="btn hot" data-act="openSpicy">Open it up 😏</button>
    </div>`;
  }
  return `${topbar('After Dark', { backBtn: false, right: `<button class="pill" data-act="closeSpicy">Hide 🙈</button>` })}
  <div class="screen">
    <div class="grid2">
      <button class="tile hot" data-act="spicyTod"><span>🎭</span>Spicy Truth or Dare</button>
      <button class="tile hot" data-act="spicyDate"><span>🕯️</span>Spicy date night</button>
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
      <h2>📅 Our date</h2>
      <p class="muted tiny">When did you two start? Powers the days-together counter.</p>
      <input class="input" type="date" data-act-change="since" value="${esc(store.state.shared.since || '')}" max="${dkey()}" />
    </div>

    <div class="card">
      <h2>🪣 Bucket list</h2>
      <div class="add-row">
        <input class="input" data-draft="bucket" placeholder="Something to do together…" maxlength="140" />
        <button class="btn small" data-act="addBucket">Add</button>
      </div>
      ${bucket.length ? `<ul class="bucket">${bucket.map(([id, v]) => `<li class="${v.done ? 'done' : ''}">
          <button class="check" data-act="toggleBucket" data-id="${id}">${v.done ? '✓' : ''}</button>
          <span class="bt">${esc(v.t)}<small>${N(v.by)}</small></span>
          <button class="x" data-act="delBucket" data-id="${id}" aria-label="Remove">×</button>
        </li>`).join('')}</ul>` : '<p class="muted tiny">Empty for now. The date spinner can add ideas here too.</p>'}
    </div>

    <div class="card">
      <h2>💝 Love languages</h2>
      ${llBoth ? ['a', 'b'].map((w) => { const top = loveScores(w)[0]; return `<p><b>${N(w)}:</b> ${LOVE_LANGS[top[0]].emoji} ${LOVE_LANGS[top[0]].name}</p>`; }).join('') + `<button class="btn ghost small" data-act="openPack" data-id="lovelang">Full results</button>`
        : `<p class="muted tiny">${doneOf(me(), ll) ? `Waiting on ${N(them())} to take it.` : 'Take the quiz to find out how you each feel most loved.'}</p><button class="btn small" data-act="openPack" data-id="lovelang">${doneOf(me(), ll) ? 'See mine' : 'Take the quiz'}</button>`}
    </div>

    ${total ? `<div class="card">
      <h2>🏆 Who knows who better</h2>
      <div class="score-duo">
        <div><b>${Math.round((mineRight / total) * 100)}%</b><span>${N(me())} knows ${N(them())}</span></div>
        <div><b>${Math.round((theirsRight / total) * 100)}%</b><span>${N(them())} knows ${N(me())}</span></div>
      </div>
      <p class="tiny muted">Across ${total} quiz questions you’ve both answered.</p>
    </div>` : ''}

    <div class="list">
      <button class="row" data-act="go" data-view="history"><span class="row-title">📖 Past daily questions</span><span class="chev">›</span></button>
      <button class="row" data-act="go" data-view="sync"><span class="row-title">⇄ Sync & pairing</span><span class="chev">›</span></button>
      <button class="row" data-act="switchMe"><span class="row-title">🔁 I’m actually ${N(them())}</span><span class="chev">›</span></button>
    </div>
    <p class="tiny muted center-text">Made just for ${N('a')} & ${N('b')} ♥</p>
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
  const status = (who, n) => (doneOf(who, p) ? '<span class="chip ok">done ✓</span>' : n ? `<span class="chip">${n}/${p.items.length}</span>` : '<span class="chip dim">not started</span>');
  return `${topbar('')}
  <div class="screen center">
    <div class="hero-emoji">${p.emoji}</div>
    <h1 class="big">${esc(p.title)}</h1>
    <p class="muted">${esc(packBlurb(p))}</p>
    <div class="status-row">
      <div>${N(me())} ${status(me(), mineN)}</div>
      <div>${N(them())} ${status(them(), theirsN)}</div>
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
  const head = `<header class="topbar">
    <button class="icon-btn" data-act="exitPlay" aria-label="Close">✕</button>
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
        <div class="label">Your answer</div><div class="opts">${opts('m')}</div>
        <div class="label">What will ${N(them())} say?</div><div class="opts guess">${opts('g')}</div>`;
      break;
    }
    case 'pick':
      body = `<div class="vs">
        <button class="choice ${sel(0)}" data-act="answer" data-v="0">${esc(item[0])}</button>
        <div class="or">or</div>
        <button class="choice ${sel(1)}" data-act="answer" data-v="1">${esc(item[1])}</button>
      </div>`;
      break;
    case 'who':
      body = `<div class="eyebrow center-text">Who’s more likely to…</div><h2 class="q center-text">${esc(item)}</h2>
      <div class="vs two">
        <button class="choice ${sel(me())}" data-act="answer" data-v="${me()}">${N(me())}<small>(me)</small></button>
        <button class="choice ${sel(them())}" data-act="answer" data-v="${them()}">${N(them())}</button>
      </div>`;
      break;
    case 'nhie':
      body = `<div class="eyebrow center-text">Never have I ever…</div><h2 class="q center-text">${esc(item)}</h2>
      <div class="vs two">
        <button class="choice ${sel(1)}" data-act="answer" data-v="1">🙋 I have</button>
        <button class="choice ${sel(0)}" data-act="answer" data-v="0">🙅 Never</button>
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
        <button class="choice y ${sel(2)}" data-act="answer" data-v="2">Yes 🔥</button>
        <button class="choice m ${sel(1)}" data-act="answer" data-v="1">Maybe 🤔</button>
        <button class="choice n ${sel(0)}" data-act="answer" data-v="0">No</button>
      </div>
      <p class="tiny muted center-text">${N(them())} only sees this if you both say yes or maybe.</p>`;
      break;
    case 'lovelang':
      body = `<div class="eyebrow center-text">Which would mean more to you?</div>
      <div class="vs">
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
      ${idx > 0 ? '<button class="btn ghost small" data-act="prevQ">‹ Back</button>' : '<span></span>'}
      ${existing !== undefined && idx < total - 1 ? '<button class="btn ghost small" data-act="nextQ">Next ›</button>' : ''}
    </div>
  </div>`;
}

function saveAnswer(p, idx, value) {
  store.setMine(['packs', p.id, 'ans', 'i' + idx], value);
  session.temp = null;
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
  if (both) { const s = readSet('jt.seen'); if (!s.has(p.id)) { s.add(p.id); saveSet('jt.seen', s); } }
  const a = ansOf(me(), p); const b = ansOf(them(), p);
  const head = topbar(`${p.emoji} ${esc(p.title)}`);
  const footer = `<div class="footer-actions">
      ${!both ? `<button class="btn" data-act="nudge" data-text="${esc(`I finished "${p.title}" on ${CONFIG.appName}. Your turn 😘`)}">Nudge ${N(them())}</button>` : ''}
      <button class="btn ghost small" data-act="redoPack">Redo my answers</button>
    </div>`;

  if (!both && p.type !== 'lovelang') {
    const preview = p.type === 'ynm' ? '<p class="muted">Your answers are locked in and private.</p>' : '';
    return `${head}<div class="screen center">
      <div class="hero-emoji">⏳</div>
      <h2>Locked in!</h2>
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
          <div><b>${mine}/${n}</b><span>${N(me())} knows ${N(them())}</span><small>${verdict(mine)}</small></div>
          <div><b>${theirs}/${n}</b><span>${N(them())} knows ${N(me())}</span><small>${verdict(theirs)}</small></div>
        </div>${rows}`;
      break;
    }
    case 'pick': {
      let m = 0;
      const rows = p.items.map((it, i) => {
        const x = a['i' + i]; const y = b['i' + i]; const same = x === y; if (same) m++;
        const side = (k) => `<div class="side ${x === k || y === k ? 'picked' : ''}">${esc(it[k])}
          <span class="avs">${x === k ? `<i class="av me">${N(me())[0]}</i>` : ''}${y === k ? `<i class="av them">${N(them())[0]}</i>` : ''}</span></div>`;
        return `<div class="rcard pickrow ${same ? 'match' : ''}">${side(0)}${side(1)}</div>`;
      }).join('');
      const pct = Math.round((m / p.items.length) * 100);
      body = `<div class="score-big"><b>${pct}%</b><span>in sync · ${m}/${p.items.length} matches</span><small>${pct >= 80 ? 'Basically the same person 💞' : pct >= 55 ? 'Pretty in sync!' : pct >= 35 ? 'Opposites attract?' : 'Chaos couple 😂'}</small></div>${rows}`;
      break;
    }
    case 'who': {
      let agree = 0; const votes = { a: 0, b: 0 };
      const rows = p.items.map((it, i) => {
        const x = a['i' + i]; const y = b['i' + i]; if (x === y) agree++;
        votes[x]++; votes[y]++;
        return `<div class="rcard ${x === y ? 'match' : ''}"><div class="rq">${esc(it)}</div>
          <div class="rline">${x === y ? `Both said <b>${N(x)}</b> ${x === y ? '🤝' : ''}` : `${N(me())} said <b>${N(x)}</b> · ${N(them())} said <b>${N(y)}</b>`}</div></div>`;
      }).join('');
      body = `<div class="score-duo"><div><b>${votes[me()]}</b><span>votes for ${N(me())}</span></div><div><b>${votes[them()]}</b><span>votes for ${N(them())}</span></div></div>
        <p class="center-text muted">You agreed on ${agree}/${p.items.length}.</p>${rows}`;
      break;
    }
    case 'nhie': {
      const lbl = (v) => (v ? '🙋 have' : '🙅 never');
      const rows = p.items.map((it, i) => {
        const x = a['i' + i]; const y = b['i' + i];
        const tag = x && y ? '<span class="chip hot">both!</span>' : x || y ? '<span class="chip">👀</span>' : '';
        return `<div class="rcard"><div class="rq">${esc(it)} ${tag}</div>
          <div class="rline">${N(me())}: ${lbl(x)} · ${N(them())}: ${lbl(y)}</div></div>`;
      }).join('');
      const both2 = p.items.filter((_, i) => a['i' + i] && b['i' + i]).length;
      body = `<p class="center-text muted">You’ve both done ${both2} of these. Story time for the 👀 ones.</p>${rows}`;
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
        ${bothYes.length ? `<h3 class="section">🔥 Both said YES</h3><div class="tags">${bothYes.map((r) => `<span class="tag hot">${esc(r.it)}</span>`).join('')}</div>` : ''}
        ${someMaybe.length ? `<h3 class="section">🤔 Worth talking about</h3><p class="tiny muted">At least one maybe, nobody said no.</p><div class="tags">${someMaybe.map((r) => `<span class="tag">${esc(r.it)}</span>`).join('')}</div>` : ''}
        ${!mutual.length ? '<p class="muted center-text">No overlap on this one — and that’s fine. Try the other list?</p>' : ''}`;
      break;
    }
    case 'lovelang': {
      const prof = (who) => {
        if (!doneOf(who, p)) return `<div class="card"><h2>${N(who)}</h2><p class="muted">Hasn’t taken it yet.</p></div>`;
        const sc = loveScores(who); const top = LOVE_LANGS[sc[0][0]];
        return `<div class="card"><h2>${N(who)}: ${top.emoji} ${top.name}</h2>
          ${sc.map(([k, v]) => `<div class="bar"><span>${LOVE_LANGS[k].emoji} ${LOVE_LANGS[k].name}</span><i style="width:${(v / 6) * 100}%"></i><b>${v}</b></div>`).join('')}
          ${who === them() ? `<p class="tip">💡 To love ${N(them())} well: ${esc(top.tip)}</p>` : ''}
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
  const levels = TOD_LEVELS.map((l) => `<button class="chip-btn ${t.level === l.id ? 'on' : ''}" data-act="todLevel" data-level="${l.id}">${l.emoji} ${l.label}</button>`).join('');
  return `${topbar('Truth or Dare')}
  <div class="screen center">
    <div class="chips">${levels}</div>
    <p class="turn">${N(t.turn)}’s turn</p>
    ${t.card ? `<div class="card todcard ${t.kind}">
        <div class="eyebrow">${t.kind === 'truth' ? 'Truth' : 'Dare'}</div>
        <h2>${esc(t.card)}</h2>
      </div>
      <div class="stack">
        <button class="btn ${t.level === 'spicy' ? 'hot' : ''}" data-act="todDone">Done → ${N(t.turn === 'a' ? 'b' : 'a')}’s turn</button>
        <button class="btn ghost small" data-act="todDraw" data-kind="${t.kind}">Draw another ${t.kind}</button>
      </div>`
    : `<div class="vs two">
        <button class="choice big" data-act="todDraw" data-kind="truth">Truth</button>
        <button class="choice big" data-act="todDraw" data-kind="dare">Dare</button>
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
    .map((c) => `<button class="chip-btn ${d.cat === c.id ? 'on' : ''}" data-act="dateCat" data-cat="${c.id}">${c.emoji} ${c.label}</button>`).join('');
  return `${topbar('Date spinner')}
  <div class="screen center">
    <div class="chips">${cats}</div>
    <div class="card spin ${d.spinning ? 'spinning' : ''}">
      <h2>${d.pick ? esc(d.pick) : 'Tap spin for a date idea'}</h2>
    </div>
    <div class="stack">
      <button class="btn big-btn ${d.cat === 'spicy' ? 'hot' : ''}" data-act="spin" ${d.spinning ? 'disabled' : ''}>🎡 ${d.pick ? 'Spin again' : 'Spin'}</button>
      ${d.pick && !d.spinning ? '<button class="btn ghost small" data-act="dateToBucket">+ Add to our bucket list</button>' : ''}
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
        <h2>${store.readOnly ? 'This device can’t save yet' : store.online ? '● Sync is on' : '○ Reconnecting…'}</h2>
        ${store.readOnly
    ? `<p class="muted">Your answers aren’t saving. ${N('a')} needs to share this artifact with you as an <b>Editor</b> (Share → invite by email → Editor). A public link won’t work.</p>`
    : `<p class="muted">Everything saves automatically and shows up for both of you right away, on any device where you’re signed in to Claude.</p>`}
        ${store.full ? '<p class="muted">The shared storage is full. Remove some bucket list items to free space.</p>' : ''}
      </div>
      <div class="card">
        <h2>Adding ${N('b')}</h2>
        <p class="muted tiny">In Claude, open this artifact → Share → invite ${N('b')}’s email with <b>Editor</b> access. Don’t turn on a public link, because that blocks guests from saving.</p>
      </div>
    </div>`;
  }
  if (store.cloudAvailable) {
    return `${topbar('Sync')}
    <div class="screen">
      <div class="card">
        <h2>${store.mode === 'cloud' ? (store.online ? '● Live sync is on' : '○ Offline right now') : 'Live sync available'}</h2>
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
    store.me = d.who;
    ensureGames();
    if (store.mode === 'artifact' && store.uid && store.person(d.who).uid !== store.uid) store.setMine(['uid'], store.uid);
    if (session.pendingSync) { await doImport(session.pendingSync); session.pendingSync = null; }
    if (store.cloudAvailable && !store.room) go({ view: 'connect' }); else render(true);
  },
  switchMe: async () => { if (await ask(`Switch this device to ${store.name(them())}?`, 'Switch')) { store.me = them(); render(true); } },
  createRoom: async () => { store.room = randomId(20); await store.connect(); render(); },
  joinRoom: async () => {
    const room = parseRoom(session.drafts.pair || '');
    if (!room) return toast('That doesn’t look like a pairing link.');
    store.room = room; session.drafts.pair = '';
    if (store.mode === 'cloud') { location.reload(); return; }
    await store.connect(); toast('Paired! 💞'); go({ view: 'tab', tab: 'home' });
  },
  sharePair: () => share(`Join me on ${CONFIG.appName} 💞`, `${appUrl()}#pair=${store.room}`),
  nudge: (d) => nudge(d.text),
  importPaste: async () => {
    const m = String(session.drafts.synclink || '').match(/sync=([A-Za-z0-9_-]+)/);
    if (!m) return toast('Couldn’t find a sync code in that.');
    session.drafts.synclink = '';
    await doImport(m[1]);
  },
  saveDaily: (d) => {
    const v = (session.drafts['daily-' + d.key] || '').trim();
    if (!v) return toast('Write something first 🙂');
    store.setMine(['daily', d.key], v.slice(0, 2000));
    delete session.drafts['daily-' + d.key];
    const theirs = store.person(them()).daily?.[d.key];
    toast(theirs ? 'Unlocked! 🔓' : `Locked in. Waiting on ${store.name(them())}.`);
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
    const v = p.type === 'who' ? d.v : Number(d.v);
    el.parentElement.querySelectorAll('.choice').forEach((b) => b.classList.remove('sel'));
    el.classList.add('sel');
    setTimeout(() => saveAnswer(p, ui.idx, v), 160);
  },
  quizPick: (d) => {
    const p = PACK[ui.packId];
    session.temp[d.k] = Number(d.v);
    render();
    const t = session.temp;
    if (t.m !== undefined && t.g !== undefined) setTimeout(() => saveAnswer(p, ui.idx, { m: t.m, g: t.g }), 260);
  },
  saveOpen: () => {
    const p = PACK[ui.packId]; const k = `open-${p.id}-${ui.idx}`;
    const el = $app.querySelector(`[data-draft="${k}"]`);
    const v = (el ? el.value : session.drafts[k] || '').trim();
    if (!v) return toast('Write something, or tap skip.');
    delete session.drafts[k];
    if (el) el.blur();
    saveAnswer(p, ui.idx, v.slice(0, 4000));
  },
  skipOpen: () => { const p = PACK[ui.packId]; delete session.drafts[`open-${p.id}-${ui.idx}`]; saveAnswer(p, ui.idx, SKIPPED); },
  redoPack: async () => {
    if (!(await ask('Clear your answers for this one and redo it?', 'Redo'))) return;
    store.setMine(['packs', ui.packId], null);
    const s = readSet('jt.seen'); s.delete(ui.packId); saveSet('jt.seen', s);
    update({ step: 'play', idx: 0 });
  },
  surprise: () => {
    const pool = PACKS.filter((p) => !p.spicy && !doneOf(me(), p));
    if (!pool.length) return toast('You’ve done them all! Try the spicy tab 😏');
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
  dateToBucket: () => { if (addBucket(session.date.pick)) toast('Added to the bucket list 🪣'); },
  addBucket: () => {
    const el = $app.querySelector('[data-draft="bucket"]');
    if (addBucket(el ? el.value : '')) { session.drafts.bucket = ''; if (el) { el.value = ''; el.blur(); } render(); }
  },
  toggleBucket: (d) => { const v = store.state.shared.bucket[d.id]; store.setShared(['bucket', d.id], { ...v, done: !v.done, ts: Date.now() }); },
  delBucket: async (d) => { const v = store.state.shared.bucket[d.id]; if (await ask(`Remove "${v.t}"?`, 'Remove')) store.setShared(['bucket', d.id], { ...v, del: true, ts: Date.now() }); },
};

async function doImport(code) {
  const r = await store.importCode(code);
  if (r.ok) toast(`Loaded ${store.name(r.who)}’s answers ✨`);
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
  if (e.target.dataset && e.target.dataset.actChange === 'since') store.setShared(['since'], e.target.value || null);
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
    if (pair) toast('Paired! 💞');
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
  // Recognize this person on a new device.
  if (!me() && store.uid) {
    const w = ['a', 'b'].find((x) => store.person(x).uid === store.uid);
    if (w) store.me = w;
  }
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
