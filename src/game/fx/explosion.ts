/**
 * Explosion effect, timed per docs/art/ART_SPEC.md (60 fps frames):
 * 0 flash (the crater is cut under it) → 3–5 star + ring + shake → 6–12 debris → 12–30 smoke,
 * and the cut edge glows for ~1.5 s. Pure presentation: the crater itself comes from core.
 */

import Phaser from 'phaser';
import type { TerrainMask } from '../../core/terrain/mask';
import type { Crater } from '../../core/terrain/state';
import { hexToInt, hexToRgb, tokens } from '../art/tokens';
import { FX } from './fxTextures';

const { colors: C, terrain: T, explosion: E } = tokens;
const FRAME_MS = 1000 / E.fps;
const DEPTH = 30;
const BIG_CRATER = 50;

let glowCounter = 0;

export function playExplosion(
  scene: Phaser.Scene,
  crater: Crater,
  mask: TerrainMask,
  cut: () => void,
): void {
  const { x, y, r } = crater;

  // Frame 0–2: flash hides the moment the crater appears.
  const halo = scene.add
    .circle(x, y, r * 1.7, hexToInt(C.explosion.flashHalo), 0.7)
    .setDepth(DEPTH);
  const flash = scene.add.circle(x, y, r * 1.25, hexToInt(C.explosion.flash), 1).setDepth(DEPTH);
  cut();
  addEdgeGlow(scene, crater, mask);
  scene.tweens.add({
    targets: [flash, halo],
    alpha: 0,
    delay: FRAME_MS * 2,
    duration: FRAME_MS * 4,
    onComplete: () => {
      flash.destroy();
      halo.destroy();
    },
  });

  // Frames 3–5: star, expanding ring, small camera shake.
  scene.time.delayedCall(FRAME_MS * 3, () => {
    const star = scene.add.graphics({ x, y }).setDepth(DEPTH + 1);
    drawStar(star, r * 1.1, r * 0.55, hexToInt(C.explosion.starOuter));
    drawStar(star, r * 0.7, r * 0.35, hexToInt(C.explosion.starInner));
    star.setScale(0.4);
    scene.tweens.add({
      targets: star,
      scale: 1.1,
      duration: FRAME_MS * 4,
      ease: 'Back.easeOut',
      onComplete: () => {
        scene.tweens.add({
          targets: star,
          alpha: 0,
          scale: 0.8,
          duration: FRAME_MS * 8,
          onComplete: () => {
            star.destroy();
          },
        });
      },
    });

    const ring = scene.add.graphics({ x, y }).setDepth(DEPTH);
    ring.lineStyle(4, 0xffffff, 1).strokeCircle(0, 0, r);
    ring.setScale(0.6);
    scene.tweens.add({
      targets: ring,
      scale: 2.2,
      alpha: 0,
      duration: FRAME_MS * 16,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        ring.destroy();
      },
    });

    const camera = scene.cameras.main;
    camera.shake(FRAME_MS * 6, E.cameraShakePx / camera.width);
  });

  // Frames 6–12: soil and moss chunks.
  scene.time.delayedCall(FRAME_MS * 6, () => {
    const debris = scene.add.particles(0, 0, FX.chunk, {
      emitting: false,
      speed: { min: 140, max: 380 },
      angle: { min: 200, max: 340 },
      gravityY: 900,
      lifespan: { min: 600, max: 1000 },
      scale: { min: 0.6, max: 1.4 },
      rotate: { min: 0, max: 360 },
      tint: [C.soil.base, C.soil.clump, C.soil.pebble, C.moss.main, C.moss.highlight].map(hexToInt),
    });
    debris.setDepth(DEPTH - 1);
    debris.explode(Math.round(r * 0.6), x, y);
    scene.time.delayedCall(1200, () => {
      debris.destroy();
    });
  });

  // Frames 12–30: dust rises.
  scene.time.delayedCall(FRAME_MS * 12, () => {
    const smoke = scene.add.particles(0, 0, FX.puff, {
      emitting: false,
      speed: { min: 15, max: 55 },
      angle: { min: 235, max: 305 },
      gravityY: -25,
      lifespan: { min: 900, max: 1400 },
      scale: { start: r / 50, end: r / 20 },
      alpha: { start: 0.75, end: 0 },
      tint: [C.explosion.smoke, C.explosion.smokeLight].map(hexToInt),
    });
    smoke.setDepth(DEPTH - 2);
    for (let i = 0; i < 7; i++) {
      smoke.explode(
        1,
        x + Phaser.Math.Between(-r / 2, r / 2),
        y + Phaser.Math.Between(-r / 3, r / 4),
      );
    }
    scene.time.delayedCall(1600, () => {
      smoke.destroy();
    });
  });

  if (r >= BIG_CRATER) showBoomWord(scene, x, y - r - 12);
}

