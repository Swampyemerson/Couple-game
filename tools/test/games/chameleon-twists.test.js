// Blend & Seek — the update pass "rounds, twists, comebacks" (twists.js, rules.js, the round code in game.js).
//   node tools/test/games/chameleon-twists.test.js                 (all sections)
//   ONLY=unit,bugA node tools/test/games/chameleon-twists.test.js  (some)
//   PORT=9600 (uses PORT..PORT+19)     SHOTS=dir   screenshots
//
// Sections
//   unit      (Node, no browser) the twist deck: seeded, never round 1, about half the rounds, never a twist
//             that can't run (fog on a diorama, bounty in Double Blind), LOCAL_DEAD / rulesFor, the new rules
//             in every preset, the underdog gap (×1.5 on XL), the called-it pay, the daily twist on one phone
//   bugA      hotseat: a tag fired 150 ms before the buzzer is FOUND and recorded as a find, not a survival
//   hotrules  hotseat: the dead rules are switched off (a head start is no wait), Today's hide picks a playable twist
//   bounty    hotseat: a bounty spot (marker for both, tag within 3 m = seeker +15, far = nothing) + Dusk on one phone
//   budget    hotseat on CU Boulder: draw calls with the bounty marker, Fog and Dusk (<= 80)
//   hotcolours hotseat: Three colours locks the hider's phone only
//   hotunder  hotseat: Underdog (+10 s to hide, +1 pellet, the sticker on the hand-over curtain)
//   sudden    hotseat: a tie after the last round plays a sudden-death pair (20 s / 30 s clocks, title card, final card, sd_wins)
//   streak    hotseat: the called-it streak pays 5 / 10 / 15 (counting finds only: a right call on a survived round pays 5 and leaves the run), 'Streak broken' for the hider, a_callstreak
//   hostreload two phones: the host reloads mid-hide and mid-hunt (the clock keeps its absolute end, hunting stays on), the seeker's wager call survives its own reload
//   fog       two phones, House: Fog rolls in (≤ 6 steps over the last third, pellet range follows, restored exactly, draw calls)
//   dusk      two phones: Dusk (lights fade in steps, glints brighter, restored exactly), the card stickers
//   colours   two phones: Three colours (3 map colours, brush locked, no Pick/Stamp, cleared at the round's end)
//   underdog  two phones: +1 escape for the trailing hider, +1 pellet for the trailing seeker, the sticker
//   dbsd      two phones, Double Blind: a tie after round 3 plays one 60 s sudden-death round
//   rows      two phones: the three new rows in the settings sheet (44 px taps, the guest sees changes)
//   shots     card layouts: portrait, landscape, dark
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { launch } = require('../harness');

const ROOT = path.resolve(__dirname, '../../..');
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'chameleon-twists-shots');
const PORT = Number(process.env.PORT) || 9600;
fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
let failures = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FAST = { hide: 25000, seek: 8000, title: 600, recap: 20000, found: 1800, final: 3000, seekLead: 700, resume: 1500, maxDpr: 0.5, noTips: true, fixedScale: true };
async function arm(page, tune = FAST) { await page.evaluate((t) => { window.__chamTest = true; window.__chamTune = t; }, tune); }
const st = (p) => p.evaluate(() => window.__cham && window.__cham.state());
const ti = (p) => p.evaluate(() => window.__cham.twistInfo());
const hook = (p, fn, ...args) => p.evaluate(([f, a]) => window.__cham[f](...a), [fn, args]);
async function waitReady(p) { await p.waitForFunction(() => window.__cham && window.__cham.ready, null, { timeout: 60000 }); }
async function waitPhase(p, name, timeout = 30000) { await p.waitForFunction((n) => window.__cham && window.__cham.state().phase.name === n, name, { timeout }); }
async function waitLinked(p) { await p.waitForFunction(() => window.__cham && window.__cham.ready && window.__cham.state().linkReady, null, { timeout: 60000 }); }
async function shot(p, name) { await p.screenshot({ path: path.join(SHOTS, name + '.png') }); }
async function startPair(h, tune = FAST) {
  const { a, b } = h;
  for (const p of [a, b]) await arm(p, tune);
  await h.startLive(a, 'chameleon', 'live');
  await h.settle();
  await b.click('#gm-invite [data-g="invite-yes"]');
  await waitLinked(a); await waitLinked(b);
  await wait(600);
}
async function startMatch(h, { map = 'living', first = 'b', rules = {}, mode = null } = {}) {
  const { a, b } = h;
  await hook(a, 'setRules', { map, first, ...(mode ? { mode } : {}), rules });
  await b.waitForFunction(([m, f]) => window.__cham.state().mapId === m && window.__cham.state().setup.first === f, [map, first], { timeout: 40000 });
  await a.tap('[data-act="start"]');
}
/** One device: a hotseat match. */
async function startHot(h, { map = 'living', first = 'b', rules = {}, tune = FAST, onLobby = null } = {}) {
  const a = h.a;
  await arm(a, tune);
  await h.startLive(a, 'chameleon', 'local');
  await waitReady(a);
  if (onLobby) await onLobby(a);
  await hook(a, 'setRules', { map, first, rules });
  await a.tap('[data-act="start"]');
  await waitPhase(a, 'curtain');
  return a;
}
/** hotseat: from the hide curtain to the seek curtain (the hider presses Ready after `setup`). */
async function hotHide(a, setup) {
  await a.tap('[data-act="curtain"]');
  await waitPhase(a, 'hide');
  await wait(450);
  if (setup) await setup();
  await a.tap('.chm-acts [data-act="ready"]');
  await waitPhase(a, 'curtain', 20000);
}
async function hotSeek(a) {
  await a.tap('[data-act="curtain"]');
  await waitPhase(a, 'seek', 20000);
  await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 20000 });
  await wait(250);
}
/** Put the hider flat on the open wallpaper (the wager zone is then 'wall'). */
async function camoHide(p) {
  const s = await hook(p, 'spots').then((x) => x.camo);
  await hook(p, 'teleport', s.x, s.z - 0.1, 0, s.y);
  await wait(150);
  return hook(p, 'setPose', 'wall');
}
/** The seeker stands ~2.4 m from the hider on a side with nothing in the way, and aims. */
async function aimAtHider(p, hider) {
  const bc = await hook(p, 'bodyCenter', hider);
  let pick = [0.3, 2.4];
  // a spot with a clear line from the shooter's real eye (it scales with the By-map size) to the hider
  // (a fixed 0.45 m probe passed over low clutter that then blocked a Petite seeker's 0.28 m eye line)
  for (const [ox, oz] of [[0.3, 2.4], [-0.3, -2.4], [2.4, 0.3], [-2.4, -0.3], [1.7, 1.7], [-1.7, 1.7], [1.7, -1.7], [-1.7, -1.7], [0.3, 1.4], [-1.4, 0.3]]) {
    await hook(p, 'teleport', bc[0] + ox, bc[2] + oz, Math.atan2(-ox, -oz), 0);
    await wait(60);
    const e = (await hook(p, 'camera')).p;
    const dx = bc[0] - e[0]; const dy = bc[1] - e[1]; const dz = bc[2] - e[2]; const d = Math.hypot(dx, dy, dz);
    const hit = await hook(p, 'surfaceAt', e[0], e[1], e[2], dx / d, dy / d, dz / d, d - 0.2);
    if (!hit) { pick = [ox, oz]; break; }
  }
  await hook(p, 'teleport', bc[0] + pick[0], bc[2] + pick[1], Math.atan2(-pick[0], -pick[1]), 0);
  await hook(p, 'aimAt', ...(await hook(p, 'bodyCenter', hider)));
  await wait(200);
}
/** Every sticker (.chm-pop) that shows on the page within `ms`, joined (they last 2 s and come 1.1 s apart). */
const collectPops = (p, ms) => p.evaluate((dur) => new Promise((res) => {
  const seen = new Set(); const t0 = performance.now();
  const tick = () => { document.querySelectorAll('.chm-pop').forEach((x) => seen.add(x.textContent)); if (performance.now() - t0 > dur) res([...seen].join(' | ')); else setTimeout(tick, 120); };
  tick();
}), ms);

