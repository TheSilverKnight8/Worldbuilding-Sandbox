import type { PlacedIcon, River } from '../world/types';
import { cellAt, cellsNear, type Graph } from './graph';
import type { NoisyEdges } from './noisy';
import { KINDS, cliffTurn, dirOf } from './terrain';

// Rivers (Stage 5; along polygon borders since Caleb asked for it after Stage 7, as in
// Nortantis). A river runs along the borders between polygons, from corner to corner, and is
// drawn along the same wiggly lines as the coasts (noisy edges). It is stored as its chain of
// corners, from source to mouth. Caleb draws a river by hand (snapped to the borders nearest
// the stroke) or clicks a source and the app routes it downhill (Caleb: both). It ends at the
// coast (of the sea or a lake), the map's edge, or a corner of another river, which it joins.
// Where a river crosses a cliff, a waterfall appears.

type Pt = [number, number];

// ------------------------------------------------------------------ the polygons' corners

/** The corners of the polygons, and how they connect (worked out once per map). */
export interface Corners {
  count: number;
  /** Each corner's neighbors along an edge, and that edge: next/edge[start[v] .. start[v + 1]). */
  start: Int32Array;
  next: Int32Array;
  edge: Int32Array;
  /** The cells around each corner, up to 4 (-1 for none). */
  cells: Int32Array;
  /** 1 for corners on the map's edge. */
  border: Uint8Array;
}

const cornersCache = new WeakMap<Graph, Corners>();

export function corners(g: Graph): Corners {
  const hit = cornersCache.get(g);
  if (hit) return hit;
  const count = g.vertices.length / 2;
  const start = new Int32Array(count + 1);
  for (let e = 0; e < g.edgeCount; e++) {
    start[g.edges[e * 4] + 1]++;
    start[g.edges[e * 4 + 1] + 1]++;
  }
  for (let v = 0; v < count; v++) start[v + 1] += start[v];
  const fill = start.slice(0, count);
  const next = new Int32Array(start[count]);
  const edge = new Int32Array(start[count]);
  const cells = new Int32Array(count * 4).fill(-1);
  const border = new Uint8Array(count);
  const addCell = (v: number, c: number) => {
    if (c < 0) return;
    for (let k = 0; k < 4; k++) {
      if (cells[v * 4 + k] === c) return;
      if (cells[v * 4 + k] < 0) return void (cells[v * 4 + k] = c);
    }
  };
  for (let e = 0; e < g.edgeCount; e++) {
    const a = g.edges[e * 4];
    const b = g.edges[e * 4 + 1];
    next[fill[a]] = b;
    edge[fill[a]++] = e;
    next[fill[b]] = a;
    edge[fill[b]++] = e;
    for (const v of [a, b]) {
      addCell(v, g.edges[e * 4 + 2]);
      addCell(v, g.edges[e * 4 + 3]);
      if (g.edges[e * 4 + 3] < 0) border[v] = 1;
    }
  }
  const out = { count, start, next, edge, cells, border };
  cornersCache.set(g, out);
  return out;
}

const cx = (g: Graph, v: number) => g.vertices[v * 2];
const cy = (g: Graph, v: number) => g.vertices[v * 2 + 1];

/** What is around a corner: 0 only water, 1 only land, 2 both (the coast). */
function cornerKind(k: Corners, land: Uint8Array, v: number) {
  let l = 0;
  let w = 0;
  for (let i = 0; i < 4; i++) {
    const c = k.cells[v * 4 + i];
    if (c < 0) continue;
    if (land[c]) l++;
    else w++;
  }
  return l && w ? 2 : l ? 1 : 0;
}

/** The edge between two neighboring corners, or -1. */
function edgeBetween(k: Corners, a: number, b: number) {
  for (let i = k.start[a]; i < k.start[a + 1]; i++) if (k.next[i] === b) return k.edge[i];
  return -1;
}

