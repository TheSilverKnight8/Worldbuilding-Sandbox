import { LEAN, SHEAR, type Dir, type Frame } from './cliff';
import { LINE, chaikin, clearShape, ink, lerp, pathOf, rng, wobble, yAt, type ArtColors, type Pt, type Rng } from './ink';

// Waterfalls (Stage 5), in the same ink style as the terrain, one drawing per compass direction
// (the way the water falls), matching the cliffs: never turned, since a falling sheet always
// hangs straight down the page.
//
// S, SE, SW: a rocky lip, a sheet of water falling between hatched rock, and spray and ripples
//   in the pool below. On SE and SW the lip slants and the water leans a little toward the drop.
// E, W: seen side on: the water pours out over the lip and arcs down toward the drop.
// N, NE, NW: the water goes over the far side of the rim, out of sight: the lip, the water
//   running to it, and mist rising beyond.
// The water is drawn over the river it falls from, so it hides the river's line there.

const D = Math.SQRT1_2;

/** The box of each direction's drawing, in units of the waterfall's width (see cliffFrame). */
export function waterfallFrame(dir: Dir): Frame {
  switch (dir) {
    case 4:
      return { w: 1, h: 1.1, ax: 0.5, ay: 0.22 };
    case 3:
      return { w: D + 0.09, h: 1.6, ax: D / 2, ay: 0.36 };
    case 5:
      return { w: D + 0.09, h: 1.6, ax: 0.09 + D / 2, ay: 0.36 };
    case 2:
      return { w: 0.62, h: 1.62, ax: 0.06, ay: 0.5 };
    case 6:
      return { w: 0.62, h: 1.62, ax: 0.56, ay: 0.5 };
    case 0:
      return { w: 1, h: 0.6, ax: 0.5, ay: 0.42 };
    case 1:
      return { w: D + 0.05, h: 0.92, ax: D / 2, ay: 0.45 };
    case 7:
      return { w: D + 0.05, h: 0.92, ax: 0.05 + D / 2, ay: 0.45 };
  }
}

/**
 * A waterfall falling toward `dir`, L wide (its size), in the box waterfallFrame(dir) gives;
 * `water` is the falling water's color. `river` fills the river's last stretch before a lip
 * facing away: null leaves it see-through, so the map's own river shows.
 */
export function waterfall(ctx: CanvasRenderingContext2D, seed: number, L: number, c: ArtColors, water: string, dir: Dir, river: string | null = null) {
  const f = waterfallFrame(dir);
  switch (dir) {
    case 4:
      return fallFacing(ctx, seed, c, water, { L, x0: 0, W: L, lipY: L * f.ay, slope: 0, lean: 0 });
    case 3:
      return fallFacing(ctx, seed, c, water, { L, x0: 0, W: L * D, lipY: L * f.ay, slope: -1, lean: LEAN });
    case 5:
      return fallFacing(ctx, seed, c, water, { L, x0: L * 0.09, W: L * D, lipY: L * f.ay, slope: 1, lean: -LEAN });
    case 2:
      return fallSide(ctx, seed, c, water, L, 1, L * f.ax, L * f.ay);
    case 6:
      return fallSide(ctx, seed, c, water, L, -1, L * f.ax, L * f.ay);
    case 0:
      return fallAway(ctx, seed, c, water, river, { L, x0: 0, W: L, lipY: L * f.ay, slope: 0, lean: 0 });
    case 1:
      return fallAway(ctx, seed, c, water, river, { L, x0: 0, W: L * D, lipY: L * f.ay, slope: 1, lean: 0.5 });
    case 7:
      return fallAway(ctx, seed, c, water, river, { L, x0: L * 0.05, W: L * D, lipY: L * f.ay, slope: -1, lean: -0.5 });
  }
}

/**
 * Where a lip runs across a drawing: from x0 + 0.06 W to x0 + 0.94 W, through (x0 + W/2, lipY),
 * rising or falling by `slope` (down per across); `lean` tilts the falling water.
 */
interface LipSpec {
  L: number;
  x0: number;
  W: number;
  lipY: number;
  slope: number;
  lean: number;
}

