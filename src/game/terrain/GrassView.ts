import type Phaser from 'phaser';
import type { Crater } from '../../core/terrain/state';
import { ART_SCALE } from '../../core/world';
import { tokens } from '../art/tokens';
import { TileGrid } from './tiles';

/**
 * The non-solid grass layer in front of the ground (blades over the edge, hanging turf, vines).
 * Never part of the mask: craters only erase it, a little wider than the ground they carve, so
 * blades don't hang in the air over a fresh hole.
 */
export class GrassView {
  private readonly grid: TileGrid;

  /**
   * @param source the layer at art resolution (a drawn map's grass.png, or painted for hills)
   * @param craters already applied to the terrain: erased right away
   */
  constructor(
    scene: Phaser.Scene,
    source: CanvasImageSource,
    width: number,
    height: number,
    craters: readonly Crater[],
  ) {
    this.grid = new TileGrid(scene, 'grass', width, height);
    for (const tile of this.grid.tiles) {
      const ctx = tile.texture.context;
      ctx.drawImage(source, -tile.art.x, -tile.art.y);
      for (const c of craters) this.erase(tile.texture, tile.art, c);
      tile.texture.refresh();
    }
  }

  setDepth(depth: number): this {
    this.grid.setDepth(depth);
    return this;
  }

  onCrater(crater: Crater): void {
    const r = (crater.r + tokens.terrain.grassEraseMargin) * ART_SCALE;
    const bounds = {
      x: Math.floor(crater.x * ART_SCALE - r),
      y: Math.floor(crater.y * ART_SCALE - r),
      width: Math.ceil(2 * r) + 1,
      height: Math.ceil(2 * r) + 1,
    };
    for (const tile of this.grid.touching(bounds)) {
      this.erase(tile.texture, tile.art, crater);
      tile.texture.refresh();
    }
  }

  private erase(
    texture: Phaser.Textures.CanvasTexture,
    art: { readonly x: number; readonly y: number },
    c: Crater,
  ): void {
    const ctx = texture.context;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(
      c.x * ART_SCALE - art.x,
      c.y * ART_SCALE - art.y,
      (c.r + tokens.terrain.grassEraseMargin) * ART_SCALE,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  destroy(): void {
    this.grid.destroy();
  }
}
