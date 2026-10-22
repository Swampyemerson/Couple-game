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
