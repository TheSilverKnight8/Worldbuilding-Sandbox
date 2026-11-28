import { LINE, clearShape, ink, pathOf, rng, type ArtColors, type Pt, type Rng } from './ink';

// Settlement icons (Stage 8), in the same ink style as the terrain (our own drawing code):
// bold, slightly uneven outlines, hatching on the shaded right faces. Buildings are seen as
// the rest of the map is, from the south and a little above: each house shows its gable end
// to the front and its roof and side receding up and to the right. Each icon draws into a
// W x H box with its ground line near the bottom; a settlement is a cluster drawn back to
// front, so nearer buildings hide the ones behind.

/** How wide each settlement is drawn by default, in cell spacings. */
export const SETTLEMENT_SIZE = { farm: 0.9, village: 1.4, town: 1.9, city: 2.5, walledCity: 3.0, castle: 1.8, port: 1.9, ruins: 1.4 } as const;

/** Lines are set as for a drawing this many cell spacings wide, whatever the settlement's size (as the plants' are), so they suit small buildings. */
const LINE_SPACINGS = 1.4;

/** The roof's color, where the look has one (painterly); the atlas leaves roofs to ink. */
export interface SettlementColors extends ArtColors {
  roof?: string;
}

/** Which way things recede: up and to the right, as the high ground behind a cliff does on the page. */
const BACK: Pt = [0.62, -0.38];

interface Lines {
  U: number;
  c: SettlementColors;
  r: Rng;
}

const mark = (ctx: CanvasRenderingContext2D, L: Lines, pts: Pt[], w: number, close = false) =>
  ink(ctx, close ? [...pts, pts[0]] : pts, L.U * w, L.r, { taperStart: 0.04, taperEnd: 0.04, minFrac: 0.6 });

/** Close vertical strokes over a shaded face (clipped to it). */
function shade(ctx: CanvasRenderingContext2D, L: Lines, face: Pt[], gap = 1) {
  const p = pathOf(face, true);
  ctx.save();
  ctx.clip(p);
  const xs = face.map((q) => q[0]);
  const ys = face.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let x = x0 + L.U * 0.004; x < x1; x += L.U * LINE.hatchGap * 0.8 * gap * (0.85 + L.r() * 0.3))
    ink(ctx, [[x, y0 - 1], [x + (L.r() - 0.5) * L.U * 0.002, y1 + 1]], L.U * LINE.hatch * 0.85, L.r, { taperStart: 0.02, taperEnd: 0.3, minFrac: 0.5 });
  ctx.restore();
}

/** A house: its gable end w wide and h tall (to the eaves) standing on (x, base), roof rising `roof` above the eaves, `depth` deep. */
function house(ctx: CanvasRenderingContext2D, L: Lines, x: number, base: number, w: number, h: number, roof: number, depth: number) {
  const { c } = L;
  const [bx, by] = [BACK[0] * depth, BACK[1] * depth];
  const front: Pt[] = [[x, base], [x, base - h], [x + w / 2, base - h - roof], [x + w, base - h], [x + w, base]];
  const side: Pt[] = [[x + w, base], [x + w, base - h], [x + w + bx, base - h + by], [x + w + bx, base + by]];
  const roofSide: Pt[] = [[x + w / 2, base - h - roof], [x + w / 2 + bx, base - h - roof + by], [x + w + bx, base - h + by], [x + w, base - h]];
  const all = pathOf([[x, base], [x, base - h], [x + w / 2, base - h - roof], [x + w / 2 + bx, base - h - roof + by], [x + w + bx, base - h + by], [x + w + bx, base + by], [x + w, base]], true);
  clearShape(ctx, all, c.fill);
  if (c.roof) {
    ctx.fillStyle = c.roof;
    ctx.fill(pathOf(roofSide, true));
  }
  ctx.strokeStyle = c.color;
  shade(ctx, L, side);
  // Roof: a few lines down the slope.
  for (let k = 1; k < 4; k++) {
    const t = k / 4;
    mark(ctx, L, [[x + w / 2 + bx * t, base - h - roof + by * t], [x + w + bx * t, base - h + by * t]], LINE.lit);
  }
  // A door, and a window in the gable.
  const dw = w * 0.22;
  mark(ctx, L, [[x + w * 0.5 - dw / 2, base], [x + w * 0.5 - dw / 2, base - h * 0.55], [x + w * 0.5 + dw / 2, base - h * 0.55], [x + w * 0.5 + dw / 2, base]], LINE.lit);
  ctx.fillStyle = c.color;
  ctx.beginPath();
  ctx.arc(x + w / 2, base - h - roof * 0.42, w * 0.06, 0, Math.PI * 2);
  ctx.fill();
  mark(ctx, L, front, LINE.outline * 0.75, true);
  mark(ctx, L, [[x + w / 2, base - h - roof], [x + w / 2 + bx, base - h - roof + by], [x + w + bx, base - h + by], [x + w + bx, base + by], [x + w, base]], LINE.outline * 0.75);
  mark(ctx, L, [[x + w, base - h], [x + w + bx, base - h + by]], LINE.lit);
}

