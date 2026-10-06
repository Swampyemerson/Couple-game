// Design preview: walks two phones (and a laptop) through every game-room state and saves
// screenshots, so the chrome can be judged by eye in light and dark.
//
//   node tools/test/design-preview.js [light|dark|both] [outDir]
//
// The 16 hub games are registered as stand-ins (real titles, metadata and covers; a simple
// 3×3 board, a live tap game, an immersive "3D" scene) so the hub, sheets, rows, end cards,
// curtain, invite and immersive chrome can all be reached deterministically, whatever state
// the real games are in. Google Fonts are fetched once with curl and served from a cache.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { launch } = require('./harness');

const MODE = process.argv[2] || 'both';
const OUT = path.resolve(process.argv[3] || process.env.SHOTS || path.join(__dirname, '.cache/design'));
const FONT_CACHE = path.join(__dirname, '.cache/fonts');
if (require.main === module) fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(FONT_CACHE, { recursive: true });

// ── fonts (the harness blocks Google Fonts; serve them from a local cache instead) ──
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
function cached(url) {
  const f = path.join(FONT_CACHE, crypto.createHash('md5').update(url).digest('hex'));
  if (!fs.existsSync(f)) fs.writeFileSync(f, execFileSync('curl', ['-sS', '-m', '30', '-A', UA, url], { maxBuffer: 1 << 26 }));
  return fs.readFileSync(f);
}

