// Boulder for Getaway: one 1024² canvas atlas of facade / roof / paving tiles (8 × 8 tiles of
// 128 px). Tiles are drawn light so the per-vertex colour tints the walls while windows stay
// dark. Each wall tile is ONE storey × three bays (or one whole small house front), so build()
// repeats tiles per storey and per 3-bay segment instead of stretching a whole facade.
export const TILE = 128;
export const COLS = 8;
const NAMES = [
  'white', 'brickShop', 'brickUpper', 'brickArch', 'stoneShop', 'stoneUpper', 'cuGround', 'cuUpper',
  'houseFront', 'houseSide', 'house2Front', 'vicFront', 'ranchFront', 'ranchSide', 'cottageFront', 'garageFront',
  'shopFront', 'officeUpper', 'glassUpper', 'aptUpper', 'towerUpper', 'boxWall', 'boxFront', 'schoolUpper',
  'roofTile', 'shingle', 'seats', 'rock', 'pavers', 'courtUpper', 'theaterFront', 'hotelUpper',
  'ncar', 'blank', 'turf', 'homeFront', 'soundwall', 'flowers', 'asphalt', 'concrete',
  'gantryA', 'gantryB', 'busAd', 'blade',
];
export const T = Object.fromEntries(NAMES.map((n, i) => [n, i]));
/** UV rect [u0, v0, u1, v1] of tile i, inset by 2 px against mip bleed (v up). */
export function tileUV(i) {
  const c = i % COLS; const r = Math.floor(i / COLS); const e = 2 / 1024;
  const u0 = c / COLS + e; const u1 = (c + 1) / COLS - e;
  const v1 = 1 - r / COLS - e; const v0 = 1 - (r + 1) / COLS + e;
  return [u0, v0, u1, v1];
}

