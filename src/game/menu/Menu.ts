/**
 * The start menu: an HTML overlay over the game (crisp text and a responsive card grid on any
 * screen). Step 1 picks the mode, step 2 the map; picking a map starts the game.
 */

import type { BotLevel } from '../../core/bot';
import type { TerrainSource } from '../../core/terrain/state';
import { audio } from '../audio/audio';
import { tokens } from '../art/tokens';

export type GameMode = 'local' | 'bot' | 'online';

export interface MapChoice {
  readonly source: TerrainSource;
  readonly name: string;
  readonly thumb: HTMLCanvasElement;
}

const H = tokens.colors.hud;

const CSS = `
.menu { position: fixed; inset: 0; z-index: 10; display: flex; align-items: center;
  justify-content: center; background: rgba(20, 28, 22, 0.55); font-family: 'Trebuchet MS', Arial,
  sans-serif; color: #fff; padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
  max(12px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); box-sizing: border-box; }
.menu[hidden] { display: none; }
.menu-panel { background: ${H.panel}; border: 3px solid ${H.accent}; border-radius: 22px;
  padding: clamp(14px, 3vh, 28px) clamp(16px, 3vw, 32px); width: min(920px, 100%);
  max-height: 100%; overflow-y: auto; box-sizing: border-box; text-align: center; }
.menu h1 { margin: 0 0 4px; font-size: clamp(26px, 6vh, 44px); color: ${H.accent};
  -webkit-text-stroke: 1.5px ${tokens.colors.snail.outline}; }
.menu h2 { margin: 0 0 clamp(10px, 2.5vh, 20px); font-size: clamp(16px, 3.4vh, 22px); font-weight: bold; }
.menu-sub { margin: 0 0 clamp(12px, 3vh, 24px); opacity: 0.8; font-size: clamp(13px, 2.6vh, 16px); }
.menu-modes { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
.menu button { font: inherit; cursor: pointer; border: 2px solid ${tokens.colors.snail.outline};
  border-radius: 18px; touch-action: manipulation; }
.menu-mode { background: ${H.accent}; color: ${H.panel}; padding: 14px 22px; min-width: 220px;
  min-height: 64px; font-size: clamp(16px, 3.4vh, 20px); font-weight: bold; text-align: left; }
.menu-resume { display: block; margin: 0 auto 14px; text-align: center; }
.menu-mode small { display: block; font-weight: normal; font-size: 13px; opacity: 0.85; margin-top: 2px; }
.menu-maps { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.menu-map { background: #22302a; color: #fff; padding: 6px 6px 8px; border-color: #3a4a3e; }
.menu-map:hover, .menu-map:focus-visible { border-color: ${H.accent}; outline: none; }
.menu-map canvas { display: block; width: 100%; aspect-ratio: 20 / 9; border-radius: 12px; }
.menu-map span { display: block; margin-top: 6px; font-weight: bold; font-size: 15px; }
.menu-levels { display: flex; gap: 8px; justify-content: center; margin: 0 0 clamp(10px, 2.5vh, 18px); }
.menu-level { background: #22302a; color: #fff; padding: 8px 16px; border-color: #3a4a3e; }
.menu-level[aria-pressed='true'] { background: ${H.accent}; color: ${H.panel}; border-color: ${tokens.colors.snail.outline}; }
.menu-extras { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;
  margin-top: clamp(12px, 3vh, 22px); }
.menu-extra { background: #22302a; color: #fff; padding: 8px 16px; border-color: #3a4a3e;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu-back { margin-top: clamp(10px, 2.5vh, 18px); background: transparent; color: #fff;
  padding: 8px 18px; border-color: #3a4a3e; }
`;

export class Menu {
  private readonly root: HTMLDivElement;

