// App-level regression tests: question packs, the daily question, sync between devices, the
// identity picker, and the game room's shell (rematch, results, end card, Escape, toast,
// overlay, live presence). Every section is a bug that once shipped.
//   node tools/test/app.test.js            (ports 8940-8947; PORT=… moves the block)
//   node tools/test/app.test.js packs      (one section: layout, packs, devices, cold, identity, room, live, cleanup, lossy)
const fs = require('fs');
const path = require('path');
const { launch } = require('./harness');
const { prepare } = require('./design-preview');

const BASE = Number(process.env.PORT) || 8940;
const SHOTS = process.env.SHOTS || path.join(__dirname, '.cache/app-test');
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

// Fire an app action (data-act) as if a hidden button was tapped.
const press = (pg, act, data = {}) => pg.evaluate(([x, d]) => {
  const el = document.createElement('button'); el.dataset.act = x; Object.assign(el.dataset, d); el.hidden = true;
  document.getElementById('app').appendChild(el); el.click();
}, [act, data]);
const tab = (pg, t) => pg.click(`.tabbar [data-act="tab"][data-tab="${t}"]`);
const text = async (pg, sel = '#app') => ((await pg.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
// Two taps on the same spot, `gap` ms apart (the second lands on whatever is there by then).
const tapTwice = (pg, sel, gap) => pg.evaluate(([s, g]) => new Promise((r) => {
  const el = document.querySelector(s); const box = el.getBoundingClientRect();
  const x = box.left + box.width / 2; const y = box.top + box.height / 2;
  el.click();
  setTimeout(() => { const el2 = document.elementFromPoint(x, y); if (el2) el2.click(); r(); }, g);
}), [sel, gap]);
const closeIfOpen = (pg) => pg.click('#game-root [data-g="close"]', { timeout: 1500 }).catch(() => {});
const answers = (h, w, pack) => ((h.docs[`people/${w}`] || {}).packs || {})[pack]?.ans || {};
const daily = (h, w) => Object.assign({}, ...Object.entries(h.docs).filter(([k]) => k.startsWith(`people/${w}/daily/`)).map(([, v]) => v.d || {}));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Two tiny games, injected into the bundle for the engine tests.
const TEST_GAMES = `
__M['js/games/zz-test.js'] = (() => {
'use strict';
const { registerGame } = __M['js/games/core.js'];
registerGame({
  id: 'zz-manual', title: 'Manual End', kind: 'turns', unlisted: true, endDelay: 'manual', howTo: ['Tap go.'],
  init: ({ first }) => ({ n: 0, t: first }),
  next: (s) => (s.n >= 2 ? [] : [s.t]),
  apply(s, w) { s.n++; s.t = w === 'a' ? 'b' : 'a'; return s; },
  result: () => ({ winner: 'a', text: 'Manual finale' }),
  mount(el, api) {
    el.innerHTML = '<button class="zz-go" style="min-height:60px">go</button><input class="zz-text" aria-label="clue">';
    let ctx = null;
    el.querySelector('.zz-go').addEventListener('click', () => { if (ctx && ctx.canMove) api.move({}); });
    // no finale: ask for the end card straight from update()
    return { update(c) { ctx = c; if (c.over) api.showEnd(); } };
  },
});
registerGame({
  id: 'zz-live', title: 'Live Probe', kind: 'live', unlisted: true, howTo: ['Wait.'],
  mount(el, api) {
    const rec = window.__zz = { calls: [], gen: api.gen };
    el.innerHTML = '<p class="zz-live">probe</p>';
    const off = api.onPartnerState((s) => rec.calls.push(s));
    rec.pub = (o) => api.setPresence(o);
    rec.partner = () => api.partnerState();
    return { destroy() { off(); } };
  },
});
return {};
})();
`;
async function withTestGames(pg) {
  await pg.route(/^http:\/\/localhost:\d+\/$/, async (r) => {
    const res = await r.fetch();
    r.fulfill({ response: res, body: (await res.text()).replace('// ── js/app.js ──', TEST_GAMES + '\n// ── js/app.js ──') });
  });
  await pg.reload();
  await pg.waitForSelector('.tabbar');
}

async function playPack(pg, id, pick = 0) {
  await press(pg, 'openPack', { id });
  await pg.click('[data-act="startPack"]');
  for (let guard = 0; guard < 60 && !(await pg.$('.results, .pack-intro')); guard++) {
    if (await pg.$('.opts')) {
      await pg.click(`.opts:not(.guess) .opt >> nth=${pick}`); await pg.click('.opts.guess .opt >> nth=0'); await pg.waitForTimeout(700);
    } else if (await pg.$('textarea[data-draft^="open-"]')) {
      await pg.fill('textarea[data-draft^="open-"]', `answer ${guard}`); await pg.click('[data-act="saveOpen"]'); await pg.waitForTimeout(420);
    } else { await pg.click(`.choice >> nth=${pick}`); await pg.waitForTimeout(560); }
  }
}

// Every visible control in the page: its tap size, counting a ::after hit area (negative inset).
const TARGETS = () => [...document.querySelectorAll('#app button, #app [role="button"], #app input, #app textarea, #game-root button, .sheet button')]
  .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]'); })
  .map((el) => {
    const r = el.getBoundingClientRect(); const a = getComputedStyle(el, '::after');
    const slop = (k) => (a.content !== 'none' && a.position === 'absolute' ? Math.max(0, -parseFloat(a[k]) || 0) : 0);
    return { w: r.width + slop('left') + slop('right'), h: r.height + slop('top') + slop('bottom'), what: (el.className || el.tagName) + ' ' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24) };
  })
  .filter((t) => t.w < 43.5 || t.h < 43.5);

