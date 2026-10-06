# Writing a game for Just Us

Every game is one file, `js/games/<id>.js`, whose file name equals its `id`. It imports helpers
from `./core.js` and calls `registerGame({...})`. The artifact build bundles every
`js/games/*.js` automatically, each in its own strict-mode scope. Also add an import line to
`js/games/index.js` for the plain web version.

Read the two reference games first: `js/games/example-ttt.js` (turns) and
`js/games/example-tap.js` (live). The engine is `js/games/core.js`. **Don't edit `core.js`,
`games.css`, `app.js` or anyone else's game.** If you need an engine change, work around it
and say so in your report.

## The definition

```js
import { registerGame, rand, randInt, shuffled } from './core.js';

registerGame({
  id: 'four',                 // == file name. lowercase, digits, dashes
  title: 'Four in a Row',
  blurb: 'Drop discs. Line up four.',     // one short line for the hub card
  kind: 'turns',              // 'turns' (take turns, async OK) | 'live' (real time)
  team: false,                // true = co-op (both win or lose together; result.score is the team score)
  secret: false,              // true = each player has hidden info: same-phone play shows a
                              //   "pass the phone" curtain between players
  tags: ['brainy'],           // any of: brainy, silly, quick, 3d
  minutes: 5,                 // typical game length
  howTo: ['Tap a column to drop a disc.', 'Four in a row wins — across, down or diagonal.'],  // ≤ 4 short lines
  css: `...`,                 // your styles, injected once. Scope EVERY selector under a class
                              //   unique to your game, e.g. .g-four ...
  endDelay: 900,              // ms between the final move and the end card (time for your finale)
  platforms: ['phone', 'computer'],  // devices it works on (default both); the hub shows badges
  best: 'phone',              // optional: the device it's best on
  modes: ['online', 'local'], // start options. turns default ['online','local'];
                              //   live default ['live','local']. ['live'] = two devices only
  immersive: false,           // true = full-screen stage, floating back/menu; draw your own HUD
  hue: 0,                     // optional card tint tweak
  // turn games: init / next / apply / result / score   (below)
  mount(el, api) { ...; return { update(ctx) {}, destroy() {} }; },
});
```

## Turn games (`kind: 'turns'`)

A match is two append-only move lists, one per player. Both phones replay them through your
pure functions, so they always agree, and each phone only writes its own list.

```js
init({ first, seed, opts })  -> state        // first: 'a' | 'b' starts. state must be JSON
next(state)                  -> [] | ['a'] | ['b'] | ['a','b']   // who may act now; [] = game over
apply(state, who, move)      -> state        // you get a private clone: mutate it and return it.
                                             // THROW new Error('message') to reject a bad move;
                                             // the message is shown to the player
result(state)                -> { winner: 'a'|'b'|null, text?, sub?, score? }   // when next() is []
score(state)                 -> { a, b }     // optional; shown in the player chips
```

Rules for the rules:
- **Deterministic.** No `Math.random()`, no `Date.now()` inside init/next/apply. Randomness:
  `rand(state.seed, 'roll', turnNo)` → [0,1), `randInt(n, seed, ...keys)`, `shuffled(array, seed)`.
  The engine puts `seed` on your state automatically.
- **Moves are small JSON**: `{ col: 3 }`, `{ word: 'crane' }`. Never put derived data in a move.
- **Simultaneous phases**: when `next()` returns `['a','b']`, the two players' moves must not
  depend on each other's order (e.g. both choosing a secret word). When a player has finished
  their part of the phase, stop listing them.
- **Extra turns** are fine: just return the same player again from `next()`.
- Everything — moves and state — is visible to both phones' code. Hide secrets in the UI by
  only drawing what `ctx.viewer` is allowed to see.
- Whole match must stay under ~150 KB of JSON (drawings: quantize points).

### mount + update

