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
- First run: a 3-step ghost-hand tutorial (lanes, jump, roll) over the warm-up straight, once
  (`localStorage`, guarded).

## Feel numbers (js/games/rush/tune.js)

120 Hz fixed-step sim with render interpolation. Speed `12.5 → 30 m/s` (`v = V0 + (VMAX-V0)(1-e^(-t/110))`),
lane change 0.15 s ease-out, jump apex 1.65 m with a low-gravity hang near the top, 0.62 s roll,
sneakers apex 3.9 m (reaches train roofs). Side clip = stumble (−40 % speed, decays over 0.9 s,
camera shake, bounce back to the lane you came from). Head-on = crash: −1 heart (3), 1.6 s down,
respawn in the clearest lane with 2 s of ghost invulnerability. Shield absorbs one crash or attack.

## Track generator (js/games/rush/track.js)

- 80 m chunks, each a pure function of `(seed, index)`: the same chunk on every device, built in any
  order. Only `+ − × ÷ sqrt floor` are used (no `exp`/`sin`), so every JS engine agrees bit for bit.
- Every chunk carves a **safe path**: it enters in `safeLane(seed, i)` and leaves in
  `safeLane(seed, i+1)`, and every obstacle is placed around that path. On the path an obstacle is
  only ever jumpable/rollable; lane switches of the path happen in a window where every lane it
  crosses is clear for `0.15 s × lanes + 0.3 s` at design speed. Coins trace the path.
- Spacing is in **seconds at design speed** (`sqrt(V0² + 0.3·d)`), shrinking from 1.15 s to 0.58 s
  between rows as difficulty `1 − 1/(1 + x + x²/2)`, `x = d/700` rises (0.25 at 200 m, 0.87 at 2 km).
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
  bursts pings (~8/s) while in the lobby / countdown / a pause and trickles them (~1/s) while
  running, keeps the 5 lowest-RTT of the last 60 samples, and both sides stamp their stream with
  that clock. Measured start skew in the harness: 0.5–10 ms at 80 ms ± jitter latency.
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
  seeing it. When reasons clear, a device schedules `resume at = now + 3000`, publishes it and sends it;
  the other adopts the later of the two. Run time excludes pauses, so pauses can't change a result.
- **Partner re-mount mid-match**: host sees a new instance id → sends `rejoin` with the match and the
  guest's last published runner; the guest restores and resumes with a countdown. If the *host*
  re-mounts, the guest resets to the lobby.

## HUD

Immersive: the engine shows two 44 px stickers (back, menu) in the top corners; the HUD keeps clear
of them. Top: hearts, coins, distance; under the menu sticker: my pause button (pauses both phones
in live play). Race: a bar with both runners and the finish, plus a gap pill ("Sydney +23 m").
Brawl: the partner's hearts in the pill. Together: team hearts, team coins and the coin goal.
Bottom-right: the weapon slot (Race). Buttons scheme: ROLL / JUMP in the bottom corners.

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

## Performance

- Draw calls: each 100 m chunk is ONE merged mesh (track, scenery, parked trains, barriers, outlines)
  in pooled preallocated buffers; coins/pickups/roadblocks/particles/shadows are `InstancedMesh`;
  runners are skinned (1 call each). Measured: 12–17 calls on a phone in a busy race, ≤ 36 in split
  screen; ~45–90k triangles; chunk buffers hold ≤ 18k vertices (peak use ~9.6k).
- `antialias:false`, `alpha:false`, `stencil:false`, `powerPreference:'high-performance'`.
  Dynamic resolution: pixel ratio `min(dpr,2) × scale`, scale 0.6–1.0 from an EWMA of frame time.
- No per-frame allocations in the loop (scratch vectors, typed arrays, pools). Shader warm-up with
  `renderer.compile` behind the loading screen. Fog hides chunk pop-in.
- `webglcontextlost` → pause + "Tap to resume"; `webglcontextrestored` → three re-uploads from the
  retained buffers. Hidden page → pause sim, render and audio; back → 3-2-1.
- `destroy()` cancels rAF, timers and listeners, disposes every geometry/material/texture and
  forces context loss.
