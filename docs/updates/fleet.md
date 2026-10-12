# Fleet unit report: Battleships

Branch `claude/upd-fleet`, from 6e9fee4. Files: `js/games/fleet.js`, `tools/test/games/fleet.test.js`, new
`docs/games/fleet.md`, and this report. No shared files were edited.

## How the work ran

The plan asks for Sonnet subagents (survey, build, verify) and one Fable content check. This session ran as a
subagent without the Agent tool (only TaskStop/SendMessage were exposed), so it couldn't spawn either. I did the
survey, spec, build and verification myself, in the same order and with the same evidence standard:

- **Survey:** read the code, tests and docs; ran the existing suite (passes, 116 checks); played through the harness
  on the iPhone 13 profile and on a laptop, and probed edge cases with throwaway scripts. Bugs below are only those I
  reproduced.
- **Content check (in place of Fable):** brainstormed against the plan's list (modes, twists, packs, rivalry,
  couple moments, surprise, mastery) and shipped the best fits (below). Skipped ideas are listed at the end.
- **Verify:** an expanded suite drives both players with real taps through one-device and two-device games, light
  and dark, phone and laptop, every rule set, and screenshots each screen. Bot self-play measured balance.

## Must-have: Emerson's secret look at Sydney's ships

### Where her fleet lives

A turn match is one shared db doc, `matches/<id>`, holding two append-only move lists (`a` = Emerson, `b` = Sydney)
as JSON strings. Both phones subscribe to the whole `matches` collection and replay **both** lists through the
game's pure rules. Sydney's first move is `{ fleet: [...] }`, so from the moment she taps Ready her complete
layout is in Emerson's phone's memory as `ctx.state.fleets.b`. The game hid it by never drawing it: enemy ships
reached the DOM only once sunk.

### The choice: no new data path at all

Her layout is already on his device, so the least invasive approach is to add nothing to sync, storage or the
move format, and only draw what's already in memory. Anything else (a side channel, a stored copy, a different
encoding) would add a trace. The cheat is about 20 lines of view code in `mount()`.

### How it works

- **Gesture:** press and hold the heading over the target chart ("SYDNEY'S WATERS") for 0.65 s. It's an ordinary
  label with no tap action, no visual affordance and no label. The same press toggles it off. A plain tap does
  nothing; moving the finger more than 12 px cancels it. It works with a mouse too (press and hold).
- **What he sees:** a faint dotted outline over each of her ships still afloat, under the cells, so taps fire as
  usual. Sunk ships drop out of the outline; wrecks draw as normal.
- **When it's available:** only in a two-phone match, only on the phone signed in as Emerson (the player whose
  name is "Emerson"; if that name is missing it fails closed), and only during the battle. On Sydney's phone and in
  same-phone play the gesture does nothing; in same-phone play she holds the same screen.
- **It switches itself off** when the battle ends (before the final board and end card), when he leaves the match,
  when the app is hidden (app switcher), and when the device changes identity.
- **Silent:** no sound, toast, status text, haptic or screen-reader announcement.

### What it never touches (and the tests that prove it)

`node tools/test/games/fleet.test.js`, section `[periscope]`:

- Works for Emerson: the outlines match Sydney's afloat ships exactly. They stay in step on every one of his turns
  as ships sink, down to one ship left.
- Does nothing for Sydney: her identical long press draws nothing, and the "no enemy ship in the DOM" leak check
  passes on her phone throughout, including while he peeks.
- Does nothing on a shared phone, even on Emerson's turn.
- Leaves no trace. With spies on both phones while toggling, the test asserts:
  - zero db calls, room emits or presence updates, `localStorage`/`sessionStorage` writes, `fetch` or beacons;
  - the shared db, room presence, both phones' storage, Sydney's whole game DOM, and Emerson's status line and
    toasts are byte-identical before and after.
