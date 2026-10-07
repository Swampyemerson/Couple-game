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

**Collisions (v2).** The car is an **oriented box the size of its body** (4.6 × 1.96 m, `CAR.hl`
/ `CAR.hw`; traffic boxes follow each car's drawn length). It is tested with SAT against every
solid's oriented box (16 m grid), the map bounds and bridge rails, every 120 Hz step, so at most
0.5 m of travel per step and no tunnelling (tested to 216 km/h). The deepest contact pushes the car
out and applies an impulse at the contact point (restitution 0.18, none under 2 m/s) with
**Coulomb friction** (μ 0.3 × the normal impulse), so a car leaning on a wall slides along it at
speed instead of sticking; while sliding it remembers the wall's normal for 0.15 s so the seam
between two wall boxes can't catch it. Engine-drawn breakables collide as a circle the size of
their **drawn trunk** (`geo.TRUNK_R`: tree 0.32 m, aspen 0.23, palm 0.28, lamp 0.2…), not their
map box. Shrubs are soft (driven over, flattened). Mailboxes, hydrants, bollards, signs and cacti
give way above 3 m/s; trees, poles and lamps above 9 m/s (below that they are a soft wall: 40%
damage). Damage starts at a 6 m/s closing speed; effects are tiered: under 2 m/s nothing, 2–6 m/s a
scrape (sparks, scrape sound), above that a crash scaled by speed, with a 400 ms per-pair cooldown
while two cars stay in contact.

**Car vs car.** Practice and split screen: both cars are local, separated and given the same
impulse (`resolvePair`). Live: the **runner's device is the authority** for car–car contacts. Each
substep it tests its car against the partner's raw prediction advanced to that substep (along the
yaw-rate arc; the drawn car is only a smoothed copy), applies its half of the two-body impulse and
sends `bump {j, nx, nz, px, pz, v, dmg}` (urgent). The cop's device applies the other half when it
arrives (the urgent copies are deduped by id); on its own it only pushes the drawn runner out of its car (and steps in
physically only if the two are more than 0.45 m inside each other, e.g. a lost message), so both
phones see one hit and neither reacts to a car that isn't really there. **Every** impulse the
runner's device resolves goes to the cop (a hit at once as an urgent message; the small pushes of
a scrape or a shove summed into one plain message per 150 ms), so both cars always get equal and
opposite pushes. Each device also keeps the impulses it gave its *picture* of the partner (the
runner: the cop's half, plus the cop's share of the separation; the cop: the runner's half, from
`bump.at`) in that picture's prediction until the partner's streamed samples show them, i.e. until
the sample the prediction is based on is from after the partner applied the bump (shared clock:
bump time + half the round trip, + the wait for a plain message). Before this the picture dropped
the bump at the next sample, which at 120 ms was still from before it, so the runner's phone kept
scraping a cop that had already bounced away (10–20 % of contact steps at 120 ms, now ~0–3 %). The
frame loop also lets the simulation keep up with the shared clock down to 8 fps (125 ms a frame,
15 steps): a device that ran slower than the clock made its partner's prediction of it run ahead. The
drawn partner car is the prediction plus an error offset that decays to zero (no steady lag), plus
a short push-out when the bodies touch.

