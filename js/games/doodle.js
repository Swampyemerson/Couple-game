// Doodle: draw-and-guess, together. Six rounds, the drawer alternates.
// A drawing is one compact string: strokes joined by '.', each stroke is
//   [style][gap gap][x y t]…   (base64url; style = colour + 4*size, gap in 10 ms,
//   every point = 24 bits: x 0–255, y 0–255, dt in 8 ms units).
import { registerGame, shuffled, rand, randInt } from './core.js';
import { NEW_DECKS, MODE_LIST, PACK_LIST, TWIST_LIST } from './doodle/packs.js';
import { mountDoodle } from './doodle/view.js';
import { CSS } from './doodle/css.js';

const ROUNDS = 6;
const DRAW_SECONDS = 75;
const INK_CHARS = 12000;   // the drawing UI stops adding ink here
const MAX_CHARS = 12288;   // the rules refuse anything bigger (12 KB)
const REPLAY_CAP = 20000;  // ms
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64I = Object.create(null);
for (let i = 0; i < 64; i++) B64I[B64[i]] = i;
const WIDTHS = [2.6, 7.5]; // in grid units (the grid is 256 wide)
const POINTS = [3, 2, 1];
const INK_VARS = ['var(--g-ink)', 'var(--p-a)', 'var(--p-b)', 'var(--g-good)'];

