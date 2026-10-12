# Board unit report: Ultimate Tic-Tac-Toe, Four in a Row, Dots & Boxes

Branch `claude/upd-board`. Files touched:
- `js/games/ultimate.js`, `js/games/four.js` and `js/games/dots.js`.
- `tools/test/games/board.test.js`, plus a new fixture, `tools/test/games/fixtures/dots-legacy.mjs`: the original Dots rules, used for the legacy replay test.
- New docs: `docs/games/{ultimate,four,dots}.md` and `docs/games/ultimate-balance.md`, which has the full bot results.
- New: `tools/test/games/ultimate-balance/`. It holds the self-play simulator and is not a test suite, because no file there ends in `.test.js`.
- Nothing shared was edited: not `core.js`, `games.css`, `harness.js`, `covers.js` or `README.md`.

How the work ran:
- **Survey:** three Sonnet agents, one per game. Each played its game through the harness on an iPhone 13 profile with real taps.
- **Content check:** one Fable agent, which reviewed the survey summaries for content they missed.
- **Spec and build:** a spec, then three Sonnet builders, one per game.
- **Verification:** three independent Sonnet verifiers checked the builds, and the original builders then fixed what the verifiers found.
- **Balance:** a Sonnet agent ran the bot self-play.
- **Round 2,** at the coordinator's request: a Fable agent played all three builds and proposed the highest-impact missing additions. The builders added the best three per game, and a final independent Sonnet verifier checked everything on iPhone (real taps) and laptop, light and dark.

## User must-have: Ultimate Tic-Tac-Toe balance

**Method.** I wrote a bitmask simulator of the exact rules and cross-checked it against the real `js/games/ultimate.js`. Over 200 random games (11,633 moves and about 942,000 legality checks) it had 0 mismatches. The same check still passes on the shipped file for legacy rules. Equal-strength bots played both seats:
- UCT Monte-Carlo tree search at 500, 2,500 and 20,000 playouts per move;
- a 2-ply heuristic bot.

The confidence intervals are 95% normal intervals on (P1 win − P2 win), with a draw counted as 0. To reproduce, see `tools/test/games/ultimate-balance/README.md`.

**Before: the current rules give the first player a real edge, and it grows with skill.**

| Bot | Games | P1 win | P2 win | Draw | P1 − P2 | 95% CI |
|---|---|---|---|---|---|---|
| Heuristic 2-ply | 3000 | 53.8% | 33.2% | 13.0% | +20.5 pp | 17.3 to 23.8 |
| MCTS 500 | 3000 | 49.6% | 42.9% | 7.5% | +6.7 pp | 3.3 to 10.1 |
| MCTS 2500 | 1200 | 48.8% | 40.8% | 10.4% | +7.9 pp | 2.6 to 13.3 |
| MCTS 20000 | 400 | 48.3% | 33.3% | 18.5% | +15.0 pp | 6.3 to 23.7 |

**Candidates tested.** Full table in `docs/games/ultimate-balance.md`.
- **Pie / steal rule:** the second player may take the opener's first mark. It came out at +5.7 pp at 500 playouts, 0.0 at 2500 and −5.0 at 20000. So it overshoots or undershoots depending on skill, and it adds a decision step. The stronger the bots, the more often the opener's mark was stolen: 22%, then 45%, then 76%.
- **Opening restrictions** (no first move in the centre board or on a centre square) leave the edge in place: +4.7 to +6.3 pp at 500 playouts, and +19.0 pp at 20000.
- **Seeded openings** come out at +7.8 to +8.9 pp, and a **free second move** at +8.9 pp. Neither helps.
- **Komi** wins: when the game ends on boards won and they are tied, the player who went second wins.

**After: komi is now the rule in every new Ultimate game.**

| Bot | Games | P1 win | P2 win | Draw | P1 − P2 | 95% CI |
|---|---|---|---|---|---|---|
| MCTS 500 | 2000 | 49.2% | 50.8% | 0% | −1.6 pp | −6.0 to 2.8 |
| MCTS 2500 | 1200 | 51.1% | 48.9% | 0% | +2.2 pp | −3.5 to 7.8 |
| MCTS 20000 | 400 | 50.0% | 50.0% | 0% | 0.0 pp | −9.8 to 9.8 |
| Pooled, MCTS 2500, 2 seeds | 2000 | 49.9% | 50.1% | 0% | −0.2 pp | −4.6 to 4.2 |

- Komi is not just "draws go to P2". Only about 10% of P2's wins come from the tiebreak itself. The rest come from the second player playing for the count.
- It needs no extra UI step. A "Ties → Sydney" chip, naming whoever moved second, is shown from the empty board onward. One how-to line explains it, and the end text says it.
- Draws no longer exist in new games. Old games keep them.

