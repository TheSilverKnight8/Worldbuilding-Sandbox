import { mixSeed, seededRandom } from '../rng';
import type { PlacedIcon, River } from '../world/types';
import { across, cellAt, cellsNear, type Graph } from './graph';
import { KINDS, cliffTurn, dirOf } from './terrain';

// Rivers (Stage 5). Caleb draws a river by hand, exactly where he wants it, or clicks a
// source and the app routes it downhill over the heightmap to the sea, a lake or the map's
// edge (Caleb: both). Either way it is stored as a line from source to mouth and drawn as a
// river that widens toward its mouth, and below where other rivers join it. Where a river
// crosses a cliff whose drop faces the viewer, a waterfall appears.

type Pt = [number, number];

// ------------------------------------------------------------------ routing downhill

const drainCache = new WeakMap<Int16Array, Int32Array>();

/**
 * Where water on each land cell flows next: the neighbor it drains to, -1 when it drains
 * into water next door, -2 when it drains off the map's edge. Worked out by flooding the
 * land up from every outlet (water and the map's edge), lowest first: a cell is reached from
 * the lowest way out, so water flows downhill, out of hollows over their lowest rim, and
 * across flat land toward the nearest outlet.
 */
export function drainage(g: Graph, land: Uint8Array, heights: Int16Array): Int32Array {
  const hit = drainCache.get(heights);
  if (hit && hit.length === g.cellCount) return hit;
  const down = new Int32Array(g.cellCount).fill(-3);
  const filled = new Float32Array(g.cellCount);
  // A small binary heap of cells by (filled height, order reached).
  const heap: number[] = [];
  const keyH: number[] = [];
  const keyO: number[] = [];
  let order = 0;
  const less = (i: number, j: number) => keyH[i] < keyH[j] || (keyH[i] === keyH[j] && keyO[i] < keyO[j]);
  const push = (c: number, h: number) => {
    heap.push(c);
    keyH.push(h);
    keyO.push(order++);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(i, p)) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      [keyH[i], keyH[p]] = [keyH[p], keyH[i]];
      [keyO[i], keyO[p]] = [keyO[p], keyO[i]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.length - 1;
    heap[0] = heap[last];
    keyH[0] = keyH[last];
    keyO[0] = keyO[last];
    heap.pop();
    keyH.pop();
    keyO.pop();
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && less(l, m)) m = l;
      if (r < heap.length && less(r, m)) m = r;
      if (m === i) break;
      [heap[i], heap[m]] = [heap[m], heap[i]];
      [keyH[i], keyH[m]] = [keyH[m], keyH[i]];
      [keyO[i], keyO[m]] = [keyO[m], keyO[i]];
      i = m;
    }
    return top;
  };
  // Outlets: land next to water, and land on the map's edge.
  for (let c = 0; c < g.cellCount; c++) {
    if (!land[c]) continue;
    let out = -3;
    for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) {
      const n = across(g, g.cellEdges[k], c);
      if (n < 0) out = out === -1 ? -1 : -2;
      else if (!land[n]) out = -1;
    }
    if (out === -3) continue;
    down[c] = out;
    filled[c] = heights[c];
    push(c, heights[c]);
  }
  while (heap.length) {
    const c = pop();
    for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) {
      const n = across(g, g.cellEdges[k], c);
      if (n < 0 || !land[n] || down[n] !== -3) continue;
      down[n] = c;
      filled[n] = Math.max(heights[n], filled[c]);
      push(n, filled[n]);
    }
  }
  drainCache.set(heights, down);
  return down;
}

/** The middle of the edge between cell c and its neighbor n (n = -1: water; -2: the map's edge). */
export function outletPoint(g: Graph, land: Uint8Array, c: number, kind: number): Pt {
  for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) {
    const e = g.cellEdges[k];
    const n = across(g, e, c);
    if ((kind === -1 && n >= 0 && !land[n]) || (kind === -2 && n < 0)) {
      const v0 = g.edges[e * 4];
      const v1 = g.edges[e * 4 + 1];
      return [(g.vertices[v0 * 2] + g.vertices[v1 * 2]) / 2, (g.vertices[v0 * 2 + 1] + g.vertices[v1 * 2 + 1]) / 2];
    }
  }
  return [g.centers[c * 2], g.centers[c * 2 + 1]];
}

/** The nearest point to (x, y) on a polyline, its distance, and how far along the line it is. */
function nearestOn(pts: Pt[], x: number, y: number) {
  let best = { d: Infinity, x: 0, y: 0, s: 0 };
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const px = ax + dx * t;
    const py = ay + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best.d) best = { d, x: px, y: py, s: run + Math.sqrt(len2) * t };
    run += Math.sqrt(len2);
  }
  return best;
}

