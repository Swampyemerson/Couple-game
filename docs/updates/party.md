# Party unit report: Doodle + Same Wave

Branch `claude/upd-party`. Director: Opus. Survey, build, verify and fix: Sonnet subagents at high effort (one survey per game, one
builder per game, two independent verify passes per game, each followed by a fix round). Content check: one Fable subagent, whose
packs, modes and rivalry ideas fed the spec.

Both games are co-op turn games, and neither had a setup step, any records, or any variety from one match to the next. Each now opens with a
**setup screen** (mode + content pack, "Same again" one-tap rematch), and a match is a fresh mix of modes, twists, packs, secret bonus
rounds, near-miss feedback, shared records, playful per-person titles and a history line that frames every gap as a way forward.

## How old saved matches keep replaying

The engine always passes `opts: {}`, so a match can't be versioned at creation. Instead, every new match starts with a **setup move**
`{ setup: { v: 2, mode, pack, deal?, encore? } }` made by the first player before anything else. A match whose first move is anything else
is a legacy v1 match. It runs through the untouched v1 code: original prompt and card arrays (not edited, reordered or appended), `init`,
scoring, guess matcher, validation and messages. All new content lives in new arrays and is used only when `s.v === 2`.

Evidence:
- `party-doodle.test.js` and `party-wave.test.js` pin v1 using fixtures recorded from the code *before* any change: dealt
  prompts/cards and targets for 6–8 seeds, plus four full scripted matches per game (including rejected moves) with their final-state
  hashes. Both still pass.
- Both verifiers ran differential fuzzing of old vs new code through `core.derive`: 400 random matches per game, 0 differences. They also
  opened seeded old matches in the UI, finished and in progress: same prompts and cards, same score, no records written.

## Doodle

**New**
- **Stakes scoring** (all new matches). The tier you pick now matters: Easy 2/1/1, Medium 3/2/1, Tricky 5/3/2 points by guess, shown on the
  cards. Before, Easy always dominated, because every tier paid the same.
- **Modes:**
  - **Classic**.
  - **Half & Half.** The guesser sees half the drawing and can make one early call for a bonus, or play safe with "show me the rest".
  - **Ladder.** The difficulty climbs with your hit streak, and a miss drops one rung.
  - **Invisible Ink.** Your strokes fade as you draw, for silly gallery art and +1 on a hit.
  - **Mixed Bag.** A seeded twist each round: half & half, invisible, a 35 s sprint, or one-line (a single stroke).
- **Encore** (opt-in switch). After the last round you both draw the same Us card at the same time, without seeing each other's. The gallery
  shows the pair side by side, and either one can be pinned. It is unscored.
- **4 new prompt packs**: Us, Kitchen, Out & About, Creatures & Weather (29–36 prompts each, 8+ per tier), plus Classic (the 282) and
  Everything. **Rotation** deals unseen prompts first.
- **Golden Frame.** About 1 match in 3 has a secret double-points round, revealed with a gold frame and a stamp.
- **Near-miss**: "So close!" on a wrong guess that is one letter off or shares a word with the answer. It never scores and never leaks the answer.
- **Shared records** (`gamedata/doodle`): bests per mode, a cross-match guessed-in-a-row streak, perfect matches, Tricky hits, drawings made
  (milestone stamps at 10/25/50/100/250), golden hits, lifetime per-person drawing and guessing points.
- **The gallery now shows:**
  - a NEW BEST stamp with the old best;
  - title badges, one each (Picasso, Mind Reader, First-Try Ace, Daredevil; "Dead heat" on ties, never negative);
  - a history line ("Your 12th match together. Best ever 26, tonight 24: so close.");
  - a lifetime head-to-head chase line.
- **Pin to the fridge**: a favourite drawing becomes a keepsake on the setup screen.

**Fixed**
- **Typo tolerance accepted other prompts**: horse for house, clown for crown, "trainer" for train, car for playing cards, toaster for
  burnt toast, butterfly for butterflies in your stomach. The new matcher refuses these. Listed alternates always match, and natural
  synonyms for the new prompts were added and tested. Old matches keep the old matcher so they replay.
- **Cosmetic timer.** At 0:00 the paper now locks. A drawing on the paper is auto-sent (with retry). An empty paper sends a blank
  "Time's up" round worth 0. Old matches keep their nudge, with a 10 s grace period.
- **Landscape was unplayable** (Send and Guess off screen). It now uses a side-by-side layout. Every primary button is in view without
  scrolling at 390x664, 375x548 and 844x390, and this is tested for every screen, including the Mixed Bag ones.