  constructor(
    private readonly maps: readonly MapChoice[],
    private readonly onPick: (mode: GameMode, source: TerrainSource, level: BotLevel) => void,
    private readonly onResume: () => void,
  ) {
    if (!document.getElementById('menu-css')) {
      const style = document.createElement('style');
      style.id = 'menu-css';
      style.textContent = CSS;
      document.head.append(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.hidden = true;
    // Taps on the menu must not reach the game canvas (slingshot, fullscreen gesture aside).
    this.root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });
    document.body.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** Whether a match is waiting behind the menu (opened mid-game): then it offers to go back. */
  private resumable = false;

  show(resumable = false): void {
    this.resumable = resumable;
    this.modes();
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  private panel(): HTMLDivElement {
    this.root.replaceChildren();
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    this.root.append(panel);
    return panel;
  }

  private modes(): void {
    const panel = this.panel();
    panel.innerHTML =
      '<h1>Snail Artillery</h1><p class="menu-sub">Равлики з гарматами, по черзі.</p>';
    if (this.resumable) {
      const resume = document.createElement('button');
      resume.className = 'menu-mode menu-resume';
      resume.innerHTML = '▶ Продовжити гру<small>повернутися в поточний матч</small>';
      resume.addEventListener('click', () => {
        audio.click();
        this.hide();
        this.onResume();
      });
      panel.append(resume);
    }
    const row = document.createElement('div');
    row.className = 'menu-modes';
    const mode = (m: GameMode, title: string, hint: string): void => {
      const b = document.createElement('button');
      b.className = 'menu-mode';
      b.innerHTML = `${title}<small>${hint}</small>`;
      b.addEventListener('click', () => {
        audio.click();
        this.mapsFor(m);
      });
      row.append(b);
    };
    mode('bot', 'Грати з ботом', 'ти проти комп’ютера');
    mode('local', 'Грати вдвох', 'на одному пристрої, по черзі');
    mode('online', 'Грати з другом', 'за посиланням, кожен на своєму');
    panel.append(row);
    panel.append(this.extras());
  }

  /** Sound on/off and the player's own music (a file from this device, never uploaded). */
  private extras(): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'menu-extras';
    const sound = document.createElement('button');
    sound.className = 'menu-extra';
    const label = (): string => (audio.isMuted ? '🔇 Звук вимкнено' : '🔊 Звук увімкнено');
    sound.textContent = label();
    sound.addEventListener('click', () => {
      audio.setMuted(!audio.isMuted);
      sound.textContent = label();
    });
    const music = document.createElement('button');
    music.className = 'menu-extra';
    const musicLabel = (): string => (audio.trackName ? `🎵 ${audio.trackName}` : '🎵 Своя музика');
    music.textContent = musicLabel();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.hidden = true;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      void audio.setTrack(file).then(() => {
        audio.unlock();
        music.textContent = musicLabel();
      });
    });
    music.addEventListener('click', () => {
      input.click();
    });
    const reset = document.createElement('button');
    reset.className = 'menu-extra';
    reset.textContent = '↺ Музика гри';
    reset.hidden = audio.trackName === null;
    reset.addEventListener('click', () => {
      void audio.clearTrack().then(() => {
        music.textContent = musicLabel();
        reset.hidden = true;
      });
    });
    input.addEventListener('change', () => {
      reset.hidden = false;
    });
    row.append(sound, music, reset, input);
    return row;
  }

  private mapsFor(mode: GameMode): void {
    const panel = this.panel();
    const title = document.createElement('h2');
    title.textContent = 'Обери мапу';
    panel.append(title);
    let level: BotLevel = 'normal';
    if (mode === 'bot') {
      // Bot difficulty: easy misses often, hard rarely.
      const row = document.createElement('div');
      row.className = 'menu-levels';
      const levels: [BotLevel, string][] = [
        ['easy', 'Легкий'],
        ['normal', 'Нормальний'],
        ['hard', 'Складний'],
      ];
      const buttons = levels.map(([id, label]) => {
        const b = document.createElement('button');
        b.className = 'menu-level';
        b.textContent = label;
        b.setAttribute('aria-pressed', String(id === level));
        b.addEventListener('click', () => {
          level = id;
          for (const [i, other] of buttons.entries()) {
            other.setAttribute('aria-pressed', String(levels[i]?.[0] === id));
          }
        });
        row.append(b);
        return b;
      });
      panel.append(row);
    }
    const grid = document.createElement('div');
    grid.className = 'menu-maps';
    for (const m of this.maps) {
      const b = document.createElement('button');
      b.className = 'menu-map';
      const name = document.createElement('span');
      name.textContent = m.name;
      b.append(m.thumb, name);
      b.addEventListener('click', () => {
        this.hide();
        this.onPick(mode, m.source, level);
      });
      grid.append(b);
    }
    panel.append(grid);
    const back = document.createElement('button');
    back.className = 'menu-back';
    back.textContent = '← Назад';
    back.addEventListener('click', () => {
      this.modes();
    });
    panel.append(back);
  }

  destroy(): void {
    this.root.remove();
  }
}
