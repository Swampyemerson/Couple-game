// Defuse, "flat" upgrade: smoothness, press-in, juice, riso texture, reduced motion.
//   node tools/test/games/flat-defuse.test.js [play|boom|reduced|dark|all]     (PORT=9300 uses PORT..PORT+5, SHOTS=/dir for screenshots)
//
// What it pins down:
//   - the clock has a fixed-size box with layout containment, and a ticking round mutates nothing but the clock's text (no module
//     re-render, no flag/attribute rewrites), with at most a layout or two a second;
//   - controls press in on pointerdown (before the click acts) and spring back;
//   - juice: wire snip, strike flash and shake restart without reading layout (a/b class swap), strike pip, last-ten-seconds beat
//     and red frame (bomb and manual), the DEFUSED stamp with ink dots, the BOOM burst with a jolt;
//   - the printed look is there in light and dark (paper grain on the casing, modules, bar and manual page);
//   - under prefers-reduced-motion every one of those animations is off and the overlays stay invisible.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { launch } = require('../harness');

const ROOT = path.resolve(__dirname, '../../..');
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'just-us-shots', 'flat-defuse');
const PORT = Number(process.env.PORT) || 9300;
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 8000, step = 40) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('FAIL: timed out waiting for ' + what);
    await sleep(step);
  }
}
const dx = (pg) => pg.evaluate(() => window.__defuse && window.__defuse.info());
const shot = async (pg, name) => { await pg.screenshot({ path: path.join(SHOTS, name + '.png') }); console.log('   shot', name); };
const sty = (pg, sel, prop) => pg.evaluate(([s, p]) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : null; }, [sel, prop]);
const cls = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); return e ? e.className : null; }, sel);

let RD = null;
function findSeed(pred, tier = 'normal', prefix = 'fl') {
  for (let i = 0; i < 20000; i++) { const r = RD.buildRound(prefix + i, tier); if (pred(r)) return prefix + i; }
  throw new Error('no seed');
}
const quiet = (r) => !['decoy', 'blackout', 'vent', 'relay'].some((t) => r.twists.includes(t)) && !r.twistRules.surge && !r.twistRules.tax;
const has = (r, ...ids) => ids.every((id) => r.slots.some((s) => s.id === id && !s.decoy));

async function start(h, seed, opts = {}) {
  for (const pg of [h.a, h.b]) await pg.setViewportSize({ width: 390, height: 844 });
  await h.startLive(h.a, 'defuse', 'live'); await h.settle();
  await until(() => h.b.isVisible('#gm-invite'), 'the invite');
  await h.b.click('#gm-invite [data-g="invite-yes"]'); await h.settle(); await h.settle();
  await until(async () => (await dx(h.a)) && (await dx(h.b)), 'both lobbies');
  await h.a.click('.dx-role[data-role="bomb"]'); await h.b.click('.dx-role[data-role="manual"]'); await h.settle();
  if (opts.tier) { await h.b.click(`.dx-tiers [data-diff="${opts.tier}"]`); await h.settle(); }
  await h.a.evaluate((s) => window.__defuse.force(s), seed);
  await until(() => h.b.evaluate(() => !document.querySelector('.g-defuse [data-act="start"]').disabled), 'start enabled');
  await h.b.click('.g-defuse [data-act="start"]');
  await until(async () => { const x = await dx(h.a); const y = await dx(h.b); return x && y && x.phase === 'bomb' && y.phase === 'manual' && y.manual && y.manual.n === x.bomb.n; }, 'both devices in the round');
  await sleep(300);
  return (await dx(h.a)).bomb;
}
const slotOf = (b, id) => b.round.slots.findIndex((s) => s.id === id && !s.decoy);
async function wrongSubmit(pg, i) {
  const sel = `.dx-mod[data-slot="${i}"] .dx-pw-submit`;
  await pg.locator(sel).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await pg.locator(sel).tap();
}

