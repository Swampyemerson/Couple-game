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
| **Hide & Seek** | one hides, one seeks, roles swap | 2 / 4 / 6 (setting; each hides half) | the hider earns 1 point per second survived in the seek phase, +30 for surviving outright (timer runs out, or the seeker runs dry: paid for the seconds survived), + a blend bonus for a paint job that matched its surface; the seeker earns ½ point per second left when they tag (+10 per spare pellet in Classic). Highest total wins. |
| **Double Blind** | both hide at once, then both hunt (1.1 m/s, no jumping) | best of 3 (ends early at 2) | first confirmed tag wins the round; a timeout or both players out of pellets is a void round. Two devices only. |

The host picks mode, map, a preset (or any custom mix of settings, below) and who hides first on
the start screen; the guest sees every change live (and their diorama backdrop switches with the
host's map choice).


## v3: the seeker climbs, the hider watches, paint while hunted, start timing

Asked for: "the finder needs the same modes as the hider so they can climb walls to find them. Also
add a way for the hider to watch them in free cam or spectator mode. And then also allow painting
even after it starts. And customizable start timing."

### The seeker climbs

With **Seeker can climb** on (every preset; it needs Walls & ceilings), the seeker gets the whole
v2 movement kit during the hunt, through the same code paths as the hider (`stick`, `zip`,
`crawlStep`, `setPose`, walk-into-a-wall, auto-perch): Stick / let go, crawl on walls, ceilings and
undersides, tongue-zip, wall jump, Hang, Perch, Squeeze, Corner. The guards (`climb: false`) stop
the seeker exactly as they stop the hider (same feelers, same refusals; tested on the House).

- **Camera.** First person with world-up was tried on paper and rejected for walls: on a ceiling
  your eyes are a few centimetres under the surface you're stuck to, half the view is that surface,
  and the screen-relative stick has no visible surface to be relative to. So while the seeker is
  stuck to something (or zipping) the view becomes a **close over-the-shoulder camera**: world-up
  (nothing rolls), behind and to the right of the body, kept in front of the surface (the same
  half-space rule as the hider's camera) and pulled in front of walls. A phone held upright sees a
  narrow slice sideways, so portrait sits further back (2.0 × size factor vs 1.55), less to the side
  and a little higher. The aim stays at the screen centre with no lag (position eases, direction
  doesn't), and when the body would cover the crosshair (looking straight down a wall, or the camera
  jammed into a corner) it fades to a ghost (final QA: it used to be hidden; collisions are the shared
  solver, see "Final QA" below). Let go / land → first person again, looking the same way (the
  view yaw is carried across both switches).
- **Hunting while climbing.** Fire and Scan work anywhere (pellets are raycast from the camera
  through the crosshair, ignoring your own body). Crawl speed is the seeker's walking speed × 0.78 ×
  the **Seeker climb speed** setting (Slow 0.65 · Normal 0.85 · Fast 1.0); no sprint on walls.
  Walking into a wall sticks after 0.45 s of pushing (the hider's 0.22 s grabbed seekers brushing
  past furniture). The seeker's tongue-zip is free with a 2.5 s cooldown; the hider sees the tongue
  (`zip {sk: 1}`) but no trail.
- **Partner's screen.** Presence already published the packed orientation `q` and `at` for whoever
  wasn't hiding, so the seeker's climbing pose and orientation reach the hider unchanged; a climbing
  seeker publishes its view as `yaw + ly` (body heading + look offset), which the hider's "Watch"
  view uses.
- **HUD.** Seven buttons (Stick, Zip, Pose / Scan, Sprint, Jump / Fire): three columns, Fire alone
  at the bottom right where the thumb rests (landscape: four columns, two rows). The pose bar adapts
  to the surface exactly as the hider's does. Keys: E stick, Z zip, Space jump (wall jump), 1–9 poses.

### The hider watches (two devices)

While hunted, the hider's **View** button (V) cycles **your eyes → watching the seeker → free cam**:

- **Watching** rides over the seeker's shoulder (their presence: position, orientation, `yaw + ly`,
  `lp`), through the shared camera solver; a seeker stuck to a wall or ceiling (`at`) gets the climb
  camera's framing, its surface normal taken from the drawn up vector (final QA: it sat inside the body).
- **Free cam** flies where you look (left thumb / W A S D, drag or mouse to look, Space / E up,
  Q / C down, Shift fast), collides with nothing and is clamped to the map's footprint and from the
  floor to just above its tallest collider.
- A **"You" sticker** marks your own body (pinned to the screen edge when it's off screen, and
  never over the role pill: where they'd overlap its label sits 6 px under it), the role pill turns
  yellow and names the view, and a thin highlight frames the screen.
- Purely local: the body never moves, its published look (`ly`, `lp`) is untouched, nothing is sent
  (tested: zero reliable messages, the seeker's copy unchanged). Escapes and poses are hidden while
  spectating; Paint switches back to your eyes. The heartbeat keeps beating.
- **One device: off.** In hotseat the hider has handed the phone to the seeker before the hunt, so
  there's no hider screen to spectate on (the recap already orbits the spot and draws the path).
  Double Blind has no spectating either (both are hunting).

### Paint while hunted

Setting **Paint while hunted**: **Off** (paint locks at the hunt, v2) · **On** (repaint any time,
silently) · **Shows** (repaint, but fresh paint glints for the seeker). Brush, fill, pick and stamp
all work; the camera orbits your body as in the hide phase (two devices only, as above).

- **Sync.** The same quantised blob as the lock (≤ 32 colours, run/copy codec, FNV checksum),
  marked `live`, sent when a stroke / fill / stamp / undo has settled and at most once a second. A
  typical update is 0.3–2.5 KB of base64: one chunk. A checksum mismatch asks for a resend (the
  lock's `paintreq`). Measured: a burst of four strokes costs 2–3 updates; the harness's 40 sends/s
  budget is never approached (presence 20/s + ≤ 2 chunks/s).
- **The tell ("Shows").** On the seeker's device the update is diffed against the old texture, up
  to three changed texels are placed on the body as drawn, and if any is within 6 m × size and has a
  clear line of sight from the seeker's camera (collider raycast), they twinkle for 1.1 s (the scan
  glint sprites, so they're depth-tested). At most one tell a second.
- **Defaults.** Easy **Off**: the friendliest hunt for the seeker, and the simplest rules for new
  players. Classic **Shows**: fixing a bad stamp mid-hunt is the fun part, but it's a gamble: do
  it while they're close and looking and you light up. Hard **On**: masters of disguise repaint
  silently (Hard is hard for the seeker); the seeker's only cue is noticing the colours change.

### Start timing

| Setting | Options | Easy | Classic | Hard |
|---|---|---|---|---|
| Hide time | 10 s – 5 min (5 s steps to 2 min, then 10 s, 15 s) | 45 s | 60 s | 75 s |
| Hide ends | **Timer** (Ready still starts early) · **On Ready** (no clock) | Timer | Timer | Timer |
| Countdown | Off · 3 · 5 · 10 s | 3 s | 3 s | 3 s |
| Head start (Hide & Seek) | Off · 5 · 10 · 15 · 20 · 30 s | 10 s | Off | Off |
| Grace period | Off · 3 · 5 · 10 · 15 s | Off | Off | 5 s |
| Seek time | 20 s – 10 min (5 s steps to 2 min, then 10, 15, 30 s) | 2 min | 90 s | 90 s |
| Seeker can climb | On · Off | On | On | On |
| Seeker climb speed | Slow · Normal · Fast | Fast | Normal | Slow |
| Paint while hunted | Off · On · Shows | Off | Shows | On |

```
title → HIDE (clock, or none with On Ready) → LOCK → countdown → SEEK [head start | hunt (grace) ] → FOUND / SURVIVED → RECAP
```

- **Ready** (the old "Hidden" button) ends the hide phase early in Timer mode; with **On Ready** the
  phase has no clock at all (the HUD says "No limit", the seeker's blindfold counts up).
- **Countdown**: the seek phase is queued that far ahead after the paint lock (two devices: never
  less than the network lead, ≥ 380 ms); both screens count it down ("Get ready 3-2-1" for the
  seeker, "Locked in · 3" for the hider; one device: the "get ready" card after the curtain).
- **Head start**: the first part of the seek phase. The seeker stays blindfolded (canvas hidden,
  "Blindfold on · head start" card, no moving, firing or scanning) while the hider gets the hiding
  moves back (walk, climb, zip without spending an escape, pose, paint: synced live). The hider's
  position stays private until 0.75 s before the blindfold lifts (so the seeker's interpolation
  buffer is warm even at the adaptive delay's 250 ms cap; it was 0.5 s with a fixed 100 ms delay),
  through the paint lock and the countdown too (final QA: the lock used to publish it, and the lock's
  paint blob carried it; with a head start the blob now carries only the seeker spawn the hider's
  phone picked). Only the hunt scores: points = seconds of hunt (+30 for surviving).
- **Grace period**: the first seconds of the hunt; Fire is disabled and reads "Wait 3".
- **One device**: the same clocks (the curtain used to start a fixed 60 s hide / 90 s seek whatever
  the settings said); the head start is just a blindfold countdown there (the hider has already
  handed over the phone).
- The seek phase carries `{ blind, hunt }`; the hunt starts at `phase.end − hunt`, which moves with
  pauses like every other deadline, so snapshots and resumes need nothing new.
- **Map scaling**: hide, head start and seek scale with the map (S 1× … XL 1.5×, rounded to 5 s);
  countdown and grace don't (they're about reacting, not distance). The sheet shows the effective
  hide, seek and head-start times on big maps.
- **Settings sheet**: a new **Timing** group; hide and seek time have a slider (previews while
  dragging, commits on release, so a guest isn't spammed and the host's sheet isn't rebuilt mid-drag)
  plus − / + for single steps. Everything goes through `sanitizeRules` on both devices, travels in
  `setup` and every phase message, and is saved per device as before.

## Pro pass: mechanics (feel, scoring, clocks)

Asked for: "polish the shit out of these games … immensely satisfying … addictive". Everything
below was measured with scripted runs (`ONLY=feel,feel2`; numbers in this section come from
those logs) and the pure physics was checked in Node (`move.js` + `world.js` run headless).

### Movement feel

- **Acceleration.** The stick is now a *target* velocity; the body's smoothed velocity
  (`b.svx/svz`, `accelStep` in `move.js`) accelerates toward it at **22 m/s²** (95 % of walking
  speed in 0.117 s), brakes at **30 m/s²** (3 → 0 m/s in 0.1 s) and drifts at **8 m/s²** in the
  air. A scurry dash is instant. Measured through the joystick on the phone profile:
  `0.87 → 1.37 → 2.01 → 2.51 → 3.01 m/s` over ~230 ms (sandbox frames are ~55 ms), stop in ~130 ms.
  The walk cycle (`st.walk`, 10/s damping) now lands with the body instead of 0.1 s after it.
  A tiny settle squash (0.22) on stopping; a hard reversal (> 120° at > 1.8 m/s) pops a small dust
  ring at the feet (the existing ring-pop fx, 0.08 m × size, no new draw calls).
- **Jump buffer + coyote time + short hop** (`JUMP = { buffer: 0.12, coyote: 0.1, shortV: 2.8 }`):
  a Jump tap up to 120 ms before landing is kept (`R.jumpAt`) and fires on touchdown; a tap up to
  100 ms after walking off a ledge still jumps (`coyoteJump`: never after a jump, never when
  stuck or squeezed); a held key released early clips `vy` to 2.8 m/s (apex 0.3 m instead of
  1.0 m at Large; touch taps always jump full height). A jump also refuses to double-fire from the
  buffer (`R.jumpAt` is cleared when it launches).
- **Jump was dead for player b in hotseat** (critical): `R.jumpReq` was consumed inside the
  per-player loop, so in one-device play (both bodies simulated) player a's pass cleared the tap
  before player b's pass read it. Keyboard Space worked because `jumpHeld` persists, which is why
  no test caught it. Now read once per frame above the loop. Test: `feel` taps the real Jump
  button with first = 'b': vy 4.2 m/s, rose 0.96 m.
- **Footsteps.** `snd.step(vol, pitch, crawl)`: a 40 ms band-passed noise tap (900 Hz, Q 1.2) on
  every walk-cycle zero crossing (`floor(walkPhase / π)` changes), or a wet low "tup" (lowpass
  420 Hz + 170 Hz thump) for sticky-feet crawling. Volume 0.08 for your own body; the partner's is
  `0.14 × (1 − d / 9)`, so a hider hears the seeker coming from 9 m, long before the 3 m heartbeat;
  pitch ×0.8 when sprinting (> 4.2 m/s). Only while the avatar is visible (a hiding body stays
  silent). Zero allocation: the sound reuses the shared noise buffer.
- **Haptics off.** `api.haptic` is a no-op: iOS ignores `navigator.vibrate` and Android laptops /
  tablets buzzed on every stick, fire and fill.

### Scurry from a wall = drop and dash

A hider flat on a wall who tapped Scurry used to spend the escape, paint 4 trail dots on the
seeker's screen and not move: the dash went along the heading, which for a stuck body is the wall
normal, and the crawl's tangent projection zeroed it. Now a stuck body lets go first (`unstick`,
the usual pop + "pok"), then dashes 0.5 s along the look direction on the floor. If after 0.2 s
the body has moved < 0.15 m (boxed in), the dash is cancelled, the escape refunded, the trail
cleared and a "Boxed in — escape refunded" hint shown. Measured (`feel2`, two phones): from the
Living Room camo wall, dropped and dashed 2.43 m, one escape spent, trail seen by the seeker.

### Escape-aware tag window

`confirmTag` keeps the shooter-favoured 250 ms window for stationary / crawling hiders. When the
victim's own escape (scurry or zip, `R.escapeAt`) started before `T − delay − ½ RTT − 120 ms`,
i.e. the shooter's screen could already have shown the dash, the window shrinks to
`[T − delay − ½ RTT − 120 ms, T + 60 ms]` (`TAG_WINDOW_ESCAPE`). A 6.6 m/s Large scurry covers
~3 m in the old window on a 120 ms link; now a tag has to land on where the hider actually was
when the shooter saw them. `state().lastWindow` reports which window judged the last shot
(`feel2` aims and fires in the same animation frame 250 ms after a second scurry on a 60 ms
link, landing 543 ms into the dash: window `escape`, confirmed because the seeker's screen showed
the dashing body 0.19 m from its true position; a test-runner click used to land 300+ ms late
and miss the dashing body entirely, which made the section flaky).

### Scoring: the seeker scores too, the dry-out pays the time survived, the blend %

| Setting | Options | Easy | Classic | Hard |
|---|---|---|---|---|
| Seeker scores | Off · Time left · Time + pellets | Off | Time + pellets | Time left |
| Blend bonus | Off · +10 at 80 % · +20 at 90 % | Off | +10 at 80 % | +20 at 90 % |

- **Seeker points** per hunt (when they tag): `round(½ × seconds left on the hunt clock)` plus,
  with *Time + pellets*, `10 × unused pellets`. A 12 s find on a 90 s clock with 4 spare reads
  **+39 + 40**; a perfect hide is still 120, so the totals stay comparable. The FOUND stamp
  gets a second line in the seeker's ink ("+38 · 3 pellets spare"), the recap says
  "+13 for Sydney · +38 for Emerson (3 pellets spare)". `rec.seekPoints`, `rec.spare`.
- **Running dry** used to pay the hider the whole clock + 30 (six quick misses at 14 s = +120 on
  Classic, +165 on CU). Now `roundOver` is called with the moment the seeker ran out and pays
  `floor(seconds survived) + 30`; the SURVIVED stamp and recap say "ran dry at 0:05 · +35".
- **Blend %** (`blendOf` in game.js, the math in `camo.js`, shown live while painting): the body
  seen from five viewpoints round the surface the hider is on (the wall behind a stuck body, else
  the floor below), each texel against whatever map triangle is really behind it along that sight
  line (vertex colour × atlas tile × blob shadow, as drawn): paint QA round 1 and 1b, below (it
  used to be the stamp's own head-on projection, so every stamp read 98–100 %, then the plane of
  the surface extended for ever, so a body on a narrow pillar read 97 %). `camo = 100 × (1 − 2.8 ×
  loss)` (clamped). Grade words: Ghost ≥ 90, Sneaky ≥ 75, Spotted ≥ 50, Sore thumb < 50. Measured
  (QA1b): plain white on the Living Room wallpaper 24 %, after one stamp 71 %; the Market's fridge
  pillar 11 % → 65 %; one stamp on the Living Room's plain painted wall 89–91 %. The hider's device computes it (`R.blend[w]`), it travels in the paint blob's
  meta (`blend`), the host adds the bonus (`blendPointsFor`) and records `rec.blend` /
  `rec.blendPts`; the recap prints "Blend 96% Ghost (+10)". Cost: one pass over ≤ 16 k texels at
  the lock, nothing per frame. (The before/after strip and the share card are the UX pass's.)
- **Scan during grace** is refused like Fire ("Grace period — scan in N s"): Hard's 5 s grace was a
  free glint before Fire unlocked.
- **Pellet assist** (`fire`): a shot that misses the mesh but passes within `0.06 × size` of a body
  part's bounding ellipsoid (0.72 × its bounding sphere), with nothing in the way, still tags
  (`stats.assisted` counts them). A Medium body at 5 m is ~45 × 22 px on a phone.

### Per-map clocks (`rules.js`)

One "XL = 1.5×" for maps from 432 to 1768 m² made CU Boulder a hider walkover (greedy vantage
sweep: 48 vantages, 262 m tour = 191 s sprinting vs a 135 s Classic hunt) and the Greenhouse a
seeker walkover (59 s). `MAP_TIME_ID` now sets the **seek** scale per map (a map entry's own
`time` field wins, then the table, then the size class):

| Map | sweep | seek × | Classic hunt | hide × | Classic hide |
|---|---|---|---|---|---|
| Living Room / Garden / Art Studio | 12–27 s | 1 | 90 s | 1 | 60 s |
| Greenhouse & Shed | 59 s | 1 | 90 s | 1 | 60 s |
| Corner Market | 79 s | 1.25 | 115 s | 1.25 | 75 s |
| The Whole House | 82 s | 1.5 | 135 s | 1.5 | 90 s |
| Museum Night | 82 s | 1.5 | 135 s | 1.5 | 90 s |
| CU Boulder | 191 s | 3 | 270 s | 2 (cap) | 120 s |

`hideScale = min(2, timeScale)` also scales the head start; the sprint stays
`1.55 + 0.3 × (min(1.5, scale) − 1)` so CU keeps 1.7× rather than 2.15×. Double Blind's hunting
speed is `dbSpeed = min(1.6, 1.1 + 0.33 × (scale − 1))` (1.6 m/s on CU, 1.27 in the House). The
settings sheet's effective-time hints use the right scale for each clock.

### Easy preset

Was a seeker walkover (Huge + strong blinks + fast seeker + no escapes: 96 % found in the Living
Room, mean 4 s). Now: Huge, 8 pellets, blink **On**, scan cooldown 20 s, seeker speed **Normal**,
**1 escape**, **10 s head start** (the camouflage matters), seeker scores off, blend bonus off.

### Hygiene

`PLAYERS = ['a', 'b']` index loops in `simulate` / `animate`; the camera clamp's box filter is a
module constant (`CAM_FILTER`); the stage size is read once per frame into `SW/SH` (the
`stage.size` getter allocates an array; the cameras and the here-marker read it up to 6× a frame); `controls.js` reads the surface rect on pointerdown and at most once
a second afterwards (every pointermove used to force a synchronous layout right after writing the
knob transform).

### Deferred (not in this pass)

Double Blind climbing for both hunters and a closest-approach tie-break for void rounds (the HUD's
`both` action list, climb camera and zip gates all key on `role === 'seeker'`); a second hider spawn
on the small maps (maps owner); the blend before/after strip and share card (UX owner).

### Tests

`feel` (one device, phone profile: per-map clocks, player b's Jump tap, the joystick speed ramp,
blend % before/after a stamp and at the lock, the scan held in grace, seeker points and the FOUND
stamp / recap text, a dry-out paying the time survived) and `feel2` (two phones, 60 ms latency:
scurry off a wall drops and dashes, the escape window judging a shot mid-scurry). The `match`
section's dry-out assertion now expects the time survived + 30.

## Pro pass: UX (records, wardrobe, the loop between rounds, sound, HUD)

Asked for: "polish the shit out of these games … immensely satisfying … addictive". The UX pass
adds the things the game had no memory of (who holds what), gives the seeker something to do
while blindfolded, tightens the loop between rounds and raises the floor on the phone HUD. Verified
with scripted two-phone runs (`ONLY=ux`: records, wardrobe, wager, ticker, emotes, final card;
`ONLY=uxland`: landscape HUD overlap + tap targets) plus the existing suite.

### Shared records (`records.js`, via `api.data()`)

The host folds every round into the game's shared data doc when the recap starts (the recap phase
message carries what was earned as `rx`, so both phones celebrate the same thing). Keys follow Rail
Rush's shape, per person `w`: `${w}_surv_ms` (longest hunt survived, + `_surv_map`, `_surv_surf`),
`${w}_find_ms` (fastest tag), `${w}_blend` (best blend %, from paint's lock score), `${w}_hides`,
`${w}_hunts`, `${w}_finds`, `${w}_surv`, `${w}_streak` / `_streak_best` (consecutive rounds won in
either role), `${w}_pass` (most walk-pasts suffered), `${w}_stared`, `${w}_strokes` (most brush
strokes in one hide), `${w}_ghost` (survivals with zero walk-pasts), `${w}_surf_{ceiling,hang,
perch,squeeze,corner,wall}` (where they survived), `${w}_called` (right wagers), `${w}_dbwins`,
`${w}_rounds`, `${w}_matches`, `${w}_wins`. Shown in three places: the **lobby strip** under the
map ("Best hide Sydney 1:28 on the ceiling · Fastest find Emerson 0:12 · Best blend 91 % · Streak
Emerson ×3"), the **recap** (a NEW RECORD sticker 900 ms after the card with the `survive` chord,
taunt lines such as "Found in 0:12: Emerson's fastest ever", "Sydney walked past you 3 times",
"walked right under you", "Stared straight at Sydney 4×", "is on a 3-round streak") and the
**final card**.

### Wardrobe (`wardrobe.js`)

Unlockables live where paint can't reach: **eyes** (Amber · Emerald "survive 3 hunts" · Ruby "tag
in under 15 s" · Gold "survive a hunt at 90 % blend" (paint QA1; it was "blend 90 %+", one Stamp tap) · Galaxy "survive on a ceiling 3×"), **eye shape** (Round · Cat
slit "win a Double Blind round" · Wide eyed "stared at 5× in one hunt"), **tail charm** (Bell "10
rounds" · Bow "survive hanging" · Paintbrush "25 strokes in one hide") and **idle** (Still · Head
bob "a 3-round streak" · Tail wag "win 3 matches"). Unlocks are `unlock_${w}_${slot}${k}` in the
shared data (checked against the records after every round, `UNLOCKED` stickers 1.1 s apart); the
pick is per device (`chm.wear.v1`, per person for hotseat) and resolved through `unlocked()` at
mount, on every data change and on every pick, then sent to the partner as one packed int
(reliable `wear`, on link and on change) and guarded the same way on arrival. The avatar
(`setWardrobe`) recolours its own copy of the eye-ring vertices (the pupil stays dark, the ring
stays bright so no stealth is gained), scales the pupil for the slit / the turrets for wide eyes,
shows one small charm mesh on the tail (one draw call while worn) and adds a head bob or tail wag
while still. The lobby's Wardrobe chip opens a riso sheet of sticker tiles; locked tiles print the
condition in grey halftone and a tap says what's missing ("Survive 2 more hunts").

### The seeker's hide phase

- **Call the hide** (setting *Seeker wager*: Off · +5 · +10; Easy Off, Classic +5, Hard +5): riso
  chips on the blind card (FLOOR · FURNITURE · WALL · CEILING, + HANGING on maps with ≥ 2 climb
  dots) and, in hotseat, on the "hand it over" curtain. The pick travels as reliable `call` and is
  judged at the round's end from the hider's spot (`hideZone`: surface kind, else a ray down to the
  collider under them: wide thin boxes and floor-ish names are floor, anything else furniture). A
  right call pays the stake, a CALLED IT sticker in the seeker's ink and "Emerson called it: Wall"
  on the recap.
- **Ticker**: the hider's device sends `act {k, n}` at most once per 2.5 s (paint + stroke count,
  stamp, fill, pick, ready, still after 20 s, moving again): no coordinates. The blind card prints
  "Sydney is painting… (7 strokes)" live.
- **Palette drops**: when the lock's paint blob arrives, the card's three ink drops take the three
  most used colours of the hider's skin (sampled from the quantised ≤ 32-colour texture).

### Between rounds

- FOUND 3.4 s → **recap 6.5 s** (was 9 s) with the auto-advance drawn as a conic ring in the Next
  button's border plus a seconds label (DOM writes only when the value changes), "Next: Emerson
  hides · Sydney seeks · Living Room" inside the recap, and the round 2+ title card cut to **0.9 s**
  (round 1 keeps 1.8 s for the map orbit). FOUND → next hide: 14.3 s → ~10.8 s untouched, ~5 s on a
  tap. Either tap still skips.
- **Emotes**: six riso stickers under the stats (LOL · HOW · Sneaky · ❤️ · Again! · Nice!),
  reliable `emote {k}`, rate-limited 1 per 700 ms and 8 per recap; the partner's lands big at a
  random tilt near the card with the `pose` sound and a squash, yours small and mirrored. DOM only.
- **Final card** before the hub's end card: a round timeline (one bar per round in the hider's ink,
  length = seconds survived, ✦ if found, ★ on the longest), "Best hide / Fastest find / Best blend",
  record and unlock stickers, emotes, "Rematch: Sydney hides first". "See the board" on either
  phone (or 12 s) hands over to the hub card with Rematch. Who hides first alternates match to
  match: the final card's "Rematch: X hides first" is carried across the remount in a page-level
  `nextFirst` (set when the final card goes up: the other hider after Hide & Seek, the same pick
  after Double Blind) and is what the new lobby (and round 1) uses, in hotseat too. It used to be
  `api.gen % 2`, which the hub only bumps in live mode (hotseat: Emerson every time) and which
  ignored the lobby's own pick (two phones: the card promised one person, the rematch started the
  other). QA round 1 below.

### The hunt's arc

- **Ambience** (per-phone setting *Music*: On · Hunt only · Off, on the settings sheet): a soft
  three-oscillator pad while hiding; in the hunt a low pulse whose tempo climbs **70 → 140 bpm** over
  the hunt, **+20 bpm** while the seeker is within 6 m of the hider (3-D), cut for 0.4 s at a tag.
  One pad per phase, one short oscillator per beat (≤ 2.3/s), numbers only per frame.
- **In their sights** (rule *In-their-sights cue*: Easy / Classic On, Hard Off): when the seeker's
  view ray passes within 0.45 × size of the hider's body centre with a clear line of sight (one
  collider ray, rate-limited 1/s), the hider's peek vignette pulses in the seeker's ink with a
  `warn`; the count lands in the recap ("Stared straight at Sydney 4×") and the records. Both phones
  count it (both know both positions during the hunt).
- **HALF TIME** (hunts ≥ 40 s) and **LAST PELLET** stickers for the seeker; a confirmed tag gets a
  90 ms hit-stop, a 0.25 shake, a white flash and a pitched-up splat on the shooter's phone; FOUND
  freezes 0.5 s (was 0.38) and a find under 20 s bursts 160 confetti instead of 110.
- **3-D nearness**: closest call, walk-pasts and the heartbeat use the 3-D distance; a walk-past
  also needs line of sight within 1.5 m (≤ 7 rays/s while that close); the recap says "walked
  right under you" when the seeker passed > 1.2 m below.

### HUD

- Laptops: the click that grabs the mouse no longer fires a pellet (`p.grab`; a second click
  while that grab is still pending, or after a refused lock, is the click-to-fire fallback), and a
  locked click fires on pointerdown (~50–100 ms less latency). `ONLY=uxdesk` covers it.
- **Ready** is a wide "I'm hidden" pill at the top of the hider's cluster (its own grid row, 8 px
  gap), out of the thumb's path to Paint / Pose.