// ───────────────────────────────────────────────────────────────────────────────────────
async function unitSection() {
  console.log('\n# unit: the twist deck, rules and the small pure helpers');
  const U = (f) => import(pathToFileURL(path.join(ROOT, 'js/games/chameleon', f)).href);
  const T = await U('twists.js'); const R = await U('rules.js'); const M = await U('maps.js');
  try {
    // deck: seeded, never round 1 under 'some', about half the rounds, nothing that can't run
    const same = JSON.stringify(T.pickTwists('seed-x', 6, 'hs', false, 'house')) === JSON.stringify(T.pickTwists('seed-x', 6, 'hs', false, 'house'));
    assert(same, 'pickTwists is a pure function of the seed');
    let firstRound = 0; let total = 0; let halves = 0; const seen = new Set(); let bad = 0; let repeats = 0;
    for (let i = 0; i < 200; i++) {
      for (const rounds of [2, 4, 6]) {
        const d = T.pickTwists(`m${i}`, rounds, 'hs', false, 'house');
        if (d.length !== rounds) bad++;
        if (d[0]) firstRound++;
        const n = d.filter(Boolean).length; total++; if (n === Math.round(rounds / 2)) halves++;
        d.forEach((x, k) => { if (x) seen.add(x); if (x && x === d[k - 1]) repeats++; });
      }
    }
    assert(!bad && firstRound === 0, 'a deck has one entry per round and never a twist on round 1');
    assert(halves === total, 'about half the rounds (rounds / 2) get a twist');
    assert(seen.size === 4 && repeats === 0, `all four twists show up, none back to back (${[...seen].join(', ')})`);
    // modes and maps
    const dbSeen = new Set(); const dioSeen = new Set(); const hotSeen = new Set();
    for (let i = 0; i < 120; i++) {
      T.pickTwists(`d${i}`, 6, 'db', false, 'house').forEach((x) => x && dbSeen.add(x));
      T.pickTwists(`o${i}`, 6, 'hs', false, 'living').forEach((x) => x && dioSeen.add(x));
      T.pickTwists(`h${i}`, 6, 'hs', true, 'house').forEach((x) => x && hotSeen.add(x));
    }
    assert(!dbSeen.has('bounty') && dbSeen.size === 3, `Double Blind never draws the bounty spot (${[...dbSeen].join(', ')})`);
    assert(!dioSeen.has('fog') && dioSeen.size === 3, `a diorama never draws fog (it fits inside the fog) (${[...dioSeen].join(', ')})`);
    assert(hotSeen.size === 4, 'hotseat plays all four twists (none of them needs a second device)');
    const ev = T.pickTwists('e', 4, 'hs', false, 'living', 'every');
    assert(ev.every(Boolean) && T.pickTwists('e', 4, 'hs', false, 'living', 'off').every((x) => x === null), "'every' = a twist each round, 'off' = none");
    assert(T.pickTwists('e', 3, 'hs', false, ['house', 'living', 'living'], 'every').every(Boolean), 'one map per round (Mix it up) is understood');
    // steps
    assert(T.fogStep(0.5) === 0 && T.fogStep(2 / 3) === 0 && T.fogStep(0.7) === 1 && T.fogStep(1) === 6 && T.fogStep(5) === 6, 'fog: nothing in the first two thirds, 6 steps over the last');
    const f6 = T.fogMood({ near: 11, far: 26 }, 6);
    assert(Math.abs(f6.fogFar - 26 * 0.45) < 1e-9 && Math.abs(f6.fogNear - 11 * 0.45) < 1e-9, 'fog closes to 45 % of the map default');
    assert(T.duskStep(0) === 0 && T.duskStep(1) === T.DUSK.steps && T.duskStep(0.5) === T.DUSK.steps / 2, 'dusk steps run 0..12 over the hunt');
    const d12 = T.duskMood(12, 0.56, 0.52, '#f4f2ee');
    assert(d12.hemi < 0.56 * 0.5 && d12.sun < 0.52 * 0.7 && d12.hemi > 0.2 && T.duskMood(0, 0.56, 0.52, '#f4f2ee').bg === '#f4f2ee', 'dusk dims the lights but not to black; step 0 is the plain sky');
    // palette + bounty
    const probes = [{ hex: '#ffffff' }, { hex: '#fefefe' }, { hex: '#d9a066' }, { hex: '#3a7d44' }, { hex: '#202020' }, { hex: '#c0392b' }];
    const pal = T.paletteFor('s', 2, probes);
    assert(pal.length === 3 && new Set(pal).size === 3 && pal.every((x) => /^#[0-9a-f]{6}$/.test(x)), `Three colours: three distinct swatches (${pal.join(' ')})`);
    assert(JSON.stringify(pal) === JSON.stringify(T.paletteFor('s', 2, probes)) && JSON.stringify(pal) !== JSON.stringify(T.paletteFor('s', 3, probes)), 'the palette is seeded by match and round');
    assert(T.paletteFor('s', 1, [{ hex: '#ffffff' }]).length === 3, 'a map with one probe still gets three swatches');
    // the room's own colours (area-weighted): a major surface is always in, every pair is clearly different (ΔE), aqua / sage come up
    const launder = [['#b8c8cc', 698], ['#4c6c78', 507], ['#f8fcf8', 434], ['#e8e0d4', 376], ['#90d8cc', 156], ['#4070d0', 54], ['#b8b4ac', 48], ['#40a8a4', 38], ['#f07060', 24]].map(([hex, w]) => ({ hex, w }));
    const living = [['#5c3c2c', 196], ['#f8f4e8', 113], ['#c49868', 80], ['#e8ccb0', 62], ['#d0e0e4', 36], ['#f0e4c8', 31], ['#784c34', 29], ['#80a89c', 24], ['#cc9438', 21], ['#70907c', 17], ['#b84c3c', 14]].map(([hex, w]) => ({ hex, w }));
    for (const [nm, cs] of [['Launderette', launder], ['Living', living]]) {
      let minDE = 1e9; let major = true;
      for (let r = 1; r <= 24; r++) { const p = T.paletteFor('m' + (r % 5), r, cs); for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) minDE = Math.min(minDE, T.deltaE(p[i], p[j])); major = major && cs.slice(0, 3).some((c) => p.includes(c.hex)); }
      assert(minDE >= T.SWATCH_DE && major, `${nm}: every pair of swatches differs by ΔE ${minDE.toFixed(0)} (>= ${T.SWATCH_DE}) and one is a major surface colour`);
    }
    const inPal = (cs, test) => { for (let r = 1; r <= 24; r++) if (T.paletteFor('m' + (r % 5), r, cs).some(test)) return true; return false; };
    assert(inPal(launder, (h) => ['#90d8cc', '#40a8a4'].includes(h)), 'Launderette palettes include its aqua');
    assert(inPal(living, (h) => ['#80a89c', '#70907c'].includes(h)), 'Living palettes include its sage');

    const cands = [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 0, y: 0, z: 8 }];
    const bp = T.pickBounty('m', 2, cands, [{ x: 0, z: 0 }], 5);
    assert(bp && Math.hypot(bp.x, bp.z) >= 5 && JSON.stringify(bp) === JSON.stringify(T.pickBounty('m', 2, cands, [{ x: 0, z: 0 }], 5)), 'the bounty spot keeps clear of the spawns and is seeded');
    assert(T.pickBounty('m', 2, [{ x: 1, y: 0, z: 1 }], [{ x: 0, z: 0 }], 5).x === 1 && T.pickBounty('m', 2, [], [], 5) === null, 'no far spot: the farthest one; none: null');
    // underdog + wager
    assert(T.underdogOf({ a: 0, b: 40 }, false) === 'a' && T.underdogOf({ a: 45, b: 5 }, false) === 'b' && T.underdogOf({ a: 0, b: 39 }, false) === null, 'underdog: the player behind by 40+');
    assert(T.underdogOf({ a: 0, b: 59 }, true) === null && T.underdogOf({ a: 0, b: 60 }, true) === 'a', 'underdog on XL maps: the gap is 60');
    assert(T.wagerPay(5, 1) === 5 && T.wagerPay(5, 2) === 10 && T.wagerPay(5, 3) === 15 && T.wagerPay(5, 9) === 15 && T.wagerPay(10, 3) === 30, 'wager pays base × min(3, streak)');
    // rules
    for (const id of R.PRESET_IDS) assert(R.PRESETS[id].twists === 'some' && R.PRESETS[id].underdog === true && R.PRESETS[id].sudden === true, `preset ${id}: twists some, underdog on, sudden death on`);
    for (const id of R.PRESET_IDS) assert(R.presetOf({ ...R.PRESETS[id] }) === id, `preset ${id} is still recognised`);
    const old = { ...R.PRESETS.classic }; delete old.twists; delete old.underdog; delete old.sudden;
    assert(R.presetOf(R.sanitizeRules(old)) === 'classic' && R.sanitizeRules(old).twists === 'some', 'an old saved Classic (without the new keys) still resolves to Classic');
    assert(R.sanitizeRules({ twists: 'sometimes', underdog: 3, sudden: 'x' }).twists === 'some', 'garbage snaps to the Classic value');
    assert(R.LOCAL_DEAD.includes('escapes') && R.LOCAL_DEAD.includes('huntPaint') && R.LOCAL_DEAD.includes('heartbeat') && R.LOCAL_DEAD.includes('sights') && R.LOCAL_DEAD.includes('headStart'), `LOCAL_DEAD lists ${R.LOCAL_DEAD.join(', ')}`);
    const hot = R.rulesFor(R.PRESETS.hard, true); const two = R.rulesFor(R.PRESETS.hard, false);
    assert(hot.escapes === 0 && hot.huntPaint === 'off' && hot.heartbeat === false && hot.sights === false && hot.headStart === 0 && hot.pellets === 5, 'rulesFor(hotseat) switches the dead rules off and keeps the rest');
    assert(two === R.PRESETS.hard && R.rulesFor(R.PRESETS.hard, true) === hot, 'two devices: untouched; one phone: cached per rules object');
    // Today's hide on one phone: never a dead twist
    let swapped = 0; let dead = 0; const ids = new Set();
    for (let d = 0; d < 80; d++) {
      const plan = M.dailyPlan(`2026-${String(1 + (d % 12)).padStart(2, '0')}-${String(1 + (d % 28)).padStart(2, '0')}`);
      const tw = T.dailyTwistFor(plan, true);
      if (Object.keys(tw.rules).some((k) => R.LOCAL_DEAD.includes(k))) dead++;
      if (tw.id !== plan.twist.id) { swapped++; ids.add(tw.id); }
      if (JSON.stringify(T.dailyTwistFor(plan, true)) !== JSON.stringify(tw)) dead += 1000000;
      if (T.dailyTwistFor(plan, false) !== plan.twist) dead += 1000;
    }
    assert(dead === 0 && swapped > 0, `Today's hide on one phone never picks a dead twist (${swapped} of 80 days swapped)`);
    assert(ids.size >= 2, `the swapped days spread over the playable twists (${[...ids].join(', ')}), not all Floor only`);
  } catch (e) { console.error(e.message); failures++; }
}

