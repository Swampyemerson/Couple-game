// Getaway — end-to-end tests.
//   node tools/test/games/getaway.test.js                 (every section)
//   ONLY=unit,practice node tools/test/games/getaway.test.js
// Sections: unit (physics in Node) · practice (one phone vs the AI: intro, countdown, PIT bust,
// spikes, timer + heat escapes, water bust, final) · live (two phones: join, settings sync,
// roles, synced start, traffic determinism, boxed bust, spikes over the network, swaps, final,
// one recorded result, rematch) · lossy (150 ms, 25 % drops) · split (laptop split screen) ·
// robust (pause on hidden, GL context loss, leaks) · perf (every playable map, phone + laptop)
// · shots (390×844, 844×390, 1280×800, light + dark). Ports 8930–8939 (PORT=… moves them).
// Screenshots: $SHOTS (default: the session scratchpad getaway/ folder).
const fs = require('fs');
const path = require('path');
const { launch, ROOT } = require('../harness');

const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-Couple-game/0bac2931-fb3f-54c3-8279-c15850ed70e8/scratchpad/getaway';
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = Number(process.env.PORT) || 8930;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
let fails = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const soft = (c, m) => { if (!c) { fails++; console.log('not ok -', m); } else console.log('ok -', m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FAST = { intro: 900, count: 1200, result: 1800, final: 900, resume: 1500, maxDpr: 0.6, heatT: 1.6 };

const st = (p) => p.evaluate(() => window.__getaway && window.__getaway.state());
const hook = (p, fn, ...args) => p.evaluate(([f, a]) => window.__getaway[f](...a), [fn, args]);
async function until(p, fn, arg, ms = 20000, what = 'condition') {
  try { await p.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); } catch {
    const s = await st(p).catch(() => null);
    throw new Error('FAIL: timed out waiting for ' + what + ' ' + JSON.stringify(s && { phase: s.phase, paused: s.paused, R: s.R && { idx: s.R.idx, over: s.R.over, result: s.R.result }, a: s.a && { x: s.a.x, z: s.a.z, sp: s.a.speed, hp: s.a.hp }, b: s.b && { x: s.b.x, z: s.b.z, sp: s.b.speed, hp: s.b.hp } }));
  }
}
const phase = (p, ph, ms = 20000) => until(p, (x) => window.__getaway && window.__getaway.state().phase === x, ph, ms, 'phase ' + ph);
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, name + '.png') });
async function arm(p, tune = FAST) { await p.evaluate((t) => { window.__gtwTest = true; window.__gtwTune = t; try { localStorage.removeItem('getaway.setup.v1'); localStorage.removeItem('getaway.device.v1'); } catch { /* ignore */ } }, tune); }
async function ready(p) { await until(p, () => window.__getaway && window.__getaway.ready, null, 90000, 'game ready'); }
const round = (p) => p.evaluate(() => window.__getaway.state().R);

