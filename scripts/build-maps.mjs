// Rasterizes drawn maps: public/maps/<id>/terrain.svg (+ optional back.svg) -> PNG at ART_SCALE
// px per world unit (the SVGs are drawn in world units, map.json width x height).
//
// The PNG is the canonical map file: the game (and later the server) builds the terrain mask
// from its alpha channel, so it must come from one deterministic renderer (resvg), not from
// each browser's own SVG rasterizer. Also writes public/maps/index.json:
// [{ "id": "castle", "back": true }, ...].
//
// Usage: npm run maps

import { Resvg } from '@resvg/resvg-js';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAPS_DIR = 'public/maps';
/** Same as ART_SCALE in src/core/world.ts. */
const ART_SCALE = 2;

function render(svgPath, pngPath, width, height) {
  const svg = readFileSync(svgPath, 'utf8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: ART_SCALE },
    font: { loadSystemFonts: false },
    shapeRendering: 2, // geometricPrecision: anti-aliased edges
  });
  const image = resvg.render();
  if (image.width !== width * ART_SCALE || image.height !== height * ART_SCALE) {
    throw new Error(
      `${svgPath}: rendered ${image.width}x${image.height} at ${ART_SCALE}x, ` +
        `map.json says ${width}x${height}`,
    );
  }
  const png = image.asPng();
  writeFileSync(pngPath, png);
  return png.length;
}

function readMeta(dir, id) {
  const path = join(dir, 'map.json');
  if (!existsSync(path)) throw new Error(`${dir}: missing map.json`);
  const meta = JSON.parse(readFileSync(path, 'utf8'));
  if (meta.id !== id) throw new Error(`${path}: id "${meta.id}" must match folder "${id}"`);
  if (!Number.isInteger(meta.width) || !Number.isInteger(meta.height)) {
    throw new Error(`${path}: width/height must be integers`);
  }
  if (!Array.isArray(meta.spawns) || meta.spawns.length < 2) {
    throw new Error(`${path}: needs at least 2 spawns`);
  }
  return meta;
}

const index = [];
for (const id of readdirSync(MAPS_DIR).sort()) {
  const dir = join(MAPS_DIR, id);
  if (!statSync(dir).isDirectory()) continue;
  const terrainSvg = join(dir, 'terrain.svg');
  if (!existsSync(terrainSvg)) {
    console.warn(`skip ${id}: no terrain.svg`);
    continue;
  }
  const meta = readMeta(dir, id);
  const terrainBytes = render(terrainSvg, join(dir, 'terrain.png'), meta.width, meta.height);
  let line = `${id}: terrain.png ${(terrainBytes / 1024).toFixed(0)} KB`;
  const backSvg = join(dir, 'back.svg');
  const back = existsSync(backSvg);
  if (back) {
    const backBytes = render(backSvg, join(dir, 'back.png'), meta.width, meta.height);
    line += `, back.png ${(backBytes / 1024).toFixed(0)} KB`;
  }
  console.log(line);
  index.push({ id, back });
}

writeFileSync(join(MAPS_DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`index.json: ${index.length} map(s)`);
