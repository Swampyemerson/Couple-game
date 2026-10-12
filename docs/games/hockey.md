# Air Hockey

Code: `js/games/hockey.js` (the game), `js/games/hockey/physics.js` (pure physics + table rules),
`sound.js` (WebAudio synths), `setup.js` (the table picker), `records.js` (api.data records and the
rivalry line). Tests: the hockey parts of `tools/test/games/live.test.js` (`GAME=hockey PORT=9100 node tools/test/games/live.test.js`).

## Play
- **One phone**: split table, every finger belongs to the half it started on. The first finger on a
  half drives that half's mallet. Extra fingers on that half wait; when the first lifts, control
  slides (180 u/s, no slam) to the next one that is still down.
- **Two phones**: you always see your own goal at the bottom. **Laptop**: W A S D against the arrows
  (table sideways) or, live, the mouse. Enter starts the picked table.
- **Power curve.** A *still* mallet bounces the puck back at full restitution. A *moving* mallet's
  push is scaled down with its speed (`transferScale`: full at 0, half from 60 u/s up), so the puck
  leaves at about 0.9 x mallet speed: a slow push is a soft pass, a 165 u/s swipe a firm one, and the
  300 u/s cap needs a flick of about 330 u/s (about 2x the old saturating speed, which was 167).
  `MALLET_MAX` is 440 so a flick can get there; the keyboard top speed is 235.
- **Shot clock (stall breaker).** A puck that stays on one half (or crawls below 25 u/s) for 6 s gets a
  3-2-1 ring from 3 s. At 0: "HOG!" stamp, the puck goes back to the centre and is served to the
  *other* player. A puck squeezed between both mallets for 0.5 s ("RESET") is served from the centre
  to a random player. Per puck on Twin Pucks.

## Tables (the picker)
Before each match the host (or the single phone) picks. The guest sees "Emerson is picking…" and the
chosen chip live. The last pick (`hockey_last`, a table id or `surprise`) is preselected; Rematch
remounts the game, so "one more" is just GO. Chips are >= 56 px tall, GO is 54 px.

| id | rule |
|---|---|
| classic | the original table, first to 7 |
| pillar | a 6.5 u round post in the centre (restitution like the walls, a "bonk" sound). Mallets can't enter it; a puck pinned between a mallet and the post pushes the mallet back. The puck serves from beside it |
| twin | two pucks (ink and yellow). A goal with either counts; that puck re-serves from the centre ~1.65 s later while the other keeps playing |
| shrink | each goal you score makes your opponent's goal 2 u narrower (half-width, 16 down to 10): the trailing player has the bigger target |
| power | each alternating rally hit speeds the puck up +6 % (up to +60 % at 10 hits), cap 375 u/s; reset on a goal. The trail pulses yellow then red as it heats |
| quick | sudden death, first to 3 |

## Drama kit
Rally counter (4+), "RALLY n!" sticker (8+); "POST!" stamp and a clang when the puck bounces off the
goal frame within 6 u of the mouth; a match-point banner and a tag by the score (at toWin - 1, also
"double match point"); one slow-mo per point (0.5x for 400 ms) when the puck enters the defending
third heading at goal at match point (host only, the guest follows `ts` from the stream); a comeback
line when the winner was down by 3+ (a COMEBACK! stamp during the last goal, and the rivalry line).

## Netcode
The host simulates at 120 Hz and streams ~25/s via presence (stamped on the shared clock):
`ph` phase (`setup` `count` `play` `goal` `paused` `over`), `tb` table (the picker's selection while
in `setup`, which may be `surprise`; the real table after GO), `pk` = `[x,y,vx,vy,on,epoch,shotClockMs]`
per puck, `m` host mallet, `s` score, `g` goal count, `h` hit counters, `ry`/`lh` rally and last hitter,
`ts` time scale, `ev` the last five events `[n, code, x, y, extra]` (1 post, 2 hog, 3 reset, 4 rally
record, 5 fastest goal, 6 slow-mo, 7 table intro, 8 comeback). The table choice and events ride in the
same stream, so a dropped message heals itself. The guest mirrors `tb`/`keep` so a host that reloads
mid-match re-adopts the table and score.
- **Guest puck correction (B2).** The guest draws each puck ahead of the host state by age + lead. A new
  state re-bases the displayed puck so nothing jumps (offset = shown - new trajectory); the offset
  then decays (about 60 ms time constant) at no more than 700 u/s. Only a reset (new puck epoch, a
  phase change) or an error over 160 u snaps. The test measures per-frame jumps at latency 120 and 20 %
  loss: under 25 u.
- Sounds: mallet (`api.sfx('hit')`), rail (dry tock), Pillar (low bonk), goal frame (clang), plus
  buzzer, record arpeggio, match-point notes, slow-mo whoosh.

## Data keys (api.data, `gamedata/hockey`)
Written only by the deciding device (host online, the single phone locally).
`hockey_last` last pick; `hk_rally_best` + `hk_rally_who` longest rally (alternating hits; who scored it);
`hk_fast_ms` + `hk_fast_who` fastest goal from the serve in ms (lower is better, so no `_best`/`_n`
suffix); `hk_shutout_a_n` / `hk_shutout_b_n` matches won to nil; `hk_comeback_a_n` / `hk_comeback_b_n`
matches won after trailing by 3+; `hk_streak_who` + `hk_streak_len` current win streak and `hk_streak_best`.
The picker shows rally / fastest goal / streak; the end card's `sub` is the rivalry line:
`7–4 · Pillar table · COMEBACK from 3 down · Emerson on a 3-match streak (a new best)`.
`api.finish({ winner, score: { a, b }, sub })`.

## Testing
`GAME=hockey PORT=9100 SHOTS=<dir> node tools/test/games/live.test.js`. `window.__hockeyTest` (dev
server only): `state()`, `start(tableId)` (skip the picker), `pick(id)`, `score(w)`, `place(x,y,vx,vy,puckIndex)`,
`setRally(n, who)`, `toClient(x,y)`, `stamps()`, `events()`, `goals()`.
