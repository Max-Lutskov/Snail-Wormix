/** World size in units (1 unit = 1 terrain pixel). The screen shows 1280x720 of it. */
export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 720;
/**
 * Terrain art pixels per world unit, on each axis. Art (drawn map PNGs, painted ground) is
 * sharper than the mask, which stays 1 px per unit so physics don't change.
 */
export const ART_SCALE = 2;
