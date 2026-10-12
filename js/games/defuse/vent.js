// Defuse module: VENT, the needy one. It never gets solved. Every so often the vent wakes with a short
// question and a 2-digit reading; the bomb holder reads both out loud, the manual holder looks up that
// question's decision rule (it depends on the reading and on the edgework) and says YES or NO. A wrong
// answer or a countdown that runs out is a strike.
//
// Data shapes (all JSON):
//   R = { rules: [ { p: 'VENT GAS', y: 'YES'|'NO', c: 'gt:48', f: ['lit:CLR', 'bat:2'] } ] }
//     p  the prompt word (shown as "VENT GAS?")
//     y  the answer when the reading test c is true (the opposite when it is false)
//     c  reading test: gt:n lt:n even odd mul3 tens dsum:n
//     f  flips: edgework tests; the answer is flipped once for each that is true
//          lit:L unlit:L bat:n serial-even serial-odd vowel port:P
//   S = { cd: 20000, acts: [ { atElapsedMs, prompt, reading } ... ] }   (12 activations)
//   solve(S, E, R) -> ['YES'|'NO', ...] one per activation
//   save() -> { i, e, on, c }  i = index of the NEXT activation to wake (the current one, when on, is i - 1),
//                              e = elapsed ms (frozen while busy), on = 1 while awake, c = ms left on its countdown
//   drive(S, E, R, live): pass the controller's save() as `live`; while awake it returns the right key.
import { int, pick, sample, shuffle, esc, ctxOf, NUM } from './util.js';

const POOL = ['VENT GAS', 'DUMP CORE', 'SEAL HATCH', 'COOL LOOP', 'FLUSH LINE', 'BOOST FAN'];
const LABELS = ['RDY', 'PWR', 'AUX', 'LNK', 'SYS', 'CLR', 'IGN', 'MSA'];
const PORTS = ['DVI', 'PS2', 'RJ45', 'SERIAL'];
const READ_KINDS = ['gt', 'lt', 'even', 'odd', 'mul3', 'tens', 'dsum'];
const ACTS = 12;
/** "an RJ45", "a DVI": the article for a port label as it is said aloud. */
const an = (word) => `${/^(RJ|[AEIOU])/.test(word) ? 'an' : 'a'} ${word}`;

function readTest(c, n) {
  const [k, v] = c.split(':');
  const t = Math.floor(n / 10), u = n % 10;
  switch (k) {
    case 'gt': return n > +v;
    case 'lt': return n < +v;
    case 'even': return n % 2 === 0;
    case 'odd': return n % 2 === 1;
    case 'mul3': return n % 3 === 0;
    case 'tens': return t > u;
    case 'dsum': return t + u > +v;
    default: return false;
  }
}
function edgeTest(c, E, K) {
  const [k, v] = c.split(':');
  switch (k) {
    case 'lit': return K.lit(v);
    case 'unlit': return E.indicators.some((i) => i.label === v && !i.lit);
    case 'bat': return K.bat >= +v;
    case 'serial-even': return K.even;
    case 'serial-odd': return !K.even;
    case 'vowel': return K.vowel;
    case 'port': return (E.ports || []).includes(v);
    default: return false;
  }
}
function answerOf(rule, n, E, K) {
  let yes = readTest(rule.c, n) ? rule.y === 'YES' : rule.y !== 'YES';
  if (rule.f.filter((f) => edgeTest(f, E, K)).length % 2) yes = !yes;
  return yes ? 'YES' : 'NO';
}

function readText(c) {
  const [k, v] = c.split(':');
  switch (k) {
    case 'gt': return `the reading is above ${v}`;
    case 'lt': return `the reading is below ${v}`;
    case 'even': return 'the reading is even';
    case 'odd': return 'the reading is odd';
    case 'mul3': return 'the reading is in the three times table (3, 6, 9, 12 and so on)';
    case 'tens': return 'the first digit is bigger than the second digit';
    case 'dsum': return `the two digits add up to more than ${v}`;
    default: return '';
  }
}
function edgeText(c) {
  const [k, v] = c.split(':');
  switch (k) {
    case 'lit': return `the ${v} indicator is lit`;
    case 'unlit': return `the ${v} indicator is unlit`;
    case 'bat': return `the bomb has ${NUM[+v]} or more batteries`;
    case 'serial-even': return 'the last digit of the serial is even';
    case 'serial-odd': return 'the last digit of the serial is odd';
    case 'vowel': return 'the serial has a vowel in it';
    case 'port': return `the bomb has ${an(v)} port`;
    default: return '';
  }
}

