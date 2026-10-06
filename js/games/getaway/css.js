// Getaway styles. Everything is scoped under .g-gtw; riso print look from the theme tokens.
export const CSS = `
.g-gtw { position: absolute; inset: 0; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; font-family: var(--g-font-body); color: var(--g-ink); background: var(--g-bg); --st: env(safe-area-inset-top, 0px); --sb: env(safe-area-inset-bottom, 0px); --sl: env(safe-area-inset-left, 0px); --sr: env(safe-area-inset-right, 0px); --cs: var(--gm-corner-safe, 64px); }
.g-gtw [hidden] { display: none !important; }
.g-gtw canvas.gtw-cv { position: absolute; inset: 0; width: 100% !important; height: 100% !important; display: block; }
.gtw-surface { position: absolute; inset: 0; touch-action: none; }
.gtw-st { background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-edge)); }
.gtw-view { position: absolute; top: 0; bottom: 0; pointer-events: none; overflow: hidden; }
.gtw-view.full { left: 0; right: 0; } .gtw-view.l { left: 0; width: 50%; } .gtw-view.r { right: 0; width: 50%; }
.gtw-view > * { pointer-events: none; }
.gtw-split-line { position: absolute; top: 0; bottom: 0; left: 50%; width: 4px; margin-left: -2px; background: var(--g-ink); z-index: 3; }

/* top: scores + clock */
.gtw-top { position: absolute; top: calc(8px + var(--st)); left: 50%; transform: translateX(-50%); display: flex; align-items: stretch; gap: 6px; max-width: calc(100% - 120px); }
.gtw-view.l .gtw-top, .gtw-view.r .gtw-top { top: 8px; max-width: calc(100% - 16px); }
.gtw-sc { display: flex; align-items: center; gap: 5px; padding: 3px 8px 3px 5px; font-weight: 900; font-size: 0.95rem; }
.gtw-sc i { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--g-ink); flex: none; }
.gtw-sc.a i { background: var(--p-a); } .gtw-sc.b i { background: var(--p-b); }
.gtw-sc em { font-style: normal; font-size: 0.68rem; font-weight: 800; color: var(--g-muted); max-width: 5em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 520px) { .gtw-sc em { display: none; } }
.gtw-clock { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2px 10px 3px; min-width: 76px; }
.gtw-clock small { font-size: 0.58rem; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; color: var(--g-muted); line-height: 1.1; }
.gtw-clock b { font-family: var(--g-font-display); font-weight: 900; font-size: 1.32rem; line-height: 1; font-variant-numeric: tabular-nums; }
.gtw-clock.hot b { color: var(--g-bad); }
.gtw-pips { display: flex; gap: 3px; margin-top: 2px; } .gtw-pips i { width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid var(--g-ink); background: var(--g-card); }
.gtw-pips i.a { background: var(--p-a); } .gtw-pips i.b { background: var(--p-b); } .gtw-pips i.now { background: var(--g-hl); }

/* role, health, heat (left column, under the back sticker) */
.gtw-left { position: absolute; left: calc(10px + var(--sl)); top: calc(var(--cs) + 4px); display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.gtw-view.l .gtw-left, .gtw-view.r .gtw-left { top: 64px; }
.gtw-role { padding: 4px 10px; border-radius: 999px; font: 900 0.72rem/1 var(--g-font-body); letter-spacing: .12em; text-transform: uppercase; border: 2px solid var(--g-ink); background: var(--g-ink); color: var(--g-bg); }
.gtw-role.runner { background: var(--me); color: var(--g-on-ink); }
.gtw-role.cop { background: linear-gradient(90deg, #e2333f 50%, #2f6bff 50%); color: #fff; text-shadow: 0 1px 0 #0008; }
.gtw-bar { width: 128px; padding: 4px 6px 5px; }
.gtw-bar small { display: flex; justify-content: space-between; font: 900 0.58rem/1 var(--g-font-body); letter-spacing: .1em; text-transform: uppercase; color: var(--g-muted); margin-bottom: 3px; }
.gtw-bar small b { color: var(--g-ink); }
.gtw-bar .t { height: 9px; border-radius: 5px; border: 2px solid var(--g-ink); background: var(--g-bg); overflow: hidden; }
.gtw-bar .t i { display: block; height: 100%; width: 100%; background: var(--g-good); transform-origin: left center; transition: transform .25s, background .25s; }
.gtw-bar.low .t i { background: var(--g-bad); } .gtw-bar.mid .t i { background: var(--g-hl); }
.gtw-heat .t i { background: var(--me); }
.gtw-heat.spotted small b { color: var(--g-bad); }
.gtw-heat.hot { animation: gtw-throb .8s infinite; }
@keyframes gtw-throb { 50% { transform: scale(1.05); } }

/* minimap */
.gtw-mini { position: absolute; right: calc(10px + var(--sr)); top: calc(var(--cs) + 4px); width: 124px; height: 124px; border-radius: 50%; overflow: hidden; pointer-events: auto !important; cursor: pointer; padding: 0; }
.gtw-view.l .gtw-mini, .gtw-view.r .gtw-mini { top: 64px; }
.gtw-mini canvas { width: 100%; height: 100%; display: block; }
.gtw-mini b { position: absolute; left: 50%; top: 3px; transform: translateX(-50%); font: 900 0.6rem/1 var(--g-font-body); color: var(--g-ink); }
.gtw-mini kbd { position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%); font: 800 0.58rem/1 var(--g-font-body); background: var(--g-ink); color: var(--g-bg); border-radius: 4px; padding: 2px 4px; }
.g-gtw.touch .gtw-mini kbd { display: none; }

/* speed + nitro */
.gtw-speed { position: absolute; right: calc(14px + var(--sr)); bottom: calc(14px + var(--sb)); display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.g-gtw.touch .gtw-view.full .gtw-speed { bottom: auto; top: calc(var(--cs) + 140px); right: calc(14px + var(--sr)); }
.gtw-speed b { font-family: var(--g-font-display); font-weight: 900; font-size: 2rem; line-height: .9; font-variant-numeric: tabular-nums; -webkit-text-stroke: 1.5px var(--g-ink); color: var(--g-card); text-shadow: 2px 2px 0 var(--g-edge); }
.gtw-speed small { font: 900 0.6rem/1 var(--g-font-body); letter-spacing: .14em; color: var(--g-ink); background: var(--g-card); border-radius: 4px; padding: 2px 4px; }
.gtw-nitro { width: 92px; height: 10px; border-radius: 6px; border: 2px solid var(--g-ink); background: var(--g-card); overflow: hidden; }
.gtw-nitro i { display: block; height: 100%; width: 100%; background: var(--g-hl); transform-origin: left; }
.gtw-nitro.on i { background: #33c6ff; }
.gtw-tools { display: flex; gap: 4px; }
.gtw-tools span { font: 900 0.62rem/1 var(--g-font-body); background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 6px; padding: 3px 5px; }
.gtw-tools span.off { opacity: .35; }

/* stamps + hints + countdown */
.gtw-stamp { position: absolute; left: 50%; top: 34%; transform: translate(-50%, -50%) rotate(-7deg) scale(.6); opacity: 0; font-family: var(--g-font-display); font-weight: 900; font-size: clamp(2.6rem, 11vw, 5.4rem); line-height: 1; color: var(--g-hl); -webkit-text-stroke: 3px var(--g-ink); text-shadow: 5px 5px 0 var(--g-edge); white-space: nowrap; }
.gtw-stamp.go { animation: gtw-stamp 1.2s cubic-bezier(.2,1.6,.4,1) forwards; }
.gtw-stamp.bad { color: var(--g-bad); } .gtw-stamp.a { color: var(--p-a); } .gtw-stamp.b { color: var(--p-b); }
@keyframes gtw-stamp { 0% { opacity: 0; transform: translate(-50%, -50%) rotate(-7deg) scale(2.2); } 14% { opacity: 1; transform: translate(-50%, -50%) rotate(-7deg) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -50%) rotate(-7deg) scale(1.05); } }
.gtw-hint { position: absolute; left: 50%; top: calc(var(--cs) + 30px); transform: translateX(-50%); max-width: min(calc(100% - 300px), 360px); padding: 6px 12px; font-weight: 800; font-size: 0.82rem; text-align: center; border-radius: 10px; background: var(--g-ink); color: var(--g-bg); box-shadow: 3px 3px 0 var(--g-hl); opacity: 0; transition: opacity .25s; }
@media (max-width: 600px) { .gtw-hint { top: auto; bottom: calc(150px + var(--sb)); max-width: calc(100% - 40px); } }
.gtw-hint.on { opacity: 1; }
.gtw-count { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); font-family: var(--g-font-display); font-weight: 900; font-size: clamp(4rem, 22vw, 9rem); line-height: 1; color: var(--g-card); -webkit-text-stroke: 4px var(--g-ink); text-shadow: 6px 6px 0 var(--g-edge); }
.gtw-count.go { color: var(--g-hl); }
.gtw-count.pop { animation: gtw-pop .9s ease-out; }
@keyframes gtw-pop { 0% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; } 20% { transform: translate(-50%, -50%) scale(1); opacity: 1; } 100% { opacity: .2; } }
.gtw-flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
.gtw-flash.go { animation: gtw-flash .5s ease-out; }
@keyframes gtw-flash { 0% { opacity: .8; } 100% { opacity: 0; } }
.gtw-vig { position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 0 transparent; transition: box-shadow .3s; }
.gtw-vig.siren { box-shadow: inset 34px 0 60px -30px rgba(230, 40, 60, .55), inset -34px 0 60px -30px rgba(40, 100, 255, .55); }
.gtw-vig.hurt { box-shadow: inset 0 0 90px 20px rgba(214, 40, 50, .45); }
.gtw-tag { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); padding: 2px 7px; border-radius: 7px; font: 900 0.7rem/1.2 var(--g-font-body); background: var(--them); color: var(--g-on-ink); border: 2px solid var(--g-ink); white-space: nowrap; }
.gtw-tag.cop { background: var(--g-ink); color: var(--g-bg); }
.gtw-edge { position: absolute; width: 26px; height: 26px; margin: -13px; border-radius: 50%; background: var(--them); border: 2.5px solid var(--g-ink); display: grid; place-items: center; }
.gtw-edge::after { content: ''; width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 9px solid var(--g-ink); transform: rotate(var(--a, 0deg)); }

/* touch controls */
.gtw-ctl { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.gtw-ctl [data-pad], .gtw-ctl [data-tap] { pointer-events: auto; position: absolute; display: grid; place-items: center; background: var(--g-card); color: var(--g-ink); border: 2.5px solid var(--g-ink); box-shadow: var(--g-shadow, 3px 3px 0 var(--g-edge)); font: 900 0.68rem/1 var(--g-font-body); letter-spacing: .08em; text-transform: uppercase; touch-action: none; padding: 0; transition: transform .06s, box-shadow .06s; }
.gtw-ctl .press { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--g-edge); }
.gtw-ctl [data-pad="gas"] { right: calc(16px + var(--sr)); bottom: calc(18px + var(--sb)); width: 82px; height: 118px; border-radius: 20px 20px 16px 16px; background: var(--g-hl); color: var(--g-on-ink); }
.gtw-ctl [data-pad="brake"] { right: calc(110px + var(--sr)); bottom: calc(18px + var(--sb)); width: 72px; height: 78px; border-radius: 16px; }
.gtw-ctl [data-pad="hand"] { right: calc(110px + var(--sr)); bottom: calc(108px + var(--sb)); width: 72px; height: 52px; border-radius: 14px; }
.gtw-ctl [data-pad="nitro"] { right: calc(16px + var(--sr)); bottom: calc(148px + var(--sb)); width: 82px; height: 52px; border-radius: 14px; background: #33c6ff; color: #002233; }
.gtw-ctl [data-tap="act"] { right: calc(194px + var(--sr)); bottom: calc(18px + var(--sb)); width: 62px; height: 62px; border-radius: 50%; }
.gtw-ctl [data-tap="act"].cop { background: var(--g-bad); color: #fff; }
.gtw-ctl [data-tap="act"][disabled] { opacity: .4; }
.gtw-ctl [data-tap="look"] { right: calc(194px + var(--sr)); bottom: calc(92px + var(--sb)); width: 50px; height: 40px; border-radius: 12px; }
.gtw-ctl [data-tap="cam"] { right: calc(10px + var(--sr)); top: calc(var(--cs) + 132px); width: 46px; height: 32px; border-radius: 10px; font-size: .58rem; }
.gtw-ctl svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.gtw-ctl span.l { display: block; margin-top: 2px; }
.gtw-steer { position: absolute; width: 168px; height: 54px; margin: -27px 0 0 -84px; border-radius: 27px; border: 2.5px dashed color-mix(in srgb, var(--g-ink) 55%, transparent); opacity: 0; pointer-events: none; transition: opacity .12s; }
.gtw-steer.on { opacity: 1; }
.gtw-steer i { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px; border-radius: 50%; background: var(--g-card); border: 2.5px solid var(--g-ink); box-shadow: var(--g-shadow, 3px 3px 0 var(--g-edge)); transform: translateX(calc(var(--k, 0) * 60px)); }
.gtw-steerhint { position: absolute; left: calc(28px + var(--sl)); bottom: calc(40px + var(--sb)); width: 150px; height: 50px; border-radius: 25px; border: 2.5px dashed color-mix(in srgb, var(--g-ink) 35%, transparent); display: grid; place-items: center; font: 900 0.6rem/1 var(--g-font-body); letter-spacing: .1em; color: color-mix(in srgb, var(--g-ink) 60%, transparent); text-transform: uppercase; pointer-events: none; }
.g-gtw:not(.touch) .gtw-ctl { display: none; }
.g-gtw.portrait .gtw-ctl [data-pad="gas"] { height: 104px; width: 76px; }
.g-gtw.portrait .gtw-ctl [data-pad="brake"] { right: calc(102px + var(--sr)); width: 66px; }
.g-gtw.portrait .gtw-ctl [data-pad="hand"] { right: calc(102px + var(--sr)); width: 66px; bottom: calc(104px + var(--sb)); }
.g-gtw.portrait .gtw-ctl [data-pad="nitro"] { width: 76px; bottom: calc(132px + var(--sb)); }
.g-gtw.portrait .gtw-ctl [data-tap="act"] { right: calc(102px + var(--sr)); bottom: calc(166px + var(--sb)); width: 56px; height: 56px; }
.g-gtw.portrait .gtw-ctl [data-tap="look"] { right: calc(16px + var(--sr)); bottom: calc(190px + var(--sb)); width: 50px; }
.g-gtw.portrait .gtw-steerhint { width: 130px; }

/* legend (keyboard) */
.gtw-legend { position: absolute; left: calc(12px + var(--sl)); bottom: calc(12px + var(--sb)); padding: 7px 9px; font-size: 0.68rem; font-weight: 700; line-height: 1.55; pointer-events: none; }
.gtw-legend kbd { font: 800 0.62rem/1 var(--g-font-body); padding: 2px 4px; border-radius: 4px; border: 1.5px solid var(--g-ink); background: var(--g-bg); }
.g-gtw.touch .gtw-legend { display: none; }

/* map view */
.gtw-map { position: absolute; inset: 0; z-index: 5; background: color-mix(in srgb, var(--g-bg) 82%, transparent); display: grid; place-items: center; padding: calc(10px + var(--st)) 12px calc(10px + var(--sb)); }
.gtw-map .box { position: relative; width: min(100%, 720px); height: 100%; max-height: 720px; display: flex; flex-direction: column; gap: 8px; padding: 10px; }
.gtw-map canvas { flex: 1; min-height: 0; width: 100%; border-radius: 8px; border: 2px solid var(--g-ink); touch-action: none; cursor: crosshair; background: var(--g-bg); }
.gtw-map .row { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.gtw-map h3 { margin: 0; font: 900 1rem/1.1 var(--g-font-body); } .gtw-map p { margin: 0; font-size: 0.8rem; font-weight: 700; color: var(--g-muted); }
.gtw-map button { appearance: none; border: 2.5px solid var(--g-ink); border-radius: 12px; background: var(--g-ink); color: var(--g-bg); font: 900 0.9rem/1 var(--g-font-body); padding: 10px 14px; cursor: pointer; }

/* overlay cards */
.gtw-over { position: absolute; inset: 0; z-index: 6; display: grid; place-items: center; padding: calc(12px + var(--st)) 14px calc(12px + var(--sb)); pointer-events: auto; overflow-y: auto; }
.gtw-over.dim { background: color-mix(in srgb, var(--g-bg) 70%, transparent); }
.gtw-over.solid { background: var(--g-bg); }
.gtw-over.clear { background: transparent; pointer-events: none; }
.gtw-over.clear .gtw-card { pointer-events: auto; }
.gtw-over.bottom { align-items: end; }
.gtw-card { width: min(100%, 420px); padding: 16px 16px 14px; display: flex; flex-direction: column; gap: 10px; text-align: center; max-height: 100%; overflow-y: auto; }
.gtw-card h2 { margin: 0; font-family: var(--g-font-display); font-weight: 900; font-size: 1.7rem; line-height: 1.05; }
.gtw-card h3 { margin: 0; font-size: 0.68rem; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; color: var(--g-muted); }
.gtw-card p { margin: 0; font-weight: 700; color: var(--g-muted); line-height: 1.35; font-size: .9rem; }
.gtw-card p b { color: var(--g-ink); }
.gtw-logo { font-family: var(--g-font-display); font-weight: 900; font-size: 2.5rem; line-height: .95; letter-spacing: -.01em; display: inline-block; transform: rotate(-3deg); color: var(--g-hl); -webkit-text-stroke: 2px var(--g-ink); text-shadow: 4px 4px 0 var(--g-edge); }
.gtw-logo span { color: var(--p-b); }
.gtw-tagline { font-weight: 800; color: var(--g-muted); font-size: .86rem; }
.gtw-mapcard { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; padding: 8px; border: 2.5px solid var(--g-ink); border-radius: 14px; background: var(--g-bg); }
.gtw-mapcard canvas, .gtw-mapcard .plan { width: 84px; height: 84px; border-radius: 10px; border: 2px solid var(--g-ink); background: var(--g-card); }
.gtw-mapcard .info { display: flex; flex-direction: column; gap: 2px; text-align: left; min-width: 0; }
.gtw-mapcard .info b { font-size: 1.05rem; font-weight: 900; } .gtw-mapcard .info small { font-size: .74rem; font-weight: 700; color: var(--g-muted); line-height: 1.25; }
.gtw-mapcard .info em { font-style: normal; font-size: .64rem; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; color: var(--g-bad); }
.gtw-arrow { width: 38px; height: 38px; border-radius: 50%; border: 2.5px solid var(--g-ink); background: var(--g-card); color: var(--g-ink); font: 900 1.2rem/1 var(--g-font-body); cursor: pointer; }
.gtw-arrow[disabled] { opacity: .35; }
.gtw-mapsel { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: center; }
.gtw-lrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.gtw-chips { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.gtw-chip { padding: 8px 11px; border: 2px solid var(--g-line); border-radius: 999px; background: transparent; color: var(--g-ink); font: 800 0.82rem/1 var(--g-font-body); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; touch-action: manipulation; }
.gtw-chip.on { border-color: var(--g-ink); background: var(--g-ink); color: var(--g-bg); }
.gtw-chip i { width: 10px; height: 10px; border-radius: 50%; } .gtw-chip.pa i { background: var(--p-a); } .gtw-chip.pb i { background: var(--p-b); }
.gtw-chip[disabled] { opacity: .45; cursor: default; }
.gtw-btns { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.gtw-go { appearance: none; border: 2.5px solid var(--g-ink); border-radius: 14px; background: var(--me); color: var(--g-on-ink); font: 900 1.05rem/1 var(--g-font-body); padding: 14px 18px; box-shadow: 4px 4px 0 var(--g-edge); cursor: pointer; touch-action: manipulation; flex: 1; }
.gtw-go:active { transform: translate(3px, 3px); box-shadow: 1px 1px 0 var(--g-edge); }
.gtw-go[disabled] { opacity: .5; }
.gtw-ghost { appearance: none; border: 2px solid var(--g-line); border-radius: 12px; background: transparent; color: var(--g-ink); font: 800 0.88rem/1 var(--g-font-body); padding: 11px 13px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
.gtw-wait { font-weight: 800; color: var(--g-muted); font-size: .88rem; flex: 1; }
.gtw-name-a { color: var(--p-a-text, var(--p-a)); } .gtw-name-b { color: var(--p-b-text, var(--p-b)); }
.gtw-bar2 { height: 12px; border-radius: 7px; border: 2px solid var(--g-ink); overflow: hidden; background: var(--g-bg); }
.gtw-bar2 i { display: block; height: 100%; background: var(--g-hl); transition: width .2s; }
.gtw-roles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.gtw-roles > div { border: 2.5px solid var(--g-ink); border-radius: 12px; padding: 8px; display: flex; flex-direction: column; gap: 2px; background: var(--g-bg); }
.gtw-roles b { font-size: .95rem; } .gtw-roles small { font-size: .7rem; font-weight: 800; color: var(--g-muted); letter-spacing: .1em; text-transform: uppercase; }
.gtw-roles .me { background: var(--g-hl-soft, var(--g-bg)); box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-edge)); }
.gtw-big { font-family: var(--g-font-display); font-weight: 900; font-size: 2.6rem; line-height: 1; }
.gtw-big.bad { color: var(--g-bad); } .gtw-big.good { color: var(--g-good); }
.gtw-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.gtw-stats div { border: 2px solid var(--g-line); border-radius: 10px; padding: 6px 2px; display: flex; flex-direction: column; gap: 2px; }
.gtw-stats b { font-family: var(--g-font-display); font-weight: 900; font-size: 1.05rem; } .gtw-stats small { font-size: .58rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; color: var(--g-muted); }
.gtw-score { display: flex; justify-content: center; gap: 14px; align-items: center; font-weight: 900; }
.gtw-score span { display: inline-flex; align-items: center; gap: 6px; font-size: 1.05rem; } .gtw-score i { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--g-ink); }
.gtw-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.gtw-mode { text-align: left; padding: 9px 10px; border: 2.5px solid var(--g-line); border-radius: 14px; background: var(--g-bg); color: var(--g-ink); font: inherit; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.gtw-mode b { font-size: .92rem; font-weight: 900; } .gtw-mode small { font-size: .72rem; font-weight: 700; color: var(--g-muted); line-height: 1.25; }
.gtw-mode.on { border-color: var(--g-ink); background: var(--g-card); box-shadow: var(--g-shadow, 3px 3px 0 var(--g-edge)); }
.gtw-mode[disabled] { opacity: .45; }
/* settings sheet */
.gtw-sheet { position: absolute; inset: 0; z-index: 7; background: var(--g-dim, rgba(0,0,0,.35)); display: grid; place-items: end center; padding: calc(10px + var(--st)) 10px 0; }
.gtw-sheet .in { width: min(100%, 480px); max-height: 100%; overflow-y: auto; border-radius: 18px 18px 0 0; padding: 14px 14px calc(14px + var(--sb)); display: flex; flex-direction: column; gap: 8px; }
.gtw-sheet h2 { margin: 0; font-family: var(--g-font-display); font-weight: 900; font-size: 1.35rem; }
.gtw-srow { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center; padding: 6px 0; border-bottom: 1.5px dashed var(--g-line); }
.gtw-srow b { font-size: .88rem; font-weight: 900; display: block; } .gtw-srow small { font-size: .7rem; font-weight: 700; color: var(--g-muted); }
.gtw-step { display: flex; align-items: center; border: 2px solid var(--g-ink); border-radius: 10px; overflow: hidden; }
.gtw-step button { width: 34px; height: 34px; border: 0; background: var(--g-card); color: var(--g-ink); font: 900 1.1rem/1 var(--g-font-body); cursor: pointer; }
.gtw-step button[disabled] { opacity: .3; }
.gtw-step output { min-width: 86px; text-align: center; font: 900 .8rem/1 var(--g-font-body); padding: 0 4px; }
.gtw-ro .gtw-step button { display: none; } .gtw-ro .gtw-step output { padding: 9px 8px; }
.gtw-sheet .note { font-size: .74rem; font-weight: 700; color: var(--g-muted); }
.gtw-pause .gtw-card { gap: 12px; }
.gtw-load .gtw-card { gap: 12px; }
.gtw-road { height: 20px; border-radius: 6px; background: var(--g-ink); position: relative; overflow: hidden; }
.gtw-road::after { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 3px; margin-top: -1.5px; background: repeating-linear-gradient(90deg, var(--g-hl) 0 16px, transparent 16px 30px); animation: gtw-road .6s linear infinite; }
@keyframes gtw-road { to { transform: translateX(-30px); } }
.gtw-road i { position: absolute; top: 2px; width: 26px; height: 14px; border-radius: 5px; background: var(--me); border: 2px solid var(--g-card); transition: left .25s; }
@media (prefers-reduced-motion: reduce) { .gtw-road::after, .gtw-heat.hot, .gtw-stamp.go, .gtw-count.pop { animation: none; } .gtw-stamp.go { opacity: 1; transform: translate(-50%, -50%) rotate(-7deg); } }
.g-gtw.short .gtw-card { padding: 10px 12px; gap: 7px; }
.g-gtw.short .gtw-logo { font-size: 1.7rem; }
.gtw-lobby .col { display: contents; }
@media (min-width: 760px) { .gtw-lobby .gtw-card { width: min(100%, 720px); display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; text-align: left; } .gtw-lobby .col { display: flex; flex-direction: column; gap: 10px; } }
.g-gtw.short .gtw-lobby .gtw-card { width: min(100%, 760px); display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; text-align: left; }
.g-gtw.short .gtw-lobby .col { display: flex; flex-direction: column; gap: 8px; }
`;
