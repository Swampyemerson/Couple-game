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

// Words that end in s but are not plurals of a shorter word (NEWS is not NEW + S).
const NOT_PLURAL = new Set(['news', 'lens', 'series', 'species', 'always', 'perhaps', 'christmas', 'bonus', 'chaos', 'bias', 'atlas', 'canvas', 'gas']);
/** Possible singular forms of a word (itself included). */
function singulars(x) {
  const out = new Set([x]);
  if (IRREG[x]) out.add(IRREG[x]);
  if (NOT_PLURAL.has(x)) return out;
  if (x.length > 3 && x.endsWith('ies')) out.add(`${x.slice(0, -3)}y`);
  // -es only after s, x, z, ch, sh (BOXES, WATCHES), never HATES -> HAT
  if (x.length > 4 && /(s|x|z|ch|sh)es$/.test(x)) out.add(x.slice(0, -2));
  if (x.length > 3 && x.endsWith('s') && !/(ss|us|is)$/.test(x)) out.add(x.slice(0, -1));
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
  for (const s of [...out]) { const g = GROUP_OF.get(s); if (g) for (const a of g) out.add(a); }
  return out;
}
/** A clue's bases once an ending is peeled off: DANCING / DANCER / DANCED -> DANCE, CHEESY -> CHEESE, RUNNING -> RUN. */
function inflectedBases(c) {
  const out = new Set();
  for (const suf of ['ing', 'ers', 'er', 'ed', 'ly', 'y']) {
    if (!c.endsWith(suf)) continue;
    const base = c.slice(0, -suf.length);
    if (base.length < 3) continue;
    out.add(base);
    out.add(`${base}e`); // dropped e
    if (/([^aeiou])\1$/.test(base)) out.add(base.slice(0, -1)); // doubled consonant
  }
  return out;
}
const INFLECTIONS = new Set(['s', 'es', 'ed', 'er', 'ers', 'ing', 'y', 'ly']);
// Words that merely look like word + ending (MOTHER is not MOTH + ER).
const NOT_DERIVED = new Set(['mother', 'father', 'brother', 'sister', 'daughter', 'other', 'another', 'together', 'whether', 'rather', 'either', 'neither', 'water', 'butter', 'letter', 'number', 'paper', 'power', 'tiger', 'finger', 'dinner', 'summer', 'winter', 'silver', 'river', 'flower', 'tower', 'shower', 'powder', 'order', 'border', 'leader', 'hunger', 'anger', 'danger', 'ginger', 'wonder', 'thunder', 'monster', 'master', 'sweater', 'weather', 'feather', 'penny', 'apply', 'caper', 'cower', 'homer', 'waver', 'sunny']);
const endingOk = (base, ending) => (ending === 'es' ? /(s|x|z|ch|sh)$/.test(base) : INFLECTIONS.has(ending));
function sameFamily(clue, word, derived) {
  const sw = stems(word);
  for (const s of stems(clue)) if (sw.has(s)) return true;
  if (derived) for (const b of inflectedBases(clue)) for (const s of stems(b)) if (sw.has(s)) return true;
  return false;
}

/** True when two words are the same word in disguise (plural, spelling variant, alias): used to keep both off one board. */
export const related = (a, b) => a === b || sameFamily(a, b, false) || sameFamily(b, a, false);

/** Why a (normalised) clue is too close to a board word, or '' if it is fine. */
export function tooClose(clue, word) {
  if (clue === word) return 'is on the board';
  const derived = !NOT_PLURAL.has(clue) && ![...singulars(clue)].some((x) => NOT_DERIVED.has(x)); // MOTHERS is no more MOTH + ERS than MOTHER is
  if (sameFamily(clue, word, derived)) return 'same word family';
  // RING -> RINGER, RINGED, RINGING: the board word plus a real ending (MAPLE, SPACE, BEER, VOWEL are fine)
  if (derived && word.length >= 3 && clue.startsWith(word) && endingOk(word, clue.slice(word.length))) return 'part of the same word';
  // a long word sitting inside another (FLOWER in SUNFLOWER); short fragments (AT, SEA, EAR, NIGHT) are fine
  const [sh, lo] = clue.length <= word.length ? [clue, word] : [word, clue];
  if (sh.length >= 6 && lo.includes(sh)) return 'part of the same word';
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
