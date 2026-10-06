# Getaway (`getaway`)

A two-player 3D car chase. One player drives the **runner** (a muscle car in their ink), the
other the **cop** (a black-and-white cruiser with a flashing lightbar). Roles swap every round.
The cop wins a round by disabling or boxing in the runner. The runner wins by surviving the
clock or by losing the heat. Chase-camera driving in the riso/toon style of Rail Rush and
Blend & Seek, with civilian traffic, knock-over street furniture, spike strips, nitro and oil.

`kind: 'live'`, modes `live` (two devices) and `local` (one device: practice vs an AI, or split
screen on a laptop), phone + computer, `immersive: true`, `ownsPauseUI: true`. Entry:
`js/games/getaway.js`. Modules: `js/games/getaway/`. Maps: `js/games/getaway/maps/` (contract:
`docs/games/getaway-maps.md`). Tests: `tools/test/games/getaway.test.js`.

## A round

```
intro 3.4 s (map · round · roles · "starting near …") → 3-2-1 → CHASE (2:30) → BUSTED / ESCAPED card 5.2 s → next round
```

- **Cop wins (BUSTED)** when the runner's car health reaches 0; when the runner is stopped
  (< 2 m/s) for 3 s with the cop within 12 m (boxed in); or when the runner drives into water
  (SPLASH).
- **Runner wins (ESCAPED)** when the clock runs out, or by **losing the heat**: more than the heat
  distance (180 m by default) from the cop with no line of sight fills the escape meter over 8 s.
  Being seen, or closer, drains it 2.5× as fast. Both players see the meter.
- **PIT**: the cop pushes the runner's rear quarter from the side, running roughly the same way
  (headings within 57°, the contact behind the runner's middle and off its centre line, the cop
  pushing sideways into it at ≥ 1.4 m/s, the runner doing ≥ 7 m/s). It does 24 damage (× the
  damage setting), spins the runner (yaw kick plus 1.15 s of 32% grip and 0.75 s with no throttle),
  stamps "PIT!" and gives both players a 0.75 s slow-motion moment at 0.3×. A straight shunt is a
  ram: (closing speed − 4) × 1.5 damage. A T-bone is not a PIT.
- **Damage**: walls (|normal speed| − 6) × 1.15, traffic (speed − 7) × 0.8, rams, PITs and spikes,
  all × the damage setting. Smoke below 55%, fire below 25%. The **cop** takes damage too (rams
  at 60%) but never drops below 15%. Its top speed scales 72–100% with health, so reckless
  ramming costs it. The runner loses up to 14% of top speed when wrecked.
- Matches are 2 / 4 / 6 / 8 rounds (each player runs half), 1 point per round won. A match ends
  early once it's decided. A tie goes to the longer total time on the run (an escape counts as a
  full round).
- `api.finish({ winner, text, score })` once per match (host and guest both call; core records
  it once). Practice vs the AI finishes with `winner: null` ("You beat the AI 3–1"), so the
  couple's record isn't touched.

## Tools

| | Runner | Cop |
|---|---|---|
| Nitro | tank, 3.3 s full burn (normal) or 4.5 s (big), recharges in ~18 s / 12 s after 0.6 s; +10% per near miss; off in the settings | "pursuit boost": 2.5 s burn, recharges in 20 s |
| Special | **oil slick**, 1 per round, dropped behind you: 3.4 m, 25 s. A cop on it gets 1.5 s at 30% grip and a yaw nudge | **spike strips** (0–6, default 3): tap the minimap or open the map (button, M or E) and tap a road |
| Lights | | lightbar flashes red/blue and tints nearby surfaces; siren (wail, yelp when close) |

**Spike strips.** A tap snaps to the nearest road within 70 m. The strip lies across the road
and is 0.8 m narrower than it. It must be within 400 m of the cop, not within 25 m of the
runner's current position, and not within 14 m of another strip. It deploys over 1.2 s (it
unrolls, lights blinking). The runner sees strips in the world and as red marks on its minimap
only within 120 m (setting: always). Driving over one (a swept test of the axles against the
strip) pops the tyres: 60% lateral grip, 70% top speed, a lower stance, rim sparks and a
flapping sound; a second strip does 8 damage. The strip is used up. The cop is immune to its own
strips.

