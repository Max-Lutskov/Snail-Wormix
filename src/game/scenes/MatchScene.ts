import Phaser from 'phaser';
import {
  applyExplosion,
  spawnSnail,
  stepSnail,
  type Snail,
  type SnailInput,
  type SnailWorld,
} from '../../core/snail/snail';
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
import { ART_SCALE, WORLD_HEIGHT, WORLD_WIDTH } from '../../core/world';
import { tokens } from '../art/tokens';
import { worldZoom } from '../display';
import { createParallax, createSky } from '../env/sky';
import { Water } from '../env/Water';
import { playExplosion } from '../fx/explosion';
import { ensureFxTextures } from '../fx/fxTextures';
import { mapLookup, preloadMaps, readMaps, type LoadedMap } from '../maps/maps';
import { DecorView, MUSHROOM_SVG_SCALE, MUSHROOM_TEXTURE } from '../terrain/DecorView';
import { paintGardenArt, type SoilTile } from '../terrain/terrainArt';
import { paintHillsGrass } from '../terrain/grassArt';
import { GrassView } from '../terrain/GrassView';
import { TerrainView } from '../terrain/TerrainView';
import { preloadSnail, SnailView } from '../snail/SnailView';
import { DEBUG_INFO } from './HudScene';

/** Simulation tick (core steps are fixed at 60 per second). */
const TICK_MS = 1000 / 60;
/** At most this many ticks per frame, so a stalled tab doesn't fast-forward. */
const MAX_TICKS_PER_FRAME = 5;
/** Camera follow smoothing (share of the distance per frame). */
const CAMERA_LERP = 0.08;
const SOIL_TILE_KEY = 'soil-tile';
/**
 * How far past the world edges the camera may look. None: a drawn map's backdrop ends at the
 * world edge, and the water there is visible anyway.
 */
const CAMERA_MARGIN = 0;
/** Grass fringe: over the ground, under its decor (so mushrooms aren't buried). */
const GRASS_DEPTH = 0.4;

/**
 * Match scene. For now a sandbox: two snails on the terrain.
 * ←/→ or A/D = crawl, W/↑/space = jump, Tab = other snail, click = pea crater,
 * shift+click = acorn crater, R = new generated hills, M = next drawn map.
 */
export class MatchScene extends Phaser.Scene {
  private state!: TerrainState;
  private layout!: TerrainLayout;
  private view: TerrainView | null = null;
  private decor: DecorView | null = null;
  private grass: GrassView | null = null;
  private back: Phaser.GameObjects.Image | null = null;
  private maps = new Map<string, LoadedMap>();
  private water!: Water;
  private soilTile!: SoilTile;
  private layoutSky!: (camera: Phaser.Cameras.Scene2D.Camera) => void;
  private keys: {
    left: Phaser.Input.Keyboard.Key[];
    right: Phaser.Input.Keyboard.Key[];
    jump: Phaser.Input.Keyboard.Key[];
  } = { left: [], right: [], jump: [] };
  private snails: Snail[] = [];
  private snailViews: SnailView[] = [];
  private active = 0;
  private tickCarry = 0;
  /** A jump press waits here until the next tick consumes it. */
  private jumpQueued = false;

  constructor() {
    super('MatchScene');
  }

