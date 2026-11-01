import Phaser from 'phaser';
import { createGameConfig } from './game/config';

const game = new Phaser.Game(createGameConfig('game'));

// Dev-only handle for debugging in the console and for browser smoke tests.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}
