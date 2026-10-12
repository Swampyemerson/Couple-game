# Defuse

Asymmetric co-op for two devices. One of you holds the **bomb** (best on a computer), the other reads the **manual** (best on a
phone). The bomb holder sees the bomb and never the rules; the manual reader sees the rules and never the bomb. Only things a
person can say out loud ever go on the bomb: colours, counts, letters, digits, named shapes, plate numbers, positions. It is a
communication game.

The one exception is the role-swap module (Relay): its **controls** are on the manual device and its **rule card** is on the bomb.

## Why it changed

The old game had a fixed manual, the same four modules in the same layout, and difficulty only changed the clock and the sequence
length. After ten rounds the bomb holder knew the rules by heart. Now **every round is a new edition of the rules** (except the
Classic tier), the module mix changes, and twists add red herrings, time pressure and role swaps.

## Files

```
js/games/defuse.js           registerGame, lobby, netcode, hosting of the modules, round loop, finale, manual shell
js/games/defuse/round.js     TIERS, TWISTS, REGISTRY, buildRound(seed, tier): the pure round
js/games/defuse/manual.js    the field guide as HTML strings (basics page, page chrome, tabs). Pure.
js/games/defuse/records.js   records: flat keys, tolerant reads, applyResult, medals, daily, couple lines. Pure.
js/games/defuse/css.js       base styles; every module adds its own css
js/games/defuse/util.js      seeded streams and helpers
js/games/defuse/classic.js   WIRES BUTTON KEYPAD SEQUENCE (fixed "classic" edition + seeded editions)
js/games/defuse/maze.js      MAZE          password.js PASSWORD     morse.js MORSE        switches.js SWITCHES
js/games/defuse/vent.js      VENT (needy)  relay.js  RELAY (remote, role swap)
tools/test/games/defuse.test.js          node + browser tests (this game)
tools/test/games/defuse/<id>.unit.mjs    one unit file per module, run by defuse.test.js
tools/test/games/computer.test.js        Defuse sections: Classic-tier regression through the old selectors
```

Files under `js/games/defuse/` import only each other (never `core.js`), so node can import them.

## The round

`buildRound(seed, tier)` is pure and deterministic. It uses named streams (`stream(seed, 'edge')`, `'rules'`, `'gen'`, ...) so adding
a draw in one place never shifts another. Both devices build the identical round from `{ seed, tier }`:

```
{ seed, tier, T, E /* edgework */, slots: [{ id, plate, decoy, dup, S }], book: { [id]: { R0, R, note } },
  ids /* distinct module types, guide order */, twists, twistRules, gold /* slot index or -1 */, name, edition }
```

* `R0` is the rule set as **printed** in the manual; `R` is the live rule set after a correction slip (`note`). The manual prints
  `page(R0)` plus the slip; `gen`, `solve` and `mount` use `R`.
* `S` is the puzzle on that slot (JSON, a few hundred bytes).
* `name` is a seeded two-word name ("Sleepy Koala", 40 adjectives x 40 animals) printed on the serial sticker and on the manual's
  basics page, so you can check you hold the same guide. `edition` is a short rules fingerprint ("Ed. 7K-3"; "Ed. C-1" for Classic).

### Edgework

Serial (6 characters, the last is a digit; vowels A E I O U), 0 to 4 batteries, two indicators from `RDY PWR AUX LNK SYS CLR IGN MSA`
(Classic uses the first five), and from level 2 (Agent) and up a **port plate** with 0 to 3 of `DVI PS2 RJ45 SERIAL`.
The VOID twist adds a second serial stamped VOID and an extra crossed-out lamp.

### Tiers

| key | label | clock | modules | twists | notes |
|---|---|---|---|---|---|
| `classic` | Classic | 5:00 | wires, button, keypad, sequence, fixed order | 0 | today's game and today's guide text, for regression |
| `chill` | Rookie | 6:00 | 3 | 0 | seeded rules, simpler templates (level 1) |
| `normal` | Agent | 5:00 | 4 | 1 | default (level 2) |
| `spicy` | Expert | 5:30 | 5 + vent | 2 | level 3 |
| `wild` | Bomb Squad | 6:00 | 6 + vent | 3 | level 4, tax always on |

Expert and Bomb Squad have more modules, a vent and more twists than Agent, so their clocks are longer (a load estimate put the old
4:30 / 4:00 clocks at 119 % and 150 % of the time a careful pair needs). The keys `chill`, `normal`, `spicy` keep their old meaning in memory and presence. Every non-Classic tier draws at least one classic
module and at least one new one; no duplicates except through the Twin twist. Slots are shuffled; the vent is always last. The
relay and a twin each take one of the tier's draws, so a bomb has at most seven slots.

### Twists

