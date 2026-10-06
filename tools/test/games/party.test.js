// Party games: Doodle (draw and guess) + Same Wave (the dial), played through the real UI
// on two simulated phones that share a fake database.
//   node tools/test/games/party.test.js
//   SHOTS=/some/dir  to choose where screenshots go;  QUICK=1  to skip the screenshot matrix.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { launch, ROOT } = require('../harness');

const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-Couple-game/0bac2931-fb3f-54c3-8279-c15850ed70e8/scratchpad/party';
const QUICK = process.env.QUICK === '1';
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); passed++; console.log('ok -', m); };
const other = (w) => (w === 'a' ? 'b' : 'a');
const clone = (x) => JSON.parse(JSON.stringify(x));
const wordRe = (w) => new RegExp(`(^|[^a-z])${w.toLowerCase().replace(/[^a-z0-9 ]/g, '.')}([^a-z]|$)`);

// ── pure rules, in Node ─────────────────────────────────────────────────
async function loadRules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'party-rules-'));
  for (const f of ['core.js', 'covers.js', 'doodle.js', 'wave.js']) fs.copyFileSync(path.join(ROOT, 'js/games', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  const core = await import(pathToFileURL(path.join(dir, 'core.js')).href);
  const doodle = await import(pathToFileURL(path.join(dir, 'doodle.js')).href);
  await import(pathToFileURL(path.join(dir, 'wave.js')).href);
  return { core, doodle, D: core.gameById('doodle'), W: core.gameById('wave') };
}

function rulesTests({ core, doodle, D, W }) {
  const step = (def, s, who, mv) => def.apply(clone(s), who, clone(mv));
  const throws = (fn, re, msg) => {
    try { fn(); } catch (e) { assert(re.test(e.message), `${msg} ("${e.message}")`); return; }
    assert(false, `${msg}: should have thrown`);
  };
  const { PROMPTS, guessMatches } = doodle;
  assert(PROMPTS.length >= 240, `doodle has ${PROMPTS.length} prompts`);
  assert(new Set(PROMPTS.map((p) => p.show)).size === PROMPTS.length, 'doodle prompts are unique');
  assert(D.platforms.includes('phone') && D.platforms.includes('computer') && D.best === 'phone', 'doodle declares platforms, best on phone');
  assert(W.platforms.includes('phone') && W.platforms.includes('computer'), 'wave declares platforms');

  // matching
  const P = (s) => { const all = s.split('|'); return { show: all[0], all }; };
  const cases = [
    ['Cat', 'cat', true], ['  the  CAT ', 'cat', true], ['cats', 'cat', true], ['an apple', 'apple', true],
    ['dog', 'cat', false], ['ct', 'cat', false], ['hotdog', 'hot dog', true], ['Hot Dogs', 'hot dog|hotdog', true],
    ['glass', 'glasses', true], ['penguen', 'penguin', true], ['pengiun', 'penguin', true], ['pinguen', 'penguin', false],
    ['strawberries', 'strawberry', true], ['TV', 'tv|television', true], ['televison', 'tv|television', true],
    ['the eiffel tower', 'eiffel tower', true], ['mouse', 'house', false], ['bee', 'bed', false], ['cta', 'cat', false],
  ];
  for (const [g, p, want] of cases) assert(guessMatches(g, P(p)) === want, `guess "${g}" ${want ? 'matches' : 'does not match'} "${p}"`);

  // doodle: deterministic prompts, no repeats, drawer alternates
  let s = D.init({ first: 'b', seed: 4242 }); s.seed = 4242;
  const again = D.init({ first: 'b', seed: 4242 });
  assert(JSON.stringify(again.rounds) === JSON.stringify(s.rounds), 'doodle prompts are deterministic from the seed');
  assert(new Set(s.rounds.flatMap((R) => R.choices)).size === 18, 'doodle never repeats a prompt within a match');
  assert(s.rounds.map((R) => R.drawer).join('') === 'bababa', 'doodle drawer alternates and first draws first');
  const tiny = 'AAAAAAA';
  throws(() => step(D, s, 'a', { guess: 'cat' }), /wait for the drawing/i, 'doodle rejects a guess out of turn');
  throws(() => step(D, s, 'b', { prompt: 0, strokes: 'A'.repeat(13000) }), /too big/i, 'doodle rejects an oversized drawing');
  throws(() => step(D, s, 'b', { prompt: 0, strokes: 'AB$#' }), /scrambled/i, 'doodle rejects a malformed drawing');
  throws(() => step(D, s, 'b', { prompt: 0, strokes: 'AAAAAA' }), /scrambled/i, 'doodle rejects a truncated stroke');
  throws(() => step(D, s, 'b', { prompt: 0, strokes: '' }), /draw something/i, 'doodle rejects an empty drawing');
  throws(() => step(D, s, 'b', { prompt: 3, strokes: tiny }), /pick one/i, 'doodle rejects a bad prompt index');
  s = step(D, s, 'b', { prompt: 2, strokes: tiny });
  assert(JSON.stringify(D.next(s)) === '["a"]', 'after drawing, the partner guesses');
  throws(() => step(D, s, 'b', { guess: 'x' }), /you drew this/i, 'the drawer cannot guess');
  throws(() => step(D, s, 'a', { guess: '   ' }), /type a guess/i, 'doodle rejects an empty guess');
  throws(() => step(D, s, 'a', { guess: 'x'.repeat(41) }), /40/, 'doodle rejects a long guess');
  s = step(D, s, 'a', { guess: 'zzzz' });
  throws(() => step(D, s, 'a', { guess: ' ZZZZ ' }), /already tried/i, 'doodle rejects a repeated guess');
  const ans = PROMPTS[s.rounds[0].choices[2]].show;
  s = step(D, s, 'a', { guess: `The ${ans.toUpperCase()}` });
  assert(s.rounds[0].points === 2 && s.score === 2 && s.r === 1, 'right on the 2nd guess scores 2');
  assert(JSON.stringify(D.next(s)) === '["a"]' && s.rounds[1].drawer === 'a', 'the guesser draws next');
  // full scripted match through the engine replay: 3 + 1 + 0 (3 misses) + 0 (give up) + 3 + 2 = 9
  const plan = [['!'], ['p', 'q', '!'], ['m1', 'm2', 'm3'], ['GIVEUP'], ['!'], ['w', '!']];
  const lists = { a: [], b: [] };
  let st = D.init({ first: 'a', seed: 77 }); st.seed = 77;
  for (let r = 0; r < 6; r++) {
    const dr = st.rounds[r].drawer;
    const mvD = { prompt: r % 3, strokes: tiny };
    lists[dr].push(mvD); st = step(D, st, dr, mvD);
    for (const g of plan[r]) {
      const mv = g === 'GIVEUP' ? { giveUp: true } : { guess: g === '!' ? PROMPTS[st.rounds[r].choices[r % 3]].show : g };
      lists[other(dr)].push(mv); st = step(D, st, other(dr), mv);
    }
  }
  const d = core.derive(D, { first: 'a', seed: 77, lists });
  assert(d.over && d.result.score === 9 && d.rejected.length === 0, `scripted doodle match scores 9 (got ${d.result && d.result.score})`);
  assert(d.result.team === true && typeof d.result.text === 'string', `doodle result has a rating line: "${d.result.text}"`);

  // wave
  let w = W.init({ first: 'a', seed: 31337 }); w.seed = 31337;
  assert(JSON.stringify(W.init({ first: 'a', seed: 31337 }).rounds) === JSON.stringify(w.rounds), 'wave cards and targets are deterministic');
  assert(new Set(w.rounds.map((x) => x.card)).size === 8 && w.rounds.every((x) => x.target >= 0 && x.target <= 100), 'wave: 8 different cards, targets in 0–100');
  assert(w.rounds.map((x) => x.giver).join('') === 'abababab', 'wave clue-giver alternates, first starts');
  throws(() => step(W, w, 'b', { clue: 'hi' }), /not your turn/i, 'wave: only the giver gives the clue');
  throws(() => step(W, w, 'a', { clue: '   ' }), /write a clue/i, 'wave rejects an empty clue');
  throws(() => step(W, w, 'a', {}), /write a clue/i, 'wave rejects a missing clue');
  throws(() => step(W, w, 'a', { clue: 'x'.repeat(41) }), /40/, 'wave rejects a 41-character clue');
  throws(() => step(W, w, 'a', { clue: '73%' }), /numbers/i, 'wave rejects a bare number as a clue');
  throws(() => step(W, w, 'b', { at: 50 }), /wait for the clue/i, 'wave rejects a dial move out of turn');
  w = step(W, w, 'a', { clue: 'x'.repeat(40) });
  throws(() => step(W, w, 'a', { at: 50 }), /you gave the clue/i, 'the giver cannot turn the dial');
  for (const bad of [101, -1, 50.5, '50', null, 1e9]) throws(() => step(W, w, 'b', { at: bad }), /dial/i, `wave rejects dial value ${JSON.stringify(bad)}`);
  const t = w.rounds[0].target;
  const bands = [[0, 4], [4, 4], [5, 3], [10, 3], [11, 2], [17, 2], [18, 0], [40, 0]];
  for (const [off, pts] of bands) {
    const at = t + off <= 100 ? t + off : t - off;
    assert(step(W, w, 'b', { at }).rounds[0].points === pts, `wave: ${off} off scores ${pts}`);
  }
  const lw = { a: [], b: [] };
  let ws = W.init({ first: 'b', seed: 5 }); ws.seed = 5;
  for (let r = 0; r < 8; r++) {
    const g = ws.rounds[r].giver;
    lw[g].push({ clue: `clue ${r}` }); ws = step(W, ws, g, { clue: `clue ${r}` });
    lw[other(g)].push({ at: ws.rounds[r].target }); ws = step(W, ws, other(g), { at: ws.rounds[r].target });
  }
  const dw = core.derive(W, { first: 'b', seed: 5, lists: lw });
  assert(dw.over && dw.result.score === 32 && dw.result.text === 'Telepathic', 'a perfect wave match scores 32: Telepathic');
}

// ── browser helpers ─────────────────────────────────────────────────────
async function snapAll(pg, name, { laptop = false } = {}) {
  if (QUICK) return;
  for (const [w, hh] of [[390, 844], [360, 740]]) {
    for (const scheme of ['light', 'dark']) {
      await pg.setViewportSize({ width: w, height: hh });
      await pg.emulateMedia({ colorScheme: scheme });
      await pg.waitForTimeout(280);
      await pg.screenshot({ path: `${SHOTS}/${name}-${w}-${scheme}.png`, scale: 'css' });
    }
  }
  if (laptop) {
    await pg.setViewportSize({ width: 1280, height: 800 });
    await pg.emulateMedia({ colorScheme: 'light' });
    await pg.waitForTimeout(280);
    await pg.screenshot({ path: `${SHOTS}/${name}-laptop.png`, scale: 'css' });
  }
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.emulateMedia({ colorScheme: 'light' });
  await pg.waitForTimeout(150);
}
// The harness blocks Google Fonts. Serve them from the design preview's cache when it has them
// (read-only, no network), so screenshots show the real Rammetto One / Schibsted Grotesk.
const FONT_CACHE = path.join(ROOT, 'tools/test/.cache/fonts');
async function useCachedFonts(pg) {
  if (!fs.existsSync(FONT_CACHE)) return false;
  const crypto = require('crypto');
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, (r) => {
    const u = r.request().url();
    const f = path.join(FONT_CACHE, crypto.createHash('md5').update(u).digest('hex'));
    if (!fs.existsSync(f)) return r.abort();
    return r.fulfill({ body: fs.readFileSync(f), contentType: /googleapis/.test(u) ? 'text/css' : 'font/woff2', headers: { 'access-control-allow-origin': '*' } });
  });
  await pg.reload();
  await pg.waitForFunction(() => !!document.querySelector('.tabbar'), null, { timeout: 15000 });
  await pg.evaluate(() => document.fonts.ready);
  return true;
}
const visible = (pg, sel) => pg.isVisible(sel).catch(() => false);
const rootHTML = (pg) => pg.evaluate(() => (document.querySelector('#game-root') || document.body).innerHTML.toLowerCase());
async function waitFor(fn, ms = 6000, what = 'condition') {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what);
    await new Promise((r) => setTimeout(r, 60));
  }
}
async function forge(pg, id, w, move) {
  await pg.evaluate(async ([mid, who, mv]) => {
    const db = await window.claude.use('db');
    const snap = await db.doc(`matches/${mid}`).get();
    const list = JSON.parse(snap.data()[who] || '[]');
    list.push(mv);
    await db.doc(`matches/${mid}`).update({ [who]: JSON.stringify(list) });
  }, [id, w, move]);
}

