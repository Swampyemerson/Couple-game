# Blend & Seek (`chameleon`)

A two-player 3D hide-and-seek built around one idea: **you paint yourself to disappear**.
Every chameleon starts plain white. The hider explores a little diorama, picks a spot and a
pose, then paints their own body — a 3D brush, region fill, an eyedropper that drinks colours
from the world, and a stamp that copies the surface under them onto their skin. The seeker
then hunts in first person with a handful of paint pellets.

`kind: 'live'`, modes `live` (two devices) and `local` (one device, hotseat), phone + computer,
versus, `immersive: true` (draws its own HUD with both scores). Entry: `js/games/chameleon.js`;
modules in `js/games/chameleon/`; tests in `tools/test/games/chameleon.test.js`.

## Modes

| Mode | Players | Rounds | Scoring |
|---|---|---|---|
| **Hide & Seek** | one hides, one seeks, roles swap | 4 (each hides twice) | the hider earns 1 point per second survived in the seek phase, +30 for surviving outright (timer runs out, or the seeker spends all 6 pellets). Highest total wins. |
| **Double Blind** | both hide at once, then both hunt (1.1 m/s, no jumping) | best of 3 (ends early at 2) | first confirmed tag wins the round; a timeout or both players out of pellets is a void round. Two devices only. |

