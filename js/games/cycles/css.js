// Light Cycles styles (scoped under .g-cycles).
export const CSS = `
.g-cycles { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 4px 0 2px; color: var(--g-ink); font-family: var(--g-font-body); -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
@media (min-width: 760px) { .g-cycles { width: calc(100vw - 48px); max-width: 1180px; align-self: center; } }
.g-cycles .cy-ready { margin: auto; font-weight: 800; color: var(--g-muted); }
.g-cycles .cy-row { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; gap: 22px; }
.g-cycles .cy-board { position: relative; flex: 1 1 auto; align-self: stretch; min-width: 0; min-height: 150px; touch-action: none; }
.g-cycles .cy-board.is-fit { flex: none; }
.g-cycles .cy-board canvas { position: absolute; left: 50%; top: 50%; display: block; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 8px; box-shadow: var(--g-shadow-lg, 6px 6px 0 var(--g-ink)); transform: translate(calc(-50% - 3px), calc(-50% - 3px)); touch-action: none; }
.g-cycles .cy-msg { position: absolute; left: 50%; top: 50%; z-index: 4; transform: translate(-50%, -50%); pointer-events: none; text-align: center; max-width: 96%; }
.g-cycles .cy-msg.is-up { top: 26%; }
.g-cycles .cy-msg > span { display: inline-flex; flex-direction: column; align-items: center; gap: 4px; background: var(--g-card); color: var(--g-ink); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-ink)); background: var(--g-grain) 0 0 / var(--g-grain-size), var(--g-card); padding: 10px 16px; font-weight: 800; font-size: 1.02rem; line-height: 1.25; animation: cy-pop 0.32s cubic-bezier(0.2, 1.5, 0.4, 1) both; }
.g-cycles .cy-msg .cy-t { white-space: nowrap; }
.g-cycles .cy-msg small { font: 800 0.74rem/1.25 var(--g-font-body); letter-spacing: 0.06em; color: var(--g-muted); white-space: normal; }
.g-cycles .cy-msg b { font-family: var(--g-font-display); font-weight: 400; text-shadow: var(--g-misreg); }
.g-cycles .cy-msg .w-a b { color: var(--p-a-text, var(--p-a)); } .g-cycles .cy-msg .w-b b { color: var(--p-b-text, var(--p-b)); }
.g-cycles .cy-msg .is-num { display: grid; place-items: center; width: var(--cy-s, 92px); height: var(--cy-s, 92px); padding: 0; border-radius: 50%; background: var(--g-halftone) 0 0 / 5px 5px, var(--g-hl); color: var(--g-on-ink); font: 400 calc(var(--cy-s, 92px) * 0.5)/1 var(--g-font-display); text-shadow: var(--g-misreg); box-shadow: var(--g-shadow-lg, 6px 6px 0 var(--g-ink)); }
.g-cycles .cy-msg .is-go { display: grid; width: auto; height: auto; padding: calc(var(--cy-s, 92px) * 0.15) calc(var(--cy-s, 92px) * 0.24); border-radius: 16px; font-size: calc(var(--cy-s, 92px) * 0.42); transform: rotate(-4deg); }
.g-cycles .cy-msg .w-d { background: var(--g-halftone) 0 0 / 5px 5px, var(--g-hl); color: var(--g-on-ink); }
.g-cycles .cy-msg .w-d small { color: var(--g-on-ink); }
.g-cycles .cy-msg .is-heat .cy-t { font: 400 1.6rem/1 var(--g-font-display); letter-spacing: 0.04em; text-shadow: var(--g-misreg); }
.g-cycles .cy-stamp { display: inline-block; font: 400 0.72rem/1 var(--g-font-display); letter-spacing: 0.05em; padding: 5px 8px 4px; margin-top: 2px; background: var(--g-hl); color: var(--g-on-ink); border: 2px solid var(--g-ink); border-radius: 5px; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); transform: rotate(-3deg); animation: cy-stamp 0.4s 0.25s cubic-bezier(0.2, 1.8, 0.4, 1) both; }
@keyframes cy-pop { from { transform: scale(0.55); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes cy-stamp { from { transform: rotate(-3deg) scale(2.2); opacity: 0; } to { transform: rotate(-3deg) scale(1); opacity: 1; } }
.g-cycles .cy-msg .is-go { animation-name: cy-go; }
@keyframes cy-go { from { transform: rotate(-4deg) scale(0.55); opacity: 0; } to { transform: rotate(-4deg) scale(1); opacity: 1; } }

/* a short board (a phone on its side): a smaller banner */
.g-cycles[data-layout="l"] .cy-msg > span { padding: 6px 12px; gap: 2px; font-size: 0.9rem; }
.g-cycles[data-layout="l"] .cy-msg .is-heat .cy-t { font-size: 1.25rem; }
.g-cycles[data-layout="l"] .cy-msg small { font-size: 0.66rem; }
.g-cycles[data-layout="l"] .cy-stamp { font-size: 0.62rem; padding: 4px 6px 3px; }

/* crash replay overlay */
.g-cycles .cy-rp { position: absolute; inset: 0; z-index: 3; display: none; pointer-events: none; }
.g-cycles .cy-rp.is-on { display: block; }
.g-cycles .cy-rp-tag { position: absolute; left: 14px; top: 10px; font: 400 0.78rem/1 var(--g-font-display); letter-spacing: 0.06em; padding: 6px 9px 5px; background: var(--g-hl); color: var(--g-on-ink); border: 2px solid var(--g-ink); border-radius: 6px; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); transform: rotate(-3deg); }
.g-cycles .cy-rp-cap { position: absolute; left: 8px; right: 8px; bottom: 18px; width: max-content; margin: 0 auto; max-width: calc(100% - 16px); padding: 7px 12px; background: var(--g-card); color: var(--g-ink); border: 2.5px solid var(--g-ink); border-radius: 10px; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); background: var(--g-grain) 0 0 / var(--g-grain-size), var(--g-card); font: 800 0.9rem/1.2 var(--g-font-body); text-align: center; animation: cy-pop 0.3s 0.5s cubic-bezier(0.2, 1.5, 0.4, 1) both; }
.g-cycles .cy-rp-skip { position: absolute; right: 16px; top: 12px; font: 800 0.66rem/1 var(--g-font-body); letter-spacing: 0.12em; text-transform: uppercase; color: var(--g-ink); background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 5px; padding: 4px 6px; opacity: 0.85; }

/* pre-match arena picker */
.g-cycles .cy-pick { margin: auto; width: min(100%, 560px); display: flex; flex-direction: column; gap: 12px; padding: 14px 12px 16px; background: var(--g-grain) 0 0 / var(--g-grain-size), var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: var(--g-shadow-lg, 6px 6px 0 var(--g-ink)); }
.g-cycles .cy-pick-t { margin: 0; font: 400 1.3rem/1.1 var(--g-font-display); text-align: center; text-shadow: var(--g-misreg); }
.g-cycles .cy-pick-sub { margin: 0; text-align: center; font: 800 0.8rem/1.3 var(--g-font-body); color: var(--g-muted); }
.g-cycles .cy-chips { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.g-cycles .cy-chip { position: relative; min-height: 92px; min-width: 0; padding: 6px 3px 7px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; border: 2.5px solid var(--g-ink); border-radius: 11px; background: var(--g-grain) 0 0 / var(--g-grain-size), var(--g-bg); color: var(--g-ink); box-shadow: 3px 3px 0 var(--g-edge, var(--g-ink)); font: 800 0.76rem/1.1 var(--g-font-body); text-align: center; cursor: pointer; touch-action: manipulation; transition: transform 0.06s; }
.g-cycles .cy-chip[aria-checked="true"] { background: var(--g-halftone) 0 0 / 5px 5px, var(--g-hl); color: var(--g-on-ink); transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--g-edge, var(--g-ink)); }
.g-cycles .cy-chip:active { transform: translate(3px, 3px); box-shadow: 0 0 0 var(--g-edge, var(--g-ink)); }
.g-cycles .cy-chip:focus-visible, .g-cycles .cy-go:focus-visible { outline: 3px solid var(--g-ink); outline-offset: 2px; }
.g-cycles .is-ro .cy-chip { cursor: default; pointer-events: none; }
.g-cycles .cy-mini { display: block; width: 38px; height: auto; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 3px; }
.g-cycles .cy-mini.is-wide { width: 52px; }
.g-cycles .cy-glyph { display: grid; place-items: center; width: 38px; height: 54px; font: 400 1.7rem/1 var(--g-font-display); }
.g-cycles .cy-glyph svg { width: 30px; height: 30px; fill: currentColor; }
.g-cycles .cy-chip .cy-on { font: 800 0.64rem/1 var(--g-font-body); letter-spacing: 0.1em; }
.g-cycles .cy-recs { margin: 0; text-align: center; font: 800 0.74rem/1.35 var(--g-font-body); color: var(--g-muted); }
.g-cycles .cy-go { align-self: stretch; }

.g-cycles .cy-info { display: flex; align-items: center; justify-content: center; gap: 14px; min-height: 26px; }
.g-cycles .cy-round { font: 800 0.72rem/1.15 var(--g-font-body); letter-spacing: 0.1em; text-transform: uppercase; color: var(--g-muted); min-width: 92px; text-align: center; }
.g-cycles .cy-pips { display: flex; gap: 7px; }
.g-cycles .cy-pips i { width: 14px; height: 14px; border: 2px solid var(--g-ink); border-radius: 3px; transform: rotate(45deg); background: var(--g-card); transition: background-color 0.2s; }
.g-cycles .cy-pips.p-a i.on { background: var(--p-a); } .g-cycles .cy-pips.p-b i.on { background: var(--p-b); }
.g-cycles .cy-pips i.pulse { animation: cy-pip 0.7s cubic-bezier(0.2, 1.6, 0.4, 1); }
@keyframes cy-pip { 0% { transform: rotate(45deg) scale(0.4); } 55% { transform: rotate(45deg) scale(1.8); } 100% { transform: rotate(45deg) scale(1); } }

/* touch pads */
.g-cycles .cy-pad { display: flex; align-items: center; justify-content: center; gap: 12px; flex: none; }
.g-cycles .cy-pad.is-rot { transform: rotate(180deg); }
.g-cycles .cy-pad-name { text-shadow: var(--g-misreg); font: 400 0.82rem/1 var(--g-font-display); writing-mode: vertical-rl; transform: rotate(180deg); }
.g-cycles .cy-pad.p-a .cy-pad-name { color: var(--p-a-text, var(--p-a)); } .g-cycles .cy-pad.p-b .cy-pad-name { color: var(--p-b-text, var(--p-b)); }
.g-cycles .cy-pad-keys { display: grid; grid-template-columns: repeat(3, 64px); grid-template-rows: repeat(2, 52px); gap: 7px; }
.g-cycles .cy-pad.is-row .cy-pad-keys { grid-template-columns: repeat(4, 62px); grid-template-rows: 48px; }
.g-cycles .cy-pad.is-side .cy-pad-keys { grid-template-columns: repeat(3, 58px); grid-template-rows: repeat(3, 54px); }
.g-cycles .cy-key { display: grid; place-items: center; padding: 0; border: 2.5px solid var(--g-ink); border-radius: 11px; background: var(--g-halftone) 0 0 / 5px 5px, var(--p-a); color: var(--g-on-ink); box-shadow: 3px 3px 0 var(--g-edge, var(--g-ink)); touch-action: manipulation; cursor: pointer; transition: transform 0.06s; }
.g-cycles .p-b .cy-key { background: var(--g-halftone) 0 0 / 5px 5px, var(--p-b); }
.g-cycles .cy-key svg { width: 24px; height: 24px; fill: currentColor; }
.g-cycles .cy-key:active, .g-cycles .cy-key.is-down { transform: translate(3px, 3px); box-shadow: 0 0 0 var(--g-edge, var(--g-ink)); }
.g-cycles .cy-key:focus-visible { outline: 3px solid var(--g-ink); outline-offset: 2px; }
.g-cycles .cy-d0 { grid-column: 2; grid-row: 1; } .g-cycles .cy-d3 { grid-column: 1; grid-row: 2; }
.g-cycles .cy-d2 { grid-column: 2; grid-row: 2; } .g-cycles .cy-d1 { grid-column: 3; grid-row: 2; }
.g-cycles .is-row .cy-key { grid-row: 1; grid-column: auto; }
.g-cycles .is-side .cy-d0 { grid-row: 1; } .g-cycles .is-side .cy-d3, .g-cycles .is-side .cy-d1 { grid-row: 2; } .g-cycles .is-side .cy-d2 { grid-row: 3; }

/* keyboard legends */
.g-cycles .cy-legend { flex: none; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px 14px 16px; background: var(--g-grain) 0 0 / var(--g-grain-size), var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-ink)); }
.g-cycles .cy-legend-name { text-shadow: var(--g-misreg); font: 400 1.05rem/1.1 var(--g-font-display); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-cycles .cy-legend.p-a .cy-legend-name { color: var(--p-a-text, var(--p-a)); } .g-cycles .cy-legend.p-b .cy-legend-name { color: var(--p-b-text, var(--p-b)); }
.g-cycles .cy-legend-tag { font: 800 0.66rem/1.2 var(--g-font-body); letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); text-align: center; }
.g-cycles .cy-caps { display: grid; grid-template-columns: repeat(3, 40px); grid-template-rows: repeat(2, 40px); gap: 5px; }
.g-cycles .cy-caps kbd { display: grid; place-items: center; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-bg); color: var(--g-ink); box-shadow: 0 3px 0 var(--g-edge, var(--g-ink)); font: 800 1rem/1 var(--g-font-body); transition: transform 0.06s, background-color 0.15s; }
.g-cycles .cy-caps kbd svg { width: 15px; height: 15px; fill: currentColor; }
.g-cycles .cy-caps kbd:nth-child(1) { grid-column: 2; grid-row: 1; } .g-cycles .cy-caps kbd:nth-child(2) { grid-column: 1; grid-row: 2; }
.g-cycles .cy-caps kbd:nth-child(3) { grid-column: 2; grid-row: 2; } .g-cycles .cy-caps kbd:nth-child(4) { grid-column: 3; grid-row: 2; }
.g-cycles .cy-caps kbd.is-down { transform: translateY(3px); box-shadow: 0 0 0 var(--g-edge, var(--g-ink)); }
.g-cycles .cy-legend.p-a kbd.is-down { background: var(--p-a); color: var(--g-on-ink); } .g-cycles .cy-legend.p-b kbd.is-down { background: var(--p-b); color: var(--g-on-ink); }
.g-cycles .cy-legend.is-them { align-self: center; min-width: 132px; }
.g-cycles .cy-bike { width: 22px; height: 34px; border: 2.5px solid var(--g-ink); border-radius: 7px; background: linear-gradient(var(--g-hl) 0 58%, var(--g-ink) 58% 64%, transparent 64%); position: relative; }
.g-cycles .cy-legend.p-a .cy-bike { background-color: var(--p-a); } .g-cycles .cy-legend.p-b .cy-bike { background-color: var(--p-b); }
.g-cycles .cy-legends { display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; }
.g-cycles .cy-legends .cy-legend { flex-direction: row; padding: 10px 14px; gap: 14px; }
.g-cycles .cy-legends .cy-caps { grid-template-columns: repeat(3, 34px); grid-template-rows: repeat(2, 34px); }
.g-cycles .cy-or { font-weight: 800; color: var(--g-muted); }
@media (max-height: 760px) { .g-cycles .cy-pad-keys { grid-template-rows: repeat(2, 46px); } .g-cycles .cy-pad.is-row .cy-pad-keys { grid-template-rows: 44px; } }
/* a phone on its side: the pads move beside the board instead of above and below it */
@media (orientation: landscape) and (max-height: 520px) {
  .g-cycles[data-ui*="touch"] { position: relative; padding: 2px 0; }
  .g-cycles[data-ui*="touch"] .cy-info { position: absolute; left: 0; right: 0; bottom: 0; min-height: 0; padding: 0 10px; justify-content: space-between; pointer-events: none; }
  .g-cycles[data-ui*="touch"] .cy-round { display: none; }
  .g-cycles[data-ui="live-touch"], .g-cycles[data-ui="local-touch-p"] { display: grid; grid-template-rows: minmax(0, 1fr); column-gap: 16px; }
  .g-cycles[data-ui="live-touch"] { grid-template-columns: minmax(0, 1fr) auto; }
  .g-cycles[data-ui="live-touch"] > .cy-row { grid-area: 1 / 1; }
  .g-cycles[data-ui="live-touch"] > .cy-pad { grid-area: 1 / 2; align-self: center; }
  .g-cycles[data-ui="live-touch"] .cy-info { left: auto; gap: 14px; padding: 0 24px 0 0; }
  .g-cycles[data-ui="local-touch-p"] { grid-template-columns: auto minmax(0, 1fr) auto; }
  .g-cycles[data-ui="local-touch-p"] > .cy-pad.p-b { grid-area: 1 / 1; align-self: center; }
  .g-cycles[data-ui="local-touch-p"] > .cy-row { grid-area: 1 / 2; }
  .g-cycles[data-ui="local-touch-p"] > .cy-pad.p-a { grid-area: 1 / 3; align-self: center; }
  .g-cycles[data-ui*="touch"] .cy-pad .cy-pad-keys { grid-template-columns: repeat(3, 56px); grid-template-rows: repeat(2, 52px); gap: 6px; }
  .g-cycles[data-ui*="touch"] .cy-pad .cy-d0 { grid-column: 2; grid-row: 1; }
  .g-cycles[data-ui*="touch"] .cy-pad .cy-d3 { grid-column: 1; grid-row: 2; }
  .g-cycles[data-ui*="touch"] .cy-pad .cy-d2 { grid-column: 2; grid-row: 2; }
  .g-cycles[data-ui*="touch"] .cy-pad .cy-d1 { grid-column: 3; grid-row: 2; }
}
/* a small phone on its side (667x375, 568x320): slimmer pads so the board keeps its size */
@media (orientation: landscape) and (max-height: 520px) and (max-width: 760px) {
  .g-cycles[data-ui*="touch"] { column-gap: 8px; }
  .g-cycles[data-ui*="touch"] .cy-row { gap: 6px; }
  .g-cycles[data-ui*="touch"] .cy-pad { gap: 4px; }
  .g-cycles[data-ui*="touch"] .cy-pad .cy-pad-keys { grid-template-columns: repeat(3, 44px); grid-template-rows: repeat(2, 46px); gap: 4px; }
  .g-cycles[data-ui*="touch"] .cy-pad-name { font-size: 0.7rem; }
}
/* a short screen (a small upright phone, a 500 px laptop): the picker keeps GO in view */
@media (max-height: 640px) {
  .g-cycles .cy-pick { gap: 8px; padding: 10px 10px 12px; }
  .g-cycles .cy-pick-t { font-size: 1.12rem; }
  .g-cycles .cy-chip { min-height: 84px; }
}
@media (prefers-reduced-motion: reduce) { .g-cycles *, .g-cycles *::before { animation: none !important; transition: none !important; } }

@media (orientation: landscape) and (max-height: 520px) {
  .g-cycles .cy-pick { width: min(100%, 860px); padding: 6px 10px 8px; gap: 5px; flex-direction: row; flex-wrap: wrap; align-items: center; }
  .g-cycles .cy-pick-t { flex: 1 1 100%; font-size: 1.05rem; }
  .g-cycles .cy-pick-sub { flex: 1 1 100%; }
  .g-cycles .cy-chips { flex: 1 1 100%; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; }
  .g-cycles .cy-chip { min-height: 64px; font-size: 0.68rem; padding: 4px 2px 5px; gap: 4px; }
  .g-cycles .cy-mini { width: 30px; } .g-cycles .cy-mini.is-wide { width: 44px; }
  .g-cycles .cy-glyph { width: 30px; height: 44px; font-size: 1.4rem; }
  .g-cycles .cy-rp-skip { display: none; }
  .g-cycles .cy-recs { flex: 1 1 0; min-width: 0; text-align: left; margin-left: 16px; }
  .g-cycles .cy-go { align-self: center; flex: 0 0 auto; width: 200px; }
}
/* a very short screen (667x375, 568x320): the host's status line already says "Pick an arena", so the picker drops its title and blurb */
@media (orientation: landscape) and (max-height: 400px) {
  .g-cycles .cy-pick:not(.is-ro) .cy-pick-t, .g-cycles .cy-pick:not(.is-ro) .cy-pick-sub { display: none; }
  .g-cycles .cy-chip { min-height: 56px; }
  .g-cycles .cy-mini { width: 26px; } .g-cycles .cy-mini.is-wide { width: 38px; }
  .g-cycles .cy-glyph { height: 34px; }
  .g-cycles .cy-recs { margin-left: 22px; }
}
@media (orientation: landscape) and (max-height: 340px) {
  .g-cycles .cy-pick { padding: 4px 8px 6px; gap: 4px; }
  .g-cycles .cy-pick-sub { display: none; }
  .g-cycles .cy-chip { min-height: 50px; gap: 3px; padding: 3px 2px 4px; }
  .g-cycles .cy-mini { width: 22px; } .g-cycles .cy-mini.is-wide { width: 32px; }
  .g-cycles .cy-glyph { height: 28px; font-size: 1.2rem; } .g-cycles .cy-glyph svg { width: 22px; height: 22px; }
}
`;
