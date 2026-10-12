# Words unit report: Word Duel + Double Agents

Branch `claude/upd-words`, based on `claude/relaxed-dijkstra-2cy8al` (6e9fee4). Owned files only: `js/games/wordduel.js`,
`js/games/wordduel/*`, `js/games/agents.js`, `js/games/agents/*`, `docs/games/wordduel.md`, `docs/games/agents.md`, and the tests:
- `tools/test/games/words.test.js` (updated);
- `tools/test/games/words-duel.test.js` and `words-agents.test.js` (new);
- `tools/test/games/fixtures/{wordduel,agents}-v1.mjs` (new).

The work ran as the plan describes:
1. One Sonnet survey per game, played through the harness on an iPhone profile.
2. A Fable content check.
3. A director spec.
4. One Sonnet builder per game.
5. Independent Sonnet verifiers, two rounds per game, each followed by a fix round.

Full details are in `docs/games/wordduel.md` and `docs/games/agents.md`.

## How new rules stay compatible with saved matches

`createMatch` in core always writes `opts: {}`, so a game can't tell old matches from new ones in `init`. Both games therefore pick
their v2 rules with an opening **setup move**, `{ setup: { v: 2, ... } }`.

- **Legacy matches.** A match with no setup move plays the v1 rules exactly as before. Both games ship a frozen copy of the original
  rules (`tools/test/games/fixtures/*-v1.mjs`), and their tests replay hundreds of random legacy logs through old and new code. The
  logs include invalid moves and seat interleavings. State, `next()`, `result()` and rejection messages must be identical.
- **Independent checks.** The verifiers also fuzzed against `git show 6e9fee4` directly with no differences: 3,000 logs for Word Duel
  and 1,500 for Agents.
- **Frozen data.** The Word Duel word lists and the Double Agents `NOUNS`, `LAYOUT`, `BREAKS` and v1 clue checker are byte-identical
  to the original. Changing NOUNS would re-deal every saved board.
- **Opening the rules card.** A pristine match shows a rules card to the first player, with one big Play button and defaults
  remembered from last time. The partner sees "Waiting for X to set the rules…".

## Word Duel

### Fixed

- **One-phone retake bug (reproduced by the survey).** A player saw "Out of guesses. It was ABBEY", backed out, reopened and could
  retake the last guess for a win. The guess is now committed on Enter. The reveal is a layer above the curtain, and a localStorage
  flag brings it back after a reopen. Tested in every path, including a best-of-3 round end.
- **Landscape.** The keyboard fell below the fold at 667×375 and 844×390. Landscape now puts the board left and the keys right, and
  320×568 portrait has a compact layout. Tests assert no scroll, with the keyboard fully inside the viewport.
- **Keyboard rebuilt on every update.** This risked dropped taps on iOS. The keys are now built once (a test asserts the same nodes
  survive a submit).
- **Spoilers before the flip ends.** "Cracked it in N", the result line, the round recap and the heat meter appeared before the tiles
  finished flipping. They now wait for the flip, showing "Revealing…".

### New (v2 rules card)

- **Secret pools:**
  - **Fair Play** is the default and only allows the 2,224 everyday words as secrets. Before this, picking obscure words was the
    winning tactic.
  - **Love Letters** is 90 romantic everyday words, with three suggestion chips.
  - **Any** is the old rule.

  Guesses can always be any valid word.
- **Heat tie-break.** Equal guess counts are settled by greens, then yellows, on the rows before the solve, so dead heats are rare and
  the result line says why. A small heat meter shows the chase while playing, as colour counts only (it leaks no letters).
