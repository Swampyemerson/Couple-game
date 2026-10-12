// Same Wave: a Wavelength-style mind-meld. One of you sees where the target hides on a
// spectrum and gives a clue; the other turns the dial. Eight rounds, the clue-giver alternates.
//
// Versions. A match that starts with a setup move ({ setup: { v: 2, mode, pack, deal? } }, see ./wave/rules.js) is
// v2: modes, packs, edge targets, jackpot, Déjà vu. A match without one is v1 and runs on the code in this file
// exactly as it always has (old saved matches replay byte for byte). Never edit, reorder or append to CARDS;
// new cards live in ./wave/cards.js.
import { registerGame, shuffled, randInt } from './core.js';
import { setupV2, applyV2, resultV2 } from './wave/rules.js';
import { CSS } from './wave/css.js';
import { createWaveView } from './wave/view.js';

const ROUNDS = 8;
const MAX = ROUNDS * 4;
const pointsFor = (d) => (d <= 4 ? 4 : d <= 10 ? 3 : d <= 17 ? 2 : 0);

// {a} / {b} become the players' names.
const CARDS = [
  ['Cold', 'Hot'], ['Bad', 'Good'], ['Underrated', 'Overrated'], ['Useless', 'Useful'], ['Normal', 'Weird'],
  ['Easy to spell', 'Hard to spell'], ['Sad song', 'Happy song'], ['Hard to do', 'Easy to do'],
  ['Unforgivable', 'Forgivable'], ['Smells bad', 'Smells good'], ['Rough', 'Smooth'], ['Soft', 'Hard'],
  ['Dry food', 'Wet food'], ['Mildly addictive', 'Highly addictive'], ['Unpopular', 'Popular'],
  ['Low calorie', 'High calorie'], ['Villain', 'Hero'], ['Round', 'Pointy'], ['Cheap', 'Expensive'],
  ['Boring', 'Exciting'], ['Tiny', 'Huge'], ['Quiet', 'Loud'], ['Slow', 'Fast'], ['Ugly', 'Beautiful'],
  ['Light', 'Heavy'], ['Safe', 'Dangerous'], ['Old-fashioned', 'Futuristic'], ['Rare', 'Common'],
  ['Fragile', 'Indestructible'], ['Bitter', 'Sweet'], ['Mild', 'Spicy'], ['Forgettable', 'Unforgettable'],
  ['Ordinary', 'Extraordinary'], ['Calm', 'Chaotic'], ['Simple', 'Complicated'], ['Casual', 'Formal'],
  ['Snack', 'Meal'], ['Fact', 'Opinion'], ['Mainstream', 'Niche'], ['Cat energy', 'Dog energy'],
  ['Healthy', 'Unhealthy'], ['Gross', 'Delicious'], ['Basic', 'Fancy'], ['Cute', 'Terrifying'],
  ['Childish', 'Grown-up'], ['Messy', 'Tidy'], ['Weak', 'Strong'], ['Dumb idea', 'Genius idea'],
  ['Worst invention', 'Best invention'], ['Underdressed', 'Overdressed'], ['Relaxing', 'Stressful'],
  ['Uncool', 'Cool'], ['Bad habit', 'Good habit'], ['Useless superpower', 'Amazing superpower'],
  ['Terrible movie', 'Great movie'], ['Worst pizza topping', 'Best pizza topping'],
  ['Worst holiday', 'Best holiday'], ['Underpaid job', 'Overpaid job'], ['Easy to draw', 'Hard to draw'],
  ['Better hot', 'Better cold'], ['Breakfast food', 'Dinner food'], ['Morning thing', 'Night thing'],
  ['Summer thing', 'Winter thing'], ['Useless skill', 'Useful skill'], ['Least sexy animal', 'Sexiest animal'],
  ['Normal pet', 'Weird pet'], ['Nerdy', 'Sporty'], ['Lowbrow', 'Highbrow'], ['Unknown', 'Famous'],
  ['Sci-fi', 'Fantasy'], ['Easy to cook', 'Hard to cook'], ['Comfortable', 'Uncomfortable'],
  ['Trashy', 'Classy'], ['Harmless', 'Harmful'], ['Wholesome', 'Unhinged'], ['Boring place', 'Fun place'],
  ['Feels short', 'Feels long'], ['Easy to remember', 'Hard to remember'], ['Annoying sound', 'Soothing sound'],
  ['Polite', 'Rude'], ['Clean', 'Dirty'], ['Fruit', 'Vegetable'], ['Tastes like childhood', 'Tastes grown-up'],
  ['Cringe', 'Iconic'], ['Mid', 'Elite'], ['Lowkey', 'Extra'], ['Sweet', 'Savage'],
  ['Background character', 'Main character'], ['Totally fine', 'Absolute disaster'], ['Lukewarm take', 'Spicy take'],
  ['Embarrassing', 'Impressive'], ['Thoughtless', 'Thoughtful'], ['Happens once a year', 'Happens every day'],
  // for the two of you
  ['Bad first-date idea', 'Great first-date idea'], ['Unromantic', 'Romantic'], ['Ick', 'Swoon'],
  ['Red flag', 'Green flag'], ['Cheap date', 'Fancy date'], ['Cozy night in', 'Big night out'],
  ['Terrible gift', 'Perfect gift'], ['Never share it', 'Always share it'], ['Bad pet name', 'Cute pet name'],
  ['Annoying habit', 'Endearing habit'], ['Bad wedding song', 'Perfect wedding song'],
  ['Morning person', 'Night owl'], ['Low effort', 'Grand gesture'],
  ['Wouldn’t do it for love', 'Would do it for love'], ['Relationship killer', 'Relationship goals'],
  ['Cringey couple thing', 'Cute couple thing'], ['Guilty pleasure', 'Proud pleasure'],
  ['Lazy Sunday', 'Busy Sunday'], ['Worst bed habit', 'Best bed habit'], ['Turn-off', 'Turn-on'],
  ['Keep it private', 'Tell everyone'], ['Forgettable anniversary', 'Legendary anniversary'],
  ['Dealbreaker', 'Dealmaker'], ['Bad apology', 'Great apology'], ['Totally {a}', 'Totally {b}'],
  ['Chore I hate', 'Chore I don’t mind'], ['Bad couple costume', 'Great couple costume'],
  ['Tame date', 'Wild date'], ['Date-night movie', 'Watch-alone movie'], ['Tiny fight', 'Huge fight'],
  ['Bad wake-up text', 'Great wake-up text'], ['Worst honeymoon', 'Dream honeymoon'],
  ['Bad thing to say to in-laws', 'Great thing to say to in-laws'], ['Normal for couples', 'Weird for couples'],
  ['Save the money', 'Splurge'], ['Kid at heart', 'Old soul'], ['Rom-com moment', 'Horror-movie moment'],
  ['Unsexy', 'Sexy'], ['Awkward move', 'Smooth move'], ['Boring vacation', 'Dream vacation'],
  ['Bad date outfit', 'Great date outfit'], ['Quick peck', 'Movie kiss'], ['Clingy', 'Distant'],
  ['Too soon', 'Too late'], ['Bad road-trip snack', 'Perfect road-trip snack'],
  ['Bad thing to find in the fridge', 'Great thing to find in the fridge'],
];
const RATINGS = [[30, 'Telepathic'], [25, 'Same wavelength'], [19, 'Pretty much in sync'], [12, 'Crossed signals'], [6, 'Different radio stations'], [0, 'Static on the line']];
const ratingOf = (n) => RATINGS.find(([m]) => n >= m)[1];
const other = (w) => (w === 'a' ? 'b' : 'a');

