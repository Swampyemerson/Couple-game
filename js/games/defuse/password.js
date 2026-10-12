// Defuse module: PASSWORD. The bomb has five letter windows on rollers (six letters each) and a
// SUBMIT key. The manual holds a list of words. Read the six letters of each column to your
// partner; exactly one word on the list can be spelled from the five columns. Set it and submit.
//
//   R (rules)  { words: [sorted list], x?: struck word }  x only exists after errata()
//   S (puzzle) { c: [5 strings of 6 letters, alphabetical], s: [5 start positions 0..5] }
//   solve()    the password, a word of R.words (never the struck one)
//   save()     { p: [5 roller positions] }
import { int, pick, sample, shuffle } from './util.js';

const POOL = ('ABOUT ABOVE ACORN ADULT AFTER AGAIN ALARM ALBUM ALONE ANGEL APPLE APRON ARROW BADGE BAKER BEACH BEARD BEGIN BENCH BERRY BIRTH BLANK '
  + 'BLAZE BLOOM BOARD BREAD BRICK BRING BROOM BRUSH CABIN CANDY CARRY CHAIR CHALK CHARM CHEST CHILD CLEAN CLIMB CLOCK CLOUD COAST CORAL CRANE CROWN '
  + 'DAIRY DAISY DANCE DOZEN DREAM DRIVE EAGLE EARTH FAIRY FEAST FERRY FIELD FLAME FLOOR FOCUS FRUIT GHOST GIANT GLASS GRAIN GRAPE GRASS GREEN HAPPY '
  + 'HEART HONEY HORSE HOTEL HOUSE IGLOO JELLY JUICE LEMON LIGHT LLAMA LUNCH MAGIC MANGO MAPLE MARCH MELON MONEY MOTOR MOUSE MUSIC NIGHT NOISE NURSE '
  + 'OCEAN OLIVE ORBIT OTTER PAINT PANDA PAPER PARTY PEACH PEARL PIANO PILOT PLANT PLATE POINT PRIZE QUEEN QUIET RADIO RIVER ROBOT ROUND SALAD SCARF '
  + 'SHEEP SHELL SHIRT SMILE SNAKE SPOON STAMP STONE STORM SUGAR SUNNY SWEET TABLE TIGER TOAST TOWER TRAIN TULIP UNCLE VOICE WATER WHALE WHEAT WORLD '
  + 'YOUNG ZEBRA').split(' ');
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LEN = 5;
const ROLL = 6;
const count = (T) => ((T.level | 0) <= 1 ? 20 : (T.level | 0) === 2 ? 25 : 30);

/** Words that can be the password when x is the (deliberately spellable) struck word: no other listed word may be forced. */
const targets = (words, x) => words.filter((w) => w !== x && !words.some((o) => o !== w && o !== x && [...o].every((ch, i) => ch === w[i] || (x && ch === x[i]))));

const spells = (cols, w) => {
  for (let i = 0; i < LEN; i++) if (!cols[i].includes(w[i])) return false;
  return true;
};

// ── the bomb ──────────────────────────────────────────────────────────────
const ARROW = (up) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${up ? 'M5.5 15.5L12 8.5l6.5 7' : 'M5.5 8.5L12 15.5l6.5-7'}"/></svg>`;

function bombHTML(S) {
  const col = (i) => `<div class="dx-pw-col" data-col="${i}">
    <button type="button" class="dx-pw-btn" data-col="${i}" data-roll="-1" aria-label="Column ${i + 1}, previous letter">${ARROW(true)}</button>
    <div class="dx-pw-win" role="img" aria-label="Column ${i + 1}"><div class="dx-pw-strip"><i></i><b></b><i></i></div></div>
    <button type="button" class="dx-pw-btn" data-col="${i}" data-roll="1" aria-label="Column ${i + 1}, next letter">${ARROW(false)}</button>
  </div>`;
  return `<div class="dx-pw"><div class="dx-pw-cols" role="group" aria-label="Five letter windows">${Array.from({ length: LEN }, (_, i) => col(i)).join('')}</div>
    <button type="button" class="dx-pw-submit" data-submit>Submit</button></div>`;
}

