// Generates the castle map in the painterly natural style (docs/art/ART_SPEC.md, "Новий напрям
// землі"): a mossy hill with painted soil and a stony underside, and a castle of painted bricks
// with two clay-flowerpot towers.
//
// Writes into <dir>:
//   terrain.svg - solid layer (opaque = solid): ground, turf, castle;
//   grass.svg   - non-solid front layer: grass fringe, ivy, sprouts on the towers, mushrooms.
// back.svg (the castle interior) is hand-written and left as is.
// Seeded, so the output is stable. Usage: node scripts/art/gen-castle.mjs public/maps/castle
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SOIL_TILE_SIZE, soilTile } from './gen-soil-tile.mjs';
import {
  OUT,
  SHADOW_DEF,
  blade,
  f,
  fringe,
  makeRng,
  mushroom,
  rotate,
  solidTester,
  stone,
  turf,
} from './paint-lib.mjs';

const rng = makeRng(2024);
const { r, pick } = rng;
const W = 1600;
const H = 720;

const GROUND =
  'M0,720 L0,640 C14,610 10,580 30,560 C44,546 40,520 60,500 C80,482 120,474 160,470 L380,470 C430,470 450,420 500,404 C540,392 570,400 600,430 C640,470 660,540 720,556 C780,570 820,520 860,480 C900,446 940,436 980,434 L1470,434 C1500,434 1530,450 1550,480 C1570,510 1560,540 1580,570 C1594,592 1588,620 1600,640 L1600,720 Z';
const SURFACE =
  'M2,636 C14,610 10,580 30,560 C44,546 40,520 60,500 C80,482 120,474 160,470 L380,470 C430,470 450,420 500,404 C540,392 570,400 600,430 C640,470 660,540 720,556 C780,570 820,520 860,480 C900,446 940,436 980,434 L1470,434 C1500,434 1530,450 1550,480 C1570,510 1560,540 1580,570 C1594,592 1588,620 1598,636';
// Wall between the towers: merlons on the left, a flat walk (spawn 1318) on the right, a gate arch.
const WALL =
  'M1076,436 L1076,330 L1096,330 L1096,312 L1116,312 L1116,330 L1132,330 L1132,312 L1152,312 L1152,330 L1168,330 L1168,312 L1188,312 L1188,330 L1204,330 L1204,312 L1224,312 L1224,330 L1240,330 L1240,312 L1260,312 L1260,330 L1384,330 L1384,436 Z M1150,436 L1150,398 A35,35 0 0 1 1220,398 L1220,436 Z';
const towerBody = (x0, top, x1, wL, wR) => `M${wL},440 L${x0},${top} L${x1},${top} L${wR},440 Z`;
const TOWER_L = {
  body: towerBody(996, 216, 1094, 1008, 1082),
  rim: [990, 190, 110, 26],
  win: [1034, 272, 24, 28],
};
const TOWER_R = {
  body: towerBody(1366, 226, 1464, 1376, 1454),
  rim: [1360, 200, 110, 26],
  win: [1404, 284, 24, 28],
};
const winPath = ([x, y, w, h]) =>
  `M${x},${y + h} L${x},${y} A${w / 2},${w / 2} 0 0 1 ${x + w},${y} L${x + w},${y + h} Z`;
const towerShape = (t) =>
  `${t.body} ${winPath(t.win)} M${t.rim[0]},${t.rim[1]} h${t.rim[2]} v${t.rim[3]} h${-t.rim[2]} Z`;

const groundSolid = solidTester(`<path d="${GROUND}"/>`, W, H);
const castleSolid = solidTester(
  `<path d="${GROUND}"/><path d="${WALL}" fill-rule="evenodd"/><path d="${towerShape(TOWER_L)}" fill-rule="evenodd"/><path d="${towerShape(TOWER_R)}" fill-rule="evenodd"/>`,
  W,
  H,
);

// ---------- terrain.svg ----------

