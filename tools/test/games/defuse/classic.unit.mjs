// Unit tests for js/games/defuse/classic.js: the four classic modules (fixed classic edition + seeded editions).
// Run by tools/test/games/defuse.test.js; also runnable alone:
//   node -e "import('./tools/test/games/defuse/classic.unit.mjs').then(m=>m.run({assert:(c,m)=>{if(!c)throw new Error(m);console.log('ok -',m)}}))"
import fs from 'node:fs';

const TIERS = {
  classic: { id: 'classic', label: 'Classic', secs: 300, mods: 4, twists: 0, level: 1, stages: 4, needy: false },
  chill: { id: 'chill', label: 'Rookie', secs: 360, mods: 3, twists: 0, level: 1, stages: 3, needy: false },
  normal: { id: 'normal', label: 'Agent', secs: 300, mods: 4, twists: 1, level: 2, stages: 4, needy: false },
  spicy: { id: 'spicy', label: 'Expert', secs: 330, mods: 5, twists: 2, level: 3, stages: 5, needy: true },
  wild: { id: 'wild', label: 'Bomb Squad', secs: 360, mods: 6, twists: 3, level: 4, stages: 5, needy: true },
};
const SEEDED = ['chill', 'normal', 'spicy', 'wild'];
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];

// The rules exactly as the field guide printed them before the update (copy of GUIDE in computer.test.js).
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

