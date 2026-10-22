# Knucklebones (`js/games/bones.js`)

A quick two-player dice duel on a 3 × 3 grid each. Turns game, versus, 3D band (three.js) with a flat-dice fallback.

## Classic rules (unchanged since launch)

- Each turn a seeded d6 is rolled for the player to move: `randInt(6, seed, 'roll', n) + 1`. The move is `{ col }`.
- A column scores `value × count²` per value (4,4 = 16; 4,4,4 = 36). A grid is the sum of its columns.
- Placing a die removes every die of that value from the opponent's **facing** column.
- The game ends the instant either grid is full; higher total wins; equal totals draw.

Old match logs (only `{ col }` moves) replay exactly as before. `tools/test/games/threed-bones.test.js` carries a copy of the
original rules and compares 60 games move by move, plus two fixed literal logs and one pinned game whose scores were recorded from
the original code.

## Twists (versioned by a setup move)

Match options are always `{}`, so a twist is chosen **in the game**. Before the first die the player who goes first may send one
setup move `{ tw: '<id>' }`. It doesn't pass the turn or use a die. If the first move is a normal die the match is classic for good
and a later setup move is rejected. Unknown ids are rejected with a friendly error. The choice lives in `state.tw` (undefined =
classic; `'classic'` is also accepted). Old logs never contain a setup move.

| id | Name | Rule |
|---|---|---|
| `golden` | Golden Column | Column `randInt(3, seed, 'gold')` is gilded for **both** players: its column score counts ×2 (`state.gold`). |
| `mirror` | Mirror Dice | You both draw from the same dice, dealt in a different order. A round is five dice each: the starter takes them in order, the other player starts two places along (3 4 5 1 2). Nobody is handed the twin of the die that was just played against them. |
| `blind` | Blind Draw | Rules as classic, but you pick a column before you see the roll. The view shows a "?" die and the die tumbles in as it lands. The first die (which the starter already saw) is thrown away and replaced by `randInt(6, seed, 'blind', 0) + 1`. |
| `oracle` | Oracle | Rules as classic. Both players see the next two rolls in the band. |

The spec asked for Mirror to hand both players the *same die in each pair of turns*. Simulation says that is a second-player win
(see Balance): the second player can always answer a die with its twin straight away. The first replacement (X Y / Y X every four
turns) still gave the starter an immediate twin of the die the other player had just rolled (turns 1 and 2 share Y), and the two
players' dice differed in about 41 % of games. The shipped pattern is a round of five dice each; the other player starts two places
along. It is not an exact copy, and the copy is only exact when a match ends on a round boundary: a match ends part-way through a
round in about three matches of four, so the last die or two can differ. What it does promise: both players draw from the same
dice, and the chance that you get the twin of the die just played is the same 1 in 6 as in a normal game (it was 37 % before).

### Last Word (every non-classic twist)

