// Overlay cards for Blend & Seek: pure HTML builders (state in, markup out).
import { esc, fmtTime } from './util.js';
import { MAPS } from './maps.js';
import { SIZES, OPTIONS, PRESET_LABEL, PRESET_SUB, fmtRule, timeScale, hideScale, effSeconds } from './rules.js';

const nameSpan = (api, w) => `<b class="chm-name-${w}">${esc(api.name(w))}</b>`;

export function loadingCard(text, pct) {
  return `<div class="chm-over solid"><div class="chm-card chm-sticker" role="status">
    <div class="chm-title"><span class="c1">Blend</span><span class="c2">&amp;</span><span class="c3">Seek</span></div>
    <div class="chm-drops" aria-hidden="true"><i></i><i></i><i></i></div>
    <p>${esc(text)}</p>
    <div class="chm-bar"><i style="width:${Math.round(pct * 100)}%"></i></div>
  </div></div>`;
}

export function errorCard(msg) {
  return `<div class="chm-over solid"><div class="chm-card chm-sticker" role="alert">
    <h2>Paint’s dried up</h2>
    <p>${esc(msg)}</p>
    <p>Check your connection, then close the game and open it again.</p>
  </div></div>`;
}

// ── lobby ──────────────────────────────────────────────────────────────
const SIZE_DOT = { tiny: 9, small: 12, medium: 15, large: 19, huge: 24 };

/** A tiny floor plan of a map from its rooms (SVG, riso print): each floor is a panel, rooms are
 *  overprinted in the three ink tints (slightly mis-registered, like a riso pass), with a key-plate
 *  ink outline in screen pixels. One-room dioramas get a halftone floor and a dashed open front. */
const PLAN_INKS = ['a', 'hl', 'b'];
export function mapPlan(m) {
  const inf = (m && m.info) || {};
  const rooms = Array.isArray(inf.rooms) && inf.rooms.length ? inf.rooms : [{ x0: -(inf.w || 10) / 2, z0: -(inf.d || 8) / 2, x1: (inf.w || 10) / 2, z1: (inf.d || 8) / 2, floor: 0 }];
  let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity;
  for (const r of rooms) { x0 = Math.min(x0, r.x0, r.x1); x1 = Math.max(x1, r.x0, r.x1); z0 = Math.min(z0, r.z0, r.z1); z1 = Math.max(z1, r.z0, r.z1); }
  const floors = Math.max(1, ...rooms.map((r) => (r.floor || 0) + 1));
  const W = x1 - x0; const D = z1 - z0; const pad = Math.max(W, D) * 0.07;
  const gap = W * 0.14;
  const vbW = W * floors + gap * (floors - 1) + pad * 2; const vbH = D + pad * 2;
  const reg = Math.max(vbW, vbH) * 0.022; // mis-registration of the colour pass
  const n = (v) => v.toFixed(2);
  const box = (r, dx = 0, dy = 0) => { const f = r.floor || 0; const ox = pad + f * (W + gap) - x0; return `x="${n(Math.min(r.x0, r.x1) + ox + dx)}" y="${n(Math.min(r.z0, r.z1) + pad - z0 + dy)}" width="${n(Math.abs(r.x1 - r.x0))}" height="${n(Math.abs(r.z1 - r.z0))}"`; };
  const one = rooms.length === 1;
  // halftone screen (dot rows; round-capped zero-length dashes, no <pattern> ids to collide)
  const halftone = (x, y, w, h) => {
    const sp = Math.min(w, h) / 6.5; let d = '';
    for (let k = 0, yy = y + sp * 0.6; yy < y + h - sp * 0.3; k++, yy += sp * 0.87) d += `M${n(x + sp * (k % 2 ? 1.1 : 0.6))} ${n(yy)}H${n(x + w - sp * 0.3)}`;
    return `<path class="pht" d="${d}" style="stroke-width:${n(sp * 0.42)};stroke-dasharray:0 ${n(sp)}"/>`;
  };
  // colour pass: big rooms first so small ones print on top
  const order = rooms.map((r, i) => ({ r, i, a: Math.abs((r.x1 - r.x0) * (r.z1 - r.z0)) })).sort((p, q) => q.a - p.a);
  const fills = one
    ? `<rect class="pf ${PLAN_INKS[(MAPS.indexOf(m) + 1) % 3]}" ${box(rooms[0], reg, reg)}/>${halftone(pad + reg, pad + reg, W, D)}`
    : order.map(({ r, i }) => `<rect class="pf ${PLAN_INKS[i % 3]}" ${box(r, reg, reg)}/>`).join('');
  const panels = [];
  for (let f = 0; f < floors; f++) panels.push(`<rect class="pp" x="${n(pad + f * (W + gap))}" y="${n(pad)}" width="${n(W)}" height="${n(D)}"/>`);
  const ink = rooms.map((r) => `<rect class="pk" ${box(r)}/>`).join('');
  // a one-room diorama is open at the front (low wall): print that edge dashed
  const front = one ? `<path class="pfr" d="M${n(pad)} ${n(pad + D)}h${n(W)}"/>` : '';
  return `<svg class="chm-plan${one ? ' one' : ''}${floors > 1 ? ' wide' : ''}" viewBox="0 0 ${n(vbW)} ${n(vbH)}" aria-hidden="true">${panels.join('')}${fills}${ink}${front}</svg>`;
}

