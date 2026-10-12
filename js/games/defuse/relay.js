// Defuse module: RELAY, the role swap. For this one module the MANUAL device holds the controls (a relay
// box: four relays with a coloured cap and a number each, a status lamp, a COMMIT button) and the BOMB
// device holds the rules (a printed rule card). The reader describes the lamp and the caps; the bomb holder
// works the card against what they hear plus the edgework on the bomb, and tells the reader which relays
// to flip.
//
// Data shapes (all JSON):
//   R = { chain: [ { w, s } ... ], last: s }
//     w  condition: lamp:red | lamp:red,blue | bat:n (n or more) | serial-even | serial-odd | vowel | lit:L | port:P
//     s  selector, the relays that must be ON when that clause fires:
//        even | odd | gt:n | lt:n (cap number) | col:red | col:red,blue (cap colour) | notcol:red | pos:0,3 (0 = leftmost)
//     The first clause whose condition is true wins; `last` applies when none is. Every relay not selected must be OFF.
//   S = { c: [4 cap colours], m: [4 cap numbers 1-9, distinct], l: lamp colour, p: [4 starting positions 0|1] }
//   solve(S, E, R) -> [0|1, 0|1, 0|1, 0|1]  the target position of each relay (1 = ON)
//   live = { p: bitmask (bit i = relay i is ON), x: wrong commits, d: 1 once solved, h: 1 after a wrong commit
//            until the next flip (a commit with nothing changed since is ignored) }
//   actions: { t: 'flip', i } | { t: 'commit' }
import { int, pick, sample, shuffle, esc, ctxOf, NUM } from './util.js';

const COLS = ['red', 'blue', 'yellow', 'green', 'white', 'orange'];
const LABELS = ['RDY', 'PWR', 'AUX', 'LNK', 'SYS', 'CLR', 'IGN', 'MSA'];
const PORTS = ['DVI', 'PS2', 'RJ45', 'SERIAL'];
const POS = { '0': 'the leftmost relay', '3': 'the rightmost relay', '0,3': 'the two outer relays (leftmost and rightmost)', '1,2': 'the two middle relays', '0,1': 'the left two relays', '2,3': 'the right two relays' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);
/** "an RJ45", "an orange", "a DVI": the article as it is said aloud. */
const an = (word) => `${/^(RJ|[AEIOU])/i.test(word) ? 'an' : 'a'} ${word}`;
const bits = (a) => a.reduce((m, v, i) => m | (v ? 1 << i : 0), 0);

function condTrue(w, S, E, K) {
  const [k, v] = w.split(':');
  switch (k) {
    case 'lamp': return v.split(',').includes(S.l);
    case 'bat': return K.bat >= +v;
    case 'serial-even': return K.even;
    case 'serial-odd': return !K.even;
    case 'vowel': return K.vowel;
    case 'lit': return K.lit(v);
    case 'port': return (E.ports || []).includes(v);
    default: return false;
  }
}
function selTrue(s, i, S) {
  const [k, v] = s.split(':');
  const m = S.m[i], c = S.c[i];
  switch (k) {
    case 'even': return m % 2 === 0;
    case 'odd': return m % 2 === 1;
    case 'gt': return m > +v;
    case 'lt': return m < +v;
    case 'col': return v.split(',').includes(c);
    case 'notcol': return c !== v;
    case 'pos': return v.split(',').includes(String(i));
    default: return false;
  }
}
function targetOf(S, E, R) {
  const K = ctxOf(E);
  const cl = R.chain.find((c) => condTrue(c.w, S, E, K));
  const s = cl ? cl.s : R.last;
  return [0, 1, 2, 3].map((i) => (selTrue(s, i, S) ? 1 : 0));
}