| twist | kind | what |
|---|---|---|
| Twin modules (decoy) | red herring | One module type appears twice. Every module has a stamped 3-digit plate. The manual's rule 1 says which plate is live (lower / higher / even last digit / odd last digit / shares a digit with the serial). Touching the other one is a strike (debounced 0.7 s). |
| VOID sticker | red herring | A second serial stamped VOID and a crossed-out lamp. The manual says to ignore VOID. |
| Correction slip (errata) | red herring | One module page has a taped slip at the top that changes one rule. |
| Surge | time | Twice, the clock runs x2 for 12 s. Banner and countdown on both clocks. Never in the first or last 30 s. |
| Strike tax | time | Each strike takes 30 s off the clock and does **not** also speed it up. |
| Blackout | comms | Once or twice: "going dark" for 2 s, then the module area is dark for 5 s and input is ignored. Never overlaps a surge. |
| Role swap (relay) | role swap | The Relay module: controls on the manual, rule card on the bomb. |
| Vent | pressure | A needy module. A tier property for Expert and Bomb Squad, a twist for Agent. |

Timed events are scheduled as "seconds left on the clock", drawn from the seed, and checked in node never to overlap each other
or the first/last 30 s.

**Golden module**: about one round in twelve (not Classic) one non-twin, non-needy module is gold: gold plate on the bomb, gold
tab on the manual. Solve it without a strike on that module for +20 s.

**Correction slip (errata).** A slip only appears when it changes this bomb's answer. After the errata module's puzzle is built, the
round compares its answer under the slipped rules with its answer under the printed rules; if they agree it draws the puzzle again
(up to 12 times, with extra stream keys `gen|<id>|main|try|<k>`, so the round stays deterministic and a round without a retry is
unchanged). If a module cannot make the slip matter, the next module is tried; if none can, the slip is swapped for another twist.
Node test: over 500 seeds per tier at least 95 % of errata rounds (in practice all) have differing answers.

**Serials** use only the vowels A, E and U (O and I sound like 0 and 1 when read aloud). The manual's vowel rule is unchanged.

The manual's basics page lists this round's twists in a "This bomb" box (the decoy rule first). The bomb holder is never told
about red herrings.

## Modules

Each module file exports one const with `id, name, tab, tiers, needy, remote, css, rules, errata?, page, gen, solve, mount, drive?`
(see `docs/updates/` notes or the file headers). `page(R0)` is the only place the rules are written and marks data with `data-*`
attributes so tests solve from the page. `mount(box, S, R, host)` judges and calls `host.strike` / `host.solve`.

| id | module | notes |
|---|---|---|
| wires, button, keypad, sequence | the classic four | Classic = the fixed rules; other tiers draw rule templates |
| maze | Maze | route through a grid from described markers |
| password | Password | letter wheels, one word fits |
| morse | Signal Lamp | decode a blinking word, tune the frequency |
| switches | Breaker Panel | five switches, set from a status light code |
| vent | Vent (needy) | wakes with a question and a 2-digit reading; YES / NO from the manual's rule; wrong or late is a strike. Never solved, not counted |
| relay | Relay (remote) | manual holds the controls, bomb holds the rule card |

## Netcode

Presence `v: 2`. In the lobby each device publishes role, the shared tier (`diff`, plus `td` for Today's bomb; last writer wins by
the `dv`/`dw` counter, ties to `b`), a swap token and a start token. The bomb device is authoritative:

| field | meaning |
|---|---|
| `n` `sd` `rd` | round id, seed, tier key |
| `left` `rate` `st` | ms on the clock, effective clock rate (strike step x surge), strikes |
| `sv` | one char per slot: `1` solved, `0` open, `d` decoy, `n` needy |
| `sg` `bo` `vn` | surge seconds left, blackout phase (1 warning, 2 dark), vent awake |
| `rs` | relay live state |
| `pz` `pr` | paused and why (`gone` `bg` `lobby` `me`) |
| `res` `win` `fx` | result, win flag, finale extras (couple line, medal) |

The manual publishes `ra`: its last 8 relay actions with unique ids. The bomb applies new ids through `RELAY.step` (authoritative)
and publishes `rs`. The manual rebuilds the round from `{ sd, rd }`. Presence stays under 3.5 KB (about 0.8 KB in practice).

The engine only records results sent by the host (`a`), so when the bomb is on `b` it also sends a `result` event. Results keep the
old shape `{ team: true, score: secsLeft, text, sub }`.