export function mapFacts(m) {
  const inf = (m && m.info) || {};
  const floors = Array.isArray(inf.floors) && inf.floors.length ? inf.floors.length : 1;
  const area = inf.w && inf.d ? `${inf.w}×${inf.d} m` : '';
  const rooms = m.rooms || (inf.rooms ? inf.rooms.length : 1);
  const climbs = Math.max(1, Math.min(3, m.climbs || 1));
  return { area, rooms, floors, climbs };
}

function mapCard(api, setup, canEdit) {
  const i = Math.max(0, MAPS.findIndex((x) => x.id === setup.map));
  const m = MAPS[i] || MAPS[0];
  const prev = MAPS[(i - 1 + MAPS.length) % MAPS.length]; const next = MAPS[(i + 1) % MAPS.length];
  const f = mapFacts(m);
  const dots = [1, 2, 3].map((k) => `<i class="${k <= f.climbs ? 'on' : ''}"></i>`).join('');
  const dis = canEdit ? '' : 'disabled';
  return `<div class="chm-mapcard">
    ${MAPS.length > 1 ? `<button class="chm-arrow" data-lobby="map" data-v="${prev.id}" aria-label="Previous map" ${dis}>‹</button>` : ''}
    ${mapPlan(m)}
    <div class="chm-mapinfo"><b>${esc(m.name)}</b><small>${esc(m.blurb || '')}</small>
      <span class="chm-facts">${f.area ? `<em class="ar">${f.area}</em>` : ''}<em>${f.rooms} room${f.rooms === 1 ? '' : 's'}</em>${f.floors > 1 ? `<em>${f.floors} floors</em>` : ''}<em class="chm-climbs" title="Climbing spots">Climbs <span>${dots}</span></em></span></div>
    ${MAPS.length > 1 ? `<button class="chm-arrow" data-lobby="map" data-v="${next.id}" aria-label="Next map" ${dis}>›</button>` : ''}
  </div>`;
}

function sizeSeg(rules, canEdit) {
  const dis = canEdit ? '' : 'disabled';
  return `<div class="chm-sizes" role="radiogroup" aria-label="Chameleon size">${SIZES.map((z) => `<button class="${rules.size === z.id ? 'on' : ''}" data-lobby="rule" data-k="size" data-v="${z.id}" role="radio" aria-checked="${rules.size === z.id}" ${dis}><i style="width:${SIZE_DOT[z.id]}px;height:${Math.round(SIZE_DOT[z.id] * 0.62)}px"></i>${z.label}</button>`).join('')}</div>`;
}

function presetSeg(rules, canEdit) {
  const dis = canEdit ? '' : 'disabled';
  const cur = rules.preset || 'custom';
  return `<div class="chm-presets" role="radiogroup" aria-label="Preset">${['easy', 'classic', 'hard', 'custom'].map((id) => `<button class="${cur === id ? 'on' : ''} ${id === 'custom' ? 'custom' : ''}" ${id === 'custom' ? 'tabindex="-1" data-lobby="custom"' : `data-lobby="preset" data-v="${id}"`} role="radio" aria-checked="${cur === id}" ${dis}><b>${PRESET_LABEL[id]}</b><small>${PRESET_SUB[id]}</small></button>`).join('')}</div>`;
}

