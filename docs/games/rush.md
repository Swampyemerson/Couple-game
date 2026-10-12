# Rail Rush — design

Three-lane endless runner for two, on one seeded track, live on two phones or split screen on one
computer. Entry `js/games/rush.js`; modules in `js/games/rush/`. Test: `tools/test/games/rush.test.js`
(run in three parts: `ONLY=gen,split,leak,drop,dark`, then `ONLY=race,brawl,tandem,pause,daily`, then
`ONLY=rival,loop,rejoin`; `heap` and `seam` run on their own. `gen` also asserts the clip grace, combo
tiers, the Daily seed, that **track v1 hashes never change** (five seeds, so saved and older-build
matches regenerate the same track), that v2 hashes are identical on both phones, and a perfect bot clean
on v1 and on v2 (500 chunks × 5 seeds each); `dark` that a rolling barrel ahead shows the "!" and rumbles
once; `race` the ghost marker, bests, that a new match runs on track v2, and an unlock's persistence
across a re-mount; `daily` a whole Daily run, today's board and the forfeit offer; `rival` (the logic in
`rivalUnit()` with a fake clock, then two phones in light and dark plus one device) overtake / revenge /
best stripes / neck and neck / clutch / shared power-ups / team best; `loop` the Daily twist, dares and
stamps, the love-note input and pickup, and the new unlocks; `rejoin` a partner re-mounting mid-match).
Every run section (split, race, brawl, tandem, daily) also spies the feedback layer and asserts crash
sounds, music ducks and CRASH!/FELL!/SLAMMED! pops equal the local runners' real crashes (one pop per
crash: a Brawl slam shows only the mode's "SLAMMED! by …"); `split`
queues a combo payout (`__rush.emit('a', 'bonus', 5)`) and checks it lands on the ladder with no crash.

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
- First run: a contextual ghost-hand tutorial, once (`localStorage`, guarded). "Switch lanes" shows
  from the countdown until you do (coins pull you to the middle), "jump" as the warm-up barrier
  row (52 m) comes up and "roll" before the bar row (84 m), each turning hot (yellow, bigger) when
  it's time to act. Those two rows span every lane on everyone's track and are *soft*: a miss
  trips you (a stumble), it never costs a heart.

## Feel numbers (js/games/rush/tune.js)

120 Hz fixed-step sim with render interpolation (a 4× slower phone steps up to 40 sim steps a frame
and never drops an input: actions apply to the runner immediately and take effect on the next step). Speed `12.5 → 30 m/s` (`v = V0 + (VMAX-V0)(1-e^(-t/110))`),
lane change 0.13 s cubic ease-out (test: 100–150 ms), jump apex 1.69 m / 0.75 s in the air with a low-gravity hang near the top, 0.62 s roll,
sneakers apex 3.9 m (reaches train roofs). Side clip = stumble (−40 % speed, decays over 0.9 s,
camera shake, bounce back to the lane you came from). Head-on = crash: −1 heart (3), 1.6 s down,
respawn in the clearest lane with 2 s of ghost invulnerability. Shield absorbs one crash or attack.

**Forgiving-but-fair hits.** The collision loop used to stop at `z0 > z + HALF_D + 0.6`, with no
other front test, so a hit fired 0.6 m (~25 ms at speed) before the runner's hull reached the
obstacle: a hit that looked like a miss. The slack is 0.06 m now. A head-on whose lane change began less than `LATE_DODGE_T` = 0.1 s
before impact is a *clip*, not a crash: the runner bounces back to the lane it came from, stumbles
(1.1×) and the obstacle is ignored for 0.45 s ("Clipped it! · swipe a touch earlier"). In the
headless human model (perfect-information bot + 250 ms reaction + ±90 ms timing jitter + 6 % missed
inputs + 3 % wrong directions, `scratchpad/rush3/simplay.mjs`) that turned 10/48 "unfair-looking"
deaths (a swipe one step before the hit) into 5/48 (jumping into a high bar, falling off a bridge:
legit), and a 3-heart run from ~860 m to ~880 m (median; first death ~350 m, difficulty 0.4).
The perfect bot's "never caught" guarantee is unchanged (clips count as stumbles in its search).

**Juice.** Crash: 90 ms hit-stop (`HIT_STOP`: the sim keeps its clock, only the picture holds on
the impact frame, so nothing desyncs), a −7° zoom punch that relaxes, shake 0.7, flash, haptics,
and a layered crash sound (thud + crunch + ring + low tail). Near miss: a sparkle burst on the
obstacle's side, a small FOV kick (0.25, 0.35 once the combo is x3+), +2 coins and "Close call!",
its chime pitched up 2 semitones per combo step (to +12). Respawn: whoosh + rising chime + FOV kick.
Distance milestones pop every 500 m ("1 km!"; in a Race "+♥ heart back"). A combo bonus lands on the
combo ladder ("x5 · Slick · +10 coins") rather than as a centre pop, since a close call usually pops on the same step.

