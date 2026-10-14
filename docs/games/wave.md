# Same Wave — design

A Wavelength-style mind-meld for two (co-op, `team: true`, `secret: true`). One of you sees where the target hides on a spectrum
("Cold … Hot") and types a short clue; the other turns a dial to where the clue belongs. Eight rounds, the clue-giver alternates, Emerson (`a`)
and Sydney (`b`) share one score. Entry `js/games/wave.js`; helpers in `js/games/wave/`.

| File | What |
|---|---|
| `js/games/wave.js` | `registerGame`, the v1 rules (untouched), the 139 classic `CARDS` (never edit, reorder or append), hooks into v2 |
| `js/games/wave/rules.js` | v2: the setup move, deal + target generator, modes, packs, twists, scoring, result |
| `js/games/wave/cards.js` | the new cards (`NEW_CARDS`, ranges per pack) and the explicit cozy exclusion list |
| `js/games/wave/records.js` | per-match stats, badges, records patch, stamps, history line, chase line, rotation (`seen`) |
| `js/games/wave/view.js` | the UI (setup, clue, guess, reveal, recap); one file for v1 and v2 states |
| `js/games/wave/css.js` | the styles (tokens only) |
| `tools/test/games/party-wave.test.js` | v1 pins, v2 rules, records, the whole UI (iPhone profile, touch) |

## Versioning (old saved matches must replay byte for byte)

`opts` is `{}` for every match. A fresh match is v1 until `first` plays a **setup move**:

```js
{ setup: { v: 2, mode: 'classic'|'bet'|'sure'|'oneword'|'mixed', pack: 'classic'|'justus'|'everyday'|'hottakes'|'future'|'everything'|'cozy', deal?: [7 card indices] } }
```

* `apply` accepts it only when `!s.v`, round 0 is untouched (no clue), `who === s.first`, and every field validates (unknown mode or pack
  throws). It sets `s.v = 2`, `s.mode`, `s.pack` and rebuilds `s.rounds` from `s.seed` + mode + pack (+ `deal`). A second setup throws.
* `next()` is unchanged: the first player is the only actor before and after the setup.
* A first move that is a plain clue is the **legacy v1 path**. `init`, `next`, the v1 `apply` branch, `pointsFor`, the validation and its
  messages, `CARDS` and the v1 `result` are exactly what shipped before. Every `s.v === 2` rule lives in `wave/rules.js`.
