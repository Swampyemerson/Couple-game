# threed unit: Knucklebones and Tower Together

Branch `claude/upd-threed`. Files changed:
- `js/games/bones.js`, `js/games/tower.js`;
- the `bones()` and `tower()` cover functions in `js/games/covers.js`;
- new `docs/games/bones.md` and `docs/games/tower.md`;
- the tower and bones functions in `tools/test/games/threed.test.js`;
- two new suites, `tools/test/games/threed-bones.test.js` and `tools/test/games/threed-tower.test.js`.

No shared files were touched.

How the work ran:
1. **Survey.** Sonnet played and read each game: harness on an iPhone profile with real taps, plus bot self-play in Node.
2. **Content check.** Fable proposed additions from the survey summaries.
3. **Spec and build.** I wrote the spec, then one Sonnet builder per game.
4. **Verify and fix.** An independent Sonnet verifier and a fixer per game, then a second verify round for Tower and a final polish pass.

## How new rules stay compatible with old matches

Match `opts` are always `{}`, so both games choose their variant **in-game**:
- Before the first move, the starting player may send one *setup move*: `{ tw }` in Knucklebones, `{ m }` in Tower.
- The setup move does not pass the turn.
- If the first move is a normal move, the match is classic for good.
- Old logs never contain a setup move, so they replay exactly as before.

Each picker is a row of chips shown only to the starter. Playing a normal move skips it. The partner sees "Emerson is choosing a twist…" and then a toast that includes the rule.

**Replay evidence.** Independent verifier scripts loaded the original rules from git (`48c58ed~1`) and compared them with the new ones through `core.derive`, running again on the final code:
- **Knucklebones:** 3,000 random old-style games, 69,144 steps. Every original state field, `next()`, `score()` and the winner were identical (0 bad).
- **Tower:** 1,500 old-style logs, 20,187 blocks. Full state, result winner/score/text, `score()` and rejected moves were identical (0 mismatches).
- **What did change:** only `result().sub`, the flavour line. It now carries commentary.
- **New modes:** 600 Tower games in the new modes replay deterministically.
- **In the suites:** both suites also carry embedded copies of the original rules and replay fixed logs.

## Knucklebones

### Fixed (verified bugs)
- **Layout.** The board overflowed on small phones and in landscape: the die had a 36 px floor and there was no landscape layout. Dice are now sized from the viewport, and short landscapes get a side-by-side layout.
  - Fits with no scrolling at 320×568, 360×740, 390×664, 430×932, 844×390 and 667×375.
  - Column tap targets are at least 44 px at every size. They were 36–38 px.
- **Full column.** Tapping a full column did nothing on touch, because the column was a `disabled` button. It now shows a toast, plays the bad sound and shakes.
- **End card.** It could cover the last smash. It is now `endDelay: 'manual'` and appears after the finale and the record recap.
- **Band text.** Text overflowed the middle band on the 390×664 iPhone 13 profile. The copy is shorter and the layout is tighter; a test asserts every label stays inside the band in every state at all six sizes.
- **Records.** Records were lost if the last mover left during the finale. They are now written the moment the match is over.
- **Context loss.** A WebGL context that was lost and never restored froze the game. This bug predates the update. After 3 s the game now continues on flat dice, and 3D comes back if the context is restored.
- **Skipping animations.** About 3 s of animation per turn couldn't be skipped. Tapping the band or margin now fast-forwards it; it never places a die.

### New content
- **Twists** (setup move `{ tw }`):
  - **Golden Column:** one seeded column scores ×2 for both players.
  - **Mirror Dice:** both of you draw the same dice in a different order. Each round is five dice; the other player starts two places along.
  - **Blind Draw:** you pick a column before you see the roll. The verifier checked that the roll doesn't leak anywhere, on either phone.
  - **Oracle:** both of you see the next two rolls.
- **Last Word** (every twist, not classic): if the starter fills their grid first, the other player gets one final die. In every twist except Mirror that die lands softly and smashes nothing.
- **Records and rivalry** (shared game data): `games_n`, best score each, biggest smash, biggest comeback, three-dice wipes, current and best win streak, a last-five form strip, and per-twist play and win counts.
  - The finale shows the streak ("Sydney has won 3 straight"), the form dots and NEW BEST stamps.
- **Score preview:** each pickable column shows `+N` for your gain and `−M` for their loss. In 356 checks the preview always matched the real result.
- **Celebrations:** stamps for "Triple 5s · 45", "Wiped out" (with a bigger shard burst) and "Comeback!" (after being 15 or more down). Close losses get "So close — rematch?".
- **End card line:** `result().sub` commentary such as "Comeback from 22 down" or "Wiped 54 in one go".

### Balance (bot self-play, 4,000 games per row, starter alternating)

