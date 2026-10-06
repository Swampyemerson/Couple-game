// CU Boulder: an affectionate, toy-sized mash-up of campus spaces for Blend & Seek.
// Not a campus model: five little dioramas joined by a basement corridor and a sandstone
// arcade, in CU's own vocabulary (rough pink-and-tan Lyons sandstone, red clay tile roofs,
// flagstone, round arches) with the Flatirons painted along the edge of the quad.
//
//   ┌──────────── Duane G1B30 ────────────┬──── Norlin reading room ───┬──── UMC ────┐  z = −13
//   │ chalkboards ▼ (south wall)           │ gallery (y 2.72) ┊ tables   │ counter     │
//   │ demo bench, 8 tiers rising north ▲   │ stairs           ┊ lamps    │ booths/pool │
//   ├── basement corridor (lockers, pipes) ┴─── sandstone arcade ────────┴─────────────┤  z = −1
//   │ engineering lab (rocket, 3D printer)  │        the quad: lawn, X paths, buffalo  │
//   ├── flagstone strip + bike racks ───────┘        aspens, pines, Flatirons mural    │  z = +13
//   x = −17                                                                     x = +17
//
// Two floors: the ground (y 0) and the top of the lecture-hall rake / Norlin gallery (y 2.72),
// joined by the hall's aisle stairs and the gallery stair, so G1B30 → Norlin → arcade → corridor
// → G1B30 is a loop. Interiors have downward-only ceilings (the camera sees in from above); roof
// tops are fenced off with climb:false guards so nobody hides on top of a building.
import { boxGeo, cylGeo, sphereGeo, latheGeo } from '../geo.js';
import { aabb, wall, floor, slab, stairs, railing, pendant } from './lib.js';
import { Q } from './patterns.js';

// ── palette ──────────────────────────────────────────────────────────────
const C = {
  ink: '#2a2730',
  stoneA: '#d9a68c', stoneB: '#c99470', stoneC: '#e5c39e', stoneD: '#c7876f', stoneE: '#d8b183', mortar: '#efe0c6',
  stone: '#d6a585', stoneDk: '#a8735a', tile: '#b5482f', tileDk: '#8e3524', tileLt: '#cf6a45',
  gold: '#cfb87c', goldDk: '#a88e4f', black: '#262427',
  chalk: '#2f4a3e', chalkLine: '#eef0e6', frameAl: '#b9bcbf',
  woodL: '#c99a6b', wood: '#a8754d', woodD: '#6b4430', walnut: '#5a3a26',
  cream: '#f1e6d2', plaster: '#ecdfc8', block: '#e4dccb', blueGrey: '#cfd8dc',
  green: '#2f7a4f', lampGreen: '#1f6b45', brass: '#c9a24a',
  red: '#d9483b', teal: '#2f8f8f', mustard: '#e0a43d', coral: '#e07a5f', plum: '#7b5ea7', navy: '#2d3a5c', sky: '#8fc3e0',
  grass: '#8cbf63', grassB: '#7bb156', aspen: '#f2c14e', aspenB: '#e6a93a', pine: '#3f6b45', pineB: '#2f5537',
  felt: '#2e7d52', steel: '#9aa3ab',
};
const BENCH_TOP = '#26262b';

// ── procedural patterns (same contract as atlas.js painters) ───────────────
const wrapDo = (w, h, fn) => { for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) fn(ox * w, oy * h); };
const dot = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };

