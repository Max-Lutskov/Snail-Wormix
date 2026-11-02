// Cuts the terrain out of a flat illustration by colour: brown soil, saturated yellow-green
// grass, warm objects and dark outlines are foreground; anything reachable from the image border
// through background-coloured pixels (sky, faded palms, distant hills) is background. Shapes
// enclosed by an outline (e.g. a watering can) stay foreground.
// The thresholds are tuned for flat cartoon art on a blue sky; check the debug image (solid
// shown in magenta) and adjust for other pictures. Writes the map's terrain.source.png.
// Usage: node scripts/art/picture/cut.mjs <in.png> <w> <h> <out.png> [debug.png]
import { readPng, writePng } from './png.mjs';

const [, , input, ws, hs, out, debug] = process.argv;
const W = Number(ws);
const H = Number(hs);
const px = readPng(input, W, H);
const N = W * H;

function hsv(i) {
  const r = px[i * 4] / 255;
  const g = px[i * 4 + 1] / 255;
  const b = px[i * 4 + 2] / 255;
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}

const fg = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const [h, s, v] = hsv(i);
  const warm = (h < 50 || h > 340) && s > 0.35; // soil, pot, mushroom cap, root
  const grass = h >= 55 && h <= 105 && s > 0.5;
  const dark = v < 0.36; // outlines and deep soil
  fg[i] = warm || grass || dark ? 1 : 0;
}

// Background = flood from the border through non-foreground pixels.
const bg = new Uint8Array(N);
const stack = [];
for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
while (stack.length) {
  const i = stack.pop();
  if (bg[i] || fg[i]) continue;
  bg[i] = 1;
  const x = i % W;
  if (x > 0) stack.push(i - 1);
  if (x < W - 1) stack.push(i + 1);
  if (i >= W) stack.push(i - W);
  if (i < N - W) stack.push(i + W);
}

// Solid = not background; drop small specks (noise in the backdrop).
const solid = new Uint8Array(N);
for (let i = 0; i < N; i++) solid[i] = bg[i] ? 0 : 1;
const seen = new Uint8Array(N);
for (let s = 0; s < N; s++) {
  if (!solid[s] || seen[s]) continue;
  const comp = [];
  stack.push(s);
  seen[s] = 1;
  while (stack.length) {
    const i = stack.pop();
    comp.push(i);
    const x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j >= 0 && j < N && solid[j] && !seen[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  if (comp.length < 400) for (const i of comp) solid[i] = 0;
}

const rgba = new Uint8Array(N * 4);
for (let i = 0; i < N; i++) {
  rgba[i * 4] = px[i * 4];
  rgba[i * 4 + 1] = px[i * 4 + 1];
  rgba[i * 4 + 2] = px[i * 4 + 2];
  rgba[i * 4 + 3] = solid[i] ? 255 : 0;
}
writePng(out, rgba, W, H);
if (debug) {
  const dbg = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const k = solid[i] ? [255, 0, 255] : [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
    dbg.set([...k, 255], i * 4);
  }
  writePng(debug, dbg, W, H);
}
console.log(
  'solid px',
  solid.reduce((a, b) => a + b, 0),
  'of',
  N,
);