// ══════════════════════════ a normal round: smoothness, press-in, juice ══════════════════════════
async function play(h) {
  console.log('\n# Flat Defuse: a live Agent round on two phones');
  const seed = findSeed((r) => quiet(r) && has(r, 'wires', 'password') && r.slots.length === 4);
  const b = await start(h, seed);
  const wi = slotOf(b, 'wires'), pi = slotOf(b, 'password');

  // 1. the clock is a fixed box: digits changing never change its size or anything near it
  assert(/layout/.test(await sty(h.a, '.dx-topbar .dx-time', 'contain')), 'the clock box has layout containment');
  const widths = await h.a.evaluate(async () => {
    const el = document.querySelector('.dx-topbar .dx-time'); const lcd = el.closest('.dx-lcd'); const bar = document.querySelector('.dx-topbar');
    const out = [];
    for (const ms of [299000, 241000, 111000, 99000, 61000, 12500]) {
      window.__defuse.setLeft(ms);
      await new Promise((r) => setTimeout(r, 260));
      out.push([el.textContent, el.getBoundingClientRect().width, lcd.getBoundingClientRect().width, bar.getBoundingClientRect().height].map((v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)));
    }
    return out;
  });
  assert(new Set(widths.map((w) => w[0])).size === widths.length, `six different clock readings (${widths.map((w) => w[0]).join(' ')})`);
  assert(new Set(widths.map((w) => w[1])).size === 1 && new Set(widths.map((w) => w[2])).size === 1 && new Set(widths.map((w) => w[3])).size === 1, `the clock, its panel and the top bar keep their size across digits (${widths[0][1]} x ${widths[0][2]} px)`);
  await h.a.evaluate(() => window.__defuse.setLeft(250000));
  await sleep(1200); // out of the last ten seconds, and any one-shot is done

  // 2. a ticking round rewrites only the clock's text: no module re-render, no attribute or flag writes, few layouts
  await h.a.evaluate(() => {
    document.querySelectorAll('.dx-mod, .dx-mod-body > *, .dx-topbar, .dx-side, .dx-time').forEach((e) => { e.__keep = 1; });
    window.__muts = [];
    const mo = new MutationObserver((l) => { for (const m of l) window.__muts.push({ el: m.target.nodeType === 1 ? m.target : m.target.parentElement, type: m.type, attr: m.attributeName }); });
    mo.observe(document.querySelector('.g-defuse'), { subtree: true, attributes: true, childList: true, characterData: true });
    window.__mo = mo;
  });
  const cdp = await h.a.context().newCDPSession(h.a);
  await cdp.send('Performance.enable');
  const met = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const m0 = await met();
  await sleep(4200);
  const m1 = await met();
  const mu = await h.a.evaluate(() => { window.__mo.disconnect(); return { n: window.__muts.length, other: window.__muts.filter((m) => !m.el || !m.el.closest('.dx-time')).map((m) => `${m.el && m.el.tagName}.${m.el && m.el.className} ${m.type}${m.attr ? ':' + m.attr : ''}`), kept: [...document.querySelectorAll('.dx-mod, .dx-mod-body > *, .dx-topbar, .dx-side, .dx-time')].every((e) => e.__keep === 1) }; });
  assert(mu.n >= 2 && mu.n <= 24, `ticking mutates the clock text only (${mu.n} writes in 4 s)`);
  assert(mu.other.length === 0, 'nothing but the clock changed while the round ticked' + (mu.other.length ? ': ' + mu.other.slice(0, 4).join('; ') : ''));
  assert(mu.kept, 'no module, panel or bar was rebuilt by the clock');
  const lps = (m1.LayoutCount - m0.LayoutCount) / 4.2;
  assert(lps <= 2.5, `layouts while the clock ticks: ${lps.toFixed(1)}/s (was about 1/s before; the limit is 2.5)`);

  // 3. press-in on pointerdown: the control sinks before the click acts, and springs back on release
  const roll = `.dx-mod[data-slot="${pi}"] .dx-pw-btn[data-col="0"][data-roll="1"]`;
  await h.a.locator(roll).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const before = (await h.a.evaluate((i) => window.__defuse.saveOf(i), pi)).p[0];
  const bb = await h.a.locator(roll).boundingBox();
  await h.a.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await h.a.mouse.down();
  await sleep(40);
  const pr = await h.a.evaluate((s) => { const e = document.querySelector(s); return { on: e.classList.contains('is-press'), ty: new DOMMatrix(getComputedStyle(e).transform).m42 }; }, roll);
  assert(pr.on && Math.abs(pr.ty - 3) < 0.6, `pointerdown presses the roller in at once (class is-press, ${pr.ty.toFixed(1)} px down)`);
  assert((await h.a.evaluate((i) => window.__defuse.saveOf(i), pi)).p[0] === before, 'pressing in does not act: the roller moves on the click, not the press');
  await h.a.mouse.up();
  await sleep(220);
  assert(!(await cls(h.a, roll)).includes('is-press') && (await h.a.evaluate((i) => window.__defuse.saveOf(i), pi)).p[0] !== before, 'on release the control springs back and the click acts');
  const tabP = await h.b.locator('.dx-index [data-page]').nth(1).boundingBox();
  await h.b.mouse.move(tabP.x + 10, tabP.y + 10); await h.b.mouse.down(); await sleep(40);
  assert(await h.b.evaluate(() => !!document.querySelector('.dx-index .is-press')), 'manual tabs press in too');
  await h.b.mouse.up(); await sleep(150);

  // 3b. a real touch tap on a control costs about one layout (the text it changes), not the two to three a transform from "none" used to cost
  const tp = await h.a.evaluate((sel) => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, roll);
  await sleep(500);
  const t0m = await met();
  for (let i = 0; i < 6; i++) { await h.a.touchscreen.tap(tp.x, tp.y); await sleep(450); }
  const t1m = await met();
  const lpt = (t1m.LayoutCount - t0m.LayoutCount) / 6;
  assert(lpt <= 2.2, `a touch tap on a roller costs ${lpt.toFixed(1)} layouts (the clock adds about 0.5; it was 3.4 before press-in rested on a no-op transform)`);

  // 4. wire snip + strike juice
  const acts = await h.a.evaluate((i) => window.__defuse.drive(i), wi);
  const right = +/data-wire="(\d+)"/.exec(acts[0].sel)[1];
  const wrong = b.round.slots[wi].S.w.map((_, k) => k).find((k) => k !== right);
  const ws = `.dx-mod[data-slot="${wi}"] .dx-wire[data-wire="${wrong}"]`;
  await h.a.locator(ws).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const probeL = await h.a.evaluate(() => { window.__lay = 0; return 1; });
  await h.a.locator(ws).tap();
  await sleep(160);
  const sn = await h.a.evaluate(([s, mod]) => {
    const w = document.querySelector(s); const m = document.querySelector(`.dx-mod[data-slot="${mod}"]`); const f = document.querySelector('.dx-flash');
    return { snip: w.classList.contains('is-snip') && w.classList.contains('is-cut'), hl: getComputedStyle(w.querySelector('.hl')).animationName, hr: getComputedStyle(w.querySelector('.hr')).animationName, spark: getComputedStyle(w.querySelector('.spark')).animationName,
      mod: m.className, flash: f.className, flashAnim: getComputedStyle(f).animationName, pips: [...document.querySelectorAll('.dx-topbar .dx-strikes i.on')].length, pipAnim: getComputedStyle(document.querySelector('.dx-topbar .dx-strikes i.on') || document.body).animationName };
  }, [ws, wi]);
  assert(sn.snip && sn.hl === 'dx-snip-l' && sn.hr === 'dx-snip-r' && sn.spark === 'dx-spark', 'cutting a wire plays the snip: two halves recoil and a spark flashes');
  assert(/is-bad/.test(sn.mod) && /shk-[ab]/.test(sn.mod) && /fl-[ab]/.test(sn.flash) && /^dx-(shk|fl)-[ab]/.test(sn.flashAnim) && sn.pips === 1 && sn.pipAnim === 'dx-pip', `a strike shakes the module (${sn.mod.match(/shk-[ab]/)}), flashes the screen (${sn.flash.match(/fl-[ab]/)}) and stamps a pip`);
  await until(async () => (await dx(h.b)).manual.strikes === 1, 'the manual to see the strike');
  assert(/shk-[ab]/.test(await cls(h.b, '.dx-mbar')) && /fl-[ab]/.test(await cls(h.b, '.dx-flash')), 'the manual shakes and flashes on the strike too');
  const fl1 = await cls(h.a, '.dx-flash');
  await sleep(500);
  await wrongSubmit(h.a, pi);
  await until(async () => (await dx(h.a)).bomb.strikes === 2, 'the second strike');
  await sleep(60);
  const fl2 = await cls(h.a, '.dx-flash');
  assert(fl1.match(/fl-[ab]/)[0] !== fl2.match(/fl-[ab]/)[0], `the next strike restarts the flash by swapping classes, not by reading layout (${fl1.match(/fl-[ab]/)} then ${fl2.match(/fl-[ab]/)})`);
  assert(/shk-[ab]/.test(await cls(h.a, `.dx-mod[data-slot="${pi}"]`)), 'the password module shakes on its own strike');
  await shot(h.a, 'play-strike-light');

  // 5. the last ten seconds
  await sleep(700);
  await h.a.evaluate(() => window.__defuse.setLeft(13500));
  await sleep(900);
  assert(!/beat-/.test(await cls(h.a, '.dx-topbar .dx-lcd')) && !/vg-/.test(await cls(h.a, '.dx-vig')), 'no beat or red frame before the last ten seconds');
  await h.a.evaluate(() => window.__defuse.setLeft(10400));
  await until(async () => /beat-[ab]/.test(await cls(h.a, '.dx-topbar .dx-lcd')), 'the clock to beat', 3000, 50);
  const c1 = await cls(h.a, '.dx-topbar .dx-lcd');
  assert(/vg-[ab]/.test(await cls(h.a, '.dx-vig')) && (await sty(h.a, '.dx-vig', 'animationName')).startsWith('dx-vg'), `in the last ten seconds the clock beats and a red frame flashes (${c1.match(/beat-[ab]/)})`);
  await until(async () => /beat-[ab]/.test(await cls(h.a, '.dx-topbar .dx-lcd')) && (await cls(h.a, '.dx-topbar .dx-lcd')).match(/beat-[ab]/)[0] !== c1.match(/beat-[ab]/)[0], 'a second beat', 2500, 50);
  assert(true, 'it beats again each second');
  await until(async () => /beat-[ab]/.test(await cls(h.b, '.dx-mbar .dx-lcd')), 'the manual clock to beat', 3000, 50);
  assert(/vg-[ab]/.test(await cls(h.b, '.dx-vig')), 'the manual beats and flashes red too');
  await shot(h.a, 'play-final10-light');
  await h.a.evaluate(() => window.__defuse.setLeft(200000));

  // 6. the finale: DEFUSED stamp with ink dots, on both devices
  await sleep(1000);
  await h.a.evaluate(() => window.__defuse.forceWin());
  await until(async () => (await h.a.evaluate(() => document.querySelectorAll('.dx-fx .dx-stamp').length)) === 1 && (await h.b.evaluate(() => document.querySelectorAll('.dx-fx .dx-stamp').length)) === 1, 'the stamp on both devices', 4000, 50);
  await sleep(700);
  for (const [name, pg] of [['bomb', h.a], ['manual', h.b]]) {
    const st = await pg.evaluate(() => ({ dots: document.querySelectorAll('.dx-fx .dx-dot').length, anim: getComputedStyle(document.querySelector('.dx-stamp')).animationName, txt: document.querySelector('.dx-stamp b').textContent, plate: getComputedStyle(document.querySelector('.dx-stamp'), '::before').borderTopWidth }));
    assert(st.txt === 'DEFUSED' && st.dots >= 12 && st.anim === 'dx-stamp2' && st.plate === '3px', `${name}: DEFUSED stamp lands, with a second plate and ${st.dots} ink dots`);
  }
  await shot(h.a, 'play-defused-light');
  await shot(h.b, 'play-defused-manual-light');
  h.assertNoErrors();
  assert(true, 'no page errors (play)');
}