const PAT = {
  /** Rough-cut Lyons sandstone ashlar: courses of uneven blocks in pinks and tans. */
  sandstone: ({ cols, mortar, rows = 6 }) => (g, w, h, r) => {
    g.fillStyle = mortar; g.fillRect(0, 0, w, h);
    const rh = h / rows;
    for (let j = 0; j < rows; j++) {
      // block widths that sum exactly to w (seamless)
      const ws = []; let tot = 0;
      while (tot < w) { const bw = w * (0.16 + r() * 0.2); ws.push(bw); tot += bw; }
      const k = w / tot; let x = r() * w;
      for (const bw0 of ws) {
        const bw = bw0 * k; const c = cols[Math.floor(r() * cols.length)];
        wrapDo(w, 0, (ox) => {
          g.fillStyle = c; g.fillRect(x + ox + 2, j * rh + 2, bw - 4, rh - 4);
          g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillRect(x + ox + 2, j * rh + 2, bw - 4, 3);
          g.fillStyle = 'rgba(80,40,20,0.14)'; g.fillRect(x + ox + 2, j * rh + rh - 6, bw - 4, 4);
        });
        x += bw;
      }
    }
    // pitted, rough face
    for (let i = 0; i < 220; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(90,45,25,0.16)' : 'rgba(255,240,220,0.22)';
      const x = r() * w; const y = r() * h; const s = 0.8 + r() * 2.2;
      wrapDo(w, h, (ox, oy) => dot(g, x + ox, y + oy, s));
    }
  },

  /** Flagstone paving: jittered grid of irregular slabs with mortar joints. */
  flagstone: ({ cols, joint, n = 5 }) => (g, w, h, r) => {
    g.fillStyle = joint; g.fillRect(0, 0, w, h);
    const s = w / n; const P = [];
    for (let j = 0; j < n; j++) { P.push([]); for (let i = 0; i < n; i++) P[j].push([(r() - 0.5) * s * 0.5, (r() - 0.5) * s * 0.5]); }
    const pt = (i, j) => { const q = P[((j % n) + n) % n][((i % n) + n) % n]; return [i * s + q[0], j * s + q[1]]; };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const c = cols[Math.floor(r() * cols.length)];
      const a = pt(i, j); const b2 = pt(i + 1, j); const c2 = pt(i + 1, j + 1); const d = pt(i, j + 1);
      const cx = (a[0] + b2[0] + c2[0] + d[0]) / 4; const cy = (a[1] + b2[1] + c2[1] + d[1]) / 4;
      const ins = (p) => [cx + (p[0] - cx) * 0.9, cy + (p[1] - cy) * 0.9];
      wrapDo(w, h, (ox, oy) => {
        g.fillStyle = c; g.beginPath();
        [a, b2, c2, d].map(ins).forEach(([x, y], k) => (k ? g.lineTo(x + ox, y + oy) : g.moveTo(x + ox, y + oy)));
        g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.12)'; dot(g, cx + ox - s * 0.12, cy + oy - s * 0.1, s * 0.12);
      });
    }
  },

  /** Red clay barrel tiles: vertical rolls with offset courses. */
  rooftile: ({ a, b, dark }) => (g, w, h) => {
    g.fillStyle = dark; g.fillRect(0, 0, w, h);
    const cols = 6; const rows = 4; const cw = w / cols; const rh = h / rows;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = i * cw; const y = j * rh;
      g.fillStyle = (i + j) % 3 ? a : b; g.fillRect(x + 2, y, cw - 4, rh - 3);
      g.fillStyle = 'rgba(255,230,200,0.35)'; g.fillRect(x + cw * 0.3, y + 2, cw * 0.15, rh - 8);
      g.fillStyle = 'rgba(60,15,5,0.35)'; g.fillRect(x + 2, y + rh - 9, cw - 4, 6);
    }
  },

  /** Physics chalkboard: smudges, fake handwriting, sketches (not repeating text). */
  chalk: ({ bg, line, accent }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    // eraser smudges
    for (let i = 0; i < 9; i++) {
      g.fillStyle = 'rgba(230,236,226,0.07)';
      g.beginPath(); g.ellipse(r() * w, r() * h, 30 + r() * 50, 10 + r() * 16, r() * 0.4 - 0.2, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = line; g.fillStyle = line; g.lineCap = 'round'; g.lineJoin = 'round';
    // scribbled "handwriting": little looping glyph strings
    const scribble = (x, y, len, sz) => {
      g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, y);
      let px = x;
      while (px < x + len) {
        const k = r();
        if (k < 0.18) { g.moveTo(px + sz * 0.6, y); px += sz * 0.9; continue; } // space
        const up = sz * (0.4 + r() * 0.6);
        g.bezierCurveTo(px + sz * 0.2, y - up, px + sz * 0.5, y - up, px + sz * 0.55, y);
        g.bezierCurveTo(px + sz * 0.6, y + sz * 0.25, px + sz * 0.75, y + sz * 0.1, px + sz * 0.8, y - sz * 0.15);
        px += sz * 0.8;
      }
      g.stroke();
    };
    const eq = (x, y, sz) => { // integral, fraction bar, equals, wiggle
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + sz * 0.3, y - sz * 1.1); g.bezierCurveTo(x - sz * 0.1, y - sz * 1.2, x + sz * 0.4, y + sz * 0.9, x, y + sz * 0.8); g.stroke();
      scribble(x + sz * 0.6, y - sz * 0.35, sz * 3.2, sz * 0.7);
      g.beginPath(); g.moveTo(x + sz * 0.6, y); g.lineTo(x + sz * 4.0, y); g.stroke();
      scribble(x + sz * 1.0, y + sz * 0.75, sz * 2.4, sz * 0.7);
      g.beginPath(); g.moveTo(x + sz * 4.4, y - 3); g.lineTo(x + sz * 5.1, y - 3); g.moveTo(x + sz * 4.4, y + 3); g.lineTo(x + sz * 5.1, y + 3); g.stroke();
      scribble(x + sz * 5.4, y + sz * 0.2, sz * 2.6, sz * 0.75);
    };
    const formula = (txt, x, y, s) => { g.font = `italic ${s}px "Comic Sans MS", "Chalkboard SE", cursive, sans-serif`; g.fillText(txt, x, y); };
    // left board (0 .. w/2): equations + a free-body diagram
    eq(14, 34, 15); formula('F = ma', 150, 40, 19);
    scribble(16, 76, 120, 10); scribble(16, 96, 90, 10);
    formula('E = mc²', 30, 130, 17); formula('∇·E = ρ/ε₀', 26, 160, 16);
    eq(18, 200, 12);
    // free-body diagram: block on a ramp with arrows
    g.lineWidth = 2; g.beginPath(); g.moveTo(140, 220); g.lineTo(232, 220); g.lineTo(140, 150); g.closePath(); g.stroke();
    g.save(); g.translate(176, 176); g.rotate(0.65); g.strokeRect(-12, -12, 24, 22); g.restore();
    g.strokeStyle = accent; g.beginPath(); g.moveTo(176, 176); g.lineTo(176, 214); g.moveTo(170, 206); g.lineTo(176, 216); g.lineTo(182, 206); g.stroke();
    g.beginPath(); g.moveTo(176, 176); g.lineTo(150, 146); g.stroke();
    g.strokeStyle = line;
    // right board (w/2 .. w): axes with a sine wave, a parabola, a circuit, scribbles
    const ox = w / 2;
    g.lineWidth = 2; g.beginPath(); g.moveTo(ox + 14, 20); g.lineTo(ox + 14, 104); g.lineTo(ox + 120, 104); g.stroke();
    g.strokeStyle = accent; g.beginPath();
    for (let x = 0; x <= 100; x += 3) { const y = 62 - Math.sin(x / 100 * Math.PI * 3) * 30 * Math.exp(-x / 120); if (x) g.lineTo(ox + 16 + x, y); else g.moveTo(ox + 16 + x, y); }
    g.stroke(); g.strokeStyle = line;
    g.beginPath(); for (let x = -40; x <= 40; x += 4) { const y = 92 - (1600 - x * x) / 26; if (x > -40) g.lineTo(ox + 190 + x, y); else g.moveTo(ox + 190 + x, y); } g.stroke();
    formula('v² = v₀² + 2aΔx', ox + 132, 120, 14);
    formula('ψ(x,t)', ox + 20, 140, 16); scribble(ox + 86, 136, 120, 11);
    // a little circuit: battery + resistor zigzag loop
    g.lineWidth = 2; g.beginPath(); g.moveTo(ox + 30, 170); g.lineTo(ox + 30, 222); g.lineTo(ox + 120, 222); g.lineTo(ox + 120, 170); g.lineTo(ox + 96, 170);
    for (let i = 0; i < 6; i++) g.lineTo(ox + 90 - i * 6, 170 + (i % 2 ? -6 : 6));
    g.lineTo(ox + 54, 170); g.lineTo(ox + 30, 170); g.stroke();
    g.beginPath(); g.moveTo(ox + 24, 192); g.lineTo(ox + 36, 192); g.moveTo(ox + 27, 198); g.lineTo(ox + 33, 198); g.stroke();
    eq(ox + 140, 190, 12); scribble(ox + 140, 228, 90, 9);
  },

  /** Acoustic ceiling tile: grid with pin-hole speckle. */
  acoustic: ({ bg, line, speck }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = speck; for (let i = 0; i < 140; i++) dot(g, r() * w, r() * h, 0.6 + r() * 0.9);
    g.fillStyle = line; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h); g.fillRect(0, h / 2, w, 3); g.fillRect(w / 2, 0, 3, h);
  },

  /** Coffered ceiling: deep square coffers with a gilt rosette. */
  coffer: ({ frame, well, edge, rose }) => (g, w, h) => {
    g.fillStyle = frame; g.fillRect(0, 0, w, h);
    const m = w * 0.14;
    g.fillStyle = edge; g.fillRect(m, m, w - 2 * m, h - 2 * m);
    g.fillStyle = well; g.fillRect(m + 6, m + 6, w - 2 * m - 12, h - 2 * m - 12);
    g.fillStyle = rose; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; dot(g, w / 2 + Math.cos(a) * 9, h / 2 + Math.sin(a) * 9, 5); }
    g.fillStyle = edge; dot(g, w / 2, h / 2, 5);
  },

  /** Student-centre carpet: bold 90s confetti of squiggles, triangles and dots on navy. */
  carpet90: ({ bg, cols }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.lineCap = 'round';
    for (let i = 0; i < 22; i++) {
      const x = r() * w; const y = r() * h; const c = cols[i % cols.length]; const kind = i % 3; const a = r() * 6;
      wrapDo(w, h, (ox, oy) => {
        g.fillStyle = c; g.strokeStyle = c;
        if (kind === 0) { g.lineWidth = 4; g.beginPath(); g.moveTo(x + ox - 14, y + oy); g.bezierCurveTo(x + ox - 6, y + oy - 12, x + ox + 2, y + oy + 12, x + ox + 14, y + oy); g.stroke(); }
        else if (kind === 1) { g.beginPath(); g.moveTo(x + ox + Math.cos(a) * 10, y + oy + Math.sin(a) * 10); g.lineTo(x + ox + Math.cos(a + 2.1) * 10, y + oy + Math.sin(a + 2.1) * 10); g.lineTo(x + ox + Math.cos(a + 4.2) * 10, y + oy + Math.sin(a + 4.2) * 10); g.fill(); }
        else dot(g, x + ox, y + oy, 4.5);
      });
    }
  },

  /** Books on shelves, painted (two shelves per tile): cheap distant bookcases. */
  shelfbooks: ({ cols, back, board }) => (g, w, h, r) => {
    g.fillStyle = back; g.fillRect(0, 0, w, h);
    for (let s = 0; s < 2; s++) {
      const y1 = (s + 1) * h / 2 - 10; let x = 0;
      while (x < w) {
        const bw = 6 + r() * 9; const bh = (h / 2 - 22) * (0.65 + r() * 0.35); const c = cols[Math.floor(r() * cols.length)];
        const ww = Math.min(bw, w - x);
        g.fillStyle = c; g.fillRect(x, y1 - bh, ww - 1, bh);
        g.fillStyle = 'rgba(255,240,200,0.55)'; g.fillRect(x + 1, y1 - bh + 6, ww - 3, 2); g.fillRect(x + 1, y1 - 9, ww - 3, 2);
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + ww - 2, y1 - bh, 1, bh);
        x += bw; if (r() < 0.06) x += 10;
      }
      g.fillStyle = board; g.fillRect(0, y1, w, 10);
    }
  },

  /** Flatirons backdrop: banded sky, slanted pink slabs, pine-dotted foothills (repeats sideways). */
  flatirons: ({ sky, rock, rockDk, hill, pine }) => (g, w, h, r) => {
    sky.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, (i / sky.length) * h * 0.62, w, h); });
    // clouds
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [x, y, s] of [[0.12, 0.14, 1], [0.55, 0.1, 0.8], [0.8, 0.2, 0.6]]) wrapDo(w, 0, (ox) => { g.beginPath(); g.ellipse(w * x + ox, h * y, 34 * s, 9 * s, 0, 0, Math.PI * 2); g.ellipse(w * x + 18 * s + ox, h * y - 6 * s, 20 * s, 9 * s, 0, 0, Math.PI * 2); g.fill(); });
    // distant ridge
    g.fillStyle = '#9a8fb3'; g.beginPath(); g.moveTo(0, h * 0.62);
    for (let x = 0; x <= w; x += w / 12) g.lineTo(x, h * (0.5 + 0.06 * Math.sin(x / w * Math.PI * 6)));
    g.lineTo(w, h); g.lineTo(0, h); g.fill();
    // the irons: steep slabs leaning south (to the right)
    const slabs = [[0.04, 0.55, 0.2], [0.16, 0.3, 0.24], [0.33, 0.18, 0.27], [0.55, 0.26, 0.22], [0.71, 0.42, 0.16], [0.86, 0.32, 0.2]];
    for (const [x0, top, wd] of slabs) {
      const xa = x0 * w; const xb = (x0 + wd) * w; const xt = xa + (xb - xa) * 0.32;
      wrapDo(w, 0, (ox) => {
        g.fillStyle = rock; g.beginPath(); g.moveTo(xa + ox, h * 0.82); g.lineTo(xt + ox, h * top); g.lineTo(xb + ox, h * 0.82); g.fill();
        g.fillStyle = rockDk; g.beginPath(); g.moveTo(xt + ox, h * top); g.lineTo(xb + ox, h * 0.82); g.lineTo(xt + (xb - xt) * 0.55 + ox, h * 0.82); g.fill();
        g.strokeStyle = 'rgba(120,60,50,0.35)'; g.lineWidth = 2;
        for (let k = 1; k < 4; k++) { const yy = h * top + (h * 0.82 - h * top) * k / 4; g.beginPath(); g.moveTo(xa + (xt - xa) * (1 - k / 4) + ox, yy); g.lineTo(xt + (xb - xt) * (k / 4) * 0.98 + ox, yy - 6); g.stroke(); }
      });
    }
    // foothills + pines
    g.fillStyle = hill; g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += w / 16) g.lineTo(x, h * (0.78 + 0.04 * Math.sin(x / w * Math.PI * 4 + 1)));
    g.lineTo(w, h); g.fill();
    g.fillStyle = pine;
    for (let i = 0; i < 46; i++) {
      const x = r() * w; const y = h * (0.8 + r() * 0.16); const s = 4 + r() * 5;
      wrapDo(w, 0, (ox) => { g.beginPath(); g.moveTo(x + ox, y - s * 2.4); g.lineTo(x + ox + s, y); g.lineTo(x + ox - s, y); g.fill(); });
    }
  },

  /** Painted arched window (not repeating): sky behind round-headed mullions. */
  archwin: ({ wall, sky, frame, glow }) => (g, w, h) => {
    g.fillStyle = wall; g.fillRect(0, 0, w, h);
    const m = w * 0.08; const rr = (w - 2 * m) / 2;
    g.fillStyle = frame; g.beginPath(); g.moveTo(m - 4, h - 4); g.lineTo(m - 4, rr + m); g.arc(w / 2, rr + m, rr + 4, Math.PI, 0); g.lineTo(w - m + 4, h - 4); g.fill();
    const grd = g.createLinearGradient(0, m, 0, h); grd.addColorStop(0, sky); grd.addColorStop(1, glow);
    g.fillStyle = grd; g.beginPath(); g.moveTo(m + 4, h - 10); g.lineTo(m + 4, rr + m); g.arc(w / 2, rr + m, rr - 4, Math.PI, 0); g.lineTo(w - m - 4, h - 10); g.fill();
    g.fillStyle = frame; g.fillRect(w / 2 - 3, m, 6, h - m); for (let k = 1; k < 4; k++) g.fillRect(m, rr + m + k * (h - rr - m) / 4, w - 2 * m, 5);
  },

  /** Locker bank (two lockers per tile, tintable greys): louvres, handle, number plate. */
  lockers: () => (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2; i++) {
      const x = i * w / 2;
      g.fillStyle = 'rgb(150,150,150)'; g.fillRect(x, 0, 3, h);
      g.fillStyle = 'rgb(185,185,185)'; for (let k = 0; k < 4; k++) g.fillRect(x + w * 0.12, h * 0.06 + k * 6, w * 0.26, 3);
      for (let k = 0; k < 4; k++) g.fillRect(x + w * 0.12, h * 0.8 + k * 6, w * 0.26, 3);
      g.fillStyle = 'rgb(90,90,90)'; g.fillRect(x + w * 0.4, h * 0.45, 4, 18);
      g.fillStyle = 'rgb(235,235,235)'; g.fillRect(x + w * 0.16, h * 0.3, 14, 8);
    }
  },

  /** Cork board with pinned flyers. */
  cork: ({ bg, flyers }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(90,50,20,0.25)'; for (let i = 0; i < 160; i++) dot(g, r() * w, r() * h, 1);
    for (let i = 0; i < 9; i++) {
      const fw = 18 + r() * 16; const fh = 22 + r() * 14; const x = 4 + r() * (w - fw - 8); const y = 4 + r() * (h - fh - 8);
      g.save(); g.translate(x + fw / 2, y + fh / 2); g.rotate((r() - 0.5) * 0.3);
      g.fillStyle = flyers[i % flyers.length]; g.fillRect(-fw / 2, -fh / 2, fw, fh);
      g.fillStyle = 'rgba(40,30,30,0.6)'; g.fillRect(-fw / 2 + 3, -fh / 2 + 4, fw * 0.7, 3); g.fillRect(-fw / 2 + 3, -fh / 2 + 10, fw * 0.5, 2); g.fillRect(-fw / 2 + 3, -fh / 2 + 14, fw * 0.6, 2);
      g.fillStyle = '#d9483b'; dot(g, 0, -fh / 2 + 2, 2.4);
      g.restore();
    }
  },

  /** CAD monitor (not repeating): dark blue viewport with a wireframe drone + toolbar. */
  cad: ({ bg, line, ui }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = ui; g.fillRect(0, 0, w, 10); g.fillRect(0, 0, 12, h);
    g.strokeStyle = 'rgba(120,180,255,0.25)'; g.lineWidth = 1;
    for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(12 + i * 13, h); g.lineTo(w / 2 + (i - 4) * 4, h * 0.45); g.stroke(); }
    g.strokeStyle = line; g.lineWidth = 2;
    const cx = w * 0.56; const cy = h * 0.52;
    g.beginPath(); g.moveTo(cx - 30, cy - 14); g.lineTo(cx + 30, cy + 14); g.moveTo(cx - 30, cy + 14); g.lineTo(cx + 30, cy - 14); g.stroke();
    for (const [x, y] of [[-30, -14], [30, 14], [-30, 14], [30, -14]]) { g.beginPath(); g.ellipse(cx + x, cy + y, 13, 5, 0, 0, Math.PI * 2); g.stroke(); }
    g.strokeRect(cx - 8, cy - 5, 16, 10);
  },

  /** Lab whiteboard (not repeating): marker sketch of a rocket, a trajectory and notes. */
  whiteboard: ({ bg, blue, red, black, green }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 2;
    // rocket
    g.strokeStyle = blue; g.beginPath(); g.moveTo(22, 80); g.lineTo(22, 34); g.quadraticCurveTo(29, 14, 36, 34); g.lineTo(36, 80); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(22, 70); g.lineTo(14, 86); g.lineTo(22, 80); g.moveTo(36, 70); g.lineTo(44, 86); g.lineTo(36, 80); g.stroke();
    g.strokeStyle = red; g.beginPath(); g.moveTo(25, 84); g.lineTo(29, 98); g.lineTo(33, 84); g.stroke();
    // trajectory
    g.strokeStyle = black; g.beginPath(); g.moveTo(56, 96); g.lineTo(104, 96); g.moveTo(56, 96); g.lineTo(56, 50); g.stroke();
    g.strokeStyle = green; g.beginPath(); for (let x = 0; x <= 44; x += 3) { const y = 94 - (x * (44 - x)) / 12; if (x) g.lineTo(58 + x, y); else g.moveTo(58 + x, y); } g.stroke();
    g.fillStyle = red; dot(g, 80, 54, 3);
    // notes
    g.strokeStyle = black; g.lineWidth = 1.5;
    for (let k = 0; k < 4; k++) { const y = 14 + k * 9; g.beginPath(); g.moveTo(56, y); let x = 56; while (x < 56 + 30 + r() * 20) { x += 4; g.lineTo(x, y + (r() - 0.5) * 4); } g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, h - 6, w, 6);
  },

  /** Pegboard with painted tool silhouettes. */
  pegboard: ({ bg, hole, tools }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = hole; for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) dot(g, (i + 0.5) * w / 8, (j + 0.5) * h / 8, 2);
    g.strokeStyle = tools[0]; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(20, 20); g.lineTo(20, 80); g.stroke(); dot(g, 20, 16, 8); // wrench
    g.strokeStyle = tools[1]; g.beginPath(); g.moveTo(46, 30); g.lineTo(46, 92); g.stroke(); g.fillStyle = tools[1]; g.fillRect(36, 22, 20, 10); // hammer
    g.strokeStyle = tools[2]; g.lineWidth = 4; g.beginPath(); g.moveTo(72, 18); g.lineTo(72, 70); g.stroke(); g.fillStyle = tools[2]; g.fillRect(66, 70, 12, 24); // screwdriver
    g.strokeStyle = tools[3]; g.lineWidth = 3; g.beginPath(); g.moveTo(90, 22); g.lineTo(100, 60); g.moveTo(104, 22); g.lineTo(94, 60); g.stroke(); // pliers
  },

  /** Café menu board (not repeating): chalk headings, price dots, a coffee cup. */
  menu: ({ bg, cols }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7a5a3a'; g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5); g.fillRect(0, 0, 5, h); g.fillRect(w - 5, 0, 5, h);
    for (let c = 0; c < 2; c++) for (let k = 0; k < 5; k++) {
      const x = 12 + c * w / 2; const y = 22 + k * 15;
      g.fillStyle = k === 0 ? cols[c] : 'rgba(240,240,230,0.85)';
      g.fillRect(x, y, k === 0 ? 30 : 22 + ((k * 7 + c * 3) % 14), k === 0 ? 5 : 3);
      if (k) { g.fillStyle = cols[2]; g.fillRect(x + w / 2 - 26, y, 8, 3); }
    }
    g.strokeStyle = '#f0ece0'; g.lineWidth = 2; g.strokeRect(w / 2 - 9, h - 26, 18, 14); g.beginPath(); g.arc(w / 2 + 11, h - 19, 4, -1.4, 1.4); g.stroke();
  },

  /** Generic event poster (not repeating). kind: 'peaks' | 'notes' | 'bike' | 'sun' */
  poster: ({ kind, bg, cols }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const [a, b, c] = cols;
    if (kind === 'peaks') {
      g.fillStyle = a; dot(g, w * 0.68, h * 0.3, w * 0.14);
      g.fillStyle = b; g.beginPath(); g.moveTo(0, h * 0.7); g.lineTo(w * 0.35, h * 0.32); g.lineTo(w * 0.55, h * 0.55); g.lineTo(w * 0.75, h * 0.38); g.lineTo(w, h * 0.65); g.lineTo(w, h * 0.72); g.lineTo(0, h * 0.72); g.fill();
    } else if (kind === 'notes') {
      g.fillStyle = a; for (let k = 0; k < 3; k++) { dot(g, w * (0.3 + k * 0.2), h * (0.55 - k * 0.08), w * 0.07); g.fillRect(w * (0.3 + k * 0.2) + w * 0.05, h * (0.25 - k * 0.08), 4, h * 0.3); }
      g.fillStyle = b; g.fillRect(w * 0.35, h * (0.17), w * 0.45, 7);
    } else if (kind === 'bike') {
      g.strokeStyle = a; g.lineWidth = 5; for (const x of [0.3, 0.7]) { g.beginPath(); g.arc(w * x, h * 0.52, w * 0.15, 0, Math.PI * 2); g.stroke(); }
      g.strokeStyle = b; g.beginPath(); g.moveTo(w * 0.3, h * 0.52); g.lineTo(w * 0.45, h * 0.36); g.lineTo(w * 0.62, h * 0.36); g.lineTo(w * 0.7, h * 0.52); g.moveTo(w * 0.45, h * 0.36); g.lineTo(w * 0.5, h * 0.52); g.lineTo(w * 0.62, h * 0.36); g.stroke();
    } else {
      for (let k = 0; k < 6; k++) { g.fillStyle = k % 2 ? a : b; g.beginPath(); g.moveTo(w / 2, h * 0.45); g.arc(w / 2, h * 0.45, w * 0.6, k * Math.PI / 3, (k + 1) * Math.PI / 3); g.fill(); }
      g.fillStyle = bg; dot(g, w / 2, h * 0.45, w * 0.16);
    }
    g.fillStyle = c; g.fillRect(w * 0.12, h * 0.8, w * 0.76, h * 0.06); g.fillRect(w * 0.12, h * 0.89, w * 0.46, h * 0.03);
  },

  /** Card-catalogue drawers: grid of little drawer fronts with brass pulls (tintable). */
  drawers: ({ n = 4 } = {}) => (g, w, h) => {
    g.fillStyle = 'rgb(170,170,170)'; g.fillRect(0, 0, w, h);
    const s = w / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      g.fillStyle = '#ffffff'; g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
      g.fillStyle = '#c9a24a'; g.fillRect(i * s + s * 0.38, j * s + s * 0.6, s * 0.24, 4);
      g.fillStyle = '#f4ecd8'; g.fillRect(i * s + s * 0.3, j * s + s * 0.25, s * 0.4, s * 0.18);
    }
  },

  /** CU-ish pennant banner stripes: black field, gold chevrons (no marks or wordmarks). */
  banner: ({ a, b }) => (g, w, h) => {
    g.fillStyle = a; g.fillRect(0, 0, w, h);
    g.fillStyle = b;
    for (let k = 0; k < 3; k++) { const y = h * (0.18 + k * 0.28); g.beginPath(); g.moveTo(0, y); g.lineTo(w / 2, y + h * 0.12); g.lineTo(w, y); g.lineTo(w, y + h * 0.07); g.lineTo(w / 2, y + h * 0.19); g.lineTo(0, y + h * 0.07); g.fill(); }
    g.fillRect(0, 0, w, h * 0.05); g.fillRect(0, h * 0.95, w, h * 0.05);
  },

  /** Aspen bark: white with black "eyes" (tintable-ish). */
  aspenbark: () => (g, w, h, r) => {
    g.fillStyle = '#f3efe6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a2730';
    for (let i = 0; i < 7; i++) { const x = r() * w; const y = r() * h; wrapDo(w, h, (ox, oy) => { g.beginPath(); g.ellipse(x + ox, y + oy, 5 + r() * 4, 1.6, 0, 0, Math.PI * 2); g.fill(); }); }
    g.fillStyle = 'rgba(120,120,110,0.25)'; for (let i = 0; i < 10; i++) g.fillRect(0, r() * h, w, 1);
  },

  /** Speckled tier carpet (tintable greys). */
  speckle: ({ n = 260 } = {}) => (g, w, h, r) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) { const v = 150 + Math.floor(r() * 80); g.fillStyle = `rgb(${v},${v},${v})`; dot(g, r() * w, r() * h, 0.8 + r() * 1.2); }
  },
};