/** The corner nearest map point (x, y) among the corners of the cell there (-1 off the map). */
function nearestCorner(g: Graph, x: number, y: number, ok: (v: number) => boolean = () => true) {
  const c = cellAt(g, x, y);
  if (c < 0) return -1;
  let best = -1;
  let bd = Infinity;
  for (let i = g.cellEdgeStart[c]; i < g.cellEdgeStart[c + 1]; i++) {
    const e = g.cellEdges[i];
    for (const v of [g.edges[e * 4], g.edges[e * 4 + 1]]) {
      if (!ok(v)) continue;
      const d = Math.hypot(cx(g, v) - x, cy(g, v) - y);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
  }
  return best;
}

/** The shortest way along borders from corner a to corner b (both included), over corners `ok` allows; null if none within `limit` map units. */
export function pathBetween(g: Graph, k: Corners, a: number, b: number, ok: (v: number) => boolean, limit: number): number[] | null {
  if (a === b) return [a];
  const dist = new Map<number, number>([[a, 0]]);
  const prev = new Map<number, number>();
  const heap = new MinHeap();
  heap.push(0, a);
  while (heap.size) {
    const [d, v] = heap.pop();
    if (v === b) break;
    if (d > (dist.get(v) ?? Infinity) || d > limit) continue;
    for (let i = k.start[v]; i < k.start[v + 1]; i++) {
      const n = k.next[i];
      if (n !== b && !ok(n)) continue;
      const nd = d + Math.hypot(cx(g, n) - cx(g, v), cy(g, n) - cy(g, v));
      if (nd < (dist.get(n) ?? Infinity)) {
        dist.set(n, nd);
        prev.set(n, v);
        heap.push(nd, n);
      }
    }
  }
  if (!prev.has(b)) return null;
  const out = [b];
  for (let v = b; v !== a; ) {
    v = prev.get(v)!;
    out.push(v);
  }
  return out.reverse();
}

/** A binary heap of (key, value), smallest key first; equal keys in the order pushed. */
class MinHeap {
  private k: number[] = [];
  private o: number[] = [];
  private v: number[] = [];
  private order = 0;
  get size() {
    return this.k.length;
  }
  private less(i: number, j: number) {
    return this.k[i] < this.k[j] || (this.k[i] === this.k[j] && this.o[i] < this.o[j]);
  }
  private swap(i: number, j: number) {
    [this.k[i], this.k[j]] = [this.k[j], this.k[i]];
    [this.o[i], this.o[j]] = [this.o[j], this.o[i]];
    [this.v[i], this.v[j]] = [this.v[j], this.v[i]];
  }
  push(key: number, value: number) {
    this.k.push(key);
    this.o.push(this.order++);
    this.v.push(value);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.k[0], this.v[0]];
    const last = this.k.length - 1;
    this.swap(0, last);
    this.k.pop();
    this.o.pop();
    this.v.pop();
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < this.k.length && this.less(l, m)) m = l;
      if (r < this.k.length && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}

// ------------------------------------------------------------------ routing downhill

/** Each corner's height: the average of the land cells around it. */
export function cornerHeights(g: Graph, land: Uint8Array, heights: ArrayLike<number>): Float32Array {
  const k = corners(g);
  const out = new Float32Array(k.count);
  for (let v = 0; v < k.count; v++) {
    let s = 0;
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const c = k.cells[v * 4 + i];
      if (c >= 0 && land[c]) {
        s += heights[c];
        n++;
      }
    }
    out[v] = n ? s / n : 0;
  }
  return out;
}

const drainCache = new WeakMap<ArrayLike<number>, Int32Array>();

/**
 * Where water at each corner flows next, along a border: the neighboring corner it drains
 * to; -1 at a corner on the coast (it reaches the water there); -2 at a corner on the map's
 * edge; -3 for corners in the water. Worked out by flooding up from the coast and the map's
 * edge, lowest first: water runs downhill, out of hollows over their lowest rim, and across
 * flat land toward the nearest way out.
 */
export function drainage(g: Graph, land: Uint8Array, heights: ArrayLike<number>): Int32Array {
  const hit = drainCache.get(heights);
  const k = corners(g);
  if (hit && hit.length === k.count) return hit;
  const h = cornerHeights(g, land, heights);
  const down = new Int32Array(k.count).fill(-3);
  const filled = new Float32Array(k.count);
  const heap = new MinHeap();
  for (let v = 0; v < k.count; v++) {
    const kind = cornerKind(k, land, v);
    if (kind === 2) down[v] = -1;
    else if (kind === 1 && k.border[v]) down[v] = -2;
    else continue;
    filled[v] = h[v];
    heap.push(h[v], v);
  }
  while (heap.size) {
    const [, v] = heap.pop();
    for (let i = k.start[v]; i < k.start[v + 1]; i++) {
      const n = k.next[i];
      if (down[n] !== -3 || cornerKind(k, land, n) !== 1) continue;
      down[n] = v;
      filled[n] = Math.max(h[n], filled[v]);
      heap.push(filled[n], n);
    }
  }
  drainCache.set(heights, down);
  return down;
}

/**
 * A river routed downhill from map point (x, y): from the nearest corner, along the borders
 * water drains by, to the coast, the map's edge, or a corner of another river (which it
 * joins). Null if (x, y) is not on land.
 */