  preload(): void {
    const size = tokens.terrain.soilTileSize * ART_SCALE;
    this.load.svg(SOIL_TILE_KEY, 'art/soil-tile.svg', { width: size, height: size });
    this.load.svg(MUSHROOM_TEXTURE, 'art/mushroom.svg', { scale: MUSHROOM_SVG_SCALE });
    preloadSnail(this);
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

    this.loadTerrain(this.startSource());

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
        jump: [keyboard.addKey(K.UP), keyboard.addKey(K.W), keyboard.addKey(K.SPACE)],
      };
      for (const k of this.keys.jump) {
        k.on('down', () => {
          this.jumpQueued = true;
        });
      }
      const tab = keyboard.addKey(K.TAB);
      tab.on('down', () => {
        this.active = (this.active + 1) % Math.max(1, this.snails.length);
      });
      keyboard.on('keydown-R', () => {
        this.loadTerrain({ kind: 'hills', seed: Math.floor(Math.random() * 1_000_000) });
      });
      keyboard.on('keydown-M', () => {
        this.loadTerrain(this.nextSource());
      });
    }
  }

  override update(time: number, delta: number): void {
    const move = ((this.keys.right.some((k) => k.isDown) ? 1 : 0) -
      (this.keys.left.some((k) => k.isDown) ? 1 : 0)) as SnailInput['move'];
    const world: SnailWorld = { mask: this.layout.mask, waterLevel: this.layout.waterLevel };
    this.tickCarry = Math.min(this.tickCarry + delta, TICK_MS * MAX_TICKS_PER_FRAME);
    while (this.tickCarry >= TICK_MS) {
      this.tickCarry -= TICK_MS;
      const input: SnailInput = { move, jump: this.jumpQueued };
      this.jumpQueued = false;
      this.snails = this.snails.map((s, i) =>
        stepSnail(s, i === this.active ? input : { move: 0, jump: false }, world),
      );
    }
    this.snails.forEach((s, i) => this.snailViews[i]?.update(s, this.layout.mask, time));
    this.followActive();
    this.water.update(time);
  }

  /** Eases the camera toward the active snail. */
  private followActive(): void {
    const snail = this.snails[this.active];
    if (!snail?.alive) return;
    const camera = this.cameras.main;
    const { x, y } = camera.midPoint;
    camera.centerOn(x + (snail.x - x) * CAMERA_LERP, y + (snail.y - y) * CAMERA_LERP);
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
    const size = tokens.terrain.soilTileSize * ART_SCALE;
    const source = this.textures.get(SOIL_TILE_KEY).getSourceImage() as CanvasImageSource;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('MatchScene: no 2D context for the soil tile');
    ctx.drawImage(source, 0, 0, size, size);
    return { size, pixels: ctx.getImageData(0, 0, size, size).data };
  }

  /** Hills, or a drawn map picked with ?map=<id> in the URL (e.g. ?map=bridge). */
  private startSource(): TerrainSource {
    const id = new URLSearchParams(window.location.search).get('map');
    return id !== null && this.maps.has(id) ? { kind: 'map', id } : { kind: 'hills', seed: 1 };
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
    this.grass?.destroy();
    this.grass = null;
    this.back?.destroy();
    this.back = null;

    const lookup = mapLookup(this.maps);
    this.state = createTerrainState(source);
    this.layout = buildTerrain(this.state, lookup);
    const map = source.kind === 'map' ? this.maps.get(source.id) : undefined;
    const original = buildBaseTerrain(source, lookup);
    const baseArt = map ? map.rgba : paintGardenArt(original, this.soilTile);

    if (map?.backKey) {
      this.back = this.add
        .image(0, 0, map.backKey)
        .setOrigin(0, 0)
        .setScale(1 / ART_SCALE)
        .setDepth(-1);
    }
    this.view = new TerrainView(
      this,
      baseArt,
      original,
      this.layout,
      this.state.craters,
      map !== undefined,
    ).setDepth(0);
    this.decor = new DecorView(this, this.layout);
    const grassArt =
      source.kind === 'hills'
        ? paintHillsGrass(original, source.seed)
        : map?.grassKey
          ? (this.textures.get(map.grassKey).getSourceImage() as CanvasImageSource)
          : null;
    if (grassArt) {
      const { width, height } = this.layout.mask;
      this.grass = new GrassView(this, grassArt, width, height, this.state.craters).setDepth(
        GRASS_DEPTH,
      );
    }
    this.water.setLevel(this.layout.waterLevel);
    this.spawnSnails();
    this.updateInfo();
  }

  /** One snail per team on the first two spawn points. */
  private spawnSnails(): void {
    for (const v of this.snailViews) v.destroy();
    const world: SnailWorld = { mask: this.layout.mask, waterLevel: this.layout.waterLevel };
    this.snails = this.layout.spawns
      .slice(0, 2)
      .map((spawn, i) => ({ ...spawnSnail(i, i, spawn.x, world), facing: i === 0 ? 1 : -1 }));
    this.snailViews = this.snails.map((s) => new SnailView(this, s));
    this.active = 0;
  }

  private explode(crater: Crater): void {
    playExplosion(this, crater, this.layout.mask, () => {
      const result = addCrater(this.state, this.layout, crater);
      this.state = result.state;
      this.view?.onCrater(crater);
      this.decor?.remove(result.removedDecor);
      this.grass?.onCrater(crater);
      this.snails = this.snails.map((s) => applyExplosion(s, crater));
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
        '←/→ A/D: crawl · W/space: jump · Tab: other snail · click: pea · shift+click: acorn · ' +
        'R: new hills · M: next map',
    );
  }
}