/**
 * A river routed downhill from map point (x, y): from cell to cell along the way water
 * drains, until it reaches water, the map's edge, or another river (which it joins). The
 * line wanders a little between cell centers, the same every time for the same `seed`.
 * Null if (x, y) is not on land.
 */
export function routeRiver(g: Graph, land: Uint8Array, heights: Int16Array, x: number, y: number, others: River[], seed: number): Pt[] | null {
  let c = cellAt(g, x, y);
  if (c < 0 || !land[c]) return null;
  const down = drainage(g, land, heights);
  const rand = seededRandom(mixSeed(seed, 0x7a11));
  const shapes = others.map((r) => smooth(r.points));
  const join = g.spacing * 0.7;
  const pts: Pt[] = [[x, y]];
  for (let steps = 0; steps < g.cellCount; steps++) {
    const next = down[c];
    if (next < 0) {
      pts.push(outletPoint(g, land, c, next));
      break;
    }
    c = next;
    const cx = g.centers[c * 2];
    const cy = g.centers[c * 2 + 1];
    // Reaching another river: join it there.
    let joined: Pt | null = null;
    for (const s of shapes) {
      const n = nearestOn(s, cx, cy);
      if (n.d < join) joined = [n.x, n.y];
    }
    if (joined) {
      pts.push(joined);
      break;
    }
    pts.push([cx, cy]);
  }
  // Wander a little across the line between cell centers (not at the ends).
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const off = (rand() - 0.5) * g.spacing * 0.35;
    pts[i] = [pts[i][0] - ((by - ay) / len) * off, pts[i][1] + ((bx - ax) / len) * off];
  }
  return pts.length >= 2 ? pts : null;
}

// ------------------------------------------------------------------ lines drawn by hand

