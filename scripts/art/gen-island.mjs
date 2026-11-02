// Generates the "island" test map (public/maps/island): one organic island in the water, the
// reference piece for the terrain style. The materials come from SVG filters rendered by resvg,
// not from repeated primitives: the soil is a lit fractal-noise texture under a rounded bevel,
// stones are irregular blobs lit from the top left with soft cast shadows, and the grass is
// clusters of curved blades with a specular gloss per cluster.
//
// Layers: terrain.svg is solid (soil body, stones, turf band); back.svg holds the tall dark
// grass behind; grass.svg holds the main grass clusters and the hanging roots (erased by
// craters). Seeded, so the output is stable. Usage: node scripts/art/gen-island.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { f, makeRng, OUT } from './paint-lib.mjs';

const DIR = 'public/maps/island';
const W = 1600;
const H = 720;
const WATER = 662;
const rng = makeRng(4242);
const { r } = rng;

/** Smooth closed path through points (Catmull-Rom -> cubic). */
function closed(pts) {
  const n = pts.length;
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return `${d}Z`;
}

const poly = (pts) => `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')}`;

// --- Silhouette ---------------------------------------------------------------------------------
// An x-monotone island: the top is a rolling surface with a mound and rounded shoulders; the
// underside dives into the water in the middle and overhangs at both ends, with lobes and knobs.

const X0 = 150;
const X1 = 1450;
const CX = 800;
const HW = (X1 - X0) / 2;
const ph = [r(0, 6), r(0, 6), r(0, 6)];
const gauss = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

function top(x) {
  const y =
    404 -
    48 * gauss(x, 880, 190) -
    18 * gauss(x, 380, 90) +
    9 * Math.sin(x / 88 + ph[0]) +
    4 * Math.sin(x / 37 + ph[1]);
  const s = Math.max(0, 1 - Math.min(x - X0, X1 - x) / 90);
  return y + s * s * 52;
}

function bottom(x) {
  const u = Math.min(1, Math.abs(x - CX) / HW);
  const body = 36 + 430 * Math.max(0, 1 - u ** 1.7);
  const lobes = 14 * Math.sin(x / 47 + ph[2]) + 7 * Math.sin(x / 17 + ph[0] * 2);
  const knobs = 48 * gauss(x, 300, 26) + 36 * gauss(x, 1330, 30) + 22 * gauss(x, 1240, 18);
  return Math.min(H + 12, top(x) + body + lobes * (0.4 + 0.6 * u) + knobs);
}

/** Outward (air-side) unit normal of the top surface at x. */
function normal(x) {
  const s = (top(x + 4) - top(x - 4)) / 8;
  const len = Math.hypot(s, 1);
  return [s / len, -1 / len];
}

const outline = (() => {
  const pts = [];
  pts.push([X0 - 16, (top(X0) + bottom(X0)) / 2]);
  for (let x = X0; x <= X1; x += 16) pts.push([x, top(x)]);
  pts.push([X1 + 16, (top(X1) + bottom(X1)) / 2]);
  for (let x = X1; x >= X0; x -= 16) pts.push([x, bottom(x)]);
  return closed(pts);
})();

// --- Shared defs --------------------------------------------------------------------------------

const STONES = [
  { l: '#E2CFB0', m: '#AE9479', d: '#5C4838' },
  { l: '#D4C3AE', m: '#968574', d: '#4F4336' },
  { l: '#E8C19A', m: '#B4845F', d: '#68432C' },
  { l: '#C9CCBE', m: '#8E9184', d: '#4A4C44' },
];
const CLOD = { l: '#A8754A', m: '#74492A', d: '#3A2213' };

const stoneDefs = [...STONES, CLOD]
  .map(
    (p, i) =>
      `<radialGradient id="st${i}" cx=".4" cy=".34" r=".78" fx=".32" fy=".24">` +
      `<stop offset="0" stop-color="${p.l}"/><stop offset=".5" stop-color="${p.m}"/>` +
      `<stop offset="1" stop-color="${p.d}"/></radialGradient>`,
  )
  .join('');

