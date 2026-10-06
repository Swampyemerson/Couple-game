// Rail Rush netcode wrapper over js/games/net.js.
//
// From net.js: the shared clock (net.now / rtt / ready), throttled presence streaming
// (net.publish), raw partner states (net.onRemote) and lag-compensated sampling (net.remote(at)).
// Added here, because the game needs them and net.js doesn't have them:
//  - an allocation-free interpolation buffer (typed arrays, fixed field list) for per-frame drawing;
//  - a reliable channel that is addressed per partner *instance*: if the partner re-mounts mid
//    match, its fresh instance gets a fresh sequence instead of waiting forever for numbers it
//    never saw (net.send can't recover from a receiver reload);
//  - partner-instance detection, staleness (no state for N ms) and a clock reset for host reloads.
import { createNet } from '../net.js';

/** Fields streamed at 20/s. [name, lerp?] — everything is a number. */
export const FIELDS = [
  ['z', 1], ['x', 1], ['y', 1], ['g', 1], ['vy', 1], ['sp', 1], ['st', 1], ['dt', 1], ['rt', 1], ['rp', 1],
  ['l', 0], ['p', 0], ['f', 0], ['h', 0], ['c', 0], ['fn', 0], ['ph', 0], ['md', 0], ['sy', 0], ['pz', 0],
  ['ra', 0], ['th', 0], ['tg', 0], ['rd', 0], ['w', 0], ['sv', 0], ['cb', 0], ['tc', 0], ['ep', 0],
];
const K = FIELDS.length;
const LERP = Uint8Array.from(FIELDS.map((f) => f[1]));
const NAMES = FIELDS.map((f) => f[0]);
const RING = 40;

export function emptyState() {
  const o = {};
  for (const n of NAMES) o[n] = 0;
  o.fn = -1;
  return o;
}

function makeRing() {
  return { t: new Float64Array(RING), v: new Float64Array(RING * K), head: 0, n: 0 };
}

