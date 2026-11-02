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

// --- Shaggy grass ------------------------------------------------------------------------------
// The grass is a pile of long curved leaves in three tiers (back: darker, standing up behind the
// edge; middle: combed sideways in waves; front: lightest, drooping over the edge). Each leaf is
// shaded like a rounded object (dark body, lighter inner body toward the light, a highlight line),
// which is what makes the pile look thick and 3D.

const GRASS_TONES = [
  { body: '#2F6B22', inner: '#3F8A2C', glint: '#5DAA3A' }, // back
  { body: '#3F8A2C', inner: '#5DAA3A', glint: '#9BD84A' }, // middle
  { body: '#4E9A33', inner: '#7DCB4C', glint: '#C4EE84' }, // front
];
const LEAF_OUT = '#1E4A17';

/**
 * One tapered leaf from root (x, y) in direction `angle` (radians, screen coords; 0 = right,
 * -PI/2 = up), `len` long, `w` wide at the root, its tip bent sideways by `curl`.
 */
function leaf(x, y, angle, len, w, curl, tone) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const shape = (width, shift) => {
    const ox = px * shift;
    const oy = py * shift;
    const tipX = x + dx * len + px * curl + ox * 0.3;
    const tipY = y + dy * len + py * curl + oy * 0.3;
    const cx = x + dx * len * 0.55 + px * curl * 0.45;
    const cy = y + dy * len * 0.55 + py * curl * 0.45;
    return (
      `M${f(x - px * width * 0.5 + ox)},${f(y - py * width * 0.5 + oy)}` +
      ` Q${f(cx - px * width * 0.45 + ox)},${f(cy - py * width * 0.45 + oy)} ${f(tipX)},${f(tipY)}` +
      ` Q${f(cx + px * width * 0.45 + ox)},${f(cy + py * width * 0.45 + oy)} ${f(x + px * width * 0.5 + ox)},${f(y + py * width * 0.5 + oy)} Z`
    );
  };
  // Light comes from above: shift the lit inner body to the leaf's upper side.
  const up = py < 0 ? -1 : 1;
  const ribTipX = x + dx * len * 0.8 + px * curl * 0.75;
  const ribTipY = y + dy * len * 0.8 + py * curl * 0.75;
  const ribC = [
    x + dx * len * 0.4 + px * (curl * 0.3 + up * w * 0.15),
    y + dy * len * 0.4 + py * (curl * 0.3 + up * w * 0.15),
  ];
  return (
    `<path d="${shape(w, 0)}" fill="${tone.body}" stroke="${LEAF_OUT}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="${shape(w * 0.55, up * w * 0.18)}" fill="${tone.inner}"/>` +
    `<path d="M${f(x + px * up * w * 0.12)},${f(y + py * up * w * 0.12)} Q${f(ribC[0])},${f(ribC[1])} ${f(ribTipX)},${f(ribTipY)}" stroke="${tone.glint}" stroke-width="${f(Math.max(1.2, w * 0.14))}" fill="none" stroke-linecap="round"/>`
  );
}

/** Height of the edge at x (nearest sample). */
function edgeY(edge, x) {
  return edge.reduce((a, p) => (Math.abs(p[0] - x) < Math.abs(a[0] - x) ? p : a))[1];
}

/** Combing direction along the edge: +1 sweeps right, -1 left; flips in waves ~110-190 px. */
function combing(x0, x1) {
  const flips = [];
  let dir = rnd() < 0.5 ? -1 : 1;
  for (let x = x0; x < x1 + 200; x += r(110, 190)) {
    flips.push([x, dir]);
    dir = -dir;
  }
  return (x) => flips.reduce((d, [fx, fd]) => (x >= fx ? fd : d), flips[0][1]);
}

/**
 * The shaggy grass on one ledge: `back` leaves go behind the terrain (back.svg), the rest is
 * solid (terrain.svg) so snails stand on top of the pile, and `fluff` adds a few loose leaves in
 * front (grass.svg, erased by craters).
 */
