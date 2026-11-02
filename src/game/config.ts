import Phaser from 'phaser';
import { renderSize, devicePixelRatio } from './display';
import { HudScene } from './scenes/HudScene';
import { MatchScene } from './scenes/MatchScene';

/**
 * The canvas is sized in physical pixels (see display.ts) and shown at CSS size via zoom.
 * Scenes fit the 720-high world with camera zoom, so wider screens see more of the
 * 1600-wide world (a ~19.5:9 phone sees ~1560) instead of black bars.
 */
export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  const size = renderSize(parent.clientWidth, parent.clientHeight, devicePixelRatio());
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#cdeee4',
    scale: {
      mode: Phaser.Scale.NONE,
      width: size.width,
      height: size.height,
      zoom: 1 / size.scale,
    },
    scene: [MatchScene, HudScene],
  };
}

/** Keeps the backbuffer matched to the parent's size and the device pixel ratio. */
export function watchResize(game: Phaser.Game, parent: HTMLElement): void {
  const apply = (): void => {
    const size = renderSize(parent.clientWidth, parent.clientHeight, devicePixelRatio());
    game.scale.setZoom(1 / size.scale);
    game.scale.resize(size.width, size.height);
  };
  new ResizeObserver(apply).observe(parent);
}