**Hot Boards was balanced the same way.** With two random hot boards, the first player's edge grew to +16.0 pp, or +11.8 pp with komi. We tested four fixes. The shipped one makes the hot boards a seeded opposite pair through the centre (0&8, 1&7, 2&6 or 3&5). It measured 50.5% / 49.5%, which is +1.0 pp (CI −3.0 to 5.0, N = 2400, MCTS 2500, with komi). Wildcards mode was not measured: the simulator has no wildcard move.

**Old saved matches still replay.** The new rules are switched on by a setup move, `{ setup: 2, mode }`. It is the first move of a new match, and it is legal only for the first mover before any mark. Old logs never contain one, so they run the old rules exactly.

This is tested in three ways:
- 250 random legacy logs, including illegal moves, are compared move by move against a verbatim copy of the original rules.
- The verifier made seven matches with the old build: line wins for each player, a count win, a draw and three in-progress matches. It opened them in the new build and got identical boards and results. It played the in-progress matches to the end, and no new UI appeared.
- The pie rule never shipped, so there are no `{ steal }` moves anywhere. A steal is now rejected like any other bad move.

The setup-move pattern is necessary because `core.js` always creates matches with `opts: {}`, so a game has no way to version through `opts`.

## Per game

### Ultimate Tic-Tac-Toe
**New**
- **Modes**, picked by the first mover on the empty board and remembered for rematches:
  - **Classic**: the balanced rules.
  - **Hot Boards**: two facing star boards count double if boards decide. Winning one gets a stamp moment.
  - **Wildcards**: each player gets one move that ignores the send.
- **Last Light:** when only one or two big lines can still win, the plate names them ("Only the left column can still win it") and they are traced faintly on the board. When boards will decide, the plate says so before the end.
- **Rivalry, streaks and records** live in the shared per-game data. A strip on the empty board shows the current state, for example "Sydney is on a 3-game streak · break it?". Each finished game gets a moment line drawn from a seeded pool of 65 lines across 13 situations, so both phones show the same one. Situations include a comeback, a photo finish, a won tiebreak, a new record and a broken streak.
- Each match is counted exactly once, by the phone or phones that saw it end. The write is idempotent through `last_id`.
- **Round 2:**
  - A **match-point plate**, "Sydney is one board from the win", on both phones.
  - A **"Denied!"** stamp when someone wins a board their partner needed for a line, with its own `deny` moment lines.
  - A **series ledger** under the finale moment on both phones, e.g. "Series: Emerson 5 · Sydney 4 · Sydney on 2".
  - In Wildcards, a "· Sydney still holds a wildcard" reminder on the plate.

**Fixed**
- Emerson's X marks drew in pink inside any board highlighted for Sydney. This was a CSS specificity clash, and the colour rules are now scoped to the mark itself.
- Tab then Enter ignored the focused cell. The grid is now a single tab stop with a roving cursor. Arrows start from the focused cell, and the mode chips come before the grid in tab order.
- In landscape the plate was below the fold and the page scrolled. The plate now sits beside the board with no scroll at 844×390, 667×375 and 932×430, and the board re-fits after the end card.
- **Polish:**
  - The aim mark is now an outline instead of a muddy ghost.
  - The free-move highlight is calmer, where all nine boards used to ring on move 1.
  - The duplicate "X's turn" status line is gone.
  - Hot stamps and spent wildcards are readable in dark mode.

### Four in a Row
**New**
- **Modes:**
  - **Classic**: the old rules, unchanged.
  - **Ghost Column**: a seeded column other than the centre holds only 3 discs, drawn as a torn-paper cap with a ghost. When it is full the game is a draw, with "No drops left".
  - **PopOut**: on your turn you may instead pop one of your own bottom discs. If both players get four, the popper wins.
- A **"Blocked!"** stamp appears when a drop stops an immediate four.
- **Moment lines** come from a pool of 30+, including near-miss lines such as "So close".
- **Streaks and records:** fastest win, per-mode wins, draws counted, comebacks and a rivalry strip. Each match is counted exactly once. A PopOut "gift" win, where the loser popped four for the winner, doesn't count as a record.
- **Round 2:**
  - A **"Trap!"** stamp when a drop leaves two winning threats at once, with `trap` moment lines and trap counters in the strip.
  - A **series ledger** under the finale moment on both phones.
  - **Blockers mode:** three seeded grey stones sit on the floor of three non-centre columns. They fill a hole and never count toward a four.