- Gallery score stickers were clipped at the right edge.
- The final reveal raced the end card. Now `endDelay: 'manual'` holds it until you tap, or for about 4 s.
- **Polish:**
  - the Replay/Skip button was 40 px tall and is now ≥ 44 px;
  - the "Time's up" stamp was clipped on small paper;
  - `touch-action: none` now applies only to the drawing paper;
  - every text colour pair passes 4.5:1 contrast in both themes (tested).

## Same Wave

**New**
- **Modes:**
  - **Classic**.
  - **Giver's Bet.** The clue-giver bets Bullseye, Close or Way off on their own clue; calling it right is +1, so both players have a stake
    every round.
  - **Double Down.** The guesser can tick "Sure": within 10 pays 6, anything else pays 0.
  - **One Word.** One-word clues only, +1 on any scoring round.
  - **Mixed Bag.** A seeded twist each round.
- **Edge rounds.** Targets now span 0–100, and every match has at least one target at an extreme; hitting an edge target is +1.
  Before, targets never landed in the outer 4.
- **Jackpot dial.** About 1 match in 3 has a secret double-points round.
- **Déjà vu finale.** The last round re-deals round 1's card with a new target, and the reveal compares the two rounds.
- **4 new card packs**: Just Us, Everyday, Hot Takes, Future Us (79 cards), plus Classic (the 139), Everything, and a **Cozy** filter
  that leaves out the suggestive classic cards. **Rotation** deals unseen cards first and never repeats the previous match's deal.
- **Near-miss lines**: "1 off the bullseye!", "Just missed 3 points", "Just missed the 6!".
- **Shared records** (`gamedata/wave`): bests per mode, lifetime bullseyes (milestone stamps), a cross-match bullseye streak, dead-centre
  hits with the record clue, edge hits, jackpots, and lifetime per-person giving and guessing points.
- **The recap shows:** NEW BEST, stamps, a history line, a lifetime chase line, badges (Clue Poet, Dial Whisperer, Economist, Fortune
  Teller, Edge Walker) and the exact target on every round row.
- The cover gets a small jackpot star.

**Fixed**
- **Primary buttons below the fold.** "Lock it in" was clipped at 390x664 and invisible at 375x548, and landscape was unplayable. The dial
  now sizes itself to the room it has, and landscape puts the dial on the left. Tested at 390x664, 375x548, 844x390 and 667x375.
- **The final reveal was cut short** by the end card after about 1.7 s. It now waits for "See how you did" or about 3.5 s.
- A double tap on Lock showed a "Write a clue first." error toast and the bad sound.
- A tap on the plinth snapped the needle to 0 or 100.
- On a bullseye the needle hid the "4" label.
- The Team chip spoiled the result before the lid opened.
- **Found in verification:**
  - dark-mode stamps were yellow on cream;
  - the landscape reveal overlapped the clue bubble;
  - long names wrapped poles onto 3 lines;
  - a reload replayed an already-seen reveal or lost the setup picks.

## Test results

| Suite | Result |
|---|---|
| `node tools/test/games/party-doodle.test.js` (new) | ALL GOOD, 560 checks (after round 2) |
| `node tools/test/games/party-wave.test.js` (new) | ALL GOOD, 352 checks (after round 2) |
| `QUICK=1 node tools/test/games/party.test.js` | ALL GOOD, 234 checks; existing flows now pick Classic on the setup screen |
| `QUICK=1 node tools/test/all-games.test.js` | ALL GOOD (35 checks) |
| `QUICK=1 node tools/test/smoke.test.js` | ALL GOOD (22 checks) |
| `python3 tools/build_artifact.py` (full) | builds, 116 modules |

The new suites cover:
- pure rules for every mode, pack and twist;
- the v1 pins;
- records written exactly once per match across two devices;
- `page.tap()` flows on an iPhone profile (`coarse: true`): online two-device and local one-device, light and dark;
- layout checks with every primary action in view at three or four viewport sizes;
- a WCAG contrast check in both themes.

`party.test.js` now launches on a random port (`PORT=` overrides it), so suites can run side by side.

## For the coordinator

- **Engine gap (worked around).** The turn-game `api` has no `data` / `setData` / `onData`; only the live api spreads `gameDataApi`.
  Both games import `gameDataApi` from `core.js` and use `api.data` when it exists. The proper fix is one line in `core.js`: add
  `...gameDataApi(def.id)` to the turn-game api object.
