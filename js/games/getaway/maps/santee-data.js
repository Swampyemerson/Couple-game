// Santee map: hand-authored geography. Big features are given in REAL kilometres from the corner of
// Mission Gorge Rd and Cuyamaca St (x = east, z = south), converted at SCALE (0.4x: 1 real km = 400
// map metres). Neighbourhood streets are authored directly in map metres, at near-real lot sizes.
//
// Anchors (WGS84, converted with 1 deg lat = 110.9 km, 1 deg lon = 93.2 km at 32.84 N):
//   origin  Mission Gorge Rd x Cuyamaca St      32.8410, -116.9825
//   Santee trolley station (Copper/ex-Green Line) 32.8423, -116.9807  -> real (+0.17, -0.15)
//   West Hills High, 8756 Mast Blvd             32.8479, -117.0157  -> real (-3.10, -0.76)
//   Santana High, 9915 Magnolia Ave             32.8575, -116.9692  -> real (+1.24, -1.83)
//   Santee Lakes, 9310 Fanita Pkwy              32.8672, -117.0063  -> real (-2.22, -2.90)
//   Cowles Mountain summit                      32.8125, -117.0311  -> real (-4.53, +3.16)  (backdrop)
//   8524 Boulder Way (Prism at Weston, 2019): Mast Blvd > Weston Rd (north, opposite West Hills High)
//   > right on Toyon Pl > left on Boulder Way. Weston lies north of Mast between Medina Dr and West
//   Hills Pkwy. Boulder Way numbers are 8500-8534, even only (homes on one side).

export const SCALE = 400; // map metres per real km
const K = (pts) => pts.map(([x, z]) => [Math.round(x * SCALE * 10) / 10, Math.round(z * SCALE * 10) / 10]);
export const R = (x, z) => [x * SCALE, z * SCALE];

export const BOUNDS = { x0: -1600, z0: -1240, x1: 1100, z1: 650 };

