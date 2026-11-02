import type Phaser from 'phaser';

export const FX = {
  dot: 'fx-dot',
  chunk: 'fx-chunk',
  puff: 'fx-puff',
} as const;

/** Small white shapes, tinted per particle. Generated once per game. */
export function ensureFxTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(FX.dot)) return;
  const g = scene.make.graphics({}, false);

  g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
  g.generateTexture(FX.dot, 8, 8);
  g.clear();

  g.fillStyle(0xffffff, 1).fillRoundedRect(0, 0, 7, 5, 1.5);
  g.generateTexture(FX.chunk, 7, 5);
  g.clear();

  // Soft puff: stacked translucent discs.
  for (let i = 0; i < 6; i++) g.fillStyle(0xffffff, 0.18).fillCircle(16, 16, 16 - i * 2.4);
  g.generateTexture(FX.puff, 32, 32);

  g.destroy();
}
