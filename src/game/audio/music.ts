/**
 * The game's own music, synthesized live: dark electro with a bouncy bass, 112 BPM, A minor.
 * It adapts to the game: a calm pad in the menu; kick, hats and a side-chained bass while
 * aiming; claps, fast hats, a pluck and a brighter bass while a shot flies; and when someone
 * is low on health, a slow dark synth melody (with a dotted-eighth echo) over a pad that pumps with
 * the kick. Layers cross-fade; the melody comes in on the next bar, like a part of the song.
 * When the match ends the song moves on, at a bar line, to a victory theme (the same groove in
 * the relative major, full and bright) or a defeat theme (half time, minor, a sinking line).
 *
 * Notes are scheduled a little ahead on the audio clock (the usual Web Audio look-ahead), so
 * the beat stays tight even when frames stutter.
 */

const BPM = 112;
const STEP = 60 / BPM / 4;
/** Schedule notes this far ahead (s), checking every LOOKAHEAD_MS. */
const AHEAD = 0.12;
const LOOKAHEAD_MS = 25;
const STEPS = 64; // 4 bars of 16ths

type Note = readonly [step: number, midi: number, steps: number];

/** A song section: bass roots and chords per bar, and a melody per bar. */
interface Theme {
  readonly roots: readonly number[];
  readonly chords: readonly (readonly number[])[];
  readonly melody: readonly (readonly Note[])[];
  /** The melody's voice: the dark synth lead, or a bright pluck. */
  readonly lead: 'dark' | 'bright';
}

type ThemeId = 'battle' | 'win' | 'lose';

const THEMES: Readonly<Record<ThemeId, Theme>> = {
  // The match: Am Am F E. Its melody (low health only) falls and leans into E's G sharp.
  battle: {
    roots: [45, 45, 41, 40],
    chords: [
      [57, 60, 64],
      [57, 60, 64],
      [53, 57, 60],
      [52, 56, 59],
    ],
    melody: [
      [
        [0, 76, 6],
        [6, 74, 2],
        [8, 72, 8],
      ],
      [
        [0, 69, 6],
        [6, 72, 2],
        [8, 76, 8],
      ],
      [
        [0, 77, 6],
        [6, 76, 2],
        [8, 72, 8],
      ],
      [
        [0, 71, 6],
        [6, 74, 2],
        [8, 68, 8],
      ],
    ],
    lead: 'dark',
  },
  // Victory: the same groove in the relative major, C G Am F, with a bouncing tune.
  win: {
    roots: [48, 43, 45, 41],
    chords: [
      [60, 64, 67],
      [59, 62, 67],
      [57, 60, 64],
      [57, 60, 65],
    ],
    melody: [
      [
        [0, 72, 2],
        [2, 76, 2],
        [4, 79, 4],
        [8, 76, 2],
        [10, 79, 2],
        [12, 84, 4],
      ],
      [
        [0, 83, 4],
        [4, 79, 2],
        [6, 74, 2],
        [8, 79, 8],
      ],
      [
        [0, 81, 2],
        [2, 79, 2],
        [4, 76, 4],
        [8, 72, 2],
        [10, 76, 2],
        [12, 81, 4],
      ],
      [
        [0, 77, 4],
        [4, 81, 4],
        [8, 84, 6],
        [14, 83, 2],
      ],
    ],
    lead: 'bright',
  },
  // Defeat: Am F Dm E at half time, a slow line sinking down.
  lose: {
    roots: [45, 41, 38, 40],
    chords: [
      [57, 60, 64],
      [53, 57, 60],
      [50, 53, 57],
      [52, 56, 59],
    ],
    melody: [
      [
        [0, 76, 8],
        [8, 72, 8],
      ],
      [
        [0, 77, 8],
        [8, 76, 8],
      ],
      [
        [0, 74, 8],
        [8, 69, 8],
      ],
      [
        [0, 68, 12],
        [12, 71, 4],
      ],
    ],
    lead: 'dark',
  },
};

/** Bass pattern over a bar: 0 rest, 1 root, 2 octave up. */
const BASS = [1, 0, 1, 2, 0, 1, 0, 2, 1, 0, 1, 2, 0, 2, 1, 0] as const;

const midi = (n: number): number => 440 * 2 ** ((n - 69) / 12);

export interface MusicMood {
  /** 0 calm (aiming) to 1 (a shot in flight). */
  readonly intensity: number;
  /** 0 to 1: someone is low on health. */
  readonly danger: number;
  /** The menu is open: only the pad and a soft bass. */
  readonly menu: boolean;
  /** The match is over: did the player win or lose (null while playing). */
  readonly outcome: 'win' | 'lose' | null;
}

