// Getaway: a two-player 3D car chase. One drives the runner, one the cop; roles swap every
// round. PIT them, spike them or box them in, or lose the heat and survive the clock. Live on two
// devices, or practice against an AI cop (split screen on a laptop). The game lives in
// js/games/getaway/; design notes in docs/games/getaway.md, the map contract in
// docs/games/getaway-maps.md.
import { registerGame } from './core.js';
import { createGame } from './getaway/game.js';
import { CSS } from './getaway/css.js';

registerGame({
  id: 'getaway',
  title: 'Getaway',
  blurb: 'One runs, one chases. PIT them, spike them, or lose the heat.',
  kind: 'live',
  modes: ['live', 'local'],
  platforms: ['phone', 'computer'],
  immersive: true,
  ownsPauseUI: true,
  team: false,
  localLabel: (dev) => (dev === 'phone' ? 'Practice vs AI' : 'Practice vs AI or split screen'),
  tags: ['silly', '3d'],
  minutes: 12,
  howTo: [
    'One of you is the runner, one the cop. Roles swap every round.',
    'Runner: survive the clock, or get far away and out of sight to lose the heat.',
    'Cop: hit their back corner to PIT them, drop spike strips from the map, box them in.',
    'Steer with your left thumb; gas, brake, drift and nitro on the right. Laptop: WASD.',
    'Live: both of you open Getaway and tap Play live. Alone? Practice vs AI.',
  ],
  css: CSS,
  endDelay: 0,
  mount(el, api) {
    const game = createGame(el, api);
    // onRematch: a rematch keeps the loaded map (no rebuild); onMenu: the app's ≡ sheet pauses the chase
    return { destroy() { game.destroy(); }, onRematch: () => game.onRematch(), onMenu: (open) => game.onMenu(open) };
  },
});
