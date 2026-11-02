/**
 * Garden ammo (docs/art/ART_SPEC.md, "Садові снаряди"). Crater radii mirror tokens.ammo.
 * Speeds and accelerations are in px per tick (60 ticks per second).
 */

export type WeaponId = 'pea' | 'acorn';

export interface Weapon {
  readonly id: WeaponId;
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
    craterRadius: 36,
    damage: 35,
    maxSpeed: 15,
    gravity: 1,
    wind: 1,
    ammo: null,
  },
  acorn: {
    id: 'acorn',
    craterRadius: 52,
    damage: 50,
    // Still heavier than the pea, but at full pull it reaches across the world (~1360 px).
    maxSpeed: 16,
    gravity: 1.25,
    wind: 1.6,
    ammo: 2,
  },
};

export const WEAPON_IDS: readonly WeaponId[] = ['pea', 'acorn'];

/** Damage still reaches this far past the crater rim. */
export const DAMAGE_REACH = 14;
