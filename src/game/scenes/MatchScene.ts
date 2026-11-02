import Phaser from 'phaser';
import { checksum } from '../../core/terrain/mask';
import type { TerrainLayout } from '../../core/terrain/layout';
import {
  addCrater,
  buildBaseTerrain,
  buildTerrain,
  createTerrainState,
  type Crater,
  type TerrainSource,
  type TerrainState,
} from '../../core/terrain/state';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../core/world';
import { tokens } from '../art/tokens';
import { worldZoom } from '../display';
import { createParallax, createSky } from '../env/sky';
import { Water } from '../env/Water';
import { playExplosion } from '../fx/explosion';
import { ensureFxTextures } from '../fx/fxTextures';
import { mapLookup, preloadMaps, readMaps, type LoadedMap } from '../maps/maps';
import { DecorView, MUSHROOM_SVG_SCALE, MUSHROOM_TEXTURE } from '../terrain/DecorView';
import { paintGardenArt, type SoilTile } from '../terrain/terrainArt';
import { TerrainView } from '../terrain/TerrainView';
import { DEBUG_INFO } from './HudScene';

const CAMERA_PAN_SPEED = 600; // world px per second
const SOIL_TILE_KEY = 'soil-tile';
/** How far past the world edges the camera may look, so falls into the water are visible. */
const CAMERA_MARGIN = 80;

/**
 * Match scene. For now a terrain sandbox:
 * click = pea crater, shift+click = acorn crater, ←/→ or A/D = pan,
 * R = new generated hills, M = next drawn map.
 */
export class MatchScene extends Phaser.Scene {
  private state!: TerrainState;
  private layout!: TerrainLayout;
  private view: TerrainView | null = null;
  private decor: DecorView | null = null;
  private back: Phaser.GameObjects.Image | null = null;
  private maps = new Map<string, LoadedMap>();
  private water!: Water;
  private soilTile!: SoilTile;
  private layoutSky!: (camera: Phaser.Cameras.Scene2D.Camera) => void;
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
    this.load.svg(MUSHROOM_TEXTURE, 'art/mushroom.svg', { scale: MUSHROOM_SVG_SCALE });
    preloadMaps(this);
  }

  create(): void {
    this.soilTile = this.readSoilTile();
    this.maps = readMaps(this);
    ensureFxTextures(this);

    this.layoutSky = createSky(this);
    createParallax(this, WORLD_WIDTH, WORLD_HEIGHT);
    this.water = new Water(this, WORLD_HEIGHT, -400, WORLD_WIDTH + 400, WORLD_HEIGHT + 200);

    const camera = this.cameras.main;
    camera.setBounds(-CAMERA_MARGIN, 0, WORLD_WIDTH + 2 * CAMERA_MARGIN, WORLD_HEIGHT);
    this.fitCamera();
    camera.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCamera);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitCamera);
    });

    this.loadTerrain({ kind: 'hills', seed: 1 });

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
        this.loadTerrain({ kind: 'hills', seed: Math.floor(Math.random() * 1_000_000) });
      });
      keyboard.on('keydown-M', () => {
        this.loadTerrain(this.nextSource());
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

  /** Zooms the camera so the world's full height fills the (physical-pixel) viewport. */
  private readonly fitCamera = (): void => {
    const camera = this.cameras.main;
    const { width, height } = this.scale;
    // Keep looking at the same spot, unless the view was wider than the bounds (then the
    // clamped position is meaningless): recenter on the world.
    const center =
      camera.worldView.width >= WORLD_WIDTH + 2 * CAMERA_MARGIN
        ? new Phaser.Math.Vector2(WORLD_WIDTH / 2, WORLD_HEIGHT / 2)
        : camera.midPoint.clone();
    camera.setSize(width, height);
    camera.setZoom(worldZoom(height));
    camera.centerOn(center.x, center.y);
    this.layoutSky(camera);
  };

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

  /** Cycles hills → each drawn map → hills. */
  private nextSource(): TerrainSource {
    const ids = [...this.maps.keys()];
    const current = this.state.source;
    const at = current.kind === 'map' ? ids.indexOf(current.id) : -1;
    const next = ids[at + 1];
    return next === undefined ? { kind: 'hills', seed: 1 } : { kind: 'map', id: next };
  }

  private loadTerrain(source: TerrainSource): void {
    this.view?.destroy();
    this.decor?.destroy();
    this.back?.destroy();
    this.back = null;

    const lookup = mapLookup(this.maps);
    this.state = createTerrainState(source);
    this.layout = buildTerrain(this.state, lookup);
    const map = source.kind === 'map' ? this.maps.get(source.id) : undefined;
    const baseArt = map
      ? map.rgba
      : paintGardenArt(buildBaseTerrain(source, lookup), this.soilTile);

    if (map?.backKey) this.back = this.add.image(0, 0, map.backKey).setOrigin(0, 0).setDepth(-1);
    this.view = new TerrainView(this, baseArt, this.layout, this.state.craters);
    this.view.gameObject.setDepth(0);
    this.decor = new DecorView(this, this.layout);
    this.water.setLevel(this.layout.waterLevel);
    this.updateInfo();
  }

  private explode(crater: Crater): void {
    playExplosion(this, crater, this.layout.mask, () => {
      const result = addCrater(this.state, this.layout, crater);
      this.state = result.state;
      this.view?.onCrater(crater);
      this.decor?.remove(result.removedDecor);
      this.updateInfo();
    });
  }

  private updateInfo(): void {
    const { source, craters } = this.state;
    const hash = checksum(this.layout.mask).toString(16).padStart(8, '0');
    const where = source.kind === 'hills' ? `hills ${source.seed}` : `map ${source.id}`;
    this.registry.set(
      DEBUG_INFO,
      `${where} · craters ${craters.length} · mask ${hash} · maps loaded ${this.maps.size}\n` +
        'click: pea · shift+click: acorn · ←/→ A/D: pan · R: new hills · M: next map',
    );
  }
}
