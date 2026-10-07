// HUD: a themed DOM overlay over the canvas. Sticker-style pieces (card, ink border, hard
// offset shadow) to match the printed-diorama look. Every per-frame write is cached, so the
// HUD costs nothing when values don't change.
import { esc, fmtTime } from './util.js';

const I = {
  paint: '<path d="M14 4l6 6-8.5 8.5a3 3 0 01-2.1.9H6v-3.4a3 3 0 01.9-2.1z"/><path d="M12 6l6 6"/>',
  pose: '<circle cx="12" cy="6" r="2.4"/><path d="M12 9v6M8 21l4-6 4 6M7 12h10"/>',
  jump: '<path d="M12 19V6M6 11l6-6 6 6"/><path d="M5 21h14"/>',
  ready: '<path d="M4 12.5l5 5L20 6.5"/>',
  fire: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  scan: '<path d="M12 13a1 1 0 100-2 1 1 0 000 2z" fill="currentColor"/><path d="M8.5 15.5a5 5 0 010-7M15.5 8.5a5 5 0 010 7M5.6 18.4a9 9 0 010-12.8M18.4 5.6a9 9 0 010 12.8"/>',
  scurry: '<path d="M10 6l7 6-7 6"/><path d="M3 9h4M2 12h5M3 15h4"/>',
  brush: '<path d="M18.5 3.5l2 2-9 9-3-3z"/><path d="M8.5 11.5c-3 0-4.5 2-4.5 4.5 0 1.5-.8 2.6-2 3 4 1.2 9 .3 9.5-4.5"/>',
  fill: '<path d="M5 11l7-7 7 7-7 7z"/><path d="M5 11h14"/><path d="M20 15c0 1.6-1 2.8-2 2.8s-2-1.2-2-2.8 2-4 2-4 2 2.4 2 4z" fill="currentColor"/>',
  pick: '<path d="M19.5 4.5a2.1 2.1 0 00-3 0L14 7l-1-1-2 2 1 1-7 7v3h3l7-7 1 1 2-2-1-1 2.5-2.5a2.1 2.1 0 000-3z"/>',
  stamp: '<path d="M9 3h6v5l3 3v3H6v-3l3-3z"/><path d="M4 18h16v3H4z"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 010 12h-2" transform="translate(0 -6)"/>',
  done: '<path d="M4 12.5l5 5L20 6.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
  stick: '<path d="M4 20h16"/><path d="M7 20c0-4 2-6 5-6s5 2 5 6"/><path d="M12 14V5"/><circle cx="12" cy="4" r="1.6" fill="currentColor"/>',
  unstick: '<path d="M4 21h16"/><path d="M7 21c0-3 2-4.5 5-4.5s5 1.5 5 4.5"/><path d="M12 12.5V4M8.5 7.5L12 4l3.5 3.5"/>',
  zip: '<circle cx="5.5" cy="17.5" r="2.5"/><path d="M8 15.5C11 12 13 8 19 5"/><circle cx="19.5" cy="4.5" r="2" fill="currentColor"/>',
  sprint: '<circle cx="14.5" cy="4.5" r="2"/><path d="M8 21l3-6 3 2v5M6 11l4-3h4l2 4 3 1M11 8l-1 5"/>',
  watch: '<circle cx="8" cy="8" r="3"/><path d="M3 20c0-4 2.2-6.5 5-6.5s5 2.5 5 6.5"/><path d="M13.5 9.5l7-3v9l-7-3z"/>',
  cam: '<path d="M4 8h11v9H4z"/><path d="M15 11l5-3v9l-5-3z"/><path d="M7 5.5l2 2.5M12 5.5l-2 2.5"/>',
};
export const icon = (k, cls = '') => `<svg class="chm-ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[k] || ''}</svg>`;

// Pose pictograms: the chameleon as a blob in each pose.
const POSE_SVG = {
  stand: '<ellipse cx="12" cy="11" rx="7" ry="4.5"/><circle cx="18" cy="9" r="3"/><path d="M8 15v4M15 15v4M5 11c-3 0-3 4 0 4"/>',
  crouch: '<ellipse cx="12" cy="14" rx="7.5" ry="4"/><circle cx="18.5" cy="12.5" r="2.8"/><path d="M7 18h3M14 18h3"/>',
  wall: '<path d="M4 2v20" stroke-width="2.6"/><ellipse cx="9" cy="12" rx="3.4" ry="7"/><circle cx="9.5" cy="4.5" r="2.4"/>',
  ball: '<circle cx="12" cy="13" r="6.5"/><circle cx="15" cy="11" r="1.4" fill="currentColor"/>',
  flat: '<ellipse cx="12" cy="16.5" rx="9" ry="2.6"/><path d="M2 20h20"/>',
  hang: '<path d="M2 3h20" stroke-width="2.6"/><path d="M12 3c0 2-2 2-2 4"/><ellipse cx="11" cy="12" rx="3.6" ry="5"/><circle cx="11" cy="19" r="2.5"/>',
  perch: '<path d="M2 15h20" stroke-width="2.6"/><ellipse cx="11" cy="11" rx="6.5" ry="3.4"/><circle cx="17.5" cy="9" r="2.4"/><path d="M5 12c-2 1-1.5 5 1 5s2-2 .5-2.5"/>',
  squeeze: '<path d="M3 8h18M3 16h18" stroke-width="2.4"/><ellipse cx="12" cy="12" rx="8" ry="1.8"/><circle cx="19.5" cy="12" r="1.4"/>',
  corner: '<path d="M4 3v17h17" stroke-width="2.6"/><path d="M7.5 17C7.5 11 11 7.5 17 7.5" /><ellipse cx="10" cy="14" rx="2.2" ry="5.2" transform="rotate(45 10 14)"/>',
  crawl: '<path d="M2 20h20" stroke-width="2.4"/><ellipse cx="11" cy="15" rx="7" ry="3"/><circle cx="18.5" cy="13.5" r="2.4"/><path d="M6 18l-2 2M9 18l1 2M14 18l-1 2M17 18l2 2"/>',
};

