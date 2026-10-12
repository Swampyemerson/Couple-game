# Ultimate Tic-Tac-Toe (`js/games/ultimate.js`)

Nine small boards in a 3 x 3. The square you pick sends your partner to the matching small board;
if that board is won or full they may play in any open board. Three in a row takes a small board,
three small boards in a row takes the game. If neither player can still make a big line, most
boards won wins (equal is a draw).

## Moves and versions

| Move | Meaning |
|---|---|
| `{ b, i }` | place a mark in small board `b`, square `i` (both 0-8, row-major) |
| `{ setup: 2, mode }` | v2 only. The very first move of a match. First mover only, before any mark, once. Sets `s.v = 2` and `s.mode`; **does not pass the turn**. Unknown mode throws `Unknown mode` |
| `{ steal: 1 }` | v2 only. The second player's very first action, right after the opener's first mark (see Balance) |
| `{ b, i, wild: 1 }` | Wildcards mode only: play in any open board, ignoring the send. Once per player per game |

Legacy matches (saved before v2) have no setup move, so `s.v` is undefined and the original rules run
unchanged: same states, same results, same error messages. Extra fields on a legacy move (`wild`,
`steal`) are ignored exactly as before. `board.test.js` replays the old `ULT_WIN` log and 250 random
logs (junk and illegal moves included) against a verbatim copy of the original `applyMove`.

The UI sends the setup move right before the first real move (two `api.move` calls in a row). Tapping
the board without touching the mode picker plays the remembered mode (`api.data().mode`, default
`classic`), so there is no extra step.

State additions (v2 only): `v`, `mode`, `first` (the opener), `stl` (1 once the opening mark was
taken), `lw` (1 when the last move was a wildcard), `down` (`{a, b}`: the most boards each player was
ever behind, for the comeback moment), `hot` (Hot Boards), `wild` (`{a, b}` wildcards left).

## Modes

- **classic**: the balanced v2 rules (the steal, below).
- **hot** (Hot Boards): two boards, picked from the match seed (`shuffled([0..8], seed|hot)`), are hot.
  They wear a Riso star. A hot board counts 2 in the boards-won count (score chips, the count ending,
  the result text); line rules are unchanged. Winning a hot board plays a small stamp.
- **wild** (Wildcards): each player holds one wildcard. In the UI, tap your token to arm it, then
  tap a square in any open board. Refused (friendly message, nothing spent) when you already have a
  free move, when you aim at the board you were sent to, in other modes, or when it is already spent.
  The send rule carries on from the square you played as usual.

## Balance (the BALANCE section in the file)

Bot self-play showed the first mover winning clearly more often than the second. v2 games use the pie
rule: after the opener's first mark the second player may play `{ steal: 1 }` instead of a mark of
their own. The mark changes owner, the opener moves next, and the send rule is untouched: the force
stays as set by the stolen mark's cell. Legal only for the second player, only as their very first
action, once. The UI shows a "Take that mark" button (at least 44 px) on that turn. All code for this
is isolated in the `BALANCE` section (`stealWhy`, `canSteal`, `applySteal`); `BALANCE.steal = false`
switches it off.

## Last Light (view only)

Derived from the big board, no state: when one or two big lines can still be completed by anyone,
the plate area names them ("Only the left column can still win it") and the lines are drawn as a
faint dotted rail; boards on no live line get a slightly dimmer paper. When the game ends on a
count, the finale says "No big line left — boards decide".

## Records, rivalry and moments

Shared game data (`gameDataApi('ultimate')`), flat keys. Counters that only go up end in `_n` or
`_best`: `games_n`, `draws_n`, `wins_a_n`, `wins_b_n`, `<mode>_a_n`, `<mode>_b_n` (`v1` for legacy
matches), `line_n`, `count_n`, `comeback_n`, `streak_best`, `quick_best` (= 82 minus the squares in
the fastest win, so it goes up). Streak fields reset and so carry no suffix: `streak`, `streak_who`,
`streak_best_who`, `quick_who`. Also `mode` (the last picked mode), `last_id`, `last_moment`.

A match is counted once: the view that **observes** the match going from not-over to over writes the
tally, skipping when `data.last_id === matchId`. The write is a pure function of the data before the
match and the finished match, so both phones compute the same values. `last_moment` is
`<situation>.<index>.<k>`; both phones render the same line from it (a phone that opens an
already-finished match reads the stored code, or shows nothing). Draws leave the streak alone.

Moment situations, in priority order: draw, record (fastest win ever), streakBreak, streakExt,
comeback (won after being 2+ boards behind), wild (the winning move was the wildcard), hot (won with a
hot board), stolen (the stealer won), rout, photo (count win by one board), firstMode, then generic
line/count. 65 lines in the pool. The strip on the empty board (both phones) picks from first game,
streak, first game in this mode, running score and level lines, chosen with `randInt(n, matchId,
'strip')`.

## View notes

- Marks are coloured on the mark itself (`.gu-m.gu-a .gu-col`), not by the region class, so an X in a
  board lit for Sydney stays blue.
- Roving tabindex: one tab stop for the grid (the cursor cell). Enter or Space places the focused
  cell; arrows start from it and clamp to the board you were sent to.
- A free move (every open board legal) gets a quiet tint instead of nine breathing rings. The ghost
  mark is an outline with a pale core so it reads on the yellow aim tile.
- Landscape phones (`orientation: landscape` and height at most 560 px): board left, picker, strip,
  plate and notes right; the board is sized from the height left under the game chrome
  (`fit()`), and the empty status line is reclaimed while playing. `.gm` stays a column in
  `games.css`, so the board is limited to roughly 225 to 280 px tall on the smallest phones.
- Test hook: `def.kit` exposes the pure helpers (`tally`, `momentKeys`, `momentText`, `stripText`,
  `liveLines`, `lastLight`, `canSteal`).
