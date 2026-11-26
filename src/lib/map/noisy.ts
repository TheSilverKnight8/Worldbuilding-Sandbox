import { mixSeed, seededRandom } from '../rng';
import type { Graph } from './graph';

// Noisy edges: the straight edge between two cells becomes a wiggly line, so coasts look
// natural instead of polygonal. The idea is Amit Patel's (Red Blob Games, "Noisy edges"):
// the wiggle stays inside the four-sided shape made by the edge's two ends and the two
// cell centers, so lines from neighboring edges never cross. This is the app's own
// version of that idea: recursive splitting of that shape around a jittered middle point.
// Each edge's wiggle is seeded by the map's seed and the edge number, so it is the same
// every time the map is drawn.

/** How far toward each cell center the wiggle may reach (0..1). Lower is calmer. */
const REACH = 0.5;
/** How far the middle point may move from the center of its shape, per split (0..0.5). */
const JITTER = 0.32;

export class NoisyEdges {
  private cache = new Map<number, Float32Array>();
  private minLength2: number;

  constructor(
    private g: Graph,
    private seed: number,
  ) {
    const min = g.spacing / 9;
    this.minLength2 = min * min;
  }

  /** Points along edge e, from its vertex 0 to its vertex 1, both included, as x, y pairs. */
  get(e: number): Float32Array {
    let pts = this.cache.get(e);
    if (pts) return pts;
    const g = this.g;
    const v0 = g.edges[e * 4];
    const v1 = g.edges[e * 4 + 1];
    const a = g.edges[e * 4 + 2];
    const b = g.edges[e * 4 + 3];
    const ax = g.vertices[v0 * 2];
    const ay = g.vertices[v0 * 2 + 1];
    const cx = g.vertices[v1 * 2];
    const cy = g.vertices[v1 * 2 + 1];
    if (b < 0) {
      // Along the map's edge: straight.
      pts = new Float32Array([ax, ay, cx, cy]);
    } else {
      const mx = (ax + cx) / 2;
      const my = (ay + cy) / 2;
      const bx = mx + (g.centers[a * 2] - mx) * REACH;
      const by = my + (g.centers[a * 2 + 1] - my) * REACH;
      const dx = mx + (g.centers[b * 2] - mx) * REACH;
      const dy = my + (g.centers[b * 2 + 1] - my) * REACH;
      const out: number[] = [ax, ay];
      const rand = seededRandom(mixSeed(this.seed, e));
      this.split(out, rand, ax, ay, bx, by, cx, cy, dx, dy);
      pts = new Float32Array(out);
    }
    this.cache.set(e, pts);
    return pts;
  }

  /** Splits the shape A-B-C-D (A and C are the line's ends) and pushes the points after A, ending with C. */
  private split(out: number[], rand: () => number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
    if ((cx - ax) ** 2 + (cy - ay) ** 2 < this.minLength2) {
      out.push(cx, cy);
      return;
    }
    // A point near the middle of the shape (bilinear position u, v around 0.5).
    const u = 0.5 + (rand() - 0.5) * 2 * JITTER;
    const v = 0.5 + (rand() - 0.5) * 2 * JITTER;
    const hx = (1 - u) * (1 - v) * ax + u * (1 - v) * bx + u * v * cx + (1 - u) * v * dx;
    const hy = (1 - u) * (1 - v) * ay + u * (1 - v) * by + u * v * cy + (1 - u) * v * dy;
    this.split(out, rand, ax, ay, (ax + bx) / 2, (ay + by) / 2, hx, hy, (ax + dx) / 2, (ay + dy) / 2);
    this.split(out, rand, hx, hy, (bx + cx) / 2, (by + cy) / 2, cx, cy, (cx + dx) / 2, (cy + dy) / 2);
  }
}
