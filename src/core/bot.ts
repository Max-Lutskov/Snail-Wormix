/**
 * A computer opponent. On its turn it tries shots with the same physics the match uses
 * (gravity, the turn's wind, the terrain, snails in the way), keeps the one that lands
 * nearest the closest enemy without hurting itself, then misses by an amount that depends on
 * its skill. Low on health, it sometimes hides in its shell instead.
 *
 * Tactics: before shooting it may crawl to a better spot (planPosition): it tries a few
 * crawls left and right with the snail physics, skips those that drop it off a ledge, and
 * picks the spot whose best shot is the most forgiving (still lands near the target when
 * slightly off). After shooting it crawls away from the enemy if that is safe (planRetreat).
 * "Safe" includes not standing where a blast next to it would throw it into the water
 * (inDanger, simulated with the real knockback). When it has no shot at the enemy (behind
 * or under terrain), it bores a way with the dandelion drill: it tries drill shots in every
 * direction on a copy of the terrain and keeps the one that opens the best next shot.
 *
 * Pure and seeded like the rest of core: the same state and RNG give the same decision.
 */

import { canHide, type MatchState } from './match';
import { launch, stepProjectile, type Aim, type ShotWorld } from './projectile';
import { nextFloat, type RngState } from './rng';
import { applyExplosion, SNAIL, stepSnail, type Snail, type SnailWorld } from './snail/snail';
import { carveCircle, cloneMask } from './terrain/mask';
import type { TerrainLayout } from './terrain/layout';
import { DAMAGE_REACH, WEAPONS, type WeaponId } from './weapons';

export type BotLevel = 'easy' | 'normal' | 'hard';

/** How far off the bot's chosen shot may be: angle (radians) and pull, uniform ±. */
export const BOT_SKILL: Readonly<Record<BotLevel, { angle: number; power: number }>> = {
  easy: { angle: 0.12, power: 0.09 },
  normal: { angle: 0.055, power: 0.045 },
  hard: { angle: 0.03, power: 0.025 },
};

export type BotMove =
  | { readonly kind: 'shoot'; readonly weapon: WeaponId; readonly aim: Aim }
  | { readonly kind: 'hide' };

/** Below this health the bot considers hiding, and does with this chance. */
const HIDE_HP = 35;
const HIDE_CHANCE = 0.35;
/**
 * Repositioning: a crawl whose shot is at most MOVE_SLACK px worse than staying is still taken
 * with chance MOVE_CHANCE.
 */
const MOVE_SLACK = 20;
const MOVE_CHANCE = 0.6;
/** A dangerous spot costs this much more (px of expected miss) when choosing where to be. */
const DANGER_COST = 300;
/** With no shot landing nearer than this to the enemy, the bot considers the drill. */
const DRILL_WHEN = 55;
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
  sweep: { angle: number; power: number; refine: boolean } = {
    angle: 0.035,
    power: 0.05,
    refine: true,
  },
): Candidate | null {
  // A holder, so the closure's updates are visible to the type checker below.
  const found: { best: Candidate | null } = { best: null };
  const consider = (weapon: WeaponId, angle: number, power: number): void => {
    if (power <= 0.05 || power > 1) return;
    const s = score(shooter, target, weapon, angle, power, world);
    if (!found.best || s < found.best.score) found.best = { weapon, angle, power, score: s };
  };
  for (const weapon of weapons) {
    for (let angle = -Math.PI + 0.05; angle < -0.05; angle += sweep.angle) {
      for (let power = 0.25; power <= 1.0001; power += sweep.power) consider(weapon, angle, power);
    }
  }
  const coarse = found.best;
  if (!coarse || !sweep.refine) return coarse;
  const { weapon, angle: a0, power: p0 } = coarse;
  for (let da = -0.035; da <= 0.035; da += 0.007) {
    for (let dp = -0.05; dp <= 0.05; dp += 0.01) consider(weapon, a0 + da, p0 + dp);
  }
  return found.best;
}

function nearestEnemy(state: MatchState, me: Snail): Snail | undefined {
  return state.snails
    .filter((s) => s.alive && s.team !== me.team)
    .sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x))[0];
}

function usableWeapons(state: MatchState, team: number): WeaponId[] {
  const ammo = state.ammo[team];
  return (['pea', 'acorn'] as const).filter((w) => {
    const left = ammo?.[w];
    return left === null || (left ?? 0) > 0;
  });
}

