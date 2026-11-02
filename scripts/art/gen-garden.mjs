// Generates the "garden" map ("Грядка"): a hand-composed, multi-level map in the painterly style.
// Shapes and props are placed by hand (coordinates below); the code only paints them: a thick grass
// cap with hanging festoons on every platform top, painted soil with a stony underside, roots,
// lianas, and big garden props as cover (a clay pot on its side, a watering can, a giant mushroom).
//
// Writes into <dir>: terrain.svg (solid), grass.svg (non-solid front), back.svg (non-solid back),
// map.json. Seeded, so the output is stable. Usage: node scripts/art/gen-garden.mjs public/maps/garden
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SOIL_TILE_SIZE, soilTile } from './gen-soil-tile.mjs';
import {
  OUT,
  SHADOW_DEF,
  f,
  liana,
  makeRng,
  mushroom,
  samplePath,
  solidTester,
  stone,
} from './paint-lib.mjs';

const rng = makeRng(7);
const { r, pick } = rng;
const W = 1600;
const H = 720;
const WATER = 664;

/** Moves every point of an absolute path by (dx, dy). */
const shift = (d, dx, dy) =>
  d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${f(+x + dx)},${f(+y + dy)}`);

// ---------- Composition (hand-placed) ----------
// Each platform: closed body outline + its grassy top edge (left to right or right to left).
const PLATFORMS = {
  baseL: {
    body: 'M-10,720 L-10,500 C10,480 40,476 80,474 C140,470 200,468 260,470 C320,472 380,466 430,470 C460,472 474,486 470,510 C466,540 480,560 470,590 C462,620 476,650 470,720 Z',
    top: 'M-10,500 C10,480 40,476 80,474 C140,470 200,468 260,470 C320,472 380,466 430,470 C452,471 464,477 468,486',
  },
  baseR: {
    body: 'M1610,720 L1610,470 C1590,456 1560,452 1520,450 C1460,448 1400,452 1340,450 C1260,448 1190,446 1150,452 C1128,456 1118,474 1124,500 C1130,530 1114,560 1126,600 C1134,640 1118,680 1124,720 Z',
    top: 'M1610,470 C1590,456 1560,452 1520,450 C1460,448 1400,452 1340,450 C1260,448 1190,446 1150,452 C1134,455 1126,462 1123,472',
  },
  islandLow: {
    body: 'M610,525 C660,512 740,508 800,510 C870,512 940,510 990,520 C1004,540 992,560 970,580 C940,610 900,640 860,650 C830,660 790,664 760,656 C720,646 680,620 650,592 C626,570 600,548 610,525 Z',
    top: 'M611,523 C660,512 740,508 800,510 C870,512 940,510 989,519',
  },
  ledgeL: {
    body: 'M320,330 C360,318 420,314 480,316 C540,318 590,316 622,326 C636,344 624,366 604,380 C580,398 560,420 530,426 C500,432 470,428 440,420 C400,410 360,396 340,378 C322,362 312,344 320,330 Z',
    top: 'M321,329 C360,318 420,314 480,316 C540,318 590,316 621,325',
  },
  ledgeR: {
    body: shift(
      'M990,300 C1030,288 1100,284 1160,286 C1220,288 1270,286 1300,296 C1314,314 1302,336 1284,352 C1262,372 1236,392 1200,398 C1166,404 1130,400 1100,390 C1060,376 1030,358 1008,338 C992,324 984,312 990,300 Z',
      0,
      -30,
    ),
    top: shift('M991,299 C1030,288 1100,284 1160,286 C1220,288 1270,286 1299,295', 0, -30),
  },
  peak: {
    body: 'M716,200 C750,190 810,188 850,192 C874,196 888,204 884,218 C878,236 860,252 836,262 C812,270 786,268 764,258 C740,246 722,232 716,218 C712,210 712,204 716,200 Z',
    top: 'M717,199 C750,190 810,188 850,192 C870,195 880,199 884,206',
  },
};
// Spawns: one on each base and one on each middle ledge (the engine drops a snail onto the
// first surface under x). Kept clear of props and tufts.
const SPAWNS = [120, 1480, 470, 1150];
const nearSpawn = (x, d = 34) => SPAWNS.some((s) => Math.abs(x - s) < d);

const BODIES = Object.values(PLATFORMS).map((p) => p.body);
const groundMarkup = BODIES.map((d) => `<path d="${d}"/>`).join('');

// Props (solid). Each is painted markup plus a plain silhouette for the solid test.
const ROOT_COLUMN =
  'M396,474 C392,446 404,428 432,418 C448,412 458,404 462,392 L486,400 C482,420 466,434 448,442 C430,450 424,460 426,474 Z';
const POT_BODY = 'M222,468 L226,414 L338,396 L344,472 Z';
// The watering can is drawn at its original spot and moved right by CAN_DX as a whole.
const CAN_DX = 84;
const CAN_BODY_0 =
  'M1236,452 L1240,384 C1240,372 1250,366 1262,366 L1338,366 C1350,366 1358,374 1358,386 L1356,452 Z';
const CAN_SPOUT_0 = 'M1240,428 L1172,356 L1186,346 L1244,404 Z';
const CAN_ROSE_0 = 'M1160,362 L1176,336 L1196,352 L1180,374 Z';
const CAN_HANDLE_0 =
  'M1266,370 C1266,330 1340,326 1342,368 L1328,368 C1326,344 1282,344 1280,370 Z';
const [CAN_BODY, CAN_SPOUT, CAN_ROSE, CAN_HANDLE] = [
  CAN_BODY_0,
  CAN_SPOUT_0,
  CAN_ROSE_0,
  CAN_HANDLE_0,
].map((d) => shift(d, CAN_DX, 0));
const MUSH_STEM = 'M776,514 C778,488 778,466 774,446 L806,446 C802,466 802,488 806,514 Z';
const MUSH_CAP = 'M716,446 C716,392 866,388 868,446 C840,456 744,456 716,446 Z';
const PROPS = [
  ROOT_COLUMN,
  POT_BODY,
  CAN_BODY,
  CAN_SPOUT,
  CAN_ROSE,
  CAN_HANDLE,
  MUSH_STEM,
  MUSH_CAP,
];

const groundSolid = solidTester(groundMarkup, W, H);
const allSolid = solidTester(
  groundMarkup + PROPS.map((d) => `<path d="${d}" fill-rule="evenodd"/>`).join(''),
  W,
  H,
);

// ---------- Grass cap with festoons ----------

/** Grass cap along a top edge: raised top, thick front, bottom edge made of big rounded lobes. */
function grassCap(top) {
  const pts = samplePath(top, 2, groundSolid);
  // Normal into the ground (down-ish).
  const down = pts.map((s) => (s.n[1] < 0 ? [-s.n[0], -s.n[1]] : s.n));
  const at = (i, k) => [pts[i].p[0] + down[i][0] * k, pts[i].p[1] + down[i][1] * k];
  const raise = (i) => -(5 + 2.5 * Math.sin(pts[i].p[0] / 23) + 1.5 * Math.sin(pts[i].p[0] / 7.3));
  let d = `M${f(at(0, raise(0))[0])},${f(at(0, raise(0))[1])}`;
  for (let i = 1; i < pts.length; i++) d += ` L${f(at(i, raise(i))[0])},${f(at(i, raise(i))[1])}`;
  // Lobes from the far end back to the start.
  const T = 15;
  const lobes = [];
  for (let i = 0; i < pts.length - 1;) {
    const w = Math.round(r(11, 22)); // in samples of 2 px -> 22..44 px
    const e = Math.min(pts.length - 1, i + w);
    const long = rng.next() < 0.18;
    lobes.push([i, e, long ? r(22, 34) : r(7, 18)]);
    i = e;
  }
  for (let k = lobes.length - 1; k >= 0; k--) {
    const [s, e, depth] = lobes[k];
    const m = Math.round((s + e) / 2);
    const a = at(e, T);
    const c = at(m, T + depth * 2);
    const b = at(s, T);
    d += ` L${f(a[0])},${f(a[1])} Q${f(c[0])},${f(c[1])} ${f(b[0])},${f(b[1])}`;
  }
  d += ' Z';
  const lightTop = pts.map((_, i) => at(i, raise(i) + 4));
  const lightD = `M${lightTop.map((p) => `${f(p[0])},${f(p[1])}`).join(' L')}`;
  const glints = [];
  for (let i = 4; i < pts.length - 4; i += Math.round(r(8, 20))) {
    const p = at(i, raise(i) + r(6, 12));
    const q = at(Math.min(pts.length - 1, i + Math.round(r(2, 5))), raise(i) + r(5, 11));
    glints.push(`M${f(p[0])},${f(p[1])} L${f(q[0])},${f(q[1])}`);
  }
  return { d, lightD, glints: glints.join(' '), pts, down };
}

// ---------- terrain.svg ----------

const { defs: tileDefs, body: tileBody } = soilTile();
const caps = Object.entries(PLATFORMS).map(([id, p]) => ({ id, ...grassCap(p.top) }));

// Stones: denser and bigger towards the underside of every platform.
const stones = [];
for (let y = 300; y < 720; y += 22) {
  for (let x = r(-10, 20); x < W; x += r(32, 64)) {
    const yy = y + r(-8, 8);
    if (!groundSolid(x, yy)) continue;
    let below = 0; // distance to air underneath, capped
    while (below < 120 && groundSolid(x, yy + below + 4)) below += 4;
    const nearBottom = below < 60 || yy > 600;
    if (rng.next() < (nearBottom ? 0.5 : 0.8)) continue;
    const big = nearBottom ? r(12, 26) : r(6, 12);
    stones.push(stone(rng, x, yy, big, big * r(0.6, 0.8)));
  }
}

const capPaths = caps.map((c) => `<path d="${c.d}"/>`).join('');

// Props, painted.
const pot = `<g>
  <path d="${POT_BODY}" fill="url(#potBody)" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M232,418 L330,402" stroke="#F0A57C" stroke-width="5" stroke-linecap="round" opacity=".6"/>
  <path d="M232,444 L338,436 M230,458 L340,454" stroke="#8E3F22" stroke-width="2" opacity=".5"/>
  <ellipse cx="340" cy="434" rx="16" ry="40" fill="#D27348" stroke="${OUT}" stroke-width="2.5"/>
  <ellipse cx="342" cy="434" rx="9" ry="31" fill="#3A2418"/>
  <path d="M336,404 C330,420 330,448 336,464" stroke="#F0A57C" stroke-width="3" fill="none" opacity=".7"/>
