// Same Wave: a Wavelength-style mind-meld. One of you sees where the target hides on a
// spectrum and gives a clue; the other turns the dial. Eight rounds, the clue-giver alternates.
import { registerGame, shuffled, randInt } from './core.js';

const ROUNDS = 8;
const MAX = ROUNDS * 4;
const BANDS = [[17, 2], [10, 3], [4, 4]]; // half-width, points (widest first)
const pointsFor = (d) => (d <= 4 ? 4 : d <= 10 ? 3 : d <= 17 ? 2 : 0);
const LABEL = { 4: 'Bullseye', 3: 'So close', 2: 'Near enough', 0: 'Missed' };

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

// ── dial geometry (SVG user units) ──
const CX = 120; const CY = 128; const R = 108;
const pt = (v, r) => { const a = Math.PI * (v / 100); return [CX - r * Math.cos(a), CY - r * Math.sin(a)]; };
const f1 = (n) => Math.round(n * 10) / 10;
const FACE = `M${CX - R} ${CY}A${R} ${R} 0 0 1 ${CX + R} ${CY}Z`;
const wedge = (v1, v2, r) => {
  const a = pt(Math.max(0, v1), r); const b = pt(Math.min(100, v2), r);
  return `M${CX} ${CY}L${f1(a[0])} ${f1(a[1])}A${r} ${r} 0 0 1 ${f1(b[0])} ${f1(b[1])}Z`;
};
const NEEDLE = `M${CX - 7.5} ${CY}L${CX - 2.6} ${CY - R + 20}Q${CX} ${CY - R + 11} ${CX + 2.6} ${CY - R + 20}L${CX + 7.5} ${CY}Z`;
const TICKS = (() => {
  let s = '';
  for (let v = 0; v <= 100; v += 5) {
    const major = v % 25 === 0;
    const [x1, y1] = pt(v, R - 3); const [x2, y2] = pt(v, R - (major ? 15 : 9));
    s += `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" class="wv-tick${major ? ' major' : ''}"/>`;
  }
  return s;
})();