// ── prompts: 'shown|also accepted|…' ─────────────────────────────────
const EASY = [
  'cat|kitty|kitten', 'dog|puppy', 'fish', 'house|home', 'tree', 'sun', 'moon', 'star', 'flower', 'apple',
  'banana', 'pizza|pizza slice|slice of pizza', 'birthday cake|cake', 'heart', 'cloud', 'rainbow', 'snowman',
  'umbrella', 'glasses|eyeglasses|spectacles', 'hat', 'shoe|sneaker|trainer', 'key', 'clock', 'book', 'chair',
  'bed', 'coffee|cup of coffee|coffee cup|mug', 'ice cream|ice cream cone|icecream', 'hot dog|hotdog', 'car',
  'boat|ship', 'airplane|plane|aeroplane|jet', 'bicycle|bike', 'train', 'rocket|rocket ship|spaceship',
  'balloon', 'kite', 'ladder', 'candle', 'guitar', 'crown', 'snake', 'spider', 'bee|bumblebee', 'butterfly',
  'frog', 'turtle|tortoise', 'owl', 'duck', 'pig', 'cow', 'bunny|rabbit', 'mouse', 'elephant', 'giraffe',
  'penguin', 'octopus', 'shark', 'whale', 'crab', 'snail', 'bird', 'horse', 'lion', 'monkey',
  'dinosaur|dino|t rex|trex', 'unicorn', 'ghost', 'robot', 'alien', 'pumpkin', 'cactus', 'mushroom', 'carrot',
  'fried egg|egg', 'donut|doughnut', 'cookie', 'cupcake', 'sandwich', 'burger|hamburger|cheeseburger', 'taco',
  'popcorn', 'lollipop', 'cherries|cherry', 'strawberry', 'watermelon', 'pineapple', 'grapes', 'toothbrush',
  'scissors', 'light bulb|lightbulb|bulb', 'phone|cellphone|cell phone|smartphone|mobile', 'laptop|computer',
  'tv|television|telly', 'camera', 'envelope|letter|mail', 'present|gift|gift box', 'anchor', 'sword', 'castle',
  'tent', 'mountain|mountains', 'volcano', 'lightning|lightning bolt', 'snowflake', 'sock|socks',
  'sunglasses|shades', 'backpack|rucksack', 'bow tie|bowtie', 'teddy bear|teddy', 'lips|kiss', 'diamond',
];
const MEDIUM = [
  'picnic', 'candlelit dinner|candle lit dinner|candlelight dinner|romantic dinner', 'movie night|movies|cinema',
  'slow dance|slow dancing|dancing', 'love letter', 'holding hands', 'breakfast in bed', 'road trip',
  'bubble bath', 'wedding cake', 'engagement ring|ring', 'proposal|marriage proposal|proposing|getting engaged',
  'first kiss', 'mistletoe', 'ferris wheel', 'roller coaster|rollercoaster', 'hot air balloon',
  'roasting marshmallows|marshmallows|smores', 'stargazing|star gazing|looking at the stars', 'sunset',
  'ice skating|skating', 'mini golf|minigolf|crazy golf|putt putt', 'bowling', 'karaoke|singing', 'fishing',
  'camping', 'yoga', 'jogging|running|runner', 'surfing|surfer', 'skiing|skier', 'snowball fight',
  'sandcastle|sand castle', 'treasure chest|treasure', 'pirate', 'mermaid', 'vampire|dracula', 'zombie',
  'wizard', 'superhero', 'astronaut', 'chef|cook', 'firefighter|fireman', 'ninja', 'cowboy', 'clown',
  'scarecrow', 'igloo', 'lighthouse', 'windmill', 'waterfall', 'eiffel tower', 'pyramid|pyramids',
  'traffic light|traffic lights|stoplight|stop light', 'fire hydrant|hydrant', 'mailbox|postbox',
  'washing machine', 'vacuum cleaner|vacuum|hoover', 'toaster', 'alarm clock', 'high heels|heels|stilettos',
  'wedding dress', 'bikini', 'flip flops|flipflops|sandals', 'rain boots|wellies|rubber boots|wellington boots',
  'bathtub|bath|tub', 'hammock', 'trampoline', 'shopping cart|shopping trolley|trolley', 'piggy bank', 'magnet',
  'treasure map|map', 'sushi', 'spaghetti|pasta|noodles', 'pancakes|pancake|stack of pancakes',
  'french fries|fries|chips', 'avocado', 'glass of wine|wine|wine glass', 'champagne|bubbly|prosecco',
  'rubber duck|rubber ducky', 'snow globe', 'dice|die', 'playing cards|cards|deck of cards',
  'game controller|controller|video games|gaming', 'headphones', 'selfie', 'text message|texting|text',
  'cuddling|cuddle|hug|hugging', 'pillow fight', 'blanket fort|pillow fort|fort',
  'matching pajamas|matching pyjamas|pajamas|pyjamas', 'bouquet|bunch of flowers|flower bouquet',
  'box of chocolates|chocolates', 'lovebirds', 'cupid', 'double date', 'sleeping|asleep|sleep',
  'birthday party|party', 'walking the dog|dog walk|dog walking', 'spa day|spa',
  'tandem bike|tandem bicycle|bicycle built for two',
];
const TRICKY = [
  'fighting over the remote|tv remote|remote|remote control',
  'hogging the blanket|stealing the blanket|blanket hog|stealing the covers|hogging the covers',
  'morning breath|bad breath', 'snoring', 'hangover|hungover', 'skinny dipping', 'hickey|love bite', 'spooning',
  'walk of shame', 'netflix and chill', 'first date', 'blind date', 'speed dating', 'love at first sight',
  'butterflies in your stomach|butterflies|butterflies in stomach|butterflies in my stomach',
  'broken heart|heartbreak|heartbroken', 'cold feet', 'meeting the parents|meet the parents',
  'long distance relationship|long distance', 'third wheel', 'wedding vows|vows',
  'bachelor party|stag do|stag party|hen party|bachelorette party', 'bouquet toss|throwing the bouquet',
  'puppy love', 'tying the knot|tie the knot|getting married|wedding', 'head over heels',
  'cloud nine|on cloud nine', 'piece of cake', 'raining cats and dogs', 'couch potato', 'night owl',
  'early bird', 'elephant in the room', 'brain freeze', 'sleepwalking|sleepwalker|sleep walking',
  'jet lag|jetlag', 'time machine|time travel', 'black hole', 'wifi|wi fi|wireless|internet',
  'procrastination|procrastinating', 'traffic jam|traffic', 'monday morning|monday', 'dad joke',
  'midlife crisis|mid life crisis', 'statue of liberty', 'mona lisa', 'loch ness monster|nessie',
  'bigfoot|sasquatch|yeti', 'tooth fairy', 'dentist', 'serenade|serenading',
  'flat pack furniture|assembling furniture|furniture assembly|building furniture',
  'doing the dishes|washing up|dishes|washing dishes', 'laundry|doing laundry|laundry day',
  'burnt toast|burned toast|toast', 'surprise party', 'sunburn|sunburnt', 'mind reading|mind reader|telepathy',
  'shooting star|wishing star|wishing on a star', 'kissing in the rain|kiss in the rain',
  'lipstick on a collar|lipstick', 'tan lines|tan line', 'hot tub|jacuzzi', 'love handles', 'booty call',
  'pillow talk', 'dancing in the kitchen|kitchen dance', 'forgotten anniversary|forgot the anniversary',
  'lost keys|lost the keys|losing keys', 'the dog ate my homework|dog ate my homework',
];
const TIERS = [EASY, MEDIUM, TRICKY];
const TIER_NAMES = ['Easy', 'Medium', 'Tricky'];
const OFFS = [0, EASY.length, EASY.length + MEDIUM.length];
export const PROMPTS = [...EASY, ...MEDIUM, ...TRICKY].map((p) => { const all = p.split('|'); return { show: all[0], all }; });
const tierOf = (i) => (i >= OFFS[2] ? 2 : i >= OFFS[1] ? 1 : 0);

