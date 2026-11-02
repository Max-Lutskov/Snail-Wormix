import type Phaser from 'phaser';
import type { PixelRect } from '../../core/terrain/mask';
import { ART_SCALE } from '../../core/world';

/** Tile side in world px. A change re-uploads only the tiles it touches. */
const TILE = 256;
/**
 * Art px each tile texture also holds of its neighbours. Linear filtering samples half a texel
 * past a tile's edge; with the neighbour's real pixels there, tiles join without seams.
 */
const APRON = 1;
const FRAME = 'inner';

export interface Tile {
  readonly key: string;
  /** World rect shown by the tile. */
  readonly rect: PixelRect;
  /** Art rect held by the texture: `rect` at art scale plus the apron. */
  readonly art: PixelRect;
  readonly texture: Phaser.Textures.CanvasTexture;
  readonly image: Phaser.GameObjects.Image;
}

export function intersect(a: PixelRect, b: PixelRect): PixelRect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** A world-sized picture at art resolution, split into canvas textures shown at world size. */
export class TileGrid {
  readonly tiles: Tile[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    prefix: string,
    width: number,
    height: number,
  ) {
    for (let y = 0; y < height; y += TILE) {
      for (let x = 0; x < width; x += TILE) {
        const rect = { x, y, width: Math.min(TILE, width - x), height: Math.min(TILE, height - y) };
        const art = {
          x: x * ART_SCALE - APRON,
          y: y * ART_SCALE - APRON,
          width: rect.width * ART_SCALE + 2 * APRON,
          height: rect.height * ART_SCALE + 2 * APRON,
        };
        const key = `${prefix}-${x}-${y}`;
        if (scene.textures.exists(key)) scene.textures.remove(key);
        const texture = scene.textures.createCanvas(key, art.width, art.height);
        if (!texture) throw new Error(`TileGrid: could not create canvas texture ${key}`);
        texture.add(FRAME, 0, APRON, APRON, rect.width * ART_SCALE, rect.height * ART_SCALE);
        const image = scene.add
          .image(x, y, key, FRAME)
          .setOrigin(0, 0)
          .setScale(1 / ART_SCALE);
        this.tiles.push({ key, rect, art, texture, image });
      }
    }
  }

  /** Tiles whose texture (apron included) overlaps the art rect. */
  touching(art: PixelRect): Tile[] {
    return this.tiles.filter((t) => intersect(t.art, art) !== null);
  }

  setDepth(depth: number): void {
    for (const t of this.tiles) t.image.setDepth(depth);
  }

  destroy(): void {
    for (const t of this.tiles) {
      t.image.destroy();
      this.scene.textures.remove(t.key);
    }
    this.tiles.length = 0;
  }
}