const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOutBack = (k) => { const c = 1.5; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
let uid = 0;

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
  endDelay: 3000,
  howTo: [
    'The clue-giver sees a hidden target on a spectrum, like Cold to Hot.',
    'They type a short clue that lands right there.',
    'The other turns the dial to where the clue belongs and locks it in.',
    'Bullseye 4, close 3, near 2. Eight rounds, 32 points to chase.',
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
    if (s.r >= ROUNDS) throw new Error('The game is over.');
    if (!mv || typeof mv !== 'object') throw new Error('That move makes no sense.');
    const Rd = s.rounds[s.r];
    if (s.phase === 'clue') {
      if (who !== Rd.giver) throw new Error('It’s not your turn to give the clue.');
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
    const bulls = s.rounds.filter((x) => x.points === 4).length;
    return { winner: null, team: true, score: s.score, text: ratingOf(s.score), sub: `${s.score} of ${MAX} points${bulls ? `, ${bulls} bullseye${bulls > 1 ? 's' : ''}` : ''}.` };
  },

  // ── view ──
  css: `
    .g-wave { position: absolute; inset: 0; color: var(--g-ink); -webkit-user-select: none; user-select: none; }
    .g-wave .wv-scroll { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
    .g-wave .wv-scr { width: 100%; max-width: 540px; min-height: 100%; margin: 0 auto; padding: 2px 2px 14px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .g-wave .wv-top { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; }
    .g-wave .wv-round { font-family: var(--g-font-display); font-weight: 900; font-size: 0.95rem; letter-spacing: 0.02em; text-transform: uppercase; }
    .g-wave .wv-round i { font-style: normal; color: var(--g-muted); }
    .g-wave .wv-team { display: inline-flex; align-items: baseline; gap: 5px; padding: 4px 11px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); font-weight: 800; font-size: 0.85rem; box-shadow: var(--g-shadow); white-space: nowrap; }
    .g-wave .wv-team b { font-family: var(--g-font-display); font-size: 1.05rem; }
    .g-wave .wv-h { font-family: var(--g-font-display); font-weight: 900; font-size: 1.4rem; line-height: 1.15; margin: 0; text-align: center; }
    .g-wave .wv-sub { margin: -4px 0 0; color: var(--g-muted); font-weight: 700; text-align: center; font-size: 0.93rem; }
    .g-wave .p-a { color: var(--p-a); } .g-wave .p-b { color: var(--p-b); }
    .g-wave b.p-a, .g-wave b.p-b { font-weight: 900; }

    /* the dial */
    .g-wave .wv-dialbox { width: 100%; max-width: 480px; display: flex; flex-direction: column; align-items: stretch; }
    .g-wave .wv-dial { position: relative; width: 100%; touch-action: none; outline: none; border-radius: 12px; }
    .g-wave .wv-dial.live { cursor: grab; }
    .g-wave .wv-dial.live.drag { cursor: grabbing; }
    .g-wave .wv-dial:focus-visible { box-shadow: 0 0 0 3px var(--g-hl); }
    .g-wave .wv-svg { display: block; width: 100%; height: auto; overflow: visible; }
    .g-wave .wv-shadow, .g-wave .wv-plinth-shadow { fill: var(--g-ink); }
    .g-wave .wv-face { fill: var(--g-card); }
    .g-wave .wv-rim { fill: none; stroke: var(--g-ink); stroke-width: 2.5; stroke-linejoin: round; }
    .g-wave .wv-tick { stroke: var(--g-ink); stroke-width: 1.6; stroke-linecap: round; }
    .g-wave .wv-tick.major { stroke-width: 2.6; }
    .g-wave .wv-b2 { fill: color-mix(in srgb, var(--g-hl) 38%, var(--g-card)); }
    .g-wave .wv-b3 { fill: color-mix(in srgb, var(--g-hl) 70%, var(--g-card)); }
    .g-wave .wv-b4 { fill: var(--g-hl); }
    .g-wave .wv-zone path { stroke: var(--g-ink); stroke-width: 1.5; stroke-linejoin: round; }
    .g-wave .wv-zone text { font-family: var(--g-font-display); font-weight: 900; font-size: 13px; fill: var(--g-ink); text-anchor: middle; dominant-baseline: central; }
    .g-wave .wv-lid-face { fill: var(--g-card); }
    .g-wave .wv-hatch { stroke: var(--g-line); stroke-width: 2.4; }
    .g-wave .wv-lid-q { font-family: var(--g-font-display); font-weight: 900; font-size: 15px; fill: var(--g-muted); text-anchor: middle; letter-spacing: 0.12em; }
    .g-wave .wv-needle { stroke: var(--g-ink); stroke-width: 2.4; stroke-linejoin: round; }
    .g-wave .wv-needle.a { fill: var(--p-a); } .g-wave .wv-needle.b { fill: var(--p-b); }
    .g-wave .wv-needle-shadow { fill: var(--g-ink); }
    .g-wave .wv-hub { fill: var(--g-ink); }
    .g-wave .wv-hub-dot { fill: var(--g-card); }
    .g-wave .wv-plinth { fill: var(--g-ink); }
    .g-wave .wv-ghost { fill: none; stroke: var(--g-muted); stroke-width: 2; stroke-dasharray: 4 4; }

    /* spectrum card */
    .g-wave .wv-card { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr 1fr; margin: -6px 6px 0; border: 2px solid var(--g-ink); border-radius: 10px; overflow: hidden; box-shadow: var(--g-shadow); }
    .g-wave .wv-end { display: flex; align-items: center; gap: 6px; min-height: 52px; padding: 8px 10px; font-family: var(--g-font-display); font-weight: 900; font-size: 1.02rem; line-height: 1.12; }
    .g-wave .wv-end.l { background: var(--g-card); color: var(--g-ink); }
    .g-wave .wv-end.r { background: var(--g-ink); color: var(--g-card); justify-content: flex-end; text-align: right; }
    .g-wave .wv-end svg { width: 16px; height: 16px; flex: none; }

    /* clue */
    .g-wave .wv-clue { position: relative; max-width: 100%; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 18px 10px; border: 2px solid var(--g-ink); border-radius: 14px; background: var(--g-card); box-shadow: var(--g-shadow); text-align: center; }
    .g-wave .wv-clue::after { content: ''; position: absolute; left: 50%; bottom: -9px; width: 14px; height: 14px; background: var(--g-card); border-right: 2px solid var(--g-ink); border-bottom: 2px solid var(--g-ink); transform: translateX(-50%) rotate(45deg); }
    .g-wave .wv-clue small { font-weight: 800; font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--g-muted); }
    .g-wave .wv-clue b { font-family: var(--g-font-display); font-weight: 900; font-size: 1.5rem; line-height: 1.15; overflow-wrap: anywhere; }
    .g-wave .wv-clue.anim { animation: wv-pop 0.35s ease both; }
    .g-wave .wv-form { width: 100%; display: flex; gap: 8px; }
    .g-wave .wv-input { flex: 1; min-width: 0; height: 52px; padding: 0 14px; font: inherit; font-size: 17px; font-weight: 800; color: var(--g-ink); background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 12px; outline: none; -webkit-user-select: text; user-select: text; }
    .g-wave .wv-input:focus-visible { box-shadow: 0 0 0 3px var(--g-hl); }
    .g-wave .wv-count { align-self: flex-end; margin-top: -8px; font-size: 0.75rem; font-weight: 800; color: var(--g-muted); font-variant-numeric: tabular-nums; }
    .g-wave .wv-form .gm-btn { min-width: 88px; min-height: 52px; }
    .g-wave .gm-btn:disabled { opacity: 0.4; }
    .g-wave .wv-go { width: 100%; min-height: 54px; font-size: 1.08rem; }
    .g-wave .wv-note { margin: 0; color: var(--g-muted); font-weight: 700; text-align: center; font-size: 0.9rem; }
    .g-wave .wv-secret { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border: 2px dashed var(--g-ink); border-radius: 999px; font-size: 0.78rem; font-weight: 800; }

    /* reveal */
    .g-wave .wv-result { display: flex; align-items: center; gap: 12px; }
    .g-wave .wv-pts { display: grid; place-items: center; min-width: 64px; height: 56px; padding: 0 10px; border: 2px solid var(--g-ink); border-radius: 10px; background: var(--g-hl); color: var(--g-ink); box-shadow: var(--g-shadow); font-family: var(--g-font-display); font-weight: 900; font-size: 1.8rem; transform: rotate(-4deg); }
    .g-wave .wv-pts.zero { background: var(--g-card); color: var(--g-bad); }
    .g-wave .wv-result-txt { display: flex; flex-direction: column; font-weight: 800; }
    .g-wave .wv-result-txt b { font-family: var(--g-font-display); font-size: 1.3rem; font-weight: 900; }
    .g-wave .wv-result-txt span { color: var(--g-muted); font-size: 0.85rem; }
    .g-wave .wv-result.hide { visibility: hidden; }
    .g-wave .wv-result.anim .wv-pts { animation: wv-stamp 0.4s cubic-bezier(.2,1.6,.4,1) both; }
    .g-wave .wv-wait { display: flex; align-items: center; gap: 10px; font-weight: 800; color: var(--g-muted); }
    .g-wave .wv-dots { display: inline-flex; gap: 4px; }
    .g-wave .wv-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--g-muted); animation: wv-blink 1.2s infinite; }
    .g-wave .wv-dots i:nth-child(2) { animation-delay: 0.2s; } .g-wave .wv-dots i:nth-child(3) { animation-delay: 0.4s; }
    .g-wave .wv-last { width: 100%; display: flex; align-items: center; gap: 10px; padding: 6px 10px; border: 2px solid var(--g-line); border-radius: 10px; font-size: 0.85rem; font-weight: 700; color: var(--g-muted); }
    .g-wave .wv-last b { color: var(--g-ink); }

    /* recap */
    .g-wave .wv-rhead { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .g-wave .wv-kicker { font-weight: 900; font-size: 0.75rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); }
    .g-wave .wv-plaque { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border: 2px solid var(--g-ink); border-radius: 10px; background: var(--g-hl); color: var(--g-ink); box-shadow: var(--g-shadow); }
    .g-wave .wv-plaque b { font-family: var(--g-font-display); font-size: 2rem; font-weight: 900; line-height: 1; }
    .g-wave .wv-plaque b small { font-size: 1rem; }
    .g-wave .wv-plaque span { font-family: var(--g-font-display); font-weight: 900; font-size: 1.1rem; line-height: 1.1; max-width: 11em; }
    .g-wave .wv-meter { width: 100%; max-width: 360px; display: grid; grid-template-columns: repeat(${MAX}, 1fr); gap: 2px; }
    .g-wave .wv-meter i { height: 10px; border: 1.5px solid var(--g-ink); border-radius: 2px; background: var(--g-card); }
    .g-wave .wv-meter i.on { background: var(--g-ink); }
    .g-wave .wv-rows { width: 100%; display: flex; flex-direction: column; gap: 10px; }
    .g-wave .wv-row { display: grid; grid-template-columns: 1fr auto; gap: 6px 10px; align-items: center; padding: 10px 12px; border: 2px solid var(--g-ink); border-radius: 12px; background: var(--g-card); box-shadow: var(--g-shadow); }
    .g-wave .wv-row.anim { animation: wv-rise 0.3s ease both; }
    .g-wave .wv-row-card { font-weight: 800; font-size: 0.82rem; color: var(--g-muted); }
    .g-wave .wv-row-clue { font-family: var(--g-font-display); font-weight: 900; font-size: 1.1rem; line-height: 1.15; overflow-wrap: anywhere; }
    .g-wave .wv-row-clue small { font-family: var(--g-font-body); font-weight: 800; font-size: 0.78rem; }
    .g-wave .wv-row .wv-mini { grid-column: 1 / -1; }
    .g-wave .wv-row-pts { grid-row: 1 / span 2; grid-column: 2; display: grid; place-items: center; min-width: 46px; height: 40px; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-hl); color: var(--g-ink); font-family: var(--g-font-display); font-weight: 900; font-size: 1.2rem; }
    .g-wave .wv-row-pts.zero { background: var(--g-card); color: var(--g-muted); border-color: var(--g-line); }
    .g-wave .wv-mini { position: relative; height: 16px; margin: 4px 0 6px; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-bg); }
    .g-wave .wv-mini > span { position: absolute; top: 0; bottom: 0; }
    .g-wave .wv-mini .z2 { background: color-mix(in srgb, var(--g-hl) 38%, var(--g-card)); }
    .g-wave .wv-mini .z3 { background: color-mix(in srgb, var(--g-hl) 70%, var(--g-card)); }
    .g-wave .wv-mini .z4 { background: var(--g-hl); }
    .g-wave .wv-mini .pin { top: -6px; bottom: -6px; width: 6px; margin-left: -3px; border: 2px solid var(--g-ink); border-radius: 3px; }
    .g-wave .wv-mini .pin.a { background: var(--p-a); } .g-wave .wv-mini .pin.b { background: var(--p-b); }
    .g-wave .wv-actions { width: 100%; display: flex; gap: 8px; }
    .g-wave .wv-actions .gm-btn { flex: 1; min-height: 50px; }

    @keyframes wv-pop { 0% { transform: scale(0.7); opacity: 0; } 70% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); } }
    @keyframes wv-stamp { 0% { transform: rotate(-4deg) scale(2.2); opacity: 0; } 100% { transform: rotate(-4deg) scale(1); opacity: 1; } }
    @keyframes wv-blink { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
    @keyframes wv-rise { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .g-wave *, .g-wave *::after { animation: none !important; transition: none !important; }
    }
  `,

  mount(el, api) {
    el.innerHTML = '<div class="g-wave"><div class="wv-scroll"></div></div>';
    const root = el.firstChild;
    const scroller = root.querySelector('.wv-scroll');
    const nm = (w) => `<b class="p-${w}">${esc(api.name(w))}</b>`;
    const label = (t) => esc(t.replace('{a}', api.name('a')).replace('{b}', api.name('b')));
    const vs = { ack: {}, wasOver: null, toRecap: 0, recapAnimated: false };
    let ctx = null;
    let scr = null;
    const rafs = new Set();

    function animate(ms, fn, done) {
      if (reduced()) { fn(1); if (done) done(); return; }
      const t0 = performance.now();
      const step = (now) => {
        rafs.delete(id);
        const k = Math.min(1, (now - t0) / ms);
        fn(k);
        if (k < 1) { id = requestAnimationFrame(step); rafs.add(id); } else if (done) done();
      };
      let id = requestAnimationFrame(step);
      rafs.add(id);
    }

    const top = (s, ri = s.r) => `<div class="wv-top"><span class="wv-round">Round ${Math.min(ri + 1, ROUNDS)} <i>of ${ROUNDS}</i></span><span class="wv-team">Team <b>${s.score}</b></span></div>`;
    const ARROW_L = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const ARROW_R = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const cardHTML = (c) => `<div class="wv-card"><div class="wv-end l">${ARROW_L}<span>${label(CARDS[c][0])}</span></div><div class="wv-end r"><span>${label(CARDS[c][1])}</span>${ARROW_R}</div></div>`;

    // Build a dial. zone: target (only when the viewer may see it). lid: the hiding screen.
    // needle: { at, who } or null.
    function dial(host, { card, zone = null, lid = false, needle = null, ghost = false }) {
      const id = `wv${++uid}`;
      const zoneSvg = zone == null ? '' : `<g class="wv-zone" clip-path="url(#${id}c)">${BANDS.map(([, p]) => `<path class="wv-b${p}" d=""/>`).join('')}${[2, 3, 4, 3, 2].map(() => '<text></text>').join('')}</g>`;
      const needleSvg = needle ? `<g transform="translate(3 3)"><g class="wv-rot"><path class="wv-needle-shadow" d="${NEEDLE}"/></g></g>
        <g class="wv-rot"><path class="wv-needle ${needle.who}" d="${NEEDLE}"/></g>` : '';
      host.innerHTML = `<div class="wv-dialbox"><div class="wv-dial" aria-label="Dial"><svg class="wv-svg" viewBox="0 -4 240 156" aria-hidden="true">
        <defs><clipPath id="${id}c"><path d="${FACE}"/></clipPath>
          <pattern id="${id}h" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><line x1="0" y1="0" x2="0" y2="8" class="wv-hatch"/></pattern></defs>
        <path class="wv-shadow" d="${FACE}" transform="translate(4 4)"/>
        <rect class="wv-plinth-shadow" x="8" y="${CY + 2}" width="232" height="16" rx="4"/>
        <path class="wv-face" d="${FACE}"/>
        ${zoneSvg}
        ${lid ? `<g clip-path="url(#${id}c)"><g class="wv-lid"><path class="wv-lid-face" d="${FACE}"/><path d="${FACE}" fill="url(#${id}h)"/><text class="wv-lid-q" x="${CX}" y="${CY - 44}">HIDDEN</text></g></g>` : ''}
        ${ghost ? `<path class="wv-ghost" d="M${CX} ${CY}L${CX} ${CY - R + 14}"/>` : ''}
        ${TICKS}
        <path class="wv-rim" d="${FACE}"/>
        ${needleSvg}
        <circle class="wv-hub" cx="${CX}" cy="${CY}" r="13"/><circle class="wv-hub-dot" cx="${CX}" cy="${CY}" r="4.5"/>
        <rect class="wv-plinth" x="4" y="${CY - 1}" width="232" height="16" rx="4"/>
      </svg></div>${cardHTML(card)}</div>`;
      const box = host.firstChild;
      const d = box.querySelector('.wv-dial');
      const svg = box.querySelector('svg');
      const rots = [...box.querySelectorAll('.wv-rot')];
      const lidEl = box.querySelector('.wv-lid');
      const setNeedle = (v) => { const a = f1((v - 50) * 1.8); rots.forEach((g) => g.setAttribute('transform', `rotate(${a} ${CX} ${CY})`)); };
      const setZone = (k) => {
        if (zone == null) return;
        const paths = box.querySelectorAll('.wv-zone path');
        BANDS.forEach(([w], i) => paths[i].setAttribute('d', wedge(zone - w * k, zone + w * k, R - 1)));
        const texts = box.querySelectorAll('.wv-zone text');
        [[-13.5, 2], [-7, 3], [0, 4], [7, 3], [13.5, 2]].forEach(([o, p], i) => {
          const v = zone + o * k;
          const tx = texts[i];
          if (v < 1.5 || v > 98.5 || k < 0.6) { tx.textContent = ''; return; }
          const [x, y] = pt(v, R - 26);
          tx.setAttribute('x', f1(x)); tx.setAttribute('y', f1(y)); tx.textContent = p;
        });
      };
      const setLid = (deg) => { if (lidEl) lidEl.setAttribute('transform', `rotate(${f1(deg)} ${CX} ${CY})`); };
      if (needle) setNeedle(needle.at);
      setZone(1);
      return { box, d, svg, setNeedle, setZone, setLid };
    }

    function setScreen(key, build) {
      if (scr && scr.key === key) { scr.refresh && scr.refresh(); return; }
      if (scr && scr.destroy) { try { scr.destroy(); } catch (e) { console.error(e); } }
      scroller.innerHTML = '';
      const node = document.createElement('div');
      node.className = 'wv-scr';
      scroller.appendChild(node);
      scroller.scrollTop = 0;
      scr = build(node) || {};
      scr.key = key;
      scr.refresh && scr.refresh();
    }

    // ── screens ──
    function clueScreen(node) {
      const s = ctx.state; const Rd = s.rounds[s.r];
      const guesser = other(Rd.giver);
      node.innerHTML = `${top(s)}
        <h2 class="wv-h">Give a clue</h2>
        <p class="wv-sub">Where the bright band sits, your clue should land.</p>
        <div class="wv-host"></div>
        <form class="wv-form" autocomplete="off"><input class="wv-input" maxlength="40" placeholder="Your clue" aria-label="Your clue" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send"><button class="gm-btn" type="submit" disabled>Send</button></form>
        <span class="wv-count">0 / 40</span>
        <span class="wv-secret">Only you can see the target${ctx.mode === 'local' ? `. ${esc(api.name(guesser))}, look away` : ''}</span>`;
      dial(node.querySelector('.wv-host'), { card: Rd.card, zone: Rd.target, ghost: false });
      const input = node.querySelector('.wv-input');
      const btn = node.querySelector('.wv-form .gm-btn');
      const count = node.querySelector('.wv-count');
      input.addEventListener('input', () => { btn.disabled = !input.value.trim(); count.textContent = `${input.value.length} / 40`; });
      node.querySelector('.wv-form').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!ctx.canMove) return;
        const clue = input.value.trim();
        if (!clue) { api.toast('Write a clue first.'); input.focus(); return; }
        const res = api.move({ clue });
        if (res.ok) { api.sfx('pop'); api.haptic(12); } else { api.toast(res.error); api.sfx('bad'); }
      });
      return {};
    }

    function clueBubble(Rd, anim = false) {
      return `<div class="wv-clue ${anim && !reduced() ? 'anim' : ''}"><small>${esc(api.name(Rd.giver))}’s clue</small><b>“${esc(Rd.clue)}”</b></div>`;
    }

    function lastLine(s, ri) {
      const P = s.rounds[ri];
      if (!P || P.points == null) return '';
      return `<div class="wv-last"><span>Last round</span><b>“${esc(P.clue)}”</b><span style="margin-left:auto">${P.points ? `+${P.points}` : 'missed'}</span></div>`;
    }

    function guessScreen(node) {
      const s = ctx.state; const r = s.r; const Rd = s.rounds[r];
      const me = other(Rd.giver);
      node.innerHTML = `${top(s)}
        ${clueBubble(Rd, true)}
        <div class="wv-host"></div>
        <button class="gm-btn wv-go">Lock it in</button>
        <p class="wv-note">Drag the needle to where the clue belongs.</p>
        ${ctx.mode === 'online' ? lastLine(s, r - 1) : ''}`;
      let value = 50; let shown = 50;
      const D = dial(node.querySelector('.wv-host'), { card: Rd.card, lid: true, needle: { at: value, who: me } });
      const dEl = D.d;
      dEl.classList.add('live');
      dEl.tabIndex = 0;
      dEl.setAttribute('role', 'slider');
      dEl.setAttribute('aria-valuemin', '0');
      dEl.setAttribute('aria-valuemax', '100');
      dEl.setAttribute('aria-label', `Dial from ${label(CARDS[Rd.card][0])} to ${label(CARDS[Rd.card][1])}`);
      let raf = 0; let lastTick = 0; let lastStep = Math.round(value / 2); let dragging = null;
      const paintAria = () => { dEl.setAttribute('aria-valuenow', String(value)); dEl.setAttribute('aria-valuetext', `${value} of 100`); };
      const loop = () => {
        raf = 0;
        const diff = value - shown;
        shown = Math.abs(diff) < 0.15 || reduced() ? value : shown + diff * 0.38;
        D.setNeedle(shown);
        const step = Math.round(shown / 2);
        if (step !== lastStep) {
          lastStep = step;
          const now = performance.now();
          if (now - lastTick > 32) { lastTick = now; api.sfx('tick'); api.haptic(4); }
        }
        if (shown !== value) raf = requestAnimationFrame(loop);
      };
      const setValue = (v) => {
        const nv = Math.max(0, Math.min(100, Math.round(v)));
        if (nv === value) return;
        value = nv; paintAria();
        if (!raf) raf = requestAnimationFrame(loop);
      };
      const valueAt = (cx, cy) => {
        const m = D.svg.getScreenCTM();
        if (!m) return value;
        const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
        const dx = p.x - CX; const dy = CY - p.y;
        const a = dy <= 0 ? (dx < 0 ? Math.PI : 0) : Math.atan2(dy, dx);
        return (1 - a / Math.PI) * 100;
      };
      dEl.addEventListener('pointerdown', (e) => {
        if (!ctx.canMove || dragging != null) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        dragging = e.pointerId;
        try { dEl.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
        dEl.classList.add('drag');
        dEl.focus({ preventScroll: true });
        setValue(valueAt(e.clientX, e.clientY));
      });
      dEl.addEventListener('pointermove', (e) => { if (e.pointerId !== dragging) return; e.preventDefault(); setValue(valueAt(e.clientX, e.clientY)); });
      const end = (e) => { if (e.pointerId !== dragging) return; dragging = null; dEl.classList.remove('drag'); };
      dEl.addEventListener('pointerup', end);
      dEl.addEventListener('pointercancel', end);
      dEl.addEventListener('lostpointercapture', end);
      dEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
      dEl.addEventListener('keydown', (e) => {
        if (!ctx.canMove) return;
        const big = e.shiftKey ? 5 : 1;
        const k = { ArrowLeft: -big, ArrowDown: -big, ArrowRight: big, ArrowUp: big, PageDown: -10, PageUp: 10 }[e.key];
        if (k) { e.preventDefault(); setValue(value + k); }
        else if (e.key === 'Home') { e.preventDefault(); setValue(0); }
        else if (e.key === 'End') { e.preventDefault(); setValue(100); }
        else if (e.key === 'Enter') { e.preventDefault(); lock(); }
      });
      const lock = () => {
        if (!ctx.canMove) return;
        const res = api.move({ at: value });
        if (res.ok) { api.sfx('place'); api.haptic(20); } else { api.toast(res.error); api.sfx('bad'); }
      };
      node.querySelector('.wv-go').addEventListener('click', lock);
      paintAria();
      return {
        refresh() { node.querySelector('.wv-go').disabled = !ctx.canMove; },
        destroy() { if (raf) cancelAnimationFrame(raf); },
      };
    }

    // A finished round: the screen swings open, the zone spreads, points stamp down.
    function revealScreen(node, ri, { next = false, waiting = false, final = false } = {}) {
      const s = ctx.state; const Rd = s.rounds[ri];
      const guesser = other(Rd.giver);
      const nextGiver = s.r < ROUNDS ? s.rounds[s.r].giver : null;
      const d = Math.abs(Rd.at - Rd.target);
      node.innerHTML = `${top(s, ri)}
        ${clueBubble(Rd)}
        <div class="wv-host"></div>
        <div class="wv-result hide">
          <div class="wv-pts ${Rd.points ? '' : 'zero'}">${Rd.points ? `+${Rd.points}` : '0'}</div>
          <div class="wv-result-txt"><b>${LABEL[Rd.points]}</b><span>${nm(guesser)} was ${d === 0 ? 'dead on' : `${d} off`}</span></div>
        </div>
        ${next ? `<button class="gm-btn wv-go">${final ? 'See how you did' : 'Next round: your clue'}</button>
          ${ctx.mode === 'local' && nextGiver ? `<p class="wv-note">${esc(api.name(other(nextGiver)))}, look away. ${esc(api.name(nextGiver))} sees the next target.</p>` : ''}` : ''}
        ${waiting && nextGiver ? `<div class="wv-wait">${nm(nextGiver)} is thinking of a clue <span class="wv-dots"><i></i><i></i><i></i></span></div>` : ''}`;
      const D = dial(node.querySelector('.wv-host'), { card: Rd.card, zone: Rd.target, lid: true, needle: { at: Rd.at, who: guesser } });
      const res = node.querySelector('.wv-result');
      const showResult = () => {
        res.classList.remove('hide');
        if (!reduced()) res.classList.add('anim');
        api.sfx(Rd.points >= 3 ? 'good' : Rd.points ? 'pop' : 'bad');
        api.haptic(Rd.points ? 25 : 60);
      };
      D.setZone(0);
      D.setLid(0);
      api.sfx('flip');
      animate(650, (k) => D.setLid(-180 * easeInOut(k)), () => {
        D.setLid(-180);
        animate(520, (k) => D.setZone(easeOutBack(k)), () => { D.setZone(1); showResult(); });
      });
      if (next) node.querySelector('.wv-go').addEventListener('click', () => { vs.ack[ri] = true; api.sfx('tap'); render(); });
      return {};
    }

    function waitClueScreen(node) {
      const s = ctx.state; const Rd = s.rounds[s.r];
      node.innerHTML = `${top(s)}
        <h2 class="wv-h">${nm(Rd.giver)} is thinking of a clue</h2>
        <div class="wv-host"></div>
        <div class="wv-wait">You’ll turn the dial next <span class="wv-dots"><i></i><i></i><i></i></span></div>`;
      dial(node.querySelector('.wv-host'), { card: Rd.card, lid: true });
      return {};
    }

    function waitGuessScreen(node) {
      const s = ctx.state; const Rd = s.rounds[s.r];
      const guesser = other(Rd.giver);
      node.innerHTML = `${top(s)}
        ${clueBubble(Rd, true)}
        <div class="wv-host"></div>
        <div class="wv-wait">${nm(guesser)} is turning the dial <span class="wv-dots"><i></i><i></i><i></i></span></div>`;
      dial(node.querySelector('.wv-host'), { card: Rd.card, zone: Rd.target });
      return {};
    }

    function recapScreen(node) {
      const s = ctx.state;
      const anim = !vs.recapAnimated && !reduced();
      vs.recapAnimated = true;
      const seg = (cls, a, b) => { const l = Math.max(0, a); const r = Math.min(100, b); return r > l ? `<span class="${cls}" style="left:${l}%;width:${r - l}%"></span>` : ''; };
      node.innerHTML = `<div class="wv-rhead">
          <span class="wv-kicker">Same Wave</span>
          <div class="wv-plaque"><b>${s.score}<small>/${MAX}</small></b><span>${esc(ratingOf(s.score))}</span></div>
          <div class="wv-meter" aria-hidden="true">${Array.from({ length: MAX }, (_, i) => `<i class="${i < s.score ? 'on' : ''}"></i>`).join('')}</div>
        </div>
        <div class="wv-rows">${s.rounds.map((Rd, i) => `<div class="wv-row ${anim ? 'anim' : ''}" style="animation-delay:${i * 70}ms">
            <span class="wv-row-card">${i + 1}. ${label(CARDS[Rd.card][0])} ↔ ${label(CARDS[Rd.card][1])}</span>
            <span class="wv-row-pts ${Rd.points ? '' : 'zero'}">${Rd.points ? `+${Rd.points}` : '0'}</span>
            <span class="wv-row-clue">“${esc(Rd.clue)}” <small>by ${nm(Rd.giver)}</small></span>
            <div class="wv-mini" aria-label="Target ${Rd.target}, guess ${Rd.at}">${seg('z2', Rd.target - 17, Rd.target + 17)}${seg('z3', Rd.target - 10, Rd.target + 10)}${seg('z4', Rd.target - 4, Rd.target + 4)}<span class="pin ${other(Rd.giver)}" style="left:${Rd.at}%"></span></div>
          </div>`).join('')}</div>
        <div class="wv-actions"><button class="gm-btn" data-g="rematch">Play again</button><button class="gm-btn gm-btn-ghost" data-g="close">Back to games</button></div>`;
      return {};
    }

    function render() {
      const c = ctx;
      if (!c) return;
      const s = c.state;
      const v = c.viewer;
      if (c.over) {
        const last = ROUNDS - 1;
        if (vs.wasOver === false && !vs.ack[last]) { setScreen(`reveal:${last}`, (n) => revealScreen(n, last, { next: true, final: true })); return; }
        setScreen('recap', recapScreen);
        return;
      }
      if (!v) { setScreen('blank', (n) => { n.innerHTML = ''; return {}; }); return; }
      const Rd = s.rounds[s.r];
      const prev = s.rounds[s.r - 1];
      if (s.phase === 'clue') {
        if (v === Rd.giver) {
          if (prev && !vs.ack[s.r - 1]) setScreen(`reveal:${s.r - 1}`, (n) => revealScreen(n, s.r - 1, { next: true }));
          else setScreen(`clue:${s.r}`, clueScreen);
        } else if (prev) setScreen(`reveal:${s.r - 1}`, (n) => revealScreen(n, s.r - 1, { waiting: true }));
        else setScreen(`wclue:${s.r}`, waitClueScreen);
        return;
      }
      if (v === Rd.giver) setScreen(`wguess:${s.r}`, waitGuessScreen);
      else setScreen(`guess:${s.r}`, guessScreen);
    }

    return {
      update(c) {
        ctx = c;
        render();
        if (vs.wasOver === null || !c.over) vs.wasOver = c.over;
        if (c.over && scr && scr.key === `reveal:${ROUNDS - 1}` && !vs.toRecap) {
          vs.toRecap = setTimeout(() => { vs.ack[ROUNDS - 1] = true; render(); }, 2900);
        }
      },
      destroy() {
        clearTimeout(vs.toRecap);
        if (scr && scr.destroy) scr.destroy();
        rafs.forEach((id) => cancelAnimationFrame(id));
      },
    };
  },
});