// ── geometry helpers ─────────────────────────────────────────────────────
/** Solid AABB with collider (default: a crawlable wall). */
function solid(b, x0, y0, z0, x1, y1, z1, o = {}, flags = {}) {
  return aabb(b, x0, y0, z0, x1, y1, z1, { ...o, collide: { wall: true, ...flags } });
}
/** Visual-only AABB. */
function deco(b, x0, y0, z0, x1, y1, z1, o = {}) { return aabb(b, x0, y0, z0, x1, y1, z1, o); }

/** Round sandstone arch ring of voussoirs in a vertical plane (axis 'x': spans along x at fixed z). */
function arch(b, cx, cy, cz, span, { depth = 0.36, thick = 0.2, n = 7, color = C.stone, key = C.stoneD, axis = 'x' } = {}) {
  const R = span / 2 + thick / 2;
  const segLen = (Math.PI * R) / n + 0.02;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (i + 0.5) / n;
    const x = Math.cos(a) * R; const y = Math.sin(a) * R;
    const col = i === (n >> 1) ? key : (i % 2 ? color : C.stoneE);
    if (axis === 'x') b.add(boxGeo(segLen, thick, depth), { at: [cx + x, cy + y, cz], rot: [0, 0, a - Math.PI / 2], color: col, tile: 'sandstone', rep: 1.6 });
    else b.add(boxGeo(depth, thick, segLen), { at: [cx, cy + y, cz + x], rot: [a - Math.PI / 2, 0, 0], color: col, tile: 'sandstone', rep: 1.6 });
  }
}

/** Sloped red clay tile eave strip along a wall top. side: direction the eave slopes down to. */
function eave(b, x0, z0, x1, z1, y, side, { width = 0.9, drop = 0.3 } = {}) {
  const alongX = Math.abs(z1 - z0) < 1e-6;
  const L = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const ang = Math.atan2(drop, width);
  const off = width / 2 - 0.15;
  const cx = alongX ? (x0 + x1) / 2 : x0 + side * off; const cz = alongX ? z0 + side * off : (z0 + z1) / 2;
  const len = Math.hypot(width, drop);
  if (alongX) b.add(boxGeo(L + 0.3, 0.07, len, { faces: ['py', 'pz', 'nz', 'px', 'nx'] }), { at: [cx, y - drop / 2 + 0.06, cz], rot: [side * ang, 0, 0], color: '#ffffff', tile: 'rooftile', rep: [0.9, 0.6], outline: true });
  else b.add(boxGeo(len, 0.07, L + 0.3, { faces: ['py', 'px', 'nx', 'pz', 'nz'] }), { at: [cx, y - drop / 2 + 0.06, cz], rot: [0, 0, -side * ang], color: '#ffffff', tile: 'rooftile', rep: [0.6, 0.9], outline: true });
}

/** Invisible guard over a roof / above a low wall: blocks and can't be climbed. */
function guard(b, x0, y0, z0, x1, y1, z1, name) { b.collide(x0, y0, z0, x1, y1, z1, { wall: false, climb: false, name: 'guard:' + name }); }

/** A ceiling: downward face only + a { ceil } collider. */
function ceiling(b, x0, z0, x1, z1, y, o = {}) {
  deco(b, x0, y, z0, x1, y + 0.02, z1, { faces: ['ny'], color: o.color || '#ffffff', tile: o.tile, rep: o.rep || 1, outline: false });
  b.collide(x0, y, z0, x1, y + 0.12, z1, { wall: false, ceil: true, name: 'ceil:' + (o.name || 'room') });
}

/** Glass in a window opening (see-through, not climbable) + a slim mullion cross. */
function glazing(b, axis, fixed, a, c, y0, y1, frame = C.ink) {
  if (axis === 'x') {
    b.collide(a, y0, fixed - 0.03, c, y1, fixed + 0.03, { wall: false, climb: false, name: 'glass' });
    deco(b, (a + c) / 2 - 0.02, y0, fixed - 0.02, (a + c) / 2 + 0.02, y1, fixed + 0.02, { color: frame });
    deco(b, a, (y0 + y1) / 2 - 0.02, fixed - 0.02, c, (y0 + y1) / 2 + 0.02, fixed + 0.02, { color: frame });
  } else {
    b.collide(fixed - 0.03, y0, a, fixed + 0.03, y1, c, { wall: false, climb: false, name: 'glass' });
    deco(b, fixed - 0.02, y0, (a + c) / 2 - 0.02, fixed + 0.02, y1, (a + c) / 2 + 0.02, { color: frame });
    deco(b, fixed - 0.02, (y0 + y1) / 2 - 0.02, a, fixed + 0.02, (y0 + y1) / 2 + 0.02, c, { color: frame });
  }
}

/** An EXIT sign box: faces the given normal ('z+', 'z-', 'x+', 'x-'). */
function exitSign(b, x, y, z, normal) {
  const ax = normal[0] === 'x'; const sg = normal[1] === '+' ? 1 : -1;
  if (ax) {
    deco(b, x, y - 0.1, z - 0.24, x + sg * 0.07, y + 0.1, z + 0.24, { color: '#f3efe6' });
    b.add(boxGeo(0.004, 0.18, 0.44, { faces: [sg > 0 ? 'px' : 'nx'], fit: true }), { at: [x + sg * 0.073, y, z], tile: 'exit', color: '#ffffff', outline: false });
  } else {
    deco(b, x - 0.24, y - 0.1, z, x + 0.24, y + 0.1, z + sg * 0.07, { color: '#f3efe6' });
    b.add(boxGeo(0.44, 0.18, 0.004, { faces: [sg > 0 ? 'pz' : 'nz'], fit: true }), { at: [x, y, z + sg * 0.073], tile: 'exit', color: '#ffffff', outline: false });
  }
}

/** A flat picture/poster facing a direction, no frame collider (posters lie flush). */
function poster(b, x, y, z, w, h, normal, tile, frame = null) {
  const ax = normal[0] === 'x'; const sg = normal[1] === '+' ? 1 : -1;
  if (frame) { if (ax) deco(b, x, y - h / 2 - 0.04, z - w / 2 - 0.04, x + sg * 0.025, y + h / 2 + 0.04, z + w / 2 + 0.04, { color: frame }); else deco(b, x - w / 2 - 0.04, y - h / 2 - 0.04, z, x + w / 2 + 0.04, y + h / 2 + 0.04, z + sg * 0.025, { color: frame }); }
  const d = frame ? 0.028 : 0.006;
  if (ax) b.add(boxGeo(0.004, h, w, { faces: [sg > 0 ? 'px' : 'nx'], fit: true }), { at: [x + sg * d, y, z], tile, color: '#ffffff', outline: !frame });
  else b.add(boxGeo(w, h, 0.004, { faces: [sg > 0 ? 'pz' : 'nz'], fit: true }), { at: [x, y, z + sg * d], tile, color: '#ffffff', outline: !frame });
}

// ── the map ──────────────────────────────────────────────────────────────
const W = 34; const D = 26; // x −17..17, z −13..13
const UP = 2.72; // gallery / top-of-rake floor (16 × 0.17 risers)
const H = { g1: 5.4, cor: 2.7, nor: 4.8, umc: 3.3, lab: 3.0, arc: 3.45 };

function build(atlas, kit) {
  const P = kit.P;
  atlas.add('sandstone', PAT.sandstone({ cols: [C.stoneA, C.stoneB, C.stoneC, C.stoneD, C.stoneE], mortar: C.mortar }), { size: 'L' });
  atlas.add('flag', PAT.flagstone({ cols: ['#c9a389', '#b88d73', '#d4b08f', '#a98a78', '#c19a7c', '#b5a08a'], joint: '#8a7466' }), { size: 'L' });
  atlas.add('shelfbooks', PAT.shelfbooks({ cols: [C.red, C.teal, C.mustard, C.navy, C.plum, '#3f6b45', C.coral, '#f3e7cf', C.black, '#8c5a3c', C.gold], back: '#4a3122', board: '#7a4e35' }), { size: 'L' });
  atlas.add('chalk', PAT.chalk({ bg: C.chalk, line: C.chalkLine, accent: '#f2d27a' }), { w: 480, h: 240 });
  atlas.add('flatirons', PAT.flatirons({ sky: ['#9fd0ea', '#b4dbef', '#c9e5f3', '#dcedf5'], rock: '#d99c86', rockDk: '#b8786a', hill: '#6f9a5a', pine: '#2f5537' }), { w: 480, h: 240 });
  atlas.add('rooftile', PAT.rooftile({ a: C.tile, b: C.tileLt, dark: C.tileDk }), { size: 'M' });
  atlas.add('acoustic', PAT.acoustic({ bg: '#f2efe8', line: '#d8d2c6', speck: '#bdb6a8' }), { size: 'M' });
  atlas.add('coffer', PAT.coffer({ frame: '#efe3c8', well: '#5a7a8c', edge: '#c9a24a', rose: '#e9cf86' }), { size: 'M' });
  atlas.add('carpet90', PAT.carpet90({ bg: '#283a63', cols: [C.teal, '#9b6bd1', C.gold, C.coral, '#5fc2c9'] }), { size: 'M' });
  atlas.add('terrazzo', Q.terrazzo({ bg: '#e7e1d4', cols: ['#9a8f80', '#c06a4f', '#5f7f8f', '#2a2730', '#cfb87c'], n: 90 }), { size: 'M' });
  atlas.add('labfloor', P.checker({ a: '#c9ced3', b: '#aeb6bd', n: 4, grout: '#9aa3ab' }), { size: 'M' });
  atlas.add('pegboard', PAT.pegboard({ bg: '#c99a6b', hole: '#6b4430', tools: [C.red, '#3f6fd1', C.mustard, C.ink] }), { size: 'M' });
  atlas.add('whiteboard', PAT.whiteboard({ bg: '#f8f8f4', blue: '#2f5fbf', red: '#d9483b', black: '#2a2730', green: '#2f8f4f' }), { size: 'M', repeat: false });
  atlas.add('lockers', PAT.lockers(), { size: 'M' });
  atlas.add('cork', PAT.cork({ bg: '#c69462', flyers: ['#f2c14e', '#8fc3e0', '#f08aa8', '#f8f5ee', '#9fd38c', '#e07a5f'] }), { size: 'M' });
  atlas.add('cad', PAT.cad({ bg: '#18264a', line: '#7fe0ff', ui: '#3a4a6a' }), { size: 'S', repeat: false });
  atlas.add('lawn', P.lawn({ a: C.grass, b: C.grassB, fleck: '#a9d47e' }), { size: 'M' });
  atlas.add('aspenleaf', P.leafy({ base: C.aspen, light: '#f7d774', dark: C.aspenB, n: 50 }), { size: 'M' });
  atlas.add('pineleaf', P.leafy({ base: C.pine, light: '#5a8a5a', dark: C.pineB, n: 50 }), { size: 'M' });
  atlas.add('seatfab', PAT.speckle({ n: 200 }), { size: 'M' });
  atlas.add('wood', P.wood({ n: 6 }), { size: 'M' });
  atlas.add('herring', P.herringbone({ a: '#b98a5c', b: '#a77a4f', seam: '#7a5235' }), { size: 'M' });
  atlas.add('menu', PAT.menu({ bg: '#25302b', cols: [C.gold, '#8fc3e0', C.coral] }), { size: 'M', repeat: false });
  atlas.add('poster1', PAT.poster({ kind: 'peaks', bg: '#f6e7c8', cols: [C.coral, '#4f7f9f', C.ink] }), { size: 'S', repeat: false });
  atlas.add('poster2', PAT.poster({ kind: 'notes', bg: '#7b5ea7', cols: ['#f2c14e', '#f8f5ee', '#f8f5ee'] }), { size: 'S', repeat: false });
  atlas.add('poster3', PAT.poster({ kind: 'bike', bg: '#9fd38c', cols: [C.ink, C.red, C.ink] }), { size: 'S', repeat: false });
  atlas.add('poster4', PAT.poster({ kind: 'sun', bg: C.black, cols: [C.gold, '#3a3639', C.gold] }), { size: 'S', repeat: false });
  atlas.add('banner', PAT.banner({ a: C.black, b: C.gold }), { size: 'S' });
  atlas.add('drawers', PAT.drawers({ n: 4 }), { size: 'M' });
  atlas.add('archwin', PAT.archwin({ wall: C.plaster, sky: '#9fd0ea', frame: '#5a3a26', glow: '#f6e7b8' }), { size: 'M', repeat: false });
  atlas.add('vinyl', P.stripes({ cols: ['#ffffff', '#d4d4d4'], widths: [5, 1], n: 4 }), { size: 'S' });
  atlas.add('slats', P.stripes({ cols: ['#ffffff', '#cdcdcd'], widths: [4, 1], n: 4 }), { size: 'M' });
  atlas.add('blockwall', P.bricks({ brick: '#ffffff', alt: '#f2f2f2', mortar: '#d0d0d0', rows: 6, cols: 2 }), { size: 'M' });
  atlas.add('spectrum', P.stripes({ cols: ['#7b4fbf', '#3f6fd1', '#2f9fbf', '#3fa66b', '#f2c14e', '#f28c38', '#d9483b'], n: 1 }), { size: 'S' });
  atlas.add('aspenbark', PAT.aspenbark(), { size: 'S' });
  atlas.add('spine', P.spine({ band: '#f6e7b8' }), { size: 'S', repeat: false });
  atlas.add('exit', Q.sign({ bg: '#fbf6ec', fg: '#d62f2f', text: 'EXIT' }), { w: 96, h: 40, repeat: false });

  return (b) => {
    const R = kit.seeded('cuboulder');

    // ── base plinth + floors ──
    deco(b, -W / 2 - 0.45, -0.55, -D / 2 - 0.45, W / 2 + 0.45, -0.02, D / 2 + 0.45, { color: '#8a5d45', tile: 'sandstone', rep: 2.2 });
    deco(b, -W / 2 - 0.5, -0.1, -D / 2 - 0.5, W / 2 + 0.5, -0.004, D / 2 + 0.5, { color: '#7bb156', faces: ['py', 'px', 'nx', 'pz', 'nz'], outline: false });
    floor(b, -17, -13, -3, -1, 0, { tile: 'seatfab', rep: 0.9, color: '#5d6a7a' }); // G1B30 stage floor (tiers cover the rest)
    floor(b, -17, -1, -3, 1.4, 0, { tile: 'terrazzo', rep: 1.6 });
    floor(b, -3, -13, 8, -1, 0, { tile: 'herring', rep: 1.1 });
    floor(b, 8, -13, 17, -1, 0, { tile: 'carpet90', rep: 1.4 });
    floor(b, -17, 1.4, -8, 9, 0, { tile: 'labfloor', rep: 1.2 });
    floor(b, -3, -1, 17, 2.6, 0, { tile: 'flag', rep: 2.4 });
    floor(b, -8, 1.4, -3, 2.6, 0, { tile: 'flag', rep: 2.4 });
    floor(b, -17, 9, -8, 13, 0, { tile: 'flag', rep: 2.4 });
    floor(b, -8, 2.6, 17, 13, 0, { tile: 'lawn', rep: 2.0 });

    // ── outer walls (bounds) ──
    const SS = { tile: 'sandstone', rep: 2.4, color: '#ffffff' };
    const g1In = { color: '#7f6a5a', tile: 'slats', rep: 1.1 };
    wall(b, { x0: -17, z0: -13, x1: -3, z1: -13, h: 5.6, t: 0.2, n: SS, p: g1In, name: 'back', cap: C.tileDk });
    wall(b, { x0: -3, z0: -13, x1: 8, z1: -13, h: 5.0, t: 0.2, n: SS, p: { color: C.plaster }, name: 'back', cap: C.tileDk });
    wall(b, { x0: 8, z0: -13, x1: 17, z1: -13, h: 4.4, t: 0.2, n: SS, p: { color: '#e9d9bd' }, name: 'back', cap: C.tileDk });
    wall(b, { x0: -17, z0: -13, x1: -17, z1: -1, h: 5.6, t: 0.2, n: SS, p: g1In, name: 'left', cap: C.tileDk });
    wall(b, { x0: -17, z0: -1, x1: -17, z1: 1.4, h: 2.9, t: 0.2, n: SS, p: { color: C.block, tile: 'blockwall', rep: 1.2 }, name: 'left', cap: C.tileDk });
    wall(b, { x0: -17, z0: 1.4, x1: -17, z1: 9, h: 3.2, t: 0.2, n: SS, p: { color: C.blueGrey }, name: 'left', cap: C.tileDk });
    wall(b, { x0: -17, z0: 9, x1: -17, z1: 13, h: 0.7, t: 0.3, both: SS, name: 'left', cap: C.tileDk, outline: true });
    wall(b, { x0: 17, z0: -13, x1: 17, z1: -1, h: 4.4, t: 0.2, n: { color: '#e9d9bd' }, p: SS, name: 'right', cap: C.tileDk });
    wall(b, { x0: 17, z0: -1, x1: 17, z1: 13, h: 0.7, t: 0.3, both: SS, name: 'right', cap: C.tileDk, outline: true });
    wall(b, { x0: -17, z0: 13, x1: 17, z1: 13, h: 0.7, t: 0.3, both: SS, name: 'front', cap: C.tileDk, outline: true });
    // red tile copings on the low walls (perchable ledge)
    for (const [x0, z0, x1, z1] of [[-17.2, 12.8, 17.2, 13.2], [-17.2, 9, -16.8, 13.2], [16.8, -1, 17.2, 13.2]]) deco(b, x0, 0.7, z0, x1, 0.78, z1, { color: '#ffffff', tile: 'rooftile', rep: 0.6 });
    guard(b, -17.2, 0.7, 12.85, 17.2, 9, 13.3, 'front'); guard(b, -17.3, 0.7, 9, -16.85, 9, 13.3, 'left'); guard(b, 16.85, 0.7, -1, 17.3, 9, 13.3, 'right');
    // Flatirons backdrop: single-sided murals beyond the low walls (seen from the quad only)
    b.add(boxGeo(34.8, 5.4, 0.01, { faces: ['nz'] }), { at: [0, 2.6, 13.6], tile: 'flatirons', rep: [11.6, 5.4], color: '#ffffff', outline: false });
    b.add(boxGeo(0.01, 5.4, 14.8, { faces: ['nx'] }), { at: [17.6, 2.6, 6.0], tile: 'flatirons', rep: [11.6, 5.4], uvOff: [0.37, 0], color: '#ffffff', outline: false });

    g1b30(b, R);
    corridor(b);
    norlin(b, R, kit);
    umc(b, R, kit);
    lab(b, R);
    arcade(b);
    quad(b, R, kit);

    // ── spawns + spots (all ≥ 0.45 m clear of colliders; checked by the tests) ──
    b.spot('lobby', { x: 2.2, z: 5.0 });
    b.spot('hiderSpawn', { x: 1.0, z: 4.4, yaw: Math.PI });
    b.spot('seekerSpawn', { x: 7.0, z: 11.4, yaw: Math.PI });
    b.spot('spawnA', { x: -1.8, z: 4.6, yaw: Math.PI });
    b.spot('spawnB', { x: 11.6, z: 4.6, yaw: Math.PI });
    b.spot('hiderSpawns', [{ x: 1.0, z: 4.4, yaw: Math.PI }, { x: 10.4, z: 3.9, yaw: Math.PI }, { x: -5.0, z: 3.6, yaw: Math.PI }, { x: 5.0, z: 0.4, yaw: Math.PI }]);
    b.spot('seekerSpawns', [{ x: 7.0, z: 11.4, yaw: Math.PI }, { x: -1.0, z: 11.6, yaw: Math.PI }, { x: -13.6, z: 10.0, yaw: Math.PI }, { x: 12.8, z: 5.0, yaw: -Math.PI / 2 }]);
    b.spot('camo', { x: 7.3, z: -0.5, y: 0, wallNormal: [0, 0, 1], note: 'Norlin sandstone façade under the arcade' });
    b.spot('rug', { x: 5.0, z: 9.8, yaw: Math.PI });
    b.probe('demo-bench-top', [-10.2, 0.95, -2.85], [0, 1, 0], BENCH_TOP);
    b.probe('pool-felt', [11.0, 0.8, -6.5], [0, 1, 0], C.felt);
  };
}