const stones = [];
for (let y = 720; y > 570; y -= 26) {
  const k = (720 - y) / 150;
  for (let x = r(-10, 20); x < W; x += r(34, 58) * (1 + k)) {
    if (rng.next() < k * 0.7) continue;
    const yy = y + r(-8, 8);
    if (groundSolid(x, yy)) stones.push(stone(rng, x, yy, r(14, 30) * (1 - k * 0.4), r(10, 20)));
  }
}
// A few big buried things so the right hill is not one flat mass (big details are fine).
const buried = [
  stone(rng, 1180, 560, 46, 30),
  stone(rng, 1222, 586, 30, 22),
  stone(rng, 1148, 592, 24, 17),
  stone(rng, 300, 600, 34, 24),
  stone(rng, 820, 640, 40, 26),
  // An old clay pot shard.
  `<path d="M1380,560 C1400,540 1446,538 1468,556 L1458,566 C1440,552 1406,554 1390,570 Z" fill="#B05530" stroke="#5E2A14" stroke-width="1.5"/><path d="M1386,560 C1404,546 1440,544 1460,556" stroke="#E08A5C" stroke-width="2" fill="none" opacity=".7"/>`,
];
// Thick old roots coming down from the surface.
const roots = [
  [
    920,
    450,
    [
      [930, 500],
      [912, 548],
      [936, 600],
    ],
  ],
  [
    1520,
    470,
    [
      [1500, 520],
      [1516, 566],
    ],
  ],
  [
    430,
    430,
    [
      [446, 480],
      [430, 530],
    ],
  ],
]
  .map(([x, y, pts]) => {
    let d = `M${x},${y}`;
    let p = [x, y];
    for (const q of pts) {
      d += ` Q${f((p[0] + q[0]) / 2 + r(-10, 10))},${f((p[1] + q[1]) / 2)} ${q[0]},${q[1]}`;
      p = q;
    }
    return `<path d="${d}" stroke="#3A2416" stroke-width="9" fill="none" stroke-linecap="round" opacity=".6"/><path d="${d}" stroke="#8A6544" stroke-width="6" fill="none" stroke-linecap="round"/><path d="${d}" stroke="#B08A62" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7" transform="translate(-1.5,0)"/>`;
  })
  .join('');

// Painted bricks: no black joints, each brick lit on top and shaded underneath.
const brick = (x, y, c) =>
  `<rect x="${x}" y="${y}" width="30" height="14" rx="3" fill="${c}"/><rect x="${x + 2}" y="${y + 1}" width="26" height="3" rx="1.5" fill="#EFA27A" opacity=".45"/><rect x="${x + 2}" y="${y + 10}" width="26" height="3" rx="1.5" fill="#6E3018" opacity=".35"/>`;
const BRICKS =
  `<rect width="64" height="32" fill="#8A4426"/>` +
  brick(1, 1, '#C8643B') +
  brick(33, 1, '#BF5C35') +
  brick(-15, 17, '#D06E45') +
  brick(17, 17, '#B85633') +
  brick(49, 17, '#C66239');

