// Overlay cards for Blend & Seek: pure HTML builders (state in, markup out).
import { esc, fmtTime } from './util.js';
import { MAPS } from './maps.js';

const nameSpan = (api, w) => `<b class="chm-name-${w}">${esc(api.name(w))}</b>`;

export function loadingCard(text, pct) {
  return `<div class="chm-over solid"><div class="chm-card chm-sticker" role="status">
    <div class="chm-title"><span class="c1">Blend</span><span class="c2">&amp;</span><span class="c3">Seek</span></div>
    <div class="chm-drops" aria-hidden="true"><i></i><i></i><i></i></div>
    <p>${esc(text)}</p>
    <div class="chm-bar"><i style="width:${Math.round(pct * 100)}%"></i></div>
  </div></div>`;
}

export function errorCard(msg) {
  return `<div class="chm-over solid"><div class="chm-card chm-sticker" role="alert">
    <h2>Paint’s dried up</h2>
    <p>${esc(msg)}</p>
    <p>Check your connection, then close the game and open it again.</p>
  </div></div>`;
}

export function lobbyCard(api, { canEdit, local, setup, waitingFor }) {
  const mode = setup.mode; const map = setup.map; const first = setup.first;
  const dis = canEdit ? '' : 'aria-disabled="true"';
  return `<div class="chm-over chm-lobby bottom"><div class="chm-card chm-sticker" ${dis}>
    <div class="chm-title"><span class="c1">Blend</span><span class="c2">&amp;</span><span class="c3">Seek</span></div>
    <p>Paint yourself to vanish into the room. Then hunt.</p>
    <div class="chm-modes" role="radiogroup" aria-label="Mode">
      <button class="chm-mode ${mode === 'hs' ? 'on' : ''}" data-lobby="mode" data-v="hs" role="radio" aria-checked="${mode === 'hs'}"><b>Hide &amp; Seek</b><small>One hides, one hunts. 4 rounds, swap roles.</small></button>
      <button class="chm-mode ${mode === 'db' ? 'on' : ''}" data-lobby="mode" data-v="db" role="radio" aria-checked="${mode === 'db'}" ${local ? 'disabled' : ''}><b>Double Blind</b><small>${local ? 'Needs two phones.' : 'Both hide, then both hunt. Best of 3.'}</small></button>
    </div>
    <h3>Diorama</h3>
    <div class="chm-chips">${MAPS.map((m) => `<button class="chm-chip ${map === m.id ? 'on' : ''}" data-lobby="map" data-v="${m.id}">${esc(m.name)}</button>`).join('')}</div>
    ${mode === 'hs' ? `<h3>Hides first</h3><div class="chm-chips">${['a', 'b'].map((w) => `<button class="chm-chip p${w} ${first === w ? 'on' : ''}" data-lobby="first" data-v="${w}"><i></i>${esc(api.name(w))}</button>`).join('')}</div>` : ''}
    ${canEdit ? '<button class="chm-go me" data-act="start">Start</button>' : `<p class="chm-wait">${nameSpan(api, waitingFor)} is setting up…</p>`}
  </div></div>`;
}

export function titleCard(api, { round, rounds, mode, hider, youHide, youSeek, map }) {
  const m = MAPS.find((x) => x.id === map);
  const line = mode === 'db'
    ? 'Both of you hide. Then hunt each other — slowly.'
    : `${nameSpan(api, hider)} hides · ${nameSpan(api, api.other(hider))} seeks`;
  const you = mode === 'db' ? 'Paint fast, pose, and don’t blink.' : youHide ? 'You hide. Find a spot, pose, then paint yourself to match.' : youSeek ? 'You seek. Eyes shut while they hide…' : '';
  return `<div class="chm-over dim"><div class="chm-card chm-sticker">
    <div class="chm-kicker">Round ${round} of ${rounds} · ${esc(m ? m.name : '')}</div>
    <h2>${mode === 'db' ? 'Double Blind' : 'Hide &amp; Seek'}</h2>
    <p>${line}</p>
    ${you ? `<p>${you}</p>` : ''}
  </div></div>`;
}

