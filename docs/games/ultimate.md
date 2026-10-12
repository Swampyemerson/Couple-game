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
| `{ b, i, wild: 1 }` | Wildcards mode only: play in any open board, ignoring the send. Once per player per game |

Legacy matches (saved before v2) have no setup move, so `s.v` is undefined and the original rules run
unchanged: same states, same results, same error messages. Extra fields on a legacy move (`wild`,
`steal`) are ignored exactly as before. `board.test.js` replays the old `ULT_WIN` log and 250 random
logs (junk and illegal moves included) against a verbatim copy of the original `applyMove`.

The UI sends the setup move right before the first real move (two `api.move` calls in a row). Tapping
the board without touching the mode picker plays the remembered mode (`api.data().mode`, default
`classic`), so there is no extra step.

State additions (v2 only): `v`, `mode`, `first` (the first mover, recorded at setup; the komi reads it), `lw` (1 when the last move was a wildcard), `down` (`{a, b}`: the most boards each player was
ever behind, for the comeback moment), `hot` (Hot Boards), `wild` (`{a, b}` wildcards left).

## Modes

- **classic**: the balanced v2 rules (komi, below).
- **hot** (Hot Boards): one opposite pair through the centre, picked from the match seed
  (`0&8`, `1&7`, `2&6` or `3&5`), is hot. Both wear a Riso star. A hot board counts 2 in the
  boards-won count (score chips, the count ending, the result text, the komi tie-break); line rules
  are unchanged. The `HOT` object in the file (`pick`, `weight`) is the one place to change which
  boards are hot and what they weigh. Winning a hot board plays a small stamp.
- **wild** (Wildcards): each player holds one wildcard. In the UI, tap your token to arm it, then
  tap a square in any open board. Refused (friendly message, nothing spent) when you already have a
  free move, when you aim at the board you were sent to, in other modes, or when it is already spent.
  The send rule carries on from the square you played as usual.

## Balance (the BALANCE section in the file)

Bot self-play (equal-strength bots on both sides, MCTS with the given rollout budget) showed the
first mover winning clearly more often than the second:

| Variant | Bot | P1 | P2 | Draw |
|---|---|---|---|---|
| baseline | MCTS 500 | 49.6 % | 42.9 % | 7.5 % |
| baseline | MCTS 20000 | 48.3 % | 33.3 % | 18.5 % |
| **komi** | MCTS 500 | 49.2 % | 50.8 % | 0 |
| **komi** | MCTS 20000 | 50.0 % | 50.0 % | 0 |
| pie (steal) | MCTS 2500 | 44.7 % | 44.7 % | 10.7 % |
| pie (steal) | MCTS 20000 | 38 % | 43 % | 19 % |

Hot Boards (MCTS 2500, with komi, P1 minus P2): two random hot boards **+11.8 pp** (CI 4.9 to 18.6,
N=800) put the first mover well ahead; one opposite pair through the centre **+1.0 pp** (CI −3.0 to
+5.0, N=2400) is level, so that is what ships. Plain komi pooled over its runs: −0.2 pp (CI −4.6 to
+4.2, N=2000).

The stronger the players, the more draws and the bigger P1's edge, and the first mover's edge is
mostly "ties and near-ties on the count go their way". Komi removes exactly that: v2 games have no
draws, and a count ending tied on boards (hot boards weighed double in Hot Boards) is won by the
player who did **not** move first. It is exactly even at the stronger budget and within noise at
the weaker one, costs no extra UI step, needs no new move (so no new encoding to replay), and is
easy to explain: "Tied on boards at the end? The player who went second wins." The pie rule
(`{ steal: 1 }`) was tried first and dropped: it overshoots at higher strength (P2 ahead) and keeps
the draws. It never shipped, so no saved log contains it and `{ steal: 1 }` is rejected like any
bad move.

Rules: the first mover is stored at setup (`s.first`). Only a *count* ending is affected (a big
line still wins outright, and a lead on boards still wins); the end is stored as
`{ why: 'count', who: <second mover>, a, b, tie: 1 }` and the result sub is "Boards tied 4–4 — ties
go to the player who went second." Legacy matches (no setup move) keep the old count rules, draws
included. It is visible before it matters: a "Ties → <second mover>" chip (name in their ink) sits
above the plate from the empty board on, Last Light adds "Tied on boards so far: ties go to
<name>" while boards are level, and the finale says who the tie went to. Flip `BALANCE.komi` to
switch it off.

## Last Light (view only)

Derived from the big board, no state: when one or two big lines can still be completed by anyone,
the plate area names them ("Only the left column can still win it") and the lines are drawn as a
faint dotted rail; boards on no live line get a slightly dimmer paper. When the game ends on a
count, the finale says "No big line left — boards decide" (or, on a tie, who the tie went to).

## Match point, Denied!, the wildcard tell and the ledger (view only, plus one counter)

- **Match point:** for the player to move, if winning the board they are sent to (any open board on a
  free move) would complete a big line, the plate on both phones says "<name> is one board from the
  win" (mover: followed by where to play). Pure function of `s.big`, `s.force`, `s.turn` (`matchPoint`),
  so it also shows in legacy matches.
- **Denied!:** when a move wins a small board that was the third cell of a big line the other player
  held two of (`denies` / `deniedNow(prev, s)`), a "Denied!" stamp (the moment-line styling) shows over
  the board for about 1.5 s on both phones. It only plays for a move seen arriving, never when a
  match is opened. v2 states also count denials per player in `s.dn`, which feeds the `deny` moment
  (priority right after `comeback`: "<w> denied the line, then took it." and four more).
- **Wildcard tell:** in Wildcards, while the opponent's wildcard is unspent, the mover's plate ends
  with "· <opponent> still holds a wildcard".
- **Series ledger:** under the moment line on both phones, "Series: Emerson 5 · Sydney 4 · Sydney on 2"
  (streak shown from 2, draws only when there are some), read from the shared data once the tally for
  this match is in (`last_id === matchId`), so both phones show the same numbers.

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
hot board), komi (won on the tie-break), rout, photo (count win by one board), firstMode, then generic
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
  `liveLines`, `lastLight`, `tieNote`, `secondMover`, `matchPoint`, `deniedNow`, `ledgerText`).
