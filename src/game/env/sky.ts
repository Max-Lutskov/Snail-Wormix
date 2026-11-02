import Phaser from 'phaser';
import { hexToInt, tokens } from '../art/tokens';

const C = tokens.colors.sky;
const SKY_KEY = 'env-sky';
const SUN_KEY = 'env-sun';

/** Screen-fixed vertical gradient sky with a soft sun spot; follows viewport resizes. */
export function createSky(scene: Phaser.Scene): void {
  if (!scene.textures.exists(SKY_KEY)) {
    const sky = scene.textures.createCanvas(SKY_KEY, 4, 256);
    if (sky) {
      const g = sky.context.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, C.top);
      g.addColorStop(1, C.bottom);
      sky.context.fillStyle = g;
      sky.context.fillRect(0, 0, 4, 256);
      sky.refresh();
    }
  }
  if (!scene.textures.exists(SUN_KEY)) {
    const sun = scene.textures.createCanvas(SUN_KEY, 256, 256);
    if (sun) {
      const g = sun.context.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0, C.sun);
      g.addColorStop(0.35, C.sun);
      g.addColorStop(1, 'rgba(255,248,210,0)');
      sun.context.fillStyle = g;
      sun.context.fillRect(0, 0, 256, 256);
      sun.refresh();
    }
  }

  const skyImage = scene.add.image(0, 0, SKY_KEY).setOrigin(0, 0).setScrollFactor(0).setDepth(-100);
  const sunImage = scene.add.image(0, 0, SUN_KEY).setScrollFactor(0.05).setDepth(-99);

  const layout = (width: number, height: number): void => {
    skyImage.setDisplaySize(width, height);
    sunImage.setPosition(width * 0.78, height * 0.16);
  };
  layout(scene.scale.width, scene.scale.height);
  scene.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => {
    layout(size.width, size.height);
  });
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.scale.off(Phaser.Scale.Events.RESIZE);
  });
}

/** Tiny deterministic LCG for decoration placement (render-only, stable between reloads). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function leafPoints(
  x: number,
  y: number,
  length: number,
  halfWidth: number,
  angle: number,
): Phaser.Math.Vector2[] {
  const pts: Phaser.Math.Vector2[] = [];
  const steps = 10;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const push = (along: number, side: number): void => {
    pts.push(new Phaser.Math.Vector2(x + along * ca - side * sa, y + along * sa + side * ca));
  };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    push(t * length, Math.sin(t * Math.PI) * halfWidth);
  }
  for (let i = steps - 1; i > 0; i--) {
    const t = i / steps;
    push(t * length, -Math.sin(t * Math.PI) * halfWidth);
  }
  return pts;
}

/**
 * Two pale parallax layers behind the terrain: far clover and grass, nearer leaves with dew.
 * Kept low-contrast so the dark ground always reads first.
 */
export function createParallax(scene: Phaser.Scene, worldWidth: number, worldHeight: number): void {
  const { parallax } = tokens;
  const from = -300;
  const to = worldWidth + 300;

  const far = scene.add.graphics().setScrollFactor(parallax.far).setDepth(-90);
  const farColor = hexToInt(C.parallaxFar);
  const rndFar = lcg(11);
  far.fillStyle(farColor, 1);
  far.lineStyle(3, farColor, 1);
  for (let x = from; x < to; x += 40 + rndFar() * 50) {
    const base = worldHeight * 0.78 + rndFar() * 40;
    if (rndFar() < 0.45) {
      // Clover: stem + three round leaves.
      const top = base - 140 - rndFar() * 120;
      const lean = (rndFar() - 0.5) * 30;
      far.lineBetween(x, base, x + lean, top);
      const leaf = 13 + rndFar() * 8;
      far.fillCircle(x + lean - leaf * 0.8, top, leaf);
      far.fillCircle(x + lean + leaf * 0.8, top, leaf);
      far.fillCircle(x + lean, top - leaf * 0.9, leaf);
    } else {
      // Grass blade.
      const h = 70 + rndFar() * 110;
      const lean = (rndFar() - 0.5) * 40;
      far.fillTriangle(x - 4, base, x + 4, base, x + lean, base - h);
    }
  }
  far.fillRect(from, worldHeight * 0.8, to - from, worldHeight);

  const near = scene.add.graphics().setScrollFactor(parallax.near).setDepth(-80);
  const nearColor = hexToInt(C.parallaxNear);
  const dewStroke = hexToInt('#A9D9E3');
  const rndNear = lcg(29);
  for (let x = from; x < to; x += 150 + rndNear() * 120) {
    const base = worldHeight * 0.92;
    const top = base - 200 - rndNear() * 140;
    near.lineStyle(5, nearColor, 1).lineBetween(x, base, x, top);
    const leaves = 1 + Math.floor(rndNear() * 2);
    for (let i = 0; i < leaves; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const angle = side < 0 ? Math.PI + 0.5 + rndNear() * 0.4 : -0.5 - rndNear() * 0.4;
      const len = 70 + rndNear() * 50;
      const ly = top + i * 40;
      near.fillStyle(nearColor, 1).fillPoints(leafPoints(x, ly, len, len * 0.32, angle), true);
      if (rndNear() < 0.6) {
        const dx = Math.cos(angle) * len * 0.55;
        const dy = Math.sin(angle) * len * 0.55 - 4;
        const r = 5 + rndNear() * 4;
        near.fillStyle(0xffffff, 0.55).fillCircle(x + dx, ly + dy, r);
        near.lineStyle(1.5, dewStroke, 1).strokeCircle(x + dx, ly + dy, r);
      }
    }
  }
}
