import { describe, expect, it } from 'vitest';
import { launch, stepProjectile, type Projectile, type ShotWorld } from './projectile';
import type { Snail } from './snail/snail';
import { createMask } from './terrain/mask';
import { WEAPON_IDS, type WeaponId } from './weapons';
import { WORLD_WIDTH } from './world';

const shooter: Snail = {
  id: 0,
  team: 0,
  x: 100,
  y: 400,
  vx: 0,
  vy: 0,
  facing: 1,
  grounded: true,
  alive: true,
  hp: 100,
  shell: false,
  shellCooldown: false,
};

/** Open sky, no wind: how far a full-power 45° shot lands from where it left. */
function range(weapon: WeaponId): number {
  const world: ShotWorld = {
    mask: createMask(4000, 1000),
    waterLevel: 1000,
    wind: 0,
    snails: [],
  };
  let p: Projectile = launch(shooter, weapon, -Math.PI / 4, 1);
  const startY = p.y;
  for (let i = 0; i < 2000; i++) {
    const step = stepProjectile(p, world);
    if (step.kind !== 'flying') break;
    p = step.projectile;
    if (p.vy > 0 && p.y >= startY) break;
  }
  return p.x - shooter.x;
}

describe('shot range', () => {
  it.each(WEAPON_IDS)('%s at full pull crosses most of the world', (weapon) => {
    expect(range(weapon)).toBeGreaterThan(WORLD_WIDTH * 0.8);
  });

  it('the acorn is still the shorter, heavier shot', () => {
    expect(range('acorn')).toBeLessThan(range('pea'));
  });
});
