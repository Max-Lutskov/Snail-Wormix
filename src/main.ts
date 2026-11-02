import Phaser from 'phaser';
import { createGameConfig, watchResize } from './game/config';

const parent = document.getElementById('game');
if (!parent) throw new Error('main: #game element is missing');

const game = new Phaser.Game(createGameConfig(parent));
watchResize(game, parent);

// Dev-only handle for debugging in the console and for browser smoke tests.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}
