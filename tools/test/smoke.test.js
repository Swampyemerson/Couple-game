// Framework smoke test: online turn game, same-phone turn game, live game.
//   node tools/test/smoke.test.js          (PORT=8940 node … to pick the ports: PORT and PORT+1)
const { launch } = require('./harness');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

(async () => {
  const h = await launch({ port: Number(process.env.PORT) || 8790, only: ['example-ttt', 'example-tap'] });
  const { a, b } = h;
  try {
    // ── online turn game ──
    const id = await h.newOnlineGame(a, 'example-ttt');
    assert(/^[a-z0-9]{12}$/.test(id), 'online match created');
    await h.settle();
    assert(h.matches().length === 1, 'match doc stored');
    await h.openMatch(b, id);
    const pageOf = { a, b };
    // x wins down the left column if moves go 0,1,3,4,6
    const seq = [0, 1, 3, 4, 6];
    for (const sq of seq) {
      const e = await h.engine(a, id);
      const turn = e.acts[0];
      await pageOf[turn].click(`.ttt button[data-i="${sq}"]`);
      await h.settle();
    }
    const ea = await h.engine(a, id);
    const eb = await h.engine(b, id);
    assert(ea.over && eb.over, 'both phones agree the game is over');
    assert(ea.result.winner === eb.result.winner && ea.result.winner === ea.first, 'first player won on both phones');
    await h.wait(1300);
    assert(await a.isVisible('#game-root .gm-end') && await b.isVisible('#game-root .gm-end'), 'end card shows on both');
    assert(h.results().length === 1, 'one result recorded');
    // rematch from b: new match, other player first
    await b.click('#game-root [data-g="rematch"]');
    await h.settle();
    assert(h.matches().length === 2, 'rematch created a new match');
    await h.closeGame(b);
    await h.closeGame(a);

    // ── out-of-turn move is refused ──
    const id2 = h.matches().find((m) => m.id !== id).id;
    const e2 = await h.engine(a, id2);
    const waiting = e2.acts[0] === 'a' ? b : a;
    await h.openMatch(waiting, id2);
    const disabled = await waiting.$eval('.ttt button[data-i="4"]', (x) => x.disabled);
    assert(disabled, 'board is locked when it is not your turn');
    await h.closeGame(waiting);

    // ── same phone ──
    await h.newLocalGame(a, 'example-ttt');
    for (const sq of [0, 1, 3, 4, 6]) { await a.click(`.ttt button[data-i="${sq}"]`); await h.wait(60); }
    await h.wait(1100);
    assert(await a.isVisible('#game-root .gm-end'), 'same-phone game ends');
    await h.closeGame(a);
    await h.settle();
    assert(h.results().length === 2, 'same-phone result recorded');

    // ── live game ──
    await h.startLive(a, 'example-tap', 'live');
    await h.settle();
    assert(await b.isVisible('#gm-invite'), 'partner sees the live invite');
    await b.click('#gm-invite [data-g="invite-yes"]');
    await h.settle(); await h.settle();
    assert(!(await a.isVisible('#game-root .gm-wait')), 'host stops waiting once partner joins');
    for (let i = 0; i < 3; i++) { await b.click('.tap button'); await h.wait(30); }
    await h.settle();
    const guestSees = await a.textContent('.tap button');
    assert(/Emerson: 0/.test(guestSees), 'host shows its own count');
    const hostCountsGuest = await a.evaluate(() => document.querySelector('#game-root [data-score="b"]').textContent);
    assert(hostCountsGuest === '3', 'host counted the guest taps');
    for (let i = 0; i < 20; i++) { await a.click('.tap button'); await h.wait(15); }
    await h.settle(); await h.settle();
    assert(await a.isVisible('#game-root .gm-end'), 'live game ends for host');
    assert(await b.isVisible('#game-root .gm-end'), 'live game ends for guest');
    assert(h.results().length === 3, 'live result recorded once (by host)');
    await a.click('#game-root [data-g="rematch"]');
    await h.settle();
    assert(!(await b.isVisible('#game-root .gm-end')), 'live rematch restarts on both');

    h.assertNoErrors();
    console.log('\nALL GOOD');
  } catch (e) {
    console.error(e.message);
    await h.shot(a, (process.env.SHOTS || '.') + '/smoke-a.png').catch(() => {});
    await h.shot(b, (process.env.SHOTS || '.') + '/smoke-b.png').catch(() => {});
    console.error('errors:', h.errors);
    process.exitCode = 1;
  } finally {
    await h.close();
  }
})();

// Reliability: with EVERY room event dropped, finish and rematch still reach both phones
// through presence.
(async () => {
  await new Promise((r) => setTimeout(r, 200));
  if (process.exitCode) return;
  const h = await launch({ port: (Number(process.env.PORT) || 8790) + 1, only: ['example-tap'], dropRate: 1 });
  const { a, b } = h;
  try {
    await h.startLive(a, 'example-tap', 'live');
    await h.settle();
    assert(await b.isVisible('#gm-invite'), 'invite arrives through presence when the event is dropped');
    await b.click('#gm-invite [data-g="invite-yes"]');
    await h.settle(); await h.settle();
    for (let i = 0; i < 20; i++) { await a.click('.tap button'); await h.wait(15); }
    await h.settle(); await h.settle();
    assert(await b.isVisible('#game-root .gm-end'), 'guest sees the end card although __finish was dropped');
    assert(h.results().length === 1, 'result recorded once');
    await b.click('#game-root [data-g="rematch"]');
    await h.settle(); await h.settle();
    assert(!(await a.isVisible('#game-root .gm-end')), 'host restarts on rematch although __rematch was dropped');
    h.assertNoErrors();
    console.log('\nALL GOOD (lossy)');
  } catch (e) {
    console.error(e.message, h.errors);
    process.exitCode = 1;
  } finally { await h.close(); }
})();