**Combo ladder (polish wave 2).** A *dodge* is a row front passed cleanly: jumped / rolled /
climbed in your lane, or one whose lane you swerved out of within the last 30 m (`passed()` in
sim.js; one count per row, so a two-lane row is one dodge; ramps and invulnerable runners don't
count). Any stumble or crash breaks the chain, and so does `COMBO_T` = 6 s without a dodge.
Tiers `COMBO_TIERS` 3/5/8/12/16 pay `COMBO_BONUS` 5/10/15/25/40 coins, and past x16 every 8 more
pays 40 again. The word reads by tier, not by count: x2 Nice, x3 Great, x5 Slick, x8 Wild,
x12 Unreal, x16 Legend, and the HUD number grows per tier (glowing at Unreal / Legend). The old
rule only counted lateral passes begun < 0.28 s before a front, so the chain broke every corridor
(human model: max combo p50 3, x10 never). Measured with the human model (60 runs,
`scratchpad/pro/rush/sim/combo.mjs`): max combo p10/p50/p90 = 3/6/10, x5 in 36/60 runs, x8 (Wild,
the Embers unlock) in 16/60 (27 %), x12 in 3/60, x16 in 0/60; the perfect bot reaches x56–x69
over 3 km. Rejected variants: "any front within one lane" with a 4 s window (p50 11, x16 in 16/60:
everything was a combo), the swerve rule with 3 s (p50 4, x8 7/60).

**Close calls by distance.** "Close" used to be time-based (lateral `laneAge < 0.28 s`), i.e. 3.5 m
at 12.5 m/s but 8.4 m at 30 m/s, so every lane change at speed was a close call. Now: lateral when
the swerve began within 2.5 m + 0.05 s·v of the front (3.1 m at 12.5 m/s, 4.0 m at 30; an oncoming
train counts its closing speed), roll when the roll began within 1.5 m + 0.04 s·v, jump with the
feet under 0.3 m over a low barrier. Human model: 9.9 per run (11/km), perfect bot 15–24/km. The
Ink-puffs unlock moved to 15 in one run so it stays a second-session goal.

**Coin audio.** One coin voice per 45 ms at most (the HUD still counts every coin); the pitch
streak climbs `[0,2,4,5,7,9,11,12]` semitones over 8 coins (was 28 semitones, up to 5.3 kHz) and
sinks one step per 250 ms of silence instead of resetting. Under a magnet (which collects up to 8
coins in one sim step) coins don't each ring: a soft "hoover" (one lowpassed saw at 0.05 gain whose
pitch follows speed, `audio.setMagnet`) plays while it's on, plus one light sparkle per 3 coins. A wind bed (looping noise through a lowpass, `audio.setWind`) rises
with speed under the music, which already fills in with speed. Squash/stretch on jump and land,
lane lean and camera roll, landing dust and magnet trails were already there.

## Track generator (js/games/rush/track.js)

- 100 m chunks, each a pure function of `(seed, index)`: the same chunk on every device, built in any
  order. Only `+ − × ÷ sqrt floor` are used (no `exp`/`sin`), so every JS engine agrees bit for bit.
- Every chunk carves a **safe path**: it enters in `safeLane(seed, i)` and leaves in
  `safeLane(seed, i+1)`, and every obstacle is placed around that path. On the path an obstacle is
  only ever jumpable/rollable; lane switches of the path happen in a window where every lane it
  crosses is clear for `0.15 s × lanes + 0.34 s` at design speed (sized for 0.15 s lane changes,
  though they now take 0.13 s: deliberately generous). Coins trace the path.
- Spacing is in **seconds at design speed** (`sqrt(V0² + 0.3·d)`), shrinking from 1.05 s to 0.58 s
  between rows as difficulty `1 − 1/(1 + 0.3x + 1.1x²)`, `x = d/1000` rises: gentle for the first
  ~30 s (0.09 at 200 m, 0.16 at 300 m, 0.23 at 430 m, 0.36 at 600 m), then ramping (0.58 at 1 km,
  0.83 at 2 km). The midpoint was 850 m, which put a hump at 200–600 m where most first runs died. Mechanics
  unlock one at a time: gaps ~205 m, oncoming trains ~280 m, narrow bridges ~390 m, slaloms ~550 m.
- Chunk 0 is the warm-up straight: empty for 20 m, then the two soft tutorial rows (above).
- Patterns: barrier rows (low = jump, high = roll), train corridors, zig-zags (forced lane switches,
  two-lane switches late), ramps onto roofs (a second level with coins), broken-bridge gaps (jump),
  narrow bridges (one lane over a drop), oncoming trains (move at 0.55× your speed toward you, with a
  horn and a lane warning), slaloms (jump-roll-jump combos), tunnels (wrap a chunk; no ramps or gaps).
- Oncoming trains are deterministic in *runner space*: the front is at `zm − k·(z_runner − zm)`, so
  the footprint you must avoid is the static interval `[zm, zm + L/(1+k)]` on every device.
- Pickups: magnet (10 s), sneakers (10 s), shield; Race adds weapon-box rows across all lanes;
  Tandem adds revive tokens at run time.
- **Track version.** `TRACK_V = 2` (tune.js). The host sends `v` in `start` (and `rejoin`); a start without
  it (an older build) is **v1**, and `M.trackV` decides everything below. Version 1 is frozen: its output is
  byte for byte what it always was (the `gen` test pins `trackHash(seed, 40)` for seeds 1, 42, 1337, 98765,
  2024 to 3136954854, 4253233196, 2072935168, 4028480087, 2286558484), so a saved or older-build match
  never changes. Everything in the next list is gated on `ver >= 2`, draws from its own stream
  `rng(hash(seed, '<stream>', i))` (never the main chunk stream, so v2 chunks keep the v1 skeleton), and
  enters `chunkSig` / `trackHash` only for v2.
