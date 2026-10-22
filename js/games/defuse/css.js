// Defuse: the base styles (lobby, bomb frame, manual shell, wires/button/sequence module art). Each module file adds its own css.
export const CSS = `
.g-defuse { --dx-red: #e0393e; --dx-blue: #2369d6; --dx-yellow: #ffd21f; --dx-green: #1e9a55; --dx-white: #f8f5ec; --dx-black: #23212a; --dx-dark: #18171d;
  position: relative; flex: 1; display: flex; flex-direction: column; gap: 14px; padding: 4px 0 12px; color: var(--g-ink); font-family: var(--g-font-body); }
@media (min-width: 760px) { .g-defuse { width: calc(100vw - 48px); max-width: 1120px; align-self: center; } }
.g-defuse :where(button:not(.gm-btn)) { font: inherit; color: inherit; } .g-defuse button { cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.g-defuse .dx-tag { display: block; font: 800 0.7rem/1.15 var(--g-font-body); letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); }
.g-defuse .dx-h { font: 400 clamp(1.45rem, 5.4vw, 2.1rem)/1.05 var(--g-font-display); margin: 0; }
.g-defuse .f-card { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 3; } .g-defuse .f-lcd { fill: var(--dx-dark); stroke: var(--g-ink); stroke-width: 2.5; }
.g-defuse .f-bad { fill: var(--dx-red); stroke: var(--g-ink); stroke-width: 2.5; } .g-defuse .f-hl { fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 2.5; }
.g-defuse .s-ink { fill: none; stroke: var(--g-ink); stroke-width: 3; stroke-linecap: round; } .g-defuse .s-hl { fill: none; stroke: var(--g-hl); stroke-width: 3; stroke-linecap: round; }
.g-defuse .s-muted { fill: none; stroke: var(--g-muted); stroke-width: 2.5; stroke-linecap: round; } .g-defuse .s-wire { fill: none; stroke: var(--dx-blue); stroke-width: 4; stroke-linecap: round; }
.g-defuse .dx-glyph { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

/* one-device card */
.g-defuse .dx-solo { margin: auto; width: min(100%, 380px); display: flex; flex-direction: column; gap: 12px; padding: 22px; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 14px; box-shadow: var(--g-shadow-lg, 6px 6px 0 var(--g-ink)); }
.g-defuse .dx-solo-art { display: flex; gap: 10px; justify-content: center; } .g-defuse .dx-solo-art svg { width: 72px; height: 72px; }
.g-defuse .dx-solo p { line-height: 1.45; }

/* lobby */
.g-defuse .dx-lobby { width: min(100%, 760px); margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.g-defuse .dx-lead { font-size: 1rem; line-height: 1.45; color: var(--g-muted); font-weight: 600; margin-top: 6px !important; }
.g-defuse .dx-roles { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.g-defuse .dx-role { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 14px 14px 12px; text-align: left; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 14px; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-ink)); transition: transform 0.16s var(--g-ease-spring); min-height: 200px; }
.g-defuse .dx-role:active { transform: translate(3px, 3px); box-shadow: 0 0 0 var(--g-ink); }
.g-defuse .dx-role svg { width: 58px; height: 58px; }
.g-defuse .dx-role-name { font: 400 1.35rem/1 var(--g-font-display); }
.g-defuse .dx-role-desc { font-size: 0.92rem; line-height: 1.35; color: var(--g-muted); font-weight: 600; }
.g-defuse .dx-role-dev { font: 800 0.7rem/1 var(--g-font-body); letter-spacing: 0.12em; text-transform: uppercase; padding: 5px 8px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-hl); color: var(--g-on-ink); }
.g-defuse .dx-role-who { display: flex; flex-wrap: wrap; gap: 6px; min-height: 30px; margin-top: auto; }
.g-defuse .dx-role-who .g-chip { min-height: 26px; }
.g-defuse .dx-role.is-mine { background: var(--g-hl-soft, var(--g-card)); transform: translate(-2px, -2px); box-shadow: 6px 6px 0 var(--g-edge, var(--g-ink)); }
.g-defuse .dx-role.is-clash { border-style: dashed; }
.g-defuse .dx-who { display: inline-flex; align-items: center; min-height: 26px; padding: 2px 10px; border: 2px solid var(--g-ink); border-radius: 999px; font: 800 0.8rem/1 var(--g-font-body); color: var(--g-on-ink); }
.g-defuse .dx-who.p-a { background: var(--p-a); } .g-defuse .dx-who.p-b { background: var(--p-b); }
.g-defuse .dx-hint { display: flex; gap: 8px; align-items: center; font-weight: 700; font-size: 0.92rem; line-height: 1.35; }
.g-defuse .dx-hint i { flex: none; width: 10px; height: 10px; background: var(--g-hl); border: 2px solid var(--g-ink); transform: rotate(45deg); }
.g-defuse .dx-lobby-status { min-height: 1.4em; text-align: center; font-weight: 800; }
.g-defuse .dx-lobby-actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 12px; }
.g-defuse .dx-lobby-actions .gm-btn { min-height: 54px; }

/* the bomb */
.g-defuse .dx-bomb { position: relative; display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 16px; padding: 22px; background-color: var(--g-card); background-image: var(--g-halftone, none); background-size: 6px 6px; border: 3px solid var(--g-ink); border-radius: 24px; box-shadow: 8px 8px 0 var(--g-edge, var(--g-ink)); }
.g-defuse .dx-screw { position: absolute; width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--g-ink); background: var(--g-bg); }
.g-defuse .dx-screw::after { content: ''; position: absolute; left: 1px; right: 1px; top: 50%; height: 2px; margin-top: -1px; background: var(--g-ink); transform: rotate(35deg); }
.g-defuse .dx-screw:nth-child(1) { left: 7px; top: 7px; } .g-defuse .dx-screw:nth-child(2) { right: 7px; top: 7px; }
.g-defuse .dx-screw:nth-child(3) { left: 7px; bottom: 7px; } .g-defuse .dx-screw:nth-child(4) { right: 7px; bottom: 7px; }
.g-defuse .dx-side { display: flex; flex-direction: column; gap: 14px; }
.g-defuse .dx-lcd { padding: 10px 12px 12px; background: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: inset 0 -5px 0 rgb(255 255 255 / 0.06); }
.g-defuse .dx-lcd .dx-tag { color: #8d8a80; }
.g-defuse .dx-time { display: block; font: 400 2.9rem/1 var(--g-font-display); color: var(--dx-yellow); font-variant-numeric: tabular-nums; letter-spacing: 0.02em; text-align: center; margin-top: 4px; }
.g-defuse .dx-bomb.is-hurry .dx-time { color: var(--dx-red); }
.g-defuse .dx-strikes { display: flex; gap: 8px; justify-content: center; }
.g-defuse .dx-strikes i { position: relative; width: 30px; height: 30px; border: 2.5px solid var(--g-ink); border-radius: 7px; background: var(--g-bg); }
.g-defuse .dx-strikes i.on { background: var(--dx-red); }
.g-defuse .dx-strikes i.on::before, .g-defuse .dx-strikes i.on::after { content: ''; position: absolute; left: 4px; right: 4px; top: 50%; height: 3px; margin-top: -1.5px; background: var(--dx-dark); border-radius: 2px; transform: rotate(45deg); }
.g-defuse .dx-strikes i.on::after { transform: rotate(-45deg); }
.g-defuse .dx-sticker { padding: 8px 10px 9px; background: var(--dx-white); color: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 6px; transform: rotate(-1.5deg); box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
.g-defuse .dx-sticker .dx-tag { color: #6a665e; }
.g-defuse .dx-serial { display: block; font: 800 1.5rem/1.1 ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; letter-spacing: 0.12em; }
.g-defuse .dx-bay { display: flex; flex-direction: column; gap: 6px; }
.g-defuse .dx-bats { display: flex; flex-wrap: wrap; gap: 6px; min-height: 22px; align-items: center; }
.g-defuse .dx-bats svg { width: 40px; height: 20px; }
.g-defuse .dx-bats .b-body { fill: var(--dx-yellow); stroke: var(--g-ink); stroke-width: 2.2; } .g-defuse .dx-bats .b-band { fill: var(--dx-dark); } .g-defuse .dx-bats .b-nub { fill: var(--g-ink); }
.g-defuse .dx-none { font-size: 0.82rem; font-weight: 700; color: var(--g-muted); padding: 3px 8px; border: 2px dashed var(--g-line); border-radius: 6px; }
.g-defuse .dx-inds { display: flex; gap: 8px; flex-wrap: wrap; }
.g-defuse .dx-ind { display: inline-flex; align-items: center; gap: 7px; padding: 5px 9px 5px 6px; background: var(--g-bg); border: 2px solid var(--g-ink); border-radius: 8px; font: 800 0.9rem/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.06em; }
.g-defuse .dx-ind i { width: 15px; height: 15px; border-radius: 50%; border: 2px solid var(--g-ink); background: color-mix(in srgb, var(--g-ink) 22%, var(--g-card)); }
.g-defuse .dx-ind.is-lit i { background: var(--dx-yellow); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dx-yellow) 35%, transparent); }
.g-defuse .dx-mod { position: relative; display: flex; flex-direction: column; min-height: 220px; padding: 10px 12px 12px; background: color-mix(in srgb, var(--g-ink) 5%, var(--g-card)); border: 2.5px solid var(--g-ink); border-radius: 14px; box-shadow: inset 3px 3px 0 color-mix(in srgb, var(--g-ink) 10%, transparent); }
.g-defuse .dx-mod-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.g-defuse .dx-mod-tag { padding: 4px 8px; background: var(--g-ink); color: var(--g-bg); border-radius: 6px; font: 800 0.7rem/1 var(--g-font-body); letter-spacing: 0.14em; text-transform: uppercase; }
.g-defuse .dx-led { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--g-ink); background: color-mix(in srgb, var(--g-ink) 18%, var(--g-card)); transition: background-color 0.15s; }
.g-defuse .dx-mod.is-solved .dx-led { background: var(--g-good); box-shadow: 0 0 0 3px color-mix(in srgb, var(--g-good) 30%, transparent); }
.g-defuse .dx-mod.is-bad .dx-led { background: var(--g-bad); }
.g-defuse .dx-mod.is-solved::after { content: ''; position: absolute; inset: 0; border-radius: 12px; background: repeating-linear-gradient(-45deg, transparent 0 9px, color-mix(in srgb, var(--g-good) 12%, transparent) 9px 11px); pointer-events: none; }
.g-defuse .dx-mod-body { flex: 1; display: grid; place-items: center; padding-top: 8px; }
.g-defuse .dx-wires { width: 100%; max-width: 290px; height: auto; display: block; overflow: visible; }
.g-defuse .dx-term { fill: color-mix(in srgb, var(--g-ink) 14%, var(--g-card)); stroke: var(--g-ink); stroke-width: 2.5; }
.g-defuse .dx-stud { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 2; }
.g-defuse .dx-wire { cursor: pointer; outline: none; }
.g-defuse .dx-wire .o { fill: none; stroke: var(--g-ink); stroke-width: 11; stroke-linecap: round; }
.g-defuse .dx-wire .c { fill: none; stroke: var(--w); stroke-width: 6.5; stroke-linecap: round; }
.g-defuse .dx-wire .s { fill: none; stroke: color-mix(in srgb, #fff 45%, var(--w)); stroke-width: 1.6; stroke-linecap: round; stroke-dasharray: 14 9; transform: translateY(-1.6px); }
.g-defuse .dx-wire .hit { fill: none; stroke: transparent; stroke-width: 24; pointer-events: stroke; }
.g-defuse .dx-wire .cut, .g-defuse .dx-wire.is-cut .whole { display: none; } .g-defuse .dx-wire.is-cut .cut { display: inline; }
.g-defuse .dx-wire .tip { fill: var(--dx-yellow); stroke: var(--g-ink); stroke-width: 1.5; }
.g-defuse .dx-wire:focus-visible .o { stroke: var(--p-a); }
@media (hover: hover) { .g-defuse .dx-wire:not(.is-cut):hover .o { stroke-width: 13.5; } }
.g-defuse .dx-btnwrap { display: flex; align-items: center; gap: 22px; }
.g-defuse .dx-big { position: relative; width: 132px; height: 132px; border-radius: 50%; border: 3px solid var(--g-ink); background: var(--bc); color: var(--dx-dark); box-shadow: 0 9px 0 var(--g-ink); transform: translateY(-4px); transition: transform 0.16s var(--g-ease-spring); touch-action: none; user-select: none; -webkit-user-select: none; }
.g-defuse .dx-big::before { content: ''; position: absolute; inset: 9px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--dx-dark) 30%, transparent); }
.g-defuse .dx-big span { position: relative; font: 400 1.35rem/1 var(--g-font-display); letter-spacing: 0.04em; }
.g-defuse .dx-big.is-down { transform: translateY(4px); box-shadow: 0 1px 0 var(--g-ink); }
.g-defuse .dx-big:focus-visible { outline: 3px solid var(--p-a); outline-offset: 4px; }
.g-defuse .dx-strip { width: 22px; height: 128px; padding: 4px; border: 2.5px solid var(--g-ink); border-radius: 11px; background: var(--dx-dark); }
.g-defuse .dx-strip i { display: block; height: 100%; border-radius: 6px; background: #3a3842; transition: background-color 0.12s; }
.g-defuse .dx-strip.is-on i { background: var(--sc); }
.g-defuse .dx-keys { display: grid; grid-template-columns: repeat(2, 86px); gap: 12px; }
.g-defuse .dx-gkey { position: relative; display: grid; place-items: center; width: 86px; height: 86px; padding: 18px 16px 12px; background: var(--dx-white); color: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: 0 5px 0 var(--g-ink); transition: transform 0.16s var(--g-ease-spring); }
.g-defuse .dx-gkey:active { transform: translateY(4px); box-shadow: 0 1px 0 var(--g-ink); }
.g-defuse .dx-gkey .dx-kled { position: absolute; top: 6px; left: 50%; width: 22px; height: 7px; margin-left: -11px; border-radius: 4px; border: 1.5px solid var(--dx-dark); background: #bdb8ad; }
.g-defuse .dx-gkey.is-ok .dx-kled { background: var(--dx-green); } .g-defuse .dx-gkey.is-no .dx-kled { background: var(--dx-red); }
.g-defuse .dx-gkey .dx-glyph { width: 44px; height: 44px; stroke-width: 2.2; }
.g-defuse .dx-gkey:focus-visible { outline: 3px solid var(--p-a); outline-offset: 3px; }
.g-defuse .dx-seqwrap { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.g-defuse .dx-seq { display: grid; grid-template-columns: repeat(2, 74px); gap: 12px; transform: rotate(45deg); margin: 18px; }
.g-defuse .dx-pad { position: relative; width: 74px; height: 74px; border: 2.5px solid var(--g-ink); border-radius: 12px; background: color-mix(in srgb, var(--pc) 34%, var(--g-card)); box-shadow: 3px 3px 0 var(--g-ink); transition: transform 0.16s var(--g-ease-spring); }
.g-defuse .dx-pad span { position: absolute; left: 7px; top: 5px; transform: rotate(-45deg); font: 800 0.72rem/1 var(--g-font-body); color: var(--g-ink); opacity: 0.75; }
.g-defuse .dx-pad.is-lit { background: var(--pc); transform: translate(-2px, -2px); box-shadow: 5px 5px 0 var(--g-ink); }
.g-defuse .dx-pad.is-lit span { color: var(--dx-dark); }
.g-defuse .dx-pad:active { transform: translate(2px, 2px); box-shadow: 0 0 0 var(--g-ink); }
.g-defuse .dx-pad:focus-visible { outline: 3px solid var(--p-a); outline-offset: 3px; }
.g-defuse .dx-stage { display: flex; gap: 6px; }
.g-defuse .dx-stage i { width: 12px; height: 12px; border: 2px solid var(--g-ink); border-radius: 50%; background: var(--g-card); }
.g-defuse .dx-stage i.on { background: var(--g-good); } .g-defuse .dx-stage i.now { background: var(--g-hl); }
.g-defuse .is-shake { animation: dx-shake 0.36s ease-out; }
@keyframes dx-shake { 0%, 100% { translate: 0 0; } 20% { translate: -6px 1px; } 40% { translate: 5px -1px; } 60% { translate: -3px 1px; } 80% { translate: 2px 0; } }

/* finale */
.g-defuse .dx-fx { position: fixed; inset: 0; z-index: 3; display: grid; place-items: center; padding: 120px 16px 16px; pointer-events: none; }
.g-defuse .dx-fx:empty { display: none; }
.g-defuse .dx-boom { position: relative; width: min(92%, 520px); aspect-ratio: 1.15; display: grid; place-items: center; animation: dx-boom 0.5s cubic-bezier(0.2, 1.5, 0.4, 1) both; }
.g-defuse .dx-boom svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.g-defuse .dx-boom .b1 { fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 5; stroke-linejoin: round; }
.g-defuse .dx-boom .b2 { fill: var(--dx-red); stroke: var(--g-ink); stroke-width: 4; stroke-linejoin: round; }
.g-defuse .dx-boom .b0 { fill: var(--g-edge, var(--g-ink)); }
.g-defuse .dx-boom b { position: relative; font: 400 clamp(3rem, 15vw, 5.6rem)/1 var(--g-font-display); color: var(--g-hl); -webkit-text-stroke: 2.5px var(--dx-dark); paint-order: stroke fill; text-shadow: 4px 4px 0 var(--dx-dark); transform: rotate(-6deg); }
@keyframes dx-boom { from { transform: scale(0.3) rotate(-12deg); opacity: 0; } to { transform: scale(1) rotate(0); opacity: 1; } }
.g-defuse .dx-stamp { padding: 14px 22px 12px; text-align: center; background: var(--g-card); color: var(--g-good); border: 5px double var(--g-good); border-radius: 12px; transform: rotate(-7deg); box-shadow: var(--g-shadow-lg, 6px 6px 0 var(--g-ink)); animation: dx-stamp 0.45s cubic-bezier(0.2, 1.4, 0.4, 1) both; }
.g-defuse .dx-stamp b { display: block; font: 400 clamp(2.4rem, 11vw, 4.2rem)/1 var(--g-font-display); letter-spacing: 0.04em; }
.g-defuse .dx-stamp span { font-weight: 800; font-size: 1.05rem; color: var(--g-ink); }
@keyframes dx-stamp { from { transform: rotate(-7deg) scale(2.2); opacity: 0; } to { transform: rotate(-7deg) scale(1); opacity: 1; } }
.g-defuse.is-boom .dx-bomb, .g-defuse.is-boom .dx-manual-wrap { filter: grayscale(1); opacity: 0.5; }

/* the manual: a field guide */
.g-defuse .dx-mbody { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 22px; align-items: start; }
.g-defuse .dx-page { position: relative; padding: 22px 26px 26px; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 6px 14px 14px 6px; box-shadow: var(--g-shadow-lg, 6px 6px 0 var(--g-ink)); font-size: 1.12rem; line-height: 1.55; }
.g-defuse .dx-page::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 10px; border-right: 2px solid var(--g-ink); background: var(--g-hl); border-radius: 4px 0 0 4px; }
.g-defuse .dx-sec[hidden] { display: none !important; }
.g-defuse .dx-run { display: flex; justify-content: space-between; gap: 10px; padding-bottom: 8px; margin-bottom: 14px; border-bottom: 2px solid var(--g-ink); font: 800 0.7rem/1.2 var(--g-font-body); letter-spacing: 0.16em; text-transform: uppercase; color: var(--g-muted); }
.g-defuse .dx-sec h3 { margin: 0 0 10px; font: 400 clamp(1.5rem, 6vw, 2rem)/1.05 var(--g-font-display); display: flex; align-items: center; gap: 12px; }
.g-defuse .dx-sec h3 .n { flex: none; display: grid; place-items: center; width: 38px; height: 38px; border: 2.5px solid var(--g-ink); border-radius: 50%; background: var(--g-hl); color: var(--g-on-ink); font-size: 1rem; }
.g-defuse .dx-sec h4 { margin: 18px 0 8px; font: 800 0.78rem/1.2 var(--g-font-body); letter-spacing: 0.14em; text-transform: uppercase; display: flex; align-items: center; gap: 8px; }
.g-defuse .dx-sec h4::after { content: ''; flex: 1; height: 2px; background: var(--g-line); }
.g-defuse .dx-sec p { margin: 0 0 10px; }
.g-defuse .dx-sec .dx-intro { font-weight: 600; }
.g-defuse .dx-rules { list-style: none; counter-reset: rule; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.g-defuse .dx-rules li { counter-increment: rule; display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; align-items: start; }
.g-defuse .dx-rules li::before { content: counter(rule); display: grid; place-items: center; width: 28px; height: 28px; margin-top: 1px; border: 2px solid var(--g-ink); border-radius: 6px; background: var(--g-bg); font: 400 0.82rem/1 var(--g-font-display); }
.g-defuse .dx-note { padding: 10px 12px; margin-top: 12px !important; border: 2px dashed var(--g-ink); border-radius: 8px; font-size: 0.98rem; }
.g-defuse .dx-sw { display: inline-block; width: 0.95em; height: 0.95em; margin-right: 6px; vertical-align: -0.12em; border: 2px solid var(--g-ink); border-radius: 3px; background: var(--sw); }
.g-defuse table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 1rem; margin: 6px 0 4px; }
.g-defuse th, .g-defuse td { border: 2px solid var(--g-ink); padding: 7px 8px; text-align: left; }
.g-defuse th { font: 800 0.72rem/1.2 var(--g-font-body); letter-spacing: 0.1em; text-transform: uppercase; background: var(--g-bg); }
.g-defuse td.is-now, .g-defuse th.is-now { background: var(--g-hl-soft, var(--g-bg)); }
.g-defuse .dx-cols { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; max-width: 520px; }
.g-defuse .dx-col { display: flex; flex-direction: column; gap: 6px; padding: 6px; border: 2px solid var(--g-ink); border-radius: 10px; background: var(--g-bg); }
.g-defuse .dx-col b { text-align: center; font: 400 0.95rem/1 var(--g-font-display); padding: 2px 0 4px; border-bottom: 2px solid var(--g-ink); }
.g-defuse .dx-col span { display: grid; place-items: center; aspect-ratio: 1; padding: 6px; background: var(--g-card); border: 1.5px solid var(--g-ink); border-radius: 7px; }
.g-defuse .dx-col .dx-glyph { width: 100%; max-width: 40px; }
.g-defuse .dx-foot { margin-top: 18px !important; padding-top: 8px; border-top: 2px solid var(--g-line); font-size: 0.8rem; color: var(--g-muted); font-weight: 700; display: flex; justify-content: space-between; }

@media (max-width: 759px) {
  .g-defuse .dx-bomb { grid-template-columns: 1fr; padding: 18px 14px 16px; border-radius: 20px; box-shadow: 6px 6px 0 var(--g-edge, var(--g-ink)); }
  .g-defuse .dx-mbody { grid-template-columns: 1fr; gap: 12px; }
  .g-defuse .dx-page { padding: 16px 14px 18px 22px; font-size: 1.06rem; }
  .g-defuse .dx-cols { gap: 6px; } .g-defuse .dx-col { padding: 4px; gap: 4px; } .g-defuse .dx-col span { padding: 4px; }
  .g-defuse th, .g-defuse td { padding: 6px 5px; font-size: 0.92rem; }
}
@media (max-width: 440px) {
  .g-defuse th, .g-defuse td { padding: 6px 4px; font-size: 0.88rem; overflow-wrap: anywhere; }
  .g-defuse th { font-size: 0.72rem; letter-spacing: 0.03em; }
  .g-defuse td .dx-sw, .g-defuse tbody th .dx-sw { display: block; margin: 0 0 4px; }
}
@media (max-width: 380px) { .g-defuse .dx-roles { gap: 10px; } .g-defuse .dx-role { padding: 12px 10px; } .g-defuse .dx-role-name { font-size: 1.15rem; } }
@media (prefers-reduced-motion: reduce) { .g-defuse *, .g-defuse *::before, .g-defuse *::after { animation: none !important; transition: none !important; } }

/* ── tiers, records, nudges (lobby) ── */
.g-defuse .dx-tiers { display: grid; grid-template-columns: repeat(30, 1fr); gap: 2px; border: 2.5px solid var(--g-ink); border-radius: 12px; overflow: hidden; background: var(--g-ink); box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
.g-defuse .dx-tiers button { grid-column: span 6; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 9px 4px 8px; min-height: 60px; background: var(--g-card); border: 0; }
.g-defuse .dx-tiers b { font: 400 0.92rem/1.05 var(--g-font-display); text-align: center; }
.g-defuse .dx-tiers .c { font-size: 0.78rem; font-weight: 700; color: var(--g-muted); font-variant-numeric: tabular-nums; }
.g-defuse .dx-tiers button[aria-checked="true"] { background: var(--g-ink); color: var(--g-bg); } .g-defuse .dx-tiers button[aria-checked="true"] .c { color: inherit; opacity: 0.8; }
.g-defuse .dx-pips { display: flex; gap: 3px; height: 9px; }
.g-defuse .dx-pips i { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid currentColor; opacity: 0.4; }
.g-defuse .dx-pips i.on { background: var(--g-hl); border-color: var(--g-edge, var(--g-ink)); opacity: 1; }
.g-defuse .dx-tiers button[aria-checked="true"] .dx-pips i.on { border-color: var(--g-bg); }
.g-defuse .dx-tierinfo { margin: -6px 0 0; font-size: 0.9rem; line-height: 1.35; font-weight: 700; color: var(--g-muted); text-align: center; }
.g-defuse .dx-today { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 8px 12px; border: 2.5px solid var(--g-ink); border-radius: 12px; background: var(--g-card); font-weight: 800; text-align: left; }
.g-defuse .dx-today i { flex: none; width: 22px; height: 22px; border: 2.5px solid var(--g-ink); border-radius: 6px; background: var(--g-bg); }
.g-defuse .dx-today[aria-checked="true"] { background: var(--g-hl-soft, var(--g-card)); } .g-defuse .dx-today[aria-checked="true"] i { background: var(--g-hl); box-shadow: inset 0 0 0 3px var(--g-bg); }
.g-defuse .dx-today span { font-size: 0.92rem; line-height: 1.25; }
.g-defuse .dx-rec { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 2px dashed var(--g-line); border-radius: 12px; font-size: 0.9rem; font-weight: 700; line-height: 1.35; }
.g-defuse .dx-rec:empty { display: none; }
.g-defuse .dx-rec .row { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.g-defuse .dx-rec b { font-variant-numeric: tabular-nums; }
.g-defuse .dx-rec .log { display: flex; flex-wrap: wrap; gap: 4px 8px; font-size: 0.8rem; color: var(--g-muted); }
.g-defuse .dx-rec .log span { padding: 2px 8px; border: 1.5px solid var(--g-line); border-radius: 999px; white-space: nowrap; }
.g-defuse .dx-rec .log span.win { border-color: var(--g-good); color: var(--g-good); }
.g-defuse .dx-nudge { margin: 0; font-weight: 800; font-size: 0.92rem; text-align: center; color: var(--g-ink); }
.g-defuse .dx-nudge[hidden] { display: none; }
.g-defuse [data-act="swap"].is-nudged { box-shadow: 0 0 0 3px var(--g-hl); }

/* ── the bomb: grid of 3–7 modules ── */
.g-defuse .dx-mods { position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-content: start; }
.g-defuse .dx-mods[data-k="3"], .g-defuse .dx-mods[data-k="5"], .g-defuse .dx-mods[data-k="6"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.g-defuse .dx-mod { min-width: 0; min-height: 220px; }
.g-defuse .dx-mod.is-needy { grid-column: 1 / -1; min-height: 0; }
.g-defuse .dx-mod.is-remote { background: color-mix(in srgb, var(--g-hl) 10%, var(--g-card)); }
.g-defuse .dx-mod-head { flex-wrap: wrap; row-gap: 4px; }
.g-defuse .dx-mod-end { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
.g-defuse .dx-plate { display: inline-block; padding: 2px 9px 1px; background: var(--dx-white); color: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 6px; font: 400 1.5rem/1.15 var(--g-font-display); letter-spacing: 0.06em; font-variant-numeric: tabular-nums; transform: rotate(-2deg); box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
.g-defuse .dx-plate::before { content: 'No. '; font: 800 0.7rem/1 var(--g-font-body); letter-spacing: 0.12em; text-transform: uppercase; vertical-align: 0.5em; margin-right: 3px; }
.g-defuse .dx-mod.is-gold { border-color: #b88a00; box-shadow: inset 3px 3px 0 color-mix(in srgb, var(--dx-yellow) 40%, transparent), 0 0 0 3px var(--dx-yellow); }
.g-defuse .dx-mod.is-gold .dx-plate { background: var(--dx-yellow); }
.g-defuse .dx-goldtag { padding: 2px 7px; background: var(--dx-yellow); color: var(--dx-dark); border: 2px solid var(--g-ink); border-radius: 6px; font: 800 0.7rem/1.2 var(--g-font-body); letter-spacing: 0.14em; }
.g-defuse .dx-mods.is-dark::after { content: 'BLACKOUT'; position: absolute; inset: -6px; z-index: 4; display: grid; place-items: center; background: #0b0a10; color: #4a4655; border-radius: 16px; font: 400 clamp(1.4rem, 5vw, 2.4rem)/1 var(--g-font-display); letter-spacing: 0.14em; }
.g-defuse .dx-mods.is-warn { outline: 4px dashed var(--dx-red); outline-offset: 4px; }
.g-defuse .dx-mod.is-needy .dx-mod-body { place-items: center; }

.g-defuse .dx-side .dx-sticker.is-void { position: relative; }
.g-defuse .dx-void-stamp { position: absolute; right: 6px; top: 10px; padding: 1px 8px; border: 3px solid var(--dx-red); border-radius: 6px; color: var(--dx-red); font: 400 1.25rem/1.2 var(--g-font-display); letter-spacing: 0.14em; transform: rotate(-12deg); background: color-mix(in srgb, var(--dx-white) 80%, transparent); }
.g-defuse .dx-ind.is-void { position: relative; opacity: 0.85; }
.g-defuse .dx-ind.is-void::after { content: 'VOID'; position: absolute; right: -4px; top: -9px; padding: 0 4px; background: var(--dx-red); color: #fff; border-radius: 4px; font: 800 0.7rem/1.3 var(--g-font-body); letter-spacing: 0.08em; transform: rotate(8deg); }
.g-defuse .dx-ports { display: flex; flex-wrap: wrap; gap: 6px; }
.g-defuse .dx-port { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 6px; background: var(--g-bg); border: 2px solid var(--g-ink); border-radius: 8px; font: 800 0.8rem/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.04em; }
.g-defuse .dx-port svg { width: 22px; height: 14px; fill: var(--g-ink); }
.g-defuse .dx-edition { display: block; margin-top: 6px; font: 800 0.7rem/1.3 var(--g-font-body); letter-spacing: 0.1em; text-transform: uppercase; color: #6a665e; }
.g-defuse .dx-edition b { color: var(--dx-dark); }

.g-defuse .dx-side { position: relative; }
.g-defuse .dx-time.is-surge, .g-defuse .dx-mbar .dx-time.is-surge { color: var(--dx-red); }
.g-defuse .dx-surgetxt { display: block; min-height: 1em; margin-top: 2px; text-align: center; font: 800 0.7rem/1 var(--g-font-body); letter-spacing: 0.14em; color: var(--dx-red); }
.g-defuse .dx-surgetxt:empty { visibility: hidden; }
.g-defuse .dx-topbar { display: none; }
.g-defuse .dx-flags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.g-defuse .dx-flag { padding: 4px 8px 3px; border: 2px solid var(--g-ink); border-radius: 6px; font: 400 0.8rem/1.1 var(--g-font-display); letter-spacing: 0.08em; background: var(--dx-red); color: #fff; white-space: nowrap; }
.g-defuse .dx-flag[hidden] { display: none; }
.g-defuse .dx-flag[data-flag="vent"] { background: var(--dx-yellow); color: var(--dx-dark); }
.g-defuse .dx-flag[data-flag="dark"] { background: var(--dx-dark); color: var(--dx-yellow); }
.g-defuse .dx-flag[data-flag="gold"] { background: var(--dx-yellow); color: var(--dx-dark); }
.g-defuse .dx-flag.is-pulse { animation: dx-pulse 0.7s ease-in-out infinite alternate; }
@keyframes dx-pulse { from { transform: scale(1); } to { transform: scale(1.08); } }
.g-defuse .dx-pause { position: fixed; inset: 0; z-index: 6; display: grid; place-items: center; padding: 16px; background: var(--g-dim, rgb(0 0 0 / 0.5)); }
.g-defuse .dx-pause[hidden] { display: none; }
.g-defuse .dx-pause > div { width: min(100%, 360px); padding: 20px; text-align: center; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 14px; box-shadow: var(--g-shadow-lg, 6px 6px 0 var(--g-ink)); }
.g-defuse .dx-pause b { display: block; font: 400 1.5rem/1.1 var(--g-font-display); margin-bottom: 6px; }
.g-defuse .dx-pause span { font-weight: 700; line-height: 1.4; color: var(--g-muted); }
.g-defuse .dx-stamp small { display: block; margin-top: 6px; font-weight: 800; font-size: 0.92rem; color: var(--g-ink); max-width: 22ch; margin-inline: auto; line-height: 1.3; }
.g-defuse .dx-stamp .dx-medal { display: flex; gap: 6px; justify-content: center; margin-top: 8px; }
.g-defuse .dx-stamp .dx-medal i { width: 16px; height: 16px; border-radius: 50%; border: 2.5px solid var(--g-ink); background: var(--g-bg); }
.g-defuse .dx-stamp .dx-medal i.on { background: var(--g-hl); }
.g-defuse.is-boom .dx-bomb, .g-defuse.is-boom .dx-manual-wrap, .g-defuse.is-boom .dx-topbar { filter: grayscale(1); opacity: 0.5; }

/* ── the manual ── */
.g-defuse .dx-manual-wrap { display: flex; flex-direction: column; gap: 14px; }
.g-defuse .dx-mbar { position: sticky; top: 0; z-index: 3; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 7px 12px; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-ink)); }
.g-defuse .dx-mbar .dx-lcd { padding: 4px 10px 5px; border-radius: 9px; }
.g-defuse .dx-mbar .dx-time { font-size: 1.7rem; margin: 0; }
.g-defuse .dx-mbar .dx-strikes { gap: 5px; align-items: center; } .g-defuse .dx-mbar .dx-strikes .dx-tag { margin-right: 4px; } .g-defuse .dx-mbar .dx-strikes i { width: 22px; height: 22px; border-radius: 5px; }
.g-defuse .dx-mbar .dx-strikes i.on::before, .g-defuse .dx-mbar .dx-strikes i.on::after { left: 3px; right: 3px; height: 2.5px; }
.g-defuse .dx-mbar.is-bad { border-color: var(--g-bad); }
.g-defuse .dx-mbar.is-surge { border-color: var(--dx-red); }
.g-defuse .dx-lamps { display: flex; gap: 6px 10px; margin-left: auto; justify-content: flex-end; flex-wrap: wrap; }
.g-defuse .dx-lamp { display: inline-flex; align-items: center; gap: 5px; font: 800 0.7rem/1 var(--g-font-body); letter-spacing: 0.06em; text-transform: uppercase; color: var(--g-muted); }
.g-defuse .dx-lamp i { width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--g-ink); background: color-mix(in srgb, var(--g-ink) 15%, var(--g-card)); }
.g-defuse .dx-lamp.on { color: var(--g-ink); } .g-defuse .dx-lamp.on i { background: var(--g-good); }
.g-defuse .dx-mbody { align-items: start; }
.g-defuse .dx-index { position: sticky; top: calc(var(--dx-mbar-h, 70px) + 10px); display: flex; flex-direction: column; gap: 8px; }
.g-defuse .dx-index button { position: relative; display: grid; grid-template-columns: 64px 1fr; align-items: center; gap: 8px; min-height: 52px; padding: 6px 10px 6px 6px; text-align: left; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 10px; font-weight: 800; font-size: 0.98rem; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
.g-defuse .dx-index .big { display: block; text-align: center; font: 400 1.2rem/1 var(--g-font-display); font-variant-numeric: tabular-nums; letter-spacing: 0.04em; padding: 5px 0 4px; border: 2px solid var(--g-ink); border-radius: 6px; background: var(--dx-white); color: var(--dx-dark); }
.g-defuse .dx-index .sm { font: 800 0.8rem/1.15 var(--g-font-body); letter-spacing: 0.04em; text-transform: uppercase; }
.g-defuse .dx-index button[aria-selected="true"] { background: var(--g-ink); color: var(--g-bg); }
.g-defuse .dx-index button[aria-selected="true"] .big { border-color: var(--g-bg); background: var(--g-hl); color: var(--g-on-ink); }
.g-defuse .dx-index button.is-done .big { background: var(--g-good); color: var(--g-card); }
.g-defuse .dx-index button.is-done .big::after { content: ''; display: inline-block; width: 0.4em; height: 0.7em; margin-left: 5px; border: solid currentColor; border-width: 0 3px 3px 0; transform: rotate(40deg) translate(-2px, -3px); }
.g-defuse .dx-index button.is-gold { box-shadow: 0 0 0 3px var(--dx-yellow); }
.g-defuse .dx-index button.is-gold .big { background: var(--dx-yellow); }
.g-defuse .dx-index button.is-twin .big { font-size: 1rem; }
.g-defuse .dx-slip { position: relative; margin: 6px 0 16px; padding: 12px 14px; background: var(--dx-yellow); color: var(--dx-dark); border: 2px solid var(--g-ink); transform: rotate(-0.6deg); font-size: 1rem; line-height: 1.45; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
.g-defuse .dx-slip::before, .g-defuse .dx-slip::after { content: ''; position: absolute; top: -9px; width: 46px; height: 16px; background: color-mix(in srgb, var(--dx-white) 70%, transparent); border: 1.5px solid color-mix(in srgb, var(--g-ink) 35%, transparent); }
.g-defuse .dx-slip::before { left: 12px; transform: rotate(-6deg); } .g-defuse .dx-slip::after { right: 12px; transform: rotate(5deg); }
.g-defuse .dx-slip b.dx-slip-tag { display: block; font: 800 0.7rem/1 var(--g-font-body); letter-spacing: 0.16em; text-transform: uppercase; margin-bottom: 4px; }
.g-defuse .dx-thisbomb { margin: 14px 0 6px; padding: 12px 14px 14px; border: 2.5px solid var(--g-ink); border-radius: 10px; background: var(--g-hl-soft, var(--g-bg)); }
.g-defuse .dx-thisbomb h4 { margin-top: 0; }
.g-defuse .dx-thisbomb .dx-bomb-head { font-weight: 800; margin: 0 0 8px; }
.g-defuse .dx-thisbomb .dx-rules li { font-size: 1rem; }
.g-defuse .dx-drawer { position: sticky; bottom: 0; z-index: 4; margin-top: 4px; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 14px 14px 0 0; box-shadow: var(--g-shadow-lg, 6px 6px 0 var(--g-ink)); padding-bottom: env(safe-area-inset-bottom); }
.g-defuse .dx-drawer[hidden] { display: none; }
.g-defuse .dx-drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 48px; padding: 6px 14px; background: none; border: 0; font: 400 1.05rem/1 var(--g-font-display); letter-spacing: 0.04em; text-align: left; }
.g-defuse .dx-drawer-head small { font: 800 0.7rem/1 var(--g-font-body); letter-spacing: 0.1em; text-transform: uppercase; color: var(--g-muted); }
.g-defuse .dx-drawer-body { max-height: min(45vh, 520px); overflow: auto; padding: 0 12px 12px; }
.g-defuse .dx-drawer:not(.is-open) .dx-drawer-body { display: none; }
.g-defuse .dx-ed { white-space: nowrap; }
@media (max-height: 500px) { .g-defuse .dx-drawer-body { max-height: 30vh; } }
.g-defuse .dx-drawer.is-done .dx-drawer-head { color: var(--g-good); }
.g-defuse .dx-drawer .dx-relay-box { margin-top: 0; padding: 8px; gap: 8px; }
.g-defuse .dx-drawer .dx-relay-lamp { padding: 4px 10px; }
.g-defuse .dx-drawer .dx-relay-row { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.g-defuse .dx-drawer .dx-relay-sw { min-height: 112px; padding: 6px 2px 6px; }
.g-defuse .dx-drawer .dx-relay-cap { width: 42px; height: 42px; } .g-defuse .dx-drawer .dx-relay-cap b { font-size: 1.2rem; }
.g-defuse .dx-drawer .dx-relay-sw small { font-size: 0.7rem; letter-spacing: 0.05em; }
.g-defuse .dx-drawer .dx-relay-lever { width: 22px; height: 36px; } .g-defuse .dx-drawer .dx-relay-state { font-size: 0.8rem; }
.g-defuse .dx-openrelay { min-height: 48px; padding: 8px 14px; background: var(--g-hl); color: var(--g-on-ink); border: 2.5px solid var(--g-ink); border-radius: 10px; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); font-weight: 800; }

@media (min-width: 760px) and (max-width: 1099px) {
  .g-defuse .dx-bomb { grid-template-columns: 1fr; }
  .g-defuse .dx-side { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px 14px; align-items: start; }
}
/* narrower than a laptop: the clock, strikes and flags live in a compact bar that stays on screen while you scroll the modules */
@media (max-width: 1099px) {
  .g-defuse .dx-side .dx-lcd, .g-defuse .dx-side .dx-strikes, .g-defuse .dx-side .dx-flags { display: none; }
  .g-defuse .dx-topbar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 8px 10px; padding: 6px 10px; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-ink)); flex-wrap: wrap; }
  .g-defuse .dx-topbar .dx-lcd { padding: 3px 10px 4px; border-radius: 8px; }
  .g-defuse .dx-topbar .dx-time { margin: 0; font-size: 1.7rem; }
  .g-defuse .dx-topbar .dx-strikes { gap: 5px; } .g-defuse .dx-topbar .dx-strikes i { width: 22px; height: 22px; border-radius: 5px; }
  .g-defuse .dx-topbar .dx-strikes i.on::before, .g-defuse .dx-topbar .dx-strikes i.on::after { left: 3px; right: 3px; height: 2.5px; }
  .g-defuse .dx-topbar .dx-flags { margin-left: auto; }
  .g-defuse .dx-topbar.is-hurry .dx-time { color: var(--dx-red); }
  .g-defuse .dx-topbar.is-surge { border-color: var(--dx-red); }
}
/* a laptop: the side panel (clock, strikes, serial, edgework and the VENT / SURGE / BLACKOUT flags) stays in view beside the modules */
@media (min-width: 1100px) {
  .g-defuse .dx-side { position: sticky; top: 8px; align-self: start; max-height: calc(100vh - 16px); overflow: auto; scrollbar-width: none; }
  .g-defuse .dx-side::-webkit-scrollbar { display: none; }
  .g-defuse .dx-side .dx-flags { justify-content: center; }
  .g-defuse .dx-side .dx-flags:not(:has(.dx-flag:not([hidden]))) { display: none; }
  .g-defuse .dx-side .dx-flag { font-size: 1rem; padding: 6px 10px 5px; }
}
@media (max-width: 759px) {
  /* the lobby on a phone: tighter, with Start pinned so it never sits below the fold */
  .g-defuse { gap: 10px; }
  .g-defuse .dx-lobby { gap: 10px; }
  .g-defuse .dx-lead { font-size: 0.92rem; line-height: 1.35; margin-top: 4px !important; }
  .g-defuse .dx-roles { gap: 10px; }
  .g-defuse .dx-role { min-height: 0; padding: 10px 10px 8px; gap: 4px; }
  .g-defuse .dx-role svg { width: 40px; height: 40px; }
  .g-defuse .dx-role-desc { font-size: 0.85rem; line-height: 1.3; }
  .g-defuse .dx-role-who { min-height: 28px; }
  .g-defuse .dx-hint { font-size: 0.85rem; }
  .g-defuse .dx-tiers button { min-height: 52px; padding: 6px 4px 5px; }
  .g-defuse .dx-today { min-height: 46px; padding: 6px 10px; }
  .g-defuse .dx-lobby-actions { position: sticky; bottom: 0; z-index: 2; padding: 8px 0 calc(8px + env(safe-area-inset-bottom)); background: linear-gradient(to top, var(--g-bg) 78%, transparent); }
}
@media (max-width: 759px) {
  .g-defuse .dx-bomb { padding: 16px 12px 14px; }
  .g-defuse .dx-side { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
  .g-defuse .dx-side .dx-sticker, .g-defuse .dx-side .dx-bay { grid-column: auto; }
  .g-defuse .dx-mods, .g-defuse .dx-mods[data-k] { grid-template-columns: 1fr; }
  .g-defuse .dx-mod { min-height: 0; }
  .g-defuse .dx-plate { font-size: 1.35rem; }
  .g-defuse .dx-mbar { padding: 5px 9px; gap: 4px 10px; flex-wrap: nowrap; }
  .g-defuse .dx-mbar .dx-time { font-size: 1.45rem; } .g-defuse .dx-mbar .dx-strikes .dx-tag { display: none; } .g-defuse .dx-mbar .dx-strikes i { width: 18px; height: 18px; }
  .g-defuse .dx-mbar .dx-lcd { padding: 2px 8px 3px; }
  .g-defuse .dx-lamps { gap: 5px; flex-wrap: wrap; min-width: 0; }
  .g-defuse .dx-lamp { font-size: 0; gap: 0; } .g-defuse .dx-lamp i { width: 12px; height: 12px; }
  .g-defuse .dx-mbar .dx-flags { margin-left: 0; }
  .g-defuse .dx-mbody { grid-template-columns: 1fr; gap: 6px; }
  .g-defuse .dx-index { position: sticky; top: calc(var(--dx-mbar-h, 52px) + 4px); z-index: 2; flex-direction: row; overflow-x: auto; gap: 6px; padding: 6px 2px 8px 0; margin: 0 -2px 0 0; background: var(--g-bg); scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  .g-defuse .dx-index::-webkit-scrollbar { display: none; }
  .g-defuse .dx-index button { flex: none; grid-template-columns: 1fr; justify-items: center; align-content: center; gap: 2px; min-width: 66px; min-height: 52px; padding: 4px 6px; }
  .g-defuse .dx-index .big { min-width: 54px; font-size: 1.1rem; padding: 3px 4px 2px; }
  .g-defuse .dx-index .sm { font-size: 0.7rem; letter-spacing: 0.04em; max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .g-defuse .dx-index button[data-page="basics"] { position: sticky; left: 0; z-index: 1; }
  .g-defuse .dx-page { scroll-margin-top: calc(var(--dx-mbar-h, 52px) + 80px); }
  .g-defuse .dx-tiers button { grid-column: span 10; }
  .g-defuse .dx-tiers button:nth-child(n+4) { grid-column: span 15; }
}
/* Hush: the guide pages go blank for a few seconds (printed panel; the clock bar, tabs and relay drawer stay) */
.g-defuse .dx-flag[data-flag="hush"] { background: var(--g-ink); color: var(--g-bg); }
.g-defuse .dx-hush { position: absolute; inset: 0; z-index: 2; display: grid; place-content: center; justify-items: center; gap: 6px; padding: 16px; text-align: center; background: var(--g-card); border-radius: inherit; }
.g-defuse .dx-hush[hidden] { display: none; }
.g-defuse .dx-hush b { font: 400 clamp(1.8rem, 8vw, 3rem)/1 var(--g-font-display); letter-spacing: 0.14em; }
.g-defuse .dx-hush .dx-hush-t { font: 400 clamp(1.4rem, 6vw, 2rem)/1 var(--g-font-display); font-variant-numeric: tabular-nums; padding: 4px 14px 3px; border: 2.5px solid var(--g-ink); border-radius: 8px; background: var(--g-hl); color: var(--g-on-ink, var(--g-ink)); }
.g-defuse .dx-hush em { font: 800 0.85rem/1.2 var(--g-font-body); font-style: normal; letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); }
.g-defuse .is-hush .dx-page { min-height: 55vh; }
.g-defuse .is-hush .dx-page > .dx-sec { visibility: hidden; }
/* Chain x2: which bomb of two this is (bomb side panel or top bar, and the manual bar), the lobby switch, the NEXT BOMB stamp */
.g-defuse .dx-chain { display: inline-block; padding: 4px 9px 3px; border: 2px solid var(--g-ink); border-radius: 6px; background: var(--g-hl); color: var(--g-on-ink, var(--g-ink)); font: 900 0.72rem/1.15 var(--g-font-body); letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
.g-defuse .dx-chain[data-chain="2"] { background: var(--g-ink); color: var(--g-bg); }
.g-defuse .dx-side .dx-chain { display: block; text-align: center; margin: 0 0 8px; }
@media (max-width: 1099px) { .g-defuse .dx-side .dx-chain { display: none; } }
.g-defuse .dx-today:disabled { opacity: 0.5; }
.g-defuse .dx-stamp.is-chain b { font-size: clamp(2rem, 9.5vw, 3.4rem); }
@media (prefers-reduced-motion: reduce) { .g-defuse .dx-flag.is-pulse { animation: none !important; } }
`;
