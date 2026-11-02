// Backdrop for a cut map: the illustration with the cut-out terrain filled in from the
// surrounding background (push-pull: average down a pyramid, then fill holes from coarser
// levels, then smooth the filled area), so craters reveal plausible scenery, not old terrain.
// Writes the map's back.source.png.
// Usage: node scripts/art/picture/backdrop.mjs <in.png> <cut.png> <w> <h> <out.png>
import { readPng, writePng } from './png.mjs';

const [, , input, cutPath, ws, hs, out] = process.argv;
const W = Number(ws);
const H = Number(hs);
const px = readPng(input, W, H);
const cut = readPng(cutPath, W, H);
const GROW = Math.max(2, Math.round((2 * W) / 1024));

// Level 0: colour premultiplied by known-ness (1 where background).
let levels = [];
let w = W;
let h = H;
let col = new Float32Array(W * H * 3);
let wt = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) {
  // Grow the hole by a few px (2 per 1024 px of width): antialiased terrain edges are not
  // background.
  let known = 1;
  const x = i % W;
  const y = (i - x) / W;
  for (let dy = -GROW; dy <= GROW && known; dy++)
    for (let dx = -GROW; dx <= GROW && known; dx++) {
      const xx = Math.min(W - 1, Math.max(0, x + dx));
      const yy = Math.min(H - 1, Math.max(0, y + dy));
      if (cut[(yy * W + xx) * 4 + 3] > 0) known = 0;
    }
  wt[i] = known;
  for (let c = 0; c < 3; c++) col[i * 3 + c] = px[i * 4 + c] * known;
}
levels.push({ w, h, col, wt });
while (w > 1 || h > 1) {
  const nw = Math.max(1, Math.ceil(w / 2));
  const nh = Math.max(1, Math.ceil(h / 2));
  const ncol = new Float32Array(nw * nh * 3);
  const nwt = new Float32Array(nw * nh);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const j = (y >> 1) * nw + (x >> 1);
      const i = y * w + x;
      nwt[j] += wt[i];
      for (let c = 0; c < 3; c++) ncol[j * 3 + c] += col[i * 3 + c];
    }
  w = nw;
  h = nh;
  col = ncol;
  wt = nwt;
  levels.push({ w, h, col, wt });
}
// Pull: normalise each level, fill unknown pixels from the parent level (bilinear).
const norm = levels.map((L) => {
  const c = new Float32Array(L.w * L.h * 3);
  for (let i = 0; i < L.w * L.h; i++)
    for (let k = 0; k < 3; k++) c[i * 3 + k] = L.wt[i] > 0 ? L.col[i * 3 + k] / L.wt[i] : NaN;
  return { ...L, c };
});
for (let l = norm.length - 2; l >= 0; l--) {
  const L = norm[l];
  const P = norm[l + 1];
  for (let y = 0; y < L.h; y++)
    for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x;
      if (L.wt[i] > 0 && l > 0) continue;
      if (l === 0 && L.wt[i] > 0) continue;
      const fx = Math.min(P.w - 1, Math.max(0, (x - 0.5) / 2));
      const fy = Math.min(P.h - 1, Math.max(0, (y - 0.5) / 2));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(P.w - 1, x0 + 1);
      const y1 = Math.min(P.h - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      for (let k = 0; k < 3; k++) {
        const v =
          (P.c[(y0 * P.w + x0) * 3 + k] * (1 - tx) + P.c[(y0 * P.w + x1) * 3 + k] * tx) * (1 - ty) +
          (P.c[(y1 * P.w + x0) * 3 + k] * (1 - tx) + P.c[(y1 * P.w + x1) * 3 + k] * tx) * ty;
        L.c[i * 3 + k] = v;
      }
    }
}
const base = norm[0];
const rgba = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) {
  for (let k = 0; k < 3; k++) rgba[i * 4 + k] = Math.round(base.c[i * 3 + k]);
  rgba[i * 4 + 3] = 255;
}
writePng(out, rgba, W, H);
console.log('backdrop written');