</g>`;
const can = `<g transform="translate(${CAN_DX},0)"><g stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round">
  <path d="${CAN_HANDLE_0}" fill="#3E8C8C"/>
  <path d="${CAN_SPOUT_0}" fill="#3E8C8C"/>
  <path d="${CAN_ROSE_0}" fill="#4FA3A3"/>
  <path d="${CAN_BODY_0}" fill="url(#canBody)"/>
  <path d="M1240,392 H1357" stroke-width="2" opacity=".6"/>
  <path d="M1238,438 H1357" stroke-width="2" opacity=".6"/>
</g>
<path d="M1254,382 L1252,446" stroke="#BDEAE6" stroke-width="6" stroke-linecap="round" opacity=".55"/>
<path d="M1196,374 L1230,410" stroke="#BDEAE6" stroke-width="3" stroke-linecap="round" opacity=".5"/>
<g fill="#2A5E5E"><circle cx="1172" cy="350" r="1.8"/><circle cx="1180" cy="356" r="1.8"/><circle cx="1178" cy="344" r="1.8"/><circle cx="1186" cy="350" r="1.8"/></g>
<path d="M1300,372 C1290,388 1296,408 1312,416" stroke="#8C5A2A" stroke-width="4" fill="none" opacity=".35" stroke-linecap="round"/></g>`;
const giantMushroom = `<g stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round">
  <path d="${MUSH_STEM}" fill="#F4EBDD"/>
  <path d="${MUSH_CAP}" fill="#E2453C"/>