registerGame({
  id: 'wave',
  title: 'Same Wave',
  blurb: 'One clue, one dial. How in sync are you?',
  kind: 'turns',
  team: true,
  secret: true,
  tags: ['brainy'],
  platforms: ['phone', 'computer'],
  minutes: 10,
  endDelay: 'manual', // the view calls api.showEnd() once the final reveal has been seen
  endLookLabel: 'See every round',
  howTo: [
    'The clue-giver sees a hidden target on a spectrum, like Cold to Hot.',
    'They type a short clue that lands right there.',
    'The other turns the dial to where the clue belongs and locks it in.',
    'Bullseye 4, close 3, near 2. Eight rounds, then pick a mode and a deck to keep it fresh.',
  ],

  // ── rules (pure, deterministic) ──
  init({ first, seed }) {
    const deck = shuffled(CARDS.map((_, i) => i), `${seed}:wave`);
    const rounds = [];
    for (let r = 0; r < ROUNDS; r++) {
      rounds.push({ giver: r % 2 ? other(first) : first, card: deck[r], target: 4 + randInt(93, seed, 'wave-target', r), clue: null, at: null, points: null });
    }
    return { first, seed, r: 0, phase: 'clue', score: 0, rounds };
  },
  next(s) {
    if (s.r >= ROUNDS) return [];
    const g = s.rounds[s.r].giver;
    return [s.phase === 'clue' ? g : other(g)];
  },
  apply(s, who, mv) {
    if (s.v === 2) return applyV2(s, who, mv);
    if (mv && typeof mv === 'object' && mv.setup !== undefined) return setupV2(s, who, mv.setup);
    if (s.r >= ROUNDS) throw new Error('The game is over.');
    if (!mv || typeof mv !== 'object') throw new Error('That move makes no sense.');
    const Rd = s.rounds[s.r];
    if (s.phase === 'clue') {
      if (who !== Rd.giver) throw new Error(mv.at != null ? 'Wait for the clue first.' : 'It’s not your turn to give the clue.');
      if (mv.clue != null && typeof mv.clue !== 'string') throw new Error('Write a clue first.');
      const clue = String(mv.clue || '').trim().replace(/\s+/g, ' ');
      if (!clue) throw new Error('Write a clue first.');
      if (clue.length > 40) throw new Error('Keep your clue to 40 characters.');
      if (/^[\d\s.,%/-]+$/.test(clue)) throw new Error('No numbers on their own. That’s cheating!');
      Rd.clue = clue;
      s.phase = 'guess';
      return s;
    }
    if (who === Rd.giver) throw new Error('You gave the clue. Your partner turns the dial.');
    const at = mv.at;
    if (typeof at !== 'number' || !Number.isFinite(at)) throw new Error('Turn the dial to pick a spot.');
    if (!Number.isInteger(at) || at < 0 || at > 100) throw new Error('The dial only goes from 0 to 100.');
    Rd.at = at;
    Rd.points = pointsFor(Math.abs(at - Rd.target));
    s.score += Rd.points;
    s.r++;
    s.phase = 'clue';
    return s;
  },
  result(s) {
    if (s.v === 2) return resultV2(s);
    const bulls = s.rounds.filter((x) => x.points === 4).length;
    return { winner: null, team: true, score: s.score, text: ratingOf(s.score), sub: `${s.score} of ${MAX} points${bulls ? `, ${bulls} bullseye${bulls > 1 ? 's' : ''}` : ''}.` };
  },

  // ── view (see ./wave/view.js) ──
  css: CSS,
  mount(el, api) {
    return createWaveView(el, api, { CARDS, ratingOf });
  },
});
