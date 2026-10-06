// Reference live game (unlisted in the hub): first to 20 taps wins.
// Shows both modes: one phone (split screen) and live online (host-authoritative).
import { registerGame } from './core.js';

const GOAL = 20;

registerGame({
  id: 'example-tap',
  title: 'Tap Race (example)',
  blurb: 'Reference implementation.',
  kind: 'live',
  unlisted: true,
  tags: ['silly'],
  howTo: ['Tap your half as fast as you can.', 'First to 20 wins.'],
  css: `
    .tap { display: grid; grid-template-rows: 1fr 1fr; gap: 6px; height: 100%; min-height: 60vh; }
    .tap.one { grid-template-rows: 1fr; }
    .tap button { border-radius: 16px; font-size: 2rem; font-weight: 900; color: #fff; touch-action: manipulation; }
    .tap .a { background: var(--p-a); } .tap .b { background: var(--p-b); }
    .tap .top { transform: rotate(180deg); }
  `,
  mount(el, api) {
    const counts = { a: 0, b: 0 };
    let over = false;
    const local = api.mode === 'local';
    // One phone: both halves. Online: just your own half.
    el.innerHTML = local
      ? '<div class="tap"><button class="b top" data-w="b"></button><button class="a" data-w="a"></button></div>'
      : `<div class="tap one"><button class="${api.me}" data-w="${api.me}"></button></div>`;
    const paint = () => {
      el.querySelectorAll('button').forEach((b) => { b.textContent = `${api.name(b.dataset.w)}: ${counts[b.dataset.w]}`; });
      api.setScore(counts);
    };
    const checkWin = () => {
      for (const w of ['a', 'b']) if (counts[w] >= GOAL && !over) { over = true; api.finish({ winner: w }); }
    };
    // The host owns the score. The guest reports taps; the host publishes absolute counts.
    const onTap = (w) => {
      if (over) return;
      api.sfx('tap');
      if (local || api.isHost) { counts[w]++; checkWin(); if (!local) api.setPresence({ counts }); paint(); }
      else api.send('tap', {});
    };
    el.addEventListener('pointerdown', (e) => { const b = e.target.closest('button'); if (b) onTap(b.dataset.w); });
    const offs = [];
    if (!local) {
      if (api.isHost) offs.push(api.on('tap', () => onTap('b')));
      else offs.push(api.onPartnerState((s) => { if (s && s.counts) { counts.a = s.counts.a; counts.b = s.counts.b; paint(); } }));
    }
    paint();
    return { destroy() { offs.forEach((f) => f()); } };
  },
});