/** A round tower on (cx, base): rw across, th tall, with a conical roof (`cone`) or battlements. */
function tower(ctx: CanvasRenderingContext2D, L: Lines, cx: number, base: number, rw: number, th: number, cone: number) {
  const { c } = L;
  const ey = rw * 0.35;
  const top = base - th;
  const outline: Pt[] = [];
  for (let k = 0; k <= 12; k++) outline.push([cx - rw + (2 * rw * k) / 12, base + Math.sin((Math.PI * k) / 12) * ey]);
  const body: Pt[] = [[cx - rw, top], ...outline, [cx + rw, top]];
  const roofPts: Pt[] = cone > 0 ? [[cx - rw * 1.15, top], [cx, top - cone], [cx + rw * 1.15, top]] : [];
  clearShape(ctx, pathOf([...body, ...(cone > 0 ? [[cx + rw * 1.15, top] as Pt, [cx, top - cone] as Pt, [cx - rw * 1.15, top] as Pt] : [])], true), c.fill);
  ctx.strokeStyle = c.color;
  shade(ctx, L, [[cx + rw * 0.25, top], [cx + rw, top], [cx + rw, base + ey * 0.3], [cx + rw * 0.25, base + ey]]);
  // A slit window.
  mark(ctx, L, [[cx - rw * 0.15, top + th * 0.3], [cx - rw * 0.15, top + th * 0.45]], LINE.ridge * 0.8);
  if (cone > 0) {
    if (c.roof) {
      ctx.fillStyle = c.roof;
      ctx.fill(pathOf(roofPts, true));
    }
    shade(ctx, L, [[cx, top - cone], [cx + rw * 1.15, top], [cx + rw * 0.2, top]], 0.8);
    mark(ctx, L, roofPts, LINE.outline * 0.75, true);
  } else {
    // Battlements: a few merlons along the top.
    const n = Math.max(2, Math.round(rw / (L.U * 0.012)));
    for (let k = 0; k < n; k++) {
      if (k % 2) continue;
      const x0 = cx - rw + (2 * rw * k) / n;
      const x1 = cx - rw + (2 * rw * (k + 1)) / n;
      const m: Pt[] = [[x0, top], [x0, top - rw * 0.35], [x1, top - rw * 0.35], [x1, top]];
      clearShape(ctx, pathOf(m, true), c.fill);
      mark(ctx, L, m, LINE.lit * 1.2);
    }
    mark(ctx, L, [[cx - rw, top], [cx + rw, top]], LINE.lit * 1.2);
  }
  mark(ctx, L, [[cx - rw, top], [cx - rw, base], ...outline, [cx + rw, top]], LINE.outline * 0.75);
}

