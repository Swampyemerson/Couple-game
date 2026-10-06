// Boulder, Colorado for Getaway: geography (projection, terrain, roads, water, lots, landmarks,
// spawns). Pure data and maths, no THREE. Used by boulder.js / boulder-layout.js / boulder-build.js.
//
// PROJECTION. One uniform scale S = 0.45 of real distance, north = −z, east = +x. Origin is
// Broadway & Pearl (40.0182 N, 105.2795 W). x = (lon + 105.2795) · 85 200 · S,
// z = (40.0182 − lat) · 111 000 · S. Heights use the same 0.45, so the skyline keeps its true
// angles (Green Mountain from Pearl St rises ~12°, as it does in town).
//
// SOURCES (positions; the grid between them follows Boulder's 100-per-block address system,
// ~0.00114° of longitude per block downtown):
//   Boulder County Courthouse 40.0182, −105.2781 · Boulder Theater (2032 14th) 40.0186, −105.2774
//   Dushanbe Teahouse (1770 13th) 40.0155, −105.2773 · Main Library (1001 Arapahoe) 40.0140, −105.2818
//   Boulder High (1604 Arapahoe) 40.0136, −105.2739 · Folsom Field 40.009, −105.267
//   Chautauqua Auditorium 39.9976, −105.2796 · Twenty Ninth Street (1710 29th) 40.0179, −105.2559
//   Baseline Rd = the 40th parallel; Broadway × Baseline 39.99995, −105.2631
//   Table Mesa shops (3600 Table Mesa Dr) 39.9839, −105.2519 · Table Mesa Dr bridge over US-36
//   39.9863, −105.2347 · Moorhead Ave: 2905 39.9981,−105.2564; 3125 39.9972,−105.2543;
//   3325 39.9964,−105.2530; 3505 39.9949,−105.2503; 3625 39.9941,−105.2491;
//   3775 39.9925,−105.2463; 4095 39.9910,−105.2437; 4265 39.9903,−105.2424 (a straight line on
//   bearing 126°, parallel to US-36) · 3405 Martin Dr 39.9926,−105.2528 · 3099 Ash Ave
//   39.9938,−105.2562 · Front Range summits as in the Blend & Seek CU map (cuboulder.js).

export const S = 0.45;
export const LON0 = -105.2795;
export const LAT0 = 40.0182;
export const KX = 85200 * S; // metres of map per degree of longitude
export const KZ = 111000 * S; // per degree of latitude
export const P = (lat, lon) => [(lon - LON0) * KX, (LAT0 - lat) * KZ];
export const unP = (x, z) => [LAT0 - z / KZ, LON0 + x / KX];

export const BOUNDS = { x0: -690, z0: -475, x1: 1905, z1: 1785 };

// ── street lines (map metres) ────────────────────────────────────────────
export const X = {
  st4: -352, st6: -264, st9: -134, st11: -46, bwy: 0, st13: 42, st14: 88, st15: 130, st17: 218,
  st19: 307, st20: 349, st21: 395, folsom: 548, st29: 935, st28: 832, st30: 1035, foothills: 1253, st55: 1860,
};
export const Z = {
  balsam: -380, mapleton: -240, pine: -120, spruce: -60, alleyN: -30, pearl: 0, alleyS: 30, walnut: 60,
  canyon: 120, creek: 160, arapahoe: 200, college: 400, univ: 440, euclid: 584, colorado: 575, baseline: 909,
};

// US-36 runs on bearing ≈ 126° from Baseline/28th; Moorhead Ave is parallel, 48 m to the SW.
export const US36 = { x: 832, z: 909, dx: 0.809, dz: 0.588 }; // origin + unit direction (SE)
export const NE = [0.588, -0.809]; // unit normal pointing NE (left of SE travel)
export const usPt = (u, v = 0) => [US36.x + US36.dx * u + NE[0] * v, US36.z + US36.dz * u + NE[1] * v];
/** Moorhead centreline: v = −48 in the US-36 frame; `t` = metres along from the 2905 block's
 *  origin used below (so address n sits at t = 93 + (n − 2905) · 0.508). */
