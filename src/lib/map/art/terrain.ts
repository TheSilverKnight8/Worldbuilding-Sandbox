import { LINE, chaikin, clearShape, displace, hatch, ink, lerp, litStrokes, pathOf, rng, slope, type ArtColors, type Pt, type Rng } from './ink';

// Terrain icons in the style of the bonus art pack for Nortantis (our own drawing code; the
// pack was only a style reference): bold, slightly uneven ink outlines open at the bottom,
// rounded tips, hatching on the shaded right faces and loose strokes on the lit left faces.
// Each draws into a W x H box with its ground line near the bottom.

const pick = <T,>(r: Rng, items: T[], weights: number[]): T => {
  let x = r() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) if ((x -= weights[i]) <= 0) return items[i];
  return items[items.length - 1];
};

interface PeakSpec {
  ax: number;
  ay: number;
  lx: number;
  rx: number;
}

/** One peak: apex (ax, ay); its slopes reach the ground (y = base) at lx and rx. */
function peak(ctx: CanvasRenderingContext2D, r: Rng, p: PeakSpec, base: number, U: number, c: ArtColors, spire: boolean) {
  const { ax, ay, lx, rx } = p;
  const tip = U * (spire ? 0.026 : 0.034);
  const jag = spire ? 0.7 : 0.8 + r() * 0.5;
  const left = chaikin([[ax, ay - tip * 0.2], ...slope(r, [ax - tip * 0.55, ay + tip * 0.45], [lx, base], jag)], 3);
  const right = chaikin([[ax, ay - tip * 0.2], ...slope(r, [ax + tip * 0.55, ay + tip * 0.45], [rx, base], jag)], 3);
  const body = pathOf([[left[left.length - 1][0], base + U * 0.02], ...[...left].reverse(), ...right, [right[right.length - 1][0], base + U * 0.02]], true);
  clearShape(ctx, body, c.fill);
  const ridgeEnd: Pt = [ax + (rx - ax) * (0.08 + r() * 0.3), lerp(ay, base, 0.65 + r() * 0.3)];
  const ridge = chaikin(slope(r, [ax, ay + tip * 0.3], ridgeEnd, 0.9), 3);
  const face = pathOf([[ax, ay], ...right, [ridgeEnd[0], base + U * 0.02], ...[...ridge].reverse()], true);
  ctx.save();
  ctx.clip(body);
  ctx.strokeStyle = c.color;
  hatch(ctx, r, face, right, ax - U * 0.03, rx + U * 0.03, base, U, { slant: ((rx - ax) / (base - ay)) * 0.25, extra: [ridge] });
  litStrokes(ctx, r, body, left, 4 + Math.floor(r() * 8), base, (lx - ax) / (base - ay), U);
  ctx.restore();
  ctx.strokeStyle = c.color;
  ink(ctx, ridge, U * LINE.ridge, r, { taperStart: 0.05, taperEnd: 0.6 });
  ink(ctx, [...left].reverse().concat(right.slice(1)), U * LINE.outline, r, { taperStart: 0.1, taperEnd: 0.1, minFrac: 0.2 });
}

/**
 * A mountain: a main peak, one to three lower peaks behind it and two to four small ones in
 * front. Broad, with slopes no steeper than about 50 degrees, and varying in height. `spires`
 * gives narrow needle peaks instead. Drawn W wide and H tall (H about 0.75 W).
 */
