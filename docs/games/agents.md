# Double Agents

Co-op word-clue game for two (`js/games/agents.js`, helpers in `js/games/agents/`). Both players see the
same 25 words; each holds a different secret key (9 agents, 3 assassins, 13 bystanders). Take turns giving a
one-word clue and a number, the partner taps words judged on the giver's key. Find all 15 distinct agents
before the turns run out.

## Rules versions and the move log

A match's `opts` are always `{}`, so v2 rules are chosen by an opening move. **A match with no setup move
plays the v1 rules, byte for byte** (frozen fixture `tools/test/games/fixtures/agents-v1.mjs`; the test replays
360 random legacy logs, valid and invalid moves, through both and requires identical state, `next()`, `result()`
and rejections).

| Move | Who | Meaning |
|---|---|---|
| `{ setup: { v: 2, level, pack, sudden } }` | the first giver, before the first clue, once | switches on the v2 rules. `level`: `rookie` (11 turns) / `agent` (9, default) / `spy` (7). `pack`: `classic` (default, the v1 board) / `us` / `travel` / `mythic`. `sudden`: boolean, default `true`. Unknown keys or values throw; `v` must be 2. A setup after the first clue, a second setup, or one from the other player is rejected. It does not use up the turn. |
| `{ clue: 'ocean', n: 2 }` | giver | one plain word, `n` from 1 to 9 |
| `{ pick: 7 }` | guesser (or the picker in sudden death) | tap a card |
| `{ stop: true }` | guesser | end the turn after at least one pick |

The setup re-deals the words (the keys stay) and stores `s.v, s.level, s.pack, s.sudden, s.tokens`. v1 states never get
these fields.

## v2 rules

- **Clue checker.** Refuses a board word, its plural or singular (cactus/cacti, wolf/wolves, die/dice, -s, -es after
  s/x/z/ch/sh, -ies, both directions), true spelling variants and diminutives (donut/doughnut, grey/gray, pyjamas/pajamas,
  kitty/kitten, bunny/rabbit, mom/mum/mother, ...), the board word plus a real ending (RING: RINGS, RINGER, RINGING) and
  dropped-e or doubled-letter forms (DANCING/DANCE, CHEESY/CHEESE, RUNNING/RUN). A word merely sitting inside another is
  only blocked when the shorter one has 6+ letters (FLOWER in SUNFLOWER). SPACE/SPA, TEAM/TEA, BEER/BEE, VOWEL/VOW,
  MAPLE/MAP, NIGHT/KNIGHT, PLANET/PLANE, MOTHER(S)/MOTH, FATHERS, LETTERS, PENNY/PEN, SUNNY/SUN, CAVES/CAFE, HATES/HAT, NEWS/NEW and AT, SEA, EAR are fine (a short list of look-alikes is checked after singularising).
  Errors read "Too close to WATCH (same word family)."
- **Pick limit.** At most `n + 1` agents per turn; the turn then ends by itself. The slip shows "picks left". The guesser's zero-pick prompt ("Tap Emerson’s agents.") stays on one line at 360 px, or the fifth board row would sit under the dock.
- **Sudden death** (when `sudden` is on). When the turns run out with agents left, `phase: 'sudden'`: no clues. One picker
  at a time (`s.picker`, starting with whoever would have guessed next) picks on the partner's key. An agent keeps the
  mission alive and passes the pick to the partner (unless the partner has nothing left on your key to find). A bystander or
  assassin ends it: `over: 'caught'`. Finding all 15 is a win ("Escaped"). Picks are logged in `s.sd`.
- **Mind meld.** A finished turn for a clue of 2 or more cards where the guesser found exactly `n` agents and no bystander. Derived, never stored. The banner shows for the latest turn mid-game and on a won end view only.
- **Packs.** A themed board is 15 pack words plus 10 everyday nouns, no word inside another and no alias/plural pair (never DONUT and DOUGHNUT together), deterministic per seed.
  NOUNS is frozen (changing it re-deals every old match).

## Records (`gamedata/agents` through the engine's per-game data)

The game uses the turn-game `api.data()` / `api.setData(patch)` / `api.onData(fn)` directly (core provides them natively).
Flat keys: `missions_n wins_n burned_n caught_n cold_n sudden_n escape_n meld_n spotless_n rookie_wins_n agent_wins_n spy_wins_n
pack_<p>_n spare_best close_best streak streak_best clue_best a_clue_best b_clue_best lastm lastb recent_m last_setup best_clue a_best_clue b_best_clue`.

