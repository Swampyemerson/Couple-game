// Word Duel: versus Wordle. Each of you secretly picks a five-letter word for the other,
// then you race to crack each other's word. Fewest guesses wins (a miss counts as 7).
//
// Moves:  { secret: 'crane' }   phase 1, both at once (a word from the valid list)
//         { guess: 'slate' }    phase 2, both at once and independent: up to 6 valid guesses each
//
// Word lists (embedded at the bottom of this file as letter strings, split every 5):
//   ANSWERS  2,224 everyday words for secrets and "Surprise me". The Wordle answer list from the
//            npm package `wordle-words` 0.0.0 (MIT licence, (c) 2022 Michael Chan,
//            github.com/chantastic/wordle-words), minus crude, slur-adjacent and rare words.
//            Rarity came from `subtlex-word-frequencies` 2.0.0 (ISC licence, SUBTLEXus counts).
//   MORE     10,693 further valid guesses: the rest of the Wordle allowed-guess list from the
//            same package, minus profanity and slurs (`badwords-list` 2.0.1-4, MIT licence,
//            plus a hand list). Valid words = ANSWERS + MORE = 12,917.
import { registerGame } from './core.js';

const MAX = 6;
const other = (w) => (w === 'a' ? 'b' : 'a');
const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : '');

let COMMON = null;
let VALID = null;
function lists() {
  if (!VALID) {
    const split = (s) => { const out = []; for (let i = 0; i + 5 <= s.length; i += 5) out.push(s.slice(i, i + 5)); return out; };
    COMMON = split(ANSWERS);
    VALID = new Set(COMMON);
    for (const w of split(MORE)) VALID.add(w);
  }
  return { common: COMMON, valid: VALID };
}

/** Wordle feedback for one guess: 'g' right spot, 'y' in the word elsewhere, 'x' not in it.
 *  Repeated letters: exact matches claim their letters first, then each remaining copy in the
 *  secret can light up at most one more guessed letter, left to right. */
