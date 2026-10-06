// Getaway audio, all synthesized: my engine (two detuned oscillators through a low-pass, pitch
// by RPM, louder with throttle), the other car's engine (quieter, by distance), a siren (wail /
// yelp), tyre squeal (band-passed noise by slip), crashes, spike pop + tyre flap, nitro whoosh,
// a scrape, UI ticks. Uses the app's shared context (unlocked on first touch) and its mute switch.

const LS_MUTE = 'ju.games.mute';

export function createAudio({ getCtx = null, mutedFn = null } = {}) {
  let ctx = null; let owned = false; let master = null; let noise = null; let dead = false;
  let mutedCache = false; let mutedAt = 0;
  const loops = {};
  const isMuted = () => {
    if (mutedFn) { try { return !!mutedFn(); } catch { /* fall through */ } }
    const t = performance.now();
    if (t - mutedAt > 800) { mutedAt = t; try { mutedCache = !!JSON.parse(localStorage.getItem(LS_MUTE) || 'false'); } catch { mutedCache = false; } }
    return mutedCache;
  };
  function init() {
    try { ctx = getCtx ? getCtx() : null; } catch { ctx = null; }
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      try { ctx = new AC(); owned = true; } catch { ctx = null; return false; }
    }
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(comp); comp.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // engines: mine + theirs
    for (const k of ['me', 'them']) {
      const g = ctx.createGain(); g.gain.value = 0;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 3;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 30;
      const g2 = ctx.createGain(); g2.gain.value = 0.5;
      o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(master);
      o1.start(); o2.start();
      loops[k] = { g, f, o1, o2 };
    }
    // siren
    { const g = ctx.createGain(); g.gain.value = 0; const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 700;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.7;
      o.connect(f); f.connect(g); g.connect(master); o.start(); loops.siren = { g, o, t: 0 }; }
    // squeal + flap: looping noise through filters
    for (const k of ['squeal', 'flap', 'rumble']) {
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const f = ctx.createBiquadFilter();
      if (k === 'squeal') { f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 9; }
      else if (k === 'flap') { f.type = 'lowpass'; f.frequency.value = 500; }
      else { f.type = 'lowpass'; f.frequency.value = 180; }
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(master); src.start();
      loops[k] = { g, f, src };
    }
    return true;
  }
  function unlock() { if (dead) return; if (!ctx && !init()) return; if (ctx.state === 'suspended') ctx.resume().catch(() => {}); }
  const ok = () => ctx && ctx.state === 'running' && !isMuted();
  const set = (p, v, tc = 0.05) => { try { p.setTargetAtTime(v, ctx.currentTime, tc); } catch { /* ignore */ } };

  function burst(dur, { vol = 0.4, f0 = 2000, f1 = 300, type = 'lowpass', q = 1, at = 0 } = {}) {
    if (!ok()) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource(); src.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  function tone(fr, dur, { type = 'sine', vol = 0.2, to = 0, at = 0 } = {}) {
    if (!ok()) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(fr, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }

  const S = { flapT: 0 };
  return {
    unlock,
    get ready() { return !!ctx; },
    /** every frame. me: { rpm 0..1, gas, slip, speed, flat, boost, offroad }; them: { rpm, dist } */
    engine(me, them, siren, dt) {
      if (!ctx) return;
      const on = ok() && me;
      const L = loops.me;
      if (on) {
        const f = 38 + me.rpm * 120 + me.speed * 0.4;
        set(L.o1.frequency, f, 0.03); set(L.o2.frequency, f * 0.5, 0.03);
        set(L.f.frequency, 400 + me.rpm * 1400 + me.gas * 500, 0.05);
        set(L.g.gain, 0.05 + me.gas * 0.07 + me.rpm * 0.03 + (me.boost ? 0.04 : 0), 0.06);
        set(loops.squeal.g.gain, Math.min(0.16, Math.max(0, me.slip - 2.2) * 0.03), 0.04);
        set(loops.squeal.f.frequency, 1600 + Math.min(900, me.speed * 18), 0.1);
        S.flapT += dt * me.speed * 0.9;
        const flap = me.flat > 0 && me.speed > 2 ? ((S.flapT % 1) < 0.35 ? 0.16 : 0.02) * Math.min(1, me.speed / 12) : 0;
        set(loops.flap.g.gain, flap, 0.01);
        set(loops.rumble.g.gain, me.offroad ? Math.min(0.25, me.speed * 0.012) : 0, 0.1);
      } else { set(L.g.gain, 0, 0.05); set(loops.squeal.g.gain, 0, 0.05); set(loops.flap.g.gain, 0, 0.05); set(loops.rumble.g.gain, 0, 0.1); }
      const T = loops.them;
      if (ok() && them) {
        const k = Math.max(0, 1 - them.dist / 140);
        const f = 36 + them.rpm * 115;
        set(T.o1.frequency, f, 0.05); set(T.o2.frequency, f * 0.5, 0.05); set(T.f.frequency, 500 + them.rpm * 900, 0.1);
        set(T.g.gain, 0.06 * k * k, 0.1);
      } else set(T.g.gain, 0, 0.1);
      const Si = loops.siren;
      if (ok() && siren && siren.on) {
        Si.t += dt;
        const yelp = siren.dist < 40;
        const ph = yelp ? (Si.t * 3.2) % 1 : (Si.t * 0.42) % 1;
        const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
        set(Si.o.frequency, 640 + tri * 720, 0.02);
        const k = Math.max(0.12, 1 - siren.dist / 260);
        set(Si.g.gain, 0.085 * k, 0.1);
      } else set(Si.g.gain, 0, 0.1);
    },
    crash(v) { const k = Math.min(1, v / 25); burst(0.35 + k * 0.3, { vol: 0.25 + k * 0.4, f0: 2400, f1: 120 }); tone(70, 0.3, { type: 'sine', vol: 0.3 + k * 0.3, to: 40 }); burst(0.18, { vol: 0.12 + k * 0.15, f0: 5200, f1: 2600, type: 'bandpass', q: 3, at: 0.04 }); },
    scrape() { burst(0.22, { vol: 0.12, f0: 3600, f1: 1600, type: 'bandpass', q: 4 }); },
    knock() { burst(0.16, { vol: 0.22, f0: 900, f1: 200 }); tone(160, 0.12, { type: 'square', vol: 0.06, to: 90 }); },
    pop() { burst(0.08, { vol: 0.7, f0: 6000, f1: 800, type: 'highpass' }); burst(0.6, { vol: 0.35, f0: 3000, f1: 300, at: 0.04 }); },
    pit() { tone(220, 0.5, { type: 'sawtooth', vol: 0.12, to: 55 }); burst(0.5, { vol: 0.35, f0: 1800, f1: 200 }); },
    nitro() { burst(0.7, { vol: 0.22, f0: 400, f1: 3800, type: 'bandpass', q: 1.5 }); },
    oil() { burst(0.35, { vol: 0.2, f0: 600, f1: 150 }); tone(300, 0.25, { vol: 0.08, to: 120 }); },
    spikeDrop() { burst(0.25, { vol: 0.2, f0: 4200, f1: 2000, type: 'bandpass', q: 6 }); tone(880, 0.08, { type: 'square', vol: 0.06 }); tone(660, 0.08, { type: 'square', vol: 0.06, at: 0.1 }); },
    beep(hi) { tone(hi ? 1320 : 660, hi ? 0.32 : 0.14, { type: 'square', vol: 0.1 }); },
    tick() { tone(1200, 0.04, { type: 'square', vol: 0.05 }); },
    stamp() { tone(140, 0.25, { type: 'square', vol: 0.12, to: 60 }); burst(0.2, { vol: 0.25, f0: 1500, f1: 200 }); },
    win() { [0, 4, 7, 12].forEach((n, i) => tone(523 * Math.pow(2, n / 12), 0.22, { type: 'triangle', vol: 0.14, at: i * 0.09 })); },
    lose() { [7, 4, 0, -5].forEach((n, i) => tone(392 * Math.pow(2, n / 12), 0.24, { type: 'triangle', vol: 0.12, at: i * 0.11 })); },
    nearMiss() { tone(900, 0.18, { type: 'sine', vol: 0.08, to: 1500 }); },
    silence() { if (!ctx) return; for (const k of Object.keys(loops)) set(loops[k].g.gain, 0, 0.03); },
    destroy() {
      dead = true;
      if (!ctx) return;
      for (const k of Object.keys(loops)) { const L = loops[k]; try { L.g.gain.value = 0; (L.o1 || L.o || L.src).stop(); if (L.o2) L.o2.stop(); L.g.disconnect(); } catch { /* ignore */ } }
      try { master.disconnect(); } catch { /* ignore */ }
      if (owned) ctx.close().catch(() => {});
    },
  };
}
