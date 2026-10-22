// Defuse: the "flat" upgrade layer. Loaded after every module's own css, so it wins ties.
//
//   1. Smoothness. The clock's box has a fixed size and layout containment, so the once-a-second text change lays out nothing
//      around it. Every animation below moves only transform or opacity. Restarting a one-shot swaps between two classes that
//      name identical keyframes (shk-a / shk-b ...), so nothing ever reads layout to restart an animation.
//   2. Press-in. defuse.js adds .is-press on pointerdown (the action itself still waits for the click). Pressed controls
//      sink at once and spring back on release.
//   3. Juice. Wire snip, switch flick (css in classic.js / switches.js), strike flash and shake, a pip that stamps in, the
//      last ten seconds, the DEFUSED stamp and the BOOM ink burst.
//   4. Riso texture. The bomb casing and the field guide are printed objects: paper tooth, graded halftone, a second plate
//      printed slightly off register, overprint (multiply, light paper only), registration marks.
//
// Reduced motion: the base css turns every animation and transition inside .g-defuse off, so the overlays stay invisible and
// the stamps just appear. Colours are theme tokens (the --dx-* bomb colours are the physical parts: wires, plates, stickers).
export const FLAT_CSS = `
.g-defuse { --dx-mix: multiply; --dx-plate-b: color-mix(in srgb, var(--p-b) 72%, transparent); --dx-plate-a: color-mix(in srgb, var(--p-a) 62%, transparent); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .g-defuse { --dx-mix: normal; } }
:root[data-theme="dark"] .g-defuse { --dx-mix: normal; }

/* ── 1. the clock: a fixed box, so a new digit lays out nothing outside it ── */
.g-defuse .dx-time { width: 4.5ch; margin-inline: auto; contain: layout; white-space: nowrap; font-variant-numeric: tabular-nums; }
.g-defuse .dx-surgetxt { contain: layout; }
.g-defuse .dx-hush .dx-hush-t { display: inline-block; min-width: 4ch; text-align: center; }

/* ── 2. press-in ── */
.g-defuse :is(.dx-gkey, .dx-pw-btn, .dx-mz-btn, .sx-sw, .dx-vent-key, .dx-relay-sw, .mx-step).is-press { transform: translateY(3px) !important; box-shadow: 0 1px 0 var(--g-ink) !important; transition: none !important; }
.g-defuse :is(.dx-pw-submit, .sx-set, .dx-relay-commit, .mx-tx).is-press { transform: translateY(5px) !important; box-shadow: 0 1px 0 var(--g-ink) !important; transition: none !important; }
.g-defuse .dx-pad.is-press { transform: translate(2px, 2px) !important; box-shadow: 0 0 0 var(--g-ink) !important; transition: none !important; }
.g-defuse :is(.dx-index button, .dx-role, .dx-today, .dx-drawer-head, .dx-openrelay).is-press { transform: translate(2px, 2px) !important; box-shadow: 0 0 0 var(--g-ink) !important; transition: none !important; }
.g-defuse .dx-tiers button.is-press { transform: scale(0.95) !important; transition: none !important; }
.g-defuse .mx-lamp.is-press { transform: scale(0.95) !important; transition: none !important; }
.g-defuse .dx-wire { transition: translate 0.14s var(--g-ease-spring); }
.g-defuse .dx-wire.is-press { translate: 0 2px; transition: none; }
.g-defuse .dx-wire.is-press .o { stroke-width: 13; }

/* ── 3. juice ── */
/* the strike: one sheet of red ink flashes (opacity only), the module and the manual's bar shake, a pip stamps into the strike row */
.g-defuse .dx-flash { position: fixed; inset: 0; z-index: 7; pointer-events: none; background: var(--g-bad); opacity: 0; --fo: 0.38; }
.g-defuse .dx-flash.is-hot { background: var(--g-hl); --fo: 0.85; }
.g-defuse .dx-flash.fl-a { animation: dx-fl-a 0.36s ease-out both; }
.g-defuse .dx-flash.fl-b { animation: dx-fl-b 0.36s ease-out both; }
@keyframes dx-fl-a { from { opacity: var(--fo); } to { opacity: 0; } }
@keyframes dx-fl-b { from { opacity: var(--fo); } to { opacity: 0; } }
.g-defuse .shk-a { animation: dx-shk-a 0.3s var(--g-ease-out); }
.g-defuse .shk-b { animation: dx-shk-b 0.3s var(--g-ease-out); }
@keyframes dx-shk-a { 0%, 100% { transform: none; } 18% { transform: translateX(-6px) rotate(-0.4deg); } 38% { transform: translateX(5px) rotate(0.3deg); } 58% { transform: translateX(-3px); } 78% { transform: translateX(2px); } }
@keyframes dx-shk-b { 0%, 100% { transform: none; } 18% { transform: translateX(-6px) rotate(-0.4deg); } 38% { transform: translateX(5px) rotate(0.3deg); } 58% { transform: translateX(-3px); } 78% { transform: translateX(2px); } }
.g-defuse .dx-strikes i.on { animation: dx-pip 0.42s var(--g-ease-spring) both; }
@keyframes dx-pip { from { transform: scale(0.3) rotate(-24deg); } to { transform: none; } }
/* the last ten seconds: the clock beats once a second and a red frame flashes round the screen */
.g-defuse .dx-lcd.beat-a { animation: dx-beat-a 0.55s var(--g-ease-out); }
.g-defuse .dx-lcd.beat-b { animation: dx-beat-b 0.55s var(--g-ease-out); }
@keyframes dx-beat-a { 0% { transform: scale(1.14); } 100% { transform: none; } }
@keyframes dx-beat-b { 0% { transform: scale(1.14); } 100% { transform: none; } }
.g-defuse .dx-vig { position: fixed; inset: 0; z-index: 4; pointer-events: none; border: 7px solid var(--dx-red); opacity: 0; }
.g-defuse .dx-vig.vg-a { animation: dx-vg-a 0.9s ease-out both; }
.g-defuse .dx-vig.vg-b { animation: dx-vg-b 0.9s ease-out both; }
@keyframes dx-vg-a { from { opacity: 0.8; } to { opacity: 0; } }
@keyframes dx-vg-b { from { opacity: 0.8; } to { opacity: 0; } }
/* the big hit: a short, small jolt of the whole bomb */
.g-defuse .dx-bomb.jolt-a, .g-defuse .dx-manual-wrap.jolt-a { animation: dx-jolt-a 0.24s linear; }
.g-defuse .dx-bomb.jolt-b, .g-defuse .dx-manual-wrap.jolt-b { animation: dx-jolt-b 0.24s linear; }
@keyframes dx-jolt-a { 0%, 100% { transform: none; } 20% { transform: translate(-5px, 2px); } 40% { transform: translate(4px, -2px); } 60% { transform: translate(-3px, 1px); } 80% { transform: translate(2px, 0); } }
@keyframes dx-jolt-b { 0%, 100% { transform: none; } 20% { transform: translate(-5px, 2px); } 40% { transform: translate(4px, -2px); } 60% { transform: translate(-3px, 1px); } 80% { transform: translate(2px, 0); } }
/* wire snip: the two halves recoil from the cut, a spark flashes there. A wire restored from a saved round just sits cut. */
.g-defuse .dx-wire .half, .g-defuse .dx-wire .spark { transform-box: view-box; transform-origin: var(--ox) var(--oy); }
.g-defuse .dx-wire .hl { transform: translate(-4px, 3px); }
.g-defuse .dx-wire .hr { transform: translate(4px, 4px); }
.g-defuse .dx-wire .spark { fill: none; stroke: var(--dx-red); stroke-width: 2.6; stroke-linecap: round; opacity: 0; }
.g-defuse .dx-wire.is-snip .hl { animation: dx-snip-l 0.46s var(--g-ease-out) both; }
.g-defuse .dx-wire.is-snip .hr { animation: dx-snip-r 0.46s var(--g-ease-out) both; }
.g-defuse .dx-wire.is-snip .spark { animation: dx-spark 0.34s ease-out both; }
@keyframes dx-snip-l { 0% { transform: translate(0, 0) rotate(0); } 28% { transform: translate(-10px, -4px) rotate(-10deg); } 100% { transform: translate(-4px, 3px) rotate(0); } }
@keyframes dx-snip-r { 0% { transform: translate(0, 0) rotate(0); } 28% { transform: translate(10px, -3px) rotate(9deg); } 100% { transform: translate(4px, 4px) rotate(0); } }
@keyframes dx-spark { 0% { opacity: 1; transform: scale(0.35); } 100% { opacity: 0; transform: scale(1.5); } }

/* the DEFUSED / NEXT BOMB stamp lands (squash, settle), a second plate printed off register, an impact ripple, ink dots */
.g-defuse .dx-stamp { position: relative; animation: dx-stamp2 0.6s var(--g-ease-out) both; }
.g-defuse .dx-stamp::before { content: ''; position: absolute; inset: -10px; border: 3px solid var(--p-b); border-radius: 16px; opacity: 0.75; transform: translate(4px, 3px); mix-blend-mode: var(--dx-mix); pointer-events: none; }
.g-defuse .dx-stamp::after { content: ''; position: absolute; inset: -4px; border: 4px solid var(--g-good); border-radius: 14px; opacity: 0; pointer-events: none; animation: dx-ripple 0.6s 0.2s ease-out both; }
@keyframes dx-stamp2 { 0% { transform: rotate(-18deg) scale(2.4); opacity: 0; } 50% { transform: rotate(-6deg) scale(0.9); opacity: 1; } 72% { transform: rotate(-7.6deg) scale(1.05); } 100% { transform: rotate(-7deg) scale(1); opacity: 1; } }
@keyframes dx-ripple { 0% { transform: scale(1); opacity: 0.7; } 100% { transform: scale(1.3, 1.55); opacity: 0; } }
.g-defuse .dx-stamp b { text-shadow: 2px 1.5px 0 var(--dx-plate-b), -1.5px -1px 0 var(--dx-plate-a); }
.g-defuse .dx-ink { position: absolute; inset: 0; pointer-events: none; }
.g-defuse .dx-fx > .dx-ink { inset: 120px 16px 16px; }
.g-defuse .dx-dot { position: absolute; left: 50%; top: 50%; width: 15px; height: 15px; margin: -7.5px 0 0 -7.5px; border-radius: 50%; border: 2px solid var(--g-ink); opacity: 0; transform: translate(var(--x), var(--y)) scale(var(--s)); animation: dx-dot 2s var(--g-ease-out) var(--dl) both; }
.g-defuse .dx-dot.k0 { background: var(--p-a); } .g-defuse .dx-dot.k1 { background: var(--p-b); } .g-defuse .dx-dot.k2 { background: var(--g-hl); }
@keyframes dx-dot { 0% { transform: translate(0, 0) scale(0); opacity: 1; } 22% { transform: translate(var(--x), var(--y)) scale(var(--s)); opacity: 1; } 68% { transform: translate(var(--x), calc(var(--y) + 6px)) scale(var(--s)); opacity: 1; } 100% { transform: translate(var(--x), calc(var(--y) + 14px)) scale(var(--s)); opacity: 0; } }
/* BOOM: the burst gets a shock ring, a misregistered second plate and a spray of ink */
.g-defuse .dx-boom b { text-shadow: 4px 4px 0 var(--dx-dark), -3px -2px 0 var(--dx-plate-a), 7px 6px 0 var(--dx-plate-b); }
.g-defuse .dx-boom .dx-ink { display: block; }
.g-defuse .dx-wave { position: absolute; inset: 16% 18%; border-radius: 50%; border: 6px solid var(--g-hl); outline: 3px solid var(--g-ink); opacity: 0; pointer-events: none; animation: dx-wave 0.75s var(--g-ease-out) both; }
@keyframes dx-wave { 0% { transform: scale(0.25); opacity: 0.95; } 100% { transform: scale(2.1); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .g-defuse .dx-dot, .g-defuse .dx-wave, .g-defuse .dx-flash, .g-defuse .dx-vig { display: none; } }

/* ── 4. riso: the bomb is a printed object ──
   Paper tooth sits as the top background layer of every printed surface. The selector is doubled so it outranks the
   state rules that reset the background shorthand (is-mine, aria-checked ...) while the colours stay theirs. */
.g-defuse.g-defuse :is(.dx-solo, .dx-role, .dx-today, .dx-rec, .dx-tiers button, .dx-mbar, .dx-topbar, .dx-pause > div, .dx-stamp, .dx-drawer, .dx-index button, .dx-mod, .dx-sticker, .dx-ind, .dx-port, .dx-relay-box, .dx-relay-card, .dx-slip, .dx-thisbomb, .dx-col, .dx-mz-fig, .dx-plate, .dx-page) {
  background-image: var(--g-grain); background-size: var(--g-grain-size); background-position: 0 0; background-repeat: repeat;
}
/* the casing: grain, plus halftone shading that thickens toward the lower right (as if lit from the top left) and a pink plate printed a hair off register */
.g-defuse .dx-bomb { background: var(--g-grain) 0 0 / var(--g-grain-size), var(--g-card); }
.g-defuse .dx-bomb::before { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: radial-gradient(circle, color-mix(in srgb, var(--g-ink) 34%, transparent) 1.25px, transparent 1.9px) 0 0 / 6px 6px; -webkit-mask-image: linear-gradient(150deg, transparent 38%, #000 100%); mask-image: linear-gradient(150deg, transparent 38%, #000 100%); opacity: 0.6; }
.g-defuse .dx-bomb::after { content: ''; position: absolute; inset: 3px; border-radius: inherit; border: 2px solid var(--dx-plate-b); transform: translate(2px, 1.5px); pointer-events: none; mix-blend-mode: var(--dx-mix); }
.g-defuse .dx-plate, .g-defuse .dx-mod-tag, .g-defuse .dx-h, .g-defuse .dx-role-name { text-shadow: var(--g-misreg); }
.g-defuse .dx-lcd { background-image: repeating-linear-gradient(0deg, transparent 0 2px, rgb(255 255 255 / 0.04) 2px 3px); }
.g-defuse .dx-sticker { position: relative; overflow: hidden; }
.g-defuse .dx-sticker::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 5px; background: var(--p-b); mix-blend-mode: multiply; opacity: 0.85; pointer-events: none; }
.g-defuse .dx-sticker.is-void .dx-void-stamp { mix-blend-mode: multiply; }
.g-defuse .dx-strikes i { background-image: var(--g-halftone); background-size: 5px 5px; }
.g-defuse .dx-strikes i.on { background-image: none; }
.g-defuse .dx-mod.is-solved .dx-led { box-shadow: 0 0 0 3px color-mix(in srgb, var(--g-good) 30%, transparent), 2px 1.5px 0 var(--dx-plate-b); }

/* the field guide: a printed booklet page. Paper tooth, a halftone spine in the highlight ink, a second plate under the headings, registration marks. */
.g-defuse .dx-page::before { background-image: var(--g-halftone-a); background-size: 5px 5px; background-color: var(--g-hl); }
.g-defuse .dx-page::after { content: ''; position: absolute; right: 10px; top: 10px; width: 17px; height: 17px; border: 1.5px solid var(--g-muted); border-radius: 50%; opacity: 0.6; pointer-events: none; background: linear-gradient(var(--g-muted), var(--g-muted)) 50% 50% / 1.5px 100% no-repeat, linear-gradient(var(--g-muted), var(--g-muted)) 50% 50% / 100% 1.5px no-repeat; }
.g-defuse .dx-sec h3 { text-shadow: var(--g-misreg); }
.g-defuse .dx-sec h3 .n { box-shadow: 2.5px 2px 0 var(--dx-plate-b); text-shadow: none; }
.g-defuse .dx-sec h4 { color: var(--p-a-text); }
.g-defuse .dx-sec h4::after { height: 3px; background: var(--g-halftone) 0 50% / 5px 5px; background-color: transparent; }
.g-defuse th { background-image: var(--g-halftone-a); background-size: 5px 5px; }
.g-defuse th.is-now, .g-defuse td.is-now { background-image: none; }
.g-defuse .dx-run { border-bottom-style: double; border-bottom-width: 4px; }
.g-defuse .dx-note { background-image: var(--g-halftone); background-size: 6px 6px; }
.g-defuse .dx-slip { mix-blend-mode: var(--dx-mix); }
.g-defuse .dx-index button[aria-selected="true"] .big { box-shadow: 2px 1.5px 0 var(--dx-plate-b); }
`;
