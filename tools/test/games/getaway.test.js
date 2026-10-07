// Getaway — end-to-end tests.
//   node tools/test/games/getaway.test.js                 (every section)
//   ONLY=unit,practice node tools/test/games/getaway.test.js   (sections: unit, practice, touch, live, contacts, chasecontacts, lossy, split, robust, mapswitch, gfx, perf, shots)
// Sections: unit (physics in Node) · practice (one phone vs the AI: intro, countdown, PIT bust,
// spikes, timer + heat escapes, water bust, final) · live (two phones: join, settings sync,
// roles, synced start, traffic determinism, boxed bust, spikes over the network, swaps, final,
// one recorded result, rematch) · lossy (150 ms, 25 % drops) · split (laptop split screen) ·
// robust (pause on hidden, GL context loss, leaks) · perf (every playable map, phone + laptop)
// · shots (390×844, 844×390, 1280×800, light + dark) · touch (every menu by real taps,
// load errors, pause menu, dropped graphics). Ports 8930–8939 (PORT=… moves them).
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
    const br = run('runner', { brake: 1 }, 5, (c) => { c.vx = 40; }).out; const stop = br.find((o) => o.v < 0.2);
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
    // PIT judging (tiers: 0 none, 1 nudge, 2 PIT)
    const runner = newCar('runner'); placeCar(runner, 0, 0, Math.PI / 2, geo); runner.vx = 20;
    const ct = {};
    const cop = newCar('cop'); placeCar(cop, -3.2, -1.9, Math.PI / 2 + 0.3, geo); cop.vx = 22; cop.vz = 6.5;
    assert(carContact(runner, cop, ct) > 0 && judgePit(runner, cop, ct) !== 0 && ct.pitTier === 2, `a hard push on the rear quarter from the side at speed is a PIT (push ${ct.pitPush.toFixed(1)} m/s)`);
    const tap = newCar('cop'); placeCar(tap, -3.2, -1.9, Math.PI / 2 + 0.3, geo); tap.vx = 21; tap.vz = 1.2;
    carContact(runner, tap, ct); judgePit(runner, tap, ct);
    assert(ct.pitTier < 2, `a light tap on the rear quarter is at most a nudge (tier ${ct.pitTier}, push ${ct.pitPush.toFixed(1)} m/s)`);
    const ram = newCar('cop'); placeCar(ram, -4.4, 0, Math.PI / 2, geo); ram.vx = 26;
    assert(carContact(runner, ram, ct) > 0 && judgePit(runner, ram, ct) === 0 && ct.pitTier === 0, 'a straight rear-end shunt is a ram, not a PIT');
    const offc = newCar('cop'); placeCar(offc, -4.4, -0.4, Math.PI / 2 + 0.05, geo); offc.vx = 26; offc.vz = 1.3;
    assert(carContact(runner, offc, ct) > 0 && judgePit(runner, offc, ct) === 0, 'a rear-end shunt slightly off-centre is still a ram (no knife edge at 0.35 m)');
    const tb = newCar('cop'); placeCar(tb, 0, -3.0, Math.PI, geo); tb.vz = 15;
    assert(carContact(runner, tb, ct) > 0 && judgePit(runner, tb, ct) === 0, 'a T-bone is not a PIT');
    const slow = newCar('runner'); placeCar(slow, 0, 0, Math.PI / 2, geo); slow.vx = 3;
    assert(carContact(slow, cop, ct) > 0 && judgePit(slow, cop, ct) === 0, 'no PIT on a crawling car');
    // the collision box is the body: cars touch bumper to bumper, not half a metre early
    const b1 = newCar('runner'); placeCar(b1, 0, 0, Math.PI / 2, geo); const b2 = newCar('cop'); placeCar(b2, 4.7, 0, Math.PI / 2, geo);
    const b3 = newCar('cop'); placeCar(b3, 4.5, 0, Math.PI / 2, geo); const b4 = newCar('cop'); placeCar(b4, 0, 2.05, Math.PI / 2, geo);
    const b5 = newCar('cop'); placeCar(b5, 2.0, 1.9, Math.PI / 2, geo); // corner to corner
    assert(carContact(b1, b2, ct) === 0 && carContact(b1, b3, ct) > 0 && carContact(b1, b4, ct) === 0 && carContact(b1, b5, ct) > 0,
      'car collider = 4.6 × 2 m body: apart at 4.7 m nose-to-tail and 2.05 m side by side, touching at 4.5 m and corner to corner');
    // a tree collides as its trunk, a shrub not at all; a mailbox gives way at a walking pace
    { const g2 = createGeo({ id: 't2', bounds: flat.bounds, roads: flat.roads, solids: [{ kind: 'tree', x: 0, z: 0, w: 2, d: 2 }, { kind: 'shrub', x: 50, z: 0, w: 1.4, d: 1.4 }, { kind: 'mailbox', x: 100, z: 0, w: 0.5, d: 0.5 }] });
      const near = newCar('runner'); placeCar(near, 0, 2.3 + 0.45, 0, g2); // nose 0.45 m from the trunk centre: just clear of a 0.32 m trunk
      stepCar(near, {}, DT, g2, CAR.runner, NITRO.normal);
      assert(Math.abs(near.z - 2.75) < 0.01, `a tree is solid only where its trunk is (car ${(near.z - 2.3).toFixed(2)} m from the trunk centre, untouched)`);
      const sh = newCar('runner'); placeCar(sh, 50, 6, 0, g2); sh.vz = -6; let evs = [];
      for (let i = 0; i < 180; i++) { stepCar(sh, { gas: 0.3 }, DT, g2, CAR.runner, NITRO.normal); evs = evs.concat(sh.ev.splice(0)); }
      assert(sh.z < -3 && evs.some((e) => e.t === 'break' && e.soft), 'a shrub is driven over (flattened), not a wall');
      const mb = newCar('runner'); placeCar(mb, 100, 6, 0, g2); mb.vz = -4; evs = [];
      for (let i = 0; i < 240; i++) { stepCar(mb, { gas: 0.25 }, DT, g2, CAR.runner, NITRO.normal); evs = evs.concat(mb.ev.splice(0)); }
      assert(mb.z < -3 && evs.some((e) => e.t === 'break'), 'a mailbox is knocked over at 14 km/h'); }
    // walls made of several boxes: sliding along the seams doesn't catch the car
    { const seg = []; for (let k = 0; k < 12; k++) seg.push({ kind: 'wall', x: -60 + k * 10, z: -3, w: 10, d: 1, rot: 0, h: 2 });
      const g3 = createGeo({ id: 't3', bounds: flat.bounds, roads: flat.roads, solids: seg });
      const c = newCar('runner'); placeCar(c, -55, -1.3, Math.PI / 2 - 0.05, g3); c.vx = 25; c.vz = -1.2;
      let minV = 99; let walls = 0;
      for (let i = 0; i < 300; i++) { stepCar(c, { gas: 1, steer: -0.08 }, DT, g3, CAR.runner, NITRO.normal); if (i > 30) minV = Math.min(minV, c.speed); walls += c.ev.filter((e) => e.t === 'wall').length; c.ev.length = 0; }
      assert(minV > 20 && walls <= 1 && c.x > 10, `scraping along a wall of 12 boxes: no snag on the seams (min ${minV.toFixed(1)} m/s, ${walls} hard hits)`); }
    // body motion for the renderer: braking dives the nose, a kerb bounces the suspension
    { const c = newCar('runner'); placeCar(c, 0, 0, Math.PI / 2, geo); c.vx = 30; let maxP = 0; for (let i = 0; i < 60; i++) { stepCar(c, { brake: 1 }, DT, geo, CAR.runner, NITRO.normal); maxP = Math.max(maxP, c.pitch); }
      assert(maxP > 0.04 && c.susp[0] > 0 && c.susp[2] < c.susp[0], `braking pitches the nose down (${maxP.toFixed(3)} rad, front wheels compressed)`); }
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
    const path1 = (() => { dg.buildNav(); return dg.findPath(-100, 40, 340, -100); })();
    assert(path1 && path1.length > 20, `AI nav: a road route across Dockside (${path1.length / 2} points)`);
    if (typeof engineUnits === 'function') await engineUnits();
    if (typeof feelUnits === 'function') await feelUnits();
  }

  // ═══ one phone vs the AI ═══
  if (want('practice')) {
    const h = await launch({ port: PORT, only: ['getaway'], who: ['a'], coarse: true });
    const { a } = h;
    try {
      await arm(a, { ...FAST, rounds: 4, intro: 2400 }); // (a long enough intro to catch on a busy machine)
      await h.startLive(a, 'getaway', 'local');
      await ready(a);
      let s = await st(a);
      assert(s.phase === 'lobby' && s.localMode === 'ai' && s.mapId === 'dockside', 'one phone opens on the lobby, practice vs AI, Dockside');
      assert(!(await a.isVisible('.g-gtw [data-l="lmode"][data-v="split"]')) && await a.isVisible('.g-gtw [data-l="lmode"][data-v="daily"]'), 'a phone offers Practice and the Daily chase (split screen only on laptops)');
      await a.tap('.g-gtw [data-l="start"]'); // a real touch tap (phones)
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
      // (game time, not wall time: a starved headless page runs the physics slower than real time)
      await until(a, (d) => { const q = window.__getaway.state(); return Math.hypot(q.a.x - q.b.x, q.a.z - q.b.z) < d - 15; }, d0, 9000, 'the AI cop closing in').catch(() => {});
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
      await a.evaluate(() => { const g = window.__getaway; g.teleport('a', -300, 40, Math.PI / 2, 20); g.teleport('b', -303.4, 38.0, Math.PI / 2 + 0.32, 24); });
      await until(a, () => window.__getaway.state().a.stats.pits >= 1, null, 5000, 'PIT');
      s = await st(a);
      assert(s.a.hp <= 80, `PIT! runner spun, ${(100 - s.a.hp).toFixed(0)} damage`);
      await shot(a, 'practice-pit');
      // box them in: runner stopped, cop alongside → busted after 3 s
      await hook(a, 'hold', 'a', { hand: true }); await hook(a, 'hold', 'b', { hand: true });
      await a.evaluate(() => { const g = window.__getaway; const s = g.state(); g.teleport('b', s.a.x - 7, s.a.z, s.a.yaw, 0); g.setCar('a', { vx: 0, vz: 0, r: 0 }); });
      await until(a, () => { const R = window.__getaway.state().R; return R && R.over; }, null, 14000, 'busted');
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
      // (the cop closes up: 160 m back is beyond Dockside's 140 m heat, and with FAST's 1.6 s heatT
      // the runner would lose the heat before reaching the strip)
      await a.evaluate(() => window.__getaway.teleport('a', -230, 40, Math.PI / 2, 0));
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
      // escape by the clock (the runner parked near the cop, so losing the heat can't come first)
      await hook(a, 'hold', 'b', { hand: true }); await a.evaluate(() => window.__getaway.teleport('b', -150, 40, Math.PI / 2, 0));
      await hook(a, 'shortenRound', 1500);
      await until(a, () => { const R = window.__getaway.state().R; return R && R.over; }, null, 8000, 'timer escape');
      s = await st(a);
      assert(s.R.result.outcome === 'escaped' && s.R.result.reason === 'time', `ESCAPED when the clock runs out (${JSON.stringify(s.R.result)})`);
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
      // 2–2 after four rounds: sudden death (one 0:45 decider, no spikes, the shorter total run runs)
      await until(a, () => { const q = window.__getaway.state(); return q.R && q.R.idx === 4; }, null, 12000, 'sudden death');
      await phase(a, 'chase', 12000);
      s = await st(a);
      assert(Math.round((s.R.endAt - s.R.t0) / 1000) === 45 && s[s.R.runner === 'a' ? 'b' : 'a'].spikesLeft === 0, `2–2: a 0:45 sudden-death decider (${s.R.runner === 'a' ? 'you run' : 'the AI runs'}, no spikes)`);
      await hook(a, 'endNow', 'escaped', 'time');
      await until(a, () => window.__getaway.state().phase === 'final', null, 8000, 'final after the decider');
      await until(a, () => !!document.querySelector('.g-gtw .gtw-final'), null, 4000, 'the match card');
      console.log('ok - the match card: rounds, both columns, MVP');
      await shot(a, 'practice-finalcard');
      await a.tap('.g-gtw .gtw-final').catch(() => {}); // (tap to go on; it may already have gone on by itself)
      await until(a, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 15000, 'end card');
      assert(!(await a.isVisible('#game-root .gm-end .gm-end-rec')), 'practice: no couple all-time line on the end card');
      s = await st(a);
      assert(s.result && s.result.winner === null && /AI|Practice/.test(s.result.text), `practice ends with "${s.result.text}" (no real winner recorded)`);
      await shot(a, 'practice-end');
      h.assertNoErrors();
    } catch (e) { fails++; console.error(e.message); await shot(h.a, 'practice-fail').catch(() => {}); } finally { await h.close(); }
  }

  // ═══ touch: every menu driven by real taps (iOS drops the click after a cancelled touchstart) ═══
  if (want('touch')) {
    const h = await launch({ port: PORT + 7, only: ['getaway'], who: ['a'], coarse: true });
    const { a } = h;
    const tap = async (sel) => { await a.locator(sel).first().tap(); await wait(250); };
    const ui = () => hook(a, 'ui');
    try {
      await arm(a, { ...FAST, rounds: 2, intro: 1500, resume: 900, glStuck: 900, heatT: 60 }); // (the AI runner can't shake the heat: the chase must outlast the taps)
      // a map that crashed the last open is not reopened: the lightest map instead
      await a.evaluate(() => { localStorage.setItem('getaway.loading.v1', JSON.stringify({ map: 'boulder', t: Date.now() })); localStorage.setItem('getaway.setup.v1', JSON.stringify({ map: 'boulder' })); });
      await h.openGames(a);
      await a.locator('[data-g="sheet"][data-game="getaway"]').first().tap();
      await a.waitForSelector('#game-root .gs');
      const label = await a.locator('[data-g="live"][data-game="getaway"][data-mode="local"]').textContent();
      assert(/Practice vs AI/.test(label), `the one-phone button says "${label.trim()}"`);
      await a.locator('[data-g="live"][data-game="getaway"][data-mode="local"]').tap();
      await ready(a);
      let s = await st(a);
      assert(s.phase === 'lobby' && s.mapId === 'dockside', 'after a crash while loading Boulder, the next open starts on Dockside');
      assert(!(await a.evaluate(() => localStorage.getItem('getaway.loading.v1'))), 'the crash marker is cleared once a map loads');
      await tap('.g-gtw [data-l="prole"][data-v="cop"]');
      assert((await st(a)).localMode === 'ai' && (await ui()).device.practiceRole === 'cop', 'tap: practice role → Cop');
      await tap('.g-gtw [data-l="ailevel"][data-v="hard"]');
      assert((await ui()).device.aiLevel === 'hard', 'tap: AI driver → Hard');
      await tap('.g-gtw [data-l="howto"]');
      assert((await ui()).sheet === 'how' && await a.isVisible('.g-gtw .gtw-how'), 'tap: How to play opens');
      await tap('.g-gtw [data-l="howclose"]');
      assert(!(await ui()).sheet && (await ui()).device.seenHow, 'tap: Got it closes it (remembered)');
      await tap('.g-gtw [data-l="settings"]');
      assert((await ui()).sheet === 'settings', 'tap: Settings opens');
      await tap('.g-gtw [data-l="dev"][data-k="sens"][data-v="high"]');
      await tap('.g-gtw [data-l="dev"][data-k="dead"][data-v="large"]');
      await tap('.g-gtw [data-l="rule"][data-k="spikes"][data-step="1"]');
      s = await st(a); const d = (await ui()).device;
      assert(d.sens === 'high' && d.dead === 'large' && s.setup.rules.spikes === 4, 'tap: steering sensitivity, dead zone and a rule stepper all respond');
      const sc = await a.evaluate(() => { const el = document.querySelector('.g-gtw .gtw-sheet .in'); return { ta: getComputedStyle(el).touchAction, over: getComputedStyle(el).overflowY }; });
      assert(/pan-y|auto/.test(sc.ta) && sc.over === 'auto', `the settings sheet scrolls by touch (touch-action ${sc.ta})`);
      await tap('.g-gtw [data-l="sheetclose"]');
      assert(!(await ui()).sheet, 'tap: Done closes settings');
      // a map that fails to load ends on an error card with a way out (never a silent hang)
      await hook(a, 'failLoad', 1);
      await tap('.g-gtw [data-l="map"][data-dir="1"]');
      await until(a, () => !!document.querySelector('.g-gtw .gtw-err'), null, 15000, 'error card');
      await shot(a, 'touch-load-error');
      assert(await a.isVisible('.g-gtw [data-l="loadretry"]') && await a.isVisible('.g-gtw [data-l="loaddock"]'), 'load failure: error card with Try again and Play Dockside instead');
      await tap('.g-gtw [data-l="loaddock"]');
      await until(a, () => { const s2 = window.__getaway.state(); return s2.phase === 'lobby' && s2.mapId === 'dockside' && !s2.loading && !!document.querySelector('.g-gtw .gtw-lobby'); }, null, 30000, 'back on Dockside');
      console.log('ok - tap: "Play Dockside instead" recovers to the lobby');
      for (let i = h.errors.length - 1; i >= 0; i--) if (/forced load failure/.test(h.errors[i])) h.errors.splice(i, 1);
      // a big map can be cancelled from its loading card
      await tap('.g-gtw [data-l="map"][data-dir="1"]');
      await until(a, () => !!document.querySelector('.g-gtw [data-l="loadcancel"]'), null, 8000, 'cancel button');
      await shot(a, 'touch-loading');
      await a.locator('.g-gtw [data-l="loadcancel"]').tap();
      await until(a, () => { const s2 = window.__getaway.state(); return s2.mapId === 'dockside' && !s2.loading && s2.setup.map === 'dockside' && !!document.querySelector('.g-gtw .gtw-lobby'); }, null, 30000, 'cancelled back to Dockside');
      console.log('ok - tap: Cancel stops a big map load and goes back to Dockside');
      // start by tap, pause menu by tap, resume by tap
      await tap('.g-gtw [data-l="start"]');
      await phase(a, 'intro', 8000);
      console.log('ok - tap: Start starts the match');
      await phase(a, 'chase', 12000);
      s = await st(a);
      assert(s.a.role === 'cop', 'practice as the cop (tapped role) starts as the cop');
      await a.locator('.g-gtw .gtw-view.full [data-tap="pause"]').tap(); await wait(300);
      s = await st(a);
      assert(s.paused && (await ui()).menu && await a.isVisible('.g-gtw [data-l="resume"]'), 'tap: the ‖ button pauses with a menu');
      await shot(a, 'touch-pause');
      await tap('.g-gtw [data-l="settings"]');
      assert((await ui()).sheet === 'settings' && !(await a.isVisible('.g-gtw [data-l="rule"]')), 'pause → Settings shows this phone’s settings only');
      await tap('.g-gtw [data-l="sheetclose"]');
      await tap('.g-gtw [data-l="resume"]');
      await until(a, () => !window.__getaway.state().paused, null, 6000, 'resumed');
      console.log('ok - tap: Resume counts back in and unpauses');
      // minimap regression: near the map edge the part outside the map image stays paper-coloured
      // (a translucent fill without a clear used to stack up to solid black there)
      {
        const me = (await st(a)).me;
        const home = await a.evaluate((w) => { const g = window.__getaway; const c = g.state()[w]; const B = g.internals.geo.bounds; g.hold(w, {}); g.setCar(w, { x: B.x0 + 15, z: (B.z0 + B.z1) / 2, vx: 0, vz: 0, speed: 0 }); return c; }, me);
        await wait(2500);
        const px = await a.evaluate(() => { const cv = document.querySelector('.g-gtw .gtw-mini canvas'); const d = cv.getContext('2d').getImageData(3, cv.height >> 1, 1, 1).data; return Array.from(d); });
        await shot(a, 'touch-minimap-edge');
        await a.evaluate(([w, c]) => { const g = window.__getaway; g.teleport(w, c.x, c.z, c.yaw, 0); g.hold(w, null); }, [me, home]);
        assert(px[3] === 255 && px[0] + px[1] + px[2] > 45, `minimap outside the map image is paper, not black (got ${px.join(',')})`);
        console.log('ok - minimap: off-map area near the edge is not black');
      }
      // the map overlay closes by tap
      await a.locator('.g-gtw .gtw-mini').tap(); await wait(300);
      assert(await a.isVisible('.g-gtw .gtw-map'), 'tap: the minimap opens the map');
      await a.locator('.g-gtw .gtw-map [data-m="close"]').tap(); await wait(300);
      assert(!(await a.isVisible('.g-gtw .gtw-map')), 'tap: Done closes the map');
      // graphics dropped by the phone and never given back: a card with a reload, and the game goes on
      await hook(a, 'loseContext', true);
      await until(a, () => !!document.querySelector('.g-gtw [data-l="glreload"]'), null, 8000, 'graphics card');
      await shot(a, 'touch-gl-lost');
      await tap('.g-gtw [data-l="glreload"]');
      await until(a, () => { const g = window.__getaway; return g.ready && !g.state().loading && !g.ui().glStuck; }, null, 30000, 'graphics back');
      await until(a, () => !window.__getaway.state().paused, null, 8000, 'unpaused after reload');
      console.log('ok - tap: Reload graphics rebuilds the renderer and the chase carries on');
      // quit to the lobby from the pause menu
      await a.locator('.g-gtw .gtw-view.full [data-tap="pause"]').tap(); await wait(300);
      await tap('.g-gtw [data-l="quit"]');
      await phase(a, 'lobby', 6000);
      await wait(600); // several frames: the pause card's clean-up must not take the lobby down with it
      assert(await a.isVisible('.g-gtw [data-l="start"]') && (await ui()).card && !(await ui()).menu && !(await st(a)).paused, 'tap: Quit to the lobby shows the lobby (Start visible, not a blank screen)');
      await shot(a, 'touch-afterquit');
      await tap('.g-gtw [data-l="start"]');
      await phase(a, 'intro', 8000);
      console.log('ok - tap: Start works again after quitting');
      h.assertNoErrors();
    } catch (e) { fails++; console.error(e.message); await shot(h.a, 'touch-fail').catch(() => {}); } finally { await h.close(); }
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
    await a.tap('.g-gtw [data-l="start"]');
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
      await a.tap('.g-gtw [data-l="settings"]');
      await a.tap('.g-gtw [data-l="rule"][data-k="spikes"][data-step="1"]');
      await a.tap('.g-gtw [data-l="rule"][data-k="traffic"][data-step="-1"]');
      await until(b, () => { const r = window.__getaway.state().setup.rules; return r.spikes === 4 && r.traffic === 'light'; }, null, 8000, 'guest sees the settings');
      console.log('ok - the guest sees the host change spikes and traffic live');
      await b.tap('.g-gtw [data-l="settings"]');
      assert(await b.isVisible('.g-gtw .gtw-sheet .gtw-ro'), 'the guest’s settings sheet is read-only');
      await shot(b, 'live-guest-settings');
      await b.tap('.g-gtw [data-l="sheetclose"]'); await a.tap('.g-gtw [data-l="sheetclose"]');
      // the guest's Ready by tap reaches the host
      await b.tap('.g-gtw [data-l="ready"]');
      await until(a, () => /ready/.test((document.querySelector('.g-gtw .gtw-status') || {}).textContent || ''), null, 8000, 'host sees the guest ready');
      console.log('ok - tap: the guest’s Ready shows on the host');
      await hook(a, 'setRules', { heat: 260, tiebreak: 'time' }); // (a 2–2 here goes to the longest-run tiebreak; practice covers sudden death)
      await until(b, () => window.__getaway.state().setup.rules.heat === 260, null, 8000, 'guest sees heat 260');
      await startMatch(h);
      const ra = await round(a); const rb = await round(b);
      assert(ra.t0 === rb.t0 && ra.endAt === rb.endAt && ra.runner === 'a', 'both phones share the round timeline; Emerson runs first');
      await phase(a, 'chase'); await phase(b, 'chase');
      let sa = await st(a); let sb = await st(b);
      assert(sa.R.spawn === sb.R.spawn && Math.abs(sa.b.x - sb.b.x) < 1 && Math.abs(sa.a.z - sb.a.z) < 1, `both phones start the cars at the same spawn (#${sa.R.spawn})`);
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
      await b.evaluate(() => window.__getaway.teleport('b', -180, 40, Math.PI / 2, 0)); // (spawns are seeded: put both on Mill St)
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
      await waitOver(h, 0, 25000); // (3 s of game time, 4 s queued behind a civilian: slow on a starved machine)
      sa = await st(a); sb = await st(b);
      if (!sa.match.hist[0] || !sb.match.hist[0] || sa.match.hist[0].reason !== 'boxed') console.log('DEBUG', JSON.stringify([sa.match.hist, sb.match.hist, sa.dbgEnd, sb.dbgEnd]));
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
      await until(b, () => { const s = window.__getaway.state(); return s.R.over || s.phase === 'final'; }, null, 10000, 'the runner’s phone calls the splash');
      for (const p of [a, b]) await until(p, () => !!document.querySelector('#game-root .gm-end:not([hidden])'), null, 20000, 'end card');
      sa = await st(a); sb = await st(b);
      assert(sa.result && sb.result && sa.result.winner === sb.result.winner && sa.match.scores.a === 2 && sa.match.scores.b === 2, `final on both phones: ${sa.result.text} (${sa.result.sub})`);
      await wait(800);
      const res = h.results().filter((r) => r.game === 'getaway');
      assert(res.length === 1, 'the match is recorded once');
      await shot(a, 'live-end');
      // rematch in place: no remount, no map rebuild, straight into round 0 with the roles swapped
      for (const p of [a, b]) await p.evaluate(() => { window.__gtwWorldMark = window.__getaway.internals.world; });
      const t0 = Date.now();
      await a.click('#game-root .gm-end [data-g="rematch"]');
      for (const p of [a, b]) await until(p, () => { const s = window.__getaway && window.__getaway.state(); return s && s.R && s.R.idx === 0 && !s.R.over && ['intro', 'count', 'chase'].includes(s.phase); }, null, 30000, 'rematch round 0');
      for (const p of [a, b]) await phase(p, 'chase', 15000);
      const goMs = Date.now() - t0;
      const same = await Promise.all([a, b].map((p) => p.evaluate(() => window.__getaway.internals.world === window.__gtwWorldMark && document.querySelector('#game-root .gm-end').hidden)));
      sa = await st(a);
      assert(same[0] && same[1] && sa.R.runner === 'b', `rematch: both phones straight into a new match on the same world (Sydney runs first), tap → GO ${goMs} ms ${JSON.stringify(same)} runner ${sa.R.runner}`);
      assert(!h.warnings.length, `message budget respected (${h.warnings.length} warnings)`);
      h.assertNoErrors();
    } catch (e) { fails++; console.error(e.message, h.errors.slice(0, 5)); await shot(h.a, 'live-fail-a').catch(() => {}); await shot(h.b, 'live-fail-b').catch(() => {}); } finally { await h.close(); }
  }

  // ═══ contacts: two phones bump side by side at 80 ms / 10% loss; every contact is checked
  // against where the partner car really was (its own trajectory, on the shared clock) ═══
  if (want('contacts')) {
    const h = await launch({ port: PORT + 9, only: ['getaway'], latency: 80, dropRate: 0.1, coarse: true });
    const { a, b } = h;
    try {
      const { carContact } = await import('file://' + path.join(ROOT, 'js/games/getaway/car.js'));
      const { CAR } = await import('file://' + path.join(ROOT, 'js/games/getaway/tune.js'));
      await openPair(h, { ...FAST, rounds: 2 });
      await hook(a, 'setRules', { traffic: 'off', roundTime: 300 });
      await until(b, () => window.__getaway.state().setup.rules.traffic === 'off', null, 8000, 'guest sees traffic off');
      await startMatch(h);
      await phase(a, 'chase'); await phase(b, 'chase');
      await hook(a, 'contactLog', true); await hook(b, 'contactLog', true);
      const tps = [];
      for (let k = 0; k < 6; k++) {
        // side by side heading east on Mill St, the cop 3.5 m to the runner's right, both at 14 m/s;
        // the cop steers in gently (a shove, not a PIT)
        await hook(a, 'hold', 'a', { gas: 0.45 }); await hook(b, 'hold', 'b', { gas: 0.5, steer: -0.14 - 0.04 * (k % 3) });
        await Promise.all([a.evaluate(() => window.__getaway.teleport('a', -160, 40, Math.PI / 2, 14)), b.evaluate(() => window.__getaway.teleport('b', -160, 43.5, Math.PI / 2, 14))]);
        tps.push(await a.evaluate(() => window.__getaway.clock()));
        await wait(2200);
      }
      await hook(a, 'hold', 'a', { hand: true }); await hook(b, 'hold', 'b', { hand: true });
      await wait(600);
      const la = await hook(a, 'contactLog'); const lb = await hook(b, 'contactLog');
      const at = (traj, t) => { let i = traj.findIndex((q) => q.t >= t); if (i <= 0) return null; const p = traj[i - 1]; const q = traj[i]; if (q.t - p.t > 400) return null; const f = (t - p.t) / ((q.t - p.t) || 1); return { x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f, yaw: p.yaw + (q.yaw - p.yaw) * f }; };
      const judge = (log, otherTraj) => {
        let n = 0; let phantom = 0;
        for (const c of log.contacts) {
          if (tps.some((t) => c.t > t - 100 && c.t < t + 500)) continue; // just teleported
          const o = at(otherTraj, c.t); if (!o) continue;
          n++;
          const me = { x: c.x, z: c.z, yaw: c.yaw, hl: CAR.hl + 0.25, hw: CAR.hw + 0.25 }; const them = { ...o, hl: CAR.hl + 0.25, hw: CAR.hw + 0.25 };
          if (carContact(me, them, {}) <= 0) phantom++;
        }
        return { n, phantom };
      };
      const ja = judge(la, lb.traj); const jb = judge(lb, la.traj);
      console.log('   contacts', JSON.stringify({ runner: ja, cop: jb, bumpsOut: la.bumpsOut.length, bumpsIn: lb.bumpsIn.length }));
      assert(ja.n + jb.n >= 10, `side-by-side shoves make contact (${ja.n} steps on the runner’s phone, ${jb.n} on the cop’s)`);
      assert(ja.phantom <= Math.max(1, ja.n * 0.1) && jb.phantom <= Math.max(1, jb.n * 0.1), `no phantom contacts: the partner was really within 0.5 m (runner ${ja.phantom}/${ja.n}, cop ${jb.phantom}/${jb.n})`);
      const matched = la.bumpsOut.filter((o) => lb.bumpsIn.some((q) => Math.abs(q.t - o.t) < 900)).length;
      assert(la.bumpsOut.length >= 2 && matched >= la.bumpsOut.length - 1, `every bump the runner’s phone resolves reaches the cop’s phone (${matched}/${la.bumpsOut.length}, 10% loss)`);
      const sa = await st(a); const sb = await st(b);
      assert(Math.abs(sa.a.hp - sb.partnerSeen.hp) < 1 || sb.partnerSeen.hp == null, 'both phones agree on the runner’s damage');
    } catch (e) { fails++; console.error(e.message, h.errors.slice(0, 5)); } finally { await h.close(); }
  }

  // ═══ chase contacts: both cars driven by the AI on Dockside with traffic on, at 120 ms / 10% loss.
  // Every contact step a phone logs is checked against where the partner really was. Guards against
  // the runner's phone scraping against its stale picture of the cop after a bump (the cop's half
  // of the impulse stays in that picture until the cop's samples show it). ═══
  if (want('contacts') || want('chasecontacts')) {
    const h = await launch({ port: PORT + 9, only: ['getaway'], latency: 120, dropRate: 0.1, coarse: true });
    const { a, b } = h;
    try {
      const { carContact } = await import('file://' + path.join(ROOT, 'js/games/getaway/car.js'));
      const { CAR } = await import('file://' + path.join(ROOT, 'js/games/getaway/tune.js'));
      await openPair(h, { ...FAST, heatT: 60, rounds: 2, maxDpr: 0.3 }); // a long chase (the runner can’t shake the heat); a light render (the frame rate matters here)
      await hook(a, 'setRules', { roundTime: 300 });
      await startMatch(h);
      await phase(a, 'chase'); await phase(b, 'chase');
      const rw = (await round(a)).runner; const cw = rw === 'a' ? 'b' : 'a';
      const R = rw === 'a' ? a : b; const C = rw === 'a' ? b : a;
      await hook(a, 'contactLog', true); await hook(b, 'contactLog', true);
      await hook(a, 'auto', 'a', true); await hook(b, 'auto', 'b', true);
      let lr = { contacts: [], traj: [], bumpsIn: [], bumpsOut: [] }; let lc = { contacts: [], traj: [], bumpsIn: [], bumpsOut: [] };
      for (let k = 0; k < 7; k++) {
        // the cop starts each run 12 m behind the runner on Mill St (both at speed), then both AIs
        // drive freely: the cop closes in, rams and PITs, the runner swerves through traffic
        await Promise.all([R.evaluate((w) => window.__getaway.teleport(w, -150, 40, Math.PI / 2, 13), rw), C.evaluate((w) => window.__getaway.teleport(w, -162, 40.5, Math.PI / 2, 18), cw)]);
        await wait(5000);
        // (the test log keeps ~20 s of trajectory: collect in slices; skip the teleport itself)
        const [x, y] = [await hook(R, 'contactLog', true), await hook(C, 'contactLog', true)];
        const t1 = Math.min(x.traj.length ? x.traj[0].t : Infinity, y.traj.length ? y.traj[0].t : Infinity) + 600;
        x.contacts = x.contacts.filter((c) => c.t > t1); y.contacts = y.contacts.filter((c) => c.t > t1);
        for (const key of Object.keys(lr)) { lr[key] = lr[key].concat(x[key]); lc[key] = lc[key].concat(y[key]); }
        const s0 = await st(a); if (process.env.DBG) console.log('   slice', k, JSON.stringify({ over: s0.R.over, ph: s0.phase, d: Math.round(Math.hypot(s0.a.x - s0.b.x, s0.a.z - s0.b.z)), n: x.contacts.length, tr: x.traj.length }));
        if (s0.R.over || s0.phase !== 'chase') break;
      }
      await hook(a, 'auto', 'a', false); await hook(b, 'auto', 'b', false);
      const at = (traj, t) => { let i = traj.findIndex((q) => q.t >= t); if (i <= 0) return null; const p = traj[i - 1]; const q = traj[i]; if (q.t - p.t > 400) return null; const f = (t - p.t) / ((q.t - p.t) || 1); return { x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f, yaw: p.yaw + (q.yaw - p.yaw) * f }; };
      const judge = (log, otherTraj) => {
        let n = 0; let phantom = 0;
        for (const c of log.contacts) {
          const o = at(otherTraj, c.t); if (!o) continue;
          n++;
          if (carContact({ x: c.x, z: c.z, yaw: c.yaw, hl: CAR.hl + 0.25, hw: CAR.hw + 0.25 }, { ...o, hl: CAR.hl + 0.25, hw: CAR.hw + 0.25 }, {}) <= 0) { phantom++; if (process.env.DBG) console.log('    phantom', Math.round(c.t), c.pen, 'picture-vs-real', Math.hypot(c.rx - o.x, c.rz - o.z).toFixed(2)); }
        }
        return { n, phantom };
      };
      const jr = judge(lr, lc.traj); const jc = judge(lc, lr.traj);
      if (process.env.DBG) { // how far the runner's picture of the cop is from the real cop, with and without a bump correction
        const e0 = []; const e1 = [];
        for (const q of lr.traj) { if (q.px == null) continue; const o = at(lc.traj, q.t); if (!o) continue; const d = Math.hypot(q.px - o.x, q.pz - o.z); if (Math.hypot(q.x - o.x, q.z - o.z) < 12) (q.nc ? e1 : e0).push(d); }
        const pct = (a, k) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length * k)].toFixed(2) : '-'; };
        console.log('   picture error near the runner: no bump', e0.length, pct(e0, 0.5), pct(e0, 0.9), ' after a bump', e1.length, pct(e1, 0.5), pct(e1, 0.9));
      }
      console.log('   chase contacts', JSON.stringify({ runner: rw, runnerPhone: jr, copPhone: jc, bumpsOut: lr.bumpsOut.length, bumpsIn: lc.bumpsIn.length }));
      if (jr.n < 8) console.log('   (too few contacts this run to judge the phantom share)');
      else assert(jr.phantom <= jr.n * 0.1, `chase contacts at 120 ms: the runner’s phone only scrapes where the cop really is (${jr.phantom}/${jr.n} phantom steps)`);
      assert(jc.phantom <= Math.max(2, jc.n * 0.1), `chase contacts at 120 ms: the cop’s phone too (${jc.phantom}/${jc.n})`);
      const sr = await st(R); const sc = await st(C);
      assert(Math.abs(sr[rw].hp - sc.partnerSeen.hp) < 1.5 || sc.partnerSeen.hp == null, 'both phones agree on the runner’s damage');
      void cw;
      h.assertNoErrors();
    } catch (e) { fails++; console.error(e.message, h.errors.slice(0, 5)); } finally { await h.close(); }
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
      const pf0 = await hook(a, 'perf');
      if (pf0.programs !== pf0.programs0) console.log('   programs', JSON.stringify(pf0.programNames0), JSON.stringify(pf0.programNames));
      const pf = pf0;
      assert(pf.programs === pf.programs0, `every shader was compiled behind the loading screen (${pf.programs0} programs)`);
      const lost = await hook(a, 'loseContext');
      if (lost) {
        await until(a, () => window.__getaway.state().paused, null, 3000, 'paused on context loss');
        await until(a, () => !window.__getaway.state().paused, null, 10000, 'resumed after the context came back');
        console.log('ok - GL context loss pauses, restore resumes');
      }

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
      const s0 = await st(a);
      await hook(a, 'hold', 'a', { gas: 1 });
      await wait(2000);
      const s = await st(a);
      // (moved, not "still fast": one Dockside spawn can sit a few car lengths behind traffic queued at a light)
      const moved = Math.hypot(s.a.x - s0.a.x, s.a.z - s0.a.z);
      assert((s.a.speed > 5 || moved > 4) && !h.errors.length, `a chase after several switches drives and renders cleanly (${moved.toFixed(1)} m, now ${s.a.speed.toFixed(1)} m/s)`);
      h.assertNoErrors();
    } catch (e) { fails++; console.error(e.message, h.errors.slice(0, 3)); await shot(h.a, 'mapswitch-fail').catch(() => {}); } finally { await h.close(); }
  }

  if (want('gfx')) {
    // ═══ graphics: vertex packing, the caster scene + shadow map, the dynamic-quality ladder, the camera rig ═══
    const h = await launch({ port: PORT + 9, only: ['getaway'], who: ['a'], coarse: true });
    const { a } = h;
    try {
      await a.setViewportSize({ width: 390, height: 844 });
      await arm(a, { ...FAST, maxDpr: 1, dynRes: true, dynK: 0.1, tier: 'mid' });
      await h.startLive(a, 'getaway', 'local');
      await ready(a);
      const maps = (await hook(a, 'maps')).filter((m) => !m.stub).map((m) => m.id);
      for (const id of maps) {
        await a.evaluate((m) => window.__getaway.reloadMap(m), id);
        await wait(300);
        const g = await a.evaluate(() => {
          const w = window.__getaway.internals.world; let verts = 0; let gpu = 0; let cpu = 0; let f32 = 0; const types = {}; let n = 0; const mis = [];
          // GPU bytes: the arrays, or (released CPU copies) the size the world recorded before dropping them
          const SZ = { position: 4, normal: 4 / 3, color: 4 / 3, fx: 4, aux: 4, uv: 2, a: 4 };
          w.scene.traverse((o) => {
            if (!o.isMesh || !o.name || !(o.name.startsWith('merged') || o.name.startsWith('boulder'))) return; n++;
            const ge = o.geometry; const pa = ge.getAttribute('position'); verts += pa.count;
            for (const k in ge.attributes) { const at = ge.attributes[k]; const sz = at.array ? at.array.byteLength : at.gpuBytes || at.count * at.itemSize * (SZ[k] || 4); gpu += sz; if (at.array) cpu += sz; const t = at.array ? at.array.constructor.name : 'released'; types[k] = types[k] || t; if (at.array instanceof Float32Array && (k === 'normal' || k === 'color' || k === 'uv')) f32++; const strideB = (at.array ? at.array.byteLength : at.gpuBytes) / at.count; if ((strideB % 4) || (at.isInterleavedBufferAttribute && at.offset)) mis.push(k + ' ' + strideB); }
            if (ge.index) { const sz = ge.index.array ? ge.index.array.byteLength : ge.index.gpuBytes || ge.index.count * 2; gpu += sz; if (ge.index.array) cpu += sz; }
          });
          return { n, verts, gpu, cpu, types, f32, released: w.released, bpv: gpu / verts, mis: [...new Set(mis)] };
        });
        console.log(`   ${id}: ${g.n} world meshes, ${Math.round(g.verts / 1000)}k vertices, ${(g.gpu / 1048576).toFixed(1)} MB on the GPU (${g.bpv.toFixed(1)} B/vertex with indices), ${(g.cpu / 1048576).toFixed(1)} MB still CPU-side (positions)${g.released ? '' : ' NOT RELEASED'}, attributes ${JSON.stringify(g.types)}`);
        assert(g.f32 === 0, `${id}: no float32 normals / colours / uvs left on the world meshes (${g.f32})`);
        assert(g.mis.length === 0, `${id}: every vertex buffer has a 4-byte-multiple stride (Metal / ANGLE converts the rest): ${g.mis.join(', ') || 'all aligned'}`);
        soft(g.bpv <= 32, `${id}: ≤ 32 B/vertex on the GPU including indices (${g.bpv.toFixed(1)}; 44–52 B before packing)`);
      }
      // a fresh (unreleased) Builder: 28 bytes per vertex with lane coordinates (24 without)
      const bpv = await a.evaluate(() => {
        const w = window.__getaway.internals.world; const b = w.kit.builder(); b.boxOn(0, 0, 0, 1, 1, 1, 0, '#ff8800', 0.02, 5); b.auxV = 1.5; b.boxOn(2, 0, 0, 1, 1, 1, 0, '#ff8800', 0, 0);
        const g = b.geometryOut(); let bytes = 0; for (const k in g.attributes) bytes += g.attributes[k].array.byteLength; const n = g.getAttribute('position').count;
        const nm = g.getAttribute('normal'); const co = g.getAttribute('color'); const ax = g.getAttribute('aux'); const fx = g.getAttribute('fx');
        return { bpv: bytes / n, n, normal: nm.array.constructor.name + (nm.normalized ? '/n' : ''), color: co.array.constructor.name + (co.normalized ? '/n' : ''), fx: fx.array.constructor.name, aux: ax.array.constructor.name + (ax.normalized ? '/n' : ''), auxV: ax.getX(n - 1), col: co.getX(0) / 255, nz: nm.getY(0) / 127, stride: [nm, co].map((x) => x.isInterleavedBufferAttribute ? x.data.stride * x.array.BYTES_PER_ELEMENT : x.itemSize * x.array.BYTES_PER_ELEMENT) };
      });
      console.log(`   Builder: ${bpv.bpv.toFixed(1)} B/vertex (${bpv.normal} normal, ${bpv.color} color, ${bpv.fx} fx, ${bpv.aux} aux)`);
      assert(bpv.bpv <= 28.01 && bpv.stride.every((x) => x === 4), `Builder output is 28 B/vertex with 4-byte normal / colour strides (${bpv.bpv.toFixed(1)}, strides ${bpv.stride}; was 44)`);
      assert(Math.abs(bpv.auxV - 1.5) < 0.001 && Math.abs(bpv.col - 1) < 0.001, `quantised colour / normal round-trip, exact aux (aux ${bpv.auxV.toFixed(4)}, r ${bpv.col.toFixed(3)})`);
      // the caster scene + the phone shadow map
      const sh = await a.evaluate(() => { const w = window.__getaway.internals.world; return { groups: w.casters.children.filter((o) => o.isGroup).length, kids: w.casters.children.length, size: w.shadow && w.shadow.size, full: w.shadow && w.shadow.full, taps: w.shadow ? window.__getaway.internals.world.mats.vc.userData.gtw && 1 : 0, parent: w.casters.parent === w.scene }; });
      console.log(`   casters: ${sh.groups} car groups + ${sh.kids - sh.groups} meshes, shadow map ${sh.size}²`);
      assert(sh.groups === 4 && sh.parent && sh.full === 512, `the cars live in the caster scene (a child of the world) and the mid tier uses a 512² shadow map (${sh.full}, now ${sh.size}² after software-GL frames)`);
      // no shadow pass in the lobby (no car group visible): render call count equals the main passes only
      let pf;
      const lobbyPass = await a.evaluate(() => { const w = window.__getaway.internals.world; const r = window.__getaway.internals.renderer; const cam = new window.THREE.PerspectiveCamera(); cam.updateMatrixWorld(); r.info.autoReset = false; r.info.reset(); w.preRender(r, cam); const c = r.info.render.calls; r.info.autoReset = true; return c; });
      assert(lobbyPass === 0, `the shadow pass is skipped while no car is in the game (${lobbyPass} draws)`);
      // the dynamic-quality ladder, driven by a synthetic frame time (dynK 0.1: 1 s here = 10 s on a phone)
      await hook(a, 'fakeFrame', 16, true); // (software GL frames had already walked it to the bottom rung)
      await wait(400);
      pf = await hook(a, 'perf');
      assert(pf.level === 0 && pf.shadow.size === 512 && pf.scale === 1, `reset to the top rung (${JSON.stringify({ level: pf.level, shadow: pf.shadow, scale: pf.scale })})`);
      await hook(a, 'fakeFrame', 22);
      await until(a, () => window.__getaway.perf().level >= 1, null, 8000, 'first rung');
      pf = await hook(a, 'perf');
      assert(pf.level === 1 && pf.resizes === 0 && pf.shadow.size < 512 && pf.shadow.on, `the first rung down shrinks the shadow map (${pf.shadow.size}²), no drawable resize ${JSON.stringify(pf)}`);
      await until(a, () => window.__getaway.perf().level >= 4, null, 8000, 'bottom rung');
      pf = await hook(a, 'perf');
      assert(pf.resizes === 2 && pf.scale <= 0.7 && !pf.shadow.on, `rungs 2–4: two resizes (0.85, then the floor ${pf.scale}), then the shadow goes (${pf.resizes} resizes)`);
      await hook(a, 'fakeFrame', 14);
      await wait(1200); // < hold (2 s here)
      pf = await hook(a, 'perf');
      assert(pf.level === 4, `no step up within the hold after a step down (level ${pf.level})`);
      await until(a, () => window.__getaway.perf().level <= 3, null, 45000, 'step up'); // (game time: dt is clamped at 125 ms, slower frames stretch it)
      const tUp = Date.now();
      await until(a, () => window.__getaway.perf().level === 0, null, 60000, 'back to full');
      pf = await hook(a, 'perf');
      const climb = (Date.now() - tUp) / 1000;
      assert(climb >= 1.8 && pf.resizes === 4, `climbing back takes ≥ 0.8 s a rung here (= 8 s on a phone; ${climb.toFixed(1)} s for three rungs), ${pf.resizes} resizes in all`);
      // a phone at the edge: slow again right after stepping up → the hold doubles (back-off)
      await hook(a, 'fakeFrame', 22);
      await until(a, () => window.__getaway.perf().level >= 1, null, 10000, 'bounce');
      pf = await hook(a, 'perf');
      assert(pf.hold >= 40, `a step down right after a step up doubles the hold (${pf.hold} s)`);
      await hook(a, 'fakeFrame', 0);
      // the camera rig: a chase at speed, portrait phone
      await hook(a, 'setSetup', { map: maps[0] });
      await a.click('.g-gtw [data-l="start"]');
      await phase(a, 'chase', 15000);
      await until(a, () => window.__getaway.navReady(), null, 20000, 'nav');
      await hook(a, 'auto', 'a', true);
      const rig = []; const t0 = Date.now();
      while (Date.now() - t0 < 6000) { const [r, s] = await a.evaluate(() => [window.__getaway.camRig(), window.__getaway.state().a]); rig.push({ ...r, speed: s.speed, dist: Math.hypot(r.x - s.x, r.z - s.z) }); await wait(100); }
      const fast = rig.filter((r) => r.speed > 20);
      const maxD = Math.max(...rig.map((r) => r.dist)); const fovHi = Math.max(...rig.map((r) => r.fov)); const fovLo = Math.min(...rig.map((r) => r.fov));
      console.log(`   camera: ${rig.length} samples, top speed ${(Math.max(...rig.map((r) => r.speed)) * 3.6).toFixed(0)} km/h, follow distance ≤ ${maxD.toFixed(1)} m, fov ${fovLo.toFixed(0)}–${fovHi.toFixed(0)}`);
      assert(maxD <= (7.4 + 2.2 + 1.0) * 1.3 + 0.3, `the follow distance never exceeds the rig's goal (no speed lag): ${maxD.toFixed(1)} m ≤ ${((7.4 + 2.2 + 1.0) * 1.3).toFixed(1)} m`);
      assert(fast.length === 0 || Math.max(...fast.map((r) => r.d)) > 7.4 * 1.3 - 0.5, `the lens sits further back at speed (${fast.length} fast samples)`);
      // liveries (liveries.js): every paint job builds, swaps in place and keeps the one draw call per car
      const lv = await a.evaluate(() => {
        const I = window.__getaway.internals; const out = [];
        for (const [view, who, n] of [['runA', 'a', 5], ['cop', 'b', 4]]) for (let k = 0; k < n; k++) {
          window.__getaway.testLivery(who, view === 'runA' ? k : 0, view === 'cop' ? k : 0); const v = I.carViews[view]; const t = performance.now(); v.setLivery(k);
          out.push({ view, k, ms: Math.round(performance.now() - t), verts: v.body.geometry.getAttribute('position').count, got: v.livery, kids: v.tilt.children.length });
        }
        return out;
      });
      console.log(`   liveries: ${lv.map((x) => `${x.view}${x.k} ${x.verts}v/${x.ms}ms`).join(', ')}`);
      assert(lv.every((x) => x.got === x.k && x.verts > 4000 && x.ms < 200 && x.kids === 1), 'every livery builds in place (< 200 ms, one body mesh, > 4k vertices)');
      assert(new Set(lv.filter((x) => x.view === 'runA').map((x) => x.verts)).size === 5, 'the five runner liveries are different models');
      h.assertNoErrors();
    } catch (e) { fails++; console.error(e.message, h.errors.slice(0, 3)); await shot(h.a, 'gfx-fail').catch(() => {}); } finally { await h.close(); }
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
        // every task while a map loads, the first render after it included (the GPU warm-up): long-task observer
        await a.evaluate(() => { window.__gtwLT = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__gtwLT.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] }); } catch { window.__gtwLT = null; } });
        const maps = await hook(a, 'maps');
        for (const m of maps) {
          if (m.stub) { console.log(`   ${m.name}: stub (coming soon), skipped`); continue; }
          const lt0 = await a.evaluate(() => performance.now());
          // (a fresh build each time, also for the map that's already in: the boot load had no observer)
          if ((await st(a)).mapId === m.id) await a.evaluate((id) => window.__getaway.reloadMap(id), m.id);
          else await hook(a, 'setSetup', { map: m.id });
          await until(a, (id) => { const s = window.__getaway.state(); return s.mapId === id && !s.loading; }, m.id, 180000, 'map ' + m.id);
          await wait(600); // the first frames after ready
          const lt1 = await a.evaluate(() => performance.now());
          await wait(2000); // steady lobby frames: what one ordinary frame costs on this (software) GL
          const pf = await hook(a, 'perf');
          const wl = (pf.build && pf.build.load) || {};
          // from the moment the load starts (the old map's last frames don't count) to 600 ms after ready
          const ltRaw = await a.evaluate((t) => window.__gtwLT && window.__gtwLT.filter((x) => x[0] >= t[0] && x[0] < t[1]).map((x) => [Math.round(x[0] - t[0]), Math.round(x[1])]), [Math.max(lt0, (wl.startAt || 0) - 20), lt1]);
          const lts = ltRaw && ltRaw.map((x) => x[1]);
          const steady = await a.evaluate((t) => window.__gtwLT && window.__gtwLT.filter((x) => x[0] >= t).map((x) => x[1]).sort((x, y) => x - y), lt1);
          if (lts) {
            // Each long task is either a game frame (the game's frame callback ran in it: a few ms of
            // JS plus SwiftShader rasterising the whole frame) or load work (build slices, uploads,
            // first draws). Load work must stay within ~an ordinary frame (or ~200 ms). The first
            // frames after ready run up to ~1.3× a steady one in software GL (and more on a busy
            // machine) — that's the software rasteriser, not the load — so frames get 2×, which
            // still catches real work landing in a frame (a lazy compile or upload is 100s of ms).
            const fr = await a.evaluate((t) => (window.__gtwFrames || []).filter((f) => f >= t[0] - 5 && f < t[1] + 5), [Math.max(lt0, (wl.startAt || 0) - 20), lt1]);
            const t00 = Math.max(lt0, (wl.startAt || 0) - 20);
            const isFrame = (x) => fr.some((f) => f >= t00 + x[0] - 1 && f <= t00 + x[0] + Math.min(x[1], 60));
            const frame = steady.length ? Math.round(steady[steady.length >> 1]) : 0;
            const work = ltRaw.filter((x) => !isFrame(x)).map((x) => x[1]); const frames = ltRaw.filter(isFrame).map((x) => x[1]);
            const worst = Math.max(0, ...work); const worstF = Math.max(0, ...frames);
            const cap = Math.max(250, Math.round(frame * 1.3)); const capF = Math.max(250, Math.round(frame * 2));
            console.log(`   ${kind} ${m.name}: load → first frames: longest load task ${worst} ms, longest frame ${worstF} ms (an ordinary frame here: ${frame || '<50'} ms; GPU warm-up ${wl.warmUp} ms in ${wl.warmSlices} slices, longest JS ${wl.warmMaxMs} ms, longest frame gap ${wl.warmGap} ms at ${wl.warmGapAt}; tasks > 200 ms at +ms: ${JSON.stringify(ltRaw.filter((x) => x[1] > 200).map((x) => [...x, isFrame(x) ? 'frame' : 'load']))}, ready at +${Math.round(wl.readyAt - t00)})`);
            soft(worst <= cap, `${kind} ${m.name}: loading never blocks much longer than an ordinary frame or ~200 ms (${worst} ms ≤ ${cap} ms, software GL)`);
            soft(worstF <= capF, `${kind} ${m.name}: the first frames after a load are ordinary frames (${worstF} ms ≤ 2 × ${frame} ms, software GL)`);
          }
          const views = await a.evaluate(() => {
            const g = window.__getaway; const out = [];
            const sp = g.internals.S.mapEntry.spawns || [];
            const pts = sp.map((s) => s.runner);
            const roads = g.roads(); for (let i = 0; i < 6 && roads.length; i++) { const r = Math.floor((i * 7919) % roads.length); const p = g.roadPoint(r, (roads[r].len * (i + 1)) / 7); pts.push({ x: p.x, z: p.z, yaw: p.yaw }); }
            for (const p of pts) for (let k = 0; k < 4; k++) out.push(g.measureView(p.x, p.z, (p.yaw || 0) + (k * Math.PI) / 2, k === 3 ? 'far' : 'near'));
            return out;
          });
          const maxCalls = Math.max(...views.map((v) => v.calls)); const maxTris = Math.max(...views.map((v) => v.tris));
          console.log(`   ${kind} ${m.name}: build ${pf.build.buildMs} ms (longest block ${pf.build.maxBlockMs} ms), ${pf.build.chunks} chunks, ${Math.round(pf.build.tris / 1000)}k triangles in the map; in view: ≤ ${maxCalls} draw calls, ≤ ${Math.round(maxTris / 1000)}k triangles over ${views.length} views; stages ${JSON.stringify(pf.build.stages)}`);
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
          await arm(a, { ...FAST, intro: 2500, count: 1500, result: 4000, maxDpr: 1.5 });
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
          await wait(1350);
          await shot(a, `${label}-${w}x${hh}-${scheme}-result`);
          h.assertNoErrors();
        } catch (e) { fails++; console.error(e.message); await shot(h.a, `shots-${label}-${scheme}-fail`).catch(() => {}); } finally { await h.close(); }
      }
    }
    console.log('   screenshots in', SHOTS);
  }

  // ═══ stall: one phone's main thread hitches for 1.2 s mid-chase next to the partner (ENGINE):
  // the partner car goes stale (a ghost: not solid, no bump, no damage) instead of a stale solid
  // picture that snaps 20–40 m when the stream resumes ═══
  if (want('stall')) {
    const h = await launch({ port: PORT + 2, only: ['getaway'], latency: 80, coarse: true });
    const { a, b } = h;
    try {
      await openPair(h, { ...FAST, rounds: 2 });
      await startMatch(h);
      await phase(a, 'chase'); await phase(b, 'chase');
      await hook(a, 'hold', 'a', { hand: true }); await hook(b, 'hold', 'b', { hand: true });
      await a.evaluate(() => window.__getaway.teleport('a', -100, 40, Math.PI / 2, 0));
      await b.evaluate(() => window.__getaway.teleport('b', -108, 40, Math.PI / 2, 0));
      await wait(1500);
      const fresh = await a.evaluate(() => ({ stale: !!window.__getaway.internals.P2.b.stale, age: window.__getaway.internals.link.sampleAge }));
      console.log(`   (the partner's stream before the hitch: ${Math.round(fresh.age)} ms old, stale ${fresh.stale}; a starved headless page publishes per frame)`);
      // the cop now drives at the runner; a moment later its phone freezes for 1.2 s
      await hook(b, 'hold', 'b', { gas: 1 });
      await wait(250);
      const hp0 = (await st(a)).a.hp;
      // (the watcher runs inside page a at 50 ms: a starved Node round trip would miss the hitch)
      await a.evaluate(() => { const W = window.__stall = { stale: 0, n: 0, hpMin: 100, jump: 0, px: null }; const tick = () => { if (W.done) return; const P = window.__getaway.internals.P2.b; const s = window.__getaway.state(); W.n++; if (P.stale) W.stale++; W.hpMin = Math.min(W.hpMin, s.a.hp); if (W.px != null) W.jump = Math.max(W.jump, Math.abs(P.shown.x - W.px)); W.px = P.shown.x; requestAnimationFrame(tick); }; requestAnimationFrame(tick); }); // (per frame of a: its timers may be throttled, its frames are what the player sees)
      // (the hitch is b's frame loop held for 1.2 s, not a busy loop: headless pages of one origin
      // share a renderer process, so a busy loop in b froze a's watcher too: 2 polls in 1.8 s)
      await b.evaluate(() => { const raf = window.requestAnimationFrame; const q = []; window.requestAnimationFrame = (f) => { q.push(f); return 0; }; setTimeout(() => { window.requestAnimationFrame = raf; for (const f of q) raf(f); }, 1600); });
      await wait(1600);
      await wait(600);
      const seen = await a.evaluate(() => { const W = window.__stall; W.done = true; return { stale: W.stale, n: W.n, hpMin: W.hpMin, jump: W.jump }; });
      assert(seen.stale > 0, `during a 1.6 s hitch the runner's phone marks the cop stale (${seen.stale} of ${seen.n} polls) and makes it a ghost`);
      assert(seen.hpMin === hp0, `no bump or damage against the stale picture (hp ${hp0} → ${seen.hpMin})`);
      assert(seen.jump < 12, `the drawn cop never snaps when the stream resumes (largest jump between polls ${seen.jump.toFixed(1)} m)`);
      await wait(1500);
      const after = await a.evaluate(() => !!window.__getaway.internals.P2.b.stale);
      assert(!after, 'the cop is solid again once its samples flow');
      h.assertNoErrors();
    } finally { await h.close(); }
  }

  if (fails) { console.log(`\n${fails} FAILED`); process.exitCode = 1; } else console.log('\nALL GOOD');
})();