const blur = (id, sd) =>
  `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

const softDefs = blur('soft1', 1.2) + blur('soft2', 2.5) + blur('soft4', 4) + blur('soft12', 12);

// Soil: a vertical warm-brown gradient multiplied by fractal noise lit from the top left, so
// it reads as painted, lumpy earth instead of a flat fill.
const soilDefs =
  `<linearGradient id="soilBase" gradientUnits="userSpaceOnUse" x1="0" y1="340" x2="0" y2="700">` +
  `<stop offset="0" stop-color="#8A5A34"/><stop offset=".35" stop-color="#6B4127"/>` +
  `<stop offset="1" stop-color="#3E2516"/></linearGradient>` +
  `<filter id="soilTex" x="0" y="0" width="1" height="1">` +
  `<feTurbulence type="fractalNoise" baseFrequency=".013 .022" numOctaves="4" seed="11" result="n"/>` +
  `<feDiffuseLighting in="n" surfaceScale="6" diffuseConstant="1.2" lighting-color="#fff" result="l">` +
  `<feDistantLight azimuth="225" elevation="46"/></feDiffuseLighting>` +
  `<feComposite in="SourceGraphic" in2="l" operator="arithmetic" k1="1.15" result="t"/>` +
  `<feComposite in="t" in2="SourceAlpha" operator="in"/></filter>` +
  // Rounded volume of the whole body: its blurred alpha lit as a height map.
  `<filter id="bevel" x="-5%" y="-5%" width="110%" height="110%">` +
  `<feGaussianBlur in="SourceAlpha" stdDeviation="9" result="b"/>` +
  `<feDiffuseLighting in="b" surfaceScale="10" diffuseConstant="1" lighting-color="#fff" result="l">` +
  `<feDistantLight azimuth="225" elevation="52"/></feDiffuseLighting>` +
  `<feComposite in="SourceGraphic" in2="l" operator="arithmetic" k1="1.22" result="t"/>` +
  `<feComposite in="t" in2="SourceAlpha" operator="in"/></filter>` +
  `<linearGradient id="depth" gradientUnits="userSpaceOnUse" x1="0" y1="430" x2="0" y2="680">` +
  `<stop offset="0" stop-color="#140B05" stop-opacity="0"/>` +
  `<stop offset="1" stop-color="#140B05" stop-opacity=".55"/></linearGradient>`;

// Grass: per-blade vertical gradients (light tips, dark roots) and a specular gloss per cluster.
const FRONT = [
  ['#D2F483', '#6DBE3E', '#2A6A1C'],
  ['#BDEB6E', '#5DAE36', '#24601A'],
  ['#A9E05C', '#4FA02F', '#1F5517'],
  ['#C8EE7C', '#76C445', '#2F7420'],
];
const BACK = [
  ['#7DBA45', '#3D7E28', '#173F10'],
  ['#6CA83D', '#356F22', '#143A0E'],
];
const grad = (id, [a, b, c]) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/>` +
  `<stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
const grassDefs =
  FRONT.map((g, i) => grad(`gf${i}`, g)).join('') +
  BACK.map((g, i) => grad(`gb${i}`, g)).join('') +
  `<filter id="gloss" x="-10%" y="-10%" width="120%" height="120%">` +
  `<feGaussianBlur in="SourceAlpha" stdDeviation="1.8" result="b"/>` +
  `<feSpecularLighting in="b" surfaceScale="4" specularConstant=".55" specularExponent="20" lighting-color="#F4FFD2" result="s">` +
  `<feDistantLight azimuth="225" elevation="38"/></feSpecularLighting>` +
  `<feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/>` +
  `<feComposite in="SourceGraphic" in2="s2" operator="arithmetic" k2="1" k3=".4"/></filter>` +
  `<linearGradient id="root" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#B08458"/>` +
  `<stop offset=".5" stop-color="#7E5534"/><stop offset="1" stop-color="#4A2E1A"/></linearGradient>`;

