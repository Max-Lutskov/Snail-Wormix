/**
 * The grass fringe of generated hills: the non-solid layer over the ground's edge (shown by
 * GrassView), painted with Canvas 2D at art resolution. Same recipe as the drawn bridge map
 * (scripts/art/gen-bridge.mjs, tokens terrain.grassFringe): dark back blades, outlined front
 * blades with a light midrib along the surface normal, and turf tongues hanging over the soil.
 */

import type { TerrainLayout } from '../../core/terrain/layout';
import { ART_SCALE } from '../../core/world';
import { tokens } from '../art/tokens';
import { surfaceTops } from './terrainArt';

const G = tokens.terrain.grassFringe;
/** Blade roots start this far inside the ground so they read as growing out of the turf. */
const ROOT_DEPTH = 2;
/** Half-width of the window used to smooth the surface before measuring its normal. */
const NORMAL_SMOOTH = 6;
/** Half-width (world px at mushroom scale 1) of the gap left in the fringe around a mushroom. */
const MUSHROOM_CLEARING = 13;

/** Small seeded PRNG (mulberry32), render-only. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(list: readonly T[], r: number): T {
  const item = list[Math.min(list.length - 1, Math.floor(r * list.length))];
  if (item === undefined) throw new Error('grassArt: empty color list in tokens');
  return item;
}

interface Edge {
  /** Surface y (world px) at x, or null where the column is empty. */
  readonly y: (x: number) => number | null;
  /** Unit outward normal at x (pointing into the air). */
  readonly normal: (x: number) => { readonly x: number; readonly y: number };
}

function surfaceEdge(layout: TerrainLayout): Edge {
  const { width, height } = layout.mask;
  const top = surfaceTops(layout);
  const at = (x: number): number => top[Math.min(width - 1, Math.max(0, Math.round(x)))] ?? height;
  return {
    y: (x) => {
      const y = at(x);
      return y >= height ? null : y;
    },
    normal: (x) => {
      const dy = (at(x + NORMAL_SMOOTH) - at(x - NORMAL_SMOOTH)) / (2 * NORMAL_SMOOTH);
      const len = Math.sqrt(1 + dy * dy);
      return { x: dy / len, y: -1 / len };
    },
  };
}

/**
 * One blade: a tapered leaf from a root (x, y) toward `angle` (radians, screen coords), drooping
 * by `sag` at the tip.
 */
function bladePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  sag: number,
): { tipX: number; tipY: number } {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const tipX = x + dx * length;
  const tipY = y + dy * length + sag;
  const midX = x + dx * length * 0.55;
  const midY = y + dy * length * 0.55 + sag * 0.4;
  // Perpendicular for the blade's width.
  const px = -dy * width * 0.5;
  const py = dx * width * 0.5;
  ctx.beginPath();
  ctx.moveTo(x - px, y - py);
  ctx.quadraticCurveTo(midX - px * 0.8, midY - py * 0.8, tipX, tipY);
  ctx.quadraticCurveTo(midX + px * 0.8, midY + py * 0.8, x + px, y + py);
  ctx.closePath();
  return { tipX, tipY };
}

/** Angle of a blade: the normal turned by up to ±spread. */
function bladeAngle(n: { x: number; y: number }, r: number): number {
  const spread = (G.spreadDeg * Math.PI) / 180;
  return Math.atan2(n.y, n.x) + (r * 2 - 1) * spread;
}

