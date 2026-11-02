import Phaser from 'phaser';
import { SNAIL, type Snail } from '../../core/snail/snail';
import { isSolid, type TerrainMask } from '../../core/terrain/mask';
import { hexToInt, tokens } from '../art/tokens';

/** SVG parts from public/art/snail (see ART_SPEC.md, "Частини для анімації"). */
const PARTS = ['foot', 'shell', 'helmet', 'cannon', 'eyestalk', 'pupil'] as const;
type Part = (typeof PARTS)[number];
const key = (part: Part): string => `snail-${part}`;
/** Parts are rasterized this many times larger than drawn, so they stay sharp when zoomed. */
const SVG_SCALE = 4;
/** Snail-space units (the SVGs' own) to world px: the art is ~56 units tall, ~45 px in game. */
const ART_TO_WORLD = 0.8;
/** The art's body is centred about 5 units right of its origin; centre it on the hitbox. */
const ART_CENTER_X = 5;
/** Snail-space mounts (ART_SPEC.md / tokens.snail). */
const T = tokens.snail;
const C = tokens.colors;
const BODY_ORIGIN = T.partsOrigin;
const CANNON_REST_DEG = -55;
const TILT_MAX = 0.35;
const TILT_REACH = 8;
const DEPTH = 1;
const LABEL_DEPTH = 15;
/** HP label and turn marker heights above the feet, world px. */
const LABEL_Y = 58;
const MARKER_Y = 84;
/** The eye sits this far up the eyestalk (eyestalk.svg), with this radius. */
const EYE_UP = 15;
const EYE_R = 4.8;
/** How far the helmet comes down over the eyes while hiding, snail-space units. */
const HIDE_HELMET_DROP = 6;
/** Durations of the one-off poses, ms. */
const SHOT_MS = 500;
const HIT_MS = 1600;
const BODY = hexToInt(C.snail.body);
const OUTLINE = hexToInt(C.snail.outline);
const ACCENT = hexToInt(C.hud.accent);
const MOUTH = 0x6b2b1e;

export const TEAM_COLORS = [C.teams.green.helmet, C.teams.red.helmet] as const;

export function teamColor(team: number): string {
  return TEAM_COLORS[team % TEAM_COLORS.length] ?? TEAM_COLORS[0];
}

/**
 * How the snail feels (ART_SPEC.md, "Пози" and the emotions sheet): mostly carried by the
 * eyestalks, so it reads even at 45 px. The scene picks it from the match; the one-off poses
 * (shot, hit) and hiding come from fired(), hurt() and the snail's shell.
 */
export type Mood = 'idle' | 'aim' | 'joy' | 'angry' | 'sad' | 'shock' | 'sly' | 'panic' | 'win';

export interface SnailViewState {
  /** The snail whose turn it is: shows the marker. */
  readonly active: boolean;
  /** Aim being pulled (radians, screen coords): turns the snail and its cannon. */
  readonly aim: number | null;
  readonly mood: Mood;
}

/** A face: both eyestalks (back, front) and what is drawn on the eyes and mouth. */
interface Pose {
  /** Eyestalk angles, degrees from straight up (clockwise = forward). */
  readonly stalks: readonly [number, number];
  /** Eyestalk length (1 = as drawn). */
  readonly len: number;
  readonly pupil: number;
  /** Where the pupils look, units from the eye centre. */
  readonly look: { readonly x: number; readonly y: number };
  /** Eyelids, 0 open to 1 closed, per eye. */
  readonly lids: readonly [number, number];
  readonly eyes: 'normal' | 'spiral' | 'happy';
  readonly brows: boolean;
  readonly tear: boolean;
  readonly sweat: boolean;
  readonly mouth: 'smile' | 'o' | 'tongue' | 'frown' | 'grin';
}

const BASE: Pose = {
  stalks: [-12, 17],
  len: 1,
  pupil: 1,
  look: { x: 1.4, y: 0 },
  lids: [0, 0],
  eyes: 'normal',
  brows: false,
  tear: false,
  sweat: false,
  mouth: 'smile',
};