**PIT tiers** (`judgePit`, on the runner's device): contact on the rear 40% (`lz < −0.5`), the cop
moving the same way at ≥ 12 m/s, headings within 57°, the runner at ≥ 7 m/s. The contact normal's
angle from the car's axis blends a ram (< 20°) into a side push (> 40°) — no knife edge — and the
side push decides: ≥ 3.2 m/s a **PIT** (spin 1.15 s, throttle cut, damage 0.55–1.25 × 24 scaled
by the push; slow motion only for pushes ≥ 6 m/s), 1.8–3.2 m/s a **nudge** (a small twitch, a
quarter of the damage, no stamp), less: a ram (damage above 4 m/s closing).

**Body motion for the renderer** (car.js; all smoothed by spring-dampers, ≈1.6 Hz, ζ 0.45):
`c.pitch` (rad, > 0 nose down: braking dive), `c.roll` (rad, > 0 leaning out of a right turn),
`c.heave` (m, < 0 compressed: kerbs, landings), `c.susp[4]` (wheel compression FL FR RL RR, m),
`c.drift` (0..1, smoke and tyre audio), `c.slip` (m/s sideways), `c.grip` (surface grip, smoothed).
Kerbs (road ↔ verge at speed) bounce the suspension and push a `kerb` event; hits jolt it; rough
ground shakes it. Surfaces ease in over ~0.15 s (no wall-like step at the kerb), and a road's
`sidewalk` drives like concrete (`lot`), not grass.

**Camera.** A chase camera behind and above (near: 7.4 m back, 2.9 m up; far: 12.5 m, 5.6 m; ×1.3
in portrait), easing towards the direction of travel while sliding so drifts read. It is pulled
in (and lifted) when a building is between it and the car. FOV 60° + 15° with speed + 6° on
nitro (74° base in portrait). Look-back (B / button) flips it for 1.6 s. C or the CAM button
toggles near/far (remembered per device; the setting is the default). Shake on impacts (quartered
when reduced motion is on). Speed lines over 86 km/h.

**See-through occluders.** Traffic, parked cars, debris, and the thin props (engine-drawn poles,
lamps, signals and signs, plus map geometry drawn with `see: true` such as Santee's and Boulder's
power lines) use a variant of the toon shader (`GTW_SEE`) with a 4×4 Bayer screen-door dither:
anything within ~2–6 m of the lens fades (up to 75%) instead of drawing a solid bar across the
view, and anything inside the cone from the camera to my car, in front of the car, fades so the car
is never hidden (`U.uSee`, set per view). No blending or sorting. The `discard` lives only in that
variant, so the big merged world meshes keep early-Z / hidden-surface removal; the thin props are a
second merged mesh per chunk (+1 draw call where a chunk has any: Boulder's heaviest sampled view
61 → 80 calls of 90, Santee 45 → 65; triangles unchanged. Pooling 2×2 chunks saved calls but a cell
is drawn whole when any of it is in view, which put Santee over the 220k-triangle budget —
`SEE_CELL` in world.js).

## Traffic (js/games/getaway/traffic.js)

Civilian cars drive every road's lanes (highway 2 per direction, wide arterials 2, else 1, on the
right; `oneway` roads one way). Lanes, phases and speeds come from a PRNG seeded by the map id.
From `EPOCH` (570 s of round time; rounds run from 600) each lane is a small **fixed-step
simulation** (0.25 s, intelligent-driver car following) with **signalled junctions**: where two
through roads cross (from the road graph), a deterministic cycle (green 5 + 1.5 × road rank s,
amber 2.5 s, all-red 2 s, offset from the junction id) holds one road's cars at the stop line, and a
car doesn't enter the box while the car ahead is stuck just past it. Only + − × ÷ and sqrt, so the
state at step k is bit-identical on both phones; it advances with the shared clock and rewinds
from snapshots when the clock goes back (a new round). It is warmed up a few ms per frame in the
lobby and the countdown (`traffic.warm`), never in one block. Overlapping traffic pairs at any
moment: 0.01 (Dockside), 0.6 (Boulder), 0.02 (Santee), down from 2 / 12.6 / 7.4.

On open roads a car appears (grows over 6 m) just past the junction box at a road's start and
disappears before the box at its end, so nothing pops in or out inside a junction; growing or
shrinking cars (sc < 0.95) don't collide. Density: off / light (1 per ~150 m of lane) / normal
(1 per ~78 m). Civilians brake for the players' cars and wrecks in their lane (per device, near
the players only), pull over for the siren and stop when it is right behind, and squeeze past
something that won't move.

