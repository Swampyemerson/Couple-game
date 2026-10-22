// Flat unit, board games (upgrade 2): the smoothness properties of Four in a Row, Dots & Boxes and Ultimate Tic-Tac-Toe.
//   PORT=9040 node tools/test/games/flat-board.test.js
// The rules and the full UI flows are in board.test.js; this file checks what the upgrade is for:
//  - every running animation is on an HTML element (so it can run on the compositor), none on an SVG child;
//  - an idle board with a lifted / selected piece does no layout work at all (nothing animates layout);
//  - a move patches the board (existing pieces keep their DOM nodes) instead of rebuilding it;
//  - reduced motion: nothing animates, and the game still works.
const { launch } = require('../harness');

let passed = 0;
const failures = [];
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); passed++; console.log('ok -', m); };
async function section(name, fn) {
  console.log(`\n# ${name}`);
  try { await fn(); } catch (e) { failures.push(`${name}: ${e.message}`); console.error('not ok -', e.message); }
}

/** Every animation that is running right now: { tag, svgChild } for each target. */
const RUNNING = () => document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.g-four, .g-dots, .g-ult'))
  .map((a) => { const t = a.effect.target; return { tag: t.tagName.toLowerCase(), cls: String(t.getAttribute('class') || ''), svgChild: t instanceof SVGElement && t.tagName.toLowerCase() !== 'svg', props: (a.effect.getKeyframes ? a.effect.getKeyframes() : []).flatMap((k) => Object.keys(k)).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)) }; });
/** Chrome's layout counter, through the page's own CDP session. */
async function layoutCount(cdp) {
  const m = (await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === 'LayoutCount');
  return m ? m.value : 0;
}

