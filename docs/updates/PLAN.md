# All-games update: plan for the parallel sessions

Emerson asked for this (verbatim):

> tic tac toe doesn't feel very balanced. add a secret button to cheat and see sydney's battleships only if playing as emerson
> (mwahahaha) and update every single [game] with meaningful new content, bug fixes, new stimulating psychologically optimized
> gameplay. Bomb one needs new approaches and difficulty too as learned that pattern too much. Use a lot of sonnet 5.5 subagents on a
> higher than medium reasoning with opus for general direction and fable to check for additional content possible after reading
> summaries of each game. Run autonomously until done.

The work is split into one cloud session per **unit**. Each unit is a few games that own separate files. Every session starts from
branch `claude/relaxed-dijkstra-2cy8al` and pushes only to its own branch, `claude/upd-<unit>`. The coordinating session merges all
the branches, runs the full regression and publishes the artifact.

## Timeline (UTC, 12 Oct 2026)

| When | What |
|---|---|
| Now (~05:50) | Start. |
| Every ~45 min | Commit and push WIP to your branch, so nothing is lost if the container restarts. |
| By 11:30 | Final push. It must include `docs/updates/<unit>.md`, your report. |
| After 11:30 | Merge, regression and publish (coordinator). Don't push to your branch after 12:00 unless the coordinator asks. |

## How each session works (the user asked for this shape)

You (Opus) are the **director** for your unit. Use subagents heavily via the Agent tool:

1. **Survey.** Run one Sonnet subagent (`model: "sonnet"`) per game in parallel. Each one reads the code, tests and docs, plays the game
   through the harness on an iPhone profile with real taps, and returns:
   - a 150–250 word summary;
   - bugs it actually reproduced (file:line and repro);
   - weak spots: balance, boredom, patterns players learn, UX friction;
   - ideas.
2. **Content check.** Run one Fable subagent (`model: "fable"`). It reads the summaries and proposes additional content the survey missed:
   new modes, twists, content packs, rivalry hooks, couple-specific moments, surprise and delight, ways to keep mastery fresh.
3. **Direction.** You write the spec: must-haves first (the user's requests, then every verified bug), then content and gameplay, then
   polish, each with acceptance tests.
4. **Build.** Sonnet subagents implement the spec. Use one per game, or split a big game by file area so no two edit the same file at
   once. Tell each subagent which files it owns.
5. **Verify.** An independent Sonnet subagent re-plays and re-tests each game, both players, one-device and two-device, light and dark.
   It reports issues; a Sonnet fixer fixes them. Repeat until clean, deadline permitting.

Give subagents high reasoning effort and enough context: the spec, the files, the rules below. You're done when every game in your unit
has a real, tested update and your report is pushed.

## What "update" means

For each game:
- meaningful new content, such as new modes, variants, content packs and twists;
- every verified bug fixed;
- gameplay that is stimulating for a loving couple. That means clear goals, mastery and variety, variable rewards, near-misses and
  comebacks, streaks, records and rivalry between the two of them, short sessions that invite "one more", and surprise and delight.

Keep it healthy and playful: no guilt-tripping, no fake scarcity, no grind walls, nothing to pay. Records, bests and unlocks go in the
existing shared per-game data, `api.data()` / `api.setData(patch)` / `api.onData(fn)` in `js/games/core.js`. Rail Rush shows the pattern.

### Must-haves from the user

- **Ultimate Tic-Tac-Toe (board unit).** Make it balanced. Measure the first-player advantage with bot self-play, then pick and ship a
  fix backed by numbers: for example an alternating starter, a pie/swap rule, a restricted opening or a "free move" variant. Show the
  before/after win rates in the report.
- **Battleships (fleet unit).** Add a secret cheat that reveals Sydney's ships, only when the local player is Emerson:
  - Make it hidden: an unlabelled gesture, such as a long-press or a tap pattern on something innocuous.
  - Make it local-only: nothing is sent, stored or shown on Sydney's side, and it is never visible or detectable to her, including
    in replays, records and end cards.
  - If her layout isn't on Emerson's device today, find the least invasive way to make it available there for the cheat. Explain the
    approach in the report.
- **Defuse (defuse unit).** They memorized the patterns. Add new approaches and difficulty:
  - new module types;
  - per-game randomized rule sets and manual variants, seeded so both devices agree;
  - difficulty tiers;
  - fresh twists, such as role swaps, red herrings and time-pressure mechanics.

  It must stay a communication game: the bomb holder describes, the manual reader instructs.

## Rules (all sessions and subagents)

- **Read first.** Read `docs/GAMES.md` before anything else: the game contract, netcode, look and feel, testing and the iPhone checklist.
  Big games have docs in `docs/games/`.
- **Bundler.** `export` only at the start of a line, one export per line, named imports only. No `export {}` lists and no default exports.
- **File ownership.** Edit only your unit's files; the units are listed below. Some files are shared:
  - `js/games/core.js`, `js/games/net.js`, `games.css`, `js/app.js`, `tools/test/harness.js`, `README.md` and `docs/GAMES.md`: do not
    edit. If you need something from them, implement it inside your game, or describe it in your report for the coordinator.
  - `js/games/covers.js`: edit only your games' cover functions and keys.
  - Docs for your games go in `docs/games/<game>.md`, new or existing.
- **Builds.** Don't commit `dist/`. Build to the scratchpad with `python3 tools/build_artifact.py --out <scratch>/x.html` (add `--only=...`
  for speed).