const tower = (t) => {
  const [rx, ry, rw, rh] = t.rim;
  const shape = `${t.body} ${winPath(t.win)}`;
  return `<path d="${shape}" fill-rule="evenodd" fill="url(#potBody)"/>
  <g clip-path="url(#clip-${rx})"><path d="M0,${ry + 60} H1600 M0,${ry + 120} H1600 M0,${ry + 180} H1600" stroke="#8E3F22" stroke-width="3" opacity=".35"/><path d="M0,${ry + 63} H1600 M0,${ry + 123} H1600 M0,${ry + 183} H1600" stroke="#F0A57C" stroke-width="1.5" opacity=".35"/></g>
  <path d="M${rx + 18},${ry + 34} L${rx + 26},${ry + 238}" stroke="#F0A57C" stroke-width="7" stroke-linecap="round" opacity=".45"/>
  <path d="${shape}" fill="none" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>
  <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="4" fill="url(#potBody)" stroke="${OUT}" stroke-width="2"/>
  <path d="M${rx + 4},${ry + 4} H${rx + rw - 6}" stroke="#F6B892" stroke-width="3" stroke-linecap="round" opacity=".8"/>
  <path d="M${rx + 4},${ry + rh - 3} H${rx + rw - 4}" stroke="#6E3018" stroke-width="3" stroke-linecap="round" opacity=".6"/>
  <path d="${winPath(t.win)}" fill="none" stroke="#7A3A20" stroke-width="6"/>
  <path d="M${t.win[0] - 4},${t.win[1] + t.win[3] + 2} h${t.win[2] + 8}" stroke="#E08A5C" stroke-width="4" stroke-linecap="round"/>
  <path d="M${t.win[0] + t.win[2] + 10},${t.win[1] + 50} l6,14 l-4,10" stroke="#6E3018" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
};

const { defs: tileDefs, body: tileBody } = soilTile();

const terrain = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- Castle map, solid layer (generated by scripts/art/gen-castle.mjs, painterly natural style). Opaque = solid. -->
  <defs>
    <pattern id="soil" width="${SOIL_TILE_SIZE}" height="${SOIL_TILE_SIZE}" patternUnits="userSpaceOnUse">${tileBody}</pattern>
    ${tileDefs}
    ${SHADOW_DEF}
    <pattern id="bricks" width="64" height="32" patternUnits="userSpaceOnUse">${BRICKS}</pattern>
    <linearGradient id="potBody" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E08A5C"/><stop offset=".3" stop-color="#CC6A3F"/><stop offset=".75" stop-color="#B05530"/><stop offset="1" stop-color="#8E3F22"/></linearGradient>
    <linearGradient id="wallLight" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFE2C4" stop-opacity=".18"/><stop offset=".5" stop-color="#FFE2C4" stop-opacity="0"/><stop offset="1" stop-color="#3B1A0E" stop-opacity=".3"/></linearGradient>
    <linearGradient id="wallFoot" gradientUnits="userSpaceOnUse" x1="0" y1="440" x2="0" y2="380"><stop offset="0" stop-color="#2E4A1A" stop-opacity=".55"/><stop offset="1" stop-color="#2E4A1A" stop-opacity="0"/></linearGradient>
    <linearGradient id="depth" gradientUnits="userSpaceOnUse" x1="0" y1="430" x2="0" y2="720"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient>
    <path id="ground" d="${GROUND}"/>
    <clipPath id="gc"><use href="#ground"/></clipPath>
    <path id="wall" d="${WALL}" fill-rule="evenodd"/>
    <clipPath id="wc"><use href="#wall" clip-rule="evenodd"/></clipPath>
    <clipPath id="clip-990"><path d="${TOWER_L.body} ${winPath(TOWER_L.win)}" clip-rule="evenodd"/></clipPath>
    <clipPath id="clip-1360"><path d="${TOWER_R.body} ${winPath(TOWER_R.win)}" clip-rule="evenodd"/></clipPath>
  </defs>

  <use href="#ground" fill="url(#soil)"/>
  <g clip-path="url(#gc)">
    ${stones.join('')}
    ${buried.join('')}
    ${roots}
    <rect y="400" width="${W}" height="320" fill="url(#depth)"/>
    ${turf([SURFACE])}
  </g>
  <use href="#ground" fill="none" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>

  <!-- Wall -->
  <use href="#wall" fill="url(#bricks)" fill-rule="evenodd"/>
  <g clip-path="url(#wc)">
    <rect x="1070" y="300" width="320" height="140" fill="url(#wallLight)"/>
    <rect x="1070" y="300" width="320" height="140" fill="url(#wallFoot)"/>
    <path d="M1150,436 L1150,398 A35,35 0 0 1 1220,398 L1220,436" stroke="#7A3A20" stroke-width="12" fill="none"/>
    <path d="M1150,436 L1150,398 A35,35 0 0 1 1220,398 L1220,436" stroke="#D27348" stroke-width="3" fill="none" transform="translate(-5,-3)" opacity=".7"/>
    <path d="M1096,314 h20 M1132,314 h20 M1168,314 h20 M1204,314 h20 M1240,314 h20 M1262,332 H1384" stroke="#F6B892" stroke-width="3" opacity=".7"/>
  </g>
  <use href="#wall" fill="none" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>

  <!-- Towers: clay flowerpots -->
  ${tower(TOWER_L)}
  ${tower(TOWER_R)}
</svg>
`;

// ---------- grass.svg ----------

const MUSH = [
  [212, 471, 1.35],
  [233, 471, 0.8],
  [520, 405, 1.1],
  [724, 557, 1],
  [1520, 470, 1.15],
];
const nearMushroom = (x) => MUSH.some(([mx, , s]) => Math.abs(x - mx) < 13 * s);

const g = fringe(rng, SURFACE, groundSolid, { skip: nearMushroom });
const walk = fringe(rng, 'M1264,330 L1362,330', castleSolid, { tongues: false, scale: 0.55 });
const rimL = fringe(rng, 'M994,190 L1096,190', castleSolid, { tongues: false, scale: 0.6 });
const rimR = fringe(rng, 'M1364,200 L1466,200', castleSolid, { tongues: false, scale: 0.6 });

/** Ivy climbing from the foot of the wall: a thin stem with small heart-shaped leaves. */
function ivy(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    d += ` Q${f((p[0] + q[0]) / 2 + r(-10, 10))},${f((p[1] + q[1]) / 2)} ${q[0]},${q[1]}`;
  }
  let leaves = '';
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < 3; k++) {
      const t = (k + 0.5) / 3;
      const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t + r(-6, 6);
      const y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      const s = r(0.8, 1.2);
      leaves += `<path d="M0,0 C-7,-4 -8,-11 -3,-12 C-1,-12 0,-10 0,-9 C0,-10 1,-12 3,-12 C8,-11 7,-4 0,0 Z" transform="translate(${f(x)},${f(y)}) rotate(${f(r(-50, 50))}) scale(${f(s)})" fill="${pick(['#4E8F2E', '#5DAA3A', '#3F7F2A'])}" stroke="#24461A" stroke-width="1"/>`;
    }
  }
  return `<path d="${d}" stroke="#24461A" stroke-width="4" fill="none" stroke-linecap="round"/><path d="${d}" stroke="#4E7A2A" stroke-width="2" fill="none" stroke-linecap="round"/>${leaves}`;
}

