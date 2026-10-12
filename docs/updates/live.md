# Live unit report: Air Hockey, Quick Draw, Light Cycles

Branch `claude/upd-live`, based on `claude/relaxed-dijkstra-2cy8al`.

## How the work ran

Opus directed the work and wrote the spec. The subagents did the rest:

| Step | Who | What |
|---|---|---|
| Survey | 3 × Sonnet (high effort), one per game | Each read the code, played the game in the harness on the iPhone profile (local and live, with latency and packet loss) and reproduced bugs. |
| Content check | Fable | Read the three summaries and proposed missed content: signal packs, Both barrels, seeded arenas, crash replay, the drama kit, the handicap and rivalry lines. |
| Build | 3 × Sonnet | One per game, each with separate file ownership. |
| Verify and fix | 3 × Sonnet | Independent of the builders. Each re-played its game, re-tested it and fixed what it found. |
| Round 2 | 3 × Sonnet | Closed what the verifiers left open: layout edge cases, overlays and the extra content. |
| Final pass | 1 × Sonnet | Fresh eyes on all three games: full matches, rematch, hub covers, reduced motion, first-play data. |

Every game now opens with an in-game picker for its tables, packs or arenas. The host chooses and the guest watches the choice live. The choice travels in the reliable message and in host presence, so a dropped message heals itself. The last choice is remembered.

Records live in the shared per-game data (`api.data()`) and are written only by the device that decides the result: the host, or the single device in local play. The end card's subtitle carries a rivalry line, for example "7–3 · COMEBACK from 3 down · Emerson on a 2-match streak (a new best)".

**Data-key gotcha.** When devices sync, core keeps the larger value of any numeric key ending in `_m`, `_best`, `_pb` or `_n`. So current streaks use `_len` or `_c`, and lower-is-better times use `_ms`, never those suffixes. All the keys are new, so nothing saved earlier changes meaning, and an empty `api.data()` (first ever play) works.

## Air Hockey (`js/games/hockey.js`, new `js/games/hockey/{physics,sound,setup,records}.js`)

### Fixed (all reproduced in the survey)
- **A second finger stole the mallet.** A second finger on a half that already had one took the mallet, which then froze. Now the first finger keeps it, and when it lifts, control glides to the next finger on that half.
- **The puck teleported on the guest's phone.** It jumped 35–100 units whenever the host hit it. The guest's view is now re-based on every host state and the error decays in about 60 ms. The worst per-frame jump at 120 ms latency with 20 % loss is 10–16 units, against a 25-unit test limit.
- **The puck could stall forever.** It could be pinned in a corner, or squeezed between both mallets and a wall. Now:
  - a shot clock ring appears after 3 s;
  - at 6 s it shows **HOG!** and serves the puck from the centre to the other player;
  - a sandwiched puck resets after 0.5 s.
- **There was no range of shot power.** A light flick already maxed out the puck. Now hit speed follows the mallet's real speed, measured over real frame time with a 40 ms low-pass: a push is a soft pass and a real flick is a slap shot.
- **Uneven hit power** (found by the verifier): frame jitter caused double hits, and spiky host-side sampling of the guest's mallet gave guest hits random power. Fixed with mallet extrapolation and blending (`REMOTE_LEAD`, `REMOTE_BLEND`).

### New
- **Tables:**
  - Classic, unchanged: first to 7.
  - **Pillar:** a centre bumper.
  - **Twin Pucks:** a scoring puck re-serves while the other keeps playing.
  - **Shrinking Goals:** each goal you score narrows your opponent's goal, a built-in comeback.
  - **Power Puck:** each rally hit adds 6 %, up to 60 %, and the trail heats from yellow to red.
  - **Quick:** first to 3.
  - **Surprise me.**
- **Drama:**
  - a rally counter, with a "RALLY n!" sticker from 8 hits;
  - a **POST!** stamp and clang for near misses;
  - a MATCH POINT banner, or DOUBLE MATCH POINT at 6–6;
  - a 0.5× slow-motion moment on a match-point attack, which the guest follows from the stream;
  - a **COMEBACK!** stamp when the winner was 3 or more down;
  - separate sounds for wall, mallet and post.
- **Scoreboard bands** on tall phones, one printed band at each end, with the score, table, match-point flag, rally count and the record to beat. In landscape they become side cards, and they hide when space is tight. On one phone the far band faces its player.
- **Readability on one phone:** stamps print on each player's side, and all centre overlays (stamps, 3-2-1, banners) stack in one lane so they never collide.
- **Records:**
  - `hk_rally_best` / `hk_rally_who`;
  - `hk_fast_ms` / `hk_fast_who` (fastest goal);
  - `hk_shutout_{a,b}_n`, `hk_comeback_{a,b}_n`;
  - `hk_streak_who` / `hk_streak_len` / `hk_streak_best`;
  - `hockey_last`.