export function routeRiver(g: Graph, land: Uint8Array, heights: ArrayLike<number>, x: number, y: number, others: River[]): number[] | null {
  const c = cellAt(g, x, y);
  if (c < 0 || !land[c]) return null;
  const k = corners(g);
  const down = drainage(g, land, heights);
  let v = nearestCorner(g, x, y, (n) => down[n] >= 0 || down[n] === -1 || down[n] === -2);
  if (v < 0) return null;
  const taken = new Set<number>();
  for (const r of others) for (const n of r.vertices) taken.add(n);
  const path = [v];
  for (let steps = 0; steps < k.count && down[v] >= 0 && !taken.has(v); steps++) {
    v = down[v];
    path.push(v);
  }
  return path.length >= 2 ? path : null;
}

// ------------------------------------------------------------------ lines drawn by hand

/**
 * A line (drawn by hand, or a river saved before rivers followed borders) moved onto the
 * borders nearest it: the corners it passes, joined along borders where it skips one,
 * without loops. It starts on land and ends at the first coast it reaches; it joins another
 * river at the first corner it shares with one, or at one within `joinWithin` of its end.
 */
export function snapLine(g: Graph, land: Uint8Array, pts: Pt[], others: River[], joinWithin: number): number[] | null {
  const k = corners(g);
  const onLand = (v: number) => cornerKind(k, land, v) !== 0;
  // Points every third of a cell along the line, and the corner nearest each.
  const step = g.spacing * 0.3;
  const seq: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
    const n = i === pts.length - 1 ? 1 : Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let j = 0; j < n; j++) {
      const v = nearestCorner(g, ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n);
      if (v >= 0 && v !== seq[seq.length - 1]) seq.push(v);
    }
  }
  // Start on land.
  while (seq.length && !onLand(seq[0])) seq.shift();
  if (seq.length < 2) return null;
  // Along borders, corner to corner.
  let path: number[] = [seq[0]];
  for (let i = 1; i < seq.length; i++) {
    const last = path[path.length - 1];
    if (seq[i] === last) continue;
    if (edgeBetween(k, last, seq[i]) >= 0) path.push(seq[i]);
    else {
      const way = pathBetween(g, k, last, seq[i], onLand, g.spacing * 4);
      if (way) path.push(...way.slice(1));
    }
  }
  // No loops: a corner passed twice cuts out what was between.
  const seen = new Map<number, number>();
  const plain: number[] = [];
  for (const v of path) {
    const at = seen.get(v);
    if (at !== undefined) {
      for (const u of plain.splice(at + 1)) seen.delete(u);
      continue;
    }
    seen.set(v, plain.length);
    plain.push(v);
  }
  path = plain;
  // It ends at the first coast after its start (the sea, or a lake), or before the water.
  for (let i = 1; i < path.length; i++) {
    const kind = cornerKind(k, land, path[i]);
    if (kind === 2) {
      path = path.slice(0, i + 1);
      break;
    }
    if (kind === 0) {
      path = path.slice(0, i);
      break;
    }
  }
  // Joining another river: at the first corner it shares with one, or at one near its end.
  const taken = new Set<number>();
  for (const r of others) for (const v of r.vertices) taken.add(v);
  const shared = path.findIndex((v, i) => i > 0 && taken.has(v));
  if (shared > 0) path = path.slice(0, shared + 1);
  else if (taken.size && cornerKind(k, land, path[path.length - 1]) === 1) {
    const end = path[path.length - 1];
    let best = -1;
    let bd = joinWithin;
    for (const v of taken) {
      const d = Math.hypot(cx(g, v) - cx(g, end), cy(g, v) - cy(g, end));
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (best >= 0) {
      const way = pathBetween(g, k, end, best, (v) => onLand(v) && !path.includes(v), g.spacing * 3);
      if (way) path.push(...way.slice(1));
    }
  }
  return path.length >= 2 ? path : null;
}

/**
 * Rivers as they should be on this map: each a chain of neighboring corners. A river saved
 * before rivers followed borders (only its old line, `points`) is moved onto the borders
 * nearest it; a chain with a gap is joined up along borders; rivers that cannot be fitted
 * are left out. `changed` says whether anything was done.
 */