- **Track v2 content**:
  - *Rolling barrels* (`O_BARREL`, stream `barrel`, difficulty ≥ 0.3, about 500 m): 0.9 m drums that start
    to roll once you are `BARREL_LEAD` = 45 m away and then come at `BARREL_K` = 0.35 × your speed
    (deterministic in runner space like an oncoming train: `barrelFront`, static footprint
    `[zm, zm + D/(1+K)]`, and the generator keeps the roll-in clear of anything else). Jump (a low barrier
    to the sim: feet just clipping the top is a trip, not a crash) or swerve; a pair in two lanes forces a
    jump or the third lane (60 % of placements try a pair). A rumble sound and the "!" over the barrel's
    lane (`game.js` warning loop, once per barrel; an oncoming train's lane wins when both are close).
  - *Fool's-gold branches* (stream `gold`, chunks 3+, p 0.35): a clear window of ≥ 18 m in a lane off
    the safe path gets 5 coins worth 3 each (`coin.v = 3`, drawn 1.4×, own chime). Never over gaps,
    trains or narrow bridges.
  - *Events* (stream `event`, chunks 4+, p 0.08, ≥ 6 chunks apart, never in a tunnel): **Coin Rush**, a
    30 m field of coins in every clear lane ("COIN RUSH!" pops 2 s before `c.eventZ`), or **Golden
    Hundred**, every coin in the chunk pays ×2 (tinted gold; a pop on entering it).
  - *Love note* (`I_NOTE` = 6, stream `note`): once a run, in one of chunks 4–8, on the safe path; an
    envelope in the pickup instancing.
  - *Coin doubler* (`I_DOUBLE` = 7, stream `dbl`): about 30 % of magnets are doublers instead; every coin
    pays ×2 for `DOUBLE_T` = 8 s, with its own ring in the power-up row.
  - The Daily's Gold rush twist passes `{ goldP: 0.7 }` to `createTrack` (a superset of the normal day's branches).
- **Pickup events** carry `E_PICK = kind × 1,000,000 + chunk × 1000 + slot` (the old encoding broke past
  chunk 100); the decoder splits on 1e6. Kinds 4 (box) and 6 (note) pop nothing of their own
  (`PICK_NAME` is empty there; extras shows the note card), 7 pops "COIN DOUBLER".
- Verified by a perfect-information bot (depth-first search over the real sim, 2 s horizon): no crash
  in 500 chunks × 5 seeds on track v1 and again on v2 (test). With a goal lane (a revive heart within 70 m, a Brawl shove) the
  search tries the move towards it before the last plan's hint, and in the goal lane holds it before
  a planned move away (hint-first, a feasible 'stay' won and the bot ran past the heart: split-screen
  Together on autopilot showed 0 revives).

## The loop: bests, Daily, unlocks

