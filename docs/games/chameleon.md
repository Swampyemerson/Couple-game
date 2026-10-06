# Blend & Seek (`chameleon`)

A two-player 3D hide-and-seek built around one idea: **you paint yourself to disappear**.
Every chameleon starts plain white. The hider explores a little diorama, picks a spot and a
pose, then paints their own body — brush, fill, an eyedropper that drinks colours from the
world, and a stamp that photocopies the surface under them onto their skin. The seeker then
hunts in first person with a handful of paint pellets.

Live game: `kind: 'live'`, modes `live` (two devices) and `local` (one device, hotseat),
phone + computer, versus, `immersive: true` (draws its own HUD and scores).

## Modes

| Mode | Players | Rounds | Scoring |
|---|---|---|---|
| **Hide & Seek** | one hides, one seeks, roles swap | 4 (each hides twice) | hider earns 1 pt per second survived in the seek phase, +30 for surviving outright. Highest total wins. |
| **Double Blind** | both hide at once, then both hunt (slowly) | best of 3 | first confirmed tag wins the round; a timeout is a void round. Needs two devices. |

The host picks mode, map and first hider on the start screen; the guest sees every change live.

## Round flow (Hide & Seek)

```
title (1.5 s) → HIDE 60 s → LOCK (~2 s) → SEEK 90 s → FOUND / TIME (3 s) → RECAP (≤ 9 s) → next round
```

- **Hide**: the seeker is blindfolded (a card with the timer). The hider explores in third
  person, jumps onto furniture, picks a pose (stand, crouch, wall, ball, flat) and paints.
  “I'm hidden” ends the phase early.
- **Lock**: the hider's paint is quantised and sent; the seeker's device rebuilds it and
  acknowledges; then a 3-2-1 lifts the blindfold. The hider is never drawn on the seeker's
  screen before its paint has arrived.
- **Seek**: the seeker has **6 pellets** and a **chirp scan** (every 30 s: the hider's eyes
  glint for 0.4 s). A miss leaves a splat both players see. The hider watches through their
  own eyes (head-look only) and has **one scurry** (a 3 m dash that leaves a faint trail for 2 s).
  Running out of pellets ends the round: the hider survives outright.
- **Found / Time**: freeze-frame, camera whip to the hider, paint confetti in the winner's ink.
- **Recap**: a slow orbit around the hiding spot — “they were RIGHT there” — with the
  seeker's path drawn on the floor, the closest call, pellets used and points.

Double Blind uses the same phases with both players hiding (60 s), then seeking (90 s, 1.1 m/s,
5 pellets each, scan each). One device: Hide & Seek only, with “Seeker, look away” and
“Hider, hand it over” curtains; the canvas is hidden behind each curtain.

## Controls

| | Phone | Computer |
|---|---|---|
| Move | floating joystick, left half | W A S D / arrows |
| Look | drag on the right half | mouse (pointer lock on click; drag if refused) |
| Jump / crouch | buttons | Space / C |
| Poses | pose bar (5) | 1–5 |
| Paint mode | Paint button: orbit camera, 1 finger paints, 2 fingers rotate + pinch zoom, 1 finger off-body rotates | P; drag on body paints, drag elsewhere / right-drag orbits, wheel zooms |
| Paint tools | Brush (tap again: size) · Fill · Pick · Stamp · Undo, plus soft/hard | B, G, E, T, Z |
| Fire / Scan / Scurry | buttons | click / Q / F |
| Ready | “I'm hidden” | R |

Touches that start within 20 px of the left edge are ignored (iOS back gesture). Play
surfaces use `touch-action: none` plus non-passive `touchstart`/`touchmove` `preventDefault()`.

## Paint pipeline

- Body texture: one **128×128 canvas** atlas. Every body part (body, head, casque, eye
  turrets, tail, legs, feet) owns a rectangle; the part geometry's UVs are remapped into it.
- At load the geometry is rasterised into the atlas to build a **texel → surface map**
  (part, local position, local normal), dilated 2 px into the gutters. Brushes, fill and stamp
  work on that map **in 3D**: a dab paints every texel within the brush radius of the hit
  point, so strokes cross UV seams and part boundaries cleanly and never stretch.
- **Fill** colours one body region (body, head, tail, legs…).
- **Pick (eyedropper)** raycasts and returns the **albedo** under the finger: vertex colour ×
  atlas texel at the hit UV, darkened by any blob shadow there (the body is lit by the same
  toon lights, so matching albedo is what blends).
- **Stamp** finds the surface you are touching (pose-aware: floor for flat, wall for wall…),
  builds the hit triangle's world→UV affine map and projects every outward-facing texel onto
  that plane, copying the pattern. It is perfect from the front and breaks with parallax —
  seekers who move around can spot it.
