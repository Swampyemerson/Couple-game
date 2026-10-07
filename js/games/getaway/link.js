// Getaway netcode wrapper over js/games/net.js (the pattern from Blend & Seek's link.js).
// Each mount has a session id; devices greet with raw `ghi` messages and run net.js on a channel
// namespaced by BOTH session ids, so a partner that re-mounts gets a fresh net.js (fresh clock
// sync, fresh reliable sequence) instead of waiting forever for old sequence numbers.
// Adds: an allocation-free ring buffer of the partner's car and a dead-reckoned prediction
// (interpolate at now − delay, then project forward by the delay along the arc it is turning on).
// Collisions use this prediction; the drawn car is the prediction plus a decaying error offset.
import { createNet } from '../net.js';

/** Streamed at 20/s. Every field is a number. */
export const FIELDS = ['x', 'z', 'y', 'yaw', 'vx', 'vz', 'r', 'st', 'hp', 'fl', 'es', 'nt', 'lv', 'rpm', 'ph', 'rd', 'pz', 'ry', 'sv', 'tp', 'sl'];
const F = FIELDS.length;
const YAW = FIELDS.indexOf('yaw');
const STEP = new Set(['fl', 'lv', 'ph', 'rd', 'pz', 'ry', 'sv']); // flags: newest wins, no lerp
const STEPI = FIELDS.map((f) => STEP.has(f));

function wrap(a) { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }

export function createRemoteBuffer(size = 48) {
  const t = new Float64Array(size); const v = new Float64Array(size * F);
  let head = 0; let count = 0;
  return {
    clear() { head = 0; count = 0; },
    get count() { return count; },
    push(time, s) {
      const last = count ? t[(head - 1 + size) % size] : -Infinity;
      // the sender's shared clock was corrected backwards (its early sync was off): start over
      // instead of rejecting every sample until time catches up with the stale ones
      if (count && time < last - 400) { head = 0; count = 0; }
      else if (count && time <= last) return;
      t[head] = time;
      for (let f = 0; f < F; f++) { const x = s[FIELDS[f]]; v[head * F + f] = typeof x === 'number' && Number.isFinite(x) ? x : 0; }
      head = (head + 1) % size; if (count < size) count++;
    },
    latestTime() { return count ? t[(head - 1 + size) % size] : -Infinity; },
    /** Interpolated (or briefly extrapolated) state at `at` into out. Returns extrapolation ms. */
    sample(at, out, maxExtra = 220) {
      if (!count) return -1;
      const newest = (head - 1 + size) % size;
      let a = -1; let b = newest;
      for (let k = 0; k < count; k++) { const i = (head - 1 - k + size * 2) % size; if (t[i] <= at) { a = i; break; } b = i; }
      if (a < 0) { for (let f = 0; f < F; f++) out[FIELDS[f]] = v[b * F + f]; return 0; }
      if (a === newest) { // past the newest sample: hold it, the caller dead-reckons
        for (let f = 0; f < F; f++) out[FIELDS[f]] = v[a * F + f];
        return Math.min(at - t[a], maxExtra);
      }
      const k = (at - t[a]) / Math.max(1, t[b] - t[a]);
      for (let f = 0; f < F; f++) {
        const x0 = v[a * F + f]; const x1 = v[b * F + f];
        if (STEPI[f]) out[FIELDS[f]] = k < 0.5 ? x0 : x1;
        else if (f === YAW) out.yaw = x0 + wrap(x1 - x0) * k;
        else out[FIELDS[f]] = x0 + (x1 - x0) * k;
      }
      return 0;
    },
  };
}

