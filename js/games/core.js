// The game room: game registry, a deterministic move-log engine, online sync
// (Claude artifact `db` + `room`), same-device play, and the hub / game chrome.
//
// ── TURN GAMES (kind: 'turns') ─────────────────────────────────────────────
// A match stores one append-only move list per player ('a' and 'b'). A game is
// a pure state machine, replayed identically on both phones:
//
//   init({ first, seed, opts })  -> state          (first = 'a' | 'b')
//   next(state)                  -> who may act now: [] (game over) | ['a'] | ['b'] | ['a','b']
//   apply(state, who, move)      -> new state. Gets a private clone, so mutate freely
//                                   and return it. THROW an Error to reject a move
//                                   (the message is shown to the player).
//   result(state)                -> { winner: 'a'|'b'|null, team?: true, score?: n, text?: '' }
//                                   called once next() returns [].
//   score?(state)                -> { a, b } shown in the player chips (optional)
//
// apply() must be deterministic: use rand(state.seed, …) for randomness, never
// Math.random(). When next() returns both players (a simultaneous phase), their
// moves must not depend on each other's order.
//
// The engine replays: state = init(); loop { acts = next(state); take the next
// unplayed move from the first player in `acts` who has one; apply }. Each phone
// only ever writes its own list, so there are no write conflicts.
//
// ── LIVE GAMES (kind: 'live') ──────────────────────────────────────────────
// Real-time games. On one phone (mode 'local') the game handles both players'
// input itself. Online (mode 'live') both phones join a room: continuous state
// goes through api.setPresence()/api.partnerState() (~30 updates/s, absolute
// state only), discrete events through api.send()/api.on(). Player 'a' is the
// host (api.isHost) and should own the simulation. Call api.finish(result) at
// the end.
//
// ── EVERY GAME ─────────────────────────────────────────────────────────────
//   mount(el, api) -> { update?(ctx), destroy?() }
// See docs/GAMES.md for the full contract.

import { COVERS } from './covers.js';

export const GAMES = [];
const BY_ID = Object.create(null);

const LS_LOCAL = 'ju.games.local.v1';
const LS_RESULTS = 'ju.games.results.v1';
const LS_MUTE = 'ju.games.mute';
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

const G = {
  store: null,
  hooks: { onChange() {}, toast() {}, ask: async () => true },
  db: null,
  room: null,
  online: {}, // id -> normalized match from the db
  local: {}, // id -> same-device match (this browser only)
  pending: {}, // id -> my move list not yet confirmed by the db
  inflight: {},
  dirty: {},
  results: {}, // id -> { game, winner, score, at, mode }
  recording: {},
  partner: { here: false, at: null },
  invite: null,
  screen: null,
  filter: 'all',
  cleaned: false,
};

// ── small helpers ─────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const other = (w) => (w === 'a' ? 'b' : 'a');
const me = () => G.store.me;
const nameOf = (w) => G.store.name(w);
const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const newId = (n = 12) => {
  const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => abc[b % abc.length]).join('');
};
function changed() {
  if (G.screen && G.screen.refresh) G.screen.refresh();
  G.hooks.onChange();
}
const toast = (m) => G.hooks.toast(m);
const ago = (t) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// ── registry ──────────────────────────────────────────────────────────
export function registerGame(def) {
  if (!def || !/^[a-z][a-z0-9-]{1,30}$/.test(def.id || '')) throw new Error('game id must be lowercase letters, digits, dashes');
  if (BY_ID[def.id]) throw new Error('duplicate game id ' + def.id);
  if (def.kind !== 'turns' && def.kind !== 'live') throw new Error(def.id + ': kind must be "turns" or "live"');
  if (typeof def.mount !== 'function') throw new Error(def.id + ': mount() is required');
  if (def.kind === 'turns') for (const f of ['init', 'next', 'apply']) if (typeof def[f] !== 'function') throw new Error(`${def.id}: ${f}() is required`);
  def.tags = def.tags || [];
  def.howTo = def.howTo || [];
  if (!def.cover && COVERS[def.id]) def.cover = COVERS[def.id];
  GAMES.push(def);
  BY_ID[def.id] = def;
  if (def.css && typeof document !== 'undefined') {
    const s = document.createElement('style');
    s.dataset.game = def.id;
    s.textContent = def.css;
    document.head.appendChild(s);
  }
  return def;
}
export const gameById = (id) => BY_ID[id] || null;