export function blindCard(api, { hider, ms, pellets, mode }) {
  return `<div class="chm-over chm-blind solid"><div class="chm-card chm-sticker">
    <div class="chm-kicker">Eyes shut</div>
    <div class="chm-big" data-live="blind-time">${fmtTime(ms)}</div>
    <div class="chm-drops" aria-hidden="true"><i></i><i></i><i></i></div>
    <p>${nameSpan(api, hider)} is painting themselves to match the room.</p>
    <p>You get <b>${pellets} paint pellets</b> and a <b>chirp scan</b> every 30 s that makes their eyes glint.${mode === 'hs' ? ' Every second they survive scores for them.' : ''}</p>
  </div></div>`;
}

export function curtainCard(api, { kind, who }) {
  const other = api.other(who);
  const kicker = kind === 'hide' ? `${esc(api.name(other))}, look away` : 'Hider, hand it over';
  const body = kind === 'hide'
    ? `Pass the phone to ${nameSpan(api, who)}. ${nameSpan(api, other)}, no peeking — they’re about to hide.`
    : `${nameSpan(api, other)} is hidden. Pass the phone to ${nameSpan(api, who)} to start the hunt.`;
  const btn = kind === 'hide' ? `I’m ${esc(api.name(who))} — let me hide` : `I’m ${esc(api.name(who))} — start the hunt`;
  return `<div class="chm-over solid" data-curtain="${kind}"><div class="chm-card chm-sticker">
    <div class="chm-kicker">${kicker}</div>
    <h2 class="chm-name-${who}">${esc(api.name(who))}</h2>
    <p>${body}</p>
    <button class="chm-go" data-act="curtain">${btn}</button>
  </div></div>`;
}

export function recapCard(api, { rec, mode, scores, round, rounds, isLast, canNext, stats }) {
  const hider = rec.hider;
  let head; let sub;
  if (mode === 'db') {
    if (rec.winner) { head = `${esc(api.name(rec.winner))} wins the round`; sub = `${esc(api.name(api.other(rec.winner)))} was RIGHT there.`; }
    else { head = 'Nobody found anybody'; sub = 'A void round. Sneaky.'; }
  } else if (rec.found) { head = `${esc(api.name(hider))} was RIGHT there`; sub = `Found after ${fmtTime(rec.ms)} · +${rec.points} for ${esc(api.name(hider))}`; }
  else { head = `${esc(api.name(hider))} survived!`; sub = `+${rec.points} points${rec.outOfPellets ? ' · the seeker ran dry' : ''}`; }
  return `<div class="chm-over chm-recap bottom"><div class="chm-card chm-sticker">
    <div class="chm-kicker">Round ${round} of ${rounds}</div>
    <h2>${head}</h2>
    <p>${sub}</p>
    <div class="chm-stats">
      <div><b>${stats.closest == null ? '—' : stats.closest.toFixed(1) + ' m'}</b><span>Closest call</span></div>
      <div><b>${stats.passes}</b><span>Walk-pasts</span></div>
      <div><b>${stats.used}/${stats.max}</b><span>Pellets</span></div>
    </div>
    <div class="chm-tally"><span><i style="background:var(--p-a)"></i>${esc(api.name('a'))} ${scores.a}</span><span><i style="background:var(--p-b)"></i>${esc(api.name('b'))} ${scores.b}</span></div>
    ${canNext ? `<button class="chm-go me" data-act="next">${isLast ? 'See who won' : 'Next round'}</button>` : '<p class="chm-wait">Next round starts in a moment…</p>'}
    <p style="font-size:.75rem" data-live="recap-time"></p>
  </div></div>`;
}

export function pauseCard(api, { reason, countdown }) {
  const r = reason === 'away' ? `Waiting for ${esc(api.name(api.other(api.me || 'a')))}…`
    : reason === 'hidden' ? 'Paused while the game was in the background.'
      : reason === 'stall' ? 'Connection hiccup — hang on…'
        : reason === 'ctx' ? 'The graphics took a nap.'
          : 'Paused';
  return `<div class="chm-over dim"><div class="chm-card chm-sticker" role="status">
    <div class="chm-kicker">Paused</div>
    ${countdown ? `<div class="chm-big" data-live="resume-count">3</div><p>Back in…</p>` : `<p>${r}</p>`}
  </div></div>`;
}

export function ctxCard() {
  return `<div class="chm-over dim"><div class="chm-card chm-sticker" role="status">
    <div class="chm-kicker">Paused</div>
    <h2>Tap to resume</h2>
    <p>The graphics needed a quick reset.</p>
    <button class="chm-go" data-act="ctxresume">Resume</button>
  </div></div>`;
}