- **Undo**: 24 snapshots of the RGBA buffer.
- **Sync**: at lock the canvas is **median-cut quantised to ≤ 32 colours in place** (so the
  hider sees exactly what is sent), encoded as palette + byte ops (short run, long run,
  copy-row-above), base64'd and sent as reliable chunks of ≤ 3.2 KB with an FNV-1a checksum
  of the RGBA. The receiver decodes, verifies and acknowledges; a bad checksum asks again.

## Netcode (net.js via `chameleon/link.js`)

`link.js` wraps `createNet` with a **session handshake**: each mount has a random session id
and greets the partner with raw `hi` messages; net.js runs on a channel namespaced by both
session ids. When either side remounts (reload, rejoin), the pair gets a fresh net instance,
fresh clock sync and fresh reliable sequence numbers (net.js on its own would hold the
reloaded side's messages forever waiting for old sequence numbers). The game then pauses,
resyncs from a snapshot and resumes with a countdown.

| State | Authority | Transport |
|---|---|---|
| own avatar: position, yaw, pose, eye look | owning device | `publish` 20/s → partner draws an allocation-free interpolation at `now − delay` |
| hider position during Hide | owning device | **not sent** (presence carries `vis: 0`) |
| paint texture | owning device | reliable blob at lock (+ snapshot on resync) |
| mode, map, first hider | host | reliable `setup` |
| phases (`hide`, `lock`, `seek`, `found`, `time`, `recap`, `final`) | host | reliable `ph {seq, at, dur}` on the shared clock; both switch by `setTimeout(at − now)` |
| shots, splats, pellets | shooter | reliable `shot` |
| tag confirmation | victim | reliable `tagres` |
| round result, scores | host | carried in `ph` |
| scan / scurry | seeker / hider | reliable `scan {at}` / `scurry {path}` |
| pause / resume | host (devices report `vis`) | `pause {remaining}` / `resume {at, dur}` |

**Fair-shot rule (shooter-favoured, 250 ms).** The shooter raycasts against the hider exactly
as drawn (`net.remote(shotTime)`, i.e. `now − delay`) and sends the hit with the position it
saw. The hider's device keeps 2 s of its own position history and confirms when any of its
true positions in `[shotTime − delay − 250 ms, shotTime]` is within 0.75 m of the position
the shooter saw. So what you see is what you hit, unless the hider had already scurried away
more than a quarter second earlier. In Double Blind the host takes the earliest confirmed tag
within a 250 ms window.

Budget per device: presence 20/s + `hi` 1/s + net.js pings and acks; reliable events are a
few per second except the paint burst (≤ 6 chunks).

## Maps (deterministic data, no assets)

All built from primitives (rounded boxes, cylinders, spheres, tapered tubes) and procedural
canvas patterns packed into one **1024² atlas per map** (tiles repeat in the shader with
`fract` + `textureGrad`). Each has spawns, nooks, probe points for tests.

1. **Living Room** — striped wallpaper, floral wall, kilim rug, mustard tweed sofa with
   polka/stripe cushions, bookshelf of coloured spines with gaps, armchair, coffee table,
   floor lamp, plants, yarn basket, dining nook under the table.
2. **Garden** — mown-stripe lawn, box hedges, flower beds, picket fence, striped deck chair,
   parasol table, shed, stepping stones, washing line, log pile, pond.
3. **Art Studio** — splattered drop-cloth floor, colour-swatch wall, canvases on easels,
   paint jars and cans, plinths, checker rug, tape-striped wall.

## Art

Printed-diorama toon look: one shared `MeshToonMaterial` (vertex colours + atlas, 3-step
gradient map, warm key light + hemisphere fill), ink outlines **baked into the same merged
geometry** as inverted-hull backfaces (pushed along smoothed normals in the vertex shader,
width grows gently with distance), blob shadows (one merged transparent mesh), paper-tone sky
and fog from the theme. Player inks (`--p-a`, `--p-b`) colour pellets, splats, trails,
confetti and HUD accents; `--g-hl` is the scan glint. Chameleons have no outline (it would
give them away); their only tells are blinking eyes and parallax.

## Performance plan

- WebGL2, `antialias: false`, `powerPreference: 'high-performance'`, `alpha: false`,
  `stencil: false`. Pixel ratio `min(dpr, 2)` × a dynamic scale 0.6–1.0 driven by an EWMA of
  frame time.
- Static map = **one merged mesh** (+ one blob-shadow mesh). Avatars ≈ 12 meshes each sharing
  one material. Fx (splats, pellets, confetti, trail, path) are InstancedMeshes. Target
  < 60 draw calls.
- Shaders warmed with `renderer.compile()` behind the loading card.
- No per-frame allocations: preallocated vectors, ring-buffer interpolation, DOM writes only
  when a value changes.
- Pauses rendering on `visibilitychange`; handles `webglcontextlost` / `restored` (re-uploads
  the paint canvases, recompiles, “Tap to resume”).
- `destroy()` disposes every geometry, material, texture, the renderer and all listeners.