- **Saved data.** Data written by the current version must keep working: match move logs, records, bests and settings. Turn games replay
  move logs, so never change the meaning of an existing move encoding. Version new rules and modes in the match setup.
- **iPhone first.**
  - Call `preventDefault` on touches only on play surfaces. On iOS it suppresses the click, which kills buttons.
  - Tap targets at least 44 px. No vibrate. No main-thread block over 200 ms.
  - Respect safe areas. Support portrait and landscape, light and dark.
  - Test touch flows with `page.tap()`.
- **Processes.** Kill only processes you started. Never read the real artifact database or user data.
- **Pushing.** Commit messages end with the session's attribution lines. Push only to `claude/upd-<unit>`. Never open a PR.

## Units

| Unit | Games | Owns |
|---|---|---|
| board | ultimate, four, dots | those game files, `tools/test/games/board.test.js` |
| fleet | fleet | `js/games/fleet.js`, `tools/test/games/fleet.test.js` |
| defuse | defuse | `js/games/defuse.js` (+ new `js/games/defuse/`), a new `tools/test/games/defuse.test.js`, the defuse sections of `computer.test.js` |
| words | wordduel, agents | those files, `tools/test/games/words.test.js` |
| party | doodle, wave | those files, `tools/test/games/party.test.js` |
| live | hockey, quickdraw, cycles | those files, `tools/test/games/live.test.js`, the cycles sections of `computer.test.js` |
| threed | bones, tower | those files, `tools/test/games/threed.test.js` |
| rush | rush | `js/games/rush.js`, `js/games/rush/**`, `rush.test.js`, `docs/games/rush.md` |
| chameleon | chameleon | `js/games/chameleon.js`, `js/games/chameleon/**`, `chameleon*.test.js`, `docs/games/chameleon.md` |
| getaway | getaway | `js/games/getaway.js`, `js/games/getaway/**`, `getaway*.test.js`, `docs/games/getaway*.md` |

The three big 3D games (rush, chameleon, getaway) just had deep polish passes. Give them focused content additions, not rewrites.

## Report: `docs/updates/<unit>.md`

The report covers:
- per game, what's new and what was fixed;
- the user must-haves with evidence;
- test results;
- known issues;
- one README games-table line per game, if its description should change. The coordinator applies these.