// ── 1. DUANE G1B30 ──────────────────────────────────────────────────────────
// Seats face south (+z) toward the chalkboards on the south wall; tiers rise northward.
const TIER_D = 0.95; const TIER_R = 0.34;
const zN = (k) => -5.2 - TIER_D * k; // north edge of tier k (k = 0 is the floor row)
const BLOCKS = [[-15.9, -12.78, 6], [-11.6, -7.44, 8], [-6.26, -4.18, 4]]; // seat blocks: x0, x1, seats
const AISLES = [[-16.9, -15.9], [-12.78, -11.6], [-7.44, -6.26], [-4.18, -3.1]];

function g1b30(b, R) {
  // south wall (chalkboards inside, corridor outside) with two stage-level exits
  wall(b, { x0: -17, z0: -1, x1: -3, z1: -1, h: 5.6, t: 0.2, n: { color: '#8a7564', tile: 'slats', rep: 1.1 }, p: { color: C.block, tile: 'blockwall', rep: 1.2 }, open: [{ c: -15.6, w: 1.4, top: 2.3 }, { c: -4.4, w: 1.4, top: 2.3 }], trim: '#3a3437', name: 'g1-south' });
  // east wall (to Norlin), with the top-row door onto the gallery
  wall(b, { x0: -3, z0: -13, x1: -3, z1: -1, h: 5.6, t: 0.2, n: { color: '#8a7564', tile: 'slats', rep: 1.1 }, p: { color: C.plaster }, open: [{ c: -12.4, w: 1.0, bottom: UP, top: UP + 2.0 }], trim: C.walnut, name: 'g1-east' });
  ceiling(b, -16.9, -12.9, -3.1, -1.1, H.g1, { tile: 'acoustic', rep: 1.2, name: 'g1b30' });
  guard(b, -17.2, H.g1 + 0.12, -13.2, -3, 9, -1, 'g1roof');
  eave(b, -17.2, -1, -3, -1, 5.7, 1, { width: 1.0 });

  // ── tiers (solid, so no pockets): north half at full height, aisles step half-way on the south half
  const carpet = { color: '#4f5b6e', tile: 'seatfab', rep: 0.8, outline: false };
  for (let k = 1; k <= 8; k++) {
    const z0 = zN(k); const zs = z0 + TIER_D; const y = TIER_R * k;
    const zTop = k === 8 ? -12.9 : z0;
    // north half (full height, whole width)
    solid(b, -16.9, 0, zTop, -3.1, y, z0 + TIER_D / 2, { ...carpet, faces: ['py', 'pz'] }, { name: 'tier' });
    // south half: blocks full height, aisles one riser lower
    for (const [x0, x1] of BLOCKS) solid(b, x0, 0, z0 + TIER_D / 2, x1, y, zs, { ...carpet, faces: ['py', 'pz', 'px', 'nx'] }, { name: 'tier' });
    for (const [x0, x1] of AISLES) {
      solid(b, x0, 0, z0 + TIER_D / 2, x1, y - 0.17, zs, { ...carpet, color: '#3f4a5a', faces: ['py', 'pz'] }, { name: 'aisle' });
      // gold safety nosings on both aisle steps
      deco(b, x0, y - 0.19, zs - 0.04, x1, y - 0.165, zs + 0.004, { color: C.gold, outline: false });
      deco(b, x0, y - 0.02, z0 + TIER_D / 2 - 0.04, x1, y + 0.004, z0 + TIER_D / 2 + 0.004, { color: C.gold, outline: false });
    }
    // dark nosing on block risers
    for (const [x0, x1] of BLOCKS) deco(b, x0, y - 0.03, zs - 0.03, x1, y + 0.004, zs + 0.004, { color: C.ink, outline: false });
  }
  // cross-aisle railing at the top (north side of tier 7 drops 0.34 m: no rail needed) + back wall clock
  // ── seats, standards and desk strips
  for (let k = 0; k <= 7; k++) {
    const y = TIER_R * k; const n0 = zN(k); const zs = n0 + TIER_D;
    BLOCKS.forEach(([x0, x1, n], bi) => {
      const sw = (x1 - x0) / n;
      const gold = (bi === 1 && k % 2 === 0) || (bi !== 1 && k === 3);
      for (let i = 0; i < n; i++) {
        const cx = x0 + sw * (i + 0.5);
        // back (raised: walk under the seats along the row)
        solid(b, cx - sw / 2 + 0.03, y + 0.4, n0 + 0.1, cx + sw / 2 - 0.03, y + 0.95, n0 + 0.17, { color: gold ? C.goldDk : '#2f2c31' }, { name: 'seat-back' });
        // pan (folded down)
        aabb(b, cx - sw / 2 + 0.04, y + 0.42, n0 + 0.17, cx + sw / 2 - 0.04, y + 0.47, n0 + 0.56, { color: gold ? C.gold : '#4a4650', tile: 'seatfab', rep: 0.4, collide: { wall: false, ceil: true, name: 'seat' } });
      }
      // standards every two seats: a slim leg + a perchable arm (squeeze under it)
      for (let i = 0; i <= n; i += 2) {
        const sx = x0 + sw * i;
        deco(b, sx - 0.02, y, n0 + 0.3, sx + 0.02, y + 0.42, n0 + 0.34, { color: C.ink, outline: false });
        aabb(b, sx - 0.03, y + 0.42, n0 + 0.12, sx + 0.03, y + 0.64, n0 + 0.5, { color: C.ink, collide: { wall: false, perch: true, name: 'perch:arm' } });
      }
      // desk strip + modesty panel along the front edge of the tier
      aabb(b, x0, y + 0.71, zs - 0.34, x1, y + 0.75, zs - 0.02, { color: C.woodL, tile: 'wood', rep: 0.8, collide: { wall: false, ceil: true, name: 'desk' } });
      solid(b, x0, y, zs - 0.06, x1, y + 0.71, zs - 0.02, { color: '#6d5a4a', tile: 'slats', rep: 0.5 }, { name: 'panel' });
    });
  }

  // ── chalkboard wall: 4 × 2 sliding boards, aluminium frames, chalk tray (perch)
  const zb = -1.1;
  for (let col = 0; col < 4; col++) for (let row = 0; row < 2; row++) {
    const x0 = -14 + col * 2; const y0 = row ? 2.3 : 0.95;
    b.add(boxGeo(1.96, 1.2, 0.02, { faces: ['nz'] }), { at: [x0 + 1, y0 + 0.6, zb - 0.03], color: '#ffffff', tile: 'chalk', rep: [4, 1.2], uvOff: [[0, 0.5, 0.25, 0.75][col] + (row ? 0.37 : 0), 0], outline: false });
    deco(b, x0, y0 - 0.03, zb - 0.06, x0 + 2, y0, zb, { color: C.frameAl, outline: false });
    deco(b, x0, y0 + 1.2, zb - 0.06, x0 + 2, y0 + 1.23, zb, { color: C.frameAl, outline: false });
    deco(b, x0 - 0.015, y0, zb - 0.06, x0 + 0.015, y0 + 1.2, zb, { color: C.frameAl, outline: false });
  }
  deco(b, -6.015, 0.95, zb - 0.06, -5.985, 3.5, zb, { color: C.frameAl, outline: false });
  deco(b, -14.1, 0.9, zb - 0.13, -5.9, 0.94, zb, { color: C.frameAl, collide: { wall: false, perch: true, name: 'perch:chalk-tray' } });
  for (let i = 0; i < 6; i++) deco(b, -13.5 + i * 1.3, 0.94, zb - 0.1, -13.42 + i * 1.3, 0.96, zb - 0.07, { color: ['#f8f5ee', '#f2c14e', '#8fc3e0'][i % 3], outline: false });
  // projector screen above the boards + roller case
  deco(b, -11.6, 3.62, zb - 0.09, -8.4, 5.12, zb - 0.07, { color: '#f4f2ee' });
  deco(b, -11.8, 5.12, zb - 0.16, -8.2, 5.26, zb - 0.02, { color: '#d8d4cc' });
  // wall clock and the spectrum banner along the west wall (over the rake)
  b.add(cylGeo(0.26, 0.26, 0.05, { radial: 18 }), { at: [-4.9, 4.1, zb - 0.03], rot: [Math.PI / 2, 0, 0], color: '#f8f5ee' });
  deco(b, -4.92, 4.1, zb - 0.07, -4.88, 4.3, zb - 0.06, { color: C.ink, outline: false });
  deco(b, -4.9, 4.08, zb - 0.07, -4.75, 4.12, zb - 0.06, { color: C.ink, outline: false });
  b.add(boxGeo(0.01, 0.7, 10.5, { faces: ['px'] }), { at: [-16.895, 3.85, -6.8], tile: 'spectrum', rep: [10.5, 1], rot: [0, 0, 0], color: '#ffffff', outline: false });
  // exit signs over both doors (both sides)
  for (const x of [-15.6, -4.4]) { exitSign(b, x, 2.5, -1.1, 'z-'); exitSign(b, x, 2.5, -0.9, 'z+'); }
  exitSign(b, -3.1, UP + 2.2, -12.4, 'x-');

  // ── demo bench: cabinets at the ends, an open kneehole in the middle (hide under it)
  const bz0 = -3.55; const bz1 = -2.75;
  solid(b, -12.25, 0, bz0, -11.0, 0.9, bz1, { color: C.walnut, tile: 'wood', rep: 0.6 }, { name: 'bench' });
  solid(b, -9.0, 0, bz0, -7.75, 0.9, bz1, { color: C.walnut, tile: 'wood', rep: 0.6 }, { name: 'bench' });
  deco(b, -11.0, 0.5, bz0, -9.0, 0.9, bz0 + 0.04, { color: C.walnut, tile: 'wood', rep: 0.6 }); // back apron (seekers peek from the stage side)
  aabb(b, -12.35, 0.9, bz0 - 0.05, -7.65, 0.95, bz1 + 0.05, { color: BENCH_TOP, collide: { wall: false, ceil: true, name: 'bench-top' } });
  b.blob(-10, -3.15, 2.5, 0.6, { a: 0.28 });
  // Van de Graaff generator
  b.add(cylGeo(0.07, 0.11, 0.6, { radial: 12 }), { at: [-11.6, 1.25, -3.15], color: '#c9ced3', collide: true });
  b.add(sphereGeo(0.24, 0.24, 0.24, { w: 14, h: 10 }), { at: [-11.6, 1.72, -3.15], color: '#d8dde2', collide: true });
  // Newton's cradle
  for (const sx of [-0.18, 0.18]) for (const sz of [-0.08, 0.08]) deco(b, -10.6 + sx - 0.01, 0.95, -3.15 + sz - 0.01, -10.6 + sx + 0.01, 1.25, -3.15 + sz + 0.01, { color: C.steel, outline: false });
  deco(b, -10.8, 1.24, -3.24, -10.4, 1.26, -3.06, { color: C.steel });
  for (let i = 0; i < 5; i++) b.add(sphereGeo(0.035, 0.035, 0.035, { w: 8, h: 6 }), { at: [-10.74 + i * 0.07, 1.04, -3.15], color: '#d8dde2' });
  // beakers + flask
  [[-9.9, '#8fd3c0', 0.06, 0.16], [-9.72, '#f2c14e', 0.05, 0.12], [-9.55, '#f08aa8', 0.045, 0.2]].forEach(([x, c, r, h]) => {
    b.add(cylGeo(r, r, h, { radial: 10 }), { at: [x, 0.95 + h / 2, -3.0], color: '#e8f2f4' });
    b.add(cylGeo(r * 0.92, r * 0.92, h * 0.55, { radial: 10 }), { at: [x, 0.95 + h * 0.28, -3.0], color: c, outline: false });
  });
  b.add(latheGeo([[0.12, 0], [0.13, 0.08], [0.04, 0.22], [0.03, 0.34]], { radial: 12 }), { at: [-9.3, 0.95, -3.25], color: '#9fd38c' });
  // pendulum stand (tall, perchable crossbar)
  deco(b, -8.45, 0.95, -3.4, -8.41, 2.15, -3.36, { color: C.ink, outline: false });
  deco(b, -8.45, 0.95, -2.94, -8.41, 2.15, -2.9, { color: C.ink, outline: false });
  aabb(b, -8.47, 2.13, -3.42, -8.39, 2.19, -2.88, { color: C.ink, collide: { wall: false, perch: true, name: 'perch:pendulum' } });
  deco(b, -8.435, 1.4, -3.158, -8.425, 2.15, -3.152, { color: '#555', outline: false });
  b.add(sphereGeo(0.07, 0.07, 0.07, { w: 10, h: 7 }), { at: [-8.43, 1.36, -3.15], color: C.gold });
  // lectern + laptop, oscilloscope cart, tesla-coil-ish toroid on a stand
  solid(b, -6.3, 0, -3.3, -5.7, 1.1, -2.8, { color: C.walnut, tile: 'wood', rep: 0.5 }, { name: 'lectern' });
  aabb(b, -6.35, 1.1, -3.35, -5.65, 1.14, -2.72, { color: '#4a3324' });
  deco(b, -6.15, 1.14, -3.15, -5.85, 1.16, -2.95, { color: '#3a3d44' });
  deco(b, -6.15, 1.15, -3.17, -5.85, 1.35, -3.15, { color: '#3a3d44' });
  const cart = (x, z) => {
    aabb(b, x - 0.45, 0.78, z - 0.3, x + 0.45, 0.82, z + 0.3, { color: C.steel, collide: { wall: false, ceil: true, name: 'cart' } });
    aabb(b, x - 0.45, 0.2, z - 0.3, x + 0.45, 0.23, z + 0.3, { color: C.steel, collide: { wall: false, name: 'cart-shelf' } });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) deco(b, x + sx * 0.42 - 0.015, 0.06, z + sz * 0.27 - 0.015, x + sx * 0.42 + 0.015, 0.8, z + sz * 0.27 + 0.015, { color: '#6c737a', outline: false });
  };
  cart(-13.7, -2.5);
  solid(b, -14.0, 0.82, -2.7, -13.4, 1.18, -2.3, { color: '#5a6a7a' }, { name: 'scope' });
  b.add(boxGeo(0.3, 0.2, 0.004, { faces: ['pz'], fit: true }), { at: [-13.75, 1.0, -2.297], tile: 'cad', color: '#ffffff', outline: false });
  b.add(cylGeo(0.05, 0.08, 1.2, { radial: 10 }), { at: [-6.9, 0.6, -2.0], color: '#c26b3a', collide: true });
  b.add(latheGeo([[0.0, 0], [0.2, 0.02], [0.3, 0.1], [0.2, 0.18], [0.0, 0.2]], { radial: 16 }), { at: [-6.9, 1.2, -2.0], color: '#d8dde2' });
  b.blob(-6.9, -2.0, 0.3, 0.3);
  // ── ceiling: flush light rows + three suspended light bars (perches) + a hanging projector
  for (const x of [-14.5, -10, -5.5]) deco(b, x - 0.15, H.g1 - 0.06, -12.4, x + 0.15, H.g1, -1.6, { color: '#fff6d0', faces: ['ny', 'px', 'nx'], outline: false });
  for (const z of [-4.2, -7.6, -10.6]) {
    aabb(b, -15.5, 4.3, z - 0.11, -4.5, 4.38, z + 0.11, { color: '#fffbea', collide: { wall: false, perch: true, ceil: true, name: 'perch:lightbar' } });
    deco(b, -15.5, 4.38, z - 0.12, -4.5, 4.42, z + 0.12, { color: C.ink });
    for (const x of [-14.5, -10, -5.5]) deco(b, x - 0.01, 4.42, z - 0.01, x + 0.01, H.g1, z + 0.01, { color: C.ink, outline: false });
  }
  solid(b, -10.3, 4.55, -6.4, -9.7, 4.8, -5.9, { color: '#e6e3dc' }, { name: 'projector' });
  deco(b, -10.02, 4.8, -6.17, -9.98, H.g1, -6.13, { color: C.ink, outline: false });
  b.add(cylGeo(0.07, 0.07, 0.04, { radial: 10 }), { at: [-10, 4.67, -5.88], rot: [Math.PI / 2, 0, 0], color: '#2a3a4a', outline: false });
}