function shaggy(l, edge) {
  const sweep = combing(l.x0, l.x1);
  const back = [];
  const solid = [];
  const fluff = [];
  // A dark body under the pile so no gaps show between leaves.
  const body = edge.map(([x, y]) => [x, y + 6]);
  solid.push(
    `<path d="M${f(body[0][0] - 6)},${f(body[0][1] + 30)} ${body.map(([x, y]) => `L${f(x)},${f(y)}`).join(' ')} L${f(l.x1 + 6)},${f(edgeY(edge, l.x1) + 30)} Z" fill="${GRASS_TONES[0].body}" stroke="${LEAF_OUT}" stroke-width="3" stroke-linejoin="round"/>`,
  );
  const span = (step, fn) => {
    for (let x = l.x0 + r(0, step); x <= l.x1; x += step * r(0.7, 1.3)) fn(x, edgeY(edge, x));
  };
  // Back tier: standing up and leaning with the combing, behind everything.
  span(15, (x, y) => {
    const d = sweep(x);
    const a = -Math.PI / 2 + d * r(0.25, 0.75);
    back.push(leaf(x, y + 10, a, r(36, 56), r(18, 26), d * r(6, 14), GRASS_TONES[0]));
  });
  // Middle tier: combed sideways, the bulk of the pile.
  span(13, (x, y) => {
    const d = sweep(x);
    const a = d > 0 ? -r(0.35, 0.8) : Math.PI + r(0.35, 0.8);
    solid.push(leaf(x, y + 14, a, r(48, 76), r(22, 32), d * r(8, 16), GRASS_TONES[1]));
  });
  // Front tier: lightest, drooping over the edge onto the slabs.
  span(16, (x, y) => {
    const d = sweep(x);
    const a = Math.PI / 2 - d * r(0.7, 1.15);
    solid.push(leaf(x, y + 18, a, r(34, 56), r(20, 28), -d * r(6, 12), GRASS_TONES[2]));
  });
  // Long strands draping down at both ends of the ledge.
  for (const [ex, side] of [
    [l.x0 + 4, -1],
    [l.x1 - 4, 1],
  ]) {
    const ey = edgeY(edge, ex);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 2 + side * r(0.15, 0.6);
      solid.push(
        leaf(
          ex + side * r(0, 8),
          ey + 10 + k * 8,
          a,
          r(50, 80),
          r(18, 24),
          side * r(-6, 8),
          GRASS_TONES[k % 2 ? 1 : 2],
        ),
      );
    }
  }
  // Loose fluff on top.
  span(34, (x, y) => {
    const d = sweep(x);
    fluff.push(
      leaf(
        x,
        y + 2,
        -Math.PI / 2 + d * r(0.2, 0.6),
        r(16, 26),
        r(7, 10),
        d * r(3, 8),
        GRASS_TONES[2],
      ),
    );
  });
  return { back: back.join(''), solid: solid.join(''), fluff: fluff.join('') };
}

// --- Assemble --------------------------------------------------------------------------------

const solid = [];
const front = [];
const behind = [];
const clips = [];
LEDGES.forEach((l, i) => {
  const edge = topEdge(l);
  const outline = closed([...edge, ...l.under]);
  clips.push(`<clipPath id="ledge${i}"><path d="${outline}"/></clipPath>`);
  solid.push(
    `<path d="${outline}" fill="#2E2018"/>` +
      slabs(l, `ledge${i}`) +
      `<path d="${outline}" fill="none" stroke="${OUT}" stroke-width="4" stroke-linejoin="round"/>`,
  );
  const grassPile = shaggy(l, edge);
  solid.push(grassPile.solid);
  behind.push(grassPile.back);
  front.push(grassPile.fluff);
});

const header = (what) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n` +
  `  <!-- Ledges test map, ${what} (generated by scripts/art/gen-ledges.mjs). -->\n`;

const terrain =
  header('solid layer: opaque = solid') +
  `  <defs>${slabDefs}${clips.join('')}</defs>\n  ${solid.join('\n  ')}\n</svg>\n`;

const grass =
  header('non-solid front layer: loose grass leaves, erased by craters') +
  `  ${front.join('\n  ')}\n</svg>\n`;

const back =
  header('non-solid back layer: root vines and the back tier of the grass') +
  behind.join('') +
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
