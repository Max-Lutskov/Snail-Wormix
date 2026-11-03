import type Phaser from 'phaser';
import { launch, muzzle, previewPath, type ShotWorld } from '../../core/projectile';
import { createMask, isSolid, type TerrainMask } from '../../core/terrain/mask';
import type { Snail } from '../../core/snail/snail';
import type { WeaponId } from '../../core/weapons';
import { hexToInt, tokens } from '../art/tokens';

/** Pull length (CSS px) that gives full power. */
const FULL_PULL_CSS = 180;
/** Ticks between preview dots, so 7 dots cover the start of the arc. */
/** Preview dots sit this far apart along the arc (world px), so the line has a steady length. */
const DOT_SPACING = 26;
/** Ticks of flight simulated for the preview (enough for the dots at any pull). */
const PREVIEW_TICKS = 90;
const DEPTH = 20;
const BAND = hexToInt(tokens.colors.hud.accent);
const OUTLINE = hexToInt(tokens.colors.snail.outline);

/**
 * The pull vector the simulation takes (core Aim): rounded, so the number sent online is
 * exactly the one every client and the server use.
 */
export function toVector(aim: Aim): { x: number; y: number } {
  const r = (v: number): number => Math.round(v * 1e4) / 1e4;
  return { x: r(Math.cos(aim.angle) * aim.power), y: r(Math.sin(aim.angle) * aim.power) };
}

export interface Aim {
  /** Shot direction, radians in screen coords. */
  readonly angle: number;
  /** Pull in [0, 1]. */
  readonly power: number;
}

/**
 * Slingshot aiming (ART_SPEC.md, "Постріл — рогатка"): press anywhere, pull back away from the
 * target, release to fire. Releasing within the cancel circle around the press point cancels.
 * Draws the rubber band from the snail, a power ring and the first dots of the arc.
 */
export class Slingshot {
  private start: { x: number; y: number } | null = null;
  /** The finger (or mouse) pulling the band; other pointers are ignored meanwhile. */
  private pointerId = -1;
  private aim: Aim | null = null;
  private readonly g: Phaser.GameObjects.Graphics;

  /**
   * @param canAim whether the active player may aim right now
   * @param onFire called on release with the final aim
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly canAim: () => boolean,
    private readonly onFire: (aim: Aim) => void,
  ) {
    this.g = scene.add.graphics().setDepth(DEPTH);
    scene.input.on('pointermove', this.move);
    scene.input.on('pointerup', this.up);
    scene.input.on('pointerupoutside', this.up);
  }

  /** The aim being pulled, or null. */
  current(): Aim | null {
    return this.aim;
  }

  /** Backbuffer px per CSS px (the canvas is sized in physical pixels). */
  private cssScale(): number {
    const css = this.scene.game.canvas.getBoundingClientRect().width;
    return css > 0 ? this.scene.scale.width / css : 1;
  }

  /** Whether a band is being pulled. */
  get active(): boolean {
    return this.start !== null;
  }

  /** Starts a pull from this press (the scene routes presses: HUD buttons and the stick first). */
  begin(p: Phaser.Input.Pointer): void {
    if (this.start || !this.canAim()) return;
    this.start = { x: p.x, y: p.y };
    this.pointerId = p.id;
    this.aim = null;
  }

  private readonly move = (p: Phaser.Input.Pointer): void => {
    if (!this.start || p.id !== this.pointerId) return;
    if (!this.canAim()) {
      this.cancel();
      return;
    }
    const s = this.cssScale();
    // Pull back: the shot goes from the pointer toward the press point.
    const dx = (this.start.x - p.x) / s;
    const dy = (this.start.y - p.y) / s;
    const len = Math.sqrt(dx * dx + dy * dy);
    this.aim =
      len < tokens.input.cancelRadiusScreenPx
        ? null
        : { angle: Math.atan2(dy, dx), power: Math.min(1, len / FULL_PULL_CSS) };
  };

