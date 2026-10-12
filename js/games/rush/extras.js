// Rail Rush extras: the Daily's twist of the day, three dares a day with weekly stamps, love notes
// and the unlocks that come with them. Mostly logic plus its own small DOM (the lobby block, the
// note card); game.js calls the hooks at the bottom (begin / reset / afterStep / afterSync / onPick /
// finale / lobbyTick …). Nothing here touches the simulation or the track's gameplay.
import { hash } from '../core.js';
import { makePalette } from './gfx.js';
import { districtOf } from './track.js';
import { E_BONUS } from './sim.js';

// ── the twist of the day (Daily only) ──
export const MODS = [
  { name: 'Plain track', tip: '' },
  { name: 'Mirror', tip: 'Left is right, right is left' },
  { name: 'Fog', tip: 'You only see 40 to 110 m ahead' },
  { name: 'Night', tip: 'Lights out, same track' },
  { name: 'Blind coins', tip: 'Coins only show up close' },
  { name: 'Double ladder', tip: 'Combo payouts count double' },
  { name: 'Gold rush', tip: 'Twice the fool’s gold' },
];
/** Which twist a calendar day (YYYY-MM-DD) brings: 0 plain … 6 gold rush. */
export function dailyMod(day) { return (hash('rush-daily-mod', day) >>> 0) % MODS.length; }
const FOG_NEAR = 40; const FOG_FAR = 110; // Fog: where the haze starts and where it's solid
const BLIND_M = 28;                       // Blind coins: coins further than this are hidden
const GOLD_P2 = 0.7;                      // Gold rush: branch chance (twice the usual 0.35)

// ── dares ──
// Each is judged at the finale from the run's stats `s`.
export const DARES = [
  { t: 'Pull off a x5 combo', s: 'x5 combo', ok: (s) => s.maxCombo >= 5 },
  { t: '10 close calls in one run', s: '10 close calls', ok: (s) => s.closeCalls >= 10 },
  { t: 'Collect 120 coins in one run', s: '120 coins', ok: (s) => s.coins >= 120 },
  { t: 'Finish a Race on 3 hearts', s: 'Race on 3 hearts', ok: (s) => s.mode === 'race' && s.fin >= 0 && s.hearts >= 3 },
  { t: 'Revive your partner twice', s: '2 revives', ok: (s) => s.revives >= 2 },
  { t: 'Run past your partner’s best', s: 'past their best', ok: (s) => s.beat },
  { t: 'Grab a gold branch', s: 'gold branch', ok: (s) => s.branches >= 1 },
  { t: 'Land 3 shoves in Brawl', s: '3 shoves', ok: (s) => s.shoves >= 3 },
  { t: 'Reach 1.5 km in the Daily', s: '1.5 km Daily', ok: (s) => s.mode === 'daily' && s.dist >= 1500 },
  { t: 'Use 3 weapons in a Race', s: '3 weapons', ok: (s) => s.uses >= 3 },
  { t: 'Find a love note', s: 'love note', ok: (s) => s.notes >= 1 },
  { t: 'Swap the lead twice', s: '2 lead changes', ok: (s) => s.leads >= 2 },
];
/** The day's three dares (indexes into DARES, distinct), the same on both phones. */
export function daresOf(day) {
  const left = DARES.map((_, i) => i); const out = [];
  for (let k = 0; k < 3; k++) out.push(left.splice((hash('rush-dare', day, k) >>> 0) % left.length, 1)[0]);
  return out;
}
const dayShift = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};
/** ISO week of a calendar day: '2026-W42'. */
export function isoWeek(day) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); // the Thursday of this week decides the year
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const wk = 1 + Math.round(((t - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}
export const stampKey = (w, day) => `${w}_stamps_${isoWeek(day)}_n`;
const TROPHY_STAMPS = 7;

// ── love notes ──
export const NOTE_MAX = 60;
export const NOTE_LINES = [
  'Race you to the bakery.', 'You run like a train that likes you.', 'Left lane, right lane, my lane.',
  'I would jump a barrier for you. Twice.', 'Coins are fine. You are better.', 'Save me a seat on the next train.',
  'Beat my best. I dare you, gently.', 'Roll under it like it owes you money.', 'Tonight you pick the snack.',
  'Bonus coins if you smile right now.', 'I am not slow, I am sightseeing.', 'Next stop: a hug.',
  'You make a very good tailwind.', 'Dodge everything. Except me.', 'First one home picks the movie.',
  'Close call? Close to you, always.', 'Tell me your best combo tonight.', 'Even your crashes are cute.',
  'Run fast, come back faster.', 'This note is worth 0 coins and all of my love.',
];
/** User text in, safe single line out (rendered with textContent only; control and bidi characters dropped). */
export function cleanNote(s) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, NOTE_MAX).join('');
}

