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
// Compass (info.north = '-x'): north is −x (left in the plan above), east is −z (up), west is +z.
// So the quad lies west; Norlin stands at its east end, façade looking west over the quad to the
// Front Range; Duane (G1B30) is to the north-east; the UMC (turned a quarter, moved onto the quad's
// south side) is south; the Engineering lab (moved behind the arcade, south of Norlin, with a bike
// yard) is east/south-east. The Flatirons, Green Mountain, Flagstaff and Bear Peak sit on their
// real bearings in a fog-free backdrop ring; the plains are east (see landscape()).
// Two floors: the ground (y 0) and the top of the lecture-hall rake / Norlin gallery (y 2.72),
// joined by the hall's aisle stairs and the gallery stair, so G1B30 → Norlin → arcade → corridor
// → G1B30 is a loop. Interiors have downward-only ceilings (the camera sees in from above); roof
// tops are fenced off with climb:false guards so nobody hides on top of a building.
import { boxGeo, cylGeo, sphereGeo, latheGeo, fixWinding } from '../geo.js';
import { aabb, wall, floor, slab, stairs, railing } from './lib.js';
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
const BENCH_TOP = '#a4c9ae';

// ── procedural patterns (same contract as atlas.js painters) ───────────────
const wrapDo = (w, h, fn) => { for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) fn(ox * w, oy * h); };
const dot = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };

const PAT = {
  /** Rough-cut Lyons sandstone ashlar: courses of uneven height, long and short blocks in
   *  pinks, tans and buffs, chisel-rough faces with a lit top edge. */
  sandstone: ({ cols, mortar, rows = 6 }) => (g, w, h, r) => {
    g.fillStyle = mortar; g.fillRect(0, 0, w, h);
    const hs = []; let th = 0;
    for (let j = 0; j < rows; j++) { const v = 0.6 + r() * 0.9; hs.push(v); th += v; }
    let y = 0;
    for (let j = 0; j < rows; j++) {
      const rh = (hs[j] / th) * h;
      const ws = []; let tot = 0;
      while (tot < w) { const bw = w * (0.12 + r() * 0.3); ws.push(bw); tot += bw; }
      const k = w / tot; let x = r() * w;
      for (const bw0 of ws) {
        const bw = bw0 * k; const c = cols[Math.floor(r() * cols.length)]; const j1 = r() * 2; const j2 = r() * 2;
        wrapDo(w, 0, (ox) => {
          g.fillStyle = c; g.beginPath();
          g.moveTo(x + ox + 1.5 + j1, y + 1.5); g.lineTo(x + ox + bw - 1.5, y + 1.5 + j2); g.lineTo(x + ox + bw - 1.5 - j2, y + rh - 1.5); g.lineTo(x + ox + 1.5, y + rh - 1.5 - j1); g.closePath(); g.fill();
          g.fillStyle = 'rgba(255,245,230,0.18)'; g.fillRect(x + ox + 3, y + 2, bw - 6, 2.5);
          g.fillStyle = 'rgba(90,40,20,0.13)'; g.fillRect(x + ox + 3, y + rh - 5, bw - 6, 3);
          g.fillStyle = 'rgba(120,60,40,0.12)'; g.beginPath(); g.ellipse(x + ox + bw * (0.3 + j1 * 0.2), y + rh * 0.55, bw * 0.22, rh * 0.18, 0, 0, Math.PI * 2); g.fill();
        });
        x += bw;
      }
      y += rh;
    }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(90,45,25,0.18)' : 'rgba(255,240,220,0.24)';
      const x = r() * w; const yy = r() * h; const s2 = 0.7 + r() * 2;
      wrapDo(w, h, (ox, oy) => dot(g, x + ox, yy + oy, s2));
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

  /** Flatiron rock face: pink-tan sandstone with bedding lines running up the slab and a few cracks. */
  rockface: () => (g, w, h, r) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgb(214,200,196)'; g.lineWidth = 3;
    for (let i = -4; i < 10; i++) { const x = i * w / 6; wrapDo(w, h, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, h + oy); g.lineTo(x + w * 0.35 + ox, oy); g.stroke(); }); }
    g.strokeStyle = 'rgb(190,172,168)'; g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) { const x = r() * w; const y = r() * h; wrapDo(w, h, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + 10, y + oy - 6); g.lineTo(x + ox + 22, y + oy - 4); g.stroke(); }); }
    g.fillStyle = 'rgba(255,255,255,0.5)'; for (let i = 0; i < 30; i++) dot(g, r() * w, r() * h, 1.2);
  },

  /** Distant forest / ridge texture (tintable greys): little pine silhouettes over a mottled ground. */
  forest: () => (g, w, h, r) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgb(222,222,222)'; for (let i = 0; i < 26; i++) wrapDo(w, h, (ox, oy) => dot(g, r() * w + ox, r() * h + oy, 6 + r() * 8));
    for (let i = 0; i < 40; i++) {
      const x = r() * w; const y = r() * h; const s2 = 4 + r() * 4;
      g.fillStyle = r() < 0.5 ? 'rgb(170,170,170)' : 'rgb(196,196,196)';
      wrapDo(w, h, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy - s2 * 2.4); g.lineTo(x + ox + s2, y + oy); g.lineTo(x + ox - s2, y + oy); g.fill(); });
    }
  },

  /** Plains: patchwork fields in tans and greens with hedgerow lines. */
  fields: ({ cols, line }) => (g, w, h, r) => {
    const n = 4; const s2 = w / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(i * s2, j * s2, s2, s2); }
    g.fillStyle = line; for (let i = 0; i < n; i++) { g.fillRect(i * s2, 0, 2, h); g.fillRect(0, i * s2, w, 2); }
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

  /** The two lecture screens in one tile (top half: handwritten KEY IDEAS notes; bottom half: a
   *  multiple-choice question). Invented, generic text. */
  screens: () => (g, w, h) => {
    const half = h / 2;
    for (let k = 0; k < 2; k++) {
      const y0 = k * half;
      g.fillStyle = '#fdfdfb'; g.fillRect(0, y0, w, half);
      g.fillStyle = '#e8eaee'; g.fillRect(0, y0, w, 13); // app toolbar
      for (let i = 0; i < 7; i++) { g.fillStyle = ['#d9483b', '#3f6fd1', '#3fa66b', '#9aa3ab', '#9aa3ab', '#f2c14e', '#9aa3ab'][i]; g.fillRect(70 + i * 12, y0 + 4, 7, 5); }
      g.fillStyle = '#2f5fbf'; g.beginPath(); g.arc(150, y0 + 7, 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#d6dae0'; g.fillRect(0, y0 + half - 10, w, 10); // taskbar
      for (let i = 0; i < 9; i++) { g.fillStyle = ['#3f6fd1', '#f2c14e', '#d9483b', '#3fa66b', '#7b5ea7'][i % 5]; g.fillRect(80 + i * 10, y0 + half - 8, 6, 6); }
    }
    g.fillStyle = '#1f2a44'; g.textBaseline = 'alphabetic';
    // KEY IDEAS (handwritten)
    const hand = (t, x, y, sz) => { g.font = `${sz}px "Comic Sans MS", "Segoe Print", cursive, sans-serif`; g.fillText(t, x, y); };
    g.fillStyle = '#c0392b'; g.font = 'bold 9px Arial, sans-serif'; g.fillText('Pulley problems', 10, 27); g.fillRect(10, 29, 72, 1);
    g.fillStyle = '#1f2a44';
    hand('KEY IDEAS:', 120, 34, 12);
    hand('• one rope → same', 126, 52, 10); hand('   tension throughout', 126, 63, 10);
    hand('• linked masses share', 126, 79, 10); hand('   one acceleration', 126, 90, 10);
    hand('• separate FBDs!', 126, 106, 10);
    g.strokeStyle = '#1f2a44'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(50, 52, 10, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(40, 52); g.lineTo(40, 92); g.moveTo(60, 52); g.lineTo(60, 80); g.stroke();
    g.strokeRect(33, 92, 14, 12); g.strokeRect(54, 80, 12, 10);
    g.beginPath(); g.moveTo(50, 42); g.lineTo(50, 34); g.stroke();
    // multiple choice (typeset)
    const y0 = half;
    g.fillStyle = '#1f2a44'; g.font = '11px Georgia, "Times New Roman", serif';
    ['A rope-and-pulley rig holds a crate', 'of mass m off the floor. What pull F', 'keeps it at rest?'].forEach((t, i) => g.fillText(t, 12, y0 + 30 + i * 13));
    g.font = 'italic 11px Georgia, "Times New Roman", serif';
    ['A)  F = mg', 'B)  F = 2mg', 'C)  F = mg / 2', 'D)  F = 3mg', 'E)  F = mg / 3'].forEach((t, i) => g.fillText(t, 20 + (i > 2 ? 110 : 0), y0 + 78 + (i % 3) * 13));
  },

  /** Periodic table poster (not repeating): blocky title + the familiar coloured cell grid. */
  ptable: () => (g, w, h) => {
    g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1f2a44'; g.font = 'bold 7px Arial, sans-serif'; g.textAlign = 'center';
    g.fillText('PERIODIC TABLE', w / 2, 8); g.fillText('OF THE ELEMENTS', w / 2, 15);
    const cw = (w - 8) / 18; const ch = 5; const ox = 4; const oy = 19;
    const col = (r, c) => (c === 0 ? '#f08a6a' : c === 1 ? '#f2c14e' : c >= 12 && c <= 16 && r >= 1 ? '#9fd38c' : c === 17 ? '#8fc3e0' : c >= 2 && c <= 11 ? '#c9b7e3' : '#e9d58f');
    for (let r = 0; r < 7; r++) for (let c = 0; c < 18; c++) {
      if (r === 0 && c > 0 && c < 17) continue;
      if ((r === 1 || r === 2) && c > 1 && c < 12) continue;
      g.fillStyle = col(r, c); g.fillRect(ox + c * cw + 0.5, oy + r * ch + 0.5, cw - 1, ch - 1);
    }
    for (let r = 0; r < 2; r++) for (let c = 3; c < 17; c++) { g.fillStyle = r ? '#f2b8c6' : '#f6d2a2'; g.fillRect(ox + c * cw + 0.5, oy + 7.6 * ch + r * ch + 0.5, cw - 1, ch - 1); }
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
  const r = aabb(b, x0, y0, z0, x1, y1, z1, o);
  b.collide(x0, y0, z0, x1, y1, z1, { wall: true, ...flags }); // explicit: single-face boxes stay solid
  return r;
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

/** Hanging lamp: cord, a closed cone shade, a bulb peeking out underneath. */
function pendant(b, x, z, yc, y, { shade = C.gold, r = 0.24 } = {}) {
  deco(b, x - 0.008, y, z - 0.008, x + 0.008, yc, z + 0.008, { color: C.ink, outline: false });
  b.add(cylGeo(0.05, r, 0.2, { radial: 14 }), { at: [x, y - 0.1, z], color: shade });
  b.add(sphereGeo(0.06, 0.05, 0.06, { w: 8, h: 6 }), { at: [x, y - 0.21, z], color: '#fff6cc', outline: false });
}

/**
 * A builder proxy that rotates (by a multiple of 90° about (cx, cz)) then translates everything a
 * zone adds: primitives, colliders, blobs and probes. Rotation only, never mirroring, so a zone keeps
 * its handedness when it moves.
 */
function xform(b, { cx = 0, cz = 0, rot = 0, dx = 0, dz = 0 }) {
  const c = Math.round(Math.cos(rot)); const s = Math.round(Math.sin(rot));
  const P = (x, z) => { const lx = x - cx; const lz = z - cz; return [cx + lx * c + lz * s + dx, cz - lx * s + lz * c + dz]; };
  return {
    ...b,
    add(g, o = {}) {
      const at = o.at || [0, 0, 0]; const [x, z] = P(at[0], at[2]);
      const o2 = { ...o, at: [x, at[1], z] };
      if (o.rot) o2.rot = [o.rot[0], o.rot[1] + rot, o.rot[2]]; else o2.yaw = (o.yaw || 0) + rot;
      return b.add(g, o2);
    },
    collide(x0, y0, z0, x1, y1, z1, f) { const [ax, az] = P(x0, z0); const [bx, bz] = P(x1, z1); return b.collide(Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), f); },
    blob(x, z, rx, rz, o = {}) { const [X, Z] = P(x, z); return b.blob(X, Z, rx, rz, { ...o, yaw: (o.yaw || 0) + rot }); },
    probe(n, pt, nr, hex) { const [X, Z] = P(pt[0], pt[2]); return b.probe(n, [X, pt[1], Z], [nr[0] * c + nr[2] * s, nr[1], -nr[0] * s + nr[2] * c], hex); },
  };
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
const H = { g1: 6.6, cor: 2.7, nor: 4.8, umc: 3.3, lab: 3.0, arc: 3.45 };

function build(atlas, kit) {
  const P = kit.P;
  atlas.add('sandstone', PAT.sandstone({ cols: [C.stoneA, C.stoneB, C.stoneC, C.stoneD, C.stoneE], mortar: '#e2cfb2' }), { size: 'L' });
  atlas.add('flag', PAT.flagstone({ cols: ['#c9a389', '#b88d73', '#d4b08f', '#a98a78', '#c19a7c', '#b5a08a'], joint: '#8a7466' }), { size: 'L' });
  atlas.add('shelfbooks', PAT.shelfbooks({ cols: [C.red, C.teal, C.mustard, C.navy, C.plum, '#3f6b45', C.coral, '#f3e7cf', C.black, '#8c5a3c', C.gold], back: '#4a3122', board: '#7a4e35' }), { size: 'L' });
  atlas.add('chalk', PAT.chalk({ bg: C.chalk, line: C.chalkLine, accent: '#f2d27a' }), { w: 480, h: 240 });
  atlas.add('rockface', PAT.rockface(), { size: 'M' });
  atlas.add('forest', PAT.forest(), { size: 'M' });
  atlas.add('fields', PAT.fields({ cols: ['#c9c08a', '#b7c27a', '#d8c89a', '#a9b870', '#c4b27c'], line: '#8f9a5e' }), { size: 'M' });
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
  atlas.add('vinyl', P.stripes({ cols: ['#ffffff', '#d4d4d4'], widths: [5, 1], n: 4 }), { size: 'S' });
  atlas.add('slats', P.stripes({ cols: ['#ffffff', '#cdcdcd'], widths: [4, 1], n: 4 }), { size: 'M' });
  atlas.add('blockwall', P.bricks({ brick: '#ffffff', alt: '#f2f2f2', mortar: '#d0d0d0', rows: 6, cols: 2 }), { size: 'M' });
  atlas.add('planks', P.planks({ base: '#9a9da0', alt: '#8a8d91', seam: '#6a6d72', rows: 6 }), { size: 'M' });
  atlas.add('screens', PAT.screens(), { size: 'L', repeat: false });
  atlas.add('ptable', PAT.ptable(), { w: 96, h: 64, repeat: false });
  atlas.add('grid', Q.grid({ bg: '#ffffff', line: '#9a9a9a', n: 4, lw: 3 }), { size: 'S' });
  atlas.add('aspenbark', PAT.aspenbark(), { size: 'S' });
  atlas.add('spine', P.spine({ band: '#f6e7b8' }), { size: 'S', repeat: false });
  atlas.add('exit', Q.sign({ bg: '#fbf6ec', fg: '#d62f2f', text: 'EXIT' }), { w: 96, h: 40, repeat: false });

  return (b) => {
    const R = kit.seeded('cuboulder');

    // ── base plinth + floors ──
    deco(b, -W / 2 - 0.45, -0.55, -D / 2 - 0.45, W / 2 + 0.45, -0.02, D / 2 + 0.45, { color: '#8a5d45', tile: 'sandstone', rep: 2.2 });
    deco(b, -W / 2 - 0.5, -0.1, -D / 2 - 0.5, W / 2 + 0.5, -0.004, D / 2 + 0.5, { color: '#7bb156', faces: ['py', 'px', 'nx', 'pz', 'nz'], outline: false });
    floor(b, -17, -13, -3, -1, 0, { tile: 'planks', rep: 1.6 }); // G1B30 front floor: grey wood-look vinyl (tiers cover the rest)
    floor(b, -17, -1, -3, 1.4, 0, { tile: 'terrazzo', rep: 1.6 });
    floor(b, -3, -13, 8, -1, 0, { tile: 'herring', rep: 1.1 });
    floor(b, 8, -8.6, 17, -1, 0, { tile: 'labfloor', rep: 1.2 }); // Engineering lab (east of the quad)
    floor(b, 8, -13, 17, -8.6, 0, { tile: 'flag', rep: 2.4 }); // engineering yard (bike racks)
    floor(b, -3, -1, 17, 2.4, 0, { tile: 'flag', rep: 2.4 }); // arcade
    floor(b, -17, 1.4, -3, 2.6, 0, { tile: 'flag', rep: 2.4 }); // walk along the corridor
    floor(b, -17, 2.6, 5, 13, 0, { tile: 'lawn', rep: 2.0 }); // the quad
    floor(b, 5, 11.4, 17, 13, 0, { tile: 'flag', rep: 2.4 }); // walk past the UMC

    // ── outer walls (bounds) ──
    const SS = { tile: 'sandstone', rep: 2.4, color: '#ffffff' };
    const g1In = { color: '#ece4d0', tile: 'blockwall', rep: 1.4 };
    const low = (x0, z0, x1, z1, name) => wall(b, { x0, z0, x1, z1, h: 0.7, t: 0.3, both: SS, name, cap: C.tileDk, outline: true });
    wall(b, { x0: -17, z0: -13, x1: -3, z1: -13, h: 6.8, t: 0.2, n: SS, p: g1In, name: 'back', cap: C.tileDk });
    wall(b, { x0: -3, z0: -13, x1: 8, z1: -13, h: 5.0, t: 0.2, n: SS, p: { color: C.plaster }, open: [0.6, 3.85, 6.6].map((c) => ({ c, w: 1.4, bottom: 2.95, top: 3.85 })), trim: C.walnut, name: 'back', cap: C.tileDk });
    low(8, -13, 17, -13, 'back');
    wall(b, { x0: -17, z0: -13, x1: -17, z1: -1, h: 6.8, t: 0.2, n: SS, p: g1In, name: 'left', cap: C.tileDk });
    wall(b, { x0: -17, z0: -1, x1: -17, z1: 1.4, h: 2.9, t: 0.2, n: SS, p: { color: C.block, tile: 'blockwall', rep: 1.2 }, name: 'left', cap: C.tileDk });
    low(-17, 1.4, -17, 13, 'left');
    low(17, -13, 17, -8.6, 'right'); low(17, -1, 17, 2.4, 'right'); low(17, 11.4, 17, 13, 'right');
    low(-17, 13, 17, 13, 'front');
    // red tile copings on the low walls (perchable ledge)
    for (const [x0, z0, x1, z1] of [[-17.2, 12.8, 17.2, 13.2], [-17.2, 1.4, -16.8, 13.2], [8, -13.2, 17.2, -12.8], [16.8, -13.2, 17.2, -8.6], [16.8, -1, 17.2, 2.4], [16.8, 11.4, 17.2, 13.2]]) deco(b, x0, 0.7, z0, x1, 0.78, z1, { color: '#ffffff', tile: 'rooftile', rep: 0.6 });
    guard(b, -17.2, 0.7, 12.85, 17.2, 9, 13.3, 'front'); guard(b, -17.3, 0.7, 1.5, -16.85, 9, 13.3, 'left');
    guard(b, 8.1, 0.7, -13.3, 17.3, 9, -12.85, 'back-yard'); guard(b, 16.85, 0.7, -13.3, 17.3, 9, -8.7, 'right-yard');
    guard(b, 16.85, 0.7, -1, 17.3, 9, 2.3, 'right-arcade'); guard(b, 16.85, 0.7, 11.5, 17.3, 9, 13.3, 'right-front');
    // the Front Range and the plains, placed by real compass bearings (see landscape())
    landscape(b);

    g1b30(b, R);
    corridor(b);
    norlin(b, R, kit);
    // the UMC turns a quarter (no mirroring) to stand on the quad's south side, door facing the quad;
    // the Engineering lab moves east of the quad, south of Norlin (plain translation)
    umc(xform(b, { cx: 12.5, cz: -7, rot: -Math.PI / 2, dx: -1.5, dz: 13.9 }), R, kit);
    lab(xform(b, { dx: 25, dz: -10 }), R);
    labShell(b);
    yard(b);
    arcade(b);
    quad(b, R, kit);

    // ── spawns + spots (all ≥ 0.45 m clear of colliders; checked by the tests) ──
    b.spot('lobby', { x: -8.8, z: 5.2 });
    b.spot('hiderSpawn', { x: -3.0, z: 5.6, yaw: Math.PI });
    b.spot('seekerSpawn', { x: -3.5, z: 12.0, yaw: Math.PI });
    b.spot('spawnA', { x: -2.4, z: 5.8, yaw: Math.PI });
    b.spot('spawnB', { x: -12.8, z: 6.6, yaw: Math.PI });
    b.spot('hiderSpawns', [{ x: -3.0, z: 5.6, yaw: Math.PI }, { x: -12.8, z: 6.6, yaw: Math.PI }, { x: 0.4, z: 3.4, yaw: Math.PI }, { x: 5.0, z: 0.4, yaw: Math.PI }]);
    b.spot('seekerSpawns', [{ x: -3.5, z: 12.0, yaw: Math.PI }, { x: -13.6, z: 9.0, yaw: Math.PI }, { x: 8.0, z: 12.3, yaw: -Math.PI / 2 }, { x: 1.8, z: 12.0, yaw: Math.PI }]);
    b.spot('camo', { x: 7.65, z: -0.5, y: 0, wallNormal: [0, 0, 1], note: 'Norlin sandstone façade under the arcade' });
    b.spot('rug', { x: -6.0, z: 9.8, yaw: Math.PI });
    b.probe('demo-bench-top', [-12.2, 0.96, -2.8], [0, 1, 0], BENCH_TOP);
    b.probe('pool-felt', [10.5, 0.8, 5.4], [0, 1, 0], C.felt); // the pool table, after the UMC's quarter turn
  };
}

// ── THE FRONT RANGE (distant backdrop) ─────────────────────────────────────────
// Compass: north = −x, east = −z (Norlin stands at the east end of its quad and its façade looks
// west across the quad to the mountains, as on campus), so a compass bearing θ (clockwise from
// north) points along (−cos θ, −sin θ) in (x, z).
// Bearings and elevation angles are computed from the Norlin quad (≈ 40.0085 N, 105.2715 W,
// 1650 m) to published summit coordinates; vertical angles are exaggerated ×2.8 (uniformly) so the range reads
// above the roofs. All of it is backdrop: one fog-free chunk, no collision, never picked.
//   Third Flatiron 216.6° 7.9° · Second 218.7° 9.5° · First 224.1° 11.4° · Green Mountain 221.5° 12.1°
//   Royal Arch 209.5° 7.8° · Bear Peak 200.6° 9.2° · Flagstaff Mountain 256.1° 8.6°
const NORTH = '-x';
/** Peaks as seen from the Norlin quad: [name, bearing°, true elevation angle°]. */
export const PEAKS = [['Bear Peak', 200.6, 9.2], ['Royal Arch', 209.5, 7.8], ['Third Flatiron', 216.6, 7.9], ['Second Flatiron', 218.7, 9.5], ['Green Mountain', 221.5, 12.1], ['First Flatiron', 224.1, 11.4], ['Flagstaff Mountain', 256.1, 8.6]];
const EXAG = 2.8;
const DEG = Math.PI / 180;
const dirOf = (brg) => [-Math.cos(brg * DEG), -Math.sin(brg * DEG)];
const BD = { backdrop: true, outline: false };

/** A curved cut-out card along a profile [[bearing, elevation°], …] at radius R (faces the centre). */
function ridge(b, R, profile, o = {}) {
  const pos = []; const nrm = []; const uv = []; const idx = [];
  const y0 = o.y0 == null ? -0.6 : o.y0;
  // resample every ≤ 1.5° so the arc stays round
  const pts = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [b0, e0] = profile[i]; const [b1, e1] = profile[i + 1];
    const n = Math.max(1, Math.ceil(Math.abs(b1 - b0) / 1.5));
    for (let k = 0; k < n; k++) { const t = k / n; pts.push([b0 + (b1 - b0) * t, e0 + (e1 - e0) * t]); }
  }
  pts.push(profile[profile.length - 1]);
  let u = 0;
  pts.forEach(([brg, el], i) => {
    const [dx, dz] = dirOf(brg); const hgt = Math.max(0.2, R * Math.tan(Math.min(60, el * EXAG) * DEG));
    if (i) { const [px, pz] = dirOf(pts[i - 1][0]); u += Math.hypot(dx - px, dz - pz) * R; }
    pos.push(dx * R, y0, dz * R, dx * R, y0 + hgt, dz * R);
    nrm.push(-dx, 0, -dz, -dx, 0, -dz); uv.push(u, 0, u, hgt);
    if (i) { const k = i * 2; idx.push(k - 2, k, k + 1, k - 2, k + 1, k - 1); }
  });
  b.add(fixWinding({ pos, nrm, uv, idx }), { ...BD, color: o.color || '#ffffff', tile: o.tile, rep: o.rep || 6 });
}

/** One Flatiron: a tilted slab face (apex leaning back, i.e. dipping east toward campus). */
function slabIron(b, R, brgL, brgR, brgTop, elev, baseEl, { color = '#d99a82', lean = 0.32 } = {}) {
  const H = R * Math.tan(elev * EXAG * DEG); const Y0 = R * Math.tan(baseEl * EXAG * DEG);
  const [lx, lz] = dirOf(brgL); const [rx, rz] = dirOf(brgR); const [tx, tz] = dirOf(brgTop);
  const back = 1 + (H * lean) / R;
  const P0 = [lx * R, Y0, lz * R]; const P1 = [rx * R, Y0, rz * R]; const P2 = [tx * R * back, H, tz * R * back];
  const [cx, cz] = dirOf((brgL + brgR) / 2);
  const span = Math.hypot(P1[0] - P0[0], P1[2] - P0[2]);
  // face (lit pink) + a narrow shadowed north edge for depth
  const g = { pos: [...P0, ...P1, ...P2], nrm: [-cx, 0.3, -cz, -cx, 0.3, -cz, -cx, 0.3, -cz], uv: [0, Y0, span, Y0, span * 0.45, H], idx: [0, 1, 2] };
  b.add(fixWinding(g), { ...BD, color, tile: 'rockface', rep: 9 });
  const [ex, ez] = dirOf(brgR + 0.6);
  const Q = [ex * R * 1.02, Y0, ez * R * 1.02];
  b.add(fixWinding({ pos: [...P1, ...Q, ...P2], nrm: [-ex, 0.2, -ez, -ex, 0.2, -ez, -ex, 0.2, -ez], uv: [0, 0, 1, 0, 0.5, 1], idx: [0, 1, 2] }), { ...BD, color: '#9c5f55' });
}

function landscape(b) {
  // ground all around the diorama (below the plinth): fields to the east, foothill meadow to the west
  const ring = (r0, r1, a0, a1, o) => {
    const pos = []; const nrm = []; const uv = []; const idx = []; const n = Math.max(4, Math.ceil((a1 - a0) / 6));
    for (let i = 0; i <= n; i++) {
      const [dx, dz] = dirOf(a0 + (a1 - a0) * i / n);
      pos.push(dx * r0, -0.62, dz * r0, dx * r1, -0.62, dz * r1); nrm.push(0, 1, 0, 0, 1, 0); uv.push(dx * r0, dz * r0, dx * r1, dz * r1);
      if (i) { const k = i * 2; idx.push(k - 2, k + 1, k, k - 2, k - 1, k + 1); }
    }
    b.add(fixWinding({ pos, nrm, uv, idx }), { ...BD, ...o });
  };
  ring(16, 110, -10, 170, { tile: 'fields', rep: 14, color: '#ffffff' }); // north → east → south: plains
  ring(16, 110, 170, 350, { tile: 'lawn', rep: 6, color: '#b9c98f' }); // south-west → north-west: meadow under the hills
  // plains to the east: a whisper of low rises on the horizon
  ridge(b, 108, [[300, 0.2], [330, 0.5], [350, 0.9], [10, 0.6], [40, 0.9], [70, 0.5], [100, 0.8], [130, 0.4], [160, 0.9], [185, 1.6]], { tile: 'forest', rep: 10, color: '#b3b98a' });
  // far ridge: South Boulder Peak / Bear Peak, Green Mountain, the ridge north to Sanitas
  ridge(b, 100, [[180, 1.2], [188, 3.5], [195, 6.8], [200.6, 9.2], [203.5, 7.4], [207, 8.2], [213, 10.4], [218, 11.6], [221.5, 12.1], [226, 11.2], [232, 9.6], [240, 8.0], [248, 7.2], [262, 6.4], [275, 5.4], [288, 5.0], [296, 5.6], [303, 4.4], [315, 2.6], [330, 1.0], [345, 0.3]], { tile: 'forest', rep: 9, color: '#4f6e55' });
  // Flagstaff Mountain (closer, lighter) with Gregory Canyon between it and Green Mountain
  ridge(b, 86, [[236, 2.2], [242, 3.6], [248, 6.6], [253, 8.2], [256.1, 8.6], [260, 7.8], [266, 6.2], [274, 4.4], [282, 3.0], [292, 2.2], [300, 1.0]], { tile: 'forest', rep: 8, color: '#6c8a5e' });
  // the Flatirons: tilted pink slabs on Green Mountain's east face (south → north: Fifth/Fourth,
  // Third, Second, First), small irons by Royal Arch, a pine skirt along their feet
  // slabs sit on the forested flank: [left, right, apex bearing, apex elev°, base elev°] (true angles)
  slabIron(b, 77, 203.0, 210.0, 206.4, 5.6, 3.6, { color: '#cf927c' });
  slabIron(b, 76, 207.5, 214.0, 210.8, 6.6, 4.0, { color: '#d69a84' });
  slabIron(b, 75, 211.0, 221.0, 215.8, 7.9, 4.6, { color: '#dba08a' });
  slabIron(b, 74, 215.5, 225.0, 219.6, 9.5, 5.2, { color: '#d99883' });
  slabIron(b, 73, 219.5, 231.0, 224.6, 11.4, 6.0, { color: '#dea48c' });
  // the pine-forested flank under the irons (reaches their feet)
  ridge(b, 71, [[188, 0.4], [196, 2.2], [203, 3.9], [209, 4.4], [215, 4.9], [221, 5.5], [227, 6.3], [232, 6.0], [237, 4.6], [246, 3.0], [256, 1.8], [266, 0.6]], { tile: 'forest', rep: 6, color: '#3d5f45' });
  // the afternoon sun, west-south-west, with a soft halo
  const sun = (r, col, R) => { const [dx, dz] = dirOf(258); const y = R * Math.tan(30 * DEG); b.add(cylGeo(r, r, 0.2, { radial: 20 }), { ...BD, at: [dx * R, y, dz * R], rot: [Math.PI / 2, Math.atan2(dx, dz), 0], color: col }); };
  sun(9, '#fff1c4', 116); sun(6, '#ffd36b', 112);
}

// ── 1. DUANE G1B30 ──────────────────────────────────────────────────────────
// Seats face south (+z) toward the chalkboards on the south wall; tiers rise northward.
const TIER_D = 0.95; const TIER_R = 0.34;
const zN = (k) => -5.2 - TIER_D * k; // north edge of tier k (k = 0 is the floor row)
const BLOCKS = [[-15.9, -12.78, 6], [-11.6, -7.44, 8], [-6.26, -4.18, 4]]; // seat blocks: x0, x1, seats
const AISLES = [[-16.9, -15.9], [-12.78, -11.6], [-7.44, -6.26], [-4.18, -3.1]];

function g1b30(b, R) {
  const FZ = -1.6; // lower front wall face (boards); the upper wall behind the catwalk sits at −1.1
  const CREAM = '#ece4d0'; const DOORS = [{ c: -4.05, w: 1.1, top: 2.3 }, { c: -6.95, w: 1.0, top: 2.3 }];
  // south wall (to the corridor) + the thick lower front wall the boards hang on
  wall(b, { x0: -17, z0: -1, x1: -3, z1: -1, h: 6.8, t: 0.2, n: { color: CREAM }, p: { color: C.block, tile: 'blockwall', rep: 1.2 }, open: DOORS, trim: C.walnut, name: 'g1-south' });
  wall(b, { x0: -16.9, z0: -1.35, x1: -3.1, z1: -1.35, h: 4.45, t: 0.5, n: { color: CREAM }, p: { color: CREAM }, open: DOORS, trim: '#4a3022', cap: null, name: 'g1-front' });
  // east wall (to Norlin) with the top-row door onto the gallery
  wall(b, { x0: -3, z0: -13, x1: -3, z1: -1, h: 6.8, t: 0.2, n: { color: CREAM, tile: 'blockwall', rep: 1.4 }, p: { color: C.plaster }, open: [{ c: -12.4, w: 1.0, bottom: UP, top: UP + 2.0 }], trim: C.walnut, name: 'g1-east' });
  b.add(boxGeo(0.01, 1.8, 12.2, { faces: ['px'] }), { at: [-2.893, 5.9, -7.0], tile: 'sandstone', rep: 2.4, color: '#ffffff', outline: false });
  ceiling(b, -16.9, -12.9, -3.1, -1.1, H.g1, { color: '#efe8d6', name: 'g1b30' });
  // grid of square flush LED panels
  for (let x = -15.4; x < -3.5; x += 2.2) for (let z = -11.8; z < -2.5; z += 2.2) deco(b, x - 0.3, H.g1 - 0.02, z - 0.3, x + 0.3, H.g1, z + 0.3, { color: '#fffef6', faces: ['ny', 'px', 'nx', 'pz', 'nz'], outline: false });
  b.add(boxGeo(14.2, 4.05, 0.01, { faces: ['pz'] }), { at: [-10, 4.775, -0.893], tile: 'sandstone', rep: 2.4, color: '#ffffff', outline: false });
  guard(b, -17.2, H.g1 + 0.12, -13.2, -3, 9, -1, 'g1roof');
  eave(b, -17.2, -1, -3, -1, 6.9, 1, { width: 1.0 });
  // grey fabric acoustic panels high on the side walls
  for (const z of [-11.0, -8.0, -5.0]) deco(b, -16.9, 3.6, z - 1.2, -16.86, 5.6, z + 1.2, { color: '#8e8c8f', tile: 'seatfab', rep: 0.6 });
  for (const z of [-9.0, -6.0]) deco(b, -3.14, 3.6, z - 1.2, -3.1, 5.6, z + 1.2, { color: '#8e8c8f', tile: 'seatfab', rep: 0.6 });

  // ── tiers: dark charcoal carpet, solid (no pockets); aisles step half-way on the south half
  const carpet = { color: '#46484d', tile: 'seatfab', rep: 0.8, outline: false };
  for (let k = 1; k <= 8; k++) {
    const z0 = zN(k); const zs = z0 + TIER_D; const y = TIER_R * k;
    const zTop = k === 8 ? -12.9 : z0;
    solid(b, -16.9, 0, zTop, -3.1, y, z0 + TIER_D / 2, { ...carpet, faces: ['py', 'pz'] }, { name: 'tier' });
    for (const [x0, x1] of BLOCKS) solid(b, x0, 0, z0 + TIER_D / 2, x1, y, zs, { ...carpet, faces: ['py', 'pz', 'px', 'nx'] }, { name: 'tier' });
    for (const [x0, x1] of AISLES) {
      solid(b, x0, 0, z0 + TIER_D / 2, x1, y - 0.17, zs, { ...carpet, color: '#3e4044', faces: ['py', 'pz'] }, { name: 'aisle' });
      deco(b, x0, y - 0.19, zs - 0.035, x1, y - 0.165, zs + 0.004, { color: '#6f7277', outline: false });
      deco(b, x0, y - 0.02, z0 + TIER_D / 2 - 0.035, x1, y + 0.004, z0 + TIER_D / 2 + 0.004, { color: '#6f7277', outline: false });
    }
    for (const [x0, x1] of BLOCKS) deco(b, x0, y - 0.025, zs - 0.03, x1, y + 0.004, zs + 0.004, { color: '#2c2d31', outline: false });
    // the side stair down to the EXIT: black steel railing along its inner edge
    const rx = -4.2;
    aabb(b, rx - 0.025, y + 0.92, z0, rx + 0.025, y + 0.97, zs, { color: C.black, collide: { wall: false, perch: true, name: 'perch:stair-rail' } });
    b.collide(rx - 0.02, y, z0, rx + 0.02, y + 0.92, zs, { wall: false, perch: true, name: 'perch:stair-rail-bars' });
    for (let q = 0; q < 4; q++) deco(b, rx - 0.012, y - (q >= 2 ? 0.17 : 0), z0 + 0.05 + q * 0.23, rx + 0.012, y + 0.92, z0 + 0.07 + q * 0.23, { color: C.black, outline: false });
  }
  // ── seats: grey plastic shells on black pedestals with light-wood tablet arms; office chairs at the front left
  const officeChair = (x, y, z) => {
    b.add(cylGeo(0.24, 0.24, 0.04, { radial: 5 }), { at: [x, y + 0.05, z], color: C.black, outline: false });
    deco(b, x - 0.025, y + 0.05, z - 0.025, x + 0.025, y + 0.46, z + 0.025, { color: C.black, outline: false });
    aabb(b, x - 0.25, y + 0.46, z - 0.24, x + 0.25, y + 0.54, z + 0.24, { color: '#2b2b2f', collide: { wall: false, ceil: true, name: 'chair' } });
    aabb(b, x - 0.23, y + 0.58, z - 0.3, x + 0.23, y + 1.2, z - 0.25, { color: '#2b2b2f', tile: 'pegboard', rep: 0.12, collide: { wall: true, perch: true, name: 'perch:mesh-back' } });
  };
  for (let k = 0; k <= 7; k++) {
    const y = TIER_R * k; const n0 = zN(k);
    BLOCKS.forEach(([x0, x1, n], bi) => {
      const sw = (x1 - x0) / n;
      for (let i = 0; i < n; i++) {
        const cx = x0 + sw * (i + 0.5);
        if (k === 0 && bi === 2) { if (i % 2 === 0) officeChair(cx + sw / 2, y, n0 + 0.5); continue; }
        deco(b, cx - 0.025, y, n0 + 0.33, cx + 0.025, y + 0.42, n0 + 0.38, { color: C.black, outline: false }); // pedestal
        deco(b, cx - 0.12, y, n0 + 0.24, cx + 0.12, y + 0.025, n0 + 0.48, { color: C.black, outline: false }); // foot
        aabb(b, cx - 0.22, y + 0.42, n0 + 0.17, cx + 0.22, y + 0.47, n0 + 0.58, { color: '#767a80', collide: { wall: false, ceil: true, name: 'seat' } });
        aabb(b, cx - 0.22, y + 0.5, n0 + 0.1, cx + 0.22, y + 0.9, n0 + 0.16, { color: '#7f8389', collide: { wall: true, name: 'seat-back' } });
        // tablet arm on the right-hand side (−x): some folded down over the lap, some stowed up
        deco(b, cx - 0.25, y + 0.42, n0 + 0.3, cx - 0.22, y + 0.66, n0 + 0.34, { color: C.black, outline: false });
        if ((i + k) % 3) aabb(b, cx - 0.26, y + 0.66, n0 + 0.34, cx + 0.0, y + 0.68, n0 + 0.64, { color: '#d9b98c', collide: { wall: false, perch: true, name: 'perch:tablet' } });
        else aabb(b, cx - 0.27, y + 0.66, n0 + 0.2, cx - 0.245, y + 0.98, n0 + 0.5, { color: '#d9b98c', collide: { wall: false, perch: true, name: 'perch:tablet' } });
      }
    });
  }

  // ── front wall: sliding dark-green chalkboards with light wood trim + a wood ledge (perch)
  const WOODL = '#cda477';
  for (let col = 0; col < 4; col++) for (let row = 0; row < 2; row++) {
    const x0 = -16.2 + col * 2.05; const y0 = row ? 2.42 : 0.92;
    b.add(boxGeo(2.05, 1.5, 0.02, { faces: ['nz'] }), { at: [x0 + 1.025, y0 + 0.75, FZ - 0.03], color: '#ffffff', tile: 'chalk', rep: [4.1, 1.5], uvOff: [[0, 0.5, 0.25, 0.75][col] + (row ? 0.37 : 0), 0], outline: false });
  }
  for (let col = 0; col <= 4; col++) { const x = -16.2 + col * 2.05; deco(b, x - 0.05, 0.9, FZ - 0.07, x + 0.05, 3.95, FZ, { color: WOODL }); }
  deco(b, -16.25, 2.39, FZ - 0.07, -7.95, 2.45, FZ, { color: WOODL, outline: false });
  deco(b, -16.25, 3.92, FZ - 0.07, -7.95, 3.98, FZ, { color: WOODL, outline: false });
  aabb(b, -16.3, 0.84, FZ - 0.14, -7.9, 0.9, FZ, { color: WOODL, collide: { wall: false, perch: true, name: 'perch:chalk-ledge' } });
  for (let i = 0; i < 5; i++) deco(b, -15.6 + i * 1.7, 0.9, FZ - 0.11, -15.52 + i * 1.7, 0.92, FZ - 0.08, { color: ['#f8f5ee', '#f2c14e'][i % 2], outline: false });
  // two big projector screens over the boards: KEY IDEAS notes and a multiple-choice question
  for (const [x0, half] of [[-11.85, 0.5], [-15.95, 0]]) {
    b.add(boxGeo(3.8, 2.1, 0.02, { faces: ['nz'] }), { at: [x0 + 1.9, 3.3, FZ - 0.18], tile: 'screens', rep: [3.8, 4.2], uvOff: [0, half], color: '#ffffff', outline: false });
    solid(b, x0 - 0.04, 2.23, FZ - 0.18, x0 + 3.84, 4.37, FZ - 0.16, { color: '#2b2b2f', faces: ['px', 'nx', 'py', 'ny', 'pz'] }, { name: 'screen' });
    deco(b, x0 - 0.08, 4.37, FZ - 0.26, x0 + 3.88, 4.45, FZ, { color: '#2b2b2f' });
  }
  // speaker, clock, periodic table poster, EXIT sign
  solid(b, -7.92, 2.5, FZ - 0.28, -7.55, 3.45, FZ, { color: '#1f1f23' }, { name: 'speaker' });
  b.add(cylGeo(0.2, 0.2, 0.05, { radial: 16 }), { at: [-7.0, 3.25, FZ - 0.03], rot: [Math.PI / 2, 0, 0], color: '#f8f5ee' });
  deco(b, -7.015, 3.25, FZ - 0.07, -6.985, 3.4, FZ - 0.06, { color: C.ink, outline: false });
  deco(b, -7.0, 3.235, FZ - 0.07, -6.88, 3.265, FZ - 0.06, { color: C.ink, outline: false });
  poster(b, -5.5, 2.55, FZ, 1.4, 1.0, 'z-', 'ptable', '#e9e5da');
  exitSign(b, -4.05, 2.5, FZ, 'z-'); exitSign(b, -4.05, 2.5, -0.9, 'z+');
  exitSign(b, -3.1, UP + 2.2, -12.4, 'x-');

  // ── catwalk: bulkhead, black steel deck on brackets, vertical-bar railing (walk, crawl, hang under)
  deco(b, -16.9, 4.45, -2.0, -3.1, 4.75, FZ, { color: '#e3dac4' });
  aabb(b, -16.9, 4.75, -2.45, -3.1, 4.82, FZ, { color: '#2e2f33', tile: 'grid', rep: 0.3, collide: { wall: false, ceil: true, name: 'ceil:catwalk' } });
  // behind the deck the upper wall comes forward to the board plane (solid, not climbable)
  deco(b, -16.9, 4.45, FZ, -3.1, H.g1, -1.1, { color: CREAM, faces: ['nz'], outline: false });
  b.collide(-16.9, 4.45, FZ, -3.1, H.g1, -1.1, { wall: true, climb: false, name: 'guard:upper-wall' });
  for (let x = -16.0; x < -3.5; x += 2.1) b.add(boxGeo(0.06, 0.06, 0.95), { at: [x, 4.42, -2.05], rot: [-0.62, 0, 0], color: C.black });
  // see-through railing: thin bars (visual), a top rail you can perch on, a kick plate
  for (let x = -16.05; x <= -3.15; x += 0.16) deco(b, x - 0.012, 4.82, -2.432, x + 0.012, 5.8, -2.408, { color: '#26262a', faces: ['px', 'nx', 'pz', 'nz'], outline: false });
  aabb(b, -16.1, 5.8, -2.46, -3.1, 5.86, -2.38, { color: '#26262a', collide: { wall: false, perch: true, name: 'perch:catwalk-rail' } });
  deco(b, -16.1, 4.86, -2.45, -3.1, 4.92, -2.4, { color: '#26262a' });
  solid(b, -8.7, 5.82, -2.5, -8.45, 6.05, -2.3, { color: '#f4f2ee' }, { name: 'camera' });
  // ladder up to the catwalk at the far (right) end
  for (const x of [-15.95, -15.55]) deco(b, x - 0.025, 0, -1.72, x + 0.025, 4.85, -1.67, { color: C.black });
  for (let i = 1; i <= 15; i++) aabb(b, -15.95, i * 0.3, -1.74, -15.55, i * 0.3 + 0.03, -1.66, { color: C.black, collide: { wall: false, perch: true, name: 'perch:ladder' } });
  // the catwalk's far end: a service door into the upper level (solid, not climbable)
  aabb(b, -16.9, 4.82, -2.45, -16.1, H.g1, -1.1, { color: CREAM, collide: { wall: false, climb: false, name: 'guard:catwalk-end' } });
  deco(b, -16.1, 4.82, -2.0, -16.08, 6.3, -1.4, { color: '#4a3022' });
  // ropes + pulleys hanging from the catwalk (hang points); a coil of rope on the floor
  for (const [x, top] of [[-10.6, 4.75], [-10.42, 4.75]]) {
    deco(b, x - 0.012, 0.02, -2.37, x + 0.012, top, -2.34, { color: '#7a6a58', outline: false });
    b.collide(x - 0.02, 0, -2.38, x + 0.02, top - 0.4, -2.33, { wall: false, perch: true, name: 'perch:rope' });
  }
  for (const y of [4.2, 3.3]) {
    b.add(cylGeo(0.09, 0.09, 0.05, { radial: 12 }), { at: [-10.51, y, -2.355], rot: [Math.PI / 2, 0, 0], color: '#8c9096', collide: { wall: false, perch: true, name: 'perch:pulley' } });
    deco(b, -10.53, y + 0.09, -2.37, -10.49, y + 0.2, -2.34, { color: C.black, outline: false });
  }
  b.add(sphereGeo(0.09, 0.12, 0.07, { w: 8, h: 6 }), { at: [-9.6, 4.45, -2.4], color: '#2f5a3f' }); // a little green bag on a hook
  b.add(cylGeo(0.34, 0.36, 0.08, { radial: 16 }), { at: [-9.7, 0.04, -3.95], color: '#8a7864', tile: 'rings', rep: 0.06 });
  b.add(cylGeo(0.18, 0.18, 0.081, { radial: 12 }), { at: [-9.7, 0.045, -3.95], color: '#55606a', outline: false });
  // Christmas lights and a red ornament on the near (left) end of the railing
  for (let i = 0; i <= 10; i++) { const t = i / 10; b.add(sphereGeo(0.035, 0.035, 0.035, { w: 6, h: 4 }), { at: [-3.3 - t * 2.0, 4.72 - Math.sin(t * Math.PI) * 0.22, -2.47], color: '#fffbe6', outline: false }); }
  b.add(sphereGeo(0.07, 0.07, 0.07, { w: 8, h: 6 }), { at: [-3.9, 4.45, -2.5], color: '#d8322e' });

  // ── projector on a long white pole from the ceiling
  b.add(cylGeo(0.05, 0.05, H.g1 - 4.55, { radial: 8 }), { at: [-8.0, (H.g1 + 4.55) / 2, -6.6], color: '#f4f2ee', collide: { wall: false, perch: true, name: 'perch:projector-pole' } });
  solid(b, -8.28, 4.42, -6.85, -7.72, 4.57, -6.35, { color: '#25252a' }, { name: 'projector-mount' });
  solid(b, -8.45, 4.1, -6.95, -7.55, 4.42, -6.25, { color: '#f6f5f1' }, { name: 'projector' });
  for (let i = 0; i < 6; i++) deco(b, -8.3 + i * 0.1, 4.16, -6.252, -8.26 + i * 0.1, 4.36, -6.24, { color: '#9a9ea3', outline: false });
  b.add(cylGeo(0.07, 0.07, 0.04, { radial: 10 }), { at: [-7.7, 4.26, -6.23], rot: [Math.PI / 2, 0, 0], color: '#2a3a4a', outline: false });

  // ── front floor furniture
  // the long demo bench: sage laminate top, cream panelled body, open behind (hide in the kneehole from the board side)
  const bz0 = -3.35; const bz1 = -2.6; const BODY = '#efe7d2';
  solid(b, -14.6, 0, bz0, -13.5, 0.92, bz1, { color: BODY }, { name: 'bench' });
  solid(b, -10.5, 0, bz0, -9.4, 0.92, bz1, { color: BODY }, { name: 'bench' });
  solid(b, -13.5, 0.06, bz0, -10.5, 0.92, bz0 + 0.05, { color: BODY }, { name: 'bench-front' });
  for (let x = -14.05; x < -9.5; x += 1.05) deco(b, x - 0.01, 0.12, bz0 - 0.006, x + 0.01, 0.86, bz0, { color: '#cfc5ad', outline: false });
  deco(b, -14.6, 0, bz0 - 0.005, -9.4, 0.06, bz1, { color: '#3a3a3e', outline: false });
  aabb(b, -14.68, 0.92, bz0 - 0.06, -9.32, 0.96, bz1 + 0.04, { color: BENCH_TOP, collide: { wall: false, ceil: true, name: 'bench-top' } });
  deco(b, -10.25, 0.42, bz0 - 0.02, -9.85, 0.72, bz0, { color: '#2a2b2f' }); // control panel
  for (let i = 0; i < 4; i++) deco(b, -10.2 + (i % 2) * 0.17, 0.5 + (i >> 1) * 0.12, bz0 - 0.03, -10.12 + (i % 2) * 0.17, 0.56 + (i >> 1) * 0.12, bz0 - 0.02, { color: ['#f2f2ea', '#d9483b', '#f2f2ea', '#3fa66b'][i], outline: false });
  deco(b, -13.4, 0.96, -3.1, -13.0, 1.02, -2.85, { color: '#2a2b2f' });
  deco(b, -11.4, 0.96, -3.0, -11.1, 0.975, -2.8, { color: '#f8f5ee', outline: false });
  b.add(sphereGeo(0.06, 0.025, 0.08, { w: 6, h: 4 }), { at: [-10.9, 0.97, -2.95], color: C.mustard, outline: false });
  // the smaller cream table with a green top
  solid(b, -8.9, 0, -2.75, -8.0, 0.86, -2.1, { color: BODY }, { name: 'side-table' });
  aabb(b, -8.95, 0.86, -2.8, -7.95, 0.9, -2.05, { color: BENCH_TOP, collide: { wall: false, name: 'side-table-top' } });
  deco(b, -8.7, 0.9, -2.6, -8.45, 0.905, -2.35, { color: '#f8f5ee', outline: false });
  // lectern / AV station (cream body, wood top, tablet + mic) and a small AV cart
  solid(b, -6.7, 0, -4.0, -5.8, 0.95, -3.4, { color: BODY }, { name: 'lectern' });
  aabb(b, -6.78, 0.95, -4.06, -5.72, 1.0, -3.34, { color: '#b58a5c', tile: 'wood', rep: 0.5, collide: { wall: false, ceil: true, name: 'lectern-top' } });
  deco(b, -6.35, 1.0, -3.8, -6.05, 1.02, -3.58, { color: '#1f1f23', outline: false });
  deco(b, -6.33, 1.021, -3.78, -6.07, 1.024, -3.6, { color: '#6fb6e8', outline: false });
  b.add(cylGeo(0.008, 0.008, 0.32, { radial: 5 }), { at: [-5.95, 1.15, -3.5], rot: [0.5, 0, 0], color: C.black, outline: false });
  b.add(cylGeo(0.03, 0.03, 0.01, { radial: 8 }), { at: [-6.55, 1.005, -3.6], color: '#e07a1f', outline: false });
  aabb(b, -5.6, 0.75, -3.95, -5.1, 0.79, -3.45, { color: '#c9ced3', collide: { wall: false, ceil: true, name: 'cart' } });
  aabb(b, -5.6, 0.3, -3.95, -5.1, 0.33, -3.45, { color: '#c9ced3', collide: { wall: false, name: 'cart-shelf' } });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) deco(b, -5.35 + sx * 0.23 - 0.012, 0.04, -3.7 + sz * 0.23 - 0.012, -5.35 + sx * 0.23 + 0.012, 0.77, -3.7 + sz * 0.23 + 0.012, { color: '#2a2b2f', outline: false });
  solid(b, -5.5, 0.79, -3.85, -5.2, 0.95, -3.6, { color: '#2a2b2f' }, { name: 'doc-cam' });
  // a black wheeled dolly
  aabb(b, -8.5, 0.06, -3.95, -7.85, 0.1, -3.45, { color: '#1f1f23', collide: { wall: false, name: 'dolly' } });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.add(sphereGeo(0.03, 0.03, 0.03, { w: 6, h: 4 }), { at: [-8.175 + sx * 0.28, 0.03, -3.7 + sz * 0.2], color: '#555', outline: false });
  b.blob(-12, -2.97, 2.9, 0.5, { a: 0.24 }); b.blob(-6.25, -3.7, 0.55, 0.4); b.blob(-8.45, -2.42, 0.5, 0.4);
  void R;
}

// ── 2. BASEMENT CORRIDOR (Duane, below ground: lockers, pipes, cork board) ─────────────
function corridor(b) {
  wall(b, { x0: -17, z0: 1.4, x1: -8, z1: 1.4, h: 2.9, t: 0.2, n: { color: C.block, tile: 'blockwall', rep: 1.2 }, p: { tile: 'sandstone', rep: 2.4 }, open: [{ c: -12.5, w: 1.3, top: 2.2 }], trim: C.walnut, name: 'cor-quad-w' });
  eave(b, -17, 1.4, -8, 1.4, 3.0, 1, { width: 0.8 }); arch(b, -12.5, 2.2, 1.62, 1.3, { depth: 0.2, thick: 0.16 });
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
  solid(b, -16.6, 0, -0.9, -14.2, 0.8, -0.5, { color: C.walnut, tile: 'wood', rep: 0.5 }, { name: 'case' });
  deco(b, -16.6, 0.8, -0.9, -14.2, 1.9, -0.88, { color: '#3a4d6a' });
  for (const [x, z] of [[-16.58, -0.52], [-14.22, -0.52]]) deco(b, x - 0.02, 0.8, z - 0.02, x + 0.02, 1.9, z + 0.02, { color: C.walnut });
  solid(b, -16.62, 1.9, -0.92, -14.18, 1.96, -0.48, { color: C.walnut }, { name: 'case-top' });
  b.collide(-16.6, 0.8, -0.53, -14.2, 1.9, -0.49, { wall: false, climb: false, name: 'glass' });
  b.add(sphereGeo(0.13, 0.13, 0.13, { w: 12, h: 8 }), { at: [-15.4, 1.3, -0.7], color: C.mustard });
  [[0.25, 0.04, C.coral], [0.38, 0.05, C.teal], [0.52, 0.035, C.red], [0.66, 0.08, '#e9cf86']].forEach(([d, r, c], i) => {
    const a = i * 1.7;
    b.add(sphereGeo(r, r, r, { w: 8, h: 6 }), { at: [-15.4 + Math.cos(a) * d * 1.3, 1.3 + Math.sin(a * 2) * 0.05, -0.7 + Math.sin(a) * 0.12], color: c });
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
  wall(b, { x0: -3, z0: -1, x1: 8, z1: -1, h: 5.0, t: 0.2, n: { color: C.plaster }, p: face, open: [{ c: 0.6, w: 1.4, bottom: 0.85, top: 2.75 }, { c: 3.85, w: 1.5, top: 2.7 }, { c: 6.6, w: 1.4, bottom: 0.85, top: 2.75 }], trim: C.walnut, name: 'nor-south' });
  wall(b, { x0: 8, z0: -13, x1: 8, z1: -8.6, h: 5.0, t: 0.2, n: { color: C.plaster }, p: { tile: 'sandstone', rep: 2.4 }, name: 'nor-yard', cap: C.tileDk });
  wall(b, { x0: 8, z0: -8.6, x1: 8, z1: -1, h: 5.0, t: 0.2, n: { color: C.plaster }, p: { color: C.blueGrey }, open: [{ c: -3.6, w: 1.2, top: 2.3 }], trim: C.walnut, name: 'nor-lab' });
  glazing(b, 'x', -1, -0.04, 1.24, 0.85, 2.75); glazing(b, 'x', -1, 5.96, 7.24, 0.85, 2.75);
  for (const c of [0.6, 6.6]) arch(b, c, 2.75, -0.82, 1.4, { depth: 0.12, thick: 0.14, n: 5 });
  arch(b, 3.85, 2.7, -0.82, 1.5, { depth: 0.12, thick: 0.16 });
  ceiling(b, -2.9, -12.9, 7.9, -1.1, H.nor, { tile: 'coffer', rep: 1.45, name: 'norlin' });
  guard(b, -3, H.nor + 0.12, -13.2, 8, 9, -1, 'norroof');
  // coffer beams (hang from their undersides)
  for (const z of [-11.0, -8.1, -5.2, -2.3]) solid(b, -2.9, H.nor - 0.22, z - 0.1, 7.9, H.nor, z + 0.1, { color: '#e8d8b6', faces: ['ny', 'pz', 'nz'] }, { name: 'ceil:beam', ceil: true, wall: false });
  for (const x of [0.6, 3.85, 6.6]) solid(b, x - 0.1, H.nor - 0.22, -12.9, x + 0.1, H.nor, -1.1, { color: '#e8d8b6', faces: ['ny', 'px', 'nx'] }, { name: 'ceil:beam', ceil: true, wall: false });
  // tall arched windows painted high on the north wall
  for (const x of [0.6, 3.85, 6.6]) {
    glazing(b, 'x', -13, x - 0.7, x + 0.7, 2.95, 3.85, C.walnut);
    for (const [z, nz] of [[-12.885, 1], [-13.115, -1]]) b.add(sphereGeo(0.7, 0.7, 0.012, { w: 12, h: 3, thetaMax: Math.PI / 2 }), { at: [x, 3.85, z], color: '#d5e7ec', outline: false, rot: nz < 0 ? [0, Math.PI, 0] : undefined });
    deco(b, x - 0.02, 3.85, -13.03, x + 0.02, 4.5, -12.97, { color: C.walnut, outline: false });
    arch(b, x, 3.85, -12.86, 1.4, { depth: 0.1, thick: 0.14, n: 5, color: '#e8d8b6', key: '#c9a24a' });
    arch(b, x, 3.85, -13.14, 1.4, { depth: 0.1, thick: 0.16, n: 5 });
  }
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
  solid(b, 7.3, 0, -2.05, 7.85, 1.35, -1.15, { color: '#a8754d', tile: 'drawers', rep: 0.45 }, { name: 'catalogue' });
  deco(b, 7.25, 1.35, -2.1, 7.9, 1.42, -1.12, { color: C.walnut });
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
  // (local frame: built as if at x 8..17, z −13..−1, then turned onto the quad's south side by xform)
  const SS = { tile: 'sandstone', rep: 2.4, color: '#ffffff' };
  floor(b, 8, -13, 17, -1, 0.004, { tile: 'carpet90', rep: 1.4 });
  wall(b, { x0: 8, z0: -13, x1: 17, z1: -13, h: 4.4, t: 0.2, n: SS, p: { color: '#e9d9bd' }, name: 'umc-back', cap: C.tileDk });
  wall(b, { x0: 17, z0: -13, x1: 17, z1: -1, h: 4.4, t: 0.2, n: { color: '#e9d9bd' }, p: SS, open: [-8.4, -5.8, -3.2].map((c) => ({ c, w: 1.2, bottom: 1.3, top: 2.6 })), trim: C.ink, name: 'umc-booth-wall', cap: C.tileDk });
  for (const c of [-8.4, -5.8, -3.2]) glazing(b, 'z', 17, c - 0.6, c + 0.6, 1.3, 2.6);
  wall(b, { x0: 8, z0: -13, x1: 8, z1: -1, h: 4.4, t: 0.2, n: SS, p: { color: '#e9d9bd' }, open: [{ c: -5, w: 1.4, top: 2.4 }], trim: C.ink, name: 'umc-side', cap: C.tileDk });
  eave(b, 8, -1, 17, -1, 4.5, 1, { width: 0.9 });
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
  solid(b, 9.0, 0, -10.9, 13.8, 0.94, -10.25, { color: '#ffffff', tile: 'banner', rep: [1.3, 1.0] }, { name: 'front-counter' });
  aabb(b, 8.95, 0.94, -10.95, 13.85, 0.99, -10.2, { color: '#c9b79a', collide: { wall: false, name: 'counter-top' } });
  solid(b, 12.4, 0.99, -10.85, 13.7, 1.43, -10.35, { color: '#cfe8f0' }, { name: 'pastry-case', climb: false });
  for (let i = 0; i < 6; i++) b.add(sphereGeo(0.08, 0.05, 0.08, { w: 8, h: 6 }), { at: [12.6 + i * 0.2, 1.15 + (i % 2) * 0.13, -10.6], color: ['#d99b5a', '#f08aa8', '#c47a3f'][i % 3], outline: false });
  solid(b, 10.0, 0.99, -10.8, 10.4, 1.23, -10.45, { color: '#3a3d44' }, { name: 'register' });
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
  wall(b, { x0: -8, z0: 1.4, x1: -8, z1: 9, h: 3.2, t: 0.2, n: { color: C.blueGrey }, p: { tile: 'sandstone', rep: 2.4 }, open: [{ c: 3.2, w: 1.6, bottom: 0.9, top: 2.3 }, { c: 5.6, w: 1.3, bottom: 0.9, top: 2.25 }], trim: C.ink, name: 'lab-east' });
  wall(b, { x0: -17, z0: 9, x1: -8, z1: 9, h: 3.2, t: 0.2, n: { color: C.blueGrey }, p: { tile: 'sandstone', rep: 2.4 }, open: [{ c: -14.6, w: 1.2, top: 2.25 }, { c: -11.6, w: 1.8, bottom: 0.9, top: 2.3 }, { c: -9.4, w: 1.2, bottom: 0.9, top: 2.3 }], trim: C.ink, name: 'lab-south' });
  glazing(b, 'z', -8, 2.46, 3.94, 0.9, 2.3); glazing(b, 'z', -8, 4.98, 6.22, 0.9, 2.25); glazing(b, 'x', 9, -12.44, -10.76, 0.9, 2.3); glazing(b, 'x', 9, -9.94, -8.86, 0.9, 2.3);
  ceiling(b, -16.9, 1.5, -8.1, 8.9, H.lab, { tile: 'acoustic', rep: 1.2, name: 'lab' });
  guard(b, -17.2, H.lab + 0.12, 1.4, -8, 9, 9.2, 'labroof');
  eave(b, -8, 1.4, -8, 9.2, 3.3, 1, { width: 0.9 });
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

/** The relocated lab's north wall (to the engineering yard), with its door. */
function labShell(b) {
  wall(b, { x0: 8, z0: -8.6, x1: 17, z1: -8.6, h: 3.2, t: 0.2, n: { tile: 'sandstone', rep: 2.4 }, p: { color: C.blueGrey }, open: [{ c: 12.5, w: 1.3, top: 2.2 }], trim: C.ink, name: 'lab-yard', cap: C.tileDk });
  eave(b, 8, -8.6, 17.2, -8.6, 3.3, -1, { width: 0.9 });
}

/** The engineering yard behind the lab: bike racks (perches), two bikes, a drone pad, a lamp. */
function yard(b) {
  for (let i = 0; i < 5; i++) {
    const x = 9.6 + i * 0.85; const z = -11.4;
    for (const dz of [-0.28, 0.28]) deco(b, x - 0.025, 0, z + dz - 0.025, x + 0.025, 0.78, z + dz + 0.025, { color: '#9aa3ab' });
    aabb(b, x - 0.03, 0.78, z - 0.31, x + 0.03, 0.84, z + 0.31, { color: '#9aa3ab', collide: { wall: false, perch: true, name: 'perch:bike-rack' } });
    b.collide(x - 0.03, 0, z - 0.31, x + 0.03, 0.78, z + 0.31, { wall: false, perch: true, name: 'perch:bike-rack-leg' });
  }
  const bike = (x, z, col) => {
    for (const dz of [-0.48, 0.48]) {
      b.add(cylGeo(0.33, 0.33, 0.03, { radial: 16 }), { at: [x, 0.34, z + dz], rot: [0, 0, Math.PI / 2], color: C.ink });
      b.add(cylGeo(0.27, 0.27, 0.034, { radial: 16 }), { at: [x, 0.34, z + dz], rot: [0, 0, Math.PI / 2], color: '#cfd4d8', outline: false });
    }
    b.add(boxGeo(0.04, 0.04, 0.95), { at: [x, 0.62, z], color: col });
    b.add(boxGeo(0.04, 0.5, 0.04), { at: [x, 0.5, z - 0.12], rot: [0.35, 0, 0], color: col });
    b.add(boxGeo(0.12, 0.04, 0.22), { at: [x, 0.84, z - 0.25], color: C.ink });
    b.add(boxGeo(0.5, 0.03, 0.03), { at: [x, 0.9, z + 0.4], color: C.ink });
    b.collide(x - 0.05, 0, z - 0.82, x + 0.05, 0.92, z + 0.82, { wall: false, perch: true, name: 'perch:bike' });
  };
  bike(10.03, -11.4, C.teal); bike(12.58, -11.4, C.gold);
  b.add(cylGeo(1.1, 1.1, 0.012, { radial: 24 }), { at: [14.9, 0.012, -10.8], color: '#3a3d44', outline: false });
  b.add(cylGeo(0.85, 0.85, 0.013, { radial: 24 }), { at: [14.9, 0.013, -10.8], color: C.gold, outline: false });
  b.add(cylGeo(0.7, 0.7, 0.014, { radial: 24 }), { at: [14.9, 0.014, -10.8], color: '#3a3d44', outline: false });
  deco(b, 14.6, 0.014, -10.85, 15.2, 0.016, -10.75, { color: C.gold, outline: false });
  deco(b, 14.85, 0.014, -11.1, 14.95, 0.016, -10.5, { color: C.gold, outline: false });
  b.add(cylGeo(0.05, 0.07, 3.0, { radial: 8 }), { at: [16.3, 1.5, -9.4], color: C.black, collide: { wall: true, name: 'lamp-post' } });
  b.add(latheGeo([[0.06, 0], [0.18, 0.08], [0.16, 0.36], [0.22, 0.4], [0.02, 0.55]], { radial: 10 }), { at: [16.3, 3.0, -9.4], color: '#fff3c4', collide: { wall: false, perch: true, name: 'perch:lantern' } });
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
  const pc = [-6.0, 7.7];
  path(-16.6, 2.8, pc[0], pc[1]); path(4.4, 2.8, pc[0], pc[1]); path(pc[0], pc[1], -16.6, 12.6); path(pc[0], pc[1], 4.4, 12.6); path(pc[0], 2.6, pc[0], 12.8, 1.6); path(4.6, 12.2, 16.6, 12.2, 1.2);
  b.add(cylGeo(2.4, 2.4, 0.012, { radial: 28 }), { at: [pc[0], 0.012, pc[1]], tile: 'flag', rep: 2.4, color: '#ffffff', outline: true });
  // the buffalo: an original low-poly bronze on a sandstone plinth (quad landmark)
  solid(b, pc[0] - 1.15, 0, pc[1] - 0.6, pc[0] + 1.15, 0.85, pc[1] + 0.6, { color: '#ffffff', tile: 'sandstone', rep: 1.6 }, { name: 'plinth' });
  deco(b, pc[0] - 1.22, 0.85, pc[1] - 0.67, pc[0] + 1.22, 0.93, pc[1] + 0.67, { color: C.stoneC, collide: { wall: false, name: 'plinth-cap' } });
  deco(b, pc[0] - 0.5, 0.35, pc[1] + 0.6, pc[0] + 0.5, 0.6, pc[1] + 0.62, { color: C.gold, outline: false });
  const bz = kit.frame(b, pc[0], pc[1], Math.PI / 2); // head toward +x
  const bronze = '#4a3a30'; const fur = '#6e4c34'; const furDk = '#3a2a22';
  const y0 = 0.93;
  bz.sph(0.32, 0.34, 0.55, [0, y0 + 0.74, -0.38], { color: bronze, w: 10, h: 7, collide: { wall: true, name: 'buffalo' } }); // hindquarters
  bz.sph(0.46, 0.56, 0.52, [0, y0 + 0.9, 0.28], { color: fur, w: 11, h: 8 }); // shaggy forequarters
  bz.sph(0.3, 0.26, 0.32, [0, y0 + 1.3, 0.2], { color: fur, w: 9, h: 6 }); // the hump
  bz.sph(0.25, 0.28, 0.28, [0, y0 + 0.62, 0.86], { color: furDk, w: 9, h: 6, rot: [0.5, 0, 0] }); // low head
  bz.sph(0.15, 0.13, 0.15, [0, y0 + 0.44, 1.06], { color: bronze, w: 8, h: 6 }); // muzzle
  bz.sph(0.12, 0.18, 0.1, [0, y0 + 0.32, 0.9], { color: furDk, w: 8, h: 5 }); // beard
  for (const s of [-1, 1]) {
    bz.cyl(0.02, 0.045, 0.2, [s * 0.28, y0 + 0.82, 0.84], { color: '#e9dcc0', rot: [0, 0, -s * 0.9], radial: 8 }); // horns
    bz.sph(0.03, 0.03, 0.03, [s * 0.15, y0 + 0.66, 1.05], { color: C.gold, w: 6, h: 4, outline: false }); // eyes
    bz.sph(0.15, 0.2, 0.17, [s * 0.2, y0 + 0.52, 0.32], { color: fur, w: 8, h: 6 }); // shaggy "pantaloons"
  }
  for (const [sx, sz] of [[-1, 0.32], [1, 0.32], [-1, -0.55], [1, -0.55]]) bz.cyl(0.06, 0.08, 0.6, [sx * 0.19, y0 + 0.3, sz], { color: bronze, radial: 8 });
  bz.cyl(0.02, 0.03, 0.42, [0, y0 + 0.7, -0.92], { color: bronze, rot: [-0.5, 0, 0], radial: 6 });
  bz.sph(0.05, 0.08, 0.05, [0, y0 + 0.5, -1.0], { color: furDk, w: 6, h: 5 });
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
  aspen(-14.5, 4.6, 1.0, 1); aspen(-15.8, 10.4, 0.95, 2); aspen(-12.6, 12.1, 0.9, 3); aspen(0.6, 11.7, 1.0, 4); aspen(2.6, 9.2, 0.9, 5); aspen(-1.0, 4.3, 0.95, 6); aspen(3.6, 4.4, 0.85, 7);
  pine(-16.0, 7.4, 0.9); pine(-10.6, 3.7, 0.85); pine(-9.6, 12.1, 0.8); pine(3.4, 7.2, 0.8);

  // lamp posts (black with a gold band; the lantern top is a perch)
  for (const [x, z] of [[-8.6, 3.4], [-3.4, 3.4], [-14.6, 8.8], [1.0, 8.6]]) {
    b.add(cylGeo(0.05, 0.07, 3.0, { radial: 8 }), { at: [x, 1.5, z], color: C.black, collide: { wall: true, name: 'lamp-post' } });
    b.add(cylGeo(0.06, 0.06, 0.1, { radial: 8 }), { at: [x, 2.2, z], color: C.gold, outline: false });
    b.add(latheGeo([[0.06, 0], [0.18, 0.08], [0.16, 0.36], [0.22, 0.4], [0.02, 0.55]], { radial: 10 }), { at: [x, 3.0, z], color: '#fff3c4', collide: { wall: false, perch: true, name: 'perch:lantern' } });
    b.blob(x, z, 0.2, 0.2);
  }
  // sandstone planter with flowers (low wall perch) near the corridor door
  solid(b, 1.4, 0, 5.6, 3.6, 0.45, 6.6, { color: '#ffffff', tile: 'sandstone', rep: 1.6, faces: ['px', 'nx', 'pz', 'nz'] }, { name: 'planter' });
  deco(b, 1.35, 0.45, 5.55, 3.65, 0.5, 6.65, { color: C.stoneC });
  b.add(boxGeo(2.1, 0.02, 0.9, { faces: ['py'] }), { at: [2.5, 0.42, 6.1], color: '#6b4a32', outline: false });
  for (let i = 0; i < 26; i++) {
    const fx = 1.55 + R() * 1.9; const fz = 5.72 + R() * 0.76; const hh = 0.1 + R() * 0.2;
    b.add(sphereGeo(0.05, 0.04, 0.05, { w: 6, h: 4 }), { at: [fx, 0.44 + hh, fz], color: [C.red, C.gold, '#f08aa8', '#8e6bbf', '#f8f5ee'][i % 5], outline: i % 3 === 0 });
  }
  // a flyer kiosk (colourful hiding spot)
  b.add(cylGeo(0.42, 0.42, 2.0, { radial: 12 }), { at: [-1.6, 1.0, 3.6], color: '#ffffff', tile: 'cork', rep: [0.9, 0.9], collide: { wall: true, name: 'kiosk' } });
  b.add(cylGeo(0.0, 0.55, 0.35, { radial: 12 }), { at: [-1.6, 2.18, 3.6], color: C.tileDk });
  b.blob(-1.6, 3.6, 0.5, 0.5);

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
      { name: 'UMC hangout', floor: 0, x0: 5, z0: 2.4, x1: 17, z1: 11.4, landmark: 'Pool table and coffee bar' },
      { name: 'Basement corridor', floor: 0, x0: -17, z0: -1, x1: -3, z1: 1.4, landmark: 'Lockers and pipes' },
      { name: 'Engineering lab', floor: 0, x0: 8, z0: -8.6, x1: 17, z1: -1, landmark: 'Model rocket' },
      { name: 'Engineering yard', floor: 0, x0: 8, z0: -13, x1: 17, z1: -8.6, landmark: 'Bike racks and drone pad' },
      { name: 'Sandstone arcade', floor: 0, x0: -3, z0: -1, x1: 17, z1: 2.4, landmark: 'Round arches' },
      { name: 'The quad', floor: 0, x0: -17, z0: 1.4, x1: 5, z1: 13, landmark: 'Buffalo statue' },
      { name: 'UMC walk', floor: 0, x0: 5, z0: 11.4, x1: 17, z1: 13, landmark: 'UMC booth windows' },
    ],
    north: NORTH, // compass: north = −x, east = −z (bearing θ → (−cos θ, −sin θ) in x, z)
    overview: { y: 12, radius: 18 },
    // screenshot / tour cameras: p = eye, t = target
    cams: [
      { name: 'g1b30-photo', p: [-15.9, 6.3, -7.6], t: [-8.6, 0.9, -1.9] },
      { name: 'g1b30', p: [-3.7, 4.9, -12.5], t: [-10, 1.2, -1.6] },
      { name: 'g1b30-rows', p: [-5.4, 2.0, -1.7], t: [-11.5, 1.8, -10] },
      { name: 'norlin', p: [7.5, 4.3, -1.5], t: [1.5, 0.8, -8.5] },
      { name: 'norlin-gallery', p: [1.2, 4.2, -12.3], t: [-2.2, 2.6, -6.5] },
      { name: 'umc', p: [5.5, 3.0, 3.1], t: [11.5, 0.6, 7.9] },
      { name: 'corridor', p: [-3.5, 2.3, 0.6], t: [-14, 0.8, 0.0] },
      { name: 'lab', p: [16.5, 2.75, -1.4], t: [10.5, 0.8, -7.0] },
      { name: 'yard', p: [9.0, 2.6, -9.2], t: [15, 0.4, -12] },
      { name: 'arcade', p: [16.0, 2.2, 1.0], t: [-2, 1.4, 0.2] },
      { name: 'quad', p: [-6, 6.5, 16], t: [-6, 0.6, 4.5] },
      // compass views (north = −x, east = −z, west = +z) and views out of windows
      { name: 'quad-looking-N', p: [-1, 1.5, 7.5], t: [-17, 2.2, 7.5] },
      { name: 'quad-looking-E', p: [-6, 1.6, 12.4], t: [-6, 3.5, -4] },
      { name: 'quad-looking-S', p: [-12.8, 1.6, 9.4], t: [10, 2.6, 7.4] },
      { name: 'quad-looking-SW', p: [-12.5, 1.6, 4.5], t: [10.5, 8, 23.8] },
      { name: 'quad-looking-W', p: [-6, 1.8, 3.6], t: [-6, 4.0, 25] },
      { name: 'norlin-facade-window-W', p: [6.6, 1.7, -5.0], t: [6.0, 2.4, 20] },
      { name: 'norlin-back-window-E', p: [3.85, 3.0, -8.0], t: [3.0, 4.3, -20] },
      { name: 'umc-booth-window-W', p: [9.8, 1.95, 7.6], t: [9.0, 2.4, 22] },
      { name: 'lab-window-S', p: [12.5, 1.6, -6.8], t: [28, 1.9, -6.8] },
      { name: 'top-down', p: [-4, 21, 12], t: [-1, 0, -1] },
      { name: 'overview', p: [2, 13, 18], t: [0, 0.5, 0] },
    ],
  },
};
