// Double Agents: a co-op word-clue spy game for two. Both of you look at the same 25 words,
// but each holds a different secret key. Take turns giving one-word clues; the other taps
// the words they think are the clue-giver's agents. Find all 15 agents in 9 turns.
//
// Moves:  { clue: 'ocean', n: 2 }   the clue-giver (one plain word, not on the board, 1-9)
//         { pick: 7 }               the guesser taps card 7 (judged against the GIVER's key)
//         { stop: true }            the guesser ends the turn (after at least one pick)
//
// The two keys. Every card has a pair of roles (Emerson's key, Sydney's key):
//   agent/agent          3    shared agents
//   agent/assassin       1    Emerson's agent, but an assassin on Sydney's key
//   assassin/agent       1    and the mirror image
//   assassin/assassin    1    shared assassin
//   agent/bystander      5
//   bystander/agent      5
//   assassin/bystander   1
//   bystander/assassin   1
//   bystander/bystander  7
//   ── 25 cards. Each key: 9 agents (3+1+5), 3 assassins (1+1+1), 13 bystanders (5+1+7).
//   Distinct agents: 3+1+1+5+5 = 15.
// makeKeys() shuffles these 25 pairs with the match seed, so both phones derive the same keys.
//
// A turn: the giver's clue uses one of 9 shared timer tokens. Each pick is judged on the
// giver's key: agent = found (stays green, keep guessing); bystander = marked on the giver's
// key and the turn ends; assassin = mission lost. Givers alternate, except that someone with
// no agents left to find never gives the clue. Win by finding all 15 before the tokens run out.
import { registerGame, shuffled } from './core.js';

const NOUNS = `
kiss ring honey candle picnic blanket pillow rose wine letter photo puppy kitten pancake coffee brunch beach
sunset passport suitcase ticket cinema popcorn sushi pizza taco garden balcony playlist vinyl guitar piano
karaoke bubble bathtub duvet slipper mitten sofa kettle toaster waffle cupcake cookie bagel noodle dumpling
avocado lemon cherry mango peach pumpkin carrot garlic cheese butter wedding bouquet diary postcard hammock
campfire sweater hoodie pajamas date lipstick perfume mixtape polaroid fondue cocktail bed kitchen doughnut
teddy castle island volcano desert jungle glacier canyon harbor bridge tower palace temple museum library
airport station subway circus carnival casino bakery diner motel cabin igloo attic cellar garage chapel market
stadium prison rooftop tunnel barn orchard vineyard meadow cave reef lagoon oasis crater moon comet planet
galaxy rocket meteor anchor compass map lantern umbrella mirror clock key lock rope ladder hammer button
wallet diamond crown sword shield arrow dagger poison cipher mask wig disguise camera radio gadget laser vault
octopus penguin giraffe dragon unicorn dolphin shark whale tiger lion eagle owl parrot flamingo peacock panda
koala kangaroo camel zebra otter beaver hedgehog squirrel rabbit fox wolf bear moose llama sloth turtle frog
snail spider bee moth ladybug crab lobster seahorse swan duck goose pig cow horse pony donkey mouse bat snake
dinosaur mammoth phoenix mermaid ghost vampire zombie wizard witch fairy giant robot alien pirate ninja cowboy
knight king queen prince princess chef doctor pilot sailor farmer clown magician baker butler bride groom
rainbow thunder tornado blizzard snowman icicle cloud storm frost wave river mountain forest acorn pinecone
mushroom cactus tulip daisy lily feather shell pearl coral pebble crystal gold silver marble amber ember flame
bonfire torch sparkler balloon kite swing slide seesaw bicycle scooter tractor train taxi yacht kayak jetpack
helmet scarf hat tiara veil tuxedo bikini dice chess puzzle domino trophy medal curtain drum violin trumpet
harp flute banjo disco ballet tango opera movie cartoon comic poem stamp gift ribbon confetti glitter sticker
crayon statue fountain chimney mailbox doorbell tent backpack vanilla caramel cinnamon pickle olive banana
apple coconut kiwi pretzel donut brownie lollipop gelato smoothie espresso latte tea burger hotdog burrito
ramen curry lasagna steak oyster laptop magnet drone pixel password spring heart bone beard mustache tattoo
freckle dimple reindeer stocking wreath ornament costume cupid sleigh elf turkey snowball spoon knife teapot
cork necklace bracelet earring locket brooch watch monocle bowtie cape cloak yoyo jigsaw marathon parade
karate yoga sauna jacuzzi spa lullaby pinata sombrero bagpipe cello whistle speaker jukebox arcade pinball
joystick console treasure pyramid mummy sphinx scroll quill inkwell telegram pigeon decoy badge handcuff match
fan seal mint organ bow chip web mole crane jam trunk nail horn bolt palm pen ruler
`.trim().split(/\s+/);
// Where a long word breaks when its card is too narrow for one line (every noun of 7+ letters).
const BREAKS = new Map(`
blan-ket pan-cake pass-port suit-case pop-corn bal-cony play-list kara-oke bath-tub slip-per toast-er cup-cake
dump-ling avo-cado pump-kin wed-ding bou-quet post-card ham-mock camp-fire sweat-er paja-mas lip-stick per-fume
mix-tape pola-roid cock-tail kit-chen dough-nut vol-cano gla-cier lib-rary air-port sta-tion carni-val sta-dium
roof-top or-chard vine-yard com-pass lan-tern um-brella dia-mond dis-guise octo-pus pen-guin gi-raffe uni-corn
dol-phin fla-mingo pea-cock kanga-roo hedge-hog squir-rel lady-bug lob-ster sea-horse dino-saur mam-moth phoe-nix
mer-maid vam-pire prin-cess magi-cian rain-bow thun-der tor-nado bliz-zard snow-man moun-tain pine-cone mush-room
feath-er crys-tal bon-fire spark-ler bal-loon bi-cycle scoot-er trac-tor jet-pack cur-tain trum-pet car-toon
con-fetti glit-ter stick-er foun-tain chim-ney mail-box door-bell back-pack va-nilla cara-mel cinna-mon coco-nut
pret-zel brown-ie lolli-pop smooth-ie es-presso la-sagna pass-word mus-tache freck-le rein-deer stock-ing orna-ment
cos-tume snow-ball neck-lace brace-let ear-ring mon-ocle mara-thon ja-cuzzi lulla-by som-brero bag-pipe whis-tle
speak-er juke-box pin-ball joy-stick con-sole treas-ure pyra-mid ink-well tele-gram hand-cuff
`.trim().split(/\s+/).map((x) => [x.replace('-', ''), x.split('-')]));