**Fixed**
- Keyboard control now follows the focused column, and Tab previews the disc.
- Esc now puts a lifted disc away. Before, core's Esc handler closed the game.
- Tapping a locked board out of turn now gives a gentle whose-turn cue.
- The empty band above the board in portrait is tightened. The picker, PopOut and label states no longer scroll down to 360×560.
- Landscape is side by side with no scroll.
- Mode descriptions now show in portrait.

### Dots & Boxes
**New**
- **Modes:**
  - **Classic**: 4×4 boxes.
  - **Quick**: 3×3.
  - **Big**: 5×5.
  - **Sweetheart**: one seeded heart box is worth 2. Closing it reveals one of 45 warm couple prompts on both phones.
  - **Scramble**: 4–6 seeded pre-drawn lines, none of which closes a box or leaves a box with three sides, so every opening differs.
- Lines are underlaid in the colour of the player who drew them.
- **Chain meter:** each box in a turn plays a rising pentatonic note, and a "Chain of N!" stamp appears from 3 boxes up. The partner sees it replay.
- A **sacrifice callout**, "X gives up 2 to keep control", fires only in the unambiguous case.
- **Records, streaks and moment lines**, with 51 lines in total. The longest-chain record waits for a previous record before calling itself "new".
- **Round 2:**
  - **Squeeze plates:** "Last safe line!", "No safe lines left — Emerson has to give" and "3 boxes on offer".
  - The finale moment is now a yellow stamp with a **series ledger** under it.
  - **Sweetheart heart race:** a strip line such as "Heart race: Sydney 3, Emerson 1", and a `heartSwing` moment when the heart decided a close game.

**Fixed**
- In landscape the board was clipped and the pill was off-screen. The board is now sized in JS and the layout is side by side with no scroll. Callout stamps sit in the side column, so they never cover the boxes.
- There was no keyboard play. The grid is now one tab stop: arrows move between free lines, and Enter or Space selects then draws.
- The duplicated status text is gone, including after "See the board".

## Test results
- `node tools/test/games/board.test.js`: **533 passed, 0 failed** (light and dark, two phones; up from 113 checks before the update). `node tools/test/all-games.test.js`: ALL GOOD.
- Build: `python3 tools/build_artifact.py --only=ultimate|four|dots` succeeds for each game.
- The independent verifiers used real `page.tap()` on the iPhone 13 profile. They covered one device and two devices, light and dark, at 390 and 360 portrait and 844×390 and 667×375 landscape. All three found no blocking issues, and every issue they did find was fixed: four in Ultimate, four in Four in a Row and four in Dots & Boxes. Their scripts and screenshots are in the session scratchpad.
- The verifiers saw no console or page errors in any run.

## Known issues / notes for the coordinator
- **Turn games have no data API.** The turn-game `api` in `core.js` has no `data()`, `setData()` or `onData()`; only live games get `gameDataApi`. All three games import the exported `gameDataApi('<id>')` from `core.js` instead, and will use `api.data` automatically if the core adds it. *Suggested core change:* spread `gameDataApi(gameId)` into the turn-game api too, at core.js ~907.
- **Landscape boards are small.** The engine chrome takes about 110 px of a 390 px-tall landscape phone: the player chips above, and the status row after the end card. The games now fit without scrolling, but in landscape:
  - the Ultimate board is about 221–240 px;
  - Four in a Row columns are about 30–32 px wide;
  - the Dots board is about 183–250 px.

  A compact landscape variant of `.gm-versus` / `.gm-status` in `games.css` would let all three grow.
- **End card in landscape:** at 390 px height, the end card's "See the board" and "Back to games" buttons sit flush with, or slightly cut by, the bottom edge. This is core chrome.
- **Cell size:** Ultimate cells are about 32–35 px on phones, which is inherent to a 9×9 grid. The tap-to-aim, tap-to-place flow prevents misplays.
- **Sweetheart can't be drawn.** The heart makes the total 17 points, so Sweetheart always has a winner.
- **Wildcards balance** was not measured.
- **Four in a Row 8×7** was not built.
- **Test ports:** `board.test.js` uses fixed ports 8920/8921, so two runs at once collide.

## README games-table lines
The board games share one row today: "Four in a Row · Dots & Boxes · Ultimate Tic-Tac-Toe | Take turns, versus | Either". If the coordinator wants per-game lines:
- **Ultimate Tic-Tac-Toe**: nine boards; every move picks where your partner plays next. It is balanced with a tiebreak for the second player, and has Hot Boards and Wildcards modes.
- **Four in a Row**: drop discs and line up four. Classic, Ghost Column, PopOut and Blockers.
- **Dots & Boxes**: close boxes and chain them. Quick, Classic and Big boards, plus Sweetheart (a heart box with a question for two) and Scramble.
