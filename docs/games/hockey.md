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
  leaves at about the mallet's own speed: a slow push is a soft pass (a 100 u/s finger, about 350 px/s
  on a phone, gives ~105 u/s), a firm swipe (~500 px/s) ~150-200, and the 300 u/s cap needs a flick of
  about 330 u/s (about 1100 px/s; 2x the old saturating speed of 167). `MALLET_MAX` is 440 so a flick
  can get there; the keyboard top speed is 235.
  The mallet's speed is `distance / real frame time` (`rdt` in `simulate`/`guestUpdate`), not
  `distance / (substeps * DT)`: the substep count wobbles 1-2-3 between frames, which used to double a
  push now and then (a 100 u/s swipe randomly became a 200 u/s shot).
  The mallet's *hitting* velocity is the frame's displacement over real time, low-passed (`smoothVel`,
  `VEL_SMOOTH` = 40 ms): a 60 Hz digitiser under a 120 Hz screen (or any dropped touch sample) alternates
  0x and 2x displacement frames, and unsmoothed a hit on a 2x frame was twice as hard as the finger
  moved (a steady 104 u/s push gave a median ~190 u/s peak, often the 300 cap; now median ~118).
- **Shot clock (stall breaker).** A puck that stays on one half (or crawls below 25 u/s) for 6 s gets a
  3-2-1 ring from 3 s. At 0: "HOG!" stamp, the puck goes back to the centre and is served to the
  *other* player (the stamp has the centre to itself for 1 s, then the 3-2-1 runs: `STALL_MS`). A puck squeezed between both mallets for 0.5 s ("RESET") is served from the centre
  to a random player. Per puck on Twin Pucks.

## Layout: scoreboard bands and the centre lane
- **Bands.** The physics aspect (100 x 170) never changes, so a tall phone (390x844 leaves ~160 px, 430x932
  ~200 px) uses the spare space for two printed scoreboard cards, one past each goal end: big score
  numeral in the player's ink, name, table name + "FIRST TO n" (swapped for a bobbing MATCH POINT flag
  at match point), the live rally counter (yellow from 8) and the rally record to beat ("BEST 12 · SYDNEY",
  from `hk_rally_best`/`hk_rally_who`). Online, your card is at the bottom and the opponent's at the top,
  both upright for you; on one phone the far card is turned round to face its player. In landscape
  (844x390) they are narrow vertical cards left and right of the table (left = the player defending
  the left goal). They are drawn only when the free strip is at least ~66 px (portrait) / ~58 px
  (landscape), so 360x640, 375x667 and 390x664 get the plain table, whose on-table score numerals
  are hidden whenever a band shows. The bands sit inside the rig, which already clears the immersive
  corner stickers and the safe areas. `drawBandStatic` prints the card and halftone into the cached
  table layer; `drawBandText` draws the live text every frame.
- **Centre lane.** Everything printed in the middle (GOAL stamp, 3-2-1, RALLY RECORD / FASTEST GOAL /
  COMEBACK / HOG! / RESET stamps, the table-name and MATCH POINT banners) is a lane item with a height,
  and `render` stacks them outward from the centre spot (never on the parked puck): one reader uses both
  sides, a shared phone keeps each player's copy on their own half. Nothing overlaps by construction.
  The "Drag your mallet" hint (and the keyboard legend) fades out (50 ms) while the lane, a POST!
  stamp or a shot-clock ring is up, and fades back (180 ms) until the first touch.
  Banners wait for the real countdown (`left <= COUNT_MS + 400`), so a HOG! stamp is never under them.

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
- **The guest's mallet on the host.** The host extrapolates the newest sample up to 100 ms and blends a
  new sample's offset away over ~70 ms (`REMOTE_LEAD`, `REMOTE_BLEND`), so the mallet moves at the
  guest's finger speed. Without it the host saw 0 ... 300 u/s spikes between samples and a soft guest
  pass became a slap (test: `hockeyGuestMallet`).
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
`setRally(n, who)`, `toClient(x,y)`, `stamps()`, `events()`, `goals()`. `state()` also reports `centre` (the
lane items on screen this frame), `hint` (0..1 fade of the hint) and `band` (`'h'` / `'v'` / null).