const TOKENS = 9;
const TOTAL = 15;
// G = agent, K = assassin, N = bystander. First letter: player a's key, second: player b's.
const LAYOUT = [
  'GG', 'GG', 'GG', 'GK', 'KG', 'KK',
  'GN', 'GN', 'GN', 'GN', 'GN', 'NG', 'NG', 'NG', 'NG', 'NG',
  'KN', 'NK', 'NN', 'NN', 'NN', 'NN', 'NN', 'NN', 'NN',
];
const other = (w) => (w === 'a' ? 'b' : 'a');
const up = (w) => String(w || '').toUpperCase();
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** Both secret keys for a seed: { a: 'GKN…', b: '…' } (25 letters each). */
function makeKeys(seed) {
  const pairs = shuffled(LAYOUT, `${seed}:keys`);
  return { a: pairs.map((p) => p[0]).join(''), b: pairs.map((p) => p[1]).join('') };
}
/** 25 distinct board words for a seed; no word contains another (keeps the clue rule fair). */
function pickWords(seed) {
  const out = [];
  for (const w of shuffled(NOUNS, `${seed}:words`)) {
    if (out.length === 25) break;
    if (out.some((o) => o.includes(w) || w.includes(o))) continue;
    out.push(w);
  }
  return out;
}

const foundCount = (s) => s.found.filter(Boolean).length;
const agentsLeft = (s, w) => { let n = 0; for (let i = 0; i < 25; i++) if (s.key[w][i] === 'G' && !s.found[i]) n++; return n; };
const curTurn = (s) => s.log[s.log.length - 1] || null;

// A board word's plurals that don't simply contain it: cherry/cherries, wolf/wolves, knife/knives.
const IRREGULAR = { mouse: ['mice'], goose: ['geese'], dice: ['die'] };
function pluralsOf(w) {
  const f = [...(IRREGULAR[w] || [])];
  if (/[^aeiou]y$/.test(w)) f.push(w.slice(0, -1) + 'ies');
  if (w.endsWith('f')) f.push(w.slice(0, -1) + 'ves');
  if (w.endsWith('fe')) f.push(w.slice(0, -2) + 'ves');
  return f;
}
function cleanClue(s, x) {
  if (typeof x !== 'string' || !x.trim()) throw new Error('Type a one-word clue.');
  // "Café" counts as "cafe"; case never matters.
  const c = x.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/\s/.test(c)) throw new Error('One word only, no spaces.');
  if (!/^[a-z]+$/.test(c)) throw new Error('Just letters: one plain word.');
  if (c.length < 2) throw new Error('That clue is too short.');
  if (c.length > 20) throw new Error('That clue is too long.');
  s.words.forEach((w, i) => {
    if (s.found[i]) return; // covered cards are off the table
    if (w === c) throw new Error(`${up(w)} is on the board. Try another word.`);
    if (w.includes(c) || c.includes(w) || pluralsOf(w).includes(c)) throw new Error(`Too close to ${up(w)} on the board. Try another word.`);
  });
  return c;
}

function endTurn(s) {
  s.phase = 'clue';
  if (s.turns >= TOKENS) { s.over = 'time'; return; }
  const nx = other(s.giver);
  if (agentsLeft(s, nx) > 0) s.giver = nx; // someone with nothing left to find keeps guessing
}

// ── rules (pure, deterministic) ──
function init({ first, seed }) {
  return {
    words: pickWords(seed),
    key: makeKeys(seed),
    giver: first === 'b' ? 'b' : 'a',
    phase: 'clue',
    turns: 0,
    found: Array(25).fill(null), // who found each agent
    miss: { a: [], b: [] }, // cards known to be bystanders on that player's key
    hit: null, // the assassin that ended it
    log: [], // { by, clue, n, picks: [{ i, r }] }
    over: null, // 'win' | 'burned' | 'time'
  };
}
function next(s) {
  if (s.over) return [];
  return s.phase === 'clue' ? [s.giver] : [other(s.giver)];
}
function apply(s, who, mv) {
  if (s.over) throw new Error('The mission is over.');
  if (!mv || typeof mv !== 'object') throw new Error('That move didn’t make sense.');
  if (s.phase === 'clue') {
    if (who !== s.giver) throw new Error('Wait for the clue.');
    if (mv.pick !== undefined || mv.stop) throw new Error('Wait for a clue first.');
    const clue = cleanClue(s, mv.clue);
    const n = Number(mv.n);
    if (!Number.isInteger(n) || n < 1 || n > 9) throw new Error('Pick a number from 1 to 9.');
    s.turns += 1;
    s.phase = 'guess';
    s.log.push({ by: who, clue, n, picks: [] });
    return s;
  }
  if (who === s.giver) throw new Error('Your partner is guessing.');
  if (mv.clue !== undefined) throw new Error('It’s time to guess, not to give a clue.');
  const turn = curTurn(s);
  if (mv.stop) {
    if (!turn.picks.length) throw new Error('Pick at least one card before you end the turn.');
    endTurn(s);
    return s;
  }
  const i = mv.pick;
  if (!Number.isInteger(i) || i < 0 || i > 24) throw new Error('Pick a card on the board.');
  if (s.found[i]) throw new Error(`${up(s.words[i])} is already found.`);
  if (s.miss[s.giver].includes(i)) throw new Error(`${up(s.words[i])} is already marked as a bystander on this key.`);
  const r = s.key[s.giver][i];
  turn.picks.push({ i, r });
  if (r === 'K') { s.hit = i; s.over = 'burned'; return s; }
  if (r === 'N') { s.miss[s.giver].push(i); endTurn(s); return s; }
  s.found[i] = who;
  if (foundCount(s) >= TOTAL) { s.over = 'win'; return s; }
  if (agentsLeft(s, s.giver) === 0) endTurn(s); // nothing more to find on this key
  return s;
}
function result(s) {
  const n = foundCount(s);
  const base = { winner: null, team: true, score: n };
  if (s.over === 'win') {
    const spare = TOKENS - s.turns;
    return { ...base, text: 'Mission complete', sub: `All ${TOTAL} agents found${spare ? ` with ${spare} turn${spare === 1 ? '' : 's'} to spare` : ' on the very last turn'}.` };
  }
  if (s.over === 'burned') return { ...base, text: 'Burned', sub: `${up(s.words[s.hit])} was an assassin. ${n} of ${TOTAL} agents found.` };
  return { ...base, text: 'Out of time', sub: `The trail went cold at ${n} of ${TOTAL} agents.` };
}

