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
