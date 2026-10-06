// Migration: the live artifact already holds data written by the first version of the app
// (person docs with packs and `daily` inside them). The current build must read all of it,
// show it, and never lose it when new answers are written. Content here is synthetic; only
// the SHAPE matches the real data.
//   node tools/test/migrate.test.js
const { launch } = require('./harness');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

const quiz = (seed) => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`i${i}`, { g: (i + seed) % 4, m: (i * 3 + seed) % 4 }]));
const picks = (n, seed) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`i${i}`, (i + seed) % 2]));
const old = (w, n) => ({
  daily: { '2026-10-04': `old daily answer from ${w}` },
  packs: {
    'quiz-basics': { ans: quiz(n), done: 1791147055207 + n },
    'tot-everyday': { ans: picks(16, n), done: 1791253109699 + n },
    lovelang: { ans: picks(15, n + 1), done: 1791094719400 + n },
  },
  uid: `u_${w}`,
  updated: 1791253952034 + n,
});

(async () => {
  const seedDocs = { 'people/a': old('a', 0), 'people/b': old('b', 1) };
  const h = await launch({ port: Number(process.env.PORT || 8792), only: [], seedDocs, coarse: true });
  const { a, b } = h;
  const packsOf = (w) => Object.keys((h.docs[`people/${w}`] || {}).packs || {}).sort().join(',');
  try {
    await h.settle(); await h.settle();
    const before = { a: packsOf('a'), b: packsOf('b') };
    assert(before.a === 'lovelang,quiz-basics,tot-everyday', 'seeded old-format docs are in place');

    // old answers are visible
    await a.click('[data-act="tab"][data-tab="play"]');
    await a.waitForTimeout(400);
    const basics = await a.$eval('[data-act="openPack"][data-id="quiz-basics"]', (x) => x.textContent);
    assert(/result/i.test(basics), 'a finished-by-both pack shows as having results');
    await a.click('[data-act="openPack"][data-id="quiz-basics"]');
    await a.waitForTimeout(500);
    const res = await a.textContent('#app');
    assert(/\d+\s*\/\s*10/.test(res), 'the old quiz results render with scores');
    await a.click('[data-act="back"]');
    await a.click('[data-act="go"][data-view="history"]').catch(async () => {
      await a.click('[data-act="tab"][data-tab="us"]'); await a.click('[data-act="go"][data-view="history"]');
    });
    await a.waitForTimeout(400);
    const hist = await a.textContent('#app');
    assert(hist.includes('old daily answer from a') && hist.includes('old daily answer from b'), 'old daily answers (stored inside the person doc) show in history');

    // new writes don't lose old data
    await a.click('[data-act="tab"][data-tab="home"]').catch(() => {});
    await a.evaluate(() => { const t = document.querySelector('textarea[data-draft^="daily"]'); if (t) { t.value = 'new daily from a'; t.dispatchEvent(new Event('input', { bubbles: true })); } });
    const saveBtn = await a.$('[data-act="saveDaily"]');
    if (saveBtn) { await saveBtn.click(); await h.settle(); await h.settle(); }
    const allDaily = JSON.stringify(Object.entries(h.docs).filter(([k]) => k.startsWith('people/a')).map(([, v]) => v));
    assert(allDaily.includes('new daily from a'), 'a new daily answer is stored');
    assert(allDaily.includes('old daily answer from a'), 'the old daily answer is still stored');
    assert(packsOf('a') === before.a, 'writing a daily answer kept every old pack answer');

    // answer a new pack on b
    await b.click('[data-act="tab"][data-tab="play"]');
    await b.click('[data-act="openPack"][data-id="wyr-silly"]');
    await b.click('[data-act="startPack"]');
    for (let i = 0; i < 3; i++) { await b.locator('[data-act="answer"]').first().click(); await b.waitForTimeout(350); }
    await h.settle(); await h.settle();
    assert(packsOf('b').includes('wyr-silly') && before.b.split(',').every((p) => packsOf('b').includes(p)), 'a new pack answer was added and every old pack survived');
    const bq = h.docs['people/b'].packs['quiz-basics'];
    assert(JSON.stringify(bq.ans) === JSON.stringify(seedDocs['people/b'].packs['quiz-basics'].ans), 'old answers are byte-for-byte unchanged');

    // reload both and check again
    await a.reload(); await b.reload();
    // (a reload mid-pack returns to the same question, so wait for any app content)
    for (const pg of [a, b]) await pg.waitForFunction(() => document.querySelector('#app') && document.querySelector('#app').children.length > 0);
    await h.settle(); await h.settle();
    assert(packsOf('a') === before.a && packsOf('b').includes('quiz-basics'), 'after reloading both phones nothing was lost');
    h.assertNoErrors();
    console.log('\nALL GOOD');
  } catch (e) {
    console.error(e.message, h.errors);
    await h.shot(a, (process.env.SHOTS || '.') + '/migrate-fail-a.png').catch(() => {});
    process.exitCode = 1;
  } finally { await h.close(); }
})();