// --- Stones and clods ---------------------------------------------------------------------------

function blobPts(x, y, rad, asp, rot, n, jit) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r(-0.25, 0.25);
    const k = rad * (1 + r(-jit, jit));
    const px = Math.cos(a) * k;
    const py = Math.sin(a) * k * asp;
    pts.push([
      x + px * Math.cos(rot) - py * Math.sin(rot),
      y + px * Math.sin(rot) + py * Math.cos(rot),
    ]);
  }
  return pts;
}

/** An irregular stone (or soil clod, `k` = STONES.length) embedded in the soil. */
function stone(x, y, rad, k) {
  const asp = r(0.55, 0.88);
  const rot = r(-0.5, 0.5);
  const d = closed(blobPts(x, y, rad, asp, rot, 6 + Math.floor(rng.next() * 3), 0.2));
  const line = rad > 18 ? 2.6 : rad > 8 ? 2 : 1.3;
  let s =
    // Cast shadow down and to the right, then the stone.
    `<path d="${d}" transform="translate(${f(rad * 0.12 + 1.5)},${f(rad * 0.18 + 2)})" fill="#120A05" opacity=".6" filter="url(#soft2)"/>` +
    `<path d="${d}" fill="url(#st${k})" stroke="${OUT}" stroke-width="${line}" stroke-linejoin="round"/>`;
  if (rad > 8) {
    // A soft lit spot on the top-left shoulder.
    s += `<ellipse cx="${f(x - rad * 0.32)}" cy="${f(y - rad * asp * 0.38)}" rx="${f(rad * 0.34)}" ry="${f(rad * asp * 0.17)}" transform="rotate(-20 ${f(x)} ${f(y)})" fill="#FFF6E2" opacity=".45" filter="url(#soft1)"/>`;
  }
  if (rad > 24 && rng.next() < 0.6) {
    const cx = x + r(-rad * 0.3, rad * 0.3);
    s += `<path d="M${f(cx)},${f(y - rad * asp * 0.8)} l${f(r(-5, 5))},${f(rad * 0.45)} l${f(r(-7, 7))},${f(rad * 0.35)}" stroke="${OUT}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`;
  }
  return s;
}

const placed = [];
const NESTS = Array.from({ length: 7 }, () => {
  const x = r(X0 + 120, X1 - 120);
  return [x, r(top(x) + 60, Math.min(bottom(x), WATER) - 30)];
});
function scatter(count, rMin, rMax, kinds, ok) {
  const out = [];
  for (let tries = 0; out.length < count && tries < count * 200; tries++) {
    const rad = r(rMin, rMax);
    let x;
    let y;
    if (rng.next() < 0.65) {
      // Most stones gather in a few nests; the rest are scattered.
      const c = rng.pick(NESTS);
      x = c[0] + r(-1, 1) * 70 * rng.next();
      y = c[1] + r(-1, 1) * 45 * rng.next();
    } else {
      x = r(X0 + 20, X1 - 20);
      y = r(top(x) + 24 + rad * 0.5, Math.min(bottom(x), WATER + 10) - rad * 0.3);
    }
    if (y > Math.min(bottom(x), WATER + 10) - rad * 0.3) continue;
    if (!ok(x, y, rad)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < (p.rad + rad) * 0.95 + 5)) continue;
    placed.push({ x, y, rad });
    out.push(stone(x, y, rad, rng.pick(kinds)));
  }
  return out.join('');
}

const inside = (x, y, rad) => y - rad * 0.5 > top(x) + 28 && y < bottom(x) - rad * 0.2;
const stoneKinds = STONES.map((_, i) => i);
// Big first, so the small ones fill the gaps between them.
const embedded =
  scatter(6, 26, 46, stoneKinds, inside) +
  scatter(16, 13, 24, stoneKinds, inside) +
  scatter(20, 9, 20, [STONES.length], inside) +
  scatter(24, 7, 12, stoneKinds, inside) +
  scatter(60, 2.5, 6, [...stoneKinds, STONES.length], inside);