// Doodle drawing: shapes in 0..1 space, drawn by mouse or by touch (CDP touch events).
const ring = (cx, cy, r, n = 26, a0 = 0, a1 = Math.PI * 2) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
const PICTURES = [
  [ // house in the sun
    { c: 0, s: 1, pts: [[0.22, 0.56], [0.22, 0.88], [0.72, 0.88], [0.72, 0.56], [0.22, 0.56]] },
    { c: 2, s: 1, pts: [[0.16, 0.6], [0.47, 0.3], [0.78, 0.6]] },
    { c: 1, s: 0, pts: [[0.42, 0.88], [0.42, 0.72], [0.53, 0.72], [0.53, 0.88]] },
    { c: 3, s: 1, pts: ring(0.82, 0.18, 0.08, 18) },
    { c: 3, s: 0, pts: [[0.82, 0.04], [0.82, 0.0]] },
    { c: 0, s: 0, pts: [[0.05, 0.92], [0.95, 0.92]] },
  ],
  [ // cat face
    { c: 0, s: 1, pts: ring(0.5, 0.55, 0.28, 30) },
    { c: 0, s: 1, pts: [[0.28, 0.38], [0.3, 0.16], [0.44, 0.3]] },
    { c: 0, s: 1, pts: [[0.56, 0.3], [0.7, 0.16], [0.72, 0.38]] },
    { c: 1, s: 1, pts: [[0.41, 0.5], [0.42, 0.51]] },
    { c: 1, s: 1, pts: [[0.59, 0.5], [0.6, 0.51]] },
    { c: 2, s: 1, pts: [[0.47, 0.6], [0.5, 0.64], [0.53, 0.6]] },
    { c: 0, s: 0, pts: [[0.2, 0.6], [0.4, 0.64]] },
    { c: 0, s: 0, pts: [[0.8, 0.6], [0.6, 0.64]] },
  ],
  [ // flower
    { c: 3, s: 1, pts: [[0.5, 0.92], [0.52, 0.7], [0.5, 0.5]] },
    { c: 2, s: 1, pts: ring(0.5, 0.33, 0.1, 20) },
    { c: 2, s: 1, pts: ring(0.36, 0.42, 0.09, 18) },
    { c: 2, s: 1, pts: ring(0.64, 0.42, 0.09, 18) },
    { c: 1, s: 1, pts: ring(0.5, 0.42, 0.05, 12) },
    { c: 3, s: 0, pts: [[0.51, 0.75], [0.66, 0.66], [0.53, 0.71]] },
  ],
];
async function pickSwatch(pg, c, s) {
  await pg.click(`.dd-swatch[data-c="${c}"]`);
  await pg.click(`.dd-size[data-s="${s}"]`);
}
async function canvasBox(pg) {
  await pg.$eval('.dd-paper canvas', (c) => c.scrollIntoView({ block: 'center' }));
  return pg.$eval('.dd-paper canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
}
async function drawPicture(pg, n, via, cdp) {
  const box = await canvasBox(pg);
  const P = ([x, y]) => ({ x: box.x + x * box.w, y: box.y + y * box.h });
  for (const st of PICTURES[n % PICTURES.length]) {
    await pickSwatch(pg, st.c, st.s);
    const pts = st.pts.map(P);
    if (via === 'touch') {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0].x, y: pts[0].y, id: 1 }] });
      for (let i = 1; i < pts.length; i++) {
        for (let k = 1; k <= 4; k++) {
          const x = pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * k) / 4; const y = pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * k) / 4;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
        }
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await pg.mouse.move(pts[0].x, pts[0].y);
      await pg.mouse.down();
      for (let i = 1; i < pts.length; i++) await pg.mouse.move(pts[i].x, pts[i].y, { steps: 4 });
      await pg.mouse.up();
    }
  }
}
// Scribble until the ink runs out (dense drawing), with synthetic pointer events (fast).
async function denseScribble(pg, seed) {
  await pg.evaluate((sd) => {
    const cv = document.querySelector('.dd-paper canvas');
    const r = cv.getBoundingClientRect();
    let s = sd;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 220; k++) {
      let x = r.left + rnd() * r.width; let y = r.top + rnd() * r.height;
      const fire = (type) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 50 + k, bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }));
      fire('pointerdown');
      for (let i = 0; i < 40; i++) {
        x = Math.max(r.left + 2, Math.min(r.right - 2, x + (rnd() - 0.5) * 34));
        y = Math.max(r.top + 2, Math.min(r.bottom - 2, y + (rnd() - 0.5) * 34));
        fire('pointermove');
      }
      fire('pointerup');
    }
  }, seed);
}