export function lobbyCard(api, { canEdit, local, setup, waitingFor, sheet, bests = '', wardrobe = '', music = 'on' }) {
  const mode = setup.mode; const first = setup.first; const rules = setup.rules;
  const dis = canEdit ? '' : 'data-ro="1"';
  const card = `<div class="chm-over chm-lobby bottom${sheet ? ' sheet-open' : ''}"><div class="chm-card chm-sticker" ${dis}>
    <div class="chm-col">
    <div class="chm-title"><span class="c1">Blend</span><span class="c2">&amp;</span><span class="c3">Seek</span></div>
    <p class="chm-tag">Paint yourself to vanish into the room. Then hunt.</p>
    <div class="chm-modes" role="radiogroup" aria-label="Mode">
      <button class="chm-mode ${mode === 'hs' ? 'on' : ''}" data-lobby="mode" data-v="hs" role="radio" aria-checked="${mode === 'hs'}"><b>Hide &amp; Seek</b><small>One hides, one hunts. ${rules.rounds} rounds, swap roles.</small></button>
      <button class="chm-mode ${mode === 'db' ? 'on' : ''}" data-lobby="mode" data-v="db" role="radio" aria-checked="${mode === 'db'}" ${local ? 'disabled' : ''}><b>Double Blind</b><small>${local ? 'Needs two phones.' : 'Both hide, then both hunt. Best of 3.'}</small></button>
    </div>
    ${presetSeg(rules, canEdit)}
    </div><div class="chm-col">
    ${mapCard(api, setup, canEdit)}
    ${bests}
    <div class="chm-lrow"><h3>Chameleon size</h3>${sizeSeg(rules, canEdit)}</div>
    ${mode === 'hs' ? `<div class="chm-lrow chm-firstrow"><h3>Hides first</h3><div class="chm-chips">${['a', 'b'].map((w) => `<button class="chm-chip p${w} ${first === w ? 'on' : ''}" data-lobby="first" data-v="${w}"><i></i>${esc(api.name(w))}</button>`).join('')}</div></div>` : ''}
    <div class="chm-lbtns">
      <button class="chm-more" data-act="settings" aria-haspopup="dialog">${GEAR}<span>${canEdit ? 'Settings' : 'See settings'}</span></button>
      <button class="chm-more chm-wardbtn" data-act="wardrobe" aria-haspopup="dialog" aria-label="Wardrobe">${HANGER}</button>
      ${canEdit ? '<button class="chm-go me" data-act="start">Start</button>' : `<p class="chm-wait">${nameSpan(api, waitingFor)} is setting up…</p>`}
    </div>
  </div></div></div>`;
  return card + (sheet ? settingsSheet(api, { canEdit, local, setup, waitingFor, music }) : '') + (wardrobe || '');
}

const HANGER = '<svg class="chm-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a2 2 0 00-2 2c0 1.2 1 1.6 2 2.4v1.6"/><path d="M12 10l8.5 6.2a1 1 0 01-.6 1.8H4.1a1 1 0 01-.6-1.8z"/></svg>';
const GEAR = '<svg class="chm-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>';

function stepper(rules, k, canEdit) {
  const opts = OPTIONS[k]; const i = opts.indexOf(rules[k]);
  const dis = canEdit ? '' : 'disabled';
  return `<div class="chm-step"><button data-lobby="rule" data-k="${k}" data-step="-1" aria-label="Less" ${i <= 0 || !canEdit ? 'disabled' : ''}>−</button><output data-rule="${k}">${esc(fmtRule(k, rules[k]))}</output><button data-lobby="rule" data-k="${k}" data-step="1" aria-label="More" ${i >= opts.length - 1 || !canEdit ? 'disabled' : ''}>+</button></div>${dis ? '' : ''}`;
}
function seg(rules, k, items, canEdit) {
  const dis = canEdit ? '' : 'disabled';
  return `<div class="chm-seg2" role="radiogroup">${items.map(([v, label]) => `<button class="${String(rules[k]) === String(v) ? 'on' : ''}" data-lobby="rule" data-k="${k}" data-v="${v}" role="radio" aria-checked="${String(rules[k]) === String(v)}" ${dis}>${label}</button>`).join('')}</div>`;
}
/** "1:30 on CU Boulder" when the map stretches the clock. */
function effHint(setup, k) {
  const m = MAPS.find((x) => x.id === setup.map); const sc = k === 'seek' ? timeScale(m) : hideScale(m);
  if (sc === 1 || !setup.rules[k]) return '';
  return `<span data-eff="${k}">${esc(fmtRule(k, effSeconds(setup.rules[k], sc)))} on ${esc(m.name)} (big map ×${sc})</span>`;
}
/** A long time range: a slider for big jumps plus the − / + stepper for fine steps. The slider
 *  previews while dragging and commits on release (so the host's sheet isn't rebuilt mid-drag). */
