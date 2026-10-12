// Double Agents v2 word packs. A themed board is 15 words from the pack plus 10 from the
// everyday NOUNS list, so a pack flavours the board without shrinking the pool of clues.
// (Classic is NOUNS exactly as v1 deals it.) Every pack word is a-z, 2-8 letters, and no word
// contains another. Pack words of 7+ letters need an entry in PACK_BREAKS (the card splits
// them onto two lines; the main BREAKS map in agents.js covers the words it already knows).
import { shuffled } from '../core.js';

const RAW = {
  us: `kiss hug date ring vow heart candle rose dinner movie couch pillow sunset letter photo song dance picnic beach
cabin coffee brunch waffle cookie bath garden porch window rain storm snow fire spark flame dream wish secret smile
laugh dimple note gift bow ribbon toast cake honey sugar cherry peach apple tea wine glass plate fork spoon map road
trip tram ticket key door home nest bed blanket sunrise hammock promise bouquet suitcase passport morning mixtape
slipper sweater`,
  travel: `island harbor ferry sail anchor tent trail summit canyon river bridge tunnel castle temple market bazaar cafe
bakery beacon desert dune oasis camel jungle fjord reef lagoon pier jetty taxi subway runway hostel plaza museum
statue mural camera coin stamp visa border spice noodle taco gelato mango palm sandal compass lantern vineyard
volcano glacier gondola scooter bicycle airport luggage balcony fountain gallery postcard souvenir journal customs
dumpling coconut sunburn`,
  mythic: `dragon siren kraken giant troll ogre elf dwarf fairy pixie wizard witch oracle hero knight squire quest sword
shield helmet armor crown throne potion spell curse charm rune scroll tome quill raven owl wolf stag lion eagle hydra
sphinx titan nymph muse comet moon star bolt storm cloud forest cave tower maze bridge gate key lamp genie carpet
mirror rose apple phoenix unicorn griffin mermaid prophet scepter crystal serpent minotaur pegasus centaur chimera
eclipse thunder feather`,
};

// Within a pack, a word that contains another pack word is dropped (spark / sparkle, elf / shelf).
function clean(text) {
  const all = [...new Set(text.trim().split(/\s+/))].filter((w) => /^[a-z]{2,8}$/.test(w));
  return all.filter((w) => !all.some((o) => o !== w && w.includes(o)));
}

export const PACKS = { us: clean(RAW.us), travel: clean(RAW.travel), mythic: clean(RAW.mythic) };

export const PACK_INFO = {
  classic: { name: 'Classic', blurb: 'Everyday nouns' },
  us: { name: 'Us', blurb: 'Date night' },
  travel: { name: 'Wanderlust', blurb: 'Ports and trails' },
  mythic: { name: 'Mythic', blurb: 'Dragons, quests' },
};
export const PACK_IDS = ['classic', 'us', 'travel', 'mythic'];

// Where a long pack word breaks on a narrow card (words already in agents.js BREAKS are not repeated).
export const PACK_BREAKS = new Map(`
sun-rise prom-ise morn-ing gon-dola lug-gage gal-lery sou-venir jour-nal cus-toms sun-burn grif-fin pro-phet
scep-ter ser-pent mino-taur pe-gasus cen-taur chi-mera ec-lipse
`.trim().split(/\s+/).map((x) => [x.replace('-', ''), x.split('-')]));

/** 25 board words for a themed deal: 15 from the pack, 10 everyday nouns, no word inside another. */
export function packWords(seed, pack, NOUNS) {
  const out = [];
  const fits = (w) => !out.some((o) => o.includes(w) || w.includes(o));
  for (const w of shuffled(PACKS[pack] || [], `${seed}:pack:${pack}`)) {
    if (out.length === 15) break;
    if (fits(w)) out.push(w);
  }
  for (const w of shuffled(NOUNS, `${seed}:words`)) {
    if (out.length === 25) break;
    if (fits(w)) out.push(w);
  }
  return shuffled(out, `${seed}:board`);
}
