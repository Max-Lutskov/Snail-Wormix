// Rasterizes drawn maps: public/maps/<id>/terrain.svg (+ optional back.svg, the non-solid layer
// behind, and grass.svg, the non-solid layer in front that craters erase) -> PNG at ART_SCALE
// px per world unit (the SVGs are drawn in world units, map.json width x height).
//
// A layer can also be a painted picture instead of an SVG: <layer>.source.png (terrain on a
// transparent background; any resolution with the map's aspect ratio). It is resampled to the
// art size the same way, so the alpha that becomes the mask still comes from resvg.
//
// The PNG is the canonical map file: the game (and later the server) builds the terrain mask
// from its alpha channel, so it must come from one deterministic renderer (resvg), not from
// each browser's own SVG rasterizer. Also writes public/maps/index.json:
// [{ "id": "castle", "back": true, "grass": false }, ...].
//
// Usage: npm run maps

import { Resvg } from '@resvg/resvg-js';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAPS_DIR = 'public/maps';
/** Same as ART_SCALE in src/core/world.ts. */
const ART_SCALE = 2;

/** The layer's SVG, or an SVG wrapping its painted source PNG; null when the layer is absent. */
function layerSvg(dir, layer, width, height) {
  const svgPath = join(dir, `${layer}.svg`);
  if (existsSync(svgPath)) return { svg: readFileSync(svgPath, 'utf8'), from: svgPath };
  const srcPath = join(dir, `${layer}.source.png`);
  if (!existsSync(srcPath)) return null;
  const b64 = readFileSync(srcPath).toString('base64');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<image href="data:image/png;base64,${b64}" width="${width}" height="${height}" preserveAspectRatio="none"/></svg>`;
  return { svg, from: srcPath };
}

function render({ svg, from: svgPath }, pngPath, width, height) {
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
  if (!existsSync(join(dir, 'map.json'))) {
    console.warn(`skip ${id}: no map.json`);
    continue;
  }
  const meta = readMeta(dir, id);
  const terrainSvg = layerSvg(dir, 'terrain', meta.width, meta.height);
  if (!terrainSvg) {
    console.warn(`skip ${id}: no terrain.svg or terrain.source.png`);
    continue;
  }
  const terrainBytes = render(terrainSvg, join(dir, 'terrain.png'), meta.width, meta.height);
  let line = `${id}: terrain.png ${(terrainBytes / 1024).toFixed(0)} KB`;
  const backSvg = layerSvg(dir, 'back', meta.width, meta.height);
  const back = backSvg !== null;
  if (back) {
    const backBytes = render(backSvg, join(dir, 'back.png'), meta.width, meta.height);
    line += `, back.png ${(backBytes / 1024).toFixed(0)} KB`;
  }
  const grassSvg = layerSvg(dir, 'grass', meta.width, meta.height);
  const grass = grassSvg !== null;
  if (grass) {
    const grassBytes = render(grassSvg, join(dir, 'grass.png'), meta.width, meta.height);
    line += `, grass.png ${(grassBytes / 1024).toFixed(0)} KB`;
  }
  console.log(line);
  index.push({ id, back, grass });
}

writeFileSync(join(MAPS_DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`index.json: ${index.length} map(s)`);
