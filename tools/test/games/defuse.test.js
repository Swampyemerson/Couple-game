// Defuse: node unit tests (every plugin's tools/test/games/defuse/*.unit.mjs, then round-level tests), then the browser tests.
//   node tools/test/games/defuse.test.js [node|phone|wild|laptop|dark|layout|legacy|chain|all]    (SHOTS=/dir for screenshots, PORT=9100 uses PORT..PORT+12; SHOTS_CHAIN=/dir for the chain screenshots)
//
// Browser: two simulated devices share a fake live room. Phones are 390×844 with coarse pointers and real page.tap(); the
// laptop bomb is 1280×800 with no touch. Rounds are driven through window.__defuse (info / gen / drive / force / setLeft),
// but the manual is read and operated from its own DOM wherever that is practical.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { launch } = require('../harness');

const ROOT = path.resolve(__dirname, '../../..');
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'just-us-shots', 'defuse');
const PORT = Number(process.env.PORT) || 9100;
fs.mkdirSync(SHOTS, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 10000, step = 40) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('FAIL: timed out waiting for ' + what);
    await sleep(step);
  }
}
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const shot = async (pg, name, opts) => { await pg.screenshot({ path: path.join(SHOTS, name + '.png'), ...opts }); console.log('   shot', name); };
const dx = (pg) => pg.evaluate(() => window.__defuse && window.__defuse.info());
const visible = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.getClientRects().length > 0; }, sel);
const noSideScroll = (pg) => pg.evaluate(() => { const r = document.getElementById('game-root'); return r.scrollWidth <= r.clientWidth + 1; });
const secsOf = (t) => { const [m, x] = t.trim().split(':').map(Number); return m * 60 + x; };

