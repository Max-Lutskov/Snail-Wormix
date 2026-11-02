/**
 * A shot in flight: gravity and the turn's wind act on it each tick; it moves in substeps of at
 * most 1 px and explodes on the first ground pixel or snail it touches. Falling into the water
 * or leaving the world through a side removes it without a blast.
 *
 * A drill (WEAPONS[...].kind) passes through snails; on hitting the ground it switches to
 * boring: straight along its impact direction at DRILL_SPEED, carving a crater each tick, for
 * DRILL_LENGTH px.
 */

import { SNAIL, type Snail } from './snail/snail';
import { isSolid, type TerrainMask } from './terrain/mask';
import { DRILL_LENGTH, DRILL_SPEED, WEAPONS, type WeaponId } from './weapons';

/** World gravity on shots, px per tick². */
export const SHOT_GRAVITY = 0.15;
/** Strongest wind, px per tick² (sideways). */
export const MAX_WIND = 0.018;
/** Ticks after launch during which the shot passes through the snail that fired it. */
const OWNER_GRACE_TICKS = 8;
/** Shots leaving further than this past the world's sides are gone. */
const SIDE_MARGIN = 200;

export interface Projectile {
  readonly weapon: WeaponId;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** Id of the snail that fired it. */
  readonly owner: number;
  readonly age: number;
  /** Set once a drill hits the ground: unit direction and px left to bore. */
  readonly drill: { readonly dx: number; readonly dy: number; readonly left: number } | null;
}

export interface ShotWorld {
  readonly mask: TerrainMask;
  readonly waterLevel: number;
  /** Sideways acceleration this turn, in [-MAX_WIND, MAX_WIND]. */
  readonly wind: number;
  readonly snails: readonly Snail[];
}

export type ShotStep =
  | {
      readonly kind: 'flying';
      readonly projectile: Projectile;
      /** A drill boring: carve a crater of the weapon's radius here. */
      readonly carve: { readonly x: number; readonly y: number } | null;
    }
  | { readonly kind: 'explode'; readonly x: number; readonly y: number }
  | { readonly kind: 'gone' };

/** Where a snail's shots leave from: the middle of its body. */
export function muzzle(snail: Snail): { x: number; y: number } {
  return { x: snail.x, y: snail.y - SNAIL.height / 2 };
}

/**
 * The pull of a shot: its direction (screen coords, y down) scaled by the power in [0, 1].
 * Given as a vector, not an angle, so no sin/cos runs in the simulation: those may differ in
 * the last bit between JS engines, and online every client must compute the same flight.
 */
export interface Aim {
  readonly x: number;
  readonly y: number;
}

/** A shot fired by `snail` with `aim` (longer than 1 counts as full power). */
export function launch(snail: Snail, weapon: WeaponId, aim: Aim): Projectile {
  const len = Math.sqrt(aim.x * aim.x + aim.y * aim.y);
  const k = (len > 1 ? 1 / len : 1) * WEAPONS[weapon].maxSpeed;
  const { x, y } = muzzle(snail);
  return {
    weapon,
    x,
    y,
    vx: aim.x * k,
    vy: aim.y * k,
    owner: snail.id,
    age: 0,
    drill: null,
  };
}

function hitsSnail(p: Projectile, x: number, y: number, snails: readonly Snail[]): boolean {
  if (WEAPONS[p.weapon].kind === 'drill') return false;
  for (const s of snails) {
    if (!s.alive || (s.id === p.owner && p.age < OWNER_GRACE_TICKS)) continue;
    if (
      x >= s.x - SNAIL.halfWidth &&
      x <= s.x + SNAIL.halfWidth + 1 &&
      y >= s.y - SNAIL.height &&
      y < s.y
    ) {
      return true;
    }
  }
  return false;
}

/** Advances the shot by one tick. */
export function stepProjectile(p: Projectile, world: ShotWorld): ShotStep {
  if (p.drill) return bore(p, p.drill, world);
  const w = WEAPONS[p.weapon];
  const vx = p.vx + world.wind * w.wind;
  const vy = p.vy + SHOT_GRAVITY * w.gravity;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy))));
  let { x, y } = p;
  for (let i = 0; i < n; i++) {
    x += vx / n;
    y += vy / n;
    if (w.kind === 'drill' && isSolid(world.mask, x, y)) {
      const speed = Math.sqrt(vx * vx + vy * vy) || 1;
      const drill = { dx: vx / speed, dy: vy / speed, left: DRILL_LENGTH };
      return {
        kind: 'flying',
        projectile: { ...p, x, y, vx, vy, age: p.age + 1, drill },
        carve: { x, y },
      };
    }
    if (isSolid(world.mask, x, y) || hitsSnail(p, x, y, world.snails)) {
      return { kind: 'explode', x, y };
    }
    if (y >= world.waterLevel) return { kind: 'gone' };
  }
  if (x < -SIDE_MARGIN || x > world.mask.width + SIDE_MARGIN) return { kind: 'gone' };
  return { kind: 'flying', projectile: { ...p, x, y, vx, vy, age: p.age + 1 }, carve: null };
}

function bore(p: Projectile, drill: NonNullable<Projectile['drill']>, world: ShotWorld): ShotStep {
  const step = Math.min(DRILL_SPEED, drill.left);
  const x = p.x + drill.dx * step;
  const y = p.y + drill.dy * step;
  const left = drill.left - step;
  const outside = x < 0 || x >= world.mask.width || y < 0 || y >= world.waterLevel;
  if (left <= 0 || outside) return { kind: 'gone' };
  return {
    kind: 'flying',
    projectile: { ...p, x, y, age: p.age + 1, drill: { ...drill, left } },
    carve: { x, y },
  };
}

/** The first `ticks` positions of a shot's flight (for the aim preview); stops at impact. */
export function previewPath(
  p: Projectile,
  world: ShotWorld,
  ticks: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let shot = p;
  for (let i = 0; i < ticks; i++) {
    const step = stepProjectile(shot, world);
    if (step.kind !== 'flying' || step.projectile.drill) break;
    shot = step.projectile;
    points.push({ x: shot.x, y: shot.y });
  }
  return points;
}
