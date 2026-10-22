// Air Hockey, upgrade 2 "flat" unit: smoothness, juice, the printed look and netcode smoothness.
//   node tools/test/games/flat-hockey.test.js          (PORT env = first port, default 9230)
// (a) the table is a cached layer: no layout per frame in play, the DPR is capped at 2 and steps down with quality
// (b) render interpolation: a puck on a 60 Hz screen moves smoothly (second difference of the drawn position)
// (c) juice: a hard hit freezes the sim briefly and shakes the rig a few px; reduced motion switches both off
// (d) riso: the table carries paper grain (light and dark), the ink splat draws at a goal
// (e) netcode under latency 80 / 10 % loss: the partner mallet and the puck are drawn smoothly (jerk and snap counts)
const { launch } = require('../harness');

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const PORT = Number(process.env.PORT) || 9230;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (pg) => pg.evaluate(() => window.__hockeyTest.state());
const metrics = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

async function startLocal(h, pg) {
  await h.startLive(pg, 'hockey', 'local');
  await pg.waitForFunction(() => window.__hockeyTest && window.__hockeyTest.state().phase === 'setup');
  await pg.evaluate(() => window.__hockeyTest.start('classic'));
  await pg.waitForFunction(() => window.__hockeyTest.state().phase === 'play', null, { timeout: 9000 });
}

/** Table-layer pixels: the share of "speckled" card-stock pixels (grain) in a patch of the printed table. */
async function grainStats(pg) {
  return pg.evaluate(() => {
    const cv = document.querySelector('.g-hockey .hk-tbl');
    const x = cv.getContext('2d');
    const w = cv.width; const hh = cv.height;
    const d = x.getImageData(Math.round(w * 0.4), Math.round(hh * 0.5) - 30, 60, 60).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    const all = x.getImageData(0, 0, w, hh).data; let inked = 0;
    for (let i = 3; i < all.length; i += 4) if (all[i] > 0) inked++;
    return { colours: seen.size, filled: inked / (w * hh) };
  });
}