// ── deterministic randomness ──────────────────────────────────────────
export function hash(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= 0x2f; h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
/** Deterministic float in [0, 1) for a seed plus any keys: rand(state.seed, 'roll', turn). */
export const rand = (seed, ...keys) => hash(seed, ...keys) / 4294967296;
/** Deterministic integer in [0, n). */
export const randInt = (n, seed, ...keys) => Math.floor(rand(seed, ...keys) * n);
/** A seeded generator: const r = rng(seed); r() -> [0,1). */
export function rng(seed) {
  let a = hash(seed) || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Deterministic shuffle (returns a new array). */
export function shuffled(arr, seed) {
  const r = rng(seed); const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ── the engine ────────────────────────────────────────────────────────
const normActs = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((w) => w === 'a' || w === 'b');

/** Replay a match. Returns { state, acts, over, result, last, count, rejected }. */
export function derive(def, match) {
  const setup = { first: match.first, seed: match.seed, opts: match.opts || {} };
  let state = def.init(clone(setup));
  if (state && typeof state === 'object' && state.seed === undefined) state.seed = match.seed;
  const lists = match.lists;
  const used = { a: 0, b: 0 };
  const rejected = [];
  let last = null;
  let count = 0;
  for (let guard = 0; guard < 20000; guard++) {
    const acts = normActs(def.next(state));
    const w = acts.find((x) => used[x] < lists[x].length);
    if (!w) break;
    const mv = lists[w][used[w]++];
    try {
      const ns = def.apply(clone(state), w, clone(mv));
      if (ns === undefined) throw new Error('apply() returned nothing');
      state = ns;
      count++;
      last = { who: w, move: mv, n: count };
    } catch (e) {
      rejected.push({ who: w, move: mv, error: String((e && e.message) || e) });
    }
  }
  const acts = normActs(def.next(state));
  const over = acts.length === 0;
  let result = null;
  if (over) {
    result = def.result ? def.result(state) : { winner: null };
    result = result || { winner: null };
  }
  return { state, acts, over, result, last, count, rejected, used };
}

const deriveCache = new Map();
function derived(m) {
  const def = BY_ID[m.game];
  if (!def || def.kind !== 'turns') return null;
  const key = `${m.id}|${m.lists.a.length}|${m.lists.b.length}|${m.seed}`;
  let d = deriveCache.get(key);
  if (!d) {
    try { d = derive(def, m); } catch (e) { console.error('derive failed', m.game, e); d = { state: null, acts: [], over: true, result: { winner: null, text: 'This game hit a bug.' }, last: null, count: 0, rejected: [], broken: true }; }
    if (deriveCache.size > 300) deriveCache.clear();
    deriveCache.set(key, d);
  }
  return d;
}

// ── matches ───────────────────────────────────────────────────────────
function parseList(s) {
  if (Array.isArray(s)) return s;
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function normalize(id, d) {
  return {
    id, online: true, game: d.game, first: d.first === 'b' ? 'b' : 'a', seed: d.seed, by: d.by, created: d.created || 0,
    opts: d.opts || {}, lists: { a: parseList(d.a), b: parseList(d.b) }, ua: d.ua || 0, ub: d.ub || 0,
  };
}
function getMatch(id) {
  if (G.local[id]) return G.local[id];
  const m = G.online[id];
  if (!m) return null;
  const pend = G.pending[id];
  const w = me();
  if (pend && pend.length > m.lists[w].length) return { ...m, lists: { ...m.lists, [w]: pend } };
  return m;
}
function allMatches() {
  return [...Object.keys(G.online), ...Object.keys(G.local)].map(getMatch).filter((m) => m && BY_ID[m.game]);
}
function persistLocal() { lsSet(LS_LOCAL, G.local); }

function writeMoves(id) {
  if (G.inflight[id]) { G.dirty[id] = true; return; }
  G.inflight[id] = true;
  const w = me();
  (async () => {
    do {
      G.dirty[id] = false;
      const list = G.pending[id];
      if (!list) break;
      try {
        await G.db.doc(`matches/${id}`).update({ [w]: JSON.stringify(list), ['u' + w]: Date.now() });
      } catch (e) {
        console.warn('move write failed', e);
        if (e && e.code === 'unavailable') { await new Promise((r) => setTimeout(r, 600 + Math.random() * 600)); G.dirty[id] = true; continue; }
        toast(e && e.code === 'invalid_argument' ? 'That game no longer exists.' : 'Couldn’t save your move. Check your connection.');
        break;
      }
    } while (G.dirty[id]);
    G.inflight[id] = false;
  })();
}

function ping(id, extra = {}) {
  if (!G.room) return;
  G.room.emit('ping', { m: id, to: other(me()), ...extra }).catch(() => {});
}

async function refetch(id) {
  if (!G.db) return;
  try {
    const snap = await G.db.doc(`matches/${id}`).get();
    if (snap.exists) { G.online[id] = normalize(id, snap.data()); healPending(id); changed(); }
  } catch { /* the snapshot will catch up */ }
}

function healPending(id) {
  const pend = G.pending[id];
  const m = G.online[id];
  if (!pend) return;
  if (!m) { delete G.pending[id]; return; }
  const server = m.lists[me()];
  if (server.length >= pend.length) delete G.pending[id];
  else if (!G.inflight[id]) writeMoves(id); // a write got lost: send it again
}

function lastFirst(gameId) {
  const ms = allMatches().filter((m) => m.game === gameId).sort((x, y) => y.created - x.created);
  return ms.length ? ms[0].first : null;
}

async function createMatch(gameId, mode, { first } = {}) {
  const def = BY_ID[gameId];
  if (!def) return null;
  const prev = lastFirst(gameId);
  const f = first || (prev ? other(prev) : Math.random() < 0.5 ? 'a' : 'b');
  const base = { game: gameId, first: f, seed: Math.floor(Math.random() * 2147483647), by: me(), created: Date.now(), opts: {} };
  if (mode === 'local' || !G.db) {
    const id = 'l' + newId(11);
    G.local[id] = { id, online: false, ...base, lists: { a: [], b: [] }, ua: 0, ub: 0 };
    persistLocal();
    return id;
  }
  const id = newId(12);
  const doc = { ...base, a: '[]', b: '[]', ua: 0, ub: 0 };
  G.online[id] = normalize(id, doc);
  try {
    await G.db.doc(`matches/${id}`).set(doc);
  } catch (e) {
    delete G.online[id];
    toast(e && e.code === 'invalid_argument' ? 'You can’t start games yet. Ask for Editor access.' : 'Couldn’t start the game. Try again.');
    return null;
  }
  ping(id, { new: gameId });
  return id;
}

async function endMatch(id, { resign = false } = {}) {
  const m = getMatch(id);
  if (!m) return;
  const def = BY_ID[m.game];
  const d = derived(m);
  if (resign && d && !d.over && !def.team) recordResult(id, m.game, { winner: other(G.screen?.actor || me()) }, m.online ? 'online' : 'local');
  if (m.online) {
    delete G.online[id];
    delete G.pending[id];
    try { await G.db.doc(`matches/${id}`).delete(); } catch { /* ignore */ }
    ping(id, { gone: true });
  } else {
    delete G.local[id];
    persistLocal();
  }
  changed();
}

// ── results / records ─────────────────────────────────────────────────
function recordResult(id, gameId, res, mode) {
  if (G.results[id] || G.recording[id]) return;
  const def = BY_ID[gameId];
  const winner = res.team || def?.team ? 'team' : res.winner === 'a' || res.winner === 'b' ? res.winner : 'draw';
  const rec = { game: gameId, winner, score: Number.isFinite(res.score) ? res.score : null, at: Date.now(), mode };
  G.recording[id] = true;
  G.results[id] = rec;
  if (G.db) G.db.doc(`results/${id}`).set(rec).catch(() => { delete G.recording[id]; });
  else lsSet(LS_RESULTS, G.results);
}

export function gameRecord(gameId) {
  const r = { a: 0, b: 0, draw: 0, best: null, plays: 0 };
  for (const x of Object.values(G.results)) {
    if (gameId && x.game !== gameId) continue;
    r.plays++;
    if (x.winner === 'a') r.a++;
    else if (x.winner === 'b') r.b++;
    else if (x.winner === 'team') { if (x.score != null) r.best = Math.max(r.best ?? -Infinity, x.score); }
    else r.draw++;
  }
  return r;
}

function recordFinished() {
  for (const m of allMatches()) {
    const d = derived(m);
    if (d && d.over && !d.broken && !G.results[m.id]) recordResult(m.id, m.game, d.result, m.online ? 'online' : 'local');
  }
}

async function cleanup() {
  if (!G.db || G.cleaned) return;
  G.cleaned = true;
  const done = Object.values(G.online).filter((m) => { const d = derived(m); return d && d.over && G.results[m.id]; })
    .sort((x, y) => y.created - x.created);
  for (const m of done.slice(25)) { try { await G.db.doc(`matches/${m.id}`).delete(); } catch { /* ignore */ } }
}

// ── sound + haptics + 3D ──────────────────────────────────────────────
let actx = null;
export const muted = () => !!lsGet(LS_MUTE, false);
const NOTES = {
  tap: [[880, 0.035, 'triangle', 0.12]],
  place: [[196, 0.09, 'sine', 0.35], [294, 0.07, 'sine', 0.2]],
  flip: [[520, 0.04, 'square', 0.06], [780, 0.04, 'square', 0.05]],
  good: [[523, 0.07], [659, 0.07], [784, 0.12]],
  bad: [[180, 0.18, 'sawtooth', 0.12]],
  win: [[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.28]],
  lose: [[392, 0.14], [330, 0.14], [262, 0.3]],
  tick: [[1400, 0.018, 'square', 0.05]],
  hit: [[140, 0.06, 'square', 0.25], [90, 0.05, 'sine', 0.3]],
  pop: [[700, 0.05, 'sine', 0.25], [1100, 0.04, 'sine', 0.15]],
};
/** Play a short synth sound: tap, place, flip, good, bad, win, lose, tick, hit, pop. */
export function sfx(name) {
  if (muted()) return;
  const seq = NOTES[name];
  if (!seq) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    let t = actx.currentTime + 0.005;
    for (const [f, d, type = 'triangle', vol = 0.18] of seq) {
      const o = actx.createOscillator(); const g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d + 0.02);
      t += d * 0.85;
    }
  } catch { /* no audio */ }
}
export function haptic(ms = 12) { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* ignore */ } }

/** Resolved theme colours for canvas / WebGL drawing. Call again after a theme change. */
export function tokens(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    a: v('--p-a'), b: v('--p-b'), aSoft: v('--p-a-soft'), bSoft: v('--p-b-soft'),
    bg: v('--g-bg'), card: v('--g-card'), ink: v('--g-ink'), muted: v('--g-muted'), line: v('--g-line'),
    hl: v('--g-hl'), good: v('--g-good'), bad: v('--g-bad'), onInk: v('--g-on-ink') || '#fff',
    fontDisplay: v('--g-font-display'), fontBody: v('--g-font-body'),
    dark: matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark',
  };
}