## Driving model (js/games/getaway/car.js, tune.js)

Arcade bicycle model at a **120 Hz fixed step** (no per-step allocation). The velocity lives in
world space. Each step:

- longitudinal: engine `accel × (1 − (v/vTop)³)`, brakes, coast, drag `0.00042 v²`, rolling
  `0.012 v`, surface drag, slope from `map.height`. Brake at a standstill reverses (to 12 m/s).
- yaw rate chases the kinematic rate `v · tan(δ) / L` (lock 0.62 rad, falling off as
  `1 / (1 + v/18)`), capped at 97% of the grip limit (`grip / v`). Braking adds 12% turn-in,
  throttle at speed takes 4% (a weight-shift feel).
- the tyres pull the sideways velocity towards zero, at most `grip` m/s² (20 for the runner, 19
  for the cop; × the surface and flat-tyre factors). Turning beyond grip, or the **handbrake**
  (rear grip 34%, yaw cap × 2.3, 5.5 m/s² drag), slides the car: drifts. Sliding scrubs speed.
- visuals: pitch and roll from smoothed accelerations, wheel spin and steer, a fake 5-speed
  gearbox for the engine note.

Measured (unit tests): 0–100 km/h in 3.2 s, top speed 161 km/h (cop 164), +40 km/h from nitro
over 3 s, 144 → 0 km/h in 2.6 s / 51 m, full lock at 43 km/h is a 7.5 m radius (2 g), at 90 km/h
a 1.4 g carve with no slide, a handbrake turn at 95 km/h rotates 90° in 1.2 s.

| Surface | lateral grip | top speed | extra drag | dust |
|---|---|---|---|---|
| road, lot | 1 | 1 | 0 | no |
| grass (the default off road) | 0.72 | 0.66 | 1.6 m/s² | yes |
| dirt | 0.78 | 0.78 | 0.9 | yes |
| sand | 0.60 | 0.50 | 3.2 | yes |
| water | — | — | — | a runner is busted (SPLASH); the cop just wades |

**Collisions.** The car is three circles (r 1 m) along its length. They collide with every
solid's oriented box (from a 16 m grid), the map bounds and bridge rails. The deepest contact
pushes the car out and applies an impulse at the contact point (restitution 0.18, 12% tangential
scrape), so cars slide along walls and spin on corner hits. At 120 Hz a car moves at most 0.5 m
per step, so it never tunnels through a wall (tested up to 216 km/h). Breakables (poles, trees,
lamps…) above 9 m/s are knocked over (−14% speed, 2 damage). Car vs car: the same circles. Each
device resolves the impulse on its own car against the other car as predicted (equal masses,
restitution 0.25).

**Camera.** A chase camera behind and above (near: 7.4 m back, 2.9 m up; far: 12.5 m, 5.6 m; ×1.3
in portrait), easing towards the direction of travel while sliding so drifts read. It is pulled
in (and lifted) when a building is between it and the car. FOV 60° + 15° with speed + 6° on
nitro (74° base in portrait). Look-back (B / button) flips it for 1.6 s. C or the CAM button
toggles near/far (remembered per device; the setting is the default). Shake on impacts (quartered
when reduced motion is on). Speed lines over 86 km/h.

## Traffic (js/games/getaway/traffic.js)

Civilian cars drive every road's lanes (highway 2 per direction, wide arterials 2, else 1, on the
right). A car's position is a **pure function of the shared round clock**: lane, phase and speed
come from a PRNG seeded by the map id, and every car on a lane shares its speed, so they never
hit each other. On open roads a car enters at one end and leaves at the other (it grows and
shrinks over the last 6 m). Density: off / light (1 per ~150 m of lane) / normal (1 per ~78 m).
Hitting one is local: it leaves the schedule as a sliding wreck (and rejoins once nobody has
been within 160 m for 12 s). Near misses (passing within ~1.2 m at a closing speed of 12 m/s or
more) count for stats and top up the runner's nitro. Drawn as two instanced meshes (tinted paint +
untinted trim) of up to 64 cars nearest the camera. Tested: the same hash and the same cars at the
same moment on both phones.

## Netcode (js/games/getaway/link.js over net.js)