function timeRow(label, hint, rules, k, canEdit, off = false) {
  const opts = OPTIONS[k]; const i = Math.max(0, opts.indexOf(rules[k]));
  const ed = canEdit && !off;
  return `<div class="chm-set chm-set-time${off ? ' off' : ''}"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span>${stepper(rules, k, ed)}<input type="range" class="chm-range" data-range="${k}" min="0" max="${opts.length - 1}" step="1" value="${i}" aria-label="${label}" ${ed ? '' : 'disabled'}></div>`;
}
const row = (label, hint, control) => `<div class="chm-set"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span>${control}</div>`;

/** The full settings sheet: host edits, the guest watches it change live. */
export function settingsSheet(api, { canEdit, local, setup, waitingFor, music = 'on' }) {
  const r = setup.rules; const hs = setup.mode === 'hs';
  const musicSeg = `<div class="chm-seg2" role="radiogroup">${[['on', 'On'], ['hunt', 'Hunt only'], ['off', 'Off']].map(([v, label]) => `<button class="${music === v ? 'on' : ''}" data-music="${v}" role="radio" aria-checked="${music === v}">${label}</button>`).join('')}</div>`;
  return `<div class="chm-sheetwrap" role="dialog" aria-label="Game settings"><div class="chm-sheet chm-sticker" data-scroll>
    <div class="chm-sheethead"><h2>Game settings</h2><button class="chm-done" data-act="settings">Done</button></div>
    ${canEdit ? '' : `<p class="chm-wait">${nameSpan(api, waitingFor)} is choosing. You’ll see every change here.</p>`}
    ${presetSeg(r, canEdit)}
    <h3>Diorama</h3>
    ${mapCard(api, setup, canEdit)}
    <div class="chm-chips chm-mapchips">${MAPS.map((m) => `<button class="chm-chip ${setup.map === m.id ? 'on' : ''}" data-lobby="map" data-v="${m.id}" ${canEdit ? '' : 'disabled'}>${esc(m.name)}</button>`).join('')}</div>
    <h3>Round</h3>
    <div class="chm-sets">
    ${row('Chameleon size', 'Bigger is easier to spot', sizeSeg(r, canEdit))}
    ${hs ? row('Rounds', 'Each of you hides half of them', stepper(r, 'rounds', canEdit)) : ''}
    ${row('Paint pellets', hs ? 'Per hunt' : 'Each (one fewer in Double Blind)', stepper(r, 'pellets', canEdit))}
    ${row('Chirp scans', 'Per hunt', stepper(r, 'scans', canEdit))}
    ${row('Scan cooldown', '', stepper(r, 'scanCd', canEdit))}
    ${row('Escapes', 'Scurries or tongue-zips while hunted', stepper(r, 'escapes', canEdit))}
    ${row('Seeker speed', '', seg(r, 'seekSpeed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']], canEdit))}
    ${hs ? row('Seeker scores', r.seekScore === 'off' ? 'Only the hider scores (1 pt per second hidden)' : r.seekScore === 'time' ? '½ pt per second left on the clock when they tag' : '½ pt per second left, +10 per unused pellet', seg(r, 'seekScore', [['off', 'Off'], ['time', 'Time left'], ['full', 'Time + pellets']], canEdit)) : ''}
    ${hs ? row('Seeker wager', r.wager ? `Blindfolded, the seeker calls floor, furniture, wall or ceiling: +${r.wager} if right` : 'No call during the hide', seg(r, 'wager', [[0, 'Off'], [5, '+5'], [10, '+10']], canEdit)) : ''}
    </div>
    <h3>Timing</h3>
    <div class="chm-sets">
    ${row('Hide ends', r.hideEnd === 'ready' ? 'No clock: the hunt starts when the hider taps Ready' : 'When the clock runs out, or early on Ready', seg(r, 'hideEnd', [['timer', 'Timer'], ['ready', 'On Ready']], canEdit))}
    ${timeRow('Hide time', r.hideEnd === 'ready' ? 'No limit while “On Ready”' : effHint(setup, 'hide'), r, 'hide', canEdit, r.hideEnd === 'ready')}
    ${row('Countdown', 'Before the hunt starts', seg(r, 'countdown', [[0, 'Off'], [3, '3 s'], [5, '5 s'], [10, '10 s']], canEdit))}
    ${hs ? row('Head start', effHint(setup, 'headStart') || 'Seeker stays blindfolded, the hider can still move', stepper(r, 'headStart', canEdit)) : ''}
    ${row('Grace period', 'The seeker can’t fire for the first seconds', stepper(r, 'grace', canEdit))}
    ${timeRow('Seek time', effHint(setup, 'seek'), r, 'seek', canEdit)}
    </div>
    <h3>Rules</h3>
    <div class="chm-sets">
    ${row('Walls &amp; ceilings', 'Sticky feet, hanging, tongue-zip', seg(r, 'climb', [[true, 'Climb'], [false, 'Floor only']], canEdit))}
    ${hs ? row('Seeker can climb', r.climb ? 'Stick, crawl, zip, hang and squeeze too' : 'Needs walls &amp; ceilings', seg(r, 'seekClimb', [[true, 'On'], [false, 'Off']], canEdit && r.climb)) : ''}
    ${hs && r.climb && r.seekClimb ? row('Seeker climb speed', 'On walls and ceilings', seg(r, 'climbSpeed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']], canEdit)) : ''}
    ${row('Stamp tool', 'Copy the surface onto your skin', seg(r, 'stamp', [[true, 'Allowed'], [false, 'Off']], canEdit))}
    ${hs ? row('Blend bonus', 'Your paint job is scored against the surface behind you at the lock', seg(r, 'blendBonus', [[0, 'Off'], [10, '+10 at 80 %'], [20, '+20 at 90 %']], canEdit)) : ''}
    ${hs ? row('Paint while hunted', r.huntPaint === 'tell' ? 'Fresh paint glints for a seeker close by' : r.huntPaint === 'on' ? 'Repaint any time, silently' : 'Paint locks when the hunt starts', seg(r, 'huntPaint', [['off', 'Off'], ['on', 'On'], ['tell', 'Shows']], canEdit)) : ''}
    ${row('Eye-blink glints', 'Blinks sparkle for the seeker', seg(r, 'blink', [['off', 'Off'], ['on', 'On'], ['strong', 'Strong']], canEdit))}
    ${row('Heartbeat hint', 'Hider feels the seeker close by', seg(r, 'heartbeat', [[true, 'On'], [false, 'Off']], canEdit))}
    ${row('In-their-sights cue', 'Hider feels the seeker staring right at them', seg(r, 'sights', [[true, 'On'], [false, 'Off']], canEdit))}
    ${row('Music', 'This phone only: a soft pad while hiding, a pulse that quickens in the hunt', musicSeg)}
    ${row('Seeker minimap', 'On the bigger maps', seg(r, 'minimap', [[true, 'On'], [false, 'Off']], canEdit))}
    ${hs ? row('Hides first', '', `<div class="chm-chips">${['a', 'b'].map((w) => `<button class="chm-chip p${w} ${setup.first === w ? 'on' : ''}" data-lobby="first" data-v="${w}" ${canEdit ? '' : 'disabled'}><i></i>${esc(api.name(w))}</button>`).join('')}</div>`) : ''}
    </div>
    <button class="chm-go" data-act="settings">Done</button>
  </div></div>`;
}