// ── 2. BASEMENT CORRIDOR (Duane, below ground: lockers, pipes, cork board) ─────────────
function corridor(b) {
  wall(b, { x0: -17, z0: 1.4, x1: -8, z1: 1.4, h: 3.2, t: 0.2, n: { color: C.block, tile: 'blockwall', rep: 1.2 }, p: { color: C.blueGrey }, open: [{ c: -12.5, w: 1.3, top: 2.2 }], trim: '#3a3437', name: 'cor-lab' });
  wall(b, { x0: -8, z0: 1.4, x1: -3, z1: 1.4, h: 2.9, t: 0.2, n: { color: C.block, tile: 'blockwall', rep: 1.2 }, p: { tile: 'sandstone', rep: 2.4 }, open: [{ c: -5.5, w: 1.6, top: 2.3 }], trim: C.walnut, name: 'cor-quad' });
  wall(b, { x0: -3, z0: -1, x1: -3, z1: 1.4, h: 2.9, t: 0.2, n: { color: C.block, tile: 'blockwall', rep: 1.2 }, p: { tile: 'sandstone', rep: 2.4 }, open: [{ c: 0.2, w: 2.0, top: 2.45 }], trim: C.walnut, name: 'cor-east' });
  ceiling(b, -16.9, -0.9, -3.1, 1.3, H.cor, { tile: 'acoustic', rep: 1.2, name: 'corridor' });
  guard(b, -17.2, H.cor + 0.12, -1, -3, 9, 1.5, 'corroof');
  eave(b, -8, 1.4, -3, 1.4, 3.0, 1, { width: 0.8 });
  arch(b, -5.5, 2.3, 1.62, 1.6, { depth: 0.2, thick: 0.16 });
  // lockers on the south side (tops are a hideout under the ceiling)
  for (const [x0, x1, col] of [[-16.6, -13.35, '#3f6fd1'], [-11.65, -8.35, C.mustard]]) {
    solid(b, x0, 0, 0.95, x1, 1.85, 1.3, { color: col, tile: 'lockers', rep: [0.7, 1.85] }, { name: 'lockers' });
    deco(b, x0, 0, 0.93, x1, 0.12, 0.95, { color: C.ink, outline: false });
  }
  // bulletin board, fountain, display case with a little solar system
  poster(b, -12.4, 1.45, -0.9, 2.4, 0.9, 'z+', 'cork', C.walnut);
  solid(b, -10.45, 0.72, -0.9, -9.95, 0.95, -0.55, { color: '#d8dde2' }, { name: 'fountain' });
  deco(b, -10.25, 0.95, -0.8, -10.15, 1.0, -0.7, { color: C.steel });
  solid(b, -9.4, 0, -0.9, -7.0, 0.8, -0.5, { color: C.walnut, tile: 'wood', rep: 0.5 }, { name: 'case' });
  deco(b, -9.4, 0.8, -0.9, -7.0, 1.9, -0.88, { color: '#3a4d6a' });
  for (const [x, z] of [[-9.38, -0.52], [-7.02, -0.52]]) deco(b, x - 0.02, 0.8, z - 0.02, x + 0.02, 1.9, z + 0.02, { color: C.walnut });
  solid(b, -9.42, 1.9, -0.92, -6.98, 1.96, -0.48, { color: C.walnut }, { name: 'case-top' });
  b.collide(-9.4, 0.8, -0.53, -7.0, 1.9, -0.49, { wall: false, climb: false, name: 'glass' });
  b.add(sphereGeo(0.13, 0.13, 0.13, { w: 12, h: 8 }), { at: [-8.2, 1.3, -0.7], color: C.mustard });
  [[0.25, 0.04, C.coral], [0.38, 0.05, C.teal], [0.52, 0.035, C.red], [0.66, 0.08, '#e9cf86']].forEach(([d, r, c], i) => {
    const a = i * 1.7;
    b.add(sphereGeo(r, r, r, { w: 8, h: 6 }), { at: [-8.2 + Math.cos(a) * d * 1.3, 1.3 + Math.sin(a * 2) * 0.05, -0.7 + Math.sin(a) * 0.12], color: c });
  });
  // basement pipes along the ceiling (perches, hang underneath)
  for (const [z, y, c, r] of [[-0.62, 2.48, C.red, 0.055], [-0.36, 2.44, '#7d93a6', 0.07]]) {
    b.add(cylGeo(r, r, 13.8, { radial: 10, caps: false }), { at: [-10, y, z], rot: [0, 0, Math.PI / 2], color: c, outline: true });
    b.collide(-16.9, y - r, z - r, -3.1, y + r, z + r, { wall: false, perch: true, name: 'perch:pipe' });
    for (let x = -15.5; x < -3; x += 3) deco(b, x - 0.02, y, z - 0.02, x + 0.02, H.cor, z + 0.02, { color: C.ink, outline: false });
  }
  for (const x of [-15, -11, -7]) deco(b, x - 0.6, H.cor - 0.04, 0.5, x + 0.6, H.cor, 0.85, { color: '#fff6d0', faces: ['ny', 'px', 'nx', 'pz', 'nz'], outline: false });
  // a hallway bench under the cork board
  aabb(b, -13.4, 0.42, -0.85, -11.4, 0.47, -0.45, { color: C.woodL, tile: 'wood', rep: 0.5, collide: { wall: false, ceil: true, name: 'bench' } });
  for (const x of [-13.25, -11.55]) deco(b, x - 0.04, 0, -0.8, x + 0.04, 0.42, -0.5, { color: C.ink });
  exitSign(b, -3.3, 2.45, 0.2, 'x-');
}

