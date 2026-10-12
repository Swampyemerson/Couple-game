// Knucklebones: a quick dice duel. Each turn a d6 is rolled for you and you place it in one of
// your three columns. Matching dice multiply (value × count²), and placing a die knocks every die
// of the same value out of your opponent's facing column. Ends the moment a grid fills.
//
// Rules are pure: move = { col }. The roll for turn n is randInt(6, seed, 'roll', n) + 1, so both
// phones always see the same die. The 3D tumble is view-only.
import { registerGame, randInt, gameDataApi } from './core.js';

// ── rules ─────────────────────────────────────────────────────────────
const ROWS = 3;
const COLS = 3;
const other = (w) => (w === 'a' ? 'b' : 'a');
const rollFor = (seed, n) => randInt(6, seed, 'roll', n) + 1;

// Twists. A match starts classic. The player who goes first may, before their first die, send one
// setup move { tw: '<id>' } (it doesn't pass the turn); playing a die instead keeps the match
// classic for good. Old logs never contain a setup move, so they replay exactly as they always did.
//   golden: one seeded column is gilded for both players and scores double
//   mirror: you both draw from the same dice, dealt in a different order. A round is five dice each: the
//           starter takes them in order and the other player starts two places along (3 4 5 1 2), so nobody
//           is handed the twin of the die just played against them. It is not an exact copy: a match ends
//           part-way through a round in about three matches of four, so the last die or two can differ.
//           (The same die in two turns running gave the second player 85% of the games; X Y / Y X, which
//           still had a twin right after Y, was 44% starter wins with random bots and 51% with greedy.
//           The five-dice round: 51% and 52%. See docs/games/bones.md.)
//   blind:  you pick a column before you see the roll (rules as classic; the view hides the die)
//   oracle: both players see the next two rolls (rules as classic; the view shows them)
// Every twist also plays the Last Word rule: if the starter fills their grid first, the other
// player gets one last die, so both have placed the same number of dice. That last die lands
// softly (it doesn't smash) except in Mirror Dice. Bot self-play: with a normal last die the
// second player became the favourite (43-45% for the starter); the soft landing evens that out
// (see docs/games/bones.md and `threed-bones.test.js --balance`).
const TWISTS = {
  classic: { name: 'Classic', hint: 'The original rules.' },
  golden: { name: 'Golden Column', hint: 'One column scores double.' },
  mirror: { name: 'Mirror Dice', hint: 'Same dice, different order.' },
  blind: { name: 'Blind Draw', hint: 'Pick before you see the roll.' },
  oracle: { name: 'Oracle', hint: 'See the next two rolls.' },
};
const TWIST_IDS = ['golden', 'mirror', 'blind', 'oracle'];
const twisted = (s) => !!s.tw && s.tw !== 'classic';
/** The die for turn n under this match's rules. */
function rollAt(s, n) {
  if (s.tw === 'mirror') { // the starter (even turns) takes a round's five dice in order; the other player starts two along
    const i = (n >> 1) % 5;
    return rollFor(s.seed, Math.floor(n / 10) * 5 + (n % 2 ? (i + 2) % 5 : i));
  }
  return rollFor(s.seed, n);
}

/** Column score: each value counts value × count × count (4,4 = 16; 4,4,4 = 36; 3,4 = 7). */
function colScore(col) {
  const c = {};
  for (const v of col) c[v] = (c[v] || 0) + 1;
  let t = 0;
  for (const v of Object.keys(c)) t += Number(v) * c[v] * c[v];
  return t;
}
/** What a column is worth, counting the gilded column of a Golden Column match (×2). */
const colPts = (col, i, gold) => colScore(col) * (i === gold ? 2 : 1);
const gridScore = (g, gold) => g.reduce((t, col, i) => t + colPts(col, i, gold), 0);
const gridFull = (g) => g.every((col) => col.length >= ROWS);

function init({ first, seed }) {
  const turn = first === 'b' ? 'b' : 'a';
  return {
    seed, turn, n: 0, roll: rollFor(seed, 0),
    grids: { a: [[], [], []], b: [[], [], []] }, last: null, over: false,
    // additive facts for commentary and records (never read by the rules)
    first: turn, big: { pts: 0, who: null, n: -1 }, deficit: { a: 0, b: 0 }, wipes: { a: 0, b: 0 }, trips: { a: 0, b: 0 }, cb: { a: 0, b: 0 },
  };
}
function next(s) { return s.over ? [] : [s.turn]; }
function setup(s, who, mv) {
  if (s.n !== 0 || s.tw !== undefined) throw new Error('Twists are picked before the first die.');
  if (typeof mv.tw !== 'string' || (mv.tw !== 'classic' && !TWIST_IDS.includes(mv.tw))) throw new Error('That twist isn’t in this version of the game.');
  s.tw = mv.tw;
  if (mv.tw === 'golden') s.gold = randInt(3, s.seed, 'gold');
  // the starter has already watched the first die tumble: a blind match throws a fresh one that nobody has seen
  if (mv.tw === 'blind') s.roll = randInt(6, s.seed, 'blind', 0) + 1;
  return s;
}
function apply(s, who, mv) {
  if (s.over) throw new Error('The game is over.');
  if (who !== s.turn) throw new Error('Hold on, it’s not your turn.');
  if (mv && typeof mv === 'object' && 'tw' in mv && !('col' in mv)) return setup(s, who, mv);
  const col = mv ? mv.col : undefined;
  if (!Number.isInteger(col) || col < 0 || col >= COLS) throw new Error('Pick one of your three columns.');
  const mine = s.grids[who][col];
  if (mine.length >= ROWS) throw new Error('That column is full. Pick another one.');
  const opp = other(who);
  const gold = s.gold;
  const lead0 = gridScore(s.grids[who], gold) - gridScore(s.grids[opp], gold);
  const mineWas = colPts(mine, col, gold);
  const value = s.roll;
  mine.push(value);
  const before = s.grids[opp][col];
  const soft = s.final && s.tw !== 'mirror'; // the last word lands softly: no smash
  const after = soft ? before : before.filter((v) => v !== value);
  s.grids[opp][col] = after;
  const pts = colPts(before, col, gold) - colPts(after, col, gold);
  const gain = colPts(mine, col, gold) - mineWas;
  const same = mine.filter((v) => v === value).length;
  const destroyed = before.length - after.length;
  s.last = { who, col, value, n: s.n, oppBefore: before.slice(), destroyed, pts, gain, triple: same === 3, wipe: destroyed === ROWS };
  // facts for commentary and records
  if (pts > s.big.pts) s.big = { pts, who, n: s.n };
  if (destroyed === ROWS) s.wipes[who] += 1;
  if (same === 3) s.trips[who] += 1;
  const diff = gridScore(s.grids.a, gold) - gridScore(s.grids.b, gold);
  s.deficit.a = Math.max(s.deficit.a, -diff);
  s.deficit.b = Math.max(s.deficit.b, diff);
  const lead1 = who === 'a' ? diff : -diff;
  if (lead0 < 0 && lead1 > 0 && s.deficit[who] >= 15 && !s.cb[who]) { s.cb[who] = 1; s.last.comeback = true; }
  s.n += 1;
  let over;
  if (!twisted(s) || s.lw === false) over = gridFull(s.grids.a) || gridFull(s.grids.b); // (s.lw === false: balance tests only)
  else if (s.final) over = true; // the last word has been said
  else if (gridFull(s.grids[who]) && who === s.first) { // the starter filled up first: the other player answers
    s.final = true;
    over = false;
  } else over = gridFull(s.grids[who]);
  if (over) { s.over = true; s.roll = null; } else { s.turn = opp; s.roll = rollAt(s, s.n); }
  return s;
}
function result(s) {
  const a = gridScore(s.grids.a, s.gold);
  const b = gridScore(s.grids.b, s.gold);
  if (a === b) return { winner: null, text: 'Dead even', sub: `${a} apiece. Rematch?` };
  const w = a > b ? 'a' : 'b';
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const m = hi - lo;
  const score = `${hi} to ${lo}.`;
  const down = s.deficit ? s.deficit[w] : 0;
  const bigPts = s.big ? s.big.pts : 0;
  let line = score;
  if (m <= 3) line = `${m === 1 ? 'Won by 1! ' : ''}${score} So close — rematch?`;
  else if (down >= 15) line = `${score} Comeback from ${down} down.`;
  else if (bigPts >= 20) line = `${score} Wiped ${bigPts} in one go.`;
  else if (s.trips && s.trips[w] > 0) line = `${score} A triple stack paid off.`;
  return { winner: w, sub: line };
}
function score(s) { return { a: gridScore(s.grids.a, s.gold), b: gridScore(s.grids.b, s.gold) }; }

// ── view helpers ──────────────────────────────────────────────────────
const PIPS = {
  1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]], 6: [[0, 0], [1, 0], [2, 0], [0, 2], [1, 2], [2, 2]],
};
const pipHTML = (v) => (PIPS[v] || []).map(([r, c]) => `<i style="grid-area:${r + 1}/${c + 1}"></i>`).join('');
const dieHTML = (v, cls = '', extra = '') => `<span class="gb-die ${cls}" data-v="${v}"${extra}>${v === '?' ? '<em class="gb-qm">?</em>' : pipHTML(v)}</span>`;
const noop = () => {};
const SLOW_3D_MS = 8000; // how long to wait for three.js before switching to flat dice
const DEAD = { dead: true };

let probe = null;
function rgbOf(css, fb) {
  const s = String(css || '').trim() || fb;
  try {
    if (!probe) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      probe = c.getContext('2d', { willReadFrequently: true });
    }
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = fb;
    probe.fillStyle = s;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  } catch { return [0.5, 0.5, 0.5]; }
}
const cssOf = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
function readPalette(api) {
  const t = api.tokens();
  return {
    a: rgbOf(t.a, '#2f5bea'), b: rgbOf(t.b, '#f0428b'), card: rgbOf(t.card, '#ffffff'),
    ink: rgbOf(t.ink, '#1d1b22'), hl: rgbOf(t.hl, '#ffd23f'),
  };
}
const easeOut = (k) => 1 - (1 - k) ** 3;

// ── the 3D dice tray ──────────────────────────────────────────────────
// Material order of a BoxGeometry is +x, -x, +y, -y, +z, -z. Opposite faces sum to 7.
const FACE_VALUES = [2, 5, 1, 6, 3, 4];
// Euler rotation that turns each value's face to the top (+y).
const FACE_UP = { 1: [0, 0, 0], 6: [Math.PI, 0, 0], 2: [0, 0, Math.PI / 2], 5: [0, 0, -Math.PI / 2], 3: [-Math.PI / 2, 0, 0], 4: [Math.PI / 2, 0, 0] };
const CAM_FOV = 28;
const CAM_DIST = 4.5;
const CAM_EL = 55 * Math.PI / 180;
const CAM_TARGET_Y = 0.45;

