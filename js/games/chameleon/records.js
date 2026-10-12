// Shared records for Blend & Seek: per-person bests, streaks and counters kept in the game's
// shared data doc (api.data() / api.setData(patch), mirrored in localStorage by core.js).
// Keys follow Rail Rush's shape (`${w}_…`, flat, monotonic where it matters). The host records
// every round when the recap starts; both phones read the same doc for the lobby strip, the
// recap's NEW RECORD sticker and the final card.
//
// Rivalry layer (R): the Cup (a travelling trophy), the head-to-head line, the seeker's tendencies
// (what they call / where they find) and the best-hide portrait. All of it is plain `${w}_…` keys
// with `| 0` defaults, so an old doc just reads as zero.
import { esc, fmtTime } from './util.js';
import { SURF_SHORT, CUP_SVG } from './cards.js';
import { portraitImg } from './gallery.js';

const other = (w) => (w === 'a' ? 'b' : 'a');
/** Surface counters worth keeping (where a hider survived). */
export const SURF_KEYS = ['ceiling', 'hang', 'perch', 'squeeze', 'corner', 'wall'];
const surfKey = (surf) => (surf === 'hangHigh' ? 'hang' : surf === 'under' ? 'ceiling' : surf === 'flat' ? 'wall' : surf);
/** Where a hider can be (the seeker's wager zones): `${w}_call_<zone>` / `${w}_found_<zone>` count these. */
export const ZONES = ['floor', 'furniture', 'wall', 'ceiling', 'hang'];
/** A portrait must fit this many characters (the doc is flat and small). */
export const PORTRAIT_MAX = 3000;
/** A hide only counts as a SURVIVAL when the clock ran out on a seeker who still had paint: a seeker
 *  who sprayed all their pellets and gave up (rec.outOfPellets) hands the hider the round's points but
 *  not a survival record, an unlock or a streak step (otherwise a partner could farm the unlocks). */
export const survived = (rec) => !!(rec && rec.hider && !rec.found && !rec.outOfPellets);

/**
 * Fold one finished round into the shared data. Returns { patch, records } where records lists
 * the new bests to celebrate: [{ w, kind, text, sub, title? }].
 *   rec: the round record ({ hider, seeker, found, ms, points, surf, winner, victim, zone, call }),
 *   extra: { mode, map, closest, passes, strokes: { a, b }, stared, called, huntMs, portrait: () => b64 }
 */
