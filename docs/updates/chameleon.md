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

FIXES_PLACEHOLDER

## Tests

TESTS_PLACEHOLDER

## Known issues

KNOWN_PLACEHOLDER

## README games-table line

```
| **Blend & Seek**: paint yourself to vanish into a 3D room, then hunt each other; twists, the Cup and ten rooms | Live, versus | Either |
```
