# Ultimate Tic-Tac-Toe: first-player advantage and balancing variants

All numbers: equal-strength bots on both seats. P1 = the player who moves first (or, under pie, the player who *opened*; "seat" = original first mover, so stolen games still count for the opener's seat). CI = 95% normal interval on mean(P1 win - P2 win) in percentage points (draw = 0). Reproduce: `node run.js <variant> <budget> <games> [mcts|heur] [seed]`; `node report.js` rebuilds the table from `results.jsonl`; `node crosscheck.mjs 200` re-runs the rules check.

## Method
- `sim.js`: bitmask simulator (9-bit masks per small board, lookup tables for lines), same rules as `js/games/ultimate.js` (send rule, won/full = 'd' board gives a free move, 3 big boards in a line wins, count end when neither side can still make a big line, equal = draw).
- `crosscheck.mjs`: copies the real `ultimate.js` + `core.js` to .mjs and, over 200 random games (11,633 moves), compares at every ply the legality of all 81 squares (942k checks, plus a wrong-side move refused), every cell, small-board status, forced board, and end/winner. 0 mismatches (162 line wins, 22 count wins, 16 draws).
- Bots: **MCTS** = UCT (c=0.8), fixed playouts per move, fresh tree each move, random tie-breaks; playouts are random but take an immediate small-board win when one exists; chosen move = most visited child. **Heuristic** = 2-ply minimax with eval (boards won, two-in-a-rows on the big and small boards, free-move tempo term, centre bonus) plus small random noise.
- Parallel with `worker_threads` x4. Game g uses its own seeded RNG, so runs are reproducible.
- Pie: after the opener's first move the second player runs MCTS (same budget) on the position and steals when the mover's best-play win rate is < 0.5 (the position favours the mark-holder). When stealing, that mark becomes the second player's, the original first player moves next, sent per the normal rule. The opener is also a smart bot: it MCTS-evaluates one representative of each of the (up to ~15) symmetry-classes of openings and plays the one whose value is closest to 50/50 (what a player expecting a steal should do).
- Caveat: bots are random-playout MCTS, not perfect players; absolute numbers are a proxy. N=400 gives about +/-9pp CI, so only large effects are visible at 20000 playouts; the cheap budgets have tight CIs.
- Machine was shared with other jobs during the last runs; this affects only wall time.

## Results
| variant | bot | N | P1 win % | P2 win % | draw % | P1-P2 (pp) | 95% CI (pp) | steal % |
|---|---|---|---|---|---|---|---|---|
| base | heuristic 2-ply | 3000 | 53.8 | 33.2 | 13.0 | 20.5 | [17.3, 23.8] |  |
| base | MCTS 500 | 3000 | 49.6 | 42.9 | 7.5 | 6.7 | [3.3, 10.1] |  |
| free2 | MCTS 500 | 2000 | 51.0 | 42.1 | 6.8 | 8.9 | [4.7, 13.1] |  |
| free2_komi | MCTS 500 | 2000 | 49.3 | 50.7 | 0.0 | -1.4 | [-5.8, 3.0] |  |
| free2_nocb | MCTS 500 | 2000 | 49.8 | 43.0 | 7.1 | 6.8 | [2.5, 11.0] |  |
| komi | MCTS 500 | 2000 | 49.2 | 50.8 | 0.0 | -1.6 | [-6.0, 2.8] |  |
| komi_nocb | MCTS 500 | 2000 | 49.5 | 50.4 | 0.0 | -0.9 | [-5.3, 3.5] |  |
| komi_nocbcc | MCTS 500 | 2000 | 47.9 | 52.1 | 0.0 | -4.2 | [-8.6, 0.2] |  |
| nocb | MCTS 500 | 2000 | 49.6 | 43.4 | 7.0 | 6.3 | [2.0, 10.5] |  |
| nocbcc | MCTS 500 | 2000 | 48.7 | 43.8 | 7.5 | 4.9 | [0.7, 9.1] |  |
| nocc | MCTS 500 | 2000 | 48.2 | 43.5 | 8.3 | 4.7 | [0.5, 8.9] |  |
| pie | MCTS 500 | 2000 | 49.1 | 43.5 | 7.4 | 5.7 | [1.5, 9.9] | 21.8 |
| pie_nocb | MCTS 500 | 2000 | 48.6 | 43.5 | 7.9 | 5.1 | [0.9, 9.3] | 13.7 |
| seed2 | MCTS 500 | 2000 | 50.6 | 41.6 | 7.8 | 8.9 | [4.8, 13.1] |  |
| seedb | MCTS 500 | 2000 | 50.6 | 42.8 | 6.6 | 7.8 | [3.6, 12.1] |  |
| base | MCTS 2500 | 1200 | 48.8 | 40.8 | 10.4 | 7.9 | [2.6, 13.3] |  |
| pie | MCTS 2500 | 1200 | 44.7 | 44.7 | 10.7 | 0.0 | [-5.3, 5.3] | 44.8 |
| base | MCTS 20000 | 400 | 48.3 | 33.3 | 18.5 | 15.0 | [6.3, 23.7] |  |
| free2 | MCTS 20000 | 240 | 44.6 | 40.4 | 15.0 | 4.2 | [-7.5, 15.8] |  |
| komi | MCTS 20000 | 400 | 50.0 | 50.0 | 0.0 | 0.0 | [-9.8, 9.8] |  |
| nocbcc | MCTS 20000 | 400 | 51.2 | 32.3 | 16.5 | 19.0 | [10.2, 27.8] |  |
| pie | MCTS 20000 | 400 | 38.0 | 43.0 | 19.0 | -5.0 | [-13.8, 3.8] | 75.5 |

Pie opening/steal detail:

pie MCTS 500 (N=2000):
  corner-board corner-square: opened 508, stolen 79 (15.6%)
  centre-board centre-square: opened 242, stolen 172 (71.1%)
  corner-board edge-square: opened 237, stolen 11 (4.6%)
  centre-board corner-square: opened 226, stolen 87 (38.5%)
  edge-board edge-square: opened 218, stolen 16 (7.3%)
  corner-board centre-square: opened 218, stolen 45 (20.6%)
  centre-board edge-square: opened 177, stolen 21 (11.9%)
  edge-board corner-square: opened 110, stolen 2 (1.8%)
  edge-board centre-square: opened 64, stolen 3 (4.7%)

pie_nocb MCTS 500 (N=2000):
  corner-board corner-square: opened 768, stolen 143 (18.6%)
  corner-board edge-square: opened 340, stolen 32 (9.4%)
  edge-board edge-square: opened 309, stolen 18 (5.8%)
  corner-board centre-square: opened 298, stolen 66 (22.1%)
  edge-board corner-square: opened 188, stolen 10 (5.3%)
  edge-board centre-square: opened 97, stolen 4 (4.1%)

pie MCTS 2500 (N=1200):
  corner-board corner-square: opened 297, stolen 208 (70.0%)
  corner-board edge-square: opened 254, stolen 118 (46.5%)
  edge-board edge-square: opened 246, stolen 42 (17.1%)
  edge-board corner-square: opened 171, stolen 24 (14.0%)
  edge-board centre-square: opened 72, stolen 10 (13.9%)
  corner-board centre-square: opened 71, stolen 61 (85.9%)
  centre-board edge-square: opened 69, stolen 54 (78.3%)
  centre-board corner-square: opened 19, stolen 19 (100.0%)
  centre-board centre-square: opened 1, stolen 1 (100.0%)

pie MCTS 20000 (N=400):
  edge-board corner-square: opened 167, stolen 134 (80.2%)
  edge-board edge-square: opened 138, stolen 124 (89.9%)
  edge-board centre-square: opened 95, stolen 44 (46.3%)

## Variant definitions
- **base**: current rules.
- **pie**: after P1's first move P2 may steal it (mark becomes P2's, P1 moves next, sent by the normal rule from that square).
- **pie_nocb**: pie, and the opening move may not be in the centre small board.
- **nocb**: P1's first move may not be in small board 4 (centre). **nocc**: P1's first move may not be on a centre square (i=4) of any board. **nocbcc**: both.
- **seed2**: before play, two random legal marks (one each, normal send rule) are placed, then P1 moves. **seedb**: a random small board is drawn and P1's first move must be there.
- **komi**: if the game ends on boards-count with equal boards, the second player wins (no draws). **komi_nocb / komi_nocbcc**: komi + the restriction.
- **free2**: P1's first move sends nobody anywhere: P2's first move may be in any board. **free2_komi / free2_nocb**: combined.

