import { describe, expect, it } from 'vitest';
import { carveCircle, createMask, type TerrainMask } from '../terrain/mask';
import {
  SNAIL,
  applyExplosion,
  spawnSnail,
  stepSnail,
  type Snail,
  type SnailInput,
  type SnailWorld,
} from './snail';

const IDLE: SnailInput = { move: 0, jump: false };

/** Mask with solid rows from `ground` down, over the whole width. */
function flat(ground: number, width = 400, height = 300): TerrainMask {
  const mask = createMask(width, height);
  mask.data.fill(1, ground * width);
  return mask;
}

function fillRect(mask: TerrainMask, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++) mask.data.fill(1, y * mask.width + x0, y * mask.width + x1);
}

function world(mask: TerrainMask, waterLevel = mask.height - 10): SnailWorld {
  return { mask, waterLevel };
}

function run(s: Snail, w: SnailWorld, ticks: number, input: SnailInput = IDLE): Snail {
  let snail = s;
  for (let i = 0; i < ticks; i++) snail = stepSnail(snail, input, w);
  return snail;
}

describe('snail spawn', () => {
  it('stands on the surface below its spawn x', () => {
    const w = world(flat(200));
    const s = spawnSnail(1, 0, 100, w);
    expect(s).toMatchObject({ x: 100, y: 200, grounded: true, alive: true });
  });
});

describe('snail falling', () => {
  it('falls under gravity and lands on the ground', () => {
    const w = world(flat(200));
    const s: Snail = { ...spawnSnail(1, 0, 100, w), y: 120, grounded: false };
    const landed = run(s, w, 120);
    expect(landed).toMatchObject({ y: 200, grounded: true, vx: 0, vy: 0 });
  });

  it('starts falling when the ground under it is blown away', () => {
    const mask = flat(200);
    fillRect(mask, 0, 120, 400, 140); // a shelf above the floor
    const w = world(mask);
    const s = spawnSnail(1, 0, 100, w);
    expect(s.y).toBe(120);
    for (let x = 80; x <= 120; x++) carveCircle(mask, x, 130, 14);
    const after = run(s, w, 120);
    expect(after).toMatchObject({ y: 200, grounded: true });
  });

  it('drowns below the water level', () => {
    const w = world(createMask(400, 300), 250);
    const s: Snail = { ...spawnSnail(1, 0, 100, w), y: 100, grounded: false };
    expect(run(s, w, 200).alive).toBe(false);
  });
});

describe('snail walking', () => {
  it('crawls along flat ground at walk speed, facing where it goes', () => {
    const w = world(flat(200));
    const s = spawnSnail(1, 0, 100, w);
    const moved = run(s, w, 60, { move: 1, jump: false });
    expect(moved.x).toBeCloseTo(100 + 60 * SNAIL.walkSpeed, 5);
    expect(moved).toMatchObject({ y: 200, grounded: true, facing: 1 });
    expect(run(s, w, 1, { move: -1, jump: false }).facing).toBe(-1);
  });

  it('climbs a step up to stepUp px and is stopped by a taller wall', () => {
    const low = flat(200);
    fillRect(low, 120, 200 - SNAIL.stepUp, 400, 200);
    const w1 = world(low);
    const s1 = run(spawnSnail(1, 0, 100, w1), w1, 120, { move: 1, jump: false });
    expect(s1.x).toBeGreaterThan(140);
    expect(s1.y).toBe(200 - SNAIL.stepUp);

    const high = flat(200);
    fillRect(high, 120, 200 - SNAIL.stepUp - 2, 400, 200);
    const w2 = world(high);
    const s2 = run(spawnSnail(1, 0, 100, w2), w2, 120, { move: 1, jump: false });
    expect(s2.x).toBeLessThan(120 - SNAIL.halfWidth);
    expect(s2.y).toBe(200);
  });

  it('follows a slope down without leaving the ground', () => {
    const mask = createMask(400, 300);
    // Descends 1 px every 2 px to the right.
    for (let x = 0; x < 400; x++) fillRect(mask, x, 150 + Math.floor(x / 2), x + 1, 300);
    const w = world(mask);
    let s = spawnSnail(1, 0, 100, w);
    for (let i = 0; i < 100; i++) {
      s = stepSnail(s, { move: 1, jump: false }, w);
      expect(s.grounded).toBe(true);
    }
    expect(s.x).toBeGreaterThan(150);
  });

  it('walks off a ledge and falls', () => {
    const mask = flat(250);
    fillRect(mask, 0, 150, 120, 250);
    const w = world(mask);
    const s = run(spawnSnail(1, 0, 100, w), w, 200, { move: 1, jump: false });
    expect(s).toMatchObject({ y: 250, grounded: true });
  });
});

describe('snail jump', () => {
  it('jumps forward in an arc and lands further along', () => {
    const w = world(flat(200));
    const s = spawnSnail(1, 0, 100, w);
    let j = stepSnail(s, { move: 0, jump: true }, w);
    expect(j.grounded).toBe(false);
    let top = j.y;
    while (!j.grounded) {
      j = stepSnail(j, IDLE, w);
      top = Math.min(top, j.y);
    }
    expect(200 - top).toBeGreaterThan(30);
    expect(j.x).toBeGreaterThan(160);
    expect(j.y).toBe(200);
  });

  it('bounces back off a wall it jumps into', () => {
    const mask = flat(200);
    fillRect(mask, 140, 0, 160, 200);
    const w = world(mask);
    const s = run(spawnSnail(1, 0, 100, w), w, 1, { move: 0, jump: true });
    const landed = run(s, w, 200);
    expect(landed.grounded).toBe(true);
    expect(landed.x).toBeLessThan(140 - SNAIL.halfWidth);
  });
});

describe('snail knockback', () => {
  it('is thrown away from an explosion and ignores far ones', () => {
    const w = world(flat(200));
    const s = spawnSnail(1, 0, 100, w);
    const hit = applyExplosion(s, { x: 80, y: 195, r: 30 });
    expect(hit.grounded).toBe(false);
    expect(hit.vx).toBeGreaterThan(0);
    expect(hit.vy).toBeLessThan(0);
    expect(applyExplosion(s, { x: 300, y: 195, r: 30 })).toBe(s);
  });
});

describe('snail determinism', () => {
  it('replays to the same state from the same inputs and a JSON round-trip', () => {
    const w = world(flat(200));
    const inputs: SnailInput[] = [];
    for (let i = 0; i < 300; i++)
      inputs.push({ move: ((i >> 5) % 3) - 1, jump: i % 97 === 0 } as SnailInput);
    const play = (start: Snail): Snail =>
      inputs.reduce((s, input) => stepSnail(s, input, w), start);
    const start = spawnSnail(1, 0, 150, w);
    const a = play(start);
    const b = play(JSON.parse(JSON.stringify(start)) as Snail);
    expect(b).toEqual(a);
  });
});