/** A stretch of wall with battlements, from (x0, y0) to (x1, y1) on the ground, h tall. */
function wall(ctx: CanvasRenderingContext2D, L: Lines, x0: number, y0: number, x1: number, y1: number, h: number, gate = false) {
  const { c } = L;
  const face: Pt[] = [[x0, y0], [x0, y0 - h], [x1, y1 - h], [x1, y1]];
  clearShape(ctx, pathOf(face, true), c.fill);
  ctx.strokeStyle = c.color;
  // Stone courses.
  for (let k = 1; k < 3; k++) mark(ctx, L, [[x0, y0 - (h * k) / 3], [x1, y1 - (h * k) / 3]], LINE.lit * 0.8);
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(3, Math.round(len / (L.U * 0.018)));
  for (let k = 0; k < n; k += 2) {
    const t0 = k / n;
    const t1 = (k + 1) / n;
    const a: Pt = [x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0 - h];
    const b: Pt = [x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1 - h];
    const m: Pt[] = [a, [a[0], a[1] - h * 0.3], [b[0], b[1] - h * 0.3], b];
    clearShape(ctx, pathOf(m, true), c.fill);
    mark(ctx, L, m, LINE.lit * 1.1);
  }
  if (gate) {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const gw = h * 0.45;
    const arch: Pt[] = [[mx - gw, my]];
    for (let k = 0; k <= 8; k++) arch.push([mx - gw * Math.cos((Math.PI * k) / 8), my - h * 0.45 - gw * Math.sin((Math.PI * k) / 8)]);
    arch.push([mx + gw, my]);
    ctx.save();
    ctx.fillStyle = c.color;
    ctx.globalAlpha = 0.85;
    ctx.fill(pathOf(arch, true));
    ctx.restore();
  }
  mark(ctx, L, face, LINE.outline * 0.75, true);
}

/** A steeple: a square tower `w` wide and `h` tall with a spire on top. */
function steeple(ctx: CanvasRenderingContext2D, L: Lines, x: number, base: number, w: number, h: number) {
  const { c } = L;
  const spire = h * 0.75;
  const body: Pt[] = [[x, base], [x, base - h], [x + w, base - h], [x + w, base]];
  const top: Pt[] = [[x - w * 0.08, base - h], [x + w / 2, base - h - spire], [x + w * 1.08, base - h]];
  clearShape(ctx, pathOf([...body.slice(0, 2), top[1], ...body.slice(2)], true), c.fill);
  if (c.roof) {
    ctx.fillStyle = c.roof;
    ctx.fill(pathOf(top, true));
  }
  ctx.strokeStyle = c.color;
  shade(ctx, L, [[x + w * 0.55, base - h], [x + w, base - h], [x + w, base], [x + w * 0.55, base]]);
  shade(ctx, L, [[x + w / 2, base - h - spire], [x + w * 1.08, base - h], [x + w / 2, base - h]], 0.8);
  mark(ctx, L, [[x + w / 2 - w * 0.12, base - h * 0.75], [x + w / 2 - w * 0.12, base - h * 0.6]], LINE.ridge * 0.8);
  mark(ctx, L, body, LINE.outline * 0.75, true);
  mark(ctx, L, top, LINE.outline * 0.75);
}

type Item = { y: number; draw: () => void };

/** Draws items from the back (furthest up the page) to the front. */
const backToFront = (items: Item[]) => items.sort((a, b) => a.y - b.y).forEach((i) => i.draw());

/** Houses scattered around (cx, cy) in an oval rx by ry: n of them, sized about `size` (gable width). */
function cluster(ctx: CanvasRenderingContext2D, L: Lines, items: Item[], cx: number, cy: number, rx: number, ry: number, n: number, size: number) {
  const { r } = L;
  const spots: Pt[] = [];
  for (let tries = 0; spots.length < n && tries < n * 40; tries++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r());
    const p: Pt = [cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d];
    if (spots.some((q) => Math.abs(q[0] - p[0]) < size * 0.95 && Math.abs(q[1] - p[1]) < size * 0.45)) continue;
    spots.push(p);
  }
  for (const [x, y] of spots) {
    const w = size * (0.75 + r() * 0.45);
    const h = w * (0.55 + r() * 0.25);
    const roof = w * (0.45 + r() * 0.3);
    const depth = w * (0.7 + r() * 0.6);
    items.push({ y, draw: () => house(ctx, L, x - w / 2, y, w, h, roof, depth) });
  }
}

const lines = (W: number, size: number, c: SettlementColors, r: Rng): Lines => ({ U: (W / size) * LINE_SPACINGS, c, r });

