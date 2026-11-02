import type Phaser from 'phaser';
import type { Projectile } from '../../core/projectile';
import type { WeaponId } from '../../core/weapons';

const SVG_SCALE = 4;
/** On-screen size of a shot, world px (the ammo SVGs are 64 units across). */
const SIZE = 14;
const DEPTH = 25;
const key = (weapon: WeaponId): string => `ammo-${weapon}`;

export function preloadShots(scene: Phaser.Scene, weapons: readonly WeaponId[]): void {
  for (const w of weapons) scene.load.svg(key(w), `art/ammo-${w}.svg`, { scale: SVG_SCALE });
}

/** The shot in flight: its ammo icon, spinning along. */
export class ShotView {
  private image: Phaser.GameObjects.Image | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  update(p: Projectile | null): void {
    if (!p) {
      this.image?.destroy();
      this.image = null;
      return;
    }
    if (!this.image || this.image.texture.key !== key(p.weapon)) {
      this.image?.destroy();
      this.image = this.scene.add
        .image(p.x, p.y, key(p.weapon))
        .setScale(SIZE / (64 * SVG_SCALE))
        .setDepth(DEPTH);
    }
    this.image.setPosition(p.x, p.y);
    this.image.rotation += p.vx * 0.04;
  }

  destroy(): void {
    this.image?.destroy();
    this.image = null;
  }
}
