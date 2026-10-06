// Rail Rush styles. Every selector is scoped under .g-rush (plus the game's own chrome hook).
export const CSS = `
.gm[data-game="rush"] .gm-stage { min-height: 0; }
.gm.is-immersive .g-rush { border-radius: 0; min-height: 0; }
.g-rush { --ink: var(--g-ink); --paper: var(--g-card); --rr-pad: 10px;
  position: relative; flex: 1; min-height: 440px; overflow: hidden; border-radius: 16px;
  background: var(--g-bg); color: var(--g-ink); font-family: var(--g-font-display);
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent; contain: layout paint; isolation: isolate; }
.g-rush * { box-sizing: border-box; }
.g-rush button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.g-rush .rr-gl { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.g-rush .rr-gl canvas { display: block; width: 100% !important; height: 100% !important; outline: none; }
.g-rush .rr-touch { position: absolute; inset: 0; z-index: 1; touch-action: none; }

/* print finish: vignette + grain, and manga speed lines */
.g-rush .rr-grain { position: absolute; inset: 0; z-index: 2; pointer-events: none;
  background: radial-gradient(ellipse 120% 90% at 50% 45%, transparent 55%, color-mix(in srgb, var(--g-ink) 16%, transparent) 100%); }
.g-rush .rr-speed { position: absolute; inset: -30%; z-index: 2; pointer-events: none; opacity: 0; will-change: opacity, transform;
  background: repeating-conic-gradient(from 0deg at 50% 50%, transparent 0deg 5deg, color-mix(in srgb, var(--g-card) 75%, transparent) 5deg 5.5deg, transparent 5.5deg 11deg);
  -webkit-mask-image: radial-gradient(ellipse 34% 30% at 50% 50%, transparent 55%, #000 100%); mask-image: radial-gradient(ellipse 34% 30% at 50% 50%, transparent 55%, #000 100%); }

/* per-player HUD */
.g-rush .rr-hud { position: absolute; top: 0; bottom: 0; z-index: 4; pointer-events: none; padding: max(var(--rr-pad), env(safe-area-inset-top, 0px)) max(var(--rr-pad), env(safe-area-inset-right, 0px)) max(var(--rr-pad), env(safe-area-inset-bottom, 0px)) max(var(--rr-pad), env(safe-area-inset-left, 0px)); }
.g-rush .rr-hud[data-side="full"] { left: 0; right: 0; }
.g-rush .rr-hud[data-side="l"] { left: 0; right: 50%; }
.g-rush .rr-hud[data-side="r"] { left: 50%; right: 0; }
/* leave room for the engine's floating back / menu stickers (44px + 10px inset) */
.g-rush .rr-hud[data-side="full"] .rr-top, .g-rush .rr-hud[data-side="l"] .rr-top { padding-left: 58px; }
.g-rush .rr-hud[data-side="full"] .rr-top, .g-rush .rr-hud[data-side="r"] .rr-top { padding-right: 58px; }
.g-rush.rr-in-lobby .rr-hud, .g-rush.rr-in-lobby .rr-divider { display: none; }
.g-rush.rr-split .rr-divider { position: absolute; z-index: 3; top: 0; bottom: 0; left: calc(50% - 2px); width: 4px; background: var(--g-ink); pointer-events: none; }
.g-rush .rr-top { display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; gap: 6px; }
.g-rush .rr-left { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.g-rush .rr-right { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.g-rush .rr-chip { display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 10px 0 7px; border-radius: 999px;
  background: var(--g-card); border: 2px solid var(--g-ink); box-shadow: 2px 2px 0 var(--g-edge); font-weight: 900; font-size: 15px; font-variant-numeric: tabular-nums; line-height: 1; white-space: nowrap; }
.g-rush .rr-hearts { display: inline-flex; gap: 2px; height: 30px; align-items: center; padding: 0 7px; border-radius: 999px; background: var(--g-card); border: 2px solid var(--g-ink); box-shadow: 2px 2px 0 var(--g-edge); }
.g-rush .rr-heart { width: 19px; height: 17px; display: block; transition: transform .25s cubic-bezier(.3,1.6,.5,1), opacity .25s; }
.g-rush .rr-heart path { stroke: var(--g-ink); stroke-width: 2.2; }
.g-rush .rr-heart.off { opacity: .28; transform: scale(.78); }
.g-rush .rr-heart.off path { fill: transparent; }
.g-rush .rr-heart.pop { animation: rr-heartpop .45s ease-out; }
@keyframes rr-heartpop { 0% { transform: scale(1.6) rotate(-12deg); } 100% { transform: scale(1); } }
.g-rush .rr-coin-ico { width: 18px; height: 18px; border-radius: 50%; background: var(--g-hl); border: 2px solid var(--g-ink); box-shadow: inset -2px -2px 0 color-mix(in srgb, var(--g-edge) 25%, transparent); flex: none; }
.g-rush .rr-dist { text-align: center; font-weight: 900; font-size: 34px; line-height: .95; color: var(--g-white); font-variant-numeric: tabular-nums; min-width: 4.2ch;
  text-shadow: 2px 0 0 var(--g-edge), -2px 0 0 var(--g-edge), 0 2px 0 var(--g-edge), 0 -2px 0 var(--g-edge), 2px 2px 0 var(--g-edge), -2px -2px 0 var(--g-edge), 2px -2px 0 var(--g-edge), -2px 2px 0 var(--g-edge), 3px 4px 0 var(--g-edge); }
.g-rush .rr-dist small { font-size: 16px; margin-left: 2px; }
.g-rush .rr-pause { position: absolute; top: calc(max(var(--rr-pad), env(safe-area-inset-top, 0px)) + 52px); right: max(14px, env(safe-area-inset-right, 0px)); }
.g-rush .rr-hud[data-side="l"] .rr-pause { right: 14px; }
.g-rush .rr-icon-btn { pointer-events: auto; width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--g-card); border: 2px solid var(--g-ink); box-shadow: 2px 2px 0 var(--g-edge); }
.g-rush .rr-icon-btn:active { transform: translate(2px, 2px); box-shadow: 0 0 0 var(--g-edge); }
.g-rush .rr-icon-btn svg { width: 20px; height: 20px; }
.g-rush .rr-partner { font-size: 13px; height: 26px; gap: 6px; }
.g-rush .rr-partner .rr-dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--g-ink); }
.g-rush .rr-powers { display: flex; gap: 5px; }
.g-rush .rr-pw { position: relative; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--g-card); border: 2px solid var(--g-ink); box-shadow: 2px 2px 0 var(--g-edge); }
.g-rush .rr-pw svg.ic { width: 18px; height: 18px; }
.g-rush .rr-pw svg.ring { position: absolute; inset: -4px; width: 36px; height: 36px; transform: rotate(-90deg); }
.g-rush .rr-pw svg.ring circle { fill: none; stroke: var(--g-hl); stroke-width: 3.5; stroke-dasharray: 100; stroke-linecap: round; }
.g-rush .rr-pw[hidden] { display: none; }

/* race bar / team bar */
.g-rush .rr-bar { position: relative; margin: 16px 60px 0 6px; height: 14px; border-radius: 999px; background: var(--g-card); border: 2px solid var(--g-ink); box-shadow: 2px 2px 0 var(--g-edge); }
.g-rush .rr-bar .rr-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: color-mix(in srgb, var(--g-hl) 70%, var(--g-card)); width: 0; }
.g-rush .rr-bar .rr-mk { position: absolute; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; border: 2.5px solid var(--g-ink); display: grid; place-items: center; font-size: 11px; font-weight: 900; color: var(--g-on-ink); will-change: transform; left: 0; }
.g-rush .rr-bar .rr-mk.me { z-index: 2; width: 26px; height: 26px; margin: -13px 0 0 -13px; }
.g-rush .rr-bar .rr-flag { position: absolute; right: -6px; top: -16px; width: 18px; height: 26px; }
.g-rush .rr-gap { margin-top: 8px; text-align: center; font-size: 14px; font-weight: 900; }
.g-rush .rr-gap span { display: inline-block; padding: 3px 10px; border-radius: 999px; background: var(--g-card); border: 2px solid var(--g-ink); }
.g-rush .rr-goal { margin-top: 6px; font-size: 12px; font-weight: 900; text-align: center; }

/* center pops, combo, warnings */
.g-rush .rr-pops { position: absolute; left: 0; right: 0; top: 30%; display: grid; place-items: center; pointer-events: none; }
.g-rush .rr-pop { grid-area: 1 / 1; font-weight: 900; font-size: 30px; line-height: 1; text-align: center; color: var(--g-white); padding: 0 8px; opacity: 0;
  text-shadow: 2px 0 0 var(--g-edge), -2px 0 0 var(--g-edge), 0 2px 0 var(--g-edge), 0 -2px 0 var(--g-edge), 2px 2px 0 var(--g-edge), -2px -2px 0 var(--g-edge), 2px -2px 0 var(--g-edge), -2px 2px 0 var(--g-edge), 3px 4px 0 var(--g-edge); }
.g-rush .rr-pop.go { animation: rr-pop 1.1s cubic-bezier(.2,1.4,.4,1) forwards; }
.g-rush .rr-pop.hl { color: var(--g-hl); } .g-rush .rr-pop.bad { color: var(--g-bad); } .g-rush .rr-pop.good { color: var(--g-good); }
.g-rush .rr-pop.pa { color: var(--p-a); } .g-rush .rr-pop.pb { color: var(--p-b); }
.g-rush .rr-pop small { display: block; font-size: 15px; margin-top: 4px; }
@keyframes rr-pop { 0% { opacity: 0; transform: scale(1.8) rotate(-8deg); } 14% { opacity: 1; transform: scale(.94) rotate(-3deg); } 24% { transform: scale(1.04) rotate(-3deg); } 78% { opacity: 1; transform: scale(1) rotate(-3deg) translateY(0); } 100% { opacity: 0; transform: scale(.96) rotate(-3deg) translateY(-18px); } }
.g-rush .rr-combo { position: absolute; right: 10px; top: 42%; text-align: right; font-weight: 900; font-size: 26px; color: var(--g-hl); opacity: 0; transform-origin: right center;
  text-shadow: 2px 0 0 var(--g-edge), -2px 0 0 var(--g-edge), 0 2px 0 var(--g-edge), 0 -2px 0 var(--g-edge), 2px 2px 0 var(--g-edge), -2px -2px 0 var(--g-edge), 3px 3px 0 var(--g-edge); }
.g-rush .rr-combo small { display: block; font-size: 13px; color: var(--g-white); }
.g-rush .rr-combo.go { animation: rr-combo 1.4s ease-out forwards; }
@keyframes rr-combo { 0% { opacity: 0; transform: scale(1.6); } 12% { opacity: 1; transform: scale(1); } 75% { opacity: 1; } 100% { opacity: 0; transform: translateY(-10px); } }
.g-rush .rr-warn { position: absolute; top: 38%; left: 50%; width: 46px; height: 46px; margin-left: -23px; display: none; place-items: center; border-radius: 50%; background: var(--g-bad); border: 3px solid var(--g-ink); color: #fff; font-weight: 900; font-size: 26px; animation: rr-blink .35s steps(2) infinite; will-change: transform; }
.g-rush .rr-warn.on { display: grid; }
@keyframes rr-blink { 50% { background: var(--g-hl); color: var(--g-ink); } }

/* weapon slot + buttons scheme */
.g-rush .rr-weapon { position: absolute; right: max(12px, env(safe-area-inset-right, 0px)); bottom: max(14px, env(safe-area-inset-bottom, 0px)); width: 70px; height: 70px; border-radius: 50%; pointer-events: auto;
  display: grid; place-items: center; background: var(--g-card); border: 3px solid var(--g-ink); box-shadow: 3px 3px 0 var(--g-edge); transition: transform .12s; }
.g-rush .rr-weapon svg { width: 36px; height: 36px; }
.g-rush .rr-weapon.empty { pointer-events: none; opacity: .7; border-style: dashed; box-shadow: none; background: color-mix(in srgb, var(--g-card) 70%, transparent); color: var(--g-muted); }
.g-rush .rr-weapon.full { animation: rr-ready 1s ease-in-out infinite; background: var(--g-hl); color: var(--g-on-ink); }
.g-rush .rr-weapon:active { transform: translate(2px, 2px) scale(.96); box-shadow: 0 0 0 var(--g-edge); }
.g-rush .rr-weapon .rr-key { position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); font-size: 11px; padding: 1px 6px; border-radius: 6px; background: var(--g-ink); color: var(--g-card); }
.g-rush .rr-weapon .rr-wname { position: absolute; top: -20px; left: 50%; transform: translateX(-50%); font-size: 11px; white-space: nowrap; padding: 1px 7px; border-radius: 6px; background: var(--g-ink); color: var(--g-card); }
.g-rush .rr-weapon.empty .rr-wname { display: none; }
@keyframes rr-ready { 50% { transform: scale(1.07) rotate(-4deg); } }
.g-rush .rr-btns { position: absolute; left: max(14px, env(safe-area-inset-left, 0px)); right: max(14px, env(safe-area-inset-right, 0px)); bottom: max(14px, env(safe-area-inset-bottom, 0px)); display: none; justify-content: space-between; pointer-events: none; }
.g-rush.rr-buttons .rr-btns { display: flex; }
.g-rush .rr-btns button { pointer-events: auto; width: 78px; height: 78px; flex-direction: column; gap: 0; line-height: 1; border-radius: 50%; background: var(--g-card); border: 3px solid var(--g-ink); box-shadow: 3px 3px 0 var(--g-edge); font-weight: 900; font-size: 13px; display: grid; place-items: center; }
.g-rush .rr-btns button:active { transform: translate(2px,2px); box-shadow: none; background: var(--g-hl); }
.g-rush.rr-buttons .rr-weapon { bottom: calc(max(14px, env(safe-area-inset-bottom, 0px)) + 88px); }

/* splat, zap, down banner, name tag */
.g-rush .rr-splat { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .5s; }
.g-rush .rr-splat.on { opacity: 1; transition: opacity .06s; }
.g-rush .rr-splat svg { position: absolute; inset: 0; width: 100%; height: 100%; transform-origin: 50% 45%; }
.g-rush .rr-splat.on svg { animation: rr-splat .32s cubic-bezier(.2,1.6,.4,1); }
.g-rush .rr-splat.drip svg { transform: translateY(9%) scaleY(1.06); opacity: 0; transition: transform .65s ease-in, opacity .65s ease-in; }
@keyframes rr-splat { 0% { transform: scale(.25) rotate(-8deg); } 100% { transform: scale(1); } }
.g-rush .rr-flash { position: absolute; inset: 0; pointer-events: none; opacity: 0; background: var(--g-card); }
.g-rush .rr-flash.go { animation: rr-flash .35s ease-out; }
@keyframes rr-flash { 0% { opacity: .85; } 100% { opacity: 0; } }
.g-rush .rr-banner { position: absolute; left: 50%; top: 58%; transform: translateX(-50%); min-width: 230px; max-width: 92%; padding: 10px 14px; border-radius: 14px; text-align: center; font-weight: 900; font-size: 15px;
  background: var(--g-card); border: 2.5px solid var(--g-ink); box-shadow: 3px 3px 0 var(--g-edge); display: none; }
.g-rush .rr-banner.on { display: block; }
.g-rush .rr-banner b { display: block; font-size: 30px; font-variant-numeric: tabular-nums; }
.g-rush .rr-tag { position: absolute; left: 0; top: 0; z-index: 3; pointer-events: none; padding: 2px 8px; border-radius: 8px; font-size: 12px; font-weight: 900; color: var(--g-on-ink); border: 2px solid var(--g-ink); white-space: nowrap; display: none; will-change: transform; }
.g-rush .rr-tag::after { content: ''; position: absolute; left: 50%; bottom: -7px; margin-left: -5px; border: 5px solid transparent; border-top-color: var(--g-ink); border-bottom: 0; }

/* overlays */
.g-rush .rr-ov { position: absolute; inset: 0; z-index: 8; display: none; place-items: center; padding: max(14px, env(safe-area-inset-top, 0px)) 14px max(14px, env(safe-area-inset-bottom, 0px)); }
.g-rush .rr-ov.on { display: grid; }
.g-rush .rr-ov.dim { background: color-mix(in srgb, var(--g-bg) 72%, transparent); }
.g-rush .rr-card { width: min(100%, 380px); padding: 18px; border-radius: 18px; background: var(--g-card); border: 2.5px solid var(--g-ink); box-shadow: 5px 5px 0 var(--g-edge); text-align: center; display: flex; flex-direction: column; gap: 10px; font-family: var(--g-font-body); }
.g-rush .rr-card h2 { margin: 0; font-family: var(--g-font-display); font-weight: 900; font-size: 26px; line-height: 1.05; }
.g-rush .rr-card p { margin: 0; color: var(--g-muted); font-weight: 700; line-height: 1.35; }
.g-rush .rr-btn { pointer-events: auto; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 52px; padding: 12px 18px; border-radius: 14px; font-weight: 900; font-size: 17px;
  background: var(--g-ink); color: var(--g-card); border: 2.5px solid var(--g-ink); box-shadow: 3px 3px 0 color-mix(in srgb, var(--g-edge) 45%, transparent); }
.g-rush .rr-btn:active { transform: translate(2px, 2px); box-shadow: none; }
.g-rush .rr-btn.ghost { background: var(--g-card); color: var(--g-ink); box-shadow: 3px 3px 0 var(--g-edge); }
.g-rush .rr-btn.hot { background: var(--g-hl); color: var(--g-on-ink); box-shadow: 3px 3px 0 var(--g-edge); }
.g-rush .rr-btn[disabled] { opacity: .5; }

/* loading */
.g-rush .rr-ov-load { background: var(--g-bg); }
.g-rush .rr-ov-load .rr-logo { margin-bottom: 18px; }
.g-rush .rr-progress { width: 180px; height: 12px; border-radius: 999px; border: 2.5px solid var(--g-ink); background: var(--g-card); overflow: hidden; margin: 14px auto 8px; }
.g-rush .rr-progress i { display: block; height: 100%; width: 0; background: var(--g-hl); transition: width .25s; }
.g-rush .rr-ov-load p { margin: 0; font-weight: 800; color: var(--g-muted); font-family: var(--g-font-body); }
.g-rush .rr-runner-ico { width: 64px; height: 64px; margin: 0 auto; animation: rr-bob .5s ease-in-out infinite alternate; }
@keyframes rr-bob { to { transform: translateY(-6px) rotate(3deg); } }

/* logo */
.g-rush .rr-logo { display: flex; flex-direction: column; align-items: center; line-height: .82; font-weight: 900; font-size: 52px; letter-spacing: -1px; transform: rotate(-4deg); }
.g-rush .rr-logo span { color: var(--g-white); text-shadow: 3px 0 0 var(--g-edge), -3px 0 0 var(--g-edge), 0 3px 0 var(--g-edge), 0 -3px 0 var(--g-edge), 3px 3px 0 var(--g-edge), -3px -3px 0 var(--g-edge), 3px -3px 0 var(--g-edge), -3px 3px 0 var(--g-edge), 5px 6px 0 var(--g-edge); }
.g-rush .rr-logo span:first-child { color: var(--p-a); }
.g-rush .rr-logo span:last-child { color: var(--p-b); margin-left: 34px; }

/* lobby */
.g-rush .rr-ov-lobby { align-content: space-between; justify-items: center; grid-template-rows: auto 1fr auto; padding-top: max(16px, env(safe-area-inset-top, 0px)); }
.g-rush .rr-ov-lobby .rr-head { text-align: center; }
.g-rush .rr-ov-lobby .rr-tagline { margin: 8px 0 0; font-weight: 900; font-size: 14px; padding: 4px 10px; border-radius: 999px; display: inline-block; background: var(--g-card); border: 2px solid var(--g-ink); }
.g-rush .rr-sheet { width: min(100%, 440px); padding: 12px; border-radius: 20px; background: var(--g-card); border: 2.5px solid var(--g-ink); box-shadow: 5px 5px 0 var(--g-edge); display: flex; flex-direction: column; gap: 9px; }
.g-rush .rr-modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.g-rush .rr-mode { pointer-events: auto; position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 6px 9px; border-radius: 14px; border: 2.5px solid var(--g-ink); background: var(--g-bg); text-align: center; transition: transform .15s, background .15s; }
.g-rush .rr-mode svg { width: 34px; height: 34px; }
.g-rush .rr-mode b { font-size: 15px; font-weight: 900; }
.g-rush .rr-mode span { font-size: 11px; line-height: 1.2; color: var(--g-muted); font-weight: 800; font-family: var(--g-font-body); }
.g-rush .rr-mode.on { color: var(--g-on-ink); background: var(--g-hl); transform: translateY(-3px) rotate(-1.5deg); box-shadow: 3px 3px 0 var(--g-edge); }
.g-rush .rr-mode.on span { color: var(--g-on-ink); }
.g-rush .rr-mode[disabled] { cursor: default; }
.g-rush .rr-status { font-family: var(--g-font-body); font-weight: 800; font-size: 13px; color: var(--g-muted); min-height: 18px; display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
.g-rush .rr-status .rr-ok { color: var(--g-good); }
.g-rush .rr-row { display: flex; gap: 8px; }
.g-rush .rr-row .rr-btn { flex: 1; }
.g-rush .rr-row .rr-btn.sq { flex: none; width: 52px; padding: 0; }
.g-rush .rr-keys { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-family: var(--g-font-body); font-size: 12px; font-weight: 800; }
.g-rush .rr-keys div { padding: 7px; border-radius: 12px; border: 2px solid var(--g-ink); background: var(--g-bg); }
.g-rush .rr-keys b { display: block; font-family: var(--g-font-display); font-size: 14px; }
.g-rush .rr-keys kbd { display: inline-block; min-width: 20px; padding: 1px 4px; margin: 1px; border-radius: 5px; border: 1.5px solid var(--g-ink); background: var(--g-card); font: 800 11px var(--g-font-body); }

/* countdown */
.g-rush .rr-ov-count { pointer-events: none; }
.g-rush .rr-num { font-weight: 900; font-size: 120px; line-height: 1; color: var(--g-hl);
  text-shadow: 4px 0 0 var(--g-edge), -4px 0 0 var(--g-edge), 0 4px 0 var(--g-edge), 0 -4px 0 var(--g-edge), 4px 4px 0 var(--g-edge), -4px -4px 0 var(--g-edge), 4px -4px 0 var(--g-edge), -4px 4px 0 var(--g-edge), 7px 8px 0 var(--g-edge); }
.g-rush .rr-num.go { animation: rr-num .9s cubic-bezier(.2,1.5,.4,1) both; }
.g-rush .rr-num.run { color: var(--g-white); font-size: 92px; }
@keyframes rr-num { 0% { transform: scale(2.2) rotate(-12deg); opacity: 0; } 30% { transform: scale(1) rotate(-5deg); opacity: 1; } 85% { opacity: 1; } 100% { transform: scale(.8) rotate(-5deg); opacity: 0; } }
.g-rush .rr-ov-count p { margin: 6px 0 0; text-align: center; font-weight: 900; font-size: 16px; }
.g-rush .rr-ov-count p span { padding: 4px 12px; border-radius: 999px; background: var(--g-card); border: 2px solid var(--g-ink); }

/* finale */
.g-rush .rr-ov-fin { pointer-events: none; }
.g-rush .rr-ov-fin .rr-stamp { font-weight: 900; font-size: 48px; line-height: .95; text-align: center; color: var(--g-white); transform: rotate(-6deg); animation: rr-num 2.4s cubic-bezier(.2,1.5,.4,1) both;
  text-shadow: 3px 0 0 var(--g-edge), -3px 0 0 var(--g-edge), 0 3px 0 var(--g-edge), 0 -3px 0 var(--g-edge), 3px 3px 0 var(--g-edge), -3px -3px 0 var(--g-edge), 3px -3px 0 var(--g-edge), -3px 3px 0 var(--g-edge), 6px 7px 0 var(--g-edge); }
.g-rush .rr-ov-fin .rr-stamp.pa { color: var(--p-a); } .g-rush .rr-ov-fin .rr-stamp.pb { color: var(--p-b); } .g-rush .rr-ov-fin .rr-stamp.team { color: var(--g-hl); }
.g-rush .rr-ov-fin .rr-stamp small { display: block; font-size: 18px; margin-top: 8px; color: var(--g-white); }

/* tutorial ghost hand */
.g-rush .rr-tut { position: absolute; left: 0; right: 0; bottom: 18%; z-index: 6; display: none; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; }
.g-rush .rr-tut.on { display: flex; }
.g-rush .rr-tut .rr-cap { font-weight: 900; font-size: 17px; padding: 6px 14px; border-radius: 999px; background: var(--g-card); border: 2.5px solid var(--g-ink); box-shadow: 3px 3px 0 var(--g-edge); }
.g-rush .rr-tut .rr-steps { display: flex; gap: 6px; }
.g-rush .rr-tut .rr-steps i { width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--g-ink); background: var(--g-card); }
.g-rush .rr-tut .rr-steps i.on { background: var(--g-hl); }
.g-rush .rr-hand { width: 120px; height: 90px; position: relative; }
.g-rush .rr-hand svg { position: absolute; left: 40px; top: 20px; width: 44px; height: 56px; filter: drop-shadow(3px 3px 0 var(--g-edge)); }
.g-rush .rr-hand.l svg { animation: rr-hl 1.2s ease-in-out infinite; } .g-rush .rr-hand.r svg { animation: rr-hr 1.2s ease-in-out infinite; }
.g-rush .rr-hand.u svg { animation: rr-hu 1.2s ease-in-out infinite; } .g-rush .rr-hand.d svg { animation: rr-hd 1.2s ease-in-out infinite; }
@keyframes rr-hl { 0%, 20% { transform: translateX(30px); opacity: 0; } 35% { opacity: 1; } 75% { transform: translateX(-34px); opacity: 1; } 100% { transform: translateX(-34px); opacity: 0; } }
@keyframes rr-hr { 0%, 20% { transform: translateX(-30px); opacity: 0; } 35% { opacity: 1; } 75% { transform: translateX(34px); opacity: 1; } 100% { transform: translateX(34px); opacity: 0; } }
@keyframes rr-hu { 0%, 20% { transform: translateY(26px); opacity: 0; } 35% { opacity: 1; } 75% { transform: translateY(-24px); opacity: 1; } 100% { transform: translateY(-24px); opacity: 0; } }
@keyframes rr-hd { 0%, 20% { transform: translateY(-20px); opacity: 0; } 35% { opacity: 1; } 75% { transform: translateY(26px); opacity: 1; } 100% { transform: translateY(26px); opacity: 0; } }

/* settings toggles */
.g-rush .rr-set { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px; text-align: left; font-weight: 900; font-family: var(--g-font-display); }
.g-rush .rr-seg { display: inline-flex; border: 2.5px solid var(--g-ink); border-radius: 12px; overflow: hidden; }
.g-rush .rr-seg button { pointer-events: auto; padding: 8px 12px; font-weight: 900; font-size: 14px; min-height: 40px; }
.g-rush .rr-seg button.on { background: var(--g-ink); color: var(--g-card); }

/* compact + landscape */
.g-rush.rr-short .rr-logo { font-size: 34px; }
.g-rush.rr-short .rr-ov-lobby { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr; align-content: center; align-items: center; }
.g-rush.rr-short .rr-dist { font-size: 26px; }
.g-rush.rr-short .rr-pops { top: 22%; }
.g-rush.rr-narrow .rr-dist { font-size: 28px; }
.g-rush.rr-narrow .rr-chip { font-size: 13px; height: 26px; }
.g-rush.rr-narrow .rr-hearts { height: 26px; }
.g-rush.rr-narrow .rr-heart { width: 15px; height: 14px; }
@media (prefers-reduced-motion: reduce) {
  .g-rush .rr-weapon.full, .g-rush .rr-runner-ico, .g-rush .rr-warn { animation: none; }
  .g-rush .rr-speed { display: none; }
}
`;
