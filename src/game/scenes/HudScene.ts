import Phaser from 'phaser';
import { renderSize, devicePixelRatio } from '../display';

/** Registry key MatchScene writes its debug line to. */
export const DEBUG_INFO = 'debugInfo';

/**
 * Screen-space overlay above the world. Its camera zoom equals the render scale, so sizes
 * here are CSS pixels regardless of the world's camera zoom.
 */
export class HudScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HudScene', active: true });
  }

  create(): void {
    const info = this.add.text(12, 10, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#141c16',
    });
    const sync = (): void => {
      info.setText(String(this.registry.get(DEBUG_INFO) ?? ''));
    };
    this.registry.events.on(`changedata-${DEBUG_INFO}`, sync);
    this.registry.events.on(`setdata`, sync);
    sync();

    const fit = (): void => {
      const camera = this.cameras.main;
      const { width, height } = this.scale;
      const parent = this.game.canvas.parentElement;
      const scale = parent
        ? renderSize(parent.clientWidth, parent.clientHeight, devicePixelRatio()).scale
        : 1;
      camera.setSize(width, height);
      camera.setZoom(scale);
      camera.setOrigin(0, 0);
    };
    fit();
    this.scale.on(Phaser.Scale.Events.RESIZE, fit);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, fit);
    });
  }
}
