// Rail Rush: generator determinism + passability, feel numbers, synchronized live start, a full
// live Race with UI inputs and weapons, Brawl shove, Tandem revive, disconnect / visibility /
// GL-context pauses, one-computer split screen, leaks, packet loss, steady-state allocations and
// heap growth, seamlessness (late lobby, partner / host re-mounts mid-race, 30 s in the
// background, a much slower partner), and screenshots in light and dark.
//   node tools/test/games/rush.test.js            (ONLY=gen,race,... to run some sections)
// Sections: gen race brawl tandem pause daily | split leak | drop | dark | heap | seam. Ports 8960-8969.
// (the author runs two halves: ONLY=gen,split,leak,drop,dark and ONLY=race,brawl,tandem,pause,daily)
const fs = require('fs');
const { launch } = require('../harness');

const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-Couple-game/0bac2931-fb3f-54c3-8279-c15850ed70e8/scratchpad/rush-polish/test';
fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
let fails = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const soft = (c, m) => { if (!c) { fails++; console.log('not ok -', m); } else console.log('ok -', m); };
const DEBUG = { raceLen: 700, noTutorial: true };

const S = (pg) => pg.evaluate(() => window.__rush && window.__rush.state());
const until = async (pg, fn, arg, ms = 15000, what = 'condition') => {
  try { await pg.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); } catch {
    const st = await pg.evaluate(() => { const s = window.__rush && window.__rush.state(); return s && { phase: s.phase, paused: s.paused, reasons: s.reasons, partnerPz: s.partnerPz, rtt: s.rtt, a: { z: s.a.z, lane: s.a.lane, down: s.a.down }, b: { z: s.b.z, lane: s.b.lane, down: s.b.down } }; }).catch(() => null);
    throw new Error('FAIL: timed out waiting for ' + what + ' ' + JSON.stringify(st));
  }
};
const shot = (pg, name) => pg.screenshot({ path: `${SHOTS}/${name}.png` });

async function swipe(pg, x0, y0, dx, dy) {
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 4; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / 4, y: y0 + (dy * i) / 4 }] });
    await new Promise((r) => setTimeout(r, 12));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Tap the weapon slot once the HUD shows it loaded (an empty slot lets taps through). */
async function fireWeapon(pg) {
  await until(pg, () => !!document.querySelector('.g-rush .rr-weapon.full'), null, 5000, 'weapon slot loaded');
  await pg.click('.g-rush .rr-weapon', { force: true }); // it wobbles while loaded, so skip the stability wait
}

async function openLivePair(h, extra = {}) {
  const { a, b } = h;
  for (const pg of [a, b]) await pg.evaluate((d) => { window.__RUSH_DEBUG = d; }, { ...DEBUG, ...extra });
  await h.startLive(a, 'rush', 'live');
  await h.settle();
  const invited = await b.isVisible('#gm-invite').catch(() => false);
  if (invited) await b.click('#gm-invite [data-g="invite-yes"]');
  else await h.startLive(b, 'rush', 'live'); // invite dropped (packet loss): open it directly
  await until(a, () => window.__rush && window.__rush.state().ready3D, null, 30000, 'host 3D ready');
  await until(b, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().synced, null, 30000, 'guest ready + clock synced');
}

async function pickAndStart(h, mode) {
  const { a, b } = h;
  await until(a, () => !document.querySelector('.g-rush .rr-ov-lobby [data-r="go"]').disabled, null, 15000, 'start enabled');
  await a.click(`.g-rush .rr-mode[data-mode="${mode}"]`);
  await until(b, (m) => window.__rush.state().lobbyMode === m && document.querySelector(`.g-rush .rr-mode[data-mode="${m}"]`).classList.contains('on'), mode, 8000, 'guest sees the mode');
  await a.click('.g-rush .rr-ov-lobby [data-r="go"]');
  await until(a, () => ['countdown', 'run'].includes(window.__rush.state().phase), null, 8000, 'host counting down');
  await until(b, () => ['countdown', 'run'].includes(window.__rush.state().phase), null, 8000, 'guest counting down');
}

async function waitRun(pg) { await until(pg, () => window.__rush.state().phase === 'run' && window.__rush.state().steps > 30, null, 15000, 'running'); }