`mount(el, api)` runs once. Build your DOM inside `el`. Return `{ update(ctx), destroy() }`.
`update(ctx)` runs whenever the moves change (yours or your partner's) or the viewer changes:

```js
ctx = {
  state, acts, over, result, last,  // last = { who, move, n } — animate the newest move
  moves,                            // number of applied moves (use to detect "new since last update")
  mode,                             // 'online' (two phones) | 'local' (one phone)
  me,                               // online: 'a'|'b' (this phone). local: null
  actor,                            // who is allowed to move right now on THIS phone, or null
  viewer,                           // whose perspective to draw (and whose secrets to show)
  canMove,                          // actor != null && !over
  first, curtain, matchId,
}
```

`ctx.prev` is the state before the newest move (handy for replaying it). Optional hooks on the
object you return from mount: `onEndClosed()` runs when the player taps the end card's look
button (label it with `endLookLabel: 'See the gallery'` on the def). Set `endDelay: 'manual'`
to hold the end card until your finale calls `api.showEnd()` (8 s safety net). Inside your own
end-of-game UI, buttons with `data-g="rematch"` and `data-g="close"` trigger the engine's
rematch and back-to-games actions.

Call `api.move(move)` to play. It returns `{ ok: true }` or `{ ok: false, error }` — show
`error` with `api.toast(error)`. The engine re-runs `update` after every move. Don't keep your
own copy of the rules state; keep only view state (animation, selection, drafts).

## Live games (`kind: 'live'`)

Modes: `api.mode === 'local'` (one phone: you handle both players' input, e.g. split screen
with the top half rotated 180°) or `'live'` (two phones, real time).

Online, player `'a'` is the host (`api.isHost`) and runs the simulation. Then:
- `api.setPresence(obj)` — your continuous state (paddle, puck, scores). Absolute values,
  never deltas. Coalesced to ~30/s. ≤ 3.5 KB.
- `api.partnerState()` / `api.onPartnerState(fn)` — the other phone's latest presence object.
- `api.send(type, data)` / `api.on(type, fn)` — rare discrete events (a few per second at
  most): 'goal', 'start', 'tap'. Not delivered to yourself.
- `api.partnerHere` / `api.onPartnerHere(fn)` — pause when they drop.
- `api.finish({ winner: 'a'|'b'|null, text?, score? })` — host (or local) calls this once. The
  engine records it, shows the end card on both phones, and handles rematch by destroying and
  re-mounting your game.
- `api.setScore({ a, b })` updates the player chips.
Messages can drop: design so the latest presence is always enough to recover.

## The api object (both kinds)

| | |
|---|---|
| `api.mode`, `api.me`, `api.names`, `api.name(w)`, `api.other(w)` | who's who |
| `api.color(w)` | `'var(--p-a)'` / `'var(--p-b)'` |
| `api.tokens()` | resolved theme colours `{a, b, aSoft, bSoft, bg, card, ink, muted, line, hl, good, bad, onInk, fontDisplay, fontBody, dark}` for canvas/WebGL |
| `api.toast(msg)` | short message |
| `api.sfx(name)` | `tap place flip good bad win lose tick hit pop` |
| `api.haptic(ms)` | vibrate (may do nothing) |
| `api.audio()` | the shared WebAudio context (unlocked on first touch); use it for your own synths and check `muted()` |
| `api.three()` | Promise → `THREE` (three.js r128). Handle rejection with a 2D fallback or a clear message |
| `api.setStatus(text \| null)` | override the status line under the player chips |
| `api.rand / randInt / rng / shuffled` | seeded randomness |

## Look and feel

The game room is **printed in four Riso inks on paper**: Blue (Emerson), Fluorescent Pink
(Sydney), Yellow (highlight) and a Black key plate for text and outlines. Flat ink, crisp
2 px outlines, hard offset shadows (never blurred), chunky display type. Dark mode is the
same job screen-printed on black card stock: the inks get brighter, the key plate turns
cream, shadows go black. Use the tokens, never hard-coded colours, and it follows the theme.

| Token | Use it for |
|---|---|
| `--p-a` `--p-b` | each player's ink: pieces, fills, their side of the board |
| `--p-a-soft` `--p-b-soft` `--g-hl-soft` | 20 % tints of the inks: backgrounds, hints, "last move" |
| `--p-a-text` `--p-b-text` | a player's colour **as small text on paper** (the full inks are too light for that) |
| `--g-bg` `--g-card` | paper; brighter stock for raised pieces and panels |
| `--g-ink` | text, outlines, grid lines that matter |
| `--g-muted` `--g-line` | secondary text; faint rules and empty grid lines |
| `--g-hl` | yellow: whose turn, the winning line, "look here" |
| `--g-good` `--g-bad` | right / wrong (both are text-safe on paper) |
| `--g-on-ink` | text **on** `--p-a`, `--p-b` or `--g-hl` (black overprint, ≥ 4.7:1 on all three, both themes) |
| `--g-white` | paper white in both themes (knockouts, stickers on a 3D scene) |
| `--g-edge` | colour of hard shadows: ink on paper, black on black stock |
| `--g-shadow-sm` `--g-shadow` `--g-shadow-lg` | ready-made hard shadows: 2 px, 3 px, 6 px offset, no blur |
| `--g-dim` | backdrop behind a sheet or modal of your own |
| `--g-halftone` | a halftone dot screen: `background: var(--g-halftone) 0 0 / 5px 5px` (shading, "disabled" areas) |
| `--g-radius` `--g-radius-sm` `--g-stroke` | 10 px, 6 px, 2 px outline |
| `--g-font-display` | Rammetto One: titles, big numbers, piece labels. Never body text. It has one weight: in CSS ask for `font-weight: 900` (the room sets `font-synthesis: none`, so Rammetto stays clean and fallbacks come out heavy); on a canvas use `400` |
| `--g-font-body` | Schibsted Grotesk 400–900: everything else (900 for small numbers) |

Rules of thumb: outline pieces in `--g-ink`; a "raised" piece gets a hard shadow and moves
*into* it when pressed (`transform: translate(2px, 2px)` + smaller shadow); where blue and
pink overlap you may `mix-blend-mode: multiply` them for a violet overprint (only over
white, or it goes muddy in dark mode). Never put small text in `--p-a`/`--p-b` on paper;
use `--p-a-text`/`--p-b-text`, or black text on an ink block.

**Shared kit** (defined in `games.css`, so it matches the chrome):

| Class | What |
|---|---|
| `.gm-btn` | primary button: ink block on a yellow plate. `.gm-btn-ghost` paper button, `.gm-btn-danger` red, `.gm-btn-big` full width 54 px |
| `.g-panel` | a raised printed surface (card stock, outline, hard shadow). `.is-flat` no shadow; `.is-a` `.is-b` `.is-hl` tinted |
| `.g-chip` | small pill label. `.is-a` `.is-b` `.is-hl` (ink fills) `.is-ink` |
| `.g-key` | keyboard key for word games: 52 px tall, flexes to fill a row (`display: flex; gap: 5px` on the row). `.is-wide` for Enter/Delete; states `.is-a` `.is-b` `.is-hl` and `.is-out` (letter ruled out) |
| `.g-label` | small caps label (0.7 rem, tracked, muted) |
| `.g-num` | big score numeral in the display face. `.is-a` `.is-b` print it in the player's ink with a key-plate offset |
| `.g-devices` `.g-device` | the printed phone / laptop badges the hub uses (`.is-best` = yellow) |

The stage is its own stacking context (`isolation: isolate`), so your z-indexes can't climb over
the end card, curtain or menu. On screens ≥ 900 px wide the game column grows to 1100 px
(phones keep the full width minus 12 px gutters), so side-by-side layouts have room; the
player chips stay a compact centred row.

Immersive games (`immersive: true`): the stage is the whole viewport, `.gm-versus` and
`.gm-status` are hidden (draw your own HUD), and back/menu become two 44 px yellow stickers in
the top corners, inside `env(safe-area-inset-top)`. Keep your HUD clear of the top ~64 px
corners, and handle the other safe-area insets yourself.

Phone first: it must work and look right at 360–430 px wide, portrait, with thumbs. Touch
targets ≥ 44 px. Use `touch-action: manipulation` (or `none` for drag/draw surfaces). No
hover-only affordances. Animate with transform/opacity; respect `prefers-reduced-motion`.
The stage (`el`) is a flex column that fills the space under the player chips.

Design bar: this should feel like a well-made indie game, not a template. Concrete, tactile
pieces (discs with weight, dice with depth, ink-on-paper boards), satisfying feedback on every
action (sound + motion), clear whose turn it is, and a little finale when someone wins. No
emoji as UI, no gradient-blob filler, no generic rounded-card soup, no soft blurry shadows.
Preview the chrome around your game with `node tools/test/design-preview.js light`.

## Testing

```
node tools/test/games/<id>.test.js
```
See `tools/test/smoke.test.js`. `launch({ port, only: ['<id>'], colorScheme, coarse, device, latency, dropRate })` opens two
phones (Emerson = `h.a`, Sydney = `h.b`) sharing a fake database and live room. Helpers:
`newOnlineGame`, `openMatch`, `newLocalGame`, `startLive`, `engine(page, id)`,
`matches()`, `results()`, `settle()`, `shot()`, `assertNoErrors()`. three.js is served locally.

## Netcode kit (for real-time games)

`js/games/net.js` sits on top of the live api and is what serious live games should use:

```js
import { createNet } from './net.js';
const net = createNet(api, { delay: 100, rate: 20, angles: ['yaw'] });
await net.ready;            // first clock sync (instant on one device)
net.now();                  // shared clock (ms) both devices agree on, within a few ms
net.rtt;                    // round trip in ms
net.send('hit', {...});     // reliable: exactly once, in order, retried through packet loss
net.on('hit', (data, sentAt) => {});
net.publish(myState);       // call every frame; streamed at `rate`/s with a shared timestamp
net.remote();               // partner state interpolated at now - delay (extrapolates briefly)
net.destroy();              // in your destroy()
```

Budget: each device gets ~40 room messages/s in total (presence + events), so stream at
≤ 20/s and keep reliable events to a few per second. One event ≤ 4 KB — chunk bigger payloads
across several `net.send` calls (they arrive in order). Patterns that work well:
- Each player is the authority for their own avatar; render the partner with `net.remote()`.
- The host (`api.isHost`) decides shared things (round start, scores) and announces them with
  `net.send`. Schedule synchronized moments on the shared clock: `net.send('start', { at: net.now() + 3000 })`.
- Deterministic worlds from a seed both devices know, so only inputs/outcomes travel.
- Hit checks: the victim's device decides (it has the true position), or the shooter decides
  using `net.remote(shotTime)` for lag compensation — pick one per game and stick to it.
See `tools/test/net.test.js` (clock sync, delivery under 30% loss, interpolation).
`launch({ dropRate: 0.2, latency: 80 })` makes the harness network worse for testing.

## Big games: several files

A game may split into helper modules, e.g. `js/games/rush/world.js`, imported from
`js/games/rush.js` with `import { buildWorld } from './rush/world.js'`. The build follows
imports, so only the entry file sits directly in `js/games/`. Named imports only.

## iPhone checklist (the app runs in the Claude iOS app's WKWebView, in an iframe)

- WebGL2 via three.js r128 (`api.three()`); don't depend on WebGPU (not reliable in WKWebView).
  `WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false })`,
  pixel ratio `min(devicePixelRatio, 2)` with dynamic resolution when frame time climbs.
- Few draw calls (< 80): merge static geometry, one vertex-coloured toon material, instancing,
  outlines baked in as inverted hulls. No shadow maps (blob shadows). Warm shaders up with
  `renderer.compile()` behind a loading screen. No allocations per frame.
- Handle `webglcontextlost` / `webglcontextrestored` and `visibilitychange` (pause + resume
  countdown). Keep GPU memory small; iOS kills pages around 300 MB.
- Touch: `touch-action: none` and non-passive touchstart/touchmove `preventDefault()` on play
  surfaces so the iframe/app sheet never scrolls or dismisses; ignore touches that start within
  ~20 px of the left edge (iOS back gesture). Recognise swipes in pointermove once past a
  threshold, not on pointerup.
- `navigator.vibrate` doesn't exist on iOS: feedback must be visual + audio. Unlock WebAudio
  on the first touch.
- `immersive: true` on a def gives a full-screen stage with floating back/menu buttons; the
  game draws its own HUD (including scores).
