/** Loads the drawn maps (map.json + terrain.png alpha) from a maps folder for the server. */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMapMeta, type MapData, type MapLookup } from '../src/core/terrain/map';
import { decodePng } from './png';

export function loadMaps(dir: string): MapLookup {
  const maps = new Map<string, MapData>();
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { id: string }[];
  for (const { id } of index) {
    const png = join(dir, id, 'terrain.png');
    if (!existsSync(png)) continue;
    const meta = parseMapMeta(JSON.parse(readFileSync(join(dir, id, 'map.json'), 'utf8')));
    const { rgba } = decodePng(readFileSync(png));
    const alpha = new Uint8Array(rgba.length / 4);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3] ?? 0;
    maps.set(id, { meta, alpha });
  }
  return (id) => maps.get(id);
}
