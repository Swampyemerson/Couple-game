// Defuse module: SWITCHES, the breaker panel.
//
// Bomb: five toggle switches (up / down), a row of status LEDs (red, blue, yellow, green or off)
// and a SET key. Flipping a switch is free; SET judges the whole row. The bomb holder reports the
// LED colours and where every switch starts; the manual runs them through a rule chain drawn per
// round (an LED table, edgework modifiers, state-dependent steps) and answers with the target row.
//
// Pure parts: rules / errata / page / gen / solve. S = { sw: [0|1 x5] (1 = up), leds: ['red'|'off'...] }.
// The answer is the target row: an array of five 0|1 (1 = up).
//
// Ops are short strings: 'f3' flip switch 3, 'u2' put switch 2 up, 'd5' put switch 5 down (1-based).
// Conditions are codes: vowel, novowel, even, odd, batmore (more batteries than lit LEDs), bat0, bat2,
// lit:XYZ (indicator lit), port:RJ45, led:red (a lit LED of that colour), up:3 / dn:3 (switch 3 is up /
// down at this point of the chain).
import { ctxOf, int, sample, swatch, NUM } from './util.js';

const N = 5;
const COLS = ['red', 'blue', 'yellow', 'green'];
const CAPS = ['orange', 'purple', 'white', 'black', 'teal'];
const INDS = ['RDY', 'PWR', 'AUX', 'LNK', 'SYS', 'CLR', 'IGN', 'MSA'];
const PORTS = ['DVI', 'PS2', 'RJ45', 'SERIAL'];

/** "an RJ45", "a DVI": the article for a port label as it is said aloud. */
const an = (word) => `${/^(RJ|[AEIOU])/.test(word) ? 'an' : 'a'} ${word}`;
const lvOf = (T) => Math.max(1, Math.min(4, ((T && T.level) | 0) || 1));

/** Does condition c hold? s = the row right now, leds = this bomb's LEDs. */
export function holds(c, E, s, leds) {
  const K = ctxOf(E);
  const [k, v] = c.split(':');
  switch (k) {
    case 'vowel': return K.vowel;
    case 'novowel': return !K.vowel;
    case 'even': return K.even;
    case 'odd': return !K.even;
    case 'batmore': return E.batteries > leds.filter((x) => x !== 'off').length;
    case 'bat0': return E.batteries === 0;
    case 'bat2': return E.batteries >= 2;
    case 'lit': return K.lit(v);
    case 'port': return (E.ports || []).includes(v);
    case 'led': return leds.includes(v);
    case 'up': return s[+v - 1] === 1;
    case 'dn': return s[+v - 1] === 0;
    default: return false;
  }
}
function condText(c) {
  const [k, v] = c.split(':');
  switch (k) {
    case 'vowel': return 'the serial number has a vowel';
    case 'novowel': return 'the serial number has no vowel';
    case 'even': return 'the last digit of the serial number is even';
    case 'odd': return 'the last digit of the serial number is odd';
    case 'batmore': return 'there are more batteries than lit LEDs';
    case 'bat0': return 'there are no batteries';
    case 'bat2': return `there are ${NUM[2]} or more batteries`;
    case 'lit': return `the ${v} indicator is lit`;
    case 'port': return `the bomb has ${an(v)} port`;
    case 'led': return `a ${v} LED is lit`;
    case 'up': return `switch ${v} is up right now`;
    case 'dn': return `switch ${v} is down right now`;
    default: return c;
  }
}
function applyOps(s, ops) {
  for (const o of ops) {
    const k = +o.slice(1) - 1;
    if (o[0] === 'f') s[k] ^= 1; else s[k] = o[0] === 'u' ? 1 : 0;
  }
}
/** 'f1 f4' -> "flip 1 and 4";  'f1 u4' -> "flip 1, then put 4 up". */
function opsText(ops) {
  if (ops.every((o) => o[0] === 'f')) return `flip ${ops.map((o) => o.slice(1)).join(' and ')}`;
  return ops.map((o) => (o[0] === 'f' ? `flip ${o.slice(1)}` : `put ${o.slice(1)} ${o[0] === 'u' ? 'up' : 'down'}`)).join(', then ');
}
const up1 = (s) => s[0].toUpperCase() + s.slice(1);

