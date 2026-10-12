// Defuse module: MORSE, the signal lamp.
//
// Bomb: a lamp blinks a short word as dots and dashes (loops, long pause between runs), a tuner
// (frequency readout with step buttons) and a TX key. The bomb holder describes the flashes; the
// manual decodes them with a code chart (scrambled from level 2, so real Morse does not help),
// looks the word up in a word -> frequency table, and says which frequency to tune. TX on the right
// frequency solves, a wrong TX is a strike.
//
// Pure parts: rules / errata / page / gen / solve / timeline. S = { word, start }. The answer is the
// index into R.freqs (ascending kHz) the tuner must show.
import { int, shuffle } from './util.js';

const STD = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
  N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
};
const LETTERS = Object.keys(STD);
const CODES = LETTERS.map((l) => STD[l]);

// Family-friendly 4 and 5 letter words. Plenty of different first-two-letter pairs so a round can
// always draw a list where no two words start alike.
const WORDS = ('BARK BELL BIRD BOAT BOLT CAKE CAMP CARD COIN CORN DAWN DESK DICE DOOR DUCK FARM FERN FISH FLAG FROG GATE GIFT GOLD GRIN HAWK HILL '
  + 'HOLE JADE JAZZ KITE KNOB LAMP LEAF LION LOCK MILK MOON NEST NOTE OVEN PAIR PEAR PINE PLUM POND RAIN RING ROSE SAIL SEAL SHOE SNOW SOAP STAR '
  + 'SWAN TAPE TENT TIDE TOAD TREE VASE WAVE WIND WOLF YARN ZOOM '
  + 'APPLE BADGE BEACH BREAD BRUSH CANDY CLOCK CLOUD DAISY DANCE EAGLE FLUTE GLOVE GRAPE HEART HONEY JELLY LEMON MANGO MAPLE MOUSE NIGHT OCEAN '
  + 'OLIVE PANDA PEACH PIANO PLANT QUILT RIVER ROBOT SHELL SMILE SPOON STORM SUNNY TIGER TOAST TRAIN WATER WHALE ZEBRA').split(' ');

const BANDS = [3500, 7000, 10100, 14000, 18068, 21000]; // kHz
const UNIT = [330, 300, 280, 260]; // ms per dot, by level (dash = 3 units, letter gap = 3, word gap = 8)

export const khzText = (k) => `${Math.floor(k / 1000)}.${String(k % 1000).padStart(3, '0')}`;
const codeKey = (c) => c.length + ':' + c.replace(/\./g, '0').replace(/-/g, '1');
const byCode = (chart) => (a, b) => (codeKey(chart[a]) < codeKey(chart[b]) ? -1 : 1);
const sameChart = (c) => LETTERS.every((l) => c[l] === STD[l]);
const symbols = (code) => [...code].map((s) => (s === '.' ? '<i class="dx-morse-dot"></i>' : '<i class="dx-morse-dash"></i>')).join('');
const spoken = (code) => [...code].map((s) => (s === '.' ? 'dot' : 'dash')).join(' ');

/** The lamp timeline for a word: [[on, ms, letterIndex]], letterIndex -1 in the pause before the word repeats. */
export function morseTimeline(word, chart, u) {
  const seg = [];
  [...word].forEach((ch, li) => {
    const code = chart[ch];
    [...code].forEach((sym, si) => {
      seg.push([1, sym === '.' ? u : 3 * u, li]);
      if (si < code.length - 1) seg.push([0, u, li]);
    });
    if (li < word.length - 1) seg.push([0, 3 * u, li]); else seg.push([0, 8 * u, -1]);
  });
  return seg;
}

function pickWords(r, n) {
  const seen = new Set();
  const out = [];
  for (const w of shuffle(r, WORDS)) {
    const bi = w.slice(0, 2);
    if (seen.has(bi)) continue;
    seen.add(bi);
    out.push(w);
    if (out.length === n) break;
  }
  return out;
}

