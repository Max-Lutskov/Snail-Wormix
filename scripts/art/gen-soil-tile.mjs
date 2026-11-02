// Generates public/art/soil-tile.svg: a seamless 480x480 tile of painterly soil ("мальований
// природний" in docs/art/ART_SPEC.md). No outlines inside the soil: soft tone patches, brush
// strokes and grain, plus pebbles, roots and small clods with soft shading. Light comes from the
// top left, so the tile is only repeated (no flips). Every element that crosses an edge is also
// drawn shifted by +-480, so the tile wraps without seams.
// Seeded, so the output is stable. Usage: node scripts/art/gen-soil-tile.mjs public/art/soil-tile.svg
// Also exported as soilTile() for map generators that embed the tile as a <pattern>.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SOIL_TILE_SIZE = 480; // tokens.terrain.soilTileSize

export function soilTile(seed0 = 4242) {
  let seed = seed0;
  const rnd = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = (a, b) => a + (b - a) * rnd();
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const f = (n) => Math.round(n * 10) / 10;
  const S = SOIL_TILE_SIZE;

  /** Emits `draw(x, y)` at every wrap offset where an element of radius `rad` would be visible. */
  const wrap = (x, y, rad, draw) => {
    let out = '';
    for (const dy of [-S, 0, S]) {
      for (const dx of [-S, 0, S]) {
        const X = x + dx;
        const Y = y + dy;
        if (X + rad < 0 || X - rad > S || Y + rad < 0 || Y - rad > S) continue;
        out += draw(X, Y);
      }
    }
    return out;
  };

  /** Smooth closed blob path around (0, 0). */
  const blob = (rx, ry, n = 7, jit = 0.18) => {
    const pts = [];
    const a0 = r(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + r(-0.2, 0.2);
      const k = 1 + r(-jit, jit);
      pts.push([Math.cos(a) * rx * k, Math.sin(a) * ry * k]);
    }
    let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p3 = pts[(i + 2) % n];
      d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
    }
    return `${d}Z`;
  };

  const defs = [];
  const layers = { tone: '', stroke: '', clod: '', root: '', pebble: '', grain: '' };

  // Soft radial "paint" for tone patches and shadows: colour in the middle, fading out.
  const soft = (id, color, a) =>
    defs.push(
      `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${a}"/><stop offset=".6" stop-color="${color}" stop-opacity="${a * 0.6}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
    );
  const TONES = ['#5A3A24', '#432919', '#634129', '#3B2416', '#4E3220'];
  TONES.forEach((c, i) => soft(`t${i}`, c, 0.8));
  soft('sh', '#1E120A', 0.55);
  soft('hl', '#8A6446', 0.45);

  // 1. Tone patches: wide, slightly flattened, layered like brushed paint.
  for (let i = 0; i < 34; i++) {
    const x = r(0, S);
    const y = r(0, S);
    const rx = r(70, 170);
    const ry = rx * r(0.28, 0.5);
    const rot = r(-14, 14);
    const g = `t${Math.floor(rnd() * TONES.length)}`;
    layers.tone += wrap(
      x,
      y,
      rx,
      (X, Y) =>
        `<ellipse cx="${f(X)}" cy="${f(Y)}" rx="${f(rx)}" ry="${f(ry)}" transform="rotate(${f(rot)} ${f(X)} ${f(Y)})" fill="url(#${g})"/>`,
    );
  }

  // 2. Brush strokes: short, mostly horizontal, light and dark.
  for (let i = 0; i < 150; i++) {
    const x = r(0, S);
    const y = r(0, S);
    const len = r(10, 34);
    const a = (r(-22, 22) * Math.PI) / 180;
    const dx = (Math.cos(a) * len) / 2;
    const dy = (Math.sin(a) * len) / 2;
    const bend = r(-4, 4);
    const light = rnd() < 0.45;
    const col = light ? pick(['#71492F', '#7C5536', '#6A4430']) : pick(['#2E1C11', '#341F13']);
    const w = r(2, 5.5);
    const op = light ? r(0.3, 0.55) : r(0.25, 0.45);
    layers.stroke += wrap(
      x,
      y,
      len,
      (X, Y) =>
        `<path d="M${f(X - dx)},${f(Y - dy)} Q${f(X)},${f(Y + bend)} ${f(X + dx)},${f(Y + dy)}" stroke="${col}" stroke-width="${f(w)}" stroke-linecap="round" fill="none" opacity="${f(op)}"/>`,
    );
  }

  // 3. Small clods: slightly lighter lumps with a soft lit top and a soft shadow under them.
  for (let i = 0; i < 16; i++) {
    const x = r(0, S);
    const y = r(0, S);
    const rx = r(9, 20);
    const ry = rx * r(0.6, 0.8);
    const d = blob(rx, ry);
    const body = pick(['#5E3D26', '#583922', '#644229']);
    layers.clod += wrap(
      x,
      y,
      rx + 6,
      (X, Y) =>
        `<ellipse cx="${f(X + 2)}" cy="${f(Y + ry * 0.7)}" rx="${f(rx * 1.15)}" ry="${f(ry * 0.6)}" fill="url(#sh)"/>` +
        `<path d="${d}" transform="translate(${f(X)},${f(Y)})" fill="${body}"/>` +
        `<path d="${d}" transform="translate(${f(X - rx * 0.18)},${f(Y - ry * 0.3)}) scale(.55)" fill="#7A5236" opacity=".55"/>`,
    );
  }

  // 4. Roots: tapered wavy lines with a few rootlets.
  for (let i = 0; i < 9; i++) {
    const x = r(0, S);
    const y = r(0, S);
    const len = r(50, 120);
    const a = (r(25, 155) * Math.PI) / 180; // mostly downward, often slanted
    const pts = [[0, 0]];
    for (let k = 1; k <= 4; k++) {
      const t = (k / 4) * len;
      pts.push([Math.cos(a) * t + r(-14, 14), Math.sin(a) * t + r(-5, 5)]);
    }
    const seg = (w, from, to, col, op) => {
      let d = `M${f(pts[from][0])},${f(pts[from][1])}`;
      for (let k = from + 1; k <= to; k++) {
        const p = pts[k - 1];
        const q = pts[k];
        d += ` Q${f(p[0] + r(-6, 6))},${f((p[1] + q[1]) / 2)} ${f(q[0])},${f(q[1])}`;
      }
      return `<path d="${d}" stroke="${col}" stroke-width="${w}" stroke-linecap="round" fill="none" opacity="${op}"/>`;
    };
    const body =
      seg(4, 0, 2, '#3A2416', 0.6) +
      seg(3, 0, 2, '#8A6544', 0.9) +
      seg(1.8, 2, 4, '#8A6544', 0.85) +
      seg(1.2, 0, 2, '#B08A62', 0.6);
    const lets = [1, 2, 3]
      .map((k) => {
        const p = pts[k];
        const s = rnd() < 0.5 ? -1 : 1;
        return `<path d="M${f(p[0])},${f(p[1])} q${f(s * r(6, 12))},${f(r(2, 6))} ${f(s * r(10, 20))},${f(r(8, 16))}" stroke="#7A583A" stroke-width="1.1" fill="none" stroke-linecap="round" opacity=".8"/>`;
      })
      .join('');
    layers.root += wrap(
      x,
      y,
      len + 20,
      (X, Y) => `<g transform="translate(${f(X)},${f(Y)})">${body}${lets}</g>`,
    );
  }

  // 5. Pebbles: rounded stones with a soft drop shadow, a lit top-left and a dark lower half.
  for (let i = 0; i < 26; i++) {
    const x = r(0, S);
    const y = r(0, S);
    const rx = rnd() < 0.2 ? r(12, 20) : r(3.5, 10);
    const ry = rx * r(0.62, 0.85);
    const d = blob(rx, ry, 7, 0.12);
    const body = pick(['#7A6252', '#86705C', '#6E5A4A', '#8E775F', '#735E4C']);
    layers.pebble += wrap(
      x,
      y,
      rx + 6,
      (X, Y) =>
        `<ellipse cx="${f(X + rx * 0.25)}" cy="${f(Y + ry * 0.55)}" rx="${f(rx * 1.25)}" ry="${f(ry * 0.8)}" fill="url(#sh)"/>` +
        `<path d="${d}" transform="translate(${f(X)},${f(Y)})" fill="${body}"/>` +
        `<path d="${d}" transform="translate(${f(X + rx * 0.08)},${f(Y + ry * 0.22)}) scale(.82)" fill="#000" opacity=".16"/>` +
        `<path d="${d}" transform="translate(${f(X - rx * 0.22)},${f(Y - ry * 0.3)}) scale(.5)" fill="#B89E84" opacity=".5"/>` +
        `<circle cx="${f(X - rx * 0.32)}" cy="${f(Y - ry * 0.38)}" r="${f(Math.max(0.8, rx * 0.12))}" fill="#E6D8C4" opacity=".7"/>`,
    );
  }

  // 6. Grain: fine light and dark specks.
  for (let i = 0; i < 520; i++) {
    const x = r(0, S);
    const y = r(0, S);
    const rr = r(0.6, 1.8);
    const col = rnd() < 0.55 ? '#24150C' : '#8A6446';
    layers.grain += wrap(
      x,
      y,
      2,
      (X, Y) =>
        `<circle cx="${f(X)}" cy="${f(Y)}" r="${f(rr)}" fill="${col}" opacity="${f(r(0.35, 0.75))}"/>`,
    );
  }

  const body =
    `<rect width="${S}" height="${S}" fill="#4A2F1E"/>` +
    layers.tone +
    layers.stroke +
    layers.clod +
    layers.root +
    layers.pebble +
    layers.grain;
  return { defs: defs.join(''), body };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { defs, body } = soilTile();
  const S = SOIL_TILE_SIZE;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">\n  <!-- Painterly soil tile, generated by scripts/art/gen-soil-tile.mjs. Seamless, repeat only. -->\n  <defs>${defs}</defs>\n  ${body}\n</svg>\n`;
  writeFileSync(process.argv[2], svg);
  console.log('written', svg.length, 'bytes');
}