## Findings
- Baseline P1 edge is real and grows with strength: heuristic +20.5pp, MCTS 500 +6.7, MCTS 2500 +7.9, MCTS 20000 +15.0 (N=400, CI 6.3 to 23.7). Draws grow from 7% to 18%.
- Opening restrictions (nocb, nocc, nocbcc), seeded openings, and "free second move" do not remove the edge (500: +4.7 to +8.9; nocbcc at 20000: +19.0).
- Komi is the one that reliably lands at 50/50: -1.6 (500, N=2000), 0.0 (20000, N=400, CI +/-9.8), and it also removes draws. Komi + nocbcc over-corrects slightly at 500 (-4.2).
- Pie: +5.7 (500), 0.0 (2500, N=1200, CI +/-5.3), -5.0 (20000, N=400, CI -13.8 to 3.8). Steal rate rises with strength (22% / 45% / 76%); bots at 20000 only open on edge small boards and steal ~80-90% of edge-board corner/edge openings, i.e. the opener never finds a quiet opening. It balances but leans toward P2 and is more complicated; it needs an extra UI step.

## Recommendation
Use **komi: the second player wins a tie on boards**. One sentence to explain, no new UI, no draws, and it measured 50/50 at every strength tested. Pie is a viable add-on (next best) but adds a decision step and tends to over-correct against strong play.