function kind(r, lv) {
  if (lv === 1) return 'f';
  const x = r();
  return x < 0.55 ? 'f' : x < 0.78 ? 'u' : 'd';
}
/** k operations on k different switches, listed from the lowest switch up ("Flip 3 and 5", never "Flip 5 and 3"). Operations on different switches do not interact, so the order is only for reading. */
function opsFor(r, lv, k) {
  return sample(r, [1, 2, 3, 4, 5], k).sort((a, b) => a - b).map((n) => kind(r, lv) + n);
}
/** What a list of operations does, whatever order it is written in: the colour rows of a table must all differ in this. */
const effectOf = (ops) => ops.slice().sort().join(' ');

/** The row the bomb needs. */
function target(S, E, R) {
  const s = S.sw.slice();
  const lit = S.leds.filter((c) => c !== 'off');
  const order = R.rev && holds(R.rev, E, s, S.leds) ? lit.slice().reverse() : lit;
  for (const c of order) applyOps(s, R.map[c] || []);
  for (const m of R.mods) if (holds(m.c, E, s, S.leds)) applyOps(s, m.ops);
  return s;
}
const clean = (s, R) => R.forbid.every((f) => !f.every(([k, v]) => s[k] === v));

/** A puzzle (start row + LEDs) whose answer is clean and differs from the start, searched in a fixed order. */
function findPuzzle(R, E) {
  const opts = ['off', ...R.cols];
  const total = opts.length ** R.leds;
  for (let sw = 0; sw < 32; sw++) {
    const row = [0, 1, 2, 3, 4].map((i) => (sw >> i) & 1);
    for (let k = 1; k < total; k++) {
      const leds = Array.from({ length: R.leds }, (_, i) => opts[Math.floor(k / opts.length ** i) % opts.length]);
      if (leds.every((c) => c === 'off')) continue;
      const S = { sw: row, leds };
      const a = target(S, E, R);
      if (a.join('') !== row.join('') && clean(a, R)) return S;
    }
  }
  return null;
}
/** Every combination of edgework facts the conditions can look at has at least one valid puzzle. */
function everyEdgeworkSolvable(R) {
  const conds = [R.rev, ...R.mods.map((m) => m.c)].filter(Boolean);
  const lits = conds.filter((c) => c.startsWith('lit:')).map((c) => c.slice(4));
  const ports = conds.filter((c) => c.startsWith('port:')).map((c) => c.slice(5));
  const has = (re) => conds.some((c) => re.test(c));
  const both = [0, 1];
  const one = [0];
  // only vary the facts a condition can look at
  for (const vowel of has(/^(no)?vowel$/) ? both : one) for (const odd of has(/^(even|odd)$/) ? both : one) for (const bat of has(/^bat/) ? [0, 1, 2, 3, 4] : one) for (const li of lits.length ? both : one) for (const pt of ports.length ? both : one) {
    const E = { serial: (vowel ? 'A' : 'B') + 'BCDF' + (odd ? '1' : '2'), batteries: bat, indicators: lits.map((label) => ({ label, lit: !!li })), ports: pt ? ports : [] };
    if (!findPuzzle(R, E)) return false;
  }
  return true;
}

