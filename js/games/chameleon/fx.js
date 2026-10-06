// Effects, all instanced (one draw call each) and allocation-free per frame: paint splats in
// the world, flying pellets, paint confetti, the scurry trail, the seeker's path for the recap,
// the scan glint sprites, the brush cursor and the recap highlight ring.
import { makeSplatTexture, makeGlintTexture } from './toon.js';

const MAX_SPLATS = 48;
const MAX_PELLETS = 8;
const MAX_CONFETTI = 160;
const MAX_TRAIL = 48;
const MAX_PATH = 260;

export function createFx(THREE, scene, { gradientMap }) {
  const disposables = [];
  const own = (x) => { disposables.push(x); return x; };
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const v1 = new THREE.Vector3();
  const q1 = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  // ── splats ──
  const splatTex = own(makeSplatTexture(THREE));
  const splatGeo = own(new THREE.PlaneGeometry(1, 1));
  const splatMat = own(new THREE.MeshToonMaterial({ map: splatTex, alphaTest: 0.5, gradientMap, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  const splats = new THREE.InstancedMesh(splatGeo, splatMat, MAX_SPLATS);
  splats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  splats.frustumCulled = false;
  for (let i = 0; i < MAX_SPLATS; i++) { splats.setMatrixAt(i, hidden); splats.setColorAt(i, col.set(0xffffff)); }
  scene.add(splats);
  const sp = Array.from({ length: MAX_SPLATS }, () => ({ on: false, born: 0, x: 0, y: 0, z: 0, q: new THREE.Quaternion(), s: 0.3 }));
  let spNext = 0;
  let spCount = 0;

  function splat(x, y, z, nx, ny, nz, color, size, now) {
    const s = sp[spNext]; spNext = (spNext + 1) % MAX_SPLATS; spCount = Math.min(MAX_SPLATS, spCount + 1);
    s.on = true; s.born = now; s.x = x + nx * 0.006; s.y = y + ny * 0.006; s.z = z + nz * 0.006; s.s = size;
    v1.set(nx, ny, nz).normalize();
    q1.setFromUnitVectors(zAxis, v1);
    q2.setFromAxisAngle(zAxis, Math.random() * Math.PI * 2);
    s.q.copy(q1).multiply(q2);
    const i = sp.indexOf(s);
    splats.setColorAt(i, col.set(color));
    splats.instanceColor.needsUpdate = true;
    return i;
  }

  // ── pellets ──
  const pelGeo = own(new THREE.SphereGeometry(0.05, 10, 8));
  const pelMat = own(new THREE.MeshToonMaterial({ gradientMap }));
  const pellets = new THREE.InstancedMesh(pelGeo, pelMat, MAX_PELLETS);
  pellets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pellets.frustumCulled = false;
  for (let i = 0; i < MAX_PELLETS; i++) { pellets.setMatrixAt(i, hidden); pellets.setColorAt(i, col.set(0xffffff)); }
  scene.add(pellets);
  const pl = Array.from({ length: MAX_PELLETS }, () => ({ on: false, t0: 0, dur: 0, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, done: null }));
  let plNext = 0;
  function pellet(from, to, color, now, done) {
    const p = pl[plNext]; const i = plNext; plNext = (plNext + 1) % MAX_PELLETS;
    if (p.on && p.done) p.done();
    p.on = true; p.t0 = now;
    p.fx = from.x; p.fy = from.y; p.fz = from.z; p.tx = to.x; p.ty = to.y; p.tz = to.z;
    p.dur = Math.max(0.06, Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / 28);
    p.done = done || null;
    pellets.setColorAt(i, col.set(color)); pellets.instanceColor.needsUpdate = true;
  }

  // ── confetti ──
  const cfGeo = own(new THREE.PlaneGeometry(0.06, 0.09));
  const cfMat = own(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const confetti = new THREE.InstancedMesh(cfGeo, cfMat, MAX_CONFETTI);
  confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  confetti.frustumCulled = false;
  for (let i = 0; i < MAX_CONFETTI; i++) { confetti.setMatrixAt(i, hidden); confetti.setColorAt(i, col.set(0xffffff)); }
  scene.add(confetti);
  const cf = Array.from({ length: MAX_CONFETTI }, () => ({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, life: 0 }));
  function burst(x, y, z, colors, n = 90, power = 1) {
    let made = 0;
    for (let i = 0; i < MAX_CONFETTI && made < n; i++) {
      const c = cf[i]; if (c.on) continue;
      c.on = true; c.x = x; c.y = y; c.z = z;
      const a = Math.random() * Math.PI * 2; const sp2 = (1.5 + Math.random() * 2.6) * power;
      c.vx = Math.cos(a) * sp2; c.vz = Math.sin(a) * sp2; c.vy = (3 + Math.random() * 3.5) * power;
      c.rx = Math.random() * 6; c.ry = Math.random() * 6; c.rz = 0; c.wx = (Math.random() - 0.5) * 18; c.wy = (Math.random() - 0.5) * 18;
      c.life = 2.2 + Math.random() * 1.2;
      confetti.setColorAt(i, col.set(colors[made % colors.length]));
      made++;
    }
    confetti.instanceColor.needsUpdate = true;
  }

  // ── trail (scurry) + path (recap) ──
  const dotGeo = own(new THREE.CircleGeometry(1, 12));
  dotGeo.rotateX(-Math.PI / 2);
  const trailMat = own(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  const trail = new THREE.InstancedMesh(dotGeo, trailMat, MAX_TRAIL);
  trail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trail.frustumCulled = false;
  for (let i = 0; i < MAX_TRAIL; i++) trail.setMatrixAt(i, hidden);
  scene.add(trail);
  const tr = Array.from({ length: MAX_TRAIL }, () => ({ on: false, x: 0, y: 0, z: 0, born: 0, life: 2 }));
  let trNext = 0;
  function trailDot(x, y, z, now, life = 2) {
    const t = tr[trNext]; trNext = (trNext + 1) % MAX_TRAIL;
    t.on = true; t.x = x; t.y = y + 0.01; t.z = z; t.born = now; t.life = life;
  }
  const pathMat = own(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  const path = new THREE.InstancedMesh(dotGeo, pathMat, MAX_PATH);
  path.frustumCulled = false;
  path.count = 0;
  scene.add(path);
  function setPath(points, color) {
    pathMat.color.set(color);
    let n = 0;
    for (let i = 0; i < points.length && n < MAX_PATH; i++) {
      const p = points[i];
      dummy.position.set(p[0], p[1] + 0.012, p[2]); dummy.quaternion.identity(); dummy.scale.setScalar(0.04);
      dummy.updateMatrix(); path.setMatrixAt(n++, dummy.matrix);
    }
    path.count = n;
    path.instanceMatrix.needsUpdate = true;
  }

  // ── glints (scan) ──
  const glintTex = own(makeGlintTexture(THREE));
  const glintMat = own(new THREE.SpriteMaterial({ map: glintTex, color: 0xffd23f, transparent: true, depthWrite: false }));
  const glints = [];
  for (let i = 0; i < 10; i++) { const s = new THREE.Sprite(glintMat); s.visible = false; s.scale.setScalar(0.22); s.renderOrder = 3; scene.add(s); glints.push(s); }

  // ── tongue (tongue-zip): one stretched cylinder from the mouth to the target ──
  const tongueGeo = own(new THREE.CylinderGeometry(0.018, 0.012, 1, 8, 1));
  tongueGeo.translate(0, 0.5, 0); tongueGeo.rotateX(Math.PI / 2); // unit length along +z
  const tongueTip = own(new THREE.SphereGeometry(0.035, 10, 8));
  const tongueMat = own(new THREE.MeshToonMaterial({ color: 0xe8607e, gradientMap }));
  const tongue = new THREE.Mesh(tongueGeo, tongueMat);
  const tip = new THREE.Mesh(tongueTip, tongueMat);
  tongue.visible = false; tip.visible = false; tongue.frustumCulled = false;
  scene.add(tongue, tip);
  const tg = { on: false, t0: 0, dur: 0.5, ox: 0, oy: 0, oz: 0, tx: 0, ty: 0, tz: 0, follow: null };
  /** Shoot the tongue from (o) to (t); `follow(out)` (optional) keeps the root on the mouth. */
  function shootTongue(o, t, now, dur = 0.5, follow = null) {
    tg.on = true; tg.t0 = now; tg.dur = dur; tg.follow = follow;
    tg.ox = o.x; tg.oy = o.y; tg.oz = o.z; tg.tx = t.x; tg.ty = t.y; tg.tz = t.z;
  }
  const tv = new THREE.Vector3();
  function updateTongue(now) {
    if (!tg.on) { tongue.visible = false; tip.visible = false; return; }
    const k = (now - tg.t0) / tg.dur;
    if (k >= 1) { tg.on = false; tongue.visible = false; tip.visible = false; return; }
    if (tg.follow) { tg.follow(tv); tg.ox = tv.x; tg.oy = tv.y; tg.oz = tv.z; }
    // out fast (first 35 %), stays latched, reels in with the body
    const ext = k < 0.35 ? k / 0.35 : 1;
    const dx = tg.tx - tg.ox; const dy = tg.ty - tg.oy; const dz = tg.tz - tg.oz;
    const L = Math.hypot(dx, dy, dz) * ext;
    tongue.visible = L > 0.02; tip.visible = true;
    tongue.position.set(tg.ox, tg.oy, tg.oz);
    tv.set(tg.ox + dx, tg.oy + dy, tg.oz + dz);
    tongue.lookAt(tv);
    tongue.scale.set(1, 1, Math.max(0.01, L));
    tip.position.set(tg.ox + dx * ext, tg.oy + dy * ext, tg.oz + dz * ext);
  }

  // ── suction ring (stick / unstick pop) ──
  const popMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  const popRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 24), popMat);
  disposables.push(popRing.geometry);
  popRing.visible = false; popRing.renderOrder = 3;
  scene.add(popRing);
  const pr = { on: false, t0: 0, s: 0.3 };
  function pop(x, y, z, nx, ny, nz, color, size, now) {
    pr.on = true; pr.t0 = now; pr.s = size;
    popRing.position.set(x + nx * 0.012, y + ny * 0.012, z + nz * 0.012);
    v1.set(nx, ny, nz).normalize(); q1.setFromUnitVectors(zAxis, v1); popRing.quaternion.copy(q1);
    popMat.color.set(color);
  }
  function updatePop(now) {
    if (!pr.on) return;
    const k = (now - pr.t0) / 0.35;
    if (k >= 1) { pr.on = false; popRing.visible = false; return; }
    popRing.visible = true;
    popRing.scale.setScalar(pr.s * (0.4 + k * 0.9));
    popMat.opacity = 0.85 * (1 - k);
  }

  // ── brush cursor + recap ring ──
  const ringGeo = own(new THREE.RingGeometry(0.9, 1, 32));
  const cursorMat = own(new THREE.MeshBasicMaterial({ color: 0x1d1b22, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }));
  const cursor = new THREE.Mesh(ringGeo, cursorMat);
  cursor.visible = false; cursor.renderOrder = 5;
  scene.add(cursor);
  const hlMat = own(new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  const ring = new THREE.Mesh(ringGeo, hlMat);
  ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 2;
  scene.add(ring);

  function setCursor(on, x, y, z, nx, ny, nz, r, color) {
    cursor.visible = on;
    if (!on) return;
    cursor.position.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01);
    v1.set(nx, ny, nz); q1.setFromUnitVectors(zAxis, v1); cursor.quaternion.copy(q1);
    cursor.scale.setScalar(r);
    if (color) cursorMat.color.set(color);
  }

  function update(dt, now) {
    // splats grow in with a little overshoot
    let anySplat = false;
    for (let i = 0; i < MAX_SPLATS; i++) {
      const s = sp[i]; if (!s.on) continue;
      const age = now - s.born;
      if (age > 0.4 && s.settled) continue;
      const k = age < 0.12 ? age / 0.12 * 1.2 : age < 0.3 ? 1.2 - (age - 0.12) / 0.18 * 0.2 : 1;
      dummy.position.set(s.x, s.y, s.z); dummy.quaternion.copy(s.q); dummy.scale.setScalar(s.s * k);
      dummy.updateMatrix(); splats.setMatrixAt(i, dummy.matrix);
      if (age > 0.4) s.settled = true;
      anySplat = true;
    }
    if (anySplat) splats.instanceMatrix.needsUpdate = true;
    // pellets
    let anyP = false;
    for (let i = 0; i < MAX_PELLETS; i++) {
      const p = pl[i]; if (!p.on) continue;
      anyP = true;
      const t = (now - p.t0) / p.dur;
      if (t >= 1) { p.on = false; pellets.setMatrixAt(i, hidden); const d = p.done; p.done = null; if (d) d(); continue; }
      dummy.position.set(p.fx + (p.tx - p.fx) * t, p.fy + (p.ty - p.fy) * t + Math.sin(t * Math.PI) * 0.05, p.fz + (p.tz - p.fz) * t);
      dummy.quaternion.identity(); dummy.scale.set(1, 1, 1);
      dummy.updateMatrix(); pellets.setMatrixAt(i, dummy.matrix);
    }
    if (anyP) pellets.instanceMatrix.needsUpdate = true;
    // confetti
    let anyC = false;
    for (let i = 0; i < MAX_CONFETTI; i++) {
      const c = cf[i]; if (!c.on) continue;
      anyC = true;
      c.life -= dt;
      if (c.life <= 0 || c.y < -0.5) { c.on = false; confetti.setMatrixAt(i, hidden); continue; }
      c.vy -= 6.5 * dt; c.vx *= 1 - 1.2 * dt; c.vz *= 1 - 1.2 * dt; if (c.vy < -1.6) c.vy = -1.6;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      if (c.y < 0.01) { c.y = 0.01; c.vy = 0; c.vx *= 0.5; c.vz *= 0.5; c.wx *= 0.9; c.wy *= 0.9; }
      c.rx += c.wx * dt; c.ry += c.wy * dt;
      dummy.position.set(c.x, c.y, c.z); dummy.rotation.set(c.rx, c.ry, c.rz); dummy.scale.setScalar(Math.min(1, c.life * 2));
      dummy.updateMatrix(); confetti.setMatrixAt(i, dummy.matrix);
    }
    if (anyC) confetti.instanceMatrix.needsUpdate = true;
    // trail
    let anyT = false;
    for (let i = 0; i < MAX_TRAIL; i++) {
      const t = tr[i]; if (!t.on) continue;
      anyT = true;
      const k = 1 - (now - t.born) / t.life;
      if (k <= 0) { t.on = false; trail.setMatrixAt(i, hidden); continue; }
      dummy.position.set(t.x, t.y, t.z); dummy.quaternion.identity(); dummy.scale.setScalar(0.07 * (0.4 + 0.6 * k));
      dummy.updateMatrix(); trail.setMatrixAt(i, dummy.matrix);
    }
    if (anyT) trail.instanceMatrix.needsUpdate = true;
    updateTongue(now);
    updatePop(now);
    // recap ring pulse
    if (ring.visible) { const s = (0.45 + Math.sin(now * 4) * 0.04) * (ring.userData.size || 1); ring.scale.setScalar(s); hlMat.opacity = 0.65 + Math.sin(now * 4) * 0.25; }
  }

  function clearRound() {
    for (let i = 0; i < MAX_SPLATS; i++) { sp[i].on = false; sp[i].settled = false; splats.setMatrixAt(i, hidden); }
    splats.instanceMatrix.needsUpdate = true; spNext = 0; spCount = 0;
    for (let i = 0; i < MAX_PELLETS; i++) { pl[i].on = false; pl[i].done = null; pellets.setMatrixAt(i, hidden); }
    pellets.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < MAX_TRAIL; i++) { tr[i].on = false; trail.setMatrixAt(i, hidden); }
    trail.instanceMatrix.needsUpdate = true;
    path.count = 0;
    ring.visible = false;
    for (const g of glints) g.visible = false;
    tg.on = false; tongue.visible = false; tip.visible = false; pr.on = false; popRing.visible = false;
  }

  return {
    splat, pellet, burst, trailDot, setPath, setCursor, update, clearRound, shootTongue, pop,
    glints, ring, hlMat, trailMat, pathMat,
    get tongueOn() { return tg.on; },
    get splatCount() { return sp.filter((s) => s.on).length; },
    get trailCount() { return tr.filter((t) => t.on).length; },
    objects: [splats, pellets, confetti, trail, path, cursor, ring, tongue, tip, popRing, ...glints],
    dispose() {
      for (const o of [splats, pellets, confetti, trail, path, cursor, ring, tongue, tip, popRing, ...glints]) scene.remove(o);
      splats.dispose(); pellets.dispose(); confetti.dispose(); trail.dispose(); path.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
}
