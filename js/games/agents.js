// Double Agents: a co-op word-clue spy game for two. Both of you look at the same 25 words,
// but each holds a different secret key. Take turns giving one-word clues; the other taps
// the words they think are the clue-giver's agents. Find all 15 agents in 9 turns.
//
// Moves:  { clue: 'ocean', n: 2 }   the clue-giver (one plain word, not on the board, 1-9)
//         { pick: 7 }               the guesser taps card 7 (judged against the GIVER's key)
//         { stop: true }            the guesser ends the turn (after at least one pick)
//         { setup: { v: 2, level, pack, sudden } }   v2 rules, sent once by the first giver
//                                   before the first clue. Matches without it play the v1 rules
//                                   exactly as they always did (see docs/games/agents.md).
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
import { checkClue } from './agents/clue.js';
import { PACK_IDS, PACK_INFO, PACK_BREAKS, PACKS, packWords } from './agents/packs.js';

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
blan-ket pan-cake pass-port suit-case pop-corn bal-cony play-list kara-oke bath-tub slip-per toas-ter cup-cake
dump-ling avo-cado pump-kin wed-ding bou-quet post-card ham-mock camp-fire swea-ter paja-mas lip-stick per-fume
mix-tape pola-roid cock-tail kit-chen dough-nut vol-cano gla-cier li-brary air-port sta-tion carni-val sta-dium
roof-top or-chard vine-yard com-pass lan-tern um-brella dia-mond dis-guise octo-pus pen-guin gi-raffe uni-corn
dol-phin fla-mingo pea-cock kanga-roo hedge-hog squir-rel lady-bug lob-ster sea-horse dino-saur mam-moth phoe-nix
mer-maid vam-pire prin-cess magi-cian rain-bow thun-der tor-nado bliz-zard snow-man moun-tain pine-cone mush-room
fea-ther crys-tal bon-fire spark-ler bal-loon bi-cycle scoo-ter trac-tor jet-pack cur-tain trum-pet car-toon
con-fetti glit-ter stic-ker foun-tain chim-ney mail-box door-bell back-pack va-nilla cara-mel cinna-mon coco-nut
pret-zel brow-nie bur-rito lolli-pop smoo-thie es-presso la-sagna pass-word mus-tache frec-kle rein-deer stock-ing orna-ment
cos-tume snow-ball neck-lace brace-let ear-ring mon-ocle mara-thon ja-cuzzi lul-laby som-brero bag-pipe whis-tle
spea-ker juke-box pin-ball joy-stick con-sole treas-ure pyra-mid ink-well tele-gram hand-cuff
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