export function recordRound(d, rec, extra) {
  const patch = {}; const records = [];
  const g = (k) => d[k] | 0;
  const set = (k, v) => { patch[k] = v; };
  const hs = extra.mode === 'hs';
  const hider = rec.hider; const seeker = rec.seeker || (hider ? other(hider) : null);
  const dry = hs && !!rec.outOfPellets && !rec.found;
  const roundWinner = hs ? (rec.found ? seeker : hider) : rec.winner || null;
  const nm2 = (w) => esc(extra.names && extra.names[w] != null ? extra.names[w] : w);
  for (const w of ['a', 'b']) {
    set(`${w}_rounds`, g(`${w}_rounds`) + 1);
    // streak: consecutive rounds won in either role (a void Double Blind round keeps it). A seeker who
    // ran dry loses theirs; the hider keeps theirs but doesn't step it (no farming unlocks by spraying).
    if (dry) {
      if (w === seeker) set(`${w}_streak`, 0);
    } else if (roundWinner === w) {
      const s = g(`${w}_streak`) + 1; set(`${w}_streak`, s);
      if (s > g(`${w}_streak_best`)) { set(`${w}_streak_best`, s); if (s >= 3) records.push({ w, kind: 'streak', text: `${s} in a row`, sub: 'longest streak' }); }
    } else if (roundWinner) set(`${w}_streak`, 0);
  }
  if (hs && hider) {
    set(`${hider}_hides`, g(`${hider}_hides`) + 1);
    set(`${seeker}_hunts`, g(`${seeker}_hunts`) + 1);
    if (extra.strokes && extra.strokes[hider] > g(`${hider}_strokes`)) set(`${hider}_strokes`, extra.strokes[hider]);
    if ((extra.passes | 0) > g(`${hider}_pass`)) set(`${hider}_pass`, extra.passes | 0);
    if ((extra.stared | 0) > g(`${hider}_stared`)) set(`${hider}_stared`, extra.stared | 0);
    if (extra.called) set(`${seeker}_called`, g(`${seeker}_called`) + 1);
    const sk = surfKey(rec.surf);
    // tendencies: what the seeker CALLED, and where they actually found the hider (zones as in the wager)
    if (ZONES.includes(rec.call)) set(`${seeker}_call_${rec.call}`, g(`${seeker}_call_${rec.call}`) + 1);
    if (rec.found && ZONES.includes(rec.zone)) set(`${seeker}_found_${rec.zone}`, g(`${seeker}_found_${rec.zone}`) + 1);
    // best blend (paint.js scores the lock's paint against its surface, 0..100). The first one ever is
    // celebrated too (from 50 %: a first Sore thumb isn't a record worth a sticker).
    if (Number.isFinite(rec.blend) && rec.blend >= 0 && rec.blend > g(`${hider}_blend`)) {
      const prevB = g(`${hider}_blend`); set(`${hider}_blend`, Math.round(rec.blend));
      if (rec.blend >= 50) records.push({ w: hider, kind: 'blend', text: `${Math.round(rec.blend)}% blend`, sub: `${nm2(hider)}’s best camouflage`, ...(prevB > 0 ? {} : { title: 'FIRST BLEND' }) });
    }
    // Today's hide (maps pass): the longest each of you lasted as the hider in today's setup
    if (extra.daily && !dry) { const k = `${hider}_daily_${extra.daily}`; if ((rec.ms | 0) > g(k)) set(k, rec.ms | 0); }
    if (rec.found) {
      set(`${seeker}_finds`, g(`${seeker}_finds`) + 1);
      const best = d[`${seeker}_find_ms`];
      if (!best || rec.ms < best) {
        set(`${seeker}_find_ms`, rec.ms); set(`${seeker}_find_map`, String(extra.map || ''));
        records.push({ w: seeker, kind: 'find', text: `Found in ${fmtTime(rec.ms)}`, sub: best ? `${nm2(seeker)}’s fastest ever` : `${nm2(seeker)}’s first find`, ...(best ? {} : { title: 'FIRST FIND' }) });
      }
    } else if (dry) {
      // the seeker ran out of paint: the hider keeps the round's points, nothing else is recorded
      set(`${hider}_dry`, g(`${hider}_dry`) + 1);
    } else {
      set(`${hider}_surv`, g(`${hider}_surv`) + 1);
      // the best blend that held up for a whole hunt (Gold eyes): a lock score alone is one tap of Stamp
      if (Number.isFinite(rec.blend) && rec.blend > g(`${hider}_blend_surv`)) set(`${hider}_blend_surv`, Math.round(rec.blend));
      if (sk && SURF_KEYS.includes(sk)) set(`${hider}_surf_${sk}`, g(`${hider}_surf_${sk}`) + 1);
      if (!(extra.passes | 0)) set(`${hider}_ghost`, g(`${hider}_ghost`) + 1);
      const ms = rec.ms | 0; const best = d[`${hider}_surv_ms`] | 0;
      if (ms > best) {
        set(`${hider}_surv_ms`, ms); set(`${hider}_surv_map`, String(extra.map || '')); set(`${hider}_surv_surf`, String(sk || ''));
        records.push({ w: hider, kind: 'surv', text: `Survived ${fmtTime(ms)}`, sub: best ? `${nm2(hider)}’s longest hide` : `${nm2(hider)}’s first survival`, ...(best ? {} : { title: 'FIRST SURVIVAL' }) });
        // the portrait gallery: the skin that lasted longest (≤ 3000 characters, else the old one stays)
        if (typeof extra.portrait === 'function') {
          let blob = ''; try { blob = String(extra.portrait() || ''); } catch { blob = ''; }
          if (blob && blob.length <= PORTRAIT_MAX) { set(`${hider}_portrait`, blob); set(`${hider}_portrait_map`, String(extra.map || '')); set(`${hider}_portrait_ms`, ms); }
        }
      }
    }
  } else if (!hs && rec.winner) {
    set(`${rec.winner}_dbwins`, g(`${rec.winner}_dbwins`) + 1);
    if (rec.ms && (!d[`${rec.winner}_find_ms`] || rec.ms < d[`${rec.winner}_find_ms`])) set(`${rec.winner}_find_ms`, rec.ms);
  }
  return { patch, records };
}