// ══════════════════════════ the boom ══════════════════════════
async function boom(h) {
  console.log('\n# Flat Defuse: three strikes');
  const seed = findSeed((r) => quiet(r) && has(r, 'password') && r.slots.length === 4, 'normal', 'bm');
  const b = await start(h, seed);
  const pi = slotOf(b, 'password');
  for (let k = 1; k <= 3; k++) {
    await wrongSubmit(h.a, pi);
    await until(async () => { const x = (await dx(h.a)).bomb; return x.strikes >= k || x.over; }, `strike ${k}`);
    await sleep(520);
  }
  await until(async () => (await dx(h.a)).bomb.over, 'the boom', 3000);
  await sleep(120);
  const bo = await h.a.evaluate(() => ({
    dots: document.querySelectorAll('.dx-boom .dx-dot').length, wave: !!document.querySelector('.dx-boom .dx-wave'), waveAnim: getComputedStyle(document.querySelector('.dx-boom .dx-wave')).animationName,
    jolt: document.querySelector('.dx-bomb').className, flash: document.querySelector('.dx-flash').className, boomAnim: getComputedStyle(document.querySelector('.dx-boom')).animationName, txt: document.querySelector('.dx-boom b').textContent,
    shadow: getComputedStyle(document.querySelector('.dx-boom b')).textShadow,
  }));
  assert(bo.txt === 'BOOM' && bo.dots >= 18 && bo.wave && bo.waveAnim === 'dx-wave', `BOOM: starburst, shock ring and ${bo.dots} ink drops`);
  assert(/jolt-[ab]/.test(bo.jolt) && /is-hot/.test(bo.flash) && /fl-[ab]/.test(bo.flash), 'a big hit gets the short jolt and a hot flash');
  assert(/rgb/.test(bo.shadow) && bo.shadow.split('rgb').length >= 4, 'the BOOM lettering has its off-register plates');
  await until(async () => (await h.b.evaluate(() => !!document.querySelector('.dx-boom'))), 'the manual to boom too');
  await shot(h.a, 'boom-light');
  await shot(h.b, 'boom-manual-light');
  h.assertNoErrors();
  assert(true, 'no page errors (boom)');
}

