// Generates public/maps/bridge/terrain.svg in the "chunky cartoon" style:
// big outlined clods with 3-tone volume, moss caps that drape over edges, outlined planks.
// Seeded, so the output is stable. Usage: node scripts/art/gen-bridge.mjs public/maps/bridge/terrain.svg
import { writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

let seed = 1337;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const r = (a, b) => a + (b - a) * rnd();
const f = (n) => Math.round(n * 10) / 10;
const OUT = '#2B1B12';

/** Closed smooth blob through jittered points around an ellipse (Catmull-Rom -> cubic). */
function blob(cx, cy, rx, ry, n = 8, jit = 0.14) {
  const pts = [];
  const a0 = r(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + r(-0.18, 0.18);
    const k = 1 + r(-jit, jit);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n],
      p1 = pts[i],
      p2 = pts[(i + 1) % n],
      p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + 'Z';
}

/** One clod with cel shading: shadow body, lit body shifted up, highlight, outline. */
function clod(cx, cy, rx, ry, pal) {
  const d = blob(cx, cy, rx, ry);
  const base = pal.base[Math.floor(rnd() * pal.base.length)];
  const s = (k, dx, dy) =>
    `transform="translate(${f(cx + dx)},${f(cy + dy)}) scale(${k}) translate(${f(-cx)},${f(-cy)})"`;
  return (
    `<g><path d="${d}" fill="${pal.shadow}"/>` +
    `<path d="${d}" fill="${base}" ${s(0.9, -1, -ry * 0.1)}/>` +
    `<path d="${d}" fill="${pal.light}" opacity=".85" ${s(0.42, -rx * 0.22, -ry * 0.42)}/>` +
    `<path d="${d}" fill="none" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/></g>`
  );
}

const SOIL = {
  base: ['#5C3A24', '#53331F', '#644129', '#583722'],
  shadow: '#3A2414',
  light: '#86593A',
};
const STONE = { base: ['#7A6656'], shadow: '#54443A', light: '#A8937E' };

// Landmasses: left cliff, right cliff, island.
const GROUND = `M0,720 L0,600 C10,560 0,520 20,480 C34,452 70,430 120,424 L380,424 C430,424 470,430 500,446 C524,460 512,484 530,504 C552,530 518,562 540,600 C558,632 538,672 560,720 Z
M1600,720 L1600,600 C1590,560 1600,520 1580,480 C1566,452 1530,426 1480,420 L1220,420 C1170,420 1130,428 1100,444 C1076,458 1088,482 1070,502 C1048,530 1082,562 1060,600 C1042,634 1062,672 1040,720 Z
M720,720 C724,660 700,610 730,570 C750,546 790,536 820,540 C860,546 880,570 876,610 C872,660 890,690 884,720 Z`;
// Top edges that carry moss.
const SURFACES = [
  'M2,604 C10,560 0,520 20,480 C34,452 70,430 120,424 L380,424 C430,424 470,430 500,446',
  'M1598,604 C1590,560 1600,520 1580,480 C1566,452 1530,426 1480,420 L1220,420 C1170,420 1130,428 1100,444',
  'M728,574 C750,546 790,536 820,540 C860,546 880,570 876,612',
];

// Clods on a jittered brick grid; lower rows first so upper clods overlap them.
const clods = [];
for (let row = 5; row >= 0; row--) {
  const y = 400 + row * 62;
  for (let col = -1; col < 18; col++) {
    const x = col * 96 + (row % 2) * 48 + r(-16, 16);
    clods.push(clod(x, y + r(-10, 10), r(46, 62), r(32, 40), SOIL));
  }
}

// Moss: outline underlay, fill, lit top line, drips hanging below the band.
const drips = [];
for (const s of [
  [40, 500],
  [1100, 1560],
  [730, 870],
]) {
  for (let x = s[0] + r(0, 20); x < s[1]; x += r(26, 48)) drips.push(x);
}
// Real top surface, read from a raster of the ground shape.
const groundPx = new Resvg(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="720"><path d="${GROUND.replace(/\n/g, ' ')}"/></svg>`,
).render().pixels;
function surfaceY(x) {
  const xi = Math.max(0, Math.min(1599, Math.round(x)));
  for (let y = 300; y < 720; y++) if (groundPx[(y * 1600 + xi) * 4 + 3] >= 128) return y;
  return 720;
}
const dripShapes = drips
  .filter((x) => Math.abs(surfaceY(x + 6) - surfaceY(x - 6)) < 9) // only where the edge is fairly flat
  .map((x) => {
    const y = surfaceY(x) + 12;
    const w = r(8, 14),
      h = r(10, 22);
    return `M${f(x - w)},${f(y - 8)} C${f(x - w * 1.05)},${f(y + h)} ${f(x + w * 1.05)},${f(y + h)} ${f(x + w)},${f(y - 8)} Z`;
  });
const mossSurf = SURFACES.map((d) => `<path d="${d}"/>`).join('');
const moss = `
<g fill="none" stroke="${OUT}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round">${mossSurf}</g>
<g fill="${OUT}" stroke="${OUT}" stroke-width="7" stroke-linejoin="round">${dripShapes.map((d) => `<path d="${d}"/>`).join('')}</g>
<g fill="#4E9A33">${dripShapes.map((d) => `<path d="${d}"/>`).join('')}</g>
<g fill="none" stroke="#5DAA3A" stroke-width="33" stroke-linecap="round" stroke-linejoin="round">${mossSurf}</g>
<g fill="none" stroke="#6FC046" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" transform="translate(0,-6)">${mossSurf}</g>
<g fill="none" stroke="#A6E070" stroke-width="4" stroke-linecap="round" stroke-dasharray="26 18 8 30" transform="translate(0,-12)">${mossSurf}</g>
<g fill="none" stroke="#4E9A33" stroke-width="7" stroke-linecap="round" stroke-dasharray="0 23 0 37" transform="translate(0,7)">${mossSurf}</g>`;

// Grass tufts with outline.
function tuft(x, y, s = 1) {
  const blade = (dx, h, lean) =>
    `M${f(x + dx - 4.5 * s)},${f(y)} Q${f(x + dx + lean * 0.3 - 2 * s)},${f(y - h * 0.6)} ${f(x + dx + lean)},${f(y - h)} Q${f(x + dx + lean * 0.3 + 3 * s)},${f(y - h * 0.5)} ${f(x + dx + 4.5 * s)},${f(y)} Z`;
  const d = [
    blade(-9 * s, 13 * s, -9 * s),
    blade(-4 * s, 20 * s, -4 * s),
    blade(1 * s, 25 * s, 2 * s),
    blade(6 * s, 18 * s, 6 * s),
    blade(10 * s, 12 * s, 10 * s),
  ].join(' ');
  return `<path d="${d}" fill="#8ED15A" stroke="${OUT}" stroke-width="2.2" stroke-linejoin="round"/>`;
}

// Bridge planks along Q(496,446)(800,526)(1104,444): x(t) = 496 + 608t.
const deckY = (t) => 446 + 160 * t - 162 * t * t;
const deckAng = (t) => (Math.atan2(160 - 324 * t, 608) * 180) / Math.PI;
const planks = [];
for (let x = 512; x <= 1090; x += 29) {
  const t = (x - 496) / 608;
  const w = r(25, 28),
    dy = r(-1, 1);
  planks.push(
    `<g transform="translate(${f(x)},${f(deckY(t) + dy)}) rotate(${f(deckAng(t) + r(-2.5, 2.5))})">` +
      `<rect x="${f(-w / 2)}" y="-9" width="${f(w)}" height="18" rx="3.5" fill="${['#B07A44', '#A8743F', '#B8844D'][Math.floor(rnd() * 3)]}" stroke="${OUT}" stroke-width="2.5"/>` +
      `<path d="M${f(-w / 2 + 4)},-4 H${f(w / 2 - 5)}" stroke="#D29B62" stroke-width="2" stroke-linecap="round"/>` +
      `<path d="M${f(-w / 2 + 5)},3 q6,2 12,0" stroke="#7A5230" stroke-width="1.4" fill="none"/></g>`,
  );
}

const woodRect = (x, y, w, h, rot = 0) =>
  `<g transform="rotate(${rot} ${x + w / 2} ${y + h / 2})"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#A8743F" stroke="${OUT}" stroke-width="3"/>` +
  `<path d="M${x + 5},${y + 4} V${y + h - 6}" stroke="#D29B62" stroke-width="2.5" stroke-linecap="round"/></g>`;

const mushroom = (x, y, s) =>
  `<g transform="translate(${x},${y}) scale(${s})"><rect x="-3.5" y="-15" width="7" height="16" rx="2.5" fill="#F4EBDD" stroke="${OUT}" stroke-width="2"/>` +
  `<path d="M-13,-12 C-13,-29 13,-29 13,-12 Z" fill="#E2453C" stroke="${OUT}" stroke-width="2.2" stroke-linejoin="round"/>` +
  `<path d="M-8,-17 C-7,-22 -3,-24 1,-24" stroke="#F58A7E" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
  `<circle cx="-5" cy="-18" r="2.2" fill="#fff"/><circle cx="5" cy="-20" r="2.6" fill="#fff"/></g>`;

// Covers: a mossy boulder on the left, an upturned clay pot on the right.
const boulder =
  clod(440, 396, 48, 40, STONE) +
  `<path d="M404,374 C414,352 446,350 462,362" stroke="${OUT}" stroke-width="16" fill="none" stroke-linecap="round"/>` +
  `<path d="M404,374 C414,352 446,350 462,362" stroke="#5DAA3A" stroke-width="11" fill="none" stroke-linecap="round"/>` +
  `<path d="M410,368 C420,354 442,353 455,360" stroke="#8ED15A" stroke-width="3" fill="none" stroke-linecap="round"/>`;
const pot = `<path d="M1142,430 L1148,412 L1158,354 C1158,348 1222,348 1222,354 L1232,412 L1238,430 Z" fill="#CC6A3F" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
<path d="M1142,430 L1148,410 L1232,410 L1238,430 Z" fill="#D97A4E" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
<path d="M1206,356 L1214,406 L1228,406 L1220,356 Z" fill="#A84E2C" opacity=".55"/>
<path d="M1164,360 L1158,400" stroke="#EFA27A" stroke-width="4" stroke-linecap="round"/>
<path d="M1154,376 H1226 M1152,392 H1228" stroke="#A84E2C" stroke-width="2.5"/>
<path d="M1146,414 H1234" stroke="#EFA27A" stroke-width="2.5"/>
<ellipse cx="1190" cy="351" rx="12" ry="3.5" fill="#3A2418"/>
<path d="M1160,352 C1166,342 1180,340 1186,346" stroke="${OUT}" stroke-width="13" fill="none" stroke-linecap="round"/>
<path d="M1160,352 C1166,342 1180,340 1186,346" stroke="#5DAA3A" stroke-width="8" fill="none" stroke-linecap="round"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="720" viewBox="0 0 1600 720">
  <!-- Bridge map, solid layer (generated by gen-bridge.mjs, chunky cartoon style). Opaque = solid. -->
  <defs>
    <path id="ground" d="${GROUND.replace(/\n/g, ' ')}"/>
    <clipPath id="gc"><use href="#ground"/></clipPath>
    <linearGradient id="depth" gradientUnits="userSpaceOnUse" x1="0" y1="440" x2="0" y2="720">
      <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/>
    </linearGradient>
  </defs>
  <use href="#ground" fill="#2A1A10"/>
  <g clip-path="url(#gc)">${clods.join('')}<rect y="380" width="1600" height="340" fill="url(#depth)"/></g>
  <use href="#ground" fill="none" stroke="${OUT}" stroke-width="7" stroke-linejoin="round"/>
  ${moss}
  <!-- Post and struts from the island to the deck -->
  ${woodRect(690, 470, 16, 92, -42)}${woodRect(894, 470, 16, 92, 42)}${woodRect(790, 484, 20, 64)}
  <!-- Cliff posts -->
  ${woodRect(502, 392, 18, 62)}${woodRect(1080, 390, 18, 62)}
  <ellipse cx="511" cy="393" rx="10" ry="4.5" fill="#D29B62" stroke="${OUT}" stroke-width="2.5"/>
  <ellipse cx="1089" cy="391" rx="10" ry="4.5" fill="#D29B62" stroke="${OUT}" stroke-width="2.5"/>
  <!-- Deck: solid beam under the planks so the deck never has holes -->
  <path d="M496,446 Q800,526 1104,444" fill="none" stroke="${OUT}" stroke-width="16"/>
  <path d="M496,446 Q800,526 1104,444" fill="none" stroke="#6B4524" stroke-width="10"/>
  ${planks.join('')}
  <path d="M572,463 q6,-11 12,0 q6,11 12,0 M712,488 q6,-11 12,0 q6,11 12,0 M880,489 q6,-11 12,0 q6,11 12,0 M1012,467 q6,-11 12,0 q6,11 12,0" stroke="${OUT}" stroke-width="6" fill="none" stroke-linecap="round"/>
  <path d="M572,463 q6,-11 12,0 q6,11 12,0 M712,488 q6,-11 12,0 q6,11 12,0 M880,489 q6,-11 12,0 q6,11 12,0 M1012,467 q6,-11 12,0 q6,11 12,0" stroke="#4E9A33" stroke-width="3" fill="none" stroke-linecap="round"/>
  <!-- Cover -->
  ${boulder}
  ${pot}
  <!-- Surface decor -->
  ${tuft(160, 416)}${tuft(350, 416, 0.9)}${tuft(1270, 412)}${tuft(1450, 412, 1.1)}${tuft(810, 534, 0.8)}${tuft(60, 444, 0.9)}${tuft(1540, 440, 0.9)}
  ${mushroom(200, 414, 1.35)}${mushroom(222, 415, 0.8)}${mushroom(846, 534, 1.1)}${mushroom(1410, 412, 1.2)}
  <g stroke="${OUT}" stroke-width="1.8"><circle cx="128" cy="413" r="4.5" fill="#DDF7FF"/><circle cx="1490" cy="409" r="4" fill="#DDF7FF"/></g>
  <g fill="#fff"><circle cx="126.5" cy="411.5" r="1.4"/><circle cx="1488.6" cy="407.6" r="1.2"/></g>
</svg>
`;
writeFileSync(process.argv[2], svg);
console.log('written', svg.length, 'bytes');