export function mountain(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: ArtColors, spire = false) {
  const r = rng(seed);
  const U = W;
  const base = H * 0.97;
  const peaks: PeakSpec[] = [];
  // Keep a peak inside the box by moving it inward, not by cutting its slopes off.
  const add = (x: number, top: number, hwL: number, hwR: number) => {
    const ax = Math.max(W * 0.02 + hwL * 0.8, Math.min(W * 0.98 - hwR * 0.8, x));
    peaks.push({ ax, ay: top, lx: Math.max(W * 0.02, ax - hwL), rx: Math.min(W * 0.98, ax + hwR) });
  };
  const mx = W * (0.42 + r() * 0.16);
  const halfW = W * (spire ? 0.32 : 0.4 + r() * 0.07);
  const mainH = spire ? base - H * 0.03 : Math.min(base - H * 0.04, halfW * (0.85 + r() * 0.3) * (0.78 + r() * 0.4));
  const mainTop = base - mainH;
  const nBack = 1 + Math.floor(r() * 3);
  for (let k = 0; k < nBack; k++) {
    const x = mx + (k % 2 ? -1 : 1) * W * (0.16 + r() * 0.2);
    const top = lerp(mainTop, base, 0.2 + r() * 0.3);
    const hw = (base - top) * (spire ? 0.55 : 1.1 + r() * 0.4);
    add(x, top, hw, hw);
  }
  peaks.push({ ax: mx, ay: mainTop, lx: mx - halfW * (0.9 + r() * 0.2), rx: mx + halfW * (0.9 + r() * 0.2) });
  const nFront = 2 + Math.floor(r() * (spire ? 2 : 3));
  for (let k = 0; k < nFront; k++) {
    const x = mx + (r() - 0.5) * W * 0.6;
    const top = lerp(mainTop, base, 0.35 + r() * 0.35);
    const hw = (base - top) * (spire ? 0.5 : 1.0 + r() * 0.5);
    add(x, top, hw * (0.85 + r() * 0.3), hw * (0.85 + r() * 0.3));
  }
  for (const p of peaks) peak(ctx, r, p, base, U, c, spire);
}

interface Crest {
  t: number;
  a: number;
  w: number;
}

interface MoundSpec {
  cx: number;
  h: number;
  hwL: number;
  hwR: number;
  sharp: number;
  crests: Crest[];
}

/** One hill shape: a low rise with gentle slopes and an uneven crest (one or more bumps). */
function mound(ctx: CanvasRenderingContext2D, r: Rng, p: MoundSpec, base: number, U: number, c: ArtColors) {
  const { cx, h, hwL, hwR, sharp, crests } = p;
  const raw: Pt[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n;
    let f = Math.pow(Math.cos((Math.abs(t) * Math.PI) / 2), sharp);
    for (const k of crests) f += k.a * Math.exp(-(((t - k.t) / k.w) ** 2));
    raw.push([t, f]);
  }
  const max = Math.max(...raw.map((q) => q[1]));
  const pts: Pt[] = raw.map(([t, f], i) => [cx + t * (t < 0 ? hwL : hwR), base - (h * Math.max(0, f)) / max + (i > 0 && i < n ? (r() - 0.5) * h * 0.04 : 0)]);
  const outline = chaikin(pts, 2);
  const body = pathOf([[cx - hwL, base + U * 0.02], ...outline, [cx + hwR, base + U * 0.02]], true);
  clearShape(ctx, body, c.fill);
  let ti = 0;
  for (let i = 1; i < outline.length; i++) if (outline[i][1] < outline[ti][1]) ti = i;
  const crest = outline[ti];
  const right = outline.slice(ti);
  const ridgeEnd: Pt = [crest[0] + hwR * (0.2 + r() * 0.25), base - h * (0.05 + r() * 0.1)];
  const ridge = chaikin(slope(r, [crest[0] + hwR * 0.04, crest[1] + h * 0.15], ridgeEnd, 0.6), 3);
  const face = pathOf([crest, ...right, [ridgeEnd[0], base + U * 0.02], ...[...ridge].reverse()], true);
  ctx.save();
  ctx.clip(body);
  ctx.strokeStyle = c.color;
  hatch(ctx, r, face, right, crest[0], cx + hwR + U * 0.02, base, U, { slant: 0.2, minLen: 0.5, extra: [ridge] });
  litStrokes(ctx, r, body, outline.slice(0, ti + 1), 1 + Math.floor(r() * 3), base, -0.6, U);
  ctx.restore();
  ctx.strokeStyle = c.color;
  if (r() < 0.7) ink(ctx, ridge, U * LINE.ridge, r, { taperStart: 0.1, taperEnd: 0.6 });
  ink(ctx, outline, U * LINE.outline, r, { taperStart: 0.12, taperEnd: 0.12, minFrac: 0.2 });
}

