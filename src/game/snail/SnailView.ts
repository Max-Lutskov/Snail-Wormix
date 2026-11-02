import Phaser from 'phaser';
import { SNAIL, type Snail } from '../../core/snail/snail';
import { isSolid, type TerrainMask } from '../../core/terrain/mask';
import { hexToInt, tokens } from '../art/tokens';

/** SVG parts from public/art/snail (see ART_SPEC.md, "Частини для анімації"). */
const PARTS = ['foot', 'shell', 'helmet', 'cannon', 'eyestalk', 'pupil'] as const;
type Part = (typeof PARTS)[number];
const key = (part: Part): string => `snail-${part}`;
/** Parts are rasterized this many times larger than drawn, so they stay sharp when zoomed. */
const SVG_SCALE = 4;
/** Snail-space units (the SVGs' own) to world px: the art is ~56 units tall, ~45 px in game. */
const ART_TO_WORLD = 0.8;
/** The art's body is centred about 5 units right of its origin; centre it on the hitbox. */
const ART_CENTER_X = 5;
/** Snail-space mounts (ART_SPEC.md / tokens.snail). */
const T = tokens.snail;
const BODY_ORIGIN = T.partsOrigin;
const CANNON_REST_DEG = -55;
const TILT_MAX = 0.35;
const TILT_REACH = 8;
const DEPTH = 1;
const LABEL_DEPTH = 15;
/** HP label and turn marker heights above the feet, world px. */
const LABEL_Y = 58;
const MARKER_Y = 84;
export const TEAM_COLORS = [
  tokens.colors.teams.green.helmet,
  tokens.colors.teams.red.helmet,
] as const;

export function teamColor(team: number): string {
  return TEAM_COLORS[team % TEAM_COLORS.length] ?? TEAM_COLORS[0];
}

export interface SnailViewState {
  /** The snail whose turn it is: shows the marker. */
  readonly active: boolean;
  /** Aim being pulled (radians, screen coords): turns the snail and its cannon. */
  readonly aim: number | null;
}

export function preloadSnail(scene: Phaser.Scene): void {
  for (const part of PARTS) {
    scene.load.svg(key(part), `art/snail/snail-${part}.svg`, { scale: SVG_SCALE });
  }
}

/** One snail assembled from its parts, following a core Snail. */
export class SnailView {
  /** Positioned at the feet; flipped by facing; tilted with the ground. */
  readonly root: Phaser.GameObjects.Container;
  private readonly art: Phaser.GameObjects.Container;
  private readonly foot: Phaser.GameObjects.Image;
  private readonly cannon: Phaser.GameObjects.Image;
  private readonly stalks: Phaser.GameObjects.Image[];
  private readonly pupils: Phaser.GameObjects.Image[];
  private readonly hpText: Phaser.GameObjects.Text;
  private readonly marker: Phaser.GameObjects.Graphics;
  private walkPhase = 0;
  private lastX: number;
  private tilt = 0;

