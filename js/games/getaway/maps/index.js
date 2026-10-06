// Getaway maps. Dockside is the lead's compact town (always playable; the fallback and the fast
// tests' map). Boulder and Santee come from the map designers; an entry with `stub: true` shows
// as "coming soon" in the picker. Contract: docs/games/getaway-maps.md.
import { DOCKSIDE } from './dockside.js';
import { BOULDER } from './boulder.js';
import { SANTEE } from './santee.js';

export const MAPS = [DOCKSIDE, BOULDER, SANTEE];
export const playable = () => MAPS.filter((m) => m && !m.stub);
