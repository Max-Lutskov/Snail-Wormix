/**
 * The game's own music, synthesized live: dark electro with a bouncy bass, 112 BPM, A minor.
 * It adapts to the game: a calm pad in the menu; kick, hats and a side-chained bass while
 * aiming; claps, fast hats, a pluck and a brighter bass while a shot flies; and when someone
 * is low on health, a slow minor melody (with a dotted-eighth echo) over a pad that pumps with
 * the kick. Layers cross-fade; the melody comes in on the next bar, like a part of the song.
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

/** Bass roots per bar (MIDI) and the chord over each bar: Am, Am, F, E. */
const ROOTS = [45, 45, 41, 40] as const;
const CHORDS = [
  [57, 60, 64],
  [57, 60, 64],
  [53, 57, 60],
  [52, 56, 59],
] as const;
/**
 * The low-health melody, per bar: [step, MIDI note, length in steps]. A falling minor line
 * over Am Am F E that leans into the E chord's G sharp and resolves back to the top.
 */
const MELODY: readonly (readonly (readonly [number, number, number])[])[] = [
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
];

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
  private mood: MusicMood = { intensity: 0, danger: 0, menu: true };

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
    tone.frequency.value = 1800;
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
    fade(this.groove, mood.menu ? 0.35 : 0.85);
    fade(this.tension, mood.menu ? 0 : mood.intensity, 0.25);
    // The low-health parts come in (and go) on the next bar line, not mid-phrase.
    const bar = this.nextTime + ((16 - (this.step % 16)) % 16) * STEP;
    const onBar = (g: GainNode, v: number): void => {
      g.gain.setTargetAtTime(v, Math.max(t, bar), 0.12);
    };
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
    const menu = this.mood.menu;
    const root = ROOTS[bar] ?? 45;
    const chord = CHORDS[bar] ?? CHORDS[0];

    // Groove: four-on-the-floor kick (half time in the menu), off-beat hats, the bass.
    if (s % 4 === 0 && (!menu || s % 8 === 0)) this.kick(t);
    if (s % 4 === 2) this.hat(t, 0.18, this.groove);
    const b = BASS[s] ?? 0;
    if (b !== 0 && (!menu || s % 4 === 0)) this.bass(midi(root + (b === 2 ? 12 : 0)), t);

    // Tension adds to the same groove rather than playing a tune of its own: claps on 2 and
    // 4, sixteenth hats, and a pluck on the eighths walking up and down the chord in time
    // with the bass, all in one octave (so it never sounds like a second song).
    if (this.mood.menu || this.mood.intensity < 0.05) {
      // Silent layer: don't spend voices on it.
    } else {
      if (s === 4 || s === 12) this.clap(t);
      this.hat(t, s % 2 === 0 ? 0.09 : 0.05, this.tension);
      if (s % 2 === 0) {
        const walk: readonly number[] = [0, 1, 2, 1];
        const note = chord[walk[(s / 2) % 4] ?? 0] ?? 57;
        this.arp(midi(note), t);
      }
    }

    // Pad: the bar's chord, held (in the menu, and under the game when someone is low).
    if (s === 0 && (this.mood.menu || this.mood.danger > 0)) {
      for (const n of chord) this.padNote(midi(n - 12), t, STEP * 16);
    }
    // The low-health melody.
    if (!this.mood.menu && this.mood.danger > 0) {
      for (const [at, note, len] of MELODY[bar] ?? []) {
        if (at === s) this.lead(midi(note), t, len * STEP);
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

  private bass(freq: number, t: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 1.6);
    o.connect(g);
    sub.connect(g);
    g.connect(this.bassFilter);
    o.start(t);
    sub.start(t);
    o.stop(t + STEP * 1.8);
    sub.stop(t + STEP * 1.8);
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

  /** A melody note: soft triangle with a sine an octave up, gentle vibrato, into the echo. */
  private lead(freq: number, t: number, dur: number): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.03);
    g.gain.setValueAtTime(0.11, t + Math.max(0.05, dur - 0.12));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2600;
    f.connect(g);
    g.connect(this.melody);
    g.connect(this.echo);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5.5;
    const depth = this.ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(7, t + Math.min(0.3, dur));
    vib.connect(depth);
    for (const [wave, mult, vol] of [
      ['triangle', 1, 1],
      ['sine', 2, 0.25],
    ] as const) {
      const o = this.ctx.createOscillator();
      o.type = wave;
      o.frequency.value = freq * mult;
      depth.connect(o.detune);
      const v = this.ctx.createGain();
      v.gain.value = vol;
      o.connect(v).connect(f);
      o.start(t);
      o.stop(t + dur + 0.2);
    }
    vib.start(t);
    vib.stop(t + dur + 0.2);
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