export const MOOR_V = -48;
export const moorPt = (t, off = 0) => usPt(t, MOOR_V + off); // t from (804, 948)
/** Address → t, piecewise through the surveyed house points (odd numbers, NE side). */
const MOOR_ADDR = [[2905, 39.998102, -105.25642], [3125, 39.99719, -105.25431], [3325, 39.9964, -105.25295], [3505, 39.99493, -105.25032], [3625, 39.9941222, -105.2490552], [3775, 39.9924959, -105.2462911], [4095, 39.990993, -105.243668], [4265, 39.99027, -105.24236]]
  .map(([n, la, lo]) => { const [x, z] = P(la, lo); const [ox, oz] = usPt(0, -48); return [n, (x - ox) * 0.809 + (z - oz) * 0.588]; });
export function moorAddrT(n) {
  const A = MOOR_ADDR; let i = 1; while (i < A.length - 1 && n > A[i][0]) i++;
  const [n0, t0] = A[i - 1]; const [n1, t1] = A[i]; return t0 + (t1 - t0) * (n - n0) / (n1 - n0);
}

// The home: 3865 Moorhead Ave, odd side (north-east side of the avenue, backing onto US-36).
export const HOME_T = moorAddrT(3865); // ≈ 581 along from (804, 948)
export const HOME = (() => { const [x, z] = moorPt(HOME_T, 14.5); return { x, z, rot: Math.atan2(US36.dx, US36.dz) }; })();

// ── terrain ────────────────────────────────────────────────────────────────
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth01 = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
/** x of the foot of the mountains (west of it the Front Range flank rises) by z. */
const FOOT = [[-475, -420], [100, -425], [300, -415], [600, -395], [909, -398], [1000, -335], [1200, -255], [1450, -175], [1785, -110]];
export function footX(z) {
  if (z <= FOOT[0][0]) return FOOT[0][1];
  for (let i = 1; i < FOOT.length; i++) {
    if (z <= FOOT[i][0]) { const [z0, x0] = FOOT[i - 1]; const [z1, x1] = FOOT[i]; return x0 + (x1 - x0) * (z - z0) / (z1 - z0); }
  }
  return FOOT[FOOT.length - 1][1];
}
/** Raw terrain (before roads are levelled into it). Flat city; University Hill, Chautauqua and
 *  south Boulder rise gently to the south-west; the Front Range flank west of the foot line;
 *  Boulder Canyon cuts the flank west along the creek; NCAR's Table Mesa bump in the south. */
export function rawHeight(x, z) {
  let h = 20 * smooth01((z - 230) / 650) * clamp01((560 - x) / 700);
  const dm = (x - 230) * (x - 230) + (z - 1600) * (z - 1600);
  if (dm < 300 * 300) h += 18 * Math.exp(-dm / (2 * 115 * 115));
  const d = footX(z) - x;
  if (d > -30) {
    const sp = d > 30 ? d : (d + 30) * (d + 30) / 120; // soft start
    let k = 0.21;
    const cz = Math.abs(z - 150); // Boulder Canyon floor
    if (cz < 70) k = 0.04 + 0.17 * smooth01((cz - 30) / 40);
    h += k * sp + (d > 260 ? (d - 260) * 0.25 : 0);
  }
  return h;
}

// ── roads ──────────────────────────────────────────────────────────────────
const L = (a, b, n) => { const out = []; for (let i = 0; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); return out; };
/** Straight road sampled every ~step m (the engine smooths with Catmull-Rom; dense straight
 *  points keep it straight and keep intersections where they belong). */
const line = (a, b, step = 60) => L(a, b, Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)));
const NS = (x, z0, z1) => line([x, z0], [x, z1]);
const EW = (z, x0, x1) => line([x0, z], [x1, z]);

const roads = [];
const add = (name, kind, width, pts, o = {}) => { roads.push({ name, kind, width, pts: pts.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]), ...o }); return roads[roads.length - 1]; };
/** A N–S street that crosses Boulder Creek on a bridge between Canyon and Arapahoe. */
function creekNS(name, kind, width, x, z0, z1, o = {}) {
  const b0 = 126; const b1 = 194;
  if (z0 < b0) add(name, kind, width, NS(x, z0, b0), o);
  add(name, kind, width, [[x, b0], [x, (b0 + b1) / 2], [x, b1]], { ...o, bridge: true, clear: 3 });
  if (z1 > b1) add(name, kind, width, NS(x, b1, z1), o);
}

