# Four in a Row — design

7 × 6 board with gravity, two players, turn based. Entry `js/games/four.js`. Tests: the four sections of
`tools/test/games/board.test.js` (rules in node, then the UI on two simulated phones).

## Modes

The mode is picked by the first mover before the first disc and is fixed for the match. Choosing a mode
stores it with `api.setData({ mode })`, so rematches and new matches start on the last choice.
Tapping the board without touching the picker plays the selected mode.

| id | name | rules |
|---|---|---|
| `classic` | Classic | The original game. |
| `ghost` | Ghost Column | A seeded non-centre column (0, 1, 2, 4, 5 or 6) holds at most 3 discs. Drawn as a torn-paper cap with a ghost. A drop into the full capped column is refused ("The ghost has that column…"). The game is a draw when no legal drop remains (39 discs; the result says "No drops left", not "Board full"). |
| `pop` | PopOut | On your turn you may instead pop one of YOUR discs out of the bottom row; the column slips down one. After a pop, fours are checked for both colours. Both lined up: the popper wins. Only the other side's four: they win. A hundred moves with no four is a draw (PopOut can cycle). |

`big` (8 × 7) was not built: the board geometry is shared constants, so it was not cheap.

## Move encodings

| move | meaning |
|---|---|
| `{ col: 0..6 }` | drop a disc (legacy, unchanged) |
| `{ setup: 2, mode: '<id>' }` | v2 setup, see below |
| `{ pop: 0..6 }` | PopOut: pop your own bottom disc in that column |

Errors thrown by `apply` are shown to the player: `Unknown mode`, `That column is full`,
`The ghost has that column. Three discs, no more`, `You can only pop your own discs from the bottom row`, …

## Versioning

Saved matches have no setup move, so `s.v` is undefined and the game behaves exactly as before
(regression tests replay the `FOUR_DIAG` and `FOUR_DRAW` logs and compare the final state, byte for byte,
with what the original code produced).

`{ setup: 2, mode }` is legal only as the first move of a match (`s.n === 0`, no setup yet) and only from
the first mover (`who === s.turn`). It sets `s.v = 2`, `s.mode`, per-player counters `mv` (moves made) and
`bl` (blocks), and for Ghost Column `s.ghost` (column from `randInt(6, seed, 'ghost')`). It does not pass the
turn. The new UI sends it right before the first real move (two `api.move` calls in a row).
`s.draw` (`'full' | 'long' | 'stuck'`) ends a v2 game as a draw; legacy games still end at 42 discs.
A win is `s.win = { who, runs, [pop], [both], [gift] }` (`both` = the other side's runs, popper wins;
`gift` = the popper only made the other side's four).

## Records (shared per-game data, `gamedata/four`)

Counted once, by a view that watched the match go from not-over to over (a match opened already over is not
counted). Both phones may write; the write is idempotent (`last_id` = match id) and the values come from the
same inputs. `api.data()` is not on the turn-game `api` in core, so the game uses the exported
`gameDataApi('four')` (same functions) when `api.data` is missing.

Keys: `games_n`, `draws_n`, `wins_a_n` / `wins_b_n`, `<mode>_a_n` / `<mode>_b_n`, `streak_who` + `streak`
(reset on a draw, so no `_n`/`_best` suffix), `streak_best` + `streak_best_who`, `quick_best` (= 100 − the
winner's moves, so bigger is faster) + `quick_best_who`, `comeback_a_n` / `comeback_b_n` (winner blocked 2+
fours; a PopOut "gift" win, where the loser's own pop made the winner's four, never counts as a fastest
win or gets the record / rout moment lines), `mode` (last chosen), `last_id`, and `p_streak`, `p_streak_who`, `p_quick`, `p_mw` — the records as
they stood before the last match, so the phone that counts second still picks the same moment line.

## Words

- **Rivalry strip** on the empty board (first mover only; the partner sees "… is picking a mode…"): the
  tally with draws, plus one flavour line (first game in a mode, an active streak, the fastest win).
- **Moment line** in the finale, chosen deterministically from the match (`randInt(n, seed, 'moment', sit)`):
  record, streak broken, streak, escape artist (blocked 2+), photo finish, first win in a mode, rout (≤ 7
  moves), "So close" (the loser had an open three), generic; draws have their own pool. 30+ lines.
- **Blocked!** stamp when a drop fills the hole the other side needed (derived from the board, so both
  phones show it).

## Input and layout

- Keyboard: the columns are one roving tab stop; Tab onto them previews a disc over the focused column,
  arrows move focus and disc, Enter / Space drops the focused column, 1–7 jump, P toggles popping.
  Esc puts a lifted disc away (a capture-phase listener that calls `preventDefault`, because core closes the
  game on an unhandled Esc); with nothing lifted it closes the game as before. Taps on a disabled board land on a guard layer: the plate pulses and a toast says whose
  turn it is (nothing is played).
- PopOut shows "Drop a disc / Pop one out" (44 px) for the player to move; poppable bottom discs get a
  dashed ring, the aimed one a solid ring.
- Portrait: board, plate, then the picker / strip below it (the board does not jump when they go away). The
  board size is budgeted (`--g4-chrome`) for the tallest state under it (picker + strip + one-line mode
  description) so nothing scrolls down to 360 × 560; under 720 px high the strip's flavour line is dropped.
- Landscape (≥ 560 px wide): board left, picker / plate / pop buttons right. In short windows
  (≤ 560 px high) the lift row above the board is cropped away (the landing ring and column tint show where
  the disc will go), so a 844 × 390 phone has a ~237 px board with ~32 px columns and no scrolling. 44 px
  columns are not possible there: the game chrome above leaves ~215 px.