/** A farm: a farmhouse and a barn beside a ploughed field. */
export function farm(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: SettlementColors) {
  const r = rng(seed);
  const L = lines(W, SETTLEMENT_SIZE.farm, c, r);
  const base = H * 0.86;
  // The field: rows on the ground, receding.
  const fx = W * (r() < 0.5 ? 0.04 : 0.5);
  const fw = W * 0.42;
  ctx.strokeStyle = c.color;
  for (let k = 0; k < 5; k++) {
    const y = base - H * 0.04 - k * H * 0.07;
    const x = fx + k * W * 0.035;
    mark(ctx, L, [[x, y], [x + fw, y - H * 0.03]], LINE.lit);
  }
  const hx = fx < W * 0.3 ? W * 0.5 : W * 0.06;
  const items: Item[] = [];
  items.push({ y: base, draw: () => house(ctx, L, hx, base, W * 0.2, H * 0.2, H * 0.17, W * 0.18) });
  items.push({ y: base - H * 0.1, draw: () => house(ctx, L, hx + W * 0.16, base - H * 0.1, W * 0.24, H * 0.24, H * 0.2, W * 0.12) });
  backToFront(items);
}

/** A village: a few houses, sometimes with a small church. */
export function village(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: SettlementColors) {
  const r = rng(seed);
  const L = lines(W, SETTLEMENT_SIZE.village, c, r);
  const items: Item[] = [];
  cluster(ctx, L, items, W * 0.45, H * 0.66, W * 0.3, H * 0.16, 3 + Math.floor(r() * 2), W * 0.2);
  if (r() < 0.6) items.push({ y: H * 0.58, draw: () => steeple(ctx, L, W * 0.62, H * 0.58, W * 0.1, H * 0.3) });
  backToFront(items);
}

/** A town: houses around a church with a steeple. */
export function town(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: SettlementColors) {
  const r = rng(seed);
  const L = lines(W, SETTLEMENT_SIZE.town, c, r);
  const items: Item[] = [];
  cluster(ctx, L, items, W * 0.48, H * 0.68, W * 0.36, H * 0.16, 6 + Math.floor(r() * 3), W * 0.15);
  items.push({ y: H * 0.56, draw: () => steeple(ctx, L, W * (0.42 + r() * 0.12), H * 0.56, W * 0.09, H * 0.33) });
  backToFront(items);
}

/** A city: many houses, towers and a great church. */
export function city(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: SettlementColors) {
  const r = rng(seed);
  const L = lines(W, SETTLEMENT_SIZE.city, c, r);
  const items: Item[] = [];
  cluster(ctx, L, items, W * 0.5, H * 0.68, W * 0.4, H * 0.17, 11 + Math.floor(r() * 4), W * 0.11);
  items.push({ y: H * 0.55, draw: () => steeple(ctx, L, W * 0.44, H * 0.55, W * 0.08, H * 0.34) });
  items.push({ y: H * 0.54, draw: () => steeple(ctx, L, W * 0.54, H * 0.54, W * 0.07, H * 0.28) });
  items.push({ y: H * 0.6, draw: () => tower(ctx, L, W * (0.18 + r() * 0.08), H * 0.6, W * 0.035, H * 0.22, H * 0.1) });
  items.push({ y: H * 0.62, draw: () => tower(ctx, L, W * (0.76 + r() * 0.08), H * 0.62, W * 0.035, H * 0.2, H * 0.1) });
  backToFront(items);
}