## Quick Draw (`js/games/quickdraw.js`)

### Fixed (all reproduced in the survey)
- **A simultaneous double foul always went against the guest.** Lag decided it. Rounds now start at a shared-clock instant and fouls are compared on the shared clock. Within 30 ms is a re-round: 3 of 3 at 200 ms latency.
- **Small screens overflowed.** On the one-phone layout at 375×667, 360×640, 320×568 and 568×320, and on the laptop at 1280×600 and 800×500, the bottom FIRE pad was cut off. Every size now fits without scrolling, and tests assert it. On the smallest phones the scene doubled in height and stamps move onto the pads.
- **Copy glitches:**
  - a bare dash showed for the winner's time after a foul;
  - "Dead heat" appeared twice;
  - "Too slow" showed when nobody fired;
  - the tally order was opposite to the chips;
  - the tally appeared twice, with a dead band above the scene.
- **Slow verdicts.** The shooter waited about 4 s for an idle partner. The verdict now comes once the partner can no longer win, in under 1.7 s.
- **Anticipation won.** A reaction under 100 ms is now a foul: **JUMPED THE GUN**.
- **The timing was learnable.** The uniform 1.5–4.5 s delay is now a mixture: mostly short, some medium, an occasional long one up to 6 s. The tick is irregular and fades, and the screen darkens slowly while you wait.

### New
- **Duel packs:**
  - Classic.
  - **Decoys:** BRAW!, DRAWL, DREW, DRAW?, DRAMA. Firing on a decoy is a foul.
  - **Colour:** fire when the lantern turns YELLOW; the other colours are bluffs, labelled in words so colour-blind players can play.
  - **Bell:** a quiet tink is a bluff and a ring is the signal. The bell also swings, so it works on a muted phone.
  - **Mixed:** a different pack each round.
  - **Surprise me.**
- **Series:** best of 3, 5 or 9, or **Showdown**: first to 5, win by 2, going to sudden death after 15 rounds.
- **Both barrels:** when the match is tied one round from the win, the decider shows two real DRAWs. Firing on the first is a foul.
- **Rivalry:**
  - "Sydney by 9 ms" verdicts;
  - **PHOTO FINISH** under 15 ms, with timing bars;
  - NEW PB and NEW RECORD stamps;
  - a duel streak, with **Bounty claimed!** when someone breaks a streak of 3 or more.
- **Gunslinger handicap** (optional, off by default): when the two personal bests are 40 ms or more apart, the faster player's cue shows later by half the gap, between 20 and 60 ms. The handicap is shown openly ("+30 ms") and counted in the verdict; personal bests stay raw.
- **Rematch:** the picker comes back as "Same again?" and auto-starts after 3 s. Both phones can see the countdown, and the host can cancel it or pick again.
- **One phone:** stamps and signs are mirrored so the top player can read them.
- **Juice:** hit-stop flash, smoke puff, a ms count-up and a hat-and-body fall.
- **Records:**
  - `qd_pb_{a,b}_ms`;
  - `qd_best_ms` / `qd_best_who`;
  - `qd_streak_who` / `qd_streak_c` / `qd_streak_best` / `qd_streak_best_who`;
  - `qd_last`, `qd_hcap`.

## Light Cycles (`js/games/cycles.js`, new `js/games/cycles/{sim,css}.js`)

### Fixed (all reproduced in the survey)
- **Swipes on the top half of a shared phone were inverted.** They now follow the finger. Tested with real touch swipes on both halves.
- **The end card had the wrong subtitle** for a match capped at 9 rounds (it said "three times over" on a 2–1). It now shows the real score and the rivalry line.
- **A phone in landscape got a tiny board:** 3.5 px cells, off to one side. There is now a wide 41×27 grid, chosen by aspect ratio every round. Cells are 7.5 px at 844×390 and 6.75 px at 667×375. When one phone is upright and the other on its side, the upright one draws the shared grid turned 90° and steering follows the screen.
- **The guest's turns showed late** (300–400 ms at 150 ms latency). The guest now predicts its own turn at once and reconciles with the host's log, which stays the truth. Heads glide between ticks, and the remaining correction is about 0.4 cells, blended away.
- **The pause didn't say why.** It now says "Sydney stepped away".
- **Found during verification:**
  - board listeners were re-added on every rebuild;
  - the replay caption sat off-centre;
  - the round banner spilled off short boards;
  - a "new record" could show in the very first match.

### New
- **Arenas:** Classic (open, as before), **Pillars**, **Cross**, **Rings** and **Scatter**, plus **Rotate** (a new arena each round) and Surprise me.
  - Obstacles are seeded and point-symmetric, so neither side has an advantage.
  - Starts are staggered per round, so the opening is never the same twice.
  - Each arena chip shows a mini-map drawn by the real generator.