const css = `
.g-defuse .dx-pw { width: 100%; max-width: 340px; display: flex; flex-direction: column; align-items: stretch; gap: 14px; padding-bottom: 5px; }
.g-defuse .dx-pw-cols { display: grid; grid-template-columns: repeat(5, minmax(44px, 1fr)); gap: 2px; padding: 6px 3px 10px; margin-inline: -6px; background: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: inset 0 -5px 0 rgb(255 255 255 / 0.06), var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
.g-defuse .dx-pw-col { display: flex; flex-direction: column; align-items: stretch; gap: 6px; min-width: 44px; }
.g-defuse .dx-pw-btn { display: grid; place-items: center; min-width: 44px; height: 46px; padding: 0; background: var(--dx-white); color: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 10px; box-shadow: 0 4px 0 var(--g-ink); transition: transform 0.06s, box-shadow 0.06s; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.g-defuse .dx-pw-btn svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 3.6; stroke-linecap: round; stroke-linejoin: round; }
.g-defuse .dx-pw-btn:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--g-ink); }
.g-defuse .dx-pw-btn:focus-visible, .g-defuse .dx-pw-submit:focus-visible { outline: 3px solid var(--p-a); outline-offset: 3px; }
.g-defuse .dx-pw-win { position: relative; height: 56px; overflow: hidden; background: var(--dx-white); color: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 8px; box-shadow: inset 0 3px 0 rgb(0 0 0 / 0.12), inset 0 -3px 0 rgb(0 0 0 / 0.12); }
.g-defuse .dx-pw-strip { position: absolute; left: 0; right: 0; top: -32px; height: 120px; will-change: transform; }
.g-defuse .dx-pw-strip i, .g-defuse .dx-pw-strip b { position: absolute; left: 0; right: 0; height: 40px; display: grid; place-items: center; font: 400 1.9rem/1 var(--g-font-display); font-style: normal; }
.g-defuse .dx-pw-strip i:first-child { top: 0; opacity: 0.22; } .g-defuse .dx-pw-strip b { top: 40px; font-weight: 400; } .g-defuse .dx-pw-strip i:last-child { top: 80px; opacity: 0.22; }
.g-defuse .dx-pw-win.is-no { background: color-mix(in srgb, var(--dx-red) 55%, var(--dx-white)); } .g-defuse .dx-pw-win.is-ok { background: color-mix(in srgb, var(--dx-green) 55%, var(--dx-white)); }
.g-defuse .dx-pw-submit { min-height: 50px; padding: 0 18px; background: var(--dx-yellow); color: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: 0 5px 0 var(--g-ink); font: 400 1.2rem/1 var(--g-font-display); letter-spacing: 0.14em; text-transform: uppercase; transition: transform 0.06s, box-shadow 0.06s; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.g-defuse .dx-pw-submit:active { transform: translateY(4px); box-shadow: 0 1px 0 var(--g-ink); }
.g-defuse .dx-mod.is-solved .dx-pw-btn, .g-defuse .dx-mod.is-solved .dx-pw-submit { opacity: 0.55; }

/* the manual's word list */
.g-defuse .dx-pw-words { list-style: none; margin: 10px 0 4px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; }
.g-defuse .dx-pw-words li { margin: 0; }
.g-defuse .dx-pw-w { position: relative; display: grid; place-items: center; min-height: 46px; background: var(--g-bg); border: 2px solid var(--g-ink); border-radius: 8px; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); cursor: pointer; font: 800 1.02rem/1 ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; letter-spacing: 0.14em; text-indent: 0.14em; user-select: none; -webkit-user-select: none; }
.g-defuse .dx-pw-w input { position: absolute; inset: -2px; width: calc(100% + 4px); height: calc(100% + 4px); margin: 0; opacity: 0; cursor: pointer; }
.g-defuse .dx-pw-w:has(input:checked) { background: transparent; box-shadow: none; color: var(--g-muted); text-decoration: line-through; text-decoration-thickness: 2px; border-style: dashed; }
.g-defuse .dx-pw-w:has(input:focus-visible) { outline: 3px solid var(--p-a); outline-offset: 2px; }
.g-defuse .dx-pw-slip { margin: 10px 0 0; }
`;

