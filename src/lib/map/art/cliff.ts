import type { CliffShape } from '../../world/types';
import { LINE, chaikin, clearShape, displace, ink, lerp, pathOf, rng, wobble, yAt, type ArtColors, type Pt, type Rng } from './ink';

// Cliffs, one drawing per compass direction (the way the drop faces), never turned: the map
// is seen from the south and from above, so a face always hangs straight down the page and
// only the rim's line changes with the direction. One side only: the high ground is on one
// side of the rim, the drop on the other. The ends are left open (no inked sides), so cliffs
// placed end to end run into each other.
//
// S, SE, SW: the drop faces the viewer, so its rock face shows: a hatched face hanging from
//   the rim, fading into the low ground, with loose rock at its foot. On SE and SW the rim
//   slants, so less of the face shows, and its strokes lean a little toward the drop.
// E, W: the rim runs up and down the page and the face is seen side on: a narrow band of
//   strokes running down and out toward the drop.
// N, NE, NW: the drop faces away from the viewer, so the face is hidden: only the rim shows,
//   with broken blocks along its lip, and short strokes just beyond it where the ground falls
//   away. No loose rock, which would make it read as facing the viewer.

/** Directions, clockwise from north: 0 N, 1 NE, 2 E, 3 SE, 4 S, 5 SW, 6 W, 7 NW. */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Where the rim runs in the S and N drawings (W wide and H = 0.667 W tall), as a fraction of H. */
export const CLIFF_RIM = { facing: 0.24, away: 0.58 };

/**
 * A drawing's box, in units of the icon's width (its size): w wide and h tall, with the icon's
 * point (the middle of a cliff's rim, a waterfall's lip) at (ax, ay) from its top left.
 */
export interface Frame {
  w: number;
  h: number;
  ax: number;
  ay: number;
}

const D = Math.SQRT1_2;
/** How far a SE or SW face's strokes lean toward the drop, across per down. */
export const LEAN = 0.12;
/** How far an E or W face's strokes run toward the drop, across per down. */
export const SHEAR = 0.5;
/** Room left beside a SW, W or NW drawing for strokes leaning left. */
const SIDE_ROOM = { slant: 0.06, side: 0.3, away: 0.04 };

export function cliffFrame(dir: Dir): Frame {
  switch (dir) {
    case 4:
      return { w: 1, h: 0.667, ax: 0.5, ay: 0.667 * CLIFF_RIM.facing };
    case 0:
      return { w: 1, h: 0.667, ax: 0.5, ay: 0.667 * CLIFF_RIM.away };
    case 3:
      return { w: D + 0.06, h: 1.2, ax: D / 2, ay: 0.38 };
    case 5:
      return { w: D + 0.06, h: 1.2, ax: SIDE_ROOM.slant + D / 2, ay: 0.38 };
    case 2:
      return { w: 0.36, h: 1.5, ax: 0.06, ay: 0.5 };
    case 6:
      return { w: 0.36, h: 1.5, ax: SIDE_ROOM.side, ay: 0.5 };
    case 1:
      return { w: D + 0.04, h: 0.9, ax: D / 2, ay: 0.42 };
    case 7:
      return { w: D + 0.04, h: 0.9, ax: SIDE_ROOM.away + D / 2, ay: 0.42 };
  }
}

