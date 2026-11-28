import type { Cliff, PlacedIcon, River } from '../world/types';
import { MinHeap, borderLine, cornerKind, corners, cx, cy, edgeBetween, nearestCorner, pathBetween, type Corners, type Pt } from './borders';
import { cliffNext, cliffZones, type CliffZones } from './cliffs';
import { cellAt, cellsNear, type Graph } from './graph';
import type { NoisyEdges } from './noisy';
import { KINDS } from './terrain';

export { corners, pathBetween };
/** A river's line: along each border it follows, wiggly as the coasts are. */
export const riverLine = borderLine;

// Rivers (Stage 5; along polygon borders since Caleb asked for it after Stage 7, as in
// Nortantis). A river runs along the borders between polygons, from corner to corner, and is
// drawn along the same wiggly lines as the coasts (noisy edges). It is stored as its chain of
// corners, from source to mouth. Caleb draws a river by hand (snapped to the borders nearest
// the stroke) or clicks a source and the app routes it downhill (Caleb: both). It ends at the
// coast (of the sea or a lake), the map's edge, or a corner of another river, which it joins.
// Where a river crosses a cliff, a waterfall appears. A river made by hand or by the generator
// that goes over a cliff runs down to the foot of the face below (out of sight, behind the
// face and the falling water), then on the way the cliff faces for a while, so it leaves the
// waterfall's pool the way the water falls (Caleb). Below a cliff by the sea or a lake, it ends
// at the shore: the waterfall falls into the water.


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

const drainCache = new WeakMap<ArrayLike<number>, { cliffs: Cliff[] | undefined; down: Int32Array }>();

/**
 * Where water at each corner flows next, along a border: the neighboring corner it drains
 * to; -1 at a corner on the coast (it reaches the water there); -2 at a corner on the map's
 * edge; -3 for corners in the water. Worked out by flooding up from the coast and the map's
 * edge, lowest first: water runs downhill, out of hollows over their lowest rim, and across
 * flat land toward the nearest way out. Below `cliffs`, water runs down the face and on the
 * way the cliff faces (and the ground on the low side does not drain back under the face).
 */
export function drainage(g: Graph, land: Uint8Array, heights: ArrayLike<number>, cliffs?: Cliff[]): Int32Array {
  const hit = drainCache.get(heights);
  const k = corners(g);
  if (hit && hit.cliffs === cliffs && hit.down.length === k.count) return hit.down;
  const Z = cliffZones(g, cliffs);
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
  const flood = (keepOut: boolean) => {
    while (heap.size) {
      const [, v] = heap.pop();
      const z = keepOut && Z ? Z.zone[v] : -1;
      for (let i = k.start[v]; i < k.start[v + 1]; i++) {
        const n = k.next[i];
        if (down[n] !== -3 || cornerKind(k, land, n) !== 1) continue;
        // Ground on a cliff's low side does not drain back under it.
        if (z >= 0 && Z!.zone[n] !== z && Z!.low[n] === z) continue;
        down[n] = v;
        filled[n] = Math.max(h[n], filled[v]);
        heap.push(filled[n], n);
      }
    }
  };
  flood(true);
  if (Z) {
    // Land that could only drain past a cliff that way drains as it would without it.
    for (let v = 0; v < k.count; v++) if (down[v] !== -3) heap.push(filled[v], v);
    flood(false);
    // Down the faces and on beyond them.
    const flooded = down.slice();
    for (let v = 0; v < k.count; v++) {
      if (down[v] < 0 || Z.zone[v] < 0) continue;
      const n = cliffNext(g, k, Z, v, (n) => cornerKind(k, land, n) !== 0);
      if (n >= 0) down[v] = n;
    }
    // Never round in circles: where that made a loop, the water there goes as it would without the cliffs.
    for (let changed = true; changed; ) {
      changed = false;
      const state = new Uint8Array(k.count);
      for (let s0 = 0; s0 < k.count; s0++) {
        if (state[s0]) continue;
        const trail: number[] = [];
        let v = s0;
        while (v >= 0 && !state[v]) {
          state[v] = 1;
          trail.push(v);
          v = down[v];
        }
        if (v >= 0 && state[v] === 1)
          for (let i = trail.indexOf(v); i < trail.length; i++)
            if (down[trail[i]] !== flooded[trail[i]]) {
              down[trail[i]] = flooded[trail[i]];
              changed = true;
            }
        for (const u of trail) state[u] = 2;
      }
    }
  }
  drainCache.set(heights, { cliffs, down });
  return down;
}

