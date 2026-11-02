/**
 * Snail movement on the terrain mask: crawling with small step-ups and step-downs, a forward
 * jump, gravity, wall bounces, knockback from explosions, health, hiding in the shell and
 * drowning.
 *
 * Fixed step: one call of stepSnail is one tick (1/60 s), velocities are in px per tick.
 * The snail is a box standing on its feet point (x, y): it covers columns
 * floor(x) ± halfWidth and rows y - height .. y - 1; when grounded, row y holds the ground.
 * State is plain numbers, so it serializes to JSON and replays exactly.
 */

import type { Crater } from '../terrain/state';
import { isSolid, type TerrainMask } from '../terrain/mask';

export const SNAIL = {
  /** Hitbox: columns floor(x) ± halfWidth, `height` rows above the feet. */
  halfWidth: 10,
  height: 26,
  /** Crawl speed, px per tick (36 px/s). */
  walkSpeed: 0.6,
  /** Highest step climbed and deepest step followed down while crawling. */
  stepUp: 6,
  stepDown: 6,
  /** px per tick². */
  gravity: 0.18,
  maxFallSpeed: 9,
  /** Jump velocity, px per tick: forward and up. */
  jumpForward: 2.2,
  jumpUp: 4.2,
  /**
   * Air control: ←/→ in the air push the sideways speed toward ±airSpeed by airControl per
   * tick, enough to turn a jump around. Faster flights (thrown by a blast) can't be steered.
   */
  airControl: 0.12,
  airSpeed: 2.2,
  /** Share of horizontal speed kept (reversed) when hitting a wall in the air. */
  wallBounce: 0.35,
  /** Knockback: peak speed at the crater center, and reach beyond the crater radius. */
  knockback: 7,
  knockbackReach: 20,
  maxHp: 100,
  /** In the shell, blasts do this share of their damage and knockback. */
  shellFactor: 0.5,
} as const;

export interface Snail {
  readonly id: number;
  readonly team: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: 1 | -1;
  readonly grounded: boolean;
  readonly alive: boolean;
  /** Hiding in its shell (until its next turn starts): blasts hurt and push it less. */
  readonly shell: boolean;
  /** Hid on its last turn, so it can't hide on this one (no hiding twice in a row). */
  readonly shellCooldown: boolean;
  /** 0 when dead. */
  readonly hp: number;
}

export interface SnailInput {
  readonly move: -1 | 0 | 1;
  readonly jump: boolean;
}

export interface SnailWorld {
  readonly mask: TerrainMask;
  /** Feet at or below this y drown. */
  readonly waterLevel: number;
}

/** True if any ground pixel is inside the snail's box with its feet at (x, y). */
export function overlaps(mask: TerrainMask, x: number, y: number): boolean {
  const cx = Math.floor(x);
  const fy = Math.floor(y);
  for (let py = fy - SNAIL.height; py < fy; py++) {
    for (let px = cx - SNAIL.halfWidth; px <= cx + SNAIL.halfWidth; px++) {
      if (isSolid(mask, px, py)) return true;
    }
  }
  return false;
}

/** True if there is ground right under the snail's feet at (x, y). */
export function supported(mask: TerrainMask, x: number, y: number): boolean {
  const cx = Math.floor(x);
  for (let px = cx - SNAIL.halfWidth; px <= cx + SNAIL.halfWidth; px++) {
    if (isSolid(mask, px, y)) return true;
  }
  return false;
}

/** A snail standing on the first surface below the top of the world at x. */
export function spawnSnail(id: number, team: number, x: number, world: SnailWorld): Snail {
  const { mask } = world;
  let y = SNAIL.height;
  while (y < mask.height && (overlaps(mask, x, y) || !supported(mask, x, y))) y++;
  const grounded = y < mask.height;
  return {
    id,
    team,
    x,
    y: grounded ? y : SNAIL.height,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded,
    alive: true,
    hp: SNAIL.maxHp,
    shell: false,
    shellCooldown: false,
  };
}

/** Takes `amount` hp off; the snail dies at 0. */
export function damageSnail(snail: Snail, amount: number): Snail {
  if (!snail.alive || amount <= 0) return snail;
  const hp = Math.max(0, snail.hp - amount);
  return { ...snail, hp, alive: hp > 0 };
}

