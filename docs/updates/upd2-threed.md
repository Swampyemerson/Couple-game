# Upgrade 2, threed unit: Knucklebones and Tower Together

This unit covers dice and block feel (a fixed-step simulation with interpolation, settling, juice and feedback that doesn't need
haptics) plus a printed graphics and texture upgrade, kept within mobile budgets. Branch: `claude/upd2-threed`.

Files changed:
- `js/games/bones.js`, `js/games/tower.js`;
- `docs/games/bones.md` and `docs/games/tower.md`, each with a new "Feel and graphics (upgrade 2)" section;
- `tools/test/games/threed-bones.test.js` and `threed-tower.test.js`;
- one line in `tools/test/games/threed.test.js`;
- a new perf bench, `tools/test/games/threed-perf.js`.

No shared files were touched. The rules functions, setup moves and move encodings are byte-for-byte unchanged, so old logs, records
and saved data replay as before. The existing replay-against-original-rules tests still pass.

## Research summary

WebFetch could not resolve any host from this container (DNS `ENOTFOUND`), so these points come from search-result snippets and
the primary pages they point to. I didn't read any of those pages in full.

- **Fixed timestep with interpolation.**
  - The source is Glenn Fiedler's ["Fix Your Timestep"](https://gafferongames.com/post/fix_your_timestep/), with a recap in
    [JamJar's game-loop docs](https://jamjar.readthedocs.io/en/latest/Architecture/game_loop/).
  - Accumulate the clamped frame time, step at a constant `h`, and render `prev·(1−α) + curr·α`. Clamping avoids the spiral of
    death.
  - What we did: pieces, flecks, squash and dice playback run at a fixed 120 Hz and are drawn interpolated.
  - The Tower slider stays analytic, so what you see is what you drop.
- **iOS frame pacing.** WKWebView stays at 60 Hz even where Safari can run 120 Hz behind a flag, so we never assume 16.7 ms and
  use the rAF timestamp as the clock. Sources:
  - [WebKit bug 294338](https://bugs.webkit.org/show_bug.cgi?id=294338);
  - [Apple forums 773222](https://developer.apple.com/forums/thread/773222);
  - [WebKit bug 280183](https://bugs.webkit.org/show_bug.cgi?id=280183).
- **Critically damped springs for the camera.** Damping ratio 1 is the fastest settle with no overshoot. We use the exact
  closed-form step, so it is stable at any dt. Sources:
  - [Ryan Juckett's damped springs](https://www.ryanjuckett.com/damped-springs/), via the
    [Harmonica](https://github.com/charmbracelet/harmonica) port;
  - [Unreal `FMath::CriticallyDampedSmoothing`](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Core/FMath/CriticallyDampedSmoothing).
- **Faking dice physics for a known result.** Simulate a real tumble, then compose the cube-symmetry rotation that puts the wanted
  face on top. Every contact stays identical because the cube is symmetric. This is a standard technique; it came from our own
  design rather than a fetched source.
- **Juice without haptics.**
  - Sources: Jonasson & Purho, "Juice it or lose it", and Nijman, "The Art of Screenshake", both listed by
    [Kenney](https://kenney.nl/learn/must-see-videos-for-indie-developers) and summarised by
    [RPG Playground](https://rpgplayground.com/research-making-a-juicy-game/).
  - What we used: squash and stretch, short hitstops, small particle puffs and camera kicks, and a sound on contact. All of it is
    restrained, and none of it runs under reduced motion.
- **Cheap mobile materials.**
  - Lambert or Basic over Standard/Physical. One report has a single material swap doubling mobile frame rate
    ([three.js forum](https://discourse.threejs.org/t/why-my-three-js-code-is-working-slow-in-lighthouse-and-on-mobile-phone/26562)).
  - Matcap bakes its lighting ([docs](https://threejs.org/docs/pages/MeshMatcapMaterial.html)) and has had mobile artefacts
    ([#18265](https://github.com/mrdoob/three.js/issues/18265)), so we skipped it.
  - We use toon banding and a `gl_FragCoord` halftone in `onBeforeCompile`.
- **Our own measurement.** On the headless software rasteriser, frame cost scaled with canvas pixels and full-screen textured
  quads. Both games now draw their paper and mat backdrops as CSS layers behind a transparent canvas.

## Measurements

Measured with `tools/test/games/threed-perf.js` on an iPhone 13 profile with CPU throttled 4× (CDP), headless Chromium with
software GL. "Before" is commit `886b707`, run in a worktree in the same session under the same load.

- Frame jitter is sampled while the Tower slider sweeps (8 windows of 1.5 s) and while a die tumbles.
- Latency runs from the `pointerdown` timestamp to the first rAF after the game has shown the response: the drop recorded, or
  the die in the tray.

| | Tower light: before → after | Tower dark: before → after | Bones light: before → after | Bones dark: before → after |
|---|---|---|---|---|
| frame mean / sd (ms) | 19.3 / 6.7 → 18.6 / 5.7 | 18.9 / 6.0 → 18.4 / 5.2 | 16.9 / 2.4 → 17.0 / 3.5 | 17.1 / 3.4 → 17.1 / 3.6 |
| frames > 25 ms | 92 / 621 (14.8 %) → 70 / 643 (10.9 %) | 81 / 636 (12.7 %) → 65 / 651 (10.0 %) | 9 / 985 → 13 / 879 | 14 / 899 → 19 / 1002 |
| max frame (ms) | 66.7 → 50.1 | 50.1 → 50.0 | 50 → 99.9 | 66.7 → 83.4 |
| tap → response, mean / p50 (ms) | 112 / 101 → 67 / 65 | 119 / 98 → 70 / 71 | 129 / 126 → 69 / 79 | 104 / 104 → 67 / 74 |
| draw calls per frame (max) | 7 → 7 | 7 → 7 | 18 → 6 | 18 → 6 |
| triangles per frame (max) | 242 → 362 | 242 → 362 | 52 → 758 | 52 → 758 |
| GPU texture memory (GL uploads) | ~0 → ~0 | ~0 → ~0 | 512 KB (10 tex) → 1.40 MB (7 tex) | same |

- **Latency:** tap to response is about 40 % faster in both games.
- **Tower jitter:** frames over 25 ms fell by about a quarter.
- **Knucklebones jitter:** it is back near its baseline after the fix round.
  - The builder's first version, with a GL mat and a throw solved at roll start, had 31–37 slow frames.
  - A few extra slow frames remain right after a landing, from the DOM redraw of the trays.
  - The single 84–100 ms max frames are one-offs in this software-GL run.
- **Bench noise:** each run is 8 rolls or drops, so ±5 slow frames is noise.


Notes on the numbers:
- **Latency.** About 15–40 ms of each latency figure passes before any page handler runs under the 4× throttle (event timestamp
  against handler time), so app code can't remove it.
- **Tower jitter.** The bench's remaining Tower frame jitter comes from the canvas hand-over in software GL and scales with pixel
  ratio. Dynamic resolution now reacts faster. A real GPU should not show it; still to check on a device.
- **Texture memory.**
  - The GL-level column counts uploaded textures only.
  - Knucklebones' figure is two mipmapped 512×256 face atlases, one per player ink, so a roll never repaints a canvas.
  - The printed mat and Tower's paper are DOM tiles: about 256–512 KB decoded, not GPU textures.

## Knucklebones

### Feel
- **The dice tumble is real.**
  - A rounded cube (8 corner spheres) is simulated against the mat at 1/120 s: impulse contacts, restitution about 0.4 that fades
    with speed, Coulomb friction, damping and sleep.
  - The throw is seeded per turn, so both phones see the same tumble.
  - It is solved ahead in timer slices while the turn waits, so the roll costs about 1–2 ms to start, down from about 45 ms.
  - A cube-symmetry rotation makes the landed face exactly the rolled value: 360 Node throws plus 37 browser rolls are asserted.
  - Playback is interpolated from the rAF clock.
- **Juice:**
  - impact ticks whose pitch and volume follow impact speed;
  - squash and stretch on hard hits;
  - a hard ink blob shadow that tightens on landing;
  - an ink-fleck puff on the first big hit;
  - a 3-frame hitstop and a small wobble on settle;
  - a 50 ms hitstop and a 3 px band shake before a smash cracks.
- **Input.**
  - Finger-down shows the pressed column at once.
  - On lift, the die is drawn into the tray in the very next frame. `api.move` follows one frame later, and the engine update
    consumes the pending placement, so nothing is drawn or sounded twice.
  - Blind Draw keeps the old path. A rejected move restores the board.
- **Fewer draws.** A redundant immediate render used to draw most frames twice: 18 draws per rAF before, 6 now. The loop sleeps
  when nothing moves.

### Graphics
- A bevelled die of 300 triangles with ink crease lines and the ink hull outline.
- A mipmapped 512×256 face atlas with paper grain. Pips are printed in ink over a misregistered second pass in the roller's colour.
- Toon-banded shading under a hemisphere light plus one sun, so the faces print in distinct tones in light and dark.
- A printed play mat (felt, a 45° halftone, a target ring and tick marks) drawn as a CSS layer in matching perspective.

## Tower Together

### Feel
- **Fixed step.**
  - Falling slices, flecks and the landing squash run at a fixed 120 Hz (accumulator, frame clamp 0.1 s) and are drawn interpolated.
  - Slices tumble and bounce once off the pedestal or ground (restitution 0.3), then shrink away.
  - The slider stays analytic, so the recorded drop equals the drawn slider. This is asserted under 4× throttle with real taps,
    and the verifier saw a maximum difference under 0.0006 across 100+ drops.
- **Camera.** An exact critically damped spring per channel replaces the exponential lerp. Landings give it a small velocity kick,
  stronger for growth, gift or landmark. The loop still sleeps when settled.
- **Juice:**
  - squash and stretch on landing;
  - small flat ink flecks: highlight yellow and player ink on a perfect, the block's ink on a slice, a few paper-white in dark mode;
  - a 45 ms hitstop on a perfect.

  The ring, ding, stamps and banners are kept. None of the new effects run under reduced motion.
- **Input.** A tap freezes the block in the next frame, and `api.move` goes out after that frame. A latent double-scheduled loop
  is fixed.
- **Jitter.** DOM work (ghost, culling, ground, HUD measure) happens only when values change. Dynamic batches upload only what
  changed. Tall towers draw only the blocks near the screen. Dynamic resolution steps down faster.

### Graphics
- Side faces print as a 45° halftone screen (`gl_FragCoord`, 3 CSS px). Top faces stay flat ink.
- Vertex AO at the foot of each side face.
- The ink outline is slightly misregistered toward the bottom right.
- The pedestal is printed with stripes and a pin-stripe.
- A paper-grain backdrop and a tinted, halftoned ground band with a horizon line. These are DOM tiles that follow the camera,
  painted from the palette.

## Verification

An independent Sonnet verifier played both games with real taps:
- online on two phones and same-phone, both players, to the end and through a rematch;
- light, dark and reduced motion, at 390×664, 360×740 and 844×390;
- every Knucklebones twist and every Tower mode;
- tap-to-skip, double and triple taps, full columns, the keyboard, context loss with and without restore, page hide and show,
  the forced 2D fallback, and reopening finished matches.

Every die face matched its roll, no die was placed twice, and every drop was recorded where it was drawn. There were no page errors.

It found no blockers and no logic bugs. Fixed after the round:
- **Tower, Windy mode:** the sliding block's top rendered dark. The normals of a reused batch slot were never uploaded. A
  render-pixel test now guards it, and fails with the fix reverted.
- **Tower, lost context:** a WebGL context lost and never restored froze the game. It now switches to the flat 2D view after
  3 s, and back to 3D on a late restore. This bug predates the update.
- **Outlines:** both games' ink outlines were broken at the foot by a near-coplanar blob shadow. The shadow now draws first,
  without writing depth.
- **Tower finale:**
  - a stray ghost-ring dash under the "Best N" badge is now hidden;
  - under reduced motion the zoom-out now snaps instead of animating.
- **Knucklebones, lost context:** the band was empty for 3 s during a context loss. A flat stand-in die now shows the current
  roll at once.
- **Knucklebones, atlas:** trilinear sampling and up to 4× anisotropy, at no memory cost.

Earlier fixes in the build round:
- the Tower flecks printed as black blobs; they are now flat ink specks with no outline;
- Knucklebones hitches: the throw is solved ahead, both ink atlases are pre-painted, and the mat moved to CSS.

## Tests

All run on the final code, in parallel on separate ports:

| command | result |
|---|---|
| `node tools/test/games/threed.test.js` | ALL GOOD (105 ok) |
| `node tools/test/games/threed-bones.test.js` | ALL GOOD (406 ok) |
| `node tools/test/games/threed-tower.test.js` | ALL GOOD (184 ok) |
| `node tools/test/all-games.test.js` | ALL GOOD (35 ok) |
| `node tools/test/games/threed-perf.js` | the table above (not pass/fail) |

The one change in `threed.test.js`: `bonesOnline` waits for the move after a click, because `api.move` now follows the drawn
placement by one frame.

New assertions:
- the die face equals the roll;
- the drop equals the drawn slider under 4× throttle;
- budgets in light and dark (≤ 12 calls, ≤ 3,000 triangles, ≤ 1.5 MB textures);
- the loop sleeps when idle;
- no effects under reduced motion;
- the pressed state on finger-down;
- no double die, locally and online;
- the Windy slider is lit;
- the flat fallback after an unrestored context loss;
- sliced and one-shot throw solves are identical.

## Known issues and notes for the coordinator

- **Core chrome.**
  - On 844×390 the engine end card is taller than the screen, so its buttons need a scroll (`games.css .gm-end-card`).
  - The Knucklebones header score chips update about 300 ms before the smash animation plays.
  - Neither is this unit's file.
- **No real-device run.** Everything was measured in headless Chromium with software GL. Still worth checking on an iPhone:
  - frame pacing, especially Tower's transparent canvas over the DOM backdrop;
  - the CSS-3D mat alignment on WebKit.
- **Die sharpness.** Up close at 3× the die faces are slightly soft. The atlas gives about 120 px per face, within the texture
  budget.
- **Very tall towers.** Past about 110 blocks, the full-tower finale view can exceed 3,000 triangles for a few seconds.

## README games-table lines

No change needed. The existing lines still describe both games.