/** Spray where the water lands: small round puffs. */
function spray(ctx: CanvasRenderingContext2D, r: Rng, x: number, y: number, rad: number, U: number, water: string) {
  const pts: Pt[] = [];
  for (let a = 0; a <= 20; a++) {
    const t = Math.PI + (a / 20) * Math.PI;
    pts.push([x + Math.cos(t) * rad, y + Math.sin(t) * rad * 0.8]);
  }
  clearShape(ctx, pathOf([...pts, [x + rad, y + rad * 0.3], [x - rad, y + rad * 0.3]], true), water);
  ink(ctx, pts, U * LINE.lit, r, { taperStart: 0.2, taperEnd: 0.2 });
}

/** Falling toward the viewer (S), or slanting toward the viewer (SE, SW). */
function fallFacing(ctx: CanvasRenderingContext2D, seed: number, c: ArtColors, water: string, g: LipSpec) {
  const r = rng(seed);
  const { L, x0, W, lipY, slope, lean } = g;
  const H = L * 1.1;
  // Lines as on a cliff about two and a half times as wide.
  const U = L * 2.6;
  ctx.strokeStyle = c.color;
  const fall = H * (0.6 + r() * 0.05);
  const half = W * (0.2 + r() * 0.06);
  const xc = x0 + W * 0.5;
  const cx = xc + (r() - 0.5) * W * 0.04;
  // The lip's line, and the foot of the drop below it.
  const base = (x: number) => lipY + slope * (x - xc);
  const footAt = (x: number) => base(x) + fall;
  const lf = lean * fall;
  // The rock on each side of the fall: a short face, hatched, fading out sideways.
  const lip: Pt[] = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const x = x0 + lerp(W * 0.06, W * 0.94, t);
    lip.push([x, base(x) + Math.sin(t * Math.PI) * -H * 0.02 + (r() - 0.5) * H * 0.015]);
  }
  const rim = chaikin(lip, 2);
  // The rock face narrows toward the foot, so it reads as the head of a drop rather than a box.
  const footHalf = half * 1.6;
  const xR = x0 + W * 0.94;
  const xL = x0 + W * 0.06;
  const sideR = chaikin([[xR, rim[rim.length - 1][1]], [x0 + W * 0.9 + lf * 0.55, base(x0 + W * 0.9) + fall * 0.55], [cx + footHalf + lf, footAt(cx + footHalf)]], 2);
  const sideL = chaikin([[cx - footHalf + lf, footAt(cx - footHalf)], [x0 + W * 0.1 + lf * 0.55, base(x0 + W * 0.1) + fall * 0.55], [xL, rim[0][1]]], 2);
  const face = pathOf([...rim, ...sideR, ...sideL], true);
  clearShape(ctx, face, c.fill);
  ctx.save();
  ctx.clip(face);
  for (let x = xL; x < xR; x += U * LINE.hatchGap * (0.9 + r() * 0.4)) {
    if (Math.abs(x - cx) < half * 1.05) continue;
    const top = yAt(rim, x);
    if (top === null) continue;
    const fade = Math.min(1, Math.min(x - xL, xR - x) / (W * 0.14));
    if (r() > fade * 0.9 + 0.1) continue;
    const len = (footAt(x) - top) * (0.55 + r() * 0.4) * (0.6 + 0.4 * fade);
    ink(ctx, wobble(r, [[x, top], [x + (r() - 0.5) * U * 0.004 + lean * len, top + len]], U * 0.002, U * 0.02), U * LINE.hatch, r, { taperStart: 0.03, taperEnd: 0.6, minFrac: 0.3 });
  }
  ctx.restore();
  ink(ctx, rim, U * LINE.outline * 0.8, r, { taperStart: 0.12, taperEnd: 0.12, minFrac: 0.05 });
  // The falling water: a sheet, a little wider at the bottom, with long wavering strokes.
  const yl = base(cx - half);
  const yr = base(cx + half);
  const sheetL: Pt[] = [
    [cx - half, yl - H * 0.01],
    [cx - half * 1.05 + lf * 0.5, yl + fall * 0.5],
    [cx - half * 1.15 + lf, yl + fall + H * 0.02],
  ];
  const sheetR: Pt[] = [
    [cx + half, yr - H * 0.01],
    [cx + half * 1.05 + lf * 0.5, yr + fall * 0.5],
    [cx + half * 1.15 + lf, yr + fall + H * 0.02],
  ];
  const sheet = pathOf([...sheetL, ...[...sheetR].reverse()], true);
  clearShape(ctx, sheet, water);
  ctx.save();
  ctx.clip(sheet);
  const n = 5 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const xs = lerp(cx - half, cx + half, t);
    const b0 = base(xs);
    const start = b0 + r() * 0.25 * fall;
    const end = Math.min(start + fall * (0.35 + r() * 0.5), b0 + fall);
    ink(ctx, wobble(r, [[xs + lean * (start - b0), start], [xs + (t - 0.5) * half * 0.3 + lean * (end - b0), end]], U * 0.003, U * 0.015), U * LINE.lit, r, { taperStart: 0.2, taperEnd: 0.4 });
  }
  ctx.restore();
  // The sheet's edges: thin, broken.
  ink(ctx, chaikin(sheetL, 2), U * LINE.lit * 1.1, r, { taperStart: 0.1, taperEnd: 0.5 });
  ink(ctx, chaikin(sheetR, 2), U * LINE.lit * 1.1, r, { taperStart: 0.1, taperEnd: 0.5 });
  // Spray where it lands, then ripples spreading in the pool, along the cliff's foot.
  for (let k = 0; k < 5; k++) {
    const x = cx + (r() - 0.5) * half * 2.4;
    const y = footAt(x) + H * (0.01 + r() * 0.04);
    spray(ctx, r, x + lf, y, L * (0.035 + r() * 0.03), U, water);
  }
  for (let k = 0; k < 3; k++) {
    if (!slope) {
      const y = footAt(cx) + H * (0.07 + k * 0.035);
      const w = half * (1.6 + k * 0.6);
      ink(ctx, chaikin([[cx - w + lf, y], [cx + lf, y + H * 0.008], [cx + w + lf, y]], 2), U * LINE.lit * 0.9, r, { taperStart: 0.35, taperEnd: 0.35 });
      continue;
    }
    // On a slanting cliff the ripples spread the way the water falls, along the cliff's foot.
    const out = H * (0.07 + k * 0.035) * D;
    const ox = cx + lf + Math.sign(lean) * out;
    const oy = footAt(cx) + out;
    const w = half * (0.6 + k * 0.3);
    ink(ctx, chaikin([[ox - w, oy - slope * w], [ox + Math.sign(lean) * H * 0.006, oy + H * 0.006], [ox + w, oy + slope * w]], 2), U * LINE.lit * 0.9, r, { taperStart: 0.35, taperEnd: 0.35 });
  }
}

