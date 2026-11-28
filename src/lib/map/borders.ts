import { cellAt, type Graph } from './graph';
import type { NoisyEdges } from './noisy';

// The corners of the polygons and the borders between them, which rivers and cliffs follow
// (after Stage 7, Caleb: as in Nortantis). A river or a cliff is a chain of corners, drawn
// along the same wiggly lines as the coasts (noisy edges).

export type Pt = [number, number];

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

export const cx = (g: Graph, v: number) => g.vertices[v * 2];
export const cy = (g: Graph, v: number) => g.vertices[v * 2 + 1];

/** What is around a corner: 0 only water, 1 only land, 2 both (the coast). */
export function cornerKind(k: Corners, land: Uint8Array, v: number) {
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
export function edgeBetween(k: Corners, a: number, b: number) {
  for (let i = k.start[a]; i < k.start[a + 1]; i++) if (k.next[i] === b) return k.edge[i];
  return -1;
}

/** The corner nearest map point (x, y) among the corners of the cell there (-1 off the map). */
export function nearestCorner(g: Graph, x: number, y: number, ok: (v: number) => boolean = () => true) {
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
export class MinHeap {
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

/** A chain of corners as drawn: along each border it follows, as the coasts are drawn (wiggly). Also where each corner falls along it (index into the points). */
export function borderLine(g: Graph, noisy: NoisyEdges, vertices: number[]): { pts: Pt[]; at: number[] } {
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
