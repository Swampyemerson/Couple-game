# Rail Rush: all-games update report (unit: rush)

Branch `claude/upd-rush`, from `claude/relaxed-dijkstra-2cy8al` (6e9fee4). The only files touched are under
`js/games/rush.js` and `js/games/rush/**`, plus `tools/test/games/rush.test.js`, `docs/games/rush.md` and this report.
No shared files were edited (`core.js`, `net.js`, `games.css`, `app.js`, the harness, `README.md`, `docs/GAMES.md`).

How the work was run:
- **Survey:** three parallel Sonnet surveys at high effort:
  - a play-through on an iPhone profile with real touches, both players, every mode, light and dark;
  - a sim, track and netcode code audit with repro scripts;
  - a render, HUD and performance audit with measured budgets.
- **Content check:** one Fable pass over the summaries, which produced a ranked content shortlist.
- **Spec:** an Opus spec covering must-haves (every verified bug), then content, then polish, each with acceptance checks.
- **Build:** six Sonnet builders with file ownership (bug fixes; districts; track v2 content; rolling barrels; rivalry and
  moments; Daily twist, dares and notes), then two Sonnet fixers.
- **Verify:** an independent Sonnet verifier re-played every mode on both phones, one-device and two-device, light and
  dark, portrait and landscape. A Sonnet fixer fixed what it found.

## What's new

### Districts: the track finally goes somewhere
Six districts in 400 m zones: Downtown, Harbour, Greenway, Old Town, Neon Market and Freight Yard.
- **Layout:** the first 300 m are always Downtown, then a non-repeating cycle that is seeded per track, so both phones
  and the whole Daily see the same districts.
- **Look:** each district has its own scenery generator (container stacks and quay cranes; trees, hedges and cottages;
  gabled houses and bunting; market stalls and glowing lanterns; silos, chimneys and gantries) and its own tints.
- **Sky and fog:** each district has its own sky and fog tint, blended at the boundary.
- **Gate:** an arch over the track carries the district's name in printed pixel letters.
- **Entering a district:** a small name pop and a chime, and the music shifts key at the bar line.
- **Cost:** the scenery is cosmetic only, from its own hash, and baked into the existing merged chunk mesh, so it adds
  0 draw calls and no new shader programs.
- **Dark mode:** lit windows near the track are now warm white, so yellow is reserved for coins and hazards.

### Track v2: new things on the track
New content is versioned. The host sends `v: 2` in `start`; when `v` is absent the track is v1. Track v1 is
byte-identical to before (pinned hashes in the test), so older builds and saved matches regenerate the same track.
Track v2 is now pinned too: future content needs a v3. Every addition comes from its own hash stream, so the safe path
and the perfect bot are untouched. The bot runs 500 chunks × 5 seeds with 0 crashes on v1 and on v2.
- **Rolling barrels (new obstacle):** 0.9 m drums that roll toward you at 0.35× your speed in runner space, so they are
  deterministic on both phones, like oncoming trains. Jump or swerve. Pairs force a jump or the third lane.
  - Placement: from ~500 m, in ~21 % of chunks.
  - Feedback: a lane "!" warning and a rumble.
  - Brawl: shoving someone into a barrel is a slam.
  - Cost: one instanced draw call on the existing barrier program.
- **Fool's gold branches:** 5 big orange coins worth 3 each, in a lane off the safe path. They break the "just follow
  the coins" habit with a risk-for-reward swerve. Found in ~25 % of chunks.
- **Surprise events,** at least 6 chunks apart and never in a tunnel, the same metre on both phones:
  - *Coin Rush:* a coin carpet, announced "COIN RUSH!" 2 s ahead.
  - *Golden Hundred:* every coin in the chunk pays 2×.
- **Coin doubler (new power-up):** ×2 coins for 8 s, with its own ring in the HUD. It replaces 30 % of magnets.
- **Love-note envelope:** one per run, in chunks 4–8, on the safe path (see below).
- **Coin LOD:** coins beyond 36 m use a 48-triangle prism instead of 156 triangles. That saves ~6k triangles in the
  worst frame and pays for everything above.

### Rivalry and moments
- **Race and Daily rivalry pops:**
  - OVERTAKE! / "Sydney passed you", with hysteresis: a 4 m lead held 0.6 s, at most one every 3 s.
  - REVENGE! for a retake within 10 s.
  - "Sydney just beat your best · 1,980 m" on both phones, with a sting, when the partner crosses your best stripe.
  - "You beat Sydney's best", and a live NEW BEST!.
  - The gap pill pulses "Neck and neck" when you're within 5 m for 3 s.
  - The shared end-card line counts the lead changes ("4 lead changes").
- **Last-heart clutch** (not Together): at one heart the hearts get a pulsing ring and a heartbeat plays under the
  music. 500 m on the last heart pays "CLUTCH! +20 coins".
- **Together:**
  - A magnet, sneakers or doubler one of you grabs is shared with the other ("Sydney shared a MAGNET", over a new
    reliable `share` event).
  - The end card shows the team best ("New team best!", `team_best_m`).

