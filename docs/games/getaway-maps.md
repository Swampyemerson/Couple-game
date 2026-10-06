# Getaway: map contract

Getaway (`js/games/getaway/`) is a two-player 3D car chase. One player drives the runner, the
other drives the cop, and the roles swap each round. This file is the contract between the game
engine (owned by the lead engineer) and the map files (owned by the map designers). Both sides
may add optional fields. Nobody removes or renames a field without agreeing it first.

## Files

- `js/games/getaway/maps/index.js`: `export const MAPS = [...]`. Owned by the lead.
- `js/games/getaway/maps/boulder.js`: `export const BOULDER`. Owned by the Boulder designer,
  along with any `boulder-*.js` helpers.
- `js/games/getaway/maps/santee.js`: `export const SANTEE`. Owned by the Santee designer, along
  with any `santee-*.js` helpers.
- Map files must not import the engine, and must not import each other. `three` and the kit are
  passed in.

## Coordinates

- 1 unit = 1 metre. y is up.
- **North is −z and east is +x on every map**, so the minimap and compass are shared.
- Maps are real places, laid out by real bearings, but compressed: about 0.5–0.7× real
  distances is fine. The goal is fun chases of 2–4 minutes at up to about 45 m/s, not survey
  accuracy. A map should be roughly 1.2–2.5 km across.

## Entry shape

```js
export const BOULDER = {
  id: 'boulder', name: 'Boulder', blurb: 'Broadway to Baseline, Flatirons on your right',
  bounds: { x0, z0, x1, z1 },          // outer limit; the engine adds an invisible wall here
  height: (x, z) => y,                 // optional terrain. Keep slopes gentle (≤ 12% on roads).
                                       // Must be fast: it is called a lot. Default: flat 0.
  roads: [                             // drivable centre lines; the ENGINE renders road ribbons,
    { name: 'Broadway', kind: 'arterial', width: 14, pts: [[x, z], ...], closed: false,
      bridge: false },                 // kind: highway | arterial | street | alley | dirt | ramp
  ],                                   // width = full asphalt width in metres; pts = polyline
                                       // (the engine smooths it), ≥ 8 m between points
  open: [                              // other drivable or semi-drivable ground, as polygons
    { kind: 'lot', poly: [[x, z], ...] },  // lot (asphalt, full grip), grass (slower),
  ],                                        // dirt (slower, dusty), sand (much slower)
  solids: [                            // collision footprints. Oriented boxes. Cars hit these.
    { kind: 'building', x, z, w, d, rot, h },  // rot = radians around y
  ],                                   // kinds: building wall rock tree pole barrier
                                       // bollard. Small things (pole, tree, bollard) are
                                       // breakable: a fast hit knocks them over.
  water: [{ poly: [[x, z], ...] }],    // driving in = car stalls and is disabled (a runner who
                                       // drives into the lake is busted)
  spawns: [                            // round starts; pick fairly
    { runner: { x, z, yaw }, cop: { x, z, yaw } },  // cop 60–100 m behind the runner, same road
  ],
  landmarks: [{ name: 'Pearl St Mall', x, z }],  // shown on the map and in the round intro
  sky: { top: '#…', horizon: '#…', fog: '#…', fogNear: 120, fogFar: 520,
         sun: { bearing: 250, elev: 30 } },      // bearing in compass degrees
  build(THREE, kit) { return group; },  // everything visual except road ribbons and markings:
                                        // buildings, sidewalks, props, terrain, water, trees
  backdrop(THREE, kit) { return group; }, // far scenery (mountains). Fog-free and never culled.
                                          // Low-poly.
};
```

### What `kit` gives `build()`

These are the only kit fields to rely on. Others may be added.

| Field | What it is |
|---|---|
| `kit.chunk(x, z)` | Returns a `THREE.Group` for the 200 m grid cell containing (x, z). Put static meshes there so the engine can cull by distance and frustum. If the kit lacks it, add to the returned group instead. |
| `kit.toon(color, opts)` | The game's shared toon material. Fallback: `MeshLambertMaterial`. |
| `kit.seeded(n)` | A deterministic PRNG. Both phones must build identical worlds, so never use `Math.random()`. |
| `kit.quality` | `'low' \| 'mid' \| 'high'`. On low, skip the fancy extras. |

## Budgets (iPhone 13, the minimum target)

- Draw calls in view: **≤ 90**. Use `InstancedMesh` or merged geometry per chunk; do not make
  one mesh per building.
- Triangles in view: **≤ 220k**. The whole map should total ≤ 900k.
- Build time: **≤ 1500 ms** in the browser, and it must not freeze the UI for more than about
  200 ms at a time.
- Textures: canvas-generated, ≤ 2 × 1024² per map. No network assets.

## Look

The app's riso-print, cartoon style (see the toon shading in Rush and Blend & Seek): bold
flat colours, readable silhouettes. It should feel like a GTA-style 3D city seen from a chase
camera, not a top-down map.

## Engine semantics and optional additions (from the lead engineer)

Everything below is optional and feature-detected. The fields above are unchanged.

### Conventions

- **Yaw** (spawns) is a compass bearing in radians: 0 = north (−z), π/2 = east (+x). A car's
  heading is `(sin yaw, −cos yaw)`.
- **`solids[].rot`** follows THREE's `rotation.y`: `mesh.rotation.y = rot` draws the same box.
  `solids[].y` (optional) is the base height. A solid whose base is more than 2 m above the car is
  overhead and isn't hit (signs, gantries).
- **Ground that is in no road, open polygon or water** behaves like `grass`: slower grip and top
  speed, with dust. Mark hills explicitly as `open` kind `dirt`.