// ── highways and arterials (real km) ────────────────────────────────────────────────────────────
export const MAJOR = [
  { name: 'SR-52', kind: 'highway', width: 26, pts: K([[-4.0, -0.92], [-3.8, -0.78], [-3.55, -0.55], [-3.3, -0.28], [-3.05, -0.02], [-2.8, 0.2], [-2.5, 0.36], [-2.15, 0.45], [-1.75, 0.58], [-1.3, 0.78], [-0.8, 0.98], [-0.4, 1.12], [0, 1.2], [0.5, 1.26], [1.0, 1.28], [1.42, 1.28], [1.8, 1.24], [2.1, 1.15], [2.3, 1.02]]) },
  { name: 'SR-67', kind: 'highway', width: 24, pts: K([[2.3, 1.02], [2.42, 0.78], [2.48, 0.5], [2.5, 0.1], [2.5, -0.4], [2.47, -1.0], [2.44, -1.6], [2.43, -2.0], [2.46, -2.5], [2.5, -3.1]]) },
  { name: 'SR-125', kind: 'highway', width: 24, pts: K([[-2.2, 1.63], [-2.19, 1.25], [-2.17, 0.85], [-2.15, 0.45], [-2.15, 0.2], [-2.15, 0.02]]) },
  { name: 'Mission Gorge Rd', kind: 'arterial', width: 22, pts: K([[-4.0, 0.8], [-3.7, 0.63], [-3.35, 0.46], [-3.0, 0.3], [-2.6, 0.12], [-2.15, 0.0], [-1.75, 0], [-1.3, 0], [-0.65, 0], [0, 0], [0.45, 0], [0.9, 0], [1.42, 0.02], [1.8, 0.1], [2.15, 0.26], [2.47, 0.42]]) },
  { name: 'Cuyamaca St', kind: 'arterial', width: 18, pts: K([[0, 1.62], [0, 1.2], [0, 0.62], [0, 0], [0, -0.47], [0, -1.0], [0, -1.55], [0.04, -2.1], [0.12, -2.6]]) },
  { name: 'Magnolia Ave', kind: 'arterial', width: 16, pts: K([[1.42, 1.62], [1.42, 1.28], [1.42, 0.62], [1.42, 0.02], [1.41, -0.55], [1.41, -1.2], [1.42, -1.9], [1.38, -2.4], [1.32, -2.75]]) },
  { name: 'Mast Blvd', kind: 'arterial', width: 18, pts: K([[-3.8, -0.78], [-3.6, -0.86], [-3.25, -0.98], [-2.85, -1.05], [-2.25, -1.18], [-1.8, -1.28], [-1.3, -1.38], [-0.7, -1.48], [0, -1.55], [0.6, -1.66], [1.0, -1.78], [1.42, -1.9], [1.8, -1.98], [2.2, -2.0], [2.43, -2.0]]) },
  { name: 'Carlton Hills Blvd', kind: 'arterial', width: 16, pts: K([[-1.3, 0], [-1.3, -0.3], [-1.3, -0.6], [-1.28, -0.95], [-1.3, -1.38], [-1.22, -1.8], [-1.08, -2.2], [-0.95, -2.55]]) },
  { name: 'Prospect Ave', kind: 'arterial', width: 14, pts: K([[0, 0.62], [0.5, 0.62], [0.9, 0.62], [1.42, 0.62], [1.9, 0.62], [2.48, 0.6]]) },
  { name: 'Town Center Pkwy', kind: 'arterial', width: 14, pts: K([[0, -0.34], [0.4, -0.34], [0.8, -0.33], [1.41, -0.32]]) },
  { name: 'Fanita Pkwy', kind: 'arterial', width: 14, pts: K([[-2.25, -1.18], [-2.23, -1.6], [-2.19, -2.0], [-2.16, -2.5], [-2.13, -2.98]]) },
  { name: 'Riverview Pkwy', kind: 'street', width: 12, pts: K([[0, -0.73], [0.5, -0.75], [1.0, -0.74], [1.41, -0.73]]) },
  { name: 'Fanita Dr', kind: 'street', width: 13, pts: K([[-1.75, 0], [-1.75, 0.3], [-1.75, 0.58], [-1.75, 1.0], [-1.76, 1.62]]) },
  { name: 'Carlton Oaks Dr', kind: 'street', width: 12, pts: K([[-1.28, -0.95], [-1.6, -0.9], [-1.95, -0.87], [-2.3, -0.89], [-2.6, -0.98], [-2.85, -1.05]]) },
  { name: 'Medina Dr', kind: 'street', width: 11, pts: K([[-2.85, -1.05], [-2.86, -1.3], [-2.83, -1.6], [-2.78, -1.9]]) },
  { name: 'West Hills Pkwy', kind: 'street', width: 13, pts: K([[-3.8, -0.78], [-3.84, -1.05], [-3.86, -1.35], [-3.8, -1.6], [-3.68, -1.75]]) },
  { name: 'Cottonwood Ave', kind: 'street', width: 12, pts: K([[0.9, 0], [0.9, 0.3], [0.9, 0.62], [0.92, 1.08], [1.15, 1.1], [1.42, 1.1]]) },
  // the old ranch roads in the Fanita hills: a dusty escape route along the north edge
  { name: 'Fanita Ranch Rd', kind: 'dirt', width: 9, pts: K([[-2.13, -2.98], [-1.6, -2.86], [-0.95, -2.55], [-0.4, -2.74], [0.12, -2.6], [0.7, -2.76], [1.32, -2.75], [1.9, -2.68], [2.47, -2.62]]) },
];

// ── the San Diego River (real km), west-flowing, mostly dry sand and reeds ──────────────────────
export const RIVER = K([[2.75, -0.62], [2.2, -0.6], [1.8, -0.565], [1.42, -0.55], [1.0, -0.52], [0.5, -0.48], [0, -0.47], [-0.5, -0.5], [-1.0, -0.56], [-1.3, -0.6], [-1.7, -0.62], [-2.1, -0.6], [-2.5, -0.5], [-2.85, -0.3], [-3.15, -0.05], [-3.45, 0.22], [-3.75, 0.45], [-4.05, 0.56]]);
export const RIVER_HALF = 26; // sand channel half-width (map m)

