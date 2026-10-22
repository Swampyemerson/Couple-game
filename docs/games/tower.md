# Tower Together

`js/games/tower.js`. A turn-based, co-op stacking game in a full-screen isometric three.js view (with a flat 2D canvas
fallback). The two of you take turns dropping a sliding block on a shared tower. Whatever hangs over the edge is sliced off.
A drop that misses the tower completely ends the run. The team score is the height. `team: true`, so the engine records a
shared result and its own "Best team score".

## The principle: the slider is view-only

The rules never see the slider. A move is just `{ o }`, the drop offset along this level's axis relative to the block below
(3 decimals). The sliding, its speed, its start side, gusts of wind, the 3-2-1 after a pause and the hand-off beat are all
view code. That is why the slider can be tuned (windy gusts, hard-hat speeds, the early-tap guard) without touching the
rules, and why every old match log replays exactly as it always did. Tests inject a drop with `window.__towerTest.next = o`.

## Rules (pure and deterministic)

Level `n` is the n-th dropped block (the base is level 0). It slides along `x` on odd levels and `z` on even levels.

- `|o| >= size` (nothing overlaps): a miss. `s.over = true`; the height stays what it was.
- `|o| <= min(tol, size * 0.2)`: a perfect. The block snaps onto the one below at full size, `nb.p = 1`.
- Otherwise the block is sliced: the kept part is `size - |o|`, the overhang becomes a falling piece (`drop.cut`).
- Growth: classic grows the block `+0.2` per axis (capped at the base, 3) every 3rd perfect in a row.

State additions are additive only: `s.mode` (missing = classic), and on non-classic blocks `gift: 1` / `lm: 1`; on non-classic
drops `drop.gift`, `drop.landmark`, `drop.bonus`. A classic match carries exactly the original fields (a test asserts the
key list). `result()` stays pure: `{ winner: null, team: true, score: height, text: 'N blocks high', sub }` where `sub` is the
flavour line plus "N perfect drops, longest streak S" (the longest run is derived from the blocks' `p` flags).

### Versioning: the setup move

Match opts are always `{}`, so the mode is chosen in-game with a **setup move** `{ m: '<id>' }`:

- accepted only as the very first move of the match (no mode yet, no drop yet, not over), by the starting player;
- it does **not** pass the turn: the starter then plays their normal first drop;
- if the first move is a normal drop, the match is classic and a setup move afterwards is rejected
  ("Modes are picked before the first drop.");
- unknown ids (including `constructor`, `__proto__`) are rejected with "That mode isn’t on the menu.";
- `{ m: 'classic' }` is accepted and plays exactly like no setup move (`s.mode === 'classic'`).

Old logs never contain `m`, so they stay classic. `tools/test/games/threed-tower.test.js` embeds a copy of the original
rules and replays 60 seeded old-style logs, comparing every state field, the result and the chip counts.

### Modes

| id | name | rules |
|---|---|---|
| `classic` | Classic | Today's rules. |
| `duet` | Duet | A perfect from each of you grows the block: every 2nd perfect in a row (always by the other partner) gives `+0.2`. Gift levels and landmarks. |
| `windy` | Windy | Classic rules plus gift levels and landmarks. The **view** makes the slider gusty and shows a streamer. |
| `hard` | Hard Hat | Base 2.4 (the setup move rewrites `blocks[0]`), perfect tolerance 0.07, growth capped at 2.4. The view starts the slider at the level-15 speed and caps higher. Landmarks. |

**Gift levels** (duet, windy): from level 5, `randInt(6, seed, 'gift', level) === 0`, about one level in six. A gift block is
shown wrapped in a ribbon while it slides; when it lands (not a miss) it grows `+0.3` on both axes, capped at the base, after
any slice.

**Landmarks** (every mode but classic): every 10th level is golden. Landing a **perfect** there grows `+0.2` on top of anything
else and stamps "Landmark!". Landmark blocks stay yellow in the tower.

**Windy view**: a seeded per-level gust profile (`rand(seed, 'wdir'|'ww'|'wph', level)`) modulates the slider speed between
about 0.5x and 1.5x, with a bias toward the wind direction; the start side is seeded per level. A streamer (a pole and three
flags in the batch) lies flat in a gust and droops in a lull.

## Picking a mode

Only the starter, before the first move, sees a 2x2 grid of mode chips (48 px tall, label + one-line hint) above the turn pill.
Tapping a chip sends the setup move at once. The partner's phone toasts "Emerson picked Duet" (and fades it after about 1.5 s;
the toast is engine chrome), shows the mode badge in the HUD and, meanwhile, the pill reads "Emerson is choosing a twist…".
The starter gets no toast of their own (the badge and the vanishing picker say it). Just tapping the play surface skips the
picker (classic). The picker hides in the same frame as the first drop tap, and a chip tapped after a drop is ignored quietly.
A line under the chips says what the twists add ("Twists add gifts & golden landmark levels."). The last mode picked on this
device is highlighted (`localStorage`, not auto-sent).

## Bug fixes (all in the view)

