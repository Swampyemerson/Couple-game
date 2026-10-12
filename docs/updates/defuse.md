# Defuse update: report (unit: defuse)

Branch `claude/upd-defuse`. Game doc: `docs/games/defuse.md`.

## The user's must-have

> "Bomb one needs new approaches and difficulty too as [we] learned that pattern too much."
> Spec: new module types; per-game randomized rule sets and manual variants, seeded so both devices agree; difficulty tiers; fresh
> twists (role swaps, red herrings, time pressure). It must stay a communication game.

### Before: what made it memorisable (survey, 3000 seeds of the old game)

- One fixed field guide: 19 wire rules, 7 button rules, 4 strip digits, 5 keypad columns of 7, 24 sequence mappings. About 90
  facts, identical every round. The seed never touched the rules.
- The same four modules in the same order every round.
- Button: the strip digits were always 1, 3, 6 or 8 (blue = 3, white = 6 …). The default rule ("tap it") fired 35 % of the time.
- Keypad: every 4-glyph set contained a glyph unique to one column, so knowing 25 glyph→column pairs plus 5 fixed orders made the
  manual unnecessary.
- Sequence: 8 mappings matter at 0 strikes; one table was two swaps.
- Wires: the last-resort rule alone was right 19–32 % of the time; "6 wires → cut the fourth" was right 38 % of the time.
- Only RDY/PWR/AUX indicators, battery count, serial parity and vowel ever mattered.
- Difficulty changed only the clock (6:00 / 5:00 / 3:30) and the sequence length.

### After: what ships