</g>
<path d="M784,452 C786,476 786,494 784,510" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity=".7"/>
<path d="M800,452 C798,476 798,494 800,510" stroke="#C9B9A2" stroke-width="5" stroke-linecap="round" opacity=".7"/>
<path d="M722,444 C760,452 828,452 862,444" stroke="#A82E26" stroke-width="5" fill="none"/>
<path d="M744,428 C752,414 770,408 790,406" stroke="#F58A7E" stroke-width="6" fill="none" stroke-linecap="round"/>
<g fill="#FFF6EC" stroke="${OUT}" stroke-width="1.5"><ellipse cx="760" cy="420" rx="9" ry="6"/><ellipse cx="800" cy="408" rx="11" ry="7"/><ellipse cx="840" cy="424" rx="8" ry="5.5"/><ellipse cx="822" cy="436" rx="5" ry="3.5"/><ellipse cx="738" cy="436" rx="5" ry="3.5"/></g>`;
const rootColumn = `<path d="${ROOT_COLUMN}" fill="#7A5236" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round"/>
<path d="M404,470 C400,448 412,434 436,424 C450,418 460,410 466,398" stroke="#B08A62" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/>
<path d="M420,470 C420,456 430,448 446,440" stroke="#4A2E1C" stroke-width="3" fill="none" opacity=".6"/>`;

const terrain = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- Garden map, solid layer (scripts/art/gen-garden.mjs). Opaque = solid. -->
  <defs>
    <pattern id="soil" width="${SOIL_TILE_SIZE}" height="${SOIL_TILE_SIZE}" patternUnits="userSpaceOnUse">${tileBody}</pattern>
    ${tileDefs}
    ${SHADOW_DEF}
    <linearGradient id="potBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E08A5C"/><stop offset=".45" stop-color="#C8643B"/><stop offset="1" stop-color="#8E3F22"/></linearGradient>
    <linearGradient id="canBody" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6CC0BC"/><stop offset=".35" stop-color="#4FA3A3"/><stop offset="1" stop-color="#2A6E6E"/></linearGradient>
    <linearGradient id="under" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="720"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
    <clipPath id="gc">${groundMarkup}</clipPath>
    <clipPath id="cc">${capPaths}</clipPath>
  </defs>

  ${BODIES.map((d) => `<path d="${d}" fill="url(#soil)"/>`).join('')}
  <g clip-path="url(#gc)">
    ${stones.join('')}
    <rect width="${W}" height="${H}" fill="url(#under)"/>
    <!-- Soft shadow cast by the grass cap onto the soil -->
    <g fill="none" stroke="#1E120A" stroke-width="22" opacity=".35" transform="translate(0,6)">${capPaths}</g>
  </g>
  ${BODIES.map((d) => `<path d="${d}" fill="none" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>`).join('')}

  <!-- Props behind the grass -->
  ${rootColumn}
  ${pot}
  ${can}
  ${giantMushroom}

  <!-- Grass caps: dark base, main green shifted up (dark shadow left in the lobes), lit top, glints -->
  <g fill="#3A7A26">${capPaths}</g>
  <g clip-path="url(#cc)">
    <g fill="#5DAA3A" transform="translate(0,-5)">${capPaths}</g>
    ${caps.map((c) => `<path d="${c.lightD}" fill="none" stroke="#8ED15A" stroke-width="9" stroke-linejoin="round"/>`).join('')}
    ${caps.map((c) => `<path d="${c.glints}" stroke="#C4EE84" stroke-width="2.5" stroke-linecap="round"/>`).join('')}
  </g>
  <g fill="none" stroke="#24461A" stroke-width="2" stroke-linejoin="round">${capPaths}</g>
</svg>
`;