// ── guess matching ───────────────────────────────────────────────────
const ARTICLES = new Set(['a', 'an', 'the']);
function squash(s, keepArticles = false) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter((w) => w && (keepArticles || !ARTICLES.has(w))).join('');
}
function forms(x) {
  const f = new Set([x, x + 's', x + 'es']);
  if (x.endsWith('y')) f.add(x.slice(0, -1) + 'ies');
  if (x.endsWith('ies')) f.add(x.slice(0, -3) + 'y');
  if (x.endsWith('es')) f.add(x.slice(0, -2));
  if (x.endsWith('s') && !x.endsWith('ss')) f.add(x.slice(0, -1));
  return f;
}
// true when a and b differ by at most one edit (insert, delete, substitute or swap neighbours)
function oneEdit(a, b) {
  if (a === b) return true;
  const la = a.length; const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    const diff = [];
    for (let i = 0; i < la && diff.length < 3; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [s, l] = la < lb ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}
export function guessMatches(guess, prompt) {
  // Compare with articles dropped ("dog ate my homework") and kept ("thedogatemyhomework"),
  // so a typo that glues "the" onto the next word still counts.
  for (const keep of [false, true]) {
    const g = squash(guess, keep);
    if (!g) continue;
    for (const alt of prompt.all) {
      const a = squash(alt, keep);
      if (!a) continue;
      const fs = forms(a);
      if (fs.has(g)) return true;
      if (a.length >= 5 && g[0] === a[0]) for (const f of fs) if (oneEdit(f, g)) return true;
    }
  }
  return false;
}

// ── drawings ─────────────────────────────────────────────────────────
function encode(strokes) {
  return strokes.map((st) => {
    const gap = Math.max(0, Math.min(4095, st.gap | 0));
    let s = B64[st.c + 4 * st.s] + B64[gap >> 6] + B64[gap & 63];
    for (const [x, y, t] of st.pts) {
      const v = (x << 16) | (y << 8) | t;
      s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
    }
    return s;
  }).join('.');
}
function decode(str) {
  if (typeof str !== 'string' || !str || !/^[A-Za-z0-9_.-]+$/.test(str)) return null;
  const out = [];
  for (const part of str.split('.')) {
    if (part.length < 7 || (part.length - 3) % 4) return null;
    const style = B64I[part[0]];
    if (style > 7) return null;
    const st = { c: style & 3, s: style >> 2, gap: (B64I[part[1]] << 6) | B64I[part[2]], pts: [] };
    for (let i = 3; i < part.length; i += 4) {
      const v = (B64I[part[i]] << 18) | (B64I[part[i + 1]] << 12) | (B64I[part[i + 2]] << 6) | B64I[part[i + 3]];
      st.pts.push([(v >> 16) & 255, (v >> 8) & 255, v & 255]);
    }
    out.push(st);
  }
  return out;
}
const charsOf = (strokes) => strokes.reduce((n, st) => n + 3 + 4 * st.pts.length, 0) + Math.max(0, strokes.length - 1);
function drawingError(str) {
  if (typeof str !== 'string' || !str) return 'Draw something first.';
  if (str.length > MAX_CHARS) return 'That drawing is too big to send. Try fewer scribbles.';
  const d = decode(str);
  if (!d) return 'That drawing got scrambled. Try sending it again.';
  if (!d.length) return 'Draw something first.';
  return null;
}

// ── rules ────────────────────────────────────────────────────────────
const other = (w) => (w === 'a' ? 'b' : 'a');
const RATINGS = [
  [18, 'Mind readers'], [15, 'Gallery-worthy'], [11, 'Fridge-door art'],
  [6, 'Abstract art'], [1, 'Modern art, probably'], [0, 'Pure mystery'],
];
const ratingOf = (n) => RATINGS.find(([min]) => n >= min)[1];

function finishRound(s, pts) {
  const R = s.rounds[s.r];
  R.points = pts;
  s.score += pts;
  s.r++;
  s.phase = 'draw';
}

// ═════════════════════════════════════════════════════════════════════
// v2 (everything below is gated on s.v === 2; the v1 code above never changes)
// ═════════════════════════════════════════════════════════════════════
const ROUNDS_V2 = 6;
const STAKES = [[2, 1, 1], [3, 2, 1], [5, 3, 2]]; // by tier, by guess number
const EARLY = [4, 5, 7];                           // Half & Half early call: first-guess stakes + 2
const BONUS_KINDS = new Set(['invisible', 'sprint', 'oneline']);

// The whole card pool: the 282 v1 prompts first (same indices as PROMPTS), then the new decks.
export const POOL = PROMPTS.map((p, i) => ({ show: p.show, all: p.all, i }));
const POOL_TIER = PROMPTS.map((_, i) => tierOf(i));
const V1_IDX = TIERS.map((t, k) => t.map((_, i) => OFFS[k] + i));
const PACK_IDX = { classic: V1_IDX };
for (const deck of NEW_DECKS) {
  PACK_IDX[deck.id] = [[], [], []];
  deck.tiers.forEach((tier, k) => tier.forEach((str) => {
    const all = str.split('|');
    PACK_IDX[deck.id][k].push(POOL.length);
    POOL.push({ show: all[0], all, i: POOL.length });
    POOL_TIER.push(k);
  }));
}
PACK_IDX.everything = [0, 1, 2].map((k) => [...V1_IDX[k], ...NEW_DECKS.flatMap((d) => PACK_IDX[d.id][k])]);
export const poolTier = (i) => POOL_TIER[i];
export const packIndices = (pack) => (PACK_IDX[pack] || PACK_IDX.classic).map((t) => t.slice());

// v2 guess matching: v1's rules, plus "a guess that is itself a word of another prompt is never
// forgiven as a typo for this one" (horse is not a typo of house, clown is not crown...).
let altOwners = null;
let showOwners = null;
function owners() {
  if (altOwners) return altOwners;
  altOwners = new Map();
  showOwners = new Map();
  for (const p of POOL) {
    for (const keep of [false, true]) {
      p.all.forEach((alt, n) => {
        const a = squash(alt, keep);
        if (!a) return;
        for (const f of forms(a)) {
          if (!altOwners.has(f)) altOwners.set(f, new Set());
          altOwners.get(f).add(p.i);
        }
        if (n === 0) { if (!showOwners.has(a)) showOwners.set(a, new Set()); showOwners.get(a).add(p.i); }
      });
    }
  }
  return altOwners;
}
export function guessMatchesV2(guess, prompt) {
  const own = owners();
  for (const keep of [false, true]) {
    const g = squash(guess, keep);
    if (!g) continue;
    // An alternate listed for this card always matches as written. A plural / singular variant of
    // one does not when it is another card's own name ("butterfly" is not "butterflies in your
    // stomach"): that guess belongs to the other card.
    const named = showOwners.get(g);
    const foreign = named && [...named].some((i) => i !== prompt.i);
    for (const alt of prompt.all) {
      const a = squash(alt, keep);
      if (!a) continue;
      if (a === g) return true;
      if (!foreign && forms(a).has(g)) return true;
    }
  }
  for (const keep of [false, true]) {
    const g = squash(guess, keep);
    if (!g) continue;
    const others = own.get(g);
    if (others && [...others].some((i) => i !== prompt.i)) continue;
    for (const alt of prompt.all) {
      const a = squash(alt, keep);
      if (!a || a.length < 5 || g[0] !== a[0]) continue;
      for (const f of forms(a)) if (oneEdit(f, g)) return true;
    }
  }
  return false;
}
// "So close!" on a wrong guess: one edit away, or a whole word shared with a multi-word answer.
const STOP = new Set(['and', 'the', 'for', 'with', 'you', 'your', 'our', 'in', 'on', 'of', 'to', 'at']);
const wordsOf = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '')
  .split(/[^a-z0-9]+/).filter((w) => w && !ARTICLES.has(w)).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
