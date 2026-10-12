// Air Hockey's pre-match table picker. The host (or the one phone) chooses; the guest watches the
// choice change live. Printed chips with a little icon, a "Surprise me" chip, and a big GO.
import { TABLES, TABLE_ORDER } from './physics.js';

const S = (inner) => `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" focusable="false">${inner}</svg>`;
const TBL = '<rect x="7" y="3" width="18" height="26" rx="4" class="hk-i-card"/><path d="M7 16h18" class="hk-i-line"/>';
const ICONS = {
  classic: S(`${TBL}<circle cx="16" cy="16" r="4" class="hk-i-line"/><circle cx="16" cy="22" r="1.8" class="hk-i-ink"/>`),
  pillar: S(`${TBL}<circle cx="16" cy="16" r="4.6" class="hk-i-hl"/><circle cx="16" cy="16" r="1.6" class="hk-i-ink"/>`),
  twin: S(`${TBL}<circle cx="12.5" cy="12" r="2.6" class="hk-i-ink"/><circle cx="19.5" cy="20" r="2.6" class="hk-i-hl"/>`),
  shrink: S('<rect x="7" y="3" width="18" height="26" rx="4" class="hk-i-card"/><path d="M7 3h4.5M20.5 3H25" class="hk-i-b"/><path d="M7 29h7M18 29h7" class="hk-i-a"/><path d="M11.5 3h9" class="hk-i-slot"/><path d="M14 29h4" class="hk-i-slot"/><path d="M13 11l3 3 3-3M13 19l3-3 3 3" class="hk-i-line"/>'),
  power: S('<path d="M18.5 3L8 18h7l-2 11L24 13h-7z" class="hk-i-hl"/>'),
  quick: S('<circle cx="16" cy="17" r="11" class="hk-i-card"/><path d="M13 3h6M16 3v3" class="hk-i-line"/><text x="16" y="22" text-anchor="middle" class="hk-i-num">3</text>'),
  surprise: S('<rect x="5" y="5" width="22" height="22" rx="5" class="hk-i-hl"/><circle cx="11" cy="11" r="1.9" class="hk-i-ink"/><circle cx="16" cy="16" r="1.9" class="hk-i-ink"/><circle cx="21" cy="21" r="1.9" class="hk-i-ink"/><circle cx="21" cy="11" r="1.9" class="hk-i-ink"/><circle cx="11" cy="21" r="1.9" class="hk-i-ink"/>'),
};
const SURPRISE = { id: 'surprise', name: 'Surprise me', blurb: 'The table picks itself.' };

export const SETUP_CSS = `
  .g-hockey .hk-setup { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; padding: calc(var(--gm-corner-safe, 64px) - 8px) 12px calc(10px + env(safe-area-inset-bottom, 0px)); background: var(--g-dim); overflow-y: auto; touch-action: pan-y; }
  .g-hockey .hk-setup[hidden] { display: none; }
  .g-hockey .hk-card { width: min(100%, 460px); margin: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; background: var(--g-card); border: var(--g-stroke, 2px) solid var(--g-ink); border-radius: var(--g-radius, 10px); box-shadow: var(--g-shadow-lg, var(--g-shadow)); animation: hk-in .22s ease-out both; }
  .g-hockey .hk-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .g-hockey .hk-title { margin: 0; font: 900 1.25rem/1.1 var(--g-font-display); color: var(--g-ink); }
  .g-hockey .hk-who { margin: 0; font: 800 .8rem/1.2 var(--g-font-body); color: var(--g-muted); text-align: right; }
  .g-hockey .hk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .g-hockey .hk-chip { display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 6px 8px; text-align: left; cursor: pointer; font-family: var(--g-font-body); color: var(--g-ink); background: var(--g-bg); border: var(--g-stroke, 2px) solid var(--g-ink); border-radius: var(--g-radius-sm, 6px); box-shadow: var(--g-shadow-sm); touch-action: manipulation; -webkit-tap-highlight-color: transparent; transition: transform .08s, box-shadow .08s; }
  .g-hockey .hk-chip:active:not(:disabled) { transform: translate(2px, 2px); box-shadow: none; }
  .g-hockey .hk-chip:disabled { cursor: default; }
  .g-hockey .hk-chip.is-on { color: var(--g-on-ink, var(--g-ink)); background: var(--g-hl); box-shadow: var(--g-shadow); transform: translate(-1px, -1px); }
  .g-hockey .hk-chip svg { flex: none; }
  .g-hockey .hk-chip b { display: block; font-weight: 900; font-size: .86rem; line-height: 1.15; }
  .g-hockey .hk-chip small { display: block; font-weight: 600; font-size: .68rem; line-height: 1.2; color: var(--g-muted); }
  .g-hockey .hk-chip.is-on small { color: var(--g-on-ink, var(--g-ink)); }
  .g-hockey .hk-chip.is-wide { grid-column: 1 / -1; }
  .g-hockey .hk-recs { margin: 0; font: 700 .72rem/1.35 var(--g-font-body); color: var(--g-muted); }
  .g-hockey .hk-recs b { color: var(--g-ink); font-weight: 900; }
  .g-hockey .hk-go { width: 100%; }
  .g-hockey .hk-wait { margin: 0; min-height: 54px; display: flex; align-items: center; justify-content: center; font: 900 1rem/1.2 var(--g-font-display); color: var(--g-ink); background: var(--g-halftone) 0 0 / 5px 5px; border: var(--g-stroke, 2px) dashed var(--g-ink); border-radius: var(--g-radius-sm, 6px); text-align: center; padding: 6px 10px; }
  .g-hockey .hk-wait i { font-style: normal; animation: hk-blink 1.2s steps(2, jump-none) infinite; }
  .g-hockey .hk-i-card { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 2; }
  .g-hockey .hk-i-line { fill: none; stroke: var(--g-ink); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .g-hockey .hk-i-ink { fill: var(--g-ink); }
  .g-hockey .hk-i-hl { fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 2; stroke-linejoin: round; }
  .g-hockey .hk-i-a { fill: none; stroke: var(--p-a); stroke-width: 3; }
  .g-hockey .hk-i-b { fill: none; stroke: var(--p-b); stroke-width: 3; }
  .g-hockey .hk-i-slot { fill: none; stroke: var(--g-ink); stroke-width: 3; }
  .g-hockey .hk-i-num { fill: var(--g-ink); font: 400 15px var(--g-font-display); }
  @keyframes hk-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  @keyframes hk-blink { 50% { opacity: .25; } }
  @media (prefers-reduced-motion: reduce) { .g-hockey .hk-card, .g-hockey .hk-wait i { animation: none; } }
  @media (orientation: landscape) and (max-height: 520px) {
    .g-hockey .hk-setup { padding-top: 8px; padding-left: calc(62px + env(safe-area-inset-left, 0px)); padding-right: calc(62px + env(safe-area-inset-right, 0px)); }
    .g-hockey .hk-card { width: min(100%, 760px); padding: 8px 10px; gap: 6px; }
    .g-hockey .hk-grid { grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .g-hockey .hk-chip { min-height: 48px; padding: 4px 6px; }
    .g-hockey .hk-chip small { display: none; }
    .g-hockey .hk-chip.is-wide { grid-column: auto; }
    .g-hockey .hk-recs { display: none; }
  }
`;