/** Paints the grass layer for generated terrain into a new art-sized canvas. */
export function paintHillsGrass(layout: TerrainLayout, seed: number): HTMLCanvasElement {
  const { width, height } = layout.mask;
  const canvas = document.createElement('canvas');
  canvas.width = width * ART_SCALE;
  canvas.height = height * ART_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('grassArt: no 2D context');
  ctx.scale(ART_SCALE, ART_SCALE);
  ctx.lineJoin = 'round';
  const edge = surfaceEdge(layout);
  // No blades right around mushrooms, so they aren't buried in the grass.
  const clear = layout.decor.flatMap((d) =>
    d.kind === 'mushroom' ? [{ x: d.x, r: MUSHROOM_CLEARING * d.scale }] : [],
  );
  const cleared = (x: number): boolean => clear.some((c) => Math.abs(x - c.x) < c.r);
  const rnd = prng(seed ^ 0x9e3779b9);
  const patchPhase = rnd() * Math.PI * 2;
  /** Slow wave along the edge in [0.55, 1]: patches of taller and shorter grass. */
  const patch = (x: number): number =>
    0.775 + 0.225 * Math.sin((x / G.patchPeriod) * Math.PI * 2 + patchPhase);

  // Turf tongues hanging over the soil, under the blades.
  const T = G.tongue;
  ctx.lineWidth = 1;
  ctx.strokeStyle = T.outline;
  ctx.fillStyle = T.color;
  for (let x = rnd() * T.step; x < width; x += T.step * (0.7 + rnd() * 0.6)) {
    const y = edge.y(x);
    if (y === null || cleared(x)) continue;
    const n = edge.normal(x);
    const length = T.lengthMin + (T.lengthMax - T.lengthMin) * rnd();
    const half = 3 + rnd() * 2;
    // Tangent along the surface.
    const tx = -n.y;
    const ty = n.x;
    const tipX = x - n.x * length + (rnd() - 0.5) * 4;
    const tipY = y - n.y * length;
    ctx.beginPath();
    ctx.moveTo(x - tx * half, y - ty * half);
    ctx.quadraticCurveTo(
      x - n.x * length * 0.5 - tx * half * 0.6,
      y - n.y * length * 0.5,
      tipX,
      tipY,
    );
    ctx.quadraticCurveTo(
      x - n.x * length * 0.5 + tx * half * 0.6,
      y - n.y * length * 0.5,
      x + tx * half,
      y + ty * half,
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Back blades: short, dark, no outline.
  const B = G.back;
  for (let x = rnd() * B.step; x < width; x += B.step * (0.6 + rnd() * 0.8)) {
    const y = edge.y(x);
    if (y === null || cleared(x)) continue;
    const n = edge.normal(x);
    const h = (B.heightMin + (B.heightMax - B.heightMin) * rnd()) * patch(x);
    ctx.fillStyle = pick(B.colors, rnd());
    bladePath(ctx, x, y + ROOT_DEPTH, bladeAngle(n, rnd()), h, 3, G.sag * h * (1 - Math.abs(n.y)));
    ctx.fill();
  }

  // Front blades: outlined, with a light midrib.
  const F = G.front;
  for (let x = rnd() * F.step; x < width; x += F.step * (0.7 + rnd() * 0.6)) {
    if (rnd() < F.skip) continue;
    const y = edge.y(x);
    if (y === null || cleared(x)) continue;
    const n = edge.normal(x);
    const steep = 1 - Math.abs(n.y);
    const h = (F.heightMin + (F.heightMax - F.heightMin) * rnd()) * patch(x) + F.steepExtra * steep;
    const w = F.widthMin + (F.widthMax - F.widthMin) * rnd();
    const angle = bladeAngle(n, rnd());
    const sag = G.sag * h * steep;
    const rootY = y + ROOT_DEPTH;
    bladePath(ctx, x, rootY, angle, h, w, sag);
    ctx.fillStyle = pick(F.colors, rnd());
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = F.outline;
    ctx.stroke();
    const tip = {
      x: x + Math.cos(angle) * h * 0.75,
      y: rootY + Math.sin(angle) * h * 0.75 + sag * 0.5,
    };
    ctx.beginPath();
    ctx.moveTo(x, rootY);
    ctx.quadraticCurveTo(
      x + Math.cos(angle) * h * 0.4,
      rootY + Math.sin(angle) * h * 0.4,
      tip.x,
      tip.y,
    );
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = pick(F.ribs, rnd());
    ctx.stroke();
  }
  return canvas;
}
