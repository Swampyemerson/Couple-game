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
};
export const icon = (k, cls = '') => `<svg class="chm-ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[k] || ''}</svg>`;

// Pose pictograms: the chameleon as a blob in each pose.
const POSE_SVG = {
  stand: '<ellipse cx="12" cy="11" rx="7" ry="4.5"/><circle cx="18" cy="9" r="3"/><path d="M8 15v4M15 15v4M5 11c-3 0-3 4 0 4"/>',
  crouch: '<ellipse cx="12" cy="14" rx="7.5" ry="4"/><circle cx="18.5" cy="12.5" r="2.8"/><path d="M7 18h3M14 18h3"/>',
  wall: '<path d="M4 2v20" stroke-width="2.6"/><ellipse cx="9" cy="12" rx="3.4" ry="7"/><circle cx="9.5" cy="4.5" r="2.4"/>',
  ball: '<circle cx="12" cy="13" r="6.5"/><circle cx="15" cy="11" r="1.4" fill="currentColor"/>',
  flat: '<ellipse cx="12" cy="16.5" rx="9" ry="2.6"/><path d="M2 20h20"/>',
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
.chm-sticker { background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 14px; box-shadow: 0 3px 0 var(--g-ink); }

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
.chm-clock.hot .chm-time { color: var(--g-bad); animation: chm-throb 1s infinite; }
.chm-sub { position: absolute; top: calc(66px + var(--chm-st)); left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 0.8rem; white-space: nowrap; }
.chm-role { padding: 3px 10px; border-radius: 999px; background: var(--g-ink); color: var(--g-bg); }
.chm-role.me { background: var(--chm-me); color: var(--g-on-ink); }
.chm-pips { display: flex; gap: 4px; }
.chm-pips i { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--g-ink); background: var(--g-card); }
.chm-pips i.done { background: var(--g-ink); } .chm-pips i.now { background: var(--g-hl); }