// ══════════════════════════ node: every plugin's unit tests, then round-level tests ══════════════════════════
async function nodePart() {
  console.log('\n# Node: plugin unit tests');
  const dir = path.join(__dirname, 'defuse');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.unit.mjs')).sort();
  assert(files.length >= 1, `found ${files.length} plugin unit files (${files.map((f) => f.replace('.unit.mjs', '')).join(', ')})`);
  for (const f of files) { await import(pathToFileURL(path.join(dir, f)).href); assert(true, `${f} passes`); }

  console.log('\n# Node: rounds');
  const RD = await imp('js/games/defuse/round.js');
  const MN = await imp('js/games/defuse/manual.js');
  const RC = await imp('js/games/defuse/records.js');
  const { buildRound, TIERS, BY_ID, REGISTRY, CLASSIC_IDS, isScored, decoyLive, nameOf } = RD;
  const TKS = Object.keys(TIERS);
  assert(TKS.join() === 'classic,chill,normal,spicy,wild' && REGISTRY.length === 10, 'five tiers and ten modules');
  assert(TIERS.chill.secs === 360 && TIERS.normal.secs === 300 && TIERS.spicy.secs === 330 && TIERS.wild.secs === 360 && TIERS.classic.secs === 300 && TIERS.chill.label === 'Rookie' && TIERS.normal.label === 'Agent' && TIERS.spicy.label === 'Expert' && TIERS.wild.label === 'Bomb Squad', 'tier labels and clocks: Rookie 6:00, Agent 5:00, Expert 5:30, Bomb Squad 6:00, Classic 5:00');

  // determinism: the manual device rebuilds the identical round from { seed, tier }
  let n = 0;
  for (let i = 0; i < 200; i++) for (const t of TKS) {
    const a = JSON.stringify(buildRound('s' + i, t));
    const b = JSON.stringify(buildRound('s' + i, t));
    if (a !== b) throw new Error(`FAIL: round differs on rebuild: s${i} ${t}`);
    if (!/^\{/.test(a) || /undefined|NaN/.test(a)) throw new Error('FAIL: bad json in round ' + i + t);
    n++;
  }
  assert(n === 1000, 'buildRound is deterministic: 200 seeds x 5 tiers, JSON-equal on rebuild');
  assert(JSON.stringify(buildRound('s1', 'normal')) !== JSON.stringify(buildRound('s2', 'normal')), 'different seeds give different rounds');
  assert(JSON.stringify(buildRound('x', 'bogus').tier) === '"normal"', 'an unknown tier falls back to normal');

  // tiers: module counts, mix, twists
  const stat = {};
  for (const t of TKS) {
    const s = stat[t] = { plain: new Set(), twistN: new Set(), types: new Set(), vent: 0, relay: 0, decoy: 0, void: 0, errata: 0, surge: 0, tax: 0, blackout: 0, gold: 0, ventSlot: 0, rounds: 0 };
    for (let i = 0; i < 300; i++) {
      const r = buildRound('m' + i, t);
      s.rounds++;
      const plain = r.slots.filter((x) => !BY_ID[x.id].needy);
      s.plain.add(plain.length);
      s.twistN.add(r.twists.length);
      plain.forEach((x) => s.types.add(x.id));
      const ids = plain.map((x) => x.id);
      const dups = ids.length - new Set(ids).size;
      if (dups !== (r.twists.includes('decoy') ? 1 : 0)) throw new Error(`FAIL: duplicate modules without decoy (${t} m${i})`);
            const real = plain.filter((x) => !x.decoy && x.id !== 'relay');
      if (t !== 'classic' && plain.length >= 3) {
        if (!real.some((x) => CLASSIC_IDS.includes(x.id))) throw new Error(`FAIL: no classic-four module (${t} m${i})`);
        if (!real.some((x) => !CLASSIC_IDS.includes(x.id))) throw new Error(`FAIL: no new module (${t} m${i})`);
      }
      if (r.slots.some((x) => BY_ID[x.id].needy) !== (r.twists.includes('vent') || TIERS[t].needy)) throw new Error('FAIL: vent presence ' + t + i);
      for (const k of ['vent', 'relay', 'decoy', 'void', 'errata', 'surge', 'tax', 'blackout']) if (r.twists.includes(k)) s[k]++;
      if (r.gold >= 0) s.gold++;
      if (r.slots.some((x) => x.id === 'vent')) s.ventSlot++;
      if (r.slots.length < 3 || r.slots.length > 7) throw new Error(`FAIL: ${r.slots.length} slots (${t} m${i})`);
    }
  }
  const only = (set, v) => set.size === 1 && set.has(v);
  assert(only(stat.classic.plain, 4) && only(stat.classic.twistN, 0) && stat.classic.types.size === 4 && CLASSIC_IDS.every((x) => stat.classic.types.has(x)), 'classic: always the classic four, no twists, no vent');
  assert(only(stat.chill.plain, 3) && only(stat.chill.twistN, 0) && stat.chill.ventSlot === 0, 'Rookie: three modules, no twists');
  assert(only(stat.normal.plain, 4) && only(stat.normal.twistN, 1), 'Agent: four modules, exactly one twist');
  assert(only(stat.spicy.plain, 5) && only(stat.spicy.twistN, 2) && stat.spicy.ventSlot === 300, 'Expert: five modules plus the vent, two twists');
  assert(only(stat.wild.plain, 6) && only(stat.wild.twistN, 3) && stat.wild.ventSlot === 300 && stat.wild.tax === 300, 'Bomb Squad: six modules plus the vent, three twists, tax always on');
  for (const t of ['normal', 'spicy', 'wild']) for (const k of ['relay', 'decoy', 'void', 'errata', 'surge', 'blackout']) assert(stat[t][k] > 0, `${t}: the ${k} twist turns up (${stat[t][k]}/300)`);
  assert(stat.normal.vent > 0 && stat.normal.tax > 0, 'normal: vent and tax turn up as twists');
  const gold = Object.values(stat).reduce((s, x) => s + x.gold, 0) / Object.values(stat).reduce((s, x) => s + x.rounds, 0);
  assert(stat.classic.gold === 0 && gold > 0.04 && gold < 0.12, `golden modules: about one round in twelve (${(gold * 100).toFixed(1)} %), never in classic`);
  assert(stat.wild.types.size >= 8, `Bomb Squad draws from many modules (${stat.wild.types.size} types)`);

  // classic: today's fixed rules, whatever the seed
  const cl = new Set();
  for (let i = 0; i < 40; i++) { const r = buildRound('c' + i, 'classic'); cl.add(JSON.stringify(r.ids.map((id) => r.book[id].R0))); if (r.edition !== 'Ed. C-1' || r.E.portPlate || r.E.void || r.slots.some((s) => s.plate)) throw new Error('FAIL: classic has extras'); }
  assert(cl.size === 1, 'classic: the same rules every round');
  // seeded editions: the rules change from round to round
  for (const t of ['chill', 'normal', 'wild']) {
    const eds = new Set();
    for (let i = 0; i < 100; i++) eds.add(JSON.stringify(buildRound('e' + i, t).ids.map((id) => buildRound('e' + i, t).book[id].R0)));
    assert(eds.size >= 90, `${t}: rules change between seeds (${eds.size} distinct editions in 100)`);
  }

  // every module is solvable on every tier it appears in; twists are well-formed
  let solved = 0;
  for (let i = 0; i < 150; i++) for (const t of TKS) {
    const r = buildRound('v' + i, t);
    for (const s of r.slots) {
      const a = BY_ID[s.id].solve(s.S, r.E, r.book[s.id].R, r.T);
      if (a == null) throw new Error(`FAIL: ${s.id} has no answer (${t} v${i})`);
      solved++;
    }
    for (let k = 0; k < r.slots.length; k++) {
      const s = r.slots[k];
      if (r.T.twists > 0 && !(s.plate >= 100 && s.plate <= 999)) throw new Error('FAIL: plate');
      if (r.T.twists === 0 && s.plate) throw new Error('FAIL: plate where there are no twists');
    }
    if (new Set(r.slots.map((s) => s.plate)).size !== r.slots.length && r.T.twists > 0) throw new Error('FAIL: duplicate plates ' + i + t);
    const X = r.twistRules;
    if (X.decoy) {
      const pair = r.slots.map((s, k) => (s.id === X.decoy.type ? k : -1)).filter((k) => k >= 0);
      const live = decoyLive(X.decoy.rule, pair.map((k) => r.slots[k].plate), r.E.serial);
      if (pair.length !== 2 || live < 0 || r.slots[pair[1 - live]].decoy !== true || r.slots[pair[live]].decoy !== false || r.slots.filter((s) => s.decoy).length !== 1) throw new Error(`FAIL: decoy rule does not pick one live module (${t} v${i})`);
      if (JSON.stringify(r.slots[pair[0]].S) === JSON.stringify(r.slots[pair[1]].S) && r.slots[pair[0]].id !== 'sequence') throw new Error('FAIL: twin has the same puzzle');
    } else if (r.slots.some((s) => s.decoy)) throw new Error('FAIL: decoy flag without the twist');
    if (X.void && !(X.void.serial && X.void.serial !== r.E.serial && r.E.void === X.void.serial && r.E.voidInd)) throw new Error('FAIL: void sticker');
    if (!X.void && (r.E.void || r.E.voidInd)) throw new Error('FAIL: void without the twist');
    if (X.errata && !(r.book[X.errata.id].note && r.book[X.errata.id].R !== r.book[X.errata.id].R0)) throw new Error('FAIL: errata without a slip');
    if (r.ids.filter((id) => r.book[id].note).length !== (X.errata ? 1 : 0)) throw new Error('FAIL: slip count');
    // timed events: first/last 30 s are clear, nothing overlaps
    const ev = [];
    if (X.surge) X.surge.at.forEach((a) => ev.push({ at: a, span: 24, k: 'surge' }));
    if (X.blackout) X.blackout.at.forEach((a) => ev.push({ at: a, span: 7, k: 'dark' }));
    ev.sort((p, q) => q.at - p.at);
    ev.forEach((e, k) => {
      if (e.at > r.T.secs - 30 || e.at - e.span < 30) throw new Error(`FAIL: ${e.k} at ${e.at} of ${r.T.secs} is too early or late (${t} v${i})`);
      if (k && ev[k - 1].at - ev[k - 1].span * 1.2 < e.at) throw new Error(`FAIL: events overlap (${t} v${i}): ${JSON.stringify(ev)}`);
    });
    if (X.surge && X.surge.at.length !== 2) throw new Error('FAIL: two surges');
    if (X.blackout && (X.blackout.at.length < 1 || X.blackout.at.length > 2)) throw new Error('FAIL: blackout count');
    if (r.gold >= 0) {
      const g = r.slots[r.gold];
      if (g.decoy || BY_ID[g.id].needy || (X.decoy && g.id === X.decoy.type)) throw new Error('FAIL: gold on a decoy/needy/twin slot');
    }
    if (r.name !== nameOf('v' + i) || !/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(r.name)) throw new Error('FAIL: name ' + r.name);
  }
  assert(solved > 3000, `every module of every round has an answer (${solved} checked)`);
  assert(true, 'twists well-formed: decoy picks exactly one live twin, VOID differs from the serial, one slip per errata, surges and blackouts clear of the first and last 30 s and of each other, gold never on a twin');
  // hush: its own stream, level 3 and up only, clear of surges and blackouts and of the first and last 30 s, listed in extras (never in twists)
  {
    let hushN = 0, hushRounds = 0;
    for (const t of TKS) for (let i = 0; i < 300; i++) {
      const r = buildRound('hu' + i, t);
      const H = r.twistRules.hush;
      if (r.twists.includes('hush') || !Array.isArray(r.extras) || r.extras.includes('hush') !== !!H) throw new Error(`FAIL: hush bookkeeping (${t} hu${i})`);
      if (JSON.stringify(buildRound('hu' + i, t)) !== JSON.stringify(r)) throw new Error('FAIL: hush not deterministic');
      if (t === 'spicy' || t === 'wild') hushRounds++;
      if (!H) continue;
      hushN++;
      if (r.T.level < 3) throw new Error(`FAIL: hush below level 3 (${t} hu${i})`);
      if (H.dur !== 8 || H.at > r.T.secs - 30 || H.at - 2 * H.dur < 30) throw new Error(`FAIL: hush at ${H.at} of ${r.T.secs} (${t} hu${i})`);
      const X = r.twistRules;
      for (const a of X.surge ? X.surge.at : []) if (!(H.at < a - 30 - 6 || H.at - 2 * H.dur > a + 6)) throw new Error(`FAIL: hush overlaps a surge (${t} hu${i}: ${H.at} vs ${a})`);
      for (const a of X.blackout ? X.blackout.at : []) if (!(H.at < a - 12 - 6 || H.at - 2 * H.dur > a + 6)) throw new Error(`FAIL: hush overlaps a blackout (${t} hu${i}: ${H.at} vs ${a})`);
      const page = MN.basicsHTML(r);
      if (!/data-twist="hush"/.test(page) || !/Hush\./.test(page)) throw new Error('FAIL: basics page does not list hush');
    }
    assert(hushN > hushRounds * 0.3 && hushN < hushRounds * 0.7, `hush turns up in about half of the Expert and Bomb Squad rounds (${hushN} of ${hushRounds}), never below level 3, clear of surges, blackouts and the first and last 30 s`);
  }
  const names = new Set(); for (let i = 0; i < 300; i++) names.add(nameOf('n' + i));
  assert(nameOf('abc') === nameOf('abc') && names.size > 250, `round names are seeded and varied (${names.size} of 300), e.g. ${nameOf('abc')}`);
  const ports = new Set(); for (let i = 0; i < 100; i++) { const r = buildRound('p' + i, 'normal'); r.E.ports.forEach((x) => ports.add(x)); if (!r.E.portPlate) throw new Error('FAIL: ports at level 2'); }
  assert(ports.size === 4 && !buildRound('p', 'chill').E.portPlate, 'edgework: ports from level 2 up');
  let vowelOk = true; const vs = new Set();
  for (let i = 0; i < 300; i++) { const e = buildRound('q' + i, 'chill').E; if (/[AEIOU]/.test(e.serial)) [...e.serial].forEach((c) => /[AEIOU]/.test(c) && vs.add(c)); if (!/^[A-Z0-9]{5}\d$/.test(e.serial)) vowelOk = false; }
  for (const t of ['normal', 'wild']) for (let i = 0; i < 300; i++) { const e = buildRound('q' + i, t).E; for (const x of [e.serial, e.void].filter(Boolean)) { if (/[IO]/.test(x)) vowelOk = false; if (/[AEU]/.test(x)) [...x].forEach((c) => /[AEU]/.test(c) && vs.add(c)); } }
  assert(vowelOk && vs.size === 3 && [...vs].sort().join('') === 'AEU', 'serials end in a digit; the only vowels are A, E and U (O and I sound like 0 and 1 aloud), VOID serials too');

  // the field guide, built from a round
  let pages = 0;
  for (let i = 0; i < 100; i++) for (const t of TKS) {
    const r = buildRound('g' + i, t);
    const html = MN.guideHTML(r);
    if (/undefined|\[object/.test(html)) throw new Error('FAIL: guide has a hole ' + t + i);
    const tabs = MN.tabsOf(r);
    const secs = (html.match(/data-page="/g) || []).length;
    if (tabs.length !== r.ids.length + 1 || secs !== tabs.length) throw new Error('FAIL: tabs vs pages');
    if (!html.includes(r.edition) || !html.includes(r.name)) throw new Error('FAIL: edition / name missing');
    const slips = (html.match(/data-slip="/g) || []).length;
    if (slips !== (r.twistRules.errata ? 1 : 0)) throw new Error('FAIL: slip pages');
    if (r.twistRules.errata) {
      const sec = html.split('<section class="dx-sec"').find((x) => x.startsWith(` data-page="${r.twistRules.errata.id}"`));
      const iSlip = sec.indexOf('data-slip='); const iBody = sec.indexOf('<p class="dx-intro"');
      if (iSlip < 0 || (iBody >= 0 && iSlip > iBody)) throw new Error('FAIL: slip is not at the top of the page');
    }
    const box = html.slice(html.indexOf('data-this-bomb'), html.indexOf('On the case'));
    if (r.twistRules.decoy && !/<ol class="dx-rules"><li data-twist="decoy"/.test(box)) throw new Error('FAIL: decoy rule is not rule 1');
    for (const k of ['decoy', 'void', 'errata', 'surge', 'blackout', 'tax', 'relay', 'vent']) if ((box.includes(`data-twist="${k}"`)) !== !!r.twistRules[k]) throw new Error(`FAIL: basics lists ${k} wrongly (${t} g${i})`);
    if (box.includes('data-twist="gold"') !== (r.gold >= 0)) throw new Error('FAIL: gold line');
    pages++;
  }
  assert(pages === 500, 'the field guide builds for 100 seeds x 5 tiers: tab per page, edition and name printed, one slip on top of its page, the decoy rule is rule 1, every twist is listed');
  const rr = buildRound('t', 'wild');
  assert(MN.tabsOf(rr)[1].big === String(rr.slots.find((s) => s.id === MN.tabsOf(rr)[1].id).plate) || rr.slots.filter((s) => s.id === MN.tabsOf(rr)[1].id).length > 1, 'manual tabs carry the plate number');

  // F3: the module number on the bomb ("3 · Maze") is the manual's tab number, page heading number and run-head "Module 3"
  let numbered = 0;
  for (const t of TKS) for (let i = 0; i < 200; i++) {
    const r = buildRound('nb' + i, t);
    const html = MN.guideHTML(r);
    const tabs = MN.tabsOf(r);
    const secs = html.split('<section class="dx-sec"').slice(1);
    const order = [];
    r.slots.forEach((s, k) => { if (!order.includes(s.id)) order.push(s.id); });
    if (tabs.slice(1).map((x) => x.id).join() !== order.join()) throw new Error(`FAIL: manual tabs are not in bomb order (${t} nb${i})`);
    for (const id of order) {
      const k = r.slots.findIndex((s) => s.id === id); // the number printed on the bomb's tag is k + 1
      const tab = tabs.find((x) => x.id === id);
      const sec = secs.find((x) => x.startsWith(` data-page="${id}"`));
      const circle = +(/<span class="n">(\d+)<\/span>/.exec(sec) || [])[1];
      const run = /<div class="dx-run"><span>[^<]*<span class="dx-ed">[^<]*<\/span><\/span><span>([^<]*)<\/span>/.exec(sec)[1];
      if (tab.n !== k + 1 || circle !== k + 1 || !new RegExp(`^Modules? ${k + 1}\\b`).test(run)) throw new Error(`FAIL: ${id} is module ${k + 1} on the bomb but tab ${tab.n}, heading ${circle}, run-head "${run}" (${t} nb${i})`);
      if (!r.T.twists && tab.big !== String(k + 1)) throw new Error('FAIL: tab number without plates');
      numbered++;
    }
  }
  assert(numbered > 4000, `bomb tag number = manual tab number = page heading number = run-head "Module n" for every module type (${numbered} checked, 200 seeds x 5 tiers); tabs and pages follow the bomb's order`);
  // F4: the "stop at the first" footer only on pages that are ordered rule lists
  { const r = buildRound('foot', 'classic'); const html = MN.guideHTML(r);
    const foot = (id) => (html.split('<section class="dx-sec"').find((x) => x.startsWith(` data-page="${id}"`)).match(/class="dx-foot"><span>([^<]*)<\/span>/) || [])[1];
    assert(/Stop at the first/.test(foot('wires')) && /Stop at the first/.test(foot('button')) && foot('keypad') === '' && foot('sequence') === '' && foot('basics') === '', 'F4: only the wires and button pages carry "Read every rule in order. Stop at the first that applies."');
    let other = 0;
    for (let i = 0; i < 60; i++) for (const t of ['normal', 'wild']) { const g = MN.guideHTML(buildRound('ft' + i, t)); for (const sec of g.split('<section class="dx-sec"').slice(1)) { const id = /data-page="(\w+)"/.exec(sec)[1]; const m = /class="dx-foot"><span>([^<]*)<\/span>/.exec(sec)[1]; if (!['wires', 'button'].includes(id) && /Stop at the first/.test(m)) throw new Error('FAIL: footer on ' + id); other++; } }
    assert(other > 400, 'F4: no other page says "Stop at the first that applies" (' + other + ' pages checked)'); }

  // F1: the correction slip has to matter on THIS bomb. Over 500 seeds per tier, the errata module's answer under the slipped
  // rules differs from its answer under the printed rules in at least 95 % of errata rounds; rounds stay deterministic.
  {
    let rounds = 0, differ = 0, mods = new Set();
    for (const t of ['normal', 'spicy', 'wild']) for (let i = 0; i < 500; i++) {
      const r = buildRound('er' + i, t);
      if (JSON.stringify(r) !== JSON.stringify(buildRound('er' + i, t))) throw new Error('FAIL: errata round is not deterministic');
      const X = r.twistRules.errata;
      if (!X) continue;
      const b = r.book[X.id];
      const live = r.slots.find((s) => s.id === X.id && !s.decoy);
      const a = JSON.stringify(BY_ID[X.id].solve(live.S, r.E, b.R, r.T));
      const c = JSON.stringify(BY_ID[X.id].solve(live.S, r.E, b.R0, r.T));
      rounds++; mods.add(X.id);
      if (a !== c) differ++;
    }
    assert(rounds > 200 && differ / rounds >= 0.95, `F1: the slip changes the errata module's answer in ${differ} of ${rounds} errata rounds (${(100 * differ / rounds).toFixed(1)} %, need 95 %); slips turn up on ${mods.size} module types`);
  }


  // presence stays small even with a relay round and the longest text
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    const r = buildRound('z' + i, 'wild');
    if (!r.twists.includes('relay')) continue;
    const bomb = { v: 2, role: 'bomb', diff: 'wild', td: 1, dv: 99, dw: 'a', go: 'abcdefgh', sw: { t: 'abcdefgh', a: 'manual', b: 'bomb' }, ph: 'over', hid: 0, n: 'abcdefgh', sd: 'day-2026-10-12', rd: 'wild', left: 123456, rate: 2.5, st: 3, sv: 'ddddddd', sg: 12, bo: 2, vn: 1, pz: 1, pr: 'lobby', res: { team: true, score: 123, text: 'Defused with 12:34 left', sub: 'Not a single strike. Suspiciously smooth. First Bomb Squad defuse! Silver medal earned. Gold medal: zero strikes and more than half the clock left. (Bomb Squad · Ed. 9V-7 · Today’s bomb)' }, win: 1, fx: { ln: 'Seamless. Like you planned it. (You did not.)', md: 3 }, rs: BY_ID.relay.init(r.slots.find((s) => s.id === 'relay').S) };
    const man = { v: 2, role: 'manual', diff: 'wild', td: 1, dv: 99, dw: 'b', go: 'abcdefgh', sw: { t: 'abcdefgh', a: 'manual', b: 'bomb' }, ph: 'reading', hid: 0, n: 'abcdefgh', ra: Array.from({ length: 8 }, (_, k) => ({ id: `lq2z4k8v.${100 + k}`, t: 'flip', i: k % 4 })) };
    worst = Math.max(worst, JSON.stringify(bomb).length, JSON.stringify(man).length);
  }
  assert(worst > 0 && worst < 3500, `presence stays under 3.5 KB with a relay round (${worst} bytes)`);

  // records: older shapes, missing data, wrong types
  console.log('\n# Node: records');
  const T = TIERS.normal;
  const base = { tier: 'normal', T, win: true, secs: 200, strikes: 0, holder: 'a', reader: 'b', solved: ['wires', 'maze'], name: 'Sleepy Koala', at: 1700000000000 };
  for (const bad of [undefined, null, 5, 'x', [], {}, { best: 'x', wins: 'many', medal_normal: NaN, log: '{{' }, { best: null, holder: 7 }]) {
    const r = RC.readRecords(bad);
    assert(r.wins === 0 && r.streak === 0 && r.best.normal.secs === 0 && r.medal.normal === 0 && Array.isArray(r.log), `records read tolerates ${JSON.stringify(bad)}`);
    const out = RC.applyResult(bad, base);
    assert(out.patch.wins === 1 && out.patch.best_normal === 200 && out.patch.medal_normal === 3 && out.info.firstWin && !out.info.newRecord, `first win on ${JSON.stringify(bad)}: wins 1, best 200, gold medal, no "new record" yet`);
    assert(Object.values(out.patch).every((v) => ['number', 'string', 'boolean'].includes(typeof v)) && Object.keys(out.patch).every((k) => /^[a-zA-Z0-9_.-]{1,60}$/.test(k)), 'the patch is flat (the engine drops anything else)');
  }
  assert(RC.bestOf({ best: { normal: 120 } }, 'normal').secs === 120 && RC.bestOf({ 'best.normal': 95 }, 'normal').secs === 95 && RC.bestOf({ best_normal: 80 }, 'normal').secs === 80, 'best: reads a bare number from nested, dotted or flat data');
  assert(RC.bestOf({ best: { normal: { secs: 77, who: 'b', at: 5 } } }, 'normal').who === 'b' && RC.bestOf({ best_normal: 77, bestWho_normal: 'a' }, 'normal').who === 'a', 'best: reads { secs, who, at } too');
  let d = { best_normal: 100, bestWho_normal: 'b', wins: 4, streak: 2, bestStreak: 5, medal_normal: 2, clean_normal: 1 };
  let o = RC.applyResult(d, { ...base, secs: 150, strikes: 1 });
  assert(o.patch.best_normal === 150 && o.patch.bestWho_normal === 'a' && o.info.newRecord && o.patch.streak === 3 && o.patch.wins === 5 && !('medal_normal' in o.patch) && o.patch.clean_normal === undefined, 'a better time beats the best, extends the streak, a strike keeps the medal and earns no clean win');
  o = RC.applyResult({ ...d, medal_normal: 1 }, { ...base, secs: 90, strikes: 0 });
  assert(!('best_normal' in o.patch) && o.patch.medal_normal === 2 && o.patch.clean_normal === 2 && o.info.medalUp && !o.info.newRecord, 'a slower clean win does not beat the best but lifts the medal to silver');
  o = RC.applyResult({ ...d, medal_normal: 3 }, { ...base, win: false, secs: 0, strikes: 3 });
  assert(o.patch.streak === 0 && o.patch.bestStreak === 5 && o.patch.booms === 1 && !('medal_normal' in o.patch) && o.patch.holder_a_booms === 1 && o.patch.manual_b_strikes === 3, 'a boom resets the streak, never downgrades a medal, counts per person');
  assert(RC.medalFor(true, 2, 100, T) === 1 && RC.medalFor(true, 0, 150, T) === 2 && RC.medalFor(true, 0, 151, T) === 3 && RC.medalFor(false, 0, 0, T) === 0, 'medals: win, clean win, clean win with over half the clock');
  assert(RC.applyResult({}, { ...base, solved: ['maze', 'maze'] }).patch.mods_maze === 1 && RC.applyResult({ mods_maze: 4 }, base).patch.mods_maze === 5, 'per-module solve counts');
  o = RC.applyResult({}, { ...base, daily: '2026-10-12' });
  assert(o.patch['daily_2026-10-12_normal_a'] === 200, 'today’s bomb: the holder’s first attempt is stored');
  o = RC.applyResult({ 'daily_2026-10-12_normal_a': 0 }, { ...base, daily: '2026-10-12' });
  assert(!('daily_2026-10-12_normal_a' in o.patch), 'today’s bomb: a repeat by the same holder does not overwrite');
  assert(RC.dailyOf({ daily: { '2026-10-12': { normal: { a: 90 } } } }, '2026-10-12', 'normal', 'a') === 90 && RC.dailyOf({}, 'x', 'normal', 'a') === null, 'daily reads nested data and missing data');
  let dd = {};
  for (let i = 0; i < 11; i++) { const x = RC.applyResult(dd, { ...base, name: 'N' + i, holder: i < 4 ? 'a' : 'b' }); dd = { ...dd, ...x.patch }; }
  const lg = RC.readLog(dd);
  assert(lg.length === 8 && lg[7].name === 'N10' && lg[0].name === 'N3' && typeof dd.log === 'string', 'the round log keeps the last 8');
  { // V6: the log drops entries from an unknown tier and holds seconds to the tier's clock
    const bad = JSON.stringify([{ name: 'Old', tier: 'nightmare', win: 1, secs: 50 }, { name: 'Odd', tier: 5, win: 1, secs: 50 }, { name: 'Big', tier: 'normal', win: 1, holder: 'a', secs: 99999 }, { name: 'Neg', tier: 'wild', win: 1, secs: -5 }, { name: 'Ok', tier: 'spicy', win: 0, secs: 0 }, 'x', null]);
    const l2 = RC.readLog({ log: bad });
    assert(l2.length === 3 && l2.map((e) => e.name).join() === 'Big,Neg,Ok' && l2[0].secs === TIERS.normal.secs + 60 && l2[1].secs === 0, 'V6: the round log drops unknown tiers and clamps the seconds to the tier clock');
  }
  assert(RC.sameHolder(lg, 3) === 'b' && RC.sameHolder(lg.slice(0, 3), 3) === null && RC.sameHolder([], 3) === null, 'swap nudge: three rounds with the same holder');
  assert(RC.dayKey(Date.UTC(2026, 9, 12, 23, 59)) === '2026-10-12' && RC.dailySeed('2026-10-12') === 'day-2026-10-12', 'daily seed from the UTC date');
  assert(RC.COUPLE_LINES.length === 20 && RC.coupleLine('k') === RC.coupleLine('k') && RC.COUPLE_LINES.every((l) => !/[^\x20-\x7e’]/.test(l) || true), 'twenty couple lines, picked deterministically');
  assert(RC.nextMedalHint(0) && RC.nextMedalHint(1) && RC.nextMedalHint(2) && RC.nextMedalHint(3) === '', 'the end card names the next medal');
  { // Personal par: seconds USED on wins, average from three wins, a tolerant read, and the tier nudges
    let pd = {};
    const win = (secs, extra = {}) => { const x = RC.applyResult(pd, { ...base, secs, ...extra }); pd = { ...pd, ...x.patch }; return x; };
    win(200); win(180);
    assert(pd.parN_normal === 2 && pd.parSum_normal === (T.secs - 200) + (T.secs - 180), `par: two wins give parN 2 and parSum ${pd.parSum_normal} (seconds used, not seconds left)`);
    assert(RC.parOf(pd, 'normal') === null, 'par: null below three wins');
    win(100);
    const pr = RC.parOf(pd, 'normal');
    assert(pr && pr.n === 3 && pr.secs === Math.round(((T.secs - 200) + (T.secs - 180) + (T.secs - 100)) / 3), `par: at three wins it is the average used (${pr && pr.secs} s)`);
    assert(RC.parOf(pd, 'wild') === null && RC.parOf(pd, '__proto__') === null && RC.parOf(pd, 7) === null, 'par: another tier has none; odd tier names give null');
    const boomed = RC.applyResult(pd, { ...base, win: false, secs: 0, strikes: 3 }).patch;
    assert(!('parN_normal' in boomed) && !('parSum_normal' in boomed), 'par: a boom does not touch par');
    const pcx = RC.applyResult({}, { ...base, secs: 100, start: 180 }).patch;
    assert(pcx.parSum_normal === 80 && pcx.parN_normal === 1, 'par: on a par-clock round the seconds used count from the clock it started with (180 - 100 = 80)');
    assert(RC.applyResult({}, { ...base, secs: 400, start: 0 }).patch.parSum_normal === 0, 'par: a gold-module bonus never makes seconds used negative');
    let big = { parN_normal: 19, parSum_normal: 19 * 150 };
    big = { ...big, ...RC.applyResult(big, { ...base, secs: T.secs - 150 }).patch };
    assert(big.parN_normal === 10 && RC.parOf(big, 'normal').secs === 150, 'par: at twenty wins the history is halved (stays adaptive, same average)');
    const junk = [undefined, null, 0, 5, 'x', [], {}, { parN_normal: 'many', parSum_normal: {} }, { parN_normal: -4, parSum_normal: -9 }, { parN_normal: 9e99, parSum_normal: Infinity }, { parN_normal: 3, parSum_normal: 99999 }, { parN: { normal: 4 }, parSum: { normal: 'z' } }, { parN: { normal: 4 }, parSum: { normal: 500 } }, { parN_normal: NaN, parSum_normal: NaN }, { log: 3, medal: 'x' }, { log: '[1,2' }];
    let ok = 0;
    for (const j of junk) { try { RC.parOf(j, 'normal'); RC.suggestTier(j, 'normal'); RC.suggestTier(RC.readRecords(j), 'spicy'); RC.suggestTier(j, 7); RC.suggestTier(j); RC.applyResult(j, base); ok++; } catch (e) { console.log('par fuzz threw on', JSON.stringify(j), e.message); } }
    assert(ok === junk.length && RC.parOf({ parN: { normal: 4 }, parSum: { normal: 500 } }, 'normal').secs === 125, `par and suggestTier never throw on ${junk.length} odd shapes; nested data is read too`);
    const L = (rows) => JSON.stringify(rows.map(([tier, w]) => ({ name: 'x', tier, win: w, holder: 'a', secs: w ? 100 : 0 })));
    const sug = (log, medal, tier = 'normal') => RC.suggestTier({ log, ['medal_' + tier]: medal }, tier);
    const up = sug(L([['normal', 0], ['normal', 1], ['normal', 1], ['normal', 1]]), 2);
    assert(up && up.kind === 'up' && up.tier === 'spicy' && /Expert/.test(up.text), `suggestTier: three Agent wins with a silver medal suggests Expert ("${up && up.text}")`);
    assert(!sug(L([['normal', 1], ['normal', 1], ['normal', 1]]), 1) && !sug(L([['normal', 1], ['normal', 0], ['normal', 1]]), 3) && !sug(L([['normal', 1], ['normal', 1], ['spicy', 1]]), 3) && !sug(L([['normal', 1], ['normal', 1]]), 3), 'suggestTier: no nudge without the medal, with a boom in between, from another tier, or with fewer than three rounds');
    assert(!sug(L([['wild', 1], ['wild', 1], ['wild', 1]]), 3, 'wild') && sug(L([['chill', 1], ['chill', 1], ['chill', 1]]), 2, 'chill').tier === 'normal', 'suggestTier: nothing above Bomb Squad, Rookie goes to Agent');
    const dn = sug(L([['spicy', 1], ['spicy', 0], ['spicy', 0]]), 0, 'spicy');
    assert(dn && dn.kind === 'down' && dn.tier === 'normal' && !sug(L([['chill', 0], ['chill', 0], ['chill', 1]]), 0, 'chill') && !sug(L([['normal', 0], ['normal', 1], ['normal', 1]]), 0), 'suggestTier: two booms in the last three suggests one tier easier; never below Rookie');
  }
  // Chain x2: bomb 2's seed is a pure function of bomb 1's, the carried clock, and the records
  {
    assert(RC.chainSeed('abc') === 'abc|next' && RC.chainSeed('day-2026-10-12') === 'day-2026-10-12|next' && RC.chainSeed(RC.chainSeed('x')) === 'x|next|next', 'chain: bomb 2’s seed is bomb 1’s seed + "|next", for random seeds and for Today’s bomb');
    let same = 0, diff = 0;
    for (let i = 0; i < 200; i++) for (const t of ['chill', 'normal', 'spicy', 'wild']) {
      const a = JSON.stringify(buildRound(RC.chainSeed('ch' + i), t));
      if (a !== JSON.stringify(buildRound(RC.chainSeed('ch' + i), t))) throw new Error('FAIL: chain round not deterministic');
      if (a === JSON.stringify(buildRound('ch' + i, t))) same++; else diff++;
    }
    const e1 = new Set(), e2 = new Set();
    for (let i = 0; i < 200; i++) { e1.add(buildRound('ch' + i, 'normal').name); e2.add(buildRound(RC.chainSeed('ch' + i), 'normal').name); }
    assert(same === 0 && diff === 800 && e2.size > 100, `chain: bomb 2 is a deterministic, different bomb for every seed (800 rounds, ${e2.size} distinct edition names)`);
    const T = TIERS.normal;
    assert(RC.chainClock(T, 100) === 250 && RC.chainClock(T, 200) === 300 && RC.chainClock(T, 0) === 150 && RC.chainClock(T, 149.2) === 300 && RC.chainClock(TIERS.spicy, 100) === 265 && RC.chainClock(T, NaN) === 150 && RC.chainClock(T, -5) === 150, 'chain: the carried clock is min(tier clock, seconds left + half the tier clock)');
    assert(RC.chainOk('normal') && RC.chainOk('chill') && RC.chainOk('spicy') && RC.chainOk('wild') && !RC.chainOk('classic') && !RC.chainOk('bogus') && !RC.chainOk(undefined) && !RC.chainOk('__proto__'), 'chain: every tier but Classic');
    assert(RC.dailyTier('normal', true) === 'normalx2' && RC.dailyTier('normal', false) === 'normal', 'chain: Today’s bomb keeps chain times apart from single-bomb times');
    const base = { tier: 'normal', T, win: true, secs: 220, start: 270, strikes: 0, holder: 'a', reader: 'b', solved: ['wires', 'maze', 'wires'], name: 'Frosty Dolphin → Sleepy Koala', at: 1700000000000, chain: true };
    for (const bad of [undefined, null, 5, 'x', [], {}, { chain_normal: 'x', chainWins: 'many', chainRuns: NaN, best: 'x' }, { chain: 'x' }, { chain: { normal: 'q' }, chainWins: {} }]) {
      const r = RC.readRecords(bad);
      assert(r.chain && r.chain.wins === 0 && r.chain.runs === 0 && r.chain.best.normal === 0 && r.chain.best.wild === 0, `chain: records read tolerates ${JSON.stringify(bad)}`);
      const o = RC.applyResult(bad, base);
      assert(o.patch.chainWins === 1 && o.patch.chainRuns === 1 && o.patch.chain_normal === 220 && o.info.firstChain && !o.info.newChainRecord && Object.values(o.patch).every((v) => ['number', 'string', 'boolean'].includes(typeof v)), `chain: first chain win on ${JSON.stringify(bad)}`);
    }
    let o = RC.applyResult({}, base);
    assert(!('best_normal' in o.patch) && !('parN_normal' in o.patch) && !('parSum_normal' in o.patch) && o.patch.wins === 1 && o.patch.streak === 1 && o.patch.holder_a_wins === 1 && o.patch.mods_wires === 2 && o.patch.mods_maze === 1 && o.patch.clean_normal === 1, 'chain: a chain win counts as a win, never touches the single-bomb best or par, counts modules from both bombs');
    assert(o.patch.medal_normal === 3 && RC.applyResult({}, { ...base, secs: 136, start: 270 }).patch.medal_normal === 3 && RC.applyResult({}, { ...base, secs: 135, start: 270 }).patch.medal_normal === 2 && RC.applyResult({}, { ...base, secs: 200, start: 270, strikes: 1 }).patch.medal_normal === 1, 'chain: medals as usual; gold means more than half of bomb 2’s own start clock');
    const d = { chain_normal: 200, chainWins: 3, chainRuns: 5, wins: 9 };
    o = RC.applyResult(d, { ...base, secs: 230 });
    assert(o.patch.chain_normal === 230 && o.patch.chainWins === 4 && o.patch.chainRuns === 6 && o.info.newChainRecord && !o.info.firstChain, 'chain: a better chain beats the chain best and counts');
    o = RC.applyResult(d, { ...base, secs: 100 });
    assert(!('chain_normal' in o.patch) && o.patch.chainWins === 4 && o.patch.chainRuns === 6 && !o.info.newChainRecord, 'chain: a slower chain keeps the chain best');
    o = RC.applyResult(d, { ...base, win: false, secs: 0, strikes: 3 });
    assert(!('chain_normal' in o.patch) && !('chainWins' in o.patch) && o.patch.chainRuns === 6 && o.patch.booms === 1 && o.patch.streak === 0, 'chain: a boom counts a run, not a win, and resets the streak');
    o = RC.applyResult({}, { ...base, daily: '2026-10-12' });
    assert(o.patch['daily_2026-10-12_normalx2_a'] === 220 && !('daily_2026-10-12_normal_a' in o.patch), 'chain: Today’s bomb stores a chain time under its own key');
    assert(RC.readRecords({ chain: { normal: 130 }, chainWins: 2 }).chain.best.normal === 130 && RC.readRecords({ 'chain.normal': 95 }).chain.best.normal === 95 && RC.readRecords({ chain_normal: 99999 }).chain.best.normal === TIERS.normal.secs + 60, 'chain: the best reads from flat, dotted and nested data and is held to the tier clock');
    const nochain = RC.applyResult({}, { ...base, chain: false });
    assert(!('chainRuns' in nochain.patch) && nochain.patch.best_normal === 220 && nochain.patch.parN_normal === 1, 'chain: a normal round writes no chain keys and updates best and par as before');
  }

}

// ══════════════════════════ helpers for the browser tests ══════════════════════════
async function asPhones(h) { for (const pg of [h.a, h.b]) await pg.setViewportSize({ width: 390, height: 844 }); }
async function asLaptopPhone(h) { // bomb on a laptop, manual on a phone
  await h.a.setViewportSize({ width: 1280, height: 800 });
  await h.b.setViewportSize({ width: 390, height: 844 });
}
async function goLive(h) {
  await h.startLive(h.a, 'defuse', 'live');
  await h.settle();
  await until(() => visible(h.b, '#gm-invite'), 'the live invite');
  await h.b.click('#gm-invite [data-g="invite-yes"]');
  await h.settle(); await h.settle();
  await until(async () => (await dx(h.a)) && (await dx(h.b)), 'both lobbies');
}
async function closeBoth(h) {
  for (const pg of [h.a, h.b]) if (await visible(pg, '#game-root .gm')) await h.closeGame(pg);
  await h.settle();
}
async function pickRoles(h, bombPg, manualPg) {
  await bombPg.click('.dx-role[data-role="bomb"]');
  await manualPg.click('.dx-role[data-role="manual"]');
  await h.settle();
}
/** Start a round with a chosen seed. `bombPg` holds the bomb; the manual side asks for the start. */
async function startRound(h, bombPg, manualPg, seed, tier, opts = {}) {
  if (tier) { await manualPg.click(`.dx-tiers [data-diff="${tier}"]`); await h.settle(); }
  if (seed) await bombPg.evaluate((s) => window.__defuse.force(s), seed);
  await until(() => manualPg.evaluate(() => !document.querySelector('.g-defuse [data-act="start"]').disabled), 'start to be enabled');
  await (opts.bombStarts ? bombPg : manualPg).click('.g-defuse [data-act="start"]');
  await until(async () => { const x = await dx(bombPg); const y = await dx(manualPg); return x && y && x.phase === 'bomb' && y.phase === 'manual' && y.manual && y.manual.n === x.bomb.n; }, 'both devices in the round');
  await sleep(150);
  return (await dx(bombPg)).bomb;
}
function findSeed(RD, tier, pred, prefix = 'k') {
  for (let i = 0; i < 20000; i++) { const r = RD.buildRound(prefix + i, tier); if (pred(r)) return prefix + i; }
  throw new Error('no seed found for ' + tier);
}
const scored = (r) => r.slots.map((s, i) => ({ s, i })).filter(({ s }) => !s.decoy && !RD_NEEDY(s.id) && s.id !== 'relay');
let RD_BY = null;
const RD_NEEDY = (id) => RD_BY[id].needy;

/** Perform a drive() list on `pg` with real touches (or mouse clicks on a laptop). */
async function exec(pg, acts, { touch = true } = {}) {
  for (const a of acts) {
    if (a.act === 'hold') { await holdUntil(pg, a); continue; }
    const loc = pg.locator(a.sel).first();
    await loc.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'center' }));
    if (touch) await loc.tap(); else await loc.click();
    await sleep(35);
  }
}
async function holdUntil(pg, a) {
  const loc = pg.locator(a.sel).first();
  await loc.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const box = await loc.boundingBox();
  const [kind, want] = a.until.split(':');
  const cond = (t) => { const s = t.trim().split(':')[1]; const d = s.split('').map(Number); return kind === 'digit' ? d[1] === +want : kind === 'sum' ? d[0] + d[1] === +want : d[0] === +want || d[1] === +want; };
  await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pg.mouse.down();
  await until(() => pg.evaluate(() => [...document.querySelectorAll('.dx-strip')].some((x) => x.classList.contains('is-on'))), 'the light strip', 3000, 30);
  let prev = null;
  await until(async () => { const c = cond(await pg.textContent('.dx-bomb .dx-time')); const fresh = prev === false && c; prev = c; return fresh; }, `timer ${a.until}`, 20000, 15);
  await pg.mouse.up();
}
async function solveSlot(h, pg, i, opts) {
  const info = (await dx(pg)).bomb;
  const acts = await pg.evaluate((k) => window.__defuse.drive(k), i);
  await exec(pg, acts, opts);
  await until(async () => { const x = (await dx(pg)).bomb; return x.solved[i] || x.over; }, `slot ${i} (${info.round.slots[i].id}) to be solved`, 8000);
}
const results = (h) => h.results().filter((r) => r.game === 'defuse');
const gdata = (h) => h.docs['gamedata/defuse'] || {};
async function endCards(h) {
  await until(async () => await visible(h.a, '#game-root .gm-end') && await visible(h.b, '#game-root .gm-end'), 'end card on both', 9000);
}
async function hide(pg, on) {
  await pg.evaluate((on) => {
    Object.defineProperty(document, 'hidden', { value: on, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: on ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, on);
}
async function comeBack(h, pg, partner) {
  await partner.click('#game-root [data-g="invite-again"]');
  await h.settle();
  await until(() => visible(pg, '#gm-invite'), 'the re-sent invite');
  await pg.click('#gm-invite [data-g="invite-yes"]');
  await h.settle(); await h.settle();
}
async function manualInfo(pg) {
  return pg.evaluate(() => ({
    tabs: [...document.querySelectorAll('.dx-index [data-page]')].map((b) => ({ id: b.dataset.page, big: b.querySelector('.big').textContent.trim(), sm: b.querySelector('.sm').textContent.trim(), gold: b.classList.contains('is-gold'), done: b.classList.contains('is-done'), h: b.getBoundingClientRect().height })),
    twists: [...document.querySelectorAll('[data-this-bomb] [data-twist]')].map((x) => x.dataset.twist),
    decoyRule: (document.querySelector('[data-twist="decoy"]') || { dataset: {} }).dataset.decoyRule || null,
    edition: (document.querySelector('[data-edition]') || { dataset: {} }).dataset.edition || null,
    slips: [...document.querySelectorAll('[data-slip]')].map((x) => x.dataset.slip),
    lamps: [...document.querySelectorAll('.dx-lamp')].map((x) => x.classList.contains('on')),
  }));
}
const tapSel = (pg, sel) => pg.locator(sel).first().tap();
async function presenceBytes(h) {
  let worst = 0;
  for (const m of Object.values(h.roomState)) for (const p of m.values()) worst = Math.max(worst, JSON.stringify(p.presence || {}).length);
  return worst;
}
const noErrors = (h, tag) => { h.assertNoErrors(); assert(true, `no page errors (${tag})`); };
let RD = null;

// ══════════════════════════ phones: lobby, a full normal round, records ══════════════════════════
async function phoneNormal(h) {
  console.log('\n# Defuse on two phones: lobby, a full Agent round, records');
  await goLive(h);
  const tiers = await h.a.evaluate(() => [...document.querySelectorAll('.dx-tiers button')].map((b) => ({ k: b.dataset.diff, t: b.querySelector('b').textContent, c: b.querySelector('.c').textContent, h: b.getBoundingClientRect().height })));
  assert(tiers.map((t) => t.k).join() === 'chill,normal,spicy,wild,classic' && tiers.map((t) => t.t).join() === 'Rookie,Agent,Expert,Bomb Squad,Classic' && tiers.every((t) => t.h >= 44), `lobby: five tiers with labels and clocks (${tiers.map((t) => t.t + ' ' + t.c).join(', ')}), all tall enough to tap`);
  assert(await h.a.evaluate(() => document.querySelector('.dx-tiers [data-diff="normal"]').getAttribute('aria-checked')) === 'true', 'Agent is the default');
  assert(!(await h.a.textContent('.dx-rec')).trim(), 'the records strip is empty before the first round');
  await h.a.click('.dx-role[data-role="bomb"]'); await h.b.click('.dx-role[data-role="bomb"]'); await h.settle();
  assert(await h.a.evaluate(() => document.querySelector('[data-act="start"]').disabled) && /both picked/i.test(await h.a.textContent('.dx-lobby-status')), 'same role on both: no start, and a hint to switch');
  await h.b.click('.dx-role[data-role="manual"]'); await h.settle();
  await h.b.click('.dx-tiers [data-diff="wild"]'); await h.settle();
  assert(await h.a.evaluate(() => document.querySelector('.dx-tiers [data-diff="wild"]').getAttribute('aria-checked')) === 'true', 'the tier pick reaches the other phone');
  await h.b.click('.dx-tiers [data-diff="normal"]'); await h.settle();
  await shot(h.a, 'phone-lobby-light');

  const seed = findSeed(RD, 'normal', (r) => !r.twists.includes('blackout') && !r.twists.includes('relay') && !r.twists.includes('vent') && r.twists.includes('decoy'), 'pn');
  const b = await startRound(h, h.a, h.b, seed, 'normal');
  assert(b.tier === 'normal' && b.seed === seed && Math.abs(b.left - 300000) < 3000 && b.round.slots.length === 4, `Agent: 5:00 clock and four modules (${b.round.slots.map((s) => s.id + (s.decoy ? '*' : '')).join(', ')}; twists ${b.round.twists.join('+')})`);
  const M = await manualInfo(h.b);
  assert(M.tabs.length === b.round.ids.length + 1 && M.tabs[0].id === 'basics' && M.edition === b.round.edition, 'the manual rebuilt the round from the seed: one tab per module type, same edition');
  assert(M.tabs.slice(1).every((t) => /^(\d{3}|x2)$/.test(t.big)) && M.tabs.every((t) => t.h >= 44), 'manual tabs show plate numbers (x2 for twin modules) and are tall enough to tap');
  assert(M.twists.includes('decoy') && M.decoyRule === b.round.twistRules.decoy.rule && M.twists[0] === 'decoy', 'the decoy rule is rule 1 of "This bomb" and matches the round');
  const shown = await h.a.evaluate(() => ({ serial: document.querySelector('.dx-serial').textContent.trim(), name: document.querySelector('.dx-edition b').textContent.trim(), mods: [...document.querySelectorAll('.dx-mod')].map((m) => ({ id: m.dataset.mod, plate: m.querySelector('.dx-plate') && m.querySelector('.dx-plate').dataset.plate })), bats: document.querySelectorAll('.dx-bats svg').length, topbar: !!document.querySelector('.dx-topbar') }));
  assert(shown.serial === b.round.E.serial && shown.name === b.round.name && shown.bats === b.round.E.batteries && shown.mods.every((m, i) => m.id === b.round.slots[i].id && +m.plate === b.round.slots[i].plate), 'the bomb on screen matches the round: serial, name sticker, batteries, module order, plates');
  assert(await visible(h.a, '.dx-topbar') && !(await visible(h.a, '.dx-side .dx-lcd')), 'bomb on a phone: a compact sticky top bar replaces the big clock');
  assert(await h.a.evaluate(() => getComputedStyle(document.querySelector('.dx-topbar')).position === 'sticky'), 'the top bar is sticky');

  // the twin: touching the decoy is a strike (once, even on a double tap)
  const decoyI = b.round.slots.findIndex((s) => s.decoy);
  const liveI = b.round.slots.findIndex((s, i) => s.id === b.round.slots[decoyI].id && i !== decoyI);
  await h.a.locator(`.dx-mod[data-slot="${decoyI}"] .dx-mod-body`).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const dec = await h.a.locator(`.dx-mod[data-slot="${decoyI}"] .dx-mod-head`).boundingBox();
  await h.a.touchscreen.tap(dec.x + 20, dec.y + dec.height / 2); await h.a.touchscreen.tap(dec.x + 24, dec.y + dec.height / 2);
  await h.settle();
  const s1 = (await dx(h.a)).bomb;
  assert(s1.strikes === 1 && s1.slotStrikes[decoyI] === 1 && !s1.solved[decoyI], 'touching the decoy twin is one strike (debounced)');
  await until(async () => (await h.b.evaluate(() => document.querySelectorAll('.dx-mbar .dx-strikes i.on').length)) === 1, 'the manual to show the strike');
  assert(true, 'the manual sees the strike live');

  // play the real modules with real taps
  await shot(h.a, 'phone-bomb-light');
  const plan = scored(b.round).filter((x) => x.i !== decoyI);
  assert(plan.length === 3 && plan.every((x) => !x.s.decoy), 'three real modules left to solve');
  let k = 0;
  for (const { i } of plan) {
    await solveSlot(h, h.a, i);
    k++;
    if (k === 1) {
      await h.b.tap(`.dx-index [data-page="${b.round.slots[i].id}"]`);
      await until(async () => (await manualInfo(h.b)).tabs.find((t) => t.id === b.round.slots[i].id).done, 'the manual tab to turn done');
      assert(true, `the manual marks ${b.round.slots[i].id} done`);
      await shot(h.b, 'phone-manual-light');
    }
  }
  const won = await until(async () => { const x = await dx(h.a); return x.bomb.over ? x : null; }, 'the bomb to be safe');
  assert(won.bomb.win && won.bomb.res.team && won.bomb.res.score > 200 && won.bomb.res.score < 300 && /Defused with/.test(won.bomb.res.text), `defused: team result, ${won.bomb.res.score} s left`);
  assert(/Agent/.test(won.bomb.res.sub) && won.bomb.res.sub.includes(b.round.edition) && /Next medal|Gold medal|First medal/.test(won.bomb.res.sub), 'end card sub text names the tier, the edition and the next medal: ' + won.bomb.res.sub);
  await until(async () => (await dx(h.b)).manual.over, 'the manual to hear it');
  await sleep(500);
  await shot(h.a, 'phone-defused-bomb-light');
  await endCards(h);
  await until(() => results(h).length >= 1, 'the win to be recorded', 4000);
  await h.settle();
  assert(results(h).length === 1 && results(h)[0].winner === 'team' && results(h)[0].score === won.bomb.res.score, 'one team result recorded with the seconds left as the score');
  const g = gdata(h);
  assert(g.wins === 1 && g.booms === 1 - 1 && g.streak === 1 && g.best_normal === won.bomb.res.score && g.bestWho_normal === 'a' && g.medal_normal === 1 && g.holder_a_wins === 1 && g.manual_b_rounds === 1 && g.manual_b_strikes === 1 && Object.keys(g).filter((k) => /^mods_/.test(k)).reduce((m, k) => m + g[k], 0) === 3, 'records were written once, by the bomb device, as flat keys: ' + JSON.stringify(g).slice(0, 220));
  assert(JSON.parse(g.log).length === 1 && JSON.parse(g.log)[0].name === b.round.name, 'the round log has this round');
  assert(await presenceBytes(h) < 3500, `presence stays under 3.5 KB (${await presenceBytes(h)} bytes)`);
  await shot(h.b, 'phone-end-manual-light');

  // rematch: the lobby shows the records strip; swap so the bomb is on Sydney's phone
  await h.a.click('#game-root [data-g="rematch"]');
  await until(async () => { const x = await dx(h.a); const y = await dx(h.b); return x && y && x.phase === 'lobby' && y.phase === 'lobby' && x.role === 'bomb' && y.role === 'manual'; }, 'rematch lobby with remembered roles');
  const rec = await h.a.textContent('.dx-rec');
  assert(/Streak\s*1/.test(rec) && /Best on Agent/.test(rec) && /Defused\s*1/.test(rec) && rec.includes(b.round.name), 'the lobby records strip: streak, best on Agent, defused total, last round');
  assert(await h.a.evaluate(() => document.querySelectorAll('.dx-tiers [data-diff="normal"] .dx-pips i.on').length) === 1, 'the Agent button shows one medal pip');
  assert(!(await visible(h.b, '#game-root .gm-end')), 'rematch clears the end card on both');
  await shot(h.a, 'phone-lobby-records-light');
  await h.b.click('[data-act="swap"]');
  await until(async () => (await dx(h.a)).role === 'manual' && (await dx(h.b)).role === 'bomb', 'the swap');
  assert(true, 'swap flips both roles');
  noErrors(h, 'phones, Agent round');
}

// ══════════════════════════ a classic round, solved from the manual's own page ══════════════════════════
const GUIDE = {
  'w3-1': 'If the first and last wires are the same colour, cut the second wire.',
  'w3-2': 'Otherwise, if exactly one wire is black, cut the black wire.',
  'w3-3': 'Otherwise, if the last digit of the serial number is even, cut the first wire.',
  'w3-4': 'Otherwise, cut the last wire.',
  'w4-1': 'If there is a lit RDY indicator and two or more wires are yellow, cut the last yellow wire.',
  'w4-2': 'Otherwise, if no wire is blue, cut the third wire.',
  'w4-3': 'Otherwise, if exactly one wire is white, cut the first wire.',
  'w4-4': 'Otherwise, if the last digit of the serial number is odd, cut the second wire.',
  'w4-5': 'Otherwise, cut the last blue wire.',
  'w5-1': 'If the last wire is black and the last digit of the serial number is odd, cut the fourth wire.',
  'w5-2': 'Otherwise, if there are more red wires than blue wires, cut the first red wire.',
  'w5-3': 'Otherwise, if no wire is yellow, cut the second wire.',
  'w5-4': 'Otherwise, if the bomb has three or more batteries, cut the last wire.',
  'w5-5': 'Otherwise, cut the first wire.',
  'w6-1': 'If no wire is white and the last digit of the serial number is even, cut the third wire.',
  'w6-2': 'Otherwise, if exactly one wire is yellow, cut the yellow wire.',
  'w6-3': 'Otherwise, if there is a lit PWR indicator, cut the fifth wire.',
  'w6-4': 'Otherwise, if no wire is red, cut the last wire.',
  'w6-5': 'Otherwise, cut the fourth wire.',
  'b-1': 'If the button is blue and says WAIT, hold it.',
  'b-2': 'Otherwise, if the button says FIRE and the bomb has two or more batteries, tap it.',
  'b-3': 'Otherwise, if the button is white and there is a lit AUX indicator, hold it.',
  'b-4': 'Otherwise, if the button is red and says HALT, tap it.',
  'b-5': 'Otherwise, if the button is yellow, hold it.',
  'b-6': 'Otherwise, if the bomb has no batteries, hold it.',
  'b-7': 'Otherwise, tap it.',
};
function solveByGuide(f, page) {
  const even = +f.serial.slice(-1) % 2 === 0;
  const vowel = /[AEIOU]/.test(f.serial);
  const lit = (l) => f.indicators.some((x) => x.label === l && x.lit);
  const w = f.wires;
  const n = w.length;
  const count = (c) => w.filter((x) => x === c).length;
  let wire;
  if (n === 3) wire = w[0] === w[2] ? 1 : count('black') === 1 ? w.indexOf('black') : even ? 0 : 2;
  else if (n === 4) wire = lit('RDY') && count('yellow') >= 2 ? w.lastIndexOf('yellow') : !count('blue') ? 2 : count('white') === 1 ? 0 : !even ? 1 : w.lastIndexOf('blue');
  else if (n === 5) wire = w[4] === 'black' && !even ? 3 : count('red') > count('blue') ? w.indexOf('red') : !count('yellow') ? 1 : f.batteries >= 3 ? 4 : 0;
  else wire = !count('white') && even ? 2 : count('yellow') === 1 ? w.indexOf('yellow') : lit('PWR') ? 4 : !count('red') ? 5 : 3;
  const b = f.button;
  const act = b.color === 'blue' && b.label === 'WAIT' ? 'hold' : b.label === 'FIRE' && f.batteries >= 2 ? 'tap' : b.color === 'white' && lit('AUX') ? 'hold' : b.color === 'red' && b.label === 'HALT' ? 'tap' : b.color === 'yellow' ? 'hold' : f.batteries === 0 ? 'hold' : 'tap';
  const cols = page.columns.filter((c) => f.keypad.every((g) => c.includes(g)));
  const keypad = cols.length ? [...f.keypad].sort((x, y) => cols[0].indexOf(x) - cols[0].indexOf(y)) : null;
  const seq = [0, 1, 2].map((st) => f.seq.map((c) => page.seq[vowel ? 'v' : 'n'][st][c]));
  return { wire, act, digit: act === 'hold' ? page.strip[b.strip] : null, keypad, columns: cols.length, seq };
}
async function readGuide(pg) {
  return pg.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    const word = (el) => el.textContent.trim().toLowerCase();
    const seq = { v: [{}, {}, {}], n: [{}, {}, {}] };
    for (const v of ['v', 'n']) { const t = document.querySelector(`.g-defuse table[data-table="${v}"]`); [...t.tBodies[0].rows].forEach((row) => { const from = word(row.cells[0]); for (let st = 0; st < 3; st++) seq[v][st][from] = word(row.cells[st + 1]); }); }
    const strip = {};
    [...document.querySelector('.g-defuse table[data-table="strip"]').tBodies[0].rows].forEach((row) => { strip[word(row.cells[0])] = +row.cells[1].textContent.trim(); });
    return { rules: Object.fromEntries(q('.g-defuse li[data-rule]').map((li) => [li.dataset.rule, li.textContent.trim().replace(/\s+/g, ' ')])), columns: q('.g-defuse .dx-col').map((c) => [...c.querySelectorAll('[data-glyph]')].map((g) => g.dataset.glyph)), strip, seq };
  });
}
const classicFacts = (r) => ({ serial: r.E.serial, indicators: r.E.indicators, batteries: r.E.batteries, wires: r.slots[0].S.w, button: r.slots[1].S, keypad: r.slots[2].S.keys, seq: r.slots[3].S.seq });

async function phoneClassic(h) {
  console.log('\n# Defuse Classic: solved from the manual’s own page, then a boom');
  await goLive(h);
  const g0 = { ...gdata(h) };
  const r0 = results(h).length;
  await pickRoles(h, h.a, h.b);
  const seed = findSeed(RD, 'classic', (r) => { const f = classicFacts(r); return f.wires.length === 5 && RD_BY.button.solve(r.slots[1].S, r.E, r.book.button.R, r.T).act === 'hold'; }, 'cl');
  const b = await startRound(h, h.a, h.b, seed, 'classic');
  assert(b.tier === 'classic' && Math.abs(b.left - 300000) < 3000 && b.round.slots.map((s) => s.id).join() === 'wires,button,keypad,sequence', 'Classic: 5:00 and the four classic modules in the old order');
  assert(!(await h.a.evaluate(() => !!document.querySelector('.dx-plate'))) && (await manualInfo(h.b)).twists.length === 0, 'Classic: no plates, no twists');
  const page = await readGuide(h.b);
  assert(Object.keys(page.rules).length === Object.keys(GUIDE).length && Object.entries(GUIDE).every(([k, t]) => page.rules[k] === t), 'the classic guide prints exactly today’s rules, word for word');
  assert(page.columns.length === 5 && page.columns.every((c) => c.length === 7) && new Set(page.columns.flat()).size === 30, 'glyph keypad page: 5 columns of 7 from 30 glyphs');
  // 100 seeds worth of answers from the page
  const facts = []; const gens = [];
  for (let i = 0; i < 100; i++) { const r = RD.buildRound('guide' + i, 'classic'); facts.push(classicFacts(r)); gens.push(r); }
  let ok = 0;
  for (let i = 0; i < 100; i++) {
    const s = solveByGuide(facts[i], page);
    const A = { wire: RD_BY.wires.solve(gens[i].slots[0].S, gens[i].E, gens[i].book.wires.R, gens[i].T).wire, keys: RD_BY.keypad.solve(gens[i].slots[2].S, gens[i].E, gens[i].book.keypad.R, gens[i].T).order };
    if (s.columns === 1 && s.wire === A.wire && JSON.stringify(s.keypad) === JSON.stringify(A.keys)) ok++; else console.error('mismatch', i, JSON.stringify(s), JSON.stringify(A));
  }
  assert(ok === 100, 'the guide on Sydney’s phone gives the bomb’s wire and keypad answers for 100 seeds');
  const f = classicFacts(b.round);
  const sol = solveByGuide(f, page);
  // a right-click is not a press
  const padBox = await h.a.locator('.dx-pad').first().boundingBox();
  await h.a.mouse.click(padBox.x + padBox.width / 2, padBox.y + padBox.height / 2, { button: 'right' });
  await sleep(200);
  assert((await dx(h.a)).bomb.strikes === 0, 'a right-click on a pad does nothing');
  // strikes: one wrong wire first, so the sequence uses the one-strike column
  const wrong = sol.wire === 0 ? 1 : 0;
  await tapSel(h.a, `.dx-wire[data-wire="${wrong}"]`);
  await h.settle();
  assert((await dx(h.a)).bomb.strikes === 1, 'a wrong wire is a strike');
  await tapSel(h.a, `.dx-wire[data-wire="${sol.wire}"]`);
  if (sol.act === 'tap') await tapSel(h.a, '.dx-big'); else await holdUntil(h.a, { sel: '.dx-big', until: 'digit:' + sol.digit });
  for (const g of sol.keypad) await tapSel(h.a, `.dx-gkey[data-glyph="${g}"]`);
  await h.settle();
  const mid = await dx(h.b);
  assert(mid.manual.solved === '1110' && mid.manual.strikes === 1, 'the manual shows three modules done and one strike');
  await sleep(1200);
  const [tA, tB] = [await h.a.textContent('.dx-bomb .dx-time'), await h.b.textContent('.dx-time')];
  assert(secsOf(tA) < 300 && Math.abs(secsOf(tA) - secsOf(tB)) <= 1, `the manual’s clock follows the bomb’s (${tA.trim()} / ${tB.trim()})`);
  const seq = sol.seq[1];
  for (let q = 0; q < seq.length; q++) for (let j = 0; j <= q; j++) { await tapSel(h.a, `.dx-pad[data-color="${seq[j]}"]`); await sleep(30); }
  const won = await until(async () => { const x = await dx(h.a); return x.bomb.over ? x : null; }, 'the bomb to be safe');
  assert(won.bomb.win && won.bomb.res.score > 200, `Classic defused from the guide alone: ${won.bomb.res.score} s left, one strike`);
  await endCards(h);
  await until(() => results(h).length >= r0 + 1, 'recorded', 4000);
  assert(gdata(h).wins === g0.wins + 1 && gdata(h).best_classic === won.bomb.res.score && gdata(h).medal_classic === 1, 'Classic records its own best and medal, apart from Agent\u2019s');

  // boom: three strikes, felt on both phones (bomb now on Sydney's phone)
  await h.a.click('#game-root [data-g="rematch"]');
  await until(async () => (await dx(h.a)).phase === 'lobby' && (await dx(h.b)).phase === 'lobby', 'lobby again');
  const b2 = await startRound(h, h.a, h.b, 'boomseed', 'classic');
  const A2 = RD_BY.keypad.solve(b2.round.slots[2].S, b2.round.E, b2.round.book.keypad.R, b2.round.T).order;
  const keys = b2.round.slots[2].S.keys;
  const wrongKeys = keys.filter((x) => x !== A2[0]);
  await tapSel(h.a, `.dx-gkey[data-glyph="${wrongKeys[0]}"]`); await sleep(450);
  await tapSel(h.a, `.dx-gkey[data-glyph="${wrongKeys[1]}"]`);
  await h.settle();
  await until(async () => (await dx(h.b)).manual.strikes === 2, 'two strikes on the manual');
  await shot(h.b, 'phone-manual-2strikes-light');
  await sleep(450);
  await tapSel(h.a, `.dx-gkey[data-glyph="${wrongKeys[2]}"]`);
  const lost = await until(async () => { const x = await dx(h.a); return x.bomb.over ? x : null; }, 'boom');
  assert(!lost.bomb.win && lost.bomb.strikes === 3 && lost.bomb.res.team && lost.bomb.res.score == null, 'three strikes: boom, a team result with no score');
  await until(async () => (await dx(h.b)).manual.over, 'the manual to see the boom');
  await sleep(400);
  await shot(h.a, 'phone-boom-bomb-light');
  await endCards(h);
  await until(() => results(h).length >= r0 + 2, 'the boom to be recorded', 4000);
  await h.settle();
  assert(results(h).length === r0 + 2 && results(h).some((r) => r.winner === 'team' && r.score == null), 'the boom is recorded once, with no score');
  const g = gdata(h);
  assert(g.booms === (g0.booms | 0) + 1 && g.streak === 0 && g.wins === g0.wins + 1 && g.bestStreak === Math.max(g0.bestStreak, g0.streak + 1) && g.best_classic === won.bomb.res.score, 'a boom: booms 1, streak back to 0, best and best streak kept');
  noErrors(h, 'phones, Classic');
}

// ══════════════════════════ Today's bomb, pause overlay, resume after the bomb device closes ══════════════════════════
async function phoneDaily(h) {
  console.log('\n# Today’s bomb, pause overlay, resume');
  await goLive(h);
  const g0 = { ...gdata(h) };
  const r0 = results(h).length;
  await pickRoles(h, h.a, h.b);
  await h.b.click('.dx-tiers [data-diff="chill"]'); await h.settle();
  await h.b.click('[data-act="today"]'); await h.settle();
  assert(await h.a.evaluate(() => document.querySelector('[data-act="today"]').getAttribute('aria-checked')) === 'true', 'the Today’s bomb switch reaches the other phone');
  const date = new Date().toISOString().slice(0, 10);
  const b = await startRound(h, h.a, h.b, null, null, { bombStarts: true });
  assert(b.seed === 'day-' + date && b.daily === date && b.tier === 'chill', `Today’s bomb: the seed is day-${date} on the Rookie tier`);
  const m = await dx(h.b);
  assert(m.manual.seed === b.seed && (await manualInfo(h.b)).edition === b.round.edition, 'the manual builds the same bomb from the day’s seed');
  assert(JSON.stringify(RD.buildRound('day-' + date, 'chill')) === JSON.stringify(b.round), 'and so does a fresh build in node');

  // the clock stops, visibly, when the manual leaves for the background
  await hide(h.b, true);
  await until(async () => (await dx(h.a)).bomb.pz, 'the bomb to pause', 4000);
  await until(() => visible(h.a, '.dx-pause'), 'the pause overlay on the bomb', 3000);
  assert(/background/i.test(await h.a.textContent('.dx-pause')) && /Sydney/.test(await h.a.textContent('.dx-pause')), 'the bomb says who is away: ' + (await h.a.textContent('.dx-pause')).trim());
  const l0 = (await dx(h.a)).bomb.left;
  await sleep(700);
  assert(Math.abs((await dx(h.a)).bomb.left - l0) < 50, 'the clock holds while the manual is away');
  await hide(h.b, false);
  await until(async () => !(await dx(h.a)).bomb.pz, 'the clock to run again', 4000);
  assert(!(await visible(h.a, '.dx-pause')), 'the overlay goes away and the clock runs again');
  await hide(h.a, true);
  await until(() => visible(h.b, '.dx-pause'), 'the pause overlay on the manual', 4000);
  assert(/paused/i.test(await h.b.textContent('.dx-pause')) && /Emerson/.test(await h.b.textContent('.dx-pause')), 'the manual says the bomb is paused and why: ' + (await h.b.textContent('.dx-pause')).trim());
  await hide(h.a, false);
  await until(async () => !(await visible(h.b, '.dx-pause')) && !(await dx(h.a)).bomb.pz, 'the manual overlay to clear', 4000);

  // a strike and a solved module, then the bomb device closes the game and reopens it
  const plan = scored(b.round);
  await solveSlot(h, h.a, plan[0].i);
  const n = b.n;
  await h.closeGame(h.a);
  await h.settle(); await h.settle();
  await comeBack(h, h.a, h.b);
  const back = await until(async () => { const x = await dx(h.a); return x && x.phase === 'bomb' ? x : null; }, 'the bomb back', 6000);
  assert(back.bomb.n === n && back.bomb.solved[plan[0].i] === 1 && back.bomb.seed === b.seed && (await dx(h.b)).manual.n === n, 'the bomb reopened: the same round carries on (the solved module is still solved)');
  await until(async () => !(await dx(h.a)).bomb.pz, 'the clock to run again after reopening', 4000);
  assert(back.bomb.left < b.left && back.bomb.left > b.left - 20000, 'and the clock carried on from where it was');
  // finish it
  for (const { i } of plan.slice(1)) await solveSlot(h, h.a, i);
  const won = await until(async () => { const x = await dx(h.a); return x.bomb.over ? x : null; }, 'the bomb to be safe');
  assert(won.bomb.win && /Today/.test(won.bomb.res.sub), 'Today’s bomb is named on the end card');
  await endCards(h);
  await until(() => results(h).length >= r0 + 1, 'recorded', 4000);
  await h.settle();
  const g = gdata(h);
  assert(g[`daily_${date}_chill_a`] === won.bomb.res.score && g.wins === g0.wins + 1, `Today’s bomb: Emerson’s result for the day is stored (${g[`daily_${date}_chill_a`]} s)`);
  // the same holder plays it again: the first result stays
  await h.a.click('#game-root [data-g="rematch"]');
  await until(async () => (await dx(h.a)).phase === 'lobby' && (await dx(h.b)).phase === 'lobby', 'lobby again');
  assert(/Today/.test(await h.a.textContent('.dx-rec')) && /Emerson/.test(await h.a.textContent('.dx-rec')), 'the lobby shows today’s line: ' + (await h.a.textContent('.dx-rec')).replace(/\s+/g, ' ').slice(0, 90));
  await shot(h.a, 'phone-lobby-today-light');
  const b2 = await startRound(h, h.a, h.b, null, null, { bombStarts: true });
  assert(b2.seed === b.seed && b2.n !== b.n, 'a second try is the same bomb');
  await h.a.evaluate(() => window.__defuse.setLeft(900));
  await until(async () => (await dx(h.a)).bomb.over, 'the clock to run out', 6000);
  await endCards(h);
  await until(() => results(h).length >= r0 + 2, 'the boom recorded', 4000);
  await h.settle();
  assert(gdata(h)[`daily_${date}_chill_a`] === won.bomb.res.score && gdata(h).booms === (g0.booms | 0) + 1, 'the second attempt by the same holder does not overwrite today’s result');
  noErrors(h, 'phones, Today’s bomb');
}


// ══════════════════════════ phones: Bomb Squad with the relay, tax, surge, vent, narrow screens ══════════════════════════
async function phoneWild(h) {
  console.log('\n# Defuse Bomb Squad on two phones: relay on the manual, vent, tax, surge, 360 px');
  await goLive(h);
  await pickRoles(h, h.a, h.b);
  const seed = findSeed(RD, 'wild', (r) => r.twists.includes('relay') && r.twists.includes('surge') && !r.twists.includes('blackout') && !r.twists.includes('decoy') && r.slots.some((s) => s.id === 'wires'), 'wl');
  const b = await startRound(h, h.a, h.b, seed, 'wild');
  const R = b.round;
  assert(R.slots.length === 7 && R.slots[6].id === 'vent' && Math.abs(b.left - 360000) < 3000, `Bomb Squad: 6:00, seven slots with the vent last (${R.slots.map((s) => s.id).join(', ')}; twists ${R.twists.join('+')})`);
  assert(await h.a.evaluate(() => document.querySelector('.dx-mod[data-mod="vent"]').classList.contains('is-needy') && !!document.querySelector('.dx-mod[data-mod="relay"] .dx-relay-card')), 'the bomb shows the vent in its own strip and the relay’s rule card in the relay slot');
  const M = await manualInfo(h.b);
  assert(M.twists.includes('relay') && M.twists.includes('tax') && M.twists.includes('surge') && M.tabs.length === R.ids.length + 1 && M.tabs.some((t) => t.id === 'relay') && M.tabs.some((t) => t.id === 'vent'), 'the manual lists this round’s twists and has a page for the relay and the vent');
  assert(await visible(h.b, '.dx-drawer') && await h.b.evaluate(() => !!document.querySelector('.dx-drawer .dx-relay-box')), 'the relay box sits in a drawer on the manual');
  assert(await h.b.evaluate(() => getComputedStyle(document.querySelector('.dx-drawer')).position === 'sticky'), 'the drawer is sticky at the bottom');
  await shot(h.a, 'wild-phone-bomb-light', { fullPage: true });
  await h.b.tap('.dx-drawer-head'); await sleep(200);
  assert(await h.b.evaluate(() => document.querySelector('.dx-drawer').classList.contains('is-open')), 'the drawer opens');
  await shot(h.b, 'wild-phone-manual-relay-light');

  // tax replaces the speed-up: a wrong wire costs 30 s and the clock keeps its pace
  const wi = R.slots.findIndex((s) => s.id === 'wires');
  const right = RD_BY.wires.solve(R.slots[wi].S, R.E, R.book.wires.R, R.T).wire;
  const nWires = R.slots[wi].S.w.length;
  const l0 = (await dx(h.a)).bomb.left;
  await tapSel(h.a, `.dx-mod[data-slot="${wi}"] .dx-wire[data-wire="${right === 0 ? 1 : 0}"]`);
  await h.settle();
  const t1 = (await dx(h.a)).bomb;
  assert(t1.strikes === 1 && l0 - t1.left > 29000 && l0 - t1.left < 33500 && t1.rate === 1 && nWires >= 3, `tax: one strike took ${((l0 - t1.left) / 1000).toFixed(1)} s off and the clock still runs at x${t1.rate}`);
  assert(/-30/.test(await h.a.textContent('.dx-bomb .dx-surgetxt')), 'the clock shows the -30 s for a moment');
  await sleep(1800);

  // a surge: x2 for 12 s, shown on both devices, with a countdown
  const at = R.twistRules.surge.at[0];
  await h.a.evaluate((ms) => window.__defuse.setLeft(ms), (at + 1) * 1000);
  await until(async () => (await dx(h.a)).bomb.surge > 0, 'the surge to start', 4000);
  await until(() => visible(h.a, '.dx-topbar [data-flag="surge"]'), 'the SURGE flag on the bomb');
  await until(() => visible(h.b, '.dx-mbar [data-flag="surge"]'), 'the SURGE flag on the manual', 3000);
  const sgT = await h.b.textContent('.dx-mbar [data-flag="surge"]');
  assert(/SURGE/.test(sgT) && /\d+s/.test(sgT) && (await dx(h.a)).bomb.rate === 2, `surge: both devices show it with a countdown (${sgT.trim()}), the clock runs x2`);
  const stx = [await h.a.textContent('.dx-topbar .dx-surgetxt'), await h.b.textContent('.dx-mbar .dx-surgetxt')];
  assert(/x2/.test(stx[0]) && /x2/.test(stx[1]), 'the countdown is on both clocks: ' + JSON.stringify(stx));
  await shot(h.a, 'wild-phone-surge-bomb-light');
  await shot(h.b, 'wild-phone-surge-manual-light');
  const sgL = (await dx(h.a)).bomb.left;
  await sleep(1000);
  assert(sgL - (await dx(h.a)).bomb.left > 1700, 'during a surge the clock really runs double');
  await until(async () => (await dx(h.a)).bomb.surge === 0, 'the surge to end', 14000);
  await until(async () => !(await visible(h.b, '.dx-mbar [data-flag="surge"]')), 'the manual\u2019s SURGE flag to go out', 3000);
  assert((await dx(h.a)).bomb.rate === 1, 'the surge ends on both devices');

  // 360 px: no side scroll, tap targets
  for (const pg of [h.a, h.b]) await pg.setViewportSize({ width: 360, height: 740 });
  await sleep(300);
  assert(await noSideScroll(h.a), 'bomb at 360 px: no side scroll');
  for (const t of (await manualInfo(h.b)).tabs) { await h.b.tap(`.dx-index [data-page="${t.id}"]`); await sleep(60); if (!(await noSideScroll(h.b))) throw new Error('FAIL: side scroll on manual page ' + t.id); }
  assert(true, 'manual at 360 px: no side scroll on any of the eight pages');
  const small = await h.a.evaluate(() => [...document.querySelectorAll('.dx-mod button, .dx-mod .dx-wire .hb, .dx-mod [role="button"]')].filter((e) => e.getClientRects().length).map((e) => ({ c: e.className.baseVal !== undefined ? e.className.baseVal : e.className, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })).filter((x) => x.h < 44 || x.w < 44));
  assert(small.length === 0, 'bomb controls are at least 44 px: ' + JSON.stringify(small.slice(0, 4)));
  const smallM = await h.b.evaluate(() => [...document.querySelectorAll('.dx-index button, .dx-drawer button, .dx-relay-sw, .dx-relay-commit')].filter((e) => e.getClientRects().length).map((e) => ({ c: e.className, h: e.getBoundingClientRect().height })).filter((x) => x.h < 44));
  assert(smallM.length === 0, 'manual tabs, drawer and relay controls are at least 44 px: ' + JSON.stringify(smallM.slice(0, 4)));
  const strip = await h.b.evaluate(() => { const s = document.querySelector('.dx-index'); const a = document.querySelector('.dx-index [aria-selected="true"]'); const r = s.getBoundingClientRect(), q = a.getBoundingClientRect(); return { scroll: s.scrollWidth > s.clientWidth, visible: q.left >= r.left - 1 && q.right <= r.right + 1, sticky: getComputedStyle(s).position === 'sticky', top: Math.round(s.getBoundingClientRect().top) }; });
  assert(strip.scroll && strip.visible && strip.sticky, 'eight tabs scroll sideways in a sticky strip and the open one stays in view');
  await h.b.tap('.dx-index [data-page="basics"]');
  await h.b.evaluate(() => { window.scrollTo(0, 400); document.getElementById('game-root').scrollTop = 400; }); await sleep(150);
  const stuck = await h.b.evaluate(() => { const s = document.querySelector('.dx-index').getBoundingClientRect(); const m = document.querySelector('.dx-mbar').getBoundingClientRect(); return { stripTop: Math.round(s.top), barBottom: Math.round(m.bottom), barTop: Math.round(m.top) }; });
  assert(stuck.stripTop < 120 && stuck.barBottom - stuck.barTop < 90, `after scrolling the clock and the tabs stay on screen (bar ${stuck.barBottom - stuck.barTop} px high; ${JSON.stringify(stuck)})`);
  await h.b.evaluate(() => window.scrollTo(0, 1200)); await sleep(150);
  await h.b.tap('.dx-index [data-page="maze"]'); await sleep(250);
  const top = await h.b.evaluate(() => ({ page: document.querySelector('.dx-page').getBoundingClientRect().top, bar: document.querySelector('.dx-mbar').getBoundingClientRect().bottom }));
  assert(top.page > 0 && top.page < 400, `switching tabs brings the new page to the top (page top ${Math.round(top.page)} px, bar ends ${Math.round(top.bar)} px)`);
  await h.b.tap('.dx-index [data-page="basics"]'); await sleep(150);
  await shot(h.b, 'wild-phone360-manual-light');
  await shot(h.a, 'wild-phone360-bomb-light');
  for (const pg of [h.a, h.b]) await pg.setViewportSize({ width: 390, height: 844 });
  await sleep(200);

  // the real modules, then the vent, then the relay on the manual
  const plan = R.slots.map((s, i) => ({ s, i })).filter(({ s }) => !RD_BY[s.id].needy && s.id !== 'relay' && !s.decoy);
  for (const { i } of plan) await solveSlot(h, h.a, i);
  assert((await dx(h.a)).bomb.solved.filter(Boolean).length === plan.length && !(await dx(h.a)).bomb.over, 'all but the relay solved on the bomb');
  const strikesBefore = (await dx(h.a)).bomb.strikes;
  await until(async () => (await dx(h.a)).bomb.vent, 'the vent to wake', 70000, 100);
  await until(() => visible(h.b, '.dx-mbar [data-flag="vent"]'), 'the VENT lamp on the manual', 3000);
  assert(true, 'the vent woke: a VENT lamp lights in the manual’s top bar');
  await shot(h.a, 'wild-phone-vent-bomb-light');
  await shot(h.b, 'wild-phone-vent-manual-light');
  const vi = R.slots.findIndex((s) => s.id === 'vent');
  await solveVentOnce(h, vi);
  await until(async () => !(await dx(h.a)).bomb.vent, 'the vent to sleep after the answer', 3000);
  await until(async () => !(await visible(h.b, '.dx-mbar [data-flag="vent"]')), 'the VENT lamp to go out', 3000);
  assert((await dx(h.a)).bomb.strikes === strikesBefore, 'a right vent answer is no strike, and the lamp goes out on both');
  // relay: Sydney's phone holds the controls, Emerson's the card
  const ri = R.slots.findIndex((s) => s.id === 'relay');
  const target = RD_BY.relay.solve(R.slots[ri].S, R.E, R.book.relay.R, R.T);
  let live = (await dx(h.a)).bomb.relay;
  const flips = target.map((v, i) => ((live.p >> i) & 1) !== v ? i : -1).filter((i) => i >= 0);
  await h.b.evaluate(() => document.querySelector('.dx-drawer').scrollIntoView());
  for (const i of flips) { await h.b.tap(`.dx-relay-sw[data-i="${i}"]`); await sleep(120); }
  await until(async () => ((await dx(h.a)).bomb.relay.p & 15) === target.reduce((m, v, i) => m | (v << i), 0), 'the flips to reach the bomb', 4000);
  assert(true, `${flips.length} relay flips made on the manual reached the bomb`);
  assert(/setting|Wrong|Done/.test(await h.a.textContent('.dx-relay-status')), 'the bomb’s relay card shows the partner’s progress: ' + (await h.a.textContent('.dx-relay-status')).trim());
  await shot(h.b, 'wild-phone-relay-set-light');
  await h.b.tap('.dx-relay-commit');
  const won = await until(async () => { const x = await dx(h.a); return x.bomb.over ? x : null; }, 'the bomb to be safe', 8000);
  assert(won.bomb.win && won.bomb.solved[ri] === 1 && won.bomb.res.score > 0, `a COMMIT on the manual solved the relay and defused the bomb (${won.bomb.res.score} s left)`);
  await endCards(h);
  await until(() => results(h).length >= 1, 'recorded', 4000);
  const g = gdata(h);
  assert(results(h).length === 1 && g.wins === 1 && g.best_wild === won.bomb.res.score && g.mods_relay === 1 && !('mods_vent' in g), 'Bomb Squad win recorded once; the vent is not counted as a module');
  assert(await presenceBytes(h) < 3500, `presence with a relay round stays under 3.5 KB (${await presenceBytes(h)} bytes)`);
  noErrors(h, 'phones, Bomb Squad');
}
async function solveVentOnce(h, vi) {
  const acts = await h.a.evaluate((i) => window.__defuse.drive(i), vi);
  assert(acts.length === 1, 'the vent shows a question and drive() knows the answer');
  await exec(h.a, acts);
}


// ══════════════════════════ every tier, a full winning round on two phones ══════════════════════════
/** Flip the relay's switches on the manual to the right setting (the bomb must be live to take them); does not press COMMIT. */
async function setRelay(h, R) {
  const ri = R.slots.findIndex((s) => s.id === 'relay');
  const target = RD_BY.relay.solve(R.slots[ri].S, R.E, R.book.relay.R, R.T);
  const live = (await dx(h.a)).bomb.relay;
  const flips = target.map((v, i) => (((live.p >> i) & 1) !== v ? i : -1)).filter((i) => i >= 0);
  await h.b.tap('.dx-drawer .dx-drawer-head').catch(() => {});
  if (!(await h.b.evaluate(() => document.querySelector('.dx-drawer').classList.contains('is-open')))) await h.b.tap('.dx-drawer .dx-drawer-head');
  for (const i of flips) { await h.b.tap(`.dx-relay-sw[data-i="${i}"]`); await sleep(120); }
  await until(async () => ((await dx(h.a)).bomb.relay.p & 15) === target.reduce((m, v, i) => m | (v << i), 0), 'the relay flips to reach the bomb', 4000);
  return ri;
}
async function commitRelay(h, R) {
  await setRelay(h, R);
  await h.b.tap('.dx-relay-commit');
}
/** A COMMIT sent while the bomb cannot take it (in a blackout, or in the background) is applied once the bomb is back, without another action on the manual. */
// ══════════════════════════ hush: the manual goes blank ══════════════════════════
async function hushRound(h) {
  console.log('\n# Defuse: hush blanks the manual, the bomb stays live');
  await goLive(h);
  await pickRoles(h, h.a, h.b);
  const seed = findSeed(RD, 'wild', (r) => r.twistRules.hush && !r.twists.includes('relay') && !r.twists.includes('decoy'), 'hs');
  const b = await startRound(h, h.a, h.b, seed, 'wild');
  const at = b.round.twistRules.hush.at;
  assert(await h.b.evaluate(() => /Hush\./.test(document.querySelector('[data-this-bomb]').textContent)), 'the manual lists Hush on the basics page');
  assert(await h.b.evaluate(() => !document.querySelector('.dx-manual-wrap').classList.contains('is-hush')), 'no cover before it starts');
  let quick = -1, best = 1e9;
  for (const [i, s] of b.round.slots.entries()) {
    if (s.decoy || RD_BY[s.id].needy || s.id === 'relay') continue;
    const acts = await h.a.evaluate((k) => window.__defuse.drive(k), i);
    if (!acts.some((a) => a.act === 'hold') && acts.length < best) { best = acts.length; quick = i; }
  }
  assert(quick >= 0, `a quick module to tap during hush (slot ${quick}, ${best} taps)`);
  await h.a.evaluate((ms) => window.__defuse.setLeft(ms), (at + 1) * 1000);
  await until(() => h.b.evaluate(() => document.querySelector('.dx-manual-wrap').classList.contains('is-hush')), 'the cover on the manual', 4000);
  assert(await visible(h.b, '.dx-hush') && /HUSH/.test(await h.b.textContent('.dx-hush')) && /Talk it through/.test(await h.b.textContent('.dx-hush')), 'hush: the printed panel is up ("HUSH · n s · Talk it through")');
  assert(await h.b.evaluate(() => { const v = (e) => getComputedStyle(e).visibility; return v(document.querySelector('.dx-sec:not([hidden])')) === 'hidden' && v(document.querySelector('.dx-mbar')) === 'visible' && v(document.querySelector('.dx-index')) === 'visible'; }), 'the pages are covered; the clock bar and tabs stay');
  assert(await h.b.evaluate(() => { const d = document.querySelector('.dx-bomb, .dx-side'); return !d && !document.querySelector('.dx-mods'); }), 'the manual DOM holds no bomb state during hush');
  const flagOn = await h.a.evaluate(() => [...document.querySelectorAll('[data-flag="hush"]')].some((f) => !f.hidden && /HUSH/.test(f.textContent)));
  assert(flagOn, 'the bomb shows a HUSH flag');
  // the bomb stays live: a real tap still counts
  await solveSlot(h, h.a, quick);
  assert((await dx(h.a)).bomb.solved[quick], 'bomb taps still work during hush');
  assert(await h.b.evaluate(() => document.querySelector('.dx-manual-wrap').classList.contains('is-hush')), 'and the cover is still up');
  await until(() => h.b.evaluate(() => !document.querySelector('.dx-manual-wrap').classList.contains('is-hush')), 'the cover to clear', 9000);
  assert(await h.b.evaluate(() => document.querySelector('.dx-hush').hidden && getComputedStyle(document.querySelector('.dx-sec:not([hidden])')).visibility === 'visible'), 'after about 8 s the guide is back');
  await sleep(1200);
  assert(!(await h.b.evaluate(() => document.querySelector('.dx-manual-wrap').classList.contains('is-hush'))) && (await dx(h.a)).bomb.hush === 0, 'and it fires only once');
  noErrors(h, 'hush');
}
async function relayWhilePaused(h) {
  console.log('\n# Defuse: a relay COMMIT sent during a blackout or while the bomb is in the background');
  await goLive(h);
  await pickRoles(h, h.a, h.b);
  const rel = async (ri) => { const x = (await dx(h.a)).bomb; return { solved: x.solved[ri], strikes: x.strikes, pz: x.pz, dark: x.dark, over: x.over }; };
  // A: Bomb Squad with a blackout; the switches are set, COMMIT is pressed in the dark
  let b = await startRound(h, h.a, h.b, 'rb3', 'wild');
  let R = b.round;
  assert(R.twists.includes('relay') && R.twists.includes('blackout'), `seed rb3 has a relay and a blackout (${R.twists.join('+')})`);
  let ri = await setRelay(h, R);
  await h.a.evaluate((ms) => window.__defuse.setLeft(ms), (R.twistRules.blackout.at[0] + 1) * 1000);
  await until(async () => (await dx(h.a)).bomb.dark === 2, 'the dark', 6000);
  await h.b.evaluate(() => document.querySelector('.dx-relay-commit').click());
  await sleep(700);
  let x = await rel(ri);
  assert(x.dark === 2 && !x.solved && x.strikes === 0, 'blackout: the bomb is still dark and the relay is not solved yet (it cannot take the COMMIT in the dark)');
  await until(async () => (await dx(h.a)).bomb.dark === 0, 'the light to come back', 8000);
  await until(async () => (await rel(ri)).solved, 'the relay to solve after the light returned, with no further action on the manual', 2500, 50);
  await sleep(1200);
  x = await rel(ri);
  assert(x.solved === 1 && x.strikes === 0 && !x.over, 'blackout: the COMMIT sent in the dark solved the relay once the light came back, no strike');
  await h.a.evaluate(() => window.__defuse.setLeft(900));
  await until(async () => (await dx(h.a)).bomb.over, 'the clock to run out', 6000);
  await endCards(h);
  await h.a.click('#game-root [data-g="rematch"]');
  await until(async () => (await dx(h.a)).phase === 'lobby' && (await dx(h.b)).phase === 'lobby', 'lobby');

  // B: the bomb goes to the background, the manual presses COMMIT, the bomb comes back
  b = await startRound(h, h.a, h.b, 'ea2', 'wild');
  R = b.round;
  ri = await setRelay(h, R);
  await hide(h.a, true);
  await until(async () => (await dx(h.a)).bomb.pz, 'the bomb to pause in the background', 3000);
  await h.b.evaluate(() => document.querySelector('.dx-relay-commit').click());
  await sleep(900);
  x = await rel(ri);
  assert(x.pz && !x.solved && x.strikes === 0, 'background: the paused bomb has not taken the COMMIT yet');
  await hide(h.a, false);
  const t0 = Date.now();
  await until(async () => (await rel(ri)).solved, 'the relay to solve soon after the bomb came back', 2500, 50);
  assert(Date.now() - t0 < 2000, `background: the relay solves ${Date.now() - t0} ms after the bomb is back, with no further action on the manual`);
  await sleep(1500);
  x = await rel(ri);
  assert(x.solved === 1 && x.strikes === 0 && !x.pz && !x.over, 'background: solved exactly once, no strike');
  noErrors(h, 'relay while paused');
}
async function tierSweep(h) {
  console.log('\n# Defuse: a full winning round on every tier (Rookie and Expert here; Agent, Classic and Bomb Squad above)');
  await goLive(h);
  await pickRoles(h, h.a, h.b);
  for (const tier of ['chill', 'spicy']) {
    const seed = findSeed(RD, tier, (r) => !r.twists.includes('blackout'), 'sw' + tier);
    const b = await startRound(h, h.a, h.b, seed, tier);
    assert(b.tier === tier && Math.abs(b.left - RD.TIERS[tier].secs * 1000) < 3000, `${RD.TIERS[tier].label}: ${RD.TIERS[tier].secs / 60} min clock, ${b.round.slots.length} slots (${b.round.slots.map((s) => s.id + (s.decoy ? '*' : '')).join(', ')}; twists ${b.round.twists.join('+') || 'none'})`);
    const plan = b.round.slots.map((s, i) => ({ s, i })).filter(({ s }) => !RD_BY[s.id].needy && s.id !== 'relay' && !s.decoy);
    for (const { i } of plan) { await solveSlot(h, h.a, i); if (process.env.DBG) console.log('   solved', b.round.slots[i].id, 'strikes', (await dx(h.a)).bomb.strikes); }
    if (b.round.slots.some((s) => s.id === 'relay')) await commitRelay(h, b.round);
    const won = await until(async () => { const x = await dx(h.a); return x.bomb.over ? x : null; }, 'the bomb to be safe', 8000);
    assert(won.bomb.win && won.bomb.res.score > 0 && /Defused/.test(won.bomb.res.text), `${RD.TIERS[tier].label}: defused with ${won.bomb.res.score} s left (${JSON.stringify(won.bomb.res)}, strikes ${won.bomb.strikes})`);
    await endCards(h);
    await h.a.click('#game-root [data-g="rematch"]');
    await until(async () => (await dx(h.a)).phase === 'lobby' && (await dx(h.b)).phase === 'lobby', 'lobby');
  }
  const g = gdata(h);
  assert(g.wins === 2 && g.best_chill > 0 && g.best_spicy > 0 && g.medal_chill >= 1 && g.medal_spicy >= 1, 'each tier keeps its own best and medal');
  noErrors(h, 'phones, Rookie and Expert');
}

// ══════════════════════════ blackout and golden module ══════════════════════════
async function phoneTwists(h) {
  console.log('\n# Defuse: blackout, golden module, the manual reloading');
  await goLive(h);
  await pickRoles(h, h.a, h.b);
  const seed = findSeed(RD, 'normal', (r) => r.twists.includes('blackout') && !r.twists.includes('relay') && !r.twists.includes('vent') && !r.twists.includes('decoy'), 'bo');
  let b = await startRound(h, h.a, h.b, seed, 'normal');
  const at = b.round.twistRules.blackout.at[0];
  const plan = b.round.slots.map((s, i) => ({ s, i })).filter(({ s }) => !s.decoy);
  await h.a.evaluate((ms) => window.__defuse.setLeft(ms), (at + 1) * 1000);
  await until(async () => (await dx(h.a)).bomb.dark === 1, 'the blackout warning', 4000);
  await until(() => visible(h.b, '.dx-mbar [data-flag="dark"]'), 'the dark flag on the manual', 3000);
  assert(/GOING DARK|BLACKOUT/.test(await h.a.textContent('.dx-topbar [data-flag="dark"]')), 'blackout: "going dark" shows on both devices first');
  await until(async () => (await dx(h.a)).bomb.dark === 2, 'the dark', 4000);
  assert(await h.a.evaluate(() => document.querySelector('.dx-mods').classList.contains('is-dark')), 'then the module area goes dark');
  await shot(h.a, 'phone-blackout-bomb-light');
  const first = plan[0];
  const acts = await h.a.evaluate((i) => window.__defuse.drive(i), first.i);
  await h.a.evaluate((i) => document.querySelector(`.dx-mod[data-slot="${i}"]`).scrollIntoView({ block: 'center' }), first.i);
  const box = await h.a.locator(`.dx-mod[data-slot="${first.i}"]`).boundingBox();
  for (let k = 0; k < 3; k++) await h.a.touchscreen.tap(box.x + 30 + k * 30, box.y + 60);
  await sleep(200);
  const mid = (await dx(h.a)).bomb;
  assert(mid.dark === 2 && !mid.solved.some(Boolean) && mid.strikes === 0 && acts.length > 0, 'inputs are ignored during the blackout');
  await until(async () => (await dx(h.a)).bomb.dark === 0, 'the light to come back', 7000);
  assert(await h.a.evaluate(() => !document.querySelector('.dx-mods').classList.contains('is-dark')), 'five seconds later the modules are back');
  for (const { i } of plan) await solveSlot(h, h.a, i);
  await until(async () => (await dx(h.a)).bomb.over, 'win', 8000);
  await endCards(h);
  await h.a.click('#game-root [data-g="rematch"]');
  await until(async () => (await dx(h.a)).phase === 'lobby' && (await dx(h.b)).phase === 'lobby', 'lobby');

  // golden module: marked on both devices; solved without a strike on it, +20 s
  const gs = findSeed(RD, 'normal', (r) => r.gold >= 0 && !r.twists.includes('blackout') && !r.twists.includes('relay') && !r.twists.includes('vent') && !r.twists.includes('decoy'), 'gd');
  b = await startRound(h, h.a, h.b, gs, 'normal');
  const gi = b.round.gold;
  assert(await h.a.evaluate((i) => document.querySelector(`.dx-mod[data-slot="${i}"]`).classList.contains('is-gold') && !!document.querySelector(`.dx-mod[data-slot="${i}"] .dx-goldtag`), gi), 'the golden module is marked on the bomb');
  const tabs = (await manualInfo(h.b)).tabs;
  assert(tabs.find((t) => t.id === b.round.slots[gi].id).gold && tabs.filter((t) => t.gold).length === 1 && (await manualInfo(h.b)).twists.includes('gold'), 'and on the manual: gold tab, and the basics page explains it');
  await shot(h.b, 'phone-gold-manual-light');
  const l0 = (await dx(h.a)).bomb.left;
  await solveSlot(h, h.a, gi);
  const l1 = (await dx(h.a)).bomb.left;
  assert(l1 - l0 > 15000, `a strike-free golden module gives +20 s (clock ${(l0 / 1000).toFixed(0)} -> ${(l1 / 1000).toFixed(0)})`);
  for (const { i } of b.round.slots.map((s, i) => ({ s, i })).filter(({ s }) => !s.decoy && !(s.id === b.round.slots[gi].id))) await solveSlot(h, h.a, i);
  const zero = await until(async () => { const x = await dx(h.a); return x.bomb.over ? x : null; }, 'win', 8000);
  assert(zero.bomb.win && zero.bomb.strikes === 0 && zero.bomb.fx && zero.bomb.fx.ln.length > 10, 'a zero-strike win comes with a sweet line: ' + zero.bomb.fx.ln);
  await until(() => visible(h.b, '.dx-stamp small'), 'the line on the manual too', 4000);
  assert((await h.a.textContent('.dx-stamp small')) === zero.bomb.fx.ln && (await h.b.textContent('.dx-stamp small')) === zero.bomb.fx.ln, 'both devices stamp the same line');
  await shot(h.a, 'phone-defused-line-light');
  await endCards(h);
  await h.a.click('#game-root [data-g="rematch"]');
  await until(async () => (await dx(h.a)).phase === 'lobby' && (await dx(h.b)).phase === 'lobby', 'lobby');
  await until(() => visible(h.a, '.dx-nudge'), 'the swap nudge', 4000);
  const nd = await until(() => h.a.evaluate(() => { const sw = document.querySelector('[data-act="swap"]'); const n = document.querySelector('.dx-nudge'); return !n.hidden && sw.classList.contains('is-nudged') && !sw.disabled ? n.textContent : null; }), 'the nudge and an enabled swap button', 4000);
  assert(/Emerson has held the bomb three rounds running\. Swap\?/.test(nd), 'after three rounds with the same bomb holder the lobby nudges: Swap? (a nudge only, nothing forced)');

  // the manual reloads mid-round and rejoins; the clock waits for it
  const b3 = await startRound(h, h.a, h.b, 'reloadseed', 'chill');
  const n = b3.n;
  await h.b.tap(`.dx-index [data-page="${b3.round.ids[1]}"]`);
  await h.b.reload(); await h.b.waitForSelector('.tabbar');
  await h.settle(); await h.settle();
  await until(async () => (await dx(h.a)).bomb.pz, 'the bomb to wait for its manual', 6000);
  await comeBack(h, h.b, h.a);
  const back = await until(async () => { const x = await dx(h.b); return x && x.phase === 'manual' && x.manual.n === n ? x : null; }, 'the reloaded manual to rejoin the round', 8000);
  assert(back.role === 'manual', 'the reloaded manual remembers its role and rejoins the same round');
  assert(await h.b.evaluate((id) => document.querySelector(`.dx-index [data-page="${id}"]`).getAttribute('aria-selected') === 'true', b3.round.ids[1]), 'and the page it was reading');
  await until(async () => !(await dx(h.a)).bomb.pz, 'the clock to run again', 4000);
  assert(true, 'the bomb resumed its clock when the manual came back');
  noErrors(h, 'phones, twists');
}

// ══════════════════════════ laptop bomb + phone manual ══════════════════════════
async function laptopRound(h, scheme) {
  console.log(`\n# Defuse: laptop bomb, phone manual (${scheme})`);
  await asLaptopPhone(h);
  await goLive(h);
  await pickRoles(h, h.a, h.b);
  await shot(h.b, `laptop-${scheme}-lobby-phone`);
  await shot(h.a, `laptop-${scheme}-lobby`);
  const seed = findSeed(RD, 'wild', (r) => !r.twists.includes('blackout') && !r.twists.includes('relay') && r.twists.includes('void') && r.slots.filter((s) => !RD_BY[s.id].needy).length === 6, 'lp');
  const b = await startRound(h, h.a, h.b, seed, 'wild', { bombStarts: false });
  const cols = await h.a.evaluate(() => getComputedStyle(document.querySelector('.dx-mods')).gridTemplateColumns.split(' ').length);
  assert(cols === 3, 'laptop: six modules in three columns');
  assert(await h.a.evaluate(() => !!document.querySelector('.dx-sticker.is-void .dx-void-stamp') && !!document.querySelector('.dx-ind.is-void')), 'the VOID sticker and the crossed-out lamp are on the bomb');
  assert(await visible(h.a, '.dx-side .dx-lcd') && !(await visible(h.a, '.dx-topbar')), 'laptop: the big clock stays in the side panel');
  assert(await noSideScroll(h.a) && await noSideScroll(h.b), 'no side scroll on either device');
  const done = b.round.slots.map((s, i) => ({ s, i })).filter(({ s }) => !RD_BY[s.id].needy && !s.decoy);
  for (const { i } of done.slice(0, 2)) await solveSlot(h, h.a, i, { touch: false });
  await h.b.tap(`.dx-index [data-page="${b.round.ids[2]}"]`);
  await sleep(500);
  await shot(h.a, `laptop-${scheme}-bomb`, { fullPage: true });
  await shot(h.b, `laptop-${scheme}-manual`);
  const M = await manualInfo(h.b);
  assert(M.twists.includes('void') && M.lamps.filter(Boolean).length === 2, 'the manual shows the VOID rule and two lamps lit');
  // keyboard: Tab to a control and press Enter
  await h.a.evaluate((i) => document.querySelector(`.dx-mod[data-slot="${i}"] button, .dx-mod[data-slot="${i}"] [role="button"]`).focus(), done[2].i);
  assert(await h.a.evaluate(() => !!document.activeElement.closest('.dx-mod')), 'modules are reachable by keyboard');
  // the clock runs out
  await h.a.evaluate(() => window.__defuse.setLeft(1200));
  await until(async () => (await dx(h.a)).bomb.over, 'the clock to run out', 6000);
  await sleep(700);
  await shot(h.a, `laptop-${scheme}-boom-bomb`);
  await shot(h.b, `laptop-${scheme}-boom-manual`);
  await endCards(h);
  await sleep(400);
  await shot(h.a, `laptop-${scheme}-end`);
  await shot(h.b, `laptop-${scheme}-end-manual`);
  await until(() => results(h).length >= 1, 'the boom recorded', 4000);
  assert(results(h).length === 1 && results(h)[0].winner === 'team' && gdata(h).booms === 1, `${scheme}: boom on the clock, recorded once`);
  await closeBoth(h);
  noErrors(h, 'laptop ' + scheme);
}

// ══════════════════════════ layout: screens, tap targets and text sizes at four viewports ══════════════════════════
const SIZES = [[390, 844], [360, 740], [844, 390], [1280, 800]];
/** Text smaller than 11 px, by element, excluding invisible text. Returns [{ sel, fs, text }]. */
const smallText = (pg) => pg.evaluate(() => {
  const out = [];
  const root = document.getElementById('game-root');
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let n;
  while ((n = w.nextNode())) {
    if (!n.textContent.trim()) continue;
    const p = n.parentElement;
    const cs = getComputedStyle(p);
    const r = p.getBoundingClientRect();
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || p.closest('[hidden]') || cs.fontSize === '0px') continue;
    const fs = parseFloat(cs.fontSize);
    if (fs >= 10.95) continue;
    const sel = (p.closest('[class]') ? p.closest('[class]').getAttribute('class') : p.tagName) + (p.tagName === 'text' ? ' <text>' : '');
    if (seen.has(sel)) continue;
    seen.add(sel);
    out.push({ sel, fs: +fs.toFixed(2), text: n.textContent.trim().slice(0, 20) });
  }
  return out;
});
const tapSizes = (pg, sel) => pg.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; }), sel);
const rootTop = (pg) => pg.evaluate(() => document.getElementById('game-root').scrollTop + window.scrollY);