/** Advances the snail by one tick. Dead snails don't change. */
export function stepSnail(snail: Snail, input: SnailInput, world: SnailWorld): Snail {
  if (!snail.alive) return snail;
  const next = snail.grounded
    ? walk(snail, input, world.mask)
    : fly(steer(snail, input), world.mask);
  return next.y >= world.waterLevel ? { ...next, alive: false, hp: 0, vx: 0, vy: 0 } : next;
}

function walk(snail: Snail, input: SnailInput, mask: TerrainMask): Snail {
  const facing = input.move === 0 ? snail.facing : input.move;
  if (!supported(mask, snail.x, snail.y)) {
    return { ...snail, facing, grounded: false, vx: 0, vy: 0 };
  }
  if (input.jump) {
    return {
      ...snail,
      facing,
      grounded: false,
      vx: facing * SNAIL.jumpForward,
      vy: -SNAIL.jumpUp,
    };
  }
  if (input.move === 0) return facing === snail.facing ? snail : { ...snail, facing };

  const x = snail.x + input.move * SNAIL.walkSpeed;
  let lift = 0;
  while (lift <= SNAIL.stepUp && overlaps(mask, x, snail.y - lift)) lift++;
  if (lift > SNAIL.stepUp) return { ...snail, facing };

  let y = snail.y - lift;
  for (let d = 0; d < SNAIL.stepDown && !supported(mask, x, y) && !overlaps(mask, x, y + 1); d++) {
    y++;
  }
  if (!supported(mask, x, y)) {
    return { ...snail, x, y, facing, grounded: false, vx: input.move * SNAIL.walkSpeed, vy: 0 };
  }
  return { ...snail, x, y, facing };
}

/** Air control of the snail's own jump (see SNAIL.airControl). */
function steer(snail: Snail, input: SnailInput): Snail {
  if (input.move === 0 || Math.abs(snail.vx) > SNAIL.airSpeed + 1e-9) return snail;
  const target = input.move * SNAIL.airSpeed;
  const dv = Math.max(-SNAIL.airControl, Math.min(SNAIL.airControl, target - snail.vx));
  return { ...snail, vx: snail.vx + dv, facing: input.move };
}

function fly(snail: Snail, mask: TerrainMask): Snail {
  let { x, y, vx } = snail;
  let vy = Math.min(snail.vy + SNAIL.gravity, SNAIL.maxFallSpeed);
  // Substeps of at most 1 px, so the snail never skips through thin ground.
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy))));
  for (let i = 0; i < n; i++) {
    const sx = vx / n;
    if (sx !== 0) {
      if (overlaps(mask, x + sx, y)) vx = -vx * SNAIL.wallBounce;
      else x += sx;
    }
    const sy = vy / n;
    if (overlaps(mask, x, y + sy)) {
      if (sy > 0) return land(snail, x, y, mask);
      vy = 0;
    } else {
      y += sy;
    }
  }
  return { ...snail, x, y, vx, vy };
}

/** Puts the snail on the ground right under (x, y). */
function land(snail: Snail, x: number, y: number, mask: TerrainMask): Snail {
  let fy = Math.floor(y);
  while (!supported(mask, x, fy) && !overlaps(mask, x, fy + 1)) fy++;
  return { ...snail, x, y: fy, vx: 0, vy: 0, grounded: true };
}

/**
 * Throws the snail away from an explosion: speed falls off linearly from the crater center to
 * `knockbackReach` beyond its rim. Snails out of reach are returned unchanged.
 */
export function applyExplosion(snail: Snail, crater: Crater): Snail {
  const strength = snail.shell ? SNAIL.shellFactor : 1;
  if (!snail.alive) return snail;
  const cx = snail.x;
  const cy = snail.y - SNAIL.height / 2;
  const dx = cx - crater.x;
  const dy = cy - crater.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const reach = crater.r + SNAIL.knockbackReach;
  if (d >= reach) return snail;
  const k = SNAIL.knockback * strength * (1 - d / reach);
  // Straight up when the blast is right at the snail; always with a little lift.
  const ux = d > 0.001 ? dx / d : 0;
  const uy = d > 0.001 ? dy / d : -1;
  return {
    ...snail,
    grounded: false,
    vx: snail.vx + ux * k,
    vy: snail.vy + Math.min(uy * k, 0) - k * 0.4,
  };
}
