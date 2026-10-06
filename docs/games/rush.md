# Rail Rush — design

Three-lane endless runner for two, on one seeded track, live on two phones or split screen on one
computer. Entry `js/games/rush.js`; modules in `js/games/rush/`. Test: `tools/test/games/rush.test.js`.

## Controls

| | Phone (swipe, default) | Phone ("Buttons" setting) | Computer, live | Computer, one device |
|---|---|---|---|---|
| Lane left / right | swipe ← → | tap left / right third | ← → or A D | A: `A` `D` · B: `←` `→` |
| Jump | swipe ↑ | Jump button | ↑ W Space | A: `W` · B: `↑` |
| Roll (slide) | swipe ↓ (in the air: slam down, then roll) | Roll button | ↓ S | A: `S` · B: `↓` |
| Use weapon (Race) | tap the weapon slot | same | E Shift Enter | A: `E` · B: `Enter` or `/` |

- A swipe fires the moment the finger crosses 20 px (or a fast 12 px flick) in `pointermove`, not on
  release. One swipe per direction per touch; reversing without lifting fires again.
- Touches that start within 20 px of the left screen edge are ignored (iOS back gesture).
- The canvas has `touch-action: none` and non-passive `touchstart`/`touchmove` that `preventDefault`,
  so the host page and sheet never scroll or get dismissed.
- Inputs are buffered for 0.2 s: a jump pressed just before landing fires on landing; a roll
  pressed in the air slams down and rolls. 0.1 s coyote time off roof edges.
- First run: a contextual ghost-hand tutorial, once (`localStorage`, guarded). "Switch lanes" shows
  from the countdown until you do (coins pull you to the middle), "jump" as the warm-up barrier
  row (52 m) comes up and "roll" before the bar row (84 m), each turning hot (yellow, bigger) when
  it's time to act. Those two rows span every lane on everyone's track and are *soft*: a miss
  trips you (a stumble), it never costs a heart.

## Feel numbers (js/games/rush/tune.js)

120 Hz fixed-step sim with render interpolation. Speed `12.5 → 30 m/s` (`v = V0 + (VMAX-V0)(1-e^(-t/110))`),
lane change 0.13 s cubic ease-out (test: 100–150 ms), jump apex 1.69 m / 0.75 s in the air with a low-gravity hang near the top, 0.62 s roll,
sneakers apex 3.9 m (reaches train roofs). Side clip = stumble (−40 % speed, decays over 0.9 s,
camera shake, bounce back to the lane you came from). Head-on = crash: −1 heart (3), 1.6 s down,
respawn in the clearest lane with 2 s of ghost invulnerability. Shield absorbs one crash or attack.

## Track generator (js/games/rush/track.js)

- 100 m chunks, each a pure function of `(seed, index)`: the same chunk on every device, built in any
  order. Only `+ − × ÷ sqrt floor` are used (no `exp`/`sin`), so every JS engine agrees bit for bit.
- Every chunk carves a **safe path**: it enters in `safeLane(seed, i)` and leaves in
  `safeLane(seed, i+1)`, and every obstacle is placed around that path. On the path an obstacle is
  only ever jumpable/rollable; lane switches of the path happen in a window where every lane it
  crosses is clear for `0.15 s × lanes + 0.34 s` at design speed (sized for 0.15 s lane changes,
  though they now take 0.13 s: deliberately generous). Coins trace the path.
- Spacing is in **seconds at design speed** (`sqrt(V0² + 0.3·d)`), shrinking from 1.05 s to 0.58 s
  between rows as difficulty `1 − 1/(1 + 0.3x + 1.1x²)`, `x = d/850` rises: gentle for the first
  ~30 s (0.11 at 200 m, 0.30 at 430 m), then ramping (0.65 at 1 km, 0.86 at 2 km). Mechanics
  unlock one at a time: gaps ~205 m, oncoming trains ~280 m, narrow bridges ~390 m, slaloms ~550 m.
- Chunk 0 is the warm-up straight: empty for 20 m, then the two soft tutorial rows (above).
- Patterns: barrier rows (low = jump, high = roll), train corridors, zig-zags (forced lane switches,
  two-lane switches late), ramps onto roofs (a second level with coins), broken-bridge gaps (jump),
  narrow bridges (one lane over a drop), oncoming trains (move at 0.55× your speed toward you, with a
  horn and a lane warning), slaloms (jump-roll-jump combos), tunnels (wrap a chunk; no ramps or gaps).
- Oncoming trains are deterministic in *runner space*: the front is at `zm − k·(z_runner − zm)`, so
  the footprint you must avoid is the static interval `[zm, zm + L/(1+k)]` on every device.
- Pickups: magnet (10 s), sneakers (10 s), shield; Race adds weapon-box rows across all lanes;
  Tandem adds revive tokens at run time.