// ---------- grass.svg (non-solid front) ----------

/** A big tuft: 3-5 thick pointed leaves with outline and a lit half. */
function tuft(x, y, s) {
  const n = Math.floor(r(3, 6));
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = ((-90 + (i - (n - 1) / 2) * r(16, 24) + r(-6, 6)) * Math.PI) / 180;
    const len = r(16, 28) * s * (i === Math.floor(n / 2) ? 1.2 : 1);
    const w = r(5, 8) * s;
    const tip = [x + Math.cos(a) * len, y + Math.sin(a) * len];
    const side = [-Math.sin(a), Math.cos(a)];
    const c1 = [
      x + Math.cos(a) * len * 0.5 + side[0] * w,
      y + Math.sin(a) * len * 0.5 + side[1] * w,
    ];
    const c2 = [
      x + Math.cos(a) * len * 0.5 - side[0] * w,
      y + Math.sin(a) * len * 0.5 - side[1] * w,
    ];
    out += `<path d="M${f(x - side[0] * w * 0.4)},${f(y - side[1] * w * 0.4)} Q${f(c1[0])},${f(c1[1])} ${f(tip[0])},${f(tip[1])} Q${f(c2[0])},${f(c2[1])} ${f(x + side[0] * w * 0.4)},${f(y + side[1] * w * 0.4)} Z" fill="${pick(['#5DAA3A', '#4E9A33', '#6FC046'])}" stroke="#24461A" stroke-width="1.5" stroke-linejoin="round"/>`;
    out += `<path d="M${f(x)},${f(y)} Q${f((c1[0] + x) / 2)},${f((c1[1] + y) / 2)} ${f(tip[0])},${f(tip[1])}" stroke="#A6E070" stroke-width="${f(w * 0.5)}" fill="none" stroke-linecap="round" opacity=".8"/>`;
  }
  return out;
}