- Landscape seek HUD: the minimap (84 px) sits bottom-left above the pose row, the pellet pill
  moves under the top bar with the seven-button grid, the joystick hint hides while the pose bar is
  up; `ONLY=uxland` asserts no two of mini / poses / gear / acts / joyhint intersect at 844×390.
- Portrait: the hunt hint sits under the minimap (`.minion`), the minimap draws with a fixed
  paper / ink pair in both themes.
- Tap targets ≥ 44 px (paint options, Done, chips, map arrows, steppers, sheet segments, size
  buttons); type floor raised to ~11 px (captions, pose names, preset subtitles, size labels, map
  facts, "Move").

### Cameras (finished in the resumed pass)

- **Free cam**: still flies through furniture, but each frame's move is raycast against walls and
  ceiling slabs (`wall: true` colliders taller than 1.2 m, or `ceil`) and stops 0.15 m short; a
  point that still ends up within 0.15 m of one leaves by the nearest face. The ceiling limit is
  now the topmost board ceiling's underside − 0.25 m (was tallest collider + 0.5 m, i.e. above the
  slab: the blank white/beige screen). Measured on Living Room: flying 3.5 s into the back wall
  stops at z −3.85 (wall face −4.0), flying up stops at y 2.25 (ceiling 2.5); no blank frames.