  private readonly up = (p: Phaser.Input.Pointer): void => {
    if (!this.start || p.id !== this.pointerId) return;
    const aim = this.aim;
    this.cancel();
    if (aim && this.canAim()) this.onFire(aim);
  };

  cancel(): void {
    this.start = null;
    this.pointerId = -1;
    this.aim = null;
    this.g.clear();
  }

  /** Redraws the band, ring and preview for the active snail. */
  draw(snail: Snail | undefined, weapon: WeaponId, world: ShotWorld): void {
    const g = this.g;
    g.clear();
    if (!this.start || !snail) return;
    const camera = this.scene.cameras.main;
    const s = this.cssScale();
    // Cancel circle around the press point, dashed.
    const c = camera.getWorldPoint(this.start.x, this.start.y);
    const r = (tokens.input.cancelRadiusScreenPx * s) / camera.zoom;
    g.lineStyle(2 / camera.zoom, OUTLINE, 0.5);
    for (let i = 0; i < 24; i += 2) {
      const a0 = (i / 24) * Math.PI * 2;
      const a1 = ((i + 1) / 24) * Math.PI * 2;
      g.lineBetween(
        c.x + Math.cos(a0) * r,
        c.y + Math.sin(a0) * r,
        c.x + Math.cos(a1) * r,
        c.y + Math.sin(a1) * r,
      );
    }
    const aim = this.aim;
    if (!aim) return;

    const m = muzzle(snail);
    const pull = 18 + aim.power * 42;
    const px = m.x - Math.cos(aim.angle) * pull;
    const py = m.y - Math.sin(aim.angle) * pull;
    // The double band: two strands from either side of the snail to the pull point.
    const side = { x: -Math.sin(aim.angle) * 6, y: Math.cos(aim.angle) * 6 };
    for (const k of [-1, 1]) {
      const ax = m.x + side.x * k;
      const ay = m.y + side.y * k;
      g.lineStyle(5, OUTLINE, 1).lineBetween(ax, ay, px, py);
      g.lineStyle(3, BAND, 1).lineBetween(ax, ay, px, py);
    }
    const ring = 5 + aim.power * 7;
    g.fillStyle(BAND, 1).fillCircle(px, py, ring);
    g.lineStyle(2, OUTLINE, 1).strokeCircle(px, py, ring);

    // The start of the arc, always the same length: flown through open air (so it doesn't stop
    // where it meets the ground and jump back out as the aim turns), dots at even distances
    // along it, and dots that fall inside the terrain simply not drawn.
    const shot = launch(snail, weapon, toVector(aim));
    const air = this.openAir(world.mask);
    const path = previewPath(shot, { ...world, mask: air, snails: [] }, PREVIEW_TICKS);
    const dots = tokens.input.trajectoryPreviewDots;
    let prev = { x: shot.x, y: shot.y };
    let travelled = 0;
    let drawn = 0;
    for (const p of path) {
      travelled += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
      if (travelled < DOT_SPACING * (drawn + 1)) continue;
      const alpha = 1 - drawn / dots;
      drawn++;
      if (!isSolid(world.mask, p.x, p.y)) {
        g.fillStyle(OUTLINE, alpha * 0.8).fillCircle(p.x, p.y, 3.4);
        g.fillStyle(0xffffff, alpha).fillCircle(p.x, p.y, 2.4);
      }
      if (drawn >= dots) break;
    }
  }

  private air: TerrainMask | null = null;

  /** An empty mask the size of the world, for flying the preview through open air. */
  private openAir(mask: TerrainMask): TerrainMask {
    if (this.air?.width !== mask.width || this.air.height !== mask.height) {
      this.air = createMask(mask.width, mask.height);
    }
    return this.air;
  }

  destroy(): void {
    this.scene.input.off('pointermove', this.move);
    this.scene.input.off('pointerup', this.up);
    this.scene.input.off('pointerupoutside', this.up);
    this.g.destroy();
  }
}
