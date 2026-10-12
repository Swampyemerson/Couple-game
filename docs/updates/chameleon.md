# Chameleon unit report: Blend & Seek (12 Oct 2026)

Branch `claude/upd-chameleon`, started from `claude/relaxed-dijkstra-2cy8al`. All files edited are inside the unit:
`js/games/chameleon.js`, `js/games/chameleon/**`, `tools/test/games/chameleon*.test.js`, `docs/games/chameleon.md` and
this report. Full details (rules, numbers, data keys, net messages, tests) are in the new
**v4** section of `docs/games/chameleon.md`.

## How the work ran

- **Survey:** three Sonnet agents (gameplay and rules; maps, world and camera; UX, records and paint) played the game
  through the harness on an iPhone profile with real taps and read the code.
- **Content check:** one Fable agent proposed more content from their summaries.
- **Spec:** I (Opus) wrote the spec with five file-disjoint build areas.
- **Build:** five Sonnet builders, one per area: rounds and twists, hunt moments, records and rivalry, paint, maps.
- **Verify and fix:** two independent Sonnet verifiers re-played everything (both players, hotseat and two phones,
  light and dark, portrait and landscape). Two Sonnet fixers then fixed what they found.

Blend & Seek had just had v3 and a deep polish pass, so this is content plus bug fixes, not a rewrite. The camera
solver, the budgets and saved data are unchanged in meaning.

## What's new

### Rounds: twists and comebacks

- **Twist deck.** New rule `twists`: Off, Some or Every; Some is the default in every preset. Some puts a twist on
  about half the rounds, never round 1. Twists are seeded from the match, so both phones agree, and they come back
  after a reload. Each twist is announced on the title card, the seeker's blind card, the hotseat curtain, the role
  pill and the recap's "Next:" line. There are four:
  - **Fog rolls in** (big maps): the fog closes in steps over the last third of the hunt, and pellet range follows it.
    This gives the hider a comeback window.
  - **Dusk:** the lights dim over the hunt and scan glints get brighter. Bodies share the lights, so the camo score
    stays fair.
  - **Three colours:** the hider can only paint with three swatches taken from the room. Pick and Stamp are off.
  - **Bounty spot:** a marked spot on the floor. Surviving within 3 m pays the hider ×1.5. Tagging there pays the
    seeker +15.
- **Underdog** (rule, on by default): from round 3, a player trailing by 40 or more points (60 on the big maps) gets
  +1 pellet when seeking or +1 escape when hiding. On one phone the hider gets +10 s to hide instead. Both players see
  the sticker.
- **Sudden death** (rule, on by default). Hide & Seek: a level score after the last round adds a quick pair, a 20 s
  hide and a 30 s hunt each way, and the points decide. Double Blind: 1–1 after three rounds adds one deciding round.
- **Called-it streak:** consecutive correct wager calls on a find pay 5 / 10 / 15. A broken run shows "STREAK
  BROKEN" to the hider.

### Hunt moments, for the two of them

- **Whisker shots:** a pellet that just misses (within 0.35 m × body size) splashes the hider's skin in the seeker's
  ink, through the normal paint sync. It plays a whoosh and shows "Missed by a whisker!" on both phones, and it is
  counted.
- **Mercy chirp** (two phones): once per hunt, the hider can gift the seeker a hot / warm / cold ping for 10 points.
  The recap says "Sydney took pity".
- **Note on the skin:** the hider can leave a 40-character note. It travels with the paint lock and is shown only at
  the reveal: over the body in the recap, and on the final card. The seeker's screen never contains it before then
  (tested).
- **Last-second drama:**
  - "AT THE BUZZER", with a longer hit-stop, for a tag in the last 2 s.
  - "SO CLOSE" when the hider survives with the seeker within 1.5 m.
  - New synth chords for the buzzer, a quick find, a close call, a Ghost-grade survival, a whisker and mercy.

### Rivalry and records (in the shared `api.data()`, new keys only)

- **The Cup:** a trophy that travels between them. The match winner takes it or defends it. The lobby shows who holds
  it and how many times it has been defended, and the final card says "TAKES THE CUP" or "DEFENDS THE CUP (N)".