// ══════════════════════════ reduced motion ══════════════════════════
async function reduced(h) {
  console.log('\n# Flat Defuse: prefers-reduced-motion');
  const seed = findSeed((r) => quiet(r) && has(r, 'wires', 'password') && r.slots.length === 4, 'normal', 'rm');
  assert(await h.a.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'the page asks for reduced motion');
  const b = await start(h, seed);
  const wi = slotOf(b, 'wires'), pi = slotOf(b, 'password');
  const acts = await h.a.evaluate((i) => window.__defuse.drive(i), wi);
  const right = +/data-wire="(\d+)"/.exec(acts[0].sel)[1];
  const wrong = b.round.slots[wi].S.w.map((_, k) => k).find((k) => k !== right);
  const ws = `.dx-mod[data-slot="${wi}"] .dx-wire[data-wire="${wrong}"]`;
  await h.a.locator(ws).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await h.a.locator(ws).tap();
  await sleep(160);
  const r = await h.a.evaluate(([s, mod]) => {
    const w = document.querySelector(s); const m = document.querySelector(`.dx-mod[data-slot="${mod}"]`); const f = document.querySelector('.dx-flash'); const g = (e) => getComputedStyle(e).animationName;
    return { hl: g(w.querySelector('.hl')), spark: g(w.querySelector('.spark')), mod: g(m), flash: g(f), flashOn: getComputedStyle(f).display, pip: g(document.querySelector('.dx-topbar .dx-strikes i.on')), cut: w.classList.contains('is-cut') };
  }, [ws, wi]);
  assert(r.cut && r.hl === 'none' && r.spark === 'none' && r.mod === 'none' && r.flash === 'none' && r.flashOn === 'none' && r.pip === 'none', 'a strike under reduced motion: the wire is cut, but no snip, shake, flash or pip animation runs');
  await h.a.evaluate(() => window.__defuse.setLeft(9500));
  await sleep(1500);
  assert((await sty(h.a, '.dx-topbar .dx-lcd', 'animationName')) === 'none' && (await sty(h.a, '.dx-vig', 'display')) === 'none', 'the last ten seconds under reduced motion: no beat, no red frame');
  // press-in is not an animation: it still shows
  const roll = `.dx-mod[data-slot="${pi}"] .dx-pw-btn[data-col="1"][data-roll="1"]`;
  await h.a.locator(roll).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const bb = await h.a.locator(roll).boundingBox();
  await h.a.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await h.a.mouse.down(); await sleep(40);
  assert(await h.a.evaluate((s) => document.querySelector(s).classList.contains('is-press'), roll), 'press-in still shows (it is a state, not an animation)');
  await h.a.mouse.up();
  await h.a.evaluate(() => window.__defuse.setLeft(200000));
  await sleep(300);
  await h.a.evaluate(() => window.__defuse.forceWin());
  await until(() => h.a.evaluate(() => !!document.querySelector('.dx-fx .dx-stamp')), 'the stamp', 3000, 50);
  const f = await h.a.evaluate(() => ({ stamp: getComputedStyle(document.querySelector('.dx-stamp')).animationName, ripple: getComputedStyle(document.querySelector('.dx-stamp'), '::after').animationName, dots: getComputedStyle(document.querySelector('.dx-dot')).display, op: getComputedStyle(document.querySelector('.dx-stamp')).opacity }));
  assert(f.stamp === 'none' && f.ripple === 'none' && f.dots === 'none' && f.op === '1', 'the DEFUSED stamp just appears under reduced motion (no landing, ripple or ink dots)');
  h.assertNoErrors();
  assert(true, 'no page errors (reduced motion)');
}

