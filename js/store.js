// State + syncing.
//
// Shape:
//   { people: { a: PersonData, b: PersonData }, shared: { bucket: {id: Item}, since: 'YYYY-MM-DD' } }
//   PersonData = { packs: { [packId]: { ans: { i0: value, … }, done: ts } }, daily: { [date]: text }, updated: ts,
//                  uids: { [claudeUserId]: true } }
//
// Each person only ever writes to their own subtree. Shared items carry timestamps.
//
// Claude artifact mode (the one we ship) keeps these documents in the artifact's db:
//   people/<w>                  that person's PersonData, minus new daily answers
//   people/<w>/daily/<YYYY-MM>  { d: { 'YYYY-MM-DD': text } }: daily answers, one doc per month, so
//                               the person doc never creeps toward the 256 KiB document cap
//   shared/meta                 { since }
//   bucket/<id>                 one bucket list item
// A person can be signed in on several devices at once, so their writes are field-level merges
// (`update`), never whole-document replaces: two devices answering different things at the
// same moment both keep their answers. Unconfirmed writes wait in a small outbox that survives
// reloads, and they are laid over every snapshot, so the UI never flickers back. A snapshot
// marked `fromCache` is never treated as the truth about what the server has.

const LS = { state: 'jt.state.v1', me: 'jt.me', room: 'jt.room', outbox: 'jt.outbox.v1' };
const FB_VER = '10.12.2';

const blank = () => ({ people: { a: {}, b: {} }, shared: {} });

function read(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
}
function write(key, v) {
  try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, v); } catch { /* private mode */ }
}

function setIn(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof o[path[i]] !== 'object' || o[path[i]] === null) o[path[i]] = {};
    o = o[path[i]];
  }
  const last = path[path.length - 1];
  if (value === null || value === undefined) delete o[last];
  else o[last] = value;
}

// Like setIn, but keeps nulls: in an `update` body a null clears that field on the server.
function putIn(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof o[path[i]] !== 'object' || o[path[i]] === null) o[path[i]] = {};
    o = o[path[i]];
  }
  o[path[path.length - 1]] = value;
}

// Fields cleared on the server come back as null: drop them so the app reads them as absent.
function prune(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
  for (const k of Object.keys(o)) {
    if (o[k] === null || o[k] === undefined) delete o[k];
    else if (typeof o[k] === 'object') prune(o[k]);
  }
  return o;
}

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const monthOf = (dateKey) => String(dateKey).slice(0, 7);
// db error codes that no retry can fix for the rest of this page load
const FATAL = new Set(['revoked', 'not_granted', 'capability_disabled', 'capability_removed']);
const SETTLE_MS = 5000;
const getIn = (o, path) => path.reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const sameVal = (a, b) => (a == null && b == null) || JSON.stringify(a) === JSON.stringify(b);
const hasAnswers = (p) => !!(p && ((p.packs && Object.keys(p.packs).length) || (p.daily && Object.keys(p.daily).length)));

function normalize(s) {
  s = s && typeof s === 'object' ? s : {};
  s.people = s.people || {};
  s.people.a = s.people.a || {};
  s.people.b = s.people.b || {};
  s.shared = s.shared || {};
  return s;
}

