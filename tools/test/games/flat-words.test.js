// Upgrade 2 (flat unit): Word Duel + Double Agents feel and look. Not rules (words*.test.js cover those).
//   node tools/test/games/flat-words.test.js
// Checks: keys and cards answer on pointerdown, typing/selecting patches in place (no rebuild, no layout reads),
// flips and reveals animate only transform/opacity (the one-shot word colour excepted), the kit's shake, the grain on
// tiles/keys/cards in light and dark, and that reduced motion switches every new animation off.
const { launch } = require('../harness');

let fails = 0;
const assert = (c, m) => { if (!c) { fails++; console.log('FAIL -', m); throw new Error('FAIL: ' + m); } console.log('ok -', m); };

// (uses the unpatched getBoundingClientRect once WATCH is installed, so the test's own measuring is not counted as a page read)
const centre = (pg, sel) => pg.evaluate((s) => { const r = (window.__gb || Element.prototype.getBoundingClientRect).call(document.querySelector(s)); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
// Count every layout-forcing read the page makes while `fn` runs.
const WATCH = () => {
  if (window.__reads) return;
  window.__reads = { n: 0 };
  const bump = () => { window.__reads.n++; };
  for (const k of ['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight', 'offsetTop', 'offsetLeft']) {
    const d = Object.getOwnPropertyDescriptor(Element.prototype, k) || Object.getOwnPropertyDescriptor(HTMLElement.prototype, k);
    if (d && d.get) Object.defineProperty(Element.prototype, k, { configurable: true, get() { bump(); return d.get.call(this); } });
  }
  const gb = Element.prototype.getBoundingClientRect;
  window.__gb = gb;
  Element.prototype.getBoundingClientRect = function () { bump(); return gb.call(this); };
  const gc = window.getComputedStyle;
  window.getComputedStyle = function (...a) { bump(); return gc.apply(this, a); };
};
const reads = (pg) => pg.evaluate(() => window.__reads.n);
// every running animation on elements matching `sel` (and their pseudo-elements): { target, props }
const ANIMS = (sel) => [...document.querySelectorAll(sel)].flatMap((el) => el.getAnimations({ subtree: true })).map((a) => ({
  pseudo: a.effect.pseudoElement || '',
  props: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)))],
}));
const SAFE = new Set(['transform', 'opacity']);
const hold = async (pg, x, y, ms = 80) => { await pg.mouse.move(x, y); await pg.mouse.down(); await pg.waitForTimeout(ms); await pg.mouse.up(); };

