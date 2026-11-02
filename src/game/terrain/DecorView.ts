import type Phaser from 'phaser';
import type { Decor, DewDrop, GrassTuft, Mushroom } from '../../core/terrain/decor';
import type { TerrainLayout } from '../../core/terrain/layout';
import { hexToInt, tokens } from '../art/tokens';

/** Texture key and resolution of the mushroom SVG (loaded larger, drawn scaled down). */
export const MUSHROOM_TEXTURE = 'decor-mushroom';
export const MUSHROOM_SVG_SCALE = 4;
/** (0, 0) of mushroom.svg is the stem bottom: viewBox -13 -21 26 22. */
const MUSHROOM_ORIGIN = { x: 13 / 26, y: 21 / 22 } as const;
const DEPTH = 0.5;
const GRASS_WIDTH = 1.3;

const C = tokens.colors;

/**
 * Surface decor drawn as vector sprites over the terrain (crisp at any zoom). Their solid
 * shapes live in the mask; core decides when an item is destroyed, this view only removes it.
 */
export class DecorView {
  private readonly objects: (Phaser.GameObjects.Image | Phaser.GameObjects.Graphics | null)[];

  constructor(
    private readonly scene: Phaser.Scene,
    layout: TerrainLayout,
  ) {
    this.objects = layout.decor.map((d, i) =>
      layout.decorAlive[i] === 1 ? this.create(d).setDepth(DEPTH) : null,
    );
  }

  private create(d: Decor): Phaser.GameObjects.Image | Phaser.GameObjects.Graphics {
    switch (d.kind) {
      case 'mushroom':
        return this.mushroom(d);
      case 'dew':
        return this.dew(d);
      case 'grass':
        return this.grass(d);
    }
  }

  private mushroom(m: Mushroom): Phaser.GameObjects.Image {
    return this.scene.add
      .image(m.x, m.y, MUSHROOM_TEXTURE)
      .setOrigin(MUSHROOM_ORIGIN.x, MUSHROOM_ORIGIN.y)
      .setScale(m.scale / MUSHROOM_SVG_SCALE);
  }

  private dew(d: DewDrop): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics({ x: d.x, y: d.y });
    g.fillStyle(hexToInt(C.dew.fill), 0.95).fillCircle(0, 0, d.r);
    g.lineStyle(1, hexToInt(C.dew.outline), 1).strokeCircle(0, 0, d.r);
    g.fillStyle(hexToInt(C.dew.highlight), 1).fillCircle(-d.r * 0.35, -d.r * 0.35, d.r * 0.32);
    return g;
  }

  private grass(t: GrassTuft): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    g.lineStyle(GRASS_WIDTH, hexToInt(C.grass), 1);
    for (const b of t.blades) {
      const x = t.x + b.dx + 0.5;
      g.lineBetween(x, b.y + 1, x + b.lean, b.y + 1 - b.height);
    }
    return g;
  }

  /** Pops the given decor items out of view (they're already gone from the mask). */
  remove(indices: readonly number[]): void {
    for (const i of indices) {
      const obj = this.objects[i];
      if (!obj) continue;
      this.objects[i] = null;
      this.scene.tweens.add({
        targets: obj,
        scaleX: obj.scaleX * 1.3,
        scaleY: 0,
        alpha: 0,
        duration: 140,
        ease: 'Quad.easeIn',
        onComplete: () => {
          obj.destroy();
        },
      });
    }
  }

  destroy(): void {
    for (const obj of this.objects) obj?.destroy();
    this.objects.length = 0;
  }
}