/** First-time tips for the v2 movement (non-modal sticker). */
export function tipsHtml(mouse) {
  const k = (key, touch) => (mouse ? `<kbd>${key}</kbd>` : `<b>${touch}</b>`);
  // 'Got it' sits in the header row: a bottom row pushed the card down over the hider's I'm-hidden pill on phones
  return `<div class="chm-tiphead"><div class="chm-kicker">New moves</div><button class="chm-go" data-act="tips-ok">Got it</button></div>
    <ul>
      <li><span class="chm-ti t1"></span><p>${k('E', 'Stick')} to grab a wall — or just walk into one. Crawl up onto the ceiling.</p></li>
      <li><span class="chm-ti t2"></span><p>On a ceiling, pick <b>Hang</b> to dangle. On a rail or pole, <b>Perch</b>.</p></li>
      <li><span class="chm-ti t3"></span><p><b>Squeeze</b> slides you into gaps behind sofas and under beds.</p></li>
      <li><span class="chm-ti t4"></span><p>${k('Z', 'Zip')} tongue-zips to the surface you’re looking at. ${k('Space', 'Jump')} on a wall leaps off.</p></li>
    </ul>`;
}

export const SURF_HEAD = {
  ceiling: (n) => `${n} was on the CEILING`,
  under: (n) => `${n} was UPSIDE DOWN under there`,
  hang: (n) => `${n} was HANGING right under there`,
  hangHigh: (n) => `${n} was HANGING from the CEILING`,
  wall: (n) => `${n} was UP the WALL`,
  flat: (n) => `${n} was flat on the WALL`,
  perch: (n) => `${n} was PERCHED up there`,
  squeeze: (n) => `${n} SQUEEZED into a gap`,
  corner: (n) => `${n} was wedged in the CORNER`,
};
export const SURF_SHORT = { ceiling: 'on the ceiling', under: 'upside down', hang: 'hanging', hangHigh: 'hanging from the ceiling', wall: 'up the wall', flat: 'on the wall', perch: 'perched', squeeze: 'squeezed in a gap', corner: 'in the corner' };