If the **starting** player fills their grid first, the other player gets one final die before the game ends, so both have placed the
same number of dice (`state.final`). Classic matches and old logs are untouched. In every twist but Mirror the last die lands softly
(it doesn't smash). That choice comes from the numbers below.

## Balance (bot self-play, 4000 games per row, starter alternates seats)

`node tools/test/games/threed-bones.test.js --balance` (set `N=` for more games). "random" picks a legal column at random; "greedy"
maximises its own gain plus the opponent's loss each turn. Blind is measured with random bots only: a bot can't plan around a die it
can't see.

| rules | bots | Last Word | starter wins | other wins | draws | dice/game |
|---|---|---|---|---|---|---|
| classic | random | – | 54.0 % | 44.0 % | 1.9 % | 21.0 |
| classic | greedy | – | 50.4 % | 47.5 % | 2.1 % | 22.5 |
| golden | random | off | 54.3 % | 44.4 % | 1.4 % | 21.0 |
| golden | random | on | 47.6 % | 50.9 % | 1.6 % | 21.6 |
| golden | greedy | off | 49.6 % | 49.1 % | 1.3 % | 22.5 |
| golden | greedy | on | 45.9 % | 52.4 % | 1.7 % | 23.0 |
| oracle | random | off | 54.0 % | 44.0 % | 1.9 % | 21.0 |
| oracle | random | on | 47.6 % | 50.4 % | 2.0 % | 21.6 |
| oracle | greedy | off | 50.4 % | 47.5 % | 2.1 % | 22.5 |
| oracle | greedy | on | 45.1 % | 52.5 % | 2.4 % | 23.0 |
| blind | random | off | 54.0 % | 44.2 % | 1.9 % | 20.9 |
| blind | random | on | 47.3 % | 50.9 % | 1.8 % | 21.5 |
| mirror (5-dice round) | random | off | 63.2 % | 35.1 % | 1.8 % | 24.0 |
| mirror (5-dice round) | random | on | 50.6 % | 47.0 % | 2.4 % | 24.7 |
| mirror (5-dice round) | greedy | off | 68.5 % | 29.2 % | 2.3 % | 31.4 |
| mirror (5-dice round) | greedy | on | 51.9 % | 45.4 % | 2.8 % | 32.3 |

What the numbers say:

- **Classic favours whoever starts when play is careless** (54 % random) and is about even with greedy play (50 %). It is dice-heavy
  either way.
- **The Last Word rule is needed, but a smashing last die over-corrects.** With a normal last die the starter wins only 44–45 % in
  Golden, Oracle and Blind (greedy bots 43–44 %). The soft landing brings that to 46–48 %, within the noise of how luck-heavy the
  game is. Mirror keeps the normal last die: its pattern favours the starter (63–69 % without Last Word) and a normal last die
  brings it to 51–52 %.
- **Mirror with the same die in consecutive turns** (the original idea) gave the second player 85 % of the games, with random and
  greedy bots alike. Mirror games run long with greedy play (about 32 dice).
- Draws are about 2 %.

### Mirror Dice: which pattern

Last Word on, normal last die, 16 000 games per row (6 000 for the original-spec and classic-stream rows; random and greedy bots, starter alternates seats). "twin" is how often a die
equals the one rolled on the turn before; "dice differ" is how often the two players' dice multisets differ at the end.
`node tools/test/games/threed-bones.test.js --balance` prints the shipped row; the others were measured with a scratch copy of the rules.

| pattern (other player's order) | random: starter / other | greedy: starter / other | twin | dice differ |
|---|---|---|---|---|
| same die in turns n and n+1 (original spec) | 14 % / 85 % | 13 % / 86 % | 60 % | never |
| X Y / Y X, four turns (shipped before) | 44.3 % / 52.9 % | 51.4 % / 45.3 % | 37.5 % | 41 % |
| round of four, other starts two along | 43.5 % / 53.9 % | 44.8 % / 52.5 % | 16.8 % | 72 % |
| **round of five, other starts two along (shipped)** | **51.0 % / 46.5 %** | **51.8 % / 45.3 %** | **16.7 %** | 72 % |
| plain classic stream, for scale | 44.5 % / 53.6 % | 42.6 % / 55.1 % | 16.5 % | always |

A grid of rounds of 3 to 9 dice with every legal shift (4 000 games each) showed the shipped one is the closest to even for both
bots at once; most patterns swing 10 to 25 points one way. The trade-off is the copy: the earlier pattern was an exact copy more
often (59 % against 28 % of matches), but it handed the starter a twin of the other player's die more than a third of the time.

## Facts kept in state (additive, commentary and records only)

`first` (the starter), `big` `{ pts, who, n }` (most points removed in one placement), `deficit` `{ a, b }` (the most each player has
trailed by), `wipes`, `trips` (three-dice wipes, triple stacks) and `cb` (a comeback was already called). Each move's `state.last`
also has `pts`, `gain`, `triple`, `wipe` and `comeback`. Rules never read these.

`result(s).sub` picks one commentary line: a win by three or less ("Won by 1! 22 to 21. So close — rematch?"), a comeback from 15+
down, a 20+ point wipe, a triple stack, or just the score. `winner` is never affected.

## Records and rivalry (`api.data`)

Written once per match, from `update()`, on the first state in which the match is over and that was **not** already over when this
phone first opened it. That is before any animation, so a mover who taps the winning move and leaves at once still records the
match. Both phones compute the same values from the same state; `last_id` makes it idempotent. If the partner got there first, the
flags are read back from `last_flags`. Re-opening a finished match never records it again.

| key | meaning |
|---|---|
| `games_n`, `draw_n` | matches recorded, draws |
| `best_a_best`, `best_b_best` | highest grid total for Emerson (`a`) / Sydney (`b`) |
| `smash_best`, `smash_who` | most points wiped in one placement, and by whom |
| `comeback_best`, `comeback_who` | biggest deficit a winner overcame, and who |
| `wipe_n` | three-dice wipes |
| `streak_who` (`a`/`b`/`-`), `streak_len`, `streak_len_best` | current winning streak and the best ever |
| `form` | last five winners, e.g. `aabab`; `-` for a draw |
| `last_id`, `last_flags` | match last recorded, and its NEW BEST flags (`pb_a`, `pb_b`, `smash`, `comeback`) |
| `tw_<twist>_n`, `tw_<twist>_<a|b>_n` | matches played and wins per twist (`classic` included) |

`*_best` and `*_n` only ever go up (the data layer keeps the maximum when syncing). NEW BEST flags need an earlier record to beat, so
the first game only sets baselines. Everything is optional: with no `api.data` or no data the game plays normally.

The in-game finale shows "Emerson has won 3 straight", the form strip (blue and pink ink dots, hollow for a draw) in the band, and
up to two stamps ("New best: 71", "Biggest smash ever", "Biggest comeback") parked over the trays, not over the band. The engine's
end card (`endDelay: 'manual'`) is held until the recap has been on screen for about 1.7 s (the whole finale from the last move
stays well inside core's 8 s safety net). `result().sub` stays a pure function of the state, so the streak and records aren't in
the end card's own text; they are in the band, which stays readable behind the card and after "See the board".

## Feedback and delight

- **Score preview** while picking: every open column shows your gain (`+N`) in your totals row and their loss (`−M`) in theirs.
  Hidden in Blind Draw; no loss in a soft Last Word die.
- **Stamps** (printed-ink style): "Triple 5s · 45", "Wiped out" (three dice, bigger shard burst), "Comeback!" (took the lead after
  being 15+ down, once per player per match).
- **Full column**: tapping one says "That column is full", plays the "bad" sound and shakes. Columns use `aria-disabled`, not `disabled`,
  so the tap arrives on a phone.
- **Tap to skip**: a tap anywhere on the stage (but a pickable column) while a roll or placement plays out fast-forwards it. It never
  places a die.
- **Twist picker**: the starter, before the first die, gets a 2 × 2 grid of chips (≥ 44 px, label plus one-line hint) over the
  opponent's empty half. The last twist you picked is tagged (`localStorage` `ju.bones.twist`) but never sent for you.
  The partner sees "Picking a twist…" next to "Rolling for Emerson", then a toast with the rule: "Emerson picked Golden Column. One
  column scores double." On a shared phone the toast is only the rule ("Golden Column: One column scores double."): whoever tapped
  doesn't need telling what they picked. The twist shows as a badge on the band for the whole match. The chip you picked last time
  wears a small "Last time" tag (not a solid plate that looks selected); chip hints are at least 0.7 rem.
- **Last Word** is explained where it shows: the band says "Last word" and "Last die, no smash" ("One last die" in Mirror, where
  it does smash), so a soft die doesn't look broken.
- **Band text fits.** The band is only about 58 px tall on a 390 × 664 phone. Band copy is one short line per side ("Picking a twist…",
  "Choosing…", "Pick a column"); on a short band the "Final" kicker goes and the form dots shrink, and the test asserts every label
  box lies inside the band at all six sizes and in every state.
- **Stamps and the band.** A mid-board stamp (Triple, Wiped out, Comeback) sits over the band, so the band's text fades out while it
  shows and comes back after. Finale stamps sit over the trays instead.
- **WebGL context lost.** The frame loop stops while the context is lost, which would leave a roll waiting for ever. After 3 s the
  3D view is parked, pending rolls are settled and play goes on with the flat dice; if the context is restored later the 3D view
  comes back.
- **Layout**: dice are sized from the viewport, not the content, so the board fits without scrolling at 320 × 568 up to 430 × 932
  portrait and 667 × 375 / 844 × 390 landscape (trays side by side with the band between). Column buttons are at least 44 px wide
  even when the die is narrower. Down to 320 × 568 the dice are 37 px.

## Feel and graphics (upgrade 2)

All view code: the rules, the roll values and the twists are untouched, and old logs replay as before.

**Dice physics.** The scripted bounce table is gone. When a roll starts, `throwTo()` solves the whole throw once: a rounded cube
(eight corner spheres, radius 0.1) against the floor, gravity, speculative contacts with a sequential-impulse solver (restitution
about 0.4 that fades with speed, Coulomb friction 0.9, a little damping, a sleep threshold), at a fixed 1/120 s step, at most 1.4 s
(168 steps), into preallocated typed arrays (`TP` positions, `TQ` quaternions). The launch is one of 24 seeded candidates
(`api.rand(seed, 'throw', n, k)`), so both phones solve the same throw; the one that comes in from the roller's side, comes to rest
near the centre and falls asleep in time wins. The result is made exact afterwards: the simulated rest orientation is composed with
the one of the 24 cube rotations `C` that puts the wanted value on top (`rest · C`), and the whole throw is turned about the
vertical (a floor doesn't care) so it ends on the band centre with the old final yaw. The cube is symmetric, so every contact is
unchanged. If the die isn't asleep at the cap, the last 120 ms blend to a flat rest. Playback is the rAF clock with an alpha
between stored steps (nlerp for the quaternion). Contacts above a speed threshold fire the tick (louder and higher the harder,
a thump under big ones, at most one per 60 ms). `fast()` (tap to skip) jumps to the last step; reduced motion (`calm`) skips the
simulation and drops the die 0.25 units. `window.__bonesTest.top` is the face on top, read from the quaternion the renderer was
given at landing; the tests compare it with the rolled value for tumbles, skips and reduced motion.

**Juice** (nothing under reduced motion): squash and stretch along world up on hard impacts (a spring, at most 12 % squash and 7 %
stretch), a hard-edged blob shadow that tightens to the die as it lands, a puff of 10 ink flecks (one `Points` draw) on the first big
impact, a 3-frame hitstop on the final settle and a short rock. A smash gets a 50 ms hitstop (CSS animations paused) before the
crack, then a 150 ms, 3 px band shake (WAAPI transform).

**Input latency.** At 4× CPU the old path was: pointerdown, about 10 ms to the click, about 25-55 ms of `api.move` (replays the
match twice, writes it out) and the sync chain, only then the die drew, and the next frame showed it (99 ms). Now a pickable column
is pressed on pointerdown (`is-press`, no `preventDefault`), the pick runs on finger-up on the same column (the click that follows is
ignored), the die is drawn into the tray straight away (only the mover's half is rebuilt) and `api.move` is deferred to after that frame
(`rAF` then a task, with a 120 ms backup for hidden pages). `sync()` consumes the pending placement so it isn't drawn or sounded twice.
Blind Draw keeps the old path (the die must tumble in before it is revealed); keyboard clicks still work.

**Graphics.** One chamfered/rounded die geometry (216 vertices, 300 triangles), one 512 × 256 face atlas (six faces plus two spare
cells, mipmapped) with paper grain and pips printed in ink over a second pass in the roller's colour a hair off register,
`MeshToonMaterial` with a three-step `NearestFilter` gradient (top, front and side print in three tones), a hemisphere light (paper
above, ink below) and one sun, inverted-hull ink outline and crease lines on the rounded edges. The band floor is a printed mat: a
256² tileable canvas (paper, felt fibres, a 45° halftone screen) with a printed target ring and four ticks where the die lands, tinted
from the palette (`bg`, `card`, `ink`, `edge`) and re-read on a theme change; dark mode lightens the die card a little so it reads on
black stock. Budget per frame: 6-7 draw calls, about 760 triangles, about 1.0 MB of textures (`t.texBytes`). The flat DOM die still
works. `restore()` repaints every texture.

**One render per frame.** The bench saw about 18 draws per frame because `renderNow()` rendered at once in the resize / theme / start
paths on top of the frame loop's own render. Now only a real canvas resize (which clears it) renders at once; everything else marks the
view dirty and the loop renders once. `resize()` and `setZoom()` do nothing when the size is unchanged.

Test hooks added: `t.top`, `t.tris`, `t.texBytes`, `t.pressed` (and `press:N`, `shake` in the log).

## Tests

```
node tools/test/games/threed-bones.test.js          # rules in Node, records maths, then the phone UI (PORT=8900 uses 8900-8904)
ONLY=reduced node tools/test/games/threed-bones.test.js   # one group: light, reduced, records, online-records, dark
node tools/test/games/threed-bones.test.js --unit   # rules and records only
node tools/test/games/threed-bones.test.js --balance
node tools/test/games/threed.test.js                # the older bones + tower flows
```

What the new file covers: old-log replay against a copy of the original rules; every twist (setup move accepted only first and only
from the starter, golden ×2, the mirror rounds and how often a twin follows a die, blind's thrown-away first die, oracle = classic
rules, Last Word with the soft and normal last die); the facts and commentary lines; the records maths; layout at 320 × 568,
360 × 740, 390 × 664, 430 × 932, 844 × 390 and 667 × 375 (everything on screen, no scrolling, columns ≥ 44 px wide); **band text
fits** (every label box inside the band, nothing cut off, labels not overlapping) in the first roll, the partner waiting on a twist,
Oracle and Blind picks and waits, Last Word and the finale with streak, form strip and stamps, at all six sizes, plus the twist
chips' text inside their boxes; full-column tap with `page.tap`; tap-to-skip; the end card arriving after the final smash and
about 1.7 s after the recap; the picker, the partner's waiting text, the toast carrying the rule, the "Last time" tag, golden /
blind / oracle / mirror on two phones; the +N / −M previews matched against the real smash; stamps for a triple, a wipe and a
comeback, and the band text stepping aside under them; Last Word on screen ("Last die, no smash"); four same-phone games for streaks,
form and NEW BEST; a match recorded when the last mover leaves at once; a two-phone match recorded once and never again when
reopened; a lost WebGL context that never comes back (flat dice after about 3 s, 3D back on restore); dark mode.
Long flows run with `reducedMotion: 'reduce'` so a whole game takes seconds. The room switches every CSS animation off in that mode
(`animation: none !important`), so stamps are shown and taken down by script there.

The page exposes `window.__bonesTest` (a log of `roll:`, `place`, `crack`, `stamp:`, `sfx:`, `records:` events, plus frame and draw-call
counters) for the tests; nothing depends on it.