export function nearMiss(guess, prompt) {
  const g = squash(guess);
  if (!g) return false;
  for (const alt of prompt.all) {
    const a = squash(alt);
    if (a.length < 4 || g.length < 4 || g === a) continue;
    for (const f of forms(a)) if (f !== g && oneEdit(f, g)) return true;
  }
  const gw = wordsOf(guess);
  for (const alt of prompt.all) {
    const aw = wordsOf(alt);
    if (aw.length < 2) continue;
    for (const w of gw) if (w.length >= 3 && !STOP.has(w) && aw.includes(w)) return true;
  }
  return false;
}

// Half & Half: how much of the drawing the guesser sees first. The first stroke at which the
// cumulative drawing time reaches half of the total, inclusive, but never the whole drawing when
// it has two or more strokes. A one-stroke drawing shows the first part of that stroke's points
// (up to half the drawing time, at least one point, never all of them).
// Returns { k, cut }: k whole strokes, then (when cut > 0) the first `cut` points of the next one.
export function halfPlan(str) {
  const d = decode(str);
  if (!d || !d.length) return { k: 0, cut: 0 };
  const sum = (a) => a.reduce((t, x) => t + x, 0);
  if (d.length === 1) {
    const dt = d[0].pts.map((p) => Math.min(p[2] * 8, 450));
    const total = sum(dt);
    let cum = 0; let cut = d[0].pts.length;
    for (let i = 0; i < dt.length; i++) { cum += dt[i]; if (cum >= total / 2) { cut = i + 1; break; } }
    return { k: 0, cut: Math.max(1, Math.min(cut, d[0].pts.length - 1 || 1)) };
  }
  const dur = d.map((st) => sum(st.pts.map((p) => Math.min(p[2] * 8, 450))));
  const total = sum(dur);
  let cum = 0; let shown = d.length - 1;
  for (let k = 0; k < d.length; k++) { cum += dur[k]; if (cum >= total / 2) { shown = k + 1; break; } }
  return { k: Math.max(1, Math.min(shown, d.length - 1)), cut: 0 };
}
// How many strokes (whole or partial) the half shows.
export function halfSplit(str) {
  const { k, cut } = halfPlan(str);
  return k + (cut ? 1 : 0);
}