const SECTIONS = {
  // ── every main screen at 360 px: no sideways scroll, every tap target ≥ 44 px ──
  async layout() {
    const h = await launch({ port: BASE, only: ['example-ttt'], who: ['a'] });
    const a = h.a;
    try {
      await prepare(h, a); // the real hub: all 16 games as stand-ins, with the real fonts
      await a.setViewportSize({ width: 360, height: 760 });
      const check = async (name) => {
        await a.waitForTimeout(250);
        const r = await a.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
        assert(r.sw <= r.w + 1, `${name}: no sideways scroll at 360 (${r.sw}px)`);
        const clipped = await a.evaluate(() => [...document.querySelectorAll('.gh-card-title, .gh-tags, .gh-card-blurb, .pt, .tile span, .row-title, .shelf-title, .gh-shelf-title, .q, .gm-howto li')]
          .filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 30)));
        assert(!clipped.length, `${name}: no clipped text` + (clipped.length ? ' ' + JSON.stringify(clipped) : ''));
        const small = await a.evaluate(TARGETS);
        assert(!small.length, `${name}: every tap target is at least 44 px` + (small.length ? ' ' + JSON.stringify(small.slice(0, 4)) : ''));
      };
      await check('home');
      await tab(a, 'play'); await check('questions');
      await tab(a, 'us'); await check('us');
      await a.fill('[data-draft="bucket"]', 'Something long enough to wrap onto a second line in the list'); await a.click('[data-act="addBucket"]'); await h.settle(); await check('us with a bucket item');
      await tab(a, 'spicy'); await check('spicy gate');
      await a.click('[data-act="openSpicy"]'); await check('spicy');
      await tab(a, 'games'); await check('games');
      await a.evaluate(() => window.__gamesOpenSheet('example-ttt')); await check('game sheet');
      await a.click('[data-g="new"][data-mode="local"]'); await a.waitForSelector('#game-root .gm'); await check('game');
      await a.click('#game-root [data-g="menu"]'); await check('game menu');
      await a.click('#game-root .gm-sheet [data-g="menu"]');
      await h.closeGame(a);
      for (const id of ['quiz-basics', 'tot-everyday', 'who-fun', 'nhie-classic', 'talk-closer', 'lovelang', 'desire-1']) {
        await press(a, 'openPack', { id }); await check(`${id} intro`);
        await a.click('[data-act="startPack"]'); await check(`${id} play`);
      }
      await press(a, 'go', { view: 'tod' }); await check('truth or dare');
      await a.click('[data-act="todDraw"][data-kind="dare"]'); await check('a dare');
      await press(a, 'go', { view: 'dates' }); await check('date spinner');
      await press(a, 'go', { view: 'history' }); await check('past questions');
      await press(a, 'go', { view: 'sync' }); await check('sync');
      h.assertNoErrors();
    } finally { await h.close(); }
  },

  // ── question packs, the daily question, the bucket list, the date ──
  async packs() {
    const h = await launch({ port: BASE, only: [] });
    const { a, b } = h;
    try {
      await press(a, 'openPack', { id: 'tot-everyday' });
      await a.click('[data-act="startPack"]');
      await tapTwice(a, '.choice', 40);
      await a.waitForTimeout(700); await h.settle();
      assert(Object.keys(answers(h, 'a', 'tot-everyday')).length === 1 && await text(a, '.count') === '2/16', 'a double tap on a choice saves one answer and moves on once');
      await tapTwice(a, '.choice', 230); // the second tap lands on the next question as it appears
      await a.waitForTimeout(700); await h.settle();
      assert(Object.keys(answers(h, 'a', 'tot-everyday')).length === 2 && await text(a, '.count') === '3/16', 'a tap that lands on the next question as it appears is ignored');

      // quiz: changing the guess within the beat saves the final pick, once
      await press(a, 'openPack', { id: 'quiz-basics' });
      await a.click('[data-act="startPack"]');
      await a.click('.opts:not(.guess) .opt >> nth=0');
      await a.evaluate(() => new Promise((r) => { document.querySelectorAll('.opts.guess .opt')[1].click(); setTimeout(() => { document.querySelectorAll('.opts.guess .opt')[2].click(); r(); }, 90); }));
      await a.waitForTimeout(800); await h.settle();
      const q = answers(h, 'a', 'quiz-basics');
      assert(Object.keys(q).length === 1 && q.i0 && q.i0.m === 0 && q.i0.g === 2, `a quick change of guess saves the final pick for that question only (${JSON.stringify(q)})`);

      // reload mid-pack comes back to the same question
      const before = await text(a, '.count');
      await a.reload(); await a.waitForSelector('.tabbar, .count');
      await a.waitForTimeout(400);
      assert(await a.$('.count') && await text(a, '.count') === before, `a reload mid-pack returns to the same question (${before})`);

      // pick + open packs end to end on both phones
      await playPack(a, 'who-fun', 0); await playPack(b, 'who-fun', 1); await h.settle();
      await press(a, 'openPack', { id: 'who-fun' });
      assert(/You agreed on \d+\/15/.test(await text(a)), 'who’s-more-likely results show on Emerson’s phone');
      await playPack(a, 'talk-closer'); await playPack(b, 'talk-closer'); await h.settle();
      await press(b, 'openPack', { id: 'talk-closer' });
      assert((await b.$$('.results .bubble')).length === 20, 'written answers show side by side on Sydney’s phone');

      // seen state: a redo by Sydney makes the results new again on Emerson's Home
      await press(a, 'openPack', { id: 'who-fun' }); await a.waitForTimeout(150);
      await tab(a, 'home').catch(() => press(a, 'tab', { tab: 'home' }));
      await press(a, 'tab', { tab: 'home' });
      assert(!/New results/.test(await text(a, '.front')), 'results you’ve seen aren’t listed as new');
      await press(b, 'openPack', { id: 'who-fun' });
      await b.click('[data-act="redoPack"]'); await b.click('.sheet [data-r="1"]');
      await b.waitForSelector('.choice');
      for (let i = 0; i < 15; i++) { await b.click('.choice >> nth=0'); await b.waitForTimeout(560); }
      await h.settle();
      await press(a, 'tab', { tab: 'home' }); await a.waitForTimeout(200);
      assert(/New results/.test(await text(a, '.front')) && /The Classics/.test(await text(a, '.front')), 'after Sydney redoes a pack, Emerson sees “New results” again');

      // daily: the field's value is what's saved (no input event needed), and it stays hidden
      const key = today();
      await a.evaluate(() => { document.querySelector('textarea[data-draft^="daily-"]').value = 'typed by autocorrect'; });
      await a.click('[data-act="saveDaily"]'); await h.settle();
      assert(daily(h, 'a')[key] === 'typed by autocorrect', 'the daily answer saves what is in the field');
      await press(b, 'tab', { tab: 'home' }); await h.settle();
      assert(!(await b.content()).includes('typed by autocorrect'), 'Emerson’s answer is not in Sydney’s page before she answers');
      await b.fill('textarea[data-draft^="daily-"]', 'Sydney’s answer'); await b.click('[data-act="saveDaily"]'); await h.settle();
      assert(/typed by autocorrect/.test(await text(b, '.daily')) && /Sydney’s answer/.test(await text(a, '.daily')), 'once both answered, both answers show on both phones');
      assert(/1\s*day streak/i.test(await text(a, '.ticker')), 'the streak counts today');
      assert(Object.keys(h.docs).some((k) => k.startsWith('people/a/daily/')) && !((h.docs['people/a'] || {}).daily || {})[key], 'daily answers live in monthly docs, not the person doc');

      // anniversary: set, clear (reaches the partner), and no future dates
      await press(a, 'tab', { tab: 'us' }); await press(b, 'tab', { tab: 'us' });
      await a.fill('input[type="date"]', '2021-05-04'); await a.dispatchEvent('input[type="date"]', 'change'); await h.settle();
      assert(await b.inputValue('input[type="date"]') === '2021-05-04', 'the start date reaches the partner');
      await a.fill('input[type="date"]', ''); await a.dispatchEvent('input[type="date"]', 'change'); await h.settle();
      assert(await b.inputValue('input[type="date"]') === '', 'clearing the start date reaches the partner');
      await a.fill('input[type="date"]', '2999-01-01'); await a.dispatchEvent('input[type="date"]', 'change'); await h.settle();
      assert(!(h.docs['shared/meta'] || {}).since && await a.inputValue('input[type="date"]') === '', 'a date in the future is refused');

      // bucket list on both phones
      await a.fill('[data-draft="bucket"]', 'Go to Japan'); await a.press('[data-draft="bucket"]', 'Enter'); await h.settle();
      assert(/Go to Japan/.test(await text(b, '.bucket')), 'a bucket list item reaches the partner');
      await b.click('.bucket li >> nth=0 >> [data-act="toggleBucket"]'); await h.settle();
      assert(await a.$('.bucket li.done'), 'checking it off reaches the partner');
      for (let i = 0; i < 5; i++) await b.click('.bucket li >> nth=0 >> [data-act="toggleBucket"]');
      await h.settle(); await h.settle();
      const doneB = !!(await b.$('.bucket li.done')); const doneA = !!(await a.$('.bucket li.done'));
      assert(!doneB && !doneA, `five quick toggles settle the same on both phones (not done) b=${doneB} a=${doneA} server=${JSON.stringify(Object.entries(h.docs).filter(([k]) => k.startsWith('bucket/')).map(([, v]) => v))}`);
      await a.click('.bucket li >> nth=0 >> [data-act="delBucket"]'); await a.click('.sheet [data-r="1"]'); await h.settle();
      assert(!(await b.$('.bucket li')), 'removing it reaches the partner');
      h.assertNoErrors();
    } finally { await h.close(); }
  },

  // ── one person, two devices, writing at the same moment ──
  async devices() {
    const h = await launch({ port: BASE + 1, only: [], who: ['a'], latency: 150 });
    try {
      const a = h.a; const a2 = await h.device('a');
      await a.fill('textarea[data-draft^="daily-"]', 'from the phone');
      await press(a2, 'openPack', { id: 'tot-everyday' }); await a2.click('[data-act="startPack"]');
      await a2.click('.choice >> nth=0'); await a2.waitForTimeout(150); await a.click('[data-act="saveDaily"]');
      await h.settle(); await h.settle(); await h.settle();
      assert(daily(h, 'a')[today()] === 'from the phone' && answers(h, 'a', 'tot-everyday').i0 === 0, 'two devices of one person answering at once both keep their answers');
      await h.settle();
      const s1 = await a.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('jt.state.v1')).people.a.packs || {}));
      assert(/tot-everyday/.test(s1), 'the other device’s answer shows up on the phone');
      assert(await a.evaluate(() => window.__dbStats.subs()) <= 12, 'the app keeps a handful of db subscriptions (cap is 64)');
      h.assertNoErrors();
    } finally { await h.close(); }
  },

  // ── a stale device reopens on a cold cache ──
  async cold() {
    const h = await launch({ port: BASE + 2, only: [], who: ['a'], coldCache: true });
    try {
      const a = h.a; const a2 = await h.device('a');
      await a2.waitForTimeout(800);
      await press(a2, 'openPack', { id: 'tot-everyday' }); await a2.click('[data-act="startPack"]'); await a2.click('.choice >> nth=0');
      await h.settle(); await h.settle();
      await a2.goto('about:blank'); // the laptop is closed…
      await a.fill('textarea[data-draft^="daily-"]', 'phone answer'); await a.click('[data-act="saveDaily"]');
      await press(a, 'openPack', { id: 'tot-travel' }); await a.click('[data-act="startPack"]'); await a.click('.choice >> nth=1');
      await h.settle(); await h.settle();
      await a.goto('about:blank'); // …and so is the phone
      await a2.goto(`http://localhost:${BASE + 2}/`); await a2.waitForSelector('.tabbar'); await a2.waitForTimeout(1500); await h.settle();
      assert(daily(h, 'a')[today()] === 'phone answer' && answers(h, 'a', 'tot-travel').i0 === 1, 'a stale device opening on a cold cache doesn’t wipe newer answers');
      assert(/phone answer/.test(await text(a2, '.daily')), 'and it catches up with them');
      h.assertNoErrors();
    } finally { await h.close(); }
  },

  // ── who's who: new devices, other accounts, switching ──
  async identity() {
    const h = await launch({ port: BASE + 3, only: [] });
    try {
      await h.settle(); await h.settle();
      assert(((h.docs['people/a'] || {}).uids || {}).u_a && ((h.docs['people/b'] || {}).uids || {}).u_b, 'each device claims its person for its Claude account');
      const a3 = await h.device('a', { identified: false });
      await a3.waitForSelector('.tabbar', { timeout: 8000 });
      assert(await a3.evaluate(() => localStorage.getItem('jt.me')) === 'a', 'a new device on Emerson’s account knows it’s Emerson');
      const c = await h.device('c', { identified: false, uid: 'u_c' });
      await c.waitForSelector('[data-act="pickMe"]');
      assert(/set up on another account/.test(await text(c)) && !(await c.$('[data-act="pickMe"][disabled]')), 'a second account sees who’s set up, but isn’t locked out');
      await c.click('[data-act="pickMe"][data-who="b"]');
      await c.waitForSelector('.sheet');
      await c.click('.sheet [data-r="1"]');
      await c.waitForSelector('.tabbar'); await h.settle();
      assert(((h.docs['people/b'] || {}).uids || {}).u_c && ((h.docs['people/b'] || {}).uids || {}).u_b, 'Sydney on a second account: both accounts know her');
      // switching person gives the old name back
      await press(c, 'switchMe'); await c.click('.sheet [data-r="1"]'); await h.settle();
      assert(!((h.docs['people/b'] || {}).uids || {}).u_c && ((h.docs['people/a'] || {}).uids || {}).u_c, 'switching person moves this account’s claim');
      await press(c, 'switchMe'); await c.click('.sheet [data-r="1"]'); await h.settle();
      // Escape closes the confirm sheet
      await press(h.a, 'switchMe'); await h.a.waitForSelector('.sheet');
      await h.a.keyboard.press('Escape');
      assert(!(await h.a.$('.sheet')) && await h.a.evaluate(() => localStorage.getItem('jt.me')) === 'a', 'Escape cancels a confirm sheet');
      h.assertNoErrors();
    } finally { await h.close(); }
  },

  // ── the game room shell ──
  async room() {
    const h = await launch({ port: BASE + 4, only: ['example-ttt', 'example-tap'] });
    const { a, b } = h;
    const pageOf = { a, b };
    try {
      await withTestGames(a); await withTestGames(b);
      const id = await h.newOnlineGame(a, 'example-ttt');
      await h.openMatch(b, id);
      for (const sq of [0, 1, 3, 4, 6]) { const e = await h.engine(a, id); await pageOf[e.acts[0]].click(`.ttt button[data-i="${sq}"]`); await h.settle(); }
      await h.wait(1300);
      await Promise.all([a.click('#game-root [data-g="rematch"]'), b.click('#game-root [data-g="rematch"]')]);
      await h.settle(); await h.settle();
      const inA = await a.evaluate(() => window.__lastMatchId); const inB = await b.evaluate(() => window.__lastMatchId);
      assert(h.matches().length === 2 && inA === inB && inA !== id, `both pressing Rematch at once lands both in one new match (${h.matches().length} matches)`);
      const res1 = JSON.stringify(h.results());
      await b.reload(); await b.waitForSelector('.tabbar'); await withTestGames(b); await h.settle(); await h.settle();
      assert(JSON.stringify(h.results()) === res1, 'a reload doesn’t rewrite recorded results');

      // A game that ends while you aren't looking waits for you under "Results in"
      await closeIfOpen(a); await closeIfOpen(b);
      const fid = await h.newOnlineGame(a, 'example-ttt');
      await h.openMatch(b, fid);
      const seq = [0, 1, 3, 4, 6];
      for (let i = 0; i < 4; i++) { const e = await h.engine(a, fid); await pageOf[e.acts[0]].click(`.ttt button[data-i="${seq[i]}"]`); await h.settle(); }
      const last = (await h.engine(a, fid)).acts[0];
      const away = last === 'a' ? b : a;
      await h.closeGame(away);
      await pageOf[last].click('.ttt button[data-i="6"]'); await h.settle(); await h.settle();
      await h.openGames(away);
      assert(await away.isVisible(`.gh-sec-done [data-g="open"][data-id="${fid}"]`), 'a game that ended while you were away is listed under “Results in”');
      assert(/1|2/.test(await text(away, '.tab-badge')), 'and counts on the Games tab badge');
      await away.click(`.gh-sec-done [data-g="open"][data-id="${fid}"]`);
      const t0 = Date.now();
      await away.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 3000 });
      assert(Date.now() - t0 < 1200, 'opening it shows the result promptly');
      // look at the board, then come back to the result
      await away.click('#game-root [data-g="end-look"]');
      assert(await away.isVisible('#game-root .gm-status [data-g="end-show"]'), 'after “See the board” the status line offers the result again');
      await away.click('#game-root [data-g="end-show"]');
      assert(await away.isVisible('#game-root .gm-end [data-g="rematch"]'), 'and it brings the end card back');
      await h.closeGame(away);
      await h.openGames(away);
      assert(!(await away.$(`.gh-sec-done [data-id="${fid}"]`)), 'once seen, it leaves the list');
      await h.closeGame(pageOf[last]).catch(() => {});

      // ending a same-phone game records nothing
      const nRes = h.results().length;
      await h.newLocalGame(a, 'example-ttt');
      await a.click('.ttt button[data-i="0"]');
      await a.click('#game-root [data-g="menu"]'); await a.click('#game-root [data-g="resign"]');
      // Escape peels the confirm sheet first, then the menu; the game stays
      await a.waitForSelector('.sheet'); await a.keyboard.press('Escape');
      assert(!(await a.$('.sheet')) && await a.isVisible('#game-root .gm-sheet'), 'Escape closes the confirm sheet, not the game');
      await a.keyboard.press('Escape');
      assert(!(await a.isVisible('#game-root .gm-sheet')) && await a.isVisible('#game-root .gm'), 'a second Escape closes the menu');
      await a.click('#game-root [data-g="menu"]'); await a.click('#game-root [data-g="resign"]'); await a.click('.sheet [data-r="1"]');
      await h.settle();
      assert(h.results().length === nRes, 'ending a same-phone game doesn’t count as anyone’s win');

      // the toast: never takes a tap, fits its words, sits on the status line in a game
      await h.newLocalGame(a, 'example-ttt');
      await a.click('.ttt button[data-i="4"]');
      await a.evaluate(() => { const x = document.querySelector('.ttt button[data-i="4"]'); x.disabled = false; x.click(); });
      await a.waitForSelector('.toast.show'); await a.waitForTimeout(350); // let it slide in
      const tr = await a.evaluate(() => {
        const t = document.querySelector('.toast'); const r = t.getBoundingClientRect(); const st = document.querySelector('#game-root .gm-status').getBoundingClientRect();
        const board = document.querySelector('.ttt').getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, h: r.height, statusTop: st.top, boardMid: board.top + board.height / 2, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== t };
      });
      assert(tr.hit, 'a toast never intercepts taps');
      assert(Math.abs(tr.top - tr.statusTop) < 12 && tr.bottom < tr.boardMid && tr.h < 50, `in a game the toast sits on the status line, clear of the board (${JSON.stringify(tr)})`);
      await h.closeGame(a);
      await h.openGames(a);
      await a.evaluate(() => window.scrollTo(0, 300));
      const y0 = await a.evaluate(() => window.scrollY);
      await a.evaluate(() => window.__gamesOpenSheet('example-ttt'));
      await a.click('[data-g="new"][data-game="example-ttt"][data-mode="local"]');
      await a.waitForSelector('#game-root .gm');
      const pinned = await a.evaluate(() => getComputedStyle(document.body).position === 'fixed' && document.body.classList.contains('gm-pinned'));
      await h.closeGame(a);
      const y1 = await a.evaluate(() => window.scrollY);
      assert(y0 > 40 && pinned && Math.abs(y1 - y0) < 2, `the page behind a game is pinned, and keeps its place after (${y0} -> ${y1})`);

      // endDelay 'manual' + api.showEnd() from update(): the card shows right away, not after 8 s
      const mid = await h.newOnlineGame(a, 'zz-manual');
      await h.openMatch(b, mid);
      // Escape while typing in a game's text box leaves the box, not the game
      await a.click('.zz-text'); await a.keyboard.type('hint'); await a.keyboard.press('Escape');
      assert(await a.isVisible('#game-root .gm') && !(await a.evaluate(() => document.activeElement.matches('.zz-text'))), 'Escape in a game’s text box blurs it and keeps the game open');
      for (let i = 0; i < 2; i++) { const e = await h.engine(a, mid); await pageOf[e.acts[0]].click('.zz-go'); await h.settle(); }
      await a.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 2500 });
      await b.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 2500 });
      assert(true, 'api.showEnd() called from update() shows the end card at once (endDelay: manual)');
      await h.closeGame(a); await h.closeGame(b);

      // the partner deletes a game you have open
      const did = await h.newOnlineGame(a, 'example-ttt');
      await h.openMatch(b, did);
      await a.click('#game-root [data-g="menu"]'); await a.click('#game-root [data-g="resign"]'); await a.click('.sheet [data-r="1"]');
      await h.settle(); await h.settle();
      assert(!(await b.isVisible('#game-root .gm')) && !h.matches().some((m) => m.id === did), 'a resigned game closes on the partner’s phone');
      assert(h.results().some((r) => r.winner === 'b' && r.mode === 'online'), 'resigning online counts as a loss');
      h.assertNoErrors();
    } catch (e) { await a.screenshot({ path: path.join(SHOTS, 'room-a.png') }).catch(() => {}); await b.screenshot({ path: path.join(SHOTS, 'room-b.png') }).catch(() => {}); throw e; } finally { await h.close(); }
  },

  // ── live presence: only real partner changes, only this round ──
  async live() {
    const h = await launch({ port: BASE + 5, only: ['example-tap'] });
    const { a, b } = h;
    try {
      await withTestGames(a); await withTestGames(b);
      await h.startLive(a, 'zz-live'); await h.settle();
      await b.click('#gm-invite [data-g="invite-yes"]');
      await a.waitForFunction(() => window.__zz); await b.waitForFunction(() => window.__zz);
      await h.settle(); await h.settle();
      await a.evaluate(() => { window.__zz.calls.length = 0; for (let i = 0; i < 5; i++) window.__zz.pub({ mine: i }); });
      await h.settle();
      assert(await a.evaluate(() => window.__zz.calls.length) === 0, 'my own presence updates don’t call onPartnerState');
      await b.evaluate(() => window.__zz.pub({ round: 0 }));
      await h.settle();
      assert(await a.evaluate(() => window.__zz.calls.length) === 1 && await a.evaluate(() => window.__zz.partner().round) === 0, 'the partner’s update arrives once');
      await a.evaluate(() => { window.__zz.pub({ x: 1 }); window.__zz.pub({ x: 2 }); });
      await h.settle();
      assert(await b.evaluate(() => window.__zz.calls.filter((c) => c.x !== undefined).length) <= 2, 'presence is coalesced, no duplicate calls');
      // rematch: the old round's state must not leak into the new one
      await a.evaluate(() => { document.querySelector('#game-root .gm-end')?.removeAttribute('hidden'); });
      await a.evaluate(() => window.__gamesDebug && 0);
      await a.evaluate(() => { const g = document.createElement('button'); g.dataset.g = 'rematch'; g.hidden = true; document.getElementById('game-root').appendChild(g); g.click(); });
      await h.settle(); await h.settle();
      assert(await a.evaluate(() => window.__zz.gen) === 1 && await b.evaluate(() => window.__zz.gen) === 1, 'a rematch bumps api.gen on both phones');
      assert(await a.evaluate(() => window.__zz.partner()) === null && await a.evaluate(() => window.__zz.calls.length) === 0, 'last round’s partner state is gone after a rematch');
      await b.evaluate(() => window.__zz.pub({ round: 1 }));
      await h.settle();
      assert(await a.evaluate(() => window.__zz.partner() && window.__zz.partner().round) === 1, 'this round’s partner state arrives');
      // same device status reads right on a computer
      h.assertNoErrors();
    } finally { await h.close(); }
  },

  // ── old finished matches are cleaned up; results are not rewritten on load ──
  async cleanup() {
    const seed = {};
    const now = Date.now();
    for (let k = 0; k < 30; k++) {
      const id = `seed${String(k).padStart(8, '0')}`;
      seed[`matches/${id}`] = { game: 'example-ttt', first: 'a', seed: k + 1, by: 'a', created: now - (30 - k) * 60000, opts: {}, a: JSON.stringify([{ i: 0 }, { i: 3 }, { i: 6 }]), b: JSON.stringify([{ i: 1 }, { i: 4 }]), ua: 0, ub: 0 };
      seed[`results/${id}`] = { game: 'example-ttt', winner: 'a', score: null, at: 1000 + k, mode: 'online' };
    }
    const h = await launch({ port: BASE + 6, only: ['example-ttt'], seedDocs: seed });
    try {
      await h.wait(5500); // cleanup deletes gently, one at a time
      await h.settle();
      assert(h.matches().length === 25, `only the newest 25 finished matches are kept (${h.matches().length})`);
      assert(h.results().length === 30 && h.results().every((r) => r.at < 2000), 'results are kept and never rewritten');
      await h.openGames(h.a);
      assert(/30/.test(await text(h.a, '.gh-score')), 'the head-to-head counts every result');
      h.assertNoErrors();
    } finally { await h.close(); }
  },

  // ── a bad connection: 300 ms latency, 30% of room events lost ──
  async lossy() {
    const h = await launch({ port: BASE + 7, only: ['example-ttt'], latency: 300, dropRate: 0.3 });
    const { a, b } = h;
    const pageOf = { a, b };
    try {
      const id = await h.newOnlineGame(a, 'example-ttt');
      await h.openMatch(b, id);
      for (const sq of [0, 1, 3, 4, 6]) {
        const e = await h.engine(a, id);
        const pg = pageOf[e.acts[0]];
        await pg.waitForSelector(`.ttt button[data-i="${sq}"]:not([disabled])`, { timeout: 8000 });
        await pg.click(`.ttt button[data-i="${sq}"]`);
        await h.settle(); await h.settle();
      }
      await h.wait(1500);
      const ea = await h.engine(a, id); const eb = await h.engine(b, id);
      assert(ea.over && eb.over && ea.result.winner === eb.result.winner, 'a turn game finishes the same on both phones over a bad connection');
      await h.closeGame(a).catch(() => {}); await h.closeGame(b).catch(() => {});
      await playPack(a, 'tot-dates', 0); await playPack(b, 'tot-dates', 1); await h.settle(); await h.settle();
      await press(a, 'openPack', { id: 'tot-dates' });
      assert(/in sync/.test(await text(a)), 'a pack finishes and shows results over a bad connection');
      h.assertNoErrors();
    } finally { await h.close(); }
  },
};

(async () => {
  const only = process.argv[2];
  const names = only ? [only] : Object.keys(SECTIONS);
  for (const n of names) {
    console.log(`\n# ${n}`);
    try { await SECTIONS[n](); } catch (e) { console.error(e.message); process.exitCode = 1; }
  }
  console.log(process.exitCode ? '\nSOME FAILED' : '\nALL GOOD');
})();