// Downtown, Whittier, Mapleton Hill: E–W
add('Balsam Ave', 'street', 10, EW(Z.balsam, X.st4, X.folsom));
add('Mapleton Ave', 'street', 10, EW(Z.mapleton, X.st4, X.st28));
add('Pine St', 'street', 10, EW(Z.pine, X.st4, X.st28));
add('Spruce St', 'street', 10, EW(Z.spruce, X.st4, X.folsom));
add('Pearl St alley', 'alley', 5.5, EW(Z.alleyN, X.st9, X.st19));
add('Pearl St', 'street', 12, EW(Z.pearl, X.st4, X.st11));
add('Pearl St', 'arterial', 13, EW(Z.pearl, X.st15, X.st30));
add('Pearl St alley', 'alley', 5.5, EW(Z.alleyS, X.st9, X.st19));
add('Walnut St', 'street', 11, EW(Z.walnut, X.st9, X.st28));
add('Canyon Blvd', 'arterial', 18, [...EW(Z.canyon, X.st30, -300).slice(0, -1), [-300, 120], [-345, 124], [-378, 133], [-404, 142]]);
add('Arapahoe Ave', 'arterial', 14, EW(Z.arapahoe, -330, X.st55));
add('Arapahoe Ave', 'arterial', 14, [[-330, 200], [-352, 192], [-372, 178], [-388, 160], [-404, 142]], { bridge: true, clear: 3 });
add('Pearl Pkwy', 'arterial', 16, [[X.st30, 0], [1090, -22], [1160, -55], [1253, -100], [1340, -140], [1450, -180], [1560, -210], [1680, -235], [1790, -250], [X.st55, -258]]);
add('Valmont Rd', 'arterial', 14, [[X.folsom, Z.balsam], [620, -392], [700, -402], [832, -412], [940, -420], [1035, -426], [1150, -431], [1253, -435], [1400, -440], [1550, -442], [1700, -443], [X.st55, -443]]);
// N–S
add('4th St', 'street', 9, NS(X.st4, Z.balsam, Z.canyon));
add('6th St', 'street', 9, NS(X.st6, Z.mapleton, Z.canyon));
creekNS('9th St', 'street', 10, X.st9, Z.balsam, Z.baseline);
add('11th St', 'street', 9, NS(X.st11, Z.mapleton, Z.canyon));
creekNS('Broadway', 'arterial', 16, X.bwy, Z.balsam, 194);
add('Broadway', 'arterial', 16, [[0, 194], [0, 240], [6, 285], [24, 340], [52, 382], [80, 420], [112, 462], [148, 520], [184, 570], [222, 622], [268, 680], [320, 735], [380, 785], [450, 828], [530, 868], [629, 909], [664, 965], [700, 1030], [742, 1110], [790, 1200], [840, 1300], [890, 1400], [940, 1500], [990, 1590], [1047, 1683]]);
add('13th St', 'street', 9, NS(X.st13, Z.mapleton, Z.alleyN));
add('13th St', 'street', 9, NS(X.st13, Z.alleyS, Z.canyon));
add('14th St', 'street', 9, NS(X.st14, Z.mapleton, Z.alleyN));
add('14th St', 'street', 9, NS(X.st14, Z.alleyS, Z.canyon));
add('15th St', 'street', 9, NS(X.st15, Z.mapleton, Z.canyon));
creekNS('17th St', 'street', 10, X.st17, Z.balsam, Z.univ);
add('19th St', 'street', 9, NS(X.st19, Z.balsam, Z.canyon));
add('21st St', 'street', 9, NS(X.st21, Z.mapleton, Z.canyon));
creekNS('Folsom St', 'arterial', 14, X.folsom, Z.balsam, Z.colorado);
creekNS('28th St', 'arterial', 20, X.st28, -412, Z.baseline);
add('29th St', 'street', 10, NS(X.st29, Z.pearl, Z.canyon));
creekNS('30th St', 'arterial', 14, X.st30, -426, Z.baseline);
creekNS('Foothills Pkwy', 'arterial', 16, X.foothills, -435, Z.baseline);
add('Foothills Pkwy', 'arterial', 16, [[X.foothills, Z.baseline], [1255, 980], [1262, 1050], [1280, 1120], [1310, 1185], [1350, 1250], [1395, 1305], usPt(745, 11), usPt(800, 5)]);
creekNS('55th St', 'arterial', 12, X.st55, -443, 1655);
// University Hill + CU
add('College Ave', 'street', 9, EW(Z.college, X.st9, 50));
add('University Ave', 'street', 10, [...EW(Z.univ, X.st9, 92), [150, 440], [218, 440], [290, 428], [360, 405], [430, 384], [500, 380], [X.folsom, 380]]);
add('Aurora Ave', 'street', 9, EW(620, X.st9, 220));
add('', 'street', 9, EW(760, X.st9, 345));
add('13th St', 'street', 9, NS(X.st13, Z.college, Z.baseline));
add('15th St', 'street', 9, NS(X.st15, 505, Z.baseline));
add('17th St', 'street', 9, NS(X.st17, 620, Z.baseline));
add('20th St', 'street', 9, NS(X.st20, 760, Z.baseline));
add('Euclid Ave', 'street', 11, [[186, 573], [240, 586], [300, 590], [380, 590], [460, 588], [520, 582], [X.folsom, Z.colorado]]);
add('Colorado Ave', 'street', 12, EW(Z.colorado, X.folsom, X.foothills));
add('Regent Dr', 'street', 11, [[450, 828], [500, 790], [550, 745], [600, 700], [650, 655], [705, 612], [770, 578]]);
add('Baseline Rd', 'arterial', 16, [[-418, Z.baseline], ...EW(Z.baseline, -380, X.st55)]);
// Chautauqua (Kinnikinic Rd loop) + Flagstaff Rd switchbacks up to the summit loop
add('Kinnikinic Rd', 'street', 7, [[-52, 909], [-50, 950], [-62, 990], [-100, 1012], [-150, 1006], [-185, 978], [-196, 940], [-200, 909]]);
export const FLAGSTAFF = [[-418, 909], [-436, 872], [-450, 830], [-460, 790], [-466, 758], [-478, 734], [-498, 726], [-514, 740], [-519, 772], [-524, 812], [-532, 848], [-548, 866], [-570, 864], [-584, 844], [-590, 806], [-596, 766], [-604, 726], [-614, 700], [-630, 690], [-646, 700], [-654, 726], [-656, 760], [-654, 800]];
add('Flagstaff Rd', 'street', 8, FLAGSTAFF);
add('Flagstaff Summit Rd', 'street', 7, (() => { const c = [-650, 838]; const pts = []; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + Math.PI * 0.5; pts.push([c[0] + Math.cos(a) * 40, c[1] - Math.sin(a) * 34]); } return pts; })(), { closed: true });
// Boulder Creek Path: a bike path (alley) on the south bank, under every bridge
export const CREEK = [[-690, 152], [-600, 150], [-520, 151], [-450, 153], [-380, 156], [-300, 157], [-200, 158], [-100, 159], [0, 160], [100, 161], [200, 162], [300, 162], [400, 163], [500, 164], [600, 164], [700, 164], [832, 164], [935, 162], [1035, 160], [1150, 158], [1253, 156], [1400, 152], [1550, 150], [1700, 148], [1905, 146]];
add('Boulder Creek Path', 'alley', 5, [[-424, 168], [-380, 170], ...CREEK.filter(([x]) => x > -350 && x < 990).map(([x, z]) => [x, z + 10]), [990, 175], [1008, 186], [1014, 196]], { traffic: false });
// South Boulder: US-36 (the Boulder Turnpike), Moorhead + Martin Acres, Table Mesa, NCAR
export const US36_PTS = [[X.st28, Z.baseline], ...[60, 160, 260, 360, 460, 560, 660, 760, 860, 960, 1060, 1160, 1260].map((u) => usPt(u)), [X.st55, usPt(1272)[1]]];
add('US-36 Boulder Turnpike', 'highway', 24, US36_PTS, { lanes: 2 });
export const MOOR_T0 = -66;
export const MOOR_T1 = 954;
const moorPts = []; for (let t = MOOR_T0; t <= MOOR_T1; t += 60) moorPts.push(moorPt(Math.min(t, MOOR_T1)));
if (moorPts[moorPts.length - 1][0] !== moorPt(MOOR_T1)[0]) moorPts.push(moorPt(MOOR_T1));
moorPts[0] = [moorPt(MOOR_T0)[0], Z.baseline];
add('Moorhead Ave', 'street', 9, [...moorPts, [1594, 1545], [1600, 1574]]);
// Martin Acres: avenues parallel to Moorhead (SW of it), numbered streets square to it
export const MARTIN = { mid: 70, martin: 140, west: 210 }; // SW of Moorhead (3405 Martin Dr surveys at 140)
export const CROSS = [['32nd St', 3200], ['35th St', 3500], ['38th St', 3800], ['40th St', 4000], ['43rd St', 4300], ['46th St', 4600]];
add('Table Mesa Dr', 'arterial', 16, [[480, 1730], [560, 1726], [650, 1718], [750, 1708], [850, 1698], [950, 1690], [1047, 1683], [1130, 1670], [1210, 1658], [1290, 1645], [1370, 1628], [1450, 1610], [1530, 1592], [1630, 1570]]);
add('Table Mesa Dr', 'arterial', 16, [[1630, 1570], [1670, 1559], [1710, 1549], [1750, 1538], [1792, 1527]], { bridge: true });
add('Table Mesa Dr', 'arterial', 16, [[1792, 1527], [1815, 1521], [X.st55, 1514]]);
add('US-36 on-ramp', 'ramp', 8, [[1815, 1521], usPt(1100, 60), usPt(1040, 30), usPt(980, 13), usPt(920, 4)]);
add('US-36 off-ramp', 'ramp', 8, [usPt(1238, 4), usPt(1205, 22), usPt(1180, 50), [1815, 1521]]);
add('NCAR Rd', 'street', 9, [[480, 1730], [440, 1712], [400, 1684], [362, 1652], [326, 1626], [292, 1608]]);
add('NCAR mesa loop', 'street', 8, (() => { const c = [252, 1600]; const pts = []; for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; pts.push([c[0] + Math.cos(a) * 40, c[1] + Math.sin(a) * 32]); } return pts; })(), { closed: true });
add('', 'street', 9, [...NS(420, Z.baseline, 1500), [430, 1560], [452, 1640], [470, 1700], [480, 1730]]);
add('', 'street', 9, [...EW(1200, 420, 790)]);
add('', 'street', 9, EW(1050, 420, 708));
add('26th St', 'street', 9, NS(690, Z.balsam - 14, Z.spruce));
add('33rd St', 'street', 9, NS(1145, Z.arapahoe, Z.baseline));
add('', 'street', 9, EW(330, X.st30, X.foothills));
add('', 'street', 9, EW(450, X.st30, X.foothills));
add('', 'street', 9, EW(700, X.st30, X.foothills));
add('', 'street', 9, EW(810, X.st30, X.foothills));
add('', 'street', 9, EW(1360, 420, 868));
add('', 'street', 9, EW(1560, 431, 976));
add('', 'street', 9, NS(610, Z.baseline, 1721));
add('', 'street', 9, EW(1060, 1262, X.st55));
add('', 'street', 9, NS(1400, Z.baseline, 1215));
add('', 'street', 9, NS(1720, Z.baseline, 1380));
add('', 'street', 9, EW(1380, 1560, X.st55));
// east Boulder
add('', 'street', 9, EW(1215, 1320, X.st55));
add('', 'street', 9, NS(1560, Z.baseline, 1380));
add('Discovery Dr', 'street', 10, [[X.foothills, 420], [1400, 420], [1560, 420], [1700, 420], [X.st55, 420]]);
creekNS('Pearl Pkwy frontage', 'street', 9, 1450, -180, 194);
add('Junction Pl', 'street', 9, NS(1140, -431, -48));