function drawStar(
  g: Phaser.GameObjects.Graphics,
  outer: number,
  inner: number,
  color: number,
): void {
  const points: Phaser.Math.Vector2[] = [];
  const spikes = 8;
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    points.push(new Phaser.Math.Vector2(Math.cos(a) * radius, Math.sin(a) * radius));
  }
  g.fillStyle(color, 1).fillPoints(points, true);
}

/**
 * Hot rim along the freshly cut edge: only on ground pixels within `glowRadius` of the cut,
 * in its own small texture that fades out (the big terrain texture is never redrawn per frame).
 */
function addEdgeGlow(scene: Phaser.Scene, crater: Crater, mask: TerrainMask): void {
  const reach = crater.r + T.glowRadius + 1;
  const x0 = Math.max(0, Math.floor(crater.x - reach));
  const y0 = Math.max(0, Math.floor(crater.y - reach));
  const x1 = Math.min(mask.width, Math.ceil(crater.x + reach));
  const y1 = Math.min(mask.height, Math.ceil(crater.y + reach));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;

  const key = `fx-glow-${glowCounter++}`;
  const texture = scene.textures.createCanvas(key, w, h);
  if (!texture) return;
  const img = texture.context.createImageData(w, h);
  const [gr, gg, gb] = hexToRgb(C.crater.glow);
  let any = false;
  for (let y = y0; y < y1; y++) {
    const dy = y + 0.5 - crater.y;
    for (let x = x0; x < x1; x++) {
      if (mask.data[y * mask.width + x] !== 1) continue;
      const dx = x + 0.5 - crater.x;
      const d = Math.sqrt(dx * dx + dy * dy) - crater.r;
      if (d <= 0 || d > T.glowRadius) continue;
      const o = ((y - y0) * w + (x - x0)) * 4;
      img.data[o] = gr;
      img.data[o + 1] = gg;
      img.data[o + 2] = gb;
      img.data[o + 3] = 255 * (1 - (d - 1) / T.glowRadius);
      any = true;
    }
  }
  if (!any) {
    scene.textures.remove(key);
    return;
  }
  texture.putData(img, 0, 0);
  texture.refresh();

  const glow = scene.add.image(x0, y0, key).setOrigin(0, 0).setDepth(1);
  scene.tweens.add({
    targets: glow,
    alpha: 0,
    duration: tokens.terrain.glowFadeMs,
    ease: 'Quad.easeIn',
    onComplete: () => {
      glow.destroy();
      scene.textures.remove(key);
    },
  });

  // A few embers drifting off the rim.
  const embers = scene.add.particles(0, 0, FX.dot, {
    emitting: false,
    speed: { min: 10, max: 45 },
    angle: { min: 230, max: 310 },
    gravityY: 40,
    lifespan: { min: 700, max: 1400 },
    scale: { start: 0.45, end: 0 },
    tint: hexToInt(C.crater.ember),
  });
  embers.setDepth(2);
  for (let i = 0; i < 4; i++) {
    const a = Math.random() * Math.PI; // lower half of the rim (y grows down), where ground usually is
    embers.explode(1, crater.x + Math.cos(a) * crater.r, crater.y + Math.sin(a) * crater.r);
  }
  scene.time.delayedCall(1600, () => {
    embers.destroy();
  });
}

function showBoomWord(scene: Phaser.Scene, x: number, y: number): void {
  const word = scene.add
    .text(x, y, 'БУМ!', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '40px',
      fontStyle: 'bold',
      color: C.hud.accent,
      stroke: C.snail.outline,
      strokeThickness: 7,
    })
    .setOrigin(0.5)
    .setDepth(DEPTH + 2)
    .setAngle(-8)
    .setScale(0.3);
  scene.tweens.add({
    targets: word,
    scale: 1,
    duration: 180,
    ease: 'Back.easeOut',
    onComplete: () => {
      scene.tweens.add({
        targets: word,
        alpha: 0,
        y: y - 30,
        delay: 450,
        duration: 350,
        onComplete: () => {
          word.destroy();
        },
      });
    },
  });
}
