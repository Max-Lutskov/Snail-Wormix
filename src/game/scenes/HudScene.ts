import Phaser from 'phaser';
import type { WeaponId } from '../../core/weapons';
import { hexToInt, tokens } from '../art/tokens';
import { audio } from '../audio/audio';
import { renderSize, devicePixelRatio } from '../display';

/** Registry key MatchScene writes its debug line to. */
export const DEBUG_INFO = 'debugInfo';
/** Registry key MatchScene writes the HUD state to (a HudState). */
export const HUD_STATE = 'hudState';
/** Game events the HUD emits for MatchScene. */
export const HUD_SELECT_WEAPON = 'hud:selectWeapon';
export const HUD_RESTART = 'hud:restart';
/** Touch controls: the crawl direction held on the stick (-1, 0 or 1), and a jump. */
export const HUD_MOVE = 'hud:move';
export const HUD_JUMP = 'hud:jump';
/** Hide in the shell instead of shooting. */
export const HUD_HIDE = 'hud:hide';
/** Back to the start menu. */
export const HUD_MENU = 'hud:menu';
/** Toggle the whole-map view. */
export const HUD_OVERVIEW = 'hud:overview';

export interface HudState {
  readonly teams: readonly {
    readonly name: string;
    readonly color: string;
    readonly hp: number;
    readonly maxHp: number;
  }[];
  readonly activeTeam: number;
  /** Turn timer while aiming, whole seconds; null otherwise. */
  readonly seconds: number | null;
  /** Wind in [-1, 1]. */
  readonly wind: number;
  readonly weapons: readonly {
    readonly id: WeaponId;
    readonly count: number | null;
    readonly selected: boolean;
  }[];
  /** The shell button: usable, greyed out (hid last turn), or hidden (not aiming). */
  readonly hide: 'ready' | 'cooldown' | null;
  /** Between turns: whose turn starts (a big banner). */
  readonly banner: { readonly text: string; readonly color: string } | null;
  /** Once over: the winning team, or -1 for a draw; null while playing. */
  readonly winner: number | null;
  /** Zoomed out to the whole map. */
  readonly overview: boolean;
  /** The start menu is open: the HUD stays out of the way. */
  readonly menu: boolean;
  /** Online play; null on one device. */
  readonly online: {
    readonly room: string | null;
    readonly link: string;
    /** Our team. */
    readonly seat: number | null;
    readonly started: boolean;
    readonly peer: boolean;
    readonly error: string | null;
  } | null;
}

/** Phaser's input EventData; stopPropagation keeps a HUD tap from also aiming in the world. */
interface StoppableEvent {
  stopPropagation: () => void;
}

const H = tokens.colors.hud;
const PANEL = hexToInt(H.panel);
const ACCENT = hexToInt(H.accent);
const TRACK = hexToInt(H.hpTrack);
const OUTLINE = hexToInt(tokens.colors.snail.outline);
const FONT = 'Trebuchet MS, Arial, sans-serif';
const INSET = 16;
const CARD = { w: 230, h: 50 } as const;
const SLOT = tokens.hud.minButtonPx;
/** Thumb stick: ring and knob radii, the sideways dead zone and the push up that jumps. */
const STICK_R = 50;
/** Where a touch brings the stick: this share of the screen's width and height, bottom left. */
const STICK_AREA = { w: 0.4, h: 0.55 } as const;
const STICK_REST_ALPHA = 0.5;
const STICK_KNOB = 22;
const STICK_DEAD = 14;
const STICK_JUMP = 30;
/**
 * The HUD is laid out for ~1000x520 CSS px and scaled down on smaller screens, but not below
 * this, so 52 px buttons stay at least ~44 CSS px (a fingertip).
 */
const MIN_UI_SCALE = 0.85;
/** The debug line (map, keys) only in development or with ?debug=1. */
const SHOW_DEBUG =
  import.meta.env.DEV || new URLSearchParams(window.location.search).get('debug') === '1';

/**
 * Screen-space overlay above the world. Its camera zoom equals the render scale, so sizes
 * here are CSS pixels regardless of the world's camera zoom. Edges only (ART_SPEC.md, HUD):
 * team cards top left and right, the turn pill with timer and wind top centre, ammo slots
 * bottom left.
 */
