// Shared drawing helpers for the map's icons, which are drawn in code in an ink style (our
// own drawing code; the bonus art pack for Nortantis and the FA01-Temperate pack were only
// style references). An icon is always drawn at the same size in its own units, and the
// canvas is scaled to the size it is needed at, so it comes out the same at every size.

import { seededRandom } from '../../rng';

export type Pt = [number, number];
export type Rng = () => number;

/** The app's seeded random numbers (mulberry32). */
export const rng: (seed: number) => Rng = seededRandom;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Line weights, as fractions of U (the width the icon would have if it were a mountain), so all icons share one line weight on the map. */
export const LINE = { outline: 0.022, ridge: 0.0135, hatch: 0.0068, hatchGap: 0.0094, lit: 0.0052 };

/** The thinnest line drawn, in drawing units: about 0.6 screen pixels at the size being drawn. Set by the sprite maker. */
let minLine = 0.6;
export function setMinLine(units: number) {
  minLine = units;
}
export const minLineWidth = () => minLine;

export interface InkOpts {
  taperStart?: number;
  taperEnd?: number;
  minFrac?: number;
}

/** An ink stroke along pts, tapering at the ends, with a little pressure wobble. */
export function ink(ctx: CanvasRenderingContext2D, pts: Pt[], width: number, r: Rng, opts: InkOpts = {}) {
  const { taperStart = 0.25, taperEnd = 0.35, minFrac = 0.25 } = opts;
  if (pts.length < 2) return;
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = lens[lens.length - 1] || 1;
  const phase = r() * 10;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < pts.length; i++) {
    const t = (lens[i - 1] + lens[i]) / 2 / total;
    let f = 1;
    if (t < taperStart) f = minFrac + (1 - minFrac) * Math.sin((t / taperStart) * Math.PI * 0.5);
    if (t > 1 - taperEnd) f = Math.min(f, minFrac + (1 - minFrac) * Math.sin(((1 - t) / taperEnd) * Math.PI * 0.5));
    f *= 0.85 + 0.15 * Math.sin(phase + t * 9);
    ctx.lineWidth = Math.max(minLine, width * f);
    ctx.beginPath();
    ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
    ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
}

/** Midpoint displacement: a jagged line from a to b (pushes the points after a). */
export function displace(r: Rng, a: Pt, b: Pt, rough: number, depth: number, out: Pt[]) {
  if (depth === 0) {
    out.push(b);
    return;
  }
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  const d = (r() - 0.5) * rough * len;
  const m: Pt = [(a[0] + b[0]) / 2 + nx * d, (a[1] + b[1]) / 2 + ny * d];
  displace(r, a, m, rough * 0.92, depth - 1, out);
  displace(r, m, b, rough * 0.92, depth - 1, out);
}

/** Corner cutting: rounds a polyline (keeps its ends). */
export function chaikin(pts: Pt[], times: number): Pt[] {
  let p = pts;
  for (let t = 0; t < times; t++) {
    const out: Pt[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[i + 1];
      out.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/** A jagged line from a to b with a bend (knee) along the way: steep near a, gentler near b. */
export function slope(r: Rng, a: Pt, b: Pt, jag: number): Pt[] {
  const knee: Pt = [lerp(a[0], b[0], 0.4 + r() * 0.12), lerp(a[1], b[1], 0.48 + r() * 0.1)];
  const out: Pt[] = [a];
  displace(r, a, knee, 0.34 * jag, 3, out);
  displace(r, knee, b, 0.3 * jag, 3, out);
  return out;
}

/** Subdivides a polyline with small random wobble, so ink lines are not ruler-straight. */
export function wobble(r: Rng, pts: Pt[], amount: number, seg: number): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / seg));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const w = k === n ? 0 : (r() - 0.5) * amount;
      out.push([lerp(x0, x1, t) + w, lerp(y0, y1, t) + w * 0.6]);
    }
  }
  return out;
}

/** Where the polyline crosses x: the highest crossing (or the lowest, with `lowest`), or null. */
export function yAt(pts: Pt[], x: number, lowest = false): number | null {
  let best: number | null = null;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if ((x - x0) * (x - x1) > 0 || x0 === x1) continue;
    const y = lerp(y0, y1, (x - x0) / (x1 - x0));
    if (best === null || (lowest ? y > best : y < best)) best = y;
  }
  return best;
}

/** Hides whatever is behind a shape (the inside stays see-through), then fills it if a fill is given. */
export function clearShape(ctx: CanvasRenderingContext2D, path: Path2D, fill: string | CanvasGradient | null) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.fill(path);
  ctx.restore();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill(path);
  }
}

export function pathOf(pts: Pt[], close: boolean): Path2D {
  const p = new Path2D();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  if (close) p.closePath();
  return p;
}

export interface HatchOpts {
  gap?: number;
  width?: number;
  minLen?: number;
  slant?: number;
  extra?: Pt[][];
}

/** Vertical hatching inside `clip`: strokes from the line `top` down toward `base`. */
export function hatch(ctx: CanvasRenderingContext2D, r: Rng, clip: Path2D, top: Pt[], x0: number, x1: number, base: number, U: number, opts: HatchOpts = {}) {
  const { gap = LINE.hatchGap, width = LINE.hatch, minLen = 0.75, slant = 0.08, extra = [] } = opts;
  ctx.save();
  ctx.clip(clip);
  for (let x = x0; x < x1; x += U * gap * (0.85 + r() * 0.3)) {
    let yTop = yAt(top, x);
    for (const e of extra) {
      const y = yAt(e, x);
      if (y !== null && (yTop === null || y < yTop)) yTop = y;
    }
    if (yTop === null) continue;
    yTop -= U * 0.006;
    const len = (base - yTop) * (minLen + r() * (1 - minLen));
    const bend = (r() - 0.5) * U * 0.008;
    const pts: Pt[] = [
      [x, yTop],
      [x + slant * len * 0.5 + bend, yTop + len * 0.5],
      [x + slant * len, yTop + len],
    ];
    ink(ctx, wobble(r, pts, U * 0.002, U * 0.025), U * width, r, { taperStart: 0.03, taperEnd: 0.5, minFrac: 0.35 });
  }
  ctx.restore();
}

/** Loose strokes down a lit face, following the slope from `edge` toward the ground. */
export function litStrokes(ctx: CanvasRenderingContext2D, r: Rng, clip: Path2D, edge: Pt[], n: number, base: number, dirX: number, U: number) {
  if (edge.length < 2) return;
  ctx.save();
  ctx.clip(clip);
  for (let k = 0; k < n; k++) {
    const i = Math.min(edge.length - 1, Math.floor((0.12 + r() * 0.8) * (edge.length - 1)));
    const sx = edge[i][0] + U * (0.01 + r() * 0.06) * (dirX < 0 ? 1 : -1);
    const sy = (yAt(edge, sx) ?? edge[i][1]) + U * (0.012 + r() * 0.02);
    const len = (base - sy) * (0.3 + r() * 0.45);
    ink(ctx, wobble(r, [[sx, sy], [sx + dirX * len * 0.45, sy + len]], U * 0.002, U * 0.025), U * LINE.lit, r, { taperStart: 0.08, taperEnd: 0.55 });
  }
  ctx.restore();
}

/** Colors an icon is drawn in: the fill hiding what is behind it (null: leave it see-through), the ink, and two shading tones. */
export interface ArtColors {
  fill: string | CanvasGradient | null;
  color: string;
  wash: string;
  washDark: string;
}