1. **Stray early tap.** A tap while the slider has not yet overlapped the tower since it appeared, or in its first 250 ms, is
   ignored (`ignored` counter in the test hook). `data-armed="1"` on `.gt-view` marks a slider that will take a tap.
2. **Context loss / paused / not ready.** No drop while the WebGL context is lost, the page is hidden, or the view is not ready.
3. **Online HUD ahead of the replay.** The pill, per-player counts and height now update only when the partner's drop replay
   has finished (`hud()` runs from `afterSync`, after the slider exists).
4. **Tall tower finale.** The finale fits the tower between the HUD and the end panel (and re-fits when the window changes);
   the ink outline scales down (and crease lines drop out) when blocks are tiny on screen.
5. **Resume.** Coming back from a hidden tab (and after a WebGL restore) the slider restarts from its edge behind a short 3-2-1.
6. **Hand-off.** On one phone a ~600 ms "Sydney’s turn" beat comes before the next slider. It is a pill at the bottom, where the
   turn pill is (bottom right in landscape), so it never covers a stamp or a banner. Under reduced motion it is the same pill,
   still, for 400 ms.
7. **Callout layout.** The banner and the stamp live in one column just under the HUD (on the left in landscape), so they never
   stack on each other, the HUD or the beat. All the callouts of one drop (record, landmark, gift, milestone;
   at most two titles) arrive as ONE banner; NEW BEST is the headline and shows on the drop that set it. A newer banner replaces
   the one on screen, except that a record is left alone for 1.2 s. The copy only claims growth when the drop grew
   ("Gift! It grew a little" / "Gift! Already full size"; "Level 10 bonus: it grew" / "Level 10 · already full size").
8. **Notched phones.** In landscape the panel respects the bottom and side safe-area insets, and the tower slides left (camera
   `ox`) until the panel clears it. The HUD keeps clear of the side insets.

## Hall of Heights (records)

Turn games do not get `api.data()` from the engine, so the game uses `gameDataApi('tower')` from `core.js` (the same store, the
same `data / setData / onData`). Keys (flat; `_best` and `_n` keys are merged as the max when syncing):

| key | meaning |
|---|---|
| `h_classic_best`, `h_duet_best`, `h_windy_best`, `h_hard_best` | best height per mode |
| `streak_best` | longest run of perfects |
| `towers_n`, `blocks_n` | towers finished, blocks stacked |
| `perf_a_n`, `perf_b_n` | perfects per player |
| `last_id` | the last match counted (idempotence) |

Recorded once, the moment the run is first seen over (`update`, not the finale, so leaving early still counts), for a match that
was still being played when this phone opened it. A match re-opened already over records nothing. Both phones record, and
`last_id === matchId` stops a double count. The "best before this run" used for NEW BEST and the ghost is never refreshed from a
record that already includes this match, so both phones agree. Missing data never blocks the game. A run that ends at height 0
still counts as a tower; its panel says "Timber, straight away. Shake it off and go again." instead of "Best Classic: 0" when
there is no best yet.

- **Ghost line.** A dashed ring at the mode's best height around the tower (16 thin boxes in the static batch, no extra draw
  call; dashes whose screen position is above the bottom of the HUD are left out, in 3D and 2D), a "Best N" tag at the line
  (hidden when it would sit under the HUD) and a "Best N" in the HUD. Passing it stamps **NEW BEST** (naming who placed the record
  block) and plays the win sound.
- **Milestones** at 10, 25, 50, 75 and 100 get a banner with a couple-flavoured line.
- **Near misses**: "So close!" when `tol < |o| <= 1.6 * tol`; "By a whisker!" when the kept size is under 0.25.
- **Streak pitch**: the perfect chime climbs a semitone per perfect in a row (up to an octave); synthesised, respects mute.
- **End panel**: the finale pulse, then a panel with the height, NEW BEST (and the old best), per-player perfects, the longest
  streak, Rematch and Back ("Back" is short so it never wraps at 360 px). About 2 s later the engine's end card shows (`endDelay: 'manual'`, `api.showEnd()`); "See the tower"
  brings the panel back.

## Feel and graphics (upgrade 2)

All of it is view code; the rules and the move encoding are untouched.

**Loop.** The rAF timestamp is the clock; a frame is clamped to 0.1 s. What integrates (sliced pieces, flecks, the landing
squash) runs at a fixed 120 Hz (`STEP`, at most 12 steps a frame, an accumulator, the rest dropped) and is drawn interpolated
between its last two states (`blendSim`). The slider is analytic and drawn exactly where the model has it, so the recorded
`o` is the slider position of the last frame drawn (the tests check this under a 4x CPU throttle: `t.drawn`, `t.tapped`, the
recorded move). The camera (y, zoom, ox) is an exact critically damped spring (`spring()`, 7.5 rad/s, about 0.7 s to settle);
`camBusy` still lets the loop sleep when nothing moves. A frame loop can no longer be scheduled twice (a `kick()` inside a
frame used to double it).

