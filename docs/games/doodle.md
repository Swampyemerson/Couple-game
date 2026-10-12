# Doodle: rules, versioning, modes, records

Co-op draw-and-guess for two (`team: true`, `secret: true`). Entry `js/games/doodle.js` (content, rules,
registration). Helpers in `js/games/doodle/`: `packs.js` (modes, packs, the new prompt decks), `records.js`
(pure record / badge / history helpers), `view.js` (every screen), `css.js`. Tests:
`tools/test/games/party-doodle.test.js` (rules, v1 pinning, records, UI) and the doodle parts of
`party.test.js`.

## How a round works

The drawer picks a card, draws on a 256 x 256 grid paper (strokes are base64url strings, one `.`-joined
string per drawing, max 12 KB) and sends it. The guesser watches the replay, then guesses. Drawers
alternate; six rounds; both phones replay the same move lists, so everything in `init/next/apply/result`
is pure and seeded.

## Versioning (important)

`opts` is `{}` for every match. A match is **v1** unless its first move is a setup move.

* **v1** (every match saved before the v2 update): `init`, the `EASY / MEDIUM / TRICKY` arrays, `ROUNDS`,
  `POINTS = [3, 2, 1]`, `guessMatches`, error messages and result text never change. They are pinned by
  `party-doodle.test.js` (dealt choices for six seeds, four full scripted matches with their final state
  hash, the legacy matcher quirks such as "horse" for "house").
* **v2** starts with `{ setup: { v: 2, mode, pack, deal? } }` made by `first` (who also draws round 0)
  before anything else. `apply` accepts it only when `s.r === 0`, round 0 is untouched, `!s.v` and
  `who === s.first`; every field is validated (unknown mode / pack throws; `deal` must be 18 unique
  integers in range, round-major, tier order Easy / Medium / Tricky, each from the pack). It sets
  `s.v = 2, s.mode, s.pack` and rebuilds `s.rounds` from the seed. A second setup throws. A first move
  without `setup` stays on the v1 path.
* The UI sends a setup move for every new match. `deal` is chosen on the setup phone from cards not yet
  seen (see Rotation) and frozen in the move.

The view handles both: round counts come from `s.rounds.length`, not `ROUNDS`; v1 shows plain cards, v1
points and the v1 timer rules.

## v2 rules

**Stakes** (all modes): points by tier and guess number: Easy 2 / 1 / 1, Medium 3 / 2 / 1, Tricky 5 / 3 / 2.
Cards show what they pay. The card pool is the 282 v1 prompts (same indices) followed by the new decks.

**Modes**

| Mode | Rules |
|---|---|
| `classic` | Pick 1 of 3 cards, Stakes points. |
| `halfhalf` Half & Half | The guesser first sees the first part of the drawing (the first stroke at which the cumulative drawing time reaches half of the total, at least one and never the whole drawing; a one-stroke drawing shows the first part of its points instead; `halfPlan` / `halfSplit`). One early call `{ guess, early: true }` pays tier points + 2 (Easy 4, Medium 5, Tricky 7). `{ rest: true }` ("Show me the rest") plays the remainder, then exactly two guesses paying the 2nd / 3rd values. A wrong early call also continues with the rest and two more guesses. A plain guess first counts as skipping the early call. After tapping "I know it!" there is a "Never mind, show me the rest" way back. |
| `ladder` Ladder | No choice. Tier = the rung: starts at Easy, a hit climbs one (max Tricky), a miss (or time-up, or give up) drops one, never below Easy. `prompt` must equal the rung. |
| `invisible` Invisible Ink | Each stroke fades on the drawer's canvas about 600 ms after it ends (view only). 60 s timer. +1 on any hit. The guesser sees the full replay. |
| `mixed` Mixed Bag | A seeded twist per round from normal, halfhalf, invisible, sprint (35 s, +1 on a hit), oneline (exactly one stroke, +1 on a hit). Shown to both players. |

**Golden Frame**: in about 1 of 3 matches (seeded) one round after the first is golden: points double
(after bonuses). Hidden until its reveal; gold frame and stamp in the gallery.

**Time up**: at 0:00 the paper locks. With strokes on it, the drawing is sent automatically (retried;
if it keeps failing the paper unlocks so the player can fix it). Empty paper in v2 sends
`{ prompt, timeUp: true }`: a blank drawing scoring 0, "Time's up" on the reveal, next round. In v1 the rules
cannot take a blank drawing, so the old nudge stays, with one 10 second grace to scribble something
(sent as soon as the stroke ends).

