# Ultimate Tic-Tac-Toe balance simulator

Bot self-play used to measure the first-player advantage and pick the v2 balance rule (komi).
Results and method: `docs/games/ultimate-balance.md`. Not part of the test suite.

    node tools/test/games/ultimate-balance/run.js <variant> <playouts> <games> [mcts|heur] [seed]
    node tools/test/games/ultimate-balance/report.js          # table from results.jsonl
    node tools/test/games/ultimate-balance/crosscheck.mjs 200 # simulator vs js/games/ultimate.js (legacy rules)

Variants: base, komi, pie, nocb, nocc, seed2, seedb, free2, hot*_komi … (see game.js).
