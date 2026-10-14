// Word Duel: versus Wordle. Each of you secretly picks a five-letter word for the other,
// then you race to crack each other's word. Fewest guesses wins (a miss counts as 7).
//
// Moves:  { setup: { v: 2, pool, hard, dealt, bo3 } }  optional first move: the house rules (v2)
//         { secret: 'crane' }   phase 1, both at once (a word from the pool)
//         { guess: 'slate' }    phase 2, both at once and independent: up to 6 valid guesses each
// A match with no setup move plays the original (v1) rules. See docs/games/wordduel.md.
//
// Files: wordduel/rules.js (pure rules, v1 + v2), wordduel/records.js (ledger + stamps),
// wordduel/css.js, wordduel/lists.js (the word lists, ~100 KB of letters).
import { registerGame } from './core.js';
import { CSS } from './wordduel/css.js';
import {
  MAX, other, lists, scoreGuess, target, solvedBy, doneBy, tally, init, next, apply, result, score,
  heatOf, roundView, roundResult, DEFAULT_SETUP,
} from './wordduel/rules.js';
import { recordMatch, stampsFor, ledgerOf, setupToString, setupFromString, usedOf, recentOf } from './wordduel/records.js';

const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : '');
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// ── view helpers ──
const KB_ROWS = ['qwertyuiop', 'asdfghjkl', '>zxcvbnm<'];
const RANK = { x: 1, y: 2, g: 3 };
const WORDS_FOR = { g: 'right spot', y: 'in the word', x: 'not in it' };
const KEY_CLASS = { g: 'm-g', y: 'is-hl', x: 'is-out' }; // kit .g-key states
const CRACK = ['', 'Witchcraft.', 'Mind-reader.', 'Clean.', 'Solid.', 'Phew.', 'By a whisker.'];
const POOL_NAME = { fair: 'Everyday', love: 'Love letters', any: 'Any word' };
const WAIT_MS = 20000; // how long the waiting phone waits before offering to set the rules itself
const BACK_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8.5 5H20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8.5L3 12z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M11 9l6 6M17 9l-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';


