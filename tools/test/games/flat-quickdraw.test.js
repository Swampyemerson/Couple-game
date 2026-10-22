// Flat unit, Quick Draw (upgrade 2): what the upgrade is for. The rules, verdicts and live flows are in live.test.js (GAME=quickdraw).
//   PORT=9260 node tools/test/games/flat-quickdraw.test.js      (uses PORT .. PORT+3)
//  - input: a tap is on screen in the very task of the pointerdown (the pad is pressed, with no transition), and the reaction
//    is timed from the event's own timeStamp;
//  - layout: the cue frame, a whole round and an idle wait cause (almost) no layout work: the signal word keeps its box;
//  - every running animation is transform / opacity / translate only;
//  - juice: the cue slams, a win bursts at the winner's muzzle, a misfire shakes the pad, the tally stamps;
//  - riso print: paper tooth and halftone are there, in light and dark; reduced motion switches all of it off.
const { launch } = require('../harness');

let passed = 0;
const failures = [];
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); passed++; console.log('ok -', m); };
async function section(name, fn) {
  console.log(`\n# ${name}`);
  try { await fn(); } catch (e) { failures.push(`${name}: ${e.message}`); console.error('not ok -', e.message); }
}
const BASE = Number(process.env.PORT) || 9260;
const SAFE = new Set(['transform', 'opacity', 'translate', 'scale', 'rotate']);

async function counters(cdp) {
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  return { layouts: m.LayoutCount, styles: m.RecalcStyleCount };
}
const phaseIs = (pg, p, t = 14000) => pg.waitForFunction((p) => window.__qdTest && window.__qdTest.state().phase === p, p, { timeout: t });
/** One pointerdown on a pad, measured in the very same task. */
const tapPad = (pg, w) => pg.evaluate((w) => {
  const p = document.querySelector(`.qd-pad[data-w="${w}"]`);
  const r = p.getBoundingClientRect();
  const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 5, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
  const before = performance.now();
  p.dispatchEvent(ev);
  const cs = getComputedStyle(p);
  return { pressed: p.classList.contains('is-press'), transition: cs.transitionDuration, transform: cs.transform, ts: ev.timeStamp, before };
}, w);