// Rocks sticking out of the underside of the overhangs: part of the solid silhouette.
const protruding = [];
for (const x of [250, 330, 420, 1200, 1290, 1380]) {
  const xx = x + r(-14, 14);
  const rad = r(14, 26);
  if (bottom(xx) > WATER - 10) continue;
  protruding.push(stone(xx, bottom(xx) - rad * 0.35, rad, rng.pick(stoneKinds)));
}

// Big soft darker and lighter smudges: painterly strata in the soil.
const smudges = [];
for (let i = 0; i < 16; i++) {
  const x = r(X0, X1);
  const y = r(top(x) + 40, Math.min(bottom(x), WATER));
  const dark = rng.next() < 0.6;
  smudges.push(
    `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r(60, 140))}" ry="${f(r(14, 30))}" transform="rotate(${f(r(-12, 12))} ${f(x)} ${f(y)})" fill="${dark ? '#24130A' : '#A8724A'}" opacity="${dark ? 0.3 : 0.18}"/>`,
  );
}

// --- Turf ---------------------------------------------------------------------------------------
// A solid green band along the top whose lower edge hangs in rounded tongues of varied length,
// longer on the shoulders. Lit along the top, shaded inside the lower edge.

const turfTop = [];
const turfLow = [];
const shadowLow = [];
{
  let x = X0 + 6;
  while (x < X1 - 6) {
    const w = r(14, 36);
    const shoulder = 1 - Math.min(1, Math.min(x - X0, X1 - x) / 140);
    const depth = rng.next() < 0.15 ? r(22, 34) : r(5, 14);
    // Near the very ends the normal turns sideways: keep the tongues short there.
    const tongue = depth * (1 + shoulder * 0.6) * Math.min(1, Math.min(x - X0, X1 - x) / 50);
    for (let t = 0; t < 1; t += 0.12) {
      const xx = Math.min(X1 - 6, x + w * t);
      const n = normal(xx);
      const d = 13 + tongue * Math.sin(Math.PI * t) ** 0.7;
      const y = top(xx);
      turfLow.push([xx - n[0] * d, y - n[1] * d]);
      shadowLow.push([xx - n[0] * (d + 10), y - n[1] * (d + 10)]);
    }
    x += w;
  }
  for (let xx = X0 + 6; xx <= X1 - 6; xx += 4) {
    const n = normal(xx);
    turfTop.push([xx + n[0] * 3, top(xx) + n[1] * 3]);
  }
}
const turfPath = `${poly(turfTop)} L${turfLow
  .slice()
  .reverse()
  .map(([x, y]) => `${f(x)},${f(y)}`)
  .join(' L')} Z`;
const turfShadow = `${poly(turfTop)} L${shadowLow
  .slice()
  .reverse()
  .map(([x, y]) => `${f(x)},${f(y)}`)
  .join(' L')} Z`;

const turf =
  `<path d="${turfShadow}" fill="#0E0703" opacity=".5" filter="url(#soft4)" clip-path="url(#body)"/>` +
  `<path d="${turfPath}" fill="#4F9C31"/>` +
  `<g clip-path="url(#turf)">` +
  `<path d="${poly(turfLow)}" fill="none" stroke="#1B4A12" stroke-width="12" opacity=".75" filter="url(#soft4)"/>` +
  `<path d="${poly(turfTop)}" fill="none" stroke="#C6F07E" stroke-width="7" filter="url(#soft2)"/></g>` +
  `<path d="${turfPath}" fill="none" stroke="#173A10" stroke-width="2.6" stroke-linejoin="round"/>`;

// --- Grass clusters -----------------------------------------------------------------------------

/**
 * One blade: a curved crescent from a root (x, y) toward `angle`, `len` long and `w` wide, its
 * tip swept sideways by `curl`.
 */
