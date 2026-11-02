// Generates the "garden" map ("Грядка"): a hand-composed, multi-level map.
// Style: minimal details. Every platform is ONE soil shape (gradient, a few broken strata lines,
// thin outline) under ONE grass shape (spiky blades on top and hanging over the edge and the ends,
// two tones, outline). No separate tufts, drapes, stones or roots. Big garden props are cover:
// a clay pot on its side, a watering can, a giant mushroom, a root linking two levels.
//
// Writes terrain.svg (solid, with a smooth grass top), grass.svg (the full grass shapes, non-solid)
// and map.json into <dir>.
// Seeded, so the output is stable. Usage: node scripts/art/gen-garden.mjs public/maps/garden
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, f, makeRng, samplePath, solidTester } from './paint-lib.mjs';

const rng = makeRng(7);
const { r } = rng;
const W = 1600;
const H = 720;
const WATER = 664;

/** Moves every point of an absolute path by (dx, dy). */
const shift = (d, dx, dy) =>
  d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${f(+x + dx)},${f(+y + dy)}`);

// ---------- Composition (hand-placed) ----------
// Each platform: closed body outline + its grassy top edge.
const PLATFORMS = {
  baseL: {
    body: 'M-10,720 L-10,500 C10,480 40,476 80,474 C140,470 200,468 260,470 C320,472 380,466 430,470 C460,472 474,486 470,510 C466,540 480,560 470,590 C462,620 476,650 470,720 Z',
    top: 'M-10,500 C10,480 40,476 80,474 C140,470 200,468 260,470 C320,472 380,466 430,470 C452,471 464,477 468,486',
  },
  baseR: {
    body: 'M1610,720 L1610,470 C1590,456 1560,452 1520,450 C1460,448 1400,452 1340,450 C1260,448 1190,446 1150,452 C1128,456 1118,474 1124,500 C1130,530 1114,560 1126,600 C1134,640 1118,680 1124,720 Z',
    top: 'M1123,472 C1126,462 1134,455 1150,452 C1190,446 1260,448 1340,450 C1400,452 1460,448 1520,450 C1560,452 1590,456 1610,470',
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
// first surface under x). Kept clear of props.
const SPAWNS = [120, 1480, 470, 1150];

const BODIES = Object.values(PLATFORMS).map((p) => p.body);
const groundMarkup = BODIES.map((d) => `<path d="${d}"/>`).join('');
const groundSolid = solidTester(groundMarkup, W, H);

// Props (solid).
const ROOT_COLUMN =
  'M396,474 C392,446 404,428 432,418 C448,412 458,404 462,392 L486,400 C482,420 466,434 448,442 C430,450 424,460 426,474 Z';
const POT_BODY = 'M222,468 L226,414 L338,396 L344,472 Z';
const CAN_DX = 84; // the can is drawn at its original spot and moved right as a whole
const CAN_BODY =
  'M1236,452 L1240,384 C1240,372 1250,366 1262,366 L1338,366 C1350,366 1358,374 1358,386 L1356,452 Z';
const CAN_SPOUT = 'M1240,428 L1172,356 L1186,346 L1244,404 Z';
const CAN_ROSE = 'M1160,362 L1176,336 L1196,352 L1180,374 Z';
const CAN_HANDLE = 'M1266,370 C1266,330 1340,326 1342,368 L1328,368 C1326,344 1282,344 1280,370 Z';
const MUSH_STEM = 'M776,514 C778,488 778,466 774,446 L806,446 C802,466 802,488 806,514 Z';
const MUSH_CAP = 'M716,446 C716,392 866,388 868,446 C840,456 744,456 716,446 Z';

// ---------- Grass: one shape per platform ----------

/**
 * One closed grass shape along a top edge: spiky blades above the surface, a band over the
 * front with blades hanging down, and the same blades wrapping each end of the platform.
 */
function grassShape(top) {
  let pts = samplePath(top, 2, groundSolid);
  if (pts[0].p[0] > pts[pts.length - 1].p[0])
    pts = pts.reverse().map((s) => ({ ...s, t: [-s.t[0], -s.t[1]] }));
  const N = pts.length;
  const down = pts.map((s) => (s.n[1] < 0 ? [-s.n[0], -s.n[1]] : s.n));
  const P = (i, d, a = 0) => [
    pts[i].p[0] + down[i][0] * d + pts[i].t[0] * a,
    pts[i].p[1] + down[i][1] * d + pts[i].t[1] * a,
  ];
  const pt = (p) => `${f(p[0])},${f(p[1])}`;
  let d = '';
  let cur = null;
  const moveTo = (p) => {
    d += `M${pt(p)}`;
    cur = p;
  };
  const lineTo = (p) => {
    d += ` L${pt(p)}`;
    cur = p;
  };
  /** A flame-like blade from the current point to `tip` and back down to `b`. */
  const blade = (tip, b) => {
    const c1 = [cur[0] + (tip[0] - cur[0]) * 0.15, cur[1] + (tip[1] - cur[1]) * 0.75];
    const c2 = [b[0] + (tip[0] - b[0]) * 0.05, b[1] + (tip[1] - b[1]) * 0.4];
    d += ` Q${pt(c1)} ${pt(tip)} Q${pt(c2)} ${pt(b)}`;
    cur = b;
  };
  const comb = rng.next() < 0.5 ? 1 : -1; // blades lean the same way along a platform

  // Start cap (left end): a few big blades hanging down and out, part of the same shape.
  moveTo(P(0, 22, -2));
  blade(P(0, 40, -13), P(0, 18, -6));
  blade(P(0, 18, -18), P(0, -4, -5));

  // Upper edge: big flame blades pointing up, combed one way, some taller.
  for (let i = 0; i < N - 1;) {
    const w = Math.max(5, Math.round(r(7, 13)));
    const e = Math.min(N - 1, i + w);
    const m = Math.round(i + (e - i) * 0.6);
    const h = rng.next() < 0.18 ? r(22, 32) : r(11, 19);
    blade(P(m, -4 - h, comb * r(6, 14)), P(e, -4));
    i = e;
  }

  // End cap (right end), mirrored.
  blade(P(N - 1, 18, 18), P(N - 1, 18, 6));
  blade(P(N - 1, 40, 13), P(N - 1, 22, 2));

  // Lower edge, right to left: blades hanging over the front of the soil.
  let depth = r(16, 20);
  lineTo(P(N - 1, depth));
  for (let i = N - 1; i > 0;) {
    const w = Math.max(5, Math.round(r(8, 14)));
    const e = Math.max(0, i - w);
    const m = Math.round(i - (i - e) * 0.5);
    depth = Math.min(22, Math.max(15, depth + r(-2, 2)));
    const drop = rng.next() < 0.2 ? r(20, 30) : r(10, 18);
    blade(P(m, depth + drop, -comb * r(2, 7)), P(e, depth));
    i = e;
  }
  // The solid part of the grass: everything under a smooth line 4 px above the surface, between
  // the platform's ends. The blade tips above it and the end blades are drawn in grass.svg only,
  // so snails walk on a smooth surface instead of on the tips.
  const line = pts.map((_, i) => pt(P(i, -4))).join(' L');
  const under = `M${line} L${f(pts[N - 1].p[0])},${H} L${f(pts[0].p[0])},${H} Z`;
  return { d: `${d} Z`, under };
}

const grassShapes = Object.values(PLATFORMS).map((p) => grassShape(p.top));
const grassMarkup = grassShapes.map((g) => `<path d="${g.d}"/>`).join('');
const underMarkup = grassShapes.map((g) => `<path d="${g.under}"/>`).join('');
const topsMarkup = Object.values(PLATFORMS)
  .map((p) => `<path d="${p.top}"/>`)
  .join('');

// ---------- Props ----------

const pot = `<path d="${POT_BODY}" fill="url(#potBody)" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round"/>
<path d="M232,418 L330,402" stroke="#F0A57C" stroke-width="5" stroke-linecap="round" opacity=".6"/>
<ellipse cx="340" cy="434" rx="16" ry="40" fill="#D27348" stroke="${OUT}" stroke-width="2.5"/>
<ellipse cx="342" cy="434" rx="9" ry="31" fill="#3A2418"/>`;
const can = `<g transform="translate(${CAN_DX},0)"><g stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round">
  <path d="${CAN_HANDLE}" fill="#3E8C8C"/>
  <path d="${CAN_SPOUT}" fill="#3E8C8C"/>
  <path d="${CAN_ROSE}" fill="#4FA3A3"/>
  <path d="${CAN_BODY}" fill="url(#canBody)"/>
