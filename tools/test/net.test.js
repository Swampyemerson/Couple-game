// Netcode kit test: clock sync, reliable delivery under packet loss, interpolation.
//   node tools/test/net.test.js            (PORT=8942 node … to pick the port)
const { launch } = require('./harness');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

(async () => {
  const h = await launch({ port: Number(process.env.PORT) || 8798, only: ['example-net'], latency: 60, dropRate: 0.3 });
  const { a, b } = h;
  try {
    await h.startLive(a, 'example-net', 'live');
    await h.settle();
    await b.click('#gm-invite [data-g="invite-yes"]');
    await a.waitForFunction(() => window.__netTest, null, { timeout: 8000 });
    await b.waitForFunction(() => window.__netTest && window.__netTest.net.synced, null, { timeout: 8000 });
    await h.wait(2500);
    // Both pages run in one browser, so wall clocks match: compare shared clocks via Date.now anchors.
    const ta = await a.evaluate(() => ({ n: window.__netTest.net.now(), d: Date.now() }));
    const tb = await b.evaluate(() => ({ n: window.__netTest.net.now(), d: Date.now() }));
    const skew = Math.abs((ta.n - ta.d) - (tb.n - tb.d));
    assert(skew < 25, `shared clocks agree within 25 ms (got ${skew.toFixed(1)} ms at ~120 ms RTT)`);
    const rtt = await b.evaluate(() => window.__netTest.net.rtt);
    assert(rtt > 40 && rtt < 400, `rtt measured (${rtt} ms)`);

    // 60 reliable messages each way through 30% packet loss
    await b.evaluate(() => { for (let i = 0; i < 60; i++) window.__netTest.net.send('msg', { i }); });
    await a.evaluate(() => { for (let i = 0; i < 60; i++) window.__netTest.net.send('msg', { i }); });
    await a.waitForFunction(() => window.__netTest.got.length >= 60, null, { timeout: 30000 });
    await b.waitForFunction(() => window.__netTest.got.length >= 60, null, { timeout: 30000 });
    await h.wait(1500);
    for (const [pg, who] of [[a, 'host'], [b, 'guest']]) {
      const got = await pg.evaluate(() => window.__netTest.got.map((m) => m.d.i));
      assert(got.length === 60 && got.every((v, i) => v === i), `${who} got all 60 reliable messages once, in order, despite 30% loss`);
    }

    // interpolation is smooth and monotonic
    const xs = [];
    for (let i = 0; i < 20; i++) { xs.push(await b.evaluate(() => { const s = window.__netTest.net.remote(); return s && s.x; })); await h.wait(16); }
    assert(xs.every((x) => typeof x === 'number'), 'guest samples host state');
    assert(xs.every((x, i) => i === 0 || x >= xs[i - 1] - 0.5), 'interpolated values move smoothly forward');
    h.assertNoErrors();
    console.log('\nALL GOOD');
  } catch (e) {
    console.error(e.message, h.errors);
    process.exitCode = 1;
  } finally { await h.close(); }
})();
