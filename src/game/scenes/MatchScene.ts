import Phaser from 'phaser';
import { checksum } from '../../core/terrain/mask';
import type { TerrainLayout } from '../../core/terrain/layout';
import {
  addCrater,
  buildTerrain,
  createTerrainState,
  type TerrainState,
} from '../../core/terrain/state';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../core/world';
import { TerrainView } from '../terrain/TerrainView';

const DEBUG_CRATER_RADIUS = 40;
const CAMERA_PAN_SPEED = 600; // px per second

/** Match scene. For now: terrain sandbox — click to blow holes, R for a new map. */
export class MatchScene extends Phaser.Scene {
  private state!: TerrainState;
  private layout!: TerrainLayout;
  private view: TerrainView | null = null;
  private water!: Phaser.GameObjects.Rectangle;
  private info!: Phaser.GameObjects.Text;
  private keys!: {
    left: Phaser.Input.Keyboard.Key[];
    right: Phaser.Input.Keyboard.Key[];
  };

  constructor() {
    super('MatchScene');
  }

  create(): void {
    const camera = this.cameras.main;
    camera.setBackgroundColor('#8ecae6');
    // Let the camera show a little past the world edges so falls into the water are visible.
    camera.setBounds(-80, 0, WORLD_WIDTH + 160, WORLD_HEIGHT);
    camera.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);

    this.water = this.add
      .rectangle(-400, 0, WORLD_WIDTH + 800, 0, 0x2a6f97, 0.85)
      .setOrigin(0, 0)
      .setDepth(10);

    this.info = this.add
      .text(12, 10, '', { fontFamily: 'monospace', fontSize: '16px', color: '#1d2b3a' })
      .setScrollFactor(0)
      .setDepth(20);

    this.loadTerrain(1);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.explode(pointer.worldX, pointer.worldY);
    });

    const keyboard = this.input.keyboard;
    if (keyboard) {
      const K = Phaser.Input.Keyboard.KeyCodes;
      this.keys = {
        left: [keyboard.addKey(K.LEFT), keyboard.addKey(K.A)],
        right: [keyboard.addKey(K.RIGHT), keyboard.addKey(K.D)],
      };
      keyboard.on('keydown-R', () => {
        this.loadTerrain(Math.floor(Math.random() * 1_000_000));
      });
    } else {
      this.keys = { left: [], right: [] };
    }
  }

  override update(_time: number, delta: number): void {
    const dir =
      (this.keys.right.some((k) => k.isDown) ? 1 : 0) -
      (this.keys.left.some((k) => k.isDown) ? 1 : 0);
    if (dir !== 0) this.cameras.main.scrollX += (dir * CAMERA_PAN_SPEED * delta) / 1000;
  }

  private loadTerrain(seed: number): void {
    this.view?.destroy();
    this.state = createTerrainState({ kind: 'hills', seed });
    this.layout = buildTerrain(this.state);
    this.view = new TerrainView(this, this.layout);
    this.water.setY(this.layout.waterLevel).setSize(WORLD_WIDTH + 800, WORLD_HEIGHT);
    this.updateInfo();
  }

  private explode(x: number, y: number): void {
    const result = addCrater(this.state, this.layout, { x, y, r: DEBUG_CRATER_RADIUS });
    this.state = result.state;
    if (result.changed) this.view?.redraw(result.changed);
    this.updateInfo();
  }

  private updateInfo(): void {
    const { source, craters } = this.state;
    const hash = checksum(this.layout.mask).toString(16).padStart(8, '0');
    this.info.setText(
      `seed ${source.seed} · craters ${craters.length} · mask ${hash}\n` +
        'click: boom · ←/→ or A/D: pan · R: new map',
    );
  }
}