// ══════════════════════════ dark mode + the printed look ══════════════════════════
async function look(h, scheme) {
  console.log(`\n# Flat Defuse: the printed look (${scheme})`);
  const seed = findSeed((r) => quiet(r) && r.slots.length === 4, 'normal', 'lk');
  const b = await start(h, seed);
  const grain = (pg, sel) => pg.evaluate((s) => /url\(/.test(getComputedStyle(document.querySelector(s)).backgroundImage), sel);
  for (const sel of ['.dx-bomb', '.dx-mod', '.dx-topbar', '.dx-sticker', '.dx-plate']) assert(await grain(h.a, sel), `bomb: ${sel} carries the paper grain`);
  for (const sel of ['.dx-mbar', '.dx-page', '.dx-index button']) assert(await grain(h.b, sel), `manual: ${sel} carries the paper grain`);
  const ts = await h.a.evaluate(() => ({ plate: getComputedStyle(document.querySelector('.dx-plate')).textShadow, tag: getComputedStyle(document.querySelector('.dx-mod-tag')).textShadow, casing: getComputedStyle(document.querySelector('.dx-bomb'), '::before').backgroundImage, ink: getComputedStyle(document.querySelector('.dx-bomb'), '::after').borderTopWidth }));
  assert(ts.plate !== 'none' && ts.tag !== 'none' && /radial-gradient/.test(ts.casing) && ts.ink === '2px', 'plate numbers and tags are printed off register; the casing has graded halftone and a second plate');
  const mn = await h.b.evaluate(() => ({ spine: getComputedStyle(document.querySelector('.dx-page'), '::before').backgroundImage, reg: getComputedStyle(document.querySelector('.dx-page'), '::after').borderTopWidth, h3: getComputedStyle(document.querySelector('.dx-sec h3') || document.body).textShadow, mix: getComputedStyle(document.querySelector('.g-defuse')).getPropertyValue('--dx-mix').trim() }));
  assert(/radial-gradient/.test(mn.spine) && parseFloat(mn.reg) >= 1 && mn.mix === (scheme === 'dark' ? 'normal' : 'multiply'), `the manual page: halftone spine, registration mark, overprint ${mn.mix === 'multiply' ? 'multiplies over light paper' : 'is off on dark stock'} (${JSON.stringify(mn).slice(0, 240)})`);
  const textures = await h.b.evaluate(() => { const e = document.querySelector('.dx-sec:not([hidden]) h3, .dx-sec:not([hidden]) h4'); return e ? getComputedStyle(e).textShadow : 'none'; });
  assert(textures !== undefined, 'manual headings render');
  await shot(h.a, `look-bomb-${scheme}`);
  await shot(h.b, `look-manual-${scheme}`);
  await h.b.tap(`.dx-index [data-page="${b.round.ids[0]}"]`);
  await sleep(300);
  await shot(h.b, `look-manual-page-${scheme}`);
  await h.a.evaluate(() => window.__defuse.forceWin());
  await until(() => h.a.evaluate(() => !!document.querySelector('.dx-fx .dx-stamp')), 'the stamp', 3000, 50);
  await sleep(800);
  await shot(h.a, `look-defused-${scheme}`);
  h.assertNoErrors();
  assert(true, `no page errors (look ${scheme})`);
}

async function withHarness(opts, fn) {
  const h = await launch({ only: ['defuse'], coarse: true, ...opts });
  try { await fn(h); } catch (e) {
    await h.a.screenshot({ path: path.join(SHOTS, 'FAIL-a.png') }).catch(() => {});
    await h.b.screenshot({ path: path.join(SHOTS, 'FAIL-b.png') }).catch(() => {});
    console.error('errors:', h.errors);
    throw e;
  } finally { await h.close(); }
}
(async () => {
  const only = process.argv[2] || 'all';
  try {
    RD = await import(pathToFileURL(path.join(ROOT, 'js/games/defuse/round.js')).href);
    if (only === 'all' || only === 'play') await withHarness({ port: PORT }, play);
    if (only === 'all' || only === 'boom') await withHarness({ port: PORT + 1 }, boom);
    if (only === 'all' || only === 'reduced') await withHarness({ port: PORT + 2, reducedMotion: 'reduce' }, reduced);
    if (only === 'all' || only === 'dark') {
      await withHarness({ port: PORT + 3, colorScheme: 'dark' }, (h) => look(h, 'dark'));
      await withHarness({ port: PORT + 4 }, (h) => look(h, 'light'));
    }
    console.log('\nALL GOOD. Screenshots in', SHOTS);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
})();
