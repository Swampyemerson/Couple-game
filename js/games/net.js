// Netcode kit for live games, built on the live `api` from core.js.
//
//   import { createNet } from './net.js';
//   const net = createNet(api);           // once per mount; net.destroy() in your destroy()
//   await net.ready;                      // first clock sync done (instant on one device)
//
// Shared clock
//   net.now()      ms on a timeline both devices agree on (the host's clock). Guests estimate
//                  the offset with NTP-style pings, keeping the lowest-latency samples: a quick
//                  burst at start (ready in ~3 round trips), then one every 2 s. If the host's
//                  clock jumps (it re-mounted), the guest notices and re-syncs.
//   net.rtt        smoothed round-trip time in ms (0 on one device).
//
// Reliable events (room events can drop; these can't)
//   net.send(type, data)   delivered exactly once, in order, retried until acknowledged. Messages
//                          due together travel in one room event (≤ ~3.5 KB) and acks are
//                          cumulative, so a burst costs a few events, not one per message.
//                          A receiver that re-mounts or reloads mid-stream picks up from the
//                          oldest message still unacknowledged instead of waiting forever.
//   net.on(type, fn)       fn(data, sentAt) — sentAt is the sender's net.now() when sent.
//   net.reset()            start a fresh session after the partner re-mounted (or you want a clean
//                          slate): new outgoing stream, inbound state, partner buffer and (guest)
//                          a quick clock re-sync. Unsent reliable messages are dropped.
//
// State streaming with interpolation
//   net.publish(state)     your continuous state (stamped with net.now()), sent at most `rate`
//                          times/s (default 20). Call it every frame; extra calls are dropped.
//                          Absolute values only, ≤ 3.5 KB.
//   net.remote(at?)        partner's state interpolated at net.now() - net.delay (smooth even
//                          at 20-30 updates/s with jitter); extrapolates briefly when data is late.
//                          Allocates a fresh object: fine for rare lag-compensation lookups.
//   net.remoteInto(out, at?)  the same, written into `out` (numbers lerped in place, nested objects
//                          and arrays reused): allocation-free for per-frame drawing. Returns `out`,
//                          or null before the first partner state.
//   net.remoteLatest()     newest raw partner state.
//   net.onRemote(fn)       every raw partner update.
//   net.delay              interpolation delay in ms (default 100). Raise for smoother, lower for snappier.
//
// Helpers
//   net.buffer({ delay, angles })   your own interpolation buffer: push(t, state), sample(t),
//                                   sampleInto(t, out).
//   lerpState(a, b, k, angles)      numeric fields lerp (recursively); others snap to b.
//   lerpInto(out, a, b, k, angles)  the same into `out`, allocation-free once `out` has its shape.
//
// Uses only api.mode, api.isHost, api.send, api.on, api.setPresence and api.onPartnerState,
// so a game may hand it a proxy (e.g. to namespace topics).
//
// Authority: there's no global server. The usual pattern is "each player is the authority
// for their own avatar" (publish it; render the partner via net.remote()), and the host
// (api.isHost) decides shared things (round start, scores) and announces them with net.send.

const PING_EVERY = 2000;
const RESEND_MS = 280;
const MAX_TRIES = 40;
const BATCH_BYTES = 3500; // one room event carries at most 4 KB

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

function lerpAngle(a, b, k) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** Interpolate two states: numbers lerp (angles by shortest arc), objects recurse, else b. */
export function lerpState(a, b, k, angles = []) {
  if (isNum(a) && isNum(b)) return a + (b - a) * k;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return b.map((v, i) => lerpState(a[i], v, k, angles));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = {};
    for (const key of Object.keys(b)) {
      out[key] = angles.includes(key) && isNum(a[key]) && isNum(b[key]) ? lerpAngle(a[key], b[key], k) : lerpState(a[key], b[key], k, angles);
    }
    return out;
  }
  return b;
}

/** lerpState written into `out`: numbers lerp (angles by shortest arc), objects and arrays
 *  recurse into out's own containers (created once), anything else is copied from b. */