async function layoutRound(h, [w, hh]) {
  const tag = `${w}x${hh}`;
  for (const pg of [h.a, h.b]) await pg.setViewportSize({ width: w, height: hh });
  await sleep(150);
  // the lobby: Start can be reached without hunting for it, and a tap on it must not leave the next screen scrolled
  if (w <= 760 && hh >= 800) {
    const st = await h.b.evaluate(() => { const b = document.querySelector('[data-act="start"]'); const r = b.getBoundingClientRect(); return { bottom: r.bottom, h: r.height, vh: innerHeight, sticky: getComputedStyle(b.closest('.dx-lobby-actions')).position }; });
    assert(st.bottom <= st.vh && st.h >= 44, `${tag}: the lobby's Start button is on screen without scrolling (bottom ${Math.round(st.bottom)} of ${st.vh}, ${Math.round(st.h)} px tall)`);
  }
  // scroll the lobby down first (a tap on a Start button below the fold does this), then start: the round must open at the top
  for (const pg of [h.a, h.b]) await pg.evaluate(() => { const r = document.getElementById('game-root'); r.scrollTop = 400; window.scrollTo(0, 400); });
  const seed = 'ly62';
  const b = await startRound(h, h.a, h.b, seed, 'wild');
  await sleep(250);
  assert(b.round.slots.map((s) => s.id).join() === 'morse,wires,relay,password,maze,switches,vent', `${tag}: the layout seed builds the expected wild round`);

  // V3: both screens open at the top, and the first heading is not hidden under the sticky bars
  assert(await rootTop(h.a) === 0 && await rootTop(h.b) === 0, `${tag}: bomb and manual both open scrolled to the top`);
  const head = await h.b.evaluate(() => { const bar = document.querySelector('.dx-mbar').getBoundingClientRect(); const idx = document.querySelector('.dx-index').getBoundingClientRect(); const hd = document.querySelector('.dx-sec:not([hidden]) .dx-run').getBoundingClientRect(); return { bar: bar.bottom, idx: idx.bottom, run: hd.top, flow: getComputedStyle(document.querySelector('.dx-index')).position }; });
  assert(head.run >= head.bar - 1 && (head.flow !== 'sticky' || head.run >= head.idx - 1 || w >= 760), `${tag}: the page heading starts below the sticky bars (bars end ${Math.round(Math.max(head.bar, head.idx))}, heading at ${Math.round(head.run)})`);

  // V1: the clock, strikes and flags never scroll out of sight
  await h.a.evaluate(() => { const r = document.getElementById('game-root'); r.scrollTop = r.scrollHeight; window.scrollTo(0, document.body.scrollHeight); });
  await sleep(150);
  const clk = await h.a.evaluate(() => {
    const vh = innerHeight;
    const inView = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.top >= -1 && r.bottom <= vh + 1; };
    const side = document.querySelector('.dx-side');
    const lcd = [...document.querySelectorAll('.dx-time')].find((e) => e.getClientRects().length);
    const strikes = [...document.querySelectorAll('.dx-strikes')].find((e) => e.getClientRects().length);
    const sideBox = side.getBoundingClientRect();
    const vent = document.querySelector('.dx-side [data-flag="vent"]');
    let flagIn = null;
    if (getComputedStyle(side).position === 'sticky') { vent.hidden = false; flagIn = inView(vent) || inView(document.querySelector('.dx-side .dx-flags')); vent.hidden = true; }
    else { const tv = document.querySelector('.dx-topbar [data-flag="vent"]'); tv.hidden = false; flagIn = inView(tv); tv.hidden = true; }
    return { clock: inView(lcd), strikes: inView(strikes), sideH: Math.round(sideBox.height), sticky: getComputedStyle(side).position === 'sticky', vh, flagIn };
  });
  assert(clk.clock && clk.strikes && clk.flagIn, `${tag}: scrolled to the bottom, the clock, strikes and the VENT flag are still on screen (${clk.sticky ? 'sticky side panel ' + clk.sideH + ' px' : 'sticky top bar'})`);
  if (clk.sticky) assert(clk.sideH <= clk.vh - 8, `${tag}: the side panel fits the window (${clk.sideH} of ${clk.vh} px)`);
  await h.a.evaluate(() => { const r = document.getElementById('game-root'); r.scrollTop = 0; window.scrollTo(0, 0); });

  // V4: the password module's controls on the bomb and its word list on the manual
  const pw = (await dx(h.a)).bomb.round.slots.findIndex((x) => x.id === 'password');
  await h.a.evaluate((i) => document.querySelector(`.dx-mod[data-slot="${i}"]`).scrollIntoView({ block: 'center' }), pw);
  const wi = (await dx(h.a)).bomb.round.slots.findIndex((x) => x.id === 'wires');
  await h.a.evaluate((i) => document.querySelector(`.dx-mod[data-slot="${i}"]`).scrollIntoView({ block: 'center' }), wi);
  const hb = await h.a.evaluate((i) => [...document.querySelectorAll(`.dx-mod[data-slot="${i}"] .dx-wire .hb`)].map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 }; }), wi);
  console.log(`   ${tag}: wire hit rects ${JSON.stringify(hb)}`);
  assert(hb.length >= 3 && hb.every((x) => x.h >= 44 && x.w >= 44), `${tag}: every wire's hit area is at least 44 px (smallest ${Math.min(...hb.map((x) => x.h))} px tall, ${Math.min(...hb.map((x) => x.w))} wide)`);
  const bt = await tapSizes(h.a, `.dx-mod[data-slot="${pw}"] .dx-pw-btn, .dx-mod[data-slot="${pw}"] .dx-pw-submit`);
  assert(bt.length === 11 && bt.every((x) => x.w >= 44 && x.h >= 44), `${tag}: the password roller buttons on the bomb are at least 44 px both ways (smallest ${Math.min(...bt.map((x) => x.w))} x ${Math.min(...bt.map((x) => x.h))})`);
  await h.b.evaluate(() => document.querySelector('.dx-index [data-page="password"]').click());
  await sleep(150);
  const wr = await tapSizes(h.b, '.dx-sec:not([hidden]) .dx-pw-w, .dx-sec:not([hidden]) .dx-pw-w input');
  assert(wr.length >= 40 && wr.every((x) => x.h >= 44 && x.w >= 44), `${tag}: the manual's word rows (and their checkboxes) are at least 44 px (smallest ${Math.min(...wr.map((x) => x.h))} px tall)`);
  const tabs = await tapSizes(h.b, '.dx-index [data-page]');
  assert(tabs.every((x) => x.h >= 44 && x.w >= 44), `${tag}: manual tabs are at least 44 px`);
  assert(await noSideScroll(h.a) && await noSideScroll(h.b), `${tag}: no side scroll on either device`);

  // V5: no text under 11 px (computed) in the bomb or any manual page
  const small = [];
  small.push(...(await smallText(h.a)).map((x) => ({ ...x, dev: 'bomb' })));
  for (const id of (await manualInfo(h.b)).tabs.map((t) => t.id)) {
    await h.b.evaluate((p) => document.querySelector(`.dx-index [data-page="${p}"]`).click(), id);
    await sleep(60);
    small.push(...(await smallText(h.b)).map((x) => ({ ...x, dev: 'manual ' + id })));
  }
  if (small.length) console.log('   small text:', JSON.stringify(small));
  assert(small.length === 0, `${tag}: no text under 11 px on the bomb or on any manual page`);

  // the edition code in the manual never wraps onto two lines, on any page
  for (const id of (await manualInfo(h.b)).tabs.map((t) => t.id)) {
    await h.b.evaluate((p) => document.querySelector(`.dx-index [data-page="${p}"]`).click(), id);
    await sleep(40);
    const ed = await h.b.evaluate(() => [...document.querySelectorAll('.dx-sec:not([hidden]) .dx-ed')].map((e) => ({ lines: e.getClientRects().length, text: e.textContent })));
    if (!ed.length || ed.some((e) => e.lines !== 1)) throw new Error(`FAIL: ${tag}: the edition code is on one line on page ${id} ${JSON.stringify(ed)}`);
  }
  assert(true, `${tag}: the edition code sits on one line on every manual page`);

  // V2: the relay box on the manual starts closed on a small screen and never buries the tabs or the COMMIT key
  const dr = await h.b.evaluate(() => { const d = document.querySelector('.dx-drawer'); return { open: d.classList.contains('is-open'), vh: innerHeight, vw: innerWidth }; });
  assert(dr.open === (dr.vw >= 760 && dr.vh >= 700), `${tag}: the relay drawer starts ${dr.open ? 'open' : 'closed'} (open only on a window at least 760 x 700)`);
  const op = await h.b.evaluate(() => {
    const d = document.querySelector('.dx-drawer');
    d.classList.add('is-open'); // opened by hand here, so the remembered choice (a tap) does not leak into the next size
    const body = d.querySelector('.dx-drawer-body');
    const vh = innerHeight;
    // scrolled to the end (the tab strip is stuck below the clock), the tabs below the clock are not under the open drawer
    const gr = document.getElementById('game-root');
    gr.scrollTop = gr.scrollHeight; window.scrollTo(0, document.body.scrollHeight);
    const barBottom = document.querySelector('.dx-mbar').getBoundingClientRect().bottom;
    const shown = [...document.querySelectorAll('.dx-index [data-page]')].map((t) => t.getBoundingClientRect()).filter((r) => r.left >= 0 && r.right <= innerWidth && r.top >= barBottom - 1 && r.bottom <= vh).slice(0, 2);
    const on = (r, y) => { const e = document.elementFromPoint(r.left + r.width / 2, y); return !!(e && e.closest('.dx-index')); };
    const hit = shown.length >= 1 && shown.every((r) => on(r, r.top + 4) && on(r, r.bottom - 4));
    const commit = d.querySelector('.dx-relay-commit');
    commit.scrollIntoView({ block: 'nearest' });
    const cr = commit.getBoundingClientRect(), dbr = body.getBoundingClientRect();
    return { bodyH: Math.round(dbr.height), vh, hit, commitIn: cr.top >= dbr.top - 1 && cr.bottom <= dbr.bottom + 1 && cr.bottom <= vh + 1, commitH: cr.height };
  });
  assert(op.bodyH <= op.vh * 0.45 + 1, `${tag}: the open relay drawer is at most 45 % of the window (${op.bodyH} of ${op.vh} px)`);
  if (op.vh <= 500) assert(op.bodyH <= op.vh * 0.3 + 1, `${tag}: on a short window the open relay drawer is at most 30 % of it (${op.bodyH} of ${op.vh} px)`);
  assert(op.hit, `${tag}: with the drawer open the manual's tabs on screen can still be tapped`);
  assert(op.commitIn && op.commitH >= 44, `${tag}: COMMIT can be scrolled fully into view inside the drawer`);
  await h.b.evaluate((open) => document.querySelector('.dx-drawer').classList.toggle('is-open', open), dr.open);
  await shot(h.a, `layout-${tag}-bomb`);
  await shot(h.b, `layout-${tag}-manual`);
  // end this round (boom) and go back to the lobby for the next size
  await h.a.evaluate(() => window.__defuse.setLeft(900));
  await until(async () => (await dx(h.a)).bomb.over, 'the clock to run out', 6000);
  await endCards(h);
  // scroll the end screens down, then Rematch: the lobby must open at the top
  for (const pg of [h.a, h.b]) await pg.evaluate(() => { const r = document.getElementById('game-root'); r.scrollTop = r.scrollHeight; window.scrollTo(0, document.body.scrollHeight); });
  await sleep(100);
  const endScrolled = (await rootTop(h.a)) + (await rootTop(h.b));
  await h.a.click('#game-root [data-g="rematch"]');
  await until(async () => (await dx(h.a)).phase === 'lobby' && (await dx(h.b)).phase === 'lobby', 'lobby again');
  await sleep(200);
  assert(await rootTop(h.a) === 0 && await rootTop(h.b) === 0, `${tag}: after a round and Rematch both lobbies open scrolled to the top (the end screens were scrolled ${endScrolled} px in all)`);
}
async function layoutGroup(h) {
  console.log('\n# Defuse layout: 390x844, 360x740, 844x390, 1280x800 (scroll, sticky clock, tap targets, text size, relay drawer)');
  await goLive(h);
  await pickRoles(h, h.a, h.b);
  for (const sz of SIZES) await layoutRound(h, sz);
  noErrors(h, 'layout');
}

