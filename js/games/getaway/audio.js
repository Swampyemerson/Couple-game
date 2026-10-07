// Getaway audio, all synthesized (no samples): a procedural pursuit bed (music, below), my engine (three oscillators through a
// low-pass, pitch by RPM, a gear-change dip, louder with throttle), the other car's engine
// (quieter by distance, Doppler-shifted and panned), a siren (wail / yelp, Doppler + pan), tyre
// squeal (band-passed noise by slip), wind and road roar by speed, a low city ambience, crashes
// with some variety (thump, crunch, a metal clang, glass on big ones), spike pop + tyre flap,
// nitro whoosh, a scrape, UI ticks. Uses the app's shared context (unlocked on first touch) and
// its mute switch. One-shot sounds are rate-limited so a long scrape can't pile up voices.

const LS_MUTE = 'ju.games.mute';
const C_SOUND = 343;

export function createAudio({ getCtx = null, mutedFn = null } = {}) {
  let ctx = null; let owned = false; let master = null; let noise = null; let dead = false;
  let mutedCache = false; let mutedAt = 0;
  const loops = {};
  const lastAt = {}; // one-shot rate limiting (ms)
  const isMuted = () => {
    if (mutedFn) { try { return !!mutedFn(); } catch { /* fall through */ } }
    const t = performance.now();
    if (t - mutedAt > 800) { mutedAt = t; try { mutedCache = !!JSON.parse(localStorage.getItem(LS_MUTE) || 'false'); } catch { mutedCache = false; } }
    return mutedCache;
  };
  const panner = () => { try { return ctx.createStereoPanner ? ctx.createStereoPanner() : null; } catch { return null; } };
  function noiseLoop(name, type, freq, q, out) {
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(out || master); src.start(0, Math.random());
    loops[name] = { g, f, src };
  }
  function init() {
    try { ctx = getCtx ? getCtx() : null; } catch { ctx = null; }
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      try { ctx = new AC(); owned = true; } catch { ctx = null; return false; }
    }
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(comp); comp.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // engines: mine + theirs (theirs panned)
    for (const k of ['me', 'them']) {
      const g = ctx.createGain(); g.gain.value = 0;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 3;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 30;
      const o3 = ctx.createOscillator(); o3.type = 'triangle'; o3.frequency.value = 120; o3.detune.value = 9;
      const g2 = ctx.createGain(); g2.gain.value = 0.5; const g3 = ctx.createGain(); g3.gain.value = 0.28;
      o1.connect(f); o2.connect(g2); g2.connect(f); o3.connect(g3); g3.connect(f);
      const pn = k === 'them' ? panner() : null;
      f.connect(g); if (pn) { g.connect(pn); pn.connect(master); } else g.connect(master);
      o1.start(); o2.start(); o3.start();
      loops[k] = { g, f, o1, o2, o3, pn, lastRpm: 0, dip: 0 };
    }
    // siren (panned)
    { const g = ctx.createGain(); g.gain.value = 0; const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 700;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.7;
      const pn = panner();
      o.connect(f); f.connect(g); if (pn) { g.connect(pn); pn.connect(master); } else g.connect(master);
      o.start(); loops.siren = { g, o, f, pn, t: 0 }; }
    // squeal, flap, off-road rumble, wind + road roar, city ambience: looping noise through filters
    noiseLoop('squeal', 'bandpass', 1900, 9);
    noiseLoop('flap', 'lowpass', 500);
    noiseLoop('rumble', 'lowpass', 180);
    noiseLoop('wind', 'bandpass', 700, 0.6);
    noiseLoop('road', 'lowpass', 260, 0.8);
    noiseLoop('amb', 'lowpass', 320, 0.5);
    // the pursuit bed (music): persistent voices, notes scheduled as gain/frequency automation a
    // beat ahead from the frame loop — no nodes made per note
    { const out = ctx.createGain(); out.gain.value = 0; out.connect(master);
      const mk = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
      const bass = mk('sawtooth', 55); const bf = ctx.createBiquadFilter(); bf.type = 'lowpass'; bf.frequency.value = 260; bf.Q.value = 4; const bg = ctx.createGain(); bg.gain.value = 0; bass.connect(bf); bf.connect(bg); bg.connect(out); bass.start();
      const hs = ctx.createBufferSource(); hs.buffer = noise; hs.loop = true; const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 7000; const hg = ctx.createGain(); hg.gain.value = 0; hs.connect(hf); hf.connect(hg); hg.connect(out); hs.start();
      const b1 = mk('sawtooth', 220); const b2 = mk('sawtooth', 261.6); const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 1500; const sg = ctx.createGain(); sg.gain.value = 0; b1.connect(sf); b2.connect(sf); sf.connect(sg); sg.connect(out); b1.start(); b2.start();
      mus = { out, bass, bg, hs, hg, b1, b2, sg, next: 0, step: 0, on: false }; }
    return true;
  }
  let mus = null; let musicOn = true;
  // A minor riff in eighths (Hz): A A C A | G G A# G
  const RIFF = [55, 55, 65.41, 55, 49, 49, 58.27, 49];
  function unlock() { if (dead) return; if (!ctx && !init()) return; if (ctx.state === 'suspended') ctx.resume().catch(() => {}); }
  const ok = () => ctx && ctx.state === 'running' && !isMuted();
  const set = (p, v, tc = 0.05) => { try { p.setTargetAtTime(v, ctx.currentTime, tc); } catch { /* ignore */ } };
  const limit = (k, ms) => { const t = performance.now(); if (lastAt[k] && t - lastAt[k] < ms) return false; lastAt[k] = t; return true; };
  const doppler = (vrel) => C_SOUND / (C_SOUND - Math.max(-60, Math.min(60, vrel || 0)));

  function burst(dur, { vol = 0.4, f0 = 2000, f1 = 300, type = 'lowpass', q = 1, at = 0 } = {}) {
    if (!ok()) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource(); src.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  function tone(fr, dur, { type = 'sine', vol = 0.2, to = 0, at = 0 } = {}) {
    if (!ok()) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(fr, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  const S = { flapT: 0 };
  return {
    unlock,
    get ready() { return !!ctx; },
    get running() { return !!ctx && ctx.state === 'running'; },
    /** every frame. me: { rpm 0..1, gas, slip, speed, flat, boost, offroad };
     *  them: { rpm, dist, vrel (closing speed m/s), pan -1..1 }; siren: { on, dist, vrel, pan } */
    engine(me, them, siren, dt) {
      if (!ctx) return;
      const on = ok() && me;
      const L = loops.me;
      if (on) {
        // a gear change shows up as a quick rpm drop: dip the volume and filter for a moment
        if (me.rpm < L.lastRpm - 0.12 && me.gas > 0.3) L.dip = 0.14;
        L.lastRpm = me.rpm; L.dip = Math.max(0, L.dip - dt);
        const dipK = L.dip > 0 ? 0.55 : 1;
        const f = 38 + me.rpm * 120 + me.speed * 0.4;
        set(L.o1.frequency, f, 0.03); set(L.o2.frequency, f * 0.5, 0.03); set(L.o3.frequency, f * 2, 0.03);
        set(L.f.frequency, (400 + me.rpm * 1400 + me.gas * 500) * dipK, 0.04);
        set(L.g.gain, (0.05 + me.gas * 0.07 + me.rpm * 0.03 + (me.boost ? 0.04 : 0)) * dipK, 0.05);
        set(loops.squeal.g.gain, Math.min(0.16, Math.max(0, me.slip - 2.2) * 0.03) * (me.offroad ? 0.3 : 1), 0.04);
        set(loops.squeal.f.frequency, 1600 + Math.min(900, me.speed * 18), 0.1);
        S.flapT += dt * me.speed * 0.9;
        const flap = me.flat > 0 && me.speed > 2 ? ((S.flapT % 1) < 0.35 ? 0.16 : 0.02) * Math.min(1, me.speed / 12) : 0;
        set(loops.flap.g.gain, flap, 0.01);
        set(loops.rumble.g.gain, me.offroad ? Math.min(0.25, me.speed * 0.012) : 0, 0.1);
        const vk = Math.min(1, me.speed / 48);
        set(loops.wind.g.gain, vk * vk * 0.07, 0.15); set(loops.wind.f.frequency, 500 + vk * 900, 0.2);
        set(loops.road.g.gain, me.offroad ? 0 : vk * 0.08, 0.15);
        set(loops.amb.g.gain, 0.018, 0.5);
      } else {
        set(L.g.gain, 0, 0.05);
        for (const k of ['squeal', 'flap', 'rumble', 'wind', 'road']) set(loops[k].g.gain, 0, 0.08);
        set(loops.amb.g.gain, ok() && me !== null ? 0.012 : 0, 0.5);
      }
      const T = loops.them;
      if (ok() && them) {
        const k = Math.max(0, 1 - them.dist / 160);
        const f = (36 + them.rpm * 115) * doppler(them.vrel);
        set(T.o1.frequency, f, 0.05); set(T.o2.frequency, f * 0.5, 0.05); set(T.o3.frequency, f * 2, 0.05); set(T.f.frequency, 500 + them.rpm * 900, 0.1);
        set(T.g.gain, 0.07 * k * k, 0.1);
        if (T.pn) set(T.pn.pan, Math.max(-1, Math.min(1, them.pan || 0)) * 0.8, 0.08);
      } else set(T.g.gain, 0, 0.1);
      const Si = loops.siren;
      if (ok() && siren && siren.on) {
        Si.t += dt;
        const yelp = siren.dist < (siren.yelpR || 40); // (the final 15 s: yelping from 60 m)
        const ph = yelp ? (Si.t * 3.2) % 1 : (Si.t * 0.42) % 1;
        const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
        set(Si.o.frequency, (640 + tri * 720) * doppler(siren.vrel), 0.02);
        const k = Math.max(0.12, 1 - siren.dist / 260);
        set(Si.g.gain, 0.085 * k, 0.1);
        if (Si.pn) set(Si.pn.pan, Math.max(-1, Math.min(1, siren.pan || 0)) * 0.7, 0.08);
        // muffled when far: the band-pass closes down with distance
        set(Si.f.frequency, 700 + 500 * k, 0.2);
      } else set(Si.g.gain, 0, 0.1);
    },
    crash(v) {
      if (!limit('crash', 70)) return;
      const k = Math.min(1, v / 25);
      burst(0.35 + k * 0.3, { vol: 0.25 + k * 0.4, f0: rnd(2000, 2800), f1: 120 });
      tone(rnd(60, 80), 0.3, { type: 'sine', vol: 0.3 + k * 0.3, to: 40 });
      burst(0.18, { vol: 0.12 + k * 0.15, f0: rnd(4600, 5800), f1: 2600, type: 'bandpass', q: 3, at: 0.04 });
      if (v > 10) tone(rnd(280, 520), 0.25, { type: 'square', vol: 0.05 + k * 0.05, to: rnd(150, 220), at: 0.02 }); // metal
      if (v > 16 && Math.random() < 0.6) for (let i = 0; i < 4; i++) burst(0.06, { vol: 0.06, f0: rnd(6000, 9000), f1: 4000, type: 'highpass', at: 0.08 + i * rnd(0.03, 0.07) }); // glass
    },
    scrape(v = 4) { if (!limit('scrape', 110)) return; burst(0.22, { vol: 0.08 + Math.min(0.08, v * 0.012), f0: rnd(3200, 4000), f1: 1600, type: 'bandpass', q: 4 }); },
    knock() { if (!limit('knock', 60)) return; burst(0.16, { vol: 0.22, f0: rnd(800, 1100), f1: 200 }); tone(rnd(140, 180), 0.12, { type: 'square', vol: 0.06, to: 90 }); },
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
    nearMiss() { tone(900, 0.18, { type: 'sine', vol: 0.08, to: 1500 }); burst(0.3, { vol: 0.1, f0: 2400, f1: 500, type: 'bandpass', q: 1.2 }); },
    /** The final 15 s: a heartbeat (lub-dub), louder and brighter as k → 1. */
    heartbeat(k = 0) { const v = 0.16 + 0.12 * k; tone(58, 0.16, { type: 'sine', vol: v, to: 42 }); tone(52, 0.14, { type: 'sine', vol: v * 0.75, to: 38, at: 0.17 }); if (k > 0.6) burst(0.05, { vol: 0.03 * k, f0: 900, f1: 300, at: 0.01 }); },
    /** A photo finish: a bright two-note sting. */
    sting() { tone(988, 0.16, { type: 'square', vol: 0.07 }); tone(1319, 0.42, { type: 'square', vol: 0.08, at: 0.13 }); burst(0.5, { vol: 0.12, f0: 5000, f1: 1500, type: 'highpass', at: 0.12 }); },
    /** A new record: a rising arpeggio and a cymbal. */
    fanfare() { [0, 4, 7, 12, 16].forEach((n, i) => tone(523 * Math.pow(2, n / 12), i === 4 ? 0.5 : 0.16, { type: 'triangle', vol: 0.13, at: i * 0.075 })); burst(0.8, { vol: 0.1, f0: 7000, f1: 2500, type: 'highpass', at: 0.3 }); },
    whoosh() { burst(0.4, { vol: 0.08, f0: 1800, f1: 400, type: 'bandpass', q: 1 }); },
    silence() { if (!ctx) return; for (const k of Object.keys(loops)) set(loops[k].g.gain, 0, 0.03); if (mus) set(mus.out.gain, 0, 0.05); },
    /** Music on/off (this device's setting; the app's mute switch silences it too). */
    setMusic(on) { musicOn = !!on; if (!on && mus) set(mus.out.gain, 0, 0.1); },
    /**
     * The pursuit bed, every frame. I: intensity 0..1 (null = off: it fades). Layer 1 a pulsing
     * bass riff (always), layer 2 hi-hats above I 0.4, layer 3 a two-note brass stab every 2 bars
     * above I 0.75; 100 → 140 bpm with I. Notes go in ~0.15 s ahead as automation on fixed voices.
     */
    music(I) {
      if (!ctx || !mus) return;
      const on = I != null && musicOn && ok();
      if (!on) { if (mus.on) { mus.on = false; set(mus.out.gain, 0, 0.25); } return; }
      const now = ctx.currentTime;
      if (!mus.on) { mus.on = true; mus.next = now + 0.05; set(mus.out.gain, 0.13, 0.4); }
      if (mus.next < now) mus.next = now + 0.02; // (a stall: don't schedule the past)
      const bpm = 100 + 40 * I; const e8 = 30 / bpm; // an eighth note
      const hat = Math.max(0, Math.min(1, (I - 0.4) / 0.2)); const stab = I > 0.75;
      while (mus.next < now + 0.15) {
        const t = mus.next; const k = mus.step & 7; const bar2 = mus.step & 31;
        try {
          mus.bass.frequency.setValueAtTime(RIFF[k], t);
          mus.bg.gain.setValueAtTime(0.0001, t); mus.bg.gain.linearRampToValueAtTime(k % 2 ? 0.55 : 0.8, t + 0.012); mus.bg.gain.exponentialRampToValueAtTime(0.0001, t + e8 * 0.9);
          if (hat > 0) { const v = (k % 2 ? 0.16 : 0.07) * hat; mus.hg.gain.setValueAtTime(0.0001, t); mus.hg.gain.linearRampToValueAtTime(v, t + 0.004); mus.hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); }
          if (stab && (bar2 === 0 || bar2 === 3)) { mus.sg.gain.setValueAtTime(0.0001, t); mus.sg.gain.linearRampToValueAtTime(0.16, t + 0.02); mus.sg.gain.exponentialRampToValueAtTime(0.0001, t + e8 * 1.6); }
        } catch { /* ignore */ }
        mus.next += e8; mus.step++;
      }
    },
    /** The heat meter passing half: a rising filtered-noise sweep (2 s). */
    riser() { if (!limit('riser', 3000)) return; burst(2, { vol: 0.12, f0: 300, f1: 4200, type: 'bandpass', q: 2.5 }); },
    /** An emote's honk (two detuned squares). */
    honk(far = false) { if (!limit('honk', 300)) return; const v = far ? 0.05 : 0.09; tone(392, 0.22, { type: 'square', vol: v }); tone(330, 0.22, { type: 'square', vol: v * 0.8 }); tone(392, 0.16, { type: 'square', vol: v, at: 0.27 }); tone(330, 0.16, { type: 'square', vol: v * 0.8, at: 0.27 }); },
    destroy() {
      dead = true;
      if (!ctx) return;
      for (const k of Object.keys(loops)) { const L = loops[k]; try { L.g.gain.value = 0; (L.o1 || L.o || L.src).stop(); if (L.o2) L.o2.stop(); if (L.o3) L.o3.stop(); L.g.disconnect(); } catch { /* ignore */ } }
      if (mus) { try { mus.bass.stop(); mus.hs.stop(); mus.b1.stop(); mus.b2.stop(); mus.out.disconnect(); } catch { /* ignore */ } }
      try { master.disconnect(); } catch { /* ignore */ }
      if (owned) ctx.close().catch(() => {});
    },
  };
}