export function createLink(api, { delay = 100, onLink = () => {}, onUnlink = () => {} } = {}) {
  const local = api.mode !== 'live';
  const sess = Math.random().toString(36).slice(2, 10);
  let partner = null; let net = null; let ready = local; let epoch = 0; let dead = false;
  let lastHeard = performance.now(); let lastSample = 0; let sampleGap = 50; let lastHi = 0; let sent = 0;
  const handlers = Object.create(null);
  const offs = []; const timers = [];
  const rb = createRemoteBuffer();
  const pub = { k: sess, p: '' };
  for (const f of FIELDS) pub[f] = 0;
  let rawOff = null; let ns = '';
  const retired = new Set();
  const seen = new Set(); // ids of blasted messages already handled

  function dispatch(m, at) {
    if (!m || typeof m.t !== 'string') return;
    if (m.u) { if (seen.has(m.u)) return; seen.add(m.u); if (seen.size > 300) seen.delete(seen.values().next().value); }
    const hs = handlers[m.t];
    if (hs) hs.forEach((fn) => { try { fn(m.d, at); } catch (e) { console.error('getaway', m.t, e); } });
  }
  // guest's own min-RTT clock refinement (net.js converges slowly when early pings are noisy)
  const clk = { off: 0, n: 0, samples: [], id: 0, sent: new Map(), timer: 0, offs: [] };
  function clockReset() { clk.off = 0; clk.n = 0; clk.samples.length = 0; clk.sent.clear(); clearTimeout(clk.timer); clk.offs.forEach((f) => { try { f(); } catch { /* ignore */ } }); clk.offs.length = 0; }
  function clockStart() {
    clockReset();
    if (local) return;
    if (api.isHost) { clk.offs.push(api.on(ns + 'tq', (d) => { if (d && typeof d.id === 'number') api.send(ns + 'ta', { id: d.id, h: net ? net.now() : performance.now() }); })); return; }
    clk.offs.push(api.on(ns + 'ta', (d) => {
      if (!d || !clk.sent.has(d.id)) return;
      const t0 = clk.sent.get(d.id); clk.sent.delete(d.id);
      const t1 = performance.now(); const rtt = t1 - t0;
      clk.samples.push({ rtt, off: d.h + rtt / 2 - t1 }); if (clk.samples.length > 14) clk.samples.shift();
      const best = clk.samples.slice().sort((x, y) => x.rtt - y.rtt).slice(0, 3);
      clk.off = best.reduce((s, x) => s + x.off, 0) / best.length; clk.n++;
    }));
    let k = 0;
    const tick = () => {
      if (dead) return;
      const id = ++clk.id; clk.sent.set(id, performance.now()); if (clk.sent.size > 16) clk.sent.delete(clk.sent.keys().next().value);
      api.send(ns + 'tq', { id }); k++;
      clk.timer = setTimeout(tick, k < 8 ? 160 : k < 20 ? 1200 : 4000);
    };
    tick();
  }
  function makeNet() {
    if (net) { try { net.destroy(); } catch { /* ignore */ } }
    if (rawOff) { try { rawOff(); } catch { /* ignore */ } rawOff = null; }
    rb.clear(); ready = false;
    const my = ++epoch;
    let n;
    if (local) n = createNet(api, { delay });
    else {
      ns = `g.${[sess, partner].sort().join('.')}.`;
      rawOff = api.on(ns + 'g!', (m) => { lastHeard = performance.now(); dispatch(m, null); });
      const proxy = { mode: api.mode, isHost: api.isHost, send: (t, d) => api.send(ns + t, d), on: (t, fn) => api.on(ns + t, fn), setPresence: (o) => api.setPresence(o), onPartnerState: (fn) => api.onPartnerState(fn) };
      n = createNet(proxy, { delay, rate: 20, angles: ['yaw'] });
      n.onRemote((s) => { if (!s || s.k !== partner || s.p !== sess) return; lastHeard = performance.now(); if (lastSample) sampleGap += (Math.min(1000, lastHeard - lastSample) - sampleGap) * 0.2; lastSample = lastHeard; rb.push(s.__t, s); });
    }
    n.on('g', (m, at) => { if (!local) lastHeard = performance.now(); dispatch(m, at); });
    net = n;
    clockStart();
    n.ready.then(() => { if (dead || net !== n || epoch !== my) return; ready = true; onLink(my); });
  }
  function hi() { if (dead || local) return; lastHi = performance.now(); api.send('ghi', { s: sess, p: partner, h: !!api.isHost }); }
  if (local) makeNet();
  else {
    offs.push(api.on('ghi', (d) => {
      if (dead || !d || typeof d.s !== 'string') return;
      lastHeard = performance.now();
      if (retired.has(d.s)) return;
      if (d.s !== partner) { const had = partner != null; if (had) retired.add(partner); partner = d.s; pub.p = partner; if (had) onUnlink('remount'); makeNet(); }
      if (d.p !== sess && performance.now() - lastHi > 150) hi();
    }));
    hi();
    // (once linked the hello backs off to 5 s: it was 0.45 msg/s of background noise per device)
    timers.push(setInterval(() => { if (!ready || performance.now() - lastHi > (net && ready ? 5000 : 1900)) hi(); }, 450));
  }
  let uid = 0;
  return {
    get local() { return local; }, get ready() { return ready; }, get epoch() { return epoch; },
    get sess() { return sess; }, get partner() { return partner; },
    get rtt() { return net ? net.rtt : 0; }, get delay() { return net ? net.delay : delay; }, get sent() { return sent; },
    get silence() { return local ? 0 : performance.now() - lastHeard; },
    /** ms since the partner's last streamed sample arrived (local clock: no clock-sync error). */
    get sampleAge() { return local || !lastSample ? 0 : performance.now() - lastSample; },
    /** The partner's typical sample interval (ms, smoothed): a hitch is a gap well above it. */
    get sampleGap() { return sampleGap; },
    now() { if (!net) return performance.now(); if (local || api.isHost || clk.n < 3) return net.now(); return performance.now() + clk.off; },
    get clockSamples() { return clk.n; },
    send(type, data) { if (!net) return false; sent++; net.send('g', { t: type, d: data ?? null }); return true; },
    /** Reliable, plus two unreliable copies right now (deduped): for time-critical messages.
     *  `light` (knocks, broken props, oil: visual only) sends one raw copy instead of two. */
    urgent(type, data, light = false) {
      if (!net) return;
      const u = sess + ':' + (++uid);
      const m = { t: type, d: data ?? null, u };
      if (local) { net.send('g', m); return; }
      sent++; net.send('g', m);
      const space = ns; api.send(space + 'g!', m);
      if (light) return;
      const tm = setTimeout(() => { if (!dead && ns === space) api.send(space + 'g!', m); }, 60); timers.push(tm);
      if (timers.length > 80) timers.splice(1, 30);
    },
    on(type, fn) { (handlers[type] = handlers[type] || new Set()).add(fn); return () => handlers[type].delete(fn); },
    publish(st) { if (!net || local) return; for (let i = 0; i < F; i++) pub[FIELDS[i]] = st[FIELDS[i]]; net.publish(pub); },
    remoteCount() { return rb.count; },
    latestTime() { return rb.latestTime(); },
    /** Partner car at time `at` (default now): interpolated at at − delay, then dead-reckoned
     *  forward by the delay (+ any extrapolation) with its velocity and yaw rate. */
    predict(out, at) {
      if (!net) return false;
      const now = at ?? this.now();
      const ex = rb.sample(now - net.delay, out);
      if (ex < 0) return false;
      const ahead = Math.min(0.32, (net.delay + ex) / 1000);
      // dead-reckon along the arc it is turning on (velocity turns with the yaw rate)
      const r = Math.max(-2.5, Math.min(2.5, out.r || 0));
      let vx = out.vx; let vz = out.vz; const h = ahead / 4;
      for (let k = 0; k < 4; k++) {
        const a = r * h * 0.5; const mx = vx - vz * a; const mz = vz + vx * a; // midpoint velocity
        out.x += mx * h; out.z += mz * h;
        const c = Math.cos(r * h); const sn = Math.sin(r * h); const nx = vx * c - vz * sn; vz = vz * c + vx * sn; vx = nx;
      }
      out.vx = vx; out.vz = vz; out.yaw += r * ahead;
      return true;
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
    },
  };
}