// ── (a) cached layer, DPR cap, dynamic resolution ──
async function cacheTest(h) {
  const pg = h.a;
  await startLocal(h, pg);
  const s0 = await st(pg);
  assert(s0.render.dpr <= 2, `the canvas pixel ratio is capped (dpr ${s0.render.dpr} on a 3x phone)`);
  await pg.evaluate(() => window.__hockeyTest.quality(2));
  const s1 = await st(pg);
  assert(s1.render.dpr < s0.render.dpr, `dynamic resolution steps the canvases down (${s0.render.dpr} -> ${s1.render.dpr})`);
  const bits = await pg.evaluate(() => [...document.querySelectorAll('.g-hockey .hk-live, .g-hockey .hk-tbl, .g-hockey .hk-hud')].map((c) => [c.width, c.height]));
  assert(bits.every(([w, hh]) => w > 0 && hh > 0 && w === bits[0][0]), 'all three layers share one size');
  await pg.evaluate(() => window.__hockeyTest.quality(0));
  // no layout and almost no style recalc while the puck flies and the mallets move
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Performance.enable');
  await pg.evaluate(() => window.__hockeyTest.place(50, 100, 40, 120));
  const m0 = await metrics(cdp); const t0 = Date.now();
  await sleep(2500);
  const m1 = await metrics(cdp); const secs = (Date.now() - t0) / 1000;
  const lps = (m1.LayoutCount - m0.LayoutCount) / secs;
  assert(lps < 2, `no layout per frame while playing (${lps.toFixed(1)} layouts/s)`);
  // the printed table is not repainted by the loop: its canvas pixels are identical a second apart
  const sig = () => pg.evaluate(() => { const c = document.querySelector('.g-hockey .hk-tbl'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let a = 0; for (let i = 0; i < d.length; i += 97) a = (a * 31 + d[i]) | 0; return a; });
  let same = false; let tries = 0;
  while (!same && tries++ < 4) { // (the dynamic resolution may step down once on a busy box, which repaints the table once on purpose)
    const q0 = (await st(pg)).render.quality; const g1 = await sig(); await sleep(700); const g2 = await sig();
    same = g1 === g2 || (await st(pg)).render.quality !== q0;
    if (g1 === g2) break;
    same = false;
  }
  assert(same, 'the printed table layer is static between frames');
  await cdp.detach();
}

// ── (b) interpolation: a puck drawn at 60 Hz from 120 Hz steps ──
async function interpTest(h) {
  const pg = h.a;
  await pg.evaluate(() => window.__hockeyTest.place(30, 60, 55, 90));
  const r = await pg.evaluate(() => new Promise((resolve) => {
    const T = window.__hockeyTest; const pts = []; const t0 = performance.now();
    const f = (t) => { const s = T.state(); if (s.phase === 'play') pts.push([t, s.render.puck.x, s.render.puck.y]); if (t - t0 < 700) requestAnimationFrame(f); else resolve(pts); };
    requestAnimationFrame(f);
  }));
  // speed per frame, normalised by the frame time: a smooth fly has a flat speed (no 2:1 stutter between steps)
  const sp = [];
  for (let i = 1; i < r.length; i++) { const dt = r[i][0] - r[i - 1][0]; if (dt > 4 && dt < 40) sp.push(Math.hypot(r[i][1] - r[i - 1][1], r[i][2] - r[i - 1][2]) / dt * 1000); }
  const mean = sp.reduce((a, b) => a + b, 0) / Math.max(1, sp.length);
  const worst = Math.max(...sp.map((v) => Math.abs(v - mean)));
  assert(sp.length > 15, `sampled ${sp.length} frames`);
  assert(worst < mean * 0.35 + 6, `drawn puck speed is steady frame to frame (mean ${mean.toFixed(0)} u/s, worst deviation ${worst.toFixed(0)})`);
}

// ── (c) juice and reduced motion ──
async function juiceTest(h) {
  const pg = h.a;
  await pg.evaluate(() => window.__hockeyTest.hit(220));
  await pg.waitForTimeout(40);
  const s = await st(pg);
  assert(s.render.held, 'a hard hit holds the sim for a moment (hit-stop)');
  let maxShake = 0;
  for (let i = 0; i < 8; i++) { const sh = await pg.evaluate(() => window.__hockeyTest.shakeNow()); maxShake = Math.max(maxShake, Math.hypot(sh.x, sh.y)); await pg.waitForTimeout(16); }
  assert(maxShake > 0.3 && maxShake < 8, `a hard hit shakes the table a few px (${maxShake.toFixed(1)} px)`);
  await pg.waitForTimeout(500);
  const rest = await pg.evaluate(() => window.__hockeyTest.shakeNow());
  assert(rest.x === 0 && rest.y === 0, 'the shake is over inside half a second');
  assert(!(await st(pg)).render.held, 'and the hit-stop has ended');
  // a goal: ink splat sprite is drawn, flash animation runs
  await pg.evaluate(() => window.__hockeyTest.score('a'));
  await pg.waitForTimeout(250);
  const splat = await pg.evaluate(() => {
    const cv = document.querySelector('.g-hockey .hk-live'); const x = cv.getContext('2d'); const d = x.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return n / (cv.width * cv.height);
  });
  assert(splat > 0.02, `a goal prints an ink splat and stamp on the live layer (${(splat * 100).toFixed(1)} % of the pixels)`);
}

async function reducedTest(h) {
  const pg = h.a;
  await startLocal(h, pg);
  await pg.evaluate(() => window.__hockeyTest.hit(220));
  await pg.waitForTimeout(40);
  const s = await st(pg);
  assert(!s.render.held, 'reduced motion: no hit-stop');
  await pg.waitForTimeout(60);
  const sh = await pg.evaluate(() => window.__hockeyTest.shakeNow());
  assert(sh.x === 0 && sh.y === 0, 'reduced motion: no shake');
  await pg.evaluate(() => window.__hockeyTest.score('b'));
  await pg.waitForTimeout(100);
  const anim = await pg.evaluate(() => document.getAnimations().length);
  assert(anim === 0, `reduced motion: no web animation is started by a goal (${anim})`);
  assert((await pg.evaluate(() => document.querySelector('.g-hockey .hk-rig').style.transform)) === '', 'reduced motion: the rig is never moved');
}

// ── (d) the printed table ──
async function risoTest(h, tag, started) {
  const pg = h.a;
  if (!started) await startLocal(h, pg);
  await pg.waitForTimeout(300);
  const g = await grainStats(pg);
  assert(g.colours >= 6, `${tag}: paper tooth speckles the card stock (${g.colours} distinct colours in a plain patch)`);
  assert(g.filled > 0.5, `${tag}: the table layer is painted (${(g.filled * 100).toFixed(0)} % of it)`);
  await h.shot(pg, `${process.env.SHOTS || '/tmp'}/hockey-flat-${tag}.png`);
}

// ── (e) netcode smoothness ──
// Sampled every frame: the drawn puck (position, and the sim's velocity for it) and the partner's mallet. A "snap" is a frame whose
// puck displacement differs from what its velocity predicts by more than N units; jerk is the second difference of a drawn position.
const SAMPLER = () => {
  const T = window.__hockeyTest; const S = { t: [], pk: [], pm: [], ph: [], sc: [] }; window.__samp = S; window.__sampStop = false;
  const f = (now) => {
    if (window.__sampStop) return; requestAnimationFrame(f);
    const s = T.state(); const pm = s.host ? s.render.mallets.b : s.render.mallets.a;
    S.t.push(now); S.pk.push(s.render.puck.x, s.render.puck.y, s.puck.vx, s.puck.vy); S.pm.push(pm.x, pm.y); S.ph.push(s.phase === 'play' ? 1 : 0); S.sc.push(s.score.a + s.score.b);
  };
  requestAnimationFrame(f);
};
const BOT = (who) => {
  const T = window.__hockeyTest; const cv = document.querySelector('.g-hockey canvas');
  const send = (type, x, y) => { const [cx, cy] = T.toClient(x, y); cv.dispatchEvent(new PointerEvent('pointer' + type, { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: cy, buttons: type === 'up' ? 0 : 1 })); };
  let bx = 50; let by = who === 'a' ? 150 : 20; let down = false; let last = performance.now(); let next = last + 1500;
  window.__botStop = false;
  const f = () => {
    if (window.__botStop) return; requestAnimationFrame(f);
    const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const P = T.state().puck; const host = T.state().host;
    if (host && now > next) { next = now + 1700; T.place(20 + Math.random() * 60, 85 + (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 70, (Math.random() < 0.5 ? -1 : 1) * 110); }
    const mine = who === 'a' ? P.y > 80 : P.y < 90;
    let tx = 50 + 24 * Math.sin(now / 900); let ty = who === 'a' ? 148 : 22;
    if (mine) { tx = P.x; ty = who === 'a' ? P.y + 9 : P.y - 9; }
    const dx = tx - bx; const dy = ty - by; const d = Math.hypot(dx, dy); const stp = 260 * dt;
    if (d > stp) { bx += (dx / d) * stp; by += (dy / d) * stp; } else { bx = tx; by = ty; }
    send(down ? 'move' : 'down', bx, by); down = true;
  };
  f();
};
const q = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
function analyse(S) {
  const n = S.t.length; const res = []; const mD2 = []; const pD2 = []; let hit = 0;
  for (let i = 2; i < n; i++) {
    if (!S.ph[i] || !S.ph[i - 1] || !S.ph[i - 2] || S.sc[i] !== S.sc[i - 2]) continue;
    const dt = S.t[i] - S.t[i - 1]; if (dt > 34 || dt < 4) continue;
    const j = 4 * (i - 1);
    const dx = S.pk[4 * i] - S.pk[j]; const dy = S.pk[4 * i + 1] - S.pk[j + 1];
    const r = Math.hypot(dx - S.pk[j + 2] * dt / 1000, dy - S.pk[j + 3] * dt / 1000);
    if (Math.hypot(dx, dy) > 60) { hit++; continue; } // the host's test hook put the puck somewhere else on purpose
    res.push(r);
    pD2.push(Math.hypot(S.pk[4 * i] - 2 * S.pk[j] + S.pk[j - 4], S.pk[4 * i + 1] - 2 * S.pk[j + 1] + S.pk[j - 3]));
    const a = 2 * i; mD2.push(Math.hypot(S.pm[a] - 2 * S.pm[a - 2] + S.pm[a - 4], S.pm[a + 1] - 2 * S.pm[a - 1] + S.pm[a - 3]));
  }
  res.sort((x, y) => x - y); pD2.sort((x, y) => x - y); mD2.sort((x, y) => x - y);
  const f = (v) => +v.toFixed(2);
  return {
    frames: res.length, placed: hit, puckResP99: f(q(res, 0.99)), puckResMax: f(res[res.length - 1] || 0), puckSnaps5: res.filter((x) => x > 5).length, puckSnaps10: res.filter((x) => x > 10).length,
    puckD2P99: f(q(pD2, 0.99)), partnerD2P99: f(q(mD2, 0.99)), partnerD2Max: f(mD2[mD2.length - 1] || 0),
  };
}
async function netTest(port) {
  const h = await launch({ port, only: ['hockey'], latency: 80, dropRate: 0.1, coarse: true });
  try {
    await h.startLive(h.a, 'hockey', 'live'); await h.settle();
    await h.b.click('#gm-invite [data-g="invite-yes"]'); await h.settle(); await h.settle();
    await h.a.waitForFunction(() => window.__hockeyTest && window.__hockeyTest.state().phase === 'setup');
    await h.a.evaluate(() => window.__hockeyTest.start('classic'));
    for (const pg of [h.a, h.b]) await pg.waitForFunction(() => window.__hockeyTest.state().phase === 'play', null, { timeout: 9000 });
    await h.a.evaluate(SAMPLER); await h.b.evaluate(SAMPLER);
    await h.a.evaluate(BOT, 'a'); await h.b.evaluate(BOT, 'b');
    await sleep(Number(process.env.SECS) * 1000 || 12000);
    for (const pg of [h.a, h.b]) await pg.evaluate(() => { window.__botStop = true; window.__sampStop = true; });
    const sa = analyse(await h.a.evaluate(() => window.__samp));
    const sb = analyse(await h.b.evaluate(() => window.__samp));
    console.log('host  renders', JSON.stringify(sa)); console.log('guest renders', JSON.stringify(sb));
    assert(sb.frames > 200 && sa.frames > 200, 'both phones sampled the rally');
    assert(sb.puckSnaps10 <= 6, `the guest's puck rarely jumps (${sb.puckSnaps10} frames off by more than 10 u)`);
    assert(sb.puckResP99 < 8, `the guest's puck follows its own velocity (p99 residual ${sb.puckResP99} u)`);
    assert(sb.partnerD2P99 < 12 && sa.partnerD2P99 < 12, `the partner's mallet is interpolated (p99 jerk guest ${sb.partnerD2P99} / host ${sa.partnerD2P99} u)`);
    h.assertNoErrors();
  } finally { await h.close(); }
}

(async () => {
  for (const [i, [tag, opts]] of [['light', {}], ['dark', { colorScheme: 'dark' }]].entries()) {
    const h = await launch({ port: PORT + i, only: ['hockey'], coarse: true, ...opts });
    try {
      if (!i) { await cacheTest(h); await interpTest(h); await juiceTest(h); }
      await risoTest(h, tag, !i);
      h.assertNoErrors();
    } finally { await h.close(); }
  }
  {
    const h = await launch({ port: PORT + 2, only: ['hockey'], coarse: true, reducedMotion: 'reduce' });
    try { await reducedTest(h); h.assertNoErrors(); } finally { await h.close(); }
  }
  await netTest(PORT + 3);
  console.log('\nALL GOOD');
})().catch((e) => { console.error(e); process.exit(1); });