**Pause.** The bomb's clock stops while the partner is away, has the app in the background, or has gone back to the lobby for more
than 1.5 s. Both screens say so ("Paused. Sydney has the game in the background."). **Resume.** If the bomb device closes and reopens
the game mid-round, the round resumes from `memo.saved` (clock, strikes, solved slots, and each module's `save()`). A reloaded
manual restores role, tier and page from `sessionStorage` and rejoins the round.

## UI notes

* Bomb on a laptop (1100 px and up): side panel (clock, strikes, SURGE / VENT / BLACKOUT flags, serial, name, batteries, indicators,
  ports) that is **sticky** beside a grid of 3 columns (3, 5, 6 modules) or 2 columns (4 modules); the vent is a full-width strip, so
  the clock never scrolls out of view. Bomb on a phone or a landscape phone / tablet (under 1100 px): one or two columns with a **sticky
  top bar** (clock, strikes, flags) because the hold-button depends on the timer digit.
* Every screen starts at the top: the lobby's Start tap scrolls the page on a phone, and the manual and the bomb reset it when they open.
* Manual on a phone: sticky clock bar and a sticky, horizontally scrolling tab strip (Basics pinned first, each tab is the module's
  plate number with its short name under it, or the module number on a bomb without plates; twin types show "x2" so the plate rule still has to be used). Switching tabs scrolls the
  page back to the top. The relay box is a sticky, collapsible drawer at the bottom, closed by default unless the window is at least 760 px wide and 700 px
  tall (a landscape phone would lose its tabs under it), and capped at 45 % of the height with its own scroll. A VENT lamp lights when the vent wakes so the
  reader can nag.
* Input is routed to the module that owns the target. A module that acts on pointerdown never gets the click that follows it.
  Non-primary buttons are ignored.
* Light and dark come from tokens; reduced motion is respected; every control is at least 44 px.

**Numbering.** Every module on the bomb is tagged with its slot number ("3 · Maze"). The manual's tabs and pages follow the bomb's order
(first appearance of each module type), and a page's heading number and run-head ("Module 3", or "Modules 2 and 5" for a twin pair,
plus the plate number) are that slot number, so "Module 3" means the same thing on both screens. Tabs carry `data-n`. The footer
"Read every rule in order. Stop at the first that applies." appears only on the wires and button pages; step-by-step pages say "Work
through the steps in order."; the others have no footer line.

## Records, medals and fun

Per-game data (`api.data()` / `api.setData(patch)`) only stores flat keys with number / string / boolean values, so records are:
`wins booms streak bestStreak`, `best_<tier>` (seconds left) with `bestWho_<tier>` and `bestAt_<tier>`, `medal_<tier>` (0 to 3, never
goes down), `clean_<tier>`, `holder_<a|b>_wins|booms|clean`, `manual_<a|b>_rounds|strikes`, `mods_<id>`, `daily_<date>_<tier>_<a|b>`
(seconds left, 0 = boom) and `log` (JSON string, last 8 rounds). Reads accept a missing doc, `{}`, wrong types, a bare-number best, and
nested or dotted shapes. Written once, by the bomb device, when the round ends.

* **Medals** per tier, no locks: 1 defuse, 2 zero strikes, 3 zero strikes with more than half the clock left. Pips on the tier buttons;
  the end card names the next medal.
* **Records strip** in the lobby: streak, best on the selected tier with who held the bomb ("Best on Agent: 2:10 left (Sydney's
  hands)", one line), defused total, the last rounds as chips. Log entries from an unknown tier are dropped and their seconds are
  clamped to the tier's clock plus a minute. "New record!" and near-miss lines on the end card.
* **Today's bomb**: a lobby switch. Seed `day-YYYY-MM-DD` (UTC date picked by the bomb device) plus the tier: the same bomb for both of you, today only. The holder's first attempt of the day is stored; the lobby shows "Today (Agent): Sydney 1:40 left, Emerson -".
* **Couple delight**: a zero-strike win adds one of twenty sweet / playful lines to the stamp. After three rounds with the same bomb
  holder the lobby nudges "Swap?" (a nudge only).

## Tests

```
node tools/test/games/defuse.test.js [node|phone|wild|laptop|dark|legacy|all]    SHOTS=/dir PORT=9100
node tools/test/games/computer.test.js phone                                     Defuse regression with the Classic tier
```

* **node**: runs every `tools/test/games/defuse/*.unit.mjs`, then round-level tests: determinism (200 seeds x 5 tiers, JSON-equal on
  rebuild), tier module and twist counts, classic is fixed, rules vary between seeds, every module solvable, decoy / VOID / slip /
  schedule / gold / name checks, the manual builds for every round (slip on top, decoy rule first, every twist listed), presence size,
  the errata slip changes the answer (500 seeds x 3 tiers), bomb tag number = tab number = page number for every module type
  (200 seeds x 5 tiers), the footer rule, serial vowels, and the records functions with older and odd shapes.
* **phone** (9100): lobby, a full Agent round with a decoy, records, the Classic guide solved from the manual's own DOM, a boom,
  Today's bomb, the pause overlay on both devices, resume after the bomb closes and reopens.
* **wild** (9101, 9107): Bomb Squad with the relay done on the manual, tax, surge, the vent answered, 360 px layouts and tap sizes;
  blackout, golden module, couple line, swap nudge, a reloading manual; Rookie and Expert full rounds.
* **laptop / dark** (9102 to 9105): laptop bomb with a phone manual, light and dark, screenshots.
* **legacy** (9106): older nested data and an invalid log, plus the one-device card.

Test hooks (only when `navigator.webdriver`): `window.__defuse.info()` (phase, role, round, slot states, clock, flags),
`gen(seed, tier)`, `drive(slot)` (the module's `drive()` list scoped to that slot), `force(seed)` (the next round's seed),
`setLeft(ms)`, `saveOf(slot)`, `records()`.
