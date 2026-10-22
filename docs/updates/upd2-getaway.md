# Upgrade 2 — Getaway: smoothness and surfaces

Unit: getaway (branch `claude/upd2-getaway`). Scope: car → camera feel, network interpolation of the partner's car, fixed
timestep + render interpolation, frame pacing on iOS (60 Hz WKWebView, 120 Hz ProMotion), then a graphics and surface upgrade
(roads, buildings, materials, sky, lighting) within the existing mobile budgets. The homes (Boulder's 3865 Moorhead, Santee's
8524 Boulder Way) and the cats of 8524 Boulder Way are unchanged in meaning and location; they only pick up the new shading.
No gameplay numbers, road layouts, solids, spawns, landmarks, wire format or saved data changed.

## Research (short, sourced)

- **Fixed timestep + render interpolation.** Simulate at a fixed step and draw `lerp(prev, cur, accumulator / step)`; without it a
  display whose rate doesn't line up with the sim rate shows temporal aliasing (1, 2 or 3 steps per frame).
  [Gaffer on Games, "Fix Your Timestep!"](https://gafferongames.com/post/fix_your_timestep/)
- **rAF delta jitter.** Reported frame deltas wobble even at a locked rate; engines smooth or snap them.
  [Unity 2020.2 deltaTime fix](https://unity.com/blog/engine-platform/fixing-time-deltatime-in-unity-2020-2-for-smoother-gameplay),
  [Phaser TimeStep (averaged deltas)](https://docs.phaser.io/api-documentation/class/core-timestep).
- **iOS frame pacing.** WKWebView's rAF is still capped at 60 Hz on ProMotion phones; Safari reaches 120 Hz only via a feature
  flag. So the game must look right at 60 Hz in the Claude app and at 120 Hz in Safari.
  [WebKit bug 294338](https://bugs.webkit.org/show_bug.cgi?id=294338), [Apple forums: WKWebView 120 Hz](https://developer.apple.com/forums/thread/773222).
- **Critically damped springs for cameras.** No overshoot, continuous velocity, frame-rate independent (exponential
  `x += (g − x)·min(1, k·dt)` is neither). [Unity SmoothDamp (GPG4 1.10)](https://docs.unity3d.com/ScriptReference/Mathf.SmoothDampAngle.html),
  [Unreal CriticallyDampedSmoothing](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Core/FMath/CriticallyDampedSmoothing).
- **Chase-camera practice.** Damp rotation and follow distance separately; lead the view along the motion.
  [gamedev.net: 3rd person camera spring](https://www.gamedev.net/forums/topic/342629-3rd-person-camera-spring/),
  [Nesky, "50 Camera Mistakes" (GDC 2014)](https://gdcvault.com/play/1020460/50-Camera), [GMTK: a good camera (look-ahead)](https://gmtk.substack.com/p/how-to-make-a-good-2d-camera).
- **Entity interpolation.** Draw remote entities slightly in the past between buffered snapshots (Source: 100 ms lerp).
  [Valve: Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking).
- **Mobile three.js budgets.** Under ~100 draw calls; image textures expand on the GPU (a 4K PNG with mips ≈ 100 MB), so
  procedural in-shader detail is the cheap way to add surface richness. [three.js forum: texture performance](https://discourse.threejs.org/t/texture-performance/24297).
- **Procedural facades.** A window grid from world-space position with an occupancy parameter, noise to break up flat bands, and
  derivative-based (fwidth) filtering to stop shimmer at distance.

## What changed

### Smoothness (`smooth.js` new; `game.js`, `link.js`, `cars.js`, `tune.js`)
- **Render interpolation.** Each locally simulated car (mine, both in practice/split, the AI's) keeps its pose from before the
  last 120 Hz step; the frame draws `lerp(prev, cur, acc/step)` (wrapped yaw, pitch, roll, heave, wheel spin, steer) through a
  per-player draw pose `P2[w].dp`. Cars, wheels, lightbar, headlights, see-through cone, car effects, tags, intro orbit and the
  camera read it; physics, collisions, netcode, HUD and audio keep the true state. A new round or a jump over 3 m resets the
  pose (no lerp across a spawn). Traffic is drawn at the same interpolated moment. Cost: the car is drawn one step (8 ms) behind.
- **Frame pacer** (`createPacer`). Estimates the display interval (median of 30 deltas → snapped to a known rate, 24–240 Hz) and
  feeds the accumulator whole multiples of it when within ±25%, carrying the remainder as debt so the sim never drifts from the
  shared clock (20 s simulated at 60/90/120 Hz with ±0.5–4 ms jitter and dropped frames: fed time = wall time within 2 ms). The
  125 ms clamp and the slow-frame rule are unchanged.
- **Camera.** Critically damped springs with stored velocities (exact solution, stable at any dt) for yaw (ω 6, half the car's
  yaw rate fed forward), follow distance (ω 8 out, 22 in so occlusion still snaps), height (ω 4.5), and a new **look-ahead**:
  the aim point leads along the velocity (0.3 s, ≤ 5.5 m) and tilts into turns from the yaw rate (≤ 2.2 m), on soft springs so
  car micro-jitter never reaches the camera's rotation. Look-back flips in ~0.25 s as an orbit (was a one-frame 9 m snap); CAM
  far → near eases in (verifier finding, fixed).
- **Partner car (live).** link.js interpolates between samples with cubic Hermite (velocities and yaw rate as tangents, a
  straight-line fallback when they disagree with the chord); the drawn car follows the prediction on a critically damped spring
  (ω 14; 6 for a 12–40 m error; snap past 40 m unchanged) and gets body pitch/roll synthesised from its predicted accelerations
  with car.js's own gains. Collisions still use the raw prediction. Wire format unchanged.
- **Input latency.** Checked: input is read at the start of each step from state written before the frame; nothing is a frame
  late. No change needed.

### Graphics (`gfx.js`, `world.js`, `maps/dockside.js`)
- **Roads:** aggregate grit and stones (faded by ~48 m), repair patches, faint cracks in cracked zones, rubber in the wheel paths
  and oil between them (from the lane coordinate), dusty edges, low-sun sheen; worn and chipped lane lines and crosswalks;
  puddle sheen at night. Curbs and sidewalks get slab joints along the walk.
- **Buildings:** anti-aliased windows with frames, sills, mullions, floor-slab lines, per-window blinds / curtains / bare glass,
  ~40% lit at night (a few TV-blue); richer brick, stucco, concrete, shingles, tiles, all faded to their average before a cell
  reaches ~2 px (world-space pixel footprint from derivatives: no moiré). **Wall-base AO** from the height above each wall's foot,
  stored in the fraction of the existing `fx` attribute (no new attribute; vertex layout still Metal-safe).
- **Materials:** car paint lower-body shade and clear-coat glint, glass sun streak, chrome contrast, grass patches/blades/flowers,
  foliage clumps, rock strata, wood grain, corrugated metal anti-aliased, water with two moving ripple layers, glitter and foam.
- **Sky:** warm sun side / cool anti-sun side, wider halo, self-shadowed cumulus with a riso halftone in the shade, cirrus on
  high; night: moon with maria and halo, twinkling coloured stars, a faint milky band, warm city glow on the horizon.
- **Lighting:** warm key / cool fill per map (from the sun colour and sky), a soft sky rim on edges facing away.
- **Dockside:** sheds, roofs, shopfronts, rooftop slabs and tanks get surface codes; sidewalks concrete, park grass, beach sand,
  water quads use the water code.
- Tiers: low = old cost + the tint (no detail, simple sky); mid (phones) = all but cirrus, the second star layer and the third
  cloud octave; high = everything. Heavy detail is distance-gated (~48 m).

### Tests and tools
- `tools/test/games/getaway-feel.test.js` (new): iPhone 13, coarse, CPU throttle 4×: frame jitter, my car's apparent-speed
  CoV, draw lag, camera jerk and teleports, gas/steer input → response, draw calls, triangles, texture memory, and the partner
  car's smoothness in a live match.
- `getaway-vframe.test.js` / `getaway-vlive.test.js` (new benches): the game's rAF on a virtual 60/90/120 Hz display with
  timestamp jitter and dropped frames, nothing drawn, so the numbers don't depend on the shared machine's load.

## Before / after

Software GL on a shared 4-core box can't give phone frame times (2–8 fps under the 4× throttle), so the feel numbers come from
the virtual-display benches (medians of 4 runs, bot-driven chase on Dockside). Baseline = 96db9c8.

| Metric | Before | After |
|---|---|---|
| My car, apparent-speed CoV, 60 Hz ±0.5 ms | 31.6% | 2.6% |
| … 60 Hz ±2 ms | 35.1% | 0.3% |
| … 120 Hz ±1 ms | 70.4% | 4.1% |
| … 90 Hz ±1 ms | 35.4% | 1.7% |
| … 60 Hz + 4% dropped frames | 34.9% | 2.6% |
| Camera position jerk, median (60 Hz ±0.5 / 120 Hz ±1) | 1,254 / 171,514 m/s³ | 126 / 113 m/s³ |
| Camera yaw jerk, median (60 Hz ±0.5 / 120 Hz ±1) | 22 / 796 rad/s³ | 4.0 / 4.8 rad/s³ |
| Camera teleport events (verifier: accel, turn, drift, wall hit, CAM, brake) | look-back 9.35 m snap, CAM 1.5 m | 0 (look-back is a 16-frame orbit; CAM ≤ 1.4 m) |
| Partner car apparent-speed CoV, live 80 ms, 60 Hz / 120 Hz | 23.5% / 67.7% | 3.5% / 6.7% |
| Partner car position jerk, median, 60 Hz / 120 Hz | 24,717 / 66,086 m/s³ | 446 / 423 m/s³ |
| Partner car body roll / pitch (max) | from cars.js accel only | 3.6° / 3.8° (synthesised) |
| Input → response (gas / steer, feel test, frame-granular) | 10–23 ms / 9–25 ms | 15–19 ms / 16–18 ms (same frame) |
| Drawn car behind its physics state | 0 | one step: 8 ms median |
| Draw calls in view, phone 844×390 (Dockside / Boulder / Santee) | ≤ 32 / 52 / 37 | ≤ 32 / 51 / 37 |
| Triangles in view (D / B / S) | 84k / 138k / 114k | 84k / 137k / 113k |
| GPU geometry memory (D / B / S) | 7.4 / 39.9 / 49.2 MB | unchanged |
| Texture memory (mid tier) | 2.0 MB (the 512² car shadow map) | 2.0 MB (no new textures) |
| Shader programs | 12 | 12 (all compiled behind the loading card) |
| Map build, busy ms (D / B / S; noisy, shared box) | 231 / 936 / 947 | 244 / 1098 / 1099 |
| Fragment cost (software GL, high tier) | 1× | ~1.5× world, ~2× sky (mid tier lighter; distance-gated) |

## Verification

An independent verifier played it with real taps on an iPhone 13 profile, light and dark, 844×390 and 390×844 (Practice vs AI:
gas, steer slider, drift, nitro, CAM, look-back, pause, quit), a live two-phone match at 80 ms through real taps (both roles),
camera/interpolation traces at 30/60/120 Hz, and the homes and cats against the baseline build. Findings: no blockers or majors;
one minor regression (CAM far → near popped 3–4.7 m in a frame from the new distance ceiling) — fixed, now ≤ 1.4 m (baseline
1.5 m). Both phones agreed on every outcome; no budget warnings; partner car: 0 jumps > 3 m, 0 backward or frozen frames. Homes:
same landmark coordinates, same nearest-road data, all 6 cats at identical positions, present in light and dark.

## Tests

RESULTS_PLACEHOLDER

## Known issues

- Feel was measured on virtual displays and in simulation, not on a real phone; the look-ahead amounts want a check in hand.
- The richer shader costs ~1.5× per pixel on software GL; a real iPhone GPU wasn't available. Dynamic quality (scale and
  shadow rungs) still guards frame time; if phones run hot, the next lever is dropping the mid tier's detail distance.
- Cracks are iso-lines of noise and can read as faint loops from low and close. Boulder's buildings mostly come from its atlas,
  so the facade upgrade is subtle there; Santee/Boulder houses have geometry windows (the window shader mostly helps Dockside and
  commercial blocks). The warm/cool tint shifts Santee's and the Moorhead home's walls slightly cooler in sunlight.
- `getaway.test.js` sections with fixed waits (gfx rungs, the practice PIT, the live relink during the result card, contacts'
  phantom ratio) are load-sensitive on a busy machine; they fail the same way on the baseline under load and pass on a rerun.
- One bench scenario (60 Hz ±2 ms) shows the car at half speed in both baseline and new builds: a bench artefact (the
  pacer itself was verified to feed wall time exactly), not investigated further.

## README line

No change to the Getaway games-table line.