export function lerpInto(out, a, b, k, angles = []) {
  if (Array.isArray(b)) {
    if (out.length !== b.length) out.length = b.length;
    for (let i = 0; i < b.length; i++) out[i] = lerpVal(out[i], a ? a[i] : undefined, b[i], k, false, angles);
    return out;
  }
  for (const key in b) out[key] = lerpVal(out[key], a ? a[key] : undefined, b[key], k, angles.includes(key), angles);
  return out;
}
function lerpVal(o, av, bv, k, angle, angles) {
  if (isNum(bv)) return isNum(av) ? (angle ? lerpAngle(av, bv, k) : av + (bv - av) * k) : bv;
  if (bv && typeof bv === 'object') {
    const arr = Array.isArray(bv);
    if (!o || typeof o !== 'object' || Array.isArray(o) !== arr) o = arr ? [] : {};
    return lerpInto(o, av && typeof av === 'object' ? av : null, bv, k, angles);
  }
  return bv;
}

/** A timestamped buffer you can sample at any time. */
export function makeBuffer({ delay = 100, angles = [], maxExtrapolate = 160, keep = 40 } = {}) {
  const snaps = []; // [{ t, s }] sorted by t
  const buf = {
    delay,
    push(t, s) {
      if (!isNum(t)) return;
      if (snaps.length && t <= snaps[snaps.length - 1].t) {
        if (t === snaps[snaps.length - 1].t) snaps[snaps.length - 1].s = s;
        return; // late or duplicate
      }
      snaps.push({ t, s });
      if (snaps.length > keep) snaps.shift();
    },
    clear() { snaps.length = 0; },
    latest() { return snaps.length ? snaps[snaps.length - 1].s : null; },
    latestTime() { return snaps.length ? snaps[snaps.length - 1].t : null; },
    /** State at time `at` (already delay-adjusted by the caller). */
    sample(at) {
      if (!pick(at)) return null;
      return pa === pb ? pa : lerpState(pa, pb, pk, angles);
    },
    /** sample(at), written into `out` without allocating. Returns out, or null when empty. */
    sampleInto(at, out) {
      if (!pick(at)) return null;
      return lerpInto(out, pa, pb, pa === pb ? 0 : pk, angles);
    },
  };
  // pick(at) finds the two snapshots around `at` and the blend between them (no allocation)
  let pa = null; let pb = null; let pk = 0;
  function pick(at) {
    if (!snaps.length) return false;
    if (snaps.length === 1 || at <= snaps[0].t) { pa = pb = snaps[0].s; pk = 0; return true; }
    for (let i = snaps.length - 1; i > 0; i--) {
      const a = snaps[i - 1]; const b = snaps[i];
      if (at >= a.t && at <= b.t) { pa = a.s; pb = b.s; pk = (at - a.t) / Math.max(1, b.t - a.t); return true; }
    }
    // Newer than everything: extrapolate from the last two, but not too far.
    const a = snaps[snaps.length - 2]; const b = snaps[snaps.length - 1];
    pa = a.s; pb = b.s; pk = 1 + Math.min(at - b.t, maxExtrapolate) / Math.max(1, b.t - a.t);
    return true;
  }
  return buf;
}

