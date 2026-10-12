// Word Duel styles (injected once by wordduel.js). Everything is scoped under .g-wd.
export const CSS = `
.g-wd { --gap: 6px; --wd-on-good: var(--g-white); flex: 1; min-height: 0; width: 100%; max-width: 520px; margin: 0 auto; display: flex; flex-direction: column; gap: 8px; color: var(--g-ink); font-family: var(--g-font-body); touch-action: manipulation; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .g-wd { --wd-on-good: var(--g-on-ink); } }
:root[data-theme="dark"] .g-wd { --wd-on-good: var(--g-on-ink); }
.g-wd-head { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.g-wd-say { margin: 0; min-height: 1.35em; text-align: center; font-weight: 800; font-size: 0.98rem; line-height: 1.35; text-wrap: balance; }
.g-wd-say b { font-family: var(--g-font-display); letter-spacing: 0.04em; }
.g-wd-strip { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 18px; font-size: 0.8rem; font-weight: 800; color: var(--g-muted); }
.g-wd-strip:empty { display: none; }
.g-wd-who { font-weight: 900; }
.g-wd-who.p-a { color: var(--p-a-text); } .g-wd-who.p-b { color: var(--p-b-text); }
.g-wd-area { flex: 1 1 0; min-height: 170px; container-type: size; display: flex; align-items: center; justify-content: center; }

/* tiles: printed letter tiles */
.g-wd-board { --t: min(62px, calc((100cqw - 4 * var(--gap)) / 5), calc((100cqh - 5 * var(--gap)) / 6)); display: grid; gap: var(--gap); justify-content: center; }
.g-wd-row { display: grid; grid-template-columns: repeat(5, var(--t)); gap: var(--gap); }
.g-wd-tile { position: relative; width: var(--t); height: var(--t); box-sizing: border-box; display: grid; place-items: center; border: 2px solid var(--g-line); border-radius: max(4px, calc(var(--g-radius) * 0.4)); background-color: var(--bg, var(--g-card)); background-image: var(--pat, none); color: var(--fg, var(--g-ink)); font-family: var(--g-font-display); font-weight: 900; font-size: calc(var(--t) * 0.52); line-height: 1; text-transform: uppercase; }
.g-wd-tile.has, .g-wd-tile.m-g, .g-wd-tile.m-y, .g-wd-tile.m-x { border-color: var(--g-ink); box-shadow: var(--g-shadow); }
.g-wd .m-g { --bg: var(--g-good); --fg: var(--wd-on-good); }
.g-wd .m-y { --bg: var(--g-hl); --fg: var(--g-on-ink); --pat: repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--g-on-ink) 24%, transparent) 5px 7px); }
.g-wd .m-x { --bg: var(--g-muted); --fg: var(--g-card); }
.g-wd-tile.m-g::after { content: ''; position: absolute; left: 28%; right: 28%; bottom: 11%; height: max(2px, calc(var(--t, 40px) * 0.07)); border-radius: 2px; background: currentColor; }
.g-wd-row.is-target .g-wd-tile { border-style: dashed; box-shadow: none; }

/* pick a secret */
.g-wd-pick { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.g-wd-pick .g-wd-board { --t: min(64px, calc((100cqw - 4 * var(--gap)) / 5)); }
.g-wd-cap { margin: 0; font-size: 0.82rem; font-weight: 800; color: var(--g-muted); text-transform: uppercase; letter-spacing: 0.08em; }
.g-wd-stamp { display: inline-block; padding: 3px 10px; border: 2px solid currentColor; border-radius: 6px; font-family: var(--g-font-display); font-weight: 900; font-size: 0.85rem; letter-spacing: 0.14em; text-transform: uppercase; transform: rotate(-4deg); }
.g-wd-stamp.p-a { color: var(--p-a-text); } .g-wd-stamp.p-b { color: var(--p-b-text); }

/* two boards side by side */
.g-wd-duo { width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.g-wd-col { min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.g-wd-col .g-wd-board { --gap: 4px; --t: min(44px, calc((50cqw - 6px - 4 * var(--gap)) / 5), calc((100cqh - 74px - 6 * var(--gap)) / 7)); }
.g-wd-col .g-wd-target { margin-bottom: 4px; }
.g-wd-colhead { display: flex; align-items: baseline; gap: 6px; font-weight: 800; font-size: 0.9rem; white-space: nowrap; }
.g-wd-colhead small { color: var(--g-muted); font-weight: 800; font-size: 0.8rem; }

/* partner progress, colour only */
.g-wd-minis { display: flex; gap: 4px; }
.g-wd-mrow { display: flex; gap: 1px; }
.g-wd-m { width: 7px; height: 7px; box-sizing: border-box; border: 1.5px solid var(--g-line); border-radius: 1px; }
.g-wd-m.m-g { background: var(--g-good); border-color: var(--g-ink); }
.g-wd-m.m-y { background: var(--g-hl); border-color: var(--g-ink); border-radius: 50%; }
.g-wd-m.m-x { background: transparent; border-color: var(--g-muted); }

/* actions + keyboard */
.g-wd-actions { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; }
.g-wd-actions:empty { display: none; }
.g-wd-actions .gm-btn { min-height: 44px; min-width: 132px; }
.g-wd-banner { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.g-wd-banner p { margin: 0; font-weight: 800; }
.g-wd-kb { display: flex; flex-direction: column; gap: 6px; padding-bottom: 2px; }
.g-wd-kb:empty { display: none; }
.g-wd-kr { display: flex; justify-content: center; gap: 5px; }
/* keys are the shared kit .g-key; these add Word Duel's three marks */
.g-wd .g-wd-key.g-key { position: relative; max-width: 50px; padding: 0; }
.g-wd .g-wd-key.g-key.is-wide { max-width: 76px; text-transform: none; font-size: 0.86rem; letter-spacing: 0.01em; }
.g-wd .g-wd-key.g-key.is-wide svg { display: block; }
.g-wd .g-wd-key.g-key.m-g { background: var(--g-good); color: var(--wd-on-good); }
.g-wd .g-wd-key.g-key.m-g::after { content: ''; position: absolute; left: 30%; right: 30%; bottom: 7px; height: 3px; border-radius: 2px; background: currentColor; }
.g-wd .g-wd-key.g-key.is-hl { background-image: repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--g-on-ink) 22%, transparent) 5px 7px); }
.g-wd .g-wd-key.g-key:disabled { opacity: 0.45; cursor: default; transform: none; }
@media (max-height: 700px) { .g-wd .g-wd-key.g-key { height: 46px; } }
@media (max-height: 620px) { .g-wd .g-wd-key.g-key { height: 42px; } .g-wd { gap: 6px; } }

/* motion */
@keyframes g-wd-flip { 0% { transform: rotateX(0); } 50% { transform: rotateX(-90deg); } 100% { transform: rotateX(0); } }
@keyframes g-wd-face { 0%, 49% { background-color: var(--g-card); background-image: none; color: var(--g-ink); } 50%, 100% { background-color: var(--bg, var(--g-card)); background-image: var(--pat, none); color: var(--fg, var(--g-ink)); } }
@keyframes g-wd-bar { 0%, 49% { opacity: 0; } 50%, 100% { opacity: 1; } }
@keyframes g-wd-pop { 0% { transform: scale(0.82); } 60% { transform: scale(1.1); } 100% { transform: scale(1); } }
@keyframes g-wd-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-8px); } 40% { transform: translateX(7px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(3px); } }
@keyframes g-wd-jump { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-28%); } 70% { transform: translateY(4%); } }
@keyframes g-wd-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.g-wd-tile.flip { animation: g-wd-flip 0.5s ease-in-out both, g-wd-face 0.5s linear both; animation-delay: calc(var(--i) * 160ms); }
.g-wd-tile.flip::after { animation: g-wd-bar 0.5s linear both; animation-delay: calc(var(--i) * 160ms); }
.g-wd-tile.pop { animation: g-wd-pop 0.14s ease-out; }
.g-wd-row.shake { animation: g-wd-shake 0.4s ease; }
.g-wd-row.win .g-wd-tile { animation: g-wd-jump 0.5s ease both; animation-delay: calc(var(--i) * 90ms); }
.g-wd-banner, .g-wd-duo { animation: g-wd-in 0.3s ease both; }
@media (prefers-reduced-motion: reduce) {
  .g-wd-tile.flip, .g-wd-tile.flip::after, .g-wd-tile.pop, .g-wd-row.shake, .g-wd-row.win .g-wd-tile, .g-wd-banner, .g-wd-duo { animation-duration: 1ms !important; animation-delay: 0s !important; }
}
/* ── v2 additions ── */
.g-wd-kb[hidden] { display: none; }
.g-wd-head { min-width: 0; max-width: 100%; }
.g-wd-strip { flex-wrap: wrap; max-width: 100%; row-gap: 2px; }
.g-wd-row { position: relative; }
.g-wd-row.is-dealt { margin-top: 11px; }
.g-wd-board:has(.is-dealt) { --t: min(62px, calc((100cqw - 4 * var(--gap)) / 5), calc((100cqh - 5 * var(--gap) - 12px) / 6)); }
.g-wd-col .g-wd-board:has(.is-dealt) { --t: min(44px, calc((50cqw - 6px - 4 * var(--gap)) / 5), calc((100cqh - 74px - 6 * var(--gap) - 12px) / 7)); }
.g-wd-row.is-dealt::before { content: 'Dealt'; position: absolute; left: -3px; top: -11px; z-index: 2; padding: 0 5px; font: 900 0.52rem/1.35 var(--g-font-body); letter-spacing: 0.12em; text-transform: uppercase; background: var(--g-ink); color: var(--g-bg); border-radius: 3px; transform: rotate(-3deg); pointer-events: none; }
.g-wd-area.is-scroll { align-items: flex-start; overflow-y: auto; overscroll-behavior: contain; }
.g-wd-area.is-scroll > * { margin-block: auto; }

/* pills + stamps */
.g-wd-tags { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.g-wd-pill { max-width: 100%; box-sizing: border-box; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-flex; align-items: center; min-height: 24px; padding: 0 9px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); color: var(--g-ink); font: 900 0.68rem/1 var(--g-font-body); letter-spacing: 0.1em; text-transform: uppercase; }
.g-wd-pill.is-hl { background: var(--g-hl); color: var(--g-on-ink); }
.g-wd-stamps { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 10px; }
.g-wd-st { display: inline-block; padding: 3px 9px; border: 2.5px solid currentColor; border-radius: 6px; background: var(--g-card); font-family: var(--g-font-display); font-weight: 900; font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; transform: rotate(var(--r, -4deg)); animation: g-wd-stampin 0.34s cubic-bezier(0.2, 1.4, 0.4, 1) both; animation-delay: calc(var(--n, 0) * 140ms + 250ms); }
.g-wd-st.p-a { color: var(--p-a-text); } .g-wd-st.p-b { color: var(--p-b-text); }
.g-wd-st.hl { color: var(--g-on-ink); background: var(--g-hl); border-color: var(--g-ink); box-shadow: var(--g-shadow-sm); }
@keyframes g-wd-stampin { from { opacity: 0; transform: rotate(var(--r, -4deg)) scale(1.7); } to { opacity: 1; transform: rotate(var(--r, -4deg)) scale(1); } }

/* ledger + heat */
.g-wd-ledger { margin: 0; text-align: center; font-weight: 900; font-size: 0.8rem; letter-spacing: 0.04em; color: var(--g-muted); }
.g-wd-ledger:empty { display: none; }
.g-wd-heat { display: inline-flex; align-items: center; gap: 10px; }
.g-wd-hp { display: inline-flex; align-items: center; gap: 3px; font-weight: 900; }
.g-wd-hp .g-wd-m { width: 9px; height: 9px; margin-left: 3px; }
.g-wd-hl { font-weight: 900; font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; }

/* rules card */
.g-wd-rules { box-sizing: border-box; width: 100%; max-width: 440px; padding: 2px 6px 6px 2px; display: flex; flex-direction: column; gap: 10px; }
.g-wd-rules h2 { margin: 0; font-family: var(--g-font-display); font-weight: 900; font-size: 1.15rem; line-height: 1.1; text-align: center; }
.g-wd-seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.g-wd .g-wd-opt { min-height: 44px; box-sizing: border-box; padding: 5px 6px; border: 2px solid var(--g-ink); border-radius: var(--g-radius-sm); background: var(--g-card); color: var(--g-ink); box-shadow: var(--g-shadow-sm); font: 800 0.82rem/1.15 var(--g-font-body); text-align: center; touch-action: manipulation; cursor: pointer; }
.g-wd .g-wd-opt small { display: block; font-weight: 700; font-size: 0.68rem; opacity: 0.8; }
.g-wd .g-wd-opt[aria-pressed="true"], .g-wd .g-wd-opt[aria-checked="true"] { background: var(--g-hl); color: var(--g-on-ink); box-shadow: none; transform: translate(2px, 2px); }
.g-wd .g-wd-opt:focus-visible { outline: 3px solid var(--p-a); outline-offset: 2px; }
.g-wd .g-wd-tog { display: flex; align-items: center; justify-content: space-between; gap: 10px; text-align: left; padding: 6px 12px; }
.g-wd .g-wd-tog b { font-weight: 900; }
.g-wd .g-wd-tog .g-wd-sw { flex: none; min-width: 38px; padding: 2px 8px; border: 2px solid currentColor; border-radius: 999px; font-weight: 900; font-size: 0.7rem; letter-spacing: 0.08em; text-align: center; }
.g-wd-rules-grid { display: grid; gap: 6px; }

/* wait / scoreboard */
.g-wd-wait { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 8px; }
.g-wd-wait p { margin: 0; font-weight: 800; }
.g-wd-score { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.g-wd-score-n { display: flex; align-items: baseline; gap: 8px; font-family: var(--g-font-display); font-weight: 900; font-size: 1.3rem; line-height: 1; }
.g-wd-score-n small { font-family: var(--g-font-body); font-weight: 800; font-size: 0.78rem; }
.g-wd-score-n .g-wd-dash { color: var(--g-muted); }
.g-wd-score-n .p-a { color: var(--p-a-text); } .g-wd-score-n .p-b { color: var(--p-b-text); }
.g-wd-score small { font-family: var(--g-font-body); font-weight: 800; font-size: 0.82rem; color: var(--g-muted); }
.g-wd-dealtline { margin: 0; font-weight: 800; font-size: 0.82rem; color: var(--g-muted); }
.g-wd-dealtline b { font-family: var(--g-font-display); letter-spacing: 0.1em; color: var(--g-ink); }
.g-wd-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.g-wd .g-wd-chip { min-height: 44px; padding: 0 14px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); color: var(--g-ink); box-shadow: var(--g-shadow-sm); font-family: var(--g-font-display); font-weight: 900; font-size: 0.82rem; letter-spacing: 0.1em; text-transform: uppercase; touch-action: manipulation; }
.g-wd .g-wd-chip:active { transform: translate(2px, 2px); box-shadow: none; }
.g-wd-pick .g-wd-tags { margin-bottom: 2px; }

/* end extras */
.g-wd-endx { flex: 1 1 100%; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.g-wd-recap { display: grid; gap: 2px; font-weight: 800; font-size: 0.8rem; text-align: center; color: var(--g-muted); }
.g-wd-recap b { color: var(--g-ink); }

/* a missed word is inked in tile by tile, in the chooser's colour */
.g-wd-row.inked .g-wd-tile { --ink: var(--p-a); border-style: solid; border-color: var(--g-ink); background: var(--ink); color: var(--g-on-ink); box-shadow: var(--g-shadow-sm); animation: g-wd-inkin 0.3s ease-out both; animation-delay: calc(var(--i) * 150ms + 500ms); }
.g-wd-row.inked.p-b .g-wd-tile { --ink: var(--p-b); }
@keyframes g-wd-inkin { from { opacity: 0; transform: scale(0.6) rotate(-8deg); } to { opacity: 1; transform: none; } }

/* one phone: the finishing reveal sits above the pass-the-phone curtain */
.g-wd-hold-layer { position: fixed; inset: 0; z-index: 6; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: calc(70px + env(safe-area-inset-top, 0px)) 14px calc(14px + env(safe-area-inset-bottom, 0px)); background: var(--g-bg); overflow-y: auto; }
.g-wd-hold-layer .g-wd { display: flex; flex-direction: column; flex: 0 1 auto; justify-content: center; align-items: center; }
.g-wd-hold-layer .g-wd-board { --t: clamp(26px, min(54px, calc((100vw - 60px) / 5), calc((100vh - 330px) / 6)), 54px); }
.g-wd-hold-layer .g-wd-say { min-height: 2.7em; }

/* short phones (portrait): squeeze the pick screen and the board so the keyboard stays on screen */
@media (max-height: 700px) and (orientation: portrait) {
  .g-wd-area { min-height: 110px; }
  .g-wd-pick { gap: 6px; }
  .g-wd-cap { display: none; }
  .g-wd-pick .g-wd-board { --t: min(54px, calc((100cqw - 4 * var(--gap)) / 5)); }
  .g-wd-head { gap: 3px; }
  .g-wd-say { font-size: 0.92rem; line-height: 1.25; }
  .g-wd-actions { gap: 8px; }
  .g-wd-kb { gap: 5px; }
}
@media (max-height: 620px) and (orientation: portrait) {
  .g-wd-area { min-height: 90px; }
  .g-wd-pick { gap: 4px; }
  .g-wd-pick .g-wd-board { --t: min(44px, calc((100cqw - 4 * var(--gap)) / 5)); }
  .g-wd-kb { gap: 4px; }
  .g-wd-kr { gap: 4px; }
  .g-wd-score-n { font-size: 1.05rem; }
  .g-wd-score { flex-direction: row; flex-wrap: wrap; justify-content: center; gap: 2px 10px; }
  .g-wd-dealtline { display: none; }
  .g-wd-chips { gap: 6px; }
  .g-wd .g-wd-chip { font-size: 0.74rem; padding: 0 10px; }
}

/* landscape phones: board on the left, words and keys on the right, nothing below the fold */
@media (orientation: landscape) and (max-height: 520px) {
  .g-wd { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); grid-template-rows: auto minmax(0, 1fr) auto; column-gap: 12px; row-gap: 4px; max-width: 800px; }
  .g-wd-area { grid-column: 1; grid-row: 1 / 4; min-height: 0; }
  .g-wd-head { grid-column: 2; grid-row: 1; gap: 2px; }
  .g-wd-say { font-size: 0.86rem; line-height: 1.25; min-height: 0; }
  .g-wd-actions { grid-column: 2; grid-row: 2; align-self: center; }
  .g-wd-kb { grid-column: 2; grid-row: 3; gap: 4px; padding-bottom: 0; }
  .g-wd-kr { gap: 4px; }
  .g-wd .g-wd-key.g-key { height: 36px; min-height: 0; }
  .g-wd .g-wd-key.g-key.m-g::after { bottom: 4px; height: 2px; }
  .g-wd-pick .g-wd-board { --t: min(46px, calc((100cqw - 4 * var(--gap)) / 5)); }
  .g-wd-col .g-wd-board { --t: min(30px, calc((50cqw - 6px - 4 * var(--gap)) / 5), calc((100cqh - 60px - 6 * var(--gap)) / 7)); }
  .g-wd-endx { gap: 4px; }
  .g-wd-rules { gap: 6px; }
  .g-wd-rules h2 { display: none; }
  .g-wd-rules-grid { grid-template-columns: repeat(3, 1fr); }
  .g-wd .g-wd-tog { flex-direction: column; align-items: flex-start; justify-content: center; gap: 3px; padding: 4px 8px; }
  .g-wd .g-wd-tog small, .g-wd .g-wd-seg small { display: none; }
  .g-wd-pick .g-wd-tags { margin: 0; }
  .g-wd-hold-layer { padding-top: calc(56px + env(safe-area-inset-top, 0px)); }
  .g-wd-hold-layer .g-wd-board { --t: clamp(20px, min(44px, calc((100vh - 190px) / 6)), 44px); }
}
@media (orientation: landscape) and (max-height: 350px) {
  .g-wd-say { display: none; }
  .g-wd-head { gap: 0; }
  .g-wd .g-wd-key.g-key { height: 30px; }
  .g-wd-kb { gap: 3px; }
  .g-wd-kr { gap: 3px; }
  .g-wd-pick { gap: 3px; }
  .g-wd-pick .g-wd-board { --t: min(36px, calc((100cqw - 4 * var(--gap)) / 5)); }
  .g-wd-score { flex-direction: row; gap: 8px; }
  .g-wd-dealtline { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .g-wd-st, .g-wd-row.inked .g-wd-tile { animation-duration: 1ms !important; animation-delay: 0s !important; }
}
`;
