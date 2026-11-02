/**
 * Render resolution. The canvas backbuffer matches the screen's physical pixels (CSS size ×
 * devicePixelRatio, capped for phone GPUs) instead of a fixed 1280×720 stretched by CSS, so
 * text, vector graphics and SVG sprites stay sharp. The world is fitted by camera zoom.
 */

import { WORLD_HEIGHT } from '../core/world';

/** Highest render scale (backbuffer px per CSS px). */
export const MAX_RENDER_SCALE = 2;
/** Backbuffer pixel budget, so big screens don't blow the fill rate. */
export const MAX_BACKBUFFER_PIXELS = 3_200_000;

/** devicePixelRatio, overridable in dev with ?dpr=3 to emulate phones. */
export function devicePixelRatio(): number {
  if (import.meta.env.DEV) {
    const forced = Number(new URLSearchParams(window.location.search).get('dpr'));
    if (forced > 0) return forced;
  }
  return window.devicePixelRatio || 1;
}

export interface RenderSize {
  /** Backbuffer size in physical pixels. */
  readonly width: number;
  readonly height: number;
  /** Backbuffer px per CSS px. */
  readonly scale: number;
}

export function renderSize(cssWidth: number, cssHeight: number, dpr: number): RenderSize {
  const budget = Math.sqrt(MAX_BACKBUFFER_PIXELS / Math.max(1, cssWidth * cssHeight));
  const scale = Math.min(dpr, MAX_RENDER_SCALE, budget);
  return {
    width: Math.max(1, Math.round(cssWidth * scale)),
    height: Math.max(1, Math.round(cssHeight * scale)),
    scale,
  };
}

/** Camera zoom that makes the world's full height fill the backbuffer. */
export function worldZoom(backbufferHeight: number): number {
  return backbufferHeight / WORLD_HEIGHT;
}
