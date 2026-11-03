import Phaser from 'phaser';
import { audio } from './game/audio/audio';
import { createGameConfig, watchResize } from './game/config';

const parent = document.getElementById('game');
if (!parent) throw new Error('main: #game element is missing');

const game = new Phaser.Game(createGameConfig(parent));
watchResize(game, parent);

// Browsers keep audio off until a gesture: every tap or key (re)starts it. Capture phase, so
// taps the menu stops from reaching the game still count.
for (const type of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(
    type,
    () => {
      audio.unlock();
    },
    { capture: true },
  );
}

// Phones: the first tap goes fullscreen (landscape where the browser allows locking it), so
// the browser's bars don't eat the screen. Needs a user gesture, hence the DOM listener.
if (window.matchMedia('(pointer: coarse)').matches && document.fullscreenEnabled) {
  window.addEventListener(
    'pointerup',
    () => {
      if (document.fullscreenElement) return;
      document.documentElement
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() =>
          (screen.orientation as { lock?: (o: string) => Promise<void> }).lock?.('landscape'),
        )
        .catch(() => undefined);
    },
    { once: true },
  );
}

// Dev-only handle for debugging in the console and for browser smoke tests.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}