`link.js` is Blend & Seek's pattern: per-mount session ids, raw `ghi` greetings, and net.js on a
channel namespaced by both sessions, so a re-mounted partner gets a fresh clock sync and reliable
sequence. On top of that:

- **Streaming** (20/s): `x z y yaw vx vz r st hp fl es nt lv rpm ph rd pz ry sv tp sl` (flags:
  boost, braking, handbrake, spinning, flat, siren, skidding, water). They go into an
  allocation-free ring buffer. The partner car is **interpolated at now − 100 ms, then
  dead-reckoned forward** by the delay with its velocity and yaw rate (≤ 320 ms). The drawn car
  converges on that prediction (k = 14/s, a snap past 12 m). Collisions are resolved against this
  predicted pose. If the sender's clock is corrected backwards by more than 400 ms (its early sync
  was off), the buffer starts over instead of rejecting samples.
- Room payloads arrive frozen, so every received message is deep-cloned before use.

| Decision | Authority | Transport |
|---|---|---|
| my car (physics, walls, breakables, traffic hits) | its own device | stream |
| setup (map, rules, who runs first) | host | reliable `setup` (lobby, live) |
| match start, round start, spawn | host | `match {match, R}`, `round {R, scores, hist}`: R = `{idx, runner, spawn, at, t0, endAt}` on the shared clock |
| PIT, ram, damage on the runner | the runner's device (victim) | `hit {kind}` to the cop (stamp + slow motion) |
| damage on the cop | the cop's device | — |
| spike placement | the cop's device (validated there) | `spike {id, x, z, yaw, len, at}` |
| spike hit | the runner's device | `spikehit {id}` |
| oil drop / oil hit | runner / cop | `oil {…}` / local |
| busted (health, boxed, water), escaped (clock, heat) | **the runner's device** | `end {idx, outcome, reason, stats}` |
| scores, next round, final | host | `round` / `final` |
| clock running out with the runner silent | host fallback (3.5 s after the buzzer, link alive) | `end` |
| pause / resume | host (the guest reports `pz` bits: hidden, GL lost, menu) | `pause {at}`, `resume {idx, at, t0, endAt}` (the timeline shifts by the pause) |

Time-critical messages (`match round end final spike spikehit oil hit pause resume endat`) go
**reliable plus two unreliable copies** (deduped by id), so they land at the first delivery even
through 25% loss. The host also re-sends the setup or the current round when a partner (re)links.
Budget: about 20 presence/s plus clock pings, `ghi` at ~0.5/s and a few events; the live test
asserts no budget warnings. Tested at 80 ms and at 150 ms with 25% loss: both phones agree on
every outcome, and the match is recorded once.

**Pauses.** A device pauses for its own reasons (page hidden, GL context lost) and publishes them.
The host pauses the round when it or the guest has a reason, the partner is away, or the link
has been silent for 2.6 s. It resumes with a 3-2-1 and shifts the round timeline by the paused
time, so pauses never cost the runner seconds. A new round always starts unpaused.

## Controls

| | Phone (landscape or portrait) | Laptop | Split screen (one laptop) |
|---|---|---|---|
| Steer | floating slider: put your left thumb down anywhere on the left half, drag ±72 px for full lock (5% dead zone, a gentle curve); or **tilt** (setting, asks for motion permission on iOS) | A D / ← → | A D · ← → |
| Gas / brake-reverse | GAS pedal (big, yellow) / BRAKE | W / S | W S · ↑ ↓ |
| Handbrake (drift) | DRIFT | Space | Space · Right Shift |
| Nitro | NITRO | Shift | Left Shift · Enter |
| Spike strip (cop) / oil (runner) | the round button | E (F) | E · / |
| Map | tap the minimap | M | M · , |
| Camera / look back | CAM / ↶ | C / B | C · \ / Q · . |

Touch: multi-touch pointer tracking, `touch-action: none`, non-passive `touchstart`/`touchmove`
`preventDefault()`, and touches that start within 20 px of the left edge are ignored (iOS back
gesture). No vibration: feedback is stamps, flashes, vignettes, camera shake and sound. A key
legend shows on laptops during the chase.

## HUD