// ── 3. NORLIN READING ROOM ─────────────────────────────────────────────────────────
function norlin(b, R, kit) {
  const face = { tile: 'sandstone', rep: 2.4 };
  wall(b, { x0: -3, z0: -1, x1: 8, z1: -1, h: 5.0, t: 0.2, n: { color: C.plaster }, p: face, open: [{ c: 0.6, w: 1.2, bottom: 0.95, top: 2.55 }, { c: 3.85, w: 1.5, top: 2.7 }, { c: 6.6, w: 1.2, bottom: 0.95, top: 2.55 }], trim: C.walnut, name: 'nor-south' });
  wall(b, { x0: 8, z0: -13, x1: 8, z1: -1, h: 5.0, t: 0.2, n: { color: C.plaster }, p: { color: '#e9d9bd' }, open: [{ c: -5, w: 1.4, top: 2.4 }], trim: C.walnut, name: 'nor-umc' });
  glazing(b, 'x', -1, 0.06, 1.14, 0.95, 2.55); glazing(b, 'x', -1, 6.06, 7.14, 0.95, 2.55);
  for (const c of [0.6, 6.6]) arch(b, c, 2.55, -0.82, 1.2, { depth: 0.12, thick: 0.14, n: 5 });
  arch(b, 3.85, 2.7, -0.82, 1.5, { depth: 0.12, thick: 0.16 });
  ceiling(b, -2.9, -12.9, 7.9, -1.1, H.nor, { tile: 'coffer', rep: 1.45, name: 'norlin' });
  guard(b, -3, H.nor + 0.12, -13.2, 8, 9, -1, 'norroof');
  // coffer beams (hang from their undersides)
  for (const z of [-11.0, -8.1, -5.2, -2.3]) solid(b, -2.9, H.nor - 0.22, z - 0.1, 7.9, H.nor, z + 0.1, { color: '#e8d8b6', faces: ['ny', 'pz', 'nz'] }, { name: 'ceil:beam', ceil: true, wall: false });
  for (const x of [0.6, 3.85, 6.6]) solid(b, x - 0.1, H.nor - 0.22, -12.9, x + 0.1, H.nor, -1.1, { color: '#e8d8b6', faces: ['ny', 'px', 'nx'] }, { name: 'ceil:beam', ceil: true, wall: false });
  // tall arched windows painted high on the north wall
  for (const x of [0.6, 3.85, 6.6]) poster(b, x, 3.65, -12.9, 1.5, 1.7, 'z+', 'archwin');
  // ── back bookcases (painted rows + real books at eye level), rolling ladder
  const caseRow = (x0, x1, z, h, nrm) => {
    const s = nrm === 'z+' ? 1 : -1; const d = 0.42;
    const zb = z; const zf = z + s * d;
    solid(b, Math.min(x0, x1), 0, Math.min(zb, zf), Math.max(x0, x1), h, Math.max(zb, zf), { color: '#ffffff', tile: 'shelfbooks', rep: [2.0, 1.0], faces: [s > 0 ? 'pz' : 'nz'], outline: false }, { name: 'bookcase' });
    deco(b, Math.min(x0, x1) - 0.05, h, Math.min(zb, zf) - 0.02, Math.max(x0, x1) + 0.05, h + 0.12, Math.max(zb, zf) + 0.02, { color: C.walnut });
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1) + 0.01; x += (Math.max(x0, x1) - Math.min(x0, x1)) / 4) deco(b, x - 0.04, 0, Math.min(zb, zf) - 0.01, x + 0.04, h, Math.max(zb, zf) + 0.01, { color: C.walnut });
  };
  caseRow(-0.9, 7.8, -12.9, 2.6, 'z+');
  // real books on one eye-level ledge (in front of the painted ones: a ledge to hide on)
  const ledge = (x0, x1, y, z) => {
    aabb(b, x0, y - 0.03, z - 0.02, x1, y, z + 0.3, { color: C.walnut, collide: { wall: false, name: 'ledge' } });
    let x = x0 + 0.04; let k = 0;
    const cols = [C.red, C.teal, C.mustard, C.navy, C.plum, '#3f6b45', C.coral, '#f3e7cf', C.gold];
    while (x < x1 - 0.12) {
      if (R() < 0.08) { x += 0.3; continue; }
      const w = 0.05 + R() * 0.05; const h = 0.22 + R() * 0.14;
      b.add(boxGeo(w, h, 0.2), { at: [x + w / 2, y + h / 2, z + 0.13], tile: 'spine', rep: [w, h], color: cols[k++ % cols.length], rot: [0, 0, R() < 0.06 ? 0.15 : 0], outline: k % 2 === 0 });
      x += w + 0.006;
    }
  };
  ledge(-0.8, 2.0, 1.05, -12.48); ledge(4.6, 7.7, 1.05, -12.48);
  // rolling ladder (rungs are perches)
  for (const x of [2.6, 3.1]) deco(b, x - 0.025, 0, -12.2, x + 0.025, 2.75, -12.15, { color: C.walnut });
  for (let i = 1; i <= 8; i++) aabb(b, 2.6, i * 0.3, -12.22, 3.1, i * 0.3 + 0.04, -12.14, { color: C.walnut, collide: { wall: false, perch: true, name: 'perch:ladder' } });

  // ── gallery along the west wall (y 2.72) + stair down (the second floor)
  slab(b, -2.9, -12.9, -1.0, -5.75, UP, { thick: 0.18, under: { color: '#e8d8b6' }, top: { tile: 'herring', rep: 1.1 }, edge: C.walnut, name: 'ceil:gallery' });
  railing(b, -1.0, -12.9, -1.0, -5.75, UP, { color: C.walnut, top: C.walnut, name: 'gallery-rail' });
  for (const z of [-12.6, -9.4, -6.0]) solid(b, -1.12, 0, z - 0.12, -0.88, UP - 0.18, z + 0.12, { color: C.walnut, tile: 'wood', rep: 0.5 }, { name: 'post' });
  stairs(b, { x: -1.95, z: -1.55, dir: 'z-', width: 1.85, n: 15, rise: 0.17, run: 0.28, tread: { color: C.wood, tile: 'wood' }, stringer: C.walnut, railSide: 1, rail: C.walnut, name: 'nor-stair' });
  // bookcases on the gallery wall (upper) and under the gallery (ground)
  const sideCase = (z0, z1, y, h) => {
    solid(b, -2.9, y, z0, -2.5, y + h, z1, { color: '#ffffff', tile: 'shelfbooks', rep: [2.0, 1.0], faces: ['px'], outline: false }, { name: 'bookcase' });
    deco(b, -2.92, y + h, z0 - 0.02, -2.46, y + h + 0.1, z1 + 0.02, { color: C.walnut });
    for (let z = z0; z <= z1 + 0.01; z += (z1 - z0) / 3) deco(b, -2.9, y, z - 0.04, -2.48, y + h, z + 0.04, { color: C.walnut });
  };
  sideCase(-12.5, -6.2, UP, 1.8);
  sideCase(-12.5, -7.0, 0, 2.2);
  // reading nook under the stair: armchair + rug
  const ac = kit.frame(b, -1.9, -4.3, Math.PI / 2);
  ac.box(0.85, 0.3, 0.8, [0, 0.2, 0], { color: '#8a2f3a', tile: 'seatfab', rep: 0.4, collide: { wall: true } });
  ac.box(0.85, 0.55, 0.18, [0, 0.6, -0.33], { color: '#8a2f3a', tile: 'seatfab', rep: 0.4, collide: { wall: true } });
  for (const sx of [-1, 1]) ac.box(0.16, 0.5, 0.8, [sx * 0.42, 0.3, 0], { color: '#7a2833', collide: { wall: true } });
  ac.blob(0, 0, 0.55, 0.5);
  b.add(boxGeo(1.6, 0.012, 1.2), { at: [-0.9, 0.012, -4.3], tile: 'drawers', rep: 0.4, color: '#a64040' });

  // ── long tables with green banker's lamps and chairs
  for (const tz of [-10.4, -7.4, -4.4]) for (const [tx0, tx1] of [[0.2, 3.2], [4.5, 7.5]]) {
    const cx = (tx0 + tx1) / 2;
    aabb(b, tx0, 0.72, tz - 0.55, tx1, 0.77, tz + 0.55, { color: C.wood, tile: 'wood', rep: 0.7, collide: { wall: false, ceil: true, name: 'ceil:table' } });
    for (const sx of [tx0 + 0.12, tx1 - 0.12]) deco(b, sx - 0.05, 0, tz - 0.45, sx + 0.05, 0.72, tz + 0.45, { color: C.walnut, tile: 'wood', rep: 0.4 });
    deco(b, tx0 + 0.12, 0.12, tz - 0.03, tx1 - 0.12, 0.2, tz + 0.03, { color: C.walnut });
    b.blob(cx, tz, 1.7, 0.7, { a: 0.2 });
    for (const lx of [cx - 0.9, cx + 0.9]) {
      b.add(cylGeo(0.07, 0.08, 0.02, { radial: 10 }), { at: [lx, 0.78, tz], color: C.brass });
      deco(b, lx - 0.01, 0.78, tz - 0.01, lx + 0.01, 1.05, tz + 0.01, { color: C.brass, outline: false });
      b.add(sphereGeo(0.17, 0.09, 0.1, { w: 12, h: 4, thetaMax: Math.PI / 2 }), { at: [lx, 1.0, tz], color: C.lampGreen });
      b.add(boxGeo(0.3, 0.012, 0.12), { at: [lx, 1.02, tz], color: '#fff2b0', outline: false });
    }
    for (const side of [-1, 1]) for (const k of [-1, 0, 1]) {
      const chx = cx + k * 0.95; const chz = tz + side * 0.82;
      const f = kit.frame(b, chx, chz, side > 0 ? Math.PI : 0);
      f.box(0.42, 0.05, 0.42, [0, 0.45, 0], { color: C.wood, collide: { wall: false, name: 'chair' } });
      f.box(0.42, 0.42, 0.04, [0, 0.68, -0.21], { color: C.wood, collide: { wall: true, name: 'perch:chair-back', perch: true } });
      f.box(0.42, 0.45, 0.03, [0, 0.225, -0.18], { color: C.walnut });
      f.box(0.42, 0.45, 0.03, [0, 0.225, 0.18], { color: C.walnut });
    }
  }
  for (const [x, z] of [[1.7, -10.4], [6.0, -10.4], [1.7, -4.4], [6.0, -4.4]]) pendant(b, x, z, H.nor - 0.22, 3.35, { shade: '#e9cf86', r: 0.28 });
  // card catalogue, globe, circulation desk
  solid(b, 7.3, 0, -3.9, 7.85, 1.35, -2.1, { color: '#a8754d', tile: 'drawers', rep: 0.45 }, { name: 'catalogue' });
  deco(b, 7.25, 1.35, -3.95, 7.9, 1.42, -2.05, { color: C.walnut });
  b.add(sphereGeo(0.32, 0.32, 0.32, { w: 14, h: 10 }), { at: [-0.2, 1.05, -2.2], color: '#4f8fb0', collide: true });
  b.add(sphereGeo(0.325, 0.18, 0.325, { w: 12, h: 6 }), { at: [-0.2, 1.1, -2.2], rot: [0.4, 0, 0.2], color: '#9fd38c', outline: false });
  b.add(cylGeo(0.05, 0.22, 0.72, { radial: 10 }), { at: [-0.2, 0.36, -2.2], color: C.walnut, collide: true });
  b.blob(-0.2, -2.2, 0.35, 0.35);
  solid(b, 4.9, 0, -2.9, 7.0, 1.0, -2.3, { color: C.walnut, tile: 'wood', rep: 0.6 }, { name: 'desk' });
  deco(b, 4.85, 1.0, -2.95, 7.05, 1.05, -2.25, { color: '#3d5a46' });
  [[5.3, C.red], [5.45, C.navy], [5.6, C.mustard]].forEach(([x, c], i) => deco(b, x, 1.05, -2.8, x + 0.12, 1.25 - i * 0.03, -2.55, { color: c }));
  kit.plant(b, 7.4, -11.9, 1.0, { seed: 'norlin-plant', pot: C.tile });
}

// ── 4. UMC HANGOUT ─────────────────────────────────────────────────────────────────
function umc(b, R, kit) {
  wall(b, { x0: 8, z0: -1, x1: 17, z1: -1, h: 4.4, t: 0.2, n: { color: '#e9d9bd' }, p: { tile: 'sandstone', rep: 2.4 }, open: [{ c: 9.9, w: 1.2, bottom: 0.8, top: 2.4 }, { c: 12.4, w: 1.8, top: 2.5 }, { c: 15.3, w: 1.4, bottom: 0.8, top: 2.4 }], trim: C.ink, name: 'umc-south' });
  glazing(b, 'x', -1, 9.36, 10.44, 0.8, 2.4); glazing(b, 'x', -1, 14.66, 15.94, 0.8, 2.4);
  ceiling(b, 8.1, -12.9, 16.9, -1.1, H.umc, { color: '#f4efe6', tile: 'acoustic', rep: 1.6, name: 'umc' });
  guard(b, 8, H.umc + 0.12, -13.2, 17.2, 9, -1, 'umcroof');
  // ── coffee bar: back counter + front counter with a pastry case, chalk menu
  solid(b, 9.0, 0, -12.9, 15.0, 0.95, -12.3, { color: '#2f2c31', tile: 'slats', rep: 0.5 }, { name: 'back-counter' });
  aabb(b, 8.95, 0.95, -12.9, 15.05, 1.0, -12.25, { color: '#c9b79a', collide: { wall: false, name: 'counter-top' } });
  solid(b, 9.6, 1.0, -12.85, 10.4, 1.55, -12.45, { color: '#c9ced3' }, { name: 'espresso' });
  deco(b, 9.7, 1.2, -12.45, 10.3, 1.3, -12.35, { color: C.ink });
  b.add(cylGeo(0.09, 0.07, 0.35, { radial: 10 }), { at: [10.8, 1.18, -12.6], color: C.ink, collide: true });
  b.add(latheGeo([[0.02, 0], [0.11, 0.08], [0.12, 0.2]], { radial: 10 }), { at: [10.8, 1.35, -12.6], color: '#b0b8bf' });
  for (let i = 0; i < 6; i++) b.add(cylGeo(0.05, 0.04, 0.1, { radial: 8 }), { at: [11.4 + i * 0.16, 1.05, -12.6], color: [C.gold, '#f8f5ee', C.teal][i % 3] });
  aabb(b, 9.0, 1.75, -12.9, 15.0, 1.79, -12.62, { color: C.walnut, collide: { wall: false, perch: true, name: 'perch:cup-shelf' } });
  for (let i = 0; i < 14; i++) b.add(cylGeo(0.045, 0.035, 0.11, { radial: 8 }), { at: [9.3 + i * 0.4, 1.845, -12.76], color: [C.coral, C.teal, C.gold, '#f8f5ee'][i % 4], outline: false });
  poster(b, 12.0, 2.45, -12.9, 3.2, 1.0, 'z+', 'menu', C.walnut);
  solid(b, 9.0, 0, -10.9, 13.8, 1.0, -10.25, { color: '#ffffff', tile: 'banner', rep: [1.3, 1.0] }, { name: 'front-counter' });
  aabb(b, 8.95, 1.0, -10.95, 13.85, 1.06, -10.2, { color: '#c9b79a', collide: { wall: false, name: 'counter-top' } });
  solid(b, 12.4, 1.06, -10.85, 13.7, 1.5, -10.35, { color: '#cfe8f0' }, { name: 'pastry-case', climb: false });
  for (let i = 0; i < 6; i++) b.add(sphereGeo(0.08, 0.05, 0.08, { w: 8, h: 6 }), { at: [12.6 + i * 0.2, 1.22 + (i % 2) * 0.13, -10.6], color: ['#d99b5a', '#f08aa8', '#c47a3f'][i % 3], outline: false });
  solid(b, 10.0, 1.06, -10.8, 10.4, 1.3, -10.45, { color: '#3a3d44' }, { name: 'register' });
  // stools at the counter
  for (const x of [9.7, 10.9, 12.1, 13.3]) {
    b.add(cylGeo(0.2, 0.2, 0.06, { radial: 12 }), { at: [x, 0.72, -9.75], color: C.gold, collide: { wall: false, name: 'stool' } });
    b.add(cylGeo(0.03, 0.03, 0.7, { radial: 6 }), { at: [x, 0.35, -9.75], color: C.ink, outline: false });
    b.add(cylGeo(0.16, 0.18, 0.03, { radial: 10 }), { at: [x, 0.015, -9.75], color: C.ink, outline: false });
  }
  // ── booths along the east wall (back-to-back bench backs leave a squeeze slot)
  const vinyl = [C.teal, C.mustard, C.coral];
  [-8.4, -5.8, -3.2].forEach((cz, i) => {
    const col = vinyl[i];
    aabb(b, 15.15, 0.72, cz - 0.38, 16.9, 0.77, cz + 0.38, { color: '#e8e2d4', collide: { wall: false, ceil: true, name: 'ceil:booth-table' } });
    deco(b, 15.35, 0, cz - 0.05, 15.45, 0.72, cz + 0.05, { color: C.ink });
    for (const s of [-1, 1]) {
      const zb = cz + s * 1.0;
      solid(b, 15.0, 0, Math.min(zb, zb - s * 0.48), 16.9, 0.45, Math.max(zb, zb - s * 0.48), { color: col, tile: 'vinyl', rep: 0.35 }, { name: 'booth-seat' });
      solid(b, 15.0, 0, Math.min(zb, zb + s * 0.14), 16.9, 1.15, Math.max(zb, zb + s * 0.14), { color: col, tile: 'vinyl', rep: 0.35 }, { name: 'booth-back' });
      deco(b, 14.98, 1.15, Math.min(zb, zb + s * 0.14) - 0.01, 16.9, 1.2, Math.max(zb, zb + s * 0.14) + 0.01, { color: C.walnut });
    }
    pendant(b, 16.0, cz, H.umc, 2.2, { shade: col, r: 0.2 });
  });
  // ── pool table (felt probe), café tables, beanbags
  const px = 11.4; const pz = -6.5;
  aabb(b, px - 1.2, 0.72, pz - 0.66, px + 1.2, 0.8, pz + 0.66, { color: C.felt, collide: { wall: false, ceil: true, name: 'ceil:pool' } });
  for (const [x0, z0, x1, z1] of [[px - 1.32, pz - 0.78, px + 1.32, pz - 0.66], [px - 1.32, pz + 0.66, px + 1.32, pz + 0.78], [px - 1.32, pz - 0.66, px - 1.2, pz + 0.66], [px + 1.2, pz - 0.66, px + 1.32, pz + 0.66]]) aabb(b, x0, 0.66, z0, x1, 0.9, z1, { color: C.walnut, tile: 'wood', rep: 0.5, collide: { wall: false, perch: true, name: 'perch:pool-rail' } });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) deco(b, px + sx * 1.1 - 0.08, 0, pz + sz * 0.56 - 0.08, px + sx * 1.1 + 0.08, 0.66, pz + sz * 0.56 + 0.08, { color: C.walnut });
  [[0.5, 0.1, C.gold], [0.62, -0.18, C.red], [-0.4, 0.2, '#3f6fd1'], [-0.6, -0.1, '#f8f5ee'], [0.1, 0.3, C.ink]].forEach(([dx, dz, c]) => b.add(sphereGeo(0.03, 0.03, 0.03, { w: 8, h: 6 }), { at: [px + dx, 0.83, pz + dz], color: c, outline: false }));
  b.add(cylGeo(0.01, 0.014, 1.4, { radial: 5 }), { at: [px - 0.1, 0.83, pz - 0.35], rot: [0, 0, Math.PI / 2 - 0.02], color: '#c99a6b', outline: false });
  b.blob(px, pz, 1.4, 0.8, { a: 0.24 });
  for (const [x, z] of [[9.5, -3.0], [12.2, -2.6], [9.3, -8.4]]) {
    b.add(cylGeo(0.42, 0.42, 0.04, { radial: 16 }), { at: [x, 0.74, z], color: '#f4efe6', collide: { wall: false, ceil: true, name: 'ceil:cafe-table' } });
    b.add(cylGeo(0.04, 0.04, 0.72, { radial: 6 }), { at: [x, 0.36, z], color: C.ink, outline: false });
    b.add(cylGeo(0.22, 0.25, 0.03, { radial: 10 }), { at: [x, 0.015, z], color: C.ink, outline: false });
    b.blob(x, z, 0.5, 0.5, { a: 0.2 });
  }
  for (const [x, z, c] of [[13.8, -1.75, C.plum], [14.6, -1.55, C.gold], [9.0, -1.9, C.teal]]) {
    b.add(sphereGeo(0.42, 0.3, 0.42, { w: 12, h: 8 }), { at: [x, 0.26, z], color: c, tile: 'seatfab', rep: 0.3, collide: true });
    b.blob(x, z, 0.45, 0.45);
  }
  // posters (generic shapes, no logos) and black-and-gold banners
  poster(b, 8.1, 1.6, -11.0, 0.75, 1.05, 'x+', 'poster1');
  poster(b, 8.1, 1.6, -8.4, 0.75, 1.05, 'x+', 'poster2');
  poster(b, 8.1, 1.6, -2.7, 0.75, 1.05, 'x+', 'poster3');
  poster(b, 8.1, 1.6, -1.8, 0.62, 0.86, 'x+', 'poster4');
  for (const [x, z] of [[9.6, -6.5], [13.2, -6.5], [11.4, -3.9]]) {
    b.add(boxGeo(0.7, 1.15, 0.03, { fit: true }), { at: [x, H.umc - 0.75, z], tile: 'banner', color: '#ffffff', collide: { wall: false, name: 'banner' } });
    deco(b, x - 0.42, H.umc - 0.17, z - 0.02, x + 0.42, H.umc - 0.13, z + 0.02, { color: C.ink, collide: { wall: false, perch: true, name: 'perch:banner-rod' } });
  }
  for (const x of [10.0, 13.0]) for (const z of [-11.6, -4.6]) deco(b, x - 0.5, H.umc - 0.04, z - 0.2, x + 0.5, H.umc, z + 0.2, { color: '#fff6d0', faces: ['ny'], outline: false });
  kit.plant(b, 8.6, -12.4, 1.1, { seed: 'umc1', pot: C.ink });
  kit.plant(b, 16.4, -1.6, 0.9, { seed: 'umc2', pot: C.gold });
}

