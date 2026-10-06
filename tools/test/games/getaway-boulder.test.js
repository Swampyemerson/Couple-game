// Getaway: the Boulder map (js/games/getaway/maps/boulder*.js) against docs/games/getaway-maps.md.
//   node tools/test/games/getaway-boulder.test.js
//   ONLY=static | engine | sheet     PORT=8940 (uses PORT only; keep within 8940–8944)
//   SHOTS=dir (default: $TMPDIR/getaway-boulder-shots)   QUALITY=high|mid|low   DARK=1
//
// static  Node: contract shape, determinism, spawns (same road, cop 60–100 m behind, clear of
//         solids and water, yaw = compass bearing along the road), landmarks (the home at 3865
//         Moorhead), real-world sanity (street bearings, Moorhead's line through the surveyed
//         house points), solids kinds/styles/drawn, drawn solids off the roads, roads out of the
//         water, road grades ≤ 12 %, every road connected, prepare() slices, height() speed.
// engine  Chromium: the engine's own buildWorld() on the map; budgets (total tris, build time,
//         longest block, draw calls + triangles at chase-cam views with the engine's culling,
//         canvas textures), no page errors, screenshots of the key spots + a labelled plan.
// sheet   the "real vs map" sanity sheet (bearings and positions) as a PNG.
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { pathToFileURL } = require('url');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'getaway-boulder-shots');
const PORT = Number(process.env.PORT) || 8940;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const BUDGET = { calls: 90, viewTris: 220000, totalTris: 900000, buildMs: 1500, blockMs: 200, textures: 2 };
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log('FAIL -', m); return false; } console.log('ok -', m); return true; };
const warn = (c, m) => { console.log(c ? 'ok -' : 'WARN -', m); return c; };
fs.mkdirSync(SHOTS, { recursive: true });
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const bearing = (dx, dz) => ((Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360; // compass, north = −z

// ─────────────────────────────────────────────────────────────────────
async function staticSection() {
  console.log('\n# static');
  const { BOULDER: M } = await imp('js/games/getaway/maps/boulder.js');
  const D = await imp('js/games/getaway/maps/boulder-data.js');
  const L = await imp('js/games/getaway/maps/boulder-layout.js');
  const { createGeo } = await imp('js/games/getaway/geo.js');

  ok(M.id === 'boulder' && M.name === 'Boulder' && !M.stub, 'boulder: a real map (no stub flag)');
  const B = M.bounds; const bw = B.x1 - B.x0; const bh = B.z1 - B.z0;
  ok(bw >= 1200 && bw <= 2700 && bh >= 1200 && bh <= 2700, `bounds ${bw} × ${bh} m (scale ${D.S})`);
  ok(['build', 'backdrop', 'height', 'prepare'].every((k) => typeof M[k] === 'function'), 'build, backdrop, height and prepare are functions');

  // prepare() in slices
  const t0 = Date.now(); let tl = Date.now(); let worst = 0; let n = 0;
  await M.prepare({ slice: () => { const t = Date.now(); worst = Math.max(worst, t - tl); n++; tl = Date.now(); return Promise.resolve(); } });
  worst = Math.max(worst, Date.now() - tl);
  warn(worst <= 70, `prepare(): ${Date.now() - t0} ms in ${n} slices, longest ${worst} ms (≤ 70 wanted)`);

  const KINDS = ['highway', 'arterial', 'street', 'alley', 'dirt', 'ramp'];
  const badRoad = M.roads.filter((r) => !KINDS.includes(r.kind) || !(r.width >= 4 && r.width <= 40) || r.pts.length < 2 || r.pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1])));
  ok(M.roads.length > 60 && !badRoad.length, `${M.roads.length} roads, kinds/widths/points valid${badRoad.length ? ': ' + badRoad.map((r) => r.name).join(', ') : ''}`);
  let close = 0; for (const r of M.roads) for (let i = 1; i < r.pts.length; i++) if (Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]) < 7.99) close++;
  ok(close === 0, `road points ≥ 8 m apart (${close} too close)`);
  const names = new Set(M.roads.map((r) => r.name));
  for (const nm of ['Pearl St', 'Broadway', 'Canyon Blvd', 'Arapahoe Ave', 'Walnut St', 'Spruce St', 'Pine St', 'Baseline Rd', '28th St', '30th St', 'Folsom St', 'Foothills Pkwy', 'Colorado Ave', 'US-36 Boulder Turnpike', 'Flagstaff Rd', 'Moorhead Ave', 'Martin Dr', 'Table Mesa Dr', 'Boulder Creek Path', '9th St', '13th St', '35th St', 'Valmont Rd']) ok(names.has(nm), `road: ${nm}`);
  ok(M.roads.filter((r) => r.bridge).length >= 8, `${M.roads.filter((r) => r.bridge).length} bridges (creek crossings + Table Mesa over US-36)`);
  ok(M.roads.filter((r) => r.kind === 'ramp').length >= 2, 'US-36 ramps');

  // determinism: a second Node process builds the same layout
  const hashOf = (o) => { let h = 2166136261; const s = JSON.stringify(o); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
  const mine = hashOf({ s: M.solids, sp: M.spawns, o: M.open });
  const other = execSync(`node --input-type=module -e "const {BOULDER:M}=await import('${pathToFileURL(path.join(ROOT, 'js/games/getaway/maps/boulder.js')).href}'); const s=JSON.stringify({s:M.solids,sp:M.spawns,o:M.open}); let h=2166136261; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;} console.log(h);"`).toString().trim();
  ok(String(mine) === other, `deterministic layout (hash ${mine})`);

  const geo = createGeo(M);
  const nq = { road: -1 };
  // spawns
  ok(M.spawns.length >= 8, `${M.spawns.length} spawn pairs`);
  for (const [i, s] of M.spawns.entries()) {
    const a = {}; const b = {};
    geo.nearestRoad(s.runner.x, s.runner.z, a, 30); geo.nearestRoad(s.cop.x, s.cop.z, b, 30);
    const gap = Math.hypot(s.runner.x - s.cop.x, s.runner.z - s.cop.z);
    const sameRoad = a.road >= 0 && b.road >= 0 && geo.roads[a.road].name === geo.roads[b.road].name;
    const hx = Math.sin(s.runner.yaw); const hz = -Math.cos(s.runner.yaw);
    const along = Math.abs(hx * a.tx + hz * a.tz) > 0.9; const behind = (s.runner.x - s.cop.x) * hx + (s.runner.z - s.cop.z) * hz > 50;
    let hit = null;
    for (const p of [s.runner, s.cop]) geo.eachSolid(p.x, p.z, 6, (o) => { const ax = p.x - o.x; const az = p.z - o.z; const lx = ax * o.c - az * o.s; const lz = ax * o.s + az * o.c; if (Math.abs(lx) < o.hw + 1.6 && Math.abs(lz) < o.hd + 2.6) hit = `${o.kind}${o.style ? ':' + o.style : ''}`; });
    const wet = geo.inWater(s.runner.x, s.runner.z) || geo.inWater(s.cop.x, s.cop.z);
    ok(sameRoad && gap >= 60 && gap <= 100 && along && behind && !hit && !wet && a.d < geo.roads[a.road].hw && s.where, `spawn ${i} "${s.where}": ${geo.roads[a.road] && geo.roads[a.road].name}, cop ${gap.toFixed(0)} m behind, yaw ${(s.runner.yaw * 180 / Math.PI).toFixed(0)}°${hit ? ', HIT ' + hit : ''}${wet ? ', WET' : ''}`);
  }
  ok(M.spawns.some((s) => Math.hypot(s.runner.x - D.HOME.x, s.runner.z - D.HOME.z) < 450), 'a spawn pair in Martin Acres near the home');
  // landmarks
  const home = M.landmarks.find((l) => l.home);
  ok(home && home.name === '3865 Moorhead', `home landmark "${home && home.name}" at ${home && home.x.toFixed(0)}, ${home && home.z.toFixed(0)}`);
  for (const nm of ['Pearl St Mall', 'Courthouse', 'Folsom Field', 'Norlin Quad', 'Chautauqua', 'Twenty Ninth St', 'Boulder High', 'Central Park', 'Valmont']) ok(M.landmarks.some((l) => l.name === nm), `landmark: ${nm}`);
  ok(M.landmarks.filter((l) => l.far).length >= 3, `${M.landmarks.filter((l) => l.far).length} far landmarks (Front Range)`);

  // real-world sanity
  const roadBearing = (name, nth = 0) => { const r = M.roads.filter((o) => o.name === name && !o.bridge)[nth]; const a = r.pts[0]; const b = r.pts[r.pts.length - 1]; return bearing(b[0] - a[0], b[1] - a[1]) % 180; };
  ok(Math.abs(roadBearing('Pearl St') - 90) < 0.5, 'Pearl St runs due east–west (downtown grid on the compass)');
  ok(Math.abs(roadBearing('Broadway') - 0) < 0.5 || Math.abs(roadBearing('Broadway') - 180) < 0.5, 'Broadway runs due north–south downtown');
  ok(Math.abs(roadBearing('Baseline Rd') - 90) < 0.5, 'Baseline Rd runs along the 40th parallel (east–west)');
  ok(Math.abs(roadBearing('Moorhead Ave') - 126) < 3, `Moorhead Ave bears ${roadBearing('Moorhead Ave').toFixed(1)}° (surveyed 126°)`);
  ok(Math.abs(roadBearing('US-36 Boulder Turnpike') - 126) < 4, `US-36 bears ${roadBearing('US-36 Boulder Turnpike').toFixed(1)}° south-east from Baseline`);
  const sr = M.roads.find((r) => r.name === 'Moorhead Ave');
  let worstOff = 0;
  for (const [nm, la, lo] of D.CHECKS.filter((c) => /Moorhead/.test(c[0]))) {
    const [x, z] = D.P(la, lo); let best = Infinity;
    for (let i = 0; i < sr.pts.length - 1; i++) { const [ax, az] = sr.pts[i]; const [bx, bz] = sr.pts[i + 1]; const dx = bx - ax; const dz = bz - az; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz))); best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t)); }
    worstOff = Math.max(worstOff, best); void nm;
  }
  ok(worstOff < 12.5, `Moorhead Ave (a straight line, as in town) passes within ${worstOff.toFixed(1)} m (map) of every surveyed house point`);
  const hb = M.solids.filter((s) => s.kind === 'building').reduce((a, s) => { const d = Math.hypot(s.x - D.HOME.x, s.z - D.HOME.z); return d < a.d ? { d, s } : a; }, { d: Infinity });
  ok(hb.d < 8, `the home's house stands ${hb.d.toFixed(1)} m from its address point`);

  // solids
  const KS = ['building', 'wall', 'rock', 'tree', 'pole', 'barrier', 'bollard'];
  const badS = M.solids.filter((s) => !KS.includes(s.kind) || !Number.isFinite(s.x + s.z + s.w + s.d + s.h + s.rot));
  ok(!badS.length, `${M.solids.length} solids, kinds valid`);
  const breakables = M.solids.filter((s) => !s.drawn);
  ok(breakables.every((s) => ['tree', 'pole', 'bollard'].includes(s.kind) && s.style), `${breakables.length} engine-drawn props (all small kinds with a style)`);
  const onRoad = [];
  for (const s of M.solids) {
    if (s.kind === 'barrier' || s.kind === 'bollard') continue; // rails, medians and mall bollards sit on purpose
    geo.nearestRoad(s.x, s.z, nq, 40, (r) => !r.bridge && r.kind !== 'alley');
    if (nq.road >= 0 && nq.d < geo.roads[nq.road].hw - 0.2) onRoad.push(`${s.kind}${s.style ? ':' + s.style : ''}@${s.x.toFixed(0)},${s.z.toFixed(0)}`);
  }
  // big drawn solids: every corner and edge midpoint stays off the asphalt
  for (const s of M.solids) {
    if (!s.drawn || s.kind === 'barrier' || s.w < 3) continue;
    const c = Math.cos(s.rot); const sn = Math.sin(s.rot);
    for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, -0.5], [0, 0.5], [-0.5, 0], [0.5, 0]]) {
      const lx = a * s.w; const lz = b * s.d; const x = s.x + lx * c + lz * sn; const z = s.z - lx * sn + lz * c;
      geo.nearestRoad(x, z, nq, 40, (r) => !r.bridge);
      if (nq.road >= 0 && nq.d < geo.roads[nq.road].hw - 0.6) { onRoad.push(`${s.kind} edge@${s.x.toFixed(0)},${s.z.toFixed(0)} on ${geo.roads[nq.road].name}`); break; }
    }
  }
  ok(onRoad.length === 0, `solids clear of the road surfaces${onRoad.length ? ': ' + onRoad.slice(0, 8).join('; ') : ''}`);
  let wet = 0; for (const r of geo.roads) { if (r.bridge) continue; for (let i = 0; i < r.n; i += 2) if (geo.inWater(r.x[i], r.z[i])) wet++; }
  ok(wet === 0, `no road runs into the water outside bridges (${wet} samples)`);
  let steep = 0; let steepest = 0;
  for (const r of geo.roads) { if (r.bridge) continue; for (let i = 1; i < r.n; i++) { const dl = r.cum[i] - r.cum[i - 1]; if (dl < 1) continue; const g = Math.abs(geo.ground(r.x[i], r.z[i]) - geo.ground(r.x[i - 1], r.z[i - 1])) / dl; steepest = Math.max(steepest, g); if (g > 0.12) steep++; } }
  ok(steep === 0, `road grades ≤ 12 % (steepest ${(steepest * 100).toFixed(1)} %)`);
  const th = Date.now(); let acc = 0;
  for (let i = 0; i < 200000; i++) acc += M.height(B.x0 + (i * 13.7) % bw, B.z0 + (i * 7.3) % bh);
  ok(Number.isFinite(acc) && Date.now() - th < 150, `height(): 200k calls in ${Date.now() - th} ms`);
  // connectivity
  const R = geo.roads; const adj = R.map(() => []);
  for (let a = 0; a < R.length; a++) for (const i of [0, R[a].n - 1, ...Array.from({ length: Math.floor(R[a].n / 3) }, (_, k) => k * 3)]) {
    geo.nearestRoad(R[a].x[i], R[a].z[i], nq, 40, (o) => o !== R[a]);
    if (nq.road >= 0 && nq.d < R[nq.road].hw + R[a].hw + 2) { adj[a].push(nq.road); adj[nq.road].push(a); }
  }
  const seen = new Set([R.findIndex((r) => r.name === 'Broadway')]); const q = [...seen];
  while (q.length) { const a = q.pop(); for (const b of adj[a]) if (!seen.has(b)) { seen.add(b); q.push(b); } }
  const lost = R.filter((r, i) => !seen.has(i)).map((r) => r.name || '(unnamed)');
  ok(lost.length === 0, `all ${R.length} road pieces connected${lost.length ? ': missing ' + lost.join(', ') : ''}`);
  // dead ends: every road end meets another road (closed loops have none)
  const dead = [];
  for (const r of R) {
    if (r.closed) continue;
    for (const i of [0, r.n - 1]) { geo.nearestRoad(r.x[i], r.z[i], nq, 40, (o) => o !== r); if (!(nq.road >= 0 && nq.d < R[nq.road].hw + r.hw + 2)) dead.push(`${r.name || '(unnamed)'}@${r.x[i].toFixed(0)},${r.z[i].toFixed(0)}`); }
  }
  warn(dead.length <= 2, `dead ends: ${dead.length ? dead.join('; ') : 'none'}`);
  return M;
}