async function dialPoint(pg, v, rf = 0.72) {
  return pg.$eval('.wv-dial.live svg', (svg, [val, f]) => {
    const a = Math.PI * (val / 100);
    const p = new DOMPoint(120 - 108 * f * Math.cos(a), 128 - 108 * f * Math.sin(a)).matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  }, [v, rf]);
}
async function dragDial(pg, v, via, cdp) {
  await pg.$eval('.wv-dial.live', (d) => d.scrollIntoView({ block: 'center' }));
  const a = await dialPoint(pg, 50, 0.55);
  const b = await dialPoint(pg, v, 0.72);
  if (via === 'touch') {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 3 }] });
    for (let k = 1; k <= 10; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * k) / 10, y: a.y + ((b.y - a.y) * k) / 10, id: 3 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await pg.mouse.move(a.x, a.y);
    await pg.mouse.down();
    await pg.mouse.move(b.x, b.y, { steps: 12 });
    await pg.mouse.up();
  }
  await pg.waitForTimeout(80);
}
const dialValue = (pg) => pg.$eval('.wv-dial.live', (d) => Number(d.getAttribute('aria-valuenow')));
async function reloadInto(h, pg, id) {
  await pg.reload();
  await pg.waitForFunction(() => !!document.querySelector('.tabbar'), null, { timeout: 15000 });
  await pg.waitForTimeout(300);
  await h.openMatch(pg, id);
  await pg.waitForTimeout(300);
}
const toastText = (pg) => pg.evaluate(() => { const t = [...document.querySelectorAll('.toast')]; return t.length ? t[t.length - 1].textContent : ''; });
// the colour of the first inked pixel on a canvas (top-left scan)
const firstInk = (pg, sel) => pg.$eval(sel, (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 220) return `${d[i]},${d[i + 1]},${d[i + 2]}`; return null; });
const inkedPixels = (pg, sel) => pg.$eval(sel, (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
// with the on-screen keyboard up (a shorter viewport) the form stays in view
async function keyboardUp(pg, input, form) {
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.focus(input);
  await pg.setViewportSize({ width: 390, height: 470 });
  await pg.waitForTimeout(500);
  const box = await pg.$eval(form, (f) => { const r = f.getBoundingClientRect(); return [r.top, r.bottom]; });
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.waitForTimeout(200);
  return box;
}
async function dragPastEnd(pg, side) {
  await pg.$eval('.wv-dial.live', (d) => d.scrollIntoView({ block: 'center' }));
  const from = await dialPoint(pg, 50, 0.55);
  const to = await dialPoint(pg, side ? 100 : 0, 0.72);
  await pg.mouse.move(from.x, from.y);
  await pg.mouse.down();
  await pg.mouse.move(to.x + (side ? 40 : -40), to.y + 50, { steps: 12 });
  await pg.mouse.up();
  await pg.waitForTimeout(120);
}

// QA regressions: reloads mid-draw / mid-guess / mid-clue / mid-dial, theme switch by attribute,
// symbol-only guesses, the keyboard covering inputs, the dial's exact ends.
async function regressions(h, pages) {
  const { a, b } = h;
  console.log('# regressions');
  const id = await h.newOnlineGame(a, 'doodle');
  await h.settle();
  await h.openMatch(b, id);
  await h.settle();
  let e = await h.engine(a, id);
  const D = pages[e.state.rounds[0].drawer]; const G = pages[other(e.state.rounds[0].drawer)];
  await D.waitForSelector('.dd-pick');
  await D.click('.dd-pick[data-i="2"]');
  await D.waitForSelector('.dd-paper.can-draw canvas');
  const word = (await D.$eval('.dd-word', (x) => x.lastChild.textContent)).trim();
  await drawPicture(D, 0, 'mouse');
  await D.waitForTimeout(2200);
  await reloadInto(h, D, id);
  await D.waitForSelector('.dd-paper.can-draw canvas', { timeout: 5000 });
  assert((await D.$eval('.dd-word', (x) => x.lastChild.textContent)).trim() === word, 'doodle: reload mid-draw comes back to the same prompt, still drawing');
  const secs = await D.$eval('.dd-secs', (x) => { const [m, ss] = x.textContent.split(':').map(Number); return m * 60 + ss; });
  assert(secs <= 73 && secs >= 50, `doodle: the clock kept running through the reload (${secs}s left, not 75)`);
  assert(await inkedPixels(D, '.dd-paper canvas') > 300 && !(await D.isDisabled('[data-a="undo"]')), 'doodle: the strokes are back on the paper, and undo still works');
  await D.click('.dd-send');
  await h.settle();
  await G.waitForSelector('.dd-input:not([disabled])');
  await G.fill('.dd-input', '🐱 !!');
  await G.press('.dd-input', 'Enter');
  await h.settle();
  assert((await h.engine(a, id)).state.rounds[0].guesses.length === 0 && /letters/i.test(await toastText(G)), 'doodle: an emoji-only guess is refused and costs no try');
  await G.fill('.dd-input', 'hou');
  await reloadInto(h, G, id);
  await G.waitForSelector('.dd-input:not([disabled])');
  assert(await G.$eval('.dd-input', (x) => x.value) === 'hou', 'doodle: reload keeps a half-typed guess');
  if (await G.$eval('.dd-over-btn', (x) => /skip/i.test(x.textContent)).catch(() => false)) await G.click('.dd-over-btn');
  await G.waitForTimeout(150);
  const inkLight = await firstInk(G, '.dd-paper canvas');
  await G.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await G.waitForTimeout(200);
  const inkDark = await firstInk(G, '.dd-paper canvas');
  await G.evaluate(() => { delete document.documentElement.dataset.theme; });
  await G.waitForTimeout(200);
  assert(inkLight && inkDark && inkLight !== inkDark && await firstInk(G, '.dd-paper canvas') === inkLight, `doodle: switching the theme attribute repaints the drawing's inks (${inkLight} -> ${inkDark} -> back)`);
  let box = await keyboardUp(G, '.dd-input', '.dd-form');
  assert(box[0] >= 0 && box[1] <= 470, `doodle: with the keyboard up the guess box stays in view (${box.map(Math.round)} of 470)`);
  await G.fill('.dd-input', word);
  await G.press('.dd-input', 'Enter');
  await h.settle();
  assert((await h.engine(a, id)).state.rounds[0].points === 3, 'doodle: the restored drawing was guessed for 3');
  await h.closeGame(a); await h.closeGame(b);

  const wid = await h.newOnlineGame(b, 'wave');
  await h.settle();
  await h.openMatch(a, wid);
  await h.settle();
  e = await h.engine(a, wid);
  const GV = pages[e.state.rounds[0].giver]; const GS = pages[other(e.state.rounds[0].giver)];
  await GV.waitForSelector('.wv-input');
  await GV.fill('.wv-input', 'half a clue');
  await reloadInto(h, GV, wid);
  await GV.waitForSelector('.wv-input');
  const restored = await GV.$eval('.wv-form', (f) => [f.querySelector('.wv-input').value, f.querySelector('.gm-btn').disabled]);
  assert(restored[0] === 'half a clue' && !restored[1] && await GV.textContent('.wv-count') === '11 / 40', 'wave: reload keeps a half-typed clue, ready to send');
  box = await keyboardUp(GV, '.wv-input', '.wv-form');
  assert(box[0] >= 0 && box[1] <= 470, `wave: with the keyboard up the clue box stays in view (${box.map(Math.round)} of 470)`);
  await GV.press('.wv-input', 'Enter');
  await h.settle();
  await GS.waitForSelector('.wv-dial.live');
  await dragPastEnd(GS, 0);
  assert(await dialValue(GS) === 0, 'wave: dragging past the left end gives exactly 0');
  await dragPastEnd(GS, 1);
  assert(await dialValue(GS) === 100, 'wave: dragging past the right end gives exactly 100');
  await reloadInto(h, GS, wid);
  await GS.waitForSelector('.wv-dial.live');
  assert(await dialValue(GS) === 100, 'wave: reload keeps where the dial was left');
  await GS.click('.wv-go');
  await h.settle();
  assert((await h.engine(a, wid)).state.rounds[0].at === 100, 'wave: the dial locks in at exactly 100');
  await h.closeGame(a); await h.closeGame(b);
}

// ── main ────────────────────────────────────────────────────────────────
(async () => {
  console.log('# rules');
  const rules = await loadRules();
  rulesTests(rules);

  const h = await launch({ port: 8932, only: ['doodle', 'wave'] });
  const { a, b } = h;
  const pages = { a, b };
  if (!QUICK) for (const pg of [a, b]) await useCachedFonts(pg);
  await h.settle();
  const cdps = { a: await a.context().newCDPSession(a), b: await b.context().newCDPSession(b) };
  try {
    // ════════════════ DOODLE, online ════════════════
    console.log('# doodle online');
    const id = await h.newOnlineGame(a, 'doodle');
    await h.settle();
    await h.openMatch(b, id);
    await h.settle();
    // guesses per round: '!' = the answer, 'GIVEUP' = give up.  3 + 2 + 1 + 0 + 0 + 3 = 9
    const PLAN = [['!'], ['lamp', '!'], ['blob', 'squiggle', '~'], ['nope', 'still no', 'what'], ['GIVEUP'], ['!!']];
    const words = [];
    for (let r = 0; r < 6; r++) {
      const e = await h.engine(a, id);
      assert(e.state.r === r && e.state.phase === 'draw', `round ${r + 1}: draw phase on both phones`);
      const dr = e.state.rounds[r].drawer;
      const D = pages[dr]; const G = pages[other(dr)];
      if (r === 0) assert(dr === e.first, 'the first player draws first');
      // drawer: past the reveal, onto the prompt cards
      await waitFor(async () => (await visible(D, '.dd-next')) || (await visible(D, '.dd-pick')), 8000, 'drawer screen');
      if (await visible(D, '.dd-next')) { await D.click('.dd-next'); }
      await D.waitForSelector('.dd-pick');
      if (r === 0) {
        await G.waitForSelector('.dd-waiting');
        await snapAll(D, 'doodle-01-pick', { laptop: true });
        await snapAll(G, 'doodle-02-wait-for-drawing');
      }
      // the guesser can't see the prompt cards
      const gHtml = await rootHTML(G);
      const shown = await D.$$eval('.dd-pick-word', (xs) => xs.map((x) => x.textContent.trim()));
      // Earlier rounds' answers and guesses are public on the reveal ("breakfast in bed" holds
      // the word "bed"): take them out, then none of this round's prompts may appear.
      let gText = gHtml.replace(/<[^>]+>/g, ' ');
      for (const R of e.state.rounds.slice(0, r)) for (const t of [rules.doodle.PROMPTS[R.choices[R.pick]].show, ...R.guesses]) gText = gText.split(t.toLowerCase()).join(' ');
      const leaked = shown.filter((wd) => wordRe(wd).test(gText));
      assert(shown.length === 3 && !leaked.length, `round ${r + 1}: guesser's page has none of the 3 prompts${leaked.length ? ` (leaked: ${leaked.join(', ')}; page: ${gHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400)})` : ''}`);
      assert(!(await G.$('.dd-input')), `round ${r + 1}: guesser has no guess box while the drawing is being made (no guessing out of turn)`);
      await D.click(`.dd-pick[data-i="${r % 3}"]`);
      await D.waitForSelector('.dd-paper.can-draw canvas');
      const word = (await D.$eval('.dd-word', (x) => x.lastChild.textContent)).trim();
      words.push(word);
      await drawPicture(D, r, r % 2 ? 'touch' : 'mouse', cdps[dr]);
      if (r === 0) {
        assert(await D.$eval('.dd-timer', (x) => /^[01]:\d\d$/.test(x.textContent.trim())), 'draw timer is running');
        // undo and redraw the last stroke
        await D.click('[data-a="undo"]');
        await drawPicture(D, r, 'mouse', cdps[dr]);
        await snapAll(D, 'doodle-03-drawing', { laptop: true });
      }
      await D.click('.dd-send');
      await h.settle();
      // guesser: replay + guesses
      await G.waitForSelector('.dd-input:not([disabled])');
      const gHtml2 = await rootHTML(G);
      assert(!wordRe(word).test(gHtml2.replace(/<[^>]+>/g, ' ')), `round ${r + 1}: guesser's page doesn't contain the answer before guessing`);
      if (r === 0) { await G.waitForTimeout(500); await snapAll(G, 'doodle-04-guess-replay', { laptop: true }); }
      if (await G.$eval('.dd-over-btn', (x) => /skip/i.test(x.textContent)).catch(() => false)) await G.click('.dd-over-btn');
      for (const g of PLAN[r]) {
        if (g === 'GIVEUP') {
          await G.click('.dd-giveup');
          await G.click('.dd-giveup');
        } else {
          const text = g === '!' ? word : g === '!!' ? `The ${word.toUpperCase()}S` : g === '~' ? (word.length >= 5 ? word.slice(0, 2) + word[3] + word[2] + word.slice(4) : word) : g;
          await G.fill('.dd-input', text);
          await G.press('.dd-input', 'Enter');
        }
        await h.settle();
        if (r === 1 && g === 'lamp') {
          assert(await G.$eval('.dd-chips', (x) => /lamp/.test(x.textContent)), 'a wrong guess shows as a crossed-out chip');
          await D.waitForSelector('.dd-live-row.no');
          assert(!(await D.$('.dd-input')), 'drawer watching has no guess box');
          // repeating the same wrong guess is refused, and doesn't cost a try
          await G.fill('.dd-input', 'LAMP');
          await G.press('.dd-input', 'Enter');
          await G.waitForSelector('.toast:has-text("already tried")');
          await h.settle();
          assert((await h.engine(b, id)).state.rounds[1].guesses.length === 1, 'a repeated guess is not counted');
          await snapAll(G, 'doodle-05-wrong-guess');
          await snapAll(D, 'doodle-06-drawer-watching');
        }
      }
      const ea = await h.engine(a, id); const eb = await h.engine(b, id);
      assert(JSON.stringify(ea.state) === JSON.stringify(eb.state), `round ${r + 1}: both phones agree`);
      const want = [3, 2, 1, 0, 0, 3][r];
      assert(ea.state.rounds[r].points === want, `round ${r + 1}: scored ${want}`);
      if (r === 0) {
        await G.waitForSelector('.dd-next');
        await snapAll(G, 'doodle-07-reveal-got-it');
        await D.waitForSelector('.dd-waiting');
        await snapAll(D, 'doodle-08-drawer-sees-result');
      }
      if (r === 3) { await G.waitForSelector('.dd-stamp.bad'); await snapAll(G, 'doodle-09-reveal-missed'); }
    }
    const fa = await h.engine(a, id); const fb = await h.engine(b, id);
    assert(fa.over && fb.over, 'doodle: game over on both phones');
    assert(fa.result.score === 9 && fb.result.score === 9, `doodle: team score 9 of 18 on both (got ${fa.result.score})`);
    assert(JSON.stringify(fa.state) === JSON.stringify(fb.state), 'doodle: final states identical');
    await h.wait(2700);
    assert(await visible(a, '#game-root .gm-end') && await visible(b, '#game-root .gm-end'), 'doodle: end card on both phones');
    await snapAll(a, 'doodle-10-end-card');
    const rec = h.results().find((x) => x.game === 'doodle' && x.mode === 'online');
    assert(rec && rec.winner === 'team' && rec.score === 9, 'doodle: online result recorded (team, 9)');
    assert(/See the gallery/.test(await a.textContent('#game-root [data-g="end-look"]')), 'doodle: the end card offers "See the gallery"');
    for (const pg of [a, b]) await pg.click('#game-root [data-g="end-look"]');
    await a.waitForSelector('.dd-wall .dd-frame:nth-child(6)');
    await b.waitForSelector('.dd-wall .dd-frame:nth-child(6)');
    assert(await a.$$eval('.dd-frame', (xs) => xs.length) === 6, 'gallery shows all 6 drawings');
    const titles = await a.$$eval('.dd-frame-title', (xs) => xs.map((x) => x.textContent.trim().toLowerCase()));
    assert(titles.every((tt, i) => tt === words[i].toLowerCase()), 'gallery captions are the prompts');
    await a.waitForTimeout(800);
    await snapAll(a, 'doodle-11-gallery-drawing-in', { laptop: false });
    await a.waitForTimeout(2600);
    await snapAll(a, 'doodle-12-gallery', { laptop: true });
    await a.click('.dd-frame[data-i="1"]');
    await a.waitForSelector('.dd-lb:not([hidden]) canvas');
    // QA regression: the replay card and the gallery captions fit a 360 px phone
    await a.setViewportSize({ width: 360, height: 740 });
    await a.waitForTimeout(250);
    const lbFit = await a.evaluate(() => { const r = document.querySelector('.dd-lb-card').getBoundingClientRect(); const x = document.querySelector('.dd-lb [data-a="close"]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && x.right <= r.right; });
    assert(lbFit, 'doodle 360: the replay card and its close button fit on screen');
    const capsFit = await a.$$eval('.dd-frame-meta, .dd-frame-title', (xs) => xs.every((x) => x.scrollWidth <= x.clientWidth + 1));
    assert(capsFit, 'doodle 360: gallery captions ("by Emerson") are not cut off');
    await a.setViewportSize({ width: 390, height: 844 });
    await a.waitForTimeout(150);
    await a.waitForTimeout(500);
    await snapAll(a, 'doodle-13-gallery-replay');
    await a.click('.dd-lb [data-a="close"]');
    assert(await a.isHidden('.dd-lb'), 'replay closes');

    // ════════════════ DOODLE: rematch from the gallery, 6 dense drawings ════════════════
    console.log('# doodle dense rematch');
    await a.click('.dd-gal-actions [data-g="rematch"]');
    await h.settle(); await h.settle();
    const id2 = await a.evaluate(() => window.__lastMatchId);
    assert(id2 && id2 !== id, 'Play again from the gallery starts a new match');
    await b.click('.dd-gal-actions [data-g="rematch"]');
    await h.settle();
    assert(await b.evaluate(() => window.__lastMatchId) === id2, 'partner’s Play again joins the same rematch');
    const e2 = await h.engine(a, id2);
    assert(e2.first === other(fa.first), 'rematch: the other player draws first');
    // forged oversized drawing goes straight into the db: both engines must refuse it
    await forge(pages[e2.first], id2, e2.first, { prompt: 0, strokes: 'A'.repeat(13000) });
    await h.settle();
    for (const pg of [a, b]) {
      const e = await h.engine(pg, id2);
      assert(e.rejected.length === 1 && /too big/i.test(e.rejected[0].error) && e.state.phase === 'draw', `oversized drawing in the db is rejected on ${pg.__who}`);
    }
    for (let r = 0; r < 6; r++) {
      const e = await h.engine(a, id2);
      const dr = e.state.rounds[r].drawer; const D = pages[dr]; const G = pages[other(dr)];
      await waitFor(async () => (await visible(D, '.dd-next')) || (await visible(D, '.dd-pick')), 8000, 'drawer screen');
      if (await visible(D, '.dd-next')) await D.click('.dd-next');
      await D.click('.dd-pick[data-i="0"]');
      await D.waitForSelector('.dd-paper.can-draw canvas');
      await denseScribble(D, 1000 + r);
      if (r === 0) await snapAll(D, 'doodle-14-dense-out-of-ink');
      await D.click('.dd-send');
      await h.settle();
      await G.waitForSelector('.dd-input:not([disabled])');
      await G.fill('.dd-input', 'scribbles');
      await G.press('.dd-input', 'Enter');
      await h.settle();
      await G.click('.dd-giveup'); await G.click('.dd-giveup');
      await h.settle();
    }
    const d2a = await h.engine(a, id2); const d2b = await h.engine(b, id2);
    assert(d2a.over && d2b.over && JSON.stringify(d2a.state) === JSON.stringify(d2b.state), 'dense match: both phones agree to the end');
    const lens = d2a.state.rounds.map((R) => R.strokes.length);
    assert(lens.every((n) => n > 10000 && n <= 12288), `6 dense drawings, each under 12 KB: ${lens.join(', ')}`);
    const doc = h.docs[`matches/${id2}`];
    const size = JSON.stringify(doc).length;
    assert(size < 150 * 1024, `match JSON after 6 dense drawings is ${(size / 1024).toFixed(1)} KB (< 150 KB)`);
    await h.wait(2700);
    await h.closeGame(a); await h.closeGame(b);

    // ════════════════ SAME WAVE, online ════════════════
    console.log('# wave online');
    const wid = await h.newOnlineGame(b, 'wave');
    await h.settle();
    await h.openMatch(a, wid);
    await h.settle();
    // planned distance from the target per round: 4,4,3,3,2,2,0,0 = 18
    const OFFS = [0, -3, 7, -9, 13, -16, 24, 41];
    const VIA = ['mouse', 'touch', 'keys', 'mouse', 'touch', 'mouse', 'mouse', 'touch'];
    for (let r = 0; r < 8; r++) {
      const e = await h.engine(a, wid);
      assert(e.state.r === r && e.state.phase === 'clue', `wave round ${r + 1}: clue phase`);
      const gv = e.state.rounds[r].giver; const GV = pages[gv]; const GS = pages[other(gv)];
      if (r === 0) assert(gv === e.first, 'wave: first player gives the first clue');
      await waitFor(async () => (await visible(GV, '.wv-go')) || (await visible(GV, '.wv-input')), 8000, 'giver screen');
      if (await visible(GV, '.wv-go')) await GV.click('.wv-go');
      await GV.waitForSelector('.wv-input');
      // the guesser must never have the target in the DOM before guessing
      const noZone = async () => GS.evaluate(() => !document.querySelector('#game-root .wv-zone, #game-root .wv-b4, #game-root [class*="wv-b"]'));
      if (r === 0) assert(await noZone(), 'wave round 1: guesser\'s page has no target zone while waiting for the clue');
      assert(await GV.$('.wv-zone'), `wave round ${r + 1}: giver sees the target zone`);
      if (r === 0) {
        assert(await GV.$eval('.wv-form .gm-btn', (x) => x.disabled), 'empty clue: Send is disabled');
        await GV.fill('.wv-input', '    ');
        assert(await GV.$eval('.wv-form .gm-btn', (x) => x.disabled), 'blank clue: Send stays disabled');
        // a forged empty clue in the db is rejected by both engines
        await forge(GV, wid, gv, { clue: '   ' });
        await h.settle();
        for (const pg of [a, b]) { const ex = await h.engine(pg, wid); assert(ex.rejected.some((x) => /write a clue/i.test(x.error)) && ex.state.phase === 'clue', `forged empty clue rejected on ${pg.__who}`); }
        await GS.waitForSelector('.wv-wait');
        await snapAll(GS, 'wave-02-wait-for-clue');
        await GV.fill('.wv-input', 'Penguin in a sauna');
        await snapAll(GV, 'wave-01-clue', { laptop: true });
      } else await GV.fill('.wv-input', `clue number ${r + 1}`);
      await GV.press('.wv-input', 'Enter');
      await h.settle();
      await GS.waitForSelector('.wv-dial.live');
      assert(await noZone(), `wave round ${r + 1}: guesser's dial has no target in the DOM before locking in`);
      const target = (await h.engine(a, wid)).state.rounds[r].target;
      const tgt = target + OFFS[r] >= 0 && target + OFFS[r] <= 100 ? target + OFFS[r] : target - OFFS[r];
      if (VIA[r] === 'keys') {
        await dragDial(GS, Math.max(0, tgt - 4), 'mouse');
        const v0 = await dialValue(GS);
        for (let k = v0; k < tgt; k++) await GS.keyboard.press('ArrowRight');
        for (let k = v0; k > tgt; k--) await GS.keyboard.press('ArrowLeft');
      } else await dragDial(GS, tgt, VIA[r], cdps[other(gv)]);
      assert(await dialValue(GS) === tgt, `wave round ${r + 1}: dial set to ${tgt} by ${VIA[r]}`);
      if (r === 0) {
        await GV.waitForSelector('.wv-wait');
        await snapAll(GV, 'wave-04-wait-for-guess');
        await snapAll(GS, 'wave-03-guess', { laptop: true });
        // a forged out-of-range dial value is rejected by both engines
        await forge(GS, wid, other(gv), { at: 140 });
        await h.settle();
        for (const pg of [a, b]) { const ex = await h.engine(pg, wid); assert(ex.rejected.some((x) => /0 to 100/.test(x.error)) && ex.state.phase === 'guess', `forged dial value 140 rejected on ${pg.__who}`); }
      }
      await GS.click('.wv-go');
      await h.settle();
      const ea = await h.engine(a, wid); const eb = await h.engine(b, wid);
      assert(JSON.stringify(ea.state) === JSON.stringify(eb.state), `wave round ${r + 1}: both phones agree`);
      assert(ea.state.rounds[r].points === [4, 4, 3, 3, 2, 2, 0, 0][r], `wave round ${r + 1}: ${Math.abs(OFFS[r])} off scores ${[4, 4, 3, 3, 2, 2, 0, 0][r]}`);
      if (r === 0) {
        await GS.waitForSelector('.wv-result:not(.hide)');
        await snapAll(GS, 'wave-05-reveal');
        await GV.waitForSelector('.wv-result:not(.hide)');
        await snapAll(GV, 'wave-06-reveal-waiting');
      }
      if (r === 6) { await GS.waitForSelector('.wv-result:not(.hide)'); await snapAll(GS, 'wave-07-reveal-miss'); }
    }
    const wa = await h.engine(a, wid); const wb = await h.engine(b, wid);
    assert(wa.over && wb.over && wa.result.score === 18 && wb.result.score === 18, `wave: 18 of 32 on both phones (got ${wa.result.score})`);
    await h.wait(3300);
    assert(await visible(a, '#game-root .gm-end') && await visible(b, '#game-root .gm-end'), 'wave: end card on both phones');
    await snapAll(b, 'wave-08-end-card');
    const wrec = h.results().find((x) => x.game === 'wave' && x.mode === 'online');
    assert(wrec && wrec.winner === 'team' && wrec.score === 18, 'wave: online result recorded (team, 18)');
    assert(/See every round/.test(await b.textContent('#game-root [data-g="end-look"]')), 'wave: the end card offers "See every round"');
    await b.click('#game-root [data-g="end-look"]');
    await b.waitForSelector('.wv-rows .wv-row:nth-child(8)');
    await b.waitForTimeout(700);
    await snapAll(b, 'wave-09-recap', { laptop: true });
    await h.closeGame(a); await h.closeGame(b);

    // ════════════════ same phone ════════════════
    console.log('# doodle same phone (reduced motion)');
    await a.emulateMedia({ reducedMotion: 'reduce' });
    await b.emulateMedia({ reducedMotion: 'reduce' });
    const resBefore = h.results().length;
    await h.newLocalGame(a, 'doodle');
    const lid = await a.evaluate(() => window.__lastMatchId);
    let curtains = 0; let local = 0; const lwords = {};
    for (let guard = 0; guard < 80; guard++) {
      const e = await h.engine(a, lid);
      if (e.over) break;
      if (await visible(a, '#game-root .gm-curtain')) {
        curtains++;
        if (e.state.phase === 'guess') {
          const html = await a.evaluate(() => document.querySelector('#game-root .gm-stage').innerHTML.toLowerCase());
          assert(!wordRe(lwords[e.state.r]).test(html.replace(/<[^>]+>/g, ' ')) && !(await a.$('.gm-stage .dd-paper')), `curtain ${curtains}: nothing secret under the curtain`);
        }
        if (curtains === 2) await snapAll(a, 'doodle-15-curtain');
        await a.click('#game-root [data-g="reveal"]');
        await a.waitForTimeout(120);
        continue;
      }
      if (await visible(a, '.dd-next')) { await a.click('.dd-next'); continue; }
      if (await visible(a, '.dd-pick')) {
        await a.click('.dd-pick[data-i="1"]');
        await a.waitForSelector('.dd-paper.can-draw canvas');
        lwords[e.state.r] = (await a.$eval('.dd-word', (x) => x.lastChild.textContent)).trim();
        await drawPicture(a, e.state.r + 1, 'mouse');
        await a.click('.dd-send');
        await a.waitForTimeout(150);
        continue;
      }
      if (await visible(a, '.dd-input')) {
        await a.fill('.dd-input', lwords[e.state.r]);
        await a.press('.dd-input', 'Enter');
        local++;
        await a.waitForTimeout(150);
        continue;
      }
      await a.waitForTimeout(150);
    }
    const le = await h.engine(a, lid);
    assert(le.over && le.result.score === 18 && local === 6, `same-phone doodle finished: 18 of 18 (got ${le.result.score})`);
    assert(curtains === 7, `same-phone doodle: pass-the-phone curtain at the start and after every drawing (${curtains})`);
    await h.wait(2700);
    assert(await visible(a, '#game-root .gm-end'), 'same-phone doodle: end card');
    await h.settle();
    assert(h.results().length === resBefore + 1 && h.results().some((x) => x.game === 'doodle' && x.mode === 'local' && x.score === 18), 'same-phone doodle result recorded');
    await h.closeGame(a);

    console.log('# wave same phone');
    await h.newLocalGame(b, 'wave');
    const lw = await b.evaluate(() => window.__lastMatchId);
    curtains = 0;
    for (let guard = 0; guard < 80; guard++) {
      const e = await h.engine(b, lw);
      if (e.over) break;
      if (await visible(b, '#game-root .gm-curtain')) {
        curtains++;
        assert(await b.evaluate(() => !document.querySelector('#game-root .gm-stage .wv-zone')), `wave curtain ${curtains}: no target under the curtain`);
        if (curtains === 2) await snapAll(b, 'wave-10-curtain');
        await b.click('#game-root [data-g="reveal"]');
        await b.waitForTimeout(120);
        continue;
      }
      if (await visible(b, '.wv-go') && !(await b.$('.wv-dial.live'))) { await b.click('.wv-go'); continue; }
      if (await visible(b, '.wv-input')) { await b.fill('.wv-input', 'just right'); await b.press('.wv-input', 'Enter'); await b.waitForTimeout(150); continue; }
      if (await b.$('.wv-dial.live')) {
        const t = e.state.rounds[e.state.r].target;
        await dragDial(b, t, 'mouse');
        assert(await dialValue(b) === t, `same-phone wave round ${e.state.r + 1}: dial on target`);
        await b.click('.wv-go');
        await b.waitForTimeout(150);
        continue;
      }
      await b.waitForTimeout(150);
    }
    const lwe = await h.engine(b, lw);
    assert(lwe.over && lwe.result.score === 32 && lwe.result.text === 'Telepathic', `same-phone wave finished: 32, Telepathic (got ${lwe.result.score})`);
    assert(curtains === 9, `same-phone wave: curtain at the start and after every clue (${curtains})`);
    await h.wait(3300);
    assert(await visible(b, '#game-root .gm-end'), 'same-phone wave: end card');
    await h.closeGame(b);

    await regressions(h, pages);

    // ── the 75-second draw timer (UI only) auto-submits at zero ──
    console.log('# doodle draw timer');
    await h.newLocalGame(a, 'doodle');
    const tid = await a.evaluate(() => window.__lastMatchId);
    await a.click('#game-root [data-g="reveal"]');
    await a.waitForSelector('.dd-pick');
    await a.clock.install();
    await a.click('.dd-pick[data-i="0"]');
    await a.waitForSelector('.dd-paper.can-draw canvas');
    await a.clock.fastForward(76000);
    await a.waitForSelector('.toast:has-text("Time’s up")');
    assert((await h.engine(a, tid)).state.phase === 'draw', 'timer at zero with an empty canvas: nothing sent, a nudge instead');
    assert(await a.$eval('.dd-secs', (x) => x.textContent) === '0:00', 'timer shows 0:00');
    await drawPicture(a, 2, 'mouse');
    await a.click('.dd-send');
    await a.waitForSelector('#game-root .gm-curtain:not([hidden])');
    await a.click('#game-root [data-g="reveal"]');
    await a.waitForSelector('.dd-giveup');
    await a.click('.dd-giveup'); await a.click('.dd-giveup');
    await a.waitForSelector('.dd-next');
    await a.click('.dd-next');
    await a.click('.dd-pick[data-i="2"]');
    await a.waitForSelector('.dd-paper.can-draw canvas');
    await drawPicture(a, 1, 'mouse');
    await a.clock.fastForward(40000);
    assert((await h.engine(a, tid)).state.phase === 'draw', 'still drawing at 0:35');
    await a.clock.fastForward(36000);
    await a.waitForSelector('#game-root .gm-curtain:not([hidden])');
    const te = await h.engine(a, tid);
    assert(te.state.r === 1 && te.state.phase === 'guess' && te.state.rounds[1].pick === 2, 'timer at zero auto-submits the drawing');
    await h.closeGame(a);

    h.assertNoErrors();
    console.log(`\nALL GOOD (${passed} checks). Screenshots: ${QUICK ? 'skipped' : SHOTS}`);
  } catch (e) {
    console.error(e.message);
    await h.shot(a, `${SHOTS}/fail-a.png`).catch(() => {});
    await h.shot(b, `${SHOTS}/fail-b.png`).catch(() => {});
    console.error('errors:', h.errors);
    process.exitCode = 1;
  } finally {
    await h.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
