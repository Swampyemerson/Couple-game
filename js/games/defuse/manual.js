// Defuse: the field guide, as HTML strings built from a round. Pure (no DOM), so node can build and parse it in tests.
// The manual device renders exactly this; the bomb holder never sees any of it.
import { esc, fmt } from './util.js';
import { BY_ID, DECOY_RULES, SURGE_SECS, GOLD_BONUS, BLACKOUT, TAX_SECS } from './round.js';

/**
 * The guide's page order and numbers. Pages follow the bomb: one per distinct module type, in the order its first module appears on
 * the bomb, and its number is that module's number on the bomb (the "3 · Maze" tag), so "Module 3" means the same thing on both screens.
 * A twin pair is listed once, under the number of its first module. Returns [{ id, n, idx: [slot indexes], p: page number }].
 */
export function orderOf(round) {
  const seen = new Map();
  round.slots.forEach((s, i) => { if (!seen.has(s.id)) seen.set(s.id, []); seen.get(s.id).push(i); });
  return [...seen].map(([id, idx], k) => ({ id, idx, n: idx[0] + 1, p: k + 2 }));
}

/** Tabs, in guide order: basics first, then one per distinct module type. big = the plate number (or "x2" for a twin pair, or the module number when the bomb has no plates). n = the module's number on the bomb. */
export function tabsOf(round) {
  const plated = round.T.twists > 0;
  const tabs = [{ id: 'basics', big: '0', n: 0, sm: 'Basics', gold: false, twin: false }];
  for (const o of orderOf(round)) {
    const twin = o.idx.length > 1;
    tabs.push({ id: o.id, n: o.n, big: twin ? 'x2' : plated ? String(round.slots[o.idx[0]].plate) : String(o.n), sm: BY_ID[o.id].tab || BY_ID[o.id].name, gold: o.idx.includes(round.gold), twin });
  }
  return tabs;
}

function bomb(round) {
  const { T, twistRules: X } = round;
  const items = [];
  if (X.decoy) items.push(`<li data-twist="decoy" data-decoy-rule="${X.decoy.rule}"><span><b>Twin modules.</b> One kind of module appears twice, and only one of the pair is live. Ask your partner for both plate numbers. ${DECOY_RULES[X.decoy.rule]} Touching the other one is a strike.</span></li>`);
  if (X.void) items.push('<li data-twist="void"><span><b>VOID stickers.</b> Ignore any serial number or indicator that is stamped VOID. Only the unmarked ones count.</span></li>');
  if (X.errata) items.push('<li data-twist="errata"><span><b>Correction slip.</b> One page of this guide has a slip taped to the top. Where the slip and the printed page disagree, the slip wins.</span></li>');
  if (X.surge) items.push(`<li data-twist="surge"><span><b>Surge.</b> Twice, the clock runs at <b>double speed</b> for ${SURGE_SECS} seconds. A SURGE sign shows on both screens.</span></li>`);
  if (X.blackout) items.push(`<li data-twist="blackout"><span><b>Blackout.</b> ${X.blackout.at.length > 1 ? 'Twice' : 'Once'}, the bomb goes dark. It warns for ${BLACKOUT.warn} seconds, then nothing can be touched for ${BLACKOUT.dur} seconds. The clock keeps running, so plan your next move while it is dark.</span></li>`);
  if (X.tax) items.push(`<li data-twist="tax"><span><b>Strike tax.</b> Every strike takes ${TAX_SECS} seconds off the clock. The clock does not speed up.</span></li>`);
  if (X.relay) items.push('<li data-twist="relay"><span><b>Role swap.</b> The Relay module is the other way round. Its controls are on <b>your</b> screen, in the Relay box at the bottom. Your partner holds its rule card. See the Relay page.</span></li>');
  if (X.vent) items.push('<li data-twist="vent"><span><b>Vent.</b> The Vent wakes up now and then with a question. A <b>VENT</b> sign lights in the top bar when it does: tell your partner straight away. See the Vent page. It is never finished and does not count as a module.</span></li>');
  if (round.gold >= 0) items.push(`<li data-twist="gold"><span><b>Gold module.</b> One module has a gold plate (it is marked gold in your tabs too). Solve it without a single strike on it and the bomb gives you <b>${GOLD_BONUS} extra seconds</b>.</span></li>`);
  return `<div class="dx-thisbomb" data-this-bomb>
    <h4>This bomb</h4>
    <p class="dx-bomb-head" data-edition="${esc(round.edition)}"><b>${esc(round.name)}</b> · ${esc(T.label)} · ${fmt(T.secs * 1000)} · ${esc(round.edition)}</p>
    ${items.length ? `<ol class="dx-rules">${items.join('')}</ol>` : '<p>Nothing unusual on this bomb. Every module counts.</p>'}
    <p>Check that your partner reads out the same name (<b>${esc(round.name)}</b>) from the serial sticker. If not, you are reading the wrong guide.</p>
  </div>`;
}

