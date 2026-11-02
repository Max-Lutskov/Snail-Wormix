// Shared helpers for the painterly map generators (docs/art/ART_SPEC.md, "Новий напрям землі").
// Everything takes a seeded `rng` so each map stays reproducible.
import { Resvg } from '@resvg/resvg-js';

export const OUT = '#2B1B12';
export const f = (n) => Math.round(n * 10) / 10;

/** Seeded RNG with helpers: rng.next() in [0, 1), rng.r(a, b), rng.pick(xs). */
export function makeRng(seed0) {
  let seed = seed0;
  const next = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    r: (a, b) => a + (b - a) * next(),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
  };
}

/** Rasterizes solid shapes (SVG markup) and returns isSolid(x, y) at alpha >= 128. */
export function solidTester(markup, w, h) {
  const px = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${markup}</svg>`,
  ).render().pixels;
  return (x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return false;
    return px[(yi * w + xi) * 4 + 3] >= 128;
  };
}

/** Samples an absolute M/L/C path every ~`step` px: points with unit tangent `t` and air-side normal `n`. */
export function samplePath(d, step, solid) {
  const nums = d.match(/[MLC]|-?\d+(\.\d+)?/g);
  const segs = [];
  let cur = null;
  for (let i = 0; i < nums.length;) {
    const c = nums[i++];
    if (c === 'M') {
      cur = [+nums[i++], +nums[i++]];
    } else if (c === 'L') {
      const p0 = cur;
      const p = [+nums[i++], +nums[i++]];
      segs.push((t) => [p0[0] + (p[0] - p0[0]) * t, p0[1] + (p[1] - p0[1]) * t]);
      cur = p;
    } else {
      const p0 = cur;
      const p1 = [+nums[i++], +nums[i++]];
      const p2 = [+nums[i++], +nums[i++]];
      const p3 = [+nums[i++], +nums[i++]];
      segs.push((t) => {
        const u = 1 - t;
        return [0, 1].map(
          (k) =>
            u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k],
        );
      });
      cur = p3;
    }
  }
  const dense = [];
  for (const s of segs) for (let k = 0; k < 200; k++) dense.push(s(k / 200));
  const out = [];
  let acc = 0;
  for (let i = 1; i < dense.length - 1; i++) {
    acc += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    if (acc < step) continue;
    acc = 0;
    const tx = dense[i + 1][0] - dense[i - 1][0];
    const ty = dense[i + 1][1] - dense[i - 1][1];
    const len = Math.hypot(tx, ty) || 1;
    let n = [-ty / len, tx / len];
    if (solid(dense[i][0] + n[0] * 6, dense[i][1] + n[1] * 6)) n = [-n[0], -n[1]];
    out.push({ p: dense[i], t: [tx / len, ty / len], n });
  }
  return out;
}

/** Smooth closed blob path around (0, 0). */
export function blob(rng, rx, ry, n = 8, jit = 0.14) {
  const pts = [];
  const a0 = rng.r(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + rng.r(-0.18, 0.18);
    const k = 1 + rng.r(-jit, jit);
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
}

/** Soft drop-shadow gradient used by stones; put it in <defs> once. */
export const SHADOW_DEF =
  '<radialGradient id="sh"><stop offset="0" stop-color="#1E120A" stop-opacity=".6"/><stop offset="1" stop-color="#1E120A" stop-opacity="0"/></radialGradient>';

/** A painted stone: soft shadow, body, darker lower half, lit top-left. `edge` adds a thin outline. */
export function stone(rng, x, y, rx, ry, edge = false) {
  const d = blob(rng, rx, ry);
  const body = rng.pick(['#6E5E52', '#7C6A5C', '#655548', '#857262']);
  return (
    `<ellipse cx="${f(x + rx * 0.15)}" cy="${f(y + ry * 0.5)}" rx="${f(rx * 1.2)}" ry="${f(ry * 0.85)}" fill="url(#sh)"/>` +
    `<path d="${d}" transform="translate(${f(x)},${f(y)})" fill="${body}"${edge ? ` stroke="${OUT}" stroke-width="2"` : ''}/>` +
    `<path d="${d}" transform="translate(${f(x + rx * 0.06)},${f(y + ry * 0.24)}) scale(.8)" fill="#000" opacity=".18"/>` +
    `<path d="${d}" transform="translate(${f(x - rx * 0.2)},${f(y - ry * 0.3)}) scale(.52)" fill="#A8927A" opacity=".55"/>` +
    `<circle cx="${f(x - rx * 0.3)}" cy="${f(y - ry * 0.4)}" r="${f(Math.max(1, rx * 0.1))}" fill="#E0D0BA" opacity=".6"/>`
  );
}

/** Turf bands inside the ground along the surfaces (clip them to the ground). */
export function turf(surfaces) {
  const uses = surfaces.map((d) => `<path d="${d}"/>`).join('');
  return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="#1E120A" stroke-width="56" opacity=".3">${uses}</g>
    <g stroke="#1E120A" stroke-width="40" opacity=".25">${uses}</g>
    <g stroke="#3F7F2A" stroke-width="30">${uses}</g>
    <g stroke="#5DAA3A" stroke-width="18">${uses}</g>
    <g stroke="#8ED15A" stroke-width="8">${uses}</g>
    <g stroke="#C4EE84" stroke-width="3">${uses}</g>
  </g>`;
}