- A full game with the periscope up leaves the usual footprint and nothing more:
  - every move he sent is a bare `{ r, c }`;
  - the match doc has only its usual ten fields;
  - his phone wrote only his move list, the five-field result record and logbook keys;
  - local storage got only the usual keys;
  - both end cards print exactly the result derived from the move log;
  - the final boards pass the leak check;
  - the logbook reads the same on both phones.

### Residual footprints (honest list)

- **His shots.** The periscope can't make him miss on purpose; a perfect game shows up as a perfect game in his
  records. That is indistinguishable from good play, but he might want to throw in a miss or two.
- **The code ships in the bundle**, like every game's code, so someone reading the artifact's source could find it.
  I kept the names neutral ("periscope") and kept this explanation out of any UI. `docs/games/fleet.md` doesn't
  mention it. The test file does, since tests must cover it.
- **His unlocked phone.** Anyone holding it and knowing the gesture could use it.


## Bugs fixed (all reproduced first)

| # | Bug | Repro | Fix + test |
|---|---|---|---|
| 1 | In battle, a key press on a focused control (e.g. the back button) was captured by the game's document keydown handler: the control didn't act and a shot was fired at the last aim instead. | Focus the back button during battle, press Enter: the game did not go back and a shot landed at the stale aim (D4). | `onKey` now ignores Enter/Space/arrows when the focused element is a button/link/control, and lets a focused target cell fire at itself via its native click. Tests: "[laptop] Enter on the focused back button goes back / and fires no shot / Enter on a focused square fires at that square". |
| 2 | Deterministic-replay hazard introduced with rule sets: a rule/stake pick's validity depended on whether the *other* player's fleet had been replayed first, which breaks the engine's simultaneous-phase contract. With the first player = `b`, `b`'s moves replay first, so the first player's rule pick hit an "a fleet is already hidden" check and was dropped — the match silently fell back to Classic on both phones (found by the Salvo UI test when `first` alternated to `b`). | `derive` with `first:'b'`, lists `a:[{rules:'salvo'},{fleet}]`, `b:[{stake},{fleet}]` → `state.mode` undefined. | The lock now checks the *acting player's own* fleet (`s.fleets[who]`), so the two players' placement moves are order-independent. Tests: "the first player being b does not drop a's rules pick (the determinism bug)" plus an a/b symmetry check. |
| 3 | Placement screen overflowed a phone viewport once the rule picker and stakes control were added: the ship dock was pushed below the fold, so a ship couldn't be dragged onto the chart (source and target weren't on screen together). | Measured on the iPhone profile (390x664 usable): the first dock ship landed at y~672, below the 664 fold; the drag produced no events. | Rules + stakes collapsed into one compact row; one-line hint; placement chart cell capped so the chart and the first dock row both fit. Existing drag/tap placement tests pass again; re-measured dock top at y~608. |

Pre-existing behaviour I checked and left intact: the same-phone "miss shows the splash, then passes the turn" hold; the "only the latest volley replays after a reconnect" catch-up; the no-leak guarantee (enemy ships never in the DOM until sunk). All still pass.

## New content and engagement

- **Three rule sets**, chosen on the placement screen before a fleet is hidden, versioned in the move log so old matches (no `{rules}` move) stay Classic and replay byte-for-byte:
  - **Classic** - the original.
  - **Salvo** - fire one shot per ship you still have afloat, aimed together then fired; losing ships shrinks your salvo. Balanced (below): the first player opens with 3 ranging shots, and an equal-salvo rule lets the trailing side fire a last answer, which can force a draw. Much faster games (~25 turns vs ~42).
  - **Arsenal** - Classic plus a kit: 1 sonar ping (counts the un-hit ship squares in a 3x3, free) and 1 torpedo (three in a line, a hit keeps firing) each; losing a ship earns a sonar, three hits in a row earn a torpedo.
