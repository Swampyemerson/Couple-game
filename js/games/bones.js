// Knucklebones: a quick dice duel. Each turn a d6 is rolled for you and you place it in one of
// your three columns. Matching dice multiply (value × count²), and placing a die knocks every die
// of the same value out of your opponent's facing column. Ends the moment a grid fills.
//
// Rules are pure: move = { col }. The roll for turn n is randInt(6, seed, 'roll', n) + 1, so both
// phones always see the same die. The 3D tumble is view-only.
import { registerGame, randInt } from './core.js';

// ── rules ─────────────────────────────────────────────────────────────
const ROWS = 3;
const COLS = 3;
const other = (w) => (w === 'a' ? 'b' : 'a');
const rollFor = (seed, n) => randInt(6, seed, 'roll', n) + 1;

/** Column score: each value counts value × count × count (4,4 = 16; 4,4,4 = 36; 3,4 = 7). */
function colScore(col) {
  const c = {};
  for (const v of col) c[v] = (c[v] || 0) + 1;
  let t = 0;
  for (const v of Object.keys(c)) t += Number(v) * c[v] * c[v];
  return t;
}
const gridScore = (g) => g.reduce((t, col) => t + colScore(col), 0);
const gridFull = (g) => g.every((col) => col.length >= ROWS);

function init({ first, seed }) {
  return {
    seed, turn: first === 'b' ? 'b' : 'a', n: 0, roll: rollFor(seed, 0),
    grids: { a: [[], [], []], b: [[], [], []] }, last: null, over: false,
  };
}
function next(s) { return s.over ? [] : [s.turn]; }
function apply(s, who, mv) {
  if (s.over) throw new Error('The game is over.');
  if (who !== s.turn) throw new Error('Hold on, it’s not your turn.');
  const col = mv ? mv.col : undefined;
  if (!Number.isInteger(col) || col < 0 || col >= COLS) throw new Error('Pick one of your three columns.');
  const mine = s.grids[who][col];
  if (mine.length >= ROWS) throw new Error('That column is full. Pick another one.');
  const value = s.roll;
  mine.push(value);
  const opp = other(who);
  const before = s.grids[opp][col];
  const after = before.filter((v) => v !== value);
  s.grids[opp][col] = after;
  s.last = { who, col, value, n: s.n, oppBefore: before.slice(), destroyed: before.length - after.length };
  s.n += 1;
  if (gridFull(s.grids.a) || gridFull(s.grids.b)) { s.over = true; s.roll = null; }
  else { s.turn = opp; s.roll = rollFor(s.seed, s.n); }
  return s;
}
function result(s) {
  const a = gridScore(s.grids.a);
  const b = gridScore(s.grids.b);
  if (a === b) return { winner: null, text: 'Dead even', sub: `${a} apiece. Rematch?` };
  return { winner: a > b ? 'a' : 'b', sub: `${Math.max(a, b)} to ${Math.min(a, b)}.` };
}
function score(s) { return { a: gridScore(s.grids.a), b: gridScore(s.grids.b) }; }