Top: both scores, the round clock (turns red in the last 15 s) and round pips (coloured by the
winner). Left, under the back sticker: the role chip (the cop's is red/blue), car health, and the
heat meter ("Spotted / Losing them / 240 m"; the cop sees "Slipping away"). Right, under the menu
sticker: a north-up round minimap 420 m across, with landmarks (home = pink house), both cars
(the cop flashes red/blue), strips, and for the cop a "last seen" ping when line of sight is lost.
Under it: speed, the nitro bar and the tool count. The full map (M) shows every landmark name, the
400 m drop range and the runner's no-drop circle. Partner name tag with distance, and an edge
arrow when they're close but off screen. Stamps: PIT!, SPIKED!, OIL!, BUSTED!, SPLASH!, ESCAPED!.
Vignettes: red/blue when the cop is within 45 m of the runner, red when hurt. Cop radar setting:
`always` · `los` (default: line of sight or within 60 m) · `off` (within 35 m only). The runner
always sees the cop.

## Settings (host; the guest sees changes live)

| Setting | Options (default **bold**) |
|---|---|
| Map | Dockside · Boulder · Santee (stubs show "coming soon") |
| Round time | 1:30 · 2:00 · **2:30** · 3:00 · 4:00 |
| Rounds | 2 · **4** · 6 · 8 |
| Spike strips | 0–6 (**3**) |
| Traffic | off · light · **normal** |
| Runner nitro | off · **normal** · big |
| Damage | 0.5× · 0.75× · **1×** · 1.5× · 2× |
| Cop radar | always · **line of sight** · off |
| Lose the heat at | 120 · 150 · **180** · 220 · 260 m |
| Camera | **near** · far |
| Runner sees spikes | **within 120 m** · always |

Plus "who runs first" (or, for practice: you start as runner / cop) and, per device, steering
(slider / tilt). Settings are validated (`rules.js`, snapped to their option lists) on both
devices, travel in `setup` and in the match start, and are saved for the next time this device
hosts.

## Look and sound

The same printed-diorama toon as Rail Rush: one MeshBasicMaterial shader family with a
per-vertex 3-band light from the map's sun, a hemisphere term, a screen-space halftone in the
shadow band, ink outlines baked in as inverted hulls, shader-drawn **facade windows** (lit at
random at night), glow parts, and the **siren tint** (the lightbar colour on surfaces within ~20 m,
strong at night). Dark mode is night: a navy sky with stars and a moon, darkened fog, lit windows,
and a headlight cone from your car. The sky is a gradient dome with a riso halftone and a sun disc;
the backdrop renders first in its own pass with its own far plane, fog-free. Effects: skid marks
(a 1,400-quad ring buffer), tyre smoke, dust off road, sparks on impacts and rims, damage smoke and
fire, nitro flames, knocked-over props falling in the direction of the hit, speed lines.

All audio is synthesised (WebAudio, the app's shared context and mute switch): my engine (two
oscillators through a low-pass, pitch by fake RPM, louder with throttle), the other car's engine by
distance, the siren (wail, yelp within 40 m), tyre squeal (band-passed noise by slip), the flapping
of a flat tyre, an off-road rumble, crashes by impact speed, a scrape, a prop knock, the spike pop,
nitro, oil, near-miss, countdown beeps, stamps and win/lose stings.

## Performance

- WebGL2 via three r128: `antialias:false`, `alpha:false`, `stencil:false`, `high-performance`.
  Pixel ratio `min(dpr, 2) × scale`; the scale starts at 0.85, steps down 0.08 (0.15 when far off)
  every 250 ms while the frame-time EWMA is over 18.4 ms, and back up 0.05 after 4 s under 15.4 ms
  (range 0.55–1).
- World: per 200 m chunk, the engine's roads, curbs, markings, bridges, terrain and props plus
  every opaque toon mesh from the map are merged into **one draw call** (two with double-sided
  meshes). Chunks beyond fog + 40 m are hidden; three frustum-culls the rest. The far plane is
  fogFar + 80 m. Traffic (2), wheels (1), puffs, sparks, strips, oil and skids (1 each), speed lines
  (1), the sky and backdrop, and two cars (≈3 each) make up the rest.
- Shader warm-up: every program is compiled and drawn once behind the loading card (8 programs).
  The test asserts none is compiled during play.
- Map builds are sliced (about 12 ms per slice; `prepare`/`build` may be async) behind a progress
  bar. The AI nav grid builds in 4 ms slices per frame in the background.
- `webglcontextlost` pauses with "Tap to resume" and restore resumes. A hidden page pauses.
  `destroy()` disposes every geometry, material and texture, forces context loss, and removes
  every listener and timer.

Measured (tests, software GL, so frame times say nothing about phones; draw calls, triangles and
JS cost are what count):

| Map | world build, busy time (longest block) | triangles in the map | in view, phone 844×390 (laptop 1280×800) |
|---|---|---|---|
| Dockside | 122 ms (23 ms) | 107k | ≤ 26 draw calls, ≤ 114k triangles (25, 113k) |
| Boulder | 529 ms (50 ms) + prepare ~400 ms | 590k | ≤ 50 draw calls, ≤ 188k triangles (47, 180k) |
| Santee | 485 ms (18 ms) + prepare ~370 ms | 568k | ≤ 41 draw calls, ≤ 194k triangles (38, 186k) |

These are maxima over every spawn plus sampled road points, in four directions each (near and far
cameras). A busy chase (AI driving, traffic, effects) on Dockside: ≤ 30 draw calls, ≤ 116k
triangles, game JS p50 1.7 ms / p95 4–5 ms per frame (that includes three's render submission).
Stage timings are recorded in `world.stats.stages` (roads, ground, props, build, backdrop, merge).
While a map builds, the game stops rendering behind the solid loading card, so the main thread is
the build's.

## Practice vs AI (js/games/getaway/ai.js)

The AI plans on a nav grid (8 m cells: road 1, lot 1.4, dirt 3, grass 4, sand 7, blocked by
solids and water), using A* with no corner cutting, re-planned about once a second. It follows the
path with pure pursuit (look-ahead 7 m + 0.55 s), slows for the sharpest turn ahead, handbrakes
hairpins, reverses out when stuck for 1.1 s, and uses nitro on straights. The cop goes direct with
line of sight within 60 m, leads the target, and inside 16 m aims at the runner's rear quarter
(PITs). It drops a spike strip about every 14–24 s, 90–130 m ahead of the runner. The runner picks
far road goals away from the cop and re-plans when it gets close. On a laptop, one device can also
play split screen with two keyboard halves.

## Tests (`node tools/test/games/getaway.test.js`, ports 8930–8939)

Sections (`ONLY=`): `unit` (physics from the modules in Node: acceleration, top speed, nitro,
brakes, turning, drifts, walls without tunnelling at up to 216 km/h, sliding along walls, props,
PIT vs ram vs T-bone, Dockside spawns and surfaces, traffic determinism and density, bridge decks,
nav) · `practice` (one phone vs the AI: lobby, intro, countdown, AI pursuit, touch pedals and
slider, iOS edge, scripted PIT → boxed bust, role swap, spike rules and effect, cop immunity, clock
escape, heat escape, water bust, final) · `live` (two phones at 80 ms: settings sync, read-only
guest sheet, shared timeline, same spawn, roles, traffic determinism across devices, remote car
accuracy, boxed bust, swaps, spikes over the network, clock and heat escapes, splash, tiebreak
final, one recorded result, rematch, message budget) · `lossy` (150 ms, 25% loss) · `split`
(laptop split screen by keyboard) · `robust` (hidden-page pause shifts the clock, no shader
compiles in play, GL context loss and restore, clean close) · `mapswitch` (switch maps repeatedly
and render) · `perf` (every playable map on phone and laptop: draw calls, triangles, build blocks;
a busy chase) · `shots` (390×844, 844×390, 1280×800, light and dark: lobby, settings, intro, chase,
pursuit, map, result). Screenshots go to `$SHOTS`.

## Known limits

- Physics is 2D plus height: no jumps or rollovers, and ramps are just roads. A bridge over a road
  needs about 50 m of length to reach full clearance with 12% ramps.
- Traffic passes through crossing traffic at intersections (lanes never collide with each other,
  and there are no traffic lights), and a knocked car is only knocked on the device that hit it.
- Collisions between the two players use each device's prediction of the other, so at high
  latency a hard hit can look slightly different on the two screens. Damage and PITs are always
  judged by the runner's device.
- No pedestrians.