/** The emotions sheet: radість, злість, сум, шок, хитрість, паніка; plus the poses. */
const POSES: Readonly<Record<Exclude<Mood, 'idle' | 'aim'> | 'shot' | 'hit', Partial<Pose>>> = {
  joy: { stalks: [-32, 38], len: 1.12, look: { x: 1, y: -1 }, mouth: 'grin' },
  angry: { stalks: [8, 12], pupil: 0.75, look: { x: 1.5, y: 0.6 }, brows: true, mouth: 'frown' },
  sad: { stalks: [-55, 62], len: 0.95, look: { x: 0.5, y: 1.5 }, tear: true, mouth: 'frown' },
  shock: { stalks: [-6, 9], len: 1.3, pupil: 0.55, look: { x: 0, y: 0 }, mouth: 'o' },
  sly: { stalks: [-18, 8], lids: [0.55, 0.55], look: { x: 1.7, y: 0.3 } },
  // Crossed far enough that the eyes swap sides without merging.
  panic: { stalks: [34, -30], len: 1.15, pupil: 0.55, sweat: true, mouth: 'o' },
  win: { stalks: [-25, 30], len: 1.15, eyes: 'happy', mouth: 'grin' },
  shot: { stalks: [55, 66], len: 1.1, pupil: 0.8, look: { x: 1.5, y: 0 }, mouth: 'o' },
  hit: { stalks: [-38, 46], len: 0.9, eyes: 'spiral', mouth: 'frown' },
};

export function preloadSnail(scene: Phaser.Scene): void {
  for (const part of PARTS) {
    scene.load.svg(key(part), `art/snail/snail-${part}.svg`, { scale: SVG_SCALE });
  }
}

/** Two worried eyes just under the pulled-down helmet's brim (snail space). */
function drawHideEyes(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  for (const x of [23, 31]) {
    g.fillStyle(0xffffff, 1).fillCircle(x, -21.5, 3.6);
    g.lineStyle(1.3, OUTLINE, 1).strokeCircle(x, -21.5, 3.6);
    // Pupils glance up, toward the danger.
    g.fillStyle(0x111111, 1).fillCircle(x + 0.4, -22.6, 1.6);
  }
  return g;
}

function drop(g: Phaser.GameObjects.Graphics, x: number, y: number, s = 1): void {
  g.fillStyle(hexToInt(C.dew.fill), 1);
  g.lineStyle(1.2, hexToInt(C.dew.outline), 1);
  g.beginPath();
  g.moveTo(x, y - 5 * s);
  g.lineTo(x - 2.4 * s, y - 0.5 * s);
  g.arc(x, y, 2.5 * s, Math.PI * 0.95, Math.PI * 0.05, true);
  g.closePath();
  g.fillPath();
  g.strokePath();
}

/** Shiver marks on both sides (snail space). */
function shivers(g: Phaser.GameObjects.Graphics): void {
  g.lineStyle(1.8, OUTLINE, 1);
  for (const [cx, cy, dir] of [
    [-24, -30, -1],
    [-27, -21, -1],
    [43, -24, 1],
    [45, -15, 1],
  ] as const) {
    g.beginPath();
    g.arc(cx - dir * 4, cy, 4, -0.7 + (dir < 0 ? Math.PI : 0), 0.7 + (dir < 0 ? Math.PI : 0));
    g.strokePath();
  }
}

function star(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, turn: number): void {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 10; i++) {
    const a = turn + (i * Math.PI) / 5 - Math.PI / 2;
    const k = i % 2 === 0 ? r : r * 0.45;
    pts.push(new Phaser.Math.Vector2(x + Math.cos(a) * k, y + Math.sin(a) * k));
  }
  g.fillStyle(ACCENT, 1).fillPoints(pts, true);
  g.lineStyle(1.2, OUTLINE, 1).strokePoints(pts, true);
}