export function titleCard(api, { round, rounds, mode, hider, youHide, youSeek, map }) {
  const m = MAPS.find((x) => x.id === map);
  const line = mode === 'db'
    ? 'Both of you hide. Then hunt each other — slowly.'
    : `${nameSpan(api, hider)} hides · ${nameSpan(api, api.other(hider))} seeks`;
  const you = mode === 'db' ? 'Paint fast, pose, and don’t blink.' : youHide ? 'You hide. Find a spot, pose, then paint yourself to match.' : youSeek ? 'You seek. Eyes shut while they hide…' : '';
  return `<div class="chm-over dim veil chm-titlecard"><div class="chm-card chm-sticker">
    <div class="chm-kicker">Round ${round} of ${rounds} · ${esc(m ? m.name : '')}</div>
    <h2>${mode === 'db' ? 'Double Blind' : 'Hide &amp; Seek'}</h2>
    <p>${line}</p>
    ${you ? `<p>${you}</p>` : ''}
  </div></div>`;
}

export const CALLS = [['floor', 'Floor'], ['furniture', 'Furniture'], ['wall', 'Wall'], ['ceiling', 'Ceiling'], ['hang', 'Hanging']];
/** The seeker's wager chips: call where they're hiding before the hunt (+wager on a right call). */
export function callChips({ wager, call, climbs = 1, locked = false }) {
  if (!wager) return '';
  const list = CALLS.filter(([k]) => k !== 'hang' || climbs >= 2);
  return `<div class="chm-call"><h3>Call the hide · +${wager}</h3><div class="chm-chips">${list.map(([k, label]) => `<button class="chm-chip ${call === k ? 'on' : ''}" data-call="${k}" ${locked ? 'disabled' : ''}>${label}</button>`).join('')}</div></div>`;
}
export function blindCard(api, { hider, ms, pellets, mode, scanCd = 30, scans = 0, untimed = false, climb = false, wager = 0, call = null, climbs = 1, ticker = '' }) {
  return `<div class="chm-over chm-blind solid"><div class="chm-card chm-sticker">
    <div class="chm-kicker">Eyes shut</div>
    <div class="chm-big" data-live="blind-time">${fmtTime(ms)}</div>
    <div class="chm-drops" aria-hidden="true"><i></i><i></i><i></i></div>
    <p class="chm-ticker" data-live="ticker">${ticker || `${esc(api.name(hider))} is looking for a spot…`}</p>
    ${callChips({ wager, call, climbs })}
    <p>${nameSpan(api, hider)} is painting themselves to match the room.${untimed ? ' No clock this time: the hunt starts when they tap <b>Ready</b>.' : ''}</p>
    <p>You get <b>${pellets} paint pellets</b> and ${scans ? `<b>${scans} chirp scan${scans === 1 ? '' : 's'}</b>` : 'a <b>chirp scan</b>'} (every ${scanCd} s) that makes their eyes glint — even on the ceiling. Look up!${climb ? ' You can climb too: <b>Stick</b> to walls, crawl onto ceilings, <b>Zip</b> up.' : ''}${mode === 'hs' ? ' Every second they survive scores for them.' : ''}</p>
  </div></div>`;
}

/** The seeker's blindfold during the hider's head start (seek phase, before the hunt). */
export function headCard(api, { hider, ms }) {
  return `<div class="chm-over chm-blind solid" data-head="1"><div class="chm-card chm-sticker">
    <div class="chm-kicker">Blindfold on · head start</div>
    <div class="chm-big" data-live="head-time">${Math.max(1, Math.ceil(ms / 1000))}</div>
    <div class="chm-drops" aria-hidden="true"><i></i><i></i><i></i></div>
    <p>${nameSpan(api, hider)} can still move. Count down with them, then go!</p>
  </div></div>`;
}