const uniq = (a) => new Set(a).size;
const text = (html) => html.replace(/<[^>]*>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const ruleLis = (html) => [...html.matchAll(/<li data-rule="([^"]+)"([^>]*)><span>([\s\S]*?)<\/span><\/li>/g)].map((m) => ({ key: m[1], attrs: Object.fromEntries([...m[2].matchAll(/data-([a-z]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])), text: text(m[3]) }));

export async function run({ assert }) {
  const U = await import(new URL('../../../../js/games/defuse/util.js', import.meta.url));
  const C = await import(new URL('../../../../js/games/defuse/classic.js', import.meta.url));
  const { stream, int, pick, shuffle } = U;
  const { WIRES, BUTTON, KEYPAD, SEQUENCE, CLASSIC_FOUR, GLYPHS, glyphSVG } = C;
  const MODS = { wires: WIRES, button: BUTTON, keypad: KEYPAD, sequence: SEQUENCE };

  // ── edgework, drawn the way the framework does ──
  const CONS = 'BCDFGHJKLMNPQRSTVWXZ';
  const IND = ['RDY', 'PWR', 'AUX', 'LNK', 'SYS', 'CLR', 'IGN', 'MSA'];
  const PORTS = ['DVI', 'PS2', 'RJ45', 'SERIAL'];
  function edgework(seed, T) {
    const r = stream(seed, 'edge');
    const ch = Array.from({ length: 5 }, () => (r() < 0.55 ? pick(r, [...CONS]) : String(int(r, 10))));
    if (r() < 0.5) ch[int(r, 5)] = pick(r, [...'AEU']);
    const serial = ch.join('') + int(r, 10);
    const pool = shuffle(r, IND);
    const E = { serial, batteries: int(r, 5), indicators: [0, 1].map((i) => ({ label: pool[i], lit: r() < 0.5 })) };
    if (T.level >= 2) E.ports = shuffle(r, PORTS).slice(0, int(r, 4));
    return E;
  }
  const build = (id, seed, T) => {
    const M = MODS[id];
    const R = M.rules(stream(seed, 'rules', id), T);
    const E = edgework(seed, T);
    const S = M.gen(stream(seed, 'gen', id), E, R, T);
    return { M, R, E, S, A: M.solve(S, E, R, T) };
  };

  assert(CLASSIC_FOUR.length === 4 && CLASSIC_FOUR.map((m) => m.id).join() === 'wires,button,keypad,sequence', 'CLASSIC_FOUR lists the four modules in order');
  assert(Object.keys(GLYPHS).length === 30 && /^<svg class="dx-glyph"/.test(glyphSVG('eye')) && /class="x"/.test(glyphSVG('eye', 'x')), '30 glyphs and glyphSVG(id, cls)');
  for (const M of CLASSIC_FOUR) assert(/^[a-z]+$/.test(M.id) && M.tab.length <= 9 && M.tiers.includes('classic') && M.tiers.includes('wild') && !M.needy && !M.remote, `${M.id}: plugin fields`);

  // ── determinism ──
  {
    let same = true;
    for (let i = 0; i < 100; i++) for (const t of Object.keys(TIERS)) for (const id of Object.keys(MODS)) {
      const a = build(id, 's' + i, TIERS[t]); const b = build(id, 's' + i, TIERS[t]);
      if (JSON.stringify([a.R, a.S, a.A, a.M.page(a.R, TIERS[t])]) !== JSON.stringify([b.R, b.S, b.A, b.M.page(b.R, TIERS[t])])) same = false;
    }
    assert(same, 'same seed and tier give identical rules, puzzle, answer and page (100 seeds × 5 tiers × 4 modules)');
  }

  // ── validity: 1000 seeds × every tier ──
  const stats = {};
  for (const t of Object.keys(TIERS)) {
    const T = TIERS[t];
    const st = { wirePos: {}, wireIdx: {}, act: { tap: 0, hold: 0 }, col: {}, finalWire: 0, wireN: {}, rels: new Set(), conds: new Set() };
    stats[t] = st;
    let bad = '';
    for (let i = 0; i < 1000; i++) {
      const seed = 'v' + i;
      {
        const { R, E, S, A } = build('wires', seed, T);
        const n = S.w.length;
        const lst = R.lists[n];
        if (!(n >= 3 && n <= 6 && S.w.every((c) => R.pal.includes(c)))) bad = `wires colours ${seed}`;
        if (!(Number.isInteger(A.wire) && A.wire >= 0 && A.wire < n)) bad = `wire index ${seed}`;
        const a = lst[A.rule].a.split(':');
        if ((a[0] === 'first' || a[0] === 'last') && S.w[A.wire] !== a[1]) bad = `cut colour ${seed}`;
        if (lst[lst.length - 1].c !== 'true' || lst.length < 3 || lst.length > 5) bad = `wire list shape ${seed} (${lst.length})`;
        if (t === 'wild' && lst.length < 4) bad = `wild wire lists should have more rules ${seed}`;
        // actions that name a colour only follow conditions that guarantee it
        for (let k = 0; k < lst.length; k++) {
          const [kind, col] = lst[k].a.split(':');
          if ((kind === 'first' || kind === 'last') && t !== 'classic' && !new RegExp(`(count:${col}:[12]\\+?|firstis:${col}|lastis:${col}|more:${col}:)`).test(lst[k].c)) bad = `unguaranteed colour ${seed} ${lst[k].c} ${lst[k].a}`;
        }
        if (t === 'chill' && JSON.stringify(R).includes('green')) bad = 'green before level 3';
        if (E.ports === undefined && /port/.test(JSON.stringify(R.lists))) bad = 'ports in level 1 rules';
        st.wireIdx[A.wire] = (st.wireIdx[A.wire] || 0) + 1;
        (st.wirePos[n] ??= {})[A.wire] = (st.wirePos[n][A.wire] || 0) + 1;
        if (A.rule === lst.length - 1) st.finalWire++;
      }
      {
        const { R, S, A } = build('button', seed, T);
        if (!(R.rules[R.rules.length - 1].c === 'true')) bad = `button final rule ${seed}`;
        if (!(A.act === 'tap' || A.act === 'hold')) bad = `button act ${seed}`;
        if (A.act === 'hold' && !(A.digit >= 1 && A.digit <= 9)) bad = `button digit ${seed}`;
        if (A.act === 'tap' && A.digit !== null) bad = `tap with digit ${seed}`;
        const ds = Object.values(R.strip);
        if (uniq(ds) !== 4 || ds.length !== 4) bad = `strip not injective ${seed}`;
        if (!R.colors.includes(S.color) || !R.labels.includes(S.label)) bad = `button face ${seed}`;
        if (!R.rules.some((q) => q.a === 'hold') || !R.rules.some((q) => q.a === 'tap')) bad = `button needs both actions ${seed}`;
        if (T.level < 3 && R.rel !== 'last') bad = 'release variant before level 3';
        if (T.level < 3 && (R.labels.includes('HOLD') || R.labels.includes('PRESS'))) bad = 'red-herring labels before level 3';
        st.act[A.act]++;
        st.rels.add(R.rel);
      }
      {
        const { R, E, S, A } = build('keypad', seed, T);
        const owners = R.cols.filter((c) => S.keys.every((g) => c.includes(g)));
        if (owners.length !== 1) bad = `keypad columns holding all four: ${owners.length} ${seed}`;
        if (uniq(S.keys) !== 4 || S.keys.some((g) => !GLYPHS[g])) bad = `keypad keys ${seed}`;
        if (A.order.length !== 4 || A.order.some((g) => !S.keys.includes(g)) || uniq(A.order) !== 4) bad = `keypad order ${seed}`;
        if (R.cols.some((c) => c.length !== 7 || uniq(c) !== 7)) bad = `keypad column ${seed}`;
        if (t !== 'classic' && (R.cols.length < 5 || R.cols.length > 6)) bad = `keypad column count ${seed}`;
        if (t !== 'classic') for (let a = 0; a < R.cols.length; a++) for (let b = a + 1; b < R.cols.length; b++) if (R.cols[a].filter((g) => R.cols[b].includes(g)).length > 4) bad = `keypad overlap ${seed}`;
        if (T.level < 3 && R.up.some(Boolean)) bad = 'reversed columns before level 3';
        if (T.level >= 3 && !R.up.some(Boolean)) bad = 'level 3 should reverse some columns';
        st.col[A.col] = (st.col[A.col] || 0) + 1;
        void E;
      }
      {
        const { R, S, A } = build('sequence', seed, T);
        if (S.seq.length !== T.stages) bad = `sequence length ${seed}`;
        if (A.length !== 3 || A.some((q) => q.length !== T.stages)) bad = `sequence answer ${seed}`;
        for (const m of [...R.yes, ...R.no]) if (uniq(Object.values(m)) !== 4 || Object.keys(m).length !== 4) bad = `sequence map not a permutation ${seed}`;
        st.conds.add(R.cond.split(':')[0]);
      }
      if (bad) break;
    }
    assert(!bad, `${t}: 1000 seeds, every module gives a valid, unique answer${bad ? ' - ' + bad : ''}`);
  }

  // ── variety ──
  for (const t of SEEDED) {
    const T = TIERS[t];
    for (const id of Object.keys(MODS)) {
      const set = new Set();
      for (let i = 0; i < 100; i++) set.add(JSON.stringify(MODS[id].rules(stream('x' + i, 'rules', id), T)));
      assert(set.size >= 20, `${t}/${id}: ${set.size} distinct rule sets per 100 seeds (>= 20)`);
    }
    const st = stats[t];
    const top = Math.max(...Object.values(st.wireIdx)) / 1000;
    assert(top <= 0.45, `${t}: no single wire index above 45% (top ${(top * 100).toFixed(0)}%)`);
    assert(st.finalWire / 1000 < 0.7, `${t}: the answer comes from an earlier rule most of the time (final rule ${(st.finalWire / 10).toFixed(0)}%)`);
    assert(st.act.tap >= 250 && st.act.hold >= 250, `${t}: button asks for both tap (${st.act.tap}) and hold (${st.act.hold})`);
    assert(Math.max(...Object.values(st.col)) / 1000 <= 0.45 && Object.keys(st.col).length >= 5, `${t}: keypad answers spread over columns (${JSON.stringify(st.col)})`);
  }
  {
    // no single answer position dominates, and the last wire is not the favourite answer (it used to be 33-35%)
    const agg = {};
    for (const t of SEEDED) for (const n of Object.keys(stats[t].wirePos)) for (const [i, c] of Object.entries(stats[t].wirePos[n])) { (agg[n] ??= {})[i] = (agg[n][i] || 0) + c; }
    const worst = Object.entries(agg).map(([n, o]) => { const tot = Object.values(o).reduce((a, b) => a + b, 0); return [+n, Math.max(...Object.values(o)) / tot, (o[n - 1] || 0) / tot]; });
    for (const [n, top, last] of worst) {
      assert(top <= (n === 3 ? 0.4 : 0.3), `${n} wires: no answer position above ${n === 3 ? 40 : 30}% (top ${(top * 100).toFixed(1)}%)`);
      assert(last <= (n === 3 ? 0.4 : 0.3), `${n} wires: the last wire is not over-represented (${(last * 100).toFixed(1)}%)`);
    }
  }
  assert(stats.spicy.rels.size >= 2 && stats.wild.rels.size >= 2, 'level 3+ buttons use more than one release variant');
  assert(['vowel', 'even'].every((c) => stats.chill.conds.has(c)) && stats.chill.conds.size === 2, 'level 1 sequence is picked by vowel or even only');
  assert(['bat', 'lit'].every((c) => stats.wild.conds.has(c)), 'higher levels also pick the sequence table by batteries or a lit indicator');
  {
    const share = Math.max(...Object.values(stats.classic.wireIdx)) / 1000;
    assert(share <= 0.5, `classic: wire index spread (top ${(share * 100).toFixed(0)}%)`);
  }

  // ── classic edition: page text equals today's field guide ──
  {
    const T = TIERS.classic;
    const got = {};
    for (const id of ['wires', 'button']) for (const li of ruleLis(MODS[id].page(MODS[id].rules(() => 0.5, T), T))) got[li.key] = li.text;
    assert(Object.keys(got).length === Object.keys(GUIDE).length && Object.entries(GUIDE).every(([k, v]) => got[k] === v), 'classic page text equals the GUIDE word for word');
    let fromFile = null;
    try {
      const src = fs.readFileSync(new URL('../computer.test.js', import.meta.url), 'utf8');
      const m = src.match(/const GUIDE = (\{[\s\S]*?\n\});/);
      if (m) fromFile = new Function('return ' + m[1])();
    } catch { /* optional */ }
    if (fromFile) assert(Object.entries(fromFile).every(([k, v]) => got[k] === v) && Object.keys(fromFile).length === Object.keys(got).length, 'classic page text equals GUIDE in computer.test.js');
    // the phrase generator reproduces the classic phrasing (except "cut the black wire" for a single wire)
    const seq = SEQUENCE.page(SEQUENCE.rules(() => 0.5, T), T);
    assert(text(seq).includes('Pick the table by whether the serial number contains a vowel (A, E, I, O or U).') && />Serial has a vowel</.test(seq) && />No vowel in the serial</.test(seq), 'classic sequence page keeps its wording');
    const btn = BUTTON.page(BUTTON.rules(() => 0.5, T), T);
    assert(text(btn).includes('Let go when the last digit of the timer matches the strip:') && text(btn).includes('Example: with a blue strip, let go at 4:13 or 3:53.'), 'classic button page keeps its wording');
    const kp = text(KEYPAD.page(KEYPAD.rules(() => 0.5, T), T));
    assert(kp.includes('Press the keys in the order they appear in that column, from top to bottom.') && !/bottom to top/.test(kp), 'classic keypad page keeps its wording');
    assert(WIRES.errata(() => 0.5, WIRES.rules(() => 0.5, T), T) === null && BUTTON.errata(() => 0.5, BUTTON.rules(() => 0.5, T), T) === null, 'no errata in the classic edition');
  }

  // ── solving from the page alone (independent evaluator) ──
  const atomHolds = (a, f) => {
    const [k, x, y] = a.split(':');
    const w = f.wires || [];
    const n = (c) => w.filter((q) => q === c).length;
    const last = +f.serial.slice(-1);
    const lit = f.indicators.filter((i) => i.lit).map((i) => i.label);
    const present = f.indicators.map((i) => i.label);
    if (k === 'count') return y === '0' ? n(x) === 0 : y === '1' ? n(x) === 1 : n(x) >= 2;
    if (k === 'firstis') return w[0] === x;
    if (k === 'lastis') return w[w.length - 1] === x;
    if (k === 'more') return n(x) > n(y);
    if (k === 'same') return w[0] === w[w.length - 1];
    if (k === 'even') return last % 2 === 0;
    if (k === 'odd') return last % 2 === 1;
    if (k === 'vowel') return /[AEIOU]/.test(f.serial);
    if (k === 'novowel') return !/[AEIOU]/.test(f.serial);
    if (k === 'lit') return lit.includes(x);
    if (k === 'unlit') return present.includes(x) && !lit.includes(x);
    if (k === 'bat') return x === '0' ? f.batteries === 0 : f.batteries >= parseInt(x, 10);
    if (k === 'port') return (f.ports || []).includes(x);
    if (k === 'noport') return !(f.ports || []).includes(x);
    if (k === 'color') return f.button.color === x;
    if (k === 'label') return f.button.label === x;
    throw new Error('unknown atom ' + a);
  };
  const condHolds = (c, f) => c === 'true' || c.split(',').every((a) => atomHolds(a, f));
  /** every colour, label, number and position a rule's attributes name must also be in its text */
  const textMatches = (li) => {
    const t = li.text;
    const atoms = (li.attrs.if || 'true').split(',').filter((a) => a !== 'true');
    for (const a of atoms) {
      const [k, x, y] = a.split(':');
      if (['count', 'firstis', 'lastis', 'more', 'lit', 'unlit', 'port', 'noport', 'color', 'label'].includes(k) && !t.includes(x)) return false;
      if (k === 'more' && !t.includes(y)) return false;
      if (k === 'bat' && x !== '0' && !t.includes(NUMW[parseInt(x, 10)] + ' or more')) return false;
      if (k === 'even' && !/is even/.test(t)) return false;
      if (k === 'odd' && !/is odd/.test(t)) return false;
      if (k === 'vowel' && !/has a vowel/.test(t)) return false;
      if (k === 'novowel' && !/has no vowel/.test(t)) return false;
      if (k === 'unlit' && !new RegExp(`the ${x} indicator is unlit`).test(t)) return false;
      if (k === 'lit' && !new RegExp(`(the ${x} indicator is lit|a lit ${x} indicator)`).test(t)) return false; // the classic edition keeps its old words
      if (k === 'noport' && !/no \S+ port/.test(t)) return false;
    }
    const cut = li.attrs.cut;
    if (cut) {
      const [k, x] = cut.split(':');
      if (k === 'nth' && !t.includes(`cut the ${ORD[+x - 1]} wire`)) return false;
      if ((k === 'first' || k === 'last') && !(t.includes(`cut the ${k} ${x} wire`) || t.includes(`cut the ${x} wire`))) return false;
      if (k === 'end' && !t.includes('cut the last wire')) return false;
    }
    if (li.attrs.do && !t.includes(`${li.attrs.do} it`)) return false;
    return true;
  };
  const solveWiresFromPage = (html, f) => {
    const n = f.wires.length;
    const lis = ruleLis(html).filter((l) => l.key.startsWith(`w${n}-`));
    const li = lis.find((l) => condHolds(l.attrs.if, f));
    const [k, x] = li.attrs.cut.split(':');
    return k === 'nth' ? +x - 1 : k === 'first' ? f.wires.indexOf(x) : k === 'last' ? f.wires.lastIndexOf(x) : n - 1;
  };
  const solveButtonFromPage = (html, f) => {
    const li = ruleLis(html).filter((l) => l.key.startsWith('b-')).find((l) => condHolds(l.attrs.if, f));
    const rel = html.match(/data-rel="([a-z]+)"/)[1];
    const strip = {};
    for (const m of html.matchAll(/data-strip="([a-z]+)" data-digit="(\d)"/g)) strip[m[1]] = +m[2];
    return { act: li.attrs.do, digit: li.attrs.do === 'hold' ? strip[f.button.strip] : null, rel };
  };
  const solveKeypadFromPage = (html, f) => {
    const cols = [...html.matchAll(/<div class="dx-col" data-col="(\d+)" data-dir="(up|down)">([\s\S]*?)<\/div>/g)].map((m) => ({ dir: m[2], gl: [...m[3].matchAll(/data-glyph="([a-z]+)"/g)].map((g) => g[1]) }));
    const hit = cols.filter((c) => f.keypad.every((g) => c.gl.includes(g)));
    if (hit.length !== 1) return null;
    const order = [...f.keypad].sort((a, b) => hit[0].gl.indexOf(a) - hit[0].gl.indexOf(b));
    return hit[0].dir === 'up' ? order.reverse() : order;
  };
  const solveSeqFromPage = (html, f) => {
    const cond = html.match(/data-cond="([^"]+)"/)[1];
    const v = condHolds(cond, f) ? 'v' : 'n';
    const to = {};
    for (const m of html.matchAll(/data-v="([vn])" data-from="([a-z]+)" data-st="(\d)" data-to="([a-z]+)"/g)) to[`${m[1]}${m[3]}${m[2]}`] = m[4];
    return [0, 1, 2].map((st) => f.seq.map((c) => to[`${v}${st}${c}`]));
  };
  const state = (E, S) => ({ serial: E.serial, batteries: E.batteries, indicators: E.indicators, ports: E.ports });
  // the old hand-written solver (copy of solveByGuide in computer.test.js): the classic page and the text agree with it
  const oldSolve = (f) => {
    const even = +f.serial.slice(-1) % 2 === 0;
    const lit = (l) => f.indicators.some((x) => x.label === l && x.lit);
    const w = f.wires; const n = w.length; const count = (c) => w.filter((x) => x === c).length;
    let wire;
    if (n === 3) wire = w[0] === w[2] ? 1 : count('black') === 1 ? w.indexOf('black') : even ? 0 : 2;
    else if (n === 4) wire = lit('RDY') && count('yellow') >= 2 ? w.lastIndexOf('yellow') : !count('blue') ? 2 : count('white') === 1 ? 0 : !even ? 1 : w.lastIndexOf('blue');
    else if (n === 5) wire = w[4] === 'black' && !even ? 3 : count('red') > count('blue') ? w.indexOf('red') : !count('yellow') ? 1 : f.batteries >= 3 ? 4 : 0;
    else wire = !count('white') && even ? 2 : count('yellow') === 1 ? w.indexOf('yellow') : lit('PWR') ? 4 : !count('red') ? 5 : 3;
    const b = f.button;
    const act = b.color === 'blue' && b.label === 'WAIT' ? 'hold' : b.label === 'FIRE' && f.batteries >= 2 ? 'tap' : b.color === 'white' && lit('AUX') ? 'hold' : b.color === 'red' && b.label === 'HALT' ? 'tap' : b.color === 'yellow' ? 'hold' : f.batteries === 0 ? 'hold' : 'tap';
    return { wire, act, digit: act === 'hold' ? { blue: 3, white: 6, yellow: 1, red: 8 }[b.strip] : null };
  };
  for (const t of Object.keys(TIERS)) {
    const T = TIERS[t];
    let bad = '';
    let textBad = 0;
    let n = 0;
    for (let i = 0; i < 300 && !bad; i++) {
      const seed = 'p' + i;
      const w = build('wires', seed, T); const b = build('button', seed, T); const k = build('keypad', seed, T); const q = build('sequence', seed, T);
      const f = { ...state(w.E), wires: w.S.w, button: b.S, keypad: k.S.keys, seq: q.S.seq };
      const fw = { ...f, button: b.S };
      // each module's S was generated against its own E, so check each against that E
      const wp = solveWiresFromPage(WIRES.page(w.R, T), { ...state(w.E), wires: w.S.w });
      if (wp !== w.A.wire) bad = `wires page vs solve ${seed}: ${wp} / ${w.A.wire}`;
      const bp = solveButtonFromPage(BUTTON.page(b.R, T), { ...state(b.E), button: b.S });
      if (bp.act !== b.A.act || bp.digit !== b.A.digit || bp.rel !== b.A.rel) bad = `button page vs solve ${seed}: ${JSON.stringify(bp)} / ${JSON.stringify(b.A)}`;
      const kp = solveKeypadFromPage(KEYPAD.page(k.R, T), { keypad: k.S.keys });
      if (!kp || kp.join() !== k.A.order.join()) bad = `keypad page vs solve ${seed}`;
      const sp = solveSeqFromPage(SEQUENCE.page(q.R, T), { ...state(q.E), seq: q.S.seq });
      if (JSON.stringify(sp) !== JSON.stringify(q.A)) bad = `sequence page vs solve ${seed}`;
      if (t === 'classic') {
        const o = oldSolve({ ...state(w.E), wires: w.S.w, button: { color: 'red', label: 'PUSH', strip: 'red' } });
        if (o.wire !== w.A.wire) bad = `classic wires vs the printed guide ${seed}`;
        const o2 = oldSolve({ ...state(b.E), wires: [...'rrr'], button: b.S });
        if (o2.act !== b.A.act || o2.digit !== b.A.digit) bad = `classic button vs the printed guide ${seed}`;
      }
      for (const li of [...ruleLis(WIRES.page(w.R, T)), ...ruleLis(BUTTON.page(b.R, T))]) { n++; if (!textMatches(li)) { textBad++; if (textBad < 3) console.error('text/attr mismatch', li); } }
      void fw;
    }
    assert(!bad, `${t}: solving from the page alone matches solve() for 300 seeds${bad ? ' - ' + bad : ''}`);
    assert(textBad === 0, `${t}: every rule's text names the colours, numbers and positions its data attributes carry (${n} rules)`);
  }

  // ── no unreachable or pointless rules in the seeded editions (judged by this file's own evaluator, on bombs the module never saw) ──
  {
    const dead = (list) => list.some((q, i) => i > 0 && q.c !== 'true' && list.slice(0, i).some((p) => p.c.split(',').every((a) => q.c.split(',').includes(a))));
    let syntactic = true;
    const sr = stream('semantic-test', 'bombs');
    const NB = 1000;
    const bombs = Array.from({ length: NB }, () => {
      const vowel = sr() < 0.5; const pool = shuffle(sr, IND);
      return { serial: (vowel ? 'A' : 'B') + 'CDFG' + int(sr, 10), batteries: int(sr, 5), indicators: [0, 1].map((i) => ({ label: pool[i], lit: sr() < 0.5 })), ports: shuffle(sr, PORTS).slice(0, int(sr, 4)) };
    });
    const faces = (cols, labs) => bombs.map((b) => ({ ...b, button: { color: pick(sr, cols), label: pick(sr, labs) } }));
    const wireIdx = (a, w) => { const [k, x] = a.split(':'); const i = k === 'nth' ? +x - 1 : k === 'first' ? w.indexOf(x) : k === 'last' ? w.lastIndexOf(x) : w.length - 1; return i < 0 || i >= w.length ? w.length - 1 : i; };
    const tally = { rules: 0, never: 0, finalUnreachable: 0, noop: 0, lists: 0 };
    const check = (list, fs, ans) => {
      const fire = list.map(() => 0); const change = list.map(() => 0);
      for (const f of fs) {
        const hit = list.map((q) => condHolds(q.c, f));
        const i = hit.indexOf(true);
        if (i < 0) continue;
        fire[i]++;
        const j = hit.indexOf(true, i + 1);
        if (j >= 0 && ans(list[i].a, f) !== ans(list[j].a, f)) change[i]++;
      }
      tally.lists++;
      list.forEach((q, i) => {
        tally.rules++;
        if (!fire[i]) tally[i === list.length - 1 ? 'finalUnreachable' : 'never']++;
        else if (i < list.length - 1 && !change[i]) tally.noop++;
      });
    };
    for (const t of SEEDED) for (let i = 0; i < 120; i++) {
      const T = TIERS[t];
      const W = WIRES.rules(stream('u' + i, 'rules', 'wires'), T);
      for (const n of [3, 4, 5, 6]) {
        if (dead(W.lists[n])) syntactic = false;
        const wr = stream('semantic-test', 'wires', n, t);
        check(W.lists[n], bombs.map((b) => ({ ...b, wires: Array.from({ length: n }, () => pick(wr, W.pal)) })), (a, f) => wireIdx(a, f.wires));
      }
      const B = BUTTON.rules(stream('u' + i, 'rules', 'button'), T);
      if (dead(B.rules)) syntactic = false;
      check(B.rules, faces(B.colors, B.labels), (a) => a);
    }
    assert(syntactic, 'no seeded rule is shadowed by an earlier one (same atoms)');
    assert(tally.never === 0 && tally.finalUnreachable === 0, `no seeded rule never fires and every closing "Otherwise" is reachable (${tally.rules} rules in ${tally.lists} lists: ${tally.never} never, ${tally.finalUnreachable} unreachable finals)`);
    assert(tally.noop / tally.rules < 0.05, `fewer than 5% of seeded rules are no-ops, i.e. change nothing the rules below would not give (${tally.noop} of ${tally.rules})`);
  }

  // ── pages read aloud: plain sentences, rule numbers in order ──
  for (const t of Object.keys(TIERS)) {
    const T = TIERS[t];
    let ok = true;
    for (let i = 0; i < 100; i++) {
      for (const id of ['wires', 'button']) {
        const { R, M } = build(id, 'r' + i, T);
        const lis = ruleLis(M.page(R, T));
        lis.forEach((l) => { if (!/^(If|Otherwise,)/.test(l.text) || !/\.$/.test(l.text) || l.text.length > 150) ok = false; });
        if (!lis.length || !lis[0].text.startsWith('If ') || lis.filter((l) => l.text.startsWith('If ')).length !== (id === 'wires' ? 4 : 1)) ok = false;
      }
    }
    assert(ok, `${t}: rule sentences are short, start with If / Otherwise and end with a full stop`);
  }
  {
    // level 3+ button: the words HOLD and PRESS are red herrings; each edition says "literal" or "inverted" per word (mostly inverted)
    const found = { sum: false, any: false, last: false };
    const seen = { HOLD: { tap: 0, hold: 0 }, PRESS: { tap: 0, hold: 0 } };
    const editions = { HOLD: new Set(), PRESS: new Set() };
    let relBad = false; let consistent = true;
    for (const T of [TIERS.spicy, TIERS.wild]) for (let i = 0; i < 300; i++) {
      const R = BUTTON.rules(stream('h' + i, 'rules', 'button'), T);
      const pg = text(BUTTON.page(R, T));
      const per = {};
      for (const q of R.rules) {
        const m = q.c.match(/label:(HOLD|PRESS)/);
        if (!m) continue;
        seen[m[1]][q.a]++;
        if (per[m[1]] && per[m[1]] !== q.a) consistent = false; // one meaning per word within an edition
        per[m[1]] = q.a;
      }
      for (const w of Object.keys(per)) editions[w].add(per[w]);
      const says = { sum: /two seconds digits of the timer add up to the strip number/, any: /either seconds digit of the timer is the strip number/, last: /last digit of the timer matches the strip/ };
      found[R.rel] = true;
      if (!says[R.rel].test(pg) || Object.keys(says).some((k) => k !== R.rel && says[k].test(pg))) relBad = true;
    }
    const inv = (seen.HOLD.tap + seen.PRESS.hold) / (seen.HOLD.tap + seen.HOLD.hold + seen.PRESS.tap + seen.PRESS.hold);
    assert(consistent, 'within one edition HOLD (and PRESS) always means the same thing');
    assert(['HOLD', 'PRESS'].every((w) => editions[w].has('tap') && editions[w].has('hold')), `HOLD and PRESS each say tap in some editions and hold in others (HOLD ${JSON.stringify(seen.HOLD)}, PRESS ${JSON.stringify(seen.PRESS)})`);
    assert(inv > 0.55 && inv < 0.85, `about 70% of the HOLD/PRESS rules are inverted (${(inv * 100).toFixed(0)}%)`);
    assert(!relBad, 'the page spells out exactly which release rule applies');
    assert(Object.values(found).every(Boolean), 'level 3 buttons show all three release rules');
  }
  {
    // read aloud: the right article, number words for counts, "A, B and C" lists
    let bad = '';
    for (const t of Object.keys(TIERS)) for (let i = 0; i < 300 && !bad; i++) for (const id of Object.keys(MODS)) {
      const T = TIERS[t];
      const { M, R } = build(id, 'a' + i, T);
      const pg = text(M.page(R, T));
      const m = pg.match(/\b(a|an) ([A-Za-z0-9]+)/g) || [];
      for (const x of m) {
        const [art, w] = x.split(' ');
        const vowelSound = /^(RJ|[aeiouAEIOU])/.test(w) && !/^(one|once|use)/i.test(w);
        if ((art === 'an') !== vowelSound) bad = `"${x}" in ${id}/${t}`;
      }
      if (/\b\d+ or more batter/.test(pg)) bad = `digit count in ${id}/${t}`;
      if (/lamp/i.test(pg)) bad = `"lamp" for an indicator in ${id}/${t}`;
      if (/\b[A-F] and [A-F] and [A-F]/.test(pg)) bad = `column list in ${id}/${t}`;
    }
    assert(!bad, `wording: articles, number words, no "lamp" for indicators, "B, C and D" ${bad}`);
    const W = text(KEYPAD.page(KEYPAD.rules(stream('wording', 'rules', 'keypad'), TIERS.wild), TIERS.wild));
    assert(/columns? [A-F](, [A-F])* and [A-F] the other way|column [A-F] the other way/.test(W), 'reversed columns are listed as "B, C and D"');
    assert(/an RJ45 port/.test(atomPorts()) && !/a RJ45/.test(atomPorts()), 'a port reads "an RJ45 port"');
    function atomPorts() {
      let all = '';
      for (let i = 0; i < 400; i++) for (const t of ['normal', 'wild']) {
        const W2 = WIRES.rules(stream('pt' + i, 'rules', 'wires'), TIERS[t]);
        const B2 = BUTTON.rules(stream('pt' + i, 'rules', 'button'), TIERS[t]);
        all += Object.values(W2.lists).flat().map((q) => q.t).join(' ') + B2.rules.map((q) => q.t).join(' ');
      }
      return all;
    }
    const kp = KEYPAD.mount ? KEYPAD : null;
    void kp;
  }
  {
    // keypad: reversed columns are named in the text and marked on the column
    let ok = true;
    for (let i = 0; i < 100; i++) {
      const R = KEYPAD.rules(stream('k' + i, 'rules', 'keypad'), TIERS.wild);
      const html = KEYPAD.page(R, TIERS.wild);
      const names = R.names.split('').filter((_, j) => R.up[j]);
      const pg = text(html);
      if (!names.length || !pg.includes('bottom to top') || !names.every((nm) => pg.includes(nm))) ok = false;
      if ([...html.matchAll(/data-dir="up"/g)].length !== names.length) ok = false;
      if (!html.includes('dx-kp-six')) ok = false;
    }
    assert(ok, 'wild keypad: reversed columns are stated on the page and marked per column');
  }

  // ── errata ──
  for (const id of ['wires', 'button']) {
    let nulls = 0; let changed = 0; let noteOk = 0; let total = 0; let valid = true;
    for (const t of ['normal', 'spicy', 'wild']) {
      for (let i = 0; i < 400; i++) {
        const seed = 'e' + i;
        const T = TIERS[t];
        const M = MODS[id];
        const R = M.rules(stream(seed, 'rules', id), T);
        const e = M.errata(stream(seed, 'errata', id), R, T);
        if (!e) { nulls++; continue; }
        total++;
        const E = edgework(seed, T);
        const S = M.gen(stream(seed, 'gen', id), E, e.R, T);
        const a1 = M.solve(S, E, R, T);
        const a2 = M.solve(S, E, e.R, T);
        if (id === 'wires') { if (!(a2.wire >= 0 && a2.wire < S.w.length)) valid = false; if (a1.wire !== a2.wire) changed++; } else { if (!(a2.act === 'tap' || a2.act === 'hold')) valid = false; if (a1.act !== a2.act || a1.digit !== a2.digit) changed++; }
        // exactly one rule (or one strip digit) differs, and the note names it
        let diffs = 0; let note = false;
        if (id === 'wires') {
          for (const n of [3, 4, 5, 6]) R.lists[n].forEach((q, j) => {
            const q2 = e.R.lists[n][j];
            if (q.a !== q2.a) {
              diffs++;
              const word = (x) => (x.startsWith('nth:') ? ORD[+x.slice(4) - 1] : x.startsWith('end') ? 'last' : x.split(':')[0]);
              note = e.note.includes(`Correction to Wires, ${NUMW[n]} wires, rule ${j + 1}:`) && e.note.includes(`<b>${word(q2.a)}</b>`) && e.note.includes(`, not the ${word(q.a)}.`) && q2.t === e.R.lists[n][j].t && !!q2.t;
            }
            if (q.c !== q2.c) diffs += 10;
          });
        } else {
          R.rules.forEach((q, j) => { if (q.a !== e.R.rules[j].a) { diffs++; note = e.note.includes(`rule ${j + 1}`) && e.note.includes(`<b>${e.R.rules[j].a}</b>`); } });
          for (const c of Object.keys(R.strip)) if (R.strip[c] !== e.R.strip[c]) { diffs++; note = e.note.includes(c) && e.note.includes(`<b>${e.R.strip[c]}</b>`) && e.note.includes(`not ${R.strip[c]}`); }
          if (new Set(Object.values(e.R.strip)).size !== 4) valid = false;
        }
        if (diffs === 1 && note) noteOk++;
      }
    }
    assert(total > 0 && valid, `${id} errata: changed rules stay valid (${total} errata drawn, ${nulls} null)`);
    assert(changed > 0, `${id} errata: changes the answer on some seeds (${changed} of ${total})`);
    assert(noteOk === total, `${id} errata: one rule differs and the note names it (${noteOk}/${total})`);
  }

  // ── drive hooks name real controls ──
  {
    let ok = true;
    for (let i = 0; i < 50; i++) for (const t of ['classic', 'wild']) {
      const T = TIERS[t];
      for (const id of Object.keys(MODS)) {
        const { M, S, E, R } = build(id, 'd' + i, T);
        const d = M.drive(S, E, R, { strikes: i % 3 });
        if (!d.length || d.some((x) => !x.sel || !['tap', 'click', 'hold'].includes(x.act))) ok = false;
        if (id === 'button' && d[0].act === 'hold' && !/^(digit|sum|any):\d$/.test(d[0].until)) ok = false;
        if (id === 'sequence' && d.length !== (T.stages * (T.stages + 1)) / 2) ok = false;
      }
    }
    assert(ok, 'drive() lists the DOM actions that solve each module');
  }
}