**Result**: `result()` works for both versions. v2 bands go by the share of the max (max depends on mode,
twists and a golden round): 85 % Mind readers, 68 % Gallery-worthy, 50 % Fridge-door art, 30 % Abstract art,
anything Modern art, probably, 0 Pure mystery. `endDelay` is `'manual'`: the last reveal stays on screen
until the player taps "See the gallery" (or about 4 s) and then `api.showEnd()` shows the end card.

**Matcher (`guessMatchesV2`)**: an alternate listed for a card always matches as written. v1's plural / singular and typo rules apply on top, except: a typo is never forgiven when the guess is itself a word (any form) of another card in the whole pool, and a plural/singular variant does not match when it is another card's own name
(horse for house, clown for crown, trainer for train, car for playing cards, toaster for burnt toast,
butterfly for butterflies in your stomach). Exact matches are unchanged. `nearMiss` drives the "So close!"
label on wrong guesses (one edit away, or a whole word of a multi-word answer); it never scores and never
reveals the answer.

## Packs

`classic` (the original 282), `us`, `kitchen`, `outabout`, `creatures` (new, 30 to 32 cards each, 10+ per
tier), `everything`. New decks live in `doodle/packs.js`; their order is frozen (indices are stored in saved
matches): add a new deck at the END of `NEW_DECKS`, never edit or grow an existing tier. The test checks that
no card shares a word with another card and that nothing fuzzy-matches another card.

**Not built**: Encore (a 7th, unscored round where both draw the same Us prompt at once). It would change when every v2 match ends, so it is left as a follow-up.

## Records, rivalry, rotation

Shared flat doc via `api.data / setData / onData` (turn games do not get these from the engine yet, so
`view.js` falls back to `gameDataApi('doodle')` from `core.js`). Exactly one device writes per finished
match: the device whose own move ended it online (`ctx.last.who === ctx.me`), the single device in local
mode; it only writes for a match it watched finish, and dedupes with `lastRec = matchId`. Records apply to v1
and v2 matches alike (`best_v1` for old ones).

| Key | Meaning |
|---|---|
| `lastRec`, `plays` | last recorded match id, matches played |
| `best_<mode>` | best score per mode (`classic halfhalf ladder invisible mixed v1`) |
| `hitStreak`, `hitStreakBest` | guessed rounds in a row across matches |
| `a_drawPts b_drawPts a_guessPts b_guessPts` | lifetime points on each person's drawings / as guesser |
| `a_guessRounds b_guessRounds` | rounds guessed (for the per-round average) |
| `a_firstTry b_firstTry` | first-try hits as guesser |
| `trickyHits`, `perfects`, `drawings`, `golds` | Tricky hits, matches with every round guessed, drawings made (stamps at 10 / 25 / 50 / 100 / 250), golden rounds hit |
| `seen` | base36 card indices joined by `.` (cap 3000 chars, oldest dropped) |
| `lastMode`, `lastPack` | preselected on the setup screen ("Same again") |
| `pin`, `pin_s`, `pin_t`, `pin_by` | the pinned drawing (`matchId:round`, its strokes, title, drawer) shown on the setup screen |
| `rc_*` | what happened in the match just recorded (new best, previous best, milestone, streak, perfect, gold hits), so both phones show the same strip |

The gallery shows: plaque (score / max, rating), a records strip (NEW BEST with the old best, milestone,
perfect match, golden hit, streak), one title badge per person (Picasso, Mind Reader, First-Try Ace,
Daredevil; ties are "Dead heat", nobody is ever labelled negatively), a history line ("Your 12th match
together. Best ever 26, tonight 24: so close.") and a lifetime head-to-head chase line ("As guesser Sydney
leads 3.1 to 2.9 a round. Five first-try hits in a row flips it."). Every gap is phrased as a way forward.

**Rotation**: the setup phone deals from unseen cards first (`dealFresh`, local random), a deck that is used
up plays what it has not shown yet and starts over. The dealt cards are marked seen when the setup move is
sent.

## Layout

Portrait stacks head / paper / foot. When the stage is wider than tall (`width >= 1.25 x height`, height
< 640 px) the paper moves to the left at full height and the controls sit on the right, so Send, Guess,
Give up and "I know it!" never need scrolling at 390 x 664, 375 x 548 or 844 x 390. The setup screen keeps
its Start button in a sticky footer.

## Testing

```
RULES_ONLY=1 node tools/test/games/party-doodle.test.js   # pure rules only, seconds
node tools/test/games/party-doodle.test.js                # plus the browser flows
QUICK=1 node tools/test/games/party.test.js               # the shared party suite (doodle + wave)
python3 tools/build_artifact.py --out /tmp/x.html --only=doodle
```