export const CSS = `
.chm { position: absolute; inset: 0; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; font-family: var(--g-font-body); color: var(--g-ink); background: var(--g-bg); --chm-st: 0px; --chm-sb: env(safe-area-inset-bottom, 0px); --chm-sl: env(safe-area-inset-left, 0px); --chm-sr: env(safe-area-inset-right, 0px); --chm-me: var(--p-a); --chm-them: var(--p-b); }
.chm.is-full { --chm-st: env(safe-area-inset-top, 0px); }
.chm.me-b { --chm-me: var(--p-b); --chm-them: var(--p-a); }
.chm canvas { position: absolute; inset: 0; width: 100% !important; height: 100% !important; display: block; outline: none; }
.chm-surface { position: absolute; inset: 0; touch-action: none; }
.chm-hud { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.chm-hud > * { pointer-events: none; }
.chm-hud button, .chm-hud .chm-card, .chm-hud .chm-tools, .chm-hud .chm-poses { pointer-events: auto; }
.chm [hidden] { display: none !important; }
.chm-sticker { background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 14px; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-edge)); }

/* top bar */
.chm-top { position: absolute; top: calc(8px + var(--chm-st)); left: 50%; transform: translateX(-50%); display: flex; align-items: stretch; gap: 6px; width: max-content; max-width: calc(100% - 112px); }
.chm-sc { display: flex; align-items: center; gap: 6px; padding: 4px 9px 4px 6px; font-weight: 900; font-size: 0.95rem; min-width: 0; }
.chm-sc i { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--g-ink); flex: none; }
.chm-sc.a i { background: var(--p-a); } .chm-sc.b i { background: var(--p-b); }
.chm-sc b { font-variant-numeric: tabular-nums; }
.chm-sc span { font-size: 0.72rem; font-weight: 800; color: var(--g-muted); max-width: 5.5em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 520px) { .chm-sc span { display: none; } .chm-sc { padding: 4px 9px; } }
.chm-clock { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3px 12px 4px; min-width: 84px; }
.chm-phase { font-size: 0.64rem; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); line-height: 1.1; }
.chm-time { font-family: var(--g-font-display); font-size: 1.45rem; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
.chm-clock.untimed .chm-time { display: none; } .chm-clock.untimed .chm-phase { font-size: 0.78rem; color: var(--g-ink); }
.chm-clock.hot .chm-time { color: var(--g-bad); animation: chm-throb 1s infinite; }
.chm-sub { position: absolute; top: calc(66px + var(--chm-st)); left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 0.8rem; white-space: nowrap; }
.chm-role { padding: 3px 10px; border-radius: 999px; background: var(--g-ink); color: var(--g-bg); }
.chm-role.me { background: var(--chm-me); color: var(--g-on-ink); }
.chm-pips { display: flex; gap: 4px; }
.chm-pips i { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--g-ink); background: var(--g-card); }
.chm-pips i.done { background: var(--g-ink); } .chm-pips i.now { background: var(--g-hl); }

/* seeker gear */
.chm-gear { position: absolute; right: calc(10px + var(--chm-sr)); top: calc(100px + var(--chm-st)); display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.chm-pellets { display: flex; gap: 3px; padding: 5px 7px; }
.chm-pellets i { width: 11px; height: 14px; border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%; background: var(--chm-me); border: 1.5px solid var(--g-ink); transition: transform .2s, opacity .2s; }
.chm-pellets i.gone { transform: scale(.55); opacity: .25; background: var(--g-line); }
.chm-pellets.theirs i { background: var(--chm-them); }
.chm-cross { position: absolute; left: 50%; top: 50%; width: 30px; height: 30px; margin: -15px 0 0 -15px; }
.chm-cross::before, .chm-cross::after { content: ''; position: absolute; background: var(--g-card); box-shadow: 0 0 0 1.5px var(--g-ink); border-radius: 2px; }
.chm-cross::before { left: 14px; top: 2px; width: 2px; height: 26px; } .chm-cross::after { top: 14px; left: 2px; height: 2px; width: 26px; }
.chm-cross b { position: absolute; left: 12px; top: 12px; width: 6px; height: 6px; border-radius: 50%; background: var(--chm-me); box-shadow: 0 0 0 1.5px var(--g-ink); z-index: 1; }
.chm-cross.kick { animation: chm-kick .18s; }

/* buttons */
.chm-acts { position: absolute; right: calc(12px + var(--chm-sr)); bottom: calc(14px + var(--chm-sb)); display: grid; grid-template-columns: auto auto; grid-auto-flow: row; gap: 10px 10px; align-items: end; justify-items: center; }
.chm-b { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; background: none; border: 0; padding: 0; color: var(--g-ink); font: inherit; cursor: pointer; touch-action: manipulation; }
.chm-b > span:first-child { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: var(--g-card); border: 2.5px solid var(--g-ink); box-shadow: var(--g-shadow, 3px 3px 0 var(--g-edge)); transition: transform .08s, box-shadow .08s, background .15s; }
.chm-b.big > span:first-child { width: 74px; height: 74px; }
.chm-b.prime > span:first-child { background: var(--chm-me); color: var(--g-on-ink); }
.chm-b.hl > span:first-child { background: var(--g-hl); color: var(--g-on-ink); }
.chm-b em { font-style: normal; font-size: 0.66rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 6px; border-radius: 6px; background: var(--g-card); box-shadow: 0 0 0 1.5px var(--g-ink); }
.chm-b:active > span:first-child, .chm-b.press > span:first-child { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--g-edge); }
.chm-b[disabled] { opacity: .45; cursor: default; }
.chm-b .chm-ic { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.chm-b.big .chm-ic { width: 32px; height: 32px; }
.chm-cd { position: absolute; left: 0; top: 0; width: 56px; height: 56px; pointer-events: none; transform: rotate(-90deg); }
.chm-cd circle { fill: none; stroke: var(--g-ink); stroke-width: 5; opacity: .55; stroke-dasharray: 160; transition: stroke-dashoffset .25s linear; }
.chm-b kbd { position: absolute; top: -4px; right: -6px; font: 800 0.6rem/1 var(--g-font-body); background: var(--g-ink); color: var(--g-bg); border-radius: 5px; padding: 2px 4px; }
.chm.touch .chm-b kbd { display: none; }

/* joystick */
.chm-joy { position: absolute; left: 0; top: 0; width: 104px; height: 104px; border-radius: 50%; border: 2.5px dashed color-mix(in srgb, var(--g-ink) 45%, transparent); opacity: 0; transition: opacity .15s; pointer-events: none; }
.chm-joy.on { opacity: 1; }
.chm-joy i { position: absolute; left: 30px; top: 30px; width: 40px; height: 40px; border-radius: 50%; background: var(--g-card); border: 2.5px solid var(--g-ink); box-shadow: var(--g-shadow, 3px 3px 0 var(--g-edge)); }
.chm-joyhint { position: absolute; left: calc(26px + var(--chm-sl)); bottom: calc(30px + var(--chm-sb)); width: 92px; height: 92px; border-radius: 50%; border: 2.5px dashed color-mix(in srgb, var(--g-ink) 30%, transparent); display: grid; place-items: center; font-size: 0.62rem; font-weight: 900; letter-spacing: .08em; color: color-mix(in srgb, var(--g-ink) 55%, transparent); text-transform: uppercase; }
.chm.mouse .chm-joyhint { display: none; }

/* paint tools */
.chm-tools { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(10px + var(--chm-sb)); display: flex; flex-direction: column; align-items: center; gap: 8px; width: min(calc(100% - 16px), 460px); }
.chm-trow { display: flex; gap: 6px; justify-content: center; width: 100%; }
.chm-tool { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 2px 6px; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 14px; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-edge)); color: var(--g-ink); font: inherit; font-size: 0.66rem; font-weight: 900; text-transform: uppercase; letter-spacing: .04em; cursor: pointer; touch-action: manipulation; transition: transform .08s, background .12s; }
.chm-tool .chm-ic { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2.1; stroke-linecap: round; stroke-linejoin: round; }
.chm-tool.on { background: var(--g-hl); color: var(--g-on-ink); transform: translate(-2px, -2px); box-shadow: 5px 5px 0 var(--g-edge); }
.chm-tool:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--g-edge); }
.chm-tool[disabled] { opacity: .4; }
.chm-opts { display: flex; flex-wrap: nowrap; justify-content: center; align-items: center; gap: 6px; padding: 5px 7px; max-width: 100%; }
@media (max-width: 380px) { .chm-opts { gap: 4px; padding: 4px 5px; } .chm-seg button { min-width: 29px !important; padding: 0 4px !important; } .chm-done { padding: 0 8px !important; } .chm-swatch { width: 32px !important; height: 32px !important; } .chm-pose { width: 46px; } }
.chm-swatch { width: 36px; height: 36px; border-radius: 50%; border: 2.5px solid var(--g-ink); box-shadow: inset 0 0 0 3px var(--g-card); flex: none; transition: transform .2s; }
.chm-swatch.gulp { animation: chm-gulp .45s; }
.chm-seg { display: flex; border: 2px solid var(--g-ink); border-radius: 10px; overflow: hidden; }
.chm-seg button { min-width: 33px; height: 34px; padding: 0 7px; border: 0; background: var(--g-card); color: var(--g-ink); font: 900 0.72rem/1 var(--g-font-body); cursor: pointer; display: grid; place-items: center; }
.chm-seg button + button { border-left: 2px solid var(--g-ink); }
.chm-seg button.on { background: var(--g-ink); color: var(--g-bg); }
.chm-seg i { display: block; border-radius: 50%; background: currentColor; }
.chm-done { padding: 0 11px; height: 38px; white-space: nowrap; border-radius: 12px; border: 2.5px solid var(--g-ink); background: var(--chm-me); color: var(--g-on-ink); font: 900 0.85rem/1 var(--g-font-body); box-shadow: var(--g-shadow, 3px 3px 0 var(--g-edge)); cursor: pointer; display: flex; align-items: center; gap: 4px; }
.chm-done .chm-ic { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }

/* poses */
.chm-poses { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(118px + var(--chm-sb)); display: flex; gap: 6px; padding: 6px; }
.chm.painting .chm-poses { bottom: calc(146px + var(--chm-sb)); }
.chm-pose { width: 52px; height: 58px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; border: 2px solid var(--g-ink); border-radius: 12px; background: var(--g-card); color: var(--g-ink); font: 900 0.58rem/1 var(--g-font-body); text-transform: uppercase; cursor: pointer; touch-action: manipulation; }
.chm-pose svg { width: 30px; height: 30px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.chm-pose.on { background: var(--chm-me); color: var(--g-on-ink); }

/* hint + legend */
.chm-hint { position: absolute; left: 50%; transform: translateX(-50%); top: calc(140px + var(--chm-st)); width: max-content; max-width: min(calc(100% - 40px), 340px); padding: 6px 12px; font-weight: 800; font-size: 0.82rem; text-align: center; border-radius: 10px; background: var(--g-ink); color: var(--g-bg); box-shadow: 3px 3px 0 var(--g-hl); opacity: 0; transition: opacity .25s, transform .25s; }
.chm-hint.on { opacity: 1; }
.chm-legend { position: absolute; left: calc(12px + var(--chm-sl)); bottom: calc(12px + var(--chm-sb)); padding: 8px 10px; font-size: 0.72rem; font-weight: 700; line-height: 1.6; display: none; }
.chm.mouse .chm-legend { display: block; }
.chm-legend kbd { font: 800 0.66rem/1 var(--g-font-body); padding: 2px 5px; border-radius: 4px; border: 1.5px solid var(--g-ink); background: var(--g-bg); margin-right: 2px; }

/* flashes */
.chm-flash { position: absolute; inset: 0; background: var(--g-white, #fffdf8); opacity: 0; pointer-events: none; z-index: 3; }
.chm-flash.go { animation: chm-flash .45s ease-out; }
.chm-vig { position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 0 var(--g-hl); transition: box-shadow .2s; z-index: 2; }
.chm-vig.on { box-shadow: inset 0 0 60px 14px color-mix(in srgb, var(--g-hl) 70%, transparent); }
.chm.peek .chm-vig { box-shadow: inset 0 0 90px 30px rgba(20, 16, 24, 0.42); }
.chm.peek.beat .chm-vig { animation: chm-beat .5s ease-out; }
@keyframes chm-beat { 0% { box-shadow: inset 0 0 120px 46px rgba(214, 69, 93, 0.42); } 100% { box-shadow: inset 0 0 90px 30px rgba(20, 16, 24, 0.42); } }
.chm-ripple { position: absolute; left: 50%; top: 50%; width: 40px; height: 40px; margin: -20px; border-radius: 50%; border: 3px solid var(--g-hl); opacity: 0; pointer-events: none; }
.chm-ripple.go { animation: chm-ripple .9s ease-out; }
.chm-blob { position: absolute; width: 22px; height: 22px; margin: -11px; border-radius: 50%; border: 2px solid var(--g-ink); pointer-events: none; z-index: 4; transition: transform .42s cubic-bezier(.5,-0.3,.6,1), opacity .42s; }

/* cards + overlays */
.chm-over { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; padding-top: calc(16px + var(--chm-st)); padding-bottom: calc(16px + var(--chm-sb)); z-index: 4; pointer-events: auto; }
.chm-over.dim { background: color-mix(in srgb, var(--g-bg) 70%, transparent); }
.chm-over.solid { background: var(--g-bg); }
/* the round title floats over the map's overview orbit: a light veil, not a wash */
.chm-over.dim.veil { background: color-mix(in srgb, var(--g-bg) 18%, transparent); }
.chm-over.bottom { align-items: end; }
.chm-card { width: min(100%, 400px); padding: 18px 18px 16px; display: flex; flex-direction: column; gap: 12px; text-align: center; max-height: 100%; overflow-y: auto; }
.chm-card h2 { margin: 0; font-family: var(--g-font-display); font-size: 1.6rem; font-weight: 900; line-height: 1.05; }
.chm-card h3 { margin: 0; font-size: 0.7rem; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; color: var(--g-muted); }
.chm-card p { margin: 0; font-weight: 700; color: var(--g-muted); line-height: 1.35; }
.chm-card p b { color: var(--g-ink); }
.chm-kicker { font-size: 0.72rem; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; color: var(--g-muted); }
.chm-name-a { color: var(--p-a-text, var(--p-a)); } .chm-name-b { color: var(--p-b-text, var(--p-b)); }
.chm-card h2.chm-name-a { color: var(--p-a); } .chm-card h2.chm-name-b { color: var(--p-b); }
.chm-big { font-family: var(--g-font-display); font-size: 3.2rem; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
.chm-go { appearance: none; border: 2.5px solid var(--g-ink); border-radius: 14px; background: var(--g-ink); color: var(--g-bg); font: 900 1.05rem/1 var(--g-font-body); padding: 15px 16px; box-shadow: 4px 4px 0 0 var(--g-hl), 4px 4px 0 2px var(--g-ink); cursor: pointer; touch-action: manipulation; transition: transform .08s, box-shadow .08s; }
.chm-go.me { background: var(--chm-me); color: var(--g-on-ink); box-shadow: 4px 4px 0 var(--g-edge); }
.chm-go:active { transform: translate(3px, 3px); box-shadow: 1px 1px 0 var(--g-edge); }
.chm-go[disabled] { opacity: .5; }
.chm-ghost { appearance: none; border: 2px solid var(--g-line); border-radius: 12px; background: transparent; color: var(--g-ink); font: 800 0.9rem/1 var(--g-font-body); padding: 11px 14px; cursor: pointer; }

/* lobby */
.chm-lobby .chm-card { gap: 10px; }
.chm-col { display: contents; }
.chm-title { font-family: var(--g-font-display); font-size: 2.1rem; font-weight: 900; line-height: .95; margin: 2px 0 0; letter-spacing: -0.01em; }
.chm-title span { display: inline-block; }
.chm-title .c1 { color: var(--p-a); transform: rotate(-3deg); } .chm-title .c2 { color: var(--g-ink); margin: 0 .12em; } .chm-title .c3 { color: var(--p-b); transform: rotate(2deg); }
.chm-title .c1, .chm-title .c3, .chm-card h2.chm-name-a, .chm-card h2.chm-name-b { text-shadow: 0.06em 0.06em 0 var(--g-edge); }
.chm-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.chm-mode { text-align: left; padding: 10px 10px 9px; border: 2.5px solid var(--g-line); border-radius: 14px; background: var(--g-bg); color: var(--g-ink); font: inherit; cursor: pointer; display: flex; flex-direction: column; gap: 3px; touch-action: manipulation; }
.chm-mode b { font-size: 0.98rem; font-weight: 900; }
.chm-mode small { font-size: 0.74rem; font-weight: 700; color: var(--g-muted); line-height: 1.25; }
.chm-mode.on { border-color: var(--g-ink); background: var(--g-card); box-shadow: var(--g-shadow, 3px 3px 0 var(--g-edge)); }
.chm-mode[disabled] { opacity: .5; cursor: default; }
.chm-chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.chm-chip { padding: 9px 12px; border: 2px solid var(--g-line); border-radius: 999px; background: transparent; color: var(--g-ink); font: 800 0.85rem/1 var(--g-font-body); cursor: pointer; touch-action: manipulation; display: inline-flex; align-items: center; gap: 6px; }
.chm-chip.on { border-color: var(--g-ink); background: var(--g-ink); color: var(--g-bg); }
.chm-chip i { width: 10px; height: 10px; border-radius: 50%; }
.chm-chip.pa i { background: var(--p-a); } .chm-chip.pb i { background: var(--p-b); }
.chm-wait { font-weight: 800; color: var(--g-muted); font-size: 0.9rem; }
.chm-lobby .chm-card[data-ro] .chm-mode, .chm-lobby .chm-card[data-ro] .chm-chip { pointer-events: none; }

/* blindfold */
.chm-blind { background: var(--g-bg); }
.chm-blind .chm-card { border-style: dashed; }
.chm-drops { display: flex; justify-content: center; gap: 8px; height: 26px; }
.chm-drops i { width: 14px; height: 18px; border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%; border: 2px solid var(--g-ink); animation: chm-drop 1.4s infinite; }
.chm-drops i:nth-child(1) { background: var(--p-a); } .chm-drops i:nth-child(2) { background: var(--g-hl); animation-delay: .2s; } .chm-drops i:nth-child(3) { background: var(--p-b); animation-delay: .4s; }

/* stamp (found / survived / countdown) */
.chm-stamp { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%) rotate(-6deg); padding: 10px 22px 12px; font-family: var(--g-font-display); font-size: 2.6rem; font-weight: 900; letter-spacing: .02em; color: var(--g-on-ink); background: var(--chm-me); border: 3px solid var(--g-ink); border-radius: 16px; box-shadow: 6px 6px 0 var(--g-edge); z-index: 4; white-space: nowrap; animation: chm-stamp .5s cubic-bezier(.2,1.6,.4,1); pointer-events: none; }
.chm-stamp small { display: block; font-family: var(--g-font-body); font-size: 0.85rem; font-weight: 800; letter-spacing: 0; text-align: center; margin-top: 2px; }
.chm-stamp.a { background: var(--p-a); } .chm-stamp.b { background: var(--p-b); } .chm-stamp.ink { background: var(--g-ink); color: var(--g-bg); } .chm-stamp.hl { background: var(--g-hl); color: var(--g-on-ink); }
.chm-count { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); font-family: var(--g-font-display); font-size: 5rem; font-weight: 900; color: var(--g-ink); -webkit-text-stroke: 0; text-shadow: 0 4px 0 var(--g-card); z-index: 4; pointer-events: none; }
.chm-count.pop { animation: chm-count .8s ease-out; }

/* recap */
.chm-recap .chm-card { gap: 8px; }
.chm-recap .chm-big { font-size: 2rem; }
.chm-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.chm-stats div { border: 2px solid var(--g-line); border-radius: 12px; padding: 7px 4px; display: flex; flex-direction: column; gap: 2px; }
.chm-stats b { font-size: 1.1rem; font-weight: 900; font-variant-numeric: tabular-nums; }
.chm-stats span { font-size: 0.64rem; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: var(--g-muted); }
.chm-tally { display: flex; justify-content: center; gap: 14px; font-weight: 900; font-size: 1.05rem; }
.chm-tally span { display: inline-flex; align-items: center; gap: 6px; }
.chm-tally i { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--g-ink); }
.chm-bar { height: 10px; border-radius: 6px; border: 2px solid var(--g-ink); background: var(--g-bg); overflow: hidden; }
.chm-bar i { display: block; height: 100%; width: 0%; background: var(--g-hl); transition: width .2s; }

@keyframes chm-throb { 50% { transform: scale(1.08); } }
@keyframes chm-kick { 40% { transform: scale(1.35); } }
@keyframes chm-flash { from { opacity: .85; } to { opacity: 0; } }
@keyframes chm-ripple { from { opacity: 1; transform: scale(.4); } to { opacity: 0; transform: scale(9); } }
@keyframes chm-gulp { 30% { transform: scale(1.35); } 60% { transform: scale(.9); } }
@keyframes chm-drop { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes chm-stamp { from { transform: translate(-50%, -50%) rotate(-24deg) scale(2.2); opacity: 0; } to { transform: translate(-50%, -50%) rotate(-6deg) scale(1); opacity: 1; } }
@keyframes chm-count { from { transform: translate(-50%, -50%) scale(1.8); opacity: 0; } 25% { opacity: 1; transform: translate(-50%, -50%) scale(1); } to { opacity: 0; transform: translate(-50%, -50%) scale(.9); } }
/* a phone on its side: paint tools and options share one bottom row, poses sit bottom-left, so the body stays in view */
@media (orientation: landscape) and (max-height: 520px) {
  .chm-tools { flex-direction: row-reverse; align-items: stretch; gap: 8px; width: min(calc(100% - 20px - var(--chm-sl) - var(--chm-sr)), 820px); bottom: calc(8px + var(--chm-sb)); }
  .chm-trow { flex: 1 1 auto; width: auto; }
  .chm-tool { padding: 6px 2px 5px; }
  .chm-tool .chm-ic { width: 22px; height: 22px; }
  .chm-opts { flex: none; }
  .chm-poses, .chm.painting .chm-poses, .chm.acts3 .chm-poses, .chm.acts3.painting .chm-poses { left: calc(10px + var(--chm-sl)); transform: none; bottom: calc(84px + var(--chm-sb)); padding: 5px; gap: 5px; flex-direction: row; }
  .chm-sheetwrap { padding-left: calc(62px + var(--chm-sl)); padding-right: calc(62px + var(--chm-sr)); padding-top: calc(10px + var(--chm-st)); }
  .chm.acts3 .chm-acts { grid-template-columns: auto auto auto !important; gap: 8px 8px; }
  .chm-pose { width: 46px; height: 50px; }
  .chm-pose svg { width: 26px; height: 26px; }
  .chm-hint { top: calc(104px + var(--chm-st)); }
  /* the lobby card goes wide: title and modes on the left, map, order and Start on the right */
  .chm-over.chm-lobby { align-items: center; padding-left: calc(62px + var(--chm-sl)); padding-right: calc(62px + var(--chm-sr)); }
  .chm-lobby .chm-card { flex-direction: row; align-items: stretch; gap: 18px; width: min(100%, 700px); padding: 14px 16px; }
  .chm-col { display: flex; flex-direction: column; justify-content: center; gap: 9px; flex: 1 1 0; min-width: 0; }
  .chm-lobby .chm-title { font-size: 1.6rem; }
  .chm-lobby .chm-tag { display: none; }
  .chm-lobby .chm-card { gap: 14px; padding: 12px 14px; }
  .chm-lobby .chm-col { gap: 7px; }
  .chm-lobby .chm-mode { padding: 7px 9px; }
  .chm-lobby .chm-mode small { font-size: .68rem; }
  .chm-lobby .chm-plan { width: 52px; height: 40px; }
  .chm-lobby .chm-mapcard { padding: 5px; }
  .chm-lobby .chm-mapinfo small { display: none; }
  .chm-lobby .chm-sizes button { min-height: 38px; }
  .chm-lobby .chm-firstrow { flex-direction: row; align-items: center; justify-content: space-between; }
  .chm-lobby .chm-firstrow .chm-chip { padding: 7px 10px; }
  .chm-lobby .chm-go { padding: 12px 14px; }
  .chm-lobby .chm-more { min-height: 42px; }
  .chm-mini { top: calc(84px + var(--chm-st)); width: 96px; height: 96px; }
  .chm-tips { top: calc(70px + var(--chm-st)); width: min(calc(100% - 24px), 520px); }
  .chm-tips ul { display: grid; grid-template-columns: 1fr 1fr; }
  .chm-recap .chm-card { width: min(100%, 520px); }
}

/* v2: lobby, presets, map card, sizes */
.chm-tag { font-size: .85rem; }
.chm-presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
.chm-presets button { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 7px 2px 6px; border: 2px solid var(--g-line); border-radius: 12px; background: transparent; color: var(--g-ink); font: inherit; cursor: pointer; touch-action: manipulation; min-height: 44px; }
.chm-presets b { font-size: .82rem; font-weight: 900; }
.chm-presets small { font-size: .58rem; font-weight: 700; color: var(--g-muted); line-height: 1.15; }
.chm-presets button.on { border-color: var(--g-ink); background: var(--g-hl); color: var(--g-on-ink); box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-edge)); }
.chm-presets button.on small { color: var(--g-on-ink); opacity: .75; }
.chm-presets button.custom { pointer-events: none; border-style: dashed; }
.chm-presets button.custom:not(.on) { opacity: .5; }
.chm-mapcard { display: flex; align-items: center; gap: 8px; padding: 7px 6px; border: 2px solid var(--g-ink); border-radius: 14px; background: var(--g-bg); text-align: left; }
.chm-plan { flex: none; width: 66px; height: 50px; overflow: visible; }
.chm-sheet .chm-plan.wide { width: 88px; }
.chm-plan .pp { fill: var(--g-card); stroke: var(--g-line); stroke-width: 1.5px; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.chm-plan .pf { stroke: none; }
.chm-plan .pf.a { fill: var(--p-a); opacity: .55; } .chm-plan .pf.b { fill: var(--p-b); opacity: .5; } .chm-plan .pf.hl { fill: var(--g-hl); opacity: .85; }
.chm-plan .pht { fill: none; stroke: var(--g-ink); stroke-linecap: round; opacity: .32; }
.chm-plan .pk { fill: none; stroke: var(--g-ink); stroke-width: 1.6px; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.chm-plan .pfr { fill: none; stroke: var(--g-card); stroke-width: 2.4px; vector-effect: non-scaling-stroke; stroke-dasharray: 3 3; }
.chm-mapinfo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.chm-mapinfo b { font-size: .98rem; font-weight: 900; line-height: 1.1; }
.chm-mapinfo small { font-size: .72rem; font-weight: 700; color: var(--g-muted); line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chm-facts { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.chm-facts em { font-style: normal; font-size: .62rem; font-weight: 900; letter-spacing: .04em; text-transform: uppercase; padding: 2px 6px; border-radius: 999px; background: var(--g-card); box-shadow: 0 0 0 1.5px var(--g-ink); display: inline-flex; align-items: center; gap: 4px; }
.chm-facts em.ar { text-transform: none; letter-spacing: .02em; }
.chm-climbs span { display: inline-flex; gap: 2px; }
.chm-climbs i { width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid var(--g-ink); }
.chm-climbs i.on { background: var(--p-b); }
.chm-arrow { flex: none; width: 36px; height: 44px; border: 2px solid var(--g-ink); border-radius: 10px; background: var(--g-card); color: var(--g-ink); font: 900 1.4rem/1 var(--g-font-body); cursor: pointer; touch-action: manipulation; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-edge)); }
.chm-arrow:active { transform: translate(2px, 2px); box-shadow: none; }
.chm-arrow[disabled] { opacity: .35; box-shadow: none; }
.chm-lrow { display: flex; flex-direction: column; gap: 5px; }
.chm-sizes { display: grid; grid-template-columns: repeat(5, 1fr); border: 2px solid var(--g-ink); border-radius: 12px; overflow: hidden; }
.chm-sizes button { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 3px; min-height: 46px; padding: 4px 1px 5px; border: 0; background: var(--g-card); color: var(--g-ink); font: 900 .64rem/1 var(--g-font-body); text-transform: uppercase; letter-spacing: .03em; cursor: pointer; touch-action: manipulation; }
.chm-sizes button + button { border-left: 2px solid var(--g-ink); }
.chm-sizes i { display: block; border-radius: 50% 50% 45% 45%; background: currentColor; }
.chm-sizes button.on { background: var(--chm-me); color: var(--g-on-ink); }
.chm-sizes button[disabled] { cursor: default; }
.chm-lbtns { display: flex; gap: 8px; align-items: stretch; }
.chm-lbtns .chm-go { flex: 1; }
.chm-lbtns .chm-wait { flex: 1; align-self: center; }
.chm-more { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; min-height: 48px; border: 2.5px solid var(--g-ink); border-radius: 14px; background: var(--g-card); color: var(--g-ink); font: 900 .88rem/1 var(--g-font-body); cursor: pointer; touch-action: manipulation; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-edge)); }
.chm-more:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--g-edge); }
.chm-more .chm-ic, .chm-done .chm-ic { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
.chm-lobby .chm-card[data-ro] .chm-presets button, .chm-lobby .chm-card[data-ro] .chm-sizes button { pointer-events: none; }
.chm-lobby .chm-card[data-ro] .chm-arrow { pointer-events: none; }

/* settings sheet (the lobby card underneath steps aside: only the dimmed diorama shows round it) */
.chm-lobby.sheet-open > .chm-card { visibility: hidden; }
.chm-sheetwrap { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; padding: 12px; padding-top: calc(var(--gm-corner-safe, 64px) + 4px); padding-bottom: calc(12px + var(--chm-sb)); background: var(--g-dim, color-mix(in srgb, var(--g-bg) 70%, transparent)); pointer-events: auto; }
.chm-sheet { width: min(100%, 460px); max-height: 100%; min-height: 0; flex: none; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y; padding: 14px 14px 16px; display: flex; flex-direction: column; gap: 9px; text-align: left; }
.chm-sheethead { display: flex; align-items: center; justify-content: space-between; gap: 8px; position: sticky; top: -14px; background: var(--g-card); padding: 4px 0 6px; margin-top: -4px; z-index: 1; border-bottom: 2px solid var(--g-line); }
.chm-sheet h2 { margin: 0; font-family: var(--g-font-display); font-weight: 900; font-size: 1.3rem; }
.chm-sheet h3 { margin: 6px 0 0; font-size: .7rem; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; color: var(--g-muted); }
.chm-sheet .chm-wait { font-size: .82rem; margin: 0; }
.chm-mapchips { justify-content: flex-start; }
.chm-sets { display: flex; flex-direction: column; }
.chm-set { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 0; border-bottom: 1.5px dashed var(--g-line); }
.chm-set > span { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.chm-set b { font-size: .9rem; font-weight: 900; }
.chm-set small { font-size: .7rem; font-weight: 700; color: var(--g-muted); line-height: 1.2; }
.chm-set .chm-sizes { width: 220px; flex: none; }
.chm-set .chm-sizes button { min-height: 40px; font-size: .56rem; }
.chm-step { display: flex; align-items: center; border: 2px solid var(--g-ink); border-radius: 12px; overflow: hidden; flex: none; background: var(--g-card); }
.chm-step button { width: 40px; height: 40px; border: 0; background: var(--g-card); color: var(--g-ink); font: 900 1.25rem/1 var(--g-font-body); cursor: pointer; touch-action: manipulation; }
.chm-step button:active { background: var(--g-hl); }
.chm-step button[disabled] { opacity: .3; cursor: default; }
.chm-step output { min-width: 78px; text-align: center; font-weight: 900; font-size: .88rem; font-variant-numeric: tabular-nums; border-left: 2px solid var(--g-ink); border-right: 2px solid var(--g-ink); padding: 0 4px; line-height: 40px; }
.chm-seg2 { display: flex; border: 2px solid var(--g-ink); border-radius: 12px; overflow: hidden; flex: none; }
.chm-seg2 button { min-width: 50px; height: 40px; padding: 0 9px; border: 0; background: var(--g-card); color: var(--g-ink); font: 900 .76rem/1 var(--g-font-body); cursor: pointer; touch-action: manipulation; }
.chm-seg2 button + button { border-left: 2px solid var(--g-ink); }
.chm-seg2 button.on { background: var(--g-ink); color: var(--g-bg); }
.chm-sheet button[disabled] { cursor: default; }
.chm-sheet .chm-seg2 button[disabled]:not(.on), .chm-sheet .chm-sizes button[disabled]:not(.on), .chm-sheet .chm-chip[disabled]:not(.on) { opacity: .55; }
.chm-sheet .chm-go { margin-top: 6px; }
@media (max-width: 380px) { .chm-set .chm-sizes { width: 190px; } .chm-step output { min-width: 66px; font-size: .8rem; } .chm-step button { width: 36px; } .chm-seg2 button { min-width: 44px; padding: 0 6px; } }

/* dynamic pose bar; with six action buttons (sticky feet) the pose bar sits above them */
.chm-poses { flex-wrap: nowrap; max-width: calc(100% - 16px); }
/* portrait with six action buttons: the pose bar becomes a column on the left, above the stick */
.chm.acts3 .chm-poses { left: calc(10px + var(--chm-sl)); transform: none; bottom: calc(136px + var(--chm-sb)); flex-direction: column; padding: 5px; gap: 5px; }
.chm.acts3 .chm-pose { width: 54px; height: 52px; }
.chm.acts3.painting .chm-poses { left: 50%; transform: translateX(-50%); bottom: calc(146px + var(--chm-sb)); flex-direction: row; }
/* …but a phone on its side keeps the bottom-left row (the column ran up under the back sticker) */
@media (orientation: landscape) and (max-height: 520px) {
  .chm.acts3 .chm-poses, .chm.acts3.painting .chm-poses { left: calc(10px + var(--chm-sl)); transform: none; bottom: calc(84px + var(--chm-sb)); flex-direction: row; }
}

/* v3: the climbing seeker (seven buttons): three columns, Fire alone at the bottom right */
.chm.acts7 .chm-acts { grid-template-columns: auto auto auto !important; gap: 8px 8px; }
.chm.acts7 .chm-acts [data-act="fire"] { grid-column: 3; }
@media (orientation: landscape) and (max-height: 520px) {
  .chm.acts7 .chm-acts { grid-template-columns: repeat(4, auto) !important; }
  .chm.acts7 .chm-acts [data-act="fire"] { grid-column: 4; }
}
/* v3: the hider's spectator views: a badge under the clock and a "you're here" sticker */
.chm-badge { display: none; }
.chm.spect .chm-role { background: var(--g-hl); color: var(--g-on-ink); box-shadow: 0 0 0 2px var(--g-ink); text-transform: uppercase; letter-spacing: .08em; font-size: .72rem; }
.chm-here { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform; }
.chm-here b { position: absolute; left: 0; bottom: 9px; transform: translateX(-50%); padding: 3px 8px; border-radius: 8px; background: var(--chm-me); color: var(--g-on-ink); border: 2px solid var(--g-ink); box-shadow: 2px 2px 0 var(--g-edge); font-size: .7rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
.chm-here i { position: absolute; left: -7px; bottom: 0; width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; border-top: 10px solid var(--g-ink); }
.chm-here.edge b { opacity: .85; } .chm-here.edge i { display: none; }
.chm.spect .chm-vig { box-shadow: inset 0 0 0 4px color-mix(in srgb, var(--g-hl) 70%, transparent); }
/* v3: time sliders in the settings sheet */
.chm-set-time { flex-wrap: wrap; row-gap: 6px; }
.chm-set-time > span { flex: 1 1 0; }
.chm-range { flex: 1 1 100%; width: 100%; margin: 2px 0 4px; height: 30px; background: transparent; accent-color: var(--g-ink); touch-action: pan-x; -webkit-appearance: none; appearance: none; }
.chm-range::-webkit-slider-runnable-track { height: 8px; border-radius: 6px; background: var(--g-card); border: 2px solid var(--g-ink); }
.chm-range::-webkit-slider-thumb { -webkit-appearance: none; width: 26px; height: 26px; margin-top: -11px; border-radius: 50%; background: var(--g-hl); border: 2.5px solid var(--g-ink); box-shadow: 2px 2px 0 var(--g-edge); }
.chm-range::-moz-range-track { height: 6px; border-radius: 6px; background: var(--g-card); border: 2px solid var(--g-ink); }
.chm-range::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: var(--g-hl); border: 2.5px solid var(--g-ink); }
.chm-range[disabled] { opacity: .5; }
.chm-set-time.off .chm-step { opacity: .45; }

/* minimap (seeker, big maps) */
.chm-mini { position: absolute; left: calc(10px + var(--chm-sl)); top: calc(100px + var(--chm-st)); width: 112px; height: 112px; border-radius: 12px; padding: 4px; background: var(--g-card); }
.chm-mini canvas { position: static !important; width: 100% !important; height: 100% !important; border-radius: 8px; }
@media (min-width: 900px) and (min-height: 600px) { .chm-mini { width: 150px; height: 150px; top: calc(116px + var(--chm-st)); } }

/* first-time tips */
.chm-tips { position: absolute; left: 50%; top: calc(100px + var(--chm-st)); transform: translateX(-50%); width: min(calc(100% - 24px), 360px); padding: 12px 14px 12px; display: flex; flex-direction: column; gap: 8px; z-index: 3; pointer-events: auto; animation: chm-tipin .35s cubic-bezier(.2,1.4,.4,1); }
.chm-tips ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.chm-tips li { display: flex; gap: 9px; align-items: center; }
.chm-tips p { margin: 0; font-size: .8rem; font-weight: 700; line-height: 1.3; color: var(--g-ink); }
.chm-tips kbd { font: 800 .7rem/1 var(--g-font-body); padding: 2px 5px; border-radius: 4px; border: 1.5px solid var(--g-ink); background: var(--g-bg); }
.chm-tips .chm-go { padding: 10px 14px; font-size: .9rem; align-self: flex-end; }
.chm-ti { flex: none; width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--g-ink); }
.chm-ti.t1 { background: var(--p-a); } .chm-ti.t2 { background: var(--g-hl); } .chm-ti.t3 { background: var(--p-b); } .chm-ti.t4 { background: var(--g-card); background-image: var(--g-halftone); background-size: 5px 5px; }
@keyframes chm-tipin { from { transform: translate(-50%, -12px) scale(.94); opacity: 0; } }
.chm-b.stuck > span:first-child { background: var(--g-hl); color: var(--g-on-ink); }
.chm-b.on > span:first-child { background: var(--g-ink); color: var(--g-bg); }
/* laptops: the lobby goes wide (two columns) so the chameleons stay in view above it */
@media (min-width: 900px) and (min-height: 600px) {
  .chm-lobby .chm-card { flex-direction: row; align-items: stretch; gap: 22px; width: min(100%, 780px); padding: 16px 18px; }
  .chm-lobby .chm-col { display: flex; flex-direction: column; justify-content: center; gap: 10px; flex: 1 1 0; min-width: 0; }
  .chm-lobby .chm-firstrow { flex-direction: row; align-items: center; justify-content: space-between; }
  /* laptops: a proper dialog, two columns of settings, desktop-sized type */
  .chm-sheetwrap { padding: calc(var(--gm-corner-safe, 64px) + 8px) 88px 28px; }
  .chm-sheet { width: min(100%, 940px); padding: 20px 26px 22px; gap: 12px; border-width: 3px; border-radius: 18px; box-shadow: var(--g-shadow-lg, 6px 6px 0 var(--g-edge)); }
  .chm-sheethead { top: -20px; padding: 6px 0 10px; }
  .chm-sheet h2 { font-size: 1.75rem; }
  .chm-sheet h3 { font-size: .8rem; margin-top: 10px; }
  .chm-sheet .chm-wait { font-size: .95rem; }
  .chm-sheet .chm-done { height: 44px; padding: 0 18px; font-size: 1rem; }
  .chm-sheet .chm-presets { gap: 10px; }
  .chm-sheet .chm-presets button { min-height: 58px; padding: 9px 6px 8px; }
  .chm-sheet .chm-presets b { font-size: 1.02rem; }
  .chm-sheet .chm-presets small { font-size: .74rem; }
  .chm-sheet .chm-mapcard { padding: 10px 10px; gap: 14px; }
  .chm-sheet .chm-plan { width: 96px; height: 70px; } .chm-sheet .chm-plan.wide { width: 132px; }
  .chm-sheet .chm-mapinfo b { font-size: 1.15rem; } .chm-sheet .chm-mapinfo small { font-size: .85rem; }
  .chm-sheet .chm-facts em { font-size: .7rem; }
  .chm-sheet .chm-chip { font-size: .92rem; }
  .chm-sets { display: grid; grid-template-columns: 1fr 1fr; column-gap: 36px; }
  .chm-set { padding: 10px 0; }
  .chm-set b { font-size: 1.02rem; }
  .chm-set small { font-size: .8rem; }
  .chm-set .chm-sizes { width: 250px; }
  .chm-set .chm-sizes button { min-height: 46px; font-size: .62rem; }
  .chm-step button { width: 44px; height: 44px; font-size: 1.35rem; }
  .chm-step output { min-width: 84px; font-size: 1rem; line-height: 44px; }
  .chm-seg2 button { height: 44px; min-width: 58px; font-size: .86rem; padding: 0 12px; }
  .chm-sheet .chm-go { align-self: flex-end; min-width: 220px; }
}
@media (prefers-reduced-motion: reduce) { .chm *, .chm *::before, .chm *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; } }
@media (min-width: 900px) and (min-height: 600px) { .chm-sc { font-size: 1.1rem; padding: 6px 12px 6px 9px; } .chm-sc span { font-size: 0.82rem; } .chm-clock { min-width: 104px; } .chm-time { font-size: 1.8rem; } .chm-phase { font-size: 0.7rem; } .chm-sub { top: calc(78px + var(--chm-st)); font-size: 0.9rem; } .chm-gear { top: calc(116px + var(--chm-st)); } }
@media (min-width: 700px) { .chm-b > span:first-child { width: 60px; height: 60px; } .chm-b.big > span:first-child { width: 78px; height: 78px; } .chm-title { font-size: 2.5rem; } }
`;