- **Shared game data**: `api.data() / api.setData(patch) / api.onData(fn)` (core.js
  `gameDataApi`): one flat doc per game at `gamedata/rush`, mirrored in `localStorage`
  (`ju.games.data.v1`), written as field patches (`update`, or `set` the first time) so two phones
  writing different keys never clobber each other. Numeric `*_m / *_best / *_pb / *_n` keys only go
  up when merging a snapshot. Keys: `<w>_<mode>_m` (best distance), `<w>_any_m`, `<w>_race_t`
  (fastest finish, s), `<w>_daily_<YYYY-MM-DD>` (today's board), `<w>_cc`, `<w>_combo`, `<w>_wins`,
  `<w>_rev`, `<w>_runs`, `unlock_<w>_<trail|hat><k>`; added with the update: `<w>_dare_<YYYY-MM-DD>` (the
  day's dares, a bitmask, bits only added), `<w>_stamps_<ISOweek>_n` (one stamp per new dare), `<w>_note` (the
  love note for the partner, ≤ 60 chars, user content), `<w>_notes_n` (notes found, only up) and
  `team_best_m` (Together's best, only up). The core.js merge protects only the `_m|_best|_pb|_n` suffixes,
  so the dare bitmask is a read-modify-write.
- **Death card**: the finale is 1.7 s (`FINALE_MS`, was 2.3), then the engine's card with
  *Rematch* as the big button. Each device adds its own line to the sub ("You: 1,240 m · best
  1,980 m · Sydney's best 2,100 m", "New best" / "fastest 2 km yet"); a new best also pops "NEW
  BEST!" during the finale. The recorded result keeps the shared text.
- **Beat-their-best lines** (`world.setMarks`): in Race and Daily, a glowing stripe across the track
  with a printed banner at your partner's best distance ("SYDNEY'S BEST") and at yours ("YOUR
  BEST"), so every run has a line to cross.
- **Rivalry & moments** (`js/games/rush/rivalry.js`, from presence, nothing sent but `share`): every pop is a
  state machine that fires on a change, never per frame, and centre pops take turns (one at a time, at most
  3 waiting). In Race and Daily: a lead change (the other runner 4 m+ ahead for 0.6 s, no sooner than 3 s
  after the last pop) pops OVERTAKE! for the overtaker and "Sydney passed you" for the other; retaking it
  within 10 s is REVENGE! ("they took it back" on the other side); a crash or a spectating partner is never
  a pass; Brawl has none (side by side they'd mean nothing). Crossing the stripes: your own best pops
  NEW BEST! live, your partner's best pops "You beat Sydney's best", and the partner crossing yours pops
  "Sydney just beat your best · 1,980 m" on both phones (each phone computes its own two, from the bests
  snapshotted at the start), all with a sting. Closer than 5 m for 3 s (past 150 m, so not the start
  line) pulses the gap pill "Neck and neck · you +3 m" until they're 8 m apart. The host counts lead
  changes (`M.leadChanges`, run stats `leadChanges`, `crossed`) and writes "4 lead changes" into the shared
  result line, so both end cards read the same. A new district zone start pops its name as a small tag
  with a chime and moves the music's key (`audio.setDistrict`: Downtown 0, Harbour +2, Greenway +5, Old Town
  −2, Neon Market +3, Freight Yard −5 semitones, changed at bar lines, at most 3 a bar); `render()` calls
  `world.setDistrictAt(seed, z)` per view. Track v2 events: "COIN RUSH!" 2 s of running before
  `c.eventZ`, "GOLDEN HUNDRED · coins ×2" on entering its chunk; fool's-gold coins (`v ≥ 3`) have their
  own chime. The last heart (not Together): a pulsing ring round the hearts and a heartbeat under the
  music (twice a bar); 500 m on it pays "CLUTCH! +20 coins" once per heart lost (`stats.clutch`; Race gives
  a heart back at every 500 m, so there it can't happen, by design). Together: a magnet, sneakers or coin
  doubler picked up by one is sent as a reliable `share` event and runs on the partner for the same
  duration (less the message's age), "Sydney shared a MAGNET"; one device does the same through the local
  queue. Together's end card shares "New team best!" or "Team best 3,240 m" (key `team_best_m`, only goes
  up; the judge reads the old value once and puts the line in the result both phones show). The `share`
  message is `{ k }` (the pickup kind) on the same reliable channel as `atk` / `res` / `revive`, so it
  survives a re-mount. Unit test: `rivalUnit()` in `rush.test.js` (the logic with a fake clock), section
  `rival` (two phones, light and dark, plus one device; part three).
- **Ghost marker**: in live play the partner is a real runner on your track; when they're out of
  sight (≥ 120 m ahead, or behind the camera) the name tag becomes a chip in their lane: at the
  horizon with "Sydney ↑ 230 m", or down by your feet with "↓ 48 m" (gap quantized to 5 m, so the
  string only rebuilds on change).
- **Daily**: a fourth mode, one seed for both of you all day: `dailySeed() = hash('rush-daily',
  YYYY-MM-DD) + 1` (local calendar day; the host picks it and sends it in `start`, so the guest
  can't disagree). No weapons (boxes pay +5 coins), no rubber band. The run ends when both are out
  of hearts (or someone reaches `DAILY_CAP` = 5 km); furthest wins, a dead heat within a metre.
  Whoever is out first spectates the partner ("Out of hearts at 980 m · Sydney is still running
  1,240"). The lobby row shows today's board ("Today: Emerson 1,240 m · Sydney 980 m · Emerson
  leads") from the shared data.
- **Unlockable style** (settings → Trail / Hat; picked per device, worn by whoever has earned it
  (`resolveWear`, so in split screen each runner wears only their own unlocks), streamed to
  the partner as `tr` / `ht`): trails Sparkle (1 km in one run), Ink puffs (15 close calls in a
  run), Confetti (3 wins), Embers (an x8 "Wild" combo); hats Crown (beat your partner's best Daily),
  Halo (3 revives), Party cone (150 coins in a run). Trails are pooled particles behind the runner
  (`fx.trailFx`, on its own cadence); hats are one small mesh parented to the head bone (one draw
  call while worn). Unlocks are checked on the finale from the run's stats and announced
  ("UNLOCKED · Ink puffs trail") with a fanfare; locked chips show how to earn them.

### Daily twist, dares, love notes (js/games/rush/extras.js)

- **Twist of the day** (Daily only): `dailyMod(day) = hash('rush-daily-mod', day) % 7`; the host sends it in `start` (and
  `rejoin`) as `mod`, so the guest can't disagree. 0 plain, 1 **Mirror** (the canvas is flipped with CSS `scaleX(-1)` on
  `.rr-gl`, the HUD sits above it and is not; `onAction` swaps left / right, the sim is untouched; split screen renders
  view 0 into the right half so the flip puts it back on the left; name tags, the train "!" and the tutorial hand are
  mirrored in `game.js`), 2 **Fog** (`scene.fog` 40–110 m instead of 62–170), 3 **Night** (a light phone swaps to the dark
  palette through `world.setPalette`, restored in the lobby), 4 **Blind coins** (after `syncView` the coin instance count
  is cut at 28 m ahead; coins are sorted by z), 5 **Double ladder** (after each step the combo payout is paid again and the
  event's value doubled, so the ladder says `+20 coins`), 6 **Gold rush** (`createTrack(seed, v, { goldP: 0.7 })`, track v2;
  same chunks, a superset of the normal day's branches). Shown on the Daily tile ("Twist of the day: …") and the countdown.
  Test override: `__RUSH_DEBUG.mod`.
- **Dares**: `hash('rush-dare', day, k)` picks 3 of 12 goals (`DARES`), judged at the finale from the run's stats; the
  lobby lists them with a check per player. `<w>_dare_<day>` is a bitmask (read-modify-write, bits are only ever added;
  core.js protects only `_m|_best|_pb|_n` suffixes), `<w>_stamps_<ISOweek>_n` counts one stamp per new dare. Completions pop
  "DARE DONE" and add a "Dare done: …" line to the end card; misses say nothing. "Swap the lead twice" counts lead changes
  itself (4 m held 0.6 s).
- **Love notes**: the lobby's "Note for <partner>" chip opens a one-line input (60 chars, 16 px, `<w>_note` in the shared
  data). The envelope item (kind 6, track v2) pops the partner's note for 3 s (or a line from `NOTE_LINES`); the end card says
  "You found Sydney’s note". All note text is user content: `textContent` only.
- **Unlocks** (`STYLES` appended): trails Gold dust (3 gold branches in a run) and Love hearts (`<w>_notes_n` ≥ 5), both `fx.trailFx` kinds (5, 6), hats Lantern (reach the Neon Market) and Trophy (7 stamps in a week, or more
  stamps than your partner last week).

## Modes

- **Race** — first to 1,500 m (`RACE_LEN`, ~88 s) wins, or the last with hearts. Every 500 m
  milestone gives a lost heart back (cap 3; "+♥ heart back" with the heart pop). With 2 km and no
  regen, most Races ended on "ran out of hearts" at 200–600 m; in the early-acting human model
  (`sim/human2new.mjs`, 40 runs each) the finish rate is now 33/40 careful (react 250 ms, 3 %
  misses; was 19/40), 34/40 skilled, 31/40 at 6 % misses, while a clumsy late-reacting pair still
  gets a "ran out of hearts" decision (8/40 finish, p50 1,064 m). Daily keeps 3 hearts and no regen. Weapon boxes give one of:
  *ink bomb* (flies to the leader, splats their screen 2 s), *roadblock* (dropped into the trailer's
  lane — jump it or stumble), *lane zap* (forces a hop after a 0.35 s spark warning), *rocket*
  (+35 % speed, smash barriers), *shield*. Rubber-banding: the further behind you are, the better the
  box (ink/zap/rocket); the leader mostly gets roadblocks and shields. Slipstream: +5 % right behind.
- **Brawl** — side by side with strong elastic speed so you meet constantly. A shove has to be
  deliberate: a lane input toward the partner after 0.25 s side by side (|Δz| < 2 m, adjacent
  lanes), or a second swipe toward them within 250 ms. A plain dodge into their lane is just a dodge
  (it used to lunge and spam "Whiff!" / "DODGED!"). The victim sees "BRACE!" and has 300 ms from
  the lunge (`BRACE_MS`) to jump, roll (un-shovable) or step away; otherwise it shoves them a lane
  over and stumbles them, and into the wall or a train side it's a SLAM (−1 heart). A landed shove
  pays the shover +10 coins and a 1.2 s +12 % speed bump; 1.2 s cooldown.
  Last with hearts wins; at 3 km the one with more hearts (then distance) wins.
- **Daily** — see above: same seed all day, 3 hearts each, furthest wins.
- **Tandem** (co-op) — 4 shared hearts, a shared coin goal (100, 250, 450…, each +1 heart, max 5).
  A crash puts you *down*: your camera follows your partner, who gets a glowing revive heart 24–45 m
  ahead after 1 s and every 2 s after (`REVIVE_FIRST`, `REVIVE_EVERY`), a new one only once the last is
  behind you (a heart still ahead stays put: on a slow page the old schedule dropped a second heart on
  top of it), for 7 s (`REVIVE_WINDOW`; it
  was 10 s with a heart every 3 s, mostly dead time; 6 s cost more hearts than 7 because the third
  heart, spawned at +5 s, was still ahead when the window closed). Grab one and they're back beside you for
  free; miss and the team loses a heart. The countdown waits while the reviver is down, and gets
  back (up to `REVIVE_SLACK`, 1.5 s, inside the downed phone's 2.5 s fallback margin) any time the
  reviver's page drops from its simulation (frames over 250 ms on a starved phone). The reviver's
  prompt ("Grab the ♥ for Sydney · 5", pulsing red) takes the coin-goal pill under the bar, at
  the top of the screen; only the one who's down, who isn't steering, gets the big centred card
  ("You're down! … tap to cheer them on": in front of the reviver it covered the next 24–45 m of
  track, where the heart appears). Both down at
  once (nobody can revive) resolves at once: −1 team heart, and both get up side by side at the
  front after `CRASH_T` (1.6 s) with 2 s of invulnerability (each device respawns its own runner;
  the host counts the heart once and ignores the partner's late "down"). While you're down, any
  tap cheers your partner on (`cheer`: +4 % speed for 1 s, a heart puff over them, a clap; "Sydney
  is cheering!"), so the wait isn't a staring contest. Ends when hearts run out.
  Measured headless (`scratchpad/pro/rush/sim/tandem.mjs`: two human-model runners, 24 runs × 90 s
  per profile, the modes.js revive rules re-enacted): dead time per down 3.3 → 2.3 s (clumsy pair)
  and 3.8 → 2.5 s (careful; the floor is the 1.6 s crash), both runners down at once 16 % → 5 % and
  13 % → 3 % of the run, team distance in 90 s +12 %, hearts lost per minute 1.58 → 1.13 (careful)
  and 1.74 → 1.87 (clumsy: the shorter window revives a smaller share, 43 % vs 64 % of downs;
  the run still ends later in metres). Result `{ team: true, winner: null, score, text }` with
  `score = team metres + coins` (the engine records it as a team result with a best score).

## Netcode (js/games/rush/link.js over js/games/net.js)

- Clock: host time. net.js syncs with a ping every 2 s and keeps 10 samples, which under a busy
  main thread left a 100 ms+ error in the harness, so the wrapper adds a precision layer: the guest
  bursts pings (~8/s) until synced, through the countdown, pauses and resume countdowns, pings
  ~2.7/s in the lobby and ~1/s while running; keeps the 5 lowest-RTT of the last 60 samples, and
  both sides stamp their stream with that clock. The host answers at most ~11 pings/s (after a
  stall it would otherwise answer the whole backlog at once, over budget, with useless timings).
  Measured start skew in the harness: 8–12 ms at 80 ms latency on a heavily loaded machine.
- Message budget (~40/s per device, `h.warnings` in the harness): presence 20/s in a match and
  10/s in the lobby, plus the pings above and a few reliable events. The tests assert no warnings.
- Start: host sends `start {mode, seed, at: now+3500, len, cap, th, goal, goalIdx, day, v, ep, mod}`: `v` the
  track version (absent = 1), `day` the Daily's local date key (so a match started before midnight keeps its
  day), `ep` an epoch that tells two matches on the same seed apart (a Daily rematch used to reuse the
  last one's `seed % 100000`), `mod` the Daily's twist of the day. `rejoin` carries the same fields. Both count down to `at` and accumulate
  *run time* only while running; the sim steps to `floor(runTime / dt)`. The effective start is `at`
  on both (skew = clock error).
- Each device publishes its runner at 20/s: `z x y lane speed pose flags hearts coins runTime fin`
  plus lobby/pause fields and the worn style (`tr`, `ht`). The partner is drawn from an allocation-free interpolation buffer fed by
  `net.onRemote` (same algorithm as `net.remote`, `delay = 100 ms`), with `z` dead-reckoned to *now*
  (forward motion is very predictable) and `x/y/pose` interpolated, pose weights eased (no pops).
- Reliable events (`atk res shove fin out down revive missed cheer share`): own small channel (same retry/ack/in-order scheme as `net.send`) that also
  **re-addresses per partner instance**, so a partner who re-mounts mid-match isn't stuck behind
  sequence numbers its new instance never saw. Budget: 20 presence/s + a few events/s + pings.
- Partner instances: every stream carries the sender's instance id. When it changes (a reload, or
  the re-mount on a rematch, which also restarts the host clock) the interpolation buffer is
  dropped — otherwise the previous instance's last presence, stamped on the old timeline, would
  make every new sample look late and freeze the partner. A clock jump back of more than 1 s also
  restarts the buffer, and lag-compensation lookups ignore `net.remote()` states from an old instance.

| Decision | Authority | How |
|---|---|---|
| My runner (position, crashes, coins, pickups, hearts) | its own device | fixed-step sim, published |
| Mode, seed, start time | host | `start` |
| Ink / zap hit, roadblock placement and hit | victim | `atk` → victim checks shield/state → `res` |
| Brawl shove | victim (lag-compensated) | attacker sends `shove {at, z, from, to}` when its view says side by side (deliberate: 0.25 s adjacent or a double swipe); victim rewinds its own history to `at`, cross-checks the attacker with `net.remote(at)`, then gives itself until `at + 300 ms` to brace (jump / roll / step away) → hit / dodged / slam → `res` |
| Revive | reviver | grabs a token → `revive`, or expiry → `missed`; both down → each side respawns itself, host counts one heart; `cheer` (downed → partner, rate-limited 1 per 280 ms) |
| Team hearts, coin goal (Tandem) | host | published; decrements once per down id |
| Race winner | host | compares run times at the finish (`fin`), using the partner's published run time as proof they hadn't finished yet; pause-proof |
| End | host | `end {result, at}`; both play the finale, then `api.finish` (guest too, as a backup for a dropped `__finish`) |

- **Pauses**: a device pauses for its own reasons (partner gone via `onPartnerHere(false)`, partner
  silent > 1.5 s, page hidden, GL context lost, pause menu) and publishes `pz`; the other pauses on
  seeing it. When reasons clear, a device joins the partner's already-published resume moment if
  there is one (≥ 1.2 s away), else proposes `ceil((now + 3000) / 400) × 400` on the shared clock,
  publishes and sends it; both keep the later. Snapping to a 400 ms grid means two phones that
  unpause a moment apart pick the same instant without waiting for messages (test: Δ 0 ms).
  Run time excludes pauses, so pauses can't change a result. The engine's "stepped away" card is
  off (`ownsPauseUI`); Rush's own card offers "Invite them back" when the partner left the game, and
  after the partner has been gone 20 s mid-match (`AWAY_MS`; `__RUSH_DEBUG.awayMs` in tests) an "End
  match" button that forfeits: Race / Brawl / Daily go to the one still here ("Emerson wins · Sydney left
  the game", not counted towards unlocks), Together keeps its team score.
- **Partner re-mount mid-match** (they left and came back, reloaded, or the app restarted): each
  device keeps a snapshot of the partner's last *in-match* state (by the time a new instance is
  noticed, the latest presence is already its lobby state). If the *guest* re-mounts, the host
  sends `rejoin` with the match and that snapshot; the guest restores its runner (and its render
  anchor) and both resume with a 3-2-1. If the *host* re-mounts, its clock starts over: the guest
  keeps its run, re-syncs to the new host clock (run time is accumulated, so only the start /
  resume anchors are re-based), and once the new host is in its lobby and synced sends it
  `rejoin {fromGuest}` with the host's own last state; the host restores, and both count down
  to the same moment. Tested: guest leave → back, host leave → back, 30 s in the background, and
  a partner phone 4× slower (no pause flapping, same result on both).

## HUD

Immersive: the engine shows two 44 px stickers (back, menu) in the top corners; the HUD keeps clear
of them (the pause button sits at `var(--gm-corner-safe)`, which includes the notch / Dynamic
Island inset). Top row: hearts, distance, the partner chip; under the hearts, one fixed-height row of coins
and power-up rings (so nothing jumps when a power-up starts) that spans the full width, so five team
hearts plus a magnet, sneakers and doubler ring at 390 px never push the distance under the menu
sticker (`.rr-left` is `display: contents` in a two-row grid; below 370 px `rr-narrow` shrinks the
numbers, below 340 px `rr-tiny` shrinks them again: checked at 390 / 360 / 320); under the menu sticker:
my pause button (pauses both phones in live play). Race: a bar with both runners and the finish, plus a gap pill ("Sydney +23 m", "Sydney level with you",
"Neck and neck · you +3 m"; Brawl adds the partner's hearts, "Sydney ♥♥♡ · side by side!"; Together the
coin goal, "63 / 100 coins together", which turns into the red revive prompt "Grab the ♥ for Sydney · 5"
for the reviver).
Pops ("Close call!", "MAGNET") sit between the HUD and the horizon, never on the vanishing point
where obstacles appear, and at least 16 px under the race bar and the gap / coin-goal pill where
those reach the middle of the view (a "−1 team heart" landed on "2 / 100 coins together"); the
oncoming-train and rolling-barrel "!" (over the lane it comes down) sits above the far track, under the pops. Both are placed by measuring once
after a resize or the bar / pill showing or hiding (on the next pop or warning), never per frame.
A race whose two finish times read the same to the second shows "Photo finish! 0.4 km in 0:27 · Sydney 0.3 s behind" instead of
two identical times. Landscape phones put the
race bar between the corner columns and the gap pill in the top row, so the HUD ends ~25 % down.
All setters diff against their last value and never force a reflow (animations restart by
alternating two identical keyframe names instead of reading `offsetWidth`).
Brawl: the partner's hearts in the pill. Together: team hearts, team coins and the coin goal.
Bottom-right: the weapon slot (Race). Buttons scheme: ROLL / JUMP in the bottom corners.
Live: a name tag over the partner (positioned after the frame renders, so it never trails the
camera); when they run level with you but outside the narrow portrait view, it pins to that screen
edge and points at them.

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

Sky and city (all from the theme inks):
- **Sky dome**: two inks printed as a halftone gradient (dots grow from the horizon up; the sky
  fragment shader is one `fract` + `dot` + `step`). Day: paper to a blue tint, a yellow sun with an
  ink rim and halo, misregistered Riso clouds (white over an offset pink copy). Night: a violet
  halftone, a moon with craters, stars, lit windows in the skyline.
- **Colour script**: the sky's two inks (and the fog, which always matches the horizon) warm with
  the fastest viewer's speed (a rocket pushes it further): blue → yellow/pink by day, blue → pink
  neon by night. Uniforms only, quantized, no recompiles.
- **Districts** (js/games/rush/bio.js, track.js `DISTRICTS` / `districtOf`): chunks 0-2 are Downtown, then zones of 4 chunks
  (400 m) walk a seeded cycle (step 1 or 5 mod 6, so never the same district twice running) through Harbour (quay and water,
  sheds, stacked containers, a quay crane about every 300 m, boats, a cargo ship), Greenway (lawns, box-trunk trees with octahedron /
  low-sphere / cone crowns, hedges, cottages), Old Town (narrow gabled houses, chimneys, bunting across the street), Neon Market
  (stalls with striped canopies, blade signs, glowing lantern strings) and Freight Yard (silos, banded chimney stack, pipe rack,
  rusty containers, a gantry crane over the track). The district is a pure function of `(seed, chunk)` from its own hash (never the
  chunk's `r()` stream, not in `chunkSig` / `trackHash`), so both phones see the same one; `c.bio`, `c.bioNext`, `c.zi`,
  `c.zoneStart` are set last in `genChunk`. `createWorld` builds one palette per district from the theme palette (mixes of the
  tokens, so light and dark both follow), tints the deck / bed / parapet / awnings beside the track only, and the first chunk of a
  zone carries a gate arch over the track with the name in baked pixel letters (on the tunnel's entry lintel when the zone starts
  in a tunnel): no extra draw call. `world.setDistrictAt(seed, z)` (per view, before rendering it) blends the sky tint, the fog and
  the far street layer (the harbour's water) over the 100 m around a zone boundary: uniforms and one tiny colour buffer, quantized
  to 1/32, no recompiles. Lit windows beside the track are warm white (`P.warm`), never the coin yellow. Chunk buffers peak
  at ~13.7k vertices (Downtown 11.7k), district chunks cost +0..+1.5k triangles over Downtown on identical content.
- **Skyline**: two rings of flat silhouettes (setback towers with antennas, spires, domed halls,
  water towers, one needle tower), the far ring paler. Tunnel portals are concrete with a hazard band.
- **Trains with faces**: windscreen "eyes" with glints and a destination board. Parked trains doze
  (half lids); the oncoming train glares (ink brows, red board, lit headlights), so the one that
  can hurt you reads instantly. Roof units on every car.
- **Track**: sleepers, rails, gantries, and signal masts every 50 m with one lamp lit.
- **Halftone dissolves**: the partner dissolves through a 4 px halftone screen when they run
  between your camera and you (`RR_FADE`, runners' program only), and barriers you've passed do
  the same as they swing past the camera (`RR_NEAR`, barrier program only), so neither fills a
  third of a phone screen. The `discard` lives in those small programs only; the world shader
  keeps early depth rejection.
- **Overlay** (fx.js `createOverlay`): manga speed lines as ~30 thin tapered triangles radiating
  from the vanishing point, plus a corner-only vignette: two draw calls in clip space, no
  full-screen layer (the old DOM speed-line layer was 160 % × 160 % of the screen, ~7.6 Mpx at 3×).
  With `prefers-reduced-motion` there are no speed lines and camera shake is quartered.

## Performance

- Draw calls: each 100 m chunk is ONE merged mesh (track, scenery, parked trains, outlines)
  in pooled preallocated buffers; coins/pickups/barriers/roadblocks/particles/shadows are
  `InstancedMesh`; runners are skinned (1 call each); sky dome 1; overlay 2. Measured on a phone
  view: 14–23 calls in a busy race (test budget ≤ 30), 33–42k triangles (test budget ≤ 60k; was
  45–58k: coins are 12-sided now, 156 triangles each, drawn to 132 m where fog takes them anyway;
  runners 4.5k each with 8-segment capsules). Chunk buffers hold ≤ 18k vertices (peak ~10.3k).
- The phone budget (30 calls / 60k triangles) is per frame on a phone, where there is only ever one
  view (two-phone live: 18–20 calls / 43–47k). **Split screen is laptop-only** (one keyboard, two
  views of the same frame, each its own camera, so each view draws its own chunks, sky and
  overlay: 38–40 calls / 88–91k triangles at 1280×800, i.e. each view stays inside the phone
  budget). Its budget is the **laptop split budget, ≤ 50 calls / 120k triangles per frame**
  (asserted in the `split` test section). Halving the far distance per view would bring it near
  the phone numbers, but at the cost of pop-in on the screen size that shows it most, for a GPU
  that doesn't need it.
- Far layers (street, skyline, sky dome) draw after the near world (`renderOrder`), so early depth
  testing skips every pixel a building or train already covers.
- `antialias:false`, `alpha:false`, `stencil:false`, `powerPreference:'high-performance'`.
  Dynamic resolution: pixel ratio `min(dpr,2) × scale`, scale starts at 0.85, steps down by
  0.08 (0.15 when far off) every 250 ms while the frame-time EWMA is over 18.4 ms, and steps up by
  0.05 only after 4 s under 15.4 ms plus a cool-down; range 0.55–1.
- Shaders: one toon program family (MeshBasicMaterial + hook; per-vertex 3-band light), the
  shadow-band halftone is one `fract` + one `dot` per shaded fragment. Every variant (world,
  instanced, instanced+colour, barriers, skinned+fade, shield bubble, sky, overlay, shadows,
  banners) is compiled *and drawn once* behind the loading screen (10 programs); the test asserts
  the count is unchanged after ink, zap, roadblock, rocket, shield and a crash.
- Allocation discipline: the per-frame path creates no objects, arrays, strings or closures.
  Beyond that, for V8 (Android, laptops; JSC on iPhones NaN-boxes and never allocates for these):
  doubles written every frame live in object fields or typed arrays, never in closure `let`s (V8
  boxes each such store); hot calls take their doubles through scratch `Float64Array`s
  (`writeM`, `setBone`) instead of arguments; runner bones and the far layers are posed by writing
  `matrix.elements` directly (no Euler/Quaternion setter chains); the overlay uses an integer
  xorshift instead of `Math.random`. Fully optimized, the JS side of a frame (sim, logic, two
  runners, particles, world sync, rig, HUD, overlay) costs ~0.1–0.5 ms for both runners, and the
  per-function micro test shows ~0.3 B/call. The test asserts < 2 KB/frame (what's left is V8
  boxing at call boundaries, tier-dependent) and < 1.5 MB retained heap growth over 30 s.
- Shader warm-up with `renderer.compile` + one draw behind the loading screen. Fog (62–170 m)
  hides chunk pop-in (chunks are built 175 m ahead) while obstacles stay crisp ~2.5 s ahead at top
  speed. The chunk cache trims chunks behind both runners every ~1.5 s.
- Music never catches up after a stall: if the scheduler finds itself behind (pause, background,
  slow frame) it resyncs to now instead of firing overdue notes; it skips note creation entirely
  while muted / music off, sets the bus gain once per target change, and ducks under a pause card.
- `webglcontextlost` → pause + "Tap to resume"; `webglcontextrestored` → three re-uploads from the
  retained buffers. Hidden page → pause sim, render and audio; back → 3-2-1.
- `destroy()` cancels rAF, timers and listeners, disposes every geometry/material/texture and
  forces context loss.