export function createLink(api, { delay = 100 } = {}) {
  const iid = Math.random().toString(36).slice(2, 10);
  let net = null;
  let offRemote = null;
  let partnerIid = null;
  let lastRaw = 0;
  let rawLatest = null;
  const ring = makeRing();
  const newFns = new Set();
  const handlers = {};
  const offs = [];
  const timers = [];
  let dead = false;

  function onRaw(s) {
    if (!s || typeof s !== 'object') return;
    lastRaw = performance.now();
    rawLatest = s;
    if (typeof s.i === 'string') learn(s.i);
    const t = s.__t;
    if (typeof t !== 'number') return;
    const last = ring.n ? ring.t[(ring.head + ring.n - 1) % RING] : -Infinity;
    let slot;
    if (ring.n && t <= last) {
      if (t !== last) return;
      slot = (ring.head + ring.n - 1) % RING;
    } else if (ring.n < RING) { slot = (ring.head + ring.n) % RING; ring.n++; }
    else { slot = ring.head; ring.head = (ring.head + 1) % RING; }
    ring.t[slot] = t;
    const o = slot * K;
    for (let k = 0; k < K; k++) { const v = s[NAMES[k]]; ring.v[o + k] = typeof v === 'number' ? v : 0; }
  }
  function initNet() {
    net = createNet(api, { delay, rate: 20 });
    offRemote = net.onRemote(onRaw);
  }
  initNet();

  // ── reliable channel, addressed per instance ──
  let outSeq = 0;
  const outbox = new Map();
  let inFrom = null;
  let inNext = 1;
  const hold = new Map();
  function learn(pid) {
    if (pid === partnerIid) return;
    const was = partnerIid;
    partnerIid = pid;
    if (was) { outbox.clear(); outSeq = 0; }
    newFns.forEach((fn) => { try { fn(pid, was); } catch (e) { console.error(e); } });
  }
  function deliver(type, data, at) {
    const hs = handlers[type];
    if (hs) hs.forEach((fn) => { try { fn(data, at); } catch (e) { console.error(e); } });
  }
  function flush() {
    if (dead) return;
    const t = performance.now();
    for (const [s, m] of outbox) {
      if (t < m.next) continue;
      if (m.tries++ > 160) { outbox.delete(s); continue; }
      m.next = t + 260 * Math.min(4, 1 + m.tries * 0.5);
      api.send('rr', { f: iid, t: partnerIid || '', s, ty: m.type, d: m.data, at: m.at });
    }
  }
  offs.push(api.on('rr', (d) => {
    if (!d || typeof d.f !== 'string' || !Number.isInteger(d.s)) return;
    if (d.t && d.t !== iid) return; // meant for an earlier instance of this game
    learn(d.f);
    api.send('ra', { f: iid, t: d.f, s: d.s });
    if (d.f !== inFrom) { inFrom = d.f; inNext = 1; hold.clear(); }
    if (d.s < inNext || hold.has(d.s)) return;
    hold.set(d.s, d);
    while (hold.has(inNext)) { const m = hold.get(inNext); hold.delete(inNext); inNext++; deliver(m.ty, m.d, m.at); }
  }));
  offs.push(api.on('ra', (d) => { if (d && d.t === iid) outbox.delete(d.s); }));
  timers.push(setInterval(flush, 90));

  const link = {
    iid,
    get partner() { return partnerIid; },
    get net() { return net; },
    get rtt() { return net.rtt; },
    get synced() { return net.synced; },
    get ready() { return net.ready; },
    get delay() { return net.delay; },
    now: () => net.now(),
    /** Reliable, ordered, exactly once to the current partner instance. */
    send(type, data) {
      const s = ++outSeq;
      outbox.set(s, { type: String(type), data: data ?? null, at: net.now(), tries: 0, next: 0 });
      flush();
    },
    on(type, fn) { (handlers[type] = handlers[type] || new Set()).add(fn); return () => handlers[type].delete(fn); },
    /** Stream my state (an object you reuse; numbers only, plus i = my instance id). */
    publish(state) { state.i = iid; net.publish(state); },
    /** Interpolate the partner at shared time `at` into `out` (no allocation). False if no data. */
    sample(out, at) {
      if (!ring.n) return false;
      const n = ring.n; const h = ring.head; const T = ring.t;
      let a = -1;
      if (at <= T[h % RING]) a = -2;
      else for (let i = n - 2; i >= 0; i--) { if (at >= T[(h + i) % RING]) { a = i; break; } }
      if (a === -2 || n === 1) {
        const o = ((h + (a === -2 ? 0 : n - 1)) % RING) * K;
        for (let k = 0; k < K; k++) out[NAMES[k]] = ring.v[o + k];
        return true;
      }
      let i0; let i1; let u;
      if (a >= 0 && a < n - 1 && at <= T[(h + a + 1) % RING]) { i0 = a; i1 = a + 1; u = (at - T[(h + a) % RING]) / Math.max(1, T[(h + a + 1) % RING] - T[(h + a) % RING]); }
      else {
        // newer than everything: extrapolate a little from the last two
        i0 = n - 2; i1 = n - 1;
        const t1 = T[(h + i1) % RING]; const t0 = T[(h + i0) % RING];
        const over = Math.min(at - t1, 160);
        u = 1 + over / Math.max(1, t1 - t0);
      }
      const o0 = ((h + i0) % RING) * K; const o1 = ((h + i1) % RING) * K;
      for (let k = 0; k < K; k++) {
        const v0 = ring.v[o0 + k]; const v1 = ring.v[o1 + k];
        out[NAMES[k]] = LERP[k] ? v0 + (v1 - v0) * u : v1;
      }
      return true;
    },
    /** Newest raw partner state (or null). */
    latest: () => rawLatest,
    /** ms since the partner's last state arrived. */
    age: () => (lastRaw ? performance.now() - lastRaw : Infinity),
    /** Partner state at shared time T via net.remote (lag compensation; allocates, use rarely). */
    remoteAtTime(T) { return net.remote(T + net.delay); },
    onPartnerNew(fn) { newFns.add(fn); return () => newFns.delete(fn); },
    pending: () => outbox.size,
    /** Fresh clock + buffers (when the host reloaded and its clock restarted). */
    resetNet() {
      try { offRemote && offRemote(); net.destroy(); } catch { /* ignore */ }
      ring.n = 0; ring.head = 0; rawLatest = null;
      initNet();
    },
    clearRemote() { ring.n = 0; ring.head = 0; },
    destroy() {
      dead = true;
      offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
      timers.forEach((t) => clearInterval(t));
      try { offRemote && offRemote(); net.destroy(); } catch { /* ignore */ }
      outbox.clear();
    },
  };
  return link;
}