// ── tract zones (map m): where houses may go ────────────────────────────────────────────────────
// style: 'ranch' = 70s-90s stucco + red tile; 'prism' = Weston 2019 modern farmhouse; 'mobile' = mobile homes
export const ZONES = [
  { id: 'T1', style: 'ranch', poly: [[-505, -560], [-12, -630], [-12, -1010], [-380, -1010], [-430, -880], [-490, -720]] },
  { id: 'T2', style: 'ranch', poly: [[12, -632], [560, -768], [545, -1030], [12, -1010]] },
  { id: 'T3', style: 'ranch', poly: [[12, -430], [560, -430], [560, -600], [372, -600], [372, -745], [12, -625]] },
  { id: 'T4', style: 'ranch', poly: [[580, -258], [975, -258], [975, -1050], [575, -1050]] },
  { id: 'T5', style: 'ranch', poly: [[-690, 132], [-30, 132], [-30, 440], [-200, 400], [-450, 330], [-690, 245]] },
  { id: 'T5b', style: 'ranch', poly: [[-842, 132], [-715, 132], [-715, 215], [-842, 190]] },
  { id: 'T6', style: 'ranch', poly: [[30, 132], [945, 150], [945, 280], [690, 280], [690, 462], [30, 455]] },
  { id: 'T10', style: 'ranch', poly: [[-505, -306], [-12, -282], [-12, -622], [-505, -556]] },
  { id: 'T7', style: 'ranch', poly: [[-885, -365], [-525, -393], [-525, -540], [-885, -468]] },
  { id: 'T8', style: 'ranch', poly: [[-885, -490], [-505, -565], [-490, -720], [-430, -880], [-400, -1010], [-860, -1010]] },
  { id: 'T9', style: 'ranch', poly: [[-1132, -440], [-1068, -450], [-1068, -800], [-1132, -800]] },
  { id: 'W', style: 'prism', poly: [[-1535, -412], [-1150, -412], [-1150, -705], [-1535, -705]] },
  { id: 'MH', style: 'mobile', poly: [[705, 292], [930, 292], [930, 452], [705, 452]] },
];

// ── residential collector streets (map m). Ends are snapped onto the named road. ────────────────
// [name, width, pts, snapStart, snapEnd]
export const COLLECTORS = [
  ['Carefree Dr', 10, [[-506, -652], [-380, -682], [-250, -702], [-120, -692], [0, -702]], 'Carlton Hills Blvd', 'Cuyamaca St'],
  ['Settle Rd', 10, [[-418, -935], [-280, -952], [-140, -940], [16, -930]], 'Carlton Hills Blvd', 'Cuyamaca St'],
  ['Halberns Blvd', 10, [[10, -880], [140, -902], [280, -872], [420, -890], [556, -915]], 'Cuyamaca St', 'Magnolia Ave'],
  ['Rumson Dr', 10, [[0, -522], [130, -512], [260, -532], [400, -548], [564, -548]], 'Cuyamaca St', 'Magnolia Ave'],
  ['Park Center Dr', 10, [[140, -294], [145, -420], [150, -520]], 'Riverview Pkwy', 'Rumson Dr'],
  ['Lake Canyon Rd', 10, [[564, -452], [700, -458], [830, -432], [935, -440]], 'Magnolia Ave', null],
  ['Pepper Tree Ln', 10, [[762, -786], [762, -700], [792, -600], [762, -520], [722, -460]], 'Mast Blvd', 'Lake Canyon Rd'],
  ['Riverpark Dr', 10, [[564, -300], [700, -306], [850, -292], [945, -300]], 'Magnolia Ave', null],
  ['Magnolia Hills Dr', 10, [[552, -935], [700, -955], [850, -905], [950, -930]], 'Magnolia Ave', null],
  ['Buena Vista Ave', 10, [[-700, 170], [-550, 176], [-400, 190], [-250, 186], [-120, 200], [0, 205]], 'Fanita Dr', 'Cuyamaca St'],
  ['Summit Ave', 10, [[-450, 191], [-450, 262], [-380, 318], [-300, 346], [-150, 368], [0, 380]], 'Buena Vista Ave', 'Cuyamaca St'],
  ['Olive Ln', 10, [[0, 162], [150, 170], [360, 166], [568, 166], [750, 176], [940, 182]], 'Cuyamaca St', null],
  ['Graves Ave', 10, [[0, 362], [180, 366], [360, 352], [568, 372]], 'Cuyamaca St', 'Magnolia Ave'],
  ['Atlas View Dr', 10, [[-890, -640], [-780, -652], [-660, -702], [-560, -692], [-495, -700]], 'Fanita Pkwy', 'Carlton Hills Blvd'],
  ['Lake Canyon Dr', 10, [[-876, -935], [-700, -950], [-560, -925], [-415, -935]], 'Fanita Pkwy', 'Carlton Hills Blvd'],
  ['Mesa Rd', 10, [[-506, -420], [-380, -432], [-250, -412], [-120, -432], [0, -422]], 'Carlton Hills Blvd', 'Cuyamaca St'],
  ['Mobile Home Way', 8, [[705, 300], [820, 302], [925, 300]], null, null],
];

