// Rail Rush: generator determinism + passability, synchronized live start, a full live Race with
// UI inputs and weapons, Brawl shove, Tandem revive, disconnect / visibility / GL-context pauses,
// one-computer split screen, leaks, packet loss, and screenshots in light and dark.
//   node tools/test/games/rush.test.js            (ONLY=gen,race,... to run some sections)
const fs = require('fs');
const { launch } = require('../harness');

const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-Couple-game/0bac2931-fb3f-54c3-8279-c15850ed70e8/scratchpad/rush';
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
  await fireWeapon(pg);
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
  if (['gen', 'race', 'brawl', 'tandem', 'pause'].some(want)) {
    const h = await launch({ port: 8900, only: ['rush'], latency: 80 });
    const { a, b } = h;
    try {
      await openLivePair(h);
      if (want('gen')) {
        const seeds = [1, 42, 1337, 98765, 2024];
        const ha = await a.evaluate((ss) => ss.map((s) => window.__rush.trackHash(s, 40)), seeds);
        const hb = await b.evaluate((ss) => ss.map((s) => window.__rush.trackHash(s, 40)), seeds);
        assert(ha.every((x, i) => x === hb[i]) && new Set(ha).size === seeds.length, `track layouts identical on both devices for ${seeds.length} seeds (40 chunks each)`);
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
        // UI inputs: real touch swipes on both phones
        await a.evaluate(() => window.__rush.resetPerf());
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
        await h.wait(700);
        await shot(a, 'phone-light-run');
        await a.evaluate(() => window.__rush.auto('a', true));
        await b.evaluate(() => window.__rush.auto('b', true));
        await h.wait(2500);

        // weapons: whoever trails throws ink at the leader through the UI button
        const s1 = await S(a);
        const [lead, trail] = s1.a.z >= s1.b.z ? [a, b] : [b, a];
        const tw = trail === a ? 'a' : 'b'; const lw = tw === 'a' ? 'b' : 'a';
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
        await b.evaluate(() => window.__rush.auto('b', false));
        await b.evaluate(() => window.__rush.crash('b'));
        const sb2 = await S(b);
        assert(sb2.b.down && sb2.b.hearts === 2, 'a crash costs a heart');
        await until(b, () => !window.__rush.state().b.down && window.__rush.state().b.invuln, null, 4000, 'respawn with invulnerability');
        console.log('ok - respawns after a moment, blinking');
        await until(a, () => window.__rush.state().b.hearts === 2, null, 3000, 'host sees the guest hearts');
        await b.evaluate(() => window.__rush.auto('b', true));
        await h.wait(600);
        const pa = await a.evaluate(() => window.__rush.perf());
        console.log(`   perf (iPhone 13 profile, SwiftShader, two pages): frame p50 ${pa.p50.toFixed(1)} ms, p95 ${pa.p95.toFixed(1)} ms, js p50 ${pa.work50.toFixed(2)} ms, p95 ${pa.work95.toFixed(2)} ms, draw calls ${pa.calls} (max ${pa.maxCalls}), triangles ${pa.tris}, render scale ${pa.scale}, dpr ${pa.dpr}`);
        assert(pa.maxCalls < 80, `draw calls under 80 in a busy scene (max ${pa.maxCalls})`);

        // finish
        await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 90000, 'end card on the host');
        await until(b, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 15000, 'end card on the guest');
        const ra = await S(a); const rb = await S(b);
        assert(ra.result && rb.result && ra.result.winner === rb.result.winner, `both phones agree: ${ra.result.text} (${ra.result.sub})`);
        await h.wait(500);
        const res = h.results().filter((r) => r.game === 'rush');
        assert(res.length === 1 && res[0].winner === ra.result.winner, 'race result recorded once');
        await shot(a, 'phone-light-end');
        await shot(b, 'phone-light-end-guest');
      }

      if (want('brawl')) {
        await a.click('#game-root [data-g="rematch"]').catch(() => {});
        await until(a, () => window.__rush && window.__rush.state().phase === 'lobby', null, 15000, 'host back in the lobby');
        await until(b, () => window.__rush && window.__rush.state().phase === 'lobby' && window.__rush.state().synced, null, 15000, 'guest back in the lobby');
        console.log(`   rematch: re-mounted and ready in ${(await S(a)).loadMs} ms (host), ${(await S(b)).loadMs} ms (guest) — three.js already loaded`);
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
      h.assertNoErrors();
      console.log('ok - no page errors (phones)');
    } catch (e) {
      console.error(e.message); fails++;
      await shot(h.a, 'fail-a').catch(() => {}); await shot(h.b, 'fail-b').catch(() => {});
      console.error('errors:', h.errors.slice(0, 8));
    } finally { await h.close(); }
  }

  // ═══ one computer: split screen, keys, leaks ═══
  if (want('split') || want('leak')) {
    const h = await launch({ port: 8901, only: ['rush'], device: 'Desktop Chrome', who: ['a'] });
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
        await a.evaluate((w) => window.__rush.give(w, 'ink'), tw);
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
    const h = await launch({ port: 8902, only: ['rush'], latency: 80, dropRate: 0.2 });
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
    } catch (e) {
      console.error(e.message); fails++;
      console.error('errors:', h.errors.slice(0, 8));
    } finally { await h.close(); }
  }

  // ═══ screenshots: dark, phone one-device card ═══
  if (want('dark')) {
    const h = await launch({ port: 8903, only: ['rush'], latency: 60, colorScheme: 'dark' });
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
    } catch (e) { console.error(e.message); fails++; console.error('errors:', h.errors.slice(0, 8)); } finally { await h.close(); }
    const d = await launch({ port: 8904, only: ['rush'], device: 'Desktop Chrome', who: ['a'], colorScheme: 'dark' });
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

  if (fails) { console.log(`\n${fails} FAILED`); process.exitCode = 1; } else console.log('\nALL GOOD');
})();
