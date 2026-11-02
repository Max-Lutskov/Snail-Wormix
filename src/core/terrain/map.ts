/**
 * Drawn maps. A map is public/maps/<id>/terrain.png (opaque = ground) plus map.json.
 * The PNG is art, ART_SCALE px per world unit; it is decoded outside core (browser canvas, or a
 * PNG library on the server) and core only sees its alpha channel, downsampled with integer
 * math, so every client and the server build the same mask from the same file.
 */

import { ART_SCALE } from '../world';
import type { TerrainLayout } from './layout';
import { createMask, surfaceY } from './mask';

/** A world pixel is ground when the mean alpha of its ART_SCALE² art pixels is at least this. */
export const ALPHA_SOLID = 128;

export interface MapMeta {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Y of the water surface; anything at or below it drowns. */
  readonly waterLevel: number;
  readonly spawns: readonly { readonly x: number }[];
}

export interface MapData {
  readonly meta: MapMeta;
  /** One alpha value (0..255) per art pixel, row-major, (width × ART_SCALE) × (height × ART_SCALE). */
  readonly alpha: Uint8Array;
}

/** Finds a loaded map by id (the caller owns loading). */
export type MapLookup = (id: string) => MapData | undefined;

function fail(id: string, message: string): never {
  throw new Error(`map "${id}": ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Validates the shape of a parsed map.json. */
export function parseMapMeta(json: unknown): MapMeta {
  if (!isRecord(json)) throw new Error('map.json: expected an object');
  const id = json['id'];
  if (typeof id !== 'string' || id === '') throw new Error('map.json: "id" must be a string');
  const name = json['name'];
  if (typeof name !== 'string') fail(id, '"name" must be a string');
  const width = json['width'];
  const height = json['height'];
  if (!positiveInt(width) || !positiveInt(height)) fail(id, '"width"/"height" must be integers');
  const waterLevel = json['waterLevel'];
  if (typeof waterLevel !== 'number') fail(id, '"waterLevel" must be a number');
  const spawns = json['spawns'];
  if (!Array.isArray(spawns)) fail(id, '"spawns" must be a list');
  const parsed = spawns.map((s: unknown, i) => {
    if (!isRecord(s) || typeof s['x'] !== 'number') fail(id, `spawn ${i} needs a numeric "x"`);
    return { x: s['x'] };
  });
  return { id, name, width, height, waterLevel, spawns: parsed };
}

/** Builds terrain from a map's alpha channel, validating that the map is playable. */
export function terrainFromMap({ meta, alpha }: MapData): TerrainLayout {
  const { id, width, height, waterLevel, spawns } = meta;
  const artWidth = width * ART_SCALE;
  if (alpha.length !== artWidth * height * ART_SCALE) {
    fail(id, `alpha size ${alpha.length} does not match ${width}x${height} at ${ART_SCALE}x`);
  }
  if (!(waterLevel > 0 && waterLevel <= height)) fail(id, `water level ${waterLevel} is outside`);
  if (spawns.length < 2) fail(id, 'needs at least 2 spawns');

  const mask = createMask(width, height);
  const threshold = ALPHA_SOLID * ART_SCALE * ART_SCALE;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = 0; dy < ART_SCALE; dy++) {
        const row = (y * ART_SCALE + dy) * artWidth + x * ART_SCALE;
        for (let dx = 0; dx < ART_SCALE; dx++) sum += alpha[row + dx] ?? 0;
      }
      mask.data[y * width + x] = sum >= threshold ? 1 : 0;
    }
  }

  for (const { x } of spawns) {
    if (!(x >= 0 && x < width)) fail(id, `spawn x=${x} is outside the world`);
    const top = surfaceY(mask, x);
    if (top === null || top >= waterLevel) fail(id, `spawn x=${x} has no ground above water`);
  }

  return {
    mask,
    waterLevel,
    spawns: spawns.map((s) => ({ x: s.x })),
    decor: [],
    mossBumps: [],
    decorPixels: [],
    decorAlive: new Uint8Array(0),
  };
}
