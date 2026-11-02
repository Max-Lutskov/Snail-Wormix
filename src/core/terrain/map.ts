/**
 * Drawn maps. A map is public/maps/<id>/terrain.png (opaque = ground) plus map.json.
 * The PNG is decoded outside core (browser canvas, or a PNG library on the server); core only
 * sees its alpha channel, so every client and the server build the same mask.
 */

import type { TerrainLayout } from './layout';
import { createMask, surfaceY } from './mask';

/** Pixels with alpha at or above this are ground. */
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
  /** One alpha value (0..255) per pixel, row-major, width × height. */
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
  if (alpha.length !== width * height) {
    fail(id, `alpha size ${alpha.length} does not match ${width}x${height}`);
  }
  if (!(waterLevel > 0 && waterLevel <= height)) fail(id, `water level ${waterLevel} is outside`);
  if (spawns.length < 2) fail(id, 'needs at least 2 spawns');

  const mask = createMask(width, height);
  for (let i = 0; i < alpha.length; i++) mask.data[i] = (alpha[i] ?? 0) >= ALPHA_SOLID ? 1 : 0;

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
