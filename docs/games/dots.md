# Dots & Boxes: design

Entry `js/games/dots.js`. Tests: `tools/test/games/board.test.js` (sections prefixed `dots`; the
legacy-replay fixture is `tools/test/games/fixtures/dots-legacy.mjs`, the original rules verbatim).

## Rules

Take turns drawing one line between two neighbouring dots. A line that completes a box claims it for
the drawer, who goes again (one line can close two boxes: one extra turn). When every line is drawn,
the most points wins. Equal points is a draw.

Moves: `{ l: 'h' | 'v', r, c }`. `h` lines run across (`r` 0..N-1, `c` 0..N-2), `v` lines run down
(`r` 0..N-2, `c` 0..N-1), N = dots per side. The encoding never changed.

State (JSON): `h`, `v` (arrays of `null | 'a' | 'b' | 's'`, the drawer; `'s'` = a scramble pre-line),
`boxes` (owner or null), `turn`, `order` (the line keys `h-r-c`, played lines only), `got` (boxes the
last line closed). v2 adds `ver`, `mode`, `n`, and per mode `heart` + `prompt` (sweet) or `pre` (scramble).

## Versioning (important)

Matches saved before the modes existed have no setup move. They replay exactly as before: 5x5 dots,
4x4 boxes, 40 lines. A legacy state has no `ver`/`n`/`mode`, `dimOf(s)` reads `s.n || 5`, and `init`
is unchanged. (The state field `v` is the vertical lines, so the version lives in **`ver`**, not `v`.)

New matches start with the **setup move** `{ setup: 2, mode }`:

- legal only as the first move of the match (no line drawn, no setup yet) and only from the first mover;
- sets `ver = 2`, `mode`, `n`, resets the arrays to that size and seeds the mode data from `state.seed`;
- **does not pass the turn**; the first mover then plays their first line;
- unknown mode or a setup version other than 2: `Error('Unknown mode')`.

The UI sends the setup immediately before the first real line (two `api.move` calls in a row); if the
setup is refused it toasts and stops. The legacy test (`dots: legacy logs ...`) replays 120 random
legacy matches through the snapshot of the old rules and the live module: states, `next`, `score`,
`result` and error messages are identical, as is the engine's `derive`.

## Modes

| id | dots | boxes | lines | what |
|---|---|---|---|---|
| `classic` | 5x5 | 4x4 | 40 | the original game |
| `quick` | 4x4 | 3x3 | 24 | coffee-break round |
| `big` | 6x6 | 5x5 | 60 | room to scheme |
| `sweet` | 5x5 | 4x4 | 40 | Sweetheart: one seeded heart box worth 2 points |
| `scramble` | 5x5 | 4x4 | 40 | 4 to 6 seeded pre-drawn lines |

**Sweetheart.** `heart = randInt(16, seed, 'heart')`, `prompt = randInt(45, seed, 'prompt')` (index into
`PROMPTS`, 45 couple prompts). Closing the heart is worth 2 points but is still one box (one extra turn).
`score()` and `result()` count points; there are 17 in play, so **a sweet match can never be a draw**
(an odd total). The closer's phone and the partner's both show a "heart prompt" card (non-blocking, a
44 px "Done, carry on" button, dismissal remembered per match in `localStorage` on that phone only).

**Scramble.** Lines are picked from a seeded shuffle, greedily, so that no box ever has more than two
pre-drawn sides: nothing is closed and no box has three sides at the start. They are marked `'s'` in
`h`/`v` and listed in `pre`; they are not in `order`. The game ends when `order.length + pre.length`
reaches the total. The picker previews the exact pre-lines and heart for the selected mode (the preview
is the real `configure()` applied to a copy of the empty state).

## Mode picker