### Daily twist, three dares a day, love notes
- **Twist of the day:** `hash('rush-daily-mod', day) % 7`, sent in `start`. Plain, Mirror (picture and left/right
  input flipped, sim untouched, HUD not mirrored), Fog, Night, Blind coins (coins hidden beyond 28 m), Double ladder
  (combo payouts ×2), Gold rush (twice the fool's gold). The Daily is no longer pure memorisation, and the lobby tile
  and countdown say what today's is.
- **Three dares a day:** seeded per day, drawn from 12 goals (x5 combo, 10 close calls, 2 lead changes, a gold branch,
  …).
  - The lobby shows each player's ticks.
  - A completion pops "DARE DONE" and gets an end-card line; a miss never says anything.
  - Each dare earns a weekly stamp (`<w>_dare_<day>` bitmask, `<w>_stamps_<ISOweek>_n`), and stamps earn the Trophy
    hat.
- **Love notes:** a "Note for Sydney" chip in the lobby (≤ 60 characters, `<w>_note` in the shared data).
  - When your partner grabs the envelope on the track, your note pops on their screen.
  - With no note written, a line from a playful library shows instead.
  - The end card says "You found Emerson's note".
  - Notes are rendered as plain text only.
- **New unlocks:**
  - Gold dust trail: 3 gold branches in a run.
  - Love hearts trail: 5 notes found.
  - Lantern hat: reach the Neon Market.
  - Trophy hat: 7 stamps in a week, or the most stamps last week.

## Fixed (each one reproduced first, then covered by a test)
1. **A pause burned Together revive windows and team hearts,** and Brawl brace windows: a 9 s pause cost a heart.
   Rules no longer tick while paused; `rules.hold(ms)` shifts their timers.
2. **A full-width broken-bridge gap did nothing if you didn't jump:** you fell 0.9 m and popped back up. Running in now
   falls (`inPit`); a jump clears it. The bot is still clean.
3. **The `E_PICK` encoding overflowed past chunk 100** (10 km in Together): magnets popped as sneakers and boxes as
   shields. It is now `k*1e6 + key`.
4. **The end card's personal line was broadcast:** Sydney's phone showed "You: best 900 m" from Emerson's phone. The
   shared result is now neutral, and each phone adds its own "You:" line locally.
5. **Daily day key:** the board used each phone's own date (time zones and midnight). The host's day now rides in
   `start`, together with `v` and a per-match epoch, so Daily rematches no longer share the stale-presence epoch.
6. **Rejoin:** an "out" Daily runner came back alive, and a Race reconnect after 500 m got a free heart. Both fixed.
7. **Reliable link:** a late ack from an old partner instance could delete a new message. Acks are now checked against
   the partner instance.
8. **Down and revive ids could collide between the two phones.** Ids now use role parity.
9. **Audio leak:** every mount left a looping wind source and the magnet oscillator running on the shared context.
10. **Enter and Space couldn't press a focused button,** because the game ate the key.
11. **iPhone layout:**
    - The settings sheet couldn't be reached or dismissed in landscape; it now scrolls, with Done always on screen.
    - The landscape lobby was clipped at 667×375, 568×320 and 844×390.
    - Overlays ignored the notch insets.
    - The landscape gap pill overlapped the menu sticker.
    - The pause button and settings segments were 40 px; they are now ≥ 44 px.
    - The dark revive prompt had 2.75:1 contrast; it is now ≥ 4.5:1.
    - The ghost chip sat on the runner in landscape.
    - The tutorial caption covered the runner's legs.
    - The down and spectate cards covered the runner you were watching.
    - Pops were unreadable in tunnels and dark mode.
    - With 5 team hearts the Together distance sat under the pause sticker.
12. **The gap pill now says who leads** ("Sydney leads by 23 m" / "You lead by 23 m"), and the shared Race line uses
    thousands separators.
13. **Split-screen style picker:** it only offered runner A's unlocks.
14. **Quitting mid-run left the partner stranded.** After 20 s away, the waiting card offers "End match · you win"
    (two taps). Together ends with the team score so far. A forfeit win doesn't count toward unlocks.
15. **Together on a slow phone:** each revive heart was replaced every 2 s of clock time before a page running at half
    speed could reach it, so 0 revives. A heart still ahead now stays put. In a headless model at 0.5× sim speed,
    revives went from 0/144 to 144/144.
16. **Verify round:**
    - The Blind coins twist only hid the near coin mesh.
    - The note card covered the horizon.
    - The end card credited the partner for a library note.
    - Note editor confirmation, emoji length and the keyboard-up layout.

## Tests
`tools/test/games/rush.test.js`, now in three parts (ports via `RUSH_PORT`):
- `ONLY=gen,split,leak,drop,dark`
- `ONLY=race,brawl,tandem,pause,daily`
- `ONLY=rival,loop,rejoin`

New assertions:
- Track v1 and v2 hashes are frozen, and v2 is identical on both phones.
- The perfect bot is clean on v2 (500 chunks × 5 seeds).
- The barrel warning and rumble.
- The match runs track v2.
- Every bug above.
- Rivalry hysteresis, pops on the right phone, clutch, `share`, team best.
- Twists, dares, notes, unlocks and landscape lobby fit.

RESULTS_PLACEHOLDER

Budgets, measured on the phone view: max 21 draw calls (limit 30), worst frame ~46k triangles (limit 60k), 10 shader
programs (unchanged), chunk vertex peak 13.7k of the 18k buffer. Allocation and heap tests pass.

## Known issues
- **Love hearts trail:** it reads as a small cluster of pink gems rather than an unmistakable heart, because the
  octahedron is the only particle shape available without another draw call.
- **Skyline:** it is the same city silhouette in every district (only its tint changes). A per-district skyline would
  cost one more draw call.
- **Load-sensitive timings:** on this 4-core machine under load, the `rival` lead-settle wait and two older timings
  ("dark end", "respawn with invulnerability") occasionally time out. Each passed when rerun alone. The tandem revive
  failure we first took for load turned out to be the real bug in item 15.
- **Trophy hat:** once earned it is a permanent unlock, not worn only for the week.
- **Note editor:** the iOS keyboard was checked with a simulated short viewport, not on a real device.

## README games-table line
`| **Rail Rush**: 3D runner through six districts on the same track; Race, Brawl, Together or the Daily with a twist, dares and love notes | Live, versus/co-op | Phone |`