// ─────────────────────────────────────────────────────────────────────
function threePath() {
  const out = path.join(__dirname, '..', '.cache', 'three.min.js');
  if (fs.existsSync(out)) return out;
  const dir = path.dirname(out); fs.mkdirSync(dir, { recursive: true });
  execSync('npm pack three@0.128.0 --silent', { cwd: dir, stdio: 'pipe' });
  execSync('tar -xzf three-0.128.0.tgz package/build/three.min.js', { cwd: dir });
  fs.renameSync(path.join(dir, 'package/build/three.min.js'), out);
  return out;
}
const PAGE = `<!doctype html><meta charset="utf-8"><style>body{margin:0;overflow:hidden;background:#000}canvas{display:block}#lab{position:absolute;left:0;top:0}</style>
<script src="/three.min.js"></script>
<script type="module">
const q = new URLSearchParams(location.search);
let W = +q.get('w'), Hh = +q.get('h'); const dark = q.get('dark') === '1';
const texs = []; const TT = THREE.CanvasTexture; THREE.CanvasTexture = class extends TT { constructor(...a) { super(...a); texs.push(this); } };
const { BOULDER: M } = await import('/js/games/getaway/maps/boulder.js');
const { makePalette, makeUniforms } = await import('/js/games/getaway/gfx.js');
const { createGeo } = await import('/js/games/getaway/geo.js');
const { buildWorld } = await import('/js/games/getaway/world.js');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setSize(W, Hh); renderer.setPixelRatio(1); renderer.autoClear = false;
document.body.appendChild(renderer.domElement);
const lab = document.createElement('canvas'); lab.id = 'lab'; lab.width = W; lab.height = Hh; document.body.appendChild(lab);
let maxPrep = 0, t = performance.now();
const tp = performance.now();
await M.prepare({ slice: () => { maxPrep = Math.max(maxPrep, performance.now() - t); return new Promise((r) => setTimeout(() => { t = performance.now(); r(); }, 0)); } });
maxPrep = Math.max(maxPrep, performance.now() - t);
const prepMs = performance.now() - tp;
const P = makePalette(dark ? { bg: '#16151c', ink: '#f1eee8', dark: true } : { bg: '#f6f3ee', ink: '#1c1a22' });
const U = makeUniforms(THREE, P);
const geo = createGeo(M);
const world = await buildWorld(THREE, M, geo, P, U, { quality: q.get('quality') || 'high' });
const camera = new THREE.PerspectiveCamera(62, W / Hh, 0.5, 4000);
const far = new THREE.PerspectiveCamera(62, W / Hh, 5, 60000);
const car = (b, t2) => { const g = new THREE.Group(); const m1 = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 4.5), new THREE.MeshBasicMaterial({ color: b })); m1.position.y = 0.75; const m2 = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), new THREE.MeshBasicMaterial({ color: t2 })); m2.position.set(0, 1.45, 0.2); g.add(m1, m2); return g; };
const runner = car(0xd23a2a, 0x2a2a30), cop = car(0x15161a, 0xf2f2f2); world.scene.add(runner, cop);
const place = (c, p) => { c.position.set(p.x, M.height(p.x, p.z), p.z); c.rotation.y = -p.yaw; };
const draw = (cam) => {
  far.position.copy(cam.position); far.quaternion.copy(cam.quaternion); far.fov = cam.fov; far.aspect = cam.aspect; far.updateProjectionMatrix();
  world.update(cam, 0.016, 1);
  renderer.info.reset(); renderer.info.autoReset = false;
  renderer.clear(); renderer.render(world.farScene, far); renderer.clearDepth(); renderer.render(world.scene, cam);
  return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
};
// chase camera: yaw is a compass bearing (heading = (sin yaw, −cos yaw))
window.view = (v) => {
  lab.getContext('2d').clearRect(0, 0, W, Hh);
  if (v.spawn != null) { const s = M.spawns[v.spawn]; place(runner, s.runner); place(cop, s.cop); v = { x: s.runner.x, z: s.runner.z, yaw: s.runner.yaw, ...v }; }
  else { place(runner, v); const hx = Math.sin(v.yaw), hz = -Math.cos(v.yaw); place(cop, { x: v.x - hx * 70, z: v.z - hz * 70, yaw: v.yaw }); }
  const hx = Math.sin(v.yaw), hz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = Math.sin(v.yaw);
  const back = v.back ?? 7.4, up = v.up ?? 2.9, side = v.side ?? 0, gy = M.height(v.x, v.z);
  const cx = v.x - hx * back + rx * side, cz = v.z - hz * back + rz * side;
  camera.position.set(cx, Math.max(gy + up, M.height(cx, cz) + 1.2), cz);
  camera.lookAt(v.x + hx * 5, gy + 1.3 + (v.lookUp || 0), v.z + hz * 5);
  camera.fov = v.fov || 62; camera.aspect = W / Hh; camera.updateProjectionMatrix();
  if (M.animate) M.animate(v.t ?? 2, [{ x: runner.position.x, z: runner.position.z }]);
  return draw(camera);
};
window.plan = (labels) => {
  W = innerWidth; Hh = innerHeight; renderer.setSize(W, Hh); lab.width = W; lab.height = Hh;
  const B = M.bounds; const pad = 30; const ow = (B.x1 - B.x0) + pad * 2, oh = (B.z1 - B.z0) + pad * 2; const asp = W / Hh;
  let hw = ow / 2, hh = oh / 2; if (hw / hh < asp) hw = hh * asp; else hh = hw / asp;
  const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
  const oc = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 1, 6000); oc.position.set(cx, 3000, cz); oc.up.set(0, 0, -1); oc.lookAt(cx, 0, cz); oc.updateProjectionMatrix();
  runner.visible = cop.visible = false;
  const fog = world.scene.fog; const fn = fog.near, ff = fog.far; fog.near = 1e8; fog.far = 1e9;
  for (const c of world.chunks) c.group.visible = true;
  renderer.info.reset(); renderer.clear(); world.sky.visible = false; renderer.render(world.farScene, oc); world.sky.visible = true; renderer.clearDepth(); renderer.render(world.scene, oc);
  fog.near = fn; fog.far = ff; runner.visible = cop.visible = true;
  const g = lab.getContext('2d'); g.clearRect(0, 0, W, Hh);
  const Pp = (x, z) => [(x - cx + hw) / (2 * hw) * W, (z - cz + hh) / (2 * hh) * Hh];
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2; const [a0, b0] = Pp(B.x0, B.z0); const [a1, b1] = Pp(B.x1, B.z1); g.strokeRect(a0, b0, a1 - a0, b1 - b0);
  for (const l of labels) {
    const [px, py] = Pp(l.x, l.z);
    if (l.dot) { g.fillStyle = l.color || '#fff'; g.beginPath(); g.arc(px, py, l.home ? 8 : 5, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke(); }
    g.save(); g.translate(px + (l.dot ? 0 : 0), py - (l.dot ? 14 : 0)); g.rotate(l.rot || 0);
    g.font = (l.bold ? 'bold ' : '') + (l.size || 13) + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 3.5; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.strokeText(l.text, 0, 0); g.fillStyle = l.color || '#fff'; g.fillText(l.text, 0, 0); g.restore();
  }
  g.save(); g.translate(W - 70, 80); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -40); g.lineTo(16, 12); g.lineTo(0, 3); g.lineTo(-16, 12); g.closePath(); g.fill(); g.stroke(); g.font = 'bold 24px sans-serif'; g.textAlign = 'center'; g.strokeText('N', 0, 38); g.fillText('N', 0, 38); g.restore();
  const [s0, sy] = Pp(B.x0 + 40, B.z1 - 30); const [s1] = Pp(B.x0 + 540, 0); g.fillStyle = '#fff'; g.fillRect(s0, sy, s1 - s0, 7); g.font = 'bold 14px sans-serif'; g.textAlign = 'left'; g.lineWidth = 3; g.strokeStyle = '#000'; g.strokeText('500 m on the map = 1.1 km in Boulder (scale 0.45)', s0, sy - 12); g.fillText('500 m on the map = 1.1 km in Boulder (scale 0.45)', s0, sy - 12);
  return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
};
window.split = (v) => { const r0 = window.view(v); const mine = []; world.scene.traverse((o) => { if (o.name === 'boulder-chunk') mine.push(o); }); mine.forEach((o) => { o.visible = false; }); const r1 = window.view(v); mine.forEach((o) => { o.visible = true; }); return { all: r0.tris, engine: r1.tris, map: r0.tris - r1.tris }; };
window.setSize = (w, h) => { W = w; Hh = h; renderer.setSize(w, h); lab.width = w; lab.height = h; };
// the lead's perf sampling: spawns + road points, 4 headings, near and far chase cams
window.sample = () => {
  const out = []; const pts = M.spawns.map((s) => s.runner);
  const rs = geo.roads.filter((r) => !r.bridge);
  for (let i = 0; i < 24; i++) { const r = rs[(i * 7919) % rs.length]; const o = {}; geo.sampleRoad(r, r.len * ((i % 5) + 1) / 6, o); pts.push({ x: o.x, z: o.z, yaw: Math.atan2(o.tx, -o.tz) }); }
  for (const p of pts) for (let k = 0; k < 4; k++) {
    const far2 = k === 3; const r = window.view({ x: p.x, z: p.z, yaw: (p.yaw || 0) + k * Math.PI / 2, back: far2 ? 12.5 : 7.4, up: far2 ? 5.6 : 2.9, fov: 60 });
    out.push({ ...r, x: Math.round(p.x), z: Math.round(p.z), k });
  }
  return out;
};
window.__stats = { prepMs, maxPrep, world: world.stats, mapStats: (world.scene.getObjectByName('boulder') || { userData: {} }).userData.stats, textures: texs.length, texSizes: texs.map((x) => [x.image.width, x.image.height]) };
document.title = 'ready';
</script>`;