- Verified by a perfect-information bot (depth-first search over the real sim, 2 s horizon): no crash
  in 500 chunks × 5 seeds (test).

## Modes

- **Race** — first to 2,000 m (~105 s) wins, or the last with hearts. Weapon boxes give one of:
  *ink bomb* (flies to the leader, splats their screen 2 s), *roadblock* (dropped into the trailer's
  lane — jump it or stumble), *lane zap* (forces a hop after a 0.35 s spark warning), *rocket*
  (+35 % speed, smash barriers), *shield*. Rubber-banding: the further behind you are, the better the
  box (ink/zap/rocket); the leader mostly gets roadblocks and shields. Slipstream: +5 % right behind.
- **Brawl** — side by side with strong elastic speed so you meet constantly. Switching into the
  partner's lane while level (|Δz| < 2 m) shoves them a lane over and stumbles them; into the wall
  or a train side it's a SLAM (−1 heart). Jumping dodges. Shover gets a short boost; 1.2 s cooldown.
  Last with hearts wins; at 3 km the one with more hearts (then distance) wins.
- **Tandem** (co-op) — 4 shared hearts, a shared coin goal (100, 250, 450…, each +1 heart, max 5).
  A crash puts you *down*: your camera follows your partner, who gets glowing revive tokens ahead
  (every 3 s for 10 s). Grab one and they're back beside you for free; miss and the team loses a
  heart. Ends when hearts run out. Result `{ team: true, winner: null, score, text }` with
  `score = team metres + coins` (the engine records it as a team result with a best score).

## Netcode (js/games/rush/link.js over js/games/net.js)

- Clock: host time. net.js syncs with a ping every 2 s and keeps 10 samples, which under a busy
  main thread left a 100 ms+ error in the harness, so the wrapper adds a precision layer: the guest
  bursts pings (~8/s) until synced, through the countdown, pauses and resume countdowns, pings
  ~2.7/s in the lobby and ~1/s while running; keeps the 5 lowest-RTT of the last 60 samples, and
  both sides stamp their stream with that clock. The host answers at most ~11 pings/s (after a
  stall it would otherwise answer the whole backlog at once, over budget, with useless timings).
  Measured start skew in the harness: 8–12 ms at 80 ms latency on a heavily loaded machine.
- Message budget (~40/s per device, `h.warnings` in the harness): presence 20/s in a match and
  10/s in the lobby, plus the pings above and a few reliable events. The tests assert no warnings.
- Start: host sends `start {mode, seed, at: now+3500}`. Both count down to `at` and accumulate
  *run time* only while running; the sim steps to `floor(runTime / dt)`. The effective start is `at`
  on both (skew = clock error).
- Each device publishes its runner at 20/s: `z x y lane speed pose flags hearts coins runTime fin`
  plus lobby/pause fields. The partner is drawn from an allocation-free interpolation buffer fed by
  `net.onRemote` (same algorithm as `net.remote`, `delay = 100 ms`), with `z` dead-reckoned to *now*
  (forward motion is very predictable) and `x/y/pose` interpolated, pose weights eased (no pops).
- Reliable events: own small channel (same retry/ack/in-order scheme as `net.send`) that also
  **re-addresses per partner instance**, so a partner who re-mounts mid-match isn't stuck behind
  sequence numbers its new instance never saw. Budget: 20 presence/s + a few events/s + pings.
- Partner instances: every stream carries the sender's instance id. When it changes (a reload, or
  the re-mount on a rematch, which also restarts the host clock) the interpolation buffer is
  dropped — otherwise the previous instance's last presence, stamped on the old timeline, would
  make every new sample look late and freeze the partner. A clock jump back of more than 1 s also
  restarts the buffer, and lag-compensation lookups ignore `net.remote()` states from an old instance.

| Decision | Authority | How |
|---|---|---|
| My runner (position, crashes, coins, pickups, hearts) | its own device | fixed-step sim, published |
| Mode, seed, start time | host | `start` |
| Ink / zap hit, roadblock placement and hit | victim | `atk` → victim checks shield/state → `res` |
| Brawl shove | victim (lag-compensated) | attacker sends `shove {at, z, from, to}` when its view says side by side; victim rewinds its own history to `at`, cross-checks the attacker with `net.remote(at)`, decides hit / dodged (airborne) / slam → `res` |
| Revive | reviver | grabs a token → `revive`, or expiry → `missed` |
| Team hearts, coin goal (Tandem) | host | published; decrements once per down id |
| Race winner | host | compares run times at the finish (`fin`), using the partner's published run time as proof they hadn't finished yet; pause-proof |
| End | host | `end {result, at}`; both play the finale, then `api.finish` (guest too, as a backup for a dropped `__finish`) |