function scoreGuess(secret, guess) {
  const out = ['x', 'x', 'x', 'x', 'x'];
  const left = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === secret[i]) out[i] = 'g';
    else left[secret[i]] = (left[secret[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (out[i] === 'g') continue;
    const c = guess[i];
    if (left[c] > 0) { out[i] = 'y'; left[c]--; }
  }
  return out.join('');
}

function checkWord(w) {
  if (!w) throw new Error('Type a five-letter word.');
  if (!/^[a-z]+$/.test(w)) throw new Error('Letters only, please.');
  if (w.length !== 5) throw new Error('Five letters, please.');
  if (!lists().valid.has(w)) throw new Error(`${w.toUpperCase()} isn’t in the word list.`);
}

const target = (s, w) => s.secret[other(w)];
const solvedBy = (s, w) => !!target(s, w) && s.guesses[w].includes(target(s, w));
const doneBy = (s, w) => solvedBy(s, w) || s.guesses[w].length >= MAX;
const tally = (s, w) => (solvedBy(s, w) ? s.guesses[w].length : MAX + 1);

// ── rules (pure, deterministic) ──
function init() {
  return { secret: { a: null, b: null }, guesses: { a: [], b: [] } };
}
function next(s) {
  if (!s.secret.a || !s.secret.b) return ['a', 'b'].filter((w) => !s.secret[w]);
  return ['a', 'b'].filter((w) => !doneBy(s, w));
}
function apply(s, who, mv) {
  if (!mv || typeof mv !== 'object') throw new Error('That move didn’t make sense.');
  if (!s.secret[who]) {
    if (mv.secret === undefined) throw new Error('Pick your secret word first.');
    const w = norm(mv.secret);
    checkWord(w);
    s.secret[who] = w;
    return s;
  }
  if (mv.guess === undefined) throw new Error('You’ve already picked your word.');
  if (!target(s, who)) throw new Error('Wait for your partner to pick their word.');
  if (doneBy(s, who)) throw new Error('You’re out of guesses.');
  const g = norm(mv.guess);
  checkWord(g);
  if (s.guesses[who].includes(g)) throw new Error(`You already tried ${g.toUpperCase()}.`);
  s.guesses[who].push(g);
  return s;
}
function result(s) {
  const na = tally(s, 'a');
  const nb = tally(s, 'b');
  const gs = (n) => `${n} ${n === 1 ? 'guess' : 'guesses'}`;
  if (na === nb) {
    return na > MAX
      ? { winner: null, text: 'Both words held out', sub: 'Neither of you cracked it this time.' }
      : { winner: null, text: 'Dead heat', sub: `You both cracked it in ${gs(na)}.` };
  }
  const w = na < nb ? 'a' : 'b';
  const n = Math.min(na, nb);
  const m = Math.max(na, nb);
  return { winner: w, sub: m > MAX ? `Cracked it in ${gs(n)}. The other word held out.` : `Cracked it in ${gs(n)}, against ${m}.` };
}
// ── view helpers ──
const KB_ROWS = ['qwertyuiop', 'asdfghjkl', '>zxcvbnm<'];
const RANK = { x: 1, y: 2, g: 3 };
const WORDS_FOR = { g: 'right spot', y: 'in the word', x: 'not in it' };
const BACK_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8.5 5H20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8.5L3 12z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M11 9l6 6M17 9l-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

const css = `
.g-wd { --gap: 6px; --wd-on-hl: var(--g-ink); flex: 1; min-height: 0; width: 100%; max-width: 520px; margin: 0 auto; display: flex; flex-direction: column; gap: 8px; color: var(--g-ink); font-family: var(--g-font-body); touch-action: manipulation; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .g-wd { --wd-on-hl: var(--g-bg); } }
:root[data-theme="dark"] .g-wd { --wd-on-hl: var(--g-bg); }
.g-wd-head { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.g-wd-say { margin: 0; min-height: 1.35em; text-align: center; font-weight: 800; font-size: 0.98rem; line-height: 1.35; text-wrap: balance; }
.g-wd-say b { font-family: var(--g-font-display); letter-spacing: 0.04em; }
.g-wd-strip { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 18px; font-size: 0.8rem; font-weight: 800; color: var(--g-muted); }
.g-wd-strip:empty { display: none; }
.g-wd-who { font-weight: 900; }
.g-wd-who.p-a { color: var(--p-a); } .g-wd-who.p-b { color: var(--p-b); }
.g-wd-area { flex: 1 1 0; min-height: 170px; container-type: size; display: flex; align-items: center; justify-content: center; }
.g-wd[data-mode="done"] .g-wd-area, .g-wd[data-mode="end"] .g-wd-area { align-items: flex-start; padding-top: min(4vh, 28px); }

/* tiles: printed letter tiles */
.g-wd-board { --t: min(62px, calc((100cqw - 4 * var(--gap)) / 5), calc((100cqh - 5 * var(--gap)) / 6)); display: grid; gap: var(--gap); justify-content: center; }
.g-wd-row { display: grid; grid-template-columns: repeat(5, var(--t)); gap: var(--gap); }
.g-wd-tile { position: relative; width: var(--t); height: var(--t); box-sizing: border-box; display: grid; place-items: center; border: 2px solid var(--g-line); border-radius: max(4px, calc(var(--g-radius) * 0.4)); background-color: var(--bg, var(--g-card)); background-image: var(--pat, none); color: var(--fg, var(--g-ink)); font-family: var(--g-font-display); font-weight: 900; font-size: calc(var(--t) * 0.52); line-height: 1; text-transform: uppercase; }
.g-wd-tile.has, .g-wd-tile.m-g, .g-wd-tile.m-y, .g-wd-tile.m-x { border-color: var(--g-ink); box-shadow: var(--g-shadow); }
.g-wd .m-g { --bg: var(--g-good); --fg: var(--g-on-ink); }
.g-wd .m-y { --bg: var(--g-hl); --fg: var(--wd-on-hl); --pat: repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--wd-on-hl) 24%, transparent) 5px 7px); }
.g-wd .m-x { --bg: var(--g-muted); --fg: var(--g-card); }
.g-wd-tile.m-g::after, .g-wd-key.m-g::after { content: ''; position: absolute; left: 28%; right: 28%; bottom: 11%; height: max(2px, calc(var(--t, 40px) * 0.07)); border-radius: 2px; background: currentColor; }
.g-wd-row.is-target .g-wd-tile { border-style: dashed; box-shadow: none; }

/* pick a secret */
.g-wd-pick { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.g-wd-pick .g-wd-board { --t: min(64px, calc((100cqw - 4 * var(--gap)) / 5)); }
.g-wd-cap { margin: 0; font-size: 0.82rem; font-weight: 800; color: var(--g-muted); text-transform: uppercase; letter-spacing: 0.08em; }
.g-wd-stamp { display: inline-block; padding: 3px 10px; border: 2px solid currentColor; border-radius: 6px; font-family: var(--g-font-display); font-weight: 900; font-size: 0.85rem; letter-spacing: 0.14em; text-transform: uppercase; transform: rotate(-4deg); }
.g-wd-stamp.p-a { color: var(--p-a); } .g-wd-stamp.p-b { color: var(--p-b); }

/* two boards side by side */
.g-wd-duo { width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.g-wd-col { min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.g-wd-col .g-wd-board { --gap: 4px; --t: min(44px, calc((50cqw - 6px - 4 * var(--gap)) / 5), calc((100cqh - 74px - 6 * var(--gap)) / 7)); }
.g-wd-col .g-wd-target { margin-bottom: 4px; }
.g-wd-colhead { display: flex; align-items: baseline; gap: 6px; font-weight: 800; font-size: 0.9rem; white-space: nowrap; }
.g-wd-colhead small { color: var(--g-muted); font-weight: 800; font-size: 0.8rem; }

/* partner progress, colour only */
.g-wd-minis { display: flex; gap: 4px; }
.g-wd-mrow { display: flex; gap: 1px; }
.g-wd-m { width: 6px; height: 6px; box-sizing: border-box; border: 1.5px solid var(--g-line); border-radius: 1px; }
.g-wd-m.m-g { background: var(--g-good); border-color: var(--g-ink); }
.g-wd-m.m-y { background: var(--g-hl); border-color: var(--g-ink); border-radius: 50%; }
.g-wd-m.m-x { background: transparent; border-color: var(--g-muted); }

/* actions + keyboard */
.g-wd-actions { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; }
.g-wd-actions:empty { display: none; }
.g-wd-actions .gm-btn { min-height: 44px; min-width: 132px; }
.g-wd-banner { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.g-wd-banner p { margin: 0; font-weight: 800; }
.g-wd-kb { display: flex; flex-direction: column; gap: 6px; padding-bottom: 2px; }
.g-wd-kb:empty { display: none; }
.g-wd-kr { display: flex; justify-content: center; gap: 5px; }
.g-wd-key { --t: 46px; position: relative; flex: 1 1 0; min-width: 0; max-width: 46px; height: 50px; padding: 0; display: grid; place-items: center; border: 2px solid var(--g-ink); border-radius: 8px; background-color: var(--bg, var(--g-card)); background-image: var(--pat, none); color: var(--fg, var(--g-ink)); font-family: var(--g-font-body); font-weight: 900; font-size: 1.05rem; text-transform: uppercase; box-shadow: 0 2px 0 var(--g-ink); touch-action: manipulation; cursor: pointer; }
.g-wd-key.wide { flex-grow: 1.55; max-width: 70px; font-size: 0.74rem; letter-spacing: 0.04em; }
.g-wd-key:active:not(:disabled) { transform: translateY(2px); box-shadow: none; }
.g-wd-key:disabled { opacity: 0.45; cursor: default; }
.g-wd-key.m-x { opacity: 0.8; }
@media (max-height: 640px) { .g-wd-key { height: 44px; } .g-wd { gap: 6px; } }
@media (min-width: 700px) { .g-wd-key { max-width: 50px; height: 54px; } .g-wd-key.wide { max-width: 78px; } }

/* motion */
@keyframes g-wd-flip { 0% { transform: rotateX(0); } 50% { transform: rotateX(-90deg); } 100% { transform: rotateX(0); } }
@keyframes g-wd-face { 0%, 49% { background-color: var(--g-card); background-image: none; color: var(--g-ink); } 50%, 100% { background-color: var(--bg, var(--g-card)); background-image: var(--pat, none); color: var(--fg, var(--g-ink)); } }
@keyframes g-wd-bar { 0%, 49% { opacity: 0; } 50%, 100% { opacity: 1; } }
@keyframes g-wd-pop { 0% { transform: scale(0.82); } 60% { transform: scale(1.1); } 100% { transform: scale(1); } }
@keyframes g-wd-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-8px); } 40% { transform: translateX(7px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(3px); } }
@keyframes g-wd-jump { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-28%); } 70% { transform: translateY(4%); } }
@keyframes g-wd-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.g-wd-tile.flip { animation: g-wd-flip 0.5s ease-in-out both, g-wd-face 0.5s linear both; animation-delay: calc(var(--i) * 160ms); }
.g-wd-tile.flip::after { animation: g-wd-bar 0.5s linear both; animation-delay: calc(var(--i) * 160ms); }
.g-wd-tile.pop { animation: g-wd-pop 0.14s ease-out; }
.g-wd-row.shake { animation: g-wd-shake 0.4s ease; }
.g-wd-row.win .g-wd-tile { animation: g-wd-jump 0.5s ease both; animation-delay: calc(var(--i) * 90ms); }
.g-wd-banner, .g-wd-duo { animation: g-wd-in 0.3s ease both; }
@media (prefers-reduced-motion: reduce) {
  .g-wd-tile.flip, .g-wd-tile.flip::after, .g-wd-tile.pop, .g-wd-row.shake, .g-wd-row.win .g-wd-tile, .g-wd-banner, .g-wd-duo { animation-duration: 1ms !important; animation-delay: 0s !important; }
}
`;

const RULES = { init, next, apply, result };

registerGame({
  id: 'wordduel',
  title: 'Word Duel',
  blurb: 'Pick a word for them. Crack theirs first.',
  kind: 'turns',
  team: false,
  secret: true,
  tags: ['brainy'],
  platforms: ['phone', 'computer'],
  minutes: 6,
  howTo: [
    'Each of you secretly picks a five-letter word for the other to crack.',
    'Then crack theirs in up to six guesses. Fewest guesses wins.',
    'Green with a bar: right spot. Yellow stripes: in the word, wrong spot. Grey: not in it.',
    'On a laptop just type: Enter to guess, Backspace to delete.',
  ],
  css,
  endDelay: 1900,
  ...RULES,
  // exposed for tests
  _test: { scoreGuess, lists, MAX },

  mount(el, api) {
    el.innerHTML = `<div class="g-wd">
      <div class="g-wd-head"><p class="g-wd-say" aria-live="polite"></p><div class="g-wd-strip"></div></div>
      <div class="g-wd-area"></div>
      <div class="g-wd-actions"></div>
      <div class="g-wd-kb" role="group" aria-label="Keyboard"></div>
    </div>`;
    const root = el.querySelector('.g-wd');
    const sayEl = root.querySelector('.g-wd-say');
    const stripEl = root.querySelector('.g-wd-strip');
    const area = root.querySelector('.g-wd-area');
    const actions = root.querySelector('.g-wd-actions');
    const kb = root.querySelector('.g-wd-kb');

    let ctx = null;
    let draft = '';
    let draftKey = '';
    let prevMoves = null;
    let flip = null; // { who, row, until } row that is revealing right now
    let win = null; // { who, row } row that bounces after a solve
    let pending = null; // one phone: { word, row } finishing guess shown before the phone is passed
    let areaSig = '';
    let actSig = '';
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
    const flipMs = () => (reduced() ? 60 : 4 * 160 + 520);
    const nm = (w) => api.name(w);
    const pcls = (w) => `p-${w}`;
    const up = (w) => String(w || '').toUpperCase();

    function modeOf(c) {
      if (!c) return 'blank';
      if (c.over) return 'end';
      const v = c.viewer;
      if (!v) return 'blank';
      const s = c.state;
      if (!s.secret.a || !s.secret.b) return s.secret[v] ? 'picked' : 'pick';
      if (pending) return 'solve';
      return doneBy(s, v) ? 'done' : 'solve';
    }

    // ── markup ──
    const tile = (ch, mark, i, cls = '') => `<span class="g-wd-tile${ch ? ' has' : ''}${mark ? ` m-${mark}` : ''}${cls}" style="--i:${i}">${ch ? up(ch) : ''}</span>`;
    function rowHTML(word, marks, { cls = '', tileCls = '', label = '' } = {}) {
      let h = '';
      for (let i = 0; i < 5; i++) h += tile(word ? word[i] || '' : '', marks ? marks[i] : '', i, tileCls);
      return `<div class="g-wd-row${cls}" role="img" aria-label="${label}">${h}</div>`;
    }
    const describe = (word, marks) => (word ? `${up(word)}: ` : '') + [...marks].map((m, i) => `${word ? up(word[i]) + ' ' : ''}${WORDS_FOR[m]}`).join(', ');
    function boardHTML(who, s, { blind = false, draftRow = false } = {}) {
      const tgt = target(s, who);
      const list = s.guesses[who].slice();
      if (pending && who === ctx.viewer) list.push(pending.word);
      let h = '';
      for (let r = 0; r < MAX; r++) {
        const g = list[r];
        if (g) {
          const marks = scoreGuess(tgt, g);
          const fl = flip && flip.who === who && flip.row === r;
          const wn = !fl && win && win.who === who && win.row === r;
          h += rowHTML(blind ? '' : g, marks, { cls: wn ? ' win' : '', tileCls: fl ? ' flip' : '', label: blind ? `Guess ${r + 1}: ${describe('', marks)}` : describe(g, marks) });
        } else if (draftRow && r === list.length) {
          h += rowHTML(draft, null, { cls: ' is-draft', label: 'Your guess' });
        } else h += rowHTML('', null, { label: '' });
      }
      return `<div class="g-wd-board" role="group">${h}</div>`;
    }
    function minisHTML(who, s) {
      const tgt = target(s, who);
      let h = '';
      for (let r = 0; r < MAX; r++) {
        const g = s.guesses[who][r];
        const marks = g ? scoreGuess(tgt, g) : '     ';
        h += `<span class="g-wd-mrow">${[...marks].map((m) => `<i class="g-wd-m${m.trim() ? ` m-${m}` : ''}"></i>`).join('')}</span>`;
      }
      return `<span class="g-wd-minis" role="img" aria-label="${nm(who)} has used ${s.guesses[who].length} of ${MAX} guesses">${h}</span>`;
    }
    function statusOf(s, w) {
      if (solvedBy(s, w)) return `cracked it in ${s.guesses[w].length}`;
      if (s.guesses[w].length >= MAX) return 'out of guesses';
      return `guess ${s.guesses[w].length + 1} of ${MAX}`;
    }
    function columnHTML(who, s, { blind, showTarget }) {
      const tgt = target(s, who);
      return `<div class="g-wd-col">
        <div class="g-wd-colhead"><span class="g-wd-who ${pcls(who)}">${nm(who)}</span><small>${statusOf(s, who)}</small></div>
        ${showTarget ? `<div class="g-wd-board g-wd-target">${rowHTML(tgt, null, { cls: ' is-target', label: `${nm(who)} was cracking ${up(tgt)}` })}</div>` : ''}
        ${boardHTML(who, s, { blind })}
      </div>`;
    }
    function keyboardHTML(c) {
      const v = c.viewer;
      const s = c.state;
      const best = {};
      const m = modeOf(c);
      if (m === 'solve') {
        const tgt = target(s, v);
        s.guesses[v].forEach((g, r) => {
          if (flip && flip.who === v && flip.row === r) return; // colour keys after the reveal
          const marks = scoreGuess(tgt, g);
          for (let i = 0; i < 5; i++) if ((RANK[marks[i]] || 0) > (RANK[best[g[i]]] || 0)) best[g[i]] = marks[i];
        });
      }
      const dis = !c.canMove || !!pending ? ' disabled' : '';
      return KB_ROWS.map((row) => `<div class="g-wd-kr">${[...row].map((k) => {
        if (k === '>') return `<button class="g-wd-key wide" data-k="enter" aria-label="Enter"${dis}>Enter</button>`;
        if (k === '<') return `<button class="g-wd-key wide" data-k="back" aria-label="Delete"${dis}>${BACK_ICON}</button>`;
        const mk = best[k];
        return `<button class="g-wd-key${mk ? ` m-${mk}` : ''}" data-k="${k}" aria-label="${up(k)}${mk ? `, ${WORDS_FOR[mk]}` : ''}"${dis}>${k}</button>`;
      }).join('')}</div>`).join('');
    }

    // ── paint ──
    function say(html) { sayEl.innerHTML = html; }
    function render() {
      const c = ctx;
      if (!c) return;
      const s = c.state;
      const v = c.viewer;
      const m = modeOf(c);
      root.dataset.mode = m;
      const p = v ? other(v) : null;

      // instruction line + strip
      if (m === 'blank') { say(''); stripEl.innerHTML = ''; }
      else if (m === 'pick') {
        say(`Pick a secret word for <span class="g-wd-who ${pcls(p)}">${nm(p)}</span> to crack.`);
        stripEl.innerHTML = c.mode === 'online' ? (s.secret[p] ? `<span><span class="g-wd-who ${pcls(p)}">${nm(p)}</span> has picked</span>` : `<span><span class="g-wd-who ${pcls(p)}">${nm(p)}</span> is picking…</span>`) : '';
      } else if (m === 'picked') {
        say(`Your word is locked in. The race starts when <span class="g-wd-who ${pcls(p)}">${nm(p)}</span> picks theirs.`);
        stripEl.innerHTML = '';
      } else if (m === 'solve') {
        const n = s.guesses[v].length + (pending ? 1 : 0);
        if (pending) {
          const got = pending.word === target(s, v);
          say(got ? `Cracked it in ${n}!` : `Out of guesses. It was <b>${up(target(s, v))}</b>.`);
        } else say(`Crack <span class="g-wd-who ${pcls(p)}">${nm(p)}</span>’s word. Guess ${n + 1} of ${MAX}.`);
        stripEl.innerHTML = `<span class="g-wd-who ${pcls(p)}">${nm(p)}</span>${minisHTML(p, s)}`;
      } else if (m === 'done') {
        say(solvedBy(s, v)
          ? `Cracked it in ${s.guesses[v].length}! Now <span class="g-wd-who ${pcls(p)}">${nm(p)}</span> is on your word…`
          : `Out of guesses. It was <b>${up(target(s, v))}</b>. <span class="g-wd-who ${pcls(p)}">${nm(p)}</span> is still going…`);
        stripEl.innerHTML = '';
      } else if (m === 'end') {
        const na = tally(s, 'a');
        const nb = tally(s, 'b');
        const fmt = (n) => (n > MAX ? 'missed' : `${n}`);
        if (na === nb) say(na > MAX ? 'Neither word was cracked.' : `Dead heat: both in ${na}.`);
        else {
          const w = na < nb ? 'a' : 'b';
          say(`<span class="g-wd-who ${pcls(w)}">${nm(w)}</span> wins, ${fmt(Math.min(na, nb))} to ${fmt(Math.max(na, nb))}.`);
        }
        stripEl.innerHTML = '';
      }

      // main area
      const sig = JSON.stringify([m, v, s.guesses.a.length, s.guesses.b.length, !!s.secret.a, !!s.secret.b, flip && [flip.who, flip.row], win && [win.who, win.row], pending && pending.word, c.canMove]);
      if (sig !== areaSig) {
        areaSig = sig;
        if (m === 'blank') area.innerHTML = '';
        else if (m === 'pick') {
          area.innerHTML = `<div class="g-wd-pick"><p class="g-wd-cap">Your secret word</p><div class="g-wd-board">${rowHTML(draft, null, { cls: ' is-draft', label: 'Your secret word' })}</div></div>`;
        } else if (m === 'picked') {
          area.innerHTML = `<div class="g-wd-pick"><p class="g-wd-cap">${nm(p)} has to crack</p><div class="g-wd-board">${rowHTML(s.secret[v], null, { label: `Your word ${up(s.secret[v])}` })}</div><span class="g-wd-stamp ${pcls(v)}">Locked in</span></div>`;
        } else if (m === 'solve') {
          area.innerHTML = boardHTML(v, s, { draftRow: !pending });
        } else if (m === 'done') {
          area.innerHTML = `<div class="g-wd-duo">${columnHTML(v, s, { blind: false, showTarget: true })}${columnHTML(p, s, { blind: true, showTarget: true })}</div>`;
        } else if (m === 'end') {
          const first = v || 'a';
          area.innerHTML = `<div class="g-wd-duo">${columnHTML(first, s, { blind: false, showTarget: true })}${columnHTML(other(first), s, { blind: false, showTarget: true })}</div>`;
        }
      }

      // actions
      const aSig = JSON.stringify([m, c.canMove, pending && pending.word]);
      if (aSig !== actSig) {
        actSig = aSig;
        if (m === 'pick') {
          const dis = c.canMove ? '' : ' disabled';
          actions.innerHTML = `<button class="gm-btn gm-btn-ghost" data-act="surprise"${dis}>Surprise me</button><button class="gm-btn" data-act="lock"${dis}>Lock it in</button>`;
        } else if (m === 'solve' && pending) {
          actions.innerHTML = `<div class="g-wd-banner"><button class="gm-btn" data-act="commit">Done, pass to ${nm(other(v))}</button></div>`;
        } else actions.innerHTML = '';
      }

      // keyboard
      kb.innerHTML = m === 'pick' || m === 'solve' ? keyboardHTML(c) : '';
    }

    function draftRowEl() { return area.querySelector('.g-wd-row.is-draft'); }
    function paintDraft(popAll = false) {
      const row = draftRowEl();
      if (!row) return;
      row.querySelectorAll('.g-wd-tile').forEach((t, i) => {
        const ch = draft[i] || '';
        t.textContent = up(ch);
        t.classList.toggle('has', !!ch);
        t.classList.remove('pop');
        if (ch && (popAll || i === draft.length - 1) && !reduced()) { void t.offsetWidth; t.classList.add('pop'); }
      });
    }
    function shake() {
      const row = draftRowEl();
      if (!row) return;
      row.classList.remove('shake');
      void row.offsetWidth;
      row.classList.add('shake');
      later(() => row.classList.remove('shake'), 420);
    }
    function bad(msg) {
      api.toast(msg);
      api.sfx('bad');
      api.haptic(30);
      shake();
    }
    const myFlip = () => !!(flip && ctx && flip.who === ctx.viewer && Date.now() < flip.until);

    function startFlip(who, row, solved, mine) {
      flip = { who, row, until: Date.now() + flipMs() };
      win = null;
      if (mine && !reduced()) for (let i = 0; i < 5; i++) later(() => api.sfx('flip'), i * 160 + 250);
      later(() => {
        if (!flip || flip.who !== who || flip.row !== row) return;
        flip = null;
        if (solved) {
          win = { who, row };
          if (mine) { api.sfx('good'); api.haptic(20); }
          later(() => { if (win && win.who === who && win.row === row) win = null; }, 1000);
        }
        else if (mine && ctx && ctx.state.guesses[who].length + (pending ? 1 : 0) >= MAX) api.sfx('lose');
        render();
      }, flipMs());
    }

    function submit() {
      const c = ctx;
      if (!c || !c.canMove || pending) return;
      const m = modeOf(c);
      const v = c.viewer;
      if (m !== 'pick' && m !== 'solve') return;
      if (draft.length < 5) { bad(draft.length ? 'Five letters, please.' : 'Type a five-letter word.'); return; }
      if (m === 'pick') {
        const word = draft;
        draft = ''; // the move re-renders synchronously
        const r = api.move({ secret: word });
        if (!r.ok) { draft = word; bad(r.error); return; }
        api.sfx('place');
        api.haptic(15);
        return;
      }
      const s = c.state;
      if (c.mode === 'local' && !doneBy(s, other(v))) {
        // One phone: the finishing guess reveals here first, so its player sees it before the
        // pass-the-phone curtain. Same checks as apply().
        try { apply(JSON.parse(JSON.stringify(s)), v, { guess: draft }); } catch (e) { bad(e.message); return; }
        const finishing = draft === target(s, v) || s.guesses[v].length + 1 >= MAX;
        if (finishing) {
          pending = { word: draft, row: s.guesses[v].length };
          draft = '';
          startFlip(v, pending.row, pending.word === target(s, v), true);
          render();
          return;
        }
      }
      const word = draft;
      draft = '';
      const r = api.move({ guess: word });
      if (!r.ok) { draft = word; bad(r.error); }
    }

    function commit() {
      if (!pending || !ctx || !ctx.canMove) return;
      const word = pending.word;
      pending = null;
      flip = null;
      const r = api.move({ guess: word });
      if (!r.ok) { api.toast(r.error); render(); return; }
      api.sfx('place');
    }

    function press(k) {
      const c = ctx;
      if (!c || !c.canMove) return;
      if (pending) { if (k === 'enter') commit(); return; }
      const m = modeOf(c);
      if (m !== 'pick' && m !== 'solve') return;
      if (k === 'enter') { submit(); return; }
      if (k === 'back') {
        if (!draft) return;
        draft = draft.slice(0, -1);
        api.sfx('tick');
        paintDraft();
        return;
      }
      if (!/^[a-z]$/.test(k) || draft.length >= 5) return;
      draft += k;
      api.sfx('tap');
      paintDraft();
    }

    // on-screen keyboard and buttons (keep focus off the keys so Enter never re-presses one)
    kb.addEventListener('mousedown', (e) => e.preventDefault());
    kb.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b || b.disabled) return;
      press(b.dataset.k);
    });
    actions.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || b.disabled || !ctx || !ctx.canMove) return;
      const act = b.dataset.act;
      if (act === 'surprise') {
        const list = lists().common;
        let w = draft;
        while (w === draft) w = list[Math.floor(Math.random() * list.length)];
        draft = w;
        api.sfx('pop');
        paintDraft(true);
      } else if (act === 'lock') submit();
      else if (act === 'commit') commit();
      b.blur();
    });
    // physical keyboard on laptops
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!root.isConnected) return;
      const gm = root.closest('.gm');
      if (gm && gm.querySelector(':scope > .gm-sheet:not([hidden]), :scope > .gm-end:not([hidden]), :scope > .gm-curtain:not([hidden])')) return;
      let k = null;
      if (e.key === 'Enter') k = 'enter';
      else if (e.key === 'Backspace' || e.key === 'Delete') k = 'back';
      else if (/^[a-zA-Z]$/.test(e.key)) k = e.key.toLowerCase();
      if (!k || !ctx || !ctx.canMove) return;
      e.preventDefault();
      press(k);
    };
    document.addEventListener('keydown', onKey);

    return {
      update(c) {
        ctx = c;
        const s = c.state;
        const dk = `${c.viewer}|${c.curtain}`;
        if (dk !== draftKey) { draftKey = dk; draft = ''; pending = null; flip = null; win = null; }
        if (prevMoves != null && c.moves > prevMoves && c.last && c.last.move) {
          const { who, move } = c.last;
          if (move.guess !== undefined && c.viewer) {
            const row = s.guesses[who].length - 1;
            const solved = solvedBy(s, who);
            if (who === c.viewer) startFlip(who, row, solved, true);
            else {
              api.sfx('tick');
              const mm = modeOf(c); // their rows only show full size once I'm done
              if ((mm === 'done' || mm === 'end') && !myFlip()) startFlip(who, row, solved, false);
            }
          } else if (move.secret !== undefined && c.viewer && who !== c.viewer) api.sfx('pop');
        }
        prevMoves = c.moves;
        render();
      },
      destroy() {
        document.removeEventListener('keydown', onKey);
        for (const t of timers) clearTimeout(t);
        timers.clear();
      },
    };
  },
});

