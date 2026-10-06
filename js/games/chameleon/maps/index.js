// Extra (bigger) maps for Blend & Seek. Owned by the level designer; see the format notes at the
// top of ../maps.js. Each entry: { id, name, blurb, build(atlas, kit) => (b) => void, size, rooms,
// climbs, info }.
import { HOUSE } from './house.js';
import { MARKET } from './market.js';
import { CUBOULDER } from './cuboulder.js';
import { GREENHOUSE } from './greenhouse.js';
import { MUSEUM } from './museum.js';

export const EXTRA_MAPS = [HOUSE, MARKET, CUBOULDER, GREENHOUSE, MUSEUM];
