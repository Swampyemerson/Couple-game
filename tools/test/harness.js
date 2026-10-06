// Two-player test harness for the artifact build.
//
//   const { launch } = require('./harness');
//   const h = await launch({ port: 8771 });          // builds dist/, opens Emerson (a) + Sydney (b)
//   await h.openGames(h.a);                          // go to the Games tab
//   const id = await h.newOnlineGame(h.a, 'four');   // start an online match, returns its id
//   await h.openMatch(h.b, id);                      // partner opens it
//   ...
//   h.assertNoErrors(); await h.close();
//
// Serves dist/just-us.html inside the artifact skeleton and injects a mock
// Claude runtime (db + room + user) that both browser contexts share through
// the Node process, with a configurable network delay. three.js from the CDN is
// served from a local copy. Each player is pre-identified (no name picker).
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const CACHE = path.join(__dirname, '.cache');
const PW = process.env.PW || path.join(execSync('npm root -g').toString().trim(), 'playwright');
const { chromium, devices } = require(PW);

function ensureThree() {
  const out = path.join(CACHE, 'three.min.js');
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(CACHE, { recursive: true });
  execSync('npm pack three@0.128.0 --silent', { cwd: CACHE, stdio: 'pipe' });
  execSync('tar -xzf three-0.128.0.tgz package/build/three.min.js', { cwd: CACHE });
  fs.renameSync(path.join(CACHE, 'package/build/three.min.js'), out);
  return out;
}