- **Surface order** at a point: road (or bridge deck) → water → open polygon (later polygons win)
  → grass. So water wins over a sand bed around it, and a road or deck over water is never water.
- **Bridges** (`roads[].bridge: true`): the deck is its own level, raised over whatever lies
  below. A car steps onto it from either end (within 14 m of an end) and rides the deck, with rails,
  until it leaves at an end. A car that crosses the footprint anywhere else is at grade and passes
  under. Water and sand don't apply on the deck. Deck height is the straight line between the
  ground at its two ends plus a rise of up to `clear` metres (default 5.5 when a non-bridge road
  crosses under it, else 2.2), with 12% ramps. Two cars on different levels (more than 2.5 m apart
  vertically) don't collide. The engine draws the deck slab, rails and piers.
- **Intersections**: non-bridge roads that cross become intersections. The engine skips lane
  markings and curbs where another road joins.

### Optional map fields

| Field | Meaning |
|---|---|
| `ground: '#hex'` | The engine draws a terrain mesh from `height()` in this colour, per chunk. Leave it out if you draw your own ground. |
| `prepare(kit)` | Returns a Promise. The engine awaits it after the map is chosen and before reading `roads`, `solids`, `height` or `spawns`. Generate in slices with `await kit.slice()`. Before that, the picker reads only `id`, `name`, `blurb`, `stub` and `bounds`. |
| `build` / `backdrop` | May return a Promise, or be a generator that `yield`s between steps. The engine slices at about 12 ms. |
| `animate(tSeconds, cars)` | Called every frame; `cars = [{x, z}, {x, z}]`. Cosmetic and local only, wrapped in try/catch. |
| `spawns[i].where` | A label such as "Weston, by Boulder Way", shown in the round intro instead of the nearest landmark. |
| `landmarks[i].home: true` | Drawn with a pink house icon on the minimap and the full map; the lobby title shot orbits it. |
| `landmarks[i].far: true` | Beyond the bounds: skipped on the minimap, pinned to the edge of the full map with an arrow. |
| `roads[i].lanes` | Traffic lanes per direction (default: highway 2, arterial 2 when ≥ 14 m wide, else 1). |
| `roads[i].traffic: false` | No civilian traffic on this road. `oneway: true` gives traffic one direction only. |
| `roads[i].clear` | Bridge deck clearance in metres. |
| `solids[i].drawn: true` | The map drew this solid itself; the engine uses it only for collision. |

### Engine-drawn solids

Solids **without** `drawn: true` are drawn by the engine. Small kinds (`tree pole bollard hydrant
lamp signal sign mailbox cactus shrub`) are **breakable**: they are written into the chunk's merged
geometry, and a hit at more than 9 m/s knocks one over (it falls in the direction of the hit,
can't be hit again, and stands back up at the next round). They use `style` hints: `cottonwood`,
`pine`, `aspen`, `palm`, `jacaranda`, `lamp`, `signal`, `bollard`, `hydrant`, `pole`, `sign`,
`mailbox`, `cactus` and `shrub`, plus `color` (the main part) and `h` (height). An unknown style
falls back by kind (tree → a round tree, anything else → a pole). Lamps and signals extend their
arm along the solid's local −x, so set `rot` to point it over the street. Other kinds without
`drawn` are drawn as plain toon blocks (building with windows, wall, rock, barrier).

### More kit

| Field | What it is |
|---|---|
| `kit.toon(color, opts)` | opts: `{ vertexColors, windows: true, glow: true, side: 'double', outline: metres, transparent, opacity, fog }`. `color` may be null or white with `vertexColors`. `windows` draws a facade window grid in the shader (lit at night); `glow` is unlit. **Every opaque toon mesh in a chunk is merged into one draw call per family** (front, double-sided), with material colours baked into vertex colours, so many colours cost nothing. Textured or transparent meshes stay separate. |
| `kit.builder()` | Merged vertex-colour geometry with ink outlines: `b.box(cx, cy, cz, w, h, d, rotY, color, outline, fx)`, `b.boxOn(x, y0, z, …)` (stands on y0), `b.cyl`, `b.cone`, `b.sphere`, `b.add(b.T.wedge / roof / cone5 / ico / wheel, …)`, `b.quadUp(…)`, `b.poly(verts, color)`, `b.geometry(threeGeometry, matrix4, color, outline, fx)`, then `b.mesh(kit.toon(null, { vertexColors: true }))`. fx: 0 plain, 2 windows, 3 glow. `js/games/getaway/maps/dockside.js` is a worked example. |
| `kit.slice()` | `await` it between steps; it yields to the browser when about 12 ms have passed. |
| `kit.palette`, `kit.dark` | Theme colours (`[r, g, b]` in 0..1) and whether this is dark mode. Dark mode is night: darken your colours (windows light up by themselves). |
| `kit.height`, `kit.roads`, `kit.nearestRoad(x, z, out, maxD)` | The engine's height function, smoothed roads and nearest-road lookup. |
| `kit.ink` | The outline colour. |

### Bundling

The artifact bundler recognises `export` only at the **start of a line**: one export per line,
named imports only (`import { A } from './x.js';`), no `export { … }` lists and no default
exports. Check with `python3 tools/build_artifact.py --only=getaway`.

### Checking a map

`ONLY=perf node tools/test/games/getaway.test.js` builds every playable map on a phone (844×390)
and a laptop (1280×800) profile. It measures draw calls and triangles from every spawn, plus
sampled road points in four directions, and the build's longest main-thread block.
`ONLY=mapswitch` switches between all maps several times and renders after each switch.