While the match has no setup and no lines and this phone may move, a row of five chips (44 px tall,
`g-chip`) sits under the board with a one-line description. The default is `api.data().mode` if valid,
else Classic; choosing a chip stores it with `setData({ mode })` so the next match remembers. The
waiting phone shows "<name> is picking a mode…" and no chips (the chips are only in the DOM while
picking). Tapping the board without touching the picker plays the selected (default) mode. After the
first line a `Quick`/`Big`/... chip labels the mode (hidden for Classic).

## Feel

- **Owner-coloured lines**: a thin underlay in the drawer's ink under the black line; pre-drawn lines
  get a neutral underlay. The last turn's lines stay highlighted in yellow.
- **Chain meter**: boxes taken in one turn count up, each box plays a rising pentatonic note
  (`api.audio()`, 330 Hz upwards, silent when muted), and from 3 boxes a "Chain of N!" stamp shows on
  the board. The partner sees the same replay. The plate says "Chain of N! Go again".
- **Sacrifice call-out** (only when unambiguous): in a turn that has already taken a box, a line that
  closes nothing but leaves exactly one two-box pair sharing one undrawn side, while a capturable box
  was on offer. "<name> gives up 2 to keep control". It does not claim the count that follows.
- **One status text**: the plate carries all text; the stage's own status line stays empty and is hidden
  (it comes back with the result and the Rematch button after the end card is dismissed).
- **Layout**: the board is sized in JS to what the stage leaves. Landscape (stage wider than 1.2x its
  height) puts the board left and picker/strip/plate right, no scrolling (844x390, 667x375 tested).
  Portrait stacks board over plate. The stage scrolls only on very small screens.
- **Keyboard**: the grid is one tab stop (roving `tabindex`). Left/Right move along a row of lines,
  Up/Down move to the next row (horizontal rows and vertical rows alternate) keeping the column,
  skipping lines already drawn. Enter or Space picks the focused line, again draws it; Escape lets go.
  Focus stays on a free line after drawing.

## Records, streaks, rivalry

Per-game shared data (`gamedata/dots`), flat keys. A match is counted once: the phone that **observes**
the transition from not-over to over writes `last_id: matchId` along with the totals, and skips if
`last_id` already equals the match. Both phones compute the same values from the same inputs.

| key | meaning |
|---|---|
| `mode` | last picked mode |
| `last_id` | match counted last |
| `games_n`, `draws_n`, `w_a_n`, `w_b_n` | totals (only go up) |
| `<mode>_a_n`, `<mode>_b_n` | wins per mode |
| `streak_who`, `streak` | current win streak (a draw leaves it alone) |
| `streak_best`, `streak_best_who` | longest ever |
| `chain_best`, `chain_best_who` | most boxes in one turn |
| `margin_best`, `margin_best_who` | biggest margin in points |
| `p_g`, `p_streak`, `p_streak_who`, `p_chain`, `p_margin`, `p_mw` | the records as they were just before `last_id`, so both phones tell the same moment line |

(Keys ending `_n`, `_best`, `_m`, `_pb` merge as "keep the larger"; the resetting `streak` does not.)

The **rivalry strip** shows above the picker on an empty board ("Sydney is on a 3-game streak · break
it?", "First game of Dots & Boxes. Be gentle.", a series line...). The **moment line** shows under the
plate when a match ends, picked deterministically from `state.seed` (so both phones agree) in this
order: draw, sacrifice by the winner, new chain record, comeback (winner trailed by at least 20 % of
the points), streak broken, streak extended (3+), first win in a mode, rout, photo finish, big chain,
plain win. 40+ lines in `MOMENTS`/`STRIP`, none shaming. Situations that need the records are only used
when the match was counted (otherwise only what the match itself shows).

## Known limits

- Smallest tap target is the diamond around a line: about 54 px wide on Big at 360 px (Quick and
  Classic are larger). Tap-then-confirm guards against slips.
- Landscape phones get a board about 240-250 px (the page chrome above the stage takes ~110 px).
- The core `api` for turn games has no `data()`; `dots.js` falls back to `gameDataApi('dots')`
  imported from core.