// ── Weston (map m): hand-placed from the real driving directions ────────────────────────────────
export const WESTON = {
  roads: [
    ['Weston Rd', 'street', 12, [[-1300, -395], [-1300, -432], [-1297, -472], [-1290, -515], [-1291, -560], [-1306, -598], [-1340, -626], [-1388, -638], [-1430, -624], [-1455, -590], [-1462, -548], [-1452, -500], [-1420, -462], [-1372, -440], [-1330, -433], [-1300, -432]]],
    ['Toyon Pl', 'street', 10, [[-1297, -472], [-1262, -474], [-1235, -475], [-1205, -473], [-1178, -470]]],
    ['Boulder Way', 'street', 10, [[-1235, -475], [-1236, -505], [-1235, -540], [-1229, -575], [-1216, -608], [-1198, -634], [-1182, -650]]],
    ['Yucca St', 'street', 10, [[-1291, -560], [-1340, -555], [-1390, -552], [-1440, -556], [-1462, -548]]],
    ['Sandstone Ct', 'street', 9, [[-1455, -590], [-1490, -600], [-1515, -620]]],
    ['Talus Ct', 'street', 9, [[-1452, -500], [-1488, -488], [-1515, -480]]],
  ],
  // the hero house: Boulder Way's homes are on its west side (even numbers 8500..8534 from Toyon Pl)
  boulderFirst: 8500, boulderLast: 8534, home: 8524,
  park: { poly: [[-1395, -455], [-1330, -450], [-1312, -470], [-1312, -530], [-1395, -530]] },
};

// ── commercial centres (map m) ──────────────────────────────────────────────────────────────────
// [x, z, w, d, rot, shops, opts] rect of the whole parcel; buildings go along the back (far from the
// street side, which is local -z / 'front').
export const CENTERS = [
  // Mission Gorge Rd, north side (front faces south: rot = PI so local -z points to +z... see layout)
  { x: -690, z: -72, w: 280, d: 104, face: 'S', shops: ['GAS', 'CAR WASH', 'TACO SHOP', 'TIRES'] },
  { x: -268, z: -78, w: 440, d: 116, face: 'S', shops: ['MARKET', 'PHARMACY', 'PIZZA', 'DONUT', 'BURGERS', 'NAILS'] },
  { x: 196, z: -72, w: 268, d: 104, face: 'S', shops: ['MARKET', 'HARDWARE', 'CINEMA', 'TACO SHOP'], trolley: true },
  { x: 450, z: -70, w: 200, d: 100, face: 'S', shops: ['MARKET'], big: true },
  // Mission Gorge Rd, south side
  { x: -690, z: 70, w: 280, d: 100, face: 'N', shops: ['MINI STORAGE'], storage: true },
  { x: -268, z: 72, w: 440, d: 104, face: 'N', shops: ['HARDWARE', 'TACO SHOP', 'PET SUPPLY', 'BANK', 'GAS'] },
  { x: 180, z: 70, w: 300, d: 100, face: 'N', shops: ['DONUT', 'LAUNDRY', 'NAILS', 'TACO SHOP', 'GAS'] },
  { x: 462, z: 70, w: 176, d: 100, face: 'N', shops: ['MARKET', 'PIZZA'] },
  { x: 770, z: -64, w: 300, d: 92, face: 'S', shops: ['AUTO PARTS', 'FEED STORE', 'MOTEL'] },
  { x: 770, z: 78, w: 300, d: 96, face: 'N', shops: ['GAS', 'TACO SHOP', 'DONUT'] },
  // Mast Blvd corners
  { x: 82, z: -682, w: 128, d: 76, face: 'S', shops: ['DONUT', 'GAS', 'MARKET'], rotTo: 'Mast Blvd' },
  { x: 650, z: -826, w: 120, d: 80, face: 'S', shops: ['TACO SHOP', 'MARKET'], rotTo: 'Mast Blvd' },
  { x: -590, z: -616, w: 110, d: 70, face: 'S', shops: ['GAS', 'DONUT'], rotTo: 'Mast Blvd' },
];