async function bugASection(port) {
  console.log('\n# bug A: hotseat, a tag fired 150 ms before the buzzer is a FIND, not a survival');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await startHot(h, { rules: { rounds: 2, seekScore: 'off', wager: 0, blendBonus: 0, twists: 'off' }, tune: { ...FAST, seek: 7000 } });
    await hotHide(a, () => camoHide(a));
    await hotSeek(a);
    await aimAtHider(a, 'b');
    const before = await hook(a, 'data');
    // one timer set for ~220 ms before the buzzer (the old hotseat code had already called time 380 ms ahead of it)
    const left = await a.evaluate(() => new Promise((res) => {
      const s0 = window.__cham.state();
      setTimeout(() => { const s = window.__cham.state(); const l = s.phase.end - s.now; window.__cham.action('fire'); res(l); }, Math.max(0, s0.phase.end - s0.now - 220));
    }));
    await waitPhase(a, 'found', 6000).catch(() => {});
    const s = await st(a);
    assert(s.phase.name === 'found' && s.round.rec && s.round.rec.found, `hotseat: a tag fired ${Math.round(left)} ms before the buzzer is FOUND (phase ${s.phase.name})`);
    assert(s.round.rec.ms >= 6600 && s.round.rec.ms <= 7000, `…at ${s.round.rec.ms} ms of a 7000 ms hunt, not the whole clock`);
    await waitPhase(a, 'recap', 8000);
    await wait(400);
    const d = await hook(a, 'data');
    assert((d.a_finds | 0) === (before.a_finds | 0) + 1 && (d.b_surv | 0) === (before.b_surv | 0), `records: a find for the seeker (${d.a_finds}), no survival for the hider (${d.b_surv | 0})`);
    // and a round nobody tags still times out at the buzzer
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'curtain', 10000);
    await hotHide(a, () => camoHide(a));
    await hotSeek(a);
    const t0 = (await st(a)).now;
    await waitPhase(a, 'time', 20000);
    const s2 = await st(a);
    assert(s2.round.rec && !s2.round.rec.found && s2.round.rec.ms === 7000 && s2.now - t0 >= 6000, `no tag: SURVIVED at the buzzer (${s2.round.rec.ms} ms)`);
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); failures++; await shot(a, 'bugA-FAIL').catch(() => {}); } finally { await h.close(); }
}

async function hotRulesSection(port) {
  console.log('\n# hotseat: the rules that do nothing there are off (a head start is not a wait)');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    const U = (f) => import(pathToFileURL(path.join(ROOT, 'js/games/chameleon', f)).href);
    const T = await U('twists.js'); const M = await U('maps.js');
    await startHot(h, { rules: { rounds: 2, headStart: 10, escapes: 3, huntPaint: 'on', heartbeat: true, sights: true, grace: 0, twists: 'off', underdog: false }, tune: { ...FAST, seekLead: 600 }, onLobby: async (pg) => {
      // Today's hide on one phone names the twist it will really play
      const pl = M.dailyPlan(M.dayKey()); const tw = T.dailyTwistFor(pl, true);
      await wait(600);
      const txt = await pg.textContent('.chm-today');
      assert(txt.includes(tw.label), `the Today button says "${tw.label}" on one phone${tw.id !== pl.twist.id ? ` (not "${pl.twist.label}", which needs two phones)` : ''}`);
    } });
    const rules = (await st(a)).rules;
    assert(rules.headStart === 0 && rules.escapes === 0 && rules.huntPaint === 'off' && rules.heartbeat === false && rules.sights === false, 'in force on one phone: no head start, no escapes, no paint while hunted, no heartbeat, no sights cue');
    const tm = await hook(a, 'timing');
    assert(tm.head === 0, 'the head start is 0 s although the setup says 10 s');
    await hotHide(a);
    await hotSeek(a);
    const s = await st(a);
    assert(s.phase.dur === 8000 && !s.blind && s.hunting, `the hunt starts at once (seek phase ${s.phase.dur} ms, no blindfold)`);
    assert((await hook(a, 'data')) && (await st(a)).setup.rules.headStart === 10, "the lobby's own setup keeps the 10 s (a two-device rematch would use it)");
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); failures++; await shot(a, 'hotrules-FAIL').catch(() => {}); } finally { await h.close(); }
}

async function bountySection(port) {
  console.log('\n# hotseat: Bounty spot (a marker, tag within 3 m = +15 for the seeker) and Dusk on one phone');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await startHot(h, { rules: { rounds: 4, seekScore: 'off', wager: 0, blendBonus: 0, underdog: false, sudden: false }, tune: { ...FAST, seek: 9000, twists: ['bounty', 'bounty', 'dusk', 'bounty'] } });
    await hotHide(a, async () => {
      const t = await ti(a);
      assert(t.twist === 'bounty' && t.bounty && Number.isFinite(t.bounty.x) && t.mood.bounty, `round 1 is a Bounty round: spot ${t.bounty && [t.bounty.x, t.bounty.z].map((x) => x.toFixed(1))}, the marker is up`);
      const sp = (await hook(a, 'spots'));
      const far = Math.min(...[...sp.hiderSpawns, ...sp.seekerSpawns].map((p) => Math.hypot(p.x - t.bounty.x, p.z - t.bounty.z)));
      assert(far >= 2.4, `the spot keeps ${far.toFixed(1)} m from every spawn`);
      // the hider stands on the spot
      await hook(a, 'teleport', t.bounty.x, t.bounty.z, 0, t.bounty.y);
      await wait(250);
    });
    const cur = await a.evaluate(() => document.querySelector('[data-curtain="seek"]').textContent);
    assert(/Bounty spot/i.test(cur), 'the hand-over curtain announces the twist');
    await hotSeek(a);
    await aimAtHider(a, 'b');
    await hook(a, 'action', 'fire');
    await waitPhase(a, 'found', 6000);
    let rec = (await st(a)).round.rec;
    assert(rec.found && rec.bounty && rec.bounty.who === 'seeker' && rec.bounty.pts === 15 && rec.seekPoints === 15, `tagged within 3 m of the spot: seeker +${rec.seekPoints}`);
    assert((await st(a)).match.scores.a === 15, 'the +15 is in the seeker\'s score');
    await waitPhase(a, 'recap', 8000);
    assert(/BOUNTY/.test(await collectPops(a, 6500)), 'the BOUNTY sticker pops in the recap');
    // round 2 (a hides): the hider survives right on the spot: ×1.5
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'curtain', 10000);
    let t2 = null;
    await hotHide(a, async () => {
      t2 = await ti(a);
      assert(t2.twist === 'bounty' && t2.bounty, 'round 2: a Bounty round again (its own spot)');
      await hook(a, 'teleport', t2.bounty.x + 1.0, t2.bounty.z, 0, t2.bounty.y);
      await wait(250);
    });
    await hotSeek(a);
    await waitPhase(a, 'time', 20000);
    rec = (await st(a)).round.rec;
    const base = Math.floor(rec.ms / 1000) + 30;
    assert(!rec.found && rec.bounty && rec.bounty.who === 'hider' && rec.points === Math.round(base * 1.5) && rec.bounty.pts === rec.points - base, `survived within 3 m of the spot: ${base} × 1.5 = ${rec.points} (+${rec.bounty.pts})`);
    // round 3 is Dusk, shown on one phone (the seeker's view)
    await waitPhase(a, 'recap', 8000);
    assert(/Twist: Dusk/.test(await a.textContent('.chm-nextline')), 'the recap\'s Next line names the next round\'s twist');
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'curtain', 10000);
    await hotHide(a);
    await hotSeek(a);
    const m0 = (await ti(a)).mood;
    assert(m0.id === 'dusk' && m0.baseHemi === 0.56, 'round 3 is Dusk on one phone');
    await a.waitForFunction(() => window.__cham.twistInfo().mood.hemi < 0.4, null, { timeout: 12000 });
    const m1 = (await ti(a)).mood;
    assert(m1.on && m1.hemi < 0.56 && m1.sun < m1.baseSun && m1.glint !== 'ffd23f', `dusk falls over the hunt (hemi ${m1.hemi.toFixed(2)}, sun ${m1.sun.toFixed(2)}, glints ${m1.glint})`);
    await waitPhase(a, 'time', 20000);
    const m2 = (await ti(a)).mood;
    assert(!m2.on && m2.hemi === m2.baseHemi && m2.sun === m2.baseSun && m2.baseSun === 0.50 && m2.glint === 'ffd23f' && m2.bg === m2.fogColor, 'at the round\'s end the lights, sky and glints are back exactly');
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); failures++; await shot(a, 'bounty-FAIL').catch(() => {}); } finally { await h.close(); }
}

