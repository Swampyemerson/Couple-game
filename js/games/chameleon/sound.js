// Synthesised sound effects (WebAudio). No samples, no network. Respects the app's mute switch.
// iOS needs the AudioContext created/resumed inside a user gesture: call unlock() on the first touch.
import { muted } from '../core.js';

export function createSound() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let lastTick = 0;
  let dead = false;

  function ensure() {
    if (dead) return null;
    if (!ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.55;
        master.connect(ctx.destination);
        const n = ctx.sampleRate * 0.5;
        noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        let s = 7;
        for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
      } catch { ctx = null; return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function tone(f0, f1, dur, { type = 'sine', vol = 0.2, at = 0, attack = 0.005 } = {}) {
    const c = ensure(); if (!c) return;
    const t = c.currentTime + 0.002 + at;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, { vol = 0.2, at = 0, freq = 1200, q = 0.8, type = 'bandpass', sweep = 0 } = {}) {
    const c = ensure(); if (!c || !noiseBuf) return;
    const t = c.currentTime + 0.002 + at;
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.3); src.stop(t + dur + 0.03);
  }

  const S = {
    ui: () => tone(660, 880, 0.06, { type: 'triangle', vol: 0.12 }),
    tick: () => {
      const n = performance.now(); if (n - lastTick < 55) return; lastTick = n;
      noise(0.035, { vol: 0.09, freq: 3200 + Math.random() * 1600, q: 2.5 });
    },
    gulp: () => { tone(520, 140, 0.16, { vol: 0.28 }); tone(900, 1300, 0.07, { vol: 0.12, at: 0.14 }); },
    fill: () => { noise(0.22, { vol: 0.16, freq: 600, q: 0.7, sweep: 3 }); tone(300, 500, 0.15, { vol: 0.1 }); },
    stamp: () => { tone(160, 70, 0.14, { type: 'square', vol: 0.12 }); noise(0.12, { vol: 0.18, freq: 900, q: 0.5 }); },
    undo: () => tone(700, 380, 0.09, { type: 'triangle', vol: 0.12 }),
    pose: () => { tone(330, 440, 0.08, { type: 'triangle', vol: 0.12 }); },
    jump: () => tone(300, 620, 0.12, { type: 'triangle', vol: 0.12 }),
    land: () => noise(0.06, { vol: 0.08, freq: 400, q: 0.6 }),
    fire: () => { tone(220, 90, 0.12, { type: 'square', vol: 0.14 }); noise(0.09, { vol: 0.16, freq: 1800, q: 0.9, sweep: 0.3 }); },
    splat: () => { noise(0.2, { vol: 0.26, freq: 500, q: 0.6, sweep: 0.4, type: 'lowpass' }); tone(140, 60, 0.12, { vol: 0.1 }); },
    chirp: () => { tone(1400, 2600, 0.09, { vol: 0.16 }); tone(1600, 3000, 0.09, { vol: 0.14, at: 0.12 }); },
    glint: () => { tone(2400, 2400, 0.25, { type: 'sine', vol: 0.06 }); tone(3600, 3600, 0.2, { vol: 0.04, at: 0.05 }); },
    scurry: () => { for (let i = 0; i < 6; i++) noise(0.03, { vol: 0.1, freq: 2500, q: 3, at: i * 0.06 }); },
    beep: () => tone(880, 880, 0.09, { type: 'square', vol: 0.07 }),
    go: () => { tone(660, 660, 0.08, { type: 'square', vol: 0.08 }); tone(1320, 1320, 0.18, { type: 'square', vol: 0.08, at: 0.08 }); },
    whoosh: () => noise(0.35, { vol: 0.14, freq: 300, q: 0.7, sweep: 6 }),
    found: () => {
      noise(0.08, { vol: 0.3, freq: 200, q: 0.5, type: 'lowpass' });
      [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, { type: 'triangle', vol: 0.16, at: 0.05 + i * 0.07 }));
    },
    survive: () => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.2, { type: 'triangle', vol: 0.14, at: i * 0.08 })),
    sad: () => [392, 330, 262].forEach((f, i) => tone(f, f * 0.97, 0.22, { type: 'triangle', vol: 0.13, at: i * 0.13 })),
    confetti: () => { for (let i = 0; i < 8; i++) tone(1800 + Math.random() * 1600, 2400 + Math.random() * 900, 0.05, { vol: 0.035, at: i * 0.04 }); },
    beat: () => { tone(70, 52, 0.12, { vol: 0.32 }); tone(64, 48, 0.1, { vol: 0.22, at: 0.16 }); },
    // suction cup: a wet low "thup" with a quick upward pop
    stick: () => { noise(0.07, { vol: 0.22, freq: 260, q: 1.2, type: 'lowpass' }); tone(180, 90, 0.08, { vol: 0.2 }); tone(420, 900, 0.05, { type: 'triangle', vol: 0.1, at: 0.05 }); },
    // pulling off: a bright "pok" falling away
    unstick: () => { tone(900, 380, 0.07, { type: 'triangle', vol: 0.16 }); noise(0.05, { vol: 0.14, freq: 1800, q: 2 }); },
    // tongue-zip: a rubbery "thwip" up then a sticky landing
    zip: () => { tone(300, 1800, 0.12, { type: 'sawtooth', vol: 0.07 }); noise(0.1, { vol: 0.12, freq: 2400, q: 1.5, sweep: 0.4 }); tone(200, 80, 0.08, { vol: 0.16, at: 0.3 }); },
    sprint: () => tone(520, 760, 0.07, { type: 'triangle', vol: 0.1 }),
    warn: () => { tone(500, 500, 0.08, { type: 'square', vol: 0.07 }); tone(500, 500, 0.08, { type: 'square', vol: 0.07, at: 0.14 }); },
  };

  return {
    unlock() { if (!muted()) ensure(); },
    play(name) {
      if (dead || muted()) return;
      const fn = S[name];
      if (fn) { try { fn(); } catch { /* audio is best-effort */ } }
    },
    destroy() {
      dead = true;
      if (ctx) { try { ctx.close(); } catch { /* ignore */ } }
      ctx = null; master = null; noiseBuf = null;
    },
  };
}
