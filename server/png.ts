/**
 * A small PNG decoder for the maps' terrain.png (8-bit RGBA or RGB, not interlaced: what
 * resvg writes). The server needs the exact alpha the browsers read, without a native image
 * library.
 */

import { inflateSync } from 'node:zlib';

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel. */
  readonly rgba: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Uint8Array): DecodedPng {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('png: bad signature');
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const color = data[9];
      const interlace = data[12];
      if (depth !== 8 || interlace !== 0 || (color !== 6 && color !== 2)) {
        throw new Error(`png: unsupported format (depth ${depth}, color ${color})`);
      }
      channels = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? (line[i - channels] ?? 0) : 0;
      const b = prev[i] ?? 0;
      const c = i >= channels ? (prev[i - channels] ?? 0) : 0;
      const x = src[i] ?? 0;
      const v =
        filter === 0
          ? x
          : filter === 1
            ? x + a
            : filter === 2
              ? x + b
              : filter === 3
                ? x + ((a + b) >> 1)
                : x + paeth(a, b, c);
      line[i] = v & 0xff;
    }
    for (let px = 0; px < width; px++) {
      const o = (y * width + px) * 4;
      out[o] = line[px * channels] ?? 0;
      out[o + 1] = line[px * channels + 1] ?? 0;
      out[o + 2] = line[px * channels + 2] ?? 0;
      out[o + 3] = channels === 4 ? (line[px * channels + 3] ?? 0) : 255;
    }
    prev.set(line);
  }
  return { width, height, rgba: out };
}