function mul(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const WIN = '#3b4658'; const WIN_HI = '#7d8ea3'; const FRAME = '#f4efe6'; const DARK = '#2c2a2e';

/** Returns a canvas (or null when there is no DOM). */
export function* atlasGen({ night = false } = {}) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 1024;
  const g = cv.getContext('2d'); if (!g || !g.fillRect) return null;
  const r = mul(1855);
  const r2 = mul(77);
  const GL = () => (night && r2() < 0.55 ? (r2() < 0.5 ? '#ffd27a' : '#ffe9b0') : WIN);
  const at = (i, fn) => { const c = i % COLS; const rr = Math.floor(i / COLS); g.save(); g.translate(c * TILE, rr * TILE); g.beginPath(); g.rect(0, 0, TILE, TILE); g.clip(); fn(); g.restore(); };
  const S = TILE;
  const fill = (c, x = 0, y = 0, w = S, h = S) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const win = (x, y, w, h, o = {}) => {
    fill(o.frame || FRAME, x - 3, y - 3, w + 6, h + 6);
    fill(o.glass || GL(), x, y, w, h);
    g.fillStyle = WIN_HI; g.globalAlpha = 0.55; g.beginPath(); g.moveTo(x, y + h * 0.75); g.lineTo(x + w * 0.55, y); g.lineTo(x + w * 0.8, y); g.lineTo(x, y + h); g.fill(); g.globalAlpha = 1;
    if (o.mull !== false) { fill(o.frame || FRAME, x + w / 2 - 1, y, 2, h); if (h > w * 1.2) fill(o.frame || FRAME, x, y + h * 0.5 - 1, w, 2); }
    if (o.sill !== false) fill('#e9e2d3', x - 5, y + h + 2, w + 10, 4);
  };
  const arch = (x, y, w, h, o = {}) => {
    g.fillStyle = o.frame || FRAME; g.beginPath(); g.moveTo(x - 4, y + h + 3); g.lineTo(x - 4, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2 + 4, Math.PI, 0); g.lineTo(x + w + 4, y + h + 3); g.fill();
    g.fillStyle = GL(); g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.fill();
    fill(FRAME, x + w / 2 - 1, y + 2, 2, h - 2);
  };
  const brick = (base = '#f6f1ea', line = '#d9cfc2') => {
    fill(base);
    for (let y = 0, row = 0; y < S; y += 8, row++) {
      fill(line, 0, y, S, 1.5);
      for (let x = (row % 2) * 8; x < S; x += 16) fill(line, x, y, 1.5, 8);
      for (let k = 0; k < 10; k++) { g.globalAlpha = 0.08; fill(r() < 0.5 ? '#b9a898' : '#ffffff', r() * S, y + 1.5, 15, 6.5); g.globalAlpha = 1; }
    }
  };
  const stone = (base = '#f7eee4') => {
    fill(base);
    let y = 0;
    while (y < S) {
      const h = 9 + r() * 9; let x = -r() * 20;
      while (x < S) { const w = 14 + r() * 26; g.fillStyle = `rgba(${150 + r() * 60},${110 + r() * 40},${90 + r() * 30},${0.12 + r() * 0.14})`; g.fillRect(x + 1.5, y + 1.5, w - 3, h - 3); x += w; }
      fill('rgba(120,90,70,0.25)', 0, y + h - 1, S, 1.5); y += h;
    }
  };
  const siding = (base = '#fbf8f2', line = '#dcd5c8', step = 7) => { fill(base); for (let y = 0; y < S; y += step) { fill(line, 0, y, S, 1.5); fill('rgba(255,255,255,0.5)', 0, y + 1.5, S, 1); } };
  const sign = (y, h, c = '#ffffff') => { fill(c, 6, y, S - 12, h); fill('rgba(0,0,0,0.15)', 6, y + h - 2, S - 12, 2); };

  yield;
  at(T.white, () => fill('#ffffff'));
  // downtown brick: storefront + upper storeys (flat lintels / arched)
  yield;
  at(T.brickShop, () => {
    brick(); fill('#efe8dc', 0, 0, S, 14); fill('#d8cfc2', 0, 12, S, 3);
    for (let b = 0; b < 3; b++) { const x = 6 + b * 41; fill(DARK, x, 26, 36, 102); fill(GL(), x + 3, 29, 30, 70); fill(WIN_HI, x + 5, 31, 8, 40); fill('#f2ede2', x, 96, 36, 4); if (b === 1) fill('#4a3a2e', x + 11, 70, 14, 58); }
  });
  yield;
  at(T.brickUpper, () => { brick(); for (let b = 0; b < 3; b++) { const x = 13 + b * 41; fill('#efe8dc', x - 4, 22, 30, 6); win(x, 30, 22, 62); } fill('#e6ddd0', 0, S - 6, S, 6); });
  yield; // (the browser gets a turn every tile or two)
  at(T.brickArch, () => { brick(); for (let b = 0; b < 3; b++) { const x = 13 + b * 41; arch(x, 26, 22, 66); } fill('#e6ddd0', 0, S - 6, S, 6); });
  yield;
  at(T.stoneShop, () => {
    stone(); for (let b = 0; b < 3; b++) { const x = 6 + b * 41; fill(DARK, x, 28, 36, 100); fill(GL(), x + 3, 31, 30, 66); fill(WIN_HI, x + 5, 33, 8, 40); }
    fill('#efe6d6', 0, 14, S, 8);
  });
  yield;
  at(T.stoneUpper, () => { stone(); for (let b = 0; b < 3; b++) win(13 + b * 41, 28, 22, 60); });
  yield;
  at(T.cuGround, () => { stone('#f9efe3'); for (let b = 0; b < 3; b++) arch(10 + b * 41, 30, 28, 82, { frame: '#efe1cf' }); fill('rgba(140,80,50,0.3)', 0, S - 10, S, 10); });
  yield; // (the browser gets a turn every tile or two)
  at(T.cuUpper, () => { stone('#f9efe3'); for (let b = 0; b < 3; b++) { const x = 12 + b * 41; win(x, 30, 24, 56, { frame: '#efe1cf' }); } fill('rgba(140,80,50,0.25)', 0, 0, S, 7); });
  // houses (whole fronts)
  yield;
  at(T.houseFront, () => { siding(); win(12, 38, 26, 34); win(90, 38, 26, 34); fill('#ffffff', 50, 30, 28, 98); fill('#8a4b3a', 54, 36, 20, 92); fill('#d9b45a', 69, 80, 3, 3); fill('#e9e2d3', 0, S - 10, S, 10); });
  yield;
  at(T.houseSide, () => { siding(); win(50, 40, 26, 34); fill('#e9e2d3', 0, S - 10, S, 10); });
  yield;
  at(T.house2Front, () => { siding(); win(16, 14, 22, 36); win(90, 14, 22, 36); win(16, 74, 22, 34); fill('#ffffff', 74, 66, 30, 62); fill('#3f5a72', 78, 72, 22, 56); fill('#e9e2d3', 0, S - 6, S, 6); });
  yield; // (the browser gets a turn every tile or two)
  at(T.vicFront, () => {
    siding('#fbf8f2', '#d8cfc0', 6); win(18, 12, 18, 42); win(92, 12, 18, 42); win(18, 72, 18, 44); fill('#ffffff', 80, 66, 28, 62); fill('#5b3a52', 84, 72, 20, 56);
    g.fillStyle = '#ffffff'; for (let x = 0; x < S; x += 10) { g.beginPath(); g.arc(x + 5, 60, 4, 0, Math.PI); g.fill(); }
  });
  yield;
  at(T.ranchFront, () => { siding('#fbf8f2', '#e2dccf', 9); fill('#e8ddd0', 0, 92, S, 36); for (let y = 92; y < S; y += 6) fill('#d8cbb9', 0, y, S, 1); win(8, 40, 50, 32); win(100, 42, 20, 28); fill('#ffffff', 68, 34, 24, 94); fill('#6f8d6a', 71, 38, 18, 90); });
  yield;
  at(T.ranchSide, () => { siding('#fbf8f2', '#e2dccf', 9); fill('#e8ddd0', 0, 92, S, 36); win(52, 44, 24, 26); });
  yield;
  at(T.cottageFront, () => { fill('#f7f2ea'); for (let x = 0; x < S; x += 10) fill('#d8cdbd', x, 0, 3, S); win(14, 40, 24, 36, { frame: '#ffffff' }); win(90, 40, 24, 36, { frame: '#ffffff' }); fill('#ffffff', 50, 34, 28, 94); fill('#9a3b2f', 54, 40, 20, 88); });
  yield; // (the browser gets a turn every tile or two)
  at(T.garageFront, () => { siding(); fill('#ffffff', 10, 30, 108, 98); for (let y = 34; y < S; y += 16) { fill('#e4e0d8', 14, y, 100, 13); fill('#c9c3b8', 14, y + 13, 100, 2); } });
  yield;
  at(T.homeFront, () => { // 3865 Moorhead: picture window, red door, shutters, house number plaque
    siding('#fbf8f2', '#dfe7ea', 8); fill('#e8ddd0', 0, 100, S, 28); for (let y = 100; y < S; y += 6) fill('#d6c8b4', 0, y, S, 1);
    fill('#2f4f6a', 2, 36, 7, 40); fill('#2f4f6a', 61, 36, 7, 40); win(11, 38, 48, 36);
    fill('#ffffff', 74, 30, 26, 98); fill('#c0392b', 77, 34, 20, 94); fill('#f1c40f', 92, 78, 3, 3);
    fill('#1f2a33', 104, 44, 20, 12); g.fillStyle = '#ffffff'; g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.fillText('3865', 114, 54);
    fill('#2f4f6a', 104, 64, 4, 22); win(110, 64, 14, 22, { mull: false, sill: false });
  });
  // commercial
  yield;
  at(T.shopFront, () => { fill('#f6f2ea'); sign(6, 22); for (let b = 0; b < 3; b++) { const x = 4 + b * 41; fill('#d9d3c7', x, 34, 39, 94); fill(GL(), x + 3, 37, 33, 91); fill(WIN_HI, x + 6, 40, 8, 50); } });
  yield;
  at(T.officeUpper, () => { fill('#f3f1ec'); fill(GL(), 0, 30, S, 46); fill(WIN_HI, 0, 30, S, 6); for (let x = 0; x < S; x += 21) fill('#e8e6e0', x, 30, 3, 46); fill('#dcd8cf', 0, 84, S, 4); });
  yield; // (the browser gets a turn every tile or two)
  at(T.glassUpper, () => { fill('#8fa6b6'); for (let x = 0; x < S; x += 16) fill('#e6ecef', x, 0, 2, S); fill('#e6ecef', 0, 0, S, 3); fill('#e6ecef', 0, 64, S, 2); g.globalAlpha = 0.35; fill('#ffffff', 10, 6, 30, 50); g.globalAlpha = 1; });
  yield;
  at(T.aptUpper, () => { fill('#f6f1e8'); for (let b = 0; b < 3; b++) { const x = 8 + b * 41; win(x + 4, 24, 24, 48); fill('#cfc6b6', x - 2, 84, 40, 6); for (let k = 0; k < 6; k++) fill('#8e8577', x + k * 7, 72, 2, 12); fill('#8e8577', x - 2, 72, 40, 2); } });
  yield;
  at(T.towerUpper, () => { fill('#f2ede4'); for (let b = 0; b < 4; b++) win(8 + b * 31, 30, 18, 52, { mull: false }); fill('#ddd5c6', 0, S - 14, S, 14); });
  yield;
  at(T.boxWall, () => { fill('#f4f1ea'); for (let x = 0; x < S; x += 8) fill('#dcd7cc', x, 0, 2, S); fill('#cfc9bd', 0, 0, S, 10); });
  yield; // (the browser gets a turn every tile or two)
  at(T.boxFront, () => { fill('#f4f1ea'); sign(10, 30, '#ffffff'); fill('#d9d3c7', 30, 60, 68, 68); fill(GL(), 34, 64, 60, 64); fill('#d9d3c7', 63, 64, 2, 64); });
  yield;
  at(T.schoolUpper, () => { brick(); for (let b = 0; b < 3; b++) { const x = 12 + b * 41; g.fillStyle = '#efe8dc'; g.beginPath(); g.moveTo(x - 4, 96); g.lineTo(x - 4, 40); g.lineTo(x + 12, 20); g.lineTo(x + 28, 40); g.lineTo(x + 28, 96); g.fill(); g.fillStyle = GL(); g.beginPath(); g.moveTo(x, 92); g.lineTo(x, 42); g.lineTo(x + 12, 27); g.lineTo(x + 24, 42); g.lineTo(x + 24, 92); g.fill(); fill('#efe8dc', x + 11, 30, 2, 62); } });
  // roofs, ground, misc
  yield;
  at(T.roofTile, () => { fill('#f3e2d8'); for (let y = 0; y < S; y += 10) { for (let x = (y / 10 % 2) * 6; x < S; x += 12) { g.fillStyle = 'rgba(120,40,20,0.25)'; g.beginPath(); g.arc(x + 6, y + 10, 6, Math.PI, 0); g.fill(); } fill('rgba(90,30,15,0.35)', 0, y + 9, S, 1.5); } });
  yield;
  at(T.shingle, () => { fill('#f2f0ee'); for (let y = 0; y < S; y += 8) { for (let x = (y / 8 % 2) * 7; x < S; x += 14) fill('rgba(60,60,70,0.22)', x, y, 1.5, 8); fill('rgba(40,40,50,0.3)', 0, y + 7, S, 1.5); for (let k = 0; k < 5; k++) fill(`rgba(0,0,0,${r() * 0.12})`, r() * S, y, 14, 7); } });
  yield; // (the browser gets a turn every tile or two)
  at(T.seats, () => { fill('#e8e4dc'); for (let y = 0; y < S; y += 8) { fill('#d0c9bd', 0, y + 5, S, 3); for (let x = 0; x < S; x += 6) if (r() < 0.55) fill(['#e0b84a', '#2c2c2c', '#f0e9d8', '#c9a43a'][Math.floor(r() * 4)], x + 1, y + 1, 4, 4); } });
  yield;
  at(T.rock, () => { fill('#f2dccf'); for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${120 + r() * 50},${60 + r() * 30},${50 + r() * 20},${0.25 + r() * 0.3})`; g.lineWidth = 1 + r() * 2.5; g.beginPath(); const x = r() * S; g.moveTo(x, 0); g.bezierCurveTo(x + r() * 20 - 10, 40, x + r() * 20 - 10, 90, x + r() * 30 - 15, S); g.stroke(); } for (let i = 0; i < 300; i++) fill(`rgba(80,40,30,${r() * 0.15})`, r() * S, r() * S, 2, 2); });
  yield;
  at(T.pavers, () => { fill('#f1ddd0'); for (let y = 0; y < S; y += 10) { const off = (y / 10) % 2 ? 0 : 10; for (let x = -20 + off; x < S; x += 20) { fill(`rgba(${150 + r() * 40},${70 + r() * 30},${55 + r() * 20},${0.35 + r() * 0.25})`, x + 1, y + 1, 18, 8); } } for (let x = 0; x < S; x += 64) fill('rgba(240,230,215,0.9)', x, 0, 4, S); });
  yield;
  at(T.courtUpper, () => { fill('#fbf6ec'); for (let b = 0; b < 3; b++) { const x = 8 + b * 42; fill('#efe6d4', x - 6, 0, 6, S); fill(GL(), x + 6, 16, 22, 96); for (let y = 30; y < 112; y += 18) fill('#e6dcc8', x + 6, y, 22, 2); } });
  yield; // (the browser gets a turn every tile or two)
  at(T.theaterFront, () => { fill('#f6efdc'); fill('#2b2b38', 10, 40, 108, 30); g.fillStyle = '#f6d36b'; for (let x = 14; x < 118; x += 8) { g.beginPath(); g.arc(x, 44, 2, 0, 7); g.fill(); g.beginPath(); g.arc(x, 66, 2, 0, 7); g.fill(); } fill('#ffffff', 22, 50, 84, 10); for (let b = 0; b < 3; b++) fill(GL(), 14 + b * 36, 82, 26, 46); fill('#c9a646', 0, 0, S, 10); });
  yield;
  at(T.hotelUpper, () => { brick('#f6efe9', '#dcc8bc'); for (let b = 0; b < 3; b++) arch(14 + b * 41, 28, 20, 60, { frame: '#ffffff' }); fill('#ffffff', 0, S - 8, S, 8); });
  yield;
  at(T.ncar, () => { stone('#f5e1d6'); fill(GL(), 54, 0, 20, S); fill('#e7cbbd', 0, 0, 6, S); fill('#e7cbbd', S - 6, 0, 6, S); });
  yield;
  at(T.blank, () => { fill('#f5f2ec'); for (let i = 0; i < 400; i++) fill(`rgba(0,0,0,${r() * 0.05})`, r() * S, r() * S, 3, 3); });
  yield; // (the browser gets a turn every tile or two)
  at(T.turf, () => { fill('#ffffff'); for (let y = 0; y < S; y += 16) fill('#e6f0e0', 0, y, S, 8); });
  yield;
  at(T.soundwall, () => { fill('#f1ece2'); for (let x = 0; x < S; x += 32) { fill('#d6cfc1', x, 0, 3, S); } for (let y = 0; y < S; y += 16) fill('#e3dccf', 0, y, S, 2); });
  yield;
  at(T.flowers, () => { fill('#6f9a48'); for (let i = 0; i < 260; i++) { fill(['#e94f64', '#f2c14e', '#ffffff', '#b45fc4', '#f08a3c'][Math.floor(r() * 5)], r() * S, r() * S, 4, 4); } });
  yield;
  at(T.asphalt, () => { fill('#ffffff'); for (let i = 0; i < 500; i++) fill(`rgba(0,0,0,${r() * 0.08})`, r() * S, r() * S, 2, 2); });
  yield; // (the browser gets a turn every tile or two)
  at(T.concrete, () => { fill('#ffffff'); for (let x = 0; x < S; x += 32) fill('#d9d6cf', x, 0, 2, S); for (let y = 0; y < S; y += 32) fill('#d9d6cf', 0, y, S, 2); });
  // overhead highway signs (green, white legend, reflective border)
  const hwy = (lines, shield) => {
    fill('#1f6b45'); g.strokeStyle = '#f4f4ef'; g.lineWidth = 3; g.strokeRect(4, 4, S - 8, S - 8);
    if (shield) { // an interstate-style shield outline with the route number (generic, not a logo)
      g.fillStyle = '#f4f4ef'; g.beginPath(); g.moveTo(14, 18); g.lineTo(46, 18); g.lineTo(46, 40); g.quadraticCurveTo(46, 54, 30, 60); g.quadraticCurveTo(14, 54, 14, 40); g.closePath(); g.fill();
      g.fillStyle = '#1f2a33'; g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.fillText(shield, 30, 46);
    }
    g.fillStyle = '#f4f4ef'; g.textAlign = shield ? 'left' : 'center';
    lines.forEach(([t, sz, y]) => { g.font = `bold ${sz}px sans-serif`; g.fillText(t, shield ? 54 : S / 2, y); });
  };
  yield;
  at(T.gantryA, () => hwy([['EAST', 14, 34], ['Denver', 20, 58], ['Table Mesa Dr', 15, 92], ['1 MILE', 13, 114]], '36'));
  yield;
  at(T.gantryB, () => hwy([['Boulder', 24, 44], ['Baseline Rd', 18, 76], ['NEXT EXIT', 13, 104]], null));
  yield;
  at(T.busAd, () => {
    fill('#f3efe6'); fill('#2f6f8f', 6, 6, S - 12, S - 12); g.fillStyle = '#f2c14e'; g.beginPath(); g.arc(92, 40, 22, 0, 7); g.fill();
    g.fillStyle = '#ffffff'; g.font = 'bold 22px sans-serif'; g.textAlign = 'left'; g.fillText('HIKE', 14, 74); g.fillText('THE', 14, 96); g.fillText('MESA', 14, 118);
    g.fillStyle = '#3d6b3a'; g.beginPath(); g.moveTo(60, 122); g.lineTo(88, 84); g.lineTo(104, 104); g.lineTo(116, 92); g.lineTo(122, 122); g.fill();
  });
  yield; // (the browser gets a turn every tile or two)
  at(T.blade, () => { // four blade signs (one per quarter): generic shop words
    const W2 = S / 2; const words = [['BOOKS', '#7a1f24', '#f4e8d0'], ['CAFE', '#1f4a3f', '#f2c14e'], ['BIKES', '#24395e', '#ffffff'], ['TEA', '#5b2d5e', '#f4e8d0']];
    words.forEach(([t, bg, fg], k) => {
      const x = (k % 2) * W2; const y = Math.floor(k / 2) * W2;
      fill('#e9e2d3', x, y, W2, W2); fill(bg, x + 3, y + 3, W2 - 6, W2 - 6);
      g.save(); g.translate(x + W2 / 2, y + W2 / 2); g.rotate(-Math.PI / 2); g.fillStyle = fg; g.font = `bold ${t.length > 4 ? 13 : 17}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 0, 0); g.restore();
    });
  });
  return cv;
}
/** The atlas in one go (a generator above: buildBoulder() slices it). */
export function makeAtlas(o) { const it = atlasGen(o); for (;;) { const st = it.next(); if (st.done) return st.value; } }
