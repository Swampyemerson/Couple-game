// Netcode wrapper around net.js for Blend & Seek.
//
// Why a wrapper: net.js numbers reliable messages per sender session and its clock is anchored
// at creation. If one device remounts (reload, rejoin), the other side would keep waiting for
// old sequence numbers and the clock offset would be stale. So each mount gets a session id,
// devices greet each other with raw `chi` messages, and net.js runs on a channel namespaced by
// BOTH session ids. A new partner session → a fresh net.js instance (fresh clock sync, fresh
// sequence numbers) → the game pauses, resyncs from a snapshot and resumes.
//
// Also: chunked reliable blobs (paint textures, snapshots) and an allocation-free interpolation
// buffer for the partner's avatar (net.remote() allocates; we use it only for lag compensation).
import { createNet } from '../net.js';

const CHUNK = 3200;
export const FIELDS = ['x', 'y', 'z', 'yaw', 'po', 'ly', 'lp', 'v', 'wa', 'sp'];
const ANG = new Set(['yaw', 'ly', 'wa']);

function wrap(a) { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }

/** Ring buffer of partner states; sample(at, out) interpolates without allocating. */
export function createRemoteBuffer(size = 40) {
  const F = FIELDS.length;
  const t = new Float64Array(size);
  const v = new Float64Array(size * F);
  let head = 0; let count = 0;
  return {
    clear() { head = 0; count = 0; },
    get count() { return count; },
    push(time, s) {
      if (count && time <= t[(head - 1 + size) % size]) return;
      t[head] = time;
      for (let f = 0; f < F; f++) { const x = s[FIELDS[f]]; v[head * F + f] = typeof x === 'number' ? x : 0; }
      head = (head + 1) % size; if (count < size) count++;
    },
    latestTime() { return count ? t[(head - 1 + size) % size] : -Infinity; },
    sample(at, out, maxExtra = 160) {
      if (!count) return false;
      const newest = (head - 1 + size) % size;
      let a = -1; let b = newest;
      for (let k = 0; k < count; k++) {
        const i = (head - 1 - k + size * 2) % size;
        if (t[i] <= at) { a = i; break; }
        b = i;
      }
      if (a < 0) { for (let f = 0; f < F; f++) out[FIELDS[f]] = v[b * F + f]; return true; }
      let k;
      if (a === newest) {
        if (count < 2) { for (let f = 0; f < F; f++) out[FIELDS[f]] = v[a * F + f]; return true; }
        const p = (a - 1 + size) % size;
        const over = Math.min(at - t[a], maxExtra);
        k = 1 + over / Math.max(1, t[a] - t[p]);
        b = a; a = p;
      } else k = (at - t[a]) / Math.max(1, t[b] - t[a]);
      for (let f = 0; f < F; f++) {
        const name = FIELDS[f]; const x0 = v[a * F + f]; const x1 = v[b * F + f];
        if (name === 'po' || name === 'v') out[name] = k < 0.5 && a !== b ? x0 : x1;
        else if (ANG.has(name)) out[name] = x0 + wrap(x1 - x0) * k;
        else out[name] = x0 + (x1 - x0) * k;
      }
      return true;
    },
  };
}