export function randomId(n = 20) {
  const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

export class Store {
  constructor(config) {
    this.config = config;
    this.listeners = new Set();
    this.mode = 'local'; // 'local' | 'cloud'
    this.online = false;
    let parsed = null;
    try { parsed = JSON.parse(read(LS.state, 'null')); } catch { /* ignore */ }
    this.state = normalize(parsed || blank());
    // artifact mode
    this._docs = {}; // doc path -> last body the server sent
    this._exists = {}; // doc path -> true / false, once a definitive snapshot said so
    this._busy = {}; // doc path -> a drain is running
    this._dq = {}; // shared doc path -> { busy, has, body, cur }: one whole-doc write at a time
    this._bucket = null; // bucket items as the server last listed them
    this._seen = {}; // people/<w> -> a definitive snapshot arrived
    // Writes the server has confirmed but no snapshot has shown yet (a snapshot taken just before
    // the write can still be on its way): kept on top for a few seconds so nothing flickers back.
    this._settle = {}; // doc path -> [{ p, v, t }]
    let out = null;
    try { out = JSON.parse(read(LS.outbox, 'null')); } catch { /* ignore */ }
    this._out = out && typeof out === 'object' && !Array.isArray(out) ? out : {}; // doc path -> [{ p, v }] unconfirmed field writes
  }

  get me() { return read(LS.me); }
  set me(v) { write(LS.me, v); this.emit(); }
  get partner() { return this.me === 'a' ? 'b' : 'a'; }
  get room() { return read(LS.room); }
  set room(v) { write(LS.room, v); }
  get live() { return this.mode === 'cloud' || this.mode === 'artifact'; }
  get cloudAvailable() { return !!(this.config.firebase && this.config.firebase.databaseURL); }

  name(who) { return this.config.names[who] || who; }
  person(who) { return this.state.people[who] || {}; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(remote = false) { for (const fn of this.listeners) fn(remote); }
  persist() { write(LS.state, JSON.stringify(this.state)); }

  // Write my own data. path is relative to people[me].
  setMine(path, value) {
    const me = this.me;
    const ts = Math.max(Date.now(), (this.person(me).updated || 0) + 1);
    if (this.mode === 'artifact') {
      setIn(this.state, ['people', me, ...path], value);
      if (path[0] === 'daily' && path.length === 2) {
        this._queue(`people/${me}/daily/${monthOf(path[1])}`, ['d', path[1]], value);
      } else {
        setIn(this.state, ['people', me, 'updated'], ts);
        this._queue(`people/${me}`, path, value);
        this._queue(`people/${me}`, ['updated'], ts);
      }
      this.persist();
      this.emit();
      return;
    }
    this._set(['people', me, ...path], value);
    this._set(['people', me, 'updated'], ts);
  }

  setShared(path, value) {
    if (this.mode === 'artifact') {
      setIn(this.state, ['shared', ...path], value);
      this.persist();
      this.emit();
      if (path[0] === 'bucket' && path.length === 2) this._writeDoc(`bucket/${path[1]}`, value == null ? null : clone(value));
      else if (path[0] === 'since') this._writeDoc('shared/meta', { since: value || null });
      return;
    }
    this._set(['shared', ...path], value);
  }

  /** Claude user ids that have picked person `w` (on any device). */
  uidsOf(w) {
    const p = this.person(w);
    const ids = new Set(Object.keys(p.uids || {}).filter((k) => p.uids[k]));
    if (p.uid) ids.add(p.uid); // older docs kept a single id
    return ids;
  }

  /** Mark person `w` as picked by this Claude account (so its other devices recognize it). */
  claim(w) {
    if (this.mode !== 'artifact' || !this.uid || w !== this.me || this.uidsOf(w).has(this.uid)) return;
    this.setMine(['uids', this.uid], true);
  }

  /** Undo claim(w): this account picked the wrong person. */
  release(w) {
    if (this.mode !== 'artifact' || !this.uid || !this.uidsOf(w).has(this.uid)) return;
    const doc = `people/${w}`;
    const p = this.person(w);
    if (p.uids && p.uids[this.uid]) { delete p.uids[this.uid]; this._queue(doc, ['uids', this.uid], null); }
    if (p.uid === this.uid) { delete p.uid; this._queue(doc, ['uid'], null); }
    this.persist();
    this.emit();
  }

  _set(path, value) {
    setIn(this.state, path, value);
    this.persist();
    this.emit();
    if (this.mode === 'artifact') { this._artifactWrite(path, value); return; }
    if (this.mode === 'cloud' && this.fb) {
      const { ref, set, db } = this.fb;
      set(ref(db, `rooms/${this.room}/${path.join('/')}`), value ?? null).catch((e) => console.warn('sync write failed', e));
    }
  }

  // ── Cloud (Firebase Realtime Database) ─────────────────────────────
  async connect() {
    if (!this.cloudAvailable || !this.room) return false;
    try {
      const base = `https://www.gstatic.com/firebasejs/${FB_VER}`;
      const [{ initializeApp }, dbm] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-database.js`),
      ]);
      const app = initializeApp(this.config.firebase);
      const db = dbm.getDatabase(app);
      this.fb = { db, ref: dbm.ref, set: dbm.set };
      this.mode = 'cloud';
      dbm.onValue(dbm.ref(db, '.info/connected'), (snap) => { this.online = !!snap.val(); this.emit(true); });
      let first = true;
      dbm.onValue(dbm.ref(db, `rooms/${this.room}`), (snap) => {
        const remote = normalize(snap.val());
        if (first) {
          first = false;
          // Upload anything we had locally (e.g. played before setting up sync).
          const me = this.me;
          const mine = this.state.people[me];
          if (me && mine && (mine.updated || 0) > (remote.people[me].updated || 0)) {
            remote.people[me] = mine;
            this.fb.set(dbm.ref(db, `rooms/${this.room}/people/${me}`), mine);
          }
          const sh = this.state.shared || {};
          for (const [k, v] of Object.entries(sh.bucket || {})) {
            const r = remote.shared.bucket?.[k];
            if (!r || (r.ts || 0) < (v.ts || 0)) {
              setIn(remote, ['shared', 'bucket', k], v);
              this.fb.set(dbm.ref(db, `rooms/${this.room}/shared/bucket/${k}`), v);
            }
          }
          if (sh.since && !remote.shared.since) {
            remote.shared.since = sh.since;
            this.fb.set(dbm.ref(db, `rooms/${this.room}/shared/since`), sh.since);
          }
        }
        this.state = remote;
        this.persist();
        this.emit(true);
      }, (err) => { console.warn('sync read failed', err); this.online = false; this.emit(true); });
      return true;
    } catch (e) {
      console.warn('Firebase failed to load, staying local', e);
      this.mode = 'local';
      return false;
    }
  }

  // ── Claude artifact (built-in shared database) ─────────────────────
  async connectArtifact() {
    const c = globalThis.claude;
    if (!c || typeof c.use !== 'function') return false;
    const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
    if (!db) return false;
    this.adb = db;
    this.mode = 'artifact';
    this.online = true;
    this.uid = user ? await user.id() : null;
    let markReady;
    this.ready = new Promise((res) => { markReady = res; });
    setTimeout(() => markReady(), 6000); // offline: go with what this device has
    const isCache = (snap) => !!(snap && snap.metadata && snap.metadata.fromCache);
    for (const w of ['a', 'b']) {
      const path = `people/${w}`;
      this.watch(() => db.doc(path), (snap) => {
        const def = !isCache(snap);
        if (snap.exists) {
          const data = snap.data() || {};
          const known = this._docs[path] || (this._seen[path] ? null : this.state.people[w]);
          // a cached view older than what we already have is not news
          if (!def && known && (data.updated || 0) < (known.updated || 0)) return;
          this._docs[path] = data;
          if (def) this._exists[path] = true;
        } else {
          if (!def) return; // a cold cache knows nothing about the server yet
          this._exists[path] = false;
          delete this._docs[path];
          // Nothing on the server yet: upload what this device has (played before syncing).
          if (w === this.me && hasAnswers(this.state.people[w]) && !(this._out[path] || []).length) {
            this._queue(path, ['updated'], this.state.people[w].updated || Date.now());
          }
        }
        this._rebuild(w);
        if (def && !this._seen[path]) {
          this._seen[path] = true;
          if (this._seen['people/a'] && this._seen['people/b']) markReady();
        }
      });
      const shards = `people/${w}/daily`;
      this.watch(() => db.collection(shards), (qs) => {
        const def = !isCache(qs);
        if (!def && qs.empty) return;
        const present = new Set();
        for (const d of qs.docs) {
          const k = `${shards}/${d.id}`;
          present.add(k);
          this._docs[k] = d.data() || {};
          if (def) this._exists[k] = true;
        }
        if (def) {
          for (const k of Object.keys(this._docs)) {
            if (k.startsWith(shards + '/') && !present.has(k)) { delete this._docs[k]; this._exists[k] = false; }
          }
        }
        this._rebuild(w);
      });
    }
    this.watch(() => db.doc('shared/meta'), (snap) => {
      if (!snap.exists && isCache(snap)) return;
      const body = snap.exists ? snap.data() || {} : null;
      if (this._sharedOverlay('shared/meta', body ? { since: body.since || null } : null)) return; // our own change is on its way
      const since = body ? body.since || null : null;
      if ((since || null) !== (this.state.shared.since || null)) {
        if (since) this.state.shared.since = since; else delete this.state.shared.since;
        this.persist();
        this.emit(true);
      }
    });
    this.watch(() => db.collection('bucket'), (qs) => {
      if (isCache(qs) && qs.empty) return;
      const bucket = {};
      qs.docs.forEach((d) => { bucket[d.id] = d.data(); });
      this._bucket = bucket;
      this._applyBucket();
    });
    // writes a previous visit couldn't finish
    for (const doc of Object.keys(this._out)) this._flush(doc);
    return true;
  }

  /** onSnapshot that survives the platform dropping it: a terminal error other than
   *  revoked / not-granted resubscribes with backoff (per the db contract, a fresh
   *  onSnapshot is the only recovery for a dead listener). */
  watch(make, next) {
    let tries = 0;
    let off = null;
    let stopped = false;
    const start = () => {
      if (stopped) return;
      try {
        off = make().onSnapshot((snap) => {
          tries = 0;
          if (!this.online) { this.online = true; this.emit(true); this._flushAll(); }
          try { next(snap); } catch (e) { console.error('sync handler failed', e); }
        }, (e) => {
          const code = e && e.code;
          console.warn('sync listener stopped', code, e && e.message);
          this.online = false;
          this.emit(true);
          if (FATAL.has(code) || code === 'invalid_argument') return;
          setTimeout(start, Math.min(30000, 1000 * 2 ** tries++) * (0.75 + Math.random() * 0.5));
        });
      } catch (e) { console.warn('sync subscribe failed', e); }
    };
    start();
    return () => { stopped = true; if (off) off(); };
  }

  // Rebuild people[w] from the server's docs plus this device's unconfirmed writes.
  _rebuild(w) {
    const path = `people/${w}`;
    const cur = this.state.people[w] || {};
    const server = this._docs[path];
    let next;
    if (server) next = clone(server);
    else if (this._exists[path] === false && w !== this.me) next = {};
    else next = clone(cur); // nothing from the server yet: keep what this device has
    const daily = { ...(next.daily || {}) };
    const pre = path + '/daily/';
    for (const [k, d] of Object.entries(this._docs)) if (k.startsWith(pre) && d && d.d) Object.assign(daily, d.d);
    const now = Date.now();
    for (const [doc, list] of Object.entries(this._settle)) {
      if (doc !== path && !doc.startsWith(pre)) continue;
      const kept = list.filter((x) => now - x.t < SETTLE_MS && !sameVal(getIn(this._docs[doc], x.p), x.v));
      if (kept.length) this._settle[doc] = kept; else delete this._settle[doc];
      for (const x of kept) {
        if (doc === path) { if (x.p[0] !== 'daily') setIn(next, x.p, x.v); } else if (x.p[0] === 'd' && x.p.length === 2) setIn(daily, [x.p[1]], x.v);
      }
    }
    for (const [doc, q] of Object.entries(this._out)) {
      if (doc === path) q.forEach((x) => (x.p[0] === 'daily' ? setIn(daily, x.p.slice(1), x.v) : setIn(next, x.p, x.v)));
      else if (doc.startsWith(pre)) q.forEach((x) => { if (x.p[0] === 'd' && x.p.length === 2) setIn(daily, [x.p[1]], x.v); });
    }
    next.daily = daily;
    prune(next);
    if (!Object.keys(next.daily || {}).length) delete next.daily;
    if (JSON.stringify(next) === JSON.stringify(cur)) return;
    this.state.people[w] = next;
    this.persist();
    this.emit(true);
  }

  // The body this device last wrote to a shared doc, while the server may not show it yet.
  _sharedOverlay(path, serverBody) {
    const q = this._dq[path];
    if (!q) return undefined;
    if (q.busy) return { body: q.has ? q.body : q.cur };
    if (q.done && Date.now() - q.done.t < SETTLE_MS && !sameVal(serverBody, q.done.body)) return { body: q.done.body };
    q.done = null;
    return undefined;
  }

  _applyBucket() {
    if (!this._bucket) return;
    const bucket = { ...this._bucket };
    for (const path of Object.keys(this._dq)) {
      if (!path.startsWith('bucket/')) continue;
      const id = path.slice(7);
      const o = this._sharedOverlay(path, this._bucket[id]);
      if (!o) continue;
      if (o.body == null) delete bucket[id]; else bucket[id] = o.body;
    }
    if (JSON.stringify(bucket) === JSON.stringify(this.state.shared.bucket || {})) return;
    this.state.shared.bucket = bucket;
    this.persist();
    this.emit(true);
  }

  // ── the outbox: field-level writes to a person's docs ──
  _queue(doc, p, v) {
    (this._out[doc] = this._out[doc] || []).push({ p, v: v === undefined ? null : v });
    this._saveOut();
    this._flush(doc);
  }
  _saveOut() { write(LS.outbox, Object.keys(this._out).length ? JSON.stringify(this._out) : null); }
  _flushAll() { for (const doc of Object.keys(this._out)) this._flush(doc); }
  _flush(doc) {
    if (this._busy[doc] || !this.adb) return;
    this._busy[doc] = true;
    // after this tick, so a burst of setMine calls goes out as one write
    Promise.resolve().then(() => this._drain(doc)).catch((e) => console.warn('sync write failed', e)).finally(() => {
      this._busy[doc] = false;
      if ((this._out[doc] || []).length && !this.readOnly && !this.full && this.online && !this._halt) this._flush(doc);
    });
  }

  // The whole doc as it should be: the server's copy (or, for my person doc, this device's),
  // with every queued write applied.
  _fullBody(doc) {
    const m = doc.match(/^people\/([ab])$/);
    const body = clone(this._docs[doc] || (m ? this.state.people[m[1]] : {}) || {});
    for (const x of this._out[doc] || []) putIn(body, x.p, x.v);
    return prune(body);
  }

  async _drain(doc) {
    const ref = this.adb.doc(doc);
    let tries = 0;
    for (;;) {
      const q = this._out[doc];
      if (!q || !q.length || this.readOnly || this.full || this._halt) return;
      let n;
      let call;
      if (this._exists[doc] === false) {
        // update() needs the doc to exist: create it whole
        n = q.length;
        const body = this._fullBody(doc);
        call = () => ref.set(body);
      } else {
        // A null clears a whole field. Anything queued after it must land after it, or the
        // merge would bring back what the null cleared: so a batch ends at a null.
        const iNull = q.findIndex((x) => x.v === null);
        n = iNull < 0 ? q.length : iNull + 1;
        const body = {};
        for (const x of q.slice(0, n)) putIn(body, x.p, x.v);
        call = () => ref.update(body);
      }
      try {
        await call();
      } catch (e) {
        const code = e && e.code;
        if (code === 'invalid_argument' && this._exists[doc] !== false) {
          // Either the doc doesn't exist yet (update needs one), or this viewer can't write.
          let snap = null;
          try { snap = await ref.get(); } catch { /* treat as unknown */ }
          if (snap && !snap.exists) { this._exists[doc] = false; continue; }
        }
        if (code === 'invalid_argument' || code === 'quota_exceeded' || FATAL.has(code)) { this._writeErr(e); return; }
        // unavailable, resource_exhausted or unknown: transient. Back off and retry.
        if (++tries > 5) { this._writeErr(e); setTimeout(() => this._flush(doc), 20000); return; }
        await sleep((code === 'resource_exhausted' ? 2500 : 500) * tries * (0.6 + Math.random() * 0.8));
        continue;
      }
      tries = 0;
      const t = Date.now();
      (this._settle[doc] = this._settle[doc] || []).push(...q.splice(0, n).map((x) => ({ ...x, t })));
      if (!q.length) delete this._out[doc];
      this._exists[doc] = true;
      this._saveOut();
    }
  }

  // ── shared docs: one whole-doc write in flight per doc, the latest value wins ──
  _writeDoc(path, body) {
    const q = this._dq[path] || (this._dq[path] = { busy: false, has: false, body: null, cur: null });
    q.has = true;
    q.body = body;
    if (q.busy || !this.adb) return;
    q.busy = true;
    (async () => {
      const ref = this.adb.doc(path);
      let tries = 0;
      while (q.has) {
        const b = q.body;
        q.has = false;
        q.cur = b;
        try {
          if (b == null) await ref.delete(); else await ref.set(b);
          tries = 0;
        } catch (e) {
          const code = e && e.code;
          if (code === 'invalid_argument' || code === 'quota_exceeded' || FATAL.has(code) || ++tries > 5) { this._writeErr(e); continue; }
          if (!q.has) { q.has = true; q.body = b; }
          await sleep((code === 'resource_exhausted' ? 2500 : 500) * tries * (0.6 + Math.random() * 0.8));
        }
      }
      q.busy = false;
      q.done = { body: q.cur, t: Date.now() };
      q.cur = null;
      if (path.startsWith('bucket/')) this._applyBucket();
    })();
  }

  _writeErr(e) {
    console.warn('sync write failed', e);
    const code = e && e.code;
    if (code === 'invalid_argument') this.readOnly = true;
    if (code === 'quota_exceeded') this.full = true;
    if (FATAL.has(code)) { this._halt = true; this.online = false; }
    this.emit(true);
  }

  // ── Link sync (no backend) ─────────────────────────────────────────
  async exportLink() {
    const payload = { v: 1, who: this.me, data: this.person(this.me), shared: this.state.shared };
    const code = await pack(JSON.stringify(payload));
    const url = new URL(location.href);
    url.hash = `sync=${code}`;
    url.search = '';
    return url.toString();
  }

  // Returns { ok, who, msg }
  async importCode(code) {
    let p;
    try { p = JSON.parse(await unpack(code)); } catch { return { ok: false, msg: 'That sync link looks broken.' }; }
    if (!p || !p.who || !p.data) return { ok: false, msg: 'That sync link looks broken.' };
    if (p.who === this.me) return { ok: false, msg: 'That’s your own sync link — send it to ' + this.name(this.partner) + '!' };
    const cur = this.person(p.who);
    if ((p.data.updated || 0) >= (cur.updated || 0)) this.state.people[p.who] = p.data;
    // merge shared
    const sh = p.shared || {};
    for (const [k, v] of Object.entries(sh.bucket || {})) {
      const r = this.state.shared.bucket?.[k];
      if (!r || (r.ts || 0) < (v.ts || 0)) setIn(this.state, ['shared', 'bucket', k], v);
    }
    if (sh.since && !this.state.shared.since) this.state.shared.since = sh.since;
    this.persist();
    this.emit(true);
    return { ok: true, who: p.who };
  }

  resetEverything() {
    this.state = blank();
    this.persist();
    write(LS.room, null);
    write(LS.me, null);
    this.emit();
  }
}

// ── compression helpers for link sync ─────────────────────────────────
const b64url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (str) => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function pack(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'function') {
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return 'z' + b64url(new Uint8Array(out));
  }
  return 'p' + b64url(bytes);
}

async function unpack(code) {
  const kind = code[0];
  const bytes = unb64url(code.slice(1));
  if (kind === 'z') {
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    return new TextDecoder().decode(out);
  }
  return new TextDecoder().decode(bytes);
}