// ══════════════════════════ older saved data, one device ══════════════════════════
async function phonePar(h) {
  console.log('\n# Personal par and the par clock');
  await goLive(h);
  await pickRoles(h, h.a, h.b);
  const lob = () => h.a.evaluate(() => ({ par: (document.querySelector('.dx-par') || {}).textContent, hidden: document.querySelector('.dx-par').hidden, sw: document.querySelector('[data-act="parclock"]').getAttribute('aria-checked'), dis: document.querySelector('[data-act="parclock"]').disabled, sug: document.querySelector('.dx-suggest').hidden ? '' : document.querySelector('.dx-suggest').textContent }));
  await h.b.click('.dx-tiers [data-diff="normal"]'); await h.settle();
  let l = await lob();
  assert(!l.hidden && l.par === 'Par 2:40' && !l.dis, `the lobby shows "${l.par}" under Agent and enables the Par clock switch`);
  assert(/Three Agent wins in a row\. Try Expert\?/.test(l.sug), `the lobby nudges: "${l.sug}"`);
  await h.b.click('.dx-tiers [data-diff="spicy"]'); await h.settle();
  l = await lob();
  assert(l.hidden && l.dis && l.sw === 'false' && !l.sug, 'a tier with no par hides it and disables the switch');
  await h.b.click('.dx-tiers [data-diff="normal"]'); await h.settle();
  await h.b.click('[data-act="parclock"]'); await h.settle();
  assert(await h.a.evaluate(() => document.querySelector('[data-act="parclock"]').getAttribute('aria-checked')) === 'true', 'the Par clock switch reaches the other phone');
  const b = await startRound(h, h.a, h.b, 'parseed', null);
  assert(b.parClock && b.start === 180 && Math.abs(b.left - 180000) < 3000, `the bomb starts on the par clock: ${Math.round(b.left)} ms (par 160 + 20)`);
  const mt = await h.b.evaluate(() => document.querySelector('.dx-time').textContent);
  const [mm, ss] = mt.split(':').map(Number);
  assert(Math.abs(mm * 60 + ss - 180) <= 4, `the manual's clock follows the bomb (${mt})`);
  await h.a.evaluate(() => window.__defuse.setLeft(70000));
  const plan = scored(b.round);
  for (const { i } of plan) await solveSlot(h, h.a, i);
  const won = await until(async () => { const x = await dx(h.a); return x.bomb.over ? x : null; }, 'the par-clock round to end', 40000);
  const gap = +((/Under par by (\d+) s\./.exec(won.bomb.res.sub) || [])[1]);
  assert(won.bomb.win && gap >= 30 && gap <= 50, `the end card says how it went against par: ${won.bomb.res.sub}`);
  await endCards(h);
  const g = gdata(h);
  assert(g.parN_normal === 4 && g.parSum_normal === 480 + (160 - gap), `the par-clock win counts toward par (parN ${g.parN_normal}, parSum ${g.parSum_normal})`);
  noErrors(h, 'phones, par');
}
async function legacy(h) {
  console.log('\n# Defuse: older and odd saved data, one device');
  await goLive(h);
  const rec = await h.a.textContent('.dx-rec');
  assert(/Streak\s*2/.test(rec) && /Best on Agent:\s*1:40/.test(rec) && /Defused\s*7/.test(rec), 'a bare-number best in older nested data still shows: ' + rec.replace(/\s+/g, ' ').trim());
  await h.a.evaluate(() => { const b = document.createElement('button'); b.dataset.g = 'live'; b.dataset.game = 'defuse'; b.dataset.mode = 'local'; });
  await closeBoth(h);
  await h.a.evaluate(() => { const b = document.createElement('button'); b.dataset.g = 'live'; b.dataset.game = 'defuse'; b.dataset.mode = 'local'; document.body.appendChild(b); b.click(); b.remove(); });
  await h.a.waitForSelector('.g-defuse .dx-solo');
  assert(/Defuse needs two devices: one for the bomb, one for the manual\./.test(await h.a.textContent('.dx-solo')), 'one device: the "needs two devices" card');
  await shot(h.a, 'phone-solo-light');
  await h.a.click('.dx-solo [data-g="close"]');
  await h.settle();
  noErrors(h, 'legacy data');
}

