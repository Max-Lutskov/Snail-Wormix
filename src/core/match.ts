/**
 * A match: snails take turns, one shot each, until one team is left.
 *
 * Turn flow (all in ticks, 60 per second):
 *   intro   a short pause: whose turn it is, the camera glides over; no input, no timer
 *   aim     the active snail crawls, jumps and may fire once or hide in its shell (which
 *           ends the turn at once); ends at the turn timer
 *   flight  the shot flies; nobody moves on purpose
 *   retreat a few seconds for the shooter to crawl away
 *   settle  everyone falls and lands; then the next team's snail gets the turn
 * Wind changes every turn. stepMatch is pure apart from carving craters into the live
 * terrain layout (as addCrater does), so the same inputs replay to the same match.
 */

import { launch, MAX_WIND, stepProjectile, type Projectile } from './projectile';
import { nextFloat, seedRng, type RngState } from './rng';
import {
  applyExplosion,
  damageSnail,
  SNAIL,
  spawnSnail,
  stepSnail,
  type Snail,
  type SnailInput,
  type SnailWorld,
} from './snail/snail';
import type { TerrainLayout } from './terrain/layout';
import type { PixelRect } from './terrain/mask';
import { addCrater, type Crater, type TerrainState } from './terrain/state';
import { DAMAGE_REACH, WEAPON_IDS, WEAPONS, type WeaponId } from './weapons';

export const TURN = {
  introTicks: 75,
  aimTicks: 30 * 60,
  retreatTicks: 3 * 60,
  /** Settling lasts at least this long, and at most settleMaxTicks even if a snail keeps moving. */
  settleMinTicks: 30,
  settleMaxTicks: 10 * 60,
} as const;

export const TEAMS = 2;

export type Phase = 'intro' | 'aim' | 'flight' | 'retreat' | 'settle' | 'over';

export type Ammo = Readonly<Record<WeaponId, number | null>>;

export interface MatchState {
  readonly terrain: TerrainState;
  readonly snails: readonly Snail[];
  /** Index into `snails` of the snail whose turn it is. */
  readonly active: number;
  readonly phase: Phase;
  readonly phaseTicks: number;
  readonly turn: number;
  /** Sideways acceleration on shots this turn. */
  readonly wind: number;
  readonly rng: RngState;
  /** Weapon selected by the active team. */
  readonly weapon: WeaponId;
  /** Shots left per team (index = team). */
  readonly ammo: readonly Ammo[];
  readonly projectile: Projectile | null;
  /** Once over: the winning team, or -1 for a draw. */
  readonly winner: number | null;
}

export interface MatchInput extends SnailInput {
  /** Fire now: direction (radians, screen coords) and pull in [0, 1]. */
  readonly fire: { readonly angle: number; readonly power: number } | null;
  readonly weapon: WeaponId | null;
  /** Hide in the shell instead of shooting. */
  readonly hide: boolean;
}

export const NO_INPUT: MatchInput = {
  move: 0,
  jump: false,
  fire: null,
  weapon: null,
  hide: false,
};

export type MatchEvent =
  | { readonly kind: 'fire'; readonly snail: number }
  | { readonly kind: 'hide'; readonly snail: number }
  | {
      readonly kind: 'explosion';
      readonly crater: Crater;
      readonly changed: PixelRect | null;
      readonly removedDecor: readonly number[];
    }
  | {
      readonly kind: 'dig';
      readonly crater: Crater;
      readonly changed: PixelRect | null;
      readonly removedDecor: readonly number[];
    }
  | { readonly kind: 'damage'; readonly snail: number; readonly amount: number }
  | { readonly kind: 'splash' }
  | { readonly kind: 'turn'; readonly active: number }
  | { readonly kind: 'over'; readonly winner: number };

const IDLE: SnailInput = { move: 0, jump: false };

function snailWorld(layout: TerrainLayout): SnailWorld {
  return { mask: layout.mask, waterLevel: layout.waterLevel };
}

function rollWind(rng: RngState): { wind: number; rng: RngState } {
  const r = nextFloat(rng);
  // Rounded so the HUD number and the physics agree exactly.
  return { wind: Math.round((r.value * 2 - 1) * MAX_WIND * 1e5) / 1e5, rng: r.state };
}

function startingAmmo(): Ammo {
  const ammo = {} as Record<WeaponId, number | null>;
  for (const id of WEAPON_IDS) ammo[id] = WEAPONS[id].ammo;
  return ammo;
}

