// Double Agents v2 clue checker. A clue is refused when it is the same word as a board word in
// disguise: a plural or singular (cactus/cacti, wolf/wolves), a spelling or name variant
// (donut/doughnut), or a long enough word that plainly contains / is contained by one.
// Short fragments (AT, SEA, EAR) are fine. v1 matches keep their old checker in agents.js.

// Irregular plural -> singular. (Regular -s / -es / -ies / -ves are handled by rule.)
const IRREG = {
  cacti: 'cactus', octopi: 'octopus', octopuses: 'octopus', children: 'child', feet: 'foot', teeth: 'tooth',
  men: 'man', women: 'woman', people: 'person', oxen: 'ox', leaves: 'leaf', fungi: 'fungus', mice: 'mouse',
  geese: 'goose', dice: 'die', wolves: 'wolf', knives: 'knife', lives: 'life', wives: 'wife', loaves: 'loaf',
  shelves: 'shelf', thieves: 'thief', halves: 'half', calves: 'calf', elves: 'elf', selves: 'self',
  hooves: 'hoof', scarves: 'scarf', dwarves: 'dwarf', echoes: 'echo', heroes: 'hero', potatoes: 'potato',
  tomatoes: 'tomato', volcanoes: 'volcano', mosquitoes: 'mosquito',
};
// Groups of words that mean the same thing to a clue-giver: true spelling variants, short forms
// and diminutives. Applied both ways (any member blocks every other member).
const GROUPS = [
  ['donut', 'doughnut'], ['grey', 'gray'], ['theatre', 'theater'], ['pyjama', 'pajama'], ['axe', 'ax'],
  ['mould', 'mold'], ['colour', 'color'], ['harbour', 'harbor'], ['jewellery', 'jewelry'], ['tyre', 'tire'],
  ['plane', 'airplane', 'aeroplane'], ['telly', 'tv', 'television'], ['mom', 'mum', 'mommy', 'mama', 'mother'],
  ['dad', 'daddy', 'papa', 'father'], ['kitty', 'kitten'], ['bunny', 'rabbit'], ['puppy', 'pup'],
  ['bike', 'bicycle'], ['mustache', 'moustache'], ['armor', 'armour'], ['scepter', 'sceptre'],
  ['favor', 'favour'], ['flavor', 'flavour'], ['cozy', 'cosy'], ['plough', 'plow'], ['catalog', 'catalogue'],
  ['teddy', 'teddybear'], ['fridge', 'refrigerator'], ['phone', 'telephone'], ['kerb', 'curb'],
  ['aluminium', 'aluminum'], ['ketchup', 'catsup'],
];

const GROUP_OF = new Map();
for (const g of GROUPS) for (const w of g) { const set = GROUP_OF.get(w) || new Set(); for (const x of g) set.add(x); GROUP_OF.set(w, set); }

/** Possible singular forms of a word (itself included). */
function singulars(x) {
  const out = new Set([x]);
  if (IRREG[x]) out.add(IRREG[x]);
  if (x.length > 3 && x.endsWith('ies')) out.add(`${x.slice(0, -3)}y`);
  if (x.length > 4 && x.endsWith('ves')) { out.add(`${x.slice(0, -3)}f`); out.add(`${x.slice(0, -3)}fe`); }
  if (x.length > 4 && x.endsWith('es')) out.add(x.slice(0, -2));
  if (x.length > 3 && x.endsWith('s') && !x.endsWith('ss')) out.add(x.slice(0, -1));
  return out;
}
/** Everything a word can stand for: its singulars, their aliases, and the singulars of those. */
function stems(x) {
  const out = new Set();
  for (const s of singulars(x)) {
    if (s.length < 2) continue;
    out.add(s);
    const g = GROUP_OF.get(s);
    if (g) for (const a of g) out.add(a);
  }
  // pajamas / pyjamas: the group is written singular, so also look up the singular of each alias
  for (const s of [...out]) for (const t of singulars(s)) if (t.length >= 2) out.add(t);
  // and ones whose group entry is plural-looking (telly -> tv): cover aliases of the new singulars
  for (const s of [...out]) { const g = GROUP_OF.get(s); if (g) for (const a of g) out.add(a); }
  return out;
}
const sameFamily = (a, b) => { const sb = stems(b); for (const s of stems(a)) if (sb.has(s)) return true; return false; };

/** Why a (normalised) clue is too close to a board word, or '' if it is fine. */
export function tooClose(clue, word) {
  if (clue === word) return 'is on the board';
  if (sameFamily(clue, word)) return 'same word family';
  const [sh, lo] = clue.length <= word.length ? [clue, word] : [word, clue];
  if (sh.length >= 4 && lo.includes(sh)) return 'part of the same word';
  // RING -> RINGER, RINGED: the board word plus up to three more letters
  if (word.length >= 3 && clue.startsWith(word) && clue.length - word.length <= 3) return 'part of the same word';
  return '';
}

/** Validate and normalise a clue against the live board words. Throws a player-facing Error. */
export function checkClue(words, found, x) {
  if (typeof x !== 'string' || !x.trim()) throw new Error('Type a one-word clue.');
  const c = x.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/\s/.test(c)) throw new Error('One word only, no spaces.');
  if (!/^[a-z]+$/.test(c)) throw new Error('Just letters: one plain word.');
  if (c.length < 2) throw new Error('That clue is too short.');
  if (c.length > 20) throw new Error('That clue is too long.');
  words.forEach((w, i) => {
    if (found[i]) return; // covered cards are off the table
    const why = tooClose(c, w);
    if (!why) return;
    if (why === 'is on the board') throw new Error(`${w.toUpperCase()} is on the board. Try another word.`);
    throw new Error(`Too close to ${w.toUpperCase()} (${why}). Try another word.`);
  });
  return c;
}
