import { describe, expect, it } from 'vitest';
import { launch, stepProjectile, type Projectile, type ShotWorld } from './projectile';
import { SNAIL, spawnSnail, stepSnail, type Snail } from './snail/snail';
import { carveCircle, createMask, isSolid, type TerrainMask } from './terrain/mask';
import { DRILL_LENGTH, WEAPONS } from './weapons';

/** Flat ground at y 300, with a block (x 200..500) rising to y 210 on it. */
function cliff(): TerrainMask {
  const mask = createMask(700, 400);
  for (let y = 0; y < 400; y++) {
    for (let x = 0; x < 700; x++) {
      if (y >= 300 || (x >= 200 && x < 500 && y >= 210)) mask.data[y * 700 + x] = 1;
    }
  }
  return mask;
}

/** Fires the drill and carves as match.ts does; returns how many craters it cut. */
function drill(mask: TerrainMask, from: Snail, angle: number, power: number): number {
  const world: ShotWorld = { mask, waterLevel: 390, wind: 0, snails: [from] };
  let p: Projectile = launch(from, 'dandelion', angle, power);
  let cuts = 0;
  for (let i = 0; i < 500; i++) {
    const step = stepProjectile(p, world);
    if (step.kind !== 'flying') {
      expect(step.kind).toBe('gone');
      break;
    }
    if (step.carve) {
      carveCircle(mask, step.carve.x, step.carve.y, WEAPONS.dandelion.craterRadius);
      cuts++;
    }
    p = step.projectile;
  }
  return cuts;
}

describe('dandelion drill', () => {
  it('bores a ramp into a cliff that a snail can climb to the top', () => {
    const mask = cliff();
    const world = { mask, waterLevel: 390 };
    const snail = spawnSnail(0, 0, 150, world);
    expect(snail.y).toBe(300);

    // Without a tunnel the 90 px wall stops the snail.
    let blocked = snail;
    for (let i = 0; i < 400; i++) blocked = stepSnail(blocked, { move: 1, jump: false }, world);
    expect(blocked.y).toBe(300);

    const cuts = drill(mask, snail, -0.6, 0.35);
    expect(cuts).toBeGreaterThan(DRILL_LENGTH / 5);
    // The tunnel comes out on top of the block.
    expect(isSolid(mask, 330, 205)).toBe(false);

    // Crawl right; when stuck, jump (the tunnel mouth is a little above the ground).
    let s = snail;
    let stuck = 0;
    for (let i = 0; i < 1500 && !(s.grounded && s.y <= 210 && s.x > 400); i++) {
      const before = s.x;
      s = stepSnail(s, { move: 1, jump: stuck > 10 }, world);
      stuck = s.grounded && s.x === before ? stuck + 1 : 0;
    }
    expect(s.y).toBeLessThanOrEqual(210);
    expect(s.x).toBeGreaterThan(400);
    expect(s.alive).toBe(true);
  });

  it('flies through snails and does no harm', () => {
    const mask = createMask(700, 400);
    const shooter: Snail = { ...spawnSnail(0, 0, 100, { mask, waterLevel: 390 }), y: 300 };
    const target: Snail = { ...shooter, id: 1, x: 200 };
    const world: ShotWorld = { mask, waterLevel: 390, wind: 0, snails: [shooter, target] };
    let p = launch(shooter, 'dandelion', 0, 1);
    for (let i = 0; i < 30; i++) {
      const step = stepProjectile(p, world);
      expect(step.kind).toBe('flying');
      if (step.kind === 'flying') p = step.projectile;
    }
    expect(p.x).toBeGreaterThan(target.x + SNAIL.halfWidth);
  });
});