const dot = (c) => `<i class="dx-relay-dot" style="--c: var(--dx-${c}, ${c === 'orange' ? '#f08a24' : c})"></i>`;
const colList = (list) => list.split(',').map((c) => `${dot(c)}<b>${c}</b>`).join(' or ');
/** "a red or blue cap", "an orange cap": the article follows the first colour named. */
const capOf = (list) => `${an(list.split(',')[0]).split(' ')[0]} ${colList(list)} cap`;
function condText(w) {
  const [k, v] = w.split(':');
  switch (k) {
    case 'lamp': return `the lamp is ${colList(v)}`;
    case 'bat': return `the bomb has ${NUM[+v]} or more batteries`;
    case 'serial-even': return 'the last digit of the serial is even';
    case 'serial-odd': return 'the last digit of the serial is odd';
    case 'vowel': return 'the serial has a vowel in it';
    case 'lit': return `the ${v} indicator is lit`;
    case 'port': return `the bomb has ${an(v)} port`;
    default: return '';
  }
}
function selText(s) {
  const [k, v] = s.split(':');
  switch (k) {
    case 'even': return 'every relay with an <b>even</b> number';
    case 'odd': return 'every relay with an <b>odd</b> number';
    case 'gt': return `every relay with a number <b>above ${v}</b>`;
    case 'lt': return `every relay with a number <b>below ${v}</b>`;
    case 'col': return `every relay with ${capOf(v)}`;
    case 'notcol': return `every relay that does <b>not</b> have ${capOf(v)}`;
    case 'pos': return POS[v] || '';
    default: return '';
  }
}

function drawCond(r, kind) {
  switch (kind) {
    case 'lamp': { const a = sample(r, COLS, r() < 0.4 ? 2 : 1); return 'lamp:' + a.join(','); }
    case 'bat': return 'bat:' + (1 + int(r, 3));
    case 'parity': return r() < 0.5 ? 'serial-even' : 'serial-odd';
    case 'vowel': return 'vowel';
    case 'lit': return 'lit:' + pick(r, LABELS);
    default: return 'port:' + pick(r, PORTS);
  }
}
function drawSel(r, kind) {
  switch (kind) {
    case 'num': return r() < 0.5 ? 'even' : 'odd';
    case 'gt': return 'gt:' + (3 + int(r, 4));
    case 'lt': return 'lt:' + (4 + int(r, 4));
    case 'col': return 'col:' + sample(r, COLS, r() < 0.5 ? 2 : 1).join(',');
    case 'notcol': return 'notcol:' + pick(r, COLS);
    default: return 'pos:' + pick(r, Object.keys(POS));
  }
}