function dieView3D(THREE, canvas, pal0, onTick) {
  let pal = pal0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  let ratio = Math.min(2, window.devicePixelRatio || 1);
  let W = 1; let H = 1;
  renderer.setPixelRatio(ratio);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 60);
  let dist = CAM_DIST;
  function placeCam() {
    cam.position.set(0, CAM_TARGET_Y + dist * Math.sin(CAM_EL), dist * Math.cos(CAM_EL));
    cam.lookAt(0, CAM_TARGET_Y, 0);
  }
  placeCam();
  const amb = new THREE.AmbientLight(0xffffff, 0.5);
  const sun = new THREE.DirectionalLight(0xffffff, 0.62);
  sun.position.set(0.4, 1, 0.6);
  scene.add(amb, sun, sun.target);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const edgeGeo = new THREE.EdgesGeometry(box);
  const plane = new THREE.PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2);
  const faces = FACE_VALUES.map((v) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    return { v, c, tex: new THREE.CanvasTexture(c) };
  });
  const mats = faces.map((f) => new THREE.MeshLambertMaterial({ map: f.tex, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  const hullMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
  const lineMat = new THREE.LineBasicMaterial();
  const shadowMat = new THREE.MeshBasicMaterial();
  const die = new THREE.Group();
  const mesh = new THREE.Mesh(box, mats);
  const hull = new THREE.Mesh(box, hullMat);
  const lines = new THREE.LineSegments(edgeGeo, lineMat);
  die.add(hull, mesh, lines);
  const shadow = new THREE.Mesh(plane, shadowMat);
  scene.add(shadow, die);
  die.visible = false;
  shadow.visible = false;

  const qFinal = new THREE.Quaternion();
  const qSpin = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const qFace = {};
  for (const v of Object.keys(FACE_UP)) qFace[v] = new THREE.Quaternion().setFromEuler(new THREE.Euler(...FACE_UP[v]));
  const UP = new THREE.Vector3(0, 1, 0);
  const st = { mode: 'idle', t: 0, dur: 1, sx: 0, sz: 0, axis: new THREE.Vector3(1, 0, 0), total: 0, yaw: 0, bounce: 0, scale: 1, res: null, calm: false };
  const BT = [0, 0.3, 0.56, 0.74, 0.86, 1];
  const BH = [1.1, 0.42, 0.15, 0.05, 0];

  function drawFace(f) {
    const g = f.c.getContext('2d');
    g.fillStyle = cssOf(pal.card);
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = cssOf(pal.ink);
    for (const [r, c] of PIPS[f.v]) {
      g.beginPath();
      g.arc(32 + c * 32, 32 + r * 32, 12, 0, Math.PI * 2);
      g.fill();
    }
    f.tex.needsUpdate = true;
  }
  function setPalette(p) {
    pal = p;
    renderer.setClearColor(new THREE.Color(p.card[0], p.card[1], p.card[2]), 1);
    hullMat.color.setRGB(p.ink[0], p.ink[1], p.ink[2]);
    lineMat.color.setRGB(p.ink[0], p.ink[1], p.ink[2]);
    faces.forEach(drawFace);
  }
  setPalette(pal);

  function outline() { // ink outline thickness in world units at the die (≈ 2.2 CSS px)
    const visH = 2 * dist * Math.tan(CAM_FOV * Math.PI / 360);
    return 2.2 * visH / H;
  }
  function pose(x, h, z) {
    const q = die.quaternion;
    // half the die's height along world y for this orientation, so a corner never sinks into the floor
    const half = 0.5 * (Math.abs(2 * (q.x * q.y + q.w * q.z)) + Math.abs(1 - 2 * (q.x * q.x + q.z * q.z)) + Math.abs(2 * (q.y * q.z - q.w * q.x)));
    const s = st.scale;
    die.position.set(x, half * s + h, z);
    die.scale.set(s, s, s);
    const o = outline();
    hull.scale.set(1 + 2 * o, 1 + 2 * o, 1 + 2 * o);
    shadow.position.set(x + 0.13 * s, 0.003, z + 0.13 * s);
    const sh = Math.max(0.55, 1 - h * 0.22) * s;
    shadow.scale.set(sh, 1, sh);
    shadow.rotation.y = st.yaw;
  }

  return {
    kind: '3d',
    resize(w, h) {
      W = Math.max(1, w); H = Math.max(1, h);
      renderer.setSize(W, H, false);
      cam.aspect = W / H;
      cam.updateProjectionMatrix();
      const o = outline();
      hull.scale.set(1 + 2 * o, 1 + 2 * o, 1 + 2 * o);
    },
    get ratio() { return ratio; },
    /** Pull the camera back (k > 1) so the die is smaller in a tall band. */
    setZoom(k) { dist = CAM_DIST * k; placeCam(); const o = outline(); hull.scale.set(1 + 2 * o, 1 + 2 * o, 1 + 2 * o); },
    setRatio(r) { ratio = r; renderer.setPixelRatio(r); renderer.setSize(W, H, false); },
    setPalette,
    compile() {
      const vis = die.visible;
      die.visible = shadow.visible = true;
      renderer.compile(scene, cam);
      die.visible = shadow.visible = vis;
    },
    restore() { setPalette(pal); renderer.setPixelRatio(ratio); renderer.setSize(W, H, false); this.compile(); },
    /** Tumble in and land showing `value`. Resolves when it lands. */
    roll(value, who, yaw, calm) {
      if (st.res) st.res();
      return new Promise((res) => {
        const from = who === 'top' ? 1 : -1; // bottom player's die comes in from the near left
        st.mode = 'roll'; st.t = 0; st.calm = calm; st.res = res; st.bounce = 0;
        st.dur = calm ? 0.22 : 1.05;
        st.sx = calm ? 0 : 3.3 * from;
        st.sz = calm ? 0 : -0.8 * from;
        st.yaw = yaw;
        const len = Math.hypot(st.sx, st.sz) || 1;
        st.axis.set(-st.sz / len, 0, st.sx / len); // up × travel direction (travel = -start)
        st.total = calm ? 0 : len / 0.5 + Math.PI * 1.5;
        st.scale = 1;
        qYaw.setFromAxisAngle(UP, yaw);
        qFinal.copy(qYaw).multiply(qFace[value]);
        const c = who === 'top' ? pal.topInk : pal.botInk;
        if (c) shadowMat.color.setRGB(c[0], c[1], c[2]);
        die.visible = shadow.visible = true;
      });
    },
    hide(calm) {
      if (!die.visible) return Promise.resolve();
      if (st.res) { st.res(); st.res = null; }
      return new Promise((res) => { st.mode = 'hide'; st.t = 0; st.dur = calm ? 0.05 : 0.16; st.res = res; });
    },
    setInks(top, bot) { pal.topInk = top; pal.botInk = bot; },
    /** Jump the current roll / hide to its end state on the next frame. */
    fast() { if (st.mode === 'roll' || st.mode === 'hide') st.t = st.dur; },
    /** The GL context is gone for good: settle whatever was waiting on a frame (nothing will draw it). */
    abort() {
      const r = st.res; st.res = null; st.mode = 'idle'; st.scale = 1;
      if (r) r();
    },
    step(dt) {
      if (st.mode === 'roll') {
        st.t += dt;
        const k = Math.min(1, st.t / st.dur);
        const pe = easeOut(k);
        let h = 0;
        let seg = 0;
        while (seg < BH.length - 1 && k > BT[seg + 1]) seg++;
        const u = (k - BT[seg]) / (BT[seg + 1] - BT[seg]);
        if (st.calm) h = 0.25 * (1 - k);
        else if (seg === 0) h = BH[0] * (1 - u * u);
        else h = BH[seg] * 4 * u * (1 - u);
        if (!st.calm && seg !== st.bounce) { st.bounce = seg; onTick(seg); }
        qSpin.setFromAxisAngle(st.axis, -st.total * (1 - pe));
        die.quaternion.copy(qSpin).multiply(qFinal);
        pose(st.sx * (1 - pe), h, st.sz * (1 - pe));
        if (k >= 1) {
          st.mode = 'idle';
          die.quaternion.copy(qFinal);
          pose(0, 0, 0);
          const r = st.res; st.res = null;
          if (r) r();
        }
        return true;
      }
      if (st.mode === 'hide') {
        st.t += dt;
        const k = Math.min(1, st.t / st.dur);
        st.scale = 1 - easeOut(k);
        pose(die.position.x, 0, die.position.z);
        if (k >= 1) {
          st.mode = 'idle'; die.visible = shadow.visible = false; st.scale = 1;
          const r = st.res; st.res = null;
          if (r) r();
        }
        return true;
      }
      return false;
    },
    render() { renderer.render(scene, cam); return renderer.info.render.calls; },
    dispose() {
      if (st.res) { st.res(); st.res = null; }
      try { renderer.forceContextLoss(); } catch { /* ignore */ }
      box.dispose(); edgeGeo.dispose(); plane.dispose();
      faces.forEach((f) => f.tex.dispose());
      mats.forEach((m) => m.dispose());
      hullMat.dispose(); lineMat.dispose(); shadowMat.dispose();
      renderer.dispose();
    },
  };
}

// ── 2D fallback die (plain DOM, same api) ─────────────────────────────
function dieView2D(host) {
  host.hidden = false;
  let timer = 0;
  let res = null;
  const show = (v, cls) => { host.innerHTML = dieHTML(v, cls); };
  return {
    kind: '2d',
    resize() {}, setRatio() {}, setPalette() {}, compile() {}, restore() {}, setInks() {},
    get ratio() { return 1; },
    fast() { if (res) { clearInterval(timer); const v = host.querySelector('.gb-die'); const done = res; res = null; if (v) v.classList.add('landed'); done(); } },
    roll(value, who, yaw, calm) {
      clearInterval(timer);
      if (res) res();
      return new Promise((r) => {
        res = r;
        host.className = `gb-die2d from-${who}${calm ? '' : ' rolling'}`;
        let k = 0;
        show(((value + 2) % 6) + 1);
        const steps = calm ? 0 : 9;
        const tick = () => {
          k++;
          if (k > steps) {
            clearInterval(timer);
            show(value, 'landed');
            const done = res; res = null;
            if (done) done();
            return;
          }
          show(((value + k * 4) % 6) + 1);
        };
        if (!steps) tick();
        else timer = setInterval(tick, 85);
      });
    },
    hide() { clearInterval(timer); if (res) { res(); res = null; } host.innerHTML = ''; return Promise.resolve(); },
    step() { return false; },
    render() {},
    dispose() { clearInterval(timer); if (res) { res(); res = null; } host.innerHTML = ''; },
  };
}

// ── records and rivalry (api.data) ────────────────────────────────────
// Flat keys, numbers and strings only. *_best / *_n keys only ever go up, so a sync keeps the larger
// value; everything else (streaks, form) is written once per match, guarded by last_id and a per-match m_<id> marker.
const LAST_TW = 'ju.bones.twist';
function lastTwist() { try { const v = localStorage.getItem(LAST_TW); return TWIST_IDS.includes(v) ? v : ''; } catch { return ''; } }
function saveTwist(id) { try { localStorage.setItem(LAST_TW, id); } catch { /* storage off */ } }

/**
 * Fold one finished match into the shared record. Pure: returns { patch, flags, streak, form }.
 * Both phones run it on the same match and the same data, so they write the same values; if the
 * partner already wrote this match (last_id), nothing is written and its flags are read back.
 */
/** A per-match marker key: unlike last_id (a plain string a late sync can roll back), it is only ever added. */
const doneKey = (id) => 'm_' + String(id).replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 40);
function recordsFor(d, s, r, id) {
  if (d.last_id === id || d[doneKey(id)]) return { patch: null, flags: String(d.last_flags || ''), streak: { who: d.streak_who, len: Number(d.streak_len) || 0 }, form: String(d.form || '') };
  const sc = score(s);
  const w = r.winner;
  const prevGames = Number(d.games_n) || 0;
  const patch = { last_id: id, [doneKey(id)]: 1, games_n: prevGames + 1 };
  const flags = [];
  for (const p of ['a', 'b']) {
    const k = `best_${p}_best`;
    const prev = Number(d[k]) || 0;
    if (sc[p] > prev) { patch[k] = sc[p]; if (prev > 0) flags.push(`pb_${p}`); }
  }
  const smash = s.big ? s.big.pts : 0;
  if (smash > (Number(d.smash_best) || 0)) { patch.smash_best = smash; patch.smash_who = s.big.who; if (Number(d.smash_best) > 0 && smash >= 10) flags.push('smash'); }
  const down = w && s.deficit ? s.deficit[w] : 0;
  if (down > (Number(d.comeback_best) || 0)) { patch.comeback_best = down; patch.comeback_who = w; if (Number(d.comeback_best) > 0 && down >= 10) flags.push('comeback'); }
  const wipes = s.wipes ? s.wipes.a + s.wipes.b : 0;
  if (wipes) patch.wipe_n = (Number(d.wipe_n) || 0) + wipes;
  if (w) {
    const len = d.streak_who === w ? (Number(d.streak_len) || 0) + 1 : 1;
    patch.streak_who = w; patch.streak_len = len;
    if (len > (Number(d.streak_len_best) || 0)) patch.streak_len_best = len;
  } else { patch.streak_who = '-'; patch.streak_len = 0; patch.draw_n = (Number(d.draw_n) || 0) + 1; }
  const form = (String(d.form || '') + (w || '-')).slice(-5);
  patch.form = form;
  const tw = s.tw || 'classic';
  patch[`tw_${tw}_n`] = (Number(d[`tw_${tw}_n`]) || 0) + 1;
  if (w) patch[`tw_${tw}_${w}_n`] = (Number(d[`tw_${tw}_${w}_n`]) || 0) + 1;
  patch.last_flags = flags.join(',');
  return { patch, flags: patch.last_flags, streak: { who: patch.streak_who, len: patch.streak_len }, form };
}
const formHTML = (form) => (form && form.length >= 2
  ? `<span class="gb-form" role="img" aria-label="Last ${form.length} games">${[...form].map((ch) => `<i class="gb-fd ${ch === 'a' ? 'a' : ch === 'b' ? 'b' : 'd'}"></i>`).join('')}</span>` : '');
function pickerHTML() {
  const last = lastTwist();
  return `<p class="gb-pk-head"><b>Twist the rules?</b> <span>Or just place a die.</span></p><div class="gb-pk-grid">${TWIST_IDS.map((id) => `<button type="button" class="gb-pk${id === last ? ' is-last' : ''}" data-tw="${id}"><b><span class="gb-nl">${TWISTS[id].name}</span><span class="gb-ns">${TWISTS[id].name.split(' ')[0]}</span></b><span>${TWISTS[id].hint}</span></button>`).join('')}</div>`;
}

// ── the game ──────────────────────────────────────────────────────────
registerGame({
  id: 'bones',
  title: 'Knucklebones',
  blurb: 'Roll, place, pair up, and smash their dice.',
  kind: 'turns',
  team: false,
  tags: ['brainy', 'quick', '3d'],
  platforms: ['phone', 'computer'],
  minutes: 5,
  endDelay: 'manual', // the finale calls api.showEnd() once the last smash has played
  howTo: [
    'You roll a die each turn. Tap one of your columns (or press 1–3) to place it.',
    'Matching dice in a column multiply: 4 + 4 scores 16, three 4s score 36.',
    'Your die knocks out every die of that value in their facing column.',
    'It ends when a grid fills. Higher total wins. The starter can pick a twist first.',
  ],
  init, next, apply, result, score,
  _test: { recordsFor, rollAt, colPts, TWISTS }, // for the tests

  css: `
    .g-bones { --gb-die: 52px; --gb-col: 52px; --gb-gap: 7px; --gb-pad: 8px; --gb-band: 112px; --gb-side: 62px;
      flex: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0; padding: 4px 0 10px; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
    .g-bones .gb-board { width: 100%; max-width: 480px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
    .g-bones .gb-half { display: grid; grid-template-columns: var(--gb-side) auto var(--gb-side); justify-content: center; align-items: center; column-gap: 8px; row-gap: 6px; transition: opacity 0.4s, filter 0.4s; }
    .g-bones .gb-tray, .g-bones .gb-scores { grid-column: 2; }
    .g-bones .gb-top .gb-scores { grid-row: 1; }
    .g-bones .gb-top .gb-tray, .g-bones .gb-top .gb-name, .g-bones .gb-top .gb-total { grid-row: 2; }
    .g-bones .gb-bot .gb-tray, .g-bones .gb-bot .gb-name, .g-bones .gb-bot .gb-total { grid-row: 1; }
    .g-bones .gb-bot .gb-scores { grid-row: 2; }
    .g-bones .gb-name { grid-column: 1; justify-self: end; min-width: 0; max-width: 100%; display: flex; flex-direction: column; align-items: flex-end; gap: 5px; text-align: right; font-weight: 900; font-size: 0.85rem; line-height: 1.1; }
    .g-bones .gb-chip { width: 16px; height: 16px; border: 2px solid var(--g-ink); border-radius: 5px; }
    .g-bones .gb-a .gb-chip { background: var(--p-a); } .g-bones .gb-b .gb-chip { background: var(--p-b); }
    .g-bones .gb-nm { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .g-bones .gb-mark { visibility: hidden; padding: 1px 5px; border: 2px solid var(--g-ink); border-radius: 5px; background: var(--g-hl); color: var(--g-on-ink); font-size: 0.6rem; letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; }
    .g-bones .gb-half.is-turn .gb-mark { visibility: visible; }
    .g-bones .gb-total { grid-column: 3; justify-self: start; font-family: var(--g-font-display); font-weight: 900; font-size: 1.85rem; line-height: 1; font-variant-numeric: tabular-nums; }
    .g-bones .gb-half.is-win .gb-total { animation: gb-win 0.7s cubic-bezier(.3, 1.6, .5, 1) both; background: var(--g-hl); color: var(--g-on-ink); border: 2px solid var(--g-ink); border-radius: 8px; padding: 4px 6px; box-shadow: var(--g-shadow); }
    .g-bones .gb-half.is-lose { opacity: 0.6; filter: grayscale(1); } /* the loser's half drops its inks: black plate only */
    .g-bones .gb-tray { display: grid; grid-template-columns: repeat(3, var(--gb-col)); column-gap: var(--gb-gap); padding: var(--gb-pad); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow); }
    .g-bones .gb-a .gb-tray { background: var(--p-a-soft); } .g-bones .gb-b .gb-tray { background: var(--p-b-soft); }
    .g-bones .gb-scores { display: grid; grid-template-columns: repeat(3, var(--gb-col)); column-gap: var(--gb-gap); padding: 0 calc(var(--gb-pad) + 2px); }
    .g-bones .gb-cs { justify-self: center; min-width: 34px; padding: 2px 8px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); font-weight: 900; font-size: 0.85rem; line-height: 1.3; text-align: center; font-variant-numeric: tabular-nums; }
    .g-bones .gb-cs.combo { background: var(--g-hl); color: var(--g-on-ink); }
    .g-bones .gb-cs.bump { animation: gb-bump 0.45s cubic-bezier(.3, 1.6, .5, 1); }
    .g-bones .gb-col { position: relative; z-index: 0; display: flex; flex-direction: column; align-items: center; gap: var(--gb-gap); margin: 0; padding: 0; border: 0; background: none; color: inherit; font: inherit; opacity: 1; touch-action: manipulation; -webkit-tap-highlight-color: transparent; cursor: default; border-radius: calc(var(--gb-die) * 0.26); }
    .g-bones .gb-top .gb-col { flex-direction: column-reverse; }
    .g-bones .gb-col.can { cursor: pointer; }
    .g-bones .gb-col.can::before { content: ''; position: absolute; inset: -4px -2px; z-index: -1; border: 2px solid var(--g-ink); border-radius: calc(var(--gb-die) * 0.3); background: var(--g-hl); box-shadow: var(--g-shadow-sm); transition: transform 0.08s, box-shadow 0.08s; }
    .g-bones .gb-col.can:active::before { transform: translate(2px, 2px); box-shadow: 0 0 0 var(--g-edge); }
    .g-bones .gb-col.can .gb-die.ghost { animation: gb-hint 0.9s ease-in-out infinite alternate; }
    .g-bones .gb-col:focus-visible { outline: 3px solid var(--g-ink); outline-offset: 7px; }
    .g-bones .gb-slot { position: relative; display: block; width: var(--gb-die); height: var(--gb-die); border-radius: 24%; border: 2px dashed var(--g-line); }
    .g-bones .gb-slot.full { border-color: transparent; }
    .g-bones .gb-col.can .gb-slot { border-color: transparent; }
    .g-bones .gb-die { position: absolute; inset: 0; box-sizing: border-box; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); padding: 13%; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 22%; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
    .g-bones .gb-die i { border-radius: 50%; background: var(--g-ink); margin: 13%; }
    .g-bones .gb-die.c2, .g-bones .gb-die.c3 { background: var(--g-hl); }
    .g-bones .gb-die.c2 i, .g-bones .gb-die.c3 i { background: var(--g-on-ink); }
    .g-bones .gb-die.c3 { border-width: 3px; box-shadow: var(--g-shadow); }
    .g-bones .gb-die.ghost { opacity: 0.6; border-style: dashed; border-color: var(--g-on-ink); box-shadow: none; background: transparent; }
    .g-bones .gb-die.ghost i { background: var(--g-on-ink); }
    .g-bones .gb-die.pulse { animation: gb-pulse 0.5s cubic-bezier(.3, 1.6, .5, 1); }
    .g-bones .gb-bot .gb-die.is-new { animation: gb-drop-b 0.34s cubic-bezier(.2, .8, .3, 1.2) both; }
    .g-bones .gb-top .gb-die.is-new { animation: gb-drop-t 0.34s cubic-bezier(.2, .8, .3, 1.2) both; }
    .g-bones .gb-die.threat::after { content: ''; position: absolute; inset: -6px; border: 2.5px dashed var(--g-bad); border-radius: 28%; animation: gb-threat 0.8s ease-in-out infinite alternate; }
    .g-bones .gb-die.crack { animation: gb-shake 0.32s linear both; }
    .g-bones .gb-die.crack::before, .g-bones .gb-die.crack::after { content: ''; position: absolute; top: 8%; bottom: 8%; width: 3px; background: var(--g-ink); border-radius: 2px; }
    .g-bones .gb-die.crack::before { left: 44%; transform: rotate(16deg); }
    .g-bones .gb-die.crack::after { left: 56%; top: 30%; bottom: 20%; transform: rotate(-38deg); }
    .g-bones .gb-die.pop { animation: gb-pop 0.3s ease-in both; }
    .g-bones .gb-shard { position: absolute; left: 50%; top: 50%; width: 24%; height: 24%; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 3px; animation: gb-shard 0.46s ease-out both; pointer-events: none; }
    .g-bones .gb-bot .gb-die.shift { animation: gb-shift-b 0.28s ease-out both; }
    .g-bones .gb-top .gb-die.shift { animation: gb-shift-t 0.28s ease-out both; }
    .g-bones .gb-band { position: relative; height: var(--gb-band); border: 2px solid var(--g-ink); border-radius: var(--g-radius); background: var(--g-card); box-shadow: var(--g-shadow); touch-action: none; }
    .g-bones .gb-band canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; border-radius: calc(var(--g-radius) - 2px); }
    .g-bones .gb-lab { position: absolute; top: 50%; transform: translateY(-50%); max-width: 36%; display: flex; flex-direction: column; gap: 4px; font-weight: 900; font-size: 0.86rem; line-height: 1.15; pointer-events: none; transition: opacity 0.12s; }
    .g-bones .gb-lab > * { max-width: 100%; }
    .g-bones .gb-lab .gb-hint, .g-bones .gb-lab .gb-streak, .g-bones .gb-lab .gb-wn, .g-bones .gb-lab .gb-kick { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .g-bones .gb-hint { font-size: 0.72rem; font-weight: 800; }
    .g-bones .gb-band.is-stamped .gb-lab { opacity: 0; } /* a stamp on the board is covering the band text: hide it for the moment */
    .g-bones .gb-lab-l { left: 12px; align-items: flex-start; }
    .g-bones .gb-lab-r { right: 12px; align-items: flex-end; text-align: right; color: var(--g-muted); font-weight: 800; }
    .g-bones .gb-kick { font-size: 0.62rem; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); }
    .g-bones .gb-arrow { width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; }
    .g-bones .gb-arrow.down { border-top: 9px solid var(--g-ink); }
    .g-bones .gb-arrow.up { border-bottom: 9px solid var(--g-ink); }
    .g-bones .gb-lab-r b { color: var(--g-ink); }
    .g-bones .gb-big { font-family: var(--g-font-display); font-weight: 900; font-size: 1.3rem; line-height: 1.05; color: var(--g-ink); }
    .g-bones .gb-band.is-final .gb-lab { max-width: 60%; }
    .g-bones .gb-band.is-final .gb-lab-r { max-width: 36%; }
    .g-bones .gb-by { display: flex; align-items: baseline; gap: 5px; }
    .g-bones .gb-by .gb-big { font-size: 1.7rem; }
    /* a short band (small phones): one line of kicker-free text each side, so nothing spills out of it */
    .g-bones.is-short .gb-lab { font-size: 0.8rem; gap: 2px; }
    .g-bones.is-short .gb-kick { font-size: 0.58rem; }
    .g-bones.is-short .gb-hint { font-size: 0.7rem; }
    .g-bones.is-short .gb-band.is-final .gb-lab > .gb-kick { display: none; }
    .g-bones.is-short .gb-big { font-size: 1.1rem; }
    .g-bones.is-short .gb-by .gb-big { font-size: 1.5rem; }
    .g-bones.is-short .gb-streak { font-size: 0.68rem; }
    .g-bones.is-short .gb-form { margin-top: 2px; gap: 3px; }
    .g-bones.is-short .gb-fd { width: 7px; height: 7px; border-width: 1.5px; }
    .g-bones.is-short .gb-nx { margin-top: 0; }
    .g-bones .gb-die2d { position: absolute; left: 50%; top: 50%; width: calc(var(--gb-band) * 0.52); height: calc(var(--gb-band) * 0.52); transform: translate(-50%, -50%); }
    .g-bones .gb-die2d .gb-die { box-shadow: var(--g-shadow); }
    .g-bones .gb-die2d.rolling .gb-die { animation: gb-tumble 0.8s cubic-bezier(.2, .7, .3, 1) both; }
    .g-bones .gb-die2d.from-top.rolling .gb-die { animation-name: gb-tumble-r; }
    .g-bones.is-tight { padding: 2px 0 4px; }
    .g-bones.is-tight .gb-board { gap: 6px; }
    .g-bones.is-tight .gb-half { row-gap: 3px; }
    .g-bones.is-tight .gb-cs { min-width: 30px; padding: 1px 7px; font-size: 0.75rem; line-height: 1.15; }
    .g-bones .gb-board { position: relative; }
    .g-bones .gb-half { position: relative; }
    /* the gilded column of a Golden Column match */
    .g-bones .gb-gild { position: absolute; inset: -4px -2px; z-index: -1; border: 2px solid var(--g-ink); border-radius: calc(var(--gb-die) * 0.3); background: var(--g-halftone) 0 0 / 5px 5px, var(--g-hl-soft); pointer-events: none; }
    .g-bones .gb-col.gold.can .gb-gild { background: var(--g-halftone) 0 0 / 5px 5px; }
    .g-bones .gb-cs { display: inline-flex; align-items: center; justify-content: center; gap: 3px; }
    .g-bones .gb-cs.gold { background: var(--g-hl); color: var(--g-on-ink); }
    .g-bones .gb-x2 { font-style: normal; font-size: 0.62rem; font-weight: 900; letter-spacing: 0.02em; }
    .g-bones .gb-pv { padding: 0 4px; border: 1.5px solid currentColor; border-radius: 999px; background: var(--g-card); font-size: 0.7rem; font-weight: 900; line-height: 1.25; }
    .g-bones .gb-cs.has-pv { padding-left: 5px; padding-right: 4px; gap: 2px; }
    .g-bones .gb-cs.has-pv .gb-x2 { display: none; } /* the gilded plate already says it, and the preview needs the room */
    .g-bones.is-tight .gb-pv { padding: 0 3px; font-size: 0.66rem; }
    .g-bones .gb-pv.up { color: var(--g-good); } .g-bones .gb-pv.dn { color: var(--g-bad); }
    .g-bones .gb-qm { grid-area: 1 / 1 / 4 / 4; place-self: center; font: normal 900 calc(var(--gb-die) * 0.5) / 1 var(--g-font-display); color: var(--g-on-ink); }
    /* twist picker: covers the opponent's (empty) half before the first die */
    .g-bones .gb-picker { position: absolute; inset: -4px -2px; z-index: 4; display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow); }
    .g-bones .gb-picker[hidden] { display: none; }
    .g-bones .gb-pk-head { margin: 0; font-size: 0.72rem; line-height: 1.2; color: var(--g-muted); font-weight: 700; }
    .g-bones .gb-pk-head b { color: var(--g-ink); font-weight: 900; }
    .g-bones .gb-pk-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: minmax(44px, 1fr); gap: 6px; }
    .g-bones .gb-pk { position: relative; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 1px; min-width: 0; min-height: 44px; margin: 0; padding: 2px 8px; border: 2px solid var(--g-ink); border-radius: var(--g-radius-sm); background: var(--g-card); box-shadow: var(--g-shadow-sm); color: var(--g-ink); font: inherit; text-align: left; touch-action: manipulation; -webkit-tap-highlight-color: transparent; cursor: pointer; }
    .g-bones .gb-pk b { font-size: 0.8rem; font-weight: 900; line-height: 1.15; }
    .g-bones .gb-pk > span { font-size: 0.7rem; font-weight: 700; line-height: 1.1; color: var(--g-muted); }
    .g-bones .gb-pk.is-last::after { content: 'Last time'; position: absolute; top: -9px; right: 6px; padding: 0 6px; border: 1.5px solid var(--g-ink); border-radius: 999px; background: var(--g-hl); color: var(--g-on-ink); font-size: 0.58rem; font-weight: 900; letter-spacing: 0.06em; line-height: 1.3; text-transform: uppercase; pointer-events: none; }
    .g-bones.is-land .gb-picker { padding: 6px; gap: 4px; }
    .g-bones.is-land .gb-pk-head span { display: none; }
    .g-bones.is-land .gb-pk-grid { gap: 5px; }
    .g-bones.is-land .gb-pk { padding: 3px 6px; overflow: hidden; }
    .g-bones.is-land .gb-pk b { font-size: 0.72rem; white-space: nowrap; }
    .g-bones .gb-pk .gb-ns { display: none; }
    .g-bones.is-land .gb-pk .gb-nl { display: none; } .g-bones.is-land .gb-pk .gb-ns { display: inline; } /* narrow chips: "Golden", not "Golden Column" */
    .g-bones.is-land .gb-pk > span { font-size: 0.64rem; line-height: 1.08; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }
    .g-bones .gb-pk:active { transform: translate(2px, 2px); box-shadow: 0 0 0 var(--g-edge); }
    .g-bones .gb-pk:focus-visible { outline: 3px solid var(--g-ink); outline-offset: 2px; }
    /* the band: twist badge, the mystery die, the oracle's next dice, stamps, final recap */
    .g-bones .gb-badge { position: absolute; z-index: 2; left: 50%; top: 0; transform: translate(-50%, -50%); max-width: 44%; padding: 1px 8px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-hl); color: var(--g-on-ink); font-size: 0.6rem; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
    .g-bones .gb-badge[hidden], .g-bones .gb-q[hidden] { display: none; }
    .g-bones .gb-q { position: absolute; left: 50%; top: 52%; width: calc(var(--gb-band) * 0.5); height: calc(var(--gb-band) * 0.5); transform: translate(-50%, -50%); display: grid; place-items: center; border: 2px solid var(--g-ink); border-radius: 22%; background: var(--g-card); box-shadow: var(--g-shadow); animation: gb-wobble 1.6s ease-in-out infinite; pointer-events: none; }
    .g-bones .gb-q em { font: normal 900 calc(var(--gb-band) * 0.3) / 1 var(--g-font-display); color: var(--g-ink); }
    .g-bones.is-land .gb-q { width: 64px; height: 64px; top: 50%; } .g-bones.is-land .gb-q em { font-size: 2rem; }
    .g-bones .gb-nx { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
    .g-bones .gb-nx .gb-kick { font-style: normal; }
    .g-bones .gb-nx .gb-die { position: relative; inset: auto; flex: none; width: 22px; height: 22px; padding: 2px; border-width: 1.5px; box-shadow: none; }
    .g-bones .gb-nx .gb-die i { margin: 8%; }
    .g-bones[data-tw="oracle"].is-tight .gb-lab-r > .gb-hint { display: none; } /* room for the next-dice queue */
    .g-bones .gb-stamp { position: absolute; z-index: 6; top: 50%; left: 50%; --rot: -5deg; width: max-content; max-width: 94%; padding: 6px 14px; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-hl); color: var(--g-on-ink); box-shadow: var(--g-shadow); font: 900 1.25rem / 1.1 var(--g-font-display); letter-spacing: 0.05em; text-align: center; text-transform: uppercase; pointer-events: none; opacity: 0; transform: translate(-50%, -50%) rotate(var(--rot)); }
    .g-bones .gb-stamp.sm { top: 41%; --rot: 4deg; padding: 4px 10px; background: var(--g-card); color: var(--g-ink); font-size: 0.9rem; }
    .g-bones .gb-stamp.show { animation: gb-stamp 1.15s cubic-bezier(.2, .9, .3, 1.25) both; }
    .g-bones .gb-streak { font-size: 0.72rem; font-weight: 800; line-height: 1.15; color: var(--g-muted); }
    .g-bones .gb-form { display: inline-flex; gap: 4px; margin-top: 4px; }
    .g-bones .gb-fd { width: 12px; height: 12px; border: 2px solid var(--g-ink); border-radius: 50%; }
    .g-bones .gb-fd.a { background: var(--p-a); } .g-bones .gb-fd.b { background: var(--p-b); }
    .g-bones .gb-col.nope { animation: gb-nope 0.4s linear; }
    .g-bones .gb-col.full.nope::before { content: ''; position: absolute; inset: -4px -2px; z-index: -1; border: 2px dashed var(--g-bad); border-radius: calc(var(--gb-die) * 0.3); }
    /* landscape: the trays sit side by side with the band between them */
    .g-bones.is-land .gb-board { max-width: 760px; flex-direction: row; align-items: center; justify-content: center; gap: 10px; }
    .g-bones.is-land .gb-band { flex: 1 1 0; min-width: 120px; height: auto; align-self: stretch; }
    .g-bones.is-land .gb-half { grid-template-columns: minmax(0, 1fr) auto; justify-content: center; row-gap: 4px; column-gap: 6px; }
    .g-bones.is-land .gb-half .gb-name { grid-column: 1; grid-row: 1; flex-direction: row; align-items: center; justify-self: start; text-align: left; gap: 5px; font-size: 0.78rem; }
    .g-bones.is-land .gb-half .gb-total { grid-column: 2; grid-row: 1; font-size: 1.5rem; justify-self: end; }
    .g-bones.is-land .gb-half .gb-tray { grid-column: 1 / 3; grid-row: 2; justify-self: center; }
    .g-bones.is-land .gb-half .gb-scores { grid-column: 1 / 3; grid-row: 3; justify-self: center; }
    .g-bones.is-land .gb-mark { display: none; }
    .g-bones.is-land .gb-half.is-turn .gb-nm { padding: 0 5px; border-radius: 4px; background: var(--g-hl); color: var(--g-on-ink); }
    .g-bones.is-land .gb-lab { left: 8px; right: 8px; max-width: none; align-items: center; text-align: center; transform: none; }
    .g-bones.is-land .gb-lab-l { top: 14px; align-items: center; }
    .g-bones.is-land .gb-lab-r { top: auto; bottom: 8px; align-items: center; }
    .g-bones.is-land .gb-band.is-final .gb-lab, .g-bones.is-land .gb-band.is-final .gb-lab-r { max-width: none; }
    .g-bones.is-land .gb-arrow { transform: rotate(-90deg); }
    .g-bones.is-land .gb-die2d { width: 64px; height: 64px; }
    .g-bones.is-land .gb-by .gb-big { font-size: 1.5rem; }
    .g-bones.is-land .gb-hint, .g-bones.is-land .gb-streak, .g-bones.is-land .gb-wn { white-space: normal; }
    @keyframes gb-hint { from { transform: scale(0.9); } to { transform: none; } }
    @keyframes gb-wobble { 0%, 100% { transform: translate(-50%, -50%) rotate(-7deg); } 50% { transform: translate(-50%, -54%) rotate(7deg); } }
    @keyframes gb-stamp { 0% { opacity: 0; transform: translate(-50%, -50%) scale(1.8) rotate(calc(var(--rot) - 8deg)); } 16% { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(var(--rot)); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -58%) scale(1) rotate(var(--rot)); } }
    @keyframes gb-nope { 0%, 100% { transform: none; } 20% { transform: translateX(-5px); } 40% { transform: translateX(5px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(3px); } }
    @keyframes gb-bump { 0% { transform: scale(1); } 40% { transform: scale(1.3); } 100% { transform: scale(1); } }
    @keyframes gb-win { 0% { transform: scale(0.6) rotate(-8deg); } 100% { transform: scale(1) rotate(-3deg); } }
    @keyframes gb-pulse { 0% { transform: scale(1); } 40% { transform: scale(1.14) rotate(-4deg); } 100% { transform: scale(1); } }
    @keyframes gb-drop-b { from { opacity: 0; transform: translateY(calc(var(--gb-die) * -1.2)) scale(1.3) rotate(-14deg); } 55% { opacity: 1; } to { transform: none; } }
    @keyframes gb-drop-t { from { opacity: 0; transform: translateY(calc(var(--gb-die) * 1.2)) scale(1.3) rotate(14deg); } 55% { opacity: 1; } to { transform: none; } }
    @keyframes gb-threat { from { opacity: 0.35; } to { opacity: 1; } }
    @keyframes gb-shake { 0%, 100% { transform: none; } 20% { transform: translateX(-3px) rotate(-4deg); } 40% { transform: translateX(3px) rotate(3deg); } 60% { transform: translateX(-2px) rotate(-2deg); } 80% { transform: translateX(2px); } }
    @keyframes gb-pop { 0% { transform: scale(1); } 30% { transform: scale(1.2) rotate(-8deg); } 100% { opacity: 0; transform: scale(0.1) rotate(30deg); } }
    @keyframes gb-shard { from { transform: translate(-50%, -50%); opacity: 1; } to { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) rotate(var(--r)); opacity: 0; } }
    @keyframes gb-shift-b { from { transform: translateY(calc(var(--sh) * (var(--gb-die) + var(--gb-gap)))); } to { transform: none; } }
    @keyframes gb-shift-t { from { transform: translateY(calc(var(--sh) * -1 * (var(--gb-die) + var(--gb-gap)))); } to { transform: none; } }
    @keyframes gb-tumble { 0% { transform: translate(-150px, -6px) rotate(-460deg); } 45% { transform: translate(-36px, -16px) rotate(-130deg); } 70% { transform: translate(-6px, 0) rotate(-22deg); } 86% { transform: translate(0, -4px) rotate(4deg); } 100% { transform: none; } }
    @keyframes gb-tumble-r { 0% { transform: translate(150px, -6px) rotate(460deg); } 45% { transform: translate(36px, -16px) rotate(130deg); } 70% { transform: translate(6px, 0) rotate(22deg); } 86% { transform: translate(0, -4px) rotate(-4deg); } 100% { transform: none; } }
    @media (prefers-reduced-motion: reduce) {
      .g-bones .gb-col.can .gb-die.ghost, .g-bones .gb-die.threat::after { animation: none; }
      .g-bones .gb-die.is-new, .g-bones .gb-die.shift, .g-bones .gb-die.pulse, .g-bones .gb-cs.bump, .g-bones .gb-die2d.rolling .gb-die, .g-bones .gb-die.crack, .g-bones .gb-col.nope { animation: none; }
      .g-bones .gb-die.pop { animation: gb-fade 0.15s linear both; }
      .g-bones .gb-shard { display: none; }
      .g-bones .gb-q { animation: none; }
      .g-bones .gb-stamp.show { opacity: 1; } /* the room switches every animation off: JS takes the stamp down again */
      @keyframes gb-fade { to { opacity: 0; } }
    }
  `,

  mount(el, api) {
    const threeP = api.three(); // start loading at once
    threeP.catch(noop);
    el.innerHTML = `<div class="g-bones">
      <div class="gb-board">
        <section class="gb-half gb-top"><div class="gb-scores"></div><div class="gb-name"></div><div class="gb-tray"></div><div class="gb-total">0</div><div class="gb-picker" hidden></div></section>
        <div class="gb-band" aria-live="polite">
          <canvas aria-hidden="true"></canvas>
          <div class="gb-die2d" hidden aria-hidden="true"></div>
          <div class="gb-q" hidden aria-hidden="true"><em>?</em></div>
          <div class="gb-badge" hidden></div>
          <div class="gb-lab gb-lab-l"></div>
          <div class="gb-lab gb-lab-r"></div>
        </div>
        <section class="gb-half gb-bot"><div class="gb-name"></div><div class="gb-tray"></div><div class="gb-total">0</div><div class="gb-scores"></div><div class="gb-picker" hidden></div></section>
        <div class="gb-stamp" aria-hidden="true"></div>
        <div class="gb-stamp sm" aria-hidden="true"></div>
      </div>
    </div>`;
    const $ = (s) => el.querySelector(s);
    const root = $('.g-bones');
    const band = $('.gb-band');
    const canvas = band.querySelector('canvas');
    const labL = $('.gb-lab-l');
    const labR = $('.gb-lab-r');
    const badge = $('.gb-badge');
    const qDie = $('.gb-q');
    const board = $('.gb-board');
    const stampBig = $('.gb-stamp:not(.sm)');
    const stampSm = $('.gb-stamp.sm');
    const halves = { top: $('.gb-top'), bot: $('.gb-bot') };
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = () => matchMedia('(pointer: coarse)').matches;

    let dead = false;
    let ctxNow = null;
    let bottom = api.mode === 'online' && api.me ? api.me : 'a';
    let topW = other(bottom);
    let shownMoves = -1;
    let dieN = -1;
    let picking = false;
    let finaleDone = false;
    let openedOver = null; // was the match already finished when this view first saw it?
    let dv = null;
    let pal = readPalette(api);
    let raf = 0;
    let lastT = 0;
    let paused = typeof document !== 'undefined' && document.hidden;
    let glLost = false;
    let ema = 16;
    let perfN = 0;
    let readyRes;
    const ready = new Promise((r) => { readyRes = r; });
    const T = () => (typeof window !== 'undefined' && window.__bonesTest) || null; // test hook only
    const log = (ev) => { const t = T(); if (t) { (t.log || (t.log = [])).push(ev); (t.at || (t.at = [])).push(performance.now()); } };
    const sfx = (name) => { log(`sfx:${name}`); api.sfx(name); };

    function setSides() {
      halves.bot.classList.remove('gb-a', 'gb-b'); halves.top.classList.remove('gb-a', 'gb-b');
      halves.bot.classList.add(`gb-${bottom}`); halves.top.classList.add(`gb-${topW}`);
      halves.bot.dataset.who = bottom; halves.top.dataset.who = topW;
      halves.bot.querySelector('.gb-tray').dataset.who = bottom;
      halves.top.querySelector('.gb-tray').dataset.who = topW;
      for (const [k, w] of [['top', topW], ['bot', bottom]]) {
        const label = api.mode === 'online' && w === api.me ? 'You' : api.name(w);
        halves[k].querySelector('.gb-name').innerHTML = `<span class="gb-chip" aria-hidden="true"></span><span class="gb-nm"></span><span class="gb-mark">To play</span>`;
        halves[k].querySelector('.gb-nm').textContent = label;
      }
      const inks = (w) => (w === 'a' ? pal.a : pal.b);
      if (dv) dv.setInks(inks(topW), inks(bottom));
    }
    setSides();
    labL.innerHTML = '<span class="gb-kick">Shaking the dice…</span>'; // until the first roll

    // ── layout: size dice to fit the stage ──
    // The room scrolls (min-height content), so the stage can't tell us how much room there is:
    // work it out from the viewport instead. Portrait stacks the trays with the band between;
    // when that would make the dice small and a side-by-side board fits bigger ones, go landscape.
    function stageRoom() {
      const gm = el.closest('.gm');
      const rt = el.closest('#game-root');
      const vh = rt ? rt.clientHeight : window.innerHeight;
      const top = el.getBoundingClientRect().top - (rt ? rt.getBoundingClientRect().top - rt.scrollTop : 0);
      let padB = 12;
      try { if (gm) padB = parseFloat(getComputedStyle(gm).paddingBottom) || 12; } catch { /* keep */ }
      const W = Math.min(el.clientWidth || 360, 760);
      const H = Math.max(160, vh - top - padB);
      return { W, H };
    }
    const COLMIN = 44; // a column button is never narrower than this
    const gapOf = (d) => (d < 48 ? 5 : 7);
    const padOf = (d) => (d < 48 ? 6 : 8);
    // `tight` squeezes the stage padding, board gap and score chips so small screens can have bigger dice
    const SPACE = { loose: { pad: 14, gap: 10, row: 32, bandMin: 64 }, tight: { pad: 6, gap: 6, row: 23, bandMin: 58 } };
    function fitPortrait(W, H, tight) {
      const K = tight ? SPACE.tight : SPACE.loose;
      const fixed = K.pad + 2 * K.gap + K.bandMin + 2 * K.row;
      const side = Math.round(Math.max(54, Math.min(96, W * 0.19)));
      let best = 0;
      for (let d = 66; d >= 30; d--) {
        const col = Math.max(COLMIN, d);
        const gap = gapOf(d); const pad = padOf(d);
        if (2 * side + 16 + 3 * col + 2 * gap + 2 * pad + 4 > W) continue;
        if (fixed + 2 * (3 * d + 2 * gap + 2 * pad + 4) > H) continue;
        best = d; break;
      }
      const d = best || 30;
      const gap = gapOf(d); const pad = padOf(d);
      const left = H - (fixed - K.bandMin + 2 * (3 * d + 2 * gap + 2 * pad + 4));
      return { land: false, tight, die: d, col: Math.max(COLMIN, d), gap, pad, side, band: Math.round(Math.max(K.bandMin, Math.min(150, left))), fits: !!best };
    }
    function fitLand(W, H, tight) {
      const K = tight ? SPACE.tight : SPACE.loose;
      const head = tight ? 28 : 32; const foot = K.row; const bandMin = 128;
      let best = 0;
      for (let d = 60; d >= 30; d--) {
        const col = Math.max(COLMIN, d);
        const gap = gapOf(d); const pad = padOf(d);
        if (2 * (3 * col + 2 * gap + 2 * pad + 4) + bandMin + 2 * K.gap > W) continue;
        if (K.pad + head + foot + 3 * d + 2 * gap + 2 * pad + 4 + 8 > H) continue;
        best = d; break;
      }
      const d = best || 30;
      return { land: true, tight, die: d, col: Math.max(COLMIN, d), gap: gapOf(d), pad: padOf(d), side: 0, band: 0, fits: !!best };
    }
    function layout() {
      const { W, H } = stageRoom();
      const pw = Math.min(W, 480);
      // the biggest dice that fit wins; side-by-side and squeezed layouts have to earn their place
      const cands = [[fitPortrait(pw, H, false), 0], [fitPortrait(pw, H, true), 3], [fitLand(W, H, false), 8], [fitLand(W, H, true), 11]];
      let L = null; let top = -1e9;
      for (const [c, pen] of cands) { const v = c.fits ? c.die - pen : -1e6 + c.die; if (v > top) { top = v; L = c; } }
      root.classList.toggle('is-land', L.land);
      root.classList.toggle('is-tight', L.tight);
      root.classList.toggle('is-short', !L.land && L.band < 84);
      root.style.setProperty('--gb-die', `${L.die}px`);
      root.style.setProperty('--gb-col', `${L.col}px`);
      root.style.setProperty('--gb-gap', `${L.gap}px`);
      root.style.setProperty('--gb-pad', `${L.pad}px`);
      root.style.setProperty('--gb-side', `${L.side}px`);
      root.style.setProperty('--gb-band', `${L.band}px`);
      if (dv && dv.setZoom) dv.setZoom(L.land ? 1.75 : 1);
      if (dv) { dv.resize(band.clientWidth, band.clientHeight); renderNow(); }
    }
    window.addEventListener('resize', layout);
    const ro = new ResizeObserver(() => layout());
    ro.observe(el);
    layout();

    // ── board drawing ──
    function trayHTML(who, grid, o) {
      const pick = o.pick === who;
      return grid.map((col, ci) => {
        const counts = {};
        for (const v of col) counts[v] = (counts[v] || 0) + 1;
        let slots = '';
        for (let r = 0; r < ROWS; r++) {
          const v = col[r];
          let inner = '';
          if (v) {
            const cls = [];
            if (counts[v] === 2) cls.push('c2');
            if (counts[v] >= 3) cls.push('c3');
            if (o.newAt && o.newAt.who === who && o.newAt.col === ci && r === col.length - 1) cls.push('is-new');
            if (o.doomed && o.doomed.who === who && o.doomed.col === ci && v === o.doomed.value) cls.push(o.doomed.stage);
            if (o.threat && o.threat.who === who && v === o.threat.value && o.threat.cols.includes(ci)) cls.push('threat');
            if (o.pulse && o.pulse.who === who && o.pulse.col === ci && v === o.pulse.value && counts[v] > 1) cls.push('pulse');
            let extra = '';
            const sh = o.shift && o.shift.who === who && o.shift.col === ci ? o.shift.by[r] : 0;
            if (sh) { cls.push('shift'); extra = ` style="--sh:${sh}"`; }
            inner = dieHTML(v, cls.join(' '), extra);
            if (o.doomed && o.doomed.stage === 'pop' && cls.includes('pop')) {
              const burst = o.doomed.big ? [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1.7], [0, 1.7], [-1.7, 0], [1.7, 0]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]];
              inner += burst.map(([dx, dy], k) => `<b class="gb-shard" style="--dx:${dx * (18 + k * 3)}px;--dy:${dy * (16 + k * 4)}px;--r:${(k % 2 ? 1 : -1) * 120}deg"></b>`).join('');
            }
          } else if (pick && r === col.length) inner = dieHTML(o.blind ? '?' : o.roll, 'ghost');
          slots += `<span class="gb-slot${v ? ' full' : ''}">${inner}</span>`;
        }
        const can = pick && col.length < ROWS;
        const full = pick && !can;
        const gilded = o.gold === ci;
        const label = `${gilded ? 'Golden column ' : 'Column '}${ci + 1}: ${col.length ? col.join(', ') : 'empty'}. Scores ${colPts(col, ci, o.gold)}.${can ? ' Place your die here.' : full ? ' Full.' : ''}`;
        // aria-disabled, not disabled: a tap on a full column still arrives, so it can say why nothing happened
        return `<button type="button" class="gb-col${can ? ' can' : ''}${full ? ' full' : ''}${gilded ? ' gold' : ''}" data-col="${ci}" aria-label="${label}"${can ? '' : ' aria-disabled="true" tabindex="-1"'}>${gilded ? '<span class="gb-gild" aria-hidden="true"></span>' : ''}${slots}</button>`;
      }).join('');
    }
    function scoresHTML(grid, bumpCol, gold, pv) {
      return grid.map((col, ci) => {
        const combo = col.some((v) => col.indexOf(v) !== col.lastIndexOf(v));
        const chip = pv && pv[ci] ? `<b class="gb-pv ${pv[ci] > 0 ? 'up' : 'dn'}">${pv[ci] > 0 ? '+' : '−'}${Math.abs(pv[ci])}</b>` : '';
        return `<span class="gb-cs${combo ? ' combo' : ''}${gold === ci ? ' gold' : ''}${bumpCol === ci ? ' bump' : ''}${chip ? ' has-pv' : ''}"><span>${colPts(col, ci, gold)}</span>${gold === ci ? '<i class="gb-x2">×2</i>' : ''}${chip}</span>`;
      }).join('');
    }
    function draw(grids, o = {}) {
      const s = ctxNow && ctxNow.state;
      const gold = s ? s.gold : undefined;
      o.gold = gold;
      for (const [k, w] of [['top', topW], ['bot', bottom]]) {
        const h = halves[k];
        const tray = h.querySelector('.gb-tray');
        tray.innerHTML = trayHTML(w, grids[w], o);
        tray.classList.toggle('is-picking', o.pick === w);
        const pv = o.pv ? (o.pick === w ? o.pv.gain : o.pv.loss) : null;
        h.querySelector('.gb-scores').innerHTML = scoresHTML(grids[w], o.bump && o.bump.who === w ? o.bump.col : -1, gold, pv);
        h.querySelector('.gb-total').textContent = gridScore(grids[w], gold);
        h.classList.toggle('is-turn', !!s && !s.over && s.turn === w && !o.noTurn);
      }
    }
    const cloneGrids = (g) => ({ a: g.a.map((c) => c.slice()), b: g.b.map((c) => c.slice()) });
    function preGrids(s) {
      const g = cloneGrids(s.grids);
      const L = s.last;
      g[L.who][L.col].pop();
      g[other(L.who)][L.col] = L.oppBefore.slice();
      return g;
    }

    // ── labels in the dice tray ──
    const whoLabel = (w) => (ctxNow && ctxNow.mode === 'online' && w === ctxNow.me ? 'You' : api.name(w));
    const twOf = () => (ctxNow && ctxNow.state && ctxNow.state.tw) || '';
    const isBlind = () => twOf() === 'blind';
    const nextRolls = (s) => [rollAt(s, s.n + 1), rollAt(s, s.n + 2)];
    function setBadge(s) {
      const tw = s && s.tw;
      const on = !!tw && tw !== 'classic' && TWISTS[tw];
      badge.hidden = !on;
      if (on) badge.textContent = TWISTS[tw].name;
      root.dataset.tw = on ? tw : '';
    }
    function setMystery(on) {
      qDie.hidden = !on;
      band.classList.toggle('is-mystery', on);
    }
    function setBand(mode, w, value) {
      const arrow = w === bottom ? 'down' : 'up';
      const nm = whoLabel(w);
      const s = ctxNow && ctxNow.state;
      if (mode === 'over') {
        labL.innerHTML = '';
        labR.innerHTML = '';
        return;
      }
      const lastWord = !!(s && s.final);
      const kick1 = lastWord ? 'Last word' : mode === 'mystery' ? (nm === 'You' ? 'Your pick' : 'Picking for') : nm === 'You' ? 'Your roll' : 'Rolling for';
      labL.innerHTML = `<span class="gb-kick">${kick1}</span><span class="gb-wn"></span><span class="gb-arrow ${arrow}" aria-hidden="true"></span>`;
      labL.querySelector('.gb-wn').textContent = nm === 'You' ? '' : nm;
      const nx = s && s.tw === 'oracle' && !s.over && !s.final ? `<span class="gb-nx"><i class="gb-kick">Next</i>${nextRolls(s).map((v) => dieHTML(v, 'mini')).join('')}</span>` : '';
      const first = !!(s && s.n === 0 && s.tw === undefined);
      // one short line under the headline: the band is only ~58 px tall on a small phone
      const lwHint = s && s.tw === 'mirror' ? 'One last die' : 'Last die, no smash';
      if (mode === 'rolling') labR.innerHTML = nx;
      else if (mode === 'mystery') labR.innerHTML = `<b>Blind draw</b><span class="gb-wait gb-hint"></span>`;
      else if (mode === 'pick') labR.innerHTML = `<b>Rolled ${value}</b><span class="gb-hint">${lastWord ? lwHint : coarse() ? 'Pick a column' : 'Pick a column (1–3)'}</span>${nx}`;
      else labR.innerHTML = `<b>Rolled ${value}</b><span class="gb-wait gb-hint"></span>${nx}`;
      const wt = labR.querySelector('.gb-wait');
      if (wt) {
        if (mode === 'mystery') wt.textContent = w === (ctxNow && ctxNow.actor) || (ctxNow && ctxNow.mode === 'local') ? 'Pick blind' : 'Choosing blind';
        else wt.textContent = lastWord ? lwHint : first ? 'Picking a twist…' : 'Choosing…';
      }
    }

    // ── loop for the 3D die ──
    function frame(now) {
      raf = 0;
      if (dead || paused || glLost || !dv) return;
      const dt = lastT ? Math.min(0.05, Math.max(0, (now - lastT) / 1000)) : 1 / 60;
      lastT = now;
      const busy = dv.step(dt);
      const calls = dv.render();
      if (dv.kind === '3d') {
        ema = ema * 0.92 + dt * 1000 * 0.08;
        if (++perfN > 50 && ema > 24 && dv.ratio > 1) { dv.setRatio(Math.max(1, dv.ratio - 0.25)); perfN = 0; ema = 16; }
      }
      const t = T();
      if (t) { t.frames = (t.frames || 0) + 1; t.calls = calls; }
      if (busy) raf = requestAnimationFrame(frame);
      else lastT = 0;
    }
    function kick() { if (!raf && !dead && !paused && !glLost && dv) raf = requestAnimationFrame(frame); }
    function renderNow() { if (dv && !paused && !glLost && !dead) dv.render(); }
    // Tap-to-skip: while a roll / placement plays out, a tap fast-forwards it to the settled board.
    let skipping = false;
    let animating = false;
    const sleepers = new Set();
    const sleep = (ms) => new Promise((r) => {
      if (skipping) { r(); return; }
      const done = () => { clearTimeout(t); sleepers.delete(done); r(); };
      const t = setTimeout(done, ms);
      sleepers.add(done);
    }).then(() => { if (dead) throw DEAD; });
    function skipNow() {
      if (skipping) return;
      skipping = true;
      log('skip');
      if (dv) dv.fast();
      for (const f of [...sleepers]) f();
      kick();
    }

    async function roll(value, w, n) {
      dieN = n;
      log(`roll:${value}`);
      setMystery(false);
      setBand('rolling', w);
      band.dataset.roll = '';
      const s = ctxNow.state;
      const yaw = (api.rand(s.seed, 'yaw', n) - 0.5) * 0.9;
      const p = dv.roll(value, w === topW ? 'top' : 'bot', yaw, reduced() || skipping);
      kick();
      await p;
      if (dead) throw DEAD;
      band.dataset.roll = String(value);
      sfx('flip');
    }
    let bandT = 0;
    /** Ink a stamp on the board. `on` = 'top' / 'bot' parks it over that tray (the finale, so the recap in the band
     *  stays readable); without it the stamp sits mid-board over the band and its text fades out for a moment. */
    function stamp(text, small, on) {
      const e = small ? stampSm : stampBig;
      e.textContent = text;
      e.classList.remove('show');
      e.style.left = ''; e.style.maxWidth = '';
      if (on) {
        const br = board.getBoundingClientRect();
        const tr = halves[on].querySelector('.gb-tray').getBoundingClientRect();
        e.style.top = `${Math.round(tr.top + tr.height / 2 - br.top)}px`;
        if (root.classList.contains('is-land')) { // side-by-side trays: stay over this tray, wrapping if need be
          e.style.left = `${Math.round(tr.left + tr.width / 2 - br.left)}px`;
          e.style.maxWidth = `${Math.round(tr.width)}px`;
        }
      } else {
        e.style.top = '';
        band.classList.add('is-stamped');
        clearTimeout(bandT);
        bandT = setTimeout(() => band.classList.remove('is-stamped'), reduced() ? 1300 : 1150);
      }
      void e.offsetWidth;
      e.classList.add('show');
      clearTimeout(e._t);
      if (reduced()) e._t = setTimeout(() => e.classList.remove('show'), 1300);
      log(`stamp:${text}`);
    }
    async function place(L, pre, s) {
      const rm = reduced();
      const opp = other(L.who);
      const mid = cloneGrids(pre);
      mid[L.who][L.col].push(L.value);
      log('place');
      labR.innerHTML = `<b>Rolled ${L.value}</b><span>Column ${L.col + 1}</span>`;
      const hidden = dv.hide(rm || skipping);
      kick();
      draw(mid, { newAt: { who: L.who, col: L.col }, bump: { who: L.who, col: L.col } });
      sfx('place');
      api.haptic(10);
      await hidden;
      await sleep(rm ? 60 : 300);
      if (L.destroyed > 0) {
        draw(mid, { doomed: { who: opp, col: L.col, value: L.value, stage: 'crack' } });
        log('crack');
        labR.innerHTML = `<b>${L.wipe ? 'Wiped out' : 'Smash'}</b><span>${L.destroyed === 1 ? 'One die' : `${L.destroyed} dice`} knocked out</span>`;
        sfx('hit');
        api.haptic(30);
        await sleep(rm ? 60 : 330);
        draw(mid, { doomed: { who: opp, col: L.col, value: L.value, stage: 'pop', big: !!L.wipe } });
        sfx('pop');
        if (L.wipe) { stamp('Wiped out'); sfx('win'); log('wipe'); }
        await sleep(rm ? 120 : 420);
        const by = [];
        let gone = 0;
        L.oppBefore.forEach((v) => { if (v === L.value) gone++; else by.push(gone); });
        draw(s.grids, { shift: { who: opp, col: L.col, by }, bump: { who: opp, col: L.col } });
        await sleep(rm ? 40 : 260);
      }
      const col = s.grids[L.who][L.col];
      const combo = col.filter((v) => v === L.value).length > 1;
      if (combo) {
        draw(s.grids, { pulse: { who: L.who, col: L.col, value: L.value }, bump: { who: L.who, col: L.col } });
        if (L.triple && !L.wipe) { stamp(`Triple ${L.value}s · ${colPts(col, L.col, s.gold)}`); log('triple'); sfx('win'); } else sfx('good');
        await sleep(rm ? 40 : 420);
      } else {
        draw(s.grids);
        await sleep(rm ? 20 : 120);
      }
      if (L.comeback) {
        stamp('Comeback!', true); log('comeback'); sfx('good');
        await sleep(rm ? 60 : 500);
      } else if (L.wipe || L.triple) await sleep(rm ? 60 : 380);
    }

    // ── sync the view to the rules state ──
    let chain = Promise.resolve();
    function enqueue(fn) {
      chain = chain.then(() => (dead ? null : fn())).catch((e) => { if (e !== DEAD) console.error('[bones]', e); });
    }
    let seenTw = null; // the twist this view has already announced ('' = classic, null = nothing seen yet)
    function announceTwist(c, s) {
      const now = s.tw || '';
      const prev = seenTw;
      seenTw = now;
      setBadge(s);
      if (prev === null || prev === now) return; // first look, or nothing new
      if (now === 'blind') dieN = -1; // the first die the starter watched was thrown away: roll the real one when it lands
      if (now && now !== 'classic' && !(c.mode === 'online' && s.first === c.me)) {
        // online: the partner is told who picked what and how it plays. Same phone: whoever tapped knows what they
        // picked, so the toast is just the rule for the person next to them.
        const msg = c.mode === 'local' ? `${TWISTS[now].name}: ${TWISTS[now].hint}` : `${api.name(s.first)} picked ${TWISTS[now].name}. ${TWISTS[now].hint}`;
        api.toast(msg);
        log(`picked:${now}`);
        log(`toast:${msg}`);
      }
    }
    async function sync() {
      animating = true;
      showPicker(false);
      for (;;) {
        const c = ctxNow;
        if (dead || !c || !c.state) return;
        const s = c.state;
        if (c.moves === shownMoves) break;
        const first = shownMoves < 0;
        const L = s.last;
        picking = false;
        announceTwist(c, s);
        if (!L || c.moves < shownMoves) {
          draw(s.grids);
          shownMoves = c.moves;
          continue;
        }
        const replay = !first || c.mode === 'local' || L.who !== c.me;
        if (!replay) { draw(s.grids); shownMoves = c.moves; continue; }
        const pre = preGrids(s);
        draw(pre, { noTurn: true });
        await ready;
        if (dieN !== L.n) {
          if (first) await sleep(reduced() ? 0 : 250);
          await roll(L.value, L.who, L.n);
          await sleep(reduced() ? 60 : 350);
        }
        await place(L, pre, s);
        shownMoves = c.moves;
      }
      const c = ctxNow;
      const s = c.state;
      announceTwist(c, s);
      await ready;
      if (c.over) { await finale(c); return; }
      if (dieN !== s.n && !isBlind()) await roll(s.roll, s.turn, s.n);
      if (ctxNow !== c && ctxNow.moves !== shownMoves) return; // a newer move is queued
      showIdle();
    }
    /** What picking a column here would do: your column's gain and their column's loss. */
    function previews(s, actor) {
      const gold = s.gold;
      const opp = other(actor);
      const soft = s.final && s.tw !== 'mirror';
      const gain = [0, 0, 0]; const loss = [0, 0, 0];
      for (let ci = 0; ci < COLS; ci++) {
        const mine = s.grids[actor][ci];
        if (mine.length >= ROWS) continue;
        gain[ci] = colPts(mine.concat(s.roll), ci, gold) - colPts(mine, ci, gold);
        if (!soft) {
          const oc = s.grids[opp][ci];
          loss[ci] = -(colPts(oc, ci, gold) - colPts(oc.filter((v) => v !== s.roll), ci, gold));
        }
      }
      return { gain, loss };
    }
    function showPicker(on, actor) {
      for (const k of ['top', 'bot']) {
        const el2 = halves[k].querySelector('.gb-picker');
        const target = on && halves[k].dataset.who === other(actor);
        if (target && el2.hidden) el2.innerHTML = pickerHTML();
        el2.hidden = !target;
      }
      root.classList.toggle('has-picker', !!on);
    }
    function showIdle() {
      const c = ctxNow;
      if (!c || !c.state || c.over) return;
      const s = c.state;
      const blind = s.tw === 'blind';
      setBadge(s);
      picking = !!c.canMove && (blind || dieN === s.n);
      const actor = s.turn;
      let threat = null;
      let pv = null;
      if (picking && !blind) {
        const cols = [0, 1, 2].filter((i) => s.grids[actor][i].length < ROWS);
        const soft = s.final && s.tw !== 'mirror';
        threat = soft ? null : { who: other(actor), value: s.roll, cols };
        pv = previews(s, actor);
      }
      draw(s.grids, picking ? { pick: actor, roll: s.roll, threat, pv, blind } : {});
      if (blind) {
        if (dv) { dv.hide(true); kick(); }
        band.dataset.roll = '';
        setMystery(true);
        setBand('mystery', actor, 0);
      } else setBand(picking ? 'pick' : 'wait', actor, s.roll);
      showPicker(picking && s.n === 0 && s.tw === undefined, actor);
      root.dataset.phase = picking ? 'pick' : 'wait';
      animating = false;
      skipping = false;
      if (dv3 && !$('.gb-die2d').querySelector('.gb-die')) redrawDie(); // flat dice standing in for a lost 3D view
    }
    /** Records and rivalry: fold this match into the shared per-game data (once; both phones agree). */
    let recap = null;
    function recordMatch(c) {
      const s = c.state;
      if (recap) return;
      try {
        // turn games don't get data() on their api (live games do): the shared store is the same one
        const store = typeof api.data === 'function' && typeof api.setData === 'function' ? api : gameDataApi('bones');
        const r = c.result || result(s);
        const rec = recordsFor(store.data() || {}, s, r, c.matchId);
        if (rec.patch) store.setData(rec.patch);
        recap = rec;
        log(`records:${rec.flags || '-'}`);
      } catch (err) { console.warn('[bones] records', err); }
    }
    const nameFor = (w) => (w === 'a' || w === 'b' ? (whoLabel(w) === 'You' ? 'You' : api.name(w)) : '');
    async function finale(c) {
      const s = c.state;
      root.dataset.phase = 'over';
      draw(s.grids, { noTurn: true });
      setBand('over');
      setMystery(false);
      showPicker(false);
      dv.hide(true);
      kick();
      if (finaleDone) { animating = false; skipping = false; return; }
      finaleDone = true;
      log('finale');
      const r = c.result || result(s);
      for (const [k, w] of [['top', topW], ['bot', bottom]]) {
        halves[k].classList.toggle('is-win', r.winner === w);
        halves[k].classList.toggle('is-lose', !!r.winner && r.winner !== w);
      }
      const sc = score(s);
      band.classList.add('is-final');
      const streakLine = recap && recap.streak && recap.streak.len >= 2 && (recap.streak.who === 'a' || recap.streak.who === 'b')
        ? `${nameFor(recap.streak.who)} ${nameFor(recap.streak.who) === 'You' ? 'have' : 'has'} won ${recap.streak.len} straight` : '';
      const nmW = r.winner ? (whoLabel(r.winner) === 'You' ? 'You win' : `${api.name(r.winner)} wins`) : 'Dead even';
      labL.innerHTML = `<span class="gb-kick">Final</span><span class="gb-wn gb-big"></span><span class="gb-streak"></span>`;
      labL.querySelector('.gb-wn').textContent = nmW;
      labL.querySelector('.gb-streak').textContent = streakLine;
      labR.innerHTML = (r.winner ? `<span class="gb-by"><span class="gb-kick">by</span><b class="gb-big">${Math.abs(sc.a - sc.b)}</b></span>` : `<b>${sc.a} apiece</b>`) + formHTML(recap && recap.form);
      // new records get a stamp each (over the trays: the recap in the band stays readable), then the end card
      const flags = recap && recap.flags ? recap.flags.split(',').filter(Boolean) : [];
      const lines = [];
      for (const f of flags) {
        if (f === 'pb_a' || f === 'pb_b') lines.push(`New best: ${sc[f.slice(3)]}${ctxNow.mode === 'online' && f.slice(3) === c.me ? '' : ` for ${api.name(f.slice(3))}`}`);
        else if (f === 'smash') lines.push('Biggest smash ever');
        else if (f === 'comeback') lines.push('Biggest comeback');
      }
      if (lines[0]) { stamp(lines[0], false, 'top'); sfx('good'); }
      if (lines[1]) {
        await sleep(reduced() ? 100 : 450);
        stamp(lines[1], true, 'bot'); sfx('good');
      }
      // The band's recap (winner, streak, form) and the stamps get ~1.7 s before the end card covers them.
      // Total from the last move stays well under core's 8 s safety net.
      await sleep(reduced() ? 250 : lines[1] ? 1250 : 1700);
      animating = false;
      skipping = false;
      api.showEnd();
    }

    // ── input ──
    function pick(col) {
      const c = ctxNow;
      if (!picking || !c || !c.canMove || c.over) return;
      const g = c.state.grids[c.actor] && c.state.grids[c.actor][col];
      if (!g) return;
      if (g.length >= ROWS) {
        api.toast('That column is full');
        sfx('bad');
        const b = root.querySelector(`.gb-tray.is-picking .gb-col[data-col="${col}"]`);
        if (b) { b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope'); setTimeout(() => b.classList.remove('nope'), 420); }
        log('full');
        return;
      }
      picking = false;
      root.dataset.phase = 'busy';
      sfx('tap');
      const r = api.move({ col });
      if (!r.ok) { api.toast(r.error); showIdle(); }
    }
    function sendTwist(id) {
      const c = ctxNow;
      if (!picking || !c || !c.canMove || c.over || !TWIST_IDS.includes(id)) return;
      const s = c.state;
      if (s.n !== 0 || s.tw !== undefined) return;
      picking = false;
      root.dataset.phase = 'busy';
      sfx('tap');
      saveTwist(id);
      showPicker(false);
      const r = api.move({ tw: id });
      if (!r.ok) { api.toast(r.error); showIdle(); }
    }
    function onClick(e) {
      const pk = e.target.closest('.gb-pk');
      if (pk && root.contains(pk)) { sendTwist(pk.dataset.tw); return; }
      const b = e.target.closest('.gb-col');
      if (!b || !root.contains(b)) return;
      const tray = b.closest('.gb-tray');
      if (!tray || !tray.classList.contains('is-picking')) return;
      pick(Number(b.dataset.col));
    }
    function onKey(e) {
      if (e.repeat || !/^[1-3]$/.test(e.key) || !root.isConnected) return;
      const tgt = e.target;
      if (tgt && tgt.closest && tgt.closest('input, textarea, select, [contenteditable]')) return;
      const gm = root.closest('.gm');
      if (gm && gm.querySelector('.gm-sheet:not([hidden]), .gm-end:not([hidden]), .gm-curtain:not([hidden])')) return;
      if (!picking) return;
      e.preventDefault();
      pick(Number(e.key) - 1);
    }
    let unlocked = false;
    function onTouchEnd() { if (!unlocked) { unlocked = true; sfx('tick'); } } // iOS: unlock audio inside a gesture
    function onBandTouch(e) { e.preventDefault(); }
    // a tap anywhere on the stage (but a column) while dice are tumbling or smashing skips ahead
    function onStageDown(e) {
      if (!animating || picking || (e.target.closest && e.target.closest('.gb-col.can'))) return;
      skipNow();
    }
    el.addEventListener('pointerdown', onStageDown);
    root.addEventListener('click', onClick);
    root.addEventListener('touchend', onTouchEnd);
    band.addEventListener('touchstart', onBandTouch, { passive: false });
    band.addEventListener('touchmove', onBandTouch, { passive: false });
    document.addEventListener('keydown', onKey);

    // ── environment ──
    function onTheme() {
      pal = readPalette(api);
      if (dv) { dv.setPalette(pal); setSides(); renderNow(); }
    }
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onTheme);
    const mo = new MutationObserver(onTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    function onVis() {
      paused = document.hidden;
      if (paused) { if (raf) cancelAnimationFrame(raf); raf = 0; }
      else { lastT = 0; renderNow(); kick(); }
    }
    document.addEventListener('visibilitychange', onVis);
    // A lost context stops every frame, so a roll or a hide that is waiting for its last frame would wait for ever.
    // Give the browser a moment to restore it; if it doesn't, play on with the flat dice (and go back to 3D if it
    // does come back later).
    const GL_GRACE_MS = 3000;
    let lostT = 0;
    let dv3 = null; // the 3D view, parked while flat dice are standing in for it
    /** Put the current die (if one is showing) back on whichever view is live. */
    function redrawDie() {
      const c = ctxNow;
      const s = c && c.state;
      if (!dv || !s || s.over || animating || isBlind() || dieN !== s.n) return;
      const yaw = (api.rand(s.seed, 'yaw', s.n) - 0.5) * 0.9;
      dv.roll(s.roll, s.turn === topW ? 'top' : 'bot', yaw, true);
      kick();
    }
    function glToFlat() {
      if (dead || !dv || dv.kind !== '3d' || !glLost) return;
      log('gl-flat');
      dv3 = dv;
      try { dv3.abort(); } catch (err) { console.warn('[bones] abort', err); }
      canvas.hidden = true;
      band.dataset.gl = '2d';
      dv = dieView2D($('.gb-die2d'));
      glLost = false;
      setSides();
      redrawDie();
    }
    function onLost(e) {
      e.preventDefault();
      glLost = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      band.dataset.gl = 'lost';
      clearTimeout(lostT);
      lostT = setTimeout(glToFlat, (T() && T().glGraceMs) || GL_GRACE_MS);
    }
    function onRestored() {
      clearTimeout(lostT);
      setTimeout(() => { // three.js re-creates its GL state in its own listener first
        if (dead) return;
        if (dv3) { // back from flat dice
          try { dv3.restore(); } catch (err) { console.warn('[bones] restore', err); dv3 = null; return; }
          try { dv.dispose(); } catch { /* ignore */ }
          $('.gb-die2d').hidden = true;
          dv = dv3; dv3 = null;
          canvas.hidden = false;
          setSides();
          dv.resize(band.clientWidth, band.clientHeight);
        } else if (dv) {
          try { dv.restore(); } catch (err) { console.warn('[bones] restore', err); }
        } else return;
        glLost = false;
        band.dataset.gl = 'ok';
        log('restored');
        lastT = 0;
        renderNow();
        redrawDie();
        kick();
      }, 0);
    }
    function useView(v) {
      clearTimeout(slowT);
      dv = v;
      setSides();
      if (dv.setZoom) dv.setZoom(root.classList.contains('is-land') ? 1.75 : 1);
      dv.resize(band.clientWidth, band.clientHeight);
      try { dv.compile(); } catch (err) { console.warn('[bones] warm-up', err); }
      renderNow();
      readyRes();
    }
    function fallback(note) {
      canvas.hidden = true;
      band.dataset.gl = '2d';
      useView(dieView2D($('.gb-die2d')));
      if (note) api.toast(note);
    }
    // A CDN that never answers would leave the game waiting for its dice forever: after a while,
    // play on with flat dice (and ignore three.js if it turns up later).
    const slowT = setTimeout(() => { if (!dead && !dv) fallback('The 3D dice are slow to load, so these are flat ones.'); }, (T() && T().slowMs) || SLOW_3D_MS);
    threeP.then((THREE) => {
      if (dead || dv) return;
      let v;
      try { v = dieView3D(THREE, canvas, pal, () => sfx('tick')); } catch (err) {
        console.warn('[bones] WebGL unavailable', err);
        fallback('3D dice aren’t available here, so these are flat ones.');
        return;
      }
      canvas.addEventListener('webglcontextlost', onLost, false);
      canvas.addEventListener('webglcontextrestored', onRestored, false);
      band.dataset.gl = 'ok';
      useView(v);
    }, () => {
      if (dead || dv) return;
      fallback('Couldn’t load the 3D dice, so these are flat ones.');
    });

    return {
      update(c) {
        ctxNow = c;
        if (!c || !c.state) return;
        if (openedOver === null) openedOver = !!c.over;
        // The match just ended on this phone: write the records now, before any animation, so a mover who
        // leaves during the finale still counts it (idempotent per match via last_id).
        if (c.over && !openedOver && !recap) recordMatch(c);
        if (c.mode === 'online' && c.me && c.me !== bottom) { bottom = c.me; topW = other(bottom); setSides(); }
        enqueue(sync);
      },
      destroy() {
        dead = true;
        clearTimeout(slowT);
        clearTimeout(lostT);
        clearTimeout(bandT);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        ro.disconnect();
        mo.disconnect();
        mq.removeEventListener('change', onTheme);
        document.removeEventListener('visibilitychange', onVis);
        document.removeEventListener('keydown', onKey);
        root.removeEventListener('click', onClick);
        el.removeEventListener('pointerdown', onStageDown);
        window.removeEventListener('resize', layout);
        root.removeEventListener('touchend', onTouchEnd);
        band.removeEventListener('touchstart', onBandTouch);
        band.removeEventListener('touchmove', onBandTouch);
        canvas.removeEventListener('webglcontextlost', onLost, false);
        canvas.removeEventListener('webglcontextrestored', onRestored, false);
        if (dv) { try { dv.dispose(); } catch (err) { console.warn('[bones] dispose', err); } }
        if (dv3) { try { dv3.dispose(); } catch { /* ignore */ } }
        dv = dv3 = null;
      },
    };
  },
});
