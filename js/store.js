// State + syncing.
//
// Shape:
//   { people: { a: PersonData, b: PersonData }, shared: { bucket: {id: Item}, since: 'YYYY-MM-DD' } }
//   PersonData = { packs: { [packId]: { ans: { i0: value, … }, done: ts } }, daily: { [date]: text }, updated: ts }
//
// Each person only ever writes to their own subtree, so merging two copies is
// trivial: take each person's newest copy. Shared items carry timestamps.

const LS = { state: 'jt.state.v1', me: 'jt.me', room: 'jt.room' };
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
  }

  get me() { return read(LS.me); }
  set me(v) { write(LS.me, v); this.emit(); }
  get partner() { return this.me === 'a' ? 'b' : 'a'; }
  get room() { return read(LS.room); }
  set room(v) { write(LS.room, v); }
  get cloudAvailable() { return !!(this.config.firebase && this.config.firebase.databaseURL); }

  name(who) { return this.config.names[who] || who; }
  person(who) { return this.state.people[who] || {}; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(remote = false) { for (const fn of this.listeners) fn(remote); }
  persist() { write(LS.state, JSON.stringify(this.state)); }

  // Write my own data. path is relative to people[me].
  setMine(path, value) {
    const me = this.me;
    const ts = Date.now();
    this._set(['people', me, ...path], value);
    this._set(['people', me, 'updated'], ts);
  }

  setShared(path, value) { this._set(['shared', ...path], value); }

  _set(path, value) {
    setIn(this.state, path, value);
    this.persist();
    this.emit();
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