- **Pauses**: a device pauses for its own reasons (partner gone via `onPartnerHere(false)`, partner
  silent > 1.5 s, page hidden, GL context lost, pause menu) and publishes `pz`; the other pauses on
  seeing it. When reasons clear, a device joins the partner's already-published resume moment if
  there is one (≥ 1.2 s away), else proposes `ceil((now + 3000) / 400) × 400` on the shared clock,
  publishes and sends it; both keep the later. Snapping to a 400 ms grid means two phones that
  unpause a moment apart pick the same instant without waiting for messages (test: Δ 0 ms).
  Run time excludes pauses, so pauses can't change a result. The engine's "stepped away" card is
  off (`ownsPauseUI`); Rush's own card offers "Invite them back" when the partner left the game.
- **Partner re-mount mid-match** (they left and came back, reloaded, or the app restarted): each
  device keeps a snapshot of the partner's last *in-match* state (by the time a new instance is
  noticed, the latest presence is already its lobby state). If the *guest* re-mounts, the host
  sends `rejoin` with the match and that snapshot; the guest restores its runner (and its render
  anchor) and both resume with a 3-2-1. If the *host* re-mounts, its clock starts over: the guest
  keeps its run, re-syncs to the new host clock (run time is accumulated, so only the start /
  resume anchors are re-based), and once the new host is in its lobby and synced sends it
  `rejoin {fromGuest}` with the host's own last state; the host restores, and both count down
  to the same moment. Tested: guest leave → back, host leave → back, 30 s in the background, and
  a partner phone 4× slower (no pause flapping, same result on both).

## HUD

Immersive: the engine shows two 44 px stickers (back, menu) in the top corners; the HUD keeps clear
of them (the pause button sits at `var(--gm-corner-safe)`, which includes the notch / Dynamic
Island inset). Top: hearts, then coins and power-up rings in one fixed-height row (so nothing
jumps when a power-up starts), distance; under the menu sticker: my pause button (pauses both phones
in live play). Race: a bar with both runners and the finish, plus a gap pill ("Sydney +23 m").
Pops ("Close call!", "MAGNET") sit between the HUD and the horizon, never on the vanishing point
where obstacles appear; the oncoming-train "!" sits above the far track. Landscape phones put the
race bar between the corner columns and the gap pill in the top row, so the HUD ends ~25 % down.
All setters diff against their last value and never force a reflow (animations restart by
alternating two identical keyframe names instead of reading `offsetWidth`).
Brawl: the partner's hearts in the pill. Together: team hearts, team coins and the coin goal.
Bottom-right: the weapon slot (Race). Buttons scheme: ROLL / JUMP in the bottom corners.
Live: a name tag over the partner (positioned after the frame renders, so it never trails the
camera); when they run level with you but outside the narrow portrait view, it pins to that screen
edge and points at them.

## Art

