import { describe, expect, it } from 'vitest';
import {
  carveCircle,
  checksum,
  cloneMask,
  createMask,
  fillBelow,
  isSolid,
  surfaceY,
  type TerrainMask,
} from './mask';

function solidMask(width: number, height: number): TerrainMask {
  const m = createMask(width, height);
  m.data.fill(1);
  return m;
}

function countSolid(m: TerrainMask): number {
  let n = 0;
  for (const v of m.data) n += v;
  return n;
}

describe('createMask', () => {
  it('starts empty', () => {
    const m = createMask(10, 5);
    expect(m.width).toBe(10);
    expect(m.height).toBe(5);
    expect(countSolid(m)).toBe(0);
  });

  it('rejects non-positive or fractional sizes', () => {
    expect(() => createMask(0, 5)).toThrow(RangeError);
    expect(() => createMask(5, 2.5)).toThrow(RangeError);
  });
});

describe('isSolid', () => {
  it('reads the pixel that contains the point', () => {
    const m = createMask(4, 4);
    m.data[2 * 4 + 1] = 1; // x=1, y=2
    expect(isSolid(m, 1, 2)).toBe(true);
    expect(isSolid(m, 1.99, 2.5)).toBe(true);
    expect(isSolid(m, 2, 2)).toBe(false);
  });

  it('treats everything outside the world as air', () => {
    const m = solidMask(4, 4);
    expect(isSolid(m, -0.01, 1)).toBe(false);
    expect(isSolid(m, 4, 1)).toBe(false);
    expect(isSolid(m, 1, -1)).toBe(false);
    expect(isSolid(m, 1, 4)).toBe(false);
  });
});

describe('fillBelow', () => {
  it('makes each column solid from its surface down to the bottom', () => {
    const m = createMask(3, 5);
    fillBelow(m, [0, 3, 5]);
    expect(surfaceY(m, 0)).toBe(0);
    expect(surfaceY(m, 1)).toBe(3);
    expect(surfaceY(m, 2)).toBeNull();
    expect(countSolid(m)).toBe(5 + 2);
  });
});

describe('surfaceY', () => {
  it('finds the first solid pixel from the top, including overhangs', () => {
    const m = createMask(1, 10);
    m.data[4] = 1;
    m.data[8] = 1;
    expect(surfaceY(m, 0)).toBe(4);
  });

  it('returns null for an empty or out-of-world column', () => {
    const m = solidMask(2, 2);
    expect(surfaceY(createMask(2, 2), 0)).toBeNull();
    expect(surfaceY(m, -1)).toBeNull();
    expect(surfaceY(m, 2)).toBeNull();
  });
});

describe('carveCircle', () => {
  it('removes pixels whose centers are inside the circle and keeps the rest', () => {
    const m = solidMask(20, 20);
    carveCircle(m, 10, 10, 3);
    expect(isSolid(m, 10, 10)).toBe(false);
    expect(isSolid(m, 9, 9)).toBe(false);
    // Pixel (12,10) has center (12.5,10.5): distance 2.55 < 3 → carved.
    expect(isSolid(m, 12, 10)).toBe(false);
    // Pixel (13,10) has center (13.5,10.5): distance 3.54 > 3 → kept.
    expect(isSolid(m, 13, 10)).toBe(true);
    expect(isSolid(m, 0, 0)).toBe(true);
  });

  it('carves an area close to pi * r^2', () => {
    const m = solidMask(200, 200);
    carveCircle(m, 100, 100, 40);
    const carved = 200 * 200 - countSolid(m);
    expect(Math.abs(carved - Math.PI * 40 * 40)).toBeLessThan(2 * Math.PI * 40);
  });

  it('returns the bounding box of changed pixels', () => {
    const m = solidMask(20, 20);
    expect(carveCircle(m, 10, 10, 3)).toEqual({ x: 7, y: 7, width: 6, height: 6 });
  });

  it('returns null when nothing changed', () => {
    const m = createMask(20, 20);
    expect(carveCircle(m, 10, 10, 3)).toBeNull();
    const solid = solidMask(20, 20);
    carveCircle(solid, 10, 10, 3);
    expect(carveCircle(solid, 10, 10, 3)).toBeNull();
  });

  it('clips to the world and ignores circles fully outside', () => {
    const m = solidMask(10, 10);
    expect(carveCircle(m, 0, 0, 3)).toEqual({ x: 0, y: 0, width: 3, height: 3 });
    expect(carveCircle(m, -50, -50, 3)).toBeNull();
    expect(carveCircle(m, 5, 5, 0)).toBeNull();
  });

  it('is order independent', () => {
    const a = solidMask(50, 50);
    const b = solidMask(50, 50);
    carveCircle(a, 10, 10, 8);
    carveCircle(a, 15, 12, 6);
    carveCircle(b, 15, 12, 6);
    carveCircle(b, 10, 10, 8);
    expect(checksum(a)).toBe(checksum(b));
  });
});

describe('checksum and cloneMask', () => {
  it('is equal for equal masks and changes when a pixel changes', () => {
    const a = solidMask(30, 30);
    const b = cloneMask(a);
    expect(checksum(a)).toBe(checksum(b));
    carveCircle(b, 5, 5, 2);
    expect(checksum(a)).not.toBe(checksum(b));
  });

  it('depends on dimensions, not only on data', () => {
    expect(checksum(createMask(2, 3))).not.toBe(checksum(createMask(3, 2)));
  });

  it('clones independently', () => {
    const a = solidMask(5, 5);
    const b = cloneMask(a);
    carveCircle(b, 2, 2, 2);
    expect(countSolid(a)).toBe(25);
  });
});