/** A cliff facing `dir`, drawn L wide (its size) in the box cliffFrame(dir) gives. */
export function cliff(ctx: CanvasRenderingContext2D, seed: number, L: number, c: ArtColors, shape: CliffShape, dir: Dir) {
  const f = cliffFrame(dir);
  switch (dir) {
    case 4:
      return faceBody(ctx, seed, c, shape, { L, x0: 0, W: L, cy: L * f.ay, rise: 0, lean: 0 });
    case 3:
      return faceBody(ctx, seed, c, shape, { L, x0: 0, W: L * D, cy: L * f.ay, rise: -L * D, lean: LEAN });
    case 5:
      return faceBody(ctx, seed, c, shape, { L, x0: L * SIDE_ROOM.slant, W: L * D, cy: L * f.ay, rise: L * D, lean: -LEAN });
    case 2:
      return sideBody(ctx, seed, c, shape, L, 1, L * f.ax, L * f.ay);
    case 6:
      return sideBody(ctx, seed, c, shape, L, -1, L * f.ax, L * f.ay);
    case 0:
      return awayBody(ctx, seed, c, shape, { L, x0: 0, W: L, cy: L * f.ay, rise: 0, lean: 0 });
    case 1:
      return awayBody(ctx, seed, c, shape, { L, x0: 0, W: L * D, cy: L * f.ay, rise: L * D, lean: 0.5 });
    case 7:
      return awayBody(ctx, seed, c, shape, { L, x0: L * SIDE_ROOM.away, W: L * D, cy: L * f.ay, rise: -L * D, lean: -0.5 });
  }
}

/**
 * Where a rim runs across a drawing: from x0 + 0.05 W to x0 + 0.95 W, around height cy,
 * rising or falling by `rise` over W (a slanting rim); `lean` tilts the strokes from it.
 */
interface RimSpec {
  L: number;
  x0: number;
  W: number;
  cy: number;
  rise: number;
  lean: number;
}

function cliffEdge(r: Rng, W: number, H: number, cy: number, t0: number, t1: number, bow: number, tilt: number, x0 = 0) {
  const N = 24;
  const pts: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    const t = lerp(t0, t1, k / N);
    pts.push([x0 + W * t, cy + bow * Math.sin(Math.PI * t) + tilt * (t - 0.5) + (r() - 0.5) * H * 0.025]);
  }
  return chaikin(pts, 2);
}

/** The cliff's pieces along its length (0 to 1): one, or two with a gap for a broken cliff. */
function cliffSegments(r: Rng, shape: CliffShape): [number, number][] {
  if (shape === 'broken') {
    const at = 0.35 + r() * 0.3;
    const gap = 0.05 + r() * 0.05;
    return [
      [0.05, at - gap / 2],
      [at + gap / 2, 0.95],
    ];
  }
  return [[0.05, 0.95]];
}

interface Rock {
  x: number;
  y: number;
  size: number;
}