/**
 * Whether a blast right beside the snail (a pea or an acorn landing on either side) would
 * throw it into the water: simulated with the real knockback and snail physics.
 */
export function inDanger(me: Snail, world: SnailWorld): boolean {
  for (const r of [WEAPONS.pea.craterRadius, WEAPONS.acorn.craterRadius]) {
    for (const side of [-1, 1]) {
      let s = applyExplosion(me, { x: me.x + side * 24, y: me.y - SNAIL.height / 2, r });
      for (let t = 0; t < 400 && s.alive && !s.grounded; t++) {
        s = stepSnail(s, { move: 0, jump: false }, world);
      }
      if (!s.alive) return true;
    }
  }
  return false;
}

/** A crawl the bot can make: direction and how many ticks to hold it. */
export interface Crawl {
  readonly dir: -1 | 1;
  readonly ticks: number;
}

/**
 * Where the snail ends up crawling `dir` for `ticks`, or null if that is unsafe: it would
 * leave the ground, drop more than a step-and-a-half, or end in the water.
 */
function crawlTo(me: Snail, crawl: Crawl, world: SnailWorld): Snail | null {
  let s = me;
  for (let t = 0; t < crawl.ticks; t++) {
    s = stepSnail(s, { move: crawl.dir, jump: false }, world);
    if (!s.alive || !s.grounded || Math.abs(s.y - me.y) > 40) return null;
  }
  return Math.abs(s.x - me.x) < 4 ? null : s;
}

/**
 * How forgiving the best shot from `from` is: the mean miss of it and four slightly-off
 * versions (the bot's own error), so spots with an easy, open shot score lower.
 */
function shotQuality(
  from: Snail,
  target: Snail,
  weapons: readonly WeaponId[],
  world: ShotWorld,
): number {
  const aimAt = center(target);
  const best = bestShot(from, aimAt, weapons, world, { angle: 0.07, power: 0.1, refine: false });
  if (!best) return Number.POSITIVE_INFINITY;
  const offsets = [
    [0, 0],
    [0.03, 0],
    [-0.03, 0],
    [0, 0.03],
    [0, -0.03],
  ] as const;
  let sum = 0;
  for (const [da, dp] of offsets) {
    const s = score(from, aimAt, best.weapon, best.angle + da, best.power + dp, world);
    sum += Math.min(s, 400);
  }
  return sum / offsets.length;
}

/**
 * Whether to crawl before shooting, and where: the spot (staying, or a short or longer crawl
 * either way) with the most forgiving shot; a crawl must be clearly better to be worth it,
 * and a little randomness keeps the bot from being predictable.
 */
export function planPosition(
  state: MatchState,
  layout: TerrainLayout,
  rng: RngState,
): { crawl: Crawl | null; rng: RngState } {
  const me = state.snails[state.active];
  const target = me ? nearestEnemy(state, me) : undefined;
  if (!me || !target) return { crawl: null, rng };
  const walkWorld: SnailWorld = { mask: layout.mask, waterLevel: layout.waterLevel };
  const shotWorld: ShotWorld = { ...walkWorld, wind: state.wind, snails: state.snails };
  const weapons = usableWeapons(state, me.team);
  let r = rng;
  const jitter = (): number => {
    const n = nextFloat(r);
    r = n.state;
    return n.value * 12;
  };
  const danger = (s: Snail): number => (inDanger(s, walkWorld) ? DANGER_COST : 0);
  const stay = shotQuality(me, target, weapons, shotWorld) + danger(me) + jitter();
  let move: { crawl: Crawl; cost: number } | null = null;
  for (const dir of [-1, 1] as const) {
    for (const ticks of [40, 80, 130]) {
      const crawl = { dir, ticks };
      const at = crawlTo(me, crawl, walkWorld);
      if (!at) continue;
      const snails = state.snails.map((s) => (s.id === me.id ? at : s));
      const cost =
        shotQuality(at, target, weapons, { ...shotWorld, snails }) + danger(at) + jitter();
      if (!move || cost < move.cost) move = { crawl, cost };
    }
  }
  // Crawl when it gives a better shot, and usually also when it's not much worse: a bot that
  // never moves looks like a turret.
  const roll = nextFloat(r);
  r = roll.state;
  if (!move) return { crawl: null, rng: r };
  const worthIt = move.cost < stay || (move.cost < stay + MOVE_SLACK && roll.value < MOVE_CHANCE);
  return { crawl: worthIt ? move.crawl : null, rng: r };
}