**Every round is a new edition of the rules.** `buildRound(seed, tier)` (`js/games/defuse/round.js`) is pure. The bomb device
picks the seed, and the manual device rebuilds the identical round (edgework, module list, each module's rules, each puzzle) from
`{ seed, tier }` in presence. Node test: 200 seeds × 5 tiers rebuild JSON-equal, and two browsers agree on the edition name.
Each edition has a seeded name ("Frosty Dolphin") on both the bomb's sticker and the manual, so the couple can check they hold the
same guide.

Per-round variation (verifier, 200–4000 seeds per tier):
- Wires: 3–5 rules per wire count drawn from condition and action templates (colour counts, first/last colour, serial parity or
  vowel, lit/unlit indicators from 8 labels, batteries, ports). Rule lists are checked semantically, so no rule can never fire,
  the final "Otherwise" is always reachable, and no rule repeats the default. The default rule wins only 5–13 % of the time, and
  no answer position is above 28 % for 4–6 wires (3 wires is about 33 % each).
- Button: the rule list, the strip→digit table and (Expert and up) the release rule (last digit / seconds add up to / any digit)
  are drawn per round. Tap/hold is 50–52 %. The hold digit is flat across 1–9 and matches the old digit only 10 % of the time.
  The trick labels HOLD and PRESS mean the opposite in about 70 % of editions, not always.
- Keypad: 5 or 6 new columns per round from the 30 glyphs. 0 of 5952 columns repeated exactly, 0 matched an old column. From
  Expert, some columns read bottom to top.
- Sequence: new permutation tables per strike column, and the table-picking condition is drawn per round (vowel, even digit,
  lit indicator, batteries).
- New modules (below) regenerate their content per round: mazes, word lists, morse charts, LED tables, vent and relay rules.
- The module mix and layout order are drawn per round. The plate numbers (3 digits) differ per round.

**Six new module types** (each a plugin with the same interface; `js/games/defuse/*.js`):

| Module | Bomb holder sees | Manual reader has | Changes each round |
|---|---|---|---|
| Maze | 6×6 grid, two rings, you and the goal, arrow keys | 6 or 9 mazes with walls, picked by the rings | every maze (generated), Bomb Squad prints the page mirrored |
| Password | 5 letter rollers, Submit | 20–30 word list | the list, the rollers; exactly one word fits |
| Signal lamp (morse) | a blinking lamp, a tuner, TX | a code chart and word→frequency table | words, frequencies; from Agent up, the code chart itself is scrambled, so real Morse doesn't help |
| Breaker panel (switches) | status LEDs, 5 switches, SET | colour→flip table, edgework modifiers, safety checks | every table and modifier |
| Vent (needy) | wakes with "VENT GAS? 47" and a 20 s countdown | YES/NO rules by prompt, reading and edgework | every rule; wrong or late is a strike |
| Relay (role swap) | **the rule card** | **the controls** (relay box) | every rule chain |

**Five tiers** (old keys stay valid: `chill`, `normal`, `spicy`):

| Tier | Clock | Modules | Twists | Level |
|---|---|---|---|---|
| Classic | 5:00 | the original four, the original guide | 0 | for nostalgia and regression |
| Rookie | 6:00 | 3 | 0 | simple templates, no indicators or ports |
| Agent (default) | 5:00 | 4 | 1 | ports appear, compound rules |
| Expert | 5:30 | 5 + vent | 2 | trick labels, reversed keypad columns, release-rule variants |
| Bomb Squad | 6:00 | 6 + vent | 3 | strike tax always on, mirrored maze page, 15 s vent |

The verify pass estimated the load per tier with a cost model and lengthened the Expert and Bomb Squad clocks (they were 4:30 and
4:00, estimated at 119 % and 150 % of the time a practised pair needs). Agent estimated 69 %, Rookie 39 %.

**Twists** (drawn per round, listed on the manual's basics page; red herrings are never announced on the bomb):
- Red herrings: **Twin modules** (one type appears twice; the manual's plate rule says which is live; touching the other is a
  strike), **VOID sticker** (a fake serial and indicator), **Correction slip** (one page has a taped erratum, and it always changes
  this bomb's answer).
- Time pressure: **Surge** (the clock runs ×2 for 12 s, twice), **Strike tax** (−30 s per strike), the **Vent** needy module.
- Communication: **Blackout** (the bomb's modules go dark for 5 s; describe from memory).
- Role swap: **Relay**. For one module the manual reader describes and the bomb holder instructs. The controls are on the manual
  device and the rule card is on the bomb, so it works with the bomb on a laptop and the manual on a phone.
- Surprise: **Golden module** (about 1 round in 12): solve it with no strike on it for +20 s.

**Still a communication game.** A verifier scanned 8 rounds across every tier. The bomb DOM never contains rule text (except the
relay card), and the manual DOM never contains the serial or any bomb puzzle state.

**Old saved data still loads.** Engine results keep `{ team, score, text, sub }`. The old tier keys are still valid. New records live
in `api.data()` as flat keys; that API stores only flat string keys with primitive values, so nested objects would be dropped. Every
read tolerates `{}`, null, wrong types, a bare-number best, and nested or dotted shapes (424 fuzz calls, 0 throws). The **legacy**
browser group seeds old and garbage data and plays a round.

## Records, rivalry and delight (from the Fable content check)

- Per-tier medals (defuse / zero strikes / zero strikes with half the clock left) as pips on the tier buttons; the end card names
  the next medal. No locks.
- Records strip: streak, best time per tier with who held the bomb, defused total, the last 8 rounds as chips with edition names.
- Holder-keyed stats (who held the bomb, the reader's strikes), shown playfully, never as blame.
- **Today's bomb**: a daily seed so both of them play the same bomb, once each per day, compared in the lobby.
- "New record!", near-miss lines (< 10 s left, two strikes), a sweet couple line on a zero-strike win, and a "Swap?" nudge after 3
  rounds with the same bomb holder.

## Round 2 (10:20–11:00): keeping it fresh for a couple who learn fast

A second Fable check ranked three ideas. Two shipped:
- **Personal par and Par clock** (this answers "the clocks need tuning" with their own data). Each tier keeps a par: the average
  seconds they *used* on wins, from 3 wins on (flat keys `parN_<tier>` and `parSum_<tier>`, halved at 20 wins so it tracks their
  current form). The lobby shows "Par 2:40", and a playful nudge suggests the next tier after three clean wins in a row, or an
  easier one after two booms in three rounds. The **Par clock** switch (shared with the partner) starts the bomb at par + 20 s, so
  the clock tightens as they improve. The end card says "Under par by 24 s." Timed events that fall outside a shorter clock are
  skipped. Old and garbage values read as "no par".
- **Hush** (Expert and Bomb Squad, about half of rounds): once per round the manual goes blank for 8 s. The reader must remember
  what they just read while the bomb stays live. It's drawn from its own seeded stream, so every existing round and pinned test
  seed is unchanged. It never overlaps a surge or blackout and is never in the first or last 30 s. The manual's basics page
  announces it.
- Not shipped: **Chain ×2** (two bombs back to back, leftover time carries over). The builder hit a rate limit before it had
  written code, and its partial edit was reverted. It's a good next step.

## Bugs fixed (found by the survey, reproduced)

1. Silent freeze: when the partner backgrounded the app the bomb paused with nothing on screen and ignored taps. There is now a
   pause overlay on both devices saying who and why.
2. Bomb on a phone: the timer scrolled away (the content was about 1450 px tall) but the hold button needs the timer digit. There
   is now a sticky top bar with the clock, strikes and flags. The laptop side panel is sticky too (the verify pass found it scrolled
   away with 6 modules).
3. Manual on a phone: the tab strip scrolled away. Tabs and clock are now sticky, and switching tabs returns to the page top.
4. Wire tap targets were about 29 px with 31 px spacing (a mis-tap is an irreversible strike). Each wire now has its own hit area
   of at least 44 px (44–60 px measured at 360, 390, 844×390 and 1280).
5. A reloaded manual landed in the lobby with no role while the bomb's clock kept running. The role, tier and page now persist in
   `sessionStorage`, the manual rejoins, and the bomb pauses while the manual is away.
6. A right-click pressed sequence pads. Non-primary buttons are now ignored.
7. Manual table headers were about 10 px on phones. All text is now at least 11 px (a test sweeps every text node at 4 viewports).
8. The serial could contain I/O vowels that read like 1/0 aloud. Vowels are now A, E or U.
9. Found while building: a touch tap's follow-up click (detail 0) double-pressed sequence pads (false strikes). It is now routed
   once.
10. Found by verify: the manual opened already scrolled under its sticky bars; the relay drawer covered a landscape phone; module
    numbers disagreed between the two screens in 84 % of Rookie rounds; the correction slip changed the answer only about 35 % of
    the time. All are fixed and covered by tests.

## Tests

- `node tools/test/games/defuse.test.js all`: **ALL GOOD, 332 ok** (node, phone, wild, laptop, dark, layout, legacy), no page
  errors. It covers 7 unit files (classic 96, maze 326,453, morse 67, password 46,049, relay 27, switches 65, vent 36 assertions),
  round determinism, solving every module from the manual page's own data, full live rounds per tier on two iPhone-sized phones with
  real taps, the relay done on the manual device, the vent answered, a boom, the pause overlay, resume after the bomb closes, a
  manual reload, Today's bomb, records written once, layout and tap and text sizes at 390×844, 360×740, 844×390 and 1280×800, light
  and dark.
- `node tools/test/games/computer.test.js all`: **ALL GOOD, 117 ok** (the Defuse sections use the Classic tier; the cycles sections
  are untouched).
- `node tools/test/all-games.test.js`: ALL GOOD. The full build (`tools/build_artifact.py`) succeeds, 119 modules.
- Independent verify passes: two in round 1 (devices/netcode and rules/gameplay), then a second-round re-check.

Second-round verifier (fresh agent, after the fixes): confirmed every fix. It won full Rookie, Agent, Expert and Bomb Squad
rounds reading the rules **only from the manual's DOM** (no solver), on phones (light and dark), a 844×390 landscape phone, and a
laptop bomb with a phone manual. It answered the vent, committed the relay from the manual, and applied correction slips for maze,
password and switches. Edge cases checked: a strike while the button is held, surge plus tax, a decoy tapped during a blackout,
the vent during a blackout, a bomb reload with an unacknowledged relay commit, Today's bomb played twice, 20+ rematches, and tier
changes. It found three more problems, all now fixed with regression tests that fail on the old code:
- relay actions sent while the bomb was paused or dark were applied only on the manual's next tap;
- the lobby kept its scroll position after a rematch;
- an open relay drawer on a landscape phone left about 55 px for the guide. It is now capped at 30vh when the screen is under
  500 px tall, and the edition code no longer wraps.

## Known issues

- At 844×390 landscape the wire hit area is 44.03 px: it passes, but with almost no margin.
- The difficulty clocks come from a cost model, not from the couple's own play. Expect to tune them after a week of real rounds
  (they're in `TIERS` in `round.js`).
- The engine's own "best" for Defuse (core `gameRecord`) is still max(seconds left) across all tiers. Per-tier bests live in
  `api.data()`. The coordinator could show those instead if the hub ever surfaces Defuse records.
- If the bomb is on Sydney's device ('b') and Emerson's device closes within ~1.8 s of the round ending, that result may not be
  recorded (existing behaviour, host-only recording).

## README games-table line

Current: `| Defuse: one has the bomb, the other the manual | Live, co-op, two devices | Bomb on a computer, manual on a phone |`

Proposed: `| Defuse: one has the bomb, the other a manual that rewrites itself every round. Ten module types, five tiers, twists | Live, co-op, two devices | Bomb on a computer, manual on a phone |`

## Process

Opus directed. Sonnet subagents (high effort) did the survey, the five builds (framework, classic four, maze and password, morse and
switches, vent and relay), two verifiers, two fixers and a second-round verifier. One Fable subagent did the content check; its
top items (daily bomb, holder records, medals, named editions, blackout, golden module, couple lines, swap nudge, and its tuning
warnings) all shipped.
