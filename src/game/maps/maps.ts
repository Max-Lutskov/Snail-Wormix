/**
 * Loads drawn maps listed in public/maps/index.json (written by `npm run maps`) and decodes
 * their PNGs into what core needs (the alpha channel) and what the renderer needs (the colors).
 */

import type Phaser from 'phaser';
import { parseMapMeta, type MapData, type MapLookup } from '../../core/terrain/map';
import { ART_SCALE } from '../../core/world';
import type { Rgba } from '../terrain/terrainArt';

const INDEX_KEY = 'maps-index';

interface IndexEntry {
  readonly id: string;
  readonly back: boolean;
  readonly grass: boolean;
}

export interface LoadedMap {
  readonly data: MapData;
  /** The terrain PNG's pixels (ART_SCALE px per world unit), used as the map's base art. */
  readonly rgba: Rgba;
  /** Texture key of the terrain PNG (for previews). */
  readonly terrainKey: string;
  /** Texture key of the non-solid background layer, if the map has one. */
  readonly backKey: string | null;
  /** Texture key of the non-solid grass layer in front (craters erase it), if any. */
  readonly grassKey: string | null;
}

const metaKey = (id: string): string => `map-meta-${id}`;
const terrainKey = (id: string): string => `map-terrain-${id}`;
const backKey = (id: string): string => `map-back-${id}`;
const grassKey = (id: string): string => `map-grass-${id}`;

function parseIndex(json: unknown): IndexEntry[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((e: unknown) => {
    if (typeof e !== 'object' || e === null) return [];
    const { id, back, grass } = e as Record<string, unknown>;
    return typeof id === 'string' ? [{ id, back: back === true, grass: grass === true }] : [];
  });
}

/** Call from preload(): queues the index, then every listed map's files. */
export function preloadMaps(scene: Phaser.Scene): void {
  scene.load.json(INDEX_KEY, 'maps/index.json');
  scene.load.once(
    `filecomplete-json-${INDEX_KEY}`,
    (_key: string, _type: string, json: unknown) => {
      for (const { id, back, grass } of parseIndex(json)) {
        scene.load.json(metaKey(id), `maps/${id}/map.json`);
        scene.load.image(terrainKey(id), `maps/${id}/terrain.png`);
        if (back) scene.load.image(backKey(id), `maps/${id}/back.png`);
        if (grass) scene.load.image(grassKey(id), `maps/${id}/grass.png`);
      }
    },
  );
}

function readPixels(scene: Phaser.Scene, key: string, width: number, height: number): Rgba {
  const source = scene.textures.get(key).getSourceImage() as CanvasImageSource;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('maps: no 2D context');
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, width, height).data;
}

/**
 * Call from create(): decodes every loaded map. A broken map is reported and skipped so one bad
 * file doesn't take the game down.
 */
export function readMaps(scene: Phaser.Scene): Map<string, LoadedMap> {
  const maps = new Map<string, LoadedMap>();
  for (const { id, back, grass } of parseIndex(scene.cache.json.get(INDEX_KEY))) {
    try {
      if (!scene.textures.exists(terrainKey(id))) throw new Error('terrain.png did not load');
      const meta = parseMapMeta(scene.cache.json.get(metaKey(id)));
      const rgba = readPixels(
        scene,
        terrainKey(id),
        meta.width * ART_SCALE,
        meta.height * ART_SCALE,
      );
      const alpha = new Uint8Array(rgba.length / 4);
      for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3] ?? 0;
      maps.set(id, {
        data: { meta, alpha },
        rgba,
        terrainKey: terrainKey(id),
        backKey: back && scene.textures.exists(backKey(id)) ? backKey(id) : null,
        grassKey: grass && scene.textures.exists(grassKey(id)) ? grassKey(id) : null,
      });
    } catch (error) {
      console.error(`maps: "${id}" skipped:`, error);
    }
  }
  return maps;
}

export function mapLookup(maps: ReadonlyMap<string, LoadedMap>): MapLookup {
  return (id) => maps.get(id)?.data;
}