**Input.** A tap freezes the block and the picker goes at once; the move itself (`api.move`: derive, db write and the engine's
update chain, all synchronous) is sent after the frame that shows the frozen block (rAF, rAF, `setTimeout 0`; a 400 ms timer is
the safety net for a page that is not drawing). Taps stay guarded (`frozen`, `pending`); if the engine says no, the slider
comes back and the error is toasted.

**Juice** (all of it off under reduced motion, except the sliced piece that falls away):
- the kept block lands with a squash and stretch (y squashes up to 20 %, x and z swell, ~120 ms, springs back once) on top of
  the small lift bump;
- sliced pieces tumble under fixed-step gravity and, if they reach the pedestal top or the ground plane, bounce once (restitution
  0.3) and lie there, then shrink away; the pedestal bounce and the ground thud play `tick` and puff three flecks;
- up to 12 ink, yellow and paper flecks (tiny boxes in the moving batch, pooled, ~0.4 s) puff from the top rim of a landed block:
  5 on a slice, 10 on a perfect, a couple more for a gift or a landmark;
- a perfect freezes time (sim, timelines, camera) for 45 ms;
- a velocity kick on the camera spring: the world jolts down a few pixels and settles (1.1 slice, 1.6 perfect, 2.4 growth,
  gift or landmark).

**Printed look.**
- Side faces are printed as a halftone: a 45 degree dot screen from `gl_FragCoord` in the face material's fragment shader
  (`onBeforeCompile`, cell 3 css px times the pixel ratio, coverage from how dark the face is lit); top faces stay flat ink.
- Vertex AO: the foot of every side face is multiplied by 0.85.
- The ink outline hull is printed 0.42 of its width off register toward the bottom right (a screen-space offset, so it keeps
  its depth); the crease lines stay on the edges.
- The pedestal is a printed plinth: two flat stripes (blue, pink) and a blue pin-stripe, done in the static batch's fragment
  shader from world position, so no extra geometry or call.
- The paper: the WebGL canvas is transparent and two 256 x 256 tiles (paper grain with fibres and a faint halftone, and a tinted
  ground band with a bigger dot screen) are painted from the palette into the `.gt-paper` and `.gt-ground` divs behind it (one
  texel = half a css px). The ground band starts at the pedestal's back foot corner and follows the camera (`placeGround`), so
  nothing has an edge. They are repainted when the theme changes. (A full-screen GL quad did the same job but cost about 20 ms a
  frame on the headless software rasteriser; the DOM layers cost nothing per frame.)
- The 2D fallback draws the same model (squash and flecks included) on an opaque canvas; the paper layers sit under it.

**Budgets** (checked in light and dark by the tests, `t.calls`, `t.tris`, `t.texBytes`): 8 draw calls (shadow, 3 + 3 for the two
batches, ring while it plays), about 350 to 750 triangles, 512 KB of texture (the two decoded tiles). A tall tower draws only the
blocks near the screen (the static batch is in level order, so it is one draw range), which keeps the triangle count flat.

**Dynamic resolution.** A window of 16 frames in which a quarter miss the display's cadence (1.45 x the fastest frame seen)
takes the pixel ratio down by 30 % (floor 1). On the headless rasteriser the canvas hand-over to the compositor (a `ReadPixels`)
is what costs, in proportion to pixels, so this is what keeps frames steady on a slow device.

Test hooks (`window.__towerTest`): `frames`, `calls`, `tris`, `texBytes`, `ratio`, `drawn` (the slider offset on screen),
`tapped`, `fx` (counts of `squash`, `flecks`, `kick`, `hitstop` that actually fired), `cam`, `model` (`flecks`, `pieces`, ...).

## Performance

One batch per kind of mesh: settled blocks (+ the ghost dashes and gift ribbons) and moving pieces (+ flecks and the streamer),
each with faces, an inverted-hull outline and crease lines, plus the pedestal shadow and the perfect ring: 7-8 draw calls per
frame. Buffers are preallocated and rewritten in place; nothing is allocated per frame. Only changed ranges go to the GPU: the
static batch when it is dirty, positions of the moving batch every frame, its normals only while something tumbles and its
colours only when one changed. The ghost, the culling and the ground band are updated only when the camera moved.

## Tests

```
PORT=8924 node tools/test/games/threed.test.js          # the shared 3D suite (tower + bones)
PORT=8920 node tools/test/games/threed-tower.test.js    # old-log replay, modes, bug fixes, records, panel, visuals
```
`ONLY=stray,hud,modes,once,flat,tall,visuals,records,polish,feel` runs part of the tower suite (`polish`: merged banners, overlap
checks in portrait and landscape, ghost ring vs the HUD, the notch). The "not ready" test holds the view not-ready with a hook
(`window.__towerTest.hold`, a promise) instead of racing the loader. `feel`: the spring settles and the loop sleeps, a perfect
squashes/puffs/freezes/kicks, and a drop equals the slider position under a 4x CPU throttle; the reduced-motion run checks that none of
that happens. The graphics budget (calls, triangles, texture bytes) is checked in `visuals`, light and dark. Ports used: `PORT`, `PORT+1` (reduced motion
records run), `PORT+2` (dark run).
