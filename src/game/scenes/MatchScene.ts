import Phaser from 'phaser';
import {
  aimTicksLeft,
  canHide,
  createMatch,
  matchChecksum,
  TURN,
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
  type TerrainState,
} from '../../core/terrain/state';
import type { ClientInput } from '../../net/protocol';
import { WEAPON_IDS, type WeaponId } from '../../core/weapons';
import { ART_SCALE, WORLD_HEIGHT, WORLD_WIDTH } from '../../core/world';
import { tokens } from '../art/tokens';
import { createParallax, createSky } from '../env/sky';
import { Water } from '../env/Water';
import { playExplosion } from '../fx/explosion';
import { ensureFxTextures } from '../fx/fxTextures';
import { Slingshot, toVector } from '../input/Slingshot';
import { mapLookup, preloadMaps, readMaps, type LoadedMap } from '../maps/maps';
import { Online } from '../net/Online';
import { Menu, type GameMode, type MapChoice } from '../menu/Menu';
import { hillsThumbnail, mapThumbnail } from '../menu/thumbs';
import { DecorView, MUSHROOM_SVG_SCALE, MUSHROOM_TEXTURE } from '../terrain/DecorView';
import { paintGardenArt, type SoilTile } from '../terrain/terrainArt';
import { paintHillsGrass } from '../terrain/grassArt';
import { GrassView } from '../terrain/GrassView';
import { TerrainView } from '../terrain/TerrainView';
import { preloadShots, ShotView } from '../snail/ShotView';
import { preloadSnail, SnailView, teamColor } from '../snail/SnailView';
import {
  DEBUG_INFO,
  HUD_HIDE,
  HUD_MENU,
  HUD_OVERVIEW,
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
 * Smallest on-screen size of a world px, in CSS px. Fitting the whole 720-high world on a
 * phone (~390 CSS px tall) shrinks a snail to ~24 px; below this the camera zooms in and
 * follows the action instead (the overview button shows the whole map).
 */
const MIN_CSS_PER_WORLD_PX = 0.85;

/** Online: when the client is this many ticks behind the server, it catches up at once. */
const NET_CATCH_UP = 8;

/**
 * Match scene: a duel, one snail per team, taking turns. Hot-seat on one device, or online
 * by link (?room=CODE): then the server's confirmed inputs drive the match and each player
 * controls only their own team.
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
  private queued: Omit<MatchInput, 'move'> = { jump: false, fire: null, weapon: null, hide: false };
  private hudJson = '';
  /** Where the camera was when the current turn's intro began: it glides from here. */
  private glideFrom: { x: number; y: number } | null = null;
  /** Crawl direction held on the on-screen buttons. */
  private touchMove: MatchInput['move'] = 0;
  /** Online play, once started from the HUD or a ?room= link. */
  private online: Online | null = null;
  /** Online: ticks stepped so far, the crawl last sent, and a resync in flight. */
  private netTick = 0;
  private sentMove: MatchInput['move'] = 0;
  private resyncing = false;
  /** Zoomed out to show the whole map (HUD button or Z). */
  private overview = false;
  /** When the debug line last refreshed (ms), so online stats update about once a second. */
  private infoAt = 0;
  /** The start menu (mode, then map); the map behind it stays still. */
  private menu!: Menu;

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
        this.act({ fire: toVector(aim) });
      },
    );
    this.menu = new Menu(this.mapChoices(), (mode, choice) => {
      this.pick(mode, choice);
    });
    // ?room=CODE joins a friend's room at once; ?map=<id> plays it on one device (dev);
    // otherwise the menu opens over a map.
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    this.loadTerrain(this.startSource());
    if (code) this.goOnline(code, null);
    else if (!params.has('map')) this.menu.show();

    const selectWeapon = (id: WeaponId): void => {
      this.act({ weapon: id });
    };
    const restart = (): void => {
      if (this.match.phase !== 'over') return;
      if (this.online) this.online.rematch();
      else this.loadTerrain(this.match.terrain.source);
    };
    const toMenu = (): void => {
      this.openMenu();
    };
    const toggleOverview = (): void => {
      this.overview = !this.overview;
      this.fitCamera();
    };
    const touchMove = (move: MatchInput['move']): void => {
      this.touchMove = move;
    };
    const touchJump = (): void => {
      this.act({ jump: true });
    };
    const hide = (): void => {
      this.act({ hide: true });
    };
    this.game.events.on(HUD_SELECT_WEAPON, selectWeapon);
    this.game.events.on(HUD_RESTART, restart);
    this.game.events.on(HUD_MOVE, touchMove);
    this.game.events.on(HUD_JUMP, touchJump);
    this.game.events.on(HUD_HIDE, hide);
    this.game.events.on(HUD_MENU, toMenu);
    this.game.events.on(HUD_OVERVIEW, toggleOverview);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(HUD_SELECT_WEAPON, selectWeapon);
      this.game.events.off(HUD_RESTART, restart);
      this.game.events.off(HUD_MOVE, touchMove);
      this.game.events.off(HUD_JUMP, touchJump);
      this.game.events.off(HUD_HIDE, hide);
      this.game.events.off(HUD_MENU, toMenu);
      this.menu.destroy();
      this.game.events.off(HUD_OVERVIEW, toggleOverview);
      this.online?.close();
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
          this.act({ jump: true });
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
      keyboard.on('keydown-H', hide);
      keyboard.on('keydown-Z', toggleOverview);
      keyboard.on('keydown-R', () => {
        if (!this.online && !this.menu.open) {
          this.loadTerrain({ kind: 'hills', seed: Math.floor(Math.random() * 1_000_000) });
        }
      });
      keyboard.on('keydown-M', () => {
        if (!this.online && !this.menu.open) this.loadTerrain(this.nextSource());
      });
    }
  }

  override update(time: number, delta: number): void {
    const keys = ((this.keys.right.some((k) => k.isDown) ? 1 : 0) -
      (this.keys.left.some((k) => k.isDown) ? 1 : 0)) as MatchInput['move'];
    const move = keys !== 0 ? keys : this.touchMove;
    if (this.menu.open) this.tickCarry = 0;
    else if (this.online) this.stepOnline(delta, move);
    else this.stepLocal(delta, move);
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
    if (this.online && time - this.infoAt > 1000) {
      this.infoAt = time;
      this.updateInfo();
    }
  }

  private stepLocal(delta: number, move: MatchInput['move']): void {
    this.tickCarry = Math.min(this.tickCarry + delta, TICK_MS * MAX_TICKS_PER_FRAME);
    while (this.tickCarry >= TICK_MS) {
      this.tickCarry -= TICK_MS;
      const input: MatchInput = { move, ...this.queued };
      this.queued = { jump: false, fire: null, weapon: null, hide: false };
      this.applyStep(input);
    }
  }

  /**
   * Online: steps through the ticks the server has confirmed, at 60 per second, catching up
   * when far behind. Our crawl goes to the server when it changes and it is our turn.
   */
  private stepOnline(delta: number, move: MatchInput['move']): void {
    const online = this.online;
    if (!online?.started) return;
    const wanted = this.myTurn() ? move : 0;
    if (wanted !== this.sentMove) {
      online.sendInput({ move: wanted });
      this.sentMove = wanted;
    }
    this.tickCarry = Math.min(this.tickCarry + delta, TICK_MS * MAX_TICKS_PER_FRAME);
    let behind = online.upTo - this.netTick;
    while (behind > 0 && (this.tickCarry >= TICK_MS || behind > NET_CATCH_UP)) {
      this.tickCarry = Math.max(0, this.tickCarry - TICK_MS);
      this.netTick++;
      behind--;
      this.applyStep(online.inputFor(this.netTick));
      const sum = online.checksumFor(this.netTick);
      if (sum !== undefined && sum !== matchChecksum(this.match) && !this.resyncing) {
        // Drifted from the server: ask for its state and jump to it.
        this.resyncing = true;
        online.resync();
      }
    }
    if (behind === 0) this.tickCarry = Math.min(this.tickCarry, TICK_MS);
  }

  private applyStep(input: MatchInput): void {
    const team = this.match.snails[this.match.active]?.team;
    const r = stepMatch(this.match, input, this.layout);
    this.match = r.state;
    for (const e of r.events) this.onEvent(e);
    // A new turn: the held crawl belongs to nobody now.
    if (this.match.snails[this.match.active]?.team !== team) this.sentMove = 0;
  }

  /** A player action: queued for the next tick, or sent to the server online. */
  private act(input: Omit<ClientInput, 'move'>): void {
    if (!this.online) {
      this.queued = { ...this.queued, ...input };
    } else if (this.myTurn()) {
      this.online.sendInput(input);
    }
  }

  /** Whether the local player controls the active snail (always, on one device). */
  private myTurn(): boolean {
    if (!this.online) return true;
    return this.online.started && this.match.snails[this.match.active]?.team === this.online.seat;
  }

  /** Starts a match by link: joins room `code`, or creates a room on `source` to invite to. */
  private goOnline(code: string | null, source: TerrainSource | null): void {
    this.slingshot.cancel();
    this.online = new Online(code, source, {
      start: (terrain, seed) => {
        this.netTick = 0;
        this.resyncing = false;
        this.sentMove = 0;
        this.loadTerrain(terrain, seed);
      },
      state: (tick, state) => {
        this.netTick = tick;
        this.resyncing = false;
        this.sentMove = 0;
        this.showMatch(state);
      },
      changed: () => {
        this.hudJson = '';
      },
    });
  }

  /** Every drawn map with its preview, then generated hills. */
  private mapChoices(): MapChoice[] {
    const drawn = [...this.maps.entries()].map(([id, m]) => ({
      source: { kind: 'map', id } as const,
      name: m.data.meta.name,
      thumb: mapThumbnail(this, m.terrainKey, m.backKey),
    }));
    return [...drawn, { source: 'hills', name: 'Пагорби (випадкові)', thumb: hillsThumbnail(1) }];
  }

  /** A choice from the menu: a match on one device, or a room to invite a friend to. */
  private pick(mode: GameMode, choice: TerrainSource | 'hills'): void {
    const source: TerrainSource =
      choice === 'hills' ? { kind: 'hills', seed: Math.floor(Math.random() * 1_000_000) } : choice;
    this.overview = false;
    this.fitCamera();
    this.loadTerrain(source);
    if (mode === 'online') this.goOnline(null, source);
  }

  /** Leaves the match (and the room, online) for the start menu. */
  private openMenu(): void {
    this.online?.close();
    this.online = null;
    this.slingshot.cancel();
    this.hudJson = '';
    this.menu.show();
  }

  private canAim(): boolean {
    if (this.menu.open) return false;
    const snail = this.match.snails[this.match.active];
    return this.myTurn() && this.match.phase === 'aim' && snail?.alive === true && snail.grounded;
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
      case 'hide': {
        const s = this.match.snails.find((x) => x.id === e.snail);
        if (s) this.popup(s.x, s.y - SNAIL.height - 30, 'Сховався!', tokens.colors.hud.accent);
        break;
      }
      case 'damage': {
        const s = this.match.snails.find((x) => x.id === e.snail);
        if (s) this.popup(s.x, s.y - SNAIL.height - 30, `-${e.amount}`);
        break;
      }
      case 'turn':
        this.glideFrom = this.cameras.main.midPoint.clone();
        break;
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
  private popup(
    x: number,
    y: number,
    label: string,
    color: string = tokens.colors.crater.tomatoSplat,
  ): void {
    const t = this.add
      .text(x, y, label, {
        fontFamily: 'Trebuchet MS, Arial, sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color,
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

  /**
   * Eases the camera toward the shot in flight, or the active snail. During a turn's intro
   * it glides there instead, easing in and out, so the hand-over doesn't jerk.
   */
  private follow(): void {
    const p = this.match.projectile;
    const snail = this.match.snails[this.match.active];
    const target = p ?? (snail?.alive ? snail : null);
    if (!target) return;
    const camera = this.cameras.main;
    if (this.overview) return;
    if (this.match.phase === 'intro' && this.glideFrom) {
      const t = Math.min(1, this.match.phaseTicks / (TURN.introTicks * 0.85));
      const e = 0.5 - Math.cos(Math.PI * t) / 2;
      const from = this.glideFrom;
      camera.centerOn(from.x + (target.x - from.x) * e, from.y + (target.y - from.y) * e);
      return;
    }
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
      // Online, the other player's turn shows no controls of ours.
      weapons: !this.myTurn()
        ? []
        : WEAPON_IDS.map((id) => ({
            id,
            count: ammo?.[id] ?? null,
            selected: id === m.weapon,
          })),
      hide: m.phase !== 'aim' || !this.myTurn() ? null : canHide(m) ? 'ready' : 'cooldown',
      banner:
        m.phase === 'intro'
          ? {
              text: `Хід: ${TEAM_NAMES[team] ?? `Команда ${team + 1}`}`,
              color: teamColor(team),
            }
          : null,
      winner: m.winner,
      overview: this.overview,
      menu: this.menu.open,
      online: this.online
        ? {
            room: this.online.room,
            link: this.online.link,
            seat: this.online.seat,
            started: this.online.started,
            peer: this.online.peer,
            error: this.online.error,
          }
        : null,
    };
    const json = JSON.stringify(state);
    if (json !== this.hudJson) {
      this.hudJson = json;
      this.registry.set(HUD_STATE, state);
    }
  }

  /**
   * Zooms the camera: the world fills the screen (no gaps past its sides), and on small
   * screens it zooms in further so snails stay readable (MIN_CSS_PER_WORLD_PX). The overview
   * fits the whole map instead.
   */
  private readonly fitCamera = (): void => {
    const camera = this.cameras.main;
    const { width, height } = this.scale;
    const cssHeight = this.game.canvas.getBoundingClientRect().height || height;
    const perCss = height / cssHeight;
    const fitHeight = height / WORLD_HEIGHT;
    const fitWidth = width / (WORLD_WIDTH + 2 * CAMERA_MARGIN);
    const zoom = this.overview
      ? Math.min(fitHeight, fitWidth)
      : Math.max(fitHeight, fitWidth, MIN_CSS_PER_WORLD_PX * perCss);
    const center = this.overview
      ? new Phaser.Math.Vector2(WORLD_WIDTH / 2, WORLD_HEIGHT / 2)
      : camera.midPoint.clone();
    camera.setSize(width, height);
    camera.setZoom(zoom);
    if (this.overview) camera.removeBounds();
    else camera.setBounds(-CAMERA_MARGIN, 0, WORLD_WIDTH + 2 * CAMERA_MARGIN, WORLD_HEIGHT);
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

  /** Loads the terrain and starts a new match on it (with `seed`, or a random one). */
  private loadTerrain(
    source: TerrainSource,
    seed: number = Math.floor(Math.random() * 2 ** 31),
  ): void {
    const terrain = createTerrainState(source);
    this.showTerrain(terrain);
    this.showMatch(createMatch(terrain, this.layout, seed), false);
  }

  /** Shows `state`, rebuilding the terrain from its crater log unless it is already shown. */
  private showMatch(state: MatchState, rebuild = true): void {
    if (rebuild) this.showTerrain(state.terrain);
    this.match = state;
    this.glideFrom = this.cameras.main.midPoint.clone();
    for (const v of this.snailViews) v.destroy();
    this.snailViews = this.match.snails.map((s) => new SnailView(this, s));
    this.shotView.update(null);
    this.slingshot.cancel();
    this.updateInfo();
  }

  /** Builds the live terrain and its views (with any craters already in `terrain`). */
  private showTerrain(terrain: TerrainState): void {
    const { source } = terrain;
    this.view?.destroy();
    this.decor?.destroy();
    this.grass?.destroy();
    this.grass = null;
    this.back?.destroy();
    this.back = null;

    const lookup = mapLookup(this.maps);
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
  }

  /** Online diagnostics for the debug line: ping, ticks behind the server, resyncs, fps. */
  private netInfo(): string {
    const o = this.online;
    if (!o) return '';
    const ping = o.pingMs === null ? '?' : `${o.pingMs} ms`;
    const fps = Math.round(this.game.loop.actualFps);
    return ` · ping ${ping} · behind ${o.upTo - this.netTick} ticks · states ${o.states} · ${fps} fps`;
  }

  private updateInfo(): void {
    const { source, craters } = this.match.terrain;
    const hash = checksum(this.layout.mask).toString(16).padStart(8, '0');
    const where = source.kind === 'hills' ? `hills ${source.seed}` : `map ${source.id}`;
    this.registry.set(
      DEBUG_INFO,
      `${where} · craters ${craters.length} · mask ${hash}${this.netInfo()}\n` +
        'A/D: crawl · W/space: jump · drag+release: shoot · 1/2/3: weapon · H: hide · R: hills · M: map',
    );
  }
}