export function createHud(root, api) {
  const nm = (w) => esc(api.name(w));
  root.insertAdjacentHTML('beforeend', `
    <div class="chm-hud">
      <div class="chm-top" hidden>
        <div class="chm-sc a chm-sticker"><i></i><span>${nm('a')}</span><b data-s="a">0</b></div>
        <div class="chm-clock chm-sticker"><div class="chm-phase"></div><div class="chm-time">0:00</div></div>
        <div class="chm-sc b chm-sticker"><b data-s="b">0</b><span>${nm('b')}</span><i></i></div>
      </div>
      <div class="chm-sub" hidden><span class="chm-role"></span><span class="chm-pips"></span></div>
      <div class="chm-gear" hidden><div class="chm-pellets chm-sticker"></div></div>
      <div class="chm-cross" hidden><b></b></div>
      <div class="chm-joyhint" hidden>Move</div>
      <div class="chm-joy"><i></i></div>
      <div class="chm-poses chm-sticker" hidden></div>
      <div class="chm-mini chm-sticker" hidden><canvas width="208" height="208" aria-label="Map"></canvas></div>
      <div class="chm-tips chm-sticker" hidden role="note"></div>
      <div class="chm-tools" hidden>
        <div class="chm-opts chm-sticker">
          <span class="chm-swatch" aria-label="Current colour"></span>
          <div class="chm-seg" data-seg="size"><button data-size="0" aria-label="Small brush"><i style="width:6px;height:6px"></i></button><button data-size="1" aria-label="Medium brush"><i style="width:11px;height:11px"></i></button><button data-size="2" aria-label="Large brush"><i style="width:17px;height:17px"></i></button></div>
          <div class="chm-seg" data-seg="hard"><button data-hard="1">Hard</button><button data-hard="0">Soft</button></div>
          <button class="chm-done" data-act="paint">${icon('done')}Done</button>
        </div>
        <div class="chm-trow">
          <button class="chm-tool" data-tool="brush">${icon('brush')}Brush</button>
          <button class="chm-tool" data-tool="fill">${icon('fill')}Fill</button>
          <button class="chm-tool" data-tool="pick">${icon('pick')}Pick</button>
          <button class="chm-tool" data-tool="stamp">${icon('stamp')}Stamp</button>
          <button class="chm-tool" data-act="undo">${icon('undo')}Undo</button>
        </div>
      </div>
      <div class="chm-acts" hidden></div>
      <div class="chm-badge" hidden></div>
      <div class="chm-here" hidden aria-hidden="true"><b>You</b><i></i></div>
      <div class="chm-hint"></div>
      <div class="chm-legend chm-sticker"></div>
      <div class="chm-ripple"></div>
    </div>
    <div class="chm-vig"></div>
    <div class="chm-flash"></div>
    <div class="chm-layer"></div>`);
  const $ = (s) => root.querySelector(s);
  const el = {
    top: $('.chm-top'), sub: $('.chm-sub'), phase: $('.chm-phase'), time: $('.chm-time'), clock: $('.chm-clock'),
    sa: $('[data-s="a"]'), sb: $('[data-s="b"]'), role: $('.chm-role'), pips: $('.chm-pips'),
    gear: $('.chm-gear'), pellets: $('.chm-pellets'), cross: $('.chm-cross'),
    joy: $('.chm-joy'), knob: $('.chm-joy i'), joyhint: $('.chm-joyhint'), mini: $('.chm-mini'), miniCv: $('.chm-mini canvas'), tips: $('.chm-tips'),
    poses: $('.chm-poses'), tools: $('.chm-tools'), swatch: $('.chm-swatch'), acts: $('.chm-acts'),
    hint: $('.chm-hint'), legend: $('.chm-legend'), badge: $('.chm-badge'), here: $('.chm-here'), ripple: $('.chm-ripple'), vig: $('.chm-vig'), flash: $('.chm-flash'),
    layer: $('.chm-layer'),
  };
  const cache = new Map();
  let hintTimer = 0;
  // per-frame caches (numbers / identities only, so nothing is allocated when nothing changed)
  const N = { secs: -1, timed: null, hot: null, phase: null, sa: -1, sb: -1, role: null, roleMine: null, pipT: -1, pipD: -1, pelL: -1, pelM: -1, pelT: null, list: null, tool: null, size: -1, hard: null, r: -1, g: -1, bl: -1, legend: null, undo: null, parts: {} };
  const actBtn = new Map(); // act -> { btn, em, cd, label, disabled, cdOff, hl }
  const mini = { bg: null, k: 1, ox: 0, oz: 0, px: -1, pz: -1, ya: 0, col: '', ink: '#000' };
  const pellets = [];

  const hud = {
    el,
    show(parts) {
      for (const k of ['top', 'sub', 'gear', 'cross', 'poses', 'tools', 'acts', 'joyhint', 'legend', 'mini']) {
        const on = !!parts[k];
        if (N.parts[k] === on) continue;
        N.parts[k] = on; el[k].hidden = !on;
      }
    },
    /** label: constant string; ms: remaining or null for "—". */
    clock(label, ms, hot) {
      if (N.phase !== label) { N.phase = label; el.phase.textContent = label; }
      const secs = ms == null ? -2 : Math.max(0, Math.ceil(ms / 1000));
      if (secs !== N.secs) { if ((secs === -2) !== (N.secs === -2)) el.clock.classList.toggle('untimed', secs === -2); N.secs = secs; el.time.textContent = secs === -2 ? '' : fmtTime(secs * 1000); }
      const h = !!hot; if (N.hot !== h) { N.hot = h; el.clock.classList.toggle('hot', h); }
    },
    scores(a, b) {
      if (a !== N.sa) { N.sa = a; el.sa.textContent = String(a); }
      if (b !== N.sb) { N.sb = b; el.sb.textContent = String(b); }
    },
    /** text must be a cached / constant string for zero allocations. */
    role(text, mine) {
      if (N.role !== text) { N.role = text; el.role.textContent = text; }
      if (N.roleMine !== mine) { N.roleMine = mine; el.role.classList.toggle('me', !!mine); }
    },
    pips(total, done) {
      if (N.pipT === total && N.pipD === done) return;
      N.pipT = total; N.pipD = done;
      el.pips.innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'done' : i === done ? 'now' : ''}"></i>`).join('');
    },
    pellets(left, max, theirs = false) {
      if (N.pelL === left && N.pelM === max && N.pelT === theirs) return;
      if (N.pelM !== max) {
        el.pellets.innerHTML = Array.from({ length: max }, () => '<i></i>').join('');
        pellets.length = 0; el.pellets.querySelectorAll('i').forEach((i) => pellets.push(i));
      }
      N.pelL = left; N.pelM = max;
      if (N.pelT !== theirs) { N.pelT = theirs; el.pellets.classList.toggle('theirs', theirs); }
      for (let i = 0; i < pellets.length; i++) pellets[i].classList.toggle('gone', i >= left);
    },
    /**
     * Action buttons. `list` should be a stable array of stable descriptor objects
     * ({ act, icon, label, big, prime, hl, key, disabled, cdRing, cd }); only their
     * label / disabled / cd / hl fields may change between frames.
     */
    actions(list) {
      if (list !== N.list) {
        N.list = list;
        el.acts.style.gridTemplateColumns = list.length > 2 ? 'auto auto' : `repeat(${list.length}, auto)`;
        el.acts.innerHTML = list.map((b) => `<button class="chm-b ${b.big ? 'big' : ''} ${b.prime ? 'prime' : ''} ${b.hl ? 'hl' : ''}" data-act="${b.act}" aria-label="${esc(b.label)}"><span>${icon(b.icon)}${b.cdRing ? '<svg class="chm-cd" viewBox="0 0 56 56"><circle cx="28" cy="28" r="25.5"/></svg>' : ''}</span><em>${esc(b.label)}</em>${b.key ? `<kbd>${esc(b.key)}</kbd>` : ''}</button>`).join('');
        actBtn.clear();
        for (const b of list) {
          const btn = el.acts.querySelector(`[data-act="${b.act}"]`);
          actBtn.set(b.act, { btn, em: btn.querySelector('em'), cd: btn.querySelector('.chm-cd circle'), label: b.label, disabled: false, cdOff: -1, hl: !!b.hl, on: false, icon: b.icon, ic: btn.querySelector('span') });
        }
      }
      for (let i = 0; i < list.length; i++) {
        const b = list[i]; const r = actBtn.get(b.act);
        if (!r) continue;
        const dis = !!b.disabled;
        if (r.disabled !== dis) { r.disabled = dis; r.btn.disabled = dis; }
        if (r.label !== b.label) { r.label = b.label; r.em.textContent = b.label; r.btn.setAttribute('aria-label', b.label); }
        const hl = !!b.hl; if (r.hl !== hl) { r.hl = hl; r.btn.classList.toggle('hl', hl); }
        const on = !!b.on; if (r.on !== on) { r.on = on; r.btn.classList.toggle('on', on); r.btn.setAttribute('aria-pressed', String(on)); }
        if (b.icon !== r.icon) { r.icon = b.icon; const svg = r.ic.querySelector('svg.chm-ic'); if (svg) svg.outerHTML = icon(b.icon); }
        if (r.cd) { const off = Math.round(160 * (b.cd || 0)); if (off !== r.cdOff) { r.cdOff = off; r.cd.setAttribute('stroke-dashoffset', String(off)); } }
      }
    },
    /** list: a stable array of { p, label, icon } (identity-compared; rebuilt only on change). */
    poseList(list) {
      if (N.poseList === list) return;
      N.poseList = list; cache.delete('pose');
      el.poses.innerHTML = list.map((x) => `<button class="chm-pose" data-pose="${x.p}" aria-label="${esc(x.label)}"><svg viewBox="0 0 24 24" aria-hidden="true">${POSE_SVG[x.icon] || ''}</svg>${esc(x.label)}</button>`).join('');
    },
    poseOn(p) { if (cache.get('pose') === p) return; cache.set('pose', p); el.poses.querySelectorAll('.chm-pose').forEach((b) => b.classList.toggle('on', b.dataset.pose === p)); },
    /** Tips sticker (html or null). */
    tips(html) {
      const on = !!html; if (cache.get('tips') === html) return; cache.set('tips', html);
      el.tips.hidden = !on; el.tips.innerHTML = html || '';
    },
    /** Minimap: draw the static plan once per map. plan = { minX, maxX, minZ, maxZ, rooms, boxes, floors }. */
    miniSetup(plan) {
      N.mini = null;
      const cv = el.miniCv; const g = cv.getContext('2d'); const W = cv.width; const H = cv.height;
      if (!plan) { mini.bg = null; mini.bgs = null; return; }
      const w = plan.maxX - plan.minX; const d = plan.maxZ - plan.minZ;
      const k = Math.min((W - 16) / w, (H - 16) / d);
      mini.k = k; mini.ox = (W - w * k) / 2 - plan.minX * k; mini.oz = (H - d * k) / 2 - plan.minZ * k;
      const css = getComputedStyle(root);
      const ink = css.getPropertyValue('--g-ink').trim() || '#1d1b22'; const paper = css.getPropertyValue('--g-bg').trim() || '#f4f2ee'; const line = css.getPropertyValue('--g-line').trim() || '#ccc';
      const card = css.getPropertyValue('--g-card').trim() || '#fff'; const muted = css.getPropertyValue('--g-muted').trim() || '#666';
      const font = css.getPropertyValue('--g-font-body').trim() || 'sans-serif';
      // one background per floor (two-storey maps show the floor the seeker is on)
      const floors = plan.floors && plan.floors.length ? plan.floors : [{ y: 0, rooms: plan.rooms, boxes: plan.boxes }];
      mini.bgs = floors.map((fl) => {
        const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
        const b = bg.getContext('2d');
        b.fillStyle = paper; b.fillRect(0, 0, W, H);
        b.lineJoin = 'round';
        b.fillStyle = card; b.strokeStyle = ink; b.lineWidth = 3;
        for (const r of fl.rooms) { b.fillRect(mini.ox + r.x0 * k, mini.oz + r.z0 * k, (r.x1 - r.x0) * k, (r.z1 - r.z0) * k); }
        b.fillStyle = line;
        for (const c of fl.boxes) b.fillRect(mini.ox + c.minX * k, mini.oz + c.minZ * k, Math.max(1.5, (c.maxX - c.minX) * k), Math.max(1.5, (c.maxZ - c.minZ) * k));
        for (const r of fl.rooms) b.strokeRect(mini.ox + r.x0 * k, mini.oz + r.z0 * k, (r.x1 - r.x0) * k, (r.z1 - r.z0) * k);
        if (floors.length > 1 && fl.name) { b.fillStyle = muted; b.font = `800 ${Math.round(H / 11)}px ${font}`; b.textAlign = 'center'; b.fillText(String(fl.name).toUpperCase(), W / 2, H - 3); }
        return { y: fl.y || 0, bg };
      });
      mini.bg = mini.bgs[0].bg; mini.ink = ink; mini.fi = -1;
      g.drawImage(mini.bg, 0, 0);
    },
    /** Per frame (cheap): redraws only when the dot moved or the floor changed. y: feet height. */
    miniDraw(x, z, yaw, color, y = 0) {
      if (!mini.bg) return;
      let fi = 0; for (let i = 1; i < mini.bgs.length; i++) if (y >= mini.bgs[i].y - 0.6) fi = i;
      const px = Math.round((mini.ox + x * mini.k) * 2) / 2; const pz = Math.round((mini.oz + z * mini.k) * 2) / 2; const ya = Math.round(yaw * 20) / 20;
      if (mini.px === px && mini.pz === pz && mini.ya === ya && mini.col === color && mini.fi === fi) return;
      mini.px = px; mini.pz = pz; mini.ya = ya; mini.col = color; mini.fi = fi;
      const g = el.miniCv.getContext('2d');
      g.drawImage(mini.bgs[fi].bg, 0, 0);
      g.save(); g.translate(px, pz); g.rotate(-ya + Math.PI);
      g.fillStyle = color; g.strokeStyle = mini.ink; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 8); g.lineTo(0, 4); g.lineTo(-8, 8); g.closePath(); g.fill(); g.stroke();
      g.restore();
    },
    tool(t, size, hard, rgb) {
      if (N.tool !== t || N.size !== size || N.hard !== hard) {
        N.tool = t; N.size = size; N.hard = hard;
        el.tools.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
        el.tools.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('on', +b.dataset.size === size));
        el.tools.querySelectorAll('[data-hard]').forEach((b) => b.classList.toggle('on', +b.dataset.hard === (hard ? 1 : 0)));
      }
      if (N.r !== rgb[0] || N.g !== rgb[1] || N.bl !== rgb[2]) { N.r = rgb[0]; N.g = rgb[1]; N.bl = rgb[2]; el.swatch.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; }
    },
    stampEnabled(on) { if (N.stamp === on) return; N.stamp = on; const b = el.tools.querySelector('[data-tool="stamp"]'); if (b) { b.disabled = !on; b.hidden = !on; } },
    undoEnabled(on) { if (N.undo === on) return; N.undo = on; const b = el.tools.querySelector('[data-act="undo"]'); if (b) b.disabled = !on; },
    hint(text, ms = 2600) {
      clearTimeout(hintTimer);
      if (!text) { el.hint.classList.remove('on'); return; }
      el.hint.textContent = text; el.hint.classList.add('on');
      if (ms > 0) hintTimer = setTimeout(() => el.hint.classList.remove('on'), ms);
    },
    /** rows: a constant array (identity-compared). */
    legend(rows) {
      if (N.legend === rows) return;
      N.legend = rows;
      el.legend.innerHTML = rows.join('<br>');
    },
    /** Spectator badge text (constant strings) or null. */
    badge(text) {
      if (N.badge === text) return; N.badge = text;
      el.badge.textContent = text || ''; // shown in the role pill (see .chm.spect .chm-role)
      root.classList.toggle('spect', !!text);
    },
    /** "You're here" marker at (x, y) px in the game (edge: pinned to the screen border). */
    here(on, x = 0, y = 0, edge = false) {
      if (N.hereOn !== on) { N.hereOn = on; el.here.hidden = !on; }
      if (!on) return;
      const px = Math.round(x); const py = Math.round(y);
      if (px !== N.hx || py !== N.hy) { N.hx = px; N.hy = py; el.here.style.transform = `translate(${px}px, ${py}px)`; }
      if (N.hereEdge !== edge) { N.hereEdge = edge; el.here.classList.toggle('edge', edge); }
    },
    gulp() { el.swatch.classList.remove('gulp'); void el.swatch.offsetWidth; el.swatch.classList.add('gulp'); },
    /** A colour blob flying from (x,y) to the swatch. */
    fly(x, y, rgb) {
      const b = document.createElement('i');
      b.className = 'chm-blob';
      b.style.left = x + 'px'; b.style.top = y + 'px'; b.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      root.appendChild(b);
      const r1 = root.getBoundingClientRect(); const r2 = el.swatch.getBoundingClientRect();
      requestAnimationFrame(() => { b.style.transform = `translate(${r2.left + r2.width / 2 - r1.left - x}px, ${r2.top + r2.height / 2 - r1.top - y}px) scale(.6)`; b.style.opacity = '0.4'; });
      setTimeout(() => b.remove(), 460);
    },
    flash() { el.flash.classList.remove('go'); void el.flash.offsetWidth; el.flash.classList.add('go'); },
    ripple() { el.ripple.classList.remove('go'); void el.ripple.offsetWidth; el.ripple.classList.add('go'); },
    vignette(on) { if (cache.get('vig') === on) return; cache.set('vig', on); el.vig.classList.toggle('on', on); },
    kick() { el.cross.classList.remove('kick'); void el.cross.offsetWidth; el.cross.classList.add('kick'); },
    /** Replace the overlay layer content ('' to clear). key avoids rebuilding the same card. */
    layer(key, html) {
      if (cache.get('layer') === key) return false;
      cache.set('layer', key);
      el.layer.innerHTML = html || '';
      return true;
    },
    get layerKey() { return cache.get('layer'); },
    destroy() { clearTimeout(hintTimer); },
  };
  return hud;
}

