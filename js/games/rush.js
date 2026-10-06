// Rail Rush: a three-lane runner for two on the same seeded track. Race (with weapons), Brawl
// (shove each other) or Together (shared hearts, revives). Live on two phones, or split screen on
// one computer. The game lives in js/games/rush/; design notes in docs/games/rush.md.
import { registerGame } from './core.js';
import { createGame } from './rush/game.js';
import { CSS } from './rush/css.js';

registerGame({
  id: 'rush',
  title: 'Rail Rush',
  blurb: 'Same track, same moment. Race, shove or save each other.',
  kind: 'live',
  modes: ['live', 'local'],
  platforms: ['phone', 'computer'],
  best: 'phone',
  immersive: true,
  team: false,
  tags: ['silly', '3d'],
  minutes: 3,
  howTo: [
    'Swipe left or right to switch lanes, up to jump, down to roll.',
    'Race: first to 2 km wins. Grab boxes to ink, block or zap each other.',
    'Brawl: switch into their lane side by side to shove them. Jump to dodge.',
    'Together: share hearts, and grab the glowing heart to revive your partner.',
  ],
  css: CSS,
  endDelay: 0,
  mount(el, api) {
    const game = createGame(el, api);
    return { destroy() { game.destroy(); } };
  },
});
