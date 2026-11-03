/** Map previews for the menu cards, drawn from what the game already loaded. */

import type Phaser from 'phaser';
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
