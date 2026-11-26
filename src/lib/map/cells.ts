import type { Graph } from './graph';
import type { NoisyEdges } from './noisy';

// Each cell's outline as a polygon (corners in order around the cell's center). Worked
// out once per graph, for painting biome colors.

export interface CellShapes {
  /** x, y pairs, cell after cell. */
  coords: Float32Array;
  /** Cell c's corners are coords[start[c] .. start[c + 1]) (in numbers, so twice the corner count). */
  start: Int32Array;
}

const cache = new WeakMap<Graph, CellShapes>();

export function cellShapes(g: Graph): CellShapes {
  const hit = cache.get(g);
  if (hit) return hit;
  const start = new Int32Array(g.cellCount + 1);
  const parts: number[][] = [];
  for (let c = 0; c < g.cellCount; c++) {
    const cx = g.centers[c * 2];
    const cy = g.centers[c * 2 + 1];
    const verts = new Set<number>();
    for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) {
      const e = g.cellEdges[k];
      verts.add(g.edges[e * 4]);
      verts.add(g.edges[e * 4 + 1]);
    }
    const sorted = [...verts].sort(
      (a, b) => Math.atan2(g.vertices[a * 2 + 1] - cy, g.vertices[a * 2] - cx) - Math.atan2(g.vertices[b * 2 + 1] - cy, g.vertices[b * 2] - cx),
    );
    const pts: number[] = [];
    for (const v of sorted) pts.push(g.vertices[v * 2], g.vertices[v * 2 + 1]);
    parts.push(pts);
    start[c + 1] = start[c] + pts.length;
  }
  const coords = new Float32Array(start[g.cellCount]);
  parts.forEach((p, c) => coords.set(p, start[c]));
  const shapes = { coords, start };
  cache.set(g, shapes);
  return shapes;
}

/** Adds cell c's outline to a path. */
export function addCell(path: Path2D, s: CellShapes, c: number) {
  const a = s.start[c];
  const b = s.start[c + 1];
  if (b - a < 6) return;
  path.moveTo(s.coords[a], s.coords[a + 1]);
  for (let i = a + 2; i < b; i += 2) path.lineTo(s.coords[i], s.coords[i + 1]);
  path.closePath();
}

/** Cell c's outline in map units, following its noisy edges around the cell (the straight polygon if they do not join up). */
export function cellOutline(g: Graph, noisy: NoisyEdges, c: number): number[] {
  const edges: number[] = [];
  for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) edges.push(g.cellEdges[k]);
  const out: number[] = [];
  const used = new Set<number>();
  let e = edges[0];
  let from = g.edges[e * 4];
  const first = from;
  while (e !== undefined && !used.has(e)) {
    used.add(e);
    const pts = noisy.get(e);
    const forward = g.edges[e * 4] === from;
    const n = pts.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const j = forward ? i : n - 1 - i;
      out.push(pts[j * 2], pts[j * 2 + 1]);
    }
    const to = forward ? g.edges[e * 4 + 1] : g.edges[e * 4];
    if (to === first) break;
    from = to;
    e = edges.find((x) => !used.has(x) && (g.edges[x * 4] === to || g.edges[x * 4 + 1] === to))!;
  }
  if (used.size === edges.length) return out;
  const s = cellShapes(g);
  return Array.from(s.coords.subarray(s.start[c], s.start[c + 1]));
}
