# Quick Draw: design and netcode

A western standoff reaction duel for two. Entry `js/games/quickdraw.js` (one file). Test:
`GAME=quickdraw PORT=9200 SHOTS=<dir> node tools/test/games/live.test.js` (four runs: two phones, one phone, a laptop,
plus a latency-200 run for the double foul and a 120 ms / 20 % loss run).

## Flow

1. **Picker** (every mount). The host (online) or the device (one phone / laptop) chooses a *duel pack* and a *series*,
   then GO. The guest sees "Emerson is picking…" and the host's live choice (chips are read-only; GO is hidden).
   The last choice is remembered (`qd_last`, e.g. `decoys:5`) and preselected. On a **rematch** (`api.gen > 0`) the picker
   says "Same again?" and starts the last duel by itself after a 3 s countdown on the GO button. The guest sees the same countdown
   ("Same again? Starting in 3…", host presence `ac`), so the start never surprises anyone. The host can stop it with the **Pick again**
   button (keeps the choice) or by tapping any chip; GO starts at once.
2. **Round**: "Ready", then **Steady…**, then the signal. First valid shot after the signal wins the round. Firing before it
   is a foul; so is a "reaction" under 100 ms (a guess), stamped **JUMPED THE GUN**.
3. **Verdict**: "Sydney by 9 ms". Under 15 ms is a **PHOTO FINISH** (stamp + side-by-side timing bars). Within 5 ms is a
   dead heat (re-round). Nobody fired: "Nobody fired" (re-round). A ms readout counts up to the final number; a hit-stop
   flash and a smoke puff play on the shot.
4. After the last round the end card shows the score and one **rivalry line** (see Records).

### Duel packs

| Pack | Signal | Bluffs |
|---|---|---|
| Classic | DRAW! | none. Exactly the original rules |
| Decoys | DRAW! (yellow box, same style) | BRAW! DRAWL DREW DRAW? DRAMA, 0–2 per round. Firing on one is a foul. The scene doesn't flash and the sound is the same, so only the word tells |
| Colour | the lantern turns YELLOW (named YELLOW!) | it flashes BLUE / PINK / GREEN first (named, so colour-blind safe) |
| Bell | the bell rings and swings (DING!) | a quiet tink and a small wobble. A muted phone still sees the swing |
| Mixed | a different pack each round, announced by the sign in the scene corner ("MIXED · BELL") | |
| Surprise me | a pack picked at GO (never Classic) | |

A decoy round always ends with the real signal after it; decoys sit at least 650 ms before it and last 750 ms.

### Series

Best of 3, 5 (default), 9: first to 2, 3, 5. **Showdown**: first to 5, win by 2 (no Both barrels). So a session can't run for ever,
Showdown is capped: once 15 rounds have been decided without a winner, the next round is **SUDDEN DEATH** (sign, stamp, "SUDDEN DEATH" in
the line). Whoever takes it wins the duel, even from behind (the winner's tally is lifted to one above the loser's, e.g. 8–9 becomes the
final 9–8, and the end card says "won in sudden death"). A dead heat or a double foul in it just replays it. Past 6 points the notches
turn into plain numbers so the chips never overflow.

### Both barrels

When a best-of series is tied one round short of the win (1–1, 2–2, 4–4), the decider shows **two real signals**
(announced with a BOTH BARRELS stamp and sign): fire only on the second. Firing on the first is a foul. The first signal
looks exactly like the real one; the gap before the second is 0.7–1.4 s. A dead heat replays it as Both barrels again.

### Delay

The wait for the real signal is a mixture, so DRAW can't be learned: 50 % short (1.2–2 s), 35 % middling (2–3.6 s), 15 %
long (3.6–6 s). Non-classic packs wait at least 2.5 s so a bluff fits. The tick beat is irregular (±20 %, a gap every fifth
beat), gets quieter, and the screen darkens slightly as the wait drags on.

## Layouts

One phone (portrait): FIRE pads at both ends, the top one upside down, the duel in between. Landscape phone: one pad each side.
On one phone everything the bottom player reads is printed a second time upside down for the top player: the signal word, the verdict,
the timing bars, the scene sign (BOTH BARRELS, MIXED · BELL, SUDDEN DEATH) and every stamp (PHOTO FINISH, NEW PB, JUMPED THE GUN…); the
two stamps sit at 70 % and 30 % of the scene. Landscape phones only show the upright ones.
Laptop one-device: A against L, pads side by side. Two devices: your own pad, or Space / click / tap anywhere.
The scene is the flexible part (SVG, bottom-anchored, `min-height: 0`), so every size fits with no scrolling and pads ≥ 44 px.
Tested: 375×667, 360×640, 320×568, 568×320, 844×390, 390×844 (phone) and 1280×600, 800×500, 1280×800 (laptop).