export function dealFor(seed, pack) {
  const deal = new Array(ROUNDS_V2 * 3);
  PACK_IDX[pack].forEach((idx, k) => {
    const pick = shuffled(idx, `${seed}:doodle2:${pack}:${k}`).slice(0, ROUNDS_V2);
    for (let r = 0; r < ROUNDS_V2; r++) deal[r * 3 + k] = pick[r];
  });
  return deal;
}
// A fresh deal for a new match from cards you have not seen yet (the UI freezes it in the setup move).
// Returns { deal, seen }; `seen` is the new seen-list. `rnd` is any () => [0,1).
export function dealFresh(pack, seenList, rnd = Math.random) {
  const seen = new Set(seenList || []);
  const next = new Set(seen);
  const deal = new Array(ROUNDS_V2 * 3);
  const shuf = (a) => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
  PACK_IDX[pack].forEach((idx, k) => {
    const fresh = idx.filter((i) => !seen.has(i));
    let pick;
    if (fresh.length >= ROUNDS_V2) pick = shuf(fresh).slice(0, ROUNDS_V2);
    else { // the deck is used up: start it over, but play what was never seen first
      for (const i of idx) next.delete(i);
      const rest = shuf(idx.filter((i) => !fresh.includes(i)));
      pick = shuf([...fresh, ...rest.slice(0, ROUNDS_V2 - fresh.length)]);
    }
    for (let r = 0; r < ROUNDS_V2; r++) { deal[r * 3 + k] = pick[r]; next.delete(pick[r]); next.add(pick[r]); }
  });
  return { deal, seen: [...next] };
}

const kindOf = (s, R) => (s.mode === 'mixed' ? R.twist : s.mode === 'halfhalf' ? 'halfhalf' : s.mode === 'invisible' ? 'invisible' : 'normal');
const drawSecondsFor = (kind) => (kind === 'invisible' ? 60 : kind === 'sprint' ? 35 : DRAW_SECONDS);
const roundMax = (s, r) => {
  const R = s.rounds[r];
  const m = s.mode === 'ladder' ? STAKES[Math.min(2, r)][0] : { halfhalf: 7, invisible: 6, sprint: 6, oneline: 6 }[kindOf(s, R)] || 5;
  return R.gold ? m * 2 : m;
};
const maxScore = (s) => (s.v === 2 ? s.rounds.reduce((n, _, r) => n + roundMax(s, r), 0) : ROUNDS * POINTS[0]);
const RATINGS2 = [[0.85, 'Mind readers'], [0.68, 'Gallery-worthy'], [0.5, 'Fridge-door art'], [0.3, 'Abstract art'], [0.0001, 'Modern art, probably'], [0, 'Pure mystery']];
export const ratingOf2 = (score, max) => RATINGS2.find(([min]) => score / Math.max(1, max) >= min)[1];