/** A walled city: a city inside a ring of walls with towers and a gate. */
export function walledCity(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: SettlementColors) {
  const r = rng(seed);
  const L = lines(W, SETTLEMENT_SIZE.walledCity, c, r);
  const cx = W * 0.5;
  const cy = H * 0.66;
  const rx = W * 0.42;
  const ry = H * 0.17;
  const wh = H * 0.1;
  const at = (a: number): Pt => [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  // The far wall first, then the town, then the near wall and its towers over it.
  const corners = 8;
  const angle = (k: number) => Math.PI + (k / corners) * Math.PI * 2;
  for (let k = 0; k < corners; k++) {
    const [a, b] = [at(angle(k)), at(angle(k + 1))];
    if (a[1] < cy && b[1] <= cy + 1) wall(ctx, L, a[0], a[1], b[0], b[1], wh * 0.8);
  }
  const items: Item[] = [];
  cluster(ctx, L, items, cx, cy - H * 0.02, rx * 0.72, ry * 0.65, 9 + Math.floor(r() * 3), W * 0.1);
  items.push({ y: cy - H * 0.06, draw: () => steeple(ctx, L, cx - W * 0.03, cy - H * 0.06, W * 0.07, H * 0.32) });
  backToFront(items);
  const near: Item[] = [];
  for (let k = 0; k < corners; k++) {
    const [a, b] = [at(angle(k)), at(angle(k + 1))];
    if (a[1] >= cy - 1 || b[1] > cy) near.push({ y: (a[1] + b[1]) / 2, draw: () => wall(ctx, L, a[0], a[1], b[0], b[1], wh, k === 5) });
  }
  for (let k = 0; k < corners; k++) {
    const p = at(angle(k));
    near.push({ y: p[1] + 0.5, draw: () => tower(ctx, L, p[0], p[1] + 1, W * 0.032, wh * 1.5, 0) });
  }
  backToFront(near);
}

/** A castle: a keep inside a curtain wall with round towers at its corners. */
export function castle(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: SettlementColors) {
  const r = rng(seed);
  const L = lines(W, SETTLEMENT_SIZE.castle, c, r);
  const base = H * 0.86;
  const left = W * 0.14;
  const right = W * 0.8;
  const back = base - H * 0.2;
  const shift = W * 0.08;
  const wh = H * 0.16;
  const cone = r() < 0.5 ? H * 0.14 : 0;
  const items: Item[] = [];
  // Back wall and towers, the keep, then the front wall and towers.
  items.push({ y: back, draw: () => wall(ctx, L, left + shift, back, right + shift, back, wh * 0.85) });
  items.push({ y: back + 0.1, draw: () => tower(ctx, L, left + shift, back, W * 0.055, wh * 1.5, cone) });
  items.push({ y: back + 0.2, draw: () => tower(ctx, L, right + shift, back, W * 0.055, wh * 1.5, cone) });
  items.push({ y: base - H * 0.1, draw: () => {
    // The keep: a tall block with battlements.
    const kx = W * (0.38 + r() * 0.06);
    const kw = W * 0.22;
    const kh = H * 0.42;
    const ky = base - H * 0.1;
    house(ctx, L, kx, ky, kw, kh, 0, kw * 0.6);
    const n = 5;
    for (let k = 0; k < n; k += 2) {
      const m: Pt[] = [[kx + (kw * k) / n, ky - kh], [kx + (kw * k) / n, ky - kh - H * 0.05], [kx + (kw * (k + 1)) / n, ky - kh - H * 0.05], [kx + (kw * (k + 1)) / n, ky - kh]];
      clearShape(ctx, pathOf(m, true), c.fill);
      ctx.strokeStyle = c.color;
      mark(ctx, L, m, LINE.lit * 1.2);
    }
  } });
  items.push({ y: base, draw: () => wall(ctx, L, left, base, right, base, wh, true) });
  items.push({ y: base + 0.1, draw: () => tower(ctx, L, left, base, W * 0.065, wh * 1.6, cone) });
  items.push({ y: base + 0.2, draw: () => tower(ctx, L, right, base, W * 0.065, wh * 1.6, cone) });
  // Side walls.
  items.push({ y: back + (base - back) / 2, draw: () => wall(ctx, L, right, base, right + shift, back, wh * 0.9) });
  backToFront(items);
}

/** A port: houses by the water, a pier and a moored ship. */
export function port(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: SettlementColors) {
  const r = rng(seed);
  const L = lines(W, SETTLEMENT_SIZE.port, c, r);
  const items: Item[] = [];
  cluster(ctx, L, items, W * 0.36, H * 0.62, W * 0.26, H * 0.14, 5 + Math.floor(r() * 2), W * 0.14);
  backToFront(items);
  ctx.strokeStyle = c.color;
  // The pier: planks running out to the lower right.
  const p0: Pt = [W * 0.56, H * 0.78];
  const p1: Pt = [W * 0.9, H * 0.92];
  const pw = H * 0.05;
  const deck: Pt[] = [p0, p1, [p1[0], p1[1] - pw], [p0[0], p0[1] - pw]];
  clearShape(ctx, pathOf(deck, true), c.fill);
  for (let k = 1; k < 8; k++) {
    const t = k / 8;
    mark(ctx, L, [[p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t], [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t - pw]], LINE.lit * 0.8);
  }
  mark(ctx, L, deck, LINE.outline * 0.7, true);
  for (let k = 0; k <= 3; k++) {
    const t = k / 3;
    const x = p0[0] + (p1[0] - p0[0]) * t;
    const y = p0[1] + (p1[1] - p0[1]) * t;
    mark(ctx, L, [[x, y], [x, y + H * 0.04]], LINE.lit * 1.2);
  }
  // A ship beside it: hull, mast and sail.
  const sx = W * 0.72;
  const sy = H * 0.72;
  const hull: Pt[] = [[sx - W * 0.1, sy - H * 0.05], [sx + W * 0.12, sy - H * 0.05], [sx + W * 0.08, sy], [sx - W * 0.07, sy]];
  const sail: Pt[] = [[sx + W * 0.005, sy - H * 0.3], [sx + W * 0.09, sy - H * 0.12], [sx + W * 0.005, sy - H * 0.1]];
  clearShape(ctx, pathOf([...hull, ...sail], true), c.fill);
  clearShape(ctx, pathOf(sail, true), c.fill);
  clearShape(ctx, pathOf(hull, true), c.fill);
  shade(ctx, L, [[sx, sy - H * 0.05], [sx + W * 0.12, sy - H * 0.05], [sx + W * 0.08, sy], [sx, sy]]);
  mark(ctx, L, hull, LINE.outline * 0.7, true);
  mark(ctx, L, [[sx, sy - H * 0.05], [sx, sy - H * 0.34]], LINE.lit * 1.3);
  mark(ctx, L, sail, LINE.lit * 1.3, true);
  // Ripples.
  for (let k = 0; k < 2; k++) mark(ctx, L, [[sx - W * 0.09 + k * W * 0.05, sy + H * 0.035 + k * H * 0.02], [sx - W * 0.03 + k * W * 0.05, sy + H * 0.035 + k * H * 0.02]], LINE.lit * 0.8);
}

/** Ruins: broken walls, a broken tower and rubble. */
export function ruins(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: SettlementColors) {
  const r = rng(seed);
  const L = lines(W, SETTLEMENT_SIZE.ruins, c, r);
  const base = H * 0.84;
  ctx.strokeStyle = c.color;
  const broken = (x0: number, y0: number, x1: number, h: number) => {
    // A wall with a jagged, broken top.
    const top: Pt[] = [];
    const n = 7;
    for (let k = 0; k <= n; k++) top.push([x0 + ((x1 - x0) * k) / n, y0 - h * (0.35 + r() * 0.65) * (k === 0 || k === n ? 0.6 : 1)]);
    const face: Pt[] = [[x0, y0], ...top, [x1, y0]];
    clearShape(ctx, pathOf(face, true), c.fill);
    shade(ctx, L, [[x0 + (x1 - x0) * 0.6, y0 - h], [x1, y0 - h], [x1, y0], [x0 + (x1 - x0) * 0.6, y0]], 1.2);
    mark(ctx, L, face, LINE.outline * 0.7, true);
    // An empty window.
    const wx = x0 + (x1 - x0) * (0.25 + r() * 0.2);
    mark(ctx, L, [[wx, y0 - h * 0.15], [wx, y0 - h * 0.32], [wx + (x1 - x0) * 0.1, y0 - h * 0.32], [wx + (x1 - x0) * 0.1, y0 - h * 0.15]], LINE.lit);
  };
  broken(W * 0.12, base - H * 0.14, W * 0.5, H * 0.28);
  // A broken round tower.
  const tx = W * (0.62 + r() * 0.08);
  const rw = W * 0.08;
  const th = H * 0.42;
  const tb = base - H * 0.06;
  const top: Pt[] = [];
  for (let k = 0; k <= 6; k++) top.push([tx - rw + (2 * rw * k) / 6, tb - th * (0.55 + r() * 0.45)]);
  const body: Pt[] = [[tx - rw, tb], ...top, [tx + rw, tb]];
  clearShape(ctx, pathOf(body, true), c.fill);
  shade(ctx, L, [[tx + rw * 0.25, tb - th], [tx + rw, tb - th], [tx + rw, tb], [tx + rw * 0.25, tb]]);
  mark(ctx, L, body, LINE.outline * 0.7, true);
  broken(W * 0.3, base, W * 0.62, H * 0.18);
  // Rubble.
  ctx.fillStyle = c.color;
  for (let k = 0; k < 14; k++) {
    ctx.beginPath();
    ctx.arc(W * (0.1 + r() * 0.8), base + H * (0.02 + r() * 0.06), W * (0.006 + r() * 0.01), 0, Math.PI * 2);
    ctx.fill();
  }
}
