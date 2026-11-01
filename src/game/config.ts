import Phaser from 'phaser';
import { MatchScene } from './scenes/MatchScene';

/** Logical resolution; the canvas is scaled to fit the screen (landscape, 16:9). */
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export function createGameConfig(parent: string): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#1d2b3a',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    scene: [MatchScene],
  };
}
