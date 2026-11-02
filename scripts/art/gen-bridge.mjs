// Generates the bridge map in the painterly natural style (docs/art/ART_SPEC.md, "Новий напрям
// землі"): painted soil without inner outlines, a stony underside, turf with a lit rim and a soft
// shadow, a thin silhouette outline, and a fringe of separate grass blades over the edge.
//
// Writes two files into <dir>:
//   terrain.svg - solid layer (opaque = solid), including the turf;
//   grass.svg   - non-solid front layer: grass blades over the edge and hanging lianas. The engine
//                 draws it over the terrain and erases it with every crater.
// Seeded, so the output is stable. Usage: node scripts/art/gen-bridge.mjs public/maps/bridge
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { SOIL_TILE_SIZE, soilTile } from './gen-soil-tile.mjs';

let seed = 1337;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const r = (a, b) => a + (b - a) * rnd();
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const f = (n) => Math.round(n * 10) / 10;
const OUT = '#2B1B12';
const W = 1600;
const H = 720;

// Left cliff, right cliff, rock island in the middle.
const GROUND = [
  'M0,720 L0,600 C10,560 0,520 20,480 C34,452 70,430 120,424 L380,424 C430,424 470,430 500,446 C524,460 512,484 530,504 C552,530 518,562 540,600 C558,632 538,672 560,720 Z',
  'M1600,720 L1600,600 C1590,560 1600,520 1580,480 C1566,452 1530,426 1480,420 L1220,420 C1170,420 1130,428 1100,444 C1076,458 1088,482 1070,502 C1048,530 1082,562 1060,600 C1042,634 1062,672 1040,720 Z',
  'M720,720 C724,660 700,610 730,570 C750,546 790,536 820,540 C860,546 880,570 876,610 C872,660 890,690 884,720 Z',
].join(' ');
// Grassy edges (the original surface), drawn from the outer side towards the gap.
const SURFACES = [
  'M2,604 C10,560 0,520 20,480 C34,452 70,430 120,424 L380,424 C430,424 470,430 500,446 C516,455 518,466 520,476',
  'M1598,604 C1590,560 1600,520 1580,480 C1566,452 1530,426 1480,420 L1220,420 C1170,420 1130,428 1100,444 C1086,452 1082,462 1080,472',
  'M722,586 C730,570 750,546 790,540 C820,537 860,546 872,580',
];