**Hits.** Traffic contacts are resolved in every 120 Hz step at that step's traffic time. A car
only leaves its lane as a wreck at a closing speed over 3.5 m/s (`TRAFFIC.knockMin`; below that
it's a nudge), and the knock goes to the partner (`knock {id, x, z, yaw, vx, vz, r}`) so both
phones see the same wreck. Wrecks slide to a stop against buildings and walls, rejoin their lane
after 12 s once nobody is within 160 m, and a stopped wreck nobody is next to fades out (it would
otherwise block a junction); a rejoining car grows back in. Broken props are sent too
(`brk {i}`). Traffic damage starts at 9 m/s.

**Drawing.** The `TRAFFIC.max` (112) cars **nearest any viewer** are drawn (`traffic.select`), so
every car close enough to hit has a body (tested: every car within 60 m at 40 spots per map).

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
| PIT, ram, damage on the runner | the runner's device (victim) | `hit {kind, push}` to the cop (stamp; slow motion for hard PITs) |
| car–car contact impulse | the runner's device | `bump {j, nx, nz, px, pz, ox, oz, v, dmg, at}`: the cop applies its half (+ its ram damage); a hit urgent, a scrape's pushes summed per 150 ms |
| traffic knocked out of its lane | the device whose car hit it | `knock {id, x, z, yaw, vx, vz, r}` |
| a prop knocked over | the device whose car hit it | `brk {i, vx, vz}` |
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

Touch: multi-touch pointer tracking, `touch-action: none`. `touchstart`/`touchmove` are cancelled
**only on the driving surface and the pedal/tap buttons**: on iOS a cancelled `touchstart` also
cancels the click, which once made every lobby button dead on the iPhone. Menus never rely on
`click`: `bindTap` (hud.js) acts on a touch `pointerup` that stayed on the same control (and then
swallows the browser's synthetic click for 700 ms, so a menu that re-renders under the finger isn't
pressed twice) and on `click` for a mouse. Sheets and cards scroll (`touch-action: pan-y`,
`overscroll-behavior: contain`). Touches that start within 20 px of the left edge are ignored (iOS
back gesture). Steering feel (per phone, Settings): sensitivity Gentle / Normal / Quick (96 / 72 /
54 px or 32 / 24 / 17° of tilt for full lock), centre dead zone Small / Normal / Large (3 / 6 /
12%); dragging past full lock carries the slider's centre along, so steering back responds at
once. Tilt asks for motion permission from a tap (Start / Ready) and has **Set straight**
calibration. No vibration: feedback is stamps, flashes, vignettes, camera shake and sound. A key
legend shows on laptops during the chase. **Pause**: the ‖ button by the clock or Esc (live: it
pauses both phones) opens Resume · Settings (this device) · How to play · Quit to the lobby
(practice / split only). Esc that Getaway handles never reaches the app's close-the-game Escape.

## Getting in, loading and failures (phones first)

- The game sheet's one-device button reads **Practice vs AI** (`def.localLabel`; laptops: "…or
  split screen"). The lobby: Practice vs AI (you start as Runner / Cop, AI driver Easy / Normal /
  Hard from `ai.js` `AI_LEVELS`) or Split screen (laptops); live: who runs first, the partner's
  status ("is here", "loading the map", or how to join) and the guest's **I'm ready**. A
  first-timer's "New here? How to play" opens the how-to sheet (runner, cop, controls).
  Portrait phones get a one-line tip to turn sideways; nothing forces it.
