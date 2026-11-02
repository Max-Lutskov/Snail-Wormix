import type Phaser from 'phaser';
import type { TerrainLayout } from '../../core/terrain/layout';
import type { PixelRect } from '../../core/terrain/mask';
import type { Crater } from '../../core/terrain/state';
import { ART_SCALE } from '../../core/world';
import { createEdgeField, EDGE_UPDATE_REACH, updateEdgeField } from './edgeField';
import { intersect, TileGrid } from './tiles';
import {
  addBurn,
  burnBounds,
  composeTerrain,
  decorOwnership,
  type Rgba,
  type TerrainSources,
} from './terrainArt';

/** 1 per world pixel of ground (mask without decor). */
function groundOf(layout: TerrainLayout, owned: Uint8Array): Uint8Array {
  const { data } = layout.mask;
  const ground = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) ground[i] = data[i] === 1 && owned[i] === 0 ? 1 : 0;
  return ground;
}

/**
 * Draws the terrain at art resolution into a grid of canvas textures (each shown at world
 * size) and patches the tiles a crater touches.
 */
export class TerrainView {
  private readonly grid: TileGrid;
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
    scene: Phaser.Scene,
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

    this.grid = new TileGrid(scene, 'terrain', width, height);
    this.redraw({ x: 0, y: 0, width, height });
  }

  setDepth(depth: number): this {
    this.grid.setDepth(depth);
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
    for (const tile of this.grid.tiles) {
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
    this.grid.destroy();
  }
}
