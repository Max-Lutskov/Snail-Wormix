import type Phaser from 'phaser';
import type { TerrainLayout } from '../../core/terrain/layout';
import type { PixelRect } from '../../core/terrain/mask';
import type { Crater } from '../../core/terrain/state';
import {
  addBurn,
  burnBounds,
  composeTerrain,
  decorOwnership,
  paintGardenArt,
  type Rgba,
  type SoilTile,
} from './terrainArt';

const TEXTURE_KEY = 'terrain';

/** Draws the terrain mask into one world-sized canvas texture and patches it after craters. */
export class TerrainView {
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly image: Phaser.GameObjects.Image;
  private readonly pixels: ImageData;
  private readonly base: Rgba;
  private readonly burn: Uint8Array;
  private readonly owned: Uint8Array;

  /**
   * @param base the terrain before any crater (base art, moss and the back wall come from it)
   * @param layout the live terrain, already carved with `craters`
   */
  constructor(
    private readonly scene: Phaser.Scene,
    base: TerrainLayout,
    private readonly layout: TerrainLayout,
    craters: readonly Crater[],
    tile: SoilTile,
  ) {
    const { width, height } = layout.mask;
    if (scene.textures.exists(TEXTURE_KEY)) scene.textures.remove(TEXTURE_KEY);
    const texture = scene.textures.createCanvas(TEXTURE_KEY, width, height);
    if (!texture) throw new Error('TerrainView: could not create canvas texture');
    this.texture = texture;

    this.base = paintGardenArt(base, tile);
    this.owned = decorOwnership(layout);
    this.burn = new Uint8Array(width * height);
    for (const c of craters) addBurn(this.burn, layout.mask, c);

    this.pixels = texture.context.createImageData(width, height);
    this.redraw({ x: 0, y: 0, width, height });

    this.image = scene.add.image(0, 0, TEXTURE_KEY).setOrigin(0, 0);
  }

  get gameObject(): Phaser.GameObjects.Image {
    return this.image;
  }

  /** Call after the crater has been carved into the mask. */
  onCrater(crater: Crater): void {
    addBurn(this.burn, this.layout.mask, crater);
    this.redraw(burnBounds(this.layout.mask, crater));
  }

  private redraw(rect: PixelRect): void {
    if (rect.width <= 0 || rect.height <= 0) return;
    composeTerrain(this.pixels.data, this.base, this.burn, this.layout.mask, this.owned, rect);
    this.texture.putData(this.pixels, 0, 0, rect.x, rect.y, rect.width, rect.height);
    this.texture.refresh();
  }

  destroy(): void {
    this.image.destroy();
    this.scene.textures.remove(TEXTURE_KEY);
  }
}