export function basicsHTML(round) {
  const { T, E, twistRules: X } = round;
  const plated = T.twists > 0;
  const strike = X.tax ? `Each strike also takes ${TAX_SECS} seconds off the clock.` : 'Each strike makes the clock run faster.';
  return `<p class="dx-intro">You can’t see the bomb. Ask your partner what’s on it, find the rule here, and tell them what to do.</p>
    ${bomb(round)}
    <h4>On the case</h4>
    <ol class="dx-rules">
      <li><span>The <b>serial number</b> is on the sticker. Its last character is always a digit.</span></li>
      <li><span>The <b>battery bay</b> holds zero to four batteries. Count every one.</span></li>
      <li><span><b>Indicators</b> are small lights with a three-letter label. An indicator counts as lit only when its light is on.</span></li>
      ${E.portPlate ? '<li data-basics="ports"><span>The <b>port plate</b> shows zero to three ports, each named: DVI, PS2, RJ45 or SERIAL. A port counts only if it is on the plate.</span></li>' : ''}
      ${plated ? '<li data-basics="plates"><span>Every module has a three-digit <b>plate number</b> in its corner. Your tabs are labelled with them.</span></li>' : ''}
      <li><span>Every module has a light in its corner. It turns green when that module is done.</span></li>
    </ol>
    <h4>Strikes</h4>
    <p>A wrong cut or press is a strike. ${strike} The third strike sets the bomb off.</p>
    <p class="dx-note">${T.id === 'classic' ? 'The four modules can be done in any order. All four done: the bomb is safe.' : 'Modules can be done in any order. Every real module done: the bomb is safe.'}</p>`;
}

// Only the pages that really are a list of rules to try in order get the "stop at the first" reminder; step-by-step pages say so; the rest say nothing.
const FOOT = { wires: 'Read every rule in order. Stop at the first that applies.', button: 'Read every rule in order. Stop at the first that applies.', maze: 'Work through the steps in order.', password: 'Work through the steps in order.', morse: 'Work through the steps in order.', switches: 'Work through the steps in order.', relay: 'Work through the steps in order.' };
function section(id, n, title, body, p, round, tag, foot) {
  return `<section class="dx-sec" data-page="${id}" data-n="${n}"><div class="dx-run"><span>Defusal field guide · ${esc(round.edition)}</span><span>${esc(tag)}</span></div><h3><span class="n">${n}</span>${title}</h3>${body}<p class="dx-foot"><span>${esc(foot || '')}</span><span>p. ${p}</span></p></section>`;
}
export function pageHTML(round, id) {
  if (id === 'basics') return section('basics', '0', 'Reading the bomb', basicsHTML(round), 1, round, 'Start here');
  const o = orderOf(round).find((x) => x.id === id);
  const n = o.n;
  const b = round.book[id];
  const p = BY_ID[id];
  let body = p.page(b.R0, round.T);
  if (id === 'relay') body = body.replace('<div class="dx-relay-panel"></div>', '<p><button type="button" class="dx-openrelay" data-act="relay-open">Open the relay box</button></p>');
  const slip = b.note ? `<aside class="dx-slip" data-slip="${id}"><b class="dx-slip-tag">Correction slip</b>${b.note}</aside>` : '';
  const plate = round.T.twists > 0 && o.idx.length === 1 ? ` · plate ${round.slots[o.idx[0]].plate}` : '';
  const tag = o.idx.length > 1 ? `Modules ${o.idx.map((i) => i + 1).join(' and ')}` : 'Module ' + n + plate;
  return section(id, String(n), esc(p.name), slip + body, o.p, round, tag, FOOT[id]);
}
export function guideHTML(round) {
  return [pageHTML(round, 'basics'), ...orderOf(round).map((o) => pageHTML(round, o.id))].join('');
}