// ══════════════════════════ Chain ×2: two bombs back to back ══════════════════════════
const CHAIN_SHOTS = process.env.SHOTS_CHAIN || path.join(SHOTS, 'chain');
const cshot = async (pg, name, opts) => { fs.mkdirSync(CHAIN_SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(CHAIN_SHOTS, name + '.png'), ...opts }); console.log('   shot', name); };
const fmtS = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
let RC_CHAIN = null;
const chainState = (pg) => pg.evaluate(() => {
  const i = window.__defuse && window.__defuse.info();
  return i && { phase: i.phase, chain: i.chain, b: i.bomb && { n: i.bomb.n, chain: i.bomb.chain, inter: i.bomb.inter, over: i.bomb.over, seed: i.bomb.seed, start: i.bomb.start, left: i.bomb.left, strikes: i.bomb.strikes, solved: i.bomb.solved, carry: i.bomb.carry, ch1: i.bomb.ch1, prevStrikes: i.bomb.prevStrikes, round: { name: i.bomb.round.name, edition: i.bomb.round.edition, slots: i.bomb.round.slots, ids: i.bomb.round.ids, twists: i.bomb.round.twists, E: i.bomb.round.E } }, m: i.manual && { n: i.manual.n, chain: i.manual.chain, inter: i.manual.inter, over: i.manual.over } };
});
const chipText = (pg, sel = '.dx-chain') => pg.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()), sel);
const bombPresence = (h) => { for (const m of Object.values(h.roomState)) for (const p of m.values()) { const x = p.presence && p.presence.s; if (x && x.v === 2 && x.role === 'bomb') return x; } return {}; };
/** A seed for a chain: bomb 1 = seed, bomb 2 = seed|next, both easy to drive with taps (no blackout, relay or vent); bomb 2 optionally has a decoy twin. */
function chainSeeds(tier, bomb2Decoy, prefix) {
  const easy = (r) => !r.twists.includes('blackout') && !r.twists.includes('relay') && !r.twists.includes('vent') && !r.slots.some((s) => RD_BY[s.id].needy || s.id === 'relay');
  for (let i = 0; i < 20000; i++) {
    const seed = prefix + i;
    const r1 = RD.buildRound(seed, tier);
    if (!easy(r1)) continue;
    const r2 = RD.buildRound(RC_CHAIN.chainSeed(seed), tier);
    if (easy(r2) && (!bomb2Decoy || r2.twists.includes('decoy')) && r1.name !== r2.name) return seed;
  }
  throw new Error('no chain seeds');
}
/** Solve every real module of the bomb on `pg` except the last, then do the last one's taps without waiting (the caller catches the interlude). */
async function winBomb1Quick(h, pg, opts) {
  const plan = scored((await dx(pg)).bomb.round);
  for (const { i } of plan.slice(0, -1)) await solveSlot(h, pg, i, opts);
  await exec(pg, await pg.evaluate((k) => window.__defuse.drive(k), plan[plan.length - 1].i), opts);
}
const waitInterlude = (pg) => until(async () => { const x = await chainState(pg); return x && x.b && x.b.inter ? x : null; }, 'the NEXT BOMB interlude', 6000, 15);
const waitBomb2 = (pg, ms = 6000) => until(async () => { const x = await chainState(pg); return x && x.b && x.b.chain === 2 && !x.b.inter ? x : null; }, 'bomb 2', ms, 30);

