/**
 * Art tokens from docs/art/tokens.json (single source of truth, owned by the art spec),
 * plus helpers to turn its hex strings into what Phaser and pixel code need.
 */

import tokens from '../../../docs/art/tokens.json';

export { tokens };

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function hexToInt(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}
