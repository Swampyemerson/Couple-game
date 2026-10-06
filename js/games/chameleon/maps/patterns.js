// Extra procedural patterns for the big maps, same contract as atlas.js painters:
// (g, w, h, rnd) => void, drawn seamless when the tile repeats. All deterministic (rnd is seeded
// by the tile key). Tintable ones are drawn in greys and multiplied by the vertex colour.

const wrap = (g, w, h, fn) => { for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) fn(ox * w, oy * h); };
const circle = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };

export const Q = {
  /** Patchwork quilt: squares of solids, dots, stripes and checks, with stitch lines. */
  quilt: ({ cols, bg = '#f6efe2', n = 4, stitch = 'rgba(40,30,30,0.35)' }) => (g, w, h, r) => {
    const s = w / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const c = cols[(i * 3 + j * 5) % cols.length]; const x = i * s; const y = j * s; const k = (i + j * 2) % 4;
      g.fillStyle = k === 0 ? c : bg; g.fillRect(x, y, s, s);
      g.fillStyle = c;
      if (k === 1) for (let a = 0; a < 3; a++) for (let b2 = 0; b2 < 3; b2++) circle(g, x + (a + 0.5) * s / 3, y + (b2 + 0.5) * s / 3, s * 0.08);
      if (k === 2) for (let a = 0; a < 4; a++) g.fillRect(x + a * s / 4, y, s / 8, s);
      if (k === 3) { g.beginPath(); g.moveTo(x, y + s); g.lineTo(x + s, y); g.lineTo(x + s, y + s); g.closePath(); g.fill(); }
    }
    g.strokeStyle = stitch; g.lineWidth = 1.5; g.setLineDash([4, 3]);
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s + 3, 0); g.lineTo(i * s + 3, h); g.stroke(); g.beginPath(); g.moveTo(0, i * s + 3); g.lineTo(w, i * s + 3); g.stroke(); }
    g.setLineDash([]);
    void r;
  },

  /** Damask-ish ornament wallpaper: a mirrored teardrop + diamond motif on a half-drop grid. */
  damask: ({ bg, fg, accent }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const motif = (cx, cy, s) => {
      g.fillStyle = fg;
      g.beginPath(); g.moveTo(cx, cy - s); g.bezierCurveTo(cx + s * 0.9, cy - s * 0.3, cx + s * 0.5, cy + s * 0.6, cx, cy + s);
      g.bezierCurveTo(cx - s * 0.5, cy + s * 0.6, cx - s * 0.9, cy - s * 0.3, cx, cy - s); g.fill();
      g.fillStyle = bg; g.beginPath(); g.ellipse(cx, cy + s * 0.1, s * 0.22, s * 0.42, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = accent || fg; circle(g, cx, cy + s * 0.1, s * 0.12);
      for (const sx of [-1, 1]) { g.fillStyle = fg; g.beginPath(); g.ellipse(cx + sx * s * 0.75, cy + s * 0.55, s * 0.28, s * 0.12, sx * 0.7, 0, Math.PI * 2); g.fill(); }
    };
    const s = w / 4.2;
    wrap(g, w, h, (ox, oy) => { motif(w * 0.25 + ox, h * 0.25 + oy, s); motif(w * 0.75 + ox, h * 0.75 + oy, s); });
    g.fillStyle = accent || fg;
    wrap(g, w, h, (ox, oy) => { for (const [x, y] of [[0.75, 0.25], [0.25, 0.75]]) { g.beginPath(); g.moveTo(w * x + ox, h * y - 6 + oy); g.lineTo(w * x + 5 + ox, h * y + oy); g.lineTo(w * x + ox, h * y + 6 + oy); g.lineTo(w * x - 5 + ox, h * y + oy); g.fill(); } });
  },

  /** Roof shingles: offset rows of rounded tabs. */
  shingles: ({ a, b, line }) => (g, w, h) => {
    const rows = 6; const cols = 4; const rh = h / rows; const cw = w / cols;
    g.fillStyle = line; g.fillRect(0, 0, w, h);
    for (let j = 0; j < rows; j++) for (let i = -1; i <= cols; i++) {
      const x = i * cw + (j % 2) * cw / 2; const y = j * rh;
      g.fillStyle = (i + j * 3) % 5 === 0 ? b : a;
      g.beginPath(); g.moveTo(x + 2, y); g.lineTo(x + cw - 2, y); g.lineTo(x + cw - 2, y + rh * 0.55);
      g.quadraticCurveTo(x + cw / 2, y + rh * 1.15, x + 2, y + rh * 0.55); g.closePath(); g.fill();
    }
  },

  /** A supermarket shelf front: rows of product boxes/jars/cans in bright colours (repeats sideways). */
  products: ({ cols, rows = 1, bg = '#f4efe6', ink = '#2a2730' }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const rh = h / rows;
    for (let j = 0; j < rows; j++) {
      let x = 0; const y0 = j * rh;
      while (x < w - 4) {
        const kind = r.int(3); const c = cols[r.int(cols.length)]; const c2 = cols[r.int(cols.length)];
        const pw = Math.min(w - x, kind === 1 ? rh * 0.32 : rh * (0.38 + r() * 0.22)); const ph = rh * (0.6 + r() * 0.32);
        const yb = y0 + rh - 2;
        g.fillStyle = c;
        if (kind === 1) { g.fillRect(x + 1, yb - ph, pw - 2, ph); g.fillStyle = '#f8f5ee'; g.fillRect(x + 1, yb - ph * 0.7, pw - 2, ph * 0.3); g.fillStyle = c2; circle(g, x + pw / 2, yb - ph * 0.55, pw * 0.18); }
        else if (kind === 2) { g.fillRect(x + 2, yb - ph * 0.82, pw - 4, ph * 0.82); g.fillStyle = shadeC(c, -0.3); g.fillRect(x + pw * 0.3, yb - ph, pw * 0.4, ph * 0.2); g.fillStyle = '#f8f5ee'; g.fillRect(x + 2, yb - ph * 0.55, pw - 4, ph * 0.22); }
        else { g.fillRect(x + 1, yb - ph, pw - 2, ph); g.fillStyle = c2; g.fillRect(x + 1, yb - ph, pw - 2, ph * 0.22); g.fillStyle = '#f8f5ee'; circle(g, x + pw / 2, yb - ph * 0.5, Math.min(pw, ph) * 0.2); }
        g.fillStyle = ink; g.fillRect(x, yb - ph, 1.5, ph);
        x += pw + 1;
      }
      g.fillStyle = ink; g.fillRect(0, y0 + rh - 2, w, 2);
    }
  },

  /** Fruit crate top: piles of round fruit (repeat). */
  fruit: ({ bg, cols, n = 26, leaf = '#3fa66b' }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const x = r() * w; const y = r() * h; const rad = w * (0.07 + r() * 0.03); const c = cols[i % cols.length];
      wrap(g, w, h, (ox, oy) => {
        g.fillStyle = shadeC(c, -0.25); circle(g, x + ox + 1.5, y + oy + 1.5, rad);
        g.fillStyle = c; circle(g, x + ox, y + oy, rad);
        g.fillStyle = 'rgba(255,255,255,0.45)'; circle(g, x + ox - rad * 0.35, y + oy - rad * 0.35, rad * 0.25);
        g.fillStyle = leaf; g.fillRect(x + ox - 1, y + oy - rad - 2, 3, 4);
      });
    }
  },

  /** Ceiling grid / pegboard / graph paper: lines every 1/n. */
  grid: ({ bg, line, n = 4, lw = 2, dot = null }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = line;
    for (let i = 0; i < n; i++) { g.fillRect(i * w / n, 0, lw, h); g.fillRect(0, i * h / n, w, lw); }
    if (dot) { g.fillStyle = dot; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) circle(g, (i + 0.5) * w / n, (j + 0.5) * h / n, w / n * 0.12); }
  },

  /** Terrazzo: chips of colour on a pale ground. */
  terrazzo: ({ bg, cols, n = 70 }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const x = r() * w; const y = r() * h; const s = 2 + r() * 6; const a = r() * 3; const c = cols[i % cols.length];
      wrap(g, w, h, (ox, oy) => { g.fillStyle = c; g.beginPath(); g.moveTo(x + ox + Math.cos(a) * s, y + oy + Math.sin(a) * s); g.lineTo(x + ox + Math.cos(a + 2.1) * s * 0.8, y + oy + Math.sin(a + 2.1) * s * 0.8); g.lineTo(x + ox + Math.cos(a + 4.2) * s * 0.9, y + oy + Math.sin(a + 4.2) * s * 0.9); g.fill(); });
    }
  },

  /** A sign with big text (not repeating). */
  sign: ({ bg, fg, text, sub = '', border = null, font = 'bold', shape = 'rect' }) => (g, w, h) => {
    g.fillStyle = border || fg; g.fillRect(0, 0, w, h);
    g.fillStyle = bg;
    if (shape === 'round') { g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 6, h / 2 - 6, 0, 0, Math.PI * 2); g.fill(); } else g.fillRect(6, 6, w - 12, h - 12);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = Math.floor(h * (sub ? 0.42 : 0.56));
    g.font = `${font} ${fs}px "Arial Black", Arial, sans-serif`;
    while (fs > 8 && g.measureText(text).width > w - 24) { fs -= 2; g.font = `${font} ${fs}px "Arial Black", Arial, sans-serif`; }
    g.fillText(text, w / 2, sub ? h * 0.4 : h * 0.53);
    if (sub) { g.font = `bold ${Math.floor(h * 0.18)}px Arial, sans-serif`; g.fillText(sub, w / 2, h * 0.76); }
  },

  /** Glass pane: tint with diagonal sheen streaks (repeat). */
  glass: ({ tint, sheen = 'rgba(255,255,255,0.55)', frame = null, n = 1 }) => (g, w, h) => {
    g.fillStyle = tint; g.fillRect(0, 0, w, h);
    g.fillStyle = sheen;
    for (const [a, wd] of [[0.15, 0.08], [0.3, 0.03], [0.62, 0.05]]) { g.beginPath(); g.moveTo(w * a, h); g.lineTo(w * (a + wd), h); g.lineTo(w * (a + wd + 0.35), 0); g.lineTo(w * (a + 0.35), 0); g.closePath(); g.fill(); }
    if (frame) { g.fillStyle = frame; for (let i = 0; i < n; i++) { g.fillRect(i * w / n, 0, 4, h); g.fillRect(0, i * h / n, w, 4); } }
  },

  /** Diagonal lattice (trellis / fence) over a background. */
  lattice: ({ bg, fg, n = 4, lw = 0.16 }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = (w / n) * lw; g.lineCap = 'square';
    for (let i = -n; i <= n * 2; i++) {
      g.beginPath(); g.moveTo(i * w / n, 0); g.lineTo(i * w / n + w, h); g.stroke();
      g.beginPath(); g.moveTo(i * w / n, 0); g.lineTo(i * w / n - w, h); g.stroke();
    }
  },

  /** Marble: pale ground with soft veins (repeat). */
  marble: ({ bg, vein, vein2 }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (const [c, lw, n] of [[vein2 || vein, 5, 3], [vein, 1.6, 5]]) {
      g.strokeStyle = c; g.lineWidth = lw;
      for (let i = 0; i < n; i++) {
        const pts = []; let x = r() * w; const dx = (r() - 0.5) * 0.9;
        for (let k = 0; k <= 12; k++) { pts.push([x, (k * h) / 12]); x += (dx * h) / 12 + (r() - 0.5) * 12; }
        wrap(g, w, h, (ox, oy) => { g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy))); g.stroke(); });
      }
    }
  },

  /** Argyle diamonds with a dashed overcheck. */
  argyle: ({ a, b, c, line }) => (g, w, h) => {
    g.fillStyle = a; g.fillRect(0, 0, w, h);
    const dia = (cx, cy, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(cx, cy - h / 2); g.lineTo(cx + w / 4, cy); g.lineTo(cx, cy + h / 2); g.lineTo(cx - w / 4, cy); g.closePath(); g.fill(); };
    dia(w / 4, h / 2, b); dia(w * 3 / 4, h / 2, c); dia(w * 3 / 4, -h / 2, c); dia(w * 3 / 4, h * 1.5, c); dia(w / 4, -h / 2, b); dia(w / 4, h * 1.5, b);
    g.strokeStyle = line; g.lineWidth = 2; g.setLineDash([6, 5]);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.moveTo(w / 2, 0); g.lineTo(w, h / 2); g.lineTo(w / 2, h); g.lineTo(0, h / 2); g.closePath(); g.stroke();
    g.setLineDash([]);
  },

  /** Fish scales / scallops. */
  scales: ({ a, b, line }) => (g, w, h) => {
    g.fillStyle = a; g.fillRect(0, 0, w, h);
    const n = 4; const s = w / n;
    for (let j = -1; j <= n * 2; j++) for (let i = -1; i <= n; i++) {
      const x = i * s + (j % 2 ? s / 2 : 0); const y = j * s / 2;
      g.fillStyle = line; circle(g, x, y, s / 2);
      g.fillStyle = (i + j) % 3 === 0 ? b : a; circle(g, x, y, s / 2 - 2.5);
    }
  },

  /** Little flowers scattered on a ground (curtains, quilts, seed packets). */
  floral: ({ bg, cols, leaf, n = 16 }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const x = r() * w; const y = r() * h; const s = w * (0.035 + r() * 0.02); const c = cols[i % cols.length];
      wrap(g, w, h, (ox, oy) => {
        if (leaf) { g.fillStyle = leaf; g.beginPath(); g.ellipse(x + ox + s * 1.4, y + oy + s * 0.6, s, s * 0.45, 0.6, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = c; for (let k = 0; k < 5; k++) { const a = k * 1.2566; circle(g, x + ox + Math.cos(a) * s * 0.8, y + oy + Math.sin(a) * s * 0.8, s * 0.6); }
        g.fillStyle = '#ffd23f'; circle(g, x + ox, y + oy, s * 0.4);
      });
    }
  },

  /** Diagonal candy stripes. */
  diag: ({ cols, n = 4 }) => (g, w, h) => {
    const k = cols.length * n; const s = (w + h) / k;
    for (let i = -k; i < k * 2; i++) {
      g.fillStyle = cols[((i % cols.length) + cols.length) % cols.length];
      g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s + s, 0); g.lineTo(i * s + s - h, h); g.lineTo(i * s - h, h); g.closePath(); g.fill();
    }
  },

  /** Little pictures (not repeating): 'portrait' | 'landscape' | 'cat' | 'still' | 'stars' | 'dino' | 'wave' */
  pic: ({ kind, cols, bg }) => (g, w, h, r) => {
    const [c0, c1, c2, c3] = cols;
    g.fillStyle = bg || '#f3ece0'; g.fillRect(0, 0, w, h);
    if (kind === 'portrait') {
      g.fillStyle = c0; g.fillRect(0, 0, w, h);
      g.fillStyle = c1; g.beginPath(); g.ellipse(w / 2, h * 1.02, w * 0.38, h * 0.36, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = c2; g.beginPath(); g.ellipse(w / 2, h * 0.45, w * 0.2, h * 0.24, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = c3; g.beginPath(); g.ellipse(w / 2, h * 0.33, w * 0.23, h * 0.15, 0, Math.PI, 0); g.fill();
      g.fillStyle = '#2a2730'; circle(g, w * 0.44, h * 0.45, w * 0.02); circle(g, w * 0.56, h * 0.45, w * 0.02);
      g.strokeStyle = '#2a2730'; g.lineWidth = 2; g.beginPath(); g.arc(w / 2, h * 0.52, w * 0.06, 0.3, Math.PI - 0.3); g.stroke();
    } else if (kind === 'landscape') {
      g.fillStyle = c0; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd23f'; circle(g, w * 0.72, h * 0.3, w * 0.1);
      g.fillStyle = c1; g.beginPath(); g.moveTo(0, h * 0.7); g.lineTo(w * 0.35, h * 0.35); g.lineTo(w * 0.6, h * 0.62); g.lineTo(w * 0.8, h * 0.45); g.lineTo(w, h * 0.65); g.lineTo(w, h); g.lineTo(0, h); g.fill();
      g.fillStyle = c2; g.fillRect(0, h * 0.78, w, h * 0.22);
      g.fillStyle = '#f8f5ee'; g.beginPath(); g.moveTo(w * 0.28, h * 0.42); g.lineTo(w * 0.35, h * 0.35); g.lineTo(w * 0.42, h * 0.42); g.fill();
    } else if (kind === 'cat') {
      g.fillStyle = c0; g.fillRect(0, 0, w, h);
      g.fillStyle = c1; g.beginPath(); g.ellipse(w / 2, h * 0.6, w * 0.3, h * 0.26, 0, 0, Math.PI * 2); g.fill();
      for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(w / 2 + sx * w * 0.28, h * 0.48); g.lineTo(w / 2 + sx * w * 0.24, h * 0.22); g.lineTo(w / 2 + sx * w * 0.08, h * 0.38); g.fill(); }
      g.fillStyle = c2; circle(g, w * 0.4, h * 0.56, w * 0.05); circle(g, w * 0.6, h * 0.56, w * 0.05);
      g.fillStyle = '#2a2730'; circle(g, w * 0.4, h * 0.56, w * 0.02); circle(g, w * 0.6, h * 0.56, w * 0.02);
      g.fillStyle = c3; g.beginPath(); g.moveTo(w * 0.47, h * 0.65); g.lineTo(w * 0.53, h * 0.65); g.lineTo(w * 0.5, h * 0.69); g.fill();
    } else if (kind === 'still') {
      g.fillStyle = c0; g.fillRect(0, 0, w, h * 0.65); g.fillStyle = shadeC(c0, -0.2); g.fillRect(0, h * 0.65, w, h);
      g.fillStyle = c1; g.beginPath(); g.moveTo(w * 0.3, h * 0.7); g.quadraticCurveTo(w * 0.22, h * 0.3, w * 0.4, h * 0.25); g.lineTo(w * 0.44, h * 0.25); g.quadraticCurveTo(w * 0.6, h * 0.3, w * 0.52, h * 0.7); g.fill();
      g.fillStyle = c2; circle(g, w * 0.66, h * 0.64, w * 0.09); g.fillStyle = c3; circle(g, w * 0.78, h * 0.66, w * 0.07);
    } else if (kind === 'stars') {
      g.fillStyle = c0; g.fillRect(0, 0, w, h);
      g.strokeStyle = c1; g.lineWidth = Math.max(3, w * 0.025);
      for (let k = 0; k < 7; k++) { g.beginPath(); for (let a = 0; a < 18; a++) { const t = a / 17; const rr = w * (0.05 + k * 0.07) * (1 - t * 0.3); const ang = t * 5 + k; const x = w * 0.45 + Math.cos(ang) * rr; const y = h * 0.4 + Math.sin(ang) * rr * 0.7; if (a) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
      g.fillStyle = c2; for (let k = 0; k < 14; k++) circle(g, r() * w, r() * h * 0.7, 2 + r() * w * 0.025);
      g.fillStyle = c3; circle(g, w * 0.82, h * 0.18, w * 0.08);
      g.fillStyle = '#1b1b2a'; g.beginPath(); g.moveTo(w * 0.1, h); g.lineTo(w * 0.14, h * 0.5); g.lineTo(w * 0.2, h); g.fill();
      g.fillStyle = shadeC(c0, -0.35); g.fillRect(0, h * 0.85, w, h * 0.15);
    } else if (kind === 'wave') {
      g.fillStyle = c0; g.fillRect(0, 0, w, h);
      g.fillStyle = c1; g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * 0.6); g.bezierCurveTo(w * 0.3, h * 0.2, w * 0.7, h * 0.1, w * 0.75, h * 0.45); g.bezierCurveTo(w * 0.6, h * 0.35, w * 0.55, h * 0.55, w * 0.68, h * 0.6); g.lineTo(w, h * 0.72); g.lineTo(w, h); g.fill();
      g.fillStyle = c2; for (let k = 0; k < 9; k++) circle(g, w * (0.52 + k * 0.025), h * (0.32 + Math.sin(k) * 0.03), w * 0.025);
      g.fillStyle = c3; circle(g, w * 0.2, h * 0.25, w * 0.07);
    } else if (kind === 'dino') {
      g.fillStyle = c0; g.fillRect(0, 0, w, h);
      g.fillStyle = c1; g.beginPath(); g.ellipse(w * 0.45, h * 0.6, w * 0.25, h * 0.15, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(w * 0.62, h * 0.55); g.quadraticCurveTo(w * 0.75, h * 0.2, w * 0.8, h * 0.18); g.lineTo(w * 0.86, h * 0.22); g.quadraticCurveTo(w * 0.78, h * 0.3, w * 0.7, h * 0.62); g.fill();
      g.beginPath(); g.moveTo(w * 0.22, h * 0.6); g.quadraticCurveTo(w * 0.08, h * 0.62, w * 0.02, h * 0.75); g.lineTo(w * 0.24, h * 0.66); g.fill();
      g.fillRect(w * 0.32, h * 0.65, w * 0.05, h * 0.2); g.fillRect(w * 0.52, h * 0.65, w * 0.05, h * 0.2);
      g.fillStyle = c2; g.fillRect(0, h * 0.85, w, h * 0.15);
    }
  },

  /** Wooden crate slats (tintable greys). */
  slats: ({ n = 4 } = {}) => (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgb(200,200,200)';
    for (let i = 0; i < n; i++) g.fillRect(0, (i + 1) * h / n - 3, w, 3);
    g.fillStyle = 'rgb(225,225,225)'; g.fillRect(0, 0, 4, h); g.fillRect(w - 4, 0, 4, h);
  },

  /** Price-tag rail strip (yellow with tags). */
  tags: ({ bg, tag, ink }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) { g.fillStyle = tag; g.fillRect(i * w / 4 + 6, h * 0.15, w / 4 - 12, h * 0.7); g.fillStyle = ink; g.fillRect(i * w / 4 + 12, h * 0.4, w / 8, h * 0.2); }
  },

  /** Plaid / tartan (blanket, shirts). */
  plaid: ({ bg, a, b }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.65; g.fillStyle = a;
    g.fillRect(w * 0.1, 0, w * 0.3, h); g.fillRect(0, h * 0.1, w, h * 0.3);
    g.globalAlpha = 0.8; g.fillStyle = b;
    g.fillRect(w * 0.62, 0, w * 0.06, h); g.fillRect(0, h * 0.62, w, h * 0.06);
    g.fillRect(w * 0.84, 0, w * 0.02, h); g.fillRect(0, h * 0.84, w, h * 0.02);
    g.globalAlpha = 1;
  },
};

function shadeC(hex, k) {
  let s = hex.replace('#', ''); if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const v = parseInt(s, 16); const t = k < 0 ? 0 : 255; const a = Math.abs(k);
  const ch = (x) => Math.round(x + (t - x) * a);
  return '#' + [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => ch(x).toString(16).padStart(2, '0')).join('');
}