The host picks mode, map and who hides first on the start screen; the guest sees every change
live (and their diorama backdrop switches with the host's map choice).

## Round flow (Hide & Seek)

```
title 1.8 s → HIDE 60 s → LOCK ≤ 7 s → 3-2-1 → SEEK 90 s → FOUND / SURVIVED 3.4 s → RECAP 9 s → next round
```

- **Hide** — the seeker gets an "Eyes shut" card with the timer and the rules. The hider
  explores in third person, jumps onto furniture (0.8 m jump), slides under tables, hops onto
  bookshelf shelves, picks a pose and paints. "Hidden" ends the phase early.
- **Lock** — the hider's paint is quantised and sent; the seeker's device rebuilds it,
  checks the checksum and acknowledges, then a 3-2-1 lifts the blindfold. The hider is never
  drawn on the seeker's screen before its paint has arrived (tested invariant).
- **Seek** — the seeker has **6 pellets** and a **chirp scan** (cooldown 30 s: the hider's
  eyes glint for 0.4 s, on both screens, occluded by walls). A miss leaves a splat both players
  see. The hider watches through their own eyes (drag to look; a dark "peeking" vignette and a
  heartbeat when the seeker is within 3 m) and may **scurry once**: a 3 m dash along the look
  direction that leaves a fading trail in their ink for 2 s.
- **Found / Survived** — freeze-frame (0.38 s), white flash, camera whip to the hider, paint
  confetti in the winner's ink, a stamped "FOUND!" / "SURVIVED!" card.
- **Recap** — the hider gets a yellow reveal outline, a slow half-orbit frames the spot above
  the card ("Sydney was RIGHT there"), the seeker's path is dotted on the floor, plus closest
  call, walk-pasts and pellets used. Either player can skip with "Next round".

Double Blind uses the same phases; both hide (neither can see the other), both lock, both
hunt in first person. One device runs Hide & Seek as a hotseat: "Seeker, look away" curtain →
hide → "Hider, hand it over" curtain → 3-2-1 → hunt. The canvas is hidden (not just covered)
behind every curtain.

## Controls

| | Phone | Computer |
|---|---|---|
| Move | floating joystick on the left 45 % | W A S D / arrows |
| Look | drag on the right | drag in third person; pointer lock in first person (falls back to drag + click-to-fire if refused) |
| Jump / pose | Jump button; Pose button opens the 5-pose bar | Space; 1–5 (C toggles crouch) |
| Paint mode | Paint: orbit camera; one finger on the body paints, off the body it orbits; two fingers rotate + pinch zoom | P; drag on the body paints, elsewhere / right-drag orbits, wheel zooms, hover shows the brush ring |
| Tools | Brush (S/M/L, Hard/Soft) · Fill · Pick · Stamp · Undo, colour swatch, Done | B, G, E, T, Z, X (size), H (hardness) |
| Seek | Fire, Scan, Jump; hider: Scurry, Pose | click, Q, Space; F |

Touches starting within 20 px of the left edge are ignored (iOS back gesture). Play surfaces
use `touch-action: none` plus non-passive `touchstart`/`touchmove` `preventDefault()`; taps vs
drags are decided in `pointermove` past a 9 px slop. A legend shows the keys on computers.

## Paint pipeline

- **Atlas**: one 128×128 RGBA buffer per chameleon, uploaded as a `DataTexture`. Each skin
  part (body, head, crest, eye turrets, tail, 4 legs) owns a rectangle; part UVs are remapped
  into it with a 1.5-texel inset.
- **Texel map**: at load the part geometry is rasterised into the atlas — for every texel,
  its part, local position and local normal — then dilated 2 px into the gutters. Painting
  transforms the texels to world space once per stroke (pose-aware) and works **in 3D**: a dab
  colours every texel within the brush radius of the hit point (skipping texels facing away
  from the camera), so strokes cross UV seams and parts without stretching.
- **Fill** colours one region (body / head / tail / legs). **Undo** keeps 24 snapshots.
- **Pick** raycasts the map (front faces only, outline hulls excluded via the draw range) and
  returns the albedo: vertex colour × atlas texel at the hit UV, mixed with any blob shadow
  there. The body is lit by the same toon lights, so matching albedo is what blends.
- **Stamp**: wall pose → the wall behind, otherwise the floor under you. The hit triangle gives
  a world→UV affine map; every texel facing away from the surface is projected onto that plane
  and takes the surface's albedo there (blob shadows included). Perfect from the front, broken
  by parallax and shading from other angles — moving around is how seekers spot it.
- **Face**: every livery gets a smile and cheek blush painted into the skin, so a hider can
  paint over it. Only the eyes (white ring + pupil, blinking every 2–5 s) can't be hidden.
- **Sync** (at lock, and in snapshots): median-cut quantisation to ≤ 32 colours **in place**
  (the hider sees exactly what is sent), then a byte stream — palette, then ops
  `0iiiiill` short run, `110iiiii L` long run, `10llllll` / `111lllll L` copy-row-above —
  base64, sent in reliable chunks of ≤ 3.2 KB, with an FNV-1a checksum of the RGBA. A
  wallpaper stamp is typically 1.5–2.5 KB of base64 (one chunk). A checksum mismatch asks the
  owner to resend.

## Netcode (net.js via `chameleon/link.js`)

`link.js` wraps `createNet` because net.js numbers reliable messages per sender session and
anchors its clock at creation: if one device remounts, the other would wait forever for old
sequence numbers. So each mount has a session id; devices greet with raw `chi` messages
(every 0.45 s until linked, then every ~2 s), and net.js runs on a channel namespaced by **both**
session ids. A new partner session → a fresh net.js instance (fresh clock sync, fresh
sequence) → pause → `hello` → snapshot → resume countdown. All game events travel as one
net.js type (`g`) and big payloads (paint, snapshots) as chunked blobs.

| State | Authority | Transport |
|---|---|---|
| own avatar: position, yaw, pose, wall angle, eye look, speed | owning device | `net.publish` 20/s; the partner is drawn from an allocation-free ring-buffer interpolation at `now − 100 ms` |
| hider position during Hide | owning device | **not sent** — presence carries zeros and `v: 0` |
| paint texture | owning device | reliable blob at lock (+ snapshot on resync) |
| mode, map, first hider | host | reliable `setup` |
| phases `hide lock seek found time recap final` (+ local `curtain`) | host | reliable `ph {seq, at, dur, scores, match}` **plus two unreliable copies** (deduped by `seq`, not held back by in-order delivery); both devices switch with `setTimeout(at − now)` and a per-frame check |
| timed transitions | host | pre-announced one lead (≥ 380 ms, `1.3 × RTT + 160`) before the deadline so both flip exactly at it |
| shots, splats, pellets | shooter | reliable `shot` |
| tag confirmation | victim | reliable `tagres` |
| round result + scores | host | inside `ph` |
| scan / scurry | seeker / hider | reliable `scan {at}` / `scurry {at}` |
| pause / resume | host (guests report `vis`) | `pause {remaining}` / `resume {at, remaining}` |

**Fair-shot rule (shooter-favoured, 250 ms).** The shooter raycasts against the hider exactly
as drawn (`net.remote(shotTime)`, i.e. `now − delay`, validated against the partner session)
and sends the hit plus the position it saw. The hider's device keeps ~1.5 s of its own
positions and confirms when any true position in `[shotTime − delay − 250 ms, shotTime]` is
within 0.75 m of what the shooter saw. What you see is what you hit, unless the hider had
already scurried away more than a quarter second earlier. In Double Blind the host takes the
earliest confirmed tag within a 250 ms window.

**Pause / resume.** The host pauses on partner away, page hidden (either device), GPU context
lost (either device) or a 4.5 s silent link; it freezes the remaining phase time and resumes
with a 3-2-1 once everything is back and a `hello` arrived on the current link. Found times
exclude pauses. If the guest remounts, the host's snapshot restores the guest's paint and
hiding spot; if the host remounts, the host restores the whole match from the guest.

Budget per device: presence 20/s, `chi` ~0.5/s, net.js pings/acks, reliable events a few per
second; a phase change costs 3 messages; the paint burst is one or two chunks.

## Maps (deterministic data, no assets)

Built from primitives (rounded boxes, cylinders, spheres, lathes, tapered tubes) and 20-ish
procedural canvas patterns per map packed into one **1024² atlas** (tiles repeat in the shader
with `fract` + `textureGrad`, 8 px wrap gutters, LOD capped at mip 3). Each map lists spawns,
a lobby spot, a suggested camouflage wall and eyedropper probe points (all checked by tests).

1. **Living Room** (10 × 8 m) — sage regency-stripe wallpaper with sprigs, dotted wall,
   kilim rug, mustard sofa with a gap behind it, polka/stripe cushions, bookshelf with gaps on
   each shelf + step stool, houndstooth armchair, coffee table (crawl under), dining nook,
   TV unit, yarn basket, chevron pouf, floor cushions, toy chest, plants, window, art.
2. **Garden** (12 × 10 m) — mown-stripe lawn, box hedges and topiary, three flower beds,
   picket fence + gate arch, striped deck chair, parasol table set, shed, log pile, stepping
   stones, pond with lily pads, washing line with towels, wheelbarrow, gnome, bird bath.
3. **Art Studio** (10 × 8 m) — splattered floor, colour-swatch wall, tape-striped wall, white
   brick wall, easels with canvases, leaning canvases, jar shelves, paint cans, plinths with
   sculptures, checker rug, drop cloth and a cloth pile, work table, apron rack.

## Art

Printed-diorama toon look: one shared `MeshToonMaterial` for the whole map (vertex colours ×
atlas tile via `onBeforeCompile`, 3-step gradient map), ink outlines **baked into the same
merged geometry** as inverted-hull backfaces pushed along smoothed normals in the vertex
shader (width grows gently with distance; big walls get a cheap ink cap instead), blob
shadows (one merged transparent mesh), warm key light + hemisphere fill kept just under 1.0
so painted colours never clip, paper-tone sky and fog from the theme (dark mode follows the
OS / app theme live). Player inks (`--p-a`, `--p-b`) colour liveries, pellets, splats, trails,
paths, confetti and HUD accents; `--g-hl` is the scan glint and the reveal outline. The HUD is
sticker-style DOM (card, ink border, hard shadow), sounds are synthesised WebAudio (unlocked on
the first touch, respecting the app's mute switch).

## Performance

- WebGL2, `antialias: false`, `powerPreference: 'high-performance'`, `alpha: false`,
  `stencil: false`. Pixel ratio `min(dpr, 2)` × a dynamic scale 0.6–1.0 stepped once a second
  from an EWMA of frame time.
- Draw calls: map 1 + blobs 1 + ~12 per visible chameleon + instanced fx (splats, pellets,
  confetti, trail, path) ≈ 19 in the hide phase, ~35 while seeking. Map ≈ 10–33 k vertices.
- Shaders are compiled with `renderer.compile()` behind the loading card.
- Per frame: no allocations in game code (ring buffers, shared vectors, stable HUD
  descriptors, DOM writes only on change); net.js allocates one object per publish (20/s).
- Pauses rendering when hidden; handles `webglcontextlost` / `restored` (paint buffers
  re-uploaded, programs recompiled, "Tap to resume").
- `destroy()` disposes every geometry, material, texture and the renderer (and forces context
  loss), removes all listeners, timers and DOM.

## Tests (`node tools/test/games/chameleon.test.js`, ports 8910–8919)

Sections (select with `ONLY=`): `hotseat`, `desktop`, `dark` (one-device rounds + screenshots
at 390×844 and 1280×800, light and dark), `match` (full 4-round Hide & Seek on two phones
through the UI, eyedropper probes, paint hashes, splats, scan, scurry, tags, round swap, end
card, one result, phase sync), `lossy` (20 % drops, 90 ms), `db`, `disconnect` (guest and host
reloads), `robust` (iPhone 13 perf, draw calls, context loss/restore, visibility), `leaks`,
`maps`. Screenshots go to `$SHOTS` (default `$TMPDIR/chameleon-shots`).

## Known limits

- Headless Chromium renders WebGL in software, so test frame times (~70–200 ms) say nothing
  about phones; the JS cost per frame (~0.1 ms) and draw calls are the meaningful numbers.
- Phase-switch skew in tests is dominated by main-thread lateness on a loaded CI box; the
  shared clocks themselves agree within a few ms.
- One device can't play Double Blind (it needs simultaneous hunting).
