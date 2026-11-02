import type Phaser from 'phaser';
import type { TerrainLayout } from '../../core/terrain/layout';
import type { PixelRect } from '../../core/terrain/mask';
import type { Crater } from '../../core/terrain/state';
import { ART_SCALE } from '../../core/world';
import { createEdgeField, EDGE_UPDATE_REACH, updateEdgeField } from './edgeField';
import {
  addBurn,
  burnBounds,
  composeTerrain,
  decorOwnership,
  type Rgba,
  type TerrainSources,
} from './terrainArt';

/** Tile side in world px. A crater re-uploads only the tiles it touches. */
const TILE = 256;
/**
 * Art px each tile texture also holds of its neighbours. Linear filtering samples half a texel
 * past a tile's edge; with the neighbour's real pixels there, tiles join without seams.
 */
const APRON = 1;
const FRAME = 'inner';

interface Tile {
  readonly key: string;
  /** World rect shown by the tile. */
  readonly rect: PixelRect;
  /** Art rect held by the texture: `rect` at art scale plus the apron. */
  readonly art: PixelRect;
  readonly texture: Phaser.Textures.CanvasTexture;
  readonly image: Phaser.GameObjects.Image;
}

/** 1 per world pixel of ground (mask without decor). */
function groundOf(layout: TerrainLayout, owned: Uint8Array): Uint8Array {
  const { data } = layout.mask;
  const ground = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) ground[i] = data[i] === 1 && owned[i] === 0 ? 1 : 0;
  return ground;
}

function intersect(a: PixelRect, b: PixelRect): PixelRect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/**
 * Draws the terrain at art resolution into a grid of canvas textures (each shown at world
 * size) and patches the tiles a crater touches.
 */
export class TerrainView {
  private readonly tiles: Tile[] = [];
  private readonly sources: TerrainSources;
  private readonly owned: Uint8Array;
  private readonly ground: Uint8Array;
  private readonly original: Uint8Array;

  /**
   * @param baseArt how the ground looks before any crater, art-sized (generated for hills, the
   *   PNG for a drawn map); only its colors are used, edges and holes come from the mask
   * @param original the terrain before any crater (to tell fresh cuts from the original surface)
   * @param layout the live terrain, already carved with `craters`
   * @param drawnOutline the base art already has the contour along the original silhouette
   */
  constructor(
    private readonly scene: Phaser.Scene,
    baseArt: Rgba,
    original: TerrainLayout,
    private readonly layout: TerrainLayout,
    craters: readonly Crater[],
    drawnOutline: boolean,
  ) {
    const { width, height } = layout.mask;
    this.owned = decorOwnership(layout);
    this.ground = groundOf(layout, this.owned);
    this.original = groundOf(original, this.owned);

    const burn = new Uint8Array(width * height);
    for (const c of craters) addBurn(burn, layout.mask, c);
    const field = createEdgeField(width, height);
    this.sources = { base: baseArt, burn, field, drawnOutline };

    for (let y = 0; y < height; y += TILE) {
      for (let x = 0; x < width; x += TILE) {
        const rect = { x, y, width: Math.min(TILE, width - x), height: Math.min(TILE, height - y) };
        const art = {
          x: x * ART_SCALE - APRON,
          y: y * ART_SCALE - APRON,
          width: rect.width * ART_SCALE + 2 * APRON,
          height: rect.height * ART_SCALE + 2 * APRON,
        };
        const key = `terrain-${x}-${y}`;
        if (scene.textures.exists(key)) scene.textures.remove(key);
        const texture = scene.textures.createCanvas(key, art.width, art.height);
        if (!texture) throw new Error('TerrainView: could not create canvas texture');
        texture.add(FRAME, 0, APRON, APRON, rect.width * ART_SCALE, rect.height * ART_SCALE);
        const image = scene.add
          .image(x, y, key, FRAME)
          .setOrigin(0, 0)
          .setScale(1 / ART_SCALE);
        this.tiles.push({ key, rect, art, texture, image });
      }
    }
    this.redraw({ x: 0, y: 0, width, height });
  }

  setDepth(depth: number): this {
    for (const t of this.tiles) t.image.setDepth(depth);
    return this;
  }

  /** Call after the crater has been carved into the mask. */
  onCrater(crater: Crater): void {
    const { mask } = this.layout;
    const changed = burnBounds(mask, crater);
    for (let y = changed.y; y < changed.y + changed.height; y++) {
      for (let x = changed.x; x < changed.x + changed.width; x++) {
        const i = y * mask.width + x;
        this.ground[i] = mask.data[i] === 1 && this.owned[i] === 0 ? 1 : 0;
      }
    }
    addBurn(this.sources.burn, mask, crater);
    this.redraw(changed);
  }

  /** Recomputes the edge field and repaints everything within reach of `rect` (world px). */
  private redraw(rect: PixelRect): void {
    const { width, height } = this.layout.mask;
    const area = intersect(
      {
        x: rect.x - EDGE_UPDATE_REACH,
        y: rect.y - EDGE_UPDATE_REACH,
        width: rect.width + 2 * EDGE_UPDATE_REACH,
        height: rect.height + 2 * EDGE_UPDATE_REACH,
      },
      { x: 0, y: 0, width, height },
    );
    if (!area) return;
    updateEdgeField(this.sources.field, this.ground, this.original, area);

    const worldArt = { x: 0, y: 0, width: width * ART_SCALE, height: height * ART_SCALE };
    const areaArt = {
      x: area.x * ART_SCALE,
      y: area.y * ART_SCALE,
      width: area.width * ART_SCALE,
      height: area.height * ART_SCALE,
    };
    for (const tile of this.tiles) {
      const held = intersect(tile.art, worldArt);
      const part = held && intersect(areaArt, held);
      if (!part) continue;
      const img = tile.texture.context.createImageData(part.width, part.height);
      composeTerrain(img.data, this.sources, part);
      tile.texture.putData(img, part.x - tile.art.x, part.y - tile.art.y);
      tile.texture.refresh();
    }
  }

  destroy(): void {
    for (const t of this.tiles) {
      t.image.destroy();
      this.scene.textures.remove(t.key);
    }
    this.tiles.length = 0;
  }
}