export class HudScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[] = [];
  private images: Phaser.GameObjects.GameObject[] = [];
  private zones: Phaser.GameObjects.Zone[] = [];
  private info!: Phaser.GameObjects.Text;
  /**
   * The thumb stick (touch screens), bottom left: drag sideways to crawl, push up to jump.
   * Its graphics live outside the HUD rebuilds, so a drag isn't interrupted by them.
   */
  private stickBase!: Phaser.GameObjects.Graphics;
  private stickKnob!: Phaser.GameObjects.Graphics;
  private readonly stick = {
    /** The pointer dragging it, or -1. */
    id: -1,
    /** The centre it is pulled from: under the finger while dragged, at rest otherwise. */
    cx: 0,
    cy: 0,
    /** Where it waits (bottom left), and the screen size it may move within. */
    restX: 0,
    restY: 0,
    w: 0,
    h: 0,
    move: 0 as -1 | 0 | 1,
    /** A push up jumps once; it re-arms when the knob comes back down. */
    jumpArmed: true,
  };
  private touch = false;
  /** ?touch=1: the touch controls on, and driven by the mouse too (for testing on a PC). */
  private forceTouch = false;
  /** The banner on screen, so a rebuild during the same intro doesn't replay its entrance. */
  private bannerText: string | null = null;
  /** Shows "Скопійовано" on the copy button for a moment. */
  private copied = false;

  constructor() {
    super({ key: 'HudScene', active: true });
  }

  create(): void {
    // On-screen controls on touch devices, or with ?touch=1 to try them with a mouse.
    // Touch controls follow the input in use: shown while fingers play, gone while a mouse
    // does (a laptop with a touch screen switches as you go). The switch happens on the press,
    // in the capture phase, before Phaser hit-tests it: an interactive HUD zone would otherwise
    // swallow a mouse press meant for the slingshot.
    this.forceTouch = new URLSearchParams(window.location.search).get('touch') === '1';
    this.touch = this.forceTouch || window.matchMedia('(pointer: coarse)').matches;
    window.addEventListener(
      'pointerdown',
      (e: PointerEvent) => {
        const touch = this.forceTouch || e.pointerType !== 'mouse';
        if (touch !== this.touch) {
          this.touch = touch;
          this.layout();
        }
      },
      { capture: true },
    );
    // Two fingers: one on the stick while the other aims. Every scene hears every finger: a
    // press is routed once, by MatchScene (see owns / stickCanTake), and after that a finger
    // passing over a HUD button or the stick area must not cut off the aim it is pulling.
    this.input.manager.globalTopOnly = false;
    this.input.addPointer(2);
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.id === this.stick.id) this.dragStick(p);
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.id === this.stick.id) this.releaseStick();
    });
    this.g = this.add.graphics();
    this.stickBase = this.add.graphics().setVisible(false);
    this.stickKnob = this.add.graphics().setVisible(false);
    this.drawStick();
    this.info = this.add.text(0, 0, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#141c16',
    });
    const sync = (): void => {
      this.info.setText(String(this.registry.get(DEBUG_INFO) ?? ''));
      this.layout();
    };
    this.registry.events.on(`changedata-${DEBUG_INFO}`, sync);
    this.registry.events.on(`changedata-${HUD_STATE}`, sync);
    this.registry.events.on(`setdata`, sync);

    const fit = (): void => {
      const camera = this.cameras.main;
      const { width, height } = this.scale;
      camera.setSize(width, height);
      camera.setZoom(this.cssScale() * this.uiScale());
      camera.setOrigin(0, 0);
      this.layout();
    };
    fit();
    this.scale.on(Phaser.Scale.Events.RESIZE, fit);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, fit);
    });
  }

  private cssScale(): number {
    const parent = this.game.canvas.parentElement;
    return parent
      ? renderSize(parent.clientWidth, parent.clientHeight, devicePixelRatio()).scale
      : 1;
  }

  /** HUD units per CSS px: below 1 on small screens. */
  private uiScale(): number {
    const parent = this.game.canvas.parentElement;
    if (!parent) return 1;
    const s = Math.min(parent.clientWidth / 1000, parent.clientHeight / 520);
    return Math.max(MIN_UI_SCALE, Math.min(1, s));
  }

  private text(x: number, y: number, s: string, size: number, color = '#ffffff') {
    const t = this.add
      .text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color })
      .setResolution(2);
    this.texts.push(t);
    return t;
  }

  /** Rebuilds the HUD for the current state and screen size. */
  private layout(): void {
    this.g.clear();
    for (const o of [...this.texts, ...this.images, ...this.zones]) o.destroy();
    this.texts = [];
    this.images = [];
    this.zones = [];

    const scale = this.cssScale() * this.uiScale();
    const W = this.scale.width / scale;
    const Hh = this.scale.height / scale;
    this.info.setVisible(SHOW_DEBUG);
    this.info.setPosition(W / 2 - this.info.width / 2, Hh - 4 - this.info.height);
    const state = this.registry.get(HUD_STATE) as HudState | undefined;
    if (!state || state.menu) {
      this.placeStick(0, 0, false);
      return;
    }
    const g = this.g;

    // Team cards.
    state.teams.forEach((team, i) => {
      const x = i === 0 ? INSET : W - INSET - CARD.w;
      const y = INSET;
      g.fillStyle(PANEL, H.panelOpacity).fillRoundedRect(x, y, CARD.w, CARD.h, 12);
      if (i === state.activeTeam && state.winner === null) {
        g.lineStyle(3, ACCENT, 1).strokeRoundedRect(x, y, CARD.w, CARD.h, 12);
      }
      g.fillStyle(hexToInt(team.color), 1).fillCircle(x + 24, y + CARD.h / 2, 12);
      g.lineStyle(2, OUTLINE, 1).strokeCircle(x + 24, y + CARD.h / 2, 12);
      const mine = state.online?.started === true && state.online.seat === i;
      this.text(x + 44, y + 7, mine ? `${team.name} (ти)` : team.name, 15);
      const bw = CARD.w - 100;
      g.fillStyle(TRACK, 1).fillRoundedRect(x + 44, y + 30, bw, 10, 5);
      const share = Math.max(0, team.hp / team.maxHp);
      if (share > 0) {
        g.fillStyle(hexToInt(team.color), 1).fillRoundedRect(x + 44, y + 30, bw * share, 10, 5);
      }
      this.text(x + 52 + bw, y + 24, String(team.hp), 16);
    });

    // Turn pill: whose turn and the timer, then the wind.
    const active = state.teams[state.activeTeam];
    if (active && state.winner === null) {
      const label =
        state.seconds === null ? `Хід: ${active.name}` : `${active.name} · ${state.seconds}`;
      const t = this.text(0, INSET + 8, label, 17, tokens.colors.hud.panel);
      const pw = t.width + 36;
      g.fillStyle(ACCENT, 1).fillRoundedRect(W / 2 - pw / 2, INSET, pw, 36, 18);
      g.lineStyle(2, OUTLINE, 1).strokeRoundedRect(W / 2 - pw / 2, INSET, pw, 36, 18);
      t.setPosition(W / 2 - t.width / 2, INSET + 8);
      this.wind(W / 2, INSET + 58, state.wind);
    }

    // Ammo slots (and the shell): bottom left, or bottom right on touch screens, where the
    // stick takes the left thumb.
    const slotsW = state.weapons.length * (SLOT + 10) - 10 + (state.hide !== null ? SLOT + 14 : 0);
    const slotsX = this.touch ? W - INSET - 24 - slotsW : INSET + 24;
    // Ammo slots.
    state.weapons.forEach((w, i) => {
      const x = slotsX + i * (SLOT + 10);
      const y = Hh - INSET - 24 - SLOT;
      g.fillStyle(PANEL, H.panelOpacity).fillRoundedRect(x, y, SLOT, SLOT, 10);
      g.lineStyle(3, w.selected ? ACCENT : PANEL, 1).strokeRoundedRect(x, y, SLOT, SLOT, 10);
      const key = `ammo-${w.id}`;
      if (this.textures.exists(key)) {
        const img = this.add.image(x + SLOT / 2, y + SLOT / 2 - 3, key).setDisplaySize(32, 32);
        if (w.count === 0) img.setAlpha(0.35);
        this.images.push(img);
      }
      const count = this.text(0, y + SLOT - 18, w.count === null ? '∞' : String(w.count), 13);
      count.setPosition(x + SLOT - count.width - 5, y + SLOT - 18);
      this.text(x + 5, y + 3, String(i + 1), 11, '#ffe14d');
      const zone = this.add.zone(x, y, SLOT, SLOT).setOrigin(0, 0).setInteractive();
      zone.on(
        'pointerdown',
        (_p: Phaser.Input.Pointer, _x: number, _y: number, e: StoppableEvent) => {
          e.stopPropagation();
          this.game.events.emit(HUD_SELECT_WEAPON, w.id);
        },
      );
      this.zones.push(zone);
    });

    if (state.hide !== null) {
      this.shellButton(slotsX + state.weapons.length * (SLOT + 10) + 14, Hh, state.hide);
    }
    this.placeStick(W, Hh, this.touch && state.winner === null);
    this.overviewButton(W, state.overview);
    this.muteButton(W);
    if (state.winner !== null) this.victory(W, Hh, state);
    if (state.banner) this.banner(W, Hh, state.banner);
    else this.bannerText = null;
    const online = state.online;
    if (state.winner === null) {
      this.pillButton(INSET, INSET + CARD.h + 10, 'Меню', () => {
        this.game.events.emit(HUD_MENU);
      });
    }
    if (!online) {
      // Playing on one device: nothing more to show.
    } else if (online.error) {
      this.notice(W, Hh, online.error);
    } else if (!online.started) {
      this.lobby(W, Hh, online);
    } else if (!online.peer) {
      this.notice(W, Hh, 'Суперник відключився — чекаємо…');
    }
  }

  /** The shell slot: a spiral shell; taps hide the snail (ART_SPEC.md, "Ховається"). */
  private shellButton(x: number, Hh: number, hide: 'ready' | 'cooldown'): void {
    const g = this.g;
    const y = Hh - INSET - 24 - SLOT;
    const ready = hide === 'ready';
    g.fillStyle(PANEL, H.panelOpacity).fillRoundedRect(x, y, SLOT, SLOT, 10);
    g.lineStyle(3, ready ? ACCENT : PANEL, 1).strokeRoundedRect(x, y, SLOT, SLOT, 10);
    const cx = x + SLOT / 2;
    const cy = y + SLOT / 2 - 3;
    const C = tokens.colors.snail;
    const alpha = ready ? 1 : 0.35;
    g.fillStyle(hexToInt(C.shell), alpha).fillCircle(cx, cy, 14);
    g.lineStyle(2, OUTLINE, alpha).strokeCircle(cx, cy, 14);
    g.lineStyle(2, hexToInt(C.shellSpiral), alpha);
    g.beginPath();
    for (let a = 0; a <= Math.PI * 4.2; a += 0.2) {
      const r = 1.5 + a * 0.85;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (a === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.strokePath();
    this.text(x + 5, y + 3, 'H', 11, '#ffe14d');
    const label = this.text(0, y + SLOT - 16, 'сховатись', 10);
    label.setPosition(x + SLOT / 2 - label.width / 2, y + SLOT + 2);
    if (!ready) return;
    const zone = this.add.zone(x, y, SLOT, SLOT).setOrigin(0, 0).setInteractive();
    zone.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, _x: number, _y: number, e: StoppableEvent) => {
        e.stopPropagation();
        this.game.events.emit(HUD_HIDE);
      },
    );
    this.zones.push(zone);
  }

  /** Under the overview button: sound on and off. */
  private muteButton(W: number): void {
    const x = W - INSET - SLOT;
    const y = INSET + CARD.h + 10 + SLOT + 10;
    const muted = audio.isMuted;
    this.button(x, y, (g, cx, cy) => {
      g.fillStyle(0xffffff, 1);
      g.fillRect(cx - 11, cy - 5, 6, 10);
      g.fillTriangle(cx - 6, cy - 5, cx + 3, cy - 12, cx + 3, cy + 12);
      g.fillTriangle(cx - 6, cy + 5, cx + 3, cy - 12, cx + 3, cy + 12);
      g.lineStyle(2.5, 0xffffff, 1);
      if (muted) {
        g.lineBetween(cx + 6, cy - 6, cx + 13, cy + 6);
        g.lineBetween(cx + 13, cy - 6, cx + 6, cy + 6);
      } else {
        g.beginPath();
        g.arc(cx + 4, cy, 7, -0.8, 0.8);
        g.strokePath();
      }
    }).on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: StoppableEvent) => {
      e.stopPropagation();
      audio.setMuted(!audio.isMuted);
      this.layout();
    });
  }

  /** Top right, under the card: zoom out to the whole map and back. */
  private overviewButton(W: number, out: boolean): void {
    const x = W - INSET - SLOT;
    const y = INSET + CARD.h + 10;
    this.button(x, y, (g, cx, cy) => {
      g.lineStyle(3, 0xffffff, 1).strokeCircle(cx - 3, cy - 3, 9);
      g.lineBetween(cx + 4, cy + 4, cx + 12, cy + 12);
      g.lineBetween(cx - 8, cy - 3, cx + 2, cy - 3);
      if (!out) g.lineBetween(cx - 3, cy - 8, cx - 3, cy + 2);
    }).on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: StoppableEvent) => {
      e.stopPropagation();
      this.game.events.emit(HUD_OVERVIEW);
    });
  }

  /** Draws the stick once: a ring with ← → ↑ hints, and the knob. */
  private drawStick(): void {
    const b = this.stickBase;
    b.fillStyle(PANEL, 0.5).fillCircle(0, 0, STICK_R);
    b.lineStyle(2.5, ACCENT, 0.85).strokeCircle(0, 0, STICK_R);
    b.fillStyle(0xffffff, 0.75);
    b.fillTriangle(-STICK_R + 8, 0, -STICK_R + 18, -8, -STICK_R + 18, 8);
    b.fillTriangle(STICK_R - 8, 0, STICK_R - 18, -8, STICK_R - 18, 8);
    b.fillTriangle(0, -STICK_R + 8, -8, -STICK_R + 18, 8, -STICK_R + 18);
    const k = this.stickKnob;
    k.fillStyle(ACCENT, 1).fillCircle(0, 0, STICK_KNOB);
    k.lineStyle(2.5, OUTLINE, 1).strokeCircle(0, 0, STICK_KNOB);
  }

  /**
   * A floating stick: it waits dimmed in the bottom-left corner, and a touch in the lower left
   * of the screen brings it under the thumb, centred where the finger landed (MatchScene decides:
   * a press on the active snail aims instead).
   */
  private placeStick(W: number, Hh: number, show: boolean): void {
    this.stickBase.setVisible(show);
    this.stickKnob.setVisible(show);
    if (!show) {
      if (this.stick.id >= 0) this.releaseStick();
      return;
    }
    const s = this.stick;
    s.restX = INSET + 24 + STICK_R;
    s.restY = Hh - INSET - 24 - STICK_R;
    s.w = W;
    s.h = Hh;
    if (s.id < 0) this.restStick();
  }

  /** Whether this press landed on a HUD button: it is the HUD's, not the game's. */
  owns(p: Phaser.Input.Pointer): boolean {
    return this.input.hitTestPointer(p).length > 0;
  }

  /** Whether this press is a finger in the stick's area (a mouse there aims). */
  stickCanTake(p: Phaser.Input.Pointer): boolean {
    if (!this.stickBase.visible || this.stick.id >= 0) return false;
    if (!p.wasTouch && !this.forceTouch) return false;
    const pt = this.cameras.main.getWorldPoint(p.x, p.y);
    return pt.x < this.stick.w * STICK_AREA.w && pt.y > this.stick.h * (1 - STICK_AREA.h);
  }

  /** Brings the stick under this finger, keeping the whole ring on screen. */
  grabStick(p: Phaser.Input.Pointer): void {
    const s = this.stick;
    s.id = p.id;
    const pt = this.cameras.main.getWorldPoint(p.x, p.y);
    s.cx = Phaser.Math.Clamp(pt.x, STICK_R + 8, s.w - STICK_R - 8);
    s.cy = Phaser.Math.Clamp(pt.y, STICK_R + 8, s.h - STICK_R - 8);
    this.stickBase.setPosition(s.cx, s.cy).setAlpha(1);
    this.stickKnob.setAlpha(1);
    this.dragStick(p);
  }

  /** Back to the corner, dimmed: a hint of where the stick is. */
  private restStick(): void {
    const s = this.stick;
    s.cx = s.restX;
    s.cy = s.restY;
    this.stickBase.setPosition(s.cx, s.cy).setAlpha(STICK_REST_ALPHA);
    this.stickKnob.setPosition(s.cx, s.cy).setAlpha(STICK_REST_ALPHA);
  }

  /** Moves the knob with the finger: sideways past a dead zone crawls, up past a mark jumps. */
  private dragStick(p: Phaser.Input.Pointer): void {
    const s = this.stick;
    const pt = this.cameras.main.getWorldPoint(p.x, p.y);
    let dx = pt.x - s.cx;
    let dy = pt.y - s.cy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_R) {
      dx *= STICK_R / len;
      dy *= STICK_R / len;
    }
    this.stickKnob.setPosition(s.cx + dx, s.cy + dy);
    const move = dx > STICK_DEAD ? 1 : dx < -STICK_DEAD ? -1 : 0;
    if (move !== s.move) {
      s.move = move;
      this.game.events.emit(HUD_MOVE, move);
    }
    if (dy < -STICK_JUMP && s.jumpArmed) {
      s.jumpArmed = false;
      this.game.events.emit(HUD_JUMP);
    } else if (dy > -STICK_JUMP / 2) {
      s.jumpArmed = true;
    }
  }

  private releaseStick(): void {
    const s = this.stick;
    s.id = -1;
    s.jumpArmed = true;
    this.restStick();
    if (s.move !== 0) {
      s.move = 0;
      this.game.events.emit(HUD_MOVE, 0);
    }
  }

  /** A round 52 px button with an icon; returns its hit zone. */
  private button(
    x: number,
    y: number,
    icon: (g: Phaser.GameObjects.Graphics, cx: number, cy: number) => void,
  ): Phaser.GameObjects.Zone {
    const g = this.g;
    g.fillStyle(PANEL, H.panelOpacity).fillCircle(x + SLOT / 2, y + SLOT / 2, SLOT / 2);
    g.lineStyle(2, ACCENT, 0.9).strokeCircle(x + SLOT / 2, y + SLOT / 2, SLOT / 2 - 1);
    icon(g, x + SLOT / 2, y + SLOT / 2);
    const zone = this.add.zone(x, y, SLOT, SLOT).setOrigin(0, 0).setInteractive();
    this.zones.push(zone);
    return zone;
  }

  /** A rounded button with a label; `onTap` runs on press (without aiming in the world). */
  private pillButton(x: number, y: number, label: string, onTap: () => void, w?: number): void {
    const t = this.text(0, 0, label, 15, tokens.colors.hud.panel);
    const bw = w ?? t.width + 32;
    const bh = 38;
    this.g.fillStyle(ACCENT, 1).fillRoundedRect(x, y, bw, bh, bh / 2);
    this.g.lineStyle(2, OUTLINE, 1).strokeRoundedRect(x, y, bw, bh, bh / 2);
    t.setPosition(x + bw / 2 - t.width / 2, y + bh / 2 - t.height / 2);
    const zone = this.add.zone(x, y, bw, bh).setOrigin(0, 0).setInteractive();
    zone.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, _x: number, _y: number, e: StoppableEvent) => {
        e.stopPropagation();
        onTap();
      },
    );
    this.zones.push(zone);
  }

  /** Waiting for the friend: the room code and the link to send, with a copy button. */
  private lobby(W: number, Hh: number, online: NonNullable<HudState['online']>): void {
    const pw = Math.min(W - 2 * INSET, 520);
    const ph = 170;
    const x = W / 2 - pw / 2;
    const y = Hh / 2 - ph / 2;
    this.g.fillStyle(PANEL, 0.92).fillRoundedRect(x, y, pw, ph, 18);
    this.g.lineStyle(3, ACCENT, 1).strokeRoundedRect(x, y, pw, ph, 18);
    if (!online.room) {
      const t = this.text(0, 0, 'Підключаємось…', 20);
      t.setPosition(W / 2 - t.width / 2, Hh / 2 - t.height / 2);
      return;
    }
    const title = this.text(0, y + 18, `Кімната ${online.room}`, 22, tokens.colors.hud.accent);
    title.setPosition(W / 2 - title.width / 2, y + 18);
    const hint = this.text(0, y + 52, 'Надішли другу посилання — і грайте:', 14);
    hint.setPosition(W / 2 - hint.width / 2, y + 52);
    const link = this.text(0, y + 78, online.link, 13, '#cfe8d6');
    link.setPosition(W / 2 - Math.min(link.width, pw - 24) / 2, y + 78);
    if (link.width > pw - 24) link.setCrop(0, 0, pw - 24, link.height);
    this.pillButton(
      W / 2 - 90,
      y + ph - 54,
      this.copied ? 'Скопійовано!' : 'Копіювати посилання',
      () => {
        void navigator.clipboard.writeText(online.link).then(() => {
          this.copied = true;
          this.layout();
          this.time.delayedCall(1500, () => {
            this.copied = false;
            this.layout();
          });
        });
      },
      180,
    );
  }

  /** A one-line message in the middle of the screen. */
  private notice(W: number, Hh: number, message: string): void {
    const t = this.text(0, 0, message, 18);
    const pw = t.width + 40;
    this.g.fillStyle(PANEL, 0.92).fillRoundedRect(W / 2 - pw / 2, Hh / 2 - 26, pw, 52, 26);
    t.setPosition(W / 2 - t.width / 2, Hh / 2 - t.height / 2);
  }

  /** "Хід: Червоні" in the middle of the screen while the next turn's intro plays. */
  private banner(W: number, Hh: number, banner: NonNullable<HudState['banner']>): void {
    const t = this.add
      .text(0, 0, banner.text, {
        fontFamily: FONT,
        fontSize: '34px',
        fontStyle: 'bold',
        color: banner.color,
        stroke: tokens.colors.snail.outline,
        strokeThickness: 7,
      })
      .setResolution(2)
      .setOrigin(0.5);
    const w = t.width + 64;
    const h = 68;
    const bg = this.add.graphics();
    bg.fillStyle(PANEL, H.panelOpacity).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    bg.lineStyle(3, ACCENT, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    const box = this.add.container(W / 2, Hh * 0.3, [bg, t]);
    this.images.push(box);
    if (this.bannerText !== banner.text) {
      this.bannerText = banner.text;
      box.setScale(0.6).setAlpha(0);
      this.tweens.add({ targets: box, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
    }
  }

  /** Wind: an arrow-leaf leaning with the wind and its strength 0–10. */
  private wind(cx: number, cy: number, wind: number): void {
    const g = this.g;
    const w = 120;
    g.fillStyle(PANEL, H.panelOpacity).fillRoundedRect(cx - w / 2, cy - 14, w, 28, 14);
    const strength = Math.round(Math.abs(wind) * 10);
    if (this.textures.exists('leaf-wind')) {
      const leaf = this.add
        .image(cx - 22, cy, 'leaf-wind')
        .setDisplaySize(28, 18)
        .setFlipX(wind < 0)
        .setAngle(wind * 25);
      this.images.push(leaf);
    }
    const arrow = strength === 0 ? '·' : wind > 0 ? '→' : '←';
    const t = this.text(0, cy - 10, `${arrow} ${strength}`, 15);
    t.setPosition(cx + 2, cy - 10);
  }

  private victory(W: number, Hh: number, state: HudState): void {
    const g = this.g;
    const team = state.teams[state.winner ?? -1];
    const title = team ? `Перемога: ${team.name}!` : 'Нічия!';
    const pw = 360;
    const ph = 150;
    const x = W / 2 - pw / 2;
    const y = Hh / 2 - ph / 2;
    g.fillStyle(PANEL, 0.9).fillRoundedRect(x, y, pw, ph, 18);
    g.lineStyle(3, ACCENT, 1).strokeRoundedRect(x, y, pw, ph, 18);
    const t = this.text(0, y + 22, title, 28, team ? team.color : '#ffffff');
    t.setStroke(tokens.colors.snail.outline, 5).setPosition(W / 2 - t.width / 2, y + 22);
    const by = y + ph - 58;
    this.pillButton(
      W / 2 - 150,
      by,
      'Ще раз',
      () => {
        this.game.events.emit(HUD_RESTART);
      },
      140,
    );
    this.pillButton(
      W / 2 + 10,
      by,
      'Меню',
      () => {
        this.game.events.emit(HUD_MENU);
      },
      140,
    );
  }
}