/** One snail per team on the layout's first spawns, facing the middle of the world. */
export function createMatch(
  terrain: TerrainState,
  layout: TerrainLayout,
  seed: number,
): MatchState {
  const world = snailWorld(layout);
  const mid = layout.mask.width / 2;
  const snails = layout.spawns.slice(0, TEAMS).map((spawn, i) => {
    const s = spawnSnail(i, i, spawn.x, world);
    const facing: 1 | -1 = spawn.x < mid ? 1 : -1;
    return { ...s, facing };
  });
  if (snails.length < TEAMS) throw new Error(`match: needs ${TEAMS} spawns`);
  const { wind, rng } = rollWind(seedRng(seed));
  return {
    terrain,
    snails,
    active: 0,
    phase: 'intro',
    phaseTicks: 0,
    turn: 1,
    wind,
    rng,
    weapon: 'pea',
    ammo: snails.map(() => startingAmmo()),
    projectile: null,
    winner: null,
  };
}

export function hasAmmo(ammo: Ammo, weapon: WeaponId): boolean {
  const left = ammo[weapon];
  return left === null || left > 0;
}

/** Ticks left on the turn timer while aiming (0 otherwise). */
export function aimTicksLeft(state: MatchState): number {
  return state.phase === 'aim' ? Math.max(0, TURN.aimTicks - state.phaseTicks) : 0;
}

/** Advances the match by one tick with the active player's input. */
export function stepMatch(
  state: MatchState,
  input: MatchInput,
  layout: TerrainLayout,
): { state: MatchState; events: MatchEvent[] } {
  if (state.phase === 'over') return { state, events: [] };
  const events: MatchEvent[] = [];
  const world = snailWorld(layout);
  let s: MatchState = { ...state, phaseTicks: state.phaseTicks + 1 };
  const team = s.snails[s.active]?.team ?? 0;

  if (s.phase === 'aim' && input.weapon !== null) {
    const ammo = s.ammo[team];
    if (ammo && hasAmmo(ammo, input.weapon)) s = { ...s, weapon: input.weapon };
  }

  const canMove = s.phase === 'aim' || s.phase === 'retreat';
  s = {
    ...s,
    snails: s.snails.map((snail, i) =>
      stepSnail(snail, i === s.active && canMove ? input : IDLE, world),
    ),
  };

  if (s.phase === 'aim' && input.hide) s = hide(s, events);
  else if (s.phase === 'aim' && input.fire !== null) s = fire(s, input.fire, events);
  else if (s.phase === 'flight' && s.projectile) s = fly(s, s.projectile, layout, events);

  for (const [i, snail] of s.snails.entries()) {
    const before = state.snails[i];
    if (before?.alive && !snail.alive && snail.y >= layout.waterLevel)
      events.push({ kind: 'splash' });
  }

  return { state: advancePhase(s, events), events };
}

/** Whether the active snail may hide in its shell now. */
export function canHide(s: MatchState): boolean {
  const snail = s.snails[s.active];
  return s.phase === 'aim' && snail?.alive === true && snail.grounded && !snail.shellCooldown;
}

/** The active snail hides in its shell: that is its move, the turn passes. */
function hide(s: MatchState, events: MatchEvent[]): MatchState {
  if (!canHide(s)) return s;
  events.push({ kind: 'hide', snail: s.snails[s.active]?.id ?? 0 });
  return settle({
    ...s,
    snails: s.snails.map((x, i) => (i === s.active ? { ...x, shell: true } : x)),
  });
}

function fire(
  s: MatchState,
  shot: NonNullable<MatchInput['fire']>,
  events: MatchEvent[],
): MatchState {
  const snail = s.snails[s.active];
  const ammo = s.ammo[snail?.team ?? 0];
  if (!snail?.alive || !snail.grounded || !ammo || !hasAmmo(ammo, s.weapon)) return s;
  const facing: 1 | -1 = Math.cos(shot.angle) >= 0 ? 1 : -1;
  const left = ammo[s.weapon];
  events.push({ kind: 'fire', snail: snail.id });
  return {
    ...s,
    snails: s.snails.map((x, i) => (i === s.active ? { ...x, facing } : x)),
    ammo: s.ammo.map((a, t) =>
      t === snail.team && left !== null ? { ...a, [s.weapon]: left - 1 } : a,
    ),
    projectile: launch(snail, s.weapon, shot.angle, shot.power),
    phase: 'flight',
    phaseTicks: 0,
  };
}