- **Boosts** (toggle): token pairs placed symmetrically by the seed.
  - BOOST gives 2 cells per tick for 8 ticks.
  - JUMP hops over one trail cell, once.
  - Both are resolved in the shared `step()`, so host and guest always agree. This was tested with random play at 150–200 ms latency and up to 50 % packet loss.
- **Speed ramp** outside Classic: the tick shortens from 78 to 50 ms over 20 s, for real late-round tension.
- **DEAD HEAT** on a head-on crash. The next round starts staggered, so mirrored play can't loop into endless draws.
- **Close shaves:** riding 3 cells alongside a trail, or squeezing through a gap, makes a spark and a blip. The round banner reads "Close shaves: N".
- **Crash replay:** a 1.2 s zoomed slow-motion replay of the last 16 ticks, with captions such as "squeezed by 1 cell" or "ran out of road". A tap skips it.
- **Juice:** WebAudio turn click, boost and jump swoops, a crash thud, an ink halo at the head, speed lines when boosted, crash shake, pip pulse and animated banners.
- **Records:**
  - `cy_long_n` / `cy_long_who` (longest round);
  - `cy_shaves_n` / `cy_shaves_who`;
  - `cy_streak_who` / `cy_streak_len`;
  - `cy_beststreak_n` / `cy_beststreak_who`;
  - `cy_wins_{a,b}_n`, `cy_flawless_{a,b}_n`;
  - `cycles_last`, `cycles_boosts`.

## Must-haves from the user

None of the three named must-haves (Tic-Tac-Toe balance, the Battleships cheat, Defuse) belong to this unit. The general request, "meaningful new content, bug fixes, new stimulating gameplay", is covered for all three games above. Every bug the survey reproduced is fixed and has a test.

## Tests

TEST_RESULTS

New suites:
- **Air Hockey:** picker, B1 on one phone and on the live guest, B2 at 120 ms with 20 % loss, power curve and jitter, shot clock and sandwich reset, drama and records, every table, overlays and bands.
- **Quick Draw:** packs, streaks and bounty, the double foul at 200 ms latency, packet loss, leave and return, rematch, sudden death, small phones, handicap on one phone and live.
- **Light Cycles** (the `cyx` group in `computer.test.js`):
  - unit checks of the arenas, boosts, ramp and shaves;
  - touch swipes, replay and the capped match;
  - landscape on one phone and live, small landscape, mixed orientation, a phone turned mid-match;
  - first-match records and the picker fit;
  - a boosted match at 150 ms with 20 % loss.

`live.test.js` gained a `GAME=hockey|quickdraw` filter. Only the cycles parts of `computer.test.js` changed; its runner gained one `cyx` group.

## Known issues
All the issues below are cosmetic or minor. None blocks play.

- **Air Hockey.**
  - The table keeps its fixed physics aspect. Tall phones fill the extra space with the scoreboard bands instead.
  - On one phone, a record-breaking goal at match point stacks RALLY RECORD, GOAL and MATCH POINT, and they can just touch.
  - The faded "Drag your mallet" hint can sit over the parked puck before the first touch.
  - `api.finish` passes `score: {a, b}`, but core currently stores `null` (harmless).
- **Quick Draw.**
  - The landscape 568×320 scene is small (about 70 px).
  - The handicap is not covered by the packet-loss test run, though its offsets travel in the reliable round message.
  - When the guest fires first, the host now waits 250 ms for its own tap before deciding.
  - Sudden death lifts the winner's tally to one above the loser's (e.g. 9–8).
- **Light Cycles.**
  - A grid change (rotating a phone) takes effect from the next round. The board redraws rotated at once.
  - An upright phone paired with a laptop plays the portrait grid.
  - On the guest's phone, its own predicted head still makes a small blended correction (about 0.4 cells) at 150 ms latency.
  - "Pick an arena" appears in both the status line and the card heading.
- **Not tested:** real iOS hardware and 120 Hz touch panels. Everything ran in Playwright with the iPhone 13 profile and synthetic touches.

## README games-table lines (for the coordinator)
- **Air Hockey:** Fast hands, flat puck. Pick a table (Classic, Pillar, Twin Pucks, Shrinking Goals, Power Puck, Quick). Rallies, post shots, match-point slow-mo and records.
- **Quick Draw:** Wait for it… DRAW! Duel packs (Classic, Decoys, Colour, Bell, Mixed), best of 3/5/9 or Showdown, a Both-barrels decider, personal bests, streaks and an optional handicap.
- **Light Cycles:** Leave a wall of light behind you. Pick an arena (Pillars, Cross, Rings, Scatter or Rotate), grab boosts, shave past walls and watch the crash replay.