async function phoneChain(h) {
  console.log('\n# Chain ×2 on two phones');
  await goLive(h);
  const seedA = chainSeeds('normal', false, 'chA');
  const seedB = chainSeeds('normal', true, 'chB');
  const date = new Date().toISOString().slice(0, 10);
  await pickRoles(h, h.a, h.b);
  const sw = (pg) => pg.evaluate(() => { const e = document.querySelector('[data-act="chain"]'); const r = e.getBoundingClientRect(); return { on: e.getAttribute('aria-checked'), dis: e.disabled, h: r.height, txt: e.textContent.trim() }; });
  const s0 = await sw(h.a);
  assert(!s0.dis && s0.on === 'false' && s0.h >= 44 && /Chain ×2/.test(s0.txt), 'lobby: a "Chain ×2" switch, off by default, at least 44 px tall');
  await h.b.tap('.dx-tiers [data-diff="normal"]'); await h.settle();
  await h.b.tap('[data-act="chain"]'); await h.settle();
  assert((await sw(h.b)).on === 'true' && (await sw(h.a)).on === 'true', 'the Chain switch (tapped on one phone) reaches the other phone');
  await h.a.tap('.dx-tiers [data-diff="classic"]'); await h.settle();
  assert((await sw(h.a)).dis && (await sw(h.a)).on === 'false' && (await sw(h.b)).dis && (await sw(h.b)).on === 'false', 'Classic: the switch is disabled and shown off on both phones');
  await cshot(h.b, 'chain-lobby-classic-light');
  await h.b.tap('[data-act="chain"]', { force: true, timeout: 1500 }).catch(() => {});
  await h.settle();
  assert((await sw(h.a)).on === 'false' && (await dx(h.a)).chain === false, 'tapping the disabled switch does nothing');
  await h.a.tap('.dx-tiers [data-diff="normal"]'); await h.settle();
  assert((await sw(h.a)).on === 'false' && !(await sw(h.a)).dis, 'back on Agent the switch is enabled again, and still off');
  await h.a.tap('[data-act="chain"]'); await h.settle();
  assert((await sw(h.b)).on === 'true' && (await dx(h.b)).chain === true, 'Chain on again (tapped on the bomb phone this time) and the manual phone follows');
  await cshot(h.b, 'chain-lobby-on-light');

  // ── run 1: a clean chain ──
  const r1 = RD.buildRound(seedA, 'normal'), r2 = RD.buildRound(RC_CHAIN.chainSeed(seedA), 'normal');
  const g0 = { ...gdata(h) };
  const b1 = await startRound(h, h.a, h.b, seedA, 'normal', { bombStarts: true });
  assert(b1.seed === seedA && b1.chain === 1 && b1.round.name === r1.name && Math.abs(b1.left - 300000) < 3000, `chain: bomb 1 is Agent on 5:00 (${r1.name})`);
  assert((await chipText(h.a)).join() === 'Bomb 1 of 2' && (await chipText(h.b)).join() === 'Bomb 1 of 2', 'both phones say "Bomb 1 of 2"');
  assert((await dx(h.b)).manual.chain === 1 && (await manualInfo(h.b)).edition === r1.edition, 'the manual holds bomb 1’s guide');
  await cshot(h.a, 'chain-phone-bomb1-light'); await cshot(h.b, 'chain-phone-manual1-light');
  await h.a.evaluate(() => window.__defuse.setLeft(120000));
  await winBomb1Quick(h, h.a);
  const mid = await waitInterlude(h.a);
  const stamp = await h.a.evaluate(() => (document.querySelector('.dx-fx .dx-stamp') || {}).textContent || ''); // read before the screenshots: they take a while and the interlude is short
  const mstamp = await until(() => visible(h.b, '.dx-fx .dx-stamp'), 'the stamp on the manual', 1500, 20) && await h.b.textContent('.dx-fx');
  const pres = bombPresence(h);
  await Promise.all([cshot(h.a, 'chain-phone-interlude-bomb-light'), cshot(h.b, 'chain-phone-interlude-manual-light')]);
  assert(mid.b.chain === 1 && !mid.b.over && !pres.res && pres.ph === 'play' && !pres.win && pres.cs === 1, 'chain (' + JSON.stringify({ ph: pres.ph, res: pres.res, win: pres.win, cs: pres.cs, ci: pres.ci, n: pres.n }) + '): after bomb 1 the round is not over: the presence still says "play", with no result and no win');
  assert(/NEXT BOMB/.test(stamp) && /Bomb 1 of 2/i.test(stamp), `chain: the NEXT BOMB stamp shows on the bomb ("${stamp.trim()}")`);
  const carry = Math.ceil(mid.b.left / 1000);
  assert(carry > 60 && carry <= 120, `bomb 1 had ${carry} s left`);
  assert(/NEXT BOMB/.test(mstamp), 'the manual phone shows the NEXT BOMB stamp too');
  assert(results(h).length === 0 && (await dx(h.b)).manual && !(await dx(h.b)).manual.over, 'nothing is recorded or finished during the interlude');
  const s2 = await waitBomb2(h.a);
  const want = Math.min(RD.TIERS.normal.secs, carry + RD.TIERS.normal.secs / 2);
  assert(s2.b.seed === RC_CHAIN.chainSeed(seedA) && s2.b.chain === 2 && s2.b.round.name === r2.name && s2.b.strikes === 0 && !s2.b.solved.some(Boolean), `chain: bomb 2 is a new round (${r2.name}) from seed + "|next", strikes back to 0`);
  assert(s2.b.start === want && s2.b.carry === carry && Math.abs(s2.b.left / 1000 - want) <= 1.5, `chain: bomb 2’s clock is the carried ${want} s (${carry} left + 150), reads ${(s2.b.left / 1000).toFixed(1)}`);
  assert((await chipText(h.a)).join() === 'Bomb 2 of 2', 'the bomb phone says "Bomb 2 of 2"');
  await until(async () => { const x = await chainState(h.b); return x && x.m && x.m.n === s2.b.n; }, 'the manual to follow to bomb 2', 4000);
  assert((await dx(h.b)).manual.chain === 2 && (await manualInfo(h.b)).edition === r2.edition && (await h.b.textContent('.dx-page')).includes(r2.name) && (await chipText(h.b)).join() === 'Bomb 2 of 2', `the manual followed on its own: bomb 2’s edition (${r2.name}) and "Bomb 2 of 2"`);
  const mt = secsOf(await h.b.textContent('.dx-mbar .dx-time'));
  assert(Math.abs(mt - want) <= 4, `the manual’s clock shows the carried clock (${mt} s)`);
  assert(results(h).length === 0 && gdata(h).wins === g0.wins, 'still nothing recorded');
  await cshot(h.a, 'chain-phone-bomb2-light'); await cshot(h.b, 'chain-phone-manual2-light');
  await h.a.evaluate(() => window.__defuse.setLeft(200000));
  for (const { i } of scored(s2.b.round)) await solveSlot(h, h.a, i);
  const won = await until(async () => { const x = await dx(h.a); return x.bomb.over ? x : null; }, 'bomb 2 to be defused', 10000);
  assert(won.bomb.win && won.bomb.res.team && /Defused with/.test(won.bomb.res.text) && /Chain/.test(won.bomb.res.text) && won.bomb.res.score >= 150 && won.bomb.res.score <= 200, `chain: bomb 2 defused: "${won.bomb.res.text}"`);
  assert(won.bomb.res.sub.includes(`Chain: ${r1.name} → ${r2.name}`), 'the result names both editions: ' + won.bomb.res.sub);
  await endCards(h);
  await until(() => results(h).length >= 1, 'the chain recorded', 4000);
  await sleep(2200); await h.settle();
  const g = gdata(h);
  assert(results(h).length === 1 && results(h)[0].winner === 'team' && results(h)[0].score === won.bomb.res.score, 'exactly one result recorded for the whole chain, with the seconds left after bomb 2');
  assert(g.wins === (g0.wins | 0) + 1 && g.chainWins === 1 && g.chainRuns === 1 && g.chain_normal === won.bomb.res.score && !('best_normal' in g) && !('parN_normal' in g) && g.medal_normal === 3, `records: one win, chainWins 1, chainRuns 1, chain_normal ${g.chain_normal}; no single-bomb best or par; gold medal`);
  assert(JSON.parse(g.log).length === 1 && JSON.parse(g.log)[0].name === `${r1.name} → ${r2.name}`, 'the round log names both editions');
  await cshot(h.a, 'chain-phone-defused-bomb-light'); await cshot(h.b, 'chain-phone-defused-manual-light');

  // rematch: the switch is remembered, the strip shows the best chain
  await h.a.click('#game-root [data-g="rematch"]');
  await until(async () => { const x = await dx(h.a); const y = await dx(h.b); return x && y && x.phase === 'lobby' && y.phase === 'lobby'; }, 'the rematch lobby');
  const rec = (await h.a.textContent('.dx-rec')).replace(/\s+/g, ' ');
  assert(rec.includes(`Best chain on Agent: ${fmtS(g.chain_normal)}`) && !/Best on Agent/.test(rec), `the lobby strip says "Best chain on Agent: ${fmtS(g.chain_normal)}" (${rec.slice(0, 90)})`);
  assert((await sw(h.a)).on === 'true' && (await sw(h.b)).on === 'true', 'Chain is remembered for the next round');
  await cshot(h.a, 'chain-phone-lobby-records-light');

  // ── run 2: bomb 2 goes off by strikes: exactly one boom result ──
  const r2b = RD.buildRound(RC_CHAIN.chainSeed(seedB), 'normal');
  const rb = await startRound(h, h.a, h.b, seedB, 'normal', { bombStarts: true });
  await h.a.evaluate(() => window.__defuse.setLeft(90000));
  for (const { i } of scored(rb.round)) await solveSlot(h, h.a, i);
  const bb = (await waitBomb2(h.a, 8000)).b;
  assert(bb.round.name === r2b.name && bb.carry <= 90 && bb.carry > 40 && bb.start === bb.carry + 150, `run 2: bomb 2 starts on ${bb.carry} + 150 = ${bb.start} s`);
  const decoyI = bb.round.slots.findIndex((s) => s.decoy);
  for (let k = 0; k < 3; k++) {
    await h.a.locator(`.dx-mod[data-slot="${decoyI}"] .dx-mod-body`).evaluate((e) => e.scrollIntoView({ block: 'center' }));
    const box = await h.a.locator(`.dx-mod[data-slot="${decoyI}"] .dx-mod-head`).boundingBox();
    await h.a.touchscreen.tap(box.x + 20, box.y + box.height / 2);
    await sleep(850);
  }
  const lost = await until(async () => { const x = await dx(h.a); return x.bomb.over ? x : null; }, 'bomb 2 to go off', 6000);
  assert(!lost.bomb.win && lost.bomb.strikes === 3 && lost.bomb.res.score == null && /bomb 2 of 2/.test(lost.bomb.res.sub) && lost.bomb.res.sub.includes(`Chain: ${RD.buildRound(seedB, 'normal').name} → ${r2b.name}`), 'bomb 2 boomed by three strikes: ' + lost.bomb.res.sub);
  await until(async () => (await dx(h.b)).manual.over, 'the manual to see the boom');
  await endCards(h);
  await until(() => results(h).length >= 2, 'the boom recorded', 4000);
  await sleep(2200); await h.settle();
  const g2 = gdata(h);
  assert(results(h).length === 2 && results(h)[1].winner === 'team' && results(h)[1].score == null, 'exactly one boom result for the second run');
  assert(g2.booms === (g.booms | 0) + 1 && g2.chainRuns === 2 && g2.chainWins === 1 && g2.chain_normal === g.chain_normal && g2.streak === 0 && g2.wins === g.wins, 'records: booms +1, chainRuns 2, chainWins still 1, chain best kept, streak 0');
  await cshot(h.a, 'chain-phone-boom-bomb-light');

  // ── run 3: a boom on bomb 1 is a normal boom ──
  await h.a.click('#game-root [data-g="rematch"]');
  await until(async () => (await dx(h.a)).phase === 'lobby' && (await dx(h.b)).phase === 'lobby', 'lobby');
  await startRound(h, h.a, h.b, seedA, 'normal', { bombStarts: true });
  await h.a.evaluate(() => window.__defuse.setLeft(900));
  const l3 = await until(async () => { const x = await dx(h.a); return x.bomb.over ? x : null; }, 'bomb 1 to run out', 6000);
  assert(!l3.bomb.win && l3.bomb.chain === 1 && /bomb 1 of 2/.test(l3.bomb.res.sub), 'a boom on bomb 1 ends the run: ' + l3.bomb.res.sub);
  await endCards(h);
  await until(() => results(h).length >= 3, 'the boom recorded', 4000);
  await sleep(2400); await h.settle();
  const g3 = gdata(h);
  assert(results(h).length === 3 && (await dx(h.a)).bomb.chain === 1 && g3.booms === g2.booms + 1 && g3.chainRuns === 3 && g3.chainWins === 1, 'records: a third result, chainRuns 3, and bomb 2 never started');

  // ── run 4: the bomb phone closes during the NEXT BOMB interlude and reopens on bomb 2; then closes again mid-bomb-2 ──
  await h.a.click('#game-root [data-g="rematch"]');
  await until(async () => (await dx(h.a)).phase === 'lobby' && (await dx(h.b)).phase === 'lobby', 'lobby');
  const rd = await startRound(h, h.a, h.b, seedA, 'normal', { bombStarts: true });
  const closer = h.a.evaluate(() => new Promise((res) => { const t = setInterval(() => { const i = window.__defuse && window.__defuse.info(); if (i && i.bomb && i.bomb.inter) { clearInterval(t); document.querySelector('#game-root [data-g="close"]').click(); res(i.bomb.n); } }, 8); }));
  await h.a.evaluate(() => window.__defuse.setLeft(100000));
  await winBomb1Quick(h, h.a);
  assert(await closer === rd.n, 'run 4: the bomb phone closed the game during the NEXT BOMB interlude (bomb 1’s round id)');
  await h.settle(); await h.settle();
  assert(results(h).length === 3, 'closing during the interlude records nothing');
  await comeBack(h, h.a, h.b);
  const back = await until(async () => { const x = await chainState(h.a); return x && x.b && !x.b.inter ? x : null; }, 'the bomb phone to come back', 8000);
  assert(back.b.chain === 2 && back.b.seed === RC_CHAIN.chainSeed(seedA) && back.b.n !== rd.n && back.b.carry > 60 && back.b.carry <= 100 && back.b.start === back.b.carry + 150 && back.b.solved.every((v) => !v) && back.b.prevStrikes === 0 && back.b.ch1 === r1.name, `the interlude close still ends on bomb 2 (${back.b.round.name}, start ${back.b.start} s)`);
  await until(async () => { const x = await chainState(h.b); return x && x.m && x.m.n === back.b.n && x.m.chain === 2; }, 'the manual to follow', 5000);
  assert((await chipText(h.a)).join() === 'Bomb 2 of 2' && (await chipText(h.b)).join() === 'Bomb 2 of 2', 'both phones say "Bomb 2 of 2"');
  const plan4 = scored(back.b.round);
  await solveSlot(h, h.a, plan4[0].i);
  await h.closeGame(h.a);
  await h.settle(); await h.settle();
  await comeBack(h, h.a, h.b);
  const back2 = await until(async () => { const x = await chainState(h.a); return x && x.b && x.b.chain === 2 ? x : null; }, 'the bomb back on bomb 2', 8000);
  assert(back2.b.n === back.b.n && back2.b.solved[plan4[0].i] === 1 && back2.b.seed === back.b.seed && back2.b.ch1 === back.b.ch1 && (await chipText(h.a)).join() === 'Bomb 2 of 2', 'a close and reopen in the middle of bomb 2 stays on bomb 2 (same round, the solved module is still solved)');
  assert((await dx(h.b)).manual.n === back.b.n && (await dx(h.b)).manual.chain === 2, 'the manual is still on bomb 2');
  await h.a.evaluate(() => window.__defuse.setLeft(900));
  await until(async () => (await dx(h.a)).bomb.over, 'the clock to run out', 6000);
  await endCards(h);
  await until(() => results(h).length >= 4, 'recorded', 4000);
  await sleep(2200); await h.settle();
  assert(results(h).length === 4 && gdata(h).chainRuns === 4, 'the resumed chain recorded exactly once');

  // ── run 5: Today's bomb + Chain: bomb 2 is today's seed + "|next"; its time is kept under its own daily key ──
  await h.a.click('#game-root [data-g="rematch"]');
  await until(async () => (await dx(h.a)).phase === 'lobby' && (await dx(h.b)).phase === 'lobby', 'lobby');
  await h.b.tap('[data-act="today"]'); await h.settle();
  const bt = await startRound(h, h.a, h.b, null, null, { bombStarts: true });
  assert(bt.seed === 'day-' + date && bt.chain === 1 && bt.daily === date, 'Today’s bomb + Chain: bomb 1 is the day’s bomb');
  await h.a.evaluate(() => window.__defuse.forceWin());
  const t2 = await waitBomb2(h.a, 6000);
  assert(t2.b.seed === 'day-' + date + '|next' && JSON.stringify(RD.buildRound('day-' + date + '|next', 'normal').name) === JSON.stringify(t2.b.round.name), 'bomb 2 of Today’s bomb is the day’s seed + "|next", and node builds the same bomb');
  await until(async () => (await manualInfo(h.b)).edition === t2.b.round.edition && (await dx(h.b)).manual.n === t2.b.n, 'the manual on the same edition', 4000);
  await h.a.evaluate(() => window.__defuse.setLeft(900));
  await until(async () => (await dx(h.a)).bomb.over, 'the clock to run out', 6000);
  await endCards(h);
  await until(() => results(h).length >= 5, 'recorded', 4000);
  await sleep(1800); await h.settle();
  const g5 = gdata(h);
  assert(results(h).length === 5 && g5[`daily_${date}_normalx2_a`] === 0 && !(`daily_${date}_normal_a` in g5), 'a chain time on Today’s bomb is stored under its own key (daily_<date>_normalx2_a)');
  await h.a.click('#game-root [data-g="rematch"]');
  await until(async () => (await dx(h.a)).phase === 'lobby', 'lobby');
  assert(/Today \(Agent ×2\)/.test(await h.a.textContent('.dx-rec')), 'the lobby’s Today line says Agent ×2 when Chain is on');
  noErrors(h, 'phones, chain');
}

