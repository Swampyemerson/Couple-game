# Upgrade 2: smoothness, harder Blend & Seek, graphics/texture upgrade

Emerson's request, verbatim:
> upgrade again. Spend a lot of time and research on the mobile game engines and like smoothness, like the camilian one can really jump
> around as you switch surfaces and be hard to do. Also it's still to easy to find chamilians on the smaller maps, so maybe even smaller
> chamilians and maybe a general graphical/texture upgrade across the board. Subagents permitted

Each unit is a cloud session. It starts from `claude/relaxed-dijkstra-2cy8al`, pushes only to `claude/upd2-<unit>`, and writes
`docs/updates/upd2-<unit>.md` when it's done. The coordinator merges, runs the regression and publishes. The rules in
`docs/updates/PLAN.md` still apply: file ownership, the bundler rule, saved-data compatibility, iPhone-first, kill only your own processes,
no PRs. Read that file and `docs/GAMES.md` first.

## How to work
1. **Research first.** Spend real time on it, using WebSearch/WebFetch.
   - How shipping mobile games and web engines get smooth, responsive feel:
     - fixed-timestep simulation with render interpolation;
     - frame pacing on iOS Safari/WKWebView (rAF jitter, 120 Hz ProMotion);
     - input latency;
     - camera smoothing (critically damped springs, look-ahead, collision);
     - character controllers on arbitrary surfaces (wall/ceiling transitions in games like Mario Odyssey, Spider-Man and Gecko-likes,
       including surface-normal blending, ground snapping and corner wrapping);
     - animation blending;
     - LOD, batching and texture compression;
     - three.js mobile best practices;
     - toon and painterly stylization techniques.

   Put a short research summary with sources in your report.
2. **Measure before and after** with the harness on an iPhone profile (CPU 4×): frame-time jitter, input→response latency, camera
   jerk/teleport events, draw calls, triangles, texture memory.
3. **Build** with subagents (Sonnet, medium/high effort). You direct.
4. **Verify** with an independent subagent: real taps, both players, light and dark. Then fix what it finds.

## Units
| Unit | Scope |
|---|---|
| chameleon | **Top priority.** <ul><li>**Surface transitions:** make wall/floor/ceiling transitions smooth and controllable. No camera or body snapping or popping when switching surfaces, easy to crawl around corners and edges, intuitive controls on the phone.</li><li>**Smaller maps are too easy for the seeker:** add smaller chameleon sizes (a new Tiny and Micro below the current smallest) and rebalance presets and defaults per map size, so small maps get smaller default chameleons and other hider advantages (more clutter or hiding spots, texture variety).</li><li>**Graphics:** a texture/material upgrade for all rooms (richer patterns and surfaces), better lighting.</li></ul> Keep camo-matching correct (the paint must still be able to match what the seeker sees). |
| rush | Smoothness/feel research applied (input → lane change, camera, frame pacing), plus a graphics and texture upgrade: districts, materials, lighting, effects. Keep within budgets. |
| getaway | Smoothness (car → camera, network interpolation feel, frame pacing), plus a graphics and texture upgrade: roads, buildings, materials, sky, lighting. Keep within budgets, and keep the homes and cats. |
| threed | Knucklebones and Tower Together: dice and block physics feel, plus a graphics and texture upgrade. |
| flat | All 2D/DOM games: four, dots, ultimate, fleet, wordduel, agents, doodle, wave, hockey, quickdraw, cycles, defuse. Animation smoothness (60/120 fps, no layout thrash), juice, and a visual and texture upgrade within the riso design system (paper grain, halftone, ink-misregistration textures, transitions). **The flat unit may also edit `games.css` and `js/games/covers.js`; nobody else may.** Hockey, quickdraw and cycles are real-time, so their netcode smoothness is in scope too. |

## Timeline
- Push WIP about every 45 minutes.
- Final push within about 6 hours of starting, with the report.