export function curtainCard(api, { kind, who, wager = 0, call = null, climbs = 1 }) {
  const other = api.other(who);
  const kicker = kind === 'hide' ? `${esc(api.name(other))}, look away` : 'Hider, hand it over';
  const body = kind === 'hide'
    ? `Pass the phone to ${nameSpan(api, who)}. ${nameSpan(api, other)}, no peeking — they’re about to hide.`
    : `${nameSpan(api, other)} is hidden. Pass the phone to ${nameSpan(api, who)} to start the hunt.`;
  const btn = kind === 'hide' ? `I’m ${esc(api.name(who))} — let me hide` : `I’m ${esc(api.name(who))} — start the hunt`;
  return `<div class="chm-over solid" data-curtain="${kind}"><div class="chm-card chm-sticker">
    <div class="chm-kicker">${kicker}</div>
    <h2 class="chm-name-${who}">${esc(api.name(who))}</h2>
    <p>${body}</p>
    ${kind === 'seek' ? callChips({ wager, call, climbs }) : ''}
    <button class="chm-go" data-act="curtain">${btn}</button>
  </div></div>`;
}

export const EMOTES = [['lol', '😂', 'LOL'], ['how', '😤', 'HOW'], ['sneaky', '👀', 'Sneaky'], ['love', '❤️', ''], ['again', '🔁', 'Again!'], ['paint', '🎨', 'Nice!']];
export function emoteRow() {
  return `<div class="chm-emotes" role="group" aria-label="React">${EMOTES.map(([k, e, l]) => `<button class="chm-emote" data-emote="${k}" aria-label="${esc(l || k)}"><span>${e}</span>${l ? `<em>${esc(l)}</em>` : ''}</button>`).join('')}</div>`;
}
/** Grade word for a blend score (camo %). */
export const blendWord = (b) => (b >= 90 ? 'Ghost' : b >= 75 ? 'Sneaky' : b >= 50 ? 'Spotted' : 'Sore thumb');
export function recapCard(api, { rec, mode, scores, round, rounds, isLast, canNext, stats, lines = [], next = null, autoMs = 0, emotes = true }) {
  const hider = rec.hider;
  let head; let sub;
  if (mode === 'db') {
    if (rec.winner) { head = `${esc(api.name(rec.winner))} wins the round`; sub = `${esc(api.name(api.other(rec.winner)))} was RIGHT there.`; }
    else { head = 'Nobody found anybody'; sub = 'A void round. Sneaky.'; }
  } else if (rec.found) { head = rec.surf && SURF_HEAD[rec.surf] ? SURF_HEAD[rec.surf](esc(api.name(hider))) : `${esc(api.name(hider))} was RIGHT there`; sub = `Found after ${fmtTime(rec.ms)} · +${rec.points} for ${esc(api.name(hider))}${rec.seekPoints ? ` · +${rec.seekPoints} for ${esc(api.name(rec.seeker))}${rec.spare ? ` (${rec.spare} pellet${rec.spare === 1 ? '' : 's'} spare)` : ''}` : ''}`; }
  else { head = `${esc(api.name(hider))} survived!`; sub = `+${rec.points} points${rec.surf && SURF_SHORT[rec.surf] ? ` · ${SURF_SHORT[rec.surf]} the whole time` : ''}${rec.outOfPellets ? ` · the seeker ran dry at ${fmtTime(rec.ms)}` : ''}`; }
  if (mode !== 'db' && rec.blend != null && rec.blend >= 0) sub += ` · <b data-blend="${rec.blend}">Blend ${rec.blend}%</b> ${blendWord(rec.blend)}${rec.blendPts ? ` (+${rec.blendPts})` : ''}`;
  return `<div class="chm-over chm-recap bottom"><div class="chm-card chm-sticker">
    <div class="chm-kicker">Round ${round} of ${rounds}</div>
    <h2>${head}</h2>
    <p>${sub}</p>
    <div class="chm-stats">
      <div><b>${stats.closest == null ? '—' : stats.closest.toFixed(1) + ' m'}</b><span>Closest call</span></div>
      <div><b>${stats.passes}</b><span>Walk-pasts</span></div>
      <div><b>${stats.used}/${stats.max}</b><span>Pellets</span></div>
    </div>
    ${lines.length ? `<p class="chm-lines">${lines.map((l) => `<span>${l}</span>`).join('')}</p>` : ''}
    <div class="chm-tally"><span><i style="background:var(--p-a)"></i>${esc(api.name('a'))} ${scores.a}</span><span><i style="background:var(--p-b)"></i>${esc(api.name('b'))} ${scores.b}</span></div>
    ${emotes ? emoteRow() : ''}
    ${next ? `<p class="chm-nextline">Next: ${nameSpan(api, next.hider)} hides · ${nameSpan(api, api.other(next.hider))} seeks · ${esc(next.map)}</p>` : ''}
    ${canNext ? `<button class="chm-go me chm-ring" data-act="next" style="--k:1">${isLast ? 'See who won' : 'Next round'}<small data-live="recap-time">${autoMs ? Math.ceil(autoMs / 1000) : ''}</small></button>` : '<p class="chm-wait">Next round starts in a moment…</p>'}
  </div></div>`;
}