/** Build the picker inside `root`. opts: { chooser: boolean (this device picks), hostName, onPick(id), onGo() }. */
export function createSetup(root, opts) {
  const el = document.createElement('div');
  el.className = 'hk-setup';
  el.hidden = true;
  const chips = [...TABLE_ORDER.map((id) => TABLES[id]), SURPRISE];
  el.innerHTML = `<div class="hk-card g-panel" role="dialog" aria-label="Pick a table">
    <div class="hk-head"><h2 class="hk-title">Pick a table</h2></div>
    <div class="hk-grid" role="radiogroup" aria-label="Table">${chips.map((c, i) => `<button type="button" class="hk-chip${i === chips.length - 1 ? ' is-wide' : ''}" role="radio" aria-checked="false" data-tb="${c.id}">${ICONS[c.id]}<span><b>${c.name}</b><small>${c.blurb}</small></span></button>`).join('')}</div>
    <p class="hk-recs"></p>
    <button type="button" class="gm-btn gm-btn-big hk-go" data-hk="go">GO</button>
    <p class="hk-wait" hidden></p>
  </div>`;
  root.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const go = $('.hk-go'); const wait = $('.hk-wait'); const title = $('.hk-title');
  let sel = null;
  const chipEls = [...el.querySelectorAll('.hk-chip')];
  const paint = () => {
    for (const c of chipEls) { const on = c.dataset.tb === sel; c.classList.toggle('is-on', on); c.setAttribute('aria-checked', on ? 'true' : 'false'); }
  };
  const setChooser = (chooser, hostName) => {
    for (const c of chipEls) c.disabled = !chooser;
    go.hidden = !chooser; wait.hidden = chooser;
    title.textContent = chooser ? 'Pick a table' : 'Choosing the table';
    wait.innerHTML = `${hostName} is picking<i>…</i>`;
  };
  el.addEventListener('click', (e) => {
    const chip = e.target.closest('.hk-chip');
    if (chip && !chip.disabled) { sel = chip.dataset.tb; paint(); api_pick(sel); return; }
    if (e.target.closest('[data-hk="go"]')) opts.onGo();
  });
  const api_pick = (id) => opts.onPick(id);
  setChooser(opts.chooser, opts.hostName);
  return {
    el,
    show() { el.hidden = false; },
    hide() { el.hidden = true; },
    get visible() { return !el.hidden; },
    select(id) { sel = id; paint(); },
    setChooser,
    setRecords(html) { $('.hk-recs').innerHTML = html || ''; $('.hk-recs').hidden = !html; },
    focusGo() { try { go.focus({ preventScroll: true }); } catch { /* ignore */ } },
  };
}