export function createNet(api, { delay = 100, angles = [], rate = 20 } = {}) {
  const local = api.mode !== 'live';
  const t0 = performance.now();
  const newSid = () => Math.random().toString(36).slice(2, 10);
  let sid = newSid();
  let offset = 0; // host time - my time
  let synced = local || api.isHost;
  let rttAvg = 0;
  const samples = []; // { rtt, offset }
  let markReady;
  const ready = new Promise((r) => { markReady = r; });
  if (synced) markReady();
  const offs = [];
  const timers = [];
  let dead = false;

  const myNow = () => performance.now() - t0;
  const now = () => myNow() + offset;

  // ── clock sync (guest asks, host answers) ──
  // A burst of pings at the start (every 90 ms until 6 samples), then one every 2 s.
  let pingId = 0;
  const pending = new Map();
  let pingT = null;
  function ping() {
    if (dead || local || api.isHost) return;
    const id = ++pingId;
    pending.set(id, myNow());
    api.send('__ping', { id });
    if (pending.size > 20) pending.delete(pending.keys().next().value);
  }
  function pingLoop(ms) {
    clearTimeout(pingT);
    pingT = setTimeout(() => {
      if (dead) return;
      ping();
      pingLoop(samples.length < 6 ? 90 : PING_EVERY);
    }, ms);
  }
  function onSample(rtt, so) {
    // A sample far off the current estimate means the host's clock restarted (it re-mounted):
    // start over rather than slewing towards it for half a minute.
    if (synced && samples.length >= 3 && Math.abs(so - offset) > Math.max(1000, rtt * 2)) {
      samples.length = 0;
      remoteBuf.clear();
      pingLoop(90);
    }
    samples.push({ rtt, offset: so });
    if (samples.length > 10) samples.shift();
    let best = samples[0];
    for (const x of samples) if (x.rtt < best.rtt) best = x;
    // the mean of the three quickest round trips (fewest queueing delays)
    const top = samples.length <= 3 ? samples : [...samples].sort((x, y) => x.rtt - y.rtt).slice(0, 3);
    const target = top.reduce((sum, x) => sum + x.offset, 0) / top.length;
    // While the first burst is still coming in, take the estimate as is; after that, slew
    // gently so the shared clock never jumps backwards much.
    offset = samples.length <= 6 ? target : offset + (target - offset) * 0.25;
    rttAvg = rttAvg ? rttAvg * 0.8 + rtt * 0.2 : rtt;
    if (!synced && samples.length >= 3) { synced = true; markReady(); }
  }
  if (!local) {
    offs.push(api.on('__ping', (d) => { if (api.isHost && d) api.send('__pong', { id: d.id, th: myNow() }); }));
    offs.push(api.on('__pong', (d) => {
      if (api.isHost || !d || !pending.has(d.id)) return;
      const sent = pending.get(d.id); pending.delete(d.id);
      const recv = myNow();
      const rtt = recv - sent;
      onSample(rtt, d.th + rtt / 2 - recv);
    }));
    if (!api.isHost) {
      pingLoop(30);
      timers.push(setTimeout(() => { if (!synced) { synced = true; markReady(); } }, 4000));
    }
    if (api.isHost) {
      // The host measures RTT too, for display and lag compensation.
      const hp = new Map(); let hid = 0;
      offs.push(api.on('__hpong', (d) => { if (d && hp.has(d.id)) { const r = myNow() - hp.get(d.id); hp.delete(d.id); rttAvg = rttAvg ? rttAvg * 0.8 + r * 0.2 : r; } }));
      timers.push(setInterval(() => { if (dead) return; const id = ++hid; hp.set(id, myNow()); if (hp.size > 20) hp.delete(hp.keys().next().value); api.send('__hping', { id }); }, PING_EVERY));
    }
    // The guest answers host pings.
    if (!api.isHost) offs.push(api.on('__hping', (d) => { if (d) api.send('__hpong', { id: d.id }); }));
  }

  // ── reliable events ──
  // Wire: '__r' { sid, lo, m: [[seq, type, data, at], …] }, where lo is the sender's oldest
  // unacknowledged seq: a receiver meeting this sid for the first time (it just mounted, or the
  // sender did) starts there instead of at 1. '__ra' { sid, upto, h }: everything up to `upto`
  // arrived, plus the out-of-order seqs in `h`.
  let outSeq = 0;
  const outbox = new Map(); // seq -> { type, data, at, tries, next, size }
  let inSid = null;
  let inNext = 1;
  const inHold = new Map();
  const handlers = {};
  function deliver(m) {
    (handlers[m.type] || []).forEach((fn) => { try { fn(m.data, m.at); } catch (e) { console.error(e); } });
  }
  function flush() {
    if (dead || !outbox.size) return;
    const t = myNow();
    let batch = [];
    let bytes = 0;
    let events = 0;
    const lo = outbox.keys().next().value;
    const ship = () => { if (batch.length) { api.send('__r', { sid, lo, m: batch }); events++; } batch = []; bytes = 0; };
    for (const [seq, m] of outbox) {
      if (t < m.next) continue;
      if (m.tries++ > MAX_TRIES) { outbox.delete(seq); continue; }
      m.next = t + RESEND_MS * Math.min(4, 1 + m.tries * 0.5);
      if (bytes && bytes + m.size > BATCH_BYTES) { ship(); if (events >= 2) { m.tries--; m.next = 0; break; } } // the rest go next tick
      batch.push([seq, m.type, m.data, m.at]);
      bytes += m.size;
    }
    ship();
  }
  function send(type, data) {
    if (local) { // loop back so one-device games can use the same code path
      const m = { type, data: data ?? null, at: now() };
      setTimeout(() => deliver(m), 0);
      return;
    }
    const seq = ++outSeq;
    const d = data ?? null;
    let size = 40;
    try { size += JSON.stringify(d).length + String(type).length; } catch { /* sent as is */ }
    outbox.set(seq, { type: String(type), data: d, at: now(), tries: 0, next: 0, size });
    // Several sends in one tick go out together.
    if (!flushQueued) { flushQueued = true; Promise.resolve().then(() => { flushQueued = false; flush(); }); }
  }
  let flushQueued = false;
  if (!local) {
    offs.push(api.on('__r', (d) => {
      if (!d || typeof d.sid !== 'string' || !Array.isArray(d.m)) return;
      if (d.sid !== inSid) { inSid = d.sid; inNext = Number.isInteger(d.lo) && d.lo > 0 ? d.lo : 1; inHold.clear(); }
      else if (Number.isInteger(d.lo) && d.lo > inNext) { // the sender saw acks for those already
        for (const k of inHold.keys()) if (k < d.lo) inHold.delete(k);
        inNext = d.lo;
      }
      for (const x of d.m) {
        if (!Array.isArray(x) || !Number.isInteger(x[0])) continue;
        const s2 = x[0];
        if (s2 < inNext || inHold.has(s2)) continue;
        inHold.set(s2, { type: x[1], data: x[2], at: x[3] });
      }
      while (inHold.has(inNext)) { const m = inHold.get(inNext); inHold.delete(inNext); inNext++; deliver(m); }
      api.send('__ra', { sid: d.sid, upto: inNext - 1, h: inHold.size ? [...inHold.keys()].slice(0, 40) : undefined });
    }));
    offs.push(api.on('__ra', (d) => {
      if (!d || d.sid !== sid) return;
      if (Number.isInteger(d.upto)) for (const k of [...outbox.keys()]) { if (k <= d.upto) outbox.delete(k); else break; }
      if (Array.isArray(d.h)) for (const k of d.h) outbox.delete(k);
    }));
    timers.push(setInterval(flush, 90));
  }
  function on(type, fn) {
    (handlers[type] = handlers[type] || new Set()).add(fn);
    return () => handlers[type].delete(fn);
  }

  // ── state streaming ──
  const remoteBuf = makeBuffer({ delay, angles });
  const remoteFns = new Set();
  let lastPub = 0;
  function publish(state) {
    if (local) return;
    const t = myNow();
    // Presence and events share a budget of ~40 messages/s per device, so stream at `rate`
    // (default 20/s) and leave room for reliable events, acks and clock pings.
    if (t - lastPub < 1000 / rate - 2) return;
    lastPub = t;
    api.setPresence({ ...state, __t: Math.round(now()) });
  }
  if (!local) {
    offs.push(api.onPartnerState((s) => {
      if (!s || !isNum(s.__t)) return;
      // Their timeline went backwards a long way: they re-mounted. Forget the old one.
      const last = remoteBuf.latestTime();
      if (last != null && s.__t < last - 1500) remoteBuf.clear();
      remoteBuf.push(s.__t, s);
      remoteFns.forEach((fn) => { try { fn(s); } catch (e) { console.error(e); } });
    }));
  }

  const net = {
    get local() { return local; },
    get rtt() { return Math.round(rttAvg); },
    get offset() { return offset; },
    get synced() { return synced; },
    get delay() { return remoteBuf.delay; },
    set delay(v) { remoteBuf.delay = v; },
    ready,
    now,
    send,
    on,
    publish,
    remote: (at) => remoteBuf.sample((at ?? now()) - remoteBuf.delay),
    remoteInto: (out, at) => remoteBuf.sampleInto((at ?? now()) - remoteBuf.delay, out),
    remoteLatest: () => remoteBuf.latest(),
    onRemote(fn) { remoteFns.add(fn); return () => remoteFns.delete(fn); },
    buffer: (o) => makeBuffer(o),
    pendingReliable: () => outbox.size,
    /** A fresh session (see the header): new outgoing stream, clean inbound state and partner
     *  buffer, and on the guest a quick clock re-sync. Handlers registered with on() stay. */
    reset() {
      if (dead) return;
      sid = newSid();
      outSeq = 0;
      outbox.clear();
      inSid = null;
      inNext = 1;
      inHold.clear();
      remoteBuf.clear();
      lastPub = 0;
      if (!local && !api.isHost) { samples.length = 0; pending.clear(); pingLoop(30); }
    },
    destroy() {
      dead = true;
      offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
      timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
      clearTimeout(pingT);
      outbox.clear();
    },
  };
  return net;
}