/** A hill: a knoll, a double crest, a long low ridge, or a small cluster. Low and broad. Drawn W wide and H tall (H about 0.6 W). */
export function hill(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: ArtColors) {
  const r = rng(seed);
  const U = W / 0.5;
  const base = H * 0.95;
  const type = pick(r, ['knoll', 'double', 'ridge', 'cluster'], [0.3, 0.25, 0.25, 0.2]);
  const shape = (cx: number, h: number, hw: number, crests: Crest[]): MoundSpec => ({ cx, h, hwL: hw * (0.75 + r() * 0.5), hwR: hw * (0.75 + r() * 0.5), sharp: 0.85 + r() * 0.5, crests });
  const list: MoundSpec[] = [];
  if (type === 'knoll') list.push(shape(W * (0.42 + r() * 0.16), H * (0.38 + r() * 0.2), W * (0.36 + r() * 0.1), [{ t: (r() - 0.5) * 0.6, a: 0.08 + r() * 0.12, w: 0.45 }]));
  else if (type === 'double')
    list.push(
      shape(W * 0.5, H * (0.4 + r() * 0.22), W * (0.4 + r() * 0.06), [
        { t: -0.35 - r() * 0.15, a: 0.25 + r() * 0.15, w: 0.32 },
        { t: 0.3 + r() * 0.2, a: 0.15 + r() * 0.2, w: 0.3 },
      ]),
    );
  else if (type === 'ridge') {
    const crests: Crest[] = [];
    for (let k = 0, n = 2 + Math.floor(r() * 2); k < n; k++) crests.push({ t: -0.6 + (1.2 * k) / Math.max(1, n - 1) + (r() - 0.5) * 0.15, a: 0.12 + r() * 0.15, w: 0.3 });
    list.push(shape(W * 0.5, H * (0.3 + r() * 0.15), W * 0.46, crests));
  } else {
    // A small cluster; the big one is last, so it is drawn in front.
    for (let k = 0, n = 2 + Math.floor(r() * 2); k < n; k++) {
      const big = k === n - 1;
      list.push(shape(W * (big ? 0.45 + r() * 0.1 : 0.22 + r() * 0.56), H * (big ? 0.36 + r() * 0.18 : 0.2 + r() * 0.12), W * (big ? 0.32 : 0.2 + r() * 0.06), [{ t: (r() - 0.5) * 0.6, a: 0.08 + r() * 0.12, w: 0.4 }]));
    }
  }
  for (const m of list) mound(ctx, r, m, base, U, c);
}

/**
 * A plateau (mesa or butte): an uneven top (tilted, with dips and knobs), a hatched cliff band
 * of varying depth, sometimes a lower tier on one side, and slopes into the ground. Drawn W
 * wide and H tall (H about 0.55 W).
 */
