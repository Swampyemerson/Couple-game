// Shared records for Blend & Seek: per-person bests, streaks and counters kept in the game's
// shared data doc (api.data() / api.setData(patch), mirrored in localStorage by core.js).
// Keys follow Rail Rush's shape (`${w}_…`, flat, monotonic where it matters). The host records
// every round when the recap starts; both phones read the same doc for the lobby strip, the
// recap's NEW RECORD sticker and the final card.
import { esc, fmtTime } from './util.js';
import { SURF_SHORT } from './cards.js';

const other = (w) => (w === 'a' ? 'b' : 'a');
/** Surface counters worth keeping (where a hider survived). */
export const SURF_KEYS = ['ceiling', 'hang', 'perch', 'squeeze', 'corner', 'wall'];
const surfKey = (surf) => (surf === 'hangHigh' ? 'hang' : surf === 'under' ? 'ceiling' : surf === 'flat' ? 'wall' : surf);

/**
 * Fold one finished round into the shared data. Returns { patch, records } where records lists
 * the new bests to celebrate: [{ w, kind, text, sub }].
 *   rec: the round record ({ hider, seeker, found, ms, points, surf, winner, victim }),
 *   extra: { mode, map, closest, passes, strokes: { a, b }, stared, called, huntMs }
 */
export function recordRound(d, rec, extra) {
  const patch = {}; const records = [];
  const g = (k) => d[k] | 0;
  const set = (k, v) => { patch[k] = v; };
  const hs = extra.mode === 'hs';
  const hider = rec.hider; const seeker = rec.seeker || (hider ? other(hider) : null);
  const roundWinner = hs ? (rec.found ? seeker : hider) : rec.winner || null;
  for (const w of ['a', 'b']) {
    set(`${w}_rounds`, g(`${w}_rounds`) + 1);
    // streak: consecutive rounds won in either role (a void Double Blind round keeps it)
    if (roundWinner === w) {
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
    // best blend (paint.js scores the lock's paint against its surface, 0..100)
    if (Number.isFinite(rec.blend) && rec.blend >= 0 && rec.blend > g(`${hider}_blend`)) {
      const prevB = g(`${hider}_blend`); set(`${hider}_blend`, Math.round(rec.blend));
      if (prevB > 0 && rec.blend >= 50) records.push({ w: hider, kind: 'blend', text: `${Math.round(rec.blend)}% blend`, sub: `${esc(extra.names[hider])}’s best camouflage` });
    }
    // Today's hide (maps pass): the longest each of you lasted as the hider in today's setup
    if (extra.daily) { const k = `${hider}_daily_${extra.daily}`; if ((rec.ms | 0) > g(k)) set(k, rec.ms | 0); }
    if (rec.found) {
      set(`${seeker}_finds`, g(`${seeker}_finds`) + 1);
      const best = d[`${seeker}_find_ms`];
      if (!best || rec.ms < best) {
        set(`${seeker}_find_ms`, rec.ms); set(`${seeker}_find_map`, String(extra.map || ''));
        if (best) records.push({ w: seeker, kind: 'find', text: `Found in ${fmtTime(rec.ms)}`, sub: `${esc(extra.names[seeker])}’s fastest ever` });
      }
    } else {
      set(`${hider}_surv`, g(`${hider}_surv`) + 1);
      // the best blend that held up for a whole hunt (Gold eyes): a lock score alone is one tap of Stamp
      if (Number.isFinite(rec.blend) && rec.blend > g(`${hider}_blend_surv`)) set(`${hider}_blend_surv`, Math.round(rec.blend));
      if (sk && SURF_KEYS.includes(sk)) set(`${hider}_surf_${sk}`, g(`${hider}_surf_${sk}`) + 1);
      if (!(extra.passes | 0)) set(`${hider}_ghost`, g(`${hider}_ghost`) + 1);
      const ms = rec.ms | 0; const best = d[`${hider}_surv_ms`] | 0;
      if (ms > best) {
        set(`${hider}_surv_ms`, ms); set(`${hider}_surv_map`, String(extra.map || '')); set(`${hider}_surv_surf`, String(sk || ''));
        if (best) records.push({ w: hider, kind: 'surv', text: `Survived ${fmtTime(ms)}`, sub: `${esc(extra.names[hider])}’s longest hide` });
      }
    }
  } else if (!hs && rec.winner) {
    set(`${rec.winner}_dbwins`, g(`${rec.winner}_dbwins`) + 1);
    if (rec.ms && (!d[`${rec.winner}_find_ms`] || rec.ms < d[`${rec.winner}_find_ms`])) set(`${rec.winner}_find_ms`, rec.ms);
  }
  return { patch, records };
}

/** Match-level counters (host, when the match ends). */
export function recordMatch(d, winner) {
  const patch = {};
  for (const w of ['a', 'b']) patch[`${w}_matches`] = (d[`${w}_matches`] | 0) + 1;
  if (winner) patch[`${winner}_wins`] = (d[`${winner}_wins`] | 0) + 1;
  return patch;
}

const nm = (api, w, text) => `<b class="chm-name-${w}">${esc(text == null ? api.name(w) : text)}</b>`;
/** One riso line for the lobby card: 'Best hide Sydney 1:28 (ceiling) · Fastest find Emerson 0:12 · Streak Emerson ×3'. */
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
  if (!bits.length) return '';
  return `<div class="chm-bests">${bits.join('<i>·</i>')}</div>`;
}