export function fitRivers(g: Graph, land: Uint8Array, rivers: River[]): { rivers: River[]; changed: boolean } {
  const k = corners(g);
  const out: River[] = [];
  let changed = false;
  // Rivers already on borders first, so old ones can join them.
  const order = [...rivers].sort((a, b) => Number(a.vertices.length < 2) - Number(b.vertices.length < 2));
  for (const r of order) {
    if (r.vertices.length >= 2 && r.vertices.every((v) => Number.isInteger(v) && v >= 0 && v < k.count)) {
      let path: number[] = [r.vertices[0]];
      let ok = true;
      for (let i = 1; i < r.vertices.length; i++) {
        const a = path[path.length - 1];
        const b = r.vertices[i];
        if (a === b) continue;
        if (edgeBetween(k, a, b) >= 0) path.push(b);
        else {
          const way = pathBetween(g, k, a, b, () => true, g.spacing * 6);
          if (!way) {
            ok = false;
            break;
          }
          path.push(...way.slice(1));
          changed = true;
        }
      }
      if (ok && path.length >= 2) {
        out.push(path.length === r.vertices.length && !r.points ? r : { id: r.id, vertices: path, width: r.width });
        if (r.points) changed = true;
        continue;
      }
    }
    changed = true;
    if (!r.points || r.points.length < 2) continue;
    const path = snapLine(g, land, r.points, out, g.spacing * 0.6);
    if (path) out.push({ id: r.id, vertices: path, width: r.width });
  }
  // Keep the rivers in the order they were made.
  const index = new Map(rivers.map((r, i) => [r.id, i]));
  out.sort((a, b) => index.get(a.id)! - index.get(b.id)!);
  return { rivers: out, changed };
}

// ------------------------------------------------------------------ drawing

/** A river's line: along each border it follows, as the coasts are drawn (wiggly). Also where each corner falls along it (index into the points). */
export function riverLine(g: Graph, noisy: NoisyEdges, vertices: number[]): { pts: Pt[]; at: number[] } {
  const k = corners(g);
  const pts: Pt[] = [[cx(g, vertices[0]), cy(g, vertices[0])]];
  const at = [0];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1];
    const b = vertices[i];
    const e = edgeBetween(k, a, b);
    if (e < 0) pts.push([cx(g, b), cy(g, b)]);
    else {
      const line = noisy.get(e);
      const forward = g.edges[e * 4] === a;
      const n = line.length / 2;
      for (let j = 1; j < n; j++) {
        const q = forward ? j : n - 1 - j;
        pts.push([line[q * 2], line[q * 2 + 1]]);
      }
    }
    at.push(pts.length - 1);
  }
  return { pts, at };
}

/** A river's length along its borders (straight from corner to corner), in map units. */
export function riverLength(g: Graph, r: River) {
  let s = 0;
  for (let i = 1; i < r.vertices.length; i++) s += Math.hypot(cx(g, r.vertices[i]) - cx(g, r.vertices[i - 1]), cy(g, r.vertices[i]) - cy(g, r.vertices[i - 1]));
  return s;
}

/** A river ready to draw: its line and its width at each point, in map units. */
export interface RiverShape {
  id: string;
  pts: Pt[];
  widths: number[];
}

/** How a river narrows toward its source: a quarter of its own width there. */
const taper = (t: number) => 0.25 + 0.75 * Math.pow(Math.max(0, Math.min(1, t)), 0.7);

/**
 * The rivers as drawn: along their borders, each widening toward its mouth. A river whose
 * mouth is a corner of another river joins it, and that river is wider below the join
 * (widths add as areas do).
 */
export function riverShapes(rivers: River[], g: Graph, noisy: NoisyEdges): RiverShape[] {
  const ok = rivers.filter((r) => r.vertices.length >= 2);
  const lines = ok.map((r) => riverLine(g, noisy, r.vertices));
  const runs = lines.map(({ pts }) => {
    const s = [0];
    for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return s;
  });
  // Which river each one joins (its mouth is one of that river's corners), and how far along it.
  const joins: { into: number; s: number }[] = ok.map(() => ({ into: -1, s: 0 }));
  ok.forEach((r, a) => {
    const mouth = r.vertices[r.vertices.length - 1];
    ok.forEach((o, b) => {
      if (a === b || joins[a].into >= 0) return;
      const i = o.vertices.indexOf(mouth);
      if (i > 0 || (i === 0 && o.vertices.length > 1 && i !== o.vertices.length - 1)) joins[a] = { into: b, s: runs[b][lines[b].at[i]] };
    });
  });
  // Each river's width at its mouth, with everything that joins it.
  const memo = new Map<number, number>();
  const full = (i: number, depth = 0): number => {
    if (memo.has(i)) return memo.get(i)!;
    let w2 = ok[i].width ** 2;
    if (depth < 50) joins.forEach((j, k) => j.into === i && (w2 += full(k, depth + 1) ** 2));
    const w = Math.sqrt(w2);
    memo.set(i, w);
    return w;
  };
  return ok.map((r, i) => {
    const { pts } = lines[i];
    const run = runs[i];
    const L = run[run.length - 1] || 1;
    const widths = pts.map((_, k) => {
      let w2 = (taper(run[k] / L) * r.width) ** 2;
      joins.forEach((j, t) => j.into === i && j.s <= run[k] && (w2 += full(t) ** 2));
      return Math.sqrt(w2);
    });
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