export function plateau(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: ArtColors) {
  const r = rng(seed);
  const U = W / 1.1;
  const base = H * 0.95;
  const topY = H * (0.12 + r() * 0.3);
  const h = base - topY;
  const span = W * (0.32 + r() * 0.36);
  const cx = W * (0.5 + (r() - 0.5) * 0.12);
  const x0 = cx - span / 2;
  const x1 = cx + span / 2;
  const tilt = (r() - 0.5) * h * 0.16;
  const cliffDepth = h * (0.35 + r() * 0.35);
  const topPts: Pt[] = [[x0, topY - tilt / 2]];
  displace(r, [x0, topY - tilt / 2], [x1, topY + tilt / 2], 0.16, 5, topPts);
  if (r() < 0.55) {
    const at = 0.2 + r() * 0.6;
    const dip = (r() < 0.6 ? 1 : -1) * h * (0.05 + r() * 0.08);
    const wdt = 0.06 + r() * 0.08;
    for (const p of topPts) p[1] += dip * Math.exp(-((((p[0] - x0) / span - at) / wdt) ** 2));
  }
  const top = chaikin(topPts, 3);
  const tier = r() < 0.4 ? (r() < 0.5 ? -1 : 1) : 0;
  const cliffAt = (sy: number) => sy + cliffDepth;
  // A side: a cliff (with a ledge, or a whole lower tier), then a talus slope flaring out.
  const side = (sx: number, sy: number, dir: number) => {
    const pts: Pt[] = [[sx, sy]];
    const cy = cliffAt(sy);
    if (tier === dir) {
      const stepY = lerp(sy, cy, 0.45 + r() * 0.15);
      const stepOut = sx + dir * W * (0.08 + r() * 0.06);
      displace(r, [sx, sy], [sx + dir * W * 0.015, stepY], 0.08, 2, pts);
      displace(r, pts[pts.length - 1], [stepOut, stepY + h * 0.02], 0.15, 2, pts);
      displace(r, pts[pts.length - 1], [stepOut + dir * W * 0.02, cy], 0.1, 2, pts);
    } else {
      const ledge: Pt = [sx + dir * W * (0.01 + r() * 0.02), lerp(sy, cy, 0.4 + r() * 0.25)];
      displace(r, [sx, sy], ledge, 0.1, 2, pts);
      pts.push([ledge[0] + dir * W * (0.015 + r() * 0.025), ledge[1] + h * 0.02]);
      displace(r, pts[pts.length - 1], [pts[pts.length - 1][0] + dir * W * 0.02, cy], 0.1, 2, pts);
    }
    const footX = dir < 0 ? W * (0.02 + r() * 0.08) : W * (0.98 - r() * 0.08);
    displace(r, pts[pts.length - 1], [footX, base], 0.14 + r() * 0.08, 3, pts);
    return chaikin(pts, 2);
  };
  const left = side(top[0][0], top[0][1], -1);
  const right = side(top[top.length - 1][0], top[top.length - 1][1], 1);
  const outline = [...[...left].reverse(), ...top.slice(1, -1), ...right];
  const footL = left[left.length - 1][0];
  const footR = right[right.length - 1][0];
  const body = pathOf([[footL, base + U * 0.02], ...outline, [footR, base + U * 0.02]], true);
  clearShape(ctx, body, c.fill);
  // Where the cliffs meet the talus.
  const fy0 = cliffAt(top[0][1]);
  const fy1 = cliffAt(top[top.length - 1][1]);
  const footPts: Pt[] = [[x0 - W * 0.06, fy0 + h * 0.02]];
  displace(r, footPts[0], [x1 + W * 0.06, fy1 + h * 0.01], 0.22, 4, footPts);
  const footLine = chaikin(footPts, 2);
  ctx.save();
  ctx.clip(body);
  ctx.strokeStyle = c.color;
  const mid = lerp(x0, x1, 0.35 + r() * 0.25);
  ctx.save();
  ctx.clip(pathOf([[-W, -H], [2 * W, -H], [2 * W, footLine[footLine.length - 1][1]], ...[...footLine].reverse(), [-W, footLine[0][1]]], true));
  hatch(ctx, r, body, outline, mid, W, Math.max(fy0, fy1) + h * 0.08, U, { slant: 0.02, minLen: 0.55 });
  hatch(ctx, r, body, outline, 0, mid, Math.max(fy0, fy1) + h * 0.08, U, { gap: LINE.hatchGap * (2.2 + r()), minLen: 0.45, slant: -0.02 });
  ctx.restore();
  litStrokes(ctx, r, body, footLine.filter((p) => p[0] > mid), 4 + Math.floor(r() * 4), base, 0.45, U);
  litStrokes(ctx, r, body, footLine.filter((p) => p[0] <= mid), 2 + Math.floor(r() * 3), base, -0.45, U);
  ctx.restore();
  ink(ctx, footLine.slice(Math.floor(footLine.length * 0.1), Math.ceil(footLine.length * 0.85)), U * LINE.lit * 1.2, r, { taperStart: 0.3, taperEnd: 0.3 });
  ink(ctx, outline, U * LINE.outline, r, { taperStart: 0.08, taperEnd: 0.08, minFrac: 0.2 });
}