/**
 * A river routed downhill from map point (x, y): from the nearest corner, along the borders
 * water drains by, to the coast, the map's edge, or a corner of another river (which it
 * joins). Null if (x, y) is not on land.
 */
export function routeRiver(g: Graph, land: Uint8Array, heights: ArrayLike<number>, x: number, y: number, others: River[], cliffs?: Cliff[]): number[] | null {
  const c = cellAt(g, x, y);
  if (c < 0 || !land[c]) return null;
  const k = corners(g);
  const down = drainage(g, land, heights, cliffs);
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
 * Over one of `cliffs`, it runs down the face and on the way the cliff faces, as water
 * would, then back to the line.
 */
export function snapLine(g: Graph, land: Uint8Array, pts: Pt[], others: River[], joinWithin: number, cliffs?: Cliff[]): number[] | null {
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
  const Z = cliffZones(g, cliffs);
  if (Z) path = belowCliffs(g, k, land, Z, path);
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

/** A line along borders that goes over a cliff, made to run down its face and on the way it faces, then back to the line (or to end at the shore). */
function belowCliffs(g: Graph, k: Corners, land: Uint8Array, Z: CliffZones, path: number[]): number[] {
  const usable = (n: number) => cornerKind(k, land, n) !== 0;
  let out = path;
  for (let i = 0; i + 1 < out.length; i++) {
    const z = Z.zone[out[i + 1]];
    // Over the rim: from the cliff (or its high side) to below it.
    if (z < 0 || Z.zone[out[i]] === z || Z.low[out[i]] === z) continue;
    const under = (n: number) => Z.zone[n] === z;
    const chain = [out[i + 1]];
    for (let v = chain[0]; under(v) && cornerKind(k, land, v) === 1 && chain.length < 64; ) {
      const n = cliffNext(g, k, Z, v, usable);
      if (n < 0 || chain.includes(n)) break;
      chain.push(n);
      v = n;
    }
    const end = chain[chain.length - 1];
    let rest: number[] = [];
    if (cornerKind(k, land, end) === 1) {
      // Back to the line, at its first corner past the cliff.
      const j = out.findIndex((u, at) => at > i + 1 && !under(u) && Z.low[u] === z);
      const way = j >= 0 ? pathBetween(g, k, end, out[j], (n) => usable(n) && !under(n), g.spacing * 6) : null;
      if (way) rest = [...way.slice(1), ...out.slice(j + 1)];
    }
    out = [...out.slice(0, i + 1), ...chain, ...rest];
    i += chain.length - 1;
  }
  return out;
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

/** A river's length along its borders (straight from corner to corner), in map units. */
export function riverLength(g: Graph, r: River) {
  let s = 0;
  for (let i = 1; i < r.vertices.length; i++) s += Math.hypot(cx(g, r.vertices[i]) - cx(g, r.vertices[i - 1]), cy(g, r.vertices[i]) - cy(g, r.vertices[i - 1]));
  return s;
}

/** A river ready to draw: its line and its width at each point, in map units. */
export interface RiverShape {
  id: string;
  /** Its corners, and where each falls along its line (an index into pts). */
  vertices: number[];
  at: number[];
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
    return { id: r.id, vertices: r.vertices, at: lines[i].at, pts, widths };
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

/** The default width at the mouth for a new river, in map units. */
export const defaultRiverWidth = (spacing: number) => spacing * 0.2;

/** Whether an icon kind is drawn on rivers (a waterfall). */
export const isWater = (kind: PlacedIcon['kind']) => KINDS[kind].group === 'water';