const RULES = { init, next, apply, result, score };
const isPristine = (s) => !s.v && !s.secret.a && !s.secret.b;
const optsOf = (s) => (s.v === 2 ? s.opts : null);

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
    'Set the house rules, then each of you secretly picks a five-letter word for the other to crack.',
    'Crack theirs in up to six guesses. Fewest guesses wins; equal? The hotter trail wins.',
    'Green with a bar: right spot. Yellow stripes: in the word, wrong spot. Grey: not in it.',
    'On a laptop just type: Enter to guess, Backspace to delete.',
  ],
  css: CSS,
  endDelay: 1900,
  endLookLabel: 'See both boards',
  ...RULES,
  // exposed for tests
  _test: { scoreGuess, lists, MAX },

  mount(el, api) {
    el.innerHTML = `<div class="g-wd">
      <div class="g-wd-head"><p class="g-wd-say" aria-live="polite"></p><div class="g-wd-strip"></div></div>
      <div class="g-wd-area"></div>
      <div class="g-wd-actions"></div>
      <div class="g-wd-kb" role="group" aria-label="Keyboard" hidden></div>
    </div>`;
    const root = el.querySelector('.g-wd');
    const sayEl = root.querySelector('.g-wd-say');
    const stripEl = root.querySelector('.g-wd-strip');
    const area = root.querySelector('.g-wd-area');
    const actions = root.querySelector('.g-wd-actions');
    const kb = root.querySelector('.g-wd-kb');
    const gm = el.closest('.gm');

    const data = () => { try { return api.data() || {}; } catch { return {}; } };
    const setData = (p) => { try { api.setData(p); } catch { /* records are a bonus */ } };

    let ctx = null;
    let draft = '';
    let draftKey = '';
    let seen = null; // { ri, a, b, moves }: the round and guess counts at the last update
    let flip = null; // { who, row, until } row that is revealing right now
    let win = null; // { who, row } row that bounces after a solve
    let areaSig = '';
    let actSig = '';
    let rulesDraft = null; // the rules card's current choices
    let chips = []; // love-letter suggestions
    let chipKey = '';
    const RECAP = 'ju.wordduel.recap.';
    const recapSeen = { a: 0, b: 0 }; // best of 3: rounds whose recap each player has dismissed (kept per match on this device)
    let recapLoaded = '';
    let selfRules = false; // the waiting phone chose to set the rules itself
    let waitSince = 0; // when the waiting view first showed (for the "Set the rules yourself" fallback)
    let sentSetup = null; // the rules this phone sent (to tell it if another setup won)
    let lastStatus = null;
    let hold = null; // one phone: { w, ri } a finished player's reveal that must be dismissed
    let holdEl = null;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
    const flipMs = () => (reduced() ? 60 : 4 * 160 + 520);
    const nm = (w) => esc(api.name(w));
    let lastSent = 0; // when the last word went in (a second Enter right after it is ignored)
    const pcls = (w) => `p-${w}`;
    const up = (w) => String(w || '').toUpperCase();
    const who = (w) => `<span class="g-wd-who ${pcls(w)}">${nm(w)}</span>`;
    const initial = (w) => esc(String(api.name(w) || w).trim().charAt(0).toUpperCase());

    // A half-typed word survives a reload (this device only).
    const DRAFT = 'ju.wordduel.draft.';
    const draftSlot = (c) => `${c.viewer}|${c.state.secret[c.viewer] ? `g${c.state.guesses[c.viewer].length}` : 'pick'}`;
    const draftLoad = (c) => { try { const v = JSON.parse(localStorage.getItem(DRAFT + c.matchId) || 'null'); return v && v.k === draftSlot(c) && /^[a-z]{1,5}$/.test(v.d) ? v.d : ''; } catch { return ''; } };
    const draftSave = () => { const c = ctx; if (!c || !c.viewer || !c.matchId) return; try { if (draft) localStorage.setItem(DRAFT + c.matchId, JSON.stringify({ k: draftSlot(c), d: draft })); else localStorage.removeItem(DRAFT + c.matchId); } catch { /* storage may be blocked */ } };
    // One phone: a finishing reveal that hasn't been passed on yet (so backing out can't retake it).
    const HOLD = 'ju.wordduel.hold.';
    const holdSave = () => { const c = ctx; if (!c || !c.matchId) return; try { if (hold) localStorage.setItem(HOLD + c.matchId, JSON.stringify(hold)); else localStorage.removeItem(HOLD + c.matchId); } catch { /* storage may be blocked */ } };
    const holdLoad = (c) => { try { const v = JSON.parse(localStorage.getItem(HOLD + c.matchId) || 'null'); return v && (v.w === 'a' || v.w === 'b') && Number.isInteger(v.ri) ? v : null; } catch { return null; } };

    function modeOf(c) {
      if (!c) return 'blank';
      if (c.over) return 'end';
      const v = c.viewer;
      if (!v) return 'blank';
      const s = c.state;
      if (isPristine(s)) return v === (c.mode === 'online' ? c.first : v) || selfRules ? 'rules' : 'waitrules';
      if (c.matchId && recapLoaded !== c.matchId) { recapLoaded = c.matchId; try { const r = JSON.parse(localStorage.getItem(RECAP + c.matchId) || 'null'); if (r) { recapSeen.a = Number(r.a) || 0; recapSeen.b = Number(r.b) || 0; } } catch { /* storage may be blocked */ } }
      if (s.v === 2 && s.opts.bo3 && s.rounds.length && !s.secret[v] && !(s.secret.a && s.secret.b) && recapSeen[v] < s.rounds.length) return 'recap';
      if (!s.secret.a || !s.secret.b) return s.secret[v] ? 'picked' : 'pick';
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
    /** One player's grid: `tgt` is the word they are cracking, `list` their guesses so far. */
    function boardHTML(who_, tgt, list, { blind = false, draftRow = false, dealt = '', fl = -1, wn = -1 } = {}) {
      let h = '';
      for (let r = 0; r < MAX; r++) {
        const g = list[r];
        if (g) {
          const marks = scoreGuess(tgt, g);
          const cls = `${r === 0 && dealt && g === dealt ? ' is-dealt' : ''}${r === wn && r !== fl ? ' win' : ''}`;
          h += rowHTML(blind ? '' : g, marks, { cls, tileCls: r === fl ? ' flip' : '', label: blind ? `Guess ${r + 1}: ${describe('', marks)}` : describe(g, marks) });
        } else if (draftRow && r === list.length) {
          h += rowHTML(draft, null, { cls: ' is-draft', label: 'Your guess' });
        } else h += rowHTML('', null, { label: '' });
      }
      return `<div class="g-wd-board" role="group">${h}</div>`;
    }
    const dealtOf = (s) => (s.v === 2 && s.opts.dealt && s.opener ? s.opener : '');
    const liveBoard = (w, s, o = {}) => boardHTML(w, target(s, w), s.guesses[w], {
      ...o, dealt: dealtOf(s), fl: flip && flip.who === w ? flip.row : -1, wn: win && win.who === w ? win.row : -1,
    });
    function minisHTML(who_, s) {
      const tgt = target(s, who_);
      let h = '';
      for (let r = 0; r < MAX; r++) {
        const g = s.guesses[who_][r];
        const marks = g ? scoreGuess(tgt, g) : '     ';
        h += `<span class="g-wd-mrow">${[...marks].map((m) => `<i class="g-wd-m${m.trim() ? ` m-${m}` : ''}"></i>`).join('')}</span>`;
      }
      return `<span class="g-wd-minis" role="img" aria-label="${nm(who_)} has used ${s.guesses[who_].length} of ${MAX} guesses">${h}</span>`;
    }
    function heatHTML(s, v) {
      const one = (w) => { const t0 = target(s, w); const h = t0 ? heatOf(t0, flipping(w) ? s.guesses[w].slice(0, flip.row) : s.guesses[w]) : { g: 0, y: 0 }; return `<span class="g-wd-hp" role="img" aria-label="${nm(w)}: ${h.g} greens, ${h.y} yellows"><b class="g-wd-who ${pcls(w)}">${initial(w)}</b><i class="g-wd-m m-g"></i>${h.g}<i class="g-wd-m m-y"></i>${h.y}</span>`; };
      return `<span class="g-wd-heat"><span class="g-wd-hl">Heat</span>${one(v)}${one(other(v))}</span>`;
    }
    const flipping = (w) => !!(flip && flip.who === w && Date.now() < flip.until);
    const cur = (s) => ({ secret: s.secret, guesses: s.guesses, opener: s.opener || null });
    function columnHTML(w, rv, { blind, showTarget }) {
      const tgt = rv.secret[other(w)];
      const list = rv.guesses[w];
      const solved = !!tgt && list.includes(tgt);
      const fl = flip && flip.who === w ? flip.row : -1;
      const status = flipping(w) ? 'revealing…' : solved ? `cracked it in ${list.length}` : list.length >= MAX ? 'out of guesses' : `guess ${list.length + 1} of ${MAX}`;
      const missed = !solved && list.length >= MAX && !flipping(w);
      return `<div class="g-wd-col">
        <div class="g-wd-colhead"><span class="g-wd-who ${pcls(w)}">${nm(w)}</span><small>${status}</small></div>
        ${showTarget ? `<div class="g-wd-board g-wd-target">${rowHTML(tgt, null, { cls: ` is-target${missed ? ` inked ${pcls(other(w))}` : ''}`, label: `${nm(w)} was cracking ${up(tgt)}` })}</div>` : ''}
        ${boardHTML(w, tgt, list, { blind, dealt: rv.opener || '', fl, wn: win && win.who === w ? win.row : -1 })}
      </div>`;
    }
    const pillsHTML = (s) => {
      const o = optsOf(s);
      if (!o) return '';
      const parts = [POOL_NAME[o.pool], o.hard ? 'Hard' : '', o.dealt ? 'Dealt' : '', o.bo3 ? 'Best of 3' : ''].filter(Boolean);
      return `<div class="g-wd-tags"><span class="g-wd-pill is-hl">${parts.join(' · ')}</span></div>`;
    };
    function roundLine(s) {
      const n = s.round;
      const { a, b } = s.wins;
      if (n >= 4) return 'Round 4. One last go to break the tie.';
      if (a === b) return n === 3 ? 'Round 3. Winner takes it all.' : `Round ${n}. All square.`;
      return `Round ${n}. ${nm(a < b ? 'a' : 'b')} needs this one.`;
    }
    const scoreboardHTML = (s) => (s.v === 2 && s.opts.bo3 && s.rounds.length && !s.fin
      ? `<div class="g-wd-score"><div class="g-wd-score-n"><small class="p-a">${nm('a')}</small><span class="p-a">${s.wins.a}</span><span class="g-wd-dash">–</span><span class="p-b">${s.wins.b}</span><small class="p-b">${nm('b')}</small></div><small>${roundLine(s)}</small></div>` : '');
    const ledgerText = () => ledgerOf(data(), (w) => api.name(w)).text;
    const ledgerLine = () => { const l = ledgerOf(data(), (w) => api.name(w)); return l.text ? `<span>${esc(l.text)}</span><span class="g-wd-ledgerline">${esc(l.context)}</span>` : ''; };
    // "Déjà vu": a hint under the typed secret when it has been used before (v2 only, only the picker sees it)
    function hintText(c) {
      const s = c.state;
      if (!c.viewer || s.v !== 2 || modeOf(c) !== 'pick' || draft.length !== 5) return '';
      const d = data();
      const v = c.viewer;
      const p = other(v);
      const mine = usedOf(d, v).filter((x) => x.w === draft);
      if (mine.length) { const x = mine[mine.length - 1]; return `You picked ${up(draft)} before. ${nm(p)} ${x.n >= 7 ? 'never cracked it' : `cracked it in ${x.n}`}.`; }
      const theirs = usedOf(d, p).filter((x) => x.w === draft);
      if (theirs.length) return `${nm(p)} used ${up(draft)} on you ${theirs.length === 1 ? 'once' : `${theirs.length} times`}. Bold.`;
      return '';
    }
    function paintHint() { const h = area.querySelector('.g-wd-hint'); if (h && ctx) h.innerHTML = hintText(ctx); }

    // keyboard: built once, then only classes and disabled flags change (keeps taps from dropping)
    const keyEls = {};
    kb.innerHTML = KB_ROWS.map((row) => `<div class="g-wd-kr">${[...row].map((k) => {
      if (k === '>') return '<button class="g-key is-wide g-wd-key" data-k="enter" aria-label="Enter">Enter</button>';
      if (k === '<') return `<button class="g-key is-wide g-wd-key" data-k="back" aria-label="Delete">${BACK_ICON}</button>`;
      return `<button class="g-key g-wd-key" data-k="${k}" aria-label="${up(k)}">${k}</button>`;
    }).join('')}</div>`).join('');
    kb.querySelectorAll('button[data-k]').forEach((b) => { keyEls[b.dataset.k] = b; });
    function paintKeys(c, m) {
      const show = m === 'pick' || m === 'solve';
      kb.hidden = !show;
      if (!show) return;
      const v = c.viewer;
      const s = c.state;
      const best = {};
      if (m === 'solve') {
        const tgt = target(s, v);
        s.guesses[v].forEach((g, r) => {
          if (flip && flip.who === v && flip.row === r) return; // colour keys after the reveal
          const marks = scoreGuess(tgt, g);
          for (let i = 0; i < 5; i++) if ((RANK[marks[i]] || 0) > (RANK[best[g[i]]] || 0)) best[g[i]] = marks[i];
        });
      }
      for (const [k, b] of Object.entries(keyEls)) {
        b.disabled = !c.canMove;
        if (k.length !== 1) continue;
        const mk = best[k];
        for (const cl of Object.values(KEY_CLASS)) b.classList.toggle(cl, !!mk && KEY_CLASS[mk] === cl);
        b.setAttribute('aria-label', `${up(k)}${mk ? `, ${WORDS_FOR[mk]}` : ''}`);
      }
    }

    // ── paint ──
    function say(html) { sayEl.innerHTML = html; }
    function snapLine(w, matchId) {
      const d = data();
      const [mid, len] = String(d.snapm || '').split(':');
      return mid && mid === matchId && d.lastm === matchId && recentOf(d).includes(matchId) ? ` ${who(w)} ends ${nm(other(w))}’s run of ${esc(len)}.` : '';
    }
    function endSay(s, matchId) {
      if (!s.v) {
        const na = tally(s, 'a');
        const nb = tally(s, 'b');
        const fmt = (n) => (n > MAX ? 'missed' : `${n}`);
        if (na === nb) return na > MAX ? 'Neither word was cracked.' : `Dead heat: both in ${na}.`;
        const w = na < nb ? 'a' : 'b';
        return `${who(w)} wins, ${fmt(Math.min(na, nb))} to ${fmt(Math.max(na, nb))}.${snapLine(w, matchId)}`;
      }
      const r = result(s);
      if (r.winner) return `${who(r.winner)} ${s.opts.bo3 ? 'takes the set' : 'wins'}. ${esc(r.sub)}${snapLine(r.winner, matchId)}`;
      return `${esc(r.text)}. ${esc(r.sub)}`;
    }
    function stripFor(c, m) {
      const s = c.state;
      const v = c.viewer;
      if (m === 'pick') {
        const p = other(v);
        return (c.mode === 'online' ? (s.secret[p] ? `<span>${who(p)} has picked</span>` : `<span>${who(p)} is picking…</span>`) : '') + ledgerLine();
      }
      if (m === 'recap') return `<span>${nm('a')} <b>${s.wins.a}</b> – <b>${s.wins.b}</b> ${nm('b')}</span>`;
      if (m === 'rules' || m === 'waitrules') return ledgerLine();
      if (m === 'solve') return `${who(other(v))}${minisHTML(other(v), s)}${heatHTML(s, v)}`;
      if (m === 'done') return heatHTML(s, v);
      return '';
    }
    function rulesCardHTML() {
      const r = rulesDraft;
      const seg = (val, t, sub) => `<button class="g-wd-opt" data-rule="pool:${val}" aria-pressed="${r.pool === val}">${t}<small>${sub}</small></button>`;
      const tog = (key, t, sub) => `<button class="g-wd-opt g-wd-tog" role="switch" data-rule="${key}" aria-checked="${!!r[key]}"><span><b>${t}</b><small>${sub}</small></span><span class="g-wd-sw">${r[key] ? 'On' : 'Off'}</span></button>`;
      return `<div class="g-wd-rules"><h2>House rules</h2>
        <div class="g-wd-seg" role="group" aria-label="Secret words">${seg('fair', 'Everyday', 'common words')}${seg('love', 'Love letters', 'soft &amp; sweet')}${seg('any', 'Anything', 'any valid word')}</div>
        <div class="g-wd-rules-grid">${tog('hard', 'Hard mode', 'use every hint you uncover')}${tog('dealt', 'Dealt opener', 'a shared first row, no CRANE')}${tog('bo3', 'Best of 3', 'first to two rounds')}</div></div>`;
    }
    function rerollChips(s, force) {
      const o = optsOf(s);
      const key = `${s.round || 1}|${o ? o.pool : ''}|${(s.rounds || []).length}`;
      if (!force && key === chipKey && chips.length) return;
      chipKey = key;
      chips = [];
      if (!o || o.pool !== 'love') return;
      const pool = poolList(s).slice();
      for (let i = 0; i < 3 && pool.length; i++) chips.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    function poolList(s) {
      const o = optsOf(s);
      const L = lists();
      const used = new Set();
      for (const r of s.rounds || []) { used.add(r.secret.a); used.add(r.secret.b); }
      if (o && o.dealt && s.opener) used.add(s.opener);
      return (o && o.pool === 'love' ? L.love : L.common).filter((w) => !used.has(w));
    }

    function render() {
      const c = ctx;
      if (!c) return;
      const s = c.state;
      const v = c.viewer;
      const m = modeOf(c);
      root.dataset.mode = m;
      const p = v ? other(v) : null;
      const o = optsOf(s);
      const roundTag = o && o.bo3 && !c.over ? `Round ${s.round}. ` : '';
      // the last flip hasn't finished: don't announce the result (or switch to the recap) yet
      const holding = (m === 'end' || m === 'recap') && !!(flip && Date.now() < flip.until);
      if (m === 'waitrules') { if (!waitSince) { waitSince = Date.now(); later(() => { areaSig = ''; render(); }, WAIT_MS + 50); } } else waitSince = 0;
      const waitReady = m === 'waitrules' && Date.now() - waitSince >= WAIT_MS;
      const wantStatus = m === 'waitrules' ? `Waiting for ${api.name(c.first)} to set the rules…` : null;
      if (wantStatus !== lastStatus) { lastStatus = wantStatus; api.setStatus(wantStatus); }

      // instruction line + strip
      if (m === 'blank') say('');
      else if (m === 'rules') say('House rules. One tap and you’re playing.');
      else if (m === 'waitrules') say(''); // the status line above already says so
      else if (m === 'pick') say(`Pick a secret word for ${who(p)} to crack.`);
      else if (m === 'picked') say(`Your word is locked in. The race starts when ${who(p)} picks theirs.`);
      else if (m === 'solve') say(`${roundTag}Crack ${who(p)}’s word. Guess ${s.guesses[v].length + 1} of ${MAX}.`);
      else if (m === 'done') {
        if (flipping(v)) say('Revealing…');
        else say(solvedBy(s, v)
          ? `Cracked it in ${s.guesses[v].length}! ${CRACK[Math.min(MAX, s.guesses[v].length)]} Now ${who(p)} is on your word…`
          : `Out of guesses. It was <b>${up(target(s, v))}</b>. ${who(p)} is still going…`);
      } else if (holding) say('Revealing…');
      else if (m === 'recap') {
        const rv0 = roundView(s, s.rounds.length - 1);
        const rr = roundResult(rv0.secret, rv0.guesses);
        say(rr.winner ? `${who(rr.winner)} takes round ${s.rounds.length}. ${esc(rr.sub)}` : `Round ${s.rounds.length} is a draw. ${esc(rr.sub)}`);
      } else if (m === 'end') say(endSay(s, c.matchId));
      stripEl.innerHTML = m === 'blank' || m === 'end' ? '' : stripFor(c, m);

      // main area
      if (m === 'pick' || m === 'picked') rerollChips(s, false);
      const stamps = m === 'end' ? stampsFor(s, data(), c.matchId, (w) => api.name(w)) : [];
      const sig = JSON.stringify([m, holding, waitReady, v, s.rounds ? s.rounds.length : 0, s.guesses.a.length, s.guesses.b.length, !!s.secret.a, !!s.secret.b, flip && [flip.who, flip.row, flipping(flip.who)], win && [win.who, win.row], c.canMove, s.round || 0, s.v || 0, rulesDraft, chips, m === 'end' ? [ledgerText(), stamps.map((x) => x.label)] : 0]);
      if (sig !== areaSig) {
        areaSig = sig;
        area.classList.toggle('is-scroll', m === 'rules' || m === 'waitrules' || m === 'pick' || m === 'picked');
        if (m === 'blank') area.innerHTML = '';
        else if (m === 'rules') {
          if (!rulesDraft) rulesDraft = setupFromString(data().last_setup) || { pool: DEFAULT_SETUP.pool, hard: false, dealt: false, bo3: false };
          area.innerHTML = rulesCardHTML();
        } else if (m === 'waitrules') {
          area.innerHTML = `<div class="g-wd-wait"><span class="g-wd-stamp ${pcls(c.first)}">Rules</span><p>${who(c.first)} is choosing the house rules.</p>${waitReady ? '<button class="gm-btn gm-btn-ghost" data-act="selfrules">Set the rules yourself</button>' : ''}</div>`;
        } else if (m === 'pick') {
          const dl = dealtOf(s);
          area.innerHTML = `<div class="g-wd-pick">${pillsHTML(s)}${scoreboardHTML(s)}${dl ? `<p class="g-wd-dealtline">Row 1 is dealt to you both: <b>${up(dl)}</b></p>` : ''}<p class="g-wd-cap">Your secret word</p><div class="g-wd-board">${rowHTML(draft, null, { cls: ' is-draft', label: 'Your secret word' })}</div><p class="g-wd-hint"></p>${chips.length ? `<div class="g-wd-chips" role="group" aria-label="Suggestions">${chips.map((w) => `<button class="g-wd-chip" data-chip="${w}">${up(w)}</button>`).join('')}</div>` : ''}</div>`;
        } else if (m === 'picked') {
          area.innerHTML = `<div class="g-wd-pick">${pillsHTML(s)}${scoreboardHTML(s)}<p class="g-wd-cap">${nm(p)} has to crack</p><div class="g-wd-board">${rowHTML(s.secret[v], null, { label: `Your word ${up(s.secret[v])}` })}</div><span class="g-wd-stamp ${pcls(v)}">Locked in</span></div>`;
        } else if (m === 'solve') {
          area.innerHTML = liveBoard(v, s, { draftRow: true });
        } else if (m === 'done') {
          area.innerHTML = `<div class="g-wd-duo">${columnHTML(v, cur(s), { blind: false, showTarget: true })}${columnHTML(p, cur(s), { blind: true, showTarget: true })}</div>`;
        } else if (m === 'recap') {
          const rv = roundView(s, s.rounds.length - 1);
          area.innerHTML = `<div class="g-wd-duo">${columnHTML(v, rv, { blind: false, showTarget: true })}${columnHTML(p, rv, { blind: false, showTarget: true })}</div>`;
        } else if (m === 'end') {
          const first = v || 'a';
          area.innerHTML = `<div class="g-wd-duo">${columnHTML(first, cur(s), { blind: false, showTarget: true })}${columnHTML(other(first), cur(s), { blind: false, showTarget: true })}</div>`;
        }
      }

      paintHint();

      // actions
      const stampSig = m === 'end' ? [ledgerText(), stamps.map((x) => x.label)] : 0;
      const aSig = JSON.stringify([m, holding, c.canMove, stampSig, s.v || 0, s.round || 0]);
      if (aSig !== actSig) {
        actSig = aSig;
        if (m === 'rules') actions.innerHTML = `<button class="gm-btn gm-btn-big" data-act="play"${c.canMove ? '' : ' disabled'}>Play</button>`;
        else if (m === 'pick') {
          const dis = c.canMove ? '' : ' disabled';
          actions.innerHTML = `<button class="gm-btn gm-btn-ghost" data-act="surprise"${dis}>Surprise me</button><button class="gm-btn" data-act="lock"${dis}>Lock it in</button>`;
        } else if (holding) actions.innerHTML = '';
        else if (m === 'recap') actions.innerHTML = `<div class="g-wd-endx"><p class="g-wd-ledger">${esc(roundLine(s).replace(/<[^>]+>/g, ''))}</p></div><button class="gm-btn gm-btn-big" data-act="nextround">Round ${s.round}</button>`;
        else if (m === 'end') actions.innerHTML = `${endExtras(s, stamps)}<button class="gm-btn" data-g="rematch">Play again</button><button class="gm-btn gm-btn-ghost" data-g="close">Back to games</button>`;
        else actions.innerHTML = '';
      }
      paintKeys(c, m);
    }
    function endExtras(s, stamps) {
      const st = stamps.length ? `<div class="g-wd-stamps">${stamps.map((x, i) => `<span class="g-wd-st ${x.who === 'hl' ? 'hl' : pcls(x.who)}" style="--n:${i};--r:${[-4, 3, -2, 4, -3][i % 5]}deg">${esc(x.label)}</span>`).join('')}</div>` : '';
      let recap = '';
      if (s.v === 2 && s.opts.bo3) {
        recap = `<div class="g-wd-recap">${s.rounds.map((r, i) => {
          const na = r.guesses.a.includes(r.secret.b) ? r.guesses.a.length : 'miss';
          const nb = r.guesses.b.includes(r.secret.a) ? r.guesses.b.length : 'miss';
          return `<span>Round ${i + 1}: ${nm('a')} <b>${na}</b> · <b>${nb}</b> ${nm('b')}${r.w ? ` (${nm(r.w)})` : ' (draw)'}</span>`;
        }).join('')}</div>`;
      }
      const led = ledgerText();
      return `<div class="g-wd-endx">${st}${recap}${led ? `<p class="g-wd-ledger">${esc(led)}</p>` : ''}</div>`;
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
      paintHint();
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

    function startFlip(w, row, solved, mine) {
      flip = { who: w, row, until: Date.now() + flipMs() };
      win = null;
      if (mine && !reduced()) for (let i = 0; i < 5; i++) later(() => api.sfx('flip'), i * 160 + 250);
      later(() => {
        if (!flip || flip.who !== w || flip.row !== row) return;
        flip = null;
        if (solved) {
          win = { who: w, row };
          if (mine) { api.sfx('good'); api.haptic(20); }
          later(() => { if (win && win.who === w && win.row === row) { win = null; render(); } }, 1000);
        } else if (mine && ctx && ctx.state && ctx.state.guesses && ctx.state.guesses[w] && ctx.state.guesses[w].length >= MAX) api.sfx('lose');
        render();
      }, flipMs());
    }

    function submit() {
      const c = ctx;
      if (!c || !c.canMove) return;
      const m = modeOf(c);
      if (m !== 'pick' && m !== 'solve') return;
      if (!draft && (myFlip() || Date.now() - lastSent < 900)) return; // a double Enter, not a mistake
      if (draft.length < 5) { bad(draft.length ? 'Five letters, please.' : 'Type a five-letter word.'); return; }
      // The move is final the moment it is sent. (One phone: a finishing guess is still shown to its
      // player first, by the reveal that sits above the pass-the-phone curtain.)
      const word = draft;
      draft = ''; // the move re-renders synchronously
      const r = api.move(m === 'pick' ? (c.state.v === 2 ? { secret: word, v: 2 } : { secret: word }) : { guess: word });
      if (!r.ok) { draft = word; bad(r.error); return; }
      lastSent = Date.now();
      draftSave();
      if (m === 'pick') { api.sfx('place'); api.haptic(15); }
    }

    function press(k) {
      const c = ctx;
      if (!c || !c.canMove) return;
      const m = modeOf(c);
      if (m !== 'pick' && m !== 'solve') return;
      if (k === 'enter') { submit(); return; }
      if (k === 'back') {
        if (!draft) return;
        draft = draft.slice(0, -1);
        api.sfx('tick');
        paintDraft();
        draftSave();
        return;
      }
      if (!/^[a-z]$/.test(k) || draft.length >= 5) return;
      draft += k;
      api.sfx('tap');
      paintDraft();
      draftSave();
    }

    function playRules() {
      const c = ctx;
      if (!c || !c.canMove || modeOf(c) !== 'rules' || !rulesDraft) return;
      const r = api.move({ setup: { v: 2, ...rulesDraft } });
      if (!r.ok) { api.toast(r.error); return; }
      sentSetup = { ...rulesDraft };
      setData({ last_setup: setupToString(rulesDraft) });
      api.sfx('place');
    }

    // ── one phone: the finishing reveal, above the curtain ──
    function hideHold() { if (holdEl) { holdEl.remove(); holdEl = null; } }
    function holdValid(c, h) {
      const rv = roundView(c.state, h.ri);
      const t = rv.secret[other(h.w)];
      const gl = rv.guesses[h.w];
      return !!t && gl.length > 0 && (gl.includes(t) || gl.length >= MAX);
    }
    function showHold(c, h, fresh) {
      hideHold();
      const rv = roundView(c.state, h.ri);
      const tgt = rv.secret[other(h.w)];
      const gl = rv.guesses[h.w];
      const solved = gl.includes(tgt);
      const text = solved ? `Cracked it in ${gl.length}! ${CRACK[Math.min(MAX, gl.length)]}` : `Out of guesses. It was <b>${up(tgt)}</b>.`;
      holdEl = document.createElement('div');
      holdEl.className = 'g-wd-hold-layer';
      holdEl.setAttribute('role', 'dialog');
      holdEl.setAttribute('aria-label', 'Your result');
      holdEl.innerHTML = `<div class="g-wd"><p class="g-wd-say" aria-live="polite">${fresh ? 'Revealing…' : text}</p>${boardHTML(h.w, tgt, gl, { dealt: rv.opener || '', fl: fresh ? gl.length - 1 : -1, wn: !fresh && solved ? gl.length - 1 : -1 })}<div class="g-wd-actions"><button class="gm-btn" data-act="holddone">Done, pass to ${nm(other(h.w))}</button></div></div>`;
      (gm || document.body).appendChild(holdEl);
      const mine = holdEl;
      mine.addEventListener('click', (e) => {
        if (!e.target.closest('[data-act="holddone"]')) return;
        hold = null; holdSave(); hideHold();
      });
      if (fresh) {
        if (!reduced()) for (let i = 0; i < 5; i++) later(() => api.sfx('flip'), i * 160 + 250);
        later(() => {
          if (holdEl !== mine) return;
          const sayNow = mine.querySelector('.g-wd-say');
          if (sayNow) sayNow.innerHTML = text;
          api.sfx(solved ? 'good' : 'lose');
        }, flipMs());
      }
    }

    // on-screen keyboard and buttons (keep focus off the keys so Enter never re-presses one)
    kb.addEventListener('mousedown', (e) => e.preventDefault());
    kb.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b || b.disabled) return;
      press(b.dataset.k);
    });
    area.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="selfrules"]')) { selfRules = true; areaSig = ''; actSig = ''; render(); return; }
      const rb = e.target.closest('button[data-rule]');
      if (rb && rulesDraft) {
        const [k, val] = rb.dataset.rule.split(':');
        if (k === 'pool') rulesDraft = { ...rulesDraft, pool: val };
        else rulesDraft = { ...rulesDraft, [k]: !rulesDraft[k] };
        api.sfx('tap');
        render();
        return;
      }
      const cb = e.target.closest('button[data-chip]');
      if (cb && ctx && ctx.canMove) {
        draft = cb.dataset.chip;
        api.sfx('pop');
        paintDraft(true);
        draftSave();
      }
    });
    actions.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || b.disabled || !ctx || !ctx.canMove) return;
      const act = b.dataset.act;
      if (act === 'surprise') {
        const list = poolList(ctx.state);
        let w = draft;
        for (let i = 0; i < 20 && (w === draft || !w); i++) w = list[Math.floor(Math.random() * list.length)];
        draft = w || draft;
        rerollChips(ctx.state, true);
        areaSig = ''; render();
        api.sfx('pop');
        paintDraft(true);
        draftSave();
      } else if (act === 'lock') submit();
      else if (act === 'play') playRules();
      else if (act === 'nextround') { recapSeen[ctx.viewer] = ctx.state.rounds.length; try { localStorage.setItem(RECAP + ctx.matchId, JSON.stringify(recapSeen)); } catch { /* storage may be blocked */ } areaSig = ''; actSig = ''; render(); }
      b.blur();
    });
    // physical keyboard on laptops
    const typingHere = (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return false;
      if (!root.isConnected || document.querySelector('[aria-modal="true"]')) return false; // e.g. a confirm dialog
      const g = root.closest('.gm');
      return !(g && g.querySelector(':scope > .gm-sheet:not([hidden]), :scope > .gm-end:not([hidden]), :scope > .gm-curtain:not([hidden])'));
    };
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (!typingHere(e)) return;
      let k = null;
      if (e.key === 'Enter') k = 'enter';
      else if (e.key === 'Backspace' || e.key === 'Delete') k = 'back';
      else if (/^[a-zA-Z]$/.test(e.key)) k = e.key.toLowerCase();
      if (!k || !ctx || !ctx.canMove) return;
      const m = modeOf(ctx);
      if (m === 'rules' && k === 'enter') { e.preventDefault(); playRules(); return; }
      e.preventDefault();
      press(k);
    };
    document.addEventListener('keydown', onKey);
    // pasting a word (laptop): its letters fill the row
    const onPaste = (e) => {
      if (!ctx || !ctx.canMove || !typingHere(e)) return;
      const m = modeOf(ctx);
      if (m !== 'pick' && m !== 'solve') return;
      const letters = String((e.clipboardData && e.clipboardData.getData('text')) || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
      if (!letters) return;
      e.preventDefault();
      draft = (draft + letters).slice(0, 5);
      api.sfx('pop');
      paintDraft(true);
      draftSave();
    };
    document.addEventListener('paste', onPaste);

    let wasOver = null; // was the match over at the previous update of this mount? (null = first one)
    function maybeRecord(c) {
      if (!c.over || !c.matchId || wasOver === true) return;
      const p = recordMatch(data(), c.state, c.matchId, wasOver === false);
      if (p) setData(p);
    }
    const offData = typeof api.onData === 'function' ? api.onData(() => { if (ctx && ctx.over) render(); else if (ctx) paintHint(); }) : null;

    return {
      update(c) {
        ctx = c;
        const s = c.state;
        const dk = `${c.viewer}|${c.curtain}`;
        if (dk !== draftKey) { draftKey = dk; draft = ''; flip = null; win = null; }
        // If two phones set rules at once, replay order decides (seat a first). Tell the loser.
        if (sentSetup && s.v === 2 && c.viewer && c.mode === 'online') {
          const same = Object.keys(sentSetup).every((k) => s.opts[k] === sentSetup[k]);
          if (!same) { sentSetup = null; api.toast(`${api.name(other(c.me || c.viewer))} set the rules.`); }
        }
        // Which guesses are new since the last update? (core's c.last follows replay order, which puts
        // seat a's moves first, so it can't be trusted to say who just moved.)
        const grew = [];
        const ri = s.rounds ? s.rounds.length : 0;
        if (seen && c.moves > seen.moves) {
          const rv = roundView(s, seen.ri);
          for (const w of ['a', 'b']) {
            const n = rv.guesses[w].length;
            if (n > seen[w] && !(n === 1 && rv.opener && rv.guesses[w][0] === rv.opener)) grew.push({ w, row: n - 1, rv });
          }
        }
        if (c.mode === 'local') {
          if (grew.length && c.curtain && !c.over) {
            hold = { w: grew[grew.length - 1].w, ri: seen.ri };
            holdSave();
            showHold(c, hold, true);
          } else if (!c.curtain || c.over) {
            if (hold) { hold = null; holdSave(); }
            hideHold();
          } else if (!hold) {
            const h = holdLoad(c);
            if (h && holdValid(c, h)) { hold = h; showHold(c, h, false); } else if (h) holdSave();
          }
        }
        for (const { w, row, rv } of grew) {
          if (!c.viewer) continue;
          const solved = rv.guesses[w].includes(rv.secret[other(w)]);
          if (w === c.viewer) startFlip(w, row, solved, true);
          else {
            api.sfx('tick');
            const mm = modeOf(c); // their rows only show full size once I'm done
            if ((mm === 'done' || mm === 'end' || mm === 'recap') && !myFlip()) startFlip(w, row, solved, false);
          }
        }
        if (seen && seen.ri === ri) { seen.a = s.guesses.a.length; seen.b = s.guesses.b.length; seen.moves = c.moves; } else seen = { ri, a: s.guesses.a.length, b: s.guesses.b.length, moves: c.moves };
        let restored = false;
        if (c.over) { draft = ''; draftSave(); maybeRecord(c); }
        else if (!draft && c.canMove) { const m = modeOf(c); if (m === 'pick' || m === 'solve') { draft = draftLoad(c); restored = !!draft; } }
        wasOver = c.over;
        render();
        if (restored) paintDraft();
      },
      destroy() {
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('paste', onPaste);
        if (offData) offData();
        hideHold();
        for (const t of timers) clearTimeout(t);
        timers.clear();
      },
    };
  },
});