// v2 rules ride on a { setup } move: s.v === 2 switches them on. A v1 state never gets these fields.
const LEVELS = { rookie: 11, agent: 9, spy: 7 };
const tok = (s) => s.tokens || TOKENS;
const judgeOf = (s) => (s.phase === 'sudden' ? other(s.picker) : s.giver); // whose key a pick is judged on
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
  if (s.turns >= tok(s)) {
    if (s.v === 2 && s.sudden) { enterSudden(s); return; }
    s.over = 'time';
    return;
  }
  const nx = other(s.giver);
  if (agentsLeft(s, nx) > 0) s.giver = nx; // someone with nothing left to find keeps guessing
}
// Out of turns with agents left: no more clues. One player picks at a time on the partner's key.
function enterSudden(s) {
  const nx = agentsLeft(s, other(s.giver)) > 0 ? other(s.giver) : s.giver; // who would have clued next
  let p = other(nx); // ...so this is who would have guessed
  if (agentsLeft(s, other(p)) === 0) p = other(p);
  s.phase = 'sudden';
  s.picker = p;
  s.sd = [];
}
function applySetup(s, who, mv) {
  if (s.v || s.log.length) throw new Error('The rules are already set.');
  if (who !== s.giver) throw new Error('The first player sets the rules.');
  const o = mv.setup;
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('Those rules didn’t make sense.');
  for (const k of Object.keys(o)) if (!['v', 'level', 'pack', 'sudden'].includes(k)) throw new Error(`Unknown rule “${k}”.`);
  if (o.v !== 2) throw new Error('Unknown rules version.');
  const level = o.level === undefined ? 'agent' : o.level;
  const pack = o.pack === undefined ? 'classic' : o.pack;
  const sudden = o.sudden === undefined ? true : o.sudden;
  if (!Object.prototype.hasOwnProperty.call(LEVELS, level)) throw new Error('Pick rookie, agent or spy.');
  if (!PACK_IDS.includes(pack)) throw new Error('Unknown word pack.');
  if (typeof sudden !== 'boolean') throw new Error('Sudden death is on or off.');
  s.v = 2;
  s.level = level;
  s.pack = pack;
  s.sudden = sudden;
  s.tokens = LEVELS[level];
  if (pack !== 'classic') s.words = packWords(s.seed, pack, NOUNS);
  return s;
}
function applySudden(s, who, mv) {
  if (who !== s.picker) throw new Error('Your partner is picking.');
  if (mv.clue !== undefined || mv.setup !== undefined || mv.stop) throw new Error('Sudden death: no clues. Just pick a card.');
  const i = mv.pick;
  if (!Number.isInteger(i) || i < 0 || i > 24) throw new Error('Pick a card on the board.');
  const key = other(who);
  if (s.found[i]) throw new Error(`${up(s.words[i])} is already found.`);
  if (s.miss[key].includes(i)) throw new Error(`${up(s.words[i])} is already marked as a bystander on this key.`);
  const r = s.key[key][i];
  s.sd.push({ by: who, i, r });
  if (r !== 'G') { s.hit = i; s.over = 'caught'; return s; }
  s.found[i] = who;
  if (foundCount(s) >= TOTAL) { s.over = 'win'; return s; }
  if (agentsLeft(s, who) > 0) s.picker = other(who); // the turn passes, unless they have nothing left for you to find
  return s;
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
  if (s.phase === 'sudden') return [s.picker];
  return s.phase === 'clue' ? [s.giver] : [other(s.giver)];
}
function apply(s, who, mv) {
  if (s.over) throw new Error('The mission is over.');
  if (!mv || typeof mv !== 'object') throw new Error('That move didn’t make sense.');
  if (s.phase === 'sudden') return applySudden(s, who, mv);
  if (mv.setup !== undefined) {
    if (s.phase !== 'clue') throw new Error('The rules are already set.');
    return applySetup(s, who, mv);
  }
  if (s.phase === 'clue') {
    if (who !== s.giver) throw new Error('Wait for the clue.');
    if (mv.pick !== undefined || mv.stop) throw new Error('Wait for a clue first.');
    const clue = s.v === 2 ? checkClue(s.words, s.found, mv.clue) : cleanClue(s, mv.clue);
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
  else if (s.v === 2 && turn.picks.filter((p) => p.r === 'G').length > turn.n) endTurn(s); // n + 1 is the limit
  return s;
}
function result2(s) {
  const n = foundCount(s);
  const base = { winner: null, team: true, score: n };
  if (s.over === 'win') {
    if (s.sd) return { ...base, text: 'Mission complete', sub: `Escaped in sudden death: all ${TOTAL} agents found.` };
    const spare = tok(s) - s.turns;
    return { ...base, text: 'Mission complete', sub: `All ${TOTAL} agents found${spare ? ` with ${spare} turn${spare === 1 ? '' : 's'} to spare` : ' on the very last turn'}.` };
  }
  if (s.over === 'caught') return { ...base, text: 'Caught in sudden death', sub: `${up(s.words[s.hit])} was ${s.sd[s.sd.length - 1].r === 'K' ? 'an assassin' : 'a bystander'}. ${n} of ${TOTAL} agents found.` };
  if (s.over === 'burned') return { ...base, text: 'Burned', sub: `${up(s.words[s.hit])} was an assassin. ${n} of ${TOTAL} agents found.` };
  return { ...base, text: 'Out of time', sub: `The trail went cold at ${n} of ${TOTAL} agents.` };
}
function result(s) {
  if (s.v === 2) return result2(s);
  const n = foundCount(s);
  const base = { winner: null, team: true, score: n };
  if (s.over === 'win') {
    const spare = TOKENS - s.turns;
    return { ...base, text: 'Mission complete', sub: `All ${TOTAL} agents found${spare ? ` with ${spare} turn${spare === 1 ? '' : 's'} to spare` : ' on the very last turn'}.` };
  }
  if (s.over === 'burned') return { ...base, text: 'Burned', sub: `${up(s.words[s.hit])} was an assassin. ${n} of ${TOTAL} agents found.` };
  return { ...base, text: 'Out of time', sub: `The trail went cold at ${n} of ${TOTAL} agents.` };
}

// ── derived facts (read-only: records, stamps, the debrief) ──
const turnDone = (s, k) => k < s.log.length - 1 || !!s.over || s.phase !== 'guess';
const agentPicks = (t) => t.picks.filter((p) => p.r === 'G').length;
/** Mind meld: a clue for 2+ cards where the guesser found exactly n agents, no bystander, and the turn is over. */
const isMeld = (t, done) => done && t.n >= 2 && t.picks.length === t.n && agentPicks(t) === t.n;
/** Spotless: a win (sudden-death escapes included) without a single bystander tapped. Derived from state. */
const isSpotless = (s) => s.over === 'win' && !s.log.some((t) => t.picks.some((p) => p.r === 'N')) && !(s.sd || []).some((p) => p.r === 'N');
function matchStats(s) {
  const clues = s.log.map((t, k) => ({ k, by: t.by, clue: t.clue, n: t.n, got: agentPicks(t), meld: isMeld(t, turnDone(s, k)) }));
  const best = { a: 0, b: 0 };
  const bestOf = { a: null, b: null }; // each player's best clue (first one wins a tie)
  for (const c of clues) if (c.got > best[c.by]) { best[c.by] = c.got; bestOf[c.by] = c; }
  const top = clues.filter((c) => c.got > 0).sort((x, y) => y.got - x.got || (y.meld ? 1 : 0) - (x.meld ? 1 : 0) || x.k - y.k).slice(0, 2).sort((x, y) => x.k - y.k);
  return { clues, melds: clues.filter((c) => c.meld).length, best, bestOf, top, spare: s.over === 'win' && !s.sd ? tok(s) - s.turns : 0, tier: s.level || 'agent', pack: s.pack || 'classic' };
}

// ── records (api.data): flat numbers, bests only rise ──
// Ids of recently recorded matches (comma-joined, newest last). Core keeps the newest 25 finished online
// matches and local ones forever, so the memory is generous.
const RECENT_CAP = 60;
const recentIds = (str) => String(str || '').split(',').filter(Boolean);
const pushRecent = (str, id) => [...recentIds(str).filter((x) => x !== id), id].slice(-RECENT_CAP).join(',');
const MILESTONES = [10, 25, 50];
// A remembered clue: `ocean|4|b|us|<matchId>` (clue, agents found from it, who gave it, pack, match).
const fmtClue = (c, pack, matchId) => `${c.clue}|${c.got}|${c.by}|${pack}|${matchId}`;
const parseClue = (str) => { const [clue, got, by, pack, mid] = String(str || '').split('|'); return clue && Number(got) > 0 && (by === 'a' || by === 'b') ? { clue, got: Number(got), by, pack: pack || 'classic', mid: mid || '' } : null; };
/** The ledger line for the standing record clue, e.g. "Record clue: OCEAN for 4 (Sydney, Wanderlust)." */
const recordClueText = (d, nameOf) => { const r = parseClue(d.best_clue); return r ? `Record clue: ${r.clue.toUpperCase()} for ${r.got} (${nameOf(r.by)}, ${(PACK_INFO[r.pack] || PACK_INFO.classic).name}).` : ''; };
const streakLine = (n) => (n >= 2 ? `${NUMWORD[n] || n} missions unbeaten. Keep it clean.` : '');
/** "Record in reach" slip line (v2, guess phase). Reads the shared record; never writes it. */
function recLine(s, best) {
  const t = curTurn(s);
  const b = Number(best) || 0;
  if (s.v !== 2 || s.over || s.phase !== 'guess' || !t || t.picks.some((p) => p.r === 'N')) return '';
  // what the clue can still reach: its giver's unfound agents plus the ones this turn already found
  const reach = agentsLeft(s, t.by) + agentPicks(t);
  const found = agentPicks(t);
  if (t.n > b && b >= 2 && reach >= b + 1 && found < b + 1) return t.n === b + 1 ? `Crack all ${t.n} and it’s a new record.` : `Find ${b + 1} for a new record.`;
  if (t.n === b && b >= 3 && reach >= b) return `All ${t.n} would equal the record.`;
  if (t.n > b && b >= 3 && reach === b) return `Find ${b} to equal the record.`;
  return '';
}
/** Should a finished match be written to the records? `watched`: this phone saw it end live. A reopened match is
 *  only counted when it is v2, and only when the data snapshot is not empty (a fresh device must never overwrite). */
const shouldRecord = (d, s, matchId, watched) => !!matchId && !recentIds(d.recent_m).includes(matchId) && (watched || (s.v === 2 && (Number(d.missions_n) || 0) > 0));
/** The patch that records a finished mission, computed from a data snapshot `d`. Also returns the stamps earned. */
function recordPatch(d, s, matchId) {
  const g = (k) => Number(d[k]) || 0;
  const st = matchStats(s);
  const win = s.over === 'win';
  const badges = [];
  const p = { lastm: matchId, missions_n: g('missions_n') + 1 };
  if (s.sd) p.sudden_n = g('sudden_n') + 1;
  if (st.melds) p.meld_n = g('meld_n') + st.melds;
  p[`pack_${st.pack}_n`] = g(`pack_${st.pack}_n`) + 1;
  for (const w of ['a', 'b']) if (st.best[w] > g(`${w}_clue_best`)) { p[`${w}_clue_best`] = st.best[w]; p[`${w}_best_clue`] = fmtClue(st.bestOf[w], st.pack, matchId); }
  const clueBest = Math.max(st.best.a, st.best.b);
  if (clueBest > g('clue_best')) {
    p.clue_best = clueBest;
    p.best_clue = fmtClue(st.bestOf[st.best.a >= st.best.b ? 'a' : 'b'], st.pack, matchId);
    if (g('clue_best') > 0 && clueBest >= 3) badges.push('record'); // a clue record: NEW RECORD
  } else if (clueBest === g('clue_best') && clueBest >= 3) badges.push('tie');
  if (win) {
    p.wins_n = g('wins_n') + 1;
    p[`${st.tier}_wins_n`] = g(`${st.tier}_wins_n`) + 1;
    p.streak = g('streak') + 1;
    if (p.streak > g('streak_best')) { p.streak_best = p.streak; if (p.streak > 1) badges.push('streakbest'); }
    if (p.streak >= 2) badges.push(`row${p.streak}`);
    if (s.sd) p.escape_n = g('escape_n') + 1;
    if (st.spare > g('spare_best')) { p.spare_best = st.spare; if (g('spare_best') > 0) badges.push('sparebest'); }
    if (!s.sd && st.spare === 0) badges.push('last');
    if (s.sd) badges.push('escape');
    if (isSpotless(s)) { p.spotless_n = g('spotless_n') + 1; badges.push('spotless'); }
  } else {
    p.streak = 0;
    const n = foundCount(s);
    if (s.over === 'burned') p.burned_n = g('burned_n') + 1;
    else if (s.over === 'caught') p.caught_n = g('caught_n') + 1;
    else p.cold_n = g('cold_n') + 1;
    if (n > g('close_best')) { p.close_best = n; if (g('close_best') > 0) badges.push('closebest'); }
  }
  if (st.melds) badges.push(`meld${st.melds}`);
  if (MILESTONES.includes(p.missions_n)) badges.push(`ms${p.missions_n}`);
  p.lastb = [...new Set(badges)].join(',');
  return p;
}

// ── view ──
const ICON = {
  mask: '<svg class="g-ag-ico" viewBox="0 0 32 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M1.5 4.5C6 0.5 12 1.2 16 4c4-2.8 10-3.5 14.5 0.5 1.4 5.2-1.6 10-6.6 10-3.2 0-4.6-3-7.9-3s-4.7 3-7.9 3c-5 0-8-4.8-6.6-10zM5.2 7.6a3.6 2.4 0 1 0 7.2 0a3.6 2.4 0 1 0-7.2 0zM19.6 7.6a3.6 2.4 0 1 0 7.2 0a3.6 2.4 0 1 0-7.2 0z"/></svg>',
  cross: '<svg class="g-ag-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/></svg>',
};


// ── view helpers ──
const pristine = (s) => !s.v && !s.log.length && s.phase === 'clue' && !s.over;
const breakOf = (w) => BREAKS.get(w) || PACK_BREAKS.get(w);
const NUMWORD = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
function parseSetup(str) {
  const [lv, pk, sd] = String(str || '').split('|');
  return { level: Object.prototype.hasOwnProperty.call(LEVELS, lv) ? lv : 'agent', pack: PACK_IDS.includes(pk) ? pk : 'classic', sudden: sd !== '0' };
}
const EPILOGUES = {
  win: ['Debrief over coffee. You two are terrifying.', 'Every agent home, nobody the wiser. Order the good dessert.', 'Two keys, one brain. Please never use this against us.', 'File it under: suspiciously good teamwork.'],
  escape: ['No clues, no net, no mistakes. Frame that one.', 'You walked out of sudden death side by side. Dramatic.', 'The handler checked the tape twice. Nobody blinked.', 'Ice in your veins, both of you.'],
  burned: ['The handler regrets nothing. Mostly.', 'Somebody tapped the wrong word. We will not say who.', 'Cover blown. The rematch is already warm.', 'Even the best agents pick a bad word once.'],
  time: ['The trail went cold, but the agents went home together.', 'Not every mission ends in a bow. Go again.', 'Out of tokens, not out of ideas.', 'The clock won this round. The next one is yours.'],
  caught: ['So close the handler could taste it.', 'Sudden death does that. Breathe, then ask for a rematch.', 'One tap from the exit. Respect for the nerve.', 'Caught at the door. The best stories start like this.'],
};
function epilogue(s) {
  const list = EPILOGUES[s.over === 'win' && s.sd ? 'escape' : s.over] || EPILOGUES.time;
  return list[(Math.abs(Number(s.seed) || 0) + s.turns) % list.length];
}

const css = `
.g-agents { --gap: 6px; --ag-on-good: var(--g-white); flex: 1; min-height: 0; width: 100%; display: flex; flex-direction: column; gap: 10px; color: var(--g-ink); font-family: var(--g-font-body); touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .g-agents { --ag-on-good: var(--g-on-ink); } }
:root[data-theme="dark"] .g-agents { --ag-on-good: var(--g-on-ink); }
.g-ag-top { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.g-ag-say { margin: 0; min-height: 1.3em; text-align: center; font-weight: 800; font-size: 0.92rem; line-height: 1.3; text-wrap: balance; }
.g-ag-say.one { white-space: nowrap; }
@media (max-width: 380px) { .g-ag-say.one { overflow: hidden; text-overflow: ellipsis; } }
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
.g-ag-step button { width: 44px; min-height: 44px; color: var(--g-ink); font-weight: 900; font-size: 1.25rem; background: transparent; touch-action: manipulation; }
.g-ag-step button:active { background: var(--g-hl-soft); }
.g-ag-step output { min-width: 22px; display: grid; place-items: center; font-family: var(--g-font-display); font-weight: 900; font-size: 1.1rem; }
.g-ag-form .gm-btn { min-height: 48px; padding: 0 14px; }
@media (max-width: 380px) {
  .g-ag-form { flex-wrap: wrap; }
  .g-ag-input { flex: 1 1 100%; }
  .g-ag-form .g-ag-step { flex: none; }
  .g-ag-form .gm-btn { flex: 1 1 0; min-width: 0; padding: 0 8px; }
}

.g-ag-rec { margin-top: 1px; font-size: 0.68rem; font-weight: 800; line-height: 1.15; color: var(--g-ink); text-wrap: balance; }
.g-agents.has-rec .g-ag-card { height: clamp(44px, min(calc(var(--cw) * 0.8), calc((100dvh - 410px) / 5)), 96px); }
.g-ag-rec[hidden] { display: none; }

/* board: printed word cards, every word set at one size; long words break onto two lines */
.g-ag-body { display: flex; flex-direction: column; gap: 12px; }
.g-ag-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.g-ag-wrap { container-type: inline-size; width: 100%; }
.g-ag-grid { --gap: clamp(4px, 1.2cqw, 10px); --fs: 12px; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--gap); }
.g-ag-card { --cw: calc((100cqw - 4 * var(--gap)) / 5); --face: var(--g-card); --ink: var(--g-ink); position: relative; height: clamp(44px, min(calc(var(--cw) * 0.8), calc((100dvh - 395px) / 5)), 96px); min-width: 0; padding: 0 4px 9px; box-sizing: border-box; display: grid; place-items: center; overflow: hidden; border: 2px solid var(--g-ink); border-radius: var(--g-radius-sm); background-color: var(--face); color: var(--ink); box-shadow: var(--g-shadow); font-family: var(--g-font-body); font-weight: 900; text-transform: uppercase; cursor: default; transition: transform 0.12s ease; }
.g-ag-card::before { content: ''; position: absolute; left: 34%; right: 34%; bottom: 6px; height: 2px; border-radius: 1px; background: var(--g-line); }
.g-ag-word { position: relative; z-index: 1; max-width: 100%; display: block; text-align: center; font-size: var(--fs); line-height: 1.02; letter-spacing: 0; white-space: nowrap; }
.g-ag-word .hy { display: none; }
.g-ag-word.two .p { display: block; }
.g-ag-word.two .hy { display: inline; }
.g-ag-card .g-ag-ico { position: absolute; z-index: 0; left: 50%; bottom: 3px; width: 12px; height: 12px; transform: translateX(-50%); pointer-events: none; }
/* a card with an icon prints it where the rule would be */
.g-ag-card.k-K::before, .g-ag-card.is-found::before, .g-ag-card.is-hit::before { display: none; }
.g-ag-card.can { cursor: pointer; }
.g-ag-card.can:active { transform: translate(2px, 2px); box-shadow: var(--g-shadow-sm); }
.g-ag-card.is-sel { transform: translateY(-3px); box-shadow: 3px 5px 0 var(--g-edge); outline: 3px solid var(--g-hl); outline-offset: 1px; z-index: 2; }
.g-ag-card.dim { opacity: 0.55; }

/* the key overlay (yours, or the clue-giver's own) */
.g-ag-card.k-G { box-shadow: inset 0 0 0 3px var(--g-good), var(--g-shadow); }
.g-ag-card.k-G::after { content: ''; position: absolute; top: 0; left: 0; border-top: 10px solid var(--g-good); border-right: 10px solid transparent; }
.g-ag-card.k-K { background-image: repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--g-ink) 16%, transparent) 6px 8px); box-shadow: inset 0 0 0 3px var(--g-ink), var(--g-shadow); }

/* revealed */
.g-ag-card.is-found { --face: var(--g-good); --ink: var(--ag-on-good); background-image: none; }
.g-ag-card.is-found .g-ag-ico { width: 20px; height: 10px; bottom: 3px; opacity: 0.85; }
.g-ag-card.is-hit { --face: var(--g-ink); --ink: var(--g-bg); background-image: none; }
.g-ag-card.is-void { --face: color-mix(in srgb, var(--g-muted) 22%, var(--g-card)); --ink: var(--g-muted); box-shadow: none; }
.g-ag-tag { position: absolute; z-index: 2; bottom: 2px; width: 16px; height: 16px; box-sizing: border-box; display: grid; place-items: center; border: 1.5px solid var(--g-ink); border-radius: 4px; font: 900 11px/1 var(--g-font-body); font-style: normal; color: var(--g-on-ink); }
.g-ag-tag.t-a { left: 2px; background: var(--p-a); } .g-ag-tag.t-b { right: 2px; background: var(--p-b); }

/* dock */
.g-ag-dock { position: sticky; bottom: 0; z-index: 5; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 8px 0 max(6px, env(safe-area-inset-bottom)); background: var(--g-bg); }
.g-ag-dock.is-over { position: static; padding-bottom: 0; }
.g-ag-dock:empty { display: none; }
.g-ag-acts { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr); gap: 10px; }
.g-ag-acts.three { grid-template-columns: minmax(0, 0.9fr) minmax(0, 0.8fr) minmax(0, 1.5fr); gap: 8px; }
.g-ag-acts.two { grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.5fr); gap: 8px; }
.g-ag-acts .gm-btn { font-size: 0.88rem; }
.g-ag-acts.three .gm-btn, .g-ag-acts.two .gm-btn { padding: 6px 4px; }
.g-ag-mine[aria-pressed="true"] { background: var(--g-ink); color: var(--g-bg); }
.g-ag-clhead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.g-ag-acts .gm-btn { min-height: 48px; padding: 8px 10px; min-width: 0; }
.g-ag-acts .gm-btn span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-ag-row { display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; }
.g-ag-legend { display: flex; gap: 14px; font-size: 0.8rem; font-weight: 800; color: var(--g-muted); align-items: center; }
.g-ag-legend i { display: inline-block; width: 14px; height: 14px; margin-right: 5px; vertical-align: -2px; box-sizing: border-box; border-radius: 3px; border: 2px solid var(--g-ink); }
.g-ag-legend .lg-g { border-color: var(--g-good); background: linear-gradient(135deg, var(--g-good) 50%, transparent 50%); }
.g-ag-legend .lg-k { background: var(--g-card) repeating-linear-gradient(135deg, transparent 0 2px, color-mix(in srgb, var(--g-ink) 30%, transparent) 2px 3px); }
.g-ag-toggle { display: inline-flex; border: 2px solid var(--g-ink); border-radius: 999px; overflow: hidden; background: var(--g-card); box-shadow: var(--g-shadow-sm); }
.g-ag-toggle button { min-height: 44px; padding: 0 16px; font-weight: 800; font-size: 0.9rem; color: var(--g-ink); background: transparent; touch-action: manipulation; }
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


/* v2: rules card, sudden death, stamps */
.g-ag-rules[hidden], .g-ag-banner[hidden] { display: none; }
.g-agents.is-setup .g-ag-slip, .g-agents.is-setup .g-ag-wrap, .g-agents.is-setup .g-ag-dock, .g-agents.is-setup .g-ag-side, .g-agents.is-setup .g-ag-meta { display: none; }
.g-ag-card-rules { box-sizing: border-box; width: 100%; max-width: 480px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; padding: 14px 12px 12px; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow); }
.g-ag-h { margin: 0; font: 900 1.05rem var(--g-font-display); text-transform: uppercase; letter-spacing: 0.04em; }
.g-ag-wait { margin: 0; font-weight: 800; }
.g-ag-opt { display: flex; flex-direction: column; gap: 6px; }
.g-ag-seg { display: grid; gap: 6px; }
.g-ag-seg.s3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.g-ag-seg.s2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.g-ag-seg button { min-height: 48px; box-sizing: border-box; padding: 5px 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; border: 2px solid var(--g-ink); border-radius: var(--g-radius-sm); background: var(--g-card); color: var(--g-ink); text-align: center; touch-action: manipulation; }
.g-ag-seg button b { font-weight: 900; font-size: 0.95rem; }
.g-ag-seg button small { font-size: 0.68rem; font-weight: 700; line-height: 1.15; color: var(--g-muted); }
.g-ag-seg button[aria-pressed="true"] { background: var(--g-ink); color: var(--g-bg); box-shadow: var(--g-shadow-sm); }
.g-ag-seg button[aria-pressed="true"] small { color: inherit; opacity: 0.85; }
.g-ag-playbar { position: sticky; bottom: 0; z-index: 5; box-sizing: border-box; width: 100%; max-width: 480px; margin: 0 auto; padding: 8px 0 max(6px, env(safe-area-inset-bottom)); background: var(--g-bg); }
@media (max-height: 700px) {
  .g-ag-card-rules { gap: 8px; padding: 10px; }
  .g-ag-h { display: none; }
  .g-ag-seg button { min-height: 44px; }
}
.g-ag-ledger { display: flex; flex-wrap: wrap; justify-content: center; gap: 2px 12px; font-size: 0.76rem; font-weight: 800; color: var(--g-muted); text-align: center; }
.g-ag-ledger b { color: var(--g-ink); }
.g-ag-banner { margin: 0; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 900; font-size: 0.9rem; }
.g-ag-last { color: var(--g-bad); text-transform: uppercase; letter-spacing: 0.06em; }
.g-ag-stamp { display: inline-block; padding: 3px 9px; border: 3px solid currentColor; border-radius: 6px; font: 900 0.74rem/1.15 var(--g-font-display); letter-spacing: 0.06em; text-transform: uppercase; transform: rotate(var(--r, -3deg)); }
.g-ag-stamp.k-rec { color: var(--p-b-text); }
.g-ag-stamp.k-a { color: var(--p-a-text); }
.g-ag-stamp.k-bad { color: var(--g-bad); }
.g-ag-stamp.k-good { color: var(--g-good); }
.g-ag-stamp.k-ink { color: var(--g-ink); }
.g-ag-stamp.k-gold { background: var(--g-hl); color: var(--g-on-ink); border-color: var(--g-on-ink); }
.g-ag-debrief { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.g-ag-epi { margin: 0; text-align: center; font-weight: 800; font-size: 0.92rem; text-wrap: balance; }
.g-ag-stamps { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 10px; padding: 4px 0; }
.g-ag-best { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.g-ag-best > small { font-size: 0.7rem; font-weight: 800; color: var(--g-muted); text-transform: uppercase; letter-spacing: 0.1em; }
.g-ag-best > div { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 100%; }
.g-ag-paper.sm .g-ag-clueword { font-size: 1.05rem; }
.g-ag-paper.sm { position: relative; }
.g-ag-over { position: absolute; top: -9px; right: 6px; padding: 1px 6px; border: 2px solid var(--p-b-text); border-radius: 4px; background: var(--g-card); color: var(--p-b-text); font: 900 0.58rem/1.2 var(--g-font-display); letter-spacing: 0.06em; text-transform: uppercase; transform: rotate(3deg); }
.g-ag-paper.meld, .g-ag-log li.meld { background: var(--g-hl); color: var(--g-on-ink); }
.g-ag-paper.meld small, .g-ag-log li.meld .g-ag-chip.r-N { color: var(--g-on-ink); }
.g-ag-log li.meld { border-color: var(--g-ink); }
.g-ag-melded { font: 900 0.62rem var(--g-font-display); letter-spacing: 0.06em; text-transform: uppercase; border: 2px solid currentColor; border-radius: 4px; padding: 1px 5px; transform: rotate(-3deg); }
.g-ag-log li.g-ag-sd { border-color: var(--g-bad); }
.g-ag-left { display: inline; font-size: 0.68rem; text-transform: none; letter-spacing: 0; font-weight: 800; color: var(--g-muted); }
.g-ag-tok.sudden { width: 18px; height: 18px; background: var(--g-bad); border-color: var(--g-ink); }
.g-ag-tok.last { background: var(--g-bad); border-color: var(--g-ink); }
@keyframes g-ag-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.4); } }
.g-ag-tok.sudden, .g-ag-tok.last { animation: g-ag-pulse 1.1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .g-ag-tok.sudden, .g-ag-tok.last { animation: none; } }

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
  .g-ag-card .g-ag-ico { width: 17px; height: 17px; bottom: 5px; }
  .g-ag-card.is-found .g-ag-ico { width: 28px; height: 14px; bottom: 6px; }
  .g-ag-acts, .g-ag-end { max-width: 460px; }
}


/* landscape phones: board on the left, slip / actions / history on the right, all inside the short viewport */
@media (orientation: landscape) and (max-height: 500px) {
  .g-agents { gap: 4px; }
  .g-ag-top { flex-direction: row; justify-content: space-between; align-items: center; gap: 12px; }
  .g-ag-say { min-height: 0; flex: 1 1 auto; text-align: center; font-size: 0.8rem; line-height: 1.2; }
  .g-ag-meta { flex: none; gap: 10px; font-size: 0.72rem; }
  .g-ag-banner { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); justify-content: flex-start; }
  .g-ag-banner .g-ag-stamp { transform: none; }
  .g-ag-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(250px, 36%); grid-template-rows: auto auto minmax(0, 1fr); gap: 6px 12px; align-items: start; }
  .g-ag-main { display: contents; }
  .g-ag-rules { grid-column: 1 / -1; grid-row: 1; }
  .g-ag-wrap { grid-column: 1; grid-row: 1 / span 3; }
  .g-ag-slip { grid-column: 2; grid-row: 1; justify-content: stretch; }
  .g-ag-dock, .g-ag-dock.is-over { grid-column: 2; grid-row: 2; position: static; padding: 0; gap: 6px; }
  .g-ag-side { grid-column: 2; grid-row: 3; max-height: 100px; overflow-y: auto; padding: 0; }
  .g-ag-side h3 { margin-bottom: 4px; }
  .g-ag-log li { padding: 4px 8px; }
  .g-ag-grid { --gap: 3px; }
  .g-ag-card, .g-agents.has-rec .g-ag-card { height: clamp(36px, calc((100dvh - 205px) / 5), 48px); padding-bottom: 4px; }
  .g-ag-card::before { bottom: 3px; }
  .g-ag-card .g-ag-ico { display: none; }
  .g-ag-paper { padding: 4px 8px 5px 12px; }
  .g-ag-form { flex-wrap: wrap; }
  .g-ag-input { flex: 1 1 100%; }
  .g-ag-form .g-ag-step { flex: none; }
  .g-ag-form .gm-btn { flex: 1 1 0; min-width: 0; }
  .g-ag-form .gm-btn, .g-ag-input { min-height: 44px; height: 44px; }
  .g-ag-acts .gm-btn { min-height: 44px; }
  .g-ag-end .gm-btn { min-height: 44px; }
  .g-ag-card-rules { gap: 6px; padding: 8px 10px; }
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
    'Find all 15 agents before the turns run out (pick your level first). Then it\u2019s sudden death: no clues.',
  ],
  css,
  endDelay: 1300,
  endLookLabel: 'See the board',
  init, next, apply, result,
  // exposed for tests
  _test: { isSpotless, recLine, shouldRecord, makeKeys, pickWords, NOUNS, LAYOUT, TOKENS, TOTAL, BREAKS, cleanClue, cleanClue2: (s, x) => checkClue(s.words, s.found, x), PACKS, PACK_BREAKS, packWords: (seed, pack) => packWords(seed, pack, NOUNS), LEVELS, matchStats, recordPatch, isMeld, recordClueText, streakLine, parseClue, recentIds, pushRecent, RECENT_CAP },

  mount(el, api) {
    el.innerHTML = `<div class="g-agents">
      <div class="g-ag-top">
        <p class="g-ag-say" aria-live="polite"></p>
        <div class="g-ag-meta"><div class="g-ag-tokens" role="img"></div><div class="g-ag-count"></div></div>
        <p class="g-ag-banner" hidden></p>
      </div>
      <div class="g-ag-body">
        <div class="g-ag-main">
          <div class="g-ag-rules" hidden></div>
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
    const bannerEl = q('.g-ag-banner');
    const rules = q('.g-ag-rules');
    const slip = q('.g-ag-slip');
    const grid = q('.g-ag-grid');
    const dock = q('.g-ag-dock');
    const logEl = q('.g-ag-log');

    let ctx = null;
    let sel = null; // selected card index (guesser)
    let selAt = 0; // when it was selected (a double-tap must not confirm)
    let lockUntil = 0; // taps are ignored briefly after a move is sent
    let showMine = false; // guesser: show my own key
    let keyView = null; // game over: whose key to show
    let num = 2; // clue number draft
    let prevMoves = null;
    let prevOver; // was the match over at the previous update (undefined before the first)
    let anim = null; // { i, kind } newest pick to animate
    let slipSig = '';
    let rulesSig = '';
    let viewKey = '';
    let draft = parseSetup(safeData().last_setup); // the rules card remembers the last choice
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const nm = (w) => esc(api.name(w));
    const ini = (w) => esc((api.name(w) || w).trim().charAt(0).toUpperCase());
    const who = (w) => `<span class="g-ag-who p-${w}">${nm(w)}</span>`;
    const stamp = () => Date.now();
    function safeData() { try { return api.data() || {}; } catch { return {}; } }

    // A half-typed clue survives a reload (this device only).
    const DRAFT = 'ju.agents.draft.';
    const draftKey = (c) => `${c.viewer}|${c.state.turns}`;
    const draftGet = (c) => { try { const v = JSON.parse(localStorage.getItem(DRAFT + c.matchId) || 'null'); return v && v.k === draftKey(c) ? v : null; } catch { return null; } };
    const draftSet = (c, t, n) => { try { if (!t) localStorage.removeItem(DRAFT + c.matchId); else localStorage.setItem(DRAFT + c.matchId, JSON.stringify({ k: draftKey(c), t, n })); } catch { /* storage off */ } };

    function roleOf(c) {
      const s = c.state;
      if (c.over) return 'over';
      if (!c.viewer) return 'blank';
      if (s.phase === 'sudden') return c.viewer === s.picker ? 'sudden' : 'sudden-watch';
      if (pristine(s)) return c.viewer === s.giver ? 'setup' : 'await-setup';
      if (s.phase === 'clue') return c.viewer === s.giver ? 'give' : 'await-clue';
      return c.viewer === s.giver ? 'watch' : 'guess';
    }
    const guessing = (c) => { const r = roleOf(c); return r === 'guess' || r === 'sudden'; };
    function shownKey(c) {
      const role = roleOf(c);
      if (role === 'over') return keyView || c.viewer || c.first || 'a';
      if (role === 'blank' || role === 'setup' || role === 'await-setup') return null;
      if (role === 'give' || role === 'watch' || role === 'sudden-watch') return c.viewer; // the key being guessed
      return showMine ? c.viewer : null;
    }
    const pickable = (c, i) => {
      const s = c.state;
      return c.canMove && guessing(c) && !s.found[i] && !s.miss[judgeOf(s)].includes(i);
    };

    function wordHTML(w) {
      const parts = breakOf(w);
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
      else if (s.hit === i) { cls.push('is-hit'); ico = ICON.cross; label += s.over === 'caught' && s.sd[s.sd.length - 1].r === 'N' ? ', bystander, caught' : ', assassin'; }
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
      else if (guessing(c) && c.canMove && !s.found[i]) cls.push('dim');
      if (sel === i) cls.push('is-sel');
      if (anim && anim.i === i) cls.push(anim.kind);
      const tags = s.found[i] || s.hit === i ? '' : `${s.miss.a.includes(i) ? `<i class="g-ag-tag t-a" aria-hidden="true">${ini('a')}</i>` : ''}${s.miss.b.includes(i) ? `<i class="g-ag-tag t-b" aria-hidden="true">${ini('b')}</i>` : ''}`;
      return `<button class="${cls.join(' ')}" data-i="${i}" style="--i:${i}" aria-label="${label}"${can ? '' : ' aria-disabled="true"'}>${ico}${wordHTML(w)}${tags}</button>`;
    }

    function renderGrid() {
      const c = ctx;
      const role = roleOf(c);
      if ((!c.viewer && !c.over) || role === 'setup' || role === 'await-setup') { grid.innerHTML = ''; return; }
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
      const avail = card.clientWidth - 9;
      const availH = card.clientHeight - parseFloat(getComputedStyle(card).paddingBottom) - 7;
      if (avail < 20 || availH < 16) return;
      meter = meter || document.createElement('canvas').getContext('2d');
      const cs = getComputedStyle(spans[0]);
      meter.font = `${cs.fontWeight} 100px ${cs.fontFamily}`;
      const em = (t) => meter.measureText(t).width / 100;
      let fs = Math.min(22, card.clientHeight * 0.3);
      const plan = spans.map((sp) => {
        const w = up(sp.dataset.w);
        const parts = breakOf(sp.dataset.w);
        const one = em(w);
        const two = parts ? Math.max(em(up(parts[0]) + '-'), em(up(parts[1]))) : Infinity;
        fs = Math.min(fs, Math.max(avail / one, Math.min(avail / two, availH / 2.06)));
        return { sp, one };
      });
      fs = Math.max(11, fs);
      grid.style.setProperty('--fs', `${fs.toFixed(1)}px`);
      for (const p of plan) p.sp.classList.toggle('two', p.one * fs > avail + 0.5);
    }
    let fitW = 0;
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { const w = grid.clientWidth; if (w !== fitW) { fitW = w; fit(); } }) : null;
    if (ro) ro.observe(grid);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (grid.isConnected) fit(); });

    // ── ledger, stamps, debrief ──
    function ledgerHTML() {
      const d = safeData();
      const g = (k) => Number(d[k]) || 0;
      if (!g('missions_n')) return '<div class="g-ag-ledger"><span>No missions logged yet. Make the first one count.</span></div>';
      const bits = [`<b>${g('missions_n')}</b> mission${g('missions_n') === 1 ? '' : 's'}`, `<b>${g('wins_n')}</b> home safe`];
      if (g('spare_best')) bits.push(`best: <b>${g('spare_best')}</b> turn${g('spare_best') === 1 ? '' : 's'} to spare`);
      else if (g('close_best')) bits.push(`closest call: <b>${g('close_best')}</b>/${TOTAL}`);
      if (g('meld_n')) bits.push(`<b>${g('meld_n')}</b> mind meld${g('meld_n') === 1 ? '' : 's'}`);
      if (g('spotless_n')) bits.push(`<b>${g('spotless_n')}</b> spotless`);
      const lines = [`<div class="g-ag-ledger">${bits.map((b) => `<span>${b}</span>`).join('')}</div>`];
      const rc = recordClueText(d, (w) => api.name(w));
      if (rc) lines.push(`<div class="g-ag-ledger"><span>${esc(rc)}</span></div>`);
      if (g('streak') >= 2) lines.push(`<div class="g-ag-ledger"><span>${esc(streakLine(g('streak')))}</span></div>`);
      return lines.join('');
    }
    const STAMP_TEXT = (b) => {
      if (b === 'record') return ['NEW RECORD', 'rec'];
      if (b === 'tie') return ['EQUALS THE RECORD', 'rec'];
      if (b === 'sparebest') return ['MOST TURNS SPARE', 'rec'];
      if (b === 'streakbest') return ['STREAK RECORD', 'rec'];
      if (b === 'closebest') return ['CLOSEST CALL YET', 'rec'];
      if (b === 'last') return ['ON THE LAST TOKEN', 'bad'];
      if (b === 'escape') return ['SUDDEN-DEATH ESCAPE', 'good'];
      if (b === 'spotless') return ['NOT ONE WRONG TAP', 'good'];
      let m = /^row(\d+)$/.exec(b);
      if (m) return [`${m[1]} IN A ROW`, 'a'];
      m = /^meld(\d+)$/.exec(b);
      if (m) return [Number(m[1]) > 1 ? `MIND MELD ×${m[1]}` : 'MIND MELD', 'gold'];
      m = /^ms(\d+)$/.exec(b);
      if (m) return [`MISSION No. ${m[1]}`, 'ink'];
      return null;
    };
    function stampsFor(c) {
      const s = c.state;
      const st = matchStats(s);
      const d = safeData();
      const set = new Set();
      if (s.over === 'win' && !s.sd && st.spare === 0) set.add('last');
      if (s.over === 'win' && s.sd) set.add('escape');
      if (isSpotless(s)) set.add('spotless');
      if (st.melds) set.add(`meld${st.melds}`);
      if (d.lastm === c.matchId && d.lastb) for (const b of String(d.lastb).split(',')) if (b) set.add(b);
      return [...set].map(STAMP_TEXT).filter(Boolean);
    }
    function debriefHTML(c) {
      const s = c.state;
      const st = matchStats(s);
      const stamps = stampsFor(c).map(([t, k], n) => `<span class="g-ag-stamp k-${k}" style="--r:${n % 2 ? 3 : -4}deg">${t}</span>`).join('');
      const dd = safeData();
      const recd = dd.lastm === c.matchId ? parseClue(dd.best_clue) : null;
      const over = (t) => (recd && recd.mid === c.matchId && recd.clue === t.clue && recd.by === t.by ? 'Record' : dd.lastm === c.matchId && String(dd.lastb || '').split(',').includes('tie') && t.got === Number(dd.clue_best) ? 'Equals the record' : '');
      const best = st.top.map((t) => `<div class="g-ag-paper sm${t.meld ? ' meld' : ''}">${over(t) ? `<i class="g-ag-over">${over(t)}</i>` : ''}<div class="g-ag-cluebox"><small>${nm(t.by)}’s clue${t.meld ? ' · mind meld' : ''}</small><span class="g-ag-clueword">${esc(t.clue)}</span></div><span class="g-ag-num" aria-label="${t.got} of ${t.n}">${t.got}</span></div>`).join('');
      return `<div class="g-ag-debrief">
        <p class="g-ag-epi">${esc(epilogue(s))}</p>
        ${stamps ? `<div class="g-ag-stamps">${stamps}</div>` : ''}
        ${best ? `<div class="g-ag-best"><small>Best clue${st.top.length > 1 ? 's' : ''} of the mission</small><div>${best}</div></div>` : ''}
        ${ledgerHTML()}
      </div>`;
    }
    // Records: once per match, on the phone that watched it end. Counters are absolute values from
    // the data snapshot, so two phones recording the same match write the same numbers.
    // `watched`: this phone saw the match end during this mount. Anything else (a finished match opened
    // later from the hub) only counts if it is a v2 match nobody recorded; v1 matches never count on reopen.
    function maybeRecord(c, watched) {
      if (!c.over || !c.matchId) return;
      const d = safeData();
      if (!shouldRecord(d, c.state, c.matchId, watched)) return;
      try { api.setData({ ...recordPatch(d, c.state, c.matchId), recent_m: pushRecent(d.recent_m, c.matchId) }); } catch { /* records are a bonus */ }
    }

    // ── the rules card (first giver, before the first clue) ──
    function renderRules() {
      const c = ctx;
      const role = roleOf(c);
      const on = role === 'setup' || role === 'await-setup';
      rules.hidden = !on;
      root.classList.toggle('is-setup', on);
      if (!on) { rulesSig = ''; return; }
      const sig = JSON.stringify([role, c.canMove, draft, safeData().missions_n, safeData().lastm, c.state.giver]);
      if (sig === rulesSig) return;
      rulesSig = sig;
      if (role === 'await-setup') {
        rules.innerHTML = `<div class="g-ag-card-rules"><h2 class="g-ag-h">Mission briefing</h2><p class="g-ag-wait">Waiting for ${who(c.state.giver)} to set the rules…</p>${ledgerHTML()}</div>`;
        return;
      }
      const lv = Object.entries(LEVELS).map(([id, t]) => `<button type="button" data-lv="${id}" aria-pressed="${draft.level === id}"><b>${id[0].toUpperCase()}${id.slice(1)}</b><small>${t} turns</small></button>`).join('');
      const pk = PACK_IDS.map((id) => `<button type="button" data-pk="${id}" aria-pressed="${draft.pack === id}"><b>${PACK_INFO[id].name}</b><small>${PACK_INFO[id].blurb}</small></button>`).join('');
      rules.innerHTML = `<div class="g-ag-card-rules">
        <h2 class="g-ag-h">Mission briefing</h2>
        <div class="g-ag-opt"><span class="g-label">Difficulty</span><div class="g-ag-seg s3" role="group" aria-label="Difficulty">${lv}</div></div>
        <div class="g-ag-opt"><span class="g-label">Word pack</span><div class="g-ag-seg s2" role="group" aria-label="Word pack">${pk}</div></div>
        <div class="g-ag-opt"><span class="g-label">Sudden death</span><div class="g-ag-seg s2" role="group" aria-label="Sudden death"><button type="button" data-sd="1" aria-pressed="${draft.sudden}"><b>On</b><small>No clues, one pick each</small></button><button type="button" data-sd="0" aria-pressed="${!draft.sudden}"><b>Off</b><small>Out of turns: mission over</small></button></div></div>
        ${ledgerHTML()}
      </div><div class="g-ag-playbar"><button class="gm-btn gm-btn-big g-ag-play" type="button" data-act="play"${c.canMove ? '' : ' disabled'}>Play</button></div>`;
    }

    function renderTop() {
      const c = ctx;
      const s = c.state;
      const role = roleOf(c);
      const g = s.giver;
      const t = curTurn(s);
      const T = tok(s);
      const left = T - s.turns;
      const sudden = s.phase === 'sudden';
      const last = !c.over && !sudden && !pristine(s) && left <= 1;
      let text = '';
      if (role === 'setup') text = 'Set the rules, then give the first clue.';
      else if (role === 'await-setup') text = ''; // the briefing card says it once
      else if (role === 'give') text = `Your clue: one word and a number for your <b>green</b> agents (${agentsLeft(s, g)} left).`;
      else if (role === 'await-clue') text = `${who(g)} is thinking of a clue…`;
      else if (role === 'guess') text = t.picks.length ? 'Nice. Keep going, or end the turn.' : `Tap ${who(g)}’s agents.`;
      else if (role === 'watch') text = `${who(other(g))} is guessing your clue…`;
      else if (role === 'sudden') text = `<b>Sudden death: no clues, no mistakes.</b> Find ${who(other(s.picker))}’s agents.`;
      else if (role === 'sudden-watch') text = `<b>Sudden death.</b> ${who(s.picker)} is picking from your key…`;
      else if (role === 'over') {
        text = s.over === 'win' ? (s.sd ? 'Escaped! Every agent is home.' : 'Mission complete. Every agent is home.')
          : s.over === 'burned' ? `Burned. ${up(s.words[s.hit])} was an assassin.`
            : s.over === 'caught' ? `Caught in sudden death. ${up(s.words[s.hit])} was ${s.sd[s.sd.length - 1].r === 'K' ? 'an assassin' : 'a bystander'}.`
              : 'Out of time. The trail went cold.';
      }
      sayEl.classList.toggle('one', role === 'guess');
      sayEl.innerHTML = (last && (role === 'give' || role === 'guess' || role === 'watch' || role === 'await-clue') ? '<b class="g-ag-last">Last call.</b> ' : '') + text;
      const turnNow = s.phase === 'guess' && !s.over;
      if (sudden || (c.over && s.sd)) {
        tokEl.innerHTML = '<span class="g-ag-tok sudden"></span><span>Sudden death</span>';
        tokEl.setAttribute('aria-label', 'Sudden death');
      } else {
        tokEl.innerHTML = Array.from({ length: T }, (_, i) => `<span class="g-ag-tok${i < s.turns - (turnNow ? 1 : 0) ? ' used' : i === s.turns - 1 && turnNow ? ' now' : ''}${last && i === T - 1 ? ' last' : ''}"></span>`).join('') + (c.over && s.over === 'win' ? '' : `<span>${left} turn${left === 1 ? '' : 's'} left</span>`);
        tokEl.setAttribute('aria-label', `${left} of ${T} turns left`);
      }
      countEl.innerHTML = `Agents <b>${foundCount(s)}</b>/${TOTAL}`;
      // mind meld: the clue slip prints in gold for the turn that just ended
      const lastIdx = s.log.length - 1;
      const meldNow = lastIdx >= 0 && (s.over ? s.over === 'win' : s.phase === 'clue') && isMeld(s.log[lastIdx], turnDone(s, lastIdx));
      bannerEl.hidden = !meldNow;
      if (meldNow) { const n = s.log[lastIdx].n; bannerEl.innerHTML = `<span class="g-ag-stamp k-gold" style="--r:-2deg">Mind meld</span> ${NUMWORD[n] || n} for ${NUMWORD[n] ? NUMWORD[n].toLowerCase() : n}.`; }
    }

    function renderSlip() {
      const c = ctx;
      const s = c.state;
      const role = roleOf(c);
      const t = curTurn(s);
      const sig = JSON.stringify([role, c.viewer, s.giver, s.log.length, c.canMove]);
      if (sig !== slipSig) {
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
          slip.innerHTML = `<div class="g-ag-paper${fresh ? ' fresh' : ''}"><div class="g-ag-cluebox"><span class="g-ag-clhead"><small>${nm(t.by)}’s clue</small>${s.v === 2 ? '<span class="g-ag-left"></span>' : ''}</span><span class="g-ag-clueword" style="--len:${t.clue.length}">${esc(t.clue)}</span>${s.v === 2 ? '<span class="g-ag-rec" hidden></span>' : ''}</div><span class="g-ag-num" aria-label="${t.n} cards">${t.n}</span></div>`;
        } else slip.innerHTML = '';
      }
      const lf = slip.querySelector('.g-ag-left');
      if (lf && t) { const k = Math.max(0, t.n + 1 - agentPicks(t)); lf.textContent = `${k} pick${k === 1 ? '' : 's'} left`; }
      syncRec();
    }
    // the record-in-reach line: shown only while it applies, read from the shared data
    function syncRec() {
      if (!ctx) return;
      const rec = slip.querySelector('.g-ag-rec');
      const text = rec ? recLine(ctx.state, safeData().clue_best) : '';
      if (rec) { rec.textContent = text; rec.hidden = !text; }
      root.classList.toggle('has-rec', !!text);
    }

    function renderDock() {
      const c = ctx;
      const s = c.state;
      const role = roleOf(c);
      const t = curTurn(s);
      const mineBtn = `<button class="gm-btn gm-btn-ghost g-ag-mine" data-act="mine" aria-pressed="${showMine}" aria-label="Show my key"><span>My key</span></button>`;
      const mine = `<div class="g-ag-row">${mineBtn}</div>`;
      const legend = (whose) => `<div class="g-ag-legend" aria-hidden="true"><span><i class="lg-g"></i>${whose} agents</span><span><i class="lg-k"></i>assassins</span></div>`;
      const pickBtn = sel != null ? `<button class="gm-btn" data-act="pick"><span>Pick ${up(s.words[sel])}</span></button>` : '<button class="gm-btn" data-act="pick" disabled><span>Tap a word</span></button>';
      let h = '';
      if (role === 'guess' && c.canMove) {
        h = `${showMine ? legend('your') : ''}<div class="g-ag-acts three"><button class="gm-btn gm-btn-ghost" data-act="stop"${t.picks.length ? '' : ' disabled'}>End turn</button>${mineBtn}${pickBtn}</div>`;
      } else if (role === 'sudden' && c.canMove) {
        h = `${showMine ? legend('your') : ''}<div class="g-ag-acts two">${mineBtn}${pickBtn}</div>`;
      } else if (role === 'give' || role === 'watch' || role === 'sudden-watch') {
        h = legend('your');
      } else if (role === 'await-clue' || role === 'guess' || role === 'sudden') {
        h = `${mine}${showMine ? legend('your') : ''}`;
      } else if (role === 'over') {
        const k = shownKey(c);
        h = `${debriefHTML(c)}<div class="g-ag-toggle" role="group" aria-label="Show a key">${['a', 'b'].map((w) => `<button data-act="key" data-w="${w}" aria-pressed="${k === w}">${nm(w)}’s key</button>`).join('')}</div>
          <div class="g-ag-end"><button class="gm-btn" data-g="rematch">Play again</button><button class="gm-btn gm-btn-ghost" data-g="close">Back to games</button></div>`;
      }
      dock.classList.toggle('is-over', role === 'over');
      dock.innerHTML = h;
    }

    function renderLog() {
      const s = ctx.state;
      if (!s.log.length) { logEl.innerHTML = '<li class="g-ag-empty">No clues yet.</li>'; return; }
      const chips = (list) => list.map((p) => `<span class="g-ag-chip r-${p.r}" title="${p.r === 'G' ? 'agent' : p.r === 'K' ? 'assassin' : 'bystander'}">${s.words[p.i]}</span>`).join('');
      const rows = s.log.map((t, n) => {
        const meld = isMeld(t, turnDone(s, n));
        return `<li class="${n === s.log.length - 1 && s.phase === 'guess' && !s.over ? 'now' : ''}${meld ? ' meld' : ''}">
        <span class="g-ag-by p-${t.by}" aria-label="${nm(t.by)}">${ini(t.by)}</span><b>${esc(t.clue)}</b><span class="g-ag-num" aria-label="${t.n} cards">${t.n}</span>${meld ? '<span class="g-ag-melded">Mind meld</span>' : ''}
        <span class="g-ag-chips">${chips(t.picks)}</span>
      </li>`;
      }).reverse();
      if (s.sd && s.sd.length) rows.unshift(`<li class="g-ag-sd"><b>Sudden death</b><span class="g-ag-chips">${chips(s.sd)}</span></li>`);
      logEl.innerHTML = rows.join('');
    }

    function render() {
      if (!ctx) return;
      renderRules();
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
      lockUntil = stamp() + 400;
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
    rules.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !ctx) return;
      if (b.dataset.lv) draft = { ...draft, level: b.dataset.lv };
      else if (b.dataset.pk) draft = { ...draft, pack: b.dataset.pk };
      else if (b.dataset.sd) draft = { ...draft, sudden: b.dataset.sd === '1' };
      else if (b.dataset.act === 'play' && ctx.canMove) {
        const r = api.move({ setup: { v: 2, level: draft.level, pack: draft.pack, sudden: draft.sudden } });
        if (!r.ok) { api.toast(r.error); api.sfx('bad'); return; }
        lockUntil = stamp() + 400;
        try { api.setData({ last_setup: `${draft.level}|${draft.pack}|${draft.sudden ? 1 : 0}` }); } catch { /* optional */ }
        api.sfx('place');
        return;
      } else return;
      api.sfx('tick');
      renderRules();
    });

    function pick(i) {
      const c = ctx;
      if (!c || !pickable(c, i)) return;
      const r = api.move({ pick: i });
      sel = null;
      if (!r.ok) { api.toast(r.error); api.sfx('bad'); render(); } else lockUntil = stamp() + 400;
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
      if (stamp() < lockUntil) { // right after a move: a stray second tap, not a new choice (but show it was felt)
        b.classList.remove('thunk');
        void b.offsetWidth;
        b.classList.add('thunk');
        later(() => b.classList.remove('thunk'), 380);
        return;
      }
      if (sel === i) {
        if (stamp() - selAt < 350) return; // a double-tap selects; it never commits
        pick(i);
        return;
      }
      sel = i;
      selAt = stamp();
      api.sfx('tap');
      renderGrid();
      renderDock();
    });
    dock.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || b.disabled || !ctx) return;
      const act = b.dataset.act;
      if ((act === 'pick' || act === 'stop') && stamp() < lockUntil) return;
      if (act === 'pick' && sel != null) pick(sel);
      else if (act === 'stop') {
        const r = api.move({ stop: true });
        sel = null;
        if (!r.ok) { api.toast(r.error); api.sfx('bad'); } else { lockUntil = stamp() + 400; api.sfx('tick'); }
      } else if (act === 'mine') { showMine = !showMine; api.sfx('flip'); renderGrid(); renderDock(); }
      else if (act === 'key') { keyView = b.dataset.w; api.sfx('flip'); renderGrid(); renderDock(); }
    });
    const offData = api.onData(() => { if (ctx) { rulesSig = ''; renderRules(); syncRec(); if (ctx.over) renderDock(); } });

    return {
      update(c) {
        const vk = `${c.viewer}|${c.curtain}`;
        if (vk !== viewKey) { viewKey = vk; showMine = false; sel = null; slipSig = ''; }
        ctx = c;
        const s = c.state;
        anim = null;
        if (!guessing(c) || !c.canMove) sel = null;
        if (sel != null && !pickable(c, sel)) sel = null;
        const watched = prevOver === false && !!c.over && prevMoves != null && c.moves > prevMoves;
        prevOver = !!c.over;
        if (c.over) { draftSet(c, ''); maybeRecord(c, watched); }
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
        grid.classList.toggle('boom', (s.over === 'burned' || s.over === 'caught') && !!anim);
        grid.classList.toggle('party', s.over === 'win' && !!anim);
      },
      destroy() { for (const t of timers) clearTimeout(t); timers.clear(); if (ro) ro.disconnect(); if (typeof offData === 'function') offData(); },
    };
  },
});
