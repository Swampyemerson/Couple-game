// Unit tests for the VENT needy module (pure functions only; no DOM).
const util = await import(new URL('../../../../js/games/defuse/util.js', import.meta.url));
const { VENT } = (await import(new URL('../../../../js/games/defuse/vent.js', import.meta.url)));
const { stream, int, pick, sample } = util;

const LABELS = ['RDY', 'PWR', 'AUX', 'LNK', 'SYS', 'CLR', 'IGN', 'MSA'];
const PORTS = ['DVI', 'PS2', 'RJ45', 'SERIAL'];
function edge(seed) {
  const r = stream(seed, 'edge');
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let serial = ''; for (let i = 0; i < 5; i++) serial += ch[int(r, ch.length)];
  serial += int(r, 10);
  return { serial, batteries: int(r, 5), indicators: sample(r, LABELS, 2).map((label) => ({ label, lit: r() < 0.5 })), ports: sample(r, PORTS, int(r, 4)) };
}
const TIERS = [{ id: 'normal', level: 2, stages: 4 }, { id: 'spicy', level: 3, stages: 5 }, { id: 'wild', level: 4, stages: 5 }];
const build = (seed, T) => {
  const E = edge(seed);
  const R = VENT.rules(stream(seed, 'rules', 'vent'), T);
  const S = VENT.gen(stream(seed, 'gen', 'vent'), E, R, T);
  return { E, R, S };
};

// Solve from the manual page alone (data-* attributes), never touching R.
function parsePage(html) {
  const out = [];
  const re = /<li data-vent-prompt="([^"]*)" data-yes="([^"]*)" data-cond="([^"]*)" data-flip="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) out.push({ p: m[1], y: m[2], c: m[3], f: m[4] ? m[4].split('|') : [] });
  return out;
}
function solveFromPage(html, S, E) {
  const rules = parsePage(html);
  const lit = (l) => E.indicators.some((i) => i.label === l && i.lit);
  const last = +E.serial[E.serial.length - 1];
  const edgeOk = (c) => {
    const [k, v] = c.split(':');
    if (k === 'lit') return lit(v);
    if (k === 'unlit') return E.indicators.some((i) => i.label === v && !i.lit);
    if (k === 'bat') return E.batteries >= +v;
    if (k === 'serial-even') return last % 2 === 0;
    if (k === 'serial-odd') return last % 2 === 1;
    if (k === 'vowel') return /[AEIOU]/.test(E.serial);
    if (k === 'port') return E.ports.includes(v);
    throw new Error('bad edge ' + c);
  };
  const readOk = (c, n) => {
    const [k, v] = c.split(':'); const t = Math.floor(n / 10), u = n % 10;
    if (k === 'gt') return n > +v; if (k === 'lt') return n < +v; if (k === 'even') return n % 2 === 0; if (k === 'odd') return n % 2 === 1;
    if (k === 'mul3') return n % 3 === 0; if (k === 'tens') return t > u; if (k === 'dsum') return t + u > +v;
    throw new Error('bad read ' + c);
  };
  return S.acts.map((a) => {
    const q = rules.find((x) => x.p === a.prompt);
    let yes = readOk(q.c, a.reading) ? q.y === 'YES' : q.y !== 'YES';
    if (q.f.filter(edgeOk).length % 2) yes = !yes;
    return yes ? 'YES' : 'NO';
  });
}