export const SWITCHES = {
  id: 'switches',
  name: 'Breaker panel',
  tab: 'Breakers',
  tiers: ['chill', 'normal', 'spicy', 'wild'],
  needy: false,
  remote: false,
  css: `
.g-defuse .dx-mod[data-mod="switches"] { --sx-orange: #f08a24; --sx-purple: #8a5ad8; --sx-white: var(--dx-white); --sx-black: var(--dx-black); --sx-teal: #17a8a4; }
.g-defuse .dx-mod[data-mod="switches"] .sx { width: 100%; display: flex; flex-direction: column; align-items: stretch; gap: 10px; }
.g-defuse .dx-mod[data-mod="switches"] .sx button { touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
.g-defuse .dx-mod[data-mod="switches"] .sx-plate { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 10px; background: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 10px; box-shadow: inset 0 -4px 0 rgb(255 255 255 / 0.06); }
.g-defuse .dx-mod[data-mod="switches"] .sx-plate .dx-tag { color: #8d8a80; font-size: 0.7rem; }
.g-defuse .dx-mod[data-mod="switches"] .sx-leds { display: flex; gap: 9px; }
.g-defuse .dx-mod[data-mod="switches"] .sx-led { display: grid; place-items: center; width: 26px; height: 26px; border: 2.5px solid var(--g-ink); border-radius: 50%; background: #3a3842; color: var(--dx-dark); font: 900 0.7rem/1 var(--g-font-body); }
.g-defuse .dx-mod[data-mod="switches"] .sx-led[data-led-color="red"] { background: var(--dx-red); }
.g-defuse .dx-mod[data-mod="switches"] .sx-led[data-led-color="blue"] { background: var(--dx-blue); color: var(--dx-white); }
.g-defuse .dx-mod[data-mod="switches"] .sx-led[data-led-color="yellow"] { background: var(--dx-yellow); }
.g-defuse .dx-mod[data-mod="switches"] .sx-led[data-led-color="green"] { background: var(--dx-green); color: var(--dx-white); }
.g-defuse .dx-mod[data-mod="switches"] .sx-led[data-led-color="off"] { color: transparent; }
.g-defuse .dx-mod[data-mod="switches"] .sx-row { display: grid; grid-template-columns: repeat(5, minmax(44px, 1fr)); gap: 4px; }
.g-defuse .dx-mod[data-mod="switches"] .sx-sw { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 44px; min-height: 134px; padding: 7px 2px 5px; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 10px; box-shadow: 0 4px 0 var(--g-edge, var(--g-ink)); transition: transform 0.16s var(--g-ease-spring); }
.g-defuse .dx-mod[data-mod="switches"] .sx-sw:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--g-edge, var(--g-ink)); }
.g-defuse .dx-mod[data-mod="switches"] .sx-slot { position: relative; flex: none; width: 26px; height: 84px; background: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 13px; }
.g-defuse .dx-mod[data-mod="switches"] .sx-slot::before, .g-defuse .dx-mod[data-mod="switches"] .sx-slot::after { content: ''; position: absolute; left: 50%; margin-left: -4px; border: 4px solid transparent; }
.g-defuse .dx-mod[data-mod="switches"] .sx-slot::before { top: 5px; border-bottom: 5px solid #5d5a66; border-top: 0; }
.g-defuse .dx-mod[data-mod="switches"] .sx-slot::after { bottom: 5px; border-top: 5px solid #5d5a66; border-bottom: 0; }
.g-defuse .dx-mod[data-mod="switches"] .sx-lever { position: absolute; left: 50%; top: 3px; z-index: 1; width: 36px; height: 40px; margin-left: -18px; background: var(--cap); border: 2.5px solid var(--g-ink); border-radius: 9px; box-shadow: 2px 3px 0 var(--g-edge, var(--g-ink)); transition: transform 0.2s var(--g-ease-spring); }
.g-defuse .dx-mod[data-mod="switches"] .sx-lever::after { content: ''; position: absolute; left: 6px; right: 6px; top: 50%; height: 3px; margin-top: -1.5px; border-radius: 2px; background: color-mix(in srgb, var(--dx-dark) 40%, transparent); }
.g-defuse .dx-mod[data-mod="switches"] .sx-sw.is-down .sx-lever { transform: translateY(31px); }
.g-defuse .dx-mod[data-mod="switches"] .sx-n { font: 400 1.05rem/1 var(--g-font-display); }
.g-defuse .dx-mod[data-mod="switches"] .sx-pos { font: 800 0.7rem/1 var(--g-font-body); letter-spacing: 0.1em; color: var(--g-muted); }
.g-defuse .dx-mod[data-mod="switches"] .sx-set { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 54px; background: var(--dx-yellow); color: var(--dx-dark); border: 3px solid var(--g-ink); border-radius: 12px; box-shadow: 0 6px 0 var(--g-edge, var(--g-ink)); font: 400 1.3rem/1 var(--g-font-display); letter-spacing: 0.12em; transition: transform 0.16s var(--g-ease-spring); }
.g-defuse .dx-mod[data-mod="switches"] .sx-set:active { transform: translateY(5px); box-shadow: 0 1px 0 var(--g-edge, var(--g-ink)); }
.g-defuse .dx-mod[data-mod="switches"] .sx-sw:focus-visible, .g-defuse .dx-mod[data-mod="switches"] .sx-set:focus-visible { outline: 3px solid var(--p-a); outline-offset: 3px; }
.g-defuse .dx-mod[data-mod="switches"] .sx[data-done="1"] button { pointer-events: none; }
.g-defuse .dx-mod[data-mod="switches"] .sx[data-done="1"] .sx-set { opacity: 0.55; }
.g-defuse .dx-switches-table th[scope="row"] { width: 34%; }
.g-defuse .dx-switches-note { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.g-defuse .dx-switches-note li { padding: 6px 10px; border: 2px dashed var(--g-ink); border-radius: 8px; }
`,

  rules(r, T) {
    const lv = lvOf(T);
    const cols = sample(r, COLS, lv === 1 ? 3 : 4);
    const leds = lv === 1 ? 2 : 3;
    // LED table: each colour touches two different switches; the first switches are all different
    // and no two colours may end up doing the same thing (it would look like a misprint): draw again until all differ
    let map = {};
    for (let tries = 0; tries < 200; tries++) {
      const firsts = sample(r, [0, 1, 2, 3, 4], cols.length);
      map = {};
      cols.forEach((c, i) => {
        let b = int(r, N);
        while (b === firsts[i]) b = int(r, N);
        map[c] = [firsts[i], b].sort((x, y) => x - y).map((k) => kind(r, lv) + (k + 1));
      });
      if (new Set(cols.map((c) => effectOf(map[c]))).size === cols.length) break;
    }
    // conditions drawn from distinct families
    const fams = [['vowel', 'novowel'], ['even', 'odd'], ['batmore', 'bat0', 'bat2'], INDS.map((l) => 'lit:' + l)];
    if (lv >= 2) fams.push(PORTS.map((p) => 'port:' + p), cols.map((c) => 'led:' + c));
    const nPlain = lv <= 2 ? 1 : 2;
    const hasRev = lv >= 2 && r() < (lv === 2 ? 0.6 : 0.85);
    const picked = sample(r, fams, nPlain + (hasRev ? 1 : 0)).map((f) => f[int(r, f.length)]);
    const mods = picked.slice(0, nPlain).map((c) => ({ c, ops: [kind(r, lv) + (1 + int(r, N))] }));
    const rev = hasRev ? picked[nPlain] : null;
    const nState = lv === 1 ? 0 : lv === 4 ? 2 : 1;
    for (let i = 0; i < nState; i++) {
      const j = 1 + int(r, N);
      let k = 1 + int(r, N);
      while (k === j) k = 1 + int(r, N);
      mods.push({ c: (r() < 0.5 ? 'up:' : 'dn:') + j, ops: [kind(r, lv) + k] });
    }
    const nForbid = lv < 3 ? 0 : lv === 3 ? 2 : 3;
    let forbid = [];
    // Safety checks must never contradict the answer: keep drawing until, for every kind of edgework
    // the conditions can see, some puzzle still has a clean answer.
    for (let tries = 0; nForbid && tries < 60; tries++) {
      forbid = [];
      while (forbid.length < nForbid) {
        const [a, b] = sample(r, [0, 1, 2, 3, 4], 2).sort();
        const f = [[a, int(r, 2)], [b, int(r, 2)]];
        if (!forbid.some((g) => g[0][0] === a && g[1][0] === b)) forbid.push(f);
      }
      if (everyEdgeworkSolvable({ leds, cols, map, rev, mods, forbid })) break;
    }
    return { leds, cols, map, rev, mods, forbid };
  },

  // Slip: one colour of the LED table is reprinted with new instructions.
  errata(r, R, T) {
    const lv = lvOf(T);
    const c = R.cols[int(r, R.cols.length)];
    const others = R.cols.filter((x) => x !== c).map((x) => effectOf(R.map[x]));
    let ops;
    let R2;
    for (let tries = 0; tries < 40; tries++) {
      ops = opsFor(r, lv, 2);
      if (effectOf(ops) === effectOf(R.map[c]) || others.includes(effectOf(ops))) continue;
      R2 = { ...R, map: { ...R.map, [c]: ops } };
      if (everyEdgeworkSolvable(R2)) break;
      R2 = null;
    }
    if (!R2) return null;
    return {
      R: R2,
      note: `<span data-errata="map" data-led-color="${c}" data-ops="${ops.join(' ')}">A <b>${c}</b> LED now means: ${opsText(ops)}.</span>`,
    };
  },

  page(R) {
    const steps = [
      `<li data-step="start"><span>Ask for the position of every switch, <b>up</b> or <b>down</b>, numbered 1 to 5 from the left. That row is your starting point.</span></li>`,
      `<li data-step="leds"><span>Ask for the status LEDs from the left: a colour, or off. Take the <b>lit</b> LEDs one at a time from the left and do what the table below says for its colour. Do them in order, one after the other. An LED that is off does nothing.</span></li>`,
    ];
    if (R.rev) steps.push(`<li data-rev-if="${R.rev}"><span>If ${condText(R.rev)}, take the lit LEDs from the <b>right</b> instead.</span></li>`);
    R.mods.forEach((m) => steps.push(`<li data-mod-if="${m.c}" data-ops="${m.ops.join(' ')}"><span>Then, if ${condText(m.c)}, ${opsText(m.ops)}.</span></li>`));
    steps.push(`<li data-step="end"><span>The row you end with is the target. Tell your partner which switches to flip to match it, then press SET.</span></li>`);
    const rows = R.cols.map((c) => `<tr data-led-color="${c}" data-ops="${R.map[c].join(' ')}"><th scope="row">${swatch(c)}</th><td>${up1(opsText(R.map[c]))}</td></tr>`).join('');
    const forbid = R.forbid.length
      ? `<h4>Safety check</h4><p>The right answer never has any of these. If your target does, you slipped somewhere: go back and check.</p><ul class="dx-switches-note">${R.forbid.map((f) => `<li data-forbid="${f.map(([k, v]) => (k + 1) + (v ? 'u' : 'd')).join(' ')}">Switch ${f[0][0] + 1} ${f[0][1] ? 'up' : 'down'} together with switch ${f[1][0] + 1} ${f[1][1] ? 'up' : 'down'}</li>`).join('')}</ul>`
      : '';
    return `
      <p class="dx-intro">Five toggle switches, a row of status LEDs and a SET key. Flipping a switch costs nothing; pressing SET with the wrong row is a strike.</p>
      <ol class="dx-rules">${steps.join('')}</ol>
      <h4>LED table</h4>
      <table class="dx-switches-table" data-table="switches-leds" data-leds="${R.leds}"><thead><tr><th scope="col">LED</th><th scope="col">Do this</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="dx-note">"Flip" turns a switch over. "Put 3 up" means leave it if it is already up. There are ${R.leds} LEDs; any of them can be off.</p>
      ${forbid}`;
  },

  gen(r, E, R) {
    let last = null;
    for (let k = 0; k < 400; k++) {
      const leds = Array.from({ length: R.leds }, () => (r() < 0.78 ? R.cols[int(r, R.cols.length)] : 'off'));
      if (leds.every((c) => c === 'off')) continue;
      const sw = Array.from({ length: N }, () => int(r, 2));
      const S = { sw, leds };
      last = S;
      const a = target(S, E, R);
      if (a.join('') === sw.join('') || !clean(a, R)) continue;
      return S;
    }
    return findPuzzle(R, E) || last;
  },

  solve(S, E, R) { return target(S, E, R); },

  mount(box, S, R, host) {
    const want = target(S, host.E, R);
    const sv = host.saved && Array.isArray(host.saved.s) && host.saved.s.length === N && host.saved.s.every((x) => x === 0 || x === 1) ? host.saved.s : null;
    const sw = sv ? sv.slice() : S.sw.slice();
    let done = false;
    let lastBad = null;
    const letter = { red: 'R', blue: 'B', yellow: 'Y', green: 'G', off: '' };

    box.innerHTML = `<div class="sx">
      <div class="sx-plate"><span class="dx-tag">Status</span><div class="sx-leds" role="group" aria-label="Status LEDs, left to right">${S.leds.map((c, i) => `<i class="sx-led" data-led-color="${c}" role="img" aria-label="LED ${i + 1}: ${c === 'off' ? 'off' : c}">${letter[c]}</i>`).join('')}</div></div>
      <div class="sx-row" role="group" aria-label="Switches">${sw.map((v, i) => `<button type="button" class="sx-sw" role="switch" data-sw="${i}" style="--cap: var(--sx-${CAPS[i]})"><span class="sx-slot"><span class="sx-lever"></span></span><b class="sx-n">${i + 1}</b><span class="sx-pos"></span></button>`).join('')}</div>
      <button type="button" class="sx-set" data-act="set" aria-label="Set the switches">SET</button>
    </div>`;
    const root = box.querySelector('.sx');
    const btns = box.querySelectorAll('.sx-sw');
    function paint() {
      btns.forEach((b, i) => {
        const up = sw[i] === 1;
        b.classList.toggle('is-up', up);
        b.classList.toggle('is-down', !up);
        b.dataset.pos = up ? 'up' : 'down';
        b.setAttribute('aria-checked', up ? 'true' : 'false');
        b.setAttribute('aria-label', `Switch ${i + 1}, ${up ? 'up' : 'down'}`);
        b.querySelector('.sx-pos').textContent = up ? 'UP' : 'DOWN';
      });
    }
    function setNow() {
      const now = host.now();
      const key = sw.join('');
      if (key === want.join('')) {
        done = true;
        root.dataset.done = '1';
        host.sfx('tap');
        host.solve();
        return;
      }
      if (lastBad && lastBad.k === key && now - lastBad.at < 400) return; // a double tap is one mistake
      lastBad = { k: key, at: now };
      host.strike('switches');
    }
    paint();

    return {
      click(e) {
        if (done || host.busy()) return;
        const el = e.target.closest && e.target.closest('.sx-sw, .sx-set');
        if (!el || !box.contains(el)) return;
        if (el.classList.contains('sx-set')) { setNow(); return; }
        const i = +el.dataset.sw;
        sw[i] ^= 1;
        host.sfx('flip');
        paint();
      },
      save() { return { s: sw.slice() }; },
      destroy() {},
    };
  },

  drive(S, E, R, live) {
    const want = target(S, E, R);
    const cur = live && Array.isArray(live.s) && live.s.length === N ? live.s : S.sw;
    const out = [];
    for (let i = 0; i < N; i++) if (cur[i] !== want[i]) out.push({ sel: `.dx-mod[data-mod="switches"] [data-sw="${i}"]`, act: 'tap' });
    out.push({ sel: '.dx-mod[data-mod="switches"] [data-act="set"]', act: 'tap' });
    return out;
  },
};
