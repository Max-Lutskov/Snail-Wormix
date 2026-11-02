import type { Decor } from './decor';
import type { TerrainMask } from './mask';

export interface SpawnPoint {
  /** A snail is dropped above this x and falls onto the surface. */
  readonly x: number;
}

/** One fluffy bump on the moss edge (generated terrain only). */
export interface MossBump {
  /** Center x. */
  readonly x: number;
  readonly diameter: number;
  /** How far the bump rises above the scalloped base line. */
  readonly height: number;
}

/** Everything a terrain source (generator or drawn map) produces. */
export interface TerrainLayout {
  readonly mask: TerrainMask;
  /** Y of the water surface; anything at or below it drowns. */
  readonly waterLevel: number;
  readonly spawns: readonly SpawnPoint[];
  /** Solid surface decor (already stamped into the mask), for the renderer to paint. */
  readonly decor: readonly Decor[];
  /** Moss bumps (already part of the mask), so the renderer can color them. */
  readonly mossBumps: readonly MossBump[];
  /** Per decor item, the mask pixels it added (derived, never serialized). */
  readonly decorPixels: readonly Int32Array[];
  /** Live: 1 while a decor item stands, 0 once a crater destroyed it. */
  readonly decorAlive: Uint8Array;
}