async function hotUnderdogSection(port) {
  console.log('\n# hotseat: Underdog (+10 s to hide, +1 pellet), and not in a sudden-death round');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await startHot(h, { rules: { rounds: 4, seekScore: 'off', wager: 0, blendBonus: 0, twists: 'off', underdog: true, sudden: false, pellets: 6 }, tune: { ...FAST, seek: 7000, hide: 20000 } });
    await hotHide(a, async () => { assert((await st(a)).phase.dur === 20000 && !(await ti(a)).ud, 'round 1: 20 s to hide, nobody is behind'); });
    await hotSeek(a);
    await waitPhase(a, 'time', 20000); // Sydney survives: 37 points
    await waitPhase(a, 'recap', 8000);
    await hook(a, 'forceScores', 0, 50); // a gap of 50: past the 40 points, but round 2 is too early
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'curtain', 10000);
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    let t = await ti(a);
    assert(!t.ud && (await st(a)).phase.dur === 20000, 'round 2: 50 points behind, but the underdog never starts before round 3 (20 s to hide, nobody boosted)');
    await camoHide(a);
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'curtain', 20000);
    await hotSeek(a);
    await aimAtHider(a, 'a');
    await hook(a, 'action', 'fire');
    await waitPhase(a, 'found', 6000);
    await waitPhase(a, 'recap', 8000);
    await hook(a, 'forceScores', 0, 50);
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'curtain', 10000);
    // round 3: Sydney hides, Emerson (50 behind) seeks with a 7th pellet
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    t = await ti(a);
    assert(t.ud === 'a' && t.maxPellets === 7 && t.pellets.a === 7, `round 3: the underdog seeker has ${t.pellets.a} pellets (6 + 1)`);
    await camoHide(a);
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'curtain', 20000);
    const cur = await a.textContent('[data-curtain="seek"]');
    assert(/Underdog/.test(cur) && /\+1 pellet/.test(cur), 'the hand-over curtain announces it');
    const btn = await a.evaluate(() => { const r = document.querySelector('[data-curtain] [data-act="curtain"]').getBoundingClientRect(); return { b: r.bottom, h: innerHeight }; });
    assert(btn.b <= btn.h, `the hand-over button is on screen (${Math.round(btn.b)} <= ${btn.h})`);
    await hotSeek(a);
    await waitPhase(a, 'time', 20000);
    await waitPhase(a, 'recap', 8000);
    await hook(a, 'forceScores', 0, 60);
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'curtain', 10000);
    // round 4: Emerson hides, 60 behind: ten more seconds
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    t = await ti(a);
    assert(t.ud === 'a' && (await st(a)).phase.dur === 30000 && t.escapes.a === (await st(a)).rules.escapes, `round 4: the underdog hider gets 10 s more (${(await st(a)).phase.dur / 1000} s), and no escape (there are none on one phone)`);
    assert(/\+10 s to hide/.test((await collectPops(a, 2500)) + ''), 'the sticker says so');
    h.assertNoErrors();
  } catch (e) { console.error(e.message.split('\n')[0], h.errors); failures++; await shot(a, 'hotunder-FAIL').catch(() => {}); } finally { await h.close(); }
}

async function budgetSection(port) {
  console.log('\n# draw calls on CU Boulder (the heaviest map): Fog / Dusk / the bounty marker stay within 80');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await startHot(h, { map: 'cuboulder', rules: { rounds: 4, seekScore: 'off', wager: 0, blendBonus: 0, underdog: false, sudden: false, twists: 'every' }, tune: { ...FAST, hide: 20000, seek: 16000, twists: ['bounty', 'fog', 'dusk', 'bounty'], noWarm: true } });
    const calls = async (n = 6) => { let m = 0; for (let i = 0; i < n; i++) { await wait(180); m = Math.max(m, (await ti(a)).calls); } return m; };
    let t = null;
    await hotHide(a, async () => { t = await ti(a); });
    assert(t.twist === 'bounty' && t.bounty && t.mood.bounty, `CU round 1: bounty marker up at ${t.bounty && [t.bounty.x, t.bounty.z].map((x) => x.toFixed(1))}`);
    await hotSeek(a);
    // stand the seeker on the spot, then look at it from a few sides: the marker is in view
    let worst = 0; let worstOff = 0;
    for (const [dx, dz] of [[0, 3], [3, 0], [0, -3], [-3, 0]]) {
      await hook(a, 'teleport', t.bounty.x + dx, t.bounty.z + dz, Math.atan2(-dx, -dz), t.bounty.y);
      await hook(a, 'aimAt', t.bounty.x, t.bounty.y + 0.6, t.bounty.z);
      worst = Math.max(worst, await calls());
    }
    // the same views without the marker
    await a.evaluate(() => window.__cham.twistInfo()); // (keep the page warm)
    assert(worst <= 80, `with the marker in view: ${worst} draw calls (budget 80; CU's worst without it is 68)`);
    await waitPhase(a, 'recap', 40000);
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'curtain', 10000);
    await hotHide(a);
    await hotSeek(a);
    let fogWorst = 0;
    const t0 = Date.now();
    while ((await st(a)).phase.name === 'seek' && Date.now() - t0 < 30000) { fogWorst = Math.max(fogWorst, (await ti(a)).calls); await wait(300); }
    assert(fogWorst <= 80 && fogWorst > 0, `Fog on CU: ${fogWorst} draw calls at most`);
    await waitPhase(a, 'recap', 8000);
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'curtain', 10000);
    await hotHide(a);
    await hotSeek(a);
    let duskWorst = 0;
    const t1 = Date.now();
    while ((await st(a)).phase.name === 'seek' && Date.now() - t1 < 30000) { duskWorst = Math.max(duskWorst, (await ti(a)).calls); await wait(300); }
    assert(duskWorst <= 80 && duskWorst > 0, `Dusk on CU: ${duskWorst} draw calls at most`);
    h.assertNoErrors();
  } catch (e) { console.error(e.message.split('\n')[0], h.errors); failures++; await shot(a, 'budget-FAIL').catch(() => {}); } finally { await h.close(); }
}

async function hotColoursSection(port) {
  console.log('\n# hotseat: Three colours (the hider\'s phone is locked, the seeker\'s hunt is not)');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await startHot(h, { rules: { rounds: 2, twists: 'every', underdog: false, sudden: false }, tune: { ...FAST, hide: 20000, twists: ['colours', null] } });
    await a.tap('[data-act="curtain"]');
    await waitPhase(a, 'hide');
    await wait(500);
    const t = await ti(a);
    assert(t.twist === 'colours' && t.palette.length === 3 && t.lockOn && t.palLocked, `the hider's phone is locked to ${t.palette && t.palette.join(' ')}`);
    assert(/3 colours/.test(await a.textContent('.chm-role')), 'the role pill says 3 colours');
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'curtain', 20000);
    await hotSeek(a);
    await waitPhase(a, 'recap', 30000);
    assert(!(await ti(a)).lockOn, 'the lock is gone after the round');
    h.assertNoErrors();
  } catch (e) { console.error(e.message.split('\n')[0], h.errors); failures++; await shot(a, 'hotcolours-FAIL').catch(() => {}); } finally { await h.close(); }
}

