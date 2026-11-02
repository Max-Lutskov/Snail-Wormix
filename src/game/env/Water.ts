import type Phaser from 'phaser';
import { hexToInt, tokens } from '../art/tokens';

const C = tokens.colors.water;
const { wavePeriod, waveAmplitude } = tokens.water;
const STEP = 8;
const WAVE_SPEED = 0.0022; // radians per ms
const SURFACE_BAND = 10;
const BUBBLES = 9;

/** Deadly water: animated sine surface, dark depth, drifting highlights and rising bubbles. */
export class Water {
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(
    scene: Phaser.Scene,
    private level: number,
    private readonly fromX: number,
    private readonly toX: number,
    private readonly bottom: number,
  ) {
    this.g = scene.add.graphics().setDepth(15);
  }

  setLevel(level: number): void {
    this.level = level;
  }

  private surfaceY(x: number, time: number): number {
    return (
      this.level + Math.sin((x / wavePeriod) * Math.PI * 2 + time * WAVE_SPEED) * waveAmplitude
    );
  }

  update(time: number): void {
    const { g, fromX, toX, bottom } = this;
    g.clear();

    // Light surface band, then the deep body drawn over it a bit lower.
    g.fillStyle(hexToInt(C.surface), 1);
    g.beginPath();
    g.moveTo(fromX, bottom);
    for (let x = fromX; x <= toX; x += STEP) g.lineTo(x, this.surfaceY(x, time));
    g.lineTo(toX, bottom);
    g.closePath();
    g.fillPath();

    g.fillStyle(hexToInt(C.deep), 1);
    g.beginPath();
    g.moveTo(fromX, bottom);
    for (let x = fromX; x <= toX; x += STEP)
      g.lineTo(x, this.surfaceY(x - 20, time) + SURFACE_BAND);
    g.lineTo(toX, bottom);
    g.closePath();
    g.fillPath();

    // Short highlight dashes drifting along the surface.
    g.fillStyle(hexToInt(C.highlight), 1);
    const drift = (time * 0.015) % 90;
    for (let x = fromX + drift; x < toX; x += 90) {
      g.fillRect(x, this.surfaceY(x, time) + SURFACE_BAND + 6, 14, 2);
    }

    // Bubbles rising and resetting.
    const depth = bottom - this.level;
    g.fillStyle(hexToInt(C.bubble), 0.9);
    for (let i = 0; i < BUBBLES; i++) {
      const x = fromX + ((i * 397) % (toX - fromX));
      const rise = (time * 0.03 + i * 137) % depth;
      const y = bottom - rise;
      if (y < this.level + SURFACE_BAND + 4) continue;
      g.fillCircle(x + Math.sin(time * 0.003 + i) * 3, y, 2 + (i % 3));
    }
  }
}