// ── view helpers ──────────────────────────────────────────────────────
const PIPS = {
  1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]], 6: [[0, 0], [1, 0], [2, 0], [0, 2], [1, 2], [2, 2]],
};
const pipHTML = (v) => (PIPS[v] || []).map(([r, c]) => `<i style="grid-area:${r + 1}/${c + 1}"></i>`).join('');
const dieHTML = (v, cls = '', extra = '') => `<span class="gb-die ${cls}" data-v="${v}"${extra}>${pipHTML(v)}</span>`;
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
  cam.position.set(0, CAM_TARGET_Y + CAM_DIST * Math.sin(CAM_EL), CAM_DIST * Math.cos(CAM_EL));
  cam.lookAt(0, CAM_TARGET_Y, 0);
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
    const visH = 2 * CAM_DIST * Math.tan(CAM_FOV * Math.PI / 360);
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
  endDelay: 1700,
  howTo: [
    'You roll a die each turn. Tap one of your columns (or press 1–3) to place it.',
    'Matching dice in a column multiply: 4 + 4 scores 16, three 4s score 36.',
    'Your die knocks out every die of that value in their facing column.',
    'It ends when a grid fills. Higher total wins.',
  ],
  init, next, apply, result, score,

  css: `
    .g-bones { --gb-die: 52px; --gb-gap: 7px; --gb-pad: 8px; --gb-band: 112px; --gb-side: 62px;
      flex: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0; padding: 4px 0 10px; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
    .g-bones .gb-board { width: 100%; max-width: 480px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
    .g-bones .gb-half { display: grid; grid-template-columns: var(--gb-side) auto var(--gb-side); justify-content: center; align-items: center; column-gap: 8px; row-gap: 6px; transition: opacity 0.4s; }
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
    .g-bones .gb-half.is-lose { opacity: 0.55; }
    .g-bones .gb-tray { display: grid; grid-template-columns: repeat(3, var(--gb-die)); column-gap: var(--gb-gap); padding: var(--gb-pad); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow); }
    .g-bones .gb-a .gb-tray { background: var(--p-a-soft); } .g-bones .gb-b .gb-tray { background: var(--p-b-soft); }
    .g-bones .gb-scores { display: grid; grid-template-columns: repeat(3, var(--gb-die)); column-gap: var(--gb-gap); padding: 0 calc(var(--gb-pad) + 2px); }
    .g-bones .gb-cs { justify-self: center; min-width: 34px; padding: 2px 8px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); font-weight: 900; font-size: 0.85rem; line-height: 1.3; text-align: center; font-variant-numeric: tabular-nums; }
    .g-bones .gb-cs.combo { background: var(--g-hl); color: var(--g-on-ink); }
    .g-bones .gb-cs.bump { animation: gb-bump 0.45s cubic-bezier(.3, 1.6, .5, 1); }
    .g-bones .gb-col { position: relative; z-index: 0; display: flex; flex-direction: column; gap: var(--gb-gap); margin: 0; padding: 0; border: 0; background: none; color: inherit; font: inherit; opacity: 1; touch-action: manipulation; -webkit-tap-highlight-color: transparent; cursor: default; border-radius: calc(var(--gb-die) * 0.26); }
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
    .g-bones .gb-band { position: relative; height: var(--gb-band); border: 2px solid var(--g-ink); border-radius: var(--g-radius); background: var(--g-card); box-shadow: var(--g-shadow); overflow: hidden; touch-action: none; }
    .g-bones .gb-band canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
    .g-bones .gb-lab { position: absolute; top: 50%; transform: translateY(-50%); max-width: 31%; display: flex; flex-direction: column; gap: 4px; font-weight: 900; font-size: 0.86rem; line-height: 1.15; pointer-events: none; }
    .g-bones .gb-lab-l { left: 12px; align-items: flex-start; }
    .g-bones .gb-lab-r { right: 12px; align-items: flex-end; text-align: right; color: var(--g-muted); font-weight: 800; }
    .g-bones .gb-kick { font-size: 0.62rem; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); }
    .g-bones .gb-arrow { width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; }
    .g-bones .gb-arrow.down { border-top: 9px solid var(--g-ink); }
    .g-bones .gb-arrow.up { border-bottom: 9px solid var(--g-ink); }
    .g-bones .gb-lab-r b { color: var(--g-ink); }
    .g-bones .gb-die2d { position: absolute; left: 50%; top: 50%; width: calc(var(--gb-band) * 0.52); height: calc(var(--gb-band) * 0.52); transform: translate(-50%, -50%); }
    .g-bones .gb-die2d .gb-die { box-shadow: var(--g-shadow); }
    .g-bones .gb-die2d.rolling .gb-die { animation: gb-tumble 0.8s cubic-bezier(.2, .7, .3, 1) both; }
    .g-bones .gb-die2d.from-top.rolling .gb-die { animation-name: gb-tumble-r; }
    @keyframes gb-hint { from { transform: scale(0.9); } to { transform: none; } }
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
      .g-bones .gb-die.is-new, .g-bones .gb-die.shift, .g-bones .gb-die.pulse, .g-bones .gb-cs.bump, .g-bones .gb-die2d.rolling .gb-die, .g-bones .gb-die.crack { animation: none; }
      .g-bones .gb-die.pop { animation: gb-fade 0.15s linear both; }
      .g-bones .gb-shard { display: none; }
      @keyframes gb-fade { to { opacity: 0; } }
    }
  `,

  mount(el, api) {
    const threeP = api.three(); // start loading at once
    threeP.catch(noop);
    el.innerHTML = `<div class="g-bones">
      <div class="gb-board">
        <section class="gb-half gb-top"><div class="gb-scores"></div><div class="gb-name"></div><div class="gb-tray"></div><div class="gb-total">0</div></section>
        <div class="gb-band" aria-live="polite">
          <canvas aria-hidden="true"></canvas>
          <div class="gb-die2d" hidden aria-hidden="true"></div>
          <div class="gb-lab gb-lab-l"></div>
          <div class="gb-lab gb-lab-r"></div>
        </div>
        <section class="gb-half gb-bot"><div class="gb-name"></div><div class="gb-tray"></div><div class="gb-total">0</div><div class="gb-scores"></div></section>
      </div>
    </div>`;
    const $ = (s) => el.querySelector(s);
    const root = $('.g-bones');
    const band = $('.gb-band');
    const canvas = band.querySelector('canvas');
    const labL = $('.gb-lab-l');
    const labR = $('.gb-lab-r');
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
    const log = (ev) => { const t = T(); if (t) (t.log || (t.log = [])).push(ev); };

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
    function layout() {
      const W = Math.min(el.clientWidth || 360, 480);
      const H = el.clientHeight || 600;
      const side = Math.round(Math.max(64, Math.min(96, W * 0.19)));
      const gap = 7; const pad = 8;
      const bandH = Math.round(Math.max(92, Math.min(156, H * 0.2)));
      const dieW = (W - 2 * side - 16 - 2 * pad - 2 * gap - 8) / 3;
      const fixed = bandH + 2 * 28 + 2 * (2 * pad + 2 * gap + 4) + 2 * 10 + 22;
      const dieH = (H - fixed) / 6;
      const die = Math.floor(Math.max(36, Math.min(66, dieW, dieH)));
      root.style.setProperty('--gb-die', `${die}px`);
      root.style.setProperty('--gb-side', `${side}px`);
      root.style.setProperty('--gb-band', `${bandH}px`);
      if (dv) { dv.resize(band.clientWidth, band.clientHeight); renderNow(); }
    }
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
              inner += [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([dx, dy], k) => `<b class="gb-shard" style="--dx:${dx * (18 + k * 3)}px;--dy:${dy * (16 + k * 4)}px;--r:${(k % 2 ? 1 : -1) * 120}deg"></b>`).join('');
            }
          } else if (pick && r === col.length) inner = dieHTML(o.roll, 'ghost');
          slots += `<span class="gb-slot${v ? ' full' : ''}">${inner}</span>`;
        }
        const can = pick && col.length < ROWS;
        const label = `Column ${ci + 1}: ${col.length ? col.join(', ') : 'empty'}. Scores ${colScore(col)}.${can ? ' Place your die here.' : ''}`;
        return `<button type="button" class="gb-col${can ? ' can' : ''}" data-col="${ci}" aria-label="${label}"${can ? '' : ' disabled'}>${slots}</button>`;
      }).join('');
    }
    function scoresHTML(grid, bumpCol) {
      return grid.map((col, ci) => {
        const combo = col.some((v) => col.indexOf(v) !== col.lastIndexOf(v));
        return `<span class="gb-cs${combo ? ' combo' : ''}${bumpCol === ci ? ' bump' : ''}">${colScore(col)}</span>`;
      }).join('');
    }
    function draw(grids, o = {}) {
      const s = ctxNow && ctxNow.state;
      for (const [k, w] of [['top', topW], ['bot', bottom]]) {
        const h = halves[k];
        const tray = h.querySelector('.gb-tray');
        tray.innerHTML = trayHTML(w, grids[w], o);
        tray.classList.toggle('is-picking', o.pick === w);
        h.querySelector('.gb-scores').innerHTML = scoresHTML(grids[w], o.bump && o.bump.who === w ? o.bump.col : -1);
        h.querySelector('.gb-total').textContent = gridScore(grids[w]);
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
    function setBand(mode, w, value) {
      const arrow = w === bottom ? 'down' : 'up';
      const nm = whoLabel(w);
      if (mode === 'over') {
        labL.innerHTML = '';
        labR.innerHTML = '';
        return;
      }
      labL.innerHTML = `<span class="gb-kick">${nm === 'You' ? 'Your roll' : 'Rolling for'}</span><span class="gb-wn"></span><span class="gb-arrow ${arrow}" aria-hidden="true"></span>`;
      labL.querySelector('.gb-wn').textContent = nm === 'You' ? '' : nm;
      if (mode === 'rolling') labR.innerHTML = '';
      else if (mode === 'pick') labR.innerHTML = `<b>Rolled ${value}</b><span>${coarse() ? 'Pick a column' : 'Pick a column, or press 1–3'}</span>`;
      else labR.innerHTML = `<b>Rolled ${value}</b><span class="gb-wait"></span>`;
      const wt = labR.querySelector('.gb-wait');
      if (wt) wt.textContent = `${api.name(w)} is choosing`;
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
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms)).then(() => { if (dead) throw DEAD; });

    async function roll(value, w, n) {
      dieN = n;
      log(`roll:${value}`);
      setBand('rolling', w);
      band.dataset.roll = '';
      const s = ctxNow.state;
      const yaw = (api.rand(s.seed, 'yaw', n) - 0.5) * 0.9;
      const p = dv.roll(value, w === topW ? 'top' : 'bot', yaw, reduced());
      kick();
      await p;
      if (dead) throw DEAD;
      band.dataset.roll = String(value);
      api.sfx('flip');
    }
    async function place(L, pre, s) {
      const rm = reduced();
      const opp = other(L.who);
      const mid = cloneGrids(pre);
      mid[L.who][L.col].push(L.value);
      log('place');
      labR.innerHTML = `<b>Rolled ${L.value}</b><span>Column ${L.col + 1}</span>`;
      const hidden = dv.hide(rm);
      kick();
      draw(mid, { newAt: { who: L.who, col: L.col }, bump: { who: L.who, col: L.col } });
      api.sfx('place');
      api.haptic(10);
      await hidden;
      await sleep(rm ? 60 : 300);
      if (L.destroyed > 0) {
        draw(mid, { doomed: { who: opp, col: L.col, value: L.value, stage: 'crack' } });
        log('crack');
        labR.innerHTML = `<b>Smash</b><span>${L.destroyed === 1 ? 'One die' : `${L.destroyed} dice`} knocked out</span>`;
        api.sfx('hit');
        api.haptic(30);
        await sleep(rm ? 60 : 330);
        draw(mid, { doomed: { who: opp, col: L.col, value: L.value, stage: 'pop' } });
        api.sfx('pop');
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
        api.sfx('good');
        await sleep(rm ? 40 : 420);
      } else {
        draw(s.grids);
        await sleep(rm ? 20 : 120);
      }
    }

    // ── sync the view to the rules state ──
    let chain = Promise.resolve();
    function enqueue(fn) {
      chain = chain.then(() => (dead ? null : fn())).catch((e) => { if (e !== DEAD) console.error('[bones]', e); });
    }
    async function sync() {
      for (;;) {
        const c = ctxNow;
        if (dead || !c || !c.state) return;
        const s = c.state;
        if (c.moves === shownMoves) break;
        const first = shownMoves < 0;
        const L = s.last;
        picking = false;
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
      await ready;
      if (c.over) { finale(c); return; }
      if (dieN !== s.n) await roll(s.roll, s.turn, s.n);
      if (ctxNow !== c && ctxNow.moves !== shownMoves) return; // a newer move is queued
      showIdle();
    }
    function showIdle() {
      const c = ctxNow;
      if (!c || !c.state || c.over) return;
      const s = c.state;
      picking = !!c.canMove && dieN === s.n;
      const actor = s.turn;
      let threat = null;
      if (picking) {
        const cols = [0, 1, 2].filter((i) => s.grids[actor][i].length < ROWS);
        threat = { who: other(actor), value: s.roll, cols };
      }
      draw(s.grids, picking ? { pick: actor, roll: s.roll, threat } : {});
      setBand(picking ? 'pick' : 'wait', actor, s.roll);
      root.dataset.phase = picking ? 'pick' : 'wait';
    }
    function finale(c) {
      const s = c.state;
      root.dataset.phase = 'over';
      draw(s.grids, { noTurn: true });
      setBand('over');
      dv.hide(true);
      kick();
      if (finaleDone) return;
      finaleDone = true;
      log('finale');
      const r = c.result || result(s);
      for (const [k, w] of [['top', topW], ['bot', bottom]]) {
        halves[k].classList.toggle('is-win', r.winner === w);
        halves[k].classList.toggle('is-lose', !!r.winner && r.winner !== w);
      }
      labL.innerHTML = `<span class="gb-kick">Final</span><span class="gb-wn"></span>`;
      labL.querySelector('.gb-wn').textContent = r.winner ? `${whoLabel(r.winner) === 'You' ? 'You win' : `${api.name(r.winner)} wins`}` : 'A draw';
      labR.innerHTML = `<b>${gridScore(s.grids[bottom])} – ${gridScore(s.grids[topW])}</b>`;
    }

    // ── input ──
    function pick(col) {
      const c = ctxNow;
      if (!picking || !c || !c.canMove || c.over) return;
      const g = c.state.grids[c.actor] && c.state.grids[c.actor][col];
      if (!g) return;
      if (g.length >= ROWS) { api.toast('That column is full. Pick another one.'); api.sfx('bad'); return; }
      picking = false;
      root.dataset.phase = 'busy';
      api.sfx('tap');
      const r = api.move({ col });
      if (!r.ok) { api.toast(r.error); showIdle(); }
    }
    function onClick(e) {
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
    function onTouchEnd() { if (!unlocked) { unlocked = true; api.sfx('tick'); } } // iOS: unlock audio inside a gesture
    function onBandTouch(e) { e.preventDefault(); }
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
    function onLost(e) {
      e.preventDefault();
      glLost = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      band.dataset.gl = 'lost';
    }
    function onRestored() {
      setTimeout(() => { // three.js re-creates its GL state in its own listener first
        if (dead || !dv) return;
        try { dv.restore(); } catch (err) { console.warn('[bones] restore', err); }
        glLost = false;
        band.dataset.gl = 'ok';
        log('restored');
        lastT = 0;
        renderNow();
        kick();
      }, 0);
    }
    function useView(v) {
      clearTimeout(slowT);
      dv = v;
      setSides();
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
      try { v = dieView3D(THREE, canvas, pal, () => api.sfx('tick')); } catch (err) {
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
        if (c.mode === 'online' && c.me && c.me !== bottom) { bottom = c.me; topW = other(bottom); setSides(); }
        enqueue(sync);
      },
      destroy() {
        dead = true;
        clearTimeout(slowT);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        ro.disconnect();
        mo.disconnect();
        mq.removeEventListener('change', onTheme);
        document.removeEventListener('visibilitychange', onVis);
        document.removeEventListener('keydown', onKey);
        root.removeEventListener('click', onClick);
        root.removeEventListener('touchend', onTouchEnd);
        band.removeEventListener('touchstart', onBandTouch);
        band.removeEventListener('touchmove', onBandTouch);
        canvas.removeEventListener('webglcontextlost', onLost, false);
        canvas.removeEventListener('webglcontextrestored', onRestored, false);
        if (dv) { try { dv.dispose(); } catch (err) { console.warn('[bones] dispose', err); } }
        dv = null;
      },
    };
  },
});
