// Doodle: draw-and-guess, together. Six rounds, the drawer alternates.
// A drawing is one compact string: strokes joined by '.', each stroke is
//   [style][gap gap][x y t]…   (base64url; style = colour + 4*size, gap in 10 ms,
//   every point = 24 bits: x 0–255, y 0–255, dt in 8 ms units).
import { registerGame, shuffled } from './core.js';

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
function squash(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter((w) => w && !ARTICLES.has(w)).join('');
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
  const g = squash(guess);
  if (!g) return false;
  for (const alt of prompt.all) {
    const a = squash(alt);
    if (!a) continue;
    const fs = forms(a);
    if (fs.has(g)) return true;
    if (a.length >= 5 && g[0] === a[0]) for (const f of fs) if (oneEdit(f, g)) return true;
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

// ── view helpers ─────────────────────────────────────────────────────
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ICON = {
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7H4V2M4.5 6.5A8.5 8.5 0 1 1 3.6 14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5l8 7-8 7zM12 5l8 7-8 7z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  yes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  no: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
};
const PENCIL = `<svg class="dd-pencil" viewBox="0 0 220 90" aria-hidden="true">
  <path class="dd-pencil-line" d="M14 62c18-26 30-30 40-10s22 22 34-6 26-30 36-4 20 26 34 2 22-26 34-14 10 18 14 20"/>
  <g class="dd-pencil-body"><path d="M0 0l-9-26 14-5 9 26z" class="dd-pencil-wood"/><path d="M0 0l14-5-3 8z" class="dd-pencil-tip"/><path d="M-9-26l14-5 3 8-14 5z" class="dd-pencil-cap"/></g>
</svg>`;

// Timeline of a drawing for replay: per point absolute ms.
function timeline(strokes) {
  let t = 0;
  const T = strokes.map((st) => {
    t += Math.min(st.gap * 10, 900);
    return st.pts.map(([, , dt]) => (t += Math.min(dt * 8, 450)));
  });
  return { T, total: t };
}

// A square canvas in a 256×256 grid space.
class Paper {
  constructor(canvas, inks) { this.cv = canvas; this.g = canvas.getContext('2d'); this.inks = inks; this.size = 0; }
  fit(css) {
    const dpr = Math.min(3, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    this.size = css;
    this.cv.style.width = this.cv.style.height = `${css}px`;
    const px = Math.max(1, Math.round(css * dpr));
    if (this.cv.width !== px) { this.cv.width = px; this.cv.height = px; }
    this.reset();
  }
  reset() {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    const k = this.cv.width / 256;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.lineCap = 'round'; g.lineJoin = 'round';
  }
  pen(st) { const c = this.inks()[st.c]; this.g.strokeStyle = c; this.g.fillStyle = c; this.g.lineWidth = WIDTHS[st.s]; }
  dot(st) { const [x, y] = st.pts[0]; this.pen(st); const g = this.g; g.beginPath(); g.arc(x + 0.5, y + 0.5, WIDTHS[st.s] / 2, 0, Math.PI * 2); g.fill(); }
  // the curve piece that point k (k >= 1) completes
  seg(st, k) {
    const p = st.pts; const g = this.g;
    this.pen(st);
    g.beginPath();
    if (k === 1) { g.moveTo(p[0][0] + 0.5, p[0][1] + 0.5); g.lineTo((p[0][0] + p[1][0]) / 2 + 0.5, (p[0][1] + p[1][1]) / 2 + 0.5); }
    else {
      const a = p[k - 2]; const b = p[k - 1]; const c = p[k];
      g.moveTo((a[0] + b[0]) / 2 + 0.5, (a[1] + b[1]) / 2 + 0.5);
      g.quadraticCurveTo(b[0] + 0.5, b[1] + 0.5, (b[0] + c[0]) / 2 + 0.5, (b[1] + c[1]) / 2 + 0.5);
    }
    g.stroke();
  }
  tail(st) {
    const p = st.pts; const n = p.length;
    if (n === 1) { this.dot(st); return; }
    const g = this.g; this.pen(st);
    g.beginPath();
    g.moveTo((p[n - 2][0] + p[n - 1][0]) / 2 + 0.5, (p[n - 2][1] + p[n - 1][1]) / 2 + 0.5);
    g.lineTo(p[n - 1][0] + 0.5, p[n - 1][1] + 0.5);
    g.stroke();
  }
  stroke(st, n = st.pts.length, done = true) {
    const p = st.pts;
    if (!n) return;
    if (n === 1) { if (done) this.dot(st); return; }
    const g = this.g; this.pen(st);
    g.beginPath();
    g.moveTo(p[0][0] + 0.5, p[0][1] + 0.5);
    g.lineTo((p[0][0] + p[1][0]) / 2 + 0.5, (p[0][1] + p[1][1]) / 2 + 0.5);
    for (let k = 2; k < n; k++) g.quadraticCurveTo(p[k - 1][0] + 0.5, p[k - 1][1] + 0.5, (p[k - 1][0] + p[k][0]) / 2 + 0.5, (p[k - 1][1] + p[k][1]) / 2 + 0.5);
    if (done) g.lineTo(p[n - 1][0] + 0.5, p[n - 1][1] + 0.5);
    g.stroke();
  }
  all(strokes) { this.reset(); for (const st of strokes) this.stroke(st); }
}

// Plays a drawing back on a Paper, at real speed squeezed into `cap` ms.
function player(paper, strokes, { cap: capMs = REPLAY_CAP, onDone = () => {} } = {}) {
  const { T, total } = timeline(strokes);
  const k = total > capMs ? total / capMs : 1;
  let si = 0; let pi = 0; let raf = 0; let t0 = 0; let done = false;
  const finish = () => { if (done) return; done = true; cancelAnimationFrame(raf); onDone(); };
  const step = (now) => {
    if (!t0) t0 = now;
    const e = (now - t0) * k;
    while (si < strokes.length && T[si][pi] <= e) {
      const st = strokes[si];
      if (pi >= 1) paper.seg(st, pi);
      if (pi === st.pts.length - 1) { paper.tail(st); si++; pi = 0; } else pi++;
    }
    if (si >= strokes.length) finish(); else raf = requestAnimationFrame(step);
  };
  paper.reset();
  raf = requestAnimationFrame(step);
  return {
    get done() { return done; },
    skip() { cancelAnimationFrame(raf); si = strokes.length; pi = 0; paper.all(strokes); finish(); },
    stop() { cancelAnimationFrame(raf); done = true; },
    redraw() {
      paper.reset();
      for (let i = 0; i < Math.min(si, strokes.length); i++) paper.stroke(strokes[i]);
      if (si < strokes.length && pi > 0) paper.stroke(strokes[si], pi, false);
    },
  };
}

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
  endDelay: 2400,
  howTo: [
    'Take turns drawing. Pick one of three prompts and sketch it in 75 seconds.',
    'Your partner watches it replay, then gets three guesses.',
    '3 points on the first guess, 2 on the second, 1 on the third.',
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
    if (s.r >= ROUNDS) return [];
    const d = s.rounds[s.r].drawer;
    return [s.phase === 'draw' ? d : other(d)];
  },
  apply(s, who, mv) {
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
    if (R.guesses.some((x) => squash(x) === squash(g))) throw new Error('You already tried that one.');
    R.guesses.push(g);
    if (guessMatches(g, PROMPTS[R.choices[R.pick]])) finishRound(s, POINTS[R.guesses.length - 1]);
    else if (R.guesses.length >= 3) finishRound(s, 0);
    return s;
  },
  result(s) {
    const got = s.rounds.filter((R) => R.points > 0).length;
    return { winner: null, team: true, score: s.score, text: ratingOf(s.score), sub: `${s.score} of 18 points, ${got} of 6 guessed. Your drawings are hanging in the gallery.` };
  },

  // ── view ──
  css: `
    .g-doodle { position: absolute; inset: 0; color: var(--g-ink); -webkit-user-select: none; user-select: none; }
    .g-doodle .dd-scroll { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
    .g-doodle .dd-scr { width: 100%; max-width: 560px; min-height: 100%; margin: 0 auto; padding: 2px 2px 14px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .g-doodle .dd-top { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; }
    .g-doodle .dd-round { font-family: var(--g-font-display); font-weight: 900; font-size: 0.95rem; letter-spacing: 0.02em; text-transform: uppercase; }
    .g-doodle .dd-round i { font-style: normal; color: var(--g-muted); }
    .g-doodle .dd-team { display: inline-flex; align-items: baseline; gap: 5px; padding: 4px 11px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); font-weight: 800; font-size: 0.85rem; box-shadow: var(--g-shadow); white-space: nowrap; }
    .g-doodle .dd-team b { font-family: var(--g-font-display); font-size: 1.05rem; }
    .g-doodle .dd-h { font-family: var(--g-font-display); font-weight: 900; font-size: 1.45rem; line-height: 1.15; margin: 4px 0 0; text-align: center; }
    .g-doodle .dd-sub { margin: 0; color: var(--g-muted); font-weight: 700; text-align: center; font-size: 0.95rem; }
    .g-doodle .p-a { color: var(--p-a); } .g-doodle .p-b { color: var(--p-b); }
    .g-doodle b.p-a, .g-doodle b.p-b { font-weight: 900; }

    /* prompt cards */
    .g-doodle .dd-picks { width: 100%; display: flex; flex-direction: column; gap: 14px; margin-top: 6px; }
    .g-doodle .dd-pick { position: relative; display: flex; align-items: center; gap: 14px; width: 100%; min-height: 76px; padding: 14px 16px; text-align: left; background: var(--g-card); color: var(--g-ink); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow); touch-action: manipulation; transition: transform 0.12s ease; }
    .g-doodle .dd-pick:nth-child(1) { transform: rotate(-1.2deg); } .g-doodle .dd-pick:nth-child(2) { transform: rotate(0.8deg); } .g-doodle .dd-pick:nth-child(3) { transform: rotate(-0.5deg); }
    .g-doodle .dd-pick:active { transform: translate(2px, 2px); box-shadow: none; }
    .g-doodle .dd-pick-word { font-family: var(--g-font-display); font-weight: 900; font-size: 1.35rem; line-height: 1.1; flex: 1; }
    .g-doodle .dd-tier { flex: none; width: 64px; padding: 5px 0; text-align: center; font-weight: 900; font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; border: 2px solid var(--g-ink); border-radius: 6px; }
    .g-doodle .dd-tier.t0 { background: var(--g-card); } .g-doodle .dd-tier.t1 { background: var(--g-hl); color: var(--g-ink); } .g-doodle .dd-tier.t2 { background: var(--g-ink); color: var(--g-card); }
    .g-doodle .dd-pts { flex: none; font-weight: 800; color: var(--g-muted); font-size: 0.8rem; }

    /* paper */
    .g-doodle .dd-paper { position: relative; flex: none; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: calc(var(--g-radius) * 0.6); box-shadow: var(--g-shadow); overflow: hidden; }
    .g-doodle .dd-paper canvas { display: block; touch-action: none; }
    .g-doodle .dd-paper.can-draw canvas { cursor: crosshair; }
    .g-doodle .dd-ink { position: absolute; left: 8px; right: 8px; bottom: 6px; height: 5px; border-radius: 3px; background: var(--g-line); opacity: 0; transition: opacity 0.2s; pointer-events: none; }
    .g-doodle .dd-ink.on { opacity: 1; }
    .g-doodle .dd-ink i { display: block; height: 100%; width: 0; border-radius: 3px; background: var(--g-ink); }
    .g-doodle .dd-ink.low i { background: var(--g-bad); }
    .g-doodle .dd-over-btn { position: absolute; right: 8px; bottom: 8px; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 6px 12px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); color: var(--g-ink); font-weight: 800; font-size: 0.85rem; box-shadow: var(--g-shadow); touch-action: manipulation; }
    .g-doodle .dd-over-btn svg { width: 16px; height: 16px; }
    .g-doodle .dd-over-btn:active { transform: translate(2px, 2px); box-shadow: none; }

    /* top bar of the draw screen */
    .g-doodle .dd-word { font-family: var(--g-font-display); font-weight: 900; font-size: 1.15rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .g-doodle .dd-word small { display: block; font-family: var(--g-font-body); font-size: 0.72rem; font-weight: 800; color: var(--g-muted); text-transform: uppercase; letter-spacing: 0.06em; }
    .g-doodle .dd-timer { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px 4px 6px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); font-family: var(--g-font-display); font-weight: 900; font-variant-numeric: tabular-nums; font-size: 1.05rem; box-shadow: var(--g-shadow); }
    .g-doodle .dd-timer svg { width: 26px; height: 26px; transform: rotate(-90deg); }
    .g-doodle .dd-timer .dd-ring-bg { fill: none; stroke: var(--g-line); stroke-width: 5; }
    .g-doodle .dd-timer .dd-ring { fill: none; stroke: var(--g-ink); stroke-width: 5; stroke-linecap: butt; }
    .g-doodle .dd-timer.low { color: var(--g-bad); border-color: var(--g-bad); }
    .g-doodle .dd-timer.low .dd-ring { stroke: var(--g-bad); }
    .g-doodle .dd-timer.zero { animation: dd-shake 0.5s ease 2; }

    /* tools */
    .g-doodle .dd-tools { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .g-doodle .dd-group { display: flex; align-items: center; gap: 4px; }
    .g-doodle .dd-swatch, .g-doodle .dd-size, .g-doodle .dd-tool { position: relative; width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; touch-action: manipulation; color: var(--g-ink); }
    .g-doodle .dd-swatch i { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--g-ink); background: var(--ink); transition: transform 0.12s; }
    .g-doodle .dd-swatch[aria-checked="true"] i { transform: scale(1.18); box-shadow: 0 0 0 3px var(--g-bg), 0 0 0 5px var(--g-ink); }
    .g-doodle .dd-size i { border-radius: 50%; background: var(--g-ink); }
    .g-doodle .dd-size[data-s="0"] i { width: 7px; height: 7px; } .g-doodle .dd-size[data-s="1"] i { width: 17px; height: 17px; }
    .g-doodle .dd-size::before { content: ''; position: absolute; inset: 3px; border-radius: 50%; border: 2px solid transparent; }
    .g-doodle .dd-size[aria-checked="true"]::before { border-color: var(--g-ink); background: var(--g-hl); }
    .g-doodle .dd-size i { position: relative; }
    .g-doodle .dd-sep { width: 2px; height: 26px; background: var(--g-line); margin: 0 4px; border-radius: 1px; }
    .g-doodle .dd-tool { border-radius: 12px; border: 2px solid var(--g-ink); background: var(--g-card); box-shadow: var(--g-shadow); }
    .g-doodle .dd-tool svg { width: 22px; height: 22px; }
    .g-doodle .dd-tool:disabled { opacity: 0.35; box-shadow: none; }
    .g-doodle .dd-tool:not(:disabled):active { transform: translate(2px, 2px); box-shadow: none; }
    .g-doodle .dd-send { flex: 1; min-height: 48px; }
    .g-doodle .dd-actions { width: 100%; display: flex; gap: 8px; align-items: center; }
    .g-doodle .gm-btn:disabled { opacity: 0.4; }

    /* guessing */
    .g-doodle .dd-by { font-weight: 800; font-size: 0.95rem; flex: 1; min-width: 0; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .g-doodle .dd-blanks { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 12px; }
    .g-doodle .dd-blanks span { display: inline-flex; gap: 3px; }
    .g-doodle .dd-blanks i { width: 13px; height: 3px; border-radius: 2px; background: var(--g-ink); margin-top: 12px; }
    .g-doodle .dd-tries { width: 100%; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 34px; }
    .g-doodle .dd-pips { display: inline-flex; gap: 5px; margin-right: 2px; }
    .g-doodle .dd-pips i { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--g-ink); background: var(--g-card); }
    .g-doodle .dd-pips i.used { background: var(--g-ink); }
    .g-doodle .dd-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px 3px 6px; border: 2px solid var(--g-ink); border-radius: 999px; font-weight: 800; font-size: 0.85rem; background: var(--g-card); max-width: 100%; overflow: hidden; }
    .g-doodle .dd-chip svg { width: 15px; height: 15px; flex: none; }
    .g-doodle .dd-chip.no { color: var(--g-muted); text-decoration: line-through; text-decoration-thickness: 2px; }
    .g-doodle .dd-chip.no svg { color: var(--g-bad); }
    .g-doodle .dd-chip.yes { background: var(--g-good); color: var(--g-on-ink); }
    .g-doodle .dd-chip.new { animation: dd-pop 0.35s ease; }
    .g-doodle .dd-form { width: 100%; display: flex; gap: 8px; }
    .g-doodle .dd-input { flex: 1; min-width: 0; height: 52px; padding: 0 14px; font: inherit; font-size: 17px; font-weight: 800; color: var(--g-ink); background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 12px; outline: none; -webkit-user-select: text; user-select: text; }
    .g-doodle .dd-input:focus-visible { box-shadow: 0 0 0 3px var(--g-hl); }
    .g-doodle .dd-input:disabled { opacity: 0.5; }
    .g-doodle .dd-input.shake { animation: dd-shake 0.4s ease; border-color: var(--g-bad); }
    .g-doodle .dd-form .gm-btn { min-width: 92px; min-height: 52px; }
    .g-doodle .dd-giveup { align-self: center; min-height: 44px; padding: 8px 16px; font-weight: 800; color: var(--g-muted); text-decoration: underline; text-underline-offset: 3px; touch-action: manipulation; }
    .g-doodle .dd-giveup.armed { color: var(--g-bad); }

    /* stamps + results */
    .g-doodle .dd-stamp { position: absolute; left: 50%; top: 50%; padding: 6px 14px; border: 4px solid currentColor; border-radius: 8px; background: color-mix(in srgb, var(--g-card) 82%, transparent); font-family: var(--g-font-display); font-weight: 900; font-size: 2.3rem; line-height: 1.05; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; transform: translate(-50%, -50%) rotate(-9deg); pointer-events: none; }
    .g-doodle .dd-stamp.good { color: var(--g-good); } .g-doodle .dd-stamp.bad { color: var(--g-bad); }
    .g-doodle .dd-stamp.anim { animation: dd-stamp 0.42s cubic-bezier(.2,1.6,.4,1) both; }
    .g-doodle .dd-answer { text-align: center; display: flex; flex-direction: column; gap: 2px; }
    .g-doodle .dd-answer small { color: var(--g-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem; }
    .g-doodle .dd-answer b { font-family: var(--g-font-display); font-size: 1.6rem; font-weight: 900; line-height: 1.1; }
    .g-doodle .dd-glist { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
    .g-doodle .dd-next { width: 100%; min-height: 52px; font-size: 1.05rem; }
    .g-doodle .dd-note { margin: 0; color: var(--g-muted); font-weight: 700; text-align: center; font-size: 0.9rem; }
    .g-doodle .dd-card { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow); }
    .g-doodle .dd-card canvas { flex: none; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-card); }
    .g-doodle .dd-card-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-weight: 700; }
    .g-doodle .dd-card-txt b { font-family: var(--g-font-display); font-weight: 900; font-size: 1.1rem; }
    .g-doodle .dd-badge { flex: none; margin-left: auto; padding: 4px 10px; border: 2px solid var(--g-ink); border-radius: 8px; font-family: var(--g-font-display); font-weight: 900; background: var(--g-hl); color: var(--g-ink); }
    .g-doodle .dd-badge.zero { background: var(--g-card); color: var(--g-muted); }
    .g-doodle .dd-waiting { display: flex; flex-direction: column; align-items: center; gap: 6px; margin: auto 0; padding: 18px 0; }
    .g-doodle .dd-pencil { width: 220px; height: 90px; overflow: visible; }
    .g-doodle .dd-pencil-line { fill: none; stroke: var(--g-ink); stroke-width: 4; stroke-linecap: round; stroke-dasharray: 420; stroke-dashoffset: 420; animation: dd-scribble 2.6s ease-in-out infinite; }
    .g-doodle .dd-pencil-body { offset-path: path('M14 62c18-26 30-30 40-10s22 22 34-6 26-30 36-4 20 26 34 2 22-26 34-14 10 18 14 20'); offset-rotate: 0deg; animation: dd-pencil 2.6s ease-in-out infinite; }
    .g-doodle .dd-pencil-wood { fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 2.5; stroke-linejoin: round; }
    .g-doodle .dd-pencil-tip { fill: var(--g-ink); }
    .g-doodle .dd-pencil-cap { fill: var(--p-b); stroke: var(--g-ink); stroke-width: 2.5; stroke-linejoin: round; }
    .g-doodle .dd-wait-name { font-family: var(--g-font-display); font-weight: 900; font-size: 1.35rem; text-align: center; }
    .g-doodle .dd-live { width: 100%; display: flex; flex-direction: column; gap: 6px; }
    .g-doodle .dd-live-row { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 2px solid var(--g-ink); border-radius: 12px; background: var(--g-card); font-weight: 800; }
    .g-doodle .dd-live-row svg { width: 18px; height: 18px; flex: none; }
    .g-doodle .dd-live-row.no svg { color: var(--g-bad); } .g-doodle .dd-live-row.yes { background: var(--g-good); color: var(--g-on-ink); }
    .g-doodle .dd-live-row.new { animation: dd-pop 0.35s ease; }
    .g-doodle .dd-live-row small { margin-left: auto; color: var(--g-muted); font-weight: 800; }
    .g-doodle .dd-live-row.yes small { color: inherit; }
    .g-doodle .dd-dots { display: inline-flex; gap: 4px; }
    .g-doodle .dd-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--g-muted); animation: dd-blink 1.2s infinite; }
    .g-doodle .dd-dots i:nth-child(2) { animation-delay: 0.2s; } .g-doodle .dd-dots i:nth-child(3) { animation-delay: 0.4s; }

    /* gallery */
    .g-doodle .dd-gal-head { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 4px; }
    .g-doodle .dd-gal-kicker { font-weight: 900; font-size: 0.75rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); }
    .g-doodle .dd-plaque { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border: 2px solid var(--g-ink); border-radius: 10px; background: var(--g-hl); color: var(--g-ink); box-shadow: var(--g-shadow); }
    .g-doodle .dd-plaque b { font-family: var(--g-font-display); font-size: 2rem; font-weight: 900; line-height: 1; }
    .g-doodle .dd-plaque b small { font-size: 1rem; }
    .g-doodle .dd-plaque span { font-family: var(--g-font-display); font-weight: 900; font-size: 1.05rem; line-height: 1.1; max-width: 12em; }
    .g-doodle .dd-wall { width: 100%; display: grid; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); gap: 18px 14px; padding: 8px 4px 4px; }
    .g-doodle .dd-frame { display: flex; flex-direction: column; align-items: stretch; gap: 0; padding: 8px 8px 10px; text-align: left; background: var(--g-card); color: var(--g-ink); border: 2px solid var(--g-ink); border-radius: 6px; box-shadow: var(--g-shadow); touch-action: manipulation; transform: rotate(var(--tilt, 0deg)); transition: transform 0.15s ease; }
    .g-doodle .dd-frame:active { transform: rotate(0deg) translate(2px, 2px); box-shadow: none; }
    .g-doodle .dd-frame canvas { display: block; border: 2px solid var(--g-line); border-radius: 3px; background: var(--g-card); }
    .g-doodle .dd-frame-title { margin-top: 8px; font-family: var(--g-font-display); font-weight: 900; font-size: 1rem; line-height: 1.15; overflow-wrap: anywhere; }
    .g-doodle .dd-frame-meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 4px; font-size: 0.78rem; font-weight: 800; color: var(--g-muted); }
    .g-doodle .dd-frame-pts { padding: 1px 7px; border: 2px solid var(--g-ink); border-radius: 6px; color: var(--g-ink); background: var(--g-hl); font-family: var(--g-font-display); font-weight: 900; }
    .g-doodle .dd-frame-pts.zero { background: transparent; color: var(--g-muted); border-color: var(--g-line); }
    .g-doodle .dd-gal-actions { width: 100%; display: flex; gap: 8px; margin-top: 6px; }
    .g-doodle .dd-gal-actions .gm-btn { flex: 1; min-height: 50px; }
    .g-doodle .dd-gal-hint { margin: 0; color: var(--g-muted); font-weight: 700; font-size: 0.85rem; }

    /* lightbox */
    .g-doodle .dd-lb { position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; padding: 10px; background: color-mix(in srgb, var(--g-bg) 92%, transparent); overflow-y: auto; }
    .g-doodle .dd-lb-card { width: 100%; max-width: 460px; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow); }
    .g-doodle .dd-lb-card.anim { animation: dd-rise 0.25s ease both; }
    .g-doodle .dd-lb-top { width: 100%; display: flex; align-items: flex-start; gap: 8px; }
    .g-doodle .dd-lb-top .dd-answer { flex: 1; text-align: left; }
    .g-doodle .dd-lb .dd-paper { box-shadow: none; }

    @keyframes dd-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(3px); } }
    @keyframes dd-pop { 0% { transform: scale(0.6); opacity: 0; } 70% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
    @keyframes dd-stamp { 0% { transform: translate(-50%, -50%) rotate(-9deg) scale(2.4); opacity: 0; } 100% { transform: translate(-50%, -50%) rotate(-9deg) scale(1); opacity: 1; } }
    @keyframes dd-scribble { 0% { stroke-dashoffset: 420; } 70%, 100% { stroke-dashoffset: 0; } }
    @keyframes dd-pencil { 0% { offset-distance: 0%; } 70%, 100% { offset-distance: 100%; } }
    @keyframes dd-blink { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
    @keyframes dd-rise { from { transform: translateY(14px); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .g-doodle *, .g-doodle *::before { animation: none !important; transition: none !important; }
      .g-doodle .dd-pencil-line { stroke-dashoffset: 0; }
      .g-doodle .dd-pencil-body { offset-distance: 100%; }
    }
  `,

  mount(el, api) {
    el.innerHTML = '<div class="g-doodle"><div class="dd-scroll"></div><div class="dd-lb" hidden></div></div>';
    const root = el.firstChild;
    const scroller = root.querySelector('.dd-scroll');
    const lb = root.querySelector('.dd-lb');
    const nm = (w) => `<b class="p-${w}">${esc(api.name(w))}</b>`;
    let toks = api.tokens();
    const inks = () => [toks.ink, toks.a, toks.b, toks.good];
    const vs = { ack: {}, color: 0, size: 0, replayed: {}, galleryPlayed: false, wasOver: null, draft: null };
    let ctx = null;
    let scr = null;
    let lbClose = null;
    let lbRedraw = null;

    const top = (s, right = '') => `<div class="dd-top"><span class="dd-round">Round ${Math.min(s.r + 1, ROUNDS)}<i>/${ROUNDS}</i></span>${right}<span class="dd-team">Team <b>${s.score}</b></span></div>`;
    const blanks = (text) => `<div class="dd-blanks" aria-label="${text.replace(/[^a-z0-9 ]/gi, '').split(' ').filter(Boolean).map((w) => w.length).join(', ')} letters">${text.split(/\s+/).map((w) => `<span>${'<i></i>'.repeat(w.replace(/[^a-z0-9]/gi, '').length)}</span>`).join('')}</div>`;
    const promptOf = (R) => PROMPTS[R.choices[R.pick]];

    // Make a paper inside `host` that is sized to fit the screen.
    function makePaper(host, { draw = false } = {}) {
      const box = document.createElement('div');
      box.className = 'dd-paper' + (draw ? ' can-draw' : '');
      const cv = document.createElement('canvas');
      box.appendChild(cv);
      host.replaceWith(box);
      return { box, cv, paper: new Paper(cv, inks) };
    }
    function fitPaper(s) {
      if (!s || !s.p) return;
      const w = scroller.clientWidth - 8;
      s.el.style.minHeight = '0px';
      const others = s.el.offsetHeight - s.p.box.offsetHeight;
      s.el.style.minHeight = '';
      const avail = scroller.clientHeight - others - 4;
      const size = Math.floor(Math.max(170, Math.min(w, avail, 520)));
      if (Math.abs(size - s.p.paper.size) < 1) return;
      s.p.paper.fit(size);
      s.redraw && s.redraw();
    }

    function setScreen(key, build) {
      if (scr && scr.key === key) { scr.refresh && scr.refresh(ctx); return; }
      if (scr) { try { scr.destroy && scr.destroy(); } catch (e) { console.error(e); } }
      closeLightbox();
      scroller.innerHTML = '';
      const node = document.createElement('div');
      node.className = 'dd-scr';
      scroller.appendChild(node);
      scroller.scrollTop = 0;
      scr = build(node) || {};
      scr.key = key;
      scr.el = node;
      fitPaper(scr);
      scr.refresh && scr.refresh(ctx);
    }

    // ── screens ──
    function blank(node) { node.innerHTML = ''; return {}; }

    function pickScreen(node) {
      const s = ctx.state; const R = s.rounds[s.r];
      const guesser = other(R.drawer);
      node.innerHTML = `${top(s)}
        <h2 class="dd-h">Pick something to draw</h2>
        <p class="dd-sub">${nm(guesser)} has to guess it. You get ${DRAW_SECONDS} seconds.</p>
        <div class="dd-picks">${R.choices.map((pi, i) => `<button class="dd-pick" data-i="${i}">
          <span class="dd-tier t${tierOf(pi)}">${TIER_NAMES[tierOf(pi)]}</span>
          <span class="dd-pick-word">${esc(cap(PROMPTS[pi].show))}</span></button>`).join('')}</div>
        ${ctx.mode === 'local' ? `<p class="dd-note">${esc(api.name(guesser))}, no peeking.</p>` : ''}`;
      node.querySelector('.dd-picks').addEventListener('click', (e) => {
        const b = e.target.closest('.dd-pick');
        if (!b || !ctx.canMove) return;
        api.sfx('flip'); api.haptic(8);
        vs.draft = { r: s.r, pick: Number(b.dataset.i), strokes: [], hist: [], started: performance.now(), deadline: performance.now() + DRAW_SECONDS * 1000, lastEnd: performance.now(), sent: false };
        render();
      });
      return {};
    }

    function drawScreen(node) {
      const s = ctx.state; const R = s.rounds[s.r];
      const D = vs.draft;
      const word = PROMPTS[R.choices[D.pick]].show;
      node.innerHTML = `<div class="dd-top">
          <span class="dd-word"><small>Round ${s.r + 1} of ${ROUNDS} · draw</small>${esc(cap(word))}</span>
          <span class="dd-timer" role="timer" aria-label="Time left"><svg viewBox="0 0 26 26"><circle class="dd-ring-bg" cx="13" cy="13" r="9.5"/><circle class="dd-ring" cx="13" cy="13" r="9.5" stroke-dasharray="59.7" stroke-dashoffset="0"/></svg><span class="dd-secs">1:15</span></span>
        </div>
        <div class="dd-ph"></div>
        <div class="dd-tools">
          <div class="dd-group" role="radiogroup" aria-label="Ink">${['Ink', `${api.name('a')}’s colour`, `${api.name('b')}’s colour`, 'Green'].map((n, i) => `<button class="dd-swatch" role="radio" data-c="${i}" aria-label="${esc(n)}" aria-checked="${vs.color === i}" style="--ink:${INK_VARS[i]}"><i></i></button>`).join('')}</div>
          <div class="dd-group" role="radiogroup" aria-label="Brush"><button class="dd-size" role="radio" data-s="0" aria-label="Thin brush" aria-checked="${vs.size === 0}"><i></i></button><button class="dd-size" role="radio" data-s="1" aria-label="Thick brush" aria-checked="${vs.size === 1}"><i></i></button></div>
        </div>
        <div class="dd-actions">
          <button class="dd-tool" data-a="undo" aria-label="Undo">${ICON.undo}</button>
          <button class="dd-tool" data-a="clear" aria-label="Clear">${ICON.clear}</button>
          <button class="gm-btn dd-send">Send drawing</button>
        </div>`;
      const p = makePaper(node.querySelector('.dd-ph'), { draw: true });
      const ink = document.createElement('div');
      ink.className = 'dd-ink'; ink.innerHTML = '<i></i>';
      p.box.appendChild(ink);
      const cv = p.cv;
      const timerEl = node.querySelector('.dd-timer');
      const secsEl = node.querySelector('.dd-secs');
      const ring = node.querySelector('.dd-ring');
      let active = null;
      let lastSec = -1;
      let warnedInk = false;
      let autoTried = false;

      const used = () => charsOf(D.strokes) + (active ? 4 * active.st.pts.length + 4 : 0);
      const paintInk = () => {
        const f = used() / INK_CHARS;
        ink.classList.toggle('on', f > 0.45);
        ink.classList.toggle('low', f > 0.85);
        ink.firstChild.style.width = `${Math.min(100, f * 100)}%`;
      };
      const paintTools = () => {
        node.querySelector('[data-a="undo"]').disabled = !D.hist.length;
        node.querySelector('[data-a="clear"]').disabled = !D.strokes.length;
        node.querySelector('.dd-send').disabled = !D.strokes.length || !ctx.canMove;
        node.querySelectorAll('.dd-swatch').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.c) === vs.color)));
        node.querySelectorAll('.dd-size').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.s) === vs.size)));
        paintInk();
      };
      const send = (auto = false) => {
        if (D.sent || !ctx.canMove) return;
        if (active) endStroke();
        if (!D.strokes.length) { if (auto) api.toast('Time’s up! Draw anything and send it.'); return; }
        const res = api.move({ prompt: D.pick, strokes: encode(D.strokes) });
        if (res.ok) { D.sent = true; vs.draft = null; api.sfx('pop'); api.haptic(15); } else api.toast(res.error);
      };
      const tick = () => {
        const left = Math.max(0, D.deadline - performance.now());
        const sec = Math.ceil(left / 1000);
        if (sec !== lastSec) {
          lastSec = sec;
          secsEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
          timerEl.classList.toggle('low', sec <= 10);
          if (sec <= 5 && sec > 0) api.sfx('tick');
          if (sec === 0) { timerEl.classList.add('zero'); if (!autoTried) { autoTried = true; send(true); } }
        }
        ring.setAttribute('stroke-dashoffset', String(59.7 * (1 - left / (DRAW_SECONDS * 1000))));
      };

      const gridPt = (ev, rect) => {
        const x = Math.round(((ev.clientX - rect.left) / rect.width) * 256 - 0.5);
        const y = Math.round(((ev.clientY - rect.top) / rect.height) * 256 - 0.5);
        return [Math.max(0, Math.min(255, x)), Math.max(0, Math.min(255, y))];
      };
      const addPoint = (ev) => {
        const [x, y] = gridPt(ev, active.rect);
        const pts = active.st.pts;
        const now = ev.timeStamp || performance.now();
        if (pts.length) {
          const l = pts[pts.length - 1];
          const dx = x - l[0]; const dy = y - l[1];
          if (dx * dx + dy * dy < 3) return;
        }
        if (charsOf(D.strokes) + 1 + 3 + 4 * (pts.length + 1) > INK_CHARS) {
          if (!warnedInk) { warnedInk = true; api.toast('Out of ink! Send it as it is.'); api.sfx('bad'); }
          return;
        }
        const dt = pts.length ? Math.max(0, Math.min(255, Math.round((now - active.t) / 8))) : 0;
        active.t = now;
        pts.push([x, y, dt]);
        if (pts.length >= 2) p.paper.seg(active.st, pts.length - 1);
      };
      const endStroke = () => {
        const a = active; active = null;
        if (!a) return;
        if (a.st.pts.length) {
          p.paper.tail(a.st);
          D.strokes.push(a.st);
          D.hist.push({ k: 'stroke' });
          D.lastEnd = performance.now();
        }
        paintTools();
      };
      cv.addEventListener('pointerdown', (e) => {
        if (!ctx.canMove || D.sent || active) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        const now = performance.now();
        if (charsOf(D.strokes) + 8 > INK_CHARS) { if (!warnedInk) { warnedInk = true; api.toast('Out of ink! Send it as it is.'); } return; }
        active = { id: e.pointerId, rect: cv.getBoundingClientRect(), t: e.timeStamp || now, st: { c: vs.color, s: vs.size, gap: Math.min(4095, Math.round((now - D.lastEnd) / 10)), pts: [] } };
        addPoint(e);
      });
      cv.addEventListener('pointermove', (e) => {
        if (!active || e.pointerId !== active.id) return;
        e.preventDefault();
        const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        for (const ev of list.length ? list : [e]) addPoint(ev);
        paintInk();
      });
      const up = (e) => { if (active && e.pointerId === active.id) { e.preventDefault(); endStroke(); } };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
      cv.addEventListener('lostpointercapture', up);
      const stopTouch = (e) => e.preventDefault();
      cv.addEventListener('touchstart', stopTouch, { passive: false });
      cv.addEventListener('touchmove', stopTouch, { passive: false });
      cv.addEventListener('contextmenu', stopTouch);

      node.querySelector('.dd-tools').addEventListener('click', (e) => {
        const sw = e.target.closest('.dd-swatch'); const sz = e.target.closest('.dd-size');
        if (sw) { vs.color = Number(sw.dataset.c); api.sfx('tap'); }
        if (sz) { vs.size = Number(sz.dataset.s); api.sfx('tap'); }
        paintTools();
      });
      node.querySelector('[data-a="undo"]').addEventListener('click', () => {
        const h = D.hist.pop();
        if (!h) return;
        if (h.k === 'stroke') D.strokes.pop(); else D.strokes = h.prev;
        p.paper.all(D.strokes); api.sfx('flip'); paintTools();
      });
      node.querySelector('[data-a="clear"]').addEventListener('click', () => {
        if (!D.strokes.length) return;
        D.hist.push({ k: 'clear', prev: D.strokes }); D.strokes = [];
        p.paper.all(D.strokes); api.sfx('hit'); api.haptic(20); paintTools();
      });
      node.querySelector('.dd-send').addEventListener('click', () => send(false));
      paintTools();
      const timer = setInterval(tick, 200);
      tick();
      return {
        p,
        redraw() { p.paper.all(D.strokes); if (active) p.paper.stroke(active.st, active.st.pts.length, false); },
        refresh() { paintTools(); },
        destroy() { clearInterval(timer); },
      };
    }

    function guessScreen(node) {
      const s = ctx.state; const r = s.r; const R = s.rounds[r];
      const prompt = promptOf(R);
      const strokes = decode(R.strokes) || [];
      const prev = s.rounds[r - 1];
      const recap = prev && prev.drawer === ctx.viewer && ctx.mode === 'local'
        ? `<p class="dd-note">Last round ${esc(api.name(other(ctx.viewer)))} ${prev.points ? `got your ${esc(PROMPTS[prev.choices[prev.pick]].show)} (+${prev.points})` : `missed your ${esc(PROMPTS[prev.choices[prev.pick]].show)}`}.</p>` : '';
      node.innerHTML = `${top(s, `<span class="dd-by">by ${nm(R.drawer)}</span>`)}
        <div class="dd-ph"></div>
        ${blanks(prompt.show)}
        <div class="dd-tries"><span class="dd-pips" aria-label="Guesses used"></span><span class="dd-chips"></span></div>
        <form class="dd-form" autocomplete="off"><input class="dd-input" name="g" maxlength="40" placeholder="What is it?" aria-label="Your guess" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send"><button class="gm-btn" type="submit">Guess</button></form>
        <button class="dd-giveup" type="button">Give up</button>
        ${recap}`;
      const p = makePaper(node.querySelector('.dd-ph'));
      const btn = document.createElement('button');
      btn.className = 'dd-over-btn';
      p.box.appendChild(btn);
      const input = node.querySelector('.dd-input');
      const form = node.querySelector('.dd-form');
      const give = node.querySelector('.dd-giveup');
      let pl = null;
      let seen = R.guesses.length;
      let armT = 0;
      const setBtn = () => {
        if (pl && !pl.done) btn.innerHTML = `${ICON.skip}<span>Skip</span>`;
        else btn.innerHTML = `${ICON.replay}<span>Replay</span>`;
        btn.setAttribute('aria-label', pl && !pl.done ? 'Skip the replay' : 'Replay the drawing');
      };
      const play = () => { if (pl) pl.stop(); pl = player(p.paper, strokes, { onDone: () => { vs.replayed[r] = true; setBtn(); } }); setBtn(); };
      btn.addEventListener('click', () => { if (pl && !pl.done) pl.skip(); else play(); api.sfx('tap'); });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!ctx.canMove) return;
        const g = input.value.trim();
        if (!g) { input.focus(); return; }
        const res = api.move({ guess: g });
        if (!res.ok) { api.toast(res.error); api.sfx('bad'); return; }
        input.value = '';
      });
      give.addEventListener('click', () => {
        if (!ctx.canMove) return;
        if (!give.classList.contains('armed')) {
          give.classList.add('armed'); give.textContent = 'Really? Tap again to give up';
          clearTimeout(armT); armT = setTimeout(() => { give.classList.remove('armed'); give.textContent = 'Give up'; }, 3000);
          return;
        }
        const res = api.move({ giveUp: true });
        if (!res.ok) api.toast(res.error); else api.sfx('lose');
      });
      const refresh = () => {
        const RR = ctx.state.rounds[r];
        node.querySelector('.dd-pips').innerHTML = [0, 1, 2].map((i) => `<i class="${i < RR.guesses.length ? 'used' : ''}"></i>`).join('');
        node.querySelector('.dd-chips').innerHTML = RR.guesses.map((g, i) => `<span class="dd-chip no ${i >= seen ? 'new' : ''}">${ICON.no}${esc(g)}</span>`).join(' ');
        if (RR.guesses.length > seen) {
          api.sfx('bad'); api.haptic(30);
          input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
          seen = RR.guesses.length;
        }
        input.disabled = !ctx.canMove;
        form.querySelector('button').disabled = !ctx.canMove;
        give.disabled = !ctx.canMove;
        const left = 3 - RR.guesses.length;
        input.placeholder = left === 3 ? 'What is it?' : left === 1 ? 'Last guess…' : `${left} guesses left`;
      };
      return {
        p,
        redraw() { if (pl && !pl.done) pl.redraw(); else p.paper.all(strokes); },
        refresh,
        start() { if (reduced() || vs.replayed[r]) { p.paper.all(strokes); setBtn(); } else play(); },
        destroy() { if (pl) pl.stop(); clearTimeout(armT); },
      };
    }

    // The round that just ended, shown to the guesser (then they draw next) or to the drawer while they wait.
    function resultBlock(R, viewer) {
      const word = cap(promptOf(R).show);
      const guesser = other(R.drawer);
      const chips = R.guesses.map((g, i) => {
        const ok = R.points > 0 && i === R.guesses.length - 1;
        return `<span class="dd-chip ${ok ? 'yes' : 'no'}">${ok ? ICON.yes : ICON.no}${esc(g)}</span>`;
      }).join('');
      const line = R.points > 0
        ? (viewer === guesser ? `You got it on guess ${R.guesses.length}.` : `${esc(api.name(guesser))} got it on guess ${R.guesses.length}.`)
        : R.gaveUp ? (viewer === guesser ? 'You gave up on this one.' : `${esc(api.name(guesser))} gave up.`)
          : (viewer === guesser ? 'Three misses. So close.' : `${esc(api.name(guesser))} couldn’t get it.`);
      return { word, chips, line, stamp: R.points > 0 ? `<div class="dd-stamp good anim">+${R.points}</div>` : `<div class="dd-stamp bad anim">${R.gaveUp ? 'Pass' : 'Missed'}</div>` };
    }

    function revealScreen(node, ri, { next = false, waiting = false } = {}) {
      const s = ctx.state; const R = s.rounds[ri];
      const strokes = decode(R.strokes) || [];
      const b = resultBlock(R, ctx.viewer);
      const nextDrawer = s.rounds[s.r] ? s.rounds[s.r].drawer : null;
      node.innerHTML = `${top({ ...s, r: ri })}
        <div class="dd-ph"></div>
        <div class="dd-answer"><small>It was</small><b>${esc(b.word)}</b></div>
        <p class="dd-note">${b.line}</p>
        ${b.chips ? `<div class="dd-glist">${b.chips}</div>` : ''}
        ${next ? `<button class="gm-btn dd-next">${ctx.state.r >= ROUNDS ? 'See the gallery' : 'Your turn to draw'}</button>
          ${ctx.mode === 'local' && nextDrawer ? `<p class="dd-note">${esc(api.name(other(nextDrawer)))}, look away while ${esc(api.name(nextDrawer))} picks.</p>` : ''}` : ''}
        ${waiting ? `<div class="dd-waiting">${PENCIL}<div class="dd-wait-name">${nm(nextDrawer)} is drawing</div><p class="dd-sub">Your turn to guess is next.</p></div>` : ''}`;
      const p = makePaper(node.querySelector('.dd-ph'));
      p.box.insertAdjacentHTML('beforeend', reduced() ? b.stamp.replace(' anim', '') : b.stamp);
      if (next) node.querySelector('.dd-next').addEventListener('click', () => { vs.ack[ri] = true; api.sfx('tap'); render(); });
      if (R.points > 0) api.sfx('good'); else api.sfx('bad');
      return { p, redraw() { p.paper.all(strokes); } };
    }

    function waitDrawScreen(node) {
      const s = ctx.state; const R = s.rounds[s.r];
      const prev = s.rounds[s.r - 1];
      if (prev && prev.drawer === ctx.viewer) return revealScreen(node, s.r - 1, { waiting: true });
      node.innerHTML = `${top(s)}
        <div class="dd-waiting">${PENCIL}<div class="dd-wait-name">${nm(R.drawer)} is drawing something</div><p class="dd-sub">You’ll watch it replay, then get three guesses.</p></div>`;
      return {};
    }

    function watchScreen(node) {
      const s = ctx.state; const r = s.r; const R = s.rounds[r];
      const strokes = decode(R.strokes) || [];
      const guesser = other(R.drawer);
      node.innerHTML = `${top(s)}
        <div class="dd-ph"></div>
        <div class="dd-answer"><small>You drew</small><b>${esc(cap(promptOf(R).show))}</b></div>
        <div class="dd-live" aria-live="polite"></div>`;
      const p = makePaper(node.querySelector('.dd-ph'));
      let seen = R.guesses.length;
      const live = node.querySelector('.dd-live');
      return {
        p,
        redraw() { p.paper.all(strokes); },
        refresh() {
          const RR = ctx.state.rounds[r];
          live.innerHTML = RR.guesses.map((g, i) => `<div class="dd-live-row no ${i >= seen ? 'new' : ''}">${ICON.no}<span>${esc(g)}</span><small>Guess ${i + 1}</small></div>`).join('')
            + `<div class="dd-live-row"><span>${nm(guesser)} is guessing</span><span class="dd-dots"><i></i><i></i><i></i></span><small>${3 - RR.guesses.length} left</small></div>`;
          if (RR.guesses.length > seen) { api.sfx('flip'); seen = RR.guesses.length; }
        },
      };
    }

    function openLightbox(ri) {
      const s = ctx.state; const R = s.rounds[ri];
      const strokes = decode(R.strokes) || [];
      const b = resultBlock(R, null);
      lb.innerHTML = `<div class="dd-lb-card ${reduced() ? '' : 'anim'}" role="dialog" aria-label="${esc(b.word)}">
        <div class="dd-lb-top"><div class="dd-answer"><small>Round ${ri + 1} · by ${esc(api.name(R.drawer))}</small><b>${esc(b.word)}</b></div>
          <button class="dd-tool" data-a="close" aria-label="Close">${ICON.close}</button></div>
        <div class="dd-ph"></div>
        <p class="dd-note">${b.line}</p>
        ${b.chips ? `<div class="dd-glist">${b.chips}</div>` : ''}
      </div>`;
      lb.hidden = false;
      const p = makePaper(lb.querySelector('.dd-ph'));
      const size = Math.floor(Math.max(170, Math.min(lb.clientWidth - 52, 420, lb.clientHeight - 230)));
      p.paper.fit(size);
      const btn = document.createElement('button');
      btn.className = 'dd-over-btn';
      p.box.appendChild(btn);
      let pl = null;
      const setBtn = () => { btn.innerHTML = pl && !pl.done ? `${ICON.skip}<span>Skip</span>` : `${ICON.replay}<span>Replay</span>`; };
      const play = () => { if (pl) pl.stop(); pl = player(p.paper, strokes, { onDone: setBtn }); setBtn(); };
      btn.addEventListener('click', () => { if (pl && !pl.done) pl.skip(); else play(); });
      if (reduced()) { p.paper.all(strokes); setBtn(); } else play();
      lb.querySelector('[data-a="close"]').addEventListener('click', closeLightbox);
      lbClose = () => { if (pl) pl.stop(); };
      lbRedraw = () => { if (pl && !pl.done) pl.redraw(); else p.paper.all(strokes); };
      api.sfx('pop');
    }
    function closeLightbox() {
      if (lbClose) { lbClose(); lbClose = null; }
      lbRedraw = null;
      lb.hidden = true; lb.innerHTML = '';
    }
    lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });

    function galleryScreen(node) {
      const s = ctx.state;
      const got = s.rounds.filter((R) => R.points > 0).length;
      node.innerHTML = `<div class="dd-gal-head">
          <span class="dd-gal-kicker">The gallery</span>
          <div class="dd-plaque"><b>${s.score}<small>/18</small></b><span>${esc(ratingOf(s.score))}</span></div>
          <p class="dd-gal-hint">${got} of 6 guessed. Tap a drawing to watch it again.</p>
        </div>
        <div class="dd-wall">${s.rounds.map((R, i) => `<button class="dd-frame" data-i="${i}" style="--tilt:${[-1.6, 1.2, 0.9, -1.1, -0.7, 1.5][i]}deg" aria-label="Round ${i + 1}: ${esc(PROMPTS[R.choices[R.pick]].show)} by ${esc(api.name(R.drawer))}">
          <canvas></canvas>
          <span class="dd-frame-title">${esc(cap(PROMPTS[R.choices[R.pick]].show))}</span>
          <span class="dd-frame-meta"><span>by ${nm(R.drawer)}</span><span class="dd-frame-pts ${R.points ? '' : 'zero'}">${R.points ? `+${R.points}` : R.gaveUp ? 'pass' : 'missed'}</span></span>
        </button>`).join('')}</div>
        <div class="dd-gal-actions"><button class="gm-btn" data-g="rematch">Play again</button><button class="gm-btn gm-btn-ghost" data-g="close">Back to games</button></div>`;
      const frames = [...node.querySelectorAll('.dd-frame')];
      const papers = frames.map((f) => new Paper(f.querySelector('canvas'), inks));
      const drawings = s.rounds.map((R) => decode(R.strokes) || []);
      const players = papers.map(() => null);
      const waiting = papers.map(() => false);
      const layout = () => {
        const w = node.clientWidth;
        const cols = w >= 520 ? 3 : 2;
        node.querySelector('.dd-wall').style.setProperty('--cols', cols);
        const size = Math.floor((Math.min(w, 560) - 8 - 14 * (cols - 1)) / cols - 24);
        papers.forEach((pp, i) => {
          if (Math.abs(pp.size - size) < 1) return;
          pp.fit(size);
          if (waiting[i]) return;
          if (players[i] && !players[i].done) players[i].redraw(); else pp.all(drawings[i]);
        });
      };
      layout();
      // The six drawings sketch themselves once, as soon as the gallery is actually in view
      // (the end card sits on top of it at first).
      const timers = [];
      let mo = null;
      const playAll = () => {
        if (mo) { mo.disconnect(); mo = null; }
        papers.forEach((pp, i) => {
          timers.push(setTimeout(() => { waiting[i] = false; players[i] = player(pp, drawings[i], { cap: 2600 }); }, 250 + i * 260));
        });
      };
      if (!vs.galleryPlayed && !reduced()) {
        vs.galleryPlayed = true;
        papers.forEach((pp, i) => { waiting[i] = true; pp.reset(); });
        const end = el.closest('.gm') && el.closest('.gm').querySelector('.gm-end');
        if (!end || typeof MutationObserver !== 'function') playAll();
        else {
          let seen = !end.hidden;
          mo = new MutationObserver(() => {
            if (!end.hidden) seen = true;
            else if (seen) playAll();
          });
          mo.observe(end, { attributes: true, attributeFilter: ['hidden'] });
          timers.push(setTimeout(() => { if (mo && !seen) playAll(); }, 4500));
        }
      }
      node.querySelector('.dd-wall').addEventListener('click', (e) => {
        const f = e.target.closest('.dd-frame');
        if (f) openLightbox(Number(f.dataset.i));
      });
      const redraw = () => papers.forEach((pp, i) => {
        if (waiting[i]) return;
        if (players[i] && !players[i].done) players[i].redraw(); else pp.all(drawings[i]);
      });
      return { layout, redraw, destroy() { timers.forEach(clearTimeout); if (mo) mo.disconnect(); players.forEach((pl) => pl && pl.stop()); } };
    }

    // ── routing ──
    function render() {
      const c = ctx;
      if (!c) return;
      const s = c.state;
      const v = c.viewer;
      if (c.over) {
        const lastR = ROUNDS - 1;
        if (vs.wasOver === false && !vs.ack[lastR]) {
          // we watched the last guess land: show it first, then the gallery
          setScreen(`reveal:${lastR}`, (n) => revealScreen(n, lastR, { next: true }));
          return;
        }
        setScreen('gallery', galleryScreen);
        return;
      }
      if (!v) { setScreen('blank', blank); return; }
      const R = s.rounds[s.r];
      const prev = s.rounds[s.r - 1];
      if (s.phase === 'draw') {
        if (v === R.drawer) {
          if (prev && !vs.ack[s.r - 1]) { setScreen(`reveal:${s.r - 1}`, (n) => revealScreen(n, s.r - 1, { next: true })); return; }
          if (vs.draft && vs.draft.r === s.r && !vs.draft.sent) { setScreen(`draw:${s.r}`, drawScreen); return; }
          setScreen(`pick:${s.r}`, pickScreen);
          return;
        }
        setScreen(`wait:${s.r}`, waitDrawScreen);
        return;
      }
      if (v === R.drawer) setScreen(`watch:${s.r}`, watchScreen);
      else {
        const fresh = !scr || scr.key !== `guess:${s.r}`;
        setScreen(`guess:${s.r}`, guessScreen);
        if (fresh && scr.start) scr.start();
      }
    }

    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { fitPaper(scr); if (scr && scr.layout) scr.layout(); }) : null;
    if (ro) ro.observe(scroller);
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    const onTheme = () => {
      requestAnimationFrame(() => {
        toks = api.tokens();
        if (scr && scr.redraw) scr.redraw();
        if (lbRedraw) lbRedraw();
      });
    };
    if (mq && mq.addEventListener) mq.addEventListener('change', onTheme);
    const noGesture = (e) => e.preventDefault();
    root.addEventListener('gesturestart', noGesture);

    return {
      update(c) {
        ctx = c;
        toks = api.tokens();
        render();
        if (vs.wasOver === null || !c.over) vs.wasOver = c.over;
        if (c.over && scr && scr.key === `reveal:${ROUNDS - 1}`) {
          clearTimeout(vs.toGallery);
          vs.toGallery = setTimeout(() => { vs.ack[ROUNDS - 1] = true; render(); }, 2300);
        }
      },
      destroy() {
        clearTimeout(vs.toGallery);
        if (scr && scr.destroy) scr.destroy();
        closeLightbox();
        if (ro) ro.disconnect();
        if (mq && mq.removeEventListener) mq.removeEventListener('change', onTheme);
        root.removeEventListener('gesturestart', noGesture);
      },
    };
  },
});