/** Long tongues of grass draping over a platform end. */
function drape(i, cap, dir) {
  const p = cap.pts[i].p;
  const tg = cap.pts[i].t;
  const out = [];
  const n = Math.floor(r(2, 4));
  for (let k = 0; k < n; k++) {
    const along = dir * (k * 9 - 6);
    const sx = p[0] + tg[0] * along;
    const sy = p[1] + tg[1] * along + 6;
    const len = r(22, 50) * (k === 1 ? 1.25 : 1);
    const w = r(8, 13);
    const swing = dir * r(6, 18);
    const tip = [sx + swing, sy + len];
    out.push(
      `<path d="M${f(sx - w)},${f(sy)} C${f(sx - w * 1.1 + swing * 0.2)},${f(sy + len * 0.45)} ${f(tip[0] - w * 0.5)},${f(tip[1] - len * 0.3)} ${f(tip[0])},${f(tip[1])} C${f(tip[0] + w * 0.3)},${f(tip[1] - len * 0.35)} ${f(sx + w * 1.1 + swing * 0.3)},${f(sy + len * 0.4)} ${f(sx + w)},${f(sy)} Z" fill="${pick(['#4E9A33', '#3F8A2C', '#5DAA3A'])}" stroke="#24461A" stroke-width="1.5"/>` +
        `<path d="M${f(sx - w * 0.3)},${f(sy + 4)} Q${f(sx + swing * 0.3)},${f(sy + len * 0.5)} ${f(tip[0] - w * 0.15)},${f(tip[1] - 6)}" stroke="#8ED15A" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".8"/>`,
    );
  }
  return out.join('');
}

