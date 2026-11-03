import Phaser from 'phaser';
import {
  aimTicksLeft,
  canHide,
  createMatch,
  matchChecksum,
  NO_INPUT,
  TURN,
  stepMatch,
  type MatchEvent,
  type MatchInput,
  type MatchState,
} from '../../core/match';
import {
  planMove,
  planPosition,
  planRetreat,
  type BotLevel,
  type BotMove,
  type Crawl,
} from '../../core/bot';
import { MAX_WIND, type ShotWorld } from '../../core/projectile';
import { seedRng, type RngState } from '../../core/rng';
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
import { audio } from '../audio/audio';
import { Menu, type GameMode, type MapChoice } from '../menu/Menu';
import { mapThumbnail } from '../menu/thumbs';
import { DecorView, MUSHROOM_SVG_SCALE, MUSHROOM_TEXTURE } from '../terrain/DecorView';
import { paintGardenArt, type SoilTile } from '../terrain/terrainArt';
import { paintHillsGrass } from '../terrain/grassArt';
import { GrassView } from '../terrain/GrassView';
import { TerrainView } from '../terrain/TerrainView';
import { preloadShots, ShotView } from '../snail/ShotView';
import { preloadSnail, SnailView, teamColor, type Mood } from '../snail/SnailView';
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
/**
 * After an impact the camera stays on it this long (ms) so you see the result, then eases
 * back to the snail at RETURN_LERP (gentler than the usual follow).
 */
const IMPACT_HOLD_MS = 900;
const RETURN_LERP = 0.05;
const RETURN_MS = 700;
const SOIL_TILE_KEY = 'soil-tile';
/**
 * How far past the world edges the camera may look. None: a drawn map's backdrop ends at the
 * world edge, and the water there is visible anyway.
 */
const CAMERA_MARGIN = 0;
/** Grass fringe: over the ground, under its decor (so mushrooms aren't buried). */
const GRASS_DEPTH = 0.4;
const TEAM_NAMES = ['Зелені', 'Червоні'] as const;
/** The map shown behind the menu, and the default without ?map=. */
const MENU_MAP = 'glade';
const WIND_KEY = 'leaf-wind';
const WEAPON_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR'] as const;

/**
 * Smallest on-screen size of a world px, in CSS px. Fitting the whole 720-high world on a
 * phone (~390 CSS px tall) shrinks a snail to ~24 px; below this the camera zooms in and
 * follows the action instead (the overview button shows the whole map).
 */
const MIN_CSS_PER_WORLD_PX = 0.85;

/** The bot "thinks" this long into its turn, then shows its aim for AIM ticks, then fires. */
const BOT_THINK_TICKS = 60;
const BOT_AIM_TICKS = 45;
/** The bot plays this team. */
const BOT_TEAM = 1;

/** Online: when the client is this many ticks behind the server, it catches up at once. */
const NET_CATCH_UP = 8;