async function wordDuel(scheme, reducedMotion) {
  const tag = `word duel ${scheme}${reducedMotion ? ' reduced' : ''}`;
  const h = await launch({ port: reducedMotion ? 9146 : scheme === 'dark' ? 9145 : 9144, only: ['wordduel'], colorScheme: scheme, coarse: true, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  try {
    const { a, b } = h;
    const id = await h.newOnlineGame(a, 'wordduel');
    await h.openMatch(b, id);
    await h.settle();
    const first = (await h.engine(a, id)).first;
    await (first === 'a' ? a : b).tap('[data-act="play"]');
    await h.settle();
    await a.keyboard.type('plumb'); await a.keyboard.press('Enter');
    await b.keyboard.type('grape'); await b.keyboard.press('Enter');
    await h.settle(); await h.settle();
    await a.waitForSelector('.g-wd-row.is-draft');

    // texture: tiles and keys carry the paper grain in both themes
    const tex = await a.evaluate(() => {
      const t = getComputedStyle(document.querySelector('.g-wd-row.is-draft .g-wd-tile')).backgroundImage;
      const k = getComputedStyle(document.querySelector('.g-wd-key[data-k="a"]')).backgroundImage;
      return { t, k, tr: getComputedStyle(document.querySelector('.g-wd-key[data-k="a"]')).transitionProperty };
    });
    assert(/url\(/.test(tex.t) && /url\(/.test(tex.k), `${tag}: tiles and keys carry the paper grain`);
    assert(!/box-shadow|background|all/.test(tex.tr), `${tag}: a key only transitions transform (${tex.tr})`);

    await a.evaluate(WATCH);
    await a.evaluate(() => { document.querySelector('.g-wd-board').__keep = 1; document.querySelector('.g-wd-row.is-draft').__keep = 1; document.querySelectorAll('.g-wd-key').forEach((k) => { k.__keep = 1; }); });
    const r0 = await reads(a);

    // a key answers on pointerdown, before the finger lifts
    const s = await centre(a, '.g-wd-key[data-k="s"]');
    await a.mouse.move(s.x, s.y); await a.mouse.down();
    await a.waitForTimeout(30);
    const mid = await a.evaluate(() => ({ t: document.querySelector('.g-wd-row.is-draft .g-wd-tile').textContent, down: document.querySelector('.g-wd-key[data-k="s"]').classList.contains('is-down') }));
    assert(mid.t === 'S', `${tag}: the letter lands on pointerdown (${mid.t})`);
    assert(mid.down, `${tag}: the key dips on pointerdown`);
    await a.mouse.up();
    await a.waitForTimeout(150);
    const after = await a.evaluate(() => [...document.querySelectorAll('.g-wd-row.is-draft .g-wd-tile')].map((t) => t.textContent).join(''));
    assert(after === 'S', `${tag}: the click after pointerdown does not type the letter twice (${after})`);
    assert(await a.evaluate(() => !document.querySelector('.g-wd-key.is-down')), `${tag}: the key comes back up`);
    // keyboard / assistive click (no pointer) still types
    await a.evaluate(() => document.querySelector('.g-wd-key[data-k="x"]').click());
    assert((await a.evaluate(() => document.querySelector('.g-wd-row.is-draft').textContent)) === 'SX', `${tag}: a plain click() still types (keyboard / assistive tech)`);
    await a.evaluate(() => document.querySelector('.g-wd-key[data-k="back"]').click());
    for (const ch of 'late') { const c = await centre(a, `.g-wd-key[data-k="${ch}"]`); await hold(a, c.x, c.y, 30); await a.waitForTimeout(40); }

    // typing patched the draft row in place: nothing rebuilt, no layout-forcing reads
    const kept = await a.evaluate(() => !!(document.querySelector('.g-wd-board').__keep && document.querySelector('.g-wd-row.is-draft') && document.querySelector('.g-wd-row.is-draft').__keep && [...document.querySelectorAll('.g-wd-key')].every((k) => k.__keep)));
    assert(kept, `${tag}: typing keeps the board, the draft row and every key node`);
    const r1 = await reads(a);
    assert(r1 - r0 === 0, `${tag}: typing makes no layout-forcing reads (${r1 - r0})`);
    if (!reducedMotion) {
      assert((await a.evaluate(() => window.__reads.n)) === r1, 'sanity');
    }

    // refused word: the kit's shake (not a forced-reflow restart)
    for (let i = 0; i < 5; i++) await a.evaluate(() => document.querySelector('.g-wd-key[data-k="back"]').click());
    for (const ch of 'qqqqq') await a.evaluate((c) => document.querySelector(`.g-wd-key[data-k="${c}"]`).click(), ch);
    await a.evaluate(() => document.querySelector('.g-wd-key[data-k="enter"]').click());
    await a.waitForTimeout(60);
    const sh = await a.evaluate(() => { const r = document.querySelector('.g-wd-row.is-draft'); return { cls: r.className, anim: r.getAnimations().map((x) => x.animationName) }; });
    assert(/g-shake/.test(sh.cls) && /shake/.test(sh.cls), `${tag}: a refused word shakes the row (${sh.cls})`);
    if (!reducedMotion) assert(sh.anim.includes('g-shake'), `${tag}: the shake is the kit's g-shake animation (${sh.anim})`);
    else assert(sh.anim.length === 0, `${tag}: no shake animation under reduced motion (${sh.anim})`);
    await a.waitForTimeout(500);
    assert(await a.evaluate(() => !document.querySelector('.g-wd-row.shake, .g-wd-row.g-shake')), `${tag}: the shake class clears`);
    for (let i = 0; i < 5; i++) await a.evaluate(() => document.querySelector('.g-wd-key[data-k="back"]').click());

    // submit a real miss: the tiles flip, compositor-only
    for (const ch of 'slate') await a.evaluate((c) => document.querySelector(`.g-wd-key[data-k="${c}"]`).click(), ch);
    await a.evaluate(() => document.querySelector('.g-wd-key[data-k="enter"]').click());
    await a.waitForTimeout(250);
    const fl = await a.evaluate(ANIMS, '.g-wd-tile.flip');
    if (!reducedMotion) {
      assert(fl.length >= 5, `${tag}: five tiles are flipping (${fl.length} animations)`);
      const bad = fl.filter((x) => x.props.some((p) => !SAFE.has(p)));
      assert(!bad.length, `${tag}: the flip animates only transform and opacity (${JSON.stringify(bad.slice(0, 2))})`);
      assert(fl.some((x) => x.pseudo === '::before'), `${tag}: the old face is a pseudo-element cover`);
    } else {
      assert(fl.length === 0, `${tag}: no flip animation under reduced motion (${fl.length})`);
      assert(await a.evaluate(() => { const t = document.querySelector('.g-wd-tile.flip'); return !t || getComputedStyle(t, '::before').display === 'none'; }), `${tag}: the cover is off under reduced motion`);
    }
    await a.waitForTimeout(1500);
    const marks = await a.$$eval('.g-wd-board .g-wd-row:nth-child(1) .g-wd-tile', (ts) => ts.map((t) => (t.className.match(/m-([gyx])/) || [])[1]).join(''));
    assert(/^[gyx]{5}$/.test(marks), `${tag}: the row is scored after the flip (${marks})`);
    const halftone = await a.evaluate(() => { const t = document.querySelector('.g-wd-tile.m-x'); return t ? getComputedStyle(t).backgroundImage : 'radial-gradient'; });
    assert(/radial-gradient/.test(halftone) && /url\(/.test(halftone), `${tag}: a miss is halftone-shaded over the grain`);

    // crack it: win row bounces and throws confetti
    for (const ch of 'grape') await a.evaluate((c) => document.querySelector(`.g-wd-key[data-k="${c}"]`).click(), ch);
    await a.evaluate(() => document.querySelector('.g-wd-key[data-k="enter"]').click());
    await a.waitForTimeout(1160 + 400);
    const fin = await a.evaluate(() => ({ burst: !!document.querySelector('.g-wd-burst'), win: !!document.querySelector('.g-wd-row.win'), jump: document.querySelectorAll('.g-wd-row.win .g-wd-tile').length && [...document.querySelectorAll('.g-wd-row.win .g-wd-tile')].some((t) => t.getAnimations().length) }));
    if (!reducedMotion) {
      assert(fin.burst, `${tag}: a crack throws confetti`);
      await a.waitForTimeout(1800);
      assert(await a.evaluate(() => !document.querySelector('.g-wd-burst')), `${tag}: the confetti removes itself`);
    } else assert(!fin.burst && !fin.jump, `${tag}: no confetti and no bounce under reduced motion`);
    h.assertNoErrors();
  } finally { await h.close(); }
}

async function agents(scheme, reducedMotion) {
  const tag = `agents ${scheme}${reducedMotion ? ' reduced' : ''}`;
  const h = await launch({ port: reducedMotion ? 9147 : scheme === 'dark' ? 9149 : 9148, only: ['agents'], colorScheme: scheme, coarse: true, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  try {
    const { a, b } = h;
    const P = { a, b };
    const id = await h.newOnlineGame(a, 'agents');
    await h.openMatch(b, id);
    await h.settle();
    let s = (await h.engine(a, id)).state;
    const G = P[s.giver];
    const R = P[s.giver === 'a' ? 'b' : 'a'];
    await G.tap('.g-ag-play');
    await h.settle();
    s = (await h.engine(a, id)).state;
    const clue = ['qwerty', 'zigzag', 'jumble', 'velvet', 'whimsy', 'gizmo'].find((c) => s.words.every((w) => !w.includes(c) && !c.includes(w)));
    await G.fill('.g-ag-input', clue);
    await G.click('.g-ag-step [data-act="plus"]');
    await G.click('.g-ag-form button[type="submit"]');
    await h.settle();
    const todo = [...s.key[s.giver]].map((c, i) => (c === 'G' ? i : -1)).filter((i) => i >= 0);
    const other = [...s.key[s.giver]].map((c, i) => (c !== 'G' ? i : -1)).filter((i) => i >= 0);

    // texture
    const tex = await R.evaluate(() => getComputedStyle(document.querySelector('.g-ag-card')).backgroundImage);
    assert(/url\(/.test(tex), `${tag}: cards are printed on grained stock`);
    await R.waitForTimeout(450);
    await R.evaluate(WATCH);
    await R.evaluate(() => { document.querySelectorAll('.g-ag-card').forEach((c) => { c.__keep = 1; }); document.querySelector('.g-ag-grid').__keep = 1; });
    const r0 = await reads(R);

    // pointerdown dips the card, the pick waits for the click
    const c0 = await centre(R, `.g-ag-card[data-i="${other[0]}"]`);
    await R.mouse.move(c0.x, c0.y); await R.mouse.down();
    await R.waitForTimeout(30);
    const dn = await R.evaluate((i) => { const c = document.querySelector(`.g-ag-card[data-i="${i}"]`); return { down: c.classList.contains('is-down'), sel: c.classList.contains('is-sel') }; }, other[0]);
    assert(dn.down && !dn.sel, `${tag}: the card dips on pointerdown but is not selected until the tap completes`);
    await R.mouse.up();
    await R.waitForTimeout(120);
    assert(await R.evaluate((i) => document.querySelector(`.g-ag-card[data-i="${i}"]`).classList.contains('is-sel') && !document.querySelector('.is-down'), other[0]), `${tag}: the tap selects the card and the dip clears`);
    // re-select another, then confirm an agent
    await R.waitForTimeout(400);
    await R.evaluate((i) => document.querySelector(`.g-ag-card[data-i="${i}"]`).click(), other[1]);
    await R.waitForTimeout(100);
    assert(await R.evaluate((i) => document.querySelector(`.g-ag-card[data-i="${i}"]`).classList.contains('is-sel') && document.querySelectorAll('.is-sel').length === 1, other[1]), `${tag}: selecting moves the selection`);
    const r1 = await reads(R);
    assert(r1 - r0 === 0, `${tag}: selecting cards makes no layout-forcing reads (${r1 - r0})`);
    await R.waitForTimeout(400);
    await R.evaluate((i) => document.querySelector(`.g-ag-card[data-i="${i}"]`).click(), todo[0]);
    await R.waitForTimeout(400);
    await R.evaluate((i) => document.querySelector(`.g-ag-card[data-i="${i}"]`).click(), todo[0]);
    await R.waitForTimeout(120);
    const kept = await R.evaluate(() => document.querySelector('.g-ag-grid').__keep === 1 && [...document.querySelectorAll('.g-ag-card')].every((c) => c.__keep === 1) && document.querySelectorAll('.g-ag-card').length === 25);
    assert(kept, `${tag}: selecting and picking patch the 25 card nodes in place`);
    const an = await R.evaluate(ANIMS, `.g-ag-card[data-i="${todo[0]}"]`);
    if (!reducedMotion) {
      assert(an.length >= 2, `${tag}: the picked card is turning over (${an.length} animations)`);
      const cardLevel = an.filter((x) => x.pseudo === '' ).flatMap((x) => x.props);
      const bad = an.filter((x) => x.props.some((p) => !SAFE.has(p) && p !== 'color'));
      assert(!bad.length, `${tag}: the turn animates transform and opacity (only the one word colour besides) ${JSON.stringify(bad)}`);
      assert(cardLevel.includes('transform'), `${tag}: the card itself turns with a transform`);
    } else assert(an.length === 0, `${tag}: no card animation under reduced motion (${an.length})`);
    const fnd = await R.evaluate((i) => { const c = document.querySelector(`.g-ag-card[data-i="${i}"]`); return { found: c.classList.contains('is-found'), bg: getComputedStyle(c).backgroundImage }; }, todo[0]);
    assert(fnd.found && /radial-gradient/.test(fnd.bg), `${tag}: a found agent is halftone-shaded`);
    // the key view toggles a card's key without a rebuild
    h.assertNoErrors();
  } finally { await h.close(); }
}

(async () => {
  for (const scheme of ['light', 'dark']) { await wordDuel(scheme, false); await agents(scheme, false); }
  await wordDuel('light', true);
  await agents('light', true);
  console.log(fails ? `\n${fails} FAILED` : '\nALL GOOD');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