async function serve() {
  const three = threePath();
  const types = { '.js': 'text/javascript', '.html': 'text/html' };
  return http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/boulder.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return; }
    if (u === '/sheet.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(global.SHEET || ''); return; }
    const f = u === '/three.min.js' ? three : path.join(ROOT, u);
    if (!f.startsWith(ROOT) && f !== three) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
  }).listen(PORT);
}
function chromium() {
  const PW = process.env.PW || path.join(execSync('npm root -g').toString().trim(), 'playwright');
  return require(PW).chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
}

async function views() {
  const D = await imp('js/games/getaway/maps/boulder-data.js');
  const L = await imp('js/games/getaway/maps/boulder-layout.js');
  const sp = (road, f, dir = 1, nth = 0) => L.pickSpawn(road, f, 80, dir, nth).runner;
  const yawSE = Math.atan2(D.US36.dx, -D.US36.dz);
  const hs = D.moorPt(D.HOME_T - 24, -2);
  const hf = D.moorPt(D.HOME_T - 1, -2.5);
  return [
    { name: '01-pearl-st-downtown', ...sp('Pearl St', 0.06, -1, 1), lookUp: 1 },
    { name: '02-pearl-st-mall', x: 112, z: 0.5, yaw: -Math.PI / 2 },
    { name: '03-courthouse', x: 65, z: 2, yaw: 0, back: 10, up: 3.4, lookUp: 5 },
    { name: '04-broadway-by-cu', ...sp('Broadway', 0.3, 1, 1) },
    { name: '05-norlin-quad', x: 236, z: 505, yaw: Math.PI / 2, lookUp: 2 },
    { name: '06-folsom-field', x: 470, z: 402, yaw: Math.PI, up: 4, lookUp: 3 },
    { name: '07-28th-st', ...sp('28th St', 0.6, -1, 1) },
    { name: '08-twenty-ninth-st', x: 935, z: 112, yaw: 0 },
    { name: '09-us36-turnpike', ...sp('US-36 Boulder Turnpike', 0.42, 1) },
    { name: '10-us36-into-town', ...sp('US-36 Boulder Turnpike', 0.7, -1), lookUp: 2 },
    { name: '11-flagstaff-rd', ...sp('Flagstaff Rd', 0.45, 1) },
    { name: '12-flagstaff-view', ...sp('Flagstaff Rd', 0.92, -1), lookUp: -5, up: 4 },
    { name: '13-chautauqua-flatirons', x: -215, z: 1010, yaw: 3.85, lookUp: 9 },
    { name: '14-baseline-to-flatirons', ...sp('Baseline Rd', 0.33, -1), lookUp: 5 },
    { name: '15-creek-path', x: -70, z: 170, yaw: Math.PI / 2 },
    { name: '16-creek-bridge-broadway', x: -40, z: 168, yaw: Math.PI / 2, side: -3, lookUp: 1 },
    { name: '17-moorhead-home', x: hs[0], z: hs[1], yaw: yawSE, side: -2.5 },
    { name: '18-moorhead-home-front', x: hf[0], z: hf[1], yaw: Math.atan2(D.NE[0], -D.NE[1]), back: 5.5, up: 2.3, lookUp: 1.2 },
    { name: '19-martin-acres', ...sp('Martin Dr', 0.5, 1) },
    { name: '20-table-mesa', ...sp('Table Mesa Dr', 0.75, -1) },
    ...Array.from({ length: 13 }, (_, i) => ({ name: `spawn-${String(i).padStart(2, '0')}`, spawn: i, budgetOnly: true })),
  ];
}

