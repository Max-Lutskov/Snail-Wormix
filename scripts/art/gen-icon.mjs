// App icon for «На екран Додому» / PWA: the assembled green snail on the game's dark blue.
// Writes public/icon-512.png and public/apple-touch-icon.png (180). Run: node scripts/art/gen-icon.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const snail = readFileSync('public/art/snail/snail-green.svg', 'utf8');
const inner = snail.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
// The snail's viewBox is -32 -66 80 70; centre it in a square with a margin.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-42 -82 100 100">
  <rect x="-42" y="-82" width="100" height="100" fill="#1d2b3a"/>
  <circle cx="8" cy="-32" r="40" fill="#2c4a3a"/>
  ${inner}
</svg>`;
for (const [file, size] of [
  ['public/icon-512.png', 512],
  ['public/apple-touch-icon.png', 180],
]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(file, png);
}
