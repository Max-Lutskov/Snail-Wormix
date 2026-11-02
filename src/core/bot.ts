/**
 * A computer opponent. On its turn it tries shots with the same physics the match uses
 * (gravity, the turn's wind, the terrain, snails in the way), keeps the one that lands
 * nearest the closest enemy without hurting itself, then misses by an amount that depends on
 * its skill. Low on health, it sometimes hides in its shell instead.
 *
 * Pure and seeded like the rest of core: the same state and RNG give the same decision.
 */

import { canHide, type MatchState } from './match';
import { launch, stepProjectile, type Aim, type ShotWorld } from './projectile';
import { nextFloat, type RngState } from './rng';
import { SNAIL, type Snail } from './snail/snail';
import type { TerrainLayout } from './terrain/layout';
import { DAMAGE_REACH, WEAPONS, type WeaponId } from './weapons';

export type BotLevel = 'easy' | 'normal' | 'hard';

/** How far off the bot's chosen shot may be: angle (radians) and pull, uniform ±. */
export const BOT_SKILL: Readonly<Record<BotLevel, { angle: number; power: number }>> = {
  easy: { angle: 0.12, power: 0.09 },
  normal: { angle: 0.045, power: 0.035 },
  hard: { angle: 0.012, power: 0.01 },
};

export type BotMove =
  | { readonly kind: 'shoot'; readonly weapon: WeaponId; readonly aim: Aim }
  | { readonly kind: 'hide' };

/** Below this health the bot considers hiding, and does with this chance. */
const HIDE_HP = 35;
const HIDE_CHANCE = 0.35;
/** A flight longer than this many ticks counts as lost. */
const MAX_FLIGHT = 600;

interface Candidate {
  readonly weapon: WeaponId;
  readonly angle: number;
  readonly power: number;
  readonly score: number;
}

function center(s: Snail): { x: number; y: number } {
  return { x: s.x, y: s.y - SNAIL.height / 2 };
}

/** Where a shot explodes, or null if it is lost (water, off the world, too long). */
function landing(
  shooter: Snail,
  weapon: WeaponId,
  angle: number,
  power: number,
  world: ShotWorld,
): { x: number; y: number } | null {
  let p = launch(shooter, weapon, { x: Math.cos(angle) * power, y: Math.sin(angle) * power });
  for (let t = 0; t < MAX_FLIGHT; t++) {
    const step = stepProjectile(p, world);
    if (step.kind === 'explode') return { x: step.x, y: step.y };
    if (step.kind === 'gone') return null;
    p = step.projectile;
  }
  return null;
}

/** Lower is better: distance from the target, with a big penalty for hitting itself. */
function score(
  shooter: Snail,
  target: { x: number; y: number },
  weapon: WeaponId,
  angle: number,
  power: number,
  world: ShotWorld,
): number {
  const at = landing(shooter, weapon, angle, power, world);
  if (!at) return Number.POSITIVE_INFINITY;
  const me = center(shooter);
  const reach = WEAPONS[weapon].craterRadius + DAMAGE_REACH;
  const self = Math.hypot(at.x - me.x, at.y - me.y) < reach ? 10_000 : 0;
  return Math.hypot(at.x - target.x, at.y - target.y) + self;
}

/** The best shot at `target`: a coarse sweep of the upper half-circle, then a finer one. */
function bestShot(
  shooter: Snail,
  target: { x: number; y: number },
  weapons: readonly WeaponId[],
  world: ShotWorld,
): Candidate | null {
  // A holder, so the closure's updates are visible to the type checker below.
  const found: { best: Candidate | null } = { best: null };
  const consider = (weapon: WeaponId, angle: number, power: number): void => {
    if (power <= 0.05 || power > 1) return;
    const s = score(shooter, target, weapon, angle, power, world);
    if (!found.best || s < found.best.score) found.best = { weapon, angle, power, score: s };
  };
  for (const weapon of weapons) {
    for (let angle = -Math.PI + 0.05; angle < -0.05; angle += 0.035) {
      for (let power = 0.25; power <= 1.0001; power += 0.05) consider(weapon, angle, power);
    }
  }
  const coarse = found.best;
  if (!coarse) return null;
  const { weapon, angle: a0, power: p0 } = coarse;
  for (let da = -0.035; da <= 0.035; da += 0.007) {
    for (let dp = -0.05; dp <= 0.05; dp += 0.01) consider(weapon, a0 + da, p0 + dp);
  }
  return found.best;
}

/** The bot's move for the active snail of `state` (which must be the bot's). */
export function planMove(
  state: MatchState,
  layout: TerrainLayout,
  level: BotLevel,
  rng: RngState,
): { move: BotMove; rng: RngState } {
  const me = state.snails[state.active];
  if (!me) return { move: { kind: 'hide' }, rng };
  let r = nextFloat(rng);
  if (me.hp <= HIDE_HP && canHide(state) && r.value < HIDE_CHANCE) {
    return { move: { kind: 'hide' }, rng: r.state };
  }
  const enemies = state.snails.filter((s) => s.alive && s.team !== me.team);
  const target = enemies
    .map(center)
    .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
  const ammo = state.ammo[me.team];
  const weapons = (['pea', 'acorn'] as const).filter((w) => {
    const left = ammo?.[w];
    return left === null || (left ?? 0) > 0;
  });
  const world: ShotWorld = {
    mask: layout.mask,
    waterLevel: layout.waterLevel,
    wind: state.wind,
    snails: state.snails,
  };
  const best = target ? bestShot(me, target, weapons, world) : null;
  // Nothing reaches: lob a pea toward the enemy's side.
  const fallback: Candidate = {
    weapon: 'pea',
    angle: target && target.x < me.x ? -2.3 : -0.85,
    power: 0.7,
    score: Number.POSITIVE_INFINITY,
  };
  const pick = best ?? fallback;
  const skill = BOT_SKILL[level];
  r = nextFloat(r.state);
  const angle = pick.angle + (r.value * 2 - 1) * skill.angle;
  r = nextFloat(r.state);
  const power = Math.min(1, Math.max(0.1, pick.power + (r.value * 2 - 1) * skill.power));
  const round = (v: number): number => Math.round(v * 1e4) / 1e4;
  return {
    move: {
      kind: 'shoot',
      weapon: pick.weapon,
      aim: { x: round(Math.cos(angle) * power), y: round(Math.sin(angle) * power) },
    },
    rng: r.state,
  };
}
