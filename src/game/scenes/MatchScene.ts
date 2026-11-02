import Phaser from 'phaser';
import { checksum } from '../../core/terrain/mask';
import type { TerrainLayout } from '../../core/terrain/layout';
import {
  addCrater,
  buildBaseTerrain,
  buildTerrain,
  createTerrainState,
  type Crater,
  type TerrainState,
} from '../../core/terrain/state';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../core/world';
import { tokens } from '../art/tokens';
import { createParallax, createSky } from '../env/sky';
import { Water } from '../env/Water';
import { playExplosion } from '../fx/explosion';
import { ensureFxTextures } from '../fx/fxTextures';
import type { SoilTile } from '../terrain/terrainArt';
import { TerrainView } from '../terrain/TerrainView';

const CAMERA_PAN_SPEED = 600; // px per second
const SOIL_TILE_KEY = 'soil-tile';

/**
 * Match scene. For now a terrain sandbox:
 * click = pea crater, shift+click = acorn crater, ←/→ or A/D = pan, R = new map.
 */
export class MatchScene extends Phaser.Scene {
  private state!: TerrainState;
  private layout!: TerrainLayout;
  private view: TerrainView | null = null;
  private water!: Water;
  private soilTile!: SoilTile;
  private info!: Phaser.GameObjects.Text;
  private keys: { left: Phaser.Input.Keyboard.Key[]; right: Phaser.Input.Keyboard.Key[] } = {
    left: [],
    right: [],
  };

  constructor() {
    super('MatchScene');
  }

  preload(): void {
    const size = tokens.terrain.soilTileSize;
    this.load.svg(SOIL_TILE_KEY, 'art/soil-tile.svg', { width: size, height: size });
  }

  create(): void {
    this.soilTile = this.readSoilTile();
    ensureFxTextures(this);

    const camera = this.cameras.main;
    // Show a little past the world edges so falls into the water are visible.
    camera.setBounds(-80, 0, WORLD_WIDTH + 160, WORLD_HEIGHT);
    camera.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);

    createSky(this);
    createParallax(this, WORLD_WIDTH, WORLD_HEIGHT);
    this.water = new Water(this, WORLD_HEIGHT, -400, WORLD_WIDTH + 400, WORLD_HEIGHT + 200);

    this.info = this.add
      .text(12, 10, '', { fontFamily: 'monospace', fontSize: '15px', color: '#141c16' })
      .setScrollFactor(0)
      .setDepth(40);

    this.loadTerrain(1);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const shift = (pointer.event as MouseEvent | undefined)?.shiftKey === true;
      const r = shift ? tokens.ammo.acorn.craterRadius : tokens.ammo.pea.craterRadius;
      this.explode({ x: pointer.worldX, y: pointer.worldY, r });
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
    }
  }

  override update(time: number, delta: number): void {
    const dir =
      (this.keys.right.some((k) => k.isDown) ? 1 : 0) -
      (this.keys.left.some((k) => k.isDown) ? 1 : 0);
    if (dir !== 0) this.cameras.main.scrollX += (dir * CAMERA_PAN_SPEED * delta) / 1000;
    this.water.update(time);
  }

  private readSoilTile(): SoilTile {
    const size = tokens.terrain.soilTileSize;
    const source = this.textures.get(SOIL_TILE_KEY).getSourceImage() as CanvasImageSource;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('MatchScene: no 2D context for the soil tile');
    ctx.drawImage(source, 0, 0, size, size);
    return { size, pixels: ctx.getImageData(0, 0, size, size).data };
  }

  private loadTerrain(seed: number): void {
    this.view?.destroy();
    this.state = createTerrainState({ kind: 'hills', seed });
    this.layout = buildTerrain(this.state);
    this.view = new TerrainView(
      this,
      buildBaseTerrain(this.state.source),
      this.layout,
      this.state.craters,
      this.soilTile,
    );
    this.view.gameObject.setDepth(0);
    this.water.setLevel(this.layout.waterLevel);
    this.updateInfo();
  }

  private explode(crater: Crater): void {
    playExplosion(this, crater, this.layout.mask, () => {
      this.state = addCrater(this.state, this.layout, crater).state;
      this.view?.onCrater(crater);
      this.updateInfo();
    });
  }

  private updateInfo(): void {
    const { source, craters } = this.state;
    const hash = checksum(this.layout.mask).toString(16).padStart(8, '0');
    this.info.setText(
      `seed ${source.seed} · craters ${craters.length} · mask ${hash}\n` +
        'click: pea · shift+click: acorn · ←/→ A/D: pan · R: new map',
    );
  }
}
