// Blend & Seek — a two-player 3D hide-and-seek where you paint yourself to disappear.
// Entry point: the game lives in ./chameleon/ (see docs/games/chameleon.md).
import { registerGame } from './core.js';
import { CSS } from './chameleon/hud.js';
import { createGame } from './chameleon/game.js';

registerGame({
  id: 'chameleon',
  title: 'Blend & Seek',
  blurb: 'Paint yourself to vanish into the room. Then hunt.',
  kind: 'live',
  modes: ['live', 'local'],
  platforms: ['phone', 'computer'],
  team: false,
  immersive: true,
  tags: ['silly', '3d'],
  minutes: 12,
  howTo: [
    'Hider: find a spot (walls and ceilings too: Stick, crawl, hang), then paint yourself to match it.',
    'Pick drinks a colour from anything; Stamp copies the surface under you.',
    'Seeker: paint pellets, a chirp scan that makes their eyes glint, and look up!',
    'Every second you stay hidden scores. Roles swap each round. Settings change it all.',
  ],
  endDelay: 600,
  css: `${CSS}
.gm[data-game="chameleon"] { max-width: none; }
.gm[data-game="chameleon"] .gm-stage { min-height: 0; }
`,
  mount(el, api) {
    return createGame(el, api);
  },
});