// ── stand-in games, injected into the bundle before app.js ──
const FAKES = [
  ['rush', 'Rail Rush', 'Race the same rails. Shove, dodge, throw ink.', 'live', { tags: ['silly', '3d'], minutes: 4, best: 'phone', immersive: true }],
  ['chameleon', 'Chameleon', 'Paint yourself into the room. Or find who did.', 'live', { tags: ['silly', '3d'], minutes: 8, immersive: true }],
  ['four', 'Four in a Row', 'Drop discs. Line up four.', 'turns', { tags: ['brainy', 'quick'], minutes: 5 }],
  ['bones', 'Knucklebones', 'Roll, place, crush their dice.', 'turns', { tags: ['quick', '3d'], minutes: 6 }],
  ['dots', 'Dots & Boxes', 'Close a box, go again.', 'turns', { tags: ['brainy'], minutes: 8 }],
  ['doodle', 'Doodle', 'Draw it badly. Guess it anyway.', 'turns', { tags: ['silly'], minutes: 8, best: 'phone' }],
  ['ultimate', 'Ultimate Tic-Tac-Toe', 'Nine boards. Every move sends them somewhere.', 'turns', { tags: ['brainy'], minutes: 12 }],
  ['fleet', 'Battleships', 'Hide your fleet. Sink theirs.', 'turns', { tags: ['brainy'], minutes: 12, secret: true }],
  ['wordduel', 'Word Duel', 'Same five letters. Who cracks it first?', 'turns', { tags: ['brainy'], minutes: 6 }],
  ['agents', 'Double Agents', 'One-word clues. Twenty-five cards. No assassins.', 'turns', { tags: ['brainy'], minutes: 15, team: true }],
  ['wave', 'Same Wave', 'One clue, one dial. Are you on the same wave?', 'turns', { tags: ['silly'], minutes: 10, team: true }],
  ['tower', 'Tower Together', 'Stack it high. Don’t be the one who drops it.', 'live', { tags: ['silly', '3d'], minutes: 6, team: true }],
  ['hockey', 'Air Hockey', 'Flick it, block it, score it.', 'live', { tags: ['silly'], minutes: 3, best: 'phone' }],
  ['quickdraw', 'Quick Draw', 'Wait for it. Wait for it. Draw.', 'live', { tags: ['silly', 'quick'], minutes: 2 }],
  ['cycles', 'Light Cycles', 'Leave a wall behind you. Don’t hit one.', 'live', { tags: ['quick'], minutes: 3, best: 'computer' }],
  ['defuse', 'Defuse', 'One of you has the bomb. The other has the manual.', 'live', { tags: ['brainy'], minutes: 10, team: true, platforms: ['computer'] }],
];
const INJECT = `
// ── design-preview stand-ins ──
__M['js/games/zz-preview.js'] = (() => {
'use strict';
const { registerGame, gameById } = __M['js/games/core.js'];
const FAKES = ${JSON.stringify(FAKES)};
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const win = (b) => { for (const l of LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return l; return null; };
const css = \`
  .fk { margin: auto; width: min(100%, 340px); padding: 14px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .fk button { aspect-ratio: 1; border-radius: 12px; border: 2px solid var(--g-ink); background: var(--g-bg); display: grid; place-items: center; }
  .fk button i { width: 64%; height: 64%; border-radius: 50%; border: 2.5px solid var(--g-ink); box-shadow: 2px 3px 0 var(--g-edge); }
  .fk button.a i { background: var(--p-a); } .fk button.b i { background: var(--p-b); }
  .fk button.win { background: var(--g-hl); }
  .fk-live { flex: 1; display: grid; gap: 12px; padding: 12px 0; }
  .fk-live .g-panel { display: grid; place-items: center; gap: 10px; padding: 16px; }
  .fk-scene { position: absolute; inset: 0; background: linear-gradient(#7ec8f0 0 46%, #f7d9a8 46% 100%); overflow: hidden; }
  .fk-scene::before { content: ''; position: absolute; left: 50%; top: 46%; width: 140%; height: 70%; transform: translateX(-50%) perspective(300px) rotateX(55deg); background: repeating-linear-gradient(90deg, #333 0 6px, transparent 6px 33%), #c9c2b4; }
  .fk-scene::after { content: ''; position: absolute; left: 12%; top: 18%; width: 30%; height: 26%; background: #ff6fb5; box-shadow: 160px 20px 0 #2d5bd0, 60px -40px 0 #ffffff; }
  .fk-hud { position: absolute; left: 0; right: 0; top: calc(14px + env(safe-area-inset-top, 0px)); display: flex; justify-content: center; gap: 8px; }
\`;
for (const [id, title, blurb, kind, extra] of FAKES) {
  if (gameById(id)) continue;
  const howTo = kind === 'turns' ? ['Tap a square to place your piece.', 'Three in a row wins the round.', 'Stand-in rules for the design preview.'] : ['Both phones, real time.', 'First to the finish wins.'];
  const base = { id, title, blurb, kind, howTo, platforms: ['phone', 'computer'], ...extra, css: id === 'four' ? css : '' };
  if (kind === 'turns') {
    registerGame({ ...base,
      init: ({ first }) => ({ b: Array(9).fill(null), t: first }),
      next: (s) => (win(s.b) || s.b.every(Boolean) ? [] : [s.t]),
      apply(s, w, m) { if (s.b[m.i]) throw new Error('That square is taken'); s.b[m.i] = w; s.t = w === 'a' ? 'b' : 'a'; return s; },
      result(s) { const l = win(s.b); if (extra.team) return { winner: null, team: true, score: l ? 7 : 3, text: l ? 'Seven out of nine. Nice.' : '' }; return l ? { winner: s.b[l[0]], sub: 'Three in a row, straight down the middle.' } : { winner: null }; },
      score(s) { return extra.team ? null : { a: s.b.filter((x) => x === 'a').length, b: s.b.filter((x) => x === 'b').length }; },
      endDelay: 300,
      mount(el, api) {
        el.innerHTML = '<div class="fk"></div>';
        const g = el.querySelector('.fk'); let ctx = null;
        g.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || !ctx || !ctx.canMove) return; const r = api.move({ i: +b.dataset.i }); if (!r.ok) api.toast(r.error); });
        return { update(c) { ctx = c; const l = win(c.state.b); g.innerHTML = c.state.b.map((v, i) => '<button data-i="' + i + '" class="' + (v || '') + (l && l.includes(i) ? ' win' : '') + '"' + (v || !c.canMove ? ' disabled' : '') + '>' + (v ? '<i></i>' : '') + '</button>').join(''); } };
      },
    });
  } else {
    registerGame({ ...base,
      mount(el, api) {
        if (extra.immersive) el.innerHTML = '<div class="fk-scene"></div><div class="fk-hud"><span class="g-chip is-a">' + api.name('a') + ' 2</span><span class="g-chip is-b">' + api.name('b') + ' 3</span></div><button class="gm-btn fk-finish" style="position:absolute;left:50%;bottom:40px;transform:translateX(-50%)">Finish</button>';
        else el.innerHTML = '<div class="fk-live"><div class="g-panel is-a"><span class="g-label">Live stand-in</span><span class="g-num is-a">12</span><button class="gm-btn fk-finish">Finish</button></div><div class="g-panel"><div style="display:flex;gap:5px;width:100%">' + 'QWERTYUIOP'.split('').map((k, i) => '<span class="g-key' + (i === 2 ? ' is-a' : i === 5 ? ' is-hl' : i === 7 ? ' is-out' : '') + '">' + k + '</span>').join('') + '</div></div></div>';
        el.querySelector('.fk-finish').addEventListener('click', () => api.finish(extra.team ? { winner: null, team: true, score: 42 } : { winner: api.me || 'b', sub: 'By a whisker.' }));
        api.setScore(extra.team || extra.immersive ? null : { a: 2, b: 3 });
        return { destroy() {} };
      },
    });
  }
}
return {};
})();
`;

