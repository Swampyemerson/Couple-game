# Knucklebones (`js/games/bones.js`)

A quick two-player dice duel on a 3 × 3 grid each. Turns game, versus, 3D band (three.js) with a flat-dice fallback.

## Classic rules (unchanged since launch)

- Each turn a seeded d6 is rolled for the player to move: `randInt(6, seed, 'roll', n) + 1`. The move is `{ col }`.
- A column scores `value × count²` per value (4,4 = 16; 4,4,4 = 36). A grid is the sum of its columns.
- Placing a die removes every die of that value from the opponent's **facing** column.
- The game ends the instant either grid is full; higher total wins; equal totals draw.

Old match logs (only `{ col }` moves) replay exactly as before. `tools/test/games/threed-bones.test.js` carries a copy of the
original rules and compares 60 games move by move, plus two fixed literal logs and one pinned game whose scores were recorded from
the original code.

## Twists (versioned by a setup move)

Match options are always `{}`, so a twist is chosen **in the game**. Before the first die the player who goes first may send one
setup move `{ tw: '<id>' }`. It doesn't pass the turn or use a die. If the first move is a normal die the match is classic for good
and a later setup move is rejected. Unknown ids are rejected with a friendly error. The choice lives in `state.tw` (undefined =
classic; `'classic'` is also accepted). Old logs never contain a setup move.

| id | Name | Rule |
|---|---|---|
| `golden` | Golden Column | Column `randInt(3, seed, 'gold')` is gilded for **both** players: its column score counts ×2 (`state.gold`). |
| `mirror` | Mirror Dice | You each get the same dice, in a different order: every four turns the starter rolls X then Y and the other player Y then X. |
| `blind` | Blind Draw | Rules as classic, but you pick a column before you see the roll. The view shows a "?" die and the die tumbles in as it lands. The first die (which the starter already saw) is thrown away and replaced by `randInt(6, seed, 'blind', 0) + 1`. |
| `oracle` | Oracle | Rules as classic. Both players see the next two rolls in the band. |

The spec asked for Mirror to hand both players the *same die in each pair of turns*. Simulation says that is a second-player win
(see Balance): the second player can always answer a die with its twin straight away. The shipped pattern (X Y / Y X) keeps the
"same dice" idea and removes the immediate answer.

### Last Word (every non-classic twist)