function fly(
  s: MatchState,
  projectile: Projectile,
  layout: TerrainLayout,
  events: MatchEvent[],
): MatchState {
  const step = stepProjectile(projectile, {
    mask: layout.mask,
    waterLevel: layout.waterLevel,
    wind: s.wind,
    snails: s.snails,
  });
  if (step.kind === 'flying') {
    if (!step.carve) return { ...s, projectile: step.projectile };
    const crater: Crater = { ...step.carve, r: WEAPONS[projectile.weapon].craterRadius };
    const carved = addCrater(s.terrain, layout, crater);
    events.push({
      kind: 'dig',
      crater,
      changed: carved.changed,
      removedDecor: carved.removedDecor,
    });
    return { ...s, terrain: carved.state, projectile: step.projectile };
  }
  const after: MatchState = { ...s, projectile: null, phase: 'retreat', phaseTicks: 0 };
  if (step.kind === 'gone') {
    if (!projectile.drill && projectile.y >= layout.waterLevel - 20) {
      events.push({ kind: 'splash' });
    }
    return after;
  }
  const weapon = WEAPONS[projectile.weapon];
  const crater: Crater = { x: step.x, y: step.y, r: weapon.craterRadius };
  const carved = addCrater(s.terrain, layout, crater);
  events.push({
    kind: 'explosion',
    crater,
    changed: carved.changed,
    removedDecor: carved.removedDecor,
  });
  const reach = crater.r + DAMAGE_REACH;
  const snails = s.snails.map((snail) => {
    const dx = snail.x - crater.x;
    const dy = snail.y - SNAIL.height / 2 - crater.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const full = d < reach ? weapon.damage * (1 - d / reach) : 0;
    const amount = Math.round(snail.shell ? full * SNAIL.shellFactor : full);
    if (amount > 0 && snail.alive) events.push({ kind: 'damage', snail: snail.id, amount });
    return damageSnail(applyExplosion(snail, crater), amount);
  });
  return { ...after, terrain: carved.state, snails };
}

function advancePhase(s: MatchState, events: MatchEvent[]): MatchState {
  const activeAlive = s.snails[s.active]?.alive === true;
  switch (s.phase) {
    case 'intro':
      return s.phaseTicks >= TURN.introTicks ? { ...s, phase: 'aim', phaseTicks: 0 } : s;
    case 'aim':
      return s.phaseTicks >= TURN.aimTicks || !activeAlive ? settle(s) : s;
    case 'retreat':
      return s.phaseTicks >= TURN.retreatTicks || !activeAlive ? settle(s) : s;
    case 'settle': {
      const calm = s.snails.every((x) => !x.alive || x.grounded);
      const done =
        (calm && s.phaseTicks >= TURN.settleMinTicks) || s.phaseTicks >= TURN.settleMaxTicks;
      return done ? nextTurn(s, events) : s;
    }
    default:
      return s;
  }
}

function settle(s: MatchState): MatchState {
  return { ...s, phase: 'settle', phaseTicks: 0 };
}

function nextTurn(s: MatchState, events: MatchEvent[]): MatchState {
  const teamsAlive = new Set(s.snails.filter((x) => x.alive).map((x) => x.team));
  if (teamsAlive.size <= 1) {
    const winner = teamsAlive.size === 1 ? ([...teamsAlive][0] ?? -1) : -1;
    events.push({ kind: 'over', winner });
    return { ...s, phase: 'over', phaseTicks: 0, winner };
  }
  const team = s.snails[s.active]?.team;
  let next = s.active;
  for (let k = 1; k <= s.snails.length; k++) {
    const i = (s.active + k) % s.snails.length;
    const cand = s.snails[i];
    if (cand?.alive && cand.team !== team) {
      next = i;
      break;
    }
  }
  const { wind, rng } = rollWind(s.rng);
  const nextTeam = s.snails[next]?.team ?? 0;
  const ammo = s.ammo[nextTeam];
  events.push({ kind: 'turn', active: next });
  // The snail that just moved may hide next time only if it didn't hide now; the one whose
  // turn starts comes out of its shell.
  const snails = s.snails.map((x, i) =>
    i === next ? { ...x, shell: false } : i === s.active ? { ...x, shellCooldown: x.shell } : x,
  );
  return {
    ...s,
    snails,
    active: next,
    phase: 'intro',
    phaseTicks: 0,
    turn: s.turn + 1,
    wind,
    rng,
    weapon: ammo && hasAmmo(ammo, s.weapon) ? s.weapon : 'pea',
  };
}