// ── 5. ENGINEERING LAB ───────────────────────────────────────────────────────────
function lab(b, R) {
  wall(b, { x0: -8, z0: 1.4, x1: -8, z1: 9, h: 3.2, t: 0.2, n: { color: C.blueGrey }, p: { tile: 'sandstone', rep: 2.4 }, open: [{ c: 3.2, w: 1.6, bottom: 0.9, top: 2.3 }, { c: 5.6, w: 1.3, top: 2.25 }], trim: C.ink, name: 'lab-east' });
  wall(b, { x0: -17, z0: 9, x1: -8, z1: 9, h: 3.2, t: 0.2, n: { color: C.blueGrey }, p: { tile: 'sandstone', rep: 2.4 }, open: [{ c: -14.6, w: 1.2, top: 2.25 }, { c: -11.6, w: 1.8, bottom: 0.9, top: 2.3 }, { c: -9.4, w: 1.2, bottom: 0.9, top: 2.3 }], trim: C.ink, name: 'lab-south' });
  glazing(b, 'z', -8, 2.46, 3.94, 0.9, 2.3); glazing(b, 'x', 9, -12.44, -10.76, 0.9, 2.3); glazing(b, 'x', 9, -9.94, -8.86, 0.9, 2.3);
  ceiling(b, -16.9, 1.5, -8.1, 8.9, H.lab, { tile: 'acoustic', rep: 1.2, name: 'lab' });
  guard(b, -17.2, H.lab + 0.12, 1.4, -8, 9, 9.2, 'labroof');
  eave(b, -17.2, 9, -7.8, 9, 3.3, 1, { width: 0.9 }); eave(b, -8, 1.4, -8, 9.2, 3.3, 1, { width: 0.9 });
  // whiteboard + pegboard + workbench
  poster(b, -10.0, 1.55, 1.5, 2.8, 1.2, 'z+', 'whiteboard', '#c9ced3');
  deco(b, -11.4, 0.9, 1.5, -8.6, 0.93, 1.62, { color: '#c9ced3', collide: { wall: false, perch: true, name: 'perch:marker-tray' } });
  poster(b, -16.9, 1.6, 3.7, 3.0, 1.35, 'x+', 'pegboard', C.walnut);
  solid(b, -16.9, 0.82, 2.2, -16.2, 0.9, 5.2, { color: C.woodL, tile: 'wood', rep: 0.6 }, { name: 'workbench', wall: false, ceil: true });
  for (const z of [2.3, 5.1]) deco(b, -16.85, 0, z - 0.04, -16.25, 0.82, z + 0.04, { color: '#5a6a7a' });
  deco(b, -16.85, 0.25, 2.3, -16.25, 0.29, 5.1, { color: '#5a6a7a', collide: { wall: false, name: 'bench-shelf' } });
  solid(b, -16.75, 0.9, 4.4, -16.45, 1.08, 4.75, { color: '#3f6fd1' }, { name: 'vise' });
  solid(b, -16.8, 0.9, 2.6, -16.4, 1.02, 3.2, { color: C.red }, { name: 'toolbox' });
  // two rows of CAD desks facing the whiteboard
  for (const dz of [3.8, 6.2]) {
    aabb(b, -14.8, 0.72, dz - 0.38, -10.2, 0.76, dz + 0.38, { color: '#e8e2d4', collide: { wall: false, ceil: true, name: 'ceil:desk' } });
    for (const x of [-14.7, -12.5, -10.3]) deco(b, x - 0.03, 0, dz - 0.33, x + 0.03, 0.72, dz + 0.33, { color: '#5a6a7a' });
    for (const x of [-14.0, -12.5, -11.0]) {
      solid(b, x - 0.3, 0.86, dz - 0.3, x + 0.3, 1.22, dz - 0.26, { color: '#2a2d33' }, { name: 'monitor', climb: false });
      b.add(boxGeo(0.54, 0.31, 0.004, { faces: ['pz'], fit: true }), { at: [x, 1.04, dz - 0.258], tile: 'cad', color: '#ffffff', outline: false });
      deco(b, x - 0.03, 0.76, dz - 0.3, x + 0.03, 0.86, dz - 0.26, { color: '#2a2d33', outline: false });
      deco(b, x - 0.22, 0.76, dz - 0.05, x + 0.22, 0.78, dz + 0.08, { color: '#3a3d44', outline: false });
      // office chair
      b.add(cylGeo(0.22, 0.22, 0.06, { radial: 12 }), { at: [x, 0.47, dz + 0.65], color: '#3f6fd1', collide: { wall: false, name: 'chair' } });
      deco(b, x - 0.2, 0.5, dz + 0.86, x + 0.2, 0.92, dz + 0.9, { color: '#3f6fd1', collide: { wall: false, perch: true, name: 'perch:chair' } });
      b.add(cylGeo(0.025, 0.025, 0.44, { radial: 6 }), { at: [x, 0.22, dz + 0.65], color: C.ink, outline: false });
      b.add(cylGeo(0.22, 0.22, 0.03, { radial: 5 }), { at: [x, 0.04, dz + 0.65], color: C.ink, outline: false });
    }
    b.blob(-12.5, dz, 2.4, 0.5, { a: 0.18 });
  }
  // 3D printer on a cart (printing a tiny buffalo)
  const prx = -9.0; const prz = 2.3;
  aabb(b, prx - 0.5, 0.8, prz - 0.4, prx + 0.5, 0.84, prz + 0.4, { color: C.steel, collide: { wall: false, ceil: true, name: 'cart' } });
  aabb(b, prx - 0.5, 0.2, prz - 0.4, prx + 0.5, 0.24, prz + 0.4, { color: C.steel, collide: { wall: false, name: 'cart-shelf' } });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) deco(b, prx + sx * 0.47 - 0.015, 0, prz + sz * 0.37 - 0.015, prx + sx * 0.47 + 0.015, 0.8, prz + sz * 0.37 + 0.015, { color: '#6c737a', outline: false });
  deco(b, prx - 0.3, 0.84, prz - 0.3, prx + 0.3, 0.92, prz + 0.3, { color: C.ink });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) deco(b, prx + sx * 0.28 - 0.02, 0.92, prz + sz * 0.28 - 0.02, prx + sx * 0.28 + 0.02, 1.48, prz + sz * 0.28 + 0.02, { color: '#e07a1f' });
  aabb(b, prx - 0.31, 1.46, prz - 0.31, prx + 0.31, 1.5, prz + 0.31, { color: '#e07a1f', collide: { wall: false, perch: true, name: 'perch:printer-frame' } });
  deco(b, prx - 0.28, 1.25, prz - 0.02, prx + 0.28, 1.28, prz + 0.02, { color: C.ink });
  deco(b, prx + 0.02, 1.16, prz - 0.05, prx + 0.1, 1.28, prz + 0.05, { color: C.ink });
  deco(b, prx - 0.18, 0.92, prz - 0.18, prx + 0.18, 0.94, prz + 0.18, { color: '#d8dde2', outline: false });
  b.add(sphereGeo(0.06, 0.035, 0.035, { w: 8, h: 6 }), { at: [prx - 0.03, 0.99, prz], color: C.gold });
  b.add(cylGeo(0.12, 0.12, 0.06, { radial: 14 }), { at: [prx + 0.36, 1.4, prz], rot: [0, 0, Math.PI / 2], color: '#3fa66b' });
  for (let i = 0; i < 3; i++) b.add(cylGeo(0.1, 0.1, 0.06, { radial: 12 }), { at: [prx - 0.25 + i * 0.25, 0.3, prz], rot: [Math.PI / 2, 0, 0], color: [C.gold, C.ink, '#f8f5ee'][i] });
  // shelving with coloured parts bins, a drone on top
  const sx0 = -8.5; // against the east wall, z 6.4..8.6
  solid(b, sx0, 0, 6.4, -8.1, 1.95, 8.6, { color: '#5a6a7a' }, { name: 'shelf-back' });
  for (const y of [0.05, 0.6, 1.15, 1.7]) {
    aabb(b, -8.95, y, 6.4, -8.5, y + 0.04, 8.6, { color: '#6c737a', collide: { wall: false, name: 'shelf' } });
    if (y < 1.6) for (let i = 0; i < 4; i++) solid(b, -8.9, y + 0.04, 6.5 + i * 0.52, -8.55, y + 0.3, 6.9 + i * 0.52, { color: [C.red, C.mustard, '#3f6fd1', C.teal, C.coral, '#3fa66b'][(i + Math.round(y * 3)) % 6] }, { name: 'bin' });
  }
  const drone = (x, y, z, col) => {
    deco(b, x - 0.09, y, z - 0.09, x + 0.09, y + 0.06, z + 0.09, { color: col });
    for (const a of [Math.PI / 4, -Math.PI / 4]) b.add(boxGeo(0.5, 0.025, 0.04), { at: [x, y + 0.04, z], yaw: a, color: C.ink, outline: false });
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      b.add(cylGeo(0.012, 0.012, 0.05, { radial: 6 }), { at: [x + dx * 0.177, y + 0.07, z + dz * 0.177], color: C.ink, outline: false });
      b.add(cylGeo(0.1, 0.1, 0.008, { radial: 12 }), { at: [x + dx * 0.177, y + 0.1, z + dz * 0.177], color: '#cfe8f0' });
    }
  };
  drone(-8.72, 1.74, 7.5, C.gold);
  drone(-11.0, 0.76, 6.15, C.red);
  // the model rocket on its launch rail (lab landmark)
  const rx = -15.7; const rz = 7.7;
  for (const a of [0, 2.1, 4.2]) b.add(boxGeo(0.04, 0.6, 0.04), { at: [rx + Math.sin(a) * 0.2, 0.28, rz + Math.cos(a) * 0.2], rot: [Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35], color: C.ink });
  b.collide(rx - 0.22, 0, rz - 0.22, rx + 0.22, 0.55, rz + 0.22, { wall: true, name: 'launch-stand' });
  deco(b, rx - 0.16, 0.52, rz - 0.02, rx - 0.12, 2.6, rz + 0.02, { color: '#9aa3ab', collide: { wall: false, perch: true, name: 'perch:launch-rail' } });
  b.add(cylGeo(0.1, 0.1, 1.3, { radial: 14 }), { at: [rx, 1.3, rz], color: '#f8f5ee', collide: { wall: true, name: 'rocket' } });
  for (const [y, c] of [[1.0, C.black], [1.5, C.gold], [1.7, C.black]]) b.add(cylGeo(0.102, 0.102, 0.08, { radial: 14 }), { at: [rx, y, rz], color: c, outline: false });
  b.add(cylGeo(0.0, 0.1, 0.4, { radial: 14 }), { at: [rx, 2.15, rz], color: C.red, collide: { wall: false, perch: true, name: 'perch:nose' } });
  for (const a of [0, 2.094, 4.189]) b.add(boxGeo(0.02, 0.28, 0.16), { at: [rx + Math.sin(a) * 0.15, 0.78, rz + Math.cos(a) * 0.15], yaw: a, color: C.red });
  b.blob(rx, rz, 0.3, 0.3);
  for (const x of [-15, -12.5, -10]) deco(b, x - 0.6, H.lab - 0.04, 4.8, x + 0.6, H.lab, 5.2, { color: '#fff6d0', faces: ['ny'], outline: false });
  void R;
}

// ── 6. SANDSTONE ARCADE (loggia) ─────────────────────────────────────────────────────
function arcade(b) {
  const n = 9; const xa = -2.7; const xb = 16.65; const step = (xb - xa) / (n - 1); const zc = 1.62;
  for (let i = 0; i < n; i++) {
    const x = xa + step * i;
    solid(b, x - 0.24, 0, zc - 0.24, x + 0.24, 2.0, zc + 0.24, { color: '#ffffff', tile: 'sandstone', rep: 1.6 }, { name: 'pier' });
    deco(b, x - 0.31, 0, zc - 0.31, x + 0.31, 0.22, zc + 0.31, { color: C.stoneDk, tile: 'sandstone', rep: 1.2 });
    aabb(b, x - 0.33, 2.0, zc - 0.33, x + 0.33, 2.15, zc + 0.33, { color: C.stoneC, collide: { wall: false, name: 'capital' } });
    if (i < n - 1) {
      const cx = x + step / 2; const span = step - 0.48;
      arch(b, cx, 2.15, zc, span, { depth: 0.42, thick: 0.22, n: 7 });
      for (const s of [-1, 1]) {
        const e = cx + s * (span / 2 + 0.24);
        deco(b, Math.min(e, e - s * 0.44), 2.15, zc - 0.2, Math.max(e, e - s * 0.44), H.arc, zc + 0.2, { color: '#ffffff', tile: 'sandstone', rep: 1.6 });
        deco(b, Math.min(e, e - s * 0.74), 2.75, zc - 0.2, Math.max(e, e - s * 0.74), H.arc, zc + 0.2, { color: '#ffffff', tile: 'sandstone', rep: 1.6 });
      }
    }
  }
  // frieze band above the arches, flat beamed ceiling, sloped red tile roof
  solid(b, xa - 0.3, H.arc - 0.12, zc - 0.22, 16.9, H.arc + 0.35, zc + 0.22, { color: '#ffffff', tile: 'sandstone', rep: 1.6 }, { name: 'frieze' });
  deco(b, xa - 0.32, H.arc + 0.35, zc - 0.26, 16.9, H.arc + 0.42, zc + 0.26, { color: C.stoneD });
  ceiling(b, -2.9, -0.9, 16.9, zc + 0.22, H.arc, { color: '#c99a6b', tile: 'wood', rep: 0.8, name: 'arcade' });
  for (let x = -2.4; x < 16.6; x += 1.2) solid(b, x - 0.06, H.arc - 0.16, -0.9, x + 0.06, H.arc, zc - 0.22, { color: C.walnut, faces: ['ny', 'px', 'nx'] }, { name: 'ceil:joist', ceil: true, wall: false });
  const roofLen = Math.hypot(3.4, 0.55); const ang = Math.atan2(0.55, 3.4);
  b.add(boxGeo(20.3, 0.1, roofLen, { faces: ['py', 'pz', 'px', 'nx'] }), { at: [7.0, H.arc + 0.68, 0.55], rot: [ang, 0, 0], color: '#ffffff', tile: 'rooftile', rep: [0.9, 0.6] });
  deco(b, -3.15, H.arc + 0.32, 2.12, 17.0, H.arc + 0.45, 2.24, { color: C.tileDk });
  guard(b, -3, H.arc + 0.12, -1, 17.2, 9, 2.3, 'arcroof');
  // a bench and a bin under the arches
  aabb(b, 8.2, 0.42, -0.6, 10.2, 0.47, -0.2, { color: C.woodL, tile: 'wood', rep: 0.5, collide: { wall: false, ceil: true, name: 'bench' } });
  for (const x of [8.35, 10.05]) deco(b, x - 0.04, 0, -0.55, x + 0.04, 0.42, -0.25, { color: C.ink });
  b.add(cylGeo(0.22, 0.2, 0.75, { radial: 12 }), { at: [1.9, 0.375, 0.4], color: '#3f6b45', tile: 'slats', rep: 0.3, collide: true });
  b.blob(1.9, 0.4, 0.26, 0.26);
}