async function suddenSection(port) {
  console.log('\n# hotseat: a tied match plays a sudden-death pair');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await startHot(h, { rules: { rounds: 2, seekScore: 'off', wager: 0, blendBonus: 0, underdog: false, twists: 'off', sudden: true }, tune: { ...FAST, seek: 6000, sdHide: 4000, sdSeek: 5000 } });
    // round 1: b survives (+36)
    await hotHide(a); await hotSeek(a);
    await waitPhase(a, 'time', 20000);
    let s = await st(a);
    assert(s.round.rec.points === 36 && s.match.scores.b === 36, `round 1: the hider survives, ${s.match.scores.b} points`);
    await waitPhase(a, 'recap', 8000);
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'curtain', 10000);
    // round 2: a hides; make the totals level by the end (a needs 36 as well)
    await hotHide(a, () => hook(a, 'forceScores', 0, 36));
    await hotSeek(a);
    await waitPhase(a, 'time', 20000);
    s = await st(a);
    const t = await ti(a);
    assert(s.match.scores.a === 36 && s.match.scores.b === 36, `level at 36–36 after the last round`);
    assert(t.sd === 2 && t.rounds === 4, 'the match grew by a sudden-death pair (4 rounds, sd 2)');
    await waitPhase(a, 'recap', 8000);
    const nl = await a.textContent('.chm-nextline');
    assert(/SUDDEN DEATH/.test(nl), `the recap's Next line says so ("${nl.trim().slice(0, 70)}")`);
    assert(/Next round/.test(await a.textContent('.chm-recap [data-act="next"]')), 'the button says Next round, not See who won');
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'curtain', 10000);
    const cur = await a.evaluate(() => document.querySelector('[data-curtain="hide"]').textContent);
    assert(/Sudden death/i.test(cur), 'the hand-over curtain announces SUDDEN DEATH');
    // round 3 (b hides first again), 4 s hide, 5 s hunt: b survives (+35)
    await hotHide(a, async () => {
      const sx = await st(a);
      assert(sx.viewer === 'b' && sx.phase.dur === 4000, `round 3: ${sx.viewer === 'b' ? 'the first hider (Sydney)' : 'WRONG hider'} hides again, ${sx.phase.dur / 1000} s on the clock`);
      assert(/Sudden death/.test(await a.textContent('.chm-role')), 'the role pill says Sudden death');
    });
    await hotSeek(a);
    s = await st(a);
    assert(s.phase.dur === 5000, `…and a ${s.phase.dur / 1000} s hunt`);
    await waitPhase(a, 'time', 20000);
    s = await st(a);
    assert(s.round.rec.points === 35, `round 3: b survives for ${s.round.rec.points}`);
    await waitPhase(a, 'recap', 8000);
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'curtain', 10000);
    // round 4: a hides and is found at once
    await hotHide(a, () => camoHide(a));
    await hotSeek(a);
    await aimAtHider(a, 'a');
    await hook(a, 'action', 'fire');
    await waitPhase(a, 'found', 6000);
    await waitPhase(a, 'recap', 8000);
    assert(/See who won/.test(await a.textContent('.chm-recap [data-act="next"]')), 'after the pair the button reads See who won');
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'final', 10000);
    await wait(500);
    s = await st(a);
    assert(s.match.scores.b > s.match.scores.a, `the pair decides it: ${s.match.scores.a}–${s.match.scores.b}`);
    const fin = await a.textContent('.chm-final');
    assert(/Sudden death/i.test(fin), 'the final card shows that sudden death decided it');
    await wait(500);
    const d = await hook(a, 'data');
    assert((d.b_sd_wins | 0) === 1 && !(d.a_sd_wins | 0), `b_sd_wins recorded (${d.b_sd_wins})`);
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); failures++; await shot(a, 'sudden-FAIL').catch(() => {}); } finally { await h.close(); }
}

async function streakSection(port) {
  console.log('\n# hotseat: the called-it streak pays 5 / 10 / 15 and the hider sees "Streak broken"');
  const h = await launch({ port, only: ['chameleon'], who: ['a'] });
  const a = h.a;
  try {
    await startHot(h, { rules: { rounds: 4, seekScore: 'off', wager: 5, blendBonus: 0, underdog: false, twists: 'off', sudden: false }, tune: { ...FAST, seek: 6000 } });
    // round 1: a seeks and calls WALL right; his run was already 2 → the 3rd call pays 15
    await hook(a, 'forceStreak', 'a', 2);
    await hotHide(a, () => camoHide(a));
    await a.tap('[data-call="wall"]');
    assert((await hook(a, 'polish')).call.a === 'wall', 'the seeker picked WALL on the hand-over curtain');
    await hotSeek(a);
    await waitPhase(a, 'time', 20000);
    let rec = (await st(a)).round.rec;
    assert(rec.called && rec.wagerPts === 5 && !rec.streak && (await ti(a)).cs.a === 2, `a right call on a SURVIVED round pays the plain stake (${rec.wagerPts}) and leaves the run at ${(await ti(a)).cs.a}`);
    assert((await st(a)).match.scores.a === 5, 'only the 5 is in the seeker\'s score');
    await waitPhase(a, 'recap', 8000);
    const pop = await collectPops(a, 5000);
    assert(/CALLED IT/.test(pop) && !/in a row/.test(pop), `the sticker says it without a streak ("${pop.slice(0, 120)}")`);
    // round 2: b seeks with a run of 2 and calls wrong
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'curtain', 10000);
    await hook(a, 'forceStreak', 'b', 2);
    await hotHide(a, () => camoHide(a));
    await a.tap('[data-call="floor"]');
    await hotSeek(a);
    await waitPhase(a, 'time', 20000);
    rec = (await st(a)).round.rec;
    assert(!rec.called && rec.streakBroken === 2 && !rec.wagerPts, `a wrong call ends the run of ${rec.streakBroken}`);
    assert((await ti(a)).cs.b === 0, 'the run is back to 0');
    await waitPhase(a, 'recap', 8000);
    const pop2 = await collectPops(a, 7000);
    assert(/STREAK BROKEN/.test(pop2), `the hider sees "Streak broken" ("${pop2.slice(0, 120)}")`);
    // round 3: a seeks again (run still 2), calls WALL right and FINDS the hider: the 3rd in a row pays 15
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'curtain', 10000);
    await hotHide(a, () => camoHide(a));
    await a.tap('[data-call="wall"]');
    await hotSeek(a);
    await aimAtHider(a, 'b');
    await hook(a, 'action', 'fire');
    await waitPhase(a, 'found', 6000);
    rec = (await st(a)).round.rec;
    assert(rec.found && rec.called && rec.streak === 3 && rec.wagerPts === 15, `a right call on a round the hider was FOUND, as the 3rd in a row, pays ${rec.wagerPts} (streak ${rec.streak})`);
    await waitPhase(a, 'recap', 8000);
    const pop3 = await collectPops(a, 6000);
    assert(/CALLED IT/.test(pop3) && /3 in a row/.test(pop3), `the sticker says it ("${pop3.slice(0, 120)}")`);
    await wait(300);
    assert(((await hook(a, 'data')).a_callstreak | 0) === 3, 'a_callstreak = 3');
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); failures++; await shot(a, 'streak-FAIL').catch(() => {}); } finally { await h.close(); }
}

async function hostReloadSection(port) {
  console.log('\n# two phones: the HOST reloads mid-round (the clock keeps its absolute end; the seeker can still fire; the wager call survives)');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  const rem = async (p) => { const s = await st(p); return { left: s.phase.end - s.now, hunting: s.hunting, name: s.phase.name }; };
  try {
    const tune = { ...FAST, hide: 30000, seek: 40000, title: 800, recap: 30000, found: 1800, twists: [null, null] };
    await startPair(h, tune);
    await startMatch(h, { map: 'living', first: 'a', rules: { rounds: 2, twists: 'off', underdog: false, sudden: false, wager: 5 } });
    await waitPhase(a, 'hide', 40000); await waitPhase(b, 'hide', 15000);
    // b seeks: it picks a call on the blind card
    await b.tap('[data-call="floor"]');
    await wait(500);
    assert((await hook(b, 'polish')).call.b === 'floor', 'the seeker chose FLOOR on the blind card');
    await wait(2500);
    const before = await rem(a);
    await h.closeGame(a); await wait(1500); await arm(a, tune); await h.startLive(a, 'chameleon', 'live'); await waitLinked(a);
    await a.waitForFunction(() => window.__cham.state().match && window.__cham.state().phase.name === 'hide', null, { timeout: 25000 });
    await wait(1500);
    const after = await rem(a); const afterB = await rem(b);
    assert(after.left < before.left + 4500 && afterB.left < before.left + 4500, `the hide clock does not jump after the host's reload (${Math.round(before.left / 1000)} s -> ${Math.round(after.left / 1000)} s host, ${Math.round(afterB.left / 1000)} s guest)`);
    assert(Math.abs(after.left - afterB.left) < 1500, 'both phones agree on the clock afterwards');
    // hunt: the hider (a) readies, the host reloads again mid-hunt
    await camoHide(a);
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 30000); await waitPhase(b, 'seek', 10000);
    await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 15000 });
    await wait(2500);
    const hb = await rem(b);
    await h.closeGame(a); await wait(1500); await arm(a, tune); await h.startLive(a, 'chameleon', 'live'); await waitLinked(a);
    await a.waitForFunction(() => window.__cham.state().match && window.__cham.state().phase.name === 'seek', null, { timeout: 25000 });
    await wait(1500);
    const ha = await rem(a); const hb2 = await rem(b);
    assert(ha.left < hb.left + 4500 && hb2.left < hb.left + 4500, `the hunt clock does not jump either (${Math.round(hb.left / 1000)} s -> ${Math.round(ha.left / 1000)} s)`);
    await b.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 6000 });
    assert(ha.hunting || (await rem(a)).hunting, 'the hunt is still on: hunting stays true after the host reload');
    // the seeker (b, guest) reloads mid-hunt: the call survives from the host's snapshot
    await h.closeGame(b); await wait(1500); await arm(b, tune); await h.startLive(b, 'chameleon', 'live'); await waitLinked(b);
    await b.waitForFunction(() => window.__cham.state().match && window.__cham.state().phase.name === 'seek', null, { timeout: 25000 });
    await wait(1200);
    assert((await hook(b, 'polish')).call.b === 'floor', 'a reloaded seeker keeps the wager call chosen on the blind card');
    h.assertNoErrors();
  } catch (e) { console.error(e.message.split('\n')[0], h.errors); failures++; await shot(a, 'hostreload-FAIL-a').catch(() => {}); } finally { await h.close(); }
}

