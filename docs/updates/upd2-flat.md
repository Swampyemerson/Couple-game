# Upgrade 2: flat unit (2D/DOM games)

Scope: four, dots, ultimate, fleet, wordduel, agents, doodle, wave, hockey, quickdraw, cycles, defuse, plus the shared
`games.css` kit and `js/games/covers.js`. The goal was smoothness, juice, a riso print texture upgrade, and netcode smoothness for the
three real-time games (hockey, quickdraw, cycles). No rules, move encodings, saved data or hidden behaviours changed.

## Research summary

- **Fixed timestep and render interpolation.** Step the simulation in fixed dt chunks from an accumulator, then render by
  interpolating between the previous and current states with `alpha = acc / dt`. Rendering the latest step directly causes
  visible stutter whenever the frame rate and the step rate beat against each other.
  ([Fiedler, Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/);
  [GameDev.net discussion of common mistakes](https://gamedev.net/forums/topic/714764-fixed-timestep-with-interpolation-2d-movement-jitterstutter))
- **Entity interpolation and client-side prediction.** Draw other players slightly in the past, between two known snapshots
  (our `net.remoteInto` at `now - delay`). Predict your own avatar locally and reconcile without snapping: blend the error away.
  ([Gambetta: Prediction & Reconciliation](https://gabrielgambetta.com/client-side-prediction-server-reconciliation.html),
  [Entity Interpolation](https://gabrielgambetta.com/entity-interpolation.html),
  [live demo](https://www.gabrielgambetta.com/client-side-prediction-live-demo.html))
- **Frame pacing on iOS.** By default `requestAnimationFrame` in WKWebView is still capped at 60 Hz, even on ProMotion devices
  (WebKit bug 294338 is still open). Safari itself can reach 120 Hz with a feature flag, and some iOS 26 web apps report 120 fps. So
  every animation has to be frame-rate independent: use real dt, clamp it, and smooth with `1 - exp(-k·dt)` instead of a fixed
  lerp per frame.
  ([WebKit 294338](https://bugs.webkit.org/show_bug.cgi?id=294338), [Apple forums: WKWebView 120 Hz](https://developer.apple.com/forums/thread/773222),
  [Ionic forum](https://forum.ionicframework.com/t/ios-limited-to-60hz-any-way-to-get-120hz-on-promotion-displays/247000))
- **Compositor-only animation.** Animate only `transform` and `opacity`. Use `will-change` sparingly, since layers cost memory.
  Never read layout after writing styles in the same frame.
  ([web.dev animations guide](https://web.dev/articles/animations-guide),
  [Stick to compositor-only properties](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count))
- **Input latency for drawing.** `getCoalescedEvents()` recovers the pointer samples that the browser merged between frames,
  which gives smoother strokes. Feature-detect it and draw in rAF. Prediction APIs can cover the remaining gap.
  ([Chrome: aligned input events](https://developer.chrome.com/blog/aligning-input-events),
  [W3C Pointer Events TPAC 2023](https://www.w3.org/2023/Talks/TPAC/pointer-events))
- **Smoothing.** Critically damped springs and half-life smoothing follow a target without overshoot, independent of frame rate.
  ([Unreal CriticallyDampedSmoothing](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Core/FMath/CriticallyDampedSmoothing))
- **Juice.** Use it in small doses: hit-stop of 50–100 ms on heavy hits, short small screen shake (0.1–0.3 s), squash and stretch,
  stacked feedback (motion + sound + particles). ("Juice it or lose it", Jonasson & Purho 2012, summarised in
  [Wayline game feel course](https://www.wayline.io/learn/game-feel/1) and
  [eastondev on feedback](https://eastondev.com/blog/en/posts/dev/20260521-game-feedback-feel/))
- **Print texture on the web.** Grain comes from an SVG `feTurbulence` noise tile at low opacity (about 0.03–0.12 effective).
  `feTurbulence` is CPU-rendered, so it is rasterised once as a static tile and never animated. Riso misregistration is a small
  offset of one colour plate.
  ([CSS-Tricks grainy gradients](https://css-tricks.com/?p=351302),
  [freeCodeCamp grainy backgrounds](https://www.freecodecamp.org/news/grainy-css-backgrounds-using-svg-filters/),
  [Advanced Risograph Techniques](https://jonathanstephens.us/play/riso/))

## Measuring

`tools/test/flat-perf.js` (new, not in run-all) runs on the iPhone 13 profile with the CPU throttled 4× through CDP. It starts each
game and taps random things on the stage for 8 s while recording rAF frame deltas, long tasks, and Chrome's layout and
style-recalc counters. Headless Chromium has no GPU, so canvas fill costs look worse than on a phone. Compare the before and after
numbers rather than reading them as absolutes.

### Baseline (HEAD before this unit)

```
game        fps   p50   p95   p99   max  jank%  long  lay/s  layms/s  style/s  js ms/s
four        52.9  16.7  16.8 116.6   167   4.1     9  58.9  40.3  66.2  40.8
dots        58.2  16.7  16.7  16.8   150   0.8     1     4   7.8  68.2  34.8
ultimate    57.5  16.7  16.8  33.4    50   3.2     0   5.1  22.2  72.2  39.1
fleet       59.1  16.7  16.7  16.8   100   0.2     1   0.2   8.2  59.9  22.2
wordduel    59.5  16.7  16.8  16.8    33   0.2     0   0.2   2.6  60.3  17.6
agents      59.5  16.7  16.7  16.8    50   0.2     0   0.2   2.1  60.3  20.4
doodle      59.3  16.7  16.8  16.8    67   0.2     1   0.5   4.2  60.3  18.8
wave        59.3  16.7  16.8  16.8    50   0.2     0   0.4   3.5  60.3  17.3
hockey      21.1    50  66.8 116.7   200  94.2    37   0.7   7.7  22.3  77.7
quickdraw   58.7  16.7  16.8  33.3    67   1.1     1  20.1    47  66.7  26.9
cycles      51.1  16.7  33.4  50.1   133  12.4     2   7.9  18.4  58.4  78.5
defuse      59.4  16.7  16.8  16.8    33   0.2     0   5.7    14  74.5  30.7
```

## Shared kit (games.css, covers.js)

- **Paper and print textures:**
  - `--g-grain` is a static 180 px `feTurbulence` noise tile, rasterised once and tiled. It is very light: 0.22 opacity of sparse specks on paper, 0.16 on black stock.
  - The game-room background, `.g-panel`, end cards, sheets, the curtain, the wait card and cover boxes now carry the paper tooth.
  - New tokens: `--g-halftone-a` and `--g-halftone-b` (halftone in a player's ink), `--g-misreg` (pink and blue plates a hair off register, for big display type only), and the easings `--g-ease-out`, `--g-ease-spring`, `--g-ease-snap`.
  - New classes: `.g-paper`, `.g-grain`, `.g-misreg`, `.g-shade-a` and `.g-shade-b`. One-shots `.g-ink-in`, `.g-shake` and `.g-pop`; a looping `.g-pulse`. Keyframes `g-ink-in`, `g-shake`, `g-pulse`, `g-pop`, `g-wipe` and `g-reg`.
  - Every animation is transform/opacity only and switches off under `prefers-reduced-motion`.
- **A global idle cost removed.** The hub's "partner is here" dot blinks forever, and the hub stays in the page under an open game. That caused about 60 style recalcs per second in every game, even when idle. The blink now stops while a game is open (`body.gm-open`).
- **Covers:** the 12 flat games' covers were reprinted with more deliberate halftone shading, an off-register second plate on key shapes and ink overprint, plus a small heart motif per game. The compositions are the same. The 3D games' covers are untouched.

## Per game

Every game keeps its rules, move encodings, setup options, records and saved data byte for byte. Turn games replay old move logs unchanged. Hidden behaviours are untouched; Fleet's is re-verified below.

### Four in a Row, Dots & Boxes, Ultimate Tic-Tac-Toe
- **Four in a Row:**
  - Moves now patch the board instead of rebuilding it, which takes it from 55 layouts per move to 8. The longest task fell from 154 ms to 74 ms.
  - The lifted disc, the falling disc and the landing ring are compositor boxes. Discs drop with weight, squash and settle.
  - A refused move shakes, and the winning line plays a finale.
  - The board is printed: paper tooth, halftone empty holes, and ink fill a hair off the black key plate.
- **Dots:** lines are scaled pills that ink in, and new lines are added without touching old ones. Boxes have halftone fills. The longest task fell from 150 ms to 55 ms.
- **Ultimate:**
  - Won small boards stamp in. The win line is built from scaled boxes, and shake, pop and stamp effects use the Web Animations API.
  - Marks are patched in place, and landscape measures only from its ResizeObserver.
  - Fixed: a mark's stamp animation replayed on the next move.
- Tests: `board.test.js` (623 checks) and the new `flat-board.test.js` (48: compositor-only animations, an idle board does at most 2 layouts, pieces keep their DOM nodes, reduced motion).

### Battleships (fleet)
- Placement drag is transform-only with a cached chart rect. Layouts during a 40-move drag fell from 179 to 10. The screen is built once and patched, so cells keep their nodes after a shot.
- **Firing:**
  - A shell flies with a dashed trail. Misses ripple and spray ink; hits burst with an off-register yellow plate and leave an ink splat.
  - A sunk ship founders with bubbles, a "Sunk!" stamp and about 85 ms of hit-stop. The finale throws confetti.
- **Look:** the sea is a printed wave-line plate in the opponent's ink, on its own cached layer, and your own waters are a halftone plate. Ships are two-plate printed pieces.
- **Numbers:** in a battle probe, layouts fell from 668 to 294 and the tap-to-paint median from 188 ms to 156 ms. The fps while firing stayed about the same: 42 → 38 on a heavily loaded box. The builder showed the drop is the new splash and sink animations; with them off it matched the original.
- **The periscope (Emerson's hidden look at Sydney's ships)** was re-verified by an independent agent, and the `[periscope]` tests pass:
  - The same 0.65 s hold on the heading, and the same outlines.
  - Nothing happens on Sydney's phone or in same-phone play.
  - No db or room calls, and no cursor, press state or other affordance.
  - The small chart headings were deliberately left without the off-register shadow, so the heading looks exactly like the others.
- Tests: `fleet.test.js` (230) and the new `flat-fleet.test.js`.

### Word Duel, Double Agents
- **Word Duel:**
  - Typing patches the draft row in place, so key-tap to first DOM change fell from 220 ms to 13 ms. Keys act on pointerdown, and a click with no preceding pointerdown (keyboard or assistive tech) still types.
  - Letters stamp in, and the reveal is a staggered flip. A refused word shakes, a winning row bounces, and the finale throws confetti.
  - Tiles and keys are printed card stock, and misses get a halftone screen.
- **Double Agents:**
  - The 25 cards are built once and patched. Tap to first DOM change fell from 166 ms to 5 ms, and long tasks while playing from 13 to 4.
  - A reveal turns over like a printed card, and a win throws confetti.
- Tests: `words.test.js`, `words-duel.test.js`, `words-agents.test.js` and the new `flat-words.test.js`.

### Doodle, Same Wave
- **Doodle:**
  - Drawing reads the canvas rect once per stroke and uses coalesced pointer samples where available. Ink is batched into one path per frame, and the backing store is capped at DPR 2.
  - Layouts while drawing fell from 52.8/s to 1.8/s, and janky frames from 12% to 1.7%.
  - Replay runs on rAF timestamps, so it looks the same at 30, 60 and 120 Hz.
  - Ink has a printed dropout texture, made once per theme.
  - The stroke encoding is unchanged; a golden old drawing still round-trips byte for byte.
- **Same Wave:**
  - The needle is a fixed-step spring at 1/120 s, interpolated and drawn by transform only. A dial drag does 0 layouts (was 35.7/s), and needle jerk fell from 0.52 to 0.15.
  - The reveal swings the needle, thumps the dial and squashes the score stamp in.
- Tests: `party.test.js` (234), `party-doodle.test.js` (560), `party-wave.test.js` (352) and the new `flat-party.test.js` (21).

### Defuse
- The clock is a fixed-width tabular box that writes text only when a digit changes, so ticking no longer rebuilds modules.
- Controls press in on pointerdown; actions still fire on click. Per-tap layouts fell from about 3.5 to 1.4 (roller and switch).
- **Juice:** a wire-snip spark, a springy switch flick, a strike stamp, a pulse in the last 10 seconds, a DEFUSED stamp with a ripple, and a BOOM ring with ink drops.
- The casing and manual pages are printed objects.
- Tests: `defuse.test.js` (422), the new `flat-defuse.test.js` (58), and the defuse parts of `computer.test.js` (45).

### Air Hockey (real time)
- **Performance:**
  - The real cost was repainting and uploading the full-screen canvas every frame.
  - Mallets, pucks and speed lines are now cached sprites moved by `transform`. The big canvas repaints only while something is on it, and the printed table is drawn once per resize or theme.
  - DPR is capped at 2 and steps down dynamically.
  - Result: **21 → 53 fps, janky frames 91% → 10%, long tasks 52 → 3** (iPhone 13, CPU 4×).
- **Netcode:**
  - The partner mallet is read through `net.remoteInto` 130 ms behind the clock, with a smoothed velocity lead.
  - The guest's puck correction is a critically damped spring of about 140 ms.
  - Authority and message formats are unchanged.
  - Under 80 ms latency and 10% loss, puck kinks on the guest's view fell from 35–51 to 22–40 per run. The run-to-run spread is wide.
- **Juice:** hit-stop of 50–80 ms and a 1.6–4.5 px shake on hard hits and goals, puck squash, a mallet pop, and an ink-splat goal.
- Tests: `live.test.js` with `GAME=hockey` (162) and the new `flat-hockey.test.js` (24). One existing assert now needs more than 100 measured guest frames instead of 200, because the loaded test box measures fewer frames; it is a jump check, not a frame count.

### Quick Draw (real time)
- The layout thrash came from SVG child transform animations, which can't run on the compositor. They are now opacity-only or a few printed `steps()` frames.
- The ms count-up is an odometer of digit reels moved by transform.
- Layouts per round fell from about 53 to 13.
- **Fairness is unchanged:**
  - The tap acts on pointerdown, and the reaction time comes from the event's own `timeStamp` mapped to the shared clock.
  - The cue still shows from a rAF armed for the shared instant, and that frame now does no layout.
- **Juice:** a cue slam, an ink burst at the winner's muzzle, a misfire rattle, and stamped tally notches.
- **Tests:** `live.test.js` with `GAME=quickdraw` (276, the same count as the original code) and the new `flat-quickdraw.test.js` (104). Three quickdraw test timings were made robust for a loaded box; no rules changed:
  - JPEG screenshots.
  - Same-instant taps pre-created.
  - One handicap case fires at 290/200 ms instead of 240/200.

### Light Cycles (real time)
- **Rendering and input:**
  - Trails live in persistent offscreen layers, and each tick strokes only its new segments. Frames repaint only the dirty rectangles.
  - Heads interpolate between ticks with a clamped dt. The frame loop does no allocations and no layout.
  - A turn draws immediately.
- **Numbers:** 51 → 55–58 fps, janky frames 15–18% → 2–6%, style recalcs while riding 60/s → 0.
- **Netcode:**
  - Corrections blend into an offset that decays exponentially.
  - Under 80 ms and 10% loss, partner snaps over half a cell on the host fell from 4 to 0, and the p99 second difference from 1.4 to 0.4–0.7.
- `cycles/sim.js` was refactored: `advance()` plus an allocation-free `pathAt`. It matches the original on 180 random turn logs (8,969 ticks, 14,400 `pathAt` checks).
- Tests: `computer.test.js` (229), `live.test.js` (434) and the new `flat-cycles.test.js` (37).