| rules | random bots: starter / other | greedy bots: starter / other |
|---|---|---|
| classic (unchanged) | 54.0 / 44.0 | 50.4 / 47.5 |
| golden, Last Word off → on | 54.3 / 44.4 → 47.6 / 50.9 | 49.6 / 49.1 → 45.9 / 52.4 |
| oracle, Last Word off → on | 54.0 / 44.0 → 47.6 / 50.4 | 50.4 / 47.5 → 45.1 / 52.5 |
| blind, Last Word off → on | 54.0 / 44.2 → 47.3 / 50.9 | n/a (a bot can't plan blind) |
| mirror, Last Word off → on | 63.2 / 35.1 → 50.6 / 47.0 | 68.5 / 29.2 → 51.9 / 45.4 |

- **Why the last die is soft.** A normal, smashing Last Word die over-corrected: the starter won 43–45%.
- **Mirror's first pattern.** "Same die each pair of turns" gave the second player about 85%. The five-dice round was the closest to even in a grid search over round sizes 3–9.
- **More detail:** see `docs/games/bones.md`.

## Tower Together

### Fixed (verified bugs)
- **Stray taps.** A stray or double tap right after a drop counted as a total miss and ended the run at 1–3 blocks. The slider now ignores taps for its first 250 ms and until it has crossed over the tower.
- **Ignored input states.** Taps during WebGL context loss, while the tab is hidden, or before the view is ready are ignored. They used to record a drop.
- **Online HUD.** The HUD ran ahead of the replay: the turn pill said "Your turn" about 1.5 s early, and the block counts gave away the result. All HUD parts now wait until the partner's drop has replayed.
- **Tall towers.** On towers of 100+, the finale overlapped the HUD and the outlines shimmered. The finale now fits the tower between the HUD and the panel, and the outlines thin out on tiny blocks.
- **Resume.** After a hidden tab or a context restore, the slider waits for a 3-2-1. It used to resume mid-sweep.
- **Same-phone hand-off.** There is a "Sydney's turn" beat: 600 ms, or a still 400 ms under reduced motion.
- **Fixes from the two verify rounds:**
  - banners and stamps no longer collide with the hand-off beat; they sit in their own column;
  - callouts that come together merge into one banner, so NEW BEST is never a drop late;
  - growth copy is only shown when the block grew;
  - the best line is culled where it would sit under the HUD;
  - the end panel respects the notch in landscape, and the tower slides clear of it;
  - records are written the moment the run is over;
  - the picker hides immediately when you drop;
  - the NEW BEST banner and the panel flag now agree.

### New content
- **Modes** (setup move `{ m }`):
  - **Duet:** the block only grows when you both land perfects back to back, so you're setting each other up.
  - **Windy:** a gusty, seeded slider with a streamer. The gusts are view-only, so the rules match classic.
  - **Hard Hat:** a 2.4 base, a 0.07 perfect window and a faster slider.
  - **Gift levels** (Duet and Windy): seeded, wrapped blocks that grow the tower when they land.
  - **Landmark levels** (every 10th level in all three new modes): golden levels where a perfect grows the block.
- **Hall of Heights** (shared game data): the best height per mode, longest perfect streak, towers, blocks and perfects per player.
  - A dashed ring and a "Best N" tag mark the best height on the tower, in 3D and 2D.
  - Passing your best triggers a "NEW BEST!" banner naming who placed the record block.
- **Feedback:**
  - milestone banners at 10, 25, 50, 75 and 100;
  - "So close!" and "By a whisker!" near-miss callouts;
  - a perfect chime that rises a semitone per streak step, up to an octave.
- **End-of-run panel:** height, NEW BEST against the old best, each player's perfects, longest streak, and Rematch / Back.
- **Cover:** the cover now shows a best line and a flag.

## Tests

| command | result |
|---|---|
| `node tools/test/games/threed.test.js` | ALL GOOD (105 ok) |
| `node tools/test/games/threed-bones.test.js` | ALL GOOD (351 ok): layout at 6 sizes, band fit, twists, Last Word, records on 1 and 2 phones, leave-early recording, previews, celebrations, context loss, light, dark and reduced motion |
| `node tools/test/games/threed-tower.test.js` | ALL GOOD (161 ok): stray taps, HUD timing, modes, records, ghost cull, notch, tall finale, landmark layout at 390×844, 844×390 and 667×375, light, dark and reduced motion, 2D fallback |
| `python3 tools/build_artifact.py` (all games) | builds, 107 modules |

- The two new suites each start their own browsers. Set `PORT` to move them; bones uses PORT to PORT+4 and tower PORT to PORT+2.
- `threed-bones.test.js --balance` reruns the balance table.
- Draw calls peak at 8 for Tower and 9 for Knucklebones, against a limit of 12.
- No page errors in any run.

## Known issues and notes for the coordinator

- **Turn games don't get `api.data` / `setData` / `onData`.** Core adds them only for live games (core.js ~1109). Both games import the exported `gameDataApi(id)` from `core.js` as a fallback. It would be cleaner if core added `...gameDataApi(gameId)` to the turn-game api too.
- **Record dedupe.**
  - The problem: `last_id` is a plain string, and a late sync of the shared doc can roll it back to an older value, since core keeps the max only for `_best`/`_n`/`_pb`/`_m` keys. That would have let a phone count the same match twice.
  - The fix: both games now also write a per-match marker `m_<matchId>: 1` and check it. These markers accumulate, one tiny key per finished match.
  - Streak and form are also plain values, so in rare sync races they can briefly show an older value. The counters stay correct.
- **Partner's twist toast.** It is the engine's toast, which sits at the top in immersive games. Tower shortens it but can't move it.
- **Tower.** In about 0.4% of drops, a gift or landmark banner says "it grew" when the growth came from the perfect streak. Telling them apart would mean changing the frozen rules. The block really did grow.
- **Knucklebones.**
  - The record stamps and streak are shown in-game; the engine end card itself doesn't include them, because `result()` must stay pure.
  - Mirror's dice multisets are exactly equal only when a match ends on a round boundary (about 28% of matches).
- **Real-device check pending.** Everything was tested in Chromium with an emulated iPhone. A real-iPhone pass is still worth doing, especially context-loss timing and the landscape notch.

## README games-table lines

- **Knucklebones:** `| Knucklebones: dice duel with 3D dice; four twists, streaks and records | Take turns, versus | Either |`
- **Tower Together:** `| Tower Together: stack 3D blocks together; Duet, Windy and Hard Hat modes, a best height to beat | Take turns, co-op | Either |`
