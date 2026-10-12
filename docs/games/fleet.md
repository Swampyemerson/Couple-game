# Battleships (`fleet`)

`js/games/fleet.js`, tested by `tools/test/games/fleet.test.js` (`ONLY=rules|light|dark|arsenal|laptop` runs a part).

Hide five ships (4, 3, 3, 2, 2) on an 8×8 chart, then shell each other's waters. Ships may touch, never overlap.
A turn game with secrets: on one phone the pass-the-phone curtain drops between players.

## Rule sets

Picked on the placement screen, before anyone hides a fleet. Every set uses the same fleet, so the pick never
invalidates a fleet that is already placed on screen.

| Set | Turn | Extras |
|---|---|---|
| Classic (default) | One shot. A hit fires again; a miss passes. | — |
| Salvo | One shot per ship you still have afloat, aimed first and fired together. Then the turn passes, hit or miss. | Losing ships shrinks your salvo. The first player opens with 3 ranging shots. Equal salvos: if the first player sinks the last ship, the other side still fires one answer with the ships it had as that salvo flew; sinking everything back is a draw. |
| Arsenal | Classic. | Kit: 1 sonar + 1 torpedo each. Sonar pings a 3×3 and counts the ship squares you haven't hit yet; it's free (you still shoot). Torpedo fires three squares in a line; any hit fires again. Losing a ship gives you +1 sonar (max 3). Three hits in a row earn +1 torpedo (max 2). |

### Balance (bot self-play, 6,000 games per row)

The bot hunts on a checkerboard and finishes ships it has hit; Salvo bots pick their squares one by one with the
same policy; Arsenal bots use their kit at random moments. The engine also alternates who starts from match to match.

| Rule set | First player wins | Second | Draws | Turns | Shots |
|---|---|---|---|---|---|
| Classic | 52.5% | 47.5% | – | 42.1 | 65.1 |
| Salvo as first drafted (5-shot opening, game ends on the last sink) | 66.8% | 33.1% | – | 24.5 | 67.8 |
| Salvo as shipped (3-shot opening + equal salvos) | 51.9% | 46.1% | 1.9% | 25.1 | 68.9 |
| Arsenal | 52.8% | 47.2% | – | 38.3 | 67.1 |

Opening-salvo sizes tried with equal salvos: 2 → 45.6 / 52.2, 3 → 51.9 / 46.1, 5 → 64.8 / 33.1 (first / second, %).

## Moves and saved matches

| Move | When | Meaning |
|---|---|---|
| `{ fleet: [{ r, c, len, dir }] ×5 }` | placement | your hidden fleet (unchanged since v1) |
| `{ rules: 'classic' \| 'salvo' \| 'arsenal' }` | placement, before any fleet is hidden | the rule set. The first one applied wins; later ones are rejected and skipped |
| `{ r, c }` | battle, Classic / Arsenal | one shot (unchanged since v1) |
| `{ salvo: [[r, c], …] }` | battle, Salvo | exactly the salvo size (3 for the opening, the answer size for an answering salvo, else ships afloat; never more than the squares left) of distinct new squares |
| `{ sonar: [r, c] }` | battle, Arsenal | ping centred on (r, c) |
| `{ torp: [r, c, 'h' \| 'v'] }` | battle, Arsenal | torpedo centred on (r, c); squares already fired at are skipped |

The engine passes `opts: {}` to every match, so the rule set is versioned **in the move log**: a match with no
`{ rules }` move is Classic and replays exactly as before. The test replays a full classic match recorded with the
rules at commit 6e9fee4 and checks the derived state's sha-256. New state fields (`mode`, `modeBy`, `kit`, `scans`,
and `t` / `kit` / `bonus` on shots) only appear in matches that use them.

Placement is simultaneous, so a rules pick can race a hidden fleet. Replay order settles it the same way on both
phones (the first player's list goes first): a pick that lands after a hidden fleet is rejected and the match stays
Classic. The UI only offers the picker while no fleet is hidden.

## Screen

- **Placement:** drag, tap-to-place, Shuffle, tap a ship to turn it (R on a keyboard). The rule picker and a
  one-line "captain's log" (win streak, fewest shots) sit above the chart. Drafts survive leaving the match (memory
  only, dropped once the fleet is hidden).
- **Battle:** their waters on top (the live chart has a yellow plate), the log of the latest turn, your fleet small,
  their roster. Salvo adds an aim counter and Fire / Clear; Arsenal adds the kit tray (tap a weapon, tap a square to
  aim, tap it again to fire; Turn flips the torpedo).
- **Ship names:** each player's five ships get names from a pack (seeded by the match, so both phones agree). Sunk
  ships are named in the stamp, the log and the roster.
- **Moments:** "Sunk!" / "Double sink!" stamps, "Hot streak!" at 3 hits in a row and "On fire!" at 5, "one to go",
  "Ping: n", and a "photo finish" line on the end card when the loser was 3 or fewer hits from winning.
- **Logbook** (final board): this game's shots, accuracy and best run for both, plus the all-time records.
- Same phone: a move that passes the turn is shown first (splashes, sinks, "pass the phone"), then played, so the
  curtain doesn't cut the moment off.
- Phones on their side size the chart by height, so all eight rows fit on screen.

## Records (`api data` doc `gamedata/fleet`)

Written by both phones from the move log (so they agree) when a battle ends:

| Key | Value |
|---|---|
| `<w>_fs_<mode>_best` / `_id` | `1000 − fewest shots to win` in that rule set (stored bigger-is-better so the shared doc's merge keeps the best) and the match that set it |
| `<w>_run_best` / `_id` | longest run of hits |
| `streak` | `"<w>:<n>:<match id>"`, the current win streak. Only counted for battles that ended on screen, so reopening an old match can't rewrite it |
| `<w>_ws_best` / `_id` | longest win streak |

"New" badges in the logbook come from the `_id` keys, so both phones show them even when the other phone wrote first.