// ── word lists ──
const ANSWERS = `
abackabateabbeyabbotabhorabideabodeabortaboutaboveabuseabyssacornacridactoracuteadageadaptadeptadminadmitadobeadoptadoreadornadultaffixafireafootafoulafteragainagateagentagileagingaglowagonyagoraagreeaheadaislealarmalbumalertalgaealibialienalignalikealiveallayalleyallotallowalloyaloftalonealongaloofaloudalphaaltaralteramassamazeamberambleamendamissamityamongampleamplyamuseangelangerangleangryangstanimeankleannexannoyannulanodeanvilaortaapartaphidapneaappleapplyapronaptlyarborardorarenaarguearisearmoraromaarosearrayarrowarsonartsyascotashenasideaskewassayassetatollatoneatticaudioauditauntyavail
avertavianavoidawaitawakeawardawareawashawfulawokeaxialaxiomazurebaconbadgebadlybagelbaggybakerbalmybanalbanjobargebaronbasalbasicbasilbasinbasisbastebatchbathebatonbattybawdybayoubeachbeadybeardbeastbeechbeefybefitbeganbegatbegetbeginbegunbeingbelchbeliebellebellybelowbenchberetberryberthbesetbevelbezelbiblebicepbiddybigotbilgebillybingebingobiomebirchbirthbisonbittyblackbladeblameblandblankblareblastblazebleakbleatbleedbleepblendblessblimpblindblinkblissblitzbloatblockblokeblondbloodbloomblownbluerbluffbluntblurbblurtblushboardboastbobbybongobonusboostboothbootyboozeboraxbornebosombossybotch
boughbouleboundbowelboxerbracebraidbrainbrakebrandbrashbrassbravebravobrawlbrawnbreadbreakbreedbriarbribebrickbridebriefbrinebringbrinkbrinybriskbroadbroilbrokebroodbrookbroombrothbrownbruntbrushbrutebuddybudgebuggybuglebuildbuiltbulgebulkybullybunchbunnyburlyburntburstbushybuttebuyerbylawcabalcabbycabincablecacaocachecacticaddycadetcageycairncamelcameocanalcandycannycanoecanoncapercaratcargocarolcarrycarvecastecatchcatercattycaulkcauseceasecedarcellochafechaffchainchairchalkchampchantchaoschardcharmchartchasechasmcheapcheatcheckcheekcheerchesschestchickchiefchildchilichillchimechinachirpchock
choirchokechordchorechosechuckchumpchunkchurnchutecidercigarcinchcircaciviccivilclackclaimclampclangclankclashclaspclasscleanclearcleatcleftclerkclickcliffclimbclingclinkcloakclockclonecloseclothcloudcloutcloveclowncluckcluedclumpclungcoachcoastcobracocoacoloncolorcometcomfycomiccommaconchcondoconiccopsecoralcornycouchcoughcouldcountcoupecourtcovencovercovetcoveycowercrackcraftcrampcranecrankcrashcrasscratecravecrawlcrazecrazycreakcreamcredocreedcreekcreepcremecrepecreptcresscrestcrickcriedcriercrimecrimpcrispcroakcrockcronecronycrookcrosscroupcrowdcrowncrudecruelcrumbcrushcrustcryptcubiccumin
curiocurlycurrycursecurvecurvycutiecybercyclecynicdaddydailydairydaisydallydancedandydatumdealtdeathdebitdebugdebutdecaldecaydecordecoydecrydeferdeigndeitydelaydeltadelvedemondenimdensedepotdepthderbydeterdetoxdeucedevildiarydiceydigitdillydimlydinerdingodingydiodedirgedirtydiscoditchdittodittydiverdizzydodgedodgydogmadoingdollydonordonutdopeydoubtdoughdowdydoweldownydowrydozendraftdraindrakedramadrankdrapedrawldrawndreaddreamdressdrieddrierdriftdrilldrinkdrivedrolldronedrooldroopdrovedrowndruiddrunkdryerduchydummydumpydunceduskydustydutchduvetdwarfdwelldweltdyingeagereagleearlyeartheaseleaten
eaterebonyedicteerieegreteightejectelateelbowelderelectelegyelfineliteelopeeludeemailembedemberemceeemptyenactendowenemaenemyenjoyennuiensueenterentryenvoyepochepoxyequalequiperaseerecterodeerroreruptessayetherethicethosetudeevadeeventeveryevictevokeexactexaltexcelexertexileexistexpelextolextraexultfablefacetfaintfairyfaithfalsefancyfarcefatalfaultfaunafavorfeastfecalfeignfellafelonfemmefemurfenceferalferryfetalfetchfetidfetusfeverfewerfiberfibreficusfieldfiendfieryfifthfiftyfightfiletfillyfilmyfilthfinalfinchfinerfirstfishyfixerfizzyfjordflackflailflairflakeflakyflameflankflareflashflaskfleck
fleetfleshflickflierflingflintflirtfloatflockfloodfloorfloraflossflourfloutflownflufffluidflukeflumeflungflunkflushfluteflyerfoamyfocalfocusfoggyfoistfoliofollyforayforceforgeforgoforteforthfortyforumfoundfoyerfrailframefrankfraudfreakfreedfreerfreshfriarfriedfrillfriskfritzfrockfrondfrontfrostfrothfrownfrozefruitfudgefuguefullyfungifunkyfunnyfurorfurryfussyfuzzygaffegailygamergammagamutgassygaudygaugegauntgauzegavelgawkygayergeckogeekygeesegeniegenreghostghoulgiantgiddygipsygirlygirthgivengivergladeglandglareglassglazegleamgleanglideglintgloatglobegloomgloryglossgloveglyphgnashgnomegodlygoing
golemgollygonadgonergoodygooeygoofygoosegorgegougegourdgracegradegraftgrailgraingrandgrantgrapegraphgraspgrassgrategravegravygrazegreatgreedgreengreetgriefgrillgrimegrimygrindgripegroangroingroomgropegrossgroupgroutgrovegrowlgrowngruelgruffgruntguardguavaguessguestguideguildguileguiltguisegulchgullygumbogummyguppygustogustyhabithairyhalvehandyhappyhardyharpyharryharshhastehastyhatchhaterhaunthautehavenhavochazelheadyheardheartheathheaveheavyhedgeheftyheisthelixhellohenceheronhillyhingehippohippyhitchhoardhobbyhoisthollyhomerhoneyhonorhordehorsehotelhotlyhoundhousehovelhoverhowdyhumanhumidhumor
humphhumushunchhunkyhurryhuskyhutchhydrohyenahymenhypericilyicingidealidiomidiotidleridylliglooiliacimageimplyinaneinboxincurindexineptinertinferingotinlayinletinnerinputinterintroionicirateironyisletissueitchyivoryjauntjazzyjellyjerkyjettyjeweljiffyjointjoistjokerjollyjoustjudgejuicejuicyjumbojumpyjuntajurorkappakarmakayakkebabkhakikioskkittyknackknavekneadkneedkneelkneltknifeknockknollknownkoalakrilllabellaborladenladlelagerlancelankylapellapselargelarvalassolatchlaterlathelattelaughlayerleachleafyleakyleaptlearnleaseleashleastleaveledgeleechleeryleftylegalleggylemonlemurleperlevelleverlibel
liegelightlilaclimbolimitlinenlinerlingolipidlitheliverlividllamaloamyloathlobbylocallocuslodgeloftylogicloginloopylooselorryloserlouselousyloverlowerlowlyloyallucidluckylumpylunarlunchlungelupuslurchluridlyinglymphlynchlyricmacawmachomacromadammadlymafiamagicmagmamaizemajormakermambomammamammymangamangemangomangymaniamanicmanlymanormaplemarchmarrymarshmasonmassematchmateymauvemaximmaybemayormealymeantmeatymeccamedalmediamedicmeleemelonmercymergemeritmerrymetalmetermetromicromidgemidstmightmilkymimicminceminerminormintyminusmirthmisermissymochamodalmodelmodemmogulmoistmolarmoldymoneymonthmoody
moosemoralmorphmossymotelmotifmotormottomoultmoundmountmournmousemouthmovermoviemowermuckymucusmuddymulchmummymunchmuralmurkymushymusicmuskymustymyrrhnadirnaivenannynasalnastynatalnavalnavelneedyneighnerdynervenevernewernewlynicernicheniecenightninjaninnyninthnoblenoblynoisenoisynomadnoosenorthnoseynotchnovelnudgenursenuttynylonnymphobeseoccuroceanoctetoddlyoffalofferoftenoldenolderoliveombreomegaoniononsetoperaopineopiumopticorbitorderorganotherotteroughtounceoutdoouterovaryovertowingowneroxideozonepaddypaganpaintpalerpalsypanelpanicpapalpaperparkaparryparsepartypastapastepastypatchpatiopatsy
pattypausepayeepayerpeacepeachpearlpecanpedalpenalpencepennepennyperchperilperkypeskypestopetalpettyphasephonephonyphotopianopickypiecepietypiggypilotpinchpineypinkypintopiperpiquepitchpithypivotpixelpixiepizzaplaceplaidplainplaitplaneplankplantplateplazapleadpleatpliedpluckplumbplumeplumpplunkplushpointpoisepokerpolarpolkapolyppoochpoppyporchposerpositpossepouchpoundpoutypowerprankprawnpreenpresspricepridepriedprimeprimoprintpriorprismprivyprizeprobeproneprongproofproseproudproveprowlproxyprudeprunepsalmpudgypuffypulpypulsepunchpupalpupilpuppypureepurerpurgepursepushyputtypygmyquackquailquake
qualmquarkquartquashquasiqueenquellqueryquestqueuequickquietquillquiltquirkquitequotaquoterabbirabidracerradarradiiradiorainyraiserajahrallyralphramenranchrandyrangerapidrarerraspyratiorattyravenrayonrazorreachreactreadyrealmrearmrebarrebelrebusrebutrecaprecurrecutreedyreferrefitregalrehabreignrelaxrelayrelicremitrenalrenewrepayrepelreplyrerunresetresinretchretroretryreuserevelrevuerhinorhymeriderridgeriflerightrigidrigorrinseripenrisenriserriskyrivalriverrivetroachroastrobinrobotrockyrodeorogerrogueroomyroostrotorrougeroughroundrouserouteroverrowdyroyalruddyruderrugbyrulerrumbarumorrupeerural
rustysadlysafersaintsaladsallysalonsalsasaltysalvesalvosandysanersappysassysatinsatyrsaucesaucysaunasautesavorsavoysavvyscaldscalescalpscalyscampscantscarescarfscaryscenescentscionscoffscoldsconescoopscopescorescornscourscoutscowlscramscrapscreescrewscrubscrumscubasedanseedysegueseizesensesepiaserifserumservesetupsevenseversewershackshadeshadyshaftshakeshakyshaleshallshaltshameshankshapeshardsharesharksharpshaveshawlshearsheensheepsheersheetsheikshelfshellshiedshiftshineshinyshireshirkshirtshoalshockshoneshookshootshoreshornshortshoutshoveshownshowyshrewshrubshrugshuckshuntshushshylysiegesieve
sightsigmasilkysillysincesinewsingesirensixthsixtyskateskierskiffskillskimpskirtskulkskullskunkslackslainslangslantslashslatesleeksleepsleetsleptsliceslickslideslimeslimyslingslinksloopslopesloshslothslumpslungslunkslurpslushsmacksmallsmartsmashsmearsmellsmeltsmilesmirksmitesmithsmocksmokesmokysmotesnacksnailsnakesnaresnarlsneaksneersnidesniffsnipesnoopsnoresnortsnoutsnowysnucksnuffsoapysobersoggysolarsolidsolvesonarsonicsoothsootysorrysoundsouthspacespadespanksparesparkspasmspawnspeakspearspeckspeedspellspeltspendspentspicespicyspiedspielspikespikyspillspiltspinespinyspirespitesplatsplitspoil
spokespoofspookspoolspoonsporesportspoutsprayspreesprigspurnspurtsquadsquatsquibstackstaffstagestainstairstakestalestalkstallstampstandstankstarestarkstartstashstatestavesteadsteakstealsteamsteedsteelsteepsteersteinsternstickstiffstillstiltstingstinkstintstockstoicstokestolestompstonestonystoodstoolstoopstorestorkstormstorystoutstovestrapstrawstraystripstrutstuckstudystuffstumpstungstunkstuntstylesuavesugarsuingsuitesulkysullysumacsunnysupersurersurgesurlysushiswamiswampswarmswathswearsweatsweepsweetswellsweptswiftswillswineswingswirlswishswoonswoopswordsworeswornswungsynodsyruptabbytabletaboo
tacittackytaffytainttakentakertallytalontamertangotangytapertapirtardytarottastetastytattytaunttawnyteachtearyteaseteddyteethtempotenettenortensetenthtepeetepidterratersetestythankthefttheirthemetherethesethetathickthiefthighthingthinkthirdthongthornthosethreethrewthrobthrowthrumthumbthumpthymetiaratibiatidaltigertighttildetimertimidtipsytitantithetitletoasttodaytoddytokentonaltongatonictoothtopaztopictorchtorsotorustotaltotemtouchtoughtoweltowertoxictoxintracetracktracttradetrailtraintraittrashtrawltreadtreattrendtriadtrialtribetricetricktriedtripetritetrolltrooptropetrouttrovetrucetrucktruer
trulytrumptrunktrusstrusttruthtrysttubaltubertuliptulletumortunicturbotutortwangtweaktweedtweettwicetwinetwirltwisttwixttyingudderulcerultraumbrauncleuncutunderundidundueunfitunifyunionuniteunityunmetuntieuntilunwedunzipupperupseturbanurineusageusherusingusualusurputtervaguevaletvalidvalorvaluevalvevapidvaporvaultvauntveganvenomvenuevergeverseversovervevicarvideovigilvigorvillavinylviolaviperviralvirusvisitvisorvistavitalvividvixenvocalvodkavoguevoicevoilavomitvotervouchvowelvyingwackywaferwagerwagonwaistwaivewaltzwartywastewatchwaterwaverwaxenwearyweavewedgeweedyweighweirdwelchwelshwhackwhale
wharfwheatwheelwhelpwherewhichwhiffwhilewhinewhinywhirlwhiskwhitewholewhoopwhosewidenwiderwidowwidthwieldwightwimpywincewinchwindywiserwispywitchwittywokenwomanwomenwoodywoolywoozywordyworldworryworseworstworthwouldwoundwovenwrathwreakwreckwrestwringwristwritewrongwrotewrungyachtyearnyeastyieldyoungyouthzebrazestyzonal
`.replace(/\s+/g, '');
const MORE = `
aahedaaliiaarghaartiabacaabaciabacsabaftabakaabampabandabaseabashabaskabayaabbasabbedabbesabceeabeamabearabeleabersabetsabiesabledablerablesabletablowabmhoabohmaboilabomaaboonabordaboreabramabrayabrimabrinabrisabseyabsitabunaabuneabutsabuzzabyesabysmacaisacariaccasaccoyacerbacersacetaacharachedachesachooacidsacidyacingaciniackeeackeracmesacmicacnedacnesacockacoldacredacresacrosactedactinactonacylsadawsadaysadbotaddaxaddedadderaddioaddleadeemadhanadieuadiosaditsadmanadmenadmixadoboadownadozeadradadredadsumadukiaduncadustadvewadytaadzedadzesaeciaaedesaegisaeonsaerieaerosaesirafaldafaraafarsafear
aflajaforeafritafrosagamaagamiagapeagarsagastagaveagazeageneagersaggeraggieaggriaggroaggryaghasagilaagiosagismagistagitaagleeagletagleyaglooaglusagmasagogeagoneagonsagoodagriaagrinagrosaguedaguesagunaagutiaheapahentahighahindahingahintaholdahullahuruaidasaidedaideraidesaidoiaidosaieryaigasaightailedaimedaimeraineeaingaaioliairedairerairnsairthairtsaitchaitusaiveraiyeeaizleajiesajivaajugaajwanakeesakelaakeneakingakitaakkasalaapalackalamoalandalanealangalansalantalapaalapsalaryalatealaysalbasalbeealcidalcosaldeaalderaldolaleckalecsalefsaleftalephalewsaleyealfasalgalalgasalgidalginalgoralgumalias
alifsalinealistaliyaalkiealkosalkydalkylalleeallelallisallodallylalmahalmasalmehalmesalmudalmugalodsaloedaloesalohaaloinaloosalowealthoaltosalulaalumsalurealvaralwayamahsamainamateamautambanambitambosambryamebaameerameneamensamentamiasamiceamiciamideamidoamidsamiesamigaamigoamineaminoaminsamirsamlasammanammonammosamniaamnicamnioamoksamoleamortamouramoveamowtampedampulamritamuckamylsananaanataanchoancleanconandroanearaneleanentangasangloanighanileanilsanimaanimianionaniseankerankhsankusanlasannalannasannatanoasanoleanomyansaeantaeantarantasantedantesanticantisantraantreantsyanuraanyonapaceapage
apaidapaydapaysapeakapeekapersapertaperyapgaraphisapianapingapiolapishapismapodeapodsapoopaportappalappayappelapproappuiappuyapresapsesapsisapsosaptedapteraquaeaquasarabaaraksarameararsarbasarcedarchiarcosarcusardebardriareadareaearealarearareasarecaareddaredearefyareicarenearepaarerearetearetsarettargalarganargilargleargolargonargotargusarhatariasarielarikiarilsariotarisharkedarledarlesarmedarmerarmetarmilarnasarnutarobaarohaaroidarpasarpenarraharrasarretarrisarrozarsedarsesarseyarsisartalartelarticartisaruhearumsarvalarveearvosarylsasanaasconascusasdicashedashesashetaskedaskeraskoiaskosaspen
asperaspicaspieaspisasproassaiassamassesassezassotasterastirastunasuraaswayaswimasylaatapsataxyatigiatiltatimyatlasatmanatmasatmosatocsatokeatoksatomsatomyatonyatopyatriaatripattapattaratuasaudadaugeraughtauguraulasaulicauloiaulosaumilaunesauntsauraeauralauraraurasaureiauresauricaurisaurumautosauxinavaleavantavastavelsavensaversavgasavineavionaviseavisoavizeavowsavyzeawarnawatoawaveawaysawdlsaweelawetoawingawmryawnedawnerawolsaworkaxelsaxileaxilsaxingaxionaxiteaxledaxlesaxmanaxmenaxoidaxoneaxonsayahsayayaayelpaygreayinsayontayresayrieazansazideazidoazineazlonazoicazoleazonsazoteazothazukiazurn
azuryazygyazymeazymsbaaedbaalsbabasbabelbabesbabkababoobabulbabusbaccabaccobaccybachabachsbacksbaddybaelsbaffsbaffybaftsbaghsbagiebahtsbahusbahutbailsbairnbaisabaithbaitsbaizabaizebajanbajrabajribajusbakedbakenbakesbakrabalasbaldsbaldybaledbalerbalesbalksbalkyballsballybalmsbaloobalsabaltibalunbalusbambibanakbancobancsbandabandhbandsbandybanedbanesbangsbaniabanksbannsbantsbantubantybanyabapusbarbebarbsbarbybarcabardebardobardsbardybaredbarerbaresbarfibarfsbaricbarksbarkybarmsbarmybarnsbarnybarpsbarrabarrebarrobarrybaryebasanbasedbasenbaserbasesbashobasijbasksbasonbassebassibassobassybastabasti
bastobastsbatedbatesbathsbatikbattabattsbattubaudsbauksbaulkbaursbavinbawdsbawksbawlsbawnsbawrsbawtybayedbayerbayesbaylebaytsbazarbazoobeadsbeaksbeakybealsbeamsbeamybeanobeansbeanybearebearsbeathbeatsbeatybeausbeautbeauxbebopbecapbeckebecksbedadbedelbedesbedewbedimbedyebeedibeefsbeepsbeersbeerybeetsbefogbegadbegarbegembegotbegumbeigebeigybeinsbekahbelahbelarbelaybeleebelgabellsbelonbeltsbemadbemasbemixbemudbendsbendybenesbenetbengabenisbennebennibennybentobentsbentybepatberayberesbergsberkoberksbermebermsberobberylbesatbesawbeseebesesbesitbesombesotbestibestsbetasbetedbetelbetesbethsbetidbeton
bettabettybeverbevorbevuebevvybewetbewigbezesbezilbezzybhaisbhajibhangbhatsbhelsbhootbhunabhutsbiachbialibialybibbsbibesbiccybicesbidedbiderbidesbidetbidisbidonbieldbiersbiffobiffsbiffybifidbigaebiggsbiggybighabightbiglybigosbijoubikedbikerbikesbikiebilbobilbybiledbilesbilgybilksbillsbimahbimasbimbobinalbindibindsbinerbinesbingsbingybinitbinksbintsbiogsbiontbiotabipedbipodbirdsbirksbirlebirlsbirosbirrsbirsebirsybisesbisksbisombiterbitesbitosbitoubitsybittebittsbiviabivvybizesbizzobizzyblabsbladsbladyblaerblaesblaffblagsblahsblainblamsblartblaseblashblateblatsblattblaudblawnblawsblaysblearblebs
blechbleesblentblertblestbletsbleysblimyblingbliniblinsblinyblipsblistbliteblitsbliveblobsblocsblogsblookbloopbloreblotsblowsblowyblubsbludebludsbludybluedbluesbluetblueybluidblumeblunkblursblypeboabsboaksboarsboartboatsbobacbobakbobasbobolbobosboccabocceboccibochebocksbodedbodesbodgebodhibodleboepsboetsboeufboffoboffsboganbogeyboggybogiebogleboguebogusboheabohosboilsboingboinkboitebokedbokehbokesbokosbolarbolasboldsbolesbolixbollsbolosboltsbolusbomasbombebombobombsboncebondsbonedbonesboneybongsboniebonksbonnebonnybonzabonzebooaibooayboodybooedboofyboogyboohsbooksbookyboolsboomsboomyboongboons
boordboorsboosebootsboozyboppyborakboralborasbordebordsboredboreeborelborerboresborgoboricborksbormsbornaboronbortsbortybortzbosiebosksboskybosonbosunbotasbotelbotesbothybottebottsbottybougebouksboultbounsbourdbourgbournbousebousyboutsbovidbowatbowedbowerbowesbowetbowiebowlsbownebowrsbowseboxedboxenboxesboxlaboxtyboyarboyauboyedboyfsboygsboylaboyosboysybozosbraaibrachbrackbractbradsbraesbragsbrailbraksbrakybramebranebrankbransbrantbrastbratsbravabravibrawsbraxybraysbrazabrazebreambredebredsbreembreerbreesbreidbreisbremebrensbrentbrerebrersbrevebrewsbreysbrierbriesbrigsbrikibriksbrillbrimsbrins
briosbrisebrissbrithbritsbrittbrizebrochbrockbrodsbroghbrogsbromebromobroncbrondbroolbroosbrosebrosybrowsbrughbruinbruitbrulebrumebrungbruskbrustbrutsbuatsbuazebubalbubasbubbabubbebubbybubusbuchubuckobucksbuckubudasbudisbudosbuffabuffebuffibuffobuffsbuffybufosbuftybuhlsbuhrsbuiksbuistbukesbulbsbulgybulksbullabullsbulsebumbobumfsbumphbumpsbumpybunasbuncebuncobundebundhbundsbundtbundubundybungsbungybuniabunjebunjybunkobunksbunnsbuntsbuntybunyabuoysbuppyburanburasburbsburdsburetburfiburghburgsburinburkaburkeburksburlsburnsburooburpsburqaburroburrsburrybursabursebusbybusedbusesbusksbuskybussubusti
bustsbustybutchbuteobutesbutlebutohbuttsbuttybututbutylbuxombuzzybwanabwazibydedbydesbykedbykesbyresbyrlsbyssibytesbywaycaaedcabascabercabobcaboccabrecacascackscackycadeecadescadgecadgycadiecadiscadrecaecacaesecafescaffscagedcagercagescagotcahowcaidscainscairdcajoncajuncakedcakescakeycalfscalidcalifcalixcalkscallacallscalmscalmycaloscalpacalpscalvecalyxcamancamascamescamiscamoscampicampocampscampycamuscanedcanehcanercanescangscanidcannacannscansocanstcantocantscantycapascapedcapescapexcaphscapizcaplecaponcaposcapotcapricapulcaputcarapcarbocarbscarbycardicardscardycaredcarercarescaretcarexcarks
carlecarlscarnscarnycarobcaromcaroncarpicarpscarrscarsecartacartecartscarvycasascascocasedcasescaskscaskycastscasuscatescaudacaukscauldcaulscaumscaupscauricausacavascavedcavelcavercavescaviecavilcawedcawkscaxonceazecebidcecalcecumcededcedercedescedisceibaceiliceilscelebcellacellicellscelomceltscensecentocentscentuceorlcepescerciceredcerescergeceriacericcernecerocceroscertscertycessecestacesticetescetylcezvechacechackchacochadochadschaftchaischalschamschanachangchankchapechapschaptcharacharecharkcharrcharscharychatschavechavschawkchawschayachayscheepchefschekachelachelpchemochemscherechertcheth
chevychewschewychiaochiaschibschicachichchicochicschidechielchikschilechimbchimochimpchinechingchinochinschipschirkchirlchirmchirochirrchirtchiruchitschivechivschivychizzchocochocschodechogschoilchokochokycholacholicholochompchonschoofchookchoomchoonchopschotachottchoutchouxchowkchowschubschufachuffchugschumschurlchurrchusechutschylechymechyndcibolcidedcidescielsciggyciliacillscimarcimexcinctcinescinqscionscippicircscirescirlscirriciscocissycistscitalcitedcitercitescivescivetciviecivvyclachcladecladsclaesclagsclameclamsclansclapsclaptclaroclartclaryclastclatsclautclaveclaviclawsclayscleckcleek
cleepclefsclegscleikclemsclepecleptcleveclewscliedcliescliftclimeclineclintclipeclipscliptcloamclodscloffclogsclokeclombclompclonkclonscloopclootclopscloteclotsclourclousclowscloyecloysclozeclubscluesclueyclunkclypecnidacoactcoadycoalacoalscoalycoaptcoarbcoatecoaticoatscobbscobbycobiacoblecobzacocascoccicoccocockycocoscodascodeccodedcodencodercodescodexcodoncoedscoffscogiecogoncoguecohabcohencohoecohogcohoscoifscoigncoilscoinscoirscoitscokedcokescolascolbycoldscoledcolescoleycoliccolincollscollycologcoltscolzacomaecomalcomascombecombicombocombscombycomercomescomixcommocommscommycompocompscompt
comtecomusconedconesconeyconfscongacongecongoconiaconinconksconkyconneconnscontecontoconusconvocoochcooedcooeecooercooeycoofscookscookycoolscoolycoombcoomscoomycoopscooptcoostcootscoozecopalcopaycopedcopencopercopescoppycopracopsycoquicoramcorbecorbycordscoredcorercorescoreycorgicoriacorkscorkycormscornicornocornscornucorpscorsecorsocoseccosedcosescosetcoseycosiecostacostecostscotancotedcotescothscottacottscoudecoupscourbcourdcourecourscoutacouthcovedcovescovincowalcowancowedcowkscowlscowpscowrycoxaecoxalcoxedcoxescoxibcoyaucoyedcoyercoylycoypucozedcozencozescozeycoziecraalcrabscragscraiccraig
crakecramecramscranscrapecrapscrapycrarecrawscrayscredscreelcreescremscrenacrepscrepycrewecrewscriascribscriescrimscrinecrioscripecripscrisecrithcritscrocicrocscroftcrogscrombcromecronkcronscroolcrooncropscrorecrostcroutcrowscrozecruckcrudocrudscrudycruescruetcruftcrumpcrunkcruorcruracrusecrusycruvecrwthcryerctenecubbycubebcubedcubercubescubitcuddycuffocuffscuifscuingcuishcuitscukesculchculetculexcullscullyculmsculpaculticultscultycumeccundycuneicunitcupelcupidcuppacuppycuratcurbscurchcurdscurdycuredcurercurescuretcurfscuriacuriecurlicurlscurnscurnycurrscursicurstcuseccushycuskscuspscuspycusso
cusumcutchcutercutescuteycutincutiscuttocuttycutupcuveecuzescwtchcyanocyanscycadcycascyclocydercylixcymaecymarcymascymescymolcystscytescytonczarsdaalsdabbadacesdachadacksdadahdadasdadosdaffsdaffydaggadaggydahlsdaikodainedaintdakerdaleddalesdalisdalledaltsdamandamardamesdammedamnsdampsdampydancydangsdaniodanksdannydantsdarafdarbsdarcydareddarerdaresdargadargsdaricdarisdarksdarnsdarredartsdarzidashidashydataldateddaterdatesdatosdattodaubedaubsdaubydaudsdaultdauntdaursdautsdavendavitdawahdawdsdaweddawendawksdawnsdawtsdayandaychdayntdazeddazerdazesdeadsdeairdealsdeansdearedearndearsdearydeashdeave
deawsdeawydebagdebardebbydebeldebesdebtsdebuddeburdebusdebyedecaddecafdecandeckodecksdecosdedaldeedsdeedydeelydeemsdeensdeepsdeeredeersdeetsdeevedeevsdefatdeffodefisdefogdegasdegumdegusdeicedeidsdeifydeilsdeismdeistdekeddekesdekkodeleddelesdelfsdelftdelisdellsdellydelosdelphdeltsdemandemesdemicdemitdemobdemoidemosdemptdemurdenardenaydenchdenesdenetdenisdentsdeoxyderatderayderedderesderigdermadermsdernsdernyderosderroderryderthdervsdesexdeshidesisdesksdessedevasdeveldevisdevondevosdevotdewandewardewaxdeweddexesdexiedhabadhaksdhalsdhikrdhobidholedholldholsdhotidhowsdhutidiactdialsdianediazodibbs
diceddicerdicesdichtdicksdickydicotdictadictsdictydiddydidiedidosdidstdiebsdielsdienedietsdiffsdightdikasdikeddikerdikesdikeydillidillsdimbodimerdimesdimpsdinardineddinesdingedingsdinicdinkydinnadinosdintsdiolsdiotadippydipsodiramdirerdirkedirksdirlsdirtsdisasdiscidiscsdishydisksdismeditalditasditedditesditsydittsditzydivandivasdiveddivesdivisdivnadivosdivotdivvydiwandixiedixitdiyasdizendjinndjinsdoabsdoatsdobbydobesdobiedobladobradobrodochtdocksdocosdocusdoddydodosdoeksdoersdoestdoethdoffsdogandogesdogeydoggodoggydogiedohyodoiltdoilydoitsdojosdolcedolcidoleddolesdoliadollsdolmadolordolosdolts
domaldomeddomesdomicdonahdonasdoneedonerdongadongsdonkodonnadonnedonnydonsydoobsdoocedoodydooksdooledoolsdoolydoomsdoomydoonadoorndoorsdoozydopasdopeddoperdopesdoraddorbadorbsdoreedoresdoricdorisdorksdorkydormsdormydorpsdorrsdorsadorsedortsdortydosaidosasdoseddosehdoserdosesdoshadotaldoteddoterdotesdottydouardoucedoucsdouksdouladoumadoumsdoupsdouradousedoutsdoveddovendoverdovesdoviedowardowdsdoweddowerdowiedowledowlsdowlydownadownsdowpsdowsedowtsdoxeddoxesdoxiedoyendoylydozeddozerdozesdrabsdrackdracodraffdragsdraildramsdrantdrapsdratsdravedrawsdraysdreardreckdreeddreerdreesdregsdreksdrentdrere
drestdreysdribsdricedriesdrilydripsdriptdroiddroildroitdrokedroledromedronydroobdroogdrookdropsdroptdrossdroukdrowsdrubsdrugsdrumsdrupedrusedrusydruxydryaddryasdrylydsobodsomoduadsdualsduansduarsdubboducalducatducesducksduckyductsduddydudeddudesduelsduetsduettduffsdufusduingduitsdukasdukeddukesdukkadulcedulesduliadullsdullydulsedumasdumbodumbsdumkadumkydumpsdunamdunchdunesdungsdungydunksdunnodunnydunshduntsduomiduomodupedduperdupesdupleduplyduppyduraldurasduredduresdurgydurnsdurocdurosduroydurradurrsdurrydurstdurumdurzidusksdustsduxesdwaaldwaledwalmdwamsdwangdwaumdweebdwiledwinedyadsdyersdyked
dykondyneldynesdzhoseagreealedealeseanedeardsearedearlsearnsearntearsteasedeasereaseseasleeastseatheeavedeavesebbedebbetebonsebookecadsechedechesechoseclatecrusedemaedgededgeredgesedifyedileeditseduceeducteejiteensyeeveneevnseffedegadsegersegesteggareggedeggeregmasehingeidereidoseigneeikedeikoneildseiselejidoekingekkaselainelandelanselchieldinelemielfedeliadelideelintelmenelogeelogyeloinelopselpeeelsineluteelvanelvenelverelvesemacsembarembayembogembowemboxembusemeeremendemergemeryemeusemicsemirsemitsemmasemmeremmetemmewemmysemojiemongemoteemoveemptsemuleemureemydeemydsenarmenateendedenderendew
endueenewsenfixeniacenlitenmewennogenokienolsenormenowsenrolensewenskyentiaenureenurnenvoienzymeorlseosinepactepeesephahephasephodephorepicsepodeepopteprisequesequiderbiaerevsergonergosergoterhusericaerickericseringernederneseroseerrederseseructerugoeruvservenervilescarescotesileeskareskeresnesessesesterestocestopestroetageetapeetatsetensethalethneethyleticsetnasettinettleetuisetweeetymaeughseukedeupadeuroseusolevensevertevetsevhoeevilseviteevoheewersewestewhowewkedexamsexeatexecsexeemexemeexfilexiesexineexingexitsexodeexomeexonsexpatexposexudeexulsexurbeyasseyerseyingeyotseyraseyreseyrieeyrir
ezinefabbyfacedfacerfacesfaciafactafactsfaddyfadedfaderfadesfadgefadosfaenafaeryfaffsfaffyfaginfaiksfailsfainefainsfairsfakedfakerfakesfakeyfakiefakirfalajfallsfamedfamesfanalfandsfanesfangafangofangsfanksfanonfanosfanumfaqirfaradfarcifarcyfardsfaredfarerfaresfarlefarlsfarmsfarosfarrofarsefartsfascifastifastsfatedfatesfatlyfatsofattyfatwafaughfauldfaunsfaurdfautsfauvefavasfavelfaverfavesfavusfawnsfawnyfaxedfaxesfayedfayerfaynefayrefazedfazesfealsfearefearsfeartfeasefeatsfeazefecesfechtfecitfecksfedexfeebsfeedsfeelsfeensfeersfeesefeezefehmefeintfeistfelchfelidfellsfellyfeltsfeltyfemalfemesfemmy
fendsfendyfenisfenksfennyfentsfeodsfeofffererferesferiaferlyfermifermsfernsfernyfessefestafestsfestyfetasfetedfetesfetorfettafettsfetwafeuarfeudsfeuedfeyedfeyerfeylyfezesfezzyfiarsfiatsfibroficesfichefichuficinficosfidesfidgefidosfiefsfientfierefiersfiestfifedfiferfifesfifisfiggyfigosfikedfikesfilarfilchfiledfilerfilesfiliifilksfillefillofillsfilmifilmsfilosfilumfincafindsfinedfinesfinisfinksfinnyfinosfiordfiqhsfiquefiredfirerfiresfiriefirksfirmsfirnsfirryfirthfiscsfisksfistsfistyfitchfitlyfitnafittefittsfiverfivesfixedfixesfixitfjeldflabsflaffflagsflaksflammflamsflamyflaneflansflapsflaryflats
flavaflawnflawsflawyflaxyflaysfleamfleasfleekfleerfleesflegsflemefleurflewsflexiflexofleysflicsfliedfliesflimpflimsflipsflirsfliskfliteflitsflittflobsflocsfloesflogsflongflopsflorsfloryfloshflotafloteflowsflubsfluedfluesflueyflukyflumpfluorflurrflutyfluytflybyflypeflytefoalsfoamsfoehnfogeyfogiefoglefogoufohnsfoidsfoilsfoinsfoldsfoleyfoliafolicfoliefolksfolkyfomesfondafondsfondufonesfonlyfontsfoodsfoodyfoolsfootsfootyforamforbsforbyfordofordsforelforesforexforksforkyformeformsfortsforzaforzefossafossefouatfoudsfouerfouetfoulefoulsfountfoursfouthfoveafowlsfowthfoxedfoxesfoxiefoylefoynefrabsfrack
fractfragsfraimfrancfrapefrapsfrassfratefratifratsfrausfraysfreesfreetfreitfremdfrenafreonfrerefretsfribsfrierfriesfrigsfrisefristfrithfritsfrittfrizefrizzfroesfrogsfronsfrorefrornfroryfroshfrowsfrowyfrugsfrumpfrushfrustfryerfubarfubbyfubsyfucusfuddyfudgyfuelsfuerofuffsfuffyfugalfuggyfugiefugiofuglefuglyfugusfujisfullsfumedfumerfumesfumetfundifundsfundyfungofungsfunksfuralfuranfurcafurlsfurolfurrsfurthfurzefurzyfusedfuseefuselfusesfusilfusksfustsfustyfutonfuzedfuzeefuzesfuzilfycesfykedfykesfylesfyrdsfyttegabbagabbygablegaddigadesgadgegadidgadisgadjegadjogadsogaffsgagedgagergagesgaidsgainsgairs
gaitagaitsgaittgajosgalahgalasgalaxgaleagaledgalesgallsgallygalopgalutgalvogamasgamaygambagambegambogambsgamedgamesgameygamicgamingammegammygampsganchgandyganefganevgangsganjaganofgantsgaolsgapedgapergapesgaposgappygarbegarbogarbsgardagaresgarisgarmsgarnigarregarthgarumgasesgaspsgaspygastsgatchgatedgatergatesgathsgatorgauchgaucygaudsgaujegaultgaumsgaumygaupsgaursgaussgauzygavotgawcygawdsgawksgawpsgawsygayalgaylygazalgazargazedgazergazesgazongazoogealsgeansgearegearsgeatsgeburgecksgeeksgeepsgeestgeistgeitsgeldsgeleegelidgellygeltsgemelgemmagemmygemotgenalgenasgenesgenetgenicgeniigenipgennygenoa
genomgenrogentsgentygenuagenusgeodegeoidgerahgerbegeresgerlegermsgermygernegessegessogestegestsgetasgetupgeumsgeyangeyerghastghatsghautghazigheesghestghyllgibedgibelgibergibesgibligibusgiftsgigasgighegigotgiguegilasgildsgiletgillsgillygilpygiltsgimelgimmegimpsgimpyginchgingegingsginksginnyginzogipongippygirdsgirlsgirnsgirongirosgirrsgirshgirtsgismogismsgistsgitchgitesgiustgivedgivesgizmoglacegladsgladyglaikglairglamsglansglaryglaumglaurglazyglebaglebeglebygledegledsgleedgleekgleesgleetgleisglensglentgleysglialgliasglibsgliffgliftglikeglimeglimsgliskglitsglitzgloamglobiglobsglobyglodeglogggloms
gloopglopsglostgloutglowsglozegluedgluergluesglueyglugsglumeglumsgluongluteglutsgnarlgnarrgnarsgnatsgnawngnawsgnowsgoadsgoafsgoalsgoarygoatsgoatygobangobargobbigobbogobbygobisgobosgodetgodsogoelsgoersgoestgoethgoetygofergoffsgoggagogosgoiergojisgoldsgoldygolesgolfsgolpegolpsgombogomergompagonchgonefgongsgoniagonifgonksgonnagonofgonysgonzogoobygoodsgoofsgoogsgooldgoolsgoolygoonsgoonygoopsgoopygoorsgoorygoosygopakgopikgoralgorasgoredgoresgorisgormsgormygorpsgorsegorsygoshtgossegotchgothsgothygottagouchgouksgouragoutsgoutygowangowdsgowfsgowksgowlsgownsgoxesgoyimgoylegraalgrabsgradsgraffgraipgrama
gramegrampgramsgranagransgrapygravsgraysgrebegrebogrecegreekgreesgregegregogreingrensgresegrevegrewsgreysgricegridegridsgriffgriftgrigsgrikegrinsgriotgripsgriptgripygrisegristgrisygrithgritsgrizegroatgrodygrogsgroksgromagronegroofgroszgrotsgroufgrovygrowsgrrlsgrrrlgrubsgruedgruesgrufegrumegrumpgrundgrycegrydegrykegrypegryptguacoguanaguanoguansguarsgucksguckygudesguffsgugasguidsguimpguirogulaggulargulasgulesguletgulfsgulfygullsgulphgulpsgulpygummagummigumpsgundygungegungygunksgunkygunnyguqingurdygurgegurlsgurlygurnsgurrygurshgurusgushyguslaguslegusligussygustsgutsyguttaguttyguyedguyleguyotguyse
gwinegyalsgyansgybedgybesgyeldgympsgynaegyniegynnygynosgyozagyposgypsygyralgyredgyresgyrongyrosgyrusgytesgyvedgyveshaafshaarshablehabushacekhackshadalhadedhadeshadjihadsthaemshaetshaffshafizhaftshaggshahashaickhaikahaikshaikuhailshailyhainshainthairshaithhajeshajishajjihakamhakashakeahakeshakimhakushalalhaledhalerhaleshalfahalfshalidhallohallshalmahalmshalonhaloshalsehaltshalvahalwahamalhambahamedhameshammyhamzahanaphancehanchhandshangihangshankshankyhansahansehantshaolehaomahapaxhaplyhappihapusharamhardsharedharemharesharimharksharlsharmsharnsharosharpshartshashyhaskshaspshastahatedhateshatha
haudshaufshaughhauldhaulmhaulshaulthaunshausehaverhaveshawedhawkshawmshawsehayedhayerhayeyhaylehazanhazedhazerhazesheadshealdhealsheameheapsheapyhearehearsheastheatshebenhechtheckshederhedgyheedsheedyheelsheezehefteheftsheidsheighheilsheirshejabhejraheledhelesheliohellshelmsheloshelothelpshelvehemalhemeshemicheminhempshempyhenchhendshengehennahennyhenryhentsheparherbsherbyherdsheresherlshermahermshernsherosherryhersehertzheryehespshestsheteshethsheuchheughheveahewedhewerhewghhexadhexedhexerhexeshexylheyedhianthickshidedhiderhideshiemshighshighthijabhijrahikedhikerhikeshikoihilarhilchhillohills
hiltshilumhilushimbohinauhindshingshinkyhinnyhintshioishiplyhiredhireehirerhireshissyhistshithehivedhiverhiveshizenhoaedhoagyhoarshoaryhoasthoboshockshocushodadhodjahoershoganhogenhoggshoghshohedhoickhoiedhoikshoinghoisehokashokedhokeshokeyhokishokkuhokumholdsholedholesholeyholkshollaholloholmeholmsholonholosholtshomashomedhomeshomeyhomiehommehonanhondahondshonedhonerhoneshongihongshoochhoodshoodyhooeyhoofshookahookshookyhoolyhoonshoopshoordhoorshooshhootshootyhoovehopakhopedhoperhopeshoppyhorahhoralhorashorishorkshormehornshorsthorsyhosedhoselhosenhoserhoseshoseyhostahostshotchhotenhottyhouff
houfshoughhourihourshoutshoveahovedhovenhoveshowbehoweshowffhowfshowkshowlshowrehowsohoxedhoxeshoyashoyedhoylehubbyhuckshudnahududhuershuffshuffyhugerhuggyhuhushuiashulashuleshulkshulkyhullohullshullyhumashumfshumichumpshumpyhunkshuntshurdshurlshurlyhurrahursthurtshushyhuskshusoshussyhutiahuzzahuzzyhwylshydrahyenshyggehyinghykeshylashyleghyleshylichymnshyndehyoidhypedhypeshyphahyphyhyposhyraxhysonhytheiambiiambsibrikicersichedichesichoricierickerickleiconsictalicticictusidantideasideesidentidledidlesidolaidolsidylsiftarigapoiggediglusihramikansikatsikonsileacilealileumileusiliadilialiliumiller
illthimagoimamsimariimaumimbarimbedimbueimideimidoimidsimineiminoimmewimmitimmiximpedimpelimpisimpotimproimshiimshyinaptinarminbyeincelincleincogincusincutindewindiaindieindolindowindriindueinerminfixinfosinfrainganingleinioninkedinkerinkleinnedinnitinorbinruninsetinspointelintilintisintrainulainureinurninustinvarinwitiodiciodidiodiniotasipponiradeiridsiringirkedirokoironeironsisbasishesisledislesisnaeisseiistleitemsitheriviediviesixiasixnayixoraixtleizardizarsizzatjaapsjabotjacaljacksjackyjadedjadesjafasjaffajagasjagerjaggsjaggyjagirjagrajailsjakerjakesjakeyjalapjalopjambejambojambsjambujames
jammyjamonjanesjannsjannyjantyjapanjapedjaperjapesjarksjarlsjarpsjartajaruljaseyjaspejaspsjatosjauksjaupsjavasjaveljawanjawedjaxiejeansjeatsjebeljedisjeelsjeelyjeepsjeersjeezejefesjeffsjehadjehusjelabjellojellsjembejemmyjennyjeonsjeridjerksjerryjessejestsjesusjetesjetonjeunejewedjewiejhalajiaosjibbajibbsjibedjiberjibesjiffsjiggyjigotjihadjillsjiltsjimmyjimpyjingojinksjinnejinnijinnsjirdsjirgajirrejismsjivedjiverjivesjiveyjnanajobedjobesjockojocksjockyjocosjodeljoeysjohnsjoinsjokedjokesjokeyjokoljoledjolesjollsjoltsjoltyjomonjomosjonesjongsjontyjooksjoramjorumjotasjottyjotunjoualjougsjouksjoule
joursjowarjowedjowlsjowlyjoyedjubasjubesjucosjudasjudgyjudosjugaljugumjujusjukedjukesjukusjulepjumarjumbyjumpsjuncojunksjunkyjuntojupesjuponjuraljuratjureljuresjustsjutesjuttyjuvesjuviekaamakababkabarkabobkachakackskadaikadeskadiskafirkagoskaguskahalkaiakkaidskaieskaifskaikakaikskailskaimskaingkainskakaskakiskalamkaleskalifkaliskalpakamaskameskamikkamiskammekanaekanaskandykanehkaneskangakangskanjikantskanzukaonskapaskaphskapokkapowkapuskaputkaraskaratkarkskarnskarookaroskarrikarstkarsykartskarzykashakasmekatalkataskatiskattikaughkaurikaurukaurykavalkavaskawaskawaukawedkaylekayoskaziskazookbars
kebarkebobkeckskedgekedgykeechkeefskeekskeelskeemakeenokeenskeepskeetskeevekefirkehuakeirskelepkelimkellskellykelpskelpykeltskeltykembokembskempskemptkempykenafkenchkendokenoskentekentskepiskerbskerelkerfskerkykermakernekernskeroskerrykervekesarkestsketasketchketesketolkevelkevilkexeskeyedkeyerkhadikhafskhanskhaphkhatskhayakhazikhedakhethkhetskhojakhorskhoumkhudskiaatkiackkiangkibbekibbikibeikibeskiblakickskickykiddokiddykidelkidgekiefskierskievekievskightkikoikileykilimkillskilnskiloskilpskiltskiltykimbokinaskindakindskindykineskingskininkinkskinkykinoskiorekipeskippakippskirbykirkskirnskirri
kisankissykistskitedkiterkiteskithekithskitulkivaskiwisklangklapsklettklickkliegkliksklongkloofklugeklutzknagsknapsknarlknarsknaurknawekneesknellknishknitskniveknobsknopsknospknotsknoutknoweknowsknubsknurlknurrknursknutskoanskoapskobankoboskoelskoffskoftakogalkohaskohenkohlskoinekojiskokamkokaskokerkokrakokumkolaskoloskombukonbukondokonkskookskookykoorikopekkophskopjekoppakoraikoraskoratkoreskormakoroskorunkoruskoseskotchkotoskotowkourakraalkrabskraftkraiskraitkrangkranskranzkrautkrayskreepkrengkrewekronakronekroonkrubikrunkksarskubiekudoskuduskudzukufiskugelkuiaskukrikukuskulakkulankulaskulfi
kumiskumyskuriskurrekurtakuruskussokutaskutchkutiskutuskuzuskvasskvellkwelakyackkyakskyangkyarskyatskyboskydstkyleskyliekylinkylixkyloekyndekyndskypeskyriekyteskythelaarilabdalabialabislabralacedlacerlaceslacetlaceylacksladdyladedladerladeslaerslaevolaganlahallaharlaichlaicslaidslaighlaikalaikslairdlairslairylaithlaitylakedlakerlakeslakhslakinlaksalaldylallslamaslambslambylamedlamerlameslamialammylampslanailanaslanchlandelandslaneslankslantslapinlapislapjelarchlardslardylareelareslargolarislarkslarkylarnslarntlarumlasedlaserlaseslassilassulassylastslatahlatedlatenlatexlathilathslathylatkelatus
lauanlauchlaudslaufslaundlauralavallavaslavedlaverlaveslavralavvylawedlawerlawinlawkslawnslawnylaxedlaxerlaxeslaxlylayedlayinlayuplazarlazedlazeslazoslazzilazzoleadsleadyleafsleaksleamsleansleantleanyleapslearelearslearyleatsleavyleazelebenleccyledesledgyledumleearleeksleepsleersleeseleetsleezelefteleftslegerlegesleggeleggolegitlehrslehualeirsleishlemanlemedlemellemeslemmalemmelendsleneslengslenislenoslenselentilentoleonelepidlepraleptaleredlereslerpsleseslestsletchletheletupleuchleucoleudsleughlevasleveeleveslevinlevislewislexeslexislezeslezzalezzylianalianeliangliardliarsliartliberlibralibri
lichilichtlicitlickslidarlidosliefslienslierslieuslieveliferlifesliftsliganligerliggelignelikedlikenlikerlikeslikinlillslilosliltslimanlimaslimaxlimbalimbilimbslimbylimedlimenlimeslimeylimmalimnslimoslimpalimpslinaclinchlindslindylinedlineslineylingalingslingylininlinkslinkylinnslinnylinoslintslintylinumlinuxlionslipaslipeslipinliposlippyliraslirkslirotliskslislelispslistslitailitaslitedliterliteslitholithslitrelivedlivenliveslivorlivrellanoloachloadsloafsloamsloansloastloavelobarlobedlobesloboslobuslochelochslocielocislockslocoslocumlodenlodesloessloftsloganlogesloggylogialogielogoilogonlogos
lohanloidsloinsloipeloirslokeslollslollylologlomaslomedlomeslonerlongalongelongsloobylooedlooeyloofaloofslooielookslookyloomsloonsloonyloopsloordlootslopedloperlopesloppyloralloranlordslordylorelloresloriclorislosedlosellosenloseslossylotahlotaslotesloticlotoslotsalottalottelottolotuslouedloughlouielouisloumaloundlounsloupeloupslourelourslouryloutslovatlovedlovesloveylovielowanlowedloweslowndlownelownslowpslowrylowselowtsloxedloxeslozenluachluauslubedlubeslubralucesluckslucreludesludicludosluffaluffslugedlugerlugeslullsluluslumaslumbilumenlummelummylumpslunasluneslunetlungilungslunksluntslupin
luredlurerlureslurexlurgilurgylurkslurrylurveluserlushyluskslustslustylususlutealutedluterlutesluvvyluxedluxerluxeslweislyamslyardlyartlyaselycealyceelycralymeslyneslyreslysedlyseslysinlysislysollyssalytedlyteslythelyticlyttamaaedmaaremaarsmabesmacasmacedmacermacesmachemachimachsmacksmaclemaconmadgemadidmadremaerlmaficmagesmaggsmagotmagusmahoemahuamahwamaidsmaikomaiksmailemaillmailsmaimsmainsmairemairsmaisemaistmakarmakesmakismakosmalammalarmalasmalaxmalesmalicmalikmalismallsmalmsmalmymaltsmaltymalusmalvamalwamamasmambamameemameymamiemanasmanatmandimanebmanedmanehmanesmanetmangsmanismankymanna
manosmansemantamantomantymanulmanusmapaumaquimaraemarahmarasmarcsmardymaresmargemargsmariamaridmarkamarksmarlemarlsmarlymarmsmaronmarormarramarrimarsemartsmarvymasasmasedmasermasesmashymasksmassamassymastsmastymasusmataimatedmatermatesmathsmatinmatlomattemattsmatzamatzomaubymaudsmaulsmaundmaurimausymautsmauzymavenmaviemavinmavismawedmawksmawkymawnsmawrsmaxedmaxesmaxismayanmayasmayedmayosmaystmazedmazermazesmazeymazutmbirameadsmealsmeanemeansmeanymearemeasemeathmeatsmebosmechsmecksmediimedlemeedsmeersmeetsmeffsmeinsmeintmeinymeithmekkamelasmelbameldsmelicmelikmellsmeltsmeltymemesmemosmenadmends
menedmenesmengemengsmensamensemenshmentamentomenusmeousmeowsmerchmercsmerdemeredmerelmerermeresmerilmerismerksmerlemerlsmersemesalmesasmeselmesesmeshymesicmesnemesonmessymestometedmetesmethomethsmeticmetifmetismetolmetremeusemevedmevesmewedmewlsmeyntmezesmezzemezzomhorrmiaoumiaowmiasmmiaulmicasmichemichtmicksmickymicosmicramiddymidgymidismiensmievemiffsmiffymiftymiggsmihasmihismikedmikesmikramikvamilchmildsmilermilesmilfsmiliamilkomilksmillemillsmilormilosmilpamiltsmiltymiltzmimedmimeomimermimesmimsyminaeminarminasmincymindsminedminesmingemingsmingyminimminisminkeminksminnyminosmintsmiredmires
mirexmiridmirinmirksmirkymirlymirosmirvsmirzamischmisdomisesmisgomisosmissamistsmistymitchmitermitesmitismitremittsmixedmixenmixermixesmixtemixupmizenmizzymnememoansmoatsmobbymobesmobeymobiemoblemochimochsmochymocksmodermodesmodgemodiimodusmoersmofosmoggymohelmohosmohrsmohuamohurmoilemoilsmoiramoiremoitsmojosmokesmokismokosmolalmolasmoldsmoledmolesmollamollsmollymoltomoltsmolysmomesmommamommymomusmonadmonalmonasmondemondomonermongomonicmoniemonksmonosmontemontymoobsmoochmoodsmooedmooksmoolamoolimoolsmoolymoongmoonsmoonymoopsmoorsmoorymootsmoovemopedmopermopesmopeymoppymopsymopusmoraemorasmorat
moraymorelmoresmoriamornemornsmoronmorramorromorsemortsmosedmosesmoseymosksmossomostemostsmotedmotenmotesmotetmoteymothsmothymotismottemottsmottymotusmotzamouchmouesmouldmoulsmoupsmoustmousymovedmovesmowasmowedmowramoxasmoxiemoyasmoylemoylsmozedmozesmozosmpretmuchomucicmucidmucinmucksmucormucromudgemudirmudramuffsmuftimuggamuggsmuggymuhlymuidsmuilsmuirsmuistmujikmulctmuledmulesmuleymulgamuliemullamullsmulsemulshmummsmumpsmumsymumusmungamungemungomungsmunismuntsmuntumuonsmurasmuredmuresmurexmuridmurksmurlsmurlymurramurremurrimurrsmurrymurtimurvamusarmuscamusedmusermusesmusetmushamusitmusksmusos
mussemussymusthmustsmutchmutedmutermutesmutismutonmuttsmuxedmuxesmuzakmuzzymvulemyallmylarmynahmynasmyoidmyomamyopemyopsmyopymysidmythimythsmythymyxosmzeesnaamsnaansnabesnabisnabksnablanabobnachenachonacrenadasnaevenaevinaffsnagasnaggynagornahalnaiadnaifsnaiksnailsnairanairunakednakernakfanalasnalednallanamednamernamesnammanamusnanasnancenancynandunannananosnanuanapasnapednapesnapoonappanappenappynarasnarconarcsnardsnaresnaricnarisnarksnarkynarrenashinatchnatesnatisnattynauchnauntnavarnavesnavewnavvynawabnazesnazirnazisndujaneafenealsneapsnearsneathneatsnebeknebelnecksneddyneedsneeldneeleneemb
neemsneepsneeseneezenegusneifsneistneivenelisnellynemasnemnsnemptnenesneonsnepernepitneralnerdsnerkanerksnerolnertsnertznervynestsnetesnetopnettsnettyneuksneumeneumsnevelnevesnevusnewbsnewednewelnewienewsynewtsnextsnexusngaionganangatingomangweenicadnichtnicksnicolnidalnidednidesnidornidusniefsnievenifesniffsniffyniftynigernighsnihilnikabnikahnikaunillsnimbinimbsnimpsninerninesninonnipasnippyniqabnirlsnirlyniseinissenisusniternitesnitidnitonnitrenitronitrynittynivalnixednixernixesnixienizamnkosinoahsnobbynocksnodalnoddynodesnodusnoelsnoggsnohownoilsnoilynointnoirsnolesnollsnolosnomasnomennomes
nomicnomoinomosnonasnoncenonesnonetnongsnonisnonnynonylnoobsnooitnooksnookynoonsnoopsnopalnorianorisnorksnormanormsnosednosernosesnotalnotednoternotesnotumnouldnoulenoulsnounsnounynoupsnovaenovasnovumnowaynowednowlsnowtsnowtynoxalnoxesnoyaunoyednoyesnubbynubianuchanuddynudernudesnudienudzhnuffsnugaenukednukesnullanullsnumbsnumennummynunnynurdsnurdynurlsnurrsnutsonutsynyaffnyalanyingnyssaoakedoakenoakeroakumoaredoasesoasisoastsoatenoateroathsoavesobangobeahobeliobeysobiasobiedobiitobitsobjetoboesoboleoboliobolsoccamocherochesochreochryockerocreaoctadoctaloctanoctasoctyloculiodahsodalsodderodeon
odeumodismodistodiumodorsodourodyleodylsofaysoffedoffieoflagofterogamsogeedogeesogginoghamogiveogledogleroglesogmicogresohiasohingohmicohoneoidiaoiledoileroinksointsojimeokapiokaysokehsokrasoktasoldieoleicoleinolentoleosoleumoliosollasollavollerollieologyolpaeolpesomasaomberombusomensomersomitsomlahomovsomrahonceroncesoncetoncusonelyonersoneryoniumonkusonlayonnedonticoobitoohedoomphoontsoopedoorieoosesootidoozedoozesopahsopalsopensopepeopingopposopsinoptedopterorachoracyoralsorangorantorateorbedorcasorcinordosoreadorfesorgiaorgicorgueoribiorielorixaorlesorlonorlopormerornisorpinorrisorthoorval
orzososcaroshacosierosmicosmolossiaostiaotakuotaryottarottosoubitouchtouensouijaoulksoumasoundyoupasoupedoupheouphsourieouseloustsoutbyoutedoutgooutreoutroouttaouzelouzosovalsovateovelsovensoversovineovistovoidovoliovoloovuleowcheowiesowledowlerowletownedowresowrieowsenoxbowoxersoxeyeoxidsoxiesoximeoximsoxlipoxteroyersozekiozziepaalspaanspacaspacedpacerpacespaceypachapackspacospactapactspadispadlepadmapadrepadripaeanpaedopaeonpagedpagerpagespaglepagodpagripaikspailspainspairepairspaisapaisepakkapalaspalaypaleapaledpalespaletpalispalkipallapallspallypalmspalmypalpipalpspalsapampapanaxpancepanda
pandspandypanedpanespangapangspanimpankopannepannipansypantopantspantypaolipaolopapaspapawpapespappipappyparaeparasparchpardipardspardyparedparenpareoparerparespareuparevpargepargoparisparkiparksparkyparleparlyparmaparolparpsparraparrspartipartsparveparvopaseopasespashapashmpaskapaspypassepastspatedpatenpaterpatespathspatinpatkapatlypattepatuspauaspaulspavanpavedpavenpaverpavespavidpavinpavispawaspawawpawedpawerpawkspawkypawlspawnspaxespayedpayorpaysdpeagepeagspeakspeakypealspeanspearepearspeartpeasepeatspeatypeavypeazepebaspechspeckepeckspeckypedespedispedropeecepeekspeelspeenspeeoypeepepeeps
peerspeerypeevepeggypeghspeinspeisepeizepekanpekespekinpekoepelaspelaupelespelfspellspelmapelonpeltapeltspendspendupenedpenespengopeniepenispenkspennapennipentspeonspeonypeplapepospeppypepsiperaipercepercsperduperdypereaperesperisperkspermspernsperogperpsperryperseperstpertspervepervopervspervypesospestspestypetarpeterpetitpetrepetripettipettopeweepewitpeysephagephangpharepharmpheerphenepheonphesephialphishphizzphloxphocaphonophonsphotsphphtphutsphylaphylepianipianspibalpicalpicaspiccypickspicotpicrapiculpiendpierspiertpietapietspiezopightpigmypiingpikaspikaupikedpikerpikespikeypikispikulpilae
pilafpilaopilarpilaupilawpilchpileapiledpileipilerpilespilispillspilowpilumpiluspimaspimpspinaspinedpinespingopingspinkopinkspinnapinnypinonpinotpintapintspinuppionspionypiouspioyepioyspipalpipaspipedpipespipetpipispipitpippypipulpiraipirlspirnspirogpiscopisespiskypisospissypistepitaspithspitonpitotpittapiumspixespizedpizesplaasplackplageplansplapsplashplasmplastplatsplattplatyplayaplayspleasplebeplebsplenapleonpleshplewsplicaplierpliesplimsplingplinkploatplodsplongplonkplookplopsplotsplotzploukplowsployeployspluespluffplugsplumsplumypluotplutoplyerpoachpoakapoakepoboypockspockypodalpoddypodex
podgepodgypodiapoemspoepspoesypoetspogeypoggepogospohedpoilupoindpokalpokedpokespokeypokiepoledpolerpolespoleypoliopolispoljepolkspollspollypolospoltspolyspombepomespommypomospompsponceponcypondsponesponeypongapongopongspongyponkspontspontyponzupoodspooedpoofspoofypoohspoojapookapookspoolspoonspoopspoopypooripoortpootspoovepoovypopespoppapopsyporaeporalporedporerporesporgeporgyporinporksporkypornspornyportaportsportyposedposesposeyposhopostspotaepotchpotedpotespotinpotoopotsypottopottspottypouffpoufspoukepoukspoulepoulppoultpoupepouptpourspoutspowanpowinpowndpownspownypowrepoxedpoxespoyntpoyou
poysepozzypraampradsprahupramspranaprangpraosprasepratepratsprattpratyprausprayspredypreedpreespreifpremspremyprentpreonpreopprepspresapreseprestpreveprexypreysprialpricypriefprierpriesprigsprillprimaprimiprimpprimsprimyprinkprionpriseprissproasprobsprodsproemprofsprogsproinprokeproleprollpromopromspronkpropsproreprosoprossprostprosyprotoproulprowsproynpruntprutapryerprysepseudpshawpsionpsoaepsoaipsoaspsorapsychpsyoppubcopubespubicpubispucanpucerpucespuckapuckspuddypudgepudicpudorpudsypuduspuerspuffapuffspuggypugilpuhaspujahpujaspukaspukedpukerpukespukeypukkapukuspulaopulaspuledpulerpulespulik
pulispulkapulkspullipullspullypulmopulpspuluspumaspumiepumpspunaspuncepungapungspunjipunkapunkspunkypunnypuntopuntspuntypupaepupaspupuspurdapuredpurespurinpurispurlspurpypurrspursypurtypusespusleputidputonputtiputtoputtspuzelpwnedpyatspyetspygalpyinspylonpynedpynespyoidpyotspyralpyranpyrespyrexpyricpyrospyxedpyxespyxiepyxispzazzqadisqaidsqajaqqanatqapikqiblaqophsqormaquadsquaffquagsquairquaisquakyqualequantquarequassquatequatsquaydquaysqubitqueanqueerquemequenaquernqueynqueysquichquidsquiffquimsquinaquinequinoquinsquintquipoquipsquipuquirequirtquistquitsquoadquodsquoifquoinquoitquollquonkquops
quothqurshquyterabatrabicrabisracedracesracheracksraconradgeradixradonraffsraftsragasragderagedrageeragerragesraggaraggsraggyragisragusrahedrahuiraiasraidsraiksrailerailsrainerainsrairdraitaraitsrajasrajesrakedrakeerakerrakesrakiarakisrakusralesramalrameerametramieraminramisrammyrampsramusranasrancerandsraneerangarangirangsrangyranidranisrankeranksrantsraperrapherapperaredrareeraresrarksrasedraserrasesraspsrasserastaratalratanratasratchratedratelraterratesratharatherathsratooratosratusraunsrauporavedravelraverravesraveyravinrawerrawinrawlyrawnsraxedraxesrayahrayasrayedrayleraynerazedrazeerazer
razesrazooreaddreadsreaisreaksrealorealsreamereamsreamyreansreapsrearsreastreatareatereaverebberebecrebidrebitreboprebuyrecalreccereccoreccyrecitrecksreconrectarectirectoredanreddsreddyrededredesrediaredidredipredlyredonredosredoxredryredubreduxredyereechreedereedsreefsreefyreeksreekyreelsreensreestreeverefedrefelrefforefisrefixreflyrefryregarregesreggoregieregmaregnaregosregurrehemreifsreifyreikireiksreinkreinsreirdreistreiverejigrejonrekedrekesrekeyreletrelierelitrelloremanremapremenremetremexremixrenayrendsreneyrengarenigreninrennerenosrenterentsreoilreorgrepegrepinreplareposrepotreppsrepro
reranrerigresatresawresayreseeresesresewresidresitresodresowrestorestsrestyresusretagretaxretemretiaretieretoxrevetrevierewanrewaxrewedrewetrewinrewonrewthrexesrezesrheasrhemerheumrhiesrhimerhinerhodyrhombrhonerhumbrhynerhytariadsrialsriantriataribasribbyribesricedricerricesriceyrichtricinricksridesridgyridicrielsriemsrieveriferriffsrifteriftsriftyriggsrigolriledrilesrileyrillerillsrimaerimedrimerrimesrimusrindsrindyrinesringsrinksriojariotsripedriperripesrippsrisesrishirisksrispsrisusritesrittsritzyrivasrivedrivelrivenrivesriyalrizasroadsroamsroansroarsroaryroaterobedrobesroblerocksrodedrodes
roguyrohesroidsroilsroilyroinsroistrojakrojisrokedrokerrokesrolagrolesrolfsrollsromalromanromeorompsronderondoroneoronesroninronneronterontsroodsroofsroofyrooksrookyroomsroonsroopsroopyroosarooserootsrootyropedroperropesropeyroqueroralroresroricroridrorierortsrortyrosedrosesrosetroshirosinrositrostirostsrotalrotanrotasrotchrotedrotesrotisrotlsrotonrotosrotterouenrouesrouleroulsroumsroupsroupyroustrouthroutsrovedrovenrovesrowanrowedrowelrowenrowerrowierowmerowndrowthrowtsroyneroystrozetrozitruanarubairubbyrubelrubesrubinrublerublirubusrucherucksrudasruddsrudesrudierudisruedaruersrufferuffsrugae
rugalruggyruingruinsrukhsruledrulesrumalrumborumenrumesrumlyrummyrumporumpsrumpyrunchrundsrunedrunesrungsrunicrunnyruntsruntyrupiarurpsrurusrusasrusesrushyrusksrusmarusserustsruthsrutinruttyryalsrybatrykedrykesrymmeryndsryotsrypersaagssabalsabedsabersabessabhasabinsabirsablesabotsabrasabresackssacrasaddosadessadhesadhusadissadossadzasafedsafessagassagersagessaggysagossagumsahebsahibsaicesaicksaicssaidssaigasailssaimssainesainssairssaistsaithsajousakaisakersakessakiasakissaktisalalsalatsalepsalessaletsalicsalixsallesalmisalolsalopsalpasalpssalsesaltosaltssaluesalutsamansamassambasambosameksamel
samensamessameysamfusammysampisampssandssanedsanessangasanghsangosangssankosansasantosantssaolasapansapidsaporsaransardssaredsareesargesargosarinsarissarkssarkysarodsarossarussasersasinsassesataisataysatedsatemsatessatissaubasauchsaughsaulssaultsauntsaurysautssavedsaversavessaveysavinsawahsawedsawersaxessayedsayersayidsaynesayonsaystsazesscabsscadsscaffscagsscailscalascallscamsscandscansscapascapescapiscarpscarsscartscathscatsscattscaudscaupscaurscawssceatscenascendschavschmoschulschwasclimscodyscogsscoogscootscopascopsscotsscougscoupscowpscowsscrabscraescragscranscratscrawscrayscrimscripscrob
scrodscrogscrowscudiscudoscudsscuffscuftscugssculkscullsculpsculsscumsscupsscurfscursscusescutascutescutsscuzzscyessdaynsdeinsealsseameseamsseamyseanssearesearsseaseseatsseazesebumseccosechssectssedersedessedgesedgysedumseedsseeksseeldseelsseelyseemsseepsseepyseerssefersegarsegnisegnosegolsegossehriseifsseilsseineseirsseiseseismseityseizasekossektsselahselesselfssellasellesellsselvasemeesemensemessemiesemissenassendssenessengisennasenorsensasensisentesentisentssenvysenzasepadsepalsepicsepoyseptaseptsseracseraiseralseredsererseresserfssergesericserinserksseronserowserraserreserrsserryservosesey
sessasetaesetalsetonsettssewansewarsewedsewelsewensewinsexedsexersexessextosextsseyenshadsshagsshahsshakoshaktshalmshalyshamashamsshandshansshapssharnshashshaulshawmshawnshawsshayashaysshchisheafshealsheasshedssheelshendshentsheolsherdsheresheroshetsshevashewnshewsshiaishielshiershiesshillshilyshimsshinsshipsshirrshirsshishshisoshistshiurshivashiveshivsshlepshlubshmekshmoeshoatshoedshoershoesshogishogsshojishojosholashoolshoonshoosshopeshopsshorlshoteshotsshottshowdshowsshoyushredshrisshrowshtikshtumshtupshuleshulnshulsshunsshurashuteshutsshwasshyersialssibbssibylsicessichtsickosickssickysidas
sidedsidersidessidhasidhesidlesieldsienssientsiethsieursiftssighssigilsiglasignasignssijossikassikersikessildssiledsilensilersilessilexsilkssillssilossiltssiltysilvasimarsimassimbasimissimpssimulsindssinedsinessingssinhssinkssinkysinussipedsipessippysiredsireesiressirihsirissirocsirrasirupsisalsisessissysistasistssitarsitedsitessithesitkasitupsitussiversixersixessixmosixtesizarsizedsizelsizersizesskagsskailskaldskartskatsskattskawsskeanskearskedsskeedskeefskeenskeerskeesskeetskeggskegsskeinskelfskellskelmskelpskeneskensskeosskepsskerssketsskewsskidsskiedskiesskieyskimoskimsskinkskinsskintskios
skipsskirlskirrskiteskitsskiveskivysklimskoalskodyskoffskogsskolsskoolskortskoshskranskrikskuasskugsskyedskyerskyeyskyfsskyreskyrsskyteslabssladeslaesslagsslaidslakeslamsslaneslankslapsslartslatsslatyslaveslawsslaysslebssledssleerslewssleysslierslilyslimsslipeslipssliptslishslitsslivesloanslobssloesslogssloidslojdslomosloomslootslopsslopyslormslotssloveslowssloydslubbslubssluedsluessluffslugssluitslumsslurbslurssluseslyerslylyslypesmaaksmaiksmalmsmaltsmarmsmazesmeeksmeessmeiksmekesmerksmewssmirrsmirssmitssmogssmokosmoltsmoorsmootsmoresmorgsmoutsmowtsmugssmurssmushsmutssnabssnafusnagssnakysnaps
snarfsnarksnarssnarysnashsnathsnawssneadsneapsnebssnecksnedssneedsneessnellsnibssnicksniessniftsnigssnipssnipysnirtsnitssnobssnodssnoeksnoepsnogssnokesnoodsnooksnoolsnootsnotssnowksnowssnubssnugssnushsnyessoakssoapssoaresoarssoavesobassocassocessockosockssoclesodassoddysodicsodomsofarsofassoftasoftssoftysogersohursoilssoilysojassojussokahsokensokessokolsolahsolansolassoldesoldisoldosoldssoledsoleisolersolessolonsolossolumsolussomansomassoncesondesonessongssonlysonnesonnysonsesonsysooeysookssookysoolesoolssoomssoopssootesootssophssophysoporsoppysoprasoralsorassorbosorbssordasordosordssoredsoree
sorelsorersoressorexsorgosornssorrasortasortssorussothssotolsoucesouctsoughsoukssoulssoumssoupssoupysourssousesoutssowarsowcesowedsowersowffsowfssowlesowlssowmssowndsownesowpssowsesowthsoyassoylesoyuzsozinspacyspadospaedspaerspaesspagsspahispailspainspaitspakespaldspalespallspaltspamsspanespangspansspardsparsspartspatespatsspaulspawlspawsspaydspaysspazaspealspeanspeatspecsspectspeelspeerspeilspeirspeksspeldspelkspeosspermspetsspeugspewsspewyspialspicaspidespierspiesspiffspifsspilespimsspinaspinkspinsspirtspiryspitsspitzspivssplaysplogspodespodsspoomspoorspootsporksposhspotsspradspragspratspred
sprewspritsprodsprogspruesprugspudsspuedspuerspuesspugsspulespumespumyspurssputaspyalspyresquabsquegsquidsquitsquizstabsstadestagsstagystaidstaigstanestangstaphstapsstarnstarrstarsstatsstaunstawsstayssteanstearsteddstedestedssteeksteemsteensteilstelastelestellstemestemsstendstenostensstentstepssteptsterestetsstewsstewysteysstichstiedstiesstilbstilestimestimsstimystipastipestirestirkstirpstirsstivestivystoaestoaistoasstoatstobsstoepstogystoitstolnstomastondstongstonkstonnstookstoorstopestopsstoptstossstotsstottstounstoupstourstownstowpstowsstradstraestragstrakstrepstrewstriastrigstrimstropstrow
stroystrumstubsstudestudsstullstulmstummstumsstunsstupastupesturesturtstyedstyesstylistylostymestymystyrestytesubahsubassubbysubersubhasuccisuckssuckysucresuddssudorsudsysuedesuentsuerssuetesuetssuetysugansughssugossuhursuidssuintsuitssujeesukhssukuksulcisulfasulfosulkssulphsulussumissummasumossumphsumpssunissunkssunnasunnssunupsupessuprasurahsuralsurassuratsurdssuredsuressurfssurfysurgysurrasusedsusessusussutorsutrasuttaswabsswackswadsswageswagsswailswainswaleswalyswamyswangswankswansswapsswaptswardswareswarfswartswashswatsswaylswaysswealswedesweedsweelsweersweessweirsweltswerfsweysswiesswigs
swileswimsswinkswipeswireswissswithswitsswiveswizzswobsswoleswolnswopsswoptswotsswounsybbesybilsyboesybowsyceesycessyconsyenssykersykessylissylphsylvasymarsynchsyncssyndssynedsynessynthsypedsypessyphssyrahsyrensysopsythesyvertaalstaatatabertabestabidtabistablatabortabuntabustacantacestacettachetachotachstackstacostactstaelstafiataggytagmatahastahrstaigataigstaikotailstainstairataishtaitstajestakastakestakhitakintakistakkytalaktalaqtalartalastalcstalcytaleatalertalestalkstalkytallstalmatalpataluktalustamaltamedtamestamintamistammytampstanastangatangitangstanhstankatankstankytannatansytantitanto
tantytapastapedtapentapestapettapistappatapustarastardotaredtarestargatargetarnstaroctaroktarostarpstarretarrytarsitartstartytasartasedtasertasestaskstassatassetassotatartatertatestathstatietatoutattstatustaubetauldtauontaupetautstavahtavastavertawaitawastawedtawertawietawsetawtstaxedtaxertaxestaxistaxoltaxontaxortaxustayratazzatazzeteadeteadsteaedteakstealsteamstearsteatsteazetechstechytectateelsteemsteendteeneteensteenyteersteffsteggsteguategustehrsteiidteilsteindteinstelaetelcotelestelexteliatelictellstellyteloitelostemedtemestempitempstempttemsetenchtendstendutenestengeteniatennetennotenny
tenontentstentytenuetepaltepastepoyteraiterasterceterekteresterfeterfstergatermsterneternsterrytertsteslatestatesteteststetestethstetratetriteuchteughtewedteweltewittexastexestextsthackthagithaimthalethalithanathanethangthansthanxtharmtharsthawsthawythebethecatheedtheektheesthegntheictheinthelfthemathenstheowthermthespthetethewsthewythigsthilkthillthinethinsthiolthirlthofttholetholithorothorpthousthowlthraethrawthridthripthroethudsthugsthujathunkthurlthuyathymithymytianstiarsticalticcaticedticestichytickstickytiddytidedtidestierstiffstifostiftstigestigontikastikestikistikkatilaktiledtilertiles
tillstillytilthtiltstimbotimedtimestimontimpstinastincttindstineatinedtinestingetingstinkstinnytintstintytipistippytiredtirestirlstirostirrstitchtitertitistitretituptiyintiynstizestizzytoadstoadytoazetockstockytocostoddetoeastoffstoffytoftstofustogaetogastogedtogestoguetohostoiletoilstoingtoisetoitstokaytokedtokertokestokostolantolartolastoledtolestollstollytoltstolustolyltomantombstomestomiatommytomostonditondotonedtonertonestoneytongstonkatonkstonnetonustoolstoomstoonstootstopedtopeetopektopertopestophetophitophstopistopoitopostoppytoquetorahtorantorastorcstorestorictoriitorostorottorrstorse
torsitorsktortatortetortstosastosedtosestoshytossytotedtotertotestottytoukstounstourstousetousytoutstouzetouzytowedtowietownstownytowsetowsytowtstowzetowzytoyedtoyertoyontoyostozedtozestozietrabstradstragitraiktramptramstranktranqtranstranttrapetrapstrapttrasstratstratttravetrayftraystrecktreedtreentreestrefatreiftrekstrematremstresstresttretstrewstreyftreystriactridetriertriestrifftrigotrigstriketrildtrilltrimstrinetrinstrioltriortriostripstripytristtroadtroaktroattrocktrodetrodstrogstroistroketromptronatronctronetronktronstrooztrothtrotstrowstroystruedtruestrugotrugstrulltryertryketrymatryps
tsadetsaditsarstskedtsubatsubotuanstuarttuathtubaetubartubastubbytubedtubestuckstufastuffetuffstuftstuftytugratuiletuinatuismtuktutulestulpatulsitumidtummytumpstumpytunastundstunedtunertunestungstunnytupektupiktupletuqueturdsturfsturfyturksturmeturmsturnsturntturpsturrstushytuskstuskytuteetuttituttytutustuxestuyertwaestwaintwalstwanktwaystweeltweentweeptweertwerktwerptwiertwigstwilltwilttwinktwinstwinytwiretwirptwitetwitstwoertwyertyeestyerstyiyntykestylertympstyndetynedtynestypaltypedtypestypeytypictypostyppstyptotyrantyredtyrestyrostythetzarsudalsudonsugaliuggeduhlanuhuruukaseulamaulansulema
ulminulnadulnaeulnarulnasulpanulvasulyieulzieumamiumbelumberumbleumbosumbreumiacumiakumiaqummahummasummedumpedumphsumpieumptyumrahumrasunaisunaptunarmunaryunausunbagunbanunbarunbedunbidunboxuncapuncesunciauncosuncoyuncusundamundeeundosundugunethunfedunfixungagungetungodungotungumunhatunhipunicaunitsunjamunkedunketunkidunlawunlayunledunletunlidunlitunmanunmewunmixunpayunpegunpenunpinunredunridunrigunripunsawunsayunseeunsetunsewunsexunsoduntaxuntinunwetunwitunwonupbowupbyeupdosupdryupendupjetuplayupleduplituppedupranuprunupseeupseyuptakupteruptieuraeiuraliuraosurareurariuraseurateurbexurbiaurdee
urealureasuredoureicurenaurenturgedurgerurgesurialuriteurmanurnalurnedurpedursaeursidursonurubuurvasusersusneausqueusureusuryuteriutileuvealuveasuvulavacuavadedvadesvagalvagusvailsvairevairsvairyvakasvakilvalesvalisvalsevampsvampyvandavanedvanesvangsvantsvapedvapervapesvaranvarasvardyvarecvaresvariavarixvarnavarusvarvevasalvasesvastsvastyvaticvatusvauchvautevautsvawtevaxesvealevealsvealyveenaveepsveersveeryvegasvegesvegievegosvehmeveilsveilyveinsveinyvelarveldsveldtvelesvellsvelumvenaevenalvendsvenduveneyvengeveninventsvenusverbsverraverryverstvertsvertuvespavestavestsvetchvexedvexervexesvexil
vezirvialsviandvibesvibexvibeyvicedvicesvichyviersviewsviewyvifdaviffsvigasvigiavildevilervillivillsvimenvinalvinasvincavinedvinervinesvinewvinicvinosvintsvioldviolsviredvireoviresvirgavirgeviridvirlsvirtuvisasvisedvisesvisievisnevisonvistovitaevitasvitexvitrovittavivasvivatvivdavivervivesvizirvizorvleisvliesvlogsvoarsvocabvocesvoddyvodouvodunvoemavogievoidsvoilevoipsvolaevolarvoledvolesvoletvolksvoltavoltevoltivoltsvolvavolvevomervotedvotesvougevouluvowedvowervoxelvozhdvraicvrilsvroomvrousvrouwvrowsvuggsvuggyvughsvughyvulgovulnsvulvavuttywaacswackewackowackswaddswaddywadedwaderwadeswadgewadis
wadtswaffswaftswagedwageswaggawagyuwahoowaidewaifswaiftwailswainswairswaitewaitswakaswakedwakenwakerwakeswakfswaldowaldswaledwalerwaleswaliewaliswalkswallawallswallywaltywamedwameswamuswandswanedwaneswaneywangswanlewanlywannawantswantywanzewaqfswarbswarbywardswaredwareswarezwarkswarmswarnswarpswarrewarstwartswaseswashywasmswaspswaspywastswatapwattswauffwaughwaukswaulkwaulswaurswavedwaveswaveywawaswaweswawlswaxedwaxerwaxeswayedwazirwazoowealdwealsweambweanswearswebbyweberwechtwedelwedgyweedsweekeweeksweelsweemsweensweenyweepsweepyweestweeteweetswefteweftsweidsweilsweirsweiseweizewekasweldswelke
welkswelktwellswellyweltswembswenchwendswengewennywentsweroswershwestswetaswetlywexedwexeswhamowhamswhangwhapswharewhatawhatswhaupwhaurwhealwhearwheenwheepwheftwhelkwhelmwhenswhetswhewswheyswhidswhiftwhigswhilkwhimswhinswhioswhipswhiptwhirrwhirswhishwhisswhistwhitswhitywhizzwhompwhoofwhootwhopswhorlwhortwhosowhowswhumpwhupswhydawiccawickswickywiddywideswielswifedwifeswifeywifiewiftywiganwiggawiggywikiswilcowildswiledwileswilgawiliswiljawillswiltswimpswindswinedwineswineywingewingswingywinkswinnawinnswinoswinzewipedwiperwipeswiredwirerwireswirrawisedwiseswishawishtwispswistswitanwitedwiteswithe
withswithywivedwiverwiveswizenwizeswoadswoaldwockswodgewofulwojuswokerwokkawoldswolfswollywolvewombswombywomynwongawongiwonkswonkywontswoodswooedwooerwoofswoofywooldwoolswoonswoopswoopywoosewooshwootzwordsworkswormswormywortswowedwoweewoxenwrackwrangwrapswraptwrastwratewrawlwrenswrickwriedwrierwrieswritswrokewrootwrothwryerwrylywuddywuduswullswurstwuseswushuwussywuxiawyledwyleswyndswynnswytedwytesxebecxeniaxenicxenonxericxeroxxerusxoanaxraysxylanxylemxylicxylolxylylxystixystsyaarsyabasyabbayabbyyaccayackayacksyaffsyageryagesyagisyahooyairdyakkayakowyalesyamenyampyyamunyangsyanksyapokyaponyapps
yappyyarakyarcoyardsyareryarfayarksyarnsyarrsyartayartoyatesyaudsyauldyaupsyawedyaweyyawlsyawnsyawnyyawpsyboreycladycledycondydradydredyeadsyeahsyealmyeansyeardyearsyecchyechsyechyyedesyeedsyeeshyeggsyelksyellsyelmsyelpsyeltsyentayenteyerbayerdsyerksyesesyesksyestsyestyyetisyettsyeuksyeukyyevenyevesyewenyexedyexesyfereyikedyikesyillsyinceyipesyippyyirdsyirksyirrsyirthyitesyitieylemsylikeylkesymoltympesyobboyobbyyocksyodelyodhsyodleyogasyogeeyoghsyogicyoginyogisyoickyojanyokedyokelyokeryokesyokulyolksyolkyyomimyompsyonicyonisyonksyoofsyoopsyoresyorksyorpsyouksyournyoursyourtyouseyowedyowesyowie
yowlsyowzayraptyrentyrivdyrnehysameytostyuansyucasyuccayucchyuckoyucksyuckyyuftsyugasyukedyukesyukkyyukosyulanyulesyummoyummyyumpsyuponyuppyyurtayurtsyuzuszabrazackszaidazaidyzairezakatzamanzambozamiazanjazantezanzazanzezappyzarfszariszatiszaxeszayinzazenzealszebeczebubzebuszedaszeinszendozerdazerkszeroszestszetaszexeszezeszhomozibetziffsziganzilaszilchzillazillszimbizimbszincozincszincyzinebzineszingszingyzinkezinkyzippozippyziramzitiszizelzizitzlotezlotyzoaeazoboszobuszoccozoeaezoealzoeaszoismzoistzombizonaezondazonedzonerzoneszonkszooeazooeyzooidzookszoomszoonszootyzoppazoppozorilzoriszorro
zoukszoweezowiezuluszupanzupaszuppazurfszuzimzygalzygonzymeszymic
`.replace(/\s+/g, '');
