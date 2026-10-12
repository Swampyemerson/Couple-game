# Word Duel

Versus Wordle. Each player secretly picks a five-letter word for the other, then both race to crack
the other's word in up to six guesses. Fewest guesses wins; a miss counts as 7.

Code: `js/games/wordduel.js` (UI), `js/games/wordduel/rules.js` (pure rules), `records.js` (ledger and
stamps), `css.js`, `lists.js` (word lists as letter strings, split every 5).

## Rules

- **Colours:** green with a bar is the right spot; yellow stripes is in the word elsewhere; grey is not in it.
  Repeats follow Wordle: exact matches claim letters first, then each remaining copy lights at most one more tile.
- **Guesses:** any valid word (ANSWERS 2,224 common + MORE ~10,700 allowed = ~12,900), never a repeat.
- **Heat tie-break (v2):** equal guess counts are decided by total greens on that player's rows *before* their
  solving row (all rows on a miss), then yellows. Only if both are equal is it a dead heat. The result `sub` says why.
- **Near-miss lines:** a win by one guess, or a loser whose last row had 3 or 4 greens, gets a rueful line.

## Move encoding

Match `opts` are always `{}`; versions are chosen by moves.

| Move | When | Meaning |
|---|---|---|
| `{ secret: 'crane' }` | both players, at once | v1 (legacy): pick a secret, no rules checks beyond the word list |
| `{ secret: 'crane', v: 2 }` | sent by v2 UIs once the rules are visible | same as above, but if replay order puts it before the rules move it is *parked* (`state.pend`) and placed when the rules arrive |
| `{ guess: 'slate' }` | each player, independently | up to 6 guesses |
| `{ setup: { v: 2, pool, hard, dealt, bo3 } }` | either player, only while pristine (no setup, no secret) | selects the v2 rules; the first applied wins, a later one is rejected |

**Legacy = no setup move.** Such a log replays to exactly the same states, `next()` and `result()` as before
(`tools/test/games/fixtures/wordduel-v1.mjs` is the frozen v1 logic; the test replays 400 random logs through
both). The pristine state keeps the v1 shape; v2 only adds `v`, `opts`, and for the relevant options
`opener`, `round`, `wins`, `rounds`, `fin`, `pend`.

Who sends the setup: the UI shows the rules card to `ctx.first` online (and once, to the first picker, on one
phone). The other phone shows "Waiting for X to set the rules…". `next()` stays `['a','b']` while pristine.
Replay applies seat a's moves first, so a v2 secret that reaches the log before the rules move is parked and
`next()` leaves that player out until the rules land; this keeps both phones' states identical.

### Setup options (validated; unknown keys or values throw)

- `pool`: `'fair'` (default, secret must be in ANSWERS), `'love'` (secret must be in the Love Letters list,
  90 words, all in ANSWERS; the pick screen shows 3 suggestion chips and "Surprise me" draws from it), `'any'`.
- `hard`: Wordle hard mode, enforced in `apply`: "Hard mode: keep R in spot 2." / "Hard mode: use the A."
- `dealt`: a deterministic opener drawn from ANSWERS by seed (and round) becomes row 1 for both players and counts as a
  guess. A secret equal to the opener is rejected. Row 1 shows a DEALT tag.
- `bo3`: best of 3. First to 2 round wins. After round 3 the leader takes the set; if level, a 4th and last round
  decides; if still level the set is a draw. A drawn round gives nobody the point. A secret used earlier in the set is
  refused. Finished rounds are archived in `rounds[]`; `secret`/`guesses` are always the current round. Between rounds
  each phone shows the round recap, then the scoreboard ("Round 2. Sydney needs this one."). The player chips show
  round wins (`score()`).

## One phone

The curtain hides each player's board. A guess is committed the moment it is sent; a player's finishing guess is
shown in a reveal that sits above the curtain (`.g-wd-hold-layer`) until "Done, pass to X". A localStorage flag
(`ju.wordduel.hold.<matchId>`) keeps that reveal if the player backs out and returns, so the guess can't be retaken.

## Records (`api.data` keys, flat)

`a_wins_n b_wins_n draws_n matches_n sets_n comeback_n`, `a_streak b_streak` (reset) with
`a_streak_best b_streak_best`, `a_fast_pb b_fast_pb` (8 - fewest guesses), `a_two_n b_two_n` (cracks in 2 or
fewer), `a_lastditch_n b_lastditch_n` (crack on guess 6), `a_held_n b_held_n` (their word held out),
`recent_m` (last 20 recorded match ids, comma-joined), `lastm`, `pbm` (match that beat a personal best),
`last_setup` (`pool:hard:dealt:bo3`, e.g. `love:1:0:1`, what the rules card defaults to).

Idempotence: counters are written as absolute values computed from the data snapshot. A match is recorded when this
phone watched it end during the current mount, or (v2 only) when a finished match is opened and its id is not in
`recent_m`. Legacy v1 matches are never recorded on reopen.

The ledger strip (`E 12 – 9 S · Sydney ×3 streak`) shows on the rules card and the end view. Stamps on the end view:
NEW RECORD, N IN A ROW (3+), COMEBACK, DUEL NUMBER 10/25/50/100, MIND-READER (crack in 2 or fewer),
LAST-DITCH CRACK, HELD OUT, IN SYNC (both solved on the same row), GREAT MINDS (same secret).

## Tests

```
node tools/test/games/words-duel.test.js            # rules + records unit tests, then the UI on two phones and one phone
UNIT=1 node tools/test/games/words-duel.test.js     # rules and records only (no browser)
ONLY=online,bo3,local,land,away,legacy node tools/test/games/words-duel.test.js   # pick UI scenarios
node tools/test/games/words.test.js                 # the older shared flows (Word Duel and Double Agents)
```
Build check: `python3 tools/build_artifact.py --out <scratch>/x.html --only=wordduel`.