function buildV2(s, st) {
  const { seed, first } = s;
  const mode = st.mode; const pack = st.pack;
  const deal = Array.isArray(st.deal) ? st.deal : dealFor(seed, pack);
  const twists = mode === 'mixed'
    ? shuffled([...shuffled(TWIST_LIST, `${seed}:doodle2:tw`), TWIST_LIST[randInt(TWIST_LIST.length, seed, 'doodle2', 'twx')]], `${seed}:doodle2:tw2`)
    : null;
  const rounds = [];
  for (let r = 0; r < ROUNDS_V2; r++) {
    rounds.push({
      drawer: r % 2 ? other(first) : first, choices: [deal[r * 3], deal[r * 3 + 1], deal[r * 3 + 2]], pick: null, tier: r === 0 && mode === 'ladder' ? 0 : null,
      strokes: null, guesses: [], points: null, gaveUp: false, twist: twists ? twists[r] : null, gold: false,
    });
  }
  // Golden Frame: in about one match of three, one round after the first pays double.
  let gold = -1;
  if (rand(seed, 'doodle2', 'gold') < 1 / 3) { gold = 1 + randInt(ROUNDS_V2 - 1, seed, 'doodle2', 'goldr'); rounds[gold].gold = true; }
  const state = { first, seed, v: 2, mode, pack, r: 0, phase: 'draw', score: 0, rung: 0, gold, rounds };
  // Encore (opt-in): after the last scored round both draw one more Us card at the same time. It is
  // never one of the cards dealt in this match and it scores nothing.
  if (st.encore === true) {
    const dealt = new Set(rounds.flatMap((R) => R.choices));
    const pool = PACK_IDX.us.flat().filter((i) => !dealt.has(i));
    state.enc = { prompt: shuffled(pool, `${seed}:doodle2:encore`)[0], a: null, b: null };
  }
  return state;
}
function checkDeal(deal, pack) {
  if (!Array.isArray(deal) || deal.length !== ROUNDS_V2 * 3) throw new Error('That deal has the wrong number of cards.');
  const seen = new Set();
  deal.forEach((i, n) => {
    if (!Number.isInteger(i) || i < 0 || i >= POOL.length) throw new Error('That deal has a card that does not exist.');
    if (seen.has(i)) throw new Error('That deal repeats a card.');
    seen.add(i);
    if (!PACK_IDX[pack][n % 3].includes(i)) throw new Error('That deal has a card from the wrong pack.');
  });
}
function applySetup(s, who, st) {
  if (s.v) throw new Error('This game is already set up.');
  if (s.r !== 0 || s.phase !== 'draw' || s.rounds[0].pick != null || s.rounds[0].strokes != null) throw new Error('It is too late to change the setup.');
  if (who !== s.first) throw new Error('Only the first player sets up the game.');
  if (!st || typeof st !== 'object' || st.v !== 2) throw new Error('That setup makes no sense.');
  if (!MODE_LIST.includes(st.mode)) throw new Error('Unknown game mode.');
  if (!PACK_LIST.includes(st.pack)) throw new Error('Unknown card pack.');
  if (st.deal !== undefined) checkDeal(st.deal, st.pack);
  if (st.encore !== undefined && typeof st.encore !== 'boolean') throw new Error('The Encore setting must be on or off.');
  return buildV2(s, st);
}

function finishV2(s, base) {
  const R = s.rounds[s.r];
  let pts = base;
  R.base = base;
  if (pts > 0 && BONUS_KINDS.has(kindOf(s, R))) { R.bonus = 1; pts += 1; }
  if (pts > 0 && R.gold) { pts *= 2; R.x2 = true; }
  R.points = pts;
  s.score += pts;
  if (s.mode === 'ladder') s.rung = pts > 0 ? Math.min(2, s.rung + 1) : Math.max(0, s.rung - 1);
  s.r++;
  s.phase = 'draw';
  if (s.mode === 'ladder' && s.rounds[s.r]) s.rounds[s.r].tier = s.rung;
}

// The Encore: both players draw the same card at once, in either order. Nothing is scored.
function applyEncore(s, who, mv) {
  if (typeof mv.encore !== 'string') throw new Error('Draw the Encore card.');
  if (s.enc[who] !== null) throw new Error('You already sent your Encore drawing.');
  if (mv.timeUp === true) {
    if (mv.encore) throw new Error('A time-up Encore has no drawing.');
    s.enc[who] = '';
    return s;
  }
  const err = drawingError(mv.encore);
  if (err) throw new Error(err);
  s.enc[who] = mv.encore;
  return s;
}