let threeP = null;
/** Load three.js r128 (global THREE). Resolves THREE; rejects if it can't load. */
export function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (!threeP) {
    threeP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = THREE_URL;
      s.onload = () => (window.THREE ? res(window.THREE) : rej(new Error('3D engine missing')));
      s.onerror = () => { threeP = null; rej(new Error('Couldn’t load the 3D engine')); };
      document.head.appendChild(s);
    });
  }
  return threeP;
}

// ── init + sync ───────────────────────────────────────────────────────
export async function initGames(store, hooks = {}) {
  G.store = store;
  Object.assign(G.hooks, hooks);
  G.local = lsGet(LS_LOCAL, {}) || {};
  for (const [id, m] of Object.entries(G.local)) if (!m || !m.lists || !BY_ID[m.game]) delete G.local[id];
  if (store.mode === 'artifact' && store.adb) {
    G.db = store.adb;
    G.db.collection('matches').onSnapshot((qs) => {
      const next = {};
      qs.docs.forEach((d) => { if (d.exists) next[d.id] = normalize(d.id, d.data()); });
      G.online = next;
      for (const id of Object.keys(G.pending)) healPending(id);
      recordFinished();
      cleanup();
      changed();
    }, (e) => console.warn('matches sync', e));
    G.db.collection('results').onSnapshot((qs) => {
      const next = {};
      qs.docs.forEach((d) => { if (d.exists) next[d.id] = d.data(); });
      for (const [id, r] of Object.entries(G.results)) if (!next[id] && G.recording[id]) next[id] = r;
      G.results = next;
      changed();
    }, (e) => console.warn('results sync', e));
    try { G.room = await globalThis.claude.use('room'); } catch { G.room = null; }
    if (G.room) wireRoom();
  } else {
    G.results = lsGet(LS_RESULTS, {}) || {};
  }
  recordFinished();
  changed();
}

function wireRoom() {
  const r = G.room;
  setPresence();
  r.onPeers((ch) => {
    const p = ch.peers.find((x) => !x.isMe && x.presence && x.presence.who === other(me()));
    const here = !!p;
    const at = p ? p.presence.at || null : null;
    if (here !== G.partner.here || at !== G.partner.at) { G.partner = { here, at }; changed(); }
  }, () => {});
  r.on('ping', (msg) => {
    if (msg.isMe) return;
    const d = msg.data || {};
    if (d.to && d.to !== me()) return;
    if (typeof d.m !== 'string' || !/^[a-z0-9]{6,20}$/.test(d.m)) return;
    if (d.gone) { delete G.online[d.m]; changed(); return; }
    refetch(d.m);
    const viewing = G.screen && G.screen.id === d.m;
    if (d.new && G.screen && G.screen.offerRematch && G.screen.game === d.new && G.screen.id !== d.m) {
      G.screen.offerRematch(d.m);
      return;
    }
    if (!viewing) {
      const def = BY_ID[d.new || G.online[d.m]?.game];
      if (def) toast(d.new ? `${nameOf(other(me()))} started ${def.title}` : `${nameOf(other(me()))} moved in ${def.title}`);
    }
  }, () => {});
  r.on('invite', (msg) => {
    if (msg.isMe) return;
    const d = msg.data || {};
    if (d.to !== me() || !BY_ID[d.game]) return;
    if (G.screen && G.screen.live && G.screen.game === d.game) return;
    G.invite = { game: d.game, at: Date.now() };
    showInvite();
    changed();
  }, () => {});
}