// ── 7. THE QUAD ──────────────────────────────────────────────────────────────────
function quad(b, R, kit) {
  // X paths to a central plaza, plus a front path; slabs sit a hair above the lawn
  const path = (x0, z0, x1, z1, w = 1.4) => {
    const L = Math.hypot(x1 - x0, z1 - z0); const yaw = Math.atan2(x1 - x0, z1 - z0);
    b.add(boxGeo(w, 0.01, L, { faces: ['py'] }), { at: [(x0 + x1) / 2, 0.008, (z0 + z1) / 2], yaw, tile: 'flag', rep: 2.4, color: '#ffffff', outline: false });
  };
  const pc = [5.0, 7.7];
  path(-7.6, 2.8, pc[0], pc[1]); path(16.6, 2.8, pc[0], pc[1]); path(pc[0], pc[1], -7.6, 12.6); path(pc[0], pc[1], 16.6, 12.6); path(pc[0], 2.6, pc[0], 12.8, 1.6);
  b.add(cylGeo(2.4, 2.4, 0.012, { radial: 28 }), { at: [pc[0], 0.012, pc[1]], tile: 'flag', rep: 2.4, color: '#ffffff', outline: true });
  // the buffalo: an original low-poly bronze on a sandstone plinth (quad landmark)
  solid(b, pc[0] - 1.15, 0, pc[1] - 0.6, pc[0] + 1.15, 0.85, pc[1] + 0.6, { color: '#ffffff', tile: 'sandstone', rep: 1.6 }, { name: 'plinth' });
  deco(b, pc[0] - 1.22, 0.85, pc[1] - 0.67, pc[0] + 1.22, 0.93, pc[1] + 0.67, { color: C.stoneC, collide: { wall: false, name: 'plinth-cap' } });
  deco(b, pc[0] - 0.5, 0.35, pc[1] + 0.6, pc[0] + 0.5, 0.6, pc[1] + 0.62, { color: C.gold, outline: false });
  const bz = kit.frame(b, pc[0], pc[1], Math.PI / 2); // head toward +x
  const bronze = '#4a3a30'; const fur = '#3a2c24';
  const y0 = 0.93;
  bz.sph(0.4, 0.38, 0.75, [0, y0 + 0.78, -0.1], { color: bronze, w: 10, h: 7, collide: { wall: true, name: 'buffalo' } });
  bz.sph(0.48, 0.5, 0.45, [0, y0 + 0.95, 0.35], { color: fur, w: 10, h: 7 }); // hump + shaggy shoulders
  bz.sph(0.26, 0.28, 0.3, [0, y0 + 0.72, 0.85], { color: fur, w: 9, h: 6, rot: [0.4, 0, 0] }); // head
  bz.sph(0.15, 0.13, 0.16, [0, y0 + 0.56, 1.06], { color: bronze, w: 8, h: 6 }); // muzzle
  bz.sph(0.12, 0.16, 0.1, [0, y0 + 0.42, 0.9], { color: fur, w: 8, h: 5 }); // beard
  for (const s of [-1, 1]) {
    bz.cyl(0.02, 0.05, 0.22, [s * 0.3, y0 + 0.92, 0.85], { color: C.gold, rot: [0, 0, -s * 1.1], radial: 8 }); // horns (gilded)
    bz.sph(0.035, 0.035, 0.035, [s * 0.14, y0 + 0.8, 1.06], { color: C.gold, w: 6, h: 4, outline: false }); // eyes
  }
  for (const [sx, sz] of [[-1, 0.3], [1, 0.3], [-1, -0.55], [1, -0.55]]) bz.cyl(0.07, 0.09, 0.62, [sx * 0.2, y0 + 0.31, sz], { color: bronze, radial: 8 });
  bz.cyl(0.02, 0.03, 0.45, [0, y0 + 0.75, -0.88], { color: bronze, rot: [-0.5, 0, 0], radial: 6 });
  bz.sph(0.05, 0.08, 0.05, [0, y0 + 0.55, -0.98], { color: fur, w: 6, h: 5 });
  b.collide(pc[0] - 0.95, y0, pc[1] - 0.45, pc[0] + 0.95, y0 + 1.4, pc[1] + 0.45, { wall: true, name: 'buffalo-body' });
  b.blob(pc[0], pc[1], 1.4, 0.8, { a: 0.3 });

  // benches around the plaza (slat seat, perchable back)
  const bench = (x, z, yaw) => {
    const f = kit.frame(b, x, z, yaw);
    f.box(1.6, 0.05, 0.42, [0, 0.45, 0], { color: C.woodL, tile: 'slats', rep: 0.3, collide: { wall: false, ceil: true, name: 'ceil:bench' } });
    f.box(1.6, 0.32, 0.04, [0, 0.72, -0.2], { color: C.woodL, tile: 'slats', rep: 0.3, rot: [-0.12, 0, 0], collide: { wall: false, perch: true, name: 'perch:bench-back' } });
    for (const sx of [-0.7, 0.7]) f.box(0.05, 0.45, 0.4, [sx, 0.225, 0], { color: C.ink });
    f.blob(0, 0, 0.9, 0.3, { a: 0.22 });
  };
  bench(pc[0], pc[1] - 3.3, 0); bench(pc[0], pc[1] + 3.3, Math.PI); bench(pc[0] - 3.6, pc[1] + 0.2, Math.PI / 2); bench(pc[0] + 3.6, pc[1] - 0.2, -Math.PI / 2);

  // trees: golden aspens (October!) and ponderosa-ish pines
  const aspen = (x, z, s = 1, seed = 0) => {
    b.add(cylGeo(0.07 * s, 0.1 * s, 3.0 * s, { radial: 8 }), { at: [x, 1.5 * s, z], tile: 'aspenbark', rep: [0.4, 0.6], color: '#ffffff', collide: { wall: true, name: 'trunk' } });
    const r = kit.seeded('aspen' + seed);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + r(); const d = 0.35 * s;
      b.add(sphereGeo(0.62 * s, 0.75 * s, 0.62 * s, { w: 10, h: 7 }), { at: [x + Math.cos(a) * d, (2.7 + r() * 0.8) * s, z + Math.sin(a) * d], tile: 'aspenleaf', rep: 0.8, color: '#ffffff' });
    }
    b.add(boxGeo(0.9 * s, 0.035, 0.035), { at: [x + 0.3 * s, 2.1 * s, z], yaw: seed, rot: [0, seed, 0.35], color: '#e8e2d4', collide: false });
    b.collide(x - 0.04, 2.0 * s, z - 0.4 * s, x + 0.04, 2.08 * s, z + 0.4 * s, { wall: false, perch: true, name: 'perch:branch' });
    b.blob(x, z, 0.9 * s, 0.9 * s, { a: 0.2 });
  };
  const pine = (x, z, s = 1) => {
    b.add(cylGeo(0.1 * s, 0.14 * s, 1.2 * s, { radial: 8 }), { at: [x, 0.6 * s, z], color: '#6b4430', collide: { wall: true, name: 'trunk' } });
    [[1.15, 1.2, 1.3], [0.9, 2.0, 1.2], [0.6, 2.75, 1.0], [0.3, 3.35, 0.7]].forEach(([r, y, h]) => b.add(cylGeo(0.02, r * s, h * s, { radial: 9 }), { at: [x, y * s, z], tile: 'pineleaf', rep: 0.8, color: '#ffffff' }));
    b.blob(x, z, 1.1 * s, 1.1 * s, { a: 0.25 });
  };
  aspen(13.6, 9.6, 1.1, 1); aspen(16.0, 10.4, 0.95, 2); aspen(15.4, 8.0, 1.0, 3); aspen(12.0, 12.2, 0.9, 4); aspen(0.4, 11.6, 1.0, 5); aspen(10.6, 7.4, 0.9, 6); aspen(-1.2, 7.4, 0.95, 7);
  pine(-6.4, 9.6, 1.0); pine(15.6, 5.8, 0.9); pine(-3.2, 6.0, 0.85); pine(-10.6, 11.6, 0.8);

  // lamp posts (black with a gold band; the lantern top is a perch)
  for (const [x, z] of [[2.4, 3.4], [7.6, 3.4], [-3.8, 9.6], [12.0, 8.6]]) {
    b.add(cylGeo(0.05, 0.07, 3.0, { radial: 8 }), { at: [x, 1.5, z], color: C.black, collide: { wall: true, name: 'lamp-post' } });
    b.add(cylGeo(0.06, 0.06, 0.1, { radial: 8 }), { at: [x, 2.2, z], color: C.gold, outline: false });
    b.add(latheGeo([[0.06, 0], [0.18, 0.08], [0.16, 0.36], [0.22, 0.4], [0.02, 0.55]], { radial: 10 }), { at: [x, 3.0, z], color: '#fff3c4', collide: { wall: false, perch: true, name: 'perch:lantern' } });
    b.blob(x, z, 0.2, 0.2);
  }
  // sandstone planter with flowers (low wall perch) near the corridor door
  solid(b, -6.6, 0, 6.0, -4.4, 0.45, 7.0, { color: '#ffffff', tile: 'sandstone', rep: 1.6, faces: ['px', 'nx', 'pz', 'nz'] }, { name: 'planter' });
  deco(b, -6.65, 0.45, 5.95, -4.35, 0.5, 7.05, { color: C.stoneC });
  b.add(boxGeo(2.1, 0.02, 0.9, { faces: ['py'] }), { at: [-5.5, 0.42, 6.5], color: '#6b4a32', outline: false });
  for (let i = 0; i < 26; i++) {
    const fx = -6.45 + R() * 1.9; const fz = 6.12 + R() * 0.76; const hh = 0.1 + R() * 0.2;
    b.add(sphereGeo(0.05, 0.04, 0.05, { w: 6, h: 4 }), { at: [fx, 0.44 + hh, fz], color: [C.red, C.gold, '#f08aa8', '#8e6bbf', '#f8f5ee'][i % 5], outline: i % 3 === 0 });
  }
  // a flyer kiosk (colourful hiding spot)
  b.add(cylGeo(0.42, 0.42, 2.0, { radial: 12 }), { at: [-1.6, 1.0, 3.6], color: '#ffffff', tile: 'cork', rep: [0.9, 0.9], collide: { wall: true, name: 'kiosk' } });
  b.add(cylGeo(0.0, 0.55, 0.35, { radial: 12 }), { at: [-1.6, 2.18, 3.6], color: C.tileDk });
  b.blob(-1.6, 3.6, 0.5, 0.5);

  // bike racks in the strip in front of the lab (hoops are perches) + two parked bikes
  for (let i = 0; i < 5; i++) {
    const x = -15.4 + i * 0.85; const z = 11.3;
    for (const dz of [-0.28, 0.28]) deco(b, x - 0.025, 0, z + dz - 0.025, x + 0.025, 0.78, z + dz + 0.025, { color: '#9aa3ab' });
    aabb(b, x - 0.03, 0.78, z - 0.31, x + 0.03, 0.84, z + 0.31, { color: '#9aa3ab', collide: { wall: false, perch: true, name: 'perch:bike-rack' } });
    b.collide(x - 0.03, 0, z - 0.31, x + 0.03, 0.78, z + 0.31, { wall: false, perch: true, name: 'perch:bike-rack-leg' });
  }
  const bike = (x, z, col) => {
    for (const dz of [-0.48, 0.48]) {
      b.add(cylGeo(0.33, 0.33, 0.03, { radial: 16, caps: true }), { at: [x, 0.34, z + dz], rot: [0, 0, Math.PI / 2], color: C.ink });
      b.add(cylGeo(0.27, 0.27, 0.034, { radial: 16 }), { at: [x, 0.34, z + dz], rot: [0, 0, Math.PI / 2], color: '#cfd4d8', outline: false });
    }
    b.add(boxGeo(0.04, 0.04, 0.95), { at: [x, 0.62, z], color: col });
    b.add(boxGeo(0.04, 0.5, 0.04), { at: [x, 0.5, z - 0.12], rot: [0.35, 0, 0], color: col });
    b.add(boxGeo(0.12, 0.04, 0.22), { at: [x, 0.84, z - 0.25], color: C.ink });
    b.add(boxGeo(0.5, 0.03, 0.03), { at: [x, 0.9, z + 0.4], color: C.ink });
    b.collide(x - 0.05, 0, z - 0.82, x + 0.05, 0.92, z + 0.82, { wall: false, perch: true, name: 'perch:bike' });
  };
  bike(-14.97, 11.3, C.teal); bike(-12.42, 11.3, C.gold);
  for (const [x, z] of [[-9.5, 10.6]]) {
    b.add(cylGeo(0.05, 0.07, 3.0, { radial: 8 }), { at: [x, 1.5, z], color: C.black, collide: { wall: true, name: 'lamp-post' } });
    b.add(latheGeo([[0.06, 0], [0.18, 0.08], [0.16, 0.36], [0.22, 0.4], [0.02, 0.55]], { radial: 10 }), { at: [x, 3.0, z], color: '#fff3c4', collide: { wall: false, perch: true, name: 'perch:lantern' } });
  }
}

export const CUBOULDER = {
  id: 'cuboulder',
  name: 'CU Boulder',
  blurb: 'Duane G1B30, Norlin, the UMC, a lab and the quad, in sandstone and red tile.',
  build,
  size: 'XL',
  rooms: 7,
  climbs: 3,
  info: {
    w: W, d: D,
    floors: [{ y: 0, name: 'Ground' }, { y: UP, name: 'Top row & gallery' }],
    rooms: [
      { name: 'Duane G1B30', floor: 0, x0: -17, z0: -13, x1: -3, z1: -1, landmark: 'Chalkboard wall and demo bench' },
      { name: 'Duane G1B30 (top row)', floor: 1, x0: -17, z0: -13, x1: -3, z1: -1, landmark: 'Cross-aisle behind the back row' },
      { name: 'Norlin reading room', floor: 0, x0: -3, z0: -13, x1: 8, z1: -1, landmark: 'Green banker\'s lamps' },
      { name: 'Norlin gallery', floor: 1, x0: -3, z0: -13, x1: -1, z1: -5.6, landmark: 'Bookcase balcony' },
      { name: 'UMC hangout', floor: 0, x0: 8, z0: -13, x1: 17, z1: -1, landmark: 'Pool table and coffee bar' },
      { name: 'Basement corridor', floor: 0, x0: -17, z0: -1, x1: -3, z1: 1.4, landmark: 'Lockers and pipes' },
      { name: 'Engineering lab', floor: 0, x0: -17, z0: 1.4, x1: -8, z1: 9, landmark: 'Model rocket' },
      { name: 'Sandstone arcade', floor: 0, x0: -3, z0: -1, x1: 17, z1: 2.2, landmark: 'Round arches' },
      { name: 'The quad', floor: 0, x0: -8, z0: 2.2, x1: 17, z1: 13, landmark: 'Buffalo statue' },
      { name: 'Bike racks', floor: 0, x0: -17, z0: 9, x1: -8, z1: 13, landmark: 'Bike racks' },
    ],
    overview: { y: 22, radius: 30 },
  },
};
