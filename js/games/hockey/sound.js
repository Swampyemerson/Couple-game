// Air Hockey sounds: small WebAudio synths on the app's shared context. Everything checks
// muted() first and never throws. Wall, mallet, Pillar and goal frame each sound different.
export function createSound(api) {
  let noiseBuf = null;
  const ctx = () => {
    if (api.muted && api.muted()) return null;
    try { return api.audio(); } catch { return null; }
  };
  const noise = (c) => {
    if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
    const n = Math.floor(c.sampleRate * 0.12);
    noiseBuf = c.createBuffer(1, n, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
    return noiseBuf;
  };
  const tone = (c, t, f0, f1, dur, vol, type = 'sine') => {
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  };
  const click = (c, t, freq, dur, vol) => {
    const s = c.createBufferSource(); const f = c.createBiquadFilter(); const g = c.createGain();
    s.buffer = noise(c); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.4;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(c.destination); s.start(t); s.stop(t + dur + 0.02);
  };
  const last = {};
  const gate = (k, ms) => { const n = performance.now(); if (n - (last[k] || -1e9) < ms) return false; last[k] = n; return true; };
  const at = (c) => c.currentTime + 0.003;
  return {
    /** the rail: a short, dry "tock" that gets brighter with speed */
    wall(speed) {
      if (!gate('wall', 55)) return; const c = ctx(); if (!c) return;
      const t = at(c); const v = Math.min(1, 0.25 + speed / 260);
      click(c, t, 900 + speed * 4, 0.05, 0.18 * v); tone(c, t, 260 + speed * 0.5, 180, 0.05, 0.1 * v, 'triangle');
    },
    /** the Pillar: a low rubbery "bonk" */
    pillar(speed) {
      if (!gate('pillar', 70)) return; const c = ctx(); if (!c) return;
      const t = at(c); const v = Math.min(1, 0.35 + speed / 240);
      tone(c, t, 210, 95, 0.16, 0.34 * v, 'sine'); tone(c, t, 420, 300, 0.06, 0.1 * v, 'triangle');
    },
    /** the goal frame: a bright metal "clang" */
    clang() {
      if (!gate('clang', 120)) return; const c = ctx(); if (!c) return;
      const t = at(c);
      for (const [f, v] of [[1180, 0.2], [1760, 0.14], [2790, 0.1], [3320, 0.06]]) tone(c, t, f, f * 0.985, 0.55, v, 'sine');
      click(c, t, 4200, 0.04, 0.2);
    },
    /** shot clock: a soft tick, higher as it runs out */
    shotTick(n) {
      if (!gate('stick', 300)) return; const c = ctx(); if (!c) return;
      tone(c, at(c), 640 + (3 - n) * 140, 0, 0.07, 0.1, 'square');
    },
    /** HOG! / RESET: a falling buzzer */
    buzz() {
      if (!gate('buzz', 300)) return; const c = ctx(); if (!c) return;
      const t = at(c); tone(c, t, 300, 120, 0.32, 0.16, 'sawtooth'); tone(c, t + 0.02, 150, 80, 0.3, 0.12, 'square');
    },
    /** a record: a quick rising arpeggio */
    record() {
      if (!gate('rec', 400)) return; const c = ctx(); if (!c) return;
      const t = at(c);
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, t + i * 0.07, f, 0, 0.16, 0.12, 'triangle'));
    },
    /** match point: two low notes */
    matchPoint() {
      if (!gate('mp', 1500)) return; const c = ctx(); if (!c) return;
      const t = at(c); tone(c, t, 196, 0, 0.16, 0.2, 'triangle'); tone(c, t + 0.17, 294, 0, 0.3, 0.2, 'triangle');
    },
    /** slow-mo: a falling whoosh */
    slow() {
      if (!gate('slow', 600)) return; const c = ctx(); if (!c) return;
      const t = at(c); tone(c, t, 700, 120, 0.4, 0.12, 'sine'); click(c, t, 600, 0.35, 0.08);
    },
    /** the Power Puck gets hotter: pitch rises with the heat (0..1) */
    heat(h) {
      if (!gate('heat', 120)) return; const c = ctx(); if (!c) return;
      tone(c, at(c), 330 + h * 520, 0, 0.09, 0.09, 'square');
    },
  };
}