const GREENS = ['#4E8F2E', '#5DAA3A', '#6FC046', '#56A035'];
const TIPS = ['#9BD84A', '#B2E36A', '#8ED15A'];
export const rotate = (v, deg) => {
  const a = (deg * Math.PI) / 180;
  return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
};

/** One grass blade: base `b` on the edge, growing along `dir`, drooping with gravity. */
export function blade(rng, b, dir, h, w, back) {
  const droop = h * 0.35 * (1 - Math.abs(dir[1]));
  const tip = [b[0] + dir[0] * h, b[1] + dir[1] * h + droop];
  const mid = [b[0] + dir[0] * h * 0.55, b[1] + dir[1] * h * 0.55];
  const side = [-dir[1], dir[0]];
  const l = [b[0] - side[0] * w, b[1] - side[1] * w];
  const rr = [b[0] + side[0] * w, b[1] + side[1] * w];
  const d = `M${f(l[0])},${f(l[1])} Q${f(mid[0] - side[0] * w * 0.4)},${f(mid[1] - side[1] * w * 0.4)} ${f(tip[0])},${f(tip[1])} Q${f(mid[0] + side[0] * w * 0.5)},${f(mid[1] + side[1] * w * 0.5)} ${f(rr[0])},${f(rr[1])} Z`;
  if (back) return `<path d="${d}" fill="${rng.pick(['#3F7F2A', '#4A8A2F'])}"/>`;
  const rib = `M${f(mid[0])},${f(mid[1])} Q${f((mid[0] + tip[0]) / 2)},${f((mid[1] + tip[1]) / 2 - 1)} ${f(tip[0])},${f(tip[1])}`;
  return `<path d="${d}" fill="${rng.pick(GREENS)}" stroke="#2F5E1E" stroke-width="1"/><path d="${rib}" stroke="${rng.pick(TIPS)}" stroke-width="${f(w * 0.55)}" stroke-linecap="round" fill="none"/>`;
}

/**
 * Grass fringe along one surface: hanging turf tongues (`teeth`), back blades and front blades.
 * `opts.tongues` false skips the tongues (for thin ledges); `opts.scale` shrinks the blades;
 * `opts.skip(x, y)` leaves gaps (e.g. around a mushroom).
 */