- **Hard mode** (Wordle's rule), enforced in the rules with messages like "Hard mode: keep R in spot 2." and "use both Ns."
- **Dealt opener.** A shared, seeded first guess, so learned CRANE/SLATE openers stop helping and both players start equal.
- **Best of 3.** Round recaps, a scoreboard ("Round 2. Sydney needs this one."), set results and a comeback record.
- **Records and stamps** (shared `gamedata/wordduel`):
  - a ledger of wins, draws and streaks;
  - fastest crack;
  - cracks in 2 or fewer;
  - last-ditch cracks;
  - held-out words;
  - comebacks.

  Stamps on the end view: NEW RECORD, N IN A ROW, MIND-READER, LAST-DITCH CRACK, HELD OUT, IN SYNC, GREAT MINDS and milestone duels.
  Each match is recorded once across both phones (`recent_m` remembers the last 60 match ids).
- **Copy.** Crack lines by row ("Witchcraft.", "By a whisker."), near-miss lines ("One guess. That's all it was."), and the secret
  revealed tile by tile on a miss.
- **Waiting phone.** If the first player hasn't set the rules after about 20 s, the partner can "Set the rules yourself". When both
  do, the first applied wins and the other phone gets a toast.

## Double Agents

### Fixed

- **Clue checker loopholes (reproduced).** DONUT was accepted with DOUGHNUT on the board, and CACTI with CACTUS. v2 adds spelling
  variants and diminutives, irregular and regular plurals both ways, real endings and dropped-e forms (DANCING/DANCE, CHEESY/CHEESE).
- **Over-blocking.** AT (WATCH), SEA (SEAHORSE), SPACE (SPA), NIGHT (KNIGHT) and similar clues were refused. Now a word inside
  another is only blocked when the shorter one has 6+ letters or it is a real inflection. Unit tests cover 170+ cases.
- **Accidental double tap committed a pick.** The confirming tap now needs at least 350 ms after selecting, and taps are locked for
  400 ms after a move (the press animation still plays).
- **Pick and Play below the fold on small phones.** The action dock and Play bar are sticky. At 360×640 all five board rows fit above
  the dock. Landscape has its own two-column layout.
- **Tap targets.** The clue stepper buttons (34 px) and the key toggles (40 px) are now at least 44 px.
- **Records counted a loss at 14 as the "best".** Our ledger now keeps wins and losses apart. The core end card's "Best team score" is
  outside our files; see Known issues.

### New (v2 mission briefing)

- **Difficulty.** Rookie (11 turns), Agent (9) and Spymaster (7).
- **Sudden death** (Codenames Duet style, on by default). When turns run out, the players alternate picks on the partner's key with no
  clues; one mistake loses.
- **The clue number matters.** At most n+1 picks per turn, with "picks left" on the clue slip.
- **Word packs.** Us (date night), Wanderlust (travel) and Mythic, about 70–80 words each. A themed board is 15 pack words plus 10
  classic nouns, with no word inside another and no alias pairs. Classic is the v1 board.
- **Mind Meld.** A clue for 2+ cards fully cracked with no bystander gets a gold overprint banner and is counted in the records.
- **Records:**
  - missions and wins;
  - burned, caught and out-of-time;
  - sudden-death escapes;
  - wins per tier and missions per pack;
  - most turns to spare;
  - closest call;
  - win streak;
  - best clue overall and per player;
  - melds.

  Stamps: NEW RECORD, streaks, ON THE LAST TOKEN and mission milestones. The result view adds an epilogue line ("Debrief over coffee.
  You two are terrifying.") and the two best clues as slips. The header says "Last call." on the final token.

## User must-haves

None of the plan's named must-haves (Ultimate balance, the Battleships cheat, Defuse) are in this unit. Each of our games still got
the general "meaningful new content, every verified bug fixed, more stimulating play" update above.

## Tests

| Command | Result |
|---|---|
| `node tools/test/games/words-duel.test.js` | ALL GOOD, light + dark (286 checks) |
| `node tools/test/games/words-agents.test.js` | ALL GOOD, light + dark (245 checks) |
| `node tools/test/games/words.test.js` | ALL GOOD (updated for the rules cards; a flaky assert fixed) |
| `node tools/test/all-games.test.js` | ALL GOOD |
| `python3 tools/build_artifact.py --only=wordduel,agents` | builds |

## Known issues and notes for the coordinator

- **Core end card for co-op games.** It shows "Best team score N", built from `score`. That counts a loss as a best, and shows "0" after
  a zero-agent loss. Double Agents now keeps wins and losses apart in its own records. The card itself needs a core change.
- **Turn games have no data API.** The turn-game `api` lacks `data()/setData()/onData()`; only live games get them. Both games import
  `gameDataApi` from core instead. Adding them to the turn `api` would be cleaner.
- **The core "Rematch or leave" status pill is 32 px tall**, under the 44 px rule.
- **`h.closeGame()` in the harness hangs** when no close button is visible, because the click has no timeout. Our tests guard it.
- **Small Double Agents layouts:**
  - Landscape cards are 36 px tall, a deliberate exception: picking is select-then-confirm, so a mis-tap never commits.
  - At 320×568 the last board row scrolls under the sticky dock.
- **Waiting for the rules.** In a pristine Word Duel match the core status may briefly say "Your turn" to the waiting phone before the
  game's status override applies.

## README lines

| Game | Line |
|---|---|
| Word Duel | Pick a secret word for them, crack theirs first. House rules: Fair Play or Love Letters words, hard mode, a dealt opener, best of 3, plus a heat tie-break, streaks and record stamps. |
| Double Agents | Co-op spy clues: two secret keys, one board. Pick a difficulty and a word pack (Us, Wanderlust, Mythic), chase mind melds, survive sudden death, and keep a ledger of missions and records. |