/** Covers the top `f` (0..1) of an eye with an eyelid in the body colour. */
function lid(g: Phaser.GameObjects.Graphics, cx: number, cy: number, f: number): void {
  if (f <= 0.02) return;
  const r = EYE_R;
  const y0 = cy - r + 2 * r * Math.min(1, f);
  const a0 = Math.asin(Math.max(-1, Math.min(1, (y0 - cy) / r)));
  const pts: Phaser.Math.Vector2[] = [];
  for (let a = a0; a >= -Math.PI - a0 - 1e-6; a -= 0.2) {
    pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  pts.push(
    new Phaser.Math.Vector2(cx + Math.cos(-Math.PI - a0) * r, cy + Math.sin(-Math.PI - a0) * r),
  );
  g.fillStyle(BODY, 1).fillPoints(pts, true);
  g.lineStyle(1.5, OUTLINE, 1).strokeCircle(cx, cy, r);
  const half = Math.sqrt(Math.max(0, r * r - (y0 - cy) ** 2));
  g.lineStyle(1.6, OUTLINE, 1).lineBetween(cx - half, y0, cx + half, y0);
}

/** One snail assembled from its parts, following a core Snail. */
export class SnailView {
  /** Positioned at the feet; flipped by facing; tilted with the ground. */
  readonly root: Phaser.GameObjects.Container;
  private readonly art: Phaser.GameObjects.Container;
  private readonly foot: Phaser.GameObjects.Image;
  private readonly cannon: Phaser.GameObjects.Image;
  private readonly helmet: Phaser.GameObjects.Image;
  private readonly stalks: Phaser.GameObjects.Image[];
  private readonly pupils: Phaser.GameObjects.Image[];
  private readonly hpText: Phaser.GameObjects.Text;
  private readonly marker: Phaser.GameObjects.Graphics;
  /** Hiding: eyes peeking under the helmet. */
  private readonly hideEyes: Phaser.GameObjects.Graphics;
  /** Redrawn every frame on top: eyelids, eye shapes, brows, mouth, tears, stars, flag. */
  private readonly face: Phaser.GameObjects.Graphics;
  private walkPhase = 0;
  private lastX: number;
  private tilt = 0;
  private shotUntil = 0;
  private hitUntil = 0;
  private won = false;
  /** Offsets the blinking so two snails don't blink together. */
  private readonly blinkPhase: number;

  constructor(
    private readonly scene: Phaser.Scene,
    snail: Snail,
  ) {
    const img = (part: Part, x = 0, y = 0): Phaser.GameObjects.Image =>
      scene.add.image(x, y, key(part)).setScale(1 / SVG_SCALE);
    this.cannon = img('cannon', T.cannonMount.x, T.cannonMount.y).setOrigin(0, 0.5);
    this.cannon.setAngle(CANNON_REST_DEG);
    this.foot = img('foot').setOrigin(BODY_ORIGIN.x, BODY_ORIGIN.y);
    const shell = img('shell').setOrigin(BODY_ORIGIN.x, BODY_ORIGIN.y);
    this.stalks = T.eyestalkMounts.map((m) =>
      img('eyestalk', m.x, m.y).setOrigin(0.5, 0.913).setAngle(m.restAngleDeg),
    );
    this.helmet = img('helmet')
      .setOrigin(BODY_ORIGIN.x, BODY_ORIGIN.y)
      .setTint(hexToInt(teamColor(snail.team)));
    this.pupils = T.eyestalkMounts.map(() => img('pupil'));
    this.hideEyes = drawHideEyes(scene).setVisible(false);
    this.face = scene.add.graphics();
    this.art = scene.add.container(-ART_CENTER_X * ART_TO_WORLD, 0, [
      this.cannon,
      this.foot,
      shell,
      ...this.stalks,
      ...this.pupils,
      this.hideEyes,
      this.helmet,
      this.face,
    ]);
    this.art.setScale(ART_TO_WORLD);
    this.root = scene.add.container(snail.x, snail.y, [this.art]).setDepth(DEPTH);
    this.lastX = snail.x;
    this.blinkPhase = snail.id * 1700;

    this.hpText = scene.add
      .text(snail.x, snail.y - LABEL_Y, String(snail.hp), {
        fontFamily: 'Trebuchet MS, Arial, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: teamColor(snail.team),
        stroke: C.snail.outline,
        strokeThickness: 4,
        resolution: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH);
    // Turn marker (ART_SPEC.md, HUD): a yellow triangle pointing down, thick outline.
    this.marker = scene.add.graphics().setDepth(LABEL_DEPTH);
    this.marker.fillStyle(ACCENT, 1);
    this.marker.lineStyle(2.5, OUTLINE, 1);
    this.marker.fillTriangle(-8, -10, 8, -10, 0, 2);
    this.marker.strokeTriangle(-8, -10, 8, -10, 0, 2);
  }

  /** The shot pose: recoil, eyestalks blown forward, mouth "O". */
  fired(): void {
    this.shotUntil = this.scene.time.now + SHOT_MS;
  }

  /** The hit pose: helmet askew, spiral eyes, soot, stars, a bent cannon. */
  hurt(): void {
    this.hitUntil = this.scene.time.now + HIT_MS;
  }

  /** Moves the view to the snail's state; `time` in ms drives idle motion. */
  update(snail: Snail, mask: TerrainMask, time: number, view: SnailViewState): void {
    const facing = view.aim === null ? snail.facing : Math.cos(view.aim) >= 0 ? 1 : -1;
    this.root.setPosition(snail.x, snail.y);
    this.root.setScale(facing, 1);
    this.root.setAlpha(snail.alive ? 1 : Math.max(0, this.root.alpha - 0.03));
    this.hpText.setPosition(snail.x, snail.y - LABEL_Y).setText(String(snail.hp));
    this.hpText.setAlpha(this.root.alpha);
    this.marker.setVisible(view.active && snail.alive);
    this.marker.setPosition(snail.x, snail.y - MARKER_Y + Math.sin(time / 180) * 3);

    const moved = Math.abs(snail.x - this.lastX);
    this.lastX = snail.x;
    const walking = snail.grounded && moved > 0.01;
    if (walking) this.walkPhase += moved * 0.35;

    // Squash and stretch along the crawl; a stretch while flying.
    const squash = walking ? Math.sin(this.walkPhase) * 0.05 : 0;
    const stretch = snail.grounded ? 0 : Math.min(0.12, Math.abs(snail.vy) * 0.02);
    this.foot.setScale((1 + squash) / SVG_SCALE, (1 - squash + stretch) / SVG_SCALE);

    // Rotation is applied after the facing flip, so the world slope angle works for both sides.
    const targetTilt = snail.grounded ? this.groundTilt(snail, mask) : 0;
    this.tilt += (targetTilt - this.tilt) * 0.2;
    this.root.setRotation(this.tilt);

    const hid = snail.shell && snail.alive;
    const hit = time < this.hitUntil && snail.alive;
    const shot = time < this.shotUntil;
    const win = view.mood === 'win';
    if (win && !this.won) this.confetti(snail);
    this.won = win;

    // The cannon follows the aim (the root is flipped, then tilted, so undo both); a hit bends
    // it down.
    const local =
      view.aim !== null
        ? facing === 1
          ? view.aim - this.tilt
          : Math.PI - view.aim + this.tilt
        : hit
          ? Phaser.Math.DegToRad(25)
          : Phaser.Math.DegToRad(CANNON_REST_DEG);
    this.cannon.setRotation(local);
    this.cannon.setScale((hit ? 0.85 : 1) / SVG_SCALE, 1 / SVG_SCALE);

    // Body offsets: shiver while hiding or panicking, recoil on a shot.
    const shiver = hid || view.mood === 'panic' ? Math.sin(time / 28) * 0.7 : 0;
    const recoil = shot ? -5 * ((this.shotUntil - time) / SHOT_MS) : 0;
    this.art.x = -ART_CENTER_X * ART_TO_WORLD + shiver + recoil;

    // Helmet: pulled down while hiding, knocked askew by a hit (about its pivot).
    this.helmet.y = hid ? HIDE_HELMET_DROP : 0;
    this.helmet.x = 0;
    this.helmet.setRotation(0);
    if (hit && !hid) {
      const r = -0.45;
      const { x: px, y: py } = T.helmetPivot;
      this.helmet.setRotation(r);
      this.helmet.x = px - (px * Math.cos(r) - py * Math.sin(r));
      this.helmet.y = py - (px * Math.sin(r) + py * Math.cos(r));
    }
    this.hideEyes.setVisible(hid);

    const pose = this.pose(view, time, walking, snail.grounded, hit, shot);
    this.drawFace(pose, time, { hid, hit, win });
  }

  /** The face for this frame: the mood's pose, with the one-off poses on top. */
  private pose(
    view: SnailViewState,
    time: number,
    walking: boolean,
    grounded: boolean,
    hit: boolean,
    shot: boolean,
  ): Pose {
    if (hit) return { ...BASE, ...POSES.hit };
    if (shot) return { ...BASE, ...POSES.shot };
    const sway = Math.sin(time / 600) * 4;
    const bob = walking ? Math.sin(this.walkPhase * 2) * 6 : 0;
    const air = grounded ? 0 : 14;
    const blink = (time + this.blinkPhase) % 3600 < 120 ? 1 : 0;
    const moved = (p: Pose): Pose => ({
      ...p,
      stalks: [p.stalks[0] + sway + bob - air, p.stalks[1] - sway * 0.8 + bob + air],
    });
    switch (view.mood) {
      case 'idle':
        return moved({ ...BASE, lids: [blink, blink] });
      case 'aim': {
        // The eyestalks reach along the barrel; the front eye squints; tongue out.
        const local = view.aim ?? 0;
        const forward = Math.cos(local) >= 0 ? local : Math.PI - local;
        const d = Phaser.Math.Clamp(Phaser.Math.RadToDeg(forward) + 90, -20, 75);
        return {
          ...BASE,
          stalks: [d - 6, d + 4],
          len: 1.08,
          lids: [0, 0.55],
          look: { x: Math.cos(forward) * 1.5, y: Math.sin(forward) * 1.5 },
          mouth: 'tongue',
        };
      }
      case 'sly':
        return moved({
          ...BASE,
          ...POSES.sly,
          lids: [Math.max(0.55, blink), Math.max(0.55, blink)],
        });
      default:
        return moved({ ...BASE, ...POSES[view.mood] });
    }
  }

  private drawFace(
    pose: Pose,
    time: number,
    flags: { hid: boolean; hit: boolean; win: boolean },
  ): void {
    const g = this.face.clear();
    if (flags.hid) {
      drop(g, 41, -33);
      shivers(g);
      g.setAlpha(0.6 + 0.4 * Math.abs(Math.sin(time / 120)));
    } else {
      g.setAlpha(1);
    }

    T.eyestalkMounts.forEach((m, i) => {
      const stalk = this.stalks[i];
      const pupil = this.pupils[i];
      if (!stalk || !pupil) return;
      stalk.setVisible(!flags.hid);
      pupil.setVisible(!flags.hid && pose.eyes === 'normal');
      if (flags.hid) return;
      const angle = pose.stalks[i] ?? 0;
      stalk.setAngle(angle).setScale(1 / SVG_SCALE, pose.len / SVG_SCALE);
      const a = Phaser.Math.DegToRad(angle);
      const cx = m.x + Math.sin(a) * EYE_UP * pose.len;
      const cy = m.y - Math.cos(a) * EYE_UP * pose.len;
      pupil.setPosition(cx + pose.look.x, cy + pose.look.y).setScale(pose.pupil / SVG_SCALE);
      if (pose.eyes === 'spiral') {
        g.lineStyle(1.3, OUTLINE, 1).beginPath();
        for (let t = 0; t <= Math.PI * 4; t += 0.3) {
          const r = 0.3 + t * 0.3;
          const px = cx + Math.cos(t + time / 90) * r;
          const py = cy + Math.sin(t + time / 90) * r;
          if (t === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.strokePath();
      } else if (pose.eyes === 'happy') {
        g.fillStyle(BODY, 1).fillCircle(cx, cy, EYE_R);
        g.lineStyle(1.5, OUTLINE, 1).strokeCircle(cx, cy, EYE_R);
        g.lineStyle(2, OUTLINE, 1).beginPath();
        g.arc(cx, cy + 1.5, 2.6, Math.PI * 1.1, Math.PI * 1.9);
        g.strokePath();
      }
      lid(g, cx, cy, pose.lids[i] ?? 0);
      if (pose.brows) {
        // Angry: brows slanting down toward each other.
        const inner = i === 0 ? 1 : -1;
        g.lineStyle(2.2, OUTLINE, 1);
        g.lineBetween(cx - 4 * inner, cy - 8.5, cx + 3.5 * inner, cy - 5.5);
      }
      if (pose.tear && i === 1) drop(g, cx + 1, cy + 8, 0.8);
    });

    if (pose.sweat) {
      drop(g, 40, -31, 0.9);
      drop(g, 44, -22, 0.7);
    }
    this.mouth(g, pose.mouth);

    if (flags.hit) {
      // Soot on the shell and body, and stars circling the head.
      g.fillStyle(0x1a120c, 0.35);
      g.fillCircle(-9, -28, 4.5).fillCircle(2, -17, 3.4).fillCircle(20, -11, 3);
      for (let k = 0; k < 3; k++) {
        const a = time / 260 + (k * Math.PI * 2) / 3;
        star(g, 27 + Math.cos(a) * 14, -56 + Math.sin(a) * 4, 3.4, a);
      }
    }
    if (flags.win) {
      // A flag on the cannon's muzzle.
      const r = this.cannon.rotation;
      const tx = T.cannonMount.x + Math.cos(r) * 26;
      const ty = T.cannonMount.y + Math.sin(r) * 26;
      g.lineStyle(1.8, OUTLINE, 1).lineBetween(tx, ty, tx, ty - 18);
      const wave = Math.sin(time / 150) * 1.5;
      g.fillStyle(ACCENT, 1).fillTriangle(tx, ty - 18, tx + 13, ty - 14 + wave, tx, ty - 10);
      g.lineStyle(1.3, OUTLINE, 1).strokeTriangle(
        tx,
        ty - 18,
        tx + 13,
        ty - 14 + wave,
        tx,
        ty - 10,
      );
    }
  }

  /** Redraws the mouth over the smile in the body art (snail space, around (31.5, -17)). */
  private mouth(g: Phaser.GameObjects.Graphics, mouth: Pose['mouth']): void {
    if (mouth === 'smile') return;
    if (mouth === 'tongue') {
      g.fillStyle(hexToInt(C.snail.tongue), 1).fillEllipse(34.2, -15.4, 3.2, 2.6);
      g.lineStyle(1.1, OUTLINE, 1).strokeEllipse(34.2, -15.4, 3.2, 2.6);
      return;
    }
    g.fillStyle(BODY, 1).fillEllipse(31.3, -17.2, 7.4, 4.4);
    g.lineStyle(1.6, OUTLINE, 1);
    if (mouth === 'o') {
      g.fillStyle(MOUTH, 1).fillEllipse(31.5, -16.6, 4, 5.2);
      g.strokeEllipse(31.5, -16.6, 4, 5.2);
    } else if (mouth === 'frown') {
      g.beginPath();
      g.moveTo(28, -15.2);
      g.lineTo(29.8, -16.9);
      g.lineTo(31.5, -17.4);
      g.lineTo(33.2, -16.9);
      g.lineTo(35, -15.2);
      g.strokePath();
    } else {
      const pts = [
        [27.8, -18.6],
        [29.6, -15.4],
        [31.5, -14.4],
        [33.4, -15.4],
        [35.2, -18.6],
      ].map(([x, y]) => new Phaser.Math.Vector2(x, y));
      g.fillStyle(MOUTH, 1).fillPoints(pts, true);
      g.fillStyle(hexToInt(C.snail.tongue), 1).fillEllipse(31.5, -15.6, 3.6, 1.8);
      g.strokePoints(pts, true);
    }
  }

  /** A burst of confetti in the team colours and gold, once on winning. */
  private confetti(snail: Snail): void {
    const colors = [...TEAM_COLORS, C.hud.accent, C.explosion.starOuter].map(hexToInt);
    for (let i = 0; i < 28; i++) {
      const c = colors[i % colors.length] ?? ACCENT;
      const bit = this.scene.add
        .rectangle(snail.x, snail.y - 40, 4, 2.5, c)
        .setDepth(LABEL_DEPTH)
        .setRotation(Math.random() * Math.PI);
      this.scene.tweens.add({
        targets: bit,
        x: snail.x + (Math.random() - 0.5) * 160,
        y: snail.y - 40 + 30 + Math.random() * 60,
        rotation: bit.rotation + (Math.random() - 0.5) * 12,
        alpha: 0,
        duration: 1600 + Math.random() * 900,
        ease: 'Quad.easeOut',
        onComplete: () => {
          bit.destroy();
        },
      });
    }
  }

  /** Ground slope under the snail, from the surface heights just left and right of its feet. */
  private groundTilt(snail: Snail, mask: TerrainMask): number {
    const top = (x: number): number => {
      for (let y = snail.y - SNAIL.stepUp - 2; y <= snail.y + SNAIL.stepDown + 2; y++) {
        if (isSolid(mask, x, y)) return y;
      }
      return snail.y;
    };
    const dy = top(snail.x + TILT_REACH) - top(snail.x - TILT_REACH);
    return Phaser.Math.Clamp(Math.atan2(dy, 2 * TILT_REACH), -TILT_MAX, TILT_MAX);
  }

  destroy(): void {
    this.root.destroy();
    this.hpText.destroy();
    this.marker.destroy();
  }
}