// Runs inside each page before the app. Talks to Node through exposed bindings.
const RUNTIME = (cfg) => `
(() => {
  const ME = ${JSON.stringify(cfg.who)}, UID = ${JSON.stringify(cfg.uid)};
  if (${JSON.stringify(!!cfg.coarse)}) {
    // Headless Chromium doesn't report a phone's touch pointer, so emulate it.
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => {
      if (/pointer:\s*coarse/.test(q) || /hover:\s*none/.test(q)) return { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
      if (/pointer:\s*fine/.test(q) || /hover:\s*hover/.test(q)) return { matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
      return mm(q);
    };
  }
  try { localStorage.setItem('jt.me', ME); } catch {}
  window.confirm = () => false; window.alert = () => {}; window.prompt = () => null;
  const clone = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  const freeze = (o) => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };

  // ── db ──
  const docL = []; // { path, fn }
  const colL = []; // { path, fn }
  let all = {};
  const snapDoc = (p, d) => ({ id: p.split('/').pop(), exists: d !== undefined && d !== null, data: () => (d == null ? undefined : freeze(clone(d))), metadata: { fromCache: false, hasPendingWrites: false } });
  const deliverAll = () => {
    for (const l of docL) l.fn(snapDoc(l.path, all[l.path]));
    for (const l of colL) {
      const pre = l.path + '/';
      const ds = Object.keys(all).filter((k) => k.startsWith(pre) && k.slice(pre.length).indexOf('/') < 0).sort().map((k) => snapDoc(k, all[k]));
      l.fn({ docs: ds, size: ds.length, empty: !ds.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } });
    }
  };
  let dbSeq = 0;
  window.__dbPush = (snapshot, seq) => { if (seq <= dbSeq) return; dbSeq = seq; all = snapshot; deliverAll(); };
  const err = (code, message) => Object.assign(new Error(message), { code });
  const call = async (op, p, v) => {
    const r = JSON.parse(await window.__db(op, p, v === undefined ? null : JSON.stringify(v)));
    if (r.error) throw err(r.error, r.message || r.error);
    return r;
  };
  const docRef = (p) => {
    if (p.split('/').length % 2) throw new TypeError('document path needs an even number of segments: ' + p);
    return {
      path: p, id: p.split('/').pop(),
      get: async () => snapDoc(p, (await call('get', p)).data),
      set: async (d) => { if (!d || typeof d !== 'object' || Array.isArray(d)) throw err('invalid_argument', 'body must be an object'); await call('set', p, d); },
      update: async (d) => { await call('update', p, d); },
      delete: async () => { await call('delete', p); },
      onSnapshot: (fn) => { const l = { path: p, fn }; docL.push(l); Promise.resolve().then(() => fn(snapDoc(p, all[p]))); return () => { const i = docL.indexOf(l); if (i >= 0) docL.splice(i, 1); }; },
      collection: (c) => colRef(p + '/' + c),
    };
  };
  const colRef = (c) => {
    const q = {
      path: c,
      doc: (id) => docRef(c + '/' + (id || Math.random().toString(36).slice(2, 12))),
      add: async (d) => { const r = q.doc(); await r.set(d); return r; },
      where: () => q, orderBy: () => q, limit: () => q,
      get: async () => { const pre = c + '/'; const ds = Object.keys(all).filter((k) => k.startsWith(pre) && k.slice(pre.length).indexOf('/') < 0).map((k) => snapDoc(k, all[k])); return { docs: ds, size: ds.length, empty: !ds.length, docChanges: () => [] }; },
      onSnapshot: (fn) => { const l = { path: c, fn }; colL.push(l); Promise.resolve().then(deliverAll); return () => { const i = colL.indexOf(l); if (i >= 0) colL.splice(i, 1); }; },
    };
    return q;
  };
  const db = { doc: docRef, collection: colRef };

  // ── room ──
  let PEER = null;
  const rooms = {}; // name -> { peers: [], peerFns: Set, topicFns: {topic: Set} }
  const R = (name) => (rooms[name] = rooms[name] || { name, peers: Object.freeze([]), peerFns: new Set(), topicFns: {}, joined: name === '' });
  const decorate = (p) => Object.freeze({ peer: p.peer, by: p.by, isMe: p.by === UID, sameTab: p.peer === PEER, kind: 'viewer', guest: false, presence: freeze(clone(p.presence || {})), updatedAt: p.updatedAt });
  window.__roomDeliver = (ev) => {
    const r = R(ev.name);
    if (ev.kind === 'peers') {
      if (ev.seq <= (r.seq || 0)) return; // stale snapshot arrived late
      r.seq = ev.seq;
      const prev = new Map(r.peers.map((p) => [p.peer, p]));
      const nextPeers = Object.freeze(ev.peers.map((p) => { const old = prev.get(p.peer); return old && JSON.stringify(old.presence) === JSON.stringify(p.presence || {}) ? old : decorate(p); }));
      const ids = new Set(nextPeers.map((p) => p.peer));
      const joined = nextPeers.filter((p) => !prev.has(p.peer));
      const left = r.peers.filter((p) => !ids.has(p.peer));
      const updated = nextPeers.filter((p) => prev.has(p.peer) && prev.get(p.peer) !== p);
      r.peers = nextPeers;
      if (joined.length || left.length || updated.length) for (const fn of r.peerFns) fn({ peers: r.peers, joined, left, updated });
    } else if (ev.kind === 'msg') {
      const msg = { topic: ev.topic, data: freeze(clone(ev.data)), peer: ev.peer, by: ev.by, isMe: ev.by === UID, sameTab: ev.peer === PEER, kind: 'viewer', guest: false };
      for (const fn of r.topicFns[ev.topic] || []) fn(msg);
    }
  };
  const roomApi = (name) => {
    const r = R(name);
    return {
      name,
      emit: async (topic, data) => { if (!/^[a-z][a-z0-9_.-]{0,47}$/.test(topic)) throw err('invalid_argument', 'bad topic'); const s = JSON.stringify(data ?? null); if (s.length > 4096) throw err('invalid_argument', 'data over 4 KiB'); await window.__room('emit', name, topic, s); },
      on: (topic, fn) => { (r.topicFns[topic] = r.topicFns[topic] || new Set()).add(fn); return () => r.topicFns[topic].delete(fn); },
      presence: async (patch) => { await window.__room('presence', name, '', JSON.stringify(patch)); },
      peers: () => r.peers,
      onPeers: (fn) => { r.peerFns.add(fn); Promise.resolve().then(() => { if (r.peers.length) fn({ peers: r.peers, joined: r.peers, left: [], updated: [] }); }); return () => r.peerFns.delete(fn); },
      connected: () => true,
      onConnection: (fn) => { Promise.resolve().then(() => fn(true)); return () => {}; },
      leave: async () => { r.peerFns.clear(); r.topicFns = {}; await window.__room('leave', name, '', ''); },
    };
  };
  const lobby = roomApi('');
  const room = Object.assign(lobby, {
    join: async (name) => { if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(name)) throw err('invalid_argument', 'bad room name'); await window.__room('join', name, '', ''); return roomApi(name); },
    canSendToClaudeSession: async () => 'off',
  });

  const user = { id: async () => UID, isOwner: async () => ME === 'a', canEdit: async () => true, can: async () => true, me: async () => ({ id: UID, name: '', email: null }) };
  let ready = null;
  const hello = () => (ready = ready || (async () => { PEER = await window.__room('hello', '', '', ''); })());
  window.claude = { use: async (n) => { await hello(); await new Promise((r) => setTimeout(r, 30)); return n === 'db' ? db : n === 'room' ? room : n === 'user' ? user : null; } };
})();`;

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