async function run(scheme, reduced, port) {
  const tag = `${scheme}${reduced ? ' reduced' : ''}`;
  const h = await launch({ port, only: ['quickdraw'], colorScheme: scheme, coarse: true, who: ['a'], reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const pg = h.a;
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Performance.enable');
  try {
    await h.startLive(pg, 'quickdraw', 'local');
    await pg.waitForFunction(() => window.__qdTest, null, { timeout: 5000 });
    const running = () => pg.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.g-qd'))
      .map((a) => { const t = a.effect.target; return { name: a.animationName || (a.transitionProperty && `transition:${a.transitionProperty}`) || '', cls: String(t.getAttribute('class') || ''), props: (a.effect.getKeyframes ? a.effect.getKeyframes() : []).flatMap((k) => Object.keys(k)).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)) }; }));

    await section(`print (${tag})`, async () => {
      const look = await pg.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const tooth = getComputedStyle(q('.qd-scene'), '::after');
        const word = getComputedStyle(q('.qd-word'));
        const pad = getComputedStyle(q('.qd-pad'), '::before');
        const stamp = getComputedStyle(q('.qd-stamp'));
        return { toothImg: tooth.backgroundImage.slice(0, 20), toothOp: +tooth.opacity, wordShadow: word.textShadow, padHt: pad.backgroundImage.slice(0, 24), stampImg: stamp.backgroundImage.slice(0, 20), plates: document.querySelectorAll('.qd-plate').length, dots: document.querySelectorAll('.qd-ht').length };
      });
      ok(look.toothImg.startsWith('url(') && look.toothOp > 0.3, `${tag}: paper tooth over the scene (${look.toothImg}, ${look.toothOp})`);
      ok(look.wordShadow && look.wordShadow !== 'none', `${tag}: the big signal word is printed off register (${look.wordShadow.slice(0, 50)})`);
      ok(look.padHt.includes('radial-gradient'), `${tag}: halftone on the pads`);
      ok(look.plates === 2 && look.dots >= 2, `${tag}: the gunslingers carry an off-register plate and a halftone (${look.plates} plates, ${look.dots} halftones)`);
      await h.shot(pg, `${process.env.SHOTS || '/tmp'}/flat-qd-${tag.replace(/ /g, '-')}-picker.png`).catch(() => {});
    });

    await section(`round (${tag})`, async () => {
      await pg.evaluate(() => window.__qdTest.force({ delay: 2600 }));
      await pg.evaluate(() => window.__qdTest.start('classic', '9'));
      await phaseIs(pg, 'steady');
      await h.wait(400);
      // an idle wait: breathing word and the room dimming run on the compositor
      const c0 = await counters(cdp);
      await h.wait(1200);
      const c1 = await counters(cdp);
      ok(c1.layouts - c0.layouts <= 3, `${tag}: 1.2 s of waiting does at most 3 layouts (${c1.layouts - c0.layouts})`);
      const idle = await running();
      ok(idle.every((r) => r.props.every((p) => SAFE.has(p))), `${tag}: every running animation is transform/opacity only (${idle.map((r) => `${r.name}[${r.props}]`).join(', ') || 'none'})`);
      ok(idle.every((r) => !r.name.startsWith('transition:')), `${tag}: no CSS transition runs while waiting`);
      if (reduced) ok(idle.length === 0, `${tag}: nothing animates under reduced motion (${idle.length})`);

      await phaseIs(pg, 'draw');
      const d0 = await counters(cdp);
      await h.wait(60);
      const slam = await running();
      const d1 = await counters(cdp);
      ok(d1.layouts - d0.layouts <= 2, `${tag}: the cue frame and its slam cause at most 2 layouts (${d1.layouts - d0.layouts})`);
      if (!reduced) ok(slam.some((r) => /qd-slam/.test(r.name)), `${tag}: the DRAW word slams in (${slam.map((r) => r.name).join(', ')})`);
      const box = await pg.evaluate(() => { const w = document.querySelector('.qd-sig:not(.qd-top) .qd-word'); return { h: w.offsetHeight, w: w.offsetWidth }; });
      ok(box.h > 20 && box.w > 40, `${tag}: the signal word has a box of its own (${box.w}x${box.h}), it is scaled, not resized`);
      await h.wait(250);

      // the tap: pressed in the very task of the pointerdown, no tween, timed from the event's timeStamp
      const t0 = await pg.evaluate(() => window.__qdTest.state().t0.a);
      const tap = await tapPad(pg, 'a');
      ok(tap.pressed, `${tag}: the pad is pressed in the same task as the pointerdown`);
      ok(/^0s$/.test(tap.transition.split(',')[0].trim()), `${tag}: ...with no tween on the press (transition ${tap.transition})`);
      const res = await pg.evaluate(() => window.__qdTest.state().res.a);
      ok(res && Number.isFinite(res.reaction) && Math.abs(res.reaction - Math.round((tap.ts - t0) * 10) / 10) < 0.11, `${tag}: the reaction is the event's timeStamp minus the signal frame (${res && res.reaction} vs ${Math.round((tap.ts - t0) * 10) / 10})`);
    });

    await section(`verdict juice (${tag})`, async () => {
      // second tap is Sydney's, 140 ms later is not needed: only one fired, so the round resolves "too slow" for her
      await pg.waitForFunction(() => window.__qdTest.state().verdict, null, { timeout: 6000 });
      await h.wait(120);
      const a = await running();
      const burst = a.filter((r) => /qd-burst/.test(r.name));
      const shake = a.filter((r) => /qd-quake|qd-slamshake/.test(r.name));
      const stampA = a.filter((r) => /qd-stamp/.test(r.name));
      if (!reduced) {
        ok(burst.length === 1 && /bs-a/.test(burst[0].cls), `${tag}: an ink burst plays at the winner's muzzle (${burst.map((r) => r.cls)})`);
        ok(shake.length >= 1, `${tag}: the scene shakes for the big moment (${shake.map((r) => r.name)})`);
        const op = await pg.evaluate(() => getComputedStyle(document.querySelector('.qd-bs.bs-a')).opacity);
        ok(+op > 0, `${tag}: the burst is visible (${op})`);
      } else {
        ok(burst.length === 0 && shake.length === 0 && stampA.length === 0, `${tag}: no burst, shake or stamp animation under reduced motion`);
        ok(await pg.evaluate(() => getComputedStyle(document.querySelector('.qd-bs')).display === 'none'), `${tag}: the burst art is hidden`);
      }
      ok(a.every((r) => r.props.every((p) => SAFE.has(p))), `${tag}: the verdict animates transform/opacity only (${a.map((r) => `${r.name}[${r.props}]`).join(', ')})`);
      const notch = await pg.evaluate(() => [...document.querySelectorAll('.qd-notches[data-w="a"] i')].filter((i) => i.classList.contains('on')).length);
      ok(notch === 1, `${tag}: the tally has one notch for Emerson (${notch})`);
      if (!reduced) {
        const nn = (await running()).filter((r) => /qd-notch/.test(r.name)).length;
        ok(nn >= 1, `${tag}: the new notch is stamped in (${nn} running)`);
      }
    });

    await section(`misfire (${tag})`, async () => {
      await pg.waitForFunction(() => window.__qdTest.state().phase === 'steady', null, { timeout: 15000 });
      await h.wait(200);
      const tap = await tapPad(pg, 'b');   // before the signal: a foul
      ok(tap.pressed, `${tag}: the early tap still presses the pad at once`);
      await h.wait(80);
      const a = await running();
      const sh = a.filter((r) => /qd-shake/.test(r.name) && /qd-pad/.test(r.cls));
      if (!reduced) ok(sh.length === 1 && sh[0].props.every((p) => p === 'translate'), `${tag}: the misfiring pad rattles (translate only) (${sh.map((r) => r.cls)})`);
      else ok(sh.length === 0, `${tag}: no rattle under reduced motion`);
      const v = await pg.evaluate(() => window.__qdTest.state().res.b);
      ok(v && v.foul, `${tag}: and it is still a foul for Sydney`);
    });
  } finally {
    ok(h.errors.length === 0, `${tag}: no page errors (${h.errors.join(' | ').slice(0, 200)})`);
    await h.close();
  }
}

(async () => {
  await run('light', false, BASE);
  await run('dark', false, BASE + 1);
  await run('light', true, BASE + 2);
  await run('dark', true, BASE + 3);
  console.log(`\n${passed} ok`);
  if (failures.length) { console.error('\nFAILURES:\n' + failures.join('\n')); process.exit(1); }
  console.log('ALL GOOD');
})();