* `deal`: seven distinct card indices of the pack (integers in range, no repeats). The UI picks them from not-yet-seen cards and freezes them
  in the move. Without `deal`, a seeded shuffle of the pack. The last round is Déjà vu (round 1's card again), so seven cards fill eight rounds.
* The view handles both versions: round count, maximum score and twists come from the state.
* `result()` for v2 adds `max`; ratings are percentage bands of the maximum (the v1 bands as fractions of 32).

Card indices: 0..138 are the classic cards; `NEW_CARDS[i]` is index `139 + i` (Just Us 22, Everyday 20, Hot Takes 19, Future Us 18, Senses 20 = 99 new). New packs are only ever appended at the end of `NEW_CARDS` and the `RANGES` loop, because saved v2 matches freeze their deal by index.

## Rules (v2)

* Targets run 0..100 (v1 was 4..96). Every match has at least one **edge round** (target <= 8 or >= 92). Landing within 4 of an edge target earns +1.
* Base points: bullseye (<= 4) 4, so close (<= 10) 3, near enough (<= 17) 2, else 0.
* **Jackpot dial**: in about one match in three, one round (never the first) is the jackpot: all its points double. It is secret until its
  reveal (the needle turns white and the stamp is ringed).
* **Déjà vu finale**: the last round re-deals round 1's card with a new target (at least 20 away). The banner says so, and the reveal compares
  with how close round 1 was.
* Mixed Bag deals each round one twist from {plain, bet, sure, oneword, edge}; every twist appears at least once. A twist banner shows in the
  top row and the rule line, to both players.

### Modes

| Mode | Rule |
|---|---|
| `classic` | eight rounds, the bands above |
| `bet` Giver's Bet | the giver may bet Bullseye (within 4), Close (within 10) or Way off (more than 17); a right bet is +1 |
| `sure` Double Down | the guesser may tick Sure: within 10 pays 6, anything else 0 (instead of the bands). Move `{ at, sure: true }` |
| `oneword` One Word | clues are one word (no spaces); any scoring round gets +1 |
| `mixed` Mixed Bag | a seeded twist per round |

**The bet travels with the clue** (`{ clue, bet }`). The spec suggested a separate `{ bet }` move in the guess phase with `next()` returning
both players, but the engine's `derive` consumes a move per actor in `next()` order and drops (or mis-assigns) a move that arrives in the
wrong phase, so a separate bet move would replay differently from how it played live. Bundling it with the clue is order-independent by
construction, still secret from the guesser until the reveal, and a bet after the guess is simply impossible (rejected). `{ bet }` alone is refused.

Max score per match (`maxOf`): per round `(sure ? 6 : 4) + oneword + edge + bet`, doubled on the jackpot round.

### Packs

`classic` (139), `justus` (22), `everyday` (20), `hottakes` (19), `future` (18), `senses` (20: sounds, smells, textures, vibes; indices 218..237), `everything` (all 238), `cozy` (everything minus the suggestive
cards, indices 64, 111, 112, 120, 130 in `COZY_OUT`; Senses is in it). The setup shows eight pack chips and still fits 390x664, 375x548, 667x375 and 844x390 without scrolling. Every new card is a real spectrum between two poles. `{a}` / `{b}` become the names.

### Rotation

The shared data key `seen` holds the dealt card indices (base36 joined by `.`, capped at 3000 characters, newest kept). The setup screen
deals from unseen cards first; when a pack has fewer than seven unseen cards it deals the stragglers then starts a fresh lap. The deal is
marked seen the moment the setup move is sent.

## Screens

* **Setup** (first player, before any move): five mode cards, seven pack chips, one sticky primary button. Last choice (`lastMode`,
  `lastPack`) is preselected and the button reads "Same again: Mode · Pack" until something changes. The other player sees who is choosing.
  Local play shows it behind the pass-the-phone curtain.
* **Clue / guess / reveal / waiting**: head (round, twist chip, team total), a dial that takes the height that is left (sized in JS), the foot
  with the primary action. Landscape (wider than tall, >= 600 px) puts the dial left and everything else right. Primary buttons are in view
  without scrolling at 390x664, 375x548 and 844x390.
* **Reveal**: lid opens, zone spreads, the stamp lands, and only then does the Team chip count up and the Next button unlock (so a double
  tap on Lock can't skip it). Near-miss lines: "1 off the bullseye!" (5 off; "2 off" at 6), "Just missed 3 points" (11–12), "Just missed 2 points" (18–19).
* **Final reveal**: `endDelay: 'manual'`. The last reveal waits for "See how you did" (or about 3.5 s after the stamp), then the recap and the end
  card (`api.showEnd()`).
* **Clue of the night** (recap keepsake, view only): `clueOfNight(rounds)` in `records.js` picks the round that came closest (smallest miss, then more points, then the earliest). A line under the plaque names it ("Clue of the night: “…” by Emerson on Cold ↔ Hot, dead on") and its row gets a star chip. It is a pure read of the rounds, so it also shows on old finished v1/v2 matches (the records section does not).
* **Recap**: score out of this match's max, rating, meter, stamps, history line, chase line, one badge each, a row per round with the exact target tick.

## Records (`gamedata/wave`, flat, per-key last writer wins)

Written once per finished match by the device whose own move ended it (`ctx.last.who === ctx.me`; the one device in local mode), deduped by `lastRec`
= matchId, only for matches that finish while the view is mounted (opening an old finished match writes nothing).

`lastRec`, `plays`, `best_<mode>`, `lastNewBest` + `lastOldBest` (so both phones can show NEW BEST), `bulls`, `bullStreak`, `bullStreakBest`
(consecutive bullseyes across matches), `a_givePts` / `b_givePts`, `a_guessPts` / `b_guessPts`, `a_bets` / `b_bets` (bets called right), `closest`
(smallest miss ever, 0 = dead centre), `dead` (dead-centre hits), `edgeHits`, `jackpots` (jackpot rounds that scored), `bestClue`, `seen`, `lastMode`, `lastPack`.

Shown as: NEW BEST stamp (with the old best), milestone stamps (10 / 25 / 50 / 100 bullseyes and matches), DEAD CENTRE and JACKPOT stamps, the bullseye
streak, the dead-centre record clue, a history line ("Your 12th match together. Best ever 26, tonight 24: so close.") and a lifetime clue-writing
chase ("Emerson leads 3.1 to 2.9 a round. One bullseye from Sydney flips it."). Gaps are always phrased as a path forward.

Badges (one each, ties read "Dead heat", never negative): Fortune Teller (bets called right), Edge Walker (edge hits on your clues), Economist
(fewest letters per point), Clue Poet (clues that earned most), Dial Whisperer (smallest total miss as guesser).

Engine note: the turn-game `api` has no `data` / `setData` / `onData` (only the live api does), so the view uses `gameDataApi('wave')` from `core.js`.

## Testing

```
node tools/test/games/party-wave.test.js     # ~3 min: pins, rules, records, the UI on two phones + one phone
QUICK=1 node tools/test/games/party.test.js  # the shared Doodle + Wave suite (Wave parts pick Classic on the setup screen)
python3 tools/build_artifact.py --out /tmp/x-wave.html --only=wave
```

`party-wave.test.js` pins v1: eight seeds' dealt cards and targets, and four scripted matches (including rejected moves) whose final state hashes
were recorded from the code before the v2 update. Any change to the v1 paths fails them.