function applyV2(s, who, mv) {
  if (!mv || typeof mv !== 'object') throw new Error('That move makes no sense.');
  if (s.r >= s.rounds.length) {
    if (s.enc && (s.enc.a === null || s.enc.b === null)) return applyEncore(s, who, mv);
    throw new Error('The game is over.');
  }
  const R = s.rounds[s.r];
  const kind = kindOf(s, R);
  if (s.phase === 'draw') {
    if (who !== R.drawer) throw new Error(mv.guess != null || mv.giveUp ? 'Wait for the drawing to arrive.' : 'It’s not your turn to draw.');
    if (!Number.isInteger(mv.prompt) || mv.prompt < 0 || mv.prompt > 2) throw new Error('Pick one of the three prompts.');
    if (s.mode === 'ladder' && mv.prompt !== R.tier) throw new Error('The ladder deals this card. Draw the one it picked.');
    if (mv.timeUp === true) {
      if (mv.strokes) throw new Error('A time-up round has no drawing.');
      R.pick = mv.prompt; R.tier = POOL_TIER[R.choices[R.pick]]; R.strokes = ''; R.timeUp = true;
      finishV2(s, 0);
      return s;
    }
    const err = drawingError(mv.strokes);
    if (err) throw new Error(err);
    if (kind === 'oneline' && mv.strokes.split('.').length !== 1) throw new Error('One line only: lift your finger just once.');
    R.pick = mv.prompt;
    R.tier = POOL_TIER[R.choices[R.pick]];
    R.strokes = mv.strokes;
    s.phase = 'guess';
    return s;
  }
  if (who === R.drawer) throw new Error('You drew this one. Your partner guesses.');
  const half = kind === 'halfhalf';
  if (mv.rest === true) {
    if (!half || R.rest || R.guesses.length) throw new Error('The rest of the drawing is already showing.');
    R.rest = true;
    return s;
  }
  if (mv.giveUp === true) { R.gaveUp = true; finishV2(s, 0); return s; }
  if (mv.guess != null && typeof mv.guess !== 'string') throw new Error('Type a guess.');
  const g = String(mv.guess || '').trim().replace(/\s+/g, ' ');
  if (!g) throw new Error('Type a guess first.');
  if (g.length > 40) throw new Error('Keep guesses under 40 letters.');
  if (!squash(g, true)) throw new Error('Guess with letters or numbers.');
  const same = (x) => squash(x) || squash(x, true);
  if (R.guesses.some((x) => same(x) === same(g))) throw new Error('You already tried that one.');
  const early = mv.early === true;
  if (early) {
    if (!half) throw new Error('Early calls are for Half & Half rounds.');
    if (R.rest || R.guesses.length) throw new Error('Too late for an early call. You have seen the rest.');
  } else if (half && !R.rest) R.rest = true;
  R.guesses.push(g);
  const hit = guessMatchesV2(g, POOL[R.choices[R.pick]]);
  if (early) {
    if (hit) { R.early = 'hit'; finishV2(s, EARLY[R.tier]); } else { R.early = 'miss'; R.rest = true; }
    return s;
  }
  const n = R.guesses.length - (R.early ? 1 : 0); // which normal guess this was (1, 2, 3)
  const pay = half ? STAKES[R.tier][n] : STAKES[R.tier][n - 1];
  if (hit) finishV2(s, pay);
  else if (n >= (half ? 2 : 3)) finishV2(s, 0);
  return s;
}
function resultV2(s) {
  const max = maxScore(s);
  const got = s.rounds.filter((R) => R.points > 0).length;
  return { winner: null, team: true, score: s.score, text: ratingOf2(s.score, max), sub: `${s.score} of ${max} points, ${got} of ${s.rounds.length} guessed. Your drawings are hanging in the gallery.` };
}

const KIT = {
  ROUNDS, DRAW_SECONDS, INK_CHARS, TIER_NAMES, POOL, tierOf: poolTier, encode, decode, charsOf, other,
  ratingOf, guessMatches, guessMatchesV2, nearMiss, halfSplit, halfPlan, STAKES, EARLY, kindOf, drawSecondsFor, maxScore, ratingOf2,
  dealFresh, POINTS, ROUNDS_V2,
};

// Fit overrides, appended after the base styles. The pick screen has to show all three cards without scrolling on
// a short landscape phone (844x390: the app chrome leaves the game about 220px), whatever font the phone falls back to.
// So there the Round / Team row and the Mixed Bag twist banner share one line, the cards tighten up, and the card word
// scales with the screen (clamp) instead of being a fixed size that wraps to three lines in a wider fallback font.
const FIT_CSS = `
    .g-doodle .dd-scr.land .dd-pickhead { flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 10px; }
    .g-doodle .dd-scr.land .dd-pickhead .dd-top { display: contents; }
    .g-doodle .dd-scr.land .dd-pickhead .dd-round { order: 0; }
    .g-doodle .dd-scr.land .dd-pickhead .dd-twist { order: 1; flex: 1 1 0; width: auto; min-width: 0; }
    .g-doodle .dd-scr.land .dd-pickhead .dd-team { order: 2; }
    .g-doodle .dd-scr.land .dd-pickhead .dd-rungs { order: 3; flex: 1 0 100%; }
    .g-doodle .dd-scr.land .dd-picks { gap: 10px; margin-top: 2px; }
    .g-doodle .dd-scr.land .dd-pick { min-height: 76px; padding: 6px 10px 8px; gap: 4px; }
    .g-doodle .dd-scr.land .dd-pick-main { gap: 2px; }
    .g-doodle .dd-scr.land .dd-pick-word { font-size: clamp(1rem, 2.6vw, 1.2rem); }
    .g-doodle .dd-scr.land .dd-pick-word.fm { font-size: clamp(0.95rem, 2.4vw, 1.08rem); }
    .g-doodle .dd-scr.land .dd-pick-word.fs { font-size: clamp(0.88rem, 2.1vw, 0.98rem); }
    .g-doodle .dd-scr.land .dd-tier { padding: 3px 0; }
`;

