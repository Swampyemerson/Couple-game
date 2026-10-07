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
import { unpackQuat, packQuat, slerpQuat } from './util.js';

const CHUNK = 3200;
// q: the body orientation (surface-attached: up = surface normal), packed smallest-three into
// one 32-bit number and slerped; at: 1 while stuck to a surface (sticky feet).
export const FIELDS = ['x', 'y', 'z', 'yaw', 'po', 'ly', 'lp', 'v', 'wa', 'sp', 'q', 'at'];
const ANG = new Set(['yaw', 'ly', 'wa']);
const QA = [0, 0, 0, 1]; const QB = [0, 0, 0, 1]; const QO = [0, 0, 0, 1];
/** Identity orientation, packed (what an upright chameleon facing +z publishes at yaw 0). */
export const Q_ID = packQuat(0, 0, 0, 1);

function wrap(a) { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }

function quatOut(out) { unpackQuat(out.q, QO); out.qx = QO[0]; out.qy = QO[1]; out.qz = QO[2]; out.qw = QO[3]; }
/** Ring buffer of partner states; sample(at, out) interpolates without allocating (q by slerp). */
export function createRemoteBuffer(size = 40) {
  const F = FIELDS.length;
  const t = new Float64Array(size);
  const v = new Float64Array(size * F);
  let head = 0; let count = 0;
  // sampling stats (tests / tuning): interpolated, extrapolated past the newest sample (while the
  // partner moves), held at the cap (moving), past the newest of a still pair (harmless)
  const stats = { interp: 0, extra: 0, held: 0, still: 0 };
  return {
    stats,
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
      if (a < 0) { for (let f = 0; f < F; f++) out[FIELDS[f]] = v[b * F + f]; quatOut(out); return true; }
      let k;
      if (a === newest) {
        if (count < 2) { for (let f = 0; f < F; f++) out[FIELDS[f]] = v[a * F + f]; quatOut(out); return true; }
        const p = (a - 1 + size) % size;
        if (v[a * F] === v[p * F] && v[a * F + 1] === v[p * F + 1] && v[a * F + 2] === v[p * F + 2]) stats.still++;
        else if (at - t[a] > maxExtra) stats.held++; else stats.extra++;
        const over = Math.min(at - t[a], maxExtra);
        k = 1 + over / Math.max(1, t[a] - t[p]);
        b = a; a = p;
      } else { k = (at - t[a]) / Math.max(1, t[b] - t[a]); stats.interp++; }
      for (let f = 0; f < F; f++) {
        const name = FIELDS[f]; const x0 = v[a * F + f]; const x1 = v[b * F + f];
        if (name === 'po' || name === 'v' || name === 'at') out[name] = k < 0.5 && a !== b ? x0 : x1;
        else if (name === 'q') {
          unpackQuat(x0, QA); unpackQuat(x1, QB);
          slerpQuat(QA, QB, k < 0 ? 0 : k > 1.6 ? 1.6 : k, QO);
          out.qx = QO[0]; out.qy = QO[1]; out.qz = QO[2]; out.qw = QO[3]; out.q = x1;
        }
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
  // Adaptive interpolation delay. The partner is drawn at (now − delay) on the shared clock, so
  // delay has to cover the one-way trip PLUS the gap to the next sample, or the buffer runs dry
  // and extrapolates (overshoot on every stop, snap back on every turn). A fixed 100 ms did that
  // on half the frames of a 60 ms link. Each accepted sample records what it needed
  // (its age on arrival + the sender-side gap since the previous one; idle keepalive gaps count
  // as one nominal interval); the delay follows the 2nd-highest of the last 40 (≈ p95) + 10 ms,
  // between `delay` and DELAY_MAX, rising at 80 ms/s and falling at 25 ms/s (the drawn clock runs
  // at 0.92–1.03× while it adapts: invisible). net.delay is kept equal, so lag compensation
  // (net.remote) samples exactly what was drawn.
  let DELAY_MAX = 250;
  const need = new Float64Array(40);
  const dly = { n: 0, i: 0, prevT: 0, has: false, target: delay, cur: delay, at: 0 };
  function dlyReset() { dly.n = 0; dly.i = 0; dly.has = false; dly.target = delay; dly.cur = delay; dly.at = 0; }
  function dlyNeed(T) {
    const age = linkNow() - T;
    const gap = dly.has ? T - dly.prevT : 50; dly.prevT = T; dly.has = true;
    need[dly.i] = age + (gap > 0 && gap <= 130 ? gap : 50); dly.i = (dly.i + 1) % need.length; if (dly.n < need.length) dly.n++;
    if (dly.n < 6) return;
    let m1 = -Infinity; let m2 = -Infinity;
    for (let i = 0; i < dly.n; i++) { const x = need[i]; if (x > m1) { m2 = m1; m1 = x; } else if (x > m2) m2 = x; }
    dly.target = Math.min(DELAY_MAX, Math.max(delay, m2 + 10));
  }
  function dlySlew() {
    const t = performance.now(); const dt = dly.at ? Math.min(0.1, (t - dly.at) / 1000) : 0; dly.at = t;
    if (dly.cur < dly.target) dly.cur = Math.min(dly.target, dly.cur + 80 * dt);
    else if (dly.cur > dly.target) dly.cur = Math.max(dly.target, dly.cur - 25 * dt);
    if (net) net.delay = dly.cur;
  }
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
  const retired = new Set();
  // Fast clock refinement (guest): net.js converges slowly when the first few pings are noisy,
  // so we keep our own min-RTT NTP estimate of the host clock, independent of net.js's offset.
  const clk = { off: 0, n: 0, samples: [], id: 0, sent: new Map(), timer: 0, offs: [] };
  const hostNow = () => (net ? net.now() : performance.now());
  /** The shared clock as the game reads it (see now() below). */
  function linkNow() {
    if (!net) return performance.now();
    if (local || api.isHost || clk.n < 3) return net.now();
    return performance.now() + clk.off;
  }
  function clockReset() {
    clk.off = 0; clk.n = 0; clk.samples.length = 0; clk.sent.clear();
    clearTimeout(clk.timer); clk.timer = 0;
    clk.offs.forEach((f) => { try { f(); } catch { /* ignore */ } }); clk.offs.length = 0;
  }
  function clockStart() {
    clockReset();
    if (local) return;
    if (api.isHost) {
      clk.offs.push(api.on(ns + 'tq', (d) => { if (d && typeof d.id === 'number') api.send(ns + 'ta', { id: d.id, h: hostNow() }); }));
      return;
    }
    clk.offs.push(api.on(ns + 'ta', (d) => {
      if (!d || !clk.sent.has(d.id)) return;
      const t0 = clk.sent.get(d.id); clk.sent.delete(d.id);
      const t1 = performance.now(); const rtt = t1 - t0;
      clk.samples.push({ rtt, off: d.h + rtt / 2 - t1 });
      if (clk.samples.length > 12) clk.samples.shift();
      const best = clk.samples.slice().sort((x, y) => x.rtt - y.rtt).slice(0, 3);
      clk.off = best.reduce((s, x) => s + x.off, 0) / best.length;
      clk.n++;
    }));
    let k = 0;
    const tick = () => {
      if (dead) return;
      const id = ++clk.id; clk.sent.set(id, performance.now());
      if (clk.sent.size > 16) clk.sent.delete(clk.sent.keys().next().value);
      api.send(ns + 'tq', { id });
      k++;
      clk.timer = setTimeout(tick, k < 8 ? 160 : k < 20 ? 1200 : 4000);
    };
    tick();
  }
  function makeNet() {
    if (net) { try { net.destroy(); } catch { /* ignore */ } }
    if (rawOff) { try { rawOff(); } catch { /* ignore */ } rawOff = null; }
    rb.clear(); dlyReset();
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
        if (s.__t > rb.latestTime()) dlyNeed(s.__t);
        rb.push(s.__t, s);
      });
    }
    n.on('g', (m, at) => { if (!local) lastHeard = performance.now(); dispatch(m, at); });
    net = n;
    clockStart();
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
      if (retired.has(d.s)) return; // a late hello from a session that has since been replaced
      if (d.s !== partner) {
        const had = partner != null;
        if (had) retired.add(partner);
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
    /** Shared game clock: the host's net.js clock; guests use the refined estimate once it has 3 samples. */
    now: linkNow,
    get clockSamples() { return clk.n; },
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
    /** Interpolated partner state at (now − delay) into out; false if none yet. Call once a frame: it also eases the adaptive delay. */
    sample(out, at) { if (net && !local) dlySlew(); return rb.sample((at ?? (net ? net.now() : 0)) - (net ? net.delay : delay), out); },
    /** The adaptive delay's target and current value (ms). */
    get delayTarget() { return dly.target; },
    /** Tests / tuning: cap the adaptive delay (cap = the base delay → the old fixed delay). */
    setDelayMax(ms) { DELAY_MAX = Math.max(delay, ms); dly.target = Math.min(dly.target, DELAY_MAX); dly.cur = Math.min(dly.cur, DELAY_MAX); },
    remoteCount() { return rb.count; },
    /** Interpolation stats (tests / tuning): frames interpolated, extrapolated, held at the cap. */
    get interpStats() { return rb.stats; },
    /** Lag compensation: the partner as drawn at shotTime (net.remote), validated against our session. */
    remoteAt(shotTime, out) {
      if (!net) return false;
      const s = net.remote(shotTime);
      if (s && s.k === partner && s.p === sess) { for (const f of FIELDS) out[f] = typeof s[f] === 'number' ? s[f] : 0; quatOut(out); return true; }
      return rb.sample(shotTime - net.delay, out);
    },
    pending() { return net ? net.pendingReliable() : 0; },
    destroy() {
      dead = true;
      offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
      timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
      if (rawOff) { try { rawOff(); } catch { /* ignore */ } }
      clockReset();
      if (net) { try { net.destroy(); } catch { /* ignore */ } }
      net = null;
      inBlobs.clear();
    },
  };
}