- **Seeker climb camera** (superseded by the shared solver in "Final QA" below): the half-space limit is 0.55 × dist (was 0.3), and when walls or low
  furniture still pull it under 0.6 × dist it tries two positions slid round the wall's tangent
  (the view's right on a ceiling) and keeps the clearer one. Sweep (9 contacts × 3 pitches × 4 yaws,
  climb-view samples): camera ≥ 0.9 m from the body in **96 / 96** (was 5 under 0.5 m, worst
  0.17 m), body→camera blocked by walls 2 (was 6). The 35 % alpha fade was not needed at these
  distances (the body is still hidden only when jammed, `climbNear`).
- **Stick / let-go dip**: the hider's third-person look target eases at rate 6 for 0.4 s after any
  attach or detach (snaps if the jump is over 1.2 m, e.g. a new round) instead of following the
  0.3 m body-centre jump; the player's pitch is left alone.

### Creative hide vote

The final card (Hide & Seek, ≥ 2 rounds) asks "Best hide tonight?": one chip per round. Each phone
picks (reliable `vote {w, r}`, the partner's pick shows as an ink pip on the chip; in hotseat one
tap is the pair's pick); a matching pick crowns the round (★ chip, CREATIVE HIDE sticker + `unlock`
chord) and the host adds 1 to `${hider}_creative`, which prints a "Creative hide ×N" ribbon on that
person's wardrobe. A pick holds the 12 s auto hand-over for 8 s more. Settings sheet, Round group,
also gained the *Seeker wager* row (Off · +5 · +10).

First-run tips: "Got it" moved into the card's header row and the list tightened, because the
taller card covered the new I'm-hidden pill on a 390 × 664 phone (a Playwright tap on Ready landed
on the tips; found by the maps suite's Museum round). While the tips are up the action cluster also
draws above them, so a shorter phone never loses the buttons. In the tests' FAST tune the final
card lasts 3 s (12 s live) so the suites that wait for the hub end card keep their margins.

Haptics are a no-op in `core.js` now (iPhone first).

## Final QA: one camera solver, the void round, a private lock, quieter stickers

QA's last round found the third-person cameras failing in the same way from four places (the Watch
view inside a climbing seeker, the seeker's own back across the FOUND frame, the climb camera in or
behind walls by corners and low on walls, the hider's camera through thin walls): each clamped one
point ray (`clampCam`: `max(0.25, hit − 0.18)` could land past a wall closer than 0.25 m, rays below
the floor passed under wall boxes and `floorCam` lifted them out on the far side, low props were
ignored). They now share one solver (`solveCam` in game.js, `world.sweep` in world.js):

- **A sphere cast, boxes not points.** The camera is a 0.12 m sphere cast from the body centre to
  where the view wants it, against every box grown by the radius (a slightly conservative stand-in
  for the rounded sum), and the floor. A 0.16 m wall stops it like a thick one; the camera ends
  in front of the first face and the body always sees it. A box already nearer than the radius is
  grown only to the gap, so a body pressed into a corner can still move out. Low props count (a
  pouf covered half the FOUND reveal, a bin swallowed the climb camera): the camera rises over them.
- **Slides and alternatives.** Short of 85 % of the way (or of the minimum distance below), it
  tries the slide along the face it hit, the direction swung ±0.55 / ±1.1 rad, raised, nearly
  overhead, and (stuck to a surface) out along the normal to either side, straight out or along the
  surface; each is cast the same way and scored by reach − turn − 2 × shortfall under the minimum.
  The last pick wins near-ties (no flicker). A body in a pocket (under a shelf board, between two
  planters) gets a second pass with a 0.05 m camera (still clear of the 0.03 m near plane).
- **A minimum distance, then a fade.** `camMinD` = 0.6 × size + 0.15 m (Large 0.93). Closer than
  that the body it looks past fades (down to 25 %, eased), never hidden; when the climb camera's view
  ray passes within 0.3 × size of the body (it covers the crosshair) 35 %. `avatar.setFade` flips `transparent` and `opacity` only (r128 keeps them out of the
  program key: no shader switch), depth writes stay on.
- **The eased camera stays out too.** After the lerp, the camera is cast again from the pivot once
  it's near its spot (not during a view whip or the whip to FOUND, which cross the map on purpose).
- **Watch** frames a climbing seeker like the climb camera (normal = the drawn up vector), solves a
  seeker on foot from the body centre (not the aim anchor above the head), and fades the watched body
  under the minimum. Every view casts from the body centre for the same reason. **FOUND / SURVIVED**: a seeker within the framing distance + 1 m
  of the hider swings the camera 60° off their line to the clearer side (picked once per stamp); the
  other body fades when it's between the camera and the reveal or fills over a quarter of the frame.
  The look hint is cleared when the stamp lands.

Sweep (`ONLY=camsweep`: all 8 maps, 292 wall / low-wall / corner / ceiling contacts near the camo
spot and spawns, plus 157 standing spots for the hider and Watch, × 4 yaws × 3 pitches, Large,
portrait; settled camera; ok = ≥ 0.9 m from the body centre with no collider in between):

| View | Before | After |
|---|---|---|
| Seeker climb | 3263 / 3504 ok (93.1 %), 48 inside a collider, 156 occluded, closest 0.24 m | 3482 / 3504 (99.4 %), 0 inside, 0 occluded |
| Watch (seeker drawn there) | 3627 / 5388 (67.3 %), 110 inside, 465 occluded, closest 0.05 m | 5342 / 5388 (99.1 %), 0 inside, 0 occluded |
| Hider third person | 4417 / 5388 (82.0 %), 55 inside, 258 occluded, closest 0.16 m | 5348 / 5388 (99.3 %), 0 inside, 0 occluded |

The 22–46 left are pockets (a body under a bench, in a slot between checkout and candy stand); there
the camera sits in the clear and the body fades. FOUND (`ONLY=foundcam`, 75 seeker spots × Medium /
Large / Huge): the shooter's own body filled > 30 % of the frame unfaded in 17 before, 0 after; a
1.6 m Large tag puts the camera 1.6–1.7 m from it (0.78 before); a hider behind a low prop was
hidden in 7 of 13 before, 0 after. `cameras()` costs ~0.01 ms a frame (worst 0.06, 3 × before).

The rest of the round:

- **Double Blind void round** (both seekers dry): `posOf(null)` threw in the time phase on both
  phones (no flash, sound or confetti) and the round recorded the whole clock. The burst now goes
  between the two in both inks, and the both-out `roundOver` carries `T` (`ONLY=db` plays one).