/** A volcano: a broad cone with a rough, broken crater rim, the crater's inside in shadow, smoke rising from inside. Drawn W wide and H tall (H about W). */
export function volcano(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: ArtColors) {
  const r = rng(seed);
  const U = W / 1.05;
  const base = H * 0.97;
  const cx = W * (0.44 + r() * 0.12);
  const rimY = H * (0.4 + r() * 0.08);
  const cw = W * (0.13 + r() * 0.04);
  const hw = W * (0.44 + r() * 0.04);
  ctx.strokeStyle = c.color;
  if (r() < 0.6) {
    const x = cx + (r() < 0.5 ? -1 : 1) * W * 0.28;
    const top = lerp(rimY, base, 0.35);
    peak(ctx, r, { ax: x, ay: top, lx: Math.max(W * 0.02, x - (base - top)), rx: Math.min(W * 0.98, x + (base - top)) }, base, U, c, false);
  }
  // The rim's two ends are at different heights: the crater is broken down on one side.
  const lowSide = r() < 0.5 ? -1 : 1;
  const lY = rimY + (lowSide < 0 ? cw * 0.25 : 0);
  const rY = rimY + (lowSide > 0 ? cw * 0.25 : 0);
  const left = chaikin(slope(r, [cx - cw, lY], [cx - hw, base], 0.5), 3);
  const right = chaikin(slope(r, [cx + cw, rY], [cx + hw, base], 0.5), 3);
  // Back rim (part of the outline): jagged, bulging up, with a notch.
  const backPts: Pt[] = [[cx - cw, lY]];
  const notchAt = r() < 0.5 ? 0.18 + r() * 0.15 : 0.67 + r() * 0.15;
  for (let k = 1; k < 10; k++) {
    const t = k / 10;
    const notch = Math.exp(-(((t - notchAt) / 0.07) ** 2)) * cw * 0.13;
    backPts.push([cx - cw + 2 * cw * t, lerp(lY, rY, t) - cw * 0.3 * Math.sin(t * Math.PI) + notch + (r() - 0.5) * cw * 0.1]);
  }
  backPts.push([cx + cw, rY]);
  const back = chaikin(backPts, 2);
  // Front rim: lower, also rough.
  const frontPts: Pt[] = [[cx - cw, lY]];
  for (let k = 1; k < 8; k++) {
    const t = k / 8;
    frontPts.push([cx - cw + 2 * cw * t, lerp(lY, rY, t) + cw * 0.42 * Math.sin(t * Math.PI) + (r() - 0.5) * cw * 0.08]);
  }
  frontPts.push([cx + cw, rY]);
  const front = chaikin(frontPts, 2);
  const outline = [...[...left].reverse(), ...back.slice(1, -1), ...right];
  const body = pathOf([[left[left.length - 1][0], base + U * 0.02], ...outline, [right[right.length - 1][0], base + U * 0.02]], true);
  clearShape(ctx, body, c.fill);
  const crater = pathOf([...back, ...[...front].reverse()], true);
  const ridgeEnd: Pt = [cx + hw * (0.15 + r() * 0.15), lerp(rimY, base, 0.85)];
  const ridge = chaikin(slope(r, [cx + cw * 0.4, rimY + cw * 0.3], ridgeEnd, 0.7), 3);
  const face = pathOf([[cx + cw * 0.4, rimY + cw * 0.25], ...right, [ridgeEnd[0], base + U * 0.02], ...[...ridge].reverse()], true);
  ctx.save();
  ctx.clip(body);
  // The inside of the crater is in shadow: dense strokes from the back rim down to the front rim.
  hatch(ctx, r, crater, back, cx - cw, cx + cw, rimY + cw * 0.5, U, { gap: LINE.hatchGap * 0.55, minLen: 0.9, slant: 0, width: LINE.hatch * 1.1 });
  hatch(ctx, r, face, right, cx, cx + hw + U * 0.03, base, U, { slant: 0.12, extra: [ridge, front] });
  litStrokes(ctx, r, body, left, 6 + Math.floor(r() * 5), base, -0.45, U);
  // A few gullies from the rim down the lit side.
  for (let k = 0; k < 2; k++) {
    const sx = cx - cw * (0.3 + r() * 0.6);
    const pts = chaikin(slope(r, [sx, rimY + cw * 0.3], [sx - hw * (0.2 + r() * 0.25), lerp(rimY, base, 0.55 + r() * 0.25)], 0.6), 2);
    ink(ctx, pts, U * LINE.lit * 1.4, r, { taperStart: 0.1, taperEnd: 0.6 });
  }
  ctx.restore();
  ink(ctx, ridge, U * LINE.ridge, r, { taperStart: 0.05, taperEnd: 0.6 });
  ink(ctx, front, U * LINE.ridge, r, { taperStart: 0.15, taperEnd: 0.15 });
  ink(ctx, outline, U * LINE.outline, r, { taperStart: 0.1, taperEnd: 0.1, minFrac: 0.2 });
  if (r() < 0.5) {
    const x = cx + (r() < 0.5 ? -1 : 1) * W * (0.24 + r() * 0.08);
    const top = lerp(rimY, base, 0.6);
    peak(ctx, r, { ax: x, ay: top, lx: Math.max(W * 0.02, x - (base - top) * 1.1), rx: Math.min(W * 0.98, x + (base - top) * 1.1) }, base, U, c, false);
  }
  // Smoke from inside the crater: a plume of puffs drifting to one side.
  const drift = r() < 0.5 ? -1 : 1;
  const puffs: { x: number; y: number; rad: number }[] = [];
  const n = 6 + Math.floor(r() * 2);
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    puffs.push({ x: cx + drift * W * 0.22 * t * t + (r() - 0.5) * W * 0.02, y: rimY - cw * 0.12 - H * 0.3 * t, rad: U * (0.022 + 0.062 * t) * (0.85 + r() * 0.25) });
  }
  for (let k = puffs.length - 1; k >= 0; k--) {
    const { x, y, rad } = puffs[k];
    const pts: Pt[] = [];
    for (let a = 0; a <= 32; a++) {
      const t = (a / 32) * Math.PI * 2;
      const rr = rad * (1 + 0.05 * Math.sin(t * 3 + k * 1.7));
      pts.push([x + Math.cos(t) * rr, y + Math.sin(t) * rr * 0.88]);
    }
    const shape = pathOf(pts, true);
    ctx.save();
    // The lowest puff starts inside the crater: only the part above the front rim shows.
    if (k === 0) ctx.clip(pathOf([[0, 0], [W, 0], [W, rimY], ...[...front].reverse(), [0, rimY]], true));
    clearShape(ctx, shape, c.fill);
    ctx.save();
    ctx.clip(shape);
    ink(ctx, chaikin([[x + rad * 0.1, y + rad * 0.65], [x + rad * 0.6, y + rad * 0.45], [x + rad * 0.8, y]], 2), U * LINE.lit, r, { taperStart: 0.3, taperEnd: 0.3 });
    ctx.restore();
    ink(ctx, pts, U * LINE.ridge * 0.8, r, { taperStart: 0.02, taperEnd: 0.02, minFrac: 0.6 });
    ctx.restore();
  }
  // The front rim again, over the bottom of the plume, so the smoke rises from inside the crater.
  ink(ctx, front, U * LINE.ridge, r, { taperStart: 0.15, taperEnd: 0.15 });
}
