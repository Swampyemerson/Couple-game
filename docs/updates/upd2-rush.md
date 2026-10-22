# Rail Rush: upgrade 2 report (unit: rush)

Branch `claude/upd2-rush`, from `claude/relaxed-dijkstra-2cy8al` (96db9c8). Only rush files are touched:
- `js/games/rush/**`;
- `tools/test/games/rush.test.js` and the new `tools/test/games/rush-feel.test.js`;
- `docs/games/rush.md`;
- this report.

No shared files were edited. Saved data, track hashes (v1 and v2), the move/event encodings and the netcode messages are
unchanged.

How the work was run:
- **Research:** a Sonnet researcher, plus my own reading of the code.
- **Measurement:** a feel harness, `rush-feel.test.js`.
- **Build:** two Sonnet builders at high effort, with file ownership: one on feel (frame clock, network clock, camera,
  partner smoothing, dynamic resolution, a pacing bench), one on graphics (surface print, light rigs, effects).
- **Fixes:** one regression I found and fixed myself (see "Latency fix").
- **Verification:** an independent Sonnet verifier (real taps, both players, light and dark), then fixes.

## Research summary

WebFetch could not resolve hosts from this container, so the researcher worked from search results. Items marked *(k)* are
background knowledge that was not re-verified in this session.

