// Rail Rush audio: synthesized sfx and a procedural music loop (kick, clap, hats, bass, arps)
// that speeds up and fills in with running speed. No files. Unlocked on the first touch/key,
// muted with the app's sound setting, music toggle of its own, ducked on crashes.

const LS_MUTE = 'ju.games.mute';
// A minor-ish progression: Am F C G (root MIDI notes) with chord tones
const PROG = [[57, [0, 3, 7, 10]], [53, [0, 4, 7, 11]], [48, [0, 4, 7, 9]], [55, [0, 4, 7, 10]]];
const BASS = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];
const ARP = [0, 2, 1, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2];
const LEAD = [12, -1, 15, -1, 19, -1, 17, 15, 12, -1, 10, -1, 12, 15, -1, 19];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function createAudio({ musicOn = () => true, getCtx = null, mutedFn = null } = {}) {
  let ctx = null;
  let owned = false;
  let master = null; let musicBus = null; let sfxBus = null; let noise = null;
  let mutedCache = false; let mutedAt = 0;
  let musicTimer = null;
  let step = 0; let nextT = 0; let intensity = 0; let playing = false;
  let coinStreak = 0; let lastCoin = 0;
  let dead = false;
  let pausedDuck = false;
  const stats = { steps: 0, resets: 0, maxAhead: 0 };

  const isMuted = () => {
    if (mutedFn) { try { return !!mutedFn(); } catch { /* fall through */ } }
    const t = performance.now();
    if (t - mutedAt > 800) { mutedAt = t; try { mutedCache = !!JSON.parse(localStorage.getItem(LS_MUTE) || 'false'); } catch { mutedCache = false; } }
    return mutedCache;
  };

  function init() {
    // Prefer the app's shared, gesture-unlocked context (iOS limits how many a page may open).
    try { ctx = getCtx ? getCtx() : null; } catch { ctx = null; }
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { ctx = new AC(); owned = true; } catch { ctx = null; return false; }
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 0.85;
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  function unlock() {
    if (dead) return;
    if (!ctx && !init()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
  const ok = () => ctx && ctx.state === 'running' && !isMuted();

  function tone(f, dur, { type = 'sine', vol = 0.2, to = 0, at = 0, bus = sfxBus, attack = 0.005, filter = 0 } = {}) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = filter; o.connect(fl); node = fl; }
    node.connect(g).connect(bus);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function hiss(dur, { vol = 0.2, f = 2000, q = 0.8, type = 'bandpass', to = 0, at = 0, bus = sfxBus, attack = 0.003 } = {}) {
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource(); s.buffer = noise;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (to) fl.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(bus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  const S = {
    coin() {
      const t = performance.now();
      coinStreak = t - lastCoin < 450 ? Math.min(coinStreak + 1, 12) : 0;
      lastCoin = t;
      const f = mtof(84 + [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28][coinStreak]);
      tone(f, 0.07, { type: 'square', vol: 0.06, filter: 5000 });
      tone(f * 1.5, 0.12, { type: 'sine', vol: 0.07, at: 0.04 });
    },
    jump(sup) { tone(sup ? 330 : 420, 0.16, { type: 'triangle', vol: 0.12, to: sup ? 1200 : 900 }); hiss(0.12, { vol: 0.05, f: 3000, to: 6000 }); },
    land(k) { tone(110, 0.12, { vol: 0.22 * Math.min(1, k), to: 50 }); hiss(0.1, { vol: 0.08 * Math.min(1, k), f: 900, type: 'lowpass' }); },
    roll() { hiss(0.32, { vol: 0.1, f: 500, to: 1600, q: 1.2 }); },
    whoosh(dir) { hiss(0.14, { vol: 0.09, f: dir < 0 ? 1400 : 1800, to: dir < 0 ? 3200 : 3800, q: 1.5 }); },
    bump() { tone(90, 0.1, { vol: 0.16, to: 60 }); },
    stumble() { tone(160, 0.14, { type: 'square', vol: 0.09, to: 70, filter: 900 }); hiss(0.18, { vol: 0.1, f: 600, type: 'lowpass' }); },
    crash() {
      tone(140, 0.45, { type: 'sawtooth', vol: 0.16, to: 35, filter: 700 });
      tone(70, 0.35, { vol: 0.3, to: 30 });
      hiss(0.5, { vol: 0.22, f: 1200, to: 200, q: 0.6 });
      tone(900, 0.08, { type: 'square', vol: 0.05, at: 0.05, to: 400 });
    },
    shield() { tone(520, 0.12, { type: 'triangle', vol: 0.12, to: 1040 }); tone(780, 0.25, { type: 'sine', vol: 0.08, at: 0.06 }); hiss(0.2, { vol: 0.08, f: 5000 }); },
    pickup() { [0, 4, 7, 12].forEach((n, i) => tone(mtof(76 + n), 0.1, { type: 'triangle', vol: 0.1, at: i * 0.05 })); },
    box() { [0, 7, 12, 19].forEach((n, i) => tone(mtof(72 + n), 0.08, { type: 'square', vol: 0.05, at: i * 0.04, filter: 4000 })); },
    weapon() { hiss(0.22, { vol: 0.12, f: 800, to: 3000, q: 2 }); tone(300, 0.2, { type: 'triangle', vol: 0.08, to: 700 }); },
    splat() { hiss(0.3, { vol: 0.25, f: 400, to: 150, q: 0.7 }); tone(90, 0.2, { vol: 0.2, to: 50 }); },
    zap() { tone(1400, 0.25, { type: 'sawtooth', vol: 0.07, to: 200, filter: 3000 }); hiss(0.2, { vol: 0.1, f: 6000, q: 3 }); },
    shove() { tone(120, 0.12, { vol: 0.3, to: 60 }); hiss(0.12, { vol: 0.14, f: 1500 }); },
    whiff() { hiss(0.2, { vol: 0.08, f: 2500, to: 600, q: 2 }); },
    horn() { [0, 0.16].forEach((at) => { tone(311, 0.55, { type: 'sawtooth', vol: 0.05, at, filter: 1400 }); tone(370, 0.55, { type: 'sawtooth', vol: 0.04, at, filter: 1400 }); }); },
    close() { tone(mtof(88), 0.08, { type: 'square', vol: 0.05, filter: 5000 }); tone(mtof(95), 0.16, { type: 'triangle', vol: 0.08, at: 0.06 }); },
    combo(n) { tone(mtof(79 + Math.min(n, 10) * 2), 0.14, { type: 'triangle', vol: 0.09 }); },
    tick() { tone(880, 0.07, { type: 'square', vol: 0.06, filter: 3000 }); },
    go() { tone(mtof(84), 0.3, { type: 'square', vol: 0.08, filter: 4000 }); tone(mtof(91), 0.35, { type: 'triangle', vol: 0.1, at: 0.02 }); },
    revive() { [0, 4, 7, 12, 16].forEach((n, i) => tone(mtof(72 + n), 0.18, { type: 'triangle', vol: 0.1, at: i * 0.06 })); },
    heart() { tone(mtof(79), 0.1, { type: 'sine', vol: 0.12 }); tone(mtof(86), 0.2, { type: 'sine', vol: 0.12, at: 0.09 }); },
    smash() { hiss(0.25, { vol: 0.2, f: 2000, to: 400 }); tone(200, 0.1, { type: 'square', vol: 0.08, to: 80, filter: 1200 }); },
    good() { [0, 7, 12].forEach((n, i) => tone(mtof(79 + n), 0.1, { type: 'triangle', vol: 0.09, at: i * 0.05 })); },
    power() { tone(220, 0.5, { type: 'sawtooth', vol: 0.06, to: 880, filter: 2400 }); hiss(0.5, { vol: 0.08, f: 1500, to: 5000 }); },
    finish() { [0, 4, 7, 12, 7, 12, 16].forEach((n, i) => tone(mtof(76 + n), 0.14, { type: 'square', vol: 0.05, at: i * 0.07, filter: 5000 })); },
  };

  function schedStep(t) {
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    const [root, ch] = PROG[bar];
    const I = intensity;
    const vol = 1;
    // kick
    if (s % 4 === 0) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.5 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.22);
    }
    // clap
    if (s === 4 || s === 12) {
      const sr = ctx.createBufferSource(); sr.buffer = noise;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.16 * (0.6 + I * 0.5), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      sr.connect(f).connect(g).connect(musicBus); sr.start(t, Math.random() * 0.5); sr.stop(t + 0.16);
    }
    // hats
    if (s % 2 === 0 || I > 0.55) {
      const sr = ctx.createBufferSource(); sr.buffer = noise;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
      const g = ctx.createGain(); g.gain.setValueAtTime((s % 4 === 2 ? 0.07 : 0.035) * (0.5 + I), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      sr.connect(f).connect(g).connect(musicBus); sr.start(t, Math.random() * 0.5); sr.stop(t + 0.05);
    }
    // bass
    if (BASS[s]) {
      const o = ctx.createOscillator(); const f = ctx.createBiquadFilter(); const g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(mtof(root - 12 + (s === 14 ? 7 : 0)), t);
      f.type = 'lowpass'; f.frequency.setValueAtTime(380 + I * 900, t); f.Q.value = 4;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(f).connect(g).connect(musicBus); o.start(t); o.stop(t + 0.22);
    }
    // arp (fills in with speed)
    if (I > 0.25 && (I > 0.6 || s % 2 === 0)) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(mtof(root + 12 + ch[ARP[s]]), t);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200 + I * 2000;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035 + I * 0.02, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      o.connect(f).connect(g).connect(musicBus); o.start(t); o.stop(t + 0.13);
    }
    // lead hook at higher intensity
    if (I > 0.5 && LEAD[s] >= 0 && bar % 2 === 1) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(mtof(root + 12 + LEAD[s]), t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.24);
    }
  }
  function pump() {
    if (!ctx || !playing || ctx.state !== 'running') return;
    const bpm = 116 + intensity * 34;
    const dur = 60 / bpm / 4;
    // Never catch up: after a stall (pause, background tab, slow frame) resync to "now" instead
    // of firing a burst of overdue notes, so the loop can't stack or drift.
    if (nextT < ctx.currentTime) { if (nextT > 0) stats.resets++; nextT = ctx.currentTime + 0.05; }
    const silent = isMuted() || !musicOn();
    while (nextT < ctx.currentTime + 0.14) { if (!silent) schedStep(nextT); nextT += dur; step++; stats.steps++; }
    if (nextT - ctx.currentTime > stats.maxAhead) stats.maxAhead = nextT - ctx.currentTime;
    const want = silent ? 0 : pausedDuck ? 0.16 : 0.55;
    // one automation event per change of target (not one every 45 ms while it glides)
    if (want !== lastWant && !duckUntil) { lastWant = want; musicBus.gain.setTargetAtTime(want, ctx.currentTime, 0.3); }
    if (duckUntil && performance.now() > duckUntil) { duckUntil = 0; lastWant = want; musicBus.gain.setTargetAtTime(want, ctx.currentTime, 0.4); }
  }
  let duckUntil = 0;
  let lastWant = -1;

  return {
    unlock,
    get ready() { return !!ctx && ctx.state === 'running'; },
    play(name, arg) { if (!ok()) return; const f = S[name]; if (f) { try { f(arg); } catch { /* ignore */ } } },
    setIntensity(x) { intensity = Math.max(0, Math.min(1, x)); },
    /** Duck the music under a pause card. */
    setPaused(on) { pausedDuck = !!on; },
    stats,
    startMusic() {
      if (playing) return;
      playing = true; step = 0; nextT = 0; lastWant = -1;
      if (!musicTimer) musicTimer = setInterval(pump, 45);
    },
    stopMusic() {
      playing = false; lastWant = 0;
      if (ctx && musicBus) musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    },
    duck(ms = 900) {
      if (!ctx || !musicBus) return;
      duckUntil = performance.now() + ms;
      musicBus.gain.cancelScheduledValues(ctx.currentTime);
      musicBus.gain.setTargetAtTime(0.12, ctx.currentTime, 0.04);
    },
    suspend() {
      if (!ctx) return;
      if (owned) { if (ctx.state === 'running') ctx.suspend().catch(() => {}); }
      else if (master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    },
    resume() {
      if (!ctx) return;
      if (owned) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); }
      else { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); if (master) master.gain.setTargetAtTime(0.85, ctx.currentTime, 0.05); }
    },
    destroy() {
      dead = true;
      if (musicTimer) clearInterval(musicTimer);
      musicTimer = null;
      try { if (master) master.disconnect(); } catch { /* ignore */ }
      if (ctx && owned) { try { ctx.close(); } catch { /* ignore */ } }
      ctx = null;
    },
  };
}