/** After its shot: a safe crawl away from the enemy, or null to stay put. */
export function planRetreat(
  state: MatchState,
  layout: TerrainLayout,
  rng: RngState,
): { crawl: Crawl | null; rng: RngState } {
  const me = state.snails[state.active];
  const enemy = me ? nearestEnemy(state, me) : undefined;
  if (!me?.alive || !enemy) return { crawl: null, rng };
  const n = nextFloat(rng);
  const away: -1 | 1 = me.x >= enemy.x ? 1 : -1;
  const world: SnailWorld = { mask: layout.mask, waterLevel: layout.waterLevel };
  // Away from the enemy, but never to a spot where one blast throws it into the water (like
  // the edge of the map); if it already stands in such a spot, toward safer ground.
  const long = Math.round(70 + n.value * 50);
  const options: Crawl[] = [
    { dir: away, ticks: long },
    { dir: away, ticks: 40 },
    { dir: -away as -1 | 1, ticks: 60 },
    { dir: -away as -1 | 1, ticks: 110 },
  ];
  const here = inDanger(me, world);
  for (const crawl of options) {
    if (!here && crawl.dir !== away) break;
    const at = crawlTo(me, crawl, world);
    if (at && !inDanger(at, world)) return { crawl, rng: n.state };
  }
  return { crawl: null, rng: n.state };
}

/** The tunnel a drill shot would bore: its carve points (empty if it never hits ground). */
function tunnel(
  me: Snail,
  angle: number,
  power: number,
  world: ShotWorld,
): { x: number; y: number }[] {
  let p = launch(me, 'dandelion', { x: Math.cos(angle) * power, y: Math.sin(angle) * power });
  const cuts: { x: number; y: number }[] = [];
  for (let t = 0; t < MAX_FLIGHT; t++) {
    const step = stepProjectile(p, world);
    if (step.kind !== 'flying') break;
    if (step.carve) cuts.push(step.carve);
    p = step.projectile;
  }
  return cuts;
}

/**
 * The drill shot that best opens the way to `target`: drill shots in every direction (down
 * too), the few whose tunnels pass nearest the target bored into a copy of the terrain, and
 * the one after which the next shot lands nearest wins, if it beats `current` clearly.
 */
function bestDrill(
  me: Snail,
  target: { x: number; y: number },
  weapons: readonly WeaponId[],
  world: ShotWorld,
  layout: TerrainLayout,
  current: number,
): Candidate | null {
  const r = WEAPONS.dandelion.craterRadius;
  const tries: { angle: number; power: number; cuts: { x: number; y: number }[]; near: number }[] =
    [];
  for (let angle = -Math.PI; angle < Math.PI; angle += 0.1) {
    for (const power of [0.2, 0.4, 0.6, 0.8, 1]) {
      const cuts = tunnel(me, angle, power, world);
      if (cuts.length === 0) continue;
      const near = Math.min(...cuts.map((c) => Math.hypot(c.x - target.x, c.y - target.y)));
      tries.push({ angle, power, cuts, near });
    }
  }
  tries.sort((a, b) => a.near - b.near);
  let best: Candidate | null = null;
  for (const t of tries.slice(0, 6)) {
    const mask = cloneMask(layout.mask);
    for (const c of t.cuts) carveCircle(mask, c.x, c.y, r);
    const next = bestShot(
      me,
      target,
      weapons,
      { ...world, mask },
      {
        angle: 0.07,
        power: 0.1,
        refine: false,
      },
    );
    const score = next?.score ?? Number.POSITIVE_INFINITY;
    if (score < current - 20 && (!best || score < best.score)) {
      best = { weapon: 'dandelion', angle: t.angle, power: t.power, score };
    }
  }
  return best;
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
  let pick = best ?? fallback;
  // No shot reaches the enemy (it hides behind or under terrain): bore a way with the drill.
  const drills = ammo?.dandelion;
  if (target && pick.score > DRILL_WHEN && (drills === null || (drills ?? 0) > 0)) {
    const drill = bestDrill(me, target, weapons, world, layout, pick.score);
    if (drill) pick = drill;
  }
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
