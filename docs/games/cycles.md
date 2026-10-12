# Light Cycles: design notes

Entry `js/games/cycles.js` (the match, netcode, drawing), `js/games/cycles/sim.js` (the pure
simulation), `js/games/cycles/css.js`. Tests: `tools/test/games/computer.test.js` (`phone`, `laptop`,
`dark`, `drops` as before, plus `cyx` for arenas, power-ups, swipes, landscape, replay, capped match,
latency 150 + 20 % drops).

## Play

Two bikes, two trails, one grid. Every wall, trail and arena block is solid; the last rider takes the
round; first to 3 rounds takes the match (cap: 9 rounds; a capped match is won on points). Computer:
W A S D (Emerson) and the arrows (Sydney), live either set works on your own laptop. Phone: swipe the
board (it follows the finger on screen) or use the pad. One phone: Emerson is the bottom half, Sydney
the top half, each with a pad (Sydney's is upside down). On its side, the pads sit left and right of
the board.

### Arena picker

Before the match the host picks (the guest sees "Emerson is picking…" and the choice change live):
Classic, Pillars, Cross, Rings, Scatter, **Rotate** (a different arena every round, host-chosen order),
**Surprise me** (one random arena for the whole match), and a **Boosts** toggle, then GO. The last
choice is remembered in `cycles_last` / `cycles_boosts` and preselected, so a rematch is one tap.
Enter also starts. The record line under the chips shows the rivalry (streak, longest ride, shaves).

* **Classic**: open grid, exactly today's rules and speed curve. The start is today's fixed centre line,
  except the round after a draw, which starts from a seeded, symmetric stagger so mirrored play does not loop.
* **Pillars** four blocks, **Cross** a walled plus with gaps, **Rings** two concentric partial walls,
  **Scatter** a seeded random scatter. All are point-symmetric about the centre (a rider's view of the
  board is the same as the other's turned round), the start cells have a cleared lane, and the starts
  are staggered per round (symmetric, seeded: lateral offset and distance).
* **Speed ramp**: every non-classic arena goes from 78 ms to 50 ms per tick over about 20 s
  (`0.09 ms` per tick). Classic keeps 78 to 70 ms (`0.04 ms` per tick).
* **Boosts**: seeded token cells in symmetric pairs (3 boost + 2 jump pairs on the square grid, 2 + 1
  otherwise). A BOOST (yellow disc, chevrons) gives 2 cells per tick for 8 ticks; a JUMP (yellow disc,
  hop arc) lets your next collision with a trail cell (never the outer wall, an arena block or the
  other rider's head) pass through once. A held jump shows a dashed ring round the bike.
* **Near misses**: riding alongside an opponent's trail, an arena block or the opponent's head for 3
  cells, or squeezed between two things at once, is a *close shave* (spark and a soft blip). Counted
  per round in `step()` so both devices agree; the round banner says "Close shaves: N".
* **Draws**: head-on or a double crash is "DEAD HEAT"; the next round starts from a new symmetric start.
* **Crash replay**: after every round end: 0.32 s of the crash, then a 1.2 s replay of the last 16 ticks
  zoomed 2.4x on the crash (the camera follows the rider who crashed), with a caption (squeezed by 1
  cell / ran into a wall of light / tangled in their own trail / hit a block / ran out of road /
  head-on), then the banner. A tap skips the replay. On one device a skip also shortens the pause.
* **Banner stamps**: LONGEST RIDE! / MOST SHAVES! when a record falls (only when there was an earlier record).
* **Banner and caption placement**: the round banner is clamped inside the board (it sits in the half the crash is not
  in), and is smaller on the wide grid; the replay caption is centred with margins, never animated with a transform.

## Layouts

`s` 49x49 square (computer), `p` 31x45 portrait (phone), `l` 41x27 wide (phone on its side; 7.5 px
cells at 844x390, 5.5 px at 667x375 where the pads shrink to 46 px keys). Chosen by the screen shape (wider than
tall and height <= 520 and width >= 480: `l`; wider than tall and width >= 700: `s`; otherwise `p`), re-read every
round (a resize is checked twice, 120 ms and 570 ms later, because iOS can report the old size right after a turn). Live, the host agrees the round's layout (portrait wins, then
`l`, then `s`) from its own pref and the guest's `pref` in presence, and puts it in the round config. A
change applies from the next round.

## Netcode

* Host (`a`, or the single device) owns the simulation; ticks at `tickMs(cfg, t)`.
* Round config `cfg = { L, ar, sd, bo, sv, rm }` (layout, arena, seed, boosts, start variant, speed
  curve) is decided by the host per round and published in presence. `newSim(cfg)` builds the blocks,
  the staggered starts and the tokens from it, so the guest rebuilds the identical round.
* The guest sends `turn` events (seq numbers, also mirrored in its presence `q` for recovery); the host
  applies at most one turn per rider per tick and publishes the turn log `lg` (+ `lo` offset).
  `rebuild(cfg, log, T)` replays it with the same `step()`. Power-ups, jumps, boosts and shaves are
  purely `step()` state, so a rebuild always matches (the tests compare host sim, host rebuild and guest).
* **Guest prediction**: a turn is shown at once as a predicted segment (the guest's own head leaves the
  last confirmed cell in the new direction); the host log stays the truth and replaces it when it
  arrives. The guest's display clock follows the confirmed tick (low-pass, +0.4 tick ahead for itself, the
  opponent drawn 1.4 ticks behind so it is always between two confirmed ticks). The host extrapolates
  its heads between ticks (a queued turn is drawn at once too). Heads move continuously at 60 Hz.
* Phases: `pick` (host presence carries `md` = the live choice) -> `count` -> `run` -> `end` -> ... -> `over`.
  A host that re-mounts mid-match adopts the score, round and mode from the guest's `hm/hsc/hr/hmd` echo and skips the picker.
* **Pause reasons**: `pz` 1 = the host stepped away (tab hidden), 2 = the guest did (left or hidden).
  The banner reads "<name> stepped away".
* Presence stays small (a few hundred bytes plus the log).

## Records (api.data, written by the host / the single device only)

| key | value |
|---|---|
| `cy_long_n`, `cy_long_who` | longest round in ticks (higher is better), who won it (`a`, `b` or `d`) |
| `cy_shaves_n`, `cy_shaves_who` | most close shaves in one round |
| `cy_streak_who`, `cy_streak_len` | the current match-win streak (`''`/0 after a drawn match) |
| `cy_beststreak_n`, `cy_beststreak_who` | best streak |
| `cy_wins_a_n`, `cy_wins_b_n` | match wins here (for "Emerson leads 5-3") |
| `cy_flawless_a_n`, `cy_flawless_b_n` | matches won 3-0 |
| `cycles_last`, `cycles_boosts` | the last picker choice |

The streak is `_len`, not `_n`: on sync a numeric key ending `_n` keeps the larger value, which would
make a streak that ends impossible to reset. All the `_n` keys are higher-is-better.

The end card: `text` = "Sydney wins 3-1" (always the real score), `sub` = the rivalry line, up to three of: streak, "ends X's
N-match streak", "flawless 3-0", "won on points after 9 rounds", a record broken, the head-to-head ("Emerson leads 5-3").

## Look and feel

Riso inks on graph paper. Arena blocks are ink squares with a paper rule and the same hard offset shadow
as the trails. Tokens are yellow discs with printed glyphs. Heads have a flat halo of the rider's ink; a boosted
bike trails speed lines. A crash shakes the board (CSS transform; off with reduced motion), the pip that
was just won pulses. Sounds: a turn click, a soft shave blip, boost and jump swoops, a crash thud, all
small WebAudio synths on `api.audio()` (muted respected) on top of the engine's `sfx`.

## Testing

`window.__cycles` (only under automation) has `info()`, `go({ ar, boosts })`, `skip()`, `make(cfg)`
(a summary of a built round), `ramp(cfg, t)` and `lib` (`newSim`, `step`, `rebuild`, `pathAt`) so tests
can run exact scenarios in the page. In the tests, `pickGo(page, { arena, boosts })` taps the chips and GO.