- Map loading shows a progress bar with the stage and a tip. The host can **Cancel** a big map
  (back to the last map that loaded). The old world is disposed **before** the new one is built,
  so a phone never holds two maps. A watchdog flags a load with no progress for 20 s ("taking
  longer than usual") and fails it at 75 s; any error or timeout ends on an error card with **Try
  again**, **Try lower quality** and **Play Dockside instead** — never a silent hang.
- The chosen map is saved only after it loads, and `getaway.loading.v1` marks a build in progress:
  if the next open finds it (iOS killed the tab mid-build) it opens on Dockside, and on a phone
  with Graphics on Auto drops to Low, with a note.
- Graphics (per device, Settings): Auto (low for software GL, mid for phones, high for laptops) ·
  Low · Medium · High (`render.js` tiers). Changing it in the lobby rebuilds the map at once.
- WebGL context loss pauses the chase; if the phone hasn't given the context back after 2.5 s, a
  card offers **Reload graphics** (a fresh renderer, the map rebuilt, the chase resumes) or
  **Reload at low quality**.

## HUD

Top: both scores, the round clock (turns red in the last 15 s) and round pips (coloured by the
winner). Left, under the back sticker: the role chip (the cop's is red/blue), car health, and the
heat meter ("Spotted / Losing them / 240 m"; the cop sees "Slipping away"). Right, under the menu
sticker: a north-up round minimap 420 m across, with landmarks (home = pink house), both cars
(the cop flashes red/blue), strips, and for the cop a "last seen" ping when line of sight is lost.
Under it: speed, the nitro bar and the tool count. On touch the tool count is a badge on the oil /
spike button instead (one count on screen), and a short landscape phone puts speed and nitro in the
sky left of the minimap, clear of the car and both thumbs. The full map (M) shows every landmark name, the
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

Plus "who runs first" (or, for practice: you start as runner / cop, and the AI driver level) and,
per device: steering (slider / tilt), sensitivity, dead zone, tilt calibration, graphics level and
camera. Settings are validated (`rules.js`, snapped to their option lists) on both
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

All audio is synthesised (WebAudio, the app's shared context and mute switch), no music: my engine
(three oscillators through a low-pass, pitch by fake RPM, a dip at each gear change, louder with
throttle), the other car's engine by distance, **Doppler-shifted and panned** by its bearing from my
camera, the siren (wail, yelp within 40 m, Doppler, pan, muffled with distance), tyre squeal
(band-passed noise by slip), wind and road roar rising with speed, a quiet city ambience, the
flapping of a flat tyre, an off-road rumble, crashes by impact speed with variety (a metal clang
above 10 m/s, glass on big hits), a scrape, a prop knock, the spike pop, nitro, oil, near-miss,
countdown beeps, stamps and win/lose stings. One-shots are rate-limited (scrape 110 ms, crash 70 ms)
so a long grind can't pile up voices.

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
- Shader warm-up: every program is compiled and drawn once behind the loading card. The first draw
  of each program gets a slice of its own (one object, 1×1 viewport, 3 vertices): drivers and
  SwiftShader build a program's pipeline lazily at its first draw (50–250 ms each in software GL),
  and several of them landing in one upload slice were the load's longest block (the perf test's
  flaky 259–378 ms task). The test asserts no program is compiled during play.
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
| Boulder (v2 map, engine v2) | 720–1020 ms (≤ 70 ms) + prepare ~500 ms | 878k (map's own 281k) | ≤ 58 draw calls, ≤ 215k triangles |
| Santee | 485 ms (18 ms) + prepare ~370 ms | 568k | ≤ 41 draw calls, ≤ 194k triangles (38, 186k) |

With the see-through thin-prop family (one more merged mesh per chunk that has poles, lamps,
signals or wires) the perf test now reads: Dockside ≤ 34 draw calls (laptop 33), Boulder ≤ 55 (53),
Santee ≤ 39 (35), triangles unchanged; the longest task from a map load to 600 ms after ready is an
ordinary software-GL lobby frame (Santee 131 ms, Boulder 277 ms vs a 223 ms frame).

These are maxima over every spawn plus sampled road points, in four directions each (near and far
cameras). A busy chase (AI driving, traffic, effects) on Dockside: ≤ 30 draw calls, ≤ 116k
triangles, game JS p50 1.7 ms / p95 4–5 ms per frame (that includes three's render submission).
Stage timings are recorded in `world.stats.stages` (roads, ground, props, build, backdrop, merge).
While a map builds, the game stops rendering behind the solid loading card, so the main thread is
the build's.

## Practice vs AI (js/games/getaway/ai.js, roadgraph.js)

**Road graph** (roadgraph.js, built in slices while the map loads: `geo.buildNav(ms)`): nodes at
junctions (road-end snaps within hw + 4 m and same-level crossings; bridge decks join only at
their ends) and road ends; edges along each road per direction (one-way roads forward only, the
wrong way × 4) and junction links. A direction whose right-hand lane runs into a non-breakable
solid (median barriers, a building on the road) is blocked; roads with barriers along the centre
are `divided` (U-turns cost more). Dijkstra over typed arrays, ≈0.2–1.5 ms. The same graph gives
traffic its junctions.

**Driving.** Routes are followed as a polyline offset into the right-hand lane (out-and-back
spikes at junctions removed, corners rounded) with pure-pursuit steering (look-ahead 5 + 0.42 v m,
shortened before sharp turns) and a curvature speed profile (lateral 12.5 × grip, braking 10.5
m/s²). Re-planning is at most twice a second; a failed plan backs off and never falls back to a
straight line across lawns. Every 0.1 s it reads the traffic ahead: follows, overtakes in the
oncoming lane when it's clear long enough (the cop more readily: traffic pulls over for it), uses
a verge when crawling in a queue (and leaves it as soon as its lane flows again or after ~3.5 s,
for any decent slot: it used to ride the grass beside a moving line of cars for 10+ s), and creeps
round a car that has stopped nose to nose with it. A
**watchdog** (less than 4 m of progress while wanting to move: in 2.4 s, or 2.9 s with traffic just
ahead; a runner gives up sooner, 1.8 / 2.4 s; or pinned against a wall or a car, traffic included)
escalates: reverse with the opposite lock, reverse plus a three-point turn, penalise the road it's
stuck on for 20 s and re-plan, and (practice, 70 m+ from the player) hop back onto the lane behind.
It thinks at a fixed 30 Hz inside the physics step (slow motion slows it too). Slow and turning
(pulling out of a junction), it reads the traffic in the direction it is turning to, not along its
nose (a car waiting at the line straight ahead used to hold it up for good). With no route yet it
keeps driving along the road it is on, in its lane, instead of parking on the nearest road point.
**Spawn clearing**: at a round start no civilian car is on (or drives into) a 30 m zone round
either spawn point until 6 s after the go; then the zone shrinks to nothing over 3 s and the cars
grow back in as its edge passes (`traffic.setClear`, a pure function of the round, so both phones
agree; the shared lane schedule is untouched).

**Cop**: pursues along the roads when close; further away it intercepts on the runner's predicted
route (the straightest continuation at each junction) where it can arrive first. Within ~38 m with
a clear, drivable line it runs a PIT routine: approach → align alongside the rear quarter → tap →
peel off (cooldown by level); a runner stopped within 16 m is **boxed** (it pulls up and waits, no
shoving). Spike strips go on the predicted route 3–5 s ahead. Without line of sight it works from
the last sighting with a radar ping every 6 / 4 / 2 s.
**Runner**: Dijkstra from itself and from the cop; picks escape junctions 6–28 s away it reaches
well before the cop, preferring ones out of the cop's sight and avoiding dead ends, bridges and
strips; drops oil with the cop on its bumper; nitro on long clear straights.

**Levels** (`createDriver(geo, role, { seed, level })`, `level` ∈ `AI_LEVELS` = `easy | normal |
hard`, labels in `AI_LEVEL_LABELS`; game.js reads the device setting `device.aiLevel`, default
normal):

| | top speed | reaction | PIT | radar ping | traffic margin |
|---|---|---|---|---|---|
| Easy | 88% | 250 ms | sits on your tail, no PITs | 6 s | wide |
| Normal | 95% | 150 ms | yes, 1.5 s cooldown | 4 s | normal |
| Hard | 100% | 80 ms | aggressive, 0.8 s cooldown | 2 s | tight |

Mild catch-up: the cop is 5% faster after 6 s more than 250 m behind and 6% slower after 8 s
within 25 m without a PIT; the AI runner eases off 8% when it's more than 300 m ahead.

Tested on all three maps (unit): the cop reaches a parked player 100–1200 m away through normal
traffic (≤ 15% off road), and started nose-in against a building it backs out and gets there.

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
a busy chase; each long task from a map load to 600 ms after ready is classed as load work or a
rendered frame — the game logs frame starts in test mode — and load work must stay within
max(250 ms, 1.3 × an ordinary frame) while frames get 2 ×, since the first software-GL frames of a new
map run up to ~1.5 × a steady one) · `shots` (390×844, 844×390, 1280×800, light and dark: lobby, settings, intro, chase,
pursuit, map, result) · `touch` (an iPhone driven only by real `page.tap()`s: the Practice vs AI
label, opening on Dockside after a crash marker, role / AI level / how-to / settings rows, a forced
load failure → error card → Play Dockside instead, Cancel on a big map load, Start, the ‖ pause
menu with Settings and Resume, the map's Done, a context loss that never comes back → Reload
graphics, Quit to the lobby; port PORT + 7). The `practice` and `live` sections also tap Start,
Settings, the rule steppers, Done and the guest's Ready. Screenshots go to `$SHOTS`.

Engine v2 sections: `unit` also covers the box collider, trunk-sized props, shrubs and mailboxes,
sliding along a wall of seamed boxes, PIT tiers, braking dive, the road graph (sliced = one go,
one network), traffic not overlapping at junctions, every nearby traffic car drawn, wrecks stopping
at walls, and the AI reaching the player / getting unstuck on every map · `contacts` (two phones at
80 ms / 10% loss shove side by side: every contact step is checked against where the partner car
really was on the shared clock — no phantom contacts — and every bump reaches the cop's phone; port
PORT + 9) · `chasecontacts` (also run by `contacts`: both cars driven by the AI on Dockside with
traffic on at 120 ms / 10% loss, the cop started 12 m behind the runner seven times; under 10 % of
the runner phone's contact steps may be phantom; DBG=1 prints how far each phone's picture of the
partner is from the real car, with and without a bump correction).

## Known limits

- Physics is 2D plus height: no jumps or rollovers, and ramps are just roads. A bridge over a road
  needs about 50 m of length to reach full clearance with 12% ramps.
- Civilians yield to the players and wrecks locally (each phone moves its own nearby cars a
  little); the shared schedule and every knock are the same on both phones.
- Car–car hits are resolved on the runner's phone against its prediction of the cop; at high
  latency the cop's phone sees the shove up to one trip later.
- No pedestrians.