/** Fewer points along a hand-drawn line, keeping its shape (Ramer-Douglas-Peucker). */
export function simplify(pts: Pt[], tolerance: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tolerance && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** A hand-drawn river's end joins another river when it stops close to one. */
export function snapToRivers(pts: Pt[], others: River[], within: number): Pt[] {
  if (pts.length < 2) return pts;
  const [x, y] = pts[pts.length - 1];
  let best: { d: number; x: number; y: number } | null = null;
  for (const r of others) {
    const n = nearestOn(smooth(r.points), x, y);
    if (n.d < within && (!best || n.d < best.d)) best = n;
  }
  return best ? [...pts.slice(0, -1), [best.x, best.y]] : pts;
}

// ------------------------------------------------------------------ drawing

/** Rounds a river's corners (keeps its ends). */
export function smooth(pts: Pt[]): Pt[] {
  let p = pts;
  for (let t = 0; t < 2; t++) {
    if (p.length < 3) return p;
    const out: Pt[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[i + 1];
      if (i > 0) out.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25]);
      if (i < p.length - 2) out.push([x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/** Splits long straight stretches into short ones, so a river's width can change along them (its taper, and where others join it). */
function resample(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/** A river ready to draw: its smoothed line and its width at each point, in map units. */
export interface RiverShape {
  id: string;
  pts: Pt[];
  widths: number[];
}

/** How a river narrows toward its source: a quarter of its own width there. */
const taper = (t: number) => 0.25 + 0.75 * Math.pow(Math.max(0, Math.min(1, t)), 0.7);

/**
 * The rivers as drawn: smoothed, each widening toward its mouth. A river whose mouth is on
 * another river joins it, and that river is wider below the join (widths add as areas do).
 */
export function riverShapes(rivers: River[], spacing: number): RiverShape[] {
  const lines = rivers.map((r) => resample(smooth(r.points), spacing * 0.5));
  const lengths = lines.map((pts) => {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return s;
  });
  // Which river each one joins, and how far along it.
  const joins: { into: number; s: number }[] = rivers.map(() => ({ into: -1, s: 0 }));
  rivers.forEach((_, a) => {
    const [x, y] = lines[a][lines[a].length - 1];
    let best = { d: spacing * 0.35, into: -1, s: 0, x: 0, y: 0 };
    rivers.forEach((__, b) => {
      if (a === b) return;
      const n = nearestOn(lines[b], x, y);
      if (n.d < best.d) best = { d: n.d, into: b, s: n.s, x: n.x, y: n.y };
    });
    if (best.into >= 0) {
      joins[a] = { into: best.into, s: best.s };
      lines[a][lines[a].length - 1] = [best.x, best.y];
    }
  });
  // Each river's width at its mouth, with everything that joins it.
  const memo = new Map<number, number>();
  const full = (i: number, depth = 0): number => {
    if (memo.has(i)) return memo.get(i)!;
    let w2 = rivers[i].width ** 2;
    if (depth < 50) joins.forEach((j, k) => j.into === i && (w2 += full(k, depth + 1) ** 2));
    const w = Math.sqrt(w2);
    memo.set(i, w);
    return w;
  };
  return rivers.map((r, i) => {
    const pts = lines[i];
    const L = lengths[i] || 1;
    const widths: number[] = [];
    let s = 0;
    for (let k = 0; k < pts.length; k++) {
      if (k) s += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      let w2 = (taper(s / L) * r.width) ** 2;
      joins.forEach((j, t) => j.into === i && j.s <= s && (w2 += full(t) ** 2));
      widths.push(Math.sqrt(w2));
    }
    return { id: r.id, pts, widths };
  });
}

/** The river under map point (x, y), within `tolerance` of its banks, or null. */
export function riverAt(shapes: RiverShape[], x: number, y: number, tolerance: number): string | null {
  let best: { id: string; d: number } | null = null;
  for (const r of shapes) {
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, ay] = r.pts[i - 1];
      const [bx, by] = r.pts[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t)) - (r.widths[i - 1] + (r.widths[i] - r.widths[i - 1]) * t) / 2;
      if (d < tolerance && (!best || d < best.d)) best = { id: r.id, d };
    }
  }
  return best?.id ?? null;
}

/** Cells along the rivers: a biome's plants are not drawn there. */
export function underRivers(g: Graph, shapes: RiverShape[]): Uint8Array {
  const out = new Uint8Array(g.cellCount);
  for (const r of shapes)
    for (let i = 0; i < r.pts.length; i++) {
      const next = r.pts[Math.min(r.pts.length - 1, i + 1)];
      const steps = Math.max(1, Math.ceil(Math.hypot(next[0] - r.pts[i][0], next[1] - r.pts[i][1]) / (g.spacing * 0.4)));
      for (let k = 0; k < steps; k++) {
        const x = r.pts[i][0] + ((next[0] - r.pts[i][0]) * k) / steps;
        const y = r.pts[i][1] + ((next[1] - r.pts[i][1]) * k) / steps;
        cellsNear(g, x, y, r.widths[i] / 2 + g.spacing * 0.3, (c) => (out[c] = 1));
      }
    }
  return out;
}

/** A waterfall the app draws where a river crosses a cliff. */
export interface AutoWaterfall {
  x: number;
  y: number;
  size: number;
  /** The cliff's direction (the waterfall falls the way its drop faces). */
  angle: number;
  key: string;
}

/** The key that names the waterfall where a river crosses a cliff (see MapInfo.hiddenAuto). */
export const waterfallKey = (river: string, cliff: string) => `w${river}:${cliff}`;

/**
 * Where a river crosses a cliff, a waterfall: on the cliff's rim, facing the way its drop
 * faces (the nearest of 8 directions, as the cliff is drawn), sized to its face. Ones Caleb
 * took over are left out.
 */
export function riverWaterfalls(shapes: RiverShape[], icons: PlacedIcon[], hidden: ReadonlySet<string>): AutoWaterfall[] {
  const out: AutoWaterfall[] = [];
  for (const cliff of icons) {
    if (cliff.kind !== 'cliff') continue;
    const turn = cliffTurn(cliff);
    const a = (turn * Math.PI) / 180;
    const half = cliff.size * 0.42;
    const p: Pt = [cliff.x - Math.cos(a) * half, cliff.y - Math.sin(a) * half];
    const q: Pt = [cliff.x + Math.cos(a) * half, cliff.y + Math.sin(a) * half];
    for (const r of shapes) {
      const key = waterfallKey(r.id, cliff.id);
      if (hidden.has(key)) continue;
      for (let i = 1; i < r.pts.length; i++) {
        const hit = crossing(r.pts[i - 1], r.pts[i], p, q);
        if (!hit) continue;
        // As tall as the cliff's face, and wider than the river.
        out.push({ x: hit[0], y: hit[1], size: Math.max(cliff.size * 0.4, r.widths[i] * 3), angle: dirOf(cliff) * 45, key });
        break;
      }
    }
  }
  return out;
}

/** Where segments a-b and c-d cross, or null. */
function crossing(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + r[0] * t, a[1] + r[1] * t] : null;
}

/** The default width at the mouth for a new river, in map units. */
export const defaultRiverWidth = (spacing: number) => spacing * 0.2;

/** Whether an icon kind is drawn on rivers (a waterfall). */
export const isWater = (kind: PlacedIcon['kind']) => KINDS[kind].group === 'water';