// ── view ──
const ICON = {
  mask: '<svg class="g-ag-ico" viewBox="0 0 32 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M1.5 4.5C6 0.5 12 1.2 16 4c4-2.8 10-3.5 14.5 0.5 1.4 5.2-1.6 10-6.6 10-3.2 0-4.6-3-7.9-3s-4.7 3-7.9 3c-5 0-8-4.8-6.6-10zM5.2 7.6a3.6 2.4 0 1 0 7.2 0a3.6 2.4 0 1 0-7.2 0zM19.6 7.6a3.6 2.4 0 1 0 7.2 0a3.6 2.4 0 1 0-7.2 0z"/></svg>',
  cross: '<svg class="g-ag-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/></svg>',
};

const css = `
.g-agents { --gap: 6px; --ag-on-good: var(--g-white); flex: 1; min-height: 0; width: 100%; display: flex; flex-direction: column; gap: 10px; color: var(--g-ink); font-family: var(--g-font-body); touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .g-agents { --ag-on-good: var(--g-on-ink); } }
:root[data-theme="dark"] .g-agents { --ag-on-good: var(--g-on-ink); }
.g-ag-top { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.g-ag-say { margin: 0; min-height: 1.35em; text-align: center; font-weight: 800; font-size: 0.98rem; line-height: 1.35; text-wrap: balance; }
.g-ag-who { font-weight: 900; } .g-ag-who.p-a { color: var(--p-a-text); } .g-ag-who.p-b { color: var(--p-b-text); }
.g-ag-meta { display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; font-size: 0.8rem; font-weight: 800; color: var(--g-muted); }
.g-ag-tokens { display: flex; align-items: center; gap: 4px; }
.g-ag-tok { width: 12px; height: 12px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--g-ink); background: var(--g-ink); }
.g-ag-tok.used { background: transparent; border-color: var(--g-muted); position: relative; }
.g-ag-tok.used::after { content: ''; position: absolute; left: -2px; right: -2px; top: 3px; height: 2px; background: var(--g-muted); transform: rotate(-45deg); }
.g-ag-tok.now { background: var(--g-hl); }
.g-ag-tokens > span:last-child { margin-left: 3px; }
.g-ag-count b { color: var(--g-ink); font-size: 1rem; }

/* clue slip / form */
.g-ag-slip { display: flex; justify-content: center; min-height: 0; container-type: inline-size; }
.g-ag-slip:empty { display: none; }
.g-ag-paper { box-sizing: border-box; max-width: 100%; min-width: 0; display: inline-flex; align-items: center; gap: 12px; padding: 6px 8px 7px 14px; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: var(--g-radius-sm); box-shadow: var(--g-shadow); }
.g-ag-cluebox { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.g-ag-paper small { font-size: 0.7rem; font-weight: 800; color: var(--g-muted); text-transform: uppercase; letter-spacing: 0.1em; }
.g-ag-clueword { font-family: var(--g-font-display); font-weight: 900; font-size: clamp(13px, calc((100cqw - 76px) / (var(--len) * 0.98)), 1.45rem); line-height: 1.08; letter-spacing: 0.04em; text-transform: uppercase; overflow-wrap: anywhere; }
.g-ag-num { flex: none; min-width: 30px; height: 30px; padding: 0 4px; box-sizing: border-box; display: inline-grid; place-items: center; border-radius: 50%; background: var(--g-ink); color: var(--g-bg); font-weight: 900; font-size: 1.05rem; }
.g-ag-form { width: 100%; max-width: 480px; display: flex; align-items: stretch; gap: 6px; }
.g-ag-input { flex: 1 1 auto; min-width: 0; height: 48px; box-sizing: border-box; padding: 0 12px; border: 2px solid var(--g-ink); border-radius: var(--g-radius-sm); background: var(--g-card); color: var(--g-ink); font: 900 1.05rem var(--g-font-display); letter-spacing: 0.05em; text-transform: uppercase; box-shadow: var(--g-shadow); }
.g-ag-input::placeholder { text-transform: none; letter-spacing: 0; font-family: var(--g-font-body); font-weight: 700; color: var(--g-muted); }
.g-ag-input:focus { outline: 3px solid var(--g-hl); outline-offset: 1px; }
.g-ag-input.shake { animation: g-ag-shake 0.4s ease; }
.g-ag-step { flex-shrink: 0; display: flex; align-items: stretch; border: 2px solid var(--g-ink); border-radius: var(--g-radius-sm); background: var(--g-card); box-shadow: var(--g-shadow); overflow: hidden; }
.g-ag-step button { width: 34px; min-height: 44px; color: var(--g-ink); font-weight: 900; font-size: 1.25rem; background: transparent; touch-action: manipulation; }
.g-ag-step button:active { background: var(--g-hl-soft); }
.g-ag-step output { min-width: 22px; display: grid; place-items: center; font-family: var(--g-font-display); font-weight: 900; font-size: 1.1rem; }
.g-ag-form .gm-btn { min-height: 48px; padding: 0 14px; }

/* board: printed word cards, every word set at one size; long words break onto two lines */
.g-ag-body { display: flex; flex-direction: column; gap: 12px; }
.g-ag-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.g-ag-wrap { container-type: inline-size; width: 100%; }
.g-ag-grid { --gap: clamp(4px, 1.4cqw, 10px); --fs: 12px; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--gap); }
.g-ag-card { --cw: calc((100cqw - 4 * var(--gap)) / 5); --face: var(--g-card); --ink: var(--g-ink); position: relative; height: clamp(52px, min(calc(var(--cw) * 0.8), calc((100dvh - 330px) / 5)), 96px); min-width: 0; padding: 0 2px 7px; box-sizing: border-box; display: grid; place-items: center; overflow: hidden; border: 2px solid var(--g-ink); border-radius: var(--g-radius-sm); background-color: var(--face); color: var(--ink); box-shadow: var(--g-shadow); font-family: var(--g-font-body); font-weight: 900; text-transform: uppercase; cursor: default; transition: transform 0.12s ease; }
.g-ag-card::before { content: ''; position: absolute; left: 34%; right: 34%; bottom: 6px; height: 2px; border-radius: 1px; background: var(--g-line); }
.g-ag-word { position: relative; z-index: 1; max-width: 100%; display: block; text-align: center; font-size: var(--fs); line-height: 1.02; letter-spacing: 0; white-space: nowrap; }
.g-ag-word .hy { display: none; }
.g-ag-word.two .p { display: block; }
.g-ag-word.two .hy { display: inline; }
.g-ag-card .g-ag-ico { position: absolute; z-index: 0; pointer-events: none; }
.g-ag-card.can { cursor: pointer; }
.g-ag-card.can:active { transform: translate(2px, 2px); box-shadow: var(--g-shadow-sm); }
.g-ag-card.is-sel { transform: translateY(-3px); box-shadow: 3px 5px 0 var(--g-edge); outline: 3px solid var(--g-hl); outline-offset: 1px; z-index: 2; }
.g-ag-card.dim { opacity: 0.55; }

/* the key overlay (yours, or the clue-giver's own) */
.g-ag-card.k-G { box-shadow: inset 0 0 0 3px var(--g-good), var(--g-shadow); }
.g-ag-card.k-G::after { content: ''; position: absolute; top: 0; left: 0; border-top: 12px solid var(--g-good); border-right: 12px solid transparent; }
.g-ag-card.k-K { background-image: repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--g-ink) 16%, transparent) 6px 8px); box-shadow: inset 0 0 0 3px var(--g-ink), var(--g-shadow); }
.g-ag-card.k-K .g-ag-ico { top: 3px; right: 3px; width: 13px; height: 13px; }

/* revealed */
.g-ag-card.is-found { --face: var(--g-good); --ink: var(--ag-on-good); background-image: none; }
.g-ag-card.is-found::before { background: currentColor; opacity: 0.45; }
.g-ag-card.is-found .g-ag-ico { top: 4px; left: 50%; width: 22px; height: 11px; margin-left: -11px; opacity: 0.8; }
.g-ag-card.is-hit { --face: var(--g-ink); --ink: var(--g-bg); background-image: none; }
.g-ag-card.is-hit::before { display: none; }
.g-ag-card.is-hit .g-ag-ico { top: 3px; right: 3px; width: 14px; height: 14px; }
.g-ag-card.is-void { --face: color-mix(in srgb, var(--g-muted) 22%, var(--g-card)); --ink: var(--g-muted); box-shadow: none; }
.g-ag-tag { position: absolute; z-index: 2; bottom: 2px; width: 16px; height: 16px; box-sizing: border-box; display: grid; place-items: center; border: 1.5px solid var(--g-ink); border-radius: 4px; font: 900 11px/1 var(--g-font-body); font-style: normal; color: var(--g-on-ink); }
.g-ag-tag.t-a { left: 2px; background: var(--p-a); } .g-ag-tag.t-b { right: 2px; background: var(--p-b); }

/* dock */
.g-ag-dock { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.g-ag-dock:empty { display: none; }
.g-ag-acts { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr); gap: 10px; }
.g-ag-acts .gm-btn { min-height: 48px; padding: 8px 10px; min-width: 0; }
.g-ag-acts .gm-btn span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-ag-row { display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; }
.g-ag-legend { display: flex; gap: 14px; font-size: 0.8rem; font-weight: 800; color: var(--g-muted); align-items: center; }
.g-ag-legend i { display: inline-block; width: 14px; height: 14px; margin-right: 5px; vertical-align: -2px; box-sizing: border-box; border-radius: 3px; border: 2px solid var(--g-ink); }
.g-ag-legend .lg-g { border-color: var(--g-good); background: linear-gradient(135deg, var(--g-good) 50%, transparent 50%); }
.g-ag-legend .lg-k { background: var(--g-card) repeating-linear-gradient(135deg, transparent 0 2px, color-mix(in srgb, var(--g-ink) 30%, transparent) 2px 3px); }
.g-ag-toggle { display: inline-flex; border: 2px solid var(--g-ink); border-radius: 999px; overflow: hidden; background: var(--g-card); box-shadow: var(--g-shadow-sm); }
.g-ag-toggle button { min-height: 40px; padding: 0 16px; font-weight: 800; font-size: 0.9rem; color: var(--g-ink); background: transparent; touch-action: manipulation; }
.g-ag-toggle button + button { border-left: 2px solid var(--g-ink); }
.g-ag-toggle button[aria-pressed="true"] { background: var(--g-ink); color: var(--g-bg); }
.g-ag-end { width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.g-ag-end .gm-btn { min-height: 48px; padding: 8px 10px; }

/* clue history */
.g-ag-side h3 { margin: 0 0 8px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--g-muted); }
.g-ag-log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.g-ag-log li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 8px 10px; background: var(--g-card); border: 2px solid var(--g-line); border-radius: var(--g-radius-sm); font-size: 0.85rem; }
.g-ag-log li.now { border-color: var(--g-ink); }
.g-ag-log li.g-ag-empty { padding: 0; border: 0; background: none; color: var(--g-muted); }
.g-ag-by { flex: none; width: 22px; height: 22px; box-sizing: border-box; display: inline-grid; place-items: center; border: 1.5px solid var(--g-ink); border-radius: 50%; color: var(--g-on-ink); font-weight: 900; font-size: 0.72rem; }
.g-ag-by.p-a { background: var(--p-a); } .g-ag-by.p-b { background: var(--p-b); }
.g-ag-log b { min-width: 0; font-family: var(--g-font-display); letter-spacing: 0.05em; text-transform: uppercase; overflow-wrap: anywhere; }
.g-ag-log .g-ag-num { min-width: 22px; height: 22px; font-size: 0.75rem; }
.g-ag-chips { display: flex; flex-wrap: wrap; gap: 4px; flex-basis: 100%; }
.g-ag-chips:empty { display: none; }
.g-ag-chip { padding: 2px 7px; border-radius: 4px; font-size: 0.72rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.04em; border: 1.5px solid var(--g-ink); }
.g-ag-chip.r-G { background: var(--g-good); color: var(--ag-on-good); }
.g-ag-chip.r-N { background: transparent; color: var(--g-muted); border-style: dashed; border-color: var(--g-muted); text-decoration: line-through; }
.g-ag-chip.r-K { background: var(--g-ink); color: var(--g-bg); }

/* wide screens: bigger cards, history beside the board */
@media (min-width: 760px) {
  .g-agents { width: min(calc(100vw - 56px), 1080px); align-self: center; }
  .g-ag-body { display: grid; grid-template-columns: minmax(0, 1fr) 270px; gap: 22px; align-items: start; }
  .g-ag-side { padding-top: 2px; max-height: calc(100dvh - 220px); overflow-y: auto; }
  .g-ag-card { border-radius: var(--g-radius); padding-bottom: 10px; }
  .g-ag-card::before { bottom: 9px; }
  .g-ag-tag { width: 20px; height: 20px; font-size: 12px; bottom: 4px; }
  .g-ag-tag.t-a { left: 4px; } .g-ag-tag.t-b { right: 4px; }
  .g-ag-card.k-G::after { border-top-width: 22px; border-right-width: 22px; }
  .g-ag-card.k-K .g-ag-ico, .g-ag-card.is-hit .g-ag-ico { width: 20px; height: 20px; top: 5px; right: 5px; }
  .g-ag-card.is-found .g-ag-ico { top: 7px; width: 30px; height: 15px; margin-left: -15px; }
  .g-ag-acts, .g-ag-end { max-width: 460px; }
}

/* motion */
@keyframes g-ag-flip { 0% { transform: rotateY(0); } 50% { transform: rotateY(90deg); } 100% { transform: rotateY(0); } }
@keyframes g-ag-face { 0%, 49% { background-color: var(--g-card); background-image: none; color: var(--g-ink); } 50%, 100% { background-color: var(--face); color: var(--ink); } }
@keyframes g-ag-thunk { 0% { transform: scale(1); } 35% { transform: scale(0.9); } 100% { transform: scale(1); } }
@keyframes g-ag-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-7px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(3px); } }
@keyframes g-ag-pop { 0% { transform: scale(1); } 45% { transform: scale(1.08) rotate(-2deg); } 100% { transform: scale(1); } }
@keyframes g-ag-in { from { opacity: 0; transform: translateY(-6px) rotate(-1deg); } to { opacity: 1; transform: none; } }
.g-ag-card.reveal { animation: g-ag-flip 0.5s ease-in-out both, g-ag-face 0.5s linear both; }
.g-ag-card.thunk { animation: g-ag-thunk 0.35s ease both; }
.g-ag-card.thunk .g-ag-tag { animation: g-ag-pop 0.35s ease both 0.1s; }
.g-ag-grid.boom { animation: g-ag-shake 0.45s ease 0.45s both; }
.g-ag-grid.party .g-ag-card.is-found { animation: g-ag-pop 0.5s ease both; animation-delay: calc(var(--i) * 35ms + 0.4s); }
.g-ag-paper.fresh { animation: g-ag-in 0.35s ease both; }
@media (prefers-reduced-motion: reduce) {
  .g-ag-card.reveal, .g-ag-card.thunk, .g-ag-card.thunk .g-ag-tag, .g-ag-grid.boom, .g-ag-grid.party .g-ag-card.is-found, .g-ag-paper.fresh, .g-ag-input.shake { animation-duration: 1ms !important; animation-delay: 0s !important; }
  .g-ag-card { transition: none; }
}
`;