export const MORSE = {
  id: 'morse',
  name: 'Signal lamp',
  tab: 'Lamp',
  tiers: ['chill', 'normal', 'spicy', 'wild'],
  needy: false,
  remote: false,
  css: `
.g-defuse .dx-mod[data-mod="morse"] { --mx-off: color-mix(in srgb, var(--dx-yellow) 12%, var(--dx-dark)); }
.g-defuse .dx-mod[data-mod="morse"] .mx { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 9px; }
.g-defuse .dx-mod[data-mod="morse"] .mx button { touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
.g-defuse .dx-mod[data-mod="morse"] .mx-lamp { position: relative; width: 124px; height: 124px; padding: 0; background: none; border: 0; border-radius: 50%; }
.g-defuse .dx-mod[data-mod="morse"] .mx-lamp svg { display: block; width: 100%; height: 100%; overflow: visible; }
.g-defuse .dx-mod[data-mod="morse"] .mx-shd { fill: var(--g-edge, var(--g-ink)); }
.g-defuse .dx-mod[data-mod="morse"] .mx-bez { fill: var(--dx-dark); stroke: var(--g-ink); stroke-width: 3; }
.g-defuse .dx-mod[data-mod="morse"] .mx-ring { fill: none; stroke: color-mix(in srgb, var(--dx-white) 30%, transparent); stroke-width: 2; }
.g-defuse .dx-mod[data-mod="morse"] .mx-lens { fill: var(--mx-off); stroke: var(--g-ink); stroke-width: 2.5; }
.g-defuse .dx-mod[data-mod="morse"] .mx-glint { fill: none; stroke: color-mix(in srgb, var(--dx-white) 55%, transparent); stroke-width: 3.5; stroke-linecap: round; }
.g-defuse .dx-mod[data-mod="morse"] .mx-rays line { stroke-linecap: round; }
.g-defuse .dx-mod[data-mod="morse"] .mx-rays .o { stroke: var(--g-ink); stroke-width: 8; }
.g-defuse .dx-mod[data-mod="morse"] .mx-rays .c { stroke: var(--dx-yellow); stroke-width: 4; }
.g-defuse .dx-mod[data-mod="morse"] .mx-rays { opacity: 0; }
.g-defuse .dx-mod[data-mod="morse"] .mx-lamp.is-on .mx-rays { opacity: 1; }
.g-defuse .dx-mod[data-mod="morse"] .mx-lamp.is-on .mx-lens { fill: var(--dx-yellow); stroke-width: 3.5; }
.g-defuse .dx-mod[data-mod="morse"] .mx-lamp.is-ok .mx-lens { fill: var(--dx-green); }
.g-defuse .dx-mod[data-mod="morse"] .mx-lamp:focus-visible { outline: 3px solid var(--p-a); outline-offset: 2px; }
.g-defuse .dx-mod[data-mod="morse"] .mx-pips { display: flex; gap: 7px; height: 12px; }
.g-defuse .dx-mod[data-mod="morse"] .mx-pips i { width: 12px; height: 12px; border: 2px solid var(--g-ink); border-radius: 50%; background: var(--g-card); }
.g-defuse .dx-mod[data-mod="morse"] .mx-pips i.is-now { background: var(--g-hl); }
.g-defuse .dx-mod[data-mod="morse"] .mx-tune { width: 100%; display: grid; grid-template-columns: 52px minmax(0, 1fr) 52px; gap: 8px; align-items: center; }
.g-defuse .dx-mod[data-mod="morse"] .mx-step { display: grid; place-items: center; width: 52px; height: 56px; padding: 0; background: var(--dx-white); color: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: 0 5px 0 var(--g-edge, var(--g-ink)); transition: transform 0.06s, box-shadow 0.06s; }
.g-defuse .dx-mod[data-mod="morse"] .mx-step svg { width: 26px; height: 26px; fill: currentColor; }
.g-defuse .dx-mod[data-mod="morse"] .mx-step:active { transform: translateY(4px); box-shadow: 0 1px 0 var(--g-edge, var(--g-ink)); }
.g-defuse .dx-mod[data-mod="morse"] .mx-lcd { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 56px; padding: 4px 6px 5px; background: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 10px; box-shadow: inset 0 -4px 0 rgb(255 255 255 / 0.06); }
.g-defuse .dx-mod[data-mod="morse"] .mx-freq { font: 400 1.5rem/1 var(--g-font-display); color: var(--dx-yellow); font-variant-numeric: tabular-nums; letter-spacing: 0.02em; white-space: nowrap; }
.g-defuse .dx-mod[data-mod="morse"] .mx-mhz { font: 800 0.6rem/1.2 var(--g-font-body); letter-spacing: 0.16em; color: #8d8a80; }
.g-defuse .dx-mod[data-mod="morse"] .mx-scale { display: flex; align-items: flex-end; justify-content: space-between; gap: 2px; width: calc(100% - 8px); height: 16px; }
.g-defuse .dx-mod[data-mod="morse"] .mx-scale i { flex: 1; max-width: 3px; height: 7px; background: var(--g-muted); border-radius: 1px; }
.g-defuse .dx-mod[data-mod="morse"] .mx-scale i.is-now { height: 16px; background: var(--dx-red); }
.g-defuse .dx-mod[data-mod="morse"] .mx-tx { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 54px; padding: 0 14px; background: var(--dx-red); color: var(--dx-dark); border: 3px solid var(--g-ink); border-radius: 12px; box-shadow: 0 6px 0 var(--g-edge, var(--g-ink)); font: 400 1.3rem/1 var(--g-font-display); letter-spacing: 0.1em; transition: transform 0.06s, box-shadow 0.06s; }
.g-defuse .dx-mod[data-mod="morse"] .mx-tx small { font: 800 0.62rem/1 var(--g-font-body); letter-spacing: 0.16em; }
.g-defuse .dx-mod[data-mod="morse"] .mx-tx:active { transform: translateY(5px); box-shadow: 0 1px 0 var(--g-edge, var(--g-ink)); }
.g-defuse .dx-mod[data-mod="morse"] .mx-step:focus-visible, .g-defuse .dx-mod[data-mod="morse"] .mx-tx:focus-visible { outline: 3px solid var(--p-a); outline-offset: 3px; }
.g-defuse .dx-mod[data-mod="morse"] .mx[data-done="1"] button:not(.mx-lamp) { opacity: 0.55; pointer-events: none; }
@media (max-width: 340px) { .g-defuse .dx-mod[data-mod="morse"] .mx-freq { font-size: 1.3rem; } }
@media (prefers-reduced-motion: reduce) {
  .g-defuse .dx-mod[data-mod="morse"] .mx-rays { display: none; }
  .g-defuse .dx-mod[data-mod="morse"] .mx-lamp.is-on .mx-lens { stroke-width: 5; }
}
.g-defuse .dx-morse-dot, .g-defuse .dx-morse-dash { display: inline-block; height: 10px; margin-right: 3px; background: var(--g-ink); border-radius: 5px; vertical-align: middle; }
.g-defuse .dx-morse-dot { width: 10px; } .g-defuse .dx-morse-dash { width: 24px; }
.g-defuse .dx-morse-chart { list-style: none; margin: 8px 0 4px; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.g-defuse .dx-morse-chart li { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 34px; padding: 3px 8px; background: var(--g-bg); border: 2px solid var(--g-ink); border-radius: 8px; }
.g-defuse .dx-morse-chart li > span { display: flex; align-items: center; min-width: 0; }
.g-defuse .dx-morse-chart b { font: 400 1.05rem/1 var(--g-font-display); }
.g-defuse .dx-morse-chart li.is-gap { grid-column: 1 / -1; min-height: 0; padding: 0; border: 0; background: none; }
.g-defuse .dx-morse-twin { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }
.g-defuse .dx-morse-twin td { font-variant-numeric: tabular-nums; }
@media (max-width: 440px) { .g-defuse .dx-morse-chart { grid-template-columns: repeat(2, minmax(0, 1fr)); } .g-defuse .dx-morse-dash { width: 20px; } }
`,

  rules(r, T) {
    const lv = Math.max(1, Math.min(4, ((T && T.level) | 0) || 1));
    const n = lv >= 3 ? 16 : lv === 2 ? 14 : 12;
    let chart = { ...STD };
    if (lv >= 2) {
      // a bijection letters -> the 26 standard codes: every pattern still decodes to exactly one letter
      const codes = shuffle(r, CODES);
      chart = {};
      LETTERS.forEach((l, i) => { chart[l] = codes[i]; });
    }
    const words = pickWords(r, n);
    const freqs = [];
    let f = BANDS[int(r, BANDS.length)] + 5 * int(r, 6);
    for (let i = 0; i < n; i++) { freqs.push(f); f += 5 * (2 + int(r, 3)); }
    const perm = shuffle(r, freqs.map((_, i) => i));
    const table = words.map((w, i) => [w, perm[i]]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return { unit: UNIT[lv - 1], chart, freqs, table };
  },

  // Slip: two words swap their frequencies.
  errata(r, R) {
    const n = R.table.length;
    const i = int(r, n);
    let j = int(r, n - 1);
    if (j >= i) j++;
    const t = R.table.map((x) => [...x]);
    const fi = t[i][1];
    t[i][1] = t[j][1];
    t[j][1] = fi;
    const note = `<span data-errata="swap" data-a="${t[i][0]}" data-b="${t[j][0]}">In the frequency table <b>${t[i][0]}</b> is now <b>${khzText(R.freqs[t[i][1]])}</b> MHz and <b>${t[j][0]}</b> is now <b>${khzText(R.freqs[t[j][1]])}</b> MHz.</span>`;
    return { R: { ...R, table: t }, note };
  },

  page(R) {
    const std = sameChart(R.chart);
    const used = [...new Set(R.table.flatMap(([w]) => [...w]))].sort(byCode(R.chart));
    const chart = used.map((l) => `<li data-letter="${l}" data-code="${R.chart[l]}" aria-label="${spoken(R.chart[l])}, letter ${l}"><span>${symbols(R.chart[l])}</span><b>${l}</b></li>`).join('');
    const half = Math.ceil(R.table.length / 2);
    const tbl = (rows) => `<table data-table="morse-freq"><thead><tr><th scope="col">Word</th><th scope="col">MHz</th></tr></thead><tbody>${rows.map(([w, fi]) => `<tr data-word="${w}" data-khz="${R.freqs[fi]}"><th scope="row">${w}</th><td>${khzText(R.freqs[fi])}</td></tr>`).join('')}</tbody></table>`;
    return `
      <p class="dx-intro">A lamp on the bomb blinks a word in dots and dashes, over and over. Your partner describes the flashes, you decode the word, and tell them which frequency to tune before they press TX.</p>
      <ol class="dx-rules">
        <li data-rule="m1"><span>Ask your partner to call the flashes letter by letter: a <b>short</b> flash is a dot, a <b>long</b> flash is a dash. A longer dark gap separates the letters, and the small dots under the lamp show which letter is being sent. A long pause means the word starts again.</span></li>
        <li data-rule="m2"><span>Look each letter up in the code chart below.${std ? ' This bomb uses the standard Morse code.' : ' <b>This bomb has its own code: ignore any Morse you know.</b> Only the chart below counts.'}</span></li>
        <li data-rule="m3"><span>Find the word in the frequency table and read its frequency.</span></li>
        <li data-rule="m4"><span>Tell your partner to step the tuner to that frequency, then press TX. A wrong TX is a strike.</span></li>
      </ol>
      <p class="dx-note" data-tip="two-letters">Tip: no two words in the table start with the same two letters. Once you have decoded the first two letters you know the word, so you can stop your partner early.</p>
      <h4>Code chart</h4>
      <ul class="dx-morse-chart" data-chart="${std ? 'standard' : 'custom'}">${chart}</ul>
      <h4>Words and frequencies</h4>
      <div class="dx-morse-twin">${tbl(R.table.slice(0, half))}${tbl(R.table.slice(half))}</div>
      <p class="dx-note">The tuner has ${R.freqs.length} stops, lowest to highest, and wraps around.</p>`;
  },

  gen(r, E, R) {
    const n = R.freqs.length;
    const [word, want] = R.table[int(r, n)];
    let start = int(r, n);
    for (let k = 0; k < 20; k++) {
      const d = (start - want + n) % n;
      if (d >= 2 && d <= n - 2) break;
      start = int(r, n);
    }
    if (start === want) start = (want + 3) % n;
    return { word, start };
  },

  solve(S, E, R) {
    const row = R.table.find((x) => x[0] === S.word);
    return row ? row[1] : -1;
  },

  mount(box, S, R, host) {
    const n = R.freqs.length;
    const want = MORSE.solve(S, host.E, R, host.T);
    const saved = host.saved && Number.isInteger(host.saved.f) && host.saved.f >= 0 && host.saved.f < n ? host.saved.f : null;
    let cur = saved === null ? S.start : saved;
    let done = false;
    let lastBad = null;

    const seg = morseTimeline(S.word, R.chart, R.unit);
    const starts = [];
    let cycle = 0;
    for (const g of seg) { starts.push(cycle); cycle += g[1]; }
    let t = Math.max(0, cycle - 4 * R.unit);
    let lastNow = 0;
    let on = false;
    let letter = -2;

    const rays = Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4 + Math.PI / 8;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const pts = `x1="${(60 + c * 48).toFixed(1)}" y1="${(60 + s * 48).toFixed(1)}" x2="${(60 + c * 57).toFixed(1)}" y2="${(60 + s * 57).toFixed(1)}"`;
      return `<line class="o" ${pts}/><line class="c" ${pts}/>`;
    }).join('');
    box.innerHTML = `<div class="mx">
      <button type="button" class="mx-lamp" data-act="again" data-on="0" aria-label="Signal lamp. Tap to restart the message.">
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="mx-shd" cx="63" cy="64" r="43"/><circle class="mx-bez" cx="60" cy="60" r="43"/><circle class="mx-ring" cx="60" cy="60" r="38"/><circle class="mx-lens" cx="60" cy="60" r="31"/><path class="mx-glint" d="M44 50 A18 18 0 0 1 56 41"/><g class="mx-rays">${rays}</g></svg>
      </button>
      <div class="mx-pips" aria-hidden="true">${[...S.word].map(() => '<i></i>').join('')}</div>
      <div class="mx-tune">
        <button type="button" class="mx-step" data-act="prev" aria-label="Lower frequency"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4 L6 12 L16 20 Z"/></svg></button>
        <div class="mx-lcd"><output class="mx-freq" aria-live="polite"></output><span class="mx-mhz">MHz</span></div>
        <button type="button" class="mx-step" data-act="next" aria-label="Higher frequency"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4 L18 12 L8 20 Z"/></svg></button>
      </div>
      <div class="mx-scale" aria-hidden="true">${R.freqs.map(() => '<i></i>').join('')}</div>
      <button type="button" class="mx-tx" data-act="tx" aria-label="Transmit on the tuned frequency">TX <small>SEND</small></button>
    </div>`;
    const root = box.querySelector('.mx');
    const lamp = box.querySelector('.mx-lamp');
    const out = box.querySelector('.mx-freq');
    const pips = box.querySelectorAll('.mx-pips i');
    const ticks = box.querySelectorAll('.mx-scale i');

    function paintFreq() {
      out.textContent = khzText(R.freqs[cur]);
      out.dataset.idx = String(cur);
      ticks.forEach((tk, i) => tk.classList.toggle('is-now', i === cur));
    }
    function paintLamp(m) {
      let i = seg.length - 1;
      while (i > 0 && starts[i] > m) i--;
      const g = seg[i];
      const nOn = g[0] === 1;
      if (nOn !== on) { on = nOn; lamp.classList.toggle('is-on', on); lamp.dataset.on = on ? '1' : '0'; }
      if (g[2] !== letter) { letter = g[2]; pips.forEach((p, k) => p.classList.toggle('is-now', k === letter)); }
    }
    function step(d) {
      cur = (cur + d + n) % n;
      host.sfx('tick');
      paintFreq();
    }
    function tx() {
      const now = host.now();
      if (cur === want) {
        done = true;
        root.dataset.done = '1';
        lamp.classList.remove('is-on');
        lamp.classList.add('is-ok');
        lamp.dataset.on = '0';
        host.sfx('tap');
        host.solve();
        return;
      }
      if (lastBad && lastBad.f === cur && now - lastBad.at < 400) return; // a double tap is one mistake
      lastBad = { f: cur, at: now };
      host.strike('morse');
    }
    function act(a) {
      if (done || host.busy()) return;
      if (a === 'prev') step(-1);
      else if (a === 'next') step(1);
      else if (a === 'tx') tx();
      else if (a === 'again') { t = Math.max(0, cycle - 2 * R.unit); host.sfx('tap'); }
    }

    paintFreq();
    paintLamp(t % cycle);

    return {
      click(e) {
        const b = e.target.closest && e.target.closest('[data-act]');
        if (b && box.contains(b)) act(b.dataset.act);
      },
      key(e) {
        if (e.type && e.type !== 'keydown') return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); act('prev'); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); act('next'); }
      },
      frame(now, dt) {
        const d = lastNow ? now - lastNow : (dt > 0 ? dt : 0);
        lastNow = now;
        if (done || host.busy()) return;
        t += Math.max(0, Math.min(200, d));
        paintLamp(t % cycle);
      },
      save() { return { f: cur }; },
      destroy() {},
    };
  },

  drive(S, E, R, live) {
    const n = R.freqs.length;
    const want = MORSE.solve(S, E, R);
    const from = live && Number.isInteger(live.f) ? live.f : S.start;
    const fwd = (want - from + n) % n;
    const back = n - fwd;
    const q = (a) => `.dx-mod[data-mod="morse"] [data-act="${a}"]`;
    const out = [];
    const a = fwd <= back ? 'next' : 'prev';
    for (let i = 0; i < Math.min(fwd, back); i++) out.push({ sel: q(a), act: 'tap' });
    out.push({ sel: q('tx'), act: 'tap' });
    return out;
  },
};