// Martin Acres: derived from the Moorhead frame (clipped to Broadway / Table Mesa / Baseline)
function segX(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]]; const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den; const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
const named = (n) => roads.filter((r) => r.name === n);
/** Clip the infinite line p + d·t (t in [ta, tb]) to the stretch between the first crossings of
 *  `walls` on either side of t = tm. */
function clipLine(p, d, ta, tb, tm, walls) {
  let lo = ta; let hi = tb;
  const A = [p[0] + d[0] * ta, p[1] + d[1] * ta]; const B = [p[0] + d[0] * tb, p[1] + d[1] * tb];
  for (const w of walls) for (let i = 0; i < w.pts.length - 1; i++) {
    const f = segX(A, B, w.pts[i], w.pts[i + 1]); if (f == null) continue;
    const t = ta + (tb - ta) * f; if (t < tm && t > lo) lo = t; if (t > tm && t < hi) hi = t;
  }
  return [lo, hi];
}
const BWY = named('Broadway').slice(-1); const TM = named('Table Mesa Dr').slice(0, 1); const BL = named('Baseline Rd');
const MA = named('Moorhead Ave');
for (const [key, name] of [['mid', ''], ['martin', 'Martin Dr'], ['west', '']]) {
  const off = -MARTIN[key];
  const p = moorPt(0, off); const d = [US36.dx, US36.dz];
  let [lo, hi] = clipLine(p, d, -800, 1600, 500, [...BWY, ...TM, ...BL]);
  if (key === 'mid') lo = Math.max(lo, moorAddrT(3200)); // starts at 32nd St, clear of Broadway × Baseline
  const pts = []; const n = Math.max(2, Math.round((hi - lo) / 60));
  for (let i = 0; i <= n; i++) { const t = lo + (hi - lo) * i / n; pts.push([p[0] + d[0] * t, p[1] + d[1] * t]); }
  add(name, 'street', key === 'west' ? 8 : 9, pts);
}
export const CROSS_ROADS = [];
for (const [name, addr] of CROSS) {
  const t = moorAddrT(addr); const p = moorPt(t); const d = [-NE[0], -NE[1]]; // towards the SW
  const [, hi] = clipLine(p, d, 0, 600, 1, [...BWY, ...TM]);
  const pts = []; const n = Math.max(2, Math.round(hi / 50));
  for (let i = 0; i <= n; i++) pts.push([p[0] + d[0] * hi * i / n, p[1] + d[1] * hi * i / n]);
  CROSS_ROADS.push(add(name, 'street', 8, pts));
}
void MA;

