// Doodle styles (injected once by registerGame).
export const CSS = `
    .g-doodle { position: absolute; inset: 0; color: var(--g-ink); -webkit-user-select: none; user-select: none; }
    .g-doodle .dd-scroll { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
    .g-doodle .dd-scr { width: 100%; max-width: 560px; min-height: 100%; margin: 0 auto; padding: 2px 2px calc(14px + var(--kb, 0px)); display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .g-doodle .dd-top { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; }
    .g-doodle .dd-round { font-family: var(--g-font-display); font-weight: 900; font-size: 0.95rem; letter-spacing: 0.02em; text-transform: uppercase; }
    .g-doodle .dd-round i { font-style: normal; color: var(--g-muted); }
    .g-doodle .dd-team { display: inline-flex; align-items: baseline; gap: 5px; padding: 4px 11px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); font-weight: 800; font-size: 0.85rem; box-shadow: var(--g-shadow); white-space: nowrap; }
    .g-doodle .dd-team b { font-family: var(--g-font-display); font-size: 1.05rem; }
    .g-doodle .dd-h { font-family: var(--g-font-display); font-weight: 900; font-size: 1.45rem; line-height: 1.15; margin: 4px 0 0; text-align: center; }
    .g-doodle .dd-sub { margin: 0; color: var(--g-muted); font-weight: 700; text-align: center; font-size: 0.95rem; }
    .g-doodle .p-a { color: var(--p-a-text, var(--p-a)); } .g-doodle .p-b { color: var(--p-b-text, var(--p-b)); }
    .g-doodle b.p-a, .g-doodle b.p-b { font-weight: 900; }

    /* prompt cards */
    .g-doodle .dd-picks { width: 100%; display: flex; flex-direction: column; gap: 14px; margin-top: 6px; }
    .g-doodle .dd-pick { position: relative; display: flex; align-items: center; gap: 14px; width: 100%; min-height: 76px; padding: 14px 16px; text-align: left; background: var(--g-card); color: var(--g-ink); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow); touch-action: manipulation; transition: transform 0.12s ease; }
    .g-doodle .dd-pick:nth-child(1) { transform: rotate(-1.2deg); } .g-doodle .dd-pick:nth-child(2) { transform: rotate(0.8deg); } .g-doodle .dd-pick:nth-child(3) { transform: rotate(-0.5deg); }
    .g-doodle .dd-pick:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--g-edge, var(--g-ink)); }
    .g-doodle .dd-pick-word { font-family: var(--g-font-display); font-weight: 900; font-size: 1.35rem; line-height: 1.1; min-width: 0; overflow-wrap: anywhere; }
    .g-doodle .dd-pick-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .g-doodle .dd-pick-word.fm { font-size: 1.18rem; } .g-doodle .dd-pick-word.fs { font-size: 1.04rem; }
    .g-doodle .dd-tier { flex: none; width: 64px; padding: 5px 0; text-align: center; font-weight: 900; font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; border: 2px solid var(--g-ink); border-radius: 6px; }
    .g-doodle .dd-tier.t0 { background: var(--g-card); } .g-doodle .dd-tier.t1 { background: var(--g-hl); color: var(--g-on-ink); } .g-doodle .dd-tier.t2 { background: var(--g-ink); color: var(--g-card); }
    .g-doodle .dd-pts { flex: none; font-weight: 800; color: var(--g-muted); font-size: 0.8rem; }

    /* paper */
    .g-doodle .dd-paper { position: relative; flex: none; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: calc(var(--g-radius) * 0.6); box-shadow: var(--g-shadow); overflow: hidden; }
    .g-doodle .dd-paper canvas { display: block; }
    .g-doodle .dd-paper.can-draw canvas { touch-action: none; }
    .g-doodle .dd-paper.can-draw canvas { cursor: crosshair; }
    .g-doodle .dd-ink { position: absolute; left: 8px; right: 8px; bottom: 6px; height: 5px; border-radius: 3px; background: var(--g-line); opacity: 0; transition: opacity 0.2s; pointer-events: none; }
    .g-doodle .dd-ink.on { opacity: 1; }
    .g-doodle .dd-ink i { display: block; height: 100%; width: 0; border-radius: 3px; background: var(--g-ink); }
    .g-doodle .dd-ink.low i { background: var(--g-bad); }
    .g-doodle .dd-over-btn { position: absolute; right: 8px; bottom: 8px; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 6px 14px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); color: var(--g-ink); font-weight: 800; font-size: 0.85rem; box-shadow: var(--g-shadow); touch-action: manipulation; }
    .g-doodle .dd-over-btn svg { width: 16px; height: 16px; }
    .g-doodle .dd-over-btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--g-edge, var(--g-ink)); }

    /* top bar of the draw screen */
    .g-doodle .dd-word { font-family: var(--g-font-display); font-weight: 900; font-size: 1.15rem; line-height: 1.15; flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .g-doodle .dd-word small { display: block; font-family: var(--g-font-body); font-size: 0.72rem; font-weight: 800; color: var(--g-muted); text-transform: uppercase; letter-spacing: 0.06em; }
    .g-doodle .dd-timer { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px 4px 6px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); font-family: var(--g-font-display); font-weight: 900; font-variant-numeric: tabular-nums; font-size: 1.05rem; box-shadow: var(--g-shadow); }
    .g-doodle .dd-timer svg { width: 26px; height: 26px; transform: rotate(-90deg); }
    .g-doodle .dd-timer .dd-ring-bg { fill: none; stroke: var(--g-line); stroke-width: 5; }
    .g-doodle .dd-timer .dd-ring { fill: none; stroke: var(--g-ink); stroke-width: 5; stroke-linecap: butt; }
    .g-doodle .dd-timer.low { color: var(--g-bad); border-color: var(--g-bad); }
    .g-doodle .dd-timer.low .dd-ring { stroke: var(--g-bad); }
    .g-doodle .dd-timer.zero { animation: dd-shake 0.5s ease 2; }

    /* tools */
    .g-doodle .dd-tools { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .g-doodle .dd-group { display: flex; align-items: center; gap: 4px; }
    .g-doodle .dd-swatch, .g-doodle .dd-size, .g-doodle .dd-tool { position: relative; width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; touch-action: manipulation; color: var(--g-ink); }
    .g-doodle .dd-swatch i { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--g-ink); background: var(--ink); transition: transform 0.12s; }
    .g-doodle .dd-swatch[aria-checked="true"] i { transform: scale(1.18); box-shadow: 0 0 0 3px var(--g-bg), 0 0 0 5px var(--g-ink); }
    .g-doodle .dd-size i { border-radius: 50%; background: var(--g-ink); }
    .g-doodle .dd-size[data-s="0"] i { width: 7px; height: 7px; } .g-doodle .dd-size[data-s="1"] i { width: 17px; height: 17px; }
    .g-doodle .dd-size::before { content: ''; position: absolute; inset: 3px; border-radius: 50%; border: 2px solid transparent; }
    .g-doodle .dd-size[aria-checked="true"]::before { border-color: var(--g-ink); background: var(--g-hl); }
    .g-doodle .dd-size[aria-checked="true"] i { background: var(--g-on-ink); }
    .g-doodle .dd-size i { position: relative; }
    .g-doodle .dd-sep { width: 2px; height: 26px; background: var(--g-line); margin: 0 4px; border-radius: 1px; }
    .g-doodle .dd-tool { border-radius: 12px; border: 2px solid var(--g-ink); background: var(--g-card); box-shadow: var(--g-shadow); }
    .g-doodle .dd-tool svg { width: 22px; height: 22px; }
    .g-doodle .dd-tool:disabled { opacity: 0.35; box-shadow: none; }
    .g-doodle .dd-tool:not(:disabled):active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--g-edge, var(--g-ink)); }
    .g-doodle .dd-send { flex: 1; min-height: 48px; }
    .g-doodle .dd-actions { width: 100%; display: flex; gap: 8px; align-items: center; }
    .g-doodle .gm-btn:disabled { opacity: 0.4; }

    /* guessing */
    .g-doodle .dd-by { font-weight: 800; font-size: 0.95rem; flex: 1; min-width: 0; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .g-doodle .dd-blanks { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 12px; }
    .g-doodle .dd-blanks span { display: inline-flex; gap: 3px; }
    .g-doodle .dd-blanks i { width: 13px; height: 3px; border-radius: 2px; background: var(--g-ink); margin-top: 12px; }
    .g-doodle .dd-tries { width: 100%; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 34px; }
    .g-doodle .dd-pips { display: inline-flex; gap: 5px; margin-right: 2px; }
    .g-doodle .dd-pips i { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--g-ink); background: var(--g-card); }
    .g-doodle .dd-pips i.used { background: var(--g-ink); }
    .g-doodle .dd-chip { display: inline-flex; align-items: center; gap: 4px; min-width: 0; padding: 3px 10px 3px 6px; border: 2px solid var(--g-ink); border-radius: 999px; font-weight: 800; font-size: 0.85rem; background: var(--g-card); max-width: 100%; box-sizing: border-box; overflow-wrap: anywhere; }
    .g-doodle .dd-chip svg { width: 15px; height: 15px; flex: none; }
    .g-doodle .dd-chip.no { color: var(--g-muted); text-decoration: line-through; text-decoration-thickness: 2px; }
    .g-doodle .dd-chip.no svg { color: var(--g-bad); }
    .g-doodle .dd-chip.yes { background: var(--g-hl); color: var(--g-on-ink); }
    .g-doodle .dd-chip.new { animation: dd-pop 0.35s ease; }
    .g-doodle .dd-form { width: 100%; display: flex; gap: 8px; }
    .g-doodle .dd-input { flex: 1; min-width: 0; height: 52px; padding: 0 14px; font: inherit; font-size: 17px; font-weight: 800; color: var(--g-ink); background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 12px; outline: none; -webkit-user-select: text; user-select: text; }
    .g-doodle .dd-input:focus-visible { box-shadow: 0 0 0 3px var(--g-hl); }
    .g-doodle .dd-input:disabled { opacity: 0.5; }
    .g-doodle .dd-input.shake { animation: dd-shake 0.4s ease; border-color: var(--g-bad); }
    .g-doodle .dd-form .gm-btn { min-width: 92px; min-height: 52px; }
    .g-doodle .dd-giveup { align-self: center; min-height: 44px; padding: 8px 16px; font-weight: 800; color: var(--g-muted); text-decoration: underline; text-underline-offset: 3px; touch-action: manipulation; }
    .g-doodle .dd-giveup.armed { color: var(--g-bad); }

    /* stamps + results */
    .g-doodle .dd-stamp { position: absolute; left: 50%; top: 50%; padding: 0.12em 0.36em; border: 3px solid currentColor; border-radius: 8px; background: color-mix(in srgb, var(--g-card) 82%, transparent); font-family: var(--g-font-display); font-weight: 900; font-size: 2.3rem; line-height: 1.05; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; transform: translate(-50%, -50%) rotate(-9deg); pointer-events: none; }
    .g-doodle .dd-stamp.good { color: var(--g-good); } .g-doodle .dd-stamp.bad { color: var(--g-bad); }
    .g-doodle .dd-stamp.anim { animation: dd-stamp 0.42s cubic-bezier(.2,1.6,.4,1) both; }
    .g-doodle .dd-answer { text-align: center; display: flex; flex-direction: column; gap: 2px; }
    .g-doodle .dd-answer small { color: var(--g-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem; }
    .g-doodle .dd-answer b { font-family: var(--g-font-display); font-size: 1.6rem; font-weight: 900; line-height: 1.1; overflow-wrap: anywhere; }
    .g-doodle .dd-glist { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
    .g-doodle .dd-next { width: 100%; min-height: 52px; font-size: 1.05rem; }
    .g-doodle .dd-note { margin: 0; color: var(--g-muted); font-weight: 700; text-align: center; font-size: 0.9rem; }
    .g-doodle .dd-card { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow); }
    .g-doodle .dd-card canvas { flex: none; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-card); }
    .g-doodle .dd-card-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-weight: 700; }
    .g-doodle .dd-card-txt b { font-family: var(--g-font-display); font-weight: 900; font-size: 1.1rem; }
    .g-doodle .dd-badge { flex: none; margin-left: auto; padding: 4px 10px; border: 2px solid var(--g-ink); border-radius: 8px; font-family: var(--g-font-display); font-weight: 900; background: var(--g-hl); color: var(--g-on-ink); }
    .g-doodle .dd-badge.zero { background: var(--g-card); color: var(--g-muted); }
    .g-doodle .dd-waiting { display: flex; flex-direction: column; align-items: center; gap: 6px; margin: auto 0; padding: 18px 0; }
    .g-doodle .dd-pencil { width: 220px; height: 90px; overflow: visible; }
    .g-doodle .dd-pencil-line { fill: none; stroke: var(--g-ink); stroke-width: 4; stroke-linecap: round; stroke-dasharray: 420; stroke-dashoffset: 420; animation: dd-scribble 2.6s ease-in-out infinite; }
    .g-doodle .dd-pencil-body { offset-path: path('M14 62c18-26 30-30 40-10s22 22 34-6 26-30 36-4 20 26 34 2 22-26 34-14 10 18 14 20'); offset-rotate: 0deg; animation: dd-pencil 2.6s ease-in-out infinite; }
    .g-doodle .dd-pencil-wood { fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 2.5; stroke-linejoin: round; }
    .g-doodle .dd-pencil-tip { fill: var(--g-ink); }
    .g-doodle .dd-pencil-cap { fill: var(--p-b); stroke: var(--g-ink); stroke-width: 2.5; stroke-linejoin: round; }
    .g-doodle .dd-wait-name { font-family: var(--g-font-display); font-weight: 900; font-size: 1.35rem; text-align: center; }
    .g-doodle .dd-live { width: 100%; display: flex; flex-direction: column; gap: 6px; }
    .g-doodle .dd-live-row { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 2px solid var(--g-ink); border-radius: 12px; background: var(--g-card); font-weight: 800; }
    .g-doodle .dd-live-row svg { width: 18px; height: 18px; flex: none; }
    .g-doodle .dd-live-row.no svg { color: var(--g-bad); }
    .g-doodle .dd-live-row.new { animation: dd-pop 0.35s ease; }
    .g-doodle .dd-live-row small { margin-left: auto; color: var(--g-muted); font-weight: 800; }
        .g-doodle .dd-dots { display: inline-flex; gap: 4px; }
    .g-doodle .dd-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--g-muted); animation: dd-blink 1.2s infinite; }
    .g-doodle .dd-dots i:nth-child(2) { animation-delay: 0.2s; } .g-doodle .dd-dots i:nth-child(3) { animation-delay: 0.4s; }

    /* gallery */
    .g-doodle .dd-gal-head { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 4px; }
    .g-doodle .dd-gal-kicker { font-weight: 900; font-size: 0.75rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); }
    .g-doodle .dd-plaque { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border: 2px solid var(--g-ink); border-radius: 10px; background: var(--g-hl); color: var(--g-on-ink); box-shadow: var(--g-shadow); }
    .g-doodle .dd-plaque b { font-family: var(--g-font-display); font-size: 2rem; font-weight: 900; line-height: 1; }
    .g-doodle .dd-plaque b small { font-size: 1rem; }
    .g-doodle .dd-plaque span { font-family: var(--g-font-display); font-weight: 900; font-size: 1.05rem; line-height: 1.1; max-width: 12em; }
    .g-doodle .dd-wall { width: 100%; display: grid; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); gap: 20px 14px; padding: 16px 12px 6px; box-sizing: border-box; }
    .g-doodle .dd-frame { position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 0; padding: 8px 8px 10px; text-align: left; background: var(--g-card); color: var(--g-ink); border: 2px solid var(--g-ink); border-radius: 6px; box-shadow: var(--g-shadow); touch-action: manipulation; transform: rotate(var(--tilt, 0deg)); transition: transform 0.15s ease; }
    .g-doodle .dd-frame:active { transform: rotate(0deg) translate(2px, 2px); box-shadow: 1px 1px 0 var(--g-edge, var(--g-ink)); }
    .g-doodle .dd-frame canvas { display: block; border: 2px solid var(--g-line); border-radius: 3px; background: var(--g-card); }
    .g-doodle .dd-frame-title { margin-top: 8px; font-family: var(--g-font-display); font-weight: 900; font-size: 1rem; line-height: 1.15; overflow-wrap: anywhere; }
    .g-doodle .dd-frame-meta { margin-top: 3px; font-size: 0.8rem; font-weight: 800; color: var(--g-muted); overflow-wrap: anywhere; }
    /* the score is a sticker slapped on the frame's corner */
    .g-doodle .dd-frame-pts { position: absolute; z-index: 1; top: -10px; right: -6px; padding: 2px 8px; border: 2px solid var(--g-ink); border-radius: 6px; color: var(--g-on-ink); background: var(--g-hl); font-family: var(--g-font-display); font-weight: 900; font-size: 0.9rem; box-shadow: var(--g-shadow-sm); transform: rotate(7deg); }
    .g-doodle .dd-frame-pts.zero { background: var(--g-card); color: var(--g-muted); font-family: var(--g-font-body); font-size: 0.78rem; letter-spacing: 0.04em; text-transform: uppercase; }
    .g-doodle .dd-gal-actions { width: 100%; display: flex; gap: 8px; margin-top: 6px; }
    .g-doodle .dd-gal-actions .gm-btn { flex: 1; min-height: 50px; }
    .g-doodle .dd-gal-hint { margin: 0; color: var(--g-muted); font-weight: 700; font-size: 0.85rem; }

    /* lightbox */
    .g-doodle .dd-lb { position: absolute; inset: 0; z-index: 3; display: grid; grid-template-columns: minmax(0, 1fr); place-items: center; padding: 10px; background: color-mix(in srgb, var(--g-bg) 92%, transparent); overflow-y: auto; }
    .g-doodle .dd-lb-card { width: 100%; max-width: 460px; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow); }
    .g-doodle .dd-lb-card.anim { animation: dd-rise 0.25s ease both; }
    .g-doodle .dd-lb-top { width: 100%; display: flex; align-items: flex-start; gap: 8px; }
    .g-doodle .dd-lb-top .dd-answer { flex: 1; min-width: 0; text-align: left; }
    .g-doodle .dd-lb .dd-paper { box-shadow: none; }

    /* v2 structure: head / paper / foot. Portrait stacks them; landscape puts the paper on the left. */
    .g-doodle [hidden] { display: none !important; }
    .g-doodle .dd-head, .g-doodle .dd-foot { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .g-doodle .dd-scr.land { max-width: none; }
    .g-doodle .dd-scr.land.has-p { display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto 1fr; column-gap: 14px; row-gap: 8px; align-content: start; align-items: start; justify-items: stretch; }
    .g-doodle .dd-scr.land.has-p > .dd-paper { grid-column: 1; grid-row: 1 / span 2; align-self: start; }
    .g-doodle .dd-scr.land.has-p > .dd-head { grid-column: 2; grid-row: 1; }
    .g-doodle .dd-scr.land.has-p > .dd-foot { grid-column: 2; grid-row: 2; justify-content: flex-start; }
    .g-doodle .dd-scr.land .dd-picks { flex-direction: row; }
    .g-doodle .dd-scr.land .dd-head .dd-sub, .g-doodle .dd-scr.land .dd-picks ~ .dd-note { display: none; }
    .g-doodle .dd-scr.land .dd-head .dd-h { font-size: 1.15rem; margin: 0; }
    .g-doodle .dd-scr.land .dd-pickhead .dd-h { display: none; }
    .g-doodle .dd-scr.land .dd-pick { flex-direction: column; align-items: flex-start; min-height: 84px; padding: 8px 10px; gap: 6px; flex: 1; min-width: 0; }
    .g-doodle .dd-scr.land .dd-modes { grid-template-columns: repeat(3, 1fr); }
    .g-doodle .dd-scr.land .dd-mode:last-child { grid-column: auto; }

    /* setup */
    .g-doodle .dd-sec { width: 100%; display: flex; flex-direction: column; gap: 6px; }
    .g-doodle .dd-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .g-doodle .dd-mode:last-child { grid-column: 1 / -1; }
    .g-doodle .dd-setup .dd-h { font-size: 1.25rem; margin: 0; }
    .g-doodle .dd-setup .dd-sub { font-size: 0.88rem; }
    .g-doodle .dd-setup { gap: 6px; }
    .g-doodle .dd-mode { display: flex; flex-direction: column; align-items: flex-start; gap: 0; width: 100%; min-height: 50px; padding: 6px 10px; text-align: left; background: var(--g-card); color: var(--g-ink); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow-sm); touch-action: manipulation; }
    .g-doodle .dd-mode b { font-family: var(--g-font-display); font-weight: 900; font-size: 0.95rem; line-height: 1.15; }
    .g-doodle .dd-mode span { font-weight: 700; font-size: 0.78rem; line-height: 1.2; }
    .g-doodle .dd-mode[aria-checked="true"], .g-doodle .dd-pack[aria-checked="true"] { background: var(--g-hl); color: var(--g-on-ink); box-shadow: var(--g-shadow); transform: translate(-1px, -1px); }
    .g-doodle .dd-packs { display: flex; flex-wrap: wrap; gap: 6px; }
    .g-doodle .dd-pack { min-height: 44px; padding: 0 12px; font-weight: 800; font-size: 0.9rem; color: var(--g-ink); background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 999px; box-shadow: var(--g-shadow-sm); touch-action: manipulation; }
    .g-doodle .dd-packnote { text-align: left; font-size: 0.82rem; }
    .g-doodle .dd-setup-foot { position: sticky; bottom: 0; z-index: 2; width: 100%; margin-top: auto; padding: 8px 0 2px; background: var(--g-bg); }
    .g-doodle .dd-start small { display: block; font-size: 0.72rem; font-weight: 800; opacity: 0.85; }
    .g-doodle .dd-sethead { position: relative; }
    .g-doodle .dd-fridge { position: absolute; right: 2px; top: 0; }
    .g-doodle .dd-fridge-pic canvas { display: block; border: 2px solid var(--g-ink); border-radius: 4px; background: var(--g-card); transform: rotate(3deg); }

    /* twists, pay, ladder, Half & Half */
    .g-doodle .dd-twist { width: 100%; box-sizing: border-box; display: flex; align-items: baseline; gap: 10px; padding: 3px 10px; white-space: nowrap; overflow: hidden; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-hl); color: var(--g-on-ink); box-shadow: var(--g-shadow-sm); }
    .g-doodle .dd-twist b { flex: none; font-family: var(--g-font-display); font-weight: 900; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; }
    .g-doodle .dd-twist span { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 800; font-size: 0.78rem; }
    .g-doodle .dd-scr.short .dd-twist span { display: none; }
    .g-doodle .dd-scr.short .dd-twist.soft { display: none; }
    .g-doodle .dd-pay { font-weight: 800; font-size: 0.74rem; color: var(--g-muted); }
    .g-doodle .dd-rungs { display: flex; gap: 6px; justify-content: center; }
    .g-doodle .dd-rungs i { font-style: normal; font-weight: 900; font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 10px; border: 2px solid var(--g-ink); border-radius: 6px; background: var(--g-card); color: var(--g-muted); }
    .g-doodle .dd-rungs i.done { background: var(--g-ink); color: var(--g-card); }
    .g-doodle .dd-rungs i.now { background: var(--g-hl); color: var(--g-on-ink); }
    .g-doodle .dd-half { width: 100%; display: flex; gap: 8px; }
    .g-doodle .dd-half .gm-btn { flex: 1; min-height: 54px; padding-left: 8px; padding-right: 8px; }
    .g-doodle .dd-stick { position: sticky; bottom: 0; z-index: 2; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 6px 0 2px; background: var(--g-bg); }
    .g-doodle .dd-actrow { width: 100%; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 0 12px; }
    .g-doodle .dd-unearly { min-height: 44px; padding: 8px 10px; font-weight: 800; font-size: 0.88rem; color: var(--g-ink); text-decoration: underline; text-underline-offset: 3px; touch-action: manipulation; }
    .g-doodle .dd-know small { display: block; font-size: 0.72rem; font-weight: 800; }
    .g-doodle .dd-pips i.pay { width: auto; min-width: 24px; height: 24px; padding: 0 6px; box-sizing: border-box; border-radius: 12px; display: inline-grid; place-items: center; font-style: normal; font-weight: 900; font-size: 0.78rem; }
    .g-doodle .dd-pips i.pay.used { color: var(--g-card); text-decoration: line-through; }
    .g-doodle .dd-chip em, .g-doodle .dd-live-row em { display: inline-block; font-style: normal; font-weight: 900; font-size: 0.7rem; letter-spacing: 0.04em; text-transform: uppercase; background: var(--g-hl); color: var(--g-on-ink); padding: 1px 6px; border-radius: 6px; margin-left: 4px; }
    .g-doodle .dd-live-row em { margin-left: 8px; }
    .g-doodle .dd-goldbar { width: 100%; box-sizing: border-box; text-align: center; font-weight: 900; padding: 6px 10px; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-hl); color: var(--g-on-ink); box-shadow: var(--g-shadow-sm); }
    .g-doodle .dd-bonus { margin: 0; text-align: center; font-weight: 900; color: var(--g-good); }
    .g-doodle .dd-papernote { position: absolute; left: 8px; top: 8px; padding: 2px 8px; border: 2px solid var(--g-ink); border-radius: 6px; background: var(--g-card); font-weight: 900; font-size: 0.68rem; letter-spacing: 0.06em; text-transform: uppercase; pointer-events: none; }
    .g-doodle .dd-paper.locked canvas { cursor: not-allowed; }
    .g-doodle .dd-paper.locked::after { content: ''; position: absolute; inset: 0; background: var(--g-halftone) 0 0 / 5px 5px; opacity: 0.22; pointer-events: none; }
    .g-doodle .dd-paper.gold, .g-doodle .dd-frame.gold { box-shadow: 0 0 0 4px var(--g-hl), var(--g-shadow); }

    /* the end: records strip, title badges, history */
    .g-doodle .dd-strip { width: 100%; display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; padding: 4px 0; }
    .g-doodle .dd-stamp2 { display: flex; flex-direction: column; align-items: center; padding: 6px 12px; border: 3px solid var(--g-ink); border-radius: 8px; background: var(--g-card); text-align: center; transform: rotate(-2deg); }
    .g-doodle .dd-stamp2:nth-child(even) { transform: rotate(1.5deg); }
    .g-doodle .dd-stamp2 b { font-family: var(--g-font-display); font-weight: 900; font-size: 0.85rem; letter-spacing: 0.04em; text-transform: uppercase; }
    .g-doodle .dd-stamp2 span { font-weight: 800; font-size: 0.72rem; color: var(--g-muted); }
    .g-doodle .dd-stamp2.s-best, .g-doodle .dd-stamp2.s-first, .g-doodle .dd-stamp2.s-gold { background: var(--g-hl); color: var(--g-on-ink); }
    .g-doodle .dd-stamp2.s-best span, .g-doodle .dd-stamp2.s-first span, .g-doodle .dd-stamp2.s-gold span { color: var(--g-on-ink); }
    .g-doodle .dd-badges { width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .g-doodle .dd-badge2 { display: flex; flex-direction: column; gap: 1px; padding: 8px 10px; border: 2px solid var(--g-ink); border-radius: 10px; min-width: 0; }
    .g-doodle .dd-badge2.p-a-b { background: var(--p-a-soft); } .g-doodle .dd-badge2.p-b-b { background: var(--p-b-soft); }
    .g-doodle .dd-badge2-who { font-weight: 900; font-size: 0.7rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--g-muted); }
    .g-doodle .dd-badge2 b { font-family: var(--g-font-display); font-weight: 900; font-size: 1rem; line-height: 1.15; }
    .g-doodle .dd-badge2 span:last-child { font-weight: 700; font-size: 0.78rem; overflow-wrap: anywhere; }
    .g-doodle .dd-history { margin: 0; text-align: center; font-weight: 800; }
    .g-doodle .dd-chase { margin: 0; text-align: center; color: var(--g-muted); font-weight: 700; font-size: 0.9rem; }
    .g-doodle .dd-frame-gold { position: absolute; z-index: 1; top: -10px; left: -6px; padding: 2px 8px; border: 2px solid var(--g-ink); border-radius: 6px; background: var(--g-hl); color: var(--g-on-ink); font-weight: 900; font-size: 0.66rem; letter-spacing: 0.08em; text-transform: uppercase; box-shadow: var(--g-shadow-sm); transform: rotate(-6deg); }
    .g-doodle .dd-pin { align-self: stretch; min-height: 48px; }

    /* Encore: the toggle on the setup screen, the pair in the gallery */
    .g-doodle .dd-toggle { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 6px 12px; text-align: left; color: var(--g-ink); background: var(--g-card); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow-sm); font-weight: 700; font-size: 0.8rem; touch-action: manipulation; }
    .g-doodle .dd-toggle b { font-family: var(--g-font-display); font-weight: 900; font-size: 0.9rem; margin-right: 4px; }
    .g-doodle .dd-toggle i { flex: none; position: relative; width: 38px; height: 22px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); }
    .g-doodle .dd-toggle i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--g-ink); }
    .g-doodle .dd-toggle[aria-checked="true"] i { background: var(--g-hl); }
    .g-doodle .dd-toggle[aria-checked="true"] i::after { left: 18px; background: var(--g-on-ink); }
    .g-doodle .dd-encore { width: 100%; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 10px 10px; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 6px; box-shadow: var(--g-shadow); }
    .g-doodle .dd-encore-title { font-family: var(--g-font-display); font-weight: 900; font-size: 1.1rem; text-align: center; overflow-wrap: anywhere; }
    .g-doodle .dd-encore-pair { width: 100%; display: flex; justify-content: center; gap: 14px; }
    .g-doodle .dd-encore-cell { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
    .g-doodle .dd-encore-pic canvas { display: block; border: 2px solid var(--g-line); border-radius: 3px; background: var(--g-card); }
    .g-doodle .dd-encpin { min-height: 44px; padding: 6px 10px; font-size: 0.8rem; }

    @keyframes dd-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(3px); } }
    @keyframes dd-pop { 0% { transform: scale(0.6); opacity: 0; } 70% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
    @keyframes dd-stamp { 0% { transform: translate(-50%, -50%) rotate(-9deg) scale(2.4); opacity: 0; } 100% { transform: translate(-50%, -50%) rotate(-9deg) scale(1); opacity: 1; } }
    @keyframes dd-scribble { 0% { stroke-dashoffset: 420; } 70%, 100% { stroke-dashoffset: 0; } }
    @keyframes dd-pencil { 0% { offset-distance: 0%; } 70%, 100% { offset-distance: 100%; } }
    @keyframes dd-blink { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
    @keyframes dd-rise { from { transform: translateY(14px); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .g-doodle *, .g-doodle *::before { animation: none !important; transition: none !important; }
      .g-doodle .dd-pencil-line { stroke-dashoffset: 0; }
      .g-doodle .dd-pencil-body { offset-distance: 100%; }
    }
  `;