async function prepare(h, pg, { phone = true, waitFor = '.tabbar' } = {}) {
  // headless Chromium doesn't report (pointer: coarse) for emulated phones; real phones do
  if (phone) await pg.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/pointer:\s*coarse/.test(q) ? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } } : mm(q)); });
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, (r) => {
    const u = r.request().url();
    try { r.fulfill({ body: cached(u), contentType: /googleapis/.test(u) ? 'text/css' : 'font/woff2', headers: { 'access-control-allow-origin': '*' } }); } catch { r.abort(); }
  });
  await pg.route(/^http:\/\/localhost:\d+\/$/, async (r) => {
    const res = await r.fetch();
    let body = await res.text();
    body = body.replace("// ── js/app.js ──", INJECT + "\n// ── js/app.js ──");
    r.fulfill({ response: res, body });
  });
  await pg.reload();
  await pg.waitForSelector(waitFor, { timeout: 15000 });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(400);
}

async function run(scheme, port) {
  const h = await launch({ port, only: ['example-ttt', 'example-tap'], colorScheme: scheme });
  const { a, b } = h;
  const shot = async (pg, name, opts = {}) => {
    const file = path.join(OUT, `${scheme}-${name}.png`);
    await pg.waitForTimeout(opts.wait ?? 700);
    await pg.screenshot({ path: file, fullPage: !!opts.full });
    console.log('  ', path.basename(file));
  };
  const narrow = async (pg, fn) => { await pg.setViewportSize({ width: 360, height: 760 }); try { await fn(); } finally { await pg.setViewportSize({ width: 390, height: 844 }); } };
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.log(`   !! ${name}: ${e.message.split('\n')[0]}`); } };
  const turn = async (id, sq) => { const e = await h.engine(a, id); const pg = e.acts[0] === 'a' ? a : b; await pg.click(`#game-root .fk button[data-i="${sq}"]`); await h.settle(); };
  try {
    await prepare(h, a); await prepare(h, b);
    console.log(scheme);

    await step('hub empty', async () => {
      await h.openGames(a);
      await shot(a, 'hub-top');
      await shot(a, 'hub-full', { full: true });
      await narrow(a, () => shot(a, 'hub-top-360'));
    });

    // online match: a few moves, both sides
    let id = null;
    await step('online game', async () => {
      id = await h.newOnlineGame(a, 'four');
      await h.settle();
      await h.openMatch(b, id);
      const e = await h.engine(a, id);
      await shot(e.acts[0] === 'a' ? a : b, 'game-yourturn');
      await shot(e.acts[0] === 'a' ? b : a, 'game-waiting');
      await turn(id, 4); await turn(id, 0);
      await shot(a, 'game-midgame');
      await narrow(a, () => shot(a, 'game-midgame-360'));
    });
    await step('menu', async () => {
      await a.click('#game-root [data-g="menu"]');
      await shot(a, 'game-menu');
      await a.click('#game-root .gm-sheet [data-g="menu"]');
    });
    await step('finish', async () => {
      await turn(id, 1); await turn(id, 2); await turn(id, 7);
      await a.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 4000 });
      await shot(a, 'end-online-a', { wait: 1100 });
      await shot(b, 'end-online-b', { wait: 300 });
      await narrow(b, () => shot(b, 'end-online-360', { wait: 200 }));
      await a.click('#game-root .gm-end [data-g="end-look"]');
      await shot(a, 'end-look');
      await h.closeGame(a); await h.closeGame(b);
    });

    // hub with rows: one waiting on each side + a same-phone game
    await step('hub rows', async () => {
      const id2 = await h.newOnlineGame(a, 'dots'); await h.closeGame(a);
      const id3 = await h.newOnlineGame(b, 'ultimate'); await h.closeGame(b);
      for (const m of [id2, id3]) { const e = await h.engine(a, m); if (e.acts[0] === 'a') { await h.openMatch(a, m); await a.click('#game-root .fk button[data-i="4"]'); await h.settle(); await h.closeGame(a); } }
      await h.newLocalGame(a, 'bones'); await h.closeGame(a);
      await h.settle();
      await h.openGames(a);
      await shot(a, 'hub-rows');
      await shot(a, 'hub-rows-full', { full: true });
      await a.click('[data-g="filter"][data-f="computer"]');
      await shot(a, 'hub-filter-computer');
      await a.click('[data-g="filter"][data-f="all"]');
      await b.click('[data-act="tab"][data-tab="home"]');
      await b.evaluate(() => document.querySelector('.gh-home')?.scrollIntoView({ block: 'center' }));
      await shot(b, 'home-rows');
      await h.openGames(b);
      await shot(b, 'hub-yourmove');
    });

    // sheets
    await step('sheets', async () => {
      await h.openSheet(a, 'four'); await shot(a, 'sheet-four'); await a.click('#game-root .gs-close');
      await h.openSheet(a, 'defuse'); await shot(a, 'sheet-defuse-blocked'); await a.click('#game-root .gs-close');
      await h.openSheet(a, 'cycles'); await shot(a, 'sheet-cycles-best'); await a.click('#game-root .gs-close');
      await h.openSheet(a, 'rush'); await shot(a, 'sheet-rush'); await a.click('#game-root .gs-close');
    });

    // same phone: secret game shows the curtain; draw; team end
    await step('curtain', async () => {
      await h.newLocalGame(a, 'fleet');
      await shot(a, 'curtain');
      await narrow(a, () => shot(a, 'curtain-360'));
      await a.click('#game-root [data-g="reveal"]');
      for (const sq of [0, 1, 2, 4, 3, 5, 7, 6, 8]) {
        if (await a.isVisible('#game-root [data-g="reveal"]')) await a.click('#game-root [data-g="reveal"]');
        await a.click(`#game-root .fk button[data-i="${sq}"]`); await a.waitForTimeout(80);
      }
      await a.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 4000 });
      await shot(a, 'end-draw', { wait: 900 });
      await h.closeGame(a);
    });
    await step('team end', async () => {
      await h.newLocalGame(a, 'wave');
      await shot(a, 'game-team');
      for (const sq of [0, 1, 4, 2, 8]) { await a.click(`#game-root .fk button[data-i="${sq}"]`); await a.waitForTimeout(80); }
      await a.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 4000 });
      await shot(a, 'end-team', { wait: 900 });
      await h.closeGame(a);
    });

    // live: waiting card + invite banner, then join
    await step('live', async () => {
      await h.startLive(a, 'quickdraw', 'live');
      await h.settle();
      await shot(a, 'live-waiting');
      await h.openGames(b);
      await shot(b, 'live-invite-banner');
      await b.click('#gm-invite [data-g="invite-no"]').catch(() => {});
      await h.closeGame(a); await h.settle();
      await h.startLive(a, 'quickdraw', 'live'); await h.settle();
      await b.click('#gm-invite [data-g="invite-yes"]'); await h.settle(); await h.settle();
      await shot(b, 'live-playing');
      await b.click('#game-root .fk-finish');
      await shot(b, 'live-end', { wait: 1000 });
      await h.closeGame(a); await h.closeGame(b); await h.settle();
    });
    await step('hub invite card', async () => {
      await h.startLive(b, 'hockey', 'live'); await h.settle();
      await h.openGames(a);
      await a.evaluate(() => document.getElementById('gm-invite')?.remove());
      await shot(a, 'hub-invite');
      await a.click('.gh-invite [data-g="invite-yes"]').catch(() => {});
      await h.settle(); await h.closeGame(a).catch(() => {}); await h.closeGame(b).catch(() => {});
    });

    // immersive
    await step('immersive', async () => {
      await h.startLive(a, 'rush', 'local');
      await shot(a, 'immersive');
      await a.click('#game-root [data-g="menu"]');
      await shot(a, 'immersive-menu');
      await a.click('#game-root .gm-sheet [data-g="menu"]');
      await a.click('#game-root .fk-finish');
      await shot(a, 'immersive-end', { wait: 1000 });
      await h.closeGame(a);
    });

    // laptop
    await step('laptop', async () => {
      const ctx = await h.browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: scheme });
      await ctx.addInitScript(() => { try { localStorage.setItem('jt.me', 'a'); } catch {} });
      const pg = await ctx.newPage();
      await pg.goto(`http://localhost:${port}/`);
      await pg.waitForSelector('.tabbar').catch(() => {});
      await prepare(h, pg, { phone: false });
      await pg.click('[data-act="tab"][data-tab="games"]').catch(() => {});
      await shot(pg, 'laptop-hub');
      await pg.click('[data-g="sheet"][data-game="cycles"]').catch(() => {});
      await shot(pg, 'laptop-sheet');
      await pg.click('#game-root .gs-close');
      await pg.click('[data-g="sheet"][data-game="four"]');
      await pg.click('#game-root [data-g="new"][data-mode="local"]');
      await pg.waitForSelector('#game-root .gm');
      for (const sq of [4, 0]) { await pg.click(`#game-root .fk button[data-i="${sq}"]`); await pg.waitForTimeout(80); }
      await shot(pg, 'laptop-game');
      for (const sq of [1, 2, 7]) { await pg.click(`#game-root .fk button[data-i="${sq}"]`); await pg.waitForTimeout(80); }
      await pg.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 4000 });
      await shot(pg, 'laptop-end', { wait: 1000 });
      await ctx.close();
    });
  } finally {
    await h.close();
  }
  if (h.errors.length) console.log('page errors:\n  ' + h.errors.join('\n  '));
}

module.exports = { prepare, cached, INJECT };

if (require.main === module) {
  (async () => {
    const schemes = MODE === 'both' ? ['light', 'dark'] : [MODE];
    let port = Number(process.env.PORT) || 8870;
    for (const s of schemes) await run(s, port++);
    console.log('shots in', OUT);
  })();
}
