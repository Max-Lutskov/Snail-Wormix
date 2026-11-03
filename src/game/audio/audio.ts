/**
 * Sound: effects synthesized with Web Audio (our own sounds, no files, no licences) and the
 * player's own music. Effects are layered (a sharp attack, a body, a tail), vary in pitch every
 * time, pan with their place on screen, and duck the music for a moment on big hits.
 *
 * Music: the game's own, synthesized and adaptive (music.ts). Or the player picks a file on
 * their device ("Своя музика" in the menu): it is kept in the browser's own storage on that
 * device and never uploaded anywhere, so a track the player owns plays for them only, and
 * replaces the game's music.
 *
 * Browsers start audio muted until the first tap or key; unlock() runs on that gesture.
 */

import { SynthMusic, type MusicMood } from './music';

const MUTE_KEY = 'snail-artillery:muted';
const DB_NAME = 'snail-artillery';
const DB_STORE = 'music';
const MUSIC_VOLUME = 0.45;

type Wave = OscillatorType;

/** Reads/writes one blob in IndexedDB (the player's music track). */
function idb<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = (): void => {
      open.result.createObjectStore(DB_STORE);
    };
    open.onerror = (): void => {
      reject(open.error ?? new Error('indexedDB open failed'));
    };
    open.onsuccess = (): void => {
      const req = fn(open.result.transaction(DB_STORE, mode).objectStore(DB_STORE));
      req.onsuccess = (): void => {
        resolve(req.result);
      };
      req.onerror = (): void => {
        reject(req.error ?? new Error('indexedDB request failed'));
      };
    };
  });
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicGain!: GainNode;
  private noise!: AudioBuffer;
  private music: HTMLAudioElement | null = null;
  private musicNode: MediaElementAudioSourceNode | null = null;
  private synth: SynthMusic | null = null;
  private muted: boolean;
  /** Name of the player's track, if one is stored. */
  trackName: string | null = null;

  constructor() {
    let muted = false;
    try {
      muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      // Storage blocked: start unmuted.
    }
    this.muted = muted;
    void this.loadTrack();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Call on a user gesture: creates or resumes the audio context and starts the music. */
  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(ctx.destination);
      // A gentle limiter so stacked explosions don't clip.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.ratio.value = 8;
      limiter.connect(this.master);
      this.sfx = ctx.createGain();
      this.sfx.gain.value = 0.9;
      this.sfx.connect(limiter);
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = MUSIC_VOLUME;
      this.musicGain.connect(this.master);
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.synth = new SynthMusic(ctx, this.musicGain, this.noise);
    }
    void this.ctx.resume();
    this.playMusic();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Not remembered; fine.
    }
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
    if (this.music) this.music.muted = muted;
  }

  // --- Music -----------------------------------------------------------------------------------

  /** Stores the player's track on this device and plays it. */
  async setTrack(file: File): Promise<void> {
    try {
      await idb('readwrite', (s) => s.put(file, 'track'));
    } catch {
      // Not stored (private mode): it still plays this time.
    }
    this.useTrack(file, file.name);
  }

  /** Forgets the player's track and goes back to the game's own music. */
  async clearTrack(): Promise<void> {
    try {
      await idb('readwrite', (s) => s.delete('track'));
    } catch {
      // Nothing stored.
    }
    this.music?.pause();
    this.musicNode?.disconnect();
    this.musicNode = null;
    this.music = null;
    this.trackName = null;
    this.playMusic();
  }

  private async loadTrack(): Promise<void> {
    try {
      const blob = await idb<unknown>('readonly', (s) => s.get('track'));
      if (blob instanceof Blob) this.useTrack(blob, blob instanceof File ? blob.name : 'трек');
    } catch {
      // No stored track.
    }
  }

  private useTrack(blob: Blob, name: string): void {
    this.music?.pause();
    this.musicNode?.disconnect();
    this.musicNode = null;
    const el = new window.Audio(URL.createObjectURL(blob));
    el.loop = true;
    el.muted = this.muted;
    this.music = el;
    this.trackName = name;
    if (this.ctx) this.playMusic();
  }

  /** The game's adaptive music follows the match (ignored while the player's track plays). */
  setMood(mood: MusicMood): void {
    this.synth?.setMood(mood);
  }

  private playMusic(): void {
    const ctx = this.ctx;
    const el = this.music;
    if (!ctx) return;
    if (!el) {
      this.synth?.start();
      return;
    }
    this.synth?.stop();
    if (!this.musicNode) {
      this.musicNode = ctx.createMediaElementSource(el);
      this.musicNode.connect(this.musicGain);
    }
    void el.play().catch(() => undefined);
  }

  /** Dips the music for a moment under a big hit. */
  private duck(amount: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = this.musicGain.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(MUSIC_VOLUME * (1 - amount), t + 0.03);
    g.linearRampToValueAtTime(MUSIC_VOLUME, t + 0.9);
  }

  // --- Building blocks -------------------------------------------------------------------------

  /** A channel for one sound: its own gain and stereo position (pan in [-1, 1]). */
  private voice(pan: number, volume: number): { ctx: AudioContext; out: GainNode } | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const out = ctx.createGain();
    out.gain.value = volume;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(p).connect(this.sfx);
    return { ctx, out };
  }

  /** A tone gliding from f0 to f1 over `dur` with a quick attack and an exponential decay. */
  private tone(
    out: AudioNode,
    wave: Wave,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Filtered noise: `type` filter swept from f0 to f1 over `dur`. */
  private hiss(
    out: AudioNode,
    type: BiquadFilterType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    delay = 0,
    q = 0.8,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** A random factor around 1 (pitch variation, so repeats never sound identical). */
  private vary(spread = 0.08): number {
    return 1 + (Math.random() * 2 - 1) * spread;
  }

  // --- Effects ---------------------------------------------------------------------------------

  /** The slingshot lets go: a rubbery snap and a thump. */
  shoot(pan: number, power: number): void {
    const v = this.voice(pan, 0.7);
    if (!v) return;
    const k = this.vary();
    this.hiss(v.out, 'bandpass', 2400 * k, 500, 0.12, 0.6, 0, 1.5);
    this.tone(v.out, 'triangle', 320 * k, 90, 0.14, 0.5);
    this.tone(v.out, 'sine', 140 * k, 60, 0.1 + power * 0.08, 0.6);
  }

  /** A blast: a crack, a deep boom that falls, and a long rumble of soil; scales with size. */
  explosion(pan: number, radius: number, distance: number): void {
    const near = Math.max(0.35, 1 - distance);
    const v = this.voice(pan, near);
    if (!v) return;
    const big = Math.min(1.4, radius / 40);
    const k = this.vary(0.1);
    this.hiss(v.out, 'highpass', 3000, 1200, 0.07, 0.9);
    this.tone(v.out, 'sine', 150 * k, 32, 0.45 + 0.25 * big, 1.0);
    this.tone(v.out, 'square', 90 * k, 30, 0.18, 0.25);
    this.hiss(v.out, 'lowpass', 1600 * k, 120, 0.7 + 0.4 * big, 0.8, 0.01);
    // Clods of soil landing after the boom.
    for (let i = 0; i < 4; i++) {
      this.hiss(v.out, 'bandpass', 900 + Math.random() * 900, 400, 0.06, 0.25, 0.25 + i * 0.09, 2);
    }
    this.duck(0.55 * near);
  }

  /** The drill biting into the soil (called per cut; it thins itself out). */
  private lastDig = 0;
  dig(pan: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime - this.lastDig < 0.06) return;
    this.lastDig = ctx.currentTime;
    const v = this.voice(pan, 0.45);
    if (!v) return;
    this.hiss(v.out, 'bandpass', 700 * this.vary(0.2), 300, 0.07, 0.6, 0, 3);
    this.tone(v.out, 'sawtooth', 70 * this.vary(), 50, 0.05, 0.12);
  }

  /** Something falls into the water: a slap and a few bubbles. */
  splash(pan: number): void {
    const v = this.voice(pan, 0.7);
    if (!v) return;
    this.hiss(v.out, 'lowpass', 2500, 300, 0.45, 0.7);
    for (let i = 0; i < 5; i++) {
      const f = 500 + Math.random() * 700;
      this.tone(v.out, 'sine', f, f * 1.8, 0.06, 0.18, 0.12 + i * 0.07 + Math.random() * 0.04);
    }
  }

  /** A snail gets hurt: a cartoon squeak, higher and shorter for small hits. */
  ouch(pan: number, amount: number): void {
    const v = this.voice(pan, 0.6);
    if (!v) return;
    const k = this.vary(0.12);
    const f = (amount > 25 ? 620 : 760) * k;
    this.tone(v.out, 'triangle', f, f * 1.5, 0.08, 0.45);
    this.tone(v.out, 'triangle', f * 1.5, f * 0.7, 0.18, 0.45, 0.08);
  }

  /** A hop: a springy rising boing. */
  jump(pan: number): void {
    const v = this.voice(pan, 0.4);
    if (!v) return;
    const k = this.vary();
    this.tone(v.out, 'sine', 220 * k, 520 * k, 0.16, 0.5);
    this.tone(v.out, 'triangle', 440 * k, 900 * k, 0.1, 0.12);
  }

  /** Into the shell: a hollow clack. */
  hide(pan: number): void {
    const v = this.voice(pan, 0.6);
    if (!v) return;
    this.hiss(v.out, 'bandpass', 2600, 1800, 0.03, 0.6, 0, 6);
    this.tone(v.out, 'sine', 330, 180, 0.16, 0.5, 0.01);
  }

  /** A new turn: two soft notes. */
  turn(): void {
    const v = this.voice(0, 0.35);
    if (!v) return;
    this.tone(v.out, 'triangle', 660, 660, 0.18, 0.4);
    this.tone(v.out, 'triangle', 880, 880, 0.26, 0.4, 0.12);
  }

  /** Victory: a bright little fanfare. */
  win(): void {
    const v = this.voice(0, 0.5);
    if (!v) return;
    [523, 659, 784, 1047].forEach((f, i) => {
      this.tone(v.out, 'square', f, f, 0.22, 0.18, i * 0.11);
      this.tone(v.out, 'triangle', f, f, 0.3, 0.3, i * 0.11);
    });
  }

  /** Defeat: a sad falling 'wah-wah'. */
  lose(): void {
    const v = this.voice(0, 0.5);
    if (!v) return;
    [392, 370, 349, 294].forEach((f, i) => {
      const last = i === 3;
      this.tone(v.out, 'sawtooth', f, last ? f * 0.94 : f, last ? 0.7 : 0.26, 0.16, i * 0.28);
      this.tone(v.out, 'triangle', f, last ? f * 0.94 : f, last ? 0.7 : 0.26, 0.25, i * 0.28);
    });
  }

  /** Taps on buttons. */
  click(): void {
    const v = this.voice(0, 0.3);
    if (!v) return;
    this.tone(v.out, 'triangle', 900, 700, 0.05, 0.35);
  }
}

/** One audio system for the whole game. */
export const audio = new Audio();
