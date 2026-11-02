// Generates the "ledges" test map (public/maps/ledges): floating garden ledges built from big
// bevelled slabs under a thick moss mat with scalloped, overhanging lobes; chunky moss tufts in
// front (grass.svg) and thick root vines behind (back.svg). Prototype for the bold cartoon style.
// Seeded, so the output is stable. Usage: node scripts/art/gen-ledges.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const DIR = 'public/maps/ledges';
const W = 1600;
const H = 720;
const OUT = '#2B1B12';

let seed = 90210;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const r = (a, b) => a + (b - a) * rnd();
const f = (n) => Math.round(n * 10) / 10;

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

// Ledges: a gently waving flat top from x0 to x1 at `top`, and an underside that steps inward
// down to a blunt root, given as points from the right end back to the left end.
const LEDGES = [
  {
    x0: -40,
    x1: 470,
    top: 372,
    under: [
      [478, 404],
      [452, 452],
      [404, 478],
      [392, 530],
      [330, 560],
      [300, 620],
      [236, 650],
      [170, 628],
      [120, 580],
      [60, 560],
      [10, 520],
      [-40, 500],
    ],
  },
  {
    x0: 585,
    x1: 1035,
    top: 528,
    under: [
      [1046, 560],
      [1020, 602],
      [990, 640],
      [960, 700],
      [900, 730],
      [700, 730],
      [650, 690],
      [612, 640],
      [588, 600],
      [576, 560],
    ],
  },
  {
    x0: 712,
    x1: 905,
    top: 300,
    under: [
      [914, 326],
      [890, 360],
      [850, 384],
      [826, 420],
      [790, 428],
      [762, 396],
      [728, 366],
      [706, 330],
    ],
  },
  {
    x0: 1110,
    x1: 1640,
    top: 418,
    under: [
      [1640, 600],
      [1590, 606],
      [1540, 640],
      [1480, 664],
      [1420, 640],
      [1380, 590],
      [1300, 566],
      [1240, 520],
      [1186, 500],
      [1130, 470],
      [1104, 446],
    ],
  },
];

/** Top edge of a ledge, sampled every ~24 px. */
function topEdge(l) {
  const pts = [];
  const phase = r(0, 6);
  for (let x = l.x0; x <= l.x1; x += 24) {
    pts.push([x, l.top + Math.sin(x / 70 + phase) * 3]);
  }
  pts[pts.length - 1][0] = l.x1;
  return pts;
}

// --- Slabs --------------------------------------------------------------------------------------

const SLAB = [
  { light: '#A88566', mid: '#8A6A50', dark: '#634A37' },
  { light: '#9E7D61', mid: '#80634B', dark: '#5C4433' },
  { light: '#B08C6A', mid: '#917056', dark: '#684E3A' },
];

/** Gradient ids for slab palettes (light top, dark bottom: lit from above). */
const slabDefs = SLAB.map(
  (p, i) =>
    `<linearGradient id="slab${i}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${p.light}"/><stop offset=".45" stop-color="${p.mid}"/>` +
    `<stop offset="1" stop-color="${p.dark}"/></linearGradient>`,
).join('');

function slabs(l, clipId) {
  const out = [];
  const bottom = Math.max(...l.under.map((p) => p[1]));
  let y = l.top + 14;
  let row = 0;
  while (y < bottom) {
    const h = r(38, 66);
    let x = l.x0 - 60 + (row % 2) * r(30, 60);
    while (x < l.x1 + 40) {
      const w = r(70, 160);
      const k = Math.floor(rnd() * SLAB.length);
      const rx = r(12, 20);
      const tilt = r(-3.5, 3.5);
      const dy = r(-5, 5);
      out.push(
        `<g transform="rotate(${f(tilt)} ${f(x + w / 2)} ${f(y + h / 2)}) translate(0,${f(dy)})">` +
          `<rect x="${f(x + 2)}" y="${f(y + 2)}" width="${f(w - 4)}" height="${f(h - 4)}" rx="${f(rx)}" fill="url(#slab${k})" stroke="#3A271C" stroke-width="2.5"/>` +
          // Bevel: a light lip along the top and a shadow along the bottom.
          `<path d="M${f(x + rx)},${f(y + 6)} H${f(x + w - rx)}" stroke="${SLAB[k].light}" stroke-width="3" stroke-linecap="round" opacity=".9"/>` +
          `<path d="M${f(x + rx)},${f(y + h - 6)} H${f(x + w - rx)}" stroke="#4A3527" stroke-width="3" stroke-linecap="round" opacity=".55"/></g>`,
      );
      if (rnd() < 0.35) {
        // A crack.
        const cx = x + r(20, w - 20);
        out.push(
          `<path d="M${f(cx)},${f(y + 4)} l${f(r(-6, 6))},${f(h * 0.3)} l${f(r(-8, 8))},${f(h * 0.25)}" stroke="#3A271C" stroke-width="2" fill="none" stroke-linecap="round"/>`,
        );
      }
      x += w;
    }
    y += h;
    row++;
  }
  return `<g clip-path="url(#${clipId})">${out.join('')}</g>`;
}