const groundPx = new Resvg(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><path d="${GROUND}"/></svg>`,
).render().pixels;
const solid = (x, y) => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return false;
  return groundPx[(yi * W + xi) * 4 + 3] >= 128;
};

/** Samples an absolute M/L/C path every ~`step` px: points with unit tangent and air-side normal. */
function sample(d, step) {
  const nums = d.match(/[MLC]|-?\d+(\.\d+)?/g);
  const segs = [];
  let cur = null;
  for (let i = 0; i < nums.length;) {
    const c = nums[i++];
    if (c === 'M') cur = [+nums[i++], +nums[i++]];
    else if (c === 'L') {
      const p0 = cur;
      const p = [+nums[i++], +nums[i++]];
      segs.push((t) => [p0[0] + (p[0] - p0[0]) * t, p0[1] + (p[1] - p0[1]) * t]);
      cur = p;
    } else {
      const p0 = cur;
      const p1 = [+nums[i++], +nums[i++]];
      const p2 = [+nums[i++], +nums[i++]];
      const p3 = [+nums[i++], +nums[i++]];
      segs.push((t) => {
        const u = 1 - t;
        return [0, 1].map(
          (k) =>
            u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k],
        );
      });
      cur = p3;
    }
  }
  const dense = [];
  for (const s of segs) for (let k = 0; k < 200; k++) dense.push(s(k / 200));
  const out = [];
  let acc = 0;
  for (let i = 1; i < dense.length - 1; i++) {
    acc += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    if (acc < step) continue;
    acc = 0;
    const tx = dense[i + 1][0] - dense[i - 1][0];
    const ty = dense[i + 1][1] - dense[i - 1][1];
    const len = Math.hypot(tx, ty) || 1;
    let n = [-ty / len, tx / len];
    if (solid(dense[i][0] + n[0] * 6, dense[i][1] + n[1] * 6)) n = [-n[0], -n[1]];
    out.push({ p: dense[i], t: [tx / len, ty / len], n });
  }
  return out;
}

/** Smooth closed blob around (0, 0). */
function blob(rx, ry, n = 8, jit = 0.14) {
  const pts = [];
  const a0 = r(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + r(-0.18, 0.18);
    const k = 1 + r(-jit, jit);
    pts.push([Math.cos(a) * rx * k, Math.sin(a) * ry * k]);
  }
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return `${d}Z`;
}

/** A painted stone: soft shadow, body, darker lower half, lit top-left. `edge` adds a thin outline. */
function stone(x, y, rx, ry, edge = false) {
  const d = blob(rx, ry);
  const body = pick(['#6E5E52', '#7C6A5C', '#655548', '#857262']);
  return (
    `<ellipse cx="${f(x + rx * 0.15)}" cy="${f(y + ry * 0.5)}" rx="${f(rx * 1.2)}" ry="${f(ry * 0.85)}" fill="url(#sh)"/>` +
    `<path d="${d}" transform="translate(${f(x)},${f(y)})" fill="${body}"${edge ? ` stroke="${OUT}" stroke-width="2"` : ''}/>` +
    `<path d="${d}" transform="translate(${f(x + rx * 0.06)},${f(y + ry * 0.24)}) scale(.8)" fill="#000" opacity=".18"/>` +
    `<path d="${d}" transform="translate(${f(x - rx * 0.2)},${f(y - ry * 0.3)}) scale(.52)" fill="#A8927A" opacity=".55"/>` +
    `<circle cx="${f(x - rx * 0.3)}" cy="${f(y - ry * 0.4)}" r="${f(Math.max(1, rx * 0.1))}" fill="#E0D0BA" opacity=".6"/>`
  );
}

// ---------- terrain.svg (solid) ----------

// Stony underside: stones packed along the bottom and the inner cliff faces.
const stones = [];
const stoneAt = (x, y, rx) => {
  if (!solid(x, y)) return;
  stones.push(stone(x, y, rx, rx * r(0.6, 0.8)));
};
for (let y = 720; y > 560; y -= 26) {
  const k = (720 - y) / 160; // fewer, smaller stones higher up
  for (let x = r(-10, 20); x < W; x += r(34, 58) * (1 + k)) {
    if (rnd() < k * 0.7) continue;
    stoneAt(x, y + r(-8, 8), r(14, 30) * (1 - k * 0.4));
  }
}
for (const [x0, x1] of [
  [500, 560],
  [1040, 1100],
  [700, 740],
  [856, 896],
]) {
  for (let y = 470; y < 640; y += r(22, 34)) stoneAt(r(x0, x1), y, r(10, 20));
}

const { defs: tileDefs, body: tileBody } = soilTile();
const surfaceUses = SURFACES.map((d) => `<path d="${d}"/>`).join('');

const planks = [];
const deckY = (t) => 446 + 160 * t - 162 * t * t; // Q(496,446)(800,526)(1104,444), x = 496 + 608t
const deckAng = (t) => (Math.atan2(160 - 324 * t, 608) * 180) / Math.PI;
for (let x = 512; x <= 1090; x += 29) {
  const t = (x - 496) / 608;
  const w = r(25, 28);
  planks.push(
    `<g transform="translate(${f(x)},${f(deckY(t) + r(-1, 1))}) rotate(${f(deckAng(t) + r(-2.5, 2.5))})">` +
      `<rect x="${f(-w / 2)}" y="-9" width="${f(w)}" height="18" rx="3" fill="${pick(['#A8743F', '#9E6B39', '#B07A44'])}" stroke="${OUT}" stroke-width="2"/>` +
      `<path d="M${f(-w / 2 + 3)},-6 H${f(w / 2 - 3)}" stroke="#D29B62" stroke-width="2" stroke-linecap="round" opacity=".8"/>` +
      `<path d="M${f(-w / 2 + 3)},6 H${f(w / 2 - 3)}" stroke="#6B4524" stroke-width="2.5" stroke-linecap="round" opacity=".6"/>` +
      `<path d="M${f(-w / 2 + 5)},1 q6,2 12,0" stroke="#7A5230" stroke-width="1.2" fill="none"/></g>`,
  );
}
const wood = (x, y, w, h, rot = 0) =>
  `<g transform="rotate(${rot} ${x + w / 2} ${y + h / 2})"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#9E6B39" stroke="${OUT}" stroke-width="2"/>` +
  `<path d="M${x + 4},${y + 4} V${y + h - 5}" stroke="#D29B62" stroke-width="2.5" stroke-linecap="round" opacity=".8"/>` +
  `<path d="M${x + w - 4},${y + 4} V${y + h - 5}" stroke="#6B4524" stroke-width="3" stroke-linecap="round" opacity=".6"/></g>`;

const mushroom = (x, y, s) =>
  `<g transform="translate(${x},${y}) scale(${s})"><rect x="-3.5" y="-15" width="7" height="17" rx="2.5" fill="#F4EBDD" stroke="${OUT}" stroke-width="1.6"/>` +
  `<path d="M-13,-12 C-13,-29 13,-29 13,-12 Z" fill="#E2453C" stroke="${OUT}" stroke-width="1.8" stroke-linejoin="round"/>` +
  `<path d="M-13,-12 C-9,-15 9,-15 13,-12" fill="none" stroke="#A82E26" stroke-width="2.5"/>` +
  `<path d="M-8,-17 C-7,-22 -3,-24 1,-24" stroke="#F58A7E" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
  `<circle cx="-5" cy="-18" r="2.2" fill="#fff"/><circle cx="5" cy="-20" r="2.6" fill="#fff"/></g>`;

const boulder = stone(440, 396, 48, 40, true);
const pot = `<path d="M1142,430 L1148,412 L1158,354 C1158,348 1222,348 1222,354 L1232,412 L1238,430 Z" fill="#C8643B" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>
<path d="M1196,352 L1206,410 L1232,410 L1222,354 C1218,351 1205,351 1196,352 Z" fill="#8E3F22" opacity=".45"/>
<path d="M1142,430 L1148,410 L1232,410 L1238,430 Z" fill="#D27348" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>
<path d="M1206,412 L1210,428 L1236,428 L1232,412 Z" fill="#8E3F22" opacity=".4"/>
<path d="M1166,358 C1163,374 1162,390 1160,404" stroke="#F0A57C" stroke-width="5" stroke-linecap="round" opacity=".75"/>
<path d="M1150,414 H1200" stroke="#F0A57C" stroke-width="2.5" stroke-linecap="round" opacity=".75"/>
<ellipse cx="1190" cy="351" rx="11" ry="3" fill="#3A2418"/>`;

const terrain = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- Bridge map, solid layer (generated by scripts/art/gen-bridge.mjs, painterly natural style). Opaque = solid. -->
  <defs>
    <pattern id="soil" width="${SOIL_TILE_SIZE}" height="${SOIL_TILE_SIZE}" patternUnits="userSpaceOnUse">${tileBody}</pattern>
    ${tileDefs}
    <radialGradient id="sh"><stop offset="0" stop-color="#1E120A" stop-opacity=".6"/><stop offset="1" stop-color="#1E120A" stop-opacity="0"/></radialGradient>
    <path id="ground" d="${GROUND}"/>
    <clipPath id="gc"><use href="#ground"/></clipPath>
    <linearGradient id="depth" gradientUnits="userSpaceOnUse" x1="0" y1="430" x2="0" y2="720">
      <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/>
    </linearGradient>
  </defs>
  <use href="#ground" fill="url(#soil)"/>
  <g clip-path="url(#gc)">
    ${stones.join('')}
    <rect y="400" width="${W}" height="320" fill="url(#depth)"/>
    <!-- Turf: soft shadow under it, dark base, lit top, bright rim -->
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <g stroke="#1E120A" stroke-width="56" opacity=".3">${surfaceUses}</g>
      <g stroke="#1E120A" stroke-width="40" opacity=".25">${surfaceUses}</g>
      <g stroke="#3F7F2A" stroke-width="30">${surfaceUses}</g>
      <g stroke="#5DAA3A" stroke-width="18">${surfaceUses}</g>
      <g stroke="#8ED15A" stroke-width="8">${surfaceUses}</g>
      <g stroke="#C4EE84" stroke-width="3">${surfaceUses}</g>
    </g>
  </g>
  <use href="#ground" fill="none" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
  <!-- Island post and struts -->
  ${wood(690, 470, 16, 92, -42)}${wood(894, 470, 16, 92, 42)}${wood(790, 484, 20, 64)}
  <!-- Cliff posts -->
  ${wood(502, 392, 18, 62)}${wood(1080, 390, 18, 62)}
  <ellipse cx="511" cy="393" rx="10" ry="4.5" fill="#D29B62" stroke="${OUT}" stroke-width="2"/>
  <ellipse cx="1089" cy="391" rx="10" ry="4.5" fill="#D29B62" stroke="${OUT}" stroke-width="2"/>
  <!-- Deck: a solid beam under the planks so the deck never has holes -->
  <path d="M496,446 Q800,526 1104,444" fill="none" stroke="${OUT}" stroke-width="14"/>
  <path d="M496,446 Q800,526 1104,444" fill="none" stroke="#5E3C20" stroke-width="10"/>
  ${planks.join('')}
  <!-- Cover: a stone on the left, an upturned clay pot on the right -->
  ${boulder}
  ${pot}
  ${mushroom(200, 425, 1.35)}${mushroom(222, 425, 0.8)}${mushroom(846, 547, 1.1)}${mushroom(1410, 421, 1.2)}
</svg>
`;

// ---------- grass.svg (non-solid front layer) ----------

const GREENS = ['#4E8F2E', '#5DAA3A', '#6FC046', '#56A035'];
const TIPS = ['#9BD84A', '#B2E36A', '#8ED15A'];
/** One blade: base `b` on the edge, growing along `dir`, drooping with gravity. */
function blade(b, dir, h, w, back) {
  const droop = h * 0.35 * (1 - Math.abs(dir[1])); // sideways blades sag more
  const tip = [b[0] + dir[0] * h, b[1] + dir[1] * h + droop];
  const mid = [b[0] + dir[0] * h * 0.55, b[1] + dir[1] * h * 0.55];
  const side = [-dir[1], dir[0]];
  const l = [b[0] - side[0] * w, b[1] - side[1] * w];
  const rr = [b[0] + side[0] * w, b[1] + side[1] * w];
  const d = `M${f(l[0])},${f(l[1])} Q${f(mid[0] - side[0] * w * 0.4)},${f(mid[1] - side[1] * w * 0.4)} ${f(tip[0])},${f(tip[1])} Q${f(mid[0] + side[0] * w * 0.5)},${f(mid[1] + side[1] * w * 0.5)} ${f(rr[0])},${f(rr[1])} Z`;
  if (back) return `<path d="${d}" fill="${pick(['#3F7F2A', '#4A8A2F'])}"/>`;
  const rib = `M${f(mid[0])},${f(mid[1])} Q${f((mid[0] + tip[0]) / 2)},${f((mid[1] + tip[1]) / 2 - 1)} ${f(tip[0])},${f(tip[1])}`;
  return `<path d="${d}" fill="${pick(GREENS)}" stroke="#2F5E1E" stroke-width="1"/><path d="${rib}" stroke="${pick(TIPS)}" stroke-width="${f(w * 0.55)}" stroke-linecap="round" fill="none"/>`;
}
const rotate = (v, deg) => {
  const a = (deg * Math.PI) / 180;
  return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
};

const backBlades = [];
const teeth = [];
const frontBlades = [];
for (const d of SURFACES) {
  // Clump height: a slow wave along the edge, so grass grows in patches.
  const phase = r(0, 6.28);
  // Turf fringe: pointed tongues hanging over the soil just under the edge.
  for (const s of sample(d, 7)) {
    const L = r(7, 17);
    const a = [s.p[0] - s.t[0] * r(4, 6) - s.n[0] * 2, s.p[1] - s.t[1] * r(4, 6) - s.n[1] * 2];
    const b = [s.p[0] + s.t[0] * r(4, 6) - s.n[0] * 2, s.p[1] + s.t[1] * r(4, 6) - s.n[1] * 2];
    const lean = r(-3, 3);
    const tip = [
      s.p[0] - s.n[0] * (L + 8) + s.t[0] * lean,
      s.p[1] - s.n[1] * (L + 8) + s.t[1] * lean,
    ];
    const qa = [(a[0] + tip[0]) / 2 - s.t[0] * 2, (a[1] + tip[1]) / 2 - s.t[1] * 2];
    const qb = [(b[0] + tip[0]) / 2 + s.t[0] * 2, (b[1] + tip[1]) / 2 + s.t[1] * 2];
    teeth.push(
      `<path d="M${f(a[0])},${f(a[1])} Q${f(qa[0])},${f(qa[1])} ${f(tip[0])},${f(tip[1])} Q${f(qb[0])},${f(qb[1])} ${f(b[0])},${f(b[1])} Z" fill="${pick(['#3F7F2A', '#4A8A2F', '#468530'])}" stroke="#24461A" stroke-width="1"/>`,
    );
  }
  for (const s of sample(d, 3.2)) {
    const base = [s.p[0] - s.n[0] * 3, s.p[1] - s.n[1] * 3];
    const clump = 0.6 + 0.4 * Math.sin(s.p[0] / 37 + phase) * Math.sin(s.p[0] / 13 + phase * 2);
    backBlades.push(blade(base, rotate(s.n, r(-32, 32)), r(8, 16) * clump + 4, r(2.4, 3.4), true));
  }
  for (const s of sample(d, 4.2)) {
    if (rnd() < 0.15) continue;
    const base = [s.p[0] - s.n[0] * 2, s.p[1] - s.n[1] * 2];
    const clump = 0.55 + 0.45 * Math.abs(Math.sin(s.p[0] / 29 + phase));
    const steep = 1 - Math.abs(s.n[1]); // hanging edges get longer blades
    frontBlades.push(
      blade(
        base,
        rotate(s.n, r(-30, 30)),
        r(12, 27) * clump + steep * r(8, 18),
        r(2.8, 4.2),
        false,
      ),
    );
  }
}
// Small tufts on the covers.
for (const [x, y, n] of [
  [420, 360, 7],
  [1180, 349, 5],
]) {
  for (let i = 0; i < n; i++)
    frontBlades.push(blade([x + i * 5, y + 2], rotate([0, -1], r(-25, 25)), r(8, 14), 2.6, false));
}

/** A liana hanging from the edge: a thick wavy vine with leaves. */
function liana(points) {
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    d += ` Q${f((p[0] + q[0]) / 2 + r(-14, 14))},${f((p[1] + q[1]) / 2)} ${q[0]},${q[1]}`;
  }
  const leaves = points
    .slice(1)
    .map(([x, y], i) => {
      const s = i % 2 ? 1 : -1;
      return `<path d="M${x},${y} c${s * 6},-8 ${s * 16},-8 ${s * 18},-1 c${-s * 6},6 ${-s * 14},6 ${-s * 18},1 Z" fill="${pick(GREENS)}" stroke="#2F5E1E" stroke-width="1"/>`;
    })
    .join('');
  return `<path d="${d}" stroke="#24461A" stroke-width="8" fill="none" stroke-linecap="round"/><path d="${d}" stroke="#4E8F2E" stroke-width="5" fill="none" stroke-linecap="round"/><path d="${d}" stroke="#8ED15A" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".7" transform="translate(-1.5,-1)"/>${leaves}`;
}

const grass = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- Bridge map, non-solid front layer (generated by scripts/art/gen-bridge.mjs): grass fringe and lianas.
       Drawn over the terrain; craters erase it. -->
  ${liana([
    [478, 440],
    [500, 486],
    [492, 530],
    [512, 572],
    [506, 606],
  ])}
  ${liana([
    [1122, 432],
    [1098, 474],
    [1108, 520],
    [1090, 560],
  ])}
  ${liana([
    [30, 470],
    [14, 520],
    [26, 566],
  ])}
  ${teeth.join('')}
  ${backBlades.join('')}
  ${frontBlades.join('')}
</svg>
`;

const dir = process.argv[2];
writeFileSync(join(dir, 'terrain.svg'), terrain);
writeFileSync(join(dir, 'grass.svg'), grass);
console.log('terrain', terrain.length, 'grass', grass.length, 'bytes');