// ═══ engine v2 units (ENGINE): traffic at junctions and what's drawn, wrecks, the road graph,
// the practice AI reaching the player and getting unstuck on every map ═══
async function engineUnits() {
  const url = (f) => 'file://' + path.join(ROOT, 'js/games/getaway', f);
  const { createGeo } = await import(url('geo.js'));
  const { buildRoadGraph } = await import(url('roadgraph.js'));
  const C = await import(url('car.js'));
  const { CAR, NITRO, DT, TRAFFIC } = await import(url('tune.js'));
  const { createTraffic } = await import(url('traffic.js'));
  const { createDriver, AI_LEVELS } = await import(url('ai.js'));
  const { MAPS } = await import(url('maps/index.js'));
  assert(AI_LEVELS.join() === 'easy,normal,hard', 'AI levels: easy, normal, hard');
  const nq = {}; const ct = {}; const tp = {};
  for (const id of ['dockside', 'boulder', 'santee']) {
    const e = MAPS.find((m) => m.id === id);
    if (e.prepare) await e.prepare({});
    const geo = createGeo(e);
    // the road graph: built in slices it's identical to one go, and every map is one network
    let g = null; let slices = 0; while (geo.buildNav(5) < 1 && slices < 5000) slices++; g = geo.roadGraph();
    const g1 = buildRoadGraph(createGeo(e));
    const comp = new Int32Array(g.nodes.n).fill(-1); let ncomp = 0;
    for (let s0 = 0; s0 < g.nodes.n; s0++) { if (comp[s0] >= 0) continue; const st = [s0]; comp[s0] = ncomp; while (st.length) { const u = st.pop(); for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) { const v = g.edges.to[g.adj[k]]; if (comp[v] < 0) { comp[v] = ncomp; st.push(v); } } } ncomp++; }
    const sizes = new Array(ncomp).fill(0); for (const c of comp) sizes[c]++;
    assert(g.nodes.n === g1.nodes.n && g.edges.cost.length === g1.edges.cost.length && Math.max(...sizes) / g.nodes.n > 0.97, `${id}: road graph ${g.nodes.n} nodes in ${slices + 1} slices = one go; ${(Math.max(...sizes) / g.nodes.n * 100).toFixed(0)}% in one network`);
    // traffic: crossing cars take turns at signalled junctions, so they don't drive through each other
    const tr = createTraffic(geo, id, 'normal');
    let pairs = 0; let samples = 0;
    for (let t = 600; t < 690; t += 0.5) {
      samples++;
      const all = []; for (const L of tr.lanes) for (let j = 0; j < L.n; j++) { const p = {}; tr.poseOn(L, j, t, p); if (p.sc >= 0.95) all.push(p); }
      const grid = new Map(); for (const p of all) { const k = Math.floor(p.x / 10) + ',' + Math.floor(p.z / 10); (grid.get(k) || grid.set(k, []).get(k)).push(p); }
      for (const p of all) { const cx = Math.floor(p.x / 10); const cz = Math.floor(p.z / 10); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const l = grid.get((cx + dx) + ',' + (cz + dz)); if (!l) continue; for (const q of l) if (q.id > p.id && Math.abs(p.y - q.y) < 2.5 && C.carContact(p, q, ct) > 0.2) pairs++; } }
    }
    const lim = { dockside: 0.1, boulder: 1, santee: 0.2 }[id];
    assert(pairs / samples <= lim, `${id}: traffic doesn’t drive through traffic (${(pairs / samples).toFixed(2)} overlapping pairs at a time, was 2–12.6; ${tr.signals.filter(Boolean).length} signalled junctions)`);
    // every car close enough to hit is drawn (the nearest TRAFFIC.max go to the GPU)
    const rnd = (() => { let a = 99; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; })();
    let miss = 0; let near = 0; const sel = [];
    for (let k = 0; k < 40; k++) {
      const p = geo.randomRoadPoint(rnd, {}); const t = 600 + k * 3.1;
      const n = tr.select([{ x: p.x, z: p.z }], t, TRAFFIC.max, TRAFFIC.near, sel); const ids = new Set(sel.slice(0, n).map((q) => q.id));
      tr.each(p.x, p.z, 60, t, (cid, q) => { if (q.sc < 0.95 || Math.hypot(q.x - p.x, q.z - p.z) > 60) return; near++; if (!ids.has(cid)) miss++; });
    }
    assert(miss === 0, `${id}: every traffic car within 60 m of the player is drawn (${near} checked at 40 spots)`);
    // spawn clearing: at the go (traffic time 600) no civilian car can be hit near either spawn, the
    // shared schedule is untouched, and after the zones lapse the cars are back
    {
      const tc = createTraffic(geo, id, 'normal'); const h0 = tc.hash(600.2);
      const zones = []; for (const sp of e.spawns) zones.push({ x: sp.runner.x, z: sp.runner.z, r: 30, t1: 606 }, { x: sp.cop.x, z: sp.cop.z, r: 30, t1: 606 });
      tc.setClear(zones);
      let solid = 0; let hidden = 0; let back = 0;
      for (const t of [598, 600, 602, 605.9]) for (const z of zones) tc.each(z.x, z.z, 24, t, (cid, q, wr) => { if (wr) return; if (Math.hypot(q.x - z.x, q.z - z.z) < 24 && q.sc >= 0.95) solid++; });
      tc.setClear([]); for (const z of zones) tc.each(z.x, z.z, 24, 600, (cid, q) => { if (Math.hypot(q.x - z.x, q.z - z.z) < 24 && q.sc >= 0.95) hidden++; });
      tc.setClear(zones); for (const z of zones) tc.each(z.x, z.z, 24, 610, (cid, q) => { if (Math.hypot(q.x - z.x, q.z - z.z) < 24 && q.sc >= 0.95) back++; });
      assert(solid === 0 && tc.hash(600.2) === h0 && (hidden === 0 || back > 0), `${id}: traffic keeps clear of the spawns at the go (${hidden} cars would sit within 24 m of a spawn; ${solid} with clearing; ${back} back 4 s later)`);
    }
    // the AI cop reaches a parked runner from the spawns, through traffic, and gets unstuck
    const traffic = createTraffic(geo, id, 'normal');
    const runs = []; let maxMs = 0;
    const builds = geo.solids.filter((o) => o.kind === 'building' && o.hw > 3 && o.hd > 3);
    for (let run = 0; run < 3; run++) {
      traffic.clearWrecks();
      const sp = e.spawns[run % e.spawns.length]; let goal = geo.randomRoadPoint(rnd, {});
      for (let q = 0; q < 50 && Math.hypot(goal.x - sp.cop.x, goal.z - sp.cop.z) > 1200; q++) goal = geo.randomRoadPoint(rnd, {});
      let bStart = null;
      if (run === 2 && builds.length) {
        for (let q = 0; q < 300 && !bStart; q++) { const o = builds[Math.floor(rnd() * builds.length)]; geo.nearestRoad(o.x, o.z, nq, 40); if (nq.road >= 0 && !geo.roads[nq.road].bridge && nq.d > Math.max(o.hw, o.hd) + 3) bStart = { o, px: nq.px, pz: nq.pz }; }
        if (bStart) for (let q = 0; q < 200; q++) { const dd = Math.hypot(goal.x - bStart.o.x, goal.z - bStart.o.z); if (dd > 200 && dd < 600) break; goal = geo.randomRoadPoint(rnd, {}); }
      }
      const rn = C.newCar('runner'); const cp = C.newCar('cop');
      C.placeCar(rn, goal.x - goal.tz * 2.5, goal.z + goal.tx * 2.5, Math.atan2(goal.tx, -goal.tz), geo);
      let stuckStart = false;
      if (run === 2 && builds.length) {
        // nose against a building beside a road: it has to back out and find its way
        const b = bStart;
        if (b) {
          const { o } = b; let dx = b.px - o.x; let dz = b.pz - o.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
          // walk out from the box centre until a car fits, nose towards the building
          let d = 0; const yaw = Math.atan2(-dx, dz);
          for (; d < 60; d += 0.25) { C.placeCar(cp, o.x + dx * d, o.z + dz * d, yaw, geo); let hit = false; geo.eachSolid(cp.x, cp.z, 4, (s) => { if (!s.broken && !s.breakable && Math.abs(s.x - cp.x) < s.rad + 3 && Math.abs(s.z - cp.z) < s.rad + 3) { const sv = { x: s.x, z: s.z, yaw: -s.rot, hl: s.hd, hw: s.hw }; if (C.carContact(cp, sv, ct) > 0) hit = true; } }); if (!hit) break; }
          C.placeCar(cp, o.x + dx * (d + 0.3), o.z + dz * (d + 0.3), yaw, geo); stuckStart = true;
        }
      }
      if (!stuckStart) C.placeCar(cp, sp.cop.x, sp.cop.z, sp.cop.yaw, geo);
      const drv = createDriver(geo, 'cop', { seed: 9 + run, level: 'normal' });
      const x0 = cp.x; const z0 = cp.z;
      let acc = 0; let t = 0; let off = 0; let reach = null; let left = false;
      for (; t < 180; t += DT) {
        acc += DT;
        if (acc >= 1 / 30) { acc -= 1 / 30; const los = geo.lineOfSight(cp.x, cp.z, cp.y, rn.x, rn.z, rn.y); drv.update(1 / 30, cp, rn, { los, traffic, tT: 600 + t, spikesLeft: 0, viewer: { x: rn.x, z: rn.z } }); if (drv.out.warp) C.placeCar(cp, drv.out.warp.x, drv.out.warp.z, drv.out.warp.yaw, geo); }
        C.stepCar(cp, drv.out, DT, geo, CAR.cop, NITRO.cop); cp.ev.length = 0;
        traffic.each(cp.x, cp.z, 8, 600 + t, (cid, q) => { if (q.sc < 0.95) return; Object.assign(tp, q); tp.r = 0; if (C.carContact(cp, tp, ct) > 0) { const v = C.resolveCar(cp, tp, ct, 1, 0.8, 1); if (v > TRAFFIC.knockMin) traffic.knock(cid, q, -ct.nx * ct.j * 0.8, -ct.nz * ct.j * 0.8, 0); } });
        if (Math.round(t / DT) % 4 === 0) { traffic.stepWrecks(DT * 4, [cp]); traffic.yieldTo(DT * 4, 600 + t, [{ x: cp.x, z: cp.z, yaw: cp.yaw, siren: true }, { x: rn.x, z: rn.z }]); }
        if (process.env.AITR === id + run && Math.round(t / DT) % 30 === 0 && t > +(process.env.AIT0 || 0)) console.log('   tr', t.toFixed(1), cp.x.toFixed(0), cp.z.toFixed(0), 'v', cp.speed.toFixed(1), drv.state.mode, drv.state.pit, 'lane', drv.state.laneK, 'offR', (drv.state.offRoute || 0).toFixed(1), 'tgt', (drv.state.tx || 0).toFixed(0), (drv.state.tz || 0).toFixed(0), 'left', (drv.state.routeLeft || 0).toFixed(0), 'free', (drv.state.tFree || 0).toFixed(0), 'rev', drv.state.revT > 0, 'st', drv.out.steer.toFixed(2), 'd', Math.hypot(rn.x - cp.x, rn.z - cp.z).toFixed(0));
        if (cp.level < 0) { geo.nearestRoad(cp.x, cp.z, nq, 30); if (!(nq.road >= 0 && nq.d <= geo.roads[nq.road].hw + 1.5)) { off += DT; if (process.env.AIDBG && Math.round(t / DT) % 60 === 0) console.log('   off', id, run, t.toFixed(1), cp.x.toFixed(0), cp.z.toFixed(0), nq.road >= 0 ? geo.roads[nq.road].name : '-', (nq.d - (nq.road >= 0 ? geo.roads[nq.road].hw : 0)).toFixed(1), geo.surfaceAt(cp.x, cp.z), drv.state.mode, drv.state.laneK, 'v', cp.speed.toFixed(1), 'vT', (drv.state.vT || 0).toFixed(1), 'free', (drv.state.tFree || 0).toFixed(0), 'offR', (drv.state.offRoute || 0).toFixed(1), 'shift', drv.state.laneShift.toFixed(1), 'left', (drv.state.routeLeft || 0).toFixed(0), 'rev', drv.state.revT > 0, 'curve', (drv.state.vCurve || 0).toFixed(0)); } }
        if (Math.hypot(cp.x - x0, cp.z - z0) > 15) left = true;
        if (Math.hypot(rn.x - cp.x, rn.z - cp.z) < 15) { reach = t; break; }
      }
      maxMs = Math.max(maxMs, drv.state.stats.maxMs);
      runs.push({ reach, off: off / t, stuckStart, end: Math.round(Math.hypot(rn.x - cp.x, rn.z - cp.z)), left, d0: Math.round(Math.hypot(rn.x - x0, rn.z - z0)), stucks: drv.state.stats.stucks });
    }
    const ok = runs.filter((r) => r.reach !== null);
    assert(ok.length === runs.length && runs.every((r) => r.off < 0.15 || r.stuckStart), `${id}: the AI cop reaches a parked player through traffic (${runs.map((r) => `${r.d0} m in ${r.reach == null ? '— (' + r.end + ' m to go)' : r.reach.toFixed(0) + ' s'}, ${(r.off * 100).toFixed(0)}% off road${r.stuckStart ? ' from a building' : ''}`).join('; ')})`);
    const st0 = runs.find((r) => r.stuckStart);
    if (st0) assert(st0.left && st0.reach !== null, `${id}: started nose-in against a building, it backs out and gets there (${st0.stucks} stuck recoveries)`);
    soft(maxMs < 60, `${id}: AI think time per update in Node (max ${maxMs.toFixed(1)} ms; GC and a busy machine included)`);
    // practice: an Easy AI runner chased by a Hard AI cop from the first spawn drives away through
    // traffic (spawns kept clear at the go) and never sits still for long; on Dockside a Hard
    // runner from every spawn keeps to the road (a queue-bypass verge used to hold it on the grass
    // beside moving traffic for 10+ s: 29% of a 40 s chase off the road)
    const runs2 = id === 'dockside' ? [['easy', 20, 0], ...e.spawns.map((_, i) => ['hard', 40, i])] : [['easy', 20, 0]];
    const offs = [];
    for (const [rlv, secs, si] of runs2) {
      const tc = createTraffic(geo, id, 'normal'); const sp = e.spawns[si];
      tc.setClear([sp.runner, sp.cop].map((q) => ({ x: q.x, z: q.z, r: 30, t1: 606 })));
      const rn = C.newCar('runner'); const cp = C.newCar('cop');
      C.placeCar(rn, sp.runner.x, sp.runner.z, sp.runner.yaw, geo); C.placeCar(cp, sp.cop.x, sp.cop.z, sp.cop.yaw, geo);
      const dR = createDriver(geo, 'runner', { seed: 3 + si, level: rlv }); const dC = createDriver(geo, 'cop', { seed: 5 + si, level: 'hard' });
      let acc = 0; let hitR = false; let hitC = false; let path = 0; let top = 0; let spell = 0; let maxSpell = 0; let px = rn.x; let pz = rn.z; let nOff = 0; let nAll = 0;
      for (let t = 0; t < secs; t += DT) {
        acc += DT; const tT = 600 + t;
        if (acc >= 1 / 30) {
          acc -= 1 / 30; const los = geo.lineOfSight(cp.x, cp.z, cp.y, rn.x, rn.z, rn.y);
          dR.update(1 / 30, rn, cp, { los, traffic: tc, tT, oilLeft: 0, hit: hitR }); dC.update(1 / 30, cp, rn, { los, traffic: tc, tT, spikesLeft: 0, hit: hitC, viewer: { x: 1e6, z: 1e6 } }); hitR = hitC = false;
          for (const [d, c] of [[dR, rn], [dC, cp]]) if (d.out.warp) C.placeCar(c, d.out.warp.x, d.out.warp.z, d.out.warp.yaw, geo);
          path += Math.hypot(rn.x - px, rn.z - pz); px = rn.x; pz = rn.z; top = Math.max(top, rn.speed);
          // off the road: not on asphalt / a lot, and not on a road's own surface (dirt roads)
          nAll++; if (rn.surf !== 'road' && rn.surf !== 'lot') { geo.nearestRoad(rn.x, rn.z, nq, 40); if (!(nq.road >= 0 && nq.d <= geo.roads[nq.road].hw + 0.3)) nOff++; }
          // (pinned by the cop doesn't count: that's the cop's job)
          if (rn.speed < 1.2 && t > 1.5 && Math.hypot(rn.x - cp.x, rn.z - cp.z) > 14) { spell += 1 / 30; maxSpell = Math.max(maxSpell, spell); } else spell = 0;
        }
        C.stepCar(rn, dR.out, DT, geo, CAR.runner, NITRO.normal); C.stepCar(cp, dC.out, DT, geo, CAR.cop, NITRO.cop); rn.ev.length = 0; cp.ev.length = 0;
        if (C.carContact(rn, cp, ct) > 0) { C.resolvePair(rn, cp, ct, 1, 1); hitR = hitC = true; }
        for (const c of [rn, cp]) tc.each(c.x, c.z, 8, tT, (cid, q) => { if (q.sc < 0.95) return; Object.assign(tp, q); tp.r = 0; if (C.carContact(c, tp, ct) > 0) { if (c === rn) hitR = true; else hitC = true; const v = C.resolveCar(c, tp, ct, 1, 0.8, 1); if (v > TRAFFIC.knockMin) tc.knock(cid, q, -ct.nx * ct.j * 0.8, -ct.nz * ct.j * 0.8, 0); } });
        if (Math.round(t / DT) % 4 === 0) { tc.stepWrecks(DT * 4, [rn, cp]); tc.yieldTo(DT * 4, tT, [{ x: cp.x, z: cp.z, yaw: cp.yaw, siren: true, speed: cp.speed }, { x: rn.x, z: rn.z, yaw: rn.yaw }]); }
      }
      if (rlv === 'easy') assert(path > 150 && top * 3.6 > 60 && maxSpell < 3, `${id}: an Easy AI runner gets away from the spawn through traffic (${path.toFixed(0)} m in 20 s, top ${(top * 3.6).toFixed(0)} km/h, longest stop ${maxSpell.toFixed(1)} s, ${Math.round((100 * nOff) / nAll)}% off road)`);
      else offs.push(Math.round((100 * nOff) / nAll));
    }
    if (offs.length) assert(Math.max(...offs) <= 15, `${id}: a Hard AI runner chased by a Hard cop for 40 s from every spawn keeps to the road (${offs.join(' / ')}% off road)`);
  }
  // wrecks: a knocked car slides into a building and stops at its wall (not through it)
  { const geo = createGeo({ id: 'w', bounds: { x0: -500, z0: -500, x1: 500, z1: 500 }, roads: [{ name: 'a', kind: 'street', width: 10, pts: [[-400, 0], [400, 0]] }], solids: [{ kind: 'building', x: 0, z: 20, w: 40, d: 10, h: 8 }] });
    const tr = createTraffic(geo, 'w', 'normal');
    let id0 = -1; let pose = null; tr.each(0, 0, 400, 600, (id, p) => { if (id0 < 0 && p.sc > 0.95) { id0 = id; pose = { ...p }; } });
    pose.x = 0; pose.z = 5; tr.knock(id0, pose, 0, 25, 0);
    for (let i = 0; i < 120; i++) tr.stepWrecks(1 / 60, [{ x: 0, z: 0 }]);
    const k = tr.knocked.get(id0);
    assert(k && k.z < 15 - 1.0 && k.z > 5, `a knocked car stops at a building’s wall (${k && k.z.toFixed(2)} m, wall at 15)`); }
}