registerGame({
  id: 'doodle',
  title: 'Doodle',
  blurb: 'One draws, one guesses. Six rounds, one gallery.',
  kind: 'turns',
  team: true,
  secret: true,
  tags: ['silly'],
  platforms: ['phone', 'computer'],
  best: 'phone',
  minutes: 12,
  endDelay: 'manual',
  endLookLabel: 'See the gallery',
  howTo: [
    'Take turns drawing. Pick a card and sketch it before the timer runs out.',
    'Your partner watches it replay, then guesses. Fewer guesses, more points.',
    'Harder cards pay more. Try Half & Half, Ladder, Invisible Ink or Mixed Bag.',
    'Six rounds. Then admire your gallery.',
  ],

  // ── rules (pure, deterministic) ──
  init({ first, seed }) {
    const decks = TIERS.map((t, k) => shuffled(t.map((_, i) => OFFS[k] + i), `${seed}:doodle:${k}`));
    const rounds = [];
    for (let r = 0; r < ROUNDS; r++) {
      rounds.push({ drawer: r % 2 ? other(first) : first, choices: decks.map((d) => d[r]), pick: null, strokes: null, guesses: [], points: null, gaveUp: false });
    }
    return { first, seed, r: 0, phase: 'draw', score: 0, rounds };
  },
  next(s) {
    if (s.r >= (s.v === 2 ? s.rounds.length : ROUNDS)) return s.v === 2 && s.enc ? ['a', 'b'].filter((w) => s.enc[w] === null) : [];
    const d = s.rounds[s.r].drawer;
    return [s.phase === 'draw' ? d : other(d)];
  },
  apply(s, who, mv) {
    if (mv && typeof mv === 'object' && mv.setup !== undefined) return applySetup(s, who, mv.setup);
    if (s.v === 2) return applyV2(s, who, mv);
    if (s.r >= ROUNDS) throw new Error('The game is over.');
    if (!mv || typeof mv !== 'object') throw new Error('That move makes no sense.');
    const R = s.rounds[s.r];
    if (s.phase === 'draw') {
      if (who !== R.drawer) throw new Error(mv.guess != null || mv.giveUp ? 'Wait for the drawing to arrive.' : 'It’s not your turn to draw.');
      if (!Number.isInteger(mv.prompt) || mv.prompt < 0 || mv.prompt > 2) throw new Error('Pick one of the three prompts.');
      const err = drawingError(mv.strokes);
      if (err) throw new Error(err);
      R.pick = mv.prompt;
      R.strokes = mv.strokes;
      s.phase = 'guess';
      return s;
    }
    if (who === R.drawer) throw new Error('You drew this one. Your partner guesses.');
    if (mv.giveUp === true) { R.gaveUp = true; finishRound(s, 0); return s; }
    if (mv.guess != null && typeof mv.guess !== 'string') throw new Error('Type a guess.');
    const g = String(mv.guess || '').trim().replace(/\s+/g, ' ');
    if (!g) throw new Error('Type a guess first.');
    if (g.length > 40) throw new Error('Keep guesses under 40 letters.');
    if (!squash(g, true)) throw new Error('Guess with letters or numbers.');
    const same = (x) => squash(x) || squash(x, true);
    if (R.guesses.some((x) => same(x) === same(g))) throw new Error('You already tried that one.');
    R.guesses.push(g);
    if (guessMatches(g, PROMPTS[R.choices[R.pick]])) finishRound(s, POINTS[R.guesses.length - 1]);
    else if (R.guesses.length >= 3) finishRound(s, 0);
    return s;
  },
  result(s) {
    if (s.v === 2) return resultV2(s);
    const got = s.rounds.filter((R) => R.points > 0).length;
    return { winner: null, team: true, score: s.score, text: ratingOf(s.score), sub: `${s.score} of 18 points, ${got} of 6 guessed. Your drawings are hanging in the gallery.` };
  },

  // ── view (see doodle/view.js) ──
  css: CSS + FIT_CSS,
  mount(el, api) { return mountDoodle(el, api, KIT); },
});
