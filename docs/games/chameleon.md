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
  jammed into a corner) it is hidden. Let go / land → first person again, looking the same way (the
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
  `lp`), clamped out of walls.
- **Free cam** flies where you look (left thumb / W A S D, drag or mouse to look, Space / E up,
  Q / C down, Shift fast), collides with nothing and is clamped to the map's footprint and from the
  floor to just above its tallest collider.
- A **"You" sticker** marks your own body (pinned to the screen edge when it's off screen), the role
  pill turns yellow and names the view, and a thin highlight frames the screen.
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
  position stays private until 0.5 s before the blindfold lifts (so the seeker's interpolation
  buffer is warm). Only the hunt scores: points = seconds of hunt (+30 for surviving).
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
- **Blend %** (`blendOf`, game.js): at the lock, every body texel facing away from the surface the
  hider is on (the wall behind a stuck body, else the floor below, found exactly as the stamp
  finds it) is projected onto that surface, the surface albedo there is sampled with the stamp's
  sampler (vertex colour × atlas tile × blob shadow), and
  `camo = 100 × (1 − 2.8 × mean |ΔRGB| / 255)` (clamped). Grade words: Ghost ≥ 90, Sneaky ≥ 75,
  Spotted ≥ 50, Sore thumb < 50. Measured: plain white on the Living Room wallpaper 43 %, after
  one stamp 97 %. The hider's device computes it (`R.blend[w]`), it travels in the paint blob's
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
in under 15 s" · Gold "blend 90 %+" · Galaxy "survive on a ceiling 3×"), **eye shape** (Round · Cat
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
  phone (or 12 s) hands over to the hub card with Rematch. Who hides first now defaults to the hub's
  rematch counter (alternates every rematch).

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
- **Seeker climb camera**: the half-space limit is 0.55 × dist (was 0.3), and when walls or low
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
  - Stamp flashes the outline white and thins it to nothing over 0.25 s. The real reveal
    outline always wins.
- Test: `ONLY=paintfeel` covers lock cost (cold and warm), blob reuse, part culling, the
  preview ring, and the fill and stamp juice. It writes `brush-*.png`, and `PAINT_MONT=<mont.js>`
  makes a montage.

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
| hider position during Hide | owning device | **not sent** — presence carries zeros (look, wall angle, speed too) and `v: 0`, as a **2.5/s keepalive** (one publish per 400 ms; it still feeds the host's 4.5 s stall detection); full 20/s resumes 500 ms before the hunt so the seeker's buffer is primed |
| paint texture | owning device | reliable blob at lock (+ snapshot on resync) |
| mode, map, first hider, rules (validated) | host | reliable `setup`; rules also inside every `ph` match info |
| phases `hide lock seek found time recap final` (+ local `curtain`) | host | reliable `ph {seq, at, dur, scores, match}` **plus two unreliable copies** (deduped by `seq`, not held back by in-order delivery); both devices switch with `setTimeout(at − now)` and a per-frame check |
| timed transitions | host | pre-announced one lead (≥ 380 ms, `1.3 × RTT + 160`) before the deadline so both flip exactly at it |
| shots, splats, pellets | shooter | reliable `shot` |
| tag confirmation | victim | reliable `tagres` |
| round result + scores | host | inside `ph` |
| scan / scurry / zip | seeker / hider | reliable `scan {at, left}` / `scurry {at, left}` / `zip {at, to, left}` (v3: the seeker's `zip {at, to, sk: 1}`) |
| paint while hunted / during a head start (v3) | hider | the lock's paint blob with `live: 1`, ≤ 1/s, 1 chunk typically |
| hider's spectator views (v3) | hider | **not sent** (purely local) |
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

**Pellet range = the fog (pro pass).** `fire()` picks (and the near-miss assist searches) only
up to the play fog's far edge, `min(40, fog.far)`: 26 m on big maps, 30 m on small ones, so a
shot can't tag a hider the fog has fully hidden. A miss flies `min(30, range)`. CU's glass is a
collider without a mesh: pellets pass through it (you can see through it), bodies and tongues stop.

**Watch / free cam / eyes switch (pro pass).** `setView()` no longer cuts: the first camera frame
after a switch records the offset between where the camera was and the new view's target, and
`cameras()` eases it out with a smoothstep over `VIEW_WHIP_S = 0.35 s`, riding on the new view's
own motion (eyes stay locked, watch keeps its rate-9 follow afterwards), with the `whoosh` sound.
Measured: a 1.2-8 m switch now spreads over 4-6 frames at 65 ms (largest single step 40 % of the
move, was 100 %).

Budget per device: presence 20/s (2.5/s while hiding), `chi` ~0.5/s, net.js pings/acks, reliable events a few per
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

- `netpolish` (pro pass, net owner): the hiding keepalive (≤ 3.2 publishes/s while hiding, one per frame once hunted, host never stalls), the eased View → Watch switch (no single frame takes > 85 % of the move), pellet range = fog far. `NETSHOTS=1` also saves the whip frames.

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