async function fogSection(port) {
  console.log('\n# two phones, House: Fog rolls in');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, seek: 14000, hide: 20000, twists: ['fog', 'dusk'] });
    await startMatch(h, { map: 'house', first: 'b', rules: { rounds: 2, twists: 'every', blendBonus: 0, seekScore: 'off', wager: 0, underdog: false, sudden: false } });
    await waitPhase(b, 'hide', 40000); await waitPhase(a, 'hide', 8000);
    const t0 = await ti(a);
    assert(t0.twist === 'fog' && (await ti(b)).twist === 'fog', 'round 1 is Fog rolls in on both phones');
    const blind = await a.evaluate(() => (document.querySelector('.chm-blind') || {}).textContent || '');
    assert(/Fog rolls in/.test(blind), "the seeker's blind card announces it");
    const role = await b.textContent('.chm-role');
    assert(/Fog/.test(role), `the role pill carries it ("${role.trim()}")`);
    await camoHide(b);
    await b.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 30000); await waitPhase(b, 'seek', 8000);
    await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    const base = await ti(a); const progs0 = (await hook(a, 'bootInfo')).programs;
    assert(base.mood.fogFar === 26 && !base.mood.on, `the hunt starts with the map's fog (${base.mood.fogNear}–${base.mood.fogFar} m)`);
    // sample both phones through the hunt
    const fars = { a: new Set(), b: new Set() }; const calls = []; const sa = null; const sb = null; let shotRange = null;
    const t = Date.now();
    while ((await st(a)).phase.name === 'seek' && Date.now() - t < 30000) {
      for (const [w, p] of [['a', a], ['b', b]]) { const x = await ti(p); fars[w].add(Math.round(x.mood.fogFar * 100) / 100); if (w === 'a') calls.push(x.calls); }
      if (!shotRange && (await ti(a)).mood.fogFar < 20) { // the pellet's range follows the fog
        await hook(a, 'action', 'fire');
        const x = await ti(a); const ls = (await st(a)).lastShot;
        shotRange = ls && ls.range ? { range: ls.range, far: x.mood.fogFar } : { range: -1, far: x.mood.fogFar };
      }
      await wait(220);
    }
    assert(Math.max(...calls) <= 80, `draw calls stay in budget (${Math.max(...calls)} ≤ 80)`);
    assert((await hook(a, 'bootInfo')).programs === progs0, `no shader was linked for the fog (${progs0} programs before and after)`);
    await b.waitForFunction(() => window.__cham.state().phase.name !== 'seek', null, { timeout: 8000 });
    await wait(300);
    // every step each phone applied (the game logs them), not what the polling happened to catch
    const la = (await ti(a)).mood.log; const lb = (await ti(b)).mood.log;
    const far = (l) => l.map((x) => x.fogFar);
    assert(la.length >= 5 && la.length <= 6 && la.every((x, i) => i === 0 || x.fogFar < la[i - 1].fogFar), `the fog closed in ${la.length} steps: ${far(la).map((x) => x.toFixed(1)).join(' → ')} m`);
    assert(Math.abs(la[la.length - 1].fogFar - 26 * 0.45) < 2.3 && la[0].fogFar > 26 * 0.8, `…from about 90 % down to about 45 % (${la[la.length - 1].fogFar.toFixed(1)} m of 26)`);
    assert(lb.length >= 5 && lb.length <= 6 && Math.abs(lb[lb.length - 1].fogFar - la[la.length - 1].fogFar) < 2.3, 'the hider\'s phone applied the same steps');
    const dur = la[la.length - 1].at - la[0].at;
    assert(dur > 1500 && dur < 7000, `…all of them in the last third of the hunt (${(dur / 1000).toFixed(1)} s between the first and last step of a 14 s hunt)`);
    void sa; void sb;
    assert(shotRange && shotRange.range > 0 && shotRange.range <= 20.5 && Math.abs(shotRange.range - shotRange.far) < 5, `a pellet fired in the thick of it reaches ${shotRange && shotRange.range.toFixed(1)} m (the fog's far edge was ${shotRange && shotRange.far.toFixed(1)} m, not the 26 m of a clear day)`);
    for (const p of [a, b]) {
      const x = await ti(p);
      assert(!x.mood.on && x.mood.fogFar === 26 && x.mood.fogNear === 11 && x.mood.hemi === x.mood.baseHemi && x.mood.sun === x.mood.baseSun && x.mood.baseHemi === 0.56 && x.mood.baseSun === 0.50 && x.mood.bg === x.mood.fogColor, 'at the round\'s end the fog is back exactly (11–26 m, lights, sky)');
    }
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); failures++; await shot(a, 'fog-FAIL-a').catch(() => {}); await shot(b, 'fog-FAIL-b').catch(() => {}); } finally { await h.close(); }
}

async function duskSection(port) {
  console.log('\n# two phones: Dusk (lights fade in steps, brighter glints, nothing relinked, restored exactly)');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, seek: 12000, twists: ['dusk', 'fog'] });
    await startMatch(h, { map: 'living', first: 'b', rules: { rounds: 2, twists: 'every', blendBonus: 0, underdog: false, sudden: false } });
    await waitPhase(b, 'hide', 40000); await waitPhase(a, 'hide', 8000);
    assert(await a.evaluate(() => /Dusk/.test(document.querySelector('.chm-blind').textContent)), 'the seeker\'s blind card says Dusk');
    await camoHide(b);
    await b.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 30000); await waitPhase(b, 'seek', 8000);
    await a.waitForFunction(() => window.__cham.state().hunting, null, { timeout: 8000 });
    const progs0 = (await hook(a, 'bootInfo')).programs; const progsB0 = (await hook(b, 'bootInfo')).programs;
    const hemis = []; let glintBright = false;
    const t = Date.now();
    while ((await st(a)).phase.name === 'seek' && Date.now() - t < 30000) {
      const xa = await ti(a); const xb = await ti(b);
      hemis.push([xa.mood.hemi, xb.mood.hemi]);
      if (xa.mood.glint !== 'ffd23f') glintBright = true;
      await wait(250);
    }
    await b.waitForFunction(() => window.__cham.state().phase.name !== 'seek', null, { timeout: 8000 });
    await wait(300);
    const la = (await ti(a)).mood.log; const lb = (await ti(b)).mood.log;
    assert(la.length >= 8 && la.length <= 12 && la.every((x, i) => i === 0 || x.hemi < la[i - 1].hemi), `the light fades in ${la.length} steps (${la[0].hemi.toFixed(2)} → ${la[la.length - 1].hemi.toFixed(2)})`);
    assert(la[la.length - 1].hemi > 0.2 && la[0].hemi < 0.56, 'dim, never dark');
    assert(lb.length >= 8 && Math.abs(lb[lb.length - 1].hemi - la[la.length - 1].hemi) < 0.06, 'the other phone fades the same way');
    assert(glintBright, 'the scan glints turn brighter in the dark');
    assert((await hook(a, 'bootInfo')).programs === progs0 && (await hook(b, 'bootInfo')).programs === progsB0, `no shader was linked for the dusk (${progs0} programs before and after)`);
    await b.waitForFunction(() => window.__cham.state().phase.name !== 'seek', null, { timeout: 8000 });
    await wait(300);
    for (const p of [a, b]) { const x = (await ti(p)).mood; assert(!x.on && x.hemi === x.baseHemi && x.sun === x.baseSun && x.baseSun === 0.50 && x.glint === 'ffd23f', 'back to the plain light at the round\'s end'); }
    // the recap says what's next, both phones
    await waitPhase(a, 'recap', 8000);
    for (const p of [a, b]) assert(/Twist: Fog rolls in/.test(await p.textContent('.chm-nextline')), 'the recap\'s Next line announces the next twist');
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); failures++; await shot(a, 'dusk-FAIL-a').catch(() => {}); await shot(b, 'dusk-FAIL-b').catch(() => {}); } finally { await h.close(); }
}