- **New files:**
  - `js/games/doodle/` (packs, records, view, css);
  - `js/games/wave/` (cards, rules, records, view, css);
  - `docs/games/doodle.md` and `docs/games/wave.md`;
  - `tools/test/games/party-doodle.test.js` and `party-wave.test.js`. `run-all.sh` picks these up automatically.
- `js/games/covers.js`: only the `wave()` cover was touched (a star).

## Known issues

- **Duplicate record write.** The engine's self-heal can re-send a device's own identical data patch when a late snapshot lands, so the
  writing phone may log a second, identical write. The values are the same, so there is no double counting.
- **Landscape setup screens.** On the Doodle setup screen you scroll to see all five modes; Start stays visible.
- **Giver's Bet** travels inside the clue move (`{ clue, bet }`), not as a separate move. A separate move in a two-actor phase would not
  replay deterministically through `derive`, which consumes moves per actor in `next()` order.
- **Online rematch** still needs the partner to accept, which is engine behaviour. "Same again" preselects the last mode and pack.
- Engine end card in landscape (667x375, 844x390) is taller than the viewport: Rematch sits at the fold and the card scrolls
  (`.gm-end` has `overflow: auto`). Engine-owned, so not changed here.
- Doodle's Encore end card once showed late after a reload mid-Encore (3 of ~30 verifier runs, never reproduced since); the view now
  calls `api.showEnd()` on the over transition with idempotent retries, and a test covers reload-then-finish.

## README games-table lines

```
| Doodle: draw and guess. Five modes, new prompt packs, an Encore and a gallery that keeps score | Take turns, co-op | Phone |
| Same Wave: one clue, one dial, five modes and new card packs. How in sync are you? | Take turns, co-op | Either |
```

## Round 2 (finished 14 Oct, after Emerson's "finish up")

The first attempt on 12 Oct was cut off by an API session limit and nothing untested was pushed. It was finished on 14 Oct with Sonnet
builders, then checked by an independent Sonnet verifier on an iPhone profile with real taps, then a fix round. The Fable content check
picked these four items.

**Doodle**
- **Home Sweet Home pack**: 33 prompts (12 Easy, 11 Medium, 10 Tricky), such as houseplant, record player, mowing the lawn, tangled
  christmas lights, lost sock, power cut and locked out. It is appended last to the decks (pool indices 412..444), so earlier indices
  don't move. The verifier's fair guesses were added as alternates ("take out the trash", "hit snooze", "spring clean" and so on). Across
  96,600 simulated rounds no Home card accepted another card's answer.
- **Tonight's masterpiece**: the gallery names the best round of the match under the plaque, for example "Tonight's masterpiece: Creaky
  floorboard by Emerson, guessed first try", or "called early from half a drawing". That frame gets a small "Tonight's pick" ribbon.
  Ties go to fewer guesses, then the harder card, then the earlier round. When nothing scored it reads "No masterpiece tonight. Next
  time." It works on old v1 matches too, because it only reads the rounds and is not a record.
- **Setup screen fix** (found by the verifier): at 375x548 and 844x390 some pack chips and the Encore switch were hidden under the
  sticky Start. Mode tiles are now name-only with the selected mode's pitch on one line, and pack chips use short labels (the full name
  is in the Start label and the aria-label). Every chip, the Encore switch and Start are visible and tappable without scrolling at
  390x664, 375x548 and 844x390, which a strict test asserts.

**Same Wave**
- **Senses pack**: 20 cards, such as Smells like a bakery to Smells like a gym bag, Whisper to Megaphone, Sweater weather to Sunscreen
  weather, and Emerson's playlist to Sydney's playlist. It is appended last (indices 218..237), and Cozy includes it. Eight pack chips
  fit the setup screen at 390x664, 375x548, 667x375 and 844x390.
- **Clue of the night**: the recap names the closest guess of the match, for example "Clue of the night: "Clue number 6" by Sydney on
  Feels like a warm bath to Feels like a cold shower, dead on". That row gets a star chip with its own style. Ties go to more points,
  then the earlier round. It works on old v1 matches too, and still writes or fabricates no records.

Both verifiers found no blockers. Old v1 matches still replay with the same prompts, cards and scores.

Not merged here: the coordinator asked for `origin/claude/relaxed-dijkstra-2cy8al` to be merged into this branch first. The permission
check blocked that merge, so it was not done. That branch changes only `js/games/doodle.js` and `js/games/wave.js` (plus core and other
games), and round 2 touches neither file, so the merge should be clean. The `gameDataApi` fallback stays: it is used only when
`api.data` is missing.