/* seeker gear */
.chm-gear { position: absolute; right: calc(10px + var(--chm-sr)); top: calc(96px + var(--chm-st)); display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
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
.chm-b > span:first-child { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: var(--g-card); border: 2.5px solid var(--g-ink); box-shadow: 0 3px 0 var(--g-ink); transition: transform .08s, box-shadow .08s, background .15s; }
.chm-b.big > span:first-child { width: 74px; height: 74px; }
.chm-b.prime > span:first-child { background: var(--chm-me); color: var(--g-on-ink); }
.chm-b.hl > span:first-child { background: var(--g-hl); color: #1d1b22; }
.chm-b em { font-style: normal; font-size: 0.66rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; padding: 1px 6px; border-radius: 6px; background: color-mix(in srgb, var(--g-card) 82%, transparent); }
.chm-b:active > span:first-child, .chm-b.press > span:first-child { transform: translateY(2px); box-shadow: 0 1px 0 var(--g-ink); }
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
.chm-joy i { position: absolute; left: 30px; top: 30px; width: 40px; height: 40px; border-radius: 50%; background: var(--g-card); border: 2.5px solid var(--g-ink); box-shadow: 0 3px 0 var(--g-ink); }
.chm-joyhint { position: absolute; left: calc(26px + var(--chm-sl)); bottom: calc(30px + var(--chm-sb)); width: 92px; height: 92px; border-radius: 50%; border: 2.5px dashed color-mix(in srgb, var(--g-ink) 30%, transparent); display: grid; place-items: center; font-size: 0.62rem; font-weight: 900; letter-spacing: .08em; color: color-mix(in srgb, var(--g-ink) 55%, transparent); text-transform: uppercase; }
.chm.mouse .chm-joyhint { display: none; }

/* paint tools */
.chm-tools { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(10px + var(--chm-sb)); display: flex; flex-direction: column; align-items: center; gap: 8px; width: min(calc(100% - 16px), 460px); }
.chm-trow { display: flex; gap: 6px; justify-content: center; width: 100%; }
.chm-tool { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 2px 6px; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 14px; box-shadow: 0 3px 0 var(--g-ink); color: var(--g-ink); font: inherit; font-size: 0.66rem; font-weight: 900; text-transform: uppercase; letter-spacing: .04em; cursor: pointer; touch-action: manipulation; transition: transform .08s, background .12s; }
.chm-tool .chm-ic { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2.1; stroke-linecap: round; stroke-linejoin: round; }
.chm-tool.on { background: var(--g-hl); color: #1d1b22; transform: translateY(-3px); box-shadow: 0 6px 0 var(--g-ink); }
.chm-tool:active { transform: translateY(1px); box-shadow: 0 1px 0 var(--g-ink); }
.chm-tool[disabled] { opacity: .4; }
.chm-opts { display: flex; align-items: center; gap: 8px; padding: 5px 8px; }
.chm-swatch { width: 40px; height: 40px; border-radius: 50%; border: 2.5px solid var(--g-ink); box-shadow: inset 0 0 0 3px var(--g-card); flex: none; transition: transform .2s; }
.chm-swatch.gulp { animation: chm-gulp .45s; }
.chm-seg { display: flex; border: 2px solid var(--g-ink); border-radius: 10px; overflow: hidden; }
.chm-seg button { min-width: 38px; height: 34px; padding: 0 8px; border: 0; background: var(--g-card); color: var(--g-ink); font: 900 0.72rem/1 var(--g-font-body); cursor: pointer; display: grid; place-items: center; }
.chm-seg button + button { border-left: 2px solid var(--g-ink); }
.chm-seg button.on { background: var(--g-ink); color: var(--g-bg); }
.chm-seg i { display: block; border-radius: 50%; background: currentColor; }
.chm-done { padding: 0 14px; height: 40px; border-radius: 12px; border: 2.5px solid var(--g-ink); background: var(--chm-me); color: var(--g-on-ink); font: 900 0.85rem/1 var(--g-font-body); box-shadow: 0 3px 0 var(--g-ink); cursor: pointer; display: flex; align-items: center; gap: 4px; }
.chm-done .chm-ic { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }

/* poses */
.chm-poses { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(118px + var(--chm-sb)); display: flex; gap: 6px; padding: 6px; }
.chm-pose { width: 52px; height: 58px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; border: 2px solid var(--g-ink); border-radius: 12px; background: var(--g-card); color: var(--g-ink); font: 900 0.58rem/1 var(--g-font-body); text-transform: uppercase; cursor: pointer; touch-action: manipulation; }
.chm-pose svg { width: 30px; height: 30px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.chm-pose.on { background: var(--chm-me); color: var(--g-on-ink); }

/* hint + legend */
.chm-hint { position: absolute; left: 50%; transform: translateX(-50%); top: calc(100px + var(--chm-st)); max-width: calc(100% - 32px); padding: 6px 12px; font-weight: 800; font-size: 0.82rem; text-align: center; border-radius: 999px; background: color-mix(in srgb, var(--g-ink) 86%, transparent); color: var(--g-bg); opacity: 0; transition: opacity .25s, transform .25s; }
.chm-hint.on { opacity: 1; }
.chm-legend { position: absolute; left: calc(12px + var(--chm-sl)); bottom: calc(12px + var(--chm-sb)); padding: 8px 10px; font-size: 0.72rem; font-weight: 700; line-height: 1.6; display: none; }
.chm.mouse .chm-legend { display: block; }
.chm-legend kbd { font: 800 0.66rem/1 var(--g-font-body); padding: 2px 5px; border-radius: 4px; border: 1.5px solid var(--g-ink); background: var(--g-bg); margin-right: 2px; }

/* flashes */
.chm-flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; z-index: 3; }
.chm-flash.go { animation: chm-flash .45s ease-out; }
.chm-vig { position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 0 var(--g-hl); transition: box-shadow .2s; z-index: 2; }
.chm-vig.on { box-shadow: inset 0 0 60px 14px color-mix(in srgb, var(--g-hl) 70%, transparent); }
.chm-ripple { position: absolute; left: 50%; top: 50%; width: 40px; height: 40px; margin: -20px; border-radius: 50%; border: 3px solid var(--g-hl); opacity: 0; pointer-events: none; }
.chm-ripple.go { animation: chm-ripple .9s ease-out; }
.chm-blob { position: absolute; width: 22px; height: 22px; margin: -11px; border-radius: 50%; border: 2px solid var(--g-ink); pointer-events: none; z-index: 4; transition: transform .42s cubic-bezier(.5,-0.3,.6,1), opacity .42s; }

/* cards + overlays */
.chm-over { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; padding-top: calc(16px + var(--chm-st)); padding-bottom: calc(16px + var(--chm-sb)); z-index: 4; pointer-events: auto; }
.chm-over.dim { background: color-mix(in srgb, var(--g-bg) 70%, transparent); }
.chm-over.solid { background: var(--g-bg); }
.chm-over.bottom { align-items: end; }
.chm-card { width: min(100%, 400px); padding: 18px 18px 16px; display: flex; flex-direction: column; gap: 12px; text-align: center; max-height: 100%; overflow-y: auto; }
.chm-card h2 { margin: 0; font-family: var(--g-font-display); font-size: 1.6rem; font-weight: 900; line-height: 1.05; }
.chm-card h3 { margin: 0; font-size: 0.7rem; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; color: var(--g-muted); }
.chm-card p { margin: 0; font-weight: 700; color: var(--g-muted); line-height: 1.35; }
.chm-card p b { color: var(--g-ink); }
.chm-kicker { font-size: 0.72rem; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; color: var(--g-muted); }
.chm-name-a { color: var(--p-a); } .chm-name-b { color: var(--p-b); }
.chm-big { font-family: var(--g-font-display); font-size: 3.2rem; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
.chm-go { appearance: none; border: 2.5px solid var(--g-ink); border-radius: 14px; background: var(--g-ink); color: var(--g-bg); font: 900 1.05rem/1 var(--g-font-body); padding: 15px 16px; box-shadow: 0 3px 0 color-mix(in srgb, var(--g-ink) 60%, transparent); cursor: pointer; touch-action: manipulation; }
.chm-go.me { background: var(--chm-me); color: var(--g-on-ink); box-shadow: 0 3px 0 var(--g-ink); }
.chm-go:active { transform: translateY(2px); box-shadow: none; }
.chm-go[disabled] { opacity: .5; }
.chm-ghost { appearance: none; border: 2px solid var(--g-line); border-radius: 12px; background: transparent; color: var(--g-ink); font: 800 0.9rem/1 var(--g-font-body); padding: 11px 14px; cursor: pointer; }

/* lobby */
.chm-lobby .chm-card { gap: 10px; }
.chm-title { font-family: var(--g-font-display); font-size: 2.1rem; font-weight: 900; line-height: .95; margin: 2px 0 0; letter-spacing: -0.01em; }
.chm-title span { display: inline-block; }
.chm-title .c1 { color: var(--p-a); transform: rotate(-3deg); } .chm-title .c2 { color: var(--g-ink); margin: 0 .12em; } .chm-title .c3 { color: var(--p-b); transform: rotate(2deg); }
.chm-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.chm-mode { text-align: left; padding: 10px 10px 9px; border: 2.5px solid var(--g-line); border-radius: 14px; background: var(--g-bg); color: var(--g-ink); font: inherit; cursor: pointer; display: flex; flex-direction: column; gap: 3px; touch-action: manipulation; }
.chm-mode b { font-size: 0.98rem; font-weight: 900; }
.chm-mode small { font-size: 0.74rem; font-weight: 700; color: var(--g-muted); line-height: 1.25; }
.chm-mode.on { border-color: var(--g-ink); background: var(--g-card); box-shadow: 0 3px 0 var(--g-ink); }
.chm-mode[disabled] { opacity: .5; cursor: default; }
.chm-chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.chm-chip { padding: 9px 12px; border: 2px solid var(--g-line); border-radius: 999px; background: transparent; color: var(--g-ink); font: 800 0.85rem/1 var(--g-font-body); cursor: pointer; touch-action: manipulation; display: inline-flex; align-items: center; gap: 6px; }
.chm-chip.on { border-color: var(--g-ink); background: var(--g-ink); color: var(--g-bg); }
.chm-chip i { width: 10px; height: 10px; border-radius: 50%; }
.chm-chip.pa i { background: var(--p-a); } .chm-chip.pb i { background: var(--p-b); }
.chm-wait { font-weight: 800; color: var(--g-muted); font-size: 0.9rem; }
.chm-lobby .chm-card[aria-disabled="true"] .chm-mode, .chm-lobby .chm-card[aria-disabled="true"] .chm-chip { pointer-events: none; }

/* blindfold */
.chm-blind { background: var(--g-bg); }
.chm-blind .chm-card { border-style: dashed; }
.chm-drops { display: flex; justify-content: center; gap: 8px; height: 26px; }
.chm-drops i { width: 14px; height: 18px; border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%; border: 2px solid var(--g-ink); animation: chm-drop 1.4s infinite; }
.chm-drops i:nth-child(1) { background: var(--p-a); } .chm-drops i:nth-child(2) { background: var(--g-hl); animation-delay: .2s; } .chm-drops i:nth-child(3) { background: var(--p-b); animation-delay: .4s; }

/* stamp (found / survived / countdown) */
.chm-stamp { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%) rotate(-6deg); padding: 10px 22px 12px; font-family: var(--g-font-display); font-size: 2.6rem; font-weight: 900; letter-spacing: .02em; color: var(--g-on-ink); background: var(--chm-me); border: 3px solid var(--g-ink); border-radius: 16px; box-shadow: 0 5px 0 var(--g-ink); z-index: 4; white-space: nowrap; animation: chm-stamp .5s cubic-bezier(.2,1.6,.4,1); pointer-events: none; }
.chm-stamp small { display: block; font-family: var(--g-font-body); font-size: 0.85rem; font-weight: 800; letter-spacing: 0; text-align: center; margin-top: 2px; }
.chm-stamp.a { background: var(--p-a); } .chm-stamp.b { background: var(--p-b); } .chm-stamp.ink { background: var(--g-ink); color: var(--g-bg); } .chm-stamp.hl { background: var(--g-hl); color: #1d1b22; }
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
@media (prefers-reduced-motion: reduce) { .chm *, .chm *::before, .chm *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; } }
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
      <div class="chm-poses chm-sticker" hidden>${Object.keys(POSE_SVG).map((p) => `<button class="chm-pose" data-pose="${p}" aria-label="${p}"><svg viewBox="0 0 24 24" aria-hidden="true">${POSE_SVG[p]}</svg>${p}</button>`).join('')}</div>
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
    joy: $('.chm-joy'), knob: $('.chm-joy i'), joyhint: $('.chm-joyhint'),
    poses: $('.chm-poses'), tools: $('.chm-tools'), swatch: $('.chm-swatch'), acts: $('.chm-acts'),
    hint: $('.chm-hint'), legend: $('.chm-legend'), ripple: $('.chm-ripple'), vig: $('.chm-vig'), flash: $('.chm-flash'),
    layer: $('.chm-layer'),
  };
  const cache = new Map();
  const set = (key, node, prop, val) => { if (cache.get(key) === val) return; cache.set(key, val); if (prop === 'text') node.textContent = val; else if (prop === 'html') node.innerHTML = val; else if (prop === 'hidden') node.hidden = val; else node.style.setProperty(prop, val); };
  let hintTimer = 0;
  let actsKey = '';

  const hud = {
    el,
    show(parts) {
      for (const k of ['top', 'sub', 'gear', 'cross', 'poses', 'tools', 'acts', 'joyhint']) set('vis-' + k, el[k], 'hidden', !parts[k]);
      set('vis-legend', el.legend, 'hidden', !parts.legend);
    },
    clock(phase, ms, hot) {
      set('phase', el.phase, 'text', phase);
      set('time', el.time, 'text', ms == null ? '—' : fmtTime(ms));
      const h = !!hot; if (cache.get('hot') !== h) { cache.set('hot', h); el.clock.classList.toggle('hot', h); }
    },
    scores(a, b) { set('sa', el.sa, 'text', String(a)); set('sb', el.sb, 'text', String(b)); },
    role(text, mine) { set('role', el.role, 'text', text); if (cache.get('rm') !== mine) { cache.set('rm', mine); el.role.classList.toggle('me', !!mine); } },
    pips(total, done) {
      const k = `${total}|${done}`;
      if (cache.get('pips') === k) return; cache.set('pips', k);
      el.pips.innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'done' : i === done ? 'now' : ''}"></i>`).join('');
    },
    pellets(left, max, theirs = false) {
      const k = `${left}|${max}|${theirs}`;
      if (cache.get('pel') === k) return; cache.set('pel', k);
      el.pellets.classList.toggle('theirs', theirs);
      el.pellets.innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < left ? '' : 'gone'}"></i>`).join('');
    },
    /** buttons: [{ act, icon, label, big, prime, key, disabled, cd (0..1) }] */
    actions(list) {
      const key = list.map((b) => `${b.act}${b.big ? 'B' : ''}${b.prime ? 'P' : ''}${b.hl ? 'H' : ''}${b.cdRing ? 'C' : ''}${b.key || ''}`).join(',');
      if (key !== actsKey) {
        actsKey = key;
        el.acts.style.gridTemplateColumns = list.length > 2 ? 'auto auto' : `repeat(${list.length}, auto)`;
        el.acts.innerHTML = list.map((b) => `<button class="chm-b ${b.big ? 'big' : ''} ${b.prime ? 'prime' : ''} ${b.hl ? 'hl' : ''}" data-act="${b.act}" aria-label="${esc(b.label)}"><span>${icon(b.icon)}${b.cdRing ? '<svg class="chm-cd" viewBox="0 0 56 56"><circle cx="28" cy="28" r="25.5"/></svg>' : ''}</span><em>${esc(b.label)}</em>${b.key ? `<kbd>${esc(b.key)}</kbd>` : ''}</button>`).join('');
      }
      for (const b of list) {
        const btn = el.acts.querySelector(`[data-act="${b.act}"]`);
        if (!btn) continue;
        const dis = !!b.disabled;
        if (btn.disabled !== dis) btn.disabled = dis;
        const em = btn.querySelector('em');
        if (em && em.textContent !== b.label) { em.textContent = b.label; btn.setAttribute('aria-label', b.label); }
        const hl = !!b.hl;
        if (btn.classList.contains('hl') !== hl) btn.classList.toggle('hl', hl);
        if (b.cdRing) {
          const c = btn.querySelector('.chm-cd circle');
          const off = String(Math.round(160 * (b.cd || 0)));
          if (c && c.getAttribute('stroke-dashoffset') !== off) c.setAttribute('stroke-dashoffset', off);
        }
      }
    },
    poseOn(p) { if (cache.get('pose') === p) return; cache.set('pose', p); el.poses.querySelectorAll('.chm-pose').forEach((b) => b.classList.toggle('on', b.dataset.pose === p)); },
    tool(t, size, hard, rgb) {
      const k = `${t}|${size}|${hard}`;
      if (cache.get('tool') !== k) {
        cache.set('tool', k);
        el.tools.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
        el.tools.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('on', +b.dataset.size === size));
        el.tools.querySelectorAll('[data-hard]').forEach((b) => b.classList.toggle('on', +b.dataset.hard === (hard ? 1 : 0)));
      }
      set('swatch', el.swatch, 'background', `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`);
    },
    undoEnabled(on) { const b = el.tools.querySelector('[data-act="undo"]'); if (b && b.disabled === on) b.disabled = !on; },
    hint(text, ms = 2600) {
      clearTimeout(hintTimer);
      if (!text) { el.hint.classList.remove('on'); return; }
      el.hint.textContent = text; el.hint.classList.add('on');
      if (ms > 0) hintTimer = setTimeout(() => el.hint.classList.remove('on'), ms);
    },
    legend(rows) {
      const k = rows.join('|');
      if (cache.get('leg') === k) return; cache.set('leg', k);
      el.legend.innerHTML = rows.join('<br>');
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

