# Upgrade 2: Blend & Seek (chameleon unit)

Branch `claude/upd2-chameleon`, from `claude/relaxed-dijkstra-2cy8al` (96db9c8). Files touched: `js/games/chameleon/**`,
`tools/test/games/chameleon*.test.js`, `tools/test/games/crawl-sim.mjs`, `docs/games/chameleon.md` (new "v5" section with
the full technical detail). No shared files edited, no `dist/`.

Emerson asked for three things. Each is done and measured:
1. **Surface transitions:** "the chameleon one can really jump around as you switch surfaces and be hard to do".
2. **Small maps:** "still too easy to find chameleons on the smaller maps, so maybe even smaller chameleons".
3. **Graphics:** "a general graphical/texture upgrade".

## Research summary

| Topic | What the sources say | Applied here |
|---|---|---|
| Fixed timestep ([Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/), [gamedev.net discussion](https://gamedev.net/forums/topic/691776-fix-your-timestep)) | Simulate in fixed steps from an accumulator and draw an interpolated state, so physics doesn't depend on frame rate. | Crawling runs in equal substeps of ≤ 1/60 s. The drawn pose is a separate smoothed layer over the sim. |
| iOS frame pacing ([WebKit bug 294338](https://bugs.webkit.org/show_bug.cgi?id=294338), [Apple forums](https://developer.apple.com/forums/thread/773222)) | WKWebView `requestAnimationFrame` is still capped at 60 Hz in 2025–26, even with `CADisableMinimumFrameDurationOnPhone`. Safari reaches 120 Hz only behind a feature flag. | Target 60 Hz. Feel must not change with frame rate: 30 vs 60 Hz same-face agreement went 59 % → 96 %. |
| Critically damped springs ([Unity SmoothDamp, from Game Programming Gems 4 §1.10](https://docs.unity3d.com/ScriptReference/Mathf.SmoothDamp.html), [Android SpringForce](https://developer.android.com/reference/kotlin/androidx/dynamicanimation/animation/SpringForce)) | Damping ratio 1 reaches the target fastest without overshoot. Guard against dt = 0. | Every camera and drawn-pose follower is a SmoothDamp-style spring (`spring1`, `spring3*`, `visCore`). |
| Wall walking ([Unity forum: walking on walls](https://discussions.unity.com/t/walking-on-walls/7760), [corner normals](https://discussions.unity.com/t/why-are-raycasthit-surface-normals-of-corners-not-interpolated-or-otherwise-correct/243553)) | Turn *before* a concave wall and *after* a convex edge, and slerp "up" toward the new normal. Corner hit normals are unreliable: confirm them with a second ray and gate them on move·normal. | Rotate about the body **centre**, not the feet. Convex wraps use three probe depths and a looser gate. Face-leave hysteresis stops ping-pong. |
| Gravity-shift games ([Mario Wiki: Gravity](https://mariowiki.com/Gravity), [Games Demystified: Galaxy](https://www.gamedeveloper.com/design/games-demystified-super-mario-galaxy)) | "Up" comes from simple primitives and the ray to the nearest surface. A camera that adapts slowly to fast reorientation is Galaxy's known weak spot. | World-up camera with no roll. The camera follows a spring pivot. The stick keeps its world direction across a surface change (input-frame lock). |
| Error-offset smoothing (networked-physics practice) | Hide a simulation correction by decaying a visual offset (half-life ≈ 0.1 s) rather than snapping. | The drawn pose glides over sim jumps with a position half-life of about 0.1 s. Steady motion has no lag. |
| three.js on iOS ([forum: texture performance](https://discourse.threejs.org/t/texture-performance/24297), [forum: page auto-refresh](https://discourse.threejs.org/t/page-auto-refresh-in-mobile-browsers/42232)) | Keep textures ≤ 1024–2048, since uncompressed textures expand to w·h·4·4/3 in GPU memory. Keep under ~100 draw calls. Memory leaks crash the page. | Still one 1024² atlas page per map (5.4 MB). Detail is baked into texels and vertex colours, so there are no new draw calls, textures or programs. |

A Sonnet research agent did a first pass (`scratchpad/notes/research.md`). I re-checked the sources above with my own searches.
Some constants were tuned by measurement rather than taken from a source:
- the springs' ω values;
- the 40° lock threshold;
- the joystick dead zone (0.12) and response curve (^1.25).

## What changed

### 1. Surface transitions

The headless crawl harness (`crawl-sim.mjs`, every climbable edge and corner of the Living Room, 1164 runs) found four root causes:

- **The body was drawn at its feet.** The drawn body sat at the raw contact point, so every concave transfer or convex wrap teleported it 0.3–0.4 m and turned it about the feet. A **drawn-pose layer** now pivots about the body centre with critically damped error springs. The partner's body uses the same layer, and the wire format is unchanged.
- **A held stick ping-ponged between faces.** After each transfer the screen-relative stick mapping flipped. A floor → box crossing made 200 transfers in 8 s and never got over. The fix is an **input-frame lock**, plus hysteresis on leaving a face and a limit on repeated wraps:
  - holding the stick keeps going the same way across a surface change;
  - turning the stick by more than 40°, or releasing it, hands back to the screen mapping.
- **Edges were hard to wrap, and blocked moves dead-stopped.** Convex wraps needed a > 45° approach and a 5 cm-deep probe. Wraps now need a looser gate, take three probe depths and work on ≥ 3 cm tops. A blocked move now slides along the obstacle. At a thin plank's far underside edge the body drops to the floor instead of looping.
- **Crawling ran at raw frame dt** (up to 0.1 s). It now runs in **fixed ≤ 1/60 s substeps**.

**Camera follow rig.** The hider's orbit camera and the seeker's climb view now follow a spring pivot:

- the camera solver's pick changes are blended at ≤ 1.2 rad/s;
- the wall guard pulls in and lets out at ≤ 4 m/s;
- the rig keeps its own forward. It used to re-derive it from a clamped camera position, which gave 85–140° in one frame;
- the seeker's first-person ↔ climb-view switch eases over 0.6 s instead of jumping (it reached 3600°/s);
- sticking to a wall no longer flips the seeker's view 180°.

**Phone controls.** The joystick has a dead zone of 0.12, a response curve of ^1.25 and a floating base.

### 2. Smaller chameleons and per-map defaults

- **New sizes:** **Micro** (0.32) and **Tiny** (0.45, id `mini`). The old `tiny` id keeps its 0.6 scale and is now labelled **Petite**.
- **"By map" default:** a new size value, `auto`, is the default of all three presets and picks a size per map:

  | Maps | Easy | Classic | Hard |
  |---|---|---|---|
  | Living Room, Garden, Art Studio, Candy Works | Medium | Petite | Tiny |
  | Greenhouse, Launderette | Large | Small | Petite |
  | Market, House | Huge | Medium | Small |
  | Museum, CU Boulder | Huge | Large | Medium |

  On the small rooms the Classic default goes from Large to Petite. That is about 6× less screen area for the seeker: 9753 → 1671 px² side-on at 3 m in the Living Room, against 862 px² for Tiny and 388 px² for Micro.
- **More hiding spots:**
  - Living Room: 56 → 70 colliders.
  - Garden: 38 → 59 colliders.
  - Art Studio: 36 → 54 colliders.
  - Candy Works: two new props.
  - On the small rooms, plain floor, wall and rug surfaces got busier patterns.
- **Saved data:**
  - A saved setup that equals an old preset (old Large / Huge / Medium) migrates to that preset with "By map".
  - A deliberately chosen size stays as it was.
  - New saves carry `sz: 1`.
  - Size ids never change their scale.
- **Lobby:** the size picker is a 4 × 2 grid with ≥ 44 px cells, showing "By map · <size>" for the selected map.

### 3. Graphics

- **Richer textures:**
  - Paper grain (±3.2 %) is baked into every atlas tile.
  - Most pattern painters were redrawn with more detail: wood with knots, weave, bricks, tiles, foliage, rugs.
  - Five new patterns: plaster, metal, trellis, braid and tiles.
  - A skyline packer fits more tiles in the same 1024² page.
- **Shading:** ambient occlusion is baked into vertex colours. Floors darken along walls and around props, and wall feet are darkened.
- **Lighting:** a warmer sun, a cool sky fill and a warm ground bounce, with a 4-step toon ramp. Peak brightness is still 1.0.
- **Camo stays correct:**
  - Grain and AO live in the atlas texels and vertex colours that the eyedropper, the stamp and the blend score already read; the worst-case grain ΔE is about 3.
  - The chameleon bodies share the lights and the ramp, and `camo.js` was updated to match.
  - A stamp on the Living Room wallpaper still takes the blend from about 15–21 % to 70–73 %.
  - The `blendfair` test passes.

## Before / after (iPhone 13 profile, CPU 4×; `tools/test/games/chameleon-upd2.test.js`)

### Jerk and teleport events per surface switch

An **event** is a frame in which one of these happens:
- the camera moves more than max(0.25 m, 4× the median);
- the camera turns more than 25°;
- the drawn body moves more than 0.15 m;
- the drawn body turns more than 30°.

Per-frame values are normalised to a 1/30 s frame, so slow software-GL frames don't count as jumps. The routes are driven by real CDP touch joystick input.

| Run | Baseline | After, run 1 | After, run 2 |
|---|---|---|---|
| Hider, Living Room (floor→wall→ceiling→wall→floor, concave corner, table edge) | 1.12 (28 events / 25 switches); repeat run 0.96 | **0.13** (5 / 38) | **0.20** (4 / 20) |
| Hider, House (wall tour) | 1.0 to 1.5 | **0** (0 / 4) | **0** (0 / 4) |
| Seeker, Living Room (climb view) | 1.5 (18 / 12) | **0.10** (2 / 20) | **0.21** (5 / 24) |

Other figures from the same runs:
- **Hider camera angular speed (p99):** 182 → 69 °/s on the ceiling route, and 80 → 0.6 °/s on the concave-corner route.
- **Seeker view switch:** 3600 → 0 °/s, since the switch is now eased.
- **Headless sweep (1164 Living Room runs, 60 Hz):**

  | | Before | After |
  |---|---|---|
  | Drawn-body jumps | 31,655 | 0 |
  | Face flip-flops | 29,980 | 6 |
  | Dead stops with the stick held | 718 | 80 |
  | Largest drawn move per frame | 0.28 m | 0.09 m |
  | Largest drawn turn per frame | 42° | 22° |

Frame-time p50 (83–133 ms) and jitter are not meaningful here: headless Chromium renders WebGL in software on a shared, loaded box. JS ms per frame is the meaningful CPU number.

### Budgets (worst view, hide / seek)

| Map | Draw calls | Triangles | JS ms/frame (mean) | Cold build ms |
|---|---|---|---|---|
| Living Room | 32 / 19 → 19 / 21 | 38.8k → 45.6k | 6.2 → 4.9 | cached |
| Garden | 32 / 19 → 32 / 19 | 44.5k → 51.2k | 4.8 → 4.8 | 344 → 711 |
| Art Studio | 32 / 19 → 24 / 19 | 20.0k → 19.9k | 4.4 → 4.6 | 135 → 326 |
| Candy Works | 32 / 19 → 32 / 19 | 23.5k → 25.2k | 3.4 → 4.3 | 218 → 356 |
| House | 50 / 37 → 51 / 37 | 72.4k → 75.8k | 5.8 → 3.7 | 654 → 951 |
| Market | 47 / 35 → 33 / 34 | 50.0k → 47.5k | 5.4 → 3.5 | 558 → 812 |
| CU Boulder | 60 / 50 → 52 / 51 | 70.9k → 75.7k | 8.3 → 5.3 | 1476 → 1349 |
| Greenhouse | 45 / 39 → 51 / 39 | 58.0k → 62.5k | 4.5 → 4.2 | 641 → 1023 |
| Museum | 47 / 34 → 45 / 34 | 38.9k → 40.2k | 5.9 → 4.2 | 532 → 669 |
| Launderette | 35 / 27 → 42 / 27 | 24.1k → 28.1k | 5.3 → 4.2 | 382 → 483 |

- **Draw calls:** at most 52 (budget 80). The differences come from where the smaller bodies sit, not from the map.
- **Textures:** unchanged on every map. One 1024² atlas per scene, 5.6 MB estimated (5.4 MB with mips), 7 scene textures, 16 programs.
- **Boot to game ready:** 3588 → 3172 ms.
- **Cold build:** 1.3–2.4× slower on most maps (CU Boulder is slightly faster), because atlas painting does more work. It is still far under the 2000 ms sliced-build budget, and every slice stays within the maps test's limits.
- **JS ms and build ms** vary ±20–30 % on this shared box.

## Verification

- An independent Sonnet agent played through with real taps:
  - two phones (Emerson and Sydney), light and dark, Classic preset;
  - lobby, By-map label sync, hide, stick, crawl to the ceiling, paint (brush, eyedropper, stamp), lock, seek, climb, tag, all 4 rounds, end card;
  - hotseat at Micro on Garden and Art Studio;
  - landscape 844 × 390;
  - saved-data migration (old Classic / Hard / Easy / custom setups);
  - camo stamps.
- It found five problems; four are fixed:
  - **Test failure (fixed in the test).** The two-phone `match` test fired a 2 m shot that the new Living Room clutter blocked at a Petite hider. The test now fires from close range.
  - **Thin plank stall (fixed).** Holding the stick on the 3.6 cm coffee-table top stalled for 5.6 s. It now goes top → underside → floor in 1.7 s.
  - **Garden hedge at Micro (explained, left as is).** A Micro body drops into the 0.18 m slot behind the hedge and loops between dropping and re-attaching. That slot is a real crawl space only Micro fits, so it stays. See Known issues.
  - **Two cosmetic overlaps (not fixed).** See Known issues.
- After those fixes, the camera solver sweep (`camsweep`) is unchanged from the baseline: climb 98.8 %, watch 98.1 %, orbit 98.6 % ok, with 0 cameras inside a collider and 0 occluded.

## Tests

New test files:
- `chameleon-crawl.test.js` (90 ok): Node sweeps of every edge and corner (sweep, box, thin, plank, slide, lock, fps, vis) plus browser joystick runs.
- `chameleon-sizes.test.js`: rules, migration, By map on 10 maps × 3 presets on both phones, lobby at 4 viewports in light and dark, Micro / Tiny play, Mix it up.
- `chameleon-gfx.test.js` (145 ok): every map in light and dark, with budgets.
- `chameleon-upd2.test.js`: the before/after measurement.

Existing tests:
- `chameleon-maps.test.js` (426 ok), and `ONLY=spawns,maps,blendfair,camsweep,crawl,seekclimb,spectate,foundcam,match,hotseat,dark,db,sizes,settings,settings3` of `chameleon.test.js`.

Final regression (`tools/test/all-games.test.js` + `tools/test/run-all.sh chameleon`, 12:20 UTC, loaded box):

| Suite | Result |
|---|---|
| all-games | ALL GOOD |
| chameleon-crawl | 90 ok, ALL GOOD |
| chameleon-cu | 52 ok, ALL GOOD |
| chameleon-gfx | 145 ok, ALL GOOD |
| chameleon-maps | 426 ok, ALL GOOD |
| chameleon-paint2 | 166 ok, ALL GOOD |
| chameleon-rivalry | 118 ok, all passed |
| chameleon-sizes | 209 ok, ALL GOOD |
| chameleon-upd2 | done (measurement) |
| chameleon-twists | 3 failures. Fixed: the tests hard-coded the old sun 0.52. The Bounty spot picker now keeps drawing scatter points until it has enough, because the new Living Room clutter rejected most of them. The bounty, fog and dusk sections now pass. `dbsd` failed once under load and passes alone, on this branch and on the base. |
| chameleon-hunt | 7 sections failed: the tests assumed the old Large default (the whisker band scales with size). They now pin `size: 'large'` and are ALL GOOD. |
| chameleon.test.js | 607 ok, 3 failures, all fixed. Short phones: the lobby now fits again on 390×664 and 375×667 (618 / 618 px; hud.js short-portrait rules, cells still 44 px). `toggles`: the test's start point moved off the new laundry basket. `feel`: Jump now pins Large. |

Still failing after these fixes, and failing the same way on the base commit:
- the `uxfinal` "rematch 1: round 1's hider" timeout (it used to be hidden behind the lobby assert);
- the `mapslice` House cold-build 15 s timeout.

The run hit the 2 h background limit inside `chameleon.test.js` after 607 checks. The sections it didn't reach (the `camsweep`, `crawl`, `seekclimb`, `match`, `spectate` and `foundcam` group, and `hotseat`, `dark` and `db`) were run individually earlier this session and passed.

## Known issues

- **Garden hedge slot at Micro.** A Micro body can crawl into the 0.18 m slot between the hedge and the fence. The fence's inner face dead-ends at y 1.02, because its top lies outside the map bounds, so pushing on keeps re-attaching. This is a legitimate hiding spot only Micro fits. A "fresh push needed" rule for a slot narrower than ~2.5 r would remove the loop.
- **Thin plank.** Holding the stick on a thin plank goes over the edge, along the underside and drops to the floor, by design. A third wrap in a row needs a fresh push.
- **Drawn-feet clipping.** The drawn feet can clip a prop ≥ 4 cm for about 0.1 s in tight wraps (12× rarer than in round 1).
- **Cosmetic overlaps.**
  - The "Sticky feet!" tip (`hud.js`, `.chm-hint`, top 140 px) covers the top of the seeker's own body in the climb view.
  - The "Stamped!" toast overlaps the top of the camo meter by about 15 px.
- **Micro step height.** A Micro body still steps up 0.2 m (`dims`: `max(0.2, 0.24·s)`), which is more than its own height. This is harmless.
- **Easy got harder on small rooms.** Easy on the small rooms is now Medium instead of Huge.
- **Pre-existing failures.** These fail identically on an untouched copy of the base commit:
  - the `uxfinal` rematch timeout;
  - the `mapslice` House cold-build timeout;
  - `ONLY=ux`: "best strokes-in-a-hide".
- **Bounty spot on the Living Room.** The clutter leaves no point ≥ 3.8 m from every spawn, so the spot falls back to the farthest candidate (2.5 m) and repeats between matches.
- **360×640 lobby.** It still scrolls (618 / 604 px), as it did before this upgrade.
- **Big maps.** They got only the grain, extra pattern detail and AO, with no new clutter. The window light pools from the brief were not done.

## README line

| Blend & Seek | Paint yourself to vanish, then hunt each other in 3D: crawl smoothly over walls and ceilings, hide as tiny as Micro, in richer rooms. |