export function createLink(api, { delay = 100, onLink = () => {}, onUnlink = () => {} } = {}) {
  const local = api.mode !== 'live';
  const sess = Math.random().toString(36).slice(2, 10);
  let partner = null;
  let net = null;
  let ready = local;
  let epoch = 0;
  let dead = false;
  let lastHeard = performance.now();
  let lastChi = 0;
  const handlers = Object.create(null);
  const blobH = Object.create(null);
  const inBlobs = new Map();
  let blobSeq = 0;
  const offs = [];
  const timers = [];
  const rb = createRemoteBuffer();
  const pubState = { k: sess, p: '' };
  for (const f of FIELDS) pubState[f] = 0;
  let sent = 0; // reliable sends (for budget tests)

  function dispatch(m, at) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === '__b') { onChunk(m.d); return; }
    const hs = handlers[m.t];
    if (hs) hs.forEach((fn) => { try { fn(m.d, at); } catch (e) { console.error('chameleon', m.t, e); } });
  }
  function onChunk(c) {
    if (!c || typeof c.id !== 'string') return;
    let b = inBlobs.get(c.id);
    if (!b) { b = { n: c.n, parts: new Array(c.n), got: 0, k: c.k, m: null }; inBlobs.set(c.id, b); }
    if (c.m !== undefined) b.m = c.m;
    if (b.parts[c.i] === undefined) { b.parts[c.i] = c.c; b.got++; }
    if (b.got === b.n) {
      inBlobs.delete(c.id);
      const fn = blobH[b.k];
      if (fn) { try { fn(b.parts.join(''), b.m); } catch (e) { console.error('chameleon blob', b.k, e); } }
    }
  }

  let rawOff = null;
  let ns = '';
  function makeNet() {
    if (net) { try { net.destroy(); } catch { /* ignore */ } }
    if (rawOff) { try { rawOff(); } catch { /* ignore */ } rawOff = null; }
    rb.clear();
    ready = false;
    const myEpoch = ++epoch;
    let n;
    if (local) n = createNet(api, { delay });
    else {
      ns = `c.${[sess, partner].sort().join('.')}.`;
      // unreliable fast path (redundant copies of time-critical messages; handlers dedupe)
      rawOff = api.on(ns + 'g!', (m) => { lastHeard = performance.now(); dispatch(m, null); });
      const proxy = {
        mode: api.mode, isHost: api.isHost,
        send: (t, d) => api.send(ns + t, d),
        on: (t, fn) => api.on(ns + t, fn),
        setPresence: (o) => api.setPresence(o),
        onPartnerState: (fn) => api.onPartnerState(fn),
      };
      n = createNet(proxy, { delay, rate: 20, angles: ['yaw', 'ly', 'wa'] });
      n.onRemote((s) => {
        if (!s || s.k !== partner || s.p !== sess) return;
        lastHeard = performance.now();
        rb.push(s.__t, s);
      });
    }
    n.on('g', (m, at) => { if (!local) lastHeard = performance.now(); dispatch(m, at); });
    net = n;
    n.ready.then(() => {
      if (dead || net !== n || epoch !== myEpoch) return;
      ready = true;
      onLink(myEpoch);
    });
  }

  function chi() {
    if (dead || local) return;
    lastChi = performance.now();
    api.send('chi', { s: sess, p: partner, h: !!api.isHost });
  }

  if (local) {
    makeNet();
  } else {
    offs.push(api.on('chi', (d) => {
      if (dead || !d || typeof d.s !== 'string') return;
      lastHeard = performance.now();
      if (d.s !== partner) {
        const had = partner != null;
        partner = d.s;
        pubState.p = partner;
        if (had) onUnlink('remount');
        makeNet();
      }
      if (d.p !== sess && performance.now() - lastChi > 150) chi();
    }));
    chi();
    const iv = setInterval(() => { if (!ready || performance.now() - lastChi > 1900) chi(); }, 450);
    timers.push(iv);
  }

  return {
    get local() { return local; },
    get ready() { return ready; },
    get epoch() { return epoch; },
    get sess() { return sess; },
    get partner() { return partner; },
    get rtt() { return net ? net.rtt : 0; },
    get delay() { return net ? net.delay : delay; },
    get sent() { return sent; },
    /** Milliseconds since anything arrived from the partner. */
    get silence() { return local ? 0 : performance.now() - lastHeard; },
    now() { return net ? net.now() : performance.now(); },
    send(type, data) { if (!net) return false; sent++; net.send('g', { t: type, d: data ?? null }); return true; },
    /** Two unreliable copies right now (not held back by in-order delivery). Use for idempotent messages. */
    blast(type, data) {
      if (!net || local) return;
      const m = { t: type, d: data ?? null }; const space = ns;
      api.send(space + 'g!', m);
      const t = setTimeout(() => { if (!dead && ns === space) api.send(space + 'g!', m); }, 70);
      timers.push(t);
      if (timers.length > 64) timers.splice(1, 20);
    },
    on(type, fn) { (handlers[type] = handlers[type] || new Set()).add(fn); return () => handlers[type].delete(fn); },
    onBlob(kind, fn) { blobH[kind] = fn; },
    /** Reliable chunked string (≤ 3.2 KB per message). */
    sendBlob(kind, str, meta) {
      if (!net) return 0;
      const id = `${sess}-${++blobSeq}`;
      const n = Math.max(1, Math.ceil(str.length / CHUNK));
      for (let i = 0; i < n; i++) { sent++; net.send('g', { t: '__b', d: { id, i, n, k: kind, m: i === 0 ? (meta ?? null) : undefined, c: str.slice(i * CHUNK, (i + 1) * CHUNK) } }); }
      return n;
    },
    /** Publish my avatar (rate-limited inside net.js). st: object with FIELDS. */
    publish(st) {
      if (!net || local) return;
      for (let i = 0; i < FIELDS.length; i++) pubState[FIELDS[i]] = st[FIELDS[i]];
      net.publish(pubState);
    },
    /** Interpolated partner state at (now - delay) into out; false if none yet. */
    sample(out, at) { return rb.sample((at ?? (net ? net.now() : 0)) - (net ? net.delay : delay), out); },
    remoteCount() { return rb.count; },
    /** Lag compensation: the partner as drawn at shotTime (net.remote), validated against our session. */
    remoteAt(shotTime, out) {
      if (!net) return false;
      const s = net.remote(shotTime);
      if (s && s.k === partner && s.p === sess) { for (const f of FIELDS) out[f] = typeof s[f] === 'number' ? s[f] : 0; return true; }
      return rb.sample(shotTime - net.delay, out);
    },
    pending() { return net ? net.pendingReliable() : 0; },
    destroy() {
      dead = true;
      offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
      timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
      if (rawOff) { try { rawOff(); } catch { /* ignore */ } }
      if (net) { try { net.destroy(); } catch { /* ignore */ } }
      net = null;
      inBlobs.clear();
    },
  };
}