async function planLabels() {
  const D = await imp('js/games/getaway/maps/boulder-data.js');
  const labels = []; const Lb = (text, x, z, o = {}) => labels.push({ text, x, z, ...o });
  for (const l of D.LANDMARKS) Lb(l.name, l.x, l.z, { color: l.home ? '#ff4f8b' : '#ffe08a', bold: true, size: l.home ? 19 : 14, dot: true, home: l.home });
  const ew = { 'Pearl St': [-250, -12], 'Walnut St': [-80, 50], 'Canyon Blvd': [-250, 110], 'Arapahoe Ave': [700, 191], 'Spruce St': [-250, -69], 'Pine St': [-250, -129], 'Mapleton Ave': [-250, -249], 'Balsam Ave': [-250, -389], 'Valmont Rd': [1000, -437], 'Pearl Pkwy': [1500, -214], 'Baseline Rd': [250, 899], 'Colorado Ave': [1000, 566], 'Table Mesa Dr': [760, 1719], 'Euclid Ave': [400, 600], 'University Ave': [-70, 431], 'College Ave': [-70, 391], 'Regent Dr': [560, 735] };
  for (const [t, [x, z]] of Object.entries(ew)) Lb(t, x, z, { size: 13 });
  const ns = { 'Broadway': [0, -300], '9th St': [-134, -300], '4th St': [-352, -300], '15th St': [130, -150], '17th St': [218, -300], '19th St': [307, -300], 'Folsom St': [548, -300], '28th St': [832, -250], '30th St': [1035, -250], 'Foothills Pkwy': [1253, -250], '55th St': [1860, 600], '13th St': [42, -150] };
  for (const [t, [x, z]] of Object.entries(ns)) Lb(t, x + 9, z, { size: 13, rot: -Math.PI / 2 });
  const ang = Math.atan2(D.US36.dz, D.US36.dx);
  Lb('Moorhead Ave', ...D.moorPt(300, -9), { size: 13, rot: ang });
  Lb('US-36 (Boulder Turnpike)', ...D.usPt(380, 22), { size: 15, rot: ang, color: '#9fd3ff', bold: true });
  Lb('Martin Dr', ...D.moorPt(470, -149), { size: 12, rot: ang });
  Lb('Broadway', 800, 1210, { size: 13, rot: Math.atan2(1, 0.47) });
  for (const r of D.CROSS_ROADS) { const p = r.pts[Math.floor(r.pts.length / 2)]; Lb(r.name, p[0] + 6, p[1], { size: 11, rot: Math.atan2(-D.NE[1], -D.NE[0]) + Math.PI }); }
  Lb('Flagstaff Rd', -560, 690, { size: 13 }); Lb('Boulder Creek', -280, 176, { size: 12, color: '#9fd3ff' });
  return labels;
}

