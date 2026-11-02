import Phaser from 'phaser';
import {
  aimTicksLeft,
  createMatch,
  stepMatch,
  type MatchEvent,
  type MatchInput,
  type MatchState,
} from '../../core/match';
import { MAX_WIND, type ShotWorld } from '../../core/projectile';
import { SNAIL } from '../../core/snail/snail';
import { checksum } from '../../core/terrain/mask';
import type { TerrainLayout } from '../../core/terrain/layout';
import {
  buildBaseTerrain,
  buildTerrain,
  createTerrainState,
  type TerrainSource,
} from '../../core/terrain/state';
import { WEAPON_IDS, type WeaponId } from '../../core/weapons';
import { ART_SCALE, WORLD_HEIGHT, WORLD_WIDTH } from '../../core/world';
import { tokens } from '../art/tokens';
import { worldZoom } from '../display';
import { createParallax, createSky } from '../env/sky';
import { Water } from '../env/Water';
import { playExplosion } from '../fx/explosion';
import { ensureFxTextures } from '../fx/fxTextures';
import { Slingshot } from '../input/Slingshot';
import { mapLookup, preloadMaps, readMaps, type LoadedMap } from '../maps/maps';
import { DecorView, MUSHROOM_SVG_SCALE, MUSHROOM_TEXTURE } from '../terrain/DecorView';
import { paintGardenArt, type SoilTile } from '../terrain/terrainArt';
import { paintHillsGrass } from '../terrain/grassArt';
import { GrassView } from '../terrain/GrassView';
import { TerrainView } from '../terrain/TerrainView';
import { preloadShots, ShotView } from '../snail/ShotView';
import { preloadSnail, SnailView, teamColor } from '../snail/SnailView';
import {
  DEBUG_INFO,
  HUD_JUMP,
  HUD_MOVE,
  HUD_RESTART,
  HUD_SELECT_WEAPON,
  HUD_STATE,
  type HudState,
} from './HudScene';

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
const TEAM_NAMES = ['Зелені', 'Червоні'] as const;
const WIND_KEY = 'leaf-wind';
const WEAPON_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR'] as const;

/**
 * Match scene: a hot-seat duel, one snail per team, taking turns.
 * ←/→ or A/D = crawl, W/↑/space = jump, drag anywhere and release = slingshot shot,
 * 1/2/3 = weapon, Enter = new match when over, R = new generated hills, M = next drawn map.
 */
export class MatchScene extends Phaser.Scene {
  private match!: MatchState;
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
  private snailViews: SnailView[] = [];
  private shotView!: ShotView;
  private slingshot!: Slingshot;
  private tickCarry = 0;
  /** Discrete inputs wait here until the next tick consumes them. */
  private queued: { jump: boolean; fire: MatchInput['fire']; weapon: WeaponId | null } = {
    jump: false,
    fire: null,
    weapon: null,
  };
  private hudJson = '';
  /** Crawl direction held on the on-screen buttons. */
  private touchMove: MatchInput['move'] = 0;

  constructor() {
    super('MatchScene');
  }