function bladePath(x, y, angle, len, w, curl) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const P = (along, side) => [x + dx * along - dy * side, y + dy * along + dx * side];
  const bend = (t) => curl * t * t;
  const pt = (q) => `${f(q[0])},${f(q[1])}`;
  // The tip is a small rounded cap, not a spike.
  const tipA = P(len, -w * 0.14 + bend(1));
  const tipB = P(len, w * 0.1 + bend(1));
  const cap = P(len + w * 0.3, bend(1) * 1.04);
  return (
    `M${pt(P(0, -w * 0.5))} C${pt(P(len * 0.35, -w * 0.66 + bend(0.35)))} ${pt(P(len * 0.75, -w * 0.42 + bend(0.75)))} ${pt(tipA)}` +
    ` Q${pt(cap)} ${pt(tipB)}` +
    ` C${pt(P(len * 0.75, w * 0.32 + bend(0.75)))} ${pt(P(len * 0.35, w * 0.55 + bend(0.35)))} ${pt(P(0, w * 0.5))} Z`
  );
}

/**
 * A cluster: blades fanning from one base along the surface normal, leaning with `lean`.
 * Middle blades are longer; outer ones curl outward. Some clusters are short and broad-leafed.
 */
function cluster(x, scale, lean, palette, line) {
  const n = normal(x);
  const base = Math.atan2(n[1], n[0]) + lean;
  const y = top(x) + 7;
  const count = 6 + Math.floor(rng.next() * 6);
  const broad = rng.next() < 0.25;
  const fan = r(1.4, 2.1);
  const blades = [];
  for (let i = 0; i < count; i++) {
    const u = count === 1 ? 0 : i / (count - 1) - 0.5;
    const len = scale * (broad ? r(16, 24) : r(22, 40)) * (1 - Math.abs(u) * 0.6) * r(0.8, 1.15);
    const w = broad ? r(10, 14) : r(6.5, 10);
    const a = base + u * fan + r(-0.12, 0.12);
    // Outer blades droop outward, so the cluster reads as a soft clump.
    const curl = (u === 0 ? r(-1, 1) : Math.sign(u)) * len * r(0.2, 0.5) * (0.5 + Math.abs(u) * 1.6);
    const bx = x + u * 12 * scale + r(-2, 2);
    blades.push({ d: bladePath(bx, y + r(-2, 2), a, len, w, curl), z: rng.next() });
  }
  blades.sort((p, q) => p.z - q.z);
  const g = blades
    .map(
      (b) =>
        `<path d="${b.d}" fill="url(#${rng.pick(palette)})" stroke="${line}" stroke-width="1.6" stroke-linejoin="round"/>`,
    )
    .join('');
  // A rounded leafy mound at the base ties the blades into one clump.
  const mound = closed(
    blobPts(x - n[0] * 4 * scale, y - 4 - n[1] * 4 * scale, 13 * scale, 0.55, Math.atan2(-n[0], n[1]) * -1, 7, 0.18),
  );
  return (
    `<g filter="url(#gloss)">` +
    `<path d="${mound}" fill="url(#${palette[0]})" stroke="${line}" stroke-width="1.6"/>${g}</g>`
  );
}

/** Slow wave in [0.6, 1.25] along the edge: patches of taller and shorter grass. */
const patchPh = r(0, 6);
const patch = (x) => 0.92 + 0.33 * Math.sin(x / 70 + patchPh) * Math.sin(x / 190 + 1.3);

const backGrass = [];
for (let x = X0 + 30; x < X1 - 30; x += r(14, 24)) {
  backGrass.push(
    cluster(x, patch(x) * r(1.1, 1.5), r(-0.25, 0.25), ['gb0', 'gb1'], '#0F2C0A'),
  );
}