export const RELAY = {
  id: 'relay',
  name: 'Relay',
  tab: 'Relay box',
  tiers: ['normal', 'spicy', 'wild'],
  needy: false,
  remote: true,

  rules(r, T) {
    const level = T?.level || 2;
    const n = level >= 3 ? 3 : 2;
    const kinds = shuffle(r, ['lamp', ...sample(r, ['bat', 'parity', 'vowel', 'lit', 'port'], n - 1)]);
    const sels = sample(r, ['num', 'gt', 'lt', 'col', 'notcol', 'pos'], n + 1);
    const seen = new Set();
    const uniq = (s) => { while (seen.has(s)) s = drawSel(r, 'pos'); seen.add(s); return s; };
    return {
      chain: kinds.map((k, i) => ({ w: drawCond(r, k), s: uniq(drawSel(r, sels[i])) })),
      last: uniq(drawSel(r, sels[n])),
    };
  },

  page(R, T) {
    return `<p class="dx-intro">This one is the other way round. <b>You</b> have the controls and your partner has the instructions. Your partner cannot see this box, so tell them what it shows.</p>
<ol class="dx-rules">
<li><span>Say the colour of the <b>lamp</b>.</span></li>
<li><span>Then, left to right, say each relay's <b>cap colour</b> and the <b>number</b> printed on it.</span></li>
<li><span>Your partner works out which relays must be ON and tells you what to flip. Every other relay must be OFF.</span></li>
<li><span>When the relays match what they said, press <b>COMMIT</b>. A wrong commit is a strike. Change something before you commit again.</span></li>
</ol>
<div class="dx-relay-panel"></div>`;
  },

  card(S, R) {
    const items = R.chain.map((c, i) => `<li data-w="${esc(c.w)}" data-s="${esc(c.s)}"><span><b>${i ? 'Else if' : 'If'}</b> ${condText(c.w)}: ON for ${selText(c.s)}.</span></li>`).join('');
    return `<div class="dx-relay-card" data-relay-card>
<span class="dx-relay-card-tag">Relay card</span>
<p>Your partner has the relay box. Ask for the <b>lamp colour</b> and each relay's <b>cap colour</b> and <b>number</b>, left to right.</p>
<ol class="dx-relay-chain">${items}<li data-w="else" data-s="${esc(R.last)}"><span><b>Otherwise</b>: ON for ${selText(R.last)}.</span></li></ol>
<p>Use the first line that is true. <b>Every other relay is OFF.</b> Tell your partner what to flip, then to COMMIT.</p>
</div>`;
  },

  gen(r, E, R, T) {
    let S = null;
    for (let tries = 0; tries < 400; tries++) {
      const c = sample(r, COLS, 4), m = sample(r, [1, 2, 3, 4, 5, 6, 7, 8, 9], 4), l = pick(r, COLS);
      S = { c, m, l, p: [0, 0, 0, 0] };
      const on = targetOf(S, E, R).reduce((a, b) => a + b, 0);
      if (on >= 1 && on <= 3) break;
    }
    const tg = targetOf(S, E, R);
    const flips = 2 + int(r, 2);
    const mask = sample(r, [0, 1, 2, 3], flips);
    S.p = tg.map((v, i) => (mask.includes(i) ? 1 - v : v));
    return S;
  },

  solve(S, E, R) { return targetOf(S, E, R); },

  init(S) { return { p: bits(S.p), x: 0, d: 0, h: 0 }; },

  step(live, action, S, E, R) {
    const lv = { p: live.p | 0, x: live.x | 0, d: live.d ? 1 : 0, h: live.h ? 1 : 0 };
    if (lv.d || !action) return { live: lv, verdict: null };
    if (action.t === 'flip') {
      const i = action.i | 0;
      if (i < 0 || i > 3) return { live: lv, verdict: null };
      lv.p ^= 1 << i; lv.h = 0;
      return { live: lv, verdict: null };
    }
    if (action.t === 'commit') {
      if (lv.h) return { live: lv, verdict: null };
      if (lv.p === bits(targetOf(S, E, R))) { lv.d = 1; return { live: lv, verdict: 'solve' }; }
      lv.x++; lv.h = 1;
      return { live: lv, verdict: 'strike' };
    }
    return { live: lv, verdict: null };
  },

  // Bomb device: the module slot shows the rule card. update(live) shows how the partner is doing.
  mount(box, S, R, host) {
    box.innerHTML = `<div class="dx-relay-wrap">${RELAY.card(S, R)}<p class="dx-relay-status" aria-live="polite">Waiting for your partner's relay box.</p></div>`;
    const st = box.querySelector('.dx-relay-status');
    return {
      update(live) {
        if (!live || !st) return;
        st.textContent = live.d ? 'Relays set. Done.' : live.x ? `Wrong commits so far: ${live.x}` : 'Your partner is setting the relays.';
      },
      destroy() {},
    };
  },

  // Manual device: the relay box.
  panel(box, S, R, host2) {
    const live0 = RELAY.init(S);
    box.innerHTML = `<div class="dx-relay-box" data-relay-box>
<div class="dx-relay-lamp"><i style="--c: var(--dx-${S.l}, ${S.l === 'orange' ? '#f08a24' : S.l})"></i><span><small>Lamp</small><b>${cap(S.l)}</b></span></div>
<div class="dx-relay-row">${[0, 1, 2, 3].map((i) => `<button type="button" class="dx-relay-sw" role="switch" data-i="${i}" aria-checked="false" aria-label="Relay ${i + 1}, ${S.c[i]} cap, number ${S.m[i]}">
<span class="dx-relay-cap" style="--c: var(--dx-${S.c[i]}, ${S.c[i] === 'orange' ? '#f08a24' : S.c[i]})"><b>${S.m[i]}</b></span>
<small>${cap(S.c[i])}</small>
<span class="dx-relay-lever"><i></i></span>
<span class="dx-relay-state">OFF</span></button>`).join('')}</div>
<button type="button" class="dx-relay-commit">COMMIT</button>
<p class="dx-relay-msg" aria-live="polite"></p>
</div>`;
    const sws = [...box.querySelectorAll('.dx-relay-sw')];
    const commit = box.querySelector('.dx-relay-commit');
    const msg = box.querySelector('.dx-relay-msg');
    const root = box.querySelector('.dx-relay-box');
    let live = live0, lastX = 0;
    const opt = {};
    const tapAt = {};
    let dead = false;
    const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : 0);

    function draw() {
      const t = nowMs();
      sws.forEach((b, i) => {
        let on = (live.p >> i) & 1;
        const o = opt[i];
        if (o) { if (o.v === on || t - o.at > 1500) delete opt[i]; else on = o.v; }
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.classList.toggle('is-on', !!on);
        b.querySelector('.dx-relay-state').textContent = on ? 'ON' : 'OFF';
        b.disabled = !!live.d;
      });
      commit.disabled = !!live.d;
      root.classList.toggle('is-done', !!live.d);
      msg.textContent = live.d ? 'Relays set. Done.' : live.x ? `Wrong commits: ${live.x}. Change something, then commit again.` : '';
    }
    function onClick(e) {
      const b = e.target.closest && e.target.closest('.dx-relay-sw, .dx-relay-commit');
      if (!b || !box.contains(b) || live.d) return;
      const t = nowMs();
      if (b.classList.contains('dx-relay-commit')) {
        if (t - (tapAt.c || -1e9) < 400) return;
        tapAt.c = t;
        host2.act({ t: 'commit' });
        return;
      }
      const i = +b.dataset.i;
      if (t - (tapAt[i] || -1e9) < 400) return;
      tapAt[i] = t;
      const cur = opt[i] ? opt[i].v : (live.p >> i) & 1;
      opt[i] = { v: 1 - cur, at: t };
      draw();
      host2.act({ t: 'flip', i });
    }
    box.addEventListener('click', onClick);
    draw();
    return {
      render(next) {
        if (dead) return;
        if (next && typeof next === 'object') {
          if ((next.x | 0) > lastX) {
            lastX = next.x | 0;
            root.classList.remove('is-bad'); void root.offsetWidth; root.classList.add('is-bad');
            if (host2.sfx) host2.sfx('bad');
          } else if (next.d && !live.d && host2.sfx) host2.sfx('good');
          live = next;
        }
        draw();
      },
      destroy() { dead = true; box.removeEventListener('click', onClick); },
    };
  },

  css: `
.g-defuse .dx-relay-dot { display: inline-block; width: 0.95em; height: 0.95em; margin-right: 5px; vertical-align: -0.12em; border: 2px solid var(--dx-dark, #18171d); border-radius: 3px; background: var(--c); }
.g-defuse .dx-relay-wrap { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.g-defuse .dx-relay-status { margin: 0; font: 800 0.74rem/1.3 var(--g-font-body); letter-spacing: 0.06em; text-transform: uppercase; color: var(--g-muted); text-align: center; }
.g-defuse .dx-relay-card { position: relative; width: min(100%, 360px); min-width: min(300px, 100%); box-sizing: border-box; padding: 10px 12px 10px; background: var(--dx-white, #f8f5ec); color: var(--dx-dark, #18171d); border: 2.5px solid var(--dx-dark, #18171d); border-radius: 6px; box-shadow: 3px 3px 0 var(--g-edge, var(--g-ink)); font-size: 0.84rem; line-height: 1.35; text-align: left; transform: rotate(-0.6deg); }
.g-defuse .dx-relay-card p { margin: 0 0 6px; }
.g-defuse .dx-relay-card-tag { display: inline-block; margin: -2px 0 6px; padding: 3px 7px; background: var(--dx-dark, #18171d); color: var(--dx-yellow, #ffd21f); border-radius: 4px; font: 800 0.64rem/1 var(--g-font-body); letter-spacing: 0.16em; text-transform: uppercase; }
.g-defuse .dx-relay-chain { list-style: none; counter-reset: rc; margin: 0 0 6px; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.g-defuse .dx-relay-chain li { counter-increment: rc; display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 7px; align-items: start; padding-top: 5px; border-top: 1.5px dashed color-mix(in srgb, var(--dx-dark, #18171d) 40%, transparent); }
.g-defuse .dx-relay-chain li:first-child { border-top: 0; padding-top: 0; }
.g-defuse .dx-relay-chain li::before { content: counter(rc); display: grid; place-items: center; width: 20px; height: 20px; border: 2px solid var(--dx-dark, #18171d); border-radius: 5px; background: var(--dx-yellow, #ffd21f); font: 400 0.7rem/1 var(--g-font-display); }
@media (min-width: 760px) { .g-defuse .dx-relay-card { font-size: 0.9rem; } }
.g-defuse .dx-relay-box { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; padding: 14px; background: color-mix(in srgb, var(--g-ink) 6%, var(--g-card)); border: 3px solid var(--g-ink); border-radius: 16px; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-ink)); max-width: 460px; }
.g-defuse .dx-relay-lamp { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: var(--dx-dark, #18171d); border: 2.5px solid var(--g-ink); border-radius: 10px; color: var(--dx-white, #f8f5ec); }
.g-defuse .dx-relay-lamp i { flex: none; width: 30px; height: 30px; border-radius: 50%; border: 3px solid var(--dx-white, #f8f5ec); background: var(--c); }
.g-defuse .dx-relay-lamp span { display: flex; flex-direction: column; gap: 2px; }
.g-defuse .dx-relay-lamp small { font: 800 0.62rem/1 var(--g-font-body); letter-spacing: 0.16em; text-transform: uppercase; color: #a8a498; }
.g-defuse .dx-relay-lamp b { font: 400 1.2rem/1 var(--g-font-display); letter-spacing: 0.04em; }
.g-defuse .dx-relay-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (min-width: 560px) { .g-defuse .dx-relay-row { grid-template-columns: repeat(4, 1fr); } }
.g-defuse .dx-relay-sw { display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 124px; padding: 10px 6px 8px; background: var(--g-card); color: var(--g-ink); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: 0 5px 0 var(--g-ink); transition: transform 0.06s, box-shadow 0.06s, background-color 0.1s; touch-action: manipulation; }
.g-defuse .dx-relay-sw:active { transform: translateY(3px); box-shadow: 0 2px 0 var(--g-ink); }
.g-defuse .dx-relay-sw.is-on { background: var(--g-hl-soft, var(--g-card)); }
.g-defuse .dx-relay-sw:focus-visible, .g-defuse .dx-relay-commit:focus-visible { outline: 3px solid var(--p-a); outline-offset: 3px; }
.g-defuse .dx-relay-cap { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; border: 3px solid var(--g-ink); background: var(--c); color: var(--dx-dark, #18171d); box-shadow: inset -4px -4px 0 rgb(0 0 0 / 0.14); }
.g-defuse .dx-relay-cap b { font: 400 1.45rem/1 var(--g-font-display); }
.g-defuse .dx-relay-sw small { font: 800 0.66rem/1 var(--g-font-body); letter-spacing: 0.12em; text-transform: uppercase; color: var(--g-muted); }
.g-defuse .dx-relay-lever { position: relative; width: 26px; height: 40px; border: 2.5px solid var(--g-ink); border-radius: 13px; background: var(--dx-dark, #18171d); }
.g-defuse .dx-relay-lever i { position: absolute; left: 2px; right: 2px; bottom: 2px; height: 16px; border-radius: 50%; background: var(--dx-white, #f8f5ec); border: 2px solid var(--g-ink); transition: bottom 0.08s; }
.g-defuse .dx-relay-sw.is-on .dx-relay-lever i { bottom: 18px; background: var(--dx-yellow, #ffd21f); }
.g-defuse .dx-relay-state { font: 400 0.9rem/1 var(--g-font-display); letter-spacing: 0.06em; }
.g-defuse .dx-relay-commit { min-height: 56px; padding: 8px 14px; background: var(--dx-yellow, #ffd21f); color: var(--dx-dark, #18171d); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: 0 5px 0 var(--g-ink); font: 400 1.3rem/1 var(--g-font-display); letter-spacing: 0.08em; touch-action: manipulation; transition: transform 0.06s, box-shadow 0.06s; }
.g-defuse .dx-relay-commit:not(:disabled):active { transform: translateY(4px); box-shadow: 0 1px 0 var(--g-ink); }
.g-defuse .dx-relay-box.is-done .dx-relay-sw, .g-defuse .dx-relay-commit:disabled { opacity: 0.6; box-shadow: 0 2px 0 var(--g-ink); }
.g-defuse .dx-relay-msg { min-height: 1.3em; margin: 0 !important; font-weight: 800; font-size: 0.9rem; color: var(--g-bad); }
.g-defuse .dx-relay-box.is-done .dx-relay-msg { color: var(--g-good); }
.g-defuse .dx-relay-box.is-bad { border-color: var(--g-bad); animation: dx-shake 0.36s ease-out; }
@media (prefers-reduced-motion: reduce) { .g-defuse .dx-relay-box.is-bad { animation: none; } .g-defuse .dx-relay-sw, .g-defuse .dx-relay-lever i { transition: none; } }
@media (max-width: 440px) { .g-defuse .dx-relay-box { padding: 10px; } .g-defuse .dx-relay-card { transform: none; } }
`,
};
