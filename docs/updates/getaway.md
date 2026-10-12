# Getaway update report (unit: getaway)

Branch `claude/upd-getaway`. Files: `js/games/getaway/**` (new: `twists.js`, `chase.js`),
`tools/test/games/getaway.test.js`, `docs/games/getaway.md`. No shared files touched; the maps
(`js/games/getaway/maps/**`) are untouched, so Boulder's home (3865 Moorhead) and Santee's home
(8524 Boulder Way) and its cats are exactly as they were.

How it was run: two Sonnet surveys (code and tests; hands-on iPhone play), one Fable content
check, a director's spec, then Sonnet builders (bug fixes; round flow and rivalry; in-chase tools),
a follow-up builder, a code review, two rounds of play verification (iPhone profiles, both players,
one and two devices, light and dark), three fixers, and a full regression.

## What's new

The survey's main findings shaped the update. The cop is the hard job: in a Hard-vs-Hard AI bench
the cop won 0/16 rounds on Dockside and 3/16 on Boulder, with 0–0.5 PITs a round. Every round had
the same shape. Rewards came early and then dried up. Rivalry was only numbers.

**Pairs scoring** (new default, Settings → Scoring: pairs · every round). Rounds already come in
pairs on the same start with the roles swapped. Now the point goes to whoever did the same job
better:
- an escape beats a bust;
- of two busts, the longer survival wins;
- of two escapes, losing the heat beats the clock, then the faster getaway, then health left plus
  how close the heat meter got.

The second half shows a target ("Beat 0:41", "Bust them to win") on both phones, and the result
card says "Half time". A round the cop can't win still has a winner, so this fixes the runner bias
without nerfing the runner. The match ends early once the points left can't catch up. Scores are
recomputed from the round history, never incremented, so a re-sent message can't double count.

**Wildcard rounds** (Settings → Wild rounds: on/off). Each pair after the first gets one of seven
twists, picked from the match seed so both phones agree, with no repeats in a match:
- **EAGLE EYE**: radar always on, heat +40 m.
- **FOG**: heat ×0.7, no radar, real fog in every shader.
- **SPIKE RAIN**: 6 strips, and the runner sees them all.
- **BIG TANK**: big nitro for the runner, and the cop's boost recharges 1.5× faster.
- **SLICK STREETS**: less grip for both cars, and 2 oil slicks.
- **SAFEHOUSE**: a named landmark. Reach it unseen and you escape on the spot. Reaching it seen
  gives +35% on the escape meter. The cop can camp it. It is drawn on both maps with a beacon made
  of puffs. Boulder and Santee prefer the couple's home: **HOME SAFE!** at 3865 Moorhead or
  8524 Boulder Way.
- **DOUBLE OR NOTHING**: the pair is worth 2.

A Quick chase's single pair always gets a wildcard (never DOUBLE). Twists that would override the
couple's settings are left out: SPIKE RAIN with 0 strips, BIG TANK with nitro off. The twist shows
on the intro, as a HUD chip, and on the result and match cards. The practice AI uses the safehouse:
the runner heads for it when unseen, and the cop sometimes camps it.

**Fairer sudden death.** The player who didn't run first runs the decider. The cop keeps 1 spike
strip, unless the match has none.

**The Series**, a head-to-head ledger (couple modes only).
- Shows in the lobby: "Series: Sydney 7–5 · she's won the last 2".
- Round 0 opens with a GRUDGE MATCH ribbon when someone has lost 2 or more in a row.
- The match card can stamp REVENGE!, SERIES LEAD! and every tenth match ("MATCH 10").
- The host writes it once per match.

**Cop tools**
- **Quick drop**: the spike button (or E) lays a strip on the road ahead, trying 62/90/40/120/160 m
  through the existing validation. The map still places one precisely.
- **Hot Pursuit chain**, the cop's own style chain. Close and in sight it gains +1 every 2.5 s; a
  spike hit adds +3 and a PIT +2. The tiers CLOSING, HOT PURSUIT and RELENTLESS each refill 25% of
  the pursuit boost.
- **Wanted level**: ★★ at 60 s gives the cop a faster boost recharge. ★★★ at 100 s gives a full
  tank and a longer last-seen ping. Shorter rounds scale the thresholds. The runner sees "they're
  getting serious". It is off in the Daily, so old Daily scores stay comparable.

**Daily 2.0**
- Even days are **cop days**: bust the Hard AI runner. The score is the time left at the bust.
- The panel shows your best ever, your partner's run today, and both **Daily streaks**. A missed
  day just reads "Day 1", with no guilt text.

**Delight**
- Six emote lines per role, ending in a **heart**, drawn as a DOM sprite with a hint when the
  sender is off screen.
- A **bumper kiss**: a gentle touch after the round ends, once the cars have parted, puts a heart
  on both phones.

