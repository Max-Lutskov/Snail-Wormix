import Phaser from 'phaser';
import { nextInt, seedRng } from '../../core/rng';

/** Placeholder match scene: proves Phaser boots and can read from core. */
export class MatchScene extends Phaser.Scene {
  constructor() {
    super('MatchScene');
  }

  create(): void {
    const { width, height } = this.scale;

    const ground = this.add.graphics();
    ground.fillStyle(0x5b4636, 1);
    ground.fillRect(0, height * 0.75, width, height * 0.25);

    const roll = nextInt(seedRng(42), 1, 100).value;
    this.add
      .text(width / 2, height / 2, `Snail Artillery — каркас\nseed 42 → ${roll}`, {
        fontFamily: 'sans-serif',
        fontSize: '32px',
        color: '#f4f1de',
        align: 'center',
      })
      .setOrigin(0.5);
  }
}