const ENV = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="var(--g-card)" stroke="currentColor" stroke-width="2"/><path d="M3.2 7.2 12 13.6l8.8-6.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

/**
 * C: { live, split, meW, locals, M, players, root, data(), setData(p), name(w), other(w), audio, world(), palette(),
 *      tokens(), dbg, later(fn, ms) }
 */
export function createExtras(C) {
  const other = C.other;
  let mod = 0;           // the running match's twist
  let mirror = false;    // Mirror: the world is drawn flipped and left / right swap (read by game.js)
  let night = false;     // the dark palette is on for this run
  let fog0 = null;       // the world's own fog distances, restored after Fog
  let darkP = null;
  const uses = { a: 0, b: 0 };       // weapons fired this run
  const found = { a: null, b: null }; // the note each runner found this run { from, mine }
  const beatAt = { a: 0, b: 0 };      // the partner's best for this mode when the run began (for "run past their best")
  const lead = { side: 0, cand: 0, t: 0, n: 0 };
  const notePop = { a: 0, b: 0 };

  // ── lobby block ──
  let host = null; let ui = null; let sig = ''; let editing = null; let flash = null; // flash: the chip's "Note saved" for a moment (the preview line is hidden on phones)
  const myW = () => (C.live ? C.meW : 'a');
  const noteOf = (w) => cleanNote(C.data()[`${w}_note`]);
  const bitsOf = (w, day) => C.data()[`${w}_dare_${day}`] | 0;
  const stampsOf = (w, day) => C.data()[stampKey(w, day)] | 0;

  function build(slot) {
    slot.innerHTML = `<div class="rr-dares"><div class="rr-dares-h"><b>Today’s dares</b><span class="rr-dares-who"></span></div><ul class="rr-dares-l"></ul><div class="rr-dares-f"></div></div>
      <div class="rr-notes"></div>
      <form class="rr-note-ed" hidden><input class="rr-note-in" type="text" autocomplete="off" autocapitalize="sentences" enterkeyhint="done" spellcheck="true" aria-label="Your note"><button class="rr-note-save" type="submit">Save</button><span class="rr-note-ct" aria-live="polite"></span><button class="rr-note-x" type="button">Cancel</button></form>`;
    ui = {
      who: slot.querySelector('.rr-dares-who'), list: slot.querySelector('.rr-dares-l'), foot: slot.querySelector('.rr-dares-f'),
      notes: slot.querySelector('.rr-notes'), ed: slot.querySelector('.rr-note-ed'), inp: slot.querySelector('.rr-note-in'), ct: slot.querySelector('.rr-note-ct'),
    };
    ui.ed.addEventListener('submit', (e) => { e.preventDefault(); saveNote(); });
    // (the game's key handler ignores typing in an input; nothing on the input itself is prevented, so iOS can place the caret and compose freely)
    // the limit counts code points (an emoji is one), like cleanNote; a maxlength attribute would count UTF-16 units
    const clip = (live) => {
      const cps = Array.from(ui.inp.value);
      if (cps.length > NOTE_MAX && !live) { ui.inp.value = cps.slice(0, NOTE_MAX).join(''); try { ui.inp.setSelectionRange(ui.inp.value.length, ui.inp.value.length); } catch { /* ignore */ } }
      ui.ct.textContent = `${Math.min(cps.length, NOTE_MAX)}/${NOTE_MAX}`;
    };
    ui.inp.addEventListener('input', (e) => clip(e.isComposing));
    ui.inp.addEventListener('compositionend', () => clip(false));
    ui.ed.querySelector('.rr-note-x').addEventListener('click', () => closeNote());
    slot.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-note]');
      if (!b) return;
      openNote(b.dataset.note);
    });
  }
  function openNote(w) {
    if (editing === w) { closeNote(); return; }
    editing = w; sig = '';
    ui.inp.value = noteOf(w);
    ui.ct.textContent = `${Array.from(ui.inp.value).length}/${NOTE_MAX}`;
    ui.inp.placeholder = `A line for ${C.name(other(w))} to find on the track`;
    ui.ed.hidden = false;
    ui.ed.dataset.w = w;
    try { ui.inp.focus(); } catch { /* ignore */ }
  }
  function closeNote() { editing = null; sig = ''; if (ui) { ui.ed.hidden = true; try { ui.inp.blur(); } catch { /* ignore */ } } }
  function saveNote() {
    const w = editing; if (!w) return;
    const text = cleanNote(ui.inp.value);
    C.setData({ [`${w}_note`]: text });
    flash = { w, text: text ? 'Note saved ✓' : 'Note cleared' };
    C.later(() => { if (flash && flash.w === w) { flash = null; sig = ''; } }, 2600);
    closeNote();
  }
  const tick = (el, w, on) => { el.className = `rr-ck ${w}${on ? ' on' : ''}`; };

  function lobbyTick(ov, day) {
    const slot = ov && ov.querySelector('[data-r="xtra"]');
    if (!slot) return;
    if (host !== slot) { host = slot; ui = null; build(slot); sig = ''; }
    const ds = daresOf(day);
    const split = C.split;
    const ba = bitsOf('a', day); const bb = bitsOf('b', day);
    const sa = stampsOf('a', day); const sb = stampsOf('b', day);
    const me = myW();
    const authors = split ? ['a', 'b'] : [me];
    const s = `${day}|${ba}|${bb}|${sa}|${sb}|${authors.map((w) => noteOf(w)).join('\n')}|${editing}|${flash ? flash.w + flash.text : ''}|${C.name('a')}|${C.name('b')}`;
    if (s === sig) return;
    sig = s;
    // dares: one line each, a check circle per player
    ui.who.textContent = '';
    for (const w of ['a', 'b']) {
      const i = document.createElement('i'); i.className = `rr-ck lg ${w}`; ui.who.appendChild(i);
      ui.who.appendChild(document.createTextNode(`${C.name(w)} `));
    }
    ui.list.textContent = '';
    ds.forEach((di, k) => {
      const li = document.createElement('li');
      for (const w of ['a', 'b']) { const c = document.createElement('i'); tick(c, w, !!(((w === 'a' ? ba : bb) >> k) & 1)); li.appendChild(c); }
      const t = document.createElement('span'); t.textContent = DARES[di].t; li.appendChild(t);
      ui.list.appendChild(li);
    });
    ui.foot.textContent = sa + sb > 0
      ? `Stamps this week: ${C.name('a')} ${sa} · ${C.name('b')} ${sb}`
      : `Every dare is a stamp. ${TROPHY_STAMPS} in a week earns the Trophy hat.`;
    // note chips
    ui.notes.textContent = '';
    for (const w of authors) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = `rr-note-chip ${w}${editing === w ? ' open' : ''}`; b.dataset.note = w;
      b.setAttribute('aria-expanded', editing === w ? 'true' : 'false');
      const ic = document.createElement('span'); ic.className = 'rr-note-ic'; ic.innerHTML = ENV; b.appendChild(ic);
      const tx = document.createElement('span'); tx.className = 'rr-note-tx';
      const h = document.createElement('b'); const cur = noteOf(w);
      const fl = flash && flash.w === w ? flash.text : '';
      h.textContent = fl || `Note for ${C.name(other(w))}${cur ? ' ✓' : ''}`; tx.appendChild(h);
      if (fl) b.classList.add('saved');
      const p = document.createElement('small'); p.textContent = cur || 'Waits for them on the track'; tx.appendChild(p);
      b.appendChild(tx); ui.notes.appendChild(b);
    }
    if (editing && !authors.includes(editing)) closeNote();
  }

  // ── visuals ──
  function applyVisuals() {
    const wd = C.world(); if (!wd) return;
    const root = C.root;
    root.classList.toggle('rr-mirror', mirror);
    const fog = wd.scene && wd.scene.fog;
    if (fog) {
      if (!fog0) fog0 = { near: fog.near, far: fog.far };
      fog.near = mod === 2 ? FOG_NEAR : fog0.near; fog.far = mod === 2 ? FOG_FAR : fog0.far;
    }
    const P = C.palette();
    if (mod === 3 && P && !P.dark) {
      if (!darkP) darkP = makePalette(Object.assign({}, C.tokens(), { bg: '#141317', card: '#1f1e24', ink: '#f1ece2', muted: '#a39eaa', hl: '#ffe14d', good: '#3ccb7f', bad: '#ff6b78', a: '#3fa7f5', b: '#ff5cb8', dark: true }));
      wd.setPalette(darkP); night = true;
    } else if (night) { wd.setPalette(P); night = false; }
    wd.setCoinAhead(mod === 4 ? BLIND_M : Infinity); // Blind coins: both coin meshes (near and far) stop at 28 m
  }

  // ── the note card ──
  function showNote(w, from, text) {
    const v = C.players[w].view; if (!v || !v.el) return;
    let el = v.el.querySelector('.rr-lnote');
    if (!el) {
      el = document.createElement('div'); el.className = 'rr-lnote';
      el.innerHTML = `<span class="rr-note-ic">${ENV}</span><span class="rr-lnote-t"><b></b><span></span></span>`;
      v.el.appendChild(el);
    }
    el.querySelector('b').textContent = from ? `${from} left you a note` : 'A note for you';
    el.querySelector('.rr-lnote-t > span').textContent = text;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); // restart the pop
    const n = ++notePop[w];
    C.later(() => { if (notePop[w] === n) el.classList.remove('on'); }, 3000);
  }

  const X = {
    get mod() { return mod; },
    get mirror() { return mirror; },
    MODS, DARES, dailyMod, daresOf, isoWeek, cleanNote,
    /** The twist the host sends in `start` for a mode on a day (test override: __RUSH_DEBUG.mod). */
    modFor(mode, day) {
      if (mode !== 'daily') return 0;
      const o = C.dbg && C.dbg.mod;
      return typeof o === 'number' && o >= 0 && o < MODS.length ? o | 0 : dailyMod(day);
    },
    /** Match start: read the twist from the `start` / `rejoin` message, set the scene. Returns the track options (Gold rush). */
    begin(mode, info, trackV) {
      const m = info && typeof info.mod === 'number' ? info.mod | 0 : 0;
      mod = mode === 'daily' && m > 0 && m < MODS.length ? m : 0;
      mirror = mod === 1;
      uses.a = uses.b = 0; found.a = found.b = null; notePop.a = notePop.b = 0;
      lead.side = 0; lead.cand = 0; lead.t = 0; lead.n = 0;
      const d = C.data();
      for (const w of ['a', 'b']) beatAt[w] = d[`${other(w)}_${mode}_m`] | 0;
      closeNote();
      applyVisuals();
      return mod === 6 && trackV >= 2 ? { goldP: GOLD_P2 } : null;
    },
    /** Back in the lobby (or torn down): everything the twist changed goes back. */
    reset() {
      mod = 0; mirror = false;
      if (C.world()) applyVisuals();
    },
    /** "Today: Mirror" for the countdown sub-line. */
    countLabel() { return mod > 0 ? ` · Today: ${MODS[mod].name}` : ''; },
    /** The Daily tile's text for today: the twist, then the board. */
    dailyTile(board, day) {
      const m = dailyMod(day);
      if (!m) return board;
      return `<i class="rr-modl">Twist of the day: ${MODS[m].name}</i><i class="rr-modt">${MODS[m].tip}</i>${board ? `<i class="rr-modb">${board}</i>` : ''}`;
    },
    lobbyTick,
    /** A direction input in a mirrored world. */
    swap(a, L, Rr) { return mirror ? (a === L ? Rr : a === Rr ? L : a) : a; },
    /** After each sim step of a local runner: Double ladder pays combo bonuses twice (the sim stays as is). */
    afterStep(r) {
      if (mod !== 5 || !r.evN) return;
      for (let i = 0; i < r.evN; i++) {
        if (r.evT[i] === E_BONUS) { const v = r.evV[i]; r.coins += v; r.bonus += v; r.evV[i] = v * 2; }
      }
    },
    /** (Blind coins is world.setCoinAhead now, applied inside syncView; nothing to do after it.) */
    afterSync() {},
    /** Called every unpaused frame in a run: counts lead changes (4 m apart, held 0.6 s) for the "swap the lead" dare. */
    tick(dt) {
      const a = C.players.a.rs; const b = C.players.b.rs;
      if (a.idle || b.idle) return;
      const gap = a.z - b.z;
      const side = gap > 4 ? 1 : gap < -4 ? -1 : 0;
      if (side && side !== lead.side) {
        if (lead.cand !== side) { lead.cand = side; lead.t = 0; }
        lead.t += dt;
        if (lead.t >= 0.6) { if (lead.side) lead.n++; lead.side = side; lead.cand = 0; lead.t = 0; }
      } else { lead.cand = 0; lead.t = 0; }
    },
    get leads() { return lead.n; },
    used(w) { uses[w]++; },
    /** The pickup hook (drain): kind 6 = the love note's envelope. */
    onPick(w, kind) {
      if (kind !== 6) return;
      const q = other(w);
      const mine = noteOf(q);
      const text = mine || NOTE_LINES[(hash('rush-note', C.M.seed, w) >>> 0) % NOTE_LINES.length];
      found[w] = { from: C.name(q), mine: !!mine };
      showNote(w, mine ? C.name(q) : '', text);
      C.audio.play('heart');
    },

    /**
     * Finale for one local runner: judges the dares, counts notes, stamps, and fills S (the unlock tests' inputs).
     * Adds to `patch` (shared data) and returns the lines for the end card.
     */
    finale(w, S, patch, p, r, d, res) {
      const M = C.M; const q = other(w);
      const day = M.day;
      const lines = [];
      const dist = Math.round(r.z);
      // unlock inputs
      S.branches = r.branches | 0;
      S.neon = reachedNeon(M.seed, dist);
      S.notesTotal = (d[`${w}_notes_n`] | 0) + (r.notes | 0);
      if (r.notes > 0) patch[`${w}_notes_n`] = S.notesTotal;
      // dares
      const ds = daresOf(day);
      const st = {
        mode: M.mode, dist, coins: r.coins, maxCombo: r.maxCombo, closeCalls: r.closeCalls, hearts: r.hearts, fin: r.fin,
        revives: p.stats.revives | 0, shoves: p.stats.shoves | 0, uses: uses[w], notes: r.notes | 0, branches: r.branches | 0,
        beat: beatAt[w] > 0 && dist > beatAt[w], leads: lead.n,
      };
      const key = `${w}_dare_${day}`;
      const have = patch[key] !== undefined ? patch[key] | 0 : d[key] | 0;
      let add = 0; const done = [];
      ds.forEach((di, k) => { if (!((have >> k) & 1) && DARES[di].ok(st)) { add |= 1 << k; done.push(DARES[di]); } });
      const sk = stampKey(w, day);
      const stamps = (d[sk] | 0) + done.length;
      if (add) { patch[key] = have | add; patch[sk] = stamps; }
      // the Trophy hat: 7 stamps this week, or more stamps than your partner last week
      const lw = isoWeek(dayShift(day, -7));
      const mineLast = d[`${w}_stamps_${lw}_n`] | 0; const theirLast = d[`${q}_stamps_${lw}_n`] | 0;
      S.trophy = stamps >= TROPHY_STAMPS || (mineLast > 0 && mineLast > theirLast);
      // celebration (never the misses)
      const v = p.view;
      if (v && done.length) {
        done.forEach((dr, i) => C.later(() => { v.pop('DARE DONE', 'good', dr.s); C.audio.play('good'); }, 400 + i * 550));
        lines.push(`Dare done: ${done.map((x) => x.s).join(' · ')}`);
      }
      if (v && found[w]) lines.push(`${C.split ? C.name(w) : 'You'} found ${found[w].mine ? `${found[w].from}’s note` : 'a love note'}`);
      return lines;
    },
    /** (Gold dust and Love hearts are fx.trailFx kinds 5 and 6 now: nothing to fake. game.js may drop its X.trail call.) */
    trail() { return false; },
    debug() { return { mod, mirror, night, uses: { ...uses }, leads: lead.n, found: { a: found.a, b: found.b }, beatAt: { ...beatAt }, blind: mod === 4 }; },
  };

  function reachedNeon(seed, dist) {
    const NEON = 4;
    for (let i = 0, n = Math.floor(dist / 100); i <= n; i++) if (districtOf(seed, i) === NEON) return true;
    return false;
  }
  return X;
}