const tufts = [];
for (const c of caps) {
  for (let i = Math.round(r(4, 20)); i < c.pts.length - 4; i += Math.round(r(28, 70))) {
    const [x, y] = c.pts[i].p;
    if (nearSpawn(x)) continue;
    if (!allSolid(x, y + 3) || allSolid(x, y - 8)) continue; // only where the cap is open sky
    tufts.push(tuft(x, y - 4, r(0.8, 1.25)));
  }
}
const drapes = caps
  .map((c) => {
    const first = c.pts[0].p[0];
    const last = c.pts[c.pts.length - 1].p[0];
    const lo = first < last ? 0 : c.pts.length - 1;
    const hi = first < last ? c.pts.length - 1 : 0;
    // Skip ends that are the world edge.
    const ends = [];
    if (c.pts[lo].p[0] > 4) ends.push(drape(lo, c, first < last ? -1 : 1));
    if (c.pts[hi].p[0] < W - 4) ends.push(drape(hi, c, first < last ? 1 : -1));
    return ends.join('');
  })
  .join('');

const flowers = [
  [64, 474],
  [560, 318],
  [930, 514],
  [1400, 450],
  [1560, 458],
  [1040, 292],
]
  .map(
    ([x, y]) =>
      `<g transform="translate(${x},${y - 14})"><path d="M0,14 C1,8 -1,4 0,0" stroke="#3E7A28" stroke-width="2" fill="none"/>${[
        0, 72, 144, 216, 288,
      ]
        .map(
          (a) =>
            `<ellipse cx="0" cy="-4.5" rx="2.8" ry="4.5" transform="rotate(${a})" fill="#FFFFFF" stroke="#8A8A7A" stroke-width=".8"/>`,
        )
        .join('')}<circle r="2.6" fill="#F6C33A" stroke="#8A6A1A" stroke-width=".8"/></g>`,
  )
  .join('');

const grass = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- Garden map, non-solid front layer (scripts/art/gen-garden.mjs): drapes, tufts, flowers, vines. -->
  ${drapes}
  ${liana(rng, [
    [604, 372],
    [612, 420],
    [600, 466],
    [610, 500],
  ])}
  ${liana(rng, [
    [1034, 322],
    [1026, 372],
    [1036, 410],
  ])}
  ${tufts.join('')}
  ${flowers}
  ${mushroom(700, 516, 0.9)}${mushroom(718, 516, 0.6)}${mushroom(1590, 470, 1)}${mushroom(30, 486, 1.1)}
</svg>
`;

// ---------- back.svg (non-solid back): hanging roots under the floating platforms ----------

const hangingRoots = [];
for (const [id, x0, x1] of [
  ['islandLow', 690, 920],
  ['ledgeL', 380, 600],
  ['ledgeR', 1040, 1280],
  ['peak', 740, 870],
]) {
  void id;
  for (let x = x0; x < x1; x += r(22, 46)) {
    let y = 200;
    while (y < 700 && !groundSolid(x, y)) y++;
    while (y < 700 && groundSolid(x, y)) y++;
    if (y >= 700) continue;
    const len = r(18, 60);
    const sway = r(-10, 10);
    const d = `M${f(x)},${f(y - 6)} C${f(x + sway)},${f(y + len * 0.4)} ${f(x - sway)},${f(y + len * 0.7)} ${f(x + sway * 0.5)},${f(y + len)}`;
    hangingRoots.push(
      `<path d="${d}" stroke="#2B1B12" stroke-width="5" fill="none" stroke-linecap="round"/><path d="${d}" stroke="#8A6544" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    );
  }
}
const back = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- Garden map, non-solid back layer (scripts/art/gen-garden.mjs): roots hanging under the platforms. -->
  ${hangingRoots.join('')}
</svg>
`;

const map = {
  id: 'garden',
  name: 'Грядка',
  width: W,
  height: H,
  waterLevel: WATER,
  spawns: SPAWNS.map((x) => ({ x })),
};

const dir = process.argv[2];
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'terrain.svg'), terrain);
writeFileSync(join(dir, 'grass.svg'), grass);
writeFileSync(join(dir, 'back.svg'), back);
writeFileSync(join(dir, 'map.json'), `${JSON.stringify(map, null, 2)}\n`);
console.log('terrain', terrain.length, 'grass', grass.length, 'back', back.length);
