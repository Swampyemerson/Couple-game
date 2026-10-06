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
    await b.waitForFunction(() => window.__netTest, null, { timeout: 8000 });
    const t0 = Date.now();
    await b.waitForFunction(() => window.__netTest && window.__netTest.net.synced, null, { timeout: 8000, polling: 20 });
    const syncMs = Date.now() - t0;
    assert(syncMs < 1500, `guest clock ready quickly (${syncMs} ms at ~120 ms RTT, 30% loss)`);
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

    assert(!h.warnings.length, 'a 60-message burst stays inside the room budget (batched, cumulative acks)' + (h.warnings.length ? ': ' + h.warnings.join('; ') : ''));

    // The guest re-mounts mid-stream (closes the game and comes back) while the host stays.
    // The host's stream is at seq 61+; the fresh guest must pick it up from there, not wait for 1.
    await h.closeGame(b);
    await h.wait(400);
    await h.startLive(b, 'example-net', 'live');
    await b.waitForFunction(() => window.__netTest && window.__netTest.net.synced, null, { timeout: 8000 });
    await a.evaluate(() => { for (let i = 100; i < 110; i++) window.__netTest.net.send('msg', { i }); });
    await b.evaluate(() => { for (let i = 200; i < 210; i++) window.__netTest.net.send('msg', { i }); });
    await b.waitForFunction(() => window.__netTest.got.length >= 10, null, { timeout: 20000 }).catch(() => {});
    await a.waitForFunction(() => window.__netTest.got.length >= 70, null, { timeout: 20000 }).catch(() => {});
    await h.wait(800);
    const gotB = await b.evaluate(() => window.__netTest.got.map((m) => m.d.i));
    assert(gotB.length === 10 && gotB.every((v, i) => v === 100 + i), `re-mounted guest gets the host's stream in order (${JSON.stringify(gotB)})`);
    const gotA = await a.evaluate(() => window.__netTest.got.slice(60).map((m) => m.d.i));
    assert(gotA.length === 10 && gotA.every((v, i) => v === 200 + i), `host gets the re-mounted guest's new stream (${JSON.stringify(gotA)})`);

    // net.reset(): a fresh session on one side; both directions keep flowing.
    await b.evaluate(() => { window.__netTest.got.length = 0; window.__netTest.net.reset(); });
    await a.evaluate(() => { window.__netTest.got.length = 0; for (let i = 300; i < 305; i++) window.__netTest.net.send('msg', { i }); });
    await b.evaluate(() => { for (let i = 400; i < 405; i++) window.__netTest.net.send('msg', { i }); });
    await b.waitForFunction(() => window.__netTest.got.length >= 5, null, { timeout: 15000 }).catch(() => {});
    await a.waitForFunction(() => window.__netTest.got.length >= 5, null, { timeout: 15000 }).catch(() => {});
    const rb = await b.evaluate(() => window.__netTest.got.map((m) => m.d.i));
    const ra = await a.evaluate(() => window.__netTest.got.map((m) => m.d.i));
    assert(JSON.stringify(rb) === '[300,301,302,303,304]' && JSON.stringify(ra) === '[400,401,402,403,404]', `after net.reset() both directions deliver in order (${JSON.stringify(rb)} / ${JSON.stringify(ra)})`);
    await b.waitForFunction(() => window.__netTest.net.synced && window.__netTest.net.remote(), null, { timeout: 8000 });

    // remoteInto: same values as remote(), into a reused object
    const into = await b.evaluate(() => {
      const n = window.__netTest.net; const out = {};
      const t = n.now();
      const r1 = n.remote(t); const r2 = n.remoteInto(out, t);
      const again = n.remoteInto(out, t + 5);
      const r2c = { ...r2 };
      return { same: Math.abs(r1.x - r2c.x) < 1e-9 && Math.abs(r1.yaw - r2c.yaw) < 1e-9, reused: r2 === out && again === out, r1, r2: r2c };
    });
    assert(into.same && into.reused, 'remoteInto matches remote() and reuses the object ' + JSON.stringify(into));

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