export async function run({ assert }) {
  assert(VENT.needy === true && VENT.id === 'vent' && !VENT.remote, 'vent: needy, id vent');
  assert(VENT.tab.length <= 9, 'vent: tab label is 9 chars or fewer');

  // determinism
  for (const T of TIERS) {
    const a = build('det-1', T), b = build('det-1', T);
    assert(JSON.stringify(a) === JSON.stringify(b), `vent: same seed builds the same round (${T.id})`);
    assert(JSON.stringify(a) !== JSON.stringify(build('det-2', T)), `vent: different seeds differ (${T.id})`);
    assert(VENT.page(a.R, T) === VENT.page(b.R, T), `vent: page is deterministic (${T.id})`);
  }

  let bad = 0, ruleSets = new Set(), minGap = 1e9, minFirst = 1e9, maxFirst = 0, ok = true;
  const gapSum = { 2: 0, 3: 0, 4: 0 }, gapN = { 2: 0, 3: 0, 4: 0 };
  let yes = 0, tot = 0, allSame = 0, nrules = new Set(), page = 0, solved = 0, rangeBad = 0, readBad = 0;
  for (let s = 0; s < 1000; s++) {
    const T = TIERS[s % 3];
    const { E, R, S } = build('seed-' + s, T);
    const n = R.rules.length;
    nrules.add(n);
    if (n < 2 || n > 4 || new Set(R.rules.map((q) => q.p)).size !== n) bad++;
    ruleSets.add(JSON.stringify(R));
    if (S.acts.length !== 12) bad++;
    if (S.cd !== (T.level >= 4 ? 15000 : 20000)) bad++;
    const first = S.acts[0].atElapsedMs;
    minFirst = Math.min(minFirst, first); maxFirst = Math.max(maxFirst, first);
    for (let i = 1; i < S.acts.length; i++) {
      const g = S.acts[i].atElapsedMs - S.acts[i - 1].atElapsedMs;
      minGap = Math.min(minGap, g);
      gapSum[T.level] += g; gapN[T.level]++;
      if (g > 60000) bad++;
    }
    for (const a of S.acts) {
      if (!R.rules.some((q) => q.p === a.prompt)) bad++;
      if (!(a.reading >= 10 && a.reading <= 99)) readBad++;
    }
    const ans = VENT.solve(S, E, R);
    if (ans.length !== 12 || ans.some((x) => x !== 'YES' && x !== 'NO')) bad++;
    if (new Set(ans).size === 1) allSame++;
    ans.forEach((x) => { tot++; if (x === 'YES') yes++; });
    const fromPage = solveFromPage(VENT.page(R, T), S, E);
    if (JSON.stringify(fromPage) === JSON.stringify(ans)) solved++;
    // JSON round trip
    if (JSON.stringify(JSON.parse(JSON.stringify(S))) !== JSON.stringify(S)) bad++;
    // flips only appear where the level asks
    for (const q of R.rules) if (T.level === 4 ? q.f.length !== 2 : T.level === 3 ? q.f.length !== 1 : q.f.length > 1) bad++;
  }
  assert(bad === 0, 'vent: 1000 seeds: schedules, prompts, rules, answers all well-formed');
  assert(readBad === 0, 'vent: readings are 2-digit');
  assert(minFirst >= 25000 && maxFirst <= 45000, `vent: first activation 25-45 s (${minFirst}..${maxFirst})`);
  assert(minGap >= 30000, `vent: gaps >= 30 s (min ${minGap})`);
  const avg = (l) => gapSum[l] / gapN[l];
  assert(avg(3) < avg(2) && avg(4) < avg(2), `vent: spicy/wild gaps are shorter than normal (${Math.round(avg(2))} vs ${Math.round(avg(3))})`);
  assert(allSame === 0, 'vent: no schedule has all answers the same');
  assert(yes / tot > 0.35 && yes / tot < 0.65, `vent: YES share is balanced (${(yes / tot).toFixed(2)})`);
  assert(ruleSets.size >= 900, `vent: rules vary between seeds (${ruleSets.size} distinct of 1000)`);
  assert(nrules.has(2) && nrules.has(3) && nrules.has(4), 'vent: 2, 3 and 4 prompt rounds all occur');
  assert(solved === 1000, `vent: solving from the page data alone equals solve() (${solved}/1000)`);

  // save/drive contract
  const { E, R, S } = build('drive', TIERS[1]);
  const ans = VENT.solve(S, E, R);
  assert(VENT.drive(S, E, R, { i: 3, e: 0, on: 0, c: 0 }).length === 0, 'vent: drive is empty while asleep');
  const d = VENT.drive(S, E, R, { i: 3, e: 90000, on: 1, c: 9000 });
  assert(d.length === 1 && d[0].act === 'tap' && d[0].sel.includes(`"${ans[2]}"`), 'vent: drive taps the right key for the active activation');

  // mount with a fake box and host: wake, wrong answer strikes, right answer sleeps, timeout strikes, pause freezes
  const fakeEl = () => {
    const el = { textContent: '', dataset: {}, style: {}, disabled: false, attrs: {}, classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, toggle(c, f) { f ? this.s.add(c) : this.s.delete(c); } },
      setAttribute(k, v) { this.attrs[k] = v; } };
    return el;
  };
  const els = {};
  const box = { set innerHTML(v) {}, querySelector(sel) { return (els[sel] ||= fakeEl()); }, querySelectorAll() { return [fakeEl(), fakeEl()]; } };
  // our fake keys must be shared so disabled can be inspected
  const keyEls = [fakeEl(), fakeEl()]; box.querySelectorAll = () => keyEls;
  const log = { strikes: [], sfx: [] };
  let busy = false, clock = 0;
  const host = { E, K: null, T: TIERS[1], strikes: () => 0, left: () => 200000, busy: () => busy, solve() { throw new Error('vent must never solve'); },
    strike: (w) => log.strikes.push(w), sfx: (n) => log.sfx.push(n), haptic() {}, later: () => {}, saved: null, now: () => clock };
  const m = VENT.mount(box, S, R, host);
  const step = (ms) => { clock += ms; m.frame(clock, ms); };
  step(16);
  for (let t = 0; t < S.acts[0].atElapsedMs - 1000; t += 250) step(250);
  assert(m.save().on === 0 && m.save().i === 0, 'vent: asleep before the first activation');
  busy = true; for (let i = 0; i < 400; i++) step(250); busy = false;
  assert(m.save().on === 0, 'vent: elapsed counter is frozen while busy');
  for (let t = 0; t < 2500; t += 250) step(250);
  assert(m.save().on === 1 && m.save().i === 1, 'vent: wakes at the first activation');
  assert(log.sfx.includes('pop'), 'vent: wake sfx');
  const key = (k) => ({ target: { closest: () => ({ dataset: { ventKey: k } }) } });
  const wrong = ans[0] === 'YES' ? 'NO' : 'YES';
  m.click(key(wrong));
  assert(log.strikes.length === 1 && log.strikes[0] === 'vent' && m.save().on === 0, 'vent: wrong answer is a strike and it sleeps');
  m.click(key(wrong));
  assert(log.strikes.length === 1, 'vent: a double tap is not a second strike');
  const at1 = S.acts[1].atElapsedMs;
  while (m.save().e < at1 + 100) step(250);
  assert(m.save().on === 1 && m.save().i === 2, 'vent: second activation wakes');
  clock += 1000;
  m.click(key(ans[1]));
  assert(m.save().on === 0 && log.sfx.includes('good') && log.strikes.length === 1, 'vent: right answer sleeps with sfx good');
  while (m.save().on === 0) step(250);
  const c0 = m.save().c;
  busy = true; for (let i = 0; i < 100; i++) step(250); busy = false;
  assert(m.save().c === c0, 'vent: countdown is frozen while busy');
  for (let i = 0; i < 90 && m.save().on; i++) step(250);
  assert(m.save().on === 0 && log.strikes.length === 2, 'vent: countdown reaching 0 is a strike');
  assert(log.sfx.filter((x) => x === 'tick').length >= 8, 'vent: ticks each second under 10 s');
  // resume from save
  const sv = { i: 3, e: 100000, on: 1, c: 7000 };
  const m2 = VENT.mount(box, S, R, { ...host, saved: sv });
  assert(JSON.stringify(m2.save()) === JSON.stringify(sv), 'vent: resumes an active countdown from save()');
  m.destroy(); m2.destroy();
}