**Four new liveries** (colours and decals only, no extra draw calls):
- Runner **Sweetheart**: win a grudge match. Hearts on your own ink.
- Runner **Checkerboard**: escape at full health on a run of 45 s or more.
- Cruiser **Interceptor**: reach RELENTLESS.
- Cruiser **Classic**: win 5 pairs.

New records and MVPs: longest pursuit chain, CLEAN SWEEP (won both halves of a pair), SAFE AND
SOUND, RELENTLESS.

**Polish**
- Role-aware wording everywhere.
- The result card and match card fit short landscape phones (667×375) without scrolling.
- The match card groups rounds by pair.
- The lobby header sits clear of the corner stickers.

## Fixed (all reproduced first)

**Daily and records**
- An overtime bust in the Daily scored 121, beating a clean escape. Busts now cap at the round
  time − 1.
- Driving into the water gave the cop a "fastest bust" record and the Highway patrol unlock. A
  runner could gift it. Splashes still count as busts, but not as the fastest bust.
- NEW RECORD fired on every +2 km/h of top speed. The step is now 5.
- The "NEW" tag went on non-record lines.
- "was 1 rounds"; a duplicated streak line.

**Engine**
- A timer leak after about 100 rounds: the desktop legend interval outlived the game.
- The result headline coloured by outcome, not by viewer: a cop who busted the runner saw a red
  BUSTED!.
- The Daily intro showed 4 round pips. The cause was a pip cache key that made `['now','','','']`
  equal `['now']`.

**Display and settings**
- The cop's heat label was cut off at 667×375. The touch test failed.
- Quick chase couldn't be undone. There is now a Standard chip.
- Dockside's 140 m heat was shown as "180 m". It now reads "Map default".
- The tiebreak wording was wrong when only one side escaped.
- UNTOUCHABLE went to a player who was busted three times.

**Found in review**
- The live cop's name tag showed the runner through buildings, so radar "off" was moot online.
- A relink re-send could restart a finished round on the guest.
- A late KISS message could mark the next round.

## Must-haves

None of the PLAN's must-haves are in this unit. The brief's keep-intact items:
- **Home landmarks and cats**: the map files are unchanged.
- **Budgets**: the perf section passes on every map. The worst case in view is 51 draw calls and
  137k triangles (Boulder, phone); the budget is 90 and 220k.
- **Saved data**: every new key is an additive flat number. Old `getaway.setup.v1` setups load
  with the new rules defaulted.

## Saved data

All new keys are additive flat numbers; existing keys are unchanged.

| Group | Keys |
|---|---|
| Series | `series_a`, `series_b`, `series_d`, `series_n`, `series_last`, `series_run` |
| Per person | `<ns><w>_safe`, `_clean`, `_revenge`, `_pairs`, `_chain_r` |
| Daily | `<w>_daily_streak`, `_daily_streak_best`, `_daily_last`, `<w>_dailycop_<date>`, `<w>_dailycop_best` |
| Liveries | `unlock_<w>_runner5`, `runner6`, `cop4`, `cop5` |

The new rules `score` and `wildcards` travel inside the match setup.

## Tests

`node tools/test/games/getaway.test.js` gains the sections `extras`, `extraslive`, `wild`,
`wildlive`, `wildsplit` and `resultfit`, plus many unit tests. These cover:
- twists, `pairWinner`, scoring, the Series fold, unlocks, the safehouse picker;
- chain, wanted, streak, Daily scores;
- the AI safehouse;
- fog uniforms, tag gating and the relink guard.

The older sections pin `score: rounds, wildcards: off` so they keep testing the classic flow.

Full regression on f9ab2ec: every section passed on its first run. That covers unit (271 ok),
practice, extras, extraslive, touch, live, wild, wildlive, wildsplit, resultfit, lossy, split,
robust, mapswitch, gfx, perf, stall, contacts, chasecontacts and shots, plus
`getaway-boulder.test.js` and `getaway-santee.test.js`. The artifact builds (1.46 MB with
`--only=getaway`). The bundler export/import rules hold.

After the last polish commit (a9db81f) these sections were re-run on that HEAD and all passed:
unit, practice, extras, extraslive, touch, live, wild, wildlive, resultfit and shots. The commit only
changed CSS, HUD layout and wording, so the rest of the regression stands.

## Known issues

- At 667×375 the lobby card's top corners just touch the corner stickers. No text is under them,
  but a fully clear top doesn't fit in 375 px.
- On short landscape the result card keeps the three most important lines: pair line, then record,
  then unlock, then the rest. A crowded card can drop the Daily streak line there; portrait shows
  it.
- The AI cop doesn't actively use the Wanted level or quick drops; those are for the human cop.
- Not verified on a physical iPhone: safe-area insets, real frame rates and real fonts (the harness
  blocks web fonts).

## README line

| **Getaway**: 3D car chase; one runs, one's the cop (PIT, spike strips, lose the heat). Rounds scored in pairs, wildcard twists, a running Series | Live, versus | Either |