// --- Moss mat -----------------------------------------------------------------------------------

/**
 * The mat as a closed path: the ledge's top edge, then a scalloped lower edge of pointed lobes
 * hanging `thick` + lobe length below it; lobes at the ends drape further down the sides.
 */
function matPath(edge, thick, lobeMin, lobeMax, lift = 0) {
  const top = edge.map(([x, y]) => [x, y - lift]);
  const first = top[0];
  const last = top[top.length - 1];
  let d = `M${f(first[0] - 10)},${f(first[1] + 6)}`;
  for (const [x, y] of top) d += ` L${f(x)},${f(y)}`;
  d += ` L${f(last[0] + 10)},${f(last[1] + 6)}`;
  // Lower edge, right to left.
  const yAt = (x) => {
    let best = top[0];
    for (const p of top) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
    return best[1];
  };
  let x = last[0] + 10;
  const end = first[0] - 10;
  let i = 0;
  while (x > end) {
    const w = r(26, 44);
    const xb = Math.max(end, x - w);
    const xm = (x + xb) / 2 + r(-4, 4);
    const nearEnd = i === 0 || xb === end;
    const len = r(lobeMin, lobeMax) * (nearEnd ? 2 : 1);
    const base = yAt(xm) + thick;
    d +=
      ` Q${f(x - (x - xb) * 0.15)},${f(base + len * 0.55)} ${f(xm)},${f(base + len)}` +
      ` Q${f(xb + (x - xb) * 0.15)},${f(base + len * 0.55)} ${f(xb)},${f(yAt(xb) + thick)}`;
    x = xb;
    i++;
  }
  return `${d}Z`;
}

function mat(edge) {
  const full = matPath(edge, 26, 16, 36);
  const deep = matPath(edge, 20, 12, 26, 1);
  const mid = matPath(edge, 13, 8, 18, 2);
  const lightLayer = matPath(edge, 6, 4, 10, 3);
  const glints = edge
    .filter(() => rnd() < 0.55)
    .map(
      ([x, y]) =>
        `<path d="M${f(x - r(4, 9))},${f(y + 3)} q${f(r(5, 8))},-3 ${f(r(10, 16))},0" stroke="#D6F59A" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
    )
    .join('');
  return (
    `<path d="${full}" fill="${OUT}" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>` +
    `<path d="${full}" fill="#2F6B22"/>` +
    `<path d="${deep}" fill="#3F8A2C"/>` +
    `<path d="${mid}" fill="#5DAA3A"/>` +
    `<path d="${lightLayer}" fill="#8ED15A"/>` +
    glints
  );
}

// --- Front tufts (grass.svg) ------------------------------------------------------------------

/** A chunky tuft: 3–5 fat pointed leaves fanning up from (x, y). */
function tuft(x, y, s) {
  const n = 3 + Math.floor(rnd() * 3);
  const leaves = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    const h = (r(16, 28) - Math.abs(t) * 10) * s;
    const lean = t * 26 * s + r(-4, 4);
    const w = r(7, 10) * s;
    const bx = x + t * 14 * s;
    const tx = bx + lean;
    const ty = y - h;
    leaves.push(
      `<path d="M${f(bx - w / 2)},${f(y)} Q${f(bx - w * 0.6 + lean * 0.3)},${f(y - h * 0.6)} ${f(tx)},${f(ty)} Q${f(bx + w * 0.6 + lean * 0.4)},${f(y - h * 0.5)} ${f(bx + w / 2)},${f(y)} Z" fill="${['#6FC046', '#5DAA3A', '#7DCB4C'][Math.floor(rnd() * 3)]}" stroke="#24461A" stroke-width="2" stroke-linejoin="round"/>` +
        `<path d="M${f(bx)},${f(y - 2)} Q${f(bx + lean * 0.35)},${f(y - h * 0.55)} ${f(bx + lean * 0.8)},${f(y - h * 0.85)}" stroke="#B2E36A" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
    );
  }
  return leaves.join('');
}