If the **starting** player fills their grid first, the other player gets one final die before the game ends, so both have placed the
same number of dice (`state.final`). Classic matches and old logs are untouched. In every twist but Mirror the last die lands softly
(it doesn't smash). That choice comes from the numbers below.

## Balance (bot self-play, 4000 games per row, starter alternates seats)

`node tools/test/games/threed-bones.test.js --balance` (set `N=` for more games). "random" picks a legal column at random; "greedy"
maximises its own gain plus the opponent's loss each turn. Blind is measured with random bots only: a bot can't plan around a die it
can't see.

| rules | bots | Last Word | starter wins | other wins | draws | dice/game |
|---|---|---|---|---|---|---|
| classic | random | – | 54.0 % | 44.0 % | 1.9 % | 21.0 |
| classic | greedy | – | 50.4 % | 47.5 % | 2.1 % | 22.5 |
| golden | random | off | 54.3 % | 44.4 % | 1.4 % | 21.0 |
| golden | random | on | 47.6 % | 50.9 % | 1.6 % | 21.6 |
| golden | greedy | off | 49.6 % | 49.1 % | 1.3 % | 22.5 |
| golden | greedy | on | 45.9 % | 52.4 % | 1.7 % | 23.0 |
| oracle | random | off | 54.0 % | 44.0 % | 1.9 % | 21.0 |
| oracle | random | on | 47.6 % | 50.4 % | 2.0 % | 21.6 |
| oracle | greedy | off | 50.4 % | 47.5 % | 2.1 % | 22.5 |
| oracle | greedy | on | 45.1 % | 52.5 % | 2.4 % | 23.0 |
| blind | random | off | 54.0 % | 44.2 % | 1.9 % | 20.9 |
| blind | random | on | 47.3 % | 50.9 % | 1.8 % | 21.5 |
| mirror (X Y / Y X) | random | off | 55.3 % | 43.0 % | 1.7 % | 25.1 |
| mirror (X Y / Y X) | random | on | 44.2 % | 53.5 % | 2.3 % | 25.6 |
| mirror (X Y / Y X) | greedy | off | 67.0 % | 30.6 % | 2.3 % | 38.6 |
| mirror (X Y / Y X) | greedy | on | 51.1 % | 46.1 % | 2.8 % | 39.2 |

What the numbers say:

- **Classic favours whoever starts when play is careless** (54 % random) and is about even with greedy play (50 %). It is dice-heavy
  either way.
- **The Last Word rule is needed, but a smashing last die over-corrects.** With a normal last die the starter wins only 44–45 % in
  Golden, Oracle and Blind (greedy bots 43–44 %). The soft landing brings that to 46–48 %, within the noise of how luck-heavy the
  game is. Mirror keeps the normal last die: its pattern favours the starter (67 % greedy without Last Word) and a normal last die
  brings it to 51 %.
- **Mirror with the same die in consecutive turns** (the original idea) gave the second player 82–85 % of the games, with random and
  greedy bots alike. The X Y / Y X order replaced it. Mirror games run long with greedy play (about 39 dice).
- Draws are about 2 %.

## Facts kept in state (additive, commentary and records only)

`first` (the starter), `big` `{ pts, who, n }` (most points removed in one placement), `deficit` `{ a, b }` (the most each player has
trailed by), `wipes`, `trips` (three-dice wipes, triple stacks) and `cb` (a comeback was already called). Each move's `state.last`
also has `pts`, `gain`, `triple`, `wipe` and `comeback`. Rules never read these.

`result(s).sub` picks one commentary line: a win by three or less ("Won by 1! 22 to 21. So close — rematch?"), a comeback from 15+
down, a 20+ point wipe, a triple stack, or just the score. `winner` is never affected.

## Records and rivalry (`api.data`)

Written once per match when the finale runs on a match that was **not** already over when this phone first opened it. Both phones
compute the same values from the same state; `last_id` makes it idempotent. If the partner got there first, the flags are read back
from `last_flags`.

| key | meaning |
|---|---|
| `games_n`, `draw_n` | matches recorded, draws |
| `best_a_best`, `best_b_best` | highest grid total for Emerson (`a`) / Sydney (`b`) |
| `smash_best`, `smash_who` | most points wiped in one placement, and by whom |
| `comeback_best`, `comeback_who` | biggest deficit a winner overcame, and who |
| `wipe_n` | three-dice wipes |
| `streak_who` (`a`/`b`/`-`), `streak_len`, `streak_len_best` | current winning streak and the best ever |
| `form` | last five winners, e.g. `aabab`; `-` for a draw |
| `last_id`, `last_flags` | match last recorded, and its NEW BEST flags (`pb_a`, `pb_b`, `smash`, `comeback`) |
| `tw_<twist>_n`, `tw_<twist>_<a|b>_n` | matches played and wins per twist (`classic` included) |

`*_best` and `*_n` only ever go up (the data layer keeps the maximum when syncing). NEW BEST flags need an earlier record to beat, so
the first game only sets baselines. Everything is optional: with no `api.data` or no data the game plays normally.

The in-game finale shows "Emerson has won 3 straight", the form strip (blue and pink ink dots, hollow for a draw) and up to two
stamps ("New best: 71", "Biggest smash ever", "Biggest comeback"), then the engine's end card (`endDelay: 'manual'`, shown when the
final smash and these stamps are done).

## Feedback and delight

- **Score preview** while picking: every open column shows your gain (`+N`) in your totals row and their loss (`−M`) in theirs.
  Hidden in Blind Draw; no loss in a soft Last Word die.
- **Stamps** (printed-ink style): "Triple 5s · 45", "Wiped out" (three dice, bigger shard burst), "Comeback!" (took the lead after
  being 15+ down, once per player per match).
- **Full column**: tapping one says "That column is full", plays the "bad" sound and shakes. Columns use `aria-disabled`, not `disabled`,
  so the tap arrives on a phone.
- **Tap to skip**: a tap anywhere on the stage (but a pickable column) while a roll or placement plays out fast-forwards it. It never
  places a die.
- **Twist picker**: the starter, before the first die, gets a 2 × 2 grid of chips (≥ 44 px, label plus one-line hint) over the
  opponent's empty half. The last twist you picked is highlighted (`localStorage` `ju.bones.twist`) but never sent for you.
  The partner sees "Emerson is choosing a twist…", then a toast "Emerson picked Golden Column". The twist shows as a badge on the band
  for the whole match.
- **Layout**: dice are sized from the viewport, not the content, so the board fits without scrolling at 320 × 568 up to 430 × 932
  portrait and 667 × 375 / 844 × 390 landscape (trays side by side with the band between). Column buttons are at least 44 px wide
  even when the die is narrower. Down to 320 × 568 the dice are 37 px.

## Tests

```
node tools/test/games/threed-bones.test.js          # rules in Node, records maths, then the phone UI (PORT=8900 uses 8900-8902)
node tools/test/games/threed-bones.test.js --unit   # rules and records only
node tools/test/games/threed-bones.test.js --balance
node tools/test/games/threed.test.js                # the older bones + tower flows
```

The page exposes `window.__bonesTest` (a log of `roll:`, `place`, `crack`, `stamp:`, `sfx:`, `records:` events, plus frame and draw-call
counters) for the tests; nothing depends on it.