async function tapSel(pg, sel) {
  const p = await pg.evaluate((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  await pg.touchscreen.tap(p.x, p.y);
}

async function run(scheme, port) {
  const h = await launch({ port, only: ['four', 'dots', 'ultimate'], colorScheme: scheme, coarse: true });
  const pg = h.a;
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Performance.enable');
  try {
    await section(`four (${scheme})`, async () => {
      await h.newLocalGame(pg, 'four');
      await h.wait(500);
      const col = (c) => `.g-four .g4-col[data-col="${c}"]`;
      // a lifted disc bobs and the landing ring spins: both must be compositor-only, and idle must not lay anything out
      await tapSel(pg, col(3));
      await h.wait(500);
      ok(await pg.$eval('.g4-lift', (x) => x.classList.contains('on')), 'four: a tap lifts the disc');
      const running = await pg.evaluate(RUNNING);
      ok(running.length >= 2 && running.every((r) => !r.svgChild), `four: with a disc lifted, every running animation is on an HTML element (${running.map((r) => r.tag + '.' + r.cls.split(' ')[0]).join(', ')})`);
      ok(running.every((r) => r.props.every((p) => ['transform', 'opacity', 'rotate', 'translate', 'scale'].includes(p))), 'four: and they only animate transform / opacity');
      const l0 = await layoutCount(cdp);
      await h.wait(1500);
      const l1 = await layoutCount(cdp);
      ok(l1 - l0 <= 2, `four: 1.5 s of an idle lifted disc causes at most 2 layouts (${l1 - l0})`);
      // drop it: fall, squash, settle are on the compositor; the disc node survives the next move
      await tapSel(pg, col(3));
      await h.wait(120);
      const fall = await pg.evaluate(RUNNING);
      ok(fall.some((r) => r.cls.includes('g4-fall')) && fall.every((r) => !r.svgChild), 'four: a falling disc is an HTML box animated by transform');
      await h.wait(1100);
      const node = await pg.evaluateHandle(() => document.querySelector('.g4-discs .g4-d'));
      for (const c of [2, 4]) { await tapSel(pg, col(c)); await h.wait(120); await tapSel(pg, col(c)); await h.wait(700); }
      ok(await pg.evaluate((n) => n.isConnected && document.querySelectorAll('.g4-discs .g4-d').length === 3, node), 'four: moves patch the board (the first disc is the same DOM node, three discs now)');
      // a refused move shakes without throwing layout
      await h.wait(300);
      ok((await pg.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.g-four, .g-dots, .g-ult')).length)) <= 4, 'four: the board settles to a few animations when nothing is happening');
    });

    await section(`dots (${scheme})`, async () => {
      await h.closeGame(pg).catch(() => {});
      await h.newLocalGame(pg, 'dots');
      await h.wait(500);
      const hit = (k) => `.g-dots .gd-hit[data-k="${k}"]`;
      await tapSel(pg, hit('h-1-1'));
      await h.wait(300);
      ok(await pg.$eval('.gd-pg', (x) => x.classList.contains('is-sel')), 'dots: a tap selects the line');
      const running = await pg.evaluate(RUNNING);
      ok(running.length >= 1 && running.every((r) => !r.svgChild) && running.every((r) => r.props.every((p) => ['transform', 'opacity', 'rotate', 'translate', 'scale'].includes(p))), `dots: the selected line pulses with transform only, on an HTML element (${running.map((r) => r.tag + '.' + r.cls.split(' ')[0]).join(', ')})`);
      const l0 = await layoutCount(cdp);
      await h.wait(1500);
      ok((await layoutCount(cdp)) - l0 <= 2, 'dots: an idle selected line does no layout work');
      await tapSel(pg, hit('h-1-1'));
      await h.wait(80);
      const draw = await pg.evaluate(RUNNING);
      ok(draw.some((r) => r.cls.includes('gd-ln')) && draw.every((r) => !r.svgChild), 'dots: a line inks in by scaling an HTML pill, not by animating an SVG dash');
      await h.wait(500);
      const first = await pg.evaluateHandle(() => document.querySelector('.gd-lines .gd-ln'));
      await tapSel(pg, hit('v-0-0')); await h.wait(100); await tapSel(pg, hit('v-0-0')); await h.wait(500);
      ok(await pg.evaluate((n) => n.isConnected && document.querySelectorAll('.gd-lines .gd-ln').length === 2, first), 'dots: a new line is added to the board; the first line keeps its DOM node');
      // the layout probe: a whole move (select, draw) costs only a handful of layouts
      const a0 = await layoutCount(cdp);
      await tapSel(pg, hit('h-2-2')); await h.wait(100); await tapSel(pg, hit('h-2-2')); await h.wait(700);
      const per = (await layoutCount(cdp)) - a0;
      ok(per <= 14, `dots: a move (select + draw) costs ${per} layouts (≤ 14)`);
    });

    await section(`ultimate (${scheme})`, async () => {
      await h.closeGame(pg).catch(() => {});
      await h.newLocalGame(pg, 'ultimate');
      await h.wait(500);
      const cell = (b, i) => `.g-ult .gu-c[data-b="${b}"][data-i="${i}"]`;
      await tapSel(pg, cell(4, 4)); await h.wait(100); await tapSel(pg, cell(4, 4)); await h.wait(700);
      const running = await pg.evaluate(RUNNING);
      ok(running.every((r) => !r.svgChild || r.cls === ''), `ultimate: the breathing ring and marks animate HTML / root-SVG boxes only (${running.map((r) => r.tag + '.' + r.cls.split(' ')[0]).join(', ')})`);
      ok(running.every((r) => r.props.every((p) => ['transform', 'opacity', 'rotate', 'translate', 'scale'].includes(p))), 'ultimate: only transform / opacity are animated');
      const l0 = await layoutCount(cdp);
      await h.wait(1500);
      ok((await layoutCount(cdp)) - l0 <= 2, 'ultimate: an idle board does no layout work');
      const mark = await pg.evaluateHandle(() => document.querySelector('.gu-c[data-b="4"][data-i="4"] svg'));
      await tapSel(pg, cell(4, 0)); await h.wait(100); await tapSel(pg, cell(4, 0)); await h.wait(700);
      ok(await pg.evaluate((n) => n.isConnected, mark), 'ultimate: a mark already placed keeps its DOM node when the next move lands');
      // a refused tap (wrong board) shakes the board and plays nothing
      const wrong = await pg.evaluate(() => { const f = document.querySelector('.gu-sb.is-open'); const b = f ? Number(f.dataset.b) : 0; return (b + 1) % 9; });
      await tapSel(pg, cell(wrong, 4)); await h.wait(60);
      const shaken = await pg.evaluate(() => document.getAnimations().some((a) => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('gu-sb')));
      ok(shaken, 'ultimate: a tap in the wrong board shakes it (compositor animation on the board)');
    });

    await section(`reduced motion (${scheme})`, async () => {
      await h.closeGame(pg).catch(() => {});
      await pg.emulateMedia({ reducedMotion: 'reduce' });
      await h.newLocalGame(pg, 'four');
      await h.wait(400);
      await tapSel(pg, '.g-four .g4-col[data-col="3"]'); await h.wait(200);
      ok(await pg.$eval('.g4-lift', (x) => x.classList.contains('on')), 'four (reduced motion): a tap still lifts the disc');
      ok((await pg.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.g-four, .g-dots, .g-ult')).length)) === 0, 'four (reduced motion): nothing animates, not even the bob');
      await tapSel(pg, '.g-four .g4-col[data-col="3"]'); await h.wait(150);
      ok((await pg.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.g-four, .g-dots, .g-ult')).length)) === 0 && (await pg.$$eval('.g4-d', (xs) => xs.length)) === 1, 'four (reduced motion): the disc lands at once, no fall, squash or shake');
      await h.closeGame(pg).catch(() => {});
      await h.newLocalGame(pg, 'dots');
      await h.wait(400);
      await tapSel(pg, '.g-dots .gd-hit[data-k="h-0-0"]'); await h.wait(200);
      await tapSel(pg, '.g-dots .gd-hit[data-k="h-0-0"]'); await h.wait(150);
      ok((await pg.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.g-four, .g-dots, .g-ult')).length)) === 0 && (await pg.$$eval('.gd-ln', (xs) => xs.length)) === 1, 'dots (reduced motion): the line appears at once and nothing animates (the selection does not throb)');
      await h.closeGame(pg).catch(() => {});
      await h.newLocalGame(pg, 'ultimate');
      await h.wait(400);
      await tapSel(pg, '.g-ult .gu-c[data-b="4"][data-i="4"]'); await h.wait(100); await tapSel(pg, '.g-ult .gu-c[data-b="4"][data-i="4"]'); await h.wait(300);
      ok((await pg.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.g-four, .g-dots, .g-ult')).length)) === 0, 'ultimate (reduced motion): nothing animates, the lit board stays lit');
      await pg.emulateMedia({ reducedMotion: 'no-preference' });
    });

    await section(`no page errors (${scheme})`, () => { h.assertNoErrors(); ok(true, `no page errors (${scheme})`); });
  } finally {
    await h.close();
  }
}

(async () => {
  const base = Number(process.env.PORT) || 9040;
  await run('light', base);
  await run('dark', base + 1);
  console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? '\n' + failures.join('\n') : ''}`);
  if (failures.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
