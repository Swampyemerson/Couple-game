// Rail Rush netcode wrapper over js/games/net.js.
//
// From net.js: the shared clock (net.now / rtt / ready), throttled presence streaming
// (net.publish), raw partner states (net.onRemote) and lag-compensated sampling (net.remote(at)).
// Added here, because the game needs them and net.js doesn't have them:
//  - an allocation-free interpolation buffer (typed arrays, fixed field list) for per-frame drawing;
//  - a reliable channel that is addressed per partner *instance*: if the partner re-mounts mid
//    match, its fresh instance gets a fresh sequence instead of waiting forever for numbers it
//    never saw (net.send can't recover from a receiver reload);
//  - partner-instance detection, staleness (no state for N ms) and a clock reset for host reloads;
//  - a precision clock on top of net.now(): the guest pings in bursts before a start (net.js pings
//    every 2 s and keeps 10 samples, which under a busy main thread can leave a 100 ms+ error),
//    keeps the lowest-RTT samples, and both sides stamp their stream with this clock.
import { createNet } from '../net.js';

/** Fields streamed at 20/s. [name, lerp?] — everything is a number. */
export const FIELDS = [
  ['z', 1], ['x', 1], ['y', 1], ['g', 1], ['vy', 1], ['sp', 1], ['st', 1], ['dt', 1], ['rt', 1], ['rp', 1],
  ['l', 0], ['p', 0], ['f', 0], ['h', 0], ['c', 0], ['fn', 0], ['ph', 0], ['md', 0], ['sy', 0], ['pz', 0],
  ['ra', 0], ['th', 0], ['tg', 0], ['rd', 0], ['w', 0], ['sv', 0], ['cb', 0], ['tc', 0], ['ep', 0],
  ['tr', 0], ['ht', 0], // worn trail / hat (unlockable style)
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
    const t = typeof s.ts === 'number' ? s.ts : s.__t;
    if (typeof t !== 'number') return;
    const last = ring.n ? ring.t[(ring.head + ring.n - 1) % RING] : -Infinity;
    let slot;
    if (ring.n && t <= last) {
      if (t === last) slot = (ring.head + ring.n - 1) % RING;
      else if (last - t > 1000) { ring.n = 1; ring.head = 0; slot = 0; } // their clock restarted: start over
      else return; // late or duplicate
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

  // ── precision clock ──
  const host = !!api.isHost;
  const base = performance.now();
  const local = () => performance.now() - base;
  let off = null;           // guest: host clock − local clock
  let pingId = 0;
  const pend = new Map();
  const csamp = [];         // { rtt, off }
  // Ping level: 2 = burst (~8/s: not yet synced, countdown, pauses), 1 = lobby (~2.7/s), 0 = running (~1/s).
  // Keeps each device well inside the ~40 messages/s room budget next to 20 presence/s.
  let fast = 2;
  let pingTick = 0;
  let lastReply = 0;
  const now = () => (host ? net.now() : off == null ? net.now() : local() + off);
  function cping() {
    if (dead || host) return;
    pingTick++;
    const lvl = csamp.length < 8 ? 2 : fast;
    if (lvl === 1 && pingTick % 3) return;
    if (lvl === 0 && pingTick % 8) return;
    const id = ++pingId;
    pend.set(id, local());
    if (pend.size > 30) pend.delete(pend.keys().next().value);
    api.send('cq', { id, f: iid });
  }
  // Host: answer at most ~11 pings a second. After a stall (a busy main thread, the app in the
  // background) the queued ones would otherwise all be answered in one burst, over budget, and
  // their timings are useless anyway.
  if (host) offs.push(api.on('cq', (d) => {
    if (!d || typeof d.f !== 'string') return;
    const t = performance.now();
    if (t - lastReply < 90) return;
    lastReply = t;
    api.send('cp', { id: d.id, f: d.f, th: net.now() });
  }));
  else {
    offs.push(api.on('cp', (d) => {
      if (!d || d.f !== iid || !pend.has(d.id)) return;
      const t0 = pend.get(d.id); pend.delete(d.id);
      const t1 = local();
      csamp.push({ rtt: t1 - t0, off: d.th - (t0 + t1) / 2 });
      if (csamp.length > 60) csamp.shift();
      if (csamp.length < 4) return;
      const best = csamp.slice().sort((x, y) => x.rtt - y.rtt).slice(0, 5).map((x) => x.off).sort((x, y) => x - y);
      const est = best[Math.floor(best.length / 2)];
      if (off == null || fast === 2 || Math.abs(est - off) > 40) off = est;
      else off += (est - off) * 0.3; // slew gently while running
    }));
    timers.push(setInterval(cping, 120));
  }

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
    // A new partner instance stamps its stream on a new timeline. Drop the old instance's samples,
    // or a stale presence left over from before a rematch (stamped later on the old timeline) would
    // make every fresh sample look "late" and freeze the partner for minutes.
    ring.n = 0; ring.head = 0;
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
    get rtt() { if (host || !csamp.length) return net.rtt; let m = Infinity; for (const x of csamp) if (x.rtt < m) m = x.rtt; return Math.round(m); },
    get synced() { return host ? net.synced : csamp.length >= 8 && off != null; },
    /** Clock ping level: 2 burst (countdown, pauses), 1 lobby, 0 running. */
    setFastSync(level) { fast = level === true ? 2 : level === false ? 0 : level | 0; },
    get ready() { return net.ready; },
    get delay() { return net.delay; },
    now,
    /** Reliable, ordered, exactly once to the current partner instance. */
    send(type, data) {
      const s = ++outSeq;
      outbox.set(s, { type: String(type), data: data ?? null, at: now(), tries: 0, next: 0 });
      flush();
    },
    on(type, fn) { (handlers[type] = handlers[type] || new Set()).add(fn); return () => handlers[type].delete(fn); },
    /** Stream my state (an object you reuse; numbers only, plus i = my instance id). */
    publish(state) { state.i = iid; state.ts = Math.round(now()); net.publish(state); },
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
    remoteAtTime(T) {
      const s = net.remote(T + net.delay);
      return s && s.i === partnerIid ? s : null; // net.js's buffer may still hold a previous instance's state
    },
    onPartnerNew(fn) { newFns.add(fn); return () => newFns.delete(fn); },
    pending: () => outbox.size,
    /** Fresh clock + buffers (when the host reloaded and its clock restarted). */
    resetNet() {
      try { offRemote && offRemote(); net.destroy(); } catch { /* ignore */ }
      ring.n = 0; ring.head = 0; rawLatest = null;
      csamp.length = 0; off = null; pend.clear();
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