/**
 * Falling toward the east (side 1) or west (side -1), seen side on. The lip runs up and down
 * the page at x = rx around height cy; the water pours out over it and arcs down toward the drop.
 */
function fallSide(ctx: CanvasRenderingContext2D, seed: number, c: ArtColors, water: string, L: number, side: 1 | -1, rx: number, cy: number) {
  const r = rng(seed);
  const H = L * 1.1;
  const U = L * 2.6;
  ctx.strokeStyle = c.color;
  const fall = H * (0.6 + r() * 0.05);
  const half = L * (0.2 + r() * 0.06);
  const cyc = cy + (r() - 0.5) * L * 0.04;
  // Down the rock face: d down the page and SHEAR * d toward the drop (as on the cliffs).
  const out = (p: Pt, d: number): Pt => [p[0] + side * SHEAR * d, p[1] + d];
  const reach = SHEAR * fall;
  // The water's path from the lip: out toward the drop at first, then down (s from 0 to 1).
  const arc = (y0: number, s: number, widen = 0): Pt => [rx + side * reach * s, y0 + fall * s * s + widen * s];
  // The rim, bowing a little toward the high ground.
  const lip: Pt[] = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    lip.push([rx - side * Math.sin(t * Math.PI) * H * 0.02 + (r() - 0.5) * H * 0.015, lerp(cy - L * 0.44, cy + L * 0.44, t)]);
  }
  const rim = chaikin(lip, 2);
  const top = rim[0];
  const bottom = rim[rim.length - 1];
  // The rock face, narrowing toward the foot.
  const footHalf = half * 1.3;
  const lower = chaikin([bottom, out([rx, cy + L * 0.4], fall * 0.55), out([rx, cyc + footHalf], fall)], 2);
  const upper = chaikin([out([rx, cyc - footHalf], fall), out([rx, cy - L * 0.4], fall * 0.55), top], 2);
  const face = pathOf([...rim, ...lower, ...upper], true);
  clearShape(ctx, face, c.fill);
  ctx.save();
  ctx.clip(face);
  const step = (LINE.hatchGap * U * Math.hypot(1, SHEAR)) / SHEAR;
  for (let y = top[1]; y < bottom[1]; y += step * (0.9 + r() * 0.4)) {
    if (Math.abs(y - cyc) < half * 1.05) continue;
    const fade = Math.min(1, Math.min(y - top[1], bottom[1] - y) / (L * 0.14));
    if (r() > fade * 0.9 + 0.1) continue;
    let best = rim[0];
    for (const p of rim) if (Math.abs(p[1] - y) < Math.abs(best[1] - y)) best = p;
    const len = fall * (0.55 + r() * 0.4) * (0.6 + 0.4 * fade);
    ink(ctx, wobble(r, [[best[0], y], out([best[0] + (r() - 0.5) * U * 0.004, y], len)], U * 0.002, U * 0.02), U * LINE.hatch, r, { taperStart: 0.03, taperEnd: 0.6, minFrac: 0.3 });
  }
  ctx.restore();
  ink(ctx, rim, U * LINE.outline * 0.8, r, { taperStart: 0.12, taperEnd: 0.12, minFrac: 0.05 });
  // The water: swept from the lip along its arc, a little wider at the bottom.
  const N = 16;
  const edgeA: Pt[] = [];
  const edgeB: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    const s = k / N;
    edgeA.push(arc(cyc - half, s, -half * 0.15));
    edgeB.push(arc(cyc + half, s, half * 0.15));
  }
  const sheet = pathOf([...edgeA, ...[...edgeB].reverse()], true);
  clearShape(ctx, sheet, water);
  ctx.save();
  ctx.clip(sheet);
  const n = 5 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const y0 = lerp(cyc - half, cyc + half, t);
    const s0 = r() * 0.25;
    const s1 = Math.min(1, s0 + 0.35 + r() * 0.5);
    const pts: Pt[] = [];
    for (let j = 0; j <= 8; j++) pts.push(arc(y0, lerp(s0, s1, j / 8), (t - 0.5) * half * 0.3));
    ink(ctx, wobble(r, pts, U * 0.002, U * 0.015), U * LINE.lit, r, { taperStart: 0.2, taperEnd: 0.4 });
  }
  ctx.restore();
  ink(ctx, edgeA, U * LINE.lit * 1.1, r, { taperStart: 0.1, taperEnd: 0.5 });
  ink(ctx, edgeB, U * LINE.lit * 1.1, r, { taperStart: 0.1, taperEnd: 0.5 });
  // Spray where it lands, then ripples spreading out on the low side.
  const fx = rx + side * reach;
  for (let k = 0; k < 5; k++) {
    const y = cyc + fall + (r() - 0.5) * half * 2.2;
    spray(ctx, r, fx + side * L * (r() * 0.05), y + H * 0.02, L * (0.035 + r() * 0.03), U, water);
  }
  for (let k = 0; k < 3; k++) {
    const x = fx + side * L * (0.08 + k * 0.045);
    const w = half * (0.8 + k * 0.3);
    const y = cyc + fall + H * 0.02;
    ink(ctx, chaikin([[x, y - w], [x + side * H * 0.012, y], [x, y + w]], 2), U * LINE.lit * 0.9, r, { taperStart: 0.35, taperEnd: 0.35 });
  }
}

