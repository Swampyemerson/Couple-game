// App preview: seeds a lived-in couple (finished packs, one in progress, a streak, a start date,
// a bucket list, a game waiting) and screenshots every main screen of the app at 390 and 360,
// in light, dark, and the Spicy tab's after-dark mode.
//
//   node tools/test/app-preview.js [light|dark|both] [outDir]
//
// Uses the design-preview stand-in games and font cache. Ports 8872-8873.
const fs = require('fs');
const path = require('path');
const { launch, ROOT } = require('./harness');
const { prepare } = require('./design-preview');

const MODE = process.argv[2] || 'both';
const OUT = path.resolve(process.argv[3] || process.env.SHOTS || path.join(__dirname, '.cache/app'));
fs.mkdirSync(OUT, { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dkey(d); };

async function seed() {
  const tmp = path.join(__dirname, '.cache/content.mjs');
  fs.copyFileSync(path.join(ROOT, 'js/content.js'), tmp);
  const { PACKS } = await import(tmp + '?' + Date.now());
  const P = Object.fromEntries(PACKS.map((p) => [p.id, p]));
  // deterministic answers: who answers what, with some agreement
  const ans = (p, w, upto = p.items.length) => {
    const o = {};
    p.items.slice(0, upto).forEach((it, i) => {
      const k = 'i' + i;
      if (p.type === 'quiz') o[k] = { m: (i + (w === 'a' ? 0 : 1)) % it.o.length, g: (i + (w === 'a' ? 1 : (i % 3 ? 0 : 2))) % it.o.length };
      else if (p.type === 'pick' || p.type === 'lovelang') o[k] = (i * 7 + (w === 'a' ? 1 : (i % 4 ? 1 : 0))) % 2;
      else if (p.type === 'who') o[k] = (i + (w === 'a' ? 0 : i % 3)) % 2 ? 'a' : 'b';
      else if (p.type === 'nhie') o[k] = (i * 5 + (w === 'a' ? 0 : 1)) % 3 === 0 ? 1 : 0;
      else if (p.type === 'ynm') o[k] = (i * 3 + (w === 'a' ? 1 : 2)) % 3;
      else if (p.type === 'open') o[k] = w === 'a' ? ['Honestly? The way you hum when you cook.', 'Our first road trip, the wrong turn included.', 'Less phone after ten.'][i % 3] : ['When you remember the small stuff.', 'Probably that rainy Sunday in the car.', 'More walks, fewer errands.'][i % 3];
    });
    return o;
  };
  const done = (p, w) => ({ ans: ans(p, w), done: Date.now() - 3600e3 });
  const now = Date.now();
  const a = {
    uid: 'u_a', updated: now,
    daily: { [daysAgo(0)]: 'Finishing the bookshelf. Then actually putting books on it.', [daysAgo(1)]: 'The bakery on 5th, before it gets busy.', [daysAgo(2)]: 'When you laugh at your own jokes before the punchline.' },
    packs: {
      'quiz-basics': done(P['quiz-basics'], 'a'), 'tot-everyday': done(P['tot-everyday'], 'a'), 'nhie-classic': done(P['nhie-classic'], 'a'),
      lovelang: done(P.lovelang, 'a'), 'wyr-silly': done(P['wyr-silly'], 'a'), 'desire-1': done(P['desire-1'], 'a'),
      'talk-closer': { ans: ans(P['talk-closer'], 'a', 2) }, 'quiz-food': { ans: ans(P['quiz-food'], 'a', 3) },
    },
  };
  const b = {
    uid: 'u_b', updated: now,
    daily: { [daysAgo(1)]: 'Coffee in bed. You bring it, obviously.', [daysAgo(2)]: 'Your terrible singing in the shower. Don’t stop.' },
    packs: {
      'quiz-basics': done(P['quiz-basics'], 'b'), 'tot-everyday': done(P['tot-everyday'], 'b'), 'nhie-classic': done(P['nhie-classic'], 'b'),
      lovelang: done(P.lovelang, 'b'), 'who-fun': done(P['who-fun'], 'b'), 'desire-1': done(P['desire-1'], 'b'),
      'quiz-love': { ans: ans(P['quiz-love'], 'b', 4) },
    },
  };
  return {
    'people/a': a, 'people/b': b, 'shared/meta': { since: '2022-03-14' },
    'bucket/k1': { t: 'See the northern lights', done: false, by: 'b', ts: now - 5e5 },
    'bucket/k2': { t: 'Cook the whole Ottolenghi book (well, ten recipes)', done: false, by: 'a', ts: now - 4e5 },
    'bucket/k3': { t: 'Night swim at the lake', done: true, by: 'a', ts: now - 9e6 },
  };
}

async function run(scheme, port, seedDocs) {
  const h = await launch({ port, only: ['example-ttt', 'example-tap'], colorScheme: scheme, seedDocs });
  const { a, b } = h;
  const shot = async (pg, name, opts = {}) => {
    await pg.waitForTimeout(opts.wait ?? 500);
    const file = path.join(OUT, `${scheme}-${name}.png`);
    await pg.screenshot({ path: file, fullPage: !!opts.full });
    console.log('  ', path.basename(file));
  };
  // every main screen at 390, and again at 360
  const both = async (pg, name, opts = {}) => {
    await shot(pg, name, opts);
    await pg.setViewportSize({ width: 360, height: 760 });
    await shot(pg, name + '-360', { ...opts, wait: 300 });
    await pg.setViewportSize({ width: 390, height: 844 });
  };
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.log(`   !! ${name}: ${e.message.split('\n')[0]}`); } };
  const tab = (pg, t) => pg.click(`.tabbar [data-act="tab"][data-tab="${t}"]`);
  const openPack = async (pg, id) => { await pg.evaluate((x) => { const el = document.createElement('button'); el.dataset.act = 'openPack'; el.dataset.id = x; el.hidden = true; document.getElementById('app').appendChild(el); el.click(); }, id); };
  const backToTabs = (pg) => pg.evaluate(() => { const el = document.createElement('button'); el.dataset.act = 'tab'; el.dataset.tab = 'home'; el.hidden = true; document.getElementById('app').appendChild(el); el.click(); });
  try {
    await prepare(h, a); await prepare(h, b);
    console.log(scheme);
    await h.settle(); await h.settle();
    // a game waiting on Emerson, so the front page has its games strip
    await step('game', async () => {
      const id = await h.newOnlineGame(b, 'four');
      const e = await h.engine(b, id);
      if (e.acts[0] === 'b') { await b.click('#game-root .fk button[data-i="4"]'); await h.settle(); }
      await h.closeGame(b); await h.settle(); await tab(b, 'home'); await tab(a, 'home');
      await a.waitForTimeout(2900); // let the "Sydney started…" toast clear
    });

    await step('home', async () => {
      await both(a, 'home');
      await shot(a, 'home-full', { full: true });
      await shot(b, 'home-b');
      await b.evaluate(() => window.scrollTo(0, 400));
      await shot(b, 'home-b-scrolled');
    });
    await step('questions', async () => { await tab(a, 'play'); await both(a, 'questions'); await shot(a, 'questions-full', { full: true }); });
    await step('pack intro', async () => { await openPack(a, 'who-fun'); await both(a, 'pack-intro'); });
    await step('play who', async () => { await a.click('[data-act="startPack"]'); await both(a, 'play-who'); });
    await step('play quiz', async () => {
      await openPack(a, 'quiz-food'); await a.click('[data-act="startPack"]');
      await a.click('.opts:not(.guess) [data-act="quizPick"][data-v="1"]');
      await both(a, 'play-quiz');
    });
    await step('play pick', async () => { await openPack(a, 'tot-travel'); await a.click('[data-act="startPack"]'); await both(a, 'play-pick'); });
    await step('play open', async () => { await openPack(a, 'talk-closer'); await a.click('[data-act="startPack"]'); await shot(a, 'play-open'); });
    await step('results quiz', async () => { await openPack(a, 'quiz-basics'); await both(a, 'results-quiz'); await shot(a, 'results-quiz-full', { full: true }); });
    await step('results pick', async () => { await openPack(a, 'tot-everyday'); await shot(a, 'results-pick'); });
    await step('results nhie', async () => { await openPack(a, 'nhie-classic'); await shot(a, 'results-nhie'); });
    await step('results lovelang', async () => { await openPack(a, 'lovelang'); await shot(a, 'results-lovelang'); });
    await step('locked in', async () => { await openPack(a, 'wyr-silly'); await both(a, 'results-locked'); });
    await step('tod', async () => {
      await backToTabs(a); await tab(a, 'play'); await a.click('[data-act="go"][data-view="tod"]');
      await both(a, 'tod');
      await a.click('[data-act="todDraw"][data-kind="dare"]');
      await both(a, 'tod-card');
    });
    await step('dates', async () => {
      await backToTabs(a); await tab(a, 'play'); await a.click('[data-act="go"][data-view="dates"]');
      await shot(a, 'dates');
      await a.click('[data-act="spin"]'); await a.waitForTimeout(1600);
      await both(a, 'dates-pick');
    });
    await step('history', async () => { await backToTabs(a); await a.click('[data-act="go"][data-view="history"]'); await both(a, 'history'); });
    await step('sync', async () => { await backToTabs(a); await a.click('.pill[data-view="sync"]'); await shot(a, 'sync'); });
    await step('us', async () => { await backToTabs(a); await tab(a, 'us'); await both(a, 'us'); await shot(a, 'us-full', { full: true }); });
    await step('sheet', async () => { await a.click('[data-act="switchMe"]'); await shot(a, 'sheet'); await a.click('.sheet [data-r="0"]'); });
    await step('spicy', async () => {
      await tab(a, 'spicy'); await both(a, 'spicy-gate');
      await a.click('[data-act="openSpicy"]'); await both(a, 'spicy');
      await shot(a, 'spicy-full', { full: true });
      await openPack(a, 'desire-1'); await both(a, 'spicy-results');
      await openPack(a, 'spicyquiz-1'); await shot(a, 'spicy-intro');
      await a.click('[data-act="startPack"]'); await shot(a, 'spicy-play');
      await openPack(a, 'desire-2'); await a.click('[data-act="startPack"]'); await a.click('.ynm .choice.y'); await shot(a, 'spicy-ynm', { wait: 60 });
      await backToTabs(a); await tab(a, 'spicy'); await a.click('[data-act="spicyTod"]');
      await a.click('[data-act="todDraw"][data-kind="truth"]'); await both(a, 'spicy-tod');
    });
    await step('games tab', async () => { await backToTabs(a); await tab(a, 'games'); await shot(a, 'games'); });
    await step('onboarding', async () => {
      const ctx = await h.browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, hasTouch: true });
      const pg = await ctx.newPage();
      await pg.goto(`http://localhost:${port}/`);
      await prepare(h, pg, { waitFor: '.onboard' });
      await pg.waitForTimeout(3200); // let the "sync isn't available" toast clear
      await both(pg, 'onboarding');
      await ctx.close();
    });
  } finally {
    await h.close();
  }
  const errs = h.errors.filter((e) => !/fonts\.g/.test(e));
  if (errs.length) console.log('page errors:\n  ' + errs.join('\n  '));
}

(async () => {
  const seedDocs = await seed();
  const schemes = MODE === 'both' ? ['light', 'dark'] : [MODE];
  let port = 8872;
  for (const s of schemes) await run(s, port++, seedDocs);
  console.log('shots in', OUT);
})();
