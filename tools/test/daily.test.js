// Question of the day: pick + guess days, free-text days, and old answers keeping their questions.
//   node tools/test/daily.test.js        (ports 9860-9863; PORT=… moves the block)
const path = require('path');
const { launch, ROOT } = require('./harness');

const BASE = Number(process.env.PORT) || 9860;
const SHOTS = process.env.SHOTS || path.join(__dirname, '.cache/daily-test');
require('fs').mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const text = async (pg, sel = '#app') => ((await pg.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
const daily = (h, w) => Object.assign({}, ((h.docs[`people/${w}`] || {}).daily) || {},
  ...Object.entries(h.docs).filter(([k]) => k.startsWith(`people/${w}/daily/`)).map(([, v]) => v.d || {}));
const today = '.daily:not(.compact)';
const pick = (pg, k, v) => pg.tap(`${today} [data-act="dailyPick"][data-k="${k}"][data-v="${v}"]`);

// The day → question mapping the app shipped with before the pick + guess days (frozen).
const dayNum = (key) => { const [y, m, d] = key.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2025, 0, 1)) / 864e5); };

(async () => {
  const { DAILY } = await import(path.join(ROOT, 'js/content.js'));
  const { DAILY2 } = await import(path.join(ROOT, 'js/content/daily.js'));
  const oldQ = (key) => DAILY[(((dayNum(key) * 37) % 100) + 100) % 100];
  const MC = DAILY2.flatMap((x, i) => (typeof x === 'object' ? [i] : []));
  const TXT = DAILY2.flatMap((x, i) => (typeof x === 'string' ? [i] : []));
  const qOf = (i) => (typeof DAILY2[i] === 'string' ? DAILY2[i] : DAILY2[i].q);

  // ── content shape ──
  assert(DAILY2.length >= 150 && MC.length >= 110 && TXT.length >= 35, `DAILY2 has ${DAILY2.length} items (${MC.length} pick + guess, ${TXT.length} free text)`);
  assert(MC.every((i) => DAILY2[i].q && DAILY2[i].o.length === 4 && new Set(DAILY2[i].o).size === 4 && DAILY2[i].o.every((o) => o.trim())), 'every pick + guess item has a question and 4 distinct options');
  const allQ = DAILY2.map((x, i) => qOf(i).toLowerCase());
  assert(new Set(allQ).size === allQ.length && !DAILY.some((q) => allQ.includes(q.toLowerCase())), 'no daily question repeats, or repeats an original one');

  let failed = false;
  const run = async (name, fn) => {
    try { await fn(); } catch (e) { failed = true; console.error(`${name}: ${e.message}`); }
  };

  // ── two phones answer a pick + guess day; the reveal; streak; tally ──
  await run('mc', async () => {
    // 2026-10-14 is the last original-list day, both answered it (old-format string answers).
    const seed = {
      'people/a': { daily: { '2026-10-14': 'old answer a' }, updated: 1 },
      'people/b': { daily: { '2026-10-14': 'old answer b' }, updated: 1 },
    };
    const h = await launch({ port: BASE, only: [], seedDocs: seed, coarse: true, today: '2026-10-15' });
    const { a, b } = h;
    try {
      await h.settle(); await h.settle();
      const item = DAILY2[MC[0]];
      assert((await text(a, `${today} .q`)) === item.q, `the first new day is a pick + guess day (“${item.q}”)`);
      assert(await a.$(`${today} .opts.guess`) && !(await a.$(`${today} textarea`)), 'it asks for your answer and a guess, with no text box');
      const sizes = await a.$$eval(`${today} .opt, ${today} [data-act="saveDaily"]`, (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
      assert(sizes.length === 9 && sizes.every(([w, hh]) => w >= 44 && hh >= 44), `all 8 options and the button are at least 44px (${sizes.map((s) => s.map(Math.round).join('x')).join(' ')})`);
      const wide = await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      assert(wide, 'no sideways scroll on the phone');

      // Lock it in too early: nothing saves
      await pick(a, 'm', 0);
      await a.tap(`${today} [data-act="saveDaily"]`); await h.settle();
      assert(!daily(h, 'a')['2026-10-15'] && /guess/i.test(await text(a, '.toast')), 'locking in without a guess asks for the guess and saves nothing');
      // change your mind, then guess
      await pick(a, 'm', 2); await pick(a, 'm', 0); await pick(a, 'g', 1);
      assert((await a.$$(`${today} .opt.sel`)).length === 2, 'one answer and one guess are highlighted');
      await a.tap(`${today} [data-act="saveDaily"]`); await h.settle();
      const sa = daily(h, 'a')['2026-10-15'];
      assert(sa && sa.i === MC[0] && sa.m === 0 && sa.g === 1, `Emerson’s pick and guess save with the question’s index (${JSON.stringify(sa)})`);
      assert(Object.keys(h.docs).some((k) => k === 'people/a/daily/2026-10'), 'it lives in the monthly daily doc');
      assert(/Waiting on Sydney/.test(await text(a, today)) && new RegExp(item.o[0]).test(await text(a, `${today} .bubble`)), 'Emerson sees their own pick and waits');

      await h.settle();
      assert(!(await b.$(`${today} .dreveal`)) && !(await b.$(`${today} .bubble`)) && /already answered/.test(await text(b, today)), 'Sydney sees that Emerson answered, but not what');
      await pick(b, 'm', 0); await pick(b, 'g', 0);
      await b.tap(`${today} [data-act="saveDaily"]`); await h.settle(); await h.settle();
      const sb = daily(h, 'b')['2026-10-15'];
      assert(sb && sb.i === MC[0] && sb.m === 0 && sb.g === 0, 'Sydney’s pick and guess save');

      const ra = await text(a, `${today} .dreveal`); const rb = await text(b, `${today} .dreveal`);
      assert(ra.includes(`You both picked “${item.o[0]}”`) && rb.includes(`You both picked “${item.o[0]}”`), 'both phones reveal “you both picked …”');
      assert(/Sydney guessed you right\./.test(ra) && /You guessed Emerson right\./.test(rb), 'the verdict names who guessed right, from each phone’s side');
      assert(ra.includes(`You guessed “${item.o[1]}” ✗`) && rb.includes(`Emerson guessed “${item.o[1]}” ✗`), 'the wrong guess shows what was guessed');
      assert(/Daily guesses Emerson 0 · Sydney 1 of 1/.test(await text(a, `${today} .dtally`)), 'the running tally counts it (Emerson 0 · Sydney 1)');
      assert(/2\s*day streak/i.test(await text(a, '.ticker')), 'the streak runs across the switch from the old questions (2 days)');
      await h.shot(a, path.join(SHOTS, 'daily-reveal-a.png'), { fullPage: false });

      // history: the old day keeps its original question, the new day keeps its reveal
      await a.tap('[data-act="go"][data-view="history"]');
      await a.waitForTimeout(300);
      const cards = await a.$$eval('.daily.compact', (els) => els.map((e) => ({ day: e.dataset.day, q: e.querySelector('.q').textContent, t: e.textContent })));
      const old = cards.find((c) => c.day === '2026-10-14'); const neu = cards.find((c) => c.day === '2026-10-15');
      assert(old && old.q === oldQ('2026-10-14') && old.t.includes('old answer a') && old.t.includes('old answer b'), `the last original day shows its original question (“${oldQ('2026-10-14')}”) and both answers`);
      assert(neu && neu.q === item.q && /You both picked/.test(neu.t), 'today shows its reveal in history too');
      assert(/Daily guesses/.test(await text(a, '.screen')), 'history shows the running tally');
      h.assertNoErrors();
    } finally { await h.close(); }
  });

  // ── history: old free-text days keep their questions; saved answers keep theirs ──
  await run('history', async () => {
    const days = ['2026-03-02', '2026-08-31', '2026-10-04', '2026-10-13'];
    const seed = {
      // the first app version kept daily answers inside the person doc
      'people/a': { daily: { [days[0]]: 'march a', [days[2]]: 'oct a' }, updated: 1 },
      'people/b': { daily: { [days[0]]: 'march b' }, updated: 1 },
      'people/a/daily/2026-08': { d: { [days[1]]: 'august a' } },
      'people/b/daily/2026-08': { d: { [days[1]]: 'august b' } },
      'people/b/daily/2026-10': { d: { [days[2]]: 'oct b', [days[3]]: 'only b' ,
        // a pick + guess answer whose index isn't what this day maps to: it keeps its own question
        '2026-10-16': { i: MC[7], m: 3, g: 2 } } },
      'people/a/daily/2026-10': { d: { '2026-10-16': { i: MC[7], m: 2, g: 3 }, '2026-10-18': { i: TXT[0], t: 'a text day answer' } } },
    };
    const h = await launch({ port: BASE + 1, only: [], seedDocs: seed, today: '2026-10-20' });
    const { a } = h;
    try {
      await h.settle(); await h.settle();
      await a.tap('[data-act="go"][data-view="history"]');
      await a.waitForTimeout(400);
      const cards = await a.$$eval('.daily.compact', (els) => els.map((e) => ({ day: e.dataset.day, q: e.querySelector('.q').textContent, t: e.textContent })));
      const byDay = Object.fromEntries(cards.map((c) => [c.day, c]));
      for (const d of days) assert(byDay[d] && byDay[d].q === oldQ(d), `${d} shows its original question (“${oldQ(d)}”)`);
      assert(byDay[days[0]].t.includes('march a') && byDay[days[0]].t.includes('march b') && byDay[days[1]].t.includes('august b'), 'and both answers, from the person doc or the monthly docs');
      assert(byDay[days[3]].t.includes('only b') === false && /already answered/.test(byDay[days[3]].t), 'a day only Sydney answered stays hidden from Emerson');
      const d16 = byDay['2026-10-16'];
      const it7 = DAILY2[MC[7]];
      assert(d16 && d16.q === it7.q && d16.t.includes(`“${it7.o[2]}”`) && d16.t.includes(`“${it7.o[3]}”`), 'a pick + guess answer shows against the question it was saved with');
      const d18 = byDay['2026-10-18'];
      assert(d18 && d18.q === qOf(TXT[0]) && d18.t.includes('a text day answer'), 'a free-text answer from the new list keeps its question');
      h.assertNoErrors();
    } finally { await h.close(); }
  });

  // ── a free-text day from the new list; an older app on the other phone ──
  await run('text', async () => {
    // 2026-10-18 is the 4th new day: free text. Sydney answered it from an older app version,
    // which wrote a plain string against the original list's question for that day.
    const seed = { 'people/a': { updated: 1 }, 'people/b': { updated: 1 }, 'people/b/daily/2026-10': { d: { '2026-10-17': 'old app answer' } } };
    const h = await launch({ port: BASE + 2, only: [], seedDocs: seed, today: '2026-10-18' });
    const { a } = h;
    try {
      await h.settle(); await h.settle();
      assert((await text(a, `${today} .q`)) === qOf(TXT[0]) && await a.$(`${today} textarea`), `every fourth day is free text (“${qOf(TXT[0])}”)`);
      await a.fill(`${today} textarea`, 'Six words: you are my favorite');
      await a.tap(`${today} [data-act="saveDaily"]`); await h.settle();
      const v = daily(h, 'a')['2026-10-18'];
      assert(v && v.i === TXT[0] && v.t === 'Six words: you are my favorite', `a new free-text answer saves with its index (${JSON.stringify(v)})`);
      // yesterday: Sydney's older app answered the original question, so Emerson gets that one too
      await a.tap('[data-act="go"][data-view="history"]'); await a.waitForTimeout(300);
      const y = await a.$eval('.daily.compact[data-day="2026-10-17"]', (e) => ({ q: e.querySelector('.q').textContent, box: !!e.querySelector('textarea') }));
      assert(y.q === oldQ('2026-10-17') && y.box, 'when the partner answered from an older app, you answer the same question they did');
      await a.fill('.daily.compact[data-day="2026-10-17"] textarea', 'caught up');
      await a.tap('.daily.compact[data-day="2026-10-17"] [data-act="saveDaily"]'); await h.settle();
      assert(daily(h, 'a')['2026-10-17'] === 'caught up' && /old app answer/.test(await text(a, '.daily.compact[data-day="2026-10-17"]')), 'that answer is a plain string and both answers show');
      h.assertNoErrors();
    } finally { await h.close(); }
  });

  // ── the mapping: 3 pick + guess days, then a free-text day, in list order ──
  await run('mapping', async () => {
    const h = await launch({ port: BASE + 3, only: [], who: ['a'], today: '2026-10-22' });
    try {
      const a = h.a;
      await h.settle();
      assert((await text(a, `${today} .q`)) === qOf(TXT[1]) && await a.$(`${today} textarea`), 'the 8th new day is the second free-text question');
      await a.tap('[data-act="go"][data-view="history"]'); await a.waitForTimeout(300);
      const y = await a.$eval('.daily.compact[data-day="2026-10-21"]', (e) => ({ q: e.querySelector('.q').textContent, opts: e.querySelectorAll('.opt').length }));
      assert(y.q === DAILY2[MC[5]].q && y.opts === 8, 'the day before is the 6th pick + guess question, answerable from history');
      h.assertNoErrors();
    } finally { await h.close(); }
  });

  console.log(failed ? '\nFAILED' : '\nALL GOOD');
  if (failed) process.exitCode = 1;
})();