  constructor(scene: Phaser.Scene, snail: Snail) {
    const img = (part: Part, x = 0, y = 0): Phaser.GameObjects.Image =>
      scene.add.image(x, y, key(part)).setScale(1 / SVG_SCALE);
    this.cannon = img('cannon', T.cannonMount.x, T.cannonMount.y).setOrigin(0, 0.5);
    this.cannon.setAngle(CANNON_REST_DEG);
    this.foot = img('foot').setOrigin(BODY_ORIGIN.x, BODY_ORIGIN.y);
    const shell = img('shell').setOrigin(BODY_ORIGIN.x, BODY_ORIGIN.y);
    this.stalks = T.eyestalkMounts.map((m) =>
      img('eyestalk', m.x, m.y).setOrigin(0.5, 0.913).setAngle(m.restAngleDeg),
    );
    const helmet = img('helmet')
      .setOrigin(BODY_ORIGIN.x, BODY_ORIGIN.y)
      .setTint(hexToInt(teamColor(snail.team)));
    this.pupils = T.eyestalkMounts.map(() => img('pupil'));
    this.art = scene.add.container(-ART_CENTER_X * ART_TO_WORLD, 0, [
      this.cannon,
      this.foot,
      shell,
      ...this.stalks,
      helmet,
      ...this.pupils,
    ]);
    this.art.setScale(ART_TO_WORLD);
    this.root = scene.add.container(snail.x, snail.y, [this.art]).setDepth(DEPTH);
    this.lastX = snail.x;

    this.hpText = scene.add
      .text(snail.x, snail.y - LABEL_Y, String(snail.hp), {
        fontFamily: 'Trebuchet MS, Arial, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: teamColor(snail.team),
        stroke: tokens.colors.snail.outline,
        strokeThickness: 4,
        resolution: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH);
    // Turn marker (ART_SPEC.md, HUD): a yellow triangle pointing down, thick outline.
    this.marker = scene.add.graphics().setDepth(LABEL_DEPTH);
    this.marker.fillStyle(hexToInt(tokens.colors.hud.accent), 1);
    this.marker.lineStyle(2.5, hexToInt(tokens.colors.snail.outline), 1);
    this.marker.fillTriangle(-8, -10, 8, -10, 0, 2);
    this.marker.strokeTriangle(-8, -10, 8, -10, 0, 2);
  }

  /** Moves the view to the snail's state; `time` in ms drives idle motion. */
  update(snail: Snail, mask: TerrainMask, time: number, view: SnailViewState): void {
    const facing = view.aim === null ? snail.facing : Math.cos(view.aim) >= 0 ? 1 : -1;
    this.root.setPosition(snail.x, snail.y);
    this.root.setScale(facing, 1);
    this.root.setAlpha(snail.alive ? 1 : Math.max(0, this.root.alpha - 0.03));
    this.hpText.setPosition(snail.x, snail.y - LABEL_Y).setText(String(snail.hp));
    this.hpText.setAlpha(this.root.alpha);
    this.marker.setVisible(view.active && snail.alive);
    this.marker.setPosition(snail.x, snail.y - MARKER_Y + Math.sin(time / 180) * 3);

    const moved = Math.abs(snail.x - this.lastX);
    this.lastX = snail.x;
    const walking = snail.grounded && moved > 0.01;
    if (walking) this.walkPhase += moved * 0.35;

    // Squash and stretch along the crawl; a stretch while flying.
    const squash = walking ? Math.sin(this.walkPhase) * 0.05 : 0;
    const stretch = snail.grounded ? 0 : Math.min(0.12, Math.abs(snail.vy) * 0.02);
    this.foot.setScale((1 + squash) / SVG_SCALE, (1 - squash + stretch) / SVG_SCALE);

    // Rotation is applied after the facing flip, so the world slope angle works for both sides.
    const targetTilt = snail.grounded ? this.groundTilt(snail, mask) : 0;
    this.tilt += (targetTilt - this.tilt) * 0.2;
    this.root.setRotation(this.tilt);

    // The cannon follows the aim. The root is flipped, then tilted, so undo both.
    const local =
      view.aim === null
        ? Phaser.Math.DegToRad(CANNON_REST_DEG)
        : facing === 1
          ? view.aim - this.tilt
          : Math.PI - view.aim + this.tilt;
    this.cannon.setRotation(local);

    // Eyestalks: sway at rest, bob while crawling, fly up in the air.
    const sway = Math.sin(time / 600) * 4;
    const bob = walking ? Math.sin(this.walkPhase * 2) * 6 : 0;
    const air = snail.grounded ? 0 : 14;
    T.eyestalkMounts.forEach((m, i) => {
      const stalk = this.stalks[i];
      const pupil = this.pupils[i];
      if (!stalk || !pupil) return;
      const spread = i === 0 ? -air : air;
      const angle = m.restAngleDeg + sway * (i === 0 ? 1 : -0.8) + bob + spread;
      stalk.setAngle(angle);
      // Pupil at the eye centre (0, -15 along the stalk), looking forward.
      const a = Phaser.Math.DegToRad(angle);
      pupil.setPosition(m.x + Math.sin(a) * 15 + 1.4, m.y - Math.cos(a) * 15);
    });
  }

  /** Ground slope under the snail, from the surface heights just left and right of its feet. */
  private groundTilt(snail: Snail, mask: TerrainMask): number {
    const top = (x: number): number => {
      for (let y = snail.y - SNAIL.stepUp - 2; y <= snail.y + SNAIL.stepDown + 2; y++) {
        if (isSolid(mask, x, y)) return y;
      }
      return snail.y;
    };
    const dy = top(snail.x + TILT_REACH) - top(snail.x - TILT_REACH);
    return Phaser.Math.Clamp(Math.atan2(dy, 2 * TILT_REACH), -TILT_MAX, TILT_MAX);
  }

  destroy(): void {
    this.root.destroy();
    this.hpText.destroy();
    this.marker.destroy();
  }
}