export const ROADS = roads;

// ── water ──────────────────────────────────────────────────────────────────
/** A ribbon polygon around a polyline, half width hw. */
export function ribbonPoly(pts, hw) {
  const left = []; const right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0]; const dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l; const nz = dx / l;
    left.push([pts[i][0] + nx * hw, pts[i][1] + nz * hw]); right.push([pts[i][0] - nx * hw, pts[i][1] - nz * hw]);
  }
  return [...left, ...right.reverse()];
}
export const CREEK_HW = 3.6;
export const WATER = [
  { poly: ribbonPoly(CREEK, CREEK_HW), name: 'Boulder Creek' },
  { poly: [[340, 532], [372, 528], [386, 540], [380, 556], [350, 560], [334, 548]], name: 'Varsity Pond' },
  { poly: [[1600, -340], [1660, -352], [1700, -330], [1690, -296], [1630, -290], [1596, -310]], name: 'Valmont pond' },
];

// ── open ground ──────────────────────────────────────────────────────────────
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const circ = (cx, cz, r, n = 12) => { const o = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; o.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } return o; };
export const MALL = { x0: -41, x1: 125, z0: -10, z1: 10 };
export const OPEN = [
  { kind: 'lot', poly: rect(MALL.x0, MALL.z0, -8.6, MALL.z1), name: 'Pearl St Mall', paint: 'brick' },
  { kind: 'lot', poly: rect(8.6, MALL.z0, MALL.x1, MALL.z1), name: 'Pearl St Mall', paint: 'brick' },
  { kind: 'lot', poly: rect(36, -27, 94, -10), name: 'Courthouse plaza', paint: 'brick' },
  { kind: 'lot', poly: circ(-440, 146, 26), name: 'Eben G. Fine Park', paint: 'asphalt' },
  { kind: 'lot', poly: rect(846, 12, 924, 108), name: 'Twenty Ninth St lot W', paint: 'asphalt' },
  { kind: 'lot', poly: rect(946, 12, 1024, 108), name: 'Twenty Ninth St lot E', paint: 'asphalt' },
  { kind: 'lot', poly: rect(930, 1694, 1032, 1762), name: 'Table Mesa shops lot', paint: 'asphalt' },
  { kind: 'lot', poly: rect(-125, 918, -66, 946), name: 'Chautauqua lot', paint: 'asphalt' },
  { kind: 'lot', poly: rect(560, 395, 610, 560), name: 'Stadium lot', paint: 'asphalt' },
  { kind: 'lot', poly: rect(650, 930, 760, 990), name: 'Basemar lot', paint: 'asphalt' },
  { kind: 'lot', poly: rect(560, 12, 700, 50), name: 'East Pearl lot', paint: 'asphalt' },
  { kind: 'lot', poly: rect(-330, 128, -260, 150), name: 'Canyon lot', paint: 'asphalt' },
  { kind: 'lot', poly: rect(1150, -40, 1230, 40), name: 'Boulder Junction lot', paint: 'asphalt' },
  { kind: 'lot', poly: rect(1265, 430, 1440, 520), name: 'Research Park lot', paint: 'asphalt' },
  { kind: 'dirt', poly: [[1560, -425], [1845, -425], [1845, -275], [1740, -270], [1560, -280]], name: 'Valmont Bike Park', paint: 'dirt' },
];
// the home's driveway (from Moorhead's NE curb to the garage)
OPEN.push({ kind: 'lot', name: '3865 Moorhead driveway', paint: 'concrete', poly: (() => {
  const c = []; for (const [t, v] of [[-12.2, 4.4], [-6.8, 4.4], [-6.8, 15.8], [-12.2, 15.8]]) c.push(moorPt(HOME_T + t, v)); return c;
})() });