(async () => {
  // ═══ two phones, live ═══
  if (['gen', 'race', 'brawl', 'tandem', 'pause', 'daily'].some(want)) {
    const h = await launch({ port: 8960, only: ['rush'], latency: 80, coarse: true });
    const { a, b } = h;
    try {
      await openLivePair(h);
      if (want('gen')) {
        // feel numbers, measured on the real sim
        const pr = await a.evaluate(() => window.__rush.probe());
        assert(pr.laneMs >= 100 && pr.laneMs <= 150, `lane change completes in ${pr.laneMs.toFixed(0)} ms (snappy: 100–150 ms)`);
        assert(pr.jumpApex > 1.5 && pr.jumpApex < 1.9 && pr.airMs > 550 && pr.airMs < 900, `jump: apex ${pr.jumpApex.toFixed(2)} m, ${pr.airMs.toFixed(0)} ms in the air`);
        assert(pr.softCrashes === 0 && pr.softStumbles === 1, 'a missed warm-up row trips you up instead of knocking you down');
        assert(pr.diff200 <= 0.15 && pr.diff30s <= 0.32 && pr.diff2k >= 0.8, `difficulty is gentle for the first 30 s (${pr.diff200} at 200 m, ${pr.diff30s} at 430 m) and ramps to ${pr.diff2k} at 2 km`);
        const seeds = [1, 42, 1337, 98765, 2024];
        const ha = await a.evaluate((ss) => ss.map((s) => window.__rush.trackHash(s, 40)), seeds);
        const hb = await b.evaluate((ss) => ss.map((s) => window.__rush.trackHash(s, 40)), seeds);
        assert(ha.every((x, i) => x === hb[i]) && new Set(ha).size === seeds.length, `track layouts identical on both devices for ${seeds.length} seeds (40 chunks each)`);
        // fairness: a lane change begun just before a head-on is a clip (stumble), a square hit a crash
        const p2 = await a.evaluate(() => window.__rush.probe2());
        assert(p2.late.crashes === 0 && p2.late.clips === 1 && p2.late.stumbles === 1, `a swipe a step before a barrier clips it (stumble, bounce back), no heart lost (${JSON.stringify(p2.late)})`);
        assert(p2.none.crashes === 1 && p2.none.clips === 0, `the same barrier hit square on is a crash (${JSON.stringify(p2.none)})`);
        assert(p2.early.crashes === 0 && p2.early.stumbles === 0, `a swipe in time passes clean (${JSON.stringify(p2.early)})`);
        assert(p2.combo.max >= 3 && p2.combo.bonus >= 5, `near-miss combos pay bonus coins: x${p2.combo.max} max, +${p2.combo.bonus} bonus, ${p2.combo.closeCalls} close calls over 1.2 km of perfect running`);
        // the Daily seed: one track for both, all day
        const da = await a.evaluate(() => [window.__rush.dailySeed(), window.__rush.dailySeed('2026-01-02')]);
        const db = await b.evaluate(() => [window.__rush.dailySeed(), window.__rush.dailySeed('2026-01-02')]);
        assert(da[0] === db[0] && da[1] === db[1] && da[0] !== da[1] && da[0] > 0, `both phones agree on today's Daily seed (${da[0]}) and it changes by day`);
        const bots = await a.evaluate((ss) => ss.map((s) => window.__rush.botRun(s, 500)), [11, 22, 33, 44, 55]);
        for (const r of bots) console.log(`   bot seed ${r.seed}: ${r.chunks} chunks, ${(r.z / 1000).toFixed(1)} km, crashes ${r.crashes}, stumbles ${r.stumbles}, ${r.ms} ms`);
        assert(bots.every((r) => r.chunks >= 500 && r.crashes === 0 && r.fails.length === 0), 'perfect-information bot never gets caught in 500 chunks × 5 seeds');
      }

      if (want('race')) {
        await shot(a, 'phone-light-start');
        // guest readies up; host flips modes and the guest follows live
        await b.click('.g-rush .rr-ov-lobby [data-r="go"]');
        await until(a, () => /ready/.test(document.querySelector('.g-rush .rr-status').textContent), null, 6000, 'host sees guest ready');
        await a.click('.g-rush .rr-mode[data-mode="brawl"]');
        await until(b, () => window.__rush.state().lobbyMode === 'brawl', null, 6000, 'guest sees brawl');
        console.log('ok - guest sees the host pick the mode live');
        await pickAndStart(h, 'race');
        await waitRun(a); await waitRun(b);
        const sa = await S(a); const sb = await S(b);
        const skew = Math.abs(sa.startedWall - sb.startedWall);
        assert(skew < 50, `both phones start within 50 ms on the shared clock (skew ${skew.toFixed(1)} ms, rtt ${sb.rtt} ms)`);
        console.log(`   first frame after GO differs by ${Math.abs(sa.firstRunWall - sb.firstRunWall)} ms (frame granularity in the harness)`);
        // UI inputs: real touch swipes on both phones (runners ghosted meanwhile, so a slow harness
        // can't run them into a barrier and swallow the gesture while they're down)
        await a.evaluate(() => { window.__rush.resetPerf(); window.__rush.ghost('a', 30); });
        await b.evaluate(() => window.__rush.ghost('b', 30));
        const la = (await S(a)).a.lane; const lb = (await S(b)).b.lane;
        await swipe(a, 195, 560, 90, 0);   // Emerson: right
        await swipe(b, 195, 560, -90, 0);  // Sydney: left
        await h.wait(400);
        const la2 = (await S(a)).a.lane; const lb2 = (await S(b)).b.lane;
        assert(la2 === la + 1 && lb2 === lb - 1, `swipes change lanes on both phones (${la}→${la2}, ${lb}→${lb2})`);
        const ign0 = (await a.evaluate(() => window.__rush.inputStats())).ignored;
        await swipe(a, 8, 560, 120, 0);    // starts in the iOS back-gesture zone
        await h.wait(300);
        const st = await a.evaluate(() => window.__rush.inputStats());
        assert(st.ignored === ign0 + 1 && (await S(a)).a.lane === la2, 'a swipe starting at the left edge is ignored');
        const j0 = (await S(a)).a.jumps; const r0 = (await S(b)).b.rolls;
        await swipe(a, 195, 600, 0, -80);  // jump
        await until(a, (n) => window.__rush.state().a.jumps > n, j0, 4000, 'jump from an up-swipe');
        console.log('ok - up-swipe jumps');
        await swipe(b, 195, 500, 0, 80);   // roll
        await until(b, (n) => window.__rush.state().b.rolls > n, r0, 4000, 'roll from a down-swipe');
        console.log('ok - down-swipe rolls');
        // ghost marker: when the partner is out of sight ahead, a chip with the live gap sits at the horizon in their lane
        await b.evaluate(() => { const r = window.__rush.internals.players.b.r; r.z += 135; r.zPrev = r.z; });
        await until(a, () => { const t = document.querySelector('.g-rush .rr-tag'); return t && t.classList.contains('rr-ghost') && t.style.display !== 'none' && /↑ \d+ m/.test(t.textContent); }, null, 6000, 'ghost marker for a partner far ahead');
        const gt = await a.$eval('.g-rush .rr-tag', (t) => t.textContent);
        assert(/Sydney ↑ \d+ m/.test(gt), `host sees the partner's ghost marker: "${gt}"`);
        await shot(a, 'phone-light-ghost');
        await b.evaluate(() => { const r = window.__rush.internals.players.b.r; r.z -= 135; r.zPrev = r.z; }); // back to the pack
        await until(a, () => { const t = document.querySelector('.g-rush .rr-tag'); return !t || !t.classList.contains('rr-ghost') || t.style.display === 'none'; }, null, 6000, 'ghost marker gone once they are back in view');
        // hand over to the autopilot; the ghosting runs out like a respawn's, so it can steer clear first
        await a.evaluate(() => { window.__rush.ghost('a', 1.5); window.__rush.auto('a', true); });
        await b.evaluate(() => { window.__rush.ghost('b', 1.5); window.__rush.auto('b', true); });
        await h.wait(1800);
        await shot(a, 'phone-light-run');
        await h.wait(700);

        // weapons: whoever trails throws ink at the leader through the UI button
        const s1 = await S(a);
        const [lead, trail] = s1.a.z >= s1.b.z ? [a, b] : [b, a];
        const tw = trail === a ? 'a' : 'b'; const lw = tw === 'a' ? 'b' : 'a';
        // (a shield the leader picked up on the track would block it: that case is tested next)
        await lead.evaluate((w) => { window.__rush.internals.players[w].r.shield = 0; }, lw);
        await trail.evaluate((w) => window.__rush.give(w, 'ink'), tw);
        await fireWeapon(trail);
        await until(lead, (w) => window.__rush.state()[w].splat, lw, 5000, 'ink splat on the leader');
        await shot(lead, 'phone-light-hit');
        await until(trail, (w) => window.__rush.state()[w].stats.hits >= 1, tw, 5000, 'attacker hears it hit');
        console.log('ok - ink bomb thrown from the UI, resolved on the victim, reported back');
        // a shield blocks the next one
        await lead.evaluate((w) => window.__rush.give(w, 'shield'), lw);
        await trail.evaluate((w) => window.__rush.give(w, 'zap'), tw);
        await fireWeapon(trail);
        await until(lead, (w) => !window.__rush.state()[w].shield, lw, 5000, 'shield used up by the zap');
        console.log('ok - shield blocks a zap (victim decides)');
        // roadblock from the leader lands in the trailer's lane
        await lead.evaluate((w) => window.__rush.give(w, 'block'), lw);
        await fireWeapon(lead);
        await until(trail, (w) => window.__rush.state()[w].extra >= 1, tw, 5000, 'roadblock placed on the trailer');
        console.log('ok - roadblock placed by the victim device');

        // hearts + respawn
        // (atomic in the page: a manual runner can hit something on its own between two round trips)
        const cr = await b.evaluate(async () => {
          window.__rush.auto('b', false);
          const r = () => window.__rush.internals.players.b.r;
          for (let i = 0; i < 80 && r().down; i++) await new Promise((ok) => setTimeout(ok, 50));
          const h0 = r().hearts;
          window.__rush.crash('b');
          return { h0, h1: r().hearts, down: !!r().down };
        });
        const hb0 = cr.h0;
        assert(cr.down && cr.h1 === hb0 - 1, `a crash costs a heart (${hb0}→${cr.h1})`);
        await until(b, () => !window.__rush.state().b.down && window.__rush.state().b.invuln, null, 4000, 'respawn with invulnerability');
        console.log('ok - respawns after a moment, blinking');
        await until(a, (n) => window.__rush.state().b.hearts === n, hb0 - 1, 3000, 'host sees the guest hearts');
        await b.evaluate(() => window.__rush.auto('b', true));
        await h.wait(600);
        // a rocket (speed lines + FOV kick), and the shield bubble on screen, before the shader check
        await a.evaluate(() => { window.__rush.give('a', 'rocket'); window.__rush.input('a', 'use'); window.__rush.give('a', 'shield'); });
        await h.wait(900);
        // milestone for an unlock: Emerson racks up 10 close calls this run
        await a.evaluate(() => { window.__rush.internals.players.a.r.closeCalls = 10; });
        const pa = await a.evaluate(() => window.__rush.perf());
        console.log(`   perf (iPhone 13 profile, SwiftShader, two pages): frame p50 ${pa.p50.toFixed(1)} ms, p95 ${pa.p95.toFixed(1)} ms, js p50 ${pa.work50.toFixed(2)} ms, p95 ${pa.work95.toFixed(2)} ms, draw calls ${pa.calls} (max ${pa.maxCalls}), triangles ${pa.tris} (max ${pa.maxTris}), render scale ${pa.scale}, dpr ${pa.dpr}`);
        assert(pa.maxCalls <= 30, `draw calls within the phone budget of 30 in a busy race (max ${pa.maxCalls})`);
        assert(pa.maxTris <= 60000, `triangles within the phone budget of 60k (max ${pa.maxTris})`);
        assert(pa.scale >= 0.55 && pa.scale <= 1, `dynamic resolution stays in range (scale ${pa.scale} after ${pa.scaleDowns} step${pa.scaleDowns === 1 ? '' : 's'} down, ${pa.scaleUps} up)`);
        for (const [pg, w] of [[a, 'host'], [b, 'guest']]) {
          const pgm = await pg.evaluate(() => ({ now: window.__rush.internals.renderer.info.programs.length, warm: window.__rush.perf().programs0 }));
          assert(pgm.warm >= 8 && pgm.now === pgm.warm, `${w}: every shader compiled behind the loading screen (${pgm.warm} programs; still ${pgm.now} after ink, zap, roadblock, rocket, shield, crash)`);
        }

        // finish
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 90000, 'end card on the host');
        await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 15000, 'end card on the guest');
        const ra = await S(a); const rb = await S(b);
        assert(ra.result && rb.result && ra.result.winner === rb.result.winner, `both phones agree: ${ra.result.text} (${ra.result.sub})`);
        await h.wait(500);
        const res = h.results().filter((r) => r.game === 'rush');
        assert(res.length === 1 && res[0].winner === ra.result.winner, 'race result recorded once');
        // bests + unlocks land in the shared game data (and the end card shows this device's line)
        const gd = h.docs['gamedata/rush'] || {};
        assert(gd.a_race_m > 0 && gd.b_race_m > 0 && gd.a_runs === 1, `bests in the shared doc: Emerson ${gd.a_race_m} m, Sydney ${gd.b_race_m} m`);
        assert(gd.unlock_a_trail2 === 1, 'the "10 close calls" milestone unlocked the Ink trail for Emerson (shared doc)');
        const sub = await a.$eval('#game-root .gm-end', (e) => e.textContent);
        assert(/\d+ m/.test(sub) && /Sydney/.test(sub), 'the death card shows distance and the partner');
        await shot(a, 'phone-light-end');
        await shot(b, 'phone-light-end-guest');
      }

      if (want('brawl')) {
        await a.click('#game-root [data-g="rematch"]').catch(() => {});
        await until(a, () => window.__rush && window.__rush.state().phase === 'lobby', null, 15000, 'host back in the lobby');
        await until(b, () => window.__rush && window.__rush.state().phase === 'lobby' && window.__rush.state().synced, null, 15000, 'guest back in the lobby');
        console.log(`   rematch: re-mounted and ready in ${(await S(a)).loadMs} ms (host), ${(await S(b)).loadMs} ms (guest) — three.js already loaded`);
        if (want('race')) {
          await until(b, () => window.__rush.data().unlock_a_trail2 === 1, null, 8000, 'guest sees the unlock');
          assert((await a.evaluate(() => window.__rush.data().unlock_a_trail2)) === 1, 'unlock persists across the re-mount on both phones');
          await a.click('.g-rush .rr-ov-lobby [data-r="gear"]');
          await until(a, () => !!document.querySelector('.g-rush .rr-chip-s[data-k="trail"][data-v="2"]:not(.locked)'), null, 4000, 'Ink trail chip unlocked in settings');
          assert(await a.$eval('.g-rush .rr-chip-s[data-k="trail"][data-v="1"]', (e) => e.classList.contains('locked')), 'the 1 km trail is still locked');
          await a.click('.g-rush .rr-chip-s[data-k="trail"][data-v="2"]');
          await shot(a, 'phone-light-style');
          await a.click('.g-rush .rr-ov-set [data-x="done"]');
          assert((await a.evaluate(() => window.__rush.settings.trail)) === 2, 'Emerson wears the Ink trail');
        }
        await pickAndStart(h, 'brawl');
        await waitRun(a); await waitRun(b);
        // Emerson (lane -1) steps to the middle, then into Sydney's lane (1) while level: a shove
        await a.evaluate(() => window.__rush.input('a', 'right'));
        await h.wait(450);
        const before = await S(b);
        await a.evaluate(() => window.__rush.input('a', 'right'));
        await until(a, () => window.__rush.state().a.stats.shoves >= 1, null, 5000, 'shove lands');
        const after = await S(b);
        assert(after.b.hearts < before.b.hearts || after.b.stumbleT > 0 || after.b.down, `shoved into the wall: Sydney ${before.b.hearts}→${after.b.hearts} hearts`);
        await shot(b, 'phone-light-brawl-shove');
        // Sydney jumps, Emerson whiffs
        await a.evaluate(() => window.__rush.auto('a', true));
        await b.evaluate(() => window.__rush.auto('b', true));
        await h.wait(2500);
        // finish the brawl: Sydney runs out of hearts
        await b.evaluate(() => { window.__rush.auto('b', false); window.__rush.setHearts('b', 1); window.__rush.crash('b'); });
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 15000, 'brawl ends');
        const rs = await S(a);
        assert(rs.result.winner === 'a', `brawl winner: ${rs.result.text}`);
        await h.wait(400);
        assert(h.results().filter((r) => r.game === 'rush').length === (want('race') ? 2 : 1), 'brawl result recorded once');
      }

      if (want('tandem') || want('pause')) {
        await a.click('#game-root [data-g="rematch"]').catch(() => {});
        await until(a, () => window.__rush && window.__rush.state().phase === 'lobby', null, 15000, 'lobby');
        await until(b, () => window.__rush && window.__rush.state().phase === 'lobby' && window.__rush.state().synced, null, 15000, 'guest lobby');
        await pickAndStart(h, 'tandem');
        await waitRun(a); await waitRun(b);
        await a.evaluate(() => window.__rush.auto('a', true));
        await b.evaluate(() => window.__rush.auto('b', true));
        await h.wait(1500);
        if (want('tandem')) {
          await b.evaluate(() => window.__rush.crash('b'));
          await until(a, () => window.__rush.state().a.revive, null, 5000, 'partner gets revive tokens');
          await h.wait(400);
          await shot(a, 'phone-light-revive-token');
          await until(b, () => !window.__rush.state().b.down, null, 14000, 'revived');
          const sa = await S(a);
          assert(sa.a.stats.revives === 1 && sa.th === 4, `revived by grabbing the token, no team heart lost (team hearts ${sa.th})`);
        }
        if (want('pause')) {
          // disconnect: Sydney's presence drops out of the room, then comes back
          await b.evaluate(async () => { const room = await window.claude.use('room'); window.__rr = await room.join('ju-rush'); });
          await until(a, () => window.__rush.state().paused && window.__rush.state().reasons.includes('gone'), null, 5000, 'host pauses when the partner drops');
          await until(b, () => window.__rush.state().paused, null, 5000, 'guest pauses too');
          assert(await a.isVisible('.g-rush .rr-ov.rr-ov-pause'), 'pause overlay shown');
          await shot(a, 'phone-light-paused');
          const za = (await S(a)).a.z;
          await h.wait(1500);
          assert(Math.abs((await S(a)).a.z - za) < 0.01, 'runner frozen while paused');
          await b.evaluate(async () => { await window.__rr.presence({ who: 'b', on: true }); });
          await until(a, () => !window.__rush.state().paused && window.__rush.state().resumeAt > window.__rush.state().now, null, 6000, 'resume countdown scheduled');
          const ra = (await S(a)).resumeAt; const rb = (await S(b)).resumeAt;
          assert(Math.abs(ra - rb) < 30, `both resume at the same shared time (Δ ${Math.abs(ra - rb).toFixed(1)} ms)`);
          await until(a, () => window.__rush.state().now > window.__rush.state().resumeAt + 300, null, 6000, 'countdown over');
          const z1 = (await S(a)).a.z; await h.wait(600);
          assert((await S(a)).a.z > z1 + 3, 'running again after the countdown');
          // visibility: Sydney switches apps
          await b.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
          await until(a, () => window.__rush.state().paused, null, 5000, 'host pauses when the partner hides the app');
          await b.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
          await until(a, () => !window.__rush.state().paused && window.__rush.state().now > window.__rush.state().resumeAt + 200, null, 9000, 'resumes after a 3-2-1');
          console.log('ok - visibility pause and resume');
          // WebGL context loss on Emerson's phone
          await a.evaluate(() => { const c = window.__rush.canvas; const gl = c.getContext('webgl2') || c.getContext('webgl'); window.__lc = gl.getExtension('WEBGL_lose_context'); window.__lc.loseContext(); });
          await until(a, () => window.__rush.state().glLost && window.__rush.state().paused, null, 5000, 'context lost → paused');
          await a.evaluate(() => window.__lc.restoreContext());
          await until(a, () => !window.__rush.state().glLost && window.__rush.state().reasons.includes('tap'), null, 5000, 'context restored → tap to resume');
          await a.click('.g-rush .rr-ov.rr-ov-pause [data-x="resume"]');
          await until(a, () => !window.__rush.state().paused && window.__rush.state().now > window.__rush.state().resumeAt + 200, null, 9000, 'resumed after tap');
          const z2 = (await S(a)).a.z; await h.wait(600);
          assert((await S(a)).a.z > z2 + 3, 'run continues after the GL context comes back');
          await shot(a, 'phone-light-after-restore');
        }
        if (want('tandem')) {
          // end: one team heart left, Sydney goes down and Emerson can't reach a token in time
          await a.evaluate(() => { window.__rush.teamHearts(1); window.__rush.auto('a', false); });
          await b.evaluate(() => { window.__rush.auto('b', false); window.__rush.crash('b'); });
          await a.evaluate(() => { window.__rush.crash('a'); });
          await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 25000, 'tandem ends');
          await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 10000, 'tandem ends for the guest');
          const st = await S(a);
          assert(st.result.team && st.result.score > 0, `team result: ${st.result.text} (${st.result.sub})`);
          await h.wait(400);
          const tr = h.results().filter((r) => r.game === 'rush' && r.winner === 'team');
          assert(tr.length === 1 && tr[0].score === st.result.score, 'team score recorded once');
        }
      }
      if (want('daily')) {
        await a.click('#game-root [data-g="rematch"]').catch(() => {});
        await until(a, () => window.__rush && window.__rush.state().phase === 'lobby', null, 15000, 'lobby for daily');
        await until(b, () => window.__rush && window.__rush.state().phase === 'lobby' && window.__rush.state().synced, null, 15000, 'guest lobby for daily');
        await pickAndStart(h, 'daily');
        await waitRun(a); await waitRun(b);
        const ds = await a.evaluate(() => window.__rush.dailySeed());
        const sa = await S(a); const sb = await S(b);
        assert(sa.seed === ds && sb.seed === ds, `the Daily run uses today's seed on both phones (${ds})`);
        await a.evaluate(() => window.__rush.auto('a', true));
        await b.evaluate(() => window.__rush.auto('b', true));
        await h.wait(2500);
        await shot(a, 'phone-light-daily');
        // Sydney runs out of hearts first; Emerson keeps going, then is out too: furthest wins
        await b.evaluate(() => { window.__rush.auto('b', false); window.__rush.setHearts('b', 1); window.__rush.crash('b'); });
        await until(a, () => window.__rush.state().b.out, null, 8000, 'host sees Sydney out');
        await h.wait(2500);
        await shot(b, 'phone-light-daily-spectate');
        await a.evaluate(() => { window.__rush.auto('a', false); window.__rush.setHearts('a', 1); window.__rush.crash('a'); });
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 20000, 'daily ends');
        await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 10000, 'daily ends for the guest');
        const rd = await S(a);
        assert(rd.result.daily && rd.result.winner === 'a' && rd.result.za > rd.result.zb, `furthest wins the Daily: ${rd.result.text} (${rd.result.sub})`);
        await h.wait(500);
        const gd = h.docs['gamedata/rush'] || {};
        const dk = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
        assert(gd[`a_daily_${dk}`] === rd.result.za && gd[`b_daily_${dk}`] === rd.result.zb, `today's board is in the shared doc (${gd[`a_daily_${dk}`]} / ${gd[`b_daily_${dk}`]} m)`);
        await shot(a, 'phone-light-daily-end');
        await a.click('#game-root [data-g="rematch"]').catch(() => {});
        await until(a, () => window.__rush && window.__rush.state().phase === 'lobby', null, 15000, 'lobby after daily');
        await until(a, () => /Today:/.test((document.querySelector('.g-rush [data-r="daily"]') || {}).textContent || ''), null, 8000, 'lobby shows today\'s board');
        await shot(a, 'phone-light-lobby-board');
      }
      h.assertNoErrors();
      console.log('ok - no page errors (phones)');
      assert(!h.warnings.length, `stays inside the ~40 msg/s room budget (${h.warnings.length} warnings)`);
    } catch (e) {
      console.error(e.message); fails++;
      await shot(h.a, 'fail-a').catch(() => {}); await shot(h.b, 'fail-b').catch(() => {});
      console.error('errors:', h.errors.slice(0, 8));
    } finally { await h.close(); }
  }

  // ═══ one computer: split screen, keys, leaks ═══
  if (want('split') || want('leak')) {
    const h = await launch({ port: 8961, only: ['rush'], device: 'Desktop Chrome', who: ['a'] });
    const { a } = h;
    try {
      await a.setViewportSize({ width: 1280, height: 800 });
      await a.evaluate((d) => { window.__RUSH_DEBUG = d; }, { ...DEBUG, raceLen: 500 });
      if (want('split')) {
        await h.startLive(a, 'rush', 'local');
        await until(a, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().phase === 'lobby', null, 30000, 'split lobby');
        await h.wait(600);
        await shot(a, 'desk-light-start');
        await a.click('.g-rush .rr-mode[data-mode="race"]');
        await a.click('.g-rush .rr-ov-lobby [data-r="go"]');
        await waitRun(a);
        await a.keyboard.press('KeyD');        // Emerson right
        await a.keyboard.press('ArrowLeft');   // Sydney left
        await h.wait(300);
        let s = await S(a);
        assert(s.a.lane === 0 && s.b.lane === 0, `both key sets move their own runner (a ${s.a.lane}, b ${s.b.lane})`);
        await a.keyboard.press('ArrowRight');  // Sydney back out, so the shot shows both
        await h.wait(200);
        const jr = await S(a);
        await a.keyboard.press('KeyW');
        await a.keyboard.press('ArrowDown');
        await h.wait(200);
        s = await S(a);
        assert(s.a.jumps > jr.a.jumps && s.b.rolls > jr.b.rolls, 'W jumps Emerson, ↓ rolls Sydney');
        await h.wait(900);
        await shot(a, 'desk-light-run');
        await a.evaluate(() => { window.__rush.auto('a', true); window.__rush.auto('b', true); });
        await h.wait(1500);
        s = await S(a);
        const [tw, lw] = s.a.z >= s.b.z ? ['b', 'a'] : ['a', 'b'];
        await a.evaluate(([t, l]) => { window.__rush.internals.players[l].r.shield = 0; window.__rush.give(t, 'ink'); }, [tw, lw]);
        await a.keyboard.press(tw === 'a' ? 'KeyE' : 'Enter');
        await until(a, (w) => window.__rush.state()[w].splat, lw, 5000, 'ink from the weapon key');
        await shot(a, 'desk-light-hit');
        console.log('ok - weapon keys work in split screen');
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 90000, 'split race ends');
        await h.wait(400);
        assert(h.results().filter((r) => r.game === 'rush').length === 1, 'one-device result recorded');
        await shot(a, 'desk-light-end');
        await a.click('#game-root [data-g="close"]');
        await h.wait(300);
      }
      if (want('leak')) {
        await a.evaluate(() => {
          window.__gl = [];
          const orig = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (t, o) { const c = orig.call(this, t, o); if (c && /webgl/.test(t) && !window.__gl.includes(c)) window.__gl.push(c); return c; };
          window.__raf = 0;
          const r0 = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = (fn) => { window.__raf++; return r0(fn); };
        });
        for (let i = 0; i < 5; i++) {
          await h.startLive(a, 'rush', 'local');
          await until(a, () => window.__rush && window.__rush.state().ready3D, null, 30000, 'open ' + i);
          await h.wait(300);
          await a.click('#game-root [data-g="close"]');
          await h.wait(250);
        }
        await h.wait(500);
        const leak = await a.evaluate(async () => {
          const r1 = window.__raf;
          await new Promise((r) => setTimeout(r, 600));
          return { contexts: window.__gl.length, alive: window.__gl.filter((g) => !g.isContextLost()).length, rafDuring: window.__raf - r1, canvases: document.querySelectorAll('.g-rush canvas').length, hook: !!window.__rush };
        });
        assert(leak.contexts === 5 && leak.alive === 0, `5 opens → 5 WebGL contexts, all released (${leak.alive} alive)`);
        assert(leak.rafDuring === 0 && leak.canvases === 0 && !leak.hook, `no rAF loop or canvas left behind (${leak.rafDuring} rAF calls in 600 ms)`);
      }
      // a phone can't do one-device mode: friendly card
      h.assertNoErrors();
      console.log('ok - no page errors (computer)');
    } catch (e) {
      console.error(e.message); fails++;
      await shot(h.a, 'fail-desk').catch(() => {});
      console.error('errors:', h.errors.slice(0, 8));
    } finally { await h.close(); }
  }

  // ═══ packet loss ═══
  if (want('drop')) {
    const h = await launch({ port: 8962, only: ['rush'], latency: 80, dropRate: 0.2, coarse: true });
    const { a, b } = h;
    try {
      await openLivePair(h, { raceLen: 500 });
      await pickAndStart(h, 'race');
      await waitRun(a); await waitRun(b);
      await a.evaluate(() => window.__rush.auto('a', true));
      await b.evaluate(() => window.__rush.auto('b', true));
      const s = await S(a);
      const tw = s.a.z >= s.b.z ? 'b' : 'a';
      const tp = tw === 'a' ? a : b;
      await (tw === 'a' ? b : a).evaluate((w) => { window.__rush.internals.players[w].r.shield = 0; }, tw === 'a' ? 'b' : 'a');
      await tp.evaluate((w) => window.__rush.give(w, 'ink'), tw);
      await fireWeapon(tp);
      await until(tw === 'a' ? b : a, (w) => window.__rush.state()[w].splat, tw === 'a' ? 'b' : 'a', 10000, 'ink lands through 20% loss');
      console.log('ok - reliable weapon event through 20% loss');
      await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 90000, 'end card (host) with loss');
      await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 20000, 'end card (guest) with loss');
      const ra = await S(a); const rb = await S(b);
      assert(ra.result.winner === rb.result.winner, 'both agree on the winner with 20% packet loss');
      await h.wait(500);
      assert(h.results().filter((r) => r.game === 'rush').length === 1, 'result recorded once with 20% loss');
      h.assertNoErrors();
      console.log('ok - no page errors (20% loss)');
      assert(!h.warnings.length, `inside the room message budget with 20% loss and retries (${h.warnings.length} warnings)`);
    } catch (e) {
      console.error(e.message); fails++;
      console.error('errors:', h.errors.slice(0, 8));
    } finally { await h.close(); }
  }

  // ═══ screenshots: dark, phone one-device card ═══
  if (want('dark')) {
    const h = await launch({ port: 8963, only: ['rush'], latency: 60, colorScheme: 'dark', coarse: true });
    const { a, b } = h;
    try {
      await openLivePair(h);
      await h.wait(600);
      await shot(a, 'phone-dark-start');
      await pickAndStart(h, 'race');
      await waitRun(a); await waitRun(b);
      await a.evaluate(() => window.__rush.auto('a', true));
      await b.evaluate(() => window.__rush.auto('b', true));
      await h.wait(2200);
      await shot(a, 'phone-dark-run');
      const s = await S(a);
      const tw = s.a.z >= s.b.z ? 'b' : 'a';
      const tp = tw === 'a' ? a : b; const vp = tw === 'a' ? b : a;
      await vp.evaluate((w) => { window.__rush.internals.players[w].r.shield = 0; }, tw === 'a' ? 'b' : 'a');
      await tp.evaluate((w) => window.__rush.give(w, 'ink'), tw);
      await fireWeapon(tp);
      await until(vp, (w) => window.__rush.state()[w].splat, tw === 'a' ? 'b' : 'a', 6000, 'dark ink');
      await shot(vp, 'phone-dark-hit');
      await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 90000, 'dark end');
      await shot(a, 'phone-dark-end');
      await a.click('#game-root [data-g="close"]');
      await b.click('#game-root [data-g="close"]').catch(() => {});
      await h.wait(300);
      await h.startLive(a, 'rush', 'local');
      await until(a, () => document.querySelector('.g-rush .rr-ov.rr-ov-msg.on'), null, 10000, 'phone one-device card');
      await shot(a, 'phone-dark-onedevice');
      assert(await a.isVisible('.g-rush [data-g="live"][data-mode="live"]'), 'phone in one-device mode suggests live play');
      h.assertNoErrors();
      assert(!h.warnings.length, `dark: inside the room message budget (${h.warnings.length} warnings)`);
    } catch (e) { console.error(e.message); fails++; console.error('errors:', h.errors.slice(0, 8)); } finally { await h.close(); }
    const d = await launch({ port: 8964, only: ['rush'], device: 'Desktop Chrome', who: ['a'], colorScheme: 'dark' });
    try {
      await d.a.setViewportSize({ width: 1280, height: 800 });
      await d.a.evaluate((x) => { window.__RUSH_DEBUG = x; }, { ...DEBUG, raceLen: 400 });
      await d.startLive(d.a, 'rush', 'local');
      await until(d.a, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().phase === 'lobby', null, 30000, 'dark split lobby');
      await d.wait(600);
      await shot(d.a, 'desk-dark-start');
      await d.a.click('.g-rush .rr-ov-lobby [data-r="go"]');
      await waitRun(d.a);
      await d.a.evaluate(() => { window.__rush.auto('a', true); window.__rush.auto('b', true); });
      await d.wait(2200);
      await shot(d.a, 'desk-dark-run');
      await d.a.evaluate(() => { window.__rush.give('b', 'ink'); });
      await d.a.keyboard.press('Enter');
      await d.wait(900);
      await shot(d.a, 'desk-dark-hit');
      await until(d.a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 90000, 'dark split end');
      await shot(d.a, 'desk-dark-end');
      d.assertNoErrors();
    } catch (e) { console.error(e.message); fails++; console.error('errors:', d.errors.slice(0, 8)); } finally { await d.close(); }
  }

  // ═══ steady-state allocations + heap growth (one computer, so the numbers are this page's own) ═══
  if (want('heap')) {
    const h = await launch({ port: 8965, only: ['rush'], device: 'Desktop Chrome', who: ['a'] });
    const { a } = h;
    try {
      await a.setViewportSize({ width: 1280, height: 800 });
      await a.evaluate((d) => { window.__RUSH_DEBUG = d; }, { ...DEBUG, raceLen: 60000 });
      await h.startLive(a, 'rush', 'local');
      await until(a, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().phase === 'lobby', null, 30000, 'heap lobby');
      await a.click('.g-rush .rr-ov-lobby [data-r="go"]');
      await waitRun(a);
      await a.evaluate(() => { window.__rush.ghost('a', 1e6); window.__rush.ghost('b', 1e6); });
      const cdp = await a.context().newCDPSession(a);
      // let the per-frame path reach the optimizing tier first (SwiftShader frames are slow, so
      // this drives the JS side directly: sim, logic, avatars, particles, world sync, rig, HUD, overlay)
      await a.evaluate(() => window.__rush.bench(9000)); // ~2.5 min of 60 Hz play: the big functions reach the top tier
      await cdp.send('HeapProfiler.enable');
      // Steady state = after V8 tiers up, which only ever moves forward; on a loaded machine its
      // background compiles can lag, so sample up to three windows and keep the quietest.
      let hot = Infinity; let build = 0; let sites = new Map(); let bm = null;
      for (let win = 0; win < 3; win++) {
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.send('HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
        const wbm = await a.evaluate(() => window.__rush.bench(1500));
        const prof = (await cdp.send('HeapProfiler.stopSampling')).profile;
        let whot = 0; let wbuild = 0; const wsites = new Map();
        const walk = (n, stack) => {
          const cf = n.callFrame; const name = cf.functionName || '(anon)';
          const st = stack.concat(name);
          if (n.selfSize && st.includes('bench')) {
            // chunk building / generation happens once per 100 m, not per frame; setScore is the engine's
            if (st.some((f) => /^(buildChunk|chunkMesh|genChunk|keepFrom|setScore)$/.test(f))) wbuild += n.selfSize;
            else { whot += n.selfSize; const k = st.slice(-3).join(' < '); wsites.set(k, (wsites.get(k) || 0) + n.selfSize); }
          }
          for (const c of n.children) walk(c, st);
        };
        walk(prof.head, []);
        if (whot < hot) { hot = whot; build = wbuild; sites = wsites; bm = wbm; }
        if (hot / wbm.frames < 1024) break;
      }
      const perFrame = hot / bm.frames;
      console.log(`   JS per frame (both runners, no GL draw): ${bm.msPerFrame.toFixed(2)} ms; hot-path allocations ${perFrame.toFixed(1)} B/frame; chunk building ${(build / 1024).toFixed(0)} KB over ${bm.frames} frames`);
      for (const [k, v] of [...sites.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5)) console.log(`     ${(v / bm.frames).toFixed(1)} B/frame  ${k}`);
      // What remains is V8 boxing doubles passed across non-inlined calls (tier-dependent, and
      // absent on the iPhone's JSC); per-frame objects / arrays / strings would blow well past this.
      assert(perFrame < 2048, `per-frame hot path makes no garbage objects: ${perFrame.toFixed(0)} B/frame of boxed numbers (two runners, two views)`);
      // retained heap over 30 s of real running
      await cdp.send('HeapProfiler.collectGarbage');
      const h0 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
      const f0 = (await a.evaluate(() => window.__rush.perf())).frames;
      await h.wait(30000);
      await cdp.send('HeapProfiler.collectGarbage');
      const h1 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
      const f1 = (await a.evaluate(() => window.__rush.perf())).frames;
      assert(h1 - h0 < 1.5e6, `heap after 30 s of running (${f1 - f0} frames, after GC): ${(h0 / 1e6).toFixed(2)} → ${(h1 / 1e6).toFixed(2)} MB (${((h1 - h0) / 1024).toFixed(0)} KB growth)`);
      const au = await a.evaluate(() => window.__rush.internals.audio.stats);
      console.log(`   music scheduler: ${au.steps} steps, ${au.resets} resyncs, never more than ${(au.maxAhead * 1000).toFixed(0)} ms ahead`);
      h.assertNoErrors();
    } catch (e) { console.error(e.message); fails++; console.error('errors:', h.errors.slice(0, 8)); } finally { await h.close(); }
  }

  // ═══ seamlessness: late lobby, partner + host re-mounts mid-race, 30 s in the background, a slow partner ═══
  if (want('seam')) {
    const h = await launch({ port: 8966, only: ['rush'], latency: 80, coarse: true });
    const { a, b } = h;
    const running = async (pg, w, what) => {
      await until(pg, () => { const s = window.__rush && window.__rush.state(); return s && s.phase === 'run' && !s.paused && s.now > s.resumeAt + 200; }, null, 20000, what);
      const z0 = (await S(pg))[w].z; await h.wait(700);
      assert((await S(pg))[w].z > z0 + 2, `${what}: running again`);
    };
    try {
      for (const pg of [a, b]) await pg.evaluate((d) => { window.__RUSH_DEBUG = d; }, { ...DEBUG, raceLen: 20000 });
      // the host opens it and waits alone a while before the partner shows up
      await h.startLive(a, 'rush', 'live');
      await h.wait(4000);
      const invited = await b.isVisible('#gm-invite').catch(() => false);
      if (invited) await b.click('#gm-invite [data-g="invite-yes"]'); else await h.startLive(b, 'rush', 'live');
      await until(a, () => window.__rush && window.__rush.state().ready3D, null, 30000, 'host 3D ready');
      await until(b, () => window.__rush && window.__rush.state().ready3D && window.__rush.state().synced, null, 30000, 'late guest ready');
      await pickAndStart(h, 'race');
      console.log('ok - lobby works when the partner arrives late');
      await waitRun(a); await waitRun(b);
      await a.evaluate(() => window.__rush.auto('a', true)); await b.evaluate(() => window.__rush.auto('b', true));
      await h.wait(3000);

      // the guest leaves mid-race and comes back
      const zb0 = (await S(b)).b.z;
      await b.click('#game-root [data-g="close"]');
      await until(a, () => window.__rush.state().paused && window.__rush.state().reasons.includes('gone'), null, 8000, 'host pauses when the guest leaves');
      assert(await a.isVisible('.g-rush .rr-ov-pause [data-g="invite-again"]'), 'the pause card offers to invite them back');
      await shot(a, 'seam-guest-left');
      await h.wait(1500);
      await h.startLive(b, 'rush', 'live');
      await until(b, () => window.__rush && window.__rush.state().phase === 'run', null, 30000, 'guest is put back into the run');
      const zb1 = (await S(b)).b.z;
      assert(Math.abs(zb1 - zb0) < 40, `guest picks up where it left off (${zb0.toFixed(0)} m → ${zb1.toFixed(0)} m)`);
      await b.evaluate(() => window.__rush.auto('b', true));
      await running(a, 'a', 'host after the guest came back'); await running(b, 'b', 'guest after coming back');

      // the host leaves mid-race (a reload or app restart looks the same) and comes back
      const za0 = (await S(a)).a.z;
      await a.click('#game-root [data-g="close"]');
      await until(b, () => window.__rush.state().paused, null, 8000, 'guest pauses when the host leaves');
      await shot(b, 'seam-host-left');
      await h.wait(1500);
      await h.startLive(a, 'rush', 'live');
      await until(a, () => window.__rush && window.__rush.state().phase === 'run', null, 30000, 'host gets its run back from the guest');
      const za1 = (await S(a)).a.z;
      assert(Math.abs(za1 - za0) < 40, `host picks up where it left off (${za0.toFixed(0)} m → ${za1.toFixed(0)} m)`);
      await a.evaluate(() => window.__rush.auto('a', true));
      await running(a, 'a', 'host after its re-mount'); await running(b, 'b', 'guest after the host re-mount');
      const ra = (await S(a)).resumeAt; const rb = (await S(b)).resumeAt;
      assert(Math.abs(ra - rb) < 60, `both counted down to the same moment after the re-mount (Δ ${Math.abs(ra - rb).toFixed(0)} ms)`);

      // 30 s in the background (app switcher), then back with a 3-2-1
      await b.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await until(a, () => window.__rush.state().paused, null, 5000, 'host pauses while the guest is in the background');
      const zh = (await S(a)).a.z;
      await h.wait(30000);
      assert(Math.abs((await S(a)).a.z - zh) < 0.01, 'nothing moves while the partner is away');
      await b.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await running(a, 'a', 'host after 30 s in the background'); await running(b, 'b', 'guest after 30 s in the background');

      // a much slower partner phone (4x CPU throttle): no pause flapping, the race still resolves
      const cdpB = await b.context().newCDPSession(b);
      await cdpB.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      let pausedSamples = 0;
      for (let i = 0; i < 16; i++) { await h.wait(500); if ((await S(a)).paused) pausedSamples++; }
      const sa = await S(a); const sb = await S(b);
      console.log(`   slow partner: host ran to ${sa.a.z.toFixed(0)} m, slow guest to ${sb.b.z.toFixed(0)} m (${sb.b.t.toFixed(1)} s vs ${sa.a.t.toFixed(1)} s of run time); host paused in ${pausedSamples}/16 samples`);
      assert(pausedSamples <= 2, 'a slow partner doesn’t make the fast phone stutter between pauses');
      await b.evaluate(() => { window.__rush.auto('b', false); window.__rush.setHearts('b', 1); window.__rush.crash('b'); });
      await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 30000, 'race resolves with a slow partner');
      await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 30000, 'slow guest sees the end card');
      await cdpB.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const ea = await S(a); const eb = await S(b);
      assert(ea.result && eb.result && ea.result.winner === 'a' && eb.result.winner === 'a', 'both agree on the result');
      h.assertNoErrors();
      assert(!h.warnings.length, `stays inside the room message budget (${h.warnings.length} warnings)`);
    } catch (e) {
      console.error(e.message); fails++;
      await shot(h.a, 'fail-seam-a').catch(() => {}); await shot(h.b, 'fail-seam-b').catch(() => {});
      console.error('errors:', h.errors.slice(0, 8));
    } finally { await h.close(); }
  }

  if (fails) { console.log(`\n${fails} FAILED`); process.exitCode = 1; } else console.log('\nALL GOOD');
})();