// ── parks, schools and specials (map m) ─────────────────────────────────────────────────────────
export const PARKS = [
  { name: 'Mast Park', kind: 'grass', poly: [[-640, -300], [-330, -290], [-330, -258], [-640, -262]] },
  { name: 'Town Center Park', kind: 'grass', poly: [[160, -312], [540, -312], [540, -420], [160, -420]], fields: true },
  { name: 'Carlton Oaks Golf', kind: 'grass', poly: [[-1080, -346], [-560, -372], [-560, -276], [-800, -268], [-1080, -296]], golf: true },
  { name: 'Weston Park', kind: 'grass', poly: [[-1395, -455], [-1330, -450], [-1312, -470], [-1312, -530], [-1395, -530]] },
];

export const SCHOOLS = [
  { name: 'West Hills High', x: -1240, z: -312, w: 210, d: 140, rotTo: 'Mast Blvd', color: '#2f6f9a' },
  { name: 'Santana High', x: 468, z: -676, w: 176, d: 132, rot: 0, color: '#6b3fa0' },
];

// Gillespie Field (the county airport) south of SR-52: wide asphalt = an arena
export const AIRPORT = { poly: [[-40, 548], [690, 560], [690, 646], [-40, 646]] };
// Santee Lakes: five lakes in a chain west of Fanita Pkwy, with a park loop road
export const LAKES = [
  { cx: -985, cz: -585, rx: 34, rz: 52, rot: 0.1 },
  { cx: -1000, cz: -705, rx: 40, rz: 50, rot: -0.15 },
  { cx: -990, cz: -830, rx: 46, rz: 60, rot: 0.2 },
  { cx: -1005, cz: -960, rx: 42, rz: 54, rot: -0.1 },
  { cx: -995, cz: -1075, rx: 36, rz: 44, rot: 0.1 },
];
export const LAKES_LOOP = [[-900, -545], [-940, -530], [-1040, -540], [-1060, -640], [-1065, -770], [-1062, -900], [-1060, -1030], [-1050, -1130], [-990, -1150], [-920, -1135], [-902, -1120]];
// River pools: deep water, deadly. Kept small and off the main sandy line.
export const POOLS = [
  { cx: -170, cz: -186, rx: 18, rz: 9, rot: 0.03 },
  { cx: 880, cz: -232, rx: 22, rz: 10, rot: 0.06 },
  { cx: -1560, cz: 30, rx: 0, rz: 0 },
];

// hills: smooth bumps (map m) rising away from roads; [cx, cz, rx, rz, h]
export const HILLS = [
  [-1580, 120, 170, 260, 55], [-1450, 380, 220, 160, 70], [-1150, 480, 220, 140, 45], [-1000, 600, 160, 80, 30],
  [-1560, -980, 260, 260, 70], [-1250, -900, 240, 190, 45], [-1180, -1150, 200, 120, 50],
  [-650, -1170, 260, 120, 55], [-150, -1180, 260, 110, 60], [350, -1170, 260, 120, 55], [820, -1150, 250, 130, 60],
  [1100, -700, 140, 300, 70], [1100, 0, 120, 260, 55], [1100, 500, 140, 200, 50],
  [-1560, -470, 90, 120, 30],
];