// ── the Cup ──────────────────────────────────────────────────────────────
/** What a finished match does to the Cup (pure): null for a draw; otherwise { kind: 'take' | 'defend',
 *  n: consecutive wins by the holder (1 on a take), from: the previous holder or null }. */
export function cupOutcome(d, winner) {
  if (winner !== 'a' && winner !== 'b') return null;
  const holder = d.cup_holder === 'a' || d.cup_holder === 'b' ? d.cup_holder : null;
  if (holder === winner) return { kind: 'defend', n: (d.cup_defences | 0) + 1, from: holder };
  return { kind: 'take', n: 0, from: holder };
}
/** Match-level counters (host, when the match ends) plus the Cup. `day` = today's key, `abandoned` writes nothing. */
export function recordMatch(d, winner, day = '') {
  const patch = {};
  for (const w of ['a', 'b']) patch[`${w}_matches`] = (d[`${w}_matches`] | 0) + 1;
  if (winner) patch[`${winner}_wins`] = (d[`${winner}_wins`] | 0) + 1;
  const cup = cupOutcome(d, winner);
  if (cup) {
    patch.cup_holder = winner;
    patch.cup_defences = cup.kind === 'defend' ? cup.n : 0;
    patch.cup_day = String(day || '');
    if (cup.kind === 'take') patch[`${winner}_cups`] = (d[`${winner}_cups`] | 0) + 1;
  }
  return patch;
}

const nm = (api, w, text) => `<b class="chm-name-${w}">${esc(text == null ? api.name(w) : text)}</b>`;
const times = (n) => `${n} time${n === 1 ? '' : 's'}`;