const baseShadows = [];
const frontGrass = [];
for (let x = X0 + 24; x < X1 - 24; x += r(13, 22)) {
  const s = patch(x) * r(0.75, 1.15);
  const [nx, ny] = normal(x);
  baseShadows.push(
    `<ellipse cx="${f(x - nx * 5)}" cy="${f(top(x) - ny * 5)}" rx="${f(12 * s)}" ry="${f(5 * s)}"/>`,
  );
  frontGrass.push(cluster(x, s, r(-0.3, 0.3), ['gf0', 'gf1', 'gf2', 'gf3'], '#173A10'));
}

// --- Hanging roots ------------------------------------------------------------------------------

function root(x, len, w0) {
  const y0 = bottom(x) - 8;
  const sway = r(-14, 14);
  const phase = r(0, 6);
  const left = [];
  const right = [];
  for (let t = 0; t <= 1.001; t += 0.1) {
    const cx = x + sway * t * Math.sin(t * 3.4 + phase);
    const cy = y0 + len * t;
    const w = w0 * (1 - t) + 0.7;
    left.push([cx - w, cy]);
    right.push([cx + w, cy]);
  }
  const pts = [...left, ...right.reverse()];
  return `<path d="${closed(pts)}" fill="url(#root)" stroke="${OUT}" stroke-width="1.8" stroke-linejoin="round"/>`;
}

const roots = [];
for (const x of [200, 236, 285, 352, 400, 446, 1160, 1215, 1262, 1318, 1365, 1410]) {
  const xx = x + r(-10, 10);
  if (bottom(xx) > WATER - 30) continue;
  roots.push(root(xx, r(22, 70), r(3, 6)));
}

// --- Assemble -----------------------------------------------------------------------------------

const header = (what) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n` +
  `  <!-- Island test map, ${what} (generated by scripts/art/gen-island.mjs). -->\n`;

const terrain =
  header('solid layer: opaque = solid') +
  `  <defs>${softDefs}${soilDefs}${stoneDefs}` +
  `<clipPath id="body"><path d="${outline}"/></clipPath>` +
  `<clipPath id="turf"><path d="${turfPath}"/></clipPath></defs>\n` +
  `  <g filter="url(#bevel)"><g clip-path="url(#body)">` +
  `<rect x="${X0 - 40}" y="300" width="${X1 - X0 + 80}" height="${H - 300 + 20}" fill="url(#soilBase)" filter="url(#soilTex)"/>` +
  `<g filter="url(#soft12)">${smudges.join('')}</g>` +
  `${embedded}` +
  `<rect x="${X0 - 40}" y="300" width="${X1 - X0 + 80}" height="${H - 300 + 20}" fill="url(#depth)"/>` +
  `</g></g>\n` +
  `  <path d="${outline}" fill="none" stroke="${OUT}" stroke-width="5" stroke-linejoin="round"/>\n` +
  `  ${protruding.join('')}\n  ${turf}\n</svg>\n`;

const back =
  header('non-solid back layer: tall dark grass behind the edge') +
  `  <defs>${grassDefs}</defs>\n  ${backGrass.join('\n  ')}\n</svg>\n`;

const grass =
  header('non-solid front layer: grass clusters and hanging roots, erased by craters') +
  `  <defs>${softDefs}${grassDefs}</defs>\n` +
  `  ${roots.join('')}\n` +
  `  <g fill="#0B2507" opacity=".55" filter="url(#soft4)">${baseShadows.join('')}</g>\n` +
  `  ${frontGrass.join('\n  ')}\n</svg>\n`;

const meta = {
  id: 'island',
  name: 'Острів',
  width: W,
  height: H,
  waterLevel: WATER,
  spawns: [{ x: 470 }, { x: 1130 }],
};

mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/terrain.svg`, terrain);
writeFileSync(`${DIR}/grass.svg`, grass);
writeFileSync(`${DIR}/back.svg`, back);
writeFileSync(`${DIR}/map.json`, `${JSON.stringify(meta, null, 2)}\n`);
console.log('island: terrain', terrain.length, 'grass', grass.length, 'back', back.length, 'bytes');
