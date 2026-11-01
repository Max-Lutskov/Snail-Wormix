import type Phaser from 'phaser';
import type { TerrainLayout } from '../../core/terrain/layout';
import { cloneMask, type PixelRect, type TerrainMask } from '../../core/terrain/mask';
import { composeTerrain, paintHillsArt, type Rgba } from './terrainArt';

const TEXTURE_KEY = 'terrain';

/** Draws the terrain mask into one world-sized canvas texture and patches it after craters. */
export class TerrainView {
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly image: Phaser.GameObjects.Image;
  private readonly pixels: ImageData;
  private readonly base: Rgba;
  private readonly original: TerrainMask;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layout: TerrainLayout,
  ) {
    const { width, height } = layout.mask;
    if (scene.textures.exists(TEXTURE_KEY)) scene.textures.remove(TEXTURE_KEY);
    const texture = scene.textures.createCanvas(TEXTURE_KEY, width, height);
    if (!texture) throw new Error('TerrainView: could not create canvas texture');
    this.texture = texture;

    this.original = cloneMask(layout.mask);
    this.base = paintHillsArt(this.original);
    this.pixels = texture.context.createImageData(width, height);
    this.redraw({ x: 0, y: 0, width, height });

    this.image = scene.add.image(0, 0, TEXTURE_KEY).setOrigin(0, 0);
  }

  /** Re-composes the given area (grown by the burnt-rim width) and uploads the texture. */
  redraw(rect: PixelRect): void {
    const { width, height } = this.layout.mask;
    const pad = 4;
    const x = Math.max(0, rect.x - pad);
    const y = Math.max(0, rect.y - pad);
    const area = {
      x,
      y,
      width: Math.min(width, rect.x + rect.width + pad) - x,
      height: Math.min(height, rect.y + rect.height + pad) - y,
    };
    composeTerrain(this.pixels.data, this.base, this.original, this.layout.mask, area);
    this.texture.putData(this.pixels, 0, 0, area.x, area.y, area.width, area.height);
    this.texture.refresh();
  }

  destroy(): void {
    this.image.destroy();
    this.scene.textures.remove(TEXTURE_KEY);
  }
}