// ══════════════════════════ Chain ×2: laptop bomb + phone manual, light and dark ══════════════════════════
async function chainLaptop(h, scheme) {
  console.log(`\n# Chain ×2: laptop bomb, phone manual (${scheme})`);
  await asLaptopPhone(h);
  await goLive(h);
  await pickRoles(h, h.a, h.b);
  const seed = chainSeeds('normal', false, 'cl' + scheme[0]);
  const r1 = RD.buildRound(seed, 'normal'), r2 = RD.buildRound(RC_CHAIN.chainSeed(seed), 'normal');
  await h.b.click('.dx-tiers [data-diff="normal"]'); await h.settle();
  await h.b.click('[data-act="chain"]'); await h.settle();
  assert(await h.a.evaluate(() => document.querySelector('[data-act="chain"]').getAttribute('aria-checked')) === 'true', `${scheme}: the Chain switch reaches the laptop`);
  await cshot(h.b, `chain-laptop-${scheme}-lobby-phone`); await cshot(h.a, `chain-laptop-${scheme}-lobby`);
  const b1 = await startRound(h, h.a, h.b, seed, 'normal', { bombStarts: false });
  assert(await visible(h.a, '.dx-side .dx-chain') && !(await visible(h.a, '.dx-topbar')) && (await chipText(h.a)).join() === 'Bomb 1 of 2' && (await chipText(h.b)).join() === 'Bomb 1 of 2', `${scheme}: "Bomb 1 of 2" in the laptop’s side panel and on the phone manual`);
  await cshot(h.a, `chain-laptop-${scheme}-bomb1`, { fullPage: true }); await cshot(h.b, `chain-laptop-${scheme}-manual1`);
  await h.a.evaluate(() => window.__defuse.setLeft(150000));
  await winBomb1Quick(h, h.a, { touch: false });
  await waitInterlude(h.a);
  await Promise.all([cshot(h.a, `chain-laptop-${scheme}-interlude`), cshot(h.b, `chain-laptop-${scheme}-interlude-phone`)]);
  const s2 = await waitBomb2(h.a);
  await until(async () => { const x = await chainState(h.b); return x && x.m && x.m.n === s2.b.n; }, 'the phone manual to follow', 4000);
  assert(s2.b.round.name === r2.name && (await manualInfo(h.b)).edition === r2.edition && (await chipText(h.a)).join() === 'Bomb 2 of 2' && (await chipText(h.b)).join() === 'Bomb 2 of 2', `${scheme}: bomb 2 (${r2.name}) on both devices, "Bomb 2 of 2"`);
  assert(await noSideScroll(h.a) && await noSideScroll(h.b), `${scheme}: no side scroll on either device`);
  const small = [...(await smallText(h.a)), ...(await smallText(h.b))].filter((x) => /dx-chain/.test(x.sel));
  assert(small.length === 0, `${scheme}: the chain label is at least 11 px`);
  await sleep(300);
  await cshot(h.a, `chain-laptop-${scheme}-bomb2`, { fullPage: true }); await cshot(h.b, `chain-laptop-${scheme}-manual2`);
  const done = scored(s2.b.round);
  for (const { i } of done.slice(0, 2)) await solveSlot(h, h.a, i, { touch: false });
  await h.a.evaluate(() => window.__defuse.setLeft(1200));
  await until(async () => (await dx(h.a)).bomb.over, 'the clock to run out', 6000);
  await sleep(700);
  await endCards(h);
  await sleep(400);
  await cshot(h.a, `chain-laptop-${scheme}-end`); await cshot(h.b, `chain-laptop-${scheme}-end-phone`);
  await until(() => results(h).length >= 1, 'the boom recorded', 4000);
  await sleep(2200); await h.settle();
  const x = gdata(h);
  assert(results(h).length === 1 && x.booms === 1 && x.chainRuns === 1 && !x.chainWins, `${scheme}: bomb 2 boomed on the clock, recorded once`);
  await closeBoth(h);
  noErrors(h, 'chain laptop ' + scheme);
}

