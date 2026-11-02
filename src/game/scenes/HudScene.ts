import Phaser from 'phaser';
import type { WeaponId } from '../../core/weapons';
import { hexToInt, tokens } from '../art/tokens';
import { renderSize, devicePixelRatio } from '../display';

/** Registry key MatchScene writes its debug line to. */
export const DEBUG_INFO = 'debugInfo';
/** Registry key MatchScene writes the HUD state to (a HudState). */
export const HUD_STATE = 'hudState';
/** Game events the HUD emits for MatchScene. */
export const HUD_SELECT_WEAPON = 'hud:selectWeapon';
export const HUD_RESTART = 'hud:restart';
/** Touch controls: the held crawl direction (-1, 0 or 1), and a jump tap. */
export const HUD_MOVE = 'hud:move';
export const HUD_JUMP = 'hud:jump';
/** Hide in the shell instead of shooting. */
export const HUD_HIDE = 'hud:hide';

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
  /** Once over: the winning team, or -1 for a draw; null while playing. */
  readonly winner: number | null;
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
  /** Pointers holding a crawl button, by pointer id. Survives HUD rebuilds. */
  private held = new Map<number, -1 | 1>();
  private touch = false;

  constructor() {
    super({ key: 'HudScene', active: true });
  }

  create(): void {
    // On-screen controls on touch devices, or with ?touch=1 to try them with a mouse.
    this.touch =
      this.sys.game.device.input.touch ||
      new URLSearchParams(window.location.search).get('touch') === '1';
    // Two fingers: one holds a crawl button while the other aims.
    this.input.addPointer(2);
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.release(p.id);
    });
    this.g = this.add.graphics();
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
      camera.setZoom(this.cssScale());
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

    const scale = this.cssScale();
    const W = this.scale.width / scale;
    const Hh = this.scale.height / scale;
    this.info.setPosition(W / 2 - this.info.width / 2, Hh - 4 - this.info.height);
    const state = this.registry.get(HUD_STATE) as HudState | undefined;
    if (!state) return;
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
      this.text(x + 44, y + 7, team.name, 15);
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

    // Ammo slots.
    state.weapons.forEach((w, i) => {
      const x = INSET + 24 + i * (SLOT + 10);
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
      this.shellButton(INSET + 24 + state.weapons.length * (SLOT + 10) + 14, Hh, state.hide);
    }
    if (this.touch && state.winner === null) this.controls(W, Hh);
    if (state.winner !== null) this.victory(W, Hh, state);
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

  private emitMove(): void {
    const dirs = [...this.held.values()];
    const move = dirs.length === 0 ? 0 : (dirs[dirs.length - 1] ?? 0);
    this.game.events.emit(HUD_MOVE, move);
  }

  private release(pointerId: number): void {
    if (this.held.delete(pointerId)) this.emitMove();
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

  /** Crawl ←/→ (hold) bottom right, jump (tap) above them (ART_SPEC.md, HUD). */
  private controls(W: number, Hh: number): void {
    const y = Hh - INSET - 24 - SLOT;
    const right = W - INSET - 24 - SLOT;
    const left = right - SLOT - 14;
    const arrow = (dir: -1 | 1) => (g: Phaser.GameObjects.Graphics, cx: number, cy: number) => {
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(cx + dir * 11, cy, cx - dir * 7, cy - 11, cx - dir * 7, cy + 11);
    };
    for (const [x, dir] of [
      [left, -1],
      [right, 1],
    ] as const) {
      this.button(x, y, arrow(dir)).on(
        'pointerdown',
        (p: Phaser.Input.Pointer, _x: number, _y: number, e: StoppableEvent) => {
          e.stopPropagation();
          this.held.set(p.id, dir);
          this.emitMove();
        },
      );
    }
    const jump = this.button((left + right) / 2, y - SLOT - 14, (g, cx, cy) => {
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(cx, cy - 12, cx - 11, cy + 2, cx + 11, cy + 2);
      g.fillRect(cx - 4, cy + 1, 8, 10);
    });
    jump.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, _x: number, _y: number, e: StoppableEvent) => {
        e.stopPropagation();
        this.game.events.emit(HUD_JUMP);
      },
    );
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
    const bw = 170;
    const bx = W / 2 - bw / 2;
    const by = y + ph - 64;
    g.fillStyle(ACCENT, 1).fillRoundedRect(bx, by, bw, SLOT, 14);
    g.lineStyle(2, OUTLINE, 1).strokeRoundedRect(bx, by, bw, SLOT, 14);
    const b = this.text(0, by + 14, 'Ще раз', 20, tokens.colors.hud.panel);
    b.setPosition(W / 2 - b.width / 2, by + 14);
    const zone = this.add.zone(bx, by, bw, SLOT).setOrigin(0, 0).setInteractive();
    zone.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, _x: number, _y: number, e: StoppableEvent) => {
        e.stopPropagation();
        this.game.events.emit(HUD_RESTART);
      },
    );
    this.zones.push(zone);
  }
}