function drawRocks(ctx: CanvasRenderingContext2D, r: Rng, rocks: Rock[], U: number, c: ArtColors) {
  rocks.sort((a, b) => a.y - b.y);
  for (const rock of rocks) {
    const pts: Pt[] = [];
    const n = 5 + Math.floor(r() * 3);
    const spin = r() * Math.PI;
    for (let k = 0; k < n; k++) {
      const a = spin + (k / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const rr = rock.size * (0.65 + r() * 0.55);
      pts.push([rock.x + Math.cos(a) * rr, rock.y + Math.sin(a) * rr * 0.72]);
    }
    const shape = pathOf(pts, true);
    clearShape(ctx, shape, c.fill);
    ctx.save();
    ctx.clip(shape);
    ctx.beginPath();
    ctx.rect(rock.x - rock.size * 0.2, rock.y - rock.size, rock.size * 1.6, rock.size * 2);
    ctx.clip();
    for (let x = rock.x - rock.size * 0.2; x < rock.x + rock.size * 1.3; x += U * LINE.hatchGap * 0.9)
      ink(ctx, [[x, rock.y - rock.size], [x, rock.y + rock.size]], U * LINE.lit, r, { taperStart: 0.05, taperEnd: 0.4 });
    ctx.restore();
    ink(ctx, [...pts, pts[0]], U * LINE.lit * 1.3, r, { taperStart: 0.02, taperEnd: 0.02, minFrac: 0.6 });
  }
  // Pebbles among the rocks.
  ctx.fillStyle = c.color;
  for (let k = 0; k < rocks.length * 3; k++) {
    const rock = rocks[Math.floor(r() * rocks.length)];
    if (!rock) break;
    ctx.beginPath();
    ctx.arc(rock.x + (r() - 0.5) * U * 0.08, rock.y + (r() - 0.4) * U * 0.04, U * (0.0018 + r() * 0.0028), 0, Math.PI * 2);
    ctx.fill();
  }
}

const smoothstep = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** How tall a facing cliff's face is along its length (t from 0.05 at its left end, as seen with the drop facing you, to 0.95). */
function faceHeights(r: Rng, H: number, shape: CliffShape) {
  const tall = H * (0.42 + r() * 0.16);
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  // Even, or tapering toward one end until the face meets the rim.
  const taper = shape === 'taper-left' ? -1 : shape === 'taper-right' ? 1 : 0;
  const heightAt = (t: number) => {
    const u = Math.max(0, Math.min(1, (t - 0.05) / 0.9));
    const even = tall * (0.9 + 0.06 * Math.sin(t * 9 + p1) + 0.04 * Math.sin(t * 23 + p2));
    if (taper < 0) return even * smoothstep(u / 0.85);
    if (taper > 0) return even * smoothstep((1 - u) / 0.85);
    return even * (0.85 + 0.15 * Math.min(1, Math.min(u, 1 - u) / 0.06));
  };
  const density = (t: number) => 0.5 + 0.3 * Math.sin(t * 17 + p1) + 0.2 * Math.sin(t * 41 + p2);
  return { tall, heightAt, density };
}

/** A cliff whose drop faces the viewer (S), or slants toward the viewer (SE, SW): the rock face hangs from the rim. */
function faceBody(ctx: CanvasRenderingContext2D, seed: number, c: ArtColors, shape: CliffShape, g: RimSpec) {
  const r = rng(seed);
  const { L, x0, W, cy, rise, lean } = g;
  const H = L * 0.667;
  const U = L / 0.9;
  ctx.strokeStyle = c.color;
  const bow = (r() - 0.5) * H * 0.04;
  const tilt = (r() - 0.5) * H * 0.06 + rise;
  const { tall, heightAt, density } = faceHeights(r, H, shape);
  // Where a point at x is along the rim (0 to 1).
  const T = (x: number) => (x - x0) / W;
  const rocks: Rock[] = [];
  for (const [t0, t1] of cliffSegments(r, shape)) {
    const edge = cliffEdge(r, W, H, cy, t0, t1, bow, tilt, x0);
    const first = edge[0];
    const last = edge[edge.length - 1];
    const topAt = (x: number) => yAt(edge, Math.max(first[0], Math.min(last[0], x))) ?? cy;
    const bottomY = (x: number) => topAt(x) + heightAt(T(x)) * 1.1;
    const xl = first[0];
    const xr = last[0];
    const foot = (x: number): Pt => [x + lean * (bottomY(x) + U * 0.03 - topAt(x)), bottomY(x) + U * 0.03];
    // The face's area hides what is behind and clips the hatching. No line is drawn along its bottom or sides.
    const area = pathOf([...edge, foot(xr), foot((xl + xr) / 2), foot(xl)], true);
    clearShape(ctx, area, c.fill);
    ctx.save();
    ctx.clip(area);
    // Over the last stretch at each end the hatching thins out, so the face fades rather than stopping.
    const fadeAt = (x: number) => Math.min(1, Math.min(x - xl, xr - x) / (U * 0.07));
    // The face: strokes from the rim down, denser in recesses, fading out at different depths.
    for (let x = xl; x < xr; x += U * LINE.hatchGap * (0.55 + 1.4 * (1 - density(T(x)))) * (0.85 + r() * 0.3)) {
      if (density(T(x)) < 0.22 && r() < 0.5) continue;
      if (r() > fadeAt(x) * 0.9 + 0.1) continue;
      const yTop = yAt(edge, x);
      if (yTop === null) continue;
      const h = heightAt(T(x));
      if (h <= 0) continue;
      const len = h * (0.65 + r() * 0.45) * (0.6 + 0.4 * fadeAt(x));
      if (r() < 0.3) {
        const cut = 0.3 + r() * 0.35;
        ink(ctx, [[x, yTop - U * 0.004], [x + (r() - 0.5) * U * 0.004 + lean * len * cut, yTop + len * cut]], U * LINE.hatch, r, { taperStart: 0.03, taperEnd: 0.25, minFrac: 0.4 });
        ink(ctx, [[x + (r() - 0.5) * U * 0.004 + lean * len * (cut + 0.05), yTop + len * (cut + 0.05)], [x + (r() - 0.5) * U * 0.008 + lean * len, yTop + len]], U * LINE.hatch, r, { taperStart: 0.08, taperEnd: 0.75, minFrac: 0.2 });
      } else ink(ctx, wobble(r, [[x, yTop - U * 0.004], [x + (r() - 0.5) * U * 0.008 + lean * len, yTop + len]], U * 0.002, U * 0.02), U * LINE.hatch, r, { taperStart: 0.03, taperEnd: 0.7, minFrac: 0.2 });
    }
    // Cracks: darker jagged lines a long way down the face.
    for (let k = 0, nc = 2 + Math.floor(r() * 3); k < nc; k++) {
      const t = lerp(t0, t1, 0.1 + r() * 0.8);
      const x = x0 + W * t;
      const yTop = yAt(edge, x);
      if (yTop === null) continue;
      const pts: Pt[] = [[x, yTop]];
      const dx = (r() - 0.5) * U * 0.03;
      const d = heightAt(t) * (0.55 + r() * 0.35);
      displace(r, [x, yTop], [x + dx + lean * d, yTop + d], 0.25, 3, pts);
      ink(ctx, pts, U * LINE.ridge * 0.9, r, { taperStart: 0.05, taperEnd: 0.7 });
    }
    // Ledges and rock layers partway down.
    for (let l = 0, nl = 1 + Math.floor(r() * 3); l < nl; l++) {
      const a = lerp(t0, t1, r() * 0.6);
      const b = Math.min(t1, a + (t1 - t0) * (0.12 + r() * 0.3));
      const depthAt = 0.25 + r() * 0.35;
      const pts: Pt[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = lerp(a, b, k / 6);
        const yTop = yAt(edge, x0 + W * t);
        const d = heightAt(t) * depthAt;
        if (yTop !== null) pts.push([x0 + W * t + lean * d, yTop + d + (r() - 0.5) * U * 0.004]);
      }
      if (pts.length > 2) ink(ctx, pts, U * LINE.lit * 1.3, r, { taperStart: 0.25, taperEnd: 0.25 });
    }
    ctx.restore();
    // The rim, thinning out to nothing at each end.
    ink(ctx, edge, U * LINE.outline, r, { taperStart: 0.1, taperEnd: 0.1, minFrac: 0.05 });
    // Loose rock at the foot, more below the taller parts.
    const count = Math.round((t1 - t0) * (16 + r() * 12) * (W / L));
    for (let k = 0; k < count; k++) {
      const t = lerp(t0, t1, r());
      const x = x0 + W * t;
      const h = heightAt(t);
      if (h < tall * 0.2) continue;
      const big = r() < 0.15;
      const drop = bottomY(x) - topAt(x);
      rocks.push({ x: x + lean * drop + (r() - 0.5) * U * 0.03, y: bottomY(x) - h * 0.05 + U * r() * 0.05, size: U * (big ? 0.022 + r() * 0.012 : 0.006 + r() * 0.012) * (0.7 + (h / tall) * 0.4) });
    }
  }
  drawRocks(ctx, r, rocks, U, c);
}

/**
 * A cliff whose drop faces east (side 1) or west (side -1). The rim runs up and down the page
 * at x = rx, around height cy; the face is seen side on, as a narrow band of strokes running
 * down and out toward the drop.
 */
function sideBody(ctx: CanvasRenderingContext2D, seed: number, c: ArtColors, shape: CliffShape, L: number, side: 1 | -1, rx: number, cy: number) {
  const r = rng(seed);
  const H = L * 0.667;
  const U = L / 0.9;
  ctx.strokeStyle = c.color;
  const bow = (r() - 0.5) * H * 0.04;
  const tilt = (r() - 0.5) * H * 0.06;
  const { tall, heightAt, density } = faceHeights(r, H, shape);
  // Along the rim, t runs from its left end as seen with the drop facing you: the south end
  // of an east-facing cliff, the north end of a west-facing one.
  const yOf = (t: number) => cy + side * (0.5 - t) * L;
  // A face stroke runs from the rim by `d` down the page and SHEAR * d toward the drop.
  const out = (p: Pt, d: number, extra = 0): Pt => [p[0] + side * (SHEAR * d + extra), p[1] + d];
  const rocks: Rock[] = [];
  for (const [t0, t1] of cliffSegments(r, shape)) {
    const N = 24;
    const raw: Pt[] = [];
    for (let k = 0; k <= N; k++) {
      const t = lerp(t0, t1, k / N);
      raw.push([rx + side * (bow * Math.sin(Math.PI * t) + tilt * (t - 0.5)) + (r() - 0.5) * H * 0.025, yOf(t)]);
    }
    const edge = chaikin(raw, 2);
    const tOf = (p: Pt) => 0.5 - (p[1] - cy) / (side * L);
    // The face's band hides what is behind and clips the strokes.
    const feet = edge.map((p) => out(p, heightAt(tOf(p)) * 1.1 + U * 0.03));
    const area = pathOf([...edge, ...feet.reverse()], true);
    clearShape(ctx, area, c.fill);
    ctx.save();
    ctx.clip(area);
    const tl = Math.min(t0, t1);
    const tr = Math.max(t0, t1);
    const fadeAt = (t: number) => Math.min(1, Math.min(t - tl, tr - t) / 0.07);
    const rimAt = (t: number): Pt => {
      const y = yOf(t);
      let best = edge[0];
      for (const p of edge) if (Math.abs(p[1] - y) < Math.abs(best[1] - y)) best = p;
      return [best[0], y];
    };
    // Strokes are parallel, so along the rim they are set further apart than across a face.
    const gapT = (LINE.hatchGap * U * Math.hypot(1, SHEAR)) / SHEAR / L;
    for (let t = tl; t < tr; t += gapT * (0.55 + 1.4 * (1 - density(t))) * (0.85 + r() * 0.3)) {
      if (density(t) < 0.22 && r() < 0.5) continue;
      if (r() > fadeAt(t) * 0.9 + 0.1) continue;
      const h = heightAt(t);
      if (h <= 0) continue;
      const p = rimAt(t);
      const len = h * (0.65 + r() * 0.45) * (0.6 + 0.4 * fadeAt(t));
      ink(ctx, wobble(r, [out(p, -U * 0.004), out(p, len, (r() - 0.5) * U * 0.008)], U * 0.002, U * 0.02), U * LINE.hatch, r, { taperStart: 0.03, taperEnd: 0.7, minFrac: 0.2 });
    }
    // Cracks.
    for (let k = 0, nc = 1 + Math.floor(r() * 3); k < nc; k++) {
      const t = lerp(t0, t1, 0.1 + r() * 0.8);
      const p = rimAt(t);
      const pts: Pt[] = [p];
      displace(r, p, out(p, heightAt(t) * (0.55 + r() * 0.35)), 0.25, 3, pts);
      ink(ctx, pts, U * LINE.ridge * 0.9, r, { taperStart: 0.05, taperEnd: 0.7 });
    }
    // Ledges: lines along the face partway down.
    for (let l = 0, nl = 1 + Math.floor(r() * 2); l < nl; l++) {
      const a = lerp(t0, t1, r() * 0.6);
      const b = Math.min(t1, a + (t1 - t0) * (0.12 + r() * 0.3));
      const depthAt = 0.25 + r() * 0.35;
      const pts: Pt[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = lerp(a, b, k / 6);
        const q = out(rimAt(t), heightAt(t) * depthAt);
        pts.push([q[0] + (r() - 0.5) * U * 0.004, q[1]]);
      }
      ink(ctx, pts, U * LINE.lit * 1.3, r, { taperStart: 0.25, taperEnd: 0.25 });
    }
    ctx.restore();
    ink(ctx, edge, U * LINE.outline, r, { taperStart: 0.1, taperEnd: 0.1, minFrac: 0.05 });
    // Loose rock at the foot, on the low side.
    const count = Math.round((t1 - t0) * (12 + r() * 9));
    for (let k = 0; k < count; k++) {
      const t = lerp(t0, t1, r());
      const h = heightAt(t);
      if (h < tall * 0.2) continue;
      const big = r() < 0.15;
      const f = out(rimAt(t), h * 1.05, U * r() * 0.03);
      rocks.push({ x: f[0], y: f[1] + (r() - 0.5) * U * 0.03, size: U * (big ? 0.02 + r() * 0.01 : 0.006 + r() * 0.012) * (0.7 + (h / tall) * 0.4) });
    }
  }
  drawRocks(ctx, r, rocks, U, c);
}

/** A cliff whose drop faces away from the viewer (N), or slants away (NE, NW): the face is hidden behind the rim. */
function awayBody(ctx: CanvasRenderingContext2D, seed: number, c: ArtColors, shape: CliffShape, g: RimSpec) {
  const r = rng(seed);
  const { L, x0, W, cy, rise, lean } = g;
  const H = L * 0.667;
  const U = L / 0.9;
  ctx.strokeStyle = c.color;
  const bow = (r() - 0.5) * H * 0.1;
  const tilt = (r() - 0.5) * H * 0.08 + rise;
  for (const [t0, t1] of cliffSegments(r, shape)) {
    const edge = cliffEdge(r, W, H, cy, t0, t1, bow, tilt, x0);
    const first = edge[0];
    const last = edge[edge.length - 1];
    // The high ground on the near side of the rim hides whatever is behind it.
    const near = (p: Pt) => (rise ? p[1] : cy) + H * 0.18;
    clearShape(ctx, pathOf([...edge, [last[0], near(last)], [first[0], near(first)]], true), c.fill);
    // Beyond the rim: short strokes where the ground falls away out of sight.
    ctx.save();
    ctx.clip(pathOf([...edge, [last[0], -L], [first[0], -L]], true));
    for (let x = first[0] + U * 0.004; x < last[0] - U * 0.004; x += U * LINE.hatchGap * 1.8 * (0.7 + r() * 0.6)) {
      const y = yAt(edge, x);
      if (y === null) continue;
      const fade = Math.min(1, Math.min(x - first[0], last[0] - x) / (U * 0.07));
      if (r() > fade * 0.9 + 0.1) continue;
      const len = U * (0.016 + r() * 0.026) * (0.6 + 0.4 * fade);
      ink(ctx, [[x, y - U * 0.004], [x + (r() - 0.5) * U * 0.006 + lean * len, y - len]], U * LINE.lit, r, { taperStart: 0.05, taperEnd: 0.7 });
    }
    ctx.restore();
    // The lip: a thin line just on the near side of the rim, broken into blocks with short joints.
    const lip: Pt[] = edge.map(([x, y]) => [x, y + U * (0.014 + r() * 0.006)]);
    let k = 0;
    while (k < lip.length - 2) {
      const len = 3 + Math.floor(r() * 6);
      const run = lip.slice(k, Math.min(lip.length, k + len));
      if (r() < 0.75 && run.length > 1) {
        ink(ctx, run, U * LINE.lit * 1.2, r, { taperStart: 0.15, taperEnd: 0.15 });
        const [jx, jy] = run[run.length - 1];
        const ey = yAt(edge, jx);
        if (ey !== null) ink(ctx, [[jx, ey], [jx + U * 0.002, jy + U * 0.004]], U * LINE.lit, r, { taperStart: 0.1, taperEnd: 0.1 });
      }
      k += len + 1 + Math.floor(r() * 2);
    }
    // A tapering cliff's rim fades out over most of its length toward that end, as the drop dies away.
    ink(ctx, edge, U * LINE.outline, r, { taperStart: shape === 'taper-left' ? 0.7 : 0.1, taperEnd: shape === 'taper-right' ? 0.7 : 0.1, minFrac: 0.05 });
  }
}