export class SynthMusic {
  private readonly out: GainNode;
  private readonly groove: GainNode;
  private readonly tension: GainNode;
  private readonly pad: GainNode;
  /** Between the pad and its layer: pumps with the kick, like the bass. */
  private readonly padPump: GainNode;
  private readonly melody: GainNode;
  /** The melody's echo (a dotted eighth), fed back through a low-pass. */
  private readonly echo: DelayNode;
  private readonly bassFilter: BiquadFilterNode;
  /** Between the bass and the mix: dips on every kick (side-chain pumping). */
  private readonly sidechain: GainNode;
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private mood: MusicMood = { intensity: 0, danger: 0, menu: true, outcome: null };
  private theme: ThemeId = 'battle';
  /** The theme to switch to at the next bar line. */
  private pending: ThemeId | null = null;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    private readonly noise: AudioBuffer,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    const layer = (): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.out);
      return g;
    };
    this.groove = layer();
    this.tension = layer();
    this.pad = layer();
    this.padPump = ctx.createGain();
    this.padPump.connect(this.pad);
    this.melody = layer();
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = STEP * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1100;
    this.echo.connect(tone).connect(feedback).connect(this.echo);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    tone.connect(wet).connect(this.melody);
    this.bassFilter = ctx.createBiquadFilter();
    this.bassFilter.type = 'lowpass';
    this.bassFilter.Q.value = 6;
    this.bassFilter.frequency.value = 400;
    this.sidechain = ctx.createGain();
    this.bassFilter.connect(this.sidechain).connect(this.groove);
  }

  start(): void {
    if (this.timer !== null) return;
    this.out.gain.setTargetAtTime(1, this.ctx.currentTime, 0.6);
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => {
      this.schedule();
    }, LOOKAHEAD_MS);
    this.setMood(this.mood);
  }

  stop(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
  }

  /** Cross-fades the layers toward the game's current mood. */
  setMood(mood: MusicMood): void {
    this.mood = mood;
    const t = this.ctx.currentTime;
    const fade = (g: GainNode, v: number, tau = 0.4): void => {
      g.gain.setTargetAtTime(v, t, tau);
    };
    // Parts that change the song come in (and go) on the next bar line, not mid-phrase.
    const bar = this.nextTime + ((16 - (this.step % 16)) % 16) * STEP;
    const onBar = (g: GainNode, v: number): void => {
      g.gain.setTargetAtTime(v, Math.max(t, bar), 0.12);
    };
    const want: ThemeId = mood.menu ? 'battle' : (mood.outcome ?? 'battle');
    if (want !== this.theme) this.pending = want;
    if (want === 'win') {
      onBar(this.groove, 0.9);
      onBar(this.tension, 0.8);
      onBar(this.pad, 0);
      onBar(this.melody, 0.75);
      this.bassFilter.frequency.setTargetAtTime(1600, Math.max(t, bar), 0.3);
      return;
    }
    if (want === 'lose') {
      onBar(this.groove, 0.5);
      onBar(this.tension, 0);
      onBar(this.pad, 0.6);
      onBar(this.melody, 0.85);
      this.bassFilter.frequency.setTargetAtTime(300, Math.max(t, bar), 0.3);
      return;
    }
    fade(this.groove, mood.menu ? 0.35 : 0.85);
    fade(this.tension, mood.menu ? 0 : mood.intensity, 0.25);
    if (mood.menu) fade(this.pad, 0.6, 0.8);
    else onBar(this.pad, mood.danger * 0.4);
    onBar(this.melody, mood.menu ? 0 : mood.danger);
    this.bassFilter.frequency.setTargetAtTime(
      mood.menu ? 260 : 380 + mood.intensity * 1100,
      t,
      0.3,
    );
  }

  private schedule(): void {
    // A hidden tab gets few timer calls: don't pile notes up, restart the clock instead.
    if (document.hidden) {
      this.nextTime = this.ctx.currentTime + 0.1;
      return;
    }
    if (this.nextTime < this.ctx.currentTime - 0.2) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + AHEAD) {
      this.play(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % STEPS;
    }
  }

  private play(step: number, t: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    if (s === 0 && this.pending) {
      this.theme = this.pending;
      this.pending = null;
    }
    const theme = THEMES[this.theme];
    const won = this.theme === 'win';
    const lost = this.theme === 'lose';
    // Menu and defeat play the groove at half time.
    const half = this.mood.menu || lost;
    const root = theme.roots[bar] ?? 45;
    const chord = theme.chords[bar] ?? [57, 60, 64];

    // Groove: four-on-the-floor kick, off-beat hats, the bass.
    if (s % 4 === 0 && (!half || s % 8 === 0)) this.kick(t);
    if (s % 4 === 2 && !lost) this.hat(t, 0.18, this.groove);
    const b = BASS[s] ?? 0;
    if (lost) {
      if (s % 8 === 0) this.bass(midi(root), t, STEP * 7);
    } else if (b !== 0 && (!half || s % 4 === 0)) {
      this.bass(midi(root + (b === 2 ? 12 : 0)), t);
    }

    // Tension adds to the same groove rather than playing a tune of its own: claps on 2 and
    // 4, sixteenth hats, and a pluck on the eighths walking up and down the chord in time
    // with the bass, all in one octave (so it never sounds like a second song).
    if (!won && (this.mood.menu || this.mood.intensity < 0.05 || lost)) {
      // Silent layer: don't spend voices on it.
    } else {
      if (s === 4 || s === 12) this.clap(t);
      this.hat(t, s % 2 === 0 ? 0.09 : 0.05, this.tension);
      if (s % 2 === 0) {
        const walk: readonly number[] = [0, 1, 2, 1];
        const note = chord[walk[(s / 2) % 4] ?? 0] ?? 57;
        this.arp(midi(note + (won ? 12 : 0)), t);
      }
    }

    // Pad: the bar's chord, held (in the menu, on defeat, and when someone is low on health).
    if (s === 0 && !won && (this.mood.menu || lost || this.mood.danger > 0)) {
      for (const n of chord) this.padNote(midi(n - 12), t, STEP * 16);
    }
    // The melody: always after the match, during it only when someone is low on health.
    if (won || lost || (!this.mood.menu && this.mood.danger > 0)) {
      for (const [at, note, len] of theme.melody[bar] ?? []) {
        if (at !== s) continue;
        if (theme.lead === 'bright') this.pluck(midi(note), t, len * STEP);
        else this.lead(midi(note), t, len * STEP);
      }
    }
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.ctx.createGain();
    this.env(g, t, 0.9, 0.003, 0.32);
    o.connect(g).connect(this.groove);
    o.start(t);
    o.stop(t + 0.4);
    // Side-chain: the bass and the pad duck under each kick and swell back, the pumping
    // electro feel that ties them into the beat.
    for (const [g, low] of [
      [this.sidechain.gain, 0.3],
      [this.padPump.gain, 0.45],
    ] as const) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(low, t);
      g.linearRampToValueAtTime(1, t + STEP * 2.5);
    }
  }

  private hat(t: number, vol: number, out: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    this.env(g, t, vol, 0.002, 0.04);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.06);
  }

  private clap(t: number): void {
    for (let i = 0; i < 3; i++) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1500;
      f.Q.value = 1.2;
      const g = this.ctx.createGain();
      const at = t + i * 0.012;
      this.env(g, at, i === 2 ? 0.45 : 0.25, 0.002, i === 2 ? 0.14 : 0.02);
      src.connect(f).connect(g).connect(this.tension);
      src.start(at, Math.random() * 0.5);
      src.stop(at + 0.2);
    }
  }

  private bass(freq: number, t: number, len: number = STEP * 1.6): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g);
    sub.connect(g);
    g.connect(this.bassFilter);
    o.start(t);
    sub.start(t);
    o.stop(t + len + STEP * 0.2);
    sub.stop(t + len + STEP * 0.2);
  }

  private arp(freq: number, t: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    const g = this.ctx.createGain();
    this.env(g, t, 0.06, 0.004, STEP * 1.6);
    o.connect(f).connect(g).connect(this.tension);
    o.start(t);
    o.stop(t + STEP * 1.8);
  }

  /**
   * A melody note, a dark synth lead: two detuned saws an octave below the written note with a
   * square sub under them, through a resonant low-pass that opens at the start of the note
   * and closes down; only a hint of vibrato; into the echo.
   */
  private lead(freq: number, t: number, dur: number): void {
    const low = freq / 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.04);
    g.gain.setValueAtTime(0.1, t + Math.max(0.06, dur - 0.12));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 5;
    f.frequency.setValueAtTime(380, t);
    f.frequency.exponentialRampToValueAtTime(1500, t + 0.12);
    f.frequency.exponentialRampToValueAtTime(700, t + Math.max(0.2, dur));
    f.connect(g);
    g.connect(this.melody);
    g.connect(this.echo);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 4.5;
    const depth = this.ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(3, t + Math.min(0.4, dur));
    vib.connect(depth);
    for (const [wave, mult, cents, vol] of [
      ['sawtooth', 1, -9, 0.6],
      ['sawtooth', 1, 9, 0.6],
      ['square', 0.5, 0, 0.35],
    ] as const) {
      const o = this.ctx.createOscillator();
      o.type = wave;
      o.frequency.value = low * mult;
      o.detune.value = cents;
      depth.connect(o.detune);
      const v = this.ctx.createGain();
      v.gain.value = vol;
      o.connect(v).connect(f);
      o.start(t);
      o.stop(t + dur + 0.25);
    }
    vib.start(t);
    vib.stop(t + dur + 0.25);
  }

  /** A bright melody note for the victory theme: a plucky square with a saw an octave up. */
  private pluck(freq: number, t: number, dur: number): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.03, t + Math.min(0.25, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3400;
    f.connect(g);
    g.connect(this.melody);
    g.connect(this.echo);
    for (const [wave, mult, vol] of [
      ['square', 1, 0.7],
      ['sawtooth', 2, 0.25],
    ] as const) {
      const o = this.ctx.createOscillator();
      o.type = wave;
      o.frequency.value = freq * mult;
      const v = this.ctx.createGain();
      v.gain.value = vol;
      o.connect(v).connect(f);
      o.start(t);
      o.stop(t + dur + 0.15);
    }
  }

  private padNote(freq: number, t: number, dur: number): void {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.5);
    g.gain.setValueAtTime(0.06, t + dur - 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(this.padPump);
    for (const cents of [-8, 8]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
}