- **Named ships.** Each fleet's five ships get couple-flavoured names (Big Spoon, Blanket Hog, Pillow Fort...), seeded by the match so both phones agree. Sinkings are announced by name in the stamp, the log and the roster.
- **Stakes.** Before a fleet is hidden, either player can set what the winner gets (coffee, dishes, a back rub, picking the movie...). Shown on the wait card, the side panel and the end card; it never changes play.
- **Shared logbook** on the final board (fewest shots to win per rule set, best hit streak, longest win streak, this game's accuracy), written from the move log into the existing `gamedata/fleet` doc so both phones agree and "New" badges show for whoever's device wrote first. A one-line "captain's log" on the placement screen surfaces the current streak / record as rivalry.
- **Moments:** "First hit!", "Hot streak!" (3 in a row) and "On fire!" (5), "Double sink!", "one to go", ping and torpedo call-outs, and a "photo finish" line on the end card when the loser was within three hits of winning.

## Balance evidence

Bot self-play, 6,000 games per row (checkerboard hunt that finishes wounded ships; the engine alternates who starts). Full table in `docs/games/fleet.md`.

| Rule set | First-player wins | Second | Draws | Turns |
|---|---|---|---|---|
| Classic | 52.5% | 47.5% | - | 42 |
| Salvo, first draft (5-shot opening, ends on last sink) | 66.8% | 33.1% | - | 25 |
| Salvo, shipped (3-shot opening + equal salvos) | 51.9% | 46.1% | 1.9% | 25 |
| Arsenal | 52.8% | 47.2% | - | 38 |

Salvo as first written gave the opener a 2:1 edge; the 3-shot opening plus the answering salvo brought it to ~52/46 with occasional draws, close to Classic. Opening-salvo sizes measured: 2 -> 46/52, 3 -> 52/46, 5 -> 65/33.

## Saved-match compatibility

The engine passes `opts:{}` to every match, so rules live in the move log, not the setup. A Classic match recorded before this update has no `{rules}` move and replays identically: the suite replays a full pre-update match and checks the sha-256 of its derived state, the winner and the result line. New state fields (`mode`, `kit`, `scans`, `stake`, and `t`/`kit`/`bonus` on shots) appear only in matches that use them. Existing move encodings are unchanged; the new move shapes (`{rules}`, `{stake}`, `{salvo}`, `{sonar}`, `{torp}`) are additive.

## Test results

`node tools/test/games/fleet.test.js` (runnable in parts with `ONLY=rules|light|dark|arsenal|laptop`). All sections pass. Coverage added on top of the originals:

- **rules** (pure engine): the golden replay of a pre-update match; every rule-set and stakes move with its rejections; the determinism regression; Salvo opening/answering sizes and the draw; Arsenal sonar/torpedo and the kit's streak/damage bonuses.
- **light**: the full Classic online game and same-phone game (original checks still green), draft-survives-close, the periscope suite (below), landscape fit.
- **dark**: a Classic game plus a full **Salvo online** game with stakes set by Sydney, including the stakes on the end card and logbook.
- **arsenal / salvo (same phone)**: sonar, torpedo, bonuses, and "the whole salvo is shown before the phone is passed".
- **laptop**: hover/keyboard aim, R to rotate, and the three bug-1 regressions.

The periscope section asserts: the outlines match Sydney's afloat ships and track them as they sink; her identical gesture and a shared phone show nothing; with spies on both phones the toggle makes zero db/room/storage/network calls and leaves the shared doc, room presence, both phones' storage, Sydney's DOM and Emerson's status byte-equal; a full game with it up writes only the usual moves/result/logbook, both end cards match the move log, and the final boards pass the no-leak check.

Known issues / honest limits:
- The periscope can't make Emerson miss on purpose, so a flawless game still reads as flawless in his records (see the cheat section's residual-footprints note).
- Placement cells are capped at 40px on a phone (down from 52) so the rule/stakes controls, chart and ship dock all fit on screen at once; still >=40px touch targets. The battle chart is unchanged.
- I could not run the Sonnet/Fable subagents (tools unavailable); the work was done single-session.

## README line (for the coordinator to apply)

The current line still fits; an optional refresh to mention the modes:

`| Battleships | Take turns, hidden fleets; Classic / Salvo / Arsenal | Either |`