export const PASSWORD = {
  id: 'password',
  name: 'Password',
  tab: 'Password',
  tiers: ['chill', 'normal', 'spicy', 'wild'],
  needy: false,
  remote: false,
  css,

  rules(r, T) {
    return { words: sample(r, POOL, count(T)).sort() };
  },

  // A misprint: one listed word is not really a password. The bomb deliberately lets you spell it too,
  // so the page alone has two answers and only the correction slip resolves it.
  errata(r, R) {
    const x = shuffle(r, R.words).find((w) => targets(R.words, w).length);
    if (!x) return null;
    return { R: { ...R, x }, note: `<p class="dx-pw-slip" data-errata="password" data-struck="${x}">Correction: <b>${x}</b> was printed here by mistake. It is not a password. Cross it out.</p>` };
  },

  page(R) {
    return `<p class="dx-intro">Your partner has five letter windows, each on a roller with six letters, and no word list. You have the list and can’t see the windows. Exactly one word on the list can be spelled from what they have.</p>
<ol class="dx-rules">
<li><span>Ask for the <b>first column</b>: all six letters on its roller, in order. Tell them to roll it with the arrows.</span></li>
<li><span>Cross out every word whose <b>first letter</b> is not one of those six. Then do the same for the second column and the second letter, and so on.</span></li>
<li><span>One word is left. Tell them to set it, one letter per window, and press <b>Submit</b>.</span></li>
</ol>
<ul class="dx-pw-words" data-words="${R.words.join(',')}">${R.words.map((w) => `<li data-word="${w}"><label class="dx-pw-w"><input type="checkbox" aria-label="Cross out ${w}">${w}</label></li>`).join('')}</ul>
<p class="dx-note">Tap a word to cross it out. A wrong word at Submit is a strike. The list changes every game.</p>`;
  },

  gen(r, E, R, T) {
    const x = R.x || null;
    const words = R.words;
    const target = pick(r, x ? targets(words, x) : words);
    const keep = (w) => w !== target && w !== x;
    const lures0 = Math.max(0, Math.min(3, (T.level | 0) - 1));
    let cols = null;
    for (let attempt = 0; attempt < 3000; attempt++) {
      const lures = Math.max(0, lures0 - Math.floor(attempt / 40));
      cols = Array.from({ length: LEN }, (_, i) => {
        const set = new Set([target[i]]);
        if (x) set.add(x[i]);
        // lure letters: letters that other listed words use in this position
        for (const l of shuffle(r, [...new Set(words.filter(keep).map((w) => w[i]))].filter((l) => !set.has(l))).slice(0, lures)) set.add(l);
        for (const l of shuffle(r, [...ALPHA])) { if (set.size >= ROLL) break; set.add(l); }
        return [...set].sort().join('');
      });
      if (!words.some((w) => keep(w) && spells(cols, w))) break;
    }
    // start positions: never already showing a listed word
    let s = [];
    for (let g = 0; g < 50; g++) {
      s = cols.map(() => int(r, ROLL));
      const shown = s.map((p, i) => cols[i][p]).join('');
      if (!words.includes(shown)) break;
    }
    return { c: cols, s };
  },

  solve(S, E, R) {
    return R.words.find((w) => w !== R.x && spells(S.c, w));
  },

  mount(box, S, R, host) {
    const answer = PASSWORD.solve(S, null, R);
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let pos = [...S.s];
    const sv = host.saved;
    if (sv && Array.isArray(sv.p) && sv.p.length === LEN && sv.p.every((v) => Number.isInteger(v) && v >= 0 && v < ROLL)) pos = [...sv.p];
    box.innerHTML = bombHTML(S);
    const cols = [...box.querySelectorAll('.dx-pw-col')];
    const wins = cols.map((c) => c.querySelector('.dx-pw-win'));
    const letter = (i, p) => S.c[i][(p + ROLL) % ROLL];
    const word = () => pos.map((p, i) => S.c[i][p]).join('');
    let last = null; // { k, at } for the double-tap debounce on a wrong submit

    function show(i, dir) {
      const win = wins[i];
      const strip = win.querySelector('.dx-pw-strip');
      const [a, b, c] = strip.children;
      a.textContent = letter(i, pos[i] - 1);
      b.textContent = letter(i, pos[i]);
      c.textContent = letter(i, pos[i] + 1);
      win.setAttribute('aria-label', `Column ${i + 1}: ${letter(i, pos[i])}`);
      if (dir && !reduce && strip.animate) strip.animate([{ transform: `translateY(${dir * 40}px)` }, { transform: 'translateY(0)' }], { duration: 110, easing: 'ease-out' });
    }
    cols.forEach((_, i) => show(i, 0));

    function roll(i, d) {
      if (host.busy()) return;
      pos[i] = (pos[i] + d + ROLL) % ROLL;
      show(i, d);
      host.sfx('tap');
    }
    function submit() {
      if (host.busy()) return;
      const w = word();
      if (w === answer) {
        wins.forEach((x) => x.classList.add('is-ok'));
        host.sfx('place');
        host.solve();
        return;
      }
      const now = host.now();
      if (last && last.k === w && now - last.at < 400) return;
      last = { k: w, at: now };
      wins.forEach((x) => x.classList.add('is-no'));
      host.later(() => wins.forEach((x) => x.classList.remove('is-no')), 600);
      host.strike('password');
    }

    return {
      click(e) {
        const t = e.target.closest && e.target.closest('button');
        if (!t || !box.contains(t)) return;
        if (t.dataset.submit !== undefined) submit();
        else if (t.dataset.roll) roll(+t.dataset.col, +t.dataset.roll);
      },
      key(e) {
        if (e.type !== 'keydown' || e.altKey || e.ctrlKey || e.metaKey) return;
        const col = e.target.closest && e.target.closest('.dx-pw-col');
        if (!col || !box.contains(col)) return;
        const i = +col.dataset.col;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); roll(i, e.key === 'ArrowUp' ? -1 : 1); return; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const nx = cols[i + (e.key === 'ArrowLeft' ? -1 : 1)];
          const btns = [...col.querySelectorAll('.dx-pw-btn')];
          const at = btns.indexOf(e.target.closest('.dx-pw-btn'));
          if (nx) { e.preventDefault(); const n = nx.querySelectorAll('.dx-pw-btn'); n[Math.max(0, at)].focus(); }
        }
      },
      save() { return { p: [...pos] }; },
      destroy() { box.textContent = ''; },
    };
  },

  drive(S, E, R, live) {
    const word = PASSWORD.solve(S, E, R);
    const at = live && Array.isArray(live.p) && live.p.length === LEN ? live.p : S.s;
    const out = [];
    for (let i = 0; i < LEN; i++) {
      const to = S.c[i].indexOf(word[i]);
      const fwd = (to - at[i] + ROLL) % ROLL;
      const back = ROLL - fwd;
      const [n, d] = fwd <= back ? [fwd, 1] : [back, -1];
      for (let k = 0; k < n; k++) out.push({ sel: `.dx-pw-btn[data-col="${i}"][data-roll="${d}"]`, act: 'tap' });
    }
    out.push({ sel: '.dx-pw-submit', act: 'tap' });
    return out;
  },
};
