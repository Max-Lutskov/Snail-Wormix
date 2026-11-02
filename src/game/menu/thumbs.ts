/** Map previews for the menu cards, drawn from what the game already loaded. */

import type Phaser from 'phaser';
import { generateHills } from '../../core/terrain/hills';
import { surfaceY } from '../../core/terrain/mask';
import { tokens } from '../art/tokens';

const W = 320;
const H = 144;

function canvas(): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('thumbs: no 2D context');
  return { c, ctx };
}

/** A drawn map: its backdrop (or the sky colour) with its terrain on top, scaled down. */
export function mapThumbnail(
  scene: Phaser.Scene,
  terrainKey: string,
  backKey: string | null,
): HTMLCanvasElement {
  const { c, ctx } = canvas();
  ctx.fillStyle = tokens.colors.sky.top;
  ctx.fillRect(0, 0, W, H);
  for (const key of [backKey, terrainKey]) {
    if (key && scene.textures.exists(key)) {
      ctx.drawImage(scene.textures.get(key).getSourceImage() as CanvasImageSource, 0, 0, W, H);
    }
  }
  return c;
}

/** Generated hills: a soil silhouette with a moss top under the garden sky. */
export function hillsThumbnail(seed: number): HTMLCanvasElement {
  const { c, ctx } = canvas();
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, tokens.colors.sky.top);
  sky.addColorStop(1, tokens.colors.sky.bottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  const { mask, waterLevel } = generateHills(seed);
  const sx = mask.width / W;
  const sy = mask.height / H;
  for (let x = 0; x < W; x++) {
    const top = surfaceY(mask, Math.floor(x * sx));
    if (top === null) continue;
    const y = top / sy;
    ctx.fillStyle = tokens.colors.soil.clump;
    ctx.fillRect(x, y, 1, H - y);
    ctx.fillStyle = tokens.colors.moss.main;
    ctx.fillRect(x, y, 1, 4);
  }
  ctx.fillStyle = tokens.colors.water.surface;
  ctx.fillRect(0, waterLevel / sy, W, H);
  return c;
}
