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

### Gunslinger handicap (optional, off by default)

A toggle chip under the series row in the picker. The host decides (the guest sees the chip move but can't change it). It is remembered in
`api.data` as the boolean `qd_hcap` and preselected next time. It is not offered on one keyboard (the laptop's single shared signal can't
delay one player).

When it is on, GO reads both personal bests. If `qd_pb_a_ms` and `qd_pb_b_ms` are at least 40 ms apart, the quicker player's signal is shown
later by **half the gap, at most 60 ms** (a 40 ms gap is 20 ms, a 120 ms gap or more is 60 ms). The offset is fixed for the whole duel and
stored in the duel's config as `cfg.h = { w, o }` (`0` when off, or when a best time is missing: the chip says "needs both best times first").

* **Each player's whole timeline moves**: decoys, the first of the Both barrels draws, and the real signal all show `o` ms later for the
  favoured player. The host puts the offsets in the round message as `ho: { a, b }`.
* **Online** each device delays only its own player's cue, planned against the shared clock (`at + delay + ho[me]`).
  **One phone**: the two halves are separate, so the favoured half still says "Steady…" while the other half already shows DRAW. The shared
  scene (sky flash, lantern, bell swing) and the sound wait for the later cue, so nobody gets a hint. Firing in the gap (after the other
  half's signal, before your own) is a foul (`rel` is measured against the nominal signal time).
* **Reactions stay raw**: every player's reaction is still timed from the cue *they* saw, and that raw number is what the PBs, the all-time
  best and the NEW PB / NEW RECORD stamps use. Only the round's verdict compares `reaction + offset`, i.e. when they actually fired, so the
  quicker player has to be quicker by more than the offset. A dead heat (5 ms) and a photo finish (15 ms) use the adjusted gap.
* **Shown honestly**: a small `handicap +30 ms` tag sits by the favoured player's name (the tally online, the pad name on one phone), the
  times row shows `Sydney 195 ms +30`, the timing bars use the adjusted times, and the verdict reads "Sydney by 9 ms (with 30 ms handicap)"
  when the favoured player wins, "Emerson by 9 ms (Sydney's 30 ms handicap counted)" when the other one does.
* The faster-verdict timer converts everything back to the nominal signal time, so deciding early still waits for a shot that could win.

### Both barrels

When a best-of series is tied one round short of the win (1–1, 2–2, 4–4), the decider shows **two real signals**
(announced with a BOTH BARRELS stamp and sign): fire only on the second. Firing on the first is a foul. The first signal
looks exactly like the real one; the gap before the second is 0.7–1.4 s. A dead heat replays it as Both barrels again.

### Delay

The wait for the real signal is a mixture, so DRAW can't be learned: 50 % short (1.2–2 s), 35 % middling (2–3.6 s), 15 %
long (3.6–6 s). Non-classic packs wait at least 2.5 s so a bluff fits. The tick beat is irregular (±20 %, a gap every fifth
beat), gets quieter, and the screen darkens slightly as the wait drags on.

## Layouts

One phone (portrait): FIRE pads at both ends, the top one upside down, the duel in between. On phones up to 700 px tall (320×568,
360×640, 375×667) the pads, signal panels and picker are slimmer so the scene keeps about 130–190 px (it was 66 px at 320×568), the scene
signs sit in the sky corners, and the stamps land on each player's own pad instead of over the art. Landscape phone: one pad each side.
On one phone everything the bottom player reads is printed a second time upside down for the top player: the signal word, the verdict,
the timing bars, the scene sign (BOTH BARRELS, MIXED · BELL, SUDDEN DEATH) and every stamp (PHOTO FINISH, NEW PB, JUMPED THE GUN…); the
two stamps sit at 70 % and 30 % of the scene (on a scene under 200 px tall: on the player's own pad). Landscape phones only show the upright ones.
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
* **Faster verdict**: once one valid reaction R is in and the other player can't beat it, the host decides. When the host fired first, the
  guest's shot may still be in flight, so its silence is given R + max(rtt, 40) + 250 ms. When the guest fired first the host's own taps
  are already known, so it only waits 250 ms for a slower host tap (it can't win, but it gives the verdict its gap: "Sydney by 80 ms").
  One phone: R + 450 ms (so the slower thumb's time still shows). With the handicap each R is converted back to the nominal signal time first. A foul waits `max(220, rtt + 150)` ms (30 ms + a hair on one phone) for a possible double foul.
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
| `qd_hcap` | boolean: the Gunslinger handicap chip was on for the last duel |

A new PB (beating an existing one) stamps NEW PB with a small fanfare; beating the all-time best stamps NEW RECORD. The end card's
rivalry line: `3–2 · Emerson on a 2-duel streak · new PB 152 ms (Emerson)`. When a player on a 3+ streak loses:
`2–1 · Bounty claimed! Emerson's 3-duel streak ends`. Overall W/L comes from the engine.

## Test hooks (`window.__qdTest`, only on a port)

`state()` (phase, tally, verdict, cfg, kind, cue, `cs` (each half's cue), `t0` (when each own signal painted), rd, rtt), `recv()`, `timers()`,
`start(pack, series, tally?, handicap?)` (skip the picker; the tally lets a test start at 7–8 for sudden death; `handicap` is `false`, `true`
(from the PBs) or `{ w, o }` to force it),
`force({kind, decoys, dw, delay, gap, both})` (override the next round's plan).

## Tests

`tools/test/games/live.test.js` (`GAME=quickdraw`): `quickdrawLive` (picker, fouls, latency-shifted verdicts, Both barrels, records, rematch
countdown), `quickdrawPacks`, `quickdrawStreaks` (bounty, Showdown reaches the guest), `quickdrawLocal` (one phone, fit at six sizes, mirrored stamps),
`quickdrawSudden` (Showdown cap), `quickdrawKeys` (laptop), `quickdrawLatency` (latency 200 double foul), `quickdrawLossy` (120 ms, 20 % loss),
`quickdrawLeave` (the guest leaves in the picker and mid-round, the host re-mounts mid-duel and the tally, pack and series survive) and
`quickdrawRematch` ("Pick again" stops the auto-start on both phones), `quickdrawSmallPhone` (320×568 and 360×640: scene height, signs and stamps off the art, light and dark), `quickdrawHandicapLocal` (the chip, a handicapped duel on one phone:
the halves show DRAW at different moments, raw reactions with an adjusted verdict, a foul in the gap, bell pack) and `quickdrawHandicapLive`
(the chip reaches the guest, offsets travel in the round, each device's own cue time, adjusted verdicts and PBs on both screens, a foul in the gap).