function setPresence(at = null) {
  if (!G.room || !me()) return;
  G.room.presence({ who: me(), at }).catch(() => {});
}

// ── DOM roots ─────────────────────────────────────────────────────────
function gameRoot() {
  let el = document.getElementById('game-root');
  if (!el) { el = document.createElement('div'); el.id = 'game-root'; el.hidden = true; document.body.appendChild(el); }
  return el;
}
function showRoot(on) {
  const r = gameRoot();
  r.hidden = !on;
  document.body.classList.toggle('gm-open', on);
}

function closeScreen() {
  const s = G.screen;
  G.screen = null;
  if (s) { try { s.close(); } catch (e) { console.error(e); } }
  const r = gameRoot();
  r.innerHTML = '';
  showRoot(false);
  setPresence(null);
  G.hooks.onChange();
}

function showInvite() {
  const inv = G.invite;
  document.getElementById('gm-invite')?.remove();
  if (!inv) return;
  const def = BY_ID[inv.game];
  const el = document.createElement('div');
  el.id = 'gm-invite';
  el.className = 'gm-invite';
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="gm-invite-txt"><b>${esc(nameOf(other(me())))}</b> wants to play <b>${esc(def.title)}</b> live</div>
    <div class="gm-invite-btns"><button class="gm-btn gm-btn-ghost" data-g="invite-no">Not now</button><button class="gm-btn" data-g="invite-yes">Join</button></div>`;
  document.body.appendChild(el);
  clearTimeout(showInvite.t);
  showInvite.t = setTimeout(() => { if (G.invite === inv) { G.invite = null; el.remove(); G.hooks.onChange(); } }, 90000);
}

// ── chrome ────────────────────────────────────────────────────────────
function chipHTML(w) {
  return `<div class="gm-p gm-p-${w}" data-p="${w}">
    <span class="gm-p-dot" aria-hidden="true"></span>
    <span class="gm-p-name">${esc(nameOf(w))}</span>
    <span class="gm-p-score" data-score="${w}"></span>
  </div>`;
}

function chromeHTML(def, { live = false } = {}) {
  return `<div class="gm" data-game="${esc(def.id)}" data-kind="${def.kind}">
    <header class="gm-top">
      <button class="gm-icon" data-g="close" aria-label="Back to games">${ICON.back}</button>
      <h1 class="gm-title">${esc(def.title)}</h1>
      <button class="gm-icon" data-g="menu" aria-label="Game menu">${ICON.menu}</button>
    </header>
    <div class="gm-versus">${chipHTML('a')}<span class="gm-vs">${def.team ? '&amp;' : 'vs'}</span>${chipHTML('b')}</div>
    <div class="gm-status" aria-live="polite"></div>
    <div class="gm-stage"></div>
    <div class="gm-layer gm-curtain" hidden></div>
    <div class="gm-layer gm-wait" hidden></div>
    <div class="gm-layer gm-end" hidden></div>
    <div class="gm-sheet" hidden></div>
  </div>`;
}

function menuHTML(def, { live, online, over, team }) {
  return `<div class="gm-sheet-card" role="dialog" aria-label="Game menu">
    <h2>How to play</h2>
    <ol class="gm-howto">${def.howTo.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>
    <div class="gm-sheet-actions">
      <button class="gm-btn gm-btn-ghost" data-g="mute">${muted() ? 'Sound: off' : 'Sound: on'}</button>
      ${!live && !over ? `<button class="gm-btn gm-btn-danger" data-g="resign">${team || !online ? 'End this game' : 'Resign'}</button>` : ''}
      <button class="gm-btn" data-g="menu">Back to the game</button>
    </div>
  </div>`;
}

function endHTML(def, res, { rematch = true } = {}) {
  let head;
  let cls = '';
  if (def.team || res.team) {
    head = res.text || (Number.isFinite(res.score) ? `Team score: ${res.score}` : 'Nice teamwork');
    cls = 'team';
  } else if (res.winner === 'a' || res.winner === 'b') {
    head = res.text || `${nameOf(res.winner)} wins`;
    cls = `win-${res.winner}`;
  } else {
    head = res.text || 'It’s a draw';
    cls = 'draw';
  }
  const rec = gameRecord(def.id);
  const recLine = def.team
    ? (rec.best != null ? `Best team score: ${rec.best}` : '')
    : `${esc(nameOf('a'))} ${rec.a} – ${rec.b} ${esc(nameOf('b'))}`;
  return `<div class="gm-end-card ${cls}">
    <div class="gm-end-head">${esc(head)}</div>
    ${res.sub ? `<p class="gm-end-sub">${esc(res.sub)}</p>` : ''}
    ${recLine ? `<p class="gm-end-rec">${recLine}</p>` : ''}
    <div class="gm-end-actions">
      <button class="gm-btn gm-btn-ghost" data-g="end-look">See the board</button>
      ${rematch ? '<button class="gm-btn" data-g="rematch">Rematch</button>' : ''}
      <button class="gm-btn gm-btn-ghost" data-g="close">Back to games</button>
    </div>
  </div>`;
}

const ICON = {
  back: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>',
};

// ── turn-game screen ──────────────────────────────────────────────────
function openMatch(id) {
  const m0 = getMatch(id);
  if (!m0) { toast('That game is gone.'); return; }
  const def = BY_ID[m0.game];
  if (G.screen) closeScreen();
  if (typeof window !== 'undefined') window.__lastMatchId = id;
  const root = gameRoot();
  root.innerHTML = chromeHTML(def);
  showRoot(true);
  setPresence(def.id);
  const $ = (s) => root.querySelector(s);
  const stage = $('.gm-stage');
  let customStatus = null;
  let revealedFor = null; // local hidden games: whose secrets are showing
  let lastKey = '';
  let endShown = false;
  let endDismissed = false;
  let ctxNow = null;

  const screen = {
    id, game: def.id, live: false, actor: null,
    refresh: () => paint(),
    close: () => { try { inst && inst.destroy && inst.destroy(); } catch (e) { console.error(e); } },
    toggleMenu() {
      const sh = $('.gm-sheet');
      if (!sh.hidden) { sh.hidden = true; return; }
      const m = getMatch(id); const d = m && derived(m);
      sh.innerHTML = menuHTML(def, { live: false, online: !!m?.online, over: !!d?.over, team: !!def.team });
      sh.hidden = false;
    },
    reveal() { revealedFor = ctxNow && ctxNow.actor; lastKey = ''; paint(); },
    look() { endDismissed = true; $('.gm-end').hidden = true; },
    rematchId: null,
    offerRematch(newMatchId) {
      screen.rematchId = newMatchId;
      const btn = root.querySelector('.gm-end [data-g="rematch"]');
      if (btn) btn.textContent = `Join ${nameOf(other(me()))}’s rematch`;
    },
  };

  function ctxFor(m, d) {
    const local = !m.online;
    let actor = null;
    if (!d.over) {
      if (local) actor = d.acts[0] || null;
      else if (d.acts.includes(me())) actor = me();
    }
    const curtain = local && def.secret && !d.over && actor && revealedFor !== actor;
    const viewer = local ? (def.secret ? (curtain ? null : actor) : (actor || m.first)) : me();
    return {
      state: d.state, acts: d.acts, over: d.over, result: d.result, last: d.last, moves: d.count,
      mode: local ? 'local' : 'online', me: local ? null : me(), actor: curtain ? null : actor, viewer,
      canMove: !!actor && !curtain && !d.over, first: m.first, curtain, matchId: id,
    };
  }

  const api = {
    mode: m0.online ? 'online' : 'local',
    me: m0.online ? me() : null,
    names: { a: nameOf('a'), b: nameOf('b') },
    name: nameOf,
    other,
    color: (w) => `var(--p-${w})`,
    move(mv) { return doMove(id, mv, ctxNow && ctxNow.actor); },
    setStatus(t) { customStatus = t == null ? null : String(t); paintStatus(); },
    toast, sfx, haptic, rand, randInt, rng, shuffled, tokens,
    three: loadThree,
    el: stage,
  };

  let inst = {};
  try { inst = def.mount(stage, api) || {}; } catch (e) { console.error(e); stage.innerHTML = '<p class="gm-error">This game failed to load.</p>'; }

  function paintStatus() {
    const c = ctxNow; if (!c) return;
    let text = customStatus;
    if (text == null) {
      if (c.over) text = '';
      else if (c.curtain) text = '';
      else if (c.mode === 'local') text = `${nameOf(c.actor)}’s turn`;
      else if (c.canMove) text = 'Your turn';
      else text = `Waiting for ${nameOf(other(me()))}…`;
    }
    $('.gm-status').textContent = text;
  }

  function paint() {
    const m = getMatch(id);
    if (!m) { closeScreen(); toast('That game was ended.'); return; }
    const d = derived(m);
    const c = ctxFor(m, d);
    ctxNow = c;
    screen.actor = c.actor || (c.mode === 'online' ? me() : null);
    // chips
    for (const w of ['a', 'b']) {
      const chip = $(`.gm-p-${w}`);
      chip.classList.toggle('is-turn', !c.over && d.acts.includes(w));
      chip.classList.toggle('is-me', c.mode === 'online' && w === me());
    }
    const sc = !d.broken && def.score ? def.score(d.state) : null;
    for (const w of ['a', 'b']) $(`[data-score="${w}"]`).textContent = sc && sc[w] != null ? sc[w] : '';
    paintStatus();
    // pass-the-phone curtain
    const cur = $('.gm-curtain');
    if (c.curtain) {
      const who = d.acts[0];
      cur.innerHTML = `<div class="gm-curtain-card"><p class="gm-curtain-kicker">Pass the phone</p>
        <div class="gm-curtain-name p-${who}">${esc(nameOf(who))}</div>
        <p>${esc(nameOf(other(who)))}, no peeking.</p>
        <button class="gm-btn" data-g="reveal">I’m ${esc(nameOf(who))}, show me</button></div>`;
      cur.hidden = false;
    } else cur.hidden = true;
    stage.classList.toggle('is-covered', !!c.curtain);
    // game body
    const key = `${m.lists.a.length}|${m.lists.b.length}|${c.viewer}|${c.actor}|${c.curtain}`;
    if (key !== lastKey) {
      lastKey = key;
      try { inst.update && inst.update(c); } catch (e) { console.error(def.id, 'update failed', e); }
    }
    // end
    const end = $('.gm-end');
    if (d.over && !endDismissed) {
      if (!endShown) {
        endShown = true;
        if (!G.results[id]) recordResult(id, m.game, d.result, m.online ? 'online' : 'local');
        end.innerHTML = endHTML(def, d.result);
        setTimeout(() => { if (!endDismissed && G.screen === screen) { end.hidden = false; const r = d.result; sfx(def.team || r.team ? 'win' : r.winner && (c.mode === 'local' || r.winner === me()) ? 'win' : r.winner ? 'lose' : 'good'); } }, def.endDelay ?? 900);
      }
    } else if (!d.over) { endShown = false; end.hidden = true; }
  }

  G.screen = screen;
  paint();
}

function doMove(id, mv, actor) {
  const m = getMatch(id);
  if (!m) return { ok: false, error: 'This game is gone.' };
  const def = BY_ID[m.game];
  const d = derived(m);
  if (d.over) return { ok: false, error: 'The game is over.' };
  if (!actor || !d.acts.includes(actor)) return { ok: false, error: 'Not your turn.' };
  let json;
  try { json = JSON.parse(JSON.stringify(mv)); } catch { return { ok: false, error: 'Bad move.' }; }
  try { def.apply(clone(d.state), actor, clone(json)); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  if (m.online) {
    if (actor !== me()) return { ok: false, error: 'Not your turn.' };
    G.pending[id] = [...m.lists[actor], json];
    writeMoves(id);
    ping(id);
  } else {
    G.local[id].lists[actor].push(json);
    G.local[id]['u' + actor] = Date.now();
    persistLocal();
  }
  changed();
  return { ok: true };
}

// ── live-game screen ──────────────────────────────────────────────────
async function openLive(gameId, mode) {
  const def = BY_ID[gameId];
  if (!def) return;
  if (mode === 'live' && !G.room) { toast('Live play needs the Claude version of the app. Try one phone.'); return; }
  if (G.screen) closeScreen();
  const root = gameRoot();
  root.innerHTML = chromeHTML(def, { live: true });
  showRoot(true);
  setPresence(def.id);
  const $ = (s) => root.querySelector(s);
  const stage = $('.gm-stage');
  const evs = {};
  const partnerFns = new Set();
  const hereFns = new Set();
  let nr = null;
  let partnerPeer = null;
  let inst = null;
  let finished = false;
  let customStatus = null;
  const sessionId = newId(8);
  const offs = [];

  const screen = {
    id: null, game: gameId, live: true, mode,
    refresh() {},
    close() {
      try { inst && inst.destroy && inst.destroy(); } catch (e) { console.error(e); }
      offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
      if (nr) { nr.presence({ on: false, s: null }).catch(() => {}); nr.leave().catch(() => {}); }
    },
    toggleMenu() {
      const sh = $('.gm-sheet');
      if (!sh.hidden) { sh.hidden = true; return; }
      sh.innerHTML = menuHTML(def, { live: true });
      sh.hidden = false;
    },
    rematch() {
      if (mode === 'live') api.send('__rematch', {});
      restart();
    },
    look() { $('.gm-end').hidden = true; },
  };

  const api = {
    mode, kind: 'live',
    me: mode === 'live' ? me() : null,
    isHost: mode === 'local' || me() === 'a',
    names: { a: nameOf('a'), b: nameOf('b') },
    name: nameOf, other,
    color: (w) => `var(--p-${w})`,
    toast, sfx, haptic, rand, randInt, rng, shuffled, tokens,
    three: loadThree,
    el: stage,
    get partnerHere() { return mode === 'local' || !!partnerPeer; },
    setPresence(obj) { if (nr) nr.presence({ s: obj }).catch(() => {}); },
    partnerState() { return partnerPeer && partnerPeer.presence ? partnerPeer.presence.s ?? null : null; },
    onPartnerState(fn) { partnerFns.add(fn); return () => partnerFns.delete(fn); },
    onPartnerHere(fn) { hereFns.add(fn); return () => hereFns.delete(fn); },
    send(type, data) { if (nr) nr.emit('ev', { t: String(type), d: data ?? null, s: sessionId }).catch(() => {}); },
    on(type, fn) { (evs[type] = evs[type] || new Set()).add(fn); return () => evs[type].delete(fn); },
    setStatus(t) { customStatus = t == null ? null : String(t); paintStatus(); },
    setScore(sc) { for (const w of ['a', 'b']) $(`[data-score="${w}"]`).textContent = sc && sc[w] != null ? sc[w] : ''; },
    finish(result) {
      if (finished) return;
      finished = true;
      const res = result || { winner: null };
      if (mode === 'local' || api.isHost) recordResult('v' + newId(11), gameId, res, mode);
      if (mode === 'live' && api.isHost) api.send('__finish', res);
      showEnd(res);
    },
  };

  function paintStatus() {
    let text = customStatus;
    if (text == null) text = mode === 'local' ? 'One phone, two players' : partnerPeer ? '' : `Waiting for ${nameOf(other(me()))}…`;
    $('.gm-status').textContent = text;
  }

  function showEnd(res) {
    const end = $('.gm-end');
    end.innerHTML = endHTML(def, res);
    end.hidden = false;
    const won = def.team || res.team || (mode === 'local' ? !!res.winner : res.winner === me());
    sfx(won ? 'win' : res.winner ? 'lose' : 'good');
  }

  function mountGame() {
    finished = false;
    $('.gm-end').hidden = true;
    stage.innerHTML = '';
    try { inst = def.mount(stage, api) || {}; } catch (e) { console.error(e); stage.innerHTML = '<p class="gm-error">This game failed to load.</p>'; inst = {}; }
  }
  function restart() {
    try { inst && inst.destroy && inst.destroy(); } catch (e) { console.error(e); }
    inst = null;
    mountGame();
  }

  function setWaiting(on) {
    const w = $('.gm-wait');
    if (on) {
      w.innerHTML = `<div class="gm-wait-card"><div class="gm-wait-pulse" aria-hidden="true"></div>
        <p><b>Waiting for ${esc(nameOf(other(me())))}</b></p>
        <p class="gm-wait-sub">We sent an invite. This starts as soon as they open it.</p>
        <button class="gm-btn gm-btn-ghost" data-g="invite-again">Send the invite again</button></div>`;
      w.hidden = false;
    } else w.hidden = true;
  }

  G.screen = screen;
  for (const w of ['a', 'b']) $(`.gm-p-${w}`).classList.toggle('is-me', mode === 'live' && w === me());

  if (mode === 'local') {
    paintStatus();
    mountGame();
    return;
  }

  try { nr = await G.room.join(`ju-${gameId}`); } catch (e) {
    toast('Couldn’t connect for live play. Try again in a moment.');
    closeScreen();
    return;
  }
  if (G.screen !== screen) { nr.leave().catch(() => {}); return; }
  nr.presence({ who: me(), on: true, s: null }).catch(() => {});
  const invite = () => G.room.emit('invite', { to: other(me()), game: gameId }).catch(() => {});
  screen.inviteAgain = () => { invite(); toast('Invite sent'); };
  invite();
  setWaiting(true);
  paintStatus();

  const findPartner = (peers) => peers.find((p) => !p.isMe && p.presence && p.presence.who === other(me()) && p.presence.on) || null;
  offs.push(nr.onPeers((ch) => {
    const p = findPartner(ch.peers);
    const was = !!partnerPeer;
    partnerPeer = p;
    if (!!p !== was) {
      hereFns.forEach((fn) => { try { fn(!!p); } catch (e) { console.error(e); } });
      if (p && !inst) { setWaiting(false); mountGame(); }
      else if (!p && inst && !finished) { setWaiting(true); }
      else if (p) setWaiting(false);
      for (const w of ['a', 'b']) $(`.gm-p-${w}`).classList.toggle('is-away', w === other(me()) && !p);
      paintStatus();
    }
    if (p) partnerFns.forEach((fn) => { try { fn(p.presence.s ?? null); } catch (e) { console.error(e); } });
  }, () => {}));
  offs.push(nr.on('ev', (msg) => {
    if (msg.isMe) return;
    const d = msg.data || {};
    if (d.t === '__rematch') { restart(); return; }
    if (d.t === '__finish') { if (!finished) { finished = true; showEnd(d.d || { winner: null }); } return; }
    (evs[d.t] || []).forEach((fn) => { try { fn(d.d, msg); } catch (e) { console.error(e); } });
  }, () => {}));
}

// ── hub ───────────────────────────────────────────────────────────────
const FILTERS = [
  ['all', 'All'], ['versus', 'Versus'], ['coop', 'Together'], ['brainy', 'Brainy'], ['silly', 'Silly'], ['live', 'Live'],
];

function matchRow(m) {
  const def = BY_ID[m.game];
  const d = derived(m);
  let note = '';
  if (m.online) {
    if (d.acts.includes(me())) note = m.by !== me() && d.count === 0 && !(m.lists[me()].length) ? 'New' : 'Your move';
    else note = `${esc(nameOf(other(me())))}’s move`;
  } else note = 'On this phone';
  return `<button class="gh-row" data-g="open" data-id="${esc(m.id)}">
    <span class="gh-row-cover" aria-hidden="true">${def.cover || ''}</span>
    <span class="gh-row-main"><span class="gh-row-title">${esc(def.title)}</span><span class="gh-row-sub">${note} · ${ago(Math.max(m.ua || 0, m.ub || 0, m.created || 0))}</span></span>
    <span class="gh-row-go" aria-hidden="true">${ICON.back}</span>
  </button>`;
}

function activeMatches() {
  return allMatches().filter((m) => { const d = derived(m); return d && !d.over; })
    .sort((x, y) => Math.max(y.ua, y.ub, y.created) - Math.max(x.ua, x.ub, x.created));
}

function gameMatches(gameId) { return activeMatches().filter((m) => m.game === gameId); }

function cardHTML(def) {
  const rec = gameRecord(def.id);
  const recLine = def.team ? (rec.best != null ? `Best ${rec.best}` : '') : rec.plays ? `${rec.a}–${rec.b}` : '';
  const live = def.kind === 'live';
  return `<button class="gh-card" data-g="sheet" data-game="${esc(def.id)}" style="--card-hue:${def.hue ?? 0}">
    <span class="gh-card-cover" aria-hidden="true">${def.cover || ''}</span>
    <span class="gh-card-body">
      <span class="gh-card-title">${esc(def.title)}</span>
      <span class="gh-card-blurb">${esc(def.blurb || '')}</span>
      <span class="gh-card-meta">
        <span class="gh-tag">${live ? 'Live' : 'Take turns'}</span>
        <span class="gh-tag">${def.team ? 'Together' : 'Versus'}</span>
        ${def.minutes ? `<span class="gh-tag">${def.minutes} min</span>` : ''}
        ${recLine ? `<span class="gh-rec">${recLine}</span>` : ''}
      </span>
    </span>
  </button>`;
}

function filterGames(f) {
  return GAMES.filter((g) => !g.unlisted).filter((g) => {
    if (f === 'all') return true;
    if (f === 'versus') return !g.team;
    if (f === 'coop') return !!g.team;
    if (f === 'live') return g.kind === 'live';
    return g.tags.includes(f);
  });
}

/** The Games tab body (rendered inside the app's #app). */
export function gamesHubHTML() {
  if (!G.store || !me()) return '';
  const rec = gameRecord(null);
  const act = activeMatches();
  const mine = act.filter((m) => m.online && derived(m).acts.includes(me()));
  const theirs = act.filter((m) => m.online && !derived(m).acts.includes(me()));
  const local = act.filter((m) => !m.online);
  const p = G.partner;
  const pName = esc(nameOf(other(me())));
  const pAt = p.at && BY_ID[p.at] ? `playing ${esc(BY_ID[p.at].title)}` : 'online now';
  const games = filterGames(G.filter);
  return `<div class="gh">
    <header class="gh-head">
      <h1 class="gh-title">Games</h1>
      <div class="gh-score" aria-label="Head to head">
        <span class="gh-score-p p-a"><b>${rec.a}</b>${esc(nameOf('a'))}</span>
        <span class="gh-score-sep" aria-hidden="true">:</span>
        <span class="gh-score-p p-b"><b>${rec.b}</b>${esc(nameOf('b'))}</span>
      </div>
      ${G.room ? `<p class="gh-presence ${p.here ? 'is-here' : ''}"><span class="gh-presence-dot" aria-hidden="true"></span>${p.here ? `${pName} is ${pAt}` : `${pName} isn’t here right now`}</p>` : ''}
    </header>
    ${G.invite ? `<div class="gh-invite"><span><b>${pName}</b> wants to play <b>${esc(BY_ID[G.invite.game].title)}</b> live</span><button class="gm-btn" data-g="invite-yes">Join</button></div>` : ''}
    ${mine.length ? `<section class="gh-sec"><h2 class="gh-h">Your move</h2><div class="gh-rows">${mine.map(matchRow).join('')}</div></section>` : ''}
    ${theirs.length ? `<section class="gh-sec"><h2 class="gh-h">Waiting on ${pName}</h2><div class="gh-rows">${theirs.map(matchRow).join('')}</div></section>` : ''}
    ${local.length ? `<section class="gh-sec"><h2 class="gh-h">On this phone</h2><div class="gh-rows">${local.map(matchRow).join('')}</div></section>` : ''}
    <section class="gh-sec">
      <div class="gh-filters" role="tablist">${FILTERS.map(([k, l]) => `<button class="gh-filter ${G.filter === k ? 'on' : ''}" role="tab" aria-selected="${G.filter === k}" data-g="filter" data-f="${k}">${l}</button>`).join('')}</div>
      <div class="gh-grid">${games.map(cardHTML).join('') || '<p class="gh-empty">No games here yet.</p>'}</div>
    </section>
  </div>`;
}

/** Small "your move" block for the Home tab ('' when nothing to show). */
export function gamesHomeHTML() {
  if (!G.store || !me()) return '';
  const mine = activeMatches().filter((m) => m.online && derived(m).acts.includes(me()));
  const inv = G.invite && BY_ID[G.invite.game];
  if (!mine.length && !inv) return '';
  return `<div class="gh-home">
    ${inv ? `<div class="gh-invite"><span><b>${esc(nameOf(other(me())))}</b> wants to play <b>${esc(inv.title)}</b> live</span><button class="gm-btn" data-g="invite-yes">Join</button></div>` : ''}
    ${mine.length ? `<h3 class="section">Your move in games</h3><div class="gh-rows">${mine.slice(0, 4).map(matchRow).join('')}</div>` : ''}
  </div>`;
}

/** Number of online games waiting on me (for a tab badge). */
export function gamesWaitingCount() {
  if (!G.store || !me()) return 0;
  return activeMatches().filter((m) => m.online && derived(m).acts.includes(me())).length + (G.invite ? 1 : 0);
}

// ── game sheet (pick a mode) ──────────────────────────────────────────
function openSheet(gameId) {
  const def = BY_ID[gameId];
  if (!def) return;
  if (G.screen) closeScreen();
  const root = gameRoot();
  const rec = gameRecord(gameId);
  const ms = gameMatches(gameId);
  const online = !!G.db;
  const live = def.kind === 'live';
  const pName = esc(nameOf(other(me())));
  const actions = live
    ? `${G.room ? `<button class="gm-btn gm-btn-big" data-g="live" data-game="${def.id}" data-mode="live">Play live with ${pName}${G.partner.here ? ' <span class="gs-here">online</span>' : ''}</button>` : ''}
       <button class="gm-btn gm-btn-big ${G.room ? 'gm-btn-ghost' : ''}" data-g="live" data-game="${def.id}" data-mode="local">Play on one phone</button>`
    : `${online ? `<button class="gm-btn gm-btn-big" data-g="new" data-game="${def.id}" data-mode="online">New game with ${pName}</button>` : ''}
       <button class="gm-btn gm-btn-big ${online ? 'gm-btn-ghost' : ''}" data-g="new" data-game="${def.id}" data-mode="local">Play on one phone</button>`;
  root.innerHTML = `<div class="gs-wrap" data-g="sheet-close"><div class="gs" role="dialog" aria-label="${esc(def.title)}" data-game="${esc(def.id)}">
    <div class="gs-cover" aria-hidden="true">${def.cover || ''}</div>
    <h2 class="gs-title">${esc(def.title)}</h2>
    <p class="gs-blurb">${esc(def.blurb || '')}</p>
    <ol class="gm-howto">${def.howTo.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>
    ${rec.plays ? `<p class="gs-rec">${def.team ? (rec.best != null ? `Best team score: ${rec.best}` : `Played ${rec.plays}×`) : `${esc(nameOf('a'))} ${rec.a} – ${rec.b} ${esc(nameOf('b'))}${rec.draw ? ` · ${rec.draw} draw${rec.draw > 1 ? 's' : ''}` : ''}`}</p>` : ''}
    ${ms.length ? `<div class="gh-rows gs-matches">${ms.map(matchRow).join('')}</div>` : ''}
    <div class="gs-actions">${actions}</div>
    <button class="gm-btn gm-btn-ghost gs-close" data-g="sheet-close">Close</button>
  </div></div>`;
  showRoot(true);
  G.screen = { id: null, game: gameId, sheet: true, refresh() {}, close() {} };
}

// ── events ────────────────────────────────────────────────────────────
const ACTIONS = {
  sheet: (d) => openSheet(d.game),
  'sheet-close': (d, el, e) => { if (e.target === el || el.classList.contains('gs-close')) closeScreen(); },
  open: (d) => openMatch(d.id),
  new: async (d) => {
    const id = await createMatch(d.game, d.mode);
    if (id) openMatch(id);
  },
  live: (d) => openLive(d.game, d.mode),
  close: () => closeScreen(),
  menu: () => G.screen && G.screen.toggleMenu && G.screen.toggleMenu(),
  mute: (d, el) => { lsSet(LS_MUTE, !muted()); el.textContent = muted() ? 'Sound: off' : 'Sound: on'; if (!muted()) sfx('tap'); },
  reveal: () => G.screen && G.screen.reveal && G.screen.reveal(),
  'end-look': () => G.screen && G.screen.look && G.screen.look(),
  resign: async () => {
    const s = G.screen;
    if (!s || !s.id) return;
    const m = getMatch(s.id);
    const def = m && BY_ID[m.game];
    const versusOnline = m && m.online && !def.team;
    const ok = await G.hooks.ask(versusOnline ? 'Resign this game? It counts as a loss.' : 'End this game? It will be deleted.', versusOnline ? 'Resign' : 'End game');
    if (!ok) return;
    await endMatch(s.id, { resign: true });
    closeScreen();
  },
  rematch: async () => {
    const s = G.screen;
    if (!s) return;
    if (s.live) { s.rematch(); return; }
    if (s.rematchId && getMatch(s.rematchId)) { openMatch(s.rematchId); return; }
    const m = getMatch(s.id);
    if (!m) return;
    const id = await createMatch(m.game, m.online ? 'online' : 'local', { first: other(m.first) });
    if (id) openMatch(id);
  },
  filter: (d) => { G.filter = d.f; G.hooks.onChange(); },
  'invite-yes': () => {
    const inv = G.invite;
    G.invite = null;
    document.getElementById('gm-invite')?.remove();
    if (inv) openLive(inv.game, 'live');
  },
  'invite-no': () => { G.invite = null; document.getElementById('gm-invite')?.remove(); G.hooks.onChange(); },
  'invite-again': () => G.screen && G.screen.inviteAgain && G.screen.inviteAgain(),
};

if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-g]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.g];
    if (!fn) return;
    if (el.dataset.g !== 'sheet-close') e.preventDefault();
    fn(el.dataset, el, e);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && G.screen) {
      const sh = document.querySelector('#game-root .gm-sheet:not([hidden])');
      if (sh) sh.hidden = true; else closeScreen();
    }
  });
}

// Test hooks: let the test harness inspect engine state and open hidden games.
export const __games = G;
if (typeof window !== 'undefined') {
  window.__gamesDebug = (id) => {
    const m = getMatch(id);
    if (!m) return null;
    const d = derived(m);
    return { acts: d.acts, over: d.over, result: d.result, state: d.state, rejected: d.rejected, lists: m.lists, first: m.first };
  };
  window.__gamesOpenSheet = (g) => openSheet(g);
}