- **Privacy**: the hider's presence is neutral (v 0, zeros) through the lock and the countdown until
  0.75 s before the hunt (`queuedHuntAt`), and with a head start the lock's paint blob drops `pos`
  (the host's seeker-spawn pick travels as `ss`). Last round's hint is dropped at each round start.
- **Stickers**: HALF TIME and LAST PELLET wait while a tag is being confirmed, a FOUND / SURVIVED is
  queued or the round is over (`huntOpen`); they used to pop over the FOUND stamp.
- **Tap targets**: the landscape "I'm hidden" pill (40 → 44 tall), the landscape lobby size chips
  (38 → 44) and More, the paint brush-size / hardness segments (40 → 44 wide).
- **Mute**: sound.js caches core's `muted()` (a localStorage read + JSON.parse) and re-reads it at
  most once a second, on `visibilitychange`, and at once on core's new `ju:mute` event (the toggle).
  It was 1–2 reads a frame (ambience + tempo) plus every footstep; now ≤ 1 a second.

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
| Scan cooldown | 10 – 45 s | 20 s | 20 s | 30 s |
| Escapes (scurry / tongue-zip) | 0 – 3 | 1 | 1 | 2 |
| Seeker speed | Slow · Normal · Fast | Normal | Normal | Normal |
| Walls & ceilings | Climb · Floor only | Climb | Climb | Climb |
| Stamp tool | Allowed · Off | on | on | on |
| Eye-blink glints | Off · On · Strong | On | On | Off |
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
  bookshelf shelves, picks a pose and paints. "Ready" (v2: "Hidden") ends the phase early; v3
  timing (On Ready, countdown, head start, grace) is described in the v3 section.
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
| Seek | Fire, Scan, Jump; seeker can climb: Stick, Zip, Pose too; hider: View, Paint, Pose, Zip, Scurry | click, Q, Space, E, Z, 1–9; hider: V, P, F |
| Hider's views (hunted) | View cycles eyes → watch → free cam; free cam: left thumb flies, drag looks | V; W A S D fly, Space / E up, Q / C down, Shift fast |

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

### Pro pass: paint cost and feel (paint owner)

- **Quantiser** (`paint.js`): a bounded median cut. One pass fills a 5-bit-per-channel
  histogram (32 768 bins: count plus exact channel sums), the cut runs over the occupied bins
  only (a counting sort per split, populations summed per box), the palette is the
  population-weighted mean of the real colours in each box, and a per-bin LUT maps the pixels.
  All buffers are module scratch, so there is no garbage. A skin that already has ≤ 32 exact
  colours keeps them exactly, so a second quantise changes nothing and the checksums still match.
  `encode(data, q)` takes the quantise it just ran, so nothing is quantised twice, and
  `paint.encode()` caches the blob per paint version. Node, 1x: a stamped-like skin with 12k
  colours went from 23 ms (median; max 110) to 0.2 ms, 16k-colour noise from 61 ms (max 213)
  to 3 ms. Error is 2.8 vs 2.5 levels per channel and the blob is the same size. In the page
  on CU Boulder, a freshly stamped skin locks in about 3 ms warm: encode 0.6 ms and blend
  score 1.8 ms. The first lock in a session is about 20 ms while the JIT is still cold (it was
  25–66 ms). The blob is 2.5 KB (2 chunks), or 1.7 KB (1 chunk) after brushing. The codec is
  warmed once when the first paint is created. Closing the paint tools in the hide phase
  pre-encodes 120 ms later, so Ready reuses the blob.
- **Blend score / stamp shade**: `stage.surfaceOf().shadeAt` only looks at blob shadows within
  1.6 m of the hit (a big map has hundreds). Blend scoring samples every other mapped texel.
  Together these took the score from 20–24 ms to about 2 ms warm.
- **Live paint** (paint while hunted): a settled change whose checksum equals the last one
  sent (undo back, or a repaint with the same colour) sends nothing (`live.same`).
- **Dabs**: each part keeps its own texel list and a world bounding sphere (made in
  `updateWorld`), so a dab walks only the parts it can reach. On CU that is 5.8k / 6.1k / 7.3k
  texels for S / M / L instead of 16k. A pointer move makes at most 12 / 9 / 6 dabs for
  S / M / L.
- **Feel**:
  - The cursor is a dark ring kept about 2.5 px wide at any zoom (its inner radius is
    rewritten from metres-per-pixel at the hit), with a 1.2 px white halo outside it so it
    reads on a white or a dark body. It has a 20 % fill of the brush colour and a centre dot.
    A soft brush adds a faint inner ring where the falloff core ends and drops the ring to
    60 % opacity.
  - Changing size or hardness pulses the cursor and shows it on the body for 1.1 s (at least
    10 frames), because phones have no hover. A new stroke gives a small pulse.
  - The brush sound is a filtered-noise scrub whose pitch tells the size (S 3200 Hz, M 2200,
    L 1500). Its volume follows stroke speed (0.04 + 0.10 × speed, where speed is body-sizes
    per second / 1.6). Hard brushes are a tight band (Q 3.2) and soft brushes a breathy one
    (Q 1.1). It is throttled to one per 55 ms.
  - Fill swells the filled part 1.08 → 1 over 0.18 s (ease-out). Texels are refreshed from
    the rest pose if you stroke mid-swell.
  - Stamp flashes the outline white and thins it to nothing over the wipe (0.36 s). The real
    reveal outline always wins.
- Test: `ONLY=paintfeel` covers lock cost (cold and warm), blob reuse, part culling, the
  preview ring, and the fill and stamp juice. It writes `brush-*.png`, and `PAINT_MONT=<mont.js>`
  makes a montage.

### Paint owner, second pass: the wipe, the flood and the camo meter

Played through on the Living Room, Art Studio and CU walls (scripted phone runs, light and dark,
slow-motion captures of the reveals). What was missing was a *goal* while painting and a
moment of payoff for the two big tools.

- **Stamp wipe** (`paint.js`, `REVEAL.stamp`: 0.36 s, front 0.22 of the sweep, glow 0.65): the
  stamp no longer appears in one frame. The new colours go into a target buffer, each texel gets
  a key (its height along the camera's up vector) and the texels are bucket-sorted by key
  (64 buckets, scratch arrays allocated once per paint). `flush()`, which the frame loop already
  calls once per paint, advances the wave on real time: texels behind the front take their
  colour, the front itself flashes toward white and settles. It reads as a print being pulled up
  the body. The full-screen white flash on Stamp was removed (it hid the wipe); the sound is the
  stamp thunk plus the rising `whoosh`.
- **Fill flood** (`REVEAL.fill`: 0.28 s, front 0.3, glow 0.4): the key is the distance from the
  finger's hit, so the colour spreads out from where you tapped across the region.
- **Undo dissolve** (`REVEAL.undo`: 0.22 s, front 0.45, glow 0.3): only the texels that differ
  from the snapshot take part, keyed by a per-texel hash, so the undone paint speckles away
  instead of snapping (a cancelled two-finger gesture still undoes instantly).
- **Settle before read.** Everything that reads or edits the skin (`dab`, `fill`, `stamp`,
  `snapshot`, `undo`, `hash`, `quantize`, `encode`, `colorAtUV`, `changedPoints`, the blend
  scorer) finishes a running wave first, so the codec, undo, checksums and the score only ever
  see finished paint. A live update (paint while hunted) waits until the wave has settled
  (`p.revealing`). Cost: ≤ 0.5 ms per frame while a wave runs (Node, all 16 k texels), one
  texture upload per frame for 0.3 s.
- **Camo meter** (`camo.js`): while the paint tools are open, a riso sticker on the right edge
  shows the blend score live: a tube filling to the score (red Sore thumb, yellow Spotted, your
  ink Sneaky, green Ghost with a sheen), ticks at the grade lines 50 / 75 / 90, a dashed line and
  a star at the blend-bonus line (80 or 90 when the rule is on; the star lights when you pass
  it), the number counting toward the score (0.55 s ease-out, DOM writes only when the integer
  changes) and the grade word. A better grade pops a sticker ("Sneaky!", "Ghost!") with
  `pose` / `good` / the `unlock` chord; reaching the bonus line inside the same grade pops
  "+10". Drops are silent. Placement: right edge at 184 px (portrait), 64 px with a shorter tube
  on a phone on its side; tested clear of the tools, poses, top bar, role pill and hint at
  390×844, 844×390 and 375×667.
- **Scoring without hitches.** The score math moved from `blendOf` into `camo.js`
  (`scoreBlend`, identical formula). The meter reruns it after every settled change (a stroke
  ended, a wave finished, a fill swell ended, the body moved or changed pose): the texels are
  refreshed from the body as it is now (the tail sways and the eye turrets wander), the surface
  is looked up only when the spot changed, and the job runs 1 800 samples a frame (5 slices for
  a whole body; 0.05 ms median per slice in Node, `updateWorld` 0.8 ms warm after replacing
  `Math.hypot` with `Math.sqrt`). Only the round's first score is taken in one frame, so the
  meter never opens on a blank "--".
- **The lock reuses the meter.** When neither the paint version nor the spot changed since the
  meter's last score, the lock records that score instead of scoring again: the number the hider
  saw is the number that pays the bonus (the lock's quantise to 32 colours would otherwise move
  it by a point or two right at the threshold). Measured: lock after painting 0.3 ms (encode
  0.0, blend 0.1, 1.9 KB in one chunk); a stamp then an immediate lock with no meter (the cold
  path) 15 ms (encode 6 + blend 7) on the loaded sandbox, warm medians encode 2.0 ms, blend
  3.8 ms. Brush cost per pointer move (CU, 1x / 4x CPU): median 0.2–0.6 / 0.5–1.2 ms, max 2.4 /
  3.7 ms.
- Test: `ONLY=paintjuice` (one phone, Living Room wallpaper): the meter appears with the paint
  tools and scores plain white (~45 %), scoring is sliced, the stamp starts a wipe that finishes
  by itself and lifts the meter to Ghost with a pop, a sound and the +10 star, a 30 s wipe is
  part-way after 1.5 s and reading the hash settles it, a fill floods and lowers the score, undo
  restores it, the layout at three viewports, the meter leaves with the tools, and the lock
  takes the meter's score without re-scoring. Writes `juice-*.png` (+ a montage with
  `PAINT_MONT`).

### Paint owner, third pass: the x-ray, round strokes, a camera that sees you

Played through with scripted phone runs on all eight maps (iPhone 13 viewport, 1x and 4x CPU),
watching the paint view, the strokes and the meter. The first two passes' findings (the
quantiser, blob reuse, brush cues, dab caps) were already in and measured; what play showed was
a meter that says *how much* you show but not *where*, polygonal strokes on slow frames, and a
paint camera that opened behind furniture.

