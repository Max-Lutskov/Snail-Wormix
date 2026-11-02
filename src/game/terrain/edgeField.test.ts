import { describe, expect, it } from 'vitest';
import { createEdgeField, EDGE_REACH, EDGE_UPDATE_REACH, updateEdgeField } from './edgeField';

const W = 30;
const H = 30;
const ALL = { x: 0, y: 0, width: W, height: H };

/** Ground from row `top` down, full width. */
function flat(top: number): Uint8Array {
  const g = new Uint8Array(W * H);
  for (let y = top; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = 1;
  return g;
}

describe('updateEdgeField', () => {
  it('puts the zero line on the mask edge and grows away from it', () => {
    const g = flat(10);
    const f = createEdgeField(W, H);
    updateEdgeField(f, g, g, ALL);
    const at = (x: number, y: number): number => f.sd[y * W + x] ?? NaN;
    expect(at(15, 10)).toBe(0.5);
    expect(at(15, 9)).toBe(-0.5);
    expect(at(15, 13)).toBe(3.5);
    expect(at(15, 5)).toBe(-4.5);
    expect(at(15, 25)).toBe(EDGE_REACH);
    expect(at(15, 0)).toBe(-EDGE_REACH);
  });

  it('measures true (diagonal) distance to a corner', () => {
    const g = new Uint8Array(W * H);
    g[15 * W + 15] = 1;
    const f = createEdgeField(W, H);
    updateEdgeField(f, g, g, ALL);
    // From (18, 17) to the lone ground pixel (15, 15), center to center: sqrt(9 + 4).
    expect(f.raw[17 * W + 18]).toBeCloseTo(-(Math.sqrt(13) - 0.5), 5);
  });

  it('treats the world sides as air and the bottom as nothing', () => {
    const g = flat(10);
    const f = createEdgeField(W, H);
    updateEdgeField(f, g, g, ALL);
    expect(f.raw[20 * W + 0]).toBe(0.5);
    expect(f.sd[29 * W + 15]).toBe(EDGE_REACH);
  });

  it('marks ground next to carved air as a fresh cut, but not the original surface', () => {
    const original = flat(10);
    const g = original.slice();
    for (let y = 12; y < 16; y++) for (let x = 12; x < 18; x++) g[y * W + x] = 0; // a cave
    const f = createEdgeField(W, H);
    updateEdgeField(f, g, original, ALL);
    expect(f.fresh[16 * W + 15]).toBe(1); // cave floor
    expect(f.fresh[14 * W + 15]).toBe(1); // carved air
    expect(f.fresh[5 * W + 15]).toBe(0); // air that was always air
    expect(f.fresh[10 * W + 3]).toBe(0); // untouched surface
    expect(f.fresh[25 * W + 15]).toBe(0); // deep inside
  });

  it('updating a sub-rect gives the same values as a full pass', () => {
    const original = flat(10);
    const g = original.slice();
    const full = createEdgeField(W, H);
    updateEdgeField(full, original, original, ALL);
    for (let y = 8; y < 14; y++) for (let x = 6; x < 12; x++) g[y * W + x] = 0;
    updateEdgeField(full, g, original, {
      x: 0,
      y: 0,
      width: 12 + EDGE_UPDATE_REACH,
      height: 14 + EDGE_UPDATE_REACH,
    });
    const fresh = createEdgeField(W, H);
    updateEdgeField(fresh, g, original, ALL);
    expect(full.sd).toEqual(fresh.sd);
    expect(full.fresh).toEqual(fresh.fresh);
  });
});
