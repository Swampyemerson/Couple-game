// Integration: the FULL bundle with every game. Each game must register, show in the hub,
// open its sheet, start on one device (or show its two-device card), and close cleanly,
// with no page errors. Catches cross-game CSS/global collisions the per-game tests can't.
//   node tools/test/all-games.test.js
const { launch } = require('./harness');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

(async () => {
  const h = await launch({ port: Number(process.env.PORT || 8797), coarse: true });
  const { a } = h;
  try {
    await h.openGames(a);
    const ids = await a.$$eval('.gh [data-g="sheet"][data-game]', (xs) => [...new Set(xs.map((x) => x.dataset.game))]);
    console.log('hub shows', ids.length, 'games:', ids.join(', '));
    assert(ids.length >= 16, 'all 16 games are in the hub');
    for (const id of ids) {
      const before = h.errors.length;
      await h.openSheet(a, id);
      const local = await a.$(`#game-root [data-mode="local"][data-game="${id}"]`);
      if (local) {
        await local.click();
        await a.waitForSelector('#game-root .gm', { timeout: 8000 });
        await a.waitForTimeout(id === 'rush' || id === 'chameleon' || id === 'tower' || id === 'bones' ? 3500 : 1200);
        const stageEmpty = await a.$eval('#game-root .gm-stage', (s) => s.innerHTML.trim().length === 0).catch(() => true);
        assert(!stageEmpty, `${id}: starts on one device and draws something`);
        // turn games leave a local match behind; end it so the hub stays tidy
        await a.click('#game-root [data-g="close"]');
      } else {
        await a.click('#game-root [data-g="sheet-close"].gs-close').catch(() => a.keyboard.press('Escape'));
        console.log(`   ${id}: no one-device mode (two devices only)`);
      }
      await a.waitForTimeout(300);
      assert(h.errors.length === before, `${id}: no page errors (${h.errors.slice(before).join(' | ')})`);
    }
    // nothing keeps running once every game is closed
    const live = await a.evaluate(() => document.querySelectorAll('#game-root canvas').length);
    assert(live === 0, 'no game canvases left in the DOM after closing');
    h.assertNoErrors();
    console.log('\nALL GOOD');
  } catch (e) {
    console.error(e.message, h.errors);
    await h.shot(a, (process.env.SHOTS || '.') + '/all-games-fail.png').catch(() => {});
    process.exitCode = 1;
  } finally { await h.close(); }
})();