- **X-ray: "where do I show?"** The camo meter is now a button (a small `Check` pill under the
  grade word). A tap runs one full error pass (`camo.errorMap`: every mapped texel, not every
  other one, scored exactly as the blend %) and `paint.xray()` flashes every texel that loses
  more than 25 % of its score with crawling hazard tape (yellow / ink bands 6 texels wide,
  stronger where it shows more) for 2.2 s: fade in 0.12 s, out over the last 0.45 s. The pill
  hatches and reads `Shows` (or turns green, `Clear`, and the hint says "Nothing shows. A perfect
  match!"). The stripes go into a display copy the texture points at while it runs, so the skin,
  undo, the codec and the checksums never see them, and any edit (a stroke, fill, stamp, undo,
  decode) ends it at once so paint always lands on the real skin. A second tap turns it off; so
  do closing the tools and the timer. Magenta stripes were tried first and vanished on a pink
  body; hazard tape reads on any colour (and found the cheek blush on the face, which counts
  against you). Sound `glint` (or `good` when clear); the partner's hide-phase ticker says
  "Sydney is checking their camo…". A once-a-session hint ("Tap the camo meter to see where you
  show") appears after a re-score under 90 %. Cost: the error pass 7–9 ms at 1x, 8–47 ms at 4x
  CPU (Living Room, measured at the tap); an x-ray frame touches only the striped texels (0.17 ms
  for 8 k in Node). The meter's invisible pop sticker sits beside it over the play area, so it
  (and the star) take no pointer events: a stroke beside the meter never turns into a tap on it.
- **"Invisible!"** at 98 % and up (95 since paint QA round 1, when the score started looking from
  the side): past Ghost's 90 there is one more line. Jumping straight there
  (a stamp on a plain body: 45 → 98) pops a shiny "Invisible!" sticker in place of "Ghost!";
  climbing past 98 inside Ghost pops it with the `unlock` chord. Every grade-up also flashes the
  tube (a 0.5 s swell with a highlight ring). Drops stay silent.
- **Round strokes.** A slow phone delivers one pointer move per frame, so a fast curve came out
  as a polygon of straight chords. Strokes now follow the midpoint quadratic Bézier (from the
  previous midpoint, bent toward the last finger point, to the new midpoint; the arc length
  estimated from the control polygon), with the same dab spacing (0.35 × radius) and per-move
  caps (12 / 9 / 6 for S / M / L); the last half-segment is drawn on lift. A quick circle that
  arrives as 6 moves (a 20 fps phone) came out as a hexagon on the Living Room body; it is now a
  round loop (`loop6-before-after.png`). The paint trails the finger by half a move while
  drawing (the cursor ring stays on the finger).
- **The paint camera finds you.** Opening the tools used to orbit to `yaw + 0.9` whatever was in
  the way: on the Living Room spot the gingham lampshade covered half the body, on CU the desk
  edge the legs. `framePaintCam` now tries the default first, then ±0.45 rad, a higher angle
  (pitch 0.8), then ±0.9, judging each by three sight lines (body centre, counted twice, head,
  tail → camera) against the map mesh, and the colliders for the centre (a bench or shelf top
  always has one); the first with all three clear wins, else the most clear, and if even the
  centre is hidden from the side chosen the camera comes in to just short of the obstacle (no
  closer than the zoom's 0.6). Never more than 12 mesh rays (it stops at the first clear side: 3
  rays on most spots, 7–9 on the Living Room, House and CU spots, which now open with the whole
  body in view); a ray is ~2 ms on the one-chunk Living Room, ≤ 0.7 ms on the chunked maps. A
  body wedged right under the Greenhouse potting bench behind a pot can't be seen from anywhere the camera may go; see-through
  occluders (as Getaway has) would be the fix, and are the renderer's job.
- **Zero-garbage undo.** Every stroke, fill and stamp used to `slice()` a fresh 64 KB snapshot
  (and drop the 25th). Snapshots now come from a pool that the history recycles into: 25 buffers
  in a session, then none (`ONLY=paintpro`: 30 stamps → 25 buffers, 20 more → +0).
- **Costs at 4x CPU** (`ONLY=paintpro`, Living Room; ranges over four runs on a sandbox at load
  10–40): a stamp-wipe frame max 2.2–5.0 ms, a meter re-score slice avg 0.4–0.9 / max 1.0–3.5 ms,
  a brush pointer move median 0.7–2.2 / max 3.6–8.6 ms (CU: median 2.3–2.5 / max 5.4 ms), the
  x-ray tap 8–47 ms, a lock 35 ms cold (encode 23 + blend 12, 2.6 KB in 2 chunks). Nothing in the
  paint path comes near the 200 ms rule; the frame budget on a phone is the renderer's.
- Test: `ONLY=paintpro` (one phone, Living Room): the stroke tail lands on lift, the undo pool
  stops allocating, a stamp on the wallpaper, a white fill and undo pop a grade sticker on the way
  back up (QA1: "Invisible!" moved to `ONLY=blendfair`), a
  real `page.tap` on the meter x-rays a pink patch (pill `Shows`, the skin hash unchanged), the
  x-ray ends by itself, a stroke ends it at once, a second tap turns it off, the meter's invisible
  pop sticker never catches a stroke, and the 4x-CPU costs above. Writes `pro-*.png` (+ a
  montage with `PAINT_MONT`).

### Paint owner, QA round 1: the blend % a seeker would see

QA: every stamp in 20+ play-tested rounds (six maps) read 98–100 % with "Invisible!", so Classic's
+10 at 80 %, Hard's +20 at 90 % and the Gold eyes ("blend 90 %+") were one Stamp tap; Gold
unlocked for both players in their first match in every run.

- **Root cause.** The score projected every texel along the surface normal onto the surface:
  exactly the stamp's own projection, so a stamp matched by construction, whatever the pattern,
  the pose or the angle a seeker would really see it from.
- **Five viewpoints** (`camo.js`, `BLEND`): 2.6 m from the body's centre, one head-on and four
  50° off the surface normal round it (on a wall: from the left, right, above and below; on a
  floor: four sides). For each view, every body texel facing it is followed along its sight line
  to the surface plane **behind** it (parallax: a texel h off the wall seen at 50° covers the
  point 1.2 h away), sampled with the stamp's sampler. A view's loss is 0.6 × "does the pattern
  line up" (mean |texel − the colour behind it|) + 0.4 × "is it the same stuff" (the means and
  RMS spreads of the body's colours against the colours behind them, per channel). Texels count by
  how squarely they face the eye; `camo = 100 × (1 − 2.8 × mean view loss)`. Still one pass over
  the body (texel k is scored in view k mod 5), so the meter's slicing and the lock are unchanged.
- **Why the second term.** Scoring alignment alone treated a misaligned stripe like a wrong
  colour: a stamp standing on the Studio's checker rug read 0–3 % and the House's floors ~30 %,
  "Sore thumb" like an unpainted body, and a flat fill of one stripe colour beat the stamp. With
  the colour statistics a stamp keeps "same stuff" from every side; a flat colour or a white body
  doesn't.
- **What a stamp reads now** (Large, one Stamp tap at each map's camo wall, rug and hider
  spawns, a scripted phone run; old = the head-on projection):

  | Map | camo wall | rug, standing | rug, Low | spawns | plain white on the camo wall |
  |---|---|---|---|---|---|
  | Living Room | 92 → 77 | 100 → 56 | 99 → 70 | 100 → 82 | 43 → 22 |
  | Garden | 99 → 73 | 100 → 80 | 100 → 82 | 100 → 84 | 0 → 0 |
  | Art Studio | 98 → 62 | 73 → 36 | 74 → 31 | 98 → 70 | 43 → 9 |
  | The Whole House | 100 → 78 | 99 → 40 | 98 → 51 | 97–99 → 48–58 | 0 → 0 |
  | Corner Market | 100 → 97 | 99 → 61 | 98 → 57 | 96–100 → 86–89 | 89 → 87 |
  | CU Boulder | 99 → 82 | 99 → 78 | 99 → 80 | 100 → 81–84 | 19 → 13 |
  | Greenhouse & Shed | 99 → 94 | 99 → 87 | 99 → 87 | 100 → 71–88 | 80 → 76 |
  | Museum Night | 100 → 75 | 100 → 56 | 99 → 55 | 88–100 → 39–62 | 0 → 0 |

  Of 46 one-tap stamps, 41 used to read ≥ 95; now 18 reach Classic's 80, 4 Hard's 90 (the
  Market's and the Greenhouse's calm walls) and 2 "Invisible!". Calm surfaces blend; a tall body
  on a busy floor breaks up from the side; the spot is the choice that matters.
- **The meter says why.** "Invisible!" is at 95 now (was 98). When a fresh stamp holds up head-on
  but not from the side (the front view ≥ 75 %, a side view ≥ 10 lower), a once-a-session hint
  says "Stamped! From the side the pattern breaks up: calm surfaces hide you best", and the x-ray's
  hint says "Head-on you vanish. From the side the pattern stops lining up: calmer surfaces hide
  you better" instead of "paint over the stripes" (paint can't fix parallax). The x-ray's error
  map uses the same five views: per texel, the exact part as scored plus how far its colour lies
  outside the spread of the colours behind it in each view that sees it. Five views are ~5× the
  old single pass, so the error map is now a resumable job (`startErrorMap` / `stepErrorMap`):
  ≤ 4 ms of it a frame (the first slice on the tap itself), the pill reads "…" meanwhile, and the
  meter's current score lends its views and colours behind (no second score pass). A stroke or
  a second tap drops it.
- **Gold eyes: "Survive a hunt at 90 % blend".** `records.js` keeps `${w}_blend_surv`, the best
  lock blend of a hide that survived its hunt; `wardrobe.js` tests it (`statsOf().blendSurv`) and
  the locked tile's tap says what's missing ("Your best hide that lasted was 86 % blend: get to 90
  and survive"). Looks already earned stay earned.
- **Costs** (sandbox, Living Room): a whole score (the lock with no meter score to reuse) 1x
  median 4.2 / max 13.6 ms, 4x CPU median 15 / max 22 ms; meter slices at 4x avg 1.8–2.1 / max
  4–6 ms, 5 per score (`CAMO_SLICE` unchanged); the x-ray's error map 14–16 ms of work at 1x and
  ~55 ms at 4x, in ≤ 4 ms slices (one unsliced pass took 210 ms in a run on the loaded sandbox,
  which is why it's sliced). No per-frame allocation: per-view sums live in the job (one job each
  for the meter, the lock and the x-ray).
- Test: `ONLY=blendfair` (Node: Gold needs a survived 90 %+ hide, a found 97 % doesn't count;
  one phone on the Living Room: plain white < 50, one Stamp tap lands between plain + 25 and 90,
  the head-on view beats the worst side view by ≥ 8, the old head-on score reads ≥ 85 for the same
  body, the side hint, the x-ray and its hint, a stamp standing on the kilim below the wallpaper,
  whole-score and slice costs at 1x / 4x; one phone on the Market's calm wall: from a pink body
  a stamp reaches ≥ 86 with the +10 star and a grade pop, no side hint, and "Invisible!" pops past
  95). `paintjuice` / `paintpro` assert the new stamp numbers; `feel`'s stamp line is ≥ 60 (was 70).

### Paint owner, QA round 1b: what is really behind the body (and a stamp that prints it)

Re-checking round 1 in play: the Corner Market's camo spot still read **97 % "Invisible!"** after
one Stamp tap, and an unpainted white body **87 %** (Classic's +10 for nothing), while the
screenshot showed a cream lump against rows of bottles. The camo spot attaches the hider to the
narrow cream pillar between two fridge doors; the body is wider than the pillar.

- **Root cause.** Both the score and the stamp took the triangle the body is stuck to and sampled
  its tile, uv mapping and vertex colour on that triangle's PLANE, extended for ever. Past the
  pillar's edges (or below a dado line, or off a table's edge) the seeker sees something else.
- **The score casts at the map's own triangles** (`camo.js`): the triangles within `rb + 1.6 m` of
  the body are copied out of the map chunks once per spot (`GAT`, shared by the meter, the lock,
  the x-ray and the stamp; ~200–2 500 triangles of 5–28 k scanned, 0.2–2 ms), then binned per view
  on a 16 × 16 screen grid, nearest first. A sample casts its sight line (Möller–Trumbore) through
  its bin: the first front face beyond the texel is what's behind it (tile × interpolated vertex
  colour × blob shadow, as drawn); a front face between the eye and the texel hides it from that
  view (it doesn't count); nothing within reach is the room's background colour. Items come
  nearest first, so a sample stops at the first one that starts beyond its best hit: 7–13 tests a
  sample (23 unsorted). An eye that would be inside a collider comes forward of it
  (`world.raycast`), and a view with no room for a seeker (< 0.5 m) is dropped.
- **The stamp prints what is behind each texel** (`stampSampler`): the same triangles, binned
  once along the surface normal, so every texel takes the colour straight behind it: on the pillar
  the overhanging parts print the bottles, below the dado line the green. Head-on a stamp is exact
  again wherever it is, and the score's side views say what parallax costs. Texels with nothing
  behind them within reach keep the old projection. 3.5–8 ms a stamp.
- **Numbers** (Large, one Stamp tap, scripted phone runs; "plane" = the round 1 score):

  | Spot | plain white | one stamp (head-on view) | plane score of the same stamp |
  |---|---|---|---|
  | Corner Market camo (fridge pillar) | 87 → **11** | 97 → **65** (87) | 97 |
  | Living Room wallpaper | 22 → 24 | 74 → 71 (78) | 74 |
  | Living Room plain painted wall | – | **89–91** (98–100); filled in its colour 93–95 | – |
  | Garden hedge / Studio / House / CU / Museum | 0 / 9 / 0 / 7 / 0 | 66 / 66 / 79 / 81 / 76 (93 / 93 / 94 / 95 / 97) | 70 / 65 / 78 / 82 / 75 |
  | rugs, standing (Garden / House / Market / CU / Greenhouse / Museum) | – | 47 / 40 / 58 / 78 / 84 / 56 | 54 / 40 / 47 / 78 / 87 / 56 |

  Big flat walls and floors score as before (the plane was right there); the spots where it
  mattered were the ones a body hangs over. One tap reaches Classic's 80 only on a calm surface;
  Hard's 90 (and Gold, which also needs the hunt survived) needs a calm wall plus touch-ups.
- **Lighting is not scored** (`BLEND.lit`, default 0): the toon ramp shades a body's sides
  differently from the flat wall behind it, and the score could compare rendered colours
  (`lightOf`, the scene's own hemisphere + sun + ramp, copied in by `setBlendLights`). With it on,
  a stamp on the plain wall fell from 88 to 58 with nothing a player could do about it (the brush,
  fill and eyedropper all work in albedo), so it stays a tuning knob, not the rule.
- **Costs** (sandbox, shared CPU): a warm whole score 4.5–7 ms at 1x, a cold one (gather + bins)
  12–17 ms median; the meter's slices at 4x avg 3.3–5 / max 6–9.5 ms (gather ≤ 30 k triangles, or
  ~2 ms of binning, or 1 800 samples a slice); the x-ray at 4x ≤ 9.7 ms a slice, copying the
  meter's bins (`adoptBins`) instead of making its own. The lock no longer pays for a score the
  meter is half way through: `camoCached` finishes the meter's job for the same paint and pose
  (paintfeel: a lock right after a stamp 14.7 ms, of which blend 0.2 ms; it was 42–112 ms with a
  cold score). No allocation per frame: the gather, bins and depth order live in typed arrays that
  only grow; nothing keeps a map alive after a switch or a close (`releaseBackdrop` on unmount).
- Tests: `ONLY=blendfair` now also plays the Market pillar (plain < 40 against ≥ 80 on the old
  plane; the stamp finds something behind > 3 000 texels, head-on ≥ 75, overall < 80 with no star
  and no "Invisible!"; the x-ray flags the overhang) and the Living Room's plain painted wall (a
  pink body, one stamp ≥ 80 with the +10 star and a grade pop with a sound, filled in the wall's
  colour ≥ 90 Ghost, "Invisible!" past 95 head-on). `paintpro`'s stroke test looks at the body face
  on first (the paint camera may pick a clear side view, where the 40 px loop left the body).
  Hooks: `blendViews({ backdrop: 0 | 1, lit, drop })`, `blendViews().diag / .lock` (triangles,
  hidden texels, tests, eyes), `blendProbe(view, step)`, `state().lastStamp`.
  Writes `fair-*.png` (+ a montage with `PAINT_MONT`).

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
| own avatar: position, yaw, pose, wall angle, eye look, speed, orientation `q` (packed quaternion), stuck `at` | owning device | presence on link.js's **20/s schedule** while anything changes (and 250 ms after), a **2.5/s keepalive** while nothing does (pro pass), stamped with the shared game clock; the partner is drawn from an allocation-free ring-buffer interpolation at `now − delay`, the delay **adaptive** (100–250 ms, q by slerp) |
| hider position during Hide | owning device | **not sent** — presence carries zeros (look, wall angle, speed too) and `v: 0`: a constant state, so it goes out as the 2.5/s keepalive (it still feeds the host's 4.5 s stall detection); the real state resumes 750 ms before the hunt so the seeker's buffer is primed |
| paint texture | owning device | reliable blob at lock (+ snapshot on resync) |
| mode, map, first hider, rules (validated) | host | reliable `setup`; rules also inside every `ph` match info |
| phases `hide lock seek found time recap final` (+ local `curtain`) | host | reliable `ph {seq, at, dur, scores, match}` **plus two unreliable copies** (deduped by `seq`, not held back by in-order delivery); both devices switch with `setTimeout(at − now)` and a per-frame check |
| timed transitions | host | pre-announced one lead (≥ 380 ms, `1.3 × RTT + 160`) before the deadline so both flip exactly at it; FOUND / SURVIVED (events, not deadlines) use 260 ms, or `0.6 × RTT + 80` on a slow link |
| shots, splats, pellets | shooter | reliable `shot` |
| tag confirmation | victim | reliable `tagres` (always, also when the victim is the host: it carries the shooter's juice) |
| round result + scores | host | inside `ph` |
| scan / scurry / zip | seeker / hider | reliable `scan {at, left}` / `scurry {at, left}` / `zip {at, to, left}` (v3: the seeker's `zip {at, to, sk: 1}`) |
| paint while hunted / during a head start (v3) | hider | the lock's paint blob with `live: 1`, ≤ 1/s, 1 chunk typically |
| hider's spectator views (v3) | hider | **not sent** (purely local) |
| spawns | host | inside `ph` data (`hide`: indices, `seek`: the seeker's) |
| pause / resume | host (guests report `vis`) | `pause {remaining}` / `resume {at, remaining}` |

**Fair-shot rule (shooter-favoured, 250 ms).** The shooter raycasts against the hider exactly
as drawn (`net.remote(shotTime)`, i.e. `now − delay`, validated against the partner session)
and sends the hit plus the position it saw **and the delay it drew with** (`dl`: the delay is
adaptive, so the victim's own differs). The hider's device keeps ~1.5 s of its own
positions and confirms when any true position in `[shotTime − dl − 250 ms, shotTime]` is
within 0.75 m of what the shooter saw. What you see is what you hit, unless the hider had
already scurried away more than a quarter second earlier. In Double Blind the host takes the
earliest confirmed tag within a 250 ms window.

**Pause / resume.** The host pauses on partner away, page hidden (either device), GPU context
lost (either device) or a 4.5 s silent link; it freezes the remaining phase time and resumes
with a 3-2-1 once everything is back and a `hello` arrived on the current link. Found times
exclude pauses. If the guest remounts, the host's snapshot restores the guest's paint and
hiding spot; if the host remounts, the host restores the whole match from the guest.

**Pellet range = the fog (pro pass).** `fire()` picks (and the near-miss assist searches) only
up to the play fog's far edge, `min(40, fog.far)`: 26 m on big maps, 30 m on small ones, so a
shot can't tag a hider the fog has fully hidden. A miss flies `min(30, range)`. CU's glass is a
collider without a mesh: pellets pass through it (you can see through it), bodies and tongues stop.

**Watch / free cam / eyes switch (pro pass).** `setView()` no longer cuts: the first camera frame
after a switch records the offset between where the camera was and the new view's target, and
`cameras()` eases it out with a smoothstep over `VIEW_WHIP_S = 0.35 s`, riding on the new view's
own motion (eyes stay locked, watch keeps its rate-9 follow afterwards), with the `whoosh` sound.
The aim turns **by angle** (yaw / pitch from the old view direction to the new one), not by
sliding the look point: eyes → watch often faces the other way, and a lerped look point passes
right by the camera, which flipped the view in one frame near the end of the whip. Offsets over
12 m (across a big map) still cut. Measured (`netpolish`, 60 ms link, ~70 ms sandbox frames): an
8.2 m, 73° switch spreads over 5 frames, largest step 34 % of the move and 25° of the turn, the
aim never swinging back (was 100 % in one frame).

### Pro pass: net (presence keepalive, adaptive interpolation delay)

**Presence only streams while something changes.** `network()` compares the presence state with
what it last sent (1 mm, ~0.2°, 0.02 m/s; `q`, pose and flags exact). Anything different goes
out at once (one publish per ≥ 49 ms, net.js's 20/s, so every counted publish is really sent)
and keeps full rate for `PUB_HOLD_MS = 250` after the last change, so the partner's buffer ends
on a still pair and never extrapolates a stop into an overshoot. Then a keepalive every
`PUB_KEEPALIVE_MS = 400` (it still feeds the host's 4.5 s stall detection and its 800 ms
un-stall). That covers the hider's private zeros all hide phase (the finding), a still hider all
hunt, the blindfolded seeker, the lobby and the recap. A fresh link (new epoch) starts at full
rate. Real room sends per device, counted at the platform binding:

| | before | after |
|---|---|---|
| lobby, both idle | 9.5–12 /s | 2.0–2.3 /s |
| hide: hider (zeros) / blindfolded seeker | 14–20 /s each | 2.5 /s each |
| hunt: still hider | 13 /s (one per frame) | 2.2–2.4 /s |
| hunt: walking seeker | 13 /s | full rate while moving |

Over a Classic round (60 s hide, 90 s hunt, recap) that is about 2–3× fewer presence messages
per device (each one also cost net.js an object and the platform a room event).

**Adaptive interpolation delay** (`link.js`). The partner is drawn at `now − delay` on the shared
clock, so the delay has to cover the one-way trip **plus** the gap to the next sample; the fixed
100 ms didn't on any link slower than ~50 ms one way, and the buffer ran dry and extrapolated
(an overshoot on every stop, a snap back on every turn). Each accepted sample now records what
it needed (its age on arrival + the sender-side gap since the previous one, an idle keepalive
gap counting as one 50 ms interval); the delay follows the 2nd-highest of the last 40 (≈ p95)
+ 10 ms, clamped to 100–250 ms, rising at 80 ms/s and falling at 25 ms/s (the partner's clock
runs at 0.92–1.03× while it adapts). `net.delay` is kept equal, so lag compensation samples
exactly what was drawn, and the shot carries the shooter's delay (`dl`) for the victim's window.
A playtest script (two phones, the seeker walking, stopping and strafing for 11 s, the hider
drawing them; truth = the seeker's own path at the same render time; old = fixed 100 ms):

| link | frames extrapolated while the partner moves | drawn error p95 / max | overshoot at a stop | velocity hitches (> 0.8 m/s) |
|---|---|---|---|---|
| 60 ms ± 40 % | 33 % → **0 %** | 0.078 / 0.25 → **0.028 / 0.067 m** | 0.023 → 0.048 m | 17 / 167 → **4 / 180** |
| 110 ms ± 40 %, 5 % loss | 85 % → **2 %** | 0.17 / 0.38 → **0.037 / 0.097 m** | 0.24 → **0.097 m** | 55 / 190 → **5 / 147** |

(The sandbox's slow pages make its one-way trip 100–200 ms, so the delay settles at the 250 ms cap
there; on phones it should sit near 130–180 ms.) The hider's head-start position goes public
750 ms before the blindfold lifts (was 500) so the buffer is warm at the cap. `link.interpStats`
counts frames interpolated / extrapolated / held at the 160 ms cap / past a still pair.

**A 20/s schedule, not a 48 ms gate (net owner, second pass).** net.js's `publish` sends when
≥ 48 ms have passed since its last send. Frames land on a 16.7 / 33.3 ms grid, so on a 60 Hz phone
a publish that ran 47.9 ms after the last one (a little less JS before `network()` this frame)
waited a whole frame, and a 30 Hz phone (Low Power Mode) could only ever send every other frame.
link.js now sends presence itself (`api.setPresence`, net.js's wire format, read by its
`onPartnerState` as before) on a schedule: one slot per `PUB_MS = 50`, takeable `PUB_EARLY = 6 ms`
early, never closer than `PUB_GAP = 30 ms` to the previous send; the next slot advances ≥ 50 ms per
send, so the average can't exceed 20/s (any 1 s window: ≤ 21). `network()` asks `link.pubDue()`
and counts a publish only when `link.publish()` says it went out. Presence is stamped with the game
clock (`link.now()`: the guest's refined NTP estimate) instead of net.js's own estimate, so drawing,
shots and tag confirmation all read one clock. Node simulation of the real link.js against the old
gates (`network()` running 0–N ms into each frame, 30 s each):

| frame clock | old sends/s, gap p95 / max | new sends/s, gap p95 / max |
|---|---|---|
| 60 Hz, 0–1 ms jitter | 20.0, 51 / 51 ms | 20.0, 51 / 51 ms |
| 60 Hz, 0–4 ms | 18.0, 67 / 69 ms | **20.0, 53 / 54 ms** |
| 60 Hz, 0–8 ms | 17.3, 68 / 72 ms | **20.0, 62 / 67 ms** |
| 120 Hz, 0–3 ms | 19.2, 58 / 60 ms | **20.0, 52 / 53 ms** |
| 30 Hz (Low Power Mode) | 15.0, 69 / 70 ms | **20.0, 69 / 70 ms** (33 / 67 ms alternating) |

The p95 gap is what the partner's adaptive delay has to cover, so a jittery 60 Hz phone draws its
partner ~15 ms fresher. In the sandbox (60–90 ms frames) every frame sends either way; the playtest
numbers there are unchanged (60 ms link: err p95 0.013 m, 5 / 147 velocity hitches; 110 ms + 5 %
loss: 0.030 m, 8 / 146).

**The guest's game clock slews instead of jumping.** link.js keeps its own min-RTT estimate of the
host clock for the guest (the mean of the 3 quickest round trips, now of the last 24 instead of 12).
It used to jump to each new estimate; under load those were 10–40 ms steps every few seconds
(measured with both pages' wall clocks as the reference: one-frame steps up to 18 ms), and every
step skipped or rewound that much of the partner's motion, now on both screens since presence is
stamped with this clock. After its first 6 samples (the lobby) the clock now slews toward the
estimate at ≤ 5 % of real time: ≤ 0.8 ms per 60 Hz frame. Accuracy is the estimator's: recording
the guest's raw ping samples against the true host clock (`window.__chamClockRaw`, `clockRaw()`) and
scoring seven estimators offline on the same stream (best 1 / 3 / 6 of 12 / 24, RTT within 20 ms or
25 % of the minimum, net.js's ¼-slew), every one settled on the same ~15 ms error on the loaded
sandbox: the bias is the host page answering pings later than the guest reads them (event-loop
delay asymmetry, ~50 ms of the 125 ms minimum RTT there), which no filter can see. So the estimator
stays best-3 (now of 24) and only the steps are gone. The `match` section's "clocks agree within
20 ms" check therefore depends on load: 18.8 ms at load 12.6 (passes), 39–41 ms at load 21–24
(fails, before and after this pass); phones answer in a few ms.

**The tag lands on both phones (net owner, second pass).** Between the trigger and the FOUND
stamp:

- **A guest seeker's tags had no juice.** The victim answers a confirmed shot with `tagres`, and
  the shooter's hit-stop, flash and tag sound ride on it; but a *host* victim went straight to
  `hostFound` and sent nothing, so whoever wasn't hosting tagged in silence (half the rounds of
  every match, since roles swap). The victim now always answers.
- **The juice waits for the pellet.** On a quick link the confirmation can beat the pellet (it flies
  at 28 m/s: 180 ms over 5 m), and the flash fired while the pellet was still in the air. The
  shooter now delays the juice to the pellet's landing, at most 220 ms; a FOUND stamp that
  arrives first (a guest on a slow link) fires the waiting juice, so there's never a flash after it.
- **FOUND came ≥ 380 ms after the confirmation.** `roundOver` asked for a 260 ms lead
  (`DUR.foundLead`), but `enter()` raised every lead to `leadFor()` (≥ 380 ms, `1.3 × RTT + 160`),
  a margin meant for deadlines both phones must hit together. FOUND / SURVIVED are events: the
  partner only needs the message in time, so they now use `max(260, min(leadFor(), 0.6 × RTT + 80))`.
- **A partner's miss leaves the muzzle when the partner as drawn fires.** Each screen draws its
  partner `link.delay` (100–250 ms) behind the shared clock, and the `shot` message usually
  arrives sooner than that, so watching over the seeker's shoulder the pellet flew off before the
  drawn seeker had turned to aim (or from where a walking seeker would only be 0.3–0.6 m later).
  A miss now launches at `T + delay` (`clamp(…, 0, 300 ms)`); a tag still flies at once (the
  confirmation and FOUND follow it).
- **"Hit! Checking…" → "Hit!"**: the confirmation is a round trip away and "They slipped away!"
  still follows a refused tag; the text no longer announces the wait.

Measured (`netpolish`, 60 ms link, ~180–250 ms sandbox RTT, one run): host seeker fire → confirmed
176 ms → FOUND 437 ms (the old lead, `1.3 × RTT + 160` = 391 ms at that RTT, would have put it at
~567 ms); guest seeker confirmed 254 ms, juice +8 ms (the pellet still landing), FOUND 328 ms (no
juice at all before). A remote miss waited 18–145 ms for the drawn shooter.

Budget per device: presence ≤ 20/s while moving, 2.5/s otherwise, `chi` ~0.5/s, net.js pings/acks, reliable events a few per
second; a phase change costs 3 messages; the paint burst is one or two chunks.

## Pro pass: maps (switches, rematch, sealed nooks, variety)

Asked for: "polish the shit out of these games … addictive … play through what you can". The
maps owner's findings: every map switch, boot and rematch was one synchronous block (71–785 ms
at 1x, up to 1.6 s at 4x CPU; a rematch rebuilt everything: 6 s of long task in software GL);
crawlable nooks nobody could see into; nothing that made today different from yesterday; and a
test hook the culling undid every frame. Measured with scripted one- and two-phone runs (iPhone
13 profile) and an A/B page that builds both versions of every map side by side (same load).

### Map switches and boot

- **Session map cache** (`maps.js`): a built map (chunk geometries, blob shadows, atlas, colliders,
  spots) is kept for the session, LRU, at most 3 maps and 36 MB of CPU arrays + atlas pixels,
  never evicting the two newest (the map on screen and the one replacing it). Evicting disposes
  the geometries' GPU buffers. The stage keeps, per cached map, its atlas texture and chunk meshes
  (`mapRes`), and the collision world (`worlds`, a WeakMap); the minimap plan and its drawn
  canvases live with the map too (`MINI_PLANS` in game.js, `plan.bgs` in hud.js). Sizes held:
  Living Room 5.9 MB (9.9 once the eyedropper copy is read), Studio 4.8, Market 7.2, Greenhouse
  8.1, Garden / Museum 10.5, House 12.8, CU Boulder 16.7.
  Cached maps stay uploaded, so going back is upload-free; the price is GPU residency bounded by
  the cache. Walking all 8 maps in order on one page (`renderer.info.memory` after each): 32 → 128
  geometries peak, 125 at the end, textures 7–9, programs 15 throughout, JS heap flat at 23 MB
  (before this pass: 19–59 geometries, 6 textures, 28 MB heap). Worst case held: about 36 MB of
  CPU arrays + atlas pixels (CU + House + Living Room is 35.4), the geometry part again in GL
  buffers, and three 1024² mipmapped atlases (~5.6 MB each).
- **No program per switch.** The world, backdrop and blob materials are made once per stage (a
  1×1 placeholder keeps `USE_MAP` on; the atlas texture and `uAtlas` are swapped on load).
  Disposing the old world material used to release its program and the new one relinked it, and
  CU's fog-free backdrop material linked a 15th program on every CU switch (~155 ms). All three
  are in the boot compile (hidden one-triangle meshes); switching through all 8 maps: programs
  15 → 15.
- **Atlas painting** (`atlas.js` `finish()`): painters draw straight into the CPU-backed atlas,
  clipped to the tile, and the 8 px gutters are copied with `putImageData` (the old tmp canvas +
  9 clipped `drawImage` blits per tile + self-`drawImage` of the whole atlas for clamped gutters).
  Same pixels inside the tiles (± a few levels on anti-aliased edges): 25–225 ms → 8–40 ms a map.
  The 4–8 MB CPU copy for the eyedropper / stamp / blend score (`atlas.data`) is now a getter read
  on first use, or in `requestIdleCallback` after a switch.
- **Minimap**: the floor labels use the web font only once `document.fonts.check()` says that face
  is loaded (a still-loading face cost ~380 ms of `fillText` on the Market switch), else a system
  font; the drawn plans are reused on a revisit.
- **Cold build, before → after** (min / median of 5 in one page, ms, this sandbox at 1x; the
  geometry fill is most of what's left):

  | map | 1x before | 1x after | 4x before | 4x after |
  |---|---|---|---|---|
  | Living Room | 72 / 124 | 43 / 88 | 222 | 169 |
  | Garden | 88 / 102 | 72 / 75 | 139 | 114 |
  | Art Studio | 61 / 81 | 19 / 24 | 254 | 49 |
  | The Whole House | 109 / 141 | 96 / 113 | 328 | 336 |
  | Corner Market | 99 / 116 | 46 / 61 | 230 | 110 |
  | CU Boulder | 245 / 313 | 137 / 167 | 518 | 326 |
  | Greenhouse & Shed | 84 / 150 | 51 / 70 | 256 | 178 |
  | Museum Night | 167 / 244 | 43 / 73 | 521 | 188 |

  A map seen this session switches in **1–5 ms** of JS (`ONLY=mapcache`: best of three 1 / 4 ms).
- **The tap paints first.** A lobby map change (the host's arrows and chips, the guest following
  the host's `setup`, a lobby resync) updates the setup and the card at once and queues the build
  for the next frame (`queueMap`: rAF, then a task), so the card is drawn before the diorama is
  built, and a burst of taps builds only the last map. The arrow's click handler now runs in
  < 50 ms (asserted; it used to contain the whole build). Starting a match right after a tap
  loads the match map before the spawns are picked.
- **Boot in slices** (`stage.warm`): the "Warming up the paint" card now paints, then the programs
  compile one material at a time over a view of the scene (same fog and lights, so the cache keys
  match), yielding a frame whenever a slice ran past 24 ms, then each material's first draw on
  its own (3 vertices, everything else hidden, `gl.finish()` so the driver's pipeline work lands
  in that slice). Measured: 29 materials in 5–7 slices of ≤ 30–48 ms; the boot's GPU stall in
  software GL went from one 1.27 s block to ~0.4 s pieces.
- **Build-free rematch.** core.js already asks `inst.onRematch()`; chameleon answers false (a
  fresh mount keeps every flow simple) but the destroy that follows **parks the stage**
  (`parkStage`: canvas detached, map unloaded, fx cleared; renderer, programs, uploaded maps and
  paint textures kept) and the new mount's boot takes it (`takeParkedStage`, same three.js and
  pixel-ratio cap), so it links nothing and builds nothing. Unclaimed, it is disposed after 8 s;
  closing the game disposes as before (the `leaks` section is unchanged). Measured: Rematch tap →
  ready **48 ms** on CU (was a 6 s long task in software GL: CU build + 15 program links).
- **Mix it up's next map** is built during the recap (see below), so a round's title is a swap.

### Sealed nooks (`closeSlots`, guards, the pockets test)

The two cavities from the review: the Market fridge-header "gap" was a contact in the 10 cm slot
between two fridge headers, the body centred inside the neighbouring header; the House "wall cap"
was the armchair seat under its back cushion, which the engine already refuses (`buried`). The
pattern behind the first is common: a prop standing 2–15 cm off a wall or its neighbour leaves a
slot no chameleon can squeeze into (the squeeze profile needs 16 cm) but whose contact point
sticky feet accept. `closeSlots()` (maps.js, run on every build and in the map tests) extends a
prop's collider across any slot ≤ 15 cm to whatever covers ≥ 80 % of its face on the other side
(walls, slabs, stairs, rails, guards, glass and flat decals never move); it closes 8–420 slots a map (the Market's product blocks
and fridge row, CU's seat rows, counters and dressers against walls) in ≤ 3 ms on a warm build.
Map edits: the House and Market top slabs got eave guards over the outer wall tops (a Tiny body
could hang on the slab's outer edge, outside the walls); CU's two projector screens got a guard
in the 16 cm behind them; the Greenhouse shed loft's deck-chair roll moved to the railing (it
walled off a Tiny-sized pocket).

`ONLY=pockets node tools/test/games/chameleon-maps.test.js` (every map, Tiny / Large / Huge, ~65 s):
seeds every clearly open sticky-feet contact (0.5 m grid on every collider face, legal by the
engine's rules, ≥ 30 of 60 escape rays running 1.5 m into the room), crawls from all of them with
the real `world.crawl` / `move.crawlStep` (BFS on a 0.2 m grid, 3–75 k contacts a map), and
requires every reached contact whose body is in open air to be in sight of somewhere ≥ 1 m away
(escape rays, then a 0.35 m viewpoint grid out to 6 m; guards and glass see-through). All 24 map ×
size runs pass. It also checks the fridge headers meet edge to edge and that the armchair spot is
refused.

**For the mechanics owner** (not changed here: `world.js` is theirs): the engine accepts a contact
when its *contact point* is free, so a body can still end up centred inside a box through slots
wider than 15 cm, along an underside that rests on another box (crawl step 3 doesn't re-check
`buried`), or past an outer wall at the 2 cm `inside()` tolerance. The pockets test counts them per
map (e.g. CU Tiny 9 151 of 74 570 reached contacts centred in a box, Market 5 055 of 43 117). A
tested patch (`clearOf`: the body's centre and half-way point must be free, in `okContact` and in
step 3, with `buried` re-checked there) takes every map to 0 with 0–15 % fewer reachable contacts;
it's in this pass's notes (`world-clearOf.patch`).

**Applied (mechanics, QA round 1).** `world.clearOf(contact, n, r)` is in the engine: the body's
centre (a radius out along n) and the half-way point must be outside every solid box, and the
centre inside the outer walls (strict, not the 2 cm `inside()` tolerance). `okContact` (concave
transfer, convex wrap, `nearestSurface` for Stick) and crawl step 3 use it, step 3 re-checks
`buried`. A body already wedged somewhere it doesn't fit (a forced attach, an old snapshot) may
still crawl in any direction, so nothing freezes. The tongue-zip refuses a target the body
doesn't fit ("Too tight to fit in there", no cooldown or escape spent), the Wall pose and the
walk-into-a-wall auto-stick check it too. One grid query per check: a crawl step costs 1.77 µs
(was 1.63). The pockets section now asserts 0 centred-in-a-box and 0 past-the-walls on every map
at Tiny / Large / Huge (before: Market Large 4 710 / 56, CU Large 8 851 / 110, House Large 1 301 /
202, Garden Large 353 / 377, Museum Huge 644 / 85); seeds are filtered by `clearOf` too.
`ONLY=fit` (chameleon.test.js) is the in-game check: a Large body crawling along the Market's
right wall stops at the carton stack 0.25 m off the wall (it used to slide behind it with its
centre inside the cartons), a body forced into the slot crawls out, a zip at the wall behind the
stack is refused and a zip to the shelf underside beside it still lands.

### Variety: Mix it up, Today's hide, where you start

- **Mix it up** (a shuffle toggle tile beside Today, under the presets; `setup.mix`): the match plans its maps
  (`mixPlan(matchId, map, rounds, per)`: the map you picked first, then the same pool, the small
  dioramas or the big maps, never the one before, the whole pool before a repeat). In Hide & Seek
  a map lasts **two rounds**, so you each hide once on it: clocks and points scale with the map, and
  one of you hiding on CU (270 s hunt) while the other hid in the Garden (90 s) wasn't fair. Double
  Blind (both hide every round) changes map every round. The plan travels in the match info
  (`m.maps`); the host loads the round's map before picking spawns and every phone follows `m.map`.
  The recap's next line says "new map: Museum Night", both phones build it into the cache a round
  ahead (from the hide phase of the round before the change, `stage.prefetch` in idle-time slices,
  atlas uploaded with `initTexture`; QA round 1 below), and the title kicker reads "mixed".
- **Today's hide** (a Today tile under the presets): one setup per calendar day from the date
  alone (`dailyPlan(dayKey)`): every map once per 8-day cycle, a size, who hides first, and one
  twist on top of Classic (Floor only · Tiny chameleons · 3 pellets · 10 s head start · Paint while
  hunted), two rounds so each of you hides once. The host's day key travels in `setup.daily`, so
  both phones agree; any other change makes it the host's own setup again. Each round of a daily
  match records how long the hider lasted (`${w}_daily_${day}`, best of the day), and the lobby
  shows today's board above the records: "Today Emerson 1:10 · Sydney 0:41 · Emerson leads".
- **You start in the …**: on multi-room maps the hider's title card names the room of their
  spawn ("You start in the Stairwell", `roomAt(map, x, y, z)`, floor-aware); the seeker isn't told.
  Double Blind tells each hider their own.
- **Lobby fit**: Today and Mix share one row (Today spans three preset columns, Mix the fourth;
  while Today is on, Mix hides and Today spans the row). On short portrait phones (height ≤ 740 px)
  the tagline and the map blurb drop out, as they already do in landscape. Corner Market at 375×667:
  the card overflows 10 px with Start's bottom at 643 px (before this pass: 22 px, 655 px; with the
  Mix chip still on the map card: 120 px and Start off screen at 753 px). 390×844 and 844×390: no
  overflow.

### Culling hook

`cullChunks()` honours `userData.forceHidden` (what `tweak({ hideMap })` sets now), and counts the
chunks it actually draws (fog cull and the camera frustum): `perf().chunksDrawn`.

### Tests

`ONLY=mapcache` (one phone): the sliced boot, all 8 maps switched with no program linked, a
cached switch < 60 ms, an arrow tap's handler < 50 ms with the card updated at once, `chunksDrawn`
with `tweak({ hideMap })`, a hotseat match to the end card and a Rematch that reuses the parked
stage (programs unchanged, one GL stage), maps still switch after it, closing tears it down.
`ONLY=variety` (two phones): `mixPlan` / `dailyPlan` / today's board in Node; the Mix chip and the
Today tile sync to the guest; a mixed 4-round House match: the hider's "You start in the …", round
2 still on the House, the round-2 recap's "new map", both phones prebuilding round 3's map, round 3
on it on both phones.
`chameleon-maps.test.js ONLY=pockets` as above (its static section now runs `closeSlots` like the
game).

### Maps QA round 1: the cache after closing, cold builds in slices

QA found two things. **The session cache outlived the game**: after opening Blend & Seek, visiting
CU, the House and the Museum and closing it, the page kept 7.0 MB of heap + 31.8 MB of array
buffers (hub: 2.7 + 3.2), with up to three atlas canvases on top, while the couple went on to
play Getaway or Rush. And **a cold build was one unsliced task**: tapping the lobby arrow through
all 8 maps at 4x CPU, the longest task per cold switch was 216–839 ms (CU 802–839 at load ~10,
up to 2.1 s at load 20–28; the owners' own 4x minima House 336 ms, CU 326), the same build ran
during Mix it up's recap (`stage.prefetch`), and `hud.miniSetup` added a forced style recalc
(`getComputedStyle`, 414 ms of self time in a 4x House switch).

- **The cache lives as long as a stage.** stage.js counts live stages; when the last one is
  disposed (the game closed, or a parked rematch stage nobody claimed) `clearMapCache()` evicts
  every map (GPU buffers disposed, the atlas canvas shrunk to 1×1 so its pixels go at once) and
  drops builds in progress. A rematch still parks the stage, so it stays build-free. A hidden page
  (`visibilitychange` → hidden, `pagehide`) keeps only the map on screen and the one being
  prepared (`nextMap`) — iOS reclaims memory from background web views first. Measured like QA's
  probe (open, CU + House + Museum, close, 10 s, two forced GCs): **6.6 MB heap + 3.9 MB buffers**
  (was 7.0 + 31.8), a second open/close 6.7 + 3.9 (was 6.9 + 25.0); the heap left over is the
  engine and the modules (open/close without leaving the Living Room leaves 5.7 + 3.9).
- **Builds in slices** (`maps.js`). `buildSteps()` is the build as a generator: it yields after
  each atlas tile (`atlas.finishSteps()`), after each map section (the map fills are generators,
  `yield` between rooms; CU's G1B30 section yields between its tiers, seats, boards and catwalk),
  every ~1.5 ms while replaying the builder calls recorded during a section (`b.add` merging a
  primitive into its chunk is most of a build; `add` and `collide` are replayed in order, so the
  colliders come out the same), and after each attribute of each geometry chunk
  (`geo.finishSteps()`). `buildMap()` runs it to the end at once (a sync caller of a map being
  built in slices finishes that build); `buildMapAsync()` runs it in time-boxed slices, one per
  frame (rAF, then a task, with a timer so a hidden page doesn't stall it), or in idle time.
  Same result byte for byte: `chameleon-maps.test.js ONLY=slices` compares every vertex / index
  array, collider, blob, probe, spot and room of direct and sliced builds of all 8 maps, and they
  also match HEAD's builds before this pass. Steps per cold build: 37–62 (Living Room) to ~390
  (CU); the longest single step at 1x in Chrome is 3–7 ms on most maps, up to ~16 ms on CU (a
  GC or a JS array growing inside one `add`).
- **The lobby** (`queueMap`): the card changes at once, then `stage.prepare(id)` builds in 16 ms
  slices while the old diorama keeps drawing, adds the collision world and the atlas upload
  (`initTexture`) a slice each, and only then swaps the scene (`flushMap`: ≤ 4 ms at 1x, 8–17 at
  4x). A newer tap drops a half-built map (`alive()`), so a burst still builds only the last one.
  At 4x CPU (load 2–3) through all 8 maps twice: **the longest task per cold switch 57–114 ms
  (median 80)**, 5–40 slices, the new diorama in 0.7–3.4 s in software GL (most of that is
  SwiftShader drawing the old diorama between slices; a phone draws a frame in a few ms). At 1x:
  1–13 slices, longest task 50–83 ms (frames; the build's own slices are ≤ 16 ms + one step).
- **The boot** prepares the lobby map the same way behind the loading card, and `stage` is only
  set once the map is in, so nothing (a setup message from the host, a resize) ever sees a stage
  without a map; a game closed mid-build disposes the stage it made.
- **Mix it up's next map** is prepared in idle-time slices (`requestIdleCallback`'s deadline,
  ≥ 4 ms, ≤ 10; Safari has no `requestIdleCallback`: a slice after each frame); when frames are
  slow (slices 100+ ms apart, as with two software-GL phones) a slice may take up to 15 % of the
  wall clock (≤ 30 ms). It starts 1.5 s into the **hide phase of the round before the map
  changes** (`prefetchNext` in game.js: in Hide & Seek round 2's hide for round 3's map, in Double
  Blind every round's), so it has a whole round: the seeker's canvas is hidden then and the hider
  mostly orbits and paints. FOUND / SURVIVED and the recap call it again (a no-op while that build
  runs or once it's cached, a restart if it was dropped). It used to start 0.3 s into the recap: in
  the 3.5 s test recap with two software-GL phones at load 9–13, CU came up short and the round's
  start finished it in one 173–545 ms task (`bootInfo().builds[]`: `drained`, `drainMs`).
  Measured (two phones, House → CU, load ~15): 14 idle slices during round 2, done long before
  round 3, step p90 2.1 ms. `ONLY=variety` pins the plan to House, House, CU, CU (`mixSeed`), the
  biggest prefetch.
- **closeSlots in steps.** In a fresh page (cold JIT) on a busy box CU's slot pass over 1 016
  colliders was one 15–47 ms step (once 395 ms with a GC in it); it now yields every ~3 ms
  (`closeSlotsSteps`, same result: the `slices` hashes are unchanged).
- **Step sizes in the tests.** Builds record each step's and slice's time: `maxMs` / `maxAt` (the
  longest step and its label), `p90`, `over50` (steps past 50 ms), `sliceP90`, `maxSlice`. These
  are wall times: under load 8–18 on this 4-core box (the software-GL GPU processes run at a higher
  priority than the pages) a preemption or a GC pause lands on a step or two (seen: 66–206 ms on
  `add` / `chunk` / atlas-tile steps that take 2–14 ms at rest), so the tests bound the code's own
  sizes: step p90 < 16 ms (measured 1–4.3), at most two steps a map past 50 ms, slice p90 < 40.
- **Minimap**: the body font token is read once at mount (`hud.js`), not with `getComputedStyle`
  in every big-map switch (an empty token is remembered too, so a theme without it never re-reads).
- **QA's own probes, re-run on the fix** (iPhone 13 profile): `pt-retain` hub 2.7 + 3.3 MB → open,
  CU, House, Museum (8.2 + 34.0 MB with three maps cached) → closed + 10 s **6.6 + 3.9 MB**, a
  reopen builds the lobby map afresh (`hits 1`), a second close 6.7 + 3.9. `pt-maps` at 4x CPU, real
  arrow taps, two cycles through all 8 maps (load ~4, another browser running): **longest task per
  cold switch 66–153 ms** (QA: 216–839 at load ~10, up to 2.1 s at 20–28), programs 15 throughout.
  A filmstrip of a cold Market → CU switch at 4x (`film-cu-montage.png` in the maps scratch dir):
  the card reads "CU Boulder" in the first frame, the Market diorama keeps orbiting behind it
  while CU builds (51 slices, the longest 66 ms with three browsers on the box), then the swap.

Tests: `ONLY=mapslice` (one phone): the boot's sliced build; real arrow taps through all 8 maps
(cold), the big maps over ≥ 3 slices and frames, step p90 < 16 ms with at most two steps a map
past 50 ms (the boot too) and slice p90 < 40 ms (bounds that hold on a busy shared box; at rest
steps are ≤ 6–16 ms and slices ≤ ~30 ms; the
longest task, frames included, is reported: software-GL frames on a busy box are long tasks by
themselves); closing while the boot is still building the lobby map disposes its stage; Next
while the House is building drops it and builds only the Market; `pagehide` trims the cache to the
map on screen and maps still switch; closing leaves < 8 MB over the hub (measured +5.4 MB with
the three.js engine loaded; ~+33 MB before); a reopen starts from an empty cache. `ONLY=variety`
now also requires round 3's prefetch (CU) to run during round 2 in idle slices (≥ 2, step p90
< 16 ms, ≤ 2 steps past 50 ms) and be done before the round, or leave < 150 ms for the round's start.
`chameleon-maps.test.js ONLY=slices` (Node, a stub canvas): sliced = direct, byte for byte.

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
  descriptors, DOM writes only on change); a presence send allocates one object (≤ 20/s while
  moving, 2.5/s keepalive otherwise).
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
mechanics and the settings panel at 390×844, 844×390, 1280×800, light and dark). v3: `seekclimb`
(the seeker Sticks with a real tap, crawls up the wall with the joystick onto the rafter, hangs; the
hider's screen draws the orientation and pose; a tag fired from the ceiling; the seeker's zip leaves
no trail), `seekguards` (one device on the House: the climbing seeker stops at the guards, the toggle
off), `spectate` (watch / free cam: badge, marker, joystick + keys, clamped, body unchanged, the
seeker's copy unchanged, zero messages sent), `huntpaint` (brush and stamp while hunted reach the
seeker with matching hashes, the glint in range, none out of range or with "On", "Off" refuses,
coalescing), `timing` (one device: 10 s hide, 5 s countdown, 5 s head start, 3 s grace, 20 s seek,
points; then On Ready and a 10 s countdown), `timinglive` (two phones: untimed hide, no countdown,
the hider moving during the head start while the seeker is blind, grace refusing fire),
`settings3` (every new control through the sheet with taps, the slider, presets, validation, map
scaling, persistence), `v3house` / `v3cu` (full 2-round matches with the v3 settings), `shots3`
(screenshots). Screenshots go to `$SHOTS` (default `$TMPDIR/chameleon-shots`).

- `blendfair` (paint QA round 1, 1b): the blend % from five viewpoints against what is really behind the body (a stamp is a start, not a free Ghost), the side hint, the x-ray, the Market's fridge pillar (the bottles show past its edges; the stamp prints them), a plain painted wall (one stamp → the +10 star, filled → Ghost, "Invisible!" past 95), Gold needs a hide that held up.
- `paintfeel` / `paintjuice` / `paintpro` (pro pass, paint owner): codec and lock cost, dab culling, brush cursor and sound, fill / stamp juice; the stamp wipe and fill flood (settle-before-read), the live camo meter (sliced scoring, grade pops, layout at three viewports) and the lock reusing its score; the meter x-ray (a real tap), "Invisible!", the stroke tail, the undo pool and the paint path's costs at 4x CPU. `PAINT_SHOTS=<dir>` / `PAINT_MONT=<mont.js>` for screenshots and montages.
- `uxfinal` / `uxrematch` / `uxward` (UX QA round 1): a 4-round hotseat House final card at 390 × 664, 375 × 667 and 375 × 560 (See the board on screen and on top, the hub stickers clear, vote chips two to a row, stickers folded, a real CDP finger drag scrolls the card with the button pinned, a vote keeps the scroll), the House lobby fits 390 × 664 and scrolls at 375 × 560, two hotseat rematches follow the card's "hides first"; two phones with Sydney picked first: both cards promise Emerson and the rematch starts with Emerson on both; wardrobe rows as tall as their tiles at 390 × 844 / 664 and 375 × 667, the sheet scrolls under a finger.
- Final QA: `camsweep` (the camera sweep above, asserting ≥ 95 % ok and 0 inside per view), `foundcam` (one device: the hint clears at FOUND, a real 1.6 m tag, 75 seeker spots × 3 sizes, a hider behind each low prop), `finalqa` (two phones, 150 ms: the lock and head start keep the spot neutral on the seeker's phone, mute reads ≤ 1 a second, no HALF TIME / LAST PELLET after a tag yet both still pop in round 2, portrait paint options 44 × 44); `spectate` also checks the Watch camera ≥ 0.9 m from a climbing seeker at six contacts and the "You" sticker clear of the role pill; `db` plays a both-dry void round; `uxland` asserts 44 × 44 for the lobby, the hide buttons and the paint options.
- `netpolish` (pro pass, net owner; 60 ms link): the presence schedule in Node on 60 / 120 / 30 Hz frame clocks (≥ 19.5/s, ≤ 21 in any second), presence keepalive (≤ 3.5 real sends/s in the lobby, for the hiding hider and the blindfolded seeker, ≤ 3.2 publishes/s for a still hunted hider, full rate the moment it looks round: ≥ 85 % of min(frames, 20/s) and never over 21.5/s, host never stalls), the adaptive delay (above 100 ms, ≤ 250), the eased View → Watch switch (no single frame takes > 85 % of the move or the turn, the aim never swings back), pellet range = fog far, a remote miss launched in step with the drawn shooter (≤ 300 ms), a tag judged with the shooter's delay, and the tag juice reaching the shooter no later than FOUND in both directions (round 2: the guest seeks the host). `NETSHOTS=1` also saves the whip frames.

### UX QA round 1 (final card, rematch order, wardrobe)

- **A finger can scroll a tall card.** controls.js held every root `touchmove` outside
  `[data-scroll]` (so the Claude app's sheet never moves under a drag), and only the settings and
  wardrobe sheets were marked: a 4-round final card (712 px of content in 628) could not be dragged,
  so the vote, emotes and See the board were out of reach on a 375 × 667 phone. The lobby, recap
  and final cards are now `[data-scroll]` (`touch-action: pan-y`, `overscroll-behavior: contain`),
  and controls.js decides once per touch, at `touchstart`, whether anything between the finger and
  that card can actually pan (vertical or horizontal overflow with `overflow: auto`): a card that
  fits still keeps the app sheet still.
- **The button stays on screen.** The recap's Next and the final card's See the board (with "Next:
  …" / "Rematch: … hides first") sit in a sticky `.chm-foot` at the card's bottom edge. On a phone
  (≤ 560 px wide) the recap / final cards start below the hub's back / menu stickers
  (`--gm-corner-safe`) instead of under them. A vote (which rebuilds the card) keeps the scroll.
- **Fewer, clearer stickers.** A record beaten twice in one match shows once (the last), records
  carry their owner's ink dot (two "Found in 0:05" were Emerson's and Sydney's), a look unlocked by
  both is one two-dot sticker, and past two stickers the rest fold into "+N unlocked" / "+N more"
  (names in its label). Vote chips are two to a row (375 px stacked all four), and short portrait
  phones tighten the card's gaps. Measured (seeded worst case: 6 records + 6 unlocks): 541 / 574 px
  of content in a 574 px card at 390 × 664 / 375 × 667 (fits; was 712 in 628), 574 in 470 at
  375 × 560 (scrolls 104 px, See the board pinned at 475–526).
- **Nothing squashes in a scrolling card or sheet.** Flex items of `.chm-card` / `.chm-sheet` no
  longer shrink (`:where(.chm-card, .chm-sheet) > * { flex-shrink: 0 }`; the wardrobe rows are
  `flex: none`): the wardrobe's tile rows had shrunk to 49 px (tiles 96) at 390 × 664 because an
  `overflow-x: auto` row's minimum height is 0. Rows now 108–122 px at every size, the sheet scrolls.
- **The House / CU lobby fits a short phone.** On short portrait phones the map card is a grid: the
  facts (size · rooms · floors · climbs) run under the plan and name two chips a row instead of a
  four-high stack in the 120 px column beside them. Lobby card at 390 × 664: House 643 → 613 px of
  content in 628 (fit), CU 641 → 628 at 375 × 667; every map's lobby is the same height now (the card
  no longer jumps when you page maps).
- **Who hides first** is carried across Rematch (see the final-card bullet above).

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