async function coloursSection(port) {
  console.log('\n# two phones: Three colours');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, seek: 8000, hide: 25000, twists: ['colours', 'colours'] });
    await startMatch(h, { map: 'living', first: 'b', rules: { rounds: 2, twists: 'every', blendBonus: 0, underdog: false, sudden: false } });
    await waitPhase(b, 'hide', 40000); await waitPhase(a, 'hide', 8000);
    await wait(500);
    const tb = await ti(b); const ta = await ti(a);
    assert(tb.twist === 'colours' && tb.palette && tb.palette.length === 3 && JSON.stringify(tb.palette) === JSON.stringify(ta.palette), `both phones derive the same three swatches (${tb.palette && tb.palette.join(' ')})`);
    assert(tb.lockOn && tb.palLocked && !ta.lockOn, 'only the hider\'s paint is locked');
    await b.tap('.chm-acts [data-act="paint"]');
    await wait(700);
    const chips = await b.evaluate(() => [...document.querySelectorAll('.chm-tools [data-lockcol], .chm-tools .chm-lockchip, .chm-tools [data-chip]')].length);
    const pr = (await st(b)).paint;
    const hexToRgb = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
    const pal = tb.palette.map(hexToRgb);
    const inPal = (rgb) => pal.some((c) => Math.hypot(c[0] - rgb[0], c[1] - rgb[1], c[2] - rgb[2]) < 6);
    assert(pr && inPal(pr.rgb), `the brush starts on a swatch (${pr && pr.rgb})`);
    await hook(b, 'setPaint', { rgb: [3, 200, 7] });
    await wait(400);
    assert(inPal((await st(b)).paint.rgb), 'a colour outside the palette snaps back to a swatch');
    // Stamp is refused
    const h0 = await hook(b, 'paintHash', 'b');
    await hook(b, 'stampNow');
    await wait(500);
    assert(await hook(b, 'paintHash', 'b') === h0, 'Stamp does nothing this round');
    void chips;
    await shot(b, 'colours-paint');
    await b.tap('.chm-acts [data-act="ready"]').catch(() => {});
    await b.tap('.chm-tools [data-act="done"], .chm-done').catch(() => {});
    await waitPhase(a, 'seek', 40000);
    await waitPhase(a, 'time', 20000); await waitPhase(b, 'time', 5000);
    await wait(300);
    assert(!(await ti(b)).lockOn, 'the lock is cleared when the round ends');
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); failures++; await shot(a, 'colours-FAIL-a').catch(() => {}); await shot(b, 'colours-FAIL-b').catch(() => {}); } finally { await h.close(); }
}

async function underdogSection(port) {
  console.log('\n# two phones: Underdog (+1 escape hiding, +1 pellet seeking)');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, seek: 7000, hide: 12000 });
    await startMatch(h, { map: 'living', first: 'b', rules: { rounds: 4, twists: 'off', blendBonus: 0, seekScore: 'off', wager: 0, underdog: true, sudden: false, pellets: 6, escapes: 1 } });
    await waitPhase(b, 'hide', 40000); await waitPhase(a, 'hide', 8000);
    let ta = await ti(a);
    assert(!ta.ud && ta.maxPellets === 6 && ta.escapes.b === 1, 'round 1: nobody is behind yet');
    await camoHide(b);
    await b.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 30000);
    await waitPhase(a, 'time', 20000); await waitPhase(b, 'time', 5000); // b survives: 7 + 30 = 37
    await waitPhase(a, 'recap', 8000);
    assert((await st(a)).match.scores.b === 37, 'Sydney banked 37 points');
    await hook(a, 'forceScores', 0, 50); // 50 behind, but the underdog never starts before round 3
    await a.tap('[data-act="next"]');
    await waitPhase(a, 'hide', 20000); await waitPhase(b, 'hide', 8000);
    await wait(400);
    for (const p of [a, b]) { const x = await ti(p); assert(!x.ud && x.escapes.a === 1 && x.maxPellets === 6, 'round 2: 50 points behind, but nobody is boosted before round 3'); }
    await camoHide(a);
    await a.tap('.chm-acts [data-act="ready"]');
    await waitPhase(b, 'seek', 30000);
    await aimAtHider(b, 'a');
    await hook(b, 'action', 'fire');
    await waitPhase(a, 'found', 8000);
    await waitPhase(a, 'recap', 8000);
    await hook(a, 'forceScores', 0, 50);
    await a.tap('[data-act="next"]');
    // round 3: b hides, a (50 behind) seeks with +1 pellet
    await waitPhase(a, 'hide', 20000); await waitPhase(b, 'hide', 8000);
    await wait(400);
    for (const p of [a, b]) { const x = await ti(p); assert(x.ud === 'a' && x.maxPellets === 7 && x.pellets.a === 7 && x.escapes.b === 1, 'round 3: Emerson seeks as the underdog: 7 pellets on both phones, the hider\'s escapes unchanged'); }
    await camoHide(b);
    await b.tap('.chm-acts [data-act="ready"]');
    await waitPhase(a, 'seek', 30000);
    await waitPhase(a, 'time', 20000); await waitPhase(a, 'recap', 8000);
    await hook(a, 'forceScores', 0, 60);
    await a.tap('[data-act="next"]');
    // round 4: a hides, still behind: +1 escape
    await waitPhase(a, 'hide', 20000); await waitPhase(b, 'hide', 8000);
    await wait(400);
    for (const p of [a, b]) { const x = await ti(p); assert(x.ud === 'a' && x.escapes.a === 2 && x.escapes.b === 1 && x.maxPellets === 6, 'round 4: Emerson hides as the underdog: 2 escapes (Sydney still 1), pellets unchanged'); }
    const pops = await collectPops(a, 3000);
    assert(/Underdog: \+1 escape/.test(pops), `the hider sees the sticker ("${pops}")`);
    assert(/Underdog/.test(await b.evaluate(() => document.querySelector('.chm-blind').textContent)), "the seeker's blind card says it too");
    h.assertNoErrors();
  } catch (e) { console.error(e.message, h.errors); failures++; await shot(a, 'underdog-FAIL-a').catch(() => {}); await shot(b, 'underdog-FAIL-b').catch(() => {}); } finally { await h.close(); }
}