(async () => {
  // ═══ unit: the physics, straight from the modules ═══
  if (want('unit')) {
    const url = (f) => 'file://' + path.join(ROOT, 'js/games/getaway', f);
    const { createGeo } = await import(url('geo.js'));
    const { newCar, placeCar, stepCar, carContact, judgePit } = await import(url('car.js'));
    const { CAR, NITRO, DT } = await import(url('tune.js'));
    const { createTraffic } = await import(url('traffic.js'));
    const { DOCKSIDE } = await import(url('maps/dockside.js'));
    const flat = { id: 't', bounds: { x0: -2000, z0: -2000, x1: 2000, z1: 2000 }, roads: [{ name: 'r', kind: 'highway', width: 3000, pts: [[-1900, 0], [1900, 0]] }], solids: [{ kind: 'building', x: 0, z: -300, w: 200, d: 0.3, rot: 0.2, h: 10 }, { kind: 'pole', x: 0, z: 300, w: 0.4, d: 0.4 }] };
    const geo = createGeo(flat);
    const run = (role, inp, secs, setup) => { const c = newCar(role); placeCar(c, 0, 0, Math.PI / 2, geo); if (setup) setup(c); const out = []; for (let i = 0; i < secs / DT; i++) { stepCar(c, typeof inp === 'function' ? inp(c, i * DT) : inp, DT, geo, CAR[role], NITRO.normal); out.push({ t: i * DT, v: c.speed, x: c.x, z: c.z, r: c.r, slip: c.slip, ev: c.ev.splice(0) }); } return { c, out }; };
    const acc = run('runner', { gas: 1 }, 25).out;
    const t100 = acc.find((o) => o.v >= 27.78).t; const top = acc.at(-1).v * 3.6;
    assert(t100 > 2.6 && t100 < 4.5, `runner 0–100 km/h in ${t100.toFixed(2)} s`);
    assert(top > 150 && top < 175, `runner top speed ${top.toFixed(0)} km/h`);
    const ctop = run('cop', { gas: 1 }, 25).out.at(-1).v * 3.6;
    assert(ctop >= top - 1 && ctop < top + 10, `cop top speed ${ctop.toFixed(0)} km/h (a touch faster in a straight line)`);
    const nit = run('runner', { gas: 1, nitro: true }, 3).out.at(-1).v; const non = acc[Math.round(3 / DT) - 1].v;
    assert(nit > non + 3, `nitro: ${(non * 3.6).toFixed(0)} → ${(nit * 3.6).toFixed(0)} km/h after 3 s`);
    const br = run('runner', { hand: true }, 5, (c) => { c.vx = 40; }).out; const stop = br.find((o) => o.v < 0.2);
    assert(stop && stop.x < 60, `brakes: 144 km/h to a stop in ${stop.t.toFixed(2)} s / ${stop.x.toFixed(0)} m`);
    const turn = (v) => { const o = run('runner', (c) => ({ gas: c.vf < v ? 1 : 0, steer: 1 }), 8, (c) => { c.vx = v; }).out.slice(-240); const sp = o.reduce((a, q) => a + q.v, 0) / o.length; const r = o.reduce((a, q) => a + Math.abs(q.r), 0) / o.length; return { sp, radius: sp / r, g: (sp * r) / 9.81, slip: o.at(-1).slip }; };
    const t12 = turn(12); const t25 = turn(25);
    assert(t12.radius < 12 && t12.g > 1.3, `full lock at 43 km/h: radius ${t12.radius.toFixed(1)} m, ${t12.g.toFixed(2)} g`);
    assert(t25.g > 1.2 && t25.g < 2.4 && t25.slip < 2.5, `full lock at 90 km/h carves (${t25.g.toFixed(2)} g, slip ${t25.slip.toFixed(1)} m/s) without spinning out`);
    const hb = run('runner', (c, t) => ({ gas: t < 3 ? 1 : 0, steer: t > 3 ? 1 : 0, hand: t > 3 && t < 4 }), 4.2).out;
    const yaw0 = hb[Math.round(3 / DT)]; let yawD = 0; for (let i = Math.round(3 / DT); i < hb.length; i++) yawD += hb[i].r * DT;
    assert(yawD * 57.3 > 55 && Math.max(...hb.slice(Math.round(3 / DT)).map((o) => o.slip)) > 3, `handbrake drift: ${(yawD * 57.3).toFixed(0)}° in 1.2 s with a slide (from ${(yaw0.v * 3.6).toFixed(0)} km/h)`);
    // walls: never tunnel, even at 60 m/s into a 0.3 m wall
    for (const v of [30, 50, 60]) {
      const o = run('runner', { gas: 1 }, 2, (c) => { c.x = 0; c.z = -250; c.yaw = 0.2; c.vx = Math.sin(0.2) * v; c.vz = -Math.cos(0.2) * v; }).out;
      // distance of the car's centre in front of the wall (wall-local z; the wall is 0.3 m thick, rotated 0.2 rad)
      const lz = (q) => (q.x - 0) * Math.sin(0.2) + (q.z + 300) * Math.cos(0.2);
      const minL = Math.min(...o.map(lz)); const hits = o.reduce((a, q) => a + q.ev.filter((e) => e.t === 'wall').length, 0);
      assert(minL > 1.0 && hits >= 1, `wall at ${v} m/s (${(v * 3.6).toFixed(0)} km/h): the car stops ${minL.toFixed(2)} m from the wall's centre line, never through it`);
    }
    // slide along a wall at a shallow angle: keeps most of the speed
    const sl = run('runner', { gas: 1 }, 1.5, (c) => { c.x = 0; c.z = -296; c.yaw = Math.PI / 2 - 0.25; c.vx = 30; c.vz = -6; }).out.at(-1);
    assert(sl.v > 18, `glancing a wall slides along it (${sl.v.toFixed(1)} m/s after 1.5 s)`);
    // breakables: a fast hit knocks a pole over
    const pole = run('runner', { gas: 1 }, 1.5, (c) => { c.x = 0; c.z = 270; c.yaw = Math.PI; c.vz = 25; }).out;
    assert(pole.some((q) => q.ev.some((e) => e.t === 'break')) && pole.at(-1).z > 300, 'a fast hit knocks a pole over and drives through');
    // PIT judging
    const runner = newCar('runner'); placeCar(runner, 0, 0, Math.PI / 2, geo); runner.vx = 20;
    const ct = {};
    const cop = newCar('cop'); placeCar(cop, -3.2, -1.9, Math.PI / 2 + 0.15, geo); cop.vx = 22; cop.vz = 3.3;
    assert(carContact(runner, cop, ct) > 0 && judgePit(runner, cop, ct) !== 0, `a push on the rear quarter from the side at speed is a PIT (side ${judgePit(runner, cop, ct)})`);
    const ram = newCar('cop'); placeCar(ram, -4.4, 0, Math.PI / 2, geo); ram.vx = 26;
    assert(carContact(runner, ram, ct) > 0 && judgePit(runner, ram, ct) === 0, 'a straight rear-end shunt is a ram, not a PIT');
    const tb = newCar('cop'); placeCar(tb, 0, -3.0, Math.PI, geo); tb.vz = 15;
    assert(carContact(runner, tb, ct) > 0 && judgePit(runner, tb, ct) === 0, 'a T-bone is not a PIT');
    const slow = newCar('runner'); placeCar(slow, 0, 0, Math.PI / 2, geo); slow.vx = 3;
    assert(carContact(slow, cop, ct) > 0 && judgePit(slow, cop, ct) === 0, 'no PIT on a crawling car');
    // Dockside geometry + determinism of traffic
    const dg = createGeo(DOCKSIDE);
    for (const [i, s] of DOCKSIDE.spawns.entries()) {
      assert(dg.surfaceAt(s.runner.x, s.runner.z) === 'road' && dg.surfaceAt(s.cop.x, s.cop.z) === 'road', `Dockside spawn ${i}: both cars on a road`);
      const d = Math.hypot(s.runner.x - s.cop.x, s.runner.z - s.cop.z); assert(d >= 60 && d <= 100, `Dockside spawn ${i}: cop ${d.toFixed(0)} m behind`);
    }
    assert(dg.surfaceAt(206, 100) === 'water' && dg.surfaceAt(-300, 430) === 'sand' && dg.surfaceAt(-120, 110) === 'grass', 'surfaces: canal is water, beach is sand, the park is grass');
    const t1 = createTraffic(dg, 'dockside', 'normal'); const t2 = createTraffic(createGeo(DOCKSIDE), 'dockside', 'normal');
    assert(t1.total > 30 && t1.hash(123.4) === t2.hash(123.4) && t1.hash(10) !== t1.hash(11), `traffic is a pure function of time (${t1.total} cars; same hash from two builds)`);
    const light = createTraffic(dg, 'dockside', 'light'); const off = createTraffic(dg, 'dockside', 'off');
    assert(light.total < t1.total && off.total === 0, `traffic density: off ${off.total}, light ${light.total}, normal ${t1.total}`);
    // bridge decks: a car driving onto a bridge from its end rides the deck over the canal
    const deck = run('runner', { gas: 0.5 }, 6, (c) => { placeCar(c, 140, 180, Math.PI / 2, dg); c.vx = 14; });
    void deck;
    const c2 = newCar('runner'); placeCar(c2, 150, 180, Math.PI / 2, dg); c2.vx = 15;
    let maxY = 0; let wet = false;
    for (let i = 0; i < 7 / DT; i++) { stepCar(c2, { gas: 0.4 }, DT, dg, CAR.runner, NITRO.normal); maxY = Math.max(maxY, c2.y); if (c2.water) wet = true; c2.ev.length = 0; }
    assert(maxY > 1.5 && !wet && c2.x > 250, `drives over the canal bridge on the deck (peak ${maxY.toFixed(1)} m) and stays dry`);
    const c3 = newCar('runner'); placeCar(c3, 206, 120, Math.PI, dg); c3.vz = 10;
    stepCar(c3, { gas: 0 }, DT, dg, CAR.runner, NITRO.normal);
    assert(c3.water && c3.level < 0, 'driving in the canal under a bridge is water (busts a runner)');
    const path1 = (() => { while (dg.buildNav(1e9) < 1); return dg.findPath(-100, 40, 340, -100); })();
    assert(path1 && path1.length > 20, `AI nav: a path across Dockside (${path1.length / 2} cells)`);
  }

  // ═══ one phone vs the AI ═══
  if (want('practice')) {
    const h = await launch({ port: PORT, only: ['getaway'], who: ['a'], coarse: true });
    const { a } = h;
    try {
      await arm(a, { ...FAST, rounds: 4 });
      await h.startLive(a, 'getaway', 'local');
      await ready(a);
      let s = await st(a);
      assert(s.phase === 'lobby' && s.localMode === 'ai' && s.mapId === 'dockside', 'one phone opens on the lobby, practice vs AI, Dockside');
      assert(await a.isVisible('.g-gtw [data-l="lmode"][data-v="split"][disabled]'), 'split screen is offered only on laptops');
      await a.click('.g-gtw [data-l="start"]');
      await phase(a, 'intro', 8000);
      assert(await a.isVisible('.g-gtw .gtw-roles'), 'round intro card: map, round, roles');
      await phase(a, 'count', 8000);
      await until(a, () => /^[123]$/.test(document.querySelector('.g-gtw .gtw-count').textContent), null, 4000, 'countdown digit');
      console.log('ok - 3-2-1 countdown');
      await phase(a, 'chase', 8000);
      s = await st(a);
      assert(s.a.role === 'runner' && s.b.role === 'cop', 'you run first, the AI chases');
      // the AI cop drives (path planning on the nav grid)
      await until(a, () => window.__getaway.navReady(), null, 20000, 'nav grid');
      const d0 = Math.hypot(s.a.x - s.b.x, s.a.z - s.b.z);
      await hook(a, 'hold', 'a', { hand: true });
      await wait(2600);
      s = await st(a);
      const d1 = Math.hypot(s.a.x - s.b.x, s.a.z - s.b.z);
      await hook(a, 'hold', 'b', { hand: true });
      await a.evaluate(() => window.__getaway.teleport('b', -330, 40, Math.PI / 2, 0)); // parked within the heat range
      assert(s.b.top > 8 && d1 < d0 - 15, `the AI cop drives at you (${d0.toFixed(0)} → ${d1.toFixed(0)} m, top ${(s.b.top * 3.6).toFixed(0)} km/h)`);
      // touch: steering slider + gas pedal (real pointer events)
      await hook(a, 'hold', 'a', null);
      await hook(a, 'teleport', 'a', -300, 40, Math.PI / 2, 0);
      const gas = await a.$('.g-gtw [data-pad="gas"]'); const gb = await gas.boundingBox();
      await a.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 31, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true })); }, [gb.x + gb.width / 2, gb.y + gb.height / 2]);
      await wait(1500);
      const sp1 = (await st(a)).a.speed;
      await a.evaluate(([x, y]) => { window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31, pointerType: 'touch', clientX: x, clientY: y, bubbles: true })); }, [gb.x + gb.width / 2, gb.y + gb.height / 2]);
      assert(sp1 > 6, `holding the GAS pedal accelerates (${(sp1 * 3.6).toFixed(0)} km/h)`);
      const steer0 = await a.evaluate(() => window.__getaway.internals.P2.a.pad.touchSteer);
      await a.evaluate(async () => {
        const sf = document.querySelector('.g-gtw .gtw-surface'); const r = sf.getBoundingClientRect();
        const mk = (t, x) => new PointerEvent(t, { pointerId: 32, pointerType: 'touch', clientX: x, clientY: r.top + r.height * 0.8, bubbles: true, cancelable: true });
        sf.dispatchEvent(mk('pointerdown', 100)); for (let i = 1; i <= 5; i++) { await new Promise((q) => setTimeout(q, 20)); window.dispatchEvent(mk('pointermove', 100 + i * 14)); }
        window.__steerProbe = window.__getaway.internals.P2.a.pad.touchSteer;
        window.dispatchEvent(mk('pointerup', 170));
      });
      const probe = await a.evaluate(() => window.__steerProbe);
      assert(steer0 === 0 && probe > 0.7, `the steering slider follows the thumb (${probe.toFixed(2)} at +70 px)`);
      const ign = (await hook(a, 'inputStats')).ignored;
      await a.evaluate(() => { const sf = document.querySelector('.g-gtw .gtw-surface'); const r = sf.getBoundingClientRect(); sf.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 33, pointerType: 'touch', clientX: r.left + 8, clientY: r.top + r.height * 0.7, bubbles: true, cancelable: true })); window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 33, pointerType: 'touch', bubbles: true })); });
      assert((await hook(a, 'inputStats')).ignored === ign + 1, 'a touch on the left edge (iOS back gesture) is ignored');
      { const s0 = await st(a); if (s0.R.idx !== 0) console.log('   DEBUG round 0 ended early:', JSON.stringify(s0.match.hist)); }
      // scripted PIT: the cop hits the runner's rear quarter from the side at speed
      await hook(a, 'hold', 'b', { gas: 0.4 }); await hook(a, 'hold', 'a', { gas: 0.35 });
      await a.evaluate(() => { const g = window.__getaway; g.teleport('a', -300, 40, Math.PI / 2, 20); g.teleport('b', -303.2, 38.1, Math.PI / 2 + 0.15, 23); });
      await until(a, () => window.__getaway.state().a.stats.pits >= 1, null, 5000, 'PIT');
      s = await st(a);
      assert(s.a.hp <= 80, `PIT! runner spun, ${(100 - s.a.hp).toFixed(0)} damage`);
      await shot(a, 'practice-pit');
      // box them in: runner stopped, cop alongside → busted after 3 s
      await hook(a, 'hold', 'a', { hand: true }); await hook(a, 'hold', 'b', { hand: true });
      await a.evaluate(() => { const g = window.__getaway; const s = g.state(); g.teleport('b', s.a.x - 7, s.a.z, s.a.yaw, 0); g.setCar('a', { vx: 0, vz: 0, r: 0 }); });
      await until(a, () => { const R = window.__getaway.state().R; return R && R.over; }, null, 8000, 'busted');
      s = await st(a);
      assert(s.R.result.outcome === 'busted' && s.R.result.reason === 'boxed', `BUSTED: boxed in after the PIT (${s.R.result.reason})`);
      await wait(1300); await shot(a, 'practice-busted');
      // round 2: roles swap, you are the cop
      await until(a, () => window.__getaway.state().R.idx === 1, null, 12000, 'round 2');
      await phase(a, 'chase', 12000);
      s = await st(a);
      assert(s.a.role === 'cop' && s.b.role === 'runner' && s.a.spikesLeft === 3, 'round 2: roles swapped; you are the cop with 3 spike strips');
      // spikes: placement rules
      await hook(a, 'hold', 'a', { hand: true }); await hook(a, 'hold', 'b', { hand: true });
      await a.evaluate(() => { const g = window.__getaway; g.teleport('a', -360, 40, Math.PI / 2, 0); g.teleport('b', -200, 40, Math.PI / 2, 0); });
      await wait(200);
      assert(/far/i.test(await hook(a, 'mapTap', 300, 40)), 'a strip more than 400 m away is refused');
      assert(/close/i.test(await hook(a, 'mapTap', -195, 40)), 'a strip on top of the runner is refused');
      assert(/road/i.test(await hook(a, 'mapTap', -400, 520)), 'a strip away from any road is refused');
      assert((await hook(a, 'mapTap', -120, 41)) === true && (await st(a)).a.spikesLeft === 2, 'a strip ahead of the runner snaps to the road (2 left)');
      await hook(a, 'openMap'); await wait(400); await shot(a, 'practice-map'); await hook(a, 'closeMap');
      await wait(1400); // deploys after 1.2 s
      await hook(a, 'hold', 'b', { gas: 1 });
      await a.evaluate(() => window.__getaway.teleport('b', -160, 40, Math.PI / 2, 22));
      await until(a, () => window.__getaway.state().b.flat > 0, null, 6000, 'tyres popped');
      s = await st(a);
      const sp = s.R.spikes[0];
      assert(sp.gone && s.b.stats.spikes === 1, 'driving over it pops the tyres; the strip is used up');
      await hook(a, 'hold', 'a', { gas: 1 });
      await a.evaluate(() => { const g = window.__getaway; g.teleport('a', -100, 40 + 3.2, Math.PI / 2, 0); });
      await wait(600);
      assert((await st(a)).a.flat === 0, 'the cop is immune to its own strips');
      // a flat runner is slower
      const flatTop = await a.evaluate(async () => { const g = window.__getaway; g.teleport('b', -440, 40, Math.PI / 2, 0); g.hold('b', { gas: 1 }); await new Promise((r) => setTimeout(r, 2500)); return g.state().b.speed; });
      void flatTop;
      // escape by the clock
      await hook(a, 'shortenRound', 1500);
      await until(a, () => { const R = window.__getaway.state().R; return R && R.over; }, null, 8000, 'timer escape');
      s = await st(a);
      assert(s.R.result.outcome === 'escaped' && s.R.result.reason === 'time', 'ESCAPED when the clock runs out');
      // round 3: escape by losing the heat (far away, out of sight)
      await until(a, () => window.__getaway.state().R.idx === 2, null, 12000, 'round 3');
      await phase(a, 'chase', 12000);
      await hook(a, 'hold', 'a', { hand: true }); await hook(a, 'hold', 'b', { hand: true });
      await a.evaluate(() => { const g = window.__getaway; g.teleport('a', -420, -240, Math.PI / 2, 0); g.teleport('b', 380, 320, Math.PI / 2, 0); });
      await until(a, () => window.__getaway.state().a.esc > 0.3, null, 6000, 'escape meter fills');
      await shot(a, 'practice-heat');
      await until(a, () => { const R = window.__getaway.state().R; return R && R.over; }, null, 8000, 'heat escape');
      s = await st(a);
      assert(s.R.result.outcome === 'escaped' && s.R.result.reason === 'heat', 'ESCAPED by losing the heat (far away, no line of sight)');
      // round 4: the cop's turn again; the runner drives into the canal
      await until(a, () => window.__getaway.state().R.idx === 3, null, 12000, 'round 4');
      await phase(a, 'chase', 12000);
      await hook(a, 'hold', 'b', { gas: 0.3 });
      await a.evaluate(() => window.__getaway.teleport('b', 206, 100, Math.PI, 8));
      await until(a, () => { const R = window.__getaway.state().R; return R && R.over; }, null, 8000, 'splash');
      s = await st(a);
      assert(s.R.result.outcome === 'busted' && s.R.result.reason === 'water', 'driving into the canal busts the runner (SPLASH)');
      await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 15000, 'end card');
      s = await st(a);
      assert(s.result && s.result.winner === null && /AI|Practice/.test(s.result.text), `practice ends with "${s.result.text}" (no real winner recorded)`);
      await shot(a, 'practice-end');
      h.assertNoErrors();
    } catch (e) { fails++; console.error(e.message); await shot(h.a, 'practice-fail').catch(() => {}); } finally { await h.close(); }
  }

  // ═══ two phones, live ═══
  async function openPair(h, tune) {
    const { a, b } = h;
    for (const p of [a, b]) await arm(p, tune);
    await h.startLive(a, 'getaway', 'live');
    await h.settle();
    const invited = await b.isVisible('#gm-invite').catch(() => false);
    if (invited) await b.click('#gm-invite [data-g="invite-yes"]'); else await h.startLive(b, 'getaway', 'live');
    await ready(a); await ready(b);
    await until(b, () => window.__getaway.state().linked, null, 30000, 'guest linked');
    await until(a, () => window.__getaway.state().linked, null, 30000, 'host linked');
  }
  async function startMatch(h) {
    const { a, b } = h;
    await until(a, () => { const p = window.__getaway.state().partnerSeen; return p && p.ph === 1 && p.sv >= 1; }, null, 30000, 'guest in the lobby with the map loaded');
    await a.click('.g-gtw [data-l="start"]');
    await until(b, () => ['intro', 'count', 'chase', 'wait'].includes(window.__getaway.state().phase), null, 15000, 'guest starts');
  }
  async function waitOver(h, idx, ms = 15000) {
    for (const p of [h.a, h.b]) await until(p, (i) => { const s = window.__getaway.state(); return s.R && (s.R.idx > i || (s.R.idx === i && s.R.over)) || s.phase === 'final'; }, idx, ms, 'round ' + idx + ' over');
  }

  if (want('live')) {
    const h = await launch({ port: PORT + 1, only: ['getaway'], latency: 80, coarse: true });
    const { a, b } = h;
    try {
      await openPair(h, { ...FAST, rounds: 4 });
      // settings: the host edits, the guest sees it live
      await a.click('.g-gtw [data-l="settings"]');
      await a.click('.g-gtw [data-l="rule"][data-k="spikes"][data-step="1"]');
      await a.click('.g-gtw [data-l="rule"][data-k="traffic"][data-step="-1"]');
      await until(b, () => { const r = window.__getaway.state().setup.rules; return r.spikes === 4 && r.traffic === 'light'; }, null, 8000, 'guest sees the settings');
      console.log('ok - the guest sees the host change spikes and traffic live');
      await b.click('.g-gtw [data-l="settings"]');
      assert(await b.isVisible('.g-gtw .gtw-sheet .gtw-ro'), 'the guest’s settings sheet is read-only');
      await shot(b, 'live-guest-settings');
      await b.click('.g-gtw [data-l="sheetclose"]'); await a.click('.g-gtw [data-l="sheetclose"]');
      await startMatch(h);
      const ra = await round(a); const rb = await round(b);
      assert(ra.t0 === rb.t0 && ra.endAt === rb.endAt && ra.runner === 'a', 'both phones share the round timeline; Emerson runs first');
      await phase(a, 'chase'); await phase(b, 'chase');
      let sa = await st(a); let sb = await st(b);
      assert(sa.a.role === 'runner' && sb.b.role === 'cop' && sb.b.spikesLeft === 4, 'roles: Emerson runner, Sydney cop with 4 strips');
      // traffic determinism across devices
      const th = await Promise.all([hook(a, 'trafficHash', 77.7), hook(b, 'trafficHash', 77.7)]);
      const tc = await Promise.all([hook(a, 'trafficCount'), hook(b, 'trafficCount')]);
      assert(tc[0] > 0 && tc[0] === tc[1] && th[0] === th[1], `traffic identical on both phones (${tc[0]} cars, hash ${th[0]})`);
      const nearA = await hook(a, 'trafficNear', -100, 40, 300, 88.8); const nearB = await hook(b, 'trafficNear', -100, 40, 300, 88.8);
      assert(JSON.stringify(nearA) === JSON.stringify(nearB), `the same cars in the same places at the same moment (${nearA.length} near spawn)`);
      // the partner car shows up where it really is
      await hook(a, 'hold', 'a', { hand: true }); await hook(b, 'hold', 'b', { hand: true });
      await a.evaluate(() => window.__getaway.teleport('a', -100, 40, Math.PI / 2, 0));
      await wait(1200);
      sb = await st(b);
      assert(Math.hypot(sb.partnerSeen.shown.x + 100, sb.partnerSeen.shown.z - 40) < 1.5, `the cop’s phone draws the runner where it is (${JSON.stringify(sb.partnerSeen.shown)})`);
      // both drive (bots) for a bit
      await hook(a, 'auto', 'a', true); await hook(b, 'auto', 'b', true);
      await wait(5000);
      await shot(a, 'live-runner'); await shot(b, 'live-cop');
      sa = await st(a); sb = await st(b);
      assert(Math.hypot(sa.a.x - sb.partnerSeen.shown.x, sa.a.z - sb.partnerSeen.shown.z) < 8, `dead reckoning keeps the remote car close (${Math.hypot(sa.a.x - sb.partnerSeen.shown.x, sa.a.z - sb.partnerSeen.shown.z).toFixed(1)} m behind the truth)`);
      await hook(a, 'auto', 'a', false); await hook(b, 'auto', 'b', false);
      // boxed in: the runner's phone decides, using the predicted cop
      await hook(a, 'hold', 'a', { hand: true }); await hook(b, 'hold', 'b', { hand: true });
      await a.evaluate(() => window.__getaway.teleport('a', -100, 40, Math.PI / 2, 0));
      await b.evaluate(() => window.__getaway.teleport('b', -109, 40, Math.PI / 2, 0));
      await waitOver(h, 0);
      sa = await st(a); sb = await st(b);
      if (!sa.match.hist[0] || !sb.match.hist[0]) console.log('DEBUG', JSON.stringify([sa.phase, sa.R, sa.match, sb.phase, sb.R, sb.match]));
      assert(sa.match.hist[0].outcome === 'busted' && sb.match.hist[0].outcome === 'busted' && sa.match.hist[0].reason === 'boxed', 'BUSTED (boxed) on both phones');
      assert(sa.match.scores.b === 1 && sb.match.scores.b === 1, `Sydney scores the bust on both phones (${JSON.stringify([sa.match.scores, sb.match.scores, sa.match.hist, sb.match.hist])})`);
      await wait(1300); await shot(a, 'live-busted-runner'); await shot(b, 'live-busted-cop');
      // round 2: swap
      await until(a, () => window.__getaway.state().R.idx === 1, null, 15000, 'round 2 (host)');
      await until(b, () => window.__getaway.state().R.idx === 1, null, 15000, 'round 2 (guest)');
      await phase(a, 'chase', 15000); await phase(b, 'chase', 15000);
      sa = await st(a);
      assert(sa.R.runner === 'b' && sa.a.role === 'cop' && sa.a.spikesLeft === 4, 'round 2: roles swapped');
      // spikes over the network
      await hook(a, 'hold', 'a', { hand: true }); await hook(b, 'hold', 'b', { hand: true });
      await b.evaluate(() => window.__getaway.teleport('b', -300, 40, Math.PI / 2, 0));
      await a.evaluate(() => window.__getaway.teleport('a', -380, 40, Math.PI / 2, 0));
      await wait(900);
      const placed = await hook(a, 'mapTap', -200, 40);
      assert(placed === true, 'the cop drops a strip from the map');
      await until(b, () => window.__getaway.state().R.spikes.length === 1, null, 5000, 'guest has the strip');
      await wait(1500);
      await hook(b, 'hold', 'b', { gas: 1 });
      await b.evaluate(() => window.__getaway.teleport('b', -240, 40, Math.PI / 2, 22));
      await until(b, () => window.__getaway.state().b.flat > 0, null, 6000, 'runner popped');
      await until(a, () => { const s = window.__getaway.state(); return s.R.spikes[0].gone && s.a.stats.spikes >= 1; }, null, 6000, 'cop hears the strip hit');
      console.log('ok - the runner’s phone pops its tyres; the cop’s phone hears about it');
      await shot(b, 'live-spiked');
      // escape by the clock (decided by the runner's phone)
      await hook(a, 'shortenRound', 1500);
      await waitOver(h, 1);
      sa = await st(a); sb = await st(b);
      assert(sa.match.hist[1].reason === 'time' && sb.match.hist[1].reason === 'time' && sa.match.scores.b === 2, 'ESCAPED by the clock, on both phones');
      // round 3: Emerson runs and loses the heat
      await until(a, () => window.__getaway.state().R.idx === 2, null, 15000, 'round 3');
      await phase(a, 'chase', 15000); await phase(b, 'chase', 15000);
      await hook(a, 'hold', 'a', { hand: true }); await hook(b, 'hold', 'b', { hand: true });
      await a.evaluate(() => window.__getaway.teleport('a', -420, -240, Math.PI / 2, 0));
      await b.evaluate(() => window.__getaway.teleport('b', 380, 320, Math.PI / 2, 0));
      await until(b, () => window.__getaway.state().a.esc > 0.2, null, 8000, 'the cop sees the escape meter');
      await waitOver(h, 2);
      sa = await st(a);
      assert(sa.match.hist[2].reason === 'heat' && sa.match.scores.a === 1, 'ESCAPED by losing the heat');
      // round 4: Sydney runs into the canal → 2–2, decided on the tiebreak
      await until(a, () => window.__getaway.state().R.idx === 3, null, 15000, 'round 4');
      await phase(b, 'chase', 15000);
      await hook(b, 'hold', 'b', { gas: 0.3 });
      await b.evaluate(() => window.__getaway.teleport('b', 206, 100, Math.PI, 8));
      for (const p of [a, b]) await until(p, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 20000, 'end card');
      sa = await st(a); sb = await st(b);
      assert(sa.result && sb.result && sa.result.winner === sb.result.winner && sa.match.scores.a === 2 && sa.match.scores.b === 2, `final on both phones: ${sa.result.text} (${sa.result.sub})`);
      await wait(800);
      const res = h.results().filter((r) => r.game === 'getaway');
      assert(res.length === 1, 'the match is recorded once');
      await shot(a, 'live-end');
      // rematch: both back in the lobby
      await a.click('#game-root .gm-end [data-g="rematch"]');
      for (const p of [a, b]) await until(p, () => window.__getaway && window.__getaway.state().phase === 'lobby', null, 30000, 'rematch lobby');
      console.log('ok - rematch: both phones back in the lobby');
      assert(!h.warnings.length, `message budget respected (${h.warnings.length} warnings)`);
      h.assertNoErrors();
    } catch (e) { fails++; console.error(e.message); await shot(h.a, 'live-fail-a').catch(() => {}); await shot(h.b, 'live-fail-b').catch(() => {}); } finally { await h.close(); }
  }

  if (want('lossy')) {
    const h = await launch({ port: PORT + 2, only: ['getaway'], latency: 150, dropRate: 0.25, coarse: true });
    const { a, b } = h;
    try {
      await openPair(h, { ...FAST, rounds: 2 });
      await startMatch(h);
      await phase(a, 'chase', 20000); await phase(b, 'chase', 20000);
      const [ra, rb] = [await round(a), await round(b)];
      assert(ra.t0 === rb.t0, 'shared timeline survives 25 % loss at 150 ms');
      await hook(a, 'auto', 'a', true); await hook(b, 'auto', 'b', true);
      await wait(4000);
      await hook(a, 'auto', 'a', false); await hook(b, 'auto', 'b', false);
      await hook(a, 'hold', 'a', { hand: true }); await hook(b, 'hold', 'b', { hand: true });
      await a.evaluate(() => window.__getaway.teleport('a', -100, 40, Math.PI / 2, 0));
      await b.evaluate(() => window.__getaway.teleport('b', -108, 40, Math.PI / 2, 0));
      await waitOver(h, 0, 25000);
      const sa = await st(a); const sb = await st(b);
      assert(sa.match.hist[0] && sb.match.hist[0] && sa.match.hist[0].outcome === sb.match.hist[0].outcome, `both agree under loss: ${sa.match.hist[0].outcome} (${sa.match.hist[0].reason})`);
      await until(b, () => window.__getaway.state().R.idx === 1, null, 20000, 'round 2 under loss');
      await phase(a, 'chase', 20000);
      await hook(a, 'hold', 'a', { hand: true }); await hook(b, 'hold', 'b', { hand: true });
      await b.evaluate(() => window.__getaway.teleport('b', -300, 40, Math.PI / 2, 0));
      await a.evaluate(() => window.__getaway.teleport('a', -380, 40, Math.PI / 2, 0));
      await wait(1200);
      assert((await hook(a, 'mapTap', -200, 40)) === true, 'strip dropped under loss');
      await until(b, () => window.__getaway.state().R.spikes.length === 1, null, 10000, 'strip arrives through the loss');
      await hook(a, 'shortenRound', 2500);
      for (const p of [a, b]) await until(p, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 30000, 'end card under loss');
      const fa = await st(a); const fb = await st(b);
      assert(fa.result.winner === fb.result.winner, `same winner on both phones under loss (${fa.result.text})`);
      assert(h.results().filter((r) => r.game === 'getaway').length === 1, 'recorded once under loss');
      h.assertNoErrors();
    } catch (e) { fails++; console.error(e.message); await shot(h.a, 'lossy-fail-a').catch(() => {}); await shot(h.b, 'lossy-fail-b').catch(() => {}); } finally { await h.close(); }
  }

  if (want('split')) {
    const h = await launch({ port: PORT + 3, only: ['getaway'], who: ['a'], fine: true, device: 'Desktop Chrome' });
    const { a } = h;
    try {
      await a.setViewportSize({ width: 1280, height: 800 });
      await arm(a, { ...FAST, rounds: 2 });
      await h.startLive(a, 'getaway', 'local');
      await ready(a);
      await a.click('.g-gtw [data-l="lmode"][data-v="split"]');
      await a.click('.g-gtw [data-l="start"]');
      await phase(a, 'chase', 15000);
      await a.keyboard.down('KeyW'); await a.keyboard.down('ArrowUp'); await a.keyboard.down('ArrowRight');
      await wait(2500);
      const s = await st(a);
      await a.keyboard.up('KeyW'); await a.keyboard.up('ArrowUp'); await a.keyboard.up('ArrowRight');
      assert(s.a.speed > 5 && s.b.speed > 5, `split screen: W drives the left car, ↑ the right (${(s.a.speed * 3.6).toFixed(0)} / ${(s.b.speed * 3.6).toFixed(0)} km/h)`);
      await shot(a, 'split-1280x800');
      const pf = await hook(a, 'perf');
      console.log(`   split screen: ${pf.calls} draw calls for both views, ${pf.tris} triangles`);
      h.assertNoErrors();
    } catch (e) { fails++; console.error(e.message); await shot(h.a, 'split-fail').catch(() => {}); } finally { await h.close(); }
  }

  if (want('robust')) {
    const h = await launch({ port: PORT + 4, only: ['getaway'], who: ['a'], coarse: true });
    const { a } = h;
    try {
      await arm(a, { ...FAST, rounds: 2 });
      await h.startLive(a, 'getaway', 'local');
      await ready(a);
      await a.click('.g-gtw [data-l="start"]');
      await phase(a, 'chase', 15000);
      await hook(a, 'pauseReason', 'hidden', true);
      await until(a, () => window.__getaway.state().paused, null, 3000, 'paused when hidden');
      const t1 = (await round(a)).endAt;
      await wait(1500);
      await hook(a, 'pauseReason', 'hidden', false);
      await until(a, () => !window.__getaway.state().paused, null, 6000, 'resumed');
      const t2 = (await round(a)).endAt;
      assert(t2 - t1 > 1400, `a hidden page pauses the chase; the clock is shifted by the pause (${Math.round(t2 - t1)} ms)`);
      const lost = await hook(a, 'loseContext');
      if (lost) {
        await until(a, () => window.__getaway.state().paused, null, 3000, 'paused on context loss');
        await until(a, () => !window.__getaway.state().paused, null, 10000, 'resumed after the context came back');
        console.log('ok - GL context loss pauses, restore resumes');
      }
      const pf = await hook(a, 'perf');
      assert(pf.programs === pf.programs0, `every shader was compiled behind the loading screen (${pf.programs0} programs)`);
      await a.click('#game-root [data-g="close"]').catch(() => {});
      await wait(600);
      const left = await a.evaluate(() => ({ cv: document.querySelectorAll('#game-root canvas').length, hook: !!window.__getaway }));
      assert(left.cv === 0 && !left.hook, 'closing removes the canvas and the hook');
      h.assertNoErrors();
    } catch (e) { fails++; console.error(e.message); await shot(h.a, 'robust-fail').catch(() => {}); } finally { await h.close(); }
  }

  // map switches rebuild the world; everything that outlives a world (cars, wheels, traffic,
  // effects) must be rebuilt against the new one (regression: renders threw after a switch)
  if (want('mapswitch')) {
    const h = await launch({ port: PORT + 8, only: ['getaway'], who: ['a'], coarse: true });
    const { a } = h;
    try {
      await arm(a, { ...FAST, rounds: 2 });
      await h.startLive(a, 'getaway', 'local');
      await ready(a);
      const maps = (await hook(a, 'maps')).filter((m) => !m.stub).map((m) => m.id);
      const seq = maps.length > 1 ? [...maps, ...maps, maps[0]] : ['dockside', 'dockside', 'dockside'];
      for (const id of seq) {
        await a.evaluate((m) => window.__getaway.reloadMap(m), id);
        const v = await hook(a, 'measureView', -100, 40, Math.PI / 2, 'near');
        await wait(400);
        assert(v.calls > 5 && !h.errors.length, `switched to ${id}: renders (${v.calls} draw calls), no errors`);
      }
      await hook(a, 'setSetup', { map: maps[0] });
      await a.click('.g-gtw [data-l="start"]');
      await phase(a, 'chase', 15000);
      await hook(a, 'hold', 'a', { gas: 1 });
      await wait(2000);
      const s = await st(a);
      assert(s.a.speed > 5 && !h.errors.length, 'a chase after several switches drives and renders cleanly');
      h.assertNoErrors();
    } catch (e) { fails++; console.error(e.message, h.errors.slice(0, 3)); await shot(h.a, 'mapswitch-fail').catch(() => {}); } finally { await h.close(); }
  }

  if (want('perf')) {
    for (const [kind, opts] of [['phone', { coarse: true }], ['laptop', { fine: true, device: 'Desktop Chrome' }]]) {
      const h = await launch({ port: PORT + 5 + (kind === 'laptop' ? 1 : 0), only: ['getaway'], who: ['a'], ...opts });
      const { a } = h;
      try {
        if (kind === 'laptop') await a.setViewportSize({ width: 1280, height: 800 });
        else await a.setViewportSize({ width: 844, height: 390 });
        await arm(a, { ...FAST, maxDpr: 1 });
        await h.startLive(a, 'getaway', 'local');
        await ready(a);
        const maps = await hook(a, 'maps');
        for (const m of maps) {
          if (m.stub) { console.log(`   ${m.name}: stub (coming soon), skipped`); continue; }
          await hook(a, 'setSetup', { map: m.id });
          await until(a, (id) => { const s = window.__getaway.state(); return s.mapId === id && !s.loading; }, m.id, 60000, 'map ' + m.id);
          const pf = await hook(a, 'perf');
          const views = await a.evaluate(() => {
            const g = window.__getaway; const out = [];
            const sp = g.internals.S.mapEntry.spawns || [];
            const pts = sp.map((s) => s.runner);
            const roads = g.roads(); for (let i = 0; i < 6 && roads.length; i++) { const r = Math.floor((i * 7919) % roads.length); const p = g.roadPoint(r, (roads[r].len * (i + 1)) / 7); pts.push({ x: p.x, z: p.z, yaw: p.yaw }); }
            for (const p of pts) for (let k = 0; k < 4; k++) out.push(g.measureView(p.x, p.z, (p.yaw || 0) + (k * Math.PI) / 2, k === 3 ? 'far' : 'near'));
            return out;
          });
          const maxCalls = Math.max(...views.map((v) => v.calls)); const maxTris = Math.max(...views.map((v) => v.tris));
          console.log(`   ${kind} ${m.name}: build ${pf.build.buildMs} ms (longest block ${pf.build.maxBlockMs} ms), ${pf.build.chunks} chunks, ${Math.round(pf.build.tris / 1000)}k triangles in the map; in view: ≤ ${maxCalls} draw calls, ≤ ${Math.round(maxTris / 1000)}k triangles over ${views.length} views`);
          soft(maxCalls <= 90, `${kind} ${m.name}: draw calls ≤ 90 (${maxCalls})`);
          soft(maxTris <= 220000, `${kind} ${m.name}: triangles in view ≤ 220k (${maxTris})`);
          soft(pf.build.maxBlockMs <= 250, `${kind} ${m.name}: the build never blocks more than ~200 ms at once (${pf.build.maxBlockMs} ms)`);
        }
        // a busy chase on Dockside: JS cost per frame
        await hook(a, 'setSetup', { map: 'dockside' });
        await until(a, () => window.__getaway.state().mapId === 'dockside' && !window.__getaway.state().loading, null, 60000, 'dockside');
        await a.click('.g-gtw [data-l="start"]');
        await phase(a, 'chase', 15000);
        await until(a, () => window.__getaway.navReady(), null, 20000, 'nav');
        await hook(a, 'auto', 'a', true);
        await hook(a, 'resetPerf');
        await wait(6000);
        const pf = await hook(a, 'perf');
        console.log(`   ${kind} chase: frame p50 ${pf.p50.toFixed(0)} ms (software GL), game JS p50 ${pf.work50.toFixed(2)} ms / p95 ${pf.work95.toFixed(2)} ms, ≤ ${pf.maxCalls} draw calls, ≤ ${Math.round(pf.maxTris / 1000)}k triangles, scale ${pf.scale}`);
        soft(pf.maxCalls <= 90 && pf.maxTris <= 220000, `${kind} chase within budgets (${pf.maxCalls} calls, ${pf.maxTris} tris)`);
        h.assertNoErrors();
      } catch (e) { fails++; console.error(e.message); await shot(h.a, `perf-${kind}-fail`).catch(() => {}); } finally { await h.close(); }
    }
  }

  if (want('shots')) {
    for (const scheme of ['light', 'dark']) {
      for (const [w, hh, label, opts] of [[390, 844, 'phone', { coarse: true }], [844, 390, 'phone-land', { coarse: true }], [1280, 800, 'laptop', { fine: true, device: 'Desktop Chrome' }]]) {
        const h = await launch({ port: PORT + 7, only: ['getaway'], who: ['a'], colorScheme: scheme, ...opts });
        const { a } = h;
        try {
          await a.setViewportSize({ width: w, height: hh });
          await arm(a, { ...FAST, intro: 2500, count: 1500, maxDpr: 1.5 });
          await h.startLive(a, 'getaway', 'local');
          await ready(a);
          await wait(900);
          await shot(a, `${label}-${w}x${hh}-${scheme}-lobby`);
          await a.click('.g-gtw [data-l="settings"]'); await wait(300);
          await shot(a, `${label}-${w}x${hh}-${scheme}-settings`);
          await a.click('.g-gtw [data-l="sheetclose"]');
          await a.click('.g-gtw [data-l="start"]');
          await phase(a, 'intro', 8000); await wait(700);
          await shot(a, `${label}-${w}x${hh}-${scheme}-intro`);
          await phase(a, 'chase', 10000);
          await until(a, () => window.__getaway.navReady(), null, 20000, 'nav');
          await hook(a, 'auto', 'a', true);
          await wait(3500);
          await shot(a, `${label}-${w}x${hh}-${scheme}-chase`);
          await a.evaluate(() => { const g = window.__getaway; const s = g.state(); g.teleport('b', s.a.x - Math.sin(s.a.yaw) * 9, s.a.z + Math.cos(s.a.yaw) * 9, s.a.yaw, s.a.speed); });
          await wait(700);
          await shot(a, `${label}-${w}x${hh}-${scheme}-pursuit`);
          await hook(a, 'openMap'); await wait(500);
          await shot(a, `${label}-${w}x${hh}-${scheme}-map`);
          await hook(a, 'closeMap');
          await hook(a, 'endNow', 'busted', 'hp');
          await wait(1600);
          await shot(a, `${label}-${w}x${hh}-${scheme}-result`);
          h.assertNoErrors();
        } catch (e) { fails++; console.error(e.message); await shot(h.a, `shots-${label}-${scheme}-fail`).catch(() => {}); } finally { await h.close(); }
      }
    }
    console.log('   screenshots in', SHOTS);
  }

  if (fails) { console.log(`\n${fails} FAILED`); process.exitCode = 1; } else console.log('\nALL GOOD');
})();
