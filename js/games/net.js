// Netcode kit for live games, built on the live `api` from core.js.
//
//   import { createNet } from './net.js';
//   const net = createNet(api);           // once per mount; net.destroy() in your destroy()
//   await net.ready;                      // first clock sync done (instant on one device)
//
// Shared clock
//   net.now()      ms on a timeline both devices agree on (the host's clock). Guests estimate
//                  the offset with NTP-style pings, keeping the lowest-latency samples.
//   net.rtt        smoothed round-trip time in ms (0 on one device).
//
// Reliable events (room events can drop; these can't)
//   net.send(type, data)   delivered exactly once, in order, retried until acknowledged.
//   net.on(type, fn)       fn(data, sentAt) — sentAt is the sender's net.now() when sent.
//
// State streaming with interpolation
//   net.publish(state)     your continuous state (stamped with net.now()), sent at most `rate`
//                          times/s (default 20). Call it every frame; extra calls are dropped.
//                          Absolute values only, ≤ 3.5 KB.
//   net.remote(at?)        partner's state interpolated at net.now() - net.delay (smooth even
//                          at 20-30 updates/s with jitter); extrapolates briefly when data is late.
//   net.remoteLatest()     newest raw partner state.
//   net.onRemote(fn)       every raw partner update.
//   net.delay              interpolation delay in ms (default 100). Raise for smoother, lower for snappier.
//
// Helpers
//   net.buffer({ delay, angles })   your own interpolation buffer: push(t, state), sample(t).
//   lerpState(a, b, k, angles)      numeric fields lerp (recursively); others snap to b.
//
// Authority: there's no global server. The usual pattern is "each player is the authority
// for their own avatar" (publish it; render the partner via net.remote()), and the host
// (api.isHost) decides shared things (round start, scores) and announces them with net.send.

const PING_EVERY = 2000;
const RESEND_MS = 280;
const MAX_TRIES = 40;

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

/** A timestamped buffer you can sample at any time. */
export function makeBuffer({ delay = 100, angles = [], maxExtrapolate = 160, keep = 40 } = {}) {
  const snaps = []; // [{ t, s }] sorted by t
  return {
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
    /** State at time `at` (already delay-adjusted by the caller, or use sampleNow). */
    sample(at) {
      if (!snaps.length) return null;
      if (snaps.length === 1 || at <= snaps[0].t) return snaps[0].s;
      for (let i = snaps.length - 1; i > 0; i--) {
        const a = snaps[i - 1]; const b = snaps[i];
        if (at >= a.t && at <= b.t) return lerpState(a.s, b.s, (at - a.t) / Math.max(1, b.t - a.t), angles);
      }
      // Newer than everything: extrapolate from the last two, but not too far.
      const a = snaps[snaps.length - 2]; const b = snaps[snaps.length - 1];
      const over = Math.min(at - b.t, maxExtrapolate);
      const k = 1 + over / Math.max(1, b.t - a.t);
      return lerpState(a.s, b.s, k, angles);
    },
  };
}

export function createNet(api, { delay = 100, angles = [], rate = 20 } = {}) {
  const local = api.mode !== 'live';
  const t0 = performance.now();
  const sid = Math.random().toString(36).slice(2, 10);
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
  let pingId = 0;
  const pending = new Map();
  function ping() {
    if (dead || local || api.isHost) return;
    const id = ++pingId;
    pending.set(id, myNow());
    api.send('__ping', { id });
    if (pending.size > 20) pending.delete(pending.keys().next().value);
  }
  if (!local) {
    offs.push(api.on('__ping', (d) => { if (api.isHost && d) api.send('__pong', { id: d.id, th: myNow() }); }));
    offs.push(api.on('__pong', (d) => {
      if (api.isHost || !d || !pending.has(d.id)) return;
      const sent = pending.get(d.id); pending.delete(d.id);
      const recv = myNow();
      const rtt = recv - sent;
      samples.push({ rtt, offset: d.th + rtt / 2 - recv });
      if (samples.length > 10) samples.shift();
      const best = [...samples].sort((x, y) => x.rtt - y.rtt).slice(0, 3);
      const target = best.reduce((s, x) => s + x.offset, 0) / best.length;
      // Slew gently after the first sync so the clock never jumps backwards much.
      offset = synced ? offset + (target - offset) * 0.25 : target;
      rttAvg = rttAvg ? rttAvg * 0.8 + rtt * 0.2 : rtt;
      if (!synced && samples.length >= 3) { synced = true; markReady(); }
    }));
    if (!api.isHost) {
      for (let i = 0; i < 5; i++) timers.push(setTimeout(ping, 60 + i * 180));
      timers.push(setInterval(ping, PING_EVERY));
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
  let outSeq = 0;
  const outbox = new Map(); // seq -> { type, data, at, tries, next }
  let inSid = null;
  let inNext = 1;
  const inHold = new Map();
  const handlers = {};
  function deliver(m) {
    (handlers[m.type] || []).forEach((fn) => { try { fn(m.data, m.at); } catch (e) { console.error(e); } });
  }
  function flush() {
    if (dead) return;
    const t = myNow();
    for (const [seq, m] of outbox) {
      if (t >= m.next) {
        if (m.tries++ > MAX_TRIES) { outbox.delete(seq); continue; }
        m.next = t + RESEND_MS * Math.min(4, 1 + m.tries * 0.5);
        api.send('__r', { sid, s: seq, type: m.type, d: m.data, at: m.at });
      }
    }
  }
  function send(type, data) {
    if (local) { // loop back so one-device games can use the same code path
      const m = { type, data: data ?? null, at: now() };
      setTimeout(() => deliver(m), 0);
      return;
    }
    const seq = ++outSeq;
    outbox.set(seq, { type: String(type), data: data ?? null, at: now(), tries: 0, next: 0 });
    flush();
  }
  if (!local) {
    offs.push(api.on('__r', (d) => {
      if (!d || !Number.isInteger(d.s)) return;
      api.send('__ra', { sid: d.sid, s: d.s });
      if (d.sid !== inSid) { inSid = d.sid; inNext = 1; inHold.clear(); } // partner reloaded
      if (d.s < inNext || inHold.has(d.s)) return;
      inHold.set(d.s, { type: d.type, data: d.d, at: d.at });
      while (inHold.has(inNext)) { const m = inHold.get(inNext); inHold.delete(inNext); inNext++; deliver(m); }
    }));
    offs.push(api.on('__ra', (d) => { if (d && d.sid === sid) outbox.delete(d.s); }));
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
    remoteLatest: () => remoteBuf.latest(),
    onRemote(fn) { remoteFns.add(fn); return () => remoteFns.delete(fn); },
    buffer: (o) => makeBuffer(o),
    pendingReliable: () => outbox.size,
    destroy() {
      dead = true;
      offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
      timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
      outbox.clear();
    },
  };
  return net;
}