// ── landmarks ──────────────────────────────────────────────────────────────
export const LANDMARKS = [
  { name: 'Pearl St Mall', x: 44, z: 0 },
  { name: 'Courthouse', x: 65, z: -38 },
  { name: 'Central Park', x: 40, z: 140 },
  { name: 'Boulder Creek Path', x: 300, z: 172 },
  { name: 'Boulder High', x: 262, z: 245 },
  { name: 'Norlin Quad', x: 290, z: 495 },
  { name: 'Folsom Field', x: 470, z: 470 },
  { name: 'Chautauqua', x: -80, z: 1010 },
  { name: 'Flatirons', x: -330, z: 1250 },
  { name: 'Flagstaff Rd', x: -540, z: 790 },
  { name: 'Twenty Ninth St', x: 935, z: 60 },
  { name: 'Boulder Junction', x: 1190, z: -10 },
  { name: 'Valmont', x: 1700, z: -360 },
  { name: 'Martin Acres', x: 1050, z: 1320 },
  { name: 'Table Mesa', x: 980, z: 1730 },
  { name: 'US-36 Turnpike', x: 1500, z: 1380 },
  { name: 'Williams Village', x: 1110, z: 990 },
  { name: 'NCAR mesa', x: 252, z: 1600 },
  { name: '3865 Moorhead', x: HOME.x, z: HOME.z, home: true },
];