// ═══ feel pass units (ENGINE): steering resolution, the grip limit's feedback, PIT continuity and
// fairness, lift-off and nitro run-out, oil, humps, the Dockside carriageway, traffic grow-in ═══
async function feelUnits() {
  const url = (f) => 'file://' + path.join(ROOT, 'js/games/getaway', f);
  const { createGeo } = await import(url('geo.js'));
  const { newCar, placeCar, stepCar, carContact, judgePit, pitEffect } = await import(url('car.js'));
  const { CAR, NITRO, DT, DAMAGE } = await import(url('tune.js'));
  const { createTraffic } = await import(url('traffic.js'));
  const { DOCKSIDE } = await import(url('maps/dockside.js'));
  const lot = createGeo({ id: 'lot', bounds: { x0: -3000, z0: -3000, x1: 3000, z1: 3000 }, roads: [{ name: 'r', kind: 'highway', width: 30, pts: [[-2900, 0], [2900, 0]] }], solids: [], open: [{ kind: 'lot', poly: [[-2900, -2900], [2900, -2900], [2900, 2900], [-2900, 2900]] }] });
  const run = (role, inp, secs, setup, geo = lot) => { const c = newCar(role); placeCar(c, 0, 0, Math.PI / 2, geo); if (setup) setup(c); const out = []; for (let i = 0; i < secs / DT; i++) { stepCar(c, typeof inp === 'function' ? inp(c, i * DT) : inp, DT, geo, CAR[role], NITRO.normal); out.push({ t: i * DT, v: c.speed, x: c.x, z: c.z, r: c.r, slip: c.slip, skid: c.skid, drift: c.drift, heave: c.heave, pitch: c.pitch, yaw: c.yaw }); c.ev.length = 0; } return { c, out }; };
  // the slider keeps its resolution at chase speeds: 25 / 50 / 75 / 100 % steer = a linear 0.57 / 1.16 / 1.74 / 2.05 g at 60, 100 and 140 km/h
  for (const kmh of [60, 100, 140]) {
    const v = kmh / 3.6; const gs = [];
    for (const st of [0.25, 0.5, 0.75, 1]) { const o = run('runner', (c) => ({ gas: c.vf < v ? 1 : 0, steer: st }), 6, (c) => { c.vx = v; }).out.slice(-240); const sp = o.reduce((a, q) => a + q.v, 0) / o.length; const r = o.reduce((a, q) => a + Math.abs(q.r), 0) / o.length; gs.push((sp * r) / 9.81); }
    const lin = gs.every((g, i) => Math.abs(g / gs[3] - (i + 1) / 4 * 1.0) < 0.1 || Math.abs(g - [0.57, 1.16, 1.74, 2.05][i]) < 0.12);
    assert(lin && gs[3] > 1.9 && gs[3] < 2.2 && gs[0] < 0.7, `${kmh} km/h: 25/50/75/100% steer = ${gs.map((g) => g.toFixed(2)).join(' / ')} g (linear; was one response past 25% at 100+)`);
  }
  // the limit is audible: full lock at speed squeals (slip over CAR.slipSkid) and power at full lock steps the tail out without running away
  { const o = run('runner', (c) => ({ gas: c.vf < 27.8 ? 1 : 0, steer: 1 }), 6, (c) => { c.vx = 27.8; }).out.slice(-240);
    assert(o.some((q) => q.skid) && Math.max(...o.map((q) => q.slip)) < 3, `full lock at 100 km/h squeals (slip ${Math.max(...o.map((q) => q.slip)).toFixed(1)} m/s > ${CAR.slipSkid}) and still carves`);
    const p = run('runner', { gas: 1, steer: 1 }, 5, (c) => { c.vx = 27.8; }).out;
    const ms = Math.max(...p.map((q) => q.slip)); const md = Math.max(...p.map((q) => q.drift));
    assert(ms > 1.6 && ms < 3.4 && md > 0.1 && md < 0.6, `full gas + full lock from 100 km/h: the tail steps out (slip ${ms.toFixed(1)} m/s, drift ${md.toFixed(2)}) but never runs away (< 3.4 m/s)`); }
  // lift-off tightens the line (lift-off oversteer) and a lift is a decision: coasting from 100 km/h loses ≥ 1.8 m/s in the first second
  { const on = run('runner', (c) => ({ gas: c.vf < 27.8 ? 1 : 0, steer: 1 }), 2, (c) => { c.vx = 27.8; }).out; const off = run('runner', { gas: 0, steer: 1 }, 2, (c) => { c.vx = 27.8; }).out;
    const yawOn = on.slice(60, 120).reduce((a, q) => a + Math.abs(q.r), 0) / 60; const yawOff = off.slice(60, 120).reduce((a, q) => a + Math.abs(q.r), 0) / 60;
    assert(yawOff > yawOn * 1.03, `lift-off at full lock turns tighter (${(yawOff * 57.3).toFixed(1)} vs ${(yawOn * 57.3).toFixed(1)} °/s)`);
    const co = run('runner', { gas: 0 }, 1.01, (c) => { c.vx = 27.8; }).out.at(-1);
    assert(27.8 - co.v > 1.8 && 27.8 - co.v < 3.5, `coast from 100 km/h: −${(27.8 - co.v).toFixed(1)} m/s in the first second (was 1.2)`); }
  // nitro running out eases off instead of slamming the brakes
  { const o = run('runner', (c, t) => ({ gas: 1, nitro: t < 4 }), 8).out; let worst = 0; for (let i = 1; i < o.length; i++) worst = Math.min(worst, (o[i].v - o[i - 1].v) / DT);
    assert(worst > -3, `nitro run-out: worst decel ${worst.toFixed(2)} m/s² (was −6.7, 45% of full braking)`); }
  // oil: the cop rotates and slides (and has to catch it), it doesn't just understeer
  { const c = newCar('cop'); placeCar(c, 0, 0, Math.PI / 2, lot); c.vx = 27.8; let ms = 0; const y0 = c.yaw; c.oilT = 1.2; c.r += 1.6;
    for (let i = 0; i < 1.2 / DT; i++) { stepCar(c, { gas: 1 }, DT, lot, CAR.cop, NITRO.cop); c.ev.length = 0; ms = Math.max(ms, c.slip); }
    assert(Math.abs(c.yaw - y0) * 57.3 > 25 && ms > 6, `oil at 100 km/h: ${(Math.abs(c.yaw - y0) * 57.3).toFixed(0)}° of rotation and a ${ms.toFixed(0)} m/s slide (was 8° / 3 m/s)`); }
  // roads have vertical texture: a 0.4 m hump at 100 km/h heaves the body; a flat tyre drags and thumps
  { const hm = createGeo({ id: 'h', bounds: lot.bounds, roads: lot.map.roads, open: lot.map.open, solids: [], height: (x) => (Math.abs(x - 100) < 4 ? 0.4 * Math.cos((Math.PI * (x - 100)) / 8) ** 2 : 0) });
    const o = run('runner', { gas: 0.5 }, 4, (c) => { c.vx = 27.8; }, hm).out;
    assert(Math.max(...o.map((q) => Math.abs(q.heave))) > 0.03, `a 0.4 m hump at 100 km/h heaves the body ${(Math.max(...o.map((q) => Math.abs(q.heave))) * 1000).toFixed(0)} mm (was 0)`);
    const f = run('runner', { gas: 1 }, 6, (c) => { c.vx = 33.3; c.flat = 1; }); const roll = Math.max(...f.out.map((q) => Math.abs(q.r)));
    assert(f.c.speed * 3.6 < 113 && f.c.speed * 3.6 > 100, `a flat tyre at 120 km/h settles at ${(f.c.speed * 3.6).toFixed(0)} km/h (drag + 70% top)`); void roll; }
  // PIT: the nudge → PIT step is continuous (35° → 170°, not 11° → 240°) and every PIT gets slow motion
  { const a = pitEffect(3.19, 1, 22); const k1 = a.kick; const s1 = a.spin; const b = pitEffect(3.2, 2, 22);
    assert(k1 * s1 > 0.5 && b.kick / k1 < 2.6 && DAMAGE.pitSlowMo <= DAMAGE.pitPush, `PIT tiers: push 3.19 → ${(k1 * s1 * 57.3 * 0.6).toFixed(0)}°, 3.2 → ${(b.kick * b.spin * 57.3 * 0.6).toFixed(0)}° (continuous), slow-mo from push ${DAMAGE.pitSlowMo}`); }
  // PIT fairness: a runner drifting its own rear into a cop running straight beside it is not PITted; a cop steering into the quarter is
  { const ct = {};
    for (const sl of [3.5, 6]) { const rn = newCar('runner'); placeCar(rn, 0, 0, Math.PI / 2, lot); rn.vx = 22; rn.vz = sl; const cp = newCar('cop'); placeCar(cp, -3.2, 1.9, Math.PI / 2, lot); cp.vx = 22; assert(carContact(rn, cp, ct) > 0 && judgePit(rn, cp, ct) === 0 && ct.pitTier === 0, `runner sliding ${sl} m/s into a laterally still cop: no PIT (tier ${ct.pitTier}, was a tier-2 PIT with ${sl} m/s of 'push')`); }
    const rn = newCar('runner'); placeCar(rn, 0, 0, Math.PI / 2, lot); rn.vx = 22; const cp = newCar('cop'); placeCar(cp, -3.2, 1.9, Math.PI / 2 - 0.1, lot); cp.vx = 22; cp.vz = -3.5;
    assert(carContact(rn, cp, ct) > 0 && judgePit(rn, cp, ct) !== 0 && ct.pitTier === 2, `a cop steering 3.5 m/s into the quarter is still a PIT (push ${ct.pitPush.toFixed(1)})`); }
  // Dockside: no carriageway inside an unbreakable solid (Pier Rd's sheds and Lookout Ln's houses sat across the road)
  { const geo = createGeo(DOCKSIDE); const tmp = {}; let bad = 0; const where = new Set();
    for (const r of geo.roads) for (let s = 0; s < r.len; s += 1) { geo.sampleRoad(r, s, tmp); for (let off = -(r.hw - 1); off <= r.hw - 1; off += 1) { const px = tmp.x - tmp.tz * off; const pz = tmp.z + tmp.tx * off; let inside = false; geo.eachSolid(px, pz, 1, (o) => { if (inside || o.breakable || o.soft || (r.bridge && o.y == null) || (!r.bridge && o.y != null && o.y > 2)) return; const ax = px - o.x; const az = pz - o.z; const lx = ax * o.c - az * o.s; const lz = ax * o.s + az * o.c; if (Math.abs(lx) < o.hw && Math.abs(lz) < o.hd) inside = true; }); if (inside) { bad++; where.add(r.name); } } }
    assert(bad === 0, `Dockside: 0 m of carriageway inside unbreakable solids (${bad} m${where.size ? ': ' + [...where].join(', ') : ''}; was 62 m)`); }
  // traffic: each() with the coarse reject finds exactly what a brute-force pass finds; a lane with a player parked on its grow-in point holds its cars
  { const geo = createGeo(DOCKSIDE); const tr = createTraffic(geo, 'dockside', 'normal'); const rnd = (() => { let a = 7; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; })();
    let diff = 0; let n = 0;
    for (let k = 0; k < 30; k++) { const p = geo.randomRoadPoint(rnd, {}); const t = 600 + k * 2.3; const got = new Set(); tr.each(p.x, p.z, 20, t, (id, q) => { if (q.sc > 0.02) got.add(id); }); const want = new Set(); for (const L of tr.lanes) for (let j = 0; j < L.n; j++) { const q = {}; tr.poseOn(L, j, t, q); if (q.sc > 0.02 && Math.abs(q.x - p.x) <= 20 && Math.abs(q.z - p.z) <= 20) want.add(q.id); } n += want.size; for (const id of want) if (!got.has(id)) diff++; for (const id of got) if (!want.has(id)) diff++; }
    assert(diff === 0, `traffic.each() with the per-lane coarse reject matches a brute-force pass (${n} cars at 30 spots)`);
    const L = tr.lanes.find((l) => !l.r.closed && l.n >= 2); const obs = [{ x: L.gx, z: L.gz, yaw: 0, siren: false, speed: 0 }];
    let near = 0; for (let t = 600; t < 640; t += 1 / 30) { tr.yieldTo(1 / 30, t, obs); tr.each(L.gx, L.gz, 8, t, (id, q) => { if (q.sc >= 0.95 && Math.hypot(q.x - L.gx, q.z - L.gz) < 6) near++; }); }
    assert(near === 0, `a civilian never grows in on top of a car parked at a lane start (${near} solid cars within 6 m over 40 s on ${L.r.name}; was ~17 per 20 s)`); }
}