  preload(): void {
    const size = tokens.terrain.soilTileSize * ART_SCALE;
    this.load.svg(SOIL_TILE_KEY, 'art/soil-tile.svg', { width: size, height: size });
    this.load.svg(MUSHROOM_TEXTURE, 'art/mushroom.svg', { scale: MUSHROOM_SVG_SCALE });
    this.load.svg(WIND_KEY, 'art/leaf-wind.svg', { scale: 4 });
    preloadSnail(this);
    preloadShots(this, WEAPON_IDS);
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

    this.shotView = new ShotView(this);
    this.slingshot = new Slingshot(
      this,
      () => this.canAim(),
      (aim) => {
        this.queued.fire = aim;
      },
    );
    this.loadTerrain(this.startSource());

    const selectWeapon = (id: WeaponId): void => {
      this.queued.weapon = id;
    };
    const restart = (): void => {
      if (this.match.phase === 'over') this.loadTerrain(this.match.terrain.source);
    };
    const touchMove = (move: MatchInput['move']): void => {
      this.touchMove = move;
    };
    const touchJump = (): void => {
      this.queued.jump = true;
    };
    this.game.events.on(HUD_SELECT_WEAPON, selectWeapon);
    this.game.events.on(HUD_RESTART, restart);
    this.game.events.on(HUD_MOVE, touchMove);
    this.game.events.on(HUD_JUMP, touchJump);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(HUD_SELECT_WEAPON, selectWeapon);
      this.game.events.off(HUD_RESTART, restart);
      this.game.events.off(HUD_MOVE, touchMove);
      this.game.events.off(HUD_JUMP, touchJump);
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
          this.queued.jump = true;
        });
      }
      WEAPON_IDS.forEach((id, i) => {
        const name = WEAPON_KEYS[i];
        if (name)
          keyboard.on(`keydown-${name}`, () => {
            selectWeapon(id);
          });
      });
      keyboard.on('keydown-ENTER', restart);
      keyboard.on('keydown-R', () => {
        this.loadTerrain({ kind: 'hills', seed: Math.floor(Math.random() * 1_000_000) });
      });
      keyboard.on('keydown-M', () => {
        this.loadTerrain(this.nextSource());
      });
    }
  }

  override update(time: number, delta: number): void {
    const keys = ((this.keys.right.some((k) => k.isDown) ? 1 : 0) -
      (this.keys.left.some((k) => k.isDown) ? 1 : 0)) as MatchInput['move'];
    const move = keys !== 0 ? keys : this.touchMove;
    this.tickCarry = Math.min(this.tickCarry + delta, TICK_MS * MAX_TICKS_PER_FRAME);
    while (this.tickCarry >= TICK_MS) {
      this.tickCarry -= TICK_MS;
      const input: MatchInput = { move, ...this.queued };
      this.queued = { jump: false, fire: null, weapon: null };
      const r = stepMatch(this.match, input, this.layout);
      this.match = r.state;
      for (const e of r.events) this.onEvent(e);
    }
    if (!this.canAim()) this.slingshot.cancel();

    const aim = this.slingshot.current();
    this.match.snails.forEach((s, i) =>
      this.snailViews[i]?.update(s, this.layout.mask, time, {
        active: i === this.match.active && this.match.phase !== 'over',
        aim: i === this.match.active && aim ? aim.angle : null,
      }),
    );
    this.slingshot.draw(this.match.snails[this.match.active], this.match.weapon, this.shotWorld());
    this.shotView.update(this.match.projectile);
    this.follow();
    this.water.update(time);
    this.publishHud();
  }

  private canAim(): boolean {
    const snail = this.match.snails[this.match.active];
    return this.match.phase === 'aim' && snail?.alive === true && snail.grounded;
  }

  private shotWorld(): ShotWorld {
    return {
      mask: this.layout.mask,
      waterLevel: this.layout.waterLevel,
      wind: this.match.wind,
      snails: this.match.snails,
    };
  }

  private onEvent(e: MatchEvent): void {
    switch (e.kind) {
      case 'explosion':
        // Core has already carved the mask; the views catch up under the flash.
        playExplosion(this, e.crater, this.layout.mask, () => {
          this.view?.onCrater(e.crater);
          this.decor?.remove(e.removedDecor);
          this.grass?.onCrater(e.crater);
          this.updateInfo();
        });
        break;
      case 'dig':
        // A drill boring: just the cut, a crater per tick, plus a puff of soil.
        this.view?.onCrater(e.crater);
        this.decor?.remove(e.removedDecor);
        this.grass?.onCrater(e.crater);
        this.dust(e.crater.x, e.crater.y);
        break;
      case 'damage': {
        const s = this.match.snails.find((x) => x.id === e.snail);
        if (s) this.popup(s.x, s.y - SNAIL.height - 30, `-${e.amount}`);
        break;
      }
      default:
        break;
    }
  }

  /** A small soil puff where a drill bores. */
  private dust(x: number, y: number): void {
    const c = this.add
      .circle(x, y, 7, Phaser.Display.Color.HexStringToColor(tokens.colors.soil.clump).color, 0.8)
      .setDepth(26);
    this.tweens.add({
      targets: c,
      scale: 2.2,
      alpha: 0,
      duration: 380,
      onComplete: () => {
        c.destroy();
      },
    });
  }

  /** A damage number floating up from a snail. */
  private popup(x: number, y: number, label: string): void {
    const t = this.add
      .text(x, y, label, {
        fontFamily: 'Trebuchet MS, Arial, sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: tokens.colors.crater.tomatoSplat,
        stroke: tokens.colors.snail.outline,
        strokeThickness: 5,
        resolution: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(40);
    this.tweens.add({
      targets: t,
      y: y - 36,
      alpha: 0,
      delay: 500,
      duration: 900,
      onComplete: () => {
        t.destroy();
      },
    });
  }

  /** Eases the camera toward the shot in flight, or the active snail. */
  private follow(): void {
    const p = this.match.projectile;
    const snail = this.match.snails[this.match.active];
    const target = p ?? (snail?.alive ? snail : null);
    if (!target) return;
    const camera = this.cameras.main;
    const { x, y } = camera.midPoint;
    camera.centerOn(x + (target.x - x) * CAMERA_LERP, y + (target.y - y) * CAMERA_LERP);
  }

  /** Sends the HUD what it shows, when it changed. */
  private publishHud(): void {
    const m = this.match;
    const team = m.snails[m.active]?.team ?? 0;
    const ammo = m.ammo[team];
    const state: HudState = {
      teams: m.snails.map((s) => ({
        name: TEAM_NAMES[s.team] ?? `Команда ${s.team + 1}`,
        color: teamColor(s.team),
        hp: s.hp,
        maxHp: SNAIL.maxHp,
      })),
      activeTeam: team,
      seconds: m.phase === 'aim' ? Math.ceil(aimTicksLeft(m) / 60) : null,
      wind: m.wind / MAX_WIND,
      weapons: WEAPON_IDS.map((id) => ({
        id,
        count: ammo?.[id] ?? null,
        selected: id === m.weapon,
      })),
      winner: m.winner,
    };
    const json = JSON.stringify(state);
    if (json !== this.hudJson) {
      this.hudJson = json;
      this.registry.set(HUD_STATE, state);
    }
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
    const current = this.match.terrain.source;
    const at = current.kind === 'map' ? ids.indexOf(current.id) : -1;
    const next = ids[at + 1];
    return next === undefined ? { kind: 'hills', seed: 1 } : { kind: 'map', id: next };
  }

  /** Loads the terrain and starts a new match on it. */
  private loadTerrain(source: TerrainSource): void {
    this.view?.destroy();
    this.decor?.destroy();
    this.grass?.destroy();
    this.grass = null;
    this.back?.destroy();
    this.back = null;

    const lookup = mapLookup(this.maps);
    const terrain = createTerrainState(source);
    this.layout = buildTerrain(terrain, lookup);
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
      terrain.craters,
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
      this.grass = new GrassView(this, grassArt, width, height, terrain.craters).setDepth(
        GRASS_DEPTH,
      );
    }
    this.water.setLevel(this.layout.waterLevel);

    this.match = createMatch(terrain, this.layout, Math.floor(Math.random() * 2 ** 31));
    for (const v of this.snailViews) v.destroy();
    this.snailViews = this.match.snails.map((s) => new SnailView(this, s));
    this.shotView.update(null);
    this.slingshot.cancel();
    this.updateInfo();
  }

  private updateInfo(): void {
    const { source, craters } = this.match.terrain;
    const hash = checksum(this.layout.mask).toString(16).padStart(8, '0');
    const where = source.kind === 'hills' ? `hills ${source.seed}` : `map ${source.id}`;
    this.registry.set(
      DEBUG_INFO,
      `${where} · craters ${craters.length} · mask ${hash}\n` +
        'A/D: crawl · W/space: jump · drag+release: shoot · 1/2/3: weapon · R: hills · M: map',
    );
  }
}