/** The Cup as a lobby line: 'Sydney holds the Cup · defended 3×' (or 'The Cup is up for grabs'). */
export function cupLine(api, d) {
  const h = d.cup_holder === 'a' || d.cup_holder === 'b' ? d.cup_holder : null;
  const dn = d.cup_defences | 0;
  const body = h ? `${nm(api, h)} holds it${dn > 0 ? ` · defended ${dn}×` : ' · fresh off a win'}` : 'Up for grabs: win a match';
  return `<div class="chm-cup" data-cup="${h || ''}">${CUP_SVG}<span><b>The Cup</b><small>${body}</small></span></div>`;
}
/** The numbers behind the head-to-head line (host folds them into the recap message so both phones agree). */
export function h2hNumbers(d) {
  return { fa: d.a_finds | 0, sa: d.b_surv | 0, fb: d.b_finds | 0, sb: d.a_surv | 0 };
}
/** 'Emerson has found Sydney 7 times · Sydney has survived Emerson 5' (and the reverse once it has happened). */
export function headToHead(api, d, n = null) {
  const x = n || h2hNumbers(d);
  const one = (hunter, prey, found, lived) => (found || lived) ? `<span>${nm(api, hunter)} has found ${nm(api, prey)} ${times(found)}</span><span>${nm(api, prey)} has survived ${nm(api, hunter)} ${lived}</span>` : '';
  const A = one('a', 'b', x.fa, x.sa); const B = one('b', 'a', x.fb, x.sb);
  if (!A && !B) return '';
  return `<div class="chm-h2h" data-h2h="1">${A ? `<p>${A}</p>` : ''}${B ? `<p>${B}</p>` : ''}</div>`;
}
/** Plain text of the head-to-head (for the label / tests). */
export function headToHeadText(api, d, n = null) {
  return headToHead(api, d, n).replace(/<\/span><span>/g, ' · ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── tendencies ───────────────────────────────────────────────────────────
const CALL_PHRASE = { floor: 'checks the floor first', furniture: 'checks furniture first', wall: 'checks walls first', ceiling: 'looks up at the ceiling first', hang: 'checks for hangers first' };
const FOUND_PHRASE = { floor: 'finds most hiders on the floor', furniture: 'finds most hiders on furniture', wall: 'finds most hiders on walls', ceiling: 'finds most hiders on the ceiling', hang: 'finds most hiders hanging' };
export const TENDENCY_MIN = 5;
/** The seeker's habit as one line for the hider's title card, from past rounds only: "Emerson checks walls
 *  first (6 of 9)". Needs ≥ 5 samples; '' otherwise. Reads counters, never the round in progress. */
export function tendency(d, seeker) {
  for (const [pre, phrase] of [['call', CALL_PHRASE], ['found', FOUND_PHRASE]]) {
    let tot = 0; let top = null; let best = 0;
    for (const z of ZONES) { const c = d[`${seeker}_${pre}_${z}`] | 0; tot += c; if (c > best) { best = c; top = z; } }
    if (tot >= TENDENCY_MIN && top) return { zone: top, n: best, of: tot, kind: pre, phrase: phrase[top] };
  }
  return null;
}
export function tendencyLine(api, d, seeker) {
  const t = tendency(d, seeker);
  return t ? `${esc(api.name(seeker))} ${t.phrase} (${t.n} of ${t.of})` : '';
}

/** Taunt lines for the recap (free from the counters): [] when nothing is worth saying. */
export function recapLines(api, d, rec, extra, records) {
  const out = [];
  const hs = extra.mode === 'hs';
  if (!hs || !rec.hider) return out;
  const hider = rec.hider; const seeker = rec.seeker || other(hider);
  for (const r of records) out.push(`${r.text}: ${r.sub}`);
  if (!rec.found && (extra.passes | 0) >= 2) out.push(`${esc(api.name(seeker))} walked past ${extra.under ? 'under ' : ''}you ${extra.passes} times`);
  else if (!rec.found && extra.under && (extra.passes | 0) === 1) out.push(`${esc(api.name(seeker))} walked right under you`);
  if ((extra.stared | 0) >= 2) out.push(`Stared straight at ${esc(api.name(hider))} ${extra.stared}×`);
  if (extra.called) out.push(`${esc(api.name(seeker))} called it: ${esc(extra.calledWhat || '')}`);
  const st = d[`${seeker}_streak`] | 0; const sh = d[`${hider}_streak`] | 0;
  if (rec.found && st >= 3) out.push(`${esc(api.name(seeker))} is on a ${st}-round streak`);
  if (!rec.found && !rec.outOfPellets && sh >= 3) out.push(`${esc(api.name(hider))} is on a ${sh}-round streak`);
  return out.slice(0, 2);
}

/** One riso line for the lobby card: 'Best hide Sydney 1:28 (ceiling) · Fastest find Emerson 0:12 · Streak Emerson ×3'.
 *  The bits are flex-wrapped spans (CSS gap), never text separators, so a wrap can't strand a dot. */
export function bestsStrip(api, d, mapNames = {}) {
  const bits = [];
  const bestOf = (key) => { const a = d[`a_${key}`] | 0; const b = d[`b_${key}`] | 0; return a || b ? (a >= b ? 'a' : 'b') : null; };
  const hw = bestOf('surv_ms');
  if (hw) { const sf = d[`${hw}_surv_surf`]; bits.push(`<span>Best hide ${nm(api, hw)} ${fmtTime(d[`${hw}_surv_ms`] | 0)}${sf && SURF_SHORT[sf] ? ` <em>${esc(SURF_SHORT[sf])}</em>` : ''}</span>`); }
  let fw = null; for (const w of ['a', 'b']) if (d[`${w}_find_ms`] && (!fw || d[`${w}_find_ms`] < d[`${fw}_find_ms`])) fw = w;
  if (fw) bits.push(`<span>Fastest find ${nm(api, fw)} ${fmtTime(d[`${fw}_find_ms`] | 0)}</span>`);
  const bw = bestOf('blend');
  if (bw && (d[`${bw}_blend`] | 0) >= 50) bits.push(`<span>Best blend ${nm(api, bw)} ${d[`${bw}_blend`] | 0}%</span>`);
  const sw = bestOf('streak');
  if (sw && (d[`${sw}_streak`] | 0) >= 2) bits.push(`<span>Streak ${nm(api, sw)} ×${d[`${sw}_streak`] | 0}</span>`);
  void mapNames;
  const rival = rivalryBlock(api, d);
  if (!bits.length && !rival) return '';
  return `${rival}${bits.length ? `<div class="chm-bests">${bits.join('')}</div>` : ''}`;
}
/** The Cup, the head-to-head and the best-hide portraits, as one lobby block (empty until there's something to show). */
export function rivalryBlock(api, d) {
  const h2h = headToHead(api, d);
  const holder = d.cup_holder === 'a' || d.cup_holder === 'b';
  const pics = ['a', 'b'].filter((w) => d[`${w}_portrait`]).map((w) => portraitFig(api, d, w)).join('');
  const matches = (d.a_matches | 0) + (d.b_matches | 0);
  if (!h2h && !holder && !pics && !matches) return '';
  return `<div class="chm-rivalry">${cupLine(api, d)}${h2h}${pics ? `<div class="chm-gallery">${pics}</div>` : ''}</div>`;
}
/** One framed portrait: the skin of a player's best surviving hide, flat. */
export function portraitFig(api, d, w, mapName = '') {
  const blob = d[`${w}_portrait`]; if (!blob) return '';
  const img = portraitImg(String(blob), w);
  const ms = d[`${w}_portrait_ms`] | 0;
  const cap = `${esc(api.name(w))} ${fmtTime(ms)}`;
  return `<figure class="chm-port p${w}" data-portrait="${w}">${img || '<span class="chm-port-ph"></span>'}<figcaption>${cap}${mapName ? ` <em>${esc(mapName)}</em>` : ''}</figcaption></figure>`;
}

/** Today's board (maps pass): 'Today: Emerson 0:41 · Sydney 1:10 · Sydney leads', or '' if
 *  nobody has played today's hide yet. */
export function dailyLine(api, d, day) {
  const t = { a: d[`a_daily_${day}`] | 0, b: d[`b_daily_${day}`] | 0 };
  if (!t.a && !t.b) return '';
  const bits = ['a', 'b'].filter((w) => t[w]).map((w) => `<span>${nm(api, w)} ${fmtTime(t[w])}</span>`);
  const lead = t.a && t.b && t.a !== t.b ? (t.a > t.b ? 'a' : 'b') : null;
  return `<div class="chm-bests chm-daily"><span class="chm-daily-k">Today</span>${bits.join('')}${lead ? `<span>${nm(api, lead)} leads</span>` : ''}</div>`;
}

/** The match story for the final card. Hide & Seek: per-round bars, Best hide (survived hides only),
 *  Longest hide (any), fastest find, best blend. Double Blind (nobody 'hides' for a score): who won
 *  each round and how fast the tag was. */
export function matchStory(api, hist, mapName, mode = 'hs') {
  if (mode === 'db') return dbStory(api, hist);
  const rounds = hist.filter((r) => r && r.hider);
  if (!rounds.length) return { bars: '', lines: [] };
  const lived = rounds.filter((r) => survived(r));
  const bestHide = lived.length ? lived.reduce((b, r) => (!b || r.ms > b.ms ? r : b), null) : null;
  const longest = rounds.reduce((b, r) => (!b || r.ms > b.ms ? r : b), null);
  const found = rounds.filter((r) => r.found);
  const fastest = found.length ? found.reduce((b, r) => (!b || r.ms < b.ms ? r : b), null) : null;
  const blended = rounds.filter((r) => Number.isFinite(r.blend) && r.blend >= 0);
  const bestBlend = blended.length ? blended.reduce((b, r) => (!b || r.blend > b.blend ? r : b), null) : null;
  const maxMs = Math.max(1, ...rounds.map((r) => r.ms | 0));
  const bars = rounds.map((r) => {
    const pct = Math.max(6, Math.round((r.ms / maxMs) * 100));
    return `<div class="chm-tl-row"><span class="chm-tl-n">R${r.round}</span><div class="chm-tl-bar"><i class="p${r.hider}" style="width:${pct}%">${r === bestHide && rounds.length > 1 ? '<b>★</b>' : ''}${r.found ? '<em>✦</em>' : ''}</i></div><span class="chm-tl-t">${fmtTime(r.ms | 0)}</span></div>`;
  }).join('');
  const lines = [];
  const surfTxt = (r) => (r.surf && SURF_SHORT[surfKey(r.surf)] ? ` ${esc(SURF_SHORT[surfKey(r.surf)])}` : '');
  if (bestHide) lines.push(`<span class="chm-bh">Best hide: ${nm(api, bestHide.hider)} ${fmtTime(bestHide.ms | 0)}${surfTxt(bestHide)} (survived)</span>`);
  // the longest hide of the night, when it wasn't a survival (found late, or the seeker ran dry)
  if (longest && longest !== bestHide && (!bestHide || (longest.ms | 0) > (bestHide.ms | 0))) lines.push(`<span class="chm-lh">Longest hide: ${nm(api, longest.hider)} ${fmtTime(longest.ms | 0)} (${longest.found ? 'found' : 'seeker ran dry'})</span>`);
  if (fastest) lines.push(`<span>Fastest find: ${nm(api, fastest.seeker || other(fastest.hider))} ${fmtTime(fastest.ms | 0)}</span>`);
  if (bestBlend && bestBlend.blend >= 40) lines.push(`<span class="chm-bb">Best blend: ${nm(api, bestBlend.hider)} ${Math.round(bestBlend.blend)}%</span>`);
  const passes = rounds.reduce((n, r) => n + (r.passes | 0), 0);
  if (passes) lines.push(`<span>${passes} walk-past${passes === 1 ? '' : 's'} on ${esc(mapName || 'the map')}</span>`);
  return { bars, lines };
}
/** Double Blind's story: a bar per round in the winner's ink (void rounds are hollow), 'Rounds won' and the fastest tag. */
function dbStory(api, hist) {
  const rounds = (hist || []).filter((r) => r && (r.winner || r.winner === null) && r.round);
  if (!rounds.length) return { bars: '', lines: [] };
  const maxMs = Math.max(1, ...rounds.map((r) => r.ms | 0));
  const bars = rounds.map((r) => {
    const pct = Math.max(6, Math.round(((r.ms | 0) / maxMs) * 100));
    return `<div class="chm-tl-row"><span class="chm-tl-n">R${r.round}</span><div class="chm-tl-bar"><i class="${r.winner ? `p${r.winner}` : 'void'}" style="width:${pct}%">${r.winner ? '<em>✦</em>' : ''}</i></div><span class="chm-tl-t">${r.winner ? fmtTime(r.ms | 0) : 'void'}</span></div>`;
  }).join('');
  const lines = [];
  const won = { a: 0, b: 0 }; for (const r of rounds) if (r.winner) won[r.winner]++;
  const voids = rounds.filter((r) => !r.winner).length;
  lines.push(`<span class="chm-rw"><em>Rounds won</em><span>${nm(api, 'a')} ${won.a}</span><span>${nm(api, 'b')} ${won.b}</span>${voids ? `<span>${voids} void</span>` : ''}</span>`);
  const tagged = rounds.filter((r) => r.winner && r.ms);
  const fast = tagged.length ? tagged.reduce((b, r) => (!b || r.ms < b.ms ? r : b), null) : null;
  if (fast) lines.push(`<span>Fastest tag: ${nm(api, fast.winner)} ${fmtTime(fast.ms | 0)}</span>`);
  return { bars, lines };
}