## Follow-up (komi gap fill, "hot" boards, tie-break share)
New variants: **hot** = per game, 2 distinct random small boards count double in the boards-won total at a count ending (line wins unchanged; equal weighted total = draw). **hot_komi** = hot + tie goes to the second player. Tie-break share = (games decided purely by komi: count ending, no line, equal weighted boards) / (P2 wins). Komi rows rerun with the same seeds (identical results to earlier, plus the tie-break stat).

| variant | bot | N | P1 % | P2 % | draw % | P1-P2 (pp) | 95% CI | tie-break games | share of P2 wins from tie-break |
|---|---|---|---|---|---|---|---|---|---|
| base | MCTS 2500 | 1200 | 48.8 | 40.8 | 10.4 | +7.9 | [2.6, 13.3] | - | - |
| komi | MCTS 500 | 2000 | 49.2 | 50.8 | 0.0 | -1.6 | [-6.0, 2.8] | 106 | 10.4% |
| komi | MCTS 2500 | 1200 | 51.1 | 48.9 | 0.0 | +2.2 | [-3.5, 7.8] | 64 | 10.9% |
| komi | MCTS 20000 | 400 | 50.0 | 50.0 | 0.0 | 0.0 | [-9.8, 9.8] | 18 | 9.0% |
| hot | MCTS 2500 | 800 | 55.5 | 39.5 | 5.0 | +16.0 | [9.3, 22.7] | - | - |
| hot_komi | MCTS 2500 | 800 | 55.9 | 44.1 | 0.0 | +11.8 | [4.9, 18.6] | 33 | 9.3% |

Takeaways: komi is within noise of 50/50 at all three strengths (point estimates -1.6, +2.2, 0.0). Only about 10% of P2's wins are pure tie-breaks, so komi works mostly by changing how P2 plays for the count, not by handing over draws. "Hot" boards made P1's edge bigger (+16 vs +7.9 baseline), and hot+komi stays unbalanced (+11.8); do not use it.

## Follow-up 2: balancing "Hot Boards" (all with komi, MCTS 2500)
Hot boards double in the boards-won count at a count ending only (line wins unchanged); tie -> second player. Variants (all drawn fresh per game from the seed):
- **hot_komi**: 2 random distinct hot boards, double for both players (earlier result).
- **hot1_komi (a)**: ONE random hot board, double for both.
- **hot2nf_komi (b)**: 2 random hot boards, double for both, the opener's first move may not be in a hot board.
- **hot2p2_komi (c)**: 2 random hot boards, double for the second player only ("home boards"). **hot1p2_komi**: same with one board.
- **hotopp_komi (d)**: hot pair = a random pair of opposite boards through the centre (0&8, 1&7, 2&6 or 3&5), double for both. **hotoppp2_komi**: same pair, double for the second player only.
- Runs are N=800 each with different RNG seeds (seed 1, 2, 3); pooled rows add seeds. Per-run SE is ~3.5pp, and seed-to-seed spread for the same variant is large (hot1: -3.5, +11.8, -2.5), so use the pooled rows.

Pooled over seeds:

| variant | seeds | N | P1 % | P2 % | P1-P2 (pp) | 95% CI (pp) |
|---|---|---|---|---|---|---|
| komi (no hot, for comparison) | 2 | 2000 | 49.9 | 50.1 | -0.2 | [-4.6, 4.2] |
| hot_komi (2 random, both) | 1 | 800 | 55.9 | 44.1 | +11.8 | [4.9, 18.6] |
| hot1_komi (a) | 3 | 2400 | 51.0 | 49.0 | +1.9 | [-2.1, 5.9] |
| hot2nf_komi (b) | 3 | 2400 | 53.1 | 46.9 | +6.2 | [2.2, 10.2] |
| hot2p2_komi (c) | 1 | 800 | 45.3 | 54.8 | -9.5 | [-16.4, -2.6] |
| hot1p2_komi | 1 | 800 | 45.1 | 54.9 | -9.8 | [-16.6, -2.9] |
| hotopp_komi (d) | 3 | 2400 | 50.5 | 49.5 | +1.0 | [-3.0, 5.0] |
| hotoppp2_komi | 2 | 1600 | 46.9 | 53.1 | -6.3 | [-11.1, -1.4] |

Conclusions: P2-only hot boards overshoot (P2 ahead by 6-10pp). Symmetric hot boards leave P1 ahead unless the pair is opposite-through-the-centre (+1.0) or there is only one hot board (+1.9), both within noise of 50/50. Banning the opener from hot boards (b) does not help (+6.2). Nothing beats plain komi (-0.2) for balance, and plain komi is simpler. Per-run rows are in results.jsonl / `node report.js`.
