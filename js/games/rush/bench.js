// Rail Rush pacing bench: the maths behind `__rush.pace(opts)` (game.js drives the frames; this turns
// what it recorded into numbers). Pure functions, no DOM, so a test can also call them directly.

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

function stat(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return { n: 0, mean: 0, sd: 0, p50: 0, p95: 0, max: 0 };
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const sd = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length);
  const q = (k) => a[Math.min(a.length - 1, Math.floor(k * a.length))];
  return { n: a.length, mean: r2(mean), sd: r2(sd), p50: r2(q(0.5)), p95: r2(q(0.95)), max: r2(a[a.length - 1]) };
}
const rms = (xs) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / Math.max(1, xs.length));

/**
 * rec: { hz, warm, n, ts[], z[], x[], sp[], cx[], cy[], cz[], pz[], psp[], skip[], inp: [{ i, te, dir, target }] }
 *   i: index of the first frame after the input event; te: the event's time; dir: -1 / +1; target: the new lane's x.
 * Everything is on the synthetic vsync timeline (ms). A frame that "presents" at ts + one period.
 */
export function analysePace(rec) {
  const { hz, warm, n, ts, z, x, sp, cx, cy, cz, pz, psp, skip, inp } = rec;
  const P = 1000 / hz;
  const dts = []; const judder = []; const judderB = []; const jerkX = []; const jerkY = [];
  let teleports = 0; let camVmax = 0; let missed = 0;
  for (let i = Math.max(1, warm); i < n; i++) {
    const dt = (ts[i] - ts[i - 1]) / 1000;
    dts.push(dt * 1000);
    if (dt > P * 1.5 / 1000) missed++;
    const ok = !skip[i] && !skip[i - 1];
    if (ok && sp[i] > 1) judder.push((z[i] - z[i - 1] - sp[i] * dt) / (sp[i] / hz));
    if (ok && psp[i] > 1) judderB.push((pz[i] - pz[i - 1] - psp[i] * dt) / (psp[i] / hz));
    const dx = cx[i] - cx[i - 1]; const dy = cy[i] - cy[i - 1];
    const lat = Math.hypot(dx, dy);
    if (lat > 0.35 || Math.abs(-(cz[i] - cz[i - 1]) - sp[i] * dt) > 0.6) teleports++;
    if (lat / dt > camVmax) camVmax = lat / dt;
    if (i >= warm + 3) {
      const d1 = dt; const d0 = (ts[i - 1] - ts[i - 2]) / 1000; const dm = (ts[i - 2] - ts[i - 3]) / 1000;
      for (let c = 0; c < 2; c++) {
        const a = c ? cy : cx;
        const v2 = (a[i] - a[i - 1]) / d1; const v1 = (a[i - 1] - a[i - 2]) / d0; const v0 = (a[i - 2] - a[i - 3]) / dm;
        const j = ((v2 - v1) / d1 - (v1 - v0) / d0) / d1;
        if (Number.isFinite(j)) (c ? jerkY : jerkX).push(Math.abs(j));
      }
    }
  }
  const lat = []; const camLat = []; const laneMs = []; const settle = []; const over = [];
  for (let k = 0; k < inp.length; k++) {
    const e = inp[k]; const i0 = e.i;
    const x0 = x[i0 - 1]; const c0 = cx[i0 - 1];
    const end = k + 1 < inp.length ? inp[k + 1].i - 1 : n - 1;
    let vis = -1; let cam = -1; let done = -1;
    for (let j = i0; j <= end; j++) {
      if (vis < 0 && (x[j] - x0) * e.dir >= 0.02) vis = ts[j] + P - e.te;
      if (cam < 0 && (cx[j] - c0) * e.dir >= 0.01) cam = ts[j] + P - e.te;
      if (done < 0 && Math.abs(x[j] - e.target) < 0.03) done = ts[j] + P - e.te;
    }
    if (vis >= 0) lat.push(vis);
    if (cam >= 0) camLat.push(cam);
    if (done >= 0) laneMs.push(done);
    // camera: settle time to within 5 % of its own travel, and overshoot past where it ends up
    const fin = cx[end]; const span = fin - c0;
    if (Math.abs(span) > 0.3 && end - i0 > hz * 0.5) {
      let last = i0;
      let ov = 0;
      for (let j = i0; j <= end; j++) {
        if (Math.abs(cx[j] - fin) >= 0.05 * Math.abs(span)) last = j + 1;
        ov = Math.max(ov, (cx[j] - fin) * Math.sign(span));
      }
      settle.push(ts[Math.min(end, last)] + P - e.te);
      over.push(ov);
    }
  }
  const jr = rms(judder);
  return {
    hz, frames: n - warm, inputs: inp.length,
    frameMs: stat(dts), missed,
    judderRms: r3(jr), judderP95: r3(stat(judder.map(Math.abs)).p95),
    partnerJudderRms: r3(rms(judderB)), partnerJudderP95: r3(stat(judderB.map(Math.abs)).p95),
    camJerkRms: Math.round(rms(jerkX)), camJerkP95: Math.round(stat(jerkX).p95), camJerkMax: Math.round(stat(jerkX).max), camJerkYRms: Math.round(rms(jerkY)),
    camTeleports: teleports, camLatVmax: r2(camVmax),
    latencyMs: stat(lat), camLatencyMs: stat(camLat), laneMs: stat(laneMs), camSettleMs: stat(settle), camOvershootM: stat(over),
  };
}