## Netcode (two devices)

* The **host is the referee** and decides everything. It plans a round and sends (reliable `round`, mirrored in host presence as `rd`):
  `{ hk, r, at, delay, gap, both, kind, decoys:[t…], dw:[i…], cfg:{p,s}, t:tally, mp }`.
  `at` is a **shared-clock** time (`net.now()`), `delay` is ms after `at` to the signal, `gap` > 0 makes a Both barrels round,
  `kind` is the resolved pack (Mixed picks one per round), `decoys` are ms after `at`, `dw` the decoy word / colour indexes.
  Both devices run the same timeline against the shared clock, so Steady and the signal start at the same instant on both.
  The lead before `at` is `max(900, 1.5·rtt + 600)` ms. A device that gets the round too late (< 150 ms before the signal) reports
  `void` and the host re-rounds.
* **Reactions** are timed locally: signal frame painted → tap event timestamp. Latency never decides a duel.
* A **foul** carries `rel` = the tap's shared-clock time relative to the real signal (negative = early; 0–100 for a guess).
  Two fouls within 30 ms of each other are a **double foul**: re-round, no winner, no lag bias. Otherwise the earlier jump loses.
* **Faster verdict**: once one valid reaction R is in and the other player can't beat it, the host decides. The host's own taps
  are known at once (decide at R + 5 ms); a guest's silence is given R + max(rtt, 40) + 250 ms. One phone: R + 450 ms (so the
  slower thumb's time still shows). A foul waits `max(220, rtt + 150)` ms (30 ms + a hair on one phone) for a possible double foul.
  A round with no result at all closes after the safety timer.
* Shots go guest → host as reliable `shot` events (also mirrored in guest presence). The verdict (reliable `verdict`, also in
  host presence `v`) holds both players' results, the tally, and (final round) the end-card result.
* Recovery: the picker choice is in host presence (`pk`), the duel's config in `cfg`; a guest that missed a message catches up from
  presence. If the host re-mounts mid-duel it takes the tally and config back from the guest's presence (`ht`, `hc`) and skips the picker.
  If the host leaves during the finale the guest finishes the duel itself after FINALE_MS + 2.5 s.
* Pausing: if the partner is away, the round is voided and the duel waits ("Sydney stepped away").

## Records (`api.data()`, written by the host / the one device)

| key | meaning |
|---|---|
| `qd_pb_a_ms`, `qd_pb_b_ms` | personal best reaction (lower is better, so no `_m`/`_best`/`_pb`/`_n` suffix) |
| `qd_best_ms`, `qd_best_who` | the fastest valid draw of all time |
| `qd_streak_who`, `qd_streak_c` | current duel win streak. **Not `_n`**: the sync keeps the larger `_n`, which would resurrect a reset streak |
| `qd_streak_best`, `qd_streak_best_who` | best streak |
| `qd_last` | `<pack>:<series>` of the last duel |

A new PB (beating an existing one) stamps NEW PB with a small fanfare; beating the all-time best stamps NEW RECORD. The end card's
rivalry line: `3–2 · Emerson on a 2-duel streak · new PB 152 ms (Emerson)`. When a player on a 3+ streak loses:
`2–1 · Bounty claimed! Emerson's 3-duel streak ends`. Overall W/L comes from the engine.

## Test hooks (`window.__qdTest`, only on a port)

`state()` (phase, tally, verdict, cfg, kind, cue, rd, rtt), `recv()`, `timers()`, `start(pack, series, tally?)` (skip the picker; the tally lets a test start at 7–8 for sudden death),
`force({kind, decoys, dw, delay, gap, both})` (override the next round's plan).

## Tests

`tools/test/games/live.test.js` (`GAME=quickdraw`): `quickdrawLive` (picker, fouls, latency-shifted verdicts, Both barrels, records, rematch
countdown), `quickdrawPacks`, `quickdrawStreaks` (bounty, Showdown reaches the guest), `quickdrawLocal` (one phone, fit at six sizes, mirrored stamps),
`quickdrawSudden` (Showdown cap), `quickdrawKeys` (laptop), `quickdrawLatency` (latency 200 double foul), `quickdrawLossy` (120 ms, 20 % loss),
`quickdrawLeave` (the guest leaves in the picker and mid-round, the host re-mounts mid-duel and the tally, pack and series survive) and
`quickdrawRematch` ("Pick again" stops the auto-start on both phones).
