// Same Wave: the v2 content. New arrays only; the 139 classic cards stay in ../wave.js, untouched.
// Every card is a spectrum: a clue can land anywhere between the two poles. {a} / {b} become the names.
// A card's global index is 139 + its position in NEW_CARDS (indices 0..138 are the classic deck).

export const BASE_CARDS = 139;

export const JUSTUS = [
  ['Something {a} would do', 'Something {b} would do'],
  ['{a} picks the movie', '{b} picks the movie'],
  ['Makes {a} laugh', 'Makes {b} laugh'],
  ['{a} cooks it', '{b} cooks it'],
  ['{a} would forget it', '{b} would forget it'],
  ['{a} would cry at it', '{b} would cry at it'],
  ['Only {a} finds it funny', 'Only {b} finds it funny'],
  ['{a} falls asleep first', '{b} falls asleep first'],
  ['Our worst date', 'Our best date'],
  ['Early in our story', 'Recent chapter'],
  ['Thing we never argue about', 'Thing we always argue about'],
  ['Our inside joke', 'Everyone gets it'],
  ['We’d never do it', 'We do it weekly'],
  ['We own way too many', 'We own none'],
  ['Our song', 'Our skip'],
  ['Says “I love you” out loud', 'Shows it by doing things'],
  ['{a}’s side of the closet', '{b}’s side of the closet'],
  ['{a} would plan it', '{b} would plan it'],
  ['{a} would get us lost doing it', '{b} would get us lost doing it'],
  ['{a}’s karaoke pick', '{b}’s karaoke pick'],
  ['First thing we’d save', 'Last thing we’d save'],
  ['A text we send daily', 'A text we’d never send'],
];

export const EVERYDAY = [
  ['Worth the queue', 'Not worth the queue'],
  ['Airport food', 'Home cooking'],
  ['Monday feeling', 'Friday feeling'],
  ['Impulse buy', 'Saved up for'],
  ['Group-chat worthy', 'Keep to yourself'],
  ['Needs a recipe', 'Wing it'],
  ['Fine in pajamas', 'Needs an outfit'],
  ['Overpacked', 'Underpacked'],
  ['Better in the morning', 'Better at midnight'],
  ['Double espresso', 'Gentle herbal tea'],
  ['Deserves a photo', 'Not worth a photo'],
  ['Weekday dinner', 'Weekend dinner'],
  ['Needs a nap after', 'Energizing'],
  ['Never leaves the seat', 'Up and down all flight'],
  ['Fits in a pocket', 'Needs a suitcase'],
  ['Five-minute job', 'All-day job'],
  ['Quiet morning', 'Chaotic morning'],
  ['Throw it out', 'Keep it forever'],
  ['Worth a rain check', 'Worth cancelling plans for'],
  ['Phone on silent', 'Phone on full volume'],
];

export const HOTTAKES = [
  ['Objectively cute', 'Objectively creepy'],
  ['Overhyped sequel', 'Better than the original'],
  ['Peak nostalgia', 'Aged terribly'],
  ['Secretly brilliant', 'Secretly terrible'],
  ['Deserves a statue', 'Deserves a fine'],
  ['Zero effort', 'Tried too hard'],
  ['Comfort food', 'Show-off food'],
  ['Everyone lies about liking it', 'Everyone secretly loves it'],
  ['Early-2000s thing', 'Right-now thing'],
  ['Bad in theory, good in practice', 'Good in theory, bad in practice'],
  ['A whole personality', 'Just a hobby'],
  ['Overrated tourist spot', 'Worth the hype'],
  ['Better as a book', 'Better as a movie'],
  ['Should be a national holiday', 'Should be banned'],
  ['Better live', 'Better recorded'],
  ['Acquired taste', 'Instant love'],
  ['Cheap thrill', 'Expensive thrill'],
  ['Saw it coming', 'Never saw it coming'],
  ['Should come with a warning', 'Should come with a medal'],
];

export const FUTURE = [
  ['Tiny apartment dream', 'Big house dream'],
  ['Pet we’d actually get', 'Pet we only joke about'],
  ['City we’d visit once', 'City we’d move to'],
  ['Bucket list', 'Chuck-it list'],
  ['Boring adult purchase', 'Dream adult purchase'],
  ['Tradition we’d start', 'Tradition we’d skip'],
  ['Our first dance song', 'Our last dance song'],
  ['Rocking-chair hobby', 'Adventure-trip hobby'],
  ['Weekend away next month', 'Trip in ten years'],
  ['Learn together this year', 'Master by eighty'],
  ['Dinner party we’d host', 'Dinner party we’d dodge'],
  ['Peaceful garden project', 'Noisy garage project'],
  ['Gets better with age', 'Gets worse with age'],
  ['Plan for this year', 'Plan for someday'],
  ['Still doing it at eighty', 'Outgrown by thirty-five'],
  ['House rule we’d make', 'House rule we’d break'],
  ['First thing in the new place', 'Last thing to unpack'],
  ['Surprise we’d plan', 'Surprise we’d dread'],
];

export const NEW_CARDS = [...JUSTUS, ...EVERYDAY, ...HOTTAKES, ...FUTURE];

// [first global index, one past the last] for each new pack.
export const RANGES = (() => {
  let at = BASE_CARDS;
  const out = {};
  for (const [id, list] of [['justus', JUSTUS], ['everyday', EVERYDAY], ['hottakes', HOTTAKES], ['future', FUTURE]]) {
    out[id] = [at, at + list.length];
    at += list.length;
  }
  return out;
})();

// The classic cards a "cozy" deck leaves out (the suggestive ones), listed explicitly:
// 64 Least sexy animal / Sexiest animal, 111 Worst bed habit / Best bed habit, 112 Turn-off / Turn-on,
// 120 Tame date / Wild date, 130 Unsexy / Sexy.
export const COZY_OUT = [64, 111, 112, 120, 130];
