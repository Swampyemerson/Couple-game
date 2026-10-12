// Same Wave styles. Every selector sits under .g-wave. Tokens only, no hard-coded colours.
export const CSS = `
    .g-wave { position: absolute; inset: 0; color: var(--g-ink); -webkit-user-select: none; user-select: none; }
    .g-wave .wv-scroll { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
    .g-wave .wv-scr { width: 100%; max-width: 540px; min-height: 100%; margin: 0 auto; padding: 2px 2px calc(10px + var(--kb, 0px)); display: flex; flex-direction: column; align-items: center; gap: 10px; }
    /* a round: head, dial (takes what is left), foot. The dial is sized in JS from the room it gets. */
    .g-wave .wv-scr.dialscr { height: 100%; min-height: 330px; gap: 8px; }
    .g-wave .wv-head, .g-wave .wv-foot { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 8px; flex: none; }
    .g-wave .wv-main { flex: 1 1 0; min-height: 150px; width: 100%; display: flex; align-items: center; justify-content: center; }
    .g-wave .wv-foot { position: sticky; bottom: 0; z-index: 3; padding-top: 4px; background: var(--g-bg); }
    .g-wave .wv-top { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 34px; }
    .g-wave .wv-round { font-family: var(--g-font-display); font-weight: 900; font-size: 0.9rem; letter-spacing: 0.02em; text-transform: uppercase; white-space: nowrap; }
    .g-wave .wv-round i { font-style: normal; color: var(--g-muted); }
    .g-wave .wv-team { display: inline-flex; align-items: baseline; gap: 5px; padding: 3px 11px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); font-weight: 800; font-size: 0.85rem; box-shadow: var(--g-shadow-sm); white-space: nowrap; }
    .g-wave .wv-team b { font-family: var(--g-font-display); font-size: 1.05rem; font-variant-numeric: tabular-nums; }
    .g-wave .wv-team.bump b { animation: wv-bump 0.4s ease both; }
    .g-wave .wv-tw { flex: 1 1 auto; min-width: 0; text-align: center; }
    .g-wave .wv-tw span { display: inline-block; max-width: 100%; padding: 3px 10px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-hl); color: var(--g-on-ink); font-weight: 900; font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
    .g-wave .wv-tw span.dv { background: var(--g-ink); color: var(--g-bg); }
    .g-wave .wv-dvb { display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 800; font-size: 0.76rem; color: var(--g-muted); }
    .g-wave .wv-dvb span { padding: 1px 9px; border-radius: 999px; background: var(--g-ink); color: var(--g-bg); font-weight: 900; font-size: 0.68rem; letter-spacing: 0.06em; text-transform: uppercase; }
    .g-wave .wv-rule { margin: 0; max-width: 34em; text-align: center; color: var(--g-muted); font-weight: 800; font-size: 0.8rem; line-height: 1.3; }
    .g-wave .wv-rule b { color: var(--g-ink); font-weight: 900; }
    .g-wave .wv-h { font-family: var(--g-font-display); font-weight: 900; font-size: 1.25rem; line-height: 1.15; margin: 0; text-align: center; }
    .g-wave .wv-sub { margin: -2px 0 0; color: var(--g-muted); font-weight: 700; text-align: center; font-size: 0.9rem; }
    .g-wave .p-a { color: var(--p-a-text, var(--p-a)); } .g-wave .p-b { color: var(--p-b-text, var(--p-b)); }
    .g-wave b.p-a, .g-wave b.p-b { font-weight: 900; }

    /* the dial */
    .g-wave .wv-dialbox { width: 300px; max-width: 100%; display: flex; flex-direction: column; align-items: stretch; flex: none; }
    .g-wave .wv-dial { position: relative; width: var(--dw, 100%); margin: 0 auto; touch-action: none; outline: none; border-radius: 12px; }
    .g-wave .wv-dial.live { cursor: grab; }
    .g-wave .wv-dial.live.drag { cursor: grabbing; }
    .g-wave .wv-dial:focus-visible { box-shadow: 0 0 0 3px var(--g-hl); }
    .g-wave .wv-svg { display: block; width: 100%; height: auto; overflow: visible; }
    .g-wave .wv-shadow, .g-wave .wv-plinth-shadow { fill: var(--g-edge, var(--g-ink)); }
    .g-wave .wv-face { fill: var(--g-card); }
    .g-wave .wv-rim { fill: none; stroke: var(--g-ink); stroke-width: 2.5; stroke-linejoin: round; }
    .g-wave .wv-tick { stroke: var(--g-ink); stroke-width: 1.6; stroke-linecap: round; }
    .g-wave .wv-tick.major { stroke-width: 2.6; }
    .g-wave .wv-zb4, .g-wave .wv-hlfill { fill: var(--g-hl); }
    .g-wave .wv-hlsoft { fill: var(--g-hl-soft, var(--g-card)); }
    .g-wave .wv-zone path { stroke: var(--g-ink); stroke-width: 1.5; stroke-linejoin: round; }
    .g-wave .wv-zlabels text { font-family: var(--g-font-display); font-weight: 900; font-size: 13px; fill: var(--g-on-ink); stroke: var(--g-white, var(--g-card)); stroke-width: 3.5px; paint-order: stroke; stroke-linejoin: round; text-anchor: middle; dominant-baseline: central; }
    .g-wave .wv-lid-face { fill: var(--g-card); }
    .g-wave .wv-hatch { stroke: var(--g-line); stroke-width: 2.4; }
    .g-wave .wv-needle { stroke: var(--g-ink); stroke-width: 2.4; stroke-linejoin: round; }
    .g-wave .wv-needle.a { fill: var(--p-a); } .g-wave .wv-needle.b { fill: var(--p-b); }
    .g-wave .wv-needle.jp { fill: var(--g-white, var(--g-card)); stroke-width: 3; }
    .g-wave .wv-needle-shadow { fill: var(--g-edge, var(--g-ink)); }
    .g-wave .wv-hub { fill: var(--g-ink); }
    .g-wave .wv-hub-dot { fill: var(--g-card); }
    .g-wave .wv-plinth { fill: var(--g-ink); }
    .g-wave .wv-ghost { fill: none; stroke: var(--g-muted); stroke-width: 2; stroke-dasharray: 4 4; }
    .g-wave .wv-dial.jp .wv-rim { stroke-width: 4; }

    /* spectrum card */
    .g-wave .wv-card { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); margin: -6px 6px 0; border: 2px solid var(--g-ink); border-radius: 10px; overflow: hidden; box-shadow: var(--g-shadow); }
    .g-wave .wv-end { display: flex; align-items: center; gap: 4px; min-height: 46px; padding: 6px 8px; font-family: var(--g-font-display); font-weight: 900; font-size: 0.98rem; line-height: 1.12; }
    .g-wave .wv-end.l { background: var(--g-card); color: var(--g-ink); }
    .g-wave .wv-end.r { background: var(--g-ink); color: var(--g-card); justify-content: flex-end; text-align: right; }
    .g-wave .wv-end svg { width: 14px; height: 14px; flex: none; }
    .g-wave .wv-end span { min-width: 0; overflow-wrap: break-word; hyphens: auto; }
    .g-wave .wv-end.fm { font-size: 0.88rem; } .g-wave .wv-end.fs { font-size: 0.8rem; } .g-wave .wv-end.fxs { font-size: 0.72rem; }

    /* clue */
    .g-wave .wv-clue { position: relative; max-width: 100%; display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 6px 16px 8px; border: 2px solid var(--g-ink); border-radius: 14px; background: var(--g-card); box-shadow: var(--g-shadow-sm); text-align: center; margin-bottom: 8px; }
    .g-wave .wv-clue::after { content: ''; position: absolute; left: 50%; bottom: -9px; width: 14px; height: 14px; background: var(--g-card); border-right: 2px solid var(--g-ink); border-bottom: 2px solid var(--g-ink); transform: translateX(-50%) rotate(45deg); }
    .g-wave .wv-clue small { font-weight: 800; font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--g-muted); }
    .g-wave .wv-clue b { font-family: var(--g-font-display); font-weight: 900; font-size: 1.3rem; line-height: 1.15; overflow-wrap: anywhere; }
    .g-wave .wv-clue.anim { animation: wv-pop 0.35s ease both; }
    .g-wave .wv-bundle { margin-bottom: 4px; }
    .g-wave .wv-form { width: 100%; display: flex; gap: 8px; }
    .g-wave .wv-field { position: relative; flex: 1; min-width: 0; }
    .g-wave .wv-input { width: 100%; height: 52px; padding: 0 58px 0 14px; font: inherit; font-size: 17px; font-weight: 800; color: var(--g-ink); background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 12px; outline: none; -webkit-user-select: text; user-select: text; }
    .g-wave .wv-input:focus-visible { box-shadow: 0 0 0 3px var(--g-hl); }
    .g-wave .wv-count { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 0.7rem; font-weight: 800; color: var(--g-muted); font-variant-numeric: tabular-nums; pointer-events: none; }
    .g-wave .wv-form .gm-btn { min-width: 84px; min-height: 52px; }
    .g-wave .gm-btn:disabled { opacity: 0.4; }
    .g-wave .wv-go { width: 100%; min-height: 52px; font-size: 1.05rem; }
    .g-wave .wv-note { margin: 0; color: var(--g-muted); font-weight: 700; text-align: center; font-size: 0.85rem; }
    .g-wave .wv-note.warn { color: var(--g-bad); }
    .g-wave .wv-secret { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border: 2px dashed var(--g-ink); border-radius: 999px; font-size: 0.74rem; font-weight: 800; text-align: center; }

    /* Giver's Bet picker, Double Down toggle */
    .g-wave .wv-wager { width: 100%; display: flex; flex-direction: column; gap: 4px; }
    .g-wave .wv-wager > span { font-weight: 800; font-size: 0.74rem; color: var(--g-muted); text-align: center; }
    .g-wave .wv-wgs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .g-wave .wv-wg { min-height: 46px; padding: 3px 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 2px solid var(--g-ink); border-radius: 10px; background: var(--g-card); color: var(--g-ink); font: inherit; font-weight: 900; font-size: 0.82rem; line-height: 1.1; touch-action: manipulation; box-shadow: var(--g-shadow-sm); }
    .g-wave .wv-wg small { font-weight: 700; font-size: 0.66rem; color: var(--g-muted); }
    .g-wave .wv-wg[aria-pressed="true"] { background: var(--g-hl); color: var(--g-on-ink); transform: translate(2px, 2px); box-shadow: none; }
    .g-wave .wv-wg[aria-pressed="true"] small { color: var(--g-on-ink); }
    .g-wave .wv-wg:focus-visible, .g-wave .wv-sure:focus-visible, .g-wave .wv-mode:focus-visible, .g-wave .wv-pack:focus-visible { outline: 3px solid var(--p-a); outline-offset: 2px; }
    .g-wave .wv-actions { width: 100%; display: flex; gap: 8px; align-items: stretch; }
    .g-wave .wv-actions .gm-btn { flex: 1; min-height: 52px; }
    .g-wave .wv-sure { flex: none; min-width: 112px; min-height: 52px; padding: 2px 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 2px solid var(--g-ink); border-radius: 12px; background: var(--g-card); color: var(--g-ink); font: inherit; font-weight: 900; font-size: 0.95rem; line-height: 1.1; touch-action: manipulation; box-shadow: var(--g-shadow-sm); }
    .g-wave .wv-sure small { font-weight: 700; font-size: 0.64rem; color: var(--g-muted); }
    .g-wave .wv-sure[aria-pressed="true"] { background: var(--g-hl); color: var(--g-on-ink); transform: translate(2px, 2px); box-shadow: none; }
    .g-wave .wv-sure[aria-pressed="true"] small { color: var(--g-on-ink); }
    .g-wave .wv-mybet { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); font-weight: 800; font-size: 0.78rem; }

    /* reveal */
    .g-wave .wv-result { width: 100%; display: flex; align-items: center; justify-content: center; gap: 12px; }
    .g-wave .wv-pts { flex: none; display: grid; place-items: center; min-width: 62px; height: 52px; padding: 0 10px; border: 2px solid var(--g-ink); border-radius: 10px; background: var(--g-hl); color: var(--g-on-ink); box-shadow: var(--g-shadow); font-family: var(--g-font-display); font-weight: 900; font-size: 1.7rem; transform: rotate(-4deg); font-variant-numeric: tabular-nums; }
    .g-wave .wv-pts.zero { background: var(--g-card); color: var(--g-bad); }
    .g-wave .wv-pts.jp { outline: 3px dashed var(--g-ink); outline-offset: 3px; }
    .g-wave .wv-result-txt { display: flex; flex-direction: column; font-weight: 800; min-width: 0; }
    .g-wave .wv-result-txt > b { font-family: var(--g-font-display); font-size: 1.2rem; font-weight: 900; line-height: 1.15; }
    .g-wave .wv-result-txt > span { color: var(--g-muted); font-size: 0.82rem; }
    .g-wave .wv-near { font-style: normal; font-weight: 900; font-size: 0.82rem; color: var(--g-ink); }
    .g-wave .wv-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
    .g-wave .wv-chip { padding: 1px 8px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-hl); color: var(--g-on-ink); font-weight: 900; font-size: 0.7rem; letter-spacing: 0.03em; }
    .g-wave .wv-chip.jp { background: var(--g-ink); color: var(--g-hl); }
    .g-wave .wv-result.hide { visibility: hidden; }
    .g-wave .wv-result.anim .wv-pts { animation: wv-stamp 0.4s cubic-bezier(.2,1.6,.4,1) both; }
    .g-wave .wv-wait { display: flex; align-items: center; gap: 10px; font-weight: 800; color: var(--g-muted); text-align: center; }
    .g-wave .wv-dots { display: inline-flex; gap: 4px; }
    .g-wave .wv-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--g-muted); animation: wv-blink 1.2s infinite; }
    .g-wave .wv-dots i:nth-child(2) { animation-delay: 0.2s; } .g-wave .wv-dots i:nth-child(3) { animation-delay: 0.4s; }
    .g-wave .wv-last { width: 100%; display: flex; align-items: center; gap: 10px; padding: 6px 10px; border: 2px solid var(--g-line); border-radius: 10px; font-size: 0.85rem; font-weight: 700; color: var(--g-muted); }
    .g-wave .wv-last b { color: var(--g-ink); }

    /* setup */
    .g-wave .wv-scr.flow { gap: 10px; padding-bottom: 0; }
    .g-wave .wv-modes { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .g-wave .wv-mode { min-height: 48px; padding: 4px 6px; display: flex; align-items: center; justify-content: center; text-align: center; border: 2px solid var(--g-ink); border-radius: 12px; background: var(--g-card); color: var(--g-ink); font: inherit; touch-action: manipulation; box-shadow: var(--g-shadow-sm); }
    .g-wave .wv-mode b { font-family: var(--g-font-display); font-weight: 900; font-size: 0.86rem; line-height: 1.12; }
    .g-wave .wv-mode[aria-checked="true"] { background: var(--g-hl); color: var(--g-on-ink); transform: translate(2px, 2px); box-shadow: none; }
    .g-wave .wv-pitch { width: 100%; min-height: 2.6em; margin: 0; text-align: center; font-weight: 800; font-size: 0.84rem; line-height: 1.3; }
    .g-wave .wv-lab { align-self: flex-start; margin: 2px 0 -4px; font-weight: 900; font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--g-muted); }
    .g-wave .wv-packs { width: 100%; display: flex; flex-wrap: wrap; gap: 6px; }
    .g-wave .wv-pack { min-height: 44px; padding: 0 12px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); color: var(--g-ink); font: inherit; font-weight: 800; font-size: 0.88rem; touch-action: manipulation; }
    .g-wave .wv-pack[aria-checked="true"] { background: var(--g-ink); color: var(--g-bg); }
    .g-wave .wv-sticky { position: sticky; bottom: 0; z-index: 3; width: 100%; margin-top: auto; padding: 6px 0 10px; background: var(--g-bg); }
    .g-wave .wv-start { width: 100%; min-height: 54px; font-size: 1rem; }
    .g-wave .wv-keep { width: 100%; display: flex; align-items: center; gap: 10px; padding: 6px 10px; border: 2px dashed var(--g-line); border-radius: 10px; font-size: 0.8rem; font-weight: 700; color: var(--g-muted); }

    /* recap */
    .g-wave .wv-rhead { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .g-wave .wv-kicker { font-weight: 900; font-size: 0.75rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); }
    .g-wave .wv-plaque { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border: 2px solid var(--g-ink); border-radius: 10px; background: var(--g-hl); color: var(--g-on-ink); box-shadow: var(--g-shadow); }
    .g-wave .wv-plaque b { font-family: var(--g-font-display); font-size: 2rem; font-weight: 900; line-height: 1; }
    .g-wave .wv-plaque b small { font-size: 1rem; }
    .g-wave .wv-plaque span { font-family: var(--g-font-display); font-weight: 900; font-size: 1.1rem; line-height: 1.1; max-width: 11em; }
    .g-wave .wv-meter { width: 100%; max-width: 360px; display: grid; grid-template-columns: repeat(var(--n, 32), 1fr); gap: 2px; }
    .g-wave .wv-meter i { height: 10px; border: 1.5px solid var(--g-ink); border-radius: 2px; background: var(--g-card); }
    .g-wave .wv-meter i.on { background: var(--g-ink); }
    .g-wave .wv-stamps { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
    .g-wave .wv-stamp { display: flex; flex-direction: column; align-items: center; padding: 4px 12px; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-ink); color: var(--g-hl); transform: rotate(-3deg); box-shadow: var(--g-shadow-sm); line-height: 1.1; }
    .g-wave .wv-stamp:nth-child(2n) { transform: rotate(2.5deg); }
    .g-wave .wv-stamp b { font-family: var(--g-font-display); font-weight: 900; font-size: 0.95rem; letter-spacing: 0.04em; }
    .g-wave .wv-stamp small { font-weight: 800; font-size: 0.68rem; color: var(--g-bg); }
    .g-wave .wv-medals { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .g-wave .wv-medal { display: flex; flex-direction: column; gap: 1px; padding: 8px 10px; border: 2px solid var(--g-ink); border-radius: 12px; box-shadow: var(--g-shadow-sm); min-width: 0; }
    .g-wave .wv-medal.a { background: var(--p-a-soft); } .g-wave .wv-medal.b { background: var(--p-b-soft); }
    .g-wave .wv-medal small { font-weight: 900; font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; }
    .g-wave .wv-medal b { font-family: var(--g-font-display); font-weight: 900; font-size: 1rem; line-height: 1.15; }
    .g-wave .wv-medal span { font-weight: 700; font-size: 0.76rem; color: var(--g-muted); }
    .g-wave .wv-recs { width: 100%; display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; border: 2px solid var(--g-line); border-radius: 12px; }
    .g-wave .wv-recs p { margin: 0; font-weight: 700; font-size: 0.84rem; line-height: 1.35; }
    .g-wave .wv-recs p b { font-weight: 900; }
    .g-wave .wv-recs p.dim { color: var(--g-muted); }
    .g-wave .wv-rows { width: 100%; display: flex; flex-direction: column; gap: 10px; }
    .g-wave .wv-row { display: grid; grid-template-columns: 1fr auto; gap: 6px 10px; align-items: center; padding: 10px 12px; border: 2px solid var(--g-ink); border-radius: 12px; background: var(--g-card); box-shadow: var(--g-shadow); }
    .g-wave .wv-row.jp { outline: 3px dashed var(--g-ink); outline-offset: 2px; }
    .g-wave .wv-row.anim { animation: wv-rise 0.3s ease both; }
    .g-wave .wv-row-card { font-weight: 800; font-size: 0.82rem; color: var(--g-muted); }
    .g-wave .wv-row-clue { font-family: var(--g-font-display); font-weight: 900; font-size: 1.05rem; line-height: 1.15; overflow-wrap: anywhere; }
    .g-wave .wv-row-clue small { font-family: var(--g-font-body); font-weight: 800; font-size: 0.78rem; }
    .g-wave .wv-row .wv-mini { grid-column: 1 / -1; }
    .g-wave .wv-row-pts { grid-row: 1 / span 2; grid-column: 2; display: grid; place-items: center; min-width: 46px; height: 40px; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-hl); color: var(--g-on-ink); font-family: var(--g-font-display); font-weight: 900; font-size: 1.2rem; }
    .g-wave .wv-row-pts.zero { background: var(--g-card); color: var(--g-muted); border-color: var(--g-line); }
    .g-wave .wv-row-meta { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-weight: 800; font-size: 0.74rem; color: var(--g-muted); }
    .g-wave .wv-mini { position: relative; height: 16px; margin: 4px 0 6px; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-bg); }
    .g-wave .wv-mini > span { position: absolute; top: 0; bottom: 0; }
    .g-wave .wv-mini .z2 { background: repeating-linear-gradient(-55deg, var(--g-hl) 0 2.5px, var(--g-hl-soft, var(--g-card)) 2.5px 7px); }
    .g-wave .wv-mini .z3 { background: repeating-linear-gradient(-55deg, var(--g-hl) 0 5px, var(--g-hl-soft, var(--g-card)) 5px 7px); }
    .g-wave .wv-mini .z4 { box-shadow: inset 2px 0 0 var(--g-ink), inset -2px 0 0 var(--g-ink); background: var(--g-hl); }
    .g-wave .wv-mini .tick { top: -7px; bottom: -7px; width: 0; margin-left: -1px; border-left: 2px solid var(--g-ink); }
    .g-wave .wv-mini .tick::before { content: ''; position: absolute; left: -5px; top: -3px; width: 8px; height: 8px; background: var(--g-ink); border-radius: 50%; }
    .g-wave .wv-mini .pin { top: -6px; bottom: -6px; width: 6px; margin-left: -3px; border: 2px solid var(--g-ink); border-radius: 3px; }
    .g-wave .wv-mini .pin.a { background: var(--p-a); } .g-wave .wv-mini .pin.b { background: var(--p-b); }
    .g-wave .wv-actions.end { padding-bottom: 6px; }

    /* short phones (iPhone SE size, or the keyboard up): everything tightens, the dial gives way */
    @media (max-height: 700px) {
      .g-wave .wv-scr.dialscr { gap: 6px; }
      .g-wave .wv-sub, .g-wave .wv-last, .g-wave .wv-note.opt { display: none; }
      .g-wave .wv-clue b { font-size: 1.15rem; }
      .g-wave .wv-clue { padding: 4px 14px 6px; }
    }
    @media (max-height: 620px) {
      .g-wave .wv-rule { display: none; }
      .g-wave .wv-clue small { display: none; }
      .g-wave .wv-clue { padding: 3px 12px 5px; margin-bottom: 7px; }
      .g-wave .wv-clue b { font-size: 1.02rem; }
      .g-wave .wv-pts { height: 44px; min-width: 54px; font-size: 1.4rem; }
      .g-wave .wv-result-txt > b { font-size: 1rem; }
      .g-wave .wv-actions .gm-btn, .g-wave .wv-go { min-height: 48px; }
      .g-wave .wv-main { min-height: 120px; }
      .g-wave .wv-scr.flow { gap: 6px; }
      .g-wave .wv-seth, .g-wave .wv-lab { display: none; }
      .g-wave .wv-mode { min-height: 44px; }
      .g-wave .wv-sticky { padding: 4px 0 6px; }
      .g-wave .wv-start { min-height: 48px; }
      .g-wave .wv-pitch { font-size: 0.8rem; }
      .g-wave .wv-packnote { font-size: 0.78rem; margin-top: -2px; }
    }
    /* wide and short (landscape): the dial on the left, everything else on the right */
    @media (orientation: landscape) and (min-width: 600px) {
      .g-wave .wv-scr.dialscr { max-width: 1000px; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; grid-template-areas: 'main head' 'main foot'; column-gap: 16px; align-items: stretch; }
      .g-wave .wv-head { grid-area: head; justify-content: flex-start; align-self: start; }
      .g-wave .wv-main { grid-area: main; min-height: 0; }
      .g-wave .wv-foot { grid-area: foot; position: static; padding-top: 0; background: none; align-self: end; }
      .g-wave .wv-sub, .g-wave .wv-last, .g-wave .wv-rule { display: none; }
      .g-wave .wv-scr.dialscr { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 4px 16px; }
      .g-wave .wv-head, .g-wave .wv-foot { gap: 4px; }
      .g-wave .wv-top { min-height: 30px; gap: 6px; }
      .g-wave .wv-round { font-size: 0.8rem; }
      .g-wave .wv-tw span { font-size: 0.66rem; padding: 2px 8px; }
      .g-wave .wv-team { padding: 2px 9px; font-size: 0.78rem; }
      .g-wave .wv-pts { height: 40px; min-width: 50px; font-size: 1.2rem; }
      .g-wave .wv-result { gap: 8px; }
      .g-wave .wv-result-txt > b { font-size: 0.92rem; }
      .g-wave .wv-result-txt > span, .g-wave .wv-near { font-size: 0.74rem; }
      .g-wave .wv-chips { margin-top: 1px; }
      .g-wave .wv-chip { font-size: 0.62rem; padding: 0 6px; }
      .g-wave .wv-actions .gm-btn, .g-wave .wv-go, .g-wave .wv-form .gm-btn, .g-wave .wv-input { min-height: 46px; height: auto; }
      .g-wave .wv-input { height: 46px; }
      .g-wave .wv-clue { margin-bottom: 6px; }
      .g-wave .wv-modes { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
      .g-wave .wv-scr.flow > .wv-seth, .g-wave .wv-lab { display: none; }
      .g-wave .wv-scr.flow { gap: 6px; max-width: 860px; }
      .g-wave .wv-mode { min-height: 44px; }
      .g-wave .wv-packs { gap: 4px; }
      .g-wave .wv-pack { padding: 0 8px; font-size: 0.8rem; }
      .g-wave .wv-pitch { min-height: 0; }
      .g-wave .wv-sticky { padding: 4px 0 6px; }
      .g-wave .wv-start { min-height: 46px; }
    }

    @keyframes wv-pop { 0% { transform: scale(0.7); opacity: 0; } 70% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); } }
    @keyframes wv-stamp { 0% { transform: rotate(-4deg) scale(2.2); opacity: 0; } 100% { transform: rotate(-4deg) scale(1); opacity: 1; } }
    @keyframes wv-bump { 0% { transform: scale(1); } 40% { transform: scale(1.5); } 100% { transform: scale(1); } }
    @keyframes wv-blink { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
    @keyframes wv-rise { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .g-wave *, .g-wave *::after { animation: none !important; transition: none !important; }
    }
`;