- **Head-to-head** lines in the lobby and the recap, e.g. "Emerson has found Sydney 7 times".
- **Tendencies:** after 5 or more samples, the hider's title card reads your partner's habits ("Emerson checks walls
  first (6 of 9)"). It never says anything about the current round.
- **Portrait gallery:** your best surviving paint job is saved and shown as a flat 2D chameleon in the lobby and the
  wardrobe.
- **New looks:** a fifth wardrobe slot, trim, with four looks: Gold crest (take the Cup), Tail stripe (survive 3
  whiskers), Rosy cheeks (a 3-call streak), Neck ribbon (leave a note). The looks are never drawn on a hiding hider.
  Locked tiles now show the look in colour with a lock badge and progress ("2 / 3").
- **First records celebrated:** FIRST FIND, FIRST SURVIVAL, FIRST BLEND.

### Paint

- **Recent colours:** the last 5 colours as 44 px chips.
- **Pattern fill:** Solid, Stripes, Dots or Checker, through the same codec, sync and undo.
- **Palette lock:** used by Three colours.
- **Meter:** dims while a new score is being computed. It used to show the stale "22 %" for about 1 s after a stamp.

### Maps

- **Spin Cycle Launderette** (new, 18 × 12 m, size M, hunt clock ×1.1):
  - Calm areas: aqua and white checker floor, subway tiles, and 54 identical washers and dryers, so stamps line up.
  - Busy areas: the lost-sock wall, a back room of boxes, and a shirt rail to squeeze between.
  - Worst view: 42 draw calls, 26k triangles.
- **Candy Works** (new small diorama, 10 × 8 m): candy-stripe, gingham and sprinkle surfaces with no calm walls.
  Worst view: 32 draw calls, 23k triangles.
- Living Room, Garden and Studio now have 3 hider and 3 seeker spawns each, so openings vary.

## Bugs fixed (all reproduced first)

| | Bug | Fix |
|---|---|---|
| A | Hotseat: a tag in the last 380 ms of the hunt was thrown away and the round read SURVIVED (and counted as a survival) | Hotseat calls time at the buzzer, like two phones |
| B | A seeker running out of pellets counted as a "survived hunt" in records and unlocks, so a partner could farm Emerald, Galaxy, Gold and best hide | A dry-out keeps its points but is no survival |
| C | Hotseat offered rules that do nothing (escapes, hunt paint, heartbeat, sights, head start), including in Today's hide | `rulesFor(rules, local)` turns them off. The settings sheet greys them out ("Two phones only"). Today's hide on one phone swaps to a playable twist |
| D | Double Blind final card called being found "Best hide" | Its own story: rounds won, fastest tag |
| E | Final and hub cards said "<points winner> blends best", contradicting "Best blend: <other>" | "Sydney wins 111–59". Best blend is its own line |
| F | "Best hide" meant different things on the final card and in the lobby | Survived hides only, everywhere, plus a separate "Longest hide" line |
| G | Lobby bests left dangling "·" at line wraps | CSS gaps |
| H | Landscape recap covered the whole screen and clipped the tally. The portrait role pill sat on the body | Landscape side panel with the orbit framed on the free side. The pill is hidden under cards |
| I | Landscape pose labels touched their tile edges | Tiles fit their labels |
| J | Emotes were colour emoji | Riso SVG stickers with the same ids, so the two phones still interoperate |
| K | Settings steppers were 42 px | 44 × 44, and so are the size segments and sliders |
| L | Living Room seeker spawned on the toy chest (a 0.55 m drop every hunt). A Garden spawn sat on a flower bed | Spawns moved. A new static test places every spawn of every map at every size |
| M | Tests: the map-load budget timed a cache hit; a House build budget flake; `paintpro` wall-clock maxima; match-section recap races | Cold-load timing, a CPU-time minimum of 3, average-based bounds, robust Next |
| – | "Wide eyed" unlock unreachable with sights off | Stares counted whatever the rule |
| – | Host reload mid-round stretched the phase clock by 15–19 s, and the seeker couldn't fire meanwhile (pre-existing) | See "Fixes after verification" |

## Fixes after verification

Two independent verifiers re-played the build: both players, one phone and two phones, light and dark, portrait and
landscape, with real taps and reloads mid-round. They found no console errors and no desync between the phones; twist,
scores, round count, bounty and palette agreed everywhere, including after reloads. Two fixers then fixed what they
found:

- **Host reload stretched the clock (pre-existing bug).**
  - The shared clock restarts when the host reloads. The guest then reported an inflated time left, which the host
    adopted: 21 s left in a hide became 36 s, and 26 s left in a hunt became 45 s. The seeker couldn't fire for the
    extra seconds.
  - The guest now detects the clock jump and shifts its stored times, and freezes its clock while the host is away.
    Measured after the fix: 21.5 s → 18.2 s and 26.7 s → 22.3 s, and the seeker can still fire.
  - A reloaded seeker also keeps their wager call.
- **Three colours** takes its swatches from the room's actual surfaces, so the Launderette gets its aqua and the Living
  Room its sage. Before, most maps fell back to generic red and blue.
- **Layout fixes:**
  - At 320 px, every paint control is clear of the camo meter.
  - Recap and final reactions are never under the pinned button.
  - Stickers stack in one lane without overlapping each other.
  - In portrait, the note is a line inside the recap card.
  - Round announcements never cover "I'm hidden".
  - Landscape hand-over curtains keep their button on screen, and stickers are hidden under a curtain.
- **Rule tuning:**
  - Underdog: from round 3, at a 40-point gap (60 on big maps). At 25 points it fired almost every round.
  - Called-it multiplier: applies to finds only.
  - Bounty marker: bolder (a beacon pole), with a bigger seeded spot pool so small maps vary.
  - Today's hide on one phone: no longer always Floor only.
- **Other:**
  - A corrupt saved portrait shows nothing instead of a black tile.
  - The Love emote has a label.
  - Test bounds no longer trip on a loaded machine. Wall-clock maxima became averages with a loose maximum, and the
    clocks behind races were lengthened.

## Tests

Final regression, run one file or section at a time on the final tree (shared box, load average 10–35).

| Suite | Result |
|---|---|
| `chameleon-paint2.test.js` (new, paint) | ALL GOOD, 166 ok |
| `chameleon-rivalry.test.js` (new, records, the Cup, looks, cards) | ALL GOOD, 118 ok |
| `chameleon-hunt.test.js` (new, whisker, mercy, note, drama) | ALL GOOD, 117 ok. The `note` section timed out once under load while a fixer was editing, then passed on rerun |
| `chameleon-twists.test.js` (new, twists, underdog, sudden death, streak, bug A, hotseat rules) | TWISTS_RESULT |
| `chameleon-maps.test.js ONLY=spawns,launderette,static,slices` | ALL GOOD, 248 ok |
| `chameleon-cu.test.js ONLY=static,load` | ALL GOOD, 35 ok |
| `chameleon.test.js`: `paintpro`, `paintjuice`, `netpolish`, `variety`, `maps` (all 10 maps), `camsweep`, `bigperf`, `uxward`, `robust`, `leaks`, `crawl`, `seekclimb`, `spectate`, `huntpaint`, `timing` | ALL GOOD |
| `chameleon.test.js` `blendfair` | ALL GOOD on rerun (first run: a load timeout) |
| `chameleon.test.js` `disconnect`, `hotseat`, `db` | OLD_RESULT |
| Earlier in the session (builders and fixers): `ux`, `uxland`, `uxfinal`, `uxrematch`, `settings`, `settings3`, `toggles`, `timinglive`, `bigmatch`, `finalqa`, `dark`, `desktop`, `mapcache`, `chameleon-maps` `pockets` and `browser` | ALL GOOD (some only on a second run under load) |

Measured:
- Camera sweep: climb 99.4 %, Watch 99.2 %, orbit 99.3 %, with 0 inside a collider.
- Draw calls, worst view: Launderette 42, Candy Works 32, CU Boulder with the bounty marker 52 by sweep (70 by
  construction). All are under 80.
- Triangles in view: at most 84.5k, under 150k.
- `build_artifact.py --only=chameleon` builds with 42 modules, about 1.59 MB.

## Known issues

- **Pockets and modes:**
  - Huge bodies can't reach a few small pockets (the CU upper gallery strip, a Museum corner, the House attic). This is
    intended: smaller sizes can.
  - Mercy chirp and the note are not offered in Double Blind.
  - Double Blind whiskers show the sticker and count, but leave no stain, because there is no sync path for it.
- **Remounts:** if one device remounts mid-hunt, its moments state is forgotten. Mercy can be offered again and the
  whisker count restarts. The note is not in the resync snapshot.
- **Sudden death:** its fixed 20 s / 30 s clocks don't scale with map size. On CU Boulder a 30 s hunt favours the
  hider.
- **Maps:** the Launderette has no mezzanine. Adding two maps re-shuffles which map each calendar day gets in Today's
  hide, but both phones run the same build, so they still agree.
- **Budget:** CU Boulder's known worst view is 68 draw calls, plus 2 for the bounty marker, so 70 of 80. That figure
  is by construction; a sweep measured at most 52 around the marker.
- **Test timing:** the shared machine ran at load averages of 10–35 all session. Some older sections (`match`'s
  phase-switch skew of 50 ms, `dark`'s long paint flow) can still fail on wall-clock bounds under that load. They pass
  on rerun and are not logic failures.
- **For the coordinator:** none. No shared files were edited.

## README games-table line

```
| **Blend & Seek**: paint yourself to vanish into a 3D room, then hunt each other; twists, the Cup and ten rooms | Live, versus | Either |
```