// --- Root vines (back.svg) --------------------------------------------------------------------

function vine(d, leaves) {
  const leafShapes = leaves
    .map(
      ([x, y, a]) =>
        `<path d="M0,0 Q8,-9 20,0 Q8,9 0,0Z" transform="translate(${x},${y}) rotate(${a})" fill="#6FC046" stroke="#24461A" stroke-width="1.6"/>`,
    )
    .join('');
  return (
    `<path d="${d}" stroke="${OUT}" stroke-width="17" fill="none" stroke-linecap="round"/>` +
    `<path d="${d}" stroke="#4E6B2C" stroke-width="12" fill="none" stroke-linecap="round"/>` +
    `<path d="${d}" stroke="#7C9A45" stroke-width="3.5" fill="none" stroke-linecap="round" transform="translate(-2,-3)"/>` +
    leafShapes
  );
}

// --- Assemble --------------------------------------------------------------------------------

const solid = [];
const front = [];
const clips = [];
LEDGES.forEach((l, i) => {
  const edge = topEdge(l);
  const outline = closed([...edge, ...l.under]);
  clips.push(`<clipPath id="ledge${i}"><path d="${outline}"/></clipPath>`);
  solid.push(
    `<path d="${outline}" fill="#2E2018"/>` +
      slabs(l, `ledge${i}`) +
      `<path d="${outline}" fill="none" stroke="${OUT}" stroke-width="4" stroke-linejoin="round"/>` +
      mat(edge),
  );
  for (let x = l.x0 + r(10, 40); x < l.x1 - 10; x += r(46, 90)) {
    const y = edge.reduce((a, p) => (Math.abs(p[0] - x) < Math.abs(a[0] - x) ? p : a))[1] + 4;
    front.push(tuft(x, y, r(0.85, 1.25)));
  }
});

const header = (what) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n` +
  `  <!-- Ledges test map, ${what} (generated by scripts/art/gen-ledges.mjs). -->\n`;

const terrain =
  header('solid layer: opaque = solid') +
  `  <defs>${slabDefs}${clips.join('')}</defs>\n  ${solid.join('\n  ')}\n</svg>\n`;

const grass =
  header('non-solid front layer: chunky moss tufts, erased by craters') +
  `  ${front.join('\n  ')}\n</svg>\n`;

const back =
  header('non-solid back layer: root vines') +
  vine('M790,426 C770,470 830,480 812,530', [
    [786, 470, 150],
    [826, 488, 20],
  ]) +
  vine('M300,640 C320,690 260,700 280,740', [[300, 680, 30]]) +
  vine('M1250,524 C1180,560 1120,520 1060,566', [
    [1200, 548, 200],
    [1110, 540, 160],
  ]) +
  vine('M150,600 C120,640 160,670 130,720', [[140, 646, 190]]) +
  `\n</svg>\n`;

const meta = {
  id: 'ledges',
  name: 'Уступи',
  width: W,
  height: H,
  waterLevel: 662,
  spawns: [{ x: 240 }, { x: 1360 }],
};

mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/terrain.svg`, terrain);
writeFileSync(`${DIR}/grass.svg`, grass);
writeFileSync(`${DIR}/back.svg`, back);
writeFileSync(`${DIR}/map.json`, `${JSON.stringify(meta, null, 2)}\n`);
console.log('ledges: terrain', terrain.length, 'grass', grass.length, 'back', back.length, 'bytes');