function drawRead(r, kind) {
  switch (kind) {
    case 'gt': return 'gt:' + (35 + int(r, 31));
    case 'lt': return 'lt:' + (35 + int(r, 31));
    case 'dsum': return 'dsum:' + (8 + int(r, 4));
    default: return kind;
  }
}
function drawEdge(r, kind) {
  switch (kind) {
    case 'lit': return 'lit:' + pick(r, LABELS);
    case 'unlit': return 'unlit:' + pick(r, LABELS);
    case 'bat': return 'bat:' + (1 + int(r, 3));
    case 'parity': return r() < 0.5 ? 'serial-even' : 'serial-odd';
    case 'vowel': return 'vowel';
    default: return 'port:' + pick(r, PORTS);
  }
}

export const VENT = {
  id: 'vent',
  name: 'Vent',
  tab: 'Vent',
  tiers: ['normal', 'spicy', 'wild'],
  needy: true,
  remote: false,

  rules(r, T) {
    const level = T?.level || 2;
    const n = level >= 3 ? 3 + int(r, 2) : 2 + int(r, 2);
    const prompts = sample(r, POOL, Math.min(n, POOL.length));
    const kinds = shuffle(r, READ_KINDS);
    const flipCount = level >= 4 ? 2 : level === 3 ? 1 : level === 2 ? (r() < 0.5 ? 1 : 0) : 0;
    return {
      rules: prompts.map((p, i) => {
        const f = [];
        const fk = shuffle(r, ['lit', 'unlit', 'bat', 'parity', 'vowel', 'port']);
        for (let j = 0; j < flipCount; j++) f.push(drawEdge(r, fk[j]));
        return { p, y: r() < 0.5 ? 'YES' : 'NO', c: drawRead(r, kinds[i % kinds.length]), f };
      }),
    };
  },

  page(R, T) {
    const secs = (T?.level || 2) >= 4 ? 15 : 20;
    const items = R.rules.map((q) => {
      const other = q.y === 'YES' ? 'NO' : 'YES';
      let flip = '';
      if (q.f.length === 1) flip = ` Then <b>flip</b> your answer (YES becomes NO, NO becomes YES) if ${edgeText(q.f[0])}.`;
      else if (q.f.length > 1) flip = ` Then <b>flip</b> your answer once for each of these that is true: ${q.f.map(edgeText).join('; ')}.`;
      return `<li data-vent-prompt="${esc(q.p)}" data-yes="${q.y}" data-cond="${esc(q.c)}" data-flip="${esc(q.f.join('|'))}"><span><b>${esc(q.p)}?</b> Answer <b>${q.y}</b> if ${readText(q.c)}. Otherwise <b>${other}</b>.${flip}</span></li>`;
    }).join('');
    return `<p class="dx-intro">Every so often the Vent wakes up and asks a question with a two digit reading. Your partner reads you both. Find the question below and say YES or NO. They have ${secs} seconds. A wrong answer or no answer is a strike. The Vent is never finished: it keeps coming back until the bomb is defused, and it does not count as a module.</p><ol class="dx-rules" data-vent-rules>${items}</ol><p class="dx-note">Questions you will not find here do not come up on this bomb.</p>`;
  },

  gen(r, E, R, T) {
    const level = T?.level || 2;
    const f = level >= 3 ? 0.86 : 1;
    const K = ctxOf(E);
    let t = Math.round((25000 + r() * 20000) / 100) * 100;
    const acts = [];
    const first = shuffle(r, R.rules.map((q) => q.p));
    for (let i = 0; i < ACTS; i++) {
      const prompt = i < first.length ? first[i] : R.rules[int(r, R.rules.length)].p;
      acts.push({ atElapsedMs: t, prompt, reading: 10 + int(r, 90) });
      t += Math.round(((35000 + r() * 25000) * f) / 100) * 100;
    }
    const ans = () => acts.map((a) => answerOf(R.rules.find((q) => q.p === a.prompt), a.reading, E, K));
    // keep both answers in play: at least 3 YES and 3 NO per schedule
    for (let guard = 0; guard < 600; guard++) {
      const a = ans();
      const yes = a.filter((x) => x === 'YES').length, no = ACTS - yes;
      if (yes >= 3 && no >= 3) break;
      const want = yes < 3 ? 'NO' : 'YES';
      const idx = a.map((x, i) => (x === want ? i : -1)).filter((i) => i >= 0);
      acts[idx[int(r, idx.length)]].reading = 10 + int(r, 90);
    }
    return { cd: level >= 4 ? 15000 : 20000, acts };
  },

  solve(S, E, R) {
    const K = ctxOf(E);
    return S.acts.map((a) => answerOf(R.rules.find((q) => q.p === a.prompt), a.reading, E, K));
  },

  mount(box, S, R, host) {
    const E = host.E;
    const K = ctxOf(E);
    const ans = S.acts.map((a) => answerOf(R.rules.find((q) => q.p === a.prompt), a.reading, E, K));
    box.innerHTML = `<div class="dx-vent" data-state="asleep">
  <div class="dx-vent-top">
    <svg class="dx-vent-gauge" viewBox="0 0 80 56" aria-hidden="true">
      <path class="g-face" d="M6 50 A34 34 0 0 1 74 50 Z"/>
      <path class="g-red" d="M60 21 A34 34 0 0 1 74 50 L66 50 A26 26 0 0 0 55 27 Z"/>
      <path class="g-ticks" d="M12 41 L16 43 M20 28 L24 31 M40 16 L40 21 M60 28 L56 31 M68 41 L64 43"/>
      <g class="g-needle" transform="rotate(-62 40 50)"><path d="M40 50 L40 20"/></g>
      <circle class="g-hub" cx="40" cy="50" r="4.5"/>
    </svg>
    <div class="dx-vent-lcd" aria-live="polite">
      <span class="dx-vent-tag">PRESSURE</span>
      <b class="dx-vent-q">STABLE</b>
      <span class="dx-vent-row"><span class="dx-vent-n" aria-hidden="true">--</span><span class="dx-vent-s"></span></span>
    </div>
  </div>
  <div class="dx-vent-bar" aria-hidden="true"><i></i></div>
  <div class="dx-vent-keys">
    <button type="button" class="dx-vent-key" data-vent-key="YES" disabled>YES</button>
    <button type="button" class="dx-vent-key is-no" data-vent-key="NO" disabled>NO</button>
  </div>
</div>`;
    const root = box.querySelector('.dx-vent');
    const q = box.querySelector('.dx-vent-q'), nEl = box.querySelector('.dx-vent-n'), sEl = box.querySelector('.dx-vent-s');
    const bar = box.querySelector('.dx-vent-bar i'), needle = box.querySelector('.g-needle');
    const keys = [...box.querySelectorAll('.dx-vent-key')];

    const st = { i: 0, e: 0, on: false, c: 0, cur: -1, t: 0, tapAt: -1e9, sec: -1, bar: -1, dead: false };
    const saved = host.saved;
    if (saved && typeof saved === 'object') {
      st.i = Math.max(0, Math.min(ACTS, saved.i | 0));
      st.e = Math.max(0, +saved.e || 0);
    }

    const setNeedle = (deg) => needle.setAttribute('transform', `rotate(${deg} 40 50)`);
    function sleep(bad) {
      st.on = false; st.cur = -1; st.sec = -1; st.bar = -1;
      root.dataset.state = 'asleep';
      root.classList.remove('is-urgent');
      q.textContent = 'STABLE'; nEl.textContent = '--'; sEl.textContent = '';
      bar.style.transform = 'scaleX(0)';
      setNeedle(-62);
      keys.forEach((k) => { k.disabled = true; });
      if (bad) { root.classList.add('is-bad'); host.later(() => { if (!st.dead) root.classList.remove('is-bad'); }, 650); }
    }
    function wake(idx, left) {
      const a = S.acts[idx];
      st.on = true; st.cur = idx; st.c = left; st.i = idx + 1; st.sec = -1; st.bar = -1;
      root.dataset.state = 'awake';
      root.dataset.ventI = String(idx);
      q.textContent = a.prompt + '?'; nEl.textContent = String(a.reading);
      setNeedle(Math.round(-70 + ((a.reading - 10) / 89) * 140));
      keys.forEach((k) => { k.disabled = false; });
      host.sfx('pop');
    }
    function answer(k) {
      if (!st.on || host.busy()) return;
      const now = host.now();
      if (now - st.tapAt < 400) return;
      st.tapAt = now;
      if (k === ans[st.cur]) { sleep(false); host.sfx('good'); }
      else { sleep(true); host.strike('vent'); }
    }
    function paint() {
      const f = Math.max(0, st.c / S.cd);
      const b = Math.round(f * 200);
      if (b !== st.bar) { st.bar = b; bar.style.transform = `scaleX(${(b / 200).toFixed(3)})`; }
      const s = Math.ceil(st.c / 1000);
      if (s !== st.sec) {
        st.sec = s; sEl.textContent = s + 's';
        const urgent = s <= 6;
        root.classList.toggle('is-urgent', urgent);
        if (s < 10 && s > 0) host.sfx('tick');
      }
    }
    if (saved && saved.on && st.i > 0 && st.i <= ACTS) wake(st.i - 1, Math.max(500, Math.min(S.cd, +saved.c || S.cd)));
    if (st.on) paint();

    return {
      click(e) {
        const b = e.target.closest && e.target.closest('[data-vent-key]');
        if (b) answer(b.dataset.ventKey);
      },
      key(e) {
        const k = (e.key || '').toLowerCase();
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (k === 'y') answer('YES'); else if (k === 'n') answer('NO');
      },
      frame(now) {
        let d = now - st.t; st.t = now;
        if (!(d > 0)) return;
        if (d > 250) d = 250;
        if (host.busy()) return;
        st.e += d;
        if (st.on) {
          st.c -= d;
          if (st.c <= 0) { st.c = 0; paint(); sleep(true); host.strike('vent'); return; }
          paint();
        } else {
          const a = S.acts[st.i];
          if (a && st.e >= a.atElapsedMs && (typeof host.left !== 'function' || host.left() > 5000)) wake(st.i, S.cd);
        }
      },
      save() { return { i: st.i, e: Math.round(st.e), on: st.on ? 1 : 0, c: Math.round(st.c) }; },
      destroy() { st.dead = true; },
    };
  },

  drive(S, E, R, live) {
    if (!live || !live.on || !(live.i > 0)) return [];
    const K = ctxOf(E);
    const a = S.acts[live.i - 1];
    if (!a) return [];
    const want = answerOf(R.rules.find((q) => q.p === a.prompt), a.reading, E, K);
    return [{ sel: `.dx-mod[data-mod="vent"] [data-vent-key="${want}"]`, act: 'tap' }];
  },

  css: `
.g-defuse .dx-mod[data-mod="vent"] .dx-vent { width: 100%; max-width: 300px; display: flex; flex-direction: column; gap: 10px; }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-top { display: flex; align-items: stretch; gap: 10px; }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-gauge { flex: none; width: 84px; height: auto; align-self: center; overflow: visible; }
.g-defuse .dx-mod[data-mod="vent"] .g-face { fill: var(--dx-white, #f8f5ec); stroke: var(--g-ink); stroke-width: 2.5; stroke-linejoin: round; }
.g-defuse .dx-mod[data-mod="vent"] .g-red { fill: var(--dx-red, #e0393e); stroke: var(--g-ink); stroke-width: 1.5; stroke-linejoin: round; }
.g-defuse .dx-mod[data-mod="vent"] .g-ticks { fill: none; stroke: var(--dx-dark, #18171d); stroke-width: 2; stroke-linecap: round; }
.g-defuse .dx-mod[data-mod="vent"] .g-needle path { fill: none; stroke: var(--dx-dark, #18171d); stroke-width: 3; stroke-linecap: round; }
.g-defuse .dx-mod[data-mod="vent"] .g-hub { fill: var(--dx-yellow, #ffd21f); stroke: var(--g-ink); stroke-width: 2.5; }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-lcd { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: 7px 10px 8px; background: var(--dx-dark, #18171d); border: 2.5px solid var(--g-ink); border-radius: 10px; color: var(--dx-yellow, #ffd21f); }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-tag { font: 800 0.6rem/1 var(--g-font-body); letter-spacing: 0.16em; color: #8d8a80; }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-q { font: 400 1.08rem/1.1 var(--g-font-display); letter-spacing: 0.02em; overflow-wrap: anywhere; }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-n { font: 400 2.1rem/1 var(--g-font-display); font-variant-numeric: tabular-nums; letter-spacing: 0.04em; }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-s { font: 800 0.9rem/1 var(--g-font-body); font-variant-numeric: tabular-nums; color: var(--dx-yellow, #ffd21f); }
.g-defuse .dx-mod[data-mod="vent"] [data-state="asleep"] .dx-vent-q { color: #8d8a80; font-size: 0.95rem; letter-spacing: 0.12em; }
.g-defuse .dx-mod[data-mod="vent"] [data-state="asleep"] .dx-vent-n { color: #55524b; }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-bar { height: 14px; padding: 2px; border: 2.5px solid var(--g-ink); border-radius: 8px; background: var(--dx-dark, #18171d); overflow: hidden; }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-bar i { display: block; height: 100%; border-radius: 4px; background: var(--dx-yellow, #ffd21f); transform-origin: 0 50%; transform: scaleX(0); }
.g-defuse .dx-mod[data-mod="vent"] .is-urgent .dx-vent-bar i { background: var(--dx-red, #e0393e); }
.g-defuse .dx-mod[data-mod="vent"] .is-urgent .dx-vent-lcd { border-color: var(--dx-red, #e0393e); }
.g-defuse .dx-mod[data-mod="vent"] .is-urgent .dx-vent-n { color: var(--dx-red, #e0393e); }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-keys { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-key { min-height: 56px; padding: 8px 10px; background: var(--dx-yellow, #ffd21f); color: var(--dx-dark, #18171d); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: 0 5px 0 var(--g-ink); font: 400 1.35rem/1 var(--g-font-display); letter-spacing: 0.06em; transition: transform 0.06s, box-shadow 0.06s; touch-action: manipulation; }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-key.is-no { background: var(--dx-white, #f8f5ec); }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-key:not(:disabled):active { transform: translateY(4px); box-shadow: 0 1px 0 var(--g-ink); }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-key:focus-visible { outline: 3px solid var(--p-a); outline-offset: 3px; }
.g-defuse .dx-mod[data-mod="vent"] .dx-vent-key:disabled { background: var(--g-card); color: var(--g-muted); background-image: var(--g-halftone, none); background-size: 5px 5px; box-shadow: 0 2px 0 var(--g-ink); opacity: 0.85; cursor: default; }
.g-defuse .dx-mod[data-mod="vent"] .is-bad .dx-vent-lcd { border-color: var(--dx-red, #e0393e); }
@media (prefers-reduced-motion: no-preference) {
  .g-defuse .dx-mod[data-mod="vent"] .is-urgent .dx-vent-n { animation: dx-vent-blink 0.8s steps(1) infinite; }
  .g-defuse .dx-mod[data-mod="vent"] [data-state="awake"] .g-needle { animation: dx-vent-shiver 0.18s linear infinite alternate; }
}
@keyframes dx-vent-blink { 50% { opacity: 0.35; } }
@keyframes dx-vent-shiver { from { translate: -0.4px 0; } to { translate: 0.4px 0; } }
@media (max-width: 380px) { .g-defuse .dx-mod[data-mod="vent"] .dx-vent-gauge { width: 68px; } .g-defuse .dx-mod[data-mod="vent"] .dx-vent-n { font-size: 1.8rem; } }
`,
};