/** Sprout with two big leaves growing out of a pot rim. */
const sprout = (x, y, s) =>
  `<g transform="translate(${x},${y}) scale(${s})" stroke="#24461A" stroke-width="1.6" stroke-linejoin="round">
    <path d="M-2,0 C-4,-14 -1,-26 2,-32 C5,-24 5,-12 3,0 Z" fill="#3F7F2A"/>
    <path d="M1,-20 C-14,-34 -30,-30 -36,-22 C-24,-14 -10,-14 1,-18 Z" fill="#6FC046"/>
    <path d="M-2,-21 C-14,-27 -24,-25 -30,-22" stroke="#B2E36A" stroke-width="1.5" fill="none"/>
    <path d="M2,-26 C16,-42 32,-40 38,-32 C26,-24 12,-22 2,-24 Z" fill="#5DAA3A"/>
    <path d="M5,-27 C16,-35 26,-35 32,-32" stroke="#9BD84A" stroke-width="1.5" fill="none"/>
  </g>`;
const berries = (x, y) =>
  [
    [0, 0],
    [7, -4],
    [12, 2],
  ]
    .map(
      ([dx, dy]) =>
        `<circle cx="${x + dx}" cy="${y + dy}" r="4.5" fill="#E2453C" stroke="${OUT}" stroke-width="1.4"/><circle cx="${x + dx - 1.5}" cy="${y + dy - 1.5}" r="1.3" fill="#FFB0A8"/>`,
    )
    .join('');

const smallTuft = (x, y, n) =>
  Array.from({ length: n }, (_, i) =>
    blade(rng, [x + i * 5, y], rotate([0, -1], r(-25, 25)), r(8, 14), 2.6, false),
  ).join('');

const grass = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- Castle map, non-solid front layer (generated by scripts/art/gen-castle.mjs): grass fringe, ivy,
       sprouts and mushrooms. Drawn over the terrain; craters erase it. -->
  ${g.teeth.join('')}
  ${ivy([
    [1100, 438],
    [1092, 404],
    [1108, 372],
    [1100, 342],
  ])}
  ${ivy([
    [1346, 438],
    [1356, 404],
    [1340, 370],
    [1352, 340],
  ])}
  ${ivy([
    [1012, 438],
    [1006, 390],
    [1016, 330],
    [1008, 286],
  ])}
  ${[g, walk, rimL, rimR].map((x) => x.back.join('')).join('')}
  ${[g, walk, rimL, rimR].map((x) => x.front.join('')).join('')}
  ${sprout(1046, 190, 1)}${sprout(1416, 200, 0.85)}${berries(1436, 194)}
  ${smallTuft(1440, 434, 5)}
  ${MUSH.map(([x, y, s]) => mushroom(x, y, s)).join('')}
</svg>
`;

const dir = process.argv[2];
writeFileSync(join(dir, 'terrain.svg'), terrain);
writeFileSync(join(dir, 'grass.svg'), grass);
console.log('terrain', terrain.length, 'grass', grass.length, 'bytes');