Printed-diorama toon look from `api.tokens()`: one toon shader (MeshBasicMaterial + a small hook,
cheaper than MeshToonMaterial's per-light loops) with vertex colours and a per-vertex `fx` code:
3 toon bands from one sun direction plus a sky term, computed per vertex (exact on the flat boxes
the world is made of), unlit ink outlines (inverted hulls baked into the same merged geometry, so
outlines cost no draw calls), glow for lamps / tokens / lit windows, a half-fogged skyline, and a
screen-space halftone in the shadow band. Every pattern is geometry, not shader math: window
ribbons / columns / grids (lit at random in dark mode, which is a night city with light linework),
sleepers, hazard stripes, train windows. The same shader runs as three material instances (plain,
instanced, instanced with colour) because three r128 recomputes program parameters whenever one
material alternates between plain and instanced draws. Players in `--p-a`/`--p-b`, coins and pickups `--g-hl`,
outlines `--g-ink`, paper `--g-bg`/`--g-card` (fog = paper). Runners are one skinned mesh each
(rigid-skinned primitives, procedural run cycle, lean, tuck, roll, stumble, crash, squash and stretch).
Juice: speed lines, FOV kick, landing puffs, coin pops and magnet trails, crash stars, close-call and
combo text, ink splats, synthesized sfx and a procedural music loop that intensifies with speed.

Sky and city (all from the theme inks):
- **Sky dome**: two inks printed as a halftone gradient (dots grow from the horizon up; the sky
  fragment shader is one `fract` + `dot` + `step`). Day: paper to a blue tint, a yellow sun with an
  ink rim and halo, misregistered Riso clouds (white over an offset pink copy). Night: a violet
  halftone, a moon with craters, stars, lit windows in the skyline.
- **Colour script**: the sky's two inks (and the fog, which always matches the horizon) warm with
  the fastest viewer's speed (a rocket pushes it further): blue → yellow/pink by day, blue → pink
  neon by night. Uniforms only, quantized, no recompiles.
- **Skyline**: two rings of flat silhouettes (setback towers with antennas, spires, domed halls,
  water towers, one needle tower), the far ring paler. Tunnel portals are concrete with a hazard band.
- **Trains with faces**: windscreen "eyes" with glints and a destination board. Parked trains doze
  (half lids); the oncoming train glares (ink brows, red board, lit headlights), so the one that
  can hurt you reads instantly. Roof units on every car.
- **Track**: sleepers, rails, gantries, and signal masts every 50 m with one lamp lit.
- **Halftone dissolves**: the partner dissolves through a 4 px halftone screen when they run
  between your camera and you (`RR_FADE`, runners' program only), and barriers you've passed do
  the same as they swing past the camera (`RR_NEAR`, barrier program only), so neither fills a
  third of a phone screen. The `discard` lives in those small programs only; the world shader
  keeps early depth rejection.
- **Overlay** (fx.js `createOverlay`): manga speed lines as ~30 thin tapered triangles radiating
  from the vanishing point, plus a corner-only vignette: two draw calls in clip space, no
  full-screen layer (the old DOM speed-line layer was 160 % × 160 % of the screen, ~7.6 Mpx at 3×).
  With `prefers-reduced-motion` there are no speed lines and camera shake is quartered.

## Performance

- Draw calls: each 100 m chunk is ONE merged mesh (track, scenery, parked trains, outlines)
  in pooled preallocated buffers; coins/pickups/barriers/roadblocks/particles/shadows are
  `InstancedMesh`; runners are skinned (1 call each); sky dome 1; overlay 2. Measured on a phone
  view: 14–23 calls in a busy race (test budget ≤ 30), 33–42k triangles (test budget ≤ 60k; was
  45–58k: coins are 12-sided now, 156 triangles each, drawn to 132 m where fog takes them anyway;
  runners 4.5k each with 8-segment capsules). Chunk buffers hold ≤ 18k vertices (peak ~10.3k).
- Far layers (street, skyline, sky dome) draw after the near world (`renderOrder`), so early depth
  testing skips every pixel a building or train already covers.
- `antialias:false`, `alpha:false`, `stencil:false`, `powerPreference:'high-performance'`.
  Dynamic resolution: pixel ratio `min(dpr,2) × scale`, scale starts at 0.85, steps down by
  0.08 (0.15 when far off) every 250 ms while the frame-time EWMA is over 18.4 ms, and steps up by
  0.05 only after 4 s under 15.4 ms plus a cool-down; range 0.55–1.
- Shaders: one toon program family (MeshBasicMaterial + hook; per-vertex 3-band light), the
  shadow-band halftone is one `fract` + one `dot` per shaded fragment. Every variant (world,
  instanced, instanced+colour, barriers, skinned+fade, shield bubble, sky, overlay, shadows,
  banners) is compiled *and drawn once* behind the loading screen (10 programs); the test asserts
  the count is unchanged after ink, zap, roadblock, rocket, shield and a crash.
- Allocation discipline: the per-frame path creates no objects, arrays, strings or closures.
  Beyond that, for V8 (Android, laptops; JSC on iPhones NaN-boxes and never allocates for these):
  doubles written every frame live in object fields or typed arrays, never in closure `let`s (V8
  boxes each such store); hot calls take their doubles through scratch `Float64Array`s
  (`writeM`, `setBone`) instead of arguments; runner bones and the far layers are posed by writing
  `matrix.elements` directly (no Euler/Quaternion setter chains); the overlay uses an integer
  xorshift instead of `Math.random`. Fully optimized, the JS side of a frame (sim, logic, two
  runners, particles, world sync, rig, HUD, overlay) costs ~0.1–0.5 ms for both runners, and the
  per-function micro test shows ~0.3 B/call. The test asserts < 2 KB/frame (what's left is V8
  boxing at call boundaries, tier-dependent) and < 1.5 MB retained heap growth over 30 s.
- Shader warm-up with `renderer.compile` + one draw behind the loading screen. Fog (62–170 m)
  hides chunk pop-in (chunks are built 175 m ahead) while obstacles stay crisp ~2.5 s ahead at top
  speed. The chunk cache trims chunks behind both runners every ~1.5 s.
- Music never catches up after a stall: if the scheduler finds itself behind (pause, background,
  slow frame) it resyncs to now instead of firing overdue notes; it skips note creation entirely
  while muted / music off, sets the bus gain once per target change, and ducks under a pause card.
- `webglcontextlost` → pause + "Tap to resume"; `webglcontextrestored` → three re-uploads from the
  retained buffers. Hidden page → pause sim, render and audio; back → 3-2-1.
- `destroy()` cancels rAF, timers and listeners, disposes every geometry/material/texture and
  forces context loss.