export function pauseCard(api, { reason, countdown }) {
  const r = reason === 'away' ? `Waiting for ${esc(api.name(api.other(api.me || 'a')))}…`
    : reason === 'hidden' ? 'Paused while the game was in the background.'
      : reason === 'stall' ? 'Connection hiccup — hang on…'
        : reason === 'ctx' ? 'The graphics took a nap.'
          : 'Paused';
  return `<div class="chm-over dim"><div class="chm-card chm-sticker" role="status">
    <div class="chm-kicker">Paused</div>
    ${countdown ? `<div class="chm-big" data-live="resume-count">3</div><p>Back in…</p>` : `<p>${r}</p>`}
  </div></div>`;
}

export function ctxCard() {
  return `<div class="chm-over dim"><div class="chm-card chm-sticker" role="status">
    <div class="chm-kicker">Paused</div>
    <h2>Tap to resume</h2>
    <p>The graphics needed a quick reset.</p>
    <button class="chm-go" data-act="ctxresume">Resume</button>
  </div></div>`;
}

/** The match's final card (before the hub's end card): a round timeline, best hide / fastest find,
 *  record stickers and a Continue button; either player's tap (or 12 s) hands over to the hub. */
/** 'Best hide tonight?': both players tap a round; a matching pick crowns it (a Creative hide on the wardrobe). */
function voteRow(api, { rounds, votes, crowned, local }) {
  if (!rounds || rounds.length < 2) return '';
  const pip = (r) => ['a', 'b'].filter((w) => votes[w] === r.round).map((w) => `<i class="chm-vpip p${w}" title="${esc(api.name(w))}"></i>`).join('');
  return `<div class="chm-vote"><h3>${crowned ? 'Best hide tonight' : local ? 'Best hide tonight? Pick one together' : 'Best hide tonight? You both pick'}</h3><div class="chm-chips">${rounds.map((r) => `<button class="chm-chip p${r.hider} ${crowned === r.round ? 'on crown' : ''}" data-vote="${r.round}" ${crowned ? 'disabled' : ''}><i></i>R${r.round} ${esc(api.name(r.hider))} ${fmtTime(r.ms | 0)}${pip(r)}</button>`).join('')}</div></div>`;
}
export function finalCard(api, { winner, a, b, mode, story, records = [], unlocks = [], firstNext = null, vote = null }) {
  const head = mode === 'db' ? (winner ? `${esc(api.name(winner))} wins ${a}–${b}` : 'Perfectly matched') : winner ? `${esc(api.name(winner))} blends best` : 'Perfectly matched';
  const sub = mode === 'db' ? 'Rounds won' : `${esc(api.name('a'))} ${a} · ${b} ${esc(api.name('b'))}`;
  const recs = records.map((r) => `<span>${esc(r.text)}</span>`).concat(unlocks.map((u) => `<span>Unlocked · ${esc(u)}</span>`));
  return `<div class="chm-over chm-final bottom"><div class="chm-card chm-sticker">
    <div class="chm-kicker">Final</div>
    <h2 class="${winner ? `chm-name-${winner}` : ''}">${head}</h2>
    <p>${sub}</p>
    ${story.bars ? `<div class="chm-tl">${story.bars}</div>` : ''}
    ${story.lines.length ? `<div class="chm-story">${story.lines.join('')}</div>` : ''}
    ${recs.length ? `<div class="chm-recs">${recs.join('')}</div>` : ''}
    ${vote ? voteRow(api, vote) : ''}
    ${emoteRow()}
    ${firstNext ? `<p class="chm-nextline">Rematch: ${nameSpan(api, firstNext)} hides first</p>` : ''}
    <button class="chm-go me" data-act="finish">See the board</button>
  </div></div>`;
}