async function dbSuddenSection(port) {
  console.log('\n# two phones, Double Blind: a tie after round 3 plays one 60 s sudden-death round');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  try {
    await startPair(h, { ...FAST, seek: 15000, hide: 40000, found: 6000, maxDpr: 0.45 });
    await startMatch(h, { map: 'living', mode: 'db', rules: { twists: 'off', sudden: true, seek: 120 } });
    const both = async (name, to = 30000) => { try { await waitPhase(a, name, to); await waitPhase(b, name, 8000); } catch (e) { const sa = await st(a); const sb = await st(b); console.error(`  (round ${sa.phase.round} waiting for ${name}: a tagcheck ${JSON.stringify(sa.lastTagCheck)} a is in ${sa.phase.name}, b in ${sb.phase.name}; a shot ${JSON.stringify(sa.lastShot)} used ${JSON.stringify(sa.round.used)}; b shot ${JSON.stringify(sb.lastShot)} tagcheck ${JSON.stringify(sb.lastTagCheck)} used ${JSON.stringify(sb.round.used)}; hunting ${sa.hunting}/${sb.hunting}; bodies a ${JSON.stringify(sa.bodies.a && [sa.bodies.a.x, sa.bodies.a.z])} b ${JSON.stringify(sb.bodies.b && [sb.bodies.b.x, sb.bodies.b.z])} drawn a@b ${JSON.stringify(sb.drawn.a.p)} vis ${JSON.stringify(sb.visible)})`); throw e; } };
    const hideBoth = async () => { await both('hide', 40000); await camoHide(a); await hook(b, 'setPose', 'crouch'); await a.tap('.chm-acts [data-act="ready"]'); await b.tap('.chm-acts [data-act="ready"]'); await both('seek', 30000); await wait(1800); };
    // round 1: b tags a
    await hideBoth();
    await aimAtHider(b, 'a');
    await hook(b, 'action', 'fire');
    await both('found', 8000);
    await both('recap', 8000);
    await a.tap('[data-act="next"]');
    // round 2: a tags b
    await hideBoth();
    await aimAtHider(a, 'b');
    await hook(a, 'action', 'fire');
    await both('found', 8000);
    await both('recap', 8000);
    await a.tap('[data-act="next"]');
    // round 3: void (both look at the ceiling and spray)
    await hideBoth();
    for (const p of [a, b]) await hook(p, 'lookAtPitch', 1.4);
    const n0 = (await st(a)).round.pellets.a;
    for (let i = 0; i < n0; i++) for (const p of [a, b]) await hook(p, 'action', 'fire');
    await both('time', 12000);
    let t = await ti(a);
    assert((await st(a)).match.scores.a === 1 && (await st(a)).match.scores.b === 1, '1–1 after three rounds');
    assert(t.sd === 1 && t.rounds === 4, 'one sudden-death round was added (4 rounds)');
    await both('recap', 8000);
    assert(!/See who won/.test(await a.textContent('.chm-recap [data-act="next"]')), 'the recap does not end the match');
    for (const p of [a, b]) await p.evaluate(() => { window.__chamTune.seek = 0; window.__chamTune.sdHide = 30000; }); // the real clock for the cap (120 s on the setting); a longer sudden-death hide for a slow box
    await a.tap('[data-act="next"]');
    await hideBoth();
    t = await ti(a);
    assert(t.seekMs === 60000 && t.hideMs === 30000, `round 4: the sudden-death hide clock (${t.hideMs / 1000} s here), the 120 s hunt capped at ${t.seekMs / 1000} s`);
    assert(await a.evaluate(() => /Sudden death/.test(document.querySelector('.chm-role').textContent)), 'the role pill says Sudden death');
    await aimAtHider(a, 'b');
    await hook(a, 'action', 'fire');
    await both('found', 8000);
    await both('recap', 8000);
    assert(/See who won/.test(await a.textContent('.chm-recap [data-act="next"]')), 'then See who won');
    await a.tap('[data-act="next"]');
    await both('final', 10000);
    await wait(500);
    const fin = await a.textContent('.chm-final');
    assert(/Sudden death/i.test(fin) && (await st(a)).match.scores.a === 2, 'the final card shows sudden death, Emerson wins 2–1');
    await wait(400);
    assert(((await hook(a, 'data')).a_sd_wins | 0) === 1, 'a_sd_wins recorded');
    h.assertNoErrors();
  } catch (e) { console.error(e.message.split('\n')[0], (e.stack || '').split('\n').filter((l) => /twists.test/.test(l)).slice(0, 2).join(' / '), h.errors); failures++; await shot(a, 'dbsd-FAIL-a').catch(() => {}); await shot(b, 'dbsd-FAIL-b').catch(() => {}); } finally { await h.close(); }
}

async function rowsSection(port) {
  console.log('\n# two phones: the new rows in the settings sheet');
  const h = await launch({ port, only: ['chameleon'] });
  const { a, b } = h;
  const SEL = '.chm-sheet [data-k="twists"], .chm-sheet [data-k="underdog"], .chm-sheet [data-k="sudden"]';
  try {
    await startPair(h);
    await a.tap('[data-act="settings"]');
    await a.waitForSelector('.chm-sheet [data-k="twists"]');
    const rows = await a.evaluate((sel) => ({ n: new Set([...document.querySelectorAll(sel)].map((x) => x.dataset.k)).size, dup: document.querySelectorAll('.chm-sheet [data-k="twists"][data-v="every"]').length, small: [...document.querySelectorAll(sel)].filter((x) => { const r = x.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).length }), SEL);
    assert(rows.n === 3 && rows.dup === 1, 'three rows (Round twists, Underdog boost, Sudden death), each once');
    assert(rows.small === 0, 'every button in them is at least 44 × 44');
    assert((await st(a)).setup.rules.twists === 'some', 'default: some rounds');
    await a.tap('.chm-sheet [data-k="twists"][data-v="every"]');
    await b.waitForFunction(() => window.__cham.state().setup.rules.twists === 'every', null, { timeout: 5000 });
    assert((await st(a)).setup.rules.preset === 'custom', 'changing it makes the setup Custom');
    await a.tap('.chm-sheet [data-k="sudden"][data-v="false"]');
    await a.tap('.chm-sheet [data-k="underdog"][data-v="false"]');
    await b.waitForFunction(() => { const r = window.__cham.state().setup.rules; return r.sudden === false && r.underdog === false; }, null, { timeout: 5000 });
    await a.tap('.chm-sheet [data-lobby="preset"][data-v="classic"]');
    const r2 = (await st(a)).setup.rules;
    assert(r2.twists === 'some' && r2.underdog === true && r2.sudden === true && r2.preset === 'classic', 'Classic brings the defaults back');
    await b.tap('[data-act="settings"]');
    await b.waitForSelector('.chm-sheet [data-k="twists"]');
    assert(await b.evaluate((sel) => [...document.querySelectorAll(sel)].every((x) => x.disabled), SEL), 'the guest sees the rows read-only');
    h.assertNoErrors();
  } catch (e) { console.error(e.message.split('\n')[0], h.errors); failures++; await shot(a, 'rows-FAIL-a').catch(() => {}); } finally { await h.close(); }
}

async function shotsSection(port) {
  console.log('\n# card layouts: portrait, landscape, dark (twist sticker on title / blind / curtain / recap)');
  for (const [colorScheme, vp, tag] of [['light', { width: 390, height: 844 }, 'portrait'], ['light', { width: 844, height: 390 }, 'landscape'], ['dark', { width: 390, height: 844 }, 'dark']]) {
    const h = await launch({ port: port + (tag === 'portrait' ? 0 : tag === 'landscape' ? 1 : 2), only: ['chameleon'], colorScheme });
    const { a, b } = h;
    try {
      await startPair(h, { ...FAST, title: 2500, hide: 25000, seek: 8000, recap: 9000, twists: ['bounty', 'dusk'] });
      await a.setViewportSize(vp); await b.setViewportSize(vp);
      await startMatch(h, { map: 'living', first: 'b', rules: { rounds: 2, twists: 'every', seekScore: 'full', wager: 5, sudden: true, underdog: true } });
      await waitPhase(b, 'hide', 40000);
      await wait(500);
      await shot(a, `${tag}-blind-seeker`);
      await camoHide(b);
      await b.tap('.chm-acts [data-act="ready"]');
      await waitPhase(a, 'recap', 80000);
      await wait(500);
      await shot(a, `${tag}-recap-next`);
      const fit = await a.evaluate(() => { const c = document.querySelector('.chm-recap .chm-card'); const n = document.querySelector('.chm-nextline'); if (!n) return { over: c.scrollHeight - c.clientHeight, nextIn: false, text: '(none)' }; const r = n.getBoundingClientRect(); return { over: c.scrollHeight - c.clientHeight, nextIn: r.bottom <= innerHeight + 1 && r.top >= 0, text: n.textContent }; });
      console.log(`  ${tag}: next line "${fit.text.trim()}" in view ${fit.nextIn}, card overflow ${fit.over}px`);
      h.assertNoErrors();
    } catch (e) { console.error(e.message, h.errors); failures++; await shot(a, `${tag}-FAIL`).catch(() => {}); } finally { await h.close(); }
  }
}

(async () => {
  if (want('unit')) await unitSection();
  const sections = [];
  if (want('bugA')) sections.push(() => bugASection(PORT + 0));
  if (want('hotrules')) sections.push(() => hotRulesSection(PORT + 1));
  if (want('bounty')) sections.push(() => bountySection(PORT + 2));
  if (want('budget')) sections.push(() => budgetSection(PORT + 8));
  if (want('hotcolours')) sections.push(() => hotColoursSection(PORT + 6));
  if (want('hotunder')) sections.push(() => hotUnderdogSection(PORT + 7));
  if (want('sudden')) sections.push(() => suddenSection(PORT + 3));
  if (want('streak')) sections.push(() => streakSection(PORT + 4));
  if (want('hostreload')) sections.push(() => hostReloadSection(PORT + 12));
  if (want('fog')) sections.push(() => fogSection(PORT + 5));
  if (want('dusk')) sections.push(() => duskSection(PORT + 6));
  if (want('colours')) sections.push(() => coloursSection(PORT + 7));
  if (want('underdog')) sections.push(() => underdogSection(PORT + 8));
  if (want('dbsd')) sections.push(() => dbSuddenSection(PORT + 9));
  if (want('rows')) sections.push(() => rowsSection(PORT + 10));
  if (want('shots')) sections.push(() => shotsSection(PORT + 11));
  for (const s of sections) await s();
  if (failures) { console.error(`\n${failures} section(s) failed`); process.exitCode = 1; } else console.log('\nALL GOOD');
})();