/** Today's board (maps pass): 'Today: Emerson 0:41 · Sydney 1:10 · Sydney leads', or '' if
 *  nobody has played today's hide yet. */
export function dailyLine(api, d, day) {
  const t = { a: d[`a_daily_${day}`] | 0, b: d[`b_daily_${day}`] | 0 };
  if (!t.a && !t.b) return '';
  const bits = ['a', 'b'].filter((w) => t[w]).map((w) => `<span>${nm(api, w)} ${fmtTime(t[w])}</span>`);
  const lead = t.a && t.b && t.a !== t.b ? (t.a > t.b ? 'a' : 'b') : null;
  return `<div class="chm-bests chm-daily"><span class="chm-daily-k">Today</span>${bits.join('<i>·</i>')}${lead ? `<i>·</i><span>${nm(api, lead)} leads</span>` : ''}</div>`;
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
  if (!rec.found && sh >= 3) out.push(`${esc(api.name(hider))} is on a ${sh}-round streak`);
  return out.slice(0, 2);
}

/** The match story for the final card: best hide / fastest find / per-round bars. */
export function matchStory(api, hist, mapName) {
  const rounds = hist.filter((r) => r && r.hider);
  if (!rounds.length) return { bars: '', lines: [] };
  const longest = rounds.reduce((b, r) => (!b || r.ms > b.ms ? r : b), null);
  const found = rounds.filter((r) => r.found);
  const fastest = found.length ? found.reduce((b, r) => (!b || r.ms < b.ms ? r : b), null) : null;
  const blended = rounds.filter((r) => Number.isFinite(r.blend) && r.blend >= 0);
  const bestBlend = blended.length ? blended.reduce((b, r) => (!b || r.blend > b.blend ? r : b), null) : null;
  const maxMs = Math.max(1, ...rounds.map((r) => r.ms | 0));
  const bars = rounds.map((r) => {
    const pct = Math.max(6, Math.round((r.ms / maxMs) * 100));
    return `<div class="chm-tl-row"><span class="chm-tl-n">R${r.round}</span><div class="chm-tl-bar"><i class="p${r.hider}" style="width:${pct}%">${r === longest && rounds.length > 1 ? '<b>★</b>' : ''}${r.found ? '<em>✦</em>' : ''}</i></div><span class="chm-tl-t">${fmtTime(r.ms | 0)}</span></div>`;
  }).join('');
  const lines = [];
  if (longest) lines.push(`<span>Best hide: ${nm(api, longest.hider)} ${fmtTime(longest.ms | 0)}${longest.surf && SURF_SHORT[surfKey(longest.surf)] ? ` ${esc(SURF_SHORT[surfKey(longest.surf)])}` : ''}${longest.found ? '' : ' (survived)'}</span>`);
  if (fastest) lines.push(`<span>Fastest find: ${nm(api, fastest.seeker || other(fastest.hider))} ${fmtTime(fastest.ms | 0)}</span>`);
  if (bestBlend && bestBlend.blend >= 40) lines.push(`<span>Best blend: ${nm(api, bestBlend.hider)} ${Math.round(bestBlend.blend)}%</span>`);
  const passes = rounds.reduce((n, r) => n + (r.passes | 0), 0);
  if (passes) lines.push(`<span>${passes} walk-past${passes === 1 ? '' : 's'} on ${esc(mapName || 'the map')}</span>`);
  return { bars, lines };
}