/** Falling away from the viewer (N), or slanting away (NE, NW): the water goes over the far side of the rim, with mist rising beyond. */
function fallAway(ctx: CanvasRenderingContext2D, seed: number, c: ArtColors, water: string, river: string | null, g: LipSpec) {
  const r = rng(seed);
  const { L, x0, W, lipY, slope, lean } = g;
  const H = L * 1.1;
  const U = L * 2.6;
  ctx.strokeStyle = c.color;
  const half = W * (0.2 + r() * 0.06);
  const xc = x0 + W * 0.5;
  const cx = xc + (r() - 0.5) * W * 0.04;
  const base = (x: number) => lipY + slope * (x - xc);
  const xL = x0 + W * 0.06;
  const xR = x0 + W * 0.94;
  const lip: Pt[] = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const x = lerp(xL, xR, t);
    lip.push([x, base(x) + Math.sin(t * Math.PI) * H * 0.012 + (r() - 0.5) * H * 0.012]);
  }
  const rim = chaikin(lip, 2);
  const first = rim[0];
  const last = rim[rim.length - 1];
  const nearBy = L * 0.12;
  // The high ground on the near side hides what is behind it; the river runs across it to the lip.
  clearShape(ctx, pathOf([...rim, [last[0], last[1] + nearBy], [first[0], first[1] + nearBy]], true), c.fill);
  const riverTop = rim.filter(([x]) => Math.abs(x - cx) <= half);
  if (riverTop.length > 1) {
    const a = riverTop[0];
    const b = riverTop[riverTop.length - 1];
    clearShape(ctx, pathOf([...riverTop, [b[0], b[1] + nearBy * 1.2], [a[0], a[1] + nearBy * 1.2]], true), river);
  }
  // Beyond the rim, away from the water: short strokes where the ground falls away out of sight.
  ctx.save();
  ctx.clip(pathOf([...rim, [last[0], -L], [first[0], -L]], true));
  for (let x = xL + U * 0.004; x < xR - U * 0.004; x += U * LINE.hatchGap * 1.8 * (0.7 + r() * 0.6)) {
    if (Math.abs(x - cx) < half * 1.3) continue;
    const y = yAt(rim, x);
    if (y === null) continue;
    const fade = Math.min(1, Math.min(x - xL, xR - x) / (W * 0.14));
    if (r() > fade * 0.9 + 0.1) continue;
    const len = U * (0.007 + r() * 0.011) * (0.6 + 0.4 * fade);
    ink(ctx, [[x, y - U * 0.002], [x + (r() - 0.5) * U * 0.003 + lean * len, y - len]], U * LINE.lit, r, { taperStart: 0.05, taperEnd: 0.7 });
  }
  ctx.restore();
  // Mist rising from below the drop, drifting a little toward it.
  const puffs: { x: number; y: number; rad: number }[] = [];
  for (let k = 0, n = 8 + Math.floor(r() * 4); k < n; k++) {
    const rise = H * (0.02 + r() * 0.17);
    // Wider low down, narrowing as it rises.
    const spread = half * (2.4 - (rise / H) * 5);
    puffs.push({ x: cx + (r() - 0.5) * spread + lean * rise, y: base(cx) - rise, rad: L * (0.045 + r() * 0.045) * (1 - (rise / H) * 1.5) });
  }
  puffs.sort((p, q) => p.y - q.y);
  for (const p of puffs) spray(ctx, r, p.x, p.y, p.rad, U, water);
  // The rim on each side of the water, and the water's own edge where it goes over.
  const leftRock = rim.filter(([x]) => x < cx - half);
  const rightRock = rim.filter(([x]) => x > cx + half);
  if (leftRock.length > 1) ink(ctx, leftRock, U * LINE.outline * 0.65, r, { taperStart: 0.5, taperEnd: 0.35, minFrac: 0.05 });
  if (rightRock.length > 1) ink(ctx, rightRock, U * LINE.outline * 0.65, r, { taperStart: 0.35, taperEnd: 0.5, minFrac: 0.05 });
  if (riverTop.length > 1) ink(ctx, riverTop, U * LINE.lit * 1.3, r, { taperStart: 0.15, taperEnd: 0.15 });
  // The water's surface quickening toward the edge.
  for (let k = 0; k < 4; k++) {
    const x = lerp(cx - half * 0.75, cx + half * 0.75, (k + 0.5) / 4);
    const y = base(x);
    ink(ctx, [[x, y + H * (0.05 + r() * 0.03)], [x + (r() - 0.5) * U * 0.002, y + H * 0.012]], U * LINE.lit * 0.8, r, { taperStart: 0.4, taperEnd: 0.2 });
  }
}