// ── real vs map (for the sanity sheet and the test) ───────────────────────────
export const CHECKS = [
  ['Courthouse (centre)', 40.0182, -105.2781], ['Boulder Theater', 40.0186, -105.2774], ['Dushanbe Teahouse', 40.0155, -105.2773],
  ['Main Library', 40.0140, -105.2818], ['Boulder High', 40.0136, -105.2739], ['Folsom Field', 40.009, -105.267],
  ['Chautauqua Auditorium', 39.9976, -105.2796], ['Twenty Ninth Street', 40.0179, -105.2559], ['Broadway × Baseline', 39.99995, -105.2631],
  ['Table Mesa shops', 39.9839, -105.2519], ['Table Mesa bridge / US-36', 39.98634, -105.23468],
  ['2905 Moorhead', 39.998102, -105.25642], ['3505 Moorhead', 39.99493, -105.25032], ['3775 Moorhead', 39.99250, -105.24629],
  ['4095 Moorhead', 39.990993, -105.243668], ['3405 Martin Dr', 39.992578, -105.252798], ['3099 Ash Ave', 39.99381, -105.25616],
  ['First Flatiron', 39.99014, -105.29469], ['Green Mountain', 39.9822, -105.3019], ['Bear Peak', 39.96025, -105.29517], ['Flagstaff Mtn', 40.00165, -105.30749],
];