- Recorded once per match. `recent_m` (comma-joined, newest 60 match ids) is checked before recording and appended on
  record. A phone records when it watched the match end during this mount, or when the match is v2 and its id is not in
  `recent_m`. A finished v1 match opened later from the hub is never recorded. Counters are absolute values from the data
  snapshot (two phones writing the same match write the same numbers).
- `spare_best`: most turns to spare on a win. `close_best`: most agents found on a loss ("closest call"). The core
  end card still says "Best team score 0" (a team result's score is not what it counts); our own ledger separates wins
  and losses.
- The record clue is remembered by name: when `clue_best` (or `a_clue_best` / `b_clue_best`) rises, the same patch stores
  `best_clue` (`a_best_clue` / `b_best_clue`) as `clue|agents|giver|pack|matchId`, e.g. `ocean|4|b|us|<id>`. A later clue that
  ties a standing record of 3 or more adds the `tie` badge (stamp "EQUALS THE RECORD") and leaves `best_clue` as it was.
  The rules card shows "Record clue: OCEAN for 4 (Sydney, Wanderlust)." and, on a streak of 2+, "Three missions
  unbeaten. Keep it clean."; the result view's best-clue slip gets a RECORD or EQUALS THE RECORD overprint.
- **Spotless.** A win (sudden-death escapes included) where no pick in `s.log[*].picks` or `s.sd` is a bystander (`r === 'N'`). Derived from state (`isSpotless`); a win adds the absolute counter `spotless_n` and the `spotless` badge in `lastb`. The result view stamps "NOT ONE WRONG TAP" (good ink) and the ledger shows "<b>2</b> spotless".
- **Record in reach** (v2 only; reads `clue_best`, never writes). In the guess phase the clue slip of both players gets a line after the picks-left text: `n > clue_best` (`clue_best >= 2`) reads "Crack all 4 and it’s a new record." when `n === clue_best + 1`, or "Find 4 for a new record." for a bigger clue; `n === clue_best` (`>= 3`) reads "All 3 would equal the record."; a bigger clue whose giver can only reach the record reads "Find 3 to equal the record.". Each needs enough reach: the giver's unfound agents plus those this turn already found (a clue of 9 with 2 agents left shows nothing). It disappears once a bystander is in the turn's picks (the turn ends) or the turn is over. Layout: the line is one 0.68rem row inside the slip; while it shows, `.g-agents.has-rec` trims the portrait card height formula by 15 px so the five board rows and the dock stay inside 360x640 (landscape is unchanged: the right column has room).
- Stamps are labelled by source: `record` = NEW RECORD (a clue record, only with a previous best), `tie` = EQUALS THE RECORD, `sparebest` = MOST TURNS SPARE, `streakbest` = STREAK RECORD, `closebest` = CLOSEST CALL YET. Nothing is stamped as a record on a first-ever value. Older saved `lastb` values with `record` still read NEW RECORD.
- **Reopen guard.** A finished v2 match opened later from the hub is recorded only when the data snapshot is not empty (`missions_n > 0`), so a fresh device can't overwrite the shared records; a match watched live always records (`shouldRecord`).
- `lastb` holds the stamps earned by the last match (`record`, `sparebest`, `streakbest`, `closebest`, `rowN`, `last`, `escape`, `spotless`, `meldK`, `msN`) so both phones
  show the same stamps. `last_setup` (`agent|us|1`) is the rules card's remembered choice.
- The ledger strip shows on the rules card and on the result view; stamps, an epilogue line and the two best clues
  appear on the result view.

## Layout notes

The action dock (End turn / My key / Pick) is sticky at the bottom so it stays on screen at 360x640, where all five board
rows fit above it. The rules card's Play button is a sticky bar. Landscape phones (`orientation: landscape` and height
at most 500 px) put the board on the left and the slip, actions and history on the right. The clue field takes a full row
(stepper and Send below it) there and at widths of 380 px or less. Landscape cards are only 36 px tall so all five rows fit
above the fold: a deliberate exception to the 44 px rule, because picking is select-then-confirm (the Pick button
confirms) so a mis-tap never commits a pick. A second tap on a
selected card within 350 ms does not confirm; taps are ignored for 400 ms after any move.

## Tests

```
UNIT=1 node tools/test/games/words-agents.test.js   # rules, replay equivalence, packs, checker, records (no browser)
node tools/test/games/words-agents.test.js          # plus the v2 UI flows on two phones, light and dark
SCHEME=light node tools/test/games/words-agents.test.js
node tools/test/games/words.test.js                 # the shared Word Duel + Double Agents suite
```