</g>
<path d="M1254,382 L1252,446" stroke="#BDEAE6" stroke-width="6" stroke-linecap="round" opacity=".55"/></g>`;
const giantMushroom = `<g stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round">
  <path d="${MUSH_STEM}" fill="#F4EBDD"/>
  <path d="${MUSH_CAP}" fill="#E2453C"/>
</g>
<path d="M722,444 C760,452 828,452 862,444" stroke="#A82E26" stroke-width="5" fill="none"/>
<path d="M744,428 C752,414 770,408 790,406" stroke="#F58A7E" stroke-width="6" fill="none" stroke-linecap="round"/>
<g fill="#FFF6EC" stroke="${OUT}" stroke-width="1.5"><ellipse cx="760" cy="420" rx="9" ry="6"/><ellipse cx="800" cy="408" rx="11" ry="7"/><ellipse cx="840" cy="424" rx="8" ry="5.5"/></g>`;
const rootColumn = `<path d="${ROOT_COLUMN}" fill="#7A5236" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round"/>
<path d="M404,470 C400,448 412,434 436,424 C450,418 460,410 466,398" stroke="#A47A52" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/>`;

// Grass painting: dark base, main green shifted up (dark left under the blades), lit band, outline.
const grassPaint = `<g fill="#3E8A22">${grassMarkup}</g>
  <g clip-path="url(#grc)">
    <g fill="#6CC02E" transform="translate(0,-6)">${grassMarkup}</g>
    <g fill="none" stroke="#A8E04A" stroke-width="7" stroke-linejoin="round" transform="translate(0,-1)">${topsMarkup}</g>
  </g>
  <g fill="none" stroke="#23501A" stroke-width="2.2" stroke-linejoin="round">${grassMarkup}</g>`;

// ---------- terrain.svg ----------

// A few long, broken strata lines inside the soil (the top edge pushed down).
const strata = Object.values(PLATFORMS)
  .map((p) =>
    [40, 78, 120]
      .map((dy) => {
        const d = shift(p.top, r(-30, 30), dy + r(-6, 6));
        const dash = `${f(r(60, 160))} ${f(r(30, 70))} ${f(r(40, 110))} ${f(r(40, 90))}`;
        return `<path d="${d}" stroke="#9A6A42" stroke-width="2" stroke-dasharray="${dash}" opacity=".45" transform="translate(0,2.5)"/><path d="${d}" stroke="#2E1A0C" stroke-width="2.5" stroke-dasharray="${dash}" opacity=".55"/>`;
      })
      .join(''),
  )
  .join('');

const terrain = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- Garden map, solid layer (scripts/art/gen-garden.mjs). Opaque = solid. -->
  <defs>
    <linearGradient id="soil" gradientUnits="userSpaceOnUse" x1="0" y1="180" x2="0" y2="720"><stop offset="0" stop-color="#8A5A34"/><stop offset=".45" stop-color="#6E4426"/><stop offset="1" stop-color="#3E2412"/></linearGradient>
    <linearGradient id="potBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E08A5C"/><stop offset=".45" stop-color="#C8643B"/><stop offset="1" stop-color="#8E3F22"/></linearGradient>
    <linearGradient id="canBody" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6CC0BC"/><stop offset=".35" stop-color="#4FA3A3"/><stop offset="1" stop-color="#2A6E6E"/></linearGradient>
    <clipPath id="gc">${groundMarkup}</clipPath>
    <clipPath id="grc">${grassMarkup}</clipPath>
    <clipPath id="uc">${underMarkup}</clipPath>
  </defs>

  <!-- Soil: one shape per platform -->
  <g fill="url(#soil)">${groundMarkup}</g>
  <g clip-path="url(#gc)" fill="none" stroke-linecap="round">
    ${strata}
    <g stroke="#2A1608" stroke-width="16" opacity=".3" transform="translate(0,24)">${topsMarkup}</g>
  </g>
  <g fill="none" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round">${groundMarkup}</g>

  <!-- Props -->
  ${rootColumn}
  ${pot}
  ${can}
  ${giantMushroom}

  <!-- Grass, solid part only (the full shape is in grass.svg) -->
  <g clip-path="url(#uc)">${grassPaint}</g>
</svg>
`;

const grass = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- Garden map, non-solid front layer (scripts/art/gen-garden.mjs): the full grass shapes, drawn
       over the solid part of the same grass in terrain.svg. Craters erase it. -->
  <defs><clipPath id="grc">${grassMarkup}</clipPath></defs>
  ${grassPaint}
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
writeFileSync(join(dir, 'map.json'), `${JSON.stringify(map, null, 2)}\n`);
console.log('terrain', terrain.length);
