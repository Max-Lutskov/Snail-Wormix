/**
 * Garden ammo (docs/art/ART_SPEC.md, "Садові снаряди"). Crater radii mirror tokens.ammo.
 * Speeds and accelerations are in px per tick (60 ticks per second).
 */

export type WeaponId = 'pea' | 'acorn' | 'dandelion';

export interface Weapon {
  readonly id: WeaponId;
  /**
   * blast: explodes on impact. drill: on hitting the ground it bores on along its flight
   * direction for DRILL_LENGTH px, carving a tunnel of craterRadius (a ramp to climb), no damage.
   */
  readonly kind: 'blast' | 'drill';
  readonly craterRadius: number;
  /** Damage at the blast center; falls off linearly to 0 at craterRadius + DAMAGE_REACH. */
  readonly damage: number;
  /** Launch speed at full pull. */
  readonly maxSpeed: number;
  /** Multipliers on the world gravity and on the turn's wind. */
  readonly gravity: number;
  readonly wind: number;
  /** Shots per team per match; null = unlimited. */
  readonly ammo: number | null;
}

export const WEAPONS: Readonly<Record<WeaponId, Weapon>> = {
  pea: {
    id: 'pea',
    kind: 'blast',
    craterRadius: 36,
    damage: 35,
    maxSpeed: 15,
    gravity: 1,
    wind: 1,
    ammo: null,
  },
  acorn: {
    id: 'acorn',
    kind: 'blast',
    craterRadius: 52,
    damage: 50,
    // Still heavier than the pea, but at full pull it reaches across the world (~1360 px).
    maxSpeed: 16,
    gravity: 1.25,
    wind: 1.6,
    ammo: 2,
  },
  // A seed drill: the tunnel fits a snail at any angle (box diagonal ~34 px < 2 r).
  dandelion: {
    id: 'dandelion',
    kind: 'drill',
    craterRadius: 18,
    damage: 0,
    maxSpeed: 15,
    gravity: 1,
    wind: 1,
    ammo: 3,
  },
};

export const WEAPON_IDS: readonly WeaponId[] = ['pea', 'acorn', 'dandelion'];

/** How far a drill bores past the point where it hits the ground, and how fast (px per tick). */
export const DRILL_LENGTH = 160;
export const DRILL_SPEED = 4;

/** Damage still reaches this far past the crater rim. */
export const DAMAGE_REACH = 14;
