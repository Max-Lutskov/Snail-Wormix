import Phaser from 'phaser';
import { MatchScene } from './scenes/MatchScene';

/**
 * Base logical resolution. EXPAND keeps the height at 720 and widens the visible area on
 * wider screens (a ~19.5:9 phone sees ~1560 of the 1600-wide world) instead of letterboxing.
 */
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export function createGameConfig(parent: string): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#cdeee4',
    scale: {
      mode: Phaser.Scale.EXPAND,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    scene: [MatchScene],
  };
}