/**
 * Match scene: a duel, one snail per team, taking turns. Hot-seat on one device, or online
 * by link (?room=CODE): then the server's confirmed inputs drive the match and each player
 * controls only their own team.
 * ←/→ or A/D = crawl, W/↑/space = jump, drag anywhere and release = slingshot shot,
 * 1/2/3 = weapon, Enter = new match when over, M = next map (development).
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
  /** The music mood last sent, so it's set only on changes. */
  private moodKey = '';
  /** An impact the camera lingers on: where, and until when (scene time, ms). */
  private impact: { x: number; y: number; until: number } | null = null;
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
  /** Emotions that last a moment after an event, by snail id: until when (scene time, ms). */
  private joyUntil = new Map<number, number>();
  private angryUntil = new Map<number, number>();
  /** Against the computer: its level, its RNG, and its move for the current turn. */
  private bot: {
    level: BotLevel;
    rng: RngState;
    turn: number;
    /** This turn: the crawl before shooting (planned once), and when it ends (phase ticks). */
    crawl: Crawl | null | undefined;
    crawlEnd: number;
    move: BotMove | null;
    /** When the aim swing started (phase ticks). */
    aimStart: number;
    /** The crawl away after shooting (planned once at the start of the retreat). */
    retreat: Crawl | null | undefined;
    /** The aim angle being shown while it "aims". */
    aim: number | null;
  } | null = null;
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
    this.menu = new Menu(this.mapChoices(), (mode, choice, level) => {
      this.pick(mode, choice, level);
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
        aim:
          i === this.match.active
            ? (aim?.angle ?? (this.botsTurn() ? (this.bot?.aim ?? null) : null))
            : null,
        mood: this.moodOf(i, aim !== null, time),
      }),
    );
    this.slingshot.draw(this.match.snails[this.match.active], this.match.weapon, this.shotWorld());
    this.shotView.update(this.match.projectile);
    this.follow();
    this.water.update(time);
    this.publishHud();
    this.musicMood();
    if (this.online && time - this.infoAt > 1000) {
      this.infoAt = time;
      this.updateInfo();
    }
  }

  private stepLocal(delta: number, move: MatchInput['move']): void {
    this.tickCarry = Math.min(this.tickCarry + delta, TICK_MS * MAX_TICKS_PER_FRAME);
    while (this.tickCarry >= TICK_MS) {
      this.tickCarry -= TICK_MS;
      const input: MatchInput = this.botsTurn() ? this.botInput() : { move, ...this.queued };
      this.queued = { jump: false, fire: null, weapon: null, hide: false };
      this.applyStep(input);
    }
  }

  private botsTurn(): boolean {
    return this.bot !== null && this.match.snails[this.match.active]?.team === BOT_TEAM;
  }

  /**
   * The bot's input this tick: it waits a moment, decides (core/bot), turns its cannon
   * toward the shot for a moment so you see it aim, then fires; or hides in its shell.
   */
  private botInput(): MatchInput {
    const bot = this.bot;
    const m = this.match;
    if (!bot) return NO_INPUT;
    if (bot.turn !== m.turn) {
      bot.turn = m.turn;
      bot.crawl = undefined;
      bot.move = null;
      bot.retreat = undefined;
      bot.aim = null;
    }
    if (m.phase === 'retreat') {
      // After the shot: crawl away from the enemy if that's safe.
      bot.aim = null;
      if (bot.retreat === undefined) {
        const plan = planRetreat(m, this.layout, bot.rng);
        bot.rng = plan.rng;
        bot.retreat = plan.crawl;
      }
      return bot.retreat && m.phaseTicks < bot.retreat.ticks
        ? { ...NO_INPUT, move: bot.retreat.dir }
        : NO_INPUT;
    }
    if (m.phase !== 'aim') {
      bot.aim = null;
      return NO_INPUT;
    }
    const t = m.phaseTicks;
    if (t < BOT_THINK_TICKS) return NO_INPUT;
    // First, maybe crawl to a spot with a better shot.
    if (bot.crawl === undefined) {
      const plan = planPosition(m, this.layout, bot.rng);
      bot.rng = plan.rng;
      bot.crawl = plan.crawl;
      bot.crawlEnd = t + (plan.crawl?.ticks ?? 0);
    }
    if (bot.crawl && t < bot.crawlEnd) return { ...NO_INPUT, move: bot.crawl.dir };
    const me = m.snails[m.active];
    if (!me?.grounded) return NO_INPUT;
    // Then decide the shot from where it stands now.
    if (!bot.move) {
      const plan = planMove(m, this.layout, bot.level, bot.rng);
      bot.rng = plan.rng;
      bot.move = plan.move;
      bot.aimStart = t;
      if (plan.move.kind === 'hide') return { ...NO_INPUT, hide: true };
      return { ...NO_INPUT, weapon: plan.move.weapon };
    }
    const move = bot.move;
    if (move.kind !== 'shoot') return NO_INPUT;
    const target = Math.atan2(move.aim.y, move.aim.x);
    const k = Math.min(1, (t - bot.aimStart) / BOT_AIM_TICKS);
    // Swing the cannon from its rest pose (up and forward) to the shot.
    const facing = this.match.snails[m.active]?.facing ?? 1;
    const rest = facing === 1 ? -0.95 : Math.PI + 0.95;
    bot.aim = rest + (target - rest) * (1 - (1 - k) * (1 - k));
    if (k < 1) return NO_INPUT;
    bot.aim = null;
    return { ...NO_INPUT, fire: move.aim };
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
    const before = this.match.snails[this.match.active];
    const r = stepMatch(this.match, input, this.layout);
    this.match = r.state;
    for (const e of r.events) this.onEvent(e);
    // A jump (the core has no event for it): the active snail just left the ground upward.
    const after = this.match.snails[this.match.active];
    if (before?.grounded && after && !after.grounded && after.vy < -3 && input.jump) {
      audio.jump(this.pan(after.x));
    }
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

  /** Whether the local player controls the active snail (on one device, unless it's the bot's). */
  private myTurn(): boolean {
    if (!this.online) return !this.botsTurn();
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

  /** Every drawn map with its preview. */
  private mapChoices(): MapChoice[] {
    const drawn = [...this.maps.entries()].map(([id, m]) => ({
      source: { kind: 'map', id } as const,
      name: m.data.meta.name,
      thumb: mapThumbnail(this, m.terrainKey, m.backKey),
    }));
    return drawn;
  }

  /** A choice from the menu: on one device, against the bot, or a room to invite a friend. */
  private pick(mode: GameMode, source: TerrainSource, level: BotLevel): void {
    this.overview = false;
    this.fitCamera();
    this.bot =
      mode === 'bot'
        ? {
            level,
            rng: seedRng(Math.floor(Math.random() * 2 ** 31)),
            turn: -1,
            crawl: undefined,
            crawlEnd: 0,
            move: null,
            aimStart: 0,
            retreat: undefined,
            aim: null,
          }
        : null;
    this.loadTerrain(source);
    if (mode === 'online') this.goOnline(null, source);
  }

  /** Leaves the match (and the room, online) for the start menu. */
  private openMenu(): void {
    this.online?.close();
    this.online = null;
    this.bot = null;
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

  /** Sets the adaptive music from the match: calm while aiming, tense in flight, dark when low. */
  private musicMood(): void {
    const m = this.match;
    const intensity = m.phase === 'flight' ? 1 : m.phase === 'retreat' ? 0.45 : 0;
    const danger = m.snails.some((s) => s.alive && s.hp <= 30) ? 1 : 0;
    const outcome = this.outcome();
    const key = `${this.menu.open ? 1 : 0}${intensity}${danger}${outcome ?? ''}`;
    if (key === this.moodKey) return;
    this.moodKey = key;
    audio.setMood({ intensity, danger, menu: this.menu.open, outcome });
  }

  /**
   * After the match, for the music: did the local player win? Against the bot or online, by
   * their own team; on one device somebody always wins.
   */
  private outcome(): 'win' | 'lose' | null {
    const m = this.match;
    if (m.phase !== 'over') return null;
    if (m.winner === null || m.winner < 0) return 'lose';
    if (this.online) return m.winner === this.online.seat ? 'win' : 'lose';
    if (this.bot) return m.winner === BOT_TEAM ? 'lose' : 'win';
    return 'win';
  }

  /** Stereo position of world x on screen, -1 (left edge) to 1 (right edge). */
  private pan(x: number): number {
    const v = this.cameras.main.worldView;
    return (x - v.centerX) / (v.width / 2);
  }

  /** How far off screen world x is, 0 (on screen) up to 1 (a screen width away or more). */
  private offscreen(x: number): number {
    const v = this.cameras.main.worldView;
    const out = Math.max(v.x - x, x - (v.x + v.width), 0);
    return Math.min(1, out / v.width);
  }

  private onEvent(e: MatchEvent): void {
    switch (e.kind) {
      case 'explosion':
        audio.explosion(this.pan(e.crater.x), e.crater.r, this.offscreen(e.crater.x));
        this.impact = { x: e.crater.x, y: e.crater.y, until: this.time.now + IMPACT_HOLD_MS };
        // Core has already carved the mask; the views catch up under the flash.
        playExplosion(this, e.crater, this.layout.mask, () => {
          this.view?.onCrater(e.crater);
          this.decor?.remove(e.removedDecor);
          this.grass?.onCrater(e.crater);
          this.updateInfo();
        });
        break;
      case 'dig':
        // The camera rests where the drill stops boring.
        this.impact = { x: e.crater.x, y: e.crater.y, until: this.time.now + IMPACT_HOLD_MS };
        // A drill boring: just the cut, a crater per tick, plus a puff of soil.
        audio.dig(this.pan(e.crater.x));
        this.view?.onCrater(e.crater);
        this.decor?.remove(e.removedDecor);
        this.grass?.onCrater(e.crater);
        this.dust(e.crater.x, e.crater.y);
        break;
      case 'hide': {
        const s = this.match.snails.find((x) => x.id === e.snail);
        if (s) {
          this.popup(s.x, s.y - SNAIL.height - 30, 'Сховався!', tokens.colors.hud.accent);
          audio.hide(this.pan(s.x));
        }
        break;
      }
      case 'damage': {
        const s = this.match.snails.find((x) => x.id === e.snail);
        if (s) {
          this.popup(s.x, s.y - SNAIL.height - 30, `-${e.amount}`);
          audio.ouch(this.pan(s.x), e.amount);
        }
        const now = this.time.now;
        this.snailViews[this.match.snails.findIndex((x) => x.id === e.snail)]?.hurt();
        this.angryUntil.set(e.snail, now + 4500);
        // The shooter (the snail whose turn it is) is pleased to have hit someone else.
        const shooter = this.match.snails[this.match.active];
        if (shooter && shooter.id !== e.snail) this.joyUntil.set(shooter.id, now + 2500);
        break;
      }
      case 'fire': {
        this.snailViews[this.match.snails.findIndex((x) => x.id === e.snail)]?.fired();
        const p = this.match.projectile;
        if (p) audio.shoot(this.pan(p.x), Math.min(1, Math.hypot(p.vx, p.vy) / 15));
        break;
      }
      case 'splash': {
        const sunk = this.match.snails.find((s) => !s.alive && s.y >= this.layout.waterLevel);
        audio.splash(this.pan(sunk?.x ?? this.match.projectile?.x ?? this.cameras.main.midPoint.x));
        break;
      }
      case 'turn':
        this.glideFrom = this.cameras.main.midPoint.clone();
        audio.turn();
        break;
      case 'over':
        if (this.outcome() === 'win') audio.win();
        else audio.lose();
        break;
      default:
        break;
    }
  }

  /**
   * How snail `i` feels now (the emotions sheet): winning or losing, aiming, a shot flying at
   * it (shock, or panic when low on health), pleased after a hit, angry after being hit,
   * sly while retreating after its shot, sad when low on health; calm otherwise.
   */
  private moodOf(i: number, aiming: boolean, time: number): Mood {
    const m = this.match;
    const s = m.snails[i];
    if (!s) return 'idle';
    if (m.phase === 'over') return m.winner === s.team ? 'win' : 'sad';
    if (i === m.active && aiming) return 'aim';
    const p = m.projectile;
    if (p && p.owner !== s.id && Math.hypot(p.x - s.x, p.y - (s.y - SNAIL.height / 2)) < 260) {
      return s.hp <= 35 ? 'panic' : 'shock';
    }
    if ((this.joyUntil.get(s.id) ?? 0) > time) return 'joy';
    if ((this.angryUntil.get(s.id) ?? 0) > time) return 'angry';
    if (i === m.active && m.phase === 'retreat') return 'sly';
    if (s.hp <= 30) return 'sad';
    return 'idle';
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
    // Linger on a fresh impact, then ease back more gently than the usual follow.
    const now = this.time.now;
    const impact = this.impact;
    const holding = !p && impact !== null && now < impact.until;
    const aim = holding ? impact : target;
    const returning = impact !== null && !holding && now < impact.until + RETURN_MS;
    const k = returning ? RETURN_LERP : CAMERA_LERP;
    const { x, y } = camera.midPoint;
    camera.centerOn(x + (aim.x - x) * k, y + (aim.y - y) * k);
  }

  /** Sends the HUD what it shows, when it changed. */
  private publishHud(): void {
    const m = this.match;
    const team = m.snails[m.active]?.team ?? 0;
    const ammo = m.ammo[team];
    const state: HudState = {
      teams: m.snails.map((s) => ({
        name:
          (TEAM_NAMES[s.team] ?? `Команда ${s.team + 1}`) +
          (this.bot && s.team === BOT_TEAM ? ' (бот)' : ''),
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
    const first = this.maps.has(MENU_MAP) ? MENU_MAP : [...this.maps.keys()][0];
    const pick = id !== null && this.maps.has(id) ? id : first;
    return pick === undefined ? { kind: 'hills', seed: 1 } : { kind: 'map', id: pick };
  }

  /** Cycles through the drawn maps. */
  private nextSource(): TerrainSource {
    const ids = [...this.maps.keys()];
    const current = this.match.terrain.source;
    const at = current.kind === 'map' ? ids.indexOf(current.id) : -1;
    const next = ids[at + 1];
    return { kind: 'map', id: next ?? ids[0] ?? MENU_MAP };
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
        'A/D: crawl · W/space: jump · drag+release: shoot · 1/2/3: weapon · H: hide · M: map',
    );
  }
}