registerGame({
  id: 'agents',
  title: 'Double Agents',
  blurb: 'One-word clues. Two secret keys. Find all 15 agents.',
  kind: 'turns',
  team: true,
  secret: true,
  tags: ['brainy'],
  platforms: ['phone', 'computer'],
  minutes: 15,
  howTo: [
    'You each hold a secret key: 9 of the 25 words are your agents, 3 are assassins.',
    'Take turns giving a one-word clue and a number that point at your agents.',
    'Your partner taps words. Agent: keep going. Bystander: turn over. Assassin: mission lost.',
    'Find all 15 agents within 9 turns. Agents on both keys count once.',
  ],
  css,
  endDelay: 1300,
  endLookLabel: 'See the board',
  init, next, apply, result,
  // exposed for tests
  _test: { makeKeys, pickWords, NOUNS, LAYOUT, TOKENS, TOTAL, BREAKS, cleanClue },

  mount(el, api) {
    el.innerHTML = `<div class="g-agents">
      <div class="g-ag-top">
        <p class="g-ag-say" aria-live="polite"></p>
        <div class="g-ag-meta"><div class="g-ag-tokens" role="img"></div><div class="g-ag-count"></div></div>
      </div>
      <div class="g-ag-body">
        <div class="g-ag-main">
          <div class="g-ag-slip"></div>
          <div class="g-ag-wrap"><div class="g-ag-grid" role="group" aria-label="The board"></div></div>
          <div class="g-ag-dock"></div>
        </div>
        <aside class="g-ag-side" aria-label="Clue history"><h3>Clues so far</h3><ol class="g-ag-log"></ol></aside>
      </div>
    </div>`;
    const root = el.querySelector('.g-agents');
    const q = (s) => root.querySelector(s);
    const sayEl = q('.g-ag-say');
    const tokEl = q('.g-ag-tokens');
    const countEl = q('.g-ag-count');
    const slip = q('.g-ag-slip');
    const grid = q('.g-ag-grid');
    const dock = q('.g-ag-dock');
    const logEl = q('.g-ag-log');

    let ctx = null;
    let sel = null; // selected card index (guesser)
    let showMine = false; // guesser: show my own key
    let keyView = null; // game over: whose key to show
    let num = 2; // clue number draft
    let prevMoves = null;
    let anim = null; // { i, kind } newest pick to animate
    let slipSig = '';
    let viewKey = '';
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const nm = (w) => esc(api.name(w));
    const ini = (w) => esc((api.name(w) || w).trim().charAt(0).toUpperCase());
    const who = (w) => `<span class="g-ag-who p-${w}">${nm(w)}</span>`;

    // A half-typed clue survives a reload (this device only).
    const DRAFT = 'ju.agents.draft.';
    const draftKey = (c) => `${c.viewer}|${c.state.turns}`;
    const draftGet = (c) => { try { const v = JSON.parse(localStorage.getItem(DRAFT + c.matchId) || 'null'); return v && v.k === draftKey(c) ? v : null; } catch { return null; } };
    const draftSet = (c, t, n) => { try { if (!t) localStorage.removeItem(DRAFT + c.matchId); else localStorage.setItem(DRAFT + c.matchId, JSON.stringify({ k: draftKey(c), t, n })); } catch { /* storage off */ } };

    function roleOf(c) {
      const s = c.state;
      if (c.over) return 'over';
      if (!c.viewer) return 'blank';
      if (s.phase === 'clue') return c.viewer === s.giver ? 'give' : 'await-clue';
      return c.viewer === s.giver ? 'watch' : 'guess';
    }
    function shownKey(c) {
      const role = roleOf(c);
      if (role === 'over') return keyView || c.viewer || c.first || 'a';
      if (role === 'blank') return null;
      if (role === 'give' || role === 'watch') return c.viewer; // the giver's own key
      return showMine ? c.viewer : null;
    }
    const pickable = (c, i) => {
      const s = c.state;
      return c.canMove && roleOf(c) === 'guess' && !s.found[i] && !s.miss[s.giver].includes(i);
    };

    function wordHTML(w) {
      const parts = BREAKS.get(w);
      const inner = parts ? `<span class="p">${up(parts[0])}<span class="hy">-</span></span><span class="p">${up(parts[1])}</span>` : up(w);
      return `<span class="g-ag-word" data-w="${w}">${inner}</span>`;
    }
    function cardHTML(c, i, k) {
      const s = c.state;
      const w = s.words[i];
      const cls = ['g-ag-card'];
      let ico = '';
      let label = up(w);
      if (s.found[i]) { cls.push('is-found'); ico = ICON.mask; label += ', agent found'; }
      else if (s.hit === i) { cls.push('is-hit'); ico = ICON.cross; label += ', assassin'; }
      else {
        const missA = s.miss.a.includes(i);
        const missB = s.miss.b.includes(i);
        if (missA && missB) { cls.push('is-void'); label += ', bystander on both keys'; }
        if (k) {
          const r = s.key[k][i];
          if (r === 'G') { cls.push('k-G'); label += `, agent on ${k === c.viewer ? 'your' : `${nm(k)}’s`} key`; }
          if (r === 'K') { cls.push('k-K'); ico = ICON.cross; label += `, assassin on ${k === c.viewer ? 'your' : `${nm(k)}’s`} key`; }
        }
        if (missA && !missB) label += `, bystander on ${nm('a')}’s key`;
        if (missB && !missA) label += `, bystander on ${nm('b')}’s key`;
      }
      const can = pickable(c, i);
      if (can) cls.push('can');
      else if (roleOf(c) === 'guess' && c.canMove && !s.found[i]) cls.push('dim');
      if (sel === i) cls.push('is-sel');
      if (anim && anim.i === i) cls.push(anim.kind);
      const tags = s.found[i] || s.hit === i ? '' : `${s.miss.a.includes(i) ? `<i class="g-ag-tag t-a" aria-hidden="true">${ini('a')}</i>` : ''}${s.miss.b.includes(i) ? `<i class="g-ag-tag t-b" aria-hidden="true">${ini('b')}</i>` : ''}`;
      return `<button class="${cls.join(' ')}" data-i="${i}" style="--i:${i}" aria-label="${label}"${can ? '' : ' aria-disabled="true"'}>${ico}${wordHTML(w)}${tags}</button>`;
    }

    function renderGrid() {
      const c = ctx;
      if (!c.viewer && !c.over) { grid.innerHTML = ''; return; }
      const k = shownKey(c);
      grid.innerHTML = c.state.words.map((_, i) => cardHTML(c, i, k)).join('');
      fit();
    }
    // One type size for the whole board: the largest at which every word fits its card, on one
    // line or broken onto two at its syllable break. Measured, so any font works.
    let meter = null;
    function fit() {
      const spans = [...grid.querySelectorAll('.g-ag-word')];
      if (!spans.length) return;
      const card = spans[0].parentElement;
      const avail = card.clientWidth - 6;
      const availH = card.clientHeight - 16;
      if (avail < 20 || availH < 16) return;
      meter = meter || document.createElement('canvas').getContext('2d');
      const cs = getComputedStyle(spans[0]);
      meter.font = `${cs.fontWeight} 100px ${cs.fontFamily}`;
      const em = (t) => meter.measureText(t).width / 100;
      let fs = Math.min(22, card.clientHeight * 0.3);
      const plan = spans.map((sp) => {
        const w = up(sp.dataset.w);
        const parts = BREAKS.get(sp.dataset.w);
        const one = em(w);
        const two = parts ? Math.max(em(up(parts[0]) + '-'), em(up(parts[1]))) : Infinity;
        fs = Math.min(fs, Math.max(avail / one, Math.min(avail / two, availH / 2.06)));
        return { sp, one };
      });
      fs = Math.max(10, fs);
      grid.style.setProperty('--fs', `${fs.toFixed(1)}px`);
      for (const p of plan) p.sp.classList.toggle('two', p.one * fs > avail + 0.5);
    }
    let fitW = 0;
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { const w = grid.clientWidth; if (w !== fitW) { fitW = w; fit(); } }) : null;
    if (ro) ro.observe(grid);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (grid.isConnected) fit(); });

    function renderTop() {
      const c = ctx;
      const s = c.state;
      const role = roleOf(c);
      const g = s.giver;
      const t = curTurn(s);
      const left = TOKENS - s.turns;
      let text = '';
      if (role === 'give') text = `Your clue: one word and a number for your <b>green</b> agents (${agentsLeft(s, g)} left).`;
      else if (role === 'await-clue') text = `${who(g)} is thinking of a clue…`;
      else if (role === 'guess') text = t.picks.length ? 'Nice. Keep going, or end the turn.' : `Tap the words you think are ${who(g)}’s agents.`;
      else if (role === 'watch') text = `${who(other(g))} is guessing your clue…`;
      else if (role === 'over') text = s.over === 'win' ? 'Mission complete. Every agent is home.' : s.over === 'burned' ? `Burned. ${up(s.words[s.hit])} was an assassin.` : 'Out of time. The trail went cold.';
      sayEl.innerHTML = text;
      tokEl.innerHTML = Array.from({ length: TOKENS }, (_, i) => `<span class="g-ag-tok${i < s.turns - (s.phase === 'guess' && !s.over ? 1 : 0) ? ' used' : i === s.turns - 1 && s.phase === 'guess' && !s.over ? ' now' : ''}"></span>`).join('') + `<span>${left} turn${left === 1 ? '' : 's'} left</span>`;
      tokEl.setAttribute('aria-label', `${left} of ${TOKENS} turns left`);
      countEl.innerHTML = `Agents <b>${foundCount(s)}</b>/${TOTAL}`;
    }

    function renderSlip() {
      const c = ctx;
      const s = c.state;
      const role = roleOf(c);
      const t = curTurn(s);
      const sig = JSON.stringify([role, c.viewer, s.giver, s.log.length, c.canMove]);
      if (sig === slipSig) return;
      const fresh = slipSig && s.phase === 'guess';
      slipSig = sig;
      if (role === 'give' && c.canMove) {
        const d = draftGet(c);
        const max = Math.max(1, Math.min(9, agentsLeft(s, s.giver)));
        num = Math.max(1, Math.min(d ? d.n : num, max));
        slip.innerHTML = `<form class="g-ag-form" autocomplete="off">
          <input class="g-ag-input" name="clue" maxlength="20" placeholder="Your clue" aria-label="Your clue, one word" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send">
          <div class="g-ag-step" role="group" aria-label="How many cards"><button type="button" data-act="minus" aria-label="Fewer">−</button><output aria-live="polite">${num}</output><button type="button" data-act="plus" aria-label="More">+</button></div>
          <button class="gm-btn" type="submit">Send</button>
        </form>`;
        if (d) slip.querySelector('.g-ag-input').value = d.t;
      } else if (t && s.phase === 'guess' && role !== 'blank' && role !== 'over') {
        slip.innerHTML = `<div class="g-ag-paper${fresh ? ' fresh' : ''}"><div class="g-ag-cluebox"><small>${nm(t.by)}’s clue</small><span class="g-ag-clueword" style="--len:${t.clue.length}">${esc(t.clue)}</span></div><span class="g-ag-num" aria-label="${t.n} cards">${t.n}</span></div>`;
      } else slip.innerHTML = '';
    }

    function renderDock() {
      const c = ctx;
      const s = c.state;
      const role = roleOf(c);
      const t = curTurn(s);
      const mine = `<div class="g-ag-toggle"><button data-act="mine" aria-pressed="${showMine}">Show my key</button></div>`;
      const legend = (whose) => `<div class="g-ag-legend" aria-hidden="true"><span><i class="lg-g"></i>${whose} agents</span><span><i class="lg-k"></i>assassins</span></div>`;
      let h = '';
      if (role === 'guess' && c.canMove) {
        h = `<div class="g-ag-acts"><button class="gm-btn gm-btn-ghost" data-act="stop"${t.picks.length ? '' : ' disabled'}>End turn</button>`;
        h += sel != null ? `<button class="gm-btn" data-act="pick"><span>Pick ${up(s.words[sel])}</span></button>` : '<button class="gm-btn" data-act="pick" disabled><span>Tap a word</span></button>';
        h += `</div><div class="g-ag-row">${mine}${showMine ? legend('your') : ''}</div>`;
      } else if (role === 'give' || role === 'watch') {
        h = legend('your');
      } else if (role === 'await-clue' || role === 'guess') {
        h = `<div class="g-ag-row">${mine}${showMine ? legend('your') : ''}</div>`;
      } else if (role === 'over') {
        const k = shownKey(c);
        h = `<div class="g-ag-toggle" role="group" aria-label="Show a key">${['a', 'b'].map((w) => `<button data-act="key" data-w="${w}" aria-pressed="${k === w}">${nm(w)}’s key</button>`).join('')}</div>
          <div class="g-ag-end"><button class="gm-btn" data-g="rematch">Play again</button><button class="gm-btn gm-btn-ghost" data-g="close">Back to games</button></div>`;
      }
      dock.innerHTML = h;
    }

    function renderLog() {
      const s = ctx.state;
      if (!s.log.length) { logEl.innerHTML = '<li class="g-ag-empty">No clues yet.</li>'; return; }
      logEl.innerHTML = s.log.map((t, n) => `<li class="${n === s.log.length - 1 && s.phase === 'guess' && !s.over ? 'now' : ''}">
        <span class="g-ag-by p-${t.by}" aria-label="${nm(t.by)}">${ini(t.by)}</span><b>${esc(t.clue)}</b><span class="g-ag-num" aria-label="${t.n} cards">${t.n}</span>
        <span class="g-ag-chips">${t.picks.map((p) => `<span class="g-ag-chip r-${p.r}" title="${p.r === 'G' ? 'agent' : p.r === 'K' ? 'assassin' : 'bystander'}">${s.words[p.i]}</span>`).join('')}</span>
      </li>`).reverse().join('');
    }

    function render() {
      if (!ctx) return;
      renderTop();
      renderSlip();
      renderGrid();
      renderDock();
      renderLog();
    }

    // ── input ──
    function sendClue(form) {
      const input = form.querySelector('.g-ag-input');
      const c = ctx;
      const r = api.move({ clue: input.value, n: num });
      if (!r.ok) {
        api.toast(r.error);
        api.sfx('bad');
        api.haptic(30);
        input.classList.remove('shake');
        void input.offsetWidth;
        input.classList.add('shake');
        later(() => input.classList.remove('shake'), 420);
        return;
      }
      draftSet(c, '');
      input.blur();
      api.sfx('place');
      api.haptic(15);
    }
    slip.addEventListener('submit', (e) => {
      e.preventDefault();
      if (ctx && ctx.canMove) sendClue(e.target);
    });
    slip.addEventListener('input', (e) => {
      if (ctx && e.target.classList.contains('g-ag-input')) draftSet(ctx, e.target.value, num);
    });
    slip.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || !ctx || !ctx.canMove) return;
      const max = Math.max(1, Math.min(9, agentsLeft(ctx.state, ctx.state.giver)));
      if (b.dataset.act === 'minus') num = Math.max(1, num - 1);
      if (b.dataset.act === 'plus') num = Math.min(max, num + 1);
      const out = slip.querySelector('output');
      if (out) out.textContent = num;
      const input = slip.querySelector('.g-ag-input');
      if (input && input.value) draftSet(ctx, input.value, num);
      api.sfx('tick');
    });

    function pick(i) {
      const c = ctx;
      if (!c || !pickable(c, i)) return;
      const r = api.move({ pick: i });
      sel = null;
      if (!r.ok) { api.toast(r.error); api.sfx('bad'); render(); }
    }
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('.g-ag-card');
      if (!b || !ctx) return;
      const i = Number(b.dataset.i);
      if (!ctx.canMove) {
        if (roleOf(ctx) === 'await-clue') api.toast('Wait for the clue.');
        return;
      }
      if (!pickable(ctx, i)) {
        if (roleOf(ctx) === 'give') api.toast('You give the clue this turn. Type it above.');
        return;
      }
      if (sel === i) { pick(i); return; }
      sel = i;
      api.sfx('tap');
      renderGrid();
      renderDock();
    });
    dock.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || b.disabled || !ctx) return;
      const act = b.dataset.act;
      if (act === 'pick' && sel != null) pick(sel);
      else if (act === 'stop') {
        const r = api.move({ stop: true });
        sel = null;
        if (!r.ok) { api.toast(r.error); api.sfx('bad'); } else api.sfx('tick');
      } else if (act === 'mine') { showMine = !showMine; api.sfx('flip'); renderGrid(); renderDock(); }
      else if (act === 'key') { keyView = b.dataset.w; api.sfx('flip'); renderGrid(); renderDock(); }
    });

    return {
      update(c) {
        const vk = `${c.viewer}|${c.curtain}`;
        if (vk !== viewKey) { viewKey = vk; showMine = false; sel = null; slipSig = ''; }
        ctx = c;
        const s = c.state;
        anim = null;
        if (s.phase !== 'guess' || !c.canMove) sel = null;
        if (sel != null && !pickable(c, sel)) sel = null;
        if (c.over) draftSet(c, '');
        if (prevMoves != null && c.moves > prevMoves && c.last && c.last.move && c.last.move.pick !== undefined && c.viewer !== undefined) {
          const i = c.last.move.pick;
          const kind = s.found[i] ? 'reveal' : s.hit === i ? 'reveal' : 'thunk';
          anim = { i, kind };
          if (s.found[i]) { api.sfx(s.over === 'win' ? 'pop' : 'good'); api.haptic(15); }
          else if (s.hit === i) { api.sfx('hit'); api.haptic(80); }
          else api.sfx('bad');
          later(() => { anim = null; }, 900);
        } else if (prevMoves != null && c.moves > prevMoves && c.last && c.last.move && c.last.move.clue !== undefined && c.last.who !== c.viewer) api.sfx('pop');
        prevMoves = c.moves;
        render();
        grid.classList.toggle('boom', s.over === 'burned' && !!anim);
        grid.classList.toggle('party', s.over === 'win' && !!anim);
      },
      destroy() { for (const t of timers) clearTimeout(t); timers.clear(); if (ro) ro.disconnect(); },
    };
  },
});