async function engineSection() {
  console.log('\n# engine');
  const need = ['js/games/getaway/world.js', 'js/games/getaway/geo.js', 'js/games/getaway/gfx.js'];
  if (!need.every((p) => fs.existsSync(path.join(ROOT, p)))) { console.log('skip - the engine is not there yet'); return; }
  const server = await serve();
  const browser = await chromium();
  const VIEWS = await views();
  try {
    const runs = [[process.env.QUALITY || 'high', process.env.DARK === '1'], ['low', false]];
    if (!process.env.QUALITY) runs.push(['high', true]);
    for (const [quality, dark] of runs) {
      const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(`http://localhost:${PORT}/boulder.html?w=960&h=600&quality=${quality}&dark=${dark ? 1 : 0}`);
      await page.waitForFunction(() => document.title === 'ready', null, { timeout: 240000 });
      const s = await page.evaluate(() => window.__stats);
      if (process.env.SPLIT) { // debugging: SPLIT=x,z,yaw → map vs engine triangles for a far chase cam at 844×390
        await page.setViewportSize({ width: 844, height: 390 }); await page.evaluate(() => window.setSize(844, 390));
        const [x, z, yaw] = process.env.SPLIT.split(',').map(Number);
        for (let k = 0; k < 4; k++) console.log('  split', k, JSON.stringify(await page.evaluate((v) => window.split(v), { x, z, yaw: yaw + k * Math.PI / 2, back: 12.5, up: 5.6, fov: 60 })));
        await page.close(); break;
      }
      const tag = `${quality}${dark ? ', night' : ''}`;
      console.log(`  [${tag}] prepare ${Math.round(s.prepMs)} ms (longest slice ${Math.round(s.maxPrep)} ms); world`, JSON.stringify(s.world), 'map', JSON.stringify(s.mapStats));
      ok(s.world.tris <= BUDGET.totalTris, `[${tag}] total triangles ${s.world.tris} ≤ ${BUDGET.totalTris} (roads, props, map)`);
      warn(s.world.buildMs <= BUDGET.buildMs, `[${tag}] world build ${s.world.buildMs} ms ≤ ${BUDGET.buildMs} (software GL)`);
      warn(s.world.maxBlockMs <= BUDGET.blockMs && s.maxPrep <= BUDGET.blockMs, `[${tag}] longest main-thread block ${s.world.maxBlockMs} ms / prepare slice ${Math.round(s.maxPrep)} ms ≤ ${BUDGET.blockMs}`);
      ok(s.textures <= BUDGET.textures && s.texSizes.every(([w, h]) => w <= 1024 && h <= 1024), `[${tag}] ${s.textures} canvas texture(s) ≤ ${BUDGET.textures} × 1024²`);
      let worst = { calls: 0, tris: 0, at: '' };
      for (const v of VIEWS) {
        const r = await page.evaluate((vv) => window.view(vv), v);
        if (r.calls > worst.calls || r.tris > worst.tris) worst = { calls: Math.max(worst.calls, r.calls), tris: Math.max(worst.tris, r.tris), at: v.name };
        if (!v.budgetOnly && (quality === 'high' || v.name.startsWith('01'))) await page.screenshot({ path: path.join(SHOTS, `${v.name}${quality !== 'high' ? '-' + quality : ''}${dark ? '-night' : ''}.png`) });
        if (r.calls > BUDGET.calls || r.tris > BUDGET.viewTris) console.log(`   ${v.name}: ${r.calls} calls, ${r.tris} tris`);
      }
      await page.setViewportSize({ width: 844, height: 390 }); await page.evaluate(() => window.setSize(844, 390));
      const smp = await page.evaluate(() => window.sample());
      for (const r of smp) if (r.calls > worst.calls || r.tris > worst.tris) worst = { calls: Math.max(worst.calls, r.calls), tris: Math.max(worst.tris, r.tris), at: `${r.x},${r.z} k${r.k}` };
      const top = smp.sort((a, b) => b.tris - a.tris).slice(0, 3).map((r) => `${r.x},${r.z} k${r.k}: ${r.calls} calls ${Math.round(r.tris / 1000)}k`).join(' | ');
      console.log(`   phone-landscape sampling (${smp.length} views): heaviest ${top}`);
      await page.setViewportSize({ width: 960, height: 600 }); await page.evaluate(() => window.setSize(960, 600));
      ok(worst.calls <= BUDGET.calls, `[${tag}] worst view: ${worst.calls} draw calls ≤ ${BUDGET.calls}`);
      ok(worst.tris <= BUDGET.viewTris, `[${tag}] worst view: ${worst.tris} triangles ≤ ${BUDGET.viewTris}`);
      if (quality === 'high' && !dark) {
        await page.setViewportSize({ width: 2000, height: 1760 });
        await page.evaluate((labels) => window.plan(labels), await planLabels());
        await page.screenshot({ path: path.join(SHOTS, 'plan.png'), timeout: 180000 });
        console.log('  plan.png written');
      }
      ok(!errors.length, `[${tag}] no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log(`  screenshots: ${SHOTS}`);
}

// ── the real-vs-map sheet ────────────────────────────────────────────────
async function sheetSection() {
  console.log('\n# sheet');
  const D = await imp('js/games/getaway/maps/boulder-data.js');
  const { BOULDER: M } = await imp('js/games/getaway/maps/boulder.js');
  const roadB = (name, nth = 0) => { const r = M.roads.filter((o) => o.name === name && !o.bridge)[nth]; const a = r.pts[0]; const b = r.pts[r.pts.length - 1]; return bearing(b[0] - a[0], b[1] - a[1]); };
  const rows = [
    ['Pearl St (downtown grid)', '090° E–W', roadB('Pearl St', 1)], ['Broadway, downtown', '000°/180° N–S', roadB('Broadway', 0)],
    ['Broadway, Arapahoe → Baseline', '≈ 135° SE (bends past CU)', (() => { const r = M.roads.filter((o) => o.name === 'Broadway')[2]; const a = r.pts[0]; const b = r.pts.find((p) => p[1] >= 909); return bearing(b[0] - a[0], b[1] - a[1]); })()],
    ['Broadway, Baseline → Table Mesa', '≈ 152° SSE', (() => { const r = M.roads.filter((o) => o.name === 'Broadway')[2]; const a = r.pts.find((p) => p[1] >= 909); const b = r.pts[r.pts.length - 1]; return bearing(b[0] - a[0], b[1] - a[1]); })()],
    ['Baseline Rd (40th parallel)', '090° E–W', roadB('Baseline Rd')], ['Canyon Blvd / Arapahoe / Walnut', '090° E–W', roadB('Arapahoe Ave')],
    ['28th St / 30th St / Folsom / Foothills', '000° N–S', roadB('28th St', 1)], ['US-36 (Turnpike) from Baseline', '≈ 126–128° SE', roadB('US-36 Boulder Turnpike')],
    ['Moorhead Ave (surveyed houses 2905–4265)', '126° SE (fit)', roadB('Moorhead Ave')], ['Martin Dr (3405 surveyed 140 m SW of Moorhead*)', 'parallel to Moorhead', roadB('Martin Dr')],
    ['35th St (Martin farmhouse corner)', '216° (square to Moorhead)', roadB('35th St')], ['Pearl Pkwy from 30th', '≈ 070° ENE', roadB('Pearl Pkwy')],
  ];
  const fmt = (v) => v.toFixed(1) + '°';
  const pos = D.CHECKS.map(([nm, la, lo]) => { const [x, z] = D.P(la, lo); return [nm, `${la.toFixed(4)}, ${lo.toFixed(4)}`, `${x.toFixed(0)}, ${z.toFixed(0)}`]; });
  const placed = [['Courthouse', 65, -43], ['Folsom Field', 470, 476], ['Boulder High', 262, 236], ['Norlin Library', 352, 496], ['Chautauqua Auditorium', -18, 1042], ['3865 Moorhead (house)', D.HOME.x, D.HOME.z]];
  global.SHEET = `<!doctype html><meta charset="utf-8"><style>body{font:14px/1.35 system-ui,sans-serif;margin:24px;background:#faf7f1;color:#222}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:18px 0 6px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d8d0c4;padding:4px 8px;text-align:left}th{background:#efe7da}.ok{color:#1d7a46;font-weight:600}.n{color:#666;font-size:12px}</style>
<h1>Boulder for Getaway: real vs map</h1><div class="n">North = −z, east = +x. Uniform scale ${D.S} (map metres = 0.45 × real). Origin = Broadway &amp; Pearl (40.0182 N, 105.2795 W). Bearings are compass degrees.</div>
<h2>Street orientations</h2><table><tr><th>Street</th><th>Real</th><th>Map</th></tr>${rows.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td class="ok">${fmt(c)}</td></tr>`).join('')}</table>
<h2>Surveyed points → map position (x, z in map metres)</h2><table><tr><th>Place</th><th>lat, lon</th><th>map x, z</th></tr>${pos.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</table>
<h2>Placed landmarks</h2><table><tr><th>Building</th><th>map x, z</th></tr>${placed.map((r) => `<tr><td>${r[0]}</td><td>${r[1].toFixed(0)}, ${r[2].toFixed(0)}</td></tr>`).join('')}</table>
<div class="n">* Uncertain: the exact cross streets of Martin Acres (32nd/38th/43rd are placed on the address grid; 35th, 40th and 46th are documented), the two unnamed avenues between Moorhead and Martin Dr, and street names in south-west and east Boulder (left unnamed).</div>`;
  const server = await serve(); const browser = await chromium();
  try { const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } }); await page.goto(`http://localhost:${PORT}/sheet.html`); await page.screenshot({ path: path.join(SHOTS, 'real-vs-map.png'), fullPage: true }); console.log('ok - real-vs-map.png written'); }
  finally { await browser.close(); server.close(); }
}

(async () => {
  try {
    if (want('static')) await staticSection();
    if (want('engine')) await engineSection();
    if (want('sheet')) await sheetSection();
  } catch (e) { failures++; console.log('FAIL -', e.stack || e); }
  console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
  process.exit(failures ? 1 : 0);
})();