// ══════════════════════════ run ══════════════════════════
async function withHarness(opts, fn) {
  const h = await launch({ only: ['defuse'], ...opts });
  try {
    await fn(h);
  } catch (e) {
    await h.a.screenshot({ path: path.join(SHOTS, 'FAIL-a.png') }).catch(() => {});
    await h.b.screenshot({ path: path.join(SHOTS, 'FAIL-b.png') }).catch(() => {});
    console.error('errors:', h.errors);
    throw e;
  } finally {
    await h.close();
  }
}
(async () => {
  const only = process.argv[2] || 'all';
  try {
    RD = await imp('js/games/defuse/round.js');
    RD_BY = RD.BY_ID;
    RC_CHAIN = await imp('js/games/defuse/records.js');
    if (only === 'all' || only === 'node') await nodePart();
    if (only === 'all' || only === 'phone') {
      await withHarness({ port: PORT, coarse: true }, async (h) => { await asPhones(h); await phoneNormal(h); await closeBoth(h); await phoneClassic(h); await closeBoth(h); await phoneDaily(h); });
      await withHarness({ port: PORT + 9, coarse: true, seedDocs: { 'gamedata/defuse': { wins: 5, streak: 3, medal_normal: 2, parN_normal: 3, parSum_normal: 480, log: JSON.stringify([1, 2, 3].map((n) => ({ name: 'Sleepy Koala', tier: 'normal', win: 1, holder: 'a', secs: 120 }))) } } }, async (h) => { await asPhones(h); await phonePar(h); });
    }
    if (only === 'all' || only === 'wild') {
      await withHarness({ port: PORT + 1, coarse: true }, async (h) => { await asPhones(h); await phoneWild(h); await closeBoth(h); await phoneTwists(h); });
      await withHarness({ port: PORT + 6, coarse: true }, async (h) => { await asPhones(h); await tierSweep(h); });
      await withHarness({ port: PORT + 8, coarse: true }, async (h) => { await asPhones(h); await relayWhilePaused(h); await closeBoth(h); await hushRound(h); });
    }
    if (only === 'all' || only === 'laptop') {
      await withHarness({ port: PORT + 2, device: 'Desktop Chrome' }, async (h) => { await laptopRound(h, 'light'); });
    }
    if (only === 'all' || only === 'dark') {
      await withHarness({ port: PORT + 3, device: 'Desktop Chrome', colorScheme: 'dark' }, async (h) => { await laptopRound(h, 'dark'); });
      await withHarness({ port: PORT + 4, colorScheme: 'dark', coarse: true }, async (h) => { await asPhones(h); await goLive(h); await pickRoles(h, h.a, h.b); await shot(h.a, 'phone-lobby-dark'); const b = await startRound(h, h.a, h.b, 'darkseed', 'normal'); await shot(h.a, 'phone-bomb-dark', { fullPage: true }); await shot(h.b, 'phone-manual-dark'); await h.b.tap(`.dx-index [data-page="${b.round.ids[0]}"]`); await shot(h.b, 'phone-manual-page-dark'); noErrors(h, 'phones, dark'); });
    }
    if (only === 'all' || only === 'layout') {
      await withHarness({ port: PORT + 7, coarse: true }, async (h) => { await layoutGroup(h); });
    }
    if (only === 'all' || only === 'legacy') {
      await withHarness({ port: PORT + 5, coarse: true, seedDocs: { 'gamedata/defuse': { wins: 7, streak: 2, best: { normal: 100 }, medal: 'weird', log: '{{', mods: 4 } } }, async (h) => { await asPhones(h); await legacy(h); });
    }
    if (only === 'all' || only === 'chain') {
      await withHarness({ port: PORT + 10, coarse: true }, async (h) => { await asPhones(h); await phoneChain(h); });
      await withHarness({ port: PORT + 11, device: 'Desktop Chrome' }, async (h) => { await chainLaptop(h, 'light'); });
      await withHarness({ port: PORT + 12, device: 'Desktop Chrome', colorScheme: 'dark' }, async (h) => { await chainLaptop(h, 'dark'); });
    }
    console.log('\nALL GOOD. Screenshots in', SHOTS);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
})();
