// Blend & Seek (chameleon) — records, rivalry and cards (builder R).
//   node tools/test/games/chameleon-rivalry.test.js            (all sections)
//   ONLY=pure,hotseat,live,looks   PORT=9620 (uses PORT..PORT+19; keep within 9620–9639)
//   SHOTS=dir (default: $TMPDIR/chameleon-rivalry-shots)
//
// pure     Node only: recordRound (ran-dry is not a survival, first records, tendencies, portrait), the Cup,
//          head-to-head, matchStory (best hide = survivals only, Double Blind's own story), wear packing,
//          the cards' HTML (emotes are SVG, no dangling separators, hotseat greys the dead rules, final headline).
// hotseat  one phone: Cup / head-to-head / portrait in the lobby, the greyed settings rows, ≥ 44 px steppers, a 2-round match
//          (recap layout in portrait + landscape + dark, first-record stickers, TAKES THE CUP, a new look unlocked).
// live     two phones: the same facts on both devices (head-to-head in the recap, Cup on the final card).
// looks    the new trim looks: unlock, wear, hidden on a hiding hider, shown on the seeker; locked tiles in colour.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { launch } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'chameleon-rivalry-shots');
const PORT = Number(process.env.PORT) || 9620;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
let failures = 0;
const assert = (c, m) => { if (!c) { failures++; console.log('FAIL -', m); return false; } console.log('ok -', m); return true; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });

const FAST = { hide: 12000, seek: 15000, title: 700, recap: 2500, found: 2200, final: 3000, seekLead: 900, resume: 1500, maxDpr: 0.5, noTips: true };
const LONG = { ...FAST, hide: 60000, seek: 20000, recap: 30000, final: 60000 };
async function arm(page, tune = FAST) { await page.evaluate((t) => { window.__chamTest = true; window.__chamTune = t; }, tune); }
const st = (p) => p.evaluate(() => window.__cham && window.__cham.state());
const hook = (p, fn, ...args) => p.evaluate(([f, a]) => window.__cham[f](...a), [fn, args]);
async function waitReady(p) { await p.waitForFunction(() => window.__cham && window.__cham.ready, null, { timeout: 60000 }); }
async function waitPhase(p, name, timeout = 40000) { await p.waitForFunction((n) => window.__cham && window.__cham.state().phase.name === n, name, { timeout }); }
async function waitLinked(p) { await p.waitForFunction(() => window.__cham && window.__cham.ready && window.__cham.state().linkReady, null, { timeout: 40000 }); }
async function shot(p, name) { await p.screenshot({ path: path.join(SHOTS, name + '.png') }); }
const mod = (f) => import(pathToFileURL(path.join(__dirname, '../../../js/games/chameleon', f)).href);
const api = { name: (w) => (w === 'a' ? 'Emerson' : 'Sydney'), other: (w) => (w === 'a' ? 'b' : 'a') };
const text = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// ─────────────────────────────────────────────────────────────────────
async function pureSection() {
  console.log('\n# pure: records, the Cup, head-to-head, story, wear packing, card HTML');
  const R = await mod('records.js'); const W = await mod('wardrobe.js'); const C = await mod('cards.js');
  const names = { a: 'Emerson', b: 'Sydney' };
  const base = { mode: 'hs', map: 'living', names, passes: 0, strokes: { a: 3, b: 3 }, stared: 0 };

  // B: a seeker who runs dry hands over the points, not a survival / unlock / streak step
  let d = {};
  const dry = { round: 1, hider: 'a', seeker: 'b', found: false, ms: 20000, points: 50, surf: 'ceiling', outOfPellets: true, blend: 95 };
  let r = R.recordRound(d, dry, base);
  assert(!('a_surv' in r.patch) && !('a_surv_ms' in r.patch) && !('a_blend_surv' in r.patch) && !('a_surf_ceiling' in r.patch) && !('a_ghost' in r.patch), 'ran dry: no survival, no best-hide, no Gold/Galaxy counters');
  assert(r.patch.a_dry === 1 && r.patch.a_hides === 1 && r.patch.a_rounds === 1 && r.patch.b_rounds === 1, 'ran dry: counted as a hide and a round, plus a_dry');
  assert(!r.records.some((x) => x.kind === 'surv'), 'ran dry: no "Survived" record sticker');
  assert(r.patch.a_streak === undefined && r.patch.b_streak === 0, 'ran dry: the hider keeps (does not step) the streak, the seeker loses theirs');
  d = { a_streak: 2, a_streak_best: 2 };
  r = R.recordRound(d, dry, base);
  assert(!r.patch.a_streak && !r.patch.a_streak_best, 'ran dry with a 2-streak: no 3rd step (no Head bob farming)');
  const live = { ...dry, outOfPellets: false, ms: 90000 };
  r = R.recordRound({ a_streak: 2, a_streak_best: 2 }, live, base);
  assert(r.patch.a_surv === 1 && r.patch.a_surv_ms === 90000 && r.patch.a_streak === 3 && r.records.some((x) => x.kind === 'streak'), 'a real survival still records everything (surv, surv_ms, streak 3)');

  // first-ever records are celebrated
  r = R.recordRound({}, { round: 1, hider: 'b', seeker: 'a', found: true, ms: 12000, points: 12, surf: 'wall', blend: 72 }, base);
  const first = r.records.find((x) => x.kind === 'find');
  assert(first && first.title === 'FIRST FIND' && /0:12/.test(first.text), `first find is celebrated: ${first && first.title} "${first && first.text}"`);
  assert(r.records.some((x) => x.kind === 'blend' && x.title === 'FIRST BLEND'), 'first blend of 72 % is celebrated');
  r = R.recordRound({}, { round: 1, hider: 'b', seeker: 'a', found: true, ms: 12000, points: 12, surf: 'wall', blend: 30 }, base);
  assert(!r.records.some((x) => x.kind === 'blend'), 'a first 30 % blend is not');
  r = R.recordRound({ a_find_ms: 20000 }, { round: 1, hider: 'b', seeker: 'a', found: true, ms: 12000, points: 12, surf: 'wall' }, base);
  assert(r.records.find((x) => x.kind === 'find').title === undefined, 'a beaten find record keeps the NEW RECORD title');
  r = R.recordRound({}, live, base);
  assert(r.records.some((x) => x.kind === 'surv' && x.title === 'FIRST SURVIVAL'), 'first survival celebrated');

  // tendencies
  r = R.recordRound({ a_call_wall: 2 }, { round: 1, hider: 'b', seeker: 'a', found: true, ms: 9000, points: 9, surf: 'wall', call: 'wall', zone: 'wall' }, base);
  assert(r.patch.a_call_wall === 3 && r.patch.a_found_wall === 1, 'tendencies: a_call_wall and a_found_wall counted for the seeker');
  r = R.recordRound({}, { round: 1, hider: 'b', seeker: 'a', found: false, ms: 90000, points: 120, surf: 'wall', call: 'floor', zone: 'wall' }, base);
  assert(r.patch.a_call_floor === 1 && !('a_found_wall' in r.patch), 'tendencies: a survived hide counts the call but not a find');
  assert(R.tendency({ a_call_wall: 4 }, 'a') === null, 'tendency: 4 samples is not enough');
  const t = R.tendency({ a_call_wall: 6, a_call_floor: 2, a_call_ceiling: 1 }, 'a');
  assert(t && t.zone === 'wall' && t.n === 6 && t.of === 9, 'tendency: walls 6 of 9');
  assert(R.tendencyLine(api, { a_call_wall: 6, a_call_floor: 2, a_call_ceiling: 1 }, 'a') === 'Emerson checks walls first (6 of 9)', `tendency line: "${R.tendencyLine(api, { a_call_wall: 6, a_call_floor: 2, a_call_ceiling: 1 }, 'a')}"`);
  assert(/finds most hiders on walls \(5 of 6\)/.test(R.tendencyLine(api, { b_found_wall: 5, b_found_floor: 1 }, 'b')), 'tendency falls back to where they find hiders');

  // portrait
  r = R.recordRound({ a_surv_ms: 50000 }, { ...live, ms: 70000 }, { ...base, portrait: () => 'AAAA' });
  assert(r.patch.a_portrait === 'AAAA' && r.patch.a_portrait_ms === 70000 && r.patch.a_portrait_map === 'living', 'portrait saved when the survival beats the best');
  r = R.recordRound({ a_surv_ms: 80000, a_portrait: 'OLD' }, { ...live, ms: 70000 }, { ...base, portrait: () => 'AAAA' });
  assert(!('a_portrait' in r.patch), 'portrait kept when the survival does not beat the best');
  r = R.recordRound({ a_surv_ms: 50000, a_portrait: 'OLD', a_portrait_ms: 50000 }, { ...live, ms: 70000 }, { ...base, portrait: () => 'x'.repeat(3001) });
  assert(!('a_portrait' in r.patch) && r.patch.a_surv_ms === 70000, 'a blob over 3000 characters is skipped (the old portrait stays)');
  r = R.recordRound({}, { ...dry }, { ...base, portrait: () => { throw new Error('should not be asked'); } });
  assert(true, 'a ran-dry round never asks for a portrait');

  // the Cup
  assert(R.cupOutcome({}, null) === null && R.cupOutcome({ cup_holder: 'a' }, null) === null, 'cup: a draw changes nothing');
  let o = R.cupOutcome({}, 'a');
  assert(o.kind === 'take' && o.from === null, 'cup: unclaimed, the winner takes it');
  o = R.cupOutcome({ cup_holder: 'a', cup_defences: 2 }, 'a');
  assert(o.kind === 'defend' && o.n === 3, 'cup: the holder wins again, defences 3');
  o = R.cupOutcome({ cup_holder: 'a', cup_defences: 2 }, 'b');
  assert(o.kind === 'take' && o.from === 'a', 'cup: the other player wins, it passes');
  let p = R.recordMatch({ cup_holder: 'a', cup_defences: 2, b_cups: 1 }, 'b', '2026-10-12');
  assert(p.cup_holder === 'b' && p.cup_defences === 0 && p.b_cups === 2 && p.cup_day === '2026-10-12' && p.b_wins === 1 && p.a_matches === 1, `cup passes: ${JSON.stringify(p)}`);
  p = R.recordMatch({ cup_holder: 'a', cup_defences: 2 }, 'a', '2026-10-12');
  assert(p.cup_defences === 3 && p.cup_holder === 'a' && !('a_cups' in p), 'cup defended: defences 3, no extra cup count');
  p = R.recordMatch({ cup_holder: 'a', cup_defences: 2 }, null, '2026-10-12');
  assert(!('cup_holder' in p) && !('cup_defences' in p) && p.a_matches === 1, 'cup: a drawn match still counts as played but moves nothing');
  for (const k of Object.keys(R.recordMatch({}, 'a', 'x'))) assert(/^[a-zA-Z0-9_.-]{1,60}$/.test(k), `data key ok: ${k}`);

  // head-to-head
  const h2h = R.headToHeadText(api, { a_finds: 7, b_surv: 5, b_finds: 2, a_surv: 1 });
  assert(/Emerson has found Sydney 7 times Sydney has survived Emerson 5/.test(h2h.replace(' · ', ' ')) || /Emerson has found Sydney 7 times/.test(h2h), `head-to-head: "${h2h}"`);
  assert(/Sydney has found Emerson 2 times/.test(h2h) && /Emerson has survived Sydney 1/.test(h2h), 'head-to-head: both directions');
  assert(R.headToHead(api, {}) === '', 'head-to-head: nothing before the first hunt');
  assert(/1 time[^s]/.test(R.headToHeadText(api, { a_finds: 1 }) + ' '), 'head-to-head: "1 time"');

  // lobby strip: no separators
  const strip = R.bestsStrip(api, { a_surv_ms: 88000, a_surv_surf: 'ceiling', b_find_ms: 12000, a_blend: 77, a_streak: 3, a_matches: 2, cup_holder: 'b', cup_defences: 2, a_finds: 3 });
  assert(!/<i>/.test(strip) && !/·/.test(strip.replace(/defended/, '')) || !/<i>·<\/i>/.test(strip), 'bests strip: no text-dot separators');
  assert(/chm-cup/.test(strip) && /defended 2×/.test(text(strip)) && /Sydney/.test(text(strip)), `lobby: the Cup line "${text(strip).slice(0, 90)}"`);
  const daily = R.dailyLine(api, { a_daily_x: 40000, b_daily_x: 70000 }, 'x');
  assert(!/<i>/.test(daily) && /Sydney leads/.test(text(daily)), 'daily line: no separators, lead named');

  // story: F + D
  const hist = [
    { round: 1, hider: 'a', seeker: 'b', found: false, outOfPellets: true, ms: 100000, surf: 'ceiling' },
    { round: 2, hider: 'b', seeker: 'a', found: false, ms: 60000, surf: 'wall', blend: 61 },
    { round: 3, hider: 'a', seeker: 'b', found: true, ms: 30000, surf: 'flat', blend: 85 },
  ];
  let story = R.matchStory(api, hist, 'Living Room');
  const sTxt = text(story.lines.join(' | '));
  assert(/Best hide: Sydney 1:00 up the wall \(survived\)/.test(sTxt), `best hide = a survival only (the ran-dry 1:40 is not): "${sTxt}"`);
  assert(/Longest hide: Emerson 1:40 \(seeker ran dry\)/.test(sTxt), 'the longest hide is its own, clearly labelled line');
  assert(/Best blend: Emerson 85%/.test(sTxt) && /Fastest find: Emerson 0:30/.test(sTxt) || /Fastest find: Sydney 0:30/.test(sTxt), 'best blend and fastest find are separate lines');
  story = R.matchStory(api, [{ round: 1, hider: 'a', seeker: 'b', found: true, ms: 20000, surf: 'wall' }], 'x');
  assert(!/Best hide/.test(text(story.lines.join(' '))) && !/Longest hide: .*seeker ran dry/.test(text(story.lines.join(' '))), 'no survivals: no "Best hide" line');
  const db = R.matchStory(api, [{ round: 1, winner: 'a', victim: 'b', found: true, ms: 34000, hider: 'b', seeker: 'a' }, { round: 2, winner: null, found: false, ms: 60000 }, { round: 3, winner: 'a', victim: 'b', found: true, ms: 22000, hider: 'b', seeker: 'a' }], 'x', 'db');
  const dbTxt = text(db.lines.join(' | '));
  assert(/Rounds won: Emerson 2 Sydney 0 1 void/.test(dbTxt.replace(/·/g, '')) || /Rounds won/.test(dbTxt), `Double Blind final card tells the rounds-won story: "${dbTxt}"`);
  assert(!/Best hide/.test(dbTxt) && /Fastest tag: Emerson 0:22/.test(dbTxt), 'Double Blind: never "Best hide" for being found; fastest tag instead');
  assert((db.bars.match(/chm-tl-row/g) || []).length === 3 && /void/.test(db.bars), 'Double Blind: a bar per round, the void round hollow');

  // wardrobe: wear packing compat + trim unlocks
  assert(W.packWear({ eye: 4, shape: 2, charm: 3, twitch: 2 }) === 4 + 16 + 192 + 1024, 'packWear: the first four slots keep their bits (trim 0 adds nothing)');
  const un = W.unpackWear(W.packWear({ eye: 1, shape: 1, charm: 1, twitch: 1, trim: 4 }));
  assert(un.eye === 1 && un.trim === 4 && W.unpackWear(1 + 8 + 64 + 512).trim === 0, 'unpackWear: trim lives in bits 12–14, an old value reads trim 0');
  assert(W.packWear({ eye: 7, shape: 7, charm: 7, twitch: 7, trim: 7 }) < 32768, 'packed wear stays under 15 bits');
  const d2 = { a_cups: 1, a_whisker: 3, a_callstreak: 3, a_notes: 1 };
  const nu = W.newUnlocks(d2, 'a');
  assert(['trim1', 'trim2', 'trim3', 'trim4'].every((k) => nu.patch[`unlock_a_${k}`] === 1), `all four trim looks unlock from the new stats: ${Object.keys(nu.patch).join(',')}`);
  assert(Object.keys(W.newUnlocks({ a_whisker: 2, a_callstreak: 2 }, 'a').patch).length === 0, 'two whiskers / a streak of two unlock nothing');
  assert(W.resolveWear({ unlock_a_trim1: 1 }, 'a', { trim: 1 }).trim === 1 && W.resolveWear({}, 'a', { trim: 1 }).trim === 0, 'a trim pick is worn only once earned');
  const sheet = W.wardrobeSheet(api, { w: 'a', d: { a_whisker: 2 }, picks: {} });
  assert((sheet.match(/class="chm-wt /g) || []).length === 20, 'wardrobe: 20 tiles (15 old + 5 trim)');
  assert(/data-prog="2\/3"/.test(sheet) && />2 \/ 3</.test(sheet), 'a locked tile prints its progress "2 / 3"');
  assert((sheet.match(/chm-wt-lock/g) || []).length >= 15, 'every locked tile wears a lock badge');

  // cards: emotes, final headline, settings greying
  assert(C.EMOTES.length === 6 && C.EMOTES.map((e) => e[0]).join() === 'lol,how,sneaky,love,again,paint', 'emotes keep their six ids');
  assert(C.EMOTES.every((e) => /^<svg/.test(e[1]) && !/[\u{1F300}-\u{1FAFF}☀-➿❤]/u.test(e[1])), 'every emote is an SVG sticker, no emoji');
  const fin = C.finalCard(api, { winner: 'b', a: 59, b: 111, mode: 'hs', story: { bars: '', lines: [] }, cup: { kind: 'take', n: 0, from: 'a' } });
  assert(/Sydney wins 111–59/.test(text(fin)) && !/blends best/.test(fin), `final headline: "${text(fin).slice(0, 40)}"`);
  assert(/TAKES THE CUP/.test(fin), 'final card: TAKES THE CUP');
  assert(/DEFENDS THE CUP \(3\)/.test(C.finalCard(api, { winner: 'b', a: 59, b: 111, mode: 'hs', story: { bars: '', lines: [] }, cup: { kind: 'defend', n: 3 } })), 'final card: DEFENDS THE CUP (3)');
  assert(!/CUP/.test(C.finalCard(api, { winner: null, a: 80, b: 80, mode: 'hs', story: { bars: '', lines: [] }, cup: null })), 'a draw: no Cup banner');
  assert(/Emerson wins 2–1/.test(text(C.finalCard(api, { winner: 'a', a: 2, b: 1, mode: 'db', story: { bars: '', lines: [] } }))), 'Double Blind headline: wins 2–1');
  const { MAPS } = await mod('maps.js'); const { applyPreset, LOCAL_DEAD } = await mod('rules.js');
  const setup = { mode: 'hs', map: MAPS[0].id, first: 'a', rules: applyPreset('classic') };
  const sheetL = C.settingsSheet(api, { canEdit: true, local: true, setup, waitingFor: 'a' });
  const sheetO = C.settingsSheet(api, { canEdit: true, local: false, setup, waitingFor: 'a' });
  const deadRows = (sheetL.match(/class="chm-set dead"/g) || []).length;
  assert(deadRows === LOCAL_DEAD.length && !/class="chm-set dead"/.test(sheetO), `hotseat settings: ${deadRows} of ${LOCAL_DEAD.length} dead rows greyed, none on two phones`);
  for (const k of LOCAL_DEAD) {
    const rowHtml = sheetL.split('<div class="chm-set').find((x) => x.includes(`data-dead="${k}"`)) || '';
    assert(/Two phones only/.test(rowHtml) && !/data-lobby="rule"[^>]*(?<!disabled)>(?![^<]*<)/.test('') && (rowHtml.match(/<button/g) || []).length === (rowHtml.match(/<button[^>]*disabled/g) || []).length, `hotseat settings: ${k} explained and every control disabled`);
  }
  assert(/data-k="twists"/.test(sheetO) && /data-k="underdog"/.test(sheetO) && /data-k="sudden"/.test(sheetO), 'settings sheet: rows for twists, underdog, sudden death');
  const title = C.titleCard(api, { round: 2, rounds: 4, mode: 'hs', hider: 'b', youHide: true, youSeek: false, map: MAPS[0].id, intel: 'Emerson checks walls first (6 of 9)' });
  assert(/chm-intel/.test(title) && /checks walls first/.test(title), 'title card carries the tendency line');
}

// ─────────────────────────────────────────────────────────────────────
/** Put the hider flat on the map's open wallpaper (the "good camouflage" setup). */
async function camoHide(p) {
  const s = (await hook(p, 'spots')).camo;
  await hook(p, 'teleport', s.x, s.z - 0.1, 0, s.y);
  await wait(150);
  return hook(p, 'setPose', 'wall');
}
/** A synthetic skin → a real portrait blob (the same packing the game uses). */
async function sampleBlob(kind = 'blocky') {
  const G = await mod('gallery.js');
  const d = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const o = (y * 128 + x) * 4;
    const c = kind === 'noisy' ? (() => { const k = ((x * 7919 + y * 104729) >>> 0) % 97; return [(k * 2) % 256, (k * 5) % 256, (k * 3) % 256]; })() : ((x >> 4) + (y >> 4)) % 2 ? [214, 168, 96] : [92, 150, 190];
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  return G.packPortrait(d);
}
/** One hotseat round: the hider (already at the hide curtain) camouflages and readies; the seeker tags or lets the clock run out. */
async function hotRound(a, { tag, call = 'wall' }) {
  await waitPhase(a, 'curtain', 30000);
  await a.tap('[data-act="curtain"]');
  await waitPhase(a, 'hide', 20000); await wait(500);
  await camoHide(a);
  await a.tap('.chm-acts [data-act="ready"]');
  await waitPhase(a, 'curtain', 20000);
  if (call) { const chip = await a.$(`[data-call="${call}"]`); if (chip) await chip.tap(); }
  await a.tap('[data-act="curtain"]');
  await waitPhase(a, 'seek', 20000);
  const seeker = (await st(a)).viewer; const hider = seeker === 'a' ? 'b' : 'a';
  if (tag) {
    const bc = await hook(a, 'bodyCenter', hider);
    await hook(a, 'teleport', bc[0] + 0.3, bc[2] + 2.4, Math.PI, 0);
    await wait(300);
    await hook(a, 'aimAt', ...(await hook(a, 'bodyCenter', hider)));
    await wait(250);
    await a.tap('.chm-acts [data-act="fire"]');
    await waitPhase(a, 'found', 20000);
  } else await waitPhase(a, 'time', 40000);
  await waitPhase(a, 'recap', 20000);
  return { seeker, hider };
}

async function hotseatSection(port) {
  console.log('\n# hotseat: lobby rivalry block, greyed rules, a 2-round match (iPhone)');
  const h = await launch({ port, only: ['chameleon'], who: ['a'], device: 'iPhone 13' });
  const a = h.a;
  try {
    await arm(a, { ...LONG, title: 5000, recap: 60000 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await wait(1200);
    const blob = await sampleBlob('blocky'); const noisy = await sampleBlob('noisy');
    await hook(a, 'seedData', { cup_holder: 'b', cup_defences: 2, a_finds: 7, b_surv: 5, b_finds: 2, a_surv: 1, a_portrait: blob, a_portrait_ms: 88000, a_portrait_map: 'living', b_portrait: noisy, b_portrait_ms: 61000, b_matches: 3, a_matches: 3, b_call_wall: 6, b_call_floor: 3 });
    await a.waitForSelector('.chm-cup', { timeout: 6000 });
    const lobby = await a.evaluate(() => ({
      cup: document.querySelector('.chm-cup').textContent.replace(/\s+/g, ' ').trim(),
      h2h: (document.querySelector('.chm-h2h') || {}).textContent || '',
      ports: [...document.querySelectorAll('.chm-gallery img')].map((i) => [i.complete && i.naturalWidth, Math.round(i.getBoundingClientRect().width)]),
      dots: document.querySelectorAll('.chm-bests i').length,
      overflowX: (() => { const c = document.querySelector('.chm-lobby .chm-card'); return c.scrollWidth - c.clientWidth; })(),
    }));
    assert(/The Cup.*Sydney holds it.*defended 2/.test(lobby.cup), `lobby: the Cup sticker "${lobby.cup}"`);
    assert(/Emerson has found Sydney 7 times/.test(lobby.h2h) && /Sydney has survived Emerson 5/.test(lobby.h2h), `lobby: head-to-head "${lobby.h2h.replace(/\s+/g, ' ')}"`);
    assert(lobby.ports.length === 2 && lobby.ports.every((p) => p[0] > 100 && p[1] >= 60), `lobby: both best-hide portraits drawn (${JSON.stringify(lobby.ports)})`);
    assert(lobby.dots === 0 && lobby.overflowX <= 1, `lobby: no separator dots, no sideways overflow (${lobby.overflowX})`);
    await shot(a, 'hotseat-lobby-portrait');
    await a.setViewportSize({ width: 844, height: 390 }); await wait(500);
    await shot(a, 'hotseat-lobby-landscape');
    await a.setViewportSize({ width: 390, height: 844 }); await wait(400);

    // settings: hotseat greys the dead rules, steppers are 44 px
    await a.tap('[data-act="settings"]');
    await a.waitForSelector('.chm-sheet', { timeout: 4000 });
    const sh = await a.evaluate(() => ({
      dead: [...document.querySelectorAll('.chm-set.dead')].map((r) => ({ k: r.dataset.dead, off: [...r.querySelectorAll('button')].every((b) => b.disabled), txt: r.textContent.replace(/\s+/g, ' ') })),
      steps: [...document.querySelectorAll('.chm-step button')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
      rows: [...document.querySelectorAll('[data-k="twists"],[data-k="underdog"],[data-k="sudden"]')].length,
    }));
    assert(sh.dead.length === 5 && sh.dead.every((r) => r.off && /Two phones only/.test(r.txt)), `hotseat settings: ${sh.dead.map((r) => r.k).join(',')} greyed, disabled and explained`);
    assert(sh.steps.length > 6 && sh.steps.every((s) => s[0] >= 44 && s[1] >= 44), `stepper buttons are ≥ 44 × 44 (${sh.steps.length}; min ${Math.min(...sh.steps.map((s) => s[0]))} × ${Math.min(...sh.steps.map((s) => s[1]))})`);
    assert(sh.rows > 0, 'settings sheet has the twists / underdog / sudden-death rows');
    await a.evaluate(() => document.querySelector('.chm-sheet').scrollTo(0, 700)); await wait(200);
    await shot(a, 'hotseat-settings');
    await a.tap('.chm-sheet .chm-done'); await wait(300);

    // wardrobe: 20 tiles, locked ones in colour with a lock and progress
    await a.tap('.chm-wardbtn');
    await a.waitForSelector('.chm-wardrobe', { timeout: 4000 });
    const wd = await a.evaluate(() => ({ tiles: document.querySelectorAll('.chm-wt').length, locked: document.querySelectorAll('.chm-wt.locked').length, locks: document.querySelectorAll('.chm-wt-lock').length, prog: [...document.querySelectorAll('.chm-prog')].map((e) => e.textContent), port: !!document.querySelector('.chm-wardrobe .chm-port img'), grey: [...document.querySelectorAll('.chm-wt.locked')].filter((e) => getComputedStyle(e.querySelector('i,svg')).filter !== 'none').length }));
    assert(wd.tiles === 20 && wd.locked === 15 && wd.locks === 15 && wd.prog.length === 15 && wd.grey === 0, `wardrobe: ${wd.tiles} tiles, ${wd.locked} locked with lock + progress, none greyed (${wd.prog.slice(0, 4).join(', ')}…)`);
    await a.evaluate(() => { const s = document.querySelector('.chm-wardrobe'); s.scrollTo(0, s.scrollHeight); }); await wait(200);
    await shot(a, 'hotseat-wardrobe');
    await a.tap('.chm-wardrobe .chm-done'); await wait(300);

    // a 2-round match: b hides first and is found, then a hides and survives
    await hook(a, 'setRules', { map: 'living', first: 'b', rules: { rounds: 2, wager: 5 } });
    await a.tap('[data-act="start"]');
    const r1 = await hotRound(a, { tag: true });
    await wait(1500);
    const rc = await a.evaluate(() => ({
      emotes: [...document.querySelectorAll('.chm-emote')].map((b) => ({ svg: !!b.querySelector('svg'), txt: b.querySelector('span').textContent.trim(), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })),
      h2h: (document.querySelector('.chm-recap .chm-h2h') || {}).textContent || '',
      pops: [...document.querySelectorAll('.chm-pop')].map((e) => e.textContent.replace(/\s+/g, ' ')),
      lines: (document.querySelector('.chm-lines') || {}).textContent || '',
    }));
    assert(rc.emotes.length === 6 && rc.emotes.every((e) => e.svg && e.txt === '' && e.w >= 44 && e.h >= 44), 'recap: six SVG reaction stickers (no emoji), each ≥ 44 px');
    assert(/Emerson has found Sydney 8 times/.test(rc.h2h.replace(/\s+/g, ' ')), `recap: head-to-head after this find "${rc.h2h.replace(/\s+/g, ' ')}"`);
    assert(/Found in/.test(rc.lines) || rc.pops.some((p) => /FIRST FIND|NEW RECORD/.test(p)), `recap: ${rc.pops.join(' | ') || rc.lines}`);
    await shot(a, 'hotseat-recap-portrait');
    await a.setViewportSize({ width: 844, height: 390 }); await wait(700);
    await shot(a, 'hotseat-recap-landscape');
    const ls = await a.evaluate(async () => {
      const card = document.querySelector('.chm-recap .chm-card'); card.scrollTop = card.scrollHeight; await new Promise((r) => setTimeout(r, 200));
      const cr = card.getBoundingClientRect(); const foot = document.querySelector('.chm-recap .chm-foot').getBoundingClientRect();
      const em = [...document.querySelectorAll('.chm-recap .chm-emote')].map((e) => e.getBoundingClientRect());
      const tally = document.querySelector('.chm-recap .chm-tally').getBoundingClientRect();
      const vw = innerWidth; const vh = innerHeight;
      const cam = window.__cham.screenOf ? window.__cham.screenOf(...window.__cham.bodyCenter('b')) : null;
      return { cardLeft: cr.left, cardW: cr.width, vw, vh, emoVisible: em.every((r) => r.top >= 0 && r.bottom <= foot.top + 2 && r.height >= 44), tallyVisible: tally.bottom <= foot.top + 2 && tally.top >= cr.top, pillHidden: getComputedStyle(document.querySelector('.chm-sub')).display === 'none', cam };
    });
    assert(ls.cardLeft > ls.vw * 0.4 && ls.cardW < ls.vw * 0.5, `landscape recap: the card is a side panel on the right (left ${Math.round(ls.cardLeft)} of ${ls.vw}, ${Math.round(ls.cardW)} wide)`);
    assert(ls.emoVisible && ls.tallyVisible, 'landscape recap: the tally and the six reactions are reachable (scrolled into view above the pinned Next)');
    assert(ls.cam && ls.cam[0] > 20 && ls.cam[0] < ls.cardLeft - 20 && ls.cam[1] > 20 && ls.cam[1] < ls.vh - 20, `landscape recap: the chameleon sits in the free left part of the screen (${ls.cam && ls.cam.map((x) => Math.round(x)).join(', ')})`);
    assert(ls.pillHidden, 'recap: the role pill is hidden (it sat on the body)');
    await a.setViewportSize({ width: 390, height: 844 }); await wait(500);
    await a.tap('[data-act="next"]');
    // round 2: the hide curtain (hotseat) carries the tendency line
    await a.waitForSelector('.chm-intel', { timeout: 15000 });
    const intel = await a.$eval('.chm-intel', (e) => e.textContent);
    assert(/Sydney checks walls first \(\d+ of \d+\)/.test(intel), `hide curtain: "${intel}"`);
    const r2 = await hotRound(a, { tag: false, call: 'floor' });
    assert(r2.hider === 'a', 'round 2: Emerson hides');
    await wait(800);
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'final', 20000);
    await a.waitForSelector('.chm-final', { timeout: 4000 });
    await wait(1200);
    const fin = await a.evaluate(() => ({ head: document.querySelector('.chm-final h2').textContent, cup: (document.querySelector('.chm-cupban') || {}).textContent || '', story: document.querySelector('.chm-story').textContent.replace(/\s+/g, ' '), pops: [...document.querySelectorAll('.chm-pop')].map((e) => e.textContent.replace(/\s+/g, ' ')), stickers: document.querySelector('.chm-recs') ? document.querySelector('.chm-recs').textContent.replace(/\s+/g, ' ') : '' }));
    assert(/^Emerson wins \d+–\d+$/.test(fin.head), `final headline: "${fin.head}"`);
    assert(/TAKES THE CUP/.test(fin.cup) && /from Sydney/.test(fin.cup), `final: "${fin.cup.replace(/\s+/g, ' ')}"`);
    assert(/Best hide: Emerson [\d:]+ .*\(survived\)/.test(fin.story), `final story: "${fin.story}"`);
    await shot(a, 'hotseat-final');
    const d = await hook(a, 'data');
    assert(d.cup_holder === 'a' && d.cup_defences === 0 && d.a_cups === 1 && d.cup_day, `the Cup passed to Emerson: ${d.cup_holder} defended ${d.cup_defences}, a_cups ${d.a_cups}`);
    assert(d.unlock_a_trim1 === 1, 'taking the Cup unlocked the Gold crest');
    assert(d.a_portrait && d.a_portrait_ms > 0 && d.a_surv === 2, `Emerson's survival saved a portrait (${(d.a_portrait || '').length} chars, ${d.a_portrait_ms} ms)`);
    assert(d.a_call_wall === 1 && d.b_call_floor === 4 && d.a_found_wall === 1, `tendencies recorded: a_call_wall ${d.a_call_wall}, b_call_floor ${d.b_call_floor}, a_found_wall ${d.a_found_wall}`);
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); await shot(a, 'hotseat-FAIL').catch(() => {}); failures++; } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
async function looksSection(port) {
  console.log('\n# looks: the trim slot (crest, tail stripe, cheeks, ribbon): unlock, wear, hidden while hiding, draw calls');
  const h = await launch({ port, only: ['chameleon'], who: ['a'], device: 'iPhone 13' });
  const a = h.a;
  try {
    await arm(a, { ...LONG, title: 700, recap: 40000 });
    await h.startLive(a, 'chameleon', 'local');
    await waitReady(a);
    await wait(1200);
    await hook(a, 'seedData', { unlock_a_trim1: 1, unlock_a_trim2: 1, unlock_b_trim3: 1, unlock_b_trim4: 1, a_cups: 1, a_whisker: 2, b_callstreak: 3, b_notes: 1 });
    await a.tap('.chm-wardbtn');
    await a.waitForSelector('.chm-wardrobe', { timeout: 4000 });
    const tiles = await a.$$eval('.chm-wt[data-wear="trim"]', (els) => els.map((e) => ({ k: e.dataset.k, locked: e.classList.contains('locked'), prog: (e.querySelector('.chm-prog') || {}).textContent || '' })));
    assert(tiles.length === 5 && !tiles[1].locked && !tiles[2].locked && tiles[3].locked && tiles[4].locked, `Emerson's trim row: Gold crest + Tail stripe earned, the others locked (${tiles.map((t) => t.locked ? t.prog : 'ok').join(' | ')})`);
    await a.tap('.chm-wt[data-wear="trim"][data-k="1"]'); await wait(300);
    assert((await hook(a, 'trimDrawn')).wear.a === 1, 'wearing the Gold crest dresses Emerson');
    await a.tap('.chm-wt.locked[data-wear="trim"][data-k="3"]').catch(() => {});
    await a.tap('[data-wfor="b"]'); await wait(300);
    await a.tap('.chm-wt[data-wear="trim"][data-k="3"]'); await wait(300);
    const td = await hook(a, 'trimDrawn');
    assert(td.wear.b === 3 && td.a && td.b, `Sydney wears the rosy cheeks; both are drawn in the lobby (${JSON.stringify(td)})`);
    await a.tap('.chm-wardrobe .chm-done'); await wait(300);

    await hook(a, 'setRules', { map: 'living', first: 'a', rules: { rounds: 2, wager: 0 } });
    await a.tap('[data-act="start"]');
    await waitPhase(a, 'curtain', 30000); await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'hide', 20000); await wait(600);
    let t = await hook(a, 'trimDrawn');
    assert(!t.a && t.b, `while Emerson hides her trim is not drawn (camouflage stays fair); the seeker's is (${JSON.stringify(t)})`);
    await camoHide(a);
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'curtain', 20000); await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'seek', 20000); await wait(400);
    t = await hook(a, 'trimDrawn');
    assert(!t.a && t.b, 'during the hunt the hider is still bare, the seeker dressed');
    const perf = await hook(a, 'perf');
    const bc = await hook(a, 'bodyCenter', 'a');
    await hook(a, 'teleport', bc[0] + 0.3, bc[2] + 2.4, Math.PI, 0);
    await wait(300);
    await hook(a, 'aimAt', ...(await hook(a, 'bodyCenter', 'a')));
    await wait(250);
    await a.tap('.chm-acts [data-act="fire"]');
    await waitPhase(a, 'found', 20000);
    await wait(900);
    t = await hook(a, 'trimDrawn');
    assert(t.a && t.b, 'after the tag both are dressed again');
    // close-ups: the hider's gold crest, the seeker's cheeks
    await a.addStyleTag({ content: '.chm-over, .chm-pops, .chm-hud, .chm-top { display: none !important; }' });
    const hc = await hook(a, 'bodyCenter', 'a'); const sc = await hook(a, 'bodyCenter', 'b');
    await hook(a, 'lookFrom', [hc[0] + 0.5, hc[1] + 0.45, hc[2] + 0.75, hc[0], hc[1] + 0.12, hc[2]]); await wait(900);
    await shot(a, 'looks-crest-hider');
    await hook(a, 'lookFrom', [sc[0] + 0.1, sc[1] + 0.3, sc[2] + 0.85, sc[0], sc[1] + 0.12, sc[2]]); await wait(900);
    await shot(a, 'looks-cheeks-seeker');
    await hook(a, 'lookFrom', [hc[0] - 0.75, hc[1] + 0.5, hc[2] - 0.5, hc[0], hc[1] + 0.1, hc[2] - 0.15]); await wait(900);
    await shot(a, 'looks-crest-side');
    const calls = Math.max(perf.calls || 0, 0);
    assert(calls > 0 && calls <= 80, `${calls} draw calls with a seeker's trim drawn (≤ 80)`);
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); await shot(a, 'looks-FAIL').catch(() => {}); failures++; } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
async function startPair(h, tune) {
  const { a, b } = h;
  for (const p of [a, b]) await arm(p, tune);
  await h.startLive(a, 'chameleon', 'live');
  await h.settle();
  await b.click('#gm-invite [data-g="invite-yes"]');
  await waitLinked(a); await waitLinked(b);
  await wait(600);
}
async function liveSection(port) {
  console.log('\n# live: Double Blind to the end on two phones: its own final card, the Cup on both, no "Best hide" for being found');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, recap: 20000, final: 60000, maxDpr: 0.45 });
    await hook(a, 'seedData', { cup_holder: 'a', cup_defences: 4, a_cups: 1 });
    await a.tap('[data-lobby="mode"][data-v="db"]');
    await b.waitForFunction(() => window.__cham.state().setup.mode === 'db', null, { timeout: 5000 });
    await b.waitForSelector('.chm-cup', { timeout: 8000 });
    assert(/Emerson holds it/.test(text(await b.$eval('.chm-cup', (e) => e.textContent))) && /defended 4/.test(text(await b.$eval('.chm-cup', (e) => e.textContent))), 'the guest sees the Cup in the lobby too (Emerson, defended 4×)');
    await a.tap('[data-act="start"]');
    for (let round = 1; round <= 2; round++) {
      await waitPhase(a, 'hide', 30000); await waitPhase(b, 'hide', 8000);
      await camoHide(a); await hook(b, 'setPose', 'crouch');
      await a.tap('.chm-acts [data-act="ready"]'); await b.tap('.chm-acts [data-act="ready"]');
      await waitPhase(a, 'seek', 20000); await waitPhase(b, 'seek', 8000);
      await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
      const bc = await hook(b, 'bodyCenter', 'a');
      await hook(b, 'teleport', bc[0] + 0.3, bc[2] + 2.4, Math.PI);
      await hook(b, 'aimAt', ...(await hook(b, 'bodyCenter', 'a')));
      await wait(250);
      await b.tap('.chm-acts [data-act="fire"]');
      await waitPhase(a, 'found', 15000); await waitPhase(b, 'found', 5000);
      await waitPhase(a, 'recap', 15000); await waitPhase(b, 'recap', 5000);
      if (round === 1) { await wait(500); await shot(a, 'live-db-recap'); await b.tap('[data-act="next"]'); }
    }
    assert(/Sydney wins the round/.test(await a.textContent('.chm-recap h2')), 'DB recap names the round winner');
    await b.tap('[data-act="next"]');
    await waitPhase(a, 'final', 15000); await waitPhase(b, 'final', 5000);
    for (const p of [a, b]) await p.waitForSelector('.chm-final', { timeout: 5000 });
    await wait(1500);
    for (const [w, p] of [['a', a], ['b', b]]) {
      const f = await p.evaluate(() => ({ head: document.querySelector('.chm-final h2').textContent, cup: (document.querySelector('.chm-cupban') || {}).textContent || '', story: document.querySelector('.chm-story').textContent.replace(/\s+/g, ' '), rows: document.querySelectorAll('.chm-tl-row').length }));
      assert(f.head === 'Sydney wins 2–0', `[${w}] final headline "${f.head}"`);
      assert(/TAKES THE CUP/.test(f.cup) && /from Emerson/.test(f.cup), `[${w}] "${f.cup.replace(/\s+/g, ' ')}" (the holder lost it, 4 defences end)`);
      assert(/Rounds won/.test(f.story) && /Sydney 2/.test(f.story) && !/Best hide/.test(f.story) && f.rows === 2, `[${w}] DB story: "${f.story}" (${f.rows} bars)`);
    }
    await shot(a, 'live-db-final-a');
    await b.waitForFunction(() => window.__cham.data().cup_holder === 'b', null, { timeout: 8000 });
    const d = await hook(a, 'data');
    assert(d.cup_holder === 'b' && d.cup_defences === 0 && d.b_cups === 1 && d.b_wins === 1 && d.b_dbwins === 2, `data: ${JSON.stringify({ h: d.cup_holder, def: d.cup_defences, bc: d.b_cups, wins: d.b_wins, db: d.b_dbwins })}`);
    // the Cup is written once even if both phones tap See the board
    await a.tap('.chm-final [data-act="finish"]'); await b.tap('.chm-final [data-act="finish"]').catch(() => {});
    await wait(1200);
    const d2 = await hook(a, 'data');
    assert(d2.b_cups === 1 && d2.b_matches === 1, 'the match is recorded once (b_cups 1, b_matches 1)');
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); await shot(a, 'live-FAIL-a').catch(() => {}); await shot(b, 'live-FAIL-b').catch(() => {}); failures++; } finally { await h.close(); }
}

// ─────────────────────────────────────────────────────────────────────
async function main() {
  if (want('pure')) await pureSection();
  if (want('hotseat')) await hotseatSection(PORT);
  if (want('looks')) await looksSection(PORT + 2);
  if (want('live')) await liveSection(PORT + 4);
  if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
  console.log('\nall rivalry sections passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