async function launch(opts = {}) {
  const {
    port = 8770 + Math.floor(Math.random() * 500), latency = 40, build = true, headless = true,
    device = 'iPhone 13', who = ['a', 'b'], seedDocs = {}, only = null, colorScheme = 'light',
    dropRate = 0, // fraction of room events (emit) silently dropped, to test resilience
    coarse = false, // true = report (pointer: coarse) like a real phone
    reducedMotion = 'no-preference', // or 'reduce'
  } = opts;
  // `only`: game file names to bundle (e.g. ['four', 'dots']). Builds to a private file so
  // parallel test runs, and other people's half-finished games, can't break yours.
  const out = path.join(CACHE, `build-${port}.html`);
  fs.mkdirSync(CACHE, { recursive: true });
  if (build) {
    const onlyArg = only ? ` --only ${only.join(',')}` : '';
    try { execSync(`python3 tools/build_artifact.py --out ${out}${onlyArg}`, { cwd: ROOT, stdio: 'pipe' }); } catch (e) { throw new Error('build failed: ' + (e.stderr || e.stdout || e).toString()); }
  }
  const three = ensureThree();
  const body = fs.readFileSync(build ? out : path.join(ROOT, 'dist/just-us.html'), 'utf8');
  const page = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${body}</body></html>`;
  const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(page); });
  await new Promise((res) => server.listen(port, res));

  const docs = JSON.parse(JSON.stringify(seedDocs));
  const pages = [];
  const errors = [];
  const roomState = {}; // name -> Map(peer -> { peer, by, presence, updatedAt, page })
  let peerSeq = 0;
  const later = (fn) => setTimeout(fn, latency * (0.6 + Math.random() * 0.8));
  let seq = 0;
  const pushDocs = () => { const snap = JSON.parse(JSON.stringify(docs)); const n = ++seq; for (const p of pages) later(() => p.evaluate(([s, k]) => window.__dbPush && window.__dbPush(s, k), [snap, n]).catch(() => {})); };
  const peersOf = (name) => [...(roomState[name] || new Map()).values()].map(({ peer, by, presence, updatedAt }) => ({ peer, by, presence, updatedAt }));
  const pushPeers = (name) => {
    const list = peersOf(name);
    const n = ++seq;
    for (const p of pages) later(() => p.evaluate((ev) => window.__roomDeliver && window.__roomDeliver(ev), { kind: 'peers', name, peers: list, seq: n }).catch(() => {}));
  };
  const browser = await chromium.launch({ headless });

  async function player(w) {
    const ctx = await browser.newContext({ ...devices[device], hasTouch: true, colorScheme, reducedMotion });
    const uid = 'u_' + w;
    await ctx.addInitScript(RUNTIME({ who: w, uid, coarse }));
    await ctx.route(/three\.js\/r128\/three\.min\.js/, (r) => r.fulfill({ path: three, contentType: 'text/javascript' }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const pg = await ctx.newPage();
    pg.__who = w;
    pg.__peer = null;
    await ctx.exposeBinding('__db', async (_s, op, p, v) => {
      await new Promise((r) => later(r));
      const val = v == null ? null : JSON.parse(v);
      if (op === 'get') return JSON.stringify({ data: docs[p] ?? null });
      if (op === 'set') { docs[p] = val; pushDocs(); return '{}'; }
      if (op === 'update') {
        if (!docs[p]) return JSON.stringify({ error: 'invalid_argument', message: 'update needs an existing document' });
        docs[p] = deepMerge(docs[p], val); pushDocs(); return '{}';
      }
      if (op === 'delete') { delete docs[p]; pushDocs(); return '{}'; }
      return JSON.stringify({ error: 'invalid_argument', message: 'bad op' });
    });
    await ctx.exposeBinding('__room', async (_s, op, name, topic, data) => {
      if (op === 'hello') {
        for (const [n, m] of Object.entries(roomState)) if (pg.__peer && m.delete(pg.__peer)) pushPeers(n);
        pg.__peer = 'p' + ++peerSeq;
        (roomState[''] = roomState[''] || new Map()).set(pg.__peer, { peer: pg.__peer, by: uid, presence: {}, updatedAt: Date.now() });
        pushPeers('');
        return pg.__peer;
      }
      const m = (roomState[name] = roomState[name] || new Map());
      if (op === 'join') { m.set(pg.__peer, { peer: pg.__peer, by: uid, presence: {}, updatedAt: Date.now() }); pushPeers(name); return ''; }
      if (op === 'leave') { m.delete(pg.__peer); pushPeers(name); return ''; }
      if (op === 'presence') {
        const cur = m.get(pg.__peer);
        if (!cur) return '';
        const patch = JSON.parse(data);
        const next = { ...cur.presence };
        for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v; }
        m.set(pg.__peer, { ...cur, presence: next, updatedAt: Date.now() });
        pushPeers(name);
        return '';
      }
      if (op === 'emit') {
        const ev = { kind: 'msg', name, topic, data: JSON.parse(data), peer: pg.__peer, by: uid };
        for (const p of pages) if ((roomState[name] || new Map()).has(p.__peer) && !(p !== pg && Math.random() < dropRate)) later(() => p.evaluate((e) => window.__roomDeliver && window.__roomDeliver(e), ev).catch(() => {}));
        return '';
      }
      return '';
    });
    pg.on('pageerror', (e) => errors.push(`[${w}] ${e.message}`));
    pg.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|favicon/.test(m.text())) errors.push(`[${w}] console: ${m.text()}`); });
    pages.push(pg);
    await pg.goto(`http://localhost:${port}/`);
    await pg.waitForFunction(() => !!document.querySelector('.tabbar'), null, { timeout: 15000 });
    await pg.waitForTimeout(250);
    return pg;
  }

  const h = { docs, errors, browser, roomState };
  for (const w of who) h[w] = await player(w);

  async function openSheet(pg, gameId) {
    await h.openGames(pg);
    // Locators re-resolve if the hub re-renders mid-click (e.g. when results sync).
    const card = pg.locator(`[data-g="sheet"][data-game="${gameId}"]`).first();
    if (await card.count()) await card.click();
    else await pg.evaluate((g) => window.__gamesOpenSheet(g), gameId); // unlisted games
    await pg.waitForSelector('#game-root .gs');
  }

  Object.assign(h, {
    openSheet,
    /** Go to the Games tab. */
    async openGames(pg) { await pg.click('[data-act="tab"][data-tab="games"]'); await pg.waitForSelector('.gh'); },
    /** Open a game's sheet and start an online match; returns the match id. */
    async newOnlineGame(pg, gameId) {
      await openSheet(pg, gameId);
      await pg.click(`[data-g="new"][data-game="${gameId}"][data-mode="online"]`);
      await pg.waitForSelector('#game-root .gm');
      await pg.waitForTimeout(latency * 3 + 100);
      return pg.evaluate(() => document.querySelector('#game-root .gm') && window.__lastMatchId);
    },
    async newLocalGame(pg, gameId) {
      await openSheet(pg, gameId);
      await pg.click(`[data-g="new"][data-game="${gameId}"][data-mode="local"]`);
      await pg.waitForSelector('#game-root .gm');
    },
    async startLive(pg, gameId, mode = 'live') {
      await openSheet(pg, gameId);
      await pg.click(`[data-g="live"][data-game="${gameId}"][data-mode="${mode}"]`);
      await pg.waitForSelector('#game-root .gm');
    },
    /** Partner opens a match from the hub. */
    async openMatch(pg, id) {
      await h.openGames(pg);
      await pg.locator(`[data-g="open"][data-id="${id}"]`).first().click({ timeout: 8000 });
      await pg.waitForSelector('#game-root .gm');
    },
    async closeGame(pg) { await pg.click('#game-root [data-g="close"]'); },
    /** Matches currently in the mock db. */
    matches() { return Object.entries(docs).filter(([k]) => k.startsWith('matches/')).map(([k, v]) => ({ id: k.split('/')[1], ...v, a: JSON.parse(v.a), b: JSON.parse(v.b) })); },
    results() { return Object.entries(docs).filter(([k]) => k.startsWith('results/')).map(([, v]) => v); },
    /** Engine view of a match on a page: { acts, over, result, state }. */
    async engine(pg, id) {
      return pg.evaluate((mid) => window.__gamesDebug && window.__gamesDebug(mid), id);
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    settle: () => new Promise((r) => setTimeout(r, latency * 4 + 150)),
    async shot(pg, file, opts2 = {}) { await pg.screenshot({ path: file, ...opts2 }); },
    assertNoErrors() { if (errors.length) throw new Error('Page errors:\n' + errors.join('\n')); },
    async close() { await browser.close(); server.close(); },
  });
  return h;
}

module.exports = { launch, ROOT };
