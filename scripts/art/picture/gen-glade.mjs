// Builds the "glade" map (public/maps/glade) from the painted picture: the picture (4x upscaled
// with Real-ESRGAN, see cut.mjs) fills the middle of the 1600x720 world, the cliffs at its sides
// are continued to the world edges by repeating slices of their own edge, and the backdrop is a
// flat painted scene in the picture's style (sky sampled from the picture, layered far hills,
// palms) under the picture's own background. Craters reveal that painted scene, not a blur.
//
// Usage: node scripts/art/picture/gen-glade.mjs <picture@4x.png> <cut@4x.png>
//   picture@4x.png  the picture upscaled 4x (4096x3072)
//   cut@4x.png      its terrain cut (cut.mjs with erode 7), same size
import { Resvg } from '@resvg/resvg-js';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPng, writePng } from './png.mjs';

const [, , picPath, cutPath] = process.argv;
const DIR = 'public/maps/glade';
const W = 1600;
const H = 720;
const ART = 2;
/** The picture's own size (before the 4x upscale) and the upscaled size. */
const PW = 1024;
const PH = 768;
const UP = 4;
/** The picture is fitted to the world height and centred. */
const S = H / PH;
const PX = (W - PW * S) / 2;

const pic = readPng(picPath, PW * UP, PH * UP);
const cut = readPng(cutPath, PW * UP, PH * UP);
const tmp = mkdtempSync(join(tmpdir(), 'glade-'));
const b64 = (path) => readFileSync(path).toString('base64');
const f = (n) => Math.round(n * 10) / 10;

/** Average colour of the picture around (x, y) in picture px, as #rrggbb. */
function sample(x, y) {
  const c = [0, 0, 0];
  for (let dy = -8; dy <= 8; dy++)
    for (let dx = -8; dx <= 8; dx++) {
      const i = ((y * UP + dy) * PW * UP + x * UP + dx) * 4;
      for (let k = 0; k < 3; k++) c[k] += pic[i + k];
    }
  return `#${c
    .map((v) =>
      Math.round(v / 289)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

// --- Backdrop -----------------------------------------------------------------------------------

// The picture's background only: terrain pixels (grown a little past their antialiased edge)
// become transparent, so the painted scene shows through there.
{
  const N = PW * UP * PH * UP;
  const w = PW * UP;
  const grown = new Uint8Array(N);
  const R = 2 * UP;
  for (let i = 0; i < N; i++) {
    if (cut[i * 4 + 3] === 0) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -R; dy <= R; dy += 2)
      for (let dx = -R; dx <= R; dx += 2) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < w && yy >= 0 && yy < PH * UP) grown[yy * w + xx] = 1;
      }
  }
  const rgba = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    rgba.set([pic[i * 4], pic[i * 4 + 1], pic[i * 4 + 2], grown[i] ? 0 : 255], i * 4);
  }
  writePng(join(tmp, 'bg.png'), rgba, w, PH * UP);
}

const sky = { top: sample(620, 12), mid: sample(620, 200), low: sample(330, 470) };
const hillFar = sample(700, 520);
const hillMid = sample(420, 520);
const grass = sample(560, 600);
const rock = sample(500, 700);
const palmDark = sample(70, 255);
const palmLight = sample(250, 120);

/** Wavy band from y0 at the left to y1 at the right, bumps of `amp`, filled down to H. */
function hills(y0, y1, amp, period, phase, color, outline) {
  let d = `M-20,${H + 20} L-20,${f(y0)}`;
  for (let x = -20; x <= W + 20; x += 20) {
    const t = (x + 20) / (W + 40);
    const y = y0 + (y1 - y0) * t - amp * Math.abs(Math.sin(x / period + phase));
    d += ` L${x},${f(y)}`;
  }
  d += ` L${W + 20},${H + 20} Z`;
  return `<path d="${d}" fill="${color}"${outline ? ` stroke="${outline}" stroke-width="2"` : ''}/>`;
}

/** A flat palm silhouette: a curved tapered trunk and crescent fronds from the crown. */
function palm(x, y, h, lean, color, scale = 1) {
  const cx = x + lean;
  const cy = y - h;
  const trunk =
    `M${f(x - 9 * scale)},${y} Q${f(x + lean * 0.2)},${f(y - h * 0.5)} ${f(cx - 4 * scale)},${f(cy)}` +
    ` L${f(cx + 4 * scale)},${f(cy)} Q${f(x + lean * 0.2 + 12 * scale)},${f(y - h * 0.5)} ${f(x + 9 * scale)},${y} Z`;
  const fronds = [-2.9, -2.4, -1.9, -1.25, -0.7, -0.25, 0.25].map((a, i) => {
    const len = (110 + (i % 3) * 22) * scale;
    const droop = 0.55;
    const tx = cx + Math.cos(a) * len;
    const ty = cy + Math.sin(a) * len * 0.75 + len * droop * 0.5;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    const mx = cx + Math.cos(a) * len * 0.5;
    const my = cy + Math.sin(a) * len * 0.5 - len * 0.12;
    const w = 26 * scale;
    return (
      `<path d="M${f(cx)},${f(cy)} Q${f(mx + nx * w)},${f(my + ny * w - w)} ${f(tx)},${f(ty)}` +
      ` Q${f(mx - nx * w * 0.3)},${f(my - ny * w * 0.3)} ${f(cx)},${f(cy)} Z" fill="${color}"/>`
    );
  });
  return `<path d="${trunk}" fill="${color}"/>${fronds.join('')}`;
}

const sceneSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W * ART}" height="${H * ART}" viewBox="0 0 ${W} ${H}">` +
  `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="${sky.top}"/><stop offset=".3" stop-color="${sky.mid}"/>` +
  `<stop offset=".7" stop-color="${sky.low}"/></linearGradient>` +
  // The picture fades into the painted scene over its last 40 px on each side.
  `<linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">` +
  `<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".04" stop-color="#fff"/>` +
  `<stop offset=".96" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
  `<mask id="edges"><rect x="${PX}" y="0" width="${PW * S}" height="${H}" fill="url(#fade)"/></mask></defs>` +
  `<rect width="${W}" height="${H}" fill="url(#sky)"/>` +
  hills(430, 450, 40, 140, 0.6, hillFar) +
  hills(520, 500, 34, 95, 2.1, hillMid) +
  palm(150, 470, 300, 50, palmDark) +
  palm(1470, 460, 320, -60, palmDark, 1.05) +
  palm(60, 520, 210, 30, palmLight, 0.8) +
  palm(1560, 520, 230, -30, palmLight, 0.8) +
  hills(610, 590, 30, 70, 1.3, grass) +
  hills(680, 690, 14, 50, 0.4, rock) +
  `<image href="data:image/png;base64,${b64(join(tmp, 'bg.png'))}" x="${PX}" y="0" width="${PW * S}" height="${H}" mask="url(#edges)"/>` +
  `</svg>`;

// --- Terrain ------------------------------------------------------------------------------------

/**
 * Repeats the picture's columns [sx, sx + sw) outward from world x `from` (dir -1 or +1),
 * mirroring every other copy so neighbouring copies meet at identical columns (no seams).
 */
function extend(sx, sw, from, dir) {
  const ww = sw * S;
  const out = [];
  for (let k = 0; dir < 0 ? from - k * ww > -ww : from + k * ww < W + ww; k++) {
    const x = dir < 0 ? from - (k + 1) * ww : from + k * ww;
    // The first copy (k = 0) touches the picture's edge column, so it is the mirrored one.
    const flip = k % 2 === 0;
    const slice =
      `<svg x="${f(x - 0.5)}" y="0" width="${f(ww + 1)}" height="${H}" viewBox="${sx} 0 ${sw} ${PH}" preserveAspectRatio="none">` +
      `<image href="data:image/png;base64,${CUT}" width="${PW}" height="${PH}"/></svg>`;
    out.push(
      flip ? `<g transform="translate(${f(2 * x + ww)},0) scale(-1,1)">${slice}</g>` : slice,
    );
  }
  return out.join('');
}
const CUT = b64(cutPath);
// The cut is trimmed past the upscaler's light fringe (cut.mjs erode), so the contour is
// redrawn: the terrain's alpha grown by 2 px, in the outline colour, under the terrain.
const terrainSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W * ART}" height="${H * ART}" viewBox="0 0 ${W} ${H}">` +
  `<defs><filter id="contour" x="-2%" y="-2%" width="104%" height="104%">` +
  `<feMorphology in="SourceAlpha" operator="dilate" radius="2" result="grown"/>` +
  `<feFlood flood-color="#2B1B12"/><feComposite in2="grown" operator="in" result="line"/>` +
  `<feMerge><feMergeNode in="line"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>` +
  `<g filter="url(#contour)">` +
  extend(0, 100, PX, -1) +
  extend(964, 60, PX + PW * S, 1) +
  `<image href="data:image/png;base64,${CUT}" x="${PX}" y="0" width="${PW * S}" height="${H}"/></g></svg>`;

const render = (svg, out) => {
  const png = new Resvg(svg, { shapeRendering: 2 }).render().asPng();
  writeFileSync(out, png);
  console.log(out, Math.round(png.length / 1024), 'KB');
};
render(sceneSvg, `${DIR}/back.source.png`);
render(terrainSvg, `${DIR}/terrain.source.png`);
