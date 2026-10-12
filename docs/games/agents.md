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

- **Clue checker.** Refuses a board word, its plural or singular (cactus/cacti, wolf/wolves, die/dice, -s/-es/-ies/-ves,
  both directions) and true spelling variants and diminutives (donut/doughnut, grey/gray, pyjamas/pajamas, kitty/kitten,
  bunny/rabbit, mom/mum, ...). Substring blocking only applies when the shorter word has 4+ letters, plus "board word +
  up to 3 letters" (RING blocks RINGS, RINGER). AT, AN, SEA, EAR, CAT/CATALOG are fine. Errors read
  "Too close to WATCH (same word family)."
- **Pick limit.** At most `n + 1` agents per turn; the turn then ends by itself. The slip shows "picks left".
- **Sudden death** (when `sudden` is on). When the turns run out with agents left, `phase: 'sudden'`: no clues. One picker
  at a time (`s.picker`, starting with whoever would have guessed next) picks on the partner's key. An agent keeps the
  mission alive and passes the pick to the partner (unless the partner has nothing left on your key to find). A bystander or
  assassin ends it: `over: 'caught'`. Finding all 15 is a win ("Escaped"). Picks are logged in `s.sd`.
- **Mind meld.** A finished turn where the guesser found exactly `n` agents and no bystander. Derived, never stored.
- **Packs.** A themed board is 15 pack words plus 10 everyday nouns, no word inside another, deterministic per seed.
  NOUNS is frozen (changing it re-deals every old match).

## Records (`gamedata/agents` through the engine's per-game data)

The turn-game `api` has no `data()`, so the game imports `gameDataApi` from core and uses it directly.
Flat keys: `missions_n wins_n burned_n caught_n cold_n sudden_n escape_n meld_n rookie_wins_n agent_wins_n spy_wins_n
pack_<p>_n spare_best close_best streak streak_best clue_best a_clue_best b_clue_best lastm lastb last_setup`.

- Recorded once per match: skipped when `lastm` equals the match id; counters are absolute values from the data snapshot
  (two phones writing the same match write the same numbers).
- `spare_best`: most turns to spare on a win. `close_best`: most agents found on a loss ("closest call"). The core
  end card still says "Best team score 0" (a team result's score is not what it counts); our own ledger separates wins
  and losses.
- `lastb` holds the stamps earned by the last match (`record`, `rowN`, `last`, `escape`, `meldK`, `msN`) so both phones
  show the same stamps. `last_setup` (`agent|us|1`) is the rules card's remembered choice.
- The ledger strip shows on the rules card and on the result view; stamps, an epilogue line and the two best clues
  appear on the result view.

## Layout notes

The action dock (Pick / End turn) is sticky at the bottom so it stays on screen at 360x640. A second tap on a
selected card within 350 ms does not confirm; taps are ignored for 400 ms after any move.

## Tests

```
UNIT=1 node tools/test/games/words-agents.test.js   # rules, replay equivalence, packs, checker, records (no browser)
node tools/test/games/words-agents.test.js          # plus the v2 UI flows on two phones, light and dark
SCHEME=light node tools/test/games/words-agents.test.js
node tools/test/games/words.test.js                 # the shared Word Duel + Double Agents suite
```
