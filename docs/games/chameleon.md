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
| **Hide & Seek** | one hides, one seeks, roles swap | 2 / 4 / 6 (setting; each hides half) | the hider earns 1 point per second survived in the seek phase, +30 for surviving outright (timer runs out, or the seeker spends all their pellets). Highest total wins. |
| **Double Blind** | both hide at once, then both hunt (1.1 m/s, no jumping) | best of 3 (ends early at 2) | first confirmed tag wins the round; a timeout or both players out of pellets is a void round. Two devices only. |

The host picks mode, map, a preset (or any custom mix of settings, below) and who hides first on
the start screen; the guest sees every change live (and their diorama backdrop switches with the
host's map choice).


## v2: sticky feet, sizes, settings, big maps

### Why the default changed ("it's too easy")

In v1 a well-stamped chameleon on a wallpaper wall was close to invisible: the body is small
(0.24 m radius), the stamp copies the wall exactly, and a 6-pellet seeker only had eye glints every
30 s. Hiding was the dominant strategy, and climbing would have made it stronger still. v2
rebalances so the seeker has a fair chance *before* adding new hiding places:

- **Bigger default body.** The size is a setting (Tiny 0.6× · Small 0.8× · Medium 1.0× = v1 ·
  Large 1.3× · Huge 1.8×) and **Classic uses Large**: 1.7× the silhouette area, so the stamp's
  parallax seams and the outline are visibly bigger, and a Large body no longer fits under the
  coffee table or the step stool (head 0.44 m).
- **Stronger tells.** Eye-blink glints (a small sparkle when the hider blinks, seen only by the
  seeker; Strong blinks more often), scans every 20 s instead of 30, a scan also makes a stuck
  hider's toe pads sparkle (so walls and ceilings are not blind spots), a hider on a ceiling casts
  a faint soft shadow on the floor below (opacity 0.2, fading out over 4.5 m of drop: still
  ~0.1 under a 2.6 m house ceiling), and tongue-zips / scurries leave a short trail.
- **Seeker freedom.** Free look up/down to ±83°, a Sprint toggle (1.55×), a minimap on big maps.
- **Hider counterweight.** One escape (scurry or tongue-zip) per hunt in Classic, heartbeat hint on.

### Sticky feet (movement)

A body is either *free* (v1 walking: a circle with feet at y, gravity, step-up, jump) or *stuck*
(a contact point on a collider face with a surface normal n and a heading f). `world.crawl()`
moves a stuck body along its face; two feelers ahead (at 3.5 cm and at belly height) detect a
face in the way (concave corner: it transfers onto it: floor → wall → ceiling), a ray down the
normal keeps it on coplanar boxes, and walking off an edge wraps it round onto the side face it
just left (convex corner: table top → table edge → underside). Coming down a wall onto an
upward-facing floor releases it back to free walking. Contacts outside the map bounds or buried
inside another box are rejected, so you can't crawl out of the diorama or into furniture.

| | |
|---|---|
| Stick | **Stick** button / **E**: grab the nearest wall or overhead face (else, with feet on something, sticky floor: walk off a ledge to crawl down its side; in mid-air with nothing in reach it refuses). Again to let go (drop, a radius off the surface). Walking into a wall with the stick pushed forward for 0.22 s also sticks. |
| Crawl | the stick is **screen-relative on any surface**: the direction on the face whose on-screen image matches the stick (projected through the real camera), so "up the screen" is up a wall facing you and "away" on a ceiling seen from below. 0.78× walking speed. |
| Jump | on a wall: leap off it (push 2.6 m/s off the wall + a jump). |
| Tongue-zip | **Zip** / **Z**: the tongue lashes at the surface in the middle of the view (≤ 4.6 m × √size), the body follows in a 0.42 s arc and sticks there (or lands on its feet on a floor). 1.1 s cooldown while hiding; while hunted it costs an escape, 4 s cooldown, and the seeker sees the tongue and a trail. |
| Poses | adapt to the surface: free = Stand, Crouch, Ball, Low, Squeeze (+ Wall near a wall, Perch on something thin); on a wall = Crawl, Flat, Corner (next to a corner), Ball; on a ceiling = Crawl, Flat, **Hang** (dangles head-down by the tail). Keys 1–9. |
| Perch | thin things (< 0.16 m across, or `perch` colliders: rails, poles, cords, stems): standing still on one perches automatically, tail curled round it. |
| Squeeze | a 0.08 m × 0.15 m profile at every size, 0.35× speed: slides into 0.18 m gaps behind sofas and under beds. Standing up needs room. |
| Corner | flat against a wall next to a perpendicular one: slides into the corner and turns into the diagonal. |

The camera keeps world-up at all times (third person orbits with the body's centre, eases a
little below an overhead hider; first person is yaw/pitch with a level horizon), so nothing rolls.
The avatar's orientation is a quaternion built from (n, f), slerped (rate 16/s) so edges and
corners turn smoothly; a little suction squash and a "thup" sound on stick, a "pok" on let-go,
a ring pops on the surface.

**Netcode.** Presence gains `q` (the orientation, smallest-three packed into one 32-bit number,
~0.2° precision) and `at` (stuck). The ring buffer interpolates `q` by quaternion slerp. Paint
blobs and snapshots carry the full contact (n, f) so a reload restores a hider on the ceiling.
Zips travel as reliable `zip {w, at, to, left}`; scans carry `left`. No extra messages per second.

**Seeker answers.** Pellets are mesh raycasts against the avatar as drawn (any orientation), the
tag tolerance scales with size (never below v1's 0.75 m), the recap says where they were
("Sydney was on the CEILING", "HANGING from the CEILING", "UP the WALL", "PERCHED", "SQUEEZED into
a gap", "wedged in the CORNER").

### Settings

Host edits in the lobby (preset, map card with ‹ › and a floor plan, size) or the full **Settings**
sheet; the guest sees them change live (read-only, its own sheet keeps its scroll). Everything
is validated by `rules.js` (`sanitizeRules`: every field snapped to its option list, unknown →
Classic) on both devices, travels in `setup` (lobby) and in the match info of every phase message,
and is saved per device (`localStorage`, last used) for the next time that device hosts.

| Setting | Options | Easy | Classic | Hard |
|---|---|---|---|---|
| Chameleon size | Tiny · Small · Medium · Large · Huge | Huge | **Large** | Medium |
| Rounds (Hide & Seek) | 2 · 4 · 6 | 4 | 4 | 4 |
| Hide time | 30 s – 2 min | 45 s | 60 s | 75 s |
| Seek time | 1 – 3 min | 2 min | 90 s | 90 s |
| Paint pellets (DB: one fewer) | 3 – 10 | 8 | 6 | 5 |
| Chirp scans per hunt | 1 · 2 · 3 · 5 · unlimited | unlimited | unlimited | 3 |
| Scan cooldown | 10 – 45 s | 15 s | 20 s | 30 s |
| Escapes (scurry / tongue-zip) | 0 – 3 | 0 | 1 | 2 |
| Seeker speed | Slow · Normal · Fast | Fast | Normal | Normal |
| Walls & ceilings | Climb · Floor only | Climb | Climb | Climb |
| Stamp tool | Allowed · Off | on | on | on |
| Eye-blink glints | Off · On · Strong | Strong | On | Off |
| Heartbeat hint | On · Off | Off | On | On |
| Seeker minimap (big maps) | On · Off | On | On | Off |

"Hard" is hard for the **seeker** (masters of disguise). Any change shows **Custom**. Floor only:
no Stick, Zip or Hang; the classic flat-on-the-wall pose still works but only slides sideways.
Stamp off hides the tool and refuses the action.

### Big maps

`maps.js` documents the map format at the top (backward compatible); the level designer's maps
live in `maps/` and are appended through `EXTRA_MAPS`. Maps over 160 m² are **chunked** by room
(and floor) from `info.rooms`, else a 6 m grid: each chunk is its own geometry with its own
bounding sphere, so three.js frustum-culls per room; fog closes in (11–26 m) and the far plane
follows, so distant rooms cost nothing. Collision and every ray (crawl feelers, camera clamp,
tongue) go through a uniform 1.5 m XZ grid (CSR arrays, stamp de-dup, no allocation). One
1024² atlas per map (`info.atlasPages: 2` → 1024×2048). Spawns come from `hiderSpawns` /
`seekerSpawns` lists, picked by the host with a seed (match id + round), the same on both devices;
the seeker's spawn is picked at seek time ≥ 6 m from where the hider ended up. The title orbit
uses `info.overview`, and while it orbits the fog pulls back to the map's footprint (near ≈
0.9 × radius, far ≈ radius + 0.75 × diagonal), snapping back to 11–26 m for play. Chunks entirely
inside the fog are skipped each frame (one sphere test per chunk), so the far plane can reach
`backdrop: true` scenery (distant mountains, skylines: one fog-free chunk, never culled or
picked). Clocks scale with the map's `size` in every preset (S 1×, M 1.2×, L 1.35×, XL 1.5×,
rounded to 5 s; the settings sheet shows the effective times) and the seeker's sprint grows to
1.7× on XL. Invisible `climb: false` guards (over roofs, above low outer walls) are solid to
crawlers but never a surface: feelers stop at them, Stick / zip / wall pose refuse them, and a
contact whose body would poke into one is rejected; the third-person camera ignores them. A
seeker-only minimap (rooms + furniture footprint + your arrow) shows on
big maps unless Hard / off; on two-storey maps it shows the floor the seeker is on (one
pre-drawn plan per `info.floors` entry, labelled). Measured on every map (iPhone 13 profile,
third-person sweeps from every spawn × 4 headings; map switch = paint atlas + build + upload):

| Map | draw calls | triangles in view | chunks | map switch (median) |
|---|---|---|---|---|
| Living Room | 32 | 39k | 1 | 71 ms |
| The Whole House | 51 | 72k | 21 | 136 ms |
| Corner Market | 49 | 50k | 23 | 109 ms |
| Greenhouse & Shed | 48 | 60k | 25 | 82 ms |
| Museum Night | 52 | 44k | 21 | 131 ms |
| CU Boulder | 66 | 87k | 50 | 201 ms |

~0.1 ms game JS per frame, no per-frame allocations in game code, and no heap growth from the
game across open/close (what grows is the hub's match list). Geometry building got cheaper in
the QA pass: the outline-hull smoothing groups vertices with a numeric key on the primitive's
local positions instead of string keys on world positions (identical output, ~25 % faster).

### QA pass (two-phone play-tests, fuzzing, design review)

- **Sticky floor needs feet on something.** Stick in mid-jump used to glue the body to thin air
  (a floating hiding spot); now it refuses unless a wall/overhead face is in reach.
- **Hang needs room.** Hang is offered only with ≥ 0.9 × size of drop under the face; under a low
  underside (a plinth lip) the dangling body used to sink through the floor, out of pellet reach.
- **Camera in front of the surface.** Stuck to a wall or ceiling, the third-person orbit is kept in
  the half-space in front of that face; orbiting "behind the wall" used to jam the camera into
  the body, which vanished.
- **Round 1 title.** The round-title card and the map's overview orbit now show for round 1 too
  (both devices used to sit on a dead lobby, Start still showing, for the title lead). The title
  card uses a light veil so the orbit reads instead of a 70 % paper wash.
- **Settings sheet.** On laptops (≥ 900 × 600) it's a 940 px dialog with two columns of settings
  and desktop-sized type; the lobby card hides behind it; it is a flex column so a long sheet
  can't overflow above the corner buttons; a guest's open sheet closes when the match starts.
- **Map card plan.** A riso print of `info.rooms` (floors side by side, rooms overprinted in the
  three inks with a mis-registered pass, ink outlines in screen pixels; one-room dioramas get a
  halftone floor and a dashed open front).
- **Data fixes.** Wall skins with a `[u, v]` repeat produced NaN UV offsets (Market stockroom
  wall, Museum gift-shop and Ancient Worlds skins rendered untextured); `wall()` and the museum
  skins now use the u/v components.
- **Pose bar** on a phone on its side stays a bottom-left row with six action buttons (the
  portrait column ran up under the back sticker).

### First-time tips

The first time a device hides with climbing on, a sticker lists the four new moves (Stick,
Hang/Perch, Squeeze, Zip/Jump); "Got it" (or starting to seek) dismisses it for good.

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
| Jump / pose | Jump button; Pose button opens the pose bar (adapts to the surface) | Space; 1–9 (C toggles crouch / flat) |
| Stick / let go | Stick button (or walk into a wall holding forward) | E (V) |
| Tongue-zip | Zip button (aim with the camera) | Z |
| Sprint (seeker) | Sprint toggle | hold Shift |
| Paint mode | Paint: orbit camera; one finger on the body paints, off the body it orbits; two fingers rotate + pinch zoom | P; drag on the body paints, elsewhere / right-drag orbits, wheel zooms, hover shows the brush ring |
| Tools | Brush (S/M/L, Hard/Soft, scaled with the body) · Fill · Pick · Stamp · Undo, colour swatch, Done | B, G, E, T, Z, X (size), H (hardness) (E/Z pick/undo only while painting) |
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
| own avatar: position, yaw, pose, wall angle, eye look, speed, orientation `q` (packed quaternion), stuck `at` | owning device | `net.publish` 20/s; the partner is drawn from an allocation-free ring-buffer interpolation at `now − 100 ms` (q by slerp) |
| hider position during Hide | owning device | **not sent** — presence carries zeros and `v: 0` |
| paint texture | owning device | reliable blob at lock (+ snapshot on resync) |
| mode, map, first hider, rules (validated) | host | reliable `setup`; rules also inside every `ph` match info |
| phases `hide lock seek found time recap final` (+ local `curtain`) | host | reliable `ph {seq, at, dur, scores, match}` **plus two unreliable copies** (deduped by `seq`, not held back by in-order delivery); both devices switch with `setTimeout(at − now)` and a per-frame check |
| timed transitions | host | pre-announced one lead (≥ 380 ms, `1.3 × RTT + 160`) before the deadline so both flip exactly at it |
| shots, splats, pellets | shooter | reliable `shot` |
| tag confirmation | victim | reliable `tagres` |
| round result + scores | host | inside `ph` |
| scan / scurry / zip | seeker / hider | reliable `scan {at, left}` / `scurry {at, left}` / `zip {at, to, left}` |
| spawns | host | inside `ph` data (`hide`: indices, `seek`: the seeker's) |
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
   TV unit, yarn basket, chevron pouf, floor cushions, toy chest, plants, window, art. v2 adds
   climbing: an exposed rafter across the room (a ceiling to crawl along and hang from), a
   pendant lamp on a cord over the dining table, a floating shelf on the right wall and a curtain
   rail (perch), and a board ceiling over the room (a seeker looking up no longer sees a blank
   void; it's a real `{ ceil }` surface, with a non-climbable lip over the open front).
2. **Garden** (12 × 10 m) — mown-stripe lawn, box hedges and topiary, three flower beds,
   picket fence + gate arch, striped deck chair, parasol table set, shed, log pile, stepping
   stones, pond with lily pads, washing line with towels, wheelbarrow, gnome, bird bath.
3. **Art Studio** (10 × 8 m) — splattered floor, colour-swatch wall, tape-striped wall, white
   brick wall, easels with canvases, leaning canvases, jar shelves, paint cans, plinths with
   sculptures, checker rug, drop cloth and a cloth pile, work table, apron rack, and (v2) a
   panelled ceiling. `room(b, { ceiling: { tile, color, rep } })` draws the downward face only.
4. **The level designer's big maps** (`maps/`, 430–1770 m², multi-room, two floors, stairs,
   ceilings): House, Market, CU Boulder, Greenhouse (see `maps/*.js`). They go through exactly the
   same tests (spawns clear, camo wall, probes) plus the big-map match and perf sections.

## Art

Printed-diorama toon look: one shared `MeshToonMaterial` for the whole map (vertex colours ×
atlas tile via `onBeforeCompile`, 3-step gradient map), ink outlines **baked into the same
merged geometry** as inverted-hull backfaces pushed along smoothed normals in the vertex
shader (width grows gently with distance; big walls get a cheap ink cap instead), blob
shadows (one merged transparent mesh), warm key light + hemisphere fill kept just under 1.0
so painted colours never clip (the hemisphere's ground colour is a light warm bounce and the
ramp's darkest step is 0.42, so ceilings and undersides read as lit surfaces instead of mud;
bodies share the lights and the ramp, so camouflage still matches), paper-tone sky and fog from the theme (dark mode follows the
OS / app theme live). Player inks (`--p-a`, `--p-b`) colour liveries, pellets, splats, trails,
paths, confetti and HUD accents; `--g-hl` is the scan glint and the reveal outline. The HUD is
sticker-style DOM (card, ink border, hard shadow), sounds are synthesised WebAudio (unlocked on
the first touch, respecting the app's mute switch).

## Performance

- WebGL2, `antialias: false`, `powerPreference: 'high-performance'`, `alpha: false`,
  `stencil: false`. Pixel ratio `min(dpr, 2)` × a dynamic scale 0.6–1.0 stepped once a second
  from an EWMA of frame time.
- Draw calls: map chunks (1 on the small dioramas, the visible rooms on big maps) + blobs 1 + ~12
  per visible chameleon + instanced fx (splats, pellets, confetti, trail, path, tongue) ≈ 19 in
  the hide phase on a small map, ≤ 55 anywhere on the biggest map. Maps ≈ 10–100 k vertices.
- Big maps: per-room chunks with their own bounding spheres (frustum culling), fog + far plane at
  26 m, a 1.5 m collision grid (each query touches a handful of the 929 boxes on the biggest map).
- Shaders are compiled with `renderer.compile()` behind the loading card.
- Per frame: no allocations in game code (ring buffers, shared vectors, stable HUD
  descriptors, DOM writes only on change); net.js allocates one object per publish (20/s).
- Pauses rendering when hidden; handles `webglcontextlost` / `restored` (paint buffers
  re-uploaded, programs recompiled, "Tap to resume").
- `destroy()` disposes every geometry, material, texture and the renderer (and forces context
  loss), removes all listeners, timers and DOM.

## Tests (`node tools/test/games/chameleon.test.js`, ports 8910–8919; `PORT=8970` moves them)

Sections (select with `ONLY=`): `hotseat`, `desktop`, `dark` (one-device rounds + screenshots
at 390×844 and 1280×800, light and dark), `match` (full 4-round Hide & Seek on two phones
through the UI, eyedropper probes, paint hashes, splats, scan, scurry, tags, round swap, end
card, one result, phase sync), `lossy` (20 % drops, 90 ms), `db`, `disconnect` (guest and host
reloads), `robust` (iPhone 13 perf, draw calls, context loss/restore, visibility), `leaks`,
`maps` (every map in `MAPS`, picked through the settings sheet), and v2: `crawl` (walk into a
wall, crawl up onto the rafter, back down, hang; the partner draws the published orientation; a tag
on a ceiling hider; a tongue-zip down while hunted), `sizes` (every size on both devices),
`settings` (presets, live sync, validation, persistence, the match uses them), `toggles` (stamp
off, walls & ceilings off), `bigmatch` (a 2-round match on the biggest map), `bigperf` (draw
calls, triangles, JS ms and heap growth on the biggest map), `shots2` (screenshots of the new
mechanics and the settings panel at 390×844, 844×390, 1280×800, light and dark). Screenshots go
to `$SHOTS` (default `$TMPDIR/chameleon-shots`).

## Known limits

- Sticky-feet surfaces are the collider boxes, so curved props (pots, lathes, spheres) are crawled
  as their bounding boxes; maps keep colliders tight where climbing matters.
- Tag confirmation tolerance never shrinks below v1's 0.75 m for Tiny/Small (it covers lag, not
  body size); the pellet itself still has to hit the (smaller) mesh.

- Headless Chromium renders WebGL in software, so test frame times (~70–200 ms) say nothing
  about phones; the JS cost per frame (~0.1 ms) and draw calls are the meaningful numbers.
- Phase-switch skew in tests is dominated by main-thread lateness on a loaded CI box; the
  shared clocks themselves agree within a few ms.
- One device can't play Double Blind (it needs simultaneous hunting).