export function fringe(rng, d, solid, opts = {}) {
  const { tongues = true, scale = 1, skip = () => false } = opts;
  const teeth = [];
  const back = [];
  const front = [];
  const phase = rng.r(0, 6.28);
  if (tongues) {
    for (const s of samplePath(d, 7, solid)) {
      const L = rng.r(7, 17);
      const a = [
        s.p[0] - s.t[0] * rng.r(4, 6) - s.n[0] * 2,
        s.p[1] - s.t[1] * rng.r(4, 6) - s.n[1] * 2,
      ];
      const b = [
        s.p[0] + s.t[0] * rng.r(4, 6) - s.n[0] * 2,
        s.p[1] + s.t[1] * rng.r(4, 6) - s.n[1] * 2,
      ];
      const lean = rng.r(-3, 3);
      const tip = [
        s.p[0] - s.n[0] * (L + 8) + s.t[0] * lean,
        s.p[1] - s.n[1] * (L + 8) + s.t[1] * lean,
      ];
      const qa = [(a[0] + tip[0]) / 2 - s.t[0] * 2, (a[1] + tip[1]) / 2 - s.t[1] * 2];
      const qb = [(b[0] + tip[0]) / 2 + s.t[0] * 2, (b[1] + tip[1]) / 2 + s.t[1] * 2];
      teeth.push(
        `<path d="M${f(a[0])},${f(a[1])} Q${f(qa[0])},${f(qa[1])} ${f(tip[0])},${f(tip[1])} Q${f(qb[0])},${f(qb[1])} ${f(b[0])},${f(b[1])} Z" fill="${rng.pick(['#3F7F2A', '#4A8A2F', '#468530'])}" stroke="#24461A" stroke-width="1"/>`,
      );
    }
  }
  for (const s of samplePath(d, 3.2, solid)) {
    if (skip(s.p[0], s.p[1])) continue;
    const base = [s.p[0] - s.n[0] * 3, s.p[1] - s.n[1] * 3];
    const clump = 0.6 + 0.4 * Math.sin(s.p[0] / 37 + phase) * Math.sin(s.p[0] / 13 + phase * 2);
    back.push(
      blade(
        rng,
        base,
        rotate(s.n, rng.r(-32, 32)),
        (rng.r(8, 16) * clump + 4) * scale,
        rng.r(2.4, 3.4),
        true,
      ),
    );
  }
  for (const s of samplePath(d, 4.2, solid)) {
    if (rng.next() < 0.15 || skip(s.p[0], s.p[1])) continue;
    const base = [s.p[0] - s.n[0] * 2, s.p[1] - s.n[1] * 2];
    const clump = 0.55 + 0.45 * Math.abs(Math.sin(s.p[0] / 29 + phase));
    const steep = 1 - Math.abs(s.n[1]);
    front.push(
      blade(
        rng,
        base,
        rotate(s.n, rng.r(-30, 30)),
        (rng.r(12, 27) * clump + steep * rng.r(8, 18)) * scale,
        rng.r(2.8, 4.2),
        false,
      ),
    );
  }
  return { teeth, back, front };
}

/** A liana hanging through `points`: a thick wavy vine with leaves. */
export function liana(rng, points) {
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    d += ` Q${f((p[0] + q[0]) / 2 + rng.r(-14, 14))},${f((p[1] + q[1]) / 2)} ${q[0]},${q[1]}`;
  }
  const leaves = points
    .slice(1)
    .map(([x, y], i) => {
      const s = i % 2 ? 1 : -1;
      return `<path d="M${x},${y} c${s * 6},-8 ${s * 16},-8 ${s * 18},-1 c${-s * 6},6 ${-s * 14},6 ${-s * 18},1 Z" fill="${rng.pick(GREENS)}" stroke="#2F5E1E" stroke-width="1"/>`;
    })
    .join('');
  return `<path d="${d}" stroke="#24461A" stroke-width="8" fill="none" stroke-linecap="round"/><path d="${d}" stroke="#4E8F2E" stroke-width="5" fill="none" stroke-linecap="round"/><path d="${d}" stroke="#8ED15A" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".7" transform="translate(-1.5,-1)"/>${leaves}`;
}

/** Red-cap mushroom standing on (x, y). Non-solid: put it in the grass layer, after the blades. */
export function mushroom(x, y, s) {
  return (
    `<g transform="translate(${x},${y}) scale(${s})"><rect x="-3.5" y="-15" width="7" height="17" rx="2.5" fill="#F4EBDD" stroke="${OUT}" stroke-width="1.6"/>` +
    `<path d="M-13,-12 C-13,-29 13,-29 13,-12 Z" fill="#E2453C" stroke="${OUT}" stroke-width="1.8" stroke-linejoin="round"/>` +
    `<path d="M-13,-12 C-9,-15 9,-15 13,-12" fill="none" stroke="#A82E26" stroke-width="2.5"/>` +
    `<path d="M-8,-17 C-7,-22 -3,-24 1,-24" stroke="#F58A7E" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
    `<circle cx="-5" cy="-18" r="2.2" fill="#fff"/><circle cx="5" cy="-20" r="2.6" fill="#fff"/></g>`
  );
}