- **Fixed timestep and interpolation.** Step the sim at a fixed dt from an accumulator, clamp long frames (~0.25 s) to avoid
  the spiral of death, and render prev→current with alpha = acc/dt
  ([Gaffer, Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/);
  [spiral of death](https://www.gamedev.net/blogs/entry/2262574-thoughts-on-fix-your-timestep-and-the-spiral-of-death)).
  Drive it from the vsync-aligned rAF timestamp rather than `performance.now()` read inside the callback: the callback start
  varies with input handlers and GC, and that variance shows up as uneven motion. Unity hit the same problem and fixed
  `Time.deltaTime` to follow presentation timing
  ([Unity 2020.2](https://unity.com/blog/engine-platform/fixing-time-deltatime-in-unity-2020-2-for-smoother-gameplay)).
  Snap dt to whole display periods when it is close to one *(k)*.
- **iOS frame pacing.**
  - **Default rate:** rAF on ProMotion iPhones defaults to ~60 Hz. Safari's feature flag "Prefer Page Rendering Updates near
    60fps" gates 120 Hz, and per [WebKit bug 294338](https://bugs.webkit.org/show_bug.cgi?id=294338) it doesn't apply to
    WKWebView.
  - **Low Power Mode:** caps rAF at 30 Hz, by design ([WebKit 215745](https://bugs.webkit.org/show_bug.cgi?id=215745)).
  - **Iframes:** cross-origin iframes can be held at 30 fps until the user interacts
    ([popmotion](https://popmotion.io/blog/20180104-when-ios-throttles-requestanimationframe)).
  - **So:** detect the period (30/60/120) instead of assuming it, and never treat a steady 33 ms cadence as "the GPU is too
    slow".
- **Input.** Act on `pointermove` past a threshold, not on release. Coalesced events improve sample accuracy, not delivery
  latency ([WebKit 210454](https://bugs.webkit.org/show_bug.cgi?id=210454)). Apply the input at the next sim step. Rush
  already did both.
- **Camera.** Exponential lerp, made frame-rate independent with `1 - exp(-k dt)`
  ([Freya Holmér, "Lerp smoothing is broken"](https://acegikmo.substack.com/p/lerp-smoothing-is-broken)), still has a
  velocity jump, i.e. infinite jerk, when its target steps, as on a lane change. A critically damped spring
  ([SmoothDamp](https://docs.unity.com/en-us/engine/6000.3/script-reference/unityengine/vector2/smoothdamp.md); GPG 4.4
  formula, [port](https://scrapbox.io/0b5vr/SmoothDamp);
  [Unreal CriticallyDampedSmoothing](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Core/FMath/CriticallyDampedSmoothing?lang=en-US))
  keeps velocity continuous and never overshoots.
- **three.js on mobile.**
  - **Draw calls:** they matter more than triangles. Merge static geometry and instance repeats
    ([summary](https://metadesignsolutions.com/blog/threejs-performance-optimization-best-practices)). Rush already does
    both.
  - **Texture memory:** count it decoded. iOS kills tabs at a device-dependent threshold, and small (256–512) textures are
    safe ([three.js forum](https://discourse.threejs.org/t/textures-in-gltf-sometimes-display-black-but-only-on-ios/30520)).
  - **Shaders:** pre-compile them and never toggle material features at runtime *(k)*.
  - **Precision:** keep large world coordinates out of mediump fragment math *(k)*.
- **Toon / riso stylization (cheap).**
  - Inverted-hull outlines are cheap and baked into merged geometry. Edge-detect post passes cost fill rate on mobile
    ([realtimevfx](https://realtimevfx.com/t/unity-outline-by-normals-for-mobile-game-urp/14919);
    [three.js OutlineEffect](https://threejs.org/docs/pages/OutlineEffect.html)).
  - Banded light, halftone in the shadow band, vertex or ground-contact AO, rim light, sprite glows instead of bloom, a
    gradient sky with offset cloud prints *(k)*.
  - A procedural texture built once at load beats per-pixel noise math *(k)*.

## Measuring: what the container can and can't tell

Headless Chromium's software GL renders 120–500 ms per frame here, even unthrottled; the JS work is only ~0.3–3 ms of each
frame. Live frame timing therefore says nothing about a phone. `tools/test/games/rush-feel.test.js` has two parts:

- **Bench part** (`__rush.pace()`, maths in `js/games/rush/bench.js`). It drives the real `frame()` (sim, logic, avatars,
  world sync, camera, HUD; no GL draw) with synthetic iPhone vsync timestamps at 60, 120 and 30 Hz:
  - callback delay of 0–3 ms, plus spikes;
  - 2 % missed vsyncs;
  - a swipe every 0.9 s at a random sub-frame time;
  - CPU throttled 4× (iPhone profile).

  `__RUSH_DEBUG.oldPacing` / `oldCam` switch the previous clock and camera back on, so before and after run on the same
  build.
- **Live part.** Two iPhone 13 pages on a real (mock) network with 80 ms latency, both throttled 4×. It measures:
  - real CDP touch swipes;
  - draw calls, triangles and texture memory;
  - JS work per frame;
  - the partner's judder.

## Before → after

### Frame pacing, camera, latency (bench, 4× CPU)

| Display | | frame-to-frame motion judder (RMS, in frames of advance) | camera lateral jerk RMS / peak (m/s³) | swipe → first visible move, mean / p95 (ms) | lane change on screen (ms) | camera teleports |
|---|---|---|---|---|---|---|
| 60 Hz | before | 0.16 | 6,763 / 38,948 | 26.0 / 32.4 | 130 | 2 |
| 60 Hz | after | **0** | **1,367 / 5,789** | 24.9 / 32.4 | 125 | **0** |
| 120 Hz | before | 0.289 | 18,066 / 151,679 | 14.9 / 24.2 | 113 | 0 |
| 120 Hz | after | **0** | **1,614 / 14,835** | **12.6 / 15.9** | 121 | 0 |
| 30 Hz (Low Power) | before | 0.092 | 2,854 / 11,346 | 47.6 / 64.8 | 148 | 13 |
| 30 Hz (Low Power) | after | **0** | **1,107 / 3,723** | 48.4 / 64.8 | 148 | **0** |

- **Camera.** It settles in ~275 ms with 0 overshoot. It moves 1 cm within the first 60 Hz frame after a swipe.
- **Judder.** "0" means each frame's drawn advance is exactly speed × frame interval, so no micro-stutter.
- **JS cost.** 0.3–1.1 ms per frame at 4× CPU.
- **Live phone page** (60 bench frames on the guest-synced shared clock): judder 0.068 → 0, camera jerk RMS 9,868 → 2,122,
  teleports 0.
- **Swipes in the live harness.** 12 of 12 real touch swipes showed on the runner within 1 frame (p95).

### Dynamic resolution (start 0.85)

| Cadence | before | after |
|---|---|---|
| Low Power Mode, rAF capped at 30 Hz | **0.55** (dropped to the floor for nothing) | 0.85 (refresh cap detected and held) |
| 60 Hz, every vsync met | 0.85 (could never climb: the old rule needed < 15.4 ms frames) | 1.0 |
| 120 Hz, every vsync met | 1.0 | 0.85 (holds; see Known issues) |
| 60 Hz, a third of vsyncs missed | 0.55 | 0.55 |

### GPU budgets (phone view, 14 s autopilot walk through all six districts, iPhone 13, light / dark)

| | before | after | budget |
|---|---|---|---|
| draw calls p50 / max | 18 / 19 | 18 / 20 (+1 while ambient motes draw) | ≤ 30 |
| triangles p50 / max | 38.5k / 42.9k | 38.5k (light), 39.3k (dark) / 43.0k (light), 45.8k (dark) | ≤ 60k |
| texture memory | 1.64 MB | 1.97 MB (+0.35 MB detail tile with mips) | ≤ 4 MB |
| chunk max vertices | 11.5k | 12.1k | ≤ 18k |
| shader programs | 10 | 11 (+`matLite`, warmed behind the loading screen) | unchanged after play |

Split screen, laptop only: 39 calls and 87–92k triangles, within the 50 calls / 120k laptop budget.

## What changed

### Feel
- **Frame clock (`game.js`: `pace`, `detectPeriod`, `frame`).**
  - **Time source:** the sim and camera now run on a clock built from the vsync-aligned rAF timestamp, mapped onto the
    shared clock by `link.at()`.
  - **Period detection:** the low quartile of recent intervals, snapped to 8.33 / 11.1 / 16.67 / 33.3 ms, switching only
    after 3 agreeing checks.
  - **dt snapping:** an interval within 15 % of whole periods advances by exactly that many periods.
  - **Drift and resync:** a 3 %-per-frame drift corrector keeps it on real time. Gaps over 250 ms, pauses and returning
    from the background resync it, and it never goes backwards.
  - **Presence stamps:** samples are stamped with the sim-step instant.
- **Latency fix (`advance`).** Plain floor-stepping plus interpolation always draws the runner one sim step (8.3 ms) late. At
  120 Hz that is a whole frame of extra swipe latency, which the bench caught after the first build. The sim now leads the
  clock by less than one step and the picture interpolates back to the frame's exact time. 120 Hz swipe latency is now
  12.6 ms mean, from 14.9 before and 21.5 in the first build.
- **Guest clock (`link.js`).** The offset to the host clock used to jump by up to 12 ms at once while running, and each
  jump jolted the sim. It now slews at ≤ 0.05 ms per ms, monotonic. It still snaps before the run and on errors over 40 ms.
- **Partner runner (`updateRemoteRS`).** z advances by speed × elapsed every frame and blends toward the network target with
  a 0.25 s time constant, snapping over 3 m. The ghost marker, name tag and Brawl lag compensation are unchanged.
- **Camera (`fx.js` `createRig`, run mode).** Critically damped springs replace the exponential follow:
  - lateral x: two in series, 0.025 s then 0.09 s;
  - height: 0.18 s;
  - roll: 0.14 s.

  Shake, FOV kick, crash punch and the other modes are unchanged.
- **Dynamic resolution (`track`).**
  - **Judging:** missed vsyncs are counted against the detected period instead of an absolute 18.4 ms.
  - **Refresh cap:** a steady 33 ms cadence that doesn't improve when resolution drops is a refresh cap, so the scale is
    restored and held.
  - **Recovery:** it climbs back after 4 s under 3 % missed, and won't return to a scale that just failed for 60 s.
- **Input.** No change was needed: a swipe fires inside `pointermove` and applies to the runner at once.

### Graphics and textures
- **Surface print (`gfx.js`).**
  - **The texture:** one procedural 256×256 tile, built at load in ~10 ms. Its four channels are brick, boards or
    corrugation, cobbles or paving, and paper grain.
  - **Mapping:** world-space UVs are baked per vertex (box-projected from the face normal; rails by distance) and kept small
    for mediump. A material id rides in the existing `fx` attribute (`code + 16 × material`), so every old fx code still
    reads the same.
  - **How it prints:** like a riso ink layer over the colour, light linework at night. Paper grain is on most surfaces.
  - **Cost:** one texture fetch per world fragment. Coins, barriers, gates, particles and runners skip it, so obstacles
    stay crisp against the textured world.
- **Materials per district (`world.js` `buildChunk`, `bio.js`).**

  | District | Materials |
  |---|---|
  | Downtown | brick low-rise, block towers |
  | Harbour | plank quay and boats, corrugated sheds and containers, rippling water |
  | Greenway | hatched lawns, ribbed bark, brick cottages |
  | Old Town | brick and stucco, cobbles |
  | Neon Market | paving, planked stalls |
  | Freight Yard | gravel, rust corrugation |

  - Everywhere: a ballast-gravel track bed, glinting rails, concrete parapets and tunnels, panel-seamed trains.
  - Materials are chosen from numbers the scenery already draws, so the scenery hash streams and both phones' worlds are
    unchanged.
- **Light rig per district (`world.js` `applyLight`, `bio.js` `lightRigs`).**
  - **What it sets:** sun direction, ambient / sky / key strengths, and split toning, i.e. a warm key over a district shadow
    tint instead of plain darkening.
  - **Per district:** Harbour golden hour with cool shadows, Greenway soft green, Old Town warm afternoon with violet
    shadows, Neon Market purple dusk, Freight Yard hazy rust.
  - **Cost:** blended at zone boundaries with the sky and fog. Uniforms only, quantized, no recompiles.
  - **On walls:** contact AO darkens wall feet.
- **Effects.**
  - Rim light on the runners in their player colour.
  - Night light pools under lamps, stalls and flood masts, baked into the chunk mesh.
  - Rail glints.
  - Animated harbour ripples.
  - A cloud layer per district: a body plus an off-register copy, drifting.
  - **Ambient motes per district:** Harbour spray and gulls, Greenway leaves and petals, Old Town confetti, Neon lantern
    sparks, Freight embers. There are 28 per viewer, they use the existing particle mesh, allocate nothing, and are off with
    reduced motion.
- **Quality valve.** Below ~20 fps for 2.5 s, world meshes swap to the print-free variant; it switches back after 6 s over
  ~38 fps. Phones at 30–120 fps never reach it. `__RUSH_DEBUG.detailOn` pins the print on.

Screenshots (before / after, all six districts, light and dark, same positions):
`scratchpad/gfx/before/*.png` and `scratchpad/gfx/after/*.png` in the session scratchpad. They are not committed.

## Verification

An independent Sonnet verifier ran at 570b61c. It used two iPhone 13 pages, real CDP touch swipes and `page.tap()`, in light and
dark, plus laptop split screen. It found **no blockers and no majors**.

**What passed:**
- **Modes:** all four start by taps, and the guest follows the host's mode live.
- **Input:** swipes in all four directions work on both phones in every mode. The page never scrolls. Pause, resume,
  settings, the menu sticker, the note chip and the weapon slot all respond to taps.
- **Districts:** all six were shot at the gate and mid-zone, on both phones, light and dark. Obstacles and coins still pop
  against the print. There were no black faces, seams, z-fighting, mis-coloured night scenes, or particles over the track.
- **Mirror twist:** still swaps left and right.
- **Pause and background:** pause, page hidden and the partner leaving or coming back all resume with no jump in the run.
- **Rematch:** works twice in a row, still 11 programs.
- **Abuse:** 80 rapid swipe pairs and swipes during a crash all registered, with no exceptions.
- **Landscape:** 667×375 and 844×390 during a run were clean.
- **Errors:** no page, shader or WebGL errors.
- **Budgets:** phone 17–22 calls and ≤ 43.6k triangles. Split screen 43–44 calls and 99–105k triangles. Programs stayed equal
  to the warm-up count after every event.

**Two minor items came from this diff, and both are fixed:**
1. The camera spring capped its per-frame step at 0.1 s, so on a very slow page (≥ 0.5 s frames) the camera took ~1.6 s to
   settle. The cap is now 0.25 s, the same as the sim's (`fx.js` `createRig`).
2. When the partner crashed, the drawn partner glided ~2 m backwards, because the dead-reckoning lead was dropped and the
   smoothing pulled them back. While the partner isn't running, the drawn z now holds instead of moving back
   (`updateRemoteRS`).

**Not from this diff, and left alone** (listed under Known issues): a theme switch in the lobby doesn't recolour the 3D world
until the next mount; the engine's end card in landscape needs a scroll to reach Rematch; on a first run, the tutorial label
sits under the countdown digit.

## Tests

TESTS_PLACEHOLDER

## Known issues

- **Motion artefacts are unchecked on a device.** Texture shimmer, moiré or swimming in motion couldn't be judged here
  (2–8 fps software GL, so only stills were reviewed). The tile is mipmapped with anisotropy 4. Check it on an iPhone.
- **120 Hz resolution.** A 120 Hz phone now holds its start scale of 0.85 instead of climbing to 1. The new rule only climbs
  after 4 s under 3 % missed vsyncs at the detected period, and the bench's 120 Hz case doesn't climb. This is a deliberate
  margin for a GPU running twice as many frames. The old rule reached 1.0 there, and 60 Hz phones now reach 1.0 where they
  couldn't before.
- **Quality valve in the container.** The valve trips in this container (software GL at 2–8 fps), so test screenshots in
  `SHOTS` show the light rigs, AO and sky but not the surface print. Set `__RUSH_DEBUG.detailOn = true` to pin it on.
- **Night light pools** are plain stepped discs and read slightly beige. Old Town and Downtown only get lamp light from the
  gantries.
- **Pre-existing, not touched:**
  - A theme switch while in the lobby doesn't recolour the 3D world; the palette is read at mount.
  - The engine end card's Rematch button is below the fold at 667×375, but reachable by scrolling.
  - On a first run, the "Swipe left or right" tutorial label sits partly under the countdown digit.
- **Live-part numbers are environment-driven.** Live frame times and judder in `rush-feel.test.js` swing with machine load.
  Only the bench part is asserted for pacing.

## README line

No change needed. The games-table line for Rail Rush still describes the game.
